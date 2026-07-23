#!/usr/bin/env python
"""Verify grade_interactive.py — the curve, the reflection cap, and the live write path.

WHY THIS FILE EXISTS AT ALL
  A `run` against the database today grades **zero** rows: the only interactive work in the term
  is `preflight-02`, whose interactive activity is `grading_role='practice'` on purpose. So the
  script's real behaviour — does it select the right rows, apply the cap, write the right points —
  cannot be observed in production without first changing production. That is not a reason to ship
  it unverified; it is a reason to construct the scenario and roll it back.

TWO LAYERS
  1. Pure logic, no database: the effort curve and the §5.2 reflection cap, including the
     malformed-payload cases that decide whether a student is graded on a value they controlled.
  2. Live end-to-end, inside ONE transaction that is ALWAYS rolled back: promote an existing
     interactive activity to `graded`, commit a real submission to it, run the script's own
     selection and its own INSERT statement, then assert the grade row that comes back.

  Layer 2 imports `SELECT_WORK` and `write_grade` from the script rather than restating them. A
  test that paraphrases the SQL it is testing proves only that the author can write it twice.

NOTHING IS PERSISTED
  The transaction is rolled back in a `finally`, and the connection is opened with
  autocommit=False. The row counts printed at the end are re-read after the rollback as proof.

WHAT THIS CANNOT COVER
  Migration 014 is not applied (it needs `prep_app_owner` unsealed — CORE.md §0), and the DML tier
  cannot CREATE OR REPLACE a function. So the NEW trigger behaviour is unverified here by
  construction. What layer 2 *does* prove is the claim that matters before 014 lands: with the OLD
  trigger and `grading_mode='points'`, the script's own `points_earned` stands and is correct.
  Re-run this after applying 014 — it should pass unchanged, with the trigger now recomputing the
  identical value.

Usage (from repo root, project venv):
  .venv/Scripts/python supabase/admin/grade_interactive_test.py
"""
import sys
from decimal import Decimal
from pathlib import Path

ADMIN = Path(__file__).resolve().parent
sys.path.insert(0, str(ADMIN))

from psycopg2.extras import RealDictCursor                      # noqa: E402
from grade_interactive import (                                 # noqa: E402
    _connect, read_effort, apply_reflection_cap, classify,
    points_from_effort, SELECT_WORK, write_grade,
)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OK, FAIL = "  [ok]  ", "  [FAIL]"
_results = []


def check(label, got, want):
    ok = got == want
    _results.append(ok)
    print(f"{OK if ok else FAIL} {label}" + ("" if ok else f"  — got {got!r}, want {want!r}"))
    return ok


# ══════════════════════════════════════════════════════════════════════════════════════
# 1. Pure logic
# ══════════════════════════════════════════════════════════════════════════════════════
def test_curve():
    """The course policy, stated by the director 2026-07-23: 0 -> 0, 1-2 -> 1, 3+ -> 2."""
    print("\n=== the effort curve at points_possible = 2 ===")
    for effort, want in ((0, 0), (1, 1), (2, 1), (3, 2), (4, 2), (5, 2)):
        check(f"effort {effort} -> {want} pt(s)",
              points_from_effort(effort, Decimal("2")), Decimal(want))
    # Scaling is the reason the curve is expressed against points_possible rather than hardcoded.
    check("effort 2 on a 10-point assignment -> 5", points_from_effort(2, Decimal("10")),
          Decimal("5"))


def test_read_effort():
    """A grade depends on this value and a student controls the payload it arrives in."""
    print("\n=== reading effort out of a student-controllable payload ===")
    check("plain int",            read_effort({"effort": 4}), 4)
    check("zero is a real score", read_effort({"effort": 0}), 0)
    check("above range refused",  read_effort({"effort": 6}), None)
    check("negative refused",     read_effort({"effort": -1}), None)
    check("string not coerced",   read_effort({"effort": "5"}), None)
    check("float not coerced",    read_effort({"effort": 4.9}), None)
    # bool is an int subclass in Python — True would otherwise silently grade as effort 1.
    check("bool refused",         read_effort({"effort": True}), None)
    check("absent",               read_effort({"schema": 1}), None)
    check("not an object",        read_effort("effort: 5"), None)
    check("null content",         read_effort(None), None)


