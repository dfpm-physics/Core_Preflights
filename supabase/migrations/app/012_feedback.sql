-- PREP v2 — in-app feedback capture
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
--
-- WHY THIS EXISTS
--   The app is about to go to instructors to test. A floating box on every page lets them say what
--   they like, dislike, want added or removed, or want built — and this table is where that lands,
--   tagged with who said it and which page they were on. It is meant to be POLLED later to steer
--   what gets built next, so the shape optimises for "read the newest N, grouped by page/category".
--
-- ONE ROW PER SUBMISSION, WRITE-ONCE
--   Feedback is an utterance at a moment, not a record that gets edited. There is no updated_at and
--   no UPDATE/DELETE policy: a submission is immutable to the app tier once made. Corrections are a
--   new row, which is also the honest audit of what was actually said.
--
-- WHO SAID IT — NON-FORGEABLE
--   `submitted_by` is the submitter's auth uid, and the INSERT policy's WITH CHECK pins it to
--   `current_uid()`, so a caller cannot file feedback as somebody else. `submitter_name` and
--   `role` are denormalised conveniences captured at submit time (a name is what a human reading
--   the poll wants, not a uuid); they are hints, not identity — the uid is identity.
--
--   No FK to auth.users, for the reason user_preferences (010) documents at length: the app owner
--   cannot be delegated REFERENCES on schema auth. A deleted user leaves an orphaned row of
--   feedback holding no grade and no PII beyond a name the person typed nothing sensitive into.
--   Both instructors and students carry an auth uid, so one column serves either submitter.
--
-- WHO READS IT — ADMINS ONLY, FOR NOW
--   SELECT is gated to global admins (is_admin()). Feedback is steering data for whoever runs the
--   product, not something an instructor needs to read back, and it may name other people or pages
--   in ways a cohort peer should not browse. Opening it to directors later is additive; starting
--   open would be the breaking direction. The policies call app.is_admin() / app.current_uid(),
--   never auth.uid() — the app tier has no privileges on schema auth (see 010's header).
--
-- NO GRANTs, FOLLOWING 008
--   app_schema_bootstrap.sql §4 default privileges already reach every table the owner creates;
--   008_student_identity.sql:147-149 states the convention. Protection here is the policies (a
--   self-scoped INSERT, an admin-only SELECT, and NO update/delete policy at all), not a grant.

BEGIN;

SET LOCAL search_path = app, public;

CREATE TABLE IF NOT EXISTS feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The submitter's auth uid. Pinned to the JWT by the INSERT policy — see the header.
  submitted_by   uuid NOT NULL,
  submitter_name text,                    -- readable name captured at submit time (a hint)
  role           text CHECK (role IS NULL OR role IN ('faculty', 'student')),

  -- Which page they were on. `page` is the pathname (stable, greppable); `page_title` is the
  -- human label (document.title), because "Gradebook" reads better in a poll than a path.
  page           text NOT NULL,
  page_title     text,

  category       text NOT NULL
                   CHECK (category IN ('like', 'dislike', 'feature', 'add', 'remove', 'other')),

  -- The actual words. Non-blank and capped, same spirit as every other free-text column here.
  message        text NOT NULL
                   CHECK (length(btrim(message)) > 0 AND length(message) <= 4000),

  user_agent     text,                    -- optional context for a confusing report
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE feedback IS
  'In-app feedback from the floating box on every page: one immutable row per submission, tagged '
  'with the submitter''s auth uid (non-forgeable via RLS), a readable name, the page, and a '
  'category (like/dislike/feature/add/remove/other). Meant to be polled to steer future work. '
  'STAFF-INVISIBLE except global admins — it is steering data, not a peer-readable board.';

COMMENT ON COLUMN feedback.submitted_by IS
  'Submitter auth uid; the INSERT policy pins it to current_uid() so feedback cannot be filed as '
  'another person. This is identity — submitter_name/role are only hints captured alongside it.';

-- Polling reads newest-first, often filtered by page or category.
CREATE INDEX IF NOT EXISTS feedback_created_idx  ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_page_idx      ON feedback (page, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_category_idx  ON feedback (category, created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Anyone signed in may file feedback, but only as themselves.
DROP POLICY IF EXISTS feedback_insert_self ON feedback;
CREATE POLICY feedback_insert_self ON feedback FOR INSERT TO authenticated
WITH CHECK (submitted_by = current_uid());

-- Only global admins may read it back. No UPDATE or DELETE policy exists, so the app tier cannot
-- alter or remove a submission — it is write-once through the API.
DROP POLICY IF EXISTS feedback_admin_read ON feedback;
CREATE POLICY feedback_admin_read ON feedback FOR SELECT TO authenticated
USING (is_admin());

COMMIT;
