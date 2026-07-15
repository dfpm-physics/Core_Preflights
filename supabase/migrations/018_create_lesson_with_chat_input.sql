-- Migration 018: Atomic generated-lesson creation
-- ============================================================================
-- ADDITIVE: creates one RPC function plus its grants. It does not alter tables,
-- policies, indexes, or existing rows. Run AFTER migrations 016 and 017.
-- Re-runnable.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_lesson_with_interaction(
  p_lesson_id               TEXT,
  p_course_id               TEXT,
  p_lesson_title            TEXT,
  p_lesson_description      TEXT,
  p_lesson_number           INTEGER,
  p_completion_policy       TEXT,
  p_objectives              JSONB,
  p_points                  SMALLINT,
  p_due_date_m              TIMESTAMPTZ,
  p_due_date_t              TIMESTAMPTZ,
  p_is_published            BOOLEAN,
  p_preflight_questions     JSONB,
  p_interaction_id          TEXT,
  p_interaction_title       TEXT,
  p_interaction_description TEXT,
  p_artifact_url            TEXT,
  p_markdown                TEXT,
  p_source_filename         TEXT
)
RETURNS TABLE (
  operation         TEXT,
  lesson_id         TEXT,
  course_id         TEXT,
  interaction_id    TEXT,
  completion_policy TEXT,
  input_version     INTEGER,
  input_sha256      TEXT,
  lesson_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_interaction_course TEXT;
  v_owner              TEXT;
  v_input_version      INTEGER;
  v_input_sha256       TEXT;
  v_lesson_updated_at  TIMESTAMPTZ;
  v_interaction_title  TEXT;
  v_source_filename    TEXT;
  v_preflight_id       TEXT;
BEGIN
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

  IF p_course_id IS NULL OR btrim(p_course_id) = '' OR char_length(p_course_id) > 100
     OR p_lesson_title IS NULL OR btrim(p_lesson_title) = ''
     OR char_length(p_lesson_title) > 300
     OR (p_lesson_description IS NOT NULL
         AND char_length(p_lesson_description) > 2000)
     OR (p_lesson_number IS NOT NULL AND p_lesson_number < 0)
     OR p_points IS NULL OR p_points < 0
     OR p_completion_policy IS NULL
     OR p_completion_policy NOT IN ('interaction', 'choice') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Invalid generated lesson metadata.';
  END IF;

  IF p_objectives IS NULL OR jsonb_typeof(p_objectives) <> 'array'
     OR jsonb_array_length(p_objectives) > 20
     OR octet_length(p_objectives::TEXT) > 20000 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'objectives must be a JSON array with at most 20 items.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_objectives) AS item(value)
    WHERE jsonb_typeof(value) <> 'object'
       OR COALESCE(value->>'key', '') !~ '^[a-z0-9-]{1,100}$'
       OR char_length(COALESCE(value->>'label', '')) > 300
  ) OR EXISTS (
    SELECT value->>'key'
    FROM jsonb_array_elements(p_objectives) AS item(value)
    GROUP BY value->>'key'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Objective keys must be unique lowercase slugs and labels must be at most 300 characters.';
  END IF;

  IF p_completion_policy = 'choice'
     AND (
       p_preflight_questions IS NULL
       OR jsonb_typeof(p_preflight_questions) <> 'array'
       OR jsonb_array_length(p_preflight_questions) = 0
       OR octet_length(p_preflight_questions::TEXT) > 100000
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Choice lessons require a nonempty preflight question array.';
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
     AND (
       char_length(v_source_filename) > 255
       OR position('/' IN v_source_filename) > 0
       OR position(chr(92) IN v_source_filename) > 0
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'source_filename must be a basename of at most 255 characters.';
  END IF;

  IF p_artifact_url IS NULL
     OR char_length(p_artifact_url) > 2000
     OR p_artifact_url !~ '^https://[^[:space:]]+$'
     OR (p_interaction_description IS NOT NULL
         AND char_length(p_interaction_description) > 2000) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Invalid interaction URL or description.';
  END IF;

  v_interaction_title := COALESCE(NULLIF(btrim(p_interaction_title), ''), btrim(p_lesson_title));
  IF char_length(v_interaction_title) > 300 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'invalid_request',
      DETAIL = 'Interaction title exceeds 300 characters.';
  END IF;

  -- Existing ids are locked before ownership checks. New ids remain protected by
  -- their primary keys and the unique lesson interaction-owner index.
  PERFORM 1 FROM lessons WHERE id = p_lesson_id FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'lesson_exists',
      DETAIL = 'That lesson id already exists.';
  END IF;

  v_interaction_course := NULL;
  SELECT i.course_id INTO v_interaction_course
  FROM interactions i
  WHERE i.id = p_interaction_id
  FOR UPDATE;

  IF v_interaction_course IS NOT NULL
     AND v_interaction_course IS DISTINCT FROM p_course_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'interaction_course_mismatch',
      DETAIL = 'The incoming interaction belongs to a different course.';
  END IF;

  v_owner := NULL;
  SELECT l.id INTO v_owner
  FROM lessons l
  WHERE l.interaction_id = p_interaction_id
  FOR UPDATE;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'interaction_owned_elsewhere',
      DETAIL = format('Interaction %s is already attached to lesson %s.',
                      p_interaction_id, v_owner);
  END IF;

  IF p_completion_policy = 'choice' THEN
    PERFORM 1 FROM assignments WHERE id = p_lesson_id FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001', MESSAGE = 'lesson_component_id_conflict',
        DETAIL = 'An assignment already uses the generated lesson id.';
    END IF;
  END IF;

  INSERT INTO interactions (
    id, course_id, title, description, artifact_url, is_published
  ) VALUES (
    p_interaction_id, p_course_id, v_interaction_title,
    NULLIF(btrim(p_interaction_description), ''), p_artifact_url,
    COALESCE(p_is_published, FALSE)
  )
  ON CONFLICT (id) DO UPDATE SET
    course_id = EXCLUDED.course_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    artifact_url = EXCLUDED.artifact_url,
    is_published = EXCLUDED.is_published;

  v_preflight_id := NULL;
  IF p_completion_policy = 'choice' THEN
    v_preflight_id := p_lesson_id;
    INSERT INTO assignments (
      id, course_id, title, description, questions,
      due_date, due_date_m, due_date_t, is_published
    ) VALUES (
      p_lesson_id, p_course_id, btrim(p_lesson_title),
      NULLIF(btrim(p_lesson_description), ''), p_preflight_questions,
      COALESCE(p_due_date_m, p_due_date_t, NOW()),
      p_due_date_m, p_due_date_t, COALESCE(p_is_published, FALSE)
    );
  END IF;

  INSERT INTO lessons (
    id, course_id, title, description, lesson_number,
    preflight_id, interaction_id, completion_policy,
    objectives, points, due_date_m, due_date_t, is_published
  ) VALUES (
    p_lesson_id, p_course_id, btrim(p_lesson_title),
    NULLIF(btrim(p_lesson_description), ''), p_lesson_number,
    v_preflight_id, p_interaction_id, p_completion_policy,
    p_objectives, p_points, p_due_date_m, p_due_date_t,
    COALESCE(p_is_published, FALSE)
  )
  RETURNING updated_at INTO v_lesson_updated_at;

  INSERT INTO lesson_chat_inputs (
    lesson_id, markdown, source_filename, updated_by
  ) VALUES (
    p_lesson_id, p_markdown, v_source_filename, auth.uid()
  );

  SELECT lci.version, lci.content_sha256
    INTO v_input_version, v_input_sha256
  FROM lesson_chat_inputs lci
  WHERE lci.lesson_id = p_lesson_id;

  RETURN QUERY SELECT
    'create_lesson'::TEXT,
    p_lesson_id,
    p_course_id,
    p_interaction_id,
    p_completion_policy,
    v_input_version,
    v_input_sha256,
    v_lesson_updated_at;
END;
$$;

COMMENT ON FUNCTION create_lesson_with_interaction(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, SMALLINT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'Atomically creates a generated lesson, interaction, optional preflight, and private Markdown input.';

REVOKE ALL ON FUNCTION create_lesson_with_interaction(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, SMALLINT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_lesson_with_interaction(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, SMALLINT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION create_lesson_with_interaction(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, SMALLINT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
