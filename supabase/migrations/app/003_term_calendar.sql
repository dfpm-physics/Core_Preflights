-- PREP v2 — term calendar detail
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql.
--
-- `terms` originally carried only starts_on / ends_on. USAFA tracks more than that, and the
-- distinction matters: instruction ends before the term does, and grades are due after finals
-- finish. Recording all four means "is this term over?" and "when must grades be in?" are
-- answerable from the data rather than from someone's memory.
--
-- Additive only: every column is nullable, so terms already created stay valid.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

ALTER TABLE terms
  ADD COLUMN finals_start  date,
  ADD COLUMN finals_end    date,
  ADD COLUMN grades_due_on date;

COMMENT ON COLUMN terms.starts_on     IS 'First day of instruction.';
COMMENT ON COLUMN terms.ends_on       IS 'Last day of instruction — NOT the last day of the term; finals follow.';
COMMENT ON COLUMN terms.finals_start  IS 'First day of the final exam period.';
COMMENT ON COLUMN terms.finals_end    IS 'Last day of the final exam period.';
COMMENT ON COLUMN terms.grades_due_on IS 'Deadline for submitting final grades.';

-- Ordering: instruction, then finals, then grades due. Each clause tolerates nulls so a term
-- can be created with only the dates that are known.
ALTER TABLE terms ADD CONSTRAINT terms_calendar_order CHECK (
      (ends_on      IS NULL OR finals_start  IS NULL OR ends_on      <= finals_start)
  AND (finals_start IS NULL OR finals_end    IS NULL OR finals_start <= finals_end)
  AND (finals_end   IS NULL OR grades_due_on IS NULL OR finals_end   <= grades_due_on)
);

COMMIT;
