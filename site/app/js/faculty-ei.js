// faculty-ei.js — extra-instruction logging (roadmap P1.4).
//
// Two callers, one module: the student detail page logs a single session, the gradebook logs a
// batch. They are the SAME write with a different number of enrolments, which is the whole reason
// this is one module — the roadmap is explicit that a design where bulk is a bolt-on "will be
// abandoned by week three", and the surest way to get there is two code paths that drift.
//
// TIME IS THE HARD PART, AND IT IS ALL HERE
//   `app.ei_sessions.started_at` is timestamptz, stored UTC. The modal uses <input
//   type="datetime-local">, whose value is a LOCAL wall-clock string with no zone at all
//   ('2026-07-22T14:35'). Converting between them is the one thing in this feature that is easy to
//   get subtly wrong and impossible to notice — a session logged an hour off still looks fine.
//   So both directions are pure functions below, and both are unit-tested.
//
//   Do NOT reach for the zoneinfo/America-Denver handling that scripts/fall2026 uses. That exists
//   because a Python build script has no user and must pick a zone; a browser already knows the
//   zone it is standing in, and on the only machines this runs on that zone IS America/Denver.
//   Hardcoding it here would break the moment someone grades from a trip.

import { db } from './supabase.js';

export const EI_SELECT =
  'id,enrollment_id,instructor_id,started_at,duration_minutes,notes,batch_id,created_at,'
  + 'instructors(id,name)';

// 30 minutes is the director's stated default; it is also the table default, and the two must
// agree or the modal will silently disagree with a row it did not write.
export const DEFAULT_DURATION = 30;

// Offered in the modal. Not a constraint — the field is a number input and 480 is the DB ceiling.
export const DURATION_CHOICES = [10, 15, 20, 30, 45, 60, 90];

/* ---------------------------------------------------------------------------
 * Time
 * ------------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/**
 * The value for a <input type="datetime-local">, in LOCAL time.
 *
 * Rounded DOWN to the nearest 5 minutes. The event being logged is "the twenty minutes after
 * class", not an instant, so second-level precision is false precision — and a prefill reading
 * 14:37 invites the operator to fix a number that never mattered.
 */
