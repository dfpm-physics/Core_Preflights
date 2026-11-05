-- PREP v2 -- a finished term keeps the points it was graded out of
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 030_questions_and_keys.sql (sync_auto_checked_points) and 072_remark_question.sql
-- (questions_regrade_auto). Added at the merge of step 2 and Stage E.
--
-- WHY
--   An auto-checked item takes its points from its questions (030), and a question belongs to an assignment that is
--   offered again every term. Editing a question's points in the shared assignment therefore moved `points_possible` on
--   EVERY offering of it, including the offering of a term that has ended, so a past term's stored maximum, and the
--   percentage built on it, changed after the fact. A finished term is a record. The re-mark already changes an active
--   term only (072); this applies the same idea to the points.
--
-- WHAT IT DOES
--   * _term_is_over(course_offering)   true when the offering's term has an end date before today (America/Denver).
--     A term with no end date is not over.
--   * sync_auto_checked_points() REPLACED: unchanged except that an offering whose term is over is skipped.
--   * questions_regrade_auto() REPLACED: unchanged except that an offering whose term is over is skipped, so no grade
--     of a finished term is recomputed against points that did not move with it.
--   An offering of the current or a coming term is synced exactly as before.
--
-- WHAT IT DOES NOT DO
--   It does not change the points of any stored offering and does not touch a grade. It does not stop an edit to the
--   question itself (the library question is shared); it stops the edit reaching the finished term's copy.
--   Limit: a path added later to an offering whose term is already over is not synced, because nothing should be adding
--   one; the publish check of 030 would then say so.
--
-- Rollback: rollback/074_past_terms_keep_points_ROLLBACK.sql restores the 030 and 072 texts.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION _term_is_over(p_course_offering uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT coalesce((SELECT t.ends_on < (now() AT TIME ZONE 'America/Denver')::date
                     FROM course_offerings co JOIN terms t ON t.id = co.term_id
                    WHERE co.id = p_course_offering), false);
$$;
COMMENT ON FUNCTION _term_is_over(uuid) IS
  'True when the course offering''s term has an end date before today in Denver. A finished term is a record: its points and '
  'grades are not recomputed from the shared questions. Internal. Migration 074.';

CREATE OR REPLACE FUNCTION sync_auto_checked_points(p_activity uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_sum numeric;
BEGIN
  SELECT coalesce(sum(q.points), 0) INTO v_sum
    FROM questions q WHERE q.activity_id = p_activity AND NOT q.is_retired;
  UPDATE assignment_offerings ao
     SET points_possible = v_sum
   WHERE ao.id IN (SELECT oa.assignment_offering_id FROM offering_activities oa
                    WHERE oa.activity_id = p_activity AND oa.grading = 'auto_checked')
     AND ao.points_possible IS DISTINCT FROM v_sum
     AND NOT _term_is_over(ao.course_offering_id);   -- a finished term is a record (074)
END; $$;

CREATE OR REPLACE FUNCTION questions_regrade_auto() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT g.enrollment_id, g.assignment_offering_id
      FROM offering_activities oa
      JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
      JOIN course_offerings co ON co.id = ao.course_offering_id AND co.is_active AND NOT _term_is_over(co.id)
      JOIN grades g ON g.assignment_offering_id = ao.id AND g.source = 'auto_checked'
     WHERE oa.activity_id = NEW.activity_id AND oa.grading = 'auto_checked'
     ORDER BY g.enrollment_id, g.assignment_offering_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.enrollment_id::text || ':' || r.assignment_offering_id::text, 71));
    PERFORM _regrade_auto(r.enrollment_id, r.assignment_offering_id, NEW.activity_id);
  END LOOP;
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION _term_is_over(uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION sync_auto_checked_points(uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION questions_regrade_auto() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 2 rows: both functions now skip a finished term
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.prosrc LIKE '%_term_is_over%' AND p.proname <> '_term_is_over' ORDER BY 1;
--   -- offerings of finished terms whose stored points differ from their questions (informational: these are records)
--   SELECT ao.id FROM app.assignment_offerings ao
--     JOIN app.course_offerings co ON co.id = ao.course_offering_id JOIN app.terms t ON t.id = co.term_id
--    WHERE t.ends_on < current_date AND ao.points_possible IS DISTINCT FROM
--          (SELECT coalesce(sum(q.points), 0) FROM app.offering_activities oa JOIN app.questions q ON q.activity_id = oa.activity_id
--            WHERE oa.assignment_offering_id = ao.id AND oa.grading = 'auto_checked' AND NOT q.is_retired)
--      AND EXISTS (SELECT 1 FROM app.offering_activities oa WHERE oa.assignment_offering_id = ao.id AND oa.grading = 'auto_checked');
