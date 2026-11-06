// test-target-guard.mjs — the live suites can only ever be pointed at staging. OFFLINE.
//
// Every check here runs without a network connection. The refusals are proved by importing or
// launching the guarded code with a wrong target and asserting that it stops BEFORE a client or a
// connection exists: a child process whose import throws never reaches createClient.
//
// The rule being tested is fail-closed: the only accepted target is exactly the staging project,
// so each test feeds in something that is NOT staging and expects a refusal.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { check, eq, section, skip, REPO } from './harness.mjs';
import {
  STAGING_REF, PRODUCTION_REF, STAGING_URL, assertStagingUrl, assertStagingDbUrl, dbUrlRef,
} from './target.mjs';

const HERE = import.meta.dirname;
const refuses = (fn) => { try { fn(); return false; } catch (e) { return /REFUSED/.test(e.message); } };

/* ── 1. the URL rule ─────────────────────────────────────────────────────── */
section('target guard — API address');

check('the staging address is accepted', !refuses(() => assertStagingUrl(STAGING_URL)));
for (const [label, url] of [
  ['the production address', `https://${PRODUCTION_REF}.supabase.co`],
  ['an empty string', ''],
  ['undefined', undefined],
  ['null', null],
  ['a number', 42],
  ['a trailing slash', `${STAGING_URL}/`],
  ['a path', `${STAGING_URL}/rest/v1`],
  ['http instead of https', `http://${STAGING_REF}.supabase.co`],
  ['an upper-cased host', `https://${STAGING_REF.toUpperCase()}.supabase.co`],
  ['the staging ref as a subdomain of another host', `${STAGING_URL}.example.org`],
  ['the staging ref only in the query', `https://${PRODUCTION_REF}.supabase.co/?x=${STAGING_REF}`],
  ['a different project', 'https://abcdefghijklmnopqrst.supabase.co'],
  ['localhost', 'http://localhost:54321'],
]) {
  check(`refused: ${label}`, refuses(() => assertStagingUrl(url)));
}

/* ── 2. the connection-string rule ───────────────────────────────────────── */
section('target guard — database connection string');

const pooler = (ref) => `postgresql://postgres.${ref}:pw@aws-0-example.pooler.supabase.com:5432/postgres`;  // allowlist-secret: invented test URL
const direct = (ref) => `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;  // allowlist-secret: invented test URL
eq('pooler form names its project', dbUrlRef(pooler(STAGING_REF)), STAGING_REF);
eq('direct form names its project', dbUrlRef(direct(STAGING_REF)), STAGING_REF);
check('staging pooler string accepted', !refuses(() => assertStagingDbUrl(pooler(STAGING_REF))));
check('staging direct string accepted', !refuses(() => assertStagingDbUrl(direct(STAGING_REF))));
check('a password holding percent escapes is accepted',
      !refuses(() => assertStagingDbUrl(`postgresql://postgres.${STAGING_REF}:p%40ss@aws-0-example.pooler.supabase.com:5432/postgres`)));  // allowlist-secret: invented test URL
