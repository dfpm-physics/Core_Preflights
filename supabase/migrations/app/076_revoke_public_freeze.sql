-- PREP v2 -- two older functions no page calls stop being callable by everyone
-- =====================================================================================
-- Run as `prep_app_owner`. Added at the merge of step 2 and Stage E. Depends on 004_content_snapshot.sql.
--
-- WHY
--   Every function in schema app that was never given an explicit grant stays executable by PUBLIC, the PostgreSQL
--   default. Step 2 and Stage E grant by name and revoke the default for what they add; older functions kept it. Of
--   the 15 ordinary (non-trigger) functions that still carry it, 13 are the row-security helpers every policy
--   expression calls as the signed-in caller (current_uid, is_staff, is_admin, my_enrollments, my_offerings,
--   my_student_id, my_assignment_offerings, staff_sections, staff_offerings, director_courses, director_offerings,
--   session_uid, session_must_change_password): they take no argument, read only the caller's own session, and are
--   kept as they are. The other two are the term freeze functions, which write a content snapshot and are run by the
--   term tools, never by a page.
--
-- WHAT IT DOES
--   Revokes EXECUTE on freeze_assignment_offering(uuid, boolean) and freeze_term(text, boolean) from PUBLIC, anon,
--   authenticated, service_role and prep_app_read, and grants it to prep_app_dml (the tier the freeze tool uses). Both are
--   security invoker, so row security and table privileges already limited a caller; this removes the call itself.
--
-- WHAT IT DOES NOT DO
--   It changes no policy, no table and no other function. The trigger functions that PUBLIC may execute cannot be
--   called as functions and are left alone.
--
-- Rollback: rollback/076_revoke_public_freeze_ROLLBACK.sql grants the two functions to PUBLIC again.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

REVOKE ALL ON FUNCTION freeze_assignment_offering(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role, prep_app_read;
REVOKE ALL ON FUNCTION freeze_term(text, boolean)                FROM PUBLIC, anon, authenticated, service_role, prep_app_read;
GRANT EXECUTE ON FUNCTION freeze_assignment_offering(uuid, boolean) TO prep_app_dml;
GRANT EXECUTE ON FUNCTION freeze_term(text, boolean)                TO prep_app_dml;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- false / false / false / true
--   SELECT has_function_privilege('anon', 'app.freeze_term(text, boolean)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'app.freeze_term(text, boolean)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'app.freeze_assignment_offering(uuid, boolean)', 'EXECUTE'),
--          has_function_privilege('prep_app_dml', 'app.freeze_term(text, boolean)', 'EXECUTE');
