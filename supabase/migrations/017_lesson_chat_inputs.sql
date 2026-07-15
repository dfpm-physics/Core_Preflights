-- Migration 017: Private lesson chat inputs + safe interaction attachment
-- ============================================================================
-- Implements the database portion of LESSON-CHAT-ACTION-CONTRACT.md:
--   * private, versioned Markdown input (one current row per lesson);
--   * course-scoped director/admin RLS;
--   * one owning lesson per interaction;
--   * atomic, optimistic-concurrency-safe attach/update/replace RPC.
--
-- ADDITIVE: creates a table, helper/trigger/RPC functions, policies, grants, and
-- one partial unique index on the existing lessons.interaction_id column. It does
-- not rewrite or delete existing rows. The unique-index preflight deliberately
-- stops with an actionable error if the live data already has duplicate owners.
--
-- Run AFTER migration 016 in the Supabase SQL Editor. Re-runnable.
-- Do not apply until the staged plan's user-owned database step is approved.
-- ============================================================================


-- digest(..., 'sha256') lives in pgcrypto. Supabase normally installs extensions
-- in this schema; IF NOT EXISTS leaves an existing installation untouched.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ============================================================================
-- MANAGER CHECK
-- Global admins and legacy directors retain their existing all-course behavior.
-- Newer course directors are limited to the course in instructor_course_access.
-- SECURITY DEFINER avoids instructor_course_access RLS recursion in policies.
-- ============================================================================
CREATE OR REPLACE FUNCTION lesson_chat_can_manage_course(p_course_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p_course_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM instructors i
        WHERE i.id = auth.uid()
          AND (i.is_global_admin = TRUE OR i.is_director = TRUE)
      )
      OR EXISTS (
        SELECT 1
        FROM instructor_course_access ica
        WHERE ica.instructor_id = auth.uid()
          AND ica.course_id = p_course_id
          AND ica.role = 'director'
      )
    );
$$;

