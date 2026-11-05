-- Rollback for 067_publish_closes_column.sql. Run as `prep_app_owner`.
-- Puts publish_preview, publish_column (three arguments), unpublish_column and the closure trigger function back as
-- migrations 065 and 034 left them, drops the two helper readers, and drops column_closures.closed_by_publish.
--
-- WHAT IS LOST: the marker. After this file every open closure is an ordinary closure, and the old unpublish reopens
-- any of them, as it did before 067. A closure row itself is never removed, so no column changes between closed and
-- open and no total moves. Columns that 067 closed on publish stay closed.
-- ORDER: roll back the site release that sends a fingerprint first (the old function has no such argument, so the
-- page's call would not resolve). Newest first: this file before 066's.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP FUNCTION IF EXISTS publish_column(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS _publish_blanks(uuid, uuid[]);
DROP FUNCTION IF EXISTS _publish_missing(uuid, uuid[]);

CREATE OR REPLACE FUNCTION publish_preview(p_offering uuid, p_section uuid DEFAULT NULL)
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

CREATE OR REPLACE FUNCTION unpublish_column(p_offering uuid, p_section uuid DEFAULT NULL, p_reopen boolean DEFAULT true)
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

CREATE OR REPLACE FUNCTION column_closures_stamp() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_actor uuid := current_uid();
  v_sec_co uuid;
  v_ao_co  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.course_offering_id INTO v_sec_co FROM sections s WHERE s.id = NEW.section_id;
    SELECT ao.course_offering_id INTO v_ao_co FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
    IF v_sec_co IS DISTINCT FROM v_ao_co THEN
      RAISE EXCEPTION 'a column closure must join a section and an item of the same course offering'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_by := coalesce(v_actor, NEW.closed_by);
    NEW.closed_at := now();
    NEW.reopened_at := NULL;
    NEW.reopened_by := NULL;
  ELSE
    -- removing an instructor sets closed_by or reopened_by to NULL (trigger depth 2 or more); nothing else moves
    IF pg_trigger_depth() >= 2
       AND NEW.assignment_offering_id IS NOT DISTINCT FROM OLD.assignment_offering_id
       AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id
       AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
       AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at
       AND (NEW.closed_by IS NULL OR NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by)
       AND (NEW.reopened_by IS NULL OR NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by) THEN
      RETURN NEW;
    END IF;
    IF NEW.assignment_offering_id IS DISTINCT FROM OLD.assignment_offering_id
       OR NEW.section_id IS DISTINCT FROM OLD.section_id
       OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'a column closure can only be reopened; its other fields do not change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.reopened_at IS NOT NULL THEN
      RAISE EXCEPTION 'this column closure is already reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reopened_at IS NOT NULL THEN
      NEW.reopened_at := now();
      NEW.reopened_by := coalesce(v_actor, NEW.reopened_by);
    END IF;
  END IF;
  RETURN NEW;
END; $$;


ALTER TABLE column_closures DROP COLUMN IF EXISTS closed_by_publish;

REVOKE ALL ON FUNCTION publish_preview(uuid, uuid)              FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION publish_column(uuid, uuid, boolean)      FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION unpublish_column(uuid, uuid, boolean)    FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION publish_preview(uuid, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION publish_column(uuid, uuid, boolean)      TO authenticated;
GRANT EXECUTE ON FUNCTION unpublish_column(uuid, uuid, boolean)    TO authenticated;

COMMIT;
