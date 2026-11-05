-- 044_same_offering_checks.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so.
--
-- A ROW THAT NAMES TWO THINGS MUST NAME TWO THINGS OF THE SAME COURSE OFFERING
--
-- Several tables join a thing that belongs to one course offering to a thing that belongs to another
-- offering, and nothing stated that the two had to match. Row level security decides what a caller
-- may reach by looking at one side of the pair, so a row whose two sides disagree can make the
-- decision answer for the wrong offering. Three tables already refuse such a row (excusals, group
-- members, column closures). This file adds the same refusal to the rest.
--
-- WHAT IS ENFORCED, for every role, on INSERT and on an UPDATE of the columns named:
--
--   staff_assignments        the section, when one is named, belongs to the row's course offering.
--   assignment_due_dates     the section belongs to the same offering as the item.
--   grades                   the enrollment (through its section) belongs to the same offering as the item.
--   submissions              same.
--   extensions               same.
--   question_attempts        same.
--   student_group_snapshots  the group belongs to the item's offering, and so does the enrollment.
--   student_group_grades     the group belongs to the item's offering.
--   assignment_offerings     the assignment belongs to the offering's course, or to no course (a shared
--                            library item, assignments.course_id NULL, which every course may schedule).
--   offering_activities      the activity belongs to the item's own assignment.
--
-- Each refusal is an error with SQLSTATE 23514 (check_violation) and a sentence that names the rule.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * The policies. Who may read or write what is exactly as before; these triggers only refuse a row
--     whose two sides disagree.
--   * Rows that already exist. A trigger looks at the row being written, so an old row is not touched
--     and not rechecked until someone changes one of the checked columns. The block at the end
--     COUNTS old rows that disagree and raises a WARNING with the count; it does not fix or delete
--     any. Fixing a row is a separate, snapshot-first decision.
--   * An update that does not touch the checked columns (a grade's points, a submission's status)
--     does not run the check, so the nightly jobs and the backfill pay nothing.
--   * A shared library assignment (course_id NULL) stays schedulable into any offering: that is how the
--     library is meant to work, so the item-to-course check passes it.
--
-- The check functions are SECURITY DEFINER so they read the parent rows whatever the caller's row
-- visibility is: a check that could only see the caller's own offerings would pass exactly the rows it
-- exists to refuse. They pin their search path and are not callable by the API roles.
--
-- Rollback: rollback/044_same_offering_checks_ROLLBACK.sql drops the eleven triggers and six functions.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- staff_assignments: section belongs to the row's offering ---------------------------------
CREATE FUNCTION staff_assignments_same_offering() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_co uuid;
BEGIN
  IF NEW.section_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.course_offering_id INTO v_co FROM sections s WHERE s.id = NEW.section_id;
  IF v_co IS DISTINCT FROM NEW.course_offering_id THEN
    RAISE EXCEPTION 'a staff assignment must name a section of its own course offering'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER staff_assignments_same_offering
  BEFORE INSERT OR UPDATE OF course_offering_id, section_id ON staff_assignments
  FOR EACH ROW EXECUTE FUNCTION staff_assignments_same_offering();

-- ---- a section and an item (assignment_due_dates) -----------------------------------------------
CREATE FUNCTION section_matches_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_sec uuid;
  v_ao  uuid;
BEGIN
  SELECT s.course_offering_id INTO v_sec FROM sections s WHERE s.id = NEW.section_id;
  SELECT ao.course_offering_id INTO v_ao FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  IF v_sec IS DISTINCT FROM v_ao THEN
    RAISE EXCEPTION 'a section and an item must belong to the same course offering'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_due_dates_same_offering
  BEFORE INSERT OR UPDATE OF section_id, assignment_offering_id ON assignment_due_dates
  FOR EACH ROW EXECUTE FUNCTION section_matches_item();

-- ---- an enrollment and an item (grades, submissions, extensions, attempts, group snapshots) -----
CREATE FUNCTION enrollment_matches_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_enr uuid;
  v_ao  uuid;
