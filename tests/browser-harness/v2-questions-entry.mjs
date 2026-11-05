// v2-questions-entry.mjs -- question and key entry (site/faculty/questions.html), in a real browser. STAGING only.
//
// Needs scripts/staging/serve_local.py running and the seeds present (seed_staging.py, seed_v2_gate.py).
// Signs in as seeded, invented people, never as the service role, and:
//   1. as the gate director, on the gate ENTRY course (inactive), creates an auto-checked item and a human-graded
//      online item through the Items page, then opens each from the Questions button.
//   2. enters one question of every type by hand (multiple choice, multiple select, numeric with tolerances,
//      significant figures and units, a numeric key of exactly 0, prose on the human-graded item), and reads every row
//      back from the database: columns, key version, who stamped it. The page never sends checked_by.
//   3. is refused for a value of 0 with no tolerance, a third decimal in points, and prose on an auto-checked item.
//   4. edits a key (a new version, the old one superseded), edits only the text (no new version), reorders, retires
//      and restores a question, and watches the item's points follow the questions.
//   5. imports a file with one good row and bad ones: the dry run lists every row and refusal, nothing is written,
//      the write button stays off. Then a good file is written; then the shipped example file.
//   6. previews a question as a student: no key anywhere in it.
//   7. as a cadet of that course: the database returns 0 key rows and 0 question rows, in the browser and over REST,
//      while the keys exist (the count is read back as the owner). A cadet cannot write. An instructor gets the
//      directors-only state and the database refuses an instructor's write.
//   8. leaves one EXAMPLE item with the example questions for the course director (kept on purpose).
// A key counts only if the stored column equals a value worked out here from fixed inputs, not from the page's code.
//
// Environment: STAGING_DB_URL and PREP_PYTHON (the venv python).
// Usage:  node tests/browser-harness/v2-questions-entry.mjs [--base http://localhost:8012] [--no-examples]
// No screenshots. Every name written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8012');
const NO_EXAMPLES = argv.includes('--no-examples');
const DOMAIN = 'prep-staging.example';
const PY = process.env.PREP_PYTHON;
if (!PY || !process.env.STAGING_DB_URL) { console.error('Need PREP_PYTHON and STAGING_DB_URL'); process.exit(2); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

const ENTRY = 'ee6fabc3-2c57-5f42-8fc9-8023fb267808';        // gate entry course offering (inactive)
const TAG = 'Qharness item';
const EXAMPLE = 'Example quiz with questions';
const RB = resolve(import.meta.dirname, 'v2_questions_readback.py');
const RB_ITEMS = resolve(import.meta.dirname, 'v2_items_readback.py');
const EXAMPLE_FILE = resolve(import.meta.dirname, '../../docs/examples/questions-example.csv');

// The staging API address and its publishable key are public by design (RLS protects the data); read them from config.js.
const cfg = readFileSync(resolve(import.meta.dirname, '../../site/js/config.js'), 'utf8');
const stagingBlock = cfg.slice(cfg.indexOf('const PREP_STAGING'));
const API = stagingBlock.match(/url:\s*'([^']+)'/)[1];
const KEY = stagingBlock.match(/anon:\s*'([^']+)'/)[1];
if (!/wkibeptktbnaddfynrwr/.test(API)) { console.error('REFUSED: the staging address is not the staging project'); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const run = (script, ...args) => JSON.parse(execFileSync(PY, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const readItems = (prefix) => run(RB, 'read', ENTRY, prefix);
const byTitle = (rb, title) => Object.values(rb.items).find(i => i.title === title);
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const cur = (q) => q && q.keys.find(k => k.superseded === null);

run(RB_ITEMS, 'clean', TAG); run(RB_ITEMS, 'clean', EXAMPLE);       // leftovers from an earlier run

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1200 } });

