// modal.mjs — dismiss a dialog with a real mouse, in a real browser.
//
// WHY A BROWSER TEST FOR A DIALOG
//   The same reason as hold.mjs: this is a bug class no unit suite can see. `wireModalDismiss()`
//   parses, throws nothing, and looks obviously correct — the failure is a browser fact about
//   which element `click` is dispatched on. Select text inside a modal, drag past its edge,
//   release: `mouseup` lands on the backdrop and the browser fires `click` on the nearest COMMON
//   ANCESTOR of the two elements, which is the backdrop. `e.target === backdrop` cannot tell that
//   from a real dismissal, so the dialog closed and everything typed into it was gone.
//
//   The director reported it twice. The first fix was right and still incomplete: four of the
//   site's twenty dialogs were never converted, including the lesson editor — the one dialog where
//   the loss is a whole authored question set. CASE 1 is the assertion that matters.
//
// IT RUNS THE REAL SOURCE. `wireModalDismiss` and `topmostOpenModal` are read out of
// site/js/util.js and inlined, so there is no second copy of the rule to drift out of step.
//
// FRESH PAGE PER CASE, as in hold.mjs — a listener or a flag left over from an earlier case makes
// a later one look like it passed for the wrong reason.
//
// Usage:  node tests/browser-harness/modal.mjs [--chrome <path>]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

// The two functions under test, lifted out of util.js by name so the rest of the module (which
// imports nothing here and needs a DOM elsewhere) stays out of the page.
const UTIL = readFileSync(resolve(REPO, 'site/js/util.js'), 'utf8');
function lift(name) {
  const start = UTIL.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`util.js no longer exports ${name}() — this test is out of date.`);
  // Walk the PARAMETER LIST to its closing paren first. Brace-matching from the first `{` after
  // the signature grabs the one in `opts = {}` instead of the body, and returns half a function.
  let i = UTIL.indexOf('(', start), parens = 0;
  for (; i < UTIL.length; i++) {
    if (UTIL[i] === '(') parens++;
    else if (UTIL[i] === ')' && --parens === 0) break;
  }
  let depth = 0;
  for (let j = UTIL.indexOf('{', i); j < UTIL.length; j++) {
    if (UTIL[j] === '{') depth++;
    else if (UTIL[j] === '}' && --depth === 0) return UTIL.slice(start, j + 1).replace(/^export\s+/, '');
  }
  throw new Error(`unbalanced braces reading ${name}() out of util.js`);
}
const MODULE = [lift('wireModalDismiss'), lift('topmostOpenModal')].join('\n\n');

// Two stacked dialogs, with the real .modal-backdrop geometry from styles.css: fixed, inset 0,
// z-index 60. The dialog box is deliberately small so there is backdrop on every side of it to
// drag out onto.
const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px system-ui, sans-serif; }
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 60;
    display: none; align-items: flex-start; justify-content: center; padding: 40px 16px;
  }
  .modal-backdrop.open { display: flex; }
  .modal { background: #fff; border-radius: 14px; width: 320px; height: 180px; padding: 20px; }
  textarea { width: 100%; height: 90px; }
</style></head><body>
  <div class="modal-backdrop open" id="outer">
    <div class="modal">
      <button data-close id="outer-x">&times;</button>
      <textarea id="work">Some text a director is part-way through rewriting.</textarea>
    </div>
  </div>
  <div class="modal-backdrop" id="inner">
    <div class="modal"><button data-close>&times;</button><p>Stacked over the first.</p></div>
  </div>
<script>
${MODULE}
const outer = document.getElementById('outer');
const inner = document.getElementById('inner');
wireModalDismiss(outer, () => outer.classList.remove('open'));
wireModalDismiss(inner, () => inner.classList.remove('open'));
window.openState = () => ({
  outer: outer.classList.contains('open'),
  inner: inner.classList.contains('open'),
});
</script></body></html>`;

let passed = 0, failed = 0;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

/** @param want {{outer:boolean, inner?:boolean}} */
async function run(label, drive, want) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`         [page error] ${e.message}`));
  await page.setViewport({ width: 900, height: 700 });
  await page.setContent(PAGE);
  const box = await page.$eval('#outer .modal', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await drive(page, box);
  const got = await page.evaluate(() => window.openState());
  await page.close();

  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  if (ok) { passed++; console.log(`  [pass] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}\n         got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

const inside = (b) => [b.x + b.w / 2, b.y + b.h / 2];

console.log('=== wireModalDismiss: a gesture that starts INSIDE never dismisses ===');

// THE REGRESSION CASE. False under `e.target === backdrop`, and the whole reason this file exists.
await run('drag from inside the dialog, release on the backdrop -> stays open', async (p, b) => {
  const [cx, cy] = inside(b);
  await p.mouse.move(cx, cy); await p.mouse.down();
  await p.mouse.move(b.x + b.w + 120, b.y + b.h + 120); await p.mouse.up();
}, { outer: true });

// Selecting text in a textarea and overshooting is the exact gesture the director described.
await run('select text in a textarea, release far outside -> stays open', async (p, b) => {
  const ta = await p.$('#work');
  const r = await ta.boundingBox();
  await p.mouse.move(r.x + 10, r.y + 10); await p.mouse.down();
  await p.mouse.move(r.x + r.width + 200, r.y + r.height + 200); await p.mouse.up();
}, { outer: true });

await run('drag from inside, release just past the dialog edge -> stays open', async (p, b) => {
  const [cx, cy] = inside(b);
  await p.mouse.move(cx, cy); await p.mouse.down();
  await p.mouse.move(b.x - 4, cy); await p.mouse.up();
}, { outer: true });

// The mirror image: a gesture that STARTS on the backdrop and ends inside is not a dismissal
// either. `click` reports the backdrop for this one too, so only the recorded mouseup separates
// them — which is why both ends are tracked rather than just the first.
await run('drag from the backdrop, release inside the dialog -> stays open', async (p, b) => {
  const [cx, cy] = inside(b);
  await p.mouse.move(b.x + b.w + 120, b.y + b.h + 120); await p.mouse.down();
  await p.mouse.move(cx, cy); await p.mouse.up();
}, { outer: true });

console.log('=== wireModalDismiss: the real ways out still work ===');

await run('click that starts and ends on the backdrop -> closes', async (p, b) => {
  const x = b.x + b.w + 120, y = b.y + b.h + 120;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up();
}, { outer: false });

await run('click the × -> closes', async (p) => { await p.click('#outer-x'); }, { outer: false });

await run('Escape -> closes', async (p) => { await p.keyboard.press('Escape'); }, { outer: false });

// Keyboard activation fires `click` with no mousedown/mouseup in front of it. The [data-close]
// branch is answered before the gesture test precisely so this still works.
await run('the × reached by keyboard (Enter) -> closes', async (p) => {
  await p.focus('#outer-x'); await p.keyboard.press('Enter');
}, { outer: false });

console.log('=== stacked dialogs: Escape answers the top one only ===');

// Every wired backdrop listens on `document`, so before topmostOpenModal() one keypress reached
// both handlers and closed the stack — dismissing the preview AND the lesson editor behind it.
await run('Escape with two open -> closes only the top', async (p) => {
  await p.evaluate(() => document.getElementById('inner').classList.add('open'));
  await p.keyboard.press('Escape');
}, { outer: true, inner: false });

await run('Escape again -> now closes the one underneath', async (p) => {
  await p.evaluate(() => document.getElementById('inner').classList.add('open'));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
}, { outer: false, inner: false });

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
