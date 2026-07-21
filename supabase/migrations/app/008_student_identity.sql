-- PREP v2 — real contact identity on students, and a roster-import audit trail
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
--
-- WHY THIS EXISTS
--   A cadet's sign-in address has always been FABRICATED. `provision-students` minted
--   `<cadet_id>@usafa.edu` because the roster CSV carried only (student_id, name, section),
--   so there was nothing else to use. Two consequences followed from that one gap:
--
--     * The address cannot receive mail. Every password-recovery path in the app was
--       therefore theatre — a reset code sent to a mailbox that does not exist. The
--       companion frontend change removes those paths outright; this migration removes the
--       reason they were built.
--     * The roster upload discarded everything else the registrar knows. Squadron, major,
--       and advisor are on the export we already receive, and each is a question an
--       instructor asks about a struggling cadet.
--
--   The registrar export carries a real `Email` column, so the address stops being invented.
--
-- EVERY COLUMN HERE IS NULLABLE, AND NOTHING READS ONE AS REQUIRED.
--   64 Fall 2026 students already exist with none of this data. A migration that invalidated
--   them would have to be run in lockstep with a re-import, against a live database, in the
--   middle of a term. Nullable means the two can happen weeks apart: the columns land now,
--   the data backfills whenever a director next uploads a roster, and nothing breaks in
--   between. `email` in particular must stay nullable forever — a cadet can be enrolled and
--   graded before anyone has their address.
--
-- WHY auth.users STAYS AUTHORITATIVE FOR SIGN-IN
--   `students.email` is what the registrar says. How someone actually signs in is what
--   `auth.users.email` says. Those agree for accounts provisioned after this lands and
--   deliberately DISAGREE for the 64 that predate it, which still carry the fabricated
--   address. Nothing here rewrites an existing auth user: a roster upload is a routine act
--   performed on a file the uploader has not necessarily proofread, and it must never be
--   able to change how 64 people log in as a side effect. Migrating those is a separate,
--   explicit operator action.
--
-- APPLYING THIS REQUIRES AN UNSEAL, WHICH IS A COORDINATION EVENT.
--   `prep_app_owner` is NOLOGIN after build-out. A human runs `ALTER ROLE prep_app_owner
--   LOGIN;` as `postgres`, applies this, then re-seals. Per CORE.md §0: announce it, confirm
--   no other agent is mid-run, run it alone, and record it in CHANGELOG.md.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;


-- =====================================================================================
-- PART 1 — identity columns on students
--
-- The registrar's header name is given against each column so a future reader can match it
-- back to the spreadsheet cell without re-deriving the mapping. The importer accepts these
-- headers case- and space-insensitively; the export's exact casing has already drifted once.
-- =====================================================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS email        text,   -- "Email"           — the real mailbox
  ADD COLUMN IF NOT EXISTS squadron     text,   -- "Cadet Squadron"
  ADD COLUMN IF NOT EXISTS sex          text,   -- "Sex"
  ADD COLUMN IF NOT EXISTS major_1      text,   -- "Major 1"
  ADD COLUMN IF NOT EXISTS major_2      text,   -- "Major 2"
  ADD COLUMN IF NOT EXISTS major_3      text,   -- "Major 3"
  ADD COLUMN IF NOT EXISTS advisor_name text;   -- "Advisor Name"

-- Case-insensitive uniqueness, as an index on lower(email) rather than a UNIQUE constraint:
-- registrar exports are inconsistent about case, and `Jane.Doe@` and `jane.doe@` are one
-- mailbox. Partial, so the existing NULL-email rows do not collide with each other.
--
-- This is a real integrity guard, not a formality. Two students sharing an address would
-- mean two cadets resolving to one login — the importer checks for it too, but the check
-- that matters is the one the database enforces.
CREATE UNIQUE INDEX IF NOT EXISTS students_email_lower_idx
  ON students (lower(email))
  WHERE email IS NOT NULL;

-- A SHAPE check, not a validity check. Deliverability is unknowable here and address syntax
-- past "one @, text either side, a dot in the domain, no whitespace" is not worth encoding —
-- the importer shows the operator the offending row, which is the better place to catch it.
-- This exists only to stop a truncated cell, a stray header row, or a shifted column from
-- silently becoming somebody's login identity.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_email_shape;
ALTER TABLE students ADD CONSTRAINT students_email_shape
  CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

COMMENT ON COLUMN students.email IS
  'Real address from the registrar export, and the sign-in identity for accounts provisioned '
  'after 2026-07-21. NOT authoritative for how an existing user signs in — auth.users.email is. '
  'Students provisioned before that date have a fabricated auth email of <cadet_id>@usafa.edu '
  'that is deliberately not mirrored here.';
COMMENT ON COLUMN students.squadron IS
  'Cadet squadron from the registrar export. Advisory context for instructors; carries no '
  'authorization meaning and is not a grouping the grade or roster model knows about.';


-- =====================================================================================
-- PART 2 — roster import audit
--
-- A roster upload is a bulk mutation on shared live state, performed through the UI, from a
-- file nobody else can see, by people who are not running an agent. CORE.md §0 wants those
-- traceable, and CHANGELOG.md structurally cannot carry them — it is a repo file, and this
-- happens several times a term in a browser. So the trail lives in the database, next to the
-- rows it explains.
--
-- Counts, not row copies. Keeping the parsed file would duplicate PII that `students`
-- already holds and would age into a second, quietly wrong roster.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS roster_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id  uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  imported_by         uuid REFERENCES instructors(id) ON DELETE SET NULL,
  filename            text,
  rows_in_file        integer NOT NULL DEFAULT 0,
  rows_matched        integer NOT NULL DEFAULT 0,  -- survived the course/section filter
  students_created    integer NOT NULL DEFAULT 0,
  students_updated    integer NOT NULL DEFAULT 0,  -- conflicts the operator chose to overwrite
  students_untouched  integer NOT NULL DEFAULT 0,  -- conflicts the operator chose to attach only
  enrollments_created integer NOT NULL DEFAULT 0,
  sections_created    integer NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roster_imports IS
  'One row per roster upload: who, when, from which file, and what it changed. Exists because '
  'roster uploads are frequent live mutations that cannot be recorded in CHANGELOG.md. The '
  'created/updated/untouched split is the audit-relevant part — it records which conflict '
  'resolution the operator chose, which is the only step of an import that discards data.';

CREATE INDEX IF NOT EXISTS roster_imports_offering_idx
  ON roster_imports (course_offering_id, created_at DESC);

ALTER TABLE roster_imports ENABLE ROW LEVEL SECURITY;

-- The same two predicates as the rest of 002_rls.sql — staff of the offering read, directors
-- of it write. No student policy: this table is ABOUT students but is not theirs, and no
-- student page queries it. Under PREP-V2-AUTHORIZATION §6, "no policy" is the correct way to
-- say that, not an oversight.
DROP POLICY IF EXISTS roster_imports_read_staff ON roster_imports;
CREATE POLICY roster_imports_read_staff ON roster_imports FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));

DROP POLICY IF EXISTS roster_imports_write_director ON roster_imports;
CREATE POLICY roster_imports_write_director ON roster_imports FOR INSERT TO authenticated
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));

-- No GRANTs here on purpose: app_schema_bootstrap.sql §4 sets ALTER DEFAULT PRIVILEGES for
-- prep_app_owner, so a table created by the owner is already reachable by prep_app_dml,
-- prep_app_read, and the PostgREST roles. Re-granting would drift from that one source.

COMMIT;
