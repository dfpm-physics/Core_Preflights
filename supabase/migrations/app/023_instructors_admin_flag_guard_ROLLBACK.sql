-- Rollback for 023_instructors_admin_flag_guard.sql. Run as `prep_app_owner`.
--
-- Drops a trigger and its function and destroys no data, so it is safe in the mechanical sense.
-- It is not safe in the useful sense: it reopens self-promotion to global admin for every
-- signed-in staff member (see the header of 023). Roll back only to recover from a guard that
-- is refusing something legitimate, and re-apply a corrected guard promptly.

BEGIN;

SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS instructors_admin_flag_guard ON instructors;
DROP FUNCTION IF EXISTS instructors_admin_flag_guard();

COMMIT;
