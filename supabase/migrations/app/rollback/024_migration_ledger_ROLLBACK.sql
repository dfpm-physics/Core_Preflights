-- Rollback for 024_migration_ledger.sql. Run as `prep_app_owner`.
--
-- Drops the ledger table. This DELETES the record of which migrations were applied, so keep
-- a copy first:  SELECT * FROM app.migration_ledger ORDER BY chain, filename;
-- Nothing else depends on the table. Re-applying 024 recreates it empty, and
-- scripts/staging/migration_ledger.py can then backfill it.

BEGIN;

DROP TABLE IF EXISTS app.migration_ledger;

COMMIT;
