-- Rollback for 074_past_terms_keep_points.sql. Run as `prep_app_owner`.
-- Puts sync_auto_checked_points back to its 030 text and questions_regrade_auto back to its 072 text, then drops the helper.
-- Stored points are not touched.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

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
     AND ao.points_possible IS DISTINCT FROM v_sum;
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
      JOIN course_offerings co ON co.id = ao.course_offering_id AND co.is_active
      JOIN grades g ON g.assignment_offering_id = ao.id AND g.source = 'auto_checked'
     WHERE oa.activity_id = NEW.activity_id AND oa.grading = 'auto_checked'
     ORDER BY g.enrollment_id, g.assignment_offering_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.enrollment_id::text || ':' || r.assignment_offering_id::text, 71));
    PERFORM _regrade_auto(r.enrollment_id, r.assignment_offering_id, NEW.activity_id);
  END LOOP;
  RETURN NULL;
END; $$;

DROP FUNCTION _term_is_over(uuid);

COMMIT;
