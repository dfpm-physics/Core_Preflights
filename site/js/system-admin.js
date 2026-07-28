// system-admin.js — data layer for faculty/system.html (System > Data), against schema `app`.
//
// BOUNDARY: faculty-admin.js owns ONE offering and the people who run it, gated on director.
// This module is the global tier, gated on is_global_admin — the slot reserved at
// faculty-admin.js:5-6 and nav.js:51. It is deliberately generic: no per-table code, no
// per-table queries. Everything it knows about the database comes from db-schema.js, which
// scripts/app/gen_db_schema.py generates from information_schema.
//
// ── THE SECURITY MODEL IS RLS, UNCHANGED ─────────────────────────────────────────────────────
// Every call here goes through the ordinary anon-key client as the signed-in administrator, so
// the database applies exactly the same policies it applies to every other page. This module
// grants no new authority and holds no service key. A "system admin" here can do precisely what
// app/002_rls.sql already lets is_admin() do — no more. That is why the page can be generic
// without being dangerous: the enforcement boundary is the DB, not this file.
//
// Consequently a write may be refused at runtime even when db-schema.js reports the table
// writable, because `writable` is structural ("a policy exists for INSERT") and cannot know
// whether the policy's predicate admits this caller. Callers must surface rlsHint() on failure.

import { db } from './supabase.js';
import { DB_SCHEMA, TABLE_NAMES, tableMeta, referrers } from './db-schema.js';

// Re-exported so the page imports one module rather than reaching past this layer into the
// generated catalogue — same reason faculty-grade.js re-exports allSectionIds.
export { DB_SCHEMA, TABLE_NAMES, tableMeta, referrers };

export const PAGE_SIZE = 50;

/* ══════════════════════════════════════════════════════════════════════════════
 * Known write limits
 * ══════════════════════════════════════════════════════════════════════════════
 * Four tables are readable but not fully writable by anyone through PostgREST, and the reasons
 * are design decisions in app/002_rls.sql rather than oversights. Stating them up front is the
 * difference between a browser that looks broken and one that looks deliberate — otherwise an
 * administrator hits an opaque RLS refusal and files a bug against the page.
 *
 * Verified against supabase/migrations/app/002_rls.sql and 006_submission_lock_hardening.sql.
 */
export const WRITE_NOTES = {
  submission_activities: {
    allow: ['select'],
    note: 'Students own their own work. Only the submitting student can write these rows '
        + '(sa_student_write); staff and admins hold read-only access by design.',
  },
  submissions: {
    allow: ['select', 'update'],
    note: 'Staff may update a submission to unlock it — nothing else. The lock trigger added in '
        + 'migration 006 rejects a self-unlock and a status revert, so edits here are narrow.',
  },
  grade_events: {
    allow: ['select', 'insert'],
    note: 'Append-only audit log: there is no UPDATE or DELETE policy for anyone, so history '
        + 'cannot be rewritten from the API.',
  },
  analysis_reports: {
    allow: ['select'],
    note: 'Written by the service tier (/preflight-analyze, /interaction-aggregate), not by hand. '
        + 'The table carries a read policy only.',
  },
};

/** What this caller may actually attempt on a table, folding in the known limits above. */
export function permissions(table) {
  const meta = tableMeta(table);
  if (!meta) return { select: false, insert: false, update: false, delete: false, note: null };
  const known = WRITE_NOTES[table];
  const cmds = new Set(meta.policyCommands);
  const has = (c) => cmds.has('ALL') || cmds.has(c);
  const allow = known ? new Set(known.allow) : null;
  const gate = (c, structural) => (allow ? allow.has(c) : structural);
  return {
    select: gate('select', has('SELECT')),
    insert: gate('insert', has('INSERT')),
    update: gate('update', has('UPDATE')),
    delete: gate('delete', has('DELETE')),
    note: known?.note || null,
  };
}

/** Human-readable cause for a PostgREST error, so the UI never shows a bare code. */
export function rlsHint(error) {
  if (!error) return null;
  const code = error.code || '';
  if (code === '42501' || /row-level security|permission denied/i.test(error.message || '')) {
    return 'Row-level security refused this. Your account can read the row but not change it — '
         + 'see the note above the table for why.';
  }
  if (code === '23503') return 'A foreign key does not resolve — the referenced row does not exist.';
  if (code === '23505') return 'A uniqueness constraint already holds this combination of values.';
  if (code === '23514') return 'A CHECK constraint rejected a value. ' + (error.message || '');
  if (code === '23502') return 'A required (NOT NULL) column was left empty.';
  if (code === 'PGRST116') return 'No row matched — it may have been deleted by someone else.';
  return error.message || String(error);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Reading
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * One page of a table.
 *
 * `search` runs an OR of ilike across the text-ish columns only — casting a uuid or timestamp to
 * text in a filter makes PostgREST reject the whole request, so non-text columns are skipped
 * rather than silently breaking the query.
 */
export async function listRows(table, {
  page = 0, pageSize = PAGE_SIZE, sort = null, dir = 'asc', search = '', filters = {},
} = {}) {
  const meta = tableMeta(table);
  if (!meta) throw new Error(`Unknown table: ${table}`);

  let q = db.from(table).select('*', { count: 'exact' });

  for (const [col, val] of Object.entries(filters)) {
    if (val === '' || val == null) continue;
    q = q.eq(col, val);
  }

  const term = search.trim();
  if (term) {
    const textish = meta.columns
      .filter(c => ['text', 'character varying', 'citext'].includes(c.type))
      .map(c => `${c.name}.ilike.*${term.replace(/[,()*]/g, '')}*`);
    if (textish.length) q = q.or(textish.join(','));
  }

  const orderCol = sort || meta.primaryKey[0] || meta.columns[0]?.name;
  if (orderCol) q = q.order(orderCol, { ascending: dir !== 'desc', nullsFirst: false });

  const from = page * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data || [], count: count ?? 0, page, pageSize };
}

