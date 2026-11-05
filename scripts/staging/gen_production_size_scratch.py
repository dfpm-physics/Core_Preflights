#!/usr/bin/env python
"""Build a scratch database at PRODUCTION SIZE, time the v2 functions on it, and time old writes with and without the
new triggers. Everything is invented. The scratch databases are dropped when the run ends, however it ends.

WHICH DATABASE   Never one that holds anything. The script reads the staging connection string (default STAGING_DB_URL),
        checks through db_target.py that it is the staging project, then creates its OWN databases on that server, named
        scratch_size_<hex>_old and scratch_size_<hex>_new, and refuses to run a single statement against any database
        whose name does not start with scratch_size_ (checked on every connection with current_database()). It drops only
        the two it created. Production is refused by db_target.

WHAT IT BUILDS
  OLD   the schema through migration 025 only (what production runs today), filled with the sizes below.
  NEW   a byte copy of OLD (CREATE DATABASE ... TEMPLATE), then migrations 026 to 039 applied, then the path backfill.
  Sizes (active offerings): phys-110 21 sections, 465 cadets, 37 items, 12879 grades, 11374 submissions;
        phys-215 17 sections, 362 cadets, 37 items, 10020 grades, 9206 submissions; phys-310 1 section, 9 cadets, 20 items.
  The cadets, sections and items are generated; the grades and submissions are the first N of the (cadet x item) pairs
  in a fixed hash order, submissions first, so a grade usually has its submission and some do not.

WHAT IT TIMES  (server-side, from EXPLAIN (ANALYZE), median of --repeat runs; client wall time beside it)
  On NEW: _cells_at, _totals_at, gradebook_cells, course_totals, deadline_rows, per course; then EXPLAIN (ANALYZE, BUFFERS)
  of the slowest.
  On OLD and NEW, the same old-writer statements (each in a transaction that is rolled back): one grade edit, one new
  draft, one commit, one new grade, one offering edit, one new path, and a lesson-wide grade update (about 465 rows). The
  Execution Time and the per-trigger time EXPLAIN reports are printed, with the NEW/OLD ratio.

USAGE   python scripts/staging/gen_production_size_scratch.py --expect-ref <staging ref> [--repeat 5] [--through 039]
Exit code 0 when it ran, 1 on a failure, 2 when it refuses.
"""
import argparse
import getpass
import json
import os
import re
import secrets
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402

PREFIX = "scratch_size_"
COURSES = [  # code, sections, cadets, items, grades, submissions, student id base
    ("phys-110", 21, 465, 37, 12879, 11374, 3001000000),
    ("phys-215", 17, 362, 37, 10020, 9206, 3002000000),
    ("phys-310", 1, 9, 20, 0, 0, 3003000000),
]


def refuse(msg):
    print(f"REFUSED  {msg}", file=sys.stderr)
    sys.exit(2)


def connect(url, name):
    import psycopg2

    if not name.startswith(PREFIX):
        refuse(f"{name} is not a scratch_size_ database.")
    u = urlparse(url)
    conn = psycopg2.connect(urlunparse(u._replace(path="/" + name)), connect_timeout=20)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    if cur.fetchone()[0] != name:
        conn.close()
        refuse("connected to a database other than the scratch one.")
    return conn


def run_file(cur, label, sql, owner=True):
    body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
    try:
        if owner:
            cur.execute("SET ROLE prep_app_owner;")
            cur.execute("RESET search_path;")
        cur.execute(body)
    except Exception as exc:  # noqa: BLE001
        try:
            cur.execute("ROLLBACK;")
        except Exception:  # noqa: BLE001
            pass
        print(f"FAILED   {label}: {str(exc).strip().splitlines()[0]}")
        raise SystemExit(1)
    finally:
        if owner:
            try:
                cur.execute("RESET ROLE;")
            except Exception:  # noqa: BLE001
                pass
    print(f"ok       {label}")


def build_old(cur):
    sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
    sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
    sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
    cur.execute(sbc.AUTH_STUB)
    cur.execute(sql)
    for f in ins.migration_files(None):
        if f.name[:3] <= "025":
            run_file(cur, f.name, f.read_text(encoding="utf-8"))
    cur.execute(ins.AUTH_FKS)
    cur.execute(ins.TUTOR_LOG_GRANTS)


