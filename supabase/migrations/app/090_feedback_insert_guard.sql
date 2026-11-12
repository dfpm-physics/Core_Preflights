-- 090: a feedback row can only be INSERTED as a plain new submission. The workflow columns are written by UPDATE, never by the submitter.
--
-- WHY
--   feedback_insert_self (012) checks one thing: submitted_by = current_uid(). Every other column is the submitter's to choose. So any
--   signed-in tester (the test site's logins follow public password rules) could INSERT a row that is already status='accepted', with
--   a forged director_instructions, decided_by and decided_at, and the feedback-triage runbook would then act on it as though the
--   director had approved it. 089 added the columns that make that forgery meaningful; this closes it.
--
-- WHAT IT DOES
--   A BEFORE INSERT trigger on feedback, for EVERY inserting role (the owner and the service role too), forces status='new' and sets
--   to NULL: triage, agent_note, agent_ref, agent_at, director_instructions, decided_by, decided_at, resolution_note, roadmap_ref,
--   resolved_by, resolved_at, completed_at, completed_by. The submitter's own columns (submitted_by, submitter_name, role, page,
--   page_title, category, message, id, created_at) are untouched. UPDATE is unaffected: directors still approve and the agent still
--   marks rows through UPDATE, as 013 and 089 describe.
--
-- WHO THIS CHANGES
--   Nothing in the app or the repo inserts a non-new feedback row (site/js/feedback.js sends the submitter's columns only;
--   supabase/admin/app_invariant_test.py and the staging seeds insert plain rows). Anything that needs a resolved or applied row,
--   such as a future seed or a test, must INSERT it and then UPDATE it.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION; the trigger is dropped and recreated. No row changes.
-- Rollback: rollback/090_feedback_insert_guard_ROLLBACK.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION feedback_insert_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  NEW.status                := 'new';
  NEW.triage                := NULL;
  NEW.agent_note            := NULL;
  NEW.agent_ref             := NULL;
  NEW.agent_at              := NULL;
  NEW.director_instructions := NULL;
  NEW.decided_by            := NULL;
  NEW.decided_at            := NULL;
  NEW.resolution_note       := NULL;
  NEW.roadmap_ref           := NULL;
  NEW.resolved_by           := NULL;
  NEW.resolved_at           := NULL;
  NEW.completed_at          := NULL;
  NEW.completed_by          := NULL;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION feedback_insert_guard() IS
  'BEFORE INSERT on feedback: a new row is always status new with every workflow column NULL. Migration 090.';

DROP TRIGGER IF EXISTS feedback_insert_guard ON feedback;
CREATE TRIGGER feedback_insert_guard
  BEFORE INSERT ON feedback
  FOR EACH ROW EXECUTE FUNCTION feedback_insert_guard();

COMMIT;
