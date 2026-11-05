#!/usr/bin/env python3
"""Prove the triggers in schema `app` fire, and do not depend on the caller's search path.

Runs against the STAGING database only. Every test runs inside a transaction that is rolled back,
so nothing is left behind. It uses the made-up rows already on staging and creates its own
submission, grade and extension inside the transaction.

Each test runs twice:
  normal    search_path = app, public     what the API gives a request today
  hostile   search_path = pg_catalog      a session that does not mention `app` at all
A function that names a table or helper without a schema, and sets no path of its own, fails in
the second run. After migration 025 every function in `app` pins its own path, so both pass.

It also checks the catalog: every function in `app` must carry a search_path setting.

WHAT IS EXERCISED
  touch_updated_at                      an UPDATE moves updated_at
  grades_points_from_effort             effort 4, 2 and 0 become full, one point and zero
  submissions_check_gradable            a practice activity cannot be chosen for credit
  grade_interactive_on_commit           committing an interactive submission writes the grade
  submissions_lock_activity             a non-staff caller cannot reopen a committed submission
  extensions_guard_withdrawal           an extension cannot be withdrawn after the work is in
  review_signoffs_require_self          a sign-off must be attributed to the caller
  assignment_offerings_snapshot_guard   a frozen snapshot cannot be edited
  freeze_assignment_offering, freeze_term   both run
instructors_admin_flag_guard has its own test: test_instructors_admin_guard.py.

USAGE (staging only; the connection comes from the environment, never from an argument)
  python scripts/staging/test_trigger_search_path.py --expect-ref <staging_ref>
Exit code 0 when everything passes, 1 on any failure, 2 when it refuses to run.
"""

import argparse
import os
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

MODES = {"normal": "app, public", "hostile": "pg_catalog"}


def refuse(msg):
    print(f"REFUSED  {msg}", file=sys.stderr)
    sys.exit(2)


class Failure(Exception):
    pass


def expect_error(cur, name, sql, args=(), contains=None):
    """Run a statement that must raise. Uses a savepoint so the transaction survives."""
    cur.execute("SAVEPOINT expect_error")
    try:
        cur.execute(sql, args)
    except Exception as exc:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT expect_error")
        text = str(exc)
        if contains and contains not in text:
            raise Failure(f"{name}: raised, but not the expected error: {text.splitlines()[0]}")
        return
    cur.execute("ROLLBACK TO SAVEPOINT expect_error")
    raise Failure(f"{name}: no error was raised")


def find_fixture(cur):
    cur.execute("""
        SELECT e.id, ao.id, oa.activity_id, act.modality, ao.points_possible, sec.id
          FROM app.enrollments e
          JOIN app.sections sec ON sec.id = e.section_id
          JOIN app.assignment_offerings ao ON ao.course_offering_id = sec.course_offering_id
          JOIN app.offering_activities oa ON oa.assignment_offering_id = ao.id
          JOIN app.activities act ON act.id = oa.activity_id
         WHERE NOT EXISTS (SELECT 1 FROM app.submissions s
                            WHERE s.enrollment_id = e.id AND s.assignment_offering_id = ao.id)
           AND NOT EXISTS (SELECT 1 FROM app.grades g
                            WHERE g.enrollment_id = e.id AND g.assignment_offering_id = ao.id)
           AND NOT EXISTS (SELECT 1 FROM app.extensions x
                            WHERE x.enrollment_id = e.id AND x.assignment_offering_id = ao.id)
         ORDER BY (act.modality = 'interactive') DESC, ao.points_possible DESC, e.id, ao.id
         LIMIT 1""")
    row = cur.fetchone()
    if not row:
        raise Failure("fixture: no enrollment and offering pair without a submission")
    return dict(zip(("enr", "ao", "act", "modality", "pp", "section"), row))


