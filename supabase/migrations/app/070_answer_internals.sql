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
--   3. _key_problem(format, choices, key)  ONE rule for "can the checker read this key". question_keys_readable() applies it
--                                     when a current key is written, so a numeric key with no value, a value that
--                                     does not fit the checker (more than 40 digits written out), or a choice key that
--                                     names nothing, never gets in. _answer_gate (071) applies it again at answer time.
--   4. question_keys_ai_check()        an AI-written key starts unchecked. A check is a separate UPDATE by a signed-in
--                                     person that changes nothing else on the key; an INSERT that already carries a check,
--                                     or an UPDATE that edits the key and checks it in one statement, is refused.
--   5. grades_person_correction()      a person's write to the points or the per-question scores of an auto_checked grade
--                                     moves the grade out of auto_checked (source instructor, graded_by the caller), so a
--                                     later answer or re-mark cannot overwrite the correction. It does not depend on
--                                     grades_new_items_stay_unfinalized: it must still hold after step 2 drops that trigger.
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

-- ---- can the checker read this key -------------------------------------------------------------------
-- The checker reads a key's numbers as text with at most 40 significant-looking digits (site/js/numeric-answer.js). A
-- value the database accepts but the checker cannot read would mark every answer wrong, so it is refused at entry.
CREATE FUNCTION _key_number_ok(p_v numeric) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
  SELECT p_v IS NOT NULL
     AND p_v::text ~ '^-?[0-9]+(\.[0-9]+)?$'
     AND length(regexp_replace(regexp_replace(p_v::text, '^-', ''), '\.|^0+(?=[0-9])', '', 'g')) <= 40
$$;

CREATE FUNCTION _key_problem(p_format text, p_choices jsonb, k question_keys) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_format = 'numeric' THEN
    IF k.value IS NULL THEN RETURN 'a number question needs the correct value'; END IF;
    IF NOT _key_number_ok(k.value) THEN RETURN 'the correct value is too large or too small to check (more than 40 digits written out)'; END IF;
    IF k.tol_abs IS NOT NULL AND NOT _key_number_ok(k.tol_abs) THEN RETURN 'the absolute tolerance is too large or too small to check'; END IF;
    IF k.tol_pct IS NOT NULL AND NOT _key_number_ok(k.tol_pct) THEN RETURN 'the percentage tolerance is too large or too small to check'; END IF;
  ELSIF p_format IN ('multiple_choice', 'multiple_select') THEN
    IF coalesce(cardinality(k.correct_choice_ids), 0) = 0 THEN RETURN 'a choice question needs at least one correct choice'; END IF;
    IF p_format = 'multiple_choice' AND cardinality(k.correct_choice_ids) <> 1 THEN RETURN 'a single-answer question needs exactly one correct choice'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(k.correct_choice_ids) c(id)
                WHERE c.id IS NULL
                   OR c.id NOT IN (SELECT e ->> 'id' FROM jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) e)) THEN
      RETURN 'a correct choice is not one of the question''s choices';
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION question_keys_readable() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  q         questions%ROWTYPE;
  v_problem text;
BEGIN
  IF NEW.superseded_at IS NOT NULL THEN RETURN NEW; END IF;          -- an old version is history, not a key in use
  IF TG_OP = 'UPDATE' AND OLD.superseded_at IS NULL
     AND NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.tol_abs IS NOT DISTINCT FROM OLD.tol_abs
     AND NEW.tol_pct IS NOT DISTINCT FROM OLD.tol_pct AND NEW.correct_choice_ids IS NOT DISTINCT FROM OLD.correct_choice_ids THEN
    RETURN NEW;                                                       -- a check, or an edit of something else
  END IF;
  SELECT * INTO q FROM questions WHERE id = NEW.question_id;
  v_problem := _key_problem(q.format, q.choices, NEW);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'question %: %', q.qid, v_problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER question_keys_readable
  BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_readable();

-- ---- an AI-written key is checked by a person, in a separate step ------------------------------------
CREATE FUNCTION question_keys_ai_check() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.written_by <> 'ai' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.checked_by IS NOT NULL OR NEW.checked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a key written by AI starts unchecked: a person checks it afterwards, as a separate step'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.checked_at IS NULL AND (NEW.checked_at IS NOT NULL OR NEW.checked_by IS NOT NULL) THEN
    IF current_uid() IS NULL THEN
      RAISE EXCEPTION 'an AI-written key is checked by a signed-in person' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.correct_choice_ids, NEW.value, NEW.tol_abs, NEW.tol_pct, NEW.sig_figs, NEW.sig_fig_mode, NEW.unit,
        NEW.unit_aliases, NEW.unit_mode, NEW.reference_text, NEW.superseded_at)
       IS DISTINCT FROM
       (OLD.correct_choice_ids, OLD.value, OLD.tol_abs, OLD.tol_pct, OLD.sig_figs, OLD.sig_fig_mode, OLD.unit,
        OLD.unit_aliases, OLD.unit_mode, OLD.reference_text, OLD.superseded_at) THEN
      RAISE EXCEPTION 'a check records that a person looked at the key as it stands: it cannot change the key in the same step'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER question_keys_ai_check
  BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_ai_check();

-- ---- a person's correction of an auto-checked grade holds --------------------------------------------
-- Only the answer functions write an auto_checked grade, and they set the marker for that one statement. Any other write
-- that changes the points or the per-question scores of such a grade is a person's correction: the grade stops being
-- auto_checked, so neither the next answer nor a re-mark recomputes it. This trigger does not read the new-page rule, so it
-- still stands when step 2 drops grades_new_items_stay_unfinalized.
CREATE FUNCTION grades_person_correction() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('app.auto_check_marker', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.points_earned IS DISTINCT FROM OLD.points_earned OR NEW.question_scores IS DISTINCT FROM OLD.question_scores THEN
    NEW.source    := 'instructor';
    NEW.graded_by := coalesce(current_uid(), NEW.graded_by);
    NEW.graded_at := now();
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER grades_person_correction
  BEFORE UPDATE ON grades
  FOR EACH ROW WHEN (OLD.source = 'auto_checked' AND NEW.source = 'auto_checked')
  EXECUTE FUNCTION grades_person_correction();

REVOKE ALL ON FUNCTION _key_number_ok(numeric)                  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _key_problem(text, jsonb, question_keys) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_keys_readable()                 FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_keys_ai_check()                 FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_person_correction()               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
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
