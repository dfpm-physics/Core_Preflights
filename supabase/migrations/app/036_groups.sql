-- PREP v2 -- student groups: modelled now, built later
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 028_offering_policy.sql (nothing it adds, but it follows the
-- policy columns) and 029_grades_over_max.sql (the grades trigger order). It does NOT depend on
-- 023_instructors_admin_flag_guard.sql. Design: docs/decisions/V2-DATA-MODEL.md section 18.
--
-- WHAT IT ADDS  (empty at step 1, except on the staging seed)
--   student_groups                  id, course_offering_id, name
--   student_group_members           group_id, enrollment_id, joined_at, left_at
--   student_group_snapshots         who was in the group when that work was handed in
--   student_group_grades            the group's score per item
--   grades.student_group_id         nullable, SET NULL (a grade outlives its group)
--   grades.student_group_adjusted   boolean NOT NULL DEFAULT false
--   assignment_offerings.is_group_work   boolean NOT NULL DEFAULT false
--
-- EACH MEMBER STILL GETS A NORMAL grades ROW, written from the group's score. The total rule therefore needs no group
-- logic, and joining or leaving later does not rewrite past work.
--
-- ONE MEMBER'S ADJUSTMENT SURVIVES
--   NOT GRANTED AT STEP 1: apply_group_score has no EXECUTE grant for any role until step 2.
--   apply_group_score()   the one way to spread a score. A pinned SECURITY DEFINER function that sets a
--                         transaction-local marker, skips rows whose student_group_adjusted is true, and lists them for
--                         the instructor. A Director can name an enrollment to overwrite, which clears its flag.
--   grades_group_adjusted a pinned BEFORE UPDATE trigger. On a change to the score of a row with student_group_id it sets
--                         student_group_adjusted, unless the marker is on. A client cannot send its way around that by
--                         naming the column: the trigger sets it either way.
--
-- RLS    Staff of the offering read; Directors write. No student policy.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE TABLE student_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  name               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_groups_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT student_groups_name_key UNIQUE (course_offering_id, name)
);

CREATE TABLE student_group_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id)    ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  CONSTRAINT student_group_members_order CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE UNIQUE INDEX student_group_members_one_open
  ON student_group_members (group_id, enrollment_id) WHERE left_at IS NULL;
CREATE INDEX student_group_members_enrollment_idx ON student_group_members (enrollment_id);

CREATE TABLE student_group_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id               uuid NOT NULL REFERENCES student_groups(id)       ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  captured_by            uuid,
  reason                 text
);

CREATE INDEX student_group_snapshots_item_idx ON student_group_snapshots (assignment_offering_id, group_id);

CREATE TABLE student_group_grades (
  group_id               uuid NOT NULL REFERENCES student_groups(id)       ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  points                 numeric(6,2) NOT NULL,
  entered_by             uuid,
  entered_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, assignment_offering_id),
  CONSTRAINT student_group_grades_points_ck CHECK (points >= 0)
);

COMMENT ON TABLE student_groups IS 'A named group of enrollments within one course offering, for group work.';
COMMENT ON TABLE student_group_snapshots IS 'Who was in the group when that work was handed in. Plain who-column, no foreign key.';
COMMENT ON TABLE student_group_grades IS 'The group''s score for an item. Each member still gets a normal grades row written from it.';

ALTER TABLE assignment_offerings ADD COLUMN is_group_work boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN assignment_offerings.is_group_work IS 'Group work: scores are spread to members through app.apply_group_score.';

ALTER TABLE grades
  ADD COLUMN student_group_id       uuid REFERENCES student_groups(id) ON DELETE SET NULL,
  ADD COLUMN student_group_adjusted boolean NOT NULL DEFAULT false;
CREATE INDEX grades_student_group_idx ON grades (student_group_id) WHERE student_group_id IS NOT NULL;

COMMENT ON COLUMN grades.student_group_id IS 'The group this grade was written from, if any. The grade outlives the group.';
COMMENT ON COLUMN grades.student_group_adjusted IS
  'True once one member''s score was changed by hand. apply_group_score skips such rows unless a Director names them.';

-- a member's enrollment must be in the group's course offering
CREATE FUNCTION student_group_members_check() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_g uuid;
  v_e uuid;
