// v2-roster.mjs -- the roster import (Course administration -> Students) on a brand-new, inactive offering. STAGING only.
//
// Needs scripts/staging/serve_local.py running and the staging seeds present (the e30-lab course and its terms are
// made by v2-terms.mjs, or on the Courses and terms page). It signs in as the seeded administrator and, in a browser
// with no script touching the data:
//   1. an invented cadet is enrolled in the EARLIER term (A) with a submission and a grade; the later term (B) is
//      inactive, has no sections and no cadets. A is fingerprinted.
//   2. from the Courses and terms page, the Students link of B opens B's Students tab (B inactive), and the course menu
//      marks it Inactive.
//   3. the example file is PASTED. The dry run lists new cadets, the cadet who already exists from term A, the sections
//      to create (with the meeting days each will get), the refused rows with plain reasons, and nothing is written.
//   4. one click creates the sections; one click imports. Read back: enrollments only in B, none in A beyond the
//      original, no second account for the cadet from term A, accounts created for the new cadets by the edge
//      function, an import-log row.
//   5. the same file again changes nothing.
//   6. a second file UPLOADED moves one cadet and omits one who has work: the departure is dropped, never deleted, and
//      the submission and grade survive.
//   7. term A is fingerprinted again: not one value changed.
//   8. the example is left in place on B.
//
// Environment: STAGING_DB_URL and PREP_PYTHON (the venv python).
// Usage:  node tests/browser-harness/v2-roster.mjs [--base http://localhost:8012]
// No screenshots are taken. Every name written is invented.

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8012');
const PY = process.env.PREP_PYTHON;
if (!PY || !process.env.STAGING_DB_URL) { console.error('Need PREP_PYTHON and STAGING_DB_URL'); process.exit(2); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }
const RB = resolve(import.meta.dirname, 'v2_roster_readback.py');
const EXAMPLE = resolve(import.meta.dirname, '../../docs/examples/roster-example.csv');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${ok || !detail ? '' : '  -- ' + detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const py = (...args) => JSON.parse(execFileSync(PY, [RB, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

py('reset');
py('setup-fall');
const fpBefore = py('fingerprint');
const s0 = py('state');
check('set-up: the earlier term holds one invented cadet with a submission and a grade',
  fpBefore.counts.enrollments === 1 && fpBefore.counts.submissions === 1 && fpBefore.counts.grades === 1, JSON.stringify(fpBefore.counts));
check('set-up: the later term has no sections and no cadets', Object.keys(s0.sections).length === 0 && s0.enrollment_rows_b === 0);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1500 } });

const DIALOG = { last: '', count: 0 };
const a_ctx = await browser.createBrowserContext();
const page = await a_ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push('UNCAUGHT ' + e.message.slice(0, 160)));
page.on('dialog', d => { DIALOG.last = d.message(); DIALOG.count++; d.accept().catch(() => {}); });

