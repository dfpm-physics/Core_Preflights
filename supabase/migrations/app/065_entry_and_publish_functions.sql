-- PREP v2 step 2 -- score entry, column publishing, and the two staff total functions
-- =====================================================================================
-- Run as `prep_app_owner`, under the coordination gate. Depends on 001 (grades), 034 (column_closures),
-- 039 (gradebook_cells, course_totals) and the helpers current_uid() and staff_sections().
--
-- WHAT IT ADDS
--   enter_grades(p_offering, p_rows, p_source, p_allow_published)    -> jsonb { saved, replaced_published }
--       Writes a batch of hand-entered or imported scores for ONE item, all or nothing. SECURITY INVOKER, so
--       the existing grade policies decide who may write, and the function adds its own refusals:
--       a row whose grade changed since the page read it (the page sends the version it saw); a score that is
--       not a plain number with at most two decimals (NaN, infinity, an exponent and text are refused here, not
--       only by the page); a score below zero, above 9999.99, or above the item's points (a bonus item excepted);
--       and a published grade, unless the caller says so. It stores draft scores. Publishing is a separate step.
--       The result says how many of the saved scores REPLACED a published one, which are live to students the
--       moment they are saved.
--   publish_preview(p_offering, p_section)                           -> jsonb
--       Read only. What publish_column would do right now, from the same rules: whether the item is published to
--       students, how many drafts it would publish, how many AI-suggested drafts it would leave out, and whether
--       it would also close the column. The page prints these; it holds no copy of the rule.
--   publish_column(p_offering, p_section, p_close)                   -> jsonb { published, closed, held_ai, close_applies }
--       Publishes the HAND-ENTERED or IMPORTED drafts of one item for the caller's sections (or one section), and
--       closes the column when p_close is true AND the item takes no submission (the same test the total rule
--       uses, so the page cannot disagree with it). It refuses an item that is not published to students, and
--       an item with no hand-entered or imported path. A draft whose source is anything else (an AI suggestion,
--       a derived or auto-checked score) is NEVER finalized here: a person reviews those on the grade page.
--       held_ai counts them so the page can say so.
--   unpublish_column(p_offering, p_section, p_reopen)                -> jsonb { unpublished, reopened }
--       The undo of publish_column: puts the hand-entered or imported scores of one item back to drafts for the
--       caller's sections (or one section) and, unless p_reopen is false, reopens the column there, in one call.
--   grades_points_not_nan (a CHECK on grades.points_earned)
--       A score that is not a number cannot be stored by any writer. Added NOT VALID, then validated.
--   GRANT EXECUTE on gradebook_cells and course_totals to authenticated. Both check their own caller (staff of
--       the offering, or the student for their own cells). my_course_total stays ungranted here.
--
-- GRANTS THAT ARE SHARED WITH MIGRATION 060 (the student pages)
--   gradebook_cells(uuid, text) is granted to authenticated by BOTH this file and 060. The GRANT is idempotent in
--   each. Neither rollback revokes it: 060's rollback revokes only my_course_total, this file's rollback revokes
--   only course_totals, because each is the only file that grants that function. If both are rolled back, the
--   gradebook_cells grant stays behind (harmless: the function checks its caller) and is removed by hand:
--   REVOKE EXECUTE ON FUNCTION app.gradebook_cells(uuid, text) FROM authenticated;
--
-- WHAT IT DOES NOT DO
--   It does not touch excusals: only a Director can set one, and that is the existing policy on
--   grade_excusals (033), unchanged. It does not remove the step 1 rules that keep new items unpublished and
--   unfinalized, so publish_column is refused on such an item until those rules come out.
--   It does not change how a section transfer treats a blank: the column closure belongs to a section, so a
--   cadet moved between a closed and an open section changes between a counted 0 and a left-out blank. That
--   belongs in the total rule and is a decision for the course director, not a side effect of this file.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- A score that is not a number cannot be stored. NaN passes every ordinary comparison check, so it needs its own.
ALTER TABLE grades ADD CONSTRAINT grades_points_not_nan
  CHECK (points_earned IS NULL OR points_earned <> 'NaN'::numeric) NOT VALID;