BEGIN
  SELECT s.course_offering_id INTO v_enr
    FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE e.id = NEW.enrollment_id;
  SELECT ao.course_offering_id INTO v_ao FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  IF v_enr IS DISTINCT FROM v_ao THEN
    RAISE EXCEPTION 'an enrollment and an item must belong to the same course offering'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER grades_same_offering
  BEFORE INSERT OR UPDATE OF enrollment_id, assignment_offering_id ON grades
  FOR EACH ROW EXECUTE FUNCTION enrollment_matches_item();
CREATE TRIGGER submissions_same_offering
  BEFORE INSERT OR UPDATE OF enrollment_id, assignment_offering_id ON submissions
  FOR EACH ROW EXECUTE FUNCTION enrollment_matches_item();
CREATE TRIGGER extensions_same_offering
  BEFORE INSERT OR UPDATE OF enrollment_id, assignment_offering_id ON extensions
  FOR EACH ROW EXECUTE FUNCTION enrollment_matches_item();
CREATE TRIGGER question_attempts_same_offering
  BEFORE INSERT OR UPDATE OF enrollment_id, assignment_offering_id ON question_attempts
  FOR EACH ROW EXECUTE FUNCTION enrollment_matches_item();
CREATE TRIGGER student_group_snapshots_enrollment_same_offering
  BEFORE INSERT OR UPDATE OF enrollment_id, assignment_offering_id ON student_group_snapshots
  FOR EACH ROW EXECUTE FUNCTION enrollment_matches_item();

-- ---- a group and an item (group snapshots, group grades) ---------------------------------------
CREATE FUNCTION group_matches_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_grp uuid;
  v_ao  uuid;
BEGIN
  SELECT g.course_offering_id INTO v_grp FROM student_groups g WHERE g.id = NEW.group_id;
  SELECT ao.course_offering_id INTO v_ao FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  IF v_grp IS DISTINCT FROM v_ao THEN
    RAISE EXCEPTION 'a group and an item must belong to the same course offering'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER student_group_snapshots_group_same_offering
  BEFORE INSERT OR UPDATE OF group_id, assignment_offering_id ON student_group_snapshots
  FOR EACH ROW EXECUTE FUNCTION group_matches_item();
CREATE TRIGGER student_group_grades_same_offering
  BEFORE INSERT OR UPDATE OF group_id, assignment_offering_id ON student_group_grades
  FOR EACH ROW EXECUTE FUNCTION group_matches_item();

-- ---- an item and the course that owns its assignment (assignment_offerings) --------------------
CREATE FUNCTION item_matches_course() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_asg_course uuid;
  v_co_course  uuid;
BEGIN
  SELECT a.course_id INTO v_asg_course FROM assignments a WHERE a.id = NEW.assignment_id;
  IF v_asg_course IS NULL THEN
    RETURN NEW;   -- a shared library assignment belongs to no one course
  END IF;
  SELECT co.course_id INTO v_co_course FROM course_offerings co WHERE co.id = NEW.course_offering_id;
  IF v_asg_course IS DISTINCT FROM v_co_course THEN
    RAISE EXCEPTION 'an item must schedule an assignment of its own course, or a shared one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_same_course
  BEFORE INSERT OR UPDATE OF course_offering_id, assignment_id ON assignment_offerings
  FOR EACH ROW EXECUTE FUNCTION item_matches_course();

-- ---- a path and its item (offering_activities) --------------------------------------------------
CREATE FUNCTION path_matches_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_act_asg uuid;
  v_ao_asg  uuid;
BEGIN
  SELECT a.assignment_id INTO v_act_asg FROM activities a WHERE a.id = NEW.activity_id;
  SELECT ao.assignment_id INTO v_ao_asg FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  IF v_act_asg IS DISTINCT FROM v_ao_asg THEN
    RAISE EXCEPTION 'a path must be an activity of the item''s own assignment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER offering_activities_same_assignment
  BEFORE INSERT OR UPDATE OF assignment_offering_id, activity_id ON offering_activities
  FOR EACH ROW EXECUTE FUNCTION path_matches_item();

COMMENT ON FUNCTION item_matches_course() IS
  'Refuses an item whose assignment belongs to a different course than the offering (a shared assignment passes). Migration 044.';
