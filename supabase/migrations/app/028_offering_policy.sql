-- PREP v2 -- offering policy columns, the step 1 publishing rules, parts, and one active offering per course
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 017_due_by_day.sql (assignment_offerings.due_by_day,
-- through 004's content_snapshot_frozen_at) and 027_path_delivery_grading.sql (the `grading` column read by the
-- grading_mode trigger). It does NOT depend on 023_instructors_admin_flag_guard.sql. Design:
-- docs/decisions/V2-DATA-MODEL.md sections 1, 4, 5 and 22.
--
-- BEFORE YOU RUN IT
--   The precheck at the top of this file refuses, with a clear message, when any course already has two
--   active offerings, because the unique index below could not be built. Settle that first (decision 2).
--
-- WHAT IT ADDS
--   assignment_offerings   late_allowed, is_bonus, allow_over_max, prog_included, grades_release_at,
--                          attempt_limit, attempt_rule, part_set_id, entered_on_new_page.
--                          Every column has a constant default that reproduces today, so adding it
--                          rewrites no row and fires no trigger. Old writers name their columns, so an
--                          upsert leaves the new ones alone. (is_group_work arrives with the group
--                          tables in 036.)
--   part_sets              required parts of one piece of work, joined for display. A composite foreign
--                          key means a part cannot join a set in another course offering.
--   assignments.origin_assignment_id   lineage for rollover. SET NULL, so deleting a source still works.
--   course_offerings       is_active now defaults to FALSE, and a partial unique index allows ONE active
--                          offering per course. The index stays after step 2. Nothing here hides a course
--                          from anyone: is_active steers jobs and the Health page, not people.
--
-- THE STEP 1 RULES (temporary, removed at step 2, except the one-active index)
--   assignment_offerings_new_stay_unpublished  refuses publishing an item entered on a new page.
--   assignment_offerings_publish_needs_active  refuses a CHANGE to is_published = true on an offering whose
--                                              course offering is inactive. Rows already published are not
--                                              touched. It catches old tools, which never set the marker.
--   assignment_offerings_marker_one_way        refuses entered_on_new_page true -> false, for every role, so the
--                                              marker cannot be cleared to slip past the two rules above.
--   assignment_offerings_new_paths_stay_unpublished  and  offering_activities_new_paths_stay_unpublished
--                                              refuse publishing an item that has a path whose delivery only a
--                                              new page produces (online_questions, in_person, elsewhere), and
--                                              refuse adding such a path to a published item. They read the data,
--                                              not the marker, so an item made by script is held too. The old
--                                              pages produce typed_response and interactive_tutor only.
--   (grades_new_items_stay_unfinalized is in 029.)
--   These are database rules, not page guards: a REST caller with staff rights meets them too. A trial or a
--   seed that must publish such an item on staging disables the two new_paths triggers inside its own
--   transaction and enables them again before it ends.
--
-- GRADING MODE FOLLOWS THE PATHS  (offering_activities_sync_grading_mode)
--   displayPoints() reads grading_mode, so an item left on the column default `effort` would show a typed
--   score as 0. For an item with entered_on_new_page only: effort when every graded path is `effort`,
--   points when any is not, no change when none is graded. The column default is unchanged, so old writers
--   behave as they do today. (This trigger sits here and not in 027 because it reads the marker this file
--   creates.)
--
-- THE PROG FLAG  (set_prog_flag)
--   ao_write is director-gated, and the instructor sets this flag, so a pinned SECURITY DEFINER function
--   checks that the caller teaches or directs the offering, changes that one column, and writes a server
--   log line. Granted to `authenticated`; it checks its caller.
--
-- THE CURRENT SITE
--   OFFERING_SELECT names its columns, so no page selects any new column. Defaults reproduce today. The
--   fingerprint in docs/decisions/V2-DATA-MODEL.md section 20 covers every legacy column.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- precheck: one active offering per course ---------------------------------------------
DO $$
DECLARE
  dup text;
BEGIN
  SELECT string_agg(c.code || ' (' || x.n || ' active)', ', ')
    INTO dup
    FROM (SELECT co.course_id, count(*) AS n
            FROM course_offerings co WHERE co.is_active
           GROUP BY co.course_id HAVING count(*) > 1) x
    JOIN courses c ON c.id = x.course_id;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'cannot enforce one active offering per course: % have more than one. The course director settles which stays active first (decision 2); nothing was changed.', dup;
  END IF;
END $$;

