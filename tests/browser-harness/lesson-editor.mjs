// lesson-editor.mjs — the Assignments page and its editor, signed in, in a real browser.
//
// WHY THIS EXISTS
//   Everything on the lesson editor that broke on 2026-07-30 broke in ways no offline suite could
//   see, and every one of them was reported by the director rather than caught here: the
//   interaction URL required when nothing could reach it, the reading reflection authored as the
//   reading-time question, hold-to-delete cancelling on a one-pixel drift, a modal that threw the
//   form away when a text selection ended outside it, and an empty AI Interaction attached to a
//   written-only lesson and then advertised on its card. The pattern is not that the logic was
//   wrong — most of it was unit-tested — it is that nobody had OPENED the page.
//
//   modal.mjs proves the dismissal rule with synthetic markup; this proves the shipped page is
//   wired to it, with the real dialog, the real stylesheet and a real session.
//
// READ-ONLY. It opens the editor and cancels. It never clicks Save, never publishes, and never
// deletes — the account is a live director on the live database (CORE.md §0).
//
// Requires a local server:  python -m http.server 8000   (from the repo root)
// Credentials come from supabase/admin/.env (PREP_TEST_FACULTY_*), as in checks.mjs.
//
// Usage:  node tests/browser-harness/lesson-editor.mjs [--base http://localhost:8000]

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
if (!EMAIL || !PASSWORD) {
  console.error('No faculty credentials. Set PREP_TEST_FACULTY_* in supabase/admin/.env.');
  process.exit(2);
}
const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};
const section = t => console.log(`\n=== ${t} ===`);
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();

