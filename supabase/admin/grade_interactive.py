#!/usr/bin/env python
"""grade_interactive.py — carry an interactive submission's effort up to its grade (schema `app`).

THE STEP THIS IS
  Work lives on the activity; points live on the assignment. Every modality needs something that
  carries one up to the other, and the interactive path never had one:

    written      submission_activities.content --> grades.question_scores --> points_earned
                 (/preflight-analyze, Grade tab)                                     [existed]

    interactive  submission_activities.content --> grades.effort --> points_earned
                 {schema:1, effort: 0-5}          (this script)     (DB trigger)     [MISSING]

  The trigger under `grades.effort` has been correct since 001_core_model.sql and had no caller,
  so an interactive submitter got no grade, no points, and a blank gradebook cell. See ROADMAP
  P0.14 for the full diagnosis.

NOW A BACKFILL TOOL
  As of migration 015, a committed interactive submission grades itself via a DB trigger
  (grade_interactive_on_commit). So for every LIVE commit this script is redundant. What it is for:
  interactive work that committed BEFORE the trigger existed, or that a config change makes gradable
  after the fact. It writes the IDENTICAL row the trigger writes (effort, source='derived',
  is_finalized=true), so running it can never disagree with the automatic path.

WHAT IT DOES NOT DO
  It does not judge anything. The effort was assessed by the artifact and already stored; this
  reads it, re-applies the reflection cap as a server-side guard, and writes one grades row. The
  transformation is mechanical — which is exactly why it can be a script rather than a skill.

  Related but different: /interaction-backfill (interaction_reports.py) RECONSTRUCTS a missing
  schema:1 payload from report Markdown. That fills `content`; this reads it. A row with no
  content is reported here as needing that repair, never guessed at.

THE RULES IT ENFORCES (each one is a way this could go wrong)
  * Only `grading_role='graded'` activities. Practice work is recorded, never graded — grading it
    would award points for an assignment the student was told did not count.
  * Only `status='committed'` submissions whose `chosen_activity_id` IS the interactive activity.
    That commitment is the block that decides which of a student's two attempts counts; this
    script reads that decision, it never makes it.
  * `is_finalized=true` and `source='derived'`. The director's decision (2026-07-23): effort IS the
    grade and the artifact already assessed it, so an interactive grade is auto-final and
    student-visible, matching the legacy `public` behaviour. It is NOT 'ai_suggested', so it does
    not sit in the dashboard review queue (faculty-tasks.js) — there is nothing to review. An
    instructor can still reopen one from the Grade tab if a report looks tampered.
  * The §5.2 reflection cap is RE-APPLIED here (effort <= 2 when reading_reflection.meaningful is
    false), not trusted. The payload rides in a URL hash the student controls; the artifact
    applying the cap is not a reason to skip applying it again.
  * A FINALIZED grade is never touched. An instructor-authored grade is never overwritten without
    --force — same posture as faculty-grade.js gradeRows() rule 1, for the same reason: a re-run
    must not quietly relabel a human's work.
  * schema:1 is NOT copied into grades.diagnostic. It already lives on the submission activity,
    which is where /lesson-aggregate reads it for artifact takers (PROJECT.md). One shape, one
    home per modality; duplicating it invites the two copies to disagree.

points_earned IS WRITTEN, AND IS CORRECT BEFORE *AND* AFTER MIGRATION 014
  Written with the same curve the trigger applies, via points_from_effort() imported from
  interaction_reports.py (importing rather than copying — there are three copies of that curve
  already and a fourth would eventually drift).
    * before 014: the old trigger returns early on grading_mode='points', so this value stands.
    * after 014:  the trigger recomputes it from effort to the identical value.
  So this script is useful today, on a sealed database, with no DDL — and stays correct once the
  migration lands.

Usage (from repo root, project venv):
  .venv/Scripts/python supabase/admin/grade_interactive.py status
  .venv/Scripts/python supabase/admin/grade_interactive.py run                      # dry run
  .venv/Scripts/python supabase/admin/grade_interactive.py run --commit
  .venv/Scripts/python supabase/admin/grade_interactive.py run --activity lesson-03-… --commit
"""
import argparse
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

ADMIN = Path(__file__).resolve().parent
sys.path.insert(0, str(ADMIN))

from app_tier_check import load, connect              # noqa: E402
from interaction_reports import points_from_effort    # noqa: E402  — the one curve, not a copy

# reconfigure(), NOT `sys.stdout = TextIOWrapper(sys.stdout.buffer, …)`. Importing
# interaction_reports runs that idiom at module scope; doing it here as well would leave two
# wrappers over one file descriptor, and the first to be collected closes it — every later print
# then dies with "I/O operation on closed file". reconfigure mutates the existing stream instead.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _connect():
    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No PREP_APP_DML_ROLE / _PASSWORD in supabase/admin/.env — see "
                 "app_schema_bootstrap.sql.")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app")
    cur.close()
    return conn