async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [], alerts = [];
  page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
  page.on('dialog', d => { if (d.type() === 'alert') alerts.push(d.message()); d.accept().catch(() => {}); });
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, problems, alerts };
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
const setValue = (page, sel, v) => page.$eval(sel, (el, val) => {
  el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

/** Make an item through the Items page's own form. Returns the error text ('' when saved). */
async function makeItem(page, spec) {
  await openReady(page, '/site/faculty/items.html', '#new-btn');
  await page.click('#new-btn'); await page.waitForSelector('#item-modal.open', { timeout: 8000 });
  await page.select('#i-kind', spec.kind); await wait(250);
  if (spec.delivery) { await page.select('#i-delivery', spec.delivery); await wait(150); }
  if (spec.grading) { await page.select('#i-grading', spec.grading); await wait(150); }
  await setValue(page, '#i-title', spec.title);
  if (spec.points !== undefined && !(await page.$eval('#i-points', e => e.disabled))) await setValue(page, '#i-points', spec.points);
  if (spec.allDate) await setValue(page, '#i-alldate', spec.allDate);
  await page.click('#im-save');
  await page.waitForFunction(() => !document.querySelector('#item-modal.open') ||
    (document.querySelector('#im-error') && document.querySelector('#im-error').style.display === 'block'), { timeout: 15000 }).catch(() => {});
  await wait(1200);
  return page.$eval('#im-error', e => e.style.display === 'block' ? e.textContent : '').catch(() => '');
}
/** Click the Questions button on an item's row of the Items page and wait for the Questions page. */
async function openQuestions(page, title) {
  await openReady(page, '/site/faculty/items.html');
  const clicked = await page.evaluate((t) => {
    const tr = [...document.querySelectorAll('#items-table tbody tr')].find(r => r.cells[0].innerText.includes(t));
    const a = tr && tr.querySelector('[data-questions]'); if (!a) return false; a.click(); return true;
  }, title);
  if (!clicked) return false;
  const ready = await page.waitForSelector('#add-btn', { timeout: 45000 }).then(() => true).catch(() => false);
  await wait(500);
  return ready;
}
const modalError = (page) => page.$eval('#qm-error', e => e.style.display === 'block' ? e.textContent : '').catch(() => '');

/** Fill and save the question form. Returns the error text ('' when saved). */
async function addQuestion(page, s) {
  await page.click('#add-btn'); await page.waitForSelector('#q-modal.open', { timeout: 8000 });
  await page.select('#q-format', s.format); await wait(150);
  if (s.qid) await setValue(page, '#q-qid', s.qid);
  await setValue(page, '#q-prompt', s.prompt);
  await setValue(page, '#q-points', s.points);
  if (s.choices) {
    while ((await page.$$('#q-choices [data-choice]')).length < s.choices.length) await page.click('#q-add-choice');
    const rows = await page.$$('#q-choices [data-choice]');
    for (let i = 0; i < s.choices.length; i++) {
      await (await rows[i].$('[data-text]')).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, s.choices[i]);
    }
    for (const i of s.correct || []) await (await rows[i].$('[data-correct]')).click();
  }
  if (s.format === 'numeric') {
    if (s.value !== undefined) await setValue(page, '#q-value', s.value);
    if (s.tolAbs !== undefined) await setValue(page, '#q-tolabs', s.tolAbs);
    if (s.tolPct !== undefined) await setValue(page, '#q-tolpct', s.tolPct);
    if (s.sigFigs !== undefined) await setValue(page, '#q-sigfigs', s.sigFigs);
    if (s.sigMode) await page.select('#q-sigmode', s.sigMode);
    if (s.unit !== undefined) await setValue(page, '#q-unit', s.unit);
    if (s.unitMode) await page.select('#q-unitmode', s.unitMode);
    if (s.aliases !== undefined) await setValue(page, '#q-aliases', s.aliases);
    if (s.unitHint !== undefined) await setValue(page, '#q-unithint', s.unitHint);
  }
  if (s.reference !== undefined) await setValue(page, '#q-reference', s.reference);
  await act(page, async () => {
    await press(page, '#qm-save');
    await page.waitForFunction(() => (document.querySelector('#qm-error') && document.querySelector('#qm-error').style.display === 'block') ||
      !document.querySelector('#q-modal.open'), { timeout: 20000 }).catch(() => {});
  });
  const err = await modalError(page);
  if (err) { await page.click('#q-modal [data-close]'); await wait(200); }
  return err;
}
async function rowButton(page, qid, attr) {
  return page.evaluate((id, a) => {
    const tr = document.querySelector(`#q-table tbody tr[data-qid="${id}"]`); const b = tr && tr.querySelector(`[${a}]`);
    if (!b || b.disabled) return false; b.click(); return true;
  }, qid, attr);
}
/** Press a button the way a click does, without depending on where an animating dialog is at this instant. */
const press = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.disabled) return false; e.click(); return true; }, sel);
/** Run an action that makes the page reload its list, then wait until the list has been drawn again. */
async function act(page, fn, ms = 25000) {
  const n0 = await page.evaluate(() => Number(document.getElementById('main')?.dataset.drawn) || 0);
  const out = await fn();
  await page.waitForFunction((n) => (Number(document.getElementById('main')?.dataset.drawn) || 0) > n, { timeout: ms }, n0).catch(() => {});
  await wait(300);
  return out;
}
/** Open a page and wait until it has drawn something other than its spinner. */
async function openReady(page, path, selector = '#main .alert, #main .empty-state, #add-btn, #items-table, #new-btn') {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector(selector, { timeout: 25000 }).catch(() => {});
  await wait(500);
  return page.evaluate(() => document.body?.innerText || '');
}
const pageText = (page) => page.evaluate(() => document.body.innerText);

async function dryRun(page, text) {
  if (!(await page.$('#imp-modal.open'))) { await page.click('#imp-btn'); await page.waitForSelector('#imp-modal.open', { timeout: 8000 }); }
  await setValue(page, '#imp-text', text);
  await press(page, '#imp-check'); await wait(500);
  return page.evaluate(() => ({
    verdict: document.getElementById('imp-verdict')?.innerText || '',
    report: document.getElementById('imp-report')?.innerText || '',
    rows: [...document.querySelectorAll('#imp-table tbody tr')].map(r => ({ line: r.dataset.line, ok: r.dataset.ok })),
    writeDisabled: document.getElementById('imp-write').disabled,
  }));
}
async function closeImport(page) { await page.click('#imp-modal [data-close]').catch(() => {}); await wait(300); }

// ===================================================================================================
console.log('\n== 1. three items, made on the Items page');
const dir = await signIn(`gatedirector@${DOMAIN}`, 'gatedirector1234');
const d = dir.page;
check('director signed in', !/login\.html/.test(d.url()), d.url());
await useCourse(d, ENTRY, 'Gate entry');
let err = await makeItem(d, { kind: 'homework', title: `${TAG} auto`, allDate: '2026-12-10' });
check('the auto-checked item saved', err === '', err);
err = await makeItem(d, { kind: 'lab', title: `${TAG} human`, points: '4', delivery: 'online_questions', grading: 'human_graded' });
check('the human-graded online item saved', err === '', err);
err = await makeItem(d, { kind: 'case_study', title: `${TAG} typed`, points: '5' });
check('a typed-response item saved', err === '', err);

