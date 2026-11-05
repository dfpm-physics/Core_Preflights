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
--      'flag_override_changed' (a reviewer clearing or restoring a flag on the diagnostic) and 'removed'. The detail holds the old and new values. A write that changes none of the audited columns
--      leaves no row. The actor is the signed-in staff member, or null for a server-side process (no session).
--      A removal is logged with a null grade, because the grade row and its events go together.
--   2. `grades_pin_grader` (BEFORE INSERT / UPDATE) pins `graded_by` to the signed-in staff member whenever a staff
--      session sets or changes it. A request cannot name another person as the grader. Server-side processes and
--      cadet sessions (the commit trigger of 048 grades a cadet's own lesson) are not touched.
--   3. `grade_events` takes no write from the API roles: the insert policy and the table's write grants are removed.
--      The pages stop writing it (the same release changes `faculty-grade.js` and `faculty-rollup.js`).
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
-- Rollback: rollback/049_grade_audit_ROLLBACK.sql drops the triggers and functions, restores the insert policy and
--   the grants, and drops `credential_events`. Rows already in `grade_events` stay.

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
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.graded_by IS NOT NULL THEN NEW.graded_by := v_actor; END IF;
  ELSIF NEW.graded_by IS DISTINCT FROM OLD.graded_by THEN
    NEW.graded_by := v_actor;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION grades_pin_grader() IS
  'A staff session that sets or changes graded_by gets its own id there, whatever the request named. Migration 049.';

CREATE TRIGGER grades_pin_grader
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_pin_grader();

-- ---- the audit trigger ------------------------------------------------------------------------------------------
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
    INSERT INTO grade_events (grade_id, event, actor, detail)
    VALUES (NEW.id, 'created', v_actor,
            jsonb_build_object('offering', NEW.assignment_offering_id, 'points_earned', NEW.points_earned,
                               'points_possible', NEW.points_possible, 'source', NEW.source,
                               'is_finalized', NEW.is_finalized, 'via', v_via));
    RETURN NULL;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO grade_events (grade_id, event, actor, detail)
    VALUES (NULL, 'removed', v_actor,
            jsonb_build_object('grade', OLD.id, 'offering', OLD.assignment_offering_id,
                               'points_earned', OLD.points_earned, 'is_finalized', OLD.is_finalized, 'via', v_via));
    RETURN NULL;
  END IF;

  -- UPDATE: nothing audited changed -> no row
  v_core := NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible
         OR NEW.is_finalized IS DISTINCT FROM OLD.is_finalized
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.effort IS DISTINCT FROM OLD.effort
         OR NEW.question_scores IS DISTINCT FROM OLD.question_scores
         OR NEW.graded_by IS DISTINCT FROM OLD.graded_by;
  v_flag := (NEW.diagnostic -> 'flag_overrides') IS DISTINCT FROM (OLD.diagnostic -> 'flag_overrides');
  IF NOT v_core AND NOT v_flag THEN
    RETURN NULL;
  END IF;

  v_event := CASE
    WHEN NOT v_core THEN 'flag_override_changed'
    WHEN NEW.is_finalized AND NOT OLD.is_finalized THEN 'finalized'
    WHEN OLD.is_finalized AND NOT NEW.is_finalized THEN 'reopened'
    WHEN NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible THEN 'rescored'
    ELSE 'edited' END;

  INSERT INTO grade_events (grade_id, event, actor, detail)
  VALUES (NEW.id, v_event, v_actor,
          jsonb_build_object('offering', NEW.assignment_offering_id,
                             'points_before', OLD.points_earned, 'points_after', NEW.points_earned,
                             'finalized_before', OLD.is_finalized, 'finalized_after', NEW.is_finalized,
                             'source_before', OLD.source, 'source_after', NEW.source, 'via', v_via)
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

-- ---- grade_events: no write from the API -----------------------------------------------------------------------
DROP POLICY ge_staff_insert ON grade_events;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grade_events FROM anon, authenticated;

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

CREATE FUNCTION credential_events_append_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'credential_events is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER credential_events_append_only
  BEFORE UPDATE OR DELETE ON credential_events
  FOR EACH ROW EXECUTE FUNCTION credential_events_append_only();

ALTER TABLE credential_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_events_read ON credential_events FOR SELECT TO authenticated
  USING (is_admin() OR course_offering_id IN (SELECT director_offerings()));

REVOKE ALL ON credential_events FROM anon, authenticated;
GRANT SELECT ON credential_events TO authenticated;
GRANT INSERT ON credential_events TO service_role;

REVOKE ALL ON FUNCTION audit_actor()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grades_pin_grader()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grades_audit()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION credential_events_append_only()  FROM PUBLIC, anon, authenticated;

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
