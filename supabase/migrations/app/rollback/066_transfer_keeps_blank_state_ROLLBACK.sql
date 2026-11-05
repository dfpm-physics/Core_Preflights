-- Rollback for 066_transfer_keeps_blank_state.sql. Run as `prep_app_owner`.
--
-- Puts _cells_at back to its 039 text, drops the two triggers and their functions, and drops closure_carry.
-- After this a transfer again moves a cadet's blank between "counts 0" and "left out" with the section's closure.
-- Refuses while closure_carry holds rows: those rows are the only record of what the moved cadets had.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- Snapshot first, check it against live counts, then set this in the SAME session before running the file:
--   SET prep.rollback_loses_rows = '066';   -- this file's number, so one flag never unlocks another file
-- An empty table rolls back with no setting.
DO $$
BEGIN
  IF coalesce(current_setting('prep.rollback_loses_rows', true), '') <> '066'
     AND EXISTS (SELECT 1 FROM closure_carry) THEN
    RAISE EXCEPTION 'rollback of 066 would lose carried closure states. Snapshot first, then SET prep.rollback_loses_rows = ''066'' in this session. Nothing was changed.';
  END IF;
END $$;

DROP TRIGGER column_closures_release_carry ON column_closures;
DROP TRIGGER enrollments_closure_carry ON enrollments;

