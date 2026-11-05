-- PREP v2 -- report fields, per-course settings, prior-term history, and a safer freeze view
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 003_term_calendar.sql, 004_content_snapshot.sql
-- (terms_awaiting_freeze) and the existing helper functions staff_offerings(), director_offerings() and
-- director_courses(). It does NOT depend on 023_instructors_admin_flag_guard.sql. Design:
-- docs/decisions/V2-DATA-MODEL.md sections 15 and 16 and 17 ("Existing view").
--
-- THE FIELDS ARE MARKED PROVISIONAL: confirm them against the report copies when they arrive.
--
-- WHAT IT ADDS
--   courses.subject, courses.course_number         report headings (nullable)
--   terms.report_code                              the term as a report prints it, such as 20261 (nullable)
--   students.class_year                            cadet year on approval sheets (nullable; a later roster import
--                                                  fills it; no row of `students` is touched here)
--   course_offering_settings                       staff-only per-offering values: incoming_gpa numeric(4,3),
--                                                  blackboard_export (default false), bb_prog_column, bb_final_column.
--                                                  A row is optional. Kept OUT of course_offerings on purpose: that
--                                                  table is readable by every cadet of the offering (offerings_read).
--   course_grade_history                           prior terms' averages and GPAs, entered by hand, for the comparison
--                                                  report
--   terms_awaiting_freeze                          security_invoker = true, so the view follows the read rules of the
--                                                  tables under it. It had no such setting and its ACL grants anon
--                                                  full rights, so reads ran as the owner. freeze_term.py runs as an
--                                                  operator and keeps working.
--
-- RLS    course_offering_settings, course_grade_history: staff of that course read, Directors write, no student policy.
-- THE CURRENT SITE   Nullable columns no page selects, and unread tables. Needs Postgres 15 or later for
--                    security_invoker.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE courses  ADD COLUMN subject text, ADD COLUMN course_number text;
ALTER TABLE terms    ADD COLUMN report_code text;
ALTER TABLE students ADD COLUMN class_year smallint;

COMMENT ON COLUMN courses.subject       IS 'Report heading, for example PHYS. Provisional until the report copies arrive.';
COMMENT ON COLUMN courses.course_number IS 'Report heading, for example 215. Provisional until the report copies arrive.';
COMMENT ON COLUMN terms.report_code     IS 'The term as a report prints it, such as 20261. Provisional.';
COMMENT ON COLUMN students.class_year   IS 'Cadet year on approval sheets. Filled by a later roster import. Provisional.';

-- ---- course_offering_settings -----------------------------------------------------------------
CREATE TABLE course_offering_settings (
  course_offering_id uuid PRIMARY KEY REFERENCES course_offerings(id) ON DELETE CASCADE,
  incoming_gpa       numeric(4,3),
  blackboard_export  boolean NOT NULL DEFAULT false,
  bb_prog_column     text,
  bb_final_column    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_offering_settings_gpa_ck CHECK (incoming_gpa IS NULL OR (incoming_gpa >= 0 AND incoming_gpa <= 4.3))
);

CREATE TRIGGER course_offering_settings_touch BEFORE UPDATE ON course_offering_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE course_offering_settings IS
  'Staff-only settings of one course offering. A row is optional. Kept apart from course_offerings because every '
  'cadet of an offering can read every column of their course_offerings row.';
COMMENT ON COLUMN course_offering_settings.blackboard_export IS 'Whether this course uses the one-overall-grade Blackboard export.';

ALTER TABLE course_offering_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cos_read_staff ON course_offering_settings FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY cos_write_director ON course_offering_settings FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));
REVOKE ALL ON course_offering_settings FROM anon;

-- ---- course_grade_history ----------------------------------------------------------------------
CREATE TABLE course_grade_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_report_code text NOT NULL,
  prog_gpa         numeric,
  final_gpa        numeric,
  prog_avg         numeric,
  final_avg        numeric,
  source           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_grade_history_term_key UNIQUE (course_id, term_report_code),
  CONSTRAINT course_grade_history_code_ck CHECK (length(btrim(term_report_code)) > 0)
);

COMMENT ON TABLE course_grade_history IS
  'Prior terms'' averages and GPAs, entered by hand; later terms fill from approved checkpoints. The comparison '
  'report prints two prior terms. Staff of the course read, Directors write, no student policy.';

ALTER TABLE course_grade_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY cgh_read_staff ON course_grade_history FOR SELECT TO authenticated
  USING (course_id IN (SELECT co.course_id FROM course_offerings co
                        WHERE co.id IN (SELECT staff_offerings())));
CREATE POLICY cgh_write_director ON course_grade_history FOR ALL TO authenticated
  USING (course_id IN (SELECT director_courses()))
  WITH CHECK (course_id IN (SELECT director_courses()));
REVOKE ALL ON course_grade_history FROM anon;

-- ---- the freeze view follows the rules of the tables under it -----------------------------------
ALTER VIEW terms_awaiting_freeze SET (security_invoker = true);

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- true
--   SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'app.terms_awaiting_freeze'::regclass;
--
--   -- an anon request to the view returns no rows (check over the API with the public key)