for (const [label, url] of [
  ['production pooler', pooler(PRODUCTION_REF)],
  ['production direct', direct(PRODUCTION_REF)],
  ['empty', ''],
  ['undefined', undefined],
  ['not a URL', 'host=example dbname=postgres'],
  ['unknown project', pooler('abcdefghijklmnopqrst')],
  ['staging user with a production string elsewhere in it',
   `${pooler(STAGING_REF)}?options=${PRODUCTION_REF}`],
  ['a user that merely contains the staging ref',
   `postgresql://postgres.x${STAGING_REF}:pw@aws-0-example.pooler.supabase.com:5432/postgres`],  // allowlist-secret: invented test URL
  ['a user override in the query', `${pooler(STAGING_REF)}?user=postgres.${PRODUCTION_REF}`],
  ['a host override in the query', `${pooler(STAGING_REF)}?host=db.${PRODUCTION_REF}.supabase.co`],
  ['a dbname override in the query', `${pooler(STAGING_REF)}?dbname=other`],
  ['an options override in the query', `${pooler(STAGING_REF)}?options=x`],
  ['a service override in the query', `${pooler(STAGING_REF)}?service=x`],
  ['a hostaddr override in the query', `${pooler(STAGING_REF)}?hostaddr=10.0.0.1`],
  ['a percent-escaped production ref in the user', pooler(PRODUCTION_REF.slice(0, -2) + '%' + '77' + PRODUCTION_REF.slice(-1))],
  ['a percent-escaped production ref in the host', direct(PRODUCTION_REF.slice(0, -2) + '%' + '77' + PRODUCTION_REF.slice(-1))],
  ['an upper-case staging ref', pooler(STAGING_REF.toUpperCase())],
  ['a user and host that disagree',
   `postgresql://postgres.${STAGING_REF}:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`],  // allowlist-secret: invented test URL
  ['two @ signs', `postgresql://postgres.${STAGING_REF}:p@w@aws-0-example.pooler.supabase.com:5432/postgres`],  // allowlist-secret: invented test URL
  ['a trailing dot on a production direct host', `postgresql://postgres.${STAGING_REF}:pw@db.${PRODUCTION_REF}.supabase.co.:5432/postgres`],  // allowlist-secret: invented test URL
  ['a trailing dot on the staging direct host', `postgresql://postgres:pw@db.${STAGING_REF}.supabase.co.:5432/postgres`],  // allowlist-secret: invented test URL
  ['a trailing dot on a pooler host', `postgresql://postgres.${STAGING_REF}:pw@aws-0-example.pooler.supabase.com.:5432/postgres`],  // allowlist-secret: invented test URL
  ['a host outside the allow-list', `postgresql://postgres.${STAGING_REF}:pw@evil.example:5432/postgres`],  // allowlist-secret: invented test URL
  ['an upper-case direct host', `postgresql://postgres:pw@DB.${STAGING_REF}.SUPABASE.CO:5432/postgres`],  // allowlist-secret: invented test URL
  ['a non-ASCII digit port', `postgresql://postgres.${STAGING_REF}:pw@aws-0-example.pooler.supabase.com:٥٤٣٢/postgres`],  // allowlist-secret: invented test URL
  ['an empty host', `postgresql://postgres.${STAGING_REF}:pw@/postgres`],  // allowlist-secret: invented test URL
]) {
  check(`refused: ${label}`, refuses(() => assertStagingDbUrl(url)));
}

/* ── 3. the harness refuses at import time ───────────────────────────────── */
section('target guard — harness.mjs, run.mjs');

function node(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: HERE, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ...env },
  });
}
const probe = "import('./harness.mjs').then(()=>console.log('LOADED'),e=>{console.error(e.message);process.exit(7)})";

