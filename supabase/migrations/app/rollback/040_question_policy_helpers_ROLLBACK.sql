-- Rollback for 040_question_policy_helpers.sql. Run as `prep_app_owner`.
--
-- Puts the four policies on `questions` and `question_keys` back exactly as 030 wrote them, then drops the four
-- helper functions. Holds no data and loses none. Clean at any time. Key edits through the page will go back to
-- taking longer than the API's 8 second limit.
--
-- ORDER: if 041 is applied, roll back 042 and 041 first (reverse order). Run alone after 041, this file restores the 030
-- policies (it uses IF EXISTS) but leaves 041's save functions, set helpers and stamp trigger in place, unrecorded.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP POLICY questions_read_staff         ON questions;
DROP POLICY questions_write_director     ON questions;
DROP POLICY question_keys_read_staff     ON question_keys;
DROP POLICY question_keys_write_director ON question_keys;

CREATE POLICY questions_read_staff ON questions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM offering_activities oa
              JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
             WHERE oa.activity_id = questions.activity_id
               AND ao.course_offering_id IN (SELECT staff_offerings()))
    OR EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                WHERE a.id = questions.activity_id
                  AND s.course_id IN (SELECT director_courses())));

CREATE POLICY questions_write_director ON questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                  WHERE a.id = questions.activity_id
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                       WHERE a.id = questions.activity_id
                         AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))));

CREATE POLICY question_keys_read_staff ON question_keys FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM questions q
              JOIN offering_activities oa ON oa.activity_id = q.activity_id
              JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
             WHERE q.id = question_keys.question_id
               AND ao.course_offering_id IN (SELECT staff_offerings()))
    OR EXISTS (SELECT 1 FROM questions q
                 JOIN activities a ON a.id = q.activity_id
                 JOIN assignments s ON s.id = a.assignment_id
                WHERE q.id = question_keys.question_id
                  AND s.course_id IN (SELECT director_courses())));

CREATE POLICY question_keys_write_director ON question_keys FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM questions q
                   JOIN activities a ON a.id = q.activity_id
                   JOIN assignments s ON s.id = a.assignment_id
                  WHERE q.id = question_keys.question_id
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM questions q
                        JOIN activities a ON a.id = q.activity_id
                        JOIN assignments s ON s.id = a.assignment_id
                       WHERE q.id = question_keys.question_id
                         AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))));

DROP FUNCTION IF EXISTS question_is_staff_visible(uuid);
DROP FUNCTION IF EXISTS question_is_directed(uuid);
DROP FUNCTION IF EXISTS activity_is_staff_visible(uuid);
DROP FUNCTION IF EXISTS activity_is_directed(uuid);

COMMIT;
