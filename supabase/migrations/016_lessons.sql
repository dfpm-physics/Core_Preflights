-- Migration 016: Lessons — unify preflight assignments + lesson interactions
-- ============================================================
-- PURELY ADDITIVE. Creates two NEW tables (lessons, lesson_completions), their
-- grade/lock triggers, and their RLS policies only. Does NOT alter, drop, or modify
-- any existing table, column, policy, or row. References existing objects read-only:
-- assignments, interactions, students, instructors, instructor_course_access,
-- sections, auth.uid().
--
-- This is Phase 1 of LESSON-UNIFICATION.md (§10). A `lesson` groups at most one written
-- preflight (assignments.id) and at most one Claude-artifact interaction (interactions.id)
-- under one slug, declares a shared objective taxonomy + M/T due dates, and is worth 2
-- points on an effort scale. `lesson_completions` is the unified per-student grade record.
--
-- DELIBERATELY NOT IN THIS MIGRATION (later phases of the plan):
--   * the row-CREATING triggers on responses / preflight_interaction_reports that mint a
--     lesson_completions row at finalization (Phase 2, "first-finalized-path-wins");
--   * the D8/D9 section-day due-cutoff + Submit-only write guards.
--   Only the additive schema + the grade(points-from-effort)/lock(path-immutable) triggers
--   live here, so the faculty lesson-creation tool has a table to author into. Adding the
--   Phase-2 triggers later is itself additive and touches nothing here.
--
-- Run in the Supabase SQL Editor (Project > SQL Editor > New Query). Idempotent.
-- ============================================================


-- ============================================================
-- Self-contained updated_at trigger function.
-- Uniquely named so it neither depends on nor overwrites any existing function.
-- ============================================================
CREATE OR REPLACE FUNCTION lessons_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ============================================================
-- LESSONS
-- One row per lesson (slug). Points at most one preflight assignment and at most
-- one interaction; completion_policy decides which path(s) grade. A standalone
-- assignment/interaction with no owning lesson keeps behaving exactly as before.
-- ============================================================
CREATE TABLE IF NOT EXISTS lessons (
  id                TEXT PRIMARY KEY,                          -- slug, e.g. 'lesson-02-charge'
  course_id         TEXT NOT NULL,                             -- 'phys-110' | 'phys-215'
  title             TEXT NOT NULL,
  description       TEXT,
  lesson_number     INT,                                       -- ordering / phase grouping
  preflight_id      TEXT REFERENCES assignments(id)  ON DELETE SET NULL,
  interaction_id    TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  completion_policy TEXT NOT NULL DEFAULT 'choice'
                      CHECK (completion_policy IN ('preflight','interaction','choice')),
  objectives        JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{key,label}] shared taxonomy
  points            SMALLINT NOT NULL DEFAULT 2,
  due_date_m        TIMESTAMPTZ,                               -- M-day sections (effective deadline
  due_date_t        TIMESTAMPTZ,                               --   chosen by the student's section day)
  is_published      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Policy <-> components must stay consistent (added via DO so the migration is re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_policy_components') THEN
    ALTER TABLE lessons ADD CONSTRAINT lessons_policy_components CHECK (
      (completion_policy = 'preflight'   AND preflight_id   IS NOT NULL) OR
      (completion_policy = 'interaction' AND interaction_id IS NOT NULL) OR
      (completion_policy = 'choice'      AND preflight_id IS NOT NULL AND interaction_id IS NOT NULL)
    );
  END IF;
END $$;

CREATE OR REPLACE TRIGGER lessons_updated_at
  BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION lessons_set_updated_at();

CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons (course_id, lesson_number);


-- ============================================================
-- LESSON_COMPLETIONS
-- The linchpin: one unified 2-point grade per student per lesson, regardless of path.
-- UNIQUE(student_id, lesson_id) guarantees a single grade row (first finalize wins);
-- the path is immutable once set (the lock). Populated by later-phase finalize triggers;
-- this migration only defines the table + the grade/lock triggers.
-- ============================================================
CREATE TABLE IF NOT EXISTS lesson_completions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     TEXT   NOT NULL REFERENCES lessons(id)           ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(student_id)  ON DELETE CASCADE,
  path          TEXT   NOT NULL CHECK (path IN ('preflight','interaction')),
  effort        SMALLINT CHECK (effort IS NULL OR effort BETWEEN 0 AND 5),
  points        SMALLINT CHECK (points IS NULL OR points BETWEEN 0 AND 2),   -- trigger-derived
  understanding SMALLINT CHECK (understanding IS NULL OR understanding BETWEEN 0 AND 5),
  report_data   JSONB,                                            -- schema:1 snapshot (<=32 KB)
  finalized_by  TEXT CHECK (finalized_by IN ('student','auto')),  -- how the submission committed (D9)
  is_finalized  BOOLEAN NOT NULL DEFAULT FALSE,                   -- instructor grade-finalize (cf. scores)
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, lesson_id)                                  -- one grade per student per lesson
);

