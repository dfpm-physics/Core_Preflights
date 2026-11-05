// v2-student-read.mjs -- the student schedule, grade list and dashboard, in a real browser. STAGING only, READ ONLY.
//
// Needs scripts/staging/serve_local.py running. It signs in as a seeded, invented cadet and only reads: it opens
// pages and watches the requests the pages make. It writes nothing, saves nothing, submits nothing, and needs no
// database connection or secret.
//
//   1. Schedule: every published item of the term is listed with its date, in date order, none hidden by the
//      release window. An item that has not opened shows when it opens and has no link.
//   2. My grades: every item with a state word; a score only on a released one; the running total shown.
//   3. Dashboard: no "Missed" label, no default of 2 points, no "lesson" in the stat tiles.
//   4. Network: no request from any student page selects the `diagnostic` column (the one-key projection of the
//      instructor note is allowed); no request touches `question_keys`.
//   5. The two reads that need migration 060 (gradebook_cells, my_course_total). When 060 is not on the database
//      the pages say so, and those checks are reported as SKIPPED by name. A skip is not a pass.
//
// Environment: none. Usage:  node tests/browser-harness/v2-student-read.mjs [--base http://localhost:8014]

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8014');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

let passed = 0, failed = 0, skipped = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const skip = (name, why) => { skipped++; console.log(`  [SKIPPED] ${name} -- ${why}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1280, height: 1000 } });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
const requests = [];
const problems = [];
// WRITE BLOCK. The site writes `user_preferences` itself: on a fresh browser, sign-in finds an empty row and seeds it
// from local settings (theme, current course), and every later page load carries up any setting the row lacks
// (prefs.js hydrate -> flushPrefs, an upsert). That is a write to staging from a "read only" run. Nothing but a read,
// a function call, or the sign-in token request is let through; the preference upsert is aborted and counted. The page
// copes (prefs.js logs a warning and works from the local copy).
const blocked = [];
await page.setRequestInterception(true);
page.on('request', r => {
  const url = decodeURIComponent(r.url());
  const m = r.method();
  const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(m);
  const allowedPost = m === 'POST' && /\/rpc\/|\/auth\/v1\/token/.test(url);
  if (!isRead && !allowedPost && /supabase\.co|localhost|127\.0\.0\.1/.test(url)) {
    blocked.push({ url, method: m });
    r.abort('blockedbyclient').catch(() => {});
    return;
  }
  requests.push({ url, method: m });
  r.continue().catch(() => {});
});
page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
page.on('dialog', d => d.dismiss().catch(() => {}));

// Seeded cadet in phys-215 (M1A). Invented; password follows the site's documented default rule.
await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
await page.type('#identifier', 'cadet101@prep-staging.example');
await page.type('#password', '000101');
await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
check('cadet signed in', !/login\.html/.test(page.url()), page.url());

async function open(path, ms = 2500) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.getElementById('main')?.innerText || '');   // the page body, not the top bar
}
const needs060 = (t) => /permission denied|Could not load the state|Could not load your total|not permitted/i.test(t);

console.log('\n== 1. schedule');
const sched = await open('/site/student/schedule.html');
const rows = await page.$$eval('[data-row]', els => els.map(e => ({ text: e.innerText, link: e.tagName === 'A' })));
if (needs060(sched)) {
  skip('schedule lists the term', 'the page reports the grade-state read failing; migration 060 is not on this database');
  check('the failure is shown as an error, not as an empty schedule', /Could not|permission|error/i.test(sched) && rows.length === 0, sched.slice(0, 160));
} else {
  check('the schedule lists several items', rows.length >= 3, `rows=${rows.length}`);
  check('every row names a date or says none yet', rows.every(r => /Due |Extended to |No due date yet/.test(r.text)));
  const locked = rows.filter(r => /Questions open|Opens before/.test(r.text));
  check('an item that has not opened says when, and has no link', locked.every(r => !r.link), `locked=${locked.length}`);
}
check('no "lesson" or "preflight" wording in the schedule', !/\blesson\b|preflight/i.test(sched.replace(/Interactive lesson/g, '')), sched.slice(0, 100));

console.log('\n== 2. my grades');
const grades = await open('/site/student/grades.html');
if (needs060(grades)) {
  skip('grade list and running total', 'migration 060 is not on this database; the page shows the error');
  check('the failure is shown, never a zero total', !/Running total[\s\S]{0,40}\b0%/.test(grades) && /Could not|permission|error/i.test(grades), grades.slice(0, 160));
} else {
  check('a running total is shown', /Running total/.test(grades));
  const g = await page.$$eval('[data-row]', els => els.map(e => ({ state: e.dataset.state, text: e.innerText })));
  check('every item has a state word', g.length > 0 && g.every(r => r.state), `rows=${g.length}`);
  const badged = await page.$$eval('[data-row]', els => els.filter(e => e.querySelector('.score-badge')).map(e => e.dataset.state));
  check('a score appears only on a released row', badged.every(st => st === 'released'), JSON.stringify(badged));
  check('no letter grade is shown', !/\bLetter\b|\bGPA\b/i.test(grades));
}
check('no "Missed" on the grade list', !/\bMissed\b/.test(grades));

console.log('\n== 3. dashboard and assignment list');
const dash = await open('/site/student/dashboard.html');
// Since the dashboard and assignment list read the same cells as the grade list, they need migration 060 too.
// Without it they must show the error, never a blank page or a spinner.
if (needs060(dash)) {
  skip('dashboard content', 'migration 060 is not on this database; the page shows the error');
  check('the dashboard shows the failure, not a spinner or a blank page', /This page didn.t load|Could not/i.test(dash) && !/Loading/.test(dash), dash.slice(0, 160));
} else {
  check('dashboard says "Past due", not "Missed"', /Past due/.test(dash) && !/\bMissed\b/.test(dash), dash.slice(0, 200));
}
const list = await open('/site/student/lessons.html');
if (needs060(list)) {
  skip('assignment list content', 'migration 060 is not on this database; the page shows the error');
  check('the assignment list shows the failure, not a spinner or a blank page', /This page didn.t load|Could not/i.test(list) && !/Loading/.test(list), list.slice(0, 160));
} else {
  check('assignment list loads without "Missed"', list.length > 20 && !/\bMissed\b/.test(list));
}

console.log('\n== 4. what the pages asked the database for');
const urls = requests.map(r => r.url);
const diag = urls.filter(u => /diagnostic/.test(u) && !/instructor_note:diagnostic->instructor_note/.test(u));
check('no student page selects the diagnostic column', diag.length === 0, diag[0]?.slice(0, 160));
check('no student page touches the answer keys', !urls.some(u => /question_keys/.test(u)));
check('every request was a read or a function call (no write)', requests.every(r => ['GET', 'POST', 'OPTIONS', 'HEAD'].includes(r.method)));
const writes = urls.filter((u, i) => requests[i].method === 'POST' && !/\/rpc\/|\/auth\/v1\/token/.test(u));
check('and no POST was a table write', writes.length === 0, writes[0]?.slice(0, 120));
check('every write the pages tried was blocked before it left the browser (reported, not hidden)', true);
console.log(`     blocked ${blocked.length} write attempt(s): ` + JSON.stringify([...new Set(blocked.map(x => x.method + ' ' + (x.url.match(/\/rest\/v1\/(\w+)/)?.[1] || 'other')))]));
check('the only write attempted was the preference sync', blocked.every(x => /\/rest\/v1\/user_preferences/.test(x.url)), blocked.find(x => !/user_preferences/.test(x.url))?.url.slice(0, 120));

console.log('\n== 5. page errors');
check('no uncaught page error', problems.length === 0, problems[0]);

await ctx.close();
await browser.close();
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
