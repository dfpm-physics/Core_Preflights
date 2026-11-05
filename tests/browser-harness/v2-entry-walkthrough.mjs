// v2-entry-walkthrough.mjs -- the older pages and the items entered on the newer page. STAGING only.
//
// Needs scripts/staging/serve_local.py running, scripts/staging/seed_staging.py (the Fall-shaped base course)
// and scripts/staging/seed_v2_gate.py present. It signs in as seeded, invented people and checks, in a real
// browser, the section 25 walkthrough:
//   gate director, ENTRY course (every item flagged, none published, the offering inactive)
//       Lessons shows each item with "Open on the newer page" and no Edit, Publish or Remove
//       the Grade picker, the Report page, the Health page and the Gradebook leave the items out
//       Course Admin -> Export: the grades CSV has no flagged column; the JSON backup holds them (the spec says a
//       backup should); Student view of an entry cadet shows none of them
//   gate director, VECTOR course (active, old-shape published items): the same pages show them, with controls
//       a positive control for each of Lessons, Report, Gradebook, Export, Student view
//   base-seed director and instructor (Fall-shaped phys-215): Gradebook, Course Admin, Student view load
//   a student session: the base test cadet and the entry cadet see none of the new items; a vector cadet sees
//       only that course's published items
// Read-only except that Course Admin and Lessons are clicked through, never saved. No screenshots (faculty pages
// show roster names). The course is chosen with the page's own course menu, as a person would.
//
// Usage:  node tests/browser-harness/v2-entry-walkthrough.mjs [--base http://localhost:8000]

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8000');
const DOMAIN = 'prep-staging.example';
// Deterministic ids of the gate seed (uuid5 under a fixed namespace) and of the base seed.
const ENTRY = arg('entry', 'ee6fabc3-2c57-5f42-8fc9-8023fb267808');
const VECTOR = arg('vector', 'b17381d2-5545-519b-a553-c20809dc9520');
const FLAGGED_ID = arg('flagged', '2102a297-2c93-567e-af61-820ead0c8085');      // gate-pf-1
const VECTOR_ITEM = arg('vector-item', 'b5e3157c-915e-5627-b11c-87edd6800eaf');  // gate-v1 (written, old shape)
const ENR = { entry401: '0b35b1ef-310e-548e-8bfd-ca5728e74986', vec501: 'b2889321-3dfb-5d6b-8c8f-5aa0a799539b',
              base101: '27d2ac47-4ddc-5421-ab49-cef8da2898fa' };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

const FLAGGED_RE = /Gate (preflight|case study|group project|quiz|exam|homework|lab|bonus)|gate-(pf|cs|gp|qz|ex|hw|lab|bonus)-/i;
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1000 } });

/** Sign in; collect page errors and failed database requests; capture blobs the page would download. */
async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
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
  return { ctx, page, problems };
}
async function open(page, path, ms = 2200) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(ms);
  return page.evaluate(() => document.body?.innerText || '');
}
/** Pick a course the way a person does: the course menu in the top bar. */
async function useCourse(page, offeringId, titleFragment) {
  await open(page, '/site/faculty/dashboard.html', 1500);
  const already = await page.evaluate(() => document.querySelector('.cb-name')?.textContent || '');
  if (!already.includes(titleFragment)) {
    await page.click('[data-course-toggle]'); await wait(300);
    await page.click(`.course-opt[data-course="${offeringId}"]`); await wait(2500);
  }
  const now = await page.evaluate(() => document.querySelector('.cb-name')?.textContent || '');
  check(`course menu shows "${titleFragment}"`, now.includes(titleFragment), now);
}
/** Gradebook text plus the column tooltips, where the full item titles are. */
const gradebookText = (page) => page.evaluate(() =>
  document.body.innerText + ' ' + [...document.querySelectorAll('th')].map(t => (t.title || '') + ' ' + (t.getAttribute('data-title') || '')).join(' '));
const published = (t) => Number((t.match(/(\d+) assignments? published/) || [])[1] ?? NaN);
const blobs = (page) => page.evaluate(() => window.__blobs.slice());

// ============================ gate director, the entry course ============================================
console.log('\n== gate director on the ENTRY course');
const g = await signIn(`gatedirector@${DOMAIN}`, 'gatedirector1234');
const gp = g.page;
check('signed in', !/login\.html/.test(gp.url()), gp.url());
await useCourse(gp, ENTRY, 'Gate entry');

