-- PREP v2 step 2 -- a section transfer keeps a blank where it was
-- =====================================================================================
-- Run as `prep_app_owner`, under the coordination gate. Depends on 001 (enrollments), 034 (column_closures) and
-- 039 (_cells_at). Design: docs/decisions/GRADE-RULES.md (Missing, Ungraded) and docs/decisions/V2-DATA-MODEL.md
-- section 7 (the states) and section 8 (section moves).
--
-- THE PROBLEM
--   A blank on an item that takes no submission counts 0 once a person closes that column for a section, and leaves
--   the total until then. Closing is per section, and a transfer is an in-place update of enrollments.section_id.
--   So a cadet moved from a closed section to an open one changed from a counted 0 to "awaiting entry" (out of the
--   total), and a cadet moved the other way gained a 0. Nothing recorded the move, so the total changed with no
--   event. The plan says a transfer keeps past grades and deadlines; this keeps the same for the closed-or-open state.
--
-- WHAT IT ADDS
--   closure_carry (enrollment_id, assignment_offering_id, closed, from_section_id, carried_at)
--       One row where a transferred cadet's state for an item differs from the state of the section they are in now.
--       `closed` is the state they had. No row means "follow the section", which is the whole of the old rule.
--   enrollments_closure_carry   AFTER UPDATE OF section_id on enrollments. For each item of the offering it compares
--       the state the cadet had (an existing carry row, else the old section's closure) with the new section's. If
--       they differ it stores a carry row; if they match it removes any. A move to a section of another course
--       offering clears the cadet's carry rows. A second move starts from the state the cadet had, not from the
--       section they just left.
--   column_closures_release_carry   AFTER INSERT OR UPDATE OF reopened_at on column_closures. A person closing or
--       reopening an item's column in a section removes the carry rows of the cadets in that section for that item,
--       so from then on those cadets follow the section like everyone else there. The carry holds only until a
--       person acts on that column in the cadet's current section.
--   _cells_at (replaced, same signature and columns). The ONE changed expression is `closed`: a carry row, when
--       there is one, else the section's open closure. Nothing else in the function moves.
--
-- WHAT IT DOES NOT DO
--   It does not change a score, a grade row, a deadline or an extension. It does not backfill: moves made before
--   this file are not recorded anywhere, so no stored state moves when it is applied. It does not decide a late
--   rule or an excusal. It does not add a policy or a grant: the table is read by the definer functions that call
--   _cells_at, and by no browser role.
--
-- GRANTS   closure_carry: row level security on, no policy, all privileges revoked from anon, authenticated and
--          service_role. The two trigger functions need no grant and have every execute right revoked.
-- THE CURRENT SITE   Nothing reads closure_carry. The grade pages read totals through the database functions, so
--          they pick the change up with no edit.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE TABLE closure_carry (
  enrollment_id          uuid        NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid        NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  closed                 boolean     NOT NULL,
  from_section_id        uuid        REFERENCES sections(id) ON DELETE SET NULL,
  carried_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, assignment_offering_id)
);

CREATE INDEX closure_carry_item_idx ON closure_carry (assignment_offering_id);

COMMENT ON TABLE closure_carry IS
  'A transferred cadet''s closed-or-open state for one item, kept when it differs from the state of the section they '
  'moved into. Removed when a person closes or reopens that column in the cadet''s current section. Written only by '
  'triggers.';

ALTER TABLE closure_carry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON closure_carry FROM anon, authenticated, service_role;

-- ---- the cell rule: _cells_at, with one expression changed -------------------------------------------

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
           -- 066: a cadet moved between sections keeps the closed-or-open state they had (closure_carry), until a
           -- person next closes or reopens that column in the section they are in now. Otherwise the section's own.
           coalesce((SELECT cy.closed FROM closure_carry cy
                      WHERE cy.enrollment_id = enr.id AND cy.assignment_offering_id = i.id),
                    EXISTS (SELECT 1 FROM column_closures cc
                             WHERE cc.assignment_offering_id = i.id AND cc.section_id = enr.section_id
                               AND cc.reopened_at IS NULL)) AS closed,
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

-- ---- keep the state on a transfer ----------------------------------------------------------------------
CREATE FUNCTION closure_carry_on_move() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_old_co uuid;
  v_new_co uuid;
  r        record;
BEGIN
  SELECT s.course_offering_id INTO v_old_co FROM sections s WHERE s.id = OLD.section_id;
  SELECT s.course_offering_id INTO v_new_co FROM sections s WHERE s.id = NEW.section_id;
  IF v_old_co IS DISTINCT FROM v_new_co THEN
    DELETE FROM closure_carry WHERE enrollment_id = NEW.id;
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT ao.id AS item,
           coalesce((SELECT cy.closed FROM closure_carry cy
                      WHERE cy.enrollment_id = NEW.id AND cy.assignment_offering_id = ao.id),
                    EXISTS (SELECT 1 FROM column_closures cc
                             WHERE cc.assignment_offering_id = ao.id AND cc.section_id = OLD.section_id
                               AND cc.reopened_at IS NULL)) AS was_closed,
           EXISTS (SELECT 1 FROM column_closures cc
                    WHERE cc.assignment_offering_id = ao.id AND cc.section_id = NEW.section_id
                      AND cc.reopened_at IS NULL) AS now_closed
      FROM assignment_offerings ao
     WHERE ao.course_offering_id = v_new_co
  LOOP
    IF r.was_closed IS DISTINCT FROM r.now_closed THEN
      INSERT INTO closure_carry (enrollment_id, assignment_offering_id, closed, from_section_id)
      VALUES (NEW.id, r.item, r.was_closed, OLD.section_id)
      ON CONFLICT (enrollment_id, assignment_offering_id)
      DO UPDATE SET closed = EXCLUDED.closed, from_section_id = EXCLUDED.from_section_id, carried_at = now();
    ELSE
      DELETE FROM closure_carry WHERE enrollment_id = NEW.id AND assignment_offering_id = r.item;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER enrollments_closure_carry
  AFTER UPDATE OF section_id ON enrollments
  FOR EACH ROW WHEN (OLD.section_id IS DISTINCT FROM NEW.section_id)
  EXECUTE FUNCTION closure_carry_on_move();

-- ---- a person's act in the section ends the carry -------------------------------------------------------
CREATE FUNCTION closure_carry_release() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  DELETE FROM closure_carry cy
   USING enrollments e
   WHERE cy.assignment_offering_id = NEW.assignment_offering_id
     AND e.id = cy.enrollment_id
     AND e.section_id = NEW.section_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER column_closures_release_carry
  AFTER INSERT OR UPDATE OF reopened_at ON column_closures
  FOR EACH ROW EXECUTE FUNCTION closure_carry_release();

REVOKE ALL ON FUNCTION closure_carry_on_move()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION closure_carry_release()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT count(*) FROM app.closure_carry;     -- 0 until a cadet is moved between sections that differ on a closure
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('enrollments_closure_carry', 'column_closures_release_carry');  -- two rows
