"""The database layer: PostgreSQL over psycopg2 as the staging DML tier, and nothing else.

`PgStore` is the only class that touches a database. The rest of the package is written against
the same method names, so tests substitute an in-memory store. psycopg2 and `lesson_aggregate` are
imported inside `PgStore.__init__`, so importing this module (and the whole package) needs neither.

THE PRODUCTION TRAP. `lesson_aggregate._connect()` and `app_tier_check.load()` read
`supabase/admin/.env`, which on the grader's machine may hold the PRODUCTION credential. Neither is
ever called here. This class builds its own connection from the staging env file and hands that
connection to the aggregator's functions, which all take a `conn`.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
from argparse import Namespace
from pathlib import Path

from .config import DML_ROLE, STAGING_REF, Stop
from . import EXIT_DB, EXIT_REFUSED

ADMIN_DIR = Path(__file__).resolve().parents[1]

UPSERT = """
insert into grades (enrollment_id, assignment_offering_id, submission_id, points_earned, points_possible,
                    question_scores, diagnostic, source, is_finalized, graded_at)
values (%(enrollment_id)s, %(assignment_offering_id)s, %(submission_id)s, %(points_earned)s, %(points_possible)s,
        %(question_scores)s, %(diagnostic)s, %(source)s, false, %(graded_at)s)
on conflict (enrollment_id, assignment_offering_id) do update
   set submission_id = excluded.submission_id, points_earned = excluded.points_earned,
       points_possible = excluded.points_possible, question_scores = excluded.question_scores,
       diagnostic = excluded.diagnostic, source = excluded.source, is_finalized = false,
       graded_at = excluded.graded_at
 where grades.is_finalized = false
   -- Only overwrite the row exactly as this run READ it. A draft an instructor touched since (its source or its
   -- graded_at moved) matches nothing, writes nothing, and is counted as left for a person.
   and grades.source is not distinct from %(read_source)s
   and grades.graded_at is not distinct from %(read_graded_at)s
"""

ROSTER_SQL = """
select e.id as enrollment_id, e.student_id, e.status, sec.id as section_id, sec.code as section_code,
       s.id as submission_id, s.status as sub_status, s.chosen_activity_id, sa.content,
       g.is_finalized, g.source, g.graded_at, g.question_scores, g.diagnostic,
       x.extended_due_at, x.revoked_at
  from enrollments e
  join sections sec on sec.id = e.section_id and sec.course_offering_id = %(co)s and %(track)s = any(sec.meeting_days)
  left join submissions s on s.enrollment_id = e.id and s.assignment_offering_id = %(oid)s
  left join submission_activities sa on sa.submission_id = s.id and sa.activity_id = %(wid)s
  left join grades g on g.enrollment_id = e.id and g.assignment_offering_id = %(oid)s
  left join extensions x on x.enrollment_id = e.id and x.assignment_offering_id = %(oid)s
 where e.status = 'active' order by sec.code, e.id
