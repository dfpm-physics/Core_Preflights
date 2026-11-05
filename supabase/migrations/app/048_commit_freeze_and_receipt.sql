-- 048_commit_freeze_and_receipt.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- WHAT IT ENFORCES  (review items E1, E5 and E20)
--   1. SUBMITTING IS ONE SERVER OPERATION. `commit_work()` checks the cadet's enrollment and that the item has
--      opened, decides on-time or late from the SERVER clock and the deadline rule of 038 (an extension counts,
--      the 120 second grace applies), stores the report, marks the answers final, commits the submission, stamps
--      the commit time, and writes a receipt (content hash, time, late mark, actor) in one transaction. A second
--      call for work already committed changes nothing and returns the first receipt.
--   2. A COMMIT TIME IS NEVER TAKEN FROM A REQUEST. For a request arriving as `anon` or `authenticated`
--      (the API roles), a row cannot be inserted already committed, cannot become committed except through
--      commit_work(), and a committed row's commit time and chosen activity cannot change. A staff reopen
--      (committed back to draft, attributed as in 006) still works, and the cadet then commits again.
--   3. WORK IS FROZEN AFTER COMMIT. For the API roles, an answer row of a committed submission cannot be inserted,
--      edited or deleted. save_interactive_work() (047) refuses to replace the report of the activity that carries
--      credit once it is committed; a practice report on the same assignment can still be saved.
--      commit_work() and save_interactive_work() also refuse a second report for an effort-graded item while a finalized
--      grade of that item stands (read from `grades` by the server, so a grade held back from the cadet still counts),
--      and refuse an item that has not opened. A refusal for a missed deadline names the deadline, in Mountain time.
--   4. LATE WORK. Past the deadline plus grace, commit_work() refuses unless the item allows late work
--      (`late_allowed`, 028), and then refuses after the last class day of the term (`late_close_at`, 038); inside
--      those limits it commits and marks the receipt late. No points are taken off: the late mark is information.
--      A deadline that cannot be read (source `none`) commits as on time; the exception list shows the bad data.
--   5. NO RE-FIRE. The interactive auto-grade of 015 runs when a submission BECOMES committed or its chosen activity
--      changes, no longer on every update of a row that is already committed.
--   6. TWO TABS. save_written_answers() merges only the answers a tab changed into the stored ones, atomically, so a
--      stale second tab cannot blank what the first saved. It refuses once the work is committed.
--   7. my_lesson_opens_at(slug): when a lesson held back from the caller opens (an early artifact link says so).
--
-- LIMITS, STATED PLAINLY
--   * The interactive tutor runs on claude.ai; no server sees the session. The report and its effort arrive in a
--     link the cadet's own browser holds. This stops writing a grade directly, committing twice, editing after
--     commit and a false clock. It cannot prove the effort was real: a cadet can still send any report through
--     commit_work(). Only the first committed report counts.
--   * The server clock decides. A cadet whose commit lands inside the 120 second grace is on time.
--   * Work committed before this migration has no receipt. Calling commit_work() for it changes nothing.
--   * Not changed here: the grade write rules, who may read what, the deadline rule, the artifact link format.
--   * A staff reopen is unchanged and is the only way back from committed.
--
-- Rollback: rollback/048_commit_freeze_and_receipt_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
BEGIN
  IF to_regprocedure('app._effective_core(uuid, uuid)') IS NULL
     OR to_regprocedure('app.late_close_at(uuid)') IS NULL
     OR to_regprocedure('app.my_released_assignment_offerings()') IS NULL
     OR to_regclass('app.submission_receipts') IS NULL THEN
    RAISE EXCEPTION '048 needs 031, 038 and 047 applied first. Nothing was changed.';
  END IF;
END $$;

-- ---- 1. commit_work: one server operation ---------------------------------------------------------------------

CREATE FUNCTION commit_work(p_offering uuid, p_activity uuid, p_content jsonb DEFAULT NULL,
                            p_markdown text DEFAULT NULL, p_bytes integer DEFAULT NULL)