GEN = """
SET search_path = app, public;
INSERT INTO courses (id, code, title) VALUES (%(course)s, %(code)s, %(code)s) ON CONFLICT DO NOTHING;
INSERT INTO terms (id, code, label) VALUES (%(term)s, 'size-term', 'Size term') ON CONFLICT DO NOTHING;
INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%(co)s, %(course)s, %(term)s, true);
INSERT INTO sections (id, course_offering_id, code, meeting_days)
  SELECT gen_random_uuid(), %(co)s, 'S' || g, CASE WHEN g %% 2 = 1 THEN ARRAY['M'] ELSE ARRAY['T'] END
    FROM generate_series(1, %(sections)s) g;
INSERT INTO students (student_id, name, email)
  SELECT %(base)s + g, 'Size Cadet ' || g, 'sz' || (%(base)s + g) || '@prep-staging.example'
    FROM generate_series(1, %(cadets)s) g;
INSERT INTO enrollments (id, student_id, section_id, status)
  SELECT gen_random_uuid(), %(base)s + g,
         (SELECT id FROM (SELECT id, row_number() OVER (ORDER BY code) AS rn FROM sections WHERE course_offering_id = %(co)s) s
           WHERE s.rn = ((g - 1) %% %(sections)s) + 1), 'active'
    FROM generate_series(1, %(cadets)s) g;
INSERT INTO assignments (id, course_id, kind_id, slug, title)
  SELECT gen_random_uuid(), %(course)s, 'preflight', 'size-' || %(code)s || '-' || g, 'Size preflight ' || g
    FROM generate_series(1, %(items)s) g;
INSERT INTO assignment_offerings (id, course_offering_id, assignment_id, points_possible, is_published, grading_mode,
                                  due_at, due_by_day, position)
  SELECT gen_random_uuid(), %(co)s, a.id, 2, true, 'points',
         date_trunc('day', now()) - ((%(items)s - rn) || ' days')::interval + interval '23 hours 59 minutes 59 seconds',
         jsonb_build_object('M', to_char(date_trunc('day', now()) - ((%(items)s - rn) || ' days')::interval + interval '23 hours 59 minutes 59 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                            'T', to_char(date_trunc('day', now()) - ((%(items)s - rn - 1) || ' days')::interval + interval '23 hours 59 minutes 59 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         rn
    FROM (SELECT id, row_number() OVER (ORDER BY slug) AS rn FROM assignments WHERE course_id = %(course)s) a;
INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at)
  SELECT ao.id, s.id, CASE WHEN s.meeting_days = ARRAY['M'] THEN ao.due_at ELSE ao.due_at + interval '1 day' END
    FROM assignment_offerings ao JOIN sections s ON s.course_offering_id = ao.course_offering_id
   WHERE ao.course_offering_id = %(co)s;
INSERT INTO activities (id, assignment_id, modality, slug, title, content, position)
  SELECT gen_random_uuid(), ao.assignment_id, 'written', 'w-' || ao.id, 'written', '{}'::jsonb, 0
    FROM assignment_offerings ao WHERE ao.course_offering_id = %(co)s;
INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role)
  SELECT ao.id, a.id, 'graded' FROM assignment_offerings ao JOIN activities a ON a.assignment_id = ao.assignment_id
   WHERE ao.course_offering_id = %(co)s;
CREATE TEMP TABLE pairs ON COMMIT DROP AS
  SELECT e.id AS enr, ao.id AS ao, a.id AS act, ao.due_at,
         row_number() OVER (ORDER BY hashtext(e.id::text || ao.id::text)) AS rn
    FROM enrollments e JOIN sections s ON s.id = e.section_id
    CROSS JOIN assignment_offerings ao JOIN activities a ON a.assignment_id = ao.assignment_id
   WHERE s.course_offering_id = %(co)s AND ao.course_offering_id = %(co)s;
INSERT INTO submissions (enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at)
  SELECT enr, ao, act, 'committed', due_at - interval '1 day' FROM pairs WHERE rn <= %(subs)s;
INSERT INTO submission_activities (submission_id, activity_id, content, is_final)
  SELECT s.id, p.act, '{"q1": "A made-up answer long enough to look like a real one.", "q2": "Another made-up answer."}'::jsonb, true
    FROM submissions s JOIN pairs p ON p.enr = s.enrollment_id AND p.ao = s.assignment_offering_id;
INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized, graded_at, diagnostic)
  SELECT enr, ao, CASE WHEN rn %% 7 = 0 THEN 1 ELSE 2 END, 2, CASE WHEN rn %% 5 = 0 THEN 'ai_suggested' ELSE 'instructor' END,
         true, due_at + interval '2 days',
         CASE WHEN rn > %(subs)s THEN '{"no_submission": true}'::jsonb ELSE '{}'::jsonb END
    FROM pairs WHERE rn <= %(grades)s;
"""


