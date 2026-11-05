-- Rollback for 037_checkpoints.sql. Run as `prep_app_owner`.
--
-- Drops the three tables. Clean only while no run has been approved: an approved checkpoint is a
-- frozen record, and dropping the tables destroys it. DROP TABLE fires no row trigger, so the freeze
-- does not stop it; that is the reason this is a coordinated, gated operation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '037';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '037'
     AND (EXISTS (SELECT 1 FROM grade_checkpoint_runs) OR EXISTS (SELECT 1 FROM grade_checkpoint_rows) OR EXISTS (SELECT 1 FROM checkpoint_tie_choices)) THEN
    RAISE EXCEPTION 'rollback of 037 would lose checkpoint runs, rows or tie choices (an approved checkpoint is a frozen record). Snapshot first, then SET prep.rollback_loses_rows = ''037'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS checkpoint_tie_choices;
DROP TABLE IF EXISTS grade_checkpoint_rows;
DROP TABLE IF EXISTS grade_checkpoint_runs;

DROP FUNCTION IF EXISTS checkpoint_child_freeze();
DROP FUNCTION IF EXISTS grade_checkpoint_runs_freeze();

COMMIT;
