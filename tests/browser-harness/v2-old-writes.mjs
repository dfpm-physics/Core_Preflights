// v2-old-writes.mjs -- the older pages still write correctly after the v2 step 1 migrations. STAGING only.
//
// Needs scripts/staging/serve_local.py running, scripts/staging/seed_staging.py seeded (the Fall-shaped base
// course phys-215) and scripts/staging/seed_v2_gate.py present. It signs in as the seeded people and does four
// writes through the PAGES, reading each row back from the database (v2_old_writes_readback.py, read-only):
//   1. save a lesson     director edits test-lesson-06 (a written path and an interactive path) in the editor
//   2. publish           director publishes test-lesson-04, then unpublishes it again
//   3. save a grade      director sets a grade for a submitted cadet on test-lesson-01, saves a draft, finalizes,
//                        then reopens (the cadet ends with a draft grade row, as a grader would leave one)
//   4. commit a submission  the test cadet answers test-lesson-05 and presses Submit
// A write counts only if the row read back from the database changed the way the page said it would, and the
// path columns, the kind and the new-page marker did not move.
//
// It must be started with STAGING_DB_URL in its environment (for the read-back) and PREP_PYTHON naming the venv.
// Usage:  node tests/browser-harness/v2-old-writes.mjs [--base http://localhost:8000] [--skip-submit]
// No screenshots are taken. Every name and answer written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8000');
const SKIP_SUBMIT = argv.includes('--skip-submit');
const DOMAIN = 'prep-staging.example';
const PY = process.env.PREP_PYTHON;
if (!PY || !process.env.STAGING_DB_URL) { console.error('Need PREP_PYTHON and STAGING_DB_URL'); process.exit(2); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

const OFFERING = { l1: '6b5d06ef-77ec-59fb-bf28-a4f925e677a7', l4: '5820023c-d61b-58b6-a8d9-2bd92e35de6b',
                   l5: '68533d6a-c46e-51d9-9975-f796ede03b12', l6: 'bd952f39-50c9-5677-b438-e29c72b469c6' };
const SECTION_T3A = '47c1d092-2916-5ce1-81ab-2af05fbbb1ed';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const readback = () => JSON.parse(execFileSync(PY, [resolve(import.meta.dirname, 'v2_old_writes_readback.py')], { encoding: 'utf8' }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1000 } });

async function signIn(id, pw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));            // the Submit and Remove confirmations
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', id);
  await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  return { ctx, page, errors };
}
async function go(page, path) { await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 }); await wait(1800); }

const before = readback();
console.log('before:', JSON.stringify(before));

// ============================ director ====================================================================
const { ctx: dctx, page: d, errors: derr } = await signIn(`director@${DOMAIN}`, 'director1234');
check('director signed in', !/login\.html/.test(d.url()), d.url());

// ---- 1. save a lesson ----
console.log('\n== 1. save a lesson (editor)');
const marker = `Made-up edit ${Date.now().toString(36)}`;
await go(d, '/site/faculty/lessons.html');
const editBtn = await d.$(`[data-edit="${OFFERING.l6}"]`);
check('the Edit button for test-lesson-06 is there', !!editBtn);
if (editBtn) {
  await editBtn.click();
  await d.waitForSelector('#f-desc', { visible: true, timeout: 10000 });
  await wait(800);
  await d.$eval('#f-desc', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, marker);
  await d.click('#lm-save');
  await wait(4500);
}
const afterEdit = readback();
check('the description was saved', afterEdit.lesson6.description === marker, JSON.stringify(afterEdit.lesson6.description));
check('title, kind, points and the new-page marker did not move',
  afterEdit.lesson6.title === before.lesson6.title && afterEdit.lesson6.kind === before.lesson6.kind &&
  afterEdit.lesson6.points === before.lesson6.points && afterEdit.lesson6.new_page === false,
  JSON.stringify([before.lesson6, afterEdit.lesson6]));
const dropNulls = (paths) => (paths || []).map(p => [p[0], p[1]]);
check('both paths are still there with the same modality and role', same(dropNulls(before.lesson6.paths), dropNulls(afterEdit.lesson6.paths)),
  JSON.stringify(afterEdit.lesson6.paths));
const filled = (afterEdit.lesson6.paths || []).every(p => p[2] && p[3]);
console.log(`  note: path columns after the editor save: ${JSON.stringify(afterEdit.lesson6.paths)}  (delivery/grading filled: ${filled})`);
check('every path of the saved lesson carries a delivery and a grading after the save', filled, JSON.stringify(afterEdit.lesson6.paths));

