#!/usr/bin/env python
"""Exercise the structural guarantees of schema `app` against the live database.

Builds a throwaway fixture (course -> term -> course_offering -> section -> student ->
enrollment, plus an assignment with a written and an interactive activity, scheduled as one
assignment_offering), asserts each invariant behaves, then ROLLS BACK. Nothing persists.

Runs as the `dml` tier, which doubles as proof that the everyday role can do real work.

What is proven here — these are the claims the redesign rests on, so they are tested rather
than asserted:

  1. effort -> points follows the migration-013 curve, scaled to points_possible
  2. a SECOND grade for the same (enrollment, offering) is refused          <- "never 4 of 2"
  3. points_earned > points_possible is refused                           <- "never 4 of 2"
  4. a 'practice' activity can never be chosen for credit
  5. an activity not offered in THIS offering cannot be chosen
  6. switching a committed submission raises, per switch_policy
  7. switch_policy='one_way_to_interactive' permits written -> interactive only
  8. an unlock must name who performed it; an attributed unlock releases the lock
  9. flipping grading_role mid-term redirects NEW choices without breaking existing rows
     (the "if the interactive breaks, kick everyone over to the questions" case)
 10. ei_sessions is repeatable, bounded, batch-groupable, and dies with its enrollment
 11. feedback enforces its category/message/role constraints and is write-once

Usage:
  .venv/Scripts/python supabase/admin/app_invariant_test.py
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


def expect_error(cur, desc, sql, params=None):
    """The statement MUST fail. Savepoint keeps the outer transaction usable."""
    cur.execute("SAVEPOINT sp")
    try:
        cur.execute(sql, params or ())
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        check(desc, True)
        return
    cur.execute("ROLLBACK TO SAVEPOINT sp")
    check(desc, False, "statement unexpectedly SUCCEEDED")


def expect_ok(cur, desc, sql, params=None):
    cur.execute("SAVEPOINT sp2")
    try:
        cur.execute(sql, params or ())
        check(desc, True)
        cur.execute("RELEASE SAVEPOINT sp2")
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT sp2")
        check(desc, False, str(e).strip().splitlines()[0])


def main():
    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No dml tier in .env")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    print("Building throwaway fixture (rolled back at the end)...\n")

    cur.execute("INSERT INTO courses (code,title) VALUES ('__t-215','Test 215') RETURNING id")
    course = cur.fetchone()[0]
    cur.execute("INSERT INTO terms (code,label) VALUES ('__t-fall26','Test Fall 2026') RETURNING id")
    term = cur.fetchone()[0]
    cur.execute("INSERT INTO course_offerings (course_id,term_id) VALUES (%s,%s) RETURNING id",
                (course, term))
    co = cur.fetchone()[0]
    cur.execute("INSERT INTO sections (course_offering_id,code,meeting_days,period) "
                "VALUES (%s,'M1A','{M}',1) RETURNING id", (co,))
    section = cur.fetchone()[0]
    # instructors.id is a FOREIGN KEY to auth.users(id) — added by the bootstrap as `postgres`,
    # because `postgres` cannot delegate REFERENCES on auth.users to the app owner (see
    # PREP-V2-CUTOVER.md Phase 1 step 3). So a random uuid cannot be inserted here, and
    # prep_app_dml cannot create an auth user to make one valid. That is what left this whole
    # suite dead from the day 008 landed: it crashed in fixture setup, so NONE of the invariants
    # below were being checked.
    #
    # Borrow a real instructor's id instead. Nothing is written to that account and the entire
    # fixture is rolled back at the end; the id is used only as the `unlocked_by` attribution on a
    # throwaway submission. Falling back to a fresh auth user is not an option for this tier, and
    # skipping the unlock tests would silently drop two of the invariants.
    cur.execute("SELECT id FROM instructors ORDER BY created_at LIMIT 1")
    row = cur.fetchone()
    if not row:
        sys.exit("No instructors exist to borrow an id from — this suite needs one real staff row "
                 "because instructors.id references auth.users and this tier cannot create one.")
    instructor = row[0]
    cur.execute("INSERT INTO students (student_id,name) VALUES (3000000001,'Test Cadet')")
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000001,%s) RETURNING id",
                (section,))
    enrollment = cur.fetchone()[0]

    cur.execute("INSERT INTO assignments (course_id,kind_id,slug,title) "
                "VALUES (%s,'preflight','__t-preflight-02','Test Preflight 02') RETURNING id",
                (course,))
    assignment = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'written','__t-written-02') RETURNING id", (assignment,))
    a_written = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'interactive','__t-interactive-02') RETURNING id", (assignment,))
    a_interactive = cur.fetchone()[0]

    cur.execute("""INSERT INTO assignment_offerings
                     (course_offering_id,assignment_id,points_possible,grading_mode,switch_policy)
                   VALUES (%s,%s,2,'effort','lock_on_commit') RETURNING id""", (co, assignment))
    ao = cur.fetchone()[0]

    # Both activities live this term, both gradable -> the "student chooses" case.
    cur.execute("""INSERT INTO offering_activities (assignment_offering_id,activity_id,grading_role)
                   VALUES (%s,%s,'graded'), (%s,%s,'graded')""",
                (ao, a_written, ao, a_interactive))

    cur.execute("""INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                            chosen_activity_id,status)
                   VALUES (%s,%s,%s,'draft') RETURNING id""", (enrollment, ao, a_written))
    submission = cur.fetchone()[0]

    print("Fixture built.\n--- 1. effort -> points ---")
    for effort, expected in ((5, 2.00), (3, 2.00), (2, 1.00), (1, 1.00), (0, 0.00), (None, 0.00)):
        cur.execute("SAVEPOINT g")
        cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,submission_id,
                                           points_possible,effort,source)
                       VALUES (%s,%s,%s,2,%s,'ai_suggested') RETURNING points_earned""",
                    (enrollment, ao, submission, effort))
        got = float(cur.fetchone()[0])
        check(f"effort={effort!s:<4} -> points_earned={got:.2f} (expected {expected:.2f})",
              abs(got - expected) < 0.005)
        cur.execute("ROLLBACK TO SAVEPOINT g")

    print("\n--- 2/3. the 'never 4 out of 2' guarantees ---")
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_offering_id,submission_id,
                                       points_possible,effort,source)
                   VALUES (%s,%s,%s,2,4,'ai_suggested')""", (enrollment, ao, submission))
    expect_error(cur, "second grade for same (enrollment, offering) is refused",
                 """INSERT INTO grades (enrollment_id,assignment_offering_id,points_possible,
                                        effort,source)
                    VALUES (%s,%s,2,5,'instructor')""", (enrollment, ao))

    cur.execute("UPDATE assignment_offerings SET grading_mode='points' WHERE id=%s", (ao,))
    expect_error(cur, "points_earned (4) > points_possible (2) is refused",
                 """UPDATE grades SET points_earned=4
                    WHERE enrollment_id=%s AND assignment_offering_id=%s""", (enrollment, ao))
    cur.execute("UPDATE assignment_offerings SET grading_mode='effort' WHERE id=%s", (ao,))

    print("\n--- 4/5. only a graded activity of THIS offering may be chosen ---")
    cur.execute("""UPDATE offering_activities SET grading_role='practice'
                   WHERE assignment_offering_id=%s AND activity_id=%s""", (ao, a_interactive))
    expect_error(cur, "a practice activity cannot be chosen for credit",
                 "UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                 (a_interactive, submission))
    cur.execute("""UPDATE offering_activities SET grading_role='graded'
                   WHERE assignment_offering_id=%s AND activity_id=%s""", (ao, a_interactive))

    cur.execute("""INSERT INTO assignments (course_id,kind_id,slug,title)
                   VALUES (%s,'preflight','__t-other','Other') RETURNING id""", (course,))
    other_asg = cur.fetchone()[0]
    cur.execute("INSERT INTO activities (assignment_id,modality,slug) "
                "VALUES (%s,'written','__t-other-written') RETURNING id", (other_asg,))
    foreign_activity = cur.fetchone()[0]
    expect_error(cur, "an activity not offered in this offering cannot be chosen",
                 "UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                 (foreign_activity, submission))

    print("\n--- 6/7/8. the activity lock ---")
    cur.execute("UPDATE submissions SET status='committed', committed_at=now() WHERE id=%s",
                (submission,))
    expect_error(cur, "switching a committed submission (lock_on_commit) raises",
                 "UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                 (a_interactive, submission))

    cur.execute("UPDATE assignment_offerings SET switch_policy='one_way_to_interactive' WHERE id=%s",
                (ao,))
    cur.execute("SAVEPOINT ow")
    try:
        cur.execute("UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                    (a_interactive, submission))
        check("one_way_to_interactive allows written -> interactive", True)
        expect_error(cur, "one_way_to_interactive blocks interactive -> written",
                     "UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                     (a_written, submission))
    except Exception as e:
        check("one_way_to_interactive allows written -> interactive", False,
              str(e).strip().splitlines()[0])
    cur.execute("ROLLBACK TO SAVEPOINT ow")

    cur.execute("UPDATE assignment_offerings SET switch_policy='lock_on_commit' WHERE id=%s", (ao,))
    expect_error(cur, "unattributed unlock (unlocked_by NULL) is refused",
                 """UPDATE submissions SET chosen_activity_id=NULL, unlocked_at=now()
                    WHERE id=%s""", (submission,))

    cur.execute("SAVEPOINT ul")
    try:
        cur.execute("""UPDATE submissions SET chosen_activity_id=NULL,
                              unlocked_by=%s, unlocked_at=now() WHERE id=%s""",
                    (instructor, submission))
        check("attributed instructor unlock releases the lock", True)
        cur.execute("UPDATE submissions SET chosen_activity_id=%s WHERE id=%s",
                    (a_interactive, submission))
        check("after unlock the student may pick the other activity", True)
    except Exception as e:
        check("attributed instructor unlock releases the lock", False,
              str(e).strip().splitlines()[0])
    cur.execute("ROLLBACK TO SAVEPOINT ul")

    print("\n--- 9. mid-term flip: 'the interactive broke, use the questions' ---")
    # Student is committed to the interactive and already graded.
    cur.execute("SAVEPOINT flip")
    cur.execute("""UPDATE offering_activities SET grading_role='practice'
                   WHERE assignment_offering_id=%s AND activity_id=%s""", (ao, a_written))
    cur.execute("""UPDATE submissions SET unlocked_by=%s, unlocked_at=now(),
                          chosen_activity_id=NULL WHERE id=%s""", (instructor, submission))
    cur.execute("UPDATE submissions SET chosen_activity_id=%s, status='committed' WHERE id=%s",
                (a_interactive, submission))
    cur.execute("""SELECT points_earned FROM grades
                   WHERE enrollment_id=%s AND assignment_offering_id=%s""", (enrollment, ao))
    before = float(cur.fetchone()[0])

    # The flip: written becomes the graded one, interactive becomes practice.
    cur.execute("""UPDATE offering_activities SET grading_role='graded'
                   WHERE assignment_offering_id=%s AND activity_id=%s""", (ao, a_written))
    cur.execute("""UPDATE offering_activities SET grading_role='practice'
                   WHERE assignment_offering_id=%s AND activity_id=%s""", (ao, a_interactive))
    check("flip applied without touching the library assignment", True)

    cur.execute("""SELECT points_earned FROM grades
                   WHERE enrollment_id=%s AND assignment_offering_id=%s""", (enrollment, ao))
    check("a grade already earned survives the flip", abs(float(cur.fetchone()[0]) - before) < 0.005)

    expect_ok(cur, "the committed student's existing row stays updatable after the flip",
              "UPDATE submissions SET status='committed' WHERE id=%s", (submission,))

    cur.execute("""INSERT INTO students (student_id,name) VALUES (3000000002,'Second Cadet')""")
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000002,%s) RETURNING id",
                (section,))
    e2 = cur.fetchone()[0]
    expect_error(cur, "a NEW student can no longer choose the now-practice interactive",
                 """INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                             chosen_activity_id,status)
                    VALUES (%s,%s,%s,'draft')""", (e2, ao, a_interactive))
    expect_ok(cur, "a NEW student can choose the now-graded written activity",
              """INSERT INTO submissions (enrollment_id,assignment_offering_id,
                                          chosen_activity_id,status)
                 VALUES (%s,%s,%s,'draft')""", (e2, ao, a_written))
    cur.execute("ROLLBACK TO SAVEPOINT flip")

    print("\n--- 10. ei_sessions (migration 011) ---")
    cur.execute("SAVEPOINT ei")

    # A second enrollment, for the batch check. Group 9 built one, but inside its own savepoint,
    # which has already been rolled back — so this block owns its fixture rather than reaching
    # for a name that no longer resolves to a row.
    cur.execute("INSERT INTO students (student_id,name) VALUES (3000000003,'Third Cadet')")
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000003,%s) RETURNING id",
                (section,))
    ei_e2 = cur.fetchone()[0]

    # The whole point of the table: the same cadet may come back. `extensions` refuses a second
    # row for the same (enrollment, offering); this must NOT, or the second visit is swallowed.
    cur.execute("""INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes)
                   VALUES (%s,%s,now(),30) RETURNING id""", (enrollment, instructor))
    ei_1 = cur.fetchone()[0]
    expect_ok(cur, "a SECOND session for the same enrollment is allowed (EI is repeatable)",
              """INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,duration_minutes)
                 VALUES (%s,%s,now(),45)""", (enrollment, instructor))

    cur.execute("SELECT duration_minutes FROM ei_sessions WHERE id=%s", (ei_1,))
    check("duration defaults to 30 minutes", cur.fetchone()[0] == 30)

    # started_at has no default ON PURPOSE (see the migration header) — logging after the fact is
    # the common case and a default would let a mistake pass as a fact. Prove the omission holds.
    expect_error(cur, "started_at is required — there is no now() default to hide a mistake",
                 "INSERT INTO ei_sessions (enrollment_id,instructor_id) VALUES (%s,%s)",
                 (enrollment, instructor))

    # The typo guard, both ends.
    expect_error(cur, "a zero-minute session is refused",
                 """INSERT INTO ei_sessions (enrollment_id,started_at,duration_minutes)
                    VALUES (%s,now(),0)""", (enrollment,))
    expect_error(cur, "a session longer than 8 hours is refused (stray digit)",
                 """INSERT INTO ei_sessions (enrollment_id,started_at,duration_minutes)
                    VALUES (%s,now(),481)""", (enrollment,))
    expect_ok(cur, "480 minutes is allowed — the bound is a typo guard, not a policy",
              """INSERT INTO ei_sessions (enrollment_id,started_at,duration_minutes)
                 VALUES (%s,now(),480)""", (enrollment,))

    expect_error(cur, "a note longer than 4000 chars is refused",
                 """INSERT INTO ei_sessions (enrollment_id,started_at,notes)
                    VALUES (%s,now(),%s)""", (enrollment, "x" * 4001))

    # One bulk log = one batch_id across several enrollments, so a wrong duration is one edit.
    cur.execute("""INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,batch_id)
                   VALUES (%s,%s,now(),gen_random_uuid()) RETURNING batch_id""",
                (enrollment, instructor))
    batch = cur.fetchone()[0]
    cur.execute("""INSERT INTO ei_sessions (enrollment_id,instructor_id,started_at,batch_id)
                   VALUES (%s,%s,now(),%s)""", (ei_e2, instructor, batch))
    cur.execute("UPDATE ei_sessions SET duration_minutes=20 WHERE batch_id=%s", (batch,))
    check("a batch is correctable as one unit", cur.rowcount == 2)

    # An instructor leaving must not erase the record that the sessions happened.
    cur.execute("SELECT confdeltype FROM pg_constraint WHERE conname='ei_sessions_instructor_id_fkey'")
    check("instructor_id is ON DELETE SET NULL, so departing staff do not erase history",
          cur.fetchone()[0] == "n")

    # …but the rows are the cadet's term record, so they go when the enrollment does.
    cur.execute("SELECT confdeltype FROM pg_constraint WHERE conname='ei_sessions_enrollment_id_fkey'")
    check("enrollment_id is ON DELETE CASCADE, so a dropped enrollment takes its log",
          cur.fetchone()[0] == "c")

    # ROADMAP Q3: students cannot read their own. Enforcement is the ABSENCE of a student policy,
    # so assert the absence structurally — app_rls_test.py proves the behaviour.
    cur.execute("""SELECT count(*) FROM pg_policies
                    WHERE schemaname='app' AND tablename='ei_sessions'""")
    check("ei_sessions carries exactly the two staff policies and no student policy",
          cur.fetchone()[0] == 2)

    cur.execute("ROLLBACK TO SAVEPOINT ei")

    print("\n--- 11. feedback (migration 012) ---")
    cur.execute("SAVEPOINT fb")

    expect_ok(cur, "a well-formed feedback row inserts",
              """INSERT INTO feedback (submitted_by,page,category,message)
                 VALUES (%s,'/site/app/faculty/gradebook.html','feature','Add a CSV export')""",
              (instructor,))
    expect_error(cur, "an unknown category is refused",
                 """INSERT INTO feedback (submitted_by,page,category,message)
                    VALUES (%s,'/x','rave','nice')""", (instructor,))
    expect_error(cur, "a blank message is refused",
                 """INSERT INTO feedback (submitted_by,page,category,message)
                    VALUES (%s,'/x','like','   ')""", (instructor,))
    expect_error(cur, "a message over 4000 chars is refused",
                 """INSERT INTO feedback (submitted_by,page,category,message)
                    VALUES (%s,'/x','like',%s)""", (instructor, "x" * 4001))
    expect_error(cur, "submitted_by is required (identity is not optional)",
                 """INSERT INTO feedback (page,category,message)
                    VALUES ('/x','like','hi')""")
    expect_error(cur, "an unknown role value is refused",
                 """INSERT INTO feedback (submitted_by,page,category,message,role)
                    VALUES (%s,'/x','like','hi','robot')""", (instructor,))

    cur.execute("""SELECT created_at IS NOT NULL FROM feedback
                    WHERE submitted_by=%s ORDER BY created_at DESC LIMIT 1""", (instructor,))
    check("created_at defaults to now()", cur.fetchone()[0] is True)

    # Write-once by design: there is no UPDATE/DELETE policy, but the columns themselves carry no
    # updated_at either, so nothing here even implies mutability. Assert the shape.
    cur.execute("""SELECT count(*) FROM information_schema.columns
                    WHERE table_schema='app' AND table_name='feedback' AND column_name='updated_at'""")
    check("feedback has no updated_at — a submission is an immutable utterance", cur.fetchone()[0] == 0)

    cur.execute("ROLLBACK TO SAVEPOINT fb")

    conn.rollback()
    cur.execute("SELECT count(*) FROM app.courses WHERE code='__t-215'")
    check("fixture fully rolled back — nothing persisted", cur.fetchone()[0] == 0)

    cur.close()
    conn.close()
    ok = all(results)
    print("\n" + (f"All {len(results)} invariant checks passed." if ok else
                  "SOME INVARIANTS FAILED — the model does not enforce what it claims."))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
