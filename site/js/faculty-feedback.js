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
//   COMPLETION DOES NOT SUBTRACT FROM IT — see `pendingRoadmap()`.
//
// DECISION vs OUTCOME (migration 018)
//   `status` is the triage DECISION and stays the four values 013 chose. Whether the work was
//   actually done is a SEPARATE axis, `completed_at`, because it is an outcome rather than a
//   decision — and because a fifth status would have collided with two things 013 built (018's
//   header has the detail). The UI does not make anyone hold that distinction in their head: the
//   two axes are flattened into one five-way BUCKET for display, and buckets are what the matrix
//   counts and the filter matches.

import { db } from './supabase.js';

export const FEEDBACK_SELECT =
  'id,submitted_by,submitter_name,role,page,page_title,category,message,created_at,'
  + 'status,resolution_note,roadmap_ref,resolved_by,resolved_at,updated_at,'
  + 'completed_at,completed_by,'
  + 'triage,agent_note,agent_ref,agent_at,director_instructions,decided_by,decided_at';

/**
 * The four decisions a person makes BY HAND, in the order they are offered. Deliberately few — these are the
 * choices somebody will actually make in one sitting. Anything that becomes real work is the
 * roadmap's to track, not this table's.
 */
export const STATUSES = [
  { key: 'new',       label: 'New',       hint: 'Not yet triaged' },
  { key: 'accepted',  label: 'Accepted',  hint: 'Agreed — should be built' },
  { key: 'declined',  label: 'Declined',  hint: 'Not going to do this' },
  { key: 'duplicate', label: 'Duplicate', hint: 'Already captured elsewhere' },
];

/**
 * The two states only the triage agent's workflow reaches (migration 089): `proposed` (a plan,
 * waiting for the director to approve or deny) and `applied` (the agent made the change, waiting
 * for the director's closeout). They have their own card controls, not buttons in the segmented
 * decision control, so STATUSES above stays the four a person picks.
 */
export const AGENT_STATUSES = [
  { key: 'proposed', label: 'Proposed', hint: 'The agent proposes a change and waits for you' },
  { key: 'applied',  label: 'Applied',  hint: 'The agent made the change and waits for your closeout' },
];

/** Every status the database accepts (feedback_status_ck, migration 089). */
export const STATUS_KEYS = [...STATUSES, ...AGENT_STATUSES].map((s) => s.key);

/**
 * The eight DISPLAY buckets, in the order they are shown — the DB axes (`status`, `completed_at`)
 * flattened into the one dimension a person reads. What waits on the director comes first:
 * a proposal needs his answer, an applied change needs his closeout.
 *
 * `completed` is accepted OR applied with a completion stamp, so "agreed to and done" and "the
 * agent did it and I closed it out" read the same: finished.
 *
 * `closed` marks the buckets with no work left in them. That flag is the single source of the
 * open-list / completed-drawer split — add a bucket here and both the matrix and the drawer follow.
 */
export const BUCKETS = [
  { key: 'proposed',  label: 'Awaiting you',      hint: 'The agent proposed a change; approve or deny',  closed: false },
  { key: 'applied',   label: 'Applied',           hint: 'The agent made the change; awaiting closeout',  closed: false },
  { key: 'new',       label: 'New',               hint: 'Not yet triaged',                               closed: false },
  { key: 'accepted',  label: 'In progress',       hint: 'Agreed — still to build',                       closed: false },
  { key: 'completed', label: 'Completed',         hint: 'Built, and closed out',                         closed: true },
  { key: 'declined',  label: 'Declined',          hint: 'Not going to do this',                          closed: true },
  { key: 'duplicate', label: 'Duplicate',         hint: 'Already captured elsewhere',                    closed: true },
];

export const BUCKET_KEYS = BUCKETS.map((b) => b.key);

const CLOSED_KEYS = new Set(BUCKETS.filter((b) => b.closed).map((b) => b.key));

/* ---------------------------------------------------------------------------
 * Pure logic
 * ------------------------------------------------------------------------- */

/** Completion is a timestamp, not a flag — `completed_at` is the whole fact. */
export function isCompleted(row) {
  return !!row?.completed_at;
}

