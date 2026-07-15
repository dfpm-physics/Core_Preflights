-- Migration 020: interactions switch to M-day / T-day due dates (parity with assignments + lessons)
-- ============================================================================
-- Replaces the single `due_date` column (migration 015) with `due_date_m` / `due_date_t` so an
-- interaction carries the same M-day/T-day deadline shape as assignments and lessons — the lesson
-- creator then syncs one due date across every component. The old single value is backfilled into
-- BOTH new columns before it is dropped, so no data is lost.
--
-- Idempotent / re-runnable. Run in the Supabase SQL Editor with the service role. Deploy the
-- matching site code (which reads/writes due_date_m/t, not due_date) together with this migration.
-- Record application in CHANGELOG.md per CORE.md §5.
-- ============================================================================

ALTER TABLE interactions ADD COLUMN IF NOT EXISTS due_date_m TIMESTAMPTZ;
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS due_date_t TIMESTAMPTZ;

-- Preserve the existing single date into both M and T before dropping it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'interactions' AND column_name = 'due_date') THEN
    UPDATE interactions SET due_date_m = due_date WHERE due_date_m IS NULL AND due_date IS NOT NULL;
    UPDATE interactions SET due_date_t = due_date WHERE due_date_t IS NULL AND due_date IS NOT NULL;
  END IF;
END $$;

ALTER TABLE interactions DROP COLUMN IF EXISTS due_date;