# ── The cap ──────────────────────────────────────────────────────────────────────────
def read_effort(content):
    """The payload's effort as an int 0-5, or None if it is absent or malformed.

    Deliberately strict. `content` is student-controllable (it arrives in a URL hash) and a
    grade depends on it, so anything that is not plainly an integer 0-5 is refused rather than
    coerced — a coerced 'five' or 5.7 would be a silent grade.
    """
    if not isinstance(content, dict):
        return None
    e = content.get("effort")
    if isinstance(e, bool) or not isinstance(e, int):
        return None
    return e if 0 <= e <= 5 else None


def apply_reflection_cap(effort, content):
    """Contract §5.2: no meaningful reading reflection => effort may not exceed 2.

    Returns (effort, capped). Only an explicit `meaningful is False` caps — a missing or null
    judgment is 'not assessed', not 'failed', and must not cost a student points.
    """
    if effort is None:
        return None, False
    rr = content.get("reading_reflection") if isinstance(content, dict) else None
    meaningful = rr.get("meaningful") if isinstance(rr, dict) else None
    if meaningful is False and effort > 2:
        return 2, True
    return effort, False


# ── Selection ────────────────────────────────────────────────────────────────────────
# One query answers both subcommands: `status` reports what it finds, `run` acts on the subset
# that is gradable. Keeping them on the same SELECT is what makes the survey trustworthy — a
# status that used different criteria from the run would be reassuring and wrong.
SELECT_WORK = """
    SELECT sa.id                     AS submission_activity_id,
           sa.content,
           sa.report_markdown IS NOT NULL AS has_markdown,
           s.id                      AS submission_id,
           s.enrollment_id,
           s.assignment_offering_id,
           s.status                  AS submission_status,
           (s.chosen_activity_id = act.id) AS is_chosen,
           oa.grading_role,
           ao.points_possible,
           ao.grading_mode,
           a.slug                    AS assignment_slug,
           act.slug                  AS activity_slug,
           c.code                    AS course_code,
           st.student_id,
           st.name                   AS student_name,
           sec.code                  AS section_code,
           g.id                      AS grade_id,
           g.is_finalized,
           g.source                  AS grade_source,
           g.effort                  AS grade_effort,
           g.points_earned           AS grade_points
      FROM submission_activities sa
      JOIN submissions          s   ON s.id   = sa.submission_id
      JOIN activities           act ON act.id = sa.activity_id AND act.modality = 'interactive'
      JOIN assignments          a   ON a.id   = act.assignment_id
      JOIN assignment_offerings ao  ON ao.id  = s.assignment_offering_id
      JOIN offering_activities  oa  ON oa.assignment_offering_id = ao.id
                                   AND oa.activity_id            = act.id
      JOIN course_offerings     co  ON co.id  = ao.course_offering_id
      JOIN courses              c   ON c.id   = co.course_id
      JOIN enrollments          e   ON e.id   = s.enrollment_id
      JOIN students             st  ON st.student_id = e.student_id
      JOIN sections             sec ON sec.id = e.section_id
      LEFT JOIN grades          g   ON g.enrollment_id          = s.enrollment_id
                                   AND g.assignment_offering_id = s.assignment_offering_id
     WHERE (%(activity)s IS NULL OR act.slug  = %(activity)s)
       AND (%(course)s   IS NULL OR c.code    = %(course)s)
     ORDER BY c.code, a.slug, st.name
"""


def classify(row, force=False):
    """Why this row will or will not be graded. Returns (action, reason).

    Every non-gradable row gets a NAMED reason rather than being filtered out silently. That is
    what lets a run over zero gradable rows still be evidence: 'found 8, skipped 8, here is
    which rule each one hit' is a verified selection path; 'graded 0' is not.
    """
    if row["grading_role"] != "graded":
        return "skip", f"activity is {row['grading_role']} on this offering — not graded"
    if row["submission_status"] != "committed":
        return "skip", f"submission is {row['submission_status']}, not committed"
    if not row["is_chosen"]:
        return "skip", "student committed to a different activity"
    if row["content"] is None:
        return "needs-backfill", "no schema:1 content — run /interaction-backfill first"
    if read_effort(row["content"]) is None:
        return "needs-backfill", "content carries no usable effort (0-5)"
    if row["is_finalized"]:
        return "skip", "grade is finalized — never overwritten"
    if row["grade_source"] == "instructor" and not force:
        return "skip", "grade is instructor-authored (use --force to overwrite)"
    return "grade", ""


def gather(conn, activity=None, course=None, force=False):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(SELECT_WORK, {"activity": activity, "course": course})
    rows = cur.fetchall()
    cur.close()
    out = []
    for r in rows:
        action, reason = classify(r, force=force)
        effort = capped = None
        points = None
        if action == "grade":
            effort, capped = apply_reflection_cap(read_effort(r["content"]), r["content"])
            points = points_from_effort(effort, r["points_possible"])
        out.append({**r, "action": action, "reason": reason,
                    "effort": effort, "capped": capped, "points": points})
    return out


