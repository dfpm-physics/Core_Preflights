-- PREP v2 -- a ledger of applied migrations
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql. Additive: creates one table and
-- changes nothing that exists. It does NOT depend on 023_instructors_admin_flag_guard.sql,
-- and applies the same whether 023 is present or not.
--
-- WHY THIS EXISTS
--   The migration chain was applied by hand, one file at a time, and nothing recorded which
--   files a given database had received. "Is production at 022?" was answered from memory and
--   from a schema fingerprint. This table records it: one row per file, per chain, with a
--   checksum of the file as it was applied, who applied it, and when.
--
-- WHAT A ROW MEANS
--   chain     'app' (supabase/migrations/app/) or 'public' (supabase/migrations/). The two
--             chains are numbered independently, so the key is (chain, filename).
--   filename  the file name only, for example 009_analysis_runs.sql.
--   checksum  sha256, as lowercase hex, of the file with CRLF turned into LF. The line-ending
--             rule keeps the value the same on a machine that rewrites line endings on checkout.
--             scripts/staging/migration_ledger.py is the only thing that computes it.
--   method    'applied'     the file was run against this database.
--   method    'backfilled'  the file had already been run before this ledger existed, and the
--                           row was added afterwards without running it again.
--
-- HOW ROWS GET IN
--   Nothing in this file writes a row. The tool above prints, or runs, the INSERT. Files
--   already applied to a database are recorded with `migration_ledger.py record` (staging) or
--   by running the SQL that `migration_ledger.py sql` prints (any other database).
--
-- WHO CAN SEE IT
--   Nobody signed in through the browser. Row level security is on with no policy, and every
--   grant to anon, authenticated and service_role is withdrawn. The default privileges set in
--   the schema bootstrap would otherwise hand all three of them full access to a new table.
--   The data-only tier (prep_app_dml) and the read-only tier (prep_app_read) can read it;
--   only the schema owner writes it.
--
-- NOT A LOCK
--   The table records what was applied. It does not stop two people applying at once, and a
--   missing row does not prove a file was not applied. The coordination gate in CORE.md
--   section 0 still applies.

BEGIN;

SET LOCAL search_path = app, public;

CREATE TABLE IF NOT EXISTS migration_ledger (
  chain       text        NOT NULL,
  filename    text        NOT NULL,
  checksum    text        NOT NULL,
  method      text        NOT NULL DEFAULT 'applied',
  applied_by  text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  note        text,
  PRIMARY KEY (chain, filename),
  CONSTRAINT migration_ledger_chain_ck    CHECK (chain IN ('app', 'public')),
  CONSTRAINT migration_ledger_method_ck   CHECK (method IN ('applied', 'backfilled')),
  CONSTRAINT migration_ledger_checksum_ck CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_ledger_filename_ck CHECK (filename ~ '^[A-Za-z0-9_.-]+\.sql$')
);

COMMENT ON TABLE migration_ledger IS
  'One row per migration file applied to this database, per chain. Written by '
  'scripts/staging/migration_ledger.py. checksum is sha256 of the file with CRLF turned into LF. '
  'method=backfilled means the file was run before this ledger existed.';

ALTER TABLE migration_ledger ENABLE ROW LEVEL SECURITY;

-- No policy, deliberately: no signed-in user reads or writes this table.
REVOKE ALL ON migration_ledger FROM PUBLIC, anon, authenticated, service_role, prep_app_dml;
GRANT SELECT ON migration_ledger TO prep_app_dml;
GRANT SELECT ON migration_ledger TO prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows: no browser-facing role may touch the ledger
--   SELECT r, p FROM unnest(ARRAY['anon','authenticated','service_role']) r,
--                    unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
--    WHERE has_table_privilege(r, 'app.migration_ledger', p);
--
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'app.migration_ledger'::regclass;  -- true
