-- 043_offering_admin_guard.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- WHO MAY CHANGE WHETHER AN OFFERING IS ACTIVE, AND WHO MAY DELETE ONE: A GLOBAL ADMIN
--
-- The Courses and terms page shows the Active toggle and the (future) removal of an offering to a global admin
-- only, and puts a confirmation with the counts of enrolled cadets and published items in front of the toggle.
-- The policy `offerings_write` is FOR ALL and admits any DIRECTOR of the offering, so a request made some other
-- way than through the page could change the flag or delete the row (its sections, enrollments and grades go
-- with it by cascade) without that confirmation. The page's rule becomes the database's.
--
-- WHAT THE GUARD DOES
--   For a request arriving as `anon` or `authenticated` (the API roles):
--     UPDATE   a change to `is_active` is refused unless the caller is a global admin.
--     INSERT   a row created with `is_active = true` is refused unless the caller is a global admin.
--              (A director may still create an INACTIVE offering of a course they direct, as before.)
--     DELETE   refused unless the caller is a global admin.
--   Every other role passes untouched (service_role, postgres, the prep_app_* tiers): those are server-side, and
--   they are what the edge functions, the term builders and the admin scripts use. The pattern is the one 023 uses
--   for `instructors.is_global_admin`; `is_admin()` reads the committed table.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * The policies. A director still reads, inserts an inactive offering and updates every other column
--     of an offering they direct, exactly as before; the trigger looks at `is_active` and at deletion only.
--   * Nothing under `site/` writes this table except the Courses and terms page (create an offering, set it active
--     or inactive), and that page already offers those two actions to a global admin only. No edge function and no
--     database function writes it. The server-side scripts run as the tiers named above.
--   * A cascade from deleting a course or a term runs as the caller: a global admin's passes, anyone else's
--     already failed at the course or term, which only an administrator can delete.
--   * Deleting an offering by hand is a destructive operation under the repo's own rule (snapshot first); this
--     file only narrows who can ask the API to do it.
--
-- Rollback: rollback/043_offering_admin_guard_ROLLBACK.sql drops the trigger and its function.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION course_offerings_admin_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  -- Server-side roles are trusted; only requests made AS the API roles are checked.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active AND NOT is_admin() THEN
      RAISE EXCEPTION 'only a site administrator may create an offering as active'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT is_admin() THEN
      RAISE EXCEPTION 'only a site administrator may change whether an offering is active'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only a site administrator may delete an offering'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END; $$;

COMMENT ON FUNCTION course_offerings_admin_guard() IS
  'Refuses, for the API roles, a change to course_offerings.is_active, a row created active, and any delete, unless the caller is a global admin. Migration 043.';

REVOKE ALL ON FUNCTION course_offerings_admin_guard() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

CREATE TRIGGER course_offerings_admin_guard
  BEFORE INSERT OR UPDATE OR DELETE ON course_offerings
  FOR EACH ROW EXECUTE FUNCTION course_offerings_admin_guard();

COMMIT;

-- Verify (read-only): expect one row.
--
--   SELECT tgname, tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'app' AND c.relname = 'course_offerings' AND t.tgname = 'course_offerings_admin_guard';
--
-- The behaviour is proved by tests/app-schema/v2_signed_in_checks.py (a director is refused, an administrator is
-- not), against the staging project only, inside transactions it rolls back.