COMMENT ON FUNCTION path_matches_item() IS
  'Refuses a path whose activity belongs to a different assignment than the item. Migration 044.';
COMMENT ON FUNCTION staff_assignments_same_offering() IS
  'Refuses a staff assignment whose section belongs to a different course offering. Migration 044.';
COMMENT ON FUNCTION section_matches_item() IS
  'Refuses a row whose section and item belong to different course offerings. Migration 044.';
COMMENT ON FUNCTION enrollment_matches_item() IS
  'Refuses a row whose enrollment and item belong to different course offerings. Migration 044.';
COMMENT ON FUNCTION group_matches_item() IS
  'Refuses a row whose group and item belong to different course offerings. Migration 044.';

REVOKE ALL ON FUNCTION staff_assignments_same_offering(), section_matches_item(),
                       enrollment_matches_item(), group_matches_item(),
                       item_matches_course(), path_matches_item()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

-- ---- count old rows that already disagree (report only; nothing is changed) --------------------
DO $$
DECLARE
  n_staff int; n_due int; n_grades int; n_subs int; n_ext int; n_att int; n_item int; n_path int;
BEGIN
  SELECT count(*) INTO n_staff FROM staff_assignments sa JOIN sections s ON s.id = sa.section_id
   WHERE sa.section_id IS NOT NULL AND s.course_offering_id <> sa.course_offering_id;
  SELECT count(*) INTO n_due FROM assignment_due_dates d
    JOIN sections s ON s.id = d.section_id JOIN assignment_offerings ao ON ao.id = d.assignment_offering_id
   WHERE s.course_offering_id <> ao.course_offering_id;
  SELECT count(*) INTO n_grades FROM grades x
    JOIN enrollments e ON e.id = x.enrollment_id JOIN sections s ON s.id = e.section_id
    JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
   WHERE s.course_offering_id <> ao.course_offering_id;
  SELECT count(*) INTO n_subs FROM submissions x
    JOIN enrollments e ON e.id = x.enrollment_id JOIN sections s ON s.id = e.section_id
    JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
   WHERE s.course_offering_id <> ao.course_offering_id;
  SELECT count(*) INTO n_ext FROM extensions x
    JOIN enrollments e ON e.id = x.enrollment_id JOIN sections s ON s.id = e.section_id
    JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
   WHERE s.course_offering_id <> ao.course_offering_id;
  SELECT count(*) INTO n_att FROM question_attempts x
    JOIN enrollments e ON e.id = x.enrollment_id JOIN sections s ON s.id = e.section_id
    JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
   WHERE s.course_offering_id <> ao.course_offering_id;
  SELECT count(*) INTO n_item FROM assignment_offerings ao
    JOIN assignments a ON a.id = ao.assignment_id JOIN course_offerings co ON co.id = ao.course_offering_id
   WHERE a.course_id IS NOT NULL AND a.course_id <> co.course_id;
  SELECT count(*) INTO n_path FROM offering_activities oa
    JOIN activities act ON act.id = oa.activity_id JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
   WHERE act.assignment_id <> ao.assignment_id;
  IF n_staff + n_due + n_grades + n_subs + n_ext + n_att + n_item + n_path > 0 THEN
    RAISE WARNING '044: rows that already disagree (left as they are): staff_assignments %, assignment_due_dates %, grades %, submissions %, extensions %, question_attempts %, assignment_offerings %, offering_activities %',
      n_staff, n_due, n_grades, n_subs, n_ext, n_att, n_item, n_path;
  ELSE
    RAISE NOTICE '044: no existing row disagrees';
  END IF;
END $$;

COMMIT;

-- Verify (read-only): expect 11 rows named *_same_offering or *_same_course or *_same_assignment.
--
--   SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'app' AND (t.tgname LIKE '%same_offering' OR t.tgname LIKE '%same_course'
--            OR t.tgname LIKE '%same_assignment') ORDER BY 1, 2;
--
-- The behaviour is proved by scripts/staging/test_same_offering_scratch.py on a throwaway database.
