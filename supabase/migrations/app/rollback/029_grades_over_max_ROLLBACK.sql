-- Rollback for 029_grades_over_max.sql. Run as `prep_app_owner`.
--
-- Clean until the first grade above its maximum exists (none can before step 2): restoring the old
-- check fails on such a row, and the whole transaction rolls back. It also fails while any grade has
-- source `auto_checked`. Roll back 030 to 039 first.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS assignment_offerings_over_max_off_guard ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_over_max_off_guard();

DROP TRIGGER IF EXISTS grades_new_items_stay_unfinalized ON grades;
DROP FUNCTION IF EXISTS grades_new_items_stay_unfinalized();

DROP TRIGGER IF EXISTS grades_over_max_guard ON grades;
DROP FUNCTION IF EXISTS grades_over_max_guard();

ALTER TABLE grades DROP CONSTRAINT grades_source_check;
ALTER TABLE grades ADD CONSTRAINT grades_source_check
  CHECK (source IN ('instructor', 'ai_suggested', 'derived', 'imported'));

ALTER TABLE grades DROP CONSTRAINT grades_within_bounds;
ALTER TABLE grades ADD CONSTRAINT grades_within_bounds CHECK (
  points_earned IS NULL OR (points_earned >= 0 AND points_earned <= points_possible));

ALTER TABLE grades DROP COLUMN over_max_allowed;

COMMIT;
