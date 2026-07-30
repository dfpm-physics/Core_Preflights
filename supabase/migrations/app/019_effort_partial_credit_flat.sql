-- PREP v2 — partial credit on the effort curve is ONE POINT, not half the assignment
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 014_effort_grades_per_row.sql.
--
-- WHY THIS EXISTS
--   The curve has said "half credit" since migration 013, when there was nothing to scale: every
--   interaction was worth 2 points and half of 2 is 1. `app` made a lesson's value per-offering
--   data, and 001/014 carried the rule forward as `points_possible / 2` — which is the same number
--   at 2 points and a DIFFERENT KIND of number anywhere else.
--
--   Physics 310 is the first course to be worth anything else. Its two lessons are 3 points, so a
--   partially-engaged interactive taker scored **1.50** — a half point that:
--
--     * no written taker on the same assignment can produce (0 + 1 + 2 give integer totals only),
--       so on a Choice lesson one column would hold two incompatible grids;
--     * is not a grade anybody would award by hand;
--     * gets worse, not better, as assignments get more valuable (a 5-point lesson would pay 2.50).
--
--   The director's rule, confirmed 2026-07-30: engaging at all earns **one point**; engaging
--   properly earns **the assignment**. Partial credit is a flat acknowledgement, not a fraction.
--
-- THE NEW CURVE
--       effort 0        ->  0
--       effort 1-2      ->  LEAST(1, points_possible)
--       effort 3-5      ->  points_possible
--
--   `LEAST` is the whole difference between this and a bare `1`. The Points box in the lesson
--   editor accepts any value (`<input type="number" min="0" step="0.1">`), so a 1-point or
--   half-point assignment is authorable today — and on one, a flat 1 would pay FULL credit for
--   partial effort, or breach `grades_within_bounds` (points_earned <= points_possible) and reject
--   the write outright. Clamping costs one function call and removes both.
--
-- WHAT CHANGES FOR EXISTING DATA: NOTHING. Verified against live before writing.
--   213 grade rows exist. 78 carry an effort, and every one of them is on a `points_possible =
--   2.00` offering, where the old rule and the new one are the same number:
--       old: round(2.00 / 2, 2) = 1.00      new: LEAST(1, 2.00) = 1.00
--   The only offerings worth anything else are the two phys-310 lessons (3.00), and neither has a
--   graded interactive activity yet — so not one stored `points_earned` moves. No backfill, no
--   recomputation, nothing to reconcile. This is a forward-looking policy change that happens to
--   have a zero-row migration.
--
-- SIX COPIES OF THIS CURVE MUST AGREE
--   This function is authoritative — it overwrites points_earned on every write — but five other
--   places compute the same number to DISPLAY it, and a disagreement shows a student one score
--   while the gradebook stores another. All six change in the same commit as this migration:
--       app.grades_points_from_effort()   this file
--       pointsFromEffort()                site/js/schema.js
--       pointsForEffort()                 site/js/faculty-rollup.js
--       points_from_effort()              supabase/admin/interaction_reports.py
--       _points_for_effort()              supabase/admin/lesson_aggregate.py
--       (grade_interactive.py imports the interaction_reports.py one rather than copying it.)
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   The §5.2 reading-reflection cap (effort clamped to 2 when the reflection is not meaningful) is
--   untouched, and still lands a capped student on partial credit — now 1 point rather than half
--   the assignment, which is the same intent stated in the same units as the rest of the curve.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION grades_points_from_effort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- No effort on this row => it is not effort-graded => points_earned is somebody else's to set
  -- (question_scores, an importer, an instructor by hand). Leave it entirely alone. Unchanged
  -- from 014, and the reason a written taker's question-scored total survives this trigger.
  IF NEW.effort IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.points_earned := CASE
    WHEN NEW.effort >= 3 THEN NEW.points_possible
    WHEN NEW.effort >= 1 THEN LEAST(1::numeric, NEW.points_possible)
    ELSE 0
  END;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION grades_points_from_effort() IS
  'effort -> points: 3-5 -> points_possible, 1-2 -> one point (clamped to points_possible so a '
  'sub-1-point assignment cannot pay full credit for partial effort), 0 -> zero. Keys on the grade '
  'ROW rather than the offering (014): a row carrying an effort IS effort-graded, whatever '
  'assignment_offerings.grading_mode says. That is what lets one offering grade an interactive '
  'taker by effort and a written taker by question_scores. Never write points_earned directly on a '
  'row that carries an effort; this overwrites it. Five display-side copies of this curve must '
  'agree with it — see 019_effort_partial_credit_flat.sql.';

-- The trigger itself is unchanged (grades_effort, BEFORE INSERT OR UPDATE on grades) and is not
-- recreated. Neither is grades_one_grading_mechanism.

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the curve, without writing anything
--   SELECT pp, e,
--          CASE WHEN e >= 3 THEN pp WHEN e >= 1 THEN LEAST(1::numeric, pp) ELSE 0 END AS points
--     FROM generate_series(0,5) e, (VALUES (2.00::numeric), (3.00::numeric), (1.00::numeric)) v(pp)
--    ORDER BY pp, e;
--
--   -- nothing moved: every stored effort grade still agrees with the live trigger
--   SELECT count(*) AS must_be_zero FROM app.grades
--    WHERE effort IS NOT NULL
--      AND points_earned IS DISTINCT FROM
--          CASE WHEN effort >= 3 THEN points_possible
--               WHEN effort >= 1 THEN LEAST(1::numeric, points_possible) ELSE 0 END;
--
--   .venv/Scripts/python supabase/admin/grade_interactive_test.py
--   .venv/Scripts/python supabase/admin/autograde_interactive_test.py
-- =====================================================================================