def run_mode(conn, mode, path):
    results = []
    cur = conn.cursor()

    def check(name, fn):
        cur.execute("SAVEPOINT check_one")
        try:
            note = fn()
            results.append(("PASS", name, note or ""))
        except Failure as exc:
            cur.execute("ROLLBACK TO SAVEPOINT check_one")
            results.append(("FAIL", name, str(exc)))
        except Exception as exc:  # noqa: BLE001
            cur.execute("ROLLBACK TO SAVEPOINT check_one")
            results.append(("FAIL", name, f"{type(exc).__name__}: {str(exc).strip().splitlines()[0]}"))
        else:
            cur.execute("RELEASE SAVEPOINT check_one")

    cur.execute("BEGIN")
    try:
        cur.execute("SET LOCAL ROLE prep_app_owner")
        cur.execute(f"SET LOCAL search_path = {path}")
        cur.execute("SET LOCAL lock_timeout = '5s'")
        cur.execute("SELECT current_setting('search_path')")
        assert cur.fetchone()[0].replace(" ", "") == path.replace(" ", ""), "search_path not applied"
        fx = find_fixture(cur)
        pp = fx["pp"]

        def touch():
            cur.execute("UPDATE app.courses SET updated_at = '2000-01-01' "
                        "WHERE id = (SELECT id FROM app.courses LIMIT 1) RETURNING updated_at")
            got = cur.fetchone()
            if not got or got[0].year < 2020:
                raise Failure("updated_at was not moved by the trigger")
        check("touch_updated_at", touch)

        def effort_curve():
            expect = {4: pp, 2: min(1, pp), 0: 0}
            for effort, want in expect.items():
                cur.execute("SAVEPOINT curve")
                cur.execute("INSERT INTO app.grades (enrollment_id, assignment_offering_id, effort, "
                            "points_possible, source, is_finalized) VALUES (%s, %s, %s, %s, 'derived', false) "
                            "RETURNING points_earned", (fx["enr"], fx["ao"], effort, pp))
                got = cur.fetchone()[0]
                cur.execute("ROLLBACK TO SAVEPOINT curve")
                if got != want:
                    raise Failure(f"effort {effort} of {pp} points gave {got}, expected {want}")
            return f"effort 4/2/0 of {pp} points"
        check("grades_points_from_effort", effort_curve)

        def gradable():
            cur.execute("UPDATE app.offering_activities SET grading_role = 'practice' "
                        "WHERE assignment_offering_id = %s AND activity_id = %s", (fx["ao"], fx["act"]))
            expect_error(cur, "practice activity chosen",
                         "INSERT INTO app.submissions (enrollment_id, assignment_offering_id, chosen_activity_id) "
                         "VALUES (%s, %s, %s)", (fx["enr"], fx["ao"], fx["act"]),
                         contains="only a graded activity can be chosen")
            cur.execute("UPDATE app.offering_activities SET grading_role = 'graded' "
                        "WHERE assignment_offering_id = %s AND activity_id = %s", (fx["ao"], fx["act"]))
        check("submissions_check_gradable", gradable)

        sub = {}

        def commit_flow():
            cur.execute("UPDATE app.offering_activities SET grading_role = 'graded' "
                        "WHERE assignment_offering_id = %s AND activity_id = %s", (fx["ao"], fx["act"]))
            cur.execute("INSERT INTO app.submissions (enrollment_id, assignment_offering_id) "
                        "VALUES (%s, %s) RETURNING id", (fx["enr"], fx["ao"]))
            sub["id"] = cur.fetchone()[0]
            cur.execute("UPDATE app.submissions SET chosen_activity_id = %s WHERE id = %s",
                        (fx["act"], sub["id"]))
            if fx["modality"] != "interactive":
                return "skipped the autograde assertion: no unused interactive activity on staging"
            cur.execute("INSERT INTO app.submission_activities (submission_id, activity_id, content, is_final) "
                        "VALUES (%s, %s, %s::jsonb, true)",
                        (sub["id"], fx["act"], '{"schema": 1, "effort": 4, "reading_reflection": {"meaningful": true}}'))
            cur.execute("UPDATE app.submissions SET status = 'committed', committed_at = now() WHERE id = %s",
                        (sub["id"],))
            cur.execute("SELECT effort, points_earned, points_possible, is_finalized, source FROM app.grades "
                        "WHERE enrollment_id = %s AND assignment_offering_id = %s", (fx["enr"], fx["ao"]))
            g = cur.fetchone()
            if not g:
                raise Failure("committing an interactive submission wrote no grade")
            if g[0] != 4 or g[1] != g[2] or not g[3] or g[4] != "derived":
                raise Failure(f"grade written wrongly: {g}")
            return "commit wrote a finalized derived grade at full points"
        check("grade_interactive_on_commit + effort", commit_flow)

        def lock():
            if "id" not in sub:
                raise Failure("no committed submission from the previous test")
            stranger = str(uuid.uuid4())
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", ('{"sub": "%s"}' % stranger,))
            expect_error(cur, "non-staff reopen",
                         "UPDATE app.submissions SET status = 'draft' WHERE id = %s", (sub["id"],),
                         contains="only staff may reopen")
            cur.execute("SELECT set_config('request.jwt.claims', '', true)")
        check("submissions_lock_activity", lock)

        def extension():
            if "id" not in sub or fx["modality"] != "interactive":
                return "skipped: needs the committed submission from above"
            cur.execute("INSERT INTO app.extensions (enrollment_id, assignment_offering_id, extended_due_at, reason) "
                        "VALUES (%s, %s, now() + interval '1 day', 'trigger test') RETURNING id", (fx["enr"], fx["ao"]))
            ext = cur.fetchone()[0]
            expect_error(cur, "withdraw after submit",
                         "UPDATE app.extensions SET revoked_at = now() WHERE id = %s", (ext,),
                         contains="already submitted")
        check("extensions_guard_withdrawal", extension)

        def signoff():
            cur.execute("SELECT id FROM app.instructors ORDER BY id LIMIT 2")
            ids = [r[0] for r in cur.fetchall()]
            if len(ids) < 2:
                raise Failure("needs two instructors on staging")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", ('{"sub": "%s"}' % ids[0],))
            expect_error(cur, "sign-off for someone else",
                         "INSERT INTO app.review_signoffs (assignment_offering_id, section_id, reviewed_by) "
                         "VALUES (%s, %s, %s)", (fx["ao"], fx["section"], ids[1]),
                         contains="must be attributed to the instructor performing it")
            cur.execute("INSERT INTO app.review_signoffs (assignment_offering_id, section_id, reviewed_by) "
                        "VALUES (%s, %s, %s)", (fx["ao"], fx["section"], ids[0]))
            cur.execute("SELECT set_config('request.jwt.claims', '', true)")
        check("review_signoffs_require_self", signoff)

        def freeze():
            cur.execute("SELECT app.freeze_assignment_offering(%s, true) IS NOT NULL", (fx["ao"],))
            if not cur.fetchone()[0]:
                raise Failure("freeze_assignment_offering returned nothing")
            expect_error(cur, "edit frozen snapshot",
                         "UPDATE app.assignment_offerings SET content_snapshot = '{}'::jsonb WHERE id = %s",
                         (fx["ao"],), contains="is frozen")
            cur.execute("SELECT t.code FROM app.terms t JOIN app.course_offerings co ON co.term_id = t.id "
                        "JOIN app.assignment_offerings ao ON ao.course_offering_id = co.id WHERE ao.id = %s",
                        (fx["ao"],))
            code = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM app.freeze_term(%s, true)", (code,))
            if cur.fetchone()[0] < 1:
                raise Failure("freeze_term returned no rows")
        check("assignment_offerings_snapshot_guard + freeze_*", freeze)

        # ---- the v2 triggers (migrations 026 to 039): each must exist, pin its path, and refuse under both paths ----
        wanted = ["assignment_offerings_marker_one_way", "assignment_offerings_new_paths_stay_unpublished",
                  "offering_activities_new_paths_stay_unpublished", "column_closures_no_direct_delete",
                  "question_keys_stamp", "grades_group_adjusted", "grades_group_adjusted_ins"]

        def v2_catalog():
            cur.execute("SELECT t.tgname, p.proconfig::text FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid "
                        "WHERE t.tgname = ANY(%s) AND NOT t.tgisinternal", (wanted,))
            got = {r[0]: r[1] or "" for r in cur.fetchall()}
            miss = [n for n in wanted if n not in got]
            if miss:
                raise Failure("trigger missing: " + ", ".join(miss))
            loose = [n for n, c in got.items() if "search_path=app" not in c]
            if loose:
                raise Failure("trigger function without a pinned path: " + ", ".join(loose))
        check("v2 triggers exist and their functions pin the path", v2_catalog)

        def v2_rules():
            cur.execute("SELECT id FROM app.assignment_offerings WHERE entered_on_new_page IS TRUE LIMIT 1")
            flagged = cur.fetchone()
            if flagged:
                expect_error(cur, "clear the marker", "UPDATE app.assignment_offerings SET entered_on_new_page = false WHERE id = %s",
                             (flagged[0],), contains="marker_one_way")
            cur.execute("SELECT id, closed_by FROM app.column_closures LIMIT 1")
            row = cur.fetchone()
            if row:
                expect_error(cur, "delete a closure", "DELETE FROM app.column_closures WHERE id = %s", (row[0],),
                             contains="never deleted directly")
        check("v2 marker and closure rules", v2_rules)
    finally:
        cur.execute("ROLLBACK")
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--url-env", default="STAGING_DB_URL")
    args = ap.parse_args()

    url = os.environ.get(args.url_env, "").strip()
    if not url:
        refuse(f"{args.url_env} is not set.")
    try:
        ref = db_target.require_staging(url, args.expect_ref).ref
    except db_target.DbTargetError as exc:
        refuse(str(exc))
    if ref != args.expect_ref:
        refuse(f"{args.url_env} names project {ref}, not {args.expect_ref}.")

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'app' AND p.prokind IN ('f','p') AND NOT EXISTS "
                "(SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search\\_path=app%') "
                "ORDER BY 1")
    unpinned = [r[0] for r in cur.fetchall()]
    failed = 0
    if unpinned:
        print("FAIL  catalog: functions in app without a search_path pinned to app: " + ", ".join(unpinned))
        failed += 1
    else:
        print("PASS  catalog: every function in app pins its search_path")
    for mode, path in MODES.items():
        print(f"\n-- search_path = {path}   ({mode})")
        for status, name, note in run_mode(conn, mode, path):
            print(f"{status}  {name}" + (f"  [{note}]" if note else ""))
            failed += status == "FAIL"
    print(f"\n{'ALL PASSED' if not failed else str(failed) + ' FAILED'}")
    conn.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
