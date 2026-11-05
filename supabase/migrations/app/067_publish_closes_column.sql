-- PREP v2 step 2 -- publishing a no-submission column closes it, and unpublishing reopens only what the publish closed
-- =====================================================================================
-- Run as `prep_app_owner`, under the coordination gate. Depends on 034 (column_closures), 039 (_cells_at), 065 (the
-- publish functions) and 066 (closure_carry). Numbered 067, not earlier, because it replaces functions that 065
-- creates and the chain applies in number order.
-- Design: docs/decisions/V2-DATA-MODEL.md section 0 (decision 1, changed 2026-11-05) and section 7.
--
-- THE RULE IT ENFORCES
--   Publishing a column of an item that takes no submission (in person or Gradescope) for a section also closes that
--   column for that section, in the same transaction. Every blank in it becomes Missing and counts 0. A cadet whose
--   active extension has not passed still waits until that date. Without this, a cadet with 10 of 10 on one item and
--   nine published no-submission items still blank showed 100%, because a blank left the total until a person closed
--   the column. Submitted-and-ungraded work still stays out of the total; nothing here changes that.
--
-- WHAT IT CHANGES
--   column_closures.closed_by_publish   boolean, default false. TRUE only on a row that publish_column inserted.
--       The marker is set by the closure trigger from a transaction-local setting that only publish_column sets, so a
--       row written any other way (by hand, by a script) is never marked. The trigger refuses a later change to it.
--       Rows that exist before this file are not marked: they were closed by hand or by an earlier publish, and
--       there is no record of which, so unpublish leaves them closed.
--   _publish_blanks(item, sections)     definer. The cadets the closure would move from "not counted" to
--       Missing, with a flag for those waiting on an extension. Read from the cell rule (_cells_at), so the list and
--       the total cannot disagree about who counts.
--   _publish_missing(item, sections)    definer. The cadets whose cell is Missing now. publish_column reads it
--       before and after the closure, and reports the difference as `zeroed`, the number that actually changed.
--   publish_preview     (replaced, same signature)  adds blank_count, blank_cadets, waiting_count, fingerprint,
--       publish_closed_sections and hand_closed_sections. The fingerprint is a hash of everything the publish would
--       act on: the drafts it would publish (id and last change), the sections it would close, the blank list and
--       the waiting list, the held AI drafts.
--   publish_column(uuid, uuid, boolean, text)  (REPLACES publish_column(uuid, uuid, boolean))
--       A fourth argument, the fingerprint the page was shown. A publish that would zero any blank REFUSES without
--       one, and any publish REFUSES with one that no longer matches: the column changed after the preview, so read
--       it again. The third argument is kept so an old caller still resolves, and is IGNORED: publishing always closes
--       a no-submission column. The result gains `zeroed`.
--   unpublish_column    (replaced, same signature)  reopens only closures with closed_by_publish. A column closed any
--       other way stays closed, and `kept_closed` counts them so the page can say so.
--
-- WHAT IT DOES NOT DO
--   It does not change _cells_at, a total, a score, a deadline or an extension, and it does not touch an item that
--   takes a submission (its blank is Missing only once the deadline passes, as before). It does not close a column
--   for a section the caller cannot see. It does not backfill: closures made before this file stay unmarked.
--
-- GRANTS  The two helpers are granted to authenticated and to no other API role, because publish_preview runs as the
--         caller and has to reach them. Each checks the caller's own sections, so a call returns only cadets the
--         caller can already read. publish_column's new signature is granted to authenticated, as the old one was.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE column_closures ADD COLUMN closed_by_publish boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN column_closures.closed_by_publish IS
  'True only when publish_column inserted this row. Unpublish reopens only these; a closure made any other way stays '
  'closed. Set by the trigger from a transaction-local setting, never from the row a caller sends.';

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
    -- the marker comes from publish_column's own setting for THIS item, never from what the caller sent
    NEW.closed_by_publish := coalesce(current_setting('app.publishing_item', true) = NEW.assignment_offering_id::text, false);
  ELSE
    -- removing an instructor sets closed_by or reopened_by to NULL (trigger depth 2 or more); nothing else moves
    IF pg_trigger_depth() >= 2
       AND NEW.assignment_offering_id IS NOT DISTINCT FROM OLD.assignment_offering_id
       AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id
       AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
       AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at
       AND NEW.closed_by_publish IS NOT DISTINCT FROM OLD.closed_by_publish
       AND (NEW.closed_by IS NULL OR NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by)
       AND (NEW.reopened_by IS NULL OR NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by) THEN
      RETURN NEW;
    END IF;
    IF NEW.assignment_offering_id IS DISTINCT FROM OLD.assignment_offering_id
       OR NEW.section_id IS DISTINCT FROM OLD.section_id
       OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
       OR NEW.closed_by_publish IS DISTINCT FROM OLD.closed_by_publish THEN
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

