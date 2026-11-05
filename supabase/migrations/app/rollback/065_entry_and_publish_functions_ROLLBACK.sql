-- Rollback for 065_entry_and_publish_functions.sql. Run as `prep_app_owner`.
-- Drops the four functions, drops the NaN check on grades, and takes the browser grant off course_totals. Holds no data.
--
-- gradebook_cells is DELIBERATELY NOT revoked here. Migration 060 (the student pages) owns that grant: a revoke from
-- this file would take the students' only read away while 060 is still applied. 060's rollback takes it back, and
-- it does so once this file has run (rollbacks run newest first).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

REVOKE EXECUTE ON FUNCTION course_totals(uuid, text) FROM authenticated;
DROP FUNCTION unpublish_column(uuid, uuid, boolean);
DROP FUNCTION publish_column(uuid, uuid, boolean);
DROP FUNCTION publish_preview(uuid, uuid);
DROP FUNCTION enter_grades(uuid, jsonb, text, boolean);
ALTER TABLE grades DROP CONSTRAINT grades_points_not_nan;

COMMIT;
