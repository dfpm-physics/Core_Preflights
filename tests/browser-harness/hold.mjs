// hold.mjs — drive the hold-to-confirm button with a real mouse, in a real browser.
//
// WHY A BROWSER TEST FOR ONE BUTTON
//   Because this is the class of bug nothing else in the repo can see. `site/js/hold-button.js`
//   backs the only destructive control in PREP that is not behind a typed confirmation — "hold 5s,
//   delete the library copy of this assignment and every student report ever submitted against
//   it" — and it did not work from the day it shipped until 2026-07-30. It parsed, it logged no
//   console error, every unit suite stayed green, and the page rendered perfectly. It failed only
//   under a hand: arming on `mousedown` and cancelling on `mouseleave` meant that drifting one
//   pixel off a 130px target during a five-second press silently reset the timer, which is what a
//   hand does. The director reported it as "doesn't work", and they were right.
//
//   So the assertion that matters here is CASE 3 — hold while moving the cursor well off the
//   button, and still complete. It is the only one that was ever false, and it goes false again
//   the moment somebody puts a leave-event back in the cancel set.
//
// IT RUNS THE REAL SOURCE. `site/js/hold-button.js` is read off disk and inlined into the page
// with its `export` keywords stripped — no second copy of the logic to drift out of step. If the
// module changes, this exercises the change.
//
// FRESH PAGE PER CASE. A pointer capture left over from a previous case makes a later one look
// like it passed for the wrong reason — which is exactly the confusion this file exists to remove.
//
// Usage:  node tests/browser-harness/hold.mjs [--chrome <path>]

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

// The module under test, as an inline classic script.
const MODULE = readFileSync(resolve(REPO, 'site/js/hold-button.js'), 'utf8')
  .replace(/^export\s+/gm, '');

// The button's real markup and styles, from lessons.html / styles.css. These are presentation
// only — every assertion below is about behaviour — but the geometry is not: the drift cases need
// a real box to drift out of.
const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; padding: 40px; font: 14px system-ui, sans-serif; }
  .btn { padding: 8px 14px; border: 1px solid #ccc; border-radius: 6px; cursor: pointer; font: inherit; }
  .hold-btn { position: relative; overflow: hidden; color: #fff; background: #c00; border-color: #c00; }
  .hold-btn .hold-fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0; background: rgba(0,0,0,0.30); }
  .hold-btn.holding .hold-fill { width: 100%; transition: width 5s linear; }
  .hold-btn .hold-label { position: relative; z-index: 1; }
</style></head><body>
  <button class="btn hold-btn" id="del-all">
    <span class="hold-fill" id="del-fill"></span>
    <span class="hold-label" id="del-all-label">Hold 5s &middot; delete library copy too</span>
  </button>
<script>
${MODULE}
window.FIRED = false;
window.CTL = wireHoldButton({
  button: document.getElementById('del-all'),
  label: document.getElementById('del-all-label'),
  ms: 5000,
  idleText: 'Hold 5s',
  onComplete: () => { window.FIRED = true; },
});
</script></body></html>`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function run(label, drive, want) {
  const page = await browser.newPage();
  await page.setContent(PAGE);
  const box = await page.$eval('#del-all', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await drive(page, box.x + box.w / 2, box.y + box.h / 2, box);
  const fired = await page.evaluate(() => window.FIRED);
  const label2 = await page.$eval('#del-all-label', (el) => el.textContent.trim());
  await page.close();

  if (fired === want) { passed++; console.log(`  [pass] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}\n         completed=${fired} want=${want} label="${label2}"`); }
}

console.log('=== hold-button: completing the hold ===');

await run('held still for 5.4s -> completes', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(5400); await p.mouse.up();
}, true);

await run('held 5.4s while drifting a few px inside the button -> completes', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(1500);
  await p.mouse.move(cx + 3, cy + 1); await wait(4200); await p.mouse.up();
}, true);

// THE REGRESSION CASE. False under the old mousedown/mouseleave pair, and the whole reason this
// file exists. If somebody re-adds pointerleave/pointerout to the cancel set, only this goes red.
await run('held 5.4s while drifting well OFF the button -> still completes', async (p, cx, cy, box) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(1500);
  await p.mouse.move(cx + 200, box.y + box.h + 60); await wait(4200); await p.mouse.up();
}, true);

console.log('=== hold-button: NOT completing it ===');

await run('released at 2s -> does not complete', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(2000); await p.mouse.up(); await wait(3600);
}, false);

await run('Escape at 2s -> does not complete', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(2000);
  await p.keyboard.press('Escape'); await wait(3600); await p.mouse.up();
}, false);

// A right-click must not arm a destructive gesture — there is no way to see that it has.
await run('right-click held for 5.4s -> does not complete', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down({ button: 'right' }); await wait(5400);
  await p.mouse.up({ button: 'right' });
}, false);

// The caller's stand-down path: lessons.html calls cancel() when the dialog closes, and a hold
// that outlived its dialog would delete an assignment nobody was looking at any more.
await run('cancel() while holding -> does not complete', async (p, cx, cy) => {
  await p.mouse.move(cx, cy); await p.mouse.down(); await wait(1500);
  await p.evaluate(() => window.CTL.cancel());
  await wait(4200); await p.mouse.up();
}, false);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
