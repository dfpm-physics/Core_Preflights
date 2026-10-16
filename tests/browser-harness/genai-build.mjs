// genai-build.mjs — render GenAI.mil builds (site/genai/) in a real browser, with the edge
// function MOCKED, and assert the transport edits work.
//
// No AI call and no key: every request to genai-mil-proxy is answered by this script. What it
// proves is the page side — parse, render, no key box, sign-in reaches the function as a Bearer
// token, the 401 and 200 answers land on the start screen, nothing goes to Google, and the
// prompt trimming behaves (probe shorter than report; ?trim=0 identical to the source build).
// It does NOT prove the edge function or GenAI.mil. That needs one live staff turn.
//
//   node tests/browser-harness/genai-build.mjs site/genai/phys-215/<slug>.html [...]

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: genai-build.mjs <site/genai/...html> [...]'); process.exit(2); }

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found.'); process.exit(2); }

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
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});

let passed = 0, failed = 0;
const check = (desc, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
};

// health: 'signedout' -> 401, 'ok' -> 200. session: true installs a fake PREP session token.
async function open(path, { health = 'signedout', session = false, query = '' } = {}) {
  const page = await browser.newPage();
  const seen = { proxy: [], google: 0, errors: [] };
  page.on('pageerror', e => seen.errors.push(String(e.message || e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) seen.errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (/generativelanguage\.googleapis\.com/.test(u)) { seen.google++; return req.abort(); }
    if (/\/functions\/v1\/genai-mil-proxy\//.test(u)) {
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      seen.proxy.push({ url: u, auth: req.headers()['authorization'] || '' });
      if (health === 'ok') {
        return req.respond({ status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ok: true, model: 'gemini-test-model', key_present: true }) });
      }
      return req.respond({ status: 401, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 401, message: 'Sign in to PREP in this browser, then reload this page.' } }) });
    }
    if (/log-tutor-error/.test(u)) return req.respond({ status: 200, headers: cors, body: '{}' });
    req.continue();
  });
  if (session) {
    await page.evaluateOnNewDocument(() => {
      let db;
      Object.defineProperty(window, 'db', {
        configurable: true,
        get() { return db; },
        set(v) {
          v.auth.getSession = async () => ({ data: { session: { access_token: 'TEST-TOKEN' } } });
          db = v;
        },
      });
    });
  }
  await page.goto(base + path + query, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, { timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));   // the connection check is debounced 600 ms
  return { page, seen };
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

const lengths = page => page.evaluate(() => ['probe', 'report', 'extension']
  .map(ph => buildSystemPrompt('X', 'now', ph).length));

for (const t of targets) {
  const rel = t.replace(/\\/g, '/');
  const src = rel.replace('site/genai/', 'site/gemini/');
  console.log(`\n=== ${rel} ===`);

  // 1. Signed out.
  {
    const { page, seen } = await open(rel);
    const s = await page.evaluate(() => ({
      boom: (() => { const b = document.querySelector('#boom'); return b && getComputedStyle(b).display !== 'none' ? b.textContent.slice(0, 200) : ''; })(),
      kids: document.querySelector('#root')?.childElementCount ?? -1,
      keybox: !!document.querySelector('#prep-gkey'),
      text: document.body.innerText,
      title: document.title,
      db: !!window.db,
    }));
    check('parses and renders', !s.boom && s.kids > 0, s.boom);
    check('title starts [GenAI.mil]', s.title.startsWith('[GenAI.mil]'), s.title);
    check('no API key box', !s.keybox);
    check('PREP client loaded (window.db)', s.db);
    check('signed out: badge says not signed in', /GenAI\.mil · not signed in to PREP/.test(s.text));
    check('signed out: start screen says sign in', /not signed in to PREP/.test(s.text.replace(/GenAI\.mil · not signed in to PREP/, '')));
    check('signed out: no Authorization sent', seen.proxy.every(p => !p.auth), JSON.stringify(seen.proxy));
    check('nothing sent to Google', seen.google === 0, String(seen.google));
    check('no page errors', seen.errors.length === 0, seen.errors.slice(0, 2).join(' | '));
    const L = await lengths(page);
    check('trim: probe shorter than report', L[0] < L[1], L.join('/'));
    await page.close();
  }
  // 2. Signed in, function answers.
  {
    const { page, seen } = await open(rel, { health: 'ok', session: true });
    const text = await page.evaluate(() => document.body.innerText);
    check('signed in: Bearer token reaches the function', seen.proxy.length > 0 && seen.proxy.every(p => p.auth === 'Bearer TEST-TOKEN'),
      JSON.stringify(seen.proxy.map(p => p.auth)));
    check('signed in: model line shows the server model', /Tutor model: gemini-test-model/.test(text) || /gemini-test-model/.test(text));
    check('signed in: badge shows model', /GenAI\.mil · gemini-test-model/.test(text));
    check('signed in: no key placeholder saved over the Gemini key',
      await page.evaluate(() => localStorage.getItem('prep.gemini.apikey') === null));
    check('no page errors', seen.errors.length === 0, seen.errors.slice(0, 2).join(' | '));
    await page.close();
  }
  // 3. ?trim=0 must equal the source build, phase by phase.
  {
    const a = await open(rel, { query: '?trim=0' });
    const b = await open(src);
    const La = await lengths(a.page), Lb = await lengths(b.page);
    check('?trim=0 prompt identical in length to source', JSON.stringify(La) === JSON.stringify(Lb), `${La} vs ${Lb}`);
    await a.page.close(); await b.page.close();
  }
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
console.log('NOTE: the edge function is mocked. No GenAI.mil call was made.');
process.exit(failed ? 1 : 0);
