-- PREP v2 — extra-instruction (EI) session logging
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
-- Roadmap P1.4 (logging) and P1.8 (dashboard stats).
--
-- WHY THIS EXISTS
--   Instructors hold extra instruction constantly and record it nowhere. The director's actual
--   use case is not the scheduled one-on-one it sounds like — it is the ~20 minutes at the end
--   of most classes when several cadets stay behind to ask questions. That shapes every decision
--   below, and it is why this table has a `batch_id` before it has anything clever.
--
-- KEYED ON THE ENROLMENT, NOT THE CADET
--   Every per-student table in this model keys on `enrollment_id`, and 005_extensions.sql:14-20
--   gives the argument: a grade, a submission and an extension belong to a student's place in a
--   section in a term, not to the person in perpetuity. EI is the same — "who did I hold EI with
--   this term" is the question, and a cadet who repeats the course should not inherit last term's
--   log.
--
--   The practical half of that argument matters more. Keying on the enrolment makes the RLS
--   predicate below BYTE-IDENTICAL to the ones already on `extensions` and `grades`. That is the
--   difference between a policy that has been reviewed and a policy that is new.
--
-- NO UNIQUE CONSTRAINT, DELIBERATELY
--   EI is inherently repeatable — the same cadet may come twice in a week, or twice in a day.
--   `extensions` kept a unique key for a specific reason recorded at 007:49-56 (PostgREST upsert
--   can only infer a conflict target from a plain unique constraint); these are plain inserts, so
--   that reasoning does not transfer. A unique key here would silently swallow the second visit.
--
-- WHAT `batch_id` IS FOR
--   Six cadets who stayed after one class are one event. Logged as six unrelated rows, correcting
--   a mistyped duration is six edits and there is no way to answer "how many EI sessions did I
--   hold" without guessing which rows were really the same sitting. One shared uuid makes the
--   batch correctable and countable as a unit. It is NULL for a single log, and carries no foreign
--   key — it is a grouping token, not an entity, and inventing an `ei_batches` table to hold a
--   timestamp that already exists on every row would be a table nobody reads.
--
-- NO SELF-ATTRIBUTION TRIGGER, DELIBERATELY
--   `review_signoffs` refuses a row attributed to anyone but the caller (007:208-228). This does
--   not, and the omission is a decision rather than an oversight. A director logging a session on
--   behalf of a colleague who ran it is a real case, and unlike a sign-off an EI row carries no
--   consequence for the student and confers nothing on the instructor. Forgery risk does not
--   justify blocking the legitimate case. If EI attendance ever becomes an input to anything —
--   a grade, a report to a squadron — revisit this line first.
--
-- STUDENTS CANNOT READ THEIR OWN
--   Course director's decision, recorded as ROADMAP §6 Q3. There is no student policy below, and
--   that absence is the whole enforcement — note that `extensions` DOES have an `extensions_own`
--   policy and this is deliberately that block minus it. Opening this later is additive and safe;
--   closing it after cadets have seen it is breaking. So it starts closed.
--
--   Consequence worth stating: `notes` may contain an instructor's candid read of a cadet
--   ("still lost on superposition, sent him to the textbook"). That is only safe to write because
--   of the missing policy. If a student read path is ever added, `notes` must not come with it.
--
-- NO GRANTs HERE, FOLLOWING 008
--   app_schema_bootstrap.sql §4 sets ALTER DEFAULT PRIVILEGES for prep_app_owner, so a table the
--   owner creates is already reachable by prep_app_dml, prep_app_read and the PostgREST roles.
--   008_student_identity.sql:147-149 states this convention explicitly. 009 and 010 drifted from
--   it with redundant GRANTs, and 009's is actively misleading — its `GRANT SELECT` reads as a
--   read-only restriction, but the default privileges have already granted INSERT/UPDATE/DELETE,
--   so the table is protected by the absence of a write policy and not by the grant. A narrow
--   GRANT cannot restrict anything in this schema. This file re-grants nothing.

BEGIN;

SET LOCAL search_path = app, public;

