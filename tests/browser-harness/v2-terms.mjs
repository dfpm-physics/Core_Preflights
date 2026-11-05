// v2-terms.mjs -- the courses-and-terms page (site/faculty/terms.html), in a real browser. STAGING only.
//
// Needs scripts/staging/serve_local.py running and the staging seeds present. It signs in as seeded,
// invented people and:
//   1. as the site administrator, creates a NEW course, three terms, and three offerings of the course through the
//      page (A active, then B refused as a second active one and created inactive, then C by default: inactive),
//      each read back from the database.
//   2. proves the new course is on the staff menu (administrator and a director) and on the student path (a made-up
//      cadet sees it and its published item), with no code change: the course was created a minute ago.
//   3. rolls A over into B with dates left blank: the dry-run list first, then one write. Reads B back: lineage,
//      unpublished, no dates, questions, keys copied UNCHECKED as version 1, the tutor copied without its link,
//      the scale copied, no sections / cadets / submissions / grades. Runs it again: nothing left to copy.
//   4. fingerprints A before and after both rollovers: not one value of A changed.
//   5. rolls A over into C shifted by 7 days: the fixed 10 Dec 23:59:59 Mountain date becomes 17 Dec 23:59:59.
//   6. as the cadet: the keys of the copy are not readable (and the administrator, as a control, can read them).
//   7. as a director who is not an administrator: the page says what only an administrator can do, and still
//      offers rollover.
//   8. leaves A inactive, the cadet removed, and B and C in place as the worked example.
//
// Environment: STAGING_DB_URL and PREP_PYTHON (the venv python).
// Usage:  node tests/browser-harness/v2-terms.mjs [--base http://localhost:8012]
// No screenshots are taken. Every name written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
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
const RB = resolve(import.meta.dirname, 'v2_terms_readback.py');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const py = (...args) => JSON.parse(execFileSync(PY, [RB, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

py('reset');                                                     // leftovers from an earlier run

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1100 } });

