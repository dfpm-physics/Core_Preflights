-- PREP v2 — per-user preferences that follow the person, not the browser
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql, 002_rls.sql.
-- Roadmap P1.3.
--
-- WHY THIS EXISTS
--   Every preference in PREP is localStorage-only, and account.js:182-194 said so on purpose:
--   the theme toggle owns `cp.theme`, auth.js owns `cp.currentOffering`, and the account page
--   merely made two side-effect settings visible. That is a defensible place to start and a bad
--   place to stay. An instructor who sets dark mode on the classroom podium, then opens PREP on
--   their office desktop, gets light mode and no explanation — and every preference added later
--   (P1.5's histogram style, P1.1's gradebook columns) inherits the same defect.
--
-- ONE jsonb COLUMN, NOT A COLUMN PER PREFERENCE
--   The whole point is that adding a preference must not require a migration. `app` DDL is
--   sealed between deliberate windows (CORE.md §0), so a design where "let the user hide a
--   gradebook column" means unsealing the database is a design that will simply not be used.
--   The cost is the usual one: no type checking and no per-key constraint. That is the right
--   trade here because NOTHING IN THIS TABLE IS LOAD-BEARING — see below.
--
-- NOTHING HERE MAY EVER AFFECT AUTHORIZATION, GRADES, OR VISIBILITY OF DATA
--   This is a rendering table. A preference decides what a page shows this person FIRST, never
--   what they are ALLOWED to see — that is RLS's job and it must stay RLS's job. The rule is
--   worth stating because the failure is so tempting: "remember my section filter" is a
--   preference, and one careless step later "only load my sections" is a permission check
--   living in a jsonb blob the user can write to themselves. A user can put ANY value in this
--   column (the policy below is self-write by design), so any code that trusts it for anything
--   but presentation is trusting attacker-controlled input.
--
-- WHY THERE IS NO FOREIGN KEY TO auth.users
--   `prep_app_owner` cannot be delegated REFERENCES on `auth.users` — the FKs on `instructors`
--   and `students` were added by `postgres` directly (bootstrap §6), and that is a human-only
--   step. It is not worth reopening for this table, because the RLS policy already achieves
--   what the FK would: `user_id` must equal the caller's uid, so a row cannot be created for a
--   user that is not signing in. A deleted auth user leaves one orphaned row of view preferences
--   holding no PII and referenced by nothing.
--
-- THE POLICIES CALL app.current_uid(), NOT auth.uid()
--   The app tier has NO privileges on schema `auth` — not even USAGE — so a policy written with
--   `auth.uid()` fails at CREATE time with "permission denied for schema auth", which is exactly
--   what happened on the first attempt at this file. 002_rls.sql already solved this:
--   `current_uid()` reads the same `sub` claim straight out of the JWT GUC. Use it. This is the
--   same boundary that stops `prep_app_owner` from minting a login (roadmap P0.5), and it is
--   worth internalising that `app` and `auth` are separate worlds in both directions.
--
-- WHY BOTH ROLES SHARE ONE TABLE
--   Keyed on the auth user id, not on `instructors.id` or `students.student_id`, so students and
--   faculty use the same table and the same client module. Theme is not a faculty concept.

BEGIN;

SET LOCAL search_path = app, public;

CREATE TABLE IF NOT EXISTS user_preferences (
  -- = auth.users.id. See above for why this carries no FK.
  user_id    uuid PRIMARY KEY,

  -- Client-owned bag. Keys are namespaced exactly as their localStorage counterparts
  -- (`cp.theme`, `cp.currentOffering`, …) so one name identifies a preference everywhere:
  -- in the browser cache, in this column, and in the module that reads it.
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_at timestamptz NOT NULL DEFAULT now(),

  -- An object, not an array or a scalar. The client merges keys into it; a `prefs` that
  -- arrived as `[]` or `"dark"` would break that merge silently on the next write.
  CONSTRAINT user_preferences_object_ck CHECK (jsonb_typeof(prefs) = 'object'),

  -- A cap, so a bug in a client loop cannot turn a preferences row into a data store. 16 KB is
  -- ~100x the realistic payload (a theme, an offering key, a handful of view toggles) and well
  -- under anything that would slow a page load.
  CONSTRAINT user_preferences_size_ck CHECK (pg_column_size(prefs) <= 16384)
);

COMMENT ON TABLE user_preferences IS
  'Per-user view preferences, keyed on the auth user id so one row serves a person across every '
  'device and both roles. PRESENTATION ONLY — never authorization, never grades. The user can '
  'write any value here (RLS is self-write), so no code may trust it for anything but rendering. '
  'localStorage remains the read-through cache; this table is what makes it survive a device change.';

COMMENT ON COLUMN user_preferences.prefs IS
  'Open jsonb bag, keys namespaced to match their localStorage keys (cp.theme, cp.currentOffering, '
  '…). Deliberately schemaless: adding a preference must not require unsealing `app` for DDL.';

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Self, and only self — all four verbs. There is no staff read policy and there should not be
-- one: an instructor has no business knowing which theme a cadet uses, and a director reading
-- another director's saved filters is surveillance with no upside. A global admin is deliberately
-- NOT short-circuited in here either, unlike most policies in 002_rls.sql, for the same reason.
DROP POLICY IF EXISTS user_preferences_self_read ON user_preferences;
CREATE POLICY user_preferences_self_read ON user_preferences FOR SELECT TO authenticated
USING (user_id = current_uid());

DROP POLICY IF EXISTS user_preferences_self_insert ON user_preferences;
CREATE POLICY user_preferences_self_insert ON user_preferences FOR INSERT TO authenticated
WITH CHECK (user_id = current_uid());

-- USING and WITH CHECK both, so a row cannot be re-keyed onto somebody else's user_id.
DROP POLICY IF EXISTS user_preferences_self_update ON user_preferences;
CREATE POLICY user_preferences_self_update ON user_preferences FOR UPDATE TO authenticated
USING (user_id = current_uid()) WITH CHECK (user_id = current_uid());

DROP POLICY IF EXISTS user_preferences_self_delete ON user_preferences;
CREATE POLICY user_preferences_self_delete ON user_preferences FOR DELETE TO authenticated
USING (user_id = current_uid());

CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO authenticated;

COMMIT;
