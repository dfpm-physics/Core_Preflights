-- Rollback for 036_groups.sql. Run as `prep_app_owner`.
--
-- Drops the four group tables and the three added columns, losing group membership and any group
-- adjustments. Clean while no group exists (none outside the staging seed).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '036';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '036'
     AND (EXISTS (SELECT 1 FROM student_groups) OR EXISTS (SELECT 1 FROM student_group_members) OR EXISTS (SELECT 1 FROM student_group_grades) OR EXISTS (SELECT 1 FROM student_group_snapshots) OR EXISTS (SELECT 1 FROM grades WHERE student_group_id IS NOT NULL OR student_group_adjusted) OR EXISTS (SELECT 1 FROM assignment_offerings WHERE is_group_work)) THEN
    RAISE EXCEPTION 'rollback of 036 would lose groups, group grades or group flags. Snapshot first, then SET prep.rollback_loses_rows = ''036'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS apply_group_score(uuid, uuid, numeric, uuid[]);

DROP TRIGGER IF EXISTS grades_group_adjusted_ins ON grades;
DROP TRIGGER IF EXISTS grades_group_adjusted ON grades;
DROP FUNCTION IF EXISTS grades_group_adjusted();

DROP INDEX IF EXISTS grades_student_group_idx;
ALTER TABLE grades
  DROP COLUMN IF EXISTS student_group_adjusted,
  DROP COLUMN IF EXISTS student_group_id;

ALTER TABLE assignment_offerings DROP COLUMN IF EXISTS is_group_work;

DROP TABLE IF EXISTS student_group_grades;
DROP TABLE IF EXISTS student_group_snapshots;
DROP TABLE IF EXISTS student_group_members;
DROP TABLE IF EXISTS student_groups;

DROP FUNCTION IF EXISTS student_group_members_check();

COMMIT;
