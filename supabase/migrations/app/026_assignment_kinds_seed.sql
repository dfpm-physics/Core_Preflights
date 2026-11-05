-- PREP v2 -- seed the other kinds of work, and add the columns that prefill the entry form
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql (assignment_kinds). Additive: adds
-- three nullable columns and six rows to a lookup table. It does NOT depend on
-- 023_instructors_admin_flag_guard.sql, and applies the same whether 023 is present or not.
-- Design: docs/decisions/V2-DATA-MODEL.md section 2.
--
-- WHAT IT DOES
--   assignment_kinds gains
--     report_code       text   the heading and group a report prints for this kind
--     default_delivery  text   prefill for the entry form only
--     default_grading   text   prefill for the entry form only
--   and gains six rows: homework, case_study, group_project, quiz, exam, lab. The existing
--   `preflight` row keeps its id and label; it receives the same three columns.
--
-- KIND CARRIES NO BEHAVIOUR
--   Code branches on delivery and grading (027), never on kind. The two default_* columns are
--   data so the entry page needs no map from kind to behaviour, which would be a branch on kind
--   by another name. Nothing reads them but that page.
--
-- THE CURRENT SITE
--   A new row in a lookup table is inert. Every existing assignment keeps `preflight`. The only
--   places that read kind are schema.js (display) and faculty-lessons.js (a write that always
--   sends `preflight`); neither takes a decision on it.
--
-- ROW LEVEL SECURITY
--   Unchanged: everyone signed in reads, admins write (kinds_read, kinds_write).
--
-- The report_code values below are working labels. Report copies have not arrived; confirm them
-- when they do. Editing one is an UPDATE of a lookup row, not a migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE assignment_kinds
  ADD COLUMN IF NOT EXISTS report_code      text,
  ADD COLUMN IF NOT EXISTS default_delivery text,
  ADD COLUMN IF NOT EXISTS default_grading  text;

ALTER TABLE assignment_kinds
  ADD CONSTRAINT assignment_kinds_default_delivery_ck CHECK (
    default_delivery IS NULL OR default_delivery IN
      ('online_questions', 'typed_response', 'interactive_tutor', 'in_person', 'elsewhere')),
  ADD CONSTRAINT assignment_kinds_default_grading_ck CHECK (
    default_grading IS NULL OR default_grading IN
      ('auto_checked', 'human_graded', 'effort', 'hand_entered', 'imported')),
  ADD CONSTRAINT assignment_kinds_report_code_ck CHECK (
    report_code IS NULL OR length(btrim(report_code)) > 0);

COMMENT ON COLUMN assignment_kinds.report_code IS
  'The heading and group a report prints for this kind. A label, never a switch for behaviour.';
COMMENT ON COLUMN assignment_kinds.default_delivery IS
  'Prefill for the entry form only. No code branches on it; the path row (offering_activities) is what counts.';
COMMENT ON COLUMN assignment_kinds.default_grading IS
  'Prefill for the entry form only. No code branches on it; the path row (offering_activities) is what counts.';

INSERT INTO assignment_kinds (id, label, sort_order, report_code, default_delivery, default_grading)
VALUES
  ('preflight',     'Preflight',     10, 'PF',  'typed_response',  'human_graded'),
  ('homework',      'Homework',      20, 'HW',  'online_questions', 'auto_checked'),
  ('case_study',    'Case study',    30, 'CS',  'typed_response',  'human_graded'),
  ('group_project', 'Group project', 40, 'GP',  'elsewhere',       'imported'),
  ('quiz',          'Quiz',          50, 'QZ',  'elsewhere',       'imported'),
  ('exam',          'Exam',          60, 'EX',  'in_person',       'hand_entered'),
  ('lab',           'Lab',           70, 'LAB', 'elsewhere',       'imported')
ON CONFLICT (id) DO UPDATE
   SET report_code      = EXCLUDED.report_code,
       default_delivery = EXCLUDED.default_delivery,
       default_grading  = EXCLUDED.default_grading;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 7 rows: preflight plus the six new kinds
--   SELECT id, report_code, default_delivery, default_grading FROM app.assignment_kinds ORDER BY sort_order;
--
--   -- must be unchanged: every existing assignment is still a preflight
--   SELECT kind_id, count(*) FROM app.assignments GROUP BY 1;