let text = await open(gp, '/site/faculty/lessons.html');
check('Lessons lists the flagged items (10)', (text.match(/gate-(pf|cs|gp|qz|ex|hw|lab|bonus)-/g) || []).length >= 10);
const cards = await gp.evaluate(() => {
  const cs = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.card-title') && /gate-[a-z]+-/.test(c.innerText) && !c.querySelector('.card'));
  return { n: cs.length, link: cs.filter(c => [...c.querySelectorAll('a')].some(a => /Open on the newer page/.test(a.innerText) && /items\.html\?a=/.test(a.getAttribute('href') || ''))).length,
           edit: cs.filter(c => c.querySelector('[data-edit],[data-pub],[data-del]')).length };
});
check('every flagged item has "Open on the newer page" and none has Edit, Publish or Remove',
  cards.n >= 10 && cards.link === cards.n && cards.edit === 0, JSON.stringify(cards));

text = await open(gp, '/site/faculty/grade.html');
const picker = await gp.evaluate(() => [...document.querySelectorAll('#asgn option')].map(o => o.textContent));
check('Grade picker leaves out every flagged item (and the page loaded)', picker.length >= 1 && !picker.some(t => FLAGGED_RE.test(t)), JSON.stringify(picker).slice(0, 200));

await open(gp, `/site/faculty/report.html?i=${FLAGGED_ID}`);
check('Report for a flagged item returns to the dashboard', /dashboard\.html/.test(gp.url()), gp.url());

text = await open(gp, '/site/faculty/health.html');
check('Health page leaves out every flagged item (and loaded)', /health/.test(gp.url()) && text.length > 200 && !FLAGGED_RE.test(text), text.match(FLAGGED_RE)?.[0]);

await open(gp, '/site/faculty/gradebook.html'); text = await gradebookText(gp);
check('Gradebook leaves out every flagged item (loaded, and says 0 assignments published)', /gradebook/.test(gp.url()) && published(text) === 0 && !FLAGGED_RE.test(text), text.slice(0, 160));

// Course Admin -> Export
text = await open(gp, '/site/faculty/admin.html');
check('Course Admin loads', /admin/.test(gp.url()) && text.length > 200);
await gp.click('[data-tab="export"]'); await wait(1500);
await gp.click('#ex-csv'); await wait(2500);
let status = await gp.$eval('#ex-status', e => e.textContent).catch(() => '');
let got = await blobs(gp);
check('the grades CSV for the entry course holds no flagged column (nothing is downloaded: no published column)',
  !got.some(t => FLAGGED_RE.test(t)) && /No students in scope/.test(status), `status="${status}" blobs=${got.length}`);
await gp.click('#ex-json'); await wait(3000);
got = await blobs(gp);
const backup = got.find(t => t.includes('assignment_offerings')) || '';
check('the JSON backup of the entry course HOLDS the flagged items (the spec says a backup should)',
  /gate-pf-1/.test(backup) && /gate-ex-1/.test(backup), `backup chars ${backup.length}`);

text = await open(gp, `/site/faculty/student.html?e=${ENR.entry401}`);
check('Student view of an entry cadet loads and shows none of the flagged items', /student/.test(gp.url()) && text.length > 150 && !FLAGGED_RE.test(text), text.match(FLAGGED_RE)?.[0]);
const known = (ps) => ps.filter(p => !/artifact-sources|rag-manifest|ic-beaker/.test(p));
check('no uncaught page error or failed request on the entry course pages (known staging gaps aside)', known(g.problems).length === 0, known(g.problems).slice(0, 4).join(' | '));
g.problems.length = 0;

// ============================ gate director, the vector course (positive controls) ========================
console.log('\n== gate director on the VECTOR course (positive controls)');
await useCourse(gp, VECTOR, 'Gate vector');
text = await open(gp, '/site/faculty/lessons.html');
const vcard = await gp.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].filter(c => /gate-v1\b/.test(c.innerText) && c.querySelector('.card-title') && !c.querySelector('.card')).pop();
  return c ? { edit: !!c.querySelector('[data-edit]'), pub: !!c.querySelector('[data-pub]'), link: /Open on the newer page/.test(c.innerText) } : null;
});
check('Lessons: an old-shape item has Edit and Publish and no newer-page link', !!vcard && vcard.edit && vcard.pub && !vcard.link, JSON.stringify(vcard));

await open(gp, `/site/faculty/report.html?i=${VECTOR_ITEM}`, 3500);
check('Report: an unflagged item of the active course stays on the Report page (positive control)', /report\.html/.test(gp.url()), gp.url());

await open(gp, '/site/faculty/gradebook.html'); text = await gradebookText(gp);
check('Gradebook shows the 8 published vector items (positive control)', published(text) === 8 && /Gate vector written A/.test(text), text.slice(0, 160));

