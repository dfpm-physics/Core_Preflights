// test-db-schema.mjs — prove site/js/db-schema.js still describes the real schema `app`.
//
// db-schema.js is a GENERATED catalogue, and faculty/system.html renders directly from it: the
// column list, the type of every form control, the foreign-key pickers and the delete cascade
// preview all come from that one file. A stale catalogue therefore does not fail loudly — it
// shows a column that no longer exists, or omits one that does, or previews a cascade that no
// longer matches the FK graph. That last case is the dangerous one, because the preview is what
// the administrator types a confirmation against before deleting.
//
// Two layers of checking:
//   1. STRUCTURAL (offline, always runs) — the catalogue is internally coherent, and the facts
//      system.html depends on are actually present.
//   2. LIVE (runs when STAGING_DB_URL is set) — re-runs scripts/app/gen_db_schema.py --check
//      against the staging database and fails if the committed file differs, and fails if any
//      function in schema app has no search_path pinned to app. Skipped, never passed, when there
//      is no connection string or no Python.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, skip, REPO } from './harness.mjs';
import { assertStagingDbUrl } from './target.mjs';
import { DB_SCHEMA, TABLE_NAMES, tableMeta, referrers } from '../../site/js/db-schema.js';

section('db-schema.js — generated catalogue');

/* ── 1. Structural coherence ─────────────────────────────────────────────── */

check('catalogue is non-empty', TABLE_NAMES.length > 0);
eq('TABLE_NAMES matches DB_SCHEMA keys', TABLE_NAMES.length, Object.keys(DB_SCHEMA).length);

// 49 base tables as the migration files build them (views excluded; the migration ledger is left
// out because no browser session can reach it). A change here is not automatically a failure — it
// means a migration landed and the catalogue needs regenerating and this count bumping.
eq('49 base tables (views excluded)', TABLE_NAMES.length, 49);

let missingCols = [], badPk = [], danglingFk = [];
for (const name of TABLE_NAMES) {
  const t = tableMeta(name);
  if (!t.columns?.length) missingCols.push(name);
  const colNames = new Set((t.columns || []).map(c => c.name));
  for (const pk of t.primaryKey || []) if (!colNames.has(pk)) badPk.push(`${name}.${pk}`);
  for (const fk of t.foreignKeys || []) {
    if (!DB_SCHEMA[fk.refTable]) danglingFk.push(`${name}.${fk.name} -> ${fk.refTable}`);
  }
}
check('every table has columns', !missingCols.length, missingCols.join(', '));
check('every primary-key column exists on its table', !badPk.length, badPk.join(', '));
check('every foreign key points at a table in the catalogue', !danglingFk.length,
      danglingFk.join(', '));

// A table with no primary key cannot be addressed for edit or delete; system.html would render
// rows it can only ever read.
const noPk = TABLE_NAMES.filter(n => !(tableMeta(n).primaryKey || []).length);
check('every table has a primary key', !noPk.length, noPk.join(', '));

// The `pk` flag on each column is what the row editor disables. If it fell out of sync with
// primaryKey[], the editor would happily PATCH an identity column.
let pkFlagMismatch = [];
for (const name of TABLE_NAMES) {
  const t = tableMeta(name);
  const flagged = new Set(t.columns.filter(c => c.pk).map(c => c.name));
  const declared = new Set(t.primaryKey);
  if (flagged.size !== declared.size || [...declared].some(c => !flagged.has(c))) {
    pkFlagMismatch.push(name);
  }
}
check('column.pk flags agree with primaryKey[]', !pkFlagMismatch.length, pkFlagMismatch.join(', '));

/* ── 2. The facts system.html actually depends on ────────────────────────── */

// CHECK-parsed value sets become <select> options. The app schema uses no Postgres enums — every
// closed set is text + CHECK — so if the generator's parser regressed, these silently become free
// text boxes and an administrator can write a value the DB will reject.
const EXPECTED_ENUMS = {
  'activities.modality': ['written', 'interactive', 'questions', 'external'],
  'enrollments.status': ['active', 'dropped', 'completed'],
  'staff_assignments.role': ['director', 'instructor', 'grader'],
  'submissions.status': ['draft', 'committed', 'superseded'],
  'assignment_offerings.grading_mode': ['effort', 'points'],
  'offering_activities.grading_role': ['graded', 'practice'],
  'grades.source': ['instructor', 'ai_suggested', 'derived', 'imported', 'auto_checked'],
};
for (const [path, expected] of Object.entries(EXPECTED_ENUMS)) {
  const [tbl, col] = path.split('.');
  const got = tableMeta(tbl)?.enums?.[col];
  eq(`enum ${path}`, JSON.stringify(got), JSON.stringify(expected));
}

