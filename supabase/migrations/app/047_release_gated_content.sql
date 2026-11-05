-- 047_release_gated_content.sql
-- Run as `prep_app_owner`. Staging first. Production only when the course director says so, and only after the
-- snapshot step in the CHANGELOG entry for this migration (it moves stored data).
--
-- WHAT IT ENFORCES
--   1. Answer guidance and keys are not stored in the content a cadet downloads. `expected_response`,
--      `correct_answer`, `answer_key` and `solution` leave `activities.content` and the copy of it inside
--      `assignment_offerings.content_snapshot`. They are filed in the staff-only answer-key table (030) instead.
--   2. A cadet reads an item's content only once it has opened for their section, in the database, by the rule the
--      site already uses. The calendar fields of a future item (title, dates, points) stay readable.
--   3. A cadet no longer reads the stored report or structured assessment of an interactive activity. They read the
--      same rows' presence and state through a view, and the report is saved through one function.
--
-- WHERE THE KEYS GO  (030: questions + question_keys, plan rule 5: new keys never go in `content`)
--   For each question of an activity that carries key text, a `questions` row is made if it is missing
--   (qid = the question's id) and a `question_keys` row holds the text as `reference_text`:
--     expected_response               -> the text itself
--     correct_answer / answer_key /
--     solution                        -> a labelled line appended ("Correct answer: ...")
--   An existing current key is NEVER changed by the move. If it already holds the same text nothing happens. If it
--   holds different text it stays, the content value is kept only in the archive (below), and the count of such
--   questions is reported. The `questions` row copies the prompt text once so the staff pages show something; the
--   cadet-facing text is still `content.questions`, and nothing keeps the two copies in step yet.
--
-- THE ARCHIVE (the undo)
--   `content_key_archive` holds, per changed row, the exact `content` or `content_snapshot` as it was, and the ids
--   of the question and key rows this migration made. It is staff-only (no policy, no grant to the web roles), and is
--   dropped by the rollback after it has restored the content. Keep it until the move has been through one cycle.
--
-- NEW KEYS AFTER THIS MIGRATION
--   A trigger on `activities` files any key fields written into `content` (by the lesson editor or a build script)
--   into the key table and strips them in the same transaction. A blank or missing field changes nothing, so an
--   editor that no longer shows the stored guidance cannot erase it by saving. Text that differs from the current
--   key becomes a new key version (the old one is superseded), carrying over any machine fields. A trigger on
--   `assignment_offerings` strips key fields from a snapshot being written.
--
-- RELEASE TIME IN THE DATABASE
--   my_released_assignment_offerings(): published items of the caller's active or completed enrolments (a past term stays readable; the site's own reads follow only active ones) that are open now, or on
--   which the caller already has a submission or a grade (work in progress is never withdrawn). "Open" calls
--   release_at (038): opens_at when set, else seven days before the SCHEDULED deadline, floored to the start of that
--   day in America/Denver. An item with no date and no opens_at is open, as on the site. An item whose per-day
--   deadline value cannot be read is closed (the site shows it; the content stays hidden until the data is fixed).
--   `my_grades` (046) lists only the grades whose cell the gradebook shows the cadet points for. That is decided in ONE
--   place, `my_visible_grade_cells()`, which reads the gradebook's own cell function (039) and applies the same test
--   gradebook_cells applies for a cadet: state `released`, or `in_progress` on an auto-checked item. A grade that is
--   held, excused, or an AI zero that work has since overtaken is therefore not readable by a direct request either.
--   The rule is not copied: if the gradebook's states change, the cell function changes and this follows.
--   THE SERVER ALSO READS THE GRADE ITSELF. A cadet may not see a held grade, so the server may not rely on what the
--   cadet can see: a report for an effort-graded item is refused (here and in commit_work) while a finalized grade of
--   that item stands, whatever the view shows. Only staff clearing that grade lets a second report in.
--   A submission cannot be started on an item that has not opened for the cadet, so the "work in progress is never
--   withdrawn" rule above cannot be used to open an item by creating a submission row.
--   `activities_student_read` now uses this set. `assignment_offerings`, `offering_activities`, `assignments` and
--   `assignment_due_dates` keep their reads, so the calendar of a future item is visible.
--
-- WHAT CHANGES FOR THE CADET'S WORK ROWS
--   Cadets read and write their own `submission_activities` rows for WRITTEN activities as before. For an
--   interactive activity the row (the structured assessment and the stored report) is no longer readable by the
--   cadet and is no longer written by the cadet's own table access: reading the state goes through `my_work`
--   (no content, no report) and writing goes through save_interactive_work(). Reason: an upsert needs the SELECT
--   policy on the row, so a row that cannot be selected cannot be upserted. Staff reads are unchanged.
--
-- LIMITS, STATED PLAINLY
--   * `content_snapshot` is a column of a row the cadet may read (the calendar). Keys are stripped from it, but its
--     question text is not hidden. A snapshot is taken at term close, when every item has opened; a snapshot taken
--     earlier would hold the questions of an item that has not. The verify query below counts those.
--   * The lesson editor (a frozen page) shows the key boxes blank after the move and saves them blank; stored keys
--     are unaffected. Editing a key from that page types a new version in. The staff question pages are where keys
--     are read and corrected.
--   * The analysis skills read the key from the key table; they need the change in this commit before this
--     migration is applied on the live database (see the CHANGELOG entry).
--   * The assessment inside an interactive row is produced in the cadet's own browser before it is sent, so hiding
--     it afterwards protects the stored copy, not what the browser held at the moment of sending.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   The artifact wire format and the receiver page. Staff reads and writes of every table. `grades.diagnostic`
--   (046). The commit path, deadlines and late marking (a later migration). Any stored grade.
--
-- Rollback: rollback/047_release_gated_content_ROLLBACK.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DO $$
BEGIN
  IF to_regprocedure('app.release_at(uuid, uuid)') IS NULL
     OR to_regprocedure('app._scheduled_core(uuid, uuid)') IS NULL
     OR to_regclass('app.question_keys') IS NULL
     OR to_regclass('app.my_grades') IS NULL THEN
    RAISE EXCEPTION '047 needs 030, 038 and 046 applied first. Nothing was changed.';
  END IF;
