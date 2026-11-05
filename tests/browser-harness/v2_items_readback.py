#!/usr/bin/env python
"""Set up, read back and clean up for the item entry walkthrough (v2-items-entry.mjs). STAGING only.

  setup           Make the second made-up course the walkthrough needs: course `items-nodays`, whose offering is
                  inactive and whose three sections meet on no day, and the gate director as its director. It has
                  no cadets, so the seeds' row counts do not move. Idempotent. Commits.
  read <offering-id> <title-prefix>
                  Print one JSON object: every item in that course offering whose title starts with the
                  prefix, with the rows the page wrote and what app.deadline_rows() says each section gets.
                  Read-only.
  seed-questions <offering-id>
                  Put two invented questions and their two answer keys under the item's questions path, so a removal
                  or a delivery switch has something to count. Commits.
  count-questions <offering-id>
                  Print the questions and key versions under the item's paths. Read-only.
  clean <title-prefix>
                  Delete the items the walkthrough made (offering first, then its assignment) in the gate
                  courses, but only unmarked-for-keeping rows whose title starts with the prefix, and only
                  when they hold no submission and no grade. Prints what it removed.

It reads STAGING_DB_URL and refuses anything but the staging project. Every name here is invented.
"""
import json
import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
sys.path.insert(0, str(HERE.parent.parent / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402

NS = uuid.UUID("5a1c7d34-6e0b-4f2a-9b8d-3c4e5f607182")
CODE = "items-nodays"
GATE_ENTRY = "gate-entry"


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


def setup():
    from v2_gate_lib import Builder
    conn, cur = connect()
    b = Builder(cur, NS)
    term = b.term()
    course = b.course(CODE, "Items entry, no meeting days (STAGING TEST)")
    co = b.offering(course, term, False)
    for code in ("N1", "N2", "N3"):
        b.section(co, code, [])
    # An earlier version of this script also made a cadet per section; the seed checks count cadets, so remove them.
    cur.execute("DELETE FROM enrollments WHERE student_id BETWEEN 3000000411 AND 3000000413")
    cur.execute("DELETE FROM students WHERE student_id BETWEEN 3000000411 AND 3000000413")
    cur.execute("SELECT i.id FROM instructors i JOIN auth.users u ON u.id = i.id WHERE u.email = %s",
                ("gatedirector@prep-staging.example",))
    director = cur.fetchone()
    if not director:
        sys.exit("The gate director does not exist. Run scripts/staging/seed_v2_gate.py --commit first.")
    b.assign(director[0], co, "director")
    conn.commit()
    print(json.dumps({"offering": co}))


def ts(col):
    return f"to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"


def read(offering, prefix):
    conn, cur = connect(readonly=True)
    cur.execute(f"""SELECT ao.id, a.title, a.kind_id, ao.entered_on_new_page, ao.is_published, ao.points_possible::text,
                           ao.late_allowed, ao.is_bonus, ao.prog_included, ao.position, {ts('ao.due_at')}, ao.due_by_day
                      FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id
                     WHERE ao.course_offering_id = %s AND a.title LIKE %s ORDER BY a.title""", (offering, prefix + "%"))
    items = {}
    for r in cur.fetchall():
        items[str(r[0])] = {"title": r[1], "kind": r[2], "new_page": r[3], "published": r[4], "points": r[5],
                            "late": r[6], "bonus": r[7], "prog": r[8], "position": r[9], "due_at": r[10],
                            "due_by_day": r[11], "paths": [], "section_rows": {}, "deadline_rows": {}}
    ids = list(items)
    if ids:
        cur.execute("""SELECT oa.assignment_offering_id, x.modality, oa.delivery, oa.grading, oa.grading_role, oa.warn_earns_full
                         FROM offering_activities oa JOIN activities x ON x.id = oa.activity_id
                        WHERE oa.assignment_offering_id = ANY(%s::uuid[])""", (ids,))
        for ao, m, d, g, role, warn in cur.fetchall():
            items[str(ao)]["paths"].append([m, d, g, role, warn])
        cur.execute(f"""SELECT d.assignment_offering_id, s.code, {ts('d.due_at')}
                          FROM assignment_due_dates d JOIN sections s ON s.id = d.section_id
                         WHERE d.assignment_offering_id = ANY(%s::uuid[])""", (ids,))
        for ao, code, due in cur.fetchall():
            items[str(ao)]["section_rows"][code] = due
        cur.execute(f"""SELECT r.assignment_offering_id, s.code, {ts('r.due_at')}, r.source
                          FROM deadline_rows(%s) r JOIN enrollments e ON e.id = r.enrollment_id
                          JOIN sections s ON s.id = e.section_id
                         WHERE r.assignment_offering_id = ANY(%s::uuid[])
                         GROUP BY 1, 2, 3, 4""", (offering, ids))
        for ao, code, due, source in cur.fetchall():
            items[str(ao)]["deadline_rows"].setdefault(code, []).append([due, source])
    # The same rule asked per section, which needs no cadet. The function answers only for a section the caller
    # sees, so ask as the gate director, who directs all three gate courses (a claim set for this transaction).
    cur.execute("SELECT u.id FROM auth.users u WHERE u.email = %s", ("gatedirector@prep-staging.example",))
    uid = cur.fetchone()[0]
    cur.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                (json.dumps({"sub": str(uid), "role": "authenticated"}), str(uid)))
    cur.execute(f"""SELECT x.id, s.code, {ts('d.due_at')}, d.source
                      FROM assignment_offerings x CROSS JOIN sections s
                      CROSS JOIN LATERAL scheduled_deadline(x.id, s.id) d
                     WHERE x.course_offering_id = %s AND s.course_offering_id = %s AND x.id = ANY(%s::uuid[])""",
                (offering, offering, ids or [str(uuid.uuid4())]))
    for ao, code, due, source in cur.fetchall():
        items[str(ao)].setdefault("scheduled", {})[code] = [due, source]
    cur.execute("SELECT is_active FROM course_offerings WHERE id = %s", (offering,))
    row = cur.fetchone()
    cur.execute("SELECT count(*) FROM sections WHERE course_offering_id = %s", (offering,))
    nsec = cur.fetchone()[0]
    print(json.dumps({"offering_active": row[0] if row else None, "sections": nsec, "items": items}))
    conn.rollback()


def seed_questions(offering):
    conn, cur = connect()
    cur.execute("""SELECT oa.activity_id FROM offering_activities oa JOIN activities x ON x.id = oa.activity_id
                    WHERE oa.assignment_offering_id = %s AND x.modality = 'questions'""", (offering,))
    row = cur.fetchone()
    if not row:
        sys.exit("that item has no questions path")
    for n in (1, 2):
        cur.execute("""INSERT INTO questions (activity_id, qid, position, format, prompt_md, points)
                       VALUES (%s, %s, %s, 'numeric', %s, 1) RETURNING id""", (row[0], f"h{n}", n, f"Invented question {n}"))
        qid = cur.fetchone()[0]
        cur.execute("""INSERT INTO question_keys (question_id, variant_key, version, select_rule, value, tol_abs, sig_fig_mode,
                                                  unit_mode, written_by)
                       VALUES (%s, '', 1, 'all_or_nothing', %s, 0.1, 'ignore', 'ignore', 'human')""", (qid, n))
    conn.commit()
    print(json.dumps({"activity": str(row[0])}))


def count_questions(offering):
    conn, cur = connect(readonly=True)
    cur.execute("""SELECT count(DISTINCT q.id), count(k.id)
                     FROM offering_activities oa JOIN questions q ON q.activity_id = oa.activity_id
                     LEFT JOIN question_keys k ON k.question_id = q.id
                    WHERE oa.assignment_offering_id = %s""", (offering,))
    q, k = cur.fetchone()
    print(json.dumps({"questions": q, "keys": k}))
    conn.rollback()


def clean(prefix):
    conn, cur = connect()
    cur.execute("""SELECT ao.id, ao.assignment_id, a.title
                     FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id
                     JOIN course_offerings co ON co.id = ao.course_offering_id
                     JOIN courses c ON c.id = co.course_id
                    WHERE c.code IN (%s, %s, %s) AND a.title LIKE %s AND ao.entered_on_new_page""",
                (GATE_ENTRY, CODE, "gate-vector", prefix + "%"))
    gone = []
    for ao, asg, title in cur.fetchall():
        cur.execute("SELECT (SELECT count(*) FROM submissions WHERE assignment_offering_id = %s) + "
                    "(SELECT count(*) FROM grades WHERE assignment_offering_id = %s)", (ao, ao))
        if cur.fetchone()[0]:
            print(f"kept (has work): {title}", file=sys.stderr)
            continue
        cur.execute("DELETE FROM assignment_offerings WHERE id = %s", (ao,))
        cur.execute("DELETE FROM assignments WHERE id = %s", (asg,))
        gone.append(title)
    conn.commit()
    print(json.dumps({"removed": gone}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup":
        setup()
    elif cmd == "read" and len(sys.argv) == 4:
        read(sys.argv[2], sys.argv[3])
    elif cmd == "seed-questions" and len(sys.argv) == 3:
        seed_questions(sys.argv[2])
    elif cmd == "count-questions" and len(sys.argv) == 3:
        count_questions(sys.argv[2])
    elif cmd == "clean" and len(sys.argv) == 3:
        clean(sys.argv[2])
    else:
        sys.exit(__doc__)
