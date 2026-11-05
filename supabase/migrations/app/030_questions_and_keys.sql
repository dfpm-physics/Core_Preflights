-- PREP v2 -- stable question ids, and answer keys in a separate staff-only table
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 027_path_delivery_grading.sql (offering_activities.grading)
-- and 028_offering_policy.sql (assignment_offerings policy columns, the publishing rules). It does NOT depend on
-- 023_instructors_admin_flag_guard.sql. Design: docs/decisions/V2-DATA-MODEL.md section 12.
--
-- WHAT IT ADDS
--   questions       one row per question, with a stable `qid` (the key in grades.question_scores, never
--                   reused: a retired question stays so old attempts still resolve).
--   question_keys   the answer keys, SEPARATE and staff-only, versioned. New keys NEVER go in
--                   activities.content. A corrected key is a new version; the old one gets superseded_at.
--
-- WHO CAN SEE KEYS
--   Staff of the offering read; directors write. All grants are revoked from anon. There is NO student
--   policy, ever: only the marking function (Stage E) reads keys on a student's behalf.
--
-- PROSE IS NEVER MARKED RIGHT OR WRONG BY MACHINE
--   * a prose question may carry no machine field on its key (only reference_text);
--   * a prose question may not sit on an auto_checked path, in either order.
--
-- WHO OWNS THE POINTS
--   auto_checked path    THE QUESTIONS. A trigger on questions sets assignment_offerings.points_possible to
--                        the sum of unretired questions.points on every insert, edit, retire and delete (a new
--                        auto_checked path also syncs). Publishing checks the two agree and refuses otherwise;
--                        once published, a direct write that disagrees is refused. While unpublished a direct
--                        write passes, so creating an item cannot deadlock.
--   human_graded online  THE OFFERING. The publish check only warns when the sum differs.
--   An offering with an auto_checked path has only that path (027 enforces it; the publish check repeats it).
--
-- PUBLISHING IS REFUSED while an AI-written key (written_by = 'ai') has no checked_by, on any path of the
-- offering.
--
-- NOT HERE
--   Re-scoring grades after a points edit (only grades with source = 'auto_checked', through the marking
--   function) and re-marking after a key correction are Stage E.
--
-- THE CURRENT SITE
--   New tables, unread. Preflights keep content.questions with their existing q1, q2, q3 ids; nothing here
--   reads or moves them. The extra publish trigger finds no auto_checked path on any existing offering and
--   returns.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- questions ------------------------------------------------------------------------------
CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  qid         text NOT NULL,
  position    smallint NOT NULL DEFAULT 0,
  prompt_md   text NOT NULL DEFAULT '',
  figure_url  text,
  unit_hint   text,
  is_retired  boolean NOT NULL DEFAULT false,
  format      text NOT NULL,
  choices     jsonb,
  points      numeric(6,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_activity_qid_key UNIQUE (activity_id, qid),
  CONSTRAINT questions_qid_shape CHECK (qid ~ '^[A-Za-z0-9_.-]{1,64}$'),
  CONSTRAINT questions_format_ck CHECK (format IN ('multiple_choice', 'multiple_select', 'numeric', 'prose')),
  CONSTRAINT questions_points_ck CHECK (points >= 0),
  CONSTRAINT questions_choices_ck CHECK (
    choices IS NULL
    OR (jsonb_typeof(choices) = 'array' AND format IN ('multiple_choice', 'multiple_select')))
);

COMMENT ON TABLE questions IS
  'One row per question of an activity. qid is the stable id (the key in grades.question_scores) and is never '
  'reused. A retired question stays, so old attempts still resolve. Answer keys are NOT here; see question_keys.';
COMMENT ON COLUMN questions.choices IS
  '[{"id","text"}] for multiple choice and select. Which choice is correct is not stored here.';

