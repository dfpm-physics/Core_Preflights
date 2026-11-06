-- PREP v2 Stage E -- symbolic answers: a question whose answer is an expression
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 030 (questions, question_keys), 042 (save_question), 070 (key readability and AI-check
-- triggers, _key_problem), 071 (answer_context), 072 (remark_context) and 073 (student_homework). Design:
-- docs/decisions/V2-STAGE-E-ANSWERS.md ("Symbolic answers"), docs/decisions/V2-DATA-MODEL.md section 12.
--
-- WHAT IT DOES
--   1. questions.format may now be 'symbolic'.
--   2. question_keys gains three columns, all used only by a symbolic question:
--        expression        the expected expression, as text (at most 200 characters)
--        variables         the variable names the answer may use (1 to 8)
--        signed_variables  the variables that may be negative (a subset of `variables`; none by default). The checker
--                          tests every other variable on positive values only, so sqrt(k)/sqrt(m) matches sqrt(k/m).
--      A key on any other kind of question may not carry either (trigger), and a prose question's key may not
--      (the prose rule of 030 is widened).
--   3. _key_problem knows the symbolic key: an expression that is present, short, built from the characters the grammar
--      reads and with matching brackets; a list of valid, distinct variable names that are not function or constant names.
--      The database does not parse the expression: whether it READS and is defined at the test points is decided by
--      the same file the answer function uses (site/js/symbolic-answer.js), in the staff preview, and again when an
--      answer arrives. A key that does not parse gives 'key_fault': nothing is stored and no attempt is used.
--   4. The readability and AI-check triggers include the two new columns, so an edited expression is re-checked, and a
--      person's check of an AI-written key cannot also change the expression.
--   5. save_question writes the two columns into the new key version.
--   6. answer_context and remark_context hand the expression and variables to the edge functions only (service_role).
--   7. student_homework returns the variable NAMES of a symbolic question (so the page can say what may be typed and
--      show a preview). It still returns no key data: never the expression.
--
-- WHAT IT DOES NOT DO
--   It changes no existing row. Numeric, multiple-choice and multiple-select questions are marked exactly as before.
--   It grants nothing new. record_answer and remark_apply are untouched: a symbolic answer is stored as {"raw": "..."}
--   with no parsed number, and its verdict comes from the edge function, as every verdict does.
--   Units, vectors and equations are not part of the first version.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- 1. the format ------------------------------------------------------------------------------------
ALTER TABLE questions DROP CONSTRAINT questions_format_ck;
ALTER TABLE questions ADD CONSTRAINT questions_format_ck
  CHECK (format IN ('multiple_choice', 'multiple_select', 'numeric', 'symbolic', 'prose'));

-- ---- 2. the key columns -------------------------------------------------------------------------------
ALTER TABLE question_keys ADD COLUMN expression text;
ALTER TABLE question_keys ADD COLUMN variables  text[];
ALTER TABLE question_keys ADD COLUMN signed_variables text[];
ALTER TABLE question_keys ADD CONSTRAINT question_keys_expression_ck
  CHECK (expression IS NULL OR char_length(expression) <= 200);
ALTER TABLE question_keys ADD CONSTRAINT question_keys_variables_ck
  CHECK (variables IS NULL OR cardinality(variables) BETWEEN 1 AND 8);
ALTER TABLE question_keys ADD CONSTRAINT question_keys_signed_variables_ck
  CHECK (signed_variables IS NULL OR cardinality(signed_variables) BETWEEN 0 AND 8);

COMMENT ON COLUMN question_keys.expression IS
  'Symbolic questions only: the expected expression as text, at most 200 characters. Read by the check-answer function, which '
  'evaluates it and the answer at fixed test points. Never sent to a student.';
COMMENT ON COLUMN question_keys.variables IS
  'Symbolic questions only: the variable names an answer may use. The names (not the expression) are shown to students.';
COMMENT ON COLUMN question_keys.signed_variables IS
  'Symbolic questions only: the variables, among `variables`, that the checker also tests at negative values. Empty or NULL means '
  'every variable is tested on positive values only. Never sent to a student.';

