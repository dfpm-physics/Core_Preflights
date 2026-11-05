-- PREP v2 -- a grade written by an answer or a re-mark names the person behind it
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 049_grade_audit.sql (grades_audit, grade_events), 070_answer_internals.sql (the
-- answer-marking marker) and 071/072 (record_answer, remark_apply, _regrade_auto). Added at the merge of step 2 and Stage E.
--
-- WHY
--   049 writes an audit row for every change to a grade and reads the actor from the signed-in session. The answer
--   functions run for the server (the edge functions call them with the service role), so the session names nobody and
--   every automatic write was logged with no actor. A grade changed by an answer or by a re-mark is a change a person
--   caused: the cadet who answered, the staff member who corrected a key.
--
-- WHAT IT DOES
--   * grades_audit() REPLACED: unchanged except that, when the session names no staff member and the answer-marking
--     marker is on for this statement, the actor and the way of writing come from two transaction-local settings
--     (`app.audit_actor`, `app.audit_via`). The settings are honoured only while the marker is on, and the marker is
--     on only inside _regrade_auto, so a value left behind names nobody.
--   * record_answer() REPLACED: sets the settings to the student's verified sign-in id and 'answer' around the grade
--     step, and clears them straight after. Nothing else changes.
--   * remark_apply() REPLACED: sets them to the staff member's verified sign-in id and 'remark' around the re-grade loop,
--     and clears them straight after. Nothing else changes.
--   A change made through a staff session (a correction in the grade page, an edit of a question that re-grades) is
--   unchanged: the actor is the staff member read from the session, as before.
--
-- WHAT IT DOES NOT DO
--   It adds no table or column, grants nothing, and does not touch a stored row. grade_events.actor holds a sign-in id
--   with no foreign key (049), so a cadet's id fits; `detail.via` says 'answer' or 'remark' (it said 'server' before).
--
-- Rollback: rollback/075_answer_audit_actor_ROLLBACK.sql restores the 049 and 072 texts.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION grades_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor uuid := audit_actor();
  v_event text;
  v_core  boolean;
  v_flag  boolean;
  v_via   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'server');
BEGIN
  -- A grade written by the answer functions carries the person who caused it. Those functions run for the server, so the
  -- session names nobody; they pass the person they verified through two transaction-local settings, and the settings count
  -- only while the answer-marking marker is on for this very statement (070), so a leftover value names nobody.
  IF v_actor IS NULL AND coalesce(current_setting('app.auto_check_marker', true), '') = 'on' THEN
    v_actor := nullif(current_setting('app.audit_actor', true), '')::uuid;
    v_via   := coalesce(nullif(current_setting('app.audit_via', true), ''), v_via);
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM grade_events_put(NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, 'created', v_actor,
            jsonb_build_object('offering', NEW.assignment_offering_id, 'points_earned', NEW.points_earned,
                               'points_possible', NEW.points_possible, 'source', NEW.source,
                               'is_finalized', NEW.is_finalized, 'over_max_allowed', NEW.over_max_allowed,
                               'graded_by', NEW.graded_by, 'via', v_via));
    RETURN NULL;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM grade_events_put(OLD.id, OLD.enrollment_id, OLD.assignment_offering_id, 'removed', v_actor,
            jsonb_build_object('grade', OLD.id, 'enrollment', OLD.enrollment_id, 'offering', OLD.assignment_offering_id,
                               'points_earned', OLD.points_earned, 'points_possible', OLD.points_possible,
                               'is_finalized', OLD.is_finalized, 'graded_by', OLD.graded_by, 'via', v_via));
    RETURN NULL;
  END IF;

  -- UPDATE: nothing audited changed -> no row
  v_core := NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible
         OR NEW.is_finalized IS DISTINCT FROM OLD.is_finalized
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.effort IS DISTINCT FROM OLD.effort
         OR NEW.question_scores IS DISTINCT FROM OLD.question_scores
         OR NEW.graded_by IS DISTINCT FROM OLD.graded_by
         OR NEW.over_max_allowed IS DISTINCT FROM OLD.over_max_allowed
         OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
         OR NEW.graded_at IS DISTINCT FROM OLD.graded_at;
  v_flag := (NEW.diagnostic -> 'flag_overrides') IS DISTINCT FROM (OLD.diagnostic -> 'flag_overrides');
  IF NOT v_core AND NOT v_flag THEN
    RETURN NULL;
  END IF;

  v_event := CASE
    WHEN NOT v_core THEN 'flag_override_changed'
    WHEN NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id THEN 'moved'
    WHEN NEW.is_finalized AND NOT OLD.is_finalized THEN 'finalized'
    WHEN OLD.is_finalized AND NOT NEW.is_finalized THEN 'reopened'
    WHEN NEW.points_earned IS DISTINCT FROM OLD.points_earned
         OR NEW.points_possible IS DISTINCT FROM OLD.points_possible THEN 'rescored'
    ELSE 'edited' END;

  PERFORM grade_events_put(NEW.id, NEW.enrollment_id, NEW.assignment_offering_id, v_event, v_actor,
          jsonb_build_object('offering', NEW.assignment_offering_id,
                             'points_before', OLD.points_earned, 'points_after', NEW.points_earned,
                             'finalized_before', OLD.is_finalized, 'finalized_after', NEW.is_finalized,
                             'source_before', OLD.source, 'source_after', NEW.source,
                             'graded_by_before', OLD.graded_by, 'graded_by_after', NEW.graded_by,
                             'over_max_before', OLD.over_max_allowed, 'over_max_after', NEW.over_max_allowed,
                             'graded_at_before', OLD.graded_at, 'graded_at_after', NEW.graded_at,
                             'enrollment_before', OLD.enrollment_id, 'enrollment_after', NEW.enrollment_id,
                             'via', v_via)
          || CASE WHEN v_flag THEN jsonb_build_object('flag_overrides_before', OLD.diagnostic -> 'flag_overrides',
                                                      'flag_overrides_after', NEW.diagnostic -> 'flag_overrides')
                  ELSE '{}'::jsonb END);
  RETURN NULL;
