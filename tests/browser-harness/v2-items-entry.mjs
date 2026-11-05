// v2-items-entry.mjs -- the item entry page (site/faculty/items.html), in a real browser. STAGING only.
//
// Needs scripts/staging/serve_local.py running, and the seeds present: seed_staging.py, seed_v2_gate.py.
// It signs in as seeded, invented people, never as the service role, and:
//   1. as the gate director, on the gate ENTRY course (inactive; sections ENT-A meets no day, ENT-B meets W and F)
//      creates one item of each of the seven kinds, plus an interactive tutor item, through the page's form;
//      each is read back from the database: marker set, not published, kind, delivery, grading, points, flags,
//      no lesson number, the stored deadline columns, and what app.deadline_rows() gives each section.
//   2. on a second made-up course whose three sections meet on no day (items-nodays), creates two items.
//   3. edits an item (opened by the ?a= link the older page sends), removes one, and is refused when it tries
//      to remove an item that has grades.
//   4. shows the older Assignments page offers "Open on the newer page" for these items and no Edit/Publish/Remove,
//      and that the items page lists an item entered on the older page read-only with a link to the older editor.
//   5. as a cadet: sees none of them. As an instructor (not a director): gets the directors-only state, and the
//      database refuses a write.
//   6. leaves three EXAMPLE items on the entry course for the course director to open (kept on purpose).
// A deadline counts only if the stored instant equals the Mountain-time 23:59:59 (or the time typed), as UTC,
// worked out here from fixed values and not from the page's own code.
//
// Environment: STAGING_DB_URL and PREP_PYTHON (the venv python), for the read-back and the clean-up.
// Usage:  node tests/browser-harness/v2-items-entry.mjs [--base http://localhost:8012] [--no-examples]
// No screenshots are taken. Every name written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
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
const NODAYS = '83beac2b-e9e9-5b86-b08c-b22eb0e1846f';       // items-nodays offering (inactive), made by `setup`
const VECTOR = 'b17381d2-5545-519b-a553-c20809dc9520';       // gate vector course offering (active)
const TAG = 'Harness item';
const EXAMPLE = 'Example item';
const WARN = 'Harness warn';                                // the throwaway items of sections 3b and 3c
const RB = resolve(import.meta.dirname, 'v2_items_readback.py');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const py = (...args) => JSON.parse(execFileSync(PY, [RB, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const readItems = (offering, prefix) => py('read', offering, prefix);
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

py('setup');                                                 // idempotent: the no-meeting-days course
py('clean', TAG); py('clean', EXAMPLE); py('clean', WARN);                      // leftovers from an earlier run

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1100 } });

async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [], alerts = [], confirms = [], script = [];
  page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
  page.on('dialog', d => {
    if (d.type() === 'alert') alerts.push(d.message());
    if (d.type() === 'confirm') confirms.push(d.message());
    const yes = d.type() === 'confirm' && script.length ? script.shift() : true;      // `script`: answers to the next confirms
    (yes ? d.accept() : d.dismiss()).catch(() => {});
  });
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, problems, alerts, confirms, script };
}
async function open(page, path, ms = 2000) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.body?.innerText || '');
}
/** Pick a course the way a person does: the course menu in the top bar. */
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
const setCheck = (page, sel, on) => page.$eval(sel, (el, val) => { if (el.checked !== val) el.click(); }, on);
const optionValues = (page, sel) => page.$$eval(`${sel} option`, os => os.map(o => o.value));

/** Fill and save the form. Returns the delivery/grading the kind prefilled. */
async function enter(page, spec) {
  await page.click('#new-btn'); await page.waitForSelector('#item-modal.open', { timeout: 8000 });
  await page.select('#i-kind', spec.kind); await wait(250);
  const prefill = { delivery: await page.$eval('#i-delivery', e => e.value), grading: await page.$eval('#i-grading', e => e.value) };
  if (spec.delivery) { await page.select('#i-delivery', spec.delivery); await wait(150); }
  if (spec.grading) { await page.select('#i-grading', spec.grading); await wait(150); }
  await setValue(page, '#i-title', spec.title);
  const pointsDisabled = await page.$eval('#i-points', e => e.disabled);
  if (spec.points !== undefined && !pointsDisabled) await setValue(page, '#i-points', spec.points);
  if (spec.late === false) await setCheck(page, '#i-late', false);
  if (spec.bonus) await setCheck(page, '#i-bonus', true);
  if (spec.prog) await setCheck(page, '#i-prog', true);
  if (spec.slug) await setValue(page, '#i-islug', spec.slug);
  if (spec.allDate) await setValue(page, '#i-alldate', spec.allDate);
  if (spec.time) await setValue(page, '#i-time', spec.time);
  for (const [code, date] of Object.entries(spec.sections || {})) {
    const ok = await page.evaluate((c, d) => {
      const tr = [...document.querySelectorAll('#i-sections tbody tr')].find(t => t.cells[0].textContent.trim() === c);
      const inp = tr && tr.querySelector('input'); if (!inp) return false;
      inp.value = d; inp.dispatchEvent(new Event('input', { bubbles: true })); return true;
    }, code, date);
    if (!ok) check(`section ${code} has a date box`, false);
  }
  await page.click('#im-save');
  await page.waitForFunction(() => !document.querySelector('#item-modal.open') ||
    (document.querySelector('#im-error') && document.querySelector('#im-error').style.display === 'block'), { timeout: 15000 }).catch(() => {});
  await wait(1500);
  const err = await page.$eval('#im-error', e => e.style.display === 'block' ? e.textContent : '').catch(() => '');
  return { prefill, err, pointsDisabled };
}

