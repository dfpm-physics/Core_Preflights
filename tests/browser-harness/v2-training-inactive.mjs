// v2-training-inactive.mjs -- the state production lands in after decision 2: a course with an INACTIVE
// training offering (sections, active enrollments, published items, submissions, grades) beside its ACTIVE
// real offering. STAGING only. Needs scripts/staging/serve_local.py and scripts/staging/seed_v2_training.py.
//
// Signed in as the seeded, invented training director and cadets it checks, in a real browser:
//   the offering picker lists both; the stored course preference key; Lessons, Grade, Gradebook, Report, Health,
//   Course Admin and both exports, and Student view, read the training offering
//   a cadet with only the training enrollment signs in and sees the published items (the dashboard and the list)
//   publishing a draft in the training offering is refused and the page says why; editing a published one saves
//   the control: publishing a draft in the real (active) offering works
// It writes: one edit of a description (restored) and one publish in the active offering (restored).
// No screenshots (faculty pages show roster names).
//
// Usage:  node tests/browser-harness/v2-training-inactive.mjs [--base http://localhost:8000]

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8000');
const PY = process.env.PREP_PYTHON || 'python';
const DOMAIN = 'prep-staging.example';
const TRAIN = '0e3ee677-8076-5a96-b110-aeb6024c1d59';
const REAL = '6ede8b13-6108-547e-9599-371c5af309c5';
const AO = { tr1: '41d47393-b20d-55d6-ac36-b06c0c214c8a', tr6: '9edf008a-ad96-5d77-aa25-fd584cc44783',
             tr7: '8687a0ed-1def-534e-a7bf-56e6481e03d1', rl3: '7a5b1752-df9f-58d2-98c5-7cfc0ab29c62' };
const ENR_TRAIN_CADET = '4ec94fb6-f467-54b2-87f4-d4042fba54b6';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const note = (s) => console.log(`  note: ${s}`);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const readback = () => JSON.parse(execFileSync(PY, [resolve(import.meta.dirname, 'v2_training_readback.py')], { encoding: 'utf8' }));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1000 } });