// The delete cascade preview walks this chain. If any link stops reporting ON DELETE CASCADE the
// preview under-reports, and the typed confirmation understates what is about to be destroyed.
const CASCADE_CHAIN = [
  ['course_offerings', 'courses'],
  ['sections', 'course_offerings'],
  ['enrollments', 'sections'],
  ['submissions', 'enrollments'],
  ['grades', 'enrollments'],
  ['submission_activities', 'submissions'],
];
for (const [child, parent] of CASCADE_CHAIN) {
  const fk = (tableMeta(child)?.foreignKeys || [])
    .find(f => f.refTable === parent && f.onDelete === 'cascade');
  check(`${child} -> ${parent} is ON DELETE CASCADE`, !!fk,
        'the delete preview under-reports if this link changed');
}

// referrers() is how the preview discovers children; a broken traversal yields an empty preview,
// which reads as "nothing else references this row" — the most dangerous possible wrong answer.
const courseChildren = referrers('courses').map(r => r.table);
check('referrers(courses) finds course_offerings', courseChildren.includes('course_offerings'),
      `got: ${courseChildren.join(', ')}`);
check('referrers(enrollments) finds submissions and grades',
      ['submissions', 'grades'].every(t => referrers('enrollments').map(r => r.table).includes(t)));

// The four tables system.html banners as write-limited. `writable` is structural — it reports
// only that some policy exists for a write command — so this asserts the one table that has no
// write policy at all, which is the case the flag can actually detect.
eq('analysis_reports has no write policy', tableMeta('analysis_reports').writable, false);
check('grade_events has no foreign key to grades or instructors (the history outlives both; migration 049)',
      !(tableMeta('grade_events').foreignKeys || []).length);
check('grade_events takes no write policy for the API (migration 049 writes it by trigger)',
      !tableMeta('grade_events').policyCommands.some(c => ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(c)),
      `policies: ${tableMeta('grade_events').policyCommands.join(', ')}`);

// Every table RLS-enabled: the page relies on the database, not on its own gate, for enforcement.
const noRls = TABLE_NAMES.filter(n => !tableMeta(n).rls);
check('RLS is enabled on every table', !noRls.length, noRls.join(', '));

// labelColumn drives FK display and the delete confirmation token.
const noLabel = TABLE_NAMES.filter(n => !tableMeta(n).labelColumn);
check('every table has a label column for FK display', !noLabel.length, noLabel.join(', '));

/* ── 2b. Migration 007 — extension governance + review sign-off ──────────── */
// Catalogue-level only. These prove the columns and the table are really there and RLS is on;
// they do NOT exercise the two triggers, which need a signed-in director the harness has no
// account for. See the CHANGELOG note on what remains unverified.

const extCols = (tableMeta('extensions')?.columns || []).map(c => c.name);
for (const c of ['reason', 'revoked_at', 'revoked_by', 'revoked_reason', 'granted_by']) {
  check(`extensions.${c} exists`, extCols.includes(c), extCols.join(', '));
}

// reason NOT NULL is what stops the director's report filling with blank rows.
const reasonCol = (tableMeta('extensions')?.columns || []).find(c => c.name === 'reason');
check('extensions.reason is NOT NULL', reasonCol && reasonCol.nullable === false,
      `nullable=${reasonCol?.nullable}`);

check('review_signoffs is in the catalogue', TABLE_NAMES.includes('review_signoffs'));
const rsCols = (tableMeta('review_signoffs')?.columns || []).map(c => c.name);
for (const c of ['assignment_offering_id', 'section_id', 'reviewed_by', 'reviewed_at', 'note']) {
  check(`review_signoffs.${c} exists`, rsCols.includes(c), rsCols.join(', '));
}
check('review_signoffs has RLS enabled', !!tableMeta('review_signoffs')?.rls);

/* ── 3. Live checks against staging ─────────────────────────────────────── */

{
  let urlOk = true;
  try { assertStagingDbUrl(process.env.STAGING_DB_URL, 'STAGING_DB_URL'); } catch { urlOk = false; }
  const venvPy = process.platform === 'win32'
    ? resolve(REPO, '.venv/Scripts/python.exe') : resolve(REPO, '.venv/bin/python');
  const py = process.env.PREP_PYTHON || venvPy;
  if (!urlOk) {
    skip('db-schema.js matches staging schema `app`', 'STAGING_DB_URL is not set to the staging project');
    skip('every function in app pins its search_path', 'STAGING_DB_URL is not set to the staging project');
  } else if (!existsSync(py)) {
    skip('db-schema.js matches staging schema `app`', 'no Python with psycopg2 (set PREP_PYTHON)');
    skip('every function in app pins its search_path', 'no Python with psycopg2 (set PREP_PYTHON)');
  } else {
    const drift = spawnSync(py, [resolve(REPO, 'scripts/app/gen_db_schema.py'), '--check'],
                            { encoding: 'utf8', timeout: 90000 });
    check('db-schema.js matches staging schema `app`', drift.status === 0,
          (drift.stdout + drift.stderr).trim().slice(-300));
    const pins = spawnSync(py, [resolve(import.meta.dirname, 'live_checks.py')],
                           { encoding: 'utf8', timeout: 90000 });
    check('every function in app pins its search_path', pins.status === 0,
          (pins.stdout + pins.stderr).trim().slice(-400));
  }
}
