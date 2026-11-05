-- 060_student_reads.sql
-- Run as `prep_app_owner`. Step 2 batch. Not applied anywhere yet; proven on a scratch database only.
--
-- WHAT THE STUDENT PAGES NEED THAT THE DATABASE DOES NOT YET OFFER
--
-- 1. The student schedule and the grade list read one rule. `gradebook_cells` and `my_course_total` (039) already
--    return a student only their own rows and hold the one calculation, but they were deliberately granted to
--    nobody at step 1. Both check their caller, so granting them to `authenticated` lets a signed-in cadet read
--    exactly their own cells and their own total, and a staff member the sections they may see. A caller who is
--    neither gets `not permitted` (gradebook_cells) or an empty set (my_course_total).
--      This file OWNS the `gradebook_cells` grant. The staff entry migration (065) repeats it as an idempotent
--      GRANT so that it works on its own, but its rollback does not revoke it; this file's rollback does (see there).
--      Not granted here: `course_totals` (staff, not needed by a student page), `_cells_at` / `_totals_at`
--      (internal), `scheduled_deadline` / `effective_deadline` / `release_at` (the pages keep using the
--      browser-side deadline helpers, which the offline tests pin against these).
--
-- 2. A cadet keeps reading a term after their enrollments complete (E23). `my_offerings()` said `status = 'active'`,
--    and four policies lean on it (course_offerings, sections, assignment_offerings, and through them the activity
--    and due-date reads). When Fall enrollments move to `completed`, a cadet would have lost the very items their
--    grades hang off. It now answers for `active` and `completed` enrollments, the same two statuses the total counts.
--    A `dropped` enrollment still reads nothing.
--      This widens a READ only. Nothing here lets a cadet write to a completed term: the submission and grade
--      write rules are separate policies and triggers, which this file does not touch.
--
-- WHAT IS DELIBERATELY NOT DONE
--   * No release-time rule on assignment_offerings, questions, or grades. That belongs to the access batch.
--   * No change to a grant of any other function. CREATE OR REPLACE keeps the grants `my_offerings()` already has.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION my_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT DISTINCT s.course_offering_id
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.student_id = my_student_id() AND e.status IN ('active', 'completed');
$$;

GRANT EXECUTE ON FUNCTION gradebook_cells(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION my_course_total(uuid, text) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT r, has_function_privilege(r, 'app.gradebook_cells(uuid,text)', 'EXECUTE') AS cells,
--             has_function_privilege(r, 'app.my_course_total(uuid,text)', 'EXECUTE') AS total,
--             has_function_privilege(r, 'app.course_totals(uuid,text)', 'EXECUTE')   AS staff_totals
--     FROM unnest(ARRAY['anon', 'authenticated']) r;
--   -- expect: anon false/false/false; authenticated true/true/false
