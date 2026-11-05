#!/usr/bin/env python3
"""Backfill delivery and grading on the paths that existed before the v2 columns.

WHAT IT WRITES
  One table, offering_activities, and only rows whose `delivery` is still NULL:
    written      ->  delivery typed_response,   grading human_graded,  warn_earns_full true
    interactive  ->  delivery interactive_tutor, grading effort,       warn_earns_full false
  It writes nothing to grades, submissions or assignment_offerings, so no touch trigger fires and
  no review signoff goes stale. offering_activities has no updated_at.

IN SCOPE means `delivery IS NULL`, for the write and for both assertions below. A row the fill
trigger has already filled (any new item, the gate seed) is out of scope and cannot trip a re-run.

ASSERTIONS, on rows in scope, before any write (a failure stops the run with nothing changed)
  * every modality in scope is `written` or `interactive` (anything else is unknown, so it stops);
  * every item in scope has kind `preflight`;
  * every item in scope has late_allowed = false.

MODES   dry run by default; --commit writes. Idempotent: a second --commit writes 0 rows, and a
        dry run after a commit reports 0 rows. The write is one transaction.

WHICH DATABASE   The script never picks one. --url-env NAME names the environment variable that
        holds the connection string (default STAGING_DB_URL, the staging project). The project is
        read from that string by the shared parser (db_target.py), and --expect-ref must name the
        same project, or the run is refused. The staging project is accepted as it is. The live
        project is refused unless --allow-production-write is also given; that flag is for the
        course director's own run, over the data-writing tier. Any other project is refused.

OUTPUT  Counts by course, term, modality and grading role, then the planned writes. It prints no
        name, answer or secret. After a commit it prints this transaction's id; --xid-file PATH
        appends it to a file the grades fingerprint reads to tell this run's writes from others.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "staging"))
import db_target  # noqa: E402

SCOPE_SQL = """
SELECT c.code, t.code, a.modality, oa.grading_role, count(*),
       count(*) FILTER (WHERE s.kind_id <> 'preflight')   AS not_preflight,
       count(*) FILTER (WHERE ao.late_allowed)             AS late_allowed
  FROM app.offering_activities oa
  JOIN app.activities a           ON a.id = oa.activity_id
  JOIN app.assignment_offerings ao ON ao.id = oa.assignment_offering_id
  JOIN app.assignments s           ON s.id = ao.assignment_id
  JOIN app.course_offerings co     ON co.id = ao.course_offering_id
  JOIN app.courses c               ON c.id = co.course_id
  JOIN app.terms t                 ON t.id = co.term_id
 WHERE oa.delivery IS NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 3, 4
"""

UPDATE_SQL = """
UPDATE app.offering_activities oa
   SET delivery = CASE a.modality WHEN 'written' THEN 'typed_response' ELSE 'interactive_tutor' END,
       grading = CASE a.modality WHEN 'written' THEN 'human_graded' ELSE 'effort' END,
       warn_earns_full = (a.modality = 'written')
  FROM app.activities a
 WHERE a.id = oa.activity_id AND oa.delivery IS NULL AND a.modality IN ('written', 'interactive')
"""


def check_target(url, expect_ref, allow_production):
    """The Target for a URL this run is allowed to write, or exit with the refusal."""
    try:
        target = db_target.parse(url)
    except db_target.DbTargetError as exc:
        sys.exit(str(exc))
    if expect_ref != target.ref:
        sys.exit(f"REFUSED  --expect-ref does not match the project the connection string names ({target.ref}).")
    if target.ref == db_target.STAGING_REF:
        return target
    if target.ref == db_target.PRODUCTION_REF:
        if not allow_production:
            sys.exit("REFUSED  that connection names the live project. Pass --allow-production-write "
                     "only for the course director's own run.")
        return target
    sys.exit(f"REFUSED  the connection names project {target.ref}, which this script does not write.")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url-env", default="STAGING_DB_URL")
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--allow-production-write", action="store_true")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--xid-file", help="append this transaction's id to PATH after a commit")
    args = ap.parse_args(argv)

    url = os.environ.get(args.url_env, "").strip()
    if not url:
        sys.exit(f"REFUSED  environment variable {args.url_env} is not set.")
    target = check_target(url, args.expect_ref, args.allow_production_write)

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    print(f"target   project {target.ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (nothing is written)'}")
    try:
        cur.execute("SET LOCAL lock_timeout = '5s'")
        cur.execute(SCOPE_SQL)
        rows = cur.fetchall()
        total = sum(r[4] for r in rows)
        print("in scope (delivery IS NULL), by course, term, modality and grading role:")
        for course, term, modality, role, n, _np, _la in rows:
            print(f"  {course:<12}{term:<14}{modality:<12}{role:<10}{n}")
        print(f"  total {total}")

        unknown = sorted({r[2] for r in rows} - {"written", "interactive"})
        not_pre = sum(r[5] for r in rows)
        late = sum(r[6] for r in rows)
        problems = []
        if unknown:
            problems.append("modality in scope that the backfill does not know: " + ", ".join(unknown))
        if not_pre:
            problems.append(f"{not_pre} path(s) in scope belong to an item whose kind is not preflight")
        if late:
            problems.append(f"{late} path(s) in scope belong to an item that allows late work")
        if problems:
            conn.rollback()
            for p in problems:
                print("STOP     " + p)
            print("Nothing was written.")
            return 2

        if total == 0:
            conn.rollback()
            print("planned  0 rows. Nothing to do.")
            return 0
        print(f"planned  {total} row(s) in offering_activities: delivery, grading, warn_earns_full")
        if not args.commit:
            conn.rollback()
            print("dry run  nothing written. Add --commit to write.")
            return 0

        cur.execute(UPDATE_SQL)
        written = cur.rowcount
        cur.execute("SELECT count(*) FROM app.offering_activities WHERE delivery IS NULL")
        left = cur.fetchone()[0]
        if written != total or left != 0:
            conn.rollback()
            print(f"STOP     wrote {written} against a plan of {total}, {left} still unfilled. Rolled back.")
            return 2
        cur.execute("SELECT txid_current()")
        xid = cur.fetchone()[0]
        conn.commit()
        print(f"written  {written} row(s). Transaction id {xid}.")
        if args.xid_file:
            with open(args.xid_file, "a", encoding="utf-8") as fh:
                fh.write(f"{xid}\n")
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print(f"FAILED, rolled back. {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
        return 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
