-- Read-only checks to run on the live database, over the read-only role, before step 1.
-- Checks 1 to 6 read the system catalog only. Checks 7 to 16 also read tables, but return only
-- counts, a version or course codes: no name, no score, no free text. Paste the output of each
-- query next to its expected result. Checks 17 and 18 read the catalog only. Nothing here writes.
--
-- The seven function names below are the ones migration 025 pins. They are the repo's list.

-- 1. Which role is this session running as?
--    Expected: both columns show the read-only role (prep_app_read).
SELECT current_user AS current_role_name, session_user AS session_role_name;

-- 2. Functions in schema app that have no stored search_path and are NOT among the seven that
--    025 pins.
--    Expected: 0 rows. Any row is a function that 025 would not fix, and its assertion would
--    then refuse to commit.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'app'
   AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                    WHERE c LIKE 'search\_path=app%')
   AND p.proname NOT IN ('touch_updated_at', 'submissions_check_gradable',
                         'submissions_lock_activity', 'grades_points_from_effort',
                         'assignment_offerings_snapshot_guard', 'freeze_assignment_offering',
                         'freeze_term')
 ORDER BY 1;

-- 3. The seven functions: who owns each, and what path is stored now.
--    Expected: 7 rows; owner is prep_app_owner on every row; stored_path is empty (NULL) on
--    every row before 025 and 'search_path=app, pg_temp' after it.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_userbyid(p.proowner)               AS owner,
       array_to_string(p.proconfig, ', ')        AS stored_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'app'
   AND p.proname IN ('touch_updated_at', 'submissions_check_gradable',
                     'submissions_lock_activity', 'grades_points_from_effort',
                     'assignment_offerings_snapshot_guard', 'freeze_assignment_offering',
                     'freeze_term')
 ORDER BY 1;

-- 4. Do the two lower tiers bypass row level security?
--    Expected: 2 rows, and bypasses_rls is true on both. That is how the bootstrap file sets
--    them (a direct connection has no sign-in claims). A false here means the live roles differ
--    from the bootstrap file; report it, do not change it.
SELECT rolname, rolbypassrls AS bypasses_rls, rolcanlogin AS can_log_in
  FROM pg_roles
 WHERE rolname IN ('prep_app_dml', 'prep_app_read')
 ORDER BY 1;

-- 5. Is migration 023 absent?
--    Expected before step 2: function_present = false and trigger_present = false.
SELECT to_regprocedure('app.instructors_admin_flag_guard()') IS NOT NULL AS function_present,
       EXISTS (SELECT 1 FROM pg_trigger t
                WHERE t.tgname = 'instructors_admin_flag_guard'
                  AND NOT t.tgisinternal)                              AS trigger_present;

-- 6. Is the ledger table (migration 024) absent?
--    Expected before step 1 is applied: false.
SELECT to_regclass('app.migration_ledger') IS NOT NULL AS ledger_present;


-- 7. Postgres version. The deadline function's date test needs 16 or later.
--    Expected: 16 or higher (staging is 17.6).
SHOW server_version;

-- 8. Grades whose copy of possible points disagrees with the offering.
--    Expected: 0 before step 2. A nonzero count lists rows to settle before the one total rule.
SELECT count(*) AS grades_with_other_possible
  FROM app.grades g
  JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
 WHERE g.points_possible <> ao.points_possible;

-- 9. Finalized grades with no points. The new total reads them as ungraded.
--    Expected: a count to note; no fixed answer.
SELECT count(*) AS finalized_without_points
  FROM app.grades
 WHERE is_finalized AND points_earned IS NULL;

-- 10. Courses with more than one active offering. Migration 028 refuses to run while one exists.
--     Expected: 0 rows. If the training sandbox appears, make its extra offering inactive first.
SELECT c.code, count(*) AS active_offerings
  FROM app.course_offerings co
  JOIN app.courses c ON c.id = co.course_id
 WHERE co.is_active
 GROUP BY 1
HAVING count(*) > 1;

-- 11. Unpublished items that already have submissions.
--     Expected: 0. A nonzero count means a job that skips unpublished items could hide work.
SELECT count(*) AS unpublished_with_submissions
  FROM app.assignment_offerings ao
 WHERE NOT ao.is_published
   AND EXISTS (SELECT 1 FROM app.submissions s WHERE s.assignment_offering_id = ao.id);

-- 12. Activity types in use.
--     Expected: only 'written' and 'interactive'. The backfill stops on anything else.
SELECT a.modality, count(*) AS rows_using_it
  FROM app.offering_activities oa
  JOIN app.activities a ON a.id = oa.activity_id
 GROUP BY 1
 ORDER BY 1;

-- 13. Stored per-day deadlines that are not full timestamps with an offset.
--     Expected: 0. Anything else cannot be matched to the site's result.
SELECT count(*) AS day_values_not_timestamps
  FROM app.assignment_offerings ao, jsonb_each_text(ao.due_by_day) d
 WHERE d.value IS NOT NULL
   AND d.value !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}(:?\d{2})?)$';

