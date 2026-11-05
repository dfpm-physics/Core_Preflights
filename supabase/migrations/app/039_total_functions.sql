-- PREP v2 -- one total rule, in the database
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 027_path_delivery_grading.sql (delivery, grading),
-- 028_offering_policy.sql (is_bonus, prog_included, grades_release_at), 031_attempts_and_receipts.sql
-- (question_attempts), 032_letter_scales.sql (_scale_for, _letter_for, letter_scale_is_valid), 033_grade_excusals.sql,
-- 034_column_closures.sql and 038_deadline_functions.sql (deadline_rows, late_close_at). It does NOT depend on
-- 023_instructors_admin_flag_guard.sql. Requires Postgres 13 or later (trim_scale). Design:
-- docs/decisions/V2-DATA-MODEL.md sections 7, 9 and 21.
--
-- THE FUNCTIONS
--   _cells_at(course_offering, scope, now)    internal. One row per active-or-completed enrollment and published item
--                                             (prog scope: only items with prog_included): its STATE, the flags, the
--                                             points, and what it adds to earned and possible.
--   _totals_at(course_offering, scope, now)   internal. One row per enrollment: earned, possible, percent, letter, GPA,
--                                             near-line letter, rank, tie group and the counts. Checkpoints and the
--                                             shadow compare read this.
--   gradebook_cells(course_offering, scope)   staff see the sections they may see; a student sees their own cells, with
--                                             a held score shown as submitted_ungraded and no score unless released
--                                             (or an auto-checked score so far).
--   course_totals(course_offering, scope)     staff only, filtered to sections the caller may see; rank stays course-wide.
--   my_course_total(course_offering, scope)   the student: earned_text, possible_text, percent_text, percent_key_text only.
--   scale_change_preview(offering, lines, width)  Directors: who would change letter or near-line flag before a line
--                                             moves. Saves nothing. (Defined here, not in 032, because it reads the
--                                             totals.)
--   A caller cannot supply a clock: p_now stays internal, because a chosen time would read a release-gated grade early.
--   The three people-facing functions are SECURITY DEFINER so a student's call and a staff call see one answer; the
--   definer computes it, then filters what comes back.
--
-- THE STATES  first match wins
--   1 excused            an active excusal exists, whatever else exists. Leaves the total.
--   2 released           finalized with points, and grades_release_at null or passed. Counts. TWO exceptions:
--                        an auto_checked grade before the deadline passes is in_progress (6); a stored 0 that is stale
--                        goes to row 4. Stale is isStaleZero's question (site/js/faculty-grade.js): the 0 carries
--                        diagnostic.no_submission, there is WORK behind it (a chosen activity other than the written
--                        one, or any non-blank written answer, submitted or not; a committed blank is not work),
--                        and it is either still the AI's row (source ai_suggested) or was saved before the work
--                        (graded_at or the work time unknown counts as before). A 0 without the marker, or on a
--                        blank, is a real zero and counts.
--   3 graded_unreleased  finalized with points, held by a future grades_release_at. Leaves the total.
--   4 submitted_ungraded committed with no usable grade; or a score not finalized when work was committed, when the path
--                        takes no submission, or when an uncommitted draft holding a score is past due (has_draft_score;
--                        a blank draft with only the AI's suggested 0 does not count, it is missing); or the stale
--                        0; or a no-submission path past its deadline with its column still open (no_work_received).
--                        Leaves the total, shown as backlog.
--   5 missing            past the deadline, nothing committed and no score waiting. For a no-submission path: once that
--                        section's column is closed, whatever its date (none, future or past), unless the cadet holds an
--                        active extension that has not passed: then it waits. Counts 0.
--                        A bonus item never becomes missing.
--   6 in_progress        a draft, or attempts, or an auto_checked score so far, until the deadline passes (a bonus item
--                        too). Leaves.
--   7 not_due            anything else. Leaves.
--   "Past" is the deadline plus the 120 second grace, from deadline_rows, so work counts as on time and an auto_checked
--   item stays out of the total for exactly the same instant.
--
-- THE TOTAL
--   earned   = sum of grades.points_earned over released cells (missing adds 0).
--   possible = sum of assignment_offerings.points_possible over released and missing cells, adding 0 for a bonus item.
--   numeric only. At or above a line: earned*100 >= cutoff*possible. Possible 0: percent, letter and rank are null.
--   percent_text is DISPLAY only (exact if it ends within 6 decimals, else cut to 6 with a trailing ellipsis).
--   percent_key_text is plain digits, 22 decimals, cut and never rounded: the export value.
--   Rank: standard competition (1, 2, 2, 4) on percent_key then raw earned, over the whole course offering and scope.
--   tie_group is set only where two or more students share (percent_key, earned).
--
-- GRANTS   _cells_at, _totals_at: prep_app_read only (proof scripts). gradebook_cells, course_totals, my_course_total: NONE
--          at step 1 (step 2 grants authenticated). scale_change_preview: authenticated; it checks its caller.
-- THE CURRENT SITE   Nothing reads any of this at step 1, so no total moves.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- the cells ---------------------------------------------------------------------------------------
CREATE FUNCTION _cells_at(p_course_offering uuid, p_scope text, p_now timestamptz)
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

-- ---- the totals --------------------------------------------------------------------------------------
CREATE FUNCTION _totals_at(p_course_offering uuid, p_scope text, p_now timestamptz)
RETURNS TABLE (
  enrollment_id          uuid,
  section_id             uuid,
  student_id             bigint,
  earned                 numeric,
  possible               numeric,
  earned_text            text,
  possible_text          text,
  percent_text           text,
  percent_key_text       text,
  letter                 text,
  gpa                    numeric,
  near_line_letter       text,
  rank                   integer,
  tie_group              text,
  missing_count          integer,
  ungraded_count         integer,
  unreleased_count       integer,
  excused_count          integer,
  bonus_only             boolean,
  no_work_count          integer,
  invalid_deadline_count integer)
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  WITH enr AS (
    SELECT e.id, e.section_id, e.student_id
      FROM enrollments e JOIN sections s ON s.id = e.section_id
     WHERE s.course_offering_id = p_course_offering AND e.status IN ('active', 'completed')),
  c AS (SELECT * FROM _cells_at(p_course_offering, p_scope, p_now)),
  scale AS (SELECT sc.lines, sc.near_line_width FROM _scale_for(p_course_offering) sc),
  agg AS (
    SELECT enr.id AS enr_id, enr.section_id AS sec_id, enr.student_id AS stu_id,
           coalesce(sum(c.counted_earned), 0)::numeric AS earned,
           coalesce(sum(c.counted_possible), 0)::numeric AS possible,
           count(*) FILTER (WHERE c.state = 'missing')::integer            AS n_missing,
           count(*) FILTER (WHERE c.state = 'submitted_ungraded')::integer AS n_ungraded,
           count(*) FILTER (WHERE c.state = 'graded_unreleased')::integer  AS n_unreleased,
           count(*) FILTER (WHERE c.state = 'excused')::integer            AS n_excused,
           count(*) FILTER (WHERE c.no_work_received)::integer             AS n_no_work,
           count(*) FILTER (WHERE c.deadline_invalid)::integer             AS n_invalid
      FROM enr LEFT JOIN c ON c.enrollment_id = enr.id
     GROUP BY enr.id, enr.section_id, enr.student_id),
  keyed AS (
    SELECT a.*,
           -- cut, never rounded: an exact integer quotient of earned*100*10^22 over possible, scaled back down
           CASE WHEN a.possible > 0
                THEN div(a.earned * 100 * 10000000000000000000000::numeric, a.possible) * 0.0000000000000000000001
           END AS pkey,
           CASE WHEN a.possible > 0
                THEN trunc(div(a.earned * 100 * 10000000000000000000000::numeric, a.possible) * 0.0000000000000000000001, 6)
           END AS p6
      FROM agg a),
  ranked AS (
    SELECT k.*,
           CASE WHEN k.pkey IS NOT NULL
                THEN rank() OVER (PARTITION BY (k.pkey IS NOT NULL) ORDER BY k.pkey DESC, k.earned DESC)::integer END AS rnk,
           CASE WHEN k.pkey IS NOT NULL
                THEN count(*) OVER (PARTITION BY k.pkey, k.earned) END AS grp
      FROM keyed k)
  SELECT r.enr_id, r.sec_id, r.stu_id, r.earned, r.possible,
         trim_scale(r.earned)::text,
         trim_scale(r.possible)::text,
         CASE WHEN r.p6 IS NULL THEN NULL
              WHEN r.p6 * r.possible = r.earned * 100 THEN trim_scale(r.p6)::text
              ELSE r.p6::text || chr(8230) END,
         r.pkey::text,
         l.letter, l.gpa, l.near_line_letter,
         r.rnk,
         CASE WHEN r.grp > 1 THEN r.pkey::text || '|' || trim_scale(r.earned)::text END,
         r.n_missing, r.n_ungraded, r.n_unreleased, r.n_excused,
         (r.earned > 0 AND r.possible = 0),
         r.n_no_work, r.n_invalid
    FROM ranked r
    CROSS JOIN scale
    CROSS JOIN LATERAL _letter_for(r.earned, r.possible, scale.lines, scale.near_line_width) l;
$$;

-- ---- gradebook_cells: staff and students, one answer ----------------------------------------------------
CREATE FUNCTION gradebook_cells(p_course_offering uuid, p_scope text DEFAULT 'final')
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
  points_earned          numeric,
  points_possible        numeric,
  due_at                 timestamptz,
  deadline_source        text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('final', 'prog') THEN
    RAISE EXCEPTION 'gradebook_cells: scope must be final or prog' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_course_offering IN (SELECT staff_offerings()) THEN
    RETURN QUERY
      SELECT c.enrollment_id, c.section_id, c.student_id, c.assignment_offering_id, c.state,
             c.has_draft_score, c.is_late, c.no_work_received, c.deadline_invalid, c.late_closed,
             c.points_earned, c.points_possible, c.due_at, c.deadline_source
        FROM _cells_at(p_course_offering, p_scope, now()) c
       WHERE c.section_id IN (SELECT staff_sections());
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM enrollments e JOIN sections s ON s.id = e.section_id
              WHERE e.id IN (SELECT my_enrollments()) AND s.course_offering_id = p_course_offering) THEN
    RETURN QUERY
      SELECT c.enrollment_id, c.section_id, c.student_id, c.assignment_offering_id,
             CASE WHEN c.state = 'graded_unreleased' THEN 'submitted_ungraded' ELSE c.state END,
             false, c.is_late, false, false, c.late_closed,
             CASE WHEN c.state = 'released' OR (c.state = 'in_progress' AND c.auto_checked)
                  THEN c.points_earned END,
             c.points_possible, c.due_at, c.deadline_source
        FROM _cells_at(p_course_offering, p_scope, now()) c
       WHERE c.enrollment_id IN (SELECT my_enrollments());
    RETURN;
  END IF;

  RAISE EXCEPTION 'gradebook_cells: not permitted' USING ERRCODE = 'insufficient_privilege';