CREATE TABLE IF NOT EXISTS ei_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  enrollment_id    uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,

  -- Who held it. SET NULL rather than CASCADE: an instructor leaving the department must not
  -- erase the record that the sessions happened, exactly as `extensions.granted_by` and
  -- `grades.graded_by` already decide.
  instructor_id    uuid REFERENCES instructors(id) ON DELETE SET NULL,

  -- When the session STARTED, in UTC. No DEFAULT now() on purpose — the common case is logging
  -- after the fact ("that was 4th period"), and a default would let a mistake pass as a fact.
  -- The client prefills the current local time; that is a prefill the operator can see and edit,
  -- which a database default is not.
  started_at       timestamptz NOT NULL,

  -- 30 minutes is the director's stated default. The ceiling is a typo guard, not a policy:
  -- 480 = eight hours, longer than any real session and short enough to catch a stray digit.
  duration_minutes smallint NOT NULL DEFAULT 30,

  notes            text,

  -- Groups one bulk log. NULL for a single session. See the header.
  batch_id         uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ei_sessions_duration_sane
    CHECK (duration_minutes > 0 AND duration_minutes <= 480),

  -- Same spirit as submission_activities' size caps: a bug in a client loop must not turn this
  -- into a document store. 4 KB is far more than a note anybody types by hand.
  CONSTRAINT ei_sessions_notes_size
    CHECK (notes IS NULL OR length(notes) <= 4000)
);

COMMENT ON TABLE ei_sessions IS
  'Extra-instruction sessions, one row per student per sitting, keyed on the enrolment so a record '
  'belongs to a student''s place in a section in a term. STAFF-ONLY: there is no student read '
  'policy and that absence is deliberate (ROADMAP Q3) — `notes` may hold an instructor''s candid '
  'assessment. Repeatable by design: no unique key. A bulk log shares one batch_id.';

COMMENT ON COLUMN ei_sessions.started_at IS
  'Session start in UTC. Rendered in America/Denver by the client. No default — logging after the '
  'fact is the common case and a default would disguise a mistake as a fact.';

COMMENT ON COLUMN ei_sessions.batch_id IS
  'Shared uuid for every row logged in one bulk action; NULL for a single session. A grouping '
  'token, not an entity — it carries no foreign key.';

COMMENT ON COLUMN ei_sessions.instructor_id IS
  'Who held the session. Not forced to equal the caller: a director may log on behalf of the '
  'colleague who ran it. Revisit that if EI attendance ever becomes an input to a grade.';

-- The three reads this table gets: one student's history (detail page), one instructor's recent
-- sessions (dashboard stats, P1.8), and one batch (correcting a bulk log).
CREATE INDEX IF NOT EXISTS ei_sessions_enrollment_idx
  ON ei_sessions (enrollment_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ei_sessions_instructor_idx
  ON ei_sessions (instructor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ei_sessions_batch_idx
  ON ei_sessions (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE ei_sessions ENABLE ROW LEVEL SECURITY;

-- Staff of the section, read and write. This is the `extensions` block (005:66-83) with the
-- `extensions_own` student policy removed — see the header for why that removal is the point.
--
-- Scope is section-level, matching who may grade: logging EI is a teaching act, not a
-- director-only administrative one, and an instructor must be able to record their own sessions.
DROP POLICY IF EXISTS ei_sessions_staff_read ON ei_sessions;
CREATE POLICY ei_sessions_staff_read ON ei_sessions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = ei_sessions.enrollment_id
                 AND e.section_id IN (SELECT staff_sections())));

DROP POLICY IF EXISTS ei_sessions_staff_write ON ei_sessions;
CREATE POLICY ei_sessions_staff_write ON ei_sessions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = ei_sessions.enrollment_id
                 AND e.section_id IN (SELECT staff_sections())))
WITH CHECK (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = ei_sessions.enrollment_id
                 AND e.section_id IN (SELECT staff_sections())));

CREATE TRIGGER ei_sessions_touch BEFORE UPDATE ON ei_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