// Mountain-time 23:59:59 as UTC, worked out by hand for the dates used (standard time in winter, daylight in June).
const END = { '2026-12-10': '2026-12-11T06:59:59Z', '2026-12-11': '2026-12-12T06:59:59Z', '2026-12-14': '2026-12-15T06:59:59Z',
              '2026-12-15': '2026-12-16T06:59:59Z', '2026-12-17': '2026-12-18T06:59:59Z', '2027-06-15': '2027-06-16T05:59:59Z' };
const Q530 = '2026-12-09T00:30:59Z';                          // 17:30 Mountain on 8 Dec 2026, seconds pinned to :59

// ============================ the seven kinds, on the ENTRY course ======================================
const SPECS = [
  { key: 'preflight', kind: 'preflight', title: `${TAG} preflight`, points: '2', allDate: '2026-12-10',
    want: { delivery: 'typed_response', grading: 'human_graded', modality: 'written', points: '2.00', late: true, bonus: false, prog: false,
            due: END['2026-12-10'], byDay: { W: END['2026-12-10'], F: END['2026-12-10'] }, rows: { 'ENT-B': END['2026-12-10'] },
            dl: { 'ENT-A': [END['2026-12-10'], 'offering'], 'ENT-B': [END['2026-12-10'], 'section'] } } },
  { key: 'homework', kind: 'homework', title: `${TAG} homework`, late: false, sections: { 'ENT-A': '2026-12-11', 'ENT-B': '2026-12-14' },
    want: { delivery: 'online_questions', grading: 'auto_checked', modality: 'questions', points: '0.00', late: false, bonus: false, prog: false,
            due: null, byDay: {}, rows: { 'ENT-A': END['2026-12-11'], 'ENT-B': END['2026-12-14'] },
            dl: { 'ENT-A': [END['2026-12-11'], 'section'], 'ENT-B': [END['2026-12-14'], 'section'] } } },
  { key: 'case_study', kind: 'case_study', title: `${TAG} case study`, points: '8',
    want: { delivery: 'typed_response', grading: 'human_graded', modality: 'written', points: '8.00', late: true, bonus: false, prog: false,
            due: null, byDay: {}, rows: {}, dl: { 'ENT-A': [null, 'none'], 'ENT-B': [null, 'none'] } } },
  { key: 'group_project', kind: 'group_project', title: `${TAG} group project`, points: '20', allDate: '2026-12-10', sections: { 'ENT-A': '2026-12-15' },
    want: { delivery: 'elsewhere', grading: 'imported', modality: 'external', points: '20.00', late: true, bonus: false, prog: false,
            due: END['2026-12-10'], byDay: { W: END['2026-12-10'], F: END['2026-12-10'] },
            rows: { 'ENT-A': END['2026-12-15'], 'ENT-B': END['2026-12-10'] },
            dl: { 'ENT-A': [END['2026-12-15'], 'section'], 'ENT-B': [END['2026-12-10'], 'section'] } } },
  { key: 'quiz', kind: 'quiz', title: `${TAG} quiz`, points: '15', prog: true, allDate: '2026-12-08', time: '17:30',
    want: { delivery: 'elsewhere', grading: 'imported', modality: 'external', points: '15.00', late: true, bonus: false, prog: true,
            due: Q530, byDay: { W: Q530, F: Q530 }, rows: { 'ENT-B': Q530 }, dl: { 'ENT-A': [Q530, 'offering'], 'ENT-B': [Q530, 'section'] } } },
  { key: 'exam', kind: 'exam', title: `${TAG} exam`, points: '100', allDate: '2027-06-15',
    want: { delivery: 'in_person', grading: 'hand_entered', modality: 'external', points: '100.00', late: true, bonus: false, prog: false,
            due: END['2027-06-15'], byDay: { W: END['2027-06-15'], F: END['2027-06-15'] }, rows: { 'ENT-B': END['2027-06-15'] },
            dl: { 'ENT-A': [END['2027-06-15'], 'offering'], 'ENT-B': [END['2027-06-15'], 'section'] } } },
  { key: 'lab', kind: 'lab', title: `${TAG} lab`, points: '0', bonus: true, delivery: 'online_questions', grading: 'human_graded',
    want: { delivery: 'online_questions', grading: 'human_graded', modality: 'questions', points: '0.00', late: true, bonus: true, prog: false,
            due: null, byDay: {}, rows: {}, dl: { 'ENT-A': [null, 'none'], 'ENT-B': [null, 'none'] } } },
  { key: 'tutor', kind: 'preflight', title: `${TAG} tutor`, points: '2', delivery: 'interactive_tutor', grading: 'effort',
    slug: `harness-tutor-${Date.now().toString(36)}`, allDate: '2026-12-10',
    want: { delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', points: '2.00', late: true, bonus: false, prog: false,
            due: END['2026-12-10'], byDay: { W: END['2026-12-10'], F: END['2026-12-10'] }, rows: { 'ENT-B': END['2026-12-10'] },
            dl: { 'ENT-A': [END['2026-12-10'], 'offering'], 'ENT-B': [END['2026-12-10'], 'section'] } } },
];