{
  const ok = node(['-e', probe], { PREP_TEST_SUPABASE_URL: '' });
  // '' is "set but not staging": it must not fall through to the default.
  check('harness refuses an empty override (no silent fallback)', ok.status === 7 && /REFUSED/.test(ok.stderr), ok.stderr);
}
for (const [label, url] of [
  ['the production address', `https://${PRODUCTION_REF}.supabase.co`],
  ['an unknown project', 'https://abcdefghijklmnopqrst.supabase.co'],
]) {
  const r = node(['-e', probe], { PREP_TEST_SUPABASE_URL: url });
  check(`harness refuses to load for ${label}`,
        r.status === 7 && /REFUSED/.test(r.stderr) && !/LOADED/.test(r.stdout), r.stderr);
}
{
  const clean = spawnSync(process.execPath, ['-e', probe], {
    cwd: HERE, encoding: 'utf8', env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'PREP_TEST_SUPABASE_URL')),
  });
  check('harness loads with no override (control: the default is staging)',
        clean.status === 0 && /LOADED/.test(clean.stdout), clean.stderr);
}
{
  const r = node(['run.mjs'], { PREP_TEST_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  check('run.mjs refuses a production target before running anything',
        r.status !== 0 && /REFUSED/.test(r.stderr) && !/=== /.test(r.stdout), r.stderr || r.stdout);
}

/* ── 4. cleanup.py refuses ───────────────────────────────────────────────── */
section('target guard — cleanup.py');

{
  const py = process.env.PREP_PYTHON || 'python';
  const probePy = spawnSync(py, ['--version'], { encoding: 'utf8' });
  if (probePy.error || probePy.status !== 0) {
    skip('cleanup.py refusals', `no python on PATH (set PREP_PYTHON): ${probePy.error?.code || probePy.status}`);
  } else {
    const run = (urlEnv) => spawnSync(py, [join(HERE, 'cleanup.py'), '--commit'], {
      encoding: 'utf8', timeout: 30000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'STAGING_DB_URL')),
             ...(urlEnv === undefined ? {} : { STAGING_DB_URL: urlEnv }) },
    });
    for (const [label, url] of [
      ['a production pooler string', pooler(PRODUCTION_REF)],
      ['a production direct string', direct(PRODUCTION_REF)],
      ['an unknown project', pooler('abcdefghijklmnopqrst')],
      ['a staging string with a production user in the query', `${pooler(STAGING_REF)}?user=postgres.${PRODUCTION_REF}`],
      ['a percent-escaped production ref', direct(PRODUCTION_REF.slice(0, -2) + '%' + '77' + PRODUCTION_REF.slice(-1))],
      ['an unset variable', undefined],
      ['an empty variable', ''],
    ]) {
      const r = run(url);
      // The refusal must be the guard's own message: a missing-module crash would also exit
      // non-zero and would prove nothing. And it must come before any connection attempt.
      check(`cleanup.py refuses ${label}`,
            r.status !== 0 && /REFUSED/.test(r.stderr + r.stdout) && !/Traceback/.test(r.stderr),
            (r.stderr || r.stdout || '').trim().slice(-200));
    }
  }
}

/* ── 5. nothing in tests/ can reach production by another route ──────────── */
section('target guard — no production address or credential file in tests/');

const cfg = readFileSync(resolve(REPO, 'site/js/config.js'), 'utf8');
const prodEntry = /const PREP_PROD = \{\s*url:\s*'([^']*)',\s*anon:\s*'([^']*)'/.exec(cfg);
const stagingEntry = /const PREP_STAGING = \{\s*url:\s*'([^']*)',\s*anon:\s*'([^']*)'/.exec(cfg);
check('config.js has both entries', !!prodEntry && !!stagingEntry);
eq('config.js staging address equals the guard\'s', stagingEntry?.[1], STAGING_URL);
eq('config.js production address names the production ref', prodEntry?.[1], `https://${PRODUCTION_REF}.supabase.co`);
check('the two publishable keys differ', prodEntry?.[2] !== stagingEntry?.[2]);

// Files that legitimately name the production ref, because they are the guards or test them.
const MAY_NAME_PRODUCTION = new Set([
  'tests/app-schema/target.mjs', 'tests/app-schema/staging_guard.py',
  'tests/app-schema/test-target-guard.mjs', 'tests/app-schema/test-config.mjs',
  'tests/browser-harness/env.mjs',
  'tests/walk/lib.mjs',
]);
const forbidden = [PRODUCTION_REF, prodEntry?.[2], 'admin/.env', 'app_tier_check', 'admin/config.json']
  .filter(Boolean);
const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.venv') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(mjs|js|py|html)$/.test(name)) continue;
    const rel = relative(REPO, full).split(sep).join('/');
    if (MAY_NAME_PRODUCTION.has(rel)) continue;
    const text = readFileSync(full, 'utf8');
    for (const f of forbidden) if (text.includes(f)) hits.push(`${rel}: ${f === prodEntry?.[2] ? '<production key>' : f}`);
  }
})(resolve(REPO, 'tests'));
eq('no other file under tests/ names the production project, its key, or a production credential file', hits, []);
