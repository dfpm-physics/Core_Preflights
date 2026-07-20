// test-config.mjs — prove site/app/js/config.js targets schema `app`.
//
// config.js is a CLASSIC script, not a module: it expects a global `supabase` (the CDN UMD
// bundle) and assigns window.db. Rather than parse it with a regex — which would pass on a
// commented-out line — this evaluates the real file with a stub `supabase.createClient` that
// captures the options it was actually called with.
//
// It also guards the split that keeps the legacy site alive: site/js/config.js (admin.html,
// index.html) must stay on `public`. Pointing both at `app` would silently break the legacy
// pages, and pointing this one back at `public` would silently un-wire the portal.

import vm from 'node:vm';
import { check, eq, section, readRepoFile } from './harness.mjs';

section('config.js — schema targeting');

function evalConfig(relPath) {
  const src = readRepoFile(relPath);
  let captured = null;
  const sandbox = {
    supabase: { createClient: (url, key, opts) => { captured = { url, key, opts }; return { __stub: true }; } },
    window: {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return { captured, sandbox };
}

const app = evalConfig('site/app/js/config.js');
check('site/app/js/config.js calls createClient', !!app.captured);
eq('…targeting schema `app`', app.captured?.opts?.db?.schema, 'app');
check('…and assigns window.db', app.sandbox.window.db != null);
check('…against the expected project', String(app.captured?.url).includes('shzvpmlnqfmzfmuxkowi'));
check('…with a publishable (not secret) key',
      String(app.captured?.key).startsWith('sb_publishable_'),
      'a service/secret key must never appear in a committed frontend file');

const legacy = evalConfig('site/js/config.js');
check('legacy site/js/config.js still calls createClient', !!legacy.captured);
check('…and is NOT switched to `app` (the legacy pages stay on public)',
      (legacy.captured?.opts?.db?.schema ?? 'public') !== 'app',
      'legacy admin.html/index.html read public; moving them would break them');
