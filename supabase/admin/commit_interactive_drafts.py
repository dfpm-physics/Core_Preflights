#!/usr/bin/env python
"""Commit interactive submissions that became gradable after a config change (schema `app`).

THE CASE THIS EXISTS FOR
  A student runs an interactive lesson while it is set up as PRACTICE. The report is recorded on a
  submission_activities row, but the submission is never committed (practice cannot carry credit).
  Later a director switches the interactive activity to GRADED (e.g. flips the assignment to
  student-choice). Nothing reaches back to commit the work already sitting there, so those students
  show no grade — the auto-grade trigger (migration 015) fires on COMMIT, and their commit never
  happened. This commits them, which fires that trigger and grades them.

  It is the "flip the setting and it should pick up the existing interactions" behaviour, done as an
  explicit, inspectable backfill rather than an automatic side effect of a config toggle.

WHAT IT WILL AND WON'T TOUCH — each rule is a way this could go wrong:
  * GRADED interactive activities only. If the interactive is still practice, there is nothing to
    commit and it is skipped.
  * The student must have interactive work with a usable effort (0-5). No effort -> not gradable ->
    skipped (run /interaction-backfill first if the report_data is missing).
  * The submission must NOT already be committed to a DIFFERENT activity. If a student committed the
    written path, that is their choice and their grade; this never overrides it.
  * A finalized instructor/imported grade is never disturbed (the 015 trigger's own guard also
    protects it, but this skips such rows before committing so it does not even fire).
  * Idempotent: a submission already committed to the interactive with a grade is left alone.

  Commit = set chosen_activity_id + status='committed'. submissions_check_gradable() still enforces
  that the chosen activity is graded, and the 015 trigger writes the finalized derived grade. This
  script writes NO grade itself — it only commits, and lets the same trigger a live submit would.

Dry-run by default; --commit to write. Scope with --offering / --activity / --course.

Usage (repo root, project venv):
  .venv/Scripts/python supabase/admin/commit_interactive_drafts.py status
  .venv/Scripts/python supabase/admin/commit_interactive_drafts.py run --activity lesson-02-electric-charge-coulombs-law
  .venv/Scripts/python supabase/admin/commit_interactive_drafts.py run --activity lesson-02-electric-charge-coulombs-law --commit
"""
import argparse
import sys
from pathlib import Path

ADMIN = Path(__file__).resolve().parent
sys.path.insert(0, str(ADMIN))
from app_tier_check import load, connect              # noqa: E402
from psycopg2.extras import RealDictCursor            # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _connect():
    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No PREP_APP_DML_ROLE / _PASSWORD in supabase/admin/.env.")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app")
    cur.close()
    return conn


SELECT = """
    SELECT s.id AS submission_id, s.status, s.chosen_activity_id,
           s.enrollment_id, s.assignment_offering_id,
           act.id AS interactive_id, act.slug AS activity_slug,
           a.slug AS assignment_slug, c.code AS course,
           st.name AS student_name, sec.code AS section,
           oa.grading_role,
           (sa.content->>'effort') AS effort_txt,
           jsonb_typeof(sa.content->'effort') AS effort_type,
           g.id AS grade_id, g.is_finalized, g.source AS grade_source, g.points_earned
      FROM submission_activities sa
      JOIN activities           act ON act.id = sa.activity_id AND act.modality = 'interactive'
      JOIN submissions          s   ON s.id   = sa.submission_id
      JOIN assignment_offerings ao  ON ao.id  = s.assignment_offering_id
      JOIN offering_activities  oa  ON oa.assignment_offering_id = ao.id AND oa.activity_id = act.id
      JOIN assignments          a   ON a.id   = act.assignment_id
      JOIN course_offerings     co  ON co.id  = ao.course_offering_id
      JOIN courses              c   ON c.id   = co.course_id
      JOIN enrollments          e   ON e.id   = s.enrollment_id
      JOIN students             st  ON st.student_id = e.student_id
      JOIN sections             sec ON sec.id = e.section_id
      LEFT JOIN grades          g   ON g.enrollment_id = s.enrollment_id
                                   AND g.assignment_offering_id = s.assignment_offering_id
     WHERE (%(offering)s IS NULL OR ao.id::text   = %(offering)s)
       AND (%(activity)s IS NULL OR act.slug      = %(activity)s)
       AND (%(course)s   IS NULL OR c.code        = %(course)s)
     ORDER BY c.code, a.slug, st.name
"""


