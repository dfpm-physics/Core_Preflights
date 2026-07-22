#!/usr/bin/env python
"""Exercise the structural guarantees of schema `app` against the live database.

Builds a throwaway fixture (course -> term -> course_offering -> section -> student ->
enrolment, plus an assignment with a written and an interactive activity, scheduled as one
assignment_offering), asserts each invariant behaves, then ROLLS BACK. Nothing persists.

Runs as the `dml` tier, which doubles as proof that the everyday role can do real work.

What is proven here — these are the claims the redesign rests on, so they are tested rather
than asserted:

  1. effort -> points follows the migration-013 curve, scaled to points_possible
  2. a SECOND grade for the same (enrolment, offering) is refused          <- "never 4 of 2"
  3. points_earned > points_possible is refused                           <- "never 4 of 2"
  4. a 'practice' activity can never be chosen for credit
  5. an activity not offered in THIS offering cannot be chosen
  6. switching a committed submission raises, per switch_policy
  7. switch_policy='one_way_to_interactive' permits written -> interactive only
  8. an unlock must name who performed it; an attributed unlock releases the lock
  9. flipping grading_role mid-term redirects NEW choices without breaking existing rows
     (the "if the interactive breaks, kick everyone over to the questions" case)

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
    expect_error(cur, "second grade for same (enrolment, offering) is refused",
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