function verify(spec, row) {
  const w = spec.want;
  const n = spec.key;
  if (!row) { check(`${n}: the row was written`, false); return; }
  check(`${n}: marked as entered on the newer page, not published, no lesson number`,
    row.new_page === true && row.published === false && row.position === null, JSON.stringify([row.new_page, row.published, row.position]));
  check(`${n}: kind ${spec.kind}, points ${w.points}`, row.kind === spec.kind && row.points === w.points, JSON.stringify([row.kind, row.points]));
  check(`${n}: late ${w.late}, bonus ${w.bonus}, Prog ${w.prog}`, row.late === w.late && row.bonus === w.bonus && row.prog === w.prog,
    JSON.stringify([row.late, row.bonus, row.prog]));
  const p = row.paths[0] || [];
  check(`${n}: one path, ${w.modality} / ${w.delivery} / ${w.grading}`,
    row.paths.length === 1 && p[0] === w.modality && p[1] === w.delivery && p[2] === w.grading && p[3] === 'graded' && p[4] === false,
    JSON.stringify(row.paths));
  check(`${n}: due_at ${w.due}`, row.due_at === w.due, String(row.due_at));
  const norm = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v).replace('.000Z', 'Z')]).sort());
  check(`${n}: due_by_day ${JSON.stringify(w.byDay)}`, same(norm(row.due_by_day), norm(w.byDay)), JSON.stringify(row.due_by_day));
  check(`${n}: per-section rows ${JSON.stringify(w.rows)}`, same(row.section_rows, w.rows), JSON.stringify(row.section_rows));
  const dl = {};
  for (const [code, vals] of Object.entries(row.deadline_rows || {})) dl[code] = vals.length === 1 ? vals[0] : vals;
  // deadline_rows is per cadet, so it has rows only where a section has an enrollment (the entry course does;
  // the no-days course has none). scheduled_deadline() is the same rule asked per section.
  const hasRows = Object.keys(dl).length > 0;
  if (hasRows) check(`${n}: deadline_rows gives each section's cadets its date and source`, same(dl, w.dl), JSON.stringify(dl));
  check(`${n}: scheduled_deadline gives each section its date and source`, same(row.scheduled || {}, w.dl), JSON.stringify(row.scheduled));
}

console.log('\n== 1. the seven kinds on the ENTRY course (director)');
const dir = await signIn(`gatedirector@${DOMAIN}`, 'gatedirector1234');
const d = dir.page;
check('director signed in', !/login\.html/.test(d.url()), d.url());
await useCourse(d, ENTRY, 'Gate entry');
let text = await open(d, '/site/faculty/items.html');
check('the page says students cannot see an assignment until it is published', /cannot see an assignment until it is published/.test(text));
check('the page says the course offering is the entry course and lists the seeded items', /Gate homework 1/.test(text) && /Gate exam 1/.test(text), text.slice(0, 200));
check('there is no publish button anywhere on the page', !(await d.$('[data-pub]')) && !/\bPublish\b/.test(await d.evaluate(() => [...document.querySelectorAll('button, a.btn')].map(b => b.innerText).join(' | '))));
const seededRowIsNew = await d.$$eval('#items-table tbody tr', rs => rs.filter(r => /Gate homework 1/.test(r.innerText)).map(r => r.dataset.new));
check('a seeded item entered on the newer page is editable here', same(seededRowIsNew, ['1']), JSON.stringify(seededRowIsNew));

