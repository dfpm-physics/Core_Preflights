#!/usr/bin/env python
"""Prove schema `app` RLS actually ENFORCES, by acting as real personas.

Every agent tier holds BYPASSRLS (a direct Postgres connection carries no JWT, so RLS would
otherwise deny every row). That makes them useless for testing enforcement. This script
instead builds a fixture as the owner, then SET ROLEs to `authenticated` — which has no
BYPASSRLS — with a simulated JWT claim per persona, so the policies are genuinely applied.
Everything is rolled back.

PREREQUISITE — one grant, run once as `postgres` in the SQL Editor:

    GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;

`authenticated` is a LOW-privilege role, so this lets the owner drop DOWN to it for testing;
it is not an escalation. INHERIT FALSE means the owner gains none of its privileges
implicitly — only the ability to switch. The script tells you if the grant is missing.

Personas exercised:
    student_a   enrolled in section 1
    student_b   enrolled in section 2   (the "other student" every leak test aims at)
    teacher     staffs section 1 only
    director    directs the whole course offering

Usage:
  .venv/Scripts/python supabase/admin/app_rls_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_tier_check import load, connect  # noqa: E402

PASS, FAIL = "  [pass]", "  [FAIL]"
results = []


def check(desc, ok, detail=""):
    results.append(ok)
    print(f"{PASS if ok else FAIL} {desc}" + (f" — {detail}" if detail and not ok else ""))


class Persona:
    def __init__(self, cur, uid, label):
        self.cur, self.uid, self.label = cur, uid, label

    def __enter__(self):
        self.cur.execute("RESET ROLE")
        self.cur.execute("SELECT set_config('request.jwt.claims', %s, true)",
                         ('{"sub":"%s","role":"authenticated"}' % self.uid,))
        self.cur.execute("SET ROLE authenticated")
        print(f"\n--- as {self.label} ---")
        return self

    def __exit__(self, *a):
        self.cur.execute("RESET ROLE")
        return False

    def count(self, sql, params=None):
        self.cur.execute("SAVEPOINT p")
        try:
            self.cur.execute(sql, params or ())
            n = self.cur.fetchone()[0]
            self.cur.execute("RELEASE SAVEPOINT p")
            return n
        except Exception:
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            return -1

    def denied(self, desc, sql, params=None):
        self.cur.execute("SAVEPOINT p")
        try:
            self.cur.execute(sql, params or ())
            rc = self.cur.rowcount
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            # RLS silently filters UPDATE/DELETE to zero rows rather than raising.
            check(desc, rc == 0, f"affected {rc} row(s)")
        except Exception:
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            check(desc, True)


def main():
    cfg, tiers = load()
    conn = connect(cfg, tiers["owner"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    try:
        cur.execute("SET ROLE authenticated")
        cur.execute("RESET ROLE")
    except Exception as e:
        conn.rollback()
        print("Cannot SET ROLE authenticated — RLS enforcement cannot be tested.\n")
        print("  Run this once as postgres in the SQL Editor, then re-run:\n")
        print("    GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;\n")
        print(f"  ({str(e).strip().splitlines()[0]})")
        sys.exit(2)

    print("Building fixture as owner (rolled back at the end)...")

    cur.execute("INSERT INTO courses (code,title) VALUES ('__r-215','RLS 215') RETURNING id")
    course = cur.fetchone()[0]
    cur.execute("INSERT INTO terms (code,label) VALUES ('__r-f26','RLS Fall') RETURNING id")
    term = cur.fetchone()[0]
    cur.execute("INSERT INTO course_offerings (course_id,term_id) VALUES (%s,%s) RETURNING id",
                (course, term))
    co = cur.fetchone()[0]
    cur.execute("INSERT INTO sections (course_offering_id,code) VALUES (%s,'M1A') RETURNING id", (co,))
    sec1 = cur.fetchone()[0]
    cur.execute("INSERT INTO sections (course_offering_id,code) VALUES (%s,'T3B') RETURNING id", (co,))
    sec2 = cur.fetchone()[0]

    uids = {}
    for key in ("student_a", "student_b", "teacher", "director"):
        cur.execute("SELECT gen_random_uuid()")
        uids[key] = cur.fetchone()[0]

    cur.execute("INSERT INTO students (student_id,name,auth_user_id) VALUES (3000000101,'A',%s)",
                (uids["student_a"],))
    cur.execute("INSERT INTO students (student_id,name,auth_user_id) VALUES (3000000102,'B',%s)",
                (uids["student_b"],))
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000101,%s) RETURNING id",
                (sec1,))
    enr_a = cur.fetchone()[0]
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000102,%s) RETURNING id",
                (sec2,))
    enr_b = cur.fetchone()[0]

    cur.execute("INSERT INTO instructors (id,name) VALUES (%s,'Teacher')", (uids["teacher"],))
    cur.execute("INSERT INTO instructors (id,name) VALUES (%s,'Director')", (uids["director"],))
    cur.execute("""INSERT INTO staff_assignments (instructor_id,course_offering_id,section_id,role)
                   VALUES (%s,%s,%s,'instructor')""", (uids["teacher"], co, sec1))
    cur.execute("""INSERT INTO staff_assignments (instructor_id,course_offering_id,section_id,role)
                   VALUES (%s,%s,NULL,'director')""", (uids["director"], co))

    cur.execute("""INSERT INTO assignments (course_id,kind_id,slug,title)
                   VALUES (%s,'preflight','__r-p02','RLS Preflight') RETURNING id""", (course,))
    asg = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'written','__r-w02') RETURNING id", (asg,))
    act = cur.fetchone()[0]
    cur.execute("""INSERT INTO assignment_offerings (course_offering_id,assignment_id,is_published)
                   VALUES (%s,%s,true) RETURNING id""", (co, asg))
    ao = cur.fetchone()[0]
    cur.execute("INSERT INTO offering_activities (assignment_offering_id,activity_id) VALUES (%s,%s)",
                (ao, act))

    for enr in (enr_a, enr_b):
        cur.execute("""INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                                chosen_activity_id,status)
                       VALUES (%s,%s,%s,'draft')""", (enr, ao, act))
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,points_possible,
                                       effort,is_finalized)
                   VALUES (%s,%s,2,4,true)""", (enr_a, ao))
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,points_possible,
                                       effort,is_finalized)
                   VALUES (%s,%s,2,4,false)""", (enr_b, ao))

    # ---------------- student A ----------------
    with Persona(cur, uids["student_a"], "student A (section M1A)") as p:
        check("sees exactly 1 student row (their own)", p.count("SELECT count(*) FROM students") == 1)
        check("sees exactly 1 enrolment (their own)", p.count("SELECT count(*) FROM enrollments") == 1)
        check("sees exactly 1 submission (their own)",
              p.count("SELECT count(*) FROM submissions") == 1)
        check("sees their own finalized grade",
              p.count("SELECT count(*) FROM grades") == 1)
        check("sees the published assignment offering",
              p.count("SELECT count(*) FROM assignment_offerings") == 1)
        p.denied("CANNOT delete another student",
                 "DELETE FROM students WHERE student_id=3000000102")
        p.denied("CANNOT delete any student at all",
                 "DELETE FROM students")
        p.denied("CANNOT overwrite another student's submission",
                 "UPDATE submissions SET status='committed' WHERE enrollment_id=%s", (enr_b,))
        p.denied("CANNOT insert a submission against another student's enrolment",
                 """INSERT INTO submissions (enrollment_id,assignment_offering_id,status)
                    VALUES (%s,%s,'draft')""", (enr_b, ao))
        p.denied("CANNOT write their own grade",
                 "UPDATE grades SET points_earned=2 WHERE enrollment_id=%s", (enr_a,))
        check("sees no grade_events", p.count("SELECT count(*) FROM grade_events") == 0)

    # ---------------- student B ----------------
    with Persona(cur, uids["student_b"], "student B (grade not finalized)") as p:
        check("sees 1 student row (their own)", p.count("SELECT count(*) FROM students") == 1)
        check("CANNOT see their own UNfinalized grade",
              p.count("SELECT count(*) FROM grades") == 0)

    # ---------------- teacher ----------------
    with Persona(cur, uids["teacher"], "teacher (staffs M1A only)") as p:
        check("sees only the 1 student in their section",
              p.count("SELECT count(*) FROM students") == 1)
        check("sees only their section's submission",
              p.count("SELECT count(*) FROM submissions") == 1)
        check("sees their section's grade regardless of finalization",
              p.count("SELECT count(*) FROM grades") == 1)
        p.denied("CANNOT grade a student in a section they do not staff",
                 "UPDATE grades SET effort=5 WHERE enrollment_id=%s", (enr_b,))
        p.denied("CANNOT create a roster entry",
                 "INSERT INTO students (student_id,name) VALUES (3000000199,'Sneak')")

    # ---------------- director ----------------
    with Persona(cur, uids["director"], "director (whole offering)") as p:
        check("sees both students", p.count("SELECT count(*) FROM students") == 2)
        check("sees both submissions", p.count("SELECT count(*) FROM submissions") == 2)
        check("sees both grades", p.count("SELECT count(*) FROM grades") == 2)
        cur.execute("SAVEPOINT d")
        try:
            cur.execute("INSERT INTO students (student_id,name) VALUES (3000000199,'New Cadet')")
            check("CAN create a roster entry", True)
        except Exception as e:
            check("CAN create a roster entry", False, str(e).strip().splitlines()[0])
        cur.execute("ROLLBACK TO SAVEPOINT d")

    cur.execute("RESET ROLE")
    conn.rollback()
    cur.execute("SELECT count(*) FROM app.courses WHERE code='__r-215'")
    check("fixture fully rolled back — nothing persisted", cur.fetchone()[0] == 0)

    cur.close()
    conn.close()
    ok = all(results)
    print("\n" + (f"All {len(results)} RLS enforcement checks passed." if ok else
                  "SOME RLS CHECKS FAILED — do not point the app at this schema yet."))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
