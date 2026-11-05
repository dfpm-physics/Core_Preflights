-- 042_save_function_validation.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- THE TWO SAVE FUNCTIONS (041) NOW REFUSE WHAT THE PAGES REFUSE
--
-- 041 made a question save and a letter-scale save one step each, with the database as the validator. Two kinds of
-- input got past it:
--   * A value that was SILENTLY CHANGED. A `choices` that was not a list became NULL (the question lost its
--     choices and the save said success). A `correct_choice_ids` that was not a list became "no correct choice".
--     Points with a third decimal were rounded by the column (1.005 became 1.01).
--   * A scale the page would have refused: a width or cutoff with more decimals than the page allows, a letter of
--     any length, lines carrying keys nobody reads.
--
-- After this file each of those is REFUSED with a sentence, and nothing is written. The rules are the pages' own:
--   questions   points: a number, 0 to 9999.99, two decimals at most (faculty-questions.js).
--               choices: a list, or absent/null. correct_choice_ids and unit_aliases: a list of text, or null.
--               value, tolerances, significant figures: a number (or null where the column allows it).
--   scales      at most 30 lines (MAX_LINES); each line has exactly letter, cutoff, gpa and nothing else;
--               a letter is 1 to 8 characters with no leading or trailing space; a cutoff has three decimals at
--               most, a GPA two, the near-line width three (faculty-scale.js readDecimal).
--               The ordering rules (descending cutoffs, last cutoff 0, width below the smallest gap) stay with
--               letter_scale_is_valid in the table's CHECK, as before.
--
-- UNKNOWN KEYS. In `p_cols` and `p_key` an unknown key is IGNORED, exactly as the other keys the function does
-- not read already were (a key carrying `created_by`, `version` or `superseded_at` was ignored in 041 and still is):
-- nothing from them is stored. In a scale LINE an unknown key is REFUSED, because the lines are stored as given.
--
-- NOT CHANGED. The signatures, the owner, the security mode (still SECURITY INVOKER), the search_path, the grants,
-- the permission check (it still runs first, with the same refusal text for "not yours" and "does not exist"), the
-- optimistic checks, the order of the writes. CREATE OR REPLACE keeps every privilege and comment.
--
-- ALSO RECORDED HERE (from the review of 041; 041 itself is not rewritten)
--   * letter_scales.created_by, once set, cannot be filled in later by an UPDATE (the stamp trigger refuses a change
--     of a non-null value, and it also refuses filling a null one). A backfill of an author needs the trigger
--     disabled for that statement, which is DDL.
--   * Roll back in reverse order: this file's rollback first, then 041's, then 040's. Rolling 040 back while 041
--     is applied restores the 030 policies and leaves 041's functions behind.
--
-- Rollback: rollback/042_save_function_validation_ROLLBACK.sql puts the 041 bodies back.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
BEGIN
  IF current_user <> 'prep_app_owner' THEN
    RAISE EXCEPTION '042 must be applied as prep_app_owner (this session is %). Nothing was changed.', current_user;
  END IF;
  IF to_regprocedure('app.save_question(uuid, timestamptz, jsonb, boolean, jsonb, integer)') IS NULL
     OR to_regprocedure('app.save_letter_scale(uuid, jsonb, numeric, integer)') IS NULL THEN
    RAISE EXCEPTION '042 replaces the functions made by 041, which are not here. Apply 041 first. Nothing was changed.';
  END IF;
END $$;