/**
 * Display labels for every foreign key on the visible page, in one query per referenced table.
 *
 * Without this the browser is a wall of uuids. Queried separately per target table rather than as
 * an embedded join for the reason faculty-admin.js:29-34 already documents: an RLS-blocked join
 * returns null, which reads as "no such row" and is undebuggable from the UI.
 *
 * Returns { [refTable]: { [pkValue]: label } }.
 */
export async function fkLabels(table, rows) {
  const meta = tableMeta(table);
  if (!meta || !rows.length) return {};

  const wanted = new Map();               // refTable -> Set of ids
  for (const fk of meta.foreignKeys) {
    if (fk.columns.length !== 1) continue;                 // composite FKs are not labelled
    const target = tableMeta(fk.refTable);
    if (!target?.labelColumn) continue;
    const ids = wanted.get(fk.refTable) || new Set();
    for (const row of rows) {
      const v = row[fk.columns[0]];
      if (v != null) ids.add(v);
    }
    if (ids.size) wanted.set(fk.refTable, ids);
  }

  const out = {};
  await Promise.all([...wanted].map(async ([refTable, ids]) => {
    const target = tableMeta(refTable);
    const pk = target.primaryKey[0];
    if (!pk) return;
    const { data, error } = await db.from(refTable)
      .select(`${pk}, ${target.labelColumn}`)
      .in(pk, [...ids].slice(0, 300));                     // schema.js CHUNK convention
    if (error) return;                                     // RLS may hide the target; leave raw id
    out[refTable] = Object.fromEntries(
      (data || []).map(r => [r[pk], r[target.labelColumn]]));
  }));
  return out;
}

