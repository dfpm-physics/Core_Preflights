// backup-link.mjs — browser verification for the Gemini backup link on the student lesson page.
//
// THE CLAIM UNDER TEST, in the course director's words: the backup option "should still follow the
// same rules for whether or not it is visible as the claude artifact link." That is a PARITY
// claim, and parity is exactly the kind of thing that is true on the day it ships and false three
// edits later — so it is asserted here as a matrix rather than as one happy-path render.
//
// Three parts, none of which needs an account:
//
//   PART 1  Both edited files still PARSE and load. `student-lessons.js` is a real module and
//           `node --check` covers it, but the lesson page's logic lives in a
//           `<script type="module">` block where a syntax error is invisible to every offline
//           check and takes the whole page down at runtime.
//
//   PART 2  The parity matrix, driven against the REAL renderers. studyBlock/choiceBlock/backupLine
//           are lifted out of lessons.html by name (as release-window.mjs lifts from the faculty
//           editor) so there is no second copy of the logic to drift out of step. Every cell of
//           (interactiveAvailable x backupHref) is rendered and the two controls are compared.
//
//   PART 3  The manifest path resolves FROM THE PAGE THAT WILL REQUEST IT. `student-lessons.js`
//           fetches `../data/backup-builds.json`, and a relative fetch in a module resolves
//           against the DOCUMENT, not the module — so the only honest test is to ask the document.
//           A wrong path here fails silently by design (loadBackupBuilds swallows it and returns
//           no builds), which means no link would ever appear and nothing would say why.
//
// Usage: node tests/browser-harness/backup-link.mjs [--chrome <path>]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PORT = 8733;

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found.'); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
};

const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

/* ── PART 1 — the edited pages parse and load clean ───────────────────────────────────── */
console.log('\n=== edited pages parse and load ===');

const PAGES = ['site/student/lessons.html', 'site/student/dashboard.html'];

for (const path of PAGES) {
  const page = await browser.newPage();
  const fatal = [];
  page.on('pageerror', (e) => {
    // Only PARSE/reference failures matter. Without a session these pages redirect to login and
    // auth noise is expected; a SyntaxError never is.
    const m = String(e);
    if (/SyntaxError|ReferenceError|TypeError: .* is not a function/.test(m)) fatal.push(m);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /SyntaxError|is not defined/.test(m.text())) fatal.push(m.text());
  });
  await page.goto(`http://localhost:${PORT}/${path}`, { waitUntil: 'networkidle2', timeout: 30000 })
    .catch(() => {});
  await new Promise(r => setTimeout(r, 700));
  check(`${path} — no parse/reference error`, fatal.length === 0, fatal.join(' | '));
  await page.close();
}

/* ── PART 2 — the parity matrix, against the real renderers ───────────────────────────── */
console.log('\n=== backup link vs Claude link: visibility parity ===');

const SRC = readFileSync(`${REPO}/site/student/lessons.html`, 'utf8');

/** Lift a top-level `function name(...) {...}` out of the page's inline module by brace matching. */
function lift(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`lessons.html no longer defines ${name}() — this test is out of date.`);
  let i = SRC.indexOf('(', start), parens = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '(') parens++;
    else if (SRC[i] === ')' && --parens === 0) break;
  }
  let depth = 0;
  for (let j = SRC.indexOf('{', i); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}

// The wiring is lifted as TEXT rather than run: what matters is that every id the renderers emit
// is an id `wire()` binds. An unbound button is a control that renders perfectly and does nothing,
// which is the failure mode a render-only assertion cannot see.
const WIRE = lift('wire');

const page = await browser.newPage();
page.on('pageerror', e => console.log('  !! page error:', String(e)));
await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');

const matrix = await page.evaluate(`(() => {
  const esc = (s) => String(s == null ? '' : s);
  const STATE = { DRAFT: 'draft', NOT_STARTED: 'not-started' };
  const writtenHref = () => 'assignments.html?a=stub';

  ${lift('backupLine')}
  ${lift('studyBlock')}
  ${lift('choiceBlock')}

  const host = document.getElementById('host');

  // One lesson, varied only in the two fields under test. Everything else is held constant so a
  // difference in the output can only have come from them.
  const base = {
    hasInteraction: true, interactiveGraded: true, policy: 'choice',
    state: STATE.NOT_STARTED, points: 2, writtenAnswerCount: 0, completion: null,
    preflight: { questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] },
    interactiveGateReason: 'after the due date',
  };

  const HREF = 'backup.html?i=lesson-09-electric-potential-difference-b3ba716f';

  function probe(html, launchId, backupId) {
    host.innerHTML = html;
    const launch = host.querySelector('#' + launchId);
    const backup = host.querySelector('#' + backupId);
    // A DISABLED launch is not a launch. The whole point of the rule is that the backup must not
    // appear beside a control the student cannot use.
    return {
      liveLaunch: !!launch && !launch.disabled,
      anyLaunch: !!host.querySelector('button.btn-secondary'),
      backup: !!backup,
      backupHref: backup ? backup.getAttribute('data-href') : null,
      backupIsButton: !!backup && backup.tagName === 'BUTTON',
    };
  }

  const out = [];
  for (const available of [true, false]) {
    for (const href of [HREF, null]) {
      const l = Object.assign({}, base, { interactiveAvailable: available, backupHref: href });
      out.push({ block: 'studyBlock', available, hasBuild: !!href,
                 ...probe(studyBlock(l), 'study-btn', 'study-backup') });
      out.push({ block: 'choiceBlock', available, hasBuild: !!href,
                 ...probe(choiceBlock(l), 'choice-launch', 'choice-backup') });
    }
  }

  // The non-choice branch of choiceBlock: written-first, interactive gated behind submitting.
  // Its Launch is ALWAYS disabled, so the backup must never appear there however many builds
  // exist — this is the cell most likely to regress, because backupHref is perfectly valid.
  const gated = Object.assign({}, base, {
    policy: 'preflight', interactiveAvailable: true, backupHref: HREF,
  });
  out.push({ block: 'choiceBlock/non-choice', available: false, hasBuild: true,
             ...probe(choiceBlock(gated), 'choice-launch', 'choice-backup') });

  // And the gated studyBlock, whose disabled card is a separate early return.
  const gatedStudy = Object.assign({}, base, { interactiveAvailable: false, backupHref: HREF });
  out.push({ block: 'studyBlock/gated', available: false, hasBuild: true,
             ...probe(studyBlock(gatedStudy), 'study-btn', 'study-backup') });

  return out;
})()`);

