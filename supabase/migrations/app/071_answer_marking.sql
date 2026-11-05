-- PREP v2 Stage E -- storing an answer: the deadline, the attempt limit and the grade, all on the server
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 070_answer_internals.sql, 031_attempts_and_receipts.sql (question_attempts),
-- 030_questions_and_keys.sql, 038_deadline_functions.sql (_effective_core, late_close_at) and 029 (source auto_checked).
-- It does NOT depend on 023_instructors_admin_flag_guard.sql.
-- Design: docs/decisions/V2-DATA-MODEL.md sections 12 and 13.
--
-- THE TWO FUNCTIONS   both SECURITY DEFINER, EXECUTE granted to service_role ONLY (the check-answer edge function).
--                     No signed-in student, no anon, no prep_app_dml can call either.
--   answer_context(auth_user, item, question)
--        May this student answer now? If so, returns what the edge function needs to mark: the question's format,
--        the choice ids, and the CURRENT key (numbers as text, so no digit is lost). The key goes to the function
--        and stops there; the function replies to the browser with right or wrong only.
--   record_answer(auth_user, item, question, answer, parsed, is_correct, key_version)
--        Asks the same question again UNDER A LOCK, refuses a key that has moved on since answer_context, then
--        stores the attempt and recomputes the grade from the stored attempts.
--
-- WHAT THE DATABASE ENFORCES  (so a hand-made request cannot change any of it)
--   who          the student is the one whose sign-in id the function passes; the enrollment is found from it
--   enrolled     an ACTIVE enrollment in the offering that owns the item
--   published    the item is published, and its release time (_release_core) has passed
--   path         the question sits on an auto_checked path of that item, is not retired, and is not prose
--   deadline     _effective_core: an extension, else the section / day / offering date, with the 120 s grace.
--                After it: refused, unless the item allows late work and the term's last class day has not ended;
--                then the attempt is stored with is_late = true. An unusable deadline refuses. A term with no last
--                class day recorded cannot say when late work stops, so late work is refused there ('late_unavailable').
--   limit        assignment_offerings.attempt_limit per question AND PER ITEM: attempts are counted and numbered for one
--                enrollment, one item and one question, so an activity shared by two items of a term keeps two separate
--                tallies and two separate grades. With no limit set a ceiling of 100 applies, so
--                the answer cannot be hunted for without end.
--   serial       one lock per student and item: attempt numbers run 1, 2, 3 with no gap, two tabs cannot both take
--                the last attempt, and UNIQUE (enrollment, question, attempt_no) backs it up.
--   key          p_key_version must be the current key of the question, else 'key_changed' (the function retries). A key
--                the checker cannot read (a numeric key with no value or too many digits, a choice key naming nothing)
--                gives 'key_fault': no attempt is stored or counted and nothing is marked wrong
--   the grade    never a parameter. points_earned and question_scores are computed here from the stored attempts by
--                the item's attempt_rule (best / last / first), source auto_checked, finalized. A grade that a person
--                has taken over (any other source) is left alone; attempts are still stored.
--
-- WHAT IT TRUSTS
--   The caller (the edge function) for: the verdict p_is_correct, and the identity p_auth_user. Both are why the
--   grant is service_role only. The function checks that the verdict is about the CURRENT key version.
--
-- THE CURRENT SITE   Nothing calls these. No page reads question_attempts yet. No existing row changes.
--
-- STAGE D   see docs/decisions/V2-DATA-MODEL.md (Stage E section) for what this assumes of step 2.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- attempts belong to one item -----------------------------------------------------------------------
-- The attempt number is unique per student, item and question (it was per student and question), so a question that
-- two items of one term share is tallied, limited and graded in each item on its own.
ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_unique;
ALTER TABLE question_attempts ADD CONSTRAINT question_attempts_unique
  UNIQUE (enrollment_id, assignment_offering_id, question_id, attempt_no);

