-- Rollback for 077_ai_drafted_grading.sql. Run as `prep_app_owner`.
--
-- Refuses while any path uses grading = 'ai_drafted': narrowing the check could not hold that row. Change the path
-- to human_graded first (a person then marks it, and the overnight job skips it), or remove it, then run this file.
-- Roll back 078 first if it is applied: it reads the value.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM offering_activities WHERE grading = 'ai_drafted';
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback of 077 refused: % path(s) use grading ai_drafted. Change them to human_graded (or remove them) first. Nothing was changed.', n;
  END IF;
END $$;

ALTER TABLE offering_activities
  DROP CONSTRAINT offering_activities_warn_needs_human_ck,
  DROP CONSTRAINT offering_activities_delivery_grading_ck;

ALTER TABLE offering_activities
  ADD CONSTRAINT offering_activities_delivery_grading_ck CHECK (
    (delivery IS NULL AND grading IS NULL)
    OR (delivery IS NOT NULL AND grading IS NOT NULL
        AND (delivery, grading) IN (
          ('online_questions', 'auto_checked'),
          ('online_questions', 'human_graded'),
          ('typed_response',   'human_graded'),
          ('interactive_tutor', 'effort'),
          ('in_person',        'hand_entered'),
          ('in_person',        'imported'),
          ('elsewhere',        'hand_entered'),
          ('elsewhere',        'imported')))),
  ADD CONSTRAINT offering_activities_warn_needs_human_ck CHECK (
    warn_earns_full IS NOT TRUE OR grading = 'human_graded');

COMMENT ON COLUMN offering_activities.grading IS
  'How the work is graded. See offering_activities_delivery_grading_ck for the allowed pairs.';
COMMENT ON COLUMN offering_activities.warn_earns_full IS
  'Whether a yellow (warn) mark earns full credit. True only with human_graded. New items write '
  'false; backfilled preflights write true.';

COMMIT;
