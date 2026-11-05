-- Rollback for 049_grade_audit.sql. Run as `prep_app_owner`.
-- Drops the grade triggers and their functions, restores the staff insert policy and the table grants on
-- `grade_events`, and drops `credential_events` (the reset log; export it first if it holds rows you want).
-- Rows already written to `grade_events` stay. Nothing in `grades` changes.
-- Run it after the site release that stops the pages writing `grade_events` is reverted, or those pages warn.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS grades_audit ON grades;
DROP TRIGGER IF EXISTS grades_pin_grader ON grades;
DROP FUNCTION IF EXISTS grades_audit();
DROP FUNCTION IF EXISTS grades_pin_grader();
DROP FUNCTION IF EXISTS audit_actor();

CREATE POLICY ge_staff_insert ON grade_events FOR INSERT TO authenticated
  WITH CHECK (is_staff());
-- the platform's default table grants for the signed-in role (the policies, not the grants, decide what is allowed)
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON grade_events TO authenticated;

DROP TABLE IF EXISTS credential_events;
DROP FUNCTION IF EXISTS credential_events_append_only();

COMMIT;
