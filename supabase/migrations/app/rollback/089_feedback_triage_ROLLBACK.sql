-- Rollback of 089: restores the four-state status check (013) and the accepted-only completion check (018), and drops the triage columns.
--
-- BEHAVIOUR WITH ROWS THAT USE THE NEW STATES: this FAILS, by design, and changes nothing (one transaction). It refuses if any row has
-- status 'proposed' or 'applied'. It does not map them to 'new', because that would quietly turn an applied change back into an
-- untriaged request and lose the fact that it was made. Resolve those rows by hand first (for example set a proposed row to 'new'
-- or 'declined', and an applied row to 'accepted' or 'declined'; an applied row with completed_at must lose it or become accepted),
-- then run this again.
-- Rows that are 'accepted' or 'declined' but carry director_instructions or agent notes lose those columns when they are dropped.
-- Export them first if they matter.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM feedback WHERE status IN ('proposed', 'applied')) THEN
    RAISE EXCEPTION 'rollback 089 refused: feedback rows hold status proposed or applied; move them to another status first';
  END IF;
END $$;

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_triage_ck;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_agent_note_size;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_agent_ref_size;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_director_instructions_size;

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_ck;
ALTER TABLE feedback ADD CONSTRAINT feedback_status_ck
  CHECK (status IN ('new', 'accepted', 'declined', 'duplicate'));

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_completed_accepted_ck;
ALTER TABLE feedback ADD CONSTRAINT feedback_completed_accepted_ck
  CHECK (completed_at IS NULL OR status = 'accepted');

ALTER TABLE feedback
  DROP COLUMN IF EXISTS triage,
  DROP COLUMN IF EXISTS agent_note,
  DROP COLUMN IF EXISTS agent_ref,
  DROP COLUMN IF EXISTS agent_at,
  DROP COLUMN IF EXISTS director_instructions,
  DROP COLUMN IF EXISTS decided_by,
  DROP COLUMN IF EXISTS decided_at;

COMMENT ON COLUMN feedback.status IS
  'Triage decision: new | accepted | declined | duplicate. There is deliberately no ''roadmapped'' '
  'state - an accepted item is "written down" exactly when roadmap_ref is non-NULL.';

COMMIT;
