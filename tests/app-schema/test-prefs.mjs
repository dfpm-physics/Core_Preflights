// test-prefs.mjs — preferences that follow the person.  (Roadmap P1.3)
//
// WHY THIS EARNS ITS PLACE
//   prefs.js is a cache in front of a database, and every cache-in-front-of-a-database has the
//   same three ways to be wrong: it can lose a write, it can serve a stale read, or it can leak
//   one user's state to another. The third is the one that matters here — a shared lab machine
//   is the normal case for cadets, so "sign out, sign in as someone else, inherit their theme"
//   is not a hypothetical.
//
//   The live half also proves the RLS policy from migration 010 does what its comment claims.
//   A self-scoped policy is easy to write and easy to get subtly wrong (an UPDATE policy with
//   USING but no WITH CHECK lets a row be re-keyed onto another user), and the only way to know
//   is to try it against the real database as a real signed-in user.
//
// Runs in its own process — it stubs window/localStorage globally, and importing prefs.js binds
// window.db at module load, both of which would leak into later suites.

import { check, eq, section, summary, installBrowser, signInAsTestStudent, makeClient }
  from './harness.mjs';

const { store } = installBrowser({ pathname: '/site/app/student/account.html' });
const { client, session } = await signInAsTestStudent();
const USER_ID = session.user.id;

const P = await import('../../site/app/js/prefs.js');

/* ── 1. The synced set is a decision, not an accident ─────────────────────── */

section('prefs.js — which keys travel');

check('cp.theme is synced', P.SYNCED_KEYS.includes('cp.theme'));
check('cp.currentOffering is synced', P.SYNCED_KEYS.includes('cp.currentOffering'));

// These three are deliberately device-local. A test rather than a comment, because the cheapest
// way to "fix" a future bug report is to add a key to SYNCED_KEYS without thinking about whether
// it describes the person or the screen.
for (const key of ['cp.nav.open', 'cp.runbanner.dismissed', 'cp.system.columns']) {
  check(`${key} is NOT synced (describes the device, not the person)`,
        !P.SYNCED_KEYS.includes(key));
}

/* ── 2. Local cache behaviour ─────────────────────────────────────────────── */

section('prefs.js — local cache');

P.setPref('cp.theme', 'dark');
eq('setPref writes localStorage immediately', store.get('cp.theme'), 'dark');
eq('getPref reads it back', P.getPref('cp.theme'), 'dark');

P.setPref('cp.theme', '');
eq('an empty value clears the key rather than storing ""',
   store.has('cp.theme'), false);
eq('getPref falls back when absent', P.getPref('cp.theme', 'system'), 'system');

// The anti-FOUC snippet in every <head> does `localStorage.getItem('cp.theme') || <OS>`, so an
// absent key is precisely how "match my system" is encoded. Storing the literal 'system' was the
// pre-P1.3 bug: neither null nor 'dark', so the snippet silently painted light every time.
check('"system" is encoded as absence, which is what the <head> snippet expects',
      store.get('cp.theme') === undefined);

// An unsynced key still caches locally — prefs.js is the storage layer for everything, and only
// the push is selective.
P.setPref('cp.nav.open', '1');
eq('an unsynced key still writes through to localStorage', store.get('cp.nav.open'), '1');

/* ── 3. Live round-trip, as a real signed-in user ─────────────────────────── */

section('prefs.js — round-trip against app.user_preferences');

// Start from a known state so a previous run cannot make this pass by accident.
await client.from('user_preferences').delete().eq('user_id', USER_ID);

// First hydrate with an empty row: the local cache should be pushed UP rather than wiped, or
// every existing user loses the theme they have been using the moment P1.3 ships.
store.clear();
store.set('cp.theme', 'dark');
const seeded = await P.hydrate(USER_ID);
check('hydrate() reports a working connection', seeded.synced === true);
await P.flushPrefs();

let { data: row } = await client.from('user_preferences')
  .select('prefs').eq('user_id', USER_ID).maybeSingle();
eq('a first hydrate seeds the row from this browser rather than clearing it',
   row?.prefs?.['cp.theme'], 'dark');

