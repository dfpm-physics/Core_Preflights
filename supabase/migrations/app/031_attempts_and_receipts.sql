-- PREP v2 -- attempts, submission receipts, and the record of key re-marks
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql and 030_questions_and_keys.sql (questions, question_keys).
-- It does NOT depend on 023_instructors_admin_flag_guard.sql. Design: docs/decisions/V2-DATA-MODEL.md
-- sections 12 and 13.
--
-- WHAT IT ADDS  (all three tables are EMPTY until Stage E)
--   question_attempts    every answer is a row. UNIQUE (enrollment_id, question_id, attempt_no) also stops a
--                        double submit. Which attempt counts is assignment_offerings.attempt_rule.
--   submission_receipts  for typed and tutor work: the content hash and the commit time, set by the database.
--   key_remark_runs      one row per re-mark of a question against a corrected key.
--
-- WHO WRITES
--   Nobody from a client. The only writer is the Stage E function, pinned SECURITY DEFINER. Write grants are
--   revoked BY NAME from authenticated, service_role and prep_app_dml, because the last two bypass row level
--   security. RLS has no write policy at all.
--
-- WHO READS
--   Staff read their sections; a student reads their own attempts and receipts (through the student pages, at
--   step 2). A student's attempt rows are empty at step 1.
--
-- ON DELETE
--   question_attempts to enrollment and offering: CASCADE (as grades does). To question and key version:
--   RESTRICT (retire, do not delete; a lesson delete removes the item first, so attempts are already gone).
--   submission_receipts.submission_id CASCADE; submission_receipts.activity_id SET NULL, because the artifact
--   swap deletes the old activity and the default would block that and lesson delete (the hash and the commit
--   time stay). key_remark_runs.question_id CASCADE. Who-columns on these log tables carry no foreign key.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- question_attempts ----------------------------------------------------------------------
CREATE TABLE question_attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  question_id            uuid NOT NULL REFERENCES questions(id)            ON DELETE RESTRICT,
  attempt_no             integer NOT NULL,
  answer                 jsonb NOT NULL,
  parsed_value           numeric,
  is_correct             boolean,
  points_awarded         numeric(6,2),
  key_version_id         uuid REFERENCES question_keys(id) ON DELETE RESTRICT,
  answered_at            timestamptz NOT NULL DEFAULT now(),
  is_late                boolean NOT NULL DEFAULT false,
  CONSTRAINT question_attempts_no_ck CHECK (attempt_no >= 1),
  CONSTRAINT question_attempts_points_ck CHECK (points_awarded IS NULL OR points_awarded >= 0),
  CONSTRAINT question_attempts_unique UNIQUE (enrollment_id, question_id, attempt_no)
);

CREATE INDEX question_attempts_offering_idx ON question_attempts (assignment_offering_id, enrollment_id);
CREATE INDEX question_attempts_question_idx ON question_attempts (question_id);

COMMENT ON TABLE question_attempts IS
  'Every answer is a row, written only by a server function. The grade is recomputed from these rows and '
  'written to grades (source auto_checked); the total reads grades, never attempts. answer holds the raw text '
  'and parsed_value the number read from it. key_version_id records which key version marked it.';

-- ---- submission_receipts --------------------------------------------------------------------
CREATE TABLE submission_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  activity_id    uuid REFERENCES activities(id) ON DELETE SET NULL,
  content_sha256 text NOT NULL,
  committed_at   timestamptz NOT NULL DEFAULT now(),
  is_late        boolean NOT NULL DEFAULT false,
  actor          uuid,
  CONSTRAINT submission_receipts_sha_ck CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX submission_receipts_submission_idx ON submission_receipts (submission_id);

COMMENT ON TABLE submission_receipts IS
  'For typed and tutor work: what was committed (a hash) and when. committed_at is set by the database, never by '
  'the client. actor is a plain uuid, with no foreign key, so removing a person never touches a receipt.';

-- ---- key_remark_runs ------------------------------------------------------------------------
CREATE TABLE key_remark_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id        uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  from_key_version   uuid,
  to_key_version     uuid,
  run_by             uuid,
  run_at             timestamptz NOT NULL DEFAULT now(),
  attempts_changed   integer NOT NULL DEFAULT 0,
  grades_recomputed  integer NOT NULL DEFAULT 0,
  grades_listed      integer NOT NULL DEFAULT 0,
  CONSTRAINT key_remark_runs_counts_ck CHECK (attempts_changed >= 0 AND grades_recomputed >= 0 AND grades_listed >= 0)
);

CREATE INDEX key_remark_runs_question_idx ON key_remark_runs (question_id, run_at DESC);

COMMENT ON TABLE key_remark_runs IS
  'One row per re-mark of a question against a corrected key: who, when, from and to which version, how many '
  'attempts changed, and how many instructor-corrected grades were listed rather than changed. Written by '
  'app.remark_question (Stage E).';

-- ---- RLS ---------------------------------------------------------------------------------------
ALTER TABLE question_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_remark_runs     ENABLE ROW LEVEL SECURITY;

CREATE POLICY question_attempts_read_own ON question_attempts FOR SELECT TO authenticated
  USING (enrollment_id IN (SELECT my_enrollments()));

CREATE POLICY question_attempts_read_staff ON question_attempts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e
                  WHERE e.id = question_attempts.enrollment_id
                    AND e.section_id IN (SELECT staff_sections())));

CREATE POLICY submission_receipts_read_own ON submission_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s
                  WHERE s.id = submission_receipts.submission_id
                    AND s.enrollment_id IN (SELECT my_enrollments())));

CREATE POLICY submission_receipts_read_staff ON submission_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s
                   JOIN enrollments e ON e.id = s.enrollment_id
                  WHERE s.id = submission_receipts.submission_id
                    AND e.section_id IN (SELECT staff_sections())));

CREATE POLICY key_remark_runs_read_staff ON key_remark_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM questions q
                   JOIN offering_activities oa ON oa.activity_id = q.activity_id
                   JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
                  WHERE q.id = key_remark_runs.question_id
                    AND ao.course_offering_id IN (SELECT staff_offerings())));

-- ---- grants: by name ---------------------------------------------------------------------------
REVOKE ALL ON question_attempts, submission_receipts, key_remark_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON question_attempts, submission_receipts, key_remark_runs
  FROM authenticated, service_role, prep_app_dml;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows: nobody but the owner can write these tables
--   SELECT g.grantee, g.table_name, g.privilege_type FROM information_schema.role_table_grants g
--    WHERE g.table_schema = 'app' AND g.table_name IN ('question_attempts', 'submission_receipts', 'key_remark_runs')
--      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
--      AND g.grantee IN ('anon', 'authenticated', 'service_role', 'prep_app_dml');
