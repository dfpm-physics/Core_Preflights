-- Rollback for 020_tutor_error_log.sql. Run as `prep_app_owner`.
--
-- Drops the table and everything hanging off it. The data is diagnostic only -- nothing
-- grades, schedules or identifies a student depends on it -- so this is safe to run, but it
-- is still a DELETE of every failure record collected so far. Snapshot first if the point of
-- the rollback is to rebuild the shape rather than to abandon the feature (CORE.md section 0,
-- and .ai/skills/safe-change/SKILL.md).
--
-- The BEGIN / SET LOCAL wrapper is here for the same reason it is in the forward migration:
-- without `app` on the search path an unqualified DROP resolves somewhere else, and on this
-- project "somewhere else" is `public`, which is kept as the cutover rollback. A rollback
-- that silently targets the wrong schema is worse than one that fails.

BEGIN;

SET LOCAL search_path = app, public;

DROP POLICY IF EXISTS tel_read_staff ON tutor_error_log;
DROP TABLE IF EXISTS tutor_error_log;

COMMIT;

-- If the pre-wrapper attempt of 2026-08-25 ran and left a stray table behind, it is in
-- `public` and this file does not touch it. Check and clear it separately:
--     SELECT table_schema FROM information_schema.tables WHERE table_name = 'tutor_error_log';
--     DROP TABLE IF EXISTS public.tutor_error_log;
