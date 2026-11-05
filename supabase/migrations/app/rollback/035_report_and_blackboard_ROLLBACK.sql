-- Rollback for 035_report_and_blackboard.sql. Run as `prep_app_owner`.
--
-- Drops the two tables and the four nullable columns, losing whatever was entered in them. Returns
-- terms_awaiting_freeze to running with its owner's rights.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '035';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '035'
     AND (EXISTS (SELECT 1 FROM course_offering_settings) OR EXISTS (SELECT 1 FROM course_grade_history) OR EXISTS (SELECT 1 FROM courses WHERE subject IS NOT NULL OR course_number IS NOT NULL) OR EXISTS (SELECT 1 FROM terms WHERE report_code IS NOT NULL) OR EXISTS (SELECT 1 FROM students WHERE class_year IS NOT NULL)) THEN
    RAISE EXCEPTION 'rollback of 035 would lose report, Blackboard or history data. Snapshot first, then SET prep.rollback_loses_rows = ''035'' in this session. Nothing was changed.';
  END IF;
END $$;

ALTER VIEW terms_awaiting_freeze RESET (security_invoker);

DROP TABLE IF EXISTS course_grade_history;
DROP TABLE IF EXISTS course_offering_settings;

ALTER TABLE students DROP COLUMN IF EXISTS class_year;
ALTER TABLE terms    DROP COLUMN IF EXISTS report_code;
ALTER TABLE courses  DROP COLUMN IF EXISTS course_number, DROP COLUMN IF EXISTS subject;

COMMIT;
