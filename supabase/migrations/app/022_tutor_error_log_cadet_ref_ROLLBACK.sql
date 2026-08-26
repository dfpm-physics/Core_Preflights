-- Rollback for 022_tutor_error_log_cadet_ref.sql. Run as `prep_app_owner`.
--
-- DROPS THE ONLY COPY OF WHO EACH LOGGED ERROR BELONGED TO. The name is not held anywhere
-- else: it is typed on an unauthenticated page and travels no further than this column, so
-- dropping it makes every existing row anonymous and unrecoverable -- the exact state 022 was
-- written to fix. Export first if the rows still matter.

BEGIN;

SET LOCAL search_path = app, public;

DROP INDEX IF EXISTS tutor_error_log_ref_idx;
ALTER TABLE tutor_error_log DROP COLUMN IF EXISTS cadet_ref;

COMMIT;