// Any confirm() the editor raises is answered here. Recorded so the dirty-guard assertions can
// tell "asked and I said stay" from "never asked".
let lastDialog = null;
page.on('dialog', async (d) => { lastDialog = d.message(); await d.dismiss(); });

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
await page.type('#identifier', EMAIL);
await page.type('#password', PASSWORD);
await Promise.all([
  page.click('#submit'),
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
]);
if (/login\.html/.test(page.url())) { console.error('Sign-in failed.'); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/site/faculty/lessons.html`, { waitUntil: 'networkidle2' });
await wait(1800);

/* ── The card, before opening anything ────────────────────────────────────── */
section('the Assignments list renders');

const cards = await page.$$eval('.card', els => els.length).catch(() => 0);
check('the page rendered assignment cards', cards > 0, `saw ${cards}`);

// The badge is the director's report: a green ✓ AI Interaction on a lesson that has none. Every
// badge on the page must agree with the Launch button beside it on the same card.
const badgeAgreement = await page.$$eval('.card', (els) => els.map((c) => {
  // The COMPONENT badge, by its ✓/—/⚠ prefix. Matching on the words alone picks the POLICY badge
  // instead on any interaction-only lesson, where the mode is itself labelled "AI Interaction" —
  // and that badge carries no state class, so every assertion below silently passed on it.
  const badge = [...c.querySelectorAll('.score-badge')]
    .find(b => /^\s*[✓—⚠]\s*AI Interaction/.test(b.textContent));
  if (!badge) return null;
  const launch = [...c.querySelectorAll('a,button')]
    .find(b => /Launch interaction/.test(b.textContent));
  const green = badge.classList.contains('full');
  const amber = badge.classList.contains('partial');
  const grey  = badge.classList.contains('pending');
  // TWO shapes are launchable since 2026-08-21. Launch opens the Gemini build through the
  // relative router path where one exists, and falls back to the absolute claude.ai artifact
  // where it does not. Testing only for http(s) read five healthy phys-110 cards as
  // green-but-broken -- the harness being out of date, not the page.
  const href = launch ? (launch.getAttribute('href') || '') : '';
  const viaRouter = /^\.\.\/student\/backup\.html\?i=/.test(href);
  const launchable = !!launch && launch.tagName === 'A'
    && (viaRouter || /^https?:/i.test(href));
  return { green, amber, grey, hasLaunch: !!launch, launchable, viaRouter, href,
           title: (c.querySelector('.card-title')?.textContent || '').trim() };
}).filter(Boolean));

check(`every card carries an AI Interaction badge (${badgeAgreement.length} of ${cards})`,
      badgeAgreement.length === cards, 'a card rendered without one — the selector or the card changed');
check('every badge carries exactly one state class',
      badgeAgreement.every(b => [b.green, b.amber, b.grey].filter(Boolean).length === 1));
const lying = badgeAgreement.filter(b => b.green && !b.launchable);
check('no card shows a green AI Interaction it cannot launch — the reported bug',
      lying.length === 0, lying.map(b => b.title).join('; '));
const silentAmber = badgeAgreement.filter(b => b.amber && b.launchable);
check('no card shows amber for an interaction that IS launchable', silentAmber.length === 0);
const greyWithLaunch = badgeAgreement.filter(b => b.grey && b.hasLaunch);
check('a lesson with no interaction offers no Launch button at all', greyWithLaunch.length === 0);
console.log(`         badges: ${badgeAgreement.filter(b => b.green).length} green, `
  + `${badgeAgreement.filter(b => b.amber).length} amber, ${badgeAgreement.filter(b => b.grey).length} none`);

/* -- Launch opens the Gemini build, through the router --------------------- */
section('Launch agrees with the backup manifest');

// Until 2026-08-21 this card carried Launch (claude.ai) with a separate "Backup ↗" beside it.
// That is now one control: free-tier Claude was timing cadets out, so Launch opens the Gemini
// build wherever one exists -- the same page the cadet gets -- and the second button is gone.
//
// The invariant the old section protected survives and is asserted here instead: the link must
// go through the ROUTER, because which build a slug resolves to is allowed to change and only
// `student/backup.html` may know it. A card pointing straight at `gemini/<course>/<slug>.html`
// would keep working right up until a build was renamed.
const manifest = await (await fetch(`${BASE}/site/data/backup-builds.json`)).json()
  .catch(() => ({ builds: {} }));
const known = new Set(Object.keys(manifest.builds || {}));

const routed = badgeAgreement.filter(b => b.viaRouter);
check(`at least one lesson launches its Gemini build (${routed.length} of ${badgeAgreement.length} cards)`,
      routed.length > 0,
      'no card launches through the router - is site/data/backup-builds.json reachable?');
check('every routed Launch goes through student/backup.html, never at a build path',
      routed.every(b => !/gemini\//.test(b.href)),
      routed.map(b => b.href).filter(h => /gemini\//.test(h)).join('; '));
// A link to a slug the manifest does not carry is a "no build for this lesson" page dressed up
// as a working one - the confident-wrong claim loadBackups()'s error channel exists to prevent.
const unknown = routed.filter(b => !known.has(decodeURIComponent((b.href || '').split('?i=')[1] || '')));
check('every routed Launch names a slug the manifest actually carries',
      unknown.length === 0, unknown.map(b => b.title).join('; '));
// The retired button must stay retired: two controls opening the same URL is what this replaced.
const stillBackup = await page.$$eval('.card', els =>
  els.filter(c => [...c.querySelectorAll('a,button')]
    .some(b => /^Backup/.test((b.textContent || '').trim()))).length);
check('the separate Backup button is gone — Launch opens that page now', stillBackup === 0,
      `${stillBackup} cards still render one`);

/* ── A NEW assignment ─────────────────────────────────────────────────────── */
section('a new assignment starts written-only');

const newBtn = await page.$('#new-btn');
check('the + New assignment button is present (director tier)', !!newBtn);
if (!newBtn) { await browser.close(); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }

await newBtn.click();
await wait(600);
check('the editor opened', await page.$eval('#lesson-modal', el => el.classList.contains('open')));

const seg = async (sel) => page.$eval(sel, el => el.getAttribute('aria-pressed'));
check('AI Interaction defaults to "Not this term"', await seg('#f-i-source [data-isrc="none"]') === 'true');
check('the written questions default to included', await seg('#f-pf-source [data-pfsrc="new"]') === 'true');
check('the interaction fields are hidden while it is excluded',
      await page.$eval('#lb-i-new', el => getComputedStyle(el).display) === 'none');

// Both pinned questions on by default, and the reflection is NOT sitting in the reading-time slot
// — the defect the director reported as "the reading reflection is showing up in Q1".
check('both pinned questions default to on',
      await page.$eval('#f-q-readtime', el => el.checked) === true
      && await page.$eval('#f-q-reflection', el => el.checked) === true);
const pinnedText = await page.$$eval('.lb-qbadge.reflection', els => els.map(e => e.textContent.trim()));
check('the editor labels a reading-time question AND a reading-reflection question, distinctly',
      pinnedText.some(t => /Reading time/i.test(t)) && pinnedText.some(t => /Reading reflection/i.test(t)),
      pinnedText.join(' | '));

/* ── The dismissal rule, on the shipped dialog ────────────────────────────── */
section('the editor survives a text selection that ends outside it');

const box = await page.$eval('#lesson-modal .modal', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const title = await page.$('#f-title');
await title.click();
await page.keyboard.type('Harness scratch — never saved');

// The reported gesture: press inside, drag past the edge, release on the backdrop.
const tb = await title.boundingBox();
await page.mouse.move(tb.x + 20, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(box.x - 60, tb.y + tb.height / 2);
await page.mouse.up();
await wait(300);
check('drag-select from a field, release on the backdrop -> editor stays open',
      await page.$eval('#lesson-modal', el => el.classList.contains('open')));
check('the typed title survived',
      (await page.$eval('#f-title', el => el.value)).includes('Harness scratch'));

// And the guard: a real dismissal of dirty work asks first.
lastDialog = null;
await page.keyboard.press('Escape');
await wait(400);
check('Escape on a dirty editor asks before discarding', /Discard/i.test(lastDialog || ''), `dialog="${lastDialog}"`);
check('answering "cancel" keeps the editor open',
      await page.$eval('#lesson-modal', el => el.classList.contains('open')));

/* ── Including the interaction ────────────────────────────────────────────── */
section('including the AI Interaction');

await page.click('#f-i-source [data-isrc="new"]');
await wait(400);
check('the interaction section expands when it is included',
      await page.$eval('#lb-i-new', el => getComputedStyle(el).display) !== 'none');
const urlLabel = await page.$eval('#f-i-url-label', el => el.textContent.trim()).catch(() => '');
check('under Free-Response the URL is labelled optional', /optional/i.test(urlLabel), urlLabel);

// Choice makes it reachable by a student, so the label must flip to required.
await page.click('#f-policy [data-policy="choice"]');
await wait(300);
const urlLabel2 = await page.$eval('#f-i-url-label', el => el.textContent.trim()).catch(() => '');
check('choosing a mode students can reach makes the URL required', /required/i.test(urlLabel2), urlLabel2);

/* ── Out, without writing anything ────────────────────────────────────────── */
section('leaving the editor');

page.removeAllListeners('dialog');
page.on('dialog', async d => { await d.accept(); });     // yes, discard — nothing here may be saved
await page.click('#lesson-modal [data-close]');
await wait(600);
check('the editor closes when the discard is confirmed',
      await page.$eval('#lesson-modal', el => !el.classList.contains('open')));

check('no uncaught page errors during the walkthrough', pageErrors.length === 0,
      pageErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
