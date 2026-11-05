-- Rollback for 041_set_helpers_and_atomic_saves.sql. Run as `prep_app_owner`.
--
-- Puts the 040 state back: the four per-row helper functions and the four policies that call them. Then drops
-- everything 041 added (the four set helpers, save_letter_scale, save_question, the letter_scales stamp).
-- Holds no data and loses none. `created_by` values already written stay.
--
-- ORDER: roll back in reverse. 042's rollback first (it restores the bodies this file drops), then this file, then
-- 040's. Rolling 040 back while 041 is still applied restores the 030 policies and leaves 041's functions behind.
-- This file has no IF EXISTS on purpose, so it stops at the first thing that is not as 041 left it; it is one
-- transaction, so a stop leaves nothing half done.
--
-- After this, the Letter scale and Questions pages that call save_letter_scale and save_question will fail to save
-- until 041 is applied again or the pages are put back.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- 040's four per-row helpers, exactly as 040 wrote them
CREATE FUNCTION activity_is_directed(p_activity uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                  WHERE a.id = p_activity
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin())));
$$;

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

-- 040's four policies
DROP POLICY questions_read_staff         ON questions;
DROP POLICY questions_write_director     ON questions;
DROP POLICY question_keys_read_staff     ON question_keys;
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

-- what 041 added
DROP TRIGGER letter_scales_stamp ON letter_scales;
DROP FUNCTION letter_scales_stamp();
DROP FUNCTION save_question(uuid, timestamptz, jsonb, boolean, jsonb, integer);
DROP FUNCTION save_letter_scale(uuid, jsonb, numeric, integer);
DROP FUNCTION staff_visible_question_ids();
DROP FUNCTION directed_question_ids();
DROP FUNCTION staff_visible_activity_ids();
DROP FUNCTION directed_activity_ids();

COMMIT;
