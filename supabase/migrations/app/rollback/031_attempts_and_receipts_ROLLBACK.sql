-- Rollback for 031_attempts_and_receipts.sql. Run as `prep_app_owner`.
--
-- Drops three tables with their rows. Clean while they are empty (they are, until Stage E).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '031';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '031'
     AND (EXISTS (SELECT 1 FROM question_attempts) OR EXISTS (SELECT 1 FROM submission_receipts) OR EXISTS (SELECT 1 FROM key_remark_runs)) THEN
    RAISE EXCEPTION 'rollback of 031 would lose attempts, receipts or re-mark runs. Snapshot first, then SET prep.rollback_loses_rows = ''031'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS key_remark_runs;
DROP TABLE IF EXISTS submission_receipts;
DROP TABLE IF EXISTS question_attempts;

COMMIT;