for (const r of matrix) {
  const expected = r.liveLaunch && r.hasBuild;
  check(
    `${r.block}: available=${r.available} build=${r.hasBuild} → launch=${r.liveLaunch} backup=${r.backup}`,
    r.backup === expected,
    `expected backup=${expected}`,
  );
}

// The two claims the matrix is really making, stated once so a failure names the rule.
check('backup NEVER renders without a live Claude launch beside it',
  matrix.every(r => !r.backup || r.liveLaunch));
check('backup ALWAYS renders when a live launch and a build are both present',
  matrix.every(r => !(r.liveLaunch && r.hasBuild) || r.backup));

/* ── the ids the renderers emit are the ids wire() binds ──────────────────────────────── */
for (const id of ['study-backup', 'choice-backup']) {
  check(`wire() binds #${id}`, WIRE.includes(`'${id}'`),
    'the control renders but nothing listens to it');
}
check('wire() routes both backup ids through launchBackup',
  (WIRE.match(/launchBackup\(l\)/g) || []).length === 2);

// The backup must inherit the switch-to-interactive warning: it commits the student exactly as the
// Claude version does. A launchBackup that called window.open directly would silently cost a cadet
// their saved written answers.
const LAUNCH_BACKUP = lift('launchBackup');
check('launchBackup goes through confirmInteractiveLaunch',
  LAUNCH_BACKUP.includes('confirmInteractiveLaunch(l)'),
  'a backup launch would skip the "your written answers stop counting" warning');

await page.close();

/* ── PART 3 — the manifest path resolves from the page that requests it ───────────────── */
console.log('\n=== manifest path, resolved from site/student/ ===');

// Asked from `backup.html` rather than from `lessons.html`, for a reason worth stating: signed
// out, lessons.html REDIRECTS to login, and a relative fetch then resolves against the login
// page's directory instead — which 404s and would report a path bug that does not exist.
// backup.html is in the same directory, requires no auth by design, and already fetches this
// exact path, so it answers the real question without the redirect in the way.
const SAMPLE_SLUG = Object.keys(
  JSON.parse(readFileSync(`${REPO}/site/data/backup-builds.json`, 'utf8')).builds,
)[0];

const p3 = await browser.newPage();
await p3.goto(`http://localhost:${PORT}/site/student/backup.html?i=${SAMPLE_SLUG}`,
  { waitUntil: 'networkidle2' }).catch(() => {});
check('backup.html did not redirect', p3.url().includes('/site/student/backup.html'), p3.url());

const manifest = await p3.evaluate(async () => {
  try {
    const res = await fetch('../data/backup-builds.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, why: 'HTTP ' + res.status };
    const doc = await res.json();
    return { ok: true, count: Object.keys(doc.builds || {}).length, url: res.url };
  } catch (e) { return { ok: false, why: String(e) }; }
});
check('../data/backup-builds.json resolves from site/student/', manifest.ok, manifest.why || '');
check('manifest carries builds', (manifest.count || 0) > 0, `count=${manifest.count}`);
if (manifest.ok) console.log(`         resolved to ${manifest.url.split('?')[0]} — ${manifest.count} builds`);

// The destination the link actually lands on: the router resolved the slug to a build rather than
// falling through to "no backup for this lesson yet". A link that renders and dead-ends is worse
// than no link, because the cadet clicking it has already been failed once.
const landed = await p3.evaluate(() => ({
  text: document.body.innerText.slice(0, 400),
  hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
}));
check('backup.html resolved the slug to a build',
  !/No backup for this lesson/i.test(landed.text) && landed.hrefs.some(h => /gemini\//.test(h)),
  landed.text.replace(/\s+/g, ' ').slice(0, 160));
await p3.close();

/* ── done ─────────────────────────────────────────────────────────────────────────────── */
await browser.close();
server.kill();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