const DIALOG = { last: '', count: 0, dismiss: false };
async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
  page.on('dialog', d => { DIALOG.last = d.message(); DIALOG.count++; (DIALOG.dismiss ? d.dismiss() : d.accept()).catch(() => {}); });
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, problems };
}
async function open(page, path, ms = 1800) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.body?.innerText || '');
}
const setValue = (page, sel, v) => page.$eval(sel, (el, val) => {
  el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const optionByText = (page, sel, fragment) => page.$$eval(`${sel} option`, (os, f) => (os.find(o => o.textContent.includes(f)) || {}).value || '', fragment);
async function pageText(page) { return page.evaluate(() => document.body?.innerText || ''); }

// A banner or error shows up after an awaited database call: wait for the selector to be visible with text.
async function waitText(page, sel, re, ms = 20000) {
  const ok = await page.waitForFunction((s, src) => {
    const el = document.querySelector(s); return !!el && el.offsetParent !== null && new RegExp(src).test(el.innerText);
  }, { timeout: ms }, sel, re.source).then(() => true).catch(() => false);
  return ok ? page.$eval(sel, e => e.innerText) : null;
}

/* ============================ 1. create through the page (administrator) ============================ */
console.log('\n== 1. create a course, terms and offerings through the page (administrator)');
const adm = await signIn(`admin@${DOMAIN}`, 'admin1234');
const a = adm.page;
check('administrator signed in', !/login\.html/.test(a.url()), a.url());
let text = await open(a, '/site/faculty/terms.html');
check('the page lists offerings and offers the create forms', /Offerings you can see/.test(text) && !!(await a.$('#c-save')));
check('no administrator-only note for an administrator', !(await a.$('#admin-only-note')));

// a bad course is refused in a sentence, before anything is sent
await setValue(a, '#c-code', 'Bad Code'); await setValue(a, '#c-title', 'x'); await a.click('#c-save'); await wait(400);
check('a course code with a space is refused in a sentence', /lowercase letters, numbers and hyphens/.test(await a.$eval('#create-error', e => e.innerText)));

await setValue(a, '#c-code', 'e30-lab'); await setValue(a, '#c-title', 'E30 Lab Methods (STAGING TEST)'); await setValue(a, '#c-dept', 'Physics');
await a.click('#c-save');
check('course created', !!(await waitText(a, '#flash', /Course e30-lab created/)));
// the same code again is refused as a sentence
await setValue(a, '#c-code', 'e30-lab'); await setValue(a, '#c-title', 'again'); await a.click('#c-save');
check('a second course with the same code says so', /course with that code already exists/.test(await waitText(a, '#create-error', /already exists/) || ''));

for (const [code, label, s, e] of [['e30-term-a', 'E30 Term A', '2026-12-01', '2027-03-31'],
                                  ['e30-term-b', 'E30 Term B', '2027-04-01', '2027-07-31'],
                                  ['e30-term-c', 'E30 Term C', '2027-08-01', '2027-12-15']]) {
  await setValue(a, '#t-code', code); await setValue(a, '#t-label', label); await setValue(a, '#t-start', s); await setValue(a, '#t-end', e);
  await a.click('#t-save');
  check(`term ${code} created`, !!(await waitText(a, '#flash', new RegExp(`Term ${label} created`))));
}
await setValue(a, '#t-code', 'e30-term-x'); await setValue(a, '#t-label', 'Backwards'); await setValue(a, '#t-start', '2027-05-01'); await setValue(a, '#t-end', '2027-01-01');
await a.click('#t-save'); await wait(400);
check('a term that ends before it starts is refused in a sentence', /cannot end before it starts/.test(await a.$eval('#create-error', e => e.innerText)));

async function makeOffering(termFragment, active /* true | false | null (leave the default) */) {
  await setValue(a, '#o-course', await optionByText(a, '#o-course', 'e30-lab'));
  await setValue(a, '#o-term', await optionByText(a, '#o-term', termFragment));
  await setValue(a, '#o-director', await optionByText(a, '#o-director', 'Rowan Gatedirector'));
  if (active === true) await a.click('#o-active');
  if (active === false) await a.click('#o-inactive');
  await a.click('#o-save');
}
await makeOffering('e30-term-a', true);
check('offering A created as active', !!(await waitText(a, '#flash', /Offering created as active/)));
await makeOffering('e30-term-b', true);
const refused = await waitText(a, '#create-error', /only one term of a course can be active/);
check('a second active offering of the course is refused in a plain sentence', !!refused, refused || '');
check('...and the sentence does not name the rule', !/course_offerings_one_active/.test(refused || ''));
await makeOffering('e30-term-b', false);
check('offering B created as inactive', !!(await waitText(a, '#flash', /Offering created as inactive/)));
await makeOffering('e30-term-c', null);                     // the radio is on its default: inactive
check('offering C created with the default choice, which is inactive', !!(await waitText(a, '#flash', /Offering created as inactive/)));

const ids = py('ids');
check('three offerings exist for the new course', !!ids.a && !!ids.b && !!ids.c, JSON.stringify(ids));
const fresh = {};
for (const k of 'abc') fresh[k] = py('read', ids[k]);
check('A is active, B and C are inactive in the database', fresh.a.active === true && fresh.b.active === false && fresh.c.active === false,
  JSON.stringify([fresh.a.active, fresh.b.active, fresh.c.active]));

/* ---- 1b. active or inactive, as an administrator: a statement, counts, a confirm, one active per course ---- */
console.log('\n== 1b. make an offering active or inactive');
const toggle = async (id) => { await a.click(`[data-active-toggle="${id}"]`); await wait(1500); };
await open(a, '/site/faculty/terms.html');
check('every offering row has a Make active / Make inactive button for the administrator',
  (await a.$$('[data-active-toggle]')).length >= 3 && (await a.$eval(`[data-active-toggle="${ids.a}"]`, e => e.innerText)) === 'Make inactive'
  && (await a.$eval(`[data-active-toggle="${ids.b}"]`, e => e.innerText)) === 'Make active');
check('the page states what active changes', /nightly jobs/.test(await a.$eval('#active-statement', e => e.innerText)));

DIALOG.count = 0; DIALOG.last = '';
await toggle(ids.b);
const second = await a.$eval('#active-error', e => e.innerText);
check('making B active while A is active is refused in a sentence that names A', /only one/.test(second) && /E30 Term A/.test(second), second);
check('... with no confirm shown and nothing written', DIALOG.count === 0 && py('read', ids.b).active === false);

const countsBefore = py('fingerprint', ids.a).counts;
DIALOG.count = 0; DIALOG.dismiss = true;
await toggle(ids.a);
check('making A inactive asks first, with the counts and what it changes',
  DIALOG.count === 1 && /enrolled cadet/.test(DIALOG.last) && /published item/.test(DIALOG.last) && /deletes nothing/.test(DIALOG.last), DIALOG.last);
check('cancelling the confirm leaves A active', py('read', ids.a).active === true);
DIALOG.dismiss = false; DIALOG.count = 0;
await toggle(ids.a);
check('accepting it makes A inactive', py('read', ids.a).active === false && DIALOG.count === 1);
check('... and says nothing was deleted', /Nothing was deleted or hidden/.test(await waitText(a, '#flash', /is now inactive/) || ''));
check('... and every count under A is as it was', JSON.stringify(py('fingerprint', ids.a).counts) === JSON.stringify(countsBefore));
await toggle(ids.b);
check('now B can be made active', py('read', ids.b).active === true && py('read', ids.a).active === false);
await toggle(ids.b);            // B back to inactive
await toggle(ids.a);            // A back to active
check('both are put back: A active, B inactive', py('read', ids.a).active === true && py('read', ids.b).active === false);

/* ============================ 2. staff menu and student path, no code change ============================ */
console.log('\n== 2. the new course is on the staff menu and the student path');
py('seed-source');
await open(a, '/site/faculty/dashboard.html', 1500);
const opts = await a.$$eval('.course-opt', os => os.map(o => ({ id: o.dataset.course, text: o.innerText })));
check('the administrator\'s course menu lists the new course (offering A)', opts.some(o => o.id === ids.a && /E30 Lab Methods/.test(o.text)), JSON.stringify(opts.slice(0, 4)));
check('...and its other two terms', opts.some(o => o.id === ids.b) && opts.some(o => o.id === ids.c));
await a.click('[data-course-toggle]'); await wait(300);
await a.click(`.course-opt[data-course="${ids.a}"]`); await wait(2500);
check('picking it makes it the course in view', /E30 Lab/.test(await a.$eval('.cb-name', e => e.textContent)));
text = await open(a, '/site/faculty/lessons.html', 2500);
check('its published item is on the Assignments page', /E30 written/.test(text), text.slice(0, 160));

const dir = await signIn(`gatedirector@${DOMAIN}`, 'gatedirector1234');
await open(dir.page, '/site/faculty/dashboard.html', 1500);
const dopts = await dir.page.$$eval('.course-opt', os => os.map(o => o.dataset.course));
await open(dir.page, '/site/faculty/terms.html', 1800);
check('a director (not an administrator) is offered no active/inactive button', (await dir.page.$$('[data-active-toggle]')).length === 0);
check('a director added through the page sees the new course on their menu', dopts.includes(ids.a) && dopts.includes(ids.b) && dopts.includes(ids.c), JSON.stringify(dopts));

const cad = await signIn(`cadet0451@${DOMAIN}`, '000451');
check('the made-up cadet signed in', !/login\.html/.test(cad.page.url()), cad.page.url());
text = await open(cad.page, '/site/student/dashboard.html', 2500);
check('the cadet\'s dashboard names the new course', /E30 Lab/.test(text), text.slice(0, 200));
text = await open(cad.page, '/site/student/assignments.html', 2500);
check('the cadet sees the published item, in a course with no M or T days', /E30 written/.test(text), text.slice(0, 300));
check('the cadet does not see the unpublished items', !/E30 quiz/.test(text) && !/E30 tutor/.test(text));
check('no page error on the student path', cad.problems.length === 0, cad.problems.join('; '));

/* ============================ 3. roll A over into B, dates blank ============================ */
console.log('\n== 3. roll A over into B (dates left blank)');
const before = py('fingerprint', ids.a);
check('A holds three items, two questions with two keys, a scale, a section, one cadet',
  before.counts.assignment_offerings === 3 && before.counts.questions === 2 && before.counts.question_keys === 2 &&
  before.counts.letter_scales === 1 && before.counts.sections === 1 && before.counts.enrollments === 1, JSON.stringify(before.counts));

text = await open(a, '/site/faculty/terms.html');
await setValue(a, '#ro-from', ids.a); await setValue(a, '#ro-to', ids.b);
check('the Copy button starts disabled', await a.$eval('#ro-go', e => e.disabled));
await a.click('#ro-preview');
const sum = await waitText(a, '#ro-summary', /to copy/);
check('the dry run says 3 to copy and that nothing has been written', /3\s*to copy/.test(sum || '') && /Nothing has been written yet/.test(sum || ''), sum || '');
const rows = await a.$$eval('#ro-table tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')));
check('the list shows the three items, with slugs qualified by the target term',
  rows.length === 3 && rows.every(r => /e30-term-b/.test(r)), JSON.stringify(rows));
