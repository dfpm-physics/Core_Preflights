-- Rollback for 042_save_function_validation.sql. Run as `prep_app_owner`.
--
-- Puts the two functions back exactly as 041 wrote them (no validation of the decimals, the list shapes or the
-- scale lines). Privileges, owner, comments and the signatures are untouched. Holds no data and loses none.
-- Roll back in reverse order: this file, then 041's rollback, then 040's.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- 2a. save_letter_scale: retire and insert as one step -------------------------------------------------------
-- p_expected_version is the version the page showed (0 when the offering was on the default scale). If the scale in
-- force is not that one, someone saved in between and nothing is written.
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
BEGIN
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT director_offerings()) THEN
    RAISE EXCEPTION 'save_letter_scale: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
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

-- ---- 2b. save_question: question update and key supersede-and-insert as one step ---------------------------------
-- p_cols            {"prompt_md": text, "points": number, "choices": array|null, "unit_hint": text|null}
-- p_expected_updated_at   the question's updated_at as the page read it, passed back as text, unchanged
-- p_write_key       false: leave the key alone. true: supersede the current key (if any) and insert the next version
-- p_key             the new key's fields (see below); any field absent or null is NULL / its default
-- p_expected_key_version  the version of the current key as the page read it, or null when it had none
-- Returns the key version now current (null when the question has none) and whether a new version was written.
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
BEGIN
  SELECT q.activity_id INTO v_activity FROM questions q WHERE q.id = p_question;
  IF v_activity IS NULL OR v_activity NOT IN (SELECT directed_activity_ids()) THEN
    RAISE EXCEPTION 'save_question: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE questions q
     SET prompt_md = p_cols ->> 'prompt_md',
         points    = (p_cols ->> 'points')::numeric,
         choices   = CASE WHEN jsonb_typeof(p_cols -> 'choices') = 'array' THEN p_cols -> 'choices' ELSE NULL END,
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
  VALUES (p_question, '', v_next,
          CASE WHEN jsonb_typeof(p_key -> 'correct_choice_ids') = 'array'
               THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'correct_choice_ids')) END,
          'all_or_nothing',
          (p_key ->> 'value')::numeric, (p_key ->> 'tol_abs')::numeric, (p_key ->> 'tol_pct')::numeric,
          (p_key ->> 'sig_figs')::smallint, coalesce(p_key ->> 'sig_fig_mode', 'ignore'),
          p_key ->> 'unit',
          CASE WHEN jsonb_typeof(p_key -> 'unit_aliases') = 'array'
               THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'unit_aliases')) END,
          coalesce(p_key ->> 'unit_mode', 'ignore'),
          p_key ->> 'reference_text', 'human');
  RETURN QUERY SELECT v_next, true;
END; $$;

COMMIT;