REVOKE ALL ON FUNCTION lesson_chat_can_manage_course(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION lesson_chat_can_manage_course(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION lesson_chat_can_manage_course(TEXT) TO authenticated;


-- ============================================================================
-- ONE OWNER PER INTERACTION
-- Migration 016 permits a lesson to point at at most one interaction, but did not
-- prevent two lessons from pointing at the same interaction. Fail rather than
-- silently choosing an owner if duplicate live data exists.
-- ============================================================================
DO $$
DECLARE
  v_duplicates TEXT;
BEGIN
  SELECT string_agg(
           format('%s -> [%s]', d.interaction_id, array_to_string(d.lesson_ids, ', ')),
           '; '
         )
    INTO v_duplicates
  FROM (
    SELECT l.interaction_id, array_agg(l.id ORDER BY l.id) AS lesson_ids
    FROM lessons l
    WHERE l.interaction_id IS NOT NULL
    GROUP BY l.interaction_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'duplicate_interaction_owners',
      DETAIL = 'Resolve these lessons before applying migration 017: ' || v_duplicates;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_interaction_owner_uidx
  ON lessons (interaction_id)
  WHERE interaction_id IS NOT NULL;


-- ============================================================================
-- CURRENT LESSON CHAT INPUT
-- Markdown stays outside lessons because published lesson rows have a public
-- SELECT policy; RLS is row-level and would not keep a lessons column private.
-- ============================================================================
CREATE TABLE IF NOT EXISTS lesson_chat_inputs (
  lesson_id         TEXT PRIMARY KEY
                    REFERENCES lessons(id) ON DELETE CASCADE,
  markdown          TEXT NOT NULL,
  source_filename   TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  content_sha256    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID REFERENCES instructors(id) ON DELETE SET NULL,

  CONSTRAINT lesson_chat_inputs_markdown_nonblank
    CHECK (btrim(markdown) <> ''),
  CONSTRAINT lesson_chat_inputs_markdown_size
    CHECK (octet_length(markdown) <= 100000),
  CONSTRAINT lesson_chat_inputs_filename
    CHECK (
      source_filename IS NULL
      OR (
        btrim(source_filename) <> ''
        AND char_length(source_filename) <= 255
        AND source_filename !~ '[\\/]'
      )
    ),
  CONSTRAINT lesson_chat_inputs_version
    CHECK (version >= 1),
  CONSTRAINT lesson_chat_inputs_sha256
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE lesson_chat_inputs IS
  'Private current Markdown input used to guide the Custom GPT for one lesson.';
COMMENT ON COLUMN lesson_chat_inputs.version IS
  'Server-derived revision number; increments only when Markdown or filename changes.';


-- Derive version/checksum/timestamps. Client-supplied values cannot forge them.
CREATE OR REPLACE FUNCTION lesson_chat_inputs_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  NEW.source_filename := NULLIF(btrim(NEW.source_filename), '');

  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
    NEW.content_sha256 := encode(
      digest(convert_to(NEW.markdown, 'UTF8'), 'sha256'),
      'hex'
    );
    NEW.created_at := COALESCE(NEW.created_at, v_now);
    NEW.updated_at := v_now;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    RETURN NEW;
  END IF;

  IF NEW.lesson_id IS DISTINCT FROM OLD.lesson_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'lesson_input_identity_locked',
      DETAIL = 'lesson_chat_inputs.lesson_id cannot be changed; delete/recreate explicitly.';
  END IF;

  NEW.created_at := OLD.created_at;

  IF NEW.markdown IS DISTINCT FROM OLD.markdown
     OR NEW.source_filename IS DISTINCT FROM OLD.source_filename THEN
    NEW.version := OLD.version + 1;
    NEW.content_sha256 := encode(
      digest(convert_to(NEW.markdown, 'UTF8'), 'sha256'),
      'hex'
    );
    NEW.updated_at := v_now;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
  ELSE
    -- A no-op write cannot bump a revision or rewrite audit fields.
    NEW.version := OLD.version;
    NEW.content_sha256 := OLD.content_sha256;
    NEW.updated_at := OLD.updated_at;
    NEW.updated_by := OLD.updated_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lesson_chat_inputs_derive ON lesson_chat_inputs;
CREATE TRIGGER lesson_chat_inputs_derive
  BEFORE INSERT OR UPDATE ON lesson_chat_inputs
  FOR EACH ROW EXECUTE FUNCTION lesson_chat_inputs_before_write();


-- Required input cannot be cleared from a published lesson that currently uses
-- an interaction. Unpublish/change the lesson safely first; lesson cascade delete
-- is still allowed because the parent row is no longer visible to this lookup.
CREATE OR REPLACE FUNCTION lesson_chat_inputs_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_required BOOLEAN;
BEGIN
  SELECT (
           l.is_published = TRUE
           AND l.interaction_id IS NOT NULL
           AND l.completion_policy IN ('interaction', 'choice')
         )
    INTO v_required
  FROM lessons l
  WHERE l.id = OLD.lesson_id;

  IF COALESCE(v_required, FALSE) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'published_lesson_input_required',
      DETAIL = 'Unpublish the lesson or safely remove its interaction before clearing input.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS lesson_chat_inputs_guard_delete ON lesson_chat_inputs;
CREATE TRIGGER lesson_chat_inputs_guard_delete
  BEFORE DELETE ON lesson_chat_inputs
  FOR EACH ROW EXECUTE FUNCTION lesson_chat_inputs_before_delete();


-- ============================================================================
-- RLS + TABLE GRANTS
-- No anonymous/public read policy: only managers edit in the browser. Edge
-- retrieval later uses its server credential and still filters published lessons.
-- ============================================================================
ALTER TABLE lesson_chat_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lesson chat inputs: managers read" ON lesson_chat_inputs;
CREATE POLICY "lesson chat inputs: managers read"
  ON lesson_chat_inputs FOR SELECT TO authenticated
  USING (
    lesson_chat_can_manage_course((
      SELECT l.course_id FROM lessons l
      WHERE l.id = lesson_chat_inputs.lesson_id
    ))
  );

DROP POLICY IF EXISTS "lesson chat inputs: managers insert" ON lesson_chat_inputs;
CREATE POLICY "lesson chat inputs: managers insert"
  ON lesson_chat_inputs FOR INSERT TO authenticated
  WITH CHECK (
    lesson_chat_can_manage_course((
      SELECT l.course_id FROM lessons l
      WHERE l.id = lesson_chat_inputs.lesson_id
    ))
  );

DROP POLICY IF EXISTS "lesson chat inputs: managers update" ON lesson_chat_inputs;
CREATE POLICY "lesson chat inputs: managers update"
  ON lesson_chat_inputs FOR UPDATE TO authenticated
  USING (
    lesson_chat_can_manage_course((
      SELECT l.course_id FROM lessons l
      WHERE l.id = lesson_chat_inputs.lesson_id
    ))
  )
  WITH CHECK (
    lesson_chat_can_manage_course((
      SELECT l.course_id FROM lessons l
      WHERE l.id = lesson_chat_inputs.lesson_id
    ))
  );

DROP POLICY IF EXISTS "lesson chat inputs: managers delete" ON lesson_chat_inputs;
CREATE POLICY "lesson chat inputs: managers delete"
  ON lesson_chat_inputs FOR DELETE TO authenticated
  USING (
    lesson_chat_can_manage_course((
      SELECT l.course_id FROM lessons l
      WHERE l.id = lesson_chat_inputs.lesson_id
    ))
  );

REVOKE ALL ON TABLE lesson_chat_inputs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lesson_chat_inputs TO authenticated;
GRANT ALL ON TABLE lesson_chat_inputs TO service_role;


-- ============================================================================
-- ATOMIC EXISTING-LESSON ATTACH / UPDATE / REPLACE
-- The RPC validates all guards under row locks, then writes the interaction,
-- current input, and lesson pointer/policy in one transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION attach_interaction_to_lesson(
  p_lesson_id                  TEXT,
  p_course_id                  TEXT,
  p_interaction_id             TEXT,
  p_interaction_title          TEXT,
  p_interaction_description    TEXT,
  p_artifact_url               TEXT,
  p_markdown                   TEXT,
  p_source_filename            TEXT,
  p_expected_lesson_updated_at TIMESTAMPTZ,
  p_expected_interaction_id    TEXT,
  p_expected_input_version     INTEGER,
  p_confirm_replace            BOOLEAN
)
RETURNS TABLE (
  operation            TEXT,
  lesson_id            TEXT,
  course_id            TEXT,
  interaction_id       TEXT,
  completion_policy    TEXT,
  input_version        INTEGER,
  input_sha256         TEXT,
  lesson_updated_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_lesson               lessons%ROWTYPE;
  v_input_version        INTEGER;
  v_input_sha256         TEXT;
  v_incoming_owner       TEXT;
  v_interaction_course   TEXT;
  v_interaction_title    TEXT;
  v_source_filename      TEXT;
  v_new_policy           TEXT;
  v_operation            TEXT;
  v_new_lesson_updated   TIMESTAMPTZ;
  v_has_reports          BOOLEAN;
BEGIN
  -- Authentication/shape checks happen before any write. Keep messages stable so
  -- the faculty UI can map them to actionable errors.
  IF auth.uid() IS NULL OR NOT lesson_chat_can_manage_course(p_course_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'unauthorized',
      DETAIL = 'A director/admin for the target course is required.';
  END IF;

  IF p_lesson_id IS NULL OR p_lesson_id !~ '^[a-z0-9-]{1,100}$'
     OR p_interaction_id IS NULL OR p_interaction_id !~ '^[a-z0-9-]{1,100}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Lesson and interaction ids must be lowercase slugs (1-100 characters).';
  END IF;

  IF p_expected_lesson_updated_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'expected_lesson_updated_at is required for optimistic concurrency.';
  END IF;

  IF p_markdown IS NULL OR btrim(p_markdown) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Markdown input is required.';
  END IF;

  IF octet_length(p_markdown) > 100000 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'input_too_large',
      DETAIL = 'Markdown input exceeds 100000 UTF-8 bytes.';
  END IF;

  v_source_filename := NULLIF(btrim(p_source_filename), '');
  IF v_source_filename IS NOT NULL
     AND (char_length(v_source_filename) > 255 OR v_source_filename ~ '[\\/]') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'source_filename must be a basename of at most 255 characters.';
  END IF;

  IF p_artifact_url IS NULL
     OR char_length(p_artifact_url) > 2000
     OR p_artifact_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'artifact_url must be an absolute HTTPS URL of at most 2000 characters.';
  END IF;

  IF p_interaction_description IS NOT NULL
     AND char_length(p_interaction_description) > 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Interaction description exceeds 2000 characters.';
  END IF;

  -- Lock the destination; exact timestamp/id comparisons prevent a stale picker
  -- or another browser tab from overwriting a newer selection.
  SELECT l.*
    INTO v_lesson
  FROM lessons l
  WHERE l.id = p_lesson_id
  FOR UPDATE;

  IF NOT FOUND OR v_lesson.course_id IS DISTINCT FROM p_course_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'not_found',
      DETAIL = 'The target lesson was not found in the requested course.';
  END IF;

  IF v_lesson.updated_at IS DISTINCT FROM p_expected_lesson_updated_at
     OR v_lesson.interaction_id IS DISTINCT FROM p_expected_interaction_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'lesson_changed',
      DETAIL = 'The lesson changed after selection; reload it before saving.';
  END IF;

  v_input_version := NULL;
  SELECT lci.version
    INTO v_input_version
  FROM lesson_chat_inputs lci
  WHERE lci.lesson_id = p_lesson_id
  FOR UPDATE;

  IF v_input_version IS DISTINCT FROM p_expected_input_version THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'lesson_changed',
      DETAIL = 'The lesson input changed after selection; reload it before saving.';
  END IF;

  -- The unique index is the final backstop; this check gives the UI a stable,
  -- descriptive error before attempting the lesson update.
  v_incoming_owner := NULL;
  SELECT l.id
    INTO v_incoming_owner
  FROM lessons l
  WHERE l.interaction_id = p_interaction_id
    AND l.id <> p_lesson_id
  FOR UPDATE;

  IF v_incoming_owner IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'interaction_owned_elsewhere',
      DETAIL = format('Interaction %s is already attached to lesson %s.',
                      p_interaction_id, v_incoming_owner);
  END IF;

  -- Existing standalone interactions may be attached, but never across courses.
  v_interaction_course := NULL;
  SELECT i.course_id
    INTO v_interaction_course
  FROM interactions i
  WHERE i.id = p_interaction_id
  FOR UPDATE;

  IF v_interaction_course IS NOT NULL
     AND v_interaction_course IS DISTINCT FROM p_course_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'interaction_course_mismatch',
      DETAIL = 'The incoming interaction belongs to a different course.';
  END IF;

  IF v_lesson.interaction_id IS NULL THEN
    v_operation := 'add_interaction';
  ELSIF v_lesson.interaction_id = p_interaction_id THEN
    v_operation := 'update_interaction';
  ELSE
    -- Lock the current interaction before checking reports. A report insert takes
    -- a foreign-key key-share lock, so this closes the check/commit race.
    PERFORM 1
    FROM interactions i
    WHERE i.id = v_lesson.interaction_id
    FOR UPDATE;

    SELECT EXISTS (
      SELECT 1
      FROM preflight_interaction_reports pir
      WHERE pir.interaction_id = v_lesson.interaction_id
    ) INTO v_has_reports;

    IF v_has_reports THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001', MESSAGE = 'replacement_has_reports',
        DETAIL = 'The current interaction has student reports and cannot be replaced.';
    END IF;

    IF COALESCE(p_confirm_replace, FALSE) = FALSE THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001', MESSAGE = 'replacement_confirmation_required',
        DETAIL = 'Confirm replacement after reviewing the current and incoming ids.';
    END IF;

    v_operation := 'replace_interaction';
  END IF;

  v_interaction_title := COALESCE(NULLIF(btrim(p_interaction_title), ''), v_lesson.title);
  IF char_length(v_interaction_title) > 300 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Interaction title exceeds 300 characters.';
  END IF;

  -- Preserve the destination lesson's publication state and mirror it to the
  -- attached component, matching faculty-lessons.js toggle behavior.
  INSERT INTO interactions (
    id, course_id, title, description, artifact_url, is_published
  ) VALUES (
    p_interaction_id,
    p_course_id,
    v_interaction_title,
    NULLIF(btrim(p_interaction_description), ''),
    p_artifact_url,
    v_lesson.is_published
  )
  ON CONFLICT (id) DO UPDATE SET
    course_id = EXCLUDED.course_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    artifact_url = EXCLUDED.artifact_url,
    is_published = EXCLUDED.is_published;

  INSERT INTO lesson_chat_inputs (
    lesson_id, markdown, source_filename, updated_by
  ) VALUES (
    p_lesson_id, p_markdown, v_source_filename, auth.uid()
  )
  ON CONFLICT (lesson_id) DO UPDATE SET
    markdown = EXCLUDED.markdown,
    source_filename = EXCLUDED.source_filename,
    updated_by = auth.uid();

  SELECT lci.version, lci.content_sha256
    INTO v_input_version, v_input_sha256
  FROM lesson_chat_inputs lci
  WHERE lci.lesson_id = p_lesson_id;

  v_new_policy := CASE
    WHEN v_lesson.preflight_id IS NOT NULL THEN 'choice'
    ELSE 'interaction'
  END;

  UPDATE lessons AS l
  SET interaction_id = p_interaction_id,
      completion_policy = v_new_policy
  WHERE l.id = p_lesson_id
  RETURNING l.updated_at INTO v_new_lesson_updated;

  RETURN QUERY
  SELECT
    v_operation,
    p_lesson_id,
    p_course_id,
    p_interaction_id,
    v_new_policy,
    v_input_version,
    v_input_sha256,
    v_new_lesson_updated;
END;
$$;

COMMENT ON FUNCTION attach_interaction_to_lesson(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TEXT, INTEGER, BOOLEAN
) IS
  'Atomically add/update/replace a lesson interaction and private Markdown input with safety guards.';

REVOKE ALL ON FUNCTION attach_interaction_to_lesson(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TEXT, INTEGER, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION attach_interaction_to_lesson(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TEXT, INTEGER, BOOLEAN
) FROM anon;
GRANT EXECUTE ON FUNCTION attach_interaction_to_lesson(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TEXT, INTEGER, BOOLEAN
) TO authenticated;
