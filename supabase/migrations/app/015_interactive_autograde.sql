-- PREP v2 — an interactive submission grades itself the moment it commits
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql and 014_effort_grades_per_row.sql.
--
-- WHY THIS EXISTS
--   Effort IS the grade for an interactive lesson, and the artifact already assessed it — there is
--   nothing for a human to decide. So a committed interactive submission should carry its grade
--   immediately, with nothing to run, exactly the way the legacy `public` system did it (a trigger
--   turned effort into a score on write). The `app` redesign dropped that and left grading to an
--   explicit staff/script step; this restores the automatic behaviour the director asked for.
--
--   The missing piece was never the arithmetic — 014's trigger already turns effort into points.
--   It was that NOTHING created the grade row. A student's browser can't (RLS: grades_staff_write),
--   so the create has to happen server-side. This trigger is that server-side step.
--
-- WHAT IT DOES, IN ONE SENTENCE
--   When a submission commits to an interactive activity that is a GRADED path this term, copy the
--   effort from the report onto a finalized grade row; 014's trigger fills in the points.
--
-- THE FOUR RULES, each a way it could go wrong:
--
--   1. GRADED PATHS ONLY. If the chosen activity is `practice` (grading_role), no grade — a cadet
--      who ran the lesson for practice and asked the artifact to generate a report has NOT earned a
--      grade, because the assignment says that path does not count. This is the director's rule:
--      "if the assignment says it's not allowed, then no grade from it."
--
--   2. AUTO-FINAL, and student-visible. `is_finalized = true`, `source = 'derived'`. There is no
--      review queue for these (source is not 'ai_suggested'), because there is nothing to review —
--      the effort is the grade. An instructor can still reopen one from the Grade tab if a report
--      looks tampered; the report Markdown is the audit trail (INTERACTION-DATA-CONTRACT §7).
--
--   3. THE §5.2 READING-REFLECTION CAP is re-applied HERE, server-side. The effort rides in a URL
--      hash the student controls, so trusting the artifact to have capped it is not enough: if
--      `reading_reflection.meaningful` is false, effort is clamped to 2 before it becomes a grade.
--
--   4. A HUMAN-GRADED RESPONSE IS NEVER CLOBBERED. If a finalized grade already exists from an
--      instructor or an import, this leaves it alone (the ON CONFLICT ... WHERE below). "Auto-grade
--      the interaction as long as there wasn't a response already graded" — the director's rule.
--      A prior DERIVED grade (an earlier interactive submission) IS replaced, so a re-submit works.
--
-- SECURITY
--   SECURITY DEFINER, owned by prep_app_owner, so it can write `grades` past the student's RLS.
--   That is a privilege boundary, so it is deliberately narrow: it only ever writes ONE grade, for
--   the SAME enrolment+offering as the submission that fired it — and a student can only commit
--   their own submission (submissions RLS), so the trigger can only ever grade that student's own
--   row. It reads effort from that submission's own activity content and nothing else. `search_path`
--   is pinned so the definer cannot be hijacked through a mutable path. grades has RLS ENABLED but
--   not FORCED, so the owning definer bypasses it (verified against 002_rls.sql before writing).
--
-- RELATION TO grade_interactive.py
--   The script becomes a BACKFILL tool — for interactive work that committed before this trigger
--   existed, or that a config change makes gradable after the fact. For every live commit from here
--   on, the trigger has already done it. Both write the identical row (effort, derived, finalized).
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION grade_interactive_on_commit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
DECLARE
  v_modality  text;
  v_role      text;
  v_pp        numeric(6,2);
  v_content   jsonb;
  v_effort    int;
