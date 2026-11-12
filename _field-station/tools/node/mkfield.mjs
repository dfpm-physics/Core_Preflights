// One-off helper: make, publish and later remove ONE staging homework item named "ZZ field ..." through the normal
// director pages, so the cadet-side answer buttons and typeset math can be looked at. Optional developer tooling.
//   node mkfield.mjs create      -> prints the assignment id
//   node mkfield.mjs remove      -> removes the item through the Items page (Remove button)
// Localhost only. Touches only the item whose title starts with "ZZ field".
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const base = 'http://localhost:8045';
const mode = process.argv[2];
const TITLE = 'ZZ field expression';
const seed = readFileSync(join(REPO, 'scripts', 'staging', 'seed_staging.py'), 'utf8');
const s = [...seed.matchAll(/\(\s*"(\w+)",\s*"([A-Za-z]+ [A-Za-z]+)",\s*(True|False)\s*\)/g)].find(x => x[1] === 'director');
const email = 'director@prep-staging.example', pw = s[2].split(' ').pop().toLowerCase() + '1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333' });
const bctx = await browser.createBrowserContext();
const page = await bctx.newPage();
page.on('dialog', d => { console.log('dialog:', d.message().slice(0, 120)); d.accept(); });
await page.setViewport({ width: 1366, height: 850 });
const set = async (sel, v) => { await page.waitForSelector(sel); await page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v); };
const wait = (fn, arg, ms = 25000) => page.waitForFunction(fn, { timeout: ms }, arg);
try {
  await page.goto(`${base}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', email); await page.type('#password', pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  await page.goto(`${base}/site/faculty/items.html`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#new-btn');
  const rowId = () => page.evaluate((t) => {
    const r = [...document.querySelectorAll('#items-table tbody tr')].find(x => x.innerText.includes(t));
    if (!r) return null;
    const q = r.querySelector('a[href*="questions.html?a="]');
    return { a: q ? new URL(q.href).searchParams.get('a') : null, off: r.querySelector('[data-edit]')?.dataset.edit || null };
  }, TITLE);

  if (mode === 'create') {
    if (await rowId().catch(() => null)) throw new Error('a ZZ field item already exists');
    await page.click('#new-btn'); await page.waitForSelector('#item-modal.open');
    await set('#i-title', TITLE); await page.select('#i-kind', 'homework');
    const d = new Date(Date.now() + 2 * 86400000); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await set('#i-alldate', iso);
    await page.click('#im-save');
    await wait(() => document.getElementById('im-note').innerText.length > 0 || getComputedStyle(document.getElementById('im-error')).display !== 'none');
    console.log('note:', await page.$eval('#im-note', e => e.innerText.slice(0, 100)), '| error:', await page.$eval('#im-error', e => getComputedStyle(e).display !== 'none' ? e.innerText.slice(0, 200) : ''));
    await page.goto(`${base}/site/faculty/items.html`, { waitUntil: 'networkidle2' }); await page.waitForSelector('#items-table');
    const ids = await rowId(); console.log('ids', JSON.stringify(ids));
    await page.goto(`${base}/site/faculty/questions.html?a=${ids.a}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#add-btn'); await page.click('#add-btn'); await page.waitForSelector('#q-modal.open');
    await set('#q-qid', 'zz-field-sym1'); await page.select('#q-format', 'symbolic'); await set('#q-points', '1');
    await set('#q-prompt', 'ZZ field: write the kinetic energy of a mass m moving at speed V.');
    await set('#q-expression', 'm*V^2/2'); await set('#q-variables', 'm, V'); await set('#q-try', 'V^2*m/2');
    await page.click('#q-sym-check'); await page.waitForSelector('#q-sym-out .katex', { timeout: 15000 });
    await page.click('#qm-save');
    await wait(() => /zz-field-sym1/.test(document.getElementById('main').innerText) || getComputedStyle(document.getElementById('qm-error')).display !== 'none');
    console.log('question error:', await page.$eval('#qm-error', e => getComputedStyle(e).display !== 'none' ? e.innerText.slice(0, 200) : 'none'));
    await page.goto(`${base}/site/faculty/items.html`, { waitUntil: 'networkidle2' }); await page.waitForSelector('#items-table');
    await page.evaluate((t) => { [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-edit]').click(); }, TITLE);
    await page.waitForSelector('#item-modal.open'); await sleep(600);
    await page.$eval('#i-publish', e => { if (!e.checked) e.click(); }); await page.click('#im-save');
    await wait(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', null, 30000);
    console.log('published; modal error:', await page.$eval('#im-error', e => getComputedStyle(e).display !== 'none' ? e.innerText.slice(0, 200) : 'none'));
    await page.goto(`${base}/site/faculty/items.html`, { waitUntil: 'networkidle2' }); await page.waitForSelector('#items-table');
    console.log('ASSIGNMENT', (await rowId()).a);
  } else if (mode === 'remove') {
    await page.waitForSelector('#items-table');
    const ok = await page.evaluate((t) => { const r = [...document.querySelectorAll('#items-table tbody tr')].find(x => x.innerText.includes(t)); const b = r?.querySelector('[data-remove]'); if (!b) return false; b.click(); return true; }, TITLE);
    console.log('clicked remove:', ok);
    await sleep(6000);
    await page.goto(`${base}/site/faculty/items.html`, { waitUntil: 'networkidle2' }); await page.waitForSelector('#items-table');
    console.log('still listed:', !!(await rowId()));
  }
} finally { await bctx.close(); await browser.disconnect(); }
