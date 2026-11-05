-- 059_key_version_guard.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- A REPLACED ANSWER KEY VERSION IS KEPT AS IT WAS
--
-- An answer key is versioned: saving a changed key marks the current row superseded and adds a new row. Marking
-- and grading read that history ("which key was in force when this answer was marked"), so a replaced version has
-- to stay exactly as it was. Until now that was how the pages and save_question behaved, not a rule of the table:
-- the policy `question_keys_write_director` is FOR ALL, so a director's request made some other way than through
-- the page could edit a replaced row in place or delete it. This file makes the page's behaviour the database's.
--
-- WHAT THE GUARD DOES
--   For a request arriving as `anon` or `authenticated` (the API roles), on a row whose `superseded_at` is set:
--     UPDATE   refused, whatever column is named (this includes clearing `superseded_at`).
--     DELETE   refused.
--   Not refused:
--     * a cascade. Deleting a question, an activity or an assignment removes its keys with it, and that removal
--       runs inside the foreign key's own action (trigger depth above one, and as the table owner).
--     * a foreign key's own action on an instructor stamp (`checked_by`, `created_by` set to null).
--     * a change to the CURRENT key (a row with `superseded_at` null): marking it checked, and above all
--       superseding it, which is how a key is replaced. save_question, the lesson editor's key filing (047), the
--       bulk key import and the term copy all do only this, or insert.
--     * every other role (service_role, postgres, the prep_app_* tiers). Those are server-side: the edge
--       functions, the term builders, the admin scripts and the rollback of 047. The pattern is 043's.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * The policies, and every existing column and row. Nothing stored moves.
--   * The current key. A director can still change a current row in place through the API, and save_question
--     does not. A rule for that is a separate decision: it would also forbid the page's "mark checked" write.
--   * Insert. A new version, or a key for a question that has none, is written as before.
--   * It does not make the history tamper-proof against the server-side roles above. It stops the API.
--
-- Closes review item A M2 (041's header recorded the gap as accepted until this file).
--
-- Rollback: rollback/059_key_version_guard_ROLLBACK.sql drops the trigger and its function. It holds no data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION question_keys_old_version_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  -- Only requests made AS the API roles are checked, and a foreign key's own action (a cascade) is let through:
  -- the trigger runs one level down inside it.
  IF current_user IN ('anon', 'authenticated') AND pg_trigger_depth() <= 1 AND OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'an answer key version that has been replaced is kept as it was and cannot be changed or deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION question_keys_old_version_guard() IS
  'Refuses an API change or delete of a replaced answer key version. A cascade, the current key and the server-side '
  'roles pass. Migration 059.';

CREATE TRIGGER question_keys_old_version_guard
  BEFORE UPDATE OR DELETE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_old_version_guard();

REVOKE ALL ON FUNCTION question_keys_old_version_guard() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the trigger is there, on both operations, for each row
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'app.question_keys'::regclass AND tgname = 'question_keys_old_version_guard';
--
--   -- how many replaced versions the guard now protects (a count, nothing is changed)
--   SELECT count(*) FROM app.question_keys WHERE superseded_at IS NOT NULL;
--
-- The behaviour is proved by scripts/staging/test_key_version_guard_scratch.py on a throwaway database.