await openReady(d, '/site/faculty/items.html');
const links = await d.$$eval('#items-table tbody tr', rs => rs.filter(r => r.cells[0].innerText.includes('Qharness item')).map(r =>
  ({ t: r.cells[0].innerText.split('\n')[0], q: !!r.querySelector('[data-questions]'), href: r.querySelector('[data-questions]')?.getAttribute('href') || '' })));
check('the auto and human items have a Questions button, the typed item does not',
  links.length === 3 && links.find(l => /auto/.test(l.t)).q && links.find(l => /human/.test(l.t)).q && !links.find(l => /typed/.test(l.t)).q, JSON.stringify(links));
check('the button goes to questions.html?a=<offering id>', links.filter(l => l.q).every(l => /^questions\.html\?a=[0-9a-f-]{36}$/.test(l.href)), JSON.stringify(links));

let rb = readItems(TAG);
const auto = byTitle(rb, `${TAG} auto`), human = byTitle(rb, `${TAG} human`), typed = byTitle(rb, `${TAG} typed`);
check('the items exist with the paths the page promised',
  auto?.delivery === 'online_questions' && auto?.grading === 'auto_checked' && human?.grading === 'human_graded' && typed?.delivery === 'typed_response');
check('the auto item starts at 0 points and is unpublished', auto.points === '0.00' && auto.published === false && auto.new_page === true, JSON.stringify([auto.points, auto.published]));
const autoId = Object.keys(rb.items).find(k => rb.items[k].title === `${TAG} auto`);
const typedId = Object.keys(rb.items).find(k => rb.items[k].title === `${TAG} typed`);

// ===================================================================================================
console.log('\n== 2. one question of each type, by hand');
check('Questions button opens the page', await openQuestions(d, `${TAG} auto`));
let text = await pageText(d);
check('the page names the item and says it is auto-checked', /Qharness item auto/.test(text) && /auto-checked/.test(text));
check('it says the points are the sum of the questions', /the sum of its 0 questions/.test(text), text.slice(0, 300));
check('it says the item stays unpublished and no student reads a key', /stays unpublished/.test(text) && /no student can read an answer key/.test(text));
check('there is no publish control', !(await d.$('[data-pub]')) && !/^\s*Publish\s*$/m.test(text));
const formats = await d.evaluate(async () => { document.getElementById('add-btn').click(); await new Promise(r => setTimeout(r, 200));
  const v = [...document.querySelectorAll('#q-format option')].map(o => o.value); document.querySelector('#q-modal [data-close]').click(); return v; });
check('prose is not offered on an auto-checked item', same(formats, ['multiple_choice', 'multiple_select', 'numeric']), JSON.stringify(formats));

err = await addQuestion(d, { format: 'multiple_choice', qid: 'q1', prompt: 'Which quantity is a vector?', points: '1', choices: ['Speed', 'Velocity', 'Distance'], correct: [1] });
check('multiple choice saved', err === '', err);
err = await addQuestion(d, { format: 'multiple_select', qid: 'q2', prompt: 'Select every force on a block at rest.', points: '2', choices: ['Weight', 'Normal force', 'Friction', 'Thrust'], correct: [0, 1] });
check('multiple select saved', err === '', err);
err = await addQuestion(d, { format: 'numeric', qid: 'q3', prompt: 'Find the acceleration.', points: '2.5', value: '7.3141', tolAbs: '0.05', tolPct: '1',
  sigFigs: '3', sigMode: 'warn', unit: 'm/s^2', unitMode: 'warn', aliases: 'm/s2, m s^-2', unitHint: 'm/s^2' });
check('numeric with tolerances, significant figures and units saved', err === '', err);
err = await addQuestion(d, { format: 'numeric', qid: 'q4', prompt: 'What is the net force at constant velocity?', points: '1', value: '0', tolAbs: '0.01', unit: 'N', unitMode: 'ignore' });
check('numeric with a correct value of 0 saved', err === '', err);

rb = readItems(TAG);
let a = byTitle(rb, `${TAG} auto`);
const Q = a.questions;
check('four questions stored in order of entry', same(Object.keys(Q).sort(), ['q1', 'q2', 'q3', 'q4']) && ['q1', 'q2', 'q3', 'q4'].every((k, i) => Q[k].position === i + 1),
  JSON.stringify(Object.entries(Q).map(([k, v]) => [k, v.position])));
check('multiple choice: format, points, choices a b c, key b, all-or-nothing', Q.q1.format === 'multiple_choice' && Q.q1.points === '1.00'
  && same(Q.q1.choices, [{ id: 'a', text: 'Speed' }, { id: 'b', text: 'Velocity' }, { id: 'c', text: 'Distance' }]) && same(cur(Q.q1).correct, ['b']) && cur(Q.q1).rule === 'all_or_nothing', JSON.stringify(Q.q1));