const body = () => page.evaluate(() => document.body?.innerText || '');
async function waitFor(fn, arg0, ms = 25000) { return page.waitForFunction(fn, { timeout: ms }, arg0).then(() => true).catch(() => false); }
const setValue = (sel, v) => page.$eval(sel, (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const previewText = () => page.$eval('#csv-preview', e => e.innerText).catch(() => '');
async function waitPreview(re) {
  const ok = await waitFor((src) => { const e = document.querySelector('#csv-preview'); return !!e && e.style.display !== 'none' && new RegExp(src).test(e.innerText); }, re.source);
  return ok ? previewText() : null;
}
async function dbState() { return py('state'); }

/* ============================ 1. sign in, reach B while it is inactive ============================ */
console.log('\n== 1. reach the inactive offering from the Courses and terms page');
await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
await page.type('#identifier', 'admin@prep-staging.example');
await page.type('#password', 'admin1234');
await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
check('administrator signed in', !/login\.html/.test(page.url()), page.url());

await page.goto(`${BASE}/site/faculty/terms.html`, { waitUntil: 'networkidle2' });
await waitFor(() => !!document.querySelector('#offerings-table'));
const rowB = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#offerings-table tbody tr')].find(r => r.innerText.includes('e30-lab') && r.innerText.includes('e30-term-b'));
  return tr ? { text: tr.innerText, hasLink: !!tr.querySelector('[data-open-students]') } : null;
});
check('the later term of e30-lab is listed as Inactive', !!rowB && /Inactive/.test(rowB.text), JSON.stringify(rowB));
check('its row carries a plain link to its Students and roster import', !!rowB?.hasLink);
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#offerings-table tbody tr')].find(r => r.innerText.includes('e30-term-b'));
  tr.querySelector('[data-open-students]').click();
});
await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
await waitFor(() => !!document.querySelector('#imp'));
let t = await body();
check('it lands on Course administration, Students tab', /Course administration/.test(page.url() ? t : '') && /\/admin\.html/.test(page.url()), page.url());
check('the page is for E30 Term B and says the term is inactive', /E30 Term B/.test(t) && !!(await page.$('#inactive-badge')));
check('the roster import is open and offers a paste box', !!(await page.$('#paste-text')));
// the course menu, reachable and marked
const menu = await page.evaluate(() => { const o = [...document.querySelectorAll('.course-opt')]; return o.map(x => x.innerText.replace(/\s+/g, ' ')); }).catch(() => []);
check('the course menu lists the inactive offering with the word Inactive', menu.some(m => /E30 Lab/.test(m) && /Inactive/.test(m)), JSON.stringify(menu.slice(0, 4)));

/* ============================ 2. paste the example: the dry run ============================ */
console.log('\n== 2. paste the example file: the dry run');
const example = readFileSync(EXAMPLE, 'utf8');
await page.evaluate(() => { document.getElementById('paste-box').open = true; });
await setValue('#paste-text', example);
await page.click('#paste-check');
let pv = await waitPreview(/This course has no sections yet/);
check('the preview says plainly that this course has no sections yet and names the ones the file uses',
  !!pv && /LAB-1, LAB-2, W2C/.test(pv), (pv || '').slice(0, 300));
check('it says what each new section starts with (free-form names get no meeting days)',
  !!pv && /LAB-1 no meeting days/.test(pv) && /W2C meets W, period 2/.test(pv));
const sOpen = await dbState();
check('nothing was written by the dry run', Object.keys(sOpen.sections).length === 0 && sOpen.enrollment_rows_b === 0 && sOpen.import_log_rows === 0);

await page.click('#mk-sections');
pv = await waitPreview(/[1-9]\d* of \d+ row\(s\) match/);
if (process.env.DUMP) writeFileSync(process.env.DUMP, pv || '');
check('after the sections are created the preview lists new cadets and the cadet who already exists',
  !!pv && /4 new|\b4\b.*new/.test(pv) && /1 already have an account/.test(pv), (pv || '').slice(0, 400));
check('the existing cadet is not offered as a new account', !!pv && !/Ada Q\. Rosterone[\s\S]{0,40}new student/.test(pv));
const newList = await page.evaluate(() => [...document.querySelectorAll('#csv-preview details')].map(d => d.innerText).find(t => /new student/.test(t)) || '');
check('the new cadets are listed by name, the existing one is not among them',
  /Rostertwo/.test(newList) && /Rosterfive/.test(newList) && !/Rosterone/.test(newList), newList.slice(0, 200));
// refused rows, each with a reason
await page.evaluate(() => { document.querySelectorAll('#csv-preview details').forEach(d => d.open = true); });
const refused = await previewText();
check('the section name that cannot be one is refused in a plain sentence', /cannot use/.test(refused) && /BAD;SECTION/.test(refused));
check('the row for another course is held back, with what the file says', /Subject/.test(refused) && /PHYS/.test(refused) && /different course or term/.test(refused));
check('the bad email address is refused in a sentence', /email/i.test(refused) && /Rostereight/.test(refused));
const sMid = await dbState();
check('the sections exist now (3), and still no enrollment',
  Object.keys(sMid.sections).length === 3 && sMid.enrollment_rows_b === 0, JSON.stringify(sMid.sections));
