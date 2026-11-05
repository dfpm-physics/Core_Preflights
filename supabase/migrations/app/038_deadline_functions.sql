-- PREP v2 -- one deadline rule, in the database
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 005_extensions.sql (extensions), 017_due_by_day.sql
-- (assignment_offerings.due_by_day) and 003_term_calendar.sql (terms.ends_on). It reads no column that 026 to 037 add.
-- It does NOT depend on 023_instructors_admin_flag_guard.sql.
-- Requires Postgres 16 or later: pg_input_is_valid() is new in 16. Staging is 17.6; confirm production before applying.
-- Design: docs/decisions/V2-DATA-MODEL.md section 8.
--
-- THE RULE, IN ORDER   `source` uses the site's own names.
--   1 extension  an active row in `extensions` (revoked_at IS NULL)
--   2 section    a row in assignment_due_dates for (item, section)
--   3 day        due_by_day: the FIRST entry of sections.meeting_days, IN ARRAY ORDER, that has a non-empty value
--   4 offering   due_at
--   5 none       none of them, or a day value that is not a valid date. A stored day value that no meeting day of
--                the section reaches (and no due_at) is flagged invalid too.
--   is_past = now() - due_at > interval '120 seconds'  (the fifth copy of the grace period; schema.js GRACE_MS is another)
--
-- THREE DETAILS THAT MATCH site/js/schema.js EXACTLY  (each is a test vector)
--   * Tier 3 uses nullif(due_by_day ->> day, ''): a JSON null or an empty string falls to the next day.
--   * An unparsable tier 3 value gives `none`; it does NOT fall through to due_at (schema.js does not either). The test
--     is a whole-string shape (a date, or a date and time WITH a zone: Z or an offset) and then pg_input_is_valid, because
--     that function alone would accept `now`, `today`, `infinity`, a trailing `BC` and a named zone, which JavaScript
--     rejects. A date and time with NO zone is also refused: the site would read it in the browser's zone and the
--     database in UTC, seven hours apart in Denver, so it is flagged as unusable instead of being read two ways.
--   * Comparison is at MILLISECOND precision, because that is all JavaScript holds: every returned instant is truncated to
--     milliseconds. The functions pin timezone = 'UTC' so a date-only value means what JavaScript takes it to mean.
--
-- THE FUNCTIONS
--   _scheduled_core(item, section)     internal: tiers 2 to 5, and a flag saying an unusable day value exists
--   scheduled_deadline(item, section)  due_at, source. SECURITY DEFINER; returns a row only for a section the caller may
--                                      see (staff) or sits in (a student).
--   effective_deadline(enrollment, item)  due_at, source, is_past. SECURITY DEFINER, same rule: only the caller's own
--                                      enrollment or one in a section the caller may see.
--   deadline_rows(course_offering)     internal: the same rule, set-based, for every enrollment and item of an offering.
--                                      No caller check, so no web-facing grant.
--   release_at(item, section)          opens_at when set, else seven days before the SCHEDULED deadline (never the
--                                      extended one), floored to the start of the day in America/Denver. Same guard.
--   late_close_at(course_offering)     the last instant of terms.ends_on in America/Denver (the last class day).
--
-- GRANTS   scheduled_deadline, effective_deadline and release_at: NONE at step 1 (step 2 grants authenticated).
--          The internal functions: prep_app_read only, for the proof scripts.
-- THE CURRENT SITE   Nothing calls these at step 1. Step 2 moves the pages over.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- pg_input_is_valid() is new in Postgres 16. On an older server the functions would be created and then fail on the
-- first day value, so refuse here, before anything is created.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION '038 needs Postgres 16 or later (pg_input_is_valid); this server is %. Nothing was changed.',
      current_setting('server_version');
  END IF;
END $$;

-- ---- the scheduled rule (tiers 2 to 5) ------------------------------------------------------------
CREATE FUNCTION _scheduled_core(p_assignment_offering uuid, p_section uuid)
RETURNS TABLE (due_at timestamptz, source text, invalid boolean)
LANGUAGE plpgsql
STABLE
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_due     timestamptz;
  v_by_day  jsonb;
  v_offer   timestamptz;
  v_days    text[];
  v_day     text;
  v_val     text;