CREATE OR REPLACE FUNCTION _cells_at(p_course_offering uuid, p_scope text, p_now timestamptz)
RETURNS TABLE (
  enrollment_id          uuid,
  section_id             uuid,
  student_id             bigint,
  assignment_offering_id uuid,
  state                  text,
  has_draft_score        boolean,
  is_late                boolean,
  no_work_received       boolean,
  deadline_invalid       boolean,
  late_closed            boolean,
  auto_checked           boolean,
  is_bonus               boolean,
  points_earned          numeric,
  points_possible        numeric,
  counted_earned         numeric,
  counted_possible       numeric,
  due_at                 timestamptz,
  deadline_source        text)
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  WITH items AS (
    SELECT ao.id, ao.points_possible, ao.is_bonus, ao.grades_release_at,
           EXISTS (SELECT 1 FROM offering_activities oa JOIN activities a ON a.id = oa.activity_id
                    WHERE oa.assignment_offering_id = ao.id AND oa.grading_role = 'graded'
                      AND (a.modality = 'external' OR oa.delivery IN ('in_person', 'elsewhere'))) AS no_sub,
           EXISTS (SELECT 1 FROM offering_activities oa
                    WHERE oa.assignment_offering_id = ao.id AND oa.grading_role = 'graded'
                      AND oa.grading = 'auto_checked') AS is_auto,
           (SELECT a.id FROM offering_activities oa JOIN activities a ON a.id = oa.activity_id
             WHERE oa.assignment_offering_id = ao.id AND a.modality = 'written'
             ORDER BY oa.position, a.id LIMIT 1) AS written_id
      FROM assignment_offerings ao
     WHERE ao.course_offering_id = p_course_offering
       AND ao.is_published
       AND (p_scope = 'final' OR ao.prog_included)),
  enr AS (
    SELECT e.id, e.section_id, e.student_id
      FROM enrollments e JOIN sections s ON s.id = e.section_id
     WHERE s.course_offering_id = p_course_offering AND e.status IN ('active', 'completed')),
  dl AS (SELECT * FROM deadline_rows(p_course_offering)),
  base AS (
    SELECT enr.id AS enr_id, enr.section_id AS sec_id, enr.student_id AS stu_id,
           i.id AS ao_id, i.points_possible AS ao_possible, i.is_bonus AS ao_bonus, i.grades_release_at AS rel_at,
           i.no_sub, i.is_auto, i.written_id,
           (g.id IS NOT NULL) AS g_exists, g.points_earned AS g_pts, coalesce(g.is_finalized, false) AS g_fin,
           g.source AS g_src, g.graded_at AS g_at,
           coalesce(g.diagnostic -> 'no_submission' = 'true'::jsonb, false) AS g_nosub,
           sub.id AS sub_id, sub.chosen_activity_id AS sub_chosen, sub.status AS sub_status,
           sub.committed_at AS sub_at, sub.updated_at AS sub_upd,
           dl.due_at AS d_at, dl.source AS d_src, coalesce(dl.invalid, false) AS d_inv,
           (dl.due_at IS NOT NULL AND (p_now - dl.due_at) > interval '120 seconds') AS past,
           EXISTS (SELECT 1 FROM grade_excusals x
                    WHERE x.enrollment_id = enr.id AND x.assignment_offering_id = i.id
                      AND x.revoked_at IS NULL) AS excused,
           EXISTS (SELECT 1 FROM column_closures cc
                    WHERE cc.assignment_offering_id = i.id AND cc.section_id = enr.section_id
                      AND cc.reopened_at IS NULL) AS closed,
           EXISTS (SELECT 1 FROM question_attempts qa
                    WHERE qa.enrollment_id = enr.id AND qa.assignment_offering_id = i.id) AS has_attempts
      FROM enr
      CROSS JOIN items i
      LEFT JOIN grades g ON g.enrollment_id = enr.id AND g.assignment_offering_id = i.id
      LEFT JOIN submissions sub ON sub.enrollment_id = enr.id AND sub.assignment_offering_id = i.id
      LEFT JOIN dl ON dl.enrollment_id = enr.id AND dl.assignment_offering_id = i.id),
  -- IS THERE WORK BEHIND A NO-SUBMISSION ZERO? The site's own question (planPublish and staleZeroIds in
  -- site/js/faculty-grade.js): a chosen activity other than the written one counts as work, otherwise any
  -- non-blank written answer does, submitted or not. A committed blank is NOT work. It is asked only of a grade
  -- that carries the no_submission marker, the only place the answer is used. The character class is the set
  -- JavaScript's trim() removes.
  worked AS (
    SELECT b.*,
           CASE
             WHEN NOT b.g_nosub OR b.sub_id IS NULL THEN false
             WHEN b.sub_chosen IS NOT NULL AND b.sub_chosen IS DISTINCT FROM b.written_id THEN true
             ELSE EXISTS (SELECT 1 FROM submission_activities sa,
                                 LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(sa.content) = 'object'
                                                              THEN sa.content ELSE '{}'::jsonb END) kv
                           WHERE sa.submission_id = b.sub_id AND sa.activity_id = b.written_id
                             AND kv.value ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
           END AS nosub_work
      FROM base b),
  derived AS (
    SELECT b.*,
           (b.g_exists AND b.g_fin AND b.g_pts IS NOT NULL) AS usable,
           (b.rel_at IS NULL OR b.rel_at <= p_now) AS rel_ok,
           coalesce(b.sub_status = 'committed', false) AS committed,
           (b.g_exists AND b.g_fin AND b.g_pts IS NOT NULL AND b.g_src = 'auto_checked' AND NOT b.past) AS auto_pending,
           -- the same question as isStaleZero (site/js/faculty-grade.js): a finalized 0 that carries the
           -- no_submission marker, with work behind it (nosub_work), and EITHER still the AI's row OR saved before
           -- the work came in (graded_at or the work time unknown counts as before). The work time is the commit
           -- time when committed, else the submission's last update, as the site reads it. No marker, or a
           -- committed blank: a real zero, and it counts.
           coalesce(b.g_exists AND b.g_fin AND b.g_pts = 0 AND b.g_nosub AND b.nosub_work
              AND (b.g_src = 'ai_suggested' OR b.g_at IS NULL
                   OR (CASE WHEN b.sub_status = 'committed' THEN b.sub_at ELSE b.sub_upd END) IS NULL
                   OR (CASE WHEN b.sub_status = 'committed' THEN b.sub_at ELSE b.sub_upd END) > b.g_at), false) AS stale_zero,
           -- a score not yet finalized, holding work or waiting on one. THE ONE PLACE the past-due uncommitted
           -- draft rule lives (confirmed by the course director for a draft holding a score): to take the other
           -- reading, delete the last term of the OR. A blank draft that carries only the AI's suggested 0 holds no
           -- score worth the name, so it stays missing (same as a cadet with no submission row).
           coalesce(b.g_exists AND NOT b.g_fin AND b.g_pts IS NOT NULL
              AND (b.sub_status = 'committed' OR b.no_sub
                   OR (b.sub_status = 'draft' AND b.past AND (NOT b.g_nosub OR b.nosub_work))), false) AS draft_score
      FROM worked b),
  staged AS (
    SELECT d.*,
           CASE
             WHEN d.excused THEN 'excused'
             WHEN d.usable AND d.auto_pending THEN 'in_progress'
             WHEN d.usable AND d.stale_zero THEN 'submitted_ungraded'
             WHEN d.usable AND d.rel_ok THEN 'released'
             WHEN d.usable THEN 'graded_unreleased'
             WHEN d.committed THEN 'submitted_ungraded'
             WHEN d.draft_score THEN 'submitted_ungraded'
             WHEN d.ao_bonus AND NOT d.past
                  AND (d.sub_status = 'draft' OR d.has_attempts OR (d.is_auto AND d.g_exists)) THEN 'in_progress'
             WHEN d.ao_bonus THEN 'not_due'
             -- a closed column counts a blank 0 whatever its date, unless the cadet holds an active extension whose
             -- date has not passed: the extension is a person's decision and stands until it runs out
             WHEN d.no_sub AND d.closed AND (d.d_src IS DISTINCT FROM 'extension' OR d.past) THEN 'missing'
             WHEN d.no_sub AND d.past THEN 'submitted_ungraded'
             WHEN d.past THEN 'missing'
             WHEN d.sub_status = 'draft' OR d.has_attempts OR (d.is_auto AND d.g_exists) THEN 'in_progress'
             ELSE 'not_due'
           END AS st
      FROM derived d)
  SELECT s.enr_id, s.sec_id, s.stu_id, s.ao_id, s.st,
         (s.st = 'submitted_ungraded' AND s.draft_score AND NOT s.usable),
         coalesce(s.st IN ('released', 'submitted_ungraded', 'graded_unreleased')
            AND s.committed AND s.d_at IS NOT NULL AND (s.sub_at - s.d_at) > interval '120 seconds', false),
         (s.st = 'submitted_ungraded' AND s.no_sub AND s.sub_status IS NULL AND NOT s.draft_score AND NOT s.usable),
         s.d_inv,
         coalesce(p_now > (SELECT late_close_at(p_course_offering)), false),
         s.is_auto,
         s.ao_bonus,
         s.g_pts,
         s.ao_possible,
         CASE WHEN s.st = 'released' THEN s.g_pts WHEN s.st = 'missing' THEN 0::numeric ELSE 0::numeric END,
         CASE WHEN s.st IN ('released', 'missing') AND NOT s.ao_bonus THEN s.ao_possible ELSE 0::numeric END,
         s.d_at,
         coalesce(s.d_src, 'none')
    FROM staged s;
$$;

DROP FUNCTION closure_carry_release();
DROP FUNCTION closure_carry_on_move();
DROP TABLE closure_carry;

COMMIT;
