-- PREP v2 — core data model for schema `app`
-- =====================================================================================
-- Migration chain for the NEW schema. Numbered separately from supabase/migrations/*.sql,
-- which is the chain for `public` (the live site). Nothing here touches `public`.
--
-- Run as `prep_app_owner` (the DDL tier), which owns the schema.
--
-- SCOPE (decided 2026-07-20): preflights only. The homework / quiz / exam layer
-- (grading_categories with weights, external_systems, external_links, import_batches) is
-- deliberately NOT built yet. `assignment_kinds` IS included as a lookup table so adding a
-- type later is an INSERT rather than a schema migration.
--
-- =====================================================================================
-- THE CENTRAL SHAPE — an assignment is a CONTAINER; activities are what is inside it
-- =====================================================================================
--
--   assignments          THE CONTAINER. Reusable, term-free. Pure definition: a kind,
--     |                  a title, shared objectives. Carries no grading policy at all.
--     |
--     +-- activities     what is INSIDE the container — the possibilities offered to the
--                        student: a written question set, an interactive artifact. Also
--                        pure content: the questions, the artifact URL.
--
--   assignment_offerings the container SCHEDULED into one term: due dates, points, publish
--     |                  state. Mirrors courses -> course_offerings. Submissions and grades
--     |                  point HERE, so a Fall 2026 grade stays attached to Fall 2026.
--     |
--     +-- offering_activities
--                        WHICH activities are live this term, WHICH one carries credit, and
--                        WHEN each becomes available. This is the operational lever.
--
-- WHY grading policy sits on the OFFERING and not on the activity
--   Whether the written questions or the interactive artifact carries credit is a per-term
--   delivery decision, not a property of the content. Two consequences that matter:
--
--     * Fall 2026 can grade the interactive while Spring 2027 grades the written, from the
--       same library assignment, with no forking.
--     * If the interactive breaks mid-term, flipping the whole cohort over to the questions
--       is two UPDATEs on offering_activities. The library definition is never touched, and
--       students who already earned a grade keep it (see the trigger note below).
--
-- The cases this expresses:
--   1. student chooses            two offering_activities, both grading_role='graded'
--   2. do the questions, but the interactive is there too
--                                 written 'graded'; interactive 'practice'
--   3. force interactive, questions present as a fallback
--                                 interactive 'graded'; written 'practice'
--                                 -> if implementation trouble hits, swap the two roles
--   4. homework, one thing        one offering_activity, 'graded'
--
-- "single vs choice" is therefore DERIVED, not declared: one graded activity this term
-- means single, two or more means choice. There is no selection_policy column to drift.
--
-- =====================================================================================
-- INVARIANTS ENFORCED STRUCTURALLY (see app_invariant_test.py — these are tested, not assumed)
--   * exactly one grade per (enrolment, assignment_offering)  -- UNIQUE on grades
--   * a grade can never exceed the offering's value           -- CHECK points bound
--   * exactly one submission per (enrolment, offering)        -- UNIQUE on submissions
--   * a chosen activity must be offered in THAT offering      -- composite FK
--   * a practice activity can never be chosen for credit      -- gradable trigger
--   * the chosen activity cannot silently change              -- lock trigger, policy-driven
--   * an unlock must name who performed it                    -- lock trigger
--   * NO foreign key from `app` into `public`                 -- bootstrap §9
--
-- DEFERRED TO A POSTGRES-RUN SNIPPET (bootstrap §6): the two FKs into auth.users, declared
-- here as plain uuid columns because `postgres` cannot delegate REFERENCES on auth.users.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;


-- =====================================================================================
-- LAYER 1 — CATALOGUE  (term-free, reusable across semesters)
-- =====================================================================================

CREATE TABLE courses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- 'phys-215'
  title       text NOT NULL,
  department  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE courses IS
  'Catalogue entry, not an offering. "Physics 215" the course, independent of any semester.';
COMMENT ON COLUMN courses.code IS
  'Stable human identifier. Surrogate uuid PK on purpose: text PKs collided across courses in July 2026.';


CREATE TABLE terms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,             -- 'fall-2026'
  label      text NOT NULL,                    -- 'Fall 2026'
  starts_on  date,
  ends_on    date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_date_order CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);
COMMENT ON TABLE terms IS 'The axis the old schema had no concept of.';


CREATE TABLE assignment_kinds (
  id         text PRIMARY KEY,                 -- 'preflight'
  label      text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0
);
COMMENT ON TABLE assignment_kinds IS
  'Lookup, not an enum: adding homework/quiz/exam later is an INSERT, not a migration.';

INSERT INTO assignment_kinds (id, label, sort_order) VALUES ('preflight', 'Preflight', 10);


CREATE TABLE assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid REFERENCES courses(id) ON DELETE CASCADE,   -- NULL = shared library
  kind_id     text NOT NULL REFERENCES assignment_kinds(id),
  slug        text NOT NULL,                   -- 'preflight-02'
  title       text NOT NULL,
  description text,
  objectives  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label}] shared taxonomy
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_slug_unique UNIQUE NULLS NOT DISTINCT (course_id, slug)
);
COMMENT ON TABLE assignments IS
  'THE CONTAINER — the reusable definition of a piece of work, holding the possibilities a '
  'student may work through. Knows nothing about a semester, a due date, or which activity '
  'carries credit; all three are per-term decisions living in assignment_offerings and '
  'offering_activities. Replaces the role the old `lessons` table played, but as the primary '
  'noun rather than a reconciliation layer bolted over two parallel worlds.';
COMMENT ON COLUMN assignments.course_id IS
  'NULL means shared across courses. UNIQUE uses NULLS NOT DISTINCT so two shared '
  'assignments cannot share a slug.';


CREATE TABLE activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  modality      text NOT NULL CHECK (modality IN ('written','interactive')),
  slug          text NOT NULL UNIQUE,
  title         text,
  content       jsonb NOT NULL DEFAULT '{}'::jsonb,
  position      smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_one_per_modality UNIQUE (assignment_id, modality)
);
COMMENT ON TABLE activities IS
  'What is INSIDE an assignment. Pure content — the questions or the artifact. Modality is a '
  'property here, not a top-level entity, which is what removes the old parallel '
  'assignments/interactions worlds and the lesson_completions layer that reconciled them. '
  'Whether an activity is graded is NOT stored here; see offering_activities.';
COMMENT ON COLUMN activities.slug IS
  'FROZEN CONTRACT SURFACE. Deployed Claude artifacts post to interaction-submit.html#i=<slug>. '
  'Existing interactions.id values migrate here verbatim. Globally unique because the artifact '
  'sends no other context. Never rename a slug that has shipped.';
COMMENT ON COLUMN activities.content IS
  'Shape by modality. written: {"questions":[{id,text,type,points,objective_key,role,expected_response,figure_url}]}. interactive: {"artifact_url":"...","chat_input_markdown":"...","content_sha256":"..."}.';


-- =====================================================================================
-- LAYER 2 — DELIVERY  (term-scoped)
-- =====================================================================================

CREATE TABLE course_offerings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_id    uuid NOT NULL REFERENCES terms(id)   ON DELETE CASCADE,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_offerings_unique UNIQUE (course_id, term_id)
);
COMMENT ON TABLE course_offerings IS
  '"Physics 215, Fall 2026" — the anchor everything term-scoped hangs from.';


CREATE TABLE sections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  code               text NOT NULL,            -- 'M1A'
  meeting_days       text[] NOT NULL DEFAULT '{}',   -- {'M'} / {'T'} / {'M','W','F'}
  period             smallint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_code_unique UNIQUE (course_offering_id, code)
);
COMMENT ON TABLE sections IS
  'Section codes are unique per OFFERING, not globally, so two courses can both have an M1A '
  'and a code can be reused next term. The old ^[MT][135][A-D]$ CHECK is deliberately gone — '
  'it hardcoded a two-course meeting pattern.';


CREATE TABLE students (
  student_id   bigint PRIMARY KEY,
  name         text NOT NULL,
  auth_user_id uuid UNIQUE,                    -- FK to auth.users added by postgres, bootstrap §6
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_cadet_id_range CHECK (student_id BETWEEN 3000000000 AND 3009999999)
);
COMMENT ON TABLE students IS
  'The person, independent of any course. Cadet ID kept as a natural PK — it is the one key '
  'here that genuinely identifies its subject.';


CREATE TABLE enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  bigint NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  section_id  uuid   NOT NULL REFERENCES sections(id)         ON DELETE CASCADE,
  status      text   NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','dropped','completed')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  dropped_at  timestamptz,
  CONSTRAINT enrollments_unique UNIQUE (student_id, section_id)
);
COMMENT ON TABLE enrollments IS
  'The multi-course fix, and the anchor for ALL student work. Because grades hang off the '
  'enrolment rather than the student, moving someone between sections no longer silently '
  're-attributes their history.';


CREATE TABLE instructors (
  id              uuid PRIMARY KEY,            -- = auth.users.id; FK added by postgres, §6
  name            text NOT NULL,
  is_global_admin boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN instructors.is_global_admin IS
  'System-admin flag only. The legacy is_director boolean is NOT carried over — course-level '
  'authority lives in staff_assignments, one source of truth.';


CREATE TABLE staff_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id      uuid NOT NULL REFERENCES instructors(id)      ON DELETE CASCADE,
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  section_id         uuid REFERENCES sections(id) ON DELETE CASCADE,   -- NULL = offering-wide
  role               text NOT NULL CHECK (role IN ('director','instructor','grader')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_assignments_unique
    UNIQUE NULLS NOT DISTINCT (instructor_id, course_offering_id, section_id)
);
COMMENT ON TABLE staff_assignments IS
  'Replaces instructor_course_access AND sections.instructor_id with one term-aware table. '
  'A Fall 2026 director is no longer a director of the course in perpetuity.';


CREATE TABLE assignment_offerings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  assignment_id      uuid NOT NULL REFERENCES assignments(id)      ON DELETE RESTRICT,

  points_possible    numeric(6,2) NOT NULL DEFAULT 2,
  grading_mode       text NOT NULL DEFAULT 'effort'
                       CHECK (grading_mode IN ('effort','points')),
  switch_policy      text NOT NULL DEFAULT 'lock_on_commit'
                       CHECK (switch_policy IN ('free_until_commit','lock_on_commit',
                                                'one_way_to_interactive','lock_on_start')),

  opens_at           timestamptz,
  due_at             timestamptz,              -- default deadline; overridden per section
  is_published       boolean NOT NULL DEFAULT false,
  content_snapshot   jsonb,                    -- frozen at publish; see COMMENT
  position           integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_offerings_unique UNIQUE (course_offering_id, assignment_id),
  CONSTRAINT assignment_offerings_points_positive CHECK (points_possible >= 0)
);
COMMENT ON TABLE assignment_offerings IS
  'An assignment SCHEDULED into one term. Mirrors courses -> course_offerings: the assignment '
  'is the reusable definition, this row is one term''s run of it. Submissions and grades point '
  'HERE, not at the assignment, so a student''s Fall 2026 grade stays attached to Fall 2026.';
COMMENT ON COLUMN assignment_offerings.content_snapshot IS
  'Copy of the activities'' content taken at publish. Editing next year''s library copy therefore '
  'cannot rewrite what this year''s cohort actually saw, while the shared assignment_id keeps the '
  'two runs joinable for cross-term analysis.';
COMMENT ON COLUMN assignment_offerings.switch_policy IS
  'The locking rule as DATA, not compiled into a trigger body — the phase sequence of the '
  'research design deliberately changes what students may do, and changing the experiment '
  'should not require a migration. Enforced by app.submissions_lock_activity().';
COMMENT ON COLUMN assignment_offerings.grading_mode IS
  'effort: points derived 0-5 -> 0..points_possible by trigger (today''s interaction rule). '
  'points: points_earned written directly.';


CREATE TABLE offering_activities (
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  activity_id            uuid NOT NULL REFERENCES activities(id)           ON DELETE CASCADE,
  grading_role           text NOT NULL DEFAULT 'graded'
                           CHECK (grading_role IN ('graded','practice')),
  available_after        text NOT NULL DEFAULT 'always'
                           CHECK (available_after IN ('always','submit','due')),
  is_visible             boolean NOT NULL DEFAULT true,
  position               smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_offering_id, activity_id),
  CONSTRAINT offering_activities_offering_activity_key
    UNIQUE (assignment_offering_id, activity_id)
);
COMMENT ON TABLE offering_activities IS
  'THE OPERATIONAL LEVER. Which of an assignment''s activities are live this term, which one '
  'carries credit, and when each opens. Swapping grading_role between two rows moves the whole '
  'cohort from one modality to the other — the "if the interactive breaks, kick everyone over '
  'to the questions" case — without touching the library definition and without disturbing '
  'grades already earned.';
COMMENT ON COLUMN offering_activities.grading_role IS
  'graded:   eligible to be THE graded activity for this offering. Two or more graded rows '
  '          means the student chooses; exactly one means it is required. '
  'practice: present and workable, but can never carry credit. Covers both directions — '
  '          questions available alongside a graded interactive, and an interactive available '
  '          alongside graded questions.';
COMMENT ON COLUMN offering_activities.available_after IS
  'always: open from the start. submit: unlocks once the student commits their graded work. '
  'due: unlocks at the deadline — study mode.';


CREATE TABLE assignment_due_dates (
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  section_id             uuid NOT NULL REFERENCES sections(id)             ON DELETE CASCADE,
  due_at                 timestamptz NOT NULL,
  PRIMARY KEY (assignment_offering_id, section_id)
);
COMMENT ON TABLE assignment_due_dates IS
  'Generalises due_date_m / due_date_t to any meeting pattern. Absent row = the offering''s due_at.';


-- =====================================================================================
-- LAYER 3 — WORK AND GRADES  (per enrolment)
-- =====================================================================================

CREATE TABLE submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  chosen_activity_id     uuid,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','committed','superseded')),
  committed_at           timestamptz,
  unlocked_by            uuid REFERENCES instructors(id) ON DELETE SET NULL,
  unlocked_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_unique UNIQUE (enrollment_id, assignment_offering_id),
  -- The chosen activity must actually be offered in THIS offering. MATCH SIMPLE means a NULL
  -- chosen_activity_id satisfies the constraint, which is what we want before a choice is made.
  CONSTRAINT submissions_activity_in_offering
    FOREIGN KEY (assignment_offering_id, chosen_activity_id)
    REFERENCES offering_activities (assignment_offering_id, activity_id) ON DELETE SET NULL
);
COMMENT ON TABLE submissions IS
  'One row per enrolment per assignment offering. The choice, the lock, and the identity of '
  'the attempt live together here — which is what makes double-credit structurally impossible '
  'rather than merely defended against in application code.';
COMMENT ON COLUMN submissions.chosen_activity_id IS
  'Which activity counts for credit. A composite FK guarantees it belongs to this offering, '
  'and a trigger guarantees it is grading_role=''graded'' at the moment it is chosen.';
COMMENT ON COLUMN submissions.unlocked_by IS
  'The escape hatch the old model lacked: an instructor can clear the committed choice when a '
  'student picks the wrong path by accident. The trigger REFUSES an unlock that does not name '
  'who performed it, so unlocks are always attributable.';


CREATE TABLE submission_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  activity_id     uuid NOT NULL REFERENCES activities(id)  ON DELETE CASCADE,
  content         jsonb,                       -- written answers, or schema:1 report_data
  report_markdown text,
  payload_bytes   integer,
  is_final        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_activities_unique UNIQUE (submission_id, activity_id),
  CONSTRAINT submission_activities_markdown_size CHECK (
    report_markdown IS NULL OR length(report_markdown) <= 100000),
  CONSTRAINT submission_activities_content_size CHECK (
    content IS NULL OR octet_length(content::text) <= 32768)
);
COMMENT ON TABLE submission_activities IS
  'The actual work, one row per activity the student engaged with — including practice ones. '
  'BOTH are kept when a student does both, which is the revealed-preference research signal, '
  'while only the chosen activity is graded.';


CREATE TABLE grades (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES enrollments(id)          ON DELETE CASCADE,
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  submission_id          uuid REFERENCES submissions(id) ON DELETE SET NULL,

  points_earned   numeric(6,2),
  points_possible numeric(6,2) NOT NULL,
  effort          smallint CHECK (effort IS NULL OR effort BETWEEN 0 AND 5),
  question_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostic      jsonb NOT NULL DEFAULT '{}'::jsonb,

  source          text NOT NULL DEFAULT 'ai_suggested'
                    CHECK (source IN ('instructor','ai_suggested','derived','imported')),
  is_finalized    boolean NOT NULL DEFAULT false,
  graded_by       uuid REFERENCES instructors(id) ON DELETE SET NULL,
  graded_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grades_unique UNIQUE (enrollment_id, assignment_offering_id),
  CONSTRAINT grades_within_bounds CHECK (
    points_earned IS NULL OR (points_earned >= 0 AND points_earned <= points_possible))
);
COMMENT ON TABLE grades IS
  'Exactly one grade per enrolment per assignment offering, bounded by that offering''s value. '
  'These two constraints replace a whole class of bug: the old model spread a lesson''s grade '
  'across scores, preflight_interaction_reports.score, and lesson_completions.points with '
  'nothing relating earned points to possible points anywhere.';
COMMENT ON COLUMN grades.submission_id IS
  'Nullable on purpose. An in-class exam scored in Gradescope produces a grade with no '
  'submission in this system, and both constraints above still hold.';
COMMENT ON COLUMN grades.question_scores IS
  'Per-question 3-state detail, carried over unchanged: {"q1":{score,max,status,feedback}} '
  'where status is full | warn | zero.';
COMMENT ON COLUMN grades.diagnostic IS
  'The frozen schema:1 payload — overall_understanding, objectives[], misconceptions[], '
  'reading_reflection, flags. NEVER contributes to points.';


CREATE TABLE grade_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id    uuid REFERENCES grades(id) ON DELETE CASCADE,
  event       text NOT NULL,                   -- 'created','rescored','finalized','reopened','unlocked'
  actor       uuid REFERENCES instructors(id) ON DELETE SET NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE grade_events IS
  'Append-only audit. Cheap insurance: a retroactive rescore silently corrupted totals in the '
  'old system once already.';


-- =====================================================================================
-- LAYER 4 — ANALYSIS
-- =====================================================================================

CREATE TABLE analysis_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL CHECK (scope IN ('assignment_offering','section','course_offering')),
  scope_id     uuid NOT NULL,
  audience_id  uuid REFERENCES instructors(id) ON DELETE CASCADE,  -- NULL = whole-course
  kind         text NOT NULL,                  -- 'by_question','by_objective','readiness'
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_reports_unique UNIQUE NULLS NOT DISTINCT (scope, scope_id, audience_id, kind)
);
COMMENT ON TABLE analysis_reports IS
  'One table replacing assignments.analysis_report (a JSONB column) and interaction_analysis '
  '(a table) — two differently-shaped stores for the same idea. scope_id is intentionally not '
  'a FK: it points at whichever table `scope` names.';


-- =====================================================================================
-- TRIGGERS
-- =====================================================================================

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER courses_touch               BEFORE UPDATE ON courses               FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER assignments_touch           BEFORE UPDATE ON assignments           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER activities_touch            BEFORE UPDATE ON activities            FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER students_touch              BEFORE UPDATE ON students              FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER assignment_offerings_touch  BEFORE UPDATE ON assignment_offerings  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER submissions_touch           BEFORE UPDATE ON submissions           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER submission_activities_touch BEFORE UPDATE ON submission_activities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER grades_touch                BEFORE UPDATE ON grades                FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- Only a 'graded' activity may be chosen for credit.
--
-- Fires ONLY when chosen_activity_id is actually being set or changed. That matters: when a
-- director flips the cohort from interactive to written, activities students already committed
-- to become 'practice'. Their existing submission rows must stay updatable (status changes,
-- unlocks) without this trigger rejecting them retroactively — the grades they already earned
-- are not disturbed, and only NEW choices are held to the new roles.
CREATE FUNCTION submissions_check_gradable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role_ text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.chosen_activity_id IS NOT DISTINCT FROM OLD.chosen_activity_id THEN
    RETURN NEW;
  END IF;
  IF NEW.chosen_activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT grading_role INTO role_
    FROM offering_activities
   WHERE assignment_offering_id = NEW.assignment_offering_id
     AND activity_id            = NEW.chosen_activity_id;

  IF role_ IS DISTINCT FROM 'graded' THEN
    RAISE EXCEPTION
      'activity % is % in this offering; only a graded activity can be chosen for credit',
      NEW.chosen_activity_id, coalesce(role_, 'not offered');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER submissions_gradable BEFORE INSERT OR UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION submissions_check_gradable();


-- The activity lock, driven by assignment_offerings.switch_policy rather than hardcoded.
CREATE FUNCTION submissions_lock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pol     text;
  old_mod text;
  new_mod text;
BEGIN
  IF NEW.chosen_activity_id IS NOT DISTINCT FROM OLD.chosen_activity_id THEN
    RETURN NEW;
  END IF;

  -- An instructor unlock (clearing the choice) is permitted, but must name who did it.
  IF NEW.chosen_activity_id IS NULL THEN
    IF NEW.unlocked_by IS NULL THEN
      RAISE EXCEPTION
        'submission %: an unlock must set unlocked_by so it is attributable', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Nothing committed yet: the choice is still free.
  IF OLD.chosen_activity_id IS NULL OR OLD.status <> 'committed' THEN
    RETURN NEW;
  END IF;

  SELECT ao.switch_policy INTO pol
    FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  SELECT modality INTO old_mod FROM activities WHERE id = OLD.chosen_activity_id;
  SELECT modality INTO new_mod FROM activities WHERE id = NEW.chosen_activity_id;

  IF pol = 'free_until_commit' THEN
    RAISE EXCEPTION
      'submission % is committed to %; switch_policy=free_until_commit forbids changing it',
      OLD.id, old_mod;
  ELSIF pol = 'one_way_to_interactive' THEN
    IF NOT (old_mod = 'written' AND new_mod = 'interactive') THEN
      RAISE EXCEPTION
        'submission %: switch_policy=one_way_to_interactive allows written->interactive only (got %->%)',
        OLD.id, old_mod, new_mod;
    END IF;
  ELSE   -- lock_on_commit, lock_on_start
    RAISE EXCEPTION
      'submission % is locked to % by switch_policy=%; an instructor unlock is required',
      OLD.id, old_mod, pol;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER submissions_lock BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION submissions_lock_activity();


-- points := f(effort) when the offering is effort-graded. Scales to points_possible so a
-- 2-point preflight and a 10-point homework both work off the same 0-5 scale.
CREATE FUNCTION grades_points_from_effort() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mode text;
BEGIN
  SELECT ao.grading_mode INTO mode
    FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  IF mode <> 'effort' THEN
    RETURN NEW;
  END IF;
  NEW.points_earned := CASE
    WHEN NEW.effort IS NULL THEN 0
    WHEN NEW.effort >= 3    THEN NEW.points_possible
    WHEN NEW.effort >= 1    THEN round(NEW.points_possible / 2, 2)
    ELSE 0
  END;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION grades_points_from_effort() IS
  'Preserves the migration-013 curve (effort 3-5 -> full, 1-2 -> half, 0/NULL -> zero). Never '
  'write points_earned directly on an effort-graded offering; this overwrites it.';

CREATE TRIGGER grades_effort BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_points_from_effort();


-- =====================================================================================
-- INDEXES  (beyond those implied by PK / UNIQUE)
-- =====================================================================================

CREATE INDEX assignments_course_kind_idx    ON assignments (course_id, kind_id);
CREATE INDEX activities_assignment_idx      ON activities (assignment_id);
CREATE INDEX sections_offering_idx          ON sections (course_offering_id);
CREATE INDEX enrollments_student_idx        ON enrollments (student_id);
CREATE INDEX enrollments_section_idx        ON enrollments (section_id) WHERE status = 'active';
CREATE INDEX staff_offering_idx             ON staff_assignments (course_offering_id);
CREATE INDEX staff_instructor_idx           ON staff_assignments (instructor_id);
CREATE INDEX assignment_offerings_co_idx    ON assignment_offerings (course_offering_id, position);
CREATE INDEX assignment_offerings_asg_idx   ON assignment_offerings (assignment_id);
CREATE INDEX offering_activities_graded_idx ON offering_activities (assignment_offering_id)
                                            WHERE grading_role = 'graded';
CREATE INDEX offering_activities_act_idx    ON offering_activities (activity_id);
CREATE INDEX submissions_offering_idx       ON submissions (assignment_offering_id);
CREATE INDEX submission_activities_sub_idx  ON submission_activities (submission_id);
CREATE INDEX grades_offering_idx            ON grades (assignment_offering_id);
CREATE INDEX grades_unfinalized_idx         ON grades (assignment_offering_id) WHERE NOT is_finalized;
CREATE INDEX grade_events_grade_idx         ON grade_events (grade_id, occurred_at DESC);
CREATE INDEX analysis_reports_scope_idx     ON analysis_reports (scope, scope_id);

COMMIT;
