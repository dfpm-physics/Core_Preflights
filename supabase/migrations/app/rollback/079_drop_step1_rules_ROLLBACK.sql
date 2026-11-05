-- Rollback for 079_drop_step1_rules.sql. Run as `prep_app_owner`.
--
-- Puts the five step 1 rules (six triggers) back exactly as 028, 029 and 070 left them. A rule fires only on a later
-- write, so rows made while the rules were gone (a published new-page item, a finalized grade on one) are left as they
-- are; they simply cannot be changed in the refused ways until the rules are dropped again.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

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

-- ---- 4. the marker is one-way -----------------------------------------------------------------
CREATE FUNCTION assignment_offerings_marker_one_way() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'assignment offering %: entered_on_new_page cannot be cleared (assignment_offerings_marker_one_way)',
    NEW.id USING ERRCODE = 'check_violation';
END; $$;

CREATE TRIGGER assignment_offerings_marker_one_way
  BEFORE UPDATE OF entered_on_new_page ON assignment_offerings
  FOR EACH ROW WHEN (OLD.entered_on_new_page AND NOT NEW.entered_on_new_page)
  EXECUTE FUNCTION assignment_offerings_marker_one_way();

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
REVOKE ALL ON FUNCTION assignment_offerings_marker_one_way()
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