BEGIN
  SELECT g.course_offering_id INTO v_g FROM student_groups g WHERE g.id = NEW.group_id;
  SELECT s.course_offering_id INTO v_e FROM enrollments e JOIN sections s ON s.id = e.section_id WHERE e.id = NEW.enrollment_id;
  IF v_g IS DISTINCT FROM v_e THEN
    RAISE EXCEPTION 'a group member must be enrolled in the group''s course offering' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER student_group_members_check
  BEFORE INSERT OR UPDATE OF group_id, enrollment_id ON student_group_members
  FOR EACH ROW EXECUTE FUNCTION student_group_members_check();

-- Two jobs, one function. It is NOT security definer, so current_user is the caller.
--   1. A role that meets row level security (authenticated, anon) or the service key cannot write
--      student_group_id or student_group_adjusted directly. apply_group_score runs as the owner and can.
--   2. A change to the score of a row with student_group_id sets the adjusted flag, unless
--      apply_group_score is writing.
CREATE FUNCTION grades_group_adjusted() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('authenticated', 'anon', 'service_role', 'prep_app_dml') THEN
      RAISE EXCEPTION 'student_group_id and student_group_adjusted are written by apply_group_score only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon', 'service_role', 'prep_app_dml')
     AND (NEW.student_group_id IS DISTINCT FROM OLD.student_group_id
          OR NEW.student_group_adjusted IS DISTINCT FROM OLD.student_group_adjusted) THEN
    RAISE EXCEPTION 'student_group_id and student_group_adjusted are written by apply_group_score only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.student_group_id IS NOT NULL
     AND NEW.points_earned IS DISTINCT FROM OLD.points_earned
     AND coalesce(current_setting('app.group_score_marker', true), '') <> 'on' THEN
    NEW.student_group_adjusted := true;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER grades_group_adjusted
  BEFORE UPDATE ON grades
  FOR EACH ROW
  WHEN (NEW.student_group_id IS DISTINCT FROM OLD.student_group_id
        OR NEW.student_group_adjusted IS DISTINCT FROM OLD.student_group_adjusted
        OR (NEW.student_group_id IS NOT NULL AND NEW.points_earned IS DISTINCT FROM OLD.points_earned))
  EXECUTE FUNCTION grades_group_adjusted();

CREATE TRIGGER grades_group_adjusted_ins
  BEFORE INSERT ON grades
  FOR EACH ROW
  WHEN (NEW.student_group_id IS NOT NULL OR NEW.student_group_adjusted)
  EXECUTE FUNCTION grades_group_adjusted();