-- 14. Cadets holding two enrollments in one course offering.
--     Expected: a count to note. The total lists these as exceptions.
SELECT count(*) AS cadets_with_two_enrollments
  FROM (SELECT e.student_id, s.course_offering_id
          FROM app.enrollments e
          JOIN app.sections s ON s.id = e.section_id
         GROUP BY 1, 2
        HAVING count(*) > 1) x;

-- 15. Published items, split by whether their offering is active.
--     Expected: a pair of counts to note. The publishing rule acts only on a change to published,
--     so past terms that already hold published items are fine.
SELECT co.is_active, count(*) AS published_items
  FROM app.assignment_offerings ao
  JOIN app.course_offerings co ON co.id = ao.course_offering_id
 WHERE ao.is_published
 GROUP BY 1
 ORDER BY 1;

-- 16. Active enrollments on inactive offerings.
--     Expected: 0, or a named past term.
SELECT count(*) AS active_enrollments_on_inactive_offerings
  FROM app.enrollments e
  JOIN app.sections s ON s.id = e.section_id
  JOIN app.course_offerings co ON co.id = s.course_offering_id
 WHERE e.status = 'active' AND NOT co.is_active;

-- 17. Who owns the tables the 041 helpers read, whether FORCE ROW LEVEL SECURITY is on, and what the owner role
--     can do. The helpers read through the nested policies only because the owner owns the table and FORCE is off.
--     (041 refuses on FORCE alone, even when the owner role bypasses row security: the safe direction.)
--     Prints names, booleans and a verdict, never a secret.
--     Expected: ten rows, every row ok. The last row is a total, so a table that is missing or renamed shows as
--     "expected 10, found N" instead of vanishing from a list of ok rows.
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced,
       r.rolbypassrls AS owner_bypasses_rls, r.rolsuper AS owner_is_superuser, r.rolcanlogin AS owner_can_log_in,
       CASE WHEN pg_get_userbyid(c.relowner) = 'prep_app_owner' AND NOT c.relforcerowsecurity THEN 'ok' ELSE 'LOOK' END AS verdict
  FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
 WHERE c.relnamespace = 'app'::regnamespace
   AND c.relname IN ('activities', 'assignments', 'offering_activities', 'assignment_offerings',
                     'questions', 'question_keys', 'instructors', 'staff_assignments', 'courses', 'course_offerings')
UNION ALL
SELECT 'TOTAL', NULL, NULL, NULL, NULL, NULL,
       CASE WHEN count(*) = 10 THEN 'ok' ELSE 'LOOK: expected 10, found ' || count(*) END
  FROM pg_class c
 WHERE c.relnamespace = 'app'::regnamespace
   AND c.relname IN ('activities', 'assignments', 'offering_activities', 'assignment_offerings',
                     'questions', 'question_keys', 'instructors', 'staff_assignments', 'courses', 'course_offerings')
 ORDER BY 1;

-- 18. The 041 and 042 functions: owner, SECURITY MODE and a pinned search path. Expected: seven rows, every row ok.
--     The four set helpers read as their owner on purpose (security definer = true). The two save functions and the
--     author stamp must be SECURITY INVOKER (false): the caller's own row-level security is their whole safety
--     argument, and a "fix" that recreated one as definer would run as a role that bypasses it. A wrong mode, a wrong
--     owner, a missing function or a loose search path all print LOOK. Before 041 is applied this returns the
--     TOTAL row only, with LOOK, which is expected there.
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       array_to_string(p.proconfig, ', ') AS stored_path,
       CASE WHEN pg_get_userbyid(p.proowner) = 'prep_app_owner'
             AND p.proconfig::text LIKE '%search_path=app, pg_temp%'
             AND p.prosecdef = (p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids',
                                              'directed_question_ids', 'staff_visible_question_ids'))
            THEN 'ok' ELSE 'LOOK' END AS verdict
  FROM pg_proc p
 WHERE p.pronamespace = 'app'::regnamespace
   AND p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids', 'directed_question_ids',
                     'staff_visible_question_ids', 'save_letter_scale', 'save_question', 'letter_scales_stamp')
UNION ALL
SELECT 'TOTAL', NULL, NULL, NULL,
       CASE WHEN count(*) = 7 THEN 'ok' ELSE 'LOOK: expected 7, found ' || count(*) END
  FROM pg_proc p
 WHERE p.pronamespace = 'app'::regnamespace
   AND p.proname IN ('directed_activity_ids', 'staff_visible_activity_ids', 'directed_question_ids',
                     'staff_visible_question_ids', 'save_letter_scale', 'save_question', 'letter_scales_stamp')
 ORDER BY 1;

-- 19. The offering guard (043): the trigger exists, is enabled, and runs before insert, update and delete.
--     Expected: one row, verdict ok. Before 043 is applied it returns no row, which is expected there.
SELECT t.tgname, t.tgenabled AS enabled,
       CASE WHEN t.tgenabled = 'O' AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16
            THEN 'ok' ELSE 'LOOK' END AS verdict
  FROM pg_trigger t
 WHERE t.tgrelid = 'app.course_offerings'::regclass AND t.tgname = 'course_offerings_admin_guard' AND NOT t.tgisinternal;
