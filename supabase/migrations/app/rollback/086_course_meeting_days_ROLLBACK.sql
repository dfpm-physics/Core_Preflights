-- Rollback for 086_course_meeting_days.sql. Run as `prep_app_owner`.
--
-- Clean when every course still has the default M and T. Dropping the column loses any other list a course was
-- given, so it refuses then. Take a snapshot of courses first, check it against live counts, then set this in
-- the SAME session before running the file:  SET prep.rollback_loses_rows = '086';
-- Sections are not touched: each keeps the day it holds.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '086'
     AND EXISTS (SELECT 1 FROM courses WHERE meeting_days <> ARRAY['M', 'T']::text[]) THEN
    RAISE EXCEPTION 'rollback of 086 would lose a course''s own meeting days. Snapshot first, then SET prep.rollback_loses_rows = ''086'' in this session. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_meeting_days_ck;
ALTER TABLE courses DROP COLUMN IF EXISTS meeting_days;

COMMIT;
