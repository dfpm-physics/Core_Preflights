// test-modals.mjs — every dialog in site/ is dismissed through the one shared rule.
//
// WHY THIS EARNS ITS PLACE
//   `wireModalDismiss()` (util.js) exists because the naive `if (e.target === backdrop) close()`
//   loses work: drag to select text, release outside the dialog, and the browser fires `click` on
//   the common ancestor — the backdrop — so the dialog closes and everything typed into it is
//   gone. tests/browser-harness/modal.mjs proves the shared rule is RIGHT, with a real mouse.
//
//   This file proves it is APPLIED. On 2026-07-30 the fix was landed and announced as covering
//   every dialog; four were missed, including the lesson editor — the one where the loss is a
//   whole authored question set, and the one the director hit again the same day. Nothing caught
//   it because a missed dialog is not a broken dialog: it parses, it renders, it opens and closes.
//   The only way to see it is to enumerate the backdrops and check each one, which is this file.
//
//   So: every `.modal-backdrop` in site/ must be passed to wireModalDismiss(), or be listed in
//   OPEN_CODED below with the reason it is not. Adding a dialog means answering the question.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, section, REPO } from './harness.mjs';

const APP = join(REPO, 'site');

/* Dialogs that deliberately do NOT call the shared helper. Each one is audited by hand, applies
 * the same both-ends-on-the-backdrop rule inline, and says here why it cannot share the helper. */
const OPEN_CODED = {
  // A one-shot promise: it resolves false on dismissal and removes its own listeners, so its
  // `close` is not a plain function and it must not outlive the answer. lessons.html:~1690.
  'swap-modal': 'promptSwapConfirm() — one-shot promise, removes its own listeners',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** The module source of an HTML page: its inline `<script type="module">` blocks, joined. */
function moduleSource(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const re = /<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out.join('\n');
}

/** Every `id` on an element carrying class `modal-backdrop`, in document order. */
function backdropIds(file) {
  const src = readFileSync(file, 'utf8');
  const ids = [];
  for (const m of src.matchAll(/<div\b([^>]*\bclass=["'][^"']*\bmodal-backdrop\b[^"']*["'][^>]*)>/g)) {
    const id = /\bid=["']([^"']+)["']/.exec(m[1]);
    if (id) ids.push(id[1]);
  }
  return ids;
}

/**
 * The backdrop ids a page actually hands to wireModalDismiss(). Four spellings are in use, so
 * all four are resolved rather than requiring one house style:
 *   1. wireModalDismiss(document.getElementById('x'), …)
 *   2. const m = document.getElementById('x');  …  wireModalDismiss(m, …)
 *   3. ['a','b'].forEach(id => { const m = document.getElementById(id); wireModalDismiss(m, …) })
 *   4. a bare identifier already resolved by (2) under a different name
 */
function wiredIds(src) {
  const ids = new Set();

  for (const m of src.matchAll(/wireModalDismiss\(\s*document\.getElementById\(\s*['"]([\w-]+)['"]/g)) {
    ids.add(m[1]);
  }

  // Nearest PRECEDING binding, not a name→id map: half the pages call the local `m`, several
  // times each in different functions, so a flat map resolves every one of them to whichever
  // assignment happened to come last and reports the rest as unwired.
  for (const call of src.matchAll(/wireModalDismiss\(\s*([\w$]+)\s*[,)]/g)) {
    const bind = new RegExp(`(?:const|let|var)\\s+${call[1]}\\s*=\\s*document\\.getElementById\\(\\s*['"]([\\w-]+)['"]\\s*\\)`, 'g');
    let last = null, b;
    while ((b = bind.exec(src)) && b.index < call.index) last = b[1];
    if (last) ids.add(last);
  }

  // The loop form: an array literal of ids whose .forEach body wires each one.
  for (const m of src.matchAll(/\[([^\]]*)\]\s*\.forEach\(/g)) {
    const body = src.slice(m.index, m.index + 400);
    if (!body.includes('wireModalDismiss')) continue;
    for (const lit of m[1].matchAll(/['"]([\w-]+)['"]/g)) ids.add(lit[1]);
  }

  return ids;
}

section('every dialog is dismissed through wireModalDismiss()');

const pages = walk(APP);
const unwired = [];
let dialogs = 0;

for (const file of pages) {
  const rel = relative(REPO, file).replace(/\\/g, '/');
  const ids = backdropIds(file);
  if (!ids.length) continue;
  const wired = wiredIds(moduleSource(file));
  for (const id of ids) {
    dialogs++;
    if (wired.has(id) || OPEN_CODED[id]) continue;
    unwired.push(`${rel}: #${id} is a .modal-backdrop that never reaches wireModalDismiss()`);
  }
}

// A floor, so deleting the pages rather than fixing them cannot turn this suite green.
check(`found the site's dialogs to audit (${dialogs})`, dialogs >= 20);
check(`all ${dialogs} dialogs use the shared dismissal rule`, unwired.length === 0);
unwired.forEach(p => console.log(`         ${p}`));

/* ── The naive rule must not come back ─────────────────────────────────────────
 * Re-adding `e.target === backdrop` beside a close() is how this regressed the first time: it
 * reads as obviously correct and is invisible until a hand drags across the edge. The helper
 * itself contains the only legitimate copy — and, inside it, the comparison is guarded by the
 * recorded mousedown/mouseup ends, which is the thing under test. */
section('the naive dismissal pattern is gone from the pages');

const naive = [];
for (const file of pages) {
  const rel = relative(REPO, file).replace(/\\/g, '/');
  const src = moduleSource(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')                    // block comments describe it; fine
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');
  // `e.target === <ident>` on the same statement as a close/remove('open') call.
  for (const m of src.matchAll(/e\.target\s*===\s*[\w$]+[^\n]*/g)) {
    if (/close\s*\(|classList\.remove\(\s*['"]open['"]/.test(m[0])) {
      naive.push(`${rel}: ${m[0].trim().slice(0, 100)}`);
    }
  }
}
check('no page closes a dialog straight off e.target === backdrop', naive.length === 0);
naive.forEach(p => console.log(`         ${p}`));

/* ── Escape answers one dialog ─────────────────────────────────────────────────
 * Every wired backdrop listens on `document`, so without a stacking guard one keypress reaches
 * every open dialog's handler at once — dismissing the preview AND the lesson editor behind it.
 * The behaviour is proven in the browser harness; this only checks the guard is still wired in,
 * because deleting it fails nothing else that runs offline. */
section('Escape is guarded against closing a stack of dialogs');

const util = readFileSync(join(APP, 'js/util.js'), 'utf8');
check('wireModalDismiss consults topmostOpenModal() before closing on Escape',
  /Escape[\s\S]{0,200}topmostOpenModal\(\)\s*===\s*backdrop/.test(util));
check('topmostOpenModal() ranks by z-index across open backdrops',
  /function topmostOpenModal[\s\S]{0,400}\.modal-backdrop\.open[\s\S]{0,300}zIndex/.test(util));
