// gemini-finish-bar.mjs — drive a build to the END of a graded session and check what the
// cadet is offered there, in a real browser.
//
// WHY THIS EXISTS. The finish bar (2026-08-21) is the last thing a cadet touches and the one
// control that decides whether their work is graded at all. Nothing else in this repo can see
// it: `gemini-build.mjs` stops at the start screen, and `gemini-model-ladder.mjs` never opens a
// browser. Reaching the report state normally needs a live Gemini key and a ten-minute
// conversation, which is why it went unchecked.
//
// It is reachable WITHOUT a key, because the build restores a saved session from localStorage
// and hands control straight to the cadet when the transcript ends on the tutor's turn. So this
// seeds a finished graded session, stubs the one network call the start screen makes (the model
// listing, which is also the key check), and asserts on the real DOM. No key, no tutor turn, no
// network beyond 127.0.0.1.
//
//   node tests/browser-harness/gemini-finish-bar.mjs [path-to-build.html] [--chrome <exe>]
//
// What it is NOT: a test that the tutor produces a report. It starts from one already produced.
// Per CORE.md §2, a Node-only check is never the sole verification — pair it with a real run.

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--chrome')
  || 'site/gemini/phys-215/lesson-02-electric-charge-coulombic-force-3a8e4e18.html';
if (!existsSync(join(ROOT, target))) { console.error(`no such build: ${target}`); process.exit(2); }

const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

