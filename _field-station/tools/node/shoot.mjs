// Field Station proof driver. Optional developer tooling; nothing ships with it. Needs Node and puppeteer-core
// installed in this folder (tools/node, git-ignored) and Edge or Chrome. Runs only against http://localhost.
//
// usage (from tools/node):  node ../shoot.mjs --base http://localhost:8045 --who cadet101 --pages dashboard,lessons
//                           --modes light,dark,phone [--out ../../screens] [--audit] [--log file.json]
// The password rule is the seed file's own (staff: last name lower case + 1234; cadet: last 6 of the ID). They are
// computed in memory and never printed. It signs in and views pages; it clicks nothing that writes.

import puppeteer from 'puppeteer-core';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://localhost:8045');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('REFUSED: localhost only.');
const who = arg('who', 'cadet101');
const pages = arg('pages', 'dashboard').split(',');
const modes = arg('modes', 'light').split(',');
const out = arg('out', join(REPO, '_field-station', 'screens'));
const doAudit = process.argv.includes('--audit');
const logFile = arg('log', '');
mkdirSync(out, { recursive: true });

const seed = readFileSync(join(REPO, 'scripts', 'staging', 'seed_staging.py'), 'utf8');
function login() {
  const m = who.match(/^cadet(\d+)$/);
  if (m) return { email: `${who}@prep-staging.example`, pw: (who === 'cadet999' ? '3009999999' : '3000000' + m[1]).slice(-6) };
  const s = [...seed.matchAll(/\(\s*"(\w+)",\s*"([A-Za-z]+ [A-Za-z]+)",\s*(True|False)\s*\)/g)].find(x => x[1] === who);
  if (!s) throw new Error('unknown login');
  return { email: `${who}@prep-staging.example`, pw: s[2].split(' ').pop().toLowerCase() + '1234' };
}
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const role = who === 'none' ? '' : /^cadet/.test(who) ? 'student' : 'faculty';
const PROD = 'shzvpmlnqfmzfmuxkowi';

// Edge is started by hand (see the README) with a debugging port, because launching it from a child process fails on this machine.
const browser = await puppeteer.connect({ browserURL: arg('browser', 'http://127.0.0.1:9333') });
const results = [];
try {
  const bctx = await browser.createBrowserContext();   // clean storage every run, so one person is never signed in as another
  const page = await bctx.newPage();
  const problems = [];
  await page.setRequestInterception(true);
  page.on('request', r => { if (arg('block') && r.url().includes(arg('block'))) { problems.push('blocked ' + r.url().slice(-60)); r.abort(); } else if (r.url().toLowerCase().includes(PROD)) { problems.push('PRODUCTION REQUEST BLOCKED'); r.abort(); } else r.continue().catch(() => {}); });
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url().replace(base, '').slice(0, 90)); });
  page.on('pageerror', e => problems.push('uncaught: ' + String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 160)); });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${String(e.blockedURI).slice(0, 80)}`));
  });

  await page.setViewport({ width: 1366, height: 850 });
  if (who !== 'none') {
    await page.goto(`${base}/site/login.html`, { waitUntil: 'networkidle2' });
    const lg = login();
    await page.type('#identifier', lg.email); await page.type('#password', lg.pw);
    await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
    if (/login\.html/.test(page.url())) throw new Error('sign-in failed');
  }

  for (const mode of modes) {
    const theme = (mode === 'dark' || mode === 'phone-dark') ? 'dark' : 'light';   // set on the page, never in storage: storage is synced to the account's preferences row
    await page.setViewport(mode === 'phone' || mode === 'phone-dark' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : mode === 'tablet' ? { width: 1024, height: 768 } : { width: 1366, height: 850 });
    for (const item of pages) {
      const [label, target] = item.includes('|') ? item.split('|') : [item, item];   // label|url names the screenshot
      const p = label;
      problems.length = 0;
      const url = target.includes('?') || target.includes('.html') ? target : `${target}.html`;
      await page.goto(`${base}/site/${role ? role + '/' : ''}${url}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => problems.push('nav: ' + e.message));
      await page.waitForFunction(() => !document.querySelector('.center-load, .spinner:not(.keep)'), { timeout: 25000 }).catch(() => problems.push('still loading after 25s'));
      if (arg('click')) { await page.evaluate((q) => document.querySelector(q)?.click(), arg('click')); await new Promise(r => setTimeout(r, 400)); }
      if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await new Promise(r => setTimeout(r, 900));
      const name = (arg('tag') ? arg('tag') + '-' : '') + `${role === 'student' ? 's' : role === 'faculty' ? 'f' : 'x'}-${p.replace(/[^a-z0-9]+/gi, '-')}-${mode}`;
      await page.screenshot({ path: join(out, name + '.png'), fullPage: false });
      const audit = await page.evaluate((doAudit) => {
        const r = { csp: window.__csp.slice(0, 5), title: document.title, overflow: document.documentElement.scrollWidth - innerWidth, theme: document.documentElement.getAttribute('data-theme') || 'light' };
        if (!doAudit) return r;
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
        const lum = ({ r, g, b }) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = (el) => { let bg = { r: 255, g: 255, b: 255 }; const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
          for (const e of chain.reverse()) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }; } return bg; };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const sel = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');
        const low = {}, small = {}, clip = {}, wide = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (rect.right > innerWidth + 1 && rect.left < innerWidth && !el.closest('.fs-scroll, .menu-pop, #nav-links')) wide.push(sel(el));
          if (!own) continue;
          const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el); const cr = ratio({ r: fg.r, g: fg.g, b: fg.b }, bg);
          const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
          if (cr < (large ? 3 : 4.5) && cs.opacity !== '0') { const k = sel(el); (low[k] ||= { n: 0, min: 99 }); low[k].n++; low[k].min = Math.min(low[k].min, +cr.toFixed(2)); }
          if (px < 13.5) { const k = sel(el) + ' ' + px + 'px'; small[k] = (small[k] || 0) + 1; }
          if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2) { const k = sel(el); clip[k] = (clip[k] || 0) + 1; }
        }
        r.lowContrast = Object.entries(low).sort((a, b) => a[1].min - b[1].min).slice(0, 8);
        r.small = Object.entries(small).sort((a, b) => b[1] - a[1]).slice(0, 8);
        r.clipped = Object.entries(clip).slice(0, 6); r.beyondViewport = [...new Set(wide)].slice(0, 6);
        return r;
      }, doAudit);
      if (arg('eval')) console.log('EVAL', p, JSON.stringify(await page.evaluate(arg('eval'))).slice(0, 1500));
      results.push({ page: p, mode, shot: name, problems: [...new Set(problems)].slice(0, 6), ...audit });
    }
  }
} finally { try { for (const c of browser.browserContexts()) if (c.id) await c.close(); } catch {} await browser.disconnect(); }
if (logFile) writeFileSync(logFile, JSON.stringify(results, null, 1));
for (const r of results) console.log(`${r.page} ${r.mode}: overflow=${r.overflow} csp=${r.csp.length} problems=${r.problems.length}${r.problems.length ? ' ' + JSON.stringify(r.problems) : ''}${r.csp.length ? ' ' + JSON.stringify(r.csp) : ''}`);
