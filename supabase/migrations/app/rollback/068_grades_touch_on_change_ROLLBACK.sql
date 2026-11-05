-- Rollback for 068_grades_touch_on_change.sql. Run as `prep_app_owner`.
-- Puts the original trigger back: grades.updated_at moves on every update, including one that changes nothing.
-- No data changes. Stored updated_at values stay as they are.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS grades_touch ON grades;
CREATE TRIGGER grades_touch BEFORE UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP FUNCTION IF EXISTS grades_touch_if_changed();

COMMIT;
