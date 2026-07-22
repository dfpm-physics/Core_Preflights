// prefs.js — preferences that follow the person instead of the browser.  (Roadmap P1.3)
//
// ── THE SHAPE, AND WHY IT IS THIS SHAPE ──────────────────────────────────────────
// localStorage stays the READ path. `app.user_preferences` is the DURABILITY path. Every
// write goes to both; every read comes from localStorage alone.
//
// That is not hedging, it is forced by one line of markup: the anti-FOUC snippet at line 7 of
// every HTML file reads `cp.theme` synchronously, before any module has loaded and long before
// a network round-trip could finish. Make the theme a database read and you reintroduce the
// flash of the wrong theme on every page load — a visibly worse product, in exchange for
// durability nobody sees. So the browser keeps a cache it can read at first paint, and the
// database makes that cache survive a device change.
//
// ── RECONCILIATION: THE DATABASE WINS AT SIGN-IN, LOCAL WINS AFTERWARDS ──────────
// hydrate() runs once per page load, inside bootstrap(), before anything reads a preference.
// It overwrites the local cache from the row. After that, every setPref() writes local first
// (instant) and pushes to the row (debounced).
//
// The one visible consequence: if this browser's cached theme disagrees with the row, the page
// paints the cached theme and then corrects itself a beat later. That is deliberate. The
// alternative — waiting for the row before painting — costs every page load a blank screen to
// fix a disagreement that only occurs the first time a person opens PREP on a new device.
//
// A key written on ANOTHER device DURING this session is clobbered by this session's next
// push, because the push sends the whole merged object rather than a patch. Two devices open at
// once, both changing preferences, is not a real scenario for one person's view settings, and
// the fix (per-key timestamps, or a server-side jsonb merge) costs more than the problem.
//
// ── WHAT IS NOT SYNCED, AND WHY THAT IS A DECISION ───────────────────────────────
// Only SYNCED_KEYS travel. Three existing localStorage keys are deliberately left behind:
//
//   cp.nav.open            whether the sidebar is expanded — a property of THIS screen's width
//   cp.runbanner.dismissed which run banners you have dismissed — "I have seen this" is about
//                          this browser session, and syncing it would hide a banner on a
//                          machine where you never saw it
//   cp.system.columns/tables  the System > Data column picker, which system-prefs.js documents
//                          at length as per-browser on purpose
//
// The test is whether the setting describes the PERSON or the DEVICE. Theme and course describe
// the person. Sidebar state describes a window.
//
// ── NOTHING HERE MAY BE TRUSTED FOR AUTHORIZATION ────────────────────────────────
// The RLS policy on user_preferences is self-write, so the signed-in user can put any value in
// this bag from a console. It decides what a page shows FIRST, never what it is allowed to
// show. `cp.currentOffering` in particular selects a scope; it does not grant one — auth.js
// re-derives every offering from staff_assignments and ignores a stored value that is not in
// that list (see sortAndPick).

// NOTE: supabase.js is imported LAZILY inside the two functions that talk to the database, not
// at module scope. It throws when window.db is absent, and theme.js imports this module — which
// means a static import here would give nav.js, and therefore every page's chrome, a hard
// dependency on a live client just to read a cached theme. Two suites assert that nav and the
// login page import cleanly without one, and they are right to: the theme has to work on
// login.html, which has no session at all.
let _db = null;
async function database() {
  if (!_db) ({ db: _db } = await import('./supabase.js'));
  return _db;
}

/** The keys that follow the person. Everything else stays in this browser. */
export const SYNCED_KEYS = [
  'cp.theme',              // theme.js
  'cp.currentOffering',    // auth.js — "<courseCode>|<termCode>"
  'cp.rollup.understanding', // faculty-rollup.js — P1.5 histogram vs. rows
];

const PUSH_DEBOUNCE_MS = 800;

/** Mirror of the row for this session, so a push never sends a partial object. */
let merged = {};
/** null until hydrate() has run; false when the row could not be reached. */
let synced = null;
let userId = null;
let timer = null;
let pending = false;

/* ── localStorage, every access guarded ──────────────────────────────────────────
 * Private browsing and a full quota both throw. A page that cannot cache a preference
 * must still render, so nothing in here is allowed to propagate an exception.
 */
