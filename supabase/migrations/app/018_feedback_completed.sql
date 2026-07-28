-- PREP v2 — completion stamp for accepted feedback
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 013_feedback_resolution.sql.
--
-- WHY THIS EXISTS
--   013 gave every comment a DECISION. It gave nobody a way to say the decision had been ACTED ON,
--   so an accepted item sat in the triage list forever, indistinguishable from one agreed to five
--   minutes ago. With ~19 pages feeding the box that list only grows, and a list that only grows is
--   one nobody opens — the same failure 013 was written to prevent, one step further along.
--
-- WHY A COLUMN AND NOT A FIFTH STATUS
--   013's header refuses a 'done' STATUS, and that refusal still holds: status is the TRIAGE
--   DECISION, and 'completed' is not a decision, it is an outcome. Making it a status would also
--   break two things 013 built:
--
--     * feedback_roadmap_ref_accepted_ck (roadmap_ref IS NULL OR status = 'accepted') would reject
--       a completed row that carries a roadmap ref — i.e. exactly the rows most likely to be done.
--     * the roadmap skill's work list keys on status = 'accepted', so completing an item would
--       silently drop it out of a query that has nothing to do with completion.
--
--   As a separate axis, neither happens. An item is accepted (the decision) and separately carries
--   a completion stamp (the outcome), and every existing constraint, index and query is untouched.
--
-- THE ROADMAP WORK LIST IS DELIBERATELY UNCHANGED
--       SELECT * FROM app.feedback WHERE status = 'accepted' AND roadmap_ref IS NULL;
--
--   still means "agreed to, not yet written down" — completion is NOT subtracted from it. That is
--   intentional, not an oversight: docs/ROADMAP.md §8 records what LANDED, so a shipped item still
--   wants a line there. Do not add `AND completed_at IS NULL` to that query or its partial index.
--
-- NO NEW INDEX, ON PURPOSE
--   The admin view reads the whole table in one unbounded select (013's header explains why that is
--   safe — this table grows by human typing, hundreds a term). Splitting open from completed is
--   done in the browser over rows already in hand, so an index here would serve no query.

BEGIN;

SET LOCAL search_path = app, public;

ALTER TABLE feedback
  -- When the accepted item was actually built. NULL = agreed to but not done yet.
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,

  -- Who marked it done. SET NULL, not CASCADE, for the same reason as resolved_by (013): an admin
  -- leaving must not erase the record that the work was finished.
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES instructors(id) ON DELETE SET NULL;

-- Only an accepted item can be complete. A declined or duplicate comment has no work in it to
-- finish, and a 'new' one has not been agreed to — so this also forces the UI to CLEAR the stamp
-- when a decision is withdrawn, rather than leaving "done" hanging off a row nobody agreed to.
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_completed_accepted_ck
    CHECK (completed_at IS NULL OR status = 'accepted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Attribution without a completion is a dangling credit for something that did not happen.
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_completed_pair_ck
    CHECK (completed_by IS NULL OR completed_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN feedback.completed_at IS
  'When the accepted item was actually built. NULL = agreed to, not done yet. Separate from status '
  'on purpose: status is the triage DECISION, this is the OUTCOME. Does NOT affect the roadmap '
  'work list (status = ''accepted'' AND roadmap_ref IS NULL) — a shipped item still wants a '
  'ROADMAP.md §8 line.';
COMMENT ON COLUMN feedback.completed_by IS
  'Which admin marked it done. NULL when never completed, or when that admin''s row was deleted.';

COMMIT;
