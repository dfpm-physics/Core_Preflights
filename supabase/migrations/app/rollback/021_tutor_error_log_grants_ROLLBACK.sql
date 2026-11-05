-- Rollback for 021_tutor_error_log_grants.sql. Run as `prep_app_owner`.
--
-- Revokes privileges and destroys no data, so it is safe in the mechanical sense. It is not
-- safe in the useful sense: it returns the table to the state that made `log-tutor-error`
-- answer `{"error":"permission denied for table tutor_error_log"}` on every cadet error,
-- silently, with HTTP 200 and a live-looking function.
--
-- If the goal is to remove the feature, roll back 020 instead -- that drops the table and
-- these grants with it, and leaves nothing that looks deployed but cannot write.

BEGIN;

SET LOCAL search_path = app, public;

REVOKE SELECT ON tutor_error_log FROM prep_app_read;
REVOKE USAGE, SELECT ON SEQUENCE tutor_error_log_id_seq FROM service_role;
REVOKE INSERT ON tutor_error_log FROM service_role;

COMMIT;
