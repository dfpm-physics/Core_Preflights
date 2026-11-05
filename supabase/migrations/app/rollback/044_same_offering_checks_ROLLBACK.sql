-- Rollback for 044_same_offering_checks.sql. Run as `prep_app_owner`.
-- Drops the eleven triggers and the six check functions. Rows written while they existed stay as they are.
-- After this, a row whose two sides name different course offerings is accepted again.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER staff_assignments_same_offering ON staff_assignments;
DROP TRIGGER assignment_due_dates_same_offering ON assignment_due_dates;
DROP TRIGGER grades_same_offering ON grades;
DROP TRIGGER submissions_same_offering ON submissions;
DROP TRIGGER extensions_same_offering ON extensions;
DROP TRIGGER question_attempts_same_offering ON question_attempts;
DROP TRIGGER student_group_snapshots_enrollment_same_offering ON student_group_snapshots;
DROP TRIGGER student_group_snapshots_group_same_offering ON student_group_snapshots;
DROP TRIGGER student_group_grades_same_offering ON student_group_grades;
DROP TRIGGER assignment_offerings_same_course ON assignment_offerings;
DROP TRIGGER offering_activities_same_assignment ON offering_activities;

DROP FUNCTION staff_assignments_same_offering();
DROP FUNCTION section_matches_item();
DROP FUNCTION enrollment_matches_item();
DROP FUNCTION group_matches_item();
DROP FUNCTION item_matches_course();
DROP FUNCTION path_matches_item();

COMMIT;
