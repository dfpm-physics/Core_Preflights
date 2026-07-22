-- PREP v2 — an audit trail for analysis runs
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
--
-- WHY THIS EXISTS
--   Grading and cohort analysis are the only writes in this system performed by an AI on a
--   human's behalf, and until now they left no durable record of having happened. The
--   convention was a CHANGELOG.md entry per run (CORE.md §0), which works for one-off
--   migrations and falls apart here: a term is ~40 lessons, each closed out twice (M-day and
--   T-day), so the convention asks for 80+ hand-written entries that bury the changes anyone
--   actually reads the file for. And it is the wrong medium — a repo file cannot tell an
--   instructor "your section was graded at 0412 and here is what was skipped".
--
--   So the audit trail moves into the database, beside the data it describes.
--
-- IT COVERS EVERY RUN, NOT JUST SCHEDULED ONES
--   A record written only by the cron would answer "did the job fire?" and nothing else. The
--   question that actually gets asked is "who last touched these grades, when, and what did
--   it skip?" — and a director typing /preflight-analyze at 2200 is exactly as much a source
--   of surprise as a scheduler. `invoked_by` distinguishes them; both are recorded.
--
-- A ROW IS WRITTEN AT START, NOT AT THE END
--   Writing only on completion means a run that dies mid-way — the interesting case — leaves
--   nothing behind. Instead the skill inserts `status='running'` before its first write and
--   updates it at the end. A row still marked `running` long after `started_at` is a crashed
--   or abandoned run, and that is a fact worth being able to see.
--
-- WHY THERE IS NO WRITE POLICY
--   Same posture as analysis_reports: only the service tiers (`prep_app_dml`, service_role)
--   write here, and they hold BYPASSRLS. Granting `authenticated` an INSERT would let a
--   signed-in instructor forge an audit entry, which is precisely the value the table has.
--   Staff read; nobody signed in through the browser writes.
--
-- WHY `detail` IS jsonb AND NOT COLUMNS
--   The three skills report different things — grading reports students graded and skipped,
--   aggregation reports scopes written and whether the whole-course scope was deferred. A
--   column set wide enough for both would be mostly null in both. The shape is per-skill and
--   documented in each SKILL.md; queries that care use ->> on the keys they know.
--
-- NOT AN EVENT LOG
--   One row per RUN, not per step. `grade_events` already records per-grade history; this
--   table answers a coarser question and should stay coarse, or it becomes something nobody
--   reads for the same reason CHANGELOG.md stopped working.

CREATE TABLE IF NOT EXISTS analysis_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which workflow ran. Free text rather than an enum: the skill set changes faster than the
  -- schema, and a new skill must not need a migration before it can record itself.
  skill                   text        NOT NULL,
  invoked_by              text        NOT NULL DEFAULT 'human',
  -- The person who asked for it, when there was one. NULL for a scheduled run, which is the
  -- distinction that matters at 0400.
  actor                   uuid        REFERENCES instructors(id) ON DELETE SET NULL,

  -- Scope. course_offering is always known; assignment_offering is null only for a run that
  -- failed before it resolved a lesson.
  course_offering_id      uuid        NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  assignment_offering_id  uuid        REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  day_track               text,       -- 'M' / 'T' / NULL for an unfiltered run

  status                  text        NOT NULL DEFAULT 'running',
  started_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz,

  -- One line a human can read in a list view, e.g.
  -- "Graded 32 of 36; skipped 4 finalized. Wrote M1A, M3A; deferred __all__."
  summary                 text,
  -- Per-skill counts. See each SKILL.md for the keys it writes.
  detail                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Populated only when status='failed'. The message, not a stack trace.
  error                   text,

  CONSTRAINT analysis_runs_status_ck
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
  CONSTRAINT analysis_runs_invoked_ck
    CHECK (invoked_by IN ('human', 'scheduled')),
  CONSTRAINT analysis_runs_finished_ck
    CHECK (finished_at IS NULL OR finished_at >= started_at),
  -- A terminal run must say when it ended; a running one must not claim to have.
  CONSTRAINT analysis_runs_terminal_ck
    CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT analysis_runs_error_ck
    CHECK (error IS NULL OR status = 'failed')
);

COMMENT ON TABLE analysis_runs IS
  'One row per AI analysis run (preflight-analyze, lesson-aggregate, lesson-cycle), however it '
  'was started. Written at start with status=''running'' and updated on completion, so a run '
  'that died leaves a visible trace. Replaces the CHANGELOG.md-entry-per-run convention for '
  'these workflows, which does not scale to ~80 runs a term and cannot be read by an instructor.';

COMMENT ON COLUMN analysis_runs.invoked_by IS
  '''human'' (someone typed the command) or ''scheduled'' (a cron/Task Scheduler fired it). '
  'The audit question is usually "was anyone watching?".';
COMMENT ON COLUMN analysis_runs.detail IS
  'Per-skill counts; shape documented in each SKILL.md. Deliberately jsonb — grading and '
  'aggregation report different things and a shared column set would be half-null for both.';
COMMENT ON COLUMN analysis_runs.status IS
  '''running'' until the skill finishes. ''partial'' means it completed but did less than asked '
  '(e.g. the whole-course scope deferred); ''skipped'' means it correctly declined to act.';

-- The two orderings anyone actually asks for: this lesson's history, and this course's recent
-- activity. Both newest-first, which is how they are read.
CREATE INDEX IF NOT EXISTS analysis_runs_offering_idx
  ON analysis_runs (assignment_offering_id, started_at DESC);
CREATE INDEX IF NOT EXISTS analysis_runs_course_idx
  ON analysis_runs (course_offering_id, started_at DESC);

ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;

-- Read: any staff member of the offering. An instructor should be able to see that their
-- section was graded overnight without asking the director.
DROP POLICY IF EXISTS analysis_runs_read_staff ON analysis_runs;
CREATE POLICY analysis_runs_read_staff ON analysis_runs FOR SELECT TO authenticated
USING (course_offering_id IN (SELECT app.staff_offerings()));

-- No INSERT / UPDATE / DELETE policy, deliberately. Only the service tiers write here, and
-- they bypass RLS. An audit trail a signed-in user can append to is not an audit trail.

GRANT SELECT ON analysis_runs TO authenticated;