def generate(cur):
    cur.execute("SELECT current_setting('is_superuser')")
    try:
        cur.execute("SET session_replication_role = replica")        # skip triggers while loading, if allowed
        print("ok       load with triggers off (replica role)")
    except Exception as exc:  # noqa: BLE001
        print(f"note     triggers stay on during the load: {str(exc).splitlines()[0]}")
    import uuid

    ids = {}
    for code, sections, cadets, items, grades, subs, base in COURSES:
        p = dict(course=str(uuid.uuid4()), term=str(uuid.uuid4()), co=str(uuid.uuid4()), code=code, sections=sections,
                 cadets=cadets, items=items, grades=grades, subs=subs, base=base)
        cur.execute("BEGIN")
        if code == COURSES[0][0]:
            cur.execute("INSERT INTO app.terms (id, code, label) VALUES (%s, 'size-term', 'Size term')", (p["term"],))
        else:
            cur.execute("SELECT id FROM app.terms WHERE code = 'size-term'")
            p["term"] = str(cur.fetchone()[0])
        gen = GEN.replace("INSERT INTO terms (id, code, label) VALUES (%(term)s, 'size-term', 'Size term') ON CONFLICT DO NOTHING;", "")
        cur.execute(gen, p)
        cur.execute("COMMIT")
        ids[code] = p["co"]
        print(f"ok       generated {code}")
    try:
        cur.execute("RESET session_replication_role")
    except Exception:  # noqa: BLE001
        pass
    # one director of all three offerings, so the staff-gated functions can be called with a caller
    director = str(uuid.uuid4())
    cur.execute("BEGIN")
    cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (director,))
    cur.execute("INSERT INTO app.instructors (id, name) VALUES (%s, 'Size Director')", (director,))
    for co in ids.values():
        cur.execute("INSERT INTO app.staff_assignments (instructor_id, course_offering_id, role) VALUES (%s, %s, 'director')", (director, co))
    cur.execute("COMMIT")
    cur.execute("ANALYZE")
    cur.execute("SELECT (SELECT count(*) FROM app.grades), (SELECT count(*) FROM app.submissions), (SELECT count(*) FROM app.enrollments), "
                "(SELECT count(*) FROM app.assignment_offerings), (SELECT count(*) FROM app.sections)")
    print("rows     grades %s, submissions %s, enrollments %s, items %s, sections %s" % cur.fetchone())
    return ids, director


def explain(cur, sql, args=(), buffers=False):
    """Run EXPLAIN (ANALYZE) in a transaction that is rolled back. Returns (execution ms, triggers, plan text)."""
    opts = "ANALYZE, BUFFERS" if buffers else "ANALYZE"
    cur.execute("BEGIN")
    try:
        if buffers:
            cur.execute(f"EXPLAIN ({opts}) {sql}", args)
            text = "\n".join(r[0] for r in cur.fetchall())
            m = re.search(r"Execution Time: ([\d.]+) ms", text)
            return float(m.group(1)), [], text
        cur.execute(f"EXPLAIN ({opts}, FORMAT JSON) {sql}", args)
        doc = cur.fetchone()[0]
        doc = doc if isinstance(doc, list) else json.loads(doc)
        top = doc[0]
        trig = [(t["Trigger Name"], t["Time"], t["Calls"]) for t in top.get("Triggers", [])]
        return float(top["Execution Time"]), trig, None
    finally:
        cur.execute("ROLLBACK")


