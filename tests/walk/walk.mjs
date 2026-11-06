// walk.mjs -- the clickthrough walk. Drives a real headless browser against the local staging site, signs in as the seeded
// staging logins, clicks the real pages, and asserts what each page shows and what the database then holds.
//
// OPTIONAL developer tooling (CORE.md section 2): nothing on the deploy path needs it.
// STAGING ONLY. It refuses a base address that is not this machine, and it blocks every request to the production project.
//
// Run:  see README.md.    node walk.mjs [--base http://localhost:8043] [--only A,B] [--keep] [--cleanup-only] [--self-test] [--report <file>]
//
// Everything it creates is named "ZZ walk ...", is synthetic, and is removed at the end (--keep leaves it for a look).
// A check blocked by a fault elsewhere is reported as BLOCKED, never as a pass.

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { cleanup } from './cleanup.mjs';
import { runA } from './groups/a.mjs';
import { runB } from './groups/b.mjs';
import { runC } from './groups/c.mjs';
import { runD } from './groups/d.mjs';
import { runE } from './groups/e.mjs';
import { runF } from './groups/f.mjs';
import { runG } from './groups/g.mjs';
import { runH } from './groups/h.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

async function selfTest(base, chrome) {
  // The guard must refuse these before anything is launched.
  for (const bad of ['https://dfpm-physics.github.io/Core_Preflights/site/', 'http://example.com', `https://${L.PRODUCTION_REF}.supabase.co`, 'http://localhost.evil.test:8043', 'http://user@localhost:8043', 'file:///c:/x', 'not a url', 'http://localhost:8043/site/']) {
    await L.check('S1', `refuses base ${bad.slice(0, 40)}`, () => { try { L.assertLocalBase(bad); } catch { return true; } throw new Error('accepted'); });
  }
  await L.check('S2', 'accepts the local address', () => L.assertLocalBase(base) === base);
  await L.check('S3', 'recognises a production address in any case', () => L.isProductionUrl(`https://${L.PRODUCTION_REF.toUpperCase()}.supabase.co/rest/v1/x`) && !L.isProductionUrl('https://wkibeptktbnaddfynrwr.supabase.co'));
  // A page must not be able to reach production: ask the browser to fetch it.
  const browser = await L.launch(chrome);
  const s = await L.Session.start(browser, base, null);
  await s.page.goto(`${base}/site/login.html`, { waitUntil: 'networkidle2' });
  await L.check('S4a', 'a page request (fetch) to the production project fails', async () => {
    // The local server's content policy refuses it too, so this proves the page cannot reach production by any route.
    const r = await s.page.evaluate(async (u) => { try { await fetch(u); return 'reached'; } catch (e) { return 'blocked'; } }, `https://${L.PRODUCTION_REF}.supabase.co/rest/v1/`);
    L.assert(r === 'blocked', 'the page reached production');
  });
  await L.check('S4b', 'the request filter in the walk stops a request to the production project', async () => {
    const before = L.productionAttempts.length;
    let went = true;
    try { await s.page.goto(`https://${L.PRODUCTION_REF}.supabase.co/`, { timeout: 8000 }); } catch { went = false; }
    L.assert(!went, 'the navigation to production went through');
    L.assert(L.productionAttempts.length > before, 'the filter did not see the request');
    L.productionAttempts.length = 0;       // made on purpose
  });
  await L.check('S5', 'the database helper refuses a production address before connecting', () => {
    let refused = false;
    try {
      execFileSync(process.env.PREP_PYTHON || 'python', [L.HERE + '/db.py', 'sql', 'select 1'],
        { env: { ...process.env, STAGING_DB_URL: `postgresql://postgres.${L.PRODUCTION_REF}:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres` }, stdio: 'pipe' });  // allowlist-secret: an invented address with a placeholder password, to prove db.py refuses it
    } catch (e) { refused = /REFUSED|staging/i.test(String(e.stderr) + String(e.stdout)); }
    L.assert(refused, 'the helper did not refuse a production address');
  });
  await s.close(); await browser.close();
}

async function main() {
  const base = L.assertLocalBase(arg('base', 'http://localhost:8043'));
  const chrome = L.findChrome(arg('chrome'));
  if (!chrome) { console.error('No Chrome or Edge found. Set CHROME_PATH or pass --chrome.'); process.exit(2); }
  if (!process.env.STAGING_DB_URL) { console.error('STAGING_DB_URL is not set. Put the staging connection string in that variable (see README.md).'); process.exit(2); }

  if (flag('self-test')) { console.log('Guard self-test'); await selfTest(base, chrome); return finish(arg('report')); }
  if (flag('cleanup-only')) { console.log(JSON.stringify(cleanup(), null, 1)); return; }

  const only = (arg('only') || 'A,B,C,D,E,F,G,H').split(',').map(x => x.trim().toUpperCase());
  const seed = L.loadSeed();
  const run = 'ZZ walk ' + Date.now().toString(36).slice(-5);
  const browser = await L.launch(chrome);
  const W = { base, seed, browser, run, state: {} };
  console.log(`Walk ${run} against ${base}`);
  const groups = { A: runA, B: runB, C: runC, D: runD, E: runE, F: runF, G: runG, H: runH };
  try {
    cleanup();                                   // leftovers of an earlier run
    for (const g of only) if (groups[g]) { console.log(`\nGroup ${g}`); try { await groups[g](W); } catch (e) { L.record(g + '0', 'group ran to its end', 'fail', String(e.message).slice(0, 300)); } }
  } finally {
    await browser.close().catch(() => {});
    if (!flag('keep')) { console.log('\nCleanup'); try { W.cleaned = cleanup(); console.log(JSON.stringify(W.cleaned)); } catch (e) { console.log('cleanup failed: ' + e.message); W.cleaned = { error: e.message }; } }
  }
  L.record('X1', 'no request reached the production project', L.productionAttempts.length ? 'fail' : 'pass', L.productionAttempts.join('; '));
  finish(arg('report'));
}

function finish(reportPath) {
  const n = (s) => L.results.filter(r => r.status === s).length;
  console.log(`\npass ${n('pass')}  fail ${n('fail')}  blocked ${n('blocked')}`);
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ results: L.results, faults: L.faults }, null, 1));
  process.exitCode = n('fail') || n('blocked') ? 1 : 0;
}

main().catch(e => { console.error(String(e.message || e)); process.exit(2); });
