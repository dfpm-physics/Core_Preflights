-- PREP v2 -- scores above the maximum, for bonus work, and the finalization rule for new items
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 014_effort_grades_per_row.sql (the grades_effort
-- trigger that fires first) and 028_offering_policy.sql (is_bonus, allow_over_max, entered_on_new_page).
-- It does NOT depend on 023_instructors_admin_flag_guard.sql. Design: docs/decisions/V2-DATA-MODEL.md
-- section 6.
--
-- WHAT IT DOES
--   grades.over_max_allowed       boolean NOT NULL DEFAULT false. Only a trigger sets it true.
--   grades_within_bounds          SAME NAME, widened: points_earned IS NULL OR (points_earned >= 0 AND
--                                 (points_earned <= points_possible OR over_max_allowed)).
--   grades_over_max_guard         BEFORE INSERT OR UPDATE, firing only WHEN (NEW.points_earned >
--                                 NEW.points_possible OR NEW.over_max_allowed). Pinned SECURITY DEFINER so it
--                                 can read the offering whoever writes. Sets the flag from is_bonus OR
--                                 allow_over_max (a missing offering counts as false) and IGNORES what the
--                                 client sent.
--   grades_source_check           gains `auto_checked`.
--   grades_new_items_stay_unfinalized  BEFORE INSERT OR UPDATE, firing only WHEN (NEW.is_finalized). Refuses
--                                 when the offering has entered_on_new_page, so a new item carries no released
--                                 grade before step 2. This is the whole protection at step 1: a finalized
--                                 grade on an unpublished item is otherwise readable by its student over REST.
--                                 Removed at step 2.
--   assignment_offerings_over_max_off_guard  turning is_bonus or allow_over_max OFF is refused while a grade
--                                 on that offering sits above its maximum.
--
-- WHY IT STAYS SAFE FOR OLD WRITERS
--   * An old writer never sends the column, so it gets false and the check behaves exactly as today.
--   * An over-maximum score on an ordinary item raises the same error under the same name.
--   * faculty-grade.js clamps to the maximum, so old pages never reach the new branch.
--   * The guard costs nothing on a normal write, because its WHEN clause is false.
--   * Adding a column with a constant default touches no row, so grades.updated_at (the staleness clock for
--     review signoffs) does not move.
--
-- LOCKS
--   Swapping the check scans `grades` under a lock. That is brief at this size, and lock_timeout makes a
--   blocked apply fail cleanly so it can be retried instead of queueing cadets behind it.
--
-- TRIGGER ORDER
--   BEFORE row triggers fire in name order: grades_effort (which sets points_earned for effort mode) runs
--   before grades_over_max_guard, so the guard sees the final points.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE grades ADD COLUMN over_max_allowed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN grades.over_max_allowed IS
  'True only when a trigger found the offering is_bonus or allow_over_max. A client cannot set it: '
  'grades_over_max_guard overwrites whatever was sent.';

ALTER TABLE grades DROP CONSTRAINT grades_within_bounds;
ALTER TABLE grades ADD CONSTRAINT grades_within_bounds CHECK (
  points_earned IS NULL
  OR (points_earned >= 0 AND (points_earned <= points_possible OR over_max_allowed)));

ALTER TABLE grades DROP CONSTRAINT grades_source_check;
ALTER TABLE grades ADD CONSTRAINT grades_source_check
  CHECK (source IN ('instructor', 'ai_suggested', 'derived', 'imported', 'auto_checked'));

-- ---- the over-max guard -----------------------------------------------------------------
CREATE FUNCTION grades_over_max_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  NEW.over_max_allowed := coalesce(
    (SELECT ao.is_bonus OR ao.allow_over_max
       FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id),
    false);
  RETURN NEW;
END; $$;

CREATE TRIGGER grades_over_max_guard
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW WHEN (NEW.points_earned > NEW.points_possible OR NEW.over_max_allowed)
  EXECUTE FUNCTION grades_over_max_guard();

-- ---- a new item carries no finalized grade until step 2 -----------------------------------
CREATE FUNCTION grades_new_items_stay_unfinalized() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
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

-- ---- turning the allowance off while a grade sits above the maximum -----------------------
CREATE FUNCTION assignment_offerings_over_max_off_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM grades g
              WHERE g.assignment_offering_id = NEW.id
                AND g.points_earned > g.points_possible) THEN
    RAISE EXCEPTION
      'assignment offering %: is_bonus and allow_over_max cannot both be off while a grade is above its maximum',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_over_max_off_guard
  BEFORE UPDATE OF is_bonus, allow_over_max ON assignment_offerings
  FOR EACH ROW
  WHEN ((OLD.is_bonus OR OLD.allow_over_max) AND NOT (NEW.is_bonus OR NEW.allow_over_max))
  EXECUTE FUNCTION assignment_offerings_over_max_off_guard();

REVOKE ALL ON FUNCTION grades_over_max_guard()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_new_items_stay_unfinalized()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION assignment_offerings_over_max_off_guard()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- every existing grade keeps the flag false (must be 0)
--   SELECT count(*) FROM app.grades WHERE over_max_allowed;
--
--   -- the constraint keeps its name and its widened body
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'app.grades'::regclass AND conname IN ('grades_within_bounds', 'grades_source_check');