check('multiple select: key a and b', Q.q2.format === 'multiple_select' && same(cur(Q.q2).correct, ['a', 'b']) && Q.q2.points === '2.00');
const k3 = cur(Q.q3);
check('numeric: value 7.3141, tolerances 0.05 and 1, 3 sig figs warn', k3.value === '7.3141' && k3.tol_abs === '0.05' && k3.tol_pct === '1' && k3.sig_figs === 3 && k3.sig_mode === 'warn', JSON.stringify(k3));
check('numeric: unit m/s^2 warn, two aliases, hint on the question, points 2.50', k3.unit === 'm/s^2' && k3.unit_mode === 'warn' && same(k3.aliases, ['m/s2', 'm s^-2']) && Q.q3.unit_hint === 'm/s^2' && Q.q3.points === '2.50', JSON.stringify([k3.unit, k3.aliases, Q.q3.unit_hint]));
const k4 = cur(Q.q4);
check('a correct value of 0 is stored as 0 with tolerance 0.01, not null', k4.value === '0' && k4.tol_abs === '0.01' && k4.tol_pct === null, JSON.stringify(k4));
const allKeys = Object.values(Q).flatMap(q => q.keys);
check('every key is version 1, written by a human, current', allKeys.length === 4 && allKeys.every(k => k.version === 1 && k.written_by === 'human' && k.superseded === null));
check('the database stamped created_by; nobody stamped checked_by or checked_at', allKeys.every(k => k.has_created_by === true && k.has_checked_by === false && k.has_checked_at === false), JSON.stringify(allKeys.map(k => [k.has_created_by, k.has_checked_by])));
check('the item\'s points follow the questions: 1 + 2 + 2.5 + 1 = 6.5', a.points === '6.50' && a.published === false, a.points);
text = await pageText(d);
check('the page shows 6.5 points and 4 questions', /\b6\.5\b/.test(text) && /sum of its 4 questions/.test(text), text.slice(200, 500));
check('each row shows its key version', (await d.$$eval('#q-table tbody tr', rs => rs.every(r => /v1/.test(r.cells[5].innerText)))));

// human-graded item: prose is offered
check('Questions button opens the human-graded item', await openQuestions(d, `${TAG} human`));
text = await pageText(d);
check('the human-graded page says its points are set on the Assignments page', /human graded/.test(text) && /set on the Assignments page/.test(text));
const hf = await d.evaluate(async () => { document.getElementById('add-btn').click(); await new Promise(r => setTimeout(r, 200));
  const v = [...document.querySelectorAll('#q-format option')].map(o => o.value); document.querySelector('#q-modal [data-close]').click(); return v; });
check('prose is offered on a human-graded item', hf.includes('prose') && hf.length === 4, JSON.stringify(hf));
err = await addQuestion(d, { format: 'prose', qid: 'p1', prompt: 'Explain why the block does not accelerate.', points: '3', reference: 'Look for balanced forces.' });
check('prose saved on the human-graded item', err === '', err);
err = await addQuestion(d, { format: 'multiple_choice', qid: 'p2', prompt: 'Pick one.', points: '1', choices: ['Yes', 'No'], correct: [0] });
check('a machine-marked question saved on the human-graded item', err === '', err);
rb = readItems(TAG);
const h = byTitle(rb, `${TAG} human`);
check('prose: only reference text on its key, no machine field', h.questions.p1.format === 'prose' && cur(h.questions.p1).reference === 'Look for balanced forces.'
  && cur(h.questions.p1).value === null && cur(h.questions.p1).correct === null && cur(h.questions.p1).tol_abs === null, JSON.stringify(cur(h.questions.p1)));
check('on a human-graded item the offering still owns the points (4), whatever the questions add up to', h.points === '4.00', h.points);

// typed item and an older-page item
text = await openReady(d, `/site/faculty/questions.html?a=${typedId}`);
check('an item that is not delivered as questions is refused in words', /not delivered as questions/.test(text) && !(await d.$('#add-btn')), text.slice(0, 200));
const VECTOR = 'b17381d2-5545-519b-a553-c20809dc9520';       // gate vector course offering: a different course
const other = JSON.parse(execFileSync(PY, [RB, 'read', VECTOR, 'Gate'], { encoding: 'utf8' }));
const otherId = Object.keys(other.items)[0];
check('an item of another course exists to try', !!otherId);
if (otherId) {
  text = await openReady(d, `/site/faculty/questions.html?a=${otherId}`);
  check('an item of a course you have not selected is refused in words', /not in the course offering you have selected/.test(text) && !(await d.$('#add-btn')), text.slice(0, 300));
}

// ===================================================================================================
console.log('\n== 3. refusals');
check('Questions page opens the auto item again', await openQuestions(d, `${TAG} auto`));
err = await addQuestion(d, { format: 'numeric', qid: 'z1', prompt: 'Zero without a tolerance.', points: '1', value: '0' });
check('a value of 0 with no tolerance is refused, in words', /absolute tolerance/.test(err), err);
err = await addQuestion(d, { format: 'numeric', qid: 'z2', prompt: 'Too many decimals.', points: '1.255', value: '3', tolAbs: '0.1' });
check('a third decimal in points is refused, not rounded', /two decimal places at most/.test(err), err);
err = await addQuestion(d, { format: 'multiple_choice', qid: 'q1', prompt: 'Reused id.', points: '1', choices: ['A', 'B'], correct: [0] });
check('a reused question id is refused', /never reused/.test(err), err);
err = await addQuestion(d, { format: 'multiple_choice', qid: 'z3', prompt: 'No correct choice.', points: '1', choices: ['A', 'B'], correct: [] });
check('a choice question with nothing marked correct is refused', /mark which/.test(err), err);
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('none of those wrote anything', same(Object.keys(a.questions).sort(), ['q1', 'q2', 'q3', 'q4']) && a.points === '6.50');