ALTER TABLE grades VALIDATE CONSTRAINT grades_points_not_nan;

CREATE FUNCTION enter_grades(p_offering uuid, p_rows jsonb,
                             p_source text DEFAULT 'instructor', p_allow_published boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_ao    record;
  r       record;
  v_old   record;
  v_pts   numeric;
  v_txt   text;
  v_n     integer := 0;
  v_repl  integer := 0;
  v_actor uuid := current_uid();
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('instructor', 'imported') THEN
    RAISE EXCEPTION 'enter_grades: source must be instructor or imported' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'enter_grades: rows must be a list' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_rows) > 3000 THEN
    RAISE EXCEPTION 'enter_grades: at most 3000 rows in one call' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ao.id, ao.course_offering_id, ao.points_possible, ao.is_bonus, ao.allow_over_max
    INTO v_ao FROM assignment_offerings ao WHERE ao.id = p_offering;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enter_grades: item not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF (SELECT count(DISTINCT x ->> 'enrollment_id') FROM jsonb_array_elements(p_rows) x)
     <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'enter_grades: a cadet appears twice in the rows' USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN SELECT (x ->> 'enrollment_id')::uuid AS enr, x ->> 'points' AS pts, x ->> 'expect' AS expect
             FROM jsonb_array_elements(p_rows) x
  LOOP
    v_txt := btrim(r.pts);
    IF v_txt IS NULL OR v_txt = '' THEN
      v_pts := NULL;
    ELSE
      -- The text is checked BEFORE it is cast. 'NaN', 'Infinity' and '1e1' all cast to numeric, and NaN then passes
      -- every comparison below, so the shape of the text is the only reliable gate.
      IF v_txt !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'enter_grades: a score is not a plain number' USING ERRCODE = 'check_violation';
      END IF;
      v_pts := v_txt::numeric;
      IF v_pts <> round(v_pts, 2) THEN
        RAISE EXCEPTION 'enter_grades: a score has more than two decimals' USING ERRCODE = 'check_violation';
      END IF;
      IF v_pts < 0 THEN
        RAISE EXCEPTION 'enter_grades: a score is below zero' USING ERRCODE = 'check_violation';
      END IF;
      IF v_pts > 9999.99 THEN
        RAISE EXCEPTION 'enter_grades: a score is too large' USING ERRCODE = 'check_violation';
      END IF;
      IF v_pts > v_ao.points_possible AND NOT (v_ao.is_bonus OR v_ao.allow_over_max) THEN
        RAISE EXCEPTION 'enter_grades: a score is above the item''s points' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM enrollments e JOIN sections s ON s.id = e.section_id
                    WHERE e.id = r.enr AND s.course_offering_id = v_ao.course_offering_id
                      AND e.section_id IN (SELECT staff_sections())
                      AND e.status IN ('active', 'completed')) THEN
      RAISE EXCEPTION 'enter_grades: a cadet is not an enrolled cadet of one of your sections in this course'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT g.id, g.updated_at, g.is_finalized INTO v_old
      FROM grades g WHERE g.enrollment_id = r.enr AND g.assignment_offering_id = p_offering FOR UPDATE;
    IF FOUND THEN
      IF r.expect IS NULL OR v_old.updated_at <> r.expect::timestamptz THEN
        RAISE EXCEPTION 'enter_grades: a grade changed since you read it; reload and look again'
          USING ERRCODE = 'serialization_failure';
      END IF;
      IF v_old.is_finalized AND NOT p_allow_published THEN
        RAISE EXCEPTION 'enter_grades: a grade is already published; confirm to replace it'
          USING ERRCODE = 'check_violation';
      END IF;
      UPDATE grades SET points_earned = v_pts, points_possible = v_ao.points_possible, source = p_source,
                        graded_by = v_actor, graded_at = now()
       WHERE id = v_old.id;
      IF v_old.is_finalized THEN v_repl := v_repl + 1; END IF;
    ELSE
      IF r.expect IS NOT NULL THEN
        RAISE EXCEPTION 'enter_grades: a grade was removed since you read it; reload and look again'
          USING ERRCODE = 'serialization_failure';
      END IF;
      INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source,
                          is_finalized, graded_by, graded_at)
      VALUES (r.enr, p_offering, v_pts, v_ao.points_possible, p_source, false, v_actor, now());
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('saved', v_n, 'replaced_published', v_repl);
END; $$;

