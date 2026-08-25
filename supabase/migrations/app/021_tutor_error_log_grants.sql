-- PREP v2 -- the grants 020 forgot: the writer could not write, the audit tier could not read
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 020_tutor_error_log.sql.
--
-- WHY THIS IS A SEPARATE MIGRATION
--   020 is applied (2026-08-25). An applied migration is history and does not get edited, so
--   what it left out lands as its own file.
--
-- WHAT 020 GOT WRONG
--   It granted `SELECT ... TO authenticated` and stopped. That is what the faculty page needs,
--   so the table looked finished and the deploy looked clean. Two roles were left with nothing:
--
--   1. **service_role could not INSERT.** The `log-tutor-error` edge function connects with the
--      service key, and the first real POST to it returned
--      `{"error":"permission denied for table tutor_error_log"}` -- HTTP 200, because the
--      function reports its own failures in the body, which is exactly why this did not look
--      like a deploy failure. The function was fine. It had nowhere to write.
--
--      **service_role is not a superuser and does not bypass GRANTS.** It bypasses RLS, which
--      is a different mechanism, and conflating the two is the whole trap here: the policy work
--      in 020 was correct and irrelevant, because the request never reached a policy.
--
--   2. **prep_app_read could not SELECT**, making this the ONLY table in schema `app` that the
--      read-only pooler tier could not see (verified 2026-08-25 against `has_table_privilege`;
--      analysis_runs, feedback, grades, submission_activities and user_preferences all readable).
--
-- WHY BOTH WERE MISSING FOR THE SAME REASON
--   Schema `app` has no DEFAULT PRIVILEGES behind it. The blanket grants from the bootstrap
--   (`GRANT ... ON ALL TABLES IN SCHEMA app TO ...`) covered only the tables that existed WHEN
--   THEY RAN, so **every new table in this schema starts with no grants to anyone**, and each
--   migration has to grant for itself. 020 did not, and nothing checks. The next table added
--   here will hit this too unless someone adds default privileges -- which is a broader change
--   than this file should make, and is a proposal, not a fix.
--
-- WHY THE READ TIER MATTERS MORE THAN IT LOOKS
--   CORE.md section 3 is explicit that any claim about totals, coverage or absence comes from
--   `prep_app_read` or the service role, never from a staff session -- because RLS answers
--   "what may you see" and never says which question it answered. A count(*) that is silently a
--   count(*) WHERE visible_to_me is indistinguishable from a fact.
--
--   This table exists to answer exactly that shape of question: how many cadets hit this, is one
--   lesson worse than the others, has anyone hit it since the fix. Leaving it readable only
--   through an RLS-filtered staff session would make the one table built for counting the one
--   table you must not count from.
--
-- WHAT IS STILL DELIBERATELY NOT GRANTED
--   * `service_role` gets INSERT only -- not SELECT, not UPDATE, not DELETE. The function only
--     ever inserts. Pruning old rows is a future decision with its own migration.
--   * `prep_app_dml` gets nothing. Nothing in the DML tier writes here, and a diagnostic record
--     nobody can forge is worth more than a convenient one.
--   * `anon` gets nothing. The blanket bootstrap grant happens to have given `anon` SELECT on
--     older tables, where RLS then refuses it -- belt and braces. This table starts clean and
--     stays that way: there is no anon policy, so a grant would be dead privilege, and dead
--     privilege is what someone later mistakes for intent.

BEGIN;

SET LOCAL search_path = app, public;

-- The writer. INSERT on the table, and USAGE on the sequence behind `id bigserial` -- a
-- bigserial column needs BOTH, and granting only the table fails on the nextval() instead,
-- one step further along and with a different message.
GRANT INSERT ON tutor_error_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE tutor_error_log_id_seq TO service_role;

-- The audit tier.
GRANT SELECT ON tutor_error_log TO prep_app_read;

COMMIT;

-- Verify, in two parts.
--
-- 1. As prep_app_read over the session pooler (username is <role>.<project_ref>) -- expect 0.
--    Anything else is another table that shipped without its grants:
--
--      SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'app' AND c.relkind = 'r'
--         AND NOT has_table_privilege(current_user, c.oid, 'SELECT');
--
-- 2. End to end, which is the one that actually proves it -- POST to the function and read the
--    row back. A body of {"success":true} rather than {"error":...} is the pass; remember the
--    function answers HTTP 200 either way, so the status code proves nothing.
