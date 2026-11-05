-- PREP v2 -- a mark on an AI-drafted item is finalized, and un-finalized, only by a signed-in staff member
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 049_grade_audit.sql (audit_actor) and 077_ai_drafted_grading.sql (the ai_drafted
-- value). Apply it before 079, which removes the step 1 rule that used to hold this line for new items.
-- Added 2026-11-05 on branch v2-step2-rollin; revised the same day after review, before it was applied anywhere.
--
-- WHY
--   On an item with an ai_drafted path the overnight job writes suggested marks. A suggested mark is an unfinalized
--   grade. Only a person releases it, and only a person takes a released mark back. Until now the skill's own rule
--   ("write is_finalized = false") was the only thing saying so for a new item, next to a database rule that 079
--   removes. This migration makes the line a database rule that holds without the other one.
--
-- WHAT IT DOES
--   1. grades_ai_drafts_need_a_person  (BEFORE INSERT, and BEFORE UPDATE, on grades). On an offering that has a path
--      graded ai_drafted, a write that finalizes a mark, or that un-finalizes a finalized one, is refused unless the
--      session names a staff member (audit_actor() is not null). A script on the service key or on a pooled data role
--      names no one, so a nightly upsert that writes is_finalized = false over a released mark is refused too. An update
--      that changes nothing audited on an already finalized row (points, source, effort, per-question scores, grader,
--      enrollment, the over-max flag, the graded-at stamp, and the instructor note a cadet reads inside diagnostic) is let
--      through. It does not read `source`: the grade page
--      keeps `ai_suggested` when a person accepts an untouched draft, and refusing that value would block the review it
--      exists to allow.
--      The rule applies to the typed path only. An offering that offers a choice (a typed path graded ai_drafted and a
--      tutor path) also takes a cadet's tutor report, which writes a derived, finalized grade as the cadet commits. That
--      grade is let through when it is derived from a committed submission whose chosen path is not the ai_drafted one.
--   2. offering_activities_ai_drafted_stays  (BEFORE UPDATE OF grading, assignment_offering_id, and BEFORE DELETE, on
--      offering_activities). A path graded ai_drafted cannot be switched to another grading, moved to another item, or
--      removed, while the offering holds any grade, unless the session names a staff member. Without this the first rule
--      could be stepped around by editing the path. A delete that is part of removing the whole offering is not affected.
--   3. grades_ai_drafts_keep_released  (BEFORE DELETE on grades, finalized rows only). On an offering that has an
--      ai_drafted path, a finalized mark is deleted only by a session that names a staff member. A delete that is part of
--      removing the whole offering, or the enrollment, is not affected (the parent row is already gone when it fires).
--
-- WHAT IT DOES NOT DO
--   It changes no stored row and no other function, and it does not apply to an item with no ai_drafted path. It leaves
--   an unfinalized draft deletable and rewritable by a script (that is the nightly job's work). It trusts the session to say who is signed in: it stops a script that names no one, and
--   it is not a defence against a connection that supplies its own session claims.
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
  IF NOT EXISTS (SELECT 1 FROM offering_activities oa
                  WHERE oa.assignment_offering_id = NEW.assignment_offering_id
                    AND oa.grading = 'ai_drafted') THEN
    RETURN NEW;                                   -- no AI-drafted path on this item
  END IF;
  IF NEW.source = 'derived' AND NEW.submission_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM submissions s
         JOIN offering_activities oa ON oa.assignment_offering_id = s.assignment_offering_id
                                    AND oa.activity_id = s.chosen_activity_id
        WHERE s.id = NEW.submission_id
          AND s.status = 'committed'
          AND s.enrollment_id = NEW.enrollment_id
          AND s.assignment_offering_id = NEW.assignment_offering_id
          AND oa.grading <> 'ai_drafted') THEN
    RETURN NEW;                                   -- the cadet's tutor report, graded from its own effort
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_finalized AND NEW.is_finalized
     AND NEW.points_earned    IS NOT DISTINCT FROM OLD.points_earned
     AND NEW.points_possible  IS NOT DISTINCT FROM OLD.points_possible
     AND NEW.source           IS NOT DISTINCT FROM OLD.source
     AND NEW.effort           IS NOT DISTINCT FROM OLD.effort
     AND NEW.question_scores  IS NOT DISTINCT FROM OLD.question_scores
     AND NEW.graded_by        IS NOT DISTINCT FROM OLD.graded_by
     AND NEW.enrollment_id    IS NOT DISTINCT FROM OLD.enrollment_id
     AND NEW.over_max_allowed IS NOT DISTINCT FROM OLD.over_max_allowed
     AND NEW.graded_at        IS NOT DISTINCT FROM OLD.graded_at
     AND (NEW.diagnostic -> 'instructor_note') IS NOT DISTINCT FROM (OLD.diagnostic -> 'instructor_note') THEN
    RETURN NEW;                                   -- already finalized by a person, nothing audited changes
  END IF;
  RAISE EXCEPTION
    'grade on assignment offering %: a mark on an AI-drafted item is finalized, or taken back, only by a signed-in staff member (grades_ai_drafts_need_a_person)',
    NEW.assignment_offering_id USING ERRCODE = 'check_violation';