/** Every row of a small referenced table, for an FK <select> in the row editor. */
export async function fkOptions(refTable, limit = 500) {
  const target = tableMeta(refTable);
  if (!target) return [];
  const pk = target.primaryKey[0];
  if (!pk) return [];
  const cols = target.labelColumn && target.labelColumn !== pk
    ? `${pk}, ${target.labelColumn}` : pk;
  const { data, error } = await db.from(refTable).select(cols).limit(limit);
  if (error) return [];
  return (data || []).map(r => ({
    value: r[pk],
    label: target.labelColumn ? (r[target.labelColumn] ?? r[pk]) : r[pk],
  })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Value coercion
 * ══════════════════════════════════════════════════════════════════════════════
 * Form controls hand back strings; PostgREST wants JSON of the right type. Sending "5" where the
 * column is integer, or "" where it is a nullable timestamp, produces a 400 that reads like a
 * schema problem rather than a form problem.
 */
export function coerce(column, raw) {
  const t = column.udt || column.type;
  if (raw === '' || raw == null) return column.nullable ? null : '';

  if (['int2', 'int4', 'int8', 'smallint', 'integer', 'bigint'].includes(t)) {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new Error(`${column.name}: "${raw}" is not a whole number.`);
    return n;
  }
  if (['numeric', 'float4', 'float8', 'real', 'double precision'].includes(t)) {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`${column.name}: "${raw}" is not a number.`);
    return n;
  }
  if (t === 'bool' || t === 'boolean') return raw === true || raw === 'true';
  if (t === 'jsonb' || t === 'json') {
    try { return JSON.parse(raw); }
    catch (e) { throw new Error(`${column.name}: not valid JSON — ${e.message}`); }
  }
  // text[] arrives from a comma-separated box (sections.meeting_days is the live case).
  if (t === '_text' || t === 'ARRAY') {
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }
  return raw;
}

/** Turn a stored value back into something an <input> can hold. */
export function present(column, value) {
  if (value == null) return '';
  const t = column.udt || column.type;
  if (t === 'jsonb' || t === 'json') return JSON.stringify(value, null, 2);
  if (t === '_text' || t === 'ARRAY') return Array.isArray(value) ? value.join(', ') : String(value);
  return String(value);
}

/** Build a PATCH/POST body from { columnName: rawFormValue }, skipping generated columns. */
export function buildPayload(table, formValues) {
  const meta = tableMeta(table);
  const payload = {};
  for (const col of meta.columns) {
    if (!(col.name in formValues)) continue;
    if (col.generated) continue;
    const v = coerce(col, formValues[col.name]);
    if (v === '' && !col.nullable) continue;               // let the DB report the NOT NULL
    payload[col.name] = v;
  }
  return payload;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Writing
 * ════════════════════════════════════════════════════════════════════════════ */

const pkFilter = (q, meta, pkValues) => {
  meta.primaryKey.forEach(col => { q = q.eq(col, pkValues[col]); });
  return q;
};

export async function insertRow(table, formValues) {
  const payload = buildPayload(table, formValues);
  const { data, error } = await db.from(table).insert(payload).select();
  if (error) throw error;
  return data?.[0] || null;
}

export async function updateRow(table, pkValues, formValues) {
  const meta = tableMeta(table);
  const payload = buildPayload(table, formValues);
  // Never PATCH the primary key: PostgREST would match the old row and rewrite its identity,
  // orphaning every child that referenced it.
  meta.primaryKey.forEach(col => delete payload[col]);
  const { data, error } = await pkFilter(db.from(table).update(payload), meta, pkValues).select();
  if (error) throw error;
  if (!data?.length) {
    const e = new Error('No row was updated.');
    e.code = '42501';                                      // reads as an RLS refusal to the UI
    throw e;
  }
  return data[0];
}

export async function deleteRow(table, pkValues) {
  const meta = tableMeta(table);
  const { data, error } = await pkFilter(db.from(table).delete(), meta, pkValues).select();
  if (error) throw error;
  if (!data?.length) {
    const e = new Error('No row was deleted.');
    e.code = '42501';
    throw e;
  }
  return data[0];
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Cascade preview
 * ══════════════════════════════════════════════════════════════════════════════
 * The reason deletion is gated behind a typed confirmation. The FK graph in app/001_core_model.sql
 * is deep and mostly ON DELETE CASCADE:
 *
 *     courses -> course_offerings -> sections -> enrollments -> submissions -> submission_activities
 *                                                           \-> grades -> grade_events
 *
 * so removing one `courses` row silently takes a term of student work with it. This walks the graph
 * before anything is deleted and counts what would go, per table, so the confirmation states the
 * real blast radius instead of asking "are you sure?".
 */
const MAX_DEPTH = 6;
const ID_CAP = 500;      // ids carried to the next level; deeper counts read ">= n" past this

export async function cascadePreview(table, pkValues) {
  const meta = tableMeta(table);
  const rootPk = meta.primaryKey[0];
  if (!rootPk || meta.primaryKey.length !== 1) {
    return { deletes: [], nulls: [], blocks: [], truncated: false, unsupported: true };
  }

  const deletes = new Map();          // table -> count
  const nulls = new Map();
  const blocks = [];
  let truncated = false;

  async function walk(tbl, ids, depth) {
    if (depth > MAX_DEPTH || !ids.length) { if (depth > MAX_DEPTH) truncated = true; return; }

    for (const { table: child, fk } of referrers(tbl)) {
      if (fk.columns.length !== 1 || fk.refColumns.length !== 1) continue;
      const col = fk.columns[0];

      if (fk.onDelete === 'restrict' || fk.onDelete === 'no action') {
        const { count } = await db.from(child)
          .select(fk.columns[0], { count: 'exact', head: true })
          .in(col, ids.slice(0, ID_CAP));
        if (count) blocks.push({ table: child, column: col, count });
        continue;
      }

      if (fk.onDelete === 'set null' || fk.onDelete === 'set default') {
        const { count } = await db.from(child)
          .select(col, { count: 'exact', head: true })
          .in(col, ids.slice(0, ID_CAP));
        if (count) nulls.set(child, (nulls.get(child) || 0) + count);
        continue;
      }

      // cascade — count it, then follow its own children.
      const childMeta = tableMeta(child);
      const childPk = childMeta?.primaryKey?.[0];
      const sel = childPk && childMeta.primaryKey.length === 1 ? childPk : col;
      const { data, count, error } = await db.from(child)
        .select(sel, { count: 'exact' })
        .in(col, ids.slice(0, ID_CAP))
        .limit(ID_CAP);
      if (error) continue;
      if (!count) continue;
      deletes.set(child, (deletes.get(child) || 0) + count);
      if (count > ID_CAP) truncated = true;
      if (childPk && childMeta.primaryKey.length === 1) {
        await walk(child, (data || []).map(r => r[childPk]).filter(v => v != null), depth + 1);
      }
    }
  }

  await walk(table, [pkValues[rootPk]], 1);

  const sort = (m) => [...m].map(([t, count]) => ({ table: t, count }))
    .sort((a, b) => b.count - a.count);
  return { deletes: sort(deletes), nulls: sort(nulls), blocks, truncated, unsupported: false };
}
