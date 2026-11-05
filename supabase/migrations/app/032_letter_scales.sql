-- PREP v2 -- letter scales, per course offering, versioned, validated by the database
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql. It does NOT depend on
-- 023_instructors_admin_flag_guard.sql, and it needs no other v2 migration. Design:
-- docs/decisions/V2-DATA-MODEL.md section 11 and docs/decisions/GRADE-RULES.md.
--
-- WHAT IT ADDS
--   letter_scales               id, course_offering_id, version, lines jsonb, near_line_width numeric (default 0.1),
--                               created_by, created_at, retired_at. ONE unretired row per offering (partial
--                               unique index). Editing makes a new version and retires the old one.
--   letter_scale_is_valid()     IMMUTABLE, used in a CHECK. Lines not empty; cutoffs strictly descending; the last
--                               cutoff exactly 0; letters unique; GPA not increasing; width at least 0 and below the
--                               smallest gap between cutoffs (so only the next line up can ever apply).
--   default_letter_scale()      the scale from GRADE-RULES.md (A 93 ... F 0).
--   current_letter_scale()      the unretired row, else the default. An offering needs no row until a Director
--                               changes something. Staff of the offering only.
--   _scale_for(), _letter_for() internal. _letter_for is the one place letter, GPA and the near-line flag are
--                               decided, in exact numeric arithmetic with no division before a comparison.
--
-- scale_change_preview() is defined in 039, because it reads the total rule (_totals_at) that 039 creates.
--
-- LINES SHAPE   [{ "letter": "A", "cutoff": 93, "gpa": 4.0 }, ...]. JSON numbers in jsonb are exact numeric.
--
-- THE LETTER RULE   earned * 100 >= cutoff * possible, highest cutoff first, first that passes.
-- THE NEAR-LINE RULE   (cutoff - width) * possible <= earned * 100 AND earned * 100 < cutoff * possible.
--
-- WHO CAN WRITE
--   RLS: staff of the offering read, directors write, no student policy. prep_app_dml and service_role bypass
--   RLS, so a CHECK-valid scale is the only protection against them; the Director requirement is proved by an
--   instructor session being refused. The columns hold nothing sensitive to a cadet but students read nothing here.
--
-- THE CURRENT SITE
--   A new table nothing reads.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

-- ---- the validator ----------------------------------------------------------------------------
CREATE FUNCTION letter_scale_is_valid(p_lines jsonb, p_width numeric) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
DECLARE
  e        jsonb;
  letters  text[] := ARRAY[]::text[];
  l        text;
  cut      numeric;
  g        numeric;
  prev_cut numeric;
  prev_g   numeric;
  min_gap  numeric;
  n        integer := 0;
BEGIN
  IF p_lines IS NULL OR p_width IS NULL OR p_width < 0
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN false;
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_lines) x LOOP
    IF jsonb_typeof(e) <> 'object'
       OR jsonb_typeof(e -> 'letter') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e -> 'cutoff') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e -> 'gpa')    IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    l := e ->> 'letter';
    IF btrim(l) = '' OR l = ANY (letters) THEN
      RETURN false;
    END IF;
    letters := letters || l;
    cut := (e ->> 'cutoff')::numeric;
    g   := (e ->> 'gpa')::numeric;
    IF cut < 0 OR g < 0 THEN
      RETURN false;
    END IF;
    IF n > 0 THEN
      IF cut >= prev_cut OR g > prev_g THEN
        RETURN false;
      END IF;
      min_gap := least(coalesce(min_gap, prev_cut - cut), prev_cut - cut);
    END IF;
    prev_cut := cut;
    prev_g   := g;
    n := n + 1;
  END LOOP;
  IF cut <> 0 THEN
    RETURN false;                        -- the scale must end at 0, so a line always passes
  END IF;
  IF min_gap IS NOT NULL AND p_width >= min_gap THEN
    RETURN false;
  END IF;
  RETURN true;
END; $$;

COMMENT ON FUNCTION letter_scale_is_valid(jsonb, numeric) IS
  'True when lines are a usable scale: not empty, cutoffs strictly descending, last cutoff exactly 0, letters unique, '
  'GPA not increasing, and width >= 0 and below the smallest gap between cutoffs. Pure; used in a CHECK.';

-- ---- the default ------------------------------------------------------------------------------
CREATE FUNCTION default_letter_scale() RETURNS TABLE (lines jsonb, near_line_width numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
  SELECT '[{"letter":"A","cutoff":93,"gpa":4.0},{"letter":"A-","cutoff":90,"gpa":3.7},
           {"letter":"B+","cutoff":87,"gpa":3.3},{"letter":"B","cutoff":83,"gpa":3.0},
           {"letter":"B-","cutoff":80,"gpa":2.7},{"letter":"C+","cutoff":77,"gpa":2.3},
           {"letter":"C","cutoff":73,"gpa":2.0},{"letter":"C-","cutoff":70,"gpa":1.7},
           {"letter":"D","cutoff":60,"gpa":1.0},{"letter":"F","cutoff":0,"gpa":0.0}]'::jsonb,
         0.1::numeric;