RETURNS TABLE (out_submission_id uuid, out_receipt_id uuid, out_committed_at timestamptz, out_is_late boolean,
               out_content_sha256 text, out_already boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_ao    record;
  v_enr   uuid;
  v_oa    record;
  v_sub   record;
  v_core  record;
  v_late  boolean := false;
  v_close timestamptz;
  v_now   timestamptz := now();
  v_hash  text;
  v_rec   uuid;
  v_row   record;
  v_when  text;
BEGIN
  SELECT ao.id, ao.course_offering_id, ao.is_published, ao.late_allowed INTO v_ao
    FROM assignment_offerings ao WHERE ao.id = p_offering;
  IF NOT FOUND OR NOT v_ao.is_published THEN
    RAISE EXCEPTION 'commit_work: this assignment is not available to you' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT e.id INTO v_enr
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.id IN (SELECT my_enrollments()) AND e.status = 'active' AND s.course_offering_id = v_ao.course_offering_id
   ORDER BY e.id LIMIT 1;
  IF v_enr IS NULL THEN
    RAISE EXCEPTION 'commit_work: this assignment is not available to you' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT _item_open_for_section(p_offering, (SELECT e.section_id FROM enrollments e WHERE e.id = v_enr)) THEN
    RAISE EXCEPTION 'This assignment has not opened yet, so it cannot be submitted.' USING ERRCODE = 'P0001';
  END IF;

  SELECT oa.grading_role, a.modality INTO v_oa
    FROM offering_activities oa JOIN activities a ON a.id = oa.activity_id
   WHERE oa.assignment_offering_id = p_offering AND oa.activity_id = p_activity AND oa.is_visible;
  IF NOT FOUND OR v_oa.grading_role IS DISTINCT FROM 'graded' THEN
    RAISE EXCEPTION 'This isn''t the graded part of the assignment, so it can''t be submitted for credit.'
      USING ERRCODE = 'P0001';
  END IF;

  -- get or create, then hold the row: a second tab or a repeated request waits here and sees the first outcome
  INSERT INTO submissions (enrollment_id, assignment_offering_id, status)
  VALUES (v_enr, p_offering, 'draft')
  ON CONFLICT (enrollment_id, assignment_offering_id) DO NOTHING;
  SELECT s.* INTO v_sub FROM submissions s
   WHERE s.enrollment_id = v_enr AND s.assignment_offering_id = p_offering FOR UPDATE;

  IF v_sub.status = 'committed' THEN
    IF v_sub.chosen_activity_id IS DISTINCT FROM p_activity THEN
      RAISE EXCEPTION 'You''ve already completed this assignment another way, and that version is the one being graded. Ask your instructor if you need it reopened.'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT r.id, r.committed_at, r.is_late, r.content_sha256 INTO v_row
      FROM submission_receipts r WHERE r.submission_id = v_sub.id ORDER BY r.committed_at DESC, r.id LIMIT 1;
    RETURN QUERY SELECT v_sub.id, v_row.id, coalesce(v_row.committed_at, v_sub.committed_at),
                        coalesce(v_row.is_late, false), v_row.content_sha256, true;
    RETURN;
  END IF;

  -- an effort-graded report is the first one that counts: while a finalized grade of this item stands, a second report is
  -- refused. The server reads the grade itself, so a grade held back from the cadet's view still counts.
  IF _report_grade_stands(v_enr, p_offering, p_activity) THEN
    RAISE EXCEPTION 'This assignment has already been graded and can''t be resubmitted. Ask your instructor to reopen it if you need to.'
      USING ERRCODE = 'P0001';
  END IF;

  -- the deadline, from the server clock and the one rule of 038
  SELECT c.due_at, c.is_past INTO v_core FROM _effective_core(v_enr, p_offering) c;
  IF FOUND AND v_core.due_at IS NOT NULL AND v_core.is_past THEN
    v_when := to_char(v_core.due_at AT TIME ZONE 'America/Denver', 'FMDay, FMMonth FMDD, YYYY "at" HH24:MI') || ' Mountain time';
    IF NOT v_ao.late_allowed THEN
      RAISE EXCEPTION 'The deadline for this assignment was % and has passed, so it can no longer be submitted. Your saved answers are kept and your instructor can still see them.', v_when
        USING ERRCODE = 'P0001';
    END IF;
    v_close := late_close_at(v_ao.course_offering_id);
    IF v_close IS NOT NULL AND v_now > v_close THEN
      RAISE EXCEPTION 'The deadline for this assignment was % and the last class day of the term has passed, so it can no longer be submitted.', v_when
        USING ERRCODE = 'P0001';
    END IF;
    v_late := true;
  END IF;

  -- the report or answers: store what came with the call, mark final
  INSERT INTO submission_activities (submission_id, activity_id, content, report_markdown, payload_bytes, is_final)
  VALUES (v_sub.id, p_activity, p_content, p_markdown, p_bytes, true)
  ON CONFLICT (submission_id, activity_id) DO UPDATE
     SET content         = CASE WHEN p_content IS NULL THEN submission_activities.content ELSE p_content END,
         report_markdown = coalesce(p_markdown, submission_activities.report_markdown),
         payload_bytes   = coalesce(p_bytes, submission_activities.payload_bytes),
         is_final        = true;

  UPDATE submissions SET chosen_activity_id = p_activity, status = 'committed', committed_at = v_now
   WHERE id = v_sub.id;

  SELECT encode(sha256(convert_to(coalesce(sa.content::text, '') || E'\n' || coalesce(sa.report_markdown, ''), 'UTF8')), 'hex')
    INTO v_hash
    FROM submission_activities sa WHERE sa.submission_id = v_sub.id AND sa.activity_id = p_activity;

  INSERT INTO submission_receipts (submission_id, activity_id, content_sha256, committed_at, is_late, actor)
  VALUES (v_sub.id, p_activity, v_hash, v_now, v_late, current_uid())
  RETURNING id INTO v_rec;

  RETURN QUERY SELECT v_sub.id, v_rec, v_now, v_late, v_hash, false;
END $$;

COMMENT ON FUNCTION commit_work(uuid, uuid, jsonb, text, integer) IS
  'Submits the caller''s own work for the graded activity of an item: server clock, the 038 deadline rule, late '
  'handling, report stored, commit and receipt in one transaction. Idempotent. Migration 048.';

-- ---- 2. the row guards: no commit time from a request, and frozen after commit ---------------------------------

CREATE FUNCTION submissions_commit_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  -- only a request made AS an API role is checked; a foreign key's own action runs one level down
  IF current_user NOT IN ('anon', 'authenticated') OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' OR NEW.committed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Work is submitted with the submit function; a submission cannot be written already committed'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'committed' AND OLD.status IS DISTINCT FROM 'committed' THEN
    RAISE EXCEPTION 'Work is submitted with the submit function; the status cannot be set to committed directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'committed' AND NEW.status = 'committed'
     AND (NEW.committed_at IS DISTINCT FROM OLD.committed_at OR NEW.chosen_activity_id IS DISTINCT FROM OLD.chosen_activity_id) THEN
    RAISE EXCEPTION 'This submission is already committed; its commit time and chosen activity are fixed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IS DISTINCT FROM 'committed' AND NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
    RAISE EXCEPTION 'The commit time is set by the server and cannot be written' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submissions_commit_guard
  BEFORE INSERT OR UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION submissions_commit_guard();

CREATE FUNCTION submission_activities_freeze() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_sub uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
BEGIN
  IF current_user IN ('anon', 'authenticated') AND pg_trigger_depth() <= 1
     AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = v_sub AND s.status = 'committed') THEN
    RAISE EXCEPTION 'This work has been submitted and can no longer be changed or deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submission_activities_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON submission_activities
  FOR EACH ROW EXECUTE FUNCTION submission_activities_freeze();