// ===================================================================================================
console.log('\n== 4. a key edit is a new version; reorder; retire and restore');
// A key edit supersedes the current key row and inserts the next version. Migration 040 made that fast
// (it took 13 to 27 seconds before, past the API's 8 second limit), so the page edit must now succeed. A
// real timeout still gets its own clean refusal, which the unit tests cover; it is not accepted here.
const editMs = [];
async function editKey(qid, mutate) {
  await rowButton(d, qid, 'data-qedit'); await d.waitForSelector('#q-modal.open'); await wait(500);
  await mutate();
  const t0 = Date.now();
  await act(d, async () => {
    await press(d, '#qm-save');
    await d.waitForFunction(() => (document.querySelector('#qm-error') && document.querySelector('#qm-error').style.display === 'block') ||
      !document.querySelector('#q-modal.open'), { timeout: 90000 }).catch(() => {});
  }, 1500);
  editMs.push(Date.now() - t0);
  const e = await modalError(d);
  if (e) { await d.click('#q-modal [data-close]'); await wait(300); }
  return e;
}
await rowButton(d, 'q1', 'data-qedit'); await d.waitForSelector('#q-modal.open'); await wait(500);
check('the edit form shows the key version', /version 1/.test(await d.$eval('#q-version-note', e => e.textContent)));
check('the id and format cannot be changed in the edit form', await d.$eval('#q-qid', e => e.disabled) && await d.$eval('#q-format', e => e.disabled));
await d.click('#q-modal [data-close]'); await wait(300);
const e1 = await editKey('q1', () => d.evaluate(() => { document.querySelectorAll('#q-choices [data-choice]')[2].querySelector('[data-correct]').click(); }));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
const q1 = a.questions.q1;
check('the page saved the q1 key edit with no error', e1 === '', e1);
check('q1 has two key versions; version 1 is superseded; version 2 is current and says Distance', q1.keys.length === 2 && q1.keys[0].superseded !== null && q1.keys[1].superseded === null
  && same(q1.keys[0].correct, ['b']) && same(q1.keys[1].correct, ['c']) && q1.keys[1].version === 2, JSON.stringify(q1.keys));
