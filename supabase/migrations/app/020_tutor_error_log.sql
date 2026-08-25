-- PREP v2 -- a durable record of every tutor failure a cadet actually hit
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
--
-- WHY THIS EXISTS
--   The Gemini backup lessons talk to Google with the cadet's own free-tier key, from a
--   standalone page with no login and no Supabase client. When that conversation fails, the
--   only record has been the cadet's memory of it. Two instructors independently reported
--   the same thing in August 2026 -- "lots and lots of students getting an error midway
--   through the conversation, I am collecting a list of names after class" -- which is the
--   course paying a human to be a log file, badly.
--
--   Worse, the population that matters most is invisible. A cadet who hits an error and
--   gives up never submits, so nothing about their session reaches this database at all.
--   Every diagnosis so far has therefore been built from the survivors.
--
-- WHY IT IS WRITTEN BY AN EDGE FUNCTION AND NOT BY THE PAGE
--   The page is unauthenticated by design: a cadet launches it from a link and types a cadet
--   ID. Giving `anon` an INSERT policy here would put an open, unvalidated write endpoint on
--   a live table. `log-tutor-error` takes the anon key, validates the shape, caps every
--   field, drops anything it was not expecting, and writes with the service role. So the
--   table has NO write policy at all -- same posture as analysis_runs.
--
-- WHAT IT DELIBERATELY CANNOT HOLD
--   No conversation text. Not the cadet's messages, not the tutor's replies, not the report.
--   CORE.md §3 permits a cadet ID and a score and bars free-text student writing paired with
--   an identity, and this table sits on the wrong side of that line by construction rather
--   than by discipline: the columns are counters, enums, model names and integers, and the
--   edge function builds its insert from a whitelist. There is nowhere to put a sentence.
--
--   `detail` is the one free-text column and it holds GOOGLE's error message, capped at 300
--   characters, never anything the cadet typed.
--
-- WHY cadet_id IS NOT A FOREIGN KEY
--   It is typed by a cadet on an unauthenticated page, so it is a claim, not an identity. A
--   foreign key would reject a typo'd ID -- and a typo'd ID on a failing session is itself a
--   thing worth seeing. Join to students when you need the roster; expect misses.
--
-- WHY EVERY STAFF MEMBER READS EVERY ROW
--   Asked for explicitly: instructors, directors and admins. A tutor failure is not student
--   work and carries no grade, and the useful question -- "is lesson 14 failing for everyone
--   or just my section?" -- cannot be answered from a per-section slice.

CREATE TABLE IF NOT EXISTS tutor_error_log (
  id             bigserial PRIMARY KEY,
  logged_at      timestamptz NOT NULL DEFAULT now(),

  -- Which lesson, and who says they were taking it.
  slug           text        NOT NULL,
  cadet_id       bigint,                        -- a CLAIM; see above. NULL before sign-in.

  -- What went wrong.
  kind           text        NOT NULL,          -- auth|quota|model|timeout|empty|capacity|...
  http_status    int         NOT NULL DEFAULT 0,
  finish_reason  text,                          -- MAX_TOKENS, SAFETY, RECITATION, ...
  detail         text,                          -- GOOGLE's message, <=300 chars

  -- Where in the session, and on what.
  model          text,
  mode           text,                          -- graded | study
  phase          text,                          -- opening | chat | report | extension
  turn           int         NOT NULL DEFAULT 0,
  session_sec    int         NOT NULL DEFAULT 0,
  ladder_resets  int         NOT NULL DEFAULT 0,
  max_tokens     int,
  thinking_budget int,                          -- -1 means the model rejected the field

  -- Per-model counters: calls, ok, fail, failure kinds, and prompt/thinking/output tokens.
  -- jsonb because the model set changes with the ladder and a column per model would be a
  -- migration every time Google ships one.
  models         jsonb       NOT NULL DEFAULT '[]'::jsonb,

  client         text                           -- user agent, capped
);

COMMENT ON TABLE tutor_error_log IS
  'One row per tutor request failure a cadet actually saw, written by the log-tutor-error '
  'edge function. Contains no conversation text by construction (CORE.md section 3).';

-- The three questions this table gets asked: what is failing right now, is one lesson
-- worse than the others, and did this particular cadet hit something.
CREATE INDEX IF NOT EXISTS tutor_error_log_at_idx   ON tutor_error_log (logged_at DESC);
CREATE INDEX IF NOT EXISTS tutor_error_log_slug_idx ON tutor_error_log (slug, logged_at DESC);
CREATE INDEX IF NOT EXISTS tutor_error_log_cadet_idx
  ON tutor_error_log (cadet_id, logged_at DESC) WHERE cadet_id IS NOT NULL;

ALTER TABLE tutor_error_log ENABLE ROW LEVEL SECURITY;

-- READ: every staff member, no offering filter. See the header.
DROP POLICY IF EXISTS tel_read_staff ON tutor_error_log;
CREATE POLICY tel_read_staff ON tutor_error_log
  FOR SELECT TO authenticated
  USING (is_staff());

-- NO WRITE POLICY, deliberately. The edge function holds the service role and BYPASSRLS;
-- `authenticated` must not be able to forge or delete a failure record, and `anon` must not
-- be able to reach the table at all except through the validating function.

GRANT SELECT ON tutor_error_log TO authenticated;
