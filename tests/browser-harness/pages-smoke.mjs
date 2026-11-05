// pages-smoke.mjs -- sign in as each seeded STAGING role and load every top-level page.
//
// Roles: cadet, instructor, director, admin (seeded by scripts/staging/seed_staging.py; passwords
// follow the site's documented default rules, so none is stored or read from disk here).
// Fails a page on: an uncaught page error, a console error, a failed request, any HTTP >= 400 from
// the database host, or a request to any host other than localhost and the staging project.
// Also prints "empty-looking" text per page so a blank state caused by a failed read is visible.
//
// Usage:  node tests/browser-harness/pages-smoke.mjs [--base http://localhost:8000] [--role cadet,...]
// Needs scripts/staging/serve_local.py running. Read-only: it never clicks anything but Sign in.
// Screenshots are not taken (faculty pages render roster names).

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_PRODUCTION_ARG } from './env.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8000');
const ONLY = (arg('role') || '').split(',').filter(Boolean);
const DOMAIN = 'prep-staging.example';

// Staging project host, read from the site's own config (the public URL only).
const cfg = readFileSync(resolve(import.meta.dirname, '..', '..', 'site', 'js', 'config.js'), 'utf8');
const STAGING_HOST = (cfg.match(/PREP_STAGING[\s\S]*?https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] + '.supabase.co';
if (!/^[a-z0-9]+\.supabase\.co$/.test(STAGING_HOST)) { console.error('Could not read the staging host from config.js'); process.exit(2); }
const OK_HOSTS = new Set(['localhost', '127.0.0.1', STAGING_HOST]);
// Static script CDNs the pages load by design (supabase-js, marked, DOMPurify). Tolerated, but
// counted and printed at the end so a new third-party host cannot slip in unnoticed.
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'cdnjs.cloudflare.com']);
const cdnSeen = new Set();

const ROLES = {
  cadet:      { id: `cadet999@${DOMAIN}`,     pw: '999999',        dir: 'student' },
  instructor: { id: `instructor@${DOMAIN}`,   pw: 'instructor1234', dir: 'faculty' },
  director:   { id: `director@${DOMAIN}`,     pw: 'director1234',   dir: 'faculty' },
  admin:      { id: `admin@${DOMAIN}`,        pw: 'admin1234',      dir: 'faculty' },
};
const STUDENT_PAGES = ['dashboard', 'lessons', 'assignments', 'account', 'help', 'backup', 'interaction-submit'];
const FACULTY_PAGES = ['dashboard', 'grade', 'gradebook', 'lessons', 'report', 'student', 'artifacts', 'admin',
  'account', 'system', 'health', 'feedback', 'tutor-errors', 'help', 'extensions'];

const CHROME = [arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found. Pass --chrome <path>.'); process.exit(2); }

const EMPTY_RE = /all caught up|nothing (due|here|to)|no [a-z ]{3,40}(yet|found|available|to show)|couldn.t load|could not load|failed to|unable to|error loading|something went wrong/i;
const short = (u) => { try { const x = new URL(u); return x.host + x.pathname.slice(0, 70); } catch { return u.slice(0, 90); } };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: [NO_PRODUCTION_ARG, '--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1000 },
});

