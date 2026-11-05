-- 049_grade_audit.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- THE GRADE AUDIT TRAIL IS WRITTEN BY THE DATABASE
--
-- `grade_events` was written by the browser: any staff session could insert any row, naming any person as the
-- actor, and a grade could change with no row at all. A log written by the party it describes cannot answer a
-- dispute. This file moves the writing to a trigger that reads the actor from the signed-in session and never from
-- the request, and closes the table to the API for writing.
--
-- WHAT IT DOES
--   1. `grades_audit` (AFTER INSERT / UPDATE / DELETE on `grades`) writes one `grade_events` row per change that
--      matters: 'created', 'rescored' (points changed), 'finalized', 'reopened', 'edited' (any other audited column),
--      'moved' (the grade was attached to another enrolment), 'flag_override_changed' (a reviewer clearing or restoring a flag on the diagnostic) and 'removed'. The detail holds the old and new values. The audited columns include `over_max_allowed`, `enrollment_id`
--      and `graded_at`. A write that changes none of them leaves no row. The actor is the signed-in staff member, or
--      null for a server-side process (no session). A removal keeps the grade id, the enrolment and the offering.
--   2. `grades_pin_grader` (BEFORE INSERT / UPDATE) pins `graded_by` to the signed-in staff member whenever a staff
--      session sets or changes it. A request cannot name another person as the grader; the one case that
--      keeps a different grader is a write to a row that already exists, which keeps the grader it already had (so
--      finalizing a colleague's untouched draft leaves the colleague as the grader and the audit row names who
--      finalized). Server-side processes and
--      cadet sessions (the commit trigger of 048 grades a cadet's own lesson) are not touched.
--   3. `grade_events` takes no write from the API roles: the insert policy and the table's write grants are removed.
--      The pages stop writing it (the same release changes `faculty-grade.js` and `faculty-rollup.js`).
--      For EVERY role, the service role and `prep_app_dml` included, a trigger refuses UPDATE, DELETE and TRUNCATE
--      on `grade_events` and on `credential_events`. Only the table owner can lift that (see the data-model decision
--      record for what that leaves open); this log is not proof against the database owner.
--   3b. The history outlives its grade. The foreign key from an event to its grade is dropped (it cascaded), and so is
--      the one from the actor (it would have rewritten the row when a staff member was deleted). Each event carries
--      the enrolment and the course offering it concerns, and a 'removed' event is readable by the staff who may see
--      that offering.
--   4. `credential_events`, an append-only log of password resets. The two reset functions write it with the caller
--      they have verified from the sign-in token, once when a reset is requested and once when it has been done.
--      Only the server-side role writes it; a director reads their own offering's rows; an administrator reads all.
--
-- EXCUSED CHANGES: already logged. `grade_excusal_events` (033) is written by a trigger from the session's own id;
--      nothing here changes it. 049's test shows that an excuse and a revoke each leave a row naming the signed-in
--      Director.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * Existing rows: nothing stored moves, and no past change is reconstructed. The log starts at apply time.
--   * Who may write a grade (policies on `grades`), and what a grade means.
--   * `diagnostic`: a change to that column alone is not logged, except the reviewers' flag overrides inside it.
--   * A server-side process that sends its own `grade_events` row (the `reopen_extended_grades.py` script) still
--     can; that adds a second row beside the trigger's, which is harmless.
--
-- DEPLOY ORDER: this file BEFORE the two reset functions (they refuse to reset while `credential_events` is missing).
-- Rollback: rollback/049_grade_audit_ROLLBACK.sql drops the triggers and functions, restores the insert policy and the
--   grants as they were before this file, and drops `credential_events`. Put the previous versions of the two reset
--   functions back BEFORE running it. Rows already in `grade_events` stay.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- who is acting: a signed-in staff member, or nobody ---------------------------------------------------------
CREATE FUNCTION audit_actor() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT i.id FROM instructors i WHERE i.id = current_uid();
$$;
COMMENT ON FUNCTION audit_actor() IS
  'The signed-in staff member read from the session token, or null for a server-side process or a cadet session. '
  'Never reads a request value. Migration 049.';

-- ---- pin the grader ---------------------------------------------------------------------------------------------
CREATE FUNCTION grades_pin_grader() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor uuid := audit_actor();
  v_prior uuid;
  v_found boolean;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.graded_by IS NOT NULL AND NEW.graded_by IS DISTINCT FROM v_actor THEN
      -- An insert that will hit an existing row (an upsert) keeps the grader that row already has, so a re-send of the
      -- earlier grader's id on an untouched row is not turned into the finalizer. A new row is pinned to the session.
      SELECT true, g.graded_by INTO v_found, v_prior
        FROM grades g
       WHERE g.enrollment_id = NEW.enrollment_id AND g.assignment_offering_id = NEW.assignment_offering_id;
      IF coalesce(v_found, false) THEN NEW.graded_by := v_prior; ELSE NEW.graded_by := v_actor; END IF;
    END IF;
  ELSIF NEW.graded_by IS DISTINCT FROM OLD.graded_by THEN
    NEW.graded_by := v_actor;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION grades_pin_grader() IS
  'A staff session that sets or changes graded_by gets its own id there, whatever the request named; a write to an existing row keeps the grader it had. Migration 049.';

CREATE TRIGGER grades_pin_grader
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_pin_grader();

-- ---- the audit trigger ------------------------------------------------------------------------------------------
-- The one place a grade_events row is built. The course offering is read from the offering, or from the enrolment's
-- section when the offering is already gone (a cascade), so a removal can still be found by the staff of that offering.
CREATE FUNCTION grade_events_put(p_grade uuid, p_enrollment uuid, p_offering uuid, p_event text, p_actor uuid,
                                 p_detail jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_co uuid;
BEGIN
  SELECT ao.course_offering_id INTO v_co FROM assignment_offerings ao WHERE ao.id = p_offering;
  IF v_co IS NULL THEN
    SELECT s.course_offering_id INTO v_co FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE e.id = p_enrollment;
  END IF;
  INSERT INTO grade_events (grade_id, event, actor, detail, enrollment_id, course_offering_id)
  VALUES (p_grade, p_event, p_actor, p_detail, p_enrollment, v_co);
END $$;

CREATE FUNCTION grades_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor uuid := audit_actor();
  v_event text;
  v_core  boolean;
  v_flag  boolean;
  v_via   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'server');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM grade_events_put(NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, 'created', v_actor,
            jsonb_build_object('offering', NEW.assignment_offering_id, 'points_earned', NEW.points_earned,
                               'points_possible', NEW.points_possible, 'source', NEW.source,
                               'is_finalized', NEW.is_finalized, 'over_max_allowed', NEW.over_max_allowed,
                               'graded_by', NEW.graded_by, 'via', v_via));
    RETURN NULL;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM grade_events_put(OLD.id, OLD.enrollment_id, OLD.assignment_offering_id, 'removed', v_actor,
            jsonb_build_object('grade', OLD.id, 'enrollment', OLD.enrollment_id, 'offering', OLD.assignment_offering_id,
                               'points_earned', OLD.points_earned, 'points_possible', OLD.points_possible,
                               'is_finalized', OLD.is_finalized, 'graded_by', OLD.graded_by, 'via', v_via));
    RETURN NULL;
  END IF;

  -- UPDATE: nothing audited changed -> no row
  v_core := NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible
         OR NEW.is_finalized IS DISTINCT FROM OLD.is_finalized
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.effort IS DISTINCT FROM OLD.effort
         OR NEW.question_scores IS DISTINCT FROM OLD.question_scores
         OR NEW.graded_by IS DISTINCT FROM OLD.graded_by
         OR NEW.over_max_allowed IS DISTINCT FROM OLD.over_max_allowed
         OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
         OR NEW.graded_at IS DISTINCT FROM OLD.graded_at;
  v_flag := (NEW.diagnostic -> 'flag_overrides') IS DISTINCT FROM (OLD.diagnostic -> 'flag_overrides');
  IF NOT v_core AND NOT v_flag THEN
    RETURN NULL;
  END IF;

  v_event := CASE
    WHEN NOT v_core THEN 'flag_override_changed'
    WHEN NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id THEN 'moved'
    WHEN NEW.is_finalized AND NOT OLD.is_finalized THEN 'finalized'
    WHEN OLD.is_finalized AND NOT NEW.is_finalized THEN 'reopened'
    WHEN NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible THEN 'rescored'
    ELSE 'edited' END;

  PERFORM grade_events_put(NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, v_event, v_actor,
          jsonb_build_object('offering', NEW.assignment_offering_id,
                             'points_before', OLD.points_earned, 'points_after', NEW.points_earned,
                             'finalized_before', OLD.is_finalized, 'finalized_after', NEW.is_finalized,
                             'source_before', OLD.source, 'source_after', NEW.source,
                             'graded_by_before', OLD.graded_by, 'graded_by_after', NEW.graded_by,
                             'over_max_before', OLD.over_max_allowed, 'over_max_after', NEW.over_max_allowed,
                             'graded_at_before', OLD.graded_at, 'graded_at_after', NEW.graded_at,
                             'enrollment_before', OLD.enrollment_id, 'enrollment_after', NEW.enrollment_id,
                             'via', v_via)
          || CASE WHEN v_flag THEN jsonb_build_object('flag_overrides_before', OLD.diagnostic -> 'flag_overrides',
                                                      'flag_overrides_after', NEW.diagnostic -> 'flag_overrides')
                  ELSE '{}'::jsonb END);
  RETURN NULL;
END $$;
COMMENT ON FUNCTION grades_audit() IS
  'Writes the grade_events row for a grade change. The actor is the signed-in staff member from the session, never a '
  'request value. Migration 049.';

CREATE TRIGGER grades_audit
  AFTER INSERT OR UPDATE OR DELETE ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_audit();

-- ---- grade_events: no write from the API, no rewrite from anyone ------------------------------------------------
DROP POLICY ge_staff_insert ON grade_events;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grade_events FROM anon, authenticated;

-- The history outlives its grade and its people: no foreign key from an event to either.
ALTER TABLE grade_events DROP CONSTRAINT IF EXISTS grade_events_grade_id_fkey;
ALTER TABLE grade_events DROP CONSTRAINT IF EXISTS grade_events_actor_fkey;
ALTER TABLE grade_events ADD COLUMN IF NOT EXISTS enrollment_id uuid;
ALTER TABLE grade_events ADD COLUMN IF NOT EXISTS course_offering_id uuid;
CREATE INDEX IF NOT EXISTS grade_events_offering_idx ON grade_events (course_offering_id, occurred_at DESC);
COMMENT ON COLUMN grade_events.enrollment_id IS
  'The enrolment the grade belonged to when the event was written. No foreign key: the event outlives it. Null on rows written before 049.';
COMMENT ON COLUMN grade_events.course_offering_id IS
  'The course offering the grade belonged to. No foreign key. Null on rows written before 049.';

CREATE FUNCTION audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
COMMENT ON FUNCTION audit_log_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on an audit table for every role. Only the table owner can disable the trigger. Migration 049.';

CREATE TRIGGER grade_events_append_only BEFORE UPDATE OR DELETE ON grade_events
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER grade_events_no_truncate BEFORE TRUNCATE ON grade_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Staff read the events of grades they may see; a removal (the grade is gone) is read by the staff of its offering.
DROP POLICY ge_staff_read ON grade_events;
CREATE POLICY ge_staff_read ON grade_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
                  WHERE g.id = grade_events.grade_id
                    AND e.section_id IN (SELECT staff_sections()))
         OR EXISTS (SELECT 1 FROM enrollments e WHERE e.id = grade_events.enrollment_id
                    AND e.section_id IN (SELECT staff_sections()))
         OR (grade_events.event = 'removed' AND grade_events.course_offering_id IN (SELECT staff_offerings())));

