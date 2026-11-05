-- Rollback for 026_assignment_kinds_seed.sql. Run as `prep_app_owner`.
--
-- Removes the six seeded kinds and the three prefill columns. Clean until an assignment uses one of
-- the new kinds: the DELETE then fails on the foreign key from assignments.kind_id, and the whole
-- transaction rolls back with nothing changed. The `preflight` row is never deleted.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DELETE FROM assignment_kinds
 WHERE id IN ('homework', 'case_study', 'group_project', 'quiz', 'exam', 'lab');

ALTER TABLE assignment_kinds
  DROP CONSTRAINT IF EXISTS assignment_kinds_default_delivery_ck,
  DROP CONSTRAINT IF EXISTS assignment_kinds_default_grading_ck,
  DROP CONSTRAINT IF EXISTS assignment_kinds_report_code_ck;

ALTER TABLE assignment_kinds
  DROP COLUMN IF EXISTS report_code,
  DROP COLUMN IF EXISTS default_delivery,
  DROP COLUMN IF EXISTS default_grading;

COMMIT;
