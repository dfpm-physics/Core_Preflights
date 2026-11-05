-- PREP v2 -- excused work: a separate table, a Director requirement, and an append-only log
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql (enrollments, sections, assignment_offerings) and on the
-- existing helper functions director_offerings(), staff_sections(), current_uid() and is_admin(). It does NOT depend
-- on 023_instructors_admin_flag_guard.sql. Design: docs/decisions/V2-DATA-MODEL.md section 10.
--
-- WHAT IT ADDS
--   grade_excusals        one row per excusal. One UNREVOKED row per enrollment and offering (partial unique index).
--                         A separate table, so a grade save cannot touch it; the grade row is never changed, and
--                         revoking restores the state underneath.
--   grade_excusal_events  append-only log: excusal_id, enrollment_id, assignment_offering_id, action, actor, at,
--                         reason. Plain columns with NO foreign keys, so the log outlives what it describes.
--
-- WHAT THE DATABASE REQUIRES
--   * WRITE: insert and update only where the offering's course offering is in director_offerings(). A system admin
--     counts as a Director (default D3 in the design, a flagged reading of "only the Course Director").
--   * READ: staff read their sections. A student has no direct read, and sees the state through gradebook_cells,
--     never the reason.
--   * TRIGGER grade_excusals_stamp: sets set_by to the real caller and set_at to now() whatever the client sent;
--     refuses an enrollment from another course offering; allows an update only to REVOKE (everything else on the row
--     is frozen), setting revoked_by and revoked_at itself.
--   * NO DIRECT DELETE. Removal is a logged revoke. The delete trigger refuses unless pg_trigger_depth() >= 2,
--     which means a cascade from removing the lesson or the enrollment; the log then records that.
--   * OTHER ROLES: prep_app_dml and service_role bypass RLS, so their write grants on BOTH tables are revoked by
--     name. A repair runs as the owner, under the coordination gate, and must name its actor (set_by or revoked_by)
--     or the trigger refuses.
--
-- IN THE LIVE DATABASE UNTIL STEP 2
--   The Director requirement leans on instructors.is_global_admin, which 023 protects. Until 023 is applied, treat no
--   excusal as trustworthy and keep the control off. Nothing student-facing reads this table.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- grade_excusals ----------------------------------------------------------------------------
CREATE TABLE grade_excusals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  reason                 text NOT NULL,
  set_by                 uuid REFERENCES instructors(id) ON DELETE SET NULL,
  set_at                 timestamptz NOT NULL DEFAULT now(),
  revoked_at             timestamptz,
  revoked_by             uuid REFERENCES instructors(id) ON DELETE SET NULL,
  revoked_reason         text,
  CONSTRAINT grade_excusals_reason_present CHECK (length(btrim(reason)) > 0),
  CONSTRAINT grade_excusals_revocation_complete CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL AND length(btrim(revoked_reason)) > 0))
);

CREATE UNIQUE INDEX grade_excusals_one_active
  ON grade_excusals (enrollment_id, assignment_offering_id) WHERE revoked_at IS NULL;
CREATE INDEX grade_excusals_offering_idx ON grade_excusals (assignment_offering_id);

COMMENT ON TABLE grade_excusals IS
  'An excusal removes an item from a student''s total. Only a Director can set one (RLS), every change is logged '
  '(grade_excusal_events), and the grade row is never touched. Removal is a revoke, never a delete.';

-- ---- grade_excusal_events ----------------------------------------------------------------------
CREATE TABLE grade_excusal_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  excusal_id             uuid,
  enrollment_id          uuid,
  assignment_offering_id uuid,
  action                 text NOT NULL,
  actor                  uuid,
  at                     timestamptz NOT NULL DEFAULT now(),
  reason                 text,
  CONSTRAINT grade_excusal_events_action_ck CHECK (action IN ('excused', 'revoked', 'removed'))
);

CREATE INDEX grade_excusal_events_excusal_idx ON grade_excusal_events (excusal_id, at);
CREATE INDEX grade_excusal_events_enrollment_idx ON grade_excusal_events (enrollment_id, assignment_offering_id);

COMMENT ON TABLE grade_excusal_events IS
  'Append-only. Written only by the SECURITY DEFINER trigger on grade_excusals; no foreign keys, so the log '
  'outlives the excusal, the enrollment and the lesson it describes.';