// the kind boxes: prefill from data, and only pairs the database accepts are offered
await d.click('#new-btn'); await d.waitForSelector('#item-modal.open');
const kinds = await optionValues(d, '#i-kind');
check('the Kind list holds all seven kinds', same(kinds.sort(), ['case_study', 'exam', 'group_project', 'homework', 'lab', 'preflight', 'quiz']), JSON.stringify(kinds));
await d.select('#i-delivery', 'typed_response'); await wait(150);
check('typed response offers only graded-by-a-person', same(await optionValues(d, '#i-grading'), ['human_graded']));
await d.select('#i-delivery', 'online_questions'); await wait(150);
check('online questions offers automatic or by a person', same(await optionValues(d, '#i-grading'), ['auto_checked', 'human_graded']));
await d.select('#i-delivery', 'in_person'); await wait(150);
check('in person offers typed in or imported', same(await optionValues(d, '#i-grading'), ['hand_entered', 'imported']));
check('the section table lists both entry sections', (await d.$$eval('#i-sections tbody tr', rs => rs.map(r => r.cells[0].textContent.trim()))).join() === 'ENT-A,ENT-B');
await d.click('#item-modal [data-close]'); await wait(300);

const ids = {};
for (const spec of SPECS) {
  const { prefill, err, pointsDisabled } = await enter(d, spec);
  check(`${spec.key}: the form saved without an error`, err === '', err);
  if (spec.key === 'homework') check('homework: the points box is closed, because the questions set the points of an auto-checked item', pointsDisabled === true);
  if (spec.key !== 'tutor' && spec.key !== 'lab') {
    check(`${spec.key}: the kind prefilled ${spec.want.delivery} / ${spec.want.grading}`, prefill.delivery === spec.want.delivery && prefill.grading === spec.want.grading, JSON.stringify(prefill));
  }
}
let rb = readItems(ENTRY, TAG);
check('entry course: the offering is still inactive', rb.offering_active === false);
check('entry course: eight items were written', Object.keys(rb.items).length === 8, String(Object.keys(rb.items).length));
const byTitle = (rows, title) => Object.entries(rows.items).find(([, r]) => r.title === title);
for (const spec of SPECS) {
  const hit = byTitle(rb, spec.title);
  if (hit) ids[spec.key] = hit[0];
  verify(spec, hit && hit[1]);
}
text = await open(d, '/site/faculty/items.html');
check('the list shows every new item, as Unpublished', SPECS.every(s => text.includes(s.title)) && (text.match(/Unpublished/g) || []).length >= 8);
check('the list shows the stored dates in words', /10 Dec 2026/.test(text) && /8 Dec 2026 17:30/.test(text) && /15 Jun 2027/.test(text));

console.log('\n== 2. a course with no meeting days at all, and three sections');
await useCourse(d, NODAYS, 'Items entry');
text = await open(d, '/site/faculty/items.html');
check('the empty course says there are no items yet', /No items yet/.test(text));
const secs = await (async () => { await d.click('#new-btn'); await d.waitForSelector('#item-modal.open'); const s = await d.$$eval('#i-sections tbody tr', rs => rs.map(r => r.cells[0].textContent.trim() + ':' + r.cells[1].textContent.trim())); await d.click('#item-modal [data-close]'); await wait(300); return s; })();
check('three sections, each meeting on no set day', same(secs, ['N1:no set days', 'N2:no set days', 'N3:no set days']), JSON.stringify(secs));
const NSPECS = [
  { key: 'nodays-per-section', kind: 'homework', title: `${TAG} nodays homework`, sections: { N1: '2026-12-11', N2: '2026-12-14', N3: '2026-12-17' },
    want: { delivery: 'online_questions', grading: 'auto_checked', modality: 'questions', points: '0.00', late: true, bonus: false, prog: false,
            due: null, byDay: {}, rows: { N1: END['2026-12-11'], N2: END['2026-12-14'], N3: END['2026-12-17'] },
            dl: { N1: [END['2026-12-11'], 'section'], N2: [END['2026-12-14'], 'section'], N3: [END['2026-12-17'], 'section'] } } },
  { key: 'nodays-all', kind: 'quiz', title: `${TAG} nodays quiz`, points: '12', allDate: '2026-12-10',
    want: { delivery: 'elsewhere', grading: 'imported', modality: 'external', points: '12.00', late: true, bonus: false, prog: false,
            due: END['2026-12-10'], byDay: {}, rows: {},
            dl: { N1: [END['2026-12-10'], 'offering'], N2: [END['2026-12-10'], 'offering'], N3: [END['2026-12-10'], 'offering'] } } },
];
for (const spec of NSPECS) {
  const { err } = await enter(d, spec);
  check(`${spec.key}: saved without an error`, err === '', err);
}
rb = readItems(NODAYS, TAG);
check('no-days course: two items, offering still inactive', Object.keys(rb.items).length === 2 && rb.offering_active === false && rb.sections === 3);
for (const spec of NSPECS) { const hit = byTitle(rb, spec.title); verify(spec, hit && hit[1]); }