-- ---- the one gate both functions use -----------------------------------------------------------------
CREATE FUNCTION _answer_gate(p_auth_user uuid, p_assignment_offering uuid, p_question uuid, p_lock boolean)
RETURNS TABLE (status text, enrollment_id uuid, activity_id uuid, format text, choices jsonb, q_points numeric,
               attempts_used integer, attempt_limit integer, is_late boolean, key_id uuid, attempt_rule text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  c_ceiling  constant integer := 100;
  v_student  bigint;
  v_q        questions%ROWTYPE;
  v_ao       assignment_offerings%ROWTYPE;
  v_enr      uuid;
  v_section  uuid;
  v_grading  text;
  v_rel      timestamptz;
  v_d        record;
  v_used     integer;
  v_key      question_keys%ROWTYPE;
  v_close    timestamptz;
BEGIN
  status := 'ok'; enrollment_id := NULL; activity_id := NULL; format := NULL; choices := NULL; q_points := NULL;
  attempts_used := 0; attempt_limit := NULL; is_late := false; key_id := NULL; attempt_rule := NULL;

  IF p_auth_user IS NULL THEN status := 'not_enrolled'; RETURN NEXT; RETURN; END IF;
  SELECT s.student_id INTO v_student FROM students s WHERE s.auth_user_id = p_auth_user;
  SELECT * INTO v_q FROM questions q WHERE q.id = p_question;
  SELECT * INTO v_ao FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_q.id IS NULL OR v_ao.id IS NULL
     OR NOT EXISTS (SELECT 1 FROM offering_activities oa
                     WHERE oa.assignment_offering_id = v_ao.id AND oa.activity_id = v_q.activity_id) THEN
    status := 'not_found'; RETURN NEXT; RETURN;
  END IF;
  SELECT oa.grading INTO v_grading FROM offering_activities oa
   WHERE oa.assignment_offering_id = v_ao.id AND oa.activity_id = v_q.activity_id LIMIT 1;
  IF v_grading IS DISTINCT FROM 'auto_checked' OR v_q.format = 'prose' THEN
    status := 'not_auto_checked'; RETURN NEXT; RETURN;
  END IF;

  SELECT e.id, e.section_id INTO v_enr, v_section
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.student_id = v_student AND s.course_offering_id = v_ao.course_offering_id AND e.status = 'active'
   ORDER BY e.enrolled_at DESC LIMIT 1;
  IF v_enr IS NULL THEN status := 'not_enrolled'; RETURN NEXT; RETURN; END IF;

  enrollment_id := v_enr; activity_id := v_q.activity_id; format := v_q.format; choices := v_q.choices;
  q_points := v_q.points; attempt_rule := v_ao.attempt_rule;

  IF NOT v_ao.is_published THEN status := 'not_open'; RETURN NEXT; RETURN; END IF;
  v_rel := _release_core(v_ao.id, v_section);
  IF v_rel IS NOT NULL AND now() < v_rel THEN status := 'not_open'; RETURN NEXT; RETURN; END IF;
  IF v_q.is_retired THEN status := 'retired'; RETURN NEXT; RETURN; END IF;

  -- one lock per student and item, held to the end of the transaction
  IF p_lock THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_enr::text || ':' || v_ao.id::text, 71));
  END IF;

  -- the deadline
  SELECT * INTO v_d FROM _effective_core(v_enr, v_ao.id);
  IF NOT FOUND OR coalesce(v_d.invalid, false) THEN status := 'deadline_unreadable'; RETURN NEXT; RETURN; END IF;
  IF coalesce(v_d.is_past, false) THEN
    v_close := late_close_at(v_ao.course_offering_id);
    IF NOT v_ao.late_allowed OR (v_close IS NOT NULL AND now() > v_close) THEN
      status := 'closed'; RETURN NEXT; RETURN;
    END IF;
    IF v_close IS NULL THEN                -- late work is allowed, but the term has no last class day to end it
      status := 'late_unavailable'; RETURN NEXT; RETURN;
    END IF;
    is_late := true;
  END IF;

  -- the attempt limit, per question and per item
  SELECT count(*) INTO v_used FROM question_attempts a
   WHERE a.enrollment_id = v_enr AND a.assignment_offering_id = v_ao.id AND a.question_id = v_q.id;
  attempts_used := v_used;
  attempt_limit := v_ao.attempt_limit;
  IF v_used >= coalesce(v_ao.attempt_limit, c_ceiling) THEN status := 'limit_reached'; RETURN NEXT; RETURN; END IF;

  -- the current key, and a person's check of an AI-written one
  SELECT * INTO v_key FROM question_keys k
   WHERE k.question_id = v_q.id AND k.variant_key = '' AND k.superseded_at IS NULL;
  IF v_key.id IS NULL THEN status := 'no_key'; RETURN NEXT; RETURN; END IF;
  IF v_key.written_by = 'ai' AND v_key.checked_by IS NULL THEN status := 'key_unchecked'; RETURN NEXT; RETURN; END IF;
  IF _key_problem(v_q.format, v_q.choices, v_key) IS NOT NULL THEN status := 'key_fault'; RETURN NEXT; RETURN; END IF;
  key_id := v_key.id;
  RETURN NEXT;