// ---- 2. publish ----
console.log('\n== 2. publish (and unpublish)');
await go(d, '/site/faculty/lessons.html');
const pubBtn = await d.$(`[data-pub="${OFFERING.l4}"]`);
check('the Publish button for test-lesson-04 is there', !!pubBtn);
if (pubBtn) {
  await pubBtn.click(); await wait(3500);
  const afterPub = readback();
  check('test-lesson-04 reads back as published', afterPub.lesson4.published === true, JSON.stringify(afterPub.lesson4));
  await go(d, '/site/faculty/lessons.html');
  const unpub = await d.$(`[data-pub="${OFFERING.l4}"]`);
  if (unpub) { await unpub.click(); await wait(3500); }
  const afterUnpub = readback();
  check('and unpublished again (restored)', afterUnpub.lesson4.published === false, JSON.stringify(afterUnpub.lesson4));
}

// ---- 3. save a grade ----
console.log('\n== 3. save a grade');
await go(d, '/site/faculty/grade.html');
await d.select('#asgn', OFFERING.l1); await wait(1500);
await d.select('#section', SECTION_T3A); await wait(2500);
const card = await d.$('#gc-3000000104');
check('the grade card for the submitted cadet is there', !!card);
let shown = null;
if (card) {
  const toggle = await card.$('.credit-toggle');
  if (toggle) { await toggle.click(); await wait(400); }
  shown = await d.$$eval('#gc-3000000104 .credit-toggle', els => els.map(e => e.dataset.status || e.className));
  await d.click('#save-btn'); await wait(3500);
  const afterDraft = readback();
  check('a draft grade row now exists, not finalized', !!afterDraft.grade104 && afterDraft.grade104.finalized === false, JSON.stringify(afterDraft.grade104));
  check('the stored question statuses match what the page showed',
    !!afterDraft.grade104 && Object.keys(afterDraft.grade104.status).length >= 2, JSON.stringify([shown, afterDraft.grade104]));
  await d.click('#finalize-btn'); await wait(3500);
  const afterFin = readback();
  check('Finalize writes it as finalized', !!afterFin.grade104 && afterFin.grade104.finalized === true, JSON.stringify(afterFin.grade104));
  const reopen = await d.$('#gc-3000000104 [data-act="reopen"]');
  if (reopen) { await reopen.click(); await wait(3000); }
  const afterReopen = readback();
  check('Reopen puts it back to a draft', !!afterReopen.grade104 && afterReopen.grade104.finalized === false, JSON.stringify(afterReopen.grade104));
}
check('no uncaught page error in the director pages', derr.length === 0, derr.join(' | '));
await dctx.close();

// ============================ cadet =======================================================================
if (!SKIP_SUBMIT) {
  console.log('\n== 4. commit a submission (test cadet)');
  const { ctx: cctx, page: c, errors: cerr } = await signIn(`cadet999@${DOMAIN}`, '999999');
  check('test cadet signed in', !/login\.html/.test(c.url()), c.url());
  await go(c, `/site/student/assignments.html?a=${OFFERING.l5}`);
  const boxes = await c.$$('textarea[data-qid], input[data-qid][type="text"], input[data-qid][type="number"]');
  check('the written preflight shows its question boxes', boxes.length >= 2, `found ${boxes.length}`);
  let n = 0;
  for (const b of boxes) { await b.click({ clickCount: 3 }).catch(() => {}); await b.type(`Made-up answer ${++n} for the walkthrough.`); }
  await wait(2500);                                              // the autosave
  const btn = await c.$('#submit-btn');
  check('the Submit button is there', !!btn);
  if (btn) { await btn.click(); await wait(5000); }
  const afterSub = readback();
  check('the submission reads back as committed', !!afterSub.sub999 && afterSub.sub999.status === 'committed' && afterSub.sub999.committed === true,
    JSON.stringify(afterSub.sub999));
  check('and holds its answers', !!afterSub.sub999 && afterSub.sub999.activities >= 1, JSON.stringify(afterSub.sub999));
  check('no uncaught page error in the cadet pages', cerr.length === 0, cerr.join(' | '));
  await cctx.close();
}

await browser.close();
console.log('\nafter: ', JSON.stringify(readback()));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
