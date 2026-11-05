-- PREP v2 -- checkpoints: one frozen row per student and period, every run kept
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql. Reads nothing from other v2 migrations: the snapshot columns
-- are plain data, so it does NOT depend on 032 either. It does NOT depend on 023_instructors_admin_flag_guard.sql.
-- Design: docs/decisions/V2-DATA-MODEL.md section 14.
--
-- WHAT IT ADDS  (empty until Stage F)
--   grade_checkpoint_runs   one header per run: period (prog | final), run_no, status (draft | approved | superseded),
--                           scale_snapshot, rule_version, as_of, source_fingerprint, exceptions, who and when,
--                           revises_run_id. UNIQUE (course_offering_id, period, run_no); ONE approved run per
--                           offering and period (partial unique index).
--   grade_checkpoint_rows   one row per enrollment in a run: earned, possible, percent_text, percent_key, letter, gpa,
--                           rank, tie_group, near_line_letter and counts of missing, ungraded, unreleased, excused.
--   checkpoint_tie_choices  a Director's choice (same_rank | alphabetical) per tie group, on a draft run.
--
-- FROZEN MEANS ALL OF IT, ONCE APPROVED
--   Run header     refuses every change except status approved -> superseded, and refuses delete once it has left draft.
--   Rows           the trigger refuses insert, update and delete unless the run is a draft.
--   Tie choices    same.
--   Nothing is ever overwritten. A revision is a new run with revises_run_id set; the old one becomes superseded.
--
-- NO FOREIGN KEYS on the frozen record's person columns (enrollment_id, student_id, section_id, and the who-columns): a
-- cascade or SET NULL would collide with the freeze. The run, rows and ties to their parent are RESTRICT, so a course
-- with an approved record cannot vanish.
--
-- WHO WRITES   Only the Stage F functions (SECURITY DEFINER). Write grants are revoked by name from authenticated,
--              service_role and prep_app_dml. Staff of the offering read the run header; an instructor reads rows of the sections they teach, a Director all. Students have no direct read.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

CREATE TABLE grade_checkpoint_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE RESTRICT,
  period             text NOT NULL,
  run_no             integer NOT NULL,
  status             text NOT NULL DEFAULT 'draft',
  scale_snapshot     jsonb NOT NULL,
  rule_version       text NOT NULL,
  as_of              timestamptz NOT NULL,
  source_fingerprint text NOT NULL,
  exceptions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  approved_by        uuid,
  approved_at        timestamptz,
  revises_run_id     uuid REFERENCES grade_checkpoint_runs(id) ON DELETE RESTRICT,
  CONSTRAINT grade_checkpoint_runs_period_ck CHECK (period IN ('prog', 'final')),
  CONSTRAINT grade_checkpoint_runs_status_ck CHECK (status IN ('draft', 'approved', 'superseded')),
  CONSTRAINT grade_checkpoint_runs_run_no_ck CHECK (run_no >= 1),
  CONSTRAINT grade_checkpoint_runs_approval_ck CHECK ((status = 'draft') = (approved_at IS NULL)),
  CONSTRAINT grade_checkpoint_runs_run_key UNIQUE (course_offering_id, period, run_no)
);

CREATE UNIQUE INDEX grade_checkpoint_runs_one_approved
  ON grade_checkpoint_runs (course_offering_id, period) WHERE status = 'approved';

CREATE TABLE grade_checkpoint_rows (
  run_id            uuid NOT NULL REFERENCES grade_checkpoint_runs(id) ON DELETE RESTRICT,
  enrollment_id     uuid NOT NULL,
  student_id        bigint NOT NULL,
  section_id        uuid,
  earned            numeric NOT NULL,
  possible          numeric NOT NULL,
  percent_text      text,
  percent_key       text,
  letter            text,
  gpa               numeric,
  rank              integer,
  tie_group         text,
  near_line_letter  text,
  missing_count     integer NOT NULL DEFAULT 0,
  ungraded_count    integer NOT NULL DEFAULT 0,
  unreleased_count  integer NOT NULL DEFAULT 0,
  excused_count     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, enrollment_id)
);