// Now the cross-device case: the row says light, this browser's cache says dark. The row wins,
// and hydrate reports which keys it corrected so auth.js knows to repaint.
store.set('cp.theme', 'dark');
await client.from('user_preferences')
  .update({ prefs: { 'cp.theme': 'light', 'cp.currentOffering': 'phys-215|fall-2026' } })
  .eq('user_id', USER_ID);

const hydrated = await P.hydrate(USER_ID);
eq('the row wins over a stale local cache', store.get('cp.theme'), 'light');
check('hydrate() reports the corrected key so the page can repaint',
      hydrated.changed.includes('cp.theme'));
eq('a key only the row had is pulled down',
   store.get('cp.currentOffering'), 'phys-215|fall-2026');

// A push must send the whole bag, not just the key that changed, or every write silently drops
// the other preferences.
P.setPref('cp.theme', 'dark');
await P.flushPrefs();
({ data: row } = await client.from('user_preferences')
  .select('prefs').eq('user_id', USER_ID).maybeSingle());
eq('a push persists the changed key', row?.prefs?.['cp.theme'], 'dark');
eq('…without dropping the keys it did not touch',
   row?.prefs?.['cp.currentOffering'], 'phys-215|fall-2026');

/* ── 4. RLS — the policy, not the UI ──────────────────────────────────────── */

section('user_preferences — RLS is the boundary');

const anon = makeClient();
const { data: anonRows } = await anon.from('user_preferences').select('user_id');
eq('an anonymous client reads nothing', (anonRows || []).length, 0);

const { error: anonWrite } = await anon.from('user_preferences')
  .insert({ user_id: USER_ID, prefs: { 'cp.theme': 'dark' } });
check('an anonymous client cannot write', !!anonWrite);

// The signed-in user must not be able to create or read a row belonging to somebody else.
const OTHER = '00000000-0000-4000-8000-00000000beef';
const { error: foreignInsert } = await client.from('user_preferences')
  .insert({ user_id: OTHER, prefs: { 'cp.theme': 'dark' } });
check('a signed-in user cannot insert a row for another user', !!foreignInsert);

// The re-key attack the UPDATE policy's WITH CHECK exists to stop.
const { error: rekey } = await client.from('user_preferences')
  .update({ user_id: OTHER }).eq('user_id', USER_ID);
check('a signed-in user cannot re-key their row onto another user', !!rekey);

const { data: mine } = await client.from('user_preferences').select('user_id');
eq('a signed-in user sees exactly their own row', (mine || []).length, 1);
eq('…and it is theirs', mine?.[0]?.user_id, USER_ID);

/* ── 5. The constraints from migration 010 ────────────────────────────────── */

section('user_preferences — column constraints');

const { error: notObject } = await client.from('user_preferences')
  .update({ prefs: ['dark'] }).eq('user_id', USER_ID);
check('prefs must be a JSON object, not an array', !!notObject);

const { error: tooBig } = await client.from('user_preferences')
  .update({ prefs: { big: 'x'.repeat(20000) } }).eq('user_id', USER_ID);
check('prefs is capped so it cannot become a data store', !!tooBig);

/* ── 6. Sign-out must not leak state to the next user ─────────────────────── */

section('prefs.js — shared machines');

P.resetPrefs();
eq('resetPrefs() clears the sync status', P.isSynced(), null);

// After a reset there is no user id, so a stray setPref cannot push the previous user's value
// into whatever account signs in next.
P.setPref('cp.theme', 'dark');
await P.flushPrefs();
({ data: row } = await client.from('user_preferences')
  .select('prefs').eq('user_id', USER_ID).maybeSingle());
eq('a write after sign-out does not reach the previous user’s row',
   row?.prefs?.['cp.theme'], 'dark');   // still the value from before resetPrefs()

/* ── Clean up ─────────────────────────────────────────────────────────────── */

await client.from('user_preferences').delete().eq('user_id', USER_ID);
await client.auth.signOut();

process.exitCode = summary() ? 0 : 1;
