-- Rollback of 088: restores the key check from 087 (names compared as written), and drops the Health list and the name folder.
-- No row changes. A stored key that holds one variable under two spellings is accepted again by the database check; the
-- reader still refuses to read it, so a cadet meets it as a key the checker cannot read.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

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
      IF v_name IN ('sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'exp', 'ln', 'log10', 'log', 'abs',
                    'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString') THEN
        RETURN 'a variable cannot be named like a function';
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

DROP FUNCTION symbolic_key_problems(uuid);
DROP FUNCTION _fold_name(text);

COMMIT;
