-- Rollback for 079_drop_step1_rules.sql. Run as `prep_app_owner`.
--
-- THIS ROLLBACK REFUSES (it does not handle the case) while any item entered on a newer page is published. The restored
-- grade rule would then refuse the finalized grade a cadet's tutor commit writes, and every staff finalize, on a live item,
-- with a raw database error for cadets and staff. Unpublish those items (or finish with them) first; the refusal names the count.
--
-- Puts the four step 1 rules (five triggers) back exactly as 028, 029 and 070 left them. The marker rule was never
-- dropped, so it is not touched. A rule fires only on a later
-- write, so rows made while the rules were gone (a published new-page item, a finalized grade on one) are left as they
-- are; they simply cannot be changed in the refused ways until the rules are dropped again.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM assignment_offerings WHERE is_published AND entered_on_new_page;
  IF n > 0 THEN
    RAISE EXCEPTION '079 rollback refused: % published item(s) were entered on a newer page. The restored rules would make a cadet''s tutor commit and every staff finalize on them fail. Unpublish them first, then run this again.', n
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- Say what the restored grade rule will get in the way of: finalized grades already on new-page items. They are left as
-- they are, but any later edit of one by staff is refused until the rule is dropped again.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM grades g JOIN assignment_offerings ao ON ao.id = g.assignment_offering_id
   WHERE g.is_finalized AND ao.entered_on_new_page;
  RAISE NOTICE '079 rollback: % finalized grade(s) on new-page items will be refused on any later change', n;
END $$;

-- ---- 1. a new-page item cannot be published ------------------------------------------------
CREATE FUNCTION assignment_offerings_new_stay_unpublished() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'assignment offering %: an item entered on a new page cannot be published yet (assignment_offerings_new_stay_unpublished)',
    NEW.id USING ERRCODE = 'check_violation';
END; $$;

CREATE TRIGGER assignment_offerings_new_stay_unpublished
  BEFORE INSERT OR UPDATE ON assignment_offerings
  FOR EACH ROW WHEN (NEW.is_published AND NEW.entered_on_new_page)
  EXECUTE FUNCTION assignment_offerings_new_stay_unpublished();

-- ---- 5. a path only a new page produces keeps its item unpublished --------------------------------
CREATE FUNCTION assignment_offerings_new_paths_stay_unpublished() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM offering_activities oa
              WHERE oa.assignment_offering_id = NEW.id
                AND oa.delivery IN ('online_questions', 'in_person', 'elsewhere')) THEN
    RAISE EXCEPTION
      'assignment offering %: an item with an online-questions, in-person or elsewhere path cannot be published yet (assignment_offerings_new_paths_stay_unpublished)',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_new_paths_stay_unpublished
  BEFORE INSERT OR UPDATE OF is_published ON assignment_offerings
  FOR EACH ROW WHEN (NEW.is_published)
  EXECUTE FUNCTION assignment_offerings_new_paths_stay_unpublished();

CREATE FUNCTION offering_activities_new_paths_stay_unpublished() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assignment_offerings ao
              WHERE ao.id = NEW.assignment_offering_id AND ao.is_published) THEN
    RAISE EXCEPTION
      'assignment offering %: a published item cannot take an online-questions, in-person or elsewhere path yet (offering_activities_new_paths_stay_unpublished)',
      NEW.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER offering_activities_new_paths_stay_unpublished
  BEFORE INSERT OR UPDATE OF delivery, assignment_offering_id ON offering_activities
  FOR EACH ROW WHEN (NEW.delivery IN ('online_questions', 'in_person', 'elsewhere'))
  EXECUTE FUNCTION offering_activities_new_paths_stay_unpublished();

-- ---- 2. publishing needs an active course offering ---------------------------------------------------
CREATE FUNCTION assignment_offerings_publish_needs_active() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_published THEN
      RETURN NEW;
    END IF;
  ELSIF EXISTS (
       SELECT 1 FROM assignment_offerings x
        WHERE x.is_published
          AND (x.id = NEW.id
               OR (x.course_offering_id = NEW.course_offering_id AND x.assignment_id = NEW.assignment_id))) THEN
    RETURN NEW;
  END IF;
  IF NOT coalesce((SELECT co.is_active FROM course_offerings co WHERE co.id = NEW.course_offering_id), false) THEN
    RAISE EXCEPTION
      'assignment offering %: cannot be published while its course offering is inactive (assignment_offerings_publish_needs_active)',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_publish_needs_active
  BEFORE INSERT OR UPDATE OF is_published ON assignment_offerings
  FOR EACH ROW WHEN (NEW.is_published)
  EXECUTE FUNCTION assignment_offerings_publish_needs_active();

-- ---- 3. a new-page item carries no finalized grade (the 070 body: the answer functions' marker passes) ----
CREATE FUNCTION grades_new_items_stay_unfinalized() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('app.auto_check_marker', true), '') = 'on' THEN
    RETURN NEW;                           -- the answer-marking function writing an auto_checked grade
  END IF;
  IF coalesce((SELECT ao.entered_on_new_page FROM assignment_offerings ao
                WHERE ao.id = NEW.assignment_offering_id), false) THEN
    RAISE EXCEPTION
      'grade on assignment offering %: an item entered on a new page cannot hold a finalized grade yet (grades_new_items_stay_unfinalized)',
      NEW.assignment_offering_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER grades_new_items_stay_unfinalized
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW WHEN (NEW.is_finalized)
  EXECUTE FUNCTION grades_new_items_stay_unfinalized();

REVOKE ALL ON FUNCTION assignment_offerings_new_stay_unpublished()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION assignment_offerings_publish_needs_active()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION assignment_offerings_new_paths_stay_unpublished()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION offering_activities_new_paths_stay_unpublished()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_new_items_stay_unfinalized()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMENT ON COLUMN assignment_offerings.entered_on_new_page IS
  'Says which page owns a row: true means entered on a v2 page. TEMPORARY, removed at step 2 with the three '
  'step 1 rules. It says who owns the row, never what kind of work it is.';

COMMIT;
