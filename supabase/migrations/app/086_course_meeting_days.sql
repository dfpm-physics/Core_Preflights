-- PREP v2 -- which days of the week a course meets
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql only. Design: docs/decisions/V2-DATA-MODEL.md, the 086 row.
--
-- WHAT IT ADDS
--   courses.meeting_days   text[] NOT NULL DEFAULT '{M,T}'. The days the course meets, from the letters
--                          M, T, W, R, F. It is a property of the COURSE, not of a term: a copy of one term
--                          into the next is a copy between two offerings of the same course, so the list
--                          carries over because it is not stored on the offering. The default is the split
--                          schedule in use today (M-day and T-day), so every existing course reads as M and T
--                          and no existing row changes meaning.
--
-- WHAT IT DOES NOT DO
--   It does not touch sections.meeting_days. A section keeps whatever day it holds, including one outside its
--   course's list; the list is what the pages OFFER, not a rule the database enforces on sections.
--   It does not change due-date resolution, the track order, or any report.
--
-- COST
--   A constant default, so adding the column rewrites no row and fires no trigger. Old writers name their
--   columns, so an insert that leaves it out gets M and T. courses_write still admits administrators only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE courses
  ADD COLUMN meeting_days text[] NOT NULL DEFAULT ARRAY['M', 'T']::text[];

ALTER TABLE courses
  ADD CONSTRAINT courses_meeting_days_ck
  CHECK (cardinality(meeting_days) BETWEEN 1 AND 5
         AND meeting_days <@ ARRAY['M', 'T', 'W', 'R', 'F']::text[]);

COMMENT ON COLUMN courses.meeting_days IS
  'The days of the week this course meets: M, T, W, R (Thursday), F. Default M and T, the split schedule. '
  'What the pages offer for a new section and what the roster import checks a section''s day against. '
  'Not enforced on sections.meeting_days: a section that holds another day keeps it.';

COMMIT;
