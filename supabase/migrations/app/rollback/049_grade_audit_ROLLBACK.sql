-- Rollback for 049_grade_audit.sql. Run as `prep_app_owner`.
-- Drops the grade triggers and their functions, restores the staff insert policy, the read policy and the table
-- grants on `grade_events` exactly as they were before 049, and drops `credential_events` (the reset log; export it
-- first if it holds rows you want). Rows already written to `grade_events` stay, with their two added columns.
-- Nothing in `grades` changes.
--
-- ORDER: put the previous versions of the two reset functions (reset-student-password, reset-staff-password) back
-- BEFORE running this file. The current versions refuse to reset a password while `credential_events` is missing,
-- so with the table dropped and the new functions still deployed, no reset can be done.
-- Run it after the site release that stops the pages writing `grade_events` is reverted, or those pages warn.
--
-- Grants: before 049 the signed-in role held INSERT, UPDATE and DELETE on `grade_events` (the policies decide what is
-- allowed) and no TRUNCATE. This file grants exactly those three to the signed-in role. THE ONE DIFFERENCE FROM 'EXACT':
-- before 049 the unauthenticated role (anon) held the same three rights as a platform default, and nothing uses them,
-- so this file leaves anon with NO right on the table. Rolling back therefore never returns a write right to the
-- unauthenticated role. Everything else is restored as it was.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS grades_audit ON grades;
DROP TRIGGER IF EXISTS grades_pin_grader ON grades;
DROP FUNCTION IF EXISTS grades_audit();
DROP FUNCTION IF EXISTS grades_pin_grader();
DROP FUNCTION IF EXISTS grade_events_put(uuid, uuid, uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS audit_actor();

-- the append-only triggers go before anything else that touches the table's rows
DROP TRIGGER IF EXISTS grade_events_append_only ON grade_events;
DROP TRIGGER IF EXISTS grade_events_no_truncate ON grade_events;

CREATE POLICY ge_staff_insert ON grade_events FOR INSERT TO authenticated
  WITH CHECK (is_staff());

DROP POLICY IF EXISTS ge_staff_read ON grade_events;
CREATE POLICY ge_staff_read ON grade_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
                  WHERE g.id = grade_events.grade_id
                    AND e.section_id IN (SELECT staff_sections())));

-- the grants as they were: no TRUNCATE, and nothing beyond what the platform gave these roles by default
REVOKE ALL ON grade_events FROM anon;
GRANT INSERT, UPDATE, DELETE ON grade_events TO authenticated;

-- the two foreign keys, for new rows only: the rows kept since 049 may name a grade that no longer exists
ALTER TABLE grade_events DROP CONSTRAINT IF EXISTS grade_events_grade_id_fkey;
ALTER TABLE grade_events DROP CONSTRAINT IF EXISTS grade_events_actor_fkey;
ALTER TABLE grade_events ADD CONSTRAINT grade_events_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE grade_events ADD CONSTRAINT grade_events_actor_fkey
  FOREIGN KEY (actor) REFERENCES instructors(id) ON DELETE SET NULL NOT VALID;

DROP TABLE IF EXISTS credential_events;
DROP FUNCTION IF EXISTS credential_events_append_only();
DROP FUNCTION IF EXISTS audit_log_append_only();

COMMIT;
