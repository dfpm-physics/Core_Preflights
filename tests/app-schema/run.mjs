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
// test-grade-cards.mjs installs the browser shim (its units reach util.js, which reads
// location at module load), so it sits with the suites that do the same rather than before them.
const OFFLINE = ['./test-schema.mjs', './test-config.mjs', './test-roster-import.mjs',
                 './test-db-schema.mjs', './test-nav.mjs', './test-modals.mjs',
                 './test-permission-block.mjs',
                 './test-grade-cards.mjs', './test-legacy-actions.mjs'];
const LIVE    = ['./test-rest.mjs', './test-student.mjs', './test-isolation.mjs'];

for (const s of OFFLINE) {
  try { await import(s); }
  catch (e) { console.log(`\n!! suite ${s} threw: ${e.stack || e.message}`); process.exitCode = 1; }
}

/* ── Suites that import app modules run in their own process, deliberately ───
 * site/js/supabase.js captures window.db once at import time. Running these in-process
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
//   test-grade    imports faculty-grade.js for buildGradeData's interactive-taker exclusion (P0.14)
//   test-grade-effort-write  same module behind a RECORDING window.db, because the three rules in
//                 effortRows() are all invisible from outside and all destructive when wrong —
//                 above all `effort: null`, without which the migration-019 trigger silently puts
//                 an instructor's overridden points back to what the effort curve says
//   test-ei      same for faculty-ei.js — the UTC round trip and the batch counting
//   test-student-detail  imports faculty-student.js, which pulls in faculty-rollup.js and
//                 faculty-gradebook.js. NOT test-student.mjs, which is the LIVE suite about the
//                 student-facing portal — different page, opposite audience, easy to confuse.
//   test-dashboard-rows  same for faculty-data.js — buildLessonRows and, above all, that its
//                 deadline honours a per-student extension
//   test-lesson-due  imports faculty-lessons.js and faculty-admin.js — the editor's deadline
//                 arithmetic (a naive string was being stored as UTC) and the staff default
//                 password, whose three copies it checks against each other
//   test-lesson-isolation  same module, but installs a RECORDING stub as window.db so the
//                 assertions are about the writes saveLesson() issues — that scheduling a
//                 container another term runs copies it rather than sharing one row
//   test-student-completion  imports student-lessons.js for the two derivations a student page
//                 renders from — resolveState() and deriveCompletion(). What it pins is that
//                 they AGREE; each was self-consistent while together they blanked the
//                 dashboard of every cadet who missed a preflight
//   test-extension-reopen  imports faculty-grade.js for extensionReopensGrade() — which cases
//                 granting an extension may take a published grade back down in, and the two it
//                 must leave alone. The interesting assertions are the negative ones
//   test-grace   the deadline cutoff and its 120-second acceptance window. Half of it is pure
//                 schema.js, but the half that matters imports student-data.js behind a RECORDING
//                 stub — the assertions are about the queries and writes commitSubmission() and
//                 submitInteractionReport() actually issue, including the ones a refusal must not
//   test-paging  imports schema.js's fetchAll() and reads phys-110 as the test faculty. The
//                 one suite here whose subject is a QUANTITY rather than a shape: that a
//                 whole-course read returns the whole course, which is not what PostgREST
//                 does by default and is not something a wrong answer announces
for (const suite of ['test-imports.mjs', 'test-rollup.mjs', 'test-system-prefs.mjs',
                     'test-run-banner.mjs', 'test-help-status.mjs', 'test-prefs.mjs',
                     'test-tasks.mjs', 'test-gradebook.mjs', 'test-grade.mjs',
                     'test-grade-effort-write.mjs', 'test-ei.mjs',
                     'test-dashboard-rows.mjs', 'test-student-detail.mjs', 'test-feedback.mjs',
                     'test-feedback-admin.mjs', 'test-lesson-due.mjs',
                     'test-lesson-isolation.mjs', 'test-student-completion.mjs',
                     'test-extension-reopen.mjs', 'test-grace.mjs', 'test-paging.mjs']) {
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
