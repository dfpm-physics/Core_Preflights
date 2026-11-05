#!/usr/bin/env python
"""Remove every row the wiring tests created for the test cadet (3009999999) on STAGING.

WHY THIS IS PYTHON AND NOT PART OF THE NODE SUITE
    RLS grants no DELETE on `app.submissions` to anyone -- not students, not staff. That is
    deliberate (a student must not be able to erase their work, and neither should an
    instructor), so the Node suite genuinely cannot clean up after itself. Teardown needs the
    operator tier, which is a direct Postgres connection.

TARGET
    The staging project only. The connection string comes from STAGING_DB_URL and is refused
    unless it names exactly the staging project (staging_guard.py, fail-closed). Nothing else is
    read: no admin config file, no production credential.

SAFETY: every statement is bounded to enrollments belonging to student 3009999999. It cannot
touch another cadet's work even if run by accident. Dry run by default.

Usage (the connection string is supplied in the environment, never on the command line):
  python tests/app-schema/cleanup.py
  python tests/app-schema/cleanup.py --commit
Needs psycopg2 (the project venv has it).
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from staging_guard import require_staging  # noqa: E402

TEST_STUDENT = 3009999999


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="actually delete; otherwise roll back")
    args = ap.parse_args()

    # The guard runs before anything is imported or opened, so a refused URL never connects.
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)

    import psycopg2  # noqa: E402

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")

    scope = """enrollment_id IN (SELECT id FROM app.enrollments WHERE student_id = %s)"""

    steps = [
        ("submission_activities", f"""DELETE FROM app.submission_activities
             WHERE submission_id IN (SELECT id FROM app.submissions WHERE {scope})"""),
        ("grade_events", f"""DELETE FROM app.grade_events
             WHERE grade_id IN (SELECT id FROM app.grades WHERE {scope})"""),
        ("grades", f"DELETE FROM app.grades WHERE {scope}"),
        ("extensions", f"DELETE FROM app.extensions WHERE {scope}"),
        ("submissions", f"DELETE FROM app.submissions WHERE {scope}"),
        # user_preferences is keyed on the AUTH user id, not the enrollment, so it does not fit
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
