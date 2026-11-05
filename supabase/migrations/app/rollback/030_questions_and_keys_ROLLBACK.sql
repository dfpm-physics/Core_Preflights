-- Rollback for 030_questions_and_keys.sql. Run as `prep_app_owner`.
--
-- Drops the questions and keys tables with everything in them, so it is clean only while they are empty
-- or hold test rows. Roll back 031 first: question_attempts and key_remark_runs reference these tables.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '030';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '030'
     AND (EXISTS (SELECT 1 FROM questions) OR EXISTS (SELECT 1 FROM question_keys)) THEN
    RAISE EXCEPTION 'rollback of 030 would lose questions or answer keys. Snapshot first, then SET prep.rollback_loses_rows = ''030'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS assignment_offerings_publish_checks ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_publish_checks();

DROP TRIGGER IF EXISTS offering_activities_points_owner ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_points_owner();

DROP TRIGGER IF EXISTS offering_activities_check_prose ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_check_prose();

DROP TABLE IF EXISTS question_keys;
DROP TABLE IF EXISTS questions;

DROP FUNCTION IF EXISTS questions_points_owner();
DROP FUNCTION IF EXISTS sync_auto_checked_points(uuid);
DROP FUNCTION IF EXISTS question_keys_check_prose();
DROP FUNCTION IF EXISTS question_keys_stamp();
DROP FUNCTION IF EXISTS questions_check_prose();

COMMIT;