-- ---- the two internal readers --------------------------------------------------------------------------------
CREATE FUNCTION _publish_blanks(p_offering uuid, p_secs uuid[])
RETURNS TABLE (enrollment_id uuid, section_id uuid, waits boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  -- A cell that closing the column moves to Missing: not excused, not bonus, no score, no committed work, not already
  -- counted (its section has no open closure and it carries no closed state from a transfer). Whether it waits is the
  -- same test the cell rule uses: an extension that has not passed (the 120 second grace is the rule's own).
  SELECT c.enrollment_id, c.section_id,
         (c.deadline_source = 'extension' AND NOT (c.due_at IS NOT NULL AND now() - c.due_at > interval '120 seconds'))
    FROM _cells_at((SELECT ao.course_offering_id FROM assignment_offerings ao WHERE ao.id = p_offering), 'final', now()) c
   WHERE c.assignment_offering_id = p_offering
     AND c.section_id = ANY (p_secs) AND c.section_id IN (SELECT staff_sections())
     AND c.state IN ('submitted_ungraded', 'in_progress', 'not_due')
     AND NOT c.is_bonus AND c.points_earned IS NULL
     AND NOT EXISTS (SELECT 1 FROM submissions sub WHERE sub.enrollment_id = c.enrollment_id
                        AND sub.assignment_offering_id = p_offering AND sub.status = 'committed')
     AND NOT EXISTS (SELECT 1 FROM column_closures cc WHERE cc.assignment_offering_id = p_offering
                        AND cc.section_id = c.section_id AND cc.reopened_at IS NULL)
     AND NOT coalesce((SELECT cy.closed FROM closure_carry cy
                        WHERE cy.enrollment_id = c.enrollment_id AND cy.assignment_offering_id = p_offering), false);
$$;

CREATE FUNCTION _publish_missing(p_offering uuid, p_secs uuid[])
RETURNS TABLE (enrollment_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT c.enrollment_id
    FROM _cells_at((SELECT ao.course_offering_id FROM assignment_offerings ao WHERE ao.id = p_offering), 'final', now()) c
   WHERE c.assignment_offering_id = p_offering
     AND c.section_id = ANY (p_secs) AND c.section_id IN (SELECT staff_sections())
     AND c.state = 'missing';
$$;

-- ---- the preview ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_preview(p_offering uuid, p_section uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_ao       record;
  v_secs     uuid[];
  v_hand     boolean;
  v_nosub    boolean;
  v_drafts   integer;
  v_ai       integer;
  v_live     integer;
  v_open     integer;
  v_open_ids jsonb;
  v_draft_ids jsonb;
  v_blank    jsonb := '[]'::jsonb;
  v_nblank   integer := 0;
  v_wait     jsonb := '[]'::jsonb;
  v_pubclosed integer;
  v_handclosed integer;
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
         count(*) FILTER (WHERE g.is_finalized AND g.source IN ('instructor', 'imported')),
         coalesce(jsonb_agg(jsonb_build_array(g.id, g.updated_at) ORDER BY g.id)
                  FILTER (WHERE NOT g.is_finalized AND g.source IN ('instructor', 'imported')), '[]'::jsonb)
    INTO v_drafts, v_ai, v_live, v_draft_ids
    FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
   WHERE g.assignment_offering_id = p_offering AND e.section_id = ANY (v_secs)
     AND e.status IN ('active', 'completed') AND g.points_earned IS NOT NULL;

  SELECT count(*), coalesce(jsonb_agg(s ORDER BY s), '[]'::jsonb) INTO v_open, v_open_ids FROM unnest(v_secs) s
   WHERE NOT EXISTS (SELECT 1 FROM column_closures c
                      WHERE c.assignment_offering_id = p_offering AND c.section_id = s AND c.reopened_at IS NULL);

  SELECT count(*) FILTER (WHERE c.closed_by_publish), count(*) FILTER (WHERE NOT c.closed_by_publish)
    INTO v_pubclosed, v_handclosed
    FROM column_closures c
   WHERE c.assignment_offering_id = p_offering AND c.section_id = ANY (v_secs) AND c.reopened_at IS NULL;

  IF v_nosub THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('enrollment_id', b.enrollment_id, 'section_id', b.section_id)
                              ORDER BY b.enrollment_id) FILTER (WHERE NOT b.waits), '[]'::jsonb),
           count(*) FILTER (WHERE NOT b.waits),
           coalesce(jsonb_agg(b.enrollment_id ORDER BY b.enrollment_id) FILTER (WHERE b.waits), '[]'::jsonb)
      INTO v_blank, v_nblank, v_wait
      FROM _publish_blanks(p_offering, v_secs) b;
  END IF;

  RETURN jsonb_build_object(
    'item_published', v_ao.is_published, 'hand_entered', v_hand,
    'drafts', v_drafts, 'held_ai', v_ai, 'live', v_live,
    'close_applies', v_nosub, 'open_sections', v_open, 'sections', cardinality(v_secs),
    'blank_count', v_nblank, 'blank_cadets', v_blank, 'waiting_count', jsonb_array_length(v_wait),
    'publish_closed_sections', v_pubclosed, 'hand_closed_sections', v_handclosed,
    -- everything the publish would act on, so a change after the preview makes this value different
    'fingerprint', md5(jsonb_build_object(
        'item', p_offering, 'drafts', v_draft_ids, 'held_ai', v_ai, 'close', v_nosub,
        'open', v_open_ids, 'blank', v_blank, 'waiting', v_wait)::text));
END; $$;

-- ---- publish ----------------------------------------------------------------------------------------------------
DROP FUNCTION publish_column(uuid, uuid, boolean);

CREATE FUNCTION publish_column(p_offering uuid, p_section uuid DEFAULT NULL, p_close boolean DEFAULT false,
                               p_fingerprint text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_pre    jsonb := publish_preview(p_offering, p_section);   -- also refuses an unknown item or a stranger
  v_secs   uuid[];
  v_pub    integer;
  v_close  integer := 0;
  v_zeroed integer := 0;
  v_before uuid[];
  v_actor  uuid := current_uid();
BEGIN
  IF NOT (v_pre ->> 'item_published')::boolean THEN
    RAISE EXCEPTION 'publish_column: this item is not published to students yet, so publishing its scores would show them nothing'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (v_pre ->> 'hand_entered')::boolean THEN
    RAISE EXCEPTION 'publish_column: this item is not entered by hand or by import; its scores are published from the grade page'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_fingerprint IS NULL AND (v_pre ->> 'blank_count')::integer > 0 THEN
    RAISE EXCEPTION 'publish_column: this publish would count % blank score(s) as 0; read the preview and confirm it first',
      v_pre ->> 'blank_count' USING ERRCODE = 'check_violation';
  END IF;
  IF p_fingerprint IS NOT NULL AND p_fingerprint <> (v_pre ->> 'fingerprint') THEN
    RAISE EXCEPTION 'publish_column: the column changed since you read the preview; read it again'
      USING ERRCODE = 'serialization_failure';
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

  -- Publishing a no-submission column closes it for the section, in this transaction. p_close is not read.
  IF (v_pre ->> 'close_applies')::boolean THEN
    SELECT coalesce(array_agg(m.enrollment_id), '{}') INTO v_before FROM _publish_missing(p_offering, v_secs) m;
    PERFORM set_config('app.publishing_item', p_offering::text, true);
    INSERT INTO column_closures (assignment_offering_id, section_id)
    SELECT p_offering, s FROM unnest(v_secs) s
     WHERE NOT EXISTS (SELECT 1 FROM column_closures c
                        WHERE c.assignment_offering_id = p_offering AND c.section_id = s AND c.reopened_at IS NULL);
    GET DIAGNOSTICS v_close = ROW_COUNT;
    PERFORM set_config('app.publishing_item', '', true);
    SELECT count(*) INTO v_zeroed FROM _publish_missing(p_offering, v_secs) m WHERE m.enrollment_id <> ALL (v_before);
  END IF;
  RETURN jsonb_build_object('published', v_pub, 'closed', v_close, 'zeroed', v_zeroed,
                            'held_ai', (v_pre ->> 'held_ai')::integer,
                            'close_applies', (v_pre ->> 'close_applies')::boolean);
END; $$;

-- ---- unpublish ---------------------------------------------------------------------------------------------------
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
  v_kept   integer := 0;
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
    -- only what a publish closed; a column closed any other way stays closed
    UPDATE column_closures c SET reopened_at = now()
     WHERE c.assignment_offering_id = p_offering AND c.section_id = ANY (v_secs) AND c.reopened_at IS NULL
       AND c.closed_by_publish;
    GET DIAGNOSTICS v_reopen = ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_kept FROM column_closures c
   WHERE c.assignment_offering_id = p_offering AND c.section_id = ANY (v_secs) AND c.reopened_at IS NULL;
  RETURN jsonb_build_object('unpublished', v_unpub, 'reopened', v_reopen, 'kept_closed', v_kept);
END; $$;

REVOKE ALL ON FUNCTION _publish_blanks(uuid, uuid[])  FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _publish_missing(uuid, uuid[]) FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION _publish_blanks(uuid, uuid[])  TO authenticated;
GRANT EXECUTE ON FUNCTION _publish_missing(uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION publish_column(uuid, uuid, boolean, text) FROM PUBLIC, anon, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION publish_column(uuid, uuid, boolean, text) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT count(*) FROM app.column_closures WHERE closed_by_publish;                                   -- 0 until a publish closes a column
--   SELECT has_function_privilege('authenticated', 'app.publish_column(uuid,uuid,boolean,text)', 'EXECUTE'); -- true
--   SELECT has_function_privilege('anon', 'app._publish_blanks(uuid,uuid[])', 'EXECUTE');                    -- false