END; $$;

-- ---- answer_context -----------------------------------------------------------------------------------
CREATE FUNCTION answer_context(p_auth_user uuid, p_assignment_offering uuid, p_question uuid) RETURNS jsonb
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
      'unit_mode',    k.unit_mode));
END; $$;

-- ---- record_answer ------------------------------------------------------------------------------------
CREATE FUNCTION record_answer(p_auth_user uuid, p_assignment_offering uuid, p_question uuid, p_answer jsonb,
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
  v_possible numeric(6,2);
  v_earned   numeric;
  v_scores   jsonb;
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

  -- recompute the grade from the stored attempts, by the item's attempt_rule
  SELECT ao.points_possible INTO v_possible FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  WITH per_q AS (
    SELECT q.qid, q.points,
           CASE g.attempt_rule
             WHEN 'best'  THEN (SELECT max(a.points_awarded) FROM question_attempts a
                                 WHERE a.enrollment_id = g.enrollment_id AND a.assignment_offering_id = p_assignment_offering AND a.question_id = q.id)
             WHEN 'last'  THEN (SELECT a.points_awarded FROM question_attempts a
                                 WHERE a.enrollment_id = g.enrollment_id AND a.assignment_offering_id = p_assignment_offering AND a.question_id = q.id
                                 ORDER BY a.attempt_no DESC LIMIT 1)
             ELSE              (SELECT a.points_awarded FROM question_attempts a
                                 WHERE a.enrollment_id = g.enrollment_id AND a.assignment_offering_id = p_assignment_offering AND a.question_id = q.id
                                 ORDER BY a.attempt_no ASC LIMIT 1)
           END AS pts
      FROM questions q WHERE q.activity_id = g.activity_id AND NOT q.is_retired)
  SELECT coalesce(sum(pts), 0),
         coalesce(jsonb_object_agg(qid, jsonb_build_object(
                    'score', pts, 'max', points, 'status', CASE WHEN pts >= points THEN 'full' ELSE 'zero' END))
                  FILTER (WHERE pts IS NOT NULL), '{}'::jsonb)
    INTO v_earned, v_scores
    FROM per_q;

  PERFORM set_config('app.auto_check_marker', 'on', true);
  INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, question_scores,
                      source, is_finalized, graded_at)
  VALUES (g.enrollment_id, p_assignment_offering, least(v_earned, v_possible), v_possible, v_scores,
          'auto_checked', true, now())
  ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE
     SET points_earned = EXCLUDED.points_earned, points_possible = EXCLUDED.points_possible,
         question_scores = EXCLUDED.question_scores, graded_at = now()
   WHERE grades.source = 'auto_checked';
  PERFORM set_config('app.auto_check_marker', 'off', true);

  RETURN jsonb_build_object('status', 'ok', 'correct', p_is_correct, 'attempt_no', v_no,
                            'attempts_left', CASE WHEN g.attempt_limit IS NULL THEN NULL ELSE g.attempt_limit - v_no END);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'busy');
END; $$;

COMMENT ON FUNCTION _answer_gate(uuid, uuid, uuid, boolean) IS
  'May this signed-in student answer this question now. One rule for answer_context and record_answer. Internal.';
COMMENT ON FUNCTION answer_context(uuid, uuid, uuid) IS
  'For the check-answer edge function only (service_role). A refusal code, or the question format, the choice ids and '
  'the current key. The key leaves the database here and goes no further than the function.';
COMMENT ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid) IS
  'For the check-answer edge function only (service_role). Re-checks the gate under a lock, stores the attempt, '
  'recomputes the auto_checked grade from the stored attempts. Returns right or wrong, the attempt number and the '
  'attempts left, or a refusal code.';

-- ---- grants: by name -----------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _answer_gate(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION answer_context(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION answer_context(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid) TO service_role;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be exactly: answer_context and record_answer, grantee service_role
--   SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN LATERAL aclexplode(p.proacl) a ON true JOIN pg_roles r ON r.oid = a.grantee
--    WHERE n.nspname = 'app' AND p.proname IN ('answer_context', 'record_answer', '_answer_gate')
--      AND a.privilege_type = 'EXECUTE' AND r.rolname <> 'prep_app_owner';
--   -- must be 0 rows: no client can write the attempt table
--   SELECT g.grantee, g.privilege_type FROM information_schema.role_table_grants g
--    WHERE g.table_schema = 'app' AND g.table_name = 'question_attempts'
--      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
--      AND g.grantee IN ('anon', 'authenticated', 'service_role', 'prep_app_dml');