const q1Versions = q1.keys.length;
// Editing only the wording touches no key row at all, so it never makes a version.
await rowButton(d, 'q1', 'data-qedit'); await d.waitForSelector('#q-modal.open'); await wait(500);
await setValue(d, '#q-prompt', 'Which quantity is a vector? (reworded)');
await act(d, () => press(d, '#qm-save'));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('editing only the wording saves, and makes no new key version', a.questions.q1.keys.length === q1Versions && a.questions.q1.prompt.includes('reworded'), JSON.stringify(a.questions.q1.keys.map(k => k.version)));
const e4 = await editKey('q4', () => setValue(d, '#q-tolabs', '0'));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('the page saved the q4 key edit with no error', e4 === '', e4);
check('changing the tolerance on the key of 0 is version 2 and the value stays 0', a.questions.q4.keys.length === 2 && cur(a.questions.q4).value === '0' && cur(a.questions.q4).tol_abs === '0' && cur(a.questions.q4).version === 2, JSON.stringify(a.questions.q4.keys));
console.log(`  (page key edit times in ms: ${editMs.join(', ')})`);
check('each page key edit finished well inside the API limit of 8 seconds', editMs.every(ms => ms < 6000), String(editMs));
const q4Before = a.questions.q4.keys.length;
let ke = { versions: [] };
try { ke = JSON.parse(execFileSync(PY, [RB, 'keyedit', ENTRY, `${TAG} auto`, 'q4', '0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, killSignal: 'SIGKILL' })); } catch (e) { console.log('  keyedit step failed to run: ' + String(e.message).slice(0, 120)); }
const kv = ke.versions;
check('database level, as the director, rolled back: superseding then inserting version + 1 is accepted, the value 0 carries over, the database stamps created_by and no checker',
  kv.length >= 2 && kv[kv.length - 1][0] === kv[kv.length - 2][0] + 1 && kv[kv.length - 1][1] === '0' && kv[kv.length - 1][2] === '0'
  && kv[kv.length - 1][4] === true && kv[kv.length - 1][5] === false && kv[kv.length - 2][3] === true, JSON.stringify(ke));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('... and that rolled back: q4 is unchanged by it', a.questions.q4.keys.length === q4Before);

check('move q1 down', await act(d, () => rowButton(d, 'q1', 'data-qmove][data-dir="down"')));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('q2 is now first and q1 second; positions are 1..4 with no gaps', a.questions.q2.position === 1 && a.questions.q1.position === 2 && a.questions.q3.position === 3 && a.questions.q4.position === 4,
  JSON.stringify(Object.entries(a.questions).map(([k, v]) => [k, v.position])));
check('the first row cannot move up', await d.evaluate(() => document.querySelector('#q-table tbody tr [data-qmove][data-dir="up"]').disabled));

check('retire q4', await act(d, () => rowButton(d, 'q4', 'data-qretire')));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('a retired question stays, and the item\'s points drop to 5.50', a.questions.q4.retired === true && a.points === '5.50', a.points);
text = await pageText(d);
check('the page marks it Retired and shows 5.5', /Retired/.test(text) && /\b5\.5\b/.test(text));
check('restore q4', await act(d, () => rowButton(d, 'q4', 'data-qretire')));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('restoring puts the points back to 6.50', a.questions.q4.retired === false && a.points === '6.50', a.points);

await openReady(d, '/site/faculty/items.html');
const row = await d.$$eval('#items-table tbody tr', rs => rs.filter(r => r.cells[0].innerText.includes('Qharness item auto')).map(r => r.cells[4].innerText));
check('the Items page shows the item at 6.50 points', row.length === 1 && /6\.5/.test(row[0]), JSON.stringify(row));
await d.evaluate(() => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.cells[0].innerText.includes('Qharness item auto')).querySelector('[data-edit]').click());
await d.waitForSelector('#item-modal.open'); await wait(300);
const note = await d.$eval('#i-points-note', e => e.textContent);
check('the points box is off, and its note no longer says questions come later', await d.$eval('#i-points', e => e.disabled) && /Set by the questions/.test(note) && !/later page/.test(note), note);
await d.click('#item-modal [data-close]');

// ===================================================================================================
console.log('\n== 5. bulk import');
check('Questions page opens the auto item for the import', await openQuestions(d, `${TAG} auto`));
const BAD = [
  'qid,format,prompt,points,choices,correct,value,tol_abs',
  'imp1,numeric,"Good row",1,,,0,0',
  'imp2,numeric,"No value on this one",1,,,,',
  'imp3,prose,"Explain",2,,,,',
  'imp4,multiple_choice,"Third decimal",1.005,A|B,a,,',
].join('\n');
let dr = await dryRun(d, BAD);
check('the dry run lists all four rows', dr.rows.length === 4 && same(dr.rows.map(r => r.ok), ['1', '0', '0', '0']), JSON.stringify(dr.rows));
check('it says the whole file is refused and nothing is written', /refused, so the whole file is refused and nothing will be written/.test(dr.verdict), dr.verdict);
check('every refusal names its row and reason', /Row 3.*correct value/.test(dr.report) && /Row 4.*prose question cannot be on an auto-checked item/.test(dr.report) && /Row 5.*two decimal places at most/.test(dr.report), dr.report.slice(0, 600));
check('the write button stays off', dr.writeDisabled === true);
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('nothing was written, not even the good row', !('imp1' in a.questions) && Object.keys(a.questions).length === 4 && a.points === '6.50');
dr = await dryRun(d, 'qid,format,prompt,points,colour\nx,numeric,"hi",1,red');
check('an unknown column refuses the file', /Unknown column/.test(dr.report) && dr.writeDisabled === true, dr.report.slice(0, 200));
dr = await dryRun(d, 'format,prompt,points\nnumeric,"never closes,1');
check('an unclosed quote refuses the file', /never closes/.test(dr.report) && dr.writeDisabled === true, dr.report.slice(0, 200));

// ---- a file that is not UTF-8 is refused, with the fix (review B S1) ----
{
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir2 = mkdtempSync(join(tmpdir(), 'prep-csv-'));
  const latin1 = join(dir2, 'latin1.csv');
  writeFileSync(latin1, Buffer.concat([Buffer.from('qid,format,prompt,points\nu1,numeric,"Temperature in ', 'latin1'), Buffer.from([0xB0]), Buffer.from('C",1', 'latin1')]));
  if (!(await d.$('#imp-modal.open'))) { await d.click('#imp-btn'); await d.waitForSelector('#imp-modal.open', { timeout: 8000 }); }
  await setValue(d, '#imp-text', 'left over from the last check');
  const input2 = await d.$('#imp-file'); await input2.uploadFile(latin1); await wait(800);
  const e1 = await d.$eval('#imp-error', e => e.style.display === 'block' ? e.innerText : '');
  check('a Latin-1 file is refused, with the one-sentence fix', /CSV UTF-8/.test(e1), e1);
  check('... and the box is emptied, so nothing half-read can be written', (await d.$eval('#imp-text', e => e.value)) === '' && (await d.$eval('#imp-write', e => e.disabled)));
  const utf8 = join(dir2, 'utf8.csv');
  writeFileSync(utf8, 'qid,format,prompt,points,value,tol_abs\nu1,numeric,"Temperature in \u00B0C",1,0,0\n', 'utf8');
  await input2.uploadFile(utf8); await wait(800);
  check('the same text saved as UTF-8 is accepted into the box', (await d.$eval('#imp-text', e => e.value)).includes('\u00B0C') && !(await d.$eval('#imp-error', e => e.style.display === 'block')));
  await closeImport(d);
}

// ---- Write uses only the plan of the text now in the box (review B S3) ----
{
  const OKTEXT = 'qid,format,prompt,points,value,tol_abs\nstale1,numeric,"One",1,1,0';
  const r1 = await dryRun(d, OKTEXT);
  check('a checked file turns Write on', r1.writeDisabled === false, r1.verdict);
  await setValue(d, '#imp-text', OKTEXT + '\nstale2,numeric,"Two",1,2,0');
  check('any edit after the check turns Write off and says the check is stale',
    (await d.$eval('#imp-write', e => e.disabled)) === true && /changed the text after it was checked/.test(await d.$eval('#imp-report', e => e.innerText)));
  await press(d, '#imp-write'); await wait(800);
  rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
  check('pressing Write on the stale text writes nothing', !('stale1' in a.questions) && !('stale2' in a.questions));
  const r2 = await dryRun(d, 'qid,format,prompt,points,choices,correct\namb,multiple_choice,"Which?",1,b|a,a');
  check('a correct value that is the letter of one choice and the text of another is refused as ambiguous', /ambiguous/.test(r2.report) && r2.writeDisabled === true, r2.report.slice(0, 300));
  await closeImport(d);
}

const GOOD = [
  'qid,format,prompt,points,choices,correct,value,tol_abs,tol_pct,sig_figs,sig_fig_mode,unit,unit_mode',
  'imp1,numeric,"Net force on a body at rest",1,,,0,0,,,,N,warn',
  'imp2,multiple_choice,"Does a heavier ball fall faster in a vacuum?",2,"Yes, always|No",no,,,,,,,',
  'imp3,multiple_select,"Pick the SI base units",1.5,metre|newton|kilogram|joule,a|c,,,,,,,',
].join('\n');
dr = await dryRun(d, GOOD);
check('a good file: every row will be added and the write button is on', dr.rows.length === 3 && dr.rows.every(r => r.ok === '1') && dr.writeDisabled === false && /Every row is good/.test(dr.verdict), dr.verdict);
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('the dry run itself wrote nothing', !('imp1' in a.questions));
await act(d, () => press(d, '#imp-write'));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('the three rows were written', ['imp1', 'imp2', 'imp3'].every(k => k in a.questions), Object.keys(a.questions).join());
check('imp1: a key of exactly 0 with tolerance 0, unit N warn, version 1', cur(a.questions.imp1).value === '0' && cur(a.questions.imp1).tol_abs === '0' && cur(a.questions.imp1).unit === 'N' && cur(a.questions.imp1).unit_mode === 'warn' && cur(a.questions.imp1).version === 1, JSON.stringify(cur(a.questions.imp1)));
check('imp2: a comma inside quotes stayed in the choice, and the correct choice named by text is b', a.questions.imp2.choices[0].text === 'Yes, always' && same(cur(a.questions.imp2).correct, ['b']), JSON.stringify(a.questions.imp2.choices));
check('imp3: 1.5 points, letters a|c name two choices', a.questions.imp3.points === '1.50' && same(cur(a.questions.imp3).correct, ['a', 'c']));
check('imported rows are positioned after the existing ones', a.questions.imp1.position === 5 && a.questions.imp3.position === 7, JSON.stringify([a.questions.imp1.position, a.questions.imp3.position]));
check('imported keys: human, stamped by the database, no checker', ['imp1', 'imp2', 'imp3'].every(k => { const c = cur(a.questions[k]); return c.written_by === 'human' && c.has_created_by && !c.has_checked_by; }));
check('the item\'s points now follow all seven: 6.5 + 1 + 2 + 1.5 = 11', a.points === '11.00', a.points);
await openReady(d, `/site/faculty/questions.html?a=${autoId}`);
check('importing again with the same ids is refused (the import only adds)', /already used in this item/.test((await dryRun(d, GOOD)).report));
await closeImport(d);
check('remove imp2', await act(d, () => rowButton(d, 'imp2', 'data-qremove')));
rb = readItems(TAG); a = byTitle(rb, `${TAG} auto`);
check('a removed question and its key are gone, and the points follow (9)', !('imp2' in a.questions) && a.points === '9.00', a.points);
const orph = run(RB, 'orphans');
check('no key is left without its question', orph.keys === 0 && orph.questions === 0, JSON.stringify(orph));

// ===================================================================================================
console.log('\n== 6. preview as a student');
await openReady(d, `/site/faculty/questions.html?a=${autoId}`);
await press(d, '#pv-btn'); await wait(400);
const pv = await d.evaluate(() => ({ text: document.getElementById('pv-all').innerText, html: document.getElementById('pv-all').innerHTML }));
check('the preview shows the questions and choices', /Which quantity is a vector/.test(pv.text) && /Velocity/.test(pv.text) && /Find the acceleration/.test(pv.text));
check('the preview holds no key: no value, tolerance, unit rule or checked box', !/7\.3141/.test(pv.html) && !/0\.05/.test(pv.html) && !/checked/.test(pv.html) && !/correct/i.test(pv.text), pv.text.slice(0, 200));
check('the preview inputs are disabled', (pv.html.match(/disabled/g) || []).length >= 6);
await rowButton(d, 'q3', 'data-qedit'); await d.waitForSelector('#q-modal.open'); await wait(500);
await press(d, '#q-preview-btn'); await wait(300);
const one = await d.$eval('#q-preview-one', e => ({ t: e.innerText, h: e.innerHTML }));
check('the single-question preview shows the unit hint and not the key', /Find the acceleration/.test(one.t) && /m\/s\^2/.test(one.t) && !/7\.3141/.test(one.h));
await d.click('#q-modal [data-close]');
const listShowsKey = await d.evaluate(() => /7\.3141/.test(document.getElementById('main').innerHTML));
check('the question list itself shows no key value either', !listShowsKey);

// ===================================================================================================
console.log('\n== 7. the cadet, an instructor, and REST');
const rbNow = readItems(TAG);
check('keys really exist on staging (so a count of 0 for a cadet means something)', rbNow.total_keys >= 8, String(rbNow.total_keys));
const cad = await signIn(`cadet0401@${DOMAIN}`, '000401');
check('entry cadet signed in', !/login\.html/.test(cad.page.url()), cad.page.url());
await open(cad.page, '/site/student/dashboard.html', 2000);
const seen = await cad.page.evaluate(async (activity) => {
  const k = await window.db.from('question_keys').select('id');
  const q = await window.db.from('questions').select('id');
  const qa = await window.db.from('questions').select('id').eq('activity_id', activity);
  const ins = await window.db.from('question_keys').insert({ question_id: '00000000-0000-0000-0000-000000000000', version: 1 });
  const upd = await window.db.from('questions').update({ prompt_md: 'x' }).eq('activity_id', activity).select('id');
  return { keys: (k.data || []).length, keyErr: k.error ? k.error.message : null, questions: (q.data || []).length, qErr: q.error ? q.error.message : null,
           ofItem: (qa.data || []).length, insertError: !!ins.error, updated: (upd.data || []).length };
}, a.activity);
check('browser, signed in as a cadet: 0 key rows', seen.keys === 0 && !seen.keyErr, JSON.stringify(seen));
check('... 0 question rows at all, and none of the unpublished item', seen.questions === 0 && seen.ofItem === 0, JSON.stringify(seen));
check('... a cadet\'s write to the key table is refused, and an update changes nothing', seen.insertError === true && seen.updated === 0, JSON.stringify(seen));
await open(cad.page, `/site/faculty/questions.html?a=${autoId}`, 2500);
check('a cadet who opens the Questions page is turned away', !/faculty\/questions\.html/.test(cad.page.url()) || !(await cad.page.$('#add-btn')), cad.page.url());
check('no uncaught page error for the cadet', cad.problems.length === 0, cad.problems.join(' | '));
await cad.ctx.close();

// The same, over REST with a plain HTTP client: sign in with the password grant, then read the tables.
async function rest(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${token || KEY}`, 'Accept-Profile': 'app', 'Content-Profile': 'app', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body };
}
const tokenRes = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `cadet0401@${DOMAIN}`, password: '000401' }) });
const token = (await tokenRes.json()).access_token;
check('REST: the cadet signed in over the password grant', !!token);
let r = await rest('/rest/v1/question_keys?select=id', token);
check('REST, cadet: question_keys returns 0 rows', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest('/rest/v1/questions?select=id', token);
check('REST, cadet: questions returns 0 rows (the unpublished item\'s too)', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest(`/rest/v1/questions?select=id&activity_id=eq.${a.activity}`, token);
check('REST, cadet: asking for that item\'s questions by id returns 0 rows', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest('/rest/v1/question_keys', token, { method: 'POST', body: JSON.stringify({ question_id: '00000000-0000-0000-0000-000000000000', version: 1 }) });
check('REST, cadet: a write to question_keys is refused', r.status >= 400, JSON.stringify([r.status, r.body]).slice(0, 160));
r = await rest('/rest/v1/question_keys?select=id', null);
check('REST, no sign-in at all: no key rows are returned', (r.status >= 400) || (Array.isArray(r.body) && r.body.length === 0), JSON.stringify([r.status, r.body]).slice(0, 160));

const ins = await signIn(`gateinstructor@${DOMAIN}`, 'gateinstructor1234');
text = await openReady(ins.page, `/site/faculty/questions.html?a=${autoId}`);
check('an instructor (not a director) gets the directors-only state', /Directors only/.test(text) && !(await ins.page.$('#add-btn')), text.slice(0, 160));
const iw = await ins.page.evaluate(async (activity) => {
  const w = await window.db.from('questions').insert({ activity_id: activity, qid: 'sneak', format: 'prose', prompt_md: 'x', points: 0 });
  return { error: w.error ? w.error.message : null };
}, a.activity);
check('the database refuses an instructor\'s write to questions', !!iw.error, JSON.stringify(iw));
check('no uncaught page error for the instructor', ins.problems.length === 0, ins.problems.join(' | '));
await ins.ctx.close();
check('no uncaught page error for the director', dir.problems.length === 0, dir.problems.join(' | '));

// ===================================================================================================
console.log('\n== 8. clean-up, and the example item');
run(RB_ITEMS, 'clean', TAG);
rb = readItems(TAG);
const orph2 = run(RB, 'orphans');
check('clean-up removed every walkthrough item, with its questions and keys', Object.keys(rb.items).length === 0 && orph2.questions === 0 && orph2.keys === 0, JSON.stringify([Object.keys(rb.items).length, orph2]));
text = await openReady(d, '/site/faculty/items.html');
check('the seeded items are untouched after clean-up', /Gate homework 1/.test(text) && /Gate exam 1/.test(text) && /Gate quiz 1/.test(text));

if (!NO_EXAMPLES) {
  err = await makeItem(d, { kind: 'homework', title: EXAMPLE, allDate: '2026-12-10' });
  check('the example item saved', err === '', err);
  check('Questions button opens the example item', await openQuestions(d, EXAMPLE));
  await d.click('#imp-btn'); await d.waitForSelector('#imp-modal.open');
  const input = await d.$('#imp-file'); await input.uploadFile(EXAMPLE_FILE); await wait(800);
  const filled = await d.$eval('#imp-text', e => e.value);
  check('choosing the example file fills the box with its text', /^qid,format,prompt/.test(filled) && filled.includes('net,numeric'));
  await press(d, '#imp-check'); await wait(500);
  const exv = await d.$eval('#imp-verdict', e => e.innerText).catch(() => '');
  check('the example file passes its own dry run', /Every row is good. 4 questions/.test(exv), exv);
  await act(d, () => press(d, '#imp-write'));
  const ex = readItems(EXAMPLE); const item = byTitle(ex, EXAMPLE);
  check('four example questions are left on the entry course, unpublished, worth 6 points',
    item && Object.keys(item.questions).length === 4 && item.points === '6.00' && item.published === false && item.new_page === true, JSON.stringify(item && [Object.keys(item.questions), item.points]));
  check('the example\'s key of 0 is stored as 0', item && cur(item.questions.net).value === '0' && cur(item.questions.net).tol_abs === '0.01');
}

await dir.ctx.close();
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
