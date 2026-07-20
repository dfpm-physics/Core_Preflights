-- PREP v2 — freeze what each cohort actually saw, at term close
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql and 003_term_calendar.sql.
--
-- WHY
--   An interactive activity is a slug plus an artifact URL. When the artifact is rebuilt for
--   a later term, the intended workflow is to UPDATE that URL in place — the slug identifies
--   the lesson, not the particular build, so one slug serves the lesson forever and no slug
--   proliferation occurs.
--
--   The cost of overwriting is that "what did Fall 2026 students actually run?" becomes
--   unanswerable. assignment_offerings.content_snapshot exists to prevent that, but nothing
--   populated it. This migration makes it real.
--
-- WHEN
--   At term close, not at publish. Publishing can toggle more than once and is not the moment
--   the record should harden; the end of the term is. terms.grades_due_on is the natural
--   trigger date.
--
-- IMMUTABILITY
--   Once content_snapshot_frozen_at is set, a trigger refuses any change to content_snapshot.
--   Re-freezing is possible but must be deliberate: clear the stamp first, in its own
--   statement. freeze_assignment_offering(..., p_force => true) does exactly that, so an
--   accidental overwrite is impossible while an intentional correction stays available.
--
-- SECURITY INVOKER (the default) on purpose: the caller's RLS applies, so a director can
-- freeze the offerings they direct and nobody else can. No separate authorisation logic.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

ALTER TABLE assignment_offerings
  ADD COLUMN content_snapshot_frozen_at timestamptz;

COMMENT ON COLUMN assignment_offerings.content_snapshot_frozen_at IS
  'When the snapshot was frozen. NULL = not yet frozen and still tracking live content. '
  'Non-NULL makes content_snapshot immutable (see assignment_offerings_snapshot_guard).';

COMMENT ON COLUMN assignment_offerings.content_snapshot IS
  'What this cohort actually saw: the activities and their content, roles, points and '
  'deadlines, captured at term close. This is what lets an artifact URL be safely overwritten '
  'for the next term without erasing the record of the previous one.';


-- ---------------------------------------------------------------------------
-- Immutability guard
-- ---------------------------------------------------------------------------
CREATE FUNCTION assignment_offerings_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.content_snapshot_frozen_at IS NOT NULL
     AND NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot THEN
    RAISE EXCEPTION
      'content_snapshot for assignment_offering % is frozen (since %). To correct it, clear '
      'content_snapshot_frozen_at in its own statement first.',
      OLD.id, OLD.content_snapshot_frozen_at;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER assignment_offerings_snapshot_guard
  BEFORE UPDATE ON assignment_offerings
  FOR EACH ROW EXECUTE FUNCTION assignment_offerings_snapshot_guard();


-- ---------------------------------------------------------------------------
-- Freeze one offering
-- ---------------------------------------------------------------------------
CREATE FUNCTION freeze_assignment_offering(p_ao uuid, p_force boolean DEFAULT false)
  RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  already timestamptz;
  snap    jsonb;