// Read the identity out of the SHIPPED BYTES rather than restating it here. A slug typed into a
// test is a slug that can disagree with the build (PROJECT.md: never type a slug).
const src = readFileSync(join(ROOT, target), 'utf8');
// Whitespace-tolerant on purpose: all five phys-110 builds WRAP the assignment onto a second
// line, so a pattern requiring `= "` on one line reads them as having no slug at all and this
// harness skips 5 of the 38 live builds while reporting success on the rest. That is the same
// too-strict-regex trap PROJECT.md records for check_artifact.py.
const idm = /const INTERACTION_ID\s*=\s*"([^"]+)"/.exec(src);
// TWO shapes, because the five phys-110 builds have no REPORT_MARKER constant at all -- they
// inline the literal into isReportMsg and everywhere else. Reading only the constant skipped
// those five entirely while reporting nothing wrong with the other 33.
const mkm = /const REPORT_MARKER\s*=\s*"([^"]+)"/.exec(src)
         || /function isReportMsg[^)]*\)[^"]*"([^"]+)"/.exec(src);
if (!idm || !mkm) {
  console.error('could not read INTERACTION_ID / REPORT_MARKER from the build.');
  process.exit(2);
}
const [, SLUG] = idm, [, MARKER] = mkm;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let breakLz = false;              // flipped for the second pass, below
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '');
  // The realistic lz-string failure is the file not arriving at all -- a school proxy, an
  // extension, a bad deploy. Reproduced exactly, rather than by stubbing the loader, so the
  // page's own retry-and-report path is what runs.
  if (breakLz && /lz-string/i.test(rel)) { res.writeHead(404); res.end('blocked'); return; }
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/${target.replace(/\\/g, '/')}`;

let pass = 0, fail = 0;
const ok = (d, c, x = '') => { if (c) { pass++; console.log(`  [pass] ${d}`); }
                               else { fail++; console.log(`  [FAIL] ${d}${x ? ` — ${x}` : ''}`); } };

const REPORT = `${MARKER}\n\n**Cadet:** Testcadet\n\nThe cadet worked through all three topics.\n`;
const NAME = 'Testcadet';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

// Seeded before ANY of the page's own script runs, so the build reads it on mount exactly as it
// would read a real cadet's. The fetch stub answers only the model listing — the one call the
// start screen makes, which doubles as the key check. generateContent is deliberately NOT
// stubbed: nothing here should reach it, and a stub would hide it if something did.
function seed(slug, name, report) {
  // The fetch stub goes FIRST and is installed unconditionally. It used to sit after the
  // seed-once guard, so any page that already had a session skipped it, hit the real Google
  // endpoint, never reached connStatus === "ok", and left Start disabled -- which read as the
  // build failing to restore rather than as the harness failing to stub.
  const real = window.fetch;
  window.fetch = (input, init) => {
    const u = String((input && input.url) || input || '');
    if (u.indexOf('/models') > -1 && u.indexOf(':generateContent') === -1) {
      return Promise.resolve(new Response(JSON.stringify({ models: [
        'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite', 'gemini-2.5-flash',
      ].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);   // same-origin assets only; a tutor call would fail loudly
  };
  localStorage.setItem('prep.gemini.apikey', 'AIzaSyTESTKEYNOTREALDONOTUSE0000000000000');
  // evaluateOnNewDocument runs on EVERY navigation, so a reload re-ran this and overwrote the
  // session the page had just stamped. Seed only when there is nothing there, which is also
  // what a real first visit looks like.
  if (localStorage.getItem('prep.gemini.session.' + slug)) return;
  localStorage.setItem('prep.gemini.session.' + slug, JSON.stringify({
    v: 1, id: slug, mode: 'graded', cadetId: name, ts: Date.now(),
    msgs: [
      { role: 'user', hidden: true, content: 'Begin the session now.' },
      { role: 'assistant', content: 'Ready to start?' },
      { role: 'user', content: 'Yes.' },
      { role: 'assistant', content: report },      // ends on the TUTOR, so no request is made
    ],
    activeSec: 600, reportSec: 600, reportPhase: true, extSent: true, payloadTried: true,
    hasReport: true, reportText: report, payloadState: 'ready',
    structured: { schema: 1, effort: 4, overall_understanding: 3 },
  }));
}
await page.evaluateOnNewDocument(seed, SLUG, NAME, REPORT);

console.log(`\n=== finish bar — ${target} ===`);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0,
                           { timeout: 30000 }).catch(() => {});

await page.type('#cadet-id', NAME);
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent));
  return b && !b.disabled;                       // needs the name AND connStatus === 'ok'
}, { timeout: 20000 }).catch(() => {});

// Checked AFTER the name, deliberately: loadSession refuses a graded snapshot whose cadetId
// does not match, so the notice cannot appear on an empty box. That is the design -- one cadet
// must not be shown another's unfinished work on a shared machine -- and it means a cadet only
// learns their work survived once they have typed the same name again.
await page.waitForFunction(
  () => /unfinished session for this lesson/i.test(document.body.innerText),
  { timeout: 10000 }).catch(() => {});
const notice = await page.evaluate(() => document.body.innerText);
ok('the unfinished session is offered once the matching name is typed',
   /unfinished session for this lesson/i.test(notice));
await page.evaluate(() =>
  [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent)).click());
await page.waitForFunction(() => !!document.querySelector('.finish-bar'), { timeout: 20000 })
  .catch(() => {});

const bar = await page.evaluate(() => {
  const el = document.querySelector('.finish-bar');
  if (!el) return null;
  const sub = el.querySelector('.finish-submit'), con = el.querySelector('.finish-continue');
  const r = sub && sub.getBoundingClientRect();
  const composer = document.querySelector('.composer');
  return {
    submitText: sub && sub.textContent.trim(),
    href: sub && sub.getAttribute('href'),
    w: r && Math.round(r.width), h: r && Math.round(r.height),
    fontPx: sub && Math.round(parseFloat(getComputedStyle(sub).fontSize)),
    centered: r ? Math.abs((r.left + r.width / 2) - window.innerWidth / 2) < window.innerWidth * 0.25
                : false,
    continueText: con && con.textContent.trim(),
    aboveComposer: !!(composer && el.compareDocumentPosition(composer)
                      & Node.DOCUMENT_POSITION_FOLLOWING),
    oldLink: !!document.querySelector('.submit-btn'),
  };
});

ok('the finish bar is on screen once the report exists', !!bar);
if (bar) {
  ok('Submit is a LARGE control, not the old 12px footer link',
     bar.fontPx >= 15 && bar.h >= 40, `font=${bar.fontPx}px height=${bar.h}px`);
  ok('Submit is horizontally centred', bar.centered);
  ok('the bar sits ABOVE the composer, so it cannot scroll out of reach', bar.aboveComposer);
  ok('the old footer submit link is gone', !bar.oldLink);
  ok('Continue is offered beside it', /keep talking/i.test(bar.continueText || ''),
     bar.continueText || 'absent');

  // The submit URL is the contract. A wrong one fails SILENTLY: the cadet sees a success page
  // and the report goes nowhere.
  const h = bar.href || '';
  ok('submit URL carries the frozen contract keys', /#t=interaction/.test(h) && /&i=/.test(h)
     && /&r=/.test(h) && /&d=/.test(h));
  ok('submit URL names the slug from the build', h.indexOf(SLUG) > -1);
  ok('transport marker says gemini', /[#&]v=gemini/.test(h));
  ok('transport marker does NOT also say claude — one v= key, not two',
     !/[#&]v=claude/.test(h), h.slice(0, 160));
}

// Continue is the destructive-looking half: it removes the submit control. It must warn, and
// the graded snapshot must survive so the report is recoverable.
page.on('dialog', async d => { await d.accept(); });
const before = await page.evaluate(s => localStorage.getItem('prep.gemini.session.' + s), SLUG);
await page.evaluate(() => document.querySelector('.finish-continue').click());
await page.waitForFunction(() => !document.querySelector('.finish-bar'), { timeout: 10000 })
  .catch(() => {});

const after = await page.evaluate(() => ({
  bar: !!document.querySelector('.finish-bar'),
  text: document.body.innerText,
  saved: localStorage.getItem('prep.gemini.session.' + window.__slug),
}));
ok('Continue removes the submit control', !after.bar);
ok('Continue lands in study mode', /study mode/i.test(after.text));

// Typed a message after the switch: the snapshot effect runs on every settled message, so this
// is where an unguarded save would overwrite the graded record.
await page.type('.composer textarea', 'one more question');
await page.waitForFunction(() => true);
const stillThere = await page.evaluate(s => localStorage.getItem('prep.gemini.session.' + s), SLUG);
ok('the GRADED snapshot survives the switch — the report stays recoverable by reload',
   !!stillThere && stillThere === before,
   stillThere ? (stillThere === before ? '' : 'overwritten by the study session') : 'deleted');

const missing = notFound.filter(u => !/favicon/i.test(u));
ok('no missing resources (404)', missing.length === 0, missing.join(', '));
const real = pageErrors.filter(e =>
  !/favicon/i.test(e) && !(missing.length === 0 && /Failed to load resource/i.test(e)));
ok('no page/console errors', real.length === 0, real.slice(0, 2).join(' | '));

// ── Second pass: submitting must not destroy the way back ───────────────────
// clearSession() used to fire on the click, BEFORE the receiver validated anything -- and the
// receiver's own rejection copy says "Re-open the interactive lesson and submit again from the
// finish screen", which that erasure made impossible.
console.log('\n--- submit stamps the session instead of erasing it ---');
breakLz = false;
const p3 = await browser.newPage();
await p3.evaluateOnNewDocument(seed, SLUG, NAME, REPORT);
await p3.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await p3.type('#cadet-id', NAME);
await p3.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent));
  return b && !b.disabled;                       // needs the name AND connStatus === 'ok'
}, { timeout: 30000 }).catch(() => {});
await p3.evaluate(() =>
  [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent)).click());
await p3.waitForFunction(() => !!document.querySelector('.finish-submit'), { timeout: 20000 })
  .catch(() => {});

// Capture-phase preventDefault stops the navigation; React's onClick is delegated at the root
// and still runs, which is exactly the handler under test.
const p3state = await p3.evaluate(() => ({
  bar: !!document.querySelector('.finish-bar'),
  submit: !!document.querySelector('.finish-submit'),
  wait: !!document.querySelector('.finish-wait'),
  started: !!document.querySelector('.composer'),
  saved: !!localStorage.getItem(Object.keys(localStorage).find(k => k.indexOf('session') > -1) || ''),
  text: document.body.innerText.slice(0, 300),
}));
ok('the restored session reaches the finish bar with a live submit link', p3state.submit,
   JSON.stringify(p3state));
if (p3state.submit) await p3.evaluate(() => {
  document.addEventListener('click', (e) => e.preventDefault(), true);
  document.querySelector('.finish-submit').click();
});
const stamped = await p3.evaluate(s => {
  const raw = localStorage.getItem('prep.gemini.session.' + s);
  return { present: !!raw, submitted: raw ? !!JSON.parse(raw).submitted : false,
           msgs: raw ? (JSON.parse(raw).msgs || []).length : 0 };
}, SLUG);
ok('the session SURVIVES the submit click — the receiver can still send them back',
   stamped.present, 'erased');
ok('and it carries the whole transcript, not a stub', stamped.msgs >= 2, `${stamped.msgs} messages`);
ok('the snapshot is stamped submitted', stamped.submitted);

// Reloading is what a cadet does when the receiver turns them away. The old behaviour offered
// finished work back as "unfinished"; that is the one thing clearing it bought, and the flag
// has to buy it instead or this trade is not worth making.
await p3.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await p3.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0,
                         { timeout: 30000 }).catch(() => {});
await p3.type('#cadet-id', NAME);
await p3.waitForFunction(() => /already submitted/i.test(document.body.innerText), { timeout: 15000 })
  .catch(() => {});
const back = await p3.evaluate(() => document.body.innerText);
ok('coming back says "already submitted", not "unfinished session"',
   /already submitted/i.test(back) && !/unfinished session/i.test(back));

// ── Fourth pass: lz-string never arrives ───────────────────────────────────
// Without it there is no submit URL at all, because the URL *is* the report compressed into a
// hash. The old loader gave up after 10s and recorded nothing, so the cadet got a finished
// report beside a dead "Preparing submit" with no error and nothing to do. What is asserted
// here is that the page now SAYS so.
console.log('\n--- lz-string withheld (404) ---');
breakLz = true;
const p2 = await browser.newPage();
const t0 = Date.now();
await p2.evaluateOnNewDocument((slug, name, report) => {
  localStorage.setItem('prep.gemini.apikey', 'AIzaSyTESTKEYNOTREALDONOTUSE0000000000000');
  localStorage.setItem('prep.gemini.session.' + slug, JSON.stringify({
    v: 1, id: slug, mode: 'graded', cadetId: name, ts: Date.now(),
    msgs: [{ role: 'user', hidden: true, content: 'Begin.' },
           { role: 'assistant', content: report }],
    activeSec: 600, reportSec: 600, reportPhase: true, extSent: true, payloadTried: true,
    hasReport: true, reportText: report, payloadState: 'ready',
    structured: { schema: 1, effort: 4 },
  }));
  const real = window.fetch;
  window.fetch = (input, init) => {
    const u = String((input && input.url) || input || '');
    if (u.indexOf('/models') > -1 && u.indexOf(':generateContent') === -1) {
      return Promise.resolve(new Response(JSON.stringify({ models: [
        'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
      ].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);
  };
}, SLUG, NAME, REPORT);
await p2.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await p2.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0,
                         { timeout: 30000 }).catch(() => {});
await p2.type('#cadet-id', NAME);
await p2.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent));
  return b && !b.disabled;                       // needs the name AND connStatus === 'ok'
}, { timeout: 20000 }).catch(() => {});
await p2.evaluate(() =>
  [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent)).click());
await p2.waitForFunction(
  () => /could not load the small file/i.test(document.body.innerText), { timeout: 45000 })
  .catch(() => {});
const broke = await p2.evaluate(() => ({
  text: document.body.innerText,
  submit: !!document.querySelector('.finish-submit'),
  bar: !!document.querySelector('.finish-bar'),
}));
const elapsed = Date.now() - t0;
ok('the finish bar still appears — the report is not hidden by a transport failure', broke.bar);
ok('no submit link is offered, because none can be built', !broke.submit);
ok('the cadet is TOLD, instead of watching a dead control',
   /could not load the small file/i.test(broke.text));
ok('it says the report is safe and names the remedy',
   /report is safe/i.test(broke.text) && /reload the page/i.test(broke.text));
// Three attempts settle on the tag's own onerror. If this ever regresses to waiting on the
// 40s-per-attempt timer, the elapsed time is what shows it.
ok('the three attempts settle fast, on onerror rather than on the timeout',
   elapsed < 40000, `${Math.round(elapsed / 1000)}s`);

// ── Third pass: the scripted opening greets before it asks ────────────────
// Only where the app delivers the opening at all. A legacy build has the model write it, so
// there is nothing here to check and the pass is skipped rather than failed.
if (src.includes('const APP_OPENING = true')) {
  console.log('\n--- the scripted opening (APP_OPENING build) ---');
  // Explicit: this pass runs after the one that withholds lz-string, and the scripted turns
  // do not need lz at all. Passing with it still broken would be luck, not a result.
  breakLz = false;
  const p4 = await browser.newPage();
  await p4.evaluateOnNewDocument(seed, SLUG, NAME, REPORT);
  // A FRESH graded session: clear the seeded one so the opening actually runs.
  await p4.evaluateOnNewDocument(s => localStorage.removeItem('prep.gemini.session.' + s), SLUG);
  await p4.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await p4.type('#cadet-id', NAME);
  await p4.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent));
    return b && !b.disabled;                       // needs the name AND connStatus === 'ok'
  }, { timeout: 30000 }).catch(() => {});
  await p4.evaluate(() =>
    [...document.querySelectorAll('button')].find(x => /Start Preflight/i.test(x.textContent)).click());
  await p4.waitForFunction(() => /Honor Code/i.test(document.body.innerText), { timeout: 20000 })
    .catch(() => {});
  ok('turn one is the Honor Code reminder', /Honor Code/i.test(await p4.evaluate(() => document.body.innerText)));

  await p4.type('.composer textarea', 'ready');
  await p4.evaluate(() =>
    [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Send').click());
  await p4.waitForFunction(() => /interesting or difficult/i.test(document.body.innerText),
                           { timeout: 20000 }).catch(() => {});
  const open2 = await p4.evaluate(() => document.body.innerText);
  // The lesson name is read from the build, so read it the same way here rather than typing it.
  const tm = /<div className="title">([^<]*)<\/div>/.exec(src);
  const lesson = tm ? tm[1].replace(/&mdash;|&amp;/g, '').trim() : '';
  const word = (lesson.match(/[A-Za-z]{4,}/g) || ['Lesson']).slice(-1)[0];
  ok('turn two GREETS — it says welcome, which the bare question did not',
     /welcome to/i.test(open2));
  ok(`turn two names the lesson (looked for "${word}" from the build's own header)`,
     open2.indexOf(word) > -1);
  ok('turn two still asks the verbatim question, last',
     /interesting or difficult in the reading/i.test(open2));
  ok('both scripted turns cost no tutor request — no error bar appeared',
     !/did not answer|rejected that request|empty answer/i.test(open2));
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
console.log('NOTE: starts from a seeded report — it does not prove the tutor can produce one.');
process.exit(fail ? 1 : 0);