END; $$;

COMMENT ON FUNCTION grades_ai_drafts_need_a_person() IS
  'Refuses finalizing, or un-finalizing, a mark on an item with an ai_drafted path unless the session names a staff member (audit_actor). A tutor-derived grade on a choice item is let through. Migration 078.';

CREATE TRIGGER grades_ai_drafts_need_a_person_ins
  BEFORE INSERT ON grades
  FOR EACH ROW WHEN (NEW.is_finalized)
  EXECUTE FUNCTION grades_ai_drafts_need_a_person();

CREATE TRIGGER grades_ai_drafts_need_a_person
  BEFORE UPDATE ON grades
  FOR EACH ROW WHEN (NEW.is_finalized OR OLD.is_finalized)
  EXECUTE FUNCTION grades_ai_drafts_need_a_person();

CREATE FUNCTION offering_activities_ai_drafted_stays() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF audit_actor() IS NULL
     AND OLD.grading = 'ai_drafted'
     AND (TG_OP = 'DELETE' OR NEW.grading IS DISTINCT FROM 'ai_drafted'
          OR NEW.assignment_offering_id IS DISTINCT FROM OLD.assignment_offering_id)
     AND EXISTS (SELECT 1 FROM assignment_offerings ao WHERE ao.id = OLD.assignment_offering_id)
     AND EXISTS (SELECT 1 FROM grades g WHERE g.assignment_offering_id = OLD.assignment_offering_id) THEN
    RAISE EXCEPTION
      'assignment offering %: an AI-drafted path with grades on it is changed or removed only by a signed-in staff member (offering_activities_ai_drafted_stays)',
      OLD.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION offering_activities_ai_drafted_stays() IS
  'Keeps an ai_drafted path in place while the offering holds grades, unless the session names a staff member. Migration 078.';

CREATE TRIGGER offering_activities_ai_drafted_stays
  BEFORE UPDATE OF grading, assignment_offering_id OR DELETE ON offering_activities
  FOR EACH ROW
  EXECUTE FUNCTION offering_activities_ai_drafted_stays();

CREATE FUNCTION grades_ai_drafts_keep_released() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF audit_actor() IS NULL
     AND EXISTS (SELECT 1 FROM offering_activities oa
                  WHERE oa.assignment_offering_id = OLD.assignment_offering_id AND oa.grading = 'ai_drafted')
     AND EXISTS (SELECT 1 FROM assignment_offerings ao WHERE ao.id = OLD.assignment_offering_id)
     AND EXISTS (SELECT 1 FROM enrollments e WHERE e.id = OLD.enrollment_id) THEN
    RAISE EXCEPTION
      'grade on assignment offering %: a released mark on an AI-drafted item is deleted only by a signed-in staff member (grades_ai_drafts_keep_released)',
      OLD.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END; $$;

COMMENT ON FUNCTION grades_ai_drafts_keep_released() IS
  'Refuses deleting a finalized mark on an item with an ai_drafted path unless the session names a staff member. Removing the whole offering or enrollment is not affected. Migration 078.';

CREATE TRIGGER grades_ai_drafts_keep_released
  BEFORE DELETE ON grades
  FOR EACH ROW WHEN (OLD.is_finalized)
  EXECUTE FUNCTION grades_ai_drafts_keep_released();

REVOKE ALL ON FUNCTION grades_ai_drafts_need_a_person()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_ai_drafts_keep_released()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION offering_activities_ai_drafted_stays()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 4 rows
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('grades_ai_drafts_need_a_person', 'grades_ai_drafts_need_a_person_ins',
--     'grades_ai_drafts_keep_released', 'offering_activities_ai_drafted_stays') AND NOT tgisinternal;
--   -- must be 0 rows: nobody can execute either function directly
--   SELECT grantee FROM information_schema.routine_privileges
--    WHERE specific_schema = 'app' AND routine_name IN ('grades_ai_drafts_need_a_person', 'grades_ai_drafts_keep_released', 'offering_activities_ai_drafted_stays')
--      AND grantee IN ('anon', 'authenticated', 'service_role', 'prep_app_dml', 'prep_app_read');