check('a free-form section has no meeting days; W2C meets W, period 2',
  same(sMid.sections['LAB-1'], { days: [], period: null }) && same(sMid.sections['W2C'], { days: ['W'], period: 2 }));

/* ============================ 3. one click writes ============================ */
console.log('\n== 3. one click writes');
const commitLabel = await page.$eval('#csv-commit', e => e.innerText);
check('the button says how many will be imported', /Import 5 students/.test(commitLabel), commitLabel);
await page.click('#csv-commit');
const accountsOk = await (async () => {
  for (let i = 0; i < 40; i++) { const s = await dbState(); if (['3000000802', '3000000803', '3000000804', '3000000805'].every(k => s.students[k]?.account)) return true; await wait(1500); }
  return false;
})();
const s1 = await dbState();
const ids = ['3000000801', '3000000802', '3000000803', '3000000804', '3000000805'];
check('five enrollments, all in the chosen term, all active',
  s1.enrollment_rows_b === 5 && ids.every(k => s1.enrollments[k]?.status === 'active'), JSON.stringify(s1.enrollments));
check('each is in the section the file names', s1.enrollments['3000000802']?.section === 'LAB-1' && s1.enrollments['3000000803']?.section === 'LAB-2' && s1.enrollments['3000000805']?.section === 'W2C');
check('the refused rows were not enrolled', !s1.enrollments['3000000806'] && !s1.enrollments['3000000807'] && !s1.enrollments['3000000808']);
check('the cadet from the earlier term is enrolled in both terms, with one account and one student row',
  s1.enrollments_per_cadet_all_terms['3000000801'] === 2 && s1.student_rows === 5 && s1.fall_cadet_uid_hash === s0.fall_cadet_uid_hash, JSON.stringify(s1.enrollments_per_cadet_all_terms));
check('the earlier term still holds exactly its one enrollment', s1.enrollment_rows_a === 1);
check('the edge function gave the four new cadets a sign-in account', accountsOk);
check('one import-log row records the file and the sections created', s1.import_log_rows === 1 && s1.import_log[0][4] === 3, JSON.stringify(s1.import_log));
t = await body();
check('the roster table on the page lists them', /Rostertwo/.test(t) && /LAB-2/.test(t));

/* ============================ 4. the same file again ============================ */
console.log('\n== 4. the same file again changes nothing');
const before = { enr: s1.enrollments, rows: s1.enrollment_rows_b, st: s1.students, sec: s1.sections };
await page.goto(`${BASE}/site/faculty/admin.html`, { waitUntil: 'networkidle2' });
await waitFor(() => !!document.querySelector('#paste-box'));
await page.evaluate(() => { document.getElementById('imp').open = true; document.getElementById('paste-box').open = true; });
await setValue('#paste-text', example);
await page.click('#paste-check');
pv = await waitPreview(/match this course/);
check('the re-run preview shows 0 new cadets and 5 already on the roster', !!pv && /0\s*new/.test(pv) && /5\s*already have an account/.test(pv), (pv || '').slice(0, 250));
check('and no section to create, no departure', !!pv && !/do not exist yet|no sections yet/.test(pv) && !/enrolled but not in this file/.test(pv));
await page.click('#csv-commit');
await wait(4000);
const s2 = await dbState();
check('enrollments, students and sections are unchanged by the re-run',
  same(s2.enrollments, before.enr) && s2.enrollment_rows_b === before.rows && same(s2.students, before.st) && same(s2.sections, before.sec) && s2.student_rows === 5);