-- The facts publish_column and unpublish_column act on, in one place so a preview cannot drift from the action.
CREATE FUNCTION publish_preview(p_offering uuid, p_section uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_ao     record;
  v_secs   uuid[];
  v_hand   boolean;
  v_nosub  boolean;
  v_drafts integer;
  v_ai     integer;
  v_live   integer;
  v_open   integer;
BEGIN
  SELECT ao.id, ao.course_offering_id, ao.is_published INTO v_ao FROM assignment_offerings ao WHERE ao.id = p_offering;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publish_preview: item not found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT array_agg(s.id) INTO v_secs FROM sections s
   WHERE s.course_offering_id = v_ao.course_offering_id AND s.id IN (SELECT staff_sections())
     AND (p_section IS NULL OR s.id = p_section);
  IF v_secs IS NULL THEN
    RAISE EXCEPTION 'publish_preview: none of your sections matches' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (SELECT 1 FROM offering_activities oa WHERE oa.assignment_offering_id = p_offering
                  AND oa.grading IN ('hand_entered', 'imported')) INTO v_hand;
  -- the same test _cells_at uses for "this item takes no submission" (039)
  SELECT EXISTS (SELECT 1 FROM offering_activities oa JOIN activities a ON a.id = oa.activity_id
                  WHERE oa.assignment_offering_id = p_offering AND oa.grading_role = 'graded'
                    AND (a.modality = 'external' OR oa.delivery IN ('in_person', 'elsewhere'))) INTO v_nosub;

  SELECT count(*) FILTER (WHERE NOT g.is_finalized AND g.source IN ('instructor', 'imported')),
         count(*) FILTER (WHERE NOT g.is_finalized AND g.source NOT IN ('instructor', 'imported')),
         count(*) FILTER (WHERE g.is_finalized AND g.source IN ('instructor', 'imported'))
    INTO v_drafts, v_ai, v_live
    FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
   WHERE g.assignment_offering_id = p_offering AND e.section_id = ANY (v_secs)
     AND e.status IN ('active', 'completed') AND g.points_earned IS NOT NULL;

  SELECT count(*) INTO v_open FROM unnest(v_secs) s
   WHERE NOT EXISTS (SELECT 1 FROM column_closures c
                      WHERE c.assignment_offering_id = p_offering AND c.section_id = s AND c.reopened_at IS NULL);

  RETURN jsonb_build_object('item_published', v_ao.is_published, 'hand_entered', v_hand,
                            'drafts', v_drafts, 'held_ai', v_ai, 'live', v_live,
                            'close_applies', v_nosub, 'open_sections', v_open, 'sections', cardinality(v_secs));
END; $$;

CREATE FUNCTION publish_column(p_offering uuid, p_section uuid DEFAULT NULL, p_close boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_pre   jsonb := publish_preview(p_offering, p_section);   -- also refuses an unknown item or a stranger
  v_secs  uuid[];
  v_pub   integer;
  v_close integer := 0;
  v_actor uuid := current_uid();
BEGIN
  IF NOT (v_pre ->> 'item_published')::boolean THEN
    RAISE EXCEPTION 'publish_column: this item is not published to students yet, so publishing its scores would show them nothing'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (v_pre ->> 'hand_entered')::boolean THEN
    RAISE EXCEPTION 'publish_column: this item is not entered by hand or by import; its scores are published from the grade page'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(s.id) INTO v_secs FROM sections s
   WHERE s.course_offering_id = (SELECT ao.course_offering_id FROM assignment_offerings ao WHERE ao.id = p_offering)
     AND s.id IN (SELECT staff_sections()) AND (p_section IS NULL OR s.id = p_section);

  -- Only a person's scores. An AI suggestion (or a derived or auto-checked score) waits for a person to look at it.
  UPDATE grades g SET is_finalized = true, graded_by = coalesce(g.graded_by, v_actor), graded_at = coalesce(g.graded_at, now())
    FROM enrollments e
   WHERE g.assignment_offering_id = p_offering AND g.enrollment_id = e.id AND e.section_id = ANY (v_secs)
     AND e.status IN ('active', 'completed')
     AND g.points_earned IS NOT NULL AND NOT g.is_finalized AND g.source IN ('instructor', 'imported');
  GET DIAGNOSTICS v_pub = ROW_COUNT;

  IF p_close AND (v_pre ->> 'close_applies')::boolean THEN
    INSERT INTO column_closures (assignment_offering_id, section_id)
    SELECT p_offering, s FROM unnest(v_secs) s
     WHERE NOT EXISTS (SELECT 1 FROM column_closures c
                        WHERE c.assignment_offering_id = p_offering AND c.section_id = s AND c.reopened_at IS NULL);
    GET DIAGNOSTICS v_close = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('published', v_pub, 'closed', v_close, 'held_ai', (v_pre ->> 'held_ai')::integer,
                            'close_applies', (v_pre ->> 'close_applies')::boolean);
END; $$;

CREATE FUNCTION unpublish_column(p_offering uuid, p_section uuid DEFAULT NULL, p_reopen boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_pre    jsonb := publish_preview(p_offering, p_section);
  v_secs   uuid[];
  v_unpub  integer;
  v_reopen integer := 0;
BEGIN
  IF NOT (v_pre ->> 'hand_entered')::boolean THEN
    RAISE EXCEPTION 'unpublish_column: this item is not entered by hand or by import' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(s.id) INTO v_secs FROM sections s
   WHERE s.course_offering_id = (SELECT ao.course_offering_id FROM assignment_offerings ao WHERE ao.id = p_offering)
     AND s.id IN (SELECT staff_sections()) AND (p_section IS NULL OR s.id = p_section);

  UPDATE grades g SET is_finalized = false
    FROM enrollments e
   WHERE g.assignment_offering_id = p_offering AND g.enrollment_id = e.id AND e.section_id = ANY (v_secs)
     AND g.is_finalized AND g.source IN ('instructor', 'imported');
  GET DIAGNOSTICS v_unpub = ROW_COUNT;

  IF p_reopen THEN
    UPDATE column_closures c SET reopened_at = now()
     WHERE c.assignment_offering_id = p_offering AND c.section_id = ANY (v_secs) AND c.reopened_at IS NULL;
    GET DIAGNOSTICS v_reopen = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('unpublished', v_unpub, 'reopened', v_reopen);
END; $$;

REVOKE ALL ON FUNCTION enter_grades(uuid, jsonb, text, boolean) FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION publish_preview(uuid, uuid)              FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION publish_column(uuid, uuid, boolean)      FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION unpublish_column(uuid, uuid, boolean)    FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION enter_grades(uuid, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION publish_preview(uuid, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION publish_column(uuid, uuid, boolean)      TO authenticated;
GRANT EXECUTE ON FUNCTION unpublish_column(uuid, uuid, boolean)    TO authenticated;
GRANT EXECUTE ON FUNCTION gradebook_cells(uuid, text) TO authenticated;   -- also granted by 060; idempotent
GRANT EXECUTE ON FUNCTION course_totals(uuid, text)   TO authenticated;

COMMIT;

-- VERIFY (read-only)
--   SELECT has_function_privilege('anon', 'app.enter_grades(uuid,jsonb,text,boolean)', 'EXECUTE');   -- false
--   SELECT has_function_privilege('authenticated', 'app.course_totals(uuid,text)', 'EXECUTE');       -- true
--   SELECT convalidated FROM pg_constraint WHERE conname = 'grades_points_not_nan';                  -- true
