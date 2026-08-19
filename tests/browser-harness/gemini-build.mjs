// gemini-build.mjs — render one Gemini backup build in a real browser and assert it works.
//
// WHY THIS EXISTS. `.ai/skills/gemini-port/SKILL.md` Step 4 is blunt about it: a backup build
// never gets published on claude.ai, so the Babel-in-browser page IS this project's only JSX
// parser for it. `node --check` returns exit 0 on invalid JSX (PROJECT.md's sharp-edge table),
// so nothing else catches a broken build. The skill says a driver asserting the parse and the
// render "is worth having"; this is it.
//
// It checks the two failures that are genuinely different from each other:
//   1. PARSE  — Babel errors land on window.onerror and the wrapper paints a #boom banner.
//   2. RENDER — a page can parse cleanly and still mount nothing, so #root must have children.
// Plus the start-screen controls the port must add (the API-key field) and must not break, and
// the no-scroll property, because a scrolling document puts the composer below the fold and
// makes the lesson unusable.
//
// NOT a substitute for one real turn with a live key (Step 4 item 6) — that needs a free-tier
// Gemini key this harness does not have, and CORE.md §2 says a Node-only check is never the
// sole verification of a change. Say so in the CHANGELOG when it is all that ran.
//
//   node tests/browser-harness/gemini-build.mjs site/gemini/phys-310/<slug>.html
//   node tests/browser-harness/gemini-build.mjs <path> --chrome "C:/path/to/chrome.exe"
//
// Serves the repo root itself, so no separate http.server is needed. A file:// load would
// fail differently from what a cadet gets, which is the point of serving.

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--chrome');
if (!target) { console.error('usage: gemini-build.mjs <path-to-build.html> [--chrome <exe>]'); process.exit(2); }

// fileURLToPath, not URL.pathname: this repo's path contains spaces, and pathname leaves them
// percent-encoded, so the resolved ROOT does not exist and every file reads as missing.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!existsSync(join(ROOT, target))) { console.error(`no such build: ${target}`); process.exit(2); }

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

// Babel compiles in the page, so a parse error surfaces as a console/page error rather than a
// failed request. Collect both -- a silent console error is still a broken build.
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

// A console "Failed to load resource" does NOT name the URL, and a missing vendor script and a
// missing favicon read identically there. Record the responses so a 404 can be attributed.
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

console.log(`\n=== ${target} ===`);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
// Babel transpiles after load; give the mount a moment rather than racing it.
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

const ui = await page.evaluate(() => ({
  pwd: !!document.querySelector('input[type="password"]'),
  inputs: document.querySelectorAll('input').length,
  text: document.body.innerText.slice(0, 4000),
}));
check('API-key field present (type=password) — what the port adds', ui.pwd,
      `inputs=${ui.inputs}`);
check('start screen intact — honor/integrity text survived the port',
      /honor|integrity/i.test(ui.text));

const scrolls = await page.evaluate(() =>
  document.documentElement.scrollHeight > window.innerHeight + 2);
check('document does not scroll (composer stays above the fold)', !scrolls);

// A favicon 404 is noise; anything else that failed to load is a real defect even when the page
// looks fine — a missing vendor script is exactly how a build renders today and breaks later.
const missing = notFound.filter(p => !/favicon/i.test(p));
check('no missing resources (404)', missing.length === 0, missing.join(', '));

// window.onerror is the wrapper's own trap. Drop the generic resource-load line when every 404
// was benign, since it carries no information the check above does not.
const real = pageErrors.filter(e =>
  !/favicon/i.test(e) && !(missing.length === 0 && /Failed to load resource/i.test(e)));
check('no page/console errors', real.length === 0, real.slice(0, 2).join(' | '));

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
console.log('NOTE: this does not run a real tutor turn — that needs a live Gemini key (SKILL.md Step 4.6).');
process.exit(failed ? 1 : 0);
