-- 088: the key check reads variable names the way the reader does, and staff can list the keys that fail it.
--
-- WHY
--   1. The reader (site/js/symbolic-answer.js, copied into the two edge functions) treats a Greek letter and its Latin
--      spelling as ONE name (mu and the Greek mu, theta and the Greek theta; the micro sign is mu). The question page and the
--      reader refuse a variable list that holds both. `_key_problem` (085, 087) compared names as written, so a key written
--      straight to the database with both spellings passed, and a variable marked "can be negative" under the other spelling
--      was accepted by the reader and refused here. This adds `_fold_name`, which uses the reader's own table, and folds
--      names before the duplicate check, the signed-variable check and the function-name check.
--      A key the reader accepts is not refused by this change: the only new refusal is a list that names one variable twice
--      under two spellings, which the reader already refuses.
--   2. `_key_problem` is revoked from every role the site uses, so the Health page could not show which published
--      questions have a key the checker cannot read. `symbolic_key_problems(offering)` lists them for one course offering,
--      for staff of that offering only.
--
-- WHAT IT CHANGES
--   * new `_fold_name(text)`: internal, executable by no API role.
--   * `_key_problem` replaced (same signature, same messages, plus the duplicate message now names the spelling rule).
--   * new `symbolic_key_problems(p_course_offering uuid)`: executable by `authenticated`. It checks INSIDE the function that
--     the caller staffs the offering (staff_offerings()) and returns no rows to anyone else, a cadet included. It returns the
--     question id, the question's name, the item (assignment offering) id and slug, and the problem sentence. It returns no
--     key, no expression and no variable name. Only published items, only auto-checked paths, only questions not retired,
--     only the current key with no variant (the one the checker uses).
--   * No row changes. A stored key that already has both spellings is not repaired here; the Health page lists it.
--
-- Rollback: rollback/088_key_names_folded_and_health_ROLLBACK.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- _fold_name: the reader's GREEK table, one letter at a time -----------------------------------------------------
CREATE FUNCTION _fold_name(p text) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = app, pg_temp
AS $$
  SELECT coalesce(string_agg(coalesce(m.latin, c.ch), '' ORDER BY c.ord), '')
    FROM unnest(string_to_array(p, NULL)) WITH ORDINALITY AS c(ch, ord)
    LEFT JOIN (VALUES
(E'\u03B1', 'alpha'),
    (E'\u03B2', 'beta'),
    (E'\u03B3', 'gamma'),
    (E'\u03B4', 'delta'),
    (E'\u03B5', 'epsilon'),
    (E'\u03F5', 'epsilon'),
    (E'\u03B6', 'zeta'),
    (E'\u03B7', 'eta'),
    (E'\u03B8', 'theta'),
    (E'\u03D1', 'theta'),
    (E'\u03B9', 'iota'),
    (E'\u03BA', 'kappa'),
    (E'\u03BB', 'lambda'),
    (E'\u03BC', 'mu'),
    (E'\u00B5', 'mu'),
    (E'\u03BD', 'nu'),
    (E'\u03BE', 'xi'),
    (E'\u03BF', 'omicron'),
    (E'\u03C0', 'pi'),
    (E'\u03C1', 'rho'),
    (E'\u03C3', 'sigma'),
    (E'\u03C2', 'sigma'),
    (E'\u03C4', 'tau'),
    (E'\u03C5', 'upsilon'),
    (E'\u03C6', 'phi'),
    (E'\u03D5', 'phi'),
    (E'\u03C7', 'chi'),
    (E'\u03C8', 'psi'),
    (E'\u03C9', 'omega'),
    (E'\u0393', 'Gamma'),
    (E'\u0394', 'Delta'),
    (E'\u0398', 'Theta'),
    (E'\u039B', 'Lambda'),
    (E'\u039E', 'Xi'),
    (E'\u03A0', 'Pi'),
    (E'\u03A3', 'Sigma'),
    (E'\u03A6', 'Phi'),
    (E'\u03A8', 'Psi'),
    (E'\u03A9', 'Omega')
    ) AS m(greek, latin) ON m.greek = c.ch;
$$;

COMMENT ON FUNCTION _fold_name(text) IS
  'A variable name with every Greek letter replaced by its Latin spelling, as foldName in site/js/symbolic-answer.js does. '
  'The two tables must agree. Internal.';

-- ---- _key_problem: names compared after folding ---------------------------------------------------------------------
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
    IF (SELECT count(DISTINCT _fold_name(v)) FROM unnest(k.variables) v) <> cardinality(k.variables) THEN
      RETURN 'a variable is listed twice (a Greek letter and its Latin spelling are the same name)';
    END IF;
    IF k.signed_variables IS NOT NULL AND EXISTS (
         SELECT 1 FROM unnest(k.signed_variables) s(n)
          WHERE s.n IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(k.variables) v WHERE _fold_name(v) = _fold_name(s.n))) THEN
      RETURN 'a variable marked as able to be negative is not one of the variables';
    END IF;
    FOREACH v_name IN ARRAY k.variables LOOP
      IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 12 OR v_name !~ E'^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$' THEN
        RETURN 'a variable name must be 1 to 12 characters, start with a letter and use only letters, digits and underscores';
      END IF;
      IF v_name = ANY (ARRAY['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'exp', 'ln', 'log10', 'log', 'abs',
                             'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'])
         OR _fold_name(v_name) = ANY (ARRAY['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'exp', 'ln', 'log10', 'log', 'abs',
                             'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) THEN
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

-- ---- symbolic_key_problems: the Health page's list ------------------------------------------------------------------
CREATE FUNCTION symbolic_key_problems(p_course_offering uuid)
RETURNS TABLE (question_id uuid, qid text, assignment_offering_id uuid, assignment_slug text, problem text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  -- The caller must staff this offering (any role); a global admin staffs every offering. Nobody else gets a row: not a
  -- cadet, not a staff member of another offering, not a signed-out caller.
  IF p_course_offering IS NULL OR current_uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM staff_offerings() so(id) WHERE so.id = p_course_offering) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT q.id, q.qid, ao.id, s.slug, p.problem
      FROM assignment_offerings ao
      JOIN assignments s ON s.id = ao.assignment_id
      JOIN offering_activities oa ON oa.assignment_offering_id = ao.id AND oa.grading = 'auto_checked'
      JOIN questions q ON q.activity_id = oa.activity_id AND q.format = 'symbolic' AND NOT q.is_retired
      JOIN question_keys k ON k.question_id = q.id AND k.variant_key = '' AND k.superseded_at IS NULL
      CROSS JOIN LATERAL (SELECT _key_problem(q.format, q.choices, k) AS problem) p
     WHERE ao.course_offering_id = p_course_offering
       AND ao.is_published
       AND p.problem IS NOT NULL
     ORDER BY s.slug, q.position, q.qid;
END; $$;

COMMENT ON FUNCTION symbolic_key_problems(uuid) IS
  'For the Health page. The published, auto-checked, symbolic questions of one course offering whose current key fails '
  '_key_problem: question id and name, item id and slug, and the problem sentence. Returns nothing unless the caller staffs '
  'the offering. Returns no key, expression or variable name.';

-- ---- grants: by name ------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _fold_name(text) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION symbolic_key_problems(uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION symbolic_key_problems(uuid) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- _fold_name is granted to nobody; symbolic_key_problems to authenticated only
--   SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN LATERAL aclexplode(p.proacl) a ON true JOIN pg_roles r ON r.oid = a.grantee
--    WHERE n.nspname = 'app' AND p.proname IN ('_fold_name', 'symbolic_key_problems', '_key_problem');
