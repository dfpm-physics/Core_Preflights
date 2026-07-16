-- Migration 021: Phase 2 — finalize lifecycle, extension-aware due cutoff, RLS repair
-- ============================================================
-- Phase 2 of docs/architecture/LESSON-UNIFICATION.md, continuing from 016 (which created
-- `lessons` + `lesson_completions` and deliberately deferred everything below).
--
-- WHAT THIS DOES
--   1. `responses.is_final` — the preflight draft/final flag (D9). Today Submit and autosave
--      issue the identical upsert, so Submit means nothing; this is what gives it meaning.
--   2. Mint triggers — create the `lesson_completions` row when either path finalizes
--      (first-finalize-wins), so the frozen artifact receiver is never touched.
--   3. Extension-aware due cutoff (D8) — a lesson's effective deadline per student, honouring
--      instructor-granted extensions, enforced in the DB rather than in client JS.
--   4. Lazy promotion — a late write finalizes the pre-deadline draft instead of saving the
--      late edit, so nobody is stranded in the window before the /preflight-analyze sweep.
--   5. RLS repair — the policies under `responses` and `extensions` predate student auth
--      (migration 004) and are wide open. See the RLS section for the specifics.
--
-- NOT APPLIED. Review before running in the Supabase SQL Editor. Idempotent.
-- Coordinate per CORE.md §0 (no concurrent DDL) and log in CHANGELOG.md.
--
-- ⚠ VERIFY BEFORE RUNNING: `SELECT count(*) FROM responses;`
--    `is_final` defaults FALSE, which treats every existing row as a draft. That is correct
--    if `responses` is empty/near-empty (Fall 2026 has not started). If real historical
--    submissions exist, decide the backfill explicitly first — under the pre-021 model an
--    autosaved abandoned draft and a deliberate submit are INDISTINGUISHABLE, so no query
--    can separate them after the fact.
-- ============================================================


-- ============================================================
-- 0. Helper: course-manager check.
-- Mirrors the 3-way test migration 016 inlines (global admin OR legacy global director flag
-- OR a per-course director row). Named `lu_` so it neither depends on nor overwrites the
-- older is_director()/is_instructor() helpers in rls.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION lu_is_course_manager()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
      OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
      OR EXISTS (SELECT 1 FROM instructor_course_access
                  WHERE instructor_id = auth.uid() AND role = 'director');
$$;

CREATE OR REPLACE FUNCTION lu_is_instructor()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid());
$$;

