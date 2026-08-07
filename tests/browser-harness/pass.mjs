// pass.mjs — drive the P0.5 walkthrough in a real browser.  See README.md.
//
// Signs in against the LIVE project through a local static server, walks a page list, and reports
// every console error, uncaught exception and failed request per page. Screenshots land in the
// session scratchpad — never the repo, because faculty pages render real cadet names.

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { testFaculty } from './env.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');

/* ── args ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg('base', 'http://localhost:8000');
const THEME = arg('theme', 'light');
const STUDENT = flag('student');
// Faculty credentials come from supabase/admin/.env (PREP_TEST_FACULTY_*) unless overridden on the
// command line — so the walkthrough is `node pass.mjs` with no secret typed. The student path uses
// the deliberate test cadet from tests/app-schema/harness.mjs; no real account is involved.
const FAC = STUDENT ? {} : testFaculty();
const EMAIL = arg('email', STUDENT ? '3009999999@usafa.edu' : FAC.email || null);
const PASSWORD = arg('password', STUDENT ? '999999' : FAC.password || null);
const OUT = arg('out', process.env.CLAUDE_SCRATCHPAD
  || resolve(process.env.TEMP || '/tmp', 'prep-browser-pass'));

if (!EMAIL || !PASSWORD) {
  console.error('No faculty credentials. Set PREP_TEST_FACULTY_EMAIL / _PASSWORD in '
    + 'supabase/admin/.env, or pass --email and --password (or --student for the test cadet).');
  process.exit(2);
}
// A screenshot of a faculty page is a roster. Refuse to put one in the working tree.
if (resolve(OUT).startsWith(REPO + sep)) {
  console.error(`Refusing to write screenshots inside the repo (${OUT}).\n`
    + 'Faculty pages render real cadet names — use the scratchpad.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const CHROME_CANDIDATES = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

/* ── the walk ─────────────────────────────────────────────────────────────── */
// Each entry: [label, path, waitForSelector]. The selector is what proves the page actually
// rendered rather than merely returning 200 with a spinner — the failure mode that matters.
// --lesson <slug> adds the rollup, which is the single densest page in the app and the one
// carrying the most unlooked-at work (P0.9, P0.10, P0.13, P1.5). It needs a real lesson slug, so
// it is opt-in rather than a guessed URL that would 404 and read as a failure.
const LESSON = arg('lesson');

const FACULTY = [
  ['dashboard',   '/site/faculty/dashboard.html', '.page-head h1'],
  ...(LESSON ? [['rollup', `/site/faculty/report.html?i=${encodeURIComponent(LESSON)}`,
                 '.lr-sec, .rm-shell, .page-head']] : []),
  ...(LESSON ? [['rollup-kde', `/site/faculty/report.html?i=${encodeURIComponent(LESSON)}&kde=1`,
                 '.lr-sec, .rm-shell, .page-head']] : []),
  ['grade',       '/site/faculty/grade.html',     '.page-head, .empty-state'],
    ['lessons',     '/site/faculty/lessons.html',   '.page-head, .empty-state'],
  // `.al-list` and not `.page-head`: the whole page is one inline module reading a private
  // Storage bucket, so "it painted a heading" proves almost nothing. The list is the first
  // thing that cannot appear unless the module parsed, the session carried, and the bucket
  // policy admitted this account. It was omitted when the page shipped, and a syntax error in
  // that module went out to the live site the same day — the page served 200 and sat on its
  // spinner, which is precisely the failure this walk exists to catch.
  ['artifacts',   '/site/faculty/artifacts.html', '.al-list'],
  ['admin',       '/site/faculty/admin.html',     '.page-head, .empty-state'],
  // Extensions is a TAB of admin.html since 2026-07-30, reached by ?tab=. Walked as its own entry
  // anyway: it is a distinct panel with its own load and its own render, and the thing this
  // harness catches — a console error on a page that looks fine — is per panel, not per file.
  // `faculty/extensions.html` itself is now a redirect here and is deliberately NOT walked; a
  // page whose whole body is a <script> that leaves would only ever assert the destination twice.
  ['extensions',  '/site/faculty/admin.html?tab=extensions', '.page-head, .empty-state'],
  ['account',     '/site/faculty/account.html',   '.page-head h1'],
  ['system',      '/site/faculty/system.html',    '.page-head, .empty-state'],
  ['help',        '/site/faculty/help.html',      '.page-head, .help-shell, main'],
];
const STUDENT_PAGES = [
  ['dashboard',   '/site/student/dashboard.html', '.page-head, .stat-tile, main'],
  ['lessons',     '/site/student/lessons.html',   '.page-head, .empty-state, main'],
  ['assignments', '/site/student/assignments.html', '.page-head, .empty-state, main'],
  ['account',     '/site/student/account.html',   '.page-head h1'],
  ['help',        '/site/student/help.html',      '.page-head, .help-shell, main'],
];
const PAGES = STUDENT ? STUDENT_PAGES : FACULTY;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();