-- ---- the stamp: who and when, from the database, never from the client -------------------------
CREATE FUNCTION grade_excusals_stamp() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_actor uuid := current_uid();
  v_enr_co uuid;
  v_ao_co  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.course_offering_id INTO v_enr_co
      FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE e.id = NEW.enrollment_id;
    SELECT ao.course_offering_id INTO v_ao_co FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
    IF v_enr_co IS DISTINCT FROM v_ao_co THEN
      RAISE EXCEPTION 'an excusal must join an enrollment and an item of the same course offering'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_actor IS NULL THEN
      v_actor := NEW.set_by;             -- a repair as the owner has no sign-in: it must name its actor
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'an excusal written without a signed-in caller must name set_by'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.set_by := v_actor;
    NEW.set_at := now();
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoked_reason IS NOT NULL THEN
      RAISE EXCEPTION 'an excusal is created unrevoked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. First, the one change a referential action makes: removing an instructor sets set_by or
  -- revoked_by to NULL (trigger depth 2 or more). Nothing else moves, and the record stays.
  IF pg_trigger_depth() >= 2
     AND NEW.enrollment_id IS NOT DISTINCT FROM OLD.enrollment_id
     AND NEW.assignment_offering_id IS NOT DISTINCT FROM OLD.assignment_offering_id
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.set_at IS NOT DISTINCT FROM OLD.set_at
     AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at
     AND NEW.revoked_reason IS NOT DISTINCT FROM OLD.revoked_reason
     AND (NEW.set_by IS NULL OR NEW.set_by IS NOT DISTINCT FROM OLD.set_by)
     AND (NEW.revoked_by IS NULL OR NEW.revoked_by IS NOT DISTINCT FROM OLD.revoked_by) THEN
    RETURN NEW;
  END IF;
  -- Otherwise the only change allowed is to revoke an unrevoked row
  IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.assignment_offering_id IS DISTINCT FROM OLD.assignment_offering_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.set_by IS DISTINCT FROM OLD.set_by
     OR NEW.set_at IS DISTINCT FROM OLD.set_at THEN
    RAISE EXCEPTION 'an excusal can only be revoked; its other fields do not change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'this excusal is already revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'an update to an excusal must revoke it' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL THEN
    v_actor := NEW.revoked_by;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'a revoke written without a signed-in caller must name revoked_by'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.revoked_by := v_actor;
  NEW.revoked_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER grade_excusals_stamp
  BEFORE INSERT OR UPDATE ON grade_excusals
  FOR EACH ROW EXECUTE FUNCTION grade_excusals_stamp();

-- ---- no direct delete: only a cascade (trigger depth 2 or more) may remove a row ------------------
CREATE FUNCTION grade_excusals_no_direct_delete() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'an excusal is never deleted directly; revoke it with a reason'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END; $$;

CREATE TRIGGER grade_excusals_no_direct_delete
  BEFORE DELETE ON grade_excusals
  FOR EACH ROW EXECUTE FUNCTION grade_excusals_no_direct_delete();

-- ---- the log ----------------------------------------------------------------------------------
CREATE FUNCTION grade_excusals_log() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO grade_excusal_events (excusal_id, enrollment_id, assignment_offering_id, action, actor, reason)
    VALUES (NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, 'excused', NEW.set_by, NEW.reason);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
      RETURN NULL;                       -- an instructor was removed: not a revoke, nothing to log
    END IF;
    INSERT INTO grade_excusal_events (excusal_id, enrollment_id, assignment_offering_id, action, actor, reason)
    VALUES (NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, 'revoked', NEW.revoked_by, NEW.revoked_reason);
  ELSE
    INSERT INTO grade_excusal_events (excusal_id, enrollment_id, assignment_offering_id, action, actor, reason)
    VALUES (OLD.id, OLD.enrollment_id, OLD.assignment_offering_id, 'removed', current_uid(),
            'removed with its enrollment or lesson');
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER grade_excusals_log
  AFTER INSERT OR UPDATE OR DELETE ON grade_excusals
  FOR EACH ROW EXECUTE FUNCTION grade_excusals_log();

CREATE FUNCTION grade_excusal_events_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'grade_excusal_events is append-only' USING ERRCODE = 'insufficient_privilege';
END; $$;

CREATE TRIGGER grade_excusal_events_append_only
  BEFORE UPDATE OR DELETE ON grade_excusal_events
  FOR EACH ROW EXECUTE FUNCTION grade_excusal_events_append_only();

-- ---- RLS ----------------------------------------------------------------------------------------
ALTER TABLE grade_excusals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_excusal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY grade_excusals_read_staff ON grade_excusals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e
                  WHERE e.id = grade_excusals.enrollment_id
                    AND e.section_id IN (SELECT staff_sections())));

CREATE POLICY grade_excusals_insert_director ON grade_excusals FOR INSERT TO authenticated
  WITH CHECK (assignment_offering_id IN (
                SELECT ao.id FROM assignment_offerings ao
                 WHERE ao.course_offering_id IN (SELECT director_offerings())));

CREATE POLICY grade_excusals_update_director ON grade_excusals FOR UPDATE TO authenticated
  USING (assignment_offering_id IN (
           SELECT ao.id FROM assignment_offerings ao
            WHERE ao.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (assignment_offering_id IN (
           SELECT ao.id FROM assignment_offerings ao
            WHERE ao.course_offering_id IN (SELECT director_offerings())));

CREATE POLICY grade_excusal_events_read_staff ON grade_excusal_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e
                  WHERE e.id = grade_excusal_events.enrollment_id
                    AND e.section_id IN (SELECT staff_sections()))
         OR is_admin());

-- ---- grants: by name -----------------------------------------------------------------------------
REVOKE ALL ON grade_excusals, grade_excusal_events FROM anon;
-- prep_app_dml and service_role bypass RLS: they cannot set excused
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grade_excusals FROM service_role, prep_app_dml;
REVOKE DELETE, TRUNCATE ON grade_excusals FROM authenticated;
-- the log is written by the trigger only
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grade_excusal_events FROM authenticated, service_role, prep_app_dml;

REVOKE ALL ON FUNCTION grade_excusals_stamp()               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grade_excusals_no_direct_delete()    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grade_excusals_log()                 FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grade_excusal_events_append_only()   FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows: nobody but a Director (through RLS) and the owner can write excusals
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'app' AND table_name = 'grade_excusals'
--      AND grantee IN ('anon', 'service_role', 'prep_app_dml') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
