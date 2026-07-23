-- PREP v2 — effort grading keys on the grade row, not on the offering
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql.
--
-- WHY THIS EXISTS
--   `grading_mode` is a single column on `assignment_offerings`, so it can express "this whole
--   assignment is effort-graded" or "this whole assignment is points-graded" — and nothing else.
--   That was sufficient while an offering carried one graded activity.
--
--   It is no longer true. The authoring UI's three-way policy control (faculty-lessons.js
--   `roleFor()`) offers **choice**, which marks BOTH the written and the interactive activity
--   `grading_role='graded'` and lets each student pick. `preflight-03` and `preflight-04` are set
--   that way today. On a choice assignment the grading mechanism is a property of the STUDENT —
--   of which activity they committed to — and one column on the offering cannot say
--   "points if they wrote it, effort if they interacted".
--
-- THE BUG THIS CLOSES, WHICH IS WORSE THAN THE GAP IT CLOSES
--   The obvious workaround — set `grading_mode='effort'` on a choice offering — is silent data
--   loss. The old trigger assigned `points_earned` UNCONDITIONALLY once the mode matched, and
--   mapped NULL effort to 0. Every *written* taker on that offering (scored 2/2 through
--   `question_scores`, `effort` correctly NULL per WRITTEN-SCHEMA1.md:118-121) would have been
--   rewritten to **0 points** on their next save. Nobody has done this; the door is now shut.
--
-- THE NEW RULE, IN ONE LINE
--   A grade row carrying an `effort` IS an effort-graded row. That is the whole contract.
--
--   It replaces a rule that lived in prose ("never write effort into grades.effort on a
--   points-mode offering") with one the database enforces, and it makes the two paths orthogonal
--   instead of mutually exclusive:
--
--     interactive taker  ->  effort set, question_scores '{}'  ->  trigger derives points_earned
--     written taker      ->  effort NULL, question_scores set  ->  trigger does not fire at all
--
--   The same offering now serves both, which is exactly what `grading_role='graded'` on two
--   activities always promised.
--
-- WHAT CHANGES FOR EXISTING DATA: NOTHING.
--   Every grade row in the database today (64, all `preflight-02` written) has `effort IS NULL`,
--   so the trigger stops firing for them where before it returned early on `grading_mode='points'`
--   — the same no-op by a different route. Verified 2026-07-23 before writing this.
--
-- BEHAVIOUR CHANGE WORTH STATING
--   Previously, on a `grading_mode='effort'` offering, a grade row with NULL effort was forced to
--   `points_earned = 0`. Now it is left alone. To record a zero, write `effort = 0`, which maps to
--   0 points by the curve below. No offering is `grading_mode='effort'` today, so nothing observes
--   the old behaviour; a student who submitted nothing has no grade row at all, which is the case
--   that rule appeared to serve.
--
-- `grading_mode` IS NOT DROPPED and is still read
--   `displayPoints()` (site/app/js/schema.js:377-383) consults it. It no longer selects the
--   grading mechanism — it is advisory for display. Dropping it is a separate decision with
--   frontend consequences; this migration deliberately does not take it.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

-- -------------------------------------------------------------------------------------
-- 1. The trigger function — same curve, new gate
-- -------------------------------------------------------------------------------------
-- The curve itself is UNCHANGED and must stay identical to its two other copies:
--   points_from_effort()  supabase/admin/interaction_reports.py
--   pointsFromEffort()    site/app/js/schema.js
-- (grade_interactive.py imports the Python one rather than adding a fourth.)
-- At points_possible = 2 it is the course policy verbatim: 0 -> 0, 1-2 -> 1, 3+ -> 2.
--
-- The offering lookup is gone, which also removes a SELECT on assignment_offerings from every
-- grade write.
CREATE OR REPLACE FUNCTION grades_points_from_effort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- No effort on this row => it is not effort-graded => points_earned is somebody else's to set
  -- (question_scores, an importer, an instructor by hand). Leave it entirely alone.
  IF NEW.effort IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.points_earned := CASE
    WHEN NEW.effort >= 3 THEN NEW.points_possible
    WHEN NEW.effort >= 1 THEN round(NEW.points_possible / 2, 2)
    ELSE 0
  END;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION grades_points_from_effort() IS
  'Preserves the migration-013 curve (effort 3-5 -> full, 1-2 -> half, 0 -> zero), but keys on '
  'the grade row rather than the offering: a row carrying an effort IS effort-graded, whatever '
  'assignment_offerings.grading_mode says. This is what lets one offering grade an interactive '
  'taker by effort and a written taker by question_scores. Never write points_earned directly on '
  'a row that carries an effort; this overwrites it.';

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE on grades) and is not recreated.

-- -------------------------------------------------------------------------------------
-- 2. The guard — a grade is effort-graded or points-graded, never both
-- -------------------------------------------------------------------------------------
-- With the mode check gone, prose is the only thing that stopped a written grade from acquiring
-- an `effort` and being silently seized by the trigger. Prose is not a constraint. This is.
--
-- It fires loudly (a rejected write) instead of quietly (a student's 2/2 becoming 0/2), which is
-- the correct trade for a column that decides points. Existing rows all satisfy it: every one has
-- effort IS NULL.
--
-- If the model ever genuinely needs both on one row, drop this constraint deliberately and say
-- why — do not weaken it to make a write pass.
ALTER TABLE grades ADD CONSTRAINT grades_one_grading_mechanism CHECK (
  effort IS NULL OR question_scores = '{}'::jsonb
);

COMMENT ON CONSTRAINT grades_one_grading_mechanism ON grades IS
  'A student takes ONE path through an assignment, so a grade row is effort-graded (interactive) '
  'or points-graded (written), never both. Enforces WRITTEN-SCHEMA1.md:118-121, which previously '
  'existed only as a documented convention: on the written path effort is diagnostic and belongs '
  'in grades.diagnostic, never in grades.effort.';

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the guard is live and existing rows pass it
--   SELECT count(*) FILTER (WHERE effort IS NOT NULL AND question_scores <> '{}'::jsonb)
--          AS must_be_zero FROM app.grades;
--
--   -- the curve, without writing anything
--   SELECT e, CASE WHEN e >= 3 THEN 2 WHEN e >= 1 THEN 1 ELSE 0 END AS expect_points
--     FROM generate_series(0,5) e;
--
--   -- and end to end:
--   .venv/Scripts/python supabase/admin/grade_interactive.py status
-- =====================================================================================
