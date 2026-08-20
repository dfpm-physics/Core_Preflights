// gemini-handoff.mjs — drive the mid-lesson handoff chain end to end in a real browser.
//
// WHY THIS EXISTS. The handoff added 2026-08-20 is a chain of THREE links across three files, and
// a break in any one of them looks like success from the outside:
//
//   1. the Claude artifact builds `backup.html?i=<slug>&go=1#h=<lz>`   (patch_artifacts.py)
//   2. the router forwards the hash to the build                       (site/student/backup.html)
//   3. the build decompresses it and restores the conversation         (to_gemini.py step 12)
//
// Drop link 2 or 3 and the cadet still lands in the right lesson — on turn one, with their work
// gone, and nothing anywhere reporting why. That is the failure this exists to catch, so the
// forwarding hop is asserted separately from the restore.
//
// The transcript is compressed IN THE PAGE with the build's own vendored lz-string, not with a
// Node copy. Using a second implementation here would prove that THIS harness and the build agree,
// which is not the question; the codec is contract-pinned (INTERACTION-DATA-CONTRACT §3) and the
// point is that the build reads what the artifact actually writes.
//
// It stops at the start screen. Restoring the conversation into the message list needs a live
// Gemini key, so what is asserted is that the build UNDERSTOOD the payload — the banner, its
// count, and the prefilled name — not that a tutor then answered.
//
//   node tests/browser-harness/gemini-handoff.mjs
//   node tests/browser-harness/gemini-handoff.mjs --chrome "C:/path/to/chrome.exe"

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

// Pick a real build from the manifest the router itself reads, so this cannot drift from what
// ships. The first phys-215 entry is arbitrary but stable.
const manifest = JSON.parse(readFileSync(join(ROOT, 'site/data/backup-builds.json'), 'utf8'));
// { schema, builds: { <slug>: { course, lesson_no, title, path } } } — the slug is the KEY, and
// `path` is relative to site/, because that is where the router resolves it from.
const entries = Object.entries(manifest.builds || {});
const found = entries.find(([, m]) => m.course === 'phys-215') || entries[0];
if (!found) { console.error('no builds in site/data/backup-builds.json'); process.exit(2); }
const [SLUG, BUILD] = found;
const PATH = `site/${BUILD.path}`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
page.on('dialog', d => d.dismiss().catch(() => {}));

console.log(`\n=== handoff chain — ${SLUG} ===`);

// Four visible turns plus one hidden opener, so the banner's count can be told apart from a raw
// array length. A banner that says "5" is counting the machinery the cadet never saw.
const MSGS = [
  { r: 'user', c: 'Begin the session now.', h: true },
  { r: 'assistant', c: 'Welcome. This conversation is governed by the USAFA Honor Code.' },
  { r: 'user', c: 'Ready.' },
  { r: 'assistant', c: 'Good. What happens to the near face of the conductor?' },
  { r: 'user', c: 'It becomes negative because electrons move toward the rod.' },
];
const VISIBLE = MSGS.filter(m => !m.h).length;

await page.goto(`${BASE}/${PATH}`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.LZString, { timeout: 20000 });

const pack = payload => page.evaluate(
  p => window.LZString.compressToEncodedURIComponent(JSON.stringify(p)), payload);

const good = await pack({ v: 1, id: SLUG, mode: 'graded', name: 'Bannister', msgs: MSGS });

