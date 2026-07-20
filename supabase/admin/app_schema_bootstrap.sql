-- PREP v2 schema + tiered agent roles — OPERATIONAL script (NOT a numbered migration)
-- =====================================================================================
-- Lives in supabase/admin/ alongside claude_code_role.sql: this is one-time infrastructure
-- setup, NOT part of the migration chain other directors replay.
--
-- PURPOSE
--   Create an empty schema `app` in the EXISTING project (shzvpmlnqfmzfmuxkowi) to hold the
--   redesigned data model, plus three agent roles at descending privilege tiers. The new
--   model is then built inside `app` while `public` — the live site — is untouched.
--
-- WHY A NEW SCHEMA AND NOT A NEW PROJECT
--   `auth.users` is a schema in THIS database. Keeping the rebuild here means the 73
--   provisioned student logins and 7 instructor accounts keep working unchanged
--   (app.students.auth_user_id -> auth.users(id), exactly as public.students does today).
--   A separate project would require re-issuing every login, redeploying all 3 edge
--   functions, recreating the storage bucket, and maintaining a second set of API keys.
--   Migration also stays as plain SQL: INSERT INTO app.x SELECT ... FROM public.x.
--
-- STRICTLY ADDITIVE & ISOLATED. This script ONLY:
--   * CREATEs one new schema:  app
--   * CREATEs three new roles: prep_app_owner, prep_app_dml, prep_app_read
--   * GRANTs rights on `app` ONLY — none of these roles is granted anything on `public`.
--   It does NOT alter / drop / modify any existing schema, table, column, policy, row, role,
--   or key. `public`, the service_role key, the anon key, and every current RLS policy are
--   left exactly as-is, so the live site and /preflight-analyze keep working.
--
-- THE TIERS  (privilege enforced by Postgres, not by an agent's restraint)
--   prep_app_owner  OWNS schema app -> full DDL inside app. Build-out only. SEAL IT when the
--                   build is done (see §7) so it physically cannot connect until a human
--                   re-enables it. No rights on public.
--   prep_app_dml    SELECT/INSERT/UPDATE/DELETE on app. No DDL — owns nothing, so Postgres
--                   refuses ALTER/DROP/TRUNCATE. The everyday agent role.
--   prep_app_read   SELECT on app only. Analysis, reporting, exports.
--
--   CAVEAT ON BYPASSRLS: all three carry BYPASSRLS. A direct Postgres connection has no JWT,
--   so auth.uid() is null and RLS would otherwise deny every row, making the roles useless.
--   The tiering here is about WRITE capability and DDL, not about row visibility. Any role
--   that can connect can read every row — treat all three credentials as sensitive.
--
-- HOW TO RUN
--   1. Replace the three REPLACE_ME_* placeholders with generated passwords.
--   2. Supabase Dashboard > SQL Editor > New query > paste > Run (it runs as `postgres`).
--   3. Then: Dashboard > Settings > API > Exposed schemas -> add `app`.
--      Without step 3 PostgREST cannot see the schema and the site gets 404s on every table.
--   The whole thing is one transaction: if any line is not permitted, EVERYTHING rolls back.
--   The most likely failure is a BYPASSRLS line; if that happens, report the exact error.
--
-- NOT YET RUN AGAINST THE LIVE PROJECT. The first execution is the test.
-- =====================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) PostgreSQL 16+ role-membership fix — REQUIRED, do not remove.
--
--    Since PG16, a CREATEROLE role receives only ADMIN OPTION on roles it creates, not
--    SET. Two statements below need SET membership on prep_app_owner:
--        CREATE SCHEMA app AUTHORIZATION prep_app_owner
--        ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner ...
--    Without this line the first fails with:
--        ERROR: 42501: must be able to SET ROLE "prep_app_owner"
--
--    Verified on this project 2026-07-20: server_version 17.6, createrole_self_grant = ''.
--    SET LOCAL confines the change to this transaction; it reverts at COMMIT.
-- ---------------------------------------------------------------------------
SET LOCAL createrole_self_grant = 'set, inherit';

