-- Rollback for 020_tutor_error_log.sql. Run as `prep_app_owner`.
--
-- Drops the table and everything hanging off it. The data is diagnostic only -- nothing
-- grades, schedules or identifies a student depends on it -- so this is safe to run, but it
-- is still a DELETE of every failure record collected so far. Snapshot first if the point of
-- the rollback is to rebuild the shape rather than to abandon the feature (CORE.md section 0,
-- and .ai/skills/safe-change/SKILL.md).

DROP POLICY IF EXISTS tel_read_staff ON tutor_error_log;
DROP TABLE IF EXISTS tutor_error_log;