def med(xs):
    return statistics.median(xs)


def time_functions(cur, ids, director, repeat):
    cur.execute("SELECT set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": director, "role": "authenticated"}),))
    calls = [("_cells_at", "SELECT count(*) FROM app._cells_at(%s, 'final', now())"),
             ("_totals_at", "SELECT count(*) FROM app._totals_at(%s, 'final', now())"),
             ("gradebook_cells", "SELECT count(*) FROM app.gradebook_cells(%s, 'final')"),
             ("course_totals", "SELECT count(*) FROM app.course_totals(%s, 'final')"),
             ("deadline_rows", "SELECT count(*) FROM app.deadline_rows(%s)")]
    results = []
    print(f"\n{'function':16}{'course':10}{'rows':>9}{'server ms':>12}{'wall ms':>10}")
    for code, co in ids.items():
        for name, sql in calls:
            server, wall = [], []
            rows = None
            for _ in range(repeat):
                t0 = time.perf_counter()
                cur.execute(sql, (co,))
                rows = cur.fetchone()[0]
                wall.append((time.perf_counter() - t0) * 1000)
                ms, _, _ = explain(cur, sql, (co,))
                server.append(ms)
            results.append((name, code, co, rows, med(server), med(wall), sql))
            print(f"{name:16}{code:10}{rows:>9}{med(server):>12.0f}{med(wall):>10.0f}")
    return results


WRITES = [
    ("edit one grade", "UPDATE app.grades SET points_earned = 1, graded_at = now() WHERE id = (SELECT id FROM app.grades WHERE is_finalized ORDER BY id LIMIT 1)"),
    ("new draft submission", "INSERT INTO app.submissions (enrollment_id, assignment_offering_id, status) "
                             "SELECT e.id, ao.id, 'draft' FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id "
                             "JOIN app.assignment_offerings ao ON ao.course_offering_id = s.course_offering_id "
                             "WHERE NOT EXISTS (SELECT 1 FROM app.submissions x WHERE x.enrollment_id = e.id AND x.assignment_offering_id = ao.id) LIMIT 1"),
    ("commit a submission", "UPDATE app.submissions SET status = 'committed', committed_at = now() "
                            "WHERE id = (SELECT id FROM app.submissions WHERE status = 'committed' ORDER BY id LIMIT 1)"),
    ("new zero grade", "INSERT INTO app.grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized, diagnostic) "
                       "SELECT e.id, ao.id, 0, 2, 'ai_suggested', false, '{\"no_submission\": true}'::jsonb FROM app.enrollments e "
                       "JOIN app.sections s ON s.id = e.section_id JOIN app.assignment_offerings ao ON ao.course_offering_id = s.course_offering_id "
                       "WHERE NOT EXISTS (SELECT 1 FROM app.grades g WHERE g.enrollment_id = e.id AND g.assignment_offering_id = ao.id) LIMIT 1"),
    ("edit one offering", "UPDATE app.assignment_offerings SET due_at = due_at + interval '1 minute' WHERE id = (SELECT id FROM app.assignment_offerings ORDER BY id LIMIT 1)"),
    ("add a path", "INSERT INTO app.offering_activities (assignment_offering_id, activity_id, grading_role) "
                   "SELECT ao.id, a.id, 'practice' FROM app.assignment_offerings ao JOIN app.activities a ON a.assignment_id = ao.assignment_id "
                   "WHERE NOT EXISTS (SELECT 1 FROM app.offering_activities x WHERE x.assignment_offering_id = ao.id AND x.activity_id = a.id) LIMIT 1"),
    ("update a lesson's grades (about 465 rows)", "UPDATE app.grades SET points_earned = 1, graded_at = now() "
                                                  "WHERE assignment_offering_id = (SELECT assignment_offering_id FROM app.grades GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1)"),
]


