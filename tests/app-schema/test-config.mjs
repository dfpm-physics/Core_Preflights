// test-config.mjs — prove site/js/config.js targets schema `app`.
//
// config.js is a CLASSIC script, not a module: it expects a global `supabase` (the CDN UMD
// bundle) and assigns window.db. Rather than parse it with a regex — which would pass on a
// commented-out line — this evaluates the real file with a stub `supabase.createClient` that
// captures the options it was actually called with.
//
// Until the 2026-07-28 promotion there were TWO configs and this file guarded the split
// between them: the portal's at site/app/js/config.js on `app`, the legacy site's at
// site/js/config.js on `public`. The promotion deleted the legacy pages and moved the
// portal's config onto that path, so the split is gone and there is exactly one config.
// What is worth guarding now is that nothing has re-created a second one, and that the
// surviving one still targets `app` — pointing it back at `public` would silently un-wire
// the whole site.

import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, eq, section, readRepoFile, REPO } from './harness.mjs';

section('config.js — schema targeting');

const LIVE_ADDRESS = { hostname: 'dfpm-physics.github.io', pathname: '/Core_Preflights/site/index.html' };

function evalConfig(relPath, location = LIVE_ADDRESS, patch = (s) => s) {
  const src = patch(readRepoFile(relPath));
  let captured = null;
  const sandbox = {
    supabase: { createClient: (url, key, opts) => { captured = { url, key, opts }; return { __stub: true }; } },
    window: {},
    location,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return { captured, sandbox };
}

const app = evalConfig('site/js/config.js');
check('site/js/config.js calls createClient', !!app.captured);
eq('…targeting schema `app`', app.captured?.opts?.db?.schema, 'app');
check('…and assigns window.db', app.sandbox.window.db != null);
check('…against the expected project', String(app.captured?.url).includes('shzvpmlnqfmzfmuxkowi'));
check('…with a publishable (not secret) key',
      String(app.captured?.key).startsWith('sb_publishable_'),
      'a service/secret key must never appear in a committed frontend file');

// Which database. Production only on the exact published address; every other address gets
// staging, and a missing staging key throws rather than falling back to production. The key is
// patched in here so this check does not depend on whether the real one has been filled in yet.
section('config.js — only the published address reaches production');

const PROD_REF = 'shzvpmlnqfmzfmuxkowi';
const STAGING_REF = 'wkibeptktbnaddfynrwr';
const withKey = (s) => s.replace(/(url: 'https:\/\/wkibeptktbnaddfynrwr\.supabase\.co',\s*anon: )'[^']*'/,
                                 "$1'sb_publishable_TEST'");

for (const [label, loc] of [
  ['localhost', { hostname: 'localhost', pathname: '/site/index.html' }],
  ['127.0.0.1', { hostname: '127.0.0.1', pathname: '/site/index.html' }],
  ['a file', { hostname: '', pathname: '/C:/repo/site/index.html' }],
  ['a staging repo on the same github.io host',
   { hostname: 'dfpm-physics.github.io', pathname: '/iPREP-staging/site/index.html' }],
  ['a look-alike path', { hostname: 'dfpm-physics.github.io', pathname: '/Core_Preflights2/site/' }],
  ['a look-alike host', { hostname: 'dfpm-physics.github.io.example.com', pathname: '/Core_Preflights/site/' }],
]) {
  const r = evalConfig('site/js/config.js', loc, withKey);
  check(`${label} gets staging`, String(r.captured?.url).includes(STAGING_REF));
  check(`${label} never names production`, !String(r.captured?.url).includes(PROD_REF));
}

let threw = false;
try {
  evalConfig('site/js/config.js', { hostname: 'localhost', pathname: '/site/' },
             (s) => s.replace(/(url: 'https:\/\/wkibeptktbnaddfynrwr\.supabase\.co',\s*anon: )'[^']*'/, "$1''"));
} catch { threw = true; }
check('a missing staging key throws, with no fallback to production', threw);

// The promotion's other half: no second config, and no legacy page left to need one. A
// resurrected site/app/js/config.js would mean the tree got partially un-promoted; a
// resurrected admin.html would be a page reading `public` behind the site's back.
section('the legacy split is gone');

const gone = (rel) => !existsSync(join(REPO, rel));

check('no second config at site/app/js/config.js', gone('site/app/js/config.js'),
      'two configs means the tree is half-promoted');
for (const p of ['site/admin.html', 'site/interactions.html',
                 'site/interactions-admin.html', 'site/review.html']) {
  check(`legacy page ${p} is deleted`, gone(p),
        'a surviving legacy page would still be reading schema public');
}
