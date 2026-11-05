-- PREP v2 Stage E -- re-marking stored attempts after a key correction
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 070_answer_internals.sql, 071_answer_marking.sql (record_answer, the auto_checked
-- grade), 031_attempts_and_receipts.sql (question_attempts, key_remark_runs) and 030_questions_and_keys.sql.
-- Design: docs/decisions/V2-DATA-MODEL.md section 13 ("Correcting a key"), docs/decisions/V2-STAGE-E-ANSWERS.md.
--
-- WHAT IT DOES
--   1. _regrade_auto(enrollment, offering, activity)   the grade rule of record_answer, moved into one function so that
--                                                      storing an answer and re-marking one use the SAME calculation.
--      record_answer(...)                              REPLACED: same arguments, same result, same checks; its grade
--                                                      step now calls _regrade_auto.
--   2. remark_context(auth_user, question)             staff only. The question's format, the current key, and every
--                                                      stored attempt (id, raw answer, result, key version). The key goes
--                                                      to the edge function and stops there.
--   3. remark_apply(auth_user, question, key_version, verdicts, commit, expect_changed)
--                                                      staff only. DRY RUN (commit = false) writes nothing and says what
--                                                      would change. COMMIT (true) must be given the count the dry run
--                                                      showed; it updates the attempts, recomputes the auto_checked grades,
--                                                      and writes one key_remark_runs row, all in one transaction.
--
-- WHO MARKS
--   The shared checker (site/js/numeric-answer.js, carried into supabase/functions/remark-question/) reads each stored
--   answer and gives a verdict. The database never parses a number. Like record_answer, remark_apply takes the verdict from
--   its caller, so BOTH functions are granted to service_role only. The database checks that the verdicts are about the
--   question's CURRENT key version and that every stored attempt of the question has a verdict.
--
-- WHAT THE DATABASE ENFORCES
--   who          the caller must be a global admin or a director of the question's course (the right to correct a key)
--   current      p_key_version must be the question's current key, and a key a person has not checked (AI-written) is refused
--   whole        every stored attempt of the question must be covered, none twice, none from another question. A new
--                attempt that arrived after the context was read gives 'attempts_moved': run the preview again
--   confirmed    a commit must carry the number the dry run showed; if the data moved, 'changed_since_preview'
--   twice        an attempt already marked against the current key with the same result is not touched, so a second run
--                changes 0 rows (it still logs a run with 0 changed)
--   all or none  one function call is one transaction: an error part way leaves no attempt, grade or log row changed
--   grades       only a grade whose source is auto_checked is recomputed. Any other grade (an instructor's correction) is
--                listed, never changed. The calculation is _regrade_auto, the one record_answer uses
--   one at a time  a question is re-marked by one caller at a time, and each student's item is locked the way
--                record_answer locks it, so a student answering during a re-mark cannot be lost
--
-- WHAT IT DOES NOT DO
--   It grants nothing to a signed-in user. It does not change any key. An attempt whose stored answer the checker
--   cannot read (no verdict) is left exactly as it was and is counted as unreadable.
--   It does not touch typed or tutor work, or any grade that is not auto_checked.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- the one grade calculation ------------------------------------------------------------------------
CREATE FUNCTION _regrade_auto(p_enrollment uuid, p_assignment_offering uuid, p_activity uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_rule     text;
  v_possible numeric(6,2);
  v_earned   numeric;
  v_scores   jsonb;
BEGIN
  SELECT ao.attempt_rule, ao.points_possible INTO v_rule, v_possible
    FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  WITH per_q AS (
    SELECT q.id AS question_id, q.qid, q.points,
           CASE v_rule
             WHEN 'best'  THEN (SELECT max(a.points_awarded) FROM question_attempts a
                                 WHERE a.enrollment_id = p_enrollment AND a.question_id = q.id)
             WHEN 'last'  THEN (SELECT a.points_awarded FROM question_attempts a
                                 WHERE a.enrollment_id = p_enrollment AND a.question_id = q.id
                                 ORDER BY a.attempt_no DESC LIMIT 1)
             ELSE              (SELECT a.points_awarded FROM question_attempts a
                                 WHERE a.enrollment_id = p_enrollment AND a.question_id = q.id
                                 ORDER BY a.attempt_no ASC LIMIT 1)
           END AS pts
      FROM questions q WHERE q.activity_id = p_activity AND NOT q.is_retired)
  SELECT coalesce(sum(pts), 0),
         coalesce(jsonb_object_agg(qid, jsonb_build_object(
                    'score', pts, 'max', points, 'status', CASE WHEN pts >= points THEN 'full' ELSE 'zero' END))
                  FILTER (WHERE pts IS NOT NULL), '{}'::jsonb)
    INTO v_earned, v_scores
    FROM per_q;

  PERFORM set_config('app.auto_check_marker', 'on', true);
  INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, question_scores,
                      source, is_finalized, graded_at)
  VALUES (p_enrollment, p_assignment_offering, least(v_earned, v_possible), v_possible, v_scores,
          'auto_checked', true, now())
  ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE
     SET points_earned = EXCLUDED.points_earned, points_possible = EXCLUDED.points_possible,
         question_scores = EXCLUDED.question_scores, graded_at = now()
   WHERE grades.source = 'auto_checked';
  PERFORM set_config('app.auto_check_marker', 'off', true);
END; $$;

COMMENT ON FUNCTION _regrade_auto(uuid, uuid, uuid) IS
  'Recomputes one student''s auto_checked grade for one item from the stored attempts, by the item''s attempt_rule. '
  'A grade with any other source is left alone. Used by record_answer and remark_apply so there is one calculation. Internal.';

-- ---- record_answer: the same function, its grade step now shared --------------------------------------
CREATE OR REPLACE FUNCTION record_answer(p_auth_user uuid, p_assignment_offering uuid, p_question uuid, p_answer jsonb,
                                         p_parsed text, p_is_correct boolean, p_key_version uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  g          record;
  v_parsed   numeric;
  v_no       integer;
  v_points   numeric(6,2);
BEGIN
  IF p_answer IS NULL OR jsonb_typeof(p_answer) <> 'object' OR octet_length(p_answer::text) > 2000
     OR p_is_correct IS NULL OR p_key_version IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END IF;
  BEGIN
    v_parsed := CASE WHEN p_parsed IS NULL THEN NULL ELSE p_parsed::numeric END;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END;

  SELECT * INTO g FROM _answer_gate(p_auth_user, p_assignment_offering, p_question, true);
  IF g.status <> 'ok' THEN
    RETURN jsonb_build_object('status', g.status);
  END IF;
  IF g.key_id IS DISTINCT FROM p_key_version THEN
    RETURN jsonb_build_object('status', 'key_changed');
  END IF;

  v_no := g.attempts_used + 1;
  v_points := CASE WHEN p_is_correct THEN g.q_points ELSE 0 END;
  INSERT INTO question_attempts (enrollment_id, assignment_offering_id, question_id, attempt_no, answer, parsed_value,
                                 is_correct, points_awarded, key_version_id, is_late)
  VALUES (g.enrollment_id, p_assignment_offering, p_question, v_no, p_answer, v_parsed,
          p_is_correct, v_points, p_key_version, g.is_late);

  PERFORM _regrade_auto(g.enrollment_id, p_assignment_offering, g.activity_id);

  RETURN jsonb_build_object('status', 'ok', 'correct', p_is_correct, 'attempt_no', v_no,
                            'attempts_left', CASE WHEN g.attempt_limit IS NULL THEN NULL ELSE g.attempt_limit - v_no END);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'busy');
END; $$;

-- ---- who may re-mark -----------------------------------------------------------------------------------
CREATE FUNCTION _may_correct_key(p_auth_user uuid, p_question uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT p_auth_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM instructors i WHERE i.id = p_auth_user AND i.is_global_admin)
    OR EXISTS (SELECT 1 FROM questions q
                 JOIN activities a ON a.id = q.activity_id
                 JOIN assignments s ON s.id = a.assignment_id
                 JOIN course_offerings co ON co.course_id = s.course_id
                 JOIN staff_assignments sa ON sa.course_offering_id = co.id
                WHERE q.id = p_question AND sa.instructor_id = p_auth_user AND sa.role = 'director'));