END; $$;

-- ---- course_totals: staff ---------------------------------------------------------------------------------
CREATE FUNCTION course_totals(p_course_offering uuid, p_scope text DEFAULT 'final')
RETURNS TABLE (
  enrollment_id          uuid,
  section_id             uuid,
  student_id             bigint,
  earned_text            text,
  possible_text          text,
  percent_text           text,
  percent_key_text       text,
  letter                 text,
  gpa                    numeric,
  near_line_letter       text,
  rank                   integer,
  tie_group              text,
  missing_count          integer,
  ungraded_count         integer,
  unreleased_count       integer,
  excused_count          integer,
  bonus_only             boolean,
  no_work_count          integer,
  invalid_deadline_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('final', 'prog') THEN
    RAISE EXCEPTION 'course_totals: scope must be final or prog' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT staff_offerings()) THEN
    RAISE EXCEPTION 'course_totals: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT t.enrollment_id, t.section_id, t.student_id, t.earned_text, t.possible_text, t.percent_text,
           t.percent_key_text, t.letter, t.gpa, t.near_line_letter, t.rank, t.tie_group,
           t.missing_count, t.ungraded_count, t.unreleased_count, t.excused_count,
           t.bonus_only, t.no_work_count, t.invalid_deadline_count
      FROM _totals_at(p_course_offering, p_scope, now()) t
     WHERE t.section_id IN (SELECT staff_sections());
