-- 045_forced_password_change.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- AN ACCOUNT THAT MUST CHANGE ITS PASSWORD CAN REACH NOTHING BUT THAT CHANGE
--
-- An account is flagged for a forced password change (a new account, or a staff reset to the default)
-- by `app_metadata.must_change_password`, a field only the service role can write. Until now only the
-- browser acted on it: every page redirected to the account page. A flagged session that skipped the
-- pages and called the data API directly saw everything its role could see. This file makes the
-- database refuse as well.
--
-- WHAT IS ENFORCED
--   While the signed-in session's token carries app_metadata.must_change_password = true:
--     * every table in schema `app` answers as if the caller had no rows and could write none, with one
--       exception: the caller's own `students` / `instructors` row stays readable, because the site
--       reads it to learn which account page to show;
--     * every function that identifies the caller (all helpers, and every function built on them) sees
--       no signed-in user, because app.current_uid() returns NULL.
--   Changing the password goes through the `set-own-password` function and signing out goes through the
--   auth service. Neither reads schema `app` as the caller, so both keep working.
--   The flag is read from app_metadata ONLY. user_metadata is writable by the user's own session, so
--   nothing may decide anything from it; it is ignored here, as the edge function and the site now do.
--
-- HOW
--   session_uid()                    the signed-in user id from the token, as app.current_uid() read it
--                                    before. Used for exactly the two own-row reads above.
--   session_must_change_password()   true when the token carries the flag.
--   current_uid()                    now NULL when the flag is set, else session_uid(). Every policy and
--                                    helper already goes through it, so this one change blanks them all.
--   forced_rotation_block            a RESTRICTIVE policy on every table of schema `app`. It does not
--                                    depend on any helper, so a future permissive policy that forgets
--                                    current_uid() still cannot serve a flagged session.
--
-- LIMITS, STATED PLAINLY
--   * The rule reads the token. A session issued before an account was flagged keeps working until its
--     token is replaced (the access token lasts about an hour, and the site replaces it on the next
--     refresh). The site's own check stays as the first line.
--   * After the password is changed, the old token still carries the flag until the site signs in again
--     with the new password, which the account page already does.
--   * A table added later needs the same restrictive policy. scripts/staging/test_forced_rotation_scratch.py
--     fails when any table of schema `app` lacks it.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   Who may read or write what for an unflagged session, every table, every grant, every stored row.
--   The service role and the three app roles do not go through these policies.
--
-- Rollback: rollback/045_forced_password_change_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION session_uid() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT nullif(
           coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           ), '')::uuid;
$$;
COMMENT ON FUNCTION session_uid() IS
  'The user id in the token, whatever the forced-password-change flag says. Only the own-row reads of '
  'students and instructors use it; everything else uses current_uid(). Migration 045.';

CREATE FUNCTION session_must_change_password() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT coalesce(
           (nullif(current_setting('request.jwt.claims', true), '')::jsonb
              -> 'app_metadata' ->> 'must_change_password') = 'true',
           false);
$$;
COMMENT ON FUNCTION session_must_change_password() IS
  'True when the token carries app_metadata.must_change_password. user_metadata is never read: the user '
  'can write it. Migration 045.';

CREATE OR REPLACE FUNCTION current_uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN session_must_change_password() THEN NULL ELSE session_uid() END;
$$;
COMMENT ON FUNCTION current_uid() IS
  'The authenticated user id, read from the JWT as auth.uid() does but without depending on schema auth. '
  'NULL while the account is flagged for a forced password change (migration 045).';

-- the own-row read of the roster: the site needs it to know which account page to show
DROP POLICY students_read_own ON students;
CREATE POLICY students_read_own ON students FOR SELECT TO authenticated
  USING (auth_user_id = session_uid());

-- one restrictive policy on every table of the schema
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND c.relkind IN ('r','p') AND c.relrowsecurity
            ORDER BY c.relname
  LOOP
    IF r.relname = 'students' THEN
      EXECUTE 'CREATE POLICY forced_rotation_block ON app.students AS RESTRICTIVE FOR ALL TO authenticated '
              'USING (NOT (SELECT app.session_must_change_password()) OR auth_user_id = (SELECT app.session_uid()))';
    ELSIF r.relname = 'instructors' THEN
      EXECUTE 'CREATE POLICY forced_rotation_block ON app.instructors AS RESTRICTIVE FOR ALL TO authenticated '
              'USING (NOT (SELECT app.session_must_change_password()) OR id = (SELECT app.session_uid()))';
    ELSE
      EXECUTE format('CREATE POLICY forced_rotation_block ON app.%I AS RESTRICTIVE FOR ALL TO authenticated '
                     'USING (NOT (SELECT app.session_must_change_password()))', r.relname);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verify (read-only): both counts should be equal, and no row should come back from the second query.
--
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'app' AND c.relkind IN ('r','p') AND c.relrowsecurity;
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'app' AND c.relkind IN ('r','p') AND c.relrowsecurity
--      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'forced_rotation_block');
--
-- The behaviour is proved by scripts/staging/test_forced_rotation_scratch.py on a throwaway database.
