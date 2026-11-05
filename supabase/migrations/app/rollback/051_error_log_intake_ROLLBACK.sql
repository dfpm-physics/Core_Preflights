-- Rollback for 051_error_log_intake.sql. Run as `prep_app_owner`. Drops the intake trigger and function.
-- Rows already stored stay. The grants revoked from the API roles were never needed and are not restored.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;
DROP TRIGGER IF EXISTS tutor_error_log_intake ON tutor_error_log;
DROP FUNCTION IF EXISTS tutor_error_log_intake();
COMMIT;
