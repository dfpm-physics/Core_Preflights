// v2-scale.mjs -- letter scale and near-line width (site/faculty/scale.html), in a real browser. STAGING only.
//
// Needs scripts/staging/serve_local.py running and the seeds present (seed_staging.py, seed_v2_gate.py).
// Signs in as seeded, invented people, never as the service role, and:
//   1. asks the DATABASE (letter_scale_is_valid) about every case in tests/app-schema/scale-cases.json and checks the
//      answers equal the list the page's own validator is tested against.
//   2. as the gate director, on the gate ENTRY course (inactive), opens the scale from the Items page: the default is
//      in force. Each refusal appears as a sentence naming the line and turns the Save and preview buttons off.
//   3. the "try a score" box: 89.9 of 100 is B+ near A-, 90 is A-, 89.8999 is B+ and near nothing.
//   4. saves a scale (version 1), edits it (version 2, version 1 retired), fills the default back (version 3), and
//      reads every row back from the database: lines, width, retired, created_by set.
//   5. on the ACTIVE gate vector course: Save stays off until the effect of exactly this scale is shown; the effect
//      shown equals the database's own scale_change_preview row for row; changing one box makes it stale again.
//      Nothing is saved there, and the course's totals fingerprint is the same before and after.
//   6. a cadet is turned away and the database returns 0 scale rows to a cadet, in the browser and over REST; an
//      instructor gets the directors-only state and the database refuses an instructor's write.
//   7. leaves one EXAMPLE scale on the inactive entry course (kept on purpose): A 90, B 80, C 70, D 60, F 0, width 0.5.
//
// Environment: STAGING_DB_URL and PREP_PYTHON (the venv python).
// Usage:  node tests/browser-harness/v2-scale.mjs [--base http://localhost:8012]
// No screenshots. Every name written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8012');
const DOMAIN = 'prep-staging.example';
const PY = process.env.PREP_PYTHON;
if (!PY || !process.env.STAGING_DB_URL) { console.error('Need PREP_PYTHON and STAGING_DB_URL'); process.exit(2); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

const ENTRY = 'ee6fabc3-2c57-5f42-8fc9-8023fb267808';        // gate entry course offering (inactive)
const VECTOR = 'b17381d2-5545-519b-a553-c20809dc9520';       // gate vector course offering (active)
const RB = resolve(import.meta.dirname, 'v2_scale_readback.py');
const CASES = resolve(import.meta.dirname, '../app-schema/scale-cases.json');

const cfg = readFileSync(resolve(import.meta.dirname, '../../site/js/config.js'), 'utf8');
const stagingBlock = cfg.slice(cfg.indexOf('const PREP_STAGING'));
const API = stagingBlock.match(/url:\s*'([^']+)'/)[1];
const KEY = stagingBlock.match(/anon:\s*'([^']+)'/)[1];
if (!/wkibeptktbnaddfynrwr/.test(API)) { console.error('REFUSED: the staging address is not the staging project'); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const run = (...args) => JSON.parse(execFileSync(PY, [RB, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }));
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const DEFAULT = [['A', 93, 4], ['A-', 90, 3.7], ['B+', 87, 3.3], ['B', 83, 3], ['B-', 80, 2.7], ['C+', 77, 2.3], ['C', 73, 2], ['C-', 70, 1.7], ['D', 60, 1], ['F', 0, 0]]
  .map(([letter, cutoff, gpa]) => ({ letter, cutoff, gpa }));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1400 } });

