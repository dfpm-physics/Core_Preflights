// test-imports.mjs — every import in site/app/ resolves to something that actually exists.
//
// WHY THIS EARNS ITS PLACE
//   The project has no build step by design (CORE.md §2), so nothing type-checks and nothing
//   links. A renamed export or a stale import is therefore invisible until a page is opened
//   in a browser and silently fails — which is exactly the failure mode a schema migration
//   produces, because renaming is most of the work.
//
//   This walks every .js module and every inline <script type="module"> in the app tree,
//   extracts the named imports, and checks each one against the target module's real exports.
//   It is a linker, not a linter: no style opinions, one question only — does this resolve?

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, section, REPO, installBrowser, makeClient } from './harness.mjs';

// The site's modules are browser modules: they read `location` at import time and expect
// `window.db` to already exist (config.js, a classic script, sets it). Install both BEFORE
// importing anything, or every module fails to load and the check reports noise instead of
// the one thing it is for.
installBrowser({ pathname: '/site/app/student/dashboard.html' });
globalThis.window.db = makeClient();

const APP = resolve(REPO, 'site/app');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(name)) out.push(p);
  }
  return out;
}

/** Pull the module source out of a file: the file itself, or its inline module scripts. */
function moduleSources(file) {
  const src = readFileSync(file, 'utf8');
  if (file.endsWith('.js')) return [src];
  const out = [];
  const re = /<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

// `import { a, b as c } from './x.js'` and `import * as NS from './x.js'`
const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s*as\s+([\w$]+))\s+from\s+['"]([^'"]+)['"]/g;

section('static import integrity across site/app/');

const files = walk(APP);
const exportCache = new Map();

async function exportsOf(absPath) {
  if (exportCache.has(absPath)) return exportCache.get(absPath);
  let names = null;
  try {
    const mod = await import(pathToFileURL(absPath).href);
    names = new Set(Object.keys(mod));
  } catch (e) {
    names = { error: e.message };
  }
  exportCache.set(absPath, names);
  return names;
}

let checked = 0;
const problems = [];

for (const file of files) {
  for (const src of moduleSources(file)) {
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const [, , named, namespace, spec] = m;
      if (!spec.startsWith('.')) continue;                 // CDN / bare specifiers
      const target = resolve(dirname(file), spec);
      const rel = relative(REPO, file).replace(/\\/g, '/');
      const relTarget = relative(REPO, target).replace(/\\/g, '/');

      const names = await exportsOf(target);
      if (names && names.error) {
        // A module that cannot even be imported here may legitimately depend on a browser
        // global (config.js sets window.db). Report it rather than pretending it passed.
        problems.push(`${rel} -> ${relTarget}: module failed to load (${names.error})`);
        continue;
      }
      if (namespace) { checked++; continue; }              // `* as NS` — nothing to verify

      for (const raw of (named || '').split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        checked++;
        if (!names.has(name)) {
          problems.push(`${rel}: imports { ${name} } from '${spec}' — not exported by ${relTarget}`);
        }
      }
    }
  }
}

check(`all ${checked} named imports resolve`, problems.length === 0);
problems.forEach(p => console.log(`         ${p}`));

// This suite runs in its OWN process (see run.mjs). It has to: verifying imports means
// importing every module, and site/app/js/supabase.js binds `window.db` once at import time
// (`export const db = window.db`). Doing that with the unauthenticated client used here
// would leave every later suite holding a signed-out client, and the end-to-end tests would
// fail at bootstrap for a reason that has nothing to do with the code under test.
process.exitCode = problems.length === 0 ? 0 : 1;