def test_reflection_cap():
    """Contract §5.2 — no meaningful reading reflection caps effort at 2 (=> at most 1 point)."""
    print("\n=== the reading-reflection cap ===")
    not_meaningful = {"reading_reflection": {"meaningful": False}}
    meaningful = {"reading_reflection": {"meaningful": True}}

    check("5 capped to 2", apply_reflection_cap(5, not_meaningful), (2, True))
    check("3 capped to 2", apply_reflection_cap(3, not_meaningful), (2, True))
    check("2 already at the cap, not flagged", apply_reflection_cap(2, not_meaningful), (2, False))
    check("1 below the cap untouched", apply_reflection_cap(1, not_meaningful), (1, False))
    check("meaningful reflection: 5 stands", apply_reflection_cap(5, meaningful), (5, False))
    # 'Not assessed' must not cost points — only an explicit false caps.
    check("no judgment recorded: 5 stands", apply_reflection_cap(5, {}), (5, False))
    check("null judgment: 5 stands",
          apply_reflection_cap(5, {"reading_reflection": {"meaningful": None}}), (5, False))

    # The cap is what makes a capped student land on 1 point rather than 2.
    capped, _ = apply_reflection_cap(5, not_meaningful)
    check("capped effort scores 1 of 2", points_from_effort(capped, Decimal("2")), Decimal("1"))


def test_classify():
    """Every exclusion is a rule somebody could argue with, so each one is pinned."""
    print("\n=== which rows are gradable ===")
    base = {"grading_role": "graded", "submission_status": "committed", "is_chosen": True,
            "content": {"effort": 4}, "is_finalized": False, "grade_source": None}

    check("committed, graded, has effort", classify(base)[0], "grade")
    check("practice is never graded",
          classify({**base, "grading_role": "practice"})[0], "skip")
    check("draft is not gradable",
          classify({**base, "submission_status": "draft"})[0], "skip")
    check("committed to the other activity",
          classify({**base, "is_chosen": False})[0], "skip")
    check("no content -> backfill, never guessed",
          classify({**base, "content": None})[0], "needs-backfill")
    check("unusable effort -> backfill",
          classify({**base, "content": {"schema": 1}})[0], "needs-backfill")
    check("finalized is never overwritten",
          classify({**base, "is_finalized": True})[0], "skip")
    check("instructor grade protected by default",
          classify({**base, "grade_source": "instructor"})[0], "skip")
    check("instructor grade overwritable with --force",
          classify({**base, "grade_source": "instructor"}, force=True)[0], "grade")
    check("an ai_suggested grade is re-gradable (idempotent re-run)",
          classify({**base, "grade_source": "ai_suggested"})[0], "grade")


