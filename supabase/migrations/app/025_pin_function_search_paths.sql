-- PREP v2 -- pin the search path of every remaining function in schema `app`
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001, 004, 006, 014 and 019 (the functions it names).
-- Additive in effect: it changes no table, column, policy, trigger, grant or function body.
-- It sets one configuration value on seven functions. It does NOT depend on
-- 023_instructors_admin_flag_guard.sql and applies the same whether 023 is present or not.
--
-- WHY THIS EXISTS
--   Seven functions in `app` name tables and helper functions without a schema prefix and set
--   no search path of their own. They resolve those names through whatever path the CALLER's
--   session carries. Today the API sets that path to include `app`, so they work. A session
--   with a different path (an operator connection, a job, a future change to the API setting)
--   would see "relation does not exist", or worse, resolve a name to an object in another
--   schema. Every other function in `app` already pins `search_path = app, pg_temp`; these
--   seven were the ones created without it.
--
-- WHAT IT CHANGES
--   ALTER FUNCTION ... SET search_path = app, pg_temp   on:
--     touch_updated_at()                    trigger: updated_at on eight-plus tables
--     submissions_check_gradable()          trigger: only a graded activity can be chosen
--     submissions_lock_activity()           trigger: commit lock, calls current_uid()/is_staff()
--     grades_points_from_effort()           trigger: effort -> points
--     assignment_offerings_snapshot_guard() trigger: frozen content snapshot is immutable
--     freeze_assignment_offering(uuid, boolean)
--     freeze_term(text, boolean)
--
-- WHAT IT DOES NOT CHANGE
--   Security attributes. None of the seven is SECURITY DEFINER, and none becomes one: each
--   keeps running with the caller's privileges and the caller's row level security. ALTER
--   FUNCTION ... SET touches only the stored configuration. The functions that are already
--   SECURITY DEFINER and already pinned are not touched.
--
-- WHY ALTER AND NOT CREATE OR REPLACE
--   The bodies are untouched, so there is nothing to replace and no chance of the body in
--   this file drifting from the one that was applied.
--
-- THE ASSERTION AT THE END
--   After the changes, every function in `app` must carry a search_path setting that starts with
--   `search_path=app`, or this file raises and the whole transaction is rolled back. A future
--   function added without a pin will fail this check if the file is ever re-run, and the tests in
--   scripts/staging/test_trigger_search_path.py and tests/app-schema/test-db-schema.mjs fail on
--   it at any time.

BEGIN;

SET LOCAL search_path = app, public;

ALTER FUNCTION touch_updated_at()                          SET search_path = app, pg_temp;
ALTER FUNCTION submissions_check_gradable()                SET search_path = app, pg_temp;
ALTER FUNCTION submissions_lock_activity()                 SET search_path = app, pg_temp;
ALTER FUNCTION grades_points_from_effort()                 SET search_path = app, pg_temp;
ALTER FUNCTION assignment_offerings_snapshot_guard()       SET search_path = app, pg_temp;
ALTER FUNCTION freeze_assignment_offering(uuid, boolean)   SET search_path = app, pg_temp;
ALTER FUNCTION freeze_term(text, boolean)                  SET search_path = app, pg_temp;

DO $$
DECLARE
  unpinned text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO unpinned
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app'
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                      WHERE c LIKE 'search\_path=app%');
  IF unpinned IS NOT NULL THEN
    RAISE EXCEPTION 'functions in schema app without a search_path pinned to app: %', unpinned;
  END IF;
END $$;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.proconfig IS NULL;
--
--   -- must be unchanged from before: which functions are SECURITY DEFINER
--   SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' ORDER BY 1;
