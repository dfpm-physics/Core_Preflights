-- PREP v2 -- delivery and grading live on the path
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql (activities, offering_activities).
-- Needs no other earlier migration, and does NOT depend on 023_instructors_admin_flag_guard.sql.
-- Additive in effect for every writer that exists today. Design: docs/decisions/V2-DATA-MODEL.md
-- section 3.
--
-- WHAT IT DOES
--   activities.modality   the check gains `questions` and `external`. `written` and `interactive`
--                         keep their meaning.
--   offering_activities   gains three NULLABLE columns:
--     delivery          online_questions | typed_response | interactive_tutor | in_person | elsewhere
--     grading           auto_checked | human_graded | effort | hand_entered | imported
--     warn_earns_full   whether a yellow mark earns full credit (true only with human_graded)
--   a CHECK on the allowed (delivery, grading) pairs, and a fill-and-validate trigger.
--
-- WHY THE COLUMNS LIVE ON THE PATH, NOT THE ITEM
--   A preflight with a written path and a tutor path has two deliveries and two grading methods
--   under one grade, so an item-level column could not hold it.
--
-- THE FILL TRIGGER  (offering_activities_fill_path, BEFORE INSERT OR UPDATE OF delivery, grading, activity_id)
--   Old writers (the lesson editor, the term builders) know nothing of these columns, so:
--     * delivery is NULL: it is filled from the modality. written -> typed_response, human_graded,
--       warn_earns_full true. interactive -> interactive_tutor, effort, false. Any OTHER modality
--       with a null delivery RAISES: only a new page writes those, and it must say what it means.
--     * on every write it validates the modality against the delivery (questions needs
--       online_questions, external needs in_person or elsewhere, and so on).
--     * it refuses a path beside an auto_checked path, in either order, because an auto_checked
--       path owns the offering's points (030) and points have one owner.
--   It is SECURITY DEFINER because it reads `activities` and the sibling paths whoever writes.
--   Step 2 adds NOT NULL to the three columns, after the backfill.
--
-- WHAT IT DOES NOT DO
--   It does not touch any existing row. The backfill (scripts/v2/backfill_paths.py) writes the two
--   existing modalities' values later, and writes one table only.
--   grading_mode on the offering is handled by a second trigger in 028, which needs the
--   entered_on_new_page marker that 028 creates.
--
-- THE CURRENT SITE
--   Old pages find paths with find(modality === 'written') and find(modality === 'interactive'),
--   so an unknown modality is simply not found. questionsOf() returns an empty list when content
--   has none. Student pages never receive an unpublished item.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- activities.modality ----------------------------------------------------------------
ALTER TABLE activities DROP CONSTRAINT activities_modality_check;
ALTER TABLE activities ADD CONSTRAINT activities_modality_check
  CHECK (modality IN ('written', 'interactive', 'questions', 'external'));

COMMENT ON COLUMN activities.modality IS
  'written and interactive are the original two. questions (online question set marked by the '
  'system) and external (in person, or worked elsewhere and entered or imported) carry no '
  'artifact and no typed response.';

-- ---- offering_activities: three nullable columns -----------------------------------------
ALTER TABLE offering_activities
  ADD COLUMN delivery        text,
  ADD COLUMN grading         text,
  ADD COLUMN warn_earns_full boolean;

ALTER TABLE offering_activities
  ADD CONSTRAINT offering_activities_delivery_grading_ck CHECK (
    (delivery IS NULL AND grading IS NULL)
    OR (delivery IS NOT NULL AND grading IS NOT NULL
        AND (delivery, grading) IN (
          ('online_questions', 'auto_checked'),
          ('online_questions', 'human_graded'),
          ('typed_response',   'human_graded'),
          ('interactive_tutor', 'effort'),
          ('in_person',        'hand_entered'),
          ('in_person',        'imported'),
          ('elsewhere',        'hand_entered'),
          ('elsewhere',        'imported')))),
  ADD CONSTRAINT offering_activities_warn_needs_human_ck CHECK (
    warn_earns_full IS NOT TRUE OR grading = 'human_graded');

