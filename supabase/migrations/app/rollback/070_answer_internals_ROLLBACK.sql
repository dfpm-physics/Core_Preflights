-- Rollback for 070_answer_internals.sql. Run as `prep_app_owner`, AFTER 071 has been rolled back.
-- Restores release_at and grades_new_items_stay_unfinalized to their 038 and 029 bodies, then drops _release_core.
-- Holds no data and loses none.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION release_at(p_assignment_offering uuid, p_section uuid) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_opens timestamptz;
  v_due   timestamptz;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM sections s JOIN assignment_offerings ao ON ao.course_offering_id = s.course_offering_id
                   WHERE s.id = p_section AND ao.id = p_assignment_offering)
          AND (p_section IN (SELECT staff_sections())
               OR p_section IN (SELECT e.section_id FROM enrollments e WHERE e.id IN (SELECT my_enrollments())))) THEN
    RETURN NULL;
  END IF;
  SELECT ao.opens_at INTO v_opens FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_opens IS NOT NULL THEN
    RETURN v_opens;
  END IF;
  SELECT c.due_at INTO v_due FROM _scheduled_core(p_assignment_offering, p_section) c;
  IF v_due IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN date_trunc('day', (v_due - interval '7 days') AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver';
END; $$;

CREATE OR REPLACE FUNCTION grades_new_items_stay_unfinalized() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF coalesce((SELECT ao.entered_on_new_page FROM assignment_offerings ao
                WHERE ao.id = NEW.assignment_offering_id), false) THEN
    RAISE EXCEPTION
      'grade on assignment offering %: an item entered on a new page cannot hold a finalized grade yet (grades_new_items_stay_unfinalized)',
      NEW.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP FUNCTION _release_core(uuid, uuid);

REVOKE ALL ON FUNCTION release_at(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_new_items_stay_unfinalized()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;