"""

KEYS_SQL = """select q.qid, q.choices, k.correct_choice_ids, k.value, k.tol_abs, k.tol_pct
                from questions q join question_keys k on k.question_id = q.id
                 and k.variant_key = '' and k.superseded_at is null
               where q.activity_id = %s"""

MAX_LABEL, MAX_DESC = 80, 300


def upsert_params(r, wrap):
    """The parameters for UPSERT. `wrap` turns a dict into a database JSON value (psycopg2's Json)."""
    return {**r, "question_scores": wrap(r["question_scores"]), "diagnostic": wrap(r["diagnostic"]),
            "submission_id": r.get("submission_id"), "read_source": r.get("read_source"),
            "read_graded_at": r.get("read_graded_at")}


def map_keys(rows):
    """question_keys rows -> {qid: key} in the shape grade_run._score_nonprose reads."""
    out = {}
    for r in rows:
        if r["correct_choice_ids"]:
            texts = {c.get("id"): c.get("text") for c in (r["choices"] or []) if isinstance(c, dict)}
            correct = [texts.get(i, i) for i in r["correct_choice_ids"]]
            out[r["qid"]] = {"correct_answer": correct[0], "accept": [*r["correct_choice_ids"], *correct]}
        elif r["value"] is not None:
            out[r["qid"]] = {"value": float(r["value"]),
                             "tol_abs": float(r["tol_abs"]) if r["tol_abs"] is not None else None,
                             "tol_pct": float(r["tol_pct"]) if r["tol_pct"] is not None else None}
    return out


class PgStore:
    def __init__(self, db, invoked_by="human"):
        try:
            import psycopg2
            from psycopg2.extras import Json, RealDictCursor
        except ImportError:
            raise Stop(EXIT_DB, "psycopg2 not found: use the project .venv (pip install -r requirements.txt).")
        self._Json, self._Dict = Json, RealDictCursor
        # Never `lesson_aggregate._connect()`: that reads supabase/admin/.env (see the module note).
        sys.path.insert(0, str(ADMIN_DIR))
        import lesson_aggregate
        self.la, self.db, self.invoked_by = lesson_aggregate, db, invoked_by
        if db["ref"] != STAGING_REF or db["role"] != DML_ROLE:
            raise Stop(EXIT_REFUSED, "the store will only connect to staging as the DML tier")
        try:
            self.conn = psycopg2.connect(host=db["host"], port=db["port"], dbname=db["dbname"],
                                         user=f"{db['role']}.{db['ref']}", password=db["password"].reveal(),
                                         sslmode="require", connect_timeout=15)
        except psycopg2.Error as exc:
            raise Stop(EXIT_DB, "could not connect to the staging database: " + type(exc).__name__)
        self.conn.autocommit = False
        cur = self.conn.cursor()
        cur.execute("SET search_path = app")
        self.assert_staging()
        self.conn.commit()
        self._terms = {}

    def _cur(self):
        return self.conn.cursor(cursor_factory=self._Dict)

    def assert_staging(self):
        cur = self.conn.cursor()
        cur.execute("select current_user")
        if cur.fetchone()[0] != self.db["role"]:
            raise Stop(EXIT_REFUSED, "the connected role is not the DML tier")
        # The pooler user is `<role>.<ref>` and was built from a ref already checked against
        # db_target; this is the post-connect confirmation that the session is that role.

    def close(self):
        self.conn.close()

    # ── reads ──────────────────────────────────────────────────────────────────────────
    def active_courses(self):
        cur = self._cur()
        cur.execute("select c.code from course_offerings co join courses c on c.id = co.course_id "
                    "where co.is_active order by c.code")
        out = [r["code"] for r in cur.fetchall()]
        self.conn.rollback()
        return out

    def worklist(self, course, as_of=None):
        rows = self.la.worklist_rows(self.conn, course, None, as_of)
        self.conn.rollback()
        return rows

    def lesson(self, offering_id, slug):
        cur = self._cur()
        cur.execute("""
            select ao.id, ao.assignment_id, ao.points_possible, ao.grading_mode, ao.due_at, ao.due_by_day,
                   co.id as course_offering_id, c.code as course_code, t.code as term_code,
                   a.title
              from assignment_offerings ao join assignments a on a.id = ao.assignment_id
              join course_offerings co on co.id = ao.course_offering_id
              join courses c on c.id = co.course_id join terms t on t.id = co.term_id
             where ao.id = %s""", (offering_id,))
        o = cur.fetchone()
        meta = self.la._lesson_meta(self.conn, slug, o["term_code"])
        self._terms[slug] = o["term_code"]
        content = meta.get("written_content") or {}
        rt_id = self.la._pinned_question_id(content, "reading_time")[0]
        rf_id = self.la._pinned_question_id(content, "reading_reflection")[0]
        keys = self._keys(meta.get("written_id"), content)
        questions = []
        for q in content.get("questions") or []:
            if not isinstance(q, dict) or not q.get("id"):
                continue
            pts = float(q.get("points") or 0)
            role = ("reading_time" if q["id"] == rt_id else "reflection" if q["id"] == rf_id else
                    "concept" if q.get("type") == "free_response" and pts > 0 else "other")
            questions.append({"id": q["id"], "type": q.get("type"), "text": q.get("text"), "points": pts,
                              "role": role, "figure_url": q.get("figure_url"),
                              "expected_response": q.get("expected_response"), "key": keys.get(q["id"])})
        cur.execute("select id, code, meeting_days from sections where course_offering_id = %s", (o["course_offering_id"],))
        sections = [{"id": str(r["id"]), "code": r["code"], "meeting_days": list(r["meeting_days"] or [])}
                    for r in cur.fetchall()]
        cur.execute("select section_id, due_at from assignment_due_dates where assignment_offering_id = %s", (offering_id,))
        by_section = {str(r["section_id"]): r["due_at"].isoformat() for r in cur.fetchall() if r["due_at"]}
        by_day = o["due_by_day"] if isinstance(o["due_by_day"], dict) else {}
        section_day = {}
        for s in sections:      # the first meeting day that carries a date, as the worklist reads it
            section_day[s["id"]] = next((d for d in s["meeting_days"] if d in by_day), (s["meeting_days"] or [""])[0])
        self.conn.rollback()
        return {"offering_id": str(offering_id), "assignment_id": str(o["assignment_id"]), "slug": slug,
                "title": o["title"], "course_offering_id": str(o["course_offering_id"]),
                "course_code": o["course_code"], "points_possible": float(o["points_possible"]),
                "grading_mode": o["grading_mode"], "written_id": meta.get("written_id"),
                "interactive_id": meta.get("interactive_id"), "withheld": bool(meta.get("written_withheld")),
                "reference_pdf": content.get("reference_pdf"), "reference_pages": content.get("reference_pages"),
                "questions": questions, "sections": sections,
                "deadlines": {"due_by_section": by_section, "section_day": section_day, "due_by_day": by_day,
                              "due_at": o["due_at"].isoformat() if o["due_at"] else None}}

    def _keys(self, activity_id, content):
        if not activity_id:
            return {}
        cur = self._cur()
        cur.execute(KEYS_SQL, (activity_id,))
        return map_keys(cur.fetchall())

    def roster(self, offering_id, course_offering_id, track, lesson):
        cur = self._cur()
        cur.execute(ROSTER_SQL,
                    {"co": course_offering_id, "track": track, "oid": offering_id, "wid": lesson["written_id"]})
        out = []
        for r in cur.fetchall():
            r = dict(r)
            r["enrollment_id"], r["section_id"] = str(r["enrollment_id"]), str(r["section_id"])
            r["grade"] = ({"is_finalized": r.pop("is_finalized"), "source": r.pop("source"), "graded_at": r.pop("graded_at"),
                           "question_scores": r.pop("question_scores"), "diagnostic": r.pop("diagnostic")}
                          if r.get("source") is not None or r.get("is_finalized") is not None else None)
            for k in ("is_finalized", "source", "graded_at", "question_scores", "diagnostic"):
                r.pop(k, None)
            out.append(r)
        self.conn.rollback()
        return out

    def sibling_data(self, student_ids, offering_id):
        cur = self._cur()
        cur.execute("select id, student_id, status from enrollments where student_id = any(%s)", (list(student_ids),))
        enr = [{"id": str(r["id"]), "student_id": r["student_id"], "status": r["status"]} for r in cur.fetchall()]
        cur.execute("select enrollment_id, assignment_offering_id, status from submissions "
                    "where assignment_offering_id = %s and enrollment_id = any(%s::uuid[])",
                    (offering_id, [e["id"] for e in enr]))
        subs = [{"enrollment_id": str(r["enrollment_id"]), "assignment_offering_id": str(r["assignment_offering_id"]),
                 "status": r["status"]} for r in cur.fetchall()]
        self.conn.rollback()
        return enr, subs

    def taxonomy_bucket(self, assignment_id):
        cur = self._cur()
        cur.execute("""select g.diagnostic -> 'misconceptions' as m from grades g
                         join assignment_offerings ao on ao.id = g.assignment_offering_id
                        where ao.assignment_id = %s and jsonb_typeof(g.diagnostic -> 'misconceptions') = 'array'
                        limit 5000""", (assignment_id,))
        out, seen = [], set()
        for r in cur.fetchall():
            for m in r["m"] or []:
                if isinstance(m, dict) and m.get("id") and m["id"] not in seen:
                    seen.add(m["id"])
                    out.append({"id": m["id"], "label": str(m.get("label") or "")[:MAX_LABEL],
                                "description": str(m.get("description") or "")[:MAX_DESC]})
        self.conn.rollback()
        return out

    def last_run_statuses(self, offering_id, track, n):
        cur = self._cur()
        cur.execute("select status from analysis_runs where assignment_offering_id = %s and coalesce(day_track,'') = %s "
                    "order by started_at desc limit %s", (offering_id, track or "", n))
        out = [r["status"] for r in cur.fetchall()]
        self.conn.rollback()
        return out

    def running_recent(self, offering_id, track, hours):
        cur = self._cur()
        cur.execute("select count(*) as n from analysis_runs where assignment_offering_id = %s and coalesce(day_track,'') = %s "
                    "and status = 'running' and started_at > now() - make_interval(hours => %s)", (offering_id, track or "", hours))
        n = cur.fetchone()["n"]
        self.conn.rollback()
        return n > 0

    # ── writes ─────────────────────────────────────────────────────────────────────────
    def write_grades(self, rows, verify):
        """One transaction: upsert, read back, verify, then commit or roll back. Returns (refused, problems)."""
        cur, refused, kept = self._cur(), [], []
        try:
            for r in rows:
                cur.execute(UPSERT, upsert_params(r, self._Json))
                (kept if cur.rowcount else refused).append(r if cur.rowcount else r["enrollment_id"])
            cur.execute("select enrollment_id, points_earned, points_possible, question_scores, diagnostic, source, is_finalized "
                        "from grades where assignment_offering_id = %s and enrollment_id = any(%s::uuid[])",
                        (rows[0]["assignment_offering_id"], [r["enrollment_id"] for r in kept]))
            back = [dict(x, enrollment_id=str(x["enrollment_id"])) for x in cur.fetchall()]
            problems = verify(kept, back)
        except Exception:
            self.conn.rollback()
            raise
        if problems:
            self.conn.rollback()
        else:
            self.conn.commit()
        return refused, problems

    def run_start(self, meta, skill, day):
        return self.la._run_start(self.conn, meta, skill, self.invoked_by, day)

    def run_finish(self, run_id, status, summary=None, detail=None, error=None):
        self.la._run_finish(self.conn, run_id, status, summary=summary, detail=detail, error=error)

    def course_skip(self, course, summary, detail):
        cur = self._cur()
        cur.execute("select co.id from course_offerings co join courses c on c.id = co.course_id "
                    "where co.is_active and c.code = %s", (course,))
        rows = cur.fetchall()
        if len(rows) != 1:
            self.conn.rollback()
            return
        cur.execute("insert into analysis_runs (skill, invoked_by, course_offering_id, status, finished_at, summary, detail) "
                    "values ('lesson-cycle', %s, %s, 'skipped', now(), %s, %s)",
                    (self.invoked_by, rows[0]["id"], summary, self._Json(detail)))
        self.conn.commit()

    # ── aggregation, through the existing writer ───────────────────────────────────────
    def _private_dir(self):
        d = tempfile.mkdtemp(prefix="prep-overnight-")
        os.chmod(d, 0o700)
        return d

    def aggregate_pull(self, slug, track):
        d = self._private_dir()
        try:
            out = Path(d) / "pull.json"
            args = Namespace(activity=slug, out=str(out), tutor_only=False, term=self._terms.get(slug), day=track)
            with contextlib.redirect_stdout(io.StringIO()):
                self.la.cmd_pull(args, self.conn)
            self.conn.rollback()
            return json.loads(out.read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def aggregate_write(self, items, track, dry_run):
        d = self._private_dir()
        try:
            f = Path(d) / "scopes.json"
            f.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            buf = io.StringIO()
            slug = items[0]["activity_slug"]
            args = Namespace(infile=str(f), dry_run=dry_run, day=track, invoked_by=self.invoked_by, term=self._terms.get(slug))
            with contextlib.redirect_stdout(buf):
                self.la.cmd_write(args, self.conn)
            text = buf.getvalue()
            return sum(1 for ln in text.splitlines() if "[err ]" in ln), text
        finally:
            shutil.rmtree(d, ignore_errors=True)