console.log('\n== 3. edit through the older page\'s link, remove, and refuse a removal that would lose grades');
await useCourse(d, ENTRY, 'Gate entry');
await open(d, `/site/faculty/items.html?a=${encodeURIComponent(ids.quiz)}`, 2500);
check('?a= opens that item for editing', await d.$eval('#item-modal', e => e.classList.contains('open')) && (await d.$eval('#i-title', e => e.value)) === `${TAG} quiz`);
check('the form shows its stored date, time and points', (await d.$eval('#i-alldate', e => e.value)) === '2026-12-08' && (await d.$eval('#i-time', e => e.value)) === '17:30' && Number(await d.$eval('#i-points', e => e.value)) === 15);
check('Prog is shown ticked', await d.$eval('#i-prog', e => e.checked));
await setValue(d, '#i-points', '25');
await setValue(d, '#i-alldate', '2026-12-10');
await setValue(d, '#i-time', '23:59');
await d.click('#im-save'); await wait(3500);
rb = readItems(ENTRY, TAG);
const q = rb.items[ids.quiz];
check('the edit saved: 25 points, new date, still unpublished and still the newer page\'s',
  q.points === '25.00' && q.due_at === END['2026-12-10'] && q.published === false && q.new_page === true && q.prog === true, JSON.stringify(q));
check('the edit rewrote the per-section row too', same(q.section_rows, { 'ENT-B': END['2026-12-10'] }) && q.deadline_rows['ENT-B'][0][1] === 'section', JSON.stringify([q.section_rows, q.deadline_rows]));

// B2 S3: a tutor with no link and no student work can be given a new id; once it has a link the id is fixed
const tutorOpen = async () => { await open(d, `/site/faculty/items.html?a=${encodeURIComponent(ids.tutor)}`, 2500); };
await tutorOpen();
check('a tutor with no link has an editable id', (await d.$eval('#i-islug', e => e.disabled)) === false);
const newSlug = `harness-tutor-renamed-${Date.now().toString(36)}`;
await setValue(d, '#i-islug', newSlug);
await d.click('#im-save'); await wait(3500);
const tutErr = await d.$eval('#im-error', e => e.style.display === 'block' ? e.textContent : '').catch(() => '');
await tutorOpen();
check('the new tutor id was saved', (await d.$eval('#i-islug', e => e.value)) === newSlug, tutErr);
await setValue(d, '#i-iurl', 'https://claude.ai/public/artifacts/harness-example');
await d.click('#im-save'); await wait(3500);
await tutorOpen();
check('once the tutor has a link, the id box is closed', (await d.$eval('#i-islug', e => e.disabled)) === true);
check('...and the link was saved', (await d.$eval('#i-iurl', e => e.value)).includes('harness-example'));

// remove the case study (no work) through the page
text = await open(d, '/site/faculty/items.html');
await d.click(`[data-remove="${ids.case_study}"]`); await wait(3000);
rb = readItems(ENTRY, TAG);
check('Remove deleted an item with no work (after a confirm)', !rb.items[ids.case_study] && Object.keys(rb.items).length === 7);
// a refusal: the seeded quiz holds grades
const gradedBefore = readItems(ENTRY, 'Gate quiz 1');
const gq = Object.keys(gradedBefore.items)[0];
dir.alerts.length = 0;
await d.click(`[data-remove="${gq}"]`); await wait(3000);
check('removing an item that has grades is refused with a plain reason', dir.alerts.some(a => /grade/.test(a) && /cannot be removed/.test(a)), JSON.stringify(dir.alerts));
check('... and the item is still there', Object.keys(readItems(ENTRY, 'Gate quiz 1').items).length === 1);
check('... and the page still lists it', /Gate quiz 1/.test(await d.evaluate(() => document.body.innerText)));