/**
 * Which bucket a row displays in. An unrecognised status counts as 'new' rather than vanishing:
 * a row dropped here would make the matrix totals quietly disagree with the list beneath them.
 */
export function bucketOf(row) {
  const status = STATUS_KEYS.includes(row?.status) ? row.status : 'new';
  return (status === 'accepted' || status === 'applied') && isCompleted(row) ? 'completed' : status;
}

/** Finished — completed, declined or duplicate. Nothing is being waited on. */
export function isClosed(row) {
  return CLOSED_KEYS.has(bucketOf(row));
}

/** Where a bucket sits in the display order (proposals first). Unknown buckets sort last. */
export function bucketRank(row) {
  const i = BUCKET_KEYS.indexOf(bucketOf(row));
  return i < 0 ? BUCKET_KEYS.length : i;
}

/**
 * Open rows in the order the page shows them: what waits on the director first, then by bucket.
 * Stable, so within a bucket the query's newest-first order survives.
 */
export function sortOpen(rows) {
  return (rows || []).map((r, i) => ({ r, i }))
    .sort((a, b) => bucketRank(a.r) - bucketRank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The list split the page is built around: what still wants attention, and what is finished.
 *
 * Order is preserved within each half, so both keep the newest-first ordering the query applied.
 */
export function splitByClosure(rows) {
  const open = [];
  const closed = [];
  for (const r of rows || []) (isClosed(r) ? closed : open).push(r);
  return { open, closed };
}

/** A stable, readable key for the page a comment was left on. */
export function pageKey(row) {
  const t = (row?.page_title || '').trim();
  if (t) return t;
  const p = (row?.page || '').trim();
  if (!p) return '(unknown)';
  return p.split('/').pop() || p;
}

/**
 * The matrix: one row per page, one column per BUCKET, plus a total.
 *
 * This is the part that makes a pile of comments legible. Sorted by the count of UNRESOLVED items
 * first, because the question an admin opens this page with is "what still needs a decision", not
 * "which page is most popular". Ties break on total, then name, so the order is stable across
 * reloads rather than shuffling as rows are resolved.
 *
 * Columns are buckets rather than statuses so they still sum to the total: 'Accepted' means
 * accepted-and-outstanding and 'Done' is its own column, so a page's counts say how much work is
 * left on it rather than how much was ever agreed to.
 */
export function buildMatrix(rows) {
  const byPage = new Map();
  for (const r of rows || []) {
    const key = pageKey(r);
    if (!byPage.has(key)) {
      byPage.set(key, { page: key, path: r?.page || '', total: 0, open: 0,
                        ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0])) });
    }
    const cell = byPage.get(key);
    cell[bucketOf(r)] += 1;
    cell.total += 1;
    if (!isClosed(r)) cell.open += 1;
  }
  const pages = [...byPage.values()].sort((a, b) =>
    b.proposed - a.proposed || b.new - a.new || b.total - a.total || a.page.localeCompare(b.page));

  const totals = { total: 0, open: 0, ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0])) };
  for (const p of pages) {
    totals.total += p.total;
    totals.open += p.open;
    BUCKET_KEYS.forEach((k) => { totals[k] += p[k]; });
  }
  return { pages, totals };
}

/**
 * The roadmap skill's work list: accepted, but not yet written down.
 *
 * Mirrors the partial index and the contract stated in migration 013. Kept here as a function
 * rather than left to each caller to re-derive, so the browser and the future skill cannot end up
 * disagreeing about what "still to be rolled in" means.
 *
 * COMPLETION IS DELIBERATELY NOT SUBTRACTED. A shipped item is still unwritten-down, and
 * ROADMAP.md §8 records what landed — so a completed item without a ref belongs on this list
 * exactly as much as an outstanding one, it just goes to §8 instead of a priority band. Do not
 * "fix" this by excluding completed rows; migration 018's header says the same thing about the
 * partial index, and the two must not drift apart.
 */
export function pendingRoadmap(rows) {
  return (rows || []).filter((r) => r?.status === 'accepted' && !r?.roadmap_ref);
}

