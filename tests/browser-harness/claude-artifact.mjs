// claude-artifact.mjs — render a CLAUDE artifact source in a real browser and assert it works.
//
// WHY THIS EXISTS. PROJECT.md's sharp-edge table says it plainly: "Publishing is the only JSX
// parser this project has." `node --check` returns exit 0 on invalid JSX, and `check_artifact.py`
// is explicitly not a syntax check. So until now the first thing that ever parsed a `.jsx` was
// claude.ai, during publishing, by hand, one artifact at a time — and a hand-patched artifact
// that fails to parse is discovered by a cadet.
//
// The Gemini port already proved a browser CAN parse these: `to_gemini.py` wraps the same JSX in
// a Babel-in-browser page, and `gemini-build.mjs` drives it. But the ported build is not the
// artifact — the porter rewrites the transport and STRIPS the backup button, the handoff anchor
// and `handoffUrl` on the way through, so exactly the code added on 2026-08-20 is the code that
// never reaches that harness. This closes the gap by wrapping the UNPORTED source.
//
// WHAT IT CAN AND CANNOT SEE. There is no claude.ai runtime here, so the artifact's fetch to
// api.anthropic.com fails on mount. That is not a defect to suppress — it is the fixture. The
// connection check goes `unavailable`, which is the ONLY state that renders the backup button, so
// the failure is what puts the changed UI on screen where it can be measured.
//
// It cannot run a tutor turn, and therefore cannot exercise the model ladder, `sysFor()`'s phase
// switching, or a real handoff with a transcript in it. CORE.md §2: a Node-only check is never
// the sole verification of a change. Say so in the CHANGELOG when it is all that ran.
//
//   python scripts/artifacts/preview_artifact.py --course phys-215 --lesson 2
//     (that script wraps the source, calls this, and cleans up after itself — use it instead of
//      invoking this directly, unless you already have a wrapped preview page)
//
//   node tests/browser-harness/claude-artifact.mjs site/gemini/phys-215/__preview__.html

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--chrome');
if (!target) { console.error('usage: claude-artifact.mjs <path-to-preview.html> [--chrome <exe>]'); process.exit(2); }

// fileURLToPath, not URL.pathname: this repo's path contains spaces, and pathname leaves them
// percent-encoded, so the resolved ROOT does not exist and every file reads as missing.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!existsSync(join(ROOT, target))) { console.error(`no such preview: ${target}`); process.exit(2); }

const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/${target.replace(/\\/g, '/')}`;

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

// The artifact calls api.anthropic.com on mount. Off claude.ai that is a cross-origin request to
// a host that will not answer, and how it fails varies with the network. Fail it deterministically
// instead, so the connection check reaches `unavailable` the same way on every machine — a run
// that depends on the tester's DNS is not a test.
await page.setRequestInterception(true);
page.on('request', r => {
  if (r.url().includes('api.anthropic.com')) r.abort('failed');
  else r.continue();
});

console.log(`\n=== ${target} ===`);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(
  () => document.querySelector('#root')?.childElementCount > 0
     || document.querySelector('#boom'),
  { timeout: 30000 },
).catch(() => {});

const boom = await page.evaluate(() => {
  const b = document.querySelector('#boom');
  if (!b) return null;
  const shown = getComputedStyle(b).display !== 'none' && b.textContent.trim().length > 0;
  return shown ? b.textContent.trim().slice(0, 400) : null;
});
check('no #boom parse banner', !boom, boom || '');

const kids = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? -1);
check('#root mounted children (render, not just parse)', kids > 0, `childElementCount=${kids}`);

// The connection check has to have FAILED for the rest of this to mean anything. If a future
// change makes the artifact tolerate an unreachable tutor, every assertion below would pass
// vacuously by finding nothing — so assert the fixture itself before trusting it.
await page.waitForFunction(
  () => !!document.querySelector('.backup-btn') || /unavailable/i.test(document.body.innerText),
  { timeout: 20000 },
).catch(() => {});

const ui = await page.evaluate(() => {
  const btn = document.querySelector('.backup-btn');
  const row = document.querySelector('.backup-row');
  const card = document.querySelector('.start-card');
  const cs = btn ? getComputedStyle(btn) : null;
  return {
    hasBtn: !!btn,
    btnW: btn ? Math.round(btn.getBoundingClientRect().width) : -1,
    rowW: row ? Math.round(row.getBoundingClientRect().width) : -1,
    cardW: card ? Math.round(card.getBoundingClientRect().width) : -1,
    bg: cs ? cs.backgroundColor : '',
    fg: cs ? cs.color : '',
    href: btn ? btn.getAttribute('href') : '',
    text: document.body.innerText.slice(0, 4000),
    bodyW: Math.round(document.body.getBoundingClientRect().width),
  };
});

check('connection check failed, so the backup button rendered (the fixture)', ui.hasBtn);
check('start screen intact — honor/integrity text present', /honor|integrity/i.test(ui.text));

// THE OVERFLOW BUG. .start centres its children, so a child with no max-width sizes to its own
// max-content -- for .backup-row that was the whole hint sentence unwrapped. Comparing against the
// CARD rather than a hard 480 is what makes this a regression test and not a restatement of the
// CSS: the rule is "the row lines up with the cards", whatever the cards are.
check('backup row is capped to the text column, not overflowing it',
      ui.rowW > 0 && ui.cardW > 0 && ui.rowW <= ui.cardW + 1,
      `row=${ui.rowW}px card=${ui.cardW}px body=${ui.bodyW}px`);
check('backup button sits inside the text column',
      ui.btnW > 0 && ui.cardW > 0 && ui.btnW <= ui.cardW + 1,
      `button=${ui.btnW}px card=${ui.cardW}px`);

// Navy fill, not the white-fill outline it was before 2026-08-20. Asserted as "dark background,
// light text" rather than an exact rgb triple, so a theme token that is retuned does not fail a
// test about which TREATMENT the button has.
const lum = s => { const m = s.match(/\d+/g); return m ? (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) : -1; };
check('backup button is filled (dark bg, light text), not outlined',
      lum(ui.bg) >= 0 && lum(ui.fg) >= 0 && lum(ui.bg) < 120 && lum(ui.fg) > 160,
      `bg=${ui.bg} fg=${ui.fg}`);

// It must point at the ROUTER, never at a build path. A published artifact cannot be edited, so a
// direct URL baked in here could never be repointed. (factory SKILL.md Common Mistake #35.)
check('backup button targets the router, not a build path',
      /\/site\/student\/backup\.html\?i=/.test(ui.href || ''),
      ui.href || '(none)');

const scrolls = await page.evaluate(() =>
  document.documentElement.scrollHeight > window.innerHeight + 2);
check('document does not scroll (composer stays above the fold)', !scrolls);

const missing = notFound.filter(p => !/favicon/i.test(p));
check('no missing resources (404)', missing.length === 0, missing.join(', '));

// The aborted api.anthropic.com request is the fixture, not a defect, so its console noise is
// expected. Everything else is real.
const real = pageErrors.filter(e =>
  !/favicon/i.test(e)
  && !/anthropic/i.test(e)
  && !/Failed to load resource/i.test(e)
  && !/net::ERR_FAILED/i.test(e));
check('no page/console errors beyond the stubbed tutor call', real.length === 0,
      real.slice(0, 2).join(' | '));

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
console.log('NOTE: no tutor turn ran, so the model ladder, sysFor() phases and a real handoff');
console.log('      payload are NOT covered here. Publishing remains the only full check.');
process.exit(failed ? 1 : 0);
