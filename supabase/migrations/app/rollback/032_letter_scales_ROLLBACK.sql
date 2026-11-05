-- Rollback for 032_letter_scales.sql. Run as `prep_app_owner`.
--
-- Drops the scale table with its rows. Roll back 039 first: it calls _letter_for and _scale_for, and
-- so does 037 through a stored scale snapshot only (data, no dependency).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Refuses when real rows exist. Take a snapshot first, check it against live counts, then set this
-- in the SAME session before running the file:  SET prep.rollback_loses_rows = '032';   -- this file's number, so one flag never unlocks another file
-- Empty tables roll back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '032'
     AND (EXISTS (SELECT 1 FROM letter_scales)) THEN
    RAISE EXCEPTION 'rollback of 032 would lose letter scales. Snapshot first, then SET prep.rollback_loses_rows = ''032'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS letter_scales;

DROP FUNCTION IF EXISTS _letter_for(numeric, numeric, jsonb, numeric);
DROP FUNCTION IF EXISTS current_letter_scale(uuid);
DROP FUNCTION IF EXISTS _scale_for(uuid);
DROP FUNCTION IF EXISTS default_letter_scale();
DROP FUNCTION IF EXISTS letter_scale_is_valid(jsonb, numeric);

COMMIT;
