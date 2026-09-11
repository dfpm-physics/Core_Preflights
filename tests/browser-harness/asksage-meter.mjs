// asksage-meter.mjs — render the Ask Sage token meter in a real browser and assert it works.
//
// WHY THIS EXISTS. `tests/browser/test-asksage-tokens.html` is a single page of hand-authored
// ES module behind a director gate. Nothing else in the repo parses it: there is no build step
// (CORE.md §2), and a typo in the module would show as a page that renders its shell, populates
// nothing, and looks merely "empty" rather than broken. That is the same failure mode
// `gemini-build.mjs` exists for, and the fix is the same — load it in Chrome and assert.
//
// WHAT IT DOES **NOT** DO: it never sends a turn. Every assertion below is about the page
// wiring — the gate, the lesson index, the extracted prompt, the projection arithmetic. One
// real turn costs real tokens out of a shared 10M/month pool, so it is a human's decision,
// made in the page, not something a harness does on its own.
//
//   python -m http.server 8000          # from the repo root, in another terminal
//   node tests/browser-harness/asksage-meter.mjs
//   node tests/browser-harness/asksage-meter.mjs --base http://localhost:8000
//
// Needs the PREP_TEST_FACULTY_* block in supabase/admin/.env — it is a director of two
// offerings, which is what guard.js asks for. Read CORE.md §3 before using that account for
// anything that COUNTS: it is a write credential, not an audit one.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { testFaculty } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const FAC = testFaculty();
const BASE = arg('base', 'http://localhost:8000');
const EMAIL = arg('email', FAC.email || null);
const PASSWORD = arg('password', FAC.password || null);
if (!EMAIL || !PASSWORD) {
  console.error('No faculty credentials. Set PREP_TEST_FACULTY_* in supabase/admin/.env.');
  process.exit(2);
}
const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};
const section = t => console.log(`\n=== ${t} ===`);
const wait = ms => new Promise(r => setTimeout(r, ms));

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

// A real turn would be a real charge. Refuse one at the network layer so a stray click during
// a harness run cannot spend the pool — belt as well as braces.
await page.setRequestInterception(true);
let blockedCalls = 0;
page.on('request', (r) => {
  if (r.url().includes('/functions/v1/asksage-proxy')) { blockedCalls++; r.abort(); }
  else r.continue();
});

section('sign in');
await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
await page.type('#identifier', EMAIL);
await page.type('#password', PASSWORD);
await Promise.all([
  page.click('#submit'),
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
]);
if (/login\.html/.test(page.url())) {
  console.error('Sign-in failed.'); await browser.close(); process.exit(1);
}
check('signed in as the test director', true);

section('the meter page loads past the gate');
await page.goto(`${BASE}/tests/browser/test-asksage-tokens.html`, { waitUntil: 'networkidle2' });
await wait(1500);

const gated = await page.$eval('body', b => /Director access required|Sign-in required/.test(b.innerText));
check('the director gate let us through', !gated);

const opacity = await page.$eval('html', h => getComputedStyle(h).opacity);
check('the page was revealed (opacity restored)', opacity === '1', `opacity ${opacity}`);

section('the lesson index loaded');
const lessons = await page.$$eval('#lesson option', els => els.map(e => e.textContent));
check('the lesson picker is populated from index.json', lessons.length > 1,
  `saw ${lessons.length} option(s): ${lessons[0] || '-'}`);
check('every option carries a token estimate', lessons.every(t => /~[\d,]+ tok/.test(t)),
  lessons.find(t => !/~[\d,]+ tok/.test(t)) || '');

section('the chosen lesson resolved to a real prompt');
// A lesson whose TEXT is not committed shows a warning instead of a weight. The default
// selection is the median lesson, which is one of the committed ones; if that stops being true
// this check is how we find out, rather than at Send time.
const pre = await page.$eval('#preflight', e => e.textContent);
check('the preflight line reports a prompt weight', /characters/.test(pre) && /tokens/.test(pre), pre.slice(0, 120));
check('the preflight line labels the estimate as an estimate', /estimat/i.test(pre), pre.slice(0, 120));

const weight = Number((pre.match(/([\d,]+)\s+characters/) || [0, '0'])[1].replace(/,/g, ''));
check('the prompt is the size a real lesson prompt is', weight > 20000 && weight < 400000,
  `${weight} characters`);

section('the projection refuses to guess before it has measured');
const verdict = await page.$eval('#verdict', e => e.textContent.trim());
check('no projection is shown with zero turns', verdict === '—', verdict);
const vnote = await page.$eval('#verdict-note', e => e.textContent);
check('it says why', /Send at least one turn/.test(vnote));

section('controls are wired');
for (const id of ['send', 'sim', 'reset', 'export', 'lesson', 'model', 'phase',
                  'cadets', 'lessons', 'pool']) {
  const there = await page.$(`#${id}`);
  check(`#${id} is present`, !!there);
}
const models = await page.$$eval('#model option', els => els.map(e => e.value));
check('both trial models are offered', models.includes('gemini-3.5-flash') && models.includes('claude-opus-4-6'),
  models.join(', '));

section('no console errors, no 404s');
// "Failed to load resource" is dropped here, and it is NOT a loosened assertion. That console
// line never names the URL, so a missing vendor script and a missing favicon read identically
// in it — which is exactly why the `notFound` listener above records the PATH of every 404 and
// asserts on that instead. Keeping both would fail the run on the favicon this page does not
// have, while still telling nobody which file was missing.
const realErrors = pageErrors.filter(e => !/gated/.test(e) && !/Failed to load resource/.test(e));
check('the module ran without errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
const realMissing = notFound.filter(p => !/favicon/.test(p));
check('nothing 404d', realMissing.length === 0, realMissing.slice(0, 4).join(', '));
check('no Ask Sage call was made by the harness', blockedCalls === 0, `blocked ${blockedCalls}`);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
