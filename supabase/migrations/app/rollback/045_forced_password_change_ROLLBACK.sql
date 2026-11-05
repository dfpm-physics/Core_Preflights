-- Rollback for 045_forced_password_change.sql. Run as `prep_app_owner`.
-- Removes the restrictive policy from every table, puts current_uid() and the roster own-row policy back
-- as they were, and drops the two new functions. After this a flagged account is held only by the site.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_policy p ON p.polrelid = c.oid
           WHERE n.nspname = 'app' AND p.polname = 'forced_rotation_block'
  LOOP
    EXECUTE format('DROP POLICY forced_rotation_block ON app.%I', r.relname);
  END LOOP;
END $$;

DROP POLICY students_read_own ON students;

CREATE OR REPLACE FUNCTION current_uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT nullif(
           coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           ), '')::uuid;
$$;
COMMENT ON FUNCTION current_uid() IS
  'The authenticated user id, read from the JWT exactly as auth.uid() does but without '
  'depending on schema auth, which the app tier has no privileges on.';

CREATE POLICY students_read_own ON students FOR SELECT TO authenticated
  USING (auth_user_id = current_uid());

DROP FUNCTION session_must_change_password();
DROP FUNCTION session_uid();

COMMIT;
