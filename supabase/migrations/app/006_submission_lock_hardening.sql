-- PREP v2 — close two ways a student could defeat the activity lock
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql and 002_rls.sql.
--
-- FOUND BY: tests/app-schema/test-student.mjs, while wiring site/app/ to schema `app`
-- (2026-07-20). Both were reproduced against the live schema as a genuinely signed-in
-- student, not reasoned about on paper.
--
-- WHAT WAS WRONG
--   001_core_model.sql lists "the chosen activity cannot silently change" as an invariant
--   enforced structurally, and the director-facing help doc repeats it as something the
--   database guarantees. It did not hold. Two independent bypasses:
--
--   1. SELF-UNLOCK BY ATTRIBUTION. submissions_lock_activity() refused an unlock that did
--      not set unlocked_by, but never checked that the caller was staff, or that they were
--      the person named. Meanwhile submissions_student_update lets a student write ANY
--      column on their own row, and instructors_read is USING (true), so a student could
--      list instructors, pick one, and clear their own committed choice while attributing
--      the unlock to an instructor who did nothing. The audit trail actively lied.
--
--   2. STATUS REVERT. The lock only engaged when OLD.status = 'committed'. A student could
--      set status back to 'draft' in one statement — nothing forbade it — and then change
--      the activity freely in a second, because by then OLD.status was no longer
--      'committed'. This needed no instructor id at all.
--
-- WHY IT MATTERS BEYOND TIDINESS
--   switch_policy exists to serve the research design: whether a student may move between
--   the written and interactive paths after committing is the experimental variable. A
--   student who works the written preflight, reads the questions, then switches to the
--   interactive lesson contaminates exactly the revealed-preference signal the study is
--   there to collect. An unlock that names the wrong person also corrupts the audit trail
--   the grade_events table exists to protect.
--
-- THE FIX, and where it lives
--   Both holes are closed in the TRIGGER rather than in RLS. RLS decides which ROWS a
--   caller may touch; it is a poor place to express "which COLUMN transitions are legal",
--   because a WITH CHECK cannot see OLD. The trigger already owned this invariant — it was
--   simply not asking who the caller was.
--
-- THE uid IS NULL BYPASS is deliberate. A direct Postgres connection (the prep_app_* tiers,
--   and service_role from an edge function) carries no `sub` claim, so current_uid() is
--   null. Those callers are already fully privileged — every one of them holds BYPASSRLS —
--   so gating them here would add no security while breaking operator tooling and the
--   migration scripts. A browser user can never reach this branch: an auth-issued user JWT
--   always carries `sub`.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;

CREATE OR REPLACE FUNCTION submissions_lock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pol     text;
  old_mod text;
  new_mod text;
  uid     uuid;
  staff   boolean;
BEGIN
  uid := current_uid();
  -- No JWT => a direct/operator connection, already privileged. See the header note.
  staff := (uid IS NULL) OR is_staff();

  -- (2) Reopening a commit IS an unlock, so it needs the same authority. This must be
  -- checked before the early return below, or reverting the status would slip through
  -- untouched whenever chosen_activity_id was left alone in the same statement.
  IF OLD.status = 'committed' AND NEW.status IS DISTINCT FROM 'committed' AND NOT staff THEN
    RAISE EXCEPTION
      'submission %: only staff may reopen a committed submission (attempted % -> %)',
      OLD.id, OLD.status, NEW.status;
  END IF;

  IF NEW.chosen_activity_id IS NOT DISTINCT FROM OLD.chosen_activity_id THEN
    RETURN NEW;
  END IF;

  -- An instructor unlock (clearing the choice) is permitted, but must be attributable AND
  -- actually performed by the person it names.
  IF NEW.chosen_activity_id IS NULL THEN
    IF NEW.unlocked_by IS NULL THEN
      RAISE EXCEPTION
        'submission %: an unlock must set unlocked_by so it is attributable', OLD.id;
    END IF;
    -- (1) the two checks that were missing
    IF NOT staff THEN
      RAISE EXCEPTION
        'submission %: only staff may unlock a committed submission', OLD.id;
    END IF;
    IF uid IS NOT NULL AND NEW.unlocked_by IS DISTINCT FROM uid THEN
      RAISE EXCEPTION
        'submission %: unlocked_by (%) must be the instructor performing the unlock (%)',
        OLD.id, NEW.unlocked_by, uid;
    END IF;
    RETURN NEW;
  END IF;

  -- Nothing committed yet: the choice is still free.
  IF OLD.chosen_activity_id IS NULL OR OLD.status <> 'committed' THEN
    RETURN NEW;
  END IF;

  SELECT ao.switch_policy INTO pol
    FROM assignment_offerings ao WHERE ao.id = NEW.assignment_offering_id;
  SELECT modality INTO old_mod FROM activities WHERE id = OLD.chosen_activity_id;
  SELECT modality INTO new_mod FROM activities WHERE id = NEW.chosen_activity_id;

  IF pol = 'free_until_commit' THEN
    RAISE EXCEPTION
      'submission % is committed to %; switch_policy=free_until_commit forbids changing it',
      OLD.id, old_mod;
  ELSIF pol = 'one_way_to_interactive' THEN
    IF NOT (old_mod = 'written' AND new_mod = 'interactive') THEN
      RAISE EXCEPTION
        'submission %: switch_policy=one_way_to_interactive allows written->interactive only (got %->%)',
        OLD.id, old_mod, new_mod;
    END IF;
  ELSE   -- lock_on_commit, lock_on_start
    RAISE EXCEPTION
      'submission % is locked to % by switch_policy=%; an instructor unlock is required',
      OLD.id, old_mod, pol;
  END IF;

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION submissions_lock_activity() IS
  'Enforces assignment_offerings.switch_policy, and that only staff may unlock or reopen a '
  'committed submission — attributing the unlock to themselves, not to a colleague. '
  'Hardened by migration 006 after tests/app-schema/test-student.mjs demonstrated a student '
  'could do both.';

COMMIT;