END $$;

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

  -- the person behind this grade write is the student whose sign-in id the edge function verified
  PERFORM set_config('app.audit_actor', p_auth_user::text, true);
  PERFORM set_config('app.audit_via', 'answer', true);
  PERFORM _regrade_auto(g.enrollment_id, p_assignment_offering, g.activity_id);
  PERFORM set_config('app.audit_actor', '', true);
  PERFORM set_config('app.audit_via', '', true);

  RETURN jsonb_build_object('status', 'ok', 'correct', p_is_correct, 'attempt_no', v_no,
                            'attempts_left', CASE WHEN g.attempt_limit IS NULL THEN NULL ELSE g.attempt_limit - v_no END);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'busy');
END; $$;

CREATE OR REPLACE FUNCTION remark_apply(p_auth_user uuid, p_question uuid, p_key_version uuid, p_verdicts jsonb,
                             p_commit boolean, p_preview_token text) RETURNS jsonb
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
  v_by_term  jsonb;
  v_refused  jsonb;
  v_refused_attempts integer;
  v_token    text;
  r          record;
BEGIN
  IF p_verdicts IS NULL OR jsonb_typeof(p_verdicts) <> 'array' OR p_commit IS NULL OR p_key_version IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END IF;
  v_n := jsonb_array_length(p_verdicts);
  IF v_n > c_max_attempts OR (p_commit AND (p_preview_token IS NULL OR p_preview_token !~ '^[0-9a-f]{32}$')) THEN
    RETURN jsonb_build_object('status', 'bad_request');
  END IF;
  IF NOT _may_correct_key(p_auth_user, p_question) THEN RETURN jsonb_build_object('status', 'not_allowed'); END IF;
  SELECT * INTO q FROM questions WHERE id = p_question;
  IF q.id IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF q.format = 'prose' THEN RETURN jsonb_build_object('status', 'not_auto_checked'); END IF;
  SELECT * INTO k FROM question_keys WHERE question_id = q.id AND variant_key = '' AND superseded_at IS NULL;
  IF k.id IS NULL THEN RETURN jsonb_build_object('status', 'no_key'); END IF;
  IF k.written_by = 'ai' AND k.checked_by IS NULL THEN RETURN jsonb_build_object('status', 'key_unchecked'); END IF;
  IF _key_problem(q.format, q.choices, k) IS NOT NULL THEN RETURN jsonb_build_object('status', 'key_fault'); END IF;
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

  -- what would change: ACTIVE terms only. The rest is reported and never written.
  SELECT count(*) FILTER (WHERE c.active AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
                             OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv)),
         count(*) FILTER (WHERE c.active AND c.new_c IS TRUE  AND c.old_c IS DISTINCT FROM TRUE),
         count(*) FILTER (WHERE c.active AND c.new_c IS FALSE AND c.old_c IS DISTINCT FROM FALSE),
         count(*) FILTER (WHERE c.unread),
         count(*) FILTER (WHERE NOT c.active AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
                             OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv))
    INTO v_changed, v_to_ok, v_to_bad, v_unread, v_refused_attempts
    FROM _remark_calc(q.id, k.id, p_verdicts) c;

  -- term by term: what is in each, what would change, whether it is applied
  SELECT coalesce(jsonb_agg(jsonb_build_object('term', t.term, 'course_offering_id', t.co_id, 'active', t.active,
                                               'attempts', t.n, 'would_change', t.chg, 'grades_affected', t.gr,
                                               'applied', t.active) ORDER BY t.term, t.co_id), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('term', t.term, 'course_offering_id', t.co_id, 'attempts', t.n,
                                               'would_change', t.chg, 'grades_affected', t.gr,
                                               'reason', 'not an active term: completed work is never re-marked')
                            ORDER BY t.term, t.co_id) FILTER (WHERE NOT t.active AND t.chg > 0), '[]'::jsonb)
    INTO v_by_term, v_refused
    FROM (SELECT c.co_id, c.term, c.active, count(*) AS n,
                 count(*) FILTER (WHERE c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
                                     OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv) AS chg,
                 count(DISTINCT (c.enr_id, c.ao_id)) FILTER (WHERE c.new_p IS DISTINCT FROM c.old_p) AS gr
            FROM _remark_calc(q.id, k.id, p_verdicts) c GROUP BY c.co_id, c.term, c.active) t;

  -- the token: the key version and every change an active term would receive. A different key or different changes
  -- give a different token, so a commit can only apply what a preview showed
  SELECT md5(k.id::text || ':' || coalesce(string_agg(c.attempt_id::text || '/' || coalesce(c.new_c::text, 'n') || '/'
                                                      || coalesce(c.new_p::text, 'n') || '/' || coalesce(c.new_pv::text, 'n'),
                                                      ',' ORDER BY c.attempt_id), ''))
    INTO v_token
    FROM _remark_calc(q.id, k.id, p_verdicts) c
   WHERE c.active AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
                       OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv);

  -- grades whose points move (active terms): recomputed if auto_checked, otherwise listed
  SELECT count(*) FILTER (WHERE g.id IS NULL OR g.source = 'auto_checked'),
         count(*) FILTER (WHERE g.id IS NOT NULL AND g.source <> 'auto_checked'),
         coalesce(jsonb_agg(jsonb_build_object('enrollment_id', s.enrollment_id, 'assignment_offering_id', s.assignment_offering_id,
                                               'source', g.source)) FILTER (WHERE g.id IS NOT NULL AND g.source <> 'auto_checked'), '[]'::jsonb)
    INTO v_regrade, v_n_listed, v_listed
    FROM (SELECT DISTINCT c.enr_id AS enrollment_id, c.ao_id AS assignment_offering_id
            FROM _remark_calc(q.id, k.id, p_verdicts) c WHERE c.active AND c.new_p IS DISTINCT FROM c.old_p) s
    LEFT JOIN grades g ON g.enrollment_id = s.enrollment_id AND g.assignment_offering_id = s.assignment_offering_id;
  IF v_n_listed > c_list_cap THEN
    v_listed := (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_listed) e LIMIT c_list_cap) t);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id', t.attempt_id, 'was_correct', t.old_c, 'now_correct', t.new_c,
                                               'points_was', t.old_p, 'points_now', t.new_p)), '[]'::jsonb)
    INTO v_sample
    FROM (SELECT * FROM _remark_calc(q.id, k.id, p_verdicts) c
           WHERE c.active AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p)
           ORDER BY c.attempt_id LIMIT 50) t;

  IF NOT p_commit THEN
    RETURN jsonb_build_object('status', 'ok', 'committed', false, 'attempts_total', v_n, 'attempts_changed', v_changed,
                              'now_correct', v_to_ok, 'now_wrong', v_to_bad, 'unreadable', v_unread,
                              'grades_to_recompute', v_regrade, 'grades_listed', v_n_listed, 'listed', v_listed,
                              'sample', v_sample, 'by_term', v_by_term, 'refused', v_refused,
                              'refused_attempts', v_refused_attempts, 'preview_token', v_token);
  END IF;

  IF p_preview_token IS DISTINCT FROM v_token THEN
    RETURN jsonb_build_object('status', 'changed_since_preview', 'attempts_changed', v_changed);
  END IF;

  -- the apply
  SELECT m.kv INTO v_from FROM (SELECT key_version_id AS kv, count(*) n FROM question_attempts
                                 WHERE question_id = q.id AND key_version_id IS DISTINCT FROM k.id
                                 GROUP BY 1 ORDER BY 2 DESC LIMIT 1) m;
  -- the students whose points move, taken BEFORE the update (the calculation reads the stored attempts)
  SELECT coalesce(jsonb_agg(jsonb_build_object('e', s.enr_id, 'a', s.ao_id) ORDER BY s.enr_id, s.ao_id), '[]'::jsonb)
    INTO v_pairs_json
    FROM (SELECT DISTINCT c.enr_id, c.ao_id FROM _remark_calc(q.id, k.id, p_verdicts) c
           WHERE c.active AND c.new_p IS DISTINCT FROM c.old_p) s;

  UPDATE question_attempts a
     SET is_correct = c.new_c, points_awarded = c.new_p, key_version_id = c.new_k, parsed_value = c.new_pv
    FROM _remark_calc(q.id, k.id, p_verdicts) c
   WHERE a.id = c.attempt_id AND c.active
     AND (c.new_c IS DISTINCT FROM c.old_c OR c.new_p IS DISTINCT FROM c.old_p
          OR c.new_k IS DISTINCT FROM c.old_k OR c.new_pv IS DISTINCT FROM c.old_pv);

  -- the person behind these grade writes is the staff member whose sign-in id the edge function verified
  PERFORM set_config('app.audit_actor', p_auth_user::text, true);
  PERFORM set_config('app.audit_via', 'remark', true);
  FOR r IN SELECT (x ->> 'e')::uuid AS enrollment_id, (x ->> 'a')::uuid AS assignment_offering_id
             FROM jsonb_array_elements(v_pairs_json) x LOOP
    PERFORM _regrade_auto(r.enrollment_id, r.assignment_offering_id, q.activity_id);
  END LOOP;
  PERFORM set_config('app.audit_actor', '', true);
  PERFORM set_config('app.audit_via', '', true);

  INSERT INTO key_remark_runs (question_id, from_key_version, to_key_version, run_by, attempts_changed, grades_recomputed, grades_listed)
  VALUES (q.id, v_from, k.id, p_auth_user, v_changed, v_regrade, v_n_listed);

  RETURN jsonb_build_object('status', 'ok', 'committed', true, 'attempts_total', v_n, 'attempts_changed', v_changed,
                            'now_correct', v_to_ok, 'now_wrong', v_to_bad, 'unreadable', v_unread,
                            'grades_to_recompute', v_regrade, 'grades_listed', v_n_listed, 'listed', v_listed,
                            'by_term', v_by_term, 'refused', v_refused, 'refused_attempts', v_refused_attempts);
END; $$;

-- grants are unchanged by CREATE OR REPLACE; stated again so the file stands on its own
REVOKE ALL ON FUNCTION grades_audit() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, text) TO service_role;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 3 rows: the audit trigger function reads the settings and both answer functions set them
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.prosrc LIKE '%app.audit_actor%' ORDER BY 1;
