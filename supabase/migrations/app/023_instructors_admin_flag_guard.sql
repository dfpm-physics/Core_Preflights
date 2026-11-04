-- PREP v2 -- any staff member could make themselves a global admin
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
--
-- WHAT WAS WRONG
--   Four facts, each reasonable on its own, add up to a self-service promotion:
--
--   1. `authenticated` holds table-wide UPDATE on `instructors` (the bootstrap's blanket grant).
--   2. Policy `instructors_update_own` admits an UPDATE to the caller's own row,
--      `USING (id = current_uid()) WITH CHECK (id = current_uid())` -- with no limit on which
--      columns change.
--   3. Nothing guards `is_global_admin`: no trigger, no column grant.
--   4. `is_admin()` (002) reads exactly that column, and every "System" gate trusts it.
--
--   So any signed-in staff member could send one REST request from the browser console --
--   `PATCH /rest/v1/instructors?id=eq.<own id>` with `{"is_global_admin": true}` -- and hold full
--   access to every course from the next page load. Confirmed against production's catalog on
--   2026-11-04 (grants, policies and triggers read over `prep_app_read`); not exploited.
--   Cadets cannot do it: their auth id is not an `instructors.id`, so policy 2 matches no row.
--
-- WHY A TRIGGER, NOT A COLUMN GRANT OR A DROPPED POLICY
--   * Nothing under `site/` writes `instructors` at all. Every write -- create, promote, demote,
--     remove -- goes through an edge function on the service key. So this guard breaks no page.
--   * A column grant (REVOKE UPDATE, GRANT UPDATE (name)) would also stop a REAL admin from
--     changing the flag through `instructors_admin_write`, which is the one policy meant to
--     allow it. The trigger keeps that policy honest.
--   * Dropping `instructors_update_own` closes this one door, but the next policy that admits an
--     UPDATE on this table reopens it. The trigger guards the column, whatever the policies say.
--
-- WHAT THE GUARD DOES
--   For a request arriving through the API as `anon` or `authenticated`, a change to
--   `is_global_admin` -- or an INSERT that sets it true -- is refused unless the caller is
--   ALREADY a global admin. `is_admin()` reads the committed table, which in a BEFORE trigger
--   still holds the OLD row, so a caller cannot satisfy the check by the very change it is making.
--   Every other role (service_role, postgres, the prep_app_* tiers) passes untouched: those are
--   server-side, and they are what the edge functions and the admin scripts use.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * `instructors_update_own` stays. A staff member may still change their own `name`. Note that
--     `name` seeds the staff default password (last name + 1234), so a self-rename changes only
--     what one's OWN reset restores to. No page offers it today.
--   * The blanket table grants stay. Narrowing them is a wider review than this fix.

BEGIN;

SET LOCAL search_path = app, public;

CREATE FUNCTION instructors_admin_flag_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  -- Server-side roles are trusted; only requests made AS the API roles are checked.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_global_admin AND NOT is_admin() THEN
      RAISE EXCEPTION 'only a global admin may create a global admin'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.is_global_admin IS DISTINCT FROM OLD.is_global_admin AND NOT is_admin() THEN
    RAISE EXCEPTION 'only a global admin may change is_global_admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION instructors_admin_flag_guard() IS
  'Refuses a change to instructors.is_global_admin from anon/authenticated unless the caller is '
  'already a global admin. Closes self-promotion through instructors_update_own. Migration 023.';

CREATE TRIGGER instructors_admin_flag_guard
  BEFORE INSERT OR UPDATE ON instructors
  FOR EACH ROW EXECUTE FUNCTION instructors_admin_flag_guard();

COMMIT;

-- Verify (read-only, any tier): expect one row.
--
--   SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'app' AND c.relname = 'instructors'
--      AND t.tgname = 'instructors_admin_flag_guard';
--
-- The behaviour itself is proven by scripts/staging/test_instructors_admin_guard.py, against the
-- staging project only, inside a transaction it always rolls back.