-- ---- credential_events: password resets -------------------------------------------------------------------------
CREATE TABLE credential_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event              text NOT NULL CONSTRAINT credential_events_event_ck
                       CHECK (event IN ('student_reset_requested', 'student_reset_done',
                                        'staff_reset_requested', 'staff_reset_done')),
  actor              uuid,
  course_offering_id uuid,
  target_student     bigint,
  target_staff       uuid,
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credential_events_offering_idx ON credential_events (course_offering_id, at DESC);
COMMENT ON TABLE credential_events IS
  'Append-only. A password reset is logged when it is requested and again when it is done, by the reset function, '
  'with the caller it verified from the sign-in token. No foreign keys, so the log outlives the people in it. '
  'Migration 049.';

CREATE TRIGGER credential_events_append_only
  BEFORE UPDATE OR DELETE ON credential_events
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER credential_events_no_truncate
  BEFORE TRUNCATE ON credential_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

ALTER TABLE credential_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_events_read ON credential_events FOR SELECT TO authenticated
  USING (is_admin() OR course_offering_id IN (SELECT director_offerings()));

REVOKE ALL ON credential_events FROM anon, authenticated;
GRANT SELECT ON credential_events TO authenticated;
GRANT INSERT ON credential_events TO service_role;

REVOKE ALL ON FUNCTION audit_actor()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grades_pin_grader()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grades_audit()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grade_events_put(uuid, uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION audit_log_append_only()          FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows: the API roles hold no write on the audit tables
--   SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'app' AND table_name IN ('grade_events', 'credential_events')
--      AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
--   -- must be 2: the two triggers on grades
--   SELECT count(*) FROM pg_trigger WHERE tgrelid = 'app.grades'::regclass AND tgname IN ('grades_audit', 'grades_pin_grader');
