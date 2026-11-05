-- Rollback for 047_release_gated_content.sql. Run as `prep_app_owner`.
--
-- Puts the key fields back into the stored content and snapshots from the archive, removes the question and key rows
-- the migration made, restores the cadet policies of 002, and drops what 047 added.
--
-- It refuses (and changes nothing) when:
--   * a key row the migration made has been edited or superseded since (a newer version exists), because deleting it
--     would lose that edit: export `question_keys` first, then decide;
--   * a snapshot has changed since the move (frozen snapshots do not change, so this means someone cleared the stamp).
-- A question row the migration made that has since gained other key rows is treated the same way as the first case.
--
-- Content edited since the move keeps its edits: only the key fields of questions that were in the archive are put
-- back, matched by question id. A key written into the key table after the move for a question that had no key field
-- before it stays in the key table and is NOT put back into content.
--
-- Deploy the previous site files first or at the same time: with this rolled back, the cadet pages that read `my_work`
-- and call save_interactive_work find neither.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- 1. refuse if the rollback would lose a later edit
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT row_id, created_question_ids, created_key_ids FROM content_key_archive WHERE source = 'activities' LOOP
    IF EXISTS (SELECT 1 FROM question_keys k
                WHERE k.question_id = ANY (r.created_question_ids) AND NOT (k.id = ANY (r.created_key_ids)))
       OR EXISTS (SELECT 1 FROM question_keys k
                   WHERE k.id = ANY (r.created_key_ids) AND k.superseded_at IS NOT NULL) THEN
      RAISE EXCEPTION '047 rollback: a key made by the move has been edited since (activity %). Export question_keys and decide. Nothing was changed.', r.row_id;
    END IF;
  END LOOP;
  FOR r IN SELECT a.row_id, a.original FROM content_key_archive a
            JOIN assignment_offerings ao ON ao.id = a.row_id
           WHERE a.source = 'assignment_offerings'
             AND ao.content_snapshot IS DISTINCT FROM _strip_snapshot(a.original) LOOP
    RAISE EXCEPTION '047 rollback: the snapshot of offering % changed after the move. Nothing was changed.', r.row_id;
  END LOOP;
END $$;

-- 2. take the new triggers off first, so the restore is not stripped again
DROP TRIGGER activities_file_keys ON activities;
DROP TRIGGER assignment_offerings_strip_keys ON assignment_offerings;

-- 3. put the key fields back
DO $$
DECLARE
  r      record;
  cur    jsonb;
  q      jsonb;
  oq     jsonb;
  k      text;
  arr    jsonb;
BEGIN
  FOR r IN SELECT row_id, original FROM content_key_archive WHERE source = 'activities' LOOP
    SELECT content INTO cur FROM activities WHERE id = r.row_id;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN jsonb_typeof(cur -> 'questions') IS DISTINCT FROM 'array';
    arr := '[]'::jsonb;
    FOR q IN SELECT x FROM jsonb_array_elements(cur -> 'questions') WITH ORDINALITY t(x, o) ORDER BY o LOOP
      IF jsonb_typeof(q) = 'object' THEN
        SELECT e INTO oq FROM jsonb_array_elements(r.original -> 'questions') e
         WHERE jsonb_typeof(e) = 'object' AND e ->> 'id' = q ->> 'id' LIMIT 1;
        IF oq IS NOT NULL THEN
          FOREACH k IN ARRAY ARRAY['expected_response', 'correct_answer', 'answer_key', 'solution'] LOOP
            IF oq ? k THEN
              q := jsonb_set(q, ARRAY[k], oq -> k);
            END IF;
          END LOOP;
        END IF;
        oq := NULL;
      END IF;
      arr := arr || jsonb_build_array(q);
    END LOOP;
    UPDATE activities SET content = jsonb_set(cur, '{questions}', arr) WHERE id = r.row_id;
  END LOOP;

  FOR r IN SELECT a.row_id, a.original, ao.content_snapshot_frozen_at AS fz
             FROM content_key_archive a JOIN assignment_offerings ao ON ao.id = a.row_id
            WHERE a.source = 'assignment_offerings' LOOP
    IF r.fz IS NOT NULL THEN
      UPDATE assignment_offerings SET content_snapshot_frozen_at = NULL WHERE id = r.row_id;
    END IF;
    UPDATE assignment_offerings SET content_snapshot = r.original WHERE id = r.row_id;
    IF r.fz IS NOT NULL THEN
      UPDATE assignment_offerings SET content_snapshot_frozen_at = r.fz WHERE id = r.row_id;
    END IF;
  END LOOP;
END $$;

-- 4. remove the key and question rows the move made (keys go with their question)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT created_question_ids, created_key_ids FROM content_key_archive WHERE source = 'activities' LOOP
    DELETE FROM question_keys WHERE id = ANY (r.created_key_ids);
    DELETE FROM questions WHERE id = ANY (r.created_question_ids);
  END LOOP;
END $$;

-- 5. the cadet policies as 002 left them
DROP POLICY sa_own_written ON submission_activities;
CREATE POLICY sa_own ON submission_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())));
CREATE POLICY sa_student_write ON submission_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())))
  WITH CHECK (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())));

DROP POLICY activities_student_read ON activities;
CREATE POLICY activities_student_read ON activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM offering_activities oa
                  WHERE oa.activity_id = activities.id
                    AND oa.is_visible
                    AND oa.assignment_offering_id IN (SELECT my_assignment_offerings())));

-- 5b. my_grades as 046 left it
CREATE OR REPLACE VIEW my_grades WITH (security_barrier = true) AS
  SELECT g.id, g.enrollment_id, g.assignment_offering_id, g.submission_id,
         g.points_earned, g.points_possible, g.effort, g.question_scores,
         g.source, g.is_finalized, g.graded_by, g.graded_at, g.created_at, g.updated_at,
         g.over_max_allowed, g.student_group_id, g.student_group_adjusted,
         g.diagnostic -> 'instructor_note' AS instructor_note
    FROM grades g
   WHERE g.is_finalized
     AND g.enrollment_id IN (SELECT my_enrollments());

-- 6. drop what 047 added
DROP FUNCTION save_interactive_work(uuid, uuid, jsonb, text, integer, boolean);
DROP VIEW my_work;
DROP FUNCTION is_written_activity(uuid);
DROP FUNCTION my_released_activity_ids();
DROP FUNCTION my_released_assignment_offerings();
DROP FUNCTION _item_open_for_section(uuid, uuid);
DROP FUNCTION activities_file_keys();
DROP FUNCTION assignment_offerings_strip_snapshot_keys();
DROP FUNCTION _file_question_keys(uuid, jsonb, text);
DROP TABLE content_key_archive;
DROP FUNCTION _question_key_text(jsonb);
DROP FUNCTION _strip_snapshot(jsonb);
DROP FUNCTION _snapshot_has_keys(jsonb);
DROP FUNCTION _strip_question_keys(jsonb);
DROP FUNCTION _content_has_keys(jsonb);

COMMIT;
