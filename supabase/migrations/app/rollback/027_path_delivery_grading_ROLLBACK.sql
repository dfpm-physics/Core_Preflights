-- Rollback for 027_path_delivery_grading.sql. Run as `prep_app_owner`.
--
-- Clean until the first new item exists. Narrowing the modality check fails while any activity has
-- modality `questions` or `external`, and dropping the three columns loses whatever the backfill
-- wrote. After that, roll forward. Roll back 028 first: its grading_mode trigger reads `grading`.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '027';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '027'
     AND (EXISTS (SELECT 1 FROM offering_activities oa JOIN activities a ON a.id = oa.activity_id WHERE oa.delivery IS NOT NULL AND NOT ((a.modality = 'written' AND oa.delivery = 'typed_response' AND oa.grading = 'human_graded' AND oa.warn_earns_full) OR (a.modality = 'interactive' AND oa.delivery = 'interactive_tutor' AND oa.grading = 'effort' AND NOT oa.warn_earns_full))) OR EXISTS (SELECT 1 FROM activities WHERE modality NOT IN ('written', 'interactive'))) THEN
    RAISE EXCEPTION 'rollback of 027 would lose paths that the old modality cannot recreate (a different delivery, grading or warn_earns_full). Snapshot first, then SET prep.rollback_loses_rows = ''027'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS offering_activities_fill_path ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_fill_path();

ALTER TABLE offering_activities
  DROP CONSTRAINT IF EXISTS offering_activities_warn_needs_human_ck,
  DROP CONSTRAINT IF EXISTS offering_activities_delivery_grading_ck;

ALTER TABLE offering_activities
  DROP COLUMN IF EXISTS warn_earns_full,
  DROP COLUMN IF EXISTS grading,
  DROP COLUMN IF EXISTS delivery;

-- The old check admits only written and interactive. With the flag set, the operator has snapshotted and
-- accepted the loss, so the paths that only the new pages produce go first (their offering_activities rows
-- go with them). Without this the ADD CONSTRAINT below fails on the first such row.
-- A committed submission that chose one of these activities is graded evidence: deleting the activity would
-- unlink it, and the lock on committed work refuses the unlink with a message about unlocking. Say what is true.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM submissions s JOIN activities a ON a.id = s.chosen_activity_id
              WHERE s.status = 'committed' AND a.modality NOT IN ('written', 'interactive')) THEN
    RAISE EXCEPTION 'rollback of 027 stopped: committed submissions chose a path of a new modality (questions or external). Deleting that path would unlink committed work, which this file will not do. Nothing was changed. Roll forward instead.';
  END IF;
END $$;

DELETE FROM activities WHERE modality NOT IN ('written', 'interactive');

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_modality_check;
ALTER TABLE activities ADD CONSTRAINT activities_modality_check
  CHECK (modality IN ('written', 'interactive'));

COMMENT ON COLUMN activities.modality IS NULL;

COMMIT;
