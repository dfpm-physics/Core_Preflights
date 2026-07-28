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

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_JS = resolve(HERE, '../../site/js');
export const REPO = resolve(HERE, '../..');

export const SUPABASE_URL = 'https://shzvpmlnqfmzfmuxkowi.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru';

// The deliberate test row at the top of the valid cadet-ID range (app.students CHECK is
// 3000000000..3009999999). Password follows the documented provisioning default: the last
// six digits of the id. No real cadet account is involved.
export const TEST_STUDENT = { id: 3009999999, email: '3009999999@usafa.edu', password: '999999' };

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

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
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

/** An unauthenticated client — used to prove anon really gets nothing. */
export function anonClient() { return makeClient(); }

export function readRepoFile(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}
