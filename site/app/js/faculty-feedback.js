// faculty-feedback.js — the comment resolution matrix (site admins only).
//
// The other half of the feedback box: 012 gave people somewhere to put a comment, this is where
// each one reaches a DECISION. A suggestion box nobody is seen to act on stops being used, so the
// unit of work here is closure — every comment ends up accepted, declined or marked duplicate, and
// an accepted one carries a recorded destination in the roadmap.
//
// EVERY ROW IS A FREE RESPONSE
//   The view is specified as being only for free responses, and that needs no filter: `message` is
//   NOT NULL with a non-blank CHECK while the like/dislike sentiment is optional (012), so a
//   bare-reaction row cannot exist. Every row already IS a comment. The sentiment renders beside
//   the text as context and is never the subject of the workflow.
//
// SITE ADMINS ONLY
//   `is_admin()` (= instructors.is_global_admin) gates SELECT and UPDATE in the database (012, 013).
//   The nav entry and the page guard are convenience, not the boundary — a director who types the
//   URL gets an empty list from RLS, not a filtered one from us.
//
// THE HANDOFF TO THE ROADMAP SKILL (not built yet, on purpose)
//   `pendingRoadmap()` below is the exact work list that skill will consume:
//   accepted, and not yet written down. Stamping `roadmap_ref` is what removes a row from it.

import { db } from './supabase.js';

export const FEEDBACK_SELECT =
  'id,submitted_by,submitter_name,role,page,page_title,category,message,created_at,'
  + 'status,resolution_note,roadmap_ref,resolved_by,resolved_at,updated_at';

/**
 * The four triage decisions, in the order they are offered. Deliberately few — these are the
 * choices somebody will actually make in one sitting. Anything that becomes real work is the
 * roadmap's to track, not this table's.
 */
export const STATUSES = [
  { key: 'new',       label: 'New',       hint: 'Not yet triaged' },
  { key: 'accepted',  label: 'Accepted',  hint: 'Agreed — should be built' },
  { key: 'declined',  label: 'Declined',  hint: 'Not going to do this' },
  { key: 'duplicate', label: 'Duplicate', hint: 'Already captured elsewhere' },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);

/* ---------------------------------------------------------------------------
 * Pure logic
 * ------------------------------------------------------------------------- */

/** A stable, readable key for the page a comment was left on. */
export function pageKey(row) {
  const t = (row?.page_title || '').trim();
  if (t) return t;
  const p = (row?.page || '').trim();
  if (!p) return '(unknown)';
  return p.split('/').pop() || p;
}

/**
 * The matrix: one row per page, one column per status, plus a total.
 *
 * This is the part that makes a pile of comments legible. Sorted by the count of UNRESOLVED items
 * first, because the question an admin opens this page with is "what still needs a decision", not
 * "which page is most popular". Ties break on total, then name, so the order is stable across
 * reloads rather than shuffling as rows are resolved.
 */
export function buildMatrix(rows) {
  const byPage = new Map();
  for (const r of rows || []) {
    const key = pageKey(r);
    if (!byPage.has(key)) {
      byPage.set(key, { page: key, path: r?.page || '', total: 0,
                        ...Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])) });
    }
    const cell = byPage.get(key);
    const st = STATUS_KEYS.includes(r?.status) ? r.status : 'new';
    cell[st] += 1;
    cell.total += 1;
  }
  const pages = [...byPage.values()].sort((a, b) =>
    b.new - a.new || b.total - a.total || a.page.localeCompare(b.page));

  const totals = { total: 0, ...Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])) };
  for (const p of pages) {
    totals.total += p.total;
    STATUS_KEYS.forEach((k) => { totals[k] += p[k]; });
  }
  return { pages, totals };
}

/**
 * The roadmap skill's work list: accepted, but not yet written down.
 *
 * Mirrors the partial index and the contract stated in migration 013. Kept here as a function
 * rather than left to each caller to re-derive, so the browser and the future skill cannot end up
 * disagreeing about what "still to be rolled in" means.
 */
export function pendingRoadmap(rows) {
  return (rows || []).filter((r) => r?.status === 'accepted' && !r?.roadmap_ref);
}

/** Filter the list for the table below the matrix. `page`/`status` of null mean "everything". */
export function filterRows(rows, { status = null, page = null, q = null } = {}) {
  const needle = (q || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (status && (r?.status || 'new') !== status) return false;
    if (page && pageKey(r) !== page) return false;
    if (needle) {
      const hay = `${r?.message || ''} ${r?.submitter_name || ''} ${r?.resolution_note || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Validate a resolution before it is written. Every rule mirrors a migration-013 constraint so the
 * admin gets a sentence rather than a Postgres constraint name.
 */
export function validateResolution({ status, resolutionNote, roadmapRef }) {
  if (!STATUS_KEYS.includes(status)) return 'Pick a status.';
  const note = (resolutionNote || '').trim();
  if (note.length > 2000) return 'The note is longer than 2000 characters — trim it a little.';
  const ref = (roadmapRef || '').trim();
  if (ref.length > 60) return 'A roadmap reference should be an id like "P1.16", not a description.';
  // The DB refuses this too (feedback_roadmap_ref_accepted_ck); saying so here explains WHY, which
  // the constraint name cannot.
  if (ref && status !== 'accepted') {
    return 'Only an accepted item can carry a roadmap reference.';
  }
  return null;
}

/**
 * Build the UPDATE payload.
 *
 * `resolved_at`/`resolved_by` are stamped for any real decision and cleared when a row is put back
 * to 'new', so "who decided this, and when" never survives the decision being withdrawn — an
 * attribution left behind on an untriaged row would be read as a decision nobody made.
 *
 * Empty strings become NULL rather than '': the roadmap_ref CHECK forbids a blank string, and more
 * importantly the skill's work list keys on IS NULL, which '' would silently fail.
 */
export function resolutionPatch({ status, resolutionNote, roadmapRef, adminId, now = new Date() }) {
  const decided = status && status !== 'new';
  const ref = (roadmapRef || '').trim();
  return {
    status,
    resolution_note: (resolutionNote || '').trim() || null,
    // Belt and braces with validateResolution: a ref can only ride on an accepted row.
    roadmap_ref: status === 'accepted' ? (ref || null) : null,
    resolved_by: decided ? (adminId || null) : null,
    resolved_at: decided ? now.toISOString() : null,
  };
}

/* ---------------------------------------------------------------------------
 * Reads and writes
 * ------------------------------------------------------------------------- */

/**
 * Every comment, newest first.
 *
 * Unbounded on purpose, and safe to be: this table grows by human typing, not by enrollment, so it
 * is measured in hundreds a term rather than the tens of thousands the gradebook had to worry
 * about. RLS returns nothing at all to a non-admin, so there is no scoping argument to get wrong.
 */
export async function loadFeedback() {
  const { data, error } = await db.from('feedback')
    .select(FEEDBACK_SELECT)
    .order('created_at', { ascending: false });
  return { rows: data || [], error };
}

export async function saveResolution(id, patch) {
  return db.from('feedback').update(patch).eq('id', id);
}
