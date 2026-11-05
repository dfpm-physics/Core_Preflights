-- PREP v2 Stage E -- what a student may read of an auto-checked item: the questions, never the key
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 070_answer_internals.sql (_release_core), 030_questions_and_keys.sql and
-- 031_attempts_and_receipts.sql. Design: docs/decisions/V2-STAGE-E-ANSWERS.md ("The student page").
--
-- WHAT IT DOES
--   student_homework(assignment_offering) returns, for the signed-in student only, one JSON document:
--     the item's attempt limit and rule, and for each question on its auto-checked path: id, name, order, prompt, figure,
--     unit hint, format, the choices as {id, text}, the points, and how many attempts this student has used.
--
-- WHY A FUNCTION AND NOT A POLICY
--   `questions` has no student policy and `question_keys` never will. A policy on `questions` would hand a student every
--   column of every released row by any query shape; this function names the columns it returns, so a column added to
--   `questions` later reaches no student until this function says so. Choices are rebuilt as {id, text} only.
--
-- WHAT THE DATABASE ENFORCES
--   who        the signed-in session (current_uid, through my_enrollments); never an argument
--   enrolled   an ACTIVE enrollment in the offering that owns the item; a staff session with no enrollment gets nothing
--   published  the item is published
--   released   _release_core(item, the student's section) has passed: the one release rule (opens_at, else seven days
--              before the scheduled deadline, floored to the start of the day in Denver)
--   path       only questions of an auto_checked path, not retired, not prose
--   after      a question stays readable after the deadline (a student reviews work); answering is another function
--
-- WHAT IT DOES NOT DO
--   It returns no key, no tolerance, no sig-fig rule, no unit rule, no key version, no correct flag for a choice, and no
--   other student's attempt count. Whether the student's last attempt was right is the grade row and check-answer's reply.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION student_homework(p_assignment_offering uuid) RETURNS jsonb
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
  IF v_rel IS NOT NULL AND now() < v_rel THEN RETURN jsonb_build_object('status', 'not_open'); END IF;

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
               'points', q.points,
               'attempts_used', (SELECT count(*) FROM question_attempts a WHERE a.enrollment_id = v_enr AND a.question_id = q.id)
             ) ORDER BY q.position, q.qid)
        FROM questions q
        JOIN offering_activities oa ON oa.activity_id = q.activity_id AND oa.assignment_offering_id = v_ao.id
       WHERE oa.grading = 'auto_checked' AND NOT q.is_retired AND q.format <> 'prose'), '[]'::jsonb));
END; $$;

COMMENT ON FUNCTION student_homework(uuid) IS
  'The signed-in student''s view of one auto-checked item: attempt limit and rule, and each question''s prompt, figure, '
  'format, choices as {id, text}, points and attempts used. Only once the item is published and released, only for an '
  'enrolled student. Returns no key data. Names every column it returns.';

REVOKE ALL ON FUNCTION student_homework(uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION student_homework(uuid) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be exactly: authenticated
--   SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN LATERAL aclexplode(p.proacl) a ON true JOIN pg_roles r ON r.oid = a.grantee
--    WHERE n.nspname = 'app' AND p.proname = 'student_homework' AND a.privilege_type = 'EXECUTE' AND r.rolname <> 'prep_app_owner';