export function localInputValue(d = new Date()) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const m = Math.floor(d.getMinutes() / 5) * 5;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(m)}`;
}

/**
 * datetime-local value -> UTC ISO string for the database.
 *
 * `new Date('2026-07-22T14:35')` is parsed as LOCAL time by every browser (an ISO string without
 * a zone designator and with a time component is local per the spec), which is exactly what we
 * want — but it is worth stating, because the sibling form '2026-07-22' parses as UTC and the
 * inconsistency is a genuine trap.
 */
export function toUtcISO(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** UTC ISO from the database -> datetime-local value, for editing an existing row. */
export function fromUtcISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localInputValue(d);
}

/** '45 min' / '1 h' / '1 h 30 min' — read at a glance in a list, so no decimals. */
export function fmtDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ---------------------------------------------------------------------------
 * Building the write
 * ------------------------------------------------------------------------- */

/**
 * Validate the modal's fields. Returns a string to show the operator, or null when it is fine.
 *
 * Every rule here is also a database constraint (011). It is duplicated deliberately, for the
 * reason grade.html:562-564 already gives about extension reasons: the operator should get a
 * sentence, not a Postgres constraint name.
 */
export function validateEi({ startedAt, durationMinutes, enrollmentIds, notes }) {
  if (!enrollmentIds || !enrollmentIds.length) return 'Pick at least one student.';
  if (!startedAt) return 'Pick a date and time.';
  if (!toUtcISO(startedAt)) return 'That date and time could not be read.';
  const n = Number(durationMinutes);
  if (!Number.isFinite(n) || n <= 0) return 'Duration must be a positive number of minutes.';
  if (n > 480) return 'Duration must be 8 hours or less.';
  if (notes && notes.length > 4000) return 'Notes must be under 4000 characters.';
  return null;
}

/**
 * One row per student, sharing a batch_id when there is more than one.
 *
 * A batch of ONE gets a NULL batch_id, matching the migration's contract. The alternative —
 * minting a batch for every single log — would make `batch_id IS NOT NULL` stop meaning "this was
 * a group sitting", which is the only question the column exists to answer.
 */
export function eiRows({ enrollmentIds, instructorId, startedAt, durationMinutes, notes,
                         batchId = null }) {
  const ids = [...new Set((enrollmentIds || []).filter(Boolean).map(String))];
  const startedISO = toUtcISO(startedAt);
  const batch = ids.length > 1 ? (batchId || newBatchId()) : null;
  const note = (notes || '').trim() || null;
  return ids.map((enrollment_id) => ({
    enrollment_id,
    instructor_id: instructorId || null,
    started_at: startedISO,
    duration_minutes: Number(durationMinutes),
    notes: note,
    batch_id: batch,
  }));
}

export function newBatchId() {
  return (globalThis.crypto?.randomUUID)
    ? globalThis.crypto.randomUUID()
    // Only reached on a browser too old for randomUUID over http. Not cryptographic and does not
    // need to be — this groups rows, it does not authenticate anything.
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

/* ---------------------------------------------------------------------------
 * Reads and writes
 * ------------------------------------------------------------------------- */

/** Every session for one enrolment, newest first. Drives the student detail panel. */
export async function loadEiForEnrollment(enrollmentId) {
  const { data, error } = await db.from('ei_sessions')
    .select(EI_SELECT)
    .eq('enrollment_id', enrollmentId)
    .order('started_at', { ascending: false });
  return { rows: data || [], error };
}

/**
 * Every session across a set of SECTIONS, with the names to label them. Drives P1.8's panel.
 *
 * The name map is built here rather than by the caller because the panel is useless without it —
 * `ei_sessions` keys on the enrolment, so a mini-table of the last five sittings would otherwise
 * be five uuids. One extra column on a query the panel has to make anyway.
 *
 * @returns {{ rows, nameOf }} `nameOf(enrollmentId)` → student name, '' when unknown
 */
export async function loadEiForSections(sectionIds) {
  const none = { rows: [], nameOf: () => '' };
  if (!sectionIds?.length) return none;
  const { data: enrol } = await db.from('enrollments')
    .select('id, students!inner(name)').in('section_id', sectionIds).eq('status', 'active');
  const nameBy = Object.fromEntries((enrol || []).map(e => [e.id, e.students?.name || '']));
  const ids = Object.keys(nameBy);
  if (!ids.length) return none;
  const { rows, error } = await loadEiForEnrollments(ids);
  if (error) throw error;
  return { rows, nameOf: (id) => nameBy[id] || '' };
}

/** Every session across a set of enrolments. Drives the gradebook's EI column and P1.8's stats. */
export async function loadEiForEnrollments(enrollmentIds) {
  const ids = (enrollmentIds || []).filter(Boolean);
  if (!ids.length) return { rows: [], error: null };
  const out = [];
  // Chunked for the same reason faculty-data.js chunks: a course-wide .in() list outgrows the URL.
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('ei_sessions')
      .select(EI_SELECT)
      .in('enrollment_id', ids.slice(i, i + 300))
      .order('started_at', { ascending: false });
    if (error) return { rows: [], error };
    out.push(...(data || []));
  }
  return { rows: out, error: null };
}

/**
 * Write the batch. Rows go SEQUENTIALLY and failures are collected per student.
 *
 * Copied from the P1.12 extension batch, for the reason recorded there: a Promise.all collapses a
 * partial failure into one rejected promise, and the operator is left not knowing which four of
 * six were logged. Six round trips is nothing against the twenty minutes being recorded.
 */
export async function logEi(rows) {
  const results = [];
  for (const row of rows) {
    const { data, error } = await db.from('ei_sessions').insert(row).select('id').maybeSingle();
    results.push({ enrollmentId: row.enrollment_id, id: data?.id || null, error });
  }
  return {
    written: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error),
    results,
  };
}

export async function updateEi(id, patch) {
  return db.from('ei_sessions').update(patch).eq('id', id);
}

export async function deleteEi(id) {
  return db.from('ei_sessions').delete().eq('id', id);
}

/** Every row of one bulk log, so a mistyped duration is one edit rather than six. */
export async function updateEiBatch(batchId, patch) {
  return db.from('ei_sessions').update(patch).eq('batch_id', batchId);
}

/* ---------------------------------------------------------------------------
 * Summary — the shape P1.8's dashboard widget will want
 * ------------------------------------------------------------------------- */

/**
 * `djGradebookProject`'s get_ei_stats() scope, which the roadmap calls the right one: total
 * visits, unique students, and the last five. Two big numbers and a mini-table, nothing more.
 *
 * Pure, so P1.8 is a render against this rather than a second query.
 */
export function summarizeEi(rows) {
  const list = (rows || []).filter(Boolean);
  const byTime = [...list].sort((a, b) =>
    String(b.started_at || '').localeCompare(String(a.started_at || '')));
  return {
    total: list.length,
    uniqueStudents: new Set(list.map((r) => String(r.enrollment_id))).size,
    totalMinutes: list.reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0),
    // A batch is one sitting however many cadets were in it. Counting rows would tell a director
    // they held 40 sessions when they held 9.
    //
    // Counted as "distinct batches + ungrouped rows" rather than by building a key out of `id`.
    // An id-derived key silently collapses every unsaved row onto `solo:undefined`, so feeding
    // this the output of eiRows() — which has no ids yet — would report six sittings as one.
    // Nothing does that today; this shape simply cannot.
    sittings: new Set(list.filter((r) => r.batch_id).map((r) => r.batch_id)).size
            + list.filter((r) => !r.batch_id).length,
    recent: byTime.slice(0, 5),
  };
}

/* ---------------------------------------------------------------------------
 * The dashboard panel (roadmap P1.8)
 * ------------------------------------------------------------------------- */

/**
 * Two big numbers and a mini-table — `djGradebookProject`'s get_ei_stats() scope, which the
 * roadmap calls the right one, rendered against summarizeEi() rather than a second query.
 *
 * SITTINGS, NOT ROWS, is the headline number and that choice is the whole reason this is worth
 * writing carefully. A batch of six cadets after class is ONE session; counting rows would tell a
 * director they held forty sessions in a week when they held nine, and an inflated number on a
 * dashboard is how the dashboard stops being read. The row count is still available as the
 * cadets-seen figure beside it, where it means something ("how many people did I actually reach").
 *
 * NOTHING LOGGED RENDERS NOTHING, matching the due-out row's rule directly above it: most
 * instructors have zero EI in week one, and a permanent `0` teaches people to skip the whole
 * region of the page.
 *
 * Pure — string in, string out — so the empty case and the sittings arithmetic are testable
 * without a database or a DOM.
 *
 * @param {object} stats     a summarizeEi() result
 * @param {object} opts      { esc, fmtDate, nameOf(enrollmentId) -> string, scoped }
 */
export function renderEiPanel(stats, { esc, fmtDate, nameOf = () => '', scoped = false } = {}) {
  if (!stats || !stats.total) return '';

  const s = stats.sittings;
  const u = stats.uniqueStudents;
  const rows = stats.recent.map((r) => `<tr>
      <td class="muted">${esc(fmtDate(r.started_at))}</td>
      <td>${esc(nameOf(r.enrollment_id) || '—')}</td>
      <td>${esc(fmtDuration(r.duration_minutes))}</td>
      <td class="muted">${esc(r.instructors?.name || '—')}</td>
    </tr>`).join('');

  return `<section class="dash-section ei-panel">
    <div class="section-head"><h2>🧑‍🏫 Extra instruction</h2>
      <span class="muted ei-scope">${scoped ? 'your sections' : 'all sections you staff'}</span>
      <span class="grow"></span>
      <a class="duo-link" href="gradebook.html">Log a session →</a></div>
    <div class="card ei-card">
      <div class="ei-nums">
        <div class="ei-num"><div class="ei-n">${s}</div>
          <div class="ei-l">sitting${s === 1 ? '' : 's'}</div>
          <div class="ei-s">a group counts once</div></div>
        <div class="ei-num"><div class="ei-n">${u}</div>
          <div class="ei-l">cadet${u === 1 ? '' : 's'} seen</div>
          <div class="ei-s">${fmtDuration(stats.totalMinutes)} logged in total</div></div>
      </div>
      <div class="table-wrap"><table class="ei-recent">
        <thead><tr><th>When</th><th>Cadet</th><th>Length</th><th>Logged by</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>
  </section>`;
}