# ── Subcommands ──────────────────────────────────────────────────────────────────────
def cmd_status(args, conn):
    rows = gather(conn, args.activity, args.course)
    if not rows:
        print("No interactive submission activities found for that scope.")
        return 0

    print(f"{'student':22} {'sect':5} {'assignment':14} {'sub':10} {'role':8} "
          f"{'action':14} reason")
    print("-" * 112)
    for r in rows:
        print(f"{(r['student_name'] or '')[:22]:22} {(r['section_code'] or '')[:5]:5} "
              f"{r['assignment_slug'][:14]:14} {r['submission_status'][:10]:10} "
              f"{r['grading_role'][:8]:8} {r['action']:14} {r['reason']}")
    print("-" * 112)

    for action in ("grade", "needs-backfill", "skip"):
        n = sum(1 for r in rows if r["action"] == action)
        if n:
            print(f"  {action:15} {n}")

    graded_now = sum(1 for r in rows if r["grade_id"] and r["grade_effort"] is not None)
    print(f"\n{len(rows)} interactive submission activit(ies); "
          f"{graded_now} already carry an effort grade.")
    return 0


# ── The write ────────────────────────────────────────────────────────────────────────
# Module-level so the test suite exercises THIS statement rather than a paraphrase of it. A test
# that reimplements the SQL it is testing proves only that the author can write it twice.
# Writes the SAME row the migration-015 trigger writes: derived, finalized. The ON CONFLICT WHERE
# mirrors the trigger's guard — replace an unreleased draft or a prior derived (interactive) grade,
# never a finalized instructor/imported one.
UPSERT_GRADE = """
    INSERT INTO grades (enrollment_id, assignment_offering_id, submission_id,
                        effort, points_earned, points_possible, question_scores,
                        source, is_finalized)
         VALUES (%(enr)s, %(off)s, %(sub)s, %(eff)s, %(pts)s, %(poss)s, '{}'::jsonb,
                 'derived', true)
    ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE
            SET effort          = EXCLUDED.effort,
                points_earned   = EXCLUDED.points_earned,
                submission_id   = EXCLUDED.submission_id,
                question_scores = '{}'::jsonb,
                source          = 'derived',
                is_finalized    = true,
                updated_at      = now()
          WHERE grades.is_finalized = false OR grades.source = 'derived'
"""


def write_grade(cur, row):
    """Upsert one grade row. Returns rows affected (0 when a finalized grade blocked it)."""
    cur.execute(UPSERT_GRADE, {
        "enr": row["enrollment_id"], "off": row["assignment_offering_id"],
        "sub": row["submission_id"], "eff": row["effort"],
        "pts": row["points"], "poss": row["points_possible"],
    })
    return cur.rowcount


def cmd_run(args, conn):
    rows = gather(conn, args.activity, args.course, force=args.force)
    todo = [r for r in rows if r["action"] == "grade"]
    backfill = [r for r in rows if r["action"] == "needs-backfill"]
    mode = "COMMIT" if args.commit else "DRY RUN"

    print(f"[{mode}] {len(rows)} interactive activit(ies) in scope; {len(todo)} gradable.")
    if backfill:
        print(f"[note] {len(backfill)} need /interaction-backfill before they can be graded:")
        for r in backfill:
            print(f"       {r['student_name']} · {r['assignment_slug']} — {r['reason']}")
    if not todo:
        # Not a no-op worth hiding: report the rules that excluded everything, so an empty run
        # is legible rather than mysterious.
        skipped = {}
        for r in rows:
            if r["action"] == "skip":
                skipped[r["reason"]] = skipped.get(r["reason"], 0) + 1
        for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
            print(f"[skip] {n:3}  {reason}")
        print("Nothing to grade.")
        return 0

    cur = conn.cursor()
    wrote = 0
    for r in todo:
        cap = " (capped: reflection not meaningful)" if r["capped"] else ""
        prior = "" if r["grade_id"] is None else f"  [was {r['grade_points']}]"
        print(f"  {r['student_name'][:24]:24} {r['assignment_slug']:14} "
              f"effort {r['effort']}/5 -> {r['points']}/{r['points_possible']} pts{cap}{prior}")
        if not args.commit:
            continue
        wrote += write_grade(cur, r)

    if args.commit:
        conn.commit()
        print(f"\nCommitted {wrote} grade row(s).")
    else:
        conn.rollback()
        print(f"\nDRY RUN — nothing written. Re-run with --commit to apply {len(todo)} row(s).")
    cur.close()
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    for name, help_text in (("status", "survey interactive work and why each row is or is not gradable"),
                            ("run", "write grades for gradable interactive submissions")):
        sp = sub.add_parser(name, help=help_text)
        sp.add_argument("--activity", help="limit to one interactive activity slug")
        sp.add_argument("--course", help="limit to one course code (e.g. phys-215)")
        if name == "run":
            sp.add_argument("--commit", action="store_true",
                            help="actually write (default is a dry run)")
            sp.add_argument("--force", action="store_true",
                            help="also overwrite instructor-authored, unfinalized grades")

    args = p.parse_args()
    conn = _connect()
    try:
        return cmd_status(args, conn) if args.cmd == "status" else cmd_run(args, conn)
    finally:
        conn.rollback()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
