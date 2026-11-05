-- Rollback for 034_column_closures.sql. Run as `prep_app_owner`.
--
-- Drops the table. Clean while no column has been closed. Roll back 039 first: the cell rule reads it.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '034';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '034'
     AND (EXISTS (SELECT 1 FROM column_closures)) THEN
    RAISE EXCEPTION 'rollback of 034 would lose column closures. Snapshot first, then SET prep.rollback_loses_rows = ''034'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS column_closures;
DROP FUNCTION IF EXISTS column_closures_stamp();
DROP FUNCTION IF EXISTS column_closures_no_direct_delete();

COMMIT;
