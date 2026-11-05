-- PREP v2 Stage E -- the pieces the answer-marking functions share
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 029_grades_over_max.sql (grades_new_items_stay_unfinalized) and
-- 038_deadline_functions.sql (_scheduled_core, release_at). Design: docs/decisions/V2-DATA-MODEL.md sections 12, 13.
-- 071_answer_marking.sql uses what this file adds.
--
-- WHAT IT DOES
--   1. _release_core(item, section)   the release rule of 038, with no caller check, so the marking function can ask
--                                     "has this item opened for this section" without a signed-in student session.
--      release_at(item, section)      REPLACED: same guard as 038, same result, but it now calls _release_core. The
--                                     rule is written once.
--   2. grades_new_items_stay_unfinalized()  REPLACED: the 029 rule is kept ("an item entered on a new page cannot hold
--                                     a finalized grade yet") with ONE exception: the marking function, which sets a
--                                     transaction-local marker for the single statement that writes an auto-checked
--                                     grade. Step 2 drops this trigger altogether; the exception goes with it.
--
-- WHAT IT DOES NOT DO
--   It grants nothing new. _release_core has no web-facing grant. Nothing the current site calls changes behaviour:
--   release_at has no grant at step 1 and the trigger still refuses every write that does not set the marker.
--
-- THE MARKER IS NOT A PASSWORD
--   `app.auto_check_marker` is a plain setting. It is safe because the only roles that can run arbitrary SQL are the
--   server-side ones, and an API client can reach only the functions it is granted (neither answer function is
--   granted to a signed-in user). The same convention carries app.group_score_marker (036).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION _release_core(p_assignment_offering uuid, p_section uuid) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_opens timestamptz;
  v_due   timestamptz;
BEGIN
  SELECT ao.opens_at INTO v_opens FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_opens IS NOT NULL THEN
    RETURN v_opens;                       -- explicit wins, earlier or later, at the exact instant
  END IF;
  SELECT c.due_at INTO v_due FROM _scheduled_core(p_assignment_offering, p_section) c;
  IF v_due IS NULL THEN
    RETURN NULL;
  END IF;
  -- seven days before the SCHEDULED deadline (never the extended one), floored to the start of that day in Denver
  RETURN date_trunc('day', (v_due - interval '7 days') AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver';
END; $$;

COMMENT ON FUNCTION _release_core(uuid, uuid) IS
  'When an item opens for a section: opens_at, else seven days before the scheduled deadline floored to the start of '
  'the day in Denver. No caller check; internal. release_at and the answer functions both read this.';

CREATE OR REPLACE FUNCTION release_at(p_assignment_offering uuid, p_section uuid) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM sections s JOIN assignment_offerings ao ON ao.course_offering_id = s.course_offering_id
                   WHERE s.id = p_section AND ao.id = p_assignment_offering)
          AND (p_section IN (SELECT staff_sections())
               OR p_section IN (SELECT e.section_id FROM enrollments e WHERE e.id IN (SELECT my_enrollments())))) THEN
    RETURN NULL;
  END IF;
  RETURN _release_core(p_assignment_offering, p_section);
END; $$;

CREATE OR REPLACE FUNCTION grades_new_items_stay_unfinalized() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('app.auto_check_marker', true), '') = 'on' THEN
    RETURN NEW;                           -- the answer-marking function writing an auto_checked grade
  END IF;
  IF coalesce((SELECT ao.entered_on_new_page FROM assignment_offerings ao
                WHERE ao.id = NEW.assignment_offering_id), false) THEN
    RAISE EXCEPTION
      'grade on assignment offering %: an item entered on a new page cannot hold a finalized grade yet (grades_new_items_stay_unfinalized)',
      NEW.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION _release_core(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION release_at(uuid, uuid)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_new_items_stay_unfinalized()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 1 row: release_at now delegates
--   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.proname = 'release_at' AND p.prosrc LIKE '%_release_core%';
--   -- 1 row: the guard knows the marker
--   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.proname = 'grades_new_items_stay_unfinalized' AND p.prosrc LIKE '%auto_check_marker%';