BEGIN
  SELECT content_snapshot_frozen_at INTO already
    FROM assignment_offerings WHERE id = p_ao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_offering % not found', p_ao;
  END IF;

  IF already IS NOT NULL THEN
    IF NOT p_force THEN
      RAISE EXCEPTION 'assignment_offering % already frozen at %', p_ao, already;
    END IF;
    -- Deliberate re-freeze: clear the stamp in its own statement so the guard stands down.
    UPDATE assignment_offerings SET content_snapshot_frozen_at = NULL WHERE id = p_ao;
  END IF;

  SELECT jsonb_build_object(
    'schema',          1,
    'frozen_at',       now(),
    'term',            jsonb_build_object('code', t.code, 'label', t.label,
                                          'starts_on', t.starts_on, 'ends_on', t.ends_on),
    'course',          jsonb_build_object('code', c.code, 'title', c.title),
    'assignment',      jsonb_build_object('slug', a.slug, 'title', a.title,
                                          'kind', a.kind_id, 'description', a.description,
                                          'objectives', a.objectives),
    'points_possible', ao.points_possible,
    'grading_mode',    ao.grading_mode,
    'switch_policy',   ao.switch_policy,
    'is_published',    ao.is_published,
    'due_at',          ao.due_at,
    'section_due_dates', coalesce((
        SELECT jsonb_agg(jsonb_build_object('section', s.code, 'due_at', d.due_at)
                         ORDER BY s.code)
          FROM assignment_due_dates d
          JOIN sections s ON s.id = d.section_id
         WHERE d.assignment_offering_id = ao.id), '[]'::jsonb),
    'activities', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'slug',            act.slug,
                 'modality',        act.modality,
                 'title',           act.title,
                 'grading_role',    oa.grading_role,
                 'available_after', oa.available_after,
                 'is_visible',      oa.is_visible,
                 'content',         act.content)
                 ORDER BY oa.position, act.slug)
          FROM offering_activities oa
          JOIN activities act ON act.id = oa.activity_id
         WHERE oa.assignment_offering_id = ao.id), '[]'::jsonb)
  ) INTO snap
    FROM assignment_offerings ao
    JOIN assignments a       ON a.id  = ao.assignment_id
    JOIN course_offerings co ON co.id = ao.course_offering_id
    JOIN courses c           ON c.id  = co.course_id
    JOIN terms t             ON t.id  = co.term_id
   WHERE ao.id = p_ao;

  UPDATE assignment_offerings
     SET content_snapshot = snap,
         content_snapshot_frozen_at = now()
   WHERE id = p_ao;

  RETURN snap;
END; $$;

COMMENT ON FUNCTION freeze_assignment_offering(uuid, boolean) IS
  'Capture what this offering''s cohort actually saw, and make it immutable. Call at term '
  'close. p_force re-freezes an already-frozen offering (clears the stamp first).';


-- ---------------------------------------------------------------------------
-- Freeze a whole term
-- ---------------------------------------------------------------------------
CREATE FUNCTION freeze_term(p_term_code text, p_force boolean DEFAULT false)
  RETURNS TABLE(course text, assignment text, outcome text) LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT ao.id, c.code AS course_code, a.slug AS assignment_slug,
           ao.content_snapshot_frozen_at AS frozen
      FROM assignment_offerings ao
      JOIN assignments a       ON a.id  = ao.assignment_id
      JOIN course_offerings co ON co.id = ao.course_offering_id
      JOIN courses c           ON c.id  = co.course_id
      JOIN terms t             ON t.id  = co.term_id
     WHERE t.code = p_term_code
     ORDER BY c.code, a.slug
  LOOP
    course := r.course_code;
    assignment := r.assignment_slug;
    IF r.frozen IS NOT NULL AND NOT p_force THEN
      outcome := 'skipped — already frozen at ' || r.frozen::date;
    ELSE
      PERFORM freeze_assignment_offering(r.id, p_force);
      outcome := CASE WHEN r.frozen IS NULL THEN 'frozen' ELSE 're-frozen' END;
    END IF;
    RETURN NEXT;
  END LOOP;
END; $$;

COMMENT ON FUNCTION freeze_term(text, boolean) IS
  'Freeze every assignment offering in a term. Idempotent: already-frozen offerings are '
  'skipped unless p_force. Intended to run once at or after terms.grades_due_on.';


-- ---------------------------------------------------------------------------
-- Which terms are due to be frozen?
-- ---------------------------------------------------------------------------
CREATE VIEW terms_awaiting_freeze AS
  SELECT t.code, t.label, t.ends_on, t.grades_due_on,
         count(ao.id)                                        AS offerings,
         count(ao.content_snapshot_frozen_at)                AS frozen,
         count(ao.id) - count(ao.content_snapshot_frozen_at) AS unfrozen,
         (t.grades_due_on IS NOT NULL AND t.grades_due_on < current_date) AS past_due
    FROM terms t
    JOIN course_offerings co     ON co.term_id = t.id
    JOIN assignment_offerings ao ON ao.course_offering_id = co.id
   GROUP BY t.id, t.code, t.label, t.ends_on, t.grades_due_on
  HAVING count(ao.id) > count(ao.content_snapshot_frozen_at);

COMMENT ON VIEW terms_awaiting_freeze IS
  'Terms with offerings not yet frozen. past_due = the grades deadline has passed and the '
  'record should already have been sealed.';

COMMIT;