CREATE FUNCTION question_keys_check_symbolic() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_format text;
BEGIN
  IF NEW.expression IS NULL AND NEW.variables IS NULL AND NEW.signed_variables IS NULL THEN RETURN NEW; END IF;
  SELECT q.format INTO v_format FROM questions q WHERE q.id = NEW.question_id;
  IF v_format IS DISTINCT FROM 'symbolic' THEN
    RAISE EXCEPTION 'only a symbolic question can carry an expected expression, variables or signed variables on its key'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER question_keys_check_symbolic
  BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_check_symbolic();
REVOKE ALL ON FUNCTION question_keys_check_symbolic() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

-- ---- 3. can the checker read this key -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION _key_problem(p_format text, p_choices jsonb, k question_keys) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
DECLARE
  v_name text;
  v_br   text;
BEGIN
  IF p_format = 'numeric' THEN
    IF k.value IS NULL THEN RETURN 'a number question needs the correct value'; END IF;
    IF NOT _key_number_ok(k.value) THEN RETURN 'the correct value is too large or too small to check (more than 40 digits written out)'; END IF;
    IF k.tol_abs IS NOT NULL AND NOT _key_number_ok(k.tol_abs) THEN RETURN 'the absolute tolerance is too large or too small to check'; END IF;
    IF k.tol_pct IS NOT NULL AND NOT _key_number_ok(k.tol_pct) THEN RETURN 'the percentage tolerance is too large or too small to check'; END IF;
  ELSIF p_format = 'symbolic' THEN
    IF k.expression IS NULL OR btrim(k.expression) = '' THEN RETURN 'a symbolic question needs the expected expression'; END IF;
    IF char_length(k.expression) > 200 THEN RETURN 'the expected expression is longer than 200 characters'; END IF;
    IF k.expression ~ E'[^A-Za-z0-9_.+*/^() \u0370-\u03FF\u2212\u00D7\u00B7\u00F7\u00B2\u00B3\u00B9\u2070-\u2079\u207A\u207B\u00B5\u00BC\u00BD\u00BE\u2080-\u2089\u221A-]' THEN
      RETURN 'the expected expression uses a character that is not read (use letters, digits, + - * / ^ and round brackets)';
    END IF;
    v_br := regexp_replace(k.expression, '[^()]', '', 'g');
    WHILE position('()' IN v_br) > 0 LOOP v_br := replace(v_br, '()', ''); END LOOP;
    IF v_br <> '' THEN
      RETURN 'the expected expression has brackets that do not match';
    END IF;
    IF coalesce(cardinality(k.variables), 0) NOT BETWEEN 1 AND 8 THEN RETURN 'a symbolic question needs 1 to 8 variables'; END IF;
    IF (SELECT count(DISTINCT v) FROM unnest(k.variables) v) <> cardinality(k.variables) THEN RETURN 'a variable is listed twice'; END IF;
    IF k.signed_variables IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.signed_variables) s(n) WHERE s.n IS NULL OR s.n <> ALL (k.variables)) THEN
      RETURN 'a variable marked as able to be negative is not one of the variables';
    END IF;
    FOREACH v_name IN ARRAY k.variables LOOP
      IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 12 OR v_name !~ E'^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$' THEN
        RETURN 'a variable name must be 1 to 12 characters, start with a letter and use only letters, digits and underscores';
      END IF;
      IF v_name IN ('sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'exp', 'ln', 'log10', 'log', 'abs', 'e', 'pi', E'\u03C0',
                    'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString') THEN
        RETURN 'a variable cannot be named like a function or a constant';
      END IF;
    END LOOP;
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

