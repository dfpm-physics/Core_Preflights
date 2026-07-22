#!/usr/bin/env python
"""Remove every row the wiring tests created for the test cadet (3009999999).

WHY THIS IS PYTHON AND NOT PART OF THE NODE SUITE
    RLS grants no DELETE on `app.submissions` to anyone — not students, not staff. That is
    deliberate (a student must not be able to erase their work, and neither should an
    instructor), so the Node suite genuinely cannot clean up after itself. Teardown needs the
    operator tier, which is a direct Postgres connection.

SAFETY: every statement is bounded to enrolments belonging to student 3009999999. It cannot
touch another cadet's work even if run by accident. Dry run by default, per CORE.md §4.

Usage (from the repo root, via the project venv):
  .venv/Scripts/python tests/app-schema/cleanup.py
  .venv/Scripts/python tests/app-schema/cleanup.py --commit
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402

TEST_STUDENT = 3009999999


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="actually delete; otherwise roll back")
    args = ap.parse_args()

    cfg, tiers = load()
    tier = tiers.get("dml") or tiers.get("owner")
    if not tier:
        sys.exit("Need PREP_APP_DML_ROLE (or owner) in supabase/admin/.env.")

    conn = connect(cfg, tier)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    scope = """enrollment_id IN (SELECT id FROM app.enrollments WHERE student_id = %s)"""

    steps = [
        ("submission_activities", f"""DELETE FROM app.submission_activities
             WHERE submission_id IN (SELECT id FROM app.submissions WHERE {scope})"""),
        ("grade_events", f"""DELETE FROM app.grade_events
             WHERE grade_id IN (SELECT id FROM app.grades WHERE {scope})"""),
        ("grades", f"DELETE FROM app.grades WHERE {scope}"),
        ("extensions", f"DELETE FROM app.extensions WHERE {scope}"),
        ("submissions", f"DELETE FROM app.submissions WHERE {scope}"),
        # user_preferences is keyed on the AUTH user id, not the enrolment, so it does not fit
        # the `scope` clause above — it is reached through students.auth_user_id instead. Written
        # by prefs.js on every signed-in page load (P1.3), so the test cadet grows one the moment
        # any browser or Node suite signs in as them.
        ("user_preferences", """DELETE FROM app.user_preferences WHERE user_id IN
             (SELECT auth_user_id FROM app.students
               WHERE student_id = %s AND auth_user_id IS NOT NULL)"""),
    ]

    print(f"{'COMMITTING' if args.commit else 'DRY RUN — will roll back'}: "
          f"test-cadet residue for student {TEST_STUDENT}\n")
    total = 0
    for label, sql in steps:
        cur.execute(sql, (TEST_STUDENT,))
        print(f"  {cur.rowcount:>4}  {label}")
        total += max(cur.rowcount, 0)

    if args.commit:
        conn.commit()
        print(f"\nCOMMITTED — {total} row(s) removed.")
    else:
        conn.rollback()
        print(f"\nRolled back — dry run ({total} row(s) would be removed).")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
