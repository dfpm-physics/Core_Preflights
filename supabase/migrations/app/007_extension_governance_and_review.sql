-- PREP v2 — extension governance, and the instructor's review attestation
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql, 005_extensions.sql.
--
-- WHY THIS EXISTS
--   005 gave the model a place to put a per-student deadline override and stopped there:
--   any staff member could grant one, nothing recorded WHY, and the only way to take one
--   back was a hard DELETE that left no trace. That is fine while extensions are rare and
--   invisible. It stops being fine the moment a course director wants to answer "how many
--   extensions is each of my instructors handing out, and for what?" — which is the actual
--   question, because the intended remedy is a conversation with the instructor, not a
--   revocation. A report you cannot trust the numbers in cannot start that conversation.
--
--   Two changes serve that, and one unrelated-looking third falls out of it.
--
-- 1. AN EXTENSION MUST SAY WHY.  `reason` was nullable and the UI never sent it, so every
--    row would have been blank. A per-instructor count with an empty reason column is a
--    number without a story; the director would have to ask about all of them or none.
--    Made NOT NULL — safe today because the table holds zero rows, and it will never be
--    cheaper to do than right now.
--
-- 2. REVOCATION IS SOFT, DIRECTOR-ONLY, AND REFUSED ONCE THE WORK IS IN.
--    Soft, because a hard DELETE hides the event from the very person whose behaviour the
--    report exists to surface — the instructor sees the row vanish and learns nothing, and
--    the director loses the count they are managing against.
--    Director-only, enforced in the trigger rather than left to the UI, so an instructor
--    cannot quietly withdraw their own extension to keep it off the report.
--    Refused after submission, because revoking an extension a student already submitted
--    under does not undo anything — it retroactively makes a good-faith, on-time submission
--    late. The remedy for "too many extensions" is fewer next time, never a penalty applied
--    to work already handed in. The same guard covers DELETE, or the rule would hold only
--    for whichever verb the UI happened to call.
--
-- 3. REVIEW SIGN-OFF.  `preflight-analyze` writes suggested grades, and until now the only
--    signal that a human had looked at them was `is_finalized` — which is also the flag that
--    publishes to students. Those are two different facts and conflating them costs both: an
--    instructor cannot say "I have been through my section" without publishing, and a
--    director cannot tell a reviewed section from an unreviewed one until grades are already
--    out. review_signoffs separates the attestation from the publication.
--
-- WHY STALENESS IS NOT A COLUMN
--   A sign-off should stop counting if the grades move afterwards. That is derivable:
--   `grades_touch` maintains grades.updated_at (verified on the live database, 2026-07-21),
--   so a sign-off is stale exactly when some grade in its (offering, section) has
--   updated_at > reviewed_at. Storing a snapshot counter instead would add a column that can
--   disagree with the rows it summarises — the failure mode 001 already called out for
--   points_earned. Read it, do not cache it.
--
-- A TRADE-OFF TAKEN DELIBERATELY
--   extensions keeps its UNIQUE (enrollment_id, assignment_offering_id). That means a
--   revoked extension is REINSTATED by clearing revoked_at rather than superseded by a
--   second row, so the table shows current state and not a full grant/revoke history. The
--   alternative — a partial unique index over the unrevoked rows — would preserve history
--   but break PostgREST's upsert, which can only infer a plain unique constraint. Current
--   state is what the report needs; if history is ever wanted it belongs in its own event
--   table, not in a shape that costs the write path.
--
-- THE uid IS NULL BYPASS is inherited from 006 and deliberate for the same reason: a direct
--   Postgres connection (the prep_app_* tiers, service_role from an edge function) carries no
--   `sub` claim, so current_uid() is null. Those callers already hold BYPASSRLS, so gating
--   them here would add nothing and would break operator tooling and the migration scripts.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;


-- =====================================================================================
-- PART 1 — extensions: a required reason, and a soft, guarded revocation
-- =====================================================================================

ALTER TABLE extensions
  ADD COLUMN revoked_at     timestamptz,
  ADD COLUMN revoked_by     uuid REFERENCES instructors(id) ON DELETE SET NULL,
  ADD COLUMN revoked_reason text;

-- Zero rows today, so this cannot fail and needs no backfill.
ALTER TABLE extensions ALTER COLUMN reason SET NOT NULL;

ALTER TABLE extensions ADD CONSTRAINT extensions_reason_present
  CHECK (length(btrim(reason)) > 0);

-- A revocation is either fully recorded or absent. revoked_by is deliberately NOT part of
-- this: it is ON DELETE SET NULL, and requiring it here would make deleting a departed
-- instructor fail against a CHECK. The reason text outlives the account that wrote it.
ALTER TABLE extensions ADD CONSTRAINT extensions_revocation_complete CHECK (
  (revoked_at IS NULL AND revoked_reason IS NULL)
  OR (revoked_at IS NOT NULL
      AND revoked_reason IS NOT NULL
      AND length(btrim(revoked_reason)) > 0)
);

COMMENT ON COLUMN extensions.reason IS
  'Why the extra time was granted. Required: the director-facing extensions report exists to '
  'start a conversation about volume, and a blank reason column cannot start one.';
COMMENT ON COLUMN extensions.revoked_at IS
  'Soft revocation. The row stays so the extension still counts as granted — hiding it would '
  'defeat the report it is counted in.';