text = await open(gp, '/site/faculty/grade.html');
const vpicker = await gp.evaluate(() => [...document.querySelectorAll('#asgn option')].map(o => o.textContent));
check('Grade picker lists the vector items (positive control)', vpicker.some(t => /Gate vector written A/.test(t)), JSON.stringify(vpicker).slice(0, 160));

text = await open(gp, '/site/faculty/health.html');
check('Health page loads on the vector course', /health/.test(gp.url()) && text.length > 200);

await open(gp, '/site/faculty/admin.html');
await gp.click('[data-tab="export"]'); await wait(1500);
await gp.evaluate(() => { window.__blobs.length = 0; });
await gp.click('#ex-csv'); await wait(3000);
got = await blobs(gp);
const csv = got.find(t => /Student ID/.test(t)) || '';
status = await gp.$eval('#ex-status', e => e.textContent).catch(() => '');
check('the grades CSV of the vector course holds the published columns (positive control)',
  /Gate vector written A/.test(csv) && !FLAGGED_RE.test(csv), `status="${status}" csv chars ${csv.length}`);

text = await open(gp, `/site/faculty/student.html?e=${ENR.vec501}`);
check('Student view of a vector cadet shows the vector items (positive control)', /Gate vector written A/.test(text), text.slice(0, 120));
check('no uncaught page error or failed request on the vector course pages (known staging gaps aside)', known(g.problems).length === 0, known(g.problems).slice(0, 4).join(' | '));
await g.ctx.close();

// ============================ base-seed staff ==========================================================
for (const [role, id, pw] of [['director', `director@${DOMAIN}`, 'director1234'], ['instructor', `instructor@${DOMAIN}`, 'instructor1234']]) {
  console.log(`\n== base-seed ${role}, Fall-shaped phys-215`);
  const s = await signIn(id, pw);
  const sp = s.page;
  check('signed in', !/login\.html/.test(sp.url()), sp.url());
  for (const [name, path, needle] of [['dashboard', '/site/faculty/dashboard.html', /Test Lesson/], ['Gradebook', '/site/faculty/gradebook.html', /7 assignments published/],
                                      ['Lessons', '/site/faculty/lessons.html', /Test Lesson 1/], ['Health', '/site/faculty/health.html', null],
                                      ['Student view', `/site/faculty/student.html?e=${ENR.base101}`, /Test Lesson 1/]]) {
    let t = await open(sp, path);
    if (name === 'Gradebook') t = await gradebookText(sp);
    check(`${name} loads with the base lessons and no gate item`, t.length > 150 && !FLAGGED_RE.test(t) && /gate-/i.test(t) === false && (needle ? needle.test(t) : true), t.match(FLAGGED_RE)?.[0] || t.slice(0, 80));
  }
  if (role === 'director') {
    await open(sp, '/site/faculty/admin.html');
    await sp.click('[data-tab="export"]'); await wait(1500);
    await sp.click('#ex-csv'); await wait(3000);
    const c = (await blobs(sp)).find(t => /Student ID/.test(t)) || '';
    check('Course Admin export: the grades CSV of the Fall-shaped course has its columns and no gate item',
      /Test Lesson 1/.test(c) && !FLAGGED_RE.test(c), `csv chars ${c.length}`);
  }
  const bad = s.problems.filter(p => !/artifact-sources|rag-manifest|ic-beaker/.test(p));
  check(`no uncaught page error or failed request (${role})`, bad.length === 0, bad.slice(0, 4).join(' | '));
  await s.ctx.close();
}

// ============================ student sessions ==========================================================
for (const [label, id, pw, want] of [['base test cadet', `cadet999@${DOMAIN}`, '999999', null], ['entry cadet', `cadet0401@${DOMAIN}`, '000401', null],
                                     ['vector cadet', `cadet0501@${DOMAIN}`, '000501', /Gate vector/]]) {
  console.log(`\n== ${label}`);
  const s = await signIn(id, pw);
  check('signed in', !/login\.html/.test(s.page.url()), s.page.url());
  let seen = '';
  for (const p of ['dashboard', 'lessons', 'assignments']) seen += '\n' + await open(s.page, `/site/student/${p}.html`, 3000);
  if (want) check('sees the vector course\'s published items', want.test(seen), seen.slice(0, 100));
  else check('sees none of the new items', !FLAGGED_RE.test(seen) && !/Gate vector/.test(seen), seen.match(FLAGGED_RE)?.[0]);
  check('and none of the entry course items', !FLAGGED_RE.test(seen), seen.match(FLAGGED_RE)?.[0]);
  const bad = s.problems.filter(p => !/artifact-sources|rag-manifest|ic-beaker/.test(p));
  check('no uncaught page error or failed request', bad.length === 0, bad.slice(0, 4).join(' | '));
  await s.ctx.close();
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
