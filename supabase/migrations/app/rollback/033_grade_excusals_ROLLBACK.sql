-- Rollback for 033_grade_excusals.sql. Run as `prep_app_owner`.
--
-- Drops both tables, including the log. The log is the audit record, so roll back only while no real
-- excusal has been made. The delete guard permits this DROP because dropping a table fires no row trigger.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '033';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '033'
     AND (EXISTS (SELECT 1 FROM grade_excusals) OR EXISTS (SELECT 1 FROM grade_excusal_events)) THEN
    RAISE EXCEPTION 'rollback of 033 would lose excusals or their log. Snapshot first, then SET prep.rollback_loses_rows = ''033'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS grade_excusals;
DROP TABLE IF EXISTS grade_excusal_events;

DROP FUNCTION IF EXISTS grade_excusal_events_append_only();
DROP FUNCTION IF EXISTS grade_excusals_log();
DROP FUNCTION IF EXISTS grade_excusals_no_direct_delete();
DROP FUNCTION IF EXISTS grade_excusals_stamp();

COMMIT;
