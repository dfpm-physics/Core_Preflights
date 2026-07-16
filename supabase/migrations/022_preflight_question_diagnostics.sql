-- Migration 022: hidden per-question diagnostics for written preflights
-- ============================================================================
-- Adds two AI-produced 0-5 diagnostic values to each existing `scores` row:
--   * q2_effort          — engagement with the reading-reflection response;
--   * q3_understanding   — demonstrated physics understanding in the JiTT response.
--
-- These values are NOT grade points. They do not contribute to `question_scores`,
-- `total_score`, `max_total`, feedback, or finalization. Student pages select an
-- explicit score-column list and do not request or render these columns. Existing
-- score RLS still applies; a student may retrieve the values directly if permitted
-- by that RLS, which is acceptable for this diagnostic.
--
-- Nullable preserves legacy rows and assignments without q2/q3. The analyzer writes
-- both values for every submitted student; a blank answer within a submission is 0.
-- Re-runnable and non-destructive.
-- Independent of migration 021: it may be applied on the current live schema even
-- while the larger lesson-finalization migration remains deferred.
-- ============================================================================

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS q2_effort SMALLINT,
  ADD COLUMN IF NOT EXISTS q3_understanding SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_q2_effort_range'
  ) THEN
    ALTER TABLE scores
      ADD CONSTRAINT scores_q2_effort_range
      CHECK (q2_effort IS NULL OR q2_effort BETWEEN 0 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_q3_understanding_range'
  ) THEN
    ALTER TABLE scores
      ADD CONSTRAINT scores_q3_understanding_range
      CHECK (q3_understanding IS NULL OR q3_understanding BETWEEN 0 AND 5);
  END IF;
END $$;

COMMENT ON COLUMN scores.q2_effort IS
  'AI diagnostic, 0-5: effort/engagement demonstrated in written-preflight question q2; not grade points.';

COMMENT ON COLUMN scores.q3_understanding IS
  'AI diagnostic, 0-5: physics understanding demonstrated in written-preflight question q3; not grade points.';
