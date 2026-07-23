// env.mjs — read the P0.5 test-faculty credentials from the gitignored supabase/admin/.env.
//
// The email, password and UID live there (PREP_TEST_FACULTY_*), beside the DB role creds and read
// by scripts/test_faculty_account.py, so the walkthrough has one source of truth and no secret
// ever reaches a command line, a shell history, or a scratch file. The harness scripts fall back
// to this when --email/--password/--lesson are not passed explicitly.
//
// A minimal KEY=VALUE parser, matching app_tier_check.read_env (stdlib, no dotenv dependency —
// the site has no Node build step and this tooling adds none it can avoid).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, '../../supabase/admin/.env');

/** Parse the admin .env into a plain object. Returns {} if it does not exist. */
export function readAdminEnv() {
  let raw;
  try { raw = readFileSync(ENV_FILE, 'utf8'); }
  catch { return {}; }

  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    let v = s.slice(i + 1).trim();
    if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
      v = v.slice(1, -1);
    }
    out[s.slice(0, i).trim()] = v;
  }
  return out;
}

/** The test-faculty triple, from the env. Any field may be undefined if the block is absent. */
export function testFaculty() {
  const e = readAdminEnv();
  return {
    email: e.PREP_TEST_FACULTY_EMAIL,
    password: e.PREP_TEST_FACULTY_PASSWORD,
    uid: e.PREP_TEST_FACULTY_UID,
  };
}