-- ---- 3. the interactive report save refuses to replace a committed one -----------------------------------------

CREATE OR REPLACE FUNCTION save_interactive_work(p_submission uuid, p_activity uuid, p_content jsonb, p_markdown text,
                                                 p_bytes integer, p_final boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = p_submission AND s.enrollment_id IN (SELECT my_enrollments())) THEN
    RAISE EXCEPTION 'save_interactive_work: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM submissions s
                   JOIN offering_activities oa ON oa.assignment_offering_id = s.assignment_offering_id
                   JOIN activities a ON a.id = oa.activity_id
                  WHERE s.id = p_submission AND a.id = p_activity AND a.modality = 'interactive') THEN
    RAISE EXCEPTION 'save_interactive_work: that is not an interactive activity of this assignment'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM submissions s JOIN enrollments e ON e.id = s.enrollment_id
                  WHERE s.id = p_submission AND _item_open_for_section(s.assignment_offering_id, e.section_id)) THEN
    RAISE EXCEPTION 'This assignment has not opened yet, so a report cannot be saved to it.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM submissions s
              WHERE s.id = p_submission AND _report_grade_stands(s.enrollment_id, s.assignment_offering_id, p_activity)) THEN
    RAISE EXCEPTION 'This assignment has already been graded and can''t be resubmitted. Ask your instructor to reopen it if you need to.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM submissions s
              WHERE s.id = p_submission AND s.status = 'committed' AND s.chosen_activity_id = p_activity) THEN
    RAISE EXCEPTION 'This report has already been submitted for credit and can''t be replaced. Ask your instructor if you need to redo it.'
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO submission_activities (submission_id, activity_id, content, report_markdown, payload_bytes, is_final)
  VALUES (p_submission, p_activity, p_content, p_markdown, p_bytes, coalesce(p_final, true))
  ON CONFLICT (submission_id, activity_id) DO UPDATE
     SET content = EXCLUDED.content, report_markdown = EXCLUDED.report_markdown,
         payload_bytes = EXCLUDED.payload_bytes, is_final = EXCLUDED.is_final
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---- 4. no re-fire of the interactive auto-grade -------------------------------------------------------------

