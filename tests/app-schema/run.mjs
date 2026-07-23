// run.mjs — run every wiring test in order, cheapest first.
//
// Ordering is deliberate: pure logic and config need no network, so a mistake there is
// reported in milliseconds instead of after a round of live queries.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { summary, REPO } from './harness.mjs';

/* ── Reset the test cadet's rows before the live suites ──────────────────────
 * The end-to-end suite commits a submission, and migration 006 means a student cannot undo
 * that — nor can staff delete it, because RLS grants DELETE on `submissions` to nobody. So
 * the suite genuinely cannot clean up after itself, and a second run would otherwise fail
 * "a choice offering starts unlocked" against residue from the first.
 *
 * cleanup.py does it with the operator tier. It is bounded to student 3009999999, so it
 * cannot touch a real cadet's work even if invoked by accident.
 */
function resetTestData() {
  const py = process.platform === 'win32'
    ? resolve(REPO, '.venv/Scripts/python.exe')
    : resolve(REPO, '.venv/bin/python');
  const script = resolve(REPO, 'tests/app-schema/cleanup.py');

  if (!existsSync(py)) {
    console.log('  [warn] no project .venv — skipping reset. If the end-to-end suite reports');
    console.log('         "a choice offering starts unlocked", run cleanup.py and re-run.\n');
    return;
  }
  const r = spawnSync(py, [script, '--commit'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(`  [warn] cleanup.py failed (exit ${r.status}) — live suites may see stale rows.`);
    if (r.stderr) console.log(`         ${r.stderr.trim().split('\n').pop()}`);
  } else {
    const removed = (r.stdout.match(/(\d+) row\(s\) removed/) || [])[1];
    console.log(`=== reset ===\n  cleared ${removed ?? '?'} leftover row(s) for the test cadet\n`);
  }
}

// test-legacy-actions.mjs stubs `document`, so it runs LAST among the offline suites —
// the stub is global and would otherwise leak into anything imported after it.
// test-db-schema.mjs is structural-offline, but its last check shells out to
// gen_db_schema.py --check, so it does touch the network when a .venv is present.
const OFFLINE = ['./test-schema.mjs', './test-config.mjs', './test-roster-import.mjs',
                 './test-db-schema.mjs', './test-nav.mjs', './test-legacy-actions.mjs'];
const LIVE    = ['./test-rest.mjs', './test-student.mjs', './test-isolation.mjs'];

for (const s of OFFLINE) {
  try { await import(s); }
  catch (e) { console.log(`\n!! suite ${s} threw: ${e.stack || e.message}`); process.exitCode = 1; }
}

/* ── Suites that import app modules run in their own process, deliberately ───
 * site/app/js/supabase.js captures window.db once at import time. Running these in-process
 * would leave every later suite bound to the unauthenticated client they used, so the
 * end-to-end tests would fail at bootstrap for a reason unrelated to the code under test.
 * Isolating them keeps the module registry clean.
 *
 *   test-imports  imports every module in the app tree
 *   test-rollup   imports faculty-rollup.js for summarizeReports (pure, but the module's
 *                 supabase.js import still binds a client)
 */
//   test-system-prefs  calls installBrowser() to stub window/localStorage for the persistence
//                 round-trip; those stubs are global and would leak into later suites
//   test-help-status  stubs fetch/document/DOMPurify globally and re-imports help.js per
//                 scenario to reset its module-level caches; both would leak in-process
//   test-prefs   installBrowser() plus a live signed-in session; prefs.js binds window.db at
//                 import time, so it must not share a process with the later suites
//   test-gradebook  imports faculty-gradebook.js for the grid arithmetic (pure, but the module's
//                 supabase.js import still binds a client)
//   test-ei      same for faculty-ei.js — the UTC round trip and the batch counting
//   test-student-detail  imports faculty-student.js, which pulls in faculty-rollup.js and
//                 faculty-gradebook.js. NOT test-student.mjs, which is the LIVE suite about the
//                 student-facing portal — different page, opposite audience, easy to confuse.
for (const suite of ['test-imports.mjs', 'test-rollup.mjs', 'test-system-prefs.mjs',
                     'test-run-banner.mjs', 'test-help-status.mjs', 'test-prefs.mjs',
                     'test-tasks.mjs', 'test-gradebook.mjs', 'test-ei.mjs',
                     'test-student-detail.mjs', 'test-feedback.mjs']) {
  const r = spawnSync(process.execPath, [resolve(import.meta.dirname, suite)],
                      { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    process.exitCode = 1;
  }
}

/* The aggregator's Python engine. It has to agree with summarizeReports() above — the prose it
 * grounds is required to cite the same figures the browser's bars show — so it runs in the same
 * command, not by hand. It opens no database connection.
 *
 * Skipped, not failed, when the project venv is absent: CORE.md §2 makes the whole Node/Python
 * tool layer optional, and a teammate without a venv should still get a green JS suite. A skip is
 * announced loudly enough that nobody mistakes it for a pass. */
{
  const py = resolve(import.meta.dirname, '..', '..', '.venv', 'Scripts', 'python.exe');
  const test = resolve(import.meta.dirname, '..', '..', 'supabase', 'admin',
                       'aggregate_summarize_test.py');
  if (!existsSync(py)) {
    console.log('\n!! SKIPPED aggregate_summarize_test.py — no .venv (see CORE.md §2). '
              + 'The Python aggregator engine is UNVERIFIED in this run.');
  } else {
    const r = spawnSync(py, [test], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) {
      process.stderr.write(r.stderr || '');
      process.exitCode = 1;
    }
  }
}

resetTestData();

for (const s of LIVE) {
  try { await import(s); }
  catch (e) { console.log(`\n!! suite ${s} threw: ${e.stack || e.message}`); process.exitCode = 1; }
}

// Leave the database as we found it.
resetTestData();

process.exitCode = summary() ? (process.exitCode || 0) : 1;
