-- PREP v2 -- remove the step 1 rules that held new items back (the marker rule stays)
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 028_offering_policy.sql, 029_grades_over_max.sql and 070_answer_internals.sql (the
-- rules it removes). Apply AFTER 078_ai_drafts_need_a_person.sql, which keeps the one rule that still matters for the
-- AI-drafted option once these are gone. Order at apply time: 077, 078, 079. Added 2026-11-05 on branch v2-step2-rollin;
-- revised the same day after review, before it was applied anywhere.
--
-- WHAT IT REMOVES  (four rules, five triggers; each trigger's function goes with it)
--   1. assignment_offerings_new_stay_unpublished        publishing an item entered on a new page.
--   2. assignment_offerings_publish_needs_active        a change to is_published = true while the course offering is inactive.
--   3. grades_new_items_stay_unfinalized                a finalized grade on an item entered on a new page (the 070 body).
--   4. assignment_offerings_new_paths_stay_unpublished  publishing an item that has an online-questions, in-person or
--      and offering_activities_new_paths_stay_unpublished  elsewhere path, and adding such a path to a published item.
--
-- WHAT STAYS
--   course_offerings_one_active (a second active offering of one course), the grading_mode sync trigger, the column
--   entered_on_new_page itself (a later migration drops it once no page reads it), the rule that the marker cannot be
--   cleared (assignment_offerings_marker_one_way: the grading-mode sync, the older editor's guard, the Health page and the
--   nightly worklist still read the marker, so it stays one-way until they stop), and everything 078 adds.
--   Row security is unchanged and still decides who may write an offering or a grade.
--
-- WHAT THIS CHANGES FOR A WRITER
--   An item made on a newer page can be published. A grade on it can be finalized by anything that may write grades
--   (a staff session, the data role), except on an item with an ai_drafted path, where 078 still requires a staff
--   session. The answer functions' marker (app.auto_check_marker) is untouched; it is still read by the other rules.
--
-- WHAT IT DOES NOT DO
--   It changes no stored row and publishes nothing. It drops no column. Publishing into a course offering that is not
--   active is no longer refused (rule 2 above); when a cadet sees an item is still decided by its release date, not by this.
--
-- Rollback: rollback/079_drop_step1_rules_ROLLBACK.sql puts the five triggers back. It prints a count of the finalized grades the restored rule will then guard, and checks nothing else: a rule fires only
-- on a later write, so rows made while the rules were gone are left as they are.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS assignment_offerings_new_stay_unpublished ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_new_stay_unpublished();

DROP TRIGGER IF EXISTS assignment_offerings_publish_needs_active ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_publish_needs_active();

DROP TRIGGER IF EXISTS grades_new_items_stay_unfinalized ON grades;
DROP FUNCTION IF EXISTS grades_new_items_stay_unfinalized();

DROP TRIGGER IF EXISTS assignment_offerings_new_paths_stay_unpublished ON assignment_offerings;
DROP FUNCTION IF EXISTS assignment_offerings_new_paths_stay_unpublished();

DROP TRIGGER IF EXISTS offering_activities_new_paths_stay_unpublished ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_new_paths_stay_unpublished();

COMMENT ON COLUMN assignment_offerings.entered_on_new_page IS
  'Says which page created a row: true means entered on a v2 page. It no longer restricts publishing or finalizing '
  '(migration 079). Kept until no page reads it.';

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- must be 0 rows: none of the six triggers remain
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
--     ('assignment_offerings_new_stay_unpublished', 'assignment_offerings_publish_needs_active',
--      'grades_new_items_stay_unfinalized',
--      'assignment_offerings_new_paths_stay_unpublished', 'offering_activities_new_paths_stay_unpublished');
--   -- must be 1 row: the marker rule stays
--   SELECT 1 FROM pg_trigger WHERE tgname = 'assignment_offerings_marker_one_way' AND NOT tgisinternal;
--   -- must be 1 row: 078's rule is in place
--   SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.grades'::regclass AND tgname = 'grades_ai_drafts_need_a_person' AND NOT tgisinternal;