-- ---- 4. the triggers that read the key's columns ------------------------------------------------------
CREATE OR REPLACE FUNCTION question_keys_readable() RETURNS trigger
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
     AND NEW.tol_pct IS NOT DISTINCT FROM OLD.tol_pct AND NEW.correct_choice_ids IS NOT DISTINCT FROM OLD.correct_choice_ids
     AND NEW.expression IS NOT DISTINCT FROM OLD.expression AND NEW.variables IS NOT DISTINCT FROM OLD.variables
     AND NEW.signed_variables IS NOT DISTINCT FROM OLD.signed_variables THEN
    RETURN NEW;                                                       -- a check, or an edit of something else
  END IF;
  SELECT * INTO q FROM questions WHERE id = NEW.question_id;
  v_problem := _key_problem(q.format, q.choices, NEW);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'question %: %', q.qid, v_problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION question_keys_ai_check() RETURNS trigger
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
        NEW.unit_aliases, NEW.unit_mode, NEW.reference_text, NEW.superseded_at, NEW.expression, NEW.variables,
        NEW.signed_variables)
       IS DISTINCT FROM
       (OLD.correct_choice_ids, OLD.value, OLD.tol_abs, OLD.tol_pct, OLD.sig_figs, OLD.sig_fig_mode, OLD.unit,
        OLD.unit_aliases, OLD.unit_mode, OLD.reference_text, OLD.superseded_at, OLD.expression, OLD.variables,
        OLD.signed_variables) THEN
      RAISE EXCEPTION 'a check records that a person looked at the key as it stands: it cannot change the key in the same step'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION questions_check_prose() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.format = 'prose' THEN
    IF EXISTS (SELECT 1 FROM offering_activities oa
                WHERE oa.activity_id = NEW.activity_id AND oa.grading = 'auto_checked') THEN
      RAISE EXCEPTION 'question %: a prose question cannot sit on an auto_checked path', NEW.qid
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
         SELECT 1 FROM question_keys k
          WHERE k.question_id = NEW.id
            AND (k.correct_choice_ids IS NOT NULL OR k.value IS NOT NULL OR k.tol_abs IS NOT NULL
                 OR k.tol_pct IS NOT NULL OR k.sig_figs IS NOT NULL OR k.unit IS NOT NULL
                 OR k.unit_aliases IS NOT NULL OR k.sig_fig_mode <> 'ignore' OR k.unit_mode <> 'ignore'
                 OR k.expression IS NOT NULL OR k.variables IS NOT NULL OR k.signed_variables IS NOT NULL)) THEN
      RAISE EXCEPTION 'question %: a prose question cannot carry machine fields on its key', NEW.qid
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION question_keys_check_prose() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_format text;
BEGIN
  SELECT q.format INTO v_format FROM questions q WHERE q.id = NEW.question_id;
  IF v_format = 'prose'
     AND (NEW.correct_choice_ids IS NOT NULL OR NEW.value IS NOT NULL OR NEW.tol_abs IS NOT NULL
          OR NEW.tol_pct IS NOT NULL OR NEW.sig_figs IS NOT NULL OR NEW.unit IS NOT NULL
          OR NEW.unit_aliases IS NOT NULL OR NEW.sig_fig_mode <> 'ignore' OR NEW.unit_mode <> 'ignore'
          OR NEW.expression IS NOT NULL OR NEW.variables IS NOT NULL OR NEW.signed_variables IS NOT NULL) THEN
    RAISE EXCEPTION 'a key on a prose question may carry only reference_text, never a machine field'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

-- ---- 5. save_question writes the two columns ----------------------------------------------------------
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
  v_expr     text;
  v_vars     text[];
  v_signed   text[];
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
    IF jsonb_typeof(p_key -> 'expression') NOT IN ('string', 'null')
       OR (p_key ? 'variables' AND jsonb_typeof(p_key -> 'variables') NOT IN ('array', 'null'))
       OR (p_key ? 'signed_variables' AND jsonb_typeof(p_key -> 'signed_variables') NOT IN ('array', 'null')) THEN
      RAISE EXCEPTION 'save_question: the expected expression must be text and the variables a list. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_key -> 'signed_variables') = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_key -> 'signed_variables') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'save_question: each variable marked as able to be negative must be text. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(p_key -> 'variables') = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_key -> 'variables') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'save_question: each variable name must be text. Nothing was saved.' USING ERRCODE = 'invalid_parameter_value';
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
    v_expr := p_key ->> 'expression';
    v_vars := CASE WHEN jsonb_typeof(p_key -> 'variables') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'variables')) END;
    v_signed := CASE WHEN jsonb_typeof(p_key -> 'signed_variables') = 'array'
                     THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'signed_variables')) END;
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
                             sig_figs, sig_fig_mode, unit, unit_aliases, unit_mode, reference_text, written_by,
                             expression, variables, signed_variables)
  VALUES (p_question, '', v_next, v_correct, 'all_or_nothing',
          v_value, v_tol_abs, v_tol_pct, v_sig, coalesce(p_key ->> 'sig_fig_mode', 'ignore'),
          p_key ->> 'unit', v_aliases,
          coalesce(p_key ->> 'unit_mode', 'ignore'),
          p_key ->> 'reference_text', 'human',
          v_expr, v_vars, v_signed);
  RETURN QUERY SELECT v_next, true;
