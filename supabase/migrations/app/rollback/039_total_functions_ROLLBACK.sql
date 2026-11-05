-- Rollback for 039_total_functions.sql. Run as `prep_app_owner`.
--
-- Drops six functions. Nothing at step 1 calls them. Clean at any time.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP FUNCTION IF EXISTS scale_change_preview(uuid, jsonb, numeric);
DROP FUNCTION IF EXISTS my_course_total(uuid, text);
DROP FUNCTION IF EXISTS course_totals(uuid, text);
DROP FUNCTION IF EXISTS gradebook_cells(uuid, text);
DROP FUNCTION IF EXISTS _totals_at(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS _cells_at(uuid, text, timestamptz);

COMMIT;