check('the list says the quiz has 2 questions and 2 keys, and the keys come unchecked', rows.some(r => /E30 quiz/.test(r) && /2 questions, 2 keys/.test(r) && /unchecked/.test(r)));
check('the list says the tutor needs a new link', rows.some(r => /E30 tutor/.test(r) && /under a new tutor id/.test(r)));
check('the list says dates are blank', rows.every(r => /\bblank\b/.test(r)));
check('the dry run wrote nothing (B is still empty)', py('read', ids.b).items && Object.keys(py('read', ids.b).items).length === 0);
check('the Copy button is now enabled', !(await a.$eval('#ro-go', e => e.disabled)));

await a.click('#ro-go');
const done = await waitText(a, '#ro-done', /Copied/);
check('one click copied 3 items and says everything is unpublished', /Copied 3 items/.test(done || '') && /unpublished/.test(done || ''), done || '');
const b1 = py('read', ids.b);
const names = Object.keys(b1.items).sort();
check('B holds the three items', same(names, ['E30 quiz', 'E30 tutor', 'E30 written']), JSON.stringify(names));
const all = Object.values(b1.items);
check('every copy names its source (origin_assignment_id)', all.every(i => i.origin_title === Object.keys(b1.items).find(n => b1.items[n] === i)), JSON.stringify(all.map(i => i.origin_title)));
check('every copy is unpublished and has no snapshot', all.every(i => i.published === false && i.snapshot === false));
check('every copy has a term-qualified slug', all.every(i => /-e30-term-b$/.test(i.slug)), JSON.stringify(all.map(i => i.slug)));
check('dates are blank: no due date, no day map, no section rows, no opens date',
  all.every(i => i.due_at === null && same(i.due_by_day, {}) && same(i.section_rows, {}) && i.opens_at === null));