CREATE INDEX IF NOT EXISTS lesson_completions_lesson_idx ON lesson_completions (lesson_id);

-- Keep report_data bounded (derived, regeneratable blob).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lc_report_data_size') THEN
    ALTER TABLE lesson_completions
      ADD CONSTRAINT lc_report_data_size
      CHECK (report_data IS NULL OR octet_length(report_data::text) <= 32768);
  END IF;
END $$;


-- ── Grade: points := f(effort), reusing the interaction grade curve (migration 013).
--    3-5 -> 2, 1-2 -> 1, 0/NULL -> 0. Fires before insert AND update so the column stays derived.
CREATE OR REPLACE FUNCTION lc_score_from_effort()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.points := CASE
                  WHEN NEW.effort IS NULL THEN 0
                  WHEN NEW.effort >= 3    THEN 2
                  WHEN NEW.effort >= 1    THEN 1
                  ELSE 0
                END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER lesson_completions_score
  BEFORE INSERT OR UPDATE ON lesson_completions
  FOR EACH ROW EXECUTE FUNCTION lc_score_from_effort();

-- ── Lock: the path is immutable once set (the unified "first-finalized-path-wins" rule).
CREATE OR REPLACE FUNCTION lc_lock_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.path <> OLD.path THEN
    RAISE EXCEPTION 'lesson_completions.path is locked (% -> %) for student % lesson %',
      OLD.path, NEW.path, OLD.student_id, OLD.lesson_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER lesson_completions_lock_path
  BEFORE UPDATE ON lesson_completions
  FOR EACH ROW EXECUTE FUNCTION lc_lock_path();


-- ============================================================
-- ROW LEVEL SECURITY
-- lessons          → mirrors interactions (migration 012): public sees published; any
--                    instructor sees all; directors/global-admins/course-directors manage.
-- lesson_completions → mirrors preflight_interaction_reports (migration 012): a student
--                    reads/writes only their OWN row (via students.auth_user_id = auth.uid());
--                    instructors read their sections; directors/admins read all. Grade
--                    columns are written by the (later-phase) triggers + the scoped
--                    claude_code_recker role, so no special write policy is needed for them.
-- ============================================================
ALTER TABLE lessons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_completions  ENABLE ROW LEVEL SECURITY;

-- ── LESSONS ───────────────────────────────────────────────

CREATE POLICY "lessons: public sees published"
  ON lessons FOR SELECT
  USING (is_published = TRUE);

CREATE POLICY "lessons: instructor sees all"
  ON lessons FOR SELECT
  USING (EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid()));

CREATE POLICY "lessons: managers insert"
  ON lessons FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
    OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
    OR EXISTS (SELECT 1 FROM instructor_course_access WHERE instructor_id = auth.uid() AND role = 'director')
  );

CREATE POLICY "lessons: managers update"
  ON lessons FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
    OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
    OR EXISTS (SELECT 1 FROM instructor_course_access WHERE instructor_id = auth.uid() AND role = 'director')
  );

CREATE POLICY "lessons: managers delete"
  ON lessons FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
    OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
    OR EXISTS (SELECT 1 FROM instructor_course_access WHERE instructor_id = auth.uid() AND role = 'director')
  );

-- ── LESSON_COMPLETIONS ────────────────────────────────────
-- The real gate: a student may only touch a row bound to THEIR OWN auth account.

CREATE POLICY "lc: student inserts own"
  ON lesson_completions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.student_id = lesson_completions.student_id
        AND s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "lc: student updates own"
  ON lesson_completions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.student_id = lesson_completions.student_id
        AND s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "lc: student reads own"
  ON lesson_completions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.student_id = lesson_completions.student_id
        AND s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "lc: instructor reads section"
  ON lesson_completions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid())
    AND student_id IN (
      SELECT st.student_id FROM students st
      JOIN sections sec ON sec.id = st.section_id
      WHERE sec.instructor_id = auth.uid()
    )
  );

CREATE POLICY "lc: admin reads all"
  ON lesson_completions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
    OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
    OR EXISTS (SELECT 1 FROM instructor_course_access WHERE instructor_id = auth.uid() AND role = 'director')
  );
