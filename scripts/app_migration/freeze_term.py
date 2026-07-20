#!/usr/bin/env python
"""Freeze what a term's cohort actually saw, at term close.

DRY RUN BY DEFAULT per CORE.md: performs the freeze inside a transaction, prints the result,
then rolls back. Pass --commit to keep it. Idempotent — already-frozen offerings are skipped
unless --force.

WHY THIS EXISTS
  An interactive activity is a slug plus an artifact URL. Rebuilding the artifact for a later
  term means overwriting that URL in place, which keeps one stable slug per lesson forever but
  would otherwise erase the record of what the previous cohort ran. Freezing at term close
  captures it first.

WHEN TO RUN
  At or after terms.grades_due_on. `--status` lists terms that are overdue.

Usage:
  .venv/Scripts/python scripts/app_migration/freeze_term.py --status
  .venv/Scripts/python scripts/app_migration/freeze_term.py fall-2026
  .venv/Scripts/python scripts/app_migration/freeze_term.py fall-2026 --commit
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("term", nargs="?", help="term code, e.g. fall-2026")
    ap.add_argument("--commit", action="store_true", help="keep the freeze; otherwise roll back")
    ap.add_argument("--force", action="store_true", help="re-freeze already-frozen offerings")
    ap.add_argument("--status", action="store_true", help="list terms awaiting a freeze")
    args = ap.parse_args()

    cfg, tiers = load()
    tier = "dml" if "dml" in tiers else "owner"
    conn = connect(cfg, tiers[tier])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    if args.status or not args.term:
        cur.execute("""SELECT code, label, ends_on, grades_due_on, offerings, frozen,
                              unfrozen, past_due
                         FROM terms_awaiting_freeze ORDER BY ends_on""")
        rows = cur.fetchall()
        if not rows:
            print("Every term's offerings are frozen. Nothing to do.")
        else:
            print(f"{'term':<12} {'ends':<12} {'grades due':<12} {'offerings':>9} "
                  f"{'frozen':>7} {'left':>6}   status")
            for code, label, ends, due, tot, fz, un, past in rows:
                print(f"{code:<12} {str(ends):<12} {str(due):<12} {tot:>9} {fz:>7} {un:>6}   "
                      f"{'PAST DUE — should be sealed' if past else 'term still open'}")
        conn.rollback(); conn.close()
        return

    print(f"{'DRY RUN — will roll back' if not args.commit else 'COMMITTING'}\n")
    cur.execute("SELECT * FROM freeze_term(%s, %s)", (args.term, args.force))
    rows = cur.fetchall()
    if not rows:
        print(f"No assignment offerings found for term '{args.term}'.")
        conn.rollback(); conn.close(); sys.exit(1)

    by_outcome = {}
    for course, assignment, outcome in rows:
        key = outcome.split("—")[0].strip()
        by_outcome.setdefault(key, []).append(f"{course}/{assignment}")
    for outcome, items in sorted(by_outcome.items()):
        print(f"  {len(items):>4}  {outcome}")
        for it in items[:3]:
            print(f"          {it}")
        if len(items) > 3:
            print(f"          … and {len(items) - 3} more")

    # Show one snapshot so the operator can see what was actually captured.
    cur.execute("""SELECT c.code, a.slug,
                          jsonb_pretty(jsonb_build_object(
                            'activities', ao.content_snapshot->'activities',
                            'points_possible', ao.content_snapshot->'points_possible',
                            'section_due_dates', ao.content_snapshot->'section_due_dates'))
                     FROM assignment_offerings ao
                     JOIN assignments a       ON a.id  = ao.assignment_id
                     JOIN course_offerings co ON co.id = ao.course_offering_id
                     JOIN courses c           ON c.id  = co.course_id
                    WHERE ao.content_snapshot ? 'activities'
                      AND jsonb_array_length(ao.content_snapshot->'activities') > 1
                    LIMIT 1""")
    sample = cur.fetchone()
    if sample:
        print(f"\nSample snapshot — {sample[0]}/{sample[1]} (an assignment with two activities):")
        for line in sample[2].splitlines():
            print("  " + line)

    if args.commit:
        conn.commit()
        print("\nCOMMITTED — these offerings are now immutable.")
    else:
        conn.rollback()
        print("\nRolled back — dry run. Re-run with --commit to seal the term.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