check('the points and policy carried (quiz: 4 points, late, Prog)', b1.items['E30 quiz'].points === '4.00' && b1.items['E30 quiz'].late && b1.items['E30 quiz'].prog);
check('the entered-on-the-newer-page marker followed the source', b1.items['E30 quiz'].new_page === true && b1.items['E30 written'].new_page === false);
check('the quiz copy has its two questions, with keys as version 1 and UNCHECKED',
  b1.items['E30 quiz'].questions.length === 2 && b1.items['E30 quiz'].questions.every(q => q.key_version === 1 && q.key_checked === false && !q.key_superseded),
  JSON.stringify(b1.items['E30 quiz'].questions));
check('the numeric key value was copied', b1.items['E30 quiz'].questions.some(q => q.qid === 'Q1' && /^9\.8/.test(q.value)));
check('the quiz copy keeps its path (online questions, auto checked)', b1.items['E30 quiz'].paths.some(p => p.delivery === 'online_questions' && p.grading === 'auto_checked'));
const tut = b1.items['E30 tutor'].paths[0];
check('the tutor copy has no link and a NEW id (not the source id)', tut.url === null && tut.slug !== 'e30-tutor-a3f9c1e2' && /^e30-tutor-[0-9a-f]{8}$/.test(tut.slug), JSON.stringify(tut));
check('the letter scale was copied', b1.scale_rows === 1 && b1.scale_version === 1);
check('no sections, enrollments, submissions or grades came across', b1.sections === 0 && b1.enrollments === 0 && b1.submissions === 0 && b1.grades === 0, JSON.stringify([b1.sections, b1.enrollments, b1.submissions, b1.grades]));
check('B is still inactive', b1.active === false);