END; $$;

-- ---- 6. the key goes to the edge functions only --------------------------------------------------------
CREATE OR REPLACE FUNCTION answer_context(p_auth_user uuid, p_assignment_offering uuid, p_question uuid) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  g record;
  k question_keys%ROWTYPE;
BEGIN
  SELECT * INTO g FROM _answer_gate(p_auth_user, p_assignment_offering, p_question, false);
  IF g.status <> 'ok' THEN
    RETURN jsonb_build_object('status', g.status);
  END IF;
  SELECT * INTO k FROM question_keys WHERE id = g.key_id;
  RETURN jsonb_build_object(
    'status', 'ok',
    'format', g.format,
    'choice_ids', coalesce((SELECT jsonb_agg(c ->> 'id') FROM jsonb_array_elements(coalesce(g.choices, '[]'::jsonb)) c), '[]'::jsonb),
    'key_version_id', k.id,
    'key', jsonb_build_object(
      'correct_choice_ids', to_jsonb(coalesce(k.correct_choice_ids, ARRAY[]::text[])),
      'value',        k.value::text,
      'tol_abs',      k.tol_abs::text,
      'tol_pct',      k.tol_pct::text,
      'sig_figs',     k.sig_figs,
      'sig_fig_mode', k.sig_fig_mode,
      'unit',         k.unit,
      'unit_aliases', to_jsonb(coalesce(k.unit_aliases, ARRAY[]::text[])),
      'unit_mode',    k.unit_mode,
      'expression',   k.expression,
      'variables',    to_jsonb(coalesce(k.variables, ARRAY[]::text[])),
      'signed_variables', to_jsonb(coalesce(k.signed_variables, ARRAY[]::text[]))));
END; $$;

CREATE OR REPLACE FUNCTION remark_context(p_auth_user uuid, p_question uuid) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  q questions%ROWTYPE;
  k question_keys%ROWTYPE;
BEGIN
  IF NOT _may_correct_key(p_auth_user, p_question) THEN
    RETURN jsonb_build_object('status', 'not_allowed');
  END IF;
  SELECT * INTO q FROM questions WHERE id = p_question;
  IF q.id IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF q.format = 'prose' THEN RETURN jsonb_build_object('status', 'not_auto_checked'); END IF;
  SELECT * INTO k FROM question_keys
   WHERE question_id = q.id AND variant_key = '' AND superseded_at IS NULL;
  IF k.id IS NULL THEN RETURN jsonb_build_object('status', 'no_key'); END IF;
  IF k.written_by = 'ai' AND k.checked_by IS NULL THEN RETURN jsonb_build_object('status', 'key_unchecked'); END IF;
  IF _key_problem(q.format, q.choices, k) IS NOT NULL THEN RETURN jsonb_build_object('status', 'key_fault'); END IF;
  RETURN jsonb_build_object(
    'status', 'ok',
    'format', q.format,
    'choice_ids', coalesce((SELECT jsonb_agg(c ->> 'id') FROM jsonb_array_elements(coalesce(q.choices, '[]'::jsonb)) c), '[]'::jsonb),
    'key_version_id', k.id,
    'key', jsonb_build_object(
      'correct_choice_ids', to_jsonb(coalesce(k.correct_choice_ids, ARRAY[]::text[])),
      'value',        k.value::text,
      'tol_abs',      k.tol_abs::text,
      'tol_pct',      k.tol_pct::text,
      'sig_figs',     k.sig_figs,
      'sig_fig_mode', k.sig_fig_mode,
      'unit',         k.unit,
      'unit_aliases', to_jsonb(coalesce(k.unit_aliases, ARRAY[]::text[])),
      'unit_mode',    k.unit_mode,
      'expression',   k.expression,
      'variables',    to_jsonb(coalesce(k.variables, ARRAY[]::text[])),
      'signed_variables', to_jsonb(coalesce(k.signed_variables, ARRAY[]::text[]))),
    'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'answer', a.answer) ORDER BY a.id)
                            FROM question_attempts a WHERE a.question_id = q.id), '[]'::jsonb));
