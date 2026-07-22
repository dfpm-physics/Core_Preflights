// system-prefs.js — which tables and which columns System > Data shows, and how that is remembered.
//
// Django's admin makes this an explicit authoring decision: a ModelAdmin declares `list_display`,
// and the changelist shows those columns and no others. The reason is not tidiness — a table
// rendered with every column is unreadable, because the columns a human navigates by (a code, a
// title, a status) are buried among audit timestamps, uuid keys and JSON blobs that only matter
// once you already have the row.
//
// This module is that decision, in two layers:
//
//   1. A RULE (defaultColumns) that works on any table, including one added by a future migration
//      that nobody has curated. New tables therefore arrive readable rather than raw.
//   2. CURATED overrides for the tables that actually get used, where the rule guesses wrong —
//      mostly because a uuid primary key is technically the "label" but tells a human nothing,
//      while its foreign keys resolve to names they recognise.
//
// Everything here is overridable in the UI and persisted per browser. Nothing is enforced: hiding
// a column changes what is rendered, never what is read or written, and never what RLS allows.
//
// PURE BY DESIGN — no db import, no DOM. Same reason schema.js is dependency-free: it can be unit
// tested without a browser or a database. Keep it that way.

import { tableMeta, TABLE_NAMES } from './db-schema.js';

const LS_COLUMNS = 'cp.system.columns';
const LS_TABLES  = 'cp.system.tables';

/* ══════════════════════════════════════════════════════════════════════════════
 * Display names
 * ══════════════════════════════════════════════════════════════════════════════
 * Postgres identifiers are snake_case; humans read Title Case. Django derives a verbose_name the
 * same way (underscores to spaces, capitalised) rather than making every model spell it out.
 *
 * The raw identifier is never thrown away — every humanised label in system.html carries the real
 * column or table name in a title attribute or beside it, because in a database browser you still
 * need the name that appears in a migration, an error message, or a SQL query.
 */

/** Tokens that are wrong in Title Case — rendered as-is instead of "Id", "Url". */
const ACRONYMS = new Map([
  ['id', 'ID'], ['url', 'URL'], ['ai', 'AI'], ['uuid', 'UUID'],
  ['json', 'JSON'], ['md', 'MD'], ['csv', 'CSV'],
]);