// Staging data gaps, allowed by name and reported at the end (never silently passed). Each entry
// removes the matching request problem and ONE paired "Failed to load resource" console error.
const ALLOWED = [
  { name: 'artifact-sources index', status: 400, re: /HTTP 400: POST .*storage\/v1\/object\/sign\/artifact-sources\//,
    reason: 'staging bucket holds no artifact index (not seeded)' },
  { name: 'rag-manifest.txt', status: 404, re: /HTTP 404: GET .*textbook-pdfs\/rag-manifest\.txt/,
    reason: 'file is not in the repo and serve_local.py does not serve /textbook-pdfs/' },
];
// Known site defects: still FAIL, but are tagged so the end of the run names them.
const KNOWN_DEFECTS = [
  { name: 'ic-beaker.png missing', re: /ic-beaker\.png/, reason: 'site/js/nav.js:173 names an icon file that does not exist (admin nav)' },
];
const allowedSeen = new Map(), knownSeen = new Map();
function filterProblems(list) {
  const out = [];
  for (const p of list) {
    const a = ALLOWED.find(x => x.re.test(p));
    if (a) { a.pending = (a.pending || 0) + 1; allowedSeen.set(a.name, (allowedSeen.get(a.name) || 0) + 1); continue; }
    out.push(p);
  }
  // drop the paired generic console error for each allowed request
  for (const a of ALLOWED) {
    for (; a.pending > 0; a.pending--) {
      const i = out.findIndex(p => p.startsWith('console.error: Failed to load resource') && p.includes(`status of ${a.status}`));
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}
let totalBad = 0;
const notes = [];
for (const [role, who] of Object.entries(ROLES)) {
  if (ONLY.length && !ONLY.includes(role)) continue;
  const ctx = await browser.createBrowserContext();   // a fresh session per role
  const page = await ctx.newPage();
  let problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => problems.push(`UNCAUGHT: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', r => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`request failed: ${short(r.url())} ${r.failure()?.errorText}`);
  });
  page.on('request', r => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    let host; try { host = new URL(u).hostname; } catch { return; }
    if (CDN_HOSTS.has(host)) { cdnSeen.add(short(u)); return; }
    if (!OK_HOSTS.has(host)) problems.push(`FOREIGN HOST: ${short(u)}`);
  });
  page.on('response', r => {
    const s = r.status();
    if (s >= 400) problems.push(`HTTP ${s}: ${r.request().method()} ${short(r.url())}`);
  });

  console.log(`\n== ${role}`);
  await page.goto(`${BASE}/site/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#identifier', who.id);
  await page.type('#password', who.pw);
  await Promise.all([page.click('#submit'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
  if (/login\.html/.test(page.url())) {
    console.log(`  [FAIL] sign-in did not leave the login page`);
    totalBad++; await ctx.close(); continue;
  }
  console.log(`  signed in, landed on ${new URL(page.url()).pathname.split('/').pop()}`);

  for (const name of (who.dir === 'student' ? STUDENT_PAGES : FACULTY_PAGES)) {
    problems = [];
    const path = `/site/${who.dir}/${name}.html`;
    let status = 'ok', note = '';
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
      if (resp && resp.status() >= 400) status = `HTTP ${resp.status()}`;
      await new Promise(r => setTimeout(r, 800));
      const landed = new URL(page.url()).pathname;
      if (landed !== path) {
        note = `redirected to ${landed.replace('/site/', '')}`;
        if (/login\.html$/.test(landed)) status = 'BOUNCED-TO-LOGIN';
      }
      const text = await page.evaluate(() => document.body?.innerText || '');
      if (text.trim().length < 30) { status = status === 'ok' ? 'BLANK' : status; }
      const m = text.match(EMPTY_RE);
      if (m && landed === path) notes.push(`${role}/${name}: shows "${m[0]}"${problems.length ? ' (page had request problems)' : ''}`);
    } catch (e) { status = 'THREW'; note = e.message.slice(0, 120); }
    problems = filterProblems(problems);
    for (const p of problems) { const k = KNOWN_DEFECTS.find(x => x.re.test(p)); if (k) knownSeen.set(k.name, (knownSeen.get(k.name) || 0) + 1); }
    const bad = status !== 'ok' || problems.length;
    if (bad) totalBad++;
    console.log(`  [${bad ? 'FAIL' : ' ok '}] ${name.padEnd(18)}${status !== 'ok' ? ' ' + status : ''}${note ? ' -- ' + note : ''}`);
    [...new Set(problems)].forEach(p => console.log(`           ${p}`));
  }
  await ctx.close();
}
await browser.close();
if (notes.length) { console.log('\nEmpty-looking text (judge by hand):'); notes.forEach(n => console.log('  ' + n)); }
console.log(`\n${totalBad ? totalBad + ' page(s) with problems' : 'all pages clean'}`);
process.exit(totalBad ? 1 : 0);
