-- Rollback for 022_tutor_error_log_cadet_ref.sql. Run as `prep_app_owner`.
--
-- DROPS THE COLUMN THAT HOLDS THE CADET REFERENCE ON EACH LOGGED ERROR. The value is stored
-- nowhere else, so existing rows lose it permanently. Export first if the rows still matter.

BEGIN;

SET LOCAL search_path = app, public;

DROP INDEX IF EXISTS tutor_error_log_ref_idx;
ALTER TABLE tutor_error_log DROP COLUMN IF EXISTS cadet_ref;

COMMIT;
