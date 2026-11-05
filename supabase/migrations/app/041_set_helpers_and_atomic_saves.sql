-- 041_set_helpers_and_atomic_saves.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- THREE THINGS, ALL ADD-ONLY OR POLICY-FOR-POLICY, NONE MOVES A GRADE OR A TOTAL
--
--   1. The four policies on `questions` and `question_keys` stop calling a function once per row.
--      040 made a key edit fast, but a policy that calls a STABLE SECURITY DEFINER function per row still
--      costs time for every row of the table that a statement has to look at (measured on staging with
--      1,854 synthetic rows: an unfiltered `count(*)` by a director took 1.3 to 1.7 s, by an instructor
--      3 to 4.5 s, about 0.7 and 1.7 ms per row). The API cancels any statement over 8 seconds, so an
--      unfiltered read crosses that line at a few thousand rows. Four set-returning helpers replace the
--      four per-row ones: a policy reads `activity_id IN (SELECT ...)`, so the set is built once per
--      statement and hashed. The rule each policy states is the one 030 wrote, unchanged.
--         read   a person who staffs a course offering that offers the activity, or directs its course
--         write  a person who directs the activity's course (a global admin for a course-less assignment)
--      The four per-row helpers from 040 are dropped; nothing calls them any more.
--
--   2. Two database functions that make a two-step save one step:
--         save_letter_scale   retire the scale in force and insert the next version, in one transaction.
--         save_question       update a question, and when its key changed supersede the current key and insert
--                             the next version, in one transaction. Both refuse when the row changed since the
--                             page read it (an optimistic check: the scale's version, the question's updated_at,
--                             the key's version).
--      Both are SECURITY INVOKER. The caller's own row-level security applies to every statement inside them,
--      so they can do nothing a director could not already do one statement at a time. They also check the
--      caller's role first, with the same rule as the policies, so the refusal is a sentence, not a generic
--      "row-level security" error. EXECUTE goes to `authenticated` only.
--
--   3. `letter_scales.created_by` is stamped by a trigger from the signed-in caller, the way
--      `question_keys.created_by` is. A page no longer sends it. Once set, the author does not change; a row whose
--      author is NULL cannot be given one later (clearing to NULL is allowed), so a backfill of authors needs the
--      trigger disabled first.
--
-- WHAT THIS DOES NOT CHANGE
--   * No table, column or constraint. No privilege on any table. No student policy, and none for anon.
--   * The helpers read the caller from the sign-in (current_uid() through the existing helpers), never from an
--     argument, and return only ids the caller may already read. They return no column.
--   * Every function pins search_path.
--
-- PRECONDITION (checked below; the file refuses to apply otherwise)
--   The helpers are SECURITY DEFINER and read their tables as their owner, which skips those tables' own
--   policies ONLY while the owner owns them and FORCE ROW LEVEL SECURITY is off.
--   If a table were owned by someone else, or forced, every helper would return nothing and every director
--   would lose the Questions page, failing closed. So the file stops, naming the table, instead. (It stops on a
--   FORCEd table even where the owner role also has BYPASSRLS, in which case the helpers would have worked: the
--   safe direction. The first text of this header said "or the role has BYPASSRLS", which the code never did.)
--
-- Rollback: rollback/041_set_helpers_and_atomic_saves_ROLLBACK.sql puts the 040 state back (the four per-row
-- helpers and the 040 policies) and drops everything added here. It holds no data and loses none.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- precondition -----------------------------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  IF current_user <> 'prep_app_owner' THEN
    RAISE EXCEPTION '041 must be applied as prep_app_owner (this session is %). Nothing was changed.', current_user;
  END IF;
  SELECT string_agg(c.relname || ' (owner ' || pg_get_userbyid(c.relowner)
                    || CASE WHEN c.relforcerowsecurity THEN ', FORCE ROW LEVEL SECURITY on' ELSE '' END || ')', ', ')
    INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'app'::regnamespace
     AND c.relname IN ('activities', 'assignments', 'offering_activities', 'assignment_offerings',
                       'questions', 'question_keys', 'instructors', 'staff_assignments', 'courses', 'course_offerings')
     AND (pg_get_userbyid(c.relowner) <> 'prep_app_owner' OR c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'the policy helpers read these tables as prep_app_owner and need it to own them, without FORCE ROW LEVEL SECURITY: %. Nothing was changed.', bad;
  END IF;
END $$;

-- ---- 1. the four set helpers ------------------------------------------------------------------------------------

-- Activities whose courses the caller directs (a global admin also directs a course-less assignment's).
CREATE FUNCTION directed_activity_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp ROWS 500 AS $$
  SELECT a.id FROM activities a JOIN assignments s ON s.id = a.assignment_id
   WHERE s.course_id IN (SELECT director_courses())
  UNION
  SELECT a.id FROM activities a JOIN assignments s ON s.id = a.assignment_id
   WHERE s.course_id IS NULL AND is_admin();
$$;

-- Activities the caller may read the questions of: offered by a course offering they staff, or in a course they direct.
CREATE FUNCTION staff_visible_activity_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp ROWS 500 AS $$
  SELECT oa.activity_id FROM offering_activities oa
    JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
   WHERE ao.course_offering_id IN (SELECT staff_offerings())
  UNION
  SELECT a.id FROM activities a JOIN assignments s ON s.id = a.assignment_id
   WHERE s.course_id IN (SELECT director_courses());
$$;

-- The same two sets, as question ids (for question_keys).
CREATE FUNCTION directed_question_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp ROWS 2000 AS $$
  SELECT q.id FROM questions q WHERE q.activity_id IN (SELECT directed_activity_ids());
$$;

CREATE FUNCTION staff_visible_question_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp ROWS 2000 AS $$
  SELECT q.id FROM questions q WHERE q.activity_id IN (SELECT staff_visible_activity_ids());
$$;

COMMENT ON FUNCTION directed_activity_ids() IS
  'Ids of the activities whose course the caller directs. Policy helper: read as its owner so the nested policies are not expanded, and built once per statement. Returns ids only.';
COMMENT ON FUNCTION staff_visible_activity_ids() IS
  'Ids of the activities whose questions the caller may read. Policy helper, ids only.';
COMMENT ON FUNCTION directed_question_ids() IS
  'Ids of the questions of directed_activity_ids(). Policy helper, ids only.';
COMMENT ON FUNCTION staff_visible_question_ids() IS
  'Ids of the questions of staff_visible_activity_ids(). Policy helper, ids only.';

REVOKE ALL ON FUNCTION directed_activity_ids()       FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION staff_visible_activity_ids()  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION directed_question_ids()       FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION staff_visible_question_ids()  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION directed_activity_ids()      TO authenticated;
GRANT EXECUTE ON FUNCTION staff_visible_activity_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION directed_question_ids()      TO authenticated;
GRANT EXECUTE ON FUNCTION staff_visible_question_ids() TO authenticated;

DROP POLICY questions_read_staff         ON questions;
DROP POLICY questions_write_director     ON questions;
DROP POLICY question_keys_read_staff     ON question_keys;
DROP POLICY question_keys_write_director ON question_keys;

CREATE POLICY questions_read_staff ON questions FOR SELECT TO authenticated
  USING (activity_id IN (SELECT staff_visible_activity_ids()));

CREATE POLICY questions_write_director ON questions FOR ALL TO authenticated
  USING (activity_id IN (SELECT directed_activity_ids()))
  WITH CHECK (activity_id IN (SELECT directed_activity_ids()));

CREATE POLICY question_keys_read_staff ON question_keys FOR SELECT TO authenticated
  USING (question_id IN (SELECT staff_visible_question_ids()));

CREATE POLICY question_keys_write_director ON question_keys FOR ALL TO authenticated
  USING (question_id IN (SELECT directed_question_ids()))
  WITH CHECK (question_id IN (SELECT directed_question_ids()));

-- the per-row helpers from 040: no policy calls them now
DROP FUNCTION question_is_staff_visible(uuid);
DROP FUNCTION question_is_directed(uuid);
DROP FUNCTION activity_is_staff_visible(uuid);
DROP FUNCTION activity_is_directed(uuid);

-- ---- 2a. save_letter_scale: retire and insert as one step -------------------------------------------------------
-- p_expected_version is the version the page showed (0 when the offering was on the default scale). If the scale in
-- force is not that one, someone saved in between and nothing is written.
CREATE FUNCTION save_letter_scale(p_course_offering uuid, p_lines jsonb, p_width numeric, p_expected_version integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_id   uuid;
  v_ver  integer;
  v_next integer;
BEGIN
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT director_offerings()) THEN
    RAISE EXCEPTION 'save_letter_scale: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT s.id, s.version INTO v_id, v_ver
    FROM letter_scales s
   WHERE s.course_offering_id = p_course_offering AND s.retired_at IS NULL
     FOR UPDATE;
  IF coalesce(v_ver, 0) <> coalesce(p_expected_version, 0) THEN
    RAISE EXCEPTION 'save_letter_scale: the scale in force changed since you opened the page (it is now version %)', coalesce(v_ver, 0)
      USING ERRCODE = 'P0001';
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE letter_scales SET retired_at = now() WHERE id = v_id;
  END IF;
  SELECT coalesce(max(s.version), 0) + 1 INTO v_next FROM letter_scales s WHERE s.course_offering_id = p_course_offering;
  INSERT INTO letter_scales (course_offering_id, version, lines, near_line_width)
  VALUES (p_course_offering, v_next, p_lines, p_width);
  RETURN v_next;
END; $$;

COMMENT ON FUNCTION save_letter_scale(uuid, jsonb, numeric, integer) IS
  'Retire the scale in force and insert the next version in one transaction. Security invoker: the caller''s own policies apply. Refuses when the version in force is not the one the caller saw.';

-- ---- 2b. save_question: question update and key supersede-and-insert as one step ---------------------------------
-- p_cols            {"prompt_md": text, "points": number, "choices": array|null, "unit_hint": text|null}
-- p_expected_updated_at   the question's updated_at as the page read it, passed back as text, unchanged
-- p_write_key       false: leave the key alone. true: supersede the current key (if any) and insert the next version
-- p_key             the new key's fields (see below); any field absent or null is NULL / its default
-- p_expected_key_version  the version of the current key as the page read it, or null when it had none
-- Returns the key version now current (null when the question has none) and whether a new version was written.
CREATE FUNCTION save_question(p_question uuid, p_expected_updated_at timestamptz, p_cols jsonb,
                              p_write_key boolean, p_key jsonb, p_expected_key_version integer)
RETURNS TABLE (key_version integer, new_version boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_activity uuid;
  v_rows     integer;
  v_cur_id   uuid;
  v_cur_ver  integer;
  v_next     integer;
BEGIN
  SELECT q.activity_id INTO v_activity FROM questions q WHERE q.id = p_question;
  IF v_activity IS NULL OR v_activity NOT IN (SELECT directed_activity_ids()) THEN
    RAISE EXCEPTION 'save_question: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE questions q
     SET prompt_md = p_cols ->> 'prompt_md',
         points    = (p_cols ->> 'points')::numeric,
         choices   = CASE WHEN jsonb_typeof(p_cols -> 'choices') = 'array' THEN p_cols -> 'choices' ELSE NULL END,
         unit_hint = p_cols ->> 'unit_hint'
   WHERE q.id = p_question AND q.updated_at = p_expected_updated_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'save_question: this question changed since you opened it' USING ERRCODE = 'P0001';
  END IF;

  SELECT k.id, k.version INTO v_cur_id, v_cur_ver
    FROM question_keys k
   WHERE k.question_id = p_question AND k.variant_key = '' AND k.superseded_at IS NULL
     FOR UPDATE;

  IF NOT coalesce(p_write_key, false) THEN
    RETURN QUERY SELECT v_cur_ver, false;
    RETURN;
  END IF;

  IF v_cur_ver IS DISTINCT FROM p_expected_key_version THEN
    RAISE EXCEPTION 'save_question: the answer key changed since you opened this question' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur_id IS NOT NULL THEN
    UPDATE question_keys SET superseded_at = now() WHERE id = v_cur_id;
  END IF;
  SELECT coalesce(max(k.version), 0) + 1 INTO v_next
    FROM question_keys k WHERE k.question_id = p_question AND k.variant_key = '';

  INSERT INTO question_keys (question_id, variant_key, version, correct_choice_ids, select_rule, value, tol_abs, tol_pct,
                             sig_figs, sig_fig_mode, unit, unit_aliases, unit_mode, reference_text, written_by)
  VALUES (p_question, '', v_next,
          CASE WHEN jsonb_typeof(p_key -> 'correct_choice_ids') = 'array'
               THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'correct_choice_ids')) END,
          'all_or_nothing',
          (p_key ->> 'value')::numeric, (p_key ->> 'tol_abs')::numeric, (p_key ->> 'tol_pct')::numeric,
          (p_key ->> 'sig_figs')::smallint, coalesce(p_key ->> 'sig_fig_mode', 'ignore'),
          p_key ->> 'unit',
          CASE WHEN jsonb_typeof(p_key -> 'unit_aliases') = 'array'
               THEN ARRAY(SELECT jsonb_array_elements_text(p_key -> 'unit_aliases')) END,
          coalesce(p_key ->> 'unit_mode', 'ignore'),
          p_key ->> 'reference_text', 'human');
  RETURN QUERY SELECT v_next, true;
END; $$;

COMMENT ON FUNCTION save_question(uuid, timestamptz, jsonb, boolean, jsonb, integer) IS
  'Update a question and, when asked, supersede its current key and insert the next version, in one transaction. Security invoker. Refuses when the question or its key changed since the caller read it.';

REVOKE ALL ON FUNCTION save_letter_scale(uuid, jsonb, numeric, integer)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION save_question(uuid, timestamptz, jsonb, boolean, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION save_letter_scale(uuid, jsonb, numeric, integer)                    TO authenticated;
GRANT EXECUTE ON FUNCTION save_question(uuid, timestamptz, jsonb, boolean, jsonb, integer)    TO authenticated;

-- ---- 3. letter_scales.created_by comes from the sign-in ---------------------------------------------------------
CREATE FUNCTION letter_scales_stamp() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(current_uid(), NEW.created_by);   -- a script without a sign-in may name the author
  ELSIF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by on a letter scale does not change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;                                                   -- clearing it (an instructor row removed) is allowed
END; $$;

CREATE TRIGGER letter_scales_stamp
  BEFORE INSERT OR UPDATE ON letter_scales
  FOR EACH ROW EXECUTE FUNCTION letter_scales_stamp();

REVOKE ALL ON FUNCTION letter_scales_stamp() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- four policies per table, none for anon, none for a student role
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'app' AND tablename IN ('questions', 'question_keys') ORDER BY 1, 2;
--
--   -- EXECUTE only for authenticated, on all six new functions
--   SELECT p.proname, r, has_function_privilege(r, p.oid, 'EXECUTE')
--     FROM pg_proc p, unnest(ARRAY['anon', 'authenticated', 'service_role']) r
--    WHERE p.pronamespace = 'app'::regnamespace
--      AND p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids', 'directed_question_ids',
--                        'staff_visible_question_ids', 'save_letter_scale', 'save_question')
--    ORDER BY 1, 2;
--
--   -- OWNERSHIP, FORCE ROW LEVEL SECURITY AND THE OWNER ROLE. The helpers' reads skip the nested policies only
--   -- while the owner owns the table and FORCE is off (or the owner role has BYPASSRLS). Expected: every row ok.
--   -- Prints no secret: names, booleans and a verdict.
--   SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced,
--          r.rolbypassrls AS owner_bypasses_rls, r.rolsuper AS owner_is_superuser, r.rolcanlogin AS owner_can_log_in,
--          CASE WHEN pg_get_userbyid(c.relowner) = 'prep_app_owner' AND NOT c.relforcerowsecurity THEN 'ok' ELSE 'LOOK' END AS verdict
--     FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--    WHERE c.relnamespace = 'app'::regnamespace
--      AND c.relname IN ('activities', 'assignments', 'offering_activities', 'assignment_offerings',
--                        'questions', 'question_keys', 'instructors', 'staff_assignments', 'courses', 'course_offerings')
--    ORDER BY 1;
--
--   -- the seven functions: owner prep_app_owner, search_path pinned, and the SECURITY MODE judged: the four set
--   -- helpers are security definer (true), the two save functions and the stamp are security invoker (false).
--   -- Expected: seven rows, every row ok. (Corrected 2026-11-05: the first text of this query did not judge the mode.)
--   SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
--          array_to_string(p.proconfig, ', ') AS stored_path,
--          CASE WHEN pg_get_userbyid(p.proowner) = 'prep_app_owner'
--                AND p.proconfig::text LIKE '%search_path=app, pg_temp%'
--                AND p.prosecdef = (p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids',
--                                                 'directed_question_ids', 'staff_visible_question_ids'))
--               THEN 'ok' ELSE 'LOOK' END AS verdict
--     FROM pg_proc p
--    WHERE p.pronamespace = 'app'::regnamespace
--      AND p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids', 'directed_question_ids',
--                        'staff_visible_question_ids', 'save_letter_scale', 'save_question', 'letter_scales_stamp')
--    ORDER BY 1;
--
--   -- a known director still reads questions (run as that person's session; expect more than zero)
--   --   SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<director id>"}', true);
--   --   SELECT count(*) FROM app.questions;

-- =====================================================================================
-- OTHER POLICIES WITH THE SAME NESTED SHAPE (found 2026-11-05, not changed here)
-- =====================================================================================
-- A policy whose subquery reads another table that has its own policy pays for that table's policy too.
--   activities_write       over assignments            same cost pattern; a different question, so needs its own helper
--   offering_activities    oa_write over assignment_offerings (director_offerings)
--   key_remark_runs_read_staff   over questions, offering_activities, assignment_offerings. Its rule has no director
--                          branch, so the helpers here do NOT fit it without a change of meaning. Left alone.
--   assignment_due_dates due_write, students_write, enrollments_write, submission_activities (sa_*), submissions_staff_update,
--   extensions_staff_write, grades_staff_write, grade_excusals_*, student_group_*_write_director, ei_sessions_staff_write
-- The write policies run on single rows from the pages that use them and were not measured to cross the 8 second
-- limit; measure one before changing it.
--
-- WHAT STAYS TRUE AFTER THIS FILE (recorded so the next operator does not have to find it)
--   * A director can still edit or delete a key row in place through the API (policy question_keys_write_director is
--     FOR ALL, as 030 wrote it). "Older versions are kept" is how the page and save_question behave, not a rule of
--     the table. A rule of the table would be a later, separate change.
--   * The four set helpers are callable by every signed-in user over the API. They take no argument, read the caller
--     from the sign-in and return only ids of rows that person can already read. The grant cannot be removed: a
--     policy checks the invoking role's EXECUTE.
