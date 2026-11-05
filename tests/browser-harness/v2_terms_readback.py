#!/usr/bin/env python
"""Set up, read back and clean up for the courses-and-terms walkthrough (v2-terms.mjs). STAGING only.

  reset                       Remove everything this walkthrough made (courses whose code starts `e30-`, their terms,
                              the one made-up cadet). Idempotent.
  ids                         Print the ids of the e30 course and its three offerings (a, b, c) as JSON.
  seed-source                 Fill offering A with made-up content: one section that meets on no day, one made-up cadet,
                              a published written item the cadet can see, an unpublished quiz with questions and checked
                              keys and a section date, an unpublished interactive tutor item, and a letter scale.
  fingerprint <offering>      Print a hash and row counts over EVERYTHING a rollover must not change on its source:
                              items, activities, paths, questions, keys, dates, scale, sections, and the work tables.
  read <offering>             Print one JSON object describing the offering's items as a rollover left them.
  finish                      Make A inactive and remove the cadet, so the staging seed's counts stay what they were.
                              The course, its terms and its three offerings are KEPT as the worked example.

It reads STAGING_DB_URL and refuses anything but the staging project. Every name here is invented.
"""
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
sys.path.insert(0, str(HERE.parent.parent / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402

NS = uuid.UUID("c1d9e0a2-7b34-4c58-8f10-5d6e7a8b9c01")
COURSE = "e30-lab"
TERMS = ("e30-term-a", "e30-term-b", "e30-term-c")
CADET = 3000000451


def connect(readonly=False):
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    if readonly:
        conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    return conn, cur


def offerings(cur):
    cur.execute("""SELECT t.code, co.id FROM course_offerings co JOIN courses c ON c.id = co.course_id
                     JOIN terms t ON t.id = co.term_id WHERE c.code = %s""", (COURSE,))
    got = {code: str(i) for code, i in cur.fetchall()}
    return {k: got.get(t) for k, t in zip("abc", TERMS)}


def reset():
    conn, cur = connect()
    cur.execute("SELECT id FROM courses WHERE code LIKE 'e30-%'")
    courses = [r[0] for r in cur.fetchall()]
    for c in courses:
        cur.execute("""DELETE FROM grades WHERE assignment_offering_id IN
                         (SELECT ao.id FROM assignment_offerings ao JOIN course_offerings co ON co.id = ao.course_offering_id
                           WHERE co.course_id = %s)""", (c,))
        cur.execute("""DELETE FROM submissions WHERE assignment_offering_id IN
                         (SELECT ao.id FROM assignment_offerings ao JOIN course_offerings co ON co.id = ao.course_offering_id
                           WHERE co.course_id = %s)""", (c,))
        cur.execute("""DELETE FROM assignment_offerings WHERE course_offering_id IN
                         (SELECT id FROM course_offerings WHERE course_id = %s)""", (c,))
        cur.execute("DELETE FROM courses WHERE id = %s", (c,))     # cascades offerings, sections, enrollments, assignments
    cur.execute("DELETE FROM enrollments WHERE student_id = %s", (CADET,))
    cur.execute("SELECT auth_user_id FROM students WHERE student_id = %s", (CADET,))
    row = cur.fetchone()
    cur.execute("DELETE FROM students WHERE student_id = %s", (CADET,))
    if row and row[0]:
        cur.execute("DELETE FROM auth.identities WHERE user_id = %s", (row[0],))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (row[0],))
    cur.execute("DELETE FROM terms WHERE code LIKE 'e30-%'")
    conn.commit()
    print(json.dumps({"removed_courses": len(courses)}))


def ids():
    conn, cur = connect(readonly=True)
    print(json.dumps(offerings(cur)))


def seed_source():
    from v2_gate_lib import Builder, days
    conn, cur = connect()
    off = offerings(cur)["a"]
    if not off:
        sys.exit("Offering A does not exist. The walkthrough creates it through the page first.")
    cur.execute("SELECT course_id FROM course_offerings WHERE id = %s", (off,))
    course = cur.fetchone()[0]
    b = Builder(cur, NS)
    sec = b.section(off, "S1", [])
    b.cadet(CADET, "Made-up Cadet", sec, password="000451")
    cur.execute("SELECT id FROM instructors WHERE name = 'Rowan Gatedirector'")
    director = (cur.fetchone() or [None])[0]

    # 1. a written item the cadet can see: entered on the older page, published, due in three days
    w = b.item(course, off, "e30-written", "E30 written", 2, kind="preflight", paths=[{"modality": "written"}],
               due=days(3), published=False)
    cur.execute("UPDATE assignment_offerings SET position = 1 WHERE id = %s", (w["ao"],))
    b.publish(w)

    # 2. a quiz entered on the newer page: questions, checked keys, a fixed date and a section date
    fixed = datetime(2026, 12, 11, 6, 59, 59, tzinfo=timezone.utc)       # 10 Dec 2026, 23:59:59 Mountain
    q = b.item(course, off, "e30-quiz", "E30 quiz", 4, kind="quiz", published=False, entered_on_new_page=True,
               paths=[{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}],
               due=fixed, due_by_day={}, late_allowed=True, prog_included=True)
    cur.execute("UPDATE assignment_offerings SET position = 2 WHERE id = %s", (q["ao"],))
    b.question(q, "Q1", "numeric", 2, n=0, prompt="Made-up number question.",
               key=[{"value": 9.8, "tol_abs": 0.1, "unit": "m/s", "unit_mode": "ignore", "checked_by": director,
                     "checked_at": datetime.now(timezone.utc)}])
    b.question(q, "Q2", "multiple_choice", 2, n=1, prompt="Made-up choice question.",
               choices=[{"id": "a", "text": "One"}, {"id": "b", "text": "Two"}],
               key=[{"correct_choice_ids": ["b"], "checked_by": director, "checked_at": datetime.now(timezone.utc)}])
    cur.execute("INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at) VALUES (%s, %s, %s) "
                "ON CONFLICT DO NOTHING", (q["ao"], sec, fixed))

    # 3. an interactive tutor item on the older page, unpublished, with a link
    t = b.item(course, off, "e30-tutor", "E30 tutor", 2, kind="preflight", published=False,
               paths=[{"modality": "interactive", "content": {"artifact_url": "https://example.invalid/tutor"}}])
    cur.execute("UPDATE assignment_offerings SET position = 3 WHERE id = %s", (t["ao"],))
    cur.execute("UPDATE activities SET slug = 'e30-tutor-a3f9c1e2' WHERE id = %s", (t["activities"][0],))

    # 4. a letter scale
    cur.execute("SELECT lines, near_line_width FROM default_letter_scale()")
    lines, width = cur.fetchone()
    cur.execute("SELECT 1 FROM letter_scales WHERE course_offering_id = %s", (off,))
    if not cur.fetchone():
        cur.execute("INSERT INTO letter_scales (course_offering_id, version, lines, near_line_width) VALUES (%s, 1, %s, %s)",
                    (off, json.dumps(lines) if not isinstance(lines, str) else lines, width))
    conn.commit()
    print(json.dumps({"offering": off, "items": 3}))


FP_TABLES = [
    ("assignment_offerings", "SELECT {c} FROM assignment_offerings x WHERE x.course_offering_id = %(o)s"),
    ("assignments", "SELECT {c} FROM assignments x WHERE x.id IN (SELECT assignment_id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("activities", "SELECT {c} FROM activities x WHERE x.assignment_id IN (SELECT assignment_id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("offering_activities", "SELECT {c} FROM offering_activities x WHERE x.assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("assignment_due_dates", "SELECT {c} FROM assignment_due_dates x WHERE x.assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("questions", "SELECT {c} FROM questions x WHERE x.activity_id IN (SELECT a.id FROM activities a JOIN assignment_offerings ao ON ao.assignment_id = a.assignment_id WHERE ao.course_offering_id = %(o)s)"),
    ("question_keys", "SELECT {c} FROM question_keys x WHERE x.question_id IN (SELECT q.id FROM questions q JOIN activities a ON a.id = q.activity_id JOIN assignment_offerings ao ON ao.assignment_id = a.assignment_id WHERE ao.course_offering_id = %(o)s)"),
    ("letter_scales", "SELECT {c} FROM letter_scales x WHERE x.course_offering_id = %(o)s"),
    ("sections", "SELECT {c} FROM sections x WHERE x.course_offering_id = %(o)s"),
    ("enrollments", "SELECT {c} FROM enrollments x WHERE x.section_id IN (SELECT id FROM sections WHERE course_offering_id = %(o)s)"),
    ("submissions", "SELECT {c} FROM submissions x WHERE x.assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("grades", "SELECT {c} FROM grades x WHERE x.assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)"),
    ("staff_assignments", "SELECT {c} FROM staff_assignments x WHERE x.course_offering_id = %(o)s"),
    ("course_offerings", "SELECT {c} FROM course_offerings x WHERE x.id = %(o)s"),
]


def fingerprint(offering):
    """Every column of every row, ordered, hashed. updated_at is included: a touched row changes the hash."""
    conn, cur = connect(readonly=True)
    h = hashlib.sha256()
    counts = {}
    for table, sql in FP_TABLES:
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = %s "
                    "ORDER BY ordinal_position", (table,))
        cols = [r[0] for r in cur.fetchall()]
        row = ", ".join(f"x.{c}::text" for c in cols)
        cur.execute(sql.format(c=row) + " ORDER BY 1", {"o": offering})
        rows = sorted(json.dumps(r) for r in cur.fetchall())
        counts[table] = len(rows)
        h.update(table.encode())
        for r in rows:
            h.update(r.encode())
    print(json.dumps({"hash": h.hexdigest(), "counts": counts}))


def ts(col):
    return f"to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"


def read(offering):
    conn, cur = connect(readonly=True)
    cur.execute(f"""SELECT ao.id, a.title, a.slug, a.kind_id, a.course_id, src.title, ao.is_published, ao.entered_on_new_page,
                           ao.points_possible::text, ao.late_allowed, ao.prog_included, ao.position, {ts('ao.due_at')},
                           ao.due_by_day, {ts('ao.opens_at')}, ao.content_snapshot IS NOT NULL
                      FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id
                      LEFT JOIN assignments src ON src.id = a.origin_assignment_id
                     WHERE ao.course_offering_id = %s ORDER BY ao.position, a.title""", (offering,))
    items = {}
    for r in cur.fetchall():
        items[r[1]] = {"ao": str(r[0]), "slug": r[2], "kind": r[3], "origin_title": r[5], "published": r[6],
                       "new_page": r[7], "points": r[8], "late": r[9], "prog": r[10], "position": r[11],
                       "due_at": r[12], "due_by_day": r[13], "opens_at": r[14], "snapshot": r[15],
                       "paths": [], "questions": [], "section_rows": {}, "question_ids": []}
    by_ao = {v["ao"]: v for v in items.values()}
    if by_ao:
        ids = list(by_ao)
        cur.execute("""SELECT oa.assignment_offering_id, x.modality, x.slug, oa.delivery, oa.grading, x.content->>'artifact_url'
                         FROM offering_activities oa JOIN activities x ON x.id = oa.activity_id
                        WHERE oa.assignment_offering_id = ANY(%s::uuid[])""", (ids,))
        for ao, m, slug, d, g, url in cur.fetchall():
            by_ao[str(ao)]["paths"].append({"modality": m, "slug": slug, "delivery": d, "grading": g, "url": url})
        cur.execute("""SELECT ao.id, q.id, q.qid, q.points::text, k.version, k.checked_by IS NOT NULL, k.superseded_at IS NOT NULL, k.value::text
                         FROM assignment_offerings ao JOIN activities a ON a.assignment_id = ao.assignment_id
                         JOIN questions q ON q.activity_id = a.id LEFT JOIN question_keys k ON k.question_id = q.id
                        WHERE ao.id = ANY(%s::uuid[]) ORDER BY q.qid""", (ids,))
        for ao, qid_, qid, pts, ver, checked, sup, val in cur.fetchall():
            by_ao[str(ao)]["questions"].append({"qid": qid, "points": pts, "key_version": ver, "key_checked": checked,
                                                "key_superseded": sup, "value": val})
            by_ao[str(ao)]["question_ids"].append(str(qid_))
        cur.execute(f"""SELECT d.assignment_offering_id, s.code, {ts('d.due_at')} FROM assignment_due_dates d
                          JOIN sections s ON s.id = d.section_id WHERE d.assignment_offering_id = ANY(%s::uuid[])""", (ids,))
        for ao, code, due in cur.fetchall():
            by_ao[str(ao)]["section_rows"][code] = due
    cur.execute("SELECT count(*), coalesce(max(version), 0) FROM letter_scales WHERE course_offering_id = %s AND retired_at IS NULL", (offering,))
    scale = cur.fetchone()
    cur.execute("""SELECT (SELECT count(*) FROM sections WHERE course_offering_id = %(o)s),
                          (SELECT count(*) FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE s.course_offering_id = %(o)s),
                          (SELECT count(*) FROM submissions WHERE assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)),
                          (SELECT count(*) FROM grades WHERE assignment_offering_id IN (SELECT id FROM assignment_offerings WHERE course_offering_id = %(o)s)),
                          (SELECT is_active FROM course_offerings WHERE id = %(o)s)""", {"o": offering})
    sec, enr, sub, gra, active = cur.fetchone()
    print(json.dumps({"items": items, "scale_rows": scale[0], "scale_version": scale[1], "sections": sec, "enrollments": enr,
                      "submissions": sub, "grades": gra, "active": active}))


def finish():
    conn, cur = connect()
    off = offerings(cur)
    if off["a"]:
        cur.execute("UPDATE course_offerings SET is_active = false WHERE id = %s", (off["a"],))
    cur.execute("DELETE FROM enrollments WHERE student_id = %s", (CADET,))
    cur.execute("SELECT auth_user_id FROM students WHERE student_id = %s", (CADET,))
    row = cur.fetchone()
    cur.execute("DELETE FROM students WHERE student_id = %s", (CADET,))
    if row and row[0]:
        cur.execute("DELETE FROM auth.identities WHERE user_id = %s", (row[0],))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (row[0],))
    conn.commit()
    print(json.dumps({"a_inactive": True}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "reset":
        reset()
    elif cmd == "ids":
        ids()
    elif cmd == "seed-source":
        seed_source()
    elif cmd == "fingerprint" and len(sys.argv) == 3:
        fingerprint(sys.argv[2])
    elif cmd == "read" and len(sys.argv) == 3:
        read(sys.argv[2])
    elif cmd == "finish":
        finish()
    else:
        sys.exit(__doc__)