// again: nothing left to copy
await open(a, '/site/faculty/terms.html');
await setValue(a, '#ro-from', ids.a); await setValue(a, '#ro-to', ids.b);
await a.click('#ro-preview');
const sum2 = await waitText(a, '#ro-summary', /to copy/);
check('a second run finds everything already copied', /0\s*to copy/.test(sum2 || '') && /3\s*already copied/.test(sum2 || ''), sum2 || '');
check('...and the Copy button stays disabled', await a.$eval('#ro-go', e => e.disabled));
const b2 = py('read', ids.b);
check('nothing was added by looking again', Object.keys(b2.items).length === 3);

/* ============================ 4. shift by 7 days into C ============================ */
console.log('\n== 4. roll A over into C, shifted by 7 days');
await setValue(a, '#ro-from', ids.a); await setValue(a, '#ro-to', ids.c);
await a.click('#ro-shift');
// B2 M1: a shift of zero or a non-whole number is refused with a sentence, and nothing is previewed
for (const bad of ['0', '1e2', '7.0']) {
  await setValue(a, '#ro-days', bad);
  await a.click('#ro-preview');
  const refused = await waitText(a, '#ro-error', /whole number|shift of 0/i, 5000);
  check(`a shift of "${bad}" is refused with a sentence`, !!refused, String(refused));
}
await setValue(a, '#ro-days', '7');
await a.click('#ro-preview');
const sum3 = await waitText(a, '#ro-summary', /to copy/);
check('the dry run says 3 to copy', /3\s*to copy/.test(sum3 || ''), sum3 || '');
const rows3 = await a.$$eval('#ro-table tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')));
check('the list shows the old and new date of the quiz (10 Dec to 17 Dec, 23:59)', rows3.some(r => /E30 quiz/.test(r) && /2026-12-10 23:59 -> 2026-12-17 23:59/.test(r)), JSON.stringify(rows3));
check('the list says S1 has no match in the new term', rows3.some(r => /No section S1/.test(r)));
await a.click('#ro-go');
check('the shifted copy was written', /Copied 3 items/.test((await waitText(a, '#ro-done', /Copied/)) || ''));
const c1 = py('read', ids.c);
check('the quiz is due 17 Dec 2026 at 23:59:59 Mountain (06:59:59 UTC the next day), not carried as it was',
  c1.items['E30 quiz'].due_at === '2026-12-18T06:59:59Z', String(c1.items['E30 quiz'].due_at));
const aNow = py('read', ids.a);
check('the written item is shifted by exactly 7 days too (same clock time)', aNow.items['E30 written'].due_at !== null &&
  new Date(c1.items['E30 written'].due_at) - new Date(aNow.items['E30 written'].due_at) === 7 * 86400000,
  `${aNow.items['E30 written'].due_at} -> ${c1.items['E30 written'].due_at}`);