-- ---------------------------------------------------------------------------
-- 1) The roles
-- ---------------------------------------------------------------------------
CREATE ROLE prep_app_owner LOGIN PASSWORD 'REPLACE_ME_OWNER'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE prep_app_dml   LOGIN PASSWORD 'REPLACE_ME_DML'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE prep_app_read  LOGIN PASSWORD 'REPLACE_ME_READ'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- See the CAVEAT above: needed for any direct-connection role to see rows at all.
ALTER ROLE prep_app_owner BYPASSRLS;
ALTER ROLE prep_app_dml   BYPASSRLS;
ALTER ROLE prep_app_read  BYPASSRLS;

-- ---------------------------------------------------------------------------
-- 2) The schema — owned by prep_app_owner, which is what confers DDL inside it
-- ---------------------------------------------------------------------------
CREATE SCHEMA app AUTHORIZATION prep_app_owner;

COMMENT ON SCHEMA app IS
  'PREP v2 data model. Built alongside public/ during the app refactor; promoted at cutover.';

-- ---------------------------------------------------------------------------
-- 3) Agent-role grants on `app` (and nothing on `public`)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO prep_app_dml, prep_app_read;

-- Existing objects (no-op on a fresh schema; here so the script is safe to re-run after
-- a partial teardown).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA app TO prep_app_dml;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA app TO prep_app_dml;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA app TO prep_app_read;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app TO prep_app_dml, prep_app_read;

-- Future objects created BY prep_app_owner inherit these automatically, so this script
-- never needs re-running as the model grows.
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO prep_app_dml;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT USAGE, SELECT                  ON SEQUENCES TO prep_app_dml;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT SELECT                         ON TABLES    TO prep_app_read;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT EXECUTE                        ON FUNCTIONS TO prep_app_dml, prep_app_read;

-- ---------------------------------------------------------------------------
-- 4) Supabase API roles — without these the site cannot reach `app` at all
--    RLS still gates every row for anon/authenticated exactly as it does in public.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA app TO anon, authenticated, service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA app TO anon, authenticated, service_role;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT USAGE, SELECT                  ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
  GRANT EXECUTE                        ON FUNCTIONS TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) DELIBERATELY NOT GRANTING ANYTHING ON SCHEMA `auth`.
--
--    Verified against this project on 2026-07-20: `postgres` holds USAGE on schema `auth`
--    WITHOUT grant option (pg_namespace.nspacl = '...postgres=U/supabase_admin', no `*`),
--    so `GRANT USAGE ON SCHEMA auth TO ...` fails as `postgres` and would roll back this
--    entire script. `auth` is owned by `supabase_auth_admin`, which we are not.
--
--    This costs us nothing. The app tier never needs to read `auth.users`: the uuid is
--    stored locally in app.students.auth_user_id, and account provisioning is done by the
--    existing edge function running as `service_role`, which does have the access.
--
--    The FK into auth.users is handled separately — see §6.
-- ---------------------------------------------------------------------------

COMMIT;


-- =====================================================================================
-- 6) AUTH FOREIGN KEYS — run as `postgres` AFTER the app tables exist.
--
--    Same root cause: `postgres` holds REFERENCES on auth.users but not WITH GRANT OPTION
--    (relacl = 'postgres=ar*wdDxtm/...' — the `*` is on SELECT only), so it cannot delegate
--    REFERENCES to prep_app_owner. It CAN create the constraints itself, and once created a
--    constraint persists regardless of who owns the table afterwards.
--
--    This mirrors public.students and public.instructors, which carry exactly these two FKs
--    today. Run once, after the model is built:
--
--      ALTER TABLE app.students
--        ADD CONSTRAINT students_auth_user_id_fkey
--        FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
--
--      ALTER TABLE app.instructors
--        ADD CONSTRAINT instructors_id_fkey
--        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--
--    If you would rather not hand-run this, the alternative is to leave auth_user_id as a
--    plain uuid with an index and no FK. Integrity then rests on the provisioning function
--    instead of the database. Keeping the FK is the better default and costs one paste.
-- =====================================================================================


-- =====================================================================================
-- 7) SEAL THE OWNER  — run this as `postgres` once the build-out is complete.
--    Postgres then refuses the connection outright; no agent can perform DDL on `app`
--    until a human deliberately reverses it. This is the gate, enforced by the database.
--
--      ALTER ROLE prep_app_owner NOLOGIN;
--
--    To re-open for an authorized schema change, and re-seal afterwards:
--
--      ALTER ROLE prep_app_owner LOGIN;
--      -- ... apply the change ...
--      ALTER ROLE prep_app_owner NOLOGIN;
--
--    Keep the owner password OUT of supabase/admin/config.json. Store it separately so the
--    everyday tooling cannot pick it up by accident.
-- =====================================================================================


