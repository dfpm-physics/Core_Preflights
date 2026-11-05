-- PREP v2 -- closing a column of hand-entered or imported scores, per section
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql (assignment_offerings, sections) and the existing helper
-- functions staff_sections() and current_uid(). It does NOT depend on 023_instructors_admin_flag_guard.sql.
-- Design: docs/decisions/V2-DATA-MODEL.md sections 0 (decision 1) and 7.
--
-- WHAT IT ADDS
--   column_closures   (id, assignment_offering_id, section_id, closed_by, closed_at, reopened_by, reopened_at).
--                     One OPEN row per offering and section (partial unique index). "Publish whole column" writes it.
--
-- WHY
--   In-person and Gradescope work has no submission. A blank is "awaiting entry" and leaves the total until a person
--   closes the column for that section; after that a blank counts 0 (Missing). Nothing closes by itself. It is per
--   section because the sections of one course finish at different times, and one active offering of a course holds
--   all its sections.
--
-- RLS    Staff of that section read and write (the instructor of a section closes its column). prep_app_dml and
--        service_role keep their ordinary grants; closing is a business act of staff, not a privilege to withdraw.
-- TRIGGER closure_stamp sets closed_by and closed_at from the caller and the clock, and refuses a section that
--        belongs to a different course offering than the item.
-- THE CURRENT SITE   A new table nothing reads.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE TABLE column_closures (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  section_id             uuid NOT NULL REFERENCES sections(id)             ON DELETE CASCADE,
  closed_by              uuid REFERENCES instructors(id) ON DELETE SET NULL,
  closed_at              timestamptz NOT NULL DEFAULT now(),
  reopened_by            uuid REFERENCES instructors(id) ON DELETE SET NULL,
  reopened_at            timestamptz,
  CONSTRAINT column_closures_reopen_order CHECK (reopened_at IS NULL OR reopened_at >= closed_at)
);

CREATE UNIQUE INDEX column_closures_one_open
  ON column_closures (assignment_offering_id, section_id) WHERE reopened_at IS NULL;
CREATE INDEX column_closures_section_idx ON column_closures (section_id);

COMMENT ON TABLE column_closures IS
  'An instructor closes the column of a no-submission item for one section. Before that a blank is awaiting entry '
  'and leaves the total; after it a blank counts 0. Nothing closes by itself. Reopening stamps reopened_at; the '
  'row stays as the record.';

CREATE FUNCTION column_closures_stamp() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_actor uuid := current_uid();
  v_sec_co uuid;
  v_ao_co  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.course_offering_id INTO v_sec_co FROM sections s WHERE s.id = NEW.section_id;
    SELECT ao.course_offering_id INTO v_ao_co FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
    IF v_sec_co IS DISTINCT FROM v_ao_co THEN
      RAISE EXCEPTION 'a column closure must join a section and an item of the same course offering'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_by := coalesce(v_actor, NEW.closed_by);
    NEW.closed_at := now();
    NEW.reopened_at := NULL;
    NEW.reopened_by := NULL;
  ELSE
    -- removing an instructor sets closed_by or reopened_by to NULL (trigger depth 2 or more); nothing else moves
    IF pg_trigger_depth() >= 2
       AND NEW.assignment_offering_id IS NOT DISTINCT FROM OLD.assignment_offering_id
       AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id
       AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
       AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at
       AND (NEW.closed_by IS NULL OR NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by)
       AND (NEW.reopened_by IS NULL OR NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by) THEN
      RETURN NEW;
    END IF;
    IF NEW.assignment_offering_id IS DISTINCT FROM OLD.assignment_offering_id
       OR NEW.section_id IS DISTINCT FROM OLD.section_id
       OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'a column closure can only be reopened; its other fields do not change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.reopened_at IS NOT NULL THEN
      RAISE EXCEPTION 'this column closure is already reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reopened_at IS NOT NULL THEN
      NEW.reopened_at := now();
      NEW.reopened_by := coalesce(v_actor, NEW.reopened_by);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER column_closures_stamp
  BEFORE INSERT OR UPDATE ON column_closures
  FOR EACH ROW EXECUTE FUNCTION column_closures_stamp();

-- no direct delete: only a cascade (trigger depth 2 or more, from the lesson, the section or the course) removes a row
CREATE FUNCTION column_closures_no_direct_delete() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'a column closure is never deleted directly; reopen it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END; $$;

CREATE TRIGGER column_closures_no_direct_delete
  BEFORE DELETE ON column_closures
  FOR EACH ROW EXECUTE FUNCTION column_closures_no_direct_delete();

ALTER TABLE column_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY column_closures_read_staff ON column_closures FOR SELECT TO authenticated
  USING (section_id IN (SELECT staff_sections()));
CREATE POLICY column_closures_insert_staff ON column_closures FOR INSERT TO authenticated
  WITH CHECK (section_id IN (SELECT staff_sections()));
CREATE POLICY column_closures_update_staff ON column_closures FOR UPDATE TO authenticated
  USING (section_id IN (SELECT staff_sections()))
  WITH CHECK (section_id IN (SELECT staff_sections()));

REVOKE ALL ON column_closures FROM anon;
REVOKE DELETE, TRUNCATE ON column_closures FROM authenticated, service_role, prep_app_dml;
REVOKE ALL ON FUNCTION column_closures_no_direct_delete()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION column_closures_stamp()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT count(*) FROM app.column_closures;      -- 0 until a person closes a column
