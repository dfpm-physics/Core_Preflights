#!/usr/bin/env python
"""Verify the migration-015 auto-grade trigger, live, in rolled-back transactions (DML tier).

The trigger (grade_interactive_on_commit) fires when a submission commits to a GRADED interactive
activity and writes a finalized, derived grade from the report effort. This exercises it against a
real fixture without leaving anything behind: promote an interactive activity to graded, commit a
submission to it, and assert the grade the trigger created — then roll it all back.

Requires migration 015 applied. If the trigger is absent, every scenario fails loudly rather than
passing silently, which is the point.

Usage (repo root, project venv):
  .venv/Scripts/python supabase/admin/autograde_interactive_test.py
"""
import sys
from pathlib import Path

ADMIN = Path(__file__).resolve().parent
sys.path.insert(0, str(ADMIN))
from app_tier_check import load, connect            # noqa: E402
from psycopg2.extras import RealDictCursor          # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OK, FAIL = "  [ok]  ", "  [FAIL]"
res = []


def check(label, cond, detail=""):
    res.append(cond)
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"  — {detail}"))


def setup(cur):
    """A fixture interactive submission_activity with a known effort we can drive."""
    cur.execute("""
        SELECT sa.id AS sa_id, sa.submission_id, sa.activity_id, s.enrollment_id,
               s.assignment_offering_id AS off, ao.points_possible, sa.content
          FROM submission_activities sa
          JOIN activities  act ON act.id = sa.activity_id AND act.modality = 'interactive'
          JOIN submissions s   ON s.id   = sa.submission_id
          JOIN assignment_offerings ao ON ao.id = s.assignment_offering_id
         WHERE sa.content IS NOT NULL
         ORDER BY sa.updated_at LIMIT 1""")
    return cur.fetchone()


def reset_grade_and_content(cur, fx, effort, meaningful=None):
    """Clear any grade, set the report's effort (+ optional reflection judgment), keep submission draft."""
    cur.execute("DELETE FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s",
                (fx["enrollment_id"], fx["off"]))
    content = {"schema": 1, "effort": effort}
    if meaningful is not None:
        content["reading_reflection"] = {"meaningful": meaningful}
    import json
    cur.execute("UPDATE submission_activities SET content = %s::jsonb WHERE id=%s",
                (json.dumps(content), fx["sa_id"]))
    # Make sure it's uncommitted so the commit below is what fires the trigger.
    cur.execute("""UPDATE submissions SET status='draft', chosen_activity_id=NULL
                    WHERE id=%s""", (fx["submission_id"],))


def set_role(cur, fx, role):
    cur.execute("""UPDATE offering_activities SET grading_role=%s
                    WHERE assignment_offering_id=%s AND activity_id=%s""",
                (role, fx["off"], fx["activity_id"]))


def commit(cur, fx):
    cur.execute("""UPDATE submissions SET status='committed', chosen_activity_id=%s, committed_at=now()
                    WHERE id=%s""", (fx["activity_id"], fx["submission_id"]))


def grade(cur, fx):
    cur.execute("""SELECT effort, points_earned, source, is_finalized, question_scores
                     FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s""",
                (fx["enrollment_id"], fx["off"]))
    return cur.fetchone()


def main():
    cfg, tiers = load()
    conn = connect(cfg, tiers["dml"]); conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET search_path TO app, public;")

    # Trigger present?
    cur.execute("""SELECT 1 FROM pg_trigger
                    WHERE tgrelid='app.submissions'::regclass
                      AND tgname='submissions_autograde_interactive'""")
    if not cur.fetchone():
        print("MIGRATION 015 NOT APPLIED — trigger submissions_autograde_interactive is absent.")
        conn.close(); sys.exit(1)
    print("trigger present.\n")

    fx = setup(cur)
    if not fx:
        print("[skip] no interactive work with content to build a fixture on."); conn.close(); return

    print("1. GRADED interactive: committing auto-creates a finalized derived grade")
    set_role(cur, fx, "graded"); reset_grade_and_content(cur, fx, 5)
    commit(cur, fx)
    g = grade(cur, fx)
    check("a grade row now exists", g is not None)
    if g:
        check("effort copied from the report", g["effort"], f"{g['effort']}")
        check("effort 5 -> full points via the 014 curve",
              float(g["points_earned"]) == float(fx["points_possible"]),
              f"{g['points_earned']} vs {fx['points_possible']}")
        check("auto-final (student-visible)", g["is_finalized"] is True)
        check("source is derived", g["source"] == "derived", str(g["source"]))
        check("no question_scores", g["question_scores"] == {})
    conn.rollback(); cur.execute("SET search_path TO app, public;")

    print("\n2. PRACTICE interactive: committing creates NO grade")
    fx = setup(cur)
    set_role(cur, fx, "practice"); reset_grade_and_content(cur, fx, 5)
    commit(cur, fx)
    check("no grade for a practice commit", grade(cur, fx) is None)
    conn.rollback(); cur.execute("SET search_path TO app, public;")

    print("\n3. §5.2 cap: a non-meaningful reflection caps effort at 2 (half credit)")
    fx = setup(cur)
    set_role(cur, fx, "graded"); reset_grade_and_content(cur, fx, 5, meaningful=False)
    commit(cur, fx)
    g = grade(cur, fx)
    check("effort clamped to 2", g and g["effort"] == 2, str(g and g["effort"]))
    check("2 -> half points", g and float(g["points_earned"]) == float(fx["points_possible"]) / 2,
          str(g and g["points_earned"]))
    conn.rollback(); cur.execute("SET search_path TO app, public;")

    print("\n4. guard: a finalized INSTRUCTOR grade is never clobbered")
    fx = setup(cur)
    set_role(cur, fx, "graded"); reset_grade_and_content(cur, fx, 5)
    cur.execute("""INSERT INTO grades (enrollment_id, assignment_offering_id, points_possible,
                        points_earned, question_scores, source, is_finalized)
                   VALUES (%s,%s,%s, 2, '{"q3":{"score":2}}'::jsonb, 'instructor', true)""",
                (fx["enrollment_id"], fx["off"], fx["points_possible"]))
    commit(cur, fx)
    g = grade(cur, fx)
    check("instructor grade survives the interactive commit",
          g and g["source"] == "instructor" and g["effort"] is None, str(g and g["source"]))
    conn.rollback(); cur.execute("SET search_path TO app, public;")

    print("\n5. no usable effort: no grade invented")
    fx = setup(cur)
    set_role(cur, fx, "graded")
    cur.execute("DELETE FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s",
                (fx["enrollment_id"], fx["off"]))
    cur.execute("""UPDATE submission_activities SET content='{"schema":1}'::jsonb WHERE id=%s""",
                (fx["sa_id"],))
    cur.execute("UPDATE submissions SET status='draft', chosen_activity_id=NULL WHERE id=%s",
                (fx["submission_id"],))
    commit(cur, fx)
    check("no effort in the report -> no grade", grade(cur, fx) is None)
    conn.rollback()

    # Prove nothing persisted.
    cur.execute("SELECT count(*) AS n FROM app.grades WHERE source='derived'")
    leftover = cur.fetchone()["n"]
    check("rollback left no derived grades", leftover == 0, str(leftover))
    conn.close()

    passed = sum(1 for x in res if x)
    print(f"\n{passed}/{len(res)} checks passed.")
    sys.exit(0 if passed == len(res) else 1)


if __name__ == "__main__":
    main()