export function readLocal(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

export function writeLocal(key, value) {
  try {
    if (value == null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch (_) { /* no cache available — the row is still authoritative */ }
}

/** Read a preference. Synchronous by design: callers run at first paint. */
export function getPref(key, fallback = null) {
  const v = readLocal(key);
  return v == null ? fallback : v;
}

/**
 * Set a preference: local immediately, row shortly after.
 *
 * Returns nothing and never rejects. A preference that fails to persist is not worth
 * interrupting a click for — it degrades to the pre-P1.3 behaviour, which is a working
 * browser-local setting.
 */
export function setPref(key, value) {
  writeLocal(key, value);
  if (!SYNCED_KEYS.includes(key)) return;
  if (value == null || value === '') delete merged[key];
  else merged[key] = String(value);
  schedulePush();
}

/* ── The push ──────────────────────────────────────────────────────────────────── */

function schedulePush() {
  if (!userId) return;              // signed out, or hydrate() never ran
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(flushPrefs, PUSH_DEBOUNCE_MS);
}

/**
 * Write the merged bag now. Exported because a debounce loses the last change when the
 * page is closing — see the pagehide listener at the bottom.
 */
export async function flushPrefs() {
  clearTimeout(timer);
  if (!pending || !userId) return;
  pending = false;
  try {
    const db = await database();
    const { error } = await db.from('user_preferences')
      .upsert({ user_id: userId, prefs: merged }, { onConflict: 'user_id' });
    synced = !error;
    if (error) console.warn('[prefs] could not save preferences:', error.message);
  } catch (err) {
    synced = false;
    console.warn('[prefs] could not save preferences:', err?.message || err);
  }
}

/* ── Hydration ─────────────────────────────────────────────────────────────────── */

/**
 * Pull the row into the local cache. Call once per page load, from bootstrap(), BEFORE
 * anything reads a preference — auth.js reads `cp.currentOffering` while picking the current
 * offering, so hydrating after that point would apply the stored course one navigation late.
 *
 * @param {string} uid  auth user id
 * @returns {Promise<{synced: boolean, changed: string[]}>} keys whose local value was replaced
 */
export async function hydrate(uid) {
  userId = uid || null;
  merged = {};
  const changed = [];
  if (!userId) { synced = false; return { synced: false, changed }; }

  let row = null;
  try {
    const db = await database();
    const { data, error } = await db.from('user_preferences')
      .select('prefs').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    row = data;
    synced = true;
  } catch (err) {
    // No row is not an error; an unreachable table is. Either way the page works from cache.
    synced = false;
    console.warn('[prefs] preferences not loaded, using this browser only:',
                 err?.message || err);
    return { synced: false, changed };
  }

  const remote = (row && typeof row.prefs === 'object' && row.prefs) || null;

  if (!remote || !Object.keys(remote).length) {
    // First sign-in on any device, or a brand-new account: seed the row from whatever this
    // browser already had, so an existing user does not lose the theme they have been using.
    SYNCED_KEYS.forEach(k => {
      const local = readLocal(k);
      if (local != null && local !== '') merged[k] = local;
    });
    if (Object.keys(merged).length) { pending = true; await flushPrefs(); }
    return { synced, changed };
  }

  SYNCED_KEYS.forEach(k => {
    if (!(k in remote)) {
      // Present locally but not in the row — carry it up rather than dropping it.
      const local = readLocal(k);
      if (local != null && local !== '') { merged[k] = local; pending = true; }
      return;
    }
    const value = remote[k] == null ? '' : String(remote[k]);
    merged[k] = value;
    if (readLocal(k) !== value) { writeLocal(k, value); changed.push(k); }
  });

  if (pending) await flushPrefs();
  return { synced, changed };
}

/**
 * Whether preferences are reaching the database.
 *   true   saved to your account
 *   false  this browser only (offline, or the table is unreachable)
 *   null   not determined yet — hydrate() has not run
 * The account page renders this so "saved to this browser only" stops being a claim the UI
 * makes without checking.
 */
export function isSynced() { return synced; }

/** Forget this session's state. Called on sign-out so the next user starts clean. */
export function resetPrefs() {
  clearTimeout(timer);
  merged = {}; synced = null; userId = null; pending = false;
}

// A debounced write is lost if the tab closes inside the debounce window — which is exactly
// what happens when someone flips the theme and immediately closes the laptop. `pagehide`
// fires in that path (unlike `unload`, it is reliable on mobile Safari and with bfcache).
//
// Feature-detected rather than assumed: this module is imported by the Node test harness and by
// test-imports.mjs, neither of which is a browser. A storage module that throws at import time
// takes the whole page down with it, so it checks before it subscribes.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { flushPrefs(); });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPrefs();
  });
}