-- =====================================================================================
-- 8) MIGRATION WINDOW — temporary READ access to `public` so data can be copied across.
--    Deliberately NOT granted above: in normal operation no app-tier role can see `public`
--    at all. Open this only for the migration run, then close it.
--
--    Note it is SELECT only. Even during the window, nothing in the app tier can write to,
--    alter, or drop anything in `public` — the live site cannot be damaged by a bad copy.
--
--      -- open (run as postgres):
--      GRANT USAGE ON SCHEMA public TO prep_app_owner;
--      GRANT SELECT ON ALL TABLES IN SCHEMA public TO prep_app_owner;
--
--      -- ... run the migration scripts, verify row counts ...
--
--      -- close (run as postgres):
--      REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM prep_app_owner;
--      REVOKE USAGE  ON SCHEMA public              FROM prep_app_owner;
--
--    With the window open the copy is ordinary SQL in a single transaction, e.g.
--      INSERT INTO app.students (student_id, name)
--      SELECT student_id, name FROM public.students;
-- =====================================================================================


-- =====================================================================================
-- 9) INVARIANT — `app` must never hold a foreign key into `public`.
--    The two models stay fully independent; the only schema they share is `auth`. Run this
--    before cutover: it must return zero rows, or the schemas are entangled.
--
--      SELECT rel.relname AS tbl, con.conname, pg_get_constraintdef(con.oid)
--      FROM pg_constraint con
--      JOIN pg_class     rel ON rel.oid = con.conrelid
--      JOIN pg_namespace n   ON n.oid   = rel.relnamespace
--      JOIN pg_class     fre ON fre.oid = con.confrelid
--      JOIN pg_namespace fn  ON fn.oid  = fre.relnamespace
--      WHERE n.nspname = 'app' AND con.contype = 'f' AND fn.nspname = 'public';
-- =====================================================================================


-- =====================================================================================
-- 10) RLS ENFORCEMENT TESTING — run as `postgres` once, to enable app_rls_test.py.
--
--     Every agent tier carries BYPASSRLS out of necessity (a direct Postgres connection has
--     no JWT, so auth.uid() is null and RLS would deny every row). That makes all three
--     useless for testing whether the policies actually bite. This grant lets the owner drop
--     DOWN into `authenticated` — a low-privilege role with no BYPASSRLS — so the policies
--     genuinely apply and enforcement can be proven rather than assumed.
--
--     Not an escalation: `authenticated` holds strictly less than prep_app_owner already.
--     INHERIT FALSE means the owner gains none of its privileges implicitly — only the
--     ability to SET ROLE into it.
--
--       GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;
--
--     Sealing the owner (§7) also disables this, since the role can no longer connect.
--     To revoke independently:
--
--       REVOKE authenticated FROM prep_app_owner;
-- =====================================================================================


-- =====================================================================================
-- FULL UNDO (removes everything this script created; run as `postgres` if ever needed).
-- WARNING: DROP SCHEMA app CASCADE destroys the v2 model and all data in it.
--
--   BEGIN;
--   ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
--     REVOKE ALL ON TABLES    FROM prep_app_dml, prep_app_read, anon, authenticated, service_role;
--   ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
--     REVOKE ALL ON SEQUENCES FROM prep_app_dml, anon, authenticated, service_role;
--   ALTER DEFAULT PRIVILEGES FOR ROLE prep_app_owner IN SCHEMA app
--     REVOKE ALL ON FUNCTIONS FROM prep_app_dml, prep_app_read, anon, authenticated, service_role;
--   REVOKE ALL ON auth.users FROM prep_app_owner, prep_app_dml, prep_app_read;
--   REVOKE USAGE ON SCHEMA auth FROM prep_app_owner, prep_app_dml, prep_app_read;
--   DROP SCHEMA app CASCADE;
--   DROP ROLE prep_app_owner;
--   DROP ROLE prep_app_dml;
--   DROP ROLE prep_app_read;
--   COMMIT;
--
-- Remember to remove `app` from Dashboard > Settings > API > Exposed schemas as well.
-- =====================================================================================