const load = async hash => {
  // about:blank first, deliberately. Navigating from `<url>` to `<url>#h=...` differs only in the
  // fragment, so the browser treats it as a SAME-DOCUMENT navigation: no reload, no remount, and
  // the reader effect never runs again. The page would then be judged on the previous hash's
  // result, which reads as a product failure and is not one.
  await page.goto('about:blank');
  await page.goto(`${BASE}/${PATH}${hash}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0,
                             { timeout: 30000 }).catch(() => {});
  // The reader runs in an effect once lz-string resolves, so the banner lands a tick after mount.
  await page.waitForFunction(() => /Picking up where Claude left off/i.test(document.body.innerText),
                             { timeout: 8000 }).catch(() => {});
  return page.evaluate(() => ({
    text: document.body.innerText,
    name: document.querySelector('input:not([type=password])')?.value ?? '',
    boom: !!document.querySelector('#boom')?.textContent.trim(),
    kids: document.querySelector('#root')?.childElementCount ?? -1,
  }));
};

// ── 1. The happy path ─────────────────────────────────────────────────────────
let r = await load(`#h=${good}`);
check('build restored the handoff (banner shown)', /Picking up where Claude left off/i.test(r.text));
check('banner counts VISIBLE turns, not the hidden opener',
      new RegExp(`\\(${VISIBLE} messages\\)`).test(r.text),
      r.text.match(/\(\d+ messages\)/)?.[0] || '(no count)');
check('cadet name prefilled from the handoff', r.name === 'Bannister', `value=${JSON.stringify(r.name)}`);
check('no parse banner with a hash present', !r.boom);

// ── 2. Hostile and mismatched payloads ────────────────────────────────────────
// The hash is entirely under the cadet's control, so none of these may throw, and none may
// half-restore: a partially rebuilt conversation would be graded as if it were whole.
r = await load('#h=not-valid-lz-at-all');
check('malformed hash starts clean instead of crashing',
      !/Picking up where Claude left off/i.test(r.text) && !r.boom && r.kids > 0);

const wrongSlug = await pack({ v: 1, id: 'some-other-lesson-deadbeef', name: 'X', msgs: MSGS });
r = await load(`#h=${wrongSlug}`);
check("another lesson's transcript is refused",
      !/Picking up where Claude left off/i.test(r.text) && r.kids > 0);

const wrongVersion = await pack({ v: 99, id: SLUG, name: 'X', msgs: MSGS });
r = await load(`#h=${wrongVersion}`);
check('an unknown payload version is refused',
      !/Picking up where Claude left off/i.test(r.text) && r.kids > 0);

const empty = await pack({ v: 1, id: SLUG, mode: 'graded', name: 'X', msgs: [] });
r = await load(`#h=${empty}`);
check('an empty transcript is refused', !/Picking up where Claude left off/i.test(r.text));

// Study mode is untimed, ungraded practice. Restoring its transcript into a graded session would
// make it the cadet's graded conversation, and the report would describe work that was never
// graded work. Refusing costs a study cadet only a restart of something nobody was assessing.
const study = await pack({ v: 1, id: SLUG, mode: 'study', name: 'X', msgs: MSGS });
r = await load(`#h=${study}`);
check('a STUDY transcript is refused by a graded build',
      !/Picking up where Claude left off/i.test(r.text) && r.kids > 0);

// ── 3. The forwarding hop — the link most likely to be dropped silently ───────
// backup.html?go=1 must carry location.hash across its redirect. Without this the cadet lands in
// the right lesson having lost everything, and every assertion above still passes.
await page.goto(`${BASE}/site/student/backup.html?i=${encodeURIComponent(SLUG)}&go=1#h=${good}`,
                { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => /Picking up where Claude left off/i.test(document.body.innerText),
                           { timeout: 15000 }).catch(() => {});
const routed = await page.evaluate(() => ({
  url: location.pathname + location.hash.slice(0, 12),
  text: document.body.innerText,
  name: document.querySelector('input:not([type=password])')?.value ?? '',
}));
check('router forwarded to the build', routed.url.includes('/site/gemini/'), routed.url);
check('router preserved the hash across the redirect', routed.url.includes('#h='), routed.url);
check('conversation survived the whole chain',
      /Picking up where Claude left off/i.test(routed.text) && routed.name === 'Bannister');

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
console.log('NOTE: stops at the start screen. Restoring the turns into the message list and');
console.log('      answering the last one needs a live Gemini key, which this cannot supply.');
process.exit(failed ? 1 : 0);