async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
  page.on('dialog', d => { d.accept().catch(() => {}); });
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, problems };
}
async function open(page, path, ms = 2000) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.body?.innerText || '');
}
async function useCourse(page, offeringId, fragment) {
  await open(page, '/site/faculty/dashboard.html', 1200);
  const now = () => page.evaluate(() => document.querySelector('.cb-name')?.textContent || '');
  if (!(await now()).includes(fragment)) {
    await page.click('[data-course-toggle]'); await wait(300);
    await page.click(`.course-opt[data-course="${offeringId}"]`); await wait(2500);
  }
  check(`course menu shows "${fragment}"`, (await now()).includes(fragment), await now());
}
const press = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; }, sel);
const drawnNow = (page) => page.evaluate(() => Number(document.getElementById('main')?.dataset.drawn) || 0);
/** Run an action that makes the page redraw, then wait for the redraw. */
async function act(page, fn, ms = 25000) {
  const n0 = await drawnNow(page);
  const out = await fn();
  await page.waitForFunction((n) => (Number(document.getElementById('main')?.dataset.drawn) || 0) > n, { timeout: ms }, n0).catch(() => {});
  await wait(250);
  return out;
}
async function openScale(page) {
  await page.goto(`${BASE}/site/faculty/scale.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#sc-table, .empty-state, .alert', { timeout: 25000 }).catch(() => {});
  await wait(400);
}
const setBox = (page, sel, v) => act(page, () => page.$eval(sel, (el, val) => { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, v));
const cell = (i, f) => `.sc-in[data-i="${i}"][data-f="${f}"]`;
const text = (page, sel) => page.$eval(sel, e => e.innerText).catch(() => '');
const disabled = (page, sel) => page.$eval(sel, e => e.disabled).catch(() => null);
const rowsInPage = (page) => page.$$eval('#sc-table tbody tr', trs => trs.length);

// ===================================================================================================
console.log('\n== 1. the database and the page agree about what a scale is');
const cases = JSON.parse(readFileSync(CASES, 'utf8')).cases;
const dbAnswers = run('valid', CASES);
check('the database answered every case', dbAnswers.length === cases.length, String(dbAnswers.length));
check('letter_scale_is_valid says what the shared list says, case for case', same(dbAnswers, cases.map(c => c.valid)),
  JSON.stringify(cases.map((c, i) => [c.name, c.valid, dbAnswers[i]]).filter(x => x[1] !== x[2])));

run('reset', ENTRY);
const vecTotalsBefore = run('totals', VECTOR);
const vecRowsBefore = run('read', VECTOR).rows.length;

// ===================================================================================================
console.log('\n== 2. the default, and every refusal in words');
const dir = await signIn(`gatedirector@${DOMAIN}`, 'gatedirector1234');
const d = dir.page;
check('director signed in', !/login\.html/.test(d.url()), d.url());
await useCourse(d, ENTRY, 'Gate entry');
await d.goto(`${BASE}/site/faculty/admin.html`, { waitUntil: 'networkidle2', timeout: 30000 });
await d.waitForSelector('#scale-link', { timeout: 25000 }).catch(() => {});
check('the Admin page has a Letter scale link', !!(await d.$('#scale-link')));
await Promise.all([d.click('#scale-link'), d.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
await d.waitForSelector('#sc-table', { timeout: 25000 }).catch(() => {});
await wait(500);
let t = await text(d, '#main');
check('the page opens on the scale page', /faculty\/scale\.html/.test(d.url()), d.url());
check('the default scale is in force, and the page says so', /The default scale/.test(t), t.slice(0, 200));
check('the course is named as not active', /not the active course/.test(t));
check('ten lines and the default width', (await rowsInPage(d)) === 10 && (await d.$eval('#sc-width', e => e.value)) === '0.1');
check('nothing to save yet', (await disabled(d, '#sc-save')) === true);

async function refuses(name, edit, expected) {
  await edit();
  const e = await text(d, '#sc-errors');
  check(`${name}: a sentence appears`, expected.test(e), e.slice(0, 200));
  check(`${name}: Save and the preview are off`, (await disabled(d, '#sc-save')) === true && (await disabled(d, '#sc-preview')) === true);
  await act(d, () => press(d, '#sc-reset'));
}
await refuses('a cutoff not below the line above', () => setBox(d, cell(1, 'cutoff'), '95'), /Line 2 \(A-\): the cutoff 95 must be lower than the line above it, 93/);
await refuses('a width at the smallest gap', () => setBox(d, '#sc-width', '3'), /near-line width 3 must be below the smallest gap between two cutoffs, which is 3/);
await refuses('a last cutoff that is not 0', () => setBox(d, cell(9, 'cutoff'), '5'), /last line must have a cutoff of exactly 0/);
await refuses('a letter used twice', () => setBox(d, cell(2, 'letter'), 'A'), /the letter A is used twice/);
await refuses('a GPA that rises', () => setBox(d, cell(3, 'gpa'), '3.5'), /the GPA 3.5 is higher than the line above it, 3.3/);
await refuses('a new line with nothing in it', () => act(d, () => press(d, '#sc-add')), /Line 11 has no letter/);
await refuses('a fourth decimal in a cutoff', () => setBox(d, cell(5, 'cutoff'), '77.1234'), /3 decimal places at most/);

// ===================================================================================================
console.log('\n== 3. try a score');
const tryScore = async (e, p) => { await d.$eval('#sc-e', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, e);
  await d.$eval('#sc-p', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, p); await wait(150); return text(d, '#sc-try-out'); };
check('89.9 of 100 is B+, near A- (the edge is included)', /B\+, near A-/.test(await tryScore('89.9', '100')));
check('90 of 100 is A-, near nothing', (await tryScore('90', '100')).trim() === 'A-');
check('89.8999 of 100 is B+ and near nothing', (await tryScore('89.8999', '100')).trim() === 'B+');

// ===================================================================================================
console.log('\n== 4. save, edit, fill the default back');
await setBox(d, cell(1, 'cutoff'), '89');
await setBox(d, '#sc-width', '0.5');
t = await text(d, '#sc-changes');
check('the page names the change against the scale in force', /A- moves from 90 to 89/.test(t) && /near-line width goes from 0.1 to 0.5/.test(t), t);
check('on an inactive course Save is on without a preview', (await disabled(d, '#sc-save')) === false);
await act(d, () => press(d, '#sc-preview'));
t = await text(d, '#sc-preview-out');
check('the preview says nobody changes (no graded work on this course)', /No cadet changes letter or near-line flag/.test(t), t.slice(0, 160));
await act(d, () => press(d, '#sc-save'));
await wait(1500);
t = await text(d, '#main');
check('the page reports version 1 and shows it in force', /Saved as version 1/.test(t) && /Version 1, near-line width 0.5/.test(t), t.slice(0, 300));
let rb = run('read', ENTRY);
const v1 = rb.rows[0];
check('database: one row, version 1, in force, width 0.5, created_by stamped by the database, ten lines', rb.rows.length === 1 && v1.version === 1 && v1.retired === false && v1.width === '0.5' && v1.created_by_set === true && v1.lines.length === 10, JSON.stringify(rb));
check('database: A- is 89 with GPA 3.7 and the others are as they were',
  same(v1.lines, DEFAULT.map(l => l.letter === 'A-' ? { ...l, cutoff: 89 } : l)), JSON.stringify(v1.lines));

await setBox(d, '#sc-width', '0.2');
await act(d, () => press(d, '#sc-save'));
await wait(1500);
rb = run('read', ENTRY);
check('database: version 2 is in force and version 1 is retired, nothing overwritten',
  rb.rows.length === 2 && rb.rows[0].version === 2 && rb.rows[0].retired === false && rb.rows[0].width === '0.2'
  && rb.rows[1].version === 1 && rb.rows[1].retired === true && rb.rows[1].width === '0.5', JSON.stringify(rb.rows.map(r => [r.version, r.retired, r.width])));
t = await text(d, '#sc-history');
check('the versions list shows both', /\b2\b[\s\S]*in force/.test(t) && /\b1\b[\s\S]*retired/.test(t), t.slice(0, 200));
check('saving the same scale again is refused on the page', (await disabled(d, '#sc-save')) === true && /already in force/.test(await text(d, '#sc-why')));

await act(d, () => press(d, '#sc-default'));
await act(d, () => press(d, '#sc-save'));
await wait(1500);
rb = run('read', ENTRY);
check('database: version 3 is the default scale, width 0.1; versions 1 and 2 are retired',
  rb.rows.length === 3 && rb.rows[0].version === 3 && same(rb.rows[0].lines, DEFAULT) && rb.rows[0].width === '0.1' && rb.rows[1].retired && rb.rows[2].retired, JSON.stringify(rb.rows.map(r => [r.version, r.retired, r.width])));
check('exactly one row is in force', rb.rows.filter(r => !r.retired).length === 1);

// ===================================================================================================
console.log('\n== 4b. another window saves first (review B S4)');
await setBox(d, cell(1, 'cutoff'), '88');
const bumped = run('bump', ENTRY);
await act(d, () => press(d, '#sc-save'));
await wait(1500);
t = await text(d, '#sc-save-error');
check('a save made on an out-of-date page is refused, and says someone saved in another window', /changed after you opened/.test(t) && /Nothing was saved/.test(t), t.slice(0, 300));
rb = run('read', ENTRY);
check('database: only the other window\'s version exists on top (nothing from this page was written)',
  rb.rows.length === 4 && rb.rows[0].version === bumped.version && rb.rows[0].retired === false && same(rb.rows[0].lines, DEFAULT) && rb.rows.filter(r => !r.retired).length === 1,
  JSON.stringify(rb.rows.map(r => [r.version, r.retired])));
await openScale(d);                       // reload: the page now reads the scale in force
t = await text(d, '#main');
check('after a reload the page shows the scale now in force', new RegExp(`Version ${bumped.version}`).test(t), t.slice(0, 200));

// ===================================================================================================
console.log('\n== 5. an active course: the effect first');
await useCourse(d, VECTOR, 'Gate vector');
await openScale(d);
t = await text(d, '#main');
check('the vector course is named as active', /active course: its cadets use this scale now/.test(t), t.slice(0, 160));
const vecInitialLines = await d.$$eval('#sc-table tbody tr', trs => trs.length);
check('it is on the default scale with ten lines', /The default scale/.test(t) && vecInitialLines === 10);
// leave only A 93 and F 0: nearly everyone changes letter
for (const i of [8, 7, 6, 5, 4, 3, 2, 1]) await act(d, () => press(d, `[data-del="${i}"]`));
check('two lines are left', (await rowsInPage(d)) === 2);
check('Save is off on an active course until the effect is shown', (await disabled(d, '#sc-save')) === true && /Show the effect/.test(await text(d, '#sc-why')));
await act(d, () => press(d, '#sc-preview'));
const shown = await d.$$eval('#sc-preview-out table tbody tr', trs => trs.map(tr => [...tr.cells].map(c => c.innerText.trim())));
const headline = await text(d, '#sc-preview-out');
const dbPrev = run('preview', VECTOR, JSON.stringify([{ letter: 'A', cutoff: 93, gpa: 4 }, { letter: 'F', cutoff: 0, gpa: 0 }]), '0.1').rows;
const norm = (x) => (x === null || x === undefined ? '' : String(x));
const dbRows = dbPrev.map(r => [String(r[0]), norm(r[1]), norm(r[2]) || 'none', norm(r[3]) || 'none', norm(r[4]), norm(r[5])]);
const pageRows = shown.map(r => [r[0], r[1], r[2], r[3], r[4], r[5]]);
check('the effect is not empty (so the comparison means something)', dbRows.length > 0, String(dbRows.length));
check('the effect on the page equals the database\'s scale_change_preview, row for row', same(pageRows, dbRows), JSON.stringify([pageRows.slice(0, 3), dbRows.slice(0, 3)]));
check('the headline counts the same cadets', new RegExp(`${dbRows.filter(r => r[2] !== r[3]).length} cadet`).test(headline), headline.slice(0, 160));
check('now Save is on', (await disabled(d, '#sc-save')) === false);
await setBox(d, '#sc-width', '0.2');
t = await text(d, '#sc-preview-out');
check('changing one box makes the effect stale, and Save goes off again', /after this was shown/.test(t) && (await disabled(d, '#sc-save')) === true, t.slice(0, 120));

// ===================================================================================================
console.log('\n== 6. nothing moved on the active course; cadet, instructor, REST');
const vecTotalsAfter = run('totals', VECTOR);
check('the vector course saved no scale row', run('read', VECTOR).rows.length === vecRowsBefore, String(run('read', VECTOR).rows.length));
check('and its totals fingerprint is unchanged', same(vecTotalsBefore, vecTotalsAfter), JSON.stringify([vecTotalsBefore, vecTotalsAfter]));
check('no uncaught page error for the director', dir.problems.length === 0, dir.problems.join(' | '));

const cad = await signIn(`cadet0401@${DOMAIN}`, '000401');
check('entry cadet signed in', !/login\.html/.test(cad.page.url()), cad.page.url());
await open(cad.page, '/site/student/dashboard.html', 2000);
const seen = await cad.page.evaluate(async (off) => {
  const r = await window.db.from('letter_scales').select('id');
  const w = await window.db.from('letter_scales').insert({ course_offering_id: off, version: 77, lines: [{ letter: 'A', cutoff: 0, gpa: 4 }], near_line_width: 0 });
  const f = await window.db.rpc('current_letter_scale', { p_course_offering: off });
  const p = await window.db.rpc('scale_change_preview', { p_course_offering: off, p_lines: [{ letter: 'A', cutoff: 0, gpa: 4 }], p_width: 0 });
  return { rows: (r.data || []).length, readError: r.error ? r.error.message : null, insertError: !!w.error, currentRefused: !!f.error, previewRefused: !!p.error };
}, ENTRY);
check('browser, signed in as a cadet: 0 scale rows', seen.rows === 0 && !seen.readError, JSON.stringify(seen));
check('... a cadet\'s insert is refused, current_letter_scale is refused, scale_change_preview is refused', seen.insertError && seen.currentRefused && seen.previewRefused, JSON.stringify(seen));
await open(cad.page, '/site/faculty/scale.html', 2500);
check('a cadet who opens the scale page is turned away', !/faculty\/scale\.html/.test(cad.page.url()) || !(await cad.page.$('#sc-table')), cad.page.url());
await cad.ctx.close();

async function rest(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${token || KEY}`, 'Accept-Profile': 'app', 'Content-Profile': 'app', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body };
}
const tokenRes = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `cadet0401@${DOMAIN}`, password: '000401' }) });
const token = (await tokenRes.json()).access_token;
let r = await rest('/rest/v1/letter_scales?select=id', token);
check('REST, cadet: letter_scales returns 0 rows although four exist', r.status === 200 && Array.isArray(r.body) && r.body.length === 0 && run('read', ENTRY).rows.length === 4, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest('/rest/v1/letter_scales', token, { method: 'POST', body: JSON.stringify({ course_offering_id: ENTRY, version: 77, lines: [{ letter: 'A', cutoff: 0, gpa: 4 }], near_line_width: 0 }) });
check('REST, cadet: a write to letter_scales is refused', r.status >= 400, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest('/rest/v1/letter_scales?select=id', null);
check('REST, no sign-in at all: no scale rows', (r.status >= 400) || (Array.isArray(r.body) && r.body.length === 0), JSON.stringify([r.status, r.body]).slice(0, 160));

const ins = await signIn(`gateinstructor@${DOMAIN}`, 'gateinstructor1234');
await ins.page.goto(`${BASE}/site/faculty/scale.html`, { waitUntil: 'networkidle2', timeout: 30000 });
await ins.page.waitForSelector('#sc-table, .empty-state, .alert', { timeout: 25000 }).catch(() => {});
await wait(500);
t = await ins.page.evaluate(() => document.body.innerText);
check('an instructor (not a director) gets the directors-only state', /Directors only/.test(t) && !(await ins.page.$('#sc-table')), t.slice(0, 160));
const iw = await ins.page.evaluate(async (off) => {
  const w = await window.db.from('letter_scales').insert({ course_offering_id: off, version: 78, lines: [{ letter: 'A', cutoff: 0, gpa: 4 }], near_line_width: 0 });
  const u = await window.db.from('letter_scales').update({ retired_at: new Date().toISOString() }).eq('course_offering_id', off).select('id');
  const pv = await window.db.rpc('scale_change_preview', { p_course_offering: off, p_lines: [{ letter: 'A', cutoff: 0, gpa: 4 }], p_width: 0 });
  return { insertError: !!w.error, updated: (u.data || []).length, previewRefused: !!pv.error };
}, VECTOR);
check('the database refuses an instructor\'s insert, changes nothing on update, and refuses the preview', iw.insertError && iw.updated === 0 && iw.previewRefused, JSON.stringify(iw));
check('no uncaught page error for the instructor', ins.problems.length === 0, ins.problems.join(' | '));
await ins.ctx.close();

// ===================================================================================================
console.log('\n== 7. the example, left on the entry course');
await useCourse(d, ENTRY, 'Gate entry');
await openScale(d);
check('the entry course is on version 4, the default again', /Version 4/.test(await text(d, '#main')));
await act(d, () => press(d, '#sc-default'));
for (const i of [7, 5, 4, 2, 1]) await act(d, () => press(d, `[data-del="${i}"]`));
await setBox(d, cell(0, 'cutoff'), '90');
await setBox(d, cell(1, 'cutoff'), '80');
await setBox(d, cell(2, 'cutoff'), '70');
await setBox(d, '#sc-width', '0.5');
check('five lines and no problem listed', (await rowsInPage(d)) === 5 && (await text(d, '#sc-errors')).trim() === '', await text(d, '#sc-errors'));
check('A 5-line scale tries a score: 79.6 of 100 is C, near B', /^C, near B$/.test((await tryScore('79.6', '100')).trim()), await text(d, '#sc-try-out'));
await act(d, () => press(d, '#sc-save'));
await wait(1500);
rb = run('read', ENTRY);
const ex = rb.rows[0];
const expected = [['A', 90, 4], ['B', 80, 3], ['C', 70, 2], ['D', 60, 1], ['F', 0, 0]].map(([letter, cutoff, gpa]) => ({ letter, cutoff, gpa }));
check('database: version 5 is the example, in force, width 0.5; four earlier versions retired',
  rb.rows.length === 5 && ex.version === 5 && !ex.retired && ex.width === '0.5' && same(ex.lines, expected) && rb.rows.slice(1).every(x => x.retired), JSON.stringify(rb.rows.map(x => [x.version, x.retired])));
check('the entry course is still inactive', rb.is_active === false);
check('no uncaught page error for the director (whole run)', dir.problems.length === 0, dir.problems.join(' | '));

await dir.ctx.close();
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
