-- 051_error_log_intake.sql
-- Run as `prep_app_owner`. Depends on 020, 021, 022.
--
-- The tutor error log takes rows from a public endpoint (the backup lesson pages have no sign-in, so the endpoint
-- cannot require one). This puts the limits in the database, where they hold whatever calls the endpoint:
--   * a row for a lesson that is not registered is not stored;
--   * at most 120 rows per lesson and 600 rows overall are stored in any one minute; the rest are dropped.
-- A dropped row is not an error: the insert reports success, so a lesson page behaves the same either way.
-- The identity columns (`cadet_id`, `cadet_ref`) are what the sender typed. Nothing may rely on them.
-- KNOWN LIMITS (kept on purpose). The caps protect storage; they do not promise completeness. The endpoint has no
-- sender identity, so a count cannot tell one noisy sender from a busy class, and in a minute when a cap is reached the
-- log is incomplete, with nothing reporting it. A rule that favours one kind of sender would only move the gap. The
-- count is read at insert time without a lock, so a burst of simultaneous inserts can store slightly more than the cap.
-- Nothing purges old rows; a retention job is separate work.
-- Rollback: rollback/051_error_log_intake_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION tutor_error_log_intake() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM activities WHERE slug = NEW.slug) THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM tutor_error_log WHERE slug = NEW.slug AND logged_at > now() - interval '1 minute') >= 120
     OR (SELECT count(*) FROM tutor_error_log WHERE logged_at > now() - interval '1 minute') >= 600 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tutor_error_log_intake() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tutor_error_log_intake ON tutor_error_log;
CREATE TRIGGER tutor_error_log_intake BEFORE INSERT ON tutor_error_log
  FOR EACH ROW EXECUTE FUNCTION tutor_error_log_intake();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tutor_error_log FROM anon, authenticated;

COMMENT ON TABLE tutor_error_log IS
  'Tutor request failures a cadet saw. Written only by the log-tutor-error function. Rows for unregistered lessons and rows over the per-minute caps are dropped by trigger (051). Identity columns are claims, not identity.';

COMMIT;
