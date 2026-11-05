-- PREP v2 step 2 -- a grade's version moves only when the grade changes
-- =====================================================================================
-- Run as `prep_app_owner`, under the coordination gate. Depends on 001 (the grades table and its touch trigger) and
-- 049 (the pin and audit triggers, which sort before this one).
--
-- THE PROBLEM
--   The grade page treats `grades.updated_at` as the version of a grade and refuses a save whose rows have a different
--   version from the one the page read. The touch trigger bumped it on EVERY update, including an update that wrote
--   the same values back (an analysis run that rewrites a row, an auto-grade pass that recomputes the same score). The
--   page then refused an instructor's save because of a write that changed no grade, and the typed work had to be
--   redone.
--
-- WHAT IT DOES
--   grades_touch is replaced by a function that leaves updated_at alone when the row after the update equals the row
--   before it, apart from updated_at itself. Any real change still moves it. The trigger keeps its name, so it runs
--   in the same place in the trigger order (after every other BEFORE trigger on grades, so it compares the final row).
--
-- WHAT IT DOES NOT DO
--   It changes no grade, no audit row (the audit trigger has its own comparison) and no other table's touch trigger.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION grades_touch_if_changed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER grades_touch ON grades;
CREATE TRIGGER grades_touch BEFORE UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_touch_if_changed();

REVOKE ALL ON FUNCTION grades_touch_if_changed() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
--    WHERE t.tgrelid = 'app.grades'::regclass AND t.tgname = 'grades_touch';          -- grades_touch_if_changed