CREATE TRIGGER questions_touch BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- question_keys --------------------------------------------------------------------------
CREATE TABLE question_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id        uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  variant_key        text NOT NULL DEFAULT '',
  version            integer NOT NULL DEFAULT 1,
  correct_choice_ids text[],
  select_rule        text NOT NULL DEFAULT 'all_or_nothing',
  value              numeric,
  tol_abs            numeric,
  tol_pct            numeric,
  sig_figs           smallint,
  sig_fig_mode       text NOT NULL DEFAULT 'ignore',
  unit               text,
  unit_aliases       text[],
  unit_mode          text NOT NULL DEFAULT 'ignore',
  reference_text     text,
  written_by         text NOT NULL DEFAULT 'human',
  checked_by         uuid REFERENCES instructors(id) ON DELETE SET NULL,
  checked_at         timestamptz,
  created_by         uuid REFERENCES instructors(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz,
  CONSTRAINT question_keys_version_key UNIQUE (question_id, variant_key, version),
  CONSTRAINT question_keys_version_ck CHECK (version >= 1),
  CONSTRAINT question_keys_select_rule_ck CHECK (select_rule IN ('all_or_nothing')),
  CONSTRAINT question_keys_sig_fig_mode_ck CHECK (sig_fig_mode IN ('ignore', 'warn', 'require')),
  CONSTRAINT question_keys_unit_mode_ck CHECK (unit_mode IN ('ignore', 'warn', 'require')),
  CONSTRAINT question_keys_written_by_ck CHECK (written_by IN ('human', 'ai')),
  CONSTRAINT question_keys_tol_ck CHECK ((tol_abs IS NULL OR tol_abs >= 0) AND (tol_pct IS NULL OR tol_pct >= 0)),
  CONSTRAINT question_keys_sig_figs_ck CHECK (sig_figs IS NULL OR sig_figs >= 1),
  CONSTRAINT question_keys_zero_needs_abs CHECK (value IS NULL OR value <> 0 OR tol_abs IS NOT NULL)
);

CREATE UNIQUE INDEX question_keys_current_idx ON question_keys (question_id, variant_key) WHERE superseded_at IS NULL;

COMMENT ON TABLE question_keys IS
  'Answer keys. Staff-only and versioned; a corrected key is a new version and the old one gets superseded_at. '
  'variant_key is empty today, so per-student values can be added later with no change here. A correct value '
  'of 0 must carry tol_abs, because a percentage tolerance is useless there. NO student policy, ever.';
COMMENT ON COLUMN question_keys.written_by IS
  'human or ai. Publishing is refused while an ai-written key has no checked_by.';

-- ---- RLS --------------------------------------------------------------------------------------
ALTER TABLE questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY questions_read_staff ON questions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM offering_activities oa
              JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
             WHERE oa.activity_id = questions.activity_id
               AND ao.course_offering_id IN (SELECT staff_offerings()))
    OR EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                WHERE a.id = questions.activity_id
                  AND s.course_id IN (SELECT director_courses())));

CREATE POLICY questions_write_director ON questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                  WHERE a.id = questions.activity_id
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM activities a JOIN assignments s ON s.id = a.assignment_id
                       WHERE a.id = questions.activity_id
                         AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))));

CREATE POLICY question_keys_read_staff ON question_keys FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM questions q
              JOIN offering_activities oa ON oa.activity_id = q.activity_id
              JOIN assignment_offerings ao ON ao.id = oa.assignment_offering_id
             WHERE q.id = question_keys.question_id
               AND ao.course_offering_id IN (SELECT staff_offerings()))
    OR EXISTS (SELECT 1 FROM questions q
                 JOIN activities a ON a.id = q.activity_id
                 JOIN assignments s ON s.id = a.assignment_id
                WHERE q.id = question_keys.question_id
                  AND s.course_id IN (SELECT director_courses())));

CREATE POLICY question_keys_write_director ON question_keys FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM questions q
                   JOIN activities a ON a.id = q.activity_id
                   JOIN assignments s ON s.id = a.assignment_id
                  WHERE q.id = question_keys.question_id
                    AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM questions q
                        JOIN activities a ON a.id = q.activity_id
                        JOIN assignments s ON s.id = a.assignment_id
                       WHERE q.id = question_keys.question_id
                         AND (s.course_id IN (SELECT director_courses()) OR (s.course_id IS NULL AND is_admin()))));

REVOKE ALL ON questions     FROM anon;
REVOKE ALL ON question_keys FROM anon;