-- the one way to spread a group's score
CREATE FUNCTION apply_group_score(
  p_group uuid, p_assignment_offering uuid, p_points numeric, p_overwrite uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS TABLE (enrollment_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_co        uuid;
  v_ao_co     uuid;
  v_possible  numeric;
  v_group_work boolean;
  v_release   timestamptz;
  m           record;
  v_adjusted  boolean;
  v_final     boolean;
BEGIN
  SELECT g.course_offering_id INTO v_co FROM student_groups g WHERE g.id = p_group;
  SELECT ao.course_offering_id, ao.points_possible, ao.is_group_work, ao.grades_release_at
    INTO v_ao_co, v_possible, v_group_work, v_release
    FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_co IS NULL OR v_co IS DISTINCT FROM v_ao_co OR v_co NOT IN (SELECT director_offerings()) THEN
    RAISE EXCEPTION 'apply_group_score: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT coalesce(v_group_work, false) THEN
    RAISE EXCEPTION 'apply_group_score: this item is not marked as group work' USING ERRCODE = 'check_violation';
  END IF;
  IF p_points IS NULL OR p_points < 0 THEN
    RAISE EXCEPTION 'apply_group_score: points must be 0 or more' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO student_group_grades (group_id, assignment_offering_id, points, entered_by)
  VALUES (p_group, p_assignment_offering, p_points, current_uid())
  ON CONFLICT (group_id, assignment_offering_id)
  DO UPDATE SET points = EXCLUDED.points, entered_by = EXCLUDED.entered_by, entered_at = now();

  -- who was in the group when this score was spread (section 18)
  INSERT INTO student_group_snapshots (group_id, assignment_offering_id, enrollment_id, captured_by, reason)
  SELECT p_group, p_assignment_offering, sm.enrollment_id, current_uid(), 'score spread'
    FROM student_group_members sm WHERE sm.group_id = p_group AND sm.left_at IS NULL;

  PERFORM set_config('app.group_score_marker', 'on', true);
  FOR m IN SELECT sm.enrollment_id AS enr
             FROM student_group_members sm
            WHERE sm.group_id = p_group AND sm.left_at IS NULL
            ORDER BY sm.joined_at, sm.id LOOP
    SELECT g.student_group_adjusted, g.is_finalized INTO v_adjusted, v_final
      FROM grades g WHERE g.enrollment_id = m.enr AND g.assignment_offering_id = p_assignment_offering;
    -- a released grade is never rewritten here, unless a Director names the enrollment
    IF coalesce(v_final, false) AND (v_release IS NULL OR v_release <= now())
       AND NOT (m.enr = ANY (coalesce(p_overwrite, ARRAY[]::uuid[]))) THEN
      enrollment_id := m.enr; outcome := 'skipped_released'; RETURN NEXT;
      CONTINUE;
    END IF;
    IF coalesce(v_adjusted, false) AND NOT (m.enr = ANY (coalesce(p_overwrite, ARRAY[]::uuid[]))) THEN
      enrollment_id := m.enr; outcome := 'skipped_adjusted'; RETURN NEXT;
      CONTINUE;
    END IF;
    INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible,
                        source, graded_by, graded_at, student_group_id, student_group_adjusted)
    VALUES (m.enr, p_assignment_offering, p_points, v_possible,
            'instructor', current_uid(), now(), p_group, false)
    ON CONFLICT ON CONSTRAINT grades_unique
    DO UPDATE SET points_earned = EXCLUDED.points_earned, source = 'instructor',
                  graded_by = EXCLUDED.graded_by, graded_at = EXCLUDED.graded_at,
                  student_group_id = EXCLUDED.student_group_id, student_group_adjusted = false;
    enrollment_id := m.enr;
    outcome := CASE WHEN coalesce(v_adjusted, false) OR coalesce(v_final, false) THEN 'overwritten' ELSE 'written' END;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.group_score_marker', 'off', true);
  RETURN;
END; $$;

COMMENT ON FUNCTION apply_group_score(uuid, uuid, numeric, uuid[]) IS
  'Spreads a group''s score to its open members as normal grades rows. Needs is_group_work. Skips members whose '
  'score was adjusted by hand (skipped_adjusted) and members holding a released grade (skipped_released), and lists '
  'them; a Director can name enrollments to overwrite. Writes a snapshot of the members. Directors only. Not granted '
  'to any role at step 1.';

-- ---- RLS ----------------------------------------------------------------------------------------
ALTER TABLE student_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_grades    ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_groups_read_staff ON student_groups FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY student_groups_write_director ON student_groups FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));

CREATE POLICY sgm_read_staff ON student_group_members FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT staff_offerings())));
CREATE POLICY sgm_write_director ON student_group_members FOR ALL TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())));

CREATE POLICY sgs_read_staff ON student_group_snapshots FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT staff_offerings())));
CREATE POLICY sgs_write_director ON student_group_snapshots FOR ALL TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())));

CREATE POLICY sgg_read_staff ON student_group_grades FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT staff_offerings())));
CREATE POLICY sgg_write_director ON student_group_grades FOR ALL TO authenticated
  USING (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (group_id IN (SELECT g.id FROM student_groups g WHERE g.course_offering_id IN (SELECT director_offerings())));

-- ---- grants: by name ------------------------------------------------------------------------------
REVOKE ALL ON student_groups, student_group_members, student_group_snapshots, student_group_grades FROM anon;

REVOKE ALL ON FUNCTION student_group_members_check()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION grades_group_adjusted()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION apply_group_score(uuid, uuid, numeric, uuid[])
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT count(*) FROM app.student_groups;                       -- 0 outside the staging seed
--   SELECT count(*) FROM app.grades WHERE student_group_adjusted;  -- 0