-- ---- save_letter_scale ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_letter_scale(p_course_offering uuid, p_lines jsonb, p_width numeric, p_expected_version integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_id   uuid;
  v_ver  integer;
  v_next integer;
  e      jsonb;
  k      text;
  v_let  text;
BEGIN
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT director_offerings()) THEN
    RAISE EXCEPTION 'save_letter_scale: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- the shape and the decimals, refused before anything is read for update or written
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'The scale needs a list of lines, at least one. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_lines) > 30 THEN
    RAISE EXCEPTION 'A scale can have 30 lines at most. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_width IS NULL THEN
    RAISE EXCEPTION 'The near-line width is missing. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_width <> round(p_width, 3) THEN
    RAISE EXCEPTION 'The near-line width can have three decimal places at most. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_lines) x LOOP
    IF jsonb_typeof(e) <> 'object' THEN
      RAISE EXCEPTION 'Each line of a scale must be an object with a letter, a cutoff and a GPA. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOR k IN SELECT jsonb_object_keys(e) LOOP
      IF k NOT IN ('letter', 'cutoff', 'gpa') THEN
        RAISE EXCEPTION 'A scale line may carry only a letter, a cutoff and a GPA, not "%". Nothing was saved.', left(k, 40)
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END LOOP;
    IF jsonb_typeof(e -> 'letter') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e -> 'cutoff') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e -> 'gpa') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Each line of a scale needs a letter (text), a cutoff (a number) and a GPA (a number). Nothing was saved.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_let := e ->> 'letter';
    IF char_length(v_let) > 8 OR v_let <> btrim(v_let) OR v_let = '' THEN
      RAISE EXCEPTION 'A letter must be 1 to 8 characters with no space at either end. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF (e ->> 'cutoff')::numeric <> round((e ->> 'cutoff')::numeric, 3) THEN
      RAISE EXCEPTION 'A cutoff can have three decimal places at most. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF (e ->> 'gpa')::numeric <> round((e ->> 'gpa')::numeric, 2) THEN
      RAISE EXCEPTION 'A GPA can have two decimal places at most. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  SELECT s.id, s.version INTO v_id, v_ver
    FROM letter_scales s
   WHERE s.course_offering_id = p_course_offering AND s.retired_at IS NULL
     FOR UPDATE;
  IF coalesce(v_ver, 0) <> coalesce(p_expected_version, 0) THEN
    RAISE EXCEPTION 'save_letter_scale: the scale in force changed since you opened the page (it is now version %)', coalesce(v_ver, 0)
      USING ERRCODE = 'P0001';
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE letter_scales SET retired_at = now() WHERE id = v_id;
  END IF;
  SELECT coalesce(max(s.version), 0) + 1 INTO v_next FROM letter_scales s WHERE s.course_offering_id = p_course_offering;
  INSERT INTO letter_scales (course_offering_id, version, lines, near_line_width)
  VALUES (p_course_offering, v_next, p_lines, p_width);
  RETURN v_next;
END; $$;

-- ---- save_question ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_question(p_question uuid, p_expected_updated_at timestamptz, p_cols jsonb,
                                         p_write_key boolean, p_key jsonb, p_expected_key_version integer)
