-- Claude Code dedicated DB role — OPERATIONAL script (NOT a numbered migration)
-- =====================================================================================
-- Lives in supabase/admin/ on purpose: this is a one-time, per-operator role setup, NOT
-- part of the migration chain other directors replay. Running it (or not) has zero effect
-- on the schema migrations.
--
-- PURPOSE
--   Create ONE new, isolated Postgres role so Matthew Recker's Claude Code can read and
--   write course data directly — WITHOUT the broad service_role key, and WITHOUT touching
--   anything the existing /preflight-analyze skill (set up by another director) relies on.
--
-- STRICTLY ADDITIVE & ISOLATED. This script ONLY:
--   * CREATEs one new role:            claude_code_recker
--   * GRANTs it SELECT (read) on all public tables and INSERT/UPDATE/DELETE (write) on all
--     public tables — i.e. DATA only, no schema rights.
--   * Sets BYPASSRLS on the NEW role only (so existing RLS POLICIES are read, never edited).
--   It does NOT alter / drop / modify any existing table, column, policy, row, role, key,
--   or RLS policy. The service_role key, the anon key, and every current policy are left
--   exactly as-is, so preflight-analyze and the student/instructor frontends keep working.
--
-- WHY THIS ROLE PHYSICALLY CANNOT CHANGE THE SCHEMA
--   In Postgres, DROP / ALTER / TRUNCATE require OWNERSHIP of the object (or superuser).
--   This role owns nothing and is granted no DDL, so the database itself refuses any schema
--   change — it is enforced by Postgres, not trusted to good behavior. (TRUNCATE also needs
--   an explicit grant we never give.)
--
-- HOW TO RUN
--   1. Replace REPLACE_ME below with the password I generated for you (shown in chat).
--   2. Supabase Dashboard > SQL Editor > New query > paste > Run (it runs as `postgres`).
--   The whole thing is wrapped in one transaction: if any line is not permitted on your
--   project (most likely the BYPASSRLS line), EVERYTHING rolls back and nothing is applied.
--   If that happens, tell me the exact error — there is an additive-policy fallback that
--   needs no BYPASSRLS and is just as isolated.
-- =====================================================================================

BEGIN;

-- 1) The role: can log in (direct Postgres connection), but no superuser/createdb/createrole.
CREATE ROLE claude_code_recker LOGIN PASSWORD 'REPLACE_ME'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- 2) Let THIS role see RLS-protected rows. Affects only this role; changes no policy.
ALTER ROLE claude_code_recker BYPASSRLS;

-- 3) Read everything in `public`; write data everywhere in `public`; NO schema/DDL rights.
GRANT USAGE ON SCHEMA public TO claude_code_recker;
GRANT SELECT                       ON ALL TABLES    IN SCHEMA public TO claude_code_recker;  -- read
GRANT INSERT, UPDATE, DELETE       ON ALL TABLES    IN SCHEMA public TO claude_code_recker;  -- write
GRANT USAGE, SELECT                ON ALL SEQUENCES IN SCHEMA public TO claude_code_recker;  -- inserts need sequences

-- 4) Apply the same grants to tables/sequences added later, so this never needs re-running.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO claude_code_recker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO claude_code_recker;

COMMIT;

-- =====================================================================================
-- FULL UNDO (removes everything this script created; run as `postgres` if ever needed):
--   BEGIN;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES   FROM claude_code_recker;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     REVOKE USAGE, SELECT                  ON SEQUENCES FROM claude_code_recker;
--   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM claude_code_recker;
--   REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM claude_code_recker;
--   REVOKE USAGE ON SCHEMA public               FROM claude_code_recker;
--   DROP ROLE claude_code_recker;
--   COMMIT;
-- =====================================================================================
