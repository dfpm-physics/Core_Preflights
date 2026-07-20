#!/usr/bin/env python
"""Exercise the structural guarantees of schema `app` against the live database.

Builds a throwaway fixture (course -> term -> offering -> section -> student -> enrolment,
plus an activity with both a written and an interactive component and one assignment),
asserts each invariant behaves, then ROLLS BACK. Nothing persists.

Runs as the `dml` tier, which doubles as proof that the everyday role can do real work.

What is proven here — these are the claims the redesign rests on, so they are tested rather
than asserted:

  1. effort -> points derivation follows the migration-013 curve, scaled to points_possible
  2. a SECOND grade for the same (enrolment, assignment) is refused          <- "never 4 of 2"
  3. points_earned > points_possible is refused                             <- "never 4 of 2"
  4. switching a committed submission to the other component raises
  5. switch_policy='one_way_to_interactive' permits written -> interactive only
  6. an instructor unlock releases the lock

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
    """The statement MUST fail. Uses a savepoint so the outer transaction survives."""
    cur.execute("SAVEPOINT sp")
    try:
        cur.execute(sql, params or ())
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        check(desc, True)
        return str(e).strip().splitlines()[0]
    cur.execute("ROLLBACK TO SAVEPOINT sp")
    check(desc, False, "statement unexpectedly SUCCEEDED")
    return None


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
    offering = cur.fetchone()[0]
    cur.execute("INSERT INTO sections (offering_id,code,meeting_days,period) "
                "VALUES (%s,'M1A','{M}',1) RETURNING id", (offering,))
    section = cur.fetchone()[0]
    cur.execute("INSERT INTO instructors (id,name) VALUES (gen_random_uuid(),'Test Instructor') "
                "RETURNING id")
    instructor = cur.fetchone()[0]
    cur.execute("INSERT INTO students (student_id,name) VALUES (3000000001,'Test Cadet')")
    cur.execute("INSERT INTO enrollments (student_id,section_id) VALUES (3000000001,%s) RETURNING id",
                (section,))
    enrollment = cur.fetchone()[0]

    cur.execute("INSERT INTO activities (course_id,kind_id,slug,title) "
                "VALUES (%s,'preflight','__t-preflight-02','Test Preflight 02') RETURNING id",
                (course,))
    activity = cur.fetchone()[0]
    cur.execute("INSERT INTO activity_components (activity_id,modality,slug) "
                "VALUES (%s,'written','__t-written-02') RETURNING id", (activity,))
    c_written = cur.fetchone()[0]
    cur.execute("INSERT INTO activity_components (activity_id,modality,slug) "
                "VALUES (%s,'interactive','__t-interactive-02') RETURNING id", (activity,))
    c_interactive = cur.fetchone()[0]

    cur.execute("""INSERT INTO assignments
                     (offering_id,activity_id,points_possible,grading_mode,
                      component_policy,switch_policy)
                   VALUES (%s,%s,2,'effort','choice','lock_on_commit') RETURNING id""",
                (offering, activity))
    assignment = cur.fetchone()[0]

    cur.execute("""INSERT INTO submissions (enrollment_id,assignment_id,chosen_component_id,status)
                   VALUES (%s,%s,%s,'draft') RETURNING id""",
                (enrollment, assignment, c_written))
    submission = cur.fetchone()[0]

    print("Fixture built.\n--- 1. effort -> points ---")
    for effort, expected in ((5, 2.00), (3, 2.00), (2, 1.00), (1, 1.00), (0, 0.00), (None, 0.00)):
        cur.execute("SAVEPOINT g")
        cur.execute("""INSERT INTO grades (enrollment_id,assignment_id,submission_id,
                                           points_possible,effort,source)
                       VALUES (%s,%s,%s,2,%s,'ai_suggested') RETURNING points_earned""",
                    (enrollment, assignment, submission, effort))
        got = float(cur.fetchone()[0])
        check(f"effort={effort!s:<4} -> points_earned={got:.2f} (expected {expected:.2f})",
              abs(got - expected) < 0.005)
        cur.execute("ROLLBACK TO SAVEPOINT g")

    print("\n--- 2/3. the 'never 4 out of 2' guarantees ---")
    cur.execute("""INSERT INTO grades (enrollment_id,assignment_id,submission_id,
                                       points_possible,effort,source)
                   VALUES (%s,%s,%s,2,4,'ai_suggested')""",
                (enrollment, assignment, submission))
    expect_error(cur, "second grade for same (enrolment, assignment) is refused",
                 """INSERT INTO grades (enrollment_id,assignment_id,points_possible,effort,source)
                    VALUES (%s,%s,2,5,'instructor')""", (enrollment, assignment))

    cur.execute("UPDATE assignments SET grading_mode='points' WHERE id=%s", (assignment,))
    expect_error(cur, "points_earned (4) > points_possible (2) is refused",
                 "UPDATE grades SET points_earned=4 WHERE enrollment_id=%s AND assignment_id=%s",
                 (enrollment, assignment))
    cur.execute("UPDATE assignments SET grading_mode='effort' WHERE id=%s", (assignment,))

    print("\n--- 4/5/6. the component lock ---")
    cur.execute("UPDATE submissions SET status='committed', committed_at=now() WHERE id=%s",
                (submission,))
    expect_error(cur, "switching a committed submission (lock_on_commit) raises",
                 "UPDATE submissions SET chosen_component_id=%s WHERE id=%s",
                 (c_interactive, submission))

    cur.execute("UPDATE assignments SET switch_policy='one_way_to_interactive' WHERE id=%s",
                (assignment,))
    cur.execute("SAVEPOINT ow")
    try:
        cur.execute("UPDATE submissions SET chosen_component_id=%s WHERE id=%s",
                    (c_interactive, submission))
        check("one_way_to_interactive allows written -> interactive", True)
        expect_error(cur, "one_way_to_interactive blocks interactive -> written",
                     "UPDATE submissions SET chosen_component_id=%s WHERE id=%s",
                     (c_written, submission))
    except Exception as e:
        check("one_way_to_interactive allows written -> interactive", False,
              str(e).strip().splitlines()[0])
    cur.execute("ROLLBACK TO SAVEPOINT ow")

    cur.execute("UPDATE assignments SET switch_policy='lock_on_commit' WHERE id=%s", (assignment,))
    # An unlock must be attributed: the trigger only releases the lock when unlocked_by is set,
    # so a nameless unlock is impossible by construction.
    expect_error(cur, "unattributed unlock (unlocked_by NULL) is refused",
                 """UPDATE submissions SET chosen_component_id=NULL, unlocked_at=now()
                    WHERE id=%s""", (submission,))

    cur.execute("SAVEPOINT ul")
    try:
        cur.execute("""UPDATE submissions SET chosen_component_id=NULL,
                              unlocked_by=%s, unlocked_at=now() WHERE id=%s""",
                    (instructor, submission))
        check("attributed instructor unlock releases the lock", True)
        cur.execute("UPDATE submissions SET chosen_component_id=%s WHERE id=%s",
                    (c_interactive, submission))
        check("after unlock the student may pick the other component", True)
    except Exception as e:
        check("attributed instructor unlock releases the lock", False,
              str(e).strip().splitlines()[0])
    cur.execute("ROLLBACK TO SAVEPOINT ul")

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
