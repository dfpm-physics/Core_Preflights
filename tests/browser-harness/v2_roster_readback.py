#!/usr/bin/env python
"""Set up, read back and clean up for the roster-import walkthrough (v2-roster.mjs). STAGING only.

  reset                Remove everything this walkthrough made: its invented cadets (ids 3000000801 to 3000000899),
                       their accounts, work and enrollments, the empty sections it created, and the import log rows of
                       the two e30-lab offerings it uses. Idempotent. Never touches another course.
  setup-fall           Put invented cadet 3000000801 into the EARLIER e30-lab term (A) with one submission and one
                       grade, so the file imported into the LATER term (B) names a cadet who already exists.
  add-work <cadet>     Give that cadet one submission and one grade in term B (so a departure has work to keep).
  fingerprint          Hash of term A: sections, enrollments, submissions, grades, the cadet rows enrolled in it.
  state                JSON of term B: sections, enrollments (cadet, section, status), account flags, import-log rows,
                       counts of work, and where each walkthrough cadet is enrolled.

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

NS = uuid.UUID("5a1e9c34-2d7b-4f60-9b1a-3c8d0e6f7a22")
COURSE, TERM_A, TERM_B = "e30-lab", "e30-term-a", "e30-term-b"
LOW, HIGH = 3000000801, 3000000899
FALL_CADET = 3000000801
FALL_SECTION = "RF1"


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


def offering(cur, term, required=True):
    cur.execute("""SELECT co.id FROM course_offerings co JOIN courses c ON c.id = co.course_id
                     JOIN terms t ON t.id = co.term_id WHERE c.code = %s AND t.code = %s""", (COURSE, term))
    r = cur.fetchone()
    if not r:
        if not required:
            return None
        sys.exit(f"Offering {COURSE} / {term} does not exist. Run v2-terms.mjs first, or create it on the Courses and terms page.")
    return str(r[0])


def reset():
    conn, cur = connect()
    cur.execute("SELECT auth_user_id FROM students WHERE student_id BETWEEN %s AND %s", (LOW, HIGH))
    uids = [r[0] for r in cur.fetchall() if r[0]]
    cur.execute("DELETE FROM grades WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id BETWEEN %s AND %s)", (LOW, HIGH))
    cur.execute("DELETE FROM submissions WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id BETWEEN %s AND %s)", (LOW, HIGH))
    cur.execute("DELETE FROM assignment_offerings WHERE assignment_id IN (SELECT id FROM assignments WHERE slug = 'roster-demo-item')")
    cur.execute("DELETE FROM assignments WHERE slug = 'roster-demo-item'")
    cur.execute("DELETE FROM enrollments WHERE student_id BETWEEN %s AND %s", (LOW, HIGH))
    for term in (TERM_A, TERM_B):
        co = offering(cur, term, required=False)
        if not co:
            continue
        # only sections this walkthrough could have made: ones nobody is enrolled in and no staff row names
        cur.execute("""DELETE FROM sections s WHERE s.course_offering_id = %s
                          AND s.code IN ('LAB-1', 'LAB-2', 'W2C', 'RF1')
                          AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.section_id = s.id)
                          AND NOT EXISTS (SELECT 1 FROM staff_assignments sa WHERE sa.section_id = s.id)""", (co,))
        cur.execute("DELETE FROM roster_imports WHERE course_offering_id = %s", (co,))
    cur.execute("DELETE FROM students WHERE student_id BETWEEN %s AND %s", (LOW, HIGH))
    for u in uids:
        cur.execute("DELETE FROM auth.identities WHERE user_id = %s", (u,))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (u,))
    conn.commit()
    print(json.dumps({"removed_accounts": len(uids)}))


def _item(b, cur, co):
    cur.execute("SELECT id FROM courses WHERE code = %s", (COURSE,))
    course = cur.fetchone()[0]
    return b.item(course, co, "roster-demo-item", "Roster demo item", 2, kind="homework",
                  paths=[{"modality": "written"}], published=False)


def setup_fall():
    from v2_gate_lib import Builder
    conn, cur = connect()
    a = offering(cur, TERM_A)
    b = Builder(cur, NS)
    sec = b.section(a, FALL_SECTION, [])
    enr, uid = b.cadet(FALL_CADET, "Ada Q. Rosterone", sec, password="000801")
    # the same email the file will carry, so the account is the one that already exists
    cur.execute("UPDATE students SET email = 'rf0801@prep-staging.example', squadron = 'CS01' WHERE student_id = %s", (FALL_CADET,))
    item = _item(b, cur, a)
    sub = b.work(enr, item, "committed", datetime.now(timezone.utc))
    b.grade(enr, item, 2, submission=sub)
    conn.commit()
    print(json.dumps({"cadet_enrolled_in_a": True}))


def add_work(cadet):
    from v2_gate_lib import Builder
    conn, cur = connect()
    bo = offering(cur, TERM_B)
    b = Builder(cur, NS)
    cur.execute("""SELECT e.id FROM enrollments e JOIN sections s ON s.id = e.section_id
                    WHERE e.student_id = %s AND s.course_offering_id = %s""", (int(cadet), bo))
    enr = cur.fetchone()[0]
    item = _item(b, cur, bo)
    sub = b.work(enr, item, "committed", datetime.now(timezone.utc))
    b.grade(enr, item, 1, submission=sub)
    conn.commit()
    print(json.dumps({"work_added": True}))


def fingerprint():
    conn, cur = connect(readonly=True)
    a = offering(cur, TERM_A)
    h = hashlib.sha256()
    counts = {}
    enr_a = ("SELECT e.id FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE s.course_offering_id = %(o)s")
    for table, sql in [
        ("sections", "SELECT {c} FROM sections x WHERE x.course_offering_id = %(o)s"),
        ("enrollments", "SELECT {c} FROM enrollments x WHERE x.section_id IN (SELECT id FROM sections WHERE course_offering_id = %(o)s)"),
        ("students", "SELECT {c} FROM students x WHERE x.student_id IN (SELECT e.student_id FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE s.course_offering_id = %(o)s)"),
        ("submissions", f"SELECT {{c}} FROM submissions x WHERE x.enrollment_id IN ({enr_a})"),
        ("grades", f"SELECT {{c}} FROM grades x WHERE x.enrollment_id IN ({enr_a})"),
        ("course_offerings", "SELECT {c} FROM course_offerings x WHERE x.id = %(o)s"),
    ]:
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = %s "
                    "ORDER BY ordinal_position", (table,))
        cols = [r[0] for r in cur.fetchall()]
        row = ", ".join(f"x.{c}::text" for c in cols)
        cur.execute(sql.format(c=row) + " ORDER BY 1", {"o": a})
        rows = sorted(json.dumps(r) for r in cur.fetchall())
        counts[table] = len(rows)
        h.update(table.encode())
        for r in rows:
            h.update(r.encode())
    print(json.dumps({"hash": h.hexdigest(), "counts": counts}))


def state():
    conn, cur = connect(readonly=True)
    bo, ao = offering(cur, TERM_B), offering(cur, TERM_A)
    out = {}
    cur.execute("SELECT code, meeting_days, period FROM sections WHERE course_offering_id = %s ORDER BY code", (bo,))
    out["sections"] = {r[0]: {"days": r[1], "period": r[2]} for r in cur.fetchall()}
    cur.execute("""SELECT e.student_id, s.code, e.status, e.dropped_at IS NOT NULL FROM enrollments e JOIN sections s ON s.id = e.section_id
                    WHERE s.course_offering_id = %s ORDER BY 1""", (bo,))
    out["enrollments"] = {str(r[0]): {"section": r[1], "status": r[2], "dropped_at": r[3]} for r in cur.fetchall()}
    cur.execute("SELECT count(*) FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE s.course_offering_id = %s", (bo,))
    out["enrollment_rows_b"] = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE s.course_offering_id = %s", (ao,))
    out["enrollment_rows_a"] = cur.fetchone()[0]
    cur.execute("SELECT student_id, auth_user_id IS NOT NULL, squadron FROM students WHERE student_id BETWEEN %s AND %s ORDER BY 1", (LOW, HIGH))
    out["students"] = {str(r[0]): {"account": r[1], "squadron": r[2]} for r in cur.fetchall()}
    cur.execute("SELECT auth_user_id FROM students WHERE student_id = %s", (FALL_CADET,))
    r = cur.fetchone()
    out["fall_cadet_uid_hash"] = hashlib.sha256(str(r[0]).encode()).hexdigest()[:12] if r and r[0] else None
    cur.execute("""SELECT e.student_id, count(*) FROM enrollments e WHERE e.student_id BETWEEN %s AND %s GROUP BY 1""", (LOW, HIGH))
    out["enrollments_per_cadet_all_terms"] = {str(r[0]): r[1] for r in cur.fetchall()}
    cur.execute("SELECT count(*) FROM roster_imports WHERE course_offering_id = %s", (bo,))
    out["import_log_rows"] = cur.fetchone()[0]
    cur.execute("""SELECT rows_in_file, rows_matched, students_created, enrollments_created, sections_created
                     FROM roster_imports WHERE course_offering_id = %s ORDER BY created_at""", (bo,))
    out["import_log"] = [list(r) for r in cur.fetchall()]
    cur.execute("SELECT count(*) FROM submissions s JOIN enrollments e ON e.id = s.enrollment_id WHERE e.student_id BETWEEN %s AND %s", (LOW, HIGH))
    out["submissions"] = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM grades g JOIN enrollments e ON e.id = g.enrollment_id WHERE e.student_id BETWEEN %s AND %s", (LOW, HIGH))
    out["grades"] = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM students WHERE student_id BETWEEN %s AND %s", (LOW, HIGH))
    out["student_rows"] = cur.fetchone()[0]
    print(json.dumps(out))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "reset":
        reset()
    elif cmd == "setup-fall":
        setup_fall()
    elif cmd == "add-work" and len(sys.argv) == 3:
        add_work(sys.argv[2])
    elif cmd == "fingerprint":
        fingerprint()
    elif cmd == "state":
        state()
    else:
        sys.exit(__doc__)