BEGIN
  SELECT ao.due_at, ao.due_by_day INTO v_offer, v_by_day
    FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2: an explicit row for this section
  SELECT d.due_at INTO v_due
    FROM assignment_due_dates d
   WHERE d.assignment_offering_id = p_assignment_offering AND d.section_id = p_section;
  IF FOUND AND v_due IS NOT NULL THEN
    due_at := date_trunc('milliseconds', v_due); source := 'section'; invalid := false;
    RETURN NEXT; RETURN;
  END IF;

  -- 3: the first meeting day, in array order, that carries a non-empty value
  SELECT s.meeting_days INTO v_days FROM sections s WHERE s.id = p_section;
  FOREACH v_day IN ARRAY coalesce(v_days, ARRAY[]::text[]) LOOP
    v_val := nullif(v_by_day ->> v_day, '');
    IF v_val IS NOT NULL THEN
      IF v_val ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?))?$'
         AND pg_input_is_valid(v_val, 'timestamptz') THEN
        due_at := date_trunc('milliseconds', v_val::timestamptz); source := 'day'; invalid := false;
      ELSE
        due_at := NULL; source := 'none'; invalid := true;       -- does not fall through to due_at
      END IF;
      RETURN NEXT; RETURN;
    END IF;
  END LOOP;

  -- 4: the offering's own date
  IF v_offer IS NOT NULL THEN
    due_at := date_trunc('milliseconds', v_offer); source := 'offering'; invalid := false;
    RETURN NEXT; RETURN;
  END IF;

  -- 5: nothing. A stored per-day value that no meeting day of this section reaches is a stored value with
  -- source none, so it is flagged (section 7), not silently treated as "no deadline".
  due_at := NULL; source := 'none';
  invalid := EXISTS (SELECT 1 FROM jsonb_each_text(v_by_day) e WHERE nullif(e.value, '') IS NOT NULL);
  RETURN NEXT;
END; $$;

-- ---- the one-enrollment rule (tier 1, then the scheduled rule) -----------------------------------------
CREATE FUNCTION _effective_core(p_enrollment uuid, p_assignment_offering uuid)
RETURNS TABLE (due_at timestamptz, source text, is_past boolean, invalid boolean)
LANGUAGE plpgsql
STABLE
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_ext     timestamptz;
  v_section uuid;
  c         record;
BEGIN
  SELECT x.extended_due_at INTO v_ext
    FROM extensions x
   WHERE x.enrollment_id = p_enrollment
     AND x.assignment_offering_id = p_assignment_offering
     AND x.revoked_at IS NULL;
  IF FOUND AND v_ext IS NOT NULL THEN
    due_at := date_trunc('milliseconds', v_ext); source := 'extension'; invalid := false;
    is_past := (now() - due_at) > interval '120 seconds';
    RETURN NEXT; RETURN;
  END IF;

  SELECT e.section_id INTO v_section FROM enrollments e WHERE e.id = p_enrollment;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  FOR c IN SELECT * FROM _scheduled_core(p_assignment_offering, v_section) LOOP
    due_at := c.due_at; source := c.source; invalid := c.invalid;
    is_past := c.due_at IS NOT NULL AND (now() - c.due_at) > interval '120 seconds';
    RETURN NEXT;
  END LOOP;
END; $$;

-- ---- the set-based rule, for the total rule -----------------------------------------------------------
CREATE FUNCTION deadline_rows(p_course_offering uuid)
RETURNS TABLE (enrollment_id uuid, assignment_offering_id uuid, due_at timestamptz, source text,
               is_past boolean, invalid boolean)
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
  WITH sched AS (
    SELECT ao.id AS ao_id, s.id AS sec_id, c.due_at, c.source, c.invalid
      FROM assignment_offerings ao
      JOIN sections s ON s.course_offering_id = ao.course_offering_id
      CROSS JOIN LATERAL _scheduled_core(ao.id, s.id) c
     WHERE ao.course_offering_id = p_course_offering),
  pick AS (
    SELECT e.id AS enr_id, sc.ao_id,
           CASE WHEN x.id IS NOT NULL THEN date_trunc('milliseconds', x.extended_due_at) ELSE sc.due_at END AS d_at,
           CASE WHEN x.id IS NOT NULL THEN 'extension' ELSE sc.source END AS d_src,
           CASE WHEN x.id IS NOT NULL THEN false ELSE sc.invalid END AS d_inv
      FROM enrollments e
      JOIN sched sc ON sc.sec_id = e.section_id
      LEFT JOIN extensions x ON x.enrollment_id = e.id AND x.assignment_offering_id = sc.ao_id
                            AND x.revoked_at IS NULL)
  SELECT p.enr_id, p.ao_id, p.d_at, p.d_src,
         p.d_at IS NOT NULL AND (now() - p.d_at) > interval '120 seconds',
         p.d_inv
    FROM pick p;
$$;

-- ---- scheduled_deadline: a section the caller may see, or sits in ------------------------------------------
CREATE FUNCTION scheduled_deadline(p_assignment_offering uuid, p_section uuid)
RETURNS TABLE (due_at timestamptz, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sections s JOIN assignment_offerings ao ON ao.course_offering_id = s.course_offering_id
              WHERE s.id = p_section AND ao.id = p_assignment_offering)
     AND (p_section IN (SELECT staff_sections())
          OR p_section IN (SELECT e.section_id FROM enrollments e WHERE e.id IN (SELECT my_enrollments()))) THEN
    RETURN QUERY SELECT c.due_at, c.source FROM _scheduled_core(p_assignment_offering, p_section) c;
  END IF;