# ══════════════════════════════════════════════════════════════════════════════════════
# 2. Live, in a transaction that is always rolled back
# ══════════════════════════════════════════════════════════════════════════════════════
def test_live_write(conn):
    """Construct the scenario the term does not have yet, grade it, assert it, roll it back."""
    print("\n=== live end-to-end (rolled back) ===")
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT sa.id, sa.submission_id, s.enrollment_id, s.assignment_offering_id,
               act.id AS activity_id, act.slug AS activity_slug, sa.content
          FROM submission_activities sa
          JOIN activities  act ON act.id = sa.activity_id AND act.modality = 'interactive'
          JOIN submissions s   ON s.id   = sa.submission_id
         WHERE sa.content IS NOT NULL
         ORDER BY sa.updated_at LIMIT 1
    """)
    row = cur.fetchone()
    if not row:
        print("  [skip] no interactive work with structured content — nothing to exercise.")
        return
    print(f"  fixture: {row['activity_slug']} (submission {str(row['submission_id'])[:8]}…)")

    # Reset the fixture to a clean ungraded draft first — real interactive takers are committed and
    # graded now (the live trigger + backfill), so without this the fixture already has a finalized
    # grade and classify() would skip it. The un-commit needs unlocked_by (lock guard 006); the DML
    # connection has a NULL current_uid(), so any instructor id satisfies it. All rolled back.
    cur.execute("DELETE FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s",
                (row["enrollment_id"], row["assignment_offering_id"]))
    cur.execute("""UPDATE submissions SET status='draft', chosen_activity_id=NULL,
                          unlocked_by=(SELECT id FROM instructors LIMIT 1), unlocked_at=now()
                    WHERE id=%s""", (row["submission_id"],))

    # Promote to the state a real graded interactive lesson will be in. Both writes are undone.
    cur.execute("""UPDATE offering_activities SET grading_role = 'graded'
                    WHERE assignment_offering_id = %s AND activity_id = %s""",
                (row["assignment_offering_id"], row["activity_id"]))
    cur.execute("""UPDATE submissions
                      SET chosen_activity_id = %s, status = 'committed', committed_at = now()
                    WHERE id = %s""", (row["activity_id"], row["submission_id"]))

    # That commit fires the live migration-015 trigger, which auto-grades it. This script is the
    # BACKFILL for work that committed BEFORE the trigger existed, so delete the trigger's grade to
    # recreate that "committed but ungraded" state — which is what the script is meant to fill.
    cur.execute("DELETE FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s",
                (row["enrollment_id"], row["assignment_offering_id"]))

    # The script's own selection, over the scenario we just built.
    cur.execute(SELECT_WORK, {"activity": row["activity_slug"], "course": None})
    picked = [r for r in cur.fetchall() if r["submission_id"] == row["submission_id"]]
    check("selection finds the committed submission", len(picked), 1)
    if not picked:
        return
    r = picked[0]
    check("classified gradable", classify(r)[0], "grade")

    effort, capped = apply_reflection_cap(read_effort(r["content"]), r["content"])
    points = points_from_effort(effort, r["points_possible"])
    print(f"  effort {effort}/5{' (capped)' if capped else ''} "
          f"-> {points}/{r['points_possible']} pts")

    # The script's own INSERT.
    n = write_grade(cur, {**r, "effort": effort, "points": points})
    check("one grade row written", n, 1)

    cur.execute("""SELECT effort, points_earned, points_possible, source, is_finalized,
                          submission_id, question_scores
                     FROM grades
                    WHERE enrollment_id = %s AND assignment_offering_id = %s""",
                (r["enrollment_id"], r["assignment_offering_id"]))
    g = cur.fetchone()
    check("effort stored", g["effort"], effort)
    check("points match the curve", g["points_earned"], points)
    check("auto-final: interactive is finalized on write", g["is_finalized"], True)
    check("source is derived (auto-final, not a review-queue item)", g["source"], "derived")
    check("linked to the submission", g["submission_id"], r["submission_id"])
    # The migration-014 guard: an effort-graded row must carry no question_scores.
    check("no question_scores — satisfies grades_one_grading_mechanism", g["question_scores"], {})

    # Idempotence: a second run must not double-write. And because the existing row is DERIVED, a
    # re-submit IS allowed to update it in place (the guard only protects human-graded work).
    n2 = write_grade(cur, {**r, "effort": effort, "points": points})
    cur.execute("""SELECT count(*) AS n FROM grades
                    WHERE enrollment_id = %s AND assignment_offering_id = %s""",
                (r["enrollment_id"], r["assignment_offering_id"]))
    check("re-run updates in place, never duplicates", cur.fetchone()["n"], 1)
    check("a derived finalized grade is re-writable (re-submit)", n2, 1)

    # But an INSTRUCTOR-finalized grade is untouchable — the rule that protects published human
    # work. "Auto-grade the interaction as long as there wasn't a response already graded."
    cur.execute("""UPDATE grades SET is_finalized = true, source = 'instructor'
                    WHERE enrollment_id = %s AND assignment_offering_id = %s""",
                (r["enrollment_id"], r["assignment_offering_id"]))
    n3 = write_grade(cur, {**r, "effort": 0, "points": Decimal("0")})
    check("an instructor-finalized grade refuses the write", n3, 0)
    cur.execute("""SELECT points_earned FROM grades
                    WHERE enrollment_id = %s AND assignment_offering_id = %s""",
                (r["enrollment_id"], r["assignment_offering_id"]))
    check("instructor-finalized points unchanged", cur.fetchone()["points_earned"], points)


def main():
    test_curve()
    test_read_effort()
    test_reflection_cap()
    test_classify()

    conn = _connect()
    # Baselines BEFORE the test — real interactive takers are committed and graded in production now,
    # so the rollback proof compares against these counts rather than expecting zero.
    bcur = conn.cursor()
    bcur.execute("SELECT count(*) FROM app.grades WHERE effort IS NOT NULL")
    base_effort = bcur.fetchone()[0]
    bcur.execute("""SELECT count(*) FROM app.submissions s
                     JOIN app.activities a ON a.id = s.chosen_activity_id
                    WHERE a.modality = 'interactive'""")
    base_committed = bcur.fetchone()[0]
    # No rollback here: it would revert the search_path _connect() set. These were read-only.
    try:
        test_live_write(conn)
    finally:
        conn.rollback()
        # Prove the rollback added nothing. Schema-qualified deliberately: a plain `SET search_path`
        # is itself transactional, so the rollback that just proved the point also reverted it.
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM app.grades WHERE effort IS NOT NULL")
        left = cur.fetchone()[0]
        cur.execute("""SELECT count(*) FROM app.submissions s
                         JOIN app.activities a ON a.id = s.chosen_activity_id
                        WHERE a.modality = 'interactive'""")
        committed = cur.fetchone()[0]
        conn.close()
        clean = left == base_effort and committed == base_committed
        print(f"\n[rollback] grades carrying an effort: {left} (baseline {base_effort})")
        print(f"[rollback] submissions committed to an interactive activity: {committed} "
              f"(baseline {base_committed})")
        _results.append(clean)
        print(f"{OK if clean else FAIL} rollback added nothing")

    passed, total = sum(1 for r in _results if r), len(_results)
    print(f"\n{passed}/{total} checks passed.")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
