-- PREP v2 — spell "enrollment" in the four table comments that still say "enrolment"
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql only. NOT YET APPLIED.
--
-- WHY THIS EXISTS, AND WHY IT IS A MIGRATION RATHER THAN AN EDIT
--   The 2026-07-23 spelling sweep standardized "enrolment" -> "enrollment" across ~50 files,
--   which was right: the column has been `enrollment_id` all along, so the prose disagreed with
--   the schema it described. But four of the strings it changed were in
--   `site/app/js/db-schema.js`, whose header reads "GENERATED FILE. Do not edit by hand." Those
--   four strings are copies of Postgres COMMENT ON text, and the sweep edited the copy instead
--   of the original.
--
--   The visible consequence was that `gen_db_schema.py --check` — the check that exists for
--   exactly this — went red the same day and stayed red, reporting the generated file as stale
--   when what had actually happened is that someone had corrected it by hand. The file has since
--   been regenerated, so it now matches live and reads "enrolment" again. This migration is what
--   makes the correction real, at the source, so the next regeneration keeps it.
--
--   Filed rather than applied because a COMMENT ON is DDL, and DDL on `app` is sealed
--   (CORE.md §0): `prep_app_owner` is NOLOGIN and unsealing is a human, coordinated act. There is
--   no urgency here — it is four comment strings — so it waits for the next window that opens for
--   another reason rather than justifying one of its own.
--
-- AFTER APPLYING
--   Re-run `.venv/Scripts/python scripts/app/gen_db_schema.py` and commit the regenerated
--   `site/app/js/db-schema.js`. Until you do, `test-db-schema.mjs` will go red — correctly, since
--   the file really will be stale at that point.
--
-- Reversible: the previous text is in git (5f711c9^:site/app/js/db-schema.js).

BEGIN;

COMMENT ON TABLE app.ei_sessions IS
  'Extra-instruction sessions, one row per student per sitting, keyed on the enrollment so a '
  'record belongs to a student''s place in a section in a term. STAFF-ONLY: there is no student '
  'read policy and that absence is deliberate (ROADMAP Q3) — `notes` may hold an instructor''s '
  'candid assessment. Repeatable by design: no unique key. A bulk log shares one batch_id.';

COMMENT ON TABLE app.enrollments IS
  'The multi-course fix, and the anchor for ALL student work. Because grades hang off the '
  'enrollment rather than the student, moving someone between sections no longer silently '
  're-attributes their history.';

COMMENT ON TABLE app.grades IS
  'Exactly one grade per enrollment per assignment offering, bounded by that offering''s value. '
  'These two constraints replace a whole class of bug: the old model spread a lesson''s grade '
  'across scores, preflight_interaction_reports.score, and lesson_completions.points with nothing '
  'relating earned points to possible points anywhere.';

COMMENT ON TABLE app.submissions IS
  'One row per enrollment per assignment offering. The choice, the lock, and the identity of the '
  'attempt live together here — which is what makes double-credit structurally impossible rather '
  'than merely defended against in application code.';

COMMIT;