console.log('\n== 3b. the warnings before a removal or a delivery switch, and the cancel paths (review B1)');
{
  await useCourse(d, ENTRY, 'Gate entry');
  await open(d, '/site/faculty/items.html', 1500);
  const idOf = (rbx, title) => (Object.entries(rbx.items).find(([, r]) => r.title === title) || [])[0];
  const mine = { err: (await enter(d, { kind: 'homework', title: `${WARN} removable` })).err };
  check('a throwaway auto-checked item was made for the removal test', mine.err === '', mine.err);
  const rid = idOf(readItems(ENTRY, WARN), `${WARN} removable`);
  py('seed-questions', rid);
  check('it now holds 2 questions and 2 key versions', same(py('count-questions', rid), { questions: 2, keys: 2 }));
  await open(d, '/site/faculty/items.html', 2200);

  dir.confirms.length = 0; dir.script.push(false);
  await d.click(`[data-remove="${rid}"]`); await wait(2500);
  check('removal asks first, and states the question and key counts',
    dir.confirms.length === 1 && /2 questions/.test(dir.confirms[0]) && /2 answer key versions/.test(dir.confirms[0]), JSON.stringify(dir.confirms));
  check('cancelling the first confirm removes nothing', same(py('count-questions', rid), { questions: 2, keys: 2 }) && !!idOf(readItems(ENTRY, WARN), `${WARN} removable`));

  dir.confirms.length = 0; dir.script.push(true, false);
  await d.click(`[data-remove="${rid}"]`); await wait(2500);
  check('keys need a second, explicit confirm', dir.confirms.length === 2 && /cannot be recovered/.test(dir.confirms[1]), JSON.stringify(dir.confirms));
  check('declining the second confirm removes nothing', same(py('count-questions', rid), { questions: 2, keys: 2 }) && !!idOf(readItems(ENTRY, WARN), `${WARN} removable`));

  dir.confirms.length = 0; dir.script.push(true, true);
  await d.click(`[data-remove="${rid}"]`); await wait(3000);
  check('both confirms remove the item and everything under it', !idOf(readItems(ENTRY, WARN), `${WARN} removable`) && same(py('count-questions', rid), { questions: 0, keys: 0 }));

  // a delivery switch that would delete the questions
  await enter(d, { kind: 'lab', title: `${WARN} switchme`, points: '3', delivery: 'online_questions', grading: 'human_graded' });
  const sid = idOf(readItems(ENTRY, WARN), `${WARN} switchme`);
  py('seed-questions', sid);
  await open(d, `/site/faculty/items.html?a=${encodeURIComponent(sid)}`, 2500);
  await d.select('#i-delivery', 'typed_response'); await wait(200);
  await d.select('#i-grading', 'human_graded'); await wait(200);
  dir.confirms.length = 0; dir.script.push(false);
  await d.click('#im-save'); await wait(3000);
  check('a switch that would delete questions asks, with the counts',
    dir.confirms.length >= 1 && /2 questions/.test(dir.confirms[0]) && /2 answer key versions/.test(dir.confirms[0]), JSON.stringify(dir.confirms));
  const afterCancel = readItems(ENTRY, WARN).items[sid];
  check('cancelling leaves the path and the questions exactly as they were',
    afterCancel.paths.length === 1 && afterCancel.paths[0][0] === 'questions' && same(py('count-questions', sid), { questions: 2, keys: 2 }), JSON.stringify(afterCancel.paths));
  dir.confirms.length = 0; dir.script.push(true, true);
  await d.click('#im-save'); await wait(3500);
  const afterOk = readItems(ENTRY, WARN).items[sid];
  check('accepting both confirms switches the path', afterOk.paths.length === 1 && afterOk.paths[0][0] === 'written', JSON.stringify(afterOk.paths));
  check('... and the questions that sat under the old path are gone', same(py('count-questions', sid), { questions: 0, keys: 0 }));
}