END; $$;

-- ---- effective_deadline: the caller's own enrollment, or one in a section the caller may see ---------------
CREATE FUNCTION effective_deadline(p_enrollment uuid, p_assignment_offering uuid)
RETURNS TABLE (due_at timestamptz, source text, is_past boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM enrollments e
               JOIN sections s ON s.id = e.section_id
               JOIN assignment_offerings ao ON ao.course_offering_id = s.course_offering_id
              WHERE e.id = p_enrollment AND ao.id = p_assignment_offering)
     AND (p_enrollment IN (SELECT my_enrollments())
          OR EXISTS (SELECT 1 FROM enrollments e
                      WHERE e.id = p_enrollment AND e.section_id IN (SELECT staff_sections()))) THEN
    RETURN QUERY SELECT c.due_at, c.source, c.is_past FROM _effective_core(p_enrollment, p_assignment_offering) c;
  END IF;
END; $$;

-- ---- release_at: when the item appears to a student of a section --------------------------------------------
CREATE FUNCTION release_at(p_assignment_offering uuid, p_section uuid) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE
  v_opens timestamptz;
  v_due   timestamptz;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM sections s JOIN assignment_offerings ao ON ao.course_offering_id = s.course_offering_id
                   WHERE s.id = p_section AND ao.id = p_assignment_offering)
          AND (p_section IN (SELECT staff_sections())
               OR p_section IN (SELECT e.section_id FROM enrollments e WHERE e.id IN (SELECT my_enrollments())))) THEN
    RETURN NULL;
  END IF;
  SELECT ao.opens_at INTO v_opens FROM assignment_offerings ao WHERE ao.id = p_assignment_offering;
  IF v_opens IS NOT NULL THEN
    RETURN v_opens;                       -- explicit wins, earlier or later, at the exact instant
  END IF;
  SELECT c.due_at INTO v_due FROM _scheduled_core(p_assignment_offering, p_section) c;
  IF v_due IS NULL THEN
    RETURN NULL;
  END IF;
  -- seven days before the SCHEDULED deadline (never the extended one), floored to the start of that day in Denver
  RETURN date_trunc('day', (v_due - interval '7 days') AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver';
END; $$;

-- ---- late_close_at: the last class day of the term, to its last instant ------------------------------------------
CREATE FUNCTION late_close_at(p_course_offering uuid) RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  SELECT ((t.ends_on + 1)::timestamp - interval '1 microsecond') AT TIME ZONE 'America/Denver'
    FROM course_offerings co JOIN terms t ON t.id = co.term_id
   WHERE co.id = p_course_offering AND t.ends_on IS NOT NULL;
$$;

COMMENT ON FUNCTION scheduled_deadline(uuid, uuid) IS
  'The scheduled deadline for a section: section row, then first meeting day with a value (array order), then due_at, '
  'else none. Never an extension. Returns a row only for a section the caller sees.';
COMMENT ON FUNCTION effective_deadline(uuid, uuid) IS
  'The deadline that applies to one enrollment: an active extension, else the scheduled deadline. is_past carries the '
  '120 second grace. Returns a row only for the caller''s own enrollment or one in a section the caller may see.';
COMMENT ON FUNCTION late_close_at(uuid) IS
  'The last instant of terms.ends_on (the last class day) in America/Denver. Work after it is refused; cells return late_closed.';

-- ---- grants: by name -----------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _scheduled_core(uuid, uuid)       FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _effective_core(uuid, uuid)       FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION deadline_rows(uuid)               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION scheduled_deadline(uuid, uuid)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION effective_deadline(uuid, uuid)    FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION release_at(uuid, uuid)            FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION late_close_at(uuid)               FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

-- the internal ones, for the proof scripts (a role that already reads every table)
GRANT EXECUTE ON FUNCTION _scheduled_core(uuid, uuid) TO prep_app_read;
GRANT EXECUTE ON FUNCTION _effective_core(uuid, uuid) TO prep_app_read;
GRANT EXECUTE ON FUNCTION deadline_rows(uuid)         TO prep_app_read;
GRANT EXECUTE ON FUNCTION late_close_at(uuid)         TO prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the proof script compares this to the shipped site's resolveDueBySection / effectiveDue
--   SELECT source, count(*) FROM app.deadline_rows('<course offering uuid>') GROUP BY 1;
--
--   -- must be false for every browser-facing role at step 1
--   SELECT r, has_function_privilege(r, 'app.effective_deadline(uuid,uuid)', 'EXECUTE')
--     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