def time_writes(cur, repeat):
    out = {}
    for label, sql in WRITES:
        ms, trig = [], {}
        for _ in range(repeat):
            m, t, _ = explain(cur, sql)
            ms.append(m)
            for name, tm, calls in t:
                trig.setdefault(name, []).append((tm, calls))
        out[label] = (med(ms), {k: (med([a for a, _ in v]), v[0][1]) for k, v in trig.items()})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--url-env", default="STAGING_DB_URL")
    ap.add_argument("--repeat", type=int, default=5)
    ap.add_argument("--through", default="039", help="last migration of the NEW database")
    ap.add_argument("--keep", action="store_true", help="do not drop (for debugging; prints the names)")
    args = ap.parse_args()
    url = os.environ.get(args.url_env, "").strip()
    if not url:
        refuse(f"{args.url_env} is not set.")
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        refuse(str(exc))
    import psycopg2

    tag = secrets.token_hex(3)
    old = f"{PREFIX}{tag}_old"
    admin = psycopg2.connect(url, connect_timeout=20)
    admin.autocommit = True
    acur = admin.cursor()
    made = []
    code = 0
    try:
        acur.execute(f'CREATE DATABASE "{old}"')
        made.append(old)
        print(f"created  {old}")
        conn = connect(url, old)
        cur = conn.cursor()
        build_old(cur)
        ids_old, director = generate(cur)
        cur.execute("SET ROLE prep_app_owner") if False else None
        old_writes = time_writes(cur, args.repeat)
        print(f"old-writer timings taken on {old} (through 025); now applying 026..{args.through} to the same database")
        for f in ins.migration_files(None):
            if "026" <= f.name[:3] <= args.through:
                t0 = time.perf_counter()
                run_file(cur, f"{f.name} ({time.perf_counter() - t0:.1f}s)", f.read_text(encoding="utf-8"))
        cur.execute("SET search_path = app, public")
        cur.execute("UPDATE offering_activities oa SET delivery = CASE a.modality WHEN 'written' THEN 'typed_response' ELSE 'interactive_tutor' END, "
                    "grading = CASE a.modality WHEN 'written' THEN 'human_graded' ELSE 'effort' END, "
                    "warn_earns_full = (a.modality = 'written') FROM activities a WHERE a.id = oa.activity_id AND oa.delivery IS NULL")
        print(f"ok       path backfill wrote {cur.rowcount} rows")
        cur.execute("ANALYZE")
        cur.execute("SELECT id, course_id FROM app.course_offerings")
        cur.execute("SELECT c.code, co.id FROM app.course_offerings co JOIN app.courses c ON c.id = co.course_id")
        ids = {c: str(i) for c, i in cur.fetchall()}
        results = time_functions(cur, ids, director, args.repeat)
        new_writes = time_writes(cur, args.repeat)
        print(f"\n{'old-writer statement':44}{'old ms':>9}{'new ms':>9}{'ratio':>8}   triggers on the new side (ms, calls)")
        for label, _ in WRITES:
            o, n = old_writes[label][0], new_writes[label][0]
            trig = "; ".join(f"{k} {v[0]:.2f}/{v[1]}" for k, v in sorted(new_writes[label][1].items(), key=lambda kv: -kv[1][0])[:4])
            print(f"{label:44}{o:>9.2f}{n:>9.2f}{(n / o if o else 0):>8.2f}   {trig}")
        slow = max(results, key=lambda r: r[4])
        print(f"\nEXPLAIN (ANALYZE, BUFFERS) of the slowest: {slow[0]} on {slow[1]} ({slow[3]} rows)")
        _, _, text = explain(cur, slow[6], (slow[2],), buffers=True)
        print(text)
        conn.close()
    except SystemExit as exc:
        code = int(exc.code or 1)
    finally:
        for name in made:
            if args.keep:
                print(f"kept     {name}")
            elif sbc.drop_database(acur, name):
                print(f"dropped  {name}")
            else:
                print(f"WARNING  could not drop {name}; drop it by hand: DROP DATABASE \"{name}\";", file=sys.stderr)
                code = code or 1
        admin.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