BEGIN
  -- Only a committed submission that chose an activity is a candidate.
  IF NEW.status <> 'committed' OR NEW.chosen_activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Rule 1: the chosen activity must be an INTERACTIVE, GRADED path on THIS offering.
  SELECT act.modality, oa.grading_role, ao.points_possible
    INTO v_modality, v_role, v_pp
    FROM offering_activities oa
    JOIN activities           act ON act.id = oa.activity_id
    JOIN assignment_offerings ao  ON ao.id  = oa.assignment_offering_id
   WHERE oa.assignment_offering_id = NEW.assignment_offering_id
     AND oa.activity_id            = NEW.chosen_activity_id;

  IF v_modality IS DISTINCT FROM 'interactive' OR v_role IS DISTINCT FROM 'graded' THEN
    RETURN NEW;   -- written commits are graded by a human; practice never grades
  END IF;

  -- The effort lives in the report the artifact posted onto the chosen activity.
  SELECT sa.content INTO v_content
    FROM submission_activities sa
   WHERE sa.submission_id = NEW.id AND sa.activity_id = NEW.chosen_activity_id;

  -- Accept effort only as a plain integer 0-5; anything else means "no gradable effort", so leave
  -- the submission ungraded rather than inventing a score. IS DISTINCT FROM (not <>) is load-
  -- bearing: when 'effort' is absent, jsonb_typeof(...) is SQL NULL, and `NULL <> 'number'` is
  -- NULL — which is not TRUE, so a plain <> would fall THROUGH the guard and grade a NULL effort.
  -- IS DISTINCT FROM treats NULL as a value, so an absent or json-null effort is rejected here.
  IF v_content IS NULL
     OR jsonb_typeof(v_content->'effort') IS DISTINCT FROM 'number'
     OR (v_content->>'effort') !~ '^-?\d+$' THEN
    RETURN NEW;
  END IF;
  v_effort := (v_content->>'effort')::int;
  IF v_effort < 0 OR v_effort > 5 THEN
    RETURN NEW;
  END IF;

  -- Rule 3: the reading-reflection cap, re-applied server-side.
  IF (v_content #>> '{reading_reflection,meaningful}') = 'false' AND v_effort > 2 THEN
    v_effort := 2;
  END IF;

  -- Rules 2 + 4: write a finalized derived grade, but never over a human-graded one. 014's
  -- grades_effort trigger derives points_earned from the effort we set here; question_scores stays
  -- '{}' so grades_one_grading_mechanism is satisfied.
  --
  -- `diagnostic` gets the report's schema:1 payload, the same shape /preflight-analyze writes for a
  -- written taker. That is what lets the gradebook and per-student page read an interactive taker's
  -- UNDERSTANDING (and misconceptions) the same way they read a written one's — without either page
  -- fetching submission_activities. The rollup still reads the artifact's copy on the submission;
  -- this copy is the graded one, exactly the two-producer arrangement the written path already uses.
  INSERT INTO grades (enrollment_id, assignment_offering_id, submission_id,
                      effort, points_possible, question_scores, diagnostic, source, is_finalized)
       VALUES (NEW.enrollment_id, NEW.assignment_offering_id, NEW.id,
               v_effort, v_pp, '{}'::jsonb, v_content, 'derived', true)
  ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE
        SET effort          = EXCLUDED.effort,
            submission_id   = EXCLUDED.submission_id,
            question_scores = '{}'::jsonb,
            diagnostic      = EXCLUDED.diagnostic,
            source          = 'derived',
            is_finalized    = true,
            updated_at      = now()
      WHERE grades.is_finalized = false      -- an unreleased draft: fine to replace
         OR grades.source = 'derived';       -- a prior interactive grade: this is a re-submit

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION grade_interactive_on_commit() IS
  'Auto-grades a committed interactive submission from its report effort (capped per contract §5.2), '
  'finalized and student-visible, source=derived. GRADED interactive activities only; never '
  'overwrites a finalized instructor/imported grade. SECURITY DEFINER because a student cannot write '
  'grades under RLS; scoped to the firing submission''s own enrolment+offering.';

DROP TRIGGER IF EXISTS submissions_autograde_interactive ON submissions;
CREATE TRIGGER submissions_autograde_interactive
  AFTER INSERT OR UPDATE OF status, chosen_activity_id ON submissions
  FOR EACH ROW
  WHEN (NEW.status = 'committed' AND NEW.chosen_activity_id IS NOT NULL)
  EXECUTE FUNCTION grade_interactive_on_commit();

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the trigger exists and is enabled
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'app.submissions'::regclass AND NOT tgisinternal;
--
--   -- end to end, in a rolled-back transaction, via the DML tier:
--   .venv/Scripts/python supabase/admin/autograde_interactive_test.py
-- =====================================================================================
