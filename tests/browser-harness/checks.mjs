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
// The response panels render only on a SINGLE-SECTION scope (report.html responsesSection), and
// the default scope is 'mine' — which is one section only if the account teaches exactly one. So
// the select-all checks below need a section pinned, or they self-skip on an absent panel.
const SECTION = arg('section');
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

await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
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
await go('/site/faculty/dashboard.html');

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
  const SEC_Q = SECTION ? `&section=${encodeURIComponent(SECTION)}` : '';
  await go(`/site/faculty/report.html?i=${encodeURIComponent(LESSON)}${SEC_Q}`);
  check('the KDE tuner is ABSENT from a plain rollup', (await count('#kde-tuner')) === 0);

  // Wait for it rather than sampling at a fixed 1200ms. The aggregate renders after its own async
  // load, so `go()`'s flat sleep raced it — this check passed or failed run to run on Supabase
  // latency alone, with the failure text ("obj-hist=0") reading exactly like a real regression.
  // The catch keeps a genuinely absent panel reportable as a FAIL instead of an unhandled timeout.
  await page.waitForSelector('.obj-hist, .lr-fine', { timeout: 10000 }).catch(() => {});
  const hist = await count('.obj-hist');
  const curve = await count('.lr-fine');
  check('understanding-by-objective renders the integer histogram by default',
        hist > 0 && curve === 0, `obj-hist=${hist} lr-fine=${curve}`);
  check('…and it matches the effort chart markup (.eff-bar)',
        (await count('.obj-hist .eff-bar')) > 0);

  // The response panels need a SINGLE-SECTION scope (report.html responsesSection), and the
  // default 'mine' is only that for an account teaching exactly one section. So drive the page's
  // own scope control to the first individual section rather than making the caller supply a uuid
  // — which also means this keeps working when the test account is re-staffed. --section still
  // pins one explicitly.
  //
  // This runs BEFORE the panel checks below, and that ordering is the point. They used to run on
  // whatever the default scope produced, so on a multi-section account every one of them was
  // asserting against a panel that was not there: the P0.6 name check "passed" by counting zero
  // names in zero cards, and the toggle check failed as `aria-pressed=null` on every run — a
  // standing red that had stopped meaning anything. Absence is what this file exists to catch, so
  // it must not be what it silently tolerates.
  if (!(await count('#sr-list .sr-quote'))) {
    const picked = await page.evaluate(() => {
      const host = document.getElementById('rm-scope');
      if (!host) return null;
      const btn = [...host.querySelectorAll('button[data-scope]')]
        .find(b => !['mine', 'all'].includes(b.dataset.scope));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      const sel = host.querySelector('select');
      const opt = sel && [...sel.options].find(o => !['mine', 'all'].includes(o.value));
      if (!opt) return null;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.textContent.trim();
    });
    if (picked) {
      await new Promise(r => setTimeout(r, 900));
      console.log(`  (scoped to section ${picked} for the response-panel checks)`);
    }
  }
  const shown = await count('#sr-list .sr-quote');

  const namesOn = await page.$eval('#sr-names', el => el.getAttribute('aria-pressed'))
    .catch(() => null);
  check('student names are off by default on the showcase panel', namesOn === 'false',
        `aria-pressed=${namesOn}`);
  // P0.6: the fix was that names are NOT IN THE DOM while the toggle is off — hidden-but-present
  // is one Ctrl+F away in a projected classroom. Only meaningful with cards on screen, hence the
  // scope switch above.
  check('…and no name is present in the DOM while it is off',
        shown > 0 && (await count('.sr-quote [data-name], .sr-quote .sr-name')) === 0,
        shown === 0 ? 'no cards rendered — nothing was checked' : '');

  // Select-all: it acts on what is DISPLAYED, which in the sampled view is not the whole pool.
  // Asserted against the rendered card count rather than a fixed number, because the panel is 3 AI
  // picks + 5 random where the pool allows and neither is guaranteed on a real cohort.
  if (shown > 1) {
    await page.click('#sr-sel');
    const selAll = await count('#sr-list .sr-quote.sel');
    check('select-all selects every displayed card', selAll === shown, `${selAll}/${shown}`);
    check('…and the copy button counts them',
          (await page.$eval('#sr-copy', el => el.textContent)).includes(`(${shown})`));
    check('…and the button offers the way back',
          (await page.$eval('#sr-sel', el => el.textContent)).trim() === 'Clear selection');

    await page.click('#sr-sel');
    check('clicking again clears the selection', (await count('#sr-list .sr-quote.sel')) === 0);
    check('…and the copy button drops its count',
          (await page.$eval('#sr-copy', el => el.textContent)).trim() === 'Copy selected');

    // The names toggle re-renders and preserves selection (srCard: hiding a name is not enough),
    // so the label has to be recomputed from the new DOM or it goes stale against it.
    await page.click('#sr-sel');
    await page.click('#sr-names');
    check('a re-render keeps the selection', (await count('#sr-list .sr-quote.sel')) === shown);
    check('…and the select-all label survives it',
          (await page.$eval('#sr-sel', el => el.textContent)).trim() === 'Clear selection');
    await page.click('#sr-names');
  } else {
    check(`select-all: SKIPPED, panel shows ${shown} card(s)`, true);
  }

  /* Clearing an AI-raised flag. Everything up to the network call — this walks the real path
   * (pill → student list → panel → the control → the form) but CANCELS rather than confirming,
   * because the write lands on a real cadet's grade and a smoke test is not a reason to put a
   * decision on somebody's record. What the write itself does is covered in test-rollup.mjs. */
  const nfu = await page.$('#rm-flagbar [data-flag="needs_follow_up"]');
  if (nfu) {
    await nfu.click();
    await new Promise(r => setTimeout(r, 500));
    const first = await page.$('#fm-body [data-id]');
    check('a flag pill lists the students it counted', !!first);
    if (first) {
      await first.click();
      await new Promise(r => setTimeout(r, 600));
      const clearBtn = await page.$('#sm-body [data-ov-clear="needs_follow_up"]');
      check('the student panel offers to clear the flag', !!clearBtn);
      if (clearBtn) {
        await clearBtn.click();
        await new Promise(r => setTimeout(r, 250));
        check('…and clicking it asks for a reason rather than acting immediately',
              (await count('#sm-body .ov-form .ov-why')) === 1);
        // needs_follow_up is the flag whose reason is optional; honor's placeholder differs.
        const ph = await page.$eval('#sm-body .ov-why', el => el.placeholder).catch(() => '');
        check('…marked optional for a follow-up flag', /optional/i.test(ph), `placeholder="${ph}"`);
        await page.click('#sm-body .ov-cancel');
        await new Promise(r => setTimeout(r, 400));
        check('…and Cancel puts the button back, having written nothing',
              (await count('#sm-body [data-ov-clear="needs_follow_up"]')) === 1
              && (await count('#sm-body .ov-form')) === 0);
      }
      await page.evaluate(() => document.querySelectorAll('.modal.open, .open')
        .forEach(m => m.classList.remove('open')));
    }
  } else {
    check('flag-clear checks: SKIPPED, no needs_follow_up flag in this scope', true);
  }

  await go(`/site/faculty/report.html?i=${encodeURIComponent(LESSON)}${SEC_Q}&kde=1`);
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
  await go('/site/faculty/admin.html');
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
