-- ============================================================
-- 013_interaction_effort_score.sql
-- Effort + auto-derived score for interaction reports, plus a size
-- guard on the structured-data blob. See INTERACTION-DATA-CONTRACT.md (v1).
--
-- Grade model: `effort` (0-5, copied from report_data.effort by the
-- receiver) is the only grade-bearing signal. `score` (0-2) is derived
-- from effort on EVERY write by a trigger, so a student cannot post a
-- score independent of effort:
--     effort 3-5   -> 2 points
--     effort 1-2   -> 1 point
--     effort 0/NULL -> 0 points
-- Legacy rows (no effort yet) are left untouched — the trigger only
-- fires on insert/update, so their score stays NULL until re-submitted.
-- Idempotent: safe to run more than once.
-- ============================================================

-- 1) Columns. Add effort first so the trigger/constraints can reference it.
ALTER TABLE preflight_interaction_reports
  ADD COLUMN IF NOT EXISTS effort SMALLINT,
  ADD COLUMN IF NOT EXISTS score  SMALLINT;

-- Range guards (added separately so re-runs don't error on existing constraints).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pir_effort_range') THEN
    ALTER TABLE preflight_interaction_reports
      ADD CONSTRAINT pir_effort_range CHECK (effort IS NULL OR effort BETWEEN 0 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pir_score_range') THEN
    ALTER TABLE preflight_interaction_reports
      ADD CONSTRAINT pir_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 2);
  END IF;
  -- Bound the structured blob (contract §3: d <= 32 KB raw).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pir_report_data_size') THEN
    ALTER TABLE preflight_interaction_reports
      ADD CONSTRAINT pir_report_data_size
      CHECK (report_data IS NULL OR octet_length(report_data::text) <= 32768);
  END IF;
END $$;

-- 2) Derive score from effort on every write. Always overwrites any
--    client-supplied score, so score is strictly a function of effort.
CREATE OR REPLACE FUNCTION pir_score_from_effort() RETURNS TRIGGER AS $$
BEGIN
  NEW.score := CASE
    WHEN NEW.effort >= 3 THEN 2
    WHEN NEW.effort >= 1 THEN 1
    ELSE 0                       -- effort 0 or NULL
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pir_set_score ON preflight_interaction_reports;
CREATE TRIGGER pir_set_score
  BEFORE INSERT OR UPDATE ON preflight_interaction_reports
  FOR EACH ROW EXECUTE FUNCTION pir_score_from_effort();

-- 3) Index for per-interaction / per-section score rollups.
CREATE INDEX IF NOT EXISTS pir_interaction_score_idx
  ON preflight_interaction_reports (interaction_id, score);
