-- PREP v2 — per-student deadline extensions
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql and 002_rls.sql.
--
-- WHY THIS EXISTS
--   `public.extensions` was carried by the legacy frontend in six places but held zero rows,
--   so migrate_public_to_app.py deliberately left it behind rather than migrate an empty
--   table on speculation. Wiring site/app/ to `app` brought the question back as a real one:
--   the Grade view offers "grant an extension" and the student's deadline must honour it, so
--   either the feature goes or the table does. It stays — an instructor granting one cadet
--   extra time is ordinary course administration, and the alternative (editing the section
--   deadline for everyone) is worse.
--
-- WHY IT KEYS ON THE ENROLMENT, NOT THE STUDENT
--   `public.extensions` keyed (student_id, assignment_id). Every other per-student table in
--   this model keys on enrollment_id, for the reason given on app.enrollments: a grade, a
--   submission — and an extension — belong to a student's place in a section in a term, not
--   to the person in perpetuity. Keying on the enrolment means moving a cadet between
--   sections cannot silently carry a Fall 2026 extension into Spring 2027, and it makes the
--   RLS predicate identical to the one already used by submissions and grades.
--
-- NOT ENFORCED, ON PURPOSE: nothing requires extended_due_at to be LATER than the deadline
--   it replaces. The effective deadline is computed from three sources whose precedence is
--   resolved in the application (js/schema.js effectiveDue), and a legitimate correction may
--   move a date earlier. A CHECK here would need to re-derive the per-section override to
--   know what it is comparing against, which is exactly the kind of logic that does not
--   belong in a constraint.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

CREATE TABLE extensions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  extended_due_at        timestamptz NOT NULL,
  reason                 text,
  granted_by             uuid REFERENCES instructors(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extensions_unique UNIQUE (enrollment_id, assignment_offering_id)
);

COMMENT ON TABLE extensions IS
  'A per-student deadline override for one scheduled assignment. Highest-precedence deadline '
  'source: extension > assignment_due_dates (per section) > assignment_offerings.due_at.';
COMMENT ON COLUMN extensions.granted_by IS
  'The instructor who granted it. ON DELETE SET NULL so removing a departed instructor '
  'never silently revokes a student''s extra time.';
COMMENT ON COLUMN extensions.extended_due_at IS
  'Replaces the computed deadline outright — it is not an offset.';

CREATE TRIGGER extensions_touch BEFORE UPDATE ON extensions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX extensions_offering_idx  ON extensions (assignment_offering_id);
CREATE INDEX extensions_enrollment_idx ON extensions (enrollment_id);


-- ---------------------------------------------------------------------------
-- RLS — the same two predicates every per-student table in this model uses:
-- "is this the caller's own enrolment?" and "does the caller staff its section?"
-- ---------------------------------------------------------------------------
ALTER TABLE extensions ENABLE ROW LEVEL SECURITY;

-- A student may see their own extension. They must: the deadline they are shown depends
-- on it, and a deadline the student cannot verify is a support ticket waiting to happen.
CREATE POLICY extensions_own ON extensions FOR SELECT TO authenticated
  USING (enrollment_id IN (SELECT my_enrollments()));

CREATE POLICY extensions_staff_read ON extensions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = extensions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));

-- Granting one is a grading action, so it sits with the same scope as writing a grade:
-- any staff member responsible for that section, not directors only.
CREATE POLICY extensions_staff_write ON extensions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = extensions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())))
  WITH CHECK (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = extensions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));

COMMIT;