-- Students in the calling instructor's own sections.
CREATE OR REPLACE FUNCTION lu_my_student_ids()
RETURNS TABLE(student_id BIGINT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT st.student_id FROM students st
    JOIN sections sec ON sec.id = st.section_id
   WHERE sec.instructor_id = auth.uid();
$$;


-- ============================================================
-- 1. responses.is_final — the draft/final flag (D9)
-- ============================================================
ALTER TABLE responses ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS responses_final_idx ON responses (assignment_id, is_final);


-- ============================================================
-- 2. extensions — lesson scope, so an extension can cover a lesson rather than only an
--    assignment. An interaction-only lesson has preflight_id IS NULL, so under the old
--    `assignment_id NOT NULL` shape there was no legal row to insert and it could not be
--    extended at all.
--
--    Exactly one of (assignment_id, lesson_id) is set:
--      · lesson_id     → the lesson (both paths). The forward-looking shape.
--      · assignment_id → an orphan assignment not yet placed in a lesson (legacy; also what
--                        the current Grade-tab button writes, which keeps working).
-- ============================================================
ALTER TABLE extensions ALTER COLUMN assignment_id DROP NOT NULL;
ALTER TABLE extensions ADD COLUMN IF NOT EXISTS lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE;

-- granted_by is the audit trail directors read. Default it server-side and (below) require
-- it to equal the caller, so it cannot be forged by a hand-rolled REST call.
ALTER TABLE extensions ALTER COLUMN granted_by SET DEFAULT auth.uid();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extensions_one_scope') THEN
    ALTER TABLE extensions ADD CONSTRAINT extensions_one_scope
      CHECK (num_nonnulls(assignment_id, lesson_id) = 1);
  END IF;
END $$;

-- The table's original UNIQUE(student_id, assignment_id) no longer constrains lesson-scoped
-- rows (NULLs compare distinct), so give the lesson scope its own partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS extensions_student_lesson_key
  ON extensions (student_id, lesson_id) WHERE lesson_id IS NOT NULL;


-- ============================================================
-- 3. Effective deadline for a student on a lesson.
--
-- Base deadline is picked by the student's section day (M-day sections use due_date_m, T-day
-- due_date_t — the section id's first letter, per the [M|T][1|3|5][A-D] convention).
--
-- An extension REPLACES the base deadline (the instructor's grant is authoritative; it is not
-- required to be later). Resolution order:
--   1. a lesson-scoped extension for this lesson;
--   2. else an assignment-scoped extension on this lesson's preflight — honoured LESSON-WIDE,
--      i.e. it extends the interaction path too. Extending only the preflight in a `choice`
--      lesson would quietly push extended students toward one modality and contaminate the
--      revealed-preference signal the whole design exists to measure (LESSON-UNIFICATION §1).
--
-- NULL return = no deadline configured = never past due.
-- ============================================================
CREATE OR REPLACE FUNCTION lesson_due_for_student(p_lesson_id TEXT, p_student_id BIGINT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_day       TEXT;
  v_base      TIMESTAMPTZ;
  v_preflight TEXT;
  v_ext       TIMESTAMPTZ;
BEGIN
  SELECT LEFT(s.section_id, 1) INTO v_day
    FROM students s WHERE s.student_id = p_student_id;

  SELECT CASE WHEN v_day = 'M' THEN l.due_date_m ELSE l.due_date_t END, l.preflight_id
    INTO v_base, v_preflight
    FROM lessons l WHERE l.id = p_lesson_id;

  SELECT e.extended_due_date INTO v_ext
    FROM extensions e
   WHERE e.student_id = p_student_id
     AND (e.lesson_id = p_lesson_id
          OR (v_preflight IS NOT NULL AND e.assignment_id = v_preflight))
   ORDER BY (e.lesson_id IS NOT NULL) DESC   -- lesson scope wins over assignment scope
   LIMIT 1;

  RETURN COALESCE(v_ext, v_base);
END;
$$;

-- Is an instructor-granted extension currently open for this (student, lesson)?
-- This is the switch that re-opens a finalized lesson: an instructor's grant trumps the
-- path-lock and first-finalize-wins, per the 2026-07-16 decision.
CREATE OR REPLACE FUNCTION lesson_extension_active(p_lesson_id TEXT, p_student_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_preflight TEXT;
  v_open      BOOLEAN;
BEGIN
  SELECT l.preflight_id INTO v_preflight FROM lessons l WHERE l.id = p_lesson_id;

  SELECT EXISTS (
    SELECT 1 FROM extensions e
     WHERE e.student_id = p_student_id
       AND e.extended_due_date > NOW()
       AND (e.lesson_id = p_lesson_id
            OR (v_preflight IS NOT NULL AND e.assignment_id = v_preflight))
  ) INTO v_open;

  RETURN COALESCE(v_open, FALSE);
END;
$$;


-- ============================================================
-- 4. PREFLIGHT PATH — write guard + mint
-- ============================================================

-- Guard: enforce the deadline server-side, and implement lazy promotion.
--
-- Past the effective deadline, a late write is NOT rejected outright — it is converted into a
-- promotion of whatever the student had at the deadline. The realistic case is a cadet who
-- left the page open across the cutoff and kept typing: their pre-deadline work finalizes and
-- the late edit is discarded. This only matters in the window before the /preflight-analyze
-- sweep finalizes leftover drafts; after the sweep the row is already final and the write is
-- refused.
--
-- Orphan assignments (no owning lesson) are untouched — legacy standalone behaviour.
CREATE OR REPLACE FUNCTION responses_due_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lesson TEXT;
  v_due    TIMESTAMPTZ;
BEGIN
  SELECT l.id INTO v_lesson FROM lessons l WHERE l.preflight_id = NEW.assignment_id LIMIT 1;
  IF v_lesson IS NULL THEN
    RETURN NEW;
  END IF;

  v_due := lesson_due_for_student(v_lesson, NEW.student_id);

  -- The INTERACTION is the only lock. Once a report is submitted the choice is final: the
  -- written answers are frozen (kept as research data, but superseded — see
  -- pir_mint_completion). An instructor's extension overrides this, as it overrides everything.
  IF EXISTS (SELECT 1 FROM lesson_completions lc
              WHERE lc.lesson_id = v_lesson
                AND lc.student_id = NEW.student_id
                AND lc.path = 'interaction')
     AND NOT lesson_extension_active(v_lesson, NEW.student_id) THEN
    -- Allow a write that doesn't touch the answers. The superseded row keeps its content
    -- forever, but bookkeeping still has to reach it — notably the /preflight-analyze sweep
    -- flipping is_final on leftover drafts, which would otherwise abort the whole run the
    -- first time it met a student who had switched paths.
    IF TG_OP = 'UPDATE' AND NEW.answers IS NOT DISTINCT FROM OLD.answers THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Lesson % is already final for student % via the interactive path',
      v_lesson, NEW.student_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_due IS NULL OR NOW() <= v_due THEN
    RETURN NEW;             -- open: freely editable until the deadline, submitted or not
  END IF;

  IF TG_OP = 'INSERT' THEN                       -- nothing existed to promote
    RAISE EXCEPTION 'Lesson % is past due for student % — no submission accepted',
      v_lesson, NEW.student_id USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.is_final THEN
    RAISE EXCEPTION 'Lesson % is past due and already final for student %',
      v_lesson, NEW.student_id USING ERRCODE = 'check_violation';
  END IF;

  NEW.answers  := OLD.answers;                   -- discard the late edit
  NEW.is_final := TRUE;                          -- finalize what existed at the deadline
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS responses_due_guard_trg ON responses;
CREATE TRIGGER responses_due_guard_trg
  BEFORE INSERT OR UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION responses_due_guard();


-- Mint the completion row when a preflight finalizes.
--
-- NOTE: fires on INSERT **and** UPDATE. LESSON-UNIFICATION §7 specifies AFTER UPDATE only,
-- which is wrong for the live client: the page upserts, so a first-time submit INSERTs with
-- is_final=true and would never fire an UPDATE trigger — the student would silently get no
-- completion row and no grade.
CREATE OR REPLACE FUNCTION responses_mint_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lesson TEXT;
  v_policy TEXT;
  v_due    TIMESTAMPTZ;
  v_by     TEXT;
BEGIN
  IF NOT NEW.is_final THEN RETURN NULL; END IF;                       -- still a draft
  IF TG_OP = 'UPDATE' AND OLD.is_final THEN RETURN NULL; END IF;      -- already finalized

  SELECT l.id, l.completion_policy INTO v_lesson, v_policy
    FROM lessons l WHERE l.preflight_id = NEW.assignment_id LIMIT 1;

  IF v_lesson IS NULL THEN RETURN NULL; END IF;                       -- orphan assignment
  -- §5: a component may be attached as optional practice under a single-path policy.
  -- Only the named path grades.
  IF v_policy NOT IN ('preflight', 'choice') THEN RETURN NULL; END IF;

  v_due := lesson_due_for_student(v_lesson, NEW.student_id);
  v_by  := CASE WHEN v_due IS NOT NULL AND NOW() > v_due THEN 'auto' ELSE 'student' END;

  -- A preflight never overwrites an existing completion on its own: an interaction completion
  -- is already refused by responses_due_guard, and a preflight completion means is_final was
  -- already true so this trigger returned above. The DO UPDATE therefore only fires for the
  -- instructor-extension case, where the resubmission replaces the old grade.
  -- Effort/understanding/report_data reset to NULL because /preflight-analyze must re-grade it.
  INSERT INTO lesson_completions (lesson_id, student_id, path, finalized_by)
  VALUES (v_lesson, NEW.student_id, 'preflight', v_by)
  ON CONFLICT (student_id, lesson_id) DO UPDATE
     SET path          = EXCLUDED.path,
         finalized_by  = EXCLUDED.finalized_by,
         effort        = NULL,
         understanding = NULL,
         report_data   = NULL,
         completed_at  = NOW()
   WHERE lesson_extension_active(lesson_completions.lesson_id, lesson_completions.student_id);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS responses_mint_completion_trg ON responses;
CREATE TRIGGER responses_mint_completion_trg
  AFTER INSERT OR UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION responses_mint_completion();


-- ============================================================
-- 5. INTERACTION PATH — write guard + mint
--
-- The frozen artifact contract is untouched: the artifact still posts #t/#i/#r/#d into the
-- URL hash. This gates only what the receiver may WRITE. Reads and launch links are never
-- gated — study mode must keep working after the deadline (D8).
-- ============================================================

-- Guard: no writes past the effective deadline; insert-once (D9) unless an extension re-opens
-- the lesson. Nothing exists in the DB until Submit, so there is no draft to promote — a late
-- interaction submit is simply refused. That is D9's known trade-off, now load-bearing.
CREATE OR REPLACE FUNCTION pir_due_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lesson TEXT;
  v_due    TIMESTAMPTZ;
BEGIN
  SELECT l.id INTO v_lesson FROM lessons l WHERE l.interaction_id = NEW.interaction_id LIMIT 1;
  IF v_lesson IS NULL THEN
    RETURN NEW;                                  -- standalone interaction: legacy behaviour
  END IF;

  v_due := lesson_due_for_student(v_lesson, NEW.student_id);

  IF v_due IS NOT NULL AND NOW() > v_due THEN
    RAISE EXCEPTION 'Lesson % is past due for student % — report not saved',
      v_lesson, NEW.student_id USING ERRCODE = 'check_violation';
  END IF;

  -- Insert-once: a submitted report may only be overwritten while an extension is open.
  IF TG_OP = 'UPDATE'
     AND NOT lesson_extension_active(v_lesson, NEW.student_id)
     AND EXISTS (SELECT 1 FROM lesson_completions lc
                  WHERE lc.lesson_id = v_lesson AND lc.student_id = NEW.student_id) THEN
    RAISE EXCEPTION 'Lesson % is already final for student % — report not replaced',
      v_lesson, NEW.student_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pir_due_guard_trg ON preflight_interaction_reports;
CREATE TRIGGER pir_due_guard_trg
  BEFORE INSERT OR UPDATE ON preflight_interaction_reports
  FOR EACH ROW EXECUTE FUNCTION pir_due_guard();


-- Mint on interaction Submit. Fires on UPDATE too, so an extension-reopened resubmit (which
-- upserts onto the existing UNIQUE(student_id, interaction_id) row) still re-grades.
CREATE OR REPLACE FUNCTION pir_mint_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lesson TEXT;
  v_policy TEXT;
  v_due    TIMESTAMPTZ;
  v_by     TEXT;
BEGIN
  SELECT l.id, l.completion_policy INTO v_lesson, v_policy
    FROM lessons l WHERE l.interaction_id = NEW.interaction_id LIMIT 1;

  IF v_lesson IS NULL THEN RETURN NULL; END IF;
  IF v_policy NOT IN ('interaction', 'choice') THEN RETURN NULL; END IF;

  v_due := lesson_due_for_student(v_lesson, NEW.student_id);
  v_by  := CASE WHEN v_due IS NOT NULL AND NOW() > v_due THEN 'auto' ELSE 'student' END;

  -- The interaction already carries effort + the schema:1 blob, so copy them straight onto
  -- the completion (points derive via lc_score_from_effort). §8: lesson_completions.report_data
  -- is the unified merge surface for the rollup.
  INSERT INTO lesson_completions (lesson_id, student_id, path, effort, understanding,
                                  report_data, finalized_by)
  VALUES (v_lesson, NEW.student_id, 'interaction', NEW.effort,
          NULLIF(NEW.report_data->>'overall_understanding', '')::SMALLINT,
          NEW.report_data, v_by)
  ON CONFLICT (student_id, lesson_id) DO UPDATE
     SET path          = EXCLUDED.path,
         effort        = EXCLUDED.effort,
         understanding = EXCLUDED.understanding,
         report_data   = EXCLUDED.report_data,
         finalized_by  = EXCLUDED.finalized_by,
         completed_at  = NOW()
     -- The interaction SUPERSEDES a written preflight — that is the student's choice, and it is
     -- one-way (lc_lock_path blocks interaction -> preflight). An existing interaction
     -- completion is only replaceable while an instructor's extension is open.
   WHERE lesson_completions.path = 'preflight'
      OR lesson_extension_active(lesson_completions.lesson_id, lesson_completions.student_id);

  -- The written path is SUPERSEDED, not deleted. The `responses` row stays so D5/§13 "did both"
  -- detection keeps working — a student who wrote answers and then switched stays
  -- distinguishable from one who never wrote any. responses_due_guard freezes the row from here
  -- (the student can't change their choice), so it is inert research data.
  --
  -- Nothing flags the row: supersession is DERIVED, so it cannot drift. A `responses` row is
  -- non-grading iff its lesson has a lesson_completions row with path='interaction'. The one
  -- grade per student per lesson is lesson_completions, guaranteed by UNIQUE(student_id,
  -- lesson_id) — this row never carries a grade.
  --
  -- Consumers MUST honour that:
  --   · the grading tab hides these responses — the interaction is already auto-graded from
  --     effort, so there is nothing for a human to grade (Phase 6);
  --   · /preflight-analyze must skip them entirely — no `scores` row, no completion. Otherwise
  --     it writes per-question scores the student would see on a submission that doesn't
  --     count (Phase 3).
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pir_mint_completion_trg ON preflight_interaction_reports;
CREATE TRIGGER pir_mint_completion_trg
  AFTER INSERT OR UPDATE ON preflight_interaction_reports
  FOR EACH ROW EXECUTE FUNCTION pir_mint_completion();


-- ============================================================
-- 6. The path lock becomes DIRECTIONAL.
--
-- 016's lc_lock_path made `path` immutable in both directions ("first finalize wins"). The
-- 2026-07-16 decision replaces that with an asymmetric rule matching how students actually
-- move between the two paths:
--
--   preflight -> interaction   ALLOWED. The written path stays editable until the deadline, so
--                              a student may switch at any point; submitting the report is the
--                              switch (and erases their answers).
--   interaction -> preflight   BLOCKED. Once the report is submitted the choice is final.
--
-- An instructor's extension overrides both directions.
--
-- Deliberately NOT done: deleting the completion row when an extension is granted. That would
-- silently zero a student who already had a grade and never comes back — an extension must
-- never be able to LOWER a grade. The existing grade stands until a real resubmission
-- replaces it.
-- ============================================================
CREATE OR REPLACE FUNCTION lc_lock_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.path = OLD.path THEN
    RETURN NEW;
  END IF;
  IF OLD.path = 'preflight' AND NEW.path = 'interaction' THEN
    RETURN NEW;                                  -- the student's one-way switch
  END IF;
  IF lesson_extension_active(OLD.lesson_id, OLD.student_id) THEN
    RETURN NEW;                                  -- the instructor's override
  END IF;
  RAISE EXCEPTION 'lesson_completions.path is locked (% -> %) for student % lesson %',
    OLD.path, NEW.path, OLD.student_id, OLD.lesson_id;
END;
$$;


-- No "re-open the draft" trigger is needed. Because the preflight is editable until the
-- deadline, `is_final` never locks anything on its own — an extension simply moves the
-- deadline back into the future and the guard above starts allowing edits again. The
-- completion row keeps standing (so the grant can't cost points) and /preflight-analyze
-- re-grades it at the new deadline.


-- ============================================================
-- 7. RLS REPAIR
--
-- rls.sql's RESPONSES block says outright: "No auth JWT on student side — application
-- enforces student_id ownership." That was true before migration 004 gave students real
-- Supabase Auth accounts; the policies were never revisited. As shipped they allow:
--
--   · responses: anon reads      USING (TRUE)  → anyone with the PUBLIC anon key reads every
--                                                cadet's answers, unauthenticated.
--   · responses: anyone inserts                → anyone inserts a response for ANY student_id.
--   · responses: anon updates own              → deadline checked against the legacy
--                                                assignments.due_date, ignoring `extensions`
--                                                entirely — which is why a granted extension
--                                                does nothing today for any student who has an
--                                                autosaved draft (the UPDATE is refused).
--   · extensions: manage_extensions FOR ALL TO authenticated USING (true)
--                                                → students ARE `authenticated`, so a cadet can
--                                                  grant themselves an extension to any date.
--   · lc: student inserts own    (migration 016) → a cadet can insert their own completion with
--                                                  effort=5, deriving points=2, and lock it in.
--
-- The deadline now lives in the triggers above (extension-aware), so RLS goes back to being
-- about ownership only.
--
-- ⚠ Directors read responses ACROSS sections today only because of `anon reads USING (TRUE)` —
--   "responses: instructor reads section" covers own-sections only. Dropping the anon policy
--   without the manager policy below would break the Grade tab's "All sections" for directors.
-- ============================================================

-- ── RESPONSES ─────────────────────────────────────────────
DROP POLICY IF EXISTS "responses: anyone inserts"   ON responses;
DROP POLICY IF EXISTS "responses: anon updates own" ON responses;
DROP POLICY IF EXISTS "responses: anon reads"       ON responses;

CREATE POLICY "responses: student inserts own"
  ON responses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM students s
                       WHERE s.student_id = responses.student_id
                         AND s.auth_user_id = auth.uid()));

CREATE POLICY "responses: student updates own"
  ON responses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM students s
                  WHERE s.student_id = responses.student_id
                    AND s.auth_user_id = auth.uid()));

CREATE POLICY "responses: student reads own"
  ON responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM students s
                  WHERE s.student_id = responses.student_id
                    AND s.auth_user_id = auth.uid()));