$$;

-- ---- letter_scales ----------------------------------------------------------------------------
CREATE TABLE letter_scales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_offering_id uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  version            integer NOT NULL DEFAULT 1,
  lines              jsonb NOT NULL,
  near_line_width    numeric NOT NULL DEFAULT 0.1,
  created_by         uuid REFERENCES instructors(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  retired_at         timestamptz,
  CONSTRAINT letter_scales_version_ck CHECK (version >= 1),
  CONSTRAINT letter_scales_valid_ck CHECK (letter_scale_is_valid(lines, near_line_width)),
  CONSTRAINT letter_scales_offering_version_key UNIQUE (course_offering_id, version)
);

CREATE UNIQUE INDEX letter_scales_one_current ON letter_scales (course_offering_id) WHERE retired_at IS NULL;

COMMENT ON TABLE letter_scales IS
  'Versioned letter scale per course offering. Editing makes a new version and retires the old one; checkpoints keep '
  'a copy of the scale they used. An offering with no row uses default_letter_scale().';

ALTER TABLE letter_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY letter_scales_read_staff ON letter_scales FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY letter_scales_write_director ON letter_scales FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));
REVOKE ALL ON letter_scales FROM anon;

-- ---- internal lookups -------------------------------------------------------------------------
CREATE FUNCTION _scale_for(p_course_offering uuid)
RETURNS TABLE (lines jsonb, near_line_width numeric, version integer, is_default boolean)
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  SELECT s.lines, s.near_line_width, s.version, false
    FROM letter_scales s
   WHERE s.course_offering_id = p_course_offering AND s.retired_at IS NULL
  UNION ALL
  SELECT d.lines, d.near_line_width, 0, true
    FROM default_letter_scale() d
   WHERE NOT EXISTS (SELECT 1 FROM letter_scales s
                      WHERE s.course_offering_id = p_course_offering AND s.retired_at IS NULL);
$$;

CREATE FUNCTION current_letter_scale(p_course_offering uuid)
RETURNS TABLE (lines jsonb, near_line_width numeric, version integer, is_default boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF p_course_offering IS NULL OR p_course_offering NOT IN (SELECT staff_offerings()) THEN
    RAISE EXCEPTION 'current_letter_scale: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT * FROM _scale_for(p_course_offering);
END; $$;

-- letter, GPA and near-line flag from exact numeric arithmetic: no division, no rounding
CREATE FUNCTION _letter_for(p_earned numeric, p_possible numeric, p_lines jsonb, p_width numeric)
RETURNS TABLE (letter text, gpa numeric, near_line_letter text)
LANGUAGE sql
IMMUTABLE
SET search_path = app, pg_temp
AS $$
  WITH l AS (
    SELECT x ->> 'letter' AS letter, (x ->> 'cutoff')::numeric AS cutoff, (x ->> 'gpa')::numeric AS gpa
      FROM jsonb_array_elements(p_lines) x)
  SELECT (SELECT l.letter FROM l
           WHERE p_possible > 0 AND p_earned * 100 >= l.cutoff * p_possible
           ORDER BY l.cutoff DESC LIMIT 1),
         (SELECT l.gpa FROM l
           WHERE p_possible > 0 AND p_earned * 100 >= l.cutoff * p_possible
           ORDER BY l.cutoff DESC LIMIT 1),
         (SELECT l.letter FROM l
           WHERE p_possible > 0
             AND (l.cutoff - p_width) * p_possible <= p_earned * 100
             AND p_earned * 100 < l.cutoff * p_possible
           ORDER BY l.cutoff ASC LIMIT 1);
$$;

-- ---- grants: by name --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION letter_scale_is_valid(jsonb, numeric)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION default_letter_scale()
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION current_letter_scale(uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _scale_for(uuid)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;
REVOKE ALL ON FUNCTION _letter_for(numeric, numeric, jsonb, numeric)
  FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read;

-- a CHECK runs as the writer, so a writer without EXECUTE here fails with a permission error
GRANT EXECUTE ON FUNCTION letter_scale_is_valid(jsonb, numeric) TO authenticated, service_role, prep_app_dml;
GRANT EXECUTE ON FUNCTION default_letter_scale()                TO authenticated;
GRANT EXECUTE ON FUNCTION current_letter_scale(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION default_letter_scale()                TO prep_app_read;
GRANT EXECUTE ON FUNCTION _scale_for(uuid)                      TO prep_app_read;
GRANT EXECUTE ON FUNCTION _letter_for(numeric, numeric, jsonb, numeric) TO prep_app_read;

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- the default scale is itself valid (must be true)
--   SELECT app.letter_scale_is_valid(lines, near_line_width) FROM app.default_letter_scale();
--
--   -- boundary: 89.9 of 100 at a 90 line is B+ with an A- flag; 89.89 has no flag; 90 is A- (3 rows)
--   SELECT e, (app._letter_for(e, 100, d.lines, d.near_line_width)).*
--     FROM app.default_letter_scale() d, unnest(ARRAY[89.9, 89.89, 90.0]::numeric[]) e;