$$;

COMMENT ON FUNCTION _may_correct_key(uuid, uuid) IS
  'The right to correct a key and re-mark: a global admin, or a director of the question''s course. Same rule as the '
  'question_keys write policy, for a caller whose sign-in id arrives as an argument. Internal.';

-- ---- remark_context ------------------------------------------------------------------------------------
CREATE FUNCTION remark_context(p_auth_user uuid, p_question uuid) RETURNS jsonb
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
      'unit_mode',    k.unit_mode),
    'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'answer', a.answer) ORDER BY a.id)
                            FROM question_attempts a WHERE a.question_id = q.id), '[]'::jsonb));
END; $$;

-- ---- the re-mark calculation, one place ----------------------------------------------------------------
-- What each stored attempt would become, given the verdicts. A verdict of null means "the checker could not read this
-- answer": the attempt is left exactly as it is. Read by the preview and the commit alike.
CREATE FUNCTION _remark_calc(p_question uuid, p_key uuid, p_verdicts jsonb)
RETURNS TABLE (attempt_id uuid, enr_id uuid, ao_id uuid, old_c boolean, old_p numeric, old_k uuid, old_pv numeric,
               new_c boolean, new_p numeric, new_k uuid, new_pv numeric, unread boolean)
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  SELECT a.id, a.enrollment_id, a.assignment_offering_id,
         a.is_correct, a.points_awarded, a.key_version_id, a.parsed_value,
         CASE WHEN x.is_correct IS NULL THEN a.is_correct ELSE x.is_correct END,
         CASE WHEN x.is_correct IS NULL THEN a.points_awarded WHEN x.is_correct THEN q.points ELSE 0::numeric END,
         CASE WHEN x.is_correct IS NULL THEN a.key_version_id ELSE p_key END,
         CASE WHEN x.is_correct IS NULL THEN a.parsed_value ELSE coalesce(x.parsed::numeric, a.parsed_value) END,
         x.is_correct IS NULL
    FROM question_attempts a
    JOIN questions q ON q.id = a.question_id
    JOIN jsonb_to_recordset(p_verdicts) AS x(id uuid, is_correct boolean, parsed text) ON x.id = a.id
   WHERE a.question_id = p_question;
