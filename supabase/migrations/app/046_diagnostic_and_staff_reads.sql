-- 046_diagnostic_and_staff_reads.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- THREE READS ARE NARROWED
--   1. A cadet no longer reads `grades.diagnostic`, the assessment the graders write about them
--      (effort scores, misconceptions, flags). Cadets read their own grades through a new view that
--      carries every grade column except that one, plus the one key of it they are meant to see
--      (the instructor's note).
--   2. Only staff read the staff list. A cadet reads no `instructors` row, and a staff member reads
--      the list as before; every signed-in user can still read their own row.
--   3. Staff read the reusable library (`assignments`, `activities`) of the courses they work in, plus
--      the shared library (course_id NULL). A global admin reads all of it. Before, any staff member
--      read every course's library.
--
-- WHY THE DIAGNOSTIC STAYS ON `grades`
--   Staff and cadets sign in with the same database role, so a column privilege cannot treat them
--   differently and a row policy cannot hide one column. The choices were:
--     (a) move the column to a staff-only table. Every writer changes: both analysis skills, the
--         commit trigger, the total functions, seven repair scripts and five staff pages, plus a
--         backfill of every row.
--     (b) give cadets a view and take the row policy off the table.
--   (b) is this file. The column, its writers and its staff readers are untouched, so the analysis
--   skills and every staff page keep working with no change. The only readers that change are the two
--   cadet reads in site/js/student-data.js.
--
-- WHAT THE VIEW IS
--   my_grades: the caller's own FINALIZED grades, which is exactly what the dropped row policy
--   allowed. Same columns as `grades` minus `diagnostic`, plus `instructor_note` (the one key of the
--   diagnostic a cadet is shown). It runs with its owner's rights, because the cadet has no policy
--   left on the base table, and it is a security-barrier view so a filter a cadet supplies cannot
--   run against another cadet's row before the view's own filter. It answers from my_enrollments(),
--   which returns nothing for a session that must change its password (migration 045).
--   A grade column added later is NOT visible to cadets until this view is rebuilt to include it.
--   That is deliberate: a new column is staff-only until someone decides otherwise.
--
-- LIMITS, STATED PLAINLY
--   * `submission_activities.content` holds the same kind of assessment for an interactive activity,
--     and a cadet still reads their own row of it. That is migration 047's change (answers and
--     assessments out of `content`); this file does not touch it.
--   * Staff of one course can still read the grades of any section they staff, as before. This file
--     narrows library and staff-list reads, not roster reads.
--   * A view cannot be seen as a table by the catalogue generator; the System > Data page does not
--     list it.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   The `diagnostic` column, its default, its writers, every staff read and write of `grades`, every
--   grant to the app roles and the service role, and every stored row.
--
-- Rollback: rollback/046_diagnostic_and_staff_reads_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- 1. the courses the caller works in -------------------------------------------------------------------------

CREATE FUNCTION staff_courses() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT c.id FROM courses c WHERE is_admin()
  UNION
  SELECT co.course_id FROM course_offerings co WHERE co.id IN (SELECT staff_offerings());
$$;
COMMENT ON FUNCTION staff_courses() IS
  'Courses the caller works in, in any term and any role. A global admin works in all. Migration 046.';
REVOKE ALL ON FUNCTION staff_courses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION staff_courses() TO authenticated;

-- 2. the staff list ------------------------------------------------------------------------------------------

DROP POLICY instructors_read ON instructors;
CREATE POLICY instructors_read ON instructors FOR SELECT TO authenticated
  USING (is_staff() OR id = session_uid());

-- 3. the reusable library ------------------------------------------------------------------------------------

DROP POLICY assignments_staff_read ON assignments;
CREATE POLICY assignments_staff_read ON assignments FOR SELECT TO authenticated
  USING (is_staff() AND (course_id IS NULL OR course_id IN (SELECT staff_courses())));

DROP POLICY activities_staff_read ON activities;
CREATE POLICY activities_staff_read ON activities FOR SELECT TO authenticated
  USING (is_staff() AND EXISTS (SELECT 1 FROM assignments a
                                 WHERE a.id = activities.assignment_id
                                   AND (a.course_id IS NULL OR a.course_id IN (SELECT staff_courses()))));

-- 4. a cadet's own grades, without the diagnostic -------------------------------------------------------------

CREATE VIEW my_grades WITH (security_barrier = true) AS
  SELECT g.id, g.enrollment_id, g.assignment_offering_id, g.submission_id,
         g.points_earned, g.points_possible, g.effort, g.question_scores,
         g.source, g.is_finalized, g.graded_by, g.graded_at, g.created_at, g.updated_at,
         g.over_max_allowed, g.student_group_id, g.student_group_adjusted,
         g.diagnostic -> 'instructor_note' AS instructor_note
    FROM grades g
   WHERE g.is_finalized
     AND g.enrollment_id IN (SELECT my_enrollments());
COMMENT ON VIEW my_grades IS
  'The caller''s own finalized grades. Every grades column except diagnostic, plus the instructor note '
  'from it. Cadets read this and not the table. A column added to grades is not here until this view '
  'is rebuilt. Migration 046.';
REVOKE ALL ON my_grades FROM PUBLIC, anon;
GRANT SELECT ON my_grades TO authenticated;

DROP POLICY grades_own_finalized ON grades;

COMMIT;

-- Verify (read-only). The first returns 0 rows for a cadet session; the view's columns are the table's minus one.
--
--   SELECT attname FROM pg_attribute WHERE attrelid = 'app.grades'::regclass AND attnum > 0 AND NOT attisdropped
--   EXCEPT
--   SELECT attname FROM pg_attribute WHERE attrelid = 'app.my_grades'::regclass AND attnum > 0 AND NOT attisdropped;
--   -- expected: exactly one row, diagnostic
--
-- The behaviour is proved by scripts/staging/test_diagnostic_reads_scratch.py on a throwaway database.
