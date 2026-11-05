-- Rollback for 072_remark_question.sql. Run as `prep_app_owner`.
-- Puts record_answer back to its 071 text (the grade step written out in the function), then drops the functions and the question
-- trigger this migration added. Stored attempts, grades and key_remark_runs rows stay: they are data. Run before rolling back 071.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

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

DROP TRIGGER questions_regrade_auto ON questions;
DROP FUNCTION questions_regrade_auto();
DROP FUNCTION remark_apply(uuid, uuid, uuid, jsonb, boolean, text);
DROP FUNCTION remark_context(uuid, uuid);
DROP FUNCTION _remark_calc(uuid, uuid, jsonb);
DROP FUNCTION _may_correct_key(uuid, uuid);
DROP FUNCTION _regrade_auto(uuid, uuid, uuid);

COMMIT;
