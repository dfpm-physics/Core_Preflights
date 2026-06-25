-- Migration 014: Cohort analysis store for lesson interactions
-- ============================================================
-- PURELY ADDITIVE. Creates ONE new table + its read policies only.
-- Does NOT alter, drop, or modify any existing table, column, policy, or row.
-- References existing objects read-only: interactions, instructors,
-- instructor_course_access, sections, auth.uid().
--
-- WHAT THIS STORES
--   The output of the `/interaction-aggregate` skill — the class-level AI synthesis the
--   faculty lesson rollup shows as "coming soon" placeholders today:
--     * readiness_summary    — short narrative: engagement, where understanding is solid
--                              vs. shaky, what to cover first in class.
--     * misconception_trends — prose that sits UNDER the live prevalence bars (clustering,
--                              spreading/fading, section concentration).
--     * selected_quotes      — 2-3 AI-picked reading-reflection quotes, as {student_id,
--                              section_id} (the verbatim text + name resolve live from
--                              report_data + the roster, so nothing is duplicated here).
--   The NUMERIC rollups (effort/understanding/objective/misconception bars) stay computed
--   live in the browser from report_data — this table only carries the free-text AI layer.
--   See INTERACTION-AGGREGATION.md and INTERACTION-DATA-CONTRACT.md.
--
-- SCOPE PER ROW
--   One row per (interaction_id, section_id):
--     * section_id = a real sections.id (e.g. 'M1A') → that section's rollup.
--     * section_id = '__all__'                       → the whole-course rollup.
--   '__all__' rows carry the two PROSE panels only; selected_quotes stays [] for them
--   (quotes are a per-section teaching tool, only shown on a single-section view — the
--   "All sections" view never displays quotes). A CHECK enforces that.
--   section_id is intentionally NOT a foreign key (the '__all__' sentinel isn't a real section).
--
-- WHO WRITES IT
--   Only the scoped, BYPASSRLS `claude_code_recker` role (the same least-privilege path the
--   /interaction-backfill skill uses) — never the browser. So there is NO insert/update/delete
--   policy here, and NO explicit GRANT to that role: claude_code_role.sql's
--   ALTER DEFAULT PRIVILEGES already covers new public tables, and naming a per-operator role
--   in a shared migration would fail for other directors who don't have it.
--
-- Run in the Supabase SQL Editor (Project > SQL Editor > New Query). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS interaction_analysis (
  interaction_id        TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  section_id            TEXT NOT NULL,                              -- a sections.id, or '__all__'

  readiness_summary     TEXT,                                       -- AI panel 1 (prose)
  misconception_trends  TEXT,                                       -- AI panel 2 (prose under live bars)
  selected_quotes       JSONB NOT NULL DEFAULT '[]'::jsonb,         -- AI panel 3: [{student_id, section_id}]
  meta                  JSONB NOT NULL DEFAULT '{}'::jsonb,         -- {n, generated_by, source_fingerprint}
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (interaction_id, section_id)
);

-- Light sanity rails (this is derived, regeneratable data — keep blobs bounded).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_readiness_len') THEN
    ALTER TABLE interaction_analysis
      ADD CONSTRAINT ia_readiness_len CHECK (readiness_summary IS NULL OR length(readiness_summary) <= 8000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_trends_len') THEN
    ALTER TABLE interaction_analysis
      ADD CONSTRAINT ia_trends_len CHECK (misconception_trends IS NULL OR length(misconception_trends) <= 8000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_quotes_size') THEN
    ALTER TABLE interaction_analysis
      ADD CONSTRAINT ia_quotes_size CHECK (octet_length(selected_quotes::text) <= 4096);
  END IF;
  -- The whole-course rollup never shows quotes, so it must not carry any.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_all_no_quotes') THEN
    ALTER TABLE interaction_analysis
      ADD CONSTRAINT ia_all_no_quotes
      CHECK (section_id <> '__all__' OR selected_quotes = '[]'::jsonb);
  END IF;
END $$;


-- ============================================================
-- ROW LEVEL SECURITY — read mirrors preflight_interaction_reports (migration 012).
-- Writes come only from the BYPASSRLS claude_code_recker role, so there is no write policy.
-- ============================================================
ALTER TABLE interaction_analysis ENABLE ROW LEVEL SECURITY;

-- Directors / global admins read every row in the course (incl. the '__all__' whole-course row).
CREATE POLICY "ia: admin reads all"
  ON interaction_analysis FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_global_admin = TRUE)
    OR EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid() AND is_director = TRUE)
    OR EXISTS (SELECT 1 FROM instructor_course_access WHERE instructor_id = auth.uid() AND role = 'director')
  );

-- Instructors read only their own sections' rows. The '__all__' sentinel is not one of their
-- sections, so it never matches — an instructor's "All sections" view is the live union of
-- their own per-section rows, never the whole-course row.
CREATE POLICY "ia: instructor reads section"
  ON interaction_analysis FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM instructors WHERE id = auth.uid())
    AND section_id IN (SELECT sec.id FROM sections sec WHERE sec.instructor_id = auth.uid())
  );