py('clean', WARN);
console.log('\n== 3c. a two-track course asks for an M date and a T date (review B S9)');
{
  await useCourse(d, VECTOR, 'Gate vector');
  await open(d, '/site/faculty/items.html', 2000);
  await d.click('#new-btn'); await d.waitForSelector('#item-modal.open', { timeout: 8000 });
  await d.select('#i-kind', 'case_study'); await wait(250);
  await setValue(d, '#i-title', `${WARN} twotrack`);
  await setValue(d, '#i-points', '4');
  const boxes = await d.evaluate(() => ({ day: document.querySelector('#i-daybox')?.offsetParent !== null, all: document.querySelector('#i-allbox')?.offsetParent !== null,
    days: [...document.querySelectorAll('#i-daybox input[data-day]')].map(i => i.dataset.day).sort() }));
  check('the form shows one date box per track, not the single box', boxes.day && !boxes.all && boxes.days.join() === 'M,T', JSON.stringify(boxes));
  const setDay = (day, v) => d.$eval(`#i-daybox input[data-day="${day}"]`, (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await setDay('M', '2026-12-10');
  await d.click('#im-save'); await wait(1200);
  const err1 = await d.$eval('#im-error', e => e.style.display === 'block' ? e.textContent : '');
  check('an M date alone is refused, in a sentence that offers the tick', /T/.test(err1) && /same date/.test(err1), err1);
  check('... and nothing was written', Object.values(readItems(VECTOR, WARN).items).filter(r => r.title === `${WARN} twotrack`).length === 0);
  await setDay('T', '2026-12-11');
  await d.click('#im-save'); await wait(3500);
  const tt = Object.values(readItems(VECTOR, WARN).items).find(r => r.title === `${WARN} twotrack`);
  check('both dates saved: the M and T entries differ by a day', !!tt && tt.due_by_day.M && tt.due_by_day.T && tt.due_by_day.M !== tt.due_by_day.T, JSON.stringify(tt && tt.due_by_day));
  check('... and each track\'s section got its own row', !!tt && Object.keys(tt.section_rows).length >= 2, JSON.stringify(tt && tt.section_rows));
  check('... through the database function the deadline rule reads: M and T sections get different dates',
    !!tt && new Set(Object.values(tt.scheduled || {}).map(v => v[0])).size === 2, JSON.stringify(tt && tt.scheduled));

  // the tick
  await d.click('#new-btn'); await d.waitForSelector('#item-modal.open', { timeout: 8000 });
  await d.select('#i-kind', 'case_study'); await wait(250);
  await setValue(d, '#i-title', `${WARN} twotrack same`); await setValue(d, '#i-points', '4');
  await setDay('M', '2026-12-10');
  await d.$eval('#i-same', e => { if (!e.checked) e.click(); });
  await d.click('#im-save'); await wait(3500);
  const same2 = Object.values(readItems(VECTOR, WARN).items).find(r => r.title === `${WARN} twotrack same`);
  check('with the tick, one date is written for both tracks', !!same2 && same2.due_by_day.M === same2.due_by_day.T && !!same2.due_by_day.M, JSON.stringify(same2 && same2.due_by_day));
  py('clean', WARN);
  check('both throwaway items were removed from the vector course', Object.keys(readItems(VECTOR, WARN).items).length === 0);
  py('clean', WARN);
  await useCourse(d, ENTRY, 'Gate entry');          // the sections below read the entry course
}

console.log('\n== 4. the older pages');
await open(d, '/site/faculty/lessons.html', 2500);
const cards = await d.evaluate((tag) => {
  const cs = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.card-title') && c.innerText.includes(tag) && !c.querySelector('.card'));
  return { n: cs.length,
    link: cs.filter(c => [...c.querySelectorAll('a')].some(a => /Open on the newer page/.test(a.innerText) && /items\.html\?a=/.test(a.getAttribute('href') || ''))).length,
    edit: cs.filter(c => c.querySelector('[data-edit],[data-pub],[data-del]')).length };
}, TAG);
check('every new item shows "Open on the newer page" on the older Assignments page, with no Edit, Publish or Remove',
  cards.n === 7 && cards.link === 7 && cards.edit === 0, JSON.stringify(cards));
const href = await d.$eval('a[href*="items.html?a="]', a => a.getAttribute('href'));
await d.goto(BASE + '/site/faculty/' + href, { waitUntil: 'networkidle2' }); await wait(2500);
check('that link lands on the new page with the item open', /items\.html/.test(d.url()) && await d.$eval('#item-modal', e => e.classList.contains('open')));

await useCourse(d, VECTOR, 'Gate vector');
text = await open(d, '/site/faculty/items.html');
const oldRows = await d.$$eval('#items-table tbody tr', rs => rs.map(r => ({ isNew: r.dataset.new, edit: !!r.querySelector('[data-edit]'), remove: !!r.querySelector('[data-remove]'),
  link: [...r.querySelectorAll('a')].some(a => /older editor/.test(a.innerText) && /lessons\.html/.test(a.getAttribute('href') || '')) })));
check('the vector course lists its items entered on the older page', oldRows.length >= 3, String(oldRows.length));
check('each is read-only here, with a link to the older editor', oldRows.every(r => r.isNew === '0' && !r.edit && !r.remove && r.link), JSON.stringify(oldRows.slice(0, 3)));
check('the older rows show Published or Draft and say which page owns them', /Entered on the older page/.test(text) && /(Published|Draft)/.test(text));

console.log('\n== 5. a cadet, and an instructor');
const cad = await signIn(`cadet0401@${DOMAIN}`, '000401');
check('entry cadet signed in', !/login\.html/.test(cad.page.url()), cad.page.url());
let ctext = await open(cad.page, '/site/student/lessons.html', 2500);
ctext += await open(cad.page, '/site/student/dashboard.html', 2500);
check('the cadet sees none of the new items', !ctext.includes(TAG), ctext.slice(0, 120));
const seen = await cad.page.evaluate(async (co) => {
  const r = await window.db.from('assignment_offerings').select('id').eq('course_offering_id', co);
  return { rows: (r.data || []).length, error: r.error ? r.error.message : null };
}, ENTRY);
check('and the database returns the cadet none of that course\'s items', seen.rows === 0 && !seen.error, JSON.stringify(seen));
await open(cad.page, '/site/faculty/items.html', 2500);
check('a cadet who opens the page is turned away', !/faculty\/items\.html/.test(cad.page.url()) || !(await cad.page.$('#new-btn')), cad.page.url());
await cad.ctx.close();

const ins = await signIn(`gateinstructor@${DOMAIN}`, 'gateinstructor1234');
check('instructor signed in', !/login\.html/.test(ins.page.url()), ins.page.url());
text = await open(ins.page, '/site/faculty/items.html', 2500);
check('the instructor gets the directors-only state', /Directors only/.test(text), text.slice(0, 160));
check('... with no New item button and no table', !(await ins.page.$('#new-btn')) && !(await ins.page.$('#items-table')));
const navHas = await ins.page.evaluate(() => [...document.querySelectorAll('#topnav a')].some(a => /items\.html/.test(a.getAttribute('href') || '')));
check('... and the bar has no Items entry for them', !navHas);
const write = await ins.page.evaluate(async (co) => {
  const a = await window.db.from('assignments').insert({ course_id: '00000000-0000-0000-0000-000000000000', kind_id: 'homework', slug: 'x', title: 'x' });
  return { error: a.error ? a.error.message : null };
}, ENTRY);
check('the database refuses an instructor\'s write', !!write.error, JSON.stringify(write));
check('no uncaught page error for the instructor', ins.problems.length === 0, ins.problems.join(' | '));
await ins.ctx.close();

console.log('\n== 6. the director\'s bar, and the examples');
await useCourse(d, ENTRY, 'Gate entry');
await open(d, '/site/faculty/items.html', 1500);
check('the director\'s bar has an Items entry', await d.evaluate(() => [...document.querySelectorAll('#topnav a')].some(a => /items\.html/.test(a.getAttribute('href') || ''))));
check('no uncaught page error for the director', dir.problems.length === 0, dir.problems.join(' | '));

py('clean', TAG);
rb = readItems(ENTRY, TAG); const rb2 = readItems(NODAYS, TAG);
check('clean-up removed every walkthrough item from both courses', Object.keys(rb.items).length === 0 && Object.keys(rb2.items).length === 0);
text = await open(d, '/site/faculty/items.html', 1800);
check('the seeded items are untouched after clean-up', /Gate homework 1/.test(text) && /Gate exam 1/.test(text) && /Gate quiz 1/.test(text));

if (!NO_EXAMPLES) {
  const EX = [
    { key: 'ex-hw', kind: 'homework', title: `${EXAMPLE}: weekly homework`, points: '10', allDate: '2026-12-10', sections: { 'ENT-A': '2026-12-11' } },
    { key: 'ex-exam', kind: 'exam', title: `${EXAMPLE}: midterm exam`, points: '100', allDate: '2026-12-15' },
    { key: 'ex-lab', kind: 'lab', title: `${EXAMPLE}: lab report (counts at Prog)`, points: '20', prog: true },
  ];
  await open(d, '/site/faculty/items.html', 1500);
  for (const spec of EX) { const { err } = await enter(d, spec); check(`${spec.key}: example saved`, err === '', err); }
  const ex = readItems(ENTRY, EXAMPLE);
  check('three example items are left on the entry course, unpublished', Object.keys(ex.items).length === 3 && Object.values(ex.items).every(r => r.new_page && !r.published));
}

await dir.ctx.close();
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