END $$;

-- ---- 1. helpers that find and strip key fields -------------------------------------------------------------

CREATE FUNCTION _content_has_keys(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR jsonb_typeof(p -> 'questions') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'questions') q
                  WHERE jsonb_typeof(q) = 'object'
                    AND (q ? 'expected_response' OR q ? 'correct_answer' OR q ? 'answer_key' OR q ? 'solution'));
END $$;

CREATE FUNCTION _strip_question_keys(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT _content_has_keys(p) THEN
    RETURN p;
  END IF;
  RETURN jsonb_set(p, '{questions}',
    (SELECT jsonb_agg(CASE WHEN jsonb_typeof(x) = 'object'
                           THEN x - 'expected_response' - 'correct_answer' - 'answer_key' - 'solution'
                           ELSE x END ORDER BY o)
       FROM jsonb_array_elements(p -> 'questions') WITH ORDINALITY t(x, o)));
END $$;

CREATE FUNCTION _snapshot_has_keys(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR jsonb_typeof(p -> 'activities') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'activities') a
                  WHERE jsonb_typeof(a) = 'object' AND _content_has_keys(a -> 'content'));
END $$;

CREATE FUNCTION _strip_snapshot(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT _snapshot_has_keys(p) THEN
    RETURN p;
  END IF;
  RETURN jsonb_set(p, '{activities}',
    (SELECT jsonb_agg(CASE WHEN jsonb_typeof(a) = 'object' AND a ? 'content'
                           THEN jsonb_set(a, '{content}', _strip_question_keys(a -> 'content'))
                           ELSE a END ORDER BY o)
       FROM jsonb_array_elements(p -> 'activities') WITH ORDINALITY t(a, o)));
END $$;

CREATE FUNCTION _question_key_text(q jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
DECLARE
  v_exp text := q ->> 'expected_response';
  v_cor text := q ->> 'correct_answer';
  v_key text := q ->> 'answer_key';
  v_sol text := q ->> 'solution';
BEGIN
  IF btrim(coalesce(v_exp, '')) = '' AND btrim(coalesce(v_cor, '')) = ''
     AND btrim(coalesce(v_key, '')) = '' AND btrim(coalesce(v_sol, '')) = '' THEN
    RETURN NULL;
  END IF;
  RETURN concat_ws(E'\n\n',
    CASE WHEN btrim(coalesce(v_exp, '')) <> '' THEN v_exp END,
    CASE WHEN btrim(coalesce(v_cor, '')) <> '' THEN 'Correct answer: ' || v_cor END,
    CASE WHEN btrim(coalesce(v_key, '')) <> '' THEN 'Answer key: ' || v_key END,
    CASE WHEN btrim(coalesce(v_sol, '')) <> '' THEN 'Solution: ' || v_sol END);
END $$;

-- ---- 2. the archive: the exact "before" ----------------------------------------------------------------------

CREATE TABLE content_key_archive (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source               text NOT NULL CHECK (source IN ('activities', 'assignment_offerings')),
  row_id               uuid NOT NULL,
  original             jsonb NOT NULL,
  created_question_ids uuid[] NOT NULL DEFAULT '{}',
  created_key_ids      uuid[] NOT NULL DEFAULT '{}',
  moved_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_key_archive_unique UNIQUE (source, row_id)
);
COMMENT ON TABLE content_key_archive IS
  'Per row changed by migration 047: the content (or snapshot) exactly as it was, and the question and key rows the '
  'move made. Staff-only through the database owner and service role; no policy for the web roles. Used by the '
  'rollback; drop it after the move has been through one cycle.';
ALTER TABLE content_key_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON content_key_archive FROM PUBLIC, anon, authenticated;
-- every row-security table carries 045's block, so a table made after 045 does too
CREATE POLICY forced_rotation_block ON content_key_archive AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (SELECT session_must_change_password()));

-- ---- 3. file the key fields of one activity's content ---------------------------------------------------------
-- p_mode 'move': an existing current key is kept as it is (a different value is counted, not applied).
-- p_mode 'edit': different text becomes a new key version that carries over the machine fields.

CREATE FUNCTION _file_question_keys(p_activity uuid, p_content jsonb, p_mode text,
                                    OUT created_questions uuid[], OUT created_keys uuid[],
                                    OUT nonblank integer, OUT covered integer, OUT differing integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  q      jsonb;
  ord    integer;
  v_qid  text;
  v_text text;
  v_qrow uuid;
  v_fmt  text;
  v_pts  numeric;
  v_cur  record;
  v_next integer;
  v_id   uuid;
  v_ca     text;
  v_has_ca boolean;
  v_choice text[];
  v_val    numeric;
  v_tolp   numeric;
  v_tola   numeric;
BEGIN
  created_questions := '{}'; created_keys := '{}'; nonblank := 0; covered := 0; differing := 0;
  IF NOT _content_has_keys(p_content) THEN
    RETURN;
  END IF;
  FOR q, ord IN SELECT x, (o - 1)::integer FROM jsonb_array_elements(p_content -> 'questions') WITH ORDINALITY t(x, o) LOOP
    CONTINUE WHEN jsonb_typeof(q) <> 'object';
    v_text := _question_key_text(q);
    CONTINUE WHEN v_text IS NULL;
    nonblank := nonblank + 1;
    v_qid := q ->> 'id';
    IF v_qid IS NULL OR v_qid !~ '^[A-Za-z0-9_.-]{1,64}$' THEN
      RAISE EXCEPTION 'activity %: the question at position % has no usable id, so its key cannot be filed. Nothing was changed.',
        p_activity, ord USING ERRCODE = 'check_violation';
    END IF;

    -- one key per question id: a repeated id would let one question's key land on another
    IF (SELECT count(*) FROM jsonb_array_elements(p_content -> 'questions') x
         WHERE jsonb_typeof(x) = 'object' AND x ->> 'id' = v_qid) > 1 THEN
      RAISE EXCEPTION 'activity %: the question id "%" is used more than once and one of them carries answer text, so its key cannot be filed. Give each question its own id. Nothing was changed.',
        p_activity, v_qid USING ERRCODE = 'check_violation';
    END IF;

    -- the machine fields of a multiple-choice or numerical key, read from the same correct_answer text
    v_ca := btrim(coalesce(q ->> 'correct_answer', ''));
    v_has_ca := v_ca <> '' AND (q ->> 'type') IN ('multiple_choice', 'numerical');
    v_choice := NULL; v_val := NULL; v_tolp := NULL; v_tola := NULL;
    IF v_has_ca AND (q ->> 'type') = 'multiple_choice' THEN
      v_choice := ARRAY[v_ca];
    ELSIF v_has_ca AND v_ca ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' THEN
      BEGIN
        v_val := v_ca::numeric;
        IF v_val = 0 THEN v_tola := 0; ELSE v_tolp := 5; END IF;     -- the grading rule's documented default is 5 percent
      EXCEPTION WHEN others THEN
        v_val := NULL; v_tolp := NULL; v_tola := NULL;
      END;
    END IF;

    SELECT qu.id INTO v_qrow FROM questions qu WHERE qu.activity_id = p_activity AND qu.qid = v_qid;
    IF v_qrow IS NULL THEN
      v_fmt := CASE q ->> 'type' WHEN 'multiple_choice' THEN 'multiple_choice' WHEN 'numerical' THEN 'numeric' ELSE 'prose' END;
      BEGIN
        v_pts := least(greatest(coalesce((q ->> 'points')::numeric, 0), 0), 9999.99);
      EXCEPTION WHEN others THEN
        v_pts := 0;
      END;
      INSERT INTO questions (activity_id, qid, position, prompt_md, figure_url, format, points)
      VALUES (p_activity, v_qid, ord::smallint, coalesce(q ->> 'text', ''), nullif(q ->> 'figure_url', ''), v_fmt, round(v_pts, 2))
      RETURNING id INTO v_qrow;
      created_questions := created_questions || v_qrow;
    END IF;

    SELECT k.id, k.reference_text INTO v_cur
      FROM question_keys k
     WHERE k.question_id = v_qrow AND k.variant_key = '' AND k.superseded_at IS NULL;
    SELECT coalesce(max(k.version), 0) + 1 INTO v_next
      FROM question_keys k WHERE k.question_id = v_qrow AND k.variant_key = '';

    IF v_cur.id IS NULL THEN
      INSERT INTO question_keys (question_id, variant_key, version, correct_choice_ids, value, tol_pct, tol_abs, reference_text, written_by)
      VALUES (v_qrow, '', v_next, v_choice, v_val, v_tolp, v_tola, v_text, 'human')
      RETURNING id INTO v_id;
      created_keys := created_keys || v_id;
      covered := covered + 1;
    ELSIF v_cur.reference_text IS NOT DISTINCT FROM v_text THEN
      covered := covered + 1;
    ELSIF p_mode = 'edit' THEN
      UPDATE question_keys SET superseded_at = now() WHERE id = v_cur.id;
      INSERT INTO question_keys (question_id, variant_key, version, correct_choice_ids, select_rule, value, tol_abs, tol_pct,
                                 sig_figs, sig_fig_mode, unit, unit_aliases, unit_mode, reference_text, written_by)
      SELECT k.question_id, k.variant_key, v_next,
             CASE WHEN v_has_ca THEN v_choice ELSE k.correct_choice_ids END, k.select_rule,
             CASE WHEN v_has_ca THEN v_val ELSE k.value END,
             CASE WHEN v_has_ca THEN v_tola ELSE k.tol_abs END,
             CASE WHEN v_has_ca THEN v_tolp ELSE k.tol_pct END,
             k.sig_figs, k.sig_fig_mode, k.unit, k.unit_aliases, k.unit_mode, v_text, 'human'
        FROM question_keys k WHERE k.id = v_cur.id;
      covered := covered + 1;
    ELSE
      differing := differing + 1;      -- the existing key stays; the content value is in the archive
      covered := covered + 1;
    END IF;
  END LOOP;
END $$;

-- ---- 4. move the stored keys ---------------------------------------------------------------------------------

DO $$
DECLARE
  r            record;
  f            record;
  n_act_before integer;
  n_snap_before integer;
  n_nonblank   integer := 0;
  n_covered    integer := 0;
  n_differing  integer := 0;
  n_keys_before integer;
  n_keys_after  integer;
  n_made_keys   integer := 0;
  n_arch_act    integer;
  n_arch_snap   integer;
  n_left        integer;
BEGIN
  SELECT count(*) INTO n_act_before  FROM activities WHERE _content_has_keys(content);
  SELECT count(*) INTO n_snap_before FROM assignment_offerings WHERE _snapshot_has_keys(content_snapshot);
  SELECT count(*) INTO n_keys_before FROM question_keys;

  FOR r IN SELECT id, content FROM activities WHERE _content_has_keys(content) ORDER BY id LOOP
    INSERT INTO content_key_archive (source, row_id, original) VALUES ('activities', r.id, r.content);
    SELECT * INTO f FROM _file_question_keys(r.id, r.content, 'move');
    UPDATE content_key_archive
       SET created_question_ids = f.created_questions, created_key_ids = f.created_keys
     WHERE source = 'activities' AND row_id = r.id;
    UPDATE activities SET content = _strip_question_keys(content) WHERE id = r.id;
    n_nonblank := n_nonblank + f.nonblank;
    n_covered := n_covered + f.covered;
    n_differing := n_differing + f.differing;
    n_made_keys := n_made_keys + coalesce(array_length(f.created_keys, 1), 0);
  END LOOP;

  -- a frozen snapshot refuses a change (004), so the stamp is cleared in its own statement and put back exactly
  FOR r IN SELECT id, content_snapshot, content_snapshot_frozen_at AS fz
             FROM assignment_offerings WHERE _snapshot_has_keys(content_snapshot) ORDER BY id LOOP
    INSERT INTO content_key_archive (source, row_id, original) VALUES ('assignment_offerings', r.id, r.content_snapshot);
    IF r.fz IS NOT NULL THEN
      UPDATE assignment_offerings SET content_snapshot_frozen_at = NULL WHERE id = r.id;
    END IF;
    UPDATE assignment_offerings SET content_snapshot = _strip_snapshot(content_snapshot) WHERE id = r.id;
    IF r.fz IS NOT NULL THEN
      UPDATE assignment_offerings SET content_snapshot_frozen_at = r.fz WHERE id = r.id;
    END IF;
  END LOOP;

  -- the counts must agree, or nothing is kept
  SELECT count(*) INTO n_keys_after FROM question_keys;
  SELECT count(*) INTO n_arch_act  FROM content_key_archive WHERE source = 'activities';
  SELECT count(*) INTO n_arch_snap FROM content_key_archive WHERE source = 'assignment_offerings';
  IF n_arch_act <> n_act_before OR n_arch_snap <> n_snap_before THEN
    RAISE EXCEPTION '047: archived % activity row(s) and % snapshot(s), expected % and %. Nothing was changed.',
      n_arch_act, n_arch_snap, n_act_before, n_snap_before;
  END IF;
  IF n_nonblank <> n_covered THEN
    RAISE EXCEPTION '047: % key value(s) found in content but % have a current key afterwards. Nothing was changed.',
      n_nonblank, n_covered;
  END IF;
  IF n_keys_after - n_keys_before <> n_made_keys THEN
    RAISE EXCEPTION '047: key rows went from % to % but the move made %. Nothing was changed.',
      n_keys_before, n_keys_after, n_made_keys;
  END IF;
  SELECT (SELECT count(*) FROM activities WHERE _content_has_keys(content))
       + (SELECT count(*) FROM assignment_offerings WHERE _snapshot_has_keys(content_snapshot)) INTO n_left;
  IF n_left <> 0 THEN
    RAISE EXCEPTION '047: % row(s) still carry key fields after the move. Nothing was changed.', n_left;
  END IF;

  RAISE NOTICE '047 move: % activity row(s) and % snapshot(s) changed; % key value(s) found, % now in the key table (% new key row(s), % existing key(s) kept where the content value differed); key rows % -> %',
    n_act_before, n_snap_before, n_nonblank, n_covered, n_made_keys, n_differing, n_keys_before, n_keys_after;
END $$;

-- ---- 5. keep the keys out from now on ------------------------------------------------------------------------

CREATE FUNCTION activities_file_keys() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM _file_question_keys(NEW.id, NEW.content, 'edit');
  UPDATE activities SET content = _strip_question_keys(NEW.content) WHERE id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER activities_file_keys
  AFTER INSERT OR UPDATE OF content ON activities
  FOR EACH ROW WHEN (_content_has_keys(NEW.content))
  EXECUTE FUNCTION activities_file_keys();

CREATE FUNCTION assignment_offerings_strip_snapshot_keys() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  NEW.content_snapshot := _strip_snapshot(NEW.content_snapshot);
  RETURN NEW;
END $$;

CREATE TRIGGER assignment_offerings_strip_keys
  BEFORE INSERT OR UPDATE OF content_snapshot ON assignment_offerings
  FOR EACH ROW WHEN (_snapshot_has_keys(NEW.content_snapshot))
  EXECUTE FUNCTION assignment_offerings_strip_snapshot_keys();

-- ---- 6. release time, in the database ------------------------------------------------------------------------

CREATE FUNCTION _item_open_for_section(p_assignment_offering uuid, p_section uuid) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_rel timestamptz;
  v_c   record;
BEGIN
  v_rel := release_at(p_assignment_offering, p_section);
  IF v_rel IS NOT NULL THEN
    RETURN v_rel <= now();
  END IF;
  -- no release time came back: open only when the item is genuinely undated (no opens_at, no usable deadline)
  IF EXISTS (SELECT 1 FROM assignment_offerings ao WHERE ao.id = p_assignment_offering AND ao.opens_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  SELECT c.due_at, c.invalid INTO v_c FROM _scheduled_core(p_assignment_offering, p_section) c;
  RETURN FOUND AND v_c.due_at IS NULL AND NOT v_c.invalid;
END $$;

CREATE FUNCTION my_released_assignment_offerings() RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT ao.id
    FROM assignment_offerings ao
    JOIN sections s ON s.course_offering_id = ao.course_offering_id
    JOIN enrollments e ON e.section_id = s.id AND e.status IN ('active', 'completed') AND e.id IN (SELECT my_enrollments())
   WHERE ao.is_published
     AND (   EXISTS (SELECT 1 FROM submissions sb WHERE sb.enrollment_id = e.id AND sb.assignment_offering_id = ao.id)
          OR EXISTS (SELECT 1 FROM grades g WHERE g.enrollment_id = e.id AND g.assignment_offering_id = ao.id)
          OR _item_open_for_section(ao.id, s.id));
$$;
COMMENT ON FUNCTION my_released_assignment_offerings() IS
  'Published items of the caller''s active or completed enrolments (a completed one keeps a past term readable) that have opened for their section (release_at), plus any item '
  'they already have a submission or grade on. Content of any other item is not delivered. Migration 047.';

-- The visible activities of those items. A function of its own so the policy does not lean on the read rules of
-- offering_activities (which follow my_offerings and so the enrolment statuses it answers for).
CREATE FUNCTION my_released_activity_ids() RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT oa.activity_id FROM offering_activities oa
   WHERE oa.is_visible AND oa.assignment_offering_id IN (SELECT my_released_assignment_offerings());
$$;

DROP POLICY activities_student_read ON activities;
CREATE POLICY activities_student_read ON activities FOR SELECT TO authenticated
  USING (activities.id IN (SELECT my_released_activity_ids()));

-- ---- 6b. a grade is readable exactly when the gradebook shows the cadet its points ----------------------------------
-- ONE source: the gradebook's own cell function (039). gradebook_cells hands a cadet points for a cell in state
-- `released`, or `in_progress` on an auto-checked item, and withholds every other (held, excused, an AI zero that work
-- has overtaken, not yet due). This function applies that same test, for the caller's own enrolments, and my_grades
-- joins it. A test compares the two outputs on every state. Cost: one pass of the cell function over the cadet's
-- course, the same pass gradebook_cells makes for the same cadet.
CREATE FUNCTION my_visible_grade_cells() RETURNS TABLE (enrollment_id uuid, assignment_offering_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT c.enrollment_id, c.assignment_offering_id
    FROM (SELECT DISTINCT s.course_offering_id
            FROM enrollments e JOIN sections s ON s.id = e.section_id
           WHERE e.id IN (SELECT my_enrollments())) co
   CROSS JOIN LATERAL _cells_at(co.course_offering_id, 'final', now()) c
   WHERE c.enrollment_id IN (SELECT my_enrollments())
     AND (c.state = 'released' OR (c.state = 'in_progress' AND c.auto_checked));
$$;
COMMENT ON FUNCTION my_visible_grade_cells() IS
  'The caller''s own (enrollment, item) cells whose points the gradebook shows them: the one rule my_grades follows. Migration 047.';

-- Same columns, same order as 046, so the view is replaced in place.
CREATE OR REPLACE VIEW my_grades WITH (security_barrier = true) AS
  SELECT g.id, g.enrollment_id, g.assignment_offering_id, g.submission_id,
         g.points_earned, g.points_possible, g.effort, g.question_scores,
         g.source, g.is_finalized, g.graded_by, g.graded_at, g.created_at, g.updated_at,
         g.over_max_allowed, g.student_group_id, g.student_group_adjusted,
         g.diagnostic -> 'instructor_note' AS instructor_note
    FROM grades g
   WHERE g.is_finalized
     AND g.enrollment_id IN (SELECT my_enrollments())
     AND (g.enrollment_id, g.assignment_offering_id) IN (SELECT v.enrollment_id, v.assignment_offering_id FROM my_visible_grade_cells() v);

-- ---- 7. a cadet's work rows ---------------------------------------------------------------------------------

CREATE FUNCTION is_written_activity(p_activity uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM activities a WHERE a.id = p_activity AND a.modality = 'written');
$$;

DROP POLICY sa_own ON submission_activities;
DROP POLICY sa_student_write ON submission_activities;
CREATE POLICY sa_own_written ON submission_activities FOR ALL TO authenticated
  USING (is_written_activity(activity_id)
         AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                      AND s.enrollment_id IN (SELECT my_enrollments())))
  WITH CHECK (is_written_activity(activity_id)
              AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                           AND s.enrollment_id IN (SELECT my_enrollments())));

CREATE VIEW my_work WITH (security_barrier = true) AS
  SELECT sa.id, sa.submission_id, s.enrollment_id, s.assignment_offering_id, sa.activity_id,
         sa.payload_bytes, sa.is_final, sa.created_at, sa.updated_at
    FROM submission_activities sa
    JOIN submissions s ON s.id = sa.submission_id
   WHERE s.enrollment_id IN (SELECT my_enrollments());
COMMENT ON VIEW my_work IS
  'The caller''s own work rows, without the stored answers, report or assessment: which activities they have worked on '
  'and whether each is final. Cadets read this for state; they read answers of a written activity from the table. '
  'A column added to submission_activities is not here until this view is rebuilt. Migration 047.';
REVOKE ALL ON my_work FROM PUBLIC, anon;
GRANT SELECT ON my_work TO authenticated;

-- A report for an effort-graded item is refused while a finalized grade of that item stands. Read by the server from
-- `grades` itself, so a held grade (which the cadet cannot see) still counts. Called by save_interactive_work and by
-- commit_work; not callable by the web roles.
CREATE FUNCTION _report_grade_stands(p_enrollment uuid, p_offering uuid, p_activity uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT EXISTS (SELECT 1
                   FROM grades g
                   JOIN offering_activities oa ON oa.assignment_offering_id = g.assignment_offering_id
                                              AND oa.activity_id = p_activity
                  WHERE g.enrollment_id = p_enrollment AND g.assignment_offering_id = p_offering
                    AND g.is_finalized AND oa.grading_role = 'graded' AND oa.grading = 'effort');
$$;

-- A cadet cannot start a submission on an item that has not opened for them. Without this, the "work already begun is
-- never withdrawn" clause above would let a cadet open any item by inserting a submission row. Checked only for a
-- request made as an API role on the caller's own enrolment; staff, scripts and the owner are not affected.
CREATE FUNCTION _may_start_submission(p_offering uuid, p_enrollment uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT CASE WHEN p_enrollment NOT IN (SELECT my_enrollments()) THEN true
              ELSE EXISTS (SELECT 1 FROM enrollments e JOIN assignment_offerings ao ON ao.id = p_offering
                            WHERE e.id = p_enrollment
                              AND _item_open_for_section(ao.id, e.section_id))
         END;
$$;

CREATE FUNCTION submissions_open_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND pg_trigger_depth() <= 1
     AND NOT _may_start_submission(NEW.assignment_offering_id, NEW.enrollment_id) THEN
    RAISE EXCEPTION 'This assignment has not opened yet, so it cannot be started.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submissions_open_guard
  BEFORE INSERT ON submissions
  FOR EACH ROW EXECUTE FUNCTION submissions_open_guard();

CREATE FUNCTION save_interactive_work(p_submission uuid, p_activity uuid, p_content jsonb, p_markdown text,
                                      p_bytes integer, p_final boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = p_submission AND s.enrollment_id IN (SELECT my_enrollments())) THEN
    RAISE EXCEPTION 'save_interactive_work: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM submissions s
                   JOIN offering_activities oa ON oa.assignment_offering_id = s.assignment_offering_id
                   JOIN activities a ON a.id = oa.activity_id
                  WHERE s.id = p_submission AND a.id = p_activity AND a.modality = 'interactive') THEN
    RAISE EXCEPTION 'save_interactive_work: that is not an interactive activity of this assignment'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM submissions s JOIN enrollments e ON e.id = s.enrollment_id
                  WHERE s.id = p_submission AND _item_open_for_section(s.assignment_offering_id, e.section_id)) THEN
    RAISE EXCEPTION 'This assignment has not opened yet, so a report cannot be saved to it.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM submissions s
              WHERE s.id = p_submission AND _report_grade_stands(s.enrollment_id, s.assignment_offering_id, p_activity)) THEN
    RAISE EXCEPTION 'This assignment has already been graded and can''t be resubmitted. Ask your instructor to reopen it if you need to.'
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO submission_activities (submission_id, activity_id, content, report_markdown, payload_bytes, is_final)
  VALUES (p_submission, p_activity, p_content, p_markdown, p_bytes, coalesce(p_final, true))
  ON CONFLICT (submission_id, activity_id) DO UPDATE
     SET content = EXCLUDED.content, report_markdown = EXCLUDED.report_markdown,
         payload_bytes = EXCLUDED.payload_bytes, is_final = EXCLUDED.is_final
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
COMMENT ON FUNCTION save_interactive_work(uuid, uuid, jsonb, text, integer, boolean) IS
  'Saves the caller''s own report for an interactive activity of their own submission. Exists because the cadet cannot '
  'select an interactive row, and an upsert needs the select policy. The commit path is unchanged. Migration 047.';

-- ---- 8. grants: by name --------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION _strip_question_keys(jsonb)            FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _snapshot_has_keys(jsonb)              FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _strip_snapshot(jsonb)                 FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _question_key_text(jsonb)              FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _file_question_keys(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION activities_file_keys()                 FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION assignment_offerings_strip_snapshot_keys() FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _item_open_for_section(uuid, uuid)     FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _report_grade_stands(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
-- the trigger runs with the writer's rights, so this one is callable; it answers true for any enrolment but the caller's
REVOKE ALL ON FUNCTION _may_start_submission(uuid, uuid)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _may_start_submission(uuid, uuid)   TO authenticated;
REVOKE ALL ON FUNCTION submissions_open_guard()               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION my_visible_grade_cells()               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_visible_grade_cells()            TO authenticated;
-- trigger WHEN clauses run with the writer's rights, so these two pure checks stay callable
REVOKE ALL ON FUNCTION _content_has_keys(jsonb)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _content_has_keys(jsonb)            TO authenticated, service_role, prep_app_dml, prep_app_read;
GRANT EXECUTE ON FUNCTION _snapshot_has_keys(jsonb)           TO authenticated, service_role, prep_app_dml, prep_app_read;

REVOKE ALL ON FUNCTION my_released_assignment_offerings()     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_released_assignment_offerings()  TO authenticated;
REVOKE ALL ON FUNCTION my_released_activity_ids()             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_released_activity_ids()          TO authenticated;
REVOKE ALL ON FUNCTION is_written_activity(uuid)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_written_activity(uuid)           TO authenticated;
REVOKE ALL ON FUNCTION save_interactive_work(uuid, uuid, jsonb, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_interactive_work(uuid, uuid, jsonb, text, integer, boolean) TO authenticated;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 0 rows: no stored content or snapshot carries a key field
--   SELECT id FROM app.activities WHERE app._content_has_keys(content);
--   SELECT id FROM app.assignment_offerings WHERE app._snapshot_has_keys(content_snapshot);
--
--   -- how many rows were moved, and the keys they made
--   SELECT source, count(*), sum(cardinality(created_key_ids)) FROM app.content_key_archive GROUP BY source;
--
--   -- items with a snapshot that have not opened for every section (question text would be readable): expect none
--   SELECT ao.id FROM app.assignment_offerings ao
--    WHERE ao.content_snapshot IS NOT NULL AND ao.is_published
--      AND EXISTS (SELECT 1 FROM app.sections s WHERE s.course_offering_id = ao.course_offering_id
--                   AND app.release_at(ao.id, s.id) > now());
--
-- The behaviour is proved by scripts/staging/test_release_gated_content_scratch.py on a throwaway database.