$$;

-- ---- remark_apply --------------------------------------------------------------------------------------
CREATE FUNCTION remark_apply(p_auth_user uuid, p_question uuid, p_key_version uuid, p_verdicts jsonb,
                             p_commit boolean, p_expect_changed integer) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  c_max_attempts constant integer := 20000;
  c_max_pairs    constant integer := 3000;
  c_list_cap     constant integer := 200;
  q          questions%ROWTYPE;
  k          question_keys%ROWTYPE;
  v_n        integer;
  v_distinct integer;
  v_matched  integer;
  v_pairs    integer;
  v_changed  integer;
  v_to_ok    integer;
  v_to_bad   integer;
  v_unread   integer;
  v_regrade  integer := 0;
  v_listed   jsonb;
  v_n_listed integer;
  v_sample   jsonb;
  v_from     uuid;
  v_pairs_json jsonb;
  r          record;
BEGIN
  IF p_verdicts IS NULL OR jsonb_typeof(p_verdicts) <> 'array' OR p_commit IS NULL OR p_key_version IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END IF;
  v_n := jsonb_array_length(p_verdicts);
  IF v_n > c_max_attempts OR (p_commit AND p_expect_changed IS NULL) THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END IF;
  IF NOT _may_correct_key(p_auth_user, p_question) THEN RETURN jsonb_build_object('status', 'not_allowed'); END IF;
  SELECT * INTO q FROM questions WHERE id = p_question;
  IF q.id IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF q.format = 'prose' THEN RETURN jsonb_build_object('status', 'not_auto_checked'); END IF;
  SELECT * INTO k FROM question_keys WHERE question_id = q.id AND variant_key = '' AND superseded_at IS NULL;
  IF k.id IS NULL THEN RETURN jsonb_build_object('status', 'no_key'); END IF;
  IF k.written_by = 'ai' AND k.checked_by IS NULL THEN RETURN jsonb_build_object('status', 'key_unchecked'); END IF;
  IF k.id IS DISTINCT FROM p_key_version THEN RETURN jsonb_build_object('status', 'key_changed'); END IF;

  -- the verdicts must be well formed: an id each, no id twice
  BEGIN
    PERFORM 1 FROM jsonb_to_recordset(p_verdicts) AS x(id uuid, is_correct boolean, parsed text) WHERE x.id IS NULL;
    IF FOUND THEN RETURN jsonb_build_object('status', 'bad_request'); END IF;
    SELECT count(DISTINCT x.id) INTO v_distinct FROM jsonb_to_recordset(p_verdicts) AS x(id uuid, is_correct boolean, parsed text);
    IF v_distinct <> v_n THEN RETURN jsonb_build_object('status', 'bad_request'); END IF;
    PERFORM x.parsed::numeric FROM jsonb_to_recordset(p_verdicts) AS x(id uuid, is_correct boolean, parsed text) WHERE x.parsed IS NOT NULL;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END;

  IF p_commit THEN
    -- one re-mark of a question at a time, then each student's item in a fixed order (record_answer's own lock)
    PERFORM pg_advisory_xact_lock(hashtextextended(q.id::text, 72));
    SELECT count(*) INTO v_pairs FROM (SELECT DISTINCT a.enrollment_id, a.assignment_offering_id
                                         FROM question_attempts a WHERE a.question_id = q.id) s;
    IF v_pairs > c_max_pairs THEN RETURN jsonb_build_object('status', 'too_many'); END IF;
    FOR r IN SELECT DISTINCT a.enrollment_id, a.assignment_offering_id
               FROM question_attempts a WHERE a.question_id = q.id ORDER BY 1, 2 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(r.enrollment_id::text || ':' || r.assignment_offering_id::text, 71));
    END LOOP;
  END IF;

  -- every stored attempt of the question must have exactly one verdict, and no verdict may be about another question
  SELECT count(*) INTO v_matched
    FROM jsonb_to_recordset(p_verdicts) AS x(id uuid, is_correct boolean, parsed text)
    JOIN question_attempts a ON a.id = x.id AND a.question_id = q.id;
  IF v_matched <> v_n THEN RETURN jsonb_build_object('status', 'bad_request'); END IF;
  IF (SELECT count(*) FROM question_attempts a WHERE a.question_id = q.id) <> v_n THEN
    RETURN jsonb_build_object('status', 'attempts_moved');
  END IF;

  -- what would change
  SELECT count(*) FILTER (WHERE new_c IS DISTINCT FROM old_c OR new_p IS DISTINCT FROM old_p
                             OR new_k IS DISTINCT FROM old_k OR new_pv IS DISTINCT FROM old_pv),
         count(*) FILTER (WHERE new_c IS TRUE  AND old_c IS DISTINCT FROM TRUE),
         count(*) FILTER (WHERE new_c IS FALSE AND old_c IS DISTINCT FROM FALSE),
         count(*) FILTER (WHERE unread)
    INTO v_changed, v_to_ok, v_to_bad, v_unread
    FROM _remark_calc(q.id, k.id, p_verdicts);

  -- grades whose points move: recomputed if auto_checked, otherwise listed
  SELECT count(*) FILTER (WHERE g.id IS NULL OR g.source = 'auto_checked'),
         count(*) FILTER (WHERE g.id IS NOT NULL AND g.source <> 'auto_checked'),
         coalesce(jsonb_agg(jsonb_build_object('enrollment_id', s.enrollment_id, 'assignment_offering_id', s.assignment_offering_id,
                                               'source', g.source)) FILTER (WHERE g.id IS NOT NULL AND g.source <> 'auto_checked'), '[]'::jsonb)
    INTO v_regrade, v_n_listed, v_listed
    FROM (SELECT DISTINCT c.enr_id AS enrollment_id, c.ao_id AS assignment_offering_id FROM _remark_calc(q.id, k.id, p_verdicts) c WHERE c.new_p IS DISTINCT FROM c.old_p) s
    LEFT JOIN grades g ON g.enrollment_id = s.enrollment_id AND g.assignment_offering_id = s.assignment_offering_id;
  IF v_n_listed > c_list_cap THEN
    v_listed := (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_listed) e LIMIT c_list_cap) t);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id', t.attempt_id, 'was_correct', t.old_c, 'now_correct', t.new_c,
                                               'points_was', t.old_p, 'points_now', t.new_p)), '[]'::jsonb)
    INTO v_sample
    FROM (SELECT * FROM _remark_calc(q.id, k.id, p_verdicts) c
           WHERE c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
           ORDER BY c.attempt_id LIMIT 50) t;

  IF NOT p_commit THEN
    RETURN jsonb_build_object('status', 'ok', 'committed', false, 'attempts_total', v_n, 'attempts_changed', v_changed,
                              'now_correct', v_to_ok, 'now_wrong', v_to_bad, 'unreadable', v_unread,
                              'grades_to_recompute', v_regrade, 'grades_listed', v_n_listed, 'listed', v_listed,
                              'sample', v_sample);
  END IF;

  IF p_expect_changed IS DISTINCT FROM v_changed THEN
    RETURN jsonb_build_object('status', 'changed_since_preview', 'attempts_changed', v_changed);
  END IF;

  -- the apply
  SELECT m.kv INTO v_from FROM (SELECT key_version_id AS kv, count(*) n FROM question_attempts
                                 WHERE question_id = q.id AND key_version_id IS DISTINCT FROM k.id
                                 GROUP BY 1 ORDER BY 2 DESC LIMIT 1) m;
  -- the students whose points move, taken BEFORE the update (the calculation reads the stored attempts)
  SELECT coalesce(jsonb_agg(jsonb_build_object('e', s.enr_id, 'a', s.ao_id) ORDER BY s.enr_id, s.ao_id), '[]'::jsonb)
    INTO v_pairs_json
    FROM (SELECT DISTINCT c.enr_id, c.ao_id FROM _remark_calc(q.id, k.id, p_verdicts) c WHERE c.new_p IS DISTINCT FROM c.old_p) s;

  UPDATE question_attempts a
     SET is_correct = c.new_c, points_awarded = c.new_p, key_version_id = c.new_k, parsed_value = c.new_pv
    FROM _remark_calc(q.id, k.id, p_verdicts) c
   WHERE a.id = c.attempt_id
     AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
          OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv);

  FOR r IN SELECT (x ->> 'e')::uuid AS enrollment_id, (x ->> 'a')::uuid AS assignment_offering_id
             FROM jsonb_array_elements(v_pairs_json) x LOOP
    PERFORM _regrade_auto(r.enrollment_id, r.assignment_offering_id, q.activity_id);
  END LOOP;

  INSERT INTO key_remark_runs (question_id, from_key_version, to_key_version, run_by, attempts_changed, grades_recomputed, grades_listed)
  VALUES (q.id, v_from, k.id, p_auth_user, v_changed, v_regrade, v_n_listed);

  RETURN jsonb_build_object('status', 'ok', 'committed', true, 'attempts_total', v_n, 'attempts_changed', v_changed,
                            'now_correct', v_to_ok, 'now_wrong', v_to_bad, 'unreadable', v_unread,
                            'grades_to_recompute', v_regrade, 'grades_listed', v_n_listed, 'listed', v_listed);