def classify(r):
    if r["grading_role"] != "graded":
        return "skip", "interactive is practice on this offering — not graded"
    if r["effort_type"] != "number" or r["effort_txt"] is None or not r["effort_txt"].lstrip("-").isdigit():
        return "skip", "no usable effort in the report (run /interaction-backfill)"
    if r["chosen_activity_id"] and r["chosen_activity_id"] != r["interactive_id"]:
        return "skip", "committed to a different activity — the student's choice stands"
    if r["is_finalized"] and r["grade_source"] in ("instructor", "imported"):
        return "skip", "a human-graded response already exists"
    if r["status"] == "committed" and r["chosen_activity_id"] == r["interactive_id"] \
            and r["grade_id"] is not None:
        return "skip", "already committed and graded"
    return "commit", ""


def gather(conn, args):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(SELECT, {"offering": args.offering, "activity": args.activity, "course": args.course})
    rows = cur.fetchall()
    cur.close()
    return [{**r, "_action": classify(r)[0], "_reason": classify(r)[1]} for r in rows]


def cmd_status(conn, args):
    rows = gather(conn, args)
    if not rows:
        print("No interactive submissions in scope.")
        return 0
    print(f"{'student':22} {'sect':5} {'assignment':13} {'status':10} {'action':8} reason")
    print("-" * 100)
    for r in rows:
        print(f"{(r['student_name'] or '')[:22]:22} {(r['section'] or '')[:5]:5} "
              f"{r['assignment_slug'][:13]:13} {r['status'][:10]:10} {r['_action']:8} {r['_reason']}")
    n = sum(1 for r in rows if r["_action"] == "commit")
    print("-" * 100)
    print(f"{n} of {len(rows)} would be committed (and auto-graded).")
    return 0


def cmd_run(conn, args):
    rows = gather(conn, args)
    todo = [r for r in rows if r["_action"] == "commit"]
    mode = "COMMIT" if args.commit else "DRY RUN"
    print(f"[{mode}] {len(todo)} of {len(rows)} interactive submission(s) to commit + auto-grade.")
    if not todo:
        for r in rows:
            if r["_action"] == "skip":
                print(f"  [skip] {r['student_name']} · {r['assignment_slug']} — {r['_reason']}")
        return 0

    cur = conn.cursor()
    done = 0
    for r in todo:
        # Committing fires submissions_autograde_interactive (migration 015), which writes the grade.
        cur.execute("""UPDATE submissions
                          SET chosen_activity_id = %s, status = 'committed', committed_at = now()
                        WHERE id = %s""", (r["interactive_id"], r["submission_id"]))
        eff = r["effort_txt"]
        print(f"  {r['student_name'][:24]:24} {r['assignment_slug']:13} committed → effort {eff}/5")
        if args.commit:
            # Read back the grade the trigger just wrote, as confirmation.
            cur.execute("""SELECT points_earned, effort, source, is_finalized FROM grades
                            WHERE enrollment_id=%s AND assignment_offering_id=%s""",
                        (r["enrollment_id"], r["assignment_offering_id"]))
            g = cur.fetchone()
            print(f"      → grade: {g[0]}/2 pts, effort {g[1]}, {g[2]}, "
                  f"{'finalized' if g[3] else 'draft'}")
        done += 1

    if args.commit:
        conn.commit()
        print(f"\nCommitted {done} submission(s); the trigger graded each.")
    else:
        conn.rollback()
        print(f"\nDRY RUN — nothing written. Re-run with --commit to apply {done}.")
    cur.close()
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("status", "run"):
        sp = sub.add_parser(name)
        sp.add_argument("--offering", help="assignment_offering id")
        sp.add_argument("--activity", help="interactive activity slug")
        sp.add_argument("--course", help="course code, e.g. phys-215")
        if name == "run":
            sp.add_argument("--commit", action="store_true", help="actually write (default dry-run)")
    args = p.parse_args()
    conn = _connect()
    try:
        return cmd_status(conn, args) if args.cmd == "status" else cmd_run(conn, args)
    finally:
        conn.rollback()
        conn.close()


if __name__ == "__main__":
    main()
