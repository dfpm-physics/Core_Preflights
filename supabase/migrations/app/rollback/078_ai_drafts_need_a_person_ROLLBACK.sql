-- Rollback for 078_ai_drafts_need_a_person.sql. Run as `prep_app_owner`.
--
-- Removes the two rules only. No stored row changes. It REFUSES while an ai_drafted path exists and the step 1 rule
-- (grades_new_items_stay_unfinalized, removed by 079) is gone: after the rollback nothing in the database would stop a
-- script from finalizing, or taking back, a mark on an AI-drafted item. Roll 079 back first, or move every ai_drafted path
-- off that grading, then run this.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM offering_activities WHERE grading = 'ai_drafted')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'grades_new_items_stay_unfinalized' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '078 rollback refused: an ai_drafted path exists and the step 1 grade rule is not in place';
  END IF;
END $$;

DROP TRIGGER IF EXISTS offering_activities_ai_drafted_stays ON offering_activities;
DROP FUNCTION IF EXISTS offering_activities_ai_drafted_stays();
DROP TRIGGER IF EXISTS grades_ai_drafts_need_a_person_ins ON grades;
DROP TRIGGER IF EXISTS grades_ai_drafts_need_a_person ON grades;
DROP FUNCTION IF EXISTS grades_ai_drafts_need_a_person();

COMMIT;