CREATE TABLE checkpoint_tie_choices (
  run_id    uuid NOT NULL REFERENCES grade_checkpoint_runs(id) ON DELETE RESTRICT,
  tie_group text NOT NULL,
  choice    text NOT NULL,
  chosen_by uuid,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, tie_group),
  CONSTRAINT checkpoint_tie_choices_choice_ck CHECK (choice IN ('same_rank', 'alphabetical'))
);

COMMENT ON TABLE grade_checkpoint_runs IS
  'One run of a Prog or Final checkpoint. Every run is kept. Once approved the header refuses every change except '
  'approved -> superseded; the rows and tie choices refuse every write.';
COMMENT ON TABLE grade_checkpoint_rows IS
  'A frozen record. enrollment_id, student_id and section_id are plain values with no foreign key, so removing a person '
  'or a section never touches an approved record.';

-- ---- freeze: the header ---------------------------------------------------------------------------
CREATE FUNCTION grade_checkpoint_runs_freeze() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'checkpoint run % is %: it is a record and is never deleted', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'checkpoint run % is % and frozen; only approved -> superseded is allowed', OLD.id, OLD.status
    USING ERRCODE = 'check_violation';
END; $$;

CREATE TRIGGER grade_checkpoint_runs_freeze
  BEFORE UPDATE OR DELETE ON grade_checkpoint_runs
  FOR EACH ROW EXECUTE FUNCTION grade_checkpoint_runs_freeze();

-- ---- freeze: the rows and the tie choices ---------------------------------------------------------
CREATE FUNCTION checkpoint_child_freeze() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_status text;
  v_run    uuid;
BEGIN
  FOREACH v_run IN ARRAY (CASE TG_OP
                           WHEN 'INSERT' THEN ARRAY[NEW.run_id]
                           WHEN 'DELETE' THEN ARRAY[OLD.run_id]
                           ELSE ARRAY[OLD.run_id, NEW.run_id] END) LOOP
    SELECT r.status INTO v_status FROM grade_checkpoint_runs r WHERE r.id = v_run;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'checkpoint run % is % and frozen: its rows and tie choices do not change', v_run, coalesce(v_status, 'missing')
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER grade_checkpoint_rows_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON grade_checkpoint_rows
  FOR EACH ROW EXECUTE FUNCTION checkpoint_child_freeze();
CREATE TRIGGER checkpoint_tie_choices_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON checkpoint_tie_choices
  FOR EACH ROW EXECUTE FUNCTION checkpoint_child_freeze();

-- ---- RLS ---------------------------------------------------------------------------------------------
ALTER TABLE grade_checkpoint_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_checkpoint_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoint_tie_choices ENABLE ROW LEVEL SECURITY;

CREATE POLICY gcr_read_staff ON grade_checkpoint_runs FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
-- A frozen row names a cadet and a grade, so it follows the rest of the design: an instructor reads the sections they
-- teach (rank and tie group stay course-wide numbers), and a Director reads the whole offering.
CREATE POLICY gcrows_read_staff ON grade_checkpoint_rows FOR SELECT TO authenticated
  USING (section_id IN (SELECT staff_sections())
         AND run_id IN (SELECT r.id FROM grade_checkpoint_runs r WHERE r.course_offering_id IN (SELECT staff_offerings())));
CREATE POLICY ctc_read_staff ON checkpoint_tie_choices FOR SELECT TO authenticated
  USING (run_id IN (SELECT r.id FROM grade_checkpoint_runs r WHERE r.course_offering_id IN (SELECT staff_offerings())));

-- ---- grants: by name ---------------------------------------------------------------------------------
REVOKE ALL ON grade_checkpoint_runs, grade_checkpoint_rows, checkpoint_tie_choices FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON grade_checkpoint_runs, grade_checkpoint_rows, checkpoint_tie_choices
  FROM authenticated, service_role, prep_app_dml;

REVOKE ALL ON FUNCTION grade_checkpoint_runs_freeze()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION checkpoint_child_freeze()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   SELECT count(*) FROM app.grade_checkpoint_runs;      -- 0 until Stage F