// One collector, reset per page. `pageerror` is the one that matters most: an uncaught exception
// in a module leaves a half-rendered page that looks like a slow load.
let problems = [];
page.on('console', m => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 300)}`);
  if (m.type() === 'warning' && /prefs|Failed to load/i.test(m.text()))
    problems.push(`console.warn: ${m.text().slice(0, 200)}`);
});
page.on('pageerror', e => problems.push(`UNCAUGHT: ${e.message.slice(0, 300)}`));
page.on('requestfailed', r => {
  // Aborted navigations are how a redirect looks from here, not a failure.
  if (r.failure()?.errorText !== 'net::ERR_ABORTED') {
    problems.push(`request failed: ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`);
  }
});

const results = [];

async function visit(label, path, selector) {
  problems = [];
  const url = BASE + path;
  let status = 'ok', note = '';
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (resp && resp.status() >= 400) { status = 'HTTP'; note = String(resp.status()); }
    // ANY landing somewhere other than the page asked for is a finding, not just a bounce to
    // login. report.html sends you to dashboard.html when it cannot resolve the lesson slug —
    // which looked like a clean pass here until a screenshot showed the dashboard under the
    // label "rollup". A harness that reports a false pass is worse than no harness.
    const landedOn = new URL(page.url()).pathname;
    const askedFor = new URL(url).pathname;
    if (landedOn !== askedFor) {
      status = 'REDIRECTED';
      note = /login\.html$/.test(landedOn)
        ? 'bounced to login — the session did not survive'
        : `sent to ${landedOn.split('/').pop()}`;
    } else if (selector) {
      try { await page.waitForSelector(selector, { timeout: 12000 }); }
      catch { status = 'NO-RENDER'; note = `never showed ${selector}`; }
    }
  } catch (err) {
    status = 'THREW'; note = err.message.slice(0, 160);
  }
  const file = resolve(OUT, `${STUDENT ? 'student' : 'faculty'}-${THEME}-${label}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch { /* nothing to shoot */ }

  results.push({ label, status, note, problems: [...problems] });
  const mark = status === 'ok' && !problems.length ? '  ok  ' : ' FAIL ';
  console.log(`[${mark}] ${label.padEnd(12)} ${status}${note ? ' — ' + note : ''}`);
  problems.forEach(p => console.log(`           ${p}`));
}

/* ── sign in ──────────────────────────────────────────────────────────────── */
console.log(`\nChrome: ${CHROME}`);
console.log(`Theme:  ${THEME}\nOut:    ${OUT}\n`);

await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
// Set the theme the way the app does, before signing in, so every page paints in it from
// first load rather than being corrected mid-walk.
await page.evaluate(t => {
  if (t === 'dark') localStorage.setItem('cp.theme', 'dark');
  else localStorage.removeItem('cp.theme');
}, THEME);

await page.reload({ waitUntil: 'networkidle2' });
// login.html calls the address field `identifier`, not `email` — it accepts a cadet id as well
// as an address, and the name says so.
await page.type('#identifier', EMAIL);
await page.type('#password', PASSWORD);
await Promise.all([
  page.click('#submit'),
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
]);

if (/login\.html/.test(page.url())) {
  const msg = await page.$eval('#msg, .alert, .err', el => el.textContent.trim()).catch(() => '');
  console.error(`\nSign-in failed. ${msg || 'Still on the login page.'}`);
  await browser.close();
  process.exit(1);
}
console.log(`Signed in — landed on ${page.url().replace(BASE, '')}\n`);

for (const [label, path, sel] of PAGES) await visit(label, path, sel);

/* ── report ───────────────────────────────────────────────────────────────── */
const bad = results.filter(r => r.status !== 'ok' || r.problems.length);
console.log(`\n${results.length - bad.length}/${results.length} pages clean · screenshots in ${OUT}`);
if (bad.length) {
  console.log('\nNeeds a look:');
  bad.forEach(r => console.log(`  ${r.label}: ${r.status}${r.note ? ' — ' + r.note : ''}`
    + (r.problems.length ? `\n    ${r.problems.join('\n    ')}` : '')));
}
await browser.close();
process.exitCode = bad.length ? 1 : 0;