END; $$;

COMMENT ON FUNCTION remark_context(uuid, uuid) IS
  'For the remark-question edge function only (service_role). A refusal code, or the question format, the choice ids, '
  'the current key and every stored attempt (id and raw answer). The key goes no further than the function.';
COMMENT ON FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, integer) IS
  'For the remark-question edge function only (service_role). Dry run (p_commit false) writes nothing. A commit must carry '
  'the changed-count the dry run showed, then updates the attempts, recomputes the auto_checked grades through '
  '_regrade_auto, lists the rest, and logs one key_remark_runs row, all in one transaction.';

-- ---- grants: by name -----------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _regrade_auto(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _remark_calc(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _may_correct_key(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION remark_context(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION remark_context(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, integer) TO service_role;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be exactly: record_answer, remark_context, remark_apply, grantee service_role
--   SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN LATERAL aclexplode(p.proacl) a ON true JOIN pg_roles r ON r.oid = a.grantee
--    WHERE n.nspname = 'app' AND p.proname IN ('record_answer', 'remark_context', 'remark_apply', '_regrade_auto', '_may_correct_key')
--      AND a.privilege_type = 'EXECUTE' AND r.rolname <> 'prep_app_owner';
--   -- 1 row: record_answer now delegates the grade
--   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.proname = 'record_answer' AND p.prosrc LIKE '%_regrade_auto%';