-- ---- part_sets ----------------------------------------------------------------------------
CREATE TABLE part_sets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  title              text NOT NULL,
  position           integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_sets_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT part_sets_id_offering_key UNIQUE (id, course_offering_id)
);

COMMENT ON TABLE part_sets IS
  'Required parts of one piece of work (a lab: prelab online, report elsewhere). Each part is its own '
  'assignment_offerings row with its own column, points, deadline and grade; this row only joins them for '
  'display. Alternatives (do one of these) are NOT parts: those stay as several graded paths on one offering.';

ALTER TABLE part_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY part_sets_read_staff ON part_sets FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY part_sets_write_director ON part_sets FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));
REVOKE ALL ON part_sets FROM anon;

-- ---- assignment_offerings: policy columns -------------------------------------------------
ALTER TABLE assignment_offerings
  ADD COLUMN late_allowed         boolean     NOT NULL DEFAULT false,
  ADD COLUMN is_bonus             boolean     NOT NULL DEFAULT false,
  ADD COLUMN allow_over_max       boolean     NOT NULL DEFAULT false,
  ADD COLUMN prog_included        boolean     NOT NULL DEFAULT false,
  ADD COLUMN grades_release_at    timestamptz,
  ADD COLUMN attempt_limit        smallint,
  ADD COLUMN attempt_rule         text        NOT NULL DEFAULT 'best',
  ADD COLUMN part_set_id          uuid,
  ADD COLUMN entered_on_new_page  boolean     NOT NULL DEFAULT false;

ALTER TABLE assignment_offerings
  ADD CONSTRAINT assignment_offerings_attempt_limit_ck CHECK (attempt_limit IS NULL OR attempt_limit >= 1),
  ADD CONSTRAINT assignment_offerings_attempt_rule_ck  CHECK (attempt_rule IN ('best', 'last', 'first')),
  ADD CONSTRAINT assignment_offerings_part_set_fk
    FOREIGN KEY (part_set_id, course_offering_id)
    REFERENCES part_sets (id, course_offering_id) ON DELETE SET NULL (part_set_id);

CREATE INDEX assignment_offerings_part_set_idx ON assignment_offerings (part_set_id) WHERE part_set_id IS NOT NULL;

COMMENT ON COLUMN assignment_offerings.late_allowed IS
  'Whether late work is accepted. The DEFAULT stays false so current preflights keep refusing late work; the '
  'new entry page starts it checked, as GRADE-RULES.md says.';
COMMENT ON COLUMN assignment_offerings.is_bonus IS 'Adds to earned only; contributes 0 to possible.';
COMMENT ON COLUMN assignment_offerings.allow_over_max IS
  'An ordinary item (an exam with an extra-credit question) may score above its maximum.';
COMMENT ON COLUMN assignment_offerings.prog_included IS 'Counts at Prog. An instructor sets it, through set_prog_flag().';
COMMENT ON COLUMN assignment_offerings.grades_release_at IS 'NULL means a grade shows when it is finalized.';
COMMENT ON COLUMN assignment_offerings.attempt_limit IS 'Per question, auto-checked paths only. NULL means no limit.';
COMMENT ON COLUMN assignment_offerings.attempt_rule IS 'Which attempt counts, per question: best, last or first.';
COMMENT ON COLUMN assignment_offerings.part_set_id IS 'Joins required parts for display. See part_sets.';
COMMENT ON COLUMN assignment_offerings.entered_on_new_page IS
  'Says which page owns a row: true means entered on a v2 page. TEMPORARY, removed at step 2 with the three '
  'step 1 rules. It says who owns the row, never what kind of work it is.';

-- ---- assignments: lineage -----------------------------------------------------------------
ALTER TABLE assignments
  ADD COLUMN origin_assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL;

COMMENT ON COLUMN assignments.origin_assignment_id IS
  'Lineage for rollover. Rollover still makes new assignment and activity rows with new slugs; this only '
  'records where a copy came from. SET NULL, so deleting a source lesson still works.';

-- ---- course_offerings: inactive by default, one active per course -------------------------
ALTER TABLE course_offerings ALTER COLUMN is_active SET DEFAULT false;

CREATE UNIQUE INDEX course_offerings_one_active ON course_offerings (course_id) WHERE is_active;

COMMENT ON COLUMN course_offerings.is_active IS
  'Steers tools, not people: it decides what jobs and the Health page look at. It hides a course from nobody. '
  'DEFAULT false; at most one active offering per course (course_offerings_one_active).';