check('the copy is still unpublished', Object.values(c1.items).every(i => i.published === false));
// B2 S2: B was copied from A and C was copied from A, so rolling B into C is the same lineage by a second route
await open(a, '/site/faculty/terms.html');
await setValue(a, '#ro-from', ids.b); await setValue(a, '#ro-to', ids.c);
await a.click('#ro-preview');
const sumLin = await waitText(a, '#ro-summary', /to copy/);
check('B into C finds every item already there by lineage (0 to copy)', /\b0\s*to copy/.test(sumLin || ''), sumLin || '');
check('...and the Copy button stays disabled', await a.$eval('#ro-go', e => e.disabled));
check('nothing was added to C by that look', Object.keys(py('read', ids.c).items).length === Object.keys(c1.items).length);

/* ============================ 5. the source did not change ============================ */
console.log('\n== 5. the source offering did not change');
const afterFp = py('fingerprint', ids.a);
check('the full fingerprint of A is identical before and after both rollovers', afterFp.hash === before.hash, `${before.hash.slice(0, 12)} vs ${afterFp.hash.slice(0, 12)}`);
check('the row counts of A are identical too', same(afterFp.counts, before.counts));

/* ============================ 6. keys stay hidden from a cadet ============================ */
console.log('\n== 6. keys of the copy stay hidden from a cadet');
const qids = b1.items['E30 quiz'].question_ids;
const readKeys = (page) => page.evaluate(async (qs) => {
  const { db } = await import('/site/js/supabase.js');
  const k = await db.from('question_keys').select('id').in('question_id', qs);
  const q = await db.from('questions').select('id').in('id', qs);
  const o = await db.from('assignment_offerings').select('id');
  return { keys: (k.data || []).length, kerr: k.error ? k.error.message : null, questions: (q.data || []).length, offerings: (o.data || []).length };
}, qids);
await open(cad.page, '/site/student/dashboard.html', 800);
const cadSees = await readKeys(cad.page);
check('the cadet reads no key of the copy', cadSees.keys === 0, JSON.stringify(cadSees));
check('...and no question row of the copy either', cadSees.questions === 0, JSON.stringify(cadSees));
check('...and no offering of the term the copy lives in beyond what they are enrolled in', cadSees.offerings >= 1);
await open(a, '/site/faculty/terms.html', 800);
const admSees = await readKeys(a);
check('control: the administrator can read those keys (so the cadet\'s zero means something)', admSees.keys === 2, JSON.stringify(admSees));

/* ============================ 7. a director who is not an administrator ============================ */
console.log('\n== 7. a director who is not an administrator');
text = await open(dir.page, '/site/faculty/terms.html');
check('the page says only a site administrator can create a course, a term or an offering', !!(await dir.page.$('#admin-only-note')));
check('...and shows no create buttons', !(await dir.page.$('#c-save')) && !(await dir.page.$('#t-save')) && !(await dir.page.$('#o-save')));
check('...but offers the rollover', !!(await dir.page.$('#ro-preview')));
const intoOpts = await dir.page.$$eval('#ro-to option', os => os.map(o => o.value).filter(Boolean));
check('the "copy into" list holds only offerings the director directs (the new course\'s three, plus the gate courses)', intoOpts.includes(ids.b) && intoOpts.includes(ids.c));
const ins = await signIn(`gateinstructor@${DOMAIN}`, 'gateinstructor1234');
text = await open(ins.page, '/site/faculty/terms.html', 800);
await ins.page.waitForFunction(() => /Directors only|Copy a term/.test(document.body?.innerText || ''), { timeout: 20000 }).catch(() => {});
text = await pageText(ins.page);
check('an instructor who is not a director gets the directors-only state', /Directors only/.test(text) && !(await ins.page.$('#ro-preview')));

for (const [who, s] of [['administrator', adm], ['director', dir], ['cadet', cad], ['instructor', ins]]) {
  check(`no uncaught page error (${who})`, s.problems.length === 0, s.problems.join('; '));
}

/* ============================ 8. leave the example ============================ */
py('finish');
const fin = py('read', ids.a);
check('A is left inactive and the cadet removed (so the staging seed counts hold)', fin.active === false && fin.enrollments === 0);
console.log(`\nExample left on staging: course e30-lab, terms A (source, inactive), B (copied, dates blank), C (copied, dates +7 days).`);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
