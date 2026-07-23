// checks.mjs — the P0.5 checklist, as assertions rather than screenshots.
//
// pass.mjs answers "did every page render without errors". This answers the specific questions
// the roadmap actually asks, most of which are about something being ABSENT for the right role —
// and absence is exactly what a screenshot review misses, because a missing panel looks like a
// page that simply does not have one.
//
// Credentials come from supabase/admin/.env (PREP_TEST_FACULTY_*) unless overridden. Run once per
// role tier; flip the account between runs with
//   scripts/test_faculty_account.py --role instructor --commit
//
// Usage:
//   node tests/browser-harness/checks.mjs --tier director|instructor|admin --lesson <offering-uuid>
//   (add --email/--password to override the .env; --multi-course when staffed on 2+ offerings)

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
const LESSON = arg('lesson');
const TIER = arg('tier', 'director');
if (!EMAIL || !PASSWORD) {
  console.error('No faculty credentials. Set PREP_TEST_FACULTY_* in supabase/admin/.env, '
    + 'or pass --email and --password.');
  process.exit(2);
}

const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found.'); process.exit(2); }

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};
const section = t => console.log(`\n=== ${t} ===`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();

await page.goto(`${BASE}/site/app/login.html`, { waitUntil: 'networkidle2' });
await page.type('#identifier', EMAIL);
await page.type('#password', PASSWORD);
await Promise.all([
  page.click('#submit'),
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
]);
if (/login\.html/.test(page.url())) { console.error('Sign-in failed.'); await browser.close(); process.exit(1); }

const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));   // let the late-loading panels settle
};
const count = (sel) => page.$$eval(sel, els => els.length).catch(() => 0);
const text = (sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => null);

console.log(`\nTier under test: ${TIER}\n`);

/* ── Dashboard: P1.6 tasks panel, P1.7 switchers ──────────────────────────── */
section('dashboard');
await go('/site/app/faculty/dashboard.html');

const boxes = await count('.duo-box:not(.duo-skel)');
const emptyState = await count('.duo-empty');
check('the due-out panel resolved (boxes or an explicit empty state)', boxes > 0 || emptyState > 0,
      'still showing the loading skeleton — the task queries never settled');
check('no box renders a zero count',
      !(await page.$$eval('.duo-n', els => els.map(e => e.textContent.trim())).catch(() => []))
        .includes('0'));

// Director-only sources must not appear for an instructor. RLS admits them, so this is the
// only place the rule is enforced.
const taskIds = await page.$$eval('.duo-box[data-task]', els => els.map(e => e.dataset.task))
  .catch(() => []);
const DIRECTOR_ONLY = ['to-aggregate', 'unstaffed-sections', 'analysis-runs'];
if (TIER === 'instructor') {
  check('no director-only task source is shown to an instructor',
        !taskIds.some(id => DIRECTOR_ONLY.includes(id)), `saw ${taskIds.join(', ')}`);
} else {
  check(`director-eligible sources may appear (saw: ${taskIds.join(', ') || 'none outstanding'})`, true);
}

// Two-sided, because "no switcher" is CORRECT for a one-course account and asserting it
// unconditionally just produces a failure that has to be explained away every run. Pass
// --multi-course when the account is staffed on two offerings.
const courseButtons = await count('#courseSeg button');
const courseSelect = await count('#courseSel');
const hasSwitcher = courseButtons >= 2 || courseSelect === 1;
if (argv.includes('--multi-course')) {
  check('the course switcher renders for a multi-course account', hasSwitcher,
        `seg=${courseButtons} select=${courseSelect}`);
} else {
  check('no course switcher for a single-course account (a one-option control is a label)',
        !hasSwitcher, `seg=${courseButtons} select=${courseSelect}`);
}

const scopeOpts = await count('#scopeSel option');
const scopeBtns = await count('#scopeSeg button');
if (TIER === 'instructor') {
  check('an instructor gets no section scope control', scopeOpts === 0 && scopeBtns === 0);
} else {
  check('the section scope control offers individual sections, not just all/mine',
        scopeOpts > 2 || scopeBtns > 2, `select=${scopeOpts} seg=${scopeBtns}`);
}

/* ── Rollup: P0.10 KDE tuner gating, P1.5 chart style ─────────────────────── */
if (LESSON) {
  section('rollup');
  await go(`/site/app/faculty/report.html?i=${encodeURIComponent(LESSON)}`);
  check('the KDE tuner is ABSENT from a plain rollup', (await count('#kde-tuner')) === 0);

  const hist = await count('.obj-hist');
  const curve = await count('.lr-fine');
  check('understanding-by-objective renders the integer histogram by default',
        hist > 0 && curve === 0, `obj-hist=${hist} lr-fine=${curve}`);
  check('…and it matches the effort chart markup (.eff-bar)',
        (await count('.obj-hist .eff-bar')) > 0);

  const namesOn = await page.$eval('#sr-names', el => el.getAttribute('aria-pressed'))
    .catch(() => null);
  check('student names are off by default on the showcase panel', namesOn === 'false',
        `aria-pressed=${namesOn}`);
  // P0.6: the fix was that names are NOT IN THE DOM while the toggle is off — hidden-but-present
  // is one Ctrl+F away in a projected classroom.
  check('…and no name is present in the DOM while it is off',
        (await count('.sr-quote [data-name], .sr-quote .sr-name')) === 0);

  await go(`/site/app/faculty/report.html?i=${encodeURIComponent(LESSON)}&kde=1`);
  const tuner = await count('#kde-tuner');
  if (TIER === 'instructor') {
    check('?kde=1 does NOT give an instructor the tuner', tuner === 0);
  } else {
    check('?kde=1 gives a director the tuner', tuner === 1);
  }
}

/* ── Staff table: P0.11 ───────────────────────────────────────────────────── */
if (TIER !== 'instructor') {
  section('course admin — staff table');
  await go('/site/app/faculty/admin.html');
  const ownSelect = await count('.staff-tbl select[disabled]');
  const implicit = (await text('.staff-tbl')) || '';
  if (TIER === 'admin') {
    check('a global admin sees the implicit variant, not a role control',
          /implicit/i.test(implicit) || ownSelect === 1,
          'expected "implicit — no staff row" or a disabled select');
  } else {
    check('your own row renders a DISABLED select, not a badge', ownSelect === 1,
          `found ${ownSelect} disabled selects in .staff-tbl`);
  }
  const roleCells = await count('.staff-tbl .role-cell');
  check('role cells use the fixed-height flex box', roleCells > 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exitCode = failed ? 1 : 0;
