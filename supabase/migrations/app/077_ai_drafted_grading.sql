-- PREP v2 -- a ninth (delivery, grading) pair: typed_response with ai_drafted
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 027_path_delivery_grading.sql (the two CHECKs it replaces and the fill trigger).
-- Added 2026-11-05 on branch v2-step2-rollin. Design: docs/decisions/V2-DATA-MODEL.md section 3 and the roll-in section.
--
-- WHAT IT DOES
--   offering_activities_delivery_grading_ck       the allowed pairs, plus ('typed_response', 'ai_drafted').
--   offering_activities_warn_needs_human_ck       warn_earns_full is allowed with human_graded OR ai_drafted.
--
-- WHAT THE NEW VALUE MEANS
--   human_graded  a person marks the typed response; no overnight job grades it.
--   ai_drafted    the overnight job writes a suggested mark (an unfinalized grade) and a person reviews and finalizes it.
--   Both are typed responses on a `written` activity, so the tools that find a lesson by its activity modality keep
--   working. Which paths the nightly job takes is decided by the scripts, not by a trigger.
--
-- WHAT IT DOES NOT DO
--   The fill trigger (offering_activities_fill_path) is unchanged: an old writer that names no delivery still gets
--   typed_response + human_graded. It touches no stored row, grants nothing, and changes no function.
--   The rule that only a signed-in staff member can finalize an ai_drafted item is migration 078.
--
-- Rollback: rollback/077_ai_drafted_grading_ROLLBACK.sql refuses while any path uses ai_drafted.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE offering_activities
  DROP CONSTRAINT offering_activities_warn_needs_human_ck,
  DROP CONSTRAINT offering_activities_delivery_grading_ck;

ALTER TABLE offering_activities
  ADD CONSTRAINT offering_activities_delivery_grading_ck CHECK (
    (delivery IS NULL AND grading IS NULL)
    OR (delivery IS NOT NULL AND grading IS NOT NULL
        AND (delivery, grading) IN (
          ('online_questions', 'auto_checked'),
          ('online_questions', 'human_graded'),
          ('typed_response',   'human_graded'),
          ('typed_response',   'ai_drafted'),
          ('interactive_tutor', 'effort'),
          ('in_person',        'hand_entered'),
          ('in_person',        'imported'),
          ('elsewhere',        'hand_entered'),
          ('elsewhere',        'imported')))),
  ADD CONSTRAINT offering_activities_warn_needs_human_ck CHECK (
    warn_earns_full IS NOT TRUE OR grading IN ('human_graded', 'ai_drafted'));

COMMENT ON COLUMN offering_activities.grading IS
  'How the work is graded. See offering_activities_delivery_grading_ck for the allowed pairs. ai_drafted: the overnight '
  'job writes a suggested mark and a person finalizes it (migration 077, rule in 078).';
COMMENT ON COLUMN offering_activities.warn_earns_full IS
  'Whether a yellow (warn) mark earns full credit. True only with human_graded or ai_drafted. New items write '
  'false unless ai_drafted; backfilled preflights write true.';

COMMIT;

-- =====================================================================================
-- VERIFY (read-only; run after applying)
-- =====================================================================================
--   -- 1 row, and the text names ai_drafted
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'app.offering_activities'::regclass AND conname = 'offering_activities_delivery_grading_ck';
--   -- 1 row, and the text names ai_drafted
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'app.offering_activities'::regclass AND conname = 'offering_activities_warn_needs_human_ck';