-- ---- prose: no machine marking ---------------------------------------------------------------
CREATE FUNCTION questions_check_prose() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.format = 'prose' THEN
    IF EXISTS (SELECT 1 FROM offering_activities oa
                WHERE oa.activity_id = NEW.activity_id AND oa.grading = 'auto_checked') THEN
      RAISE EXCEPTION 'question %: a prose question cannot sit on an auto_checked path', NEW.qid
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
         SELECT 1 FROM question_keys k
          WHERE k.question_id = NEW.id
            AND (k.correct_choice_ids IS NOT NULL OR k.value IS NOT NULL OR k.tol_abs IS NOT NULL
                 OR k.tol_pct IS NOT NULL OR k.sig_figs IS NOT NULL OR k.unit IS NOT NULL
                 OR k.unit_aliases IS NOT NULL OR k.sig_fig_mode <> 'ignore' OR k.unit_mode <> 'ignore')) THEN
      RAISE EXCEPTION 'question %: a prose question cannot carry machine fields on its key', NEW.qid
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER questions_check_prose
  BEFORE INSERT OR UPDATE OF format, activity_id ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_check_prose();

CREATE FUNCTION question_keys_check_prose() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_format text;
BEGIN
  SELECT q.format INTO v_format FROM questions q WHERE q.id = NEW.question_id;
  IF v_format = 'prose'
     AND (NEW.correct_choice_ids IS NOT NULL OR NEW.value IS NOT NULL OR NEW.tol_abs IS NOT NULL
          OR NEW.tol_pct IS NOT NULL OR NEW.sig_figs IS NOT NULL OR NEW.unit IS NOT NULL
          OR NEW.unit_aliases IS NOT NULL OR NEW.sig_fig_mode <> 'ignore' OR NEW.unit_mode <> 'ignore') THEN
    RAISE EXCEPTION 'a key on a prose question may carry only reference_text, never a machine field'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER question_keys_check_prose
  BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_check_prose();

-- who wrote a key and who checked it come from the database, not from the client
CREATE FUNCTION question_keys_stamp() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
DECLARE
  v_actor uuid := current_uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(v_actor, NEW.created_by);
  ELSIF NEW.written_by IS DISTINCT FROM OLD.written_by OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'written_by and created_by on a key do not change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.checked_by IS DISTINCT FROM OLD.checked_by OR NEW.checked_at IS DISTINCT FROM OLD.checked_at THEN
    IF NEW.checked_by IS NULL AND NEW.checked_at IS NULL THEN
      NULL;                              -- unchecked
    ELSE
      NEW.checked_by := coalesce(v_actor, NEW.checked_by);   -- a script without a sign-in must name the checker
      IF NEW.checked_by IS NULL THEN
        RAISE EXCEPTION 'a key check written without a signed-in caller must name checked_by'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.checked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER question_keys_stamp
  BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION question_keys_stamp();

-- a path may not become auto_checked while its activity holds a prose question
CREATE FUNCTION offering_activities_check_prose() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.grading = 'auto_checked' AND EXISTS (
       SELECT 1 FROM questions q WHERE q.activity_id = NEW.activity_id AND q.format = 'prose') THEN
    RAISE EXCEPTION 'an auto_checked path cannot hold a prose question'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER offering_activities_check_prose
  BEFORE INSERT OR UPDATE OF grading ON offering_activities
  FOR EACH ROW WHEN (NEW.grading = 'auto_checked')
  EXECUTE FUNCTION offering_activities_check_prose();