/** Filter the list for the cards below the matrix. `page`/`bucket` of null mean "everything". */
export function filterRows(rows, { bucket = null, page = null, q = null } = {}) {
  const needle = (q || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (bucket && bucketOf(r) !== bucket) return false;
    if (page && pageKey(r) !== page) return false;
    if (needle) {
      const hay = `${r?.message || ''} ${r?.submitter_name || ''} ${r?.resolution_note || ''} ${r?.agent_note || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Validate a resolution before it is written. Every rule mirrors a migration-013 constraint so the
 * admin gets a sentence rather than a Postgres constraint name.
 */
export function validateResolution({ status, resolutionNote, roadmapRef, completed }) {
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
  // Mirrors feedback_completed_accepted_ck (018). Reachable by un-accepting a done item, which is
  // a normal thing to do — the card clears the tick for you, but say why if it is ever forced.
  if (completed && status !== 'accepted') {
    return 'Only an accepted item can be marked done.';
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
 *
 * `completedAt`/`completedBy` are the row's EXISTING values, passed back in so an unrelated edit
 * does not re-stamp them. Without that, "done on" would drift forward every time somebody fixed a
 * typo in the note, and would mean "last touched" rather than "finished".
 */
export function resolutionPatch({ status, resolutionNote, roadmapRef, completed,
                                  completedAt = null, completedBy = null,
                                  adminId, now = new Date() }) {
  const decided = status && status !== 'new';
  const ref = (roadmapRef || '').trim();
  // Belt and braces with validateResolution and with feedback_completed_accepted_ck: withdrawing
  // the acceptance withdraws the completion in the same write, so the CHECK cannot reject it and
  // no "done" is left hanging off a row nobody agreed to.
  const done = !!completed && status === 'accepted';
  return {
    status,
    resolution_note: (resolutionNote || '').trim() || null,
    // Belt and braces with validateResolution: a ref can only ride on an accepted row.
    roadmap_ref: status === 'accepted' ? (ref || null) : null,
    resolved_by: decided ? (adminId || null) : null,
    resolved_at: decided ? now.toISOString() : null,
    completed_at: done ? (completedAt || now.toISOString()) : null,
    completed_by: done ? (completedBy || adminId || null) : null,
  };
}

/* ---------------------------------------------------------------------------
 * The agent's proposals and applied changes (migration 089)
 * ------------------------------------------------------------------------- */

/** True when the row is a plan waiting for the director's answer. */
export function isProposal(row) { return row?.status === 'proposed'; }

/** True when the agent made the change and the director has not yet closed it out. */
export function isAwaitingCloseout(row) { return row?.status === 'applied' && !isCompleted(row); }

/** Validate the instructions text before approving or denying. */
export function validateInstructions(text) {
  return (text || '').length > 4000 ? 'The instructions are longer than 4000 characters — trim them a little.' : null;
}

/**
 * Approve a proposal. Stamps both the 013 decision fields and the 089 ones, so the card and the
 * older "decided" line agree. Empty instructions are NULL, never ''.
 */
export function approvalPatch({ instructions, adminId, now = new Date() }) {
  const at = now.toISOString();
  return {
    status: 'accepted',
    director_instructions: (instructions || '').trim() || null,
    decided_by: adminId || null,
    decided_at: at,
    resolved_by: adminId || null,
    resolved_at: at,
  };
}

/** Deny a proposal. Any text typed is kept as the reason, in director_instructions. */
export function denialPatch({ instructions, adminId, now = new Date() }) {
  return { ...approvalPatch({ instructions, adminId, now }), status: 'declined' };
}

/**
 * Close out an applied change: the same completion stamp the accepted tick writes. An existing
 * stamp is kept so a second click can never re-date it.
 */
export function closeoutPatch({ completedAt = null, completedBy = null, adminId, now = new Date() }) {
  return {
    completed_at: completedAt || now.toISOString(),
    completed_by: completedBy || adminId || null,
  };
}

/** The commit URL for an agent_ref that looks like a sha (7 to 40 hex characters), else null. */
export const COMMIT_BASE = 'https://github.com/dfpm-physics/Core_Preflights/commit/';
export function commitUrl(ref) {
  const r = (ref || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(r) ? COMMIT_BASE + r.toLowerCase() : null;
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
