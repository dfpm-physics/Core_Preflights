-- Rollback for 046_diagnostic_and_staff_reads.sql. Run as `prep_app_owner`.
-- Puts the four policies back as 002 and 045 left them and drops the view and the helper.
-- Deploy the previous site files first or at the same time: with this rolled back, the cadet pages that
-- read `my_grades` find no view.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE POLICY grades_own_finalized ON grades FOR SELECT TO authenticated
  USING (is_finalized AND enrollment_id IN (SELECT my_enrollments()));

DROP VIEW my_grades;

DROP POLICY activities_staff_read ON activities;
CREATE POLICY activities_staff_read ON activities FOR SELECT TO authenticated
  USING (is_staff());

DROP POLICY assignments_staff_read ON assignments;
CREATE POLICY assignments_staff_read ON assignments FOR SELECT TO authenticated
  USING (is_staff());

DROP POLICY instructors_read ON instructors;
CREATE POLICY instructors_read ON instructors FOR SELECT TO authenticated USING (true);

DROP FUNCTION staff_courses();

COMMIT;