function titleCase(text) {
  return String(text)
    .split('_')
    .filter(Boolean)
    .map(word => ACRONYMS.get(word.toLowerCase())
      || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "assignment_offerings" -> "Assignment Offerings" */
export function humanizeTable(name) {
  return titleCase(name);
}

/**
 * "course_offering_id" -> "Course Offering", "is_published" -> "Is Published".
 *
 * The trailing `_id` is dropped ONLY for a real foreign key, because that column renders as the
 * target's label — the cell says "phys-215", so a header reading "Course Offering ID" would be
 * describing the uuid underneath rather than what is on screen. Columns that merely end in `_id`
 * without being a foreign key keep it: `students.student_id` is a cadet number a human types and
 * quotes, not a hidden key, and calling it "Student" would misdescribe the column.
 */
export function humanizeColumn(table, column) {
  const meta = tableMeta(table);
  const isFk = !!meta?.foreignKeys?.some(fk => fk.columns.length === 1 && fk.columns[0] === column);
  const base = isFk ? column.replace(/_id$/, '') : column;
  return titleCase(base);
}

/** Audit trail every table carries. Real, but never what you scan a list for. */
const TIMESTAMP_NOISE = new Set(['created_at', 'updated_at']);

/** Types that cannot render usefully in a fixed-width cell. */
const BLOB_TYPES = new Set(['jsonb', 'json']);

/** Long-form text: worth reading in the row editor, ruinous in a list. */
const LONG_TEXT = new Set(['description', 'report_markdown', 'note', 'objectives', 'detail']);

const MAX_AUTO_COLUMNS = 7;

/* ══════════════════════════════════════════════════════════════════════════════
 * Curated defaults — the equivalent of a ModelAdmin.list_display
 * ══════════════════════════════════════════════════════════════════════════════
 * Chosen so each row identifies itself without being opened. Where a table's primary key is a
 * uuid, the foreign keys are listed instead: system.html resolves those to their target's label
 * column, so `course_offering_id` renders as "phys-215" rather than "8f3c…". That substitution is
 * the single biggest readability win in the whole page, and it is why these lists lean on FKs.
 */
export const CURATED_COLUMNS = {
  // Catalogue
  courses:               ['code', 'title', 'department'],
  terms:                 ['code', 'label', 'starts_on', 'ends_on'],
  assignment_kinds:      ['id', 'label', 'sort_order'],
  assignments:           ['slug', 'title', 'course_id', 'kind_id', 'is_archived'],
  activities:            ['slug', 'modality', 'title', 'assignment_id', 'position'],

  // Delivery
  course_offerings:      ['course_id', 'term_id', 'is_active'],
  sections:              ['code', 'course_offering_id', 'meeting_days', 'period'],
  students:              ['student_id', 'name', 'auth_user_id'],
  enrollments:           ['student_id', 'section_id', 'status', 'enrolled_at'],
  instructors:           ['name', 'is_global_admin'],
  staff_assignments:     ['instructor_id', 'course_offering_id', 'section_id', 'role'],
  assignment_offerings:  ['course_offering_id', 'assignment_id', 'due_at', 'points_possible',
                          'grading_mode', 'is_published'],
  offering_activities:   ['assignment_offering_id', 'activity_id', 'grading_role', 'is_visible'],
  assignment_due_dates:  ['assignment_offering_id', 'section_id', 'due_at'],

  // Work and grades
  submissions:           ['enrollment_id', 'assignment_offering_id', 'status', 'committed_at'],
  submission_activities: ['submission_id', 'activity_id', 'is_final', 'payload_bytes'],
  grades:                ['enrollment_id', 'assignment_offering_id', 'points_earned',
                          'points_possible', 'effort', 'source', 'is_finalized'],
  grade_events:          ['grade_id', 'event', 'actor', 'occurred_at'],
  extensions:            ['enrollment_id', 'assignment_offering_id', 'extended_due_at', 'reason',
                          'revoked_at'],
  review_signoffs:       ['assignment_offering_id', 'section_id', 'reviewed_by', 'reviewed_at'],
  // The counts are the audit-relevant part of an import — they record which conflict resolution
  // the operator chose, which is the only step that discards data.
  roster_imports:        ['course_offering_id', 'imported_by', 'filename', 'created_at'],

  // Analysis
  analysis_reports:      ['scope', 'scope_id', 'kind', 'generated_at'],
  // status and invoked_by first: the audit question is almost always "did the overnight run
  // work, and was anyone watching?"
  analysis_runs:         ['skill', 'invoked_by', 'status', 'assignment_offering_id',
                          'day_track', 'started_at', 'summary'],

  // Hidden by default (see below), but curated anyway so that an administrator who opts in
  // gets the two columns that mean anything rather than a uuid beside a jsonb blob.
  user_preferences:      ['user_id', 'updated_at'],
};

/* ══════════════════════════════════════════════════════════════════════════════
 * Tables hidden by default
 * ══════════════════════════════════════════════════════════════════════════════
 * Not "unimportant" — reachable in one click from the gear, and every one of them is browsable.
 * They are hidden because they are not where an administrator starts: three are junction tables
 * read through their parents, two are machine-written (an append-only audit log and the service
 * tier's report store), and one is a three-row lookup. Showing all 21 by default buries the eight
 * tables that answer actual questions.
 */
export const DEFAULT_HIDDEN_TABLES = new Set([
  'assignment_kinds',       // 1-row lookup; changed by migration, not by hand
  'assignment_due_dates',   // junction, edited via the offering
  'offering_activities',    // junction, edited via the offering
  'submission_activities',  // student-owned blobs, read-only to staff
  'grade_events',           // append-only audit log
  'analysis_reports',       // written by /preflight-analyze and /lesson-aggregate
  // Self-scoped by RLS with no staff read policy (010), so a browser here shows an
  // administrator exactly one row — their own — and would read as an empty or broken table
  // rather than as the privacy boundary it is.
  'user_preferences',
]);

/* ══════════════════════════════════════════════════════════════════════════════
 * The rule — used for any table without a curated list
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * A readable default column set for any table, curated or not.
 *
 * Keeps: the label column, foreign keys (they resolve to names), enums and booleans (status at a
 * glance), and short scalars. Drops: audit timestamps, JSON blobs, long-form text, and a uuid
 * primary key when a better label exists. Falls back to the first few columns if that leaves
 * nothing — an empty table view would be worse than a raw one.
 */
export function defaultColumns(table) {
  const curated = CURATED_COLUMNS[table];
  const meta = tableMeta(table);
  if (!meta) return [];

  const names = new Set(meta.columns.map(c => c.name));
  if (curated) {
    // Survive a migration that drops a curated column: filter rather than render a dead header.
    const live = curated.filter(c => names.has(c));
    if (live.length) return live;
  }

  const fkCols = new Set(meta.foreignKeys.flatMap(fk => fk.columns));
  const enumCols = new Set(Object.keys(meta.enums || {}));
  const pkIsUuid = meta.primaryKey.length === 1
    && meta.columns.find(c => c.name === meta.primaryKey[0])?.udt === 'uuid';

  const picked = meta.columns.filter(c => {
    if (TIMESTAMP_NOISE.has(c.name)) return false;
    if (BLOB_TYPES.has(c.udt)) return false;
    if (LONG_TEXT.has(c.name)) return false;
    // A uuid PK is how the row is addressed, not how it is recognised.
    if (pkIsUuid && c.name === meta.primaryKey[0] && meta.labelColumn !== c.name) return false;
    if (c.name === meta.labelColumn) return true;
    if (fkCols.has(c.name) || enumCols.has(c.name)) return true;
    if (c.udt === 'bool') return true;
    return ['int2', 'int4', 'int8', 'numeric', 'date', 'timestamptz', 'text'].includes(c.udt);
  }).map(c => c.name);

  const out = picked.slice(0, MAX_AUTO_COLUMNS);
  return out.length ? out : meta.columns.slice(0, 4).map(c => c.name);
}

/** Tables shown unless the administrator says otherwise. */
export function defaultTables() {
  return TABLE_NAMES.filter(t => !DEFAULT_HIDDEN_TABLES.has(t));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Persistence — localStorage, `cp.*` namespace, every access guarded
 * ══════════════════════════════════════════════════════════════════════════════
 * Per-browser on purpose. This is a view preference, not configuration: it must not need a
 * migration to change, must not be shared between administrators who work differently, and must
 * never be something a stale value can break. Any parse failure falls back to the defaults.
 */
function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private browsing, quota — the page works without persistence */ }
}

/** Columns to render for a table: the saved choice, else the default. */
export function visibleColumns(table) {
  const meta = tableMeta(table);
  if (!meta) return [];
  const saved = read(LS_COLUMNS)?.[table];
  if (!Array.isArray(saved) || !saved.length) return defaultColumns(table);
  // Drop anything a migration removed since the choice was saved.
  const live = saved.filter(c => meta.columns.some(col => col.name === c));
  return live.length ? live : defaultColumns(table);
}

/** Persist a column choice. Passing null (or the default set) clears the override. */
export function setVisibleColumns(table, columns) {
  const all = read(LS_COLUMNS) || {};
  if (!columns) delete all[table];
  else all[table] = columns;
  write(LS_COLUMNS, Object.keys(all).length ? all : null);
}

export function resetColumns(table) { setVisibleColumns(table, null); }

/** True when this table is showing something other than its default columns. */
export function columnsCustomised(table) {
  const saved = read(LS_COLUMNS)?.[table];
  return Array.isArray(saved) && saved.length > 0;
}

/** Tables to list in the picker: the saved choice, else the default. */
export function visibleTables() {
  const saved = read(LS_TABLES);
  if (!Array.isArray(saved) || !saved.length) return defaultTables();
  // Intersect with the catalogue so a dropped table disappears and a new one is simply absent
  // until the administrator opts in — never a picker entry that 404s on click.
  const live = saved.filter(t => TABLE_NAMES.includes(t));
  return live.length ? live : defaultTables();
}

export function setVisibleTables(tables) {
  write(LS_TABLES, tables && tables.length ? tables : null);
}

export function resetTables() { setVisibleTables(null); }

export function tablesCustomised() {
  const saved = read(LS_TABLES);
  return Array.isArray(saved) && saved.length > 0;
}
