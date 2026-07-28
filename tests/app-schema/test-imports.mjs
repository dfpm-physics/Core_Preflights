// test-imports.mjs — every import in site/ resolves to something that actually exists.
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
installBrowser({ pathname: '/site/student/dashboard.html' });
globalThis.window.db = makeClient();

const APP = resolve(REPO, 'site');

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

section('static import integrity across site/');

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

/* ══════════════════════════════════════════════════════════════════════════════
 * Used-but-not-imported
 *
 * The check above proves every import RESOLVES. It says nothing about identifiers a file
 * USES without importing — which is the failure this project actually keeps producing,
 * because renaming an export leaves call sites behind and there is no linker to notice.
 * Two real instances on 2026-07-20: `R.removeStudent` survived a rename to
 * `removeEnrollment`, and a page called `runPage()` without importing it. Both are silent
 * until the moment a user clicks, or a page loads and shows a spinner forever.
 * ════════════════════════════════════════════════════════════════════════════ */
section('used-but-not-imported');

const NS_RE = /import\s+\*\s+as\s+([\w$]+)\s+from\s+['"]([^'"]+)['"]/g;
const missing = [];

/**
 * Strip comments before looking for calls. Without this, prose describing a function reads
 * as a call to it — the first run of this check flagged nav.js for "calling" legacyUrl()
 * inside a comment explaining why it no longer needs to. Naive is fine here: the goal is to
 * stop commentary from being mistaken for code, not to parse JavaScript.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');

for (const file of files) {
  for (const raw of moduleSources(file)) {
    const src = stripComments(raw);
    const rel = relative(REPO, file).replace(/\\/g, '/');

    // ── namespace imports: `import * as R from './x.js'` then `R.foo(...)`
    NS_RE.lastIndex = 0;
    let m;
    while ((m = NS_RE.exec(src))) {
      const [, alias, spec] = m;
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      const names = await exportsOf(target);
      if (!names || names.error) continue;
      const used = new Set([...src.matchAll(new RegExp(`\\b${alias}\\.([\\w$]+)`, 'g'))].map(x => x[1]));
      for (const nm of used) {
        if (!names.has(nm)) {
          missing.push(`${rel}: uses ${alias}.${nm}() — not exported by ${relative(REPO, target).replace(/\\/g, '/')}`);
        }
      }
    }

    // ── named imports: a helper this file calls, exported by a module it already imports
    //    from, but absent from its own import list — and not declared locally either.
    const importedHere = new Set();
    const importedFrom = new Set();
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const [, , named, ns, spec] = m;
      if (!spec.startsWith('.')) continue;
      importedFrom.add(resolve(dirname(file), spec));
      if (ns) importedHere.add(ns);
      for (const raw of (named || '').split(',')) {
        const nm = raw.trim().split(/\s+as\s+/).pop().trim();
        if (nm) importedHere.add(nm);
      }
    }
    // Anything the file declares itself is fair game.
    const declared = new Set(
      [...src.matchAll(/(?:function|const|let|var|class)\s+([\w$]+)/g)].map(x => x[1]));

    for (const target of importedFrom) {
      const names = await exportsOf(target);
      if (!names || names.error) continue;
      for (const nm of names) {
        if (importedHere.has(nm) || declared.has(nm)) continue;
        // Called as a bare function, not as a property of something else.
        if (new RegExp(`(^|[^.\\w$])${nm}\\s*\\(`, 'm').test(src)) {
          missing.push(`${rel}: calls ${nm}() but does not import it ` +
                       `(exported by ${relative(REPO, target).replace(/\\/g, '/')})`);
        }
      }
    }
  }
}

check(`no identifier is used without being imported`, missing.length === 0);
[...new Set(missing)].forEach(p => console.log(`         ${p}`));

process.exitCode = (problems.length === 0 && missing.length === 0) ? 0 : 1;

// This suite runs in its OWN process (see run.mjs). It has to: verifying imports means
// importing every module, and site/js/supabase.js binds `window.db` once at import time
// (`export const db = window.db`). Doing that with the unauthenticated client used here
// would leave every later suite holding a signed-out client, and the end-to-end tests would
// fail at bootstrap for a reason that has nothing to do with the code under test.