DROP TRIGGER submissions_autograde_interactive ON submissions;
CREATE TRIGGER submissions_autograde_interactive_ins
  AFTER INSERT ON submissions
  FOR EACH ROW
  WHEN (NEW.status = 'committed' AND NEW.chosen_activity_id IS NOT NULL)
  EXECUTE FUNCTION grade_interactive_on_commit();
CREATE TRIGGER submissions_autograde_interactive
  AFTER UPDATE OF status, chosen_activity_id ON submissions
  FOR EACH ROW
  WHEN (NEW.status = 'committed' AND NEW.chosen_activity_id IS NOT NULL
        AND (OLD.status IS DISTINCT FROM 'committed' OR OLD.chosen_activity_id IS DISTINCT FROM NEW.chosen_activity_id))
  EXECUTE FUNCTION grade_interactive_on_commit();

-- ---- 5. two tabs: merge only what a tab changed ---------------------------------------------------------------

CREATE FUNCTION save_written_answers(p_submission uuid, p_activity uuid, p_patch jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'save_written_answers: the answers must be an object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = p_submission AND s.enrollment_id IN (SELECT my_enrollments())) THEN
    RAISE EXCEPTION 'save_written_answers: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM submissions s
                   JOIN offering_activities oa ON oa.assignment_offering_id = s.assignment_offering_id
                   JOIN activities a ON a.id = oa.activity_id
                  WHERE s.id = p_submission AND a.id = p_activity AND a.modality = 'written') THEN
    RAISE EXCEPTION 'save_written_answers: that is not the written activity of this assignment'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (SELECT 1 FROM submissions s WHERE s.id = p_submission AND s.status = 'committed') THEN
    RAISE EXCEPTION 'This work has been submitted and can no longer be changed.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO submission_activities (submission_id, activity_id, content)
  VALUES (p_submission, p_activity, p_patch)
  ON CONFLICT (submission_id, activity_id) DO UPDATE
     SET content = coalesce(CASE WHEN jsonb_typeof(submission_activities.content) = 'object'
                                 THEN submission_activities.content END, '{}'::jsonb) || p_patch
  RETURNING updated_at INTO v_at;
  RETURN v_at;
END $$;

-- ---- 6. when a held-back lesson opens ----------------------------------------------------------------------------

CREATE FUNCTION my_lesson_opens_at(p_slug text) RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT min(release_at(ao.id, s.id))
    FROM activities a
    JOIN offering_activities oa ON oa.activity_id = a.id AND oa.is_visible
    JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id AND ao.is_published
    JOIN sections s ON s.course_offering_id = ao.course_offering_id
    JOIN enrollments e ON e.section_id = s.id AND e.status = 'active' AND e.id IN (SELECT my_enrollments())
   WHERE a.slug = p_slug AND release_at(ao.id, s.id) > now();
$$;
COMMENT ON FUNCTION my_lesson_opens_at(text) IS
  'When a lesson (by activity slug) that is published for the caller but has not opened yet opens. NULL for any other '
  'slug, so it cannot be used to find lessons the caller has no part in. Migration 048.';

-- ---- grants: by name -------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION submissions_commit_guard()        FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION submission_activities_freeze()    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION commit_work(uuid, uuid, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION commit_work(uuid, uuid, jsonb, text, integer) TO authenticated;
REVOKE ALL ON FUNCTION save_written_answers(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_written_answers(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION my_lesson_opens_at(text)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_lesson_opens_at(text)       TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- committed submissions with no receipt: work committed before this migration (expected, not an error)
--   SELECT count(*) FROM app.submissions s WHERE s.status = 'committed'
--      AND NOT EXISTS (SELECT 1 FROM app.submission_receipts r WHERE r.submission_id = s.id);
--
--   -- committed submissions whose chosen activity's answer row is not final (none from now on)
--   SELECT count(*) FROM app.submissions s JOIN app.submission_activities sa
--       ON sa.submission_id = s.id AND sa.activity_id = s.chosen_activity_id
--    WHERE s.status = 'committed' AND NOT sa.is_final;
--
-- The behaviour is proved by scripts/staging/test_commit_freeze_scratch.py on a throwaway database.