COMMENT ON COLUMN offering_activities.delivery IS
  'How the student does the work. Nullable until step 2 (NOT NULL after the backfill); the fill '
  'trigger supplies it for written and interactive paths.';
COMMENT ON COLUMN offering_activities.grading IS
  'How the work is graded. See offering_activities_delivery_grading_ck for the allowed pairs.';
COMMENT ON COLUMN offering_activities.warn_earns_full IS
  'Whether a yellow (warn) mark earns full credit. True only with human_graded. New items write '
  'false; backfilled preflights write true.';

-- ---- the fill-and-validate trigger -------------------------------------------------------
CREATE FUNCTION offering_activities_fill_path() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_modality text;
BEGIN
  SELECT a.modality INTO v_modality FROM activities a WHERE a.id = NEW.activity_id;
  IF v_modality IS NULL THEN
    RETURN NEW;                          -- the foreign key reports the missing activity
  END IF;

  IF NEW.delivery IS NULL THEN
    IF NEW.grading IS NOT NULL THEN
      RAISE EXCEPTION 'a path that names its grading (%) must also name its delivery', NEW.grading
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_modality = 'written' THEN
      NEW.delivery := 'typed_response';
      NEW.grading := 'human_graded';
      NEW.warn_earns_full := coalesce(NEW.warn_earns_full, true);
    ELSIF v_modality = 'interactive' THEN
      NEW.delivery := 'interactive_tutor';
      NEW.grading := 'effort';
      NEW.warn_earns_full := coalesce(NEW.warn_earns_full, false);
    ELSE
      RAISE EXCEPTION 'a path on a % activity must say its delivery and grading', v_modality
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.grading IS NULL THEN
    RAISE EXCEPTION 'a path that names its delivery (%) must also name its grading', NEW.delivery
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.warn_earns_full := coalesce(NEW.warn_earns_full, false);

  -- modality against delivery: the one rule that crosses two tables
  IF NOT (   (v_modality = 'questions'   AND NEW.delivery = 'online_questions')
          OR (v_modality = 'written'     AND NEW.delivery = 'typed_response')
          OR (v_modality = 'interactive' AND NEW.delivery = 'interactive_tutor')
          OR (v_modality = 'external'    AND NEW.delivery IN ('in_person', 'elsewhere'))) THEN
    RAISE EXCEPTION 'delivery % does not fit a % activity', NEW.delivery, v_modality
      USING ERRCODE = 'check_violation';
  END IF;

  -- an auto_checked path owns the offering's points, so it is the offering's only path
  IF NEW.grading = 'auto_checked' THEN
    IF EXISTS (SELECT 1 FROM offering_activities o
                WHERE o.assignment_offering_id = NEW.assignment_offering_id
                  AND o.activity_id <> NEW.activity_id) THEN
      RAISE EXCEPTION 'an auto_checked path must be the only path on its offering'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM offering_activities o
                 WHERE o.assignment_offering_id = NEW.assignment_offering_id
                   AND o.activity_id <> NEW.activity_id
                   AND o.grading = 'auto_checked') THEN
    RAISE EXCEPTION 'this offering has an auto_checked path, which must be its only path'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION offering_activities_fill_path() IS
  'Fills delivery, grading and warn_earns_full for written and interactive paths written by old '
  'code, and validates the pair, the modality and the one-path rule for auto_checked on every write.';

CREATE TRIGGER offering_activities_fill_path
  BEFORE INSERT OR UPDATE OF delivery, grading, activity_id ON offering_activities
  FOR EACH ROW EXECUTE FUNCTION offering_activities_fill_path();

REVOKE ALL ON FUNCTION offering_activities_fill_path()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- unchanged until the backfill: every existing path still has NULL delivery and grading
--   SELECT count(*) FILTER (WHERE delivery IS NOT NULL) AS filled, count(*) AS paths
--     FROM app.offering_activities;
--
--   -- the trigger and its function are pinned
--   SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'app' AND p.proname = 'offering_activities_fill_path';
