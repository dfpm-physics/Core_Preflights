-- PREP v2 -- a finalized grade on an AI-drafted item needs a signed-in staff member
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 049_grade_audit.sql (audit_actor) and 077_ai_drafted_grading.sql (the ai_drafted
-- value). Apply it before 079, which removes the step 1 rule that used to hold this line for new items.
-- Added 2026-11-05 on branch v2-step2-rollin.
--
-- WHY
--   On an item with an ai_drafted path the overnight job writes suggested marks. A suggested mark is an unfinalized
--   grade. Only a person releases it. Until now the skill's own rule ("write is_finalized = false") was the only thing
--   saying so for a new item, next to a database rule that 079 removes. This migration makes the line a database rule
--   that holds without the other one.
--
-- WHAT IT DOES
--   grades_ai_drafts_need_a_person  BEFORE INSERT OR UPDATE on grades, firing only WHEN (NEW.is_finalized). It refuses
--   when the offering has a path graded ai_drafted and the session names no staff member (audit_actor() is null): the
--   service key, the pooled database roles the scripts use, and a cadet session are all refused, whatever the script
--   says. A signed-in staff member is let through, and so is an update that changes nothing audited on a row that is
--   already finalized. It does not read `source`: the grade page keeps `ai_suggested` when a person accepts an
--   untouched draft, and refusing that value would block the review it exists to allow.
--
-- WHAT IT DOES NOT DO
--   It changes no stored row and no other function, and it does not apply to an item with no ai_drafted path.
--
-- Rollback: rollback/078_ai_drafts_need_a_person_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE FUNCTION grades_ai_drafts_need_a_person() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF audit_actor() IS NOT NULL THEN
    RETURN NEW;                                   -- a signed-in staff member
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_finalized
     AND NEW.points_earned    IS NOT DISTINCT FROM OLD.points_earned
     AND NEW.points_possible  IS NOT DISTINCT FROM OLD.points_possible
     AND NEW.source           IS NOT DISTINCT FROM OLD.source
     AND NEW.effort           IS NOT DISTINCT FROM OLD.effort
     AND NEW.question_scores  IS NOT DISTINCT FROM OLD.question_scores
     AND NEW.graded_by        IS NOT DISTINCT FROM OLD.graded_by
     AND NEW.enrollment_id    IS NOT DISTINCT FROM OLD.enrollment_id THEN
    RETURN NEW;                                   -- already finalized by a person, nothing audited changes
  END IF;
  IF EXISTS (SELECT 1 FROM offering_activities oa
              WHERE oa.assignment_offering_id = NEW.assignment_offering_id
                AND oa.grading = 'ai_drafted') THEN
    RAISE EXCEPTION
      'grade on assignment offering %: a mark on an AI-drafted item is finalized only by a signed-in staff member (grades_ai_drafts_need_a_person)',
      NEW.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION grades_ai_drafts_need_a_person() IS
  'Refuses a finalized grade on an item with an ai_drafted path unless the session names a staff member (audit_actor). Migration 078.';

CREATE TRIGGER grades_ai_drafts_need_a_person
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW WHEN (NEW.is_finalized)
  EXECUTE FUNCTION grades_ai_drafts_need_a_person();

REVOKE ALL ON FUNCTION grades_ai_drafts_need_a_person()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 1 row
--   SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.grades'::regclass AND tgname = 'grades_ai_drafts_need_a_person' AND NOT tgisinternal;
--   -- must be 0 rows: nobody can execute the function directly
--   SELECT grantee FROM information_schema.routine_privileges
--    WHERE specific_schema = 'app' AND routine_name = 'grades_ai_drafts_need_a_person'
--      AND grantee IN ('anon', 'authenticated', 'service_role', 'prep_app_dml', 'prep_app_read');