async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [], dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 140)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname.slice(0, 80)}`); });
  await page.evaluateOnNewDocument(() => {
    window.__blobs = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { b.text().then(t => window.__blobs.push(t)); return make(b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) return; return click.call(this); };
  });
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, problems, dialogs };
}
async function open(page, path, ms = 2200) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.body?.innerText || '');
}
const courseName = (page) => page.evaluate(() => document.querySelector('.cb-name')?.textContent || '');
const termLine = (page) => page.evaluate(() => document.querySelector('.course-bar, .cb')?.innerText || '');
async function pick(page, offeringId) {
  await open(page, '/site/faculty/dashboard.html', 1500);
  await page.click('[data-course-toggle]'); await wait(300);
  await page.click(`.course-opt[data-course="${offeringId}"]`); await wait(2500);
}
const gradebookText = (page) => page.evaluate(() =>
  document.body.innerText + ' ' + [...document.querySelectorAll('th')].map(t => (t.title || '') + ' ' + (t.getAttribute('data-title') || '')).join(' '));
const published = (t) => Number((t.match(/(\d+) assignments? published/) || [])[1] ?? NaN);
const blobs = (page) => page.evaluate(() => window.__blobs.slice());
const known = (ps) => ps.filter(p => !/artifact-sources|rag-manifest|ic-beaker/.test(p));
const TRAIN_RE = /Gate training lesson/;

const before = readback();
note(`before: ${JSON.stringify(before)}`);

// ================= 1. the director of the inactive offering =================================================
console.log('\n== 1. director of the INACTIVE training offering');
const d = await signIn(`traindirector@${DOMAIN}`, 'traindirector1234');
const p = d.page;
check('signed in', !/login\.html/.test(p.url()), p.url());
await open(p, '/site/faculty/dashboard.html', 1500);
await p.click('[data-course-toggle]'); await wait(300);
const opts = await p.$$eval('.course-opt', els => els.map(e => ({ id: e.dataset.course, text: e.innerText.replace(/\s+/g, ' ').trim() })));
note(`picker: ${JSON.stringify(opts)}`);
check('the offering picker lists BOTH offerings, training and real', opts.some(o => o.id === TRAIN) && opts.some(o => o.id === REAL), JSON.stringify(opts));
const stored0 = await p.evaluate(() => localStorage.getItem('cp.currentOffering'));
note(`stored preference key before choosing: ${stored0}`);
await p.click(`.course-opt[data-course="${TRAIN}"]`); await wait(2500);
const stored1 = await p.evaluate(() => localStorage.getItem('cp.currentOffering'));
check('choosing the training offering stores the key "<course>|<term>" (no id, nothing about is_active)', stored1 === 'gate-train|training-gate-2026', stored1);
// the stored key must bring the inactive offering back on a fresh page load
let t = await open(p, '/site/faculty/lessons.html');
check('a fresh load keeps the training offering selected from the stored key', TRAIN_RE.test(t) && !/Gate real lesson/.test(t), t.slice(0, 100));
const cards = await p.evaluate(() => {
  const cs = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.card-title') && /gate-(tr|sh)-\d/.test(c.innerText) && !c.querySelector('.card'));
  return { n: cs.length, edit: cs.filter(c => c.querySelector('[data-edit]')).length, pub: cs.filter(c => c.querySelector('[data-pub]')).length,
           link: cs.filter(c => /Open on the newer page/.test(c.innerText)).length, text: cs.map(c => c.querySelector('.card-title').innerText.trim()) };
});
check('Lessons: all 8 training lessons (7 published, 1 draft) with Edit and Publish controls, none flagged as newer-page', cards.n === 8 && cards.edit === 8 && cards.pub === 8 && cards.link === 0, JSON.stringify(cards));

t = await open(p, '/site/faculty/grade.html');
const picker = await p.evaluate(() => [...document.querySelectorAll('#asgn option')].map(o => o.textContent));
check('Grade: the picker lists the published training lessons', picker.filter(x => /^Gate (training (lesson|online)|shared)/.test(x)).length === 7, JSON.stringify(picker).slice(0, 200));
await p.select('#asgn', AO.tr1); await wait(1500);
const secs = await p.$$eval('#section option', os => os.map(o => ({ v: o.value, t: o.textContent })));
await p.select('#section', secs.find(s => /TR-A/.test(s.t))?.v || secs[0].v); await wait(2500);
t = await p.evaluate(() => document.body.innerText);
const credit = await p.$$eval('.credit-toggle', els => els.length);
const card601 = await p.$eval('#gc-3000000601', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
note(`grade card: ${card601}`);
check('Grade: a section of the training offering loads its cadets with their saved grades', /Finalized/.test(card601) && /10\.00 \/ 10\.00|10 \/ 10/.test(card601), card601);

await open(p, '/site/faculty/gradebook.html', 3000); t = await gradebookText(p);
check('Gradebook: 7 assignments published and the training cadets', published(t) === 7 && /Gate training lesson 1/.test(t) && /Gatetrain, Cadet60\d/.test(t), `published=${published(t)} ${t.slice(0, 140)}`);
note(`Gradebook text: ${t.replace(/\s+/g, ' ').slice(0, 260)}`);

await open(p, `/site/faculty/report.html?i=${AO.tr1}`, 3500);
const rep = await p.evaluate(() => document.body.innerText);
check('Report: a published training lesson stays on the Report page and names the lesson', /report\.html/.test(p.url()) && /Gate training lesson 1/.test(rep), p.url() + ' ' + rep.slice(0, 120));

t = await open(p, '/site/faculty/health.html', 3500);
check('Health loads', /health/.test(p.url()) && t.length > 200, t.slice(0, 100));
note(`Health text (first 600): ${t.replace(/\s+/g, ' ').slice(0, 600)}`);
check('Health does NOT show the inactive training offering (it lists active offerings only)', !TRAIN_RE.test(t), t.match(TRAIN_RE)?.[0]);

t = await open(p, '/site/faculty/admin.html', 2500);
check('Course Admin loads', /admin/.test(p.url()) && t.length > 200);
const tabs = await p.$$eval('[data-tab]', els => els.map(e => e.dataset.tab));
note(`Course Admin tabs: ${tabs.join(', ')}`);
if (tabs.includes('students')) { await p.click('[data-tab="students"]'); await wait(2000); const st = await p.evaluate(() => document.body.innerText); check('Course Admin: Students tab lists the training cadets', /Gatetrain, Cadet60\d/.test(st), st.slice(0, 120)); }
if (tabs.includes('sections')) { await p.click('[data-tab="sections"]'); await wait(1500); const sc = await p.evaluate(() => document.body.innerText); check('Course Admin: Sections tab lists TR-A to TR-D', /TR-A/.test(sc) && /TR-D/.test(sc), sc.slice(0, 120)); }
await p.click('[data-tab="export"]'); await wait(1500);
await p.evaluate(() => { window.__blobs.length = 0; });
await p.click('#ex-csv'); await wait(3000);
let got = await blobs(p);
const csv = got.find(x => /Student ID/.test(x)) || '';
const status = await p.$eval('#ex-status', e => e.textContent).catch(() => '');
check('Export: the grades CSV holds the seven training columns and the cadets', /Gate training lesson 1/.test(csv) && /Gate training online set/.test(csv) && /3000000601/.test(csv), `status="${status}" csv chars ${csv.length}`);
check('Export: the CSV does not hold the unpublished draft', !/Gate training draft/.test(csv));
await p.evaluate(() => { window.__blobs.length = 0; });
await p.click('#ex-json'); await wait(3500);
got = await blobs(p);
const backup = got.find(x => x.includes('assignment_offerings')) || '';
check('Export: the JSON backup holds the training lessons, the draft and the grades', /gate-tr-1/.test(backup) && /gate-tr-7/.test(backup) && /points_earned/.test(backup), `backup chars ${backup.length}`);

t = await open(p, `/site/faculty/student.html?e=${ENR_TRAIN_CADET}`);
check('Student view of a training cadet shows the lessons and the scores', /Gate training lesson 1/.test(t), t.slice(0, 140));
check('no uncaught error or failed request on the training pages (known staging gaps aside)', known(d.problems).length === 0, known(d.problems).slice(0, 4).join(' | '));
d.problems.length = 0;

// ================= 3. publish and edit ======================================================================
console.log('\n== 3. publishing is refused in the inactive offering; editing a published lesson saves');
await open(p, '/site/faculty/lessons.html');
const pubBtn = await p.$(`[data-pub="${AO.tr7}"]`);
check('the Publish button for the training draft is there', !!pubBtn);
d.dialogs.length = 0;
if (pubBtn) { await pubBtn.click(); await wait(3500); }
note(`page alert: ${JSON.stringify(d.dialogs)}`);
check('the page shows a message that names the cause (course offering is inactive)', d.dialogs.some(m => /inactive/i.test(m)), JSON.stringify(d.dialogs));
const afterPub = readback();
check('the draft is still unpublished in the database', afterPub.tr7_published === false, JSON.stringify(afterPub));
const after = await open(p, '/site/faculty/lessons.html');
check('the page reloaded and still lists the draft as a draft with a Publish button', !!(await p.$(`[data-pub="${AO.tr7}"]`)));

const marker = `Made-up edit ${Date.now().toString(36)}`;
const editBtn = await p.$(`[data-edit="${AO.tr1}"]`);
check('the Edit button for published training lesson 1 is there', !!editBtn);
d.dialogs.length = 0;
if (editBtn) {
  await editBtn.click();
  await p.waitForSelector('#f-desc', { visible: true, timeout: 10000 });
  await wait(800);
  await p.$eval('#f-desc', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, marker);
  await p.click('#lm-save');
  await wait(4500);
}
const afterEdit = readback();
check('editing a PUBLISHED lesson of the inactive offering saves (description read back)', afterEdit.tr1_description === marker, JSON.stringify(afterEdit.tr1_description));
check('it is still published, and its grades and submissions are untouched', afterEdit.tr1_published === true && afterEdit.counts.join() === before.counts.join(), JSON.stringify([afterEdit.counts, before.counts]));
note(`edit alerts: ${JSON.stringify(d.dialogs)}`);
// restore the description
await open(p, '/site/faculty/lessons.html');
const eb2 = await p.$(`[data-edit="${AO.tr1}"]`);
if (eb2) { await eb2.click(); await p.waitForSelector('#f-desc', { visible: true, timeout: 10000 }); await wait(800);
  await p.$eval('#f-desc', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, before.tr1_description || '');
  await p.click('#lm-save'); await wait(4000); }

// the control: the same action in the ACTIVE offering of the same course
await pick(p, REAL);
await open(p, '/site/faculty/lessons.html');
const rb = await p.$(`[data-pub="${AO.rl3}"]`);
check('control: the Publish button for the real offering draft is there', !!rb);
d.dialogs.length = 0;
if (rb) { await rb.click(); await wait(3500); }
const ctl = readback();
check('control: publishing a draft in the ACTIVE offering works (read back published)', ctl.rl3_published === true && d.dialogs.length === 0, JSON.stringify([ctl.rl3_published, d.dialogs]));
await open(p, '/site/faculty/lessons.html');
const rb2 = await p.$(`[data-pub="${AO.rl3}"]`);
if (rb2) { await rb2.click(); await wait(3500); }
check('control restored: the real draft is unpublished again', readback().rl3_published === false);
check('no uncaught page error in the publish and edit steps (the one refused publish returns HTTP 400, as it should)', known(d.problems).filter(x => x !== 'HTTP 400 /rest/v1/assignment_offerings').length === 0, known(d.problems).slice(0, 4).join(' | '));
await d.ctx.close();

// ================= 2. cadets ================================================================================
for (const [label, id, pw, offering, expect, absent] of [
  ['cadet with ONLY the training enrollment', `cadet0601@${DOMAIN}`, '000601', 'training', /Gate training lesson 1/, /Gate real lesson/],
  ['second training cadet', `cadet0605@${DOMAIN}`, '000605', 'training', /Gate training lesson 1/, /Gate real lesson/],
  ['cadet of the real offering', `cadet0701@${DOMAIN}`, '000701', 'real', /Gate real lesson 1/, /Gate training (lesson|online|draft)/]]) {
  console.log(`\n== 2. ${label}`);
  const s = await signIn(id, pw);
  const sp = s.page;
  check('signed in (not sent back to login)', !/login\.html/.test(sp.url()), sp.url());
  const dash = await open(sp, '/site/student/dashboard.html', 3000);
  note(`dashboard url ${sp.url().replace(BASE, '')}; first text: ${dash.replace(/\s+/g, ' ').slice(0, 300)}`);
  check('dashboard loads and is not an error page', /dashboard/.test(sp.url()) && dash.length > 100, dash.slice(0, 100));
  const names = await sp.evaluate(() => document.querySelector('.cb-name')?.textContent || '');
  note(`course bar: ${names}`);
  const list = await open(sp, '/site/student/assignments.html', 3000).catch(() => '');
  const all = dash + ' ' + list;
  check(`they see their own ${offering} lessons`, expect.test(all), all.replace(/\s+/g, ' ').slice(0, 200));
  check(`and none of the other offering's`, !absent.test(all));
  check('no uncaught error or failed request (known staging gaps aside)', known(s.problems).length === 0, known(s.problems).slice(0, 4).join(' | '));
  await s.ctx.close();
}

const final = readback();
check('the database ends as it began (published counts, descriptions, grades)', JSON.stringify(final) === JSON.stringify(before), JSON.stringify([before, final]));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
