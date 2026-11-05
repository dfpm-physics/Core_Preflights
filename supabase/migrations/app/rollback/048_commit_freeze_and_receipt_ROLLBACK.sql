-- Rollback for 048_commit_freeze_and_receipt.sql. Run as `prep_app_owner`.
-- Drops the commit function, the two row guards, the answer-merge function and the opening-time function; puts
-- save_interactive_work back to its 047 body and the interactive auto-grade trigger back to its 015 definition.
-- Receipts already written stay (the table is 031's, and a receipt is a record). No submission, answer or grade row
-- is changed. After this, the site's older commit path (a direct write) works again for the API roles.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER submissions_commit_guard ON submissions;
DROP TRIGGER submission_activities_freeze ON submission_activities;
DROP FUNCTION submissions_commit_guard();
DROP FUNCTION submission_activities_freeze();

DROP TRIGGER submissions_autograde_interactive ON submissions;
DROP TRIGGER submissions_autograde_interactive_ins ON submissions;
CREATE TRIGGER submissions_autograde_interactive
  AFTER INSERT OR UPDATE OF status, chosen_activity_id ON submissions
  FOR EACH ROW
  WHEN (NEW.status = 'committed' AND NEW.chosen_activity_id IS NOT NULL)
  EXECUTE FUNCTION grade_interactive_on_commit();

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
  INSERT INTO submission_activities (submission_id, activity_id, content, report_markdown, payload_bytes, is_final)
  VALUES (p_submission, p_activity, p_content, p_markdown, p_bytes, coalesce(p_final, true))
  ON CONFLICT (submission_id, activity_id) DO UPDATE
     SET content = EXCLUDED.content, report_markdown = EXCLUDED.report_markdown,
         payload_bytes = EXCLUDED.payload_bytes, is_final = EXCLUDED.is_final
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DROP FUNCTION commit_work(uuid, uuid, jsonb, text, integer);
DROP FUNCTION save_written_answers(uuid, uuid, jsonb);
DROP FUNCTION my_lesson_opens_at(text);

COMMIT;