-- ---- the questions own the points of an auto_checked path -------------------------------------
CREATE FUNCTION sync_auto_checked_points(p_activity uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_sum numeric;
BEGIN
  SELECT coalesce(sum(q.points), 0) INTO v_sum
    FROM questions q WHERE q.activity_id = p_activity AND NOT q.is_retired;
  UPDATE assignment_offerings ao
     SET points_possible = v_sum
   WHERE ao.id IN (SELECT oa.assignment_offering_id FROM offering_activities oa
                    WHERE oa.activity_id = p_activity AND oa.grading = 'auto_checked')
     AND ao.points_possible IS DISTINCT FROM v_sum;
END; $$;

CREATE FUNCTION questions_points_owner() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sync_auto_checked_points(NEW.activity_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM sync_auto_checked_points(OLD.activity_id);
  ELSE
    PERFORM sync_auto_checked_points(OLD.activity_id);
    IF NEW.activity_id IS DISTINCT FROM OLD.activity_id THEN
      PERFORM sync_auto_checked_points(NEW.activity_id);
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER questions_points_owner
  AFTER INSERT OR UPDATE OF points, is_retired, activity_id OR DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_points_owner();

CREATE FUNCTION offering_activities_points_owner() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  PERFORM sync_auto_checked_points(NEW.activity_id);
  RETURN NULL;
END; $$;

CREATE TRIGGER offering_activities_points_owner
  AFTER INSERT OR UPDATE OF grading, activity_id ON offering_activities
  FOR EACH ROW WHEN (NEW.grading = 'auto_checked')
  EXECUTE FUNCTION offering_activities_points_owner();

-- ---- the publish check ------------------------------------------------------------------------
CREATE FUNCTION assignment_offerings_publish_checks() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_auto_activity uuid;
  v_paths         integer;
  v_sum           numeric;
  v_all_sum       numeric;
  v_transition    boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_transition := true;
  ELSE
    v_transition := NOT OLD.is_published;
  END IF;

  SELECT count(*) INTO v_paths FROM offering_activities oa WHERE oa.assignment_offering_id = NEW.id;
  IF v_paths = 0 THEN
    RETURN NEW;                          -- nothing yet; old writers add paths afterwards
  END IF;

  SELECT oa.activity_id INTO v_auto_activity
    FROM offering_activities oa
   WHERE oa.assignment_offering_id = NEW.id AND oa.grading = 'auto_checked'
   LIMIT 1;

  IF v_auto_activity IS NOT NULL THEN
    IF v_paths <> 1 THEN
      RAISE EXCEPTION 'assignment offering %: an auto_checked path must be the only path', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(q.points), 0) INTO v_sum
      FROM questions q WHERE q.activity_id = v_auto_activity AND NOT q.is_retired;
    IF NEW.points_possible IS DISTINCT FROM v_sum THEN
      RAISE EXCEPTION
        'assignment offering %: published points_possible (%) must equal the sum of its questions (%)',
        NEW.id, NEW.points_possible, v_sum USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_transition THEN
    -- a human-graded online path: the offering owns the points; report a mismatch, do not refuse
    SELECT coalesce(sum(q.points), 0) INTO v_all_sum
      FROM questions q
      JOIN offering_activities oa ON oa.activity_id = q.activity_id
     WHERE oa.assignment_offering_id = NEW.id AND NOT q.is_retired;
    IF v_all_sum > 0 AND NEW.points_possible IS DISTINCT FROM v_all_sum THEN
      RAISE WARNING 'assignment offering %: points_possible (%) differs from the sum of its questions (%)',
        NEW.id, NEW.points_possible, v_all_sum;
    END IF;
  END IF;

  IF v_transition AND EXISTS (
       SELECT 1
         FROM offering_activities oa
         JOIN questions q ON q.activity_id = oa.activity_id AND NOT q.is_retired
         JOIN question_keys k ON k.question_id = q.id AND k.superseded_at IS NULL
        WHERE oa.assignment_offering_id = NEW.id
          AND k.written_by = 'ai' AND k.checked_by IS NULL) THEN
    RAISE EXCEPTION 'assignment offering %: cannot publish while an AI-written key has not been checked by a person', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_publish_checks
  BEFORE INSERT OR UPDATE OF is_published, points_possible ON assignment_offerings
  FOR EACH ROW WHEN (NEW.is_published)
  EXECUTE FUNCTION assignment_offerings_publish_checks();

-- ---- grants: by name -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION questions_check_prose()                FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_keys_stamp()                  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION question_keys_check_prose()            FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION offering_activities_check_prose()      FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION sync_auto_checked_points(uuid)         FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION questions_points_owner()               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION offering_activities_points_owner()     FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION assignment_offerings_publish_checks()  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- a student session must read nothing from question_keys (run as a signed-in cadet)
--   SELECT count(*) FROM app.question_keys;     -- expect 0
--
--   -- no browser-facing role may hold a grant on keys it does not need (anon must be empty)
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'app' AND table_name = 'question_keys' AND grantee = 'anon';
