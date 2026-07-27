-- PREP v2 — store each scheduled assignment's per-DAY deadlines, so a section added later is
-- correct without re-saving the lesson
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql.
--
-- WHY
--   A student's deadline came from `assignment_due_dates`, one materialized row per
--   (assignment_offering, section). Those rows are written only when a director SAVES the lesson
--   in the editor, and they are the ONLY place the M-day/T-day split is recorded — the editor
--   reconstructs its {M:…, T:…} boxes by reading them back through each section's meeting_days.
--
--   That makes the split derivable only from sections that already have rows, and it means a
--   section created AFTER the lessons were scheduled has no deadline of its own. It falls back to
--   `assignment_offerings.due_at`, which on every Fall 2026 row is the M-day date — so a new T-day
--   section is silently one day early on every lesson, with no error and nothing to notice.
--
--   Moving a student between sections was never affected (the lookup is keyed on the student's
--   CURRENT section), and a materialized row buys no historical accuracy either, because lateness
--   is computed live against the deadline at read time. The rows are a cache that can go stale.
--
--   This column makes the per-day schedule the stored fact it always was in the director's head.
--   `assignment_due_dates` survives as what it should have been all along: a deliberate
--   per-section OVERRIDE (the cancelled-class case), not the normal path.
--
--   Resulting precedence, implemented in js/schema.js effectiveDue():
--     student extension  >  explicit section row  >  due_by_day × section.meeting_days  >  due_at
--
-- SHAPE
--   {"M": "2026-08-12T23:59:59+00:00", "T": "2026-08-13T23:59:59+00:00"}
--   Keys are meeting-day letters as they appear in `sections.meeting_days` — NOT hardcoded to
--   M and T. A course meeting W/F stores W and F and needs no change here or in the frontend.
--   `{}` means "no per-day schedule": the offering's own due_at applies to everyone, which is
--   the correct reading for a course whose sections declare no meeting days.
--
-- BACKFILL
--   Derived from the rows that exist today, by the same rule the editor uses: for each offering,
--   group its assignment_due_dates by the meeting days of the section each row names, and keep the
--   earliest date seen for each day letter. Offerings with no per-section rows get `{}` and keep
--   behaving exactly as they do now.
--
-- Reversible: `ALTER TABLE app.assignment_offerings DROP COLUMN due_by_day;`
-- No data is destroyed — assignment_due_dates is read, never written, by this migration.

BEGIN;

ALTER TABLE app.assignment_offerings
  ADD COLUMN IF NOT EXISTS due_by_day jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN app.assignment_offerings.due_by_day IS
  'Per-meeting-day deadlines for this scheduled assignment, keyed by the day letters used in '
  'sections.meeting_days: {"M": timestamptz, "T": timestamptz}. The DEFAULT deadline source for '
  'a section, resolved as due_by_day[day] for each day in that section''s meeting_days. A section '
  'added after scheduling is therefore correct with no lesson re-save. Precedence: student '
  'extension > assignment_due_dates (explicit per-section override) > due_by_day > due_at. '
  '`{}` means no per-day schedule and due_at applies to everyone.';

-- Guard the shape: an object, never an array or a scalar. Cheap, and it stops a writer that
-- serialises the editor model wrongly from landing something no reader can use.
ALTER TABLE app.assignment_offerings
  DROP CONSTRAINT IF EXISTS assignment_offerings_due_by_day_object;
ALTER TABLE app.assignment_offerings
  ADD CONSTRAINT assignment_offerings_due_by_day_object
  CHECK (jsonb_typeof(due_by_day) = 'object');

/* ── backfill ────────────────────────────────────────────────────────────────
 * One row per (offering, day letter): the earliest due_at among the sections that meet that day.
 * `earliest` matters only if two sections meeting the same day disagree — in which case the
 * earlier date is the safe reading, since it is the one already shown to some students.
 */
WITH per_day AS (
  SELECT d.assignment_offering_id AS off_id,
         day_letter,
         min(d.due_at) AS due_at
    FROM app.assignment_due_dates d
    JOIN app.sections s ON s.id = d.section_id
    CROSS JOIN LATERAL unnest(s.meeting_days) AS day_letter
   GROUP BY d.assignment_offering_id, day_letter
),
folded AS (
  SELECT off_id, jsonb_object_agg(day_letter, to_jsonb(due_at)) AS map
    FROM per_day GROUP BY off_id
)
UPDATE app.assignment_offerings ao
   SET due_by_day = folded.map
  FROM folded
 WHERE folded.off_id = ao.id
   AND ao.due_by_day = '{}'::jsonb;

COMMIT;