RETURNS TABLE (key_version integer, new_version boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_activity uuid;
  v_rows     integer;
  v_cur_id   uuid;
  v_cur_ver  integer;
  v_next     integer;
  v_points   numeric;
  v_value    numeric;
  v_tol_abs  numeric;
  v_tol_pct  numeric;
  v_sig      smallint;
  v_choices  jsonb;
  v_correct  text[];
  v_aliases  text[];
BEGIN
  SELECT q.activity_id INTO v_activity FROM questions q WHERE q.id = p_question;
  IF v_activity IS NULL OR v_activity NOT IN (SELECT directed_activity_ids()) THEN
    RAISE EXCEPTION 'save_question: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- refuse what the page refuses, before anything is written ----
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'save_question: say which version of the question you read. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_cols IS NULL OR jsonb_typeof(p_cols) <> 'object' THEN
    RAISE EXCEPTION 'save_question: the question fields must be an object. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_cols ? 'choices' AND jsonb_typeof(p_cols -> 'choices') NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'save_question: the choices must be a list. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_choices := CASE WHEN jsonb_typeof(p_cols -> 'choices') = 'array' THEN p_cols -> 'choices' END;
  IF coalesce(jsonb_typeof(p_cols -> 'points'), 'null') NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'save_question: the points must be a number. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  BEGIN
    v_points := (p_cols ->> 'points')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'save_question: the points must be a number. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END;
  IF v_points < 0 OR v_points > 9999.99 THEN
    RAISE EXCEPTION 'save_question: the points must be between 0 and 9999.99. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_points <> round(v_points, 2) THEN
    RAISE EXCEPTION 'save_question: the points can have two decimal places at most. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF coalesce(p_write_key, false) THEN
    IF p_key IS NULL OR jsonb_typeof(p_key) <> 'object' THEN
      RAISE EXCEPTION 'save_question: the answer key must be an object. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_key ? 'correct_choice_ids' AND jsonb_typeof(p_key -> 'correct_choice_ids') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'save_question: the correct choices must be a list. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_key ? 'unit_aliases' AND jsonb_typeof(p_key -> 'unit_aliases') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'save_question: the unit aliases must be a list. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_key -> 'correct_choice_ids') = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_key -> 'correct_choice_ids') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'save_question: each correct choice must be text. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_key -> 'unit_aliases') = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_key -> 'unit_aliases') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'save_question: each unit alias must be text. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_key -> 'value') NOT IN ('number', 'string', 'null') OR jsonb_typeof(p_key -> 'tol_abs') NOT IN ('number', 'string', 'null')
       OR jsonb_typeof(p_key -> 'tol_pct') NOT IN ('number', 'string', 'null') OR jsonb_typeof(p_key -> 'sig_figs') NOT IN ('number', 'string', 'null') THEN
      RAISE EXCEPTION 'save_question: the value, tolerances and significant figures must be numbers. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    BEGIN
      v_value   := (p_key ->> 'value')::numeric;
      v_tol_abs := (p_key ->> 'tol_abs')::numeric;
      v_tol_pct := (p_key ->> 'tol_pct')::numeric;
      v_sig     := (p_key ->> 'sig_figs')::smallint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'save_question: the value, tolerances and significant figures must be numbers. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END;
    v_correct := CASE WHEN jsonb_typeof(p_key -> 'correct_choice_ids') = 'array'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'correct_choice_ids')) END;
    v_aliases := CASE WHEN jsonb_typeof(p_key -> 'unit_aliases') = 'array'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'unit_aliases')) END;
  END IF;

  UPDATE questions q
     SET prompt_md = p_cols ->> 'prompt_md',
         points    = v_points,
         choices   = v_choices,
         unit_hint = p_cols ->> 'unit_hint'
   WHERE q.id = p_question AND q.updated_at = p_expected_updated_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'save_question: this question changed since you opened it' USING ERRCODE = 'P0001';
  END IF;

  SELECT k.id, k.version INTO v_cur_id, v_cur_ver
    FROM question_keys k
   WHERE k.question_id = p_question AND k.variant_key = '' AND k.superseded_at IS NULL
     FOR UPDATE;

  IF NOT coalesce(p_write_key, false) THEN
    RETURN QUERY SELECT v_cur_ver, false;
    RETURN;
  END IF;

  IF v_cur_ver IS DISTINCT FROM p_expected_key_version THEN
    RAISE EXCEPTION 'save_question: the answer key changed since you opened this question' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur_id IS NOT NULL THEN
    UPDATE question_keys SET superseded_at = now() WHERE id = v_cur_id;
  END IF;
  SELECT coalesce(max(k.version), 0) + 1 INTO v_next
    FROM question_keys k WHERE k.question_id = p_question AND k.variant_key = '';

  INSERT INTO question_keys (question_id, variant_key, version, correct_choice_ids, select_rule, value, tol_abs, tol_pct,
                             sig_figs, sig_fig_mode, unit, unit_aliases, unit_mode, reference_text, written_by)
  VALUES (p_question, '', v_next, v_correct, 'all_or_nothing',
          v_value, v_tol_abs, v_tol_pct, v_sig, coalesce(p_key ->> 'sig_fig_mode', 'ignore'),
          p_key ->> 'unit', v_aliases,
          coalesce(p_key ->> 'unit_mode', 'ignore'),
          p_key ->> 'reference_text', 'human');
  RETURN QUERY SELECT v_next, true;
END; $$;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the functions: still owned by prep_app_owner, still SECURITY INVOKER, search_path pinned, EXECUTE for authenticated
--   SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
--          array_to_string(p.proconfig, ', ') AS stored_path,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_run
--     FROM pg_proc p
--    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('save_letter_scale', 'save_question');
--   -- expected: 2 rows; prep_app_owner; false; "search_path=app, pg_temp"; true; false