-- ---- rule: an item entered on a new page cannot be published at step 1 --------------------
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

-- ---- rule: the marker is one-way until step 2 -----------------------------------------------
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

-- ---- rule: a path only a new page produces keeps its item unpublished ------------------------
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

-- ---- rule: publishing needs an active course offering --------------------------------------
-- Fires on INSERT, and on UPDATE of is_published. It acts only on a CHANGE to true: an old-editor upsert
-- re-sends is_published = true for an item that is already published, and an INSERT ... ON CONFLICT DO
-- UPDATE fires this trigger on the proposed row before the conflict is resolved, so both are recognised
-- and let through.
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

-- ---- grading_mode follows the graded paths of an item entered on a new page ---------------
CREATE FUNCTION offering_activities_sync_grading_mode() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_ao      uuid;
  v_flagged boolean;
  v_graded  integer;
  v_other   integer;
  v_mode    text;
BEGIN
  v_ao := CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_offering_id ELSE NEW.assignment_offering_id END;

  SELECT ao.entered_on_new_page INTO v_flagged FROM assignment_offerings ao WHERE ao.id = v_ao;
  IF NOT FOUND OR NOT v_flagged THEN
    RETURN NULL;                         -- an old-page item, or the item is being deleted
  END IF;

  SELECT count(*), count(*) FILTER (WHERE oa.grading IS DISTINCT FROM 'effort')
    INTO v_graded, v_other
    FROM offering_activities oa
   WHERE oa.assignment_offering_id = v_ao AND oa.grading_role = 'graded';
  IF v_graded = 0 THEN
    RETURN NULL;                         -- no graded path: leave the mode alone
  END IF;

  v_mode := CASE WHEN v_other > 0 THEN 'points' ELSE 'effort' END;
  UPDATE assignment_offerings SET grading_mode = v_mode
   WHERE id = v_ao AND grading_mode IS DISTINCT FROM v_mode;
  RETURN NULL;
END; $$;

CREATE TRIGGER offering_activities_sync_grading_mode
  AFTER INSERT OR DELETE OR UPDATE OF grading_role, grading ON offering_activities
  FOR EACH ROW EXECUTE FUNCTION offering_activities_sync_grading_mode();

-- ---- set_prog_flag ------------------------------------------------------------------------
CREATE FUNCTION set_prog_flag(p_assignment_offering uuid, p_value boolean) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_co      uuid;
  v_changed integer;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'set_prog_flag: a value is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT ao.course_offering_id INTO v_co FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_co IS NULL
     OR NOT (is_admin()
             OR EXISTS (SELECT 1 FROM staff_assignments sa
                         WHERE sa.instructor_id = current_uid()
                           AND sa.course_offering_id = v_co
                           AND sa.role IN ('director', 'instructor'))) THEN
    RAISE EXCEPTION 'set_prog_flag: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE assignment_offerings SET prog_included = p_value
   WHERE id = p_assignment_offering AND prog_included IS DISTINCT FROM p_value;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  RAISE LOG 'set_prog_flag: instructor % set prog_included=% on assignment_offering % (changed=%)',
    current_uid(), p_value, p_assignment_offering, v_changed > 0;
  RETURN v_changed > 0;
END; $$;

COMMENT ON FUNCTION set_prog_flag(uuid, boolean) IS
  'Sets assignment_offerings.prog_included for an offering the caller teaches or directs. The only write path '
  'for that flag for an instructor; ao_write is director-only. Returns true when the value changed.';

-- ---- grants: by name -----------------------------------------------------------------------
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
REVOKE ALL ON FUNCTION offering_activities_sync_grading_mode()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION set_prog_flag(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION set_prog_flag(uuid, boolean) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- every existing offering still reproduces today: all false / 'best' / NULL
--   SELECT count(*) FILTER (WHERE late_allowed OR is_bonus OR allow_over_max OR prog_included
--                           OR entered_on_new_page) AS should_be_0 FROM app.assignment_offerings;
--
--   -- at most one active offering per course (must be 0 rows)
--   SELECT course_id, count(*) FROM app.course_offerings WHERE is_active GROUP BY 1 HAVING count(*) > 1;
--
--   -- no browser role can call the internal functions (must be 0 rows)
--   SELECT r FROM unnest(ARRAY['anon']) r WHERE has_function_privilege(r, 'app.set_prog_flag(uuid,boolean)', 'EXECUTE');
