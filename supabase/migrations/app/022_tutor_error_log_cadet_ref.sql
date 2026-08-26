-- PREP v2 -- the error log could not name the cadet it was logging
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 020_tutor_error_log.sql, 021_tutor_error_log_grants.sql.
--
-- WHAT WAS WRONG
--   020 gave the table `cadet_id bigint`, and the edge function parses that field by stripping
--   non-digits. The backup lesson page does not collect a cadet ID. It collects a LAST NAME --
--   "Enter your last name so your instructor can match this report to you" -- held in a state
--   variable named `cadetId`, with a comment beside it reading "holds the last name; do NOT
--   rename". The name was read, sent, parsed to NaN, and stored as NULL.
--
--   So every row logged since the feature shipped is anonymous, which is the single thing the
--   feature existed to stop. The instructor report that prompted all of this was "I am
--   collecting a list of names after class"; the log was collecting no names at all.
--
--   Nothing failed and nothing errored. `cadet_id` is nullable, a NULL is what a pre-sign-in
--   error legitimately looks like, and the on-screen panel shows the name correctly -- so a
--   cadet's screenshot was attributable while the server copy of the same event was not.
--
-- WHY A NEW COLUMN AND NOT A TYPE CHANGE
--   `cadet_id bigint` stays. It is right for any future surface that has a real cadet ID, and
--   the numeric type is what makes a join to `students` safe. `cadet_ref` is the other thing:
--   whatever the cadet typed into the identity box, as text, capped. Two columns because they
--   are two different claims, and collapsing them into one text field would lose the ability
--   to tell a real ID from a surname later.
--
-- ON STORING A NAME
--   Permitted. CORE.md §3, as amended 2026-08-17: name, cadet ID and score are not treated as
--   PII in this system, per institutional guidance
--   (docs/decisions/STUDENT-DATA-CLASSIFICATION.md). The §3 rule that a name must not be used
--   "where the cadet ID would carry the same meaning" does not bite here, because this surface
--   never collects an ID -- the name IS the identifier the whole interactive path matches on,
--   including the report the cadet submits.
--
--   What §3 still bars outright is free-text student WRITING paired with an identity. This
--   column is an identity and nothing else; the table has nowhere to put a sentence, and the
--   edge function still builds its insert from a whitelist. `scripts/checks/name_scan.py`
--   scans tracked FILES, not database rows, so it neither covers nor contradicts this.
--
-- IT IS A CLAIM, NOT AN IDENTITY
--   Same caveat as `cadet_id`, and more so: it is typed by hand on an unauthenticated page.
--   Expect misspellings, initials, full names, and the occasional cadet who types nothing.
--   Match it against the roster by eye. Nothing downstream may trust it.

BEGIN;

SET LOCAL search_path = app, public;

ALTER TABLE tutor_error_log ADD COLUMN IF NOT EXISTS cadet_ref text;

COMMENT ON COLUMN tutor_error_log.cadet_ref IS
  'Whatever the cadet typed into the identity box -- on the backup lessons that is a LAST NAME, '
  'not an ID. A claim typed on an unauthenticated page; match by eye, never trust downstream.';

-- "Which cadets hit this, and when" is the question this table is opened for.
CREATE INDEX IF NOT EXISTS tutor_error_log_ref_idx
  ON tutor_error_log (lower(cadet_ref), logged_at DESC) WHERE cadet_ref IS NOT NULL;

COMMIT;

-- No new GRANT is needed: a column inherits the table's privileges, and 021 already covers
-- INSERT for service_role and SELECT for authenticated and prep_app_read.
--
-- Rows logged before this migration keep a NULL cadet_ref and cannot be back-filled -- the name
-- was discarded client-side at parse time and was never sent in a recoverable form.
