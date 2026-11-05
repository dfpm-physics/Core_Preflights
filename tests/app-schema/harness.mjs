// harness.mjs — just enough browser to load the site's real modules in Node.
//
// The goal is to test the SHIPPED files, so this shims only what a browser would provide
// (window, location, localStorage) and never re-implements anything the tests are meant to
// prove. In particular `window.db` is a real supabase-js client configured exactly the way
// site/js/config.js configures it — and test-config.mjs separately proves that config.js
// really does configure it that way, so this shim cannot silently drift from the site.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assertStagingUrl } from './target.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_JS = resolve(HERE, '../../site/js');
export const REPO = resolve(HERE, '../..');

// ── WHICH DATABASE ──────────────────────────────────────────────────────────
// Staging only, and the module refuses to load for any other address. The URL and publishable key
// are read from the staging entry in site/js/config.js (the one place they are written down), and
// the URL must then be EXACTLY the staging address (target.mjs, fail-closed). PREP_TEST_SUPABASE_URL
// exists so test-target-guard.mjs can prove the refusal; no value of it can pass except staging's.
function stagingEntry() {
  const src = readFileSync(resolve(REPO, 'site/js/config.js'), 'utf8');
  const m = /^const PREP_STAGING = \{\s*url:\s*'([^']*)',\s*anon:\s*'([^']*)',?\s*\};/m.exec(src);
  if (!m) throw new Error('REFUSED: cannot read the staging entry from site/js/config.js.');
  return { url: m[1], anon: m[2] };
}
const STAGING = stagingEntry();
export const SUPABASE_URL = assertStagingUrl(process.env.PREP_TEST_SUPABASE_URL ?? STAGING.url);
export const SUPABASE_ANON = STAGING.anon;
if (!SUPABASE_ANON) throw new Error('REFUSED: config.js has no staging publishable key.');

// The deliberate test cadet, made by scripts/staging/seed_staging.py: an invented person at the
// top of the valid cadet-ID range (app.students CHECK is 3000000000..3009999999), created the way
// the other seeded cadets are (sign-in address cadet<last three digits>@prep-staging.example,
// password = the last six digits of the ID, no forced change). No real cadet is involved.
export const TEST_STUDENT = { id: 3009999999, email: 'cadet999@prep-staging.example', password: '999999' };

// Seeded staff, same rules (password = last name in lower case + 1234). Made up.
export const TEST_STAFF = {
  director: { email: 'director@prep-staging.example', password: 'director1234' },
  instructor: { email: 'instructor@prep-staging.example', password: 'instructor1234' },
  admin: { email: 'admin@prep-staging.example', password: 'admin1234' },
  otherDirector: { email: 'otherdirector@prep-staging.example', password: 'otherdirector1234' },
};

/* ── Assertions ───────────────────────────────────────────────────────────── */
let passed = 0, failed = 0;
const failures = [];

export function check(desc, ok, detail = '') {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; failures.push(desc); console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
  return ok;
}

export function eq(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(desc, ok, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function section(title) { console.log(`\n=== ${title} ===`); }

let skipped = 0, xfailed = 0;

/** A check that did NOT run, and says why. Never counted as a pass. */
export function skip(desc, reason) {
  skipped++;
  console.log(`  [SKIPPED] ${desc} — ${reason}`);
}

/**
 * A check whose fix has not shipped yet. While it fails it is reported as an expected failure and
 * does not fail the run. The moment it PASSES it becomes a failure itself, so the marker cannot
 * be left behind once the fix lands. `tag` is a neutral pointer, e.g. 'fix ships in step 2'.
 */
export function expectFail(desc, ok, tag, detail = '') {
  if (ok) {
    failed++; failures.push(`${desc} (expected-fail now passes: remove expectFail)`);
    console.log(`  [FAIL] ${desc} — expected-fail (${tag}) now PASSES; remove the marker`);
    return false;
  }
  xfailed++;
  console.log(`  [xfail] ${desc} — expected-fail: ${tag}${detail ? ` — ${detail}` : ''}`);
  return true;
}

/** Checks recorded so far in this process: passes and failures (skips and expected-fails excluded). */
export function checkCount() { return passed + failed; }

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped, ${xfailed} expected-fail`);
  if (failed) { console.log('Failed:'); failures.forEach(f => console.log(`  - ${f}`)); }
  return failed === 0;
}

/* ── Browser shim ─────────────────────────────────────────────────────────── */

/**
 * Install window/location/localStorage. `pathname` decides how auth.js and util.js compute
 * their relative roots, so tests can exercise the nested-page case (student/…) that the real
 * pages use.
 */
export function installBrowser({ pathname = '/site/student/dashboard.html' } = {}) {
  const store = new Map();
  const redirects = [];

  const location = {
    pathname, search: '', hash: '', href: SUPABASE_URL + pathname,
    replace: (url) => { redirects.push(url); },
    assign: (url) => { redirects.push(url); },
  };

  globalThis.window = globalThis.window || {};
  globalThis.location = location;
  globalThis.window.location = location;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.window.localStorage = globalThis.localStorage;
  globalThis.sessionStorage = globalThis.localStorage;

  return { redirects, store };
}

/** A client configured the way config.js configures it. */
export function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    db: { schema: 'app' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sign in as the test cadet and expose the client as window.db, the way config.js does. */
export async function signInAsTestStudent() {
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_STUDENT.email, password: TEST_STUDENT.password,
  });
  if (error) throw new Error(`Test-student sign-in failed: ${error.message}`);
  globalThis.window = globalThis.window || {};
  globalThis.window.db = client;
  return { client, session: data.session };
}

/** Sign in as one of the seeded staff accounts (TEST_STAFF) and return a client + session. */
export async function signInAsStaff(who) {
  const acct = TEST_STAFF[who];
  if (!acct) throw new Error(`unknown seeded staff account: ${who}`);
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword(acct);
  if (error) throw new Error(`${who} sign-in failed: ${error.message}`);
  globalThis.window = globalThis.window || {};
  globalThis.window.db = client;
  return { client, session: data.session };
}

/** An unauthenticated client — used to prove anon really gets nothing. */
export function anonClient() { return makeClient(); }

export function readRepoFile(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}