END; $$;

-- ---- my_course_total: the student -----------------------------------------------------------------------------
CREATE FUNCTION my_course_total(p_course_offering uuid, p_scope text DEFAULT 'final')
RETURNS TABLE (earned_text text, possible_text text, percent_text text, percent_key_text text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('final', 'prog') THEN
    RAISE EXCEPTION 'my_course_total: scope must be final or prog' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT t.earned_text, t.possible_text, t.percent_text, t.percent_key_text
      FROM _totals_at(p_course_offering, p_scope, now()) t
     WHERE t.enrollment_id IN (SELECT my_enrollments());
END; $$;

-- ---- scale_change_preview: Directors ------------------------------------------------------------------------------
CREATE FUNCTION scale_change_preview(p_course_offering uuid, p_lines jsonb, p_width numeric)
RETURNS TABLE (
  enrollment_id        uuid,
  section_id           uuid,
  student_id           bigint,
  percent_text         text,
  old_letter           text,
  new_letter           text,
  old_near_line_letter text,
  new_near_line_letter text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT director_offerings()) THEN
    RAISE EXCEPTION 'scale_change_preview: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT letter_scale_is_valid(p_lines, p_width) THEN
    RAISE EXCEPTION 'scale_change_preview: that is not a usable scale' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
    SELECT t.enrollment_id, t.section_id, t.student_id, t.percent_text,
           t.letter, n.letter, t.near_line_letter, n.near_line_letter
      FROM _totals_at(p_course_offering, 'final', now()) t
      CROSS JOIN LATERAL _letter_for(t.earned, t.possible, p_lines, p_width) n
     WHERE t.letter IS DISTINCT FROM n.letter OR t.near_line_letter IS DISTINCT FROM n.near_line_letter;
END; $$;

COMMENT ON FUNCTION _cells_at(uuid, text, timestamptz) IS
  'Internal. One row per enrollment and published item with its state (excused, released, graded_unreleased, '
  'submitted_ungraded, missing, in_progress, not_due), flags and what it adds to the total. See the file header.';
COMMENT ON FUNCTION _totals_at(uuid, text, timestamptz) IS
  'Internal. One row per active or completed enrollment: exact earned and possible, percent text, letter, GPA, near-line '
  'letter, competition rank and tie group, and counts. The only place a total is computed.';

-- ---- grants: by name ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _cells_at(uuid, text, timestamptz)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _totals_at(uuid, text, timestamptz)   FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION gradebook_cells(uuid, text)           FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION course_totals(uuid, text)             FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION my_course_total(uuid, text)           FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION scale_change_preview(uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

GRANT EXECUTE ON FUNCTION _cells_at(uuid, text, timestamptz)  TO prep_app_read;
GRANT EXECUTE ON FUNCTION _totals_at(uuid, text, timestamptz) TO prep_app_read;
GRANT EXECUTE ON FUNCTION scale_change_preview(uuid, jsonb, numeric) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be false for every browser-facing role at step 1
--   SELECT r, has_function_privilege(r, 'app.gradebook_cells(uuid,text)', 'EXECUTE')
--     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
--
--   -- the rule on a real offering, over the read role (prints counts and codes only)
--   SELECT state, count(*) FROM app._cells_at('<course offering uuid>', 'final', now()) GROUP BY 1;
