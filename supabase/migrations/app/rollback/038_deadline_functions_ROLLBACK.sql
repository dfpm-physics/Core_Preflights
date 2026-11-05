-- Rollback for 038_deadline_functions.sql. Run as `prep_app_owner`.
--
-- Drops seven functions. Nothing at step 1 calls them. Roll back 039 first: the total rule calls them.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP FUNCTION IF EXISTS late_close_at(uuid);
DROP FUNCTION IF EXISTS release_at(uuid, uuid);
DROP FUNCTION IF EXISTS effective_deadline(uuid, uuid);
DROP FUNCTION IF EXISTS scheduled_deadline(uuid, uuid);
DROP FUNCTION IF EXISTS deadline_rows(uuid);
DROP FUNCTION IF EXISTS _effective_core(uuid, uuid);
DROP FUNCTION IF EXISTS _scheduled_core(uuid, uuid);

COMMIT;
