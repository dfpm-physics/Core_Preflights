#!/usr/bin/env python
"""Prove schema `app` RLS and its trigger invariants actually ENFORCE, as real personas.

Every agent tier holds BYPASSRLS (a direct Postgres connection carries no JWT, so RLS would
otherwise deny every row). That makes them useless for testing enforcement. This script
instead builds a fixture as the owner, then SET ROLEs to `authenticated` — which has no
BYPASSRLS — with a simulated JWT claim per persona, so the policies genuinely apply.
Everything is rolled back.

PREREQUISITES
  1. The owner must be unsealed (app_schema_bootstrap.sql §7):
         ALTER ROLE prep_app_owner LOGIN;
  2. One grant, run once as `postgres` in the SQL Editor:
         GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;
     `authenticated` is a LOW-privilege role, so this lets the owner drop DOWN to it for
     testing; it is not an escalation. The script tells you if the grant is missing.

WHY THE PERSONAS USE REAL auth.users IDS
  bootstrap §6 added FKs from app.students.auth_user_id and app.instructors.id into
  auth.users. This suite originally invented uuids for its personas, which silently stopped
  working the moment those FKs landed — it failed at fixture build with a
  ForeignKeyViolation and had not run since. The app tier holds no privileges on schema
  `auth` and so cannot mint users, so personas now borrow ids that already exist:

    student_a  the deliberate test cadet 3009999999 ("ZZ Test Cadet"), enrolled into the
               fixture section for the duration of the test
    student_b  a fixture student with auth_user_id NULL — it never signs in, it only needs
               to EXIST as the row that must not leak
    teacher    a real non-admin instructor, staffed onto fixture section 1 only
    director   a different real non-admin instructor, offering-wide on the fixture offering

  Because teacher and director are real people with real assignments in the live Fall 2026
  offering, EVERY assertion is scoped to the fixture — otherwise their genuine access would
  be counted and the numbers would mean nothing. Global admins are deliberately not used as
  personas: is_admin() short-circuits almost every policy, so they prove nothing.

Usage:
  .venv/Scripts/python supabase/admin/app_rls_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_tier_check import load, connect  # noqa: E402

PASS, FAIL = "  [pass]", "  [FAIL]"
results = []

TEST_CADET = 3009999999


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
            # RLS silently filters UPDATE/DELETE to zero rows rather than raising;
            # a trigger raises. Either counts as denied.
            check(desc, rc == 0, f"affected {rc} row(s)")
        except Exception:
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            check(desc, True)

    def allowed(self, desc, sql, params=None):
        self.cur.execute("SAVEPOINT p")
        try:
            self.cur.execute(sql, params or ())
            rc = self.cur.rowcount
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            check(desc, rc > 0, "affected 0 rows (RLS filtered it out)")
        except Exception as e:
            self.cur.execute("ROLLBACK TO SAVEPOINT p")
            check(desc, False, str(e).strip().splitlines()[0])


def main():
    cfg, tiers = load()
    if "owner" not in tiers:
        sys.exit("No PREP_APP_OWNER_ROLE/_PASSWORD in supabase/admin/.env.")
    try:
        conn = connect(cfg, tiers["owner"])
    except Exception as e:  # noqa: BLE001
        print("Cannot connect as prep_app_owner — the role is sealed (bootstrap §7).")
        print("  Re-open it as postgres:  ALTER ROLE prep_app_owner LOGIN;")
        print(f"  ({str(e).strip().splitlines()[0]})")
        sys.exit(2)

    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    try:
        cur.execute("SET ROLE authenticated")
        cur.execute("RESET ROLE")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print("Cannot SET ROLE authenticated — RLS enforcement cannot be tested.\n")
        print("  Run this once as postgres in the SQL Editor, then re-run:\n")
        print("    GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;\n")
        print(f"  ({str(e).strip().splitlines()[0]})")
        sys.exit(2)

    # --- borrow real identities (see the module docstring) ----------------------------
    cur.execute("SELECT auth_user_id FROM students WHERE student_id = %s", (TEST_CADET,))
    row = cur.fetchone()
    if not row or not row[0]:
        conn.rollback()
        sys.exit(f"Test cadet {TEST_CADET} has no auth_user_id — cannot run student personas.")
    student_a_uid = row[0]

    # The teacher persona must direct NOTHING anywhere. is_admin() and director_offerings()
    # are global, not fixture-scoped, so borrowing a real person who directs a real offering
    # would silently hand the "teacher" director powers and make every negative assertion
    # vacuous. (This is the inherent cost of borrowing real auth.users ids; the fixture
    # itself is synthetic, but identity is not.)
    cur.execute("""SELECT i.id, i.name FROM instructors i
                    WHERE NOT i.is_global_admin
                      AND NOT EXISTS (SELECT 1 FROM staff_assignments sa
                                       WHERE sa.instructor_id = i.id AND sa.role = 'director')
                    ORDER BY i.name LIMIT 1""")
    row_t = cur.fetchone()
    if not row_t:
        conn.rollback()
        sys.exit("No non-admin instructor who directs nothing — cannot build a clean "
                 "'teacher' persona. Negative assertions would be meaningless.")
    teacher_uid, teacher_name = row_t

    cur.execute("""SELECT id, name FROM instructors
                    WHERE NOT is_global_admin AND id <> %s ORDER BY name LIMIT 1""", (teacher_uid,))
    row_d = cur.fetchone()
    if not row_d:
        conn.rollback()
        sys.exit("Need a second non-admin instructor for the director persona.")
    director_uid, director_name = row_d

    print("Building fixture as owner (rolled back at the end)...")
    print(f"  student_a = test cadet {TEST_CADET}")
    print(f"  teacher   = {teacher_name}")
    print(f"  director  = {director_name}")

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

    # student_b never signs in; auth_user_id NULL keeps the auth.users FK satisfied.
    cur.execute("""INSERT INTO students (student_id,name,auth_user_id)
                   VALUES (3000000102,'RLS Other',NULL)""")
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (%s,%s) RETURNING id",
                (TEST_CADET, sec1))
    enr_a = cur.fetchone()[0]
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000102,%s) RETURNING id",
                (sec2,))
    enr_b = cur.fetchone()[0]

    cur.execute("""INSERT INTO staff_assignments (instructor_id,course_offering_id,section_id,role)
                   VALUES (%s,%s,%s,'instructor')""", (teacher_uid, co, sec1))
    cur.execute("""INSERT INTO staff_assignments (instructor_id,course_offering_id,section_id,role)
                   VALUES (%s,%s,NULL,'director')""", (director_uid, co))

    cur.execute("""INSERT INTO assignments (course_id,kind_id,slug,title)
                   VALUES (%s,'preflight','__r-p02','RLS Preflight') RETURNING id""", (course,))
    asg = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'written','__r-w02') RETURNING id", (asg,))
    act_w = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'interactive','__r-i02') RETURNING id", (asg,))
    act_i = cur.fetchone()[0]
    cur.execute("""INSERT INTO assignment_offerings (course_offering_id,assignment_id,is_published,
                                                     switch_policy)
                   VALUES (%s,%s,true,'lock_on_commit') RETURNING id""", (co, asg))
    ao = cur.fetchone()[0]
    # Both graded => a genuine choice, so the LOCK is what refuses a switch, not the
    # gradable check. Testing them on one activity would only ever prove the first.
    cur.execute("INSERT INTO offering_activities (assignment_offering_id,activity_id,grading_role) "
                "VALUES (%s,%s,'graded')", (ao, act_w))
    cur.execute("INSERT INTO offering_activities (assignment_offering_id,activity_id,grading_role) "
                "VALUES (%s,%s,'graded')", (ao, act_i))

    cur.execute("""INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                            chosen_activity_id,status,committed_at)
                   VALUES (%s,%s,%s,'committed',now()) RETURNING id""", (enr_a, ao, act_w))
    sub_a = cur.fetchone()[0]
    cur.execute("""INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                            chosen_activity_id,status)
                   VALUES (%s,%s,%s,'draft') RETURNING id""", (enr_b, ao, act_w))
    sub_b = cur.fetchone()[0]
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,points_possible,
                                       effort,is_finalized)
                   VALUES (%s,%s,2,4,true)""", (enr_a, ao))
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,points_possible,
                                       effort,is_finalized)
                   VALUES (%s,%s,2,4,false)""", (enr_b, ao))

    # Fixture-scoped counters: real personas have real access elsewhere, so an unscoped
    # count would measure the live course rather than this test.
    IN_FIXTURE = "assignment_offering_id = %s"
    STU_IN_FIXTURE = """student_id IN (SELECT student_id FROM enrollments
                                        WHERE section_id IN (%s,%s))"""

    # ---------------- student A ----------------
    with Persona(cur, student_a_uid, f"student A (test cadet, section M1A)") as p:
        check("sees only their own student row in the fixture",
              p.count(f"SELECT count(*) FROM students WHERE {STU_IN_FIXTURE}", (sec1, sec2)) == 1)
        check("sees only their own fixture enrolment",
              p.count("SELECT count(*) FROM enrollments WHERE section_id IN (%s,%s)", (sec1, sec2)) == 1)
        check("sees only their own submission",
              p.count(f"SELECT count(*) FROM submissions WHERE {IN_FIXTURE}", (ao,)) == 1)
        check("sees their own finalized grade",
              p.count(f"SELECT count(*) FROM grades WHERE {IN_FIXTURE}", (ao,)) == 1)
        check("sees the published assignment offering",
              p.count("SELECT count(*) FROM assignment_offerings WHERE id=%s", (ao,)) == 1)
        p.denied("CANNOT delete another student",
                 "DELETE FROM students WHERE student_id=3000000102")
        p.denied("CANNOT overwrite another student's submission",
                 "UPDATE submissions SET status='committed' WHERE id=%s", (sub_b,))
        p.denied("CANNOT insert a submission against another student's enrolment",
                 """INSERT INTO submissions (enrollment_id,assignment_offering_id,status)
                    VALUES (%s,%s,'draft')""", (enr_b, ao))
        p.denied("CANNOT write their own grade",
                 "UPDATE grades SET points_earned=2 WHERE enrollment_id=%s", (enr_a,))
        check("sees no grade_events", p.count("SELECT count(*) FROM grade_events") == 0)

        # --- migration 006: the lock, and the two ways round it that used to work ---
        p.denied("CANNOT switch activity after committing (lock_on_commit)",
                 "UPDATE submissions SET chosen_activity_id=%s WHERE id=%s", (act_i, sub_a))
        p.denied("CANNOT unlock their own submission anonymously",
                 "UPDATE submissions SET chosen_activity_id=NULL WHERE id=%s", (sub_a,))
        p.denied("CANNOT unlock their own submission by naming an instructor [migration 006]",
                 """UPDATE submissions SET chosen_activity_id=NULL, unlocked_by=%s
                     WHERE id=%s""", (teacher_uid, sub_a))
        p.denied("CANNOT reopen a committed submission by reverting status [migration 006]",
                 "UPDATE submissions SET status='draft' WHERE id=%s", (sub_a,))

    # ---------------- teacher ----------------
    with Persona(cur, teacher_uid, f"teacher {teacher_name} (fixture section M1A only)") as p:
        check("sees only the 1 fixture student in their section",
              p.count(f"SELECT count(*) FROM students WHERE {STU_IN_FIXTURE}", (sec1, sec2)) == 1)
        check("sees only their section's submission",
              p.count(f"SELECT count(*) FROM submissions WHERE {IN_FIXTURE}", (ao,)) == 1)
        check("sees their section's grade regardless of finalization",
              p.count(f"SELECT count(*) FROM grades WHERE {IN_FIXTURE}", (ao,)) == 1)
        p.denied("CANNOT grade a student in a section they do not staff",
                 "UPDATE grades SET effort=5 WHERE enrollment_id=%s", (enr_b,))
        p.denied("CANNOT create a roster entry",
                 "INSERT INTO students (student_id,name) VALUES (3000000199,'Sneak')")
        # The escape hatch must still work — migration 006 must not have sealed staff out.
        p.allowed("CAN unlock a committed submission in their own section, as themselves",
                  """UPDATE submissions SET chosen_activity_id=NULL, unlocked_by=%s, unlocked_at=now()
                      WHERE id=%s""", (teacher_uid, sub_a))
        p.denied("CANNOT attribute an unlock to a DIFFERENT instructor [migration 006]",
                 """UPDATE submissions SET chosen_activity_id=NULL, unlocked_by=%s
                     WHERE id=%s""", (director_uid, sub_a))
        p.allowed("CAN reopen a committed submission in their own section",
                  "UPDATE submissions SET status='draft' WHERE id=%s", (sub_a,))

    # ---------------- director ----------------
    with Persona(cur, director_uid, f"director {director_name} (whole fixture offering)") as p:
        check("sees both fixture students",
              p.count(f"SELECT count(*) FROM students WHERE {STU_IN_FIXTURE}", (sec1, sec2)) == 2)
        check("sees both submissions",
              p.count(f"SELECT count(*) FROM submissions WHERE {IN_FIXTURE}", (ao,)) == 2)
        check("sees both grades",
              p.count(f"SELECT count(*) FROM grades WHERE {IN_FIXTURE}", (ao,)) == 2)
        p.allowed("CAN grade any student in the offering",
                  "UPDATE grades SET effort=5 WHERE enrollment_id=%s", (enr_b,))
        cur.execute("SAVEPOINT d")
        try:
            cur.execute("INSERT INTO students (student_id,name) VALUES (3000000199,'New Cadet')")
            check("CAN create a roster entry", True)
        except Exception as e:  # noqa: BLE001
            check("CAN create a roster entry", False, str(e).strip().splitlines()[0])
        cur.execute("ROLLBACK TO SAVEPOINT d")

    # ---------------- extensions (migration 005, governance tightened by 007) ----------------
    #
    # `reason` is NOT NULL with a non-blank CHECK since 007_extension_governance_and_review.sql
    # (:79-82). Every insert below must supply one — including the two that are EXPECTED TO BE
    # DENIED. Without it those two were rejected by the constraint before RLS was ever consulted,
    # so they reported "correctly denied" while testing nothing about the policy. That is the more
    # dangerous half of this suite having been broken: a crash is loud, a false pass is not.
    REASON = "fixture — RLS suite"
    cur.execute("RESET ROLE")
    cur.execute("""INSERT INTO extensions (enrollment_id,assignment_offering_id,extended_due_at,
                                           granted_by,reason)
                   VALUES (%s,%s,now() + interval '3 days',%s,%s)""",
                (enr_a, ao, teacher_uid, REASON))
    with Persona(cur, student_a_uid, "student A — extensions") as p:
        check("sees their own extension",
              p.count(f"SELECT count(*) FROM extensions WHERE {IN_FIXTURE}", (ao,)) == 1)
        p.denied("CANNOT grant themselves an extension",
                 """INSERT INTO extensions (enrollment_id,assignment_offering_id,extended_due_at,reason)
                    VALUES (%s,%s,now() + interval '30 days',%s)""", (enr_b, ao, REASON))
    with Persona(cur, teacher_uid, "teacher — extensions") as p:
        check("sees the extension for their section",
              p.count(f"SELECT count(*) FROM extensions WHERE {IN_FIXTURE}", (ao,)) == 1)
        p.allowed("CAN change an extension in their own section",
                  "UPDATE extensions SET extended_due_at = now() + interval '5 days' "
                  "WHERE enrollment_id=%s", (enr_a,))
        p.denied("CANNOT grant an extension outside their sections",
                 """INSERT INTO extensions (enrollment_id,assignment_offering_id,extended_due_at,reason)
                    VALUES (%s,%s,now() + interval '5 days',%s)""", (enr_b, ao, REASON))
        # 007 also made the reason itself enforceable. A blank one must be refused whoever asks,
        # which is a constraint check rather than an RLS one — but it belongs here, because the
        # governance it implements is what the policies above are for.
        p.denied("CANNOT grant an extension with a blank reason",
                 """INSERT INTO extensions (enrollment_id,assignment_offering_id,extended_due_at,reason)
                    VALUES (%s,%s,now() + interval '5 days','   ')""", (enr_a, ao))

    # ---------------- ei_sessions (migration 011) ----------------
    #
    # The decision this block exists to keep: ROADMAP §6 Q3 — a student may NOT read their own EI
    # log. Unlike every other rule in this suite, that one is enforced by the ABSENCE of a policy,
    # and an absence is exactly the kind of thing a later migration adds back by accident while
    # "making the table consistent with extensions". The first check below is the guard.
    #
    # It matters because `notes` holds an instructor's candid read of a cadet. A student read path
    # would disclose it, and there would be nothing in the schema objecting.
    #
    # Scoped on enrolment, not IN_FIXTURE — ei_sessions has no assignment_offering_id, because a
    # session is about a student and not about one lesson.
    EI_IN_FIXTURE = "enrollment_id IN (%s,%s)"
    cur.execute("RESET ROLE")
    cur.execute("""INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes,notes)
                   VALUES (%s,%s,now(),30,'fixture — candid note the cadet must not read')""",
                (enr_a, teacher_uid))
    cur.execute("""INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes)
                   VALUES (%s,%s,now(),30)""", (enr_b, director_uid))

    with Persona(cur, student_a_uid, "student A — ei_sessions") as p:
        check("CANNOT see their OWN EI session (ROADMAP Q3 — the whole point of this table)",
              p.count(f"SELECT count(*) FROM ei_sessions WHERE {EI_IN_FIXTURE}", (enr_a, enr_b)) == 0)
        p.denied("CANNOT log an EI session for themselves",
                 """INSERT INTO ei_sessions (enrollment_id,started_at,duration_minutes)
                    VALUES (%s,now(),30)""", (enr_a,))
        p.denied("CANNOT delete an EI session written about them",
                 "DELETE FROM ei_sessions WHERE enrollment_id=%s", (enr_a,))

    with Persona(cur, teacher_uid, "teacher — ei_sessions") as p:
        check("sees the EI session for their own section, and ONLY that one",
              p.count(f"SELECT count(*) FROM ei_sessions WHERE {EI_IN_FIXTURE}", (enr_a, enr_b)) == 1)
        p.allowed("CAN log an EI session for a student in their own section",
                  """INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes)
                     VALUES (%s,%s,now(),30)""", (enr_a, teacher_uid))
        p.allowed("CAN correct a session in their own section",
                  "UPDATE ei_sessions SET duration_minutes=45 WHERE enrollment_id=%s", (enr_a,))
        p.denied("CANNOT log an EI session outside their sections",
                 """INSERT INTO ei_sessions (enrollment_id,started_at,duration_minutes)
                    VALUES (%s,now(),30)""", (enr_b,))
        # Section scope, not offering scope: an instructor must not read a colleague's notes on a
        # cadet they do not teach, even inside the same course.
        p.denied("CANNOT alter a session in a section they do not teach",
                 "UPDATE ei_sessions SET duration_minutes=1 WHERE enrollment_id=%s", (enr_b,))

    with Persona(cur, director_uid, "director — ei_sessions") as p:
        check("sees EI sessions across the whole offering",
              p.count(f"SELECT count(*) FROM ei_sessions WHERE {EI_IN_FIXTURE}", (enr_a, enr_b)) >= 2)
        p.allowed("CAN log an EI session for any section of their offering",
                  """INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes)
                     VALUES (%s,%s,now(),30)""", (enr_b, director_uid))

    # ---------------- feedback (migration 012) ----------------
    #
    # Two security properties, both must hold: a signed-in user can file feedback but ONLY as
    # themselves (the WITH CHECK on submitted_by), and a non-admin can read NONE of it (SELECT is
    # is_admin() only). The second is why feedback can safely name pages and people — a cohort peer
    # cannot browse it. Rows are marked with a sentinel page so reads are scoped to this test and
    # never measure live feedback.
    FB_PAGE = "__rls_test_feedback__"
    cur.execute("RESET ROLE")
    cur.execute("""INSERT INTO feedback (submitted_by,page,category,message)
                   VALUES (%s,%s,'feature','seeded by the RLS suite')""", (teacher_uid, FB_PAGE))

    with Persona(cur, student_a_uid, "student A — feedback") as p:
        p.allowed("CAN file feedback as themselves",
                  """INSERT INTO feedback (submitted_by,page,category,message)
                     VALUES (%s,%s,'like','the dashboard is clear')""", (student_a_uid, FB_PAGE))
        p.denied("CANNOT file feedback as someone else (WITH CHECK on submitted_by)",
                 """INSERT INTO feedback (submitted_by,page,category,message)
                    VALUES (%s,%s,'dislike','spoofed')""", (teacher_uid, FB_PAGE))
        check("CANNOT read any feedback — SELECT is admin-only",
              p.count("SELECT count(*) FROM feedback WHERE page=%s", (FB_PAGE,)) == 0)

    with Persona(cur, teacher_uid, "teacher — feedback") as p:
        p.allowed("CAN file feedback as themselves",
                  """INSERT INTO feedback (submitted_by,page,category,message)
                     VALUES (%s,%s,'add','want a CSV export')""", (teacher_uid, FB_PAGE))
        check("a non-admin instructor also reads no feedback",
              p.count("SELECT count(*) FROM feedback WHERE page=%s", (FB_PAGE,)) == 0)

    # Admin-can-read is the whole point of the poll, so verify it against a real global admin when
    # one exists (the suite otherwise avoids admin personas because is_admin() short-circuits — here
    # that short-circuit IS the behaviour under test).
    cur.execute("RESET ROLE")
    cur.execute("SELECT id FROM instructors WHERE is_global_admin ORDER BY created_at LIMIT 1")
    admin_row = cur.fetchone()
    if admin_row:
        with Persona(cur, str(admin_row[0]), "global admin — feedback") as p:
            check("a global admin CAN read the feedback (the poll)",
                  p.count("SELECT count(*) FROM feedback WHERE page=%s", (FB_PAGE,)) >= 1)
    else:
        check("(skipped: no global admin to test the admin-read path with)", True)

    cur.execute("RESET ROLE")
    conn.rollback()
    cur.execute("SELECT count(*) FROM app.courses WHERE code='__r-215'")
    check("fixture fully rolled back — nothing persisted", cur.fetchone()[0] == 0)
    cur.execute("SELECT count(*) FROM app.students WHERE student_id=3000000102")
    check("fixture student removed", cur.fetchone()[0] == 0)

    cur.close()
    conn.close()
    ok = all(results)
    print("\n" + (f"All {len(results)} RLS enforcement checks passed." if ok else
                  "SOME RLS CHECKS FAILED — do not point the app at this schema yet."))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
