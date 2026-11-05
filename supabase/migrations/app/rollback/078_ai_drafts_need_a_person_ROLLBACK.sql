-- Rollback for 078_ai_drafts_need_a_person.sql. Run as `prep_app_owner`.
--
-- Removes the rule only. No stored row changes. After this, nothing in the database stops a script from finalizing a
-- mark on an AI-drafted item unless the step 1 rule (grades_new_items_stay_unfinalized) is still in place and the item
-- is a new-page item. Do not run it while 079 is applied unless that is intended.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS grades_ai_drafts_need_a_person ON grades;
DROP FUNCTION IF EXISTS grades_ai_drafts_need_a_person();

COMMIT;