END; $$;

-- ---- 7. the variable names, never the expression, go to the student ---------------------------------
CREATE OR REPLACE FUNCTION student_homework(p_assignment_offering uuid) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_ao      assignment_offerings%ROWTYPE;
  v_enr     uuid;
  v_section uuid;
  v_rel     timestamptz;
BEGIN
  SELECT * INTO v_ao FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_ao.id IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  SELECT e.id, e.section_id INTO v_enr, v_section
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.id IN (SELECT my_enrollments()) AND s.course_offering_id = v_ao.course_offering_id AND e.status = 'active'
   ORDER BY e.enrolled_at DESC LIMIT 1;
  IF v_enr IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;   -- not told apart from "no such item"

  IF NOT v_ao.is_published THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  v_rel := _release_core(v_ao.id, v_section);
  IF v_rel IS NOT NULL AND now() < v_rel THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'attempt_limit', v_ao.attempt_limit,
    'attempt_rule', v_ao.attempt_rule,
    'late_allowed', v_ao.late_allowed,
    'questions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id,
               'qid', q.qid,
               'position', q.position,
               'prompt_md', q.prompt_md,
               'figure_url', q.figure_url,
               'unit_hint', q.unit_hint,
               'format', q.format,
               'choices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c ->> 'id', 'text', c ->> 'text'))
                                      FROM jsonb_array_elements(coalesce(q.choices, '[]'::jsonb)) c), '[]'::jsonb),
               'variables', CASE WHEN q.format = 'symbolic'
                                 THEN (SELECT to_jsonb(k.variables) FROM question_keys k
                                        WHERE k.question_id = q.id AND k.variant_key = '' AND k.superseded_at IS NULL)
                            END,
               'points', q.points,
               'attempts_used', (SELECT count(*) FROM question_attempts a
                                  WHERE a.enrollment_id = v_enr AND a.assignment_offering_id = v_ao.id AND a.question_id = q.id)
             ) ORDER BY q.position, q.qid)
        FROM questions q
        JOIN offering_activities oa ON oa.activity_id = q.activity_id AND oa.assignment_offering_id = v_ao.id
       WHERE oa.grading = 'auto_checked' AND NOT q.is_retired AND q.format <> 'prose'
         AND NOT EXISTS (SELECT 1 FROM question_keys k
                          WHERE k.question_id = q.id AND k.variant_key = '' AND k.superseded_at IS NULL
                            AND k.written_by = 'ai' AND k.checked_by IS NULL)), '[]'::jsonb),
    'held_back', (SELECT count(*) FROM questions q
                    JOIN offering_activities oa ON oa.activity_id = q.activity_id AND oa.assignment_offering_id = v_ao.id
                   WHERE oa.grading = 'auto_checked' AND NOT q.is_retired AND q.format <> 'prose'
                     AND EXISTS (SELECT 1 FROM question_keys k
                                  WHERE k.question_id = q.id AND k.variant_key = '' AND k.superseded_at IS NULL
                                    AND k.written_by = 'ai' AND k.checked_by IS NULL)));
END; $$;

COMMENT ON FUNCTION student_homework(uuid) IS
  'The signed-in student''s view of one auto-checked item: attempt limit and rule, and each question''s prompt, figure, '
  'format, choices as {id, text}, the variable names of a symbolic question, points and attempts used (this item only). Only once '
  'the item is published and released, only for an enrolled student. A question whose AI-written key no person has checked is '
  'held back and counted. Returns no key data (never an expression, value, tolerance or correct choice). Names every column it returns.';

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 'symbolic' is allowed: 1 row
--   SELECT 1 FROM pg_constraint WHERE conname = 'questions_format_ck' AND pg_get_constraintdef(oid) LIKE '%symbolic%';
--   -- the three columns: 3 rows
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'question_keys'
--      AND column_name IN ('expression', 'variables', 'signed_variables');
--   -- the symbolic trigger function is callable by nobody (no execute privilege for any API role): 0 rows
--   SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema = 'app' AND routine_name = 'question_keys_check_symbolic'
--      AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
--   -- grants are unchanged: answer_context and remark_context for service_role only; student_homework for authenticated only