-- Replaces the whole-course read that `anon reads` was silently providing.
CREATE POLICY "responses: manager reads all"
  ON responses FOR SELECT TO authenticated
  USING (lu_is_course_manager());

-- ── EXTENSIONS ────────────────────────────────────────────
DROP POLICY IF EXISTS "read_extensions"   ON extensions;
DROP POLICY IF EXISTS "manage_extensions" ON extensions;

CREATE POLICY "extensions: student reads own"
  ON extensions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM students s
                  WHERE s.student_id = extensions.student_id
                    AND s.auth_user_id = auth.uid()));

CREATE POLICY "extensions: instructor reads section"
  ON extensions FOR SELECT TO authenticated
  USING (lu_is_instructor() AND student_id IN (SELECT m.student_id FROM lu_my_student_ids() m));

-- Director visibility over every grant in the course (granted_by + created_at are the audit
-- trail; the reading UI is Phase 5/6 work).
CREATE POLICY "extensions: manager reads all"
  ON extensions FOR SELECT TO authenticated
  USING (lu_is_course_manager());

-- granted_by must be the caller, so the audit trail cannot be forged.
CREATE POLICY "extensions: instructor grants section"
  ON extensions FOR INSERT TO authenticated
  WITH CHECK (
    granted_by = auth.uid()
    AND (lu_is_course_manager()
         OR (lu_is_instructor() AND student_id IN (SELECT m.student_id FROM lu_my_student_ids() m)))
  );

CREATE POLICY "extensions: instructor updates section"
  ON extensions FOR UPDATE TO authenticated
  USING (lu_is_course_manager()
         OR (lu_is_instructor() AND student_id IN (SELECT m.student_id FROM lu_my_student_ids() m)));

CREATE POLICY "extensions: instructor deletes section"
  ON extensions FOR DELETE TO authenticated
  USING (lu_is_course_manager()
         OR (lu_is_instructor() AND student_id IN (SELECT m.student_id FROM lu_my_student_ids() m)));

-- ── LESSON_COMPLETIONS ────────────────────────────────────
-- Rows are minted by the SECURITY DEFINER triggers above; students must never write this
-- table directly. Read stays.
DROP POLICY IF EXISTS "lc: student inserts own" ON lesson_completions;
DROP POLICY IF EXISTS "lc: student updates own" ON lesson_completions;