/* ============================ 5. a move and a departure, by file upload ============================ */
console.log('\n== 5. a move and a departure; work is kept');
py('add-work', '3000000804');
const s3a = await dbState();
check('set-up: the cadet who will leave has a submission and a grade in this term (plus the first cadet\'s in the earlier term)',
  s3a.submissions === 2 && s3a.grades === 2, `${s3a.submissions}/${s3a.grades}`);
const file2 = example.split(/\r?\n/).filter(l => l && !l.startsWith('3000000804') && !l.startsWith('3000000803'))
  .concat(['3000000803,"Rosterthree, Cy",rf0803@prep-staging.example,CS03,LAB-1,,',
           '3000000809,"Rosternine, Ivy",rf0809@prep-staging.example,CS09,LAB-2,,']).join('\n') + '\n';
const dir = mkdtempSync(resolve(tmpdir(), 'roster-'));
const f2 = resolve(dir, 'roster-second.csv');
writeFileSync(f2, file2);
await page.goto(`${BASE}/site/faculty/admin.html`, { waitUntil: 'networkidle2' });
await waitFor(() => !!document.querySelector('#paste-box'));
await page.evaluate(() => { document.getElementById('imp').open = true; });
const input = await page.$('#csv-file');
await input.uploadFile(f2);
pv = await waitPreview(/enrolled but not in this file/);
check('the dry run lists the departure by name, and says the work is kept', !!pv && /Rosterfour/.test(pv) && /KEPT|kept/.test(pv), (pv || '').slice(0, 300));
check('the dry run lists the section move', !!pv && /different section/.test(pv) && /Rosterthree/.test(pv));
const sNo = await dbState();
check('nothing changed before the click', sNo.enrollments['3000000804'].status === 'active' && sNo.enrollments['3000000803'].section === 'LAB-2');
await page.click('#csv-commit');
await waitFor(() => true, null, 1000);
let s3;
for (let i = 0; i < 30; i++) { s3 = await dbState(); if (s3.enrollments['3000000804']?.status === 'dropped' && s3.enrollments['3000000809']) break; await wait(1500); }
check('the departure is dropped (not deleted) and dated', s3.enrollments['3000000804']?.status === 'dropped' && s3.enrollments['3000000804']?.dropped_at === true, JSON.stringify(s3.enrollments['3000000804']));
check('the enrollment row is still there and its submission and grade survive', s3.submissions === 2 && s3.grades === 2 && s3.enrollment_rows_b === 6, `${s3.submissions}/${s3.grades}/${s3.enrollment_rows_b}`);
check('the moved cadet is in the new section, same enrollment, now 2 rows total for that cadet across terms is unchanged', s3.enrollments['3000000803']?.section === 'LAB-1' && s3.enrollments_per_cadet_all_terms['3000000803'] === 1);
check('the new cadet in the file was enrolled and given an account', s3.enrollments['3000000809']?.section === 'LAB-2');
check('a cadet left out of the file but not in a covered section is untouched', s3.enrollments['3000000805']?.status === 'active');

/* ============================ 6. the earlier term did not change ============================ */
console.log('\n== 6. the earlier term is unchanged');
const fpAfter = py('fingerprint');
check('the earlier term fingerprint is identical before and after every import', fpAfter.hash === fpBefore.hash && same(fpAfter.counts, fpBefore.counts), `${fpBefore.hash.slice(0, 10)} vs ${fpAfter.hash.slice(0, 10)}`);
const fin = await dbState();
check('the cadet from the earlier term is still enrolled there', fin.enrollment_rows_a === 1 && fin.enrollments_per_cadet_all_terms['3000000801'] === 2);
check('no uncaught page errors', problems.length === 0, problems.join(' | '));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
console.log('Left in place on e30-lab / e30-term-b (inactive): the worked example, with invented cadets. Run again to rebuild it.');
process.exit(failed ? 1 : 0);
