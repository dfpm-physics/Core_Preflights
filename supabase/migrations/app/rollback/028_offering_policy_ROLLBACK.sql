-- Rollback for 028_offering_policy.sql. Run as `prep_app_owner`.
--
-- Clean until an item has entered_on_new_page, or anyone relies on the policy columns. Dropping the
-- columns loses whatever was written to them. Roll back 029 to 039 first: they read these columns.
-- The default for course_offerings.is_active returns to true; the one-active index goes.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '028';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '028'
     AND (EXISTS (SELECT 1 FROM part_sets) OR EXISTS (SELECT 1 FROM assignment_offerings WHERE late_allowed OR is_bonus OR allow_over_max OR prog_included OR grades_release_at IS NOT NULL OR attempt_limit IS NOT NULL OR attempt_rule <> 'best' OR part_set_id IS NOT NULL OR entered_on_new_page) OR EXISTS (SELECT 1 FROM assignments WHERE origin_assignment_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'rollback of 028 would lose part sets, policy values or page markers. Snapshot first, then SET prep.rollback_loses_rows = ''028'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS set_prog_flag(uuid, boolean);

DROP TRIGGER IF EXISTS offering_activities_new_paths_stay_unpublished ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_new_paths_stay_unpublished();
DROP TRIGGER IF EXISTS assignment_offerings_new_paths_stay_unpublished ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_new_paths_stay_unpublished();
DROP TRIGGER IF EXISTS assignment_offerings_marker_one_way ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_marker_one_way();

DROP TRIGGER IF EXISTS offering_activities_sync_grading_mode ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_sync_grading_mode();

DROP TRIGGER IF EXISTS assignment_offerings_publish_needs_active ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_publish_needs_active();

DROP TRIGGER IF EXISTS assignment_offerings_new_stay_unpublished ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_new_stay_unpublished();

DROP INDEX IF EXISTS course_offerings_one_active;
ALTER TABLE course_offerings ALTER COLUMN is_active SET DEFAULT true;
COMMENT ON COLUMN course_offerings.is_active IS NULL;

ALTER TABLE assignments DROP COLUMN IF EXISTS origin_assignment_id;

ALTER TABLE assignment_offerings
  DROP CONSTRAINT IF EXISTS assignment_offerings_part_set_fk,
  DROP CONSTRAINT IF EXISTS assignment_offerings_attempt_rule_ck,
  DROP CONSTRAINT IF EXISTS assignment_offerings_attempt_limit_ck;

DROP INDEX IF EXISTS assignment_offerings_part_set_idx;

ALTER TABLE assignment_offerings
  DROP COLUMN IF EXISTS entered_on_new_page,
  DROP COLUMN IF EXISTS part_set_id,
  DROP COLUMN IF EXISTS attempt_rule,
  DROP COLUMN IF EXISTS attempt_limit,
  DROP COLUMN IF EXISTS grades_release_at,
  DROP COLUMN IF EXISTS prog_included,
  DROP COLUMN IF EXISTS allow_over_max,
  DROP COLUMN IF EXISTS is_bonus,
  DROP COLUMN IF EXISTS late_allowed;

DROP TABLE IF EXISTS part_sets;

COMMIT;