COMMENT ON COLUMN extensions.revoked_by IS
  'The director who revoked it. ON DELETE SET NULL, like granted_by.';


CREATE FUNCTION extensions_guard_withdrawal() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  enr         uuid;
  offering    uuid;
  withdrawing boolean;
  uid         uuid;
BEGIN
  uid := current_uid();

  IF TG_OP = 'DELETE' THEN
    enr := OLD.enrollment_id;
    offering := OLD.assignment_offering_id;
    withdrawing := true;
  ELSE
    enr := NEW.enrollment_id;
    offering := NEW.assignment_offering_id;
    withdrawing := (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL);
  END IF;

  -- Only UPDATE can reach this with withdrawing = false; DELETE always withdraws.
  IF NOT withdrawing THEN
    RETURN NEW;
  END IF;


  -- Work already in: withdrawing the deadline now only converts an on-time submission into
  -- a late one. Refuse both verbs. See the header.
  IF EXISTS (SELECT 1 FROM submissions s
              WHERE s.enrollment_id = enr
                AND s.assignment_offering_id = offering
                AND s.status = 'committed') THEN
    RAISE EXCEPTION
      'extension for enrolment %: the student has already submitted under it', enr
      USING ERRCODE = 'check_violation',
            HINT = 'The work is in. Grade it — an extension is not withdrawn retroactively.';
  END IF;

  -- Revoking is a director's call. An instructor who could revoke their own grant could keep
  -- it off the report the director reads. No JWT => operator connection, already privileged.
  IF TG_OP = 'UPDATE' AND uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM enrollments e
                     JOIN sections sec ON sec.id = e.section_id
                    WHERE e.id = enr
                      AND sec.course_offering_id IN (SELECT director_offerings())) THEN
      RAISE EXCEPTION
        'extension for enrolment %: only a course director may revoke an extension', enr
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'An instructor who granted one in error may delete it before the student submits.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION extensions_guard_withdrawal() IS
  'Refuses to withdraw an extension (revoke OR delete) once the student has committed work '
  'under it, and restricts revocation to course directors. Both rules live here rather than '
  'in RLS because a WITH CHECK cannot see OLD, so it cannot recognise a transition.';

CREATE TRIGGER extensions_withdrawal_guard
  BEFORE UPDATE OR DELETE ON extensions
  FOR EACH ROW EXECUTE FUNCTION extensions_guard_withdrawal();


-- =====================================================================================
-- PART 2 — review_signoffs: "I have been through this section", separate from publishing
-- =====================================================================================

CREATE TABLE review_signoffs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_offering_id uuid NOT NULL REFERENCES assignment_offerings(id) ON DELETE CASCADE,
  section_id             uuid NOT NULL REFERENCES sections(id)             ON DELETE CASCADE,
  reviewed_by            uuid REFERENCES instructors(id) ON DELETE SET NULL,
  reviewed_at            timestamptz NOT NULL DEFAULT now(),
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_signoffs_unique UNIQUE (assignment_offering_id, section_id)
);

COMMENT ON TABLE review_signoffs IS
  'One instructor attestation per (assignment offering, section): the AI-suggested grades and '
  'comments have been read and adjusted. Deliberately NOT the same fact as grades.is_finalized, '
  'which publishes to students — an instructor must be able to finish reviewing without '
  'releasing, and a director must be able to see who is done before anything is released.';
COMMENT ON COLUMN review_signoffs.reviewed_at IS
  'Also the staleness clock: the sign-off no longer holds once any grade in this (offering, '
  'section) has grades.updated_at > this value. Derived at read time on purpose — a stored '
  'counter could disagree with the rows it summarises.';
COMMENT ON COLUMN review_signoffs.reviewed_by IS
  'Who attested. A trigger refuses a sign-off attributed to anyone but the caller, for the '
  'same reason migration 006 refuses a misattributed unlock: an attestation naming someone '
  'who did not perform it is worse than none.';

CREATE INDEX review_signoffs_section_idx ON review_signoffs (section_id);

CREATE TRIGGER review_signoffs_touch BEFORE UPDATE ON review_signoffs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


CREATE FUNCTION review_signoffs_require_self() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  uid uuid;
BEGIN
  uid := current_uid();
  -- No JWT => operator connection. See the header note inherited from 006.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.reviewed_by IS DISTINCT FROM uid THEN
    RAISE EXCEPTION
      'a review sign-off must be attributed to the instructor performing it (got %, caller %)',
      NEW.reviewed_by, uid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER review_signoffs_self BEFORE INSERT OR UPDATE ON review_signoffs
  FOR EACH ROW EXECUTE FUNCTION review_signoffs_require_self();


-- ---------------------------------------------------------------------------
-- RLS — the section predicate every staff-facing table in this model uses.
-- A director's staff row carries section_id IS NULL, so staff_sections() already
-- returns every section of the offering; no director-specific policy is needed.
-- Students never see these rows at all.
-- ---------------------------------------------------------------------------
ALTER TABLE review_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_signoffs_staff_read ON review_signoffs FOR SELECT TO authenticated
  USING (section_id IN (SELECT staff_sections()));

CREATE POLICY review_signoffs_staff_write ON review_signoffs FOR ALL TO authenticated
  USING (section_id IN (SELECT staff_sections()))
  WITH CHECK (section_id IN (SELECT staff_sections()));

COMMIT;
