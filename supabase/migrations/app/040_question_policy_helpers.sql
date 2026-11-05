-- 040_question_policy_helpers.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- WHY
--   Saving a changed answer key supersedes the old key row (an UPDATE on question_keys). On staging that
--   one-row UPDATE took 13 to 27 seconds as a director and 15 milliseconds as the table owner. The API cancels
--   any statement over 8 seconds, so the page refused the edit most of the time.
--
--   The time was not in the row. It was in the row-level security. The policies on `questions` and
--   `question_keys` each ask "does this person direct, or staff, the course this question belongs to?" with a
--   subquery over `activities` and `assignments`. Those tables have their own policies, which have their own
--   subqueries, so one UPDATE was planned and started as a plan of about 3,300 lines (planning 0.5 to 4.5 s,
--   executor start the rest). The operators that actually ran took under 0.4 s in total.
--
-- WHAT
--   Four small functions answer the same two questions in one step, reading the tables as their owner so the
--   nested policies are not expanded. The four policies on `questions` and `question_keys` call them. The
--   rule each policy states is unchanged, word for word:
--     read   a person who staffs a course offering that offers the activity, or directs the activity's course
--     write  a person who directs the activity's course (a global admin for a course-less assignment)
--
-- WHAT THIS DOES NOT WIDEN
--   * Each function reads the caller from the sign-in (current_uid(), through the existing helpers), never from
--     an argument. Passing someone else's id changes nothing; there is no such argument.
--   * Each returns only true or false. It returns no row and no column.
--   * EXECUTE goes to `authenticated` only. A policy runs with the caller's own privileges, so that role needs it
--     and nobody else does. anon and PUBLIC get nothing.
--   * No table privilege changes. The table grants, the RLS switches, the triggers and the constraints on both
--     tables are untouched. There is still no student policy on question_keys, and no policy for anon.
--   * Every function pins search_path.
--
-- OTHER POLICIES WITH THE SAME SHAPE are listed at the foot of this file. None is changed here.
--
-- Rollback: rollback/040_question_policy_helpers_ROLLBACK.sql puts the four policies back exactly as 030 wrote
-- them and drops the four functions. Nothing it touches holds data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- the four functions ------------------------------------------------------------------------------------------

-- Does the caller direct the course that owns this activity? (A global admin does, for a course-less assignment.)
CREATE FUNCTION activity_is_directed(p_activity uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                  WHERE a.id = p_activity
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin())));
$$;

-- May the caller read this activity's questions? Staff of an offering that offers it, or a director of its course.
CREATE FUNCTION activity_is_staff_visible(p_activity uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM offering_activities oa
                   JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
                  WHERE oa.activity_id = p_activity
                    AND ao.course_offering_id IN (SELECT staff_offerings()))
      OR EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                  WHERE a.id = p_activity
                    AND s.course_id IN (SELECT director_courses()));
$$;

-- The same two questions, asked by question id (for question_keys).
CREATE FUNCTION question_is_directed(p_question uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM questions q WHERE q.id = p_question AND activity_is_directed(q.activity_id));
$$;

CREATE FUNCTION question_is_staff_visible(p_question uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM questions q WHERE q.id = p_question AND activity_is_staff_visible(q.activity_id));
$$;

COMMENT ON FUNCTION activity_is_directed(uuid) IS
  'True when the caller directs the course that owns the activity. Policy helper: reads as its owner so the nested policies on activities and assignments are not expanded. Returns a boolean only.';
COMMENT ON FUNCTION activity_is_staff_visible(uuid) IS
  'True when the caller staffs an offering that offers the activity, or directs its course. Policy helper, boolean only.';
COMMENT ON FUNCTION question_is_directed(uuid) IS
  'activity_is_directed for the activity of a question. Policy helper, boolean only.';
COMMENT ON FUNCTION question_is_staff_visible(uuid) IS
  'activity_is_staff_visible for the activity of a question. Policy helper, boolean only.';

REVOKE ALL ON FUNCTION activity_is_directed(uuid)         FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION activity_is_staff_visible(uuid)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_is_directed(uuid)         FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_is_staff_visible(uuid)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION activity_is_directed(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION activity_is_staff_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION question_is_directed(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION question_is_staff_visible(uuid) TO authenticated;

-- ---- the four policies, same rule, one call each ----------------------------------------------------------------

DROP POLICY questions_read_staff      ON questions;
DROP POLICY questions_write_director  ON questions;
DROP POLICY question_keys_read_staff  ON question_keys;
DROP POLICY question_keys_write_director ON question_keys;

CREATE POLICY questions_read_staff ON questions FOR SELECT TO authenticated
  USING (activity_is_staff_visible(activity_id));

CREATE POLICY questions_write_director ON questions FOR ALL TO authenticated
  USING (activity_is_directed(activity_id))
  WITH CHECK (activity_is_directed(activity_id));

CREATE POLICY question_keys_read_staff ON question_keys FOR SELECT TO authenticated
  USING (question_is_staff_visible(question_id));

CREATE POLICY question_keys_write_director ON question_keys FOR ALL TO authenticated
  USING (question_is_directed(question_id))
  WITH CHECK (question_is_directed(question_id));

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- four policies per table, none for anon, none for a student role
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'app' AND tablename IN ('questions', 'question_keys') ORDER BY 1, 2;
--
--   -- EXECUTE only for authenticated
--   SELECT r, has_function_privilege(r, 'app.question_is_staff_visible(uuid)', 'EXECUTE')
--     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;

-- =====================================================================================
-- OTHER POLICIES WITH THE SAME NESTED SHAPE (found 2026-11-05, not changed here)
-- =====================================================================================
-- A policy whose subquery reads another table that has its own policy pays for that table's policy too.
--   activities_write       over assignments            same cost pattern; a different question, so needs its own helper
--   offering_activities    oa_write over assignment_offerings (director_offerings)
--   key_remark_runs_read_staff   over questions, offering_activities, assignment_offerings. Now cheaper, because
--                          `questions` is one call; but its rule has no director branch, so the helpers here
--                          do NOT fit it without a change of meaning. Left alone.
--   assignment_due_dates due_write, students_write, enrollments_write, submission_activities (sa_*), submissions_staff_update,
--   extensions_staff_write, grades_staff_write, grade_excusals_*, student_group_*_write_director, ei_sessions_staff_write
-- The write policies run on single rows from the pages that use them and were not measured to cross the 8 second
-- limit; measure one before changing it.
