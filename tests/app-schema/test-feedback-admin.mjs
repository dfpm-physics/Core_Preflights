// test-feedback-admin.mjs — the comment resolution matrix (faculty-feedback.js).
//
// What this suite protects is the HANDOFF. The director's plan is that accepted feedback gets
// rolled into docs/ROADMAP.md by a skill that does not exist yet, and that skill's entire work list
// is one predicate: accepted, and not yet written down. If `pendingRoadmap` and `resolutionPatch`
// ever disagree about what "written down" means — most easily by letting an empty string sit in
// `roadmap_ref` where NULL was meant — the skill silently stops seeing items it should process, and
// nobody notices because the UI still looks right. Several checks below exist only for that.
//
// The rest pins the migration-013 constraints in the browser, so an admin gets a sentence instead
// of a Postgres constraint name, and pins the matrix's sort order, which is the thing that makes a
// pile of comments legible.
//
// The second handoff, added with migration 018, is DECISION vs OUTCOME. `status` stays the four
// triage values; `completed_at` is a separate axis; the UI flattens the two into one five-way
// bucket. Two ways that can silently go wrong, both checked below: completion leaking into the
// roadmap work list (it must NOT — a shipped item still wants a ROADMAP §8 line), and a stamp that
// re-dates itself on an unrelated edit, which would turn "done on" into "last touched".

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/feedback.html' });
globalThis.window.db = makeClient();

const F = await import('../../site/js/faculty-feedback.js');

const row = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  submitter_name: o.name || 'Dr. Ada Byron',
  role: o.role || 'faculty',
  page: o.page || '/site/faculty/gradebook.html',
  page_title: o.page_title === undefined ? 'Gradebook · PREP' : o.page_title,
  category: o.category || 'other',
  message: o.message || 'a comment',
  status: o.status || 'new',
  roadmap_ref: o.roadmap_ref === undefined ? null : o.roadmap_ref,
  resolution_note: o.resolution_note || null,
  completed_at: o.completed_at === undefined ? null : o.completed_at,
  completed_by: o.completed_by === undefined ? null : o.completed_by,
  created_at: o.created_at || '2026-07-23T12:00:00.000Z',
});

const DONE = '2026-07-26T09:00:00.000Z';

/* ══════════════════════════════════════════════════════════════════════════ */
section('statuses — the four triage decisions, and no more');

eq('exactly four statuses, in offer order', F.STATUS_KEYS,
   ['new', 'accepted', 'declined', 'duplicate']);
check('every status carries a label and a hint',
      F.STATUSES.every((s) => s.label && s.hint));
// There is deliberately no 'roadmapped' status — being written down is roadmap_ref, not a state.
check('there is no roadmapped status (that fact lives in roadmap_ref)',
      !F.STATUS_KEYS.includes('roadmapped'));
// Nor a 'completed' one. 018 made completion a COLUMN precisely so it could not collide with
// feedback_roadmap_ref_accepted_ck or silently drop rows out of the roadmap work list.
check('completion is not a status — it is a separate axis (migration 018)',
      !F.STATUS_KEYS.includes('completed'));

/* ══════════════════════════════════════════════════════════════════════════ */
section('buckets — the two DB axes flattened into what a person reads');

eq('five buckets, open first then closed', F.BUCKET_KEYS,
   ['new', 'accepted', 'completed', 'declined', 'duplicate']);
eq('an accepted item with no completion is still just accepted',
   F.bucketOf(row({ status: 'accepted' })), 'accepted');
eq('an accepted item that was built becomes its own bucket',
   F.bucketOf(row({ status: 'accepted', completed_at: DONE })), 'completed');
eq('the unrecognised-status rule survives bucketing',
   F.bucketOf(row({ status: 'weird' })), 'new');
// The CHECK forbids this pair in the database, so it can only arrive from a hand-edited row — but
// bucketing it as 'declined' rather than 'completed' keeps the UI honest about the decision.
eq('a stray completion on a non-accepted row does not promote it',
   F.bucketOf(row({ status: 'declined', completed_at: DONE })), 'declined');
eq('a null row buckets as new rather than throwing', F.bucketOf(null), 'new');

check('completion is read from the timestamp, not a flag',
      F.isCompleted(row({ completed_at: DONE })) && !F.isCompleted(row()));

/* ══════════════════════════════════════════════════════════════════════════ */
section('splitByClosure — what the main list shows vs what the drawer holds');
{
  const { open, closed } = F.splitByClosure([
    row({ id: 'n', status: 'new' }),
    row({ id: 'a', status: 'accepted' }),
    row({ id: 'c', status: 'accepted', completed_at: DONE }),
    row({ id: 'd', status: 'declined' }),
    row({ id: 'u', status: 'duplicate' }),
  ]);
  // The whole request: an item marked accepted AND completed leaves the main view.
  eq('open is what still needs acting on', open.map((r) => r.id), ['n', 'a']);
  eq('closed is everything finished', closed.map((r) => r.id), ['c', 'd', 'u']);
  // Both halves feed lists that are meant to read newest-first, so neither may re-sort.
  eq('input order is preserved within each half',
     F.splitByClosure([row({ id: '1' }), row({ id: '2' })]).open.map((r) => r.id), ['1', '2']);
  eq('a null list does not throw', F.splitByClosure(null).open.length, 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('pageKey — a readable, stable row label');

eq('the page title is preferred', F.pageKey(row({ page_title: 'Gradebook · PREP' })), 'Gradebook · PREP');
eq('falls back to the file name when there is no title',
   F.pageKey(row({ page_title: null, page: '/site/faculty/grade.html' })), 'grade.html');
eq('an unknown page is labelled, not blank',
   F.pageKey({ page: '', page_title: '' }), '(unknown)');
eq('a null row does not throw', F.pageKey(null), '(unknown)');

/* ══════════════════════════════════════════════════════════════════════════ */
section('buildMatrix — page x bucket cross-tab');

const rows = [
  row({ page_title: 'Gradebook · PREP', status: 'new' }),
  row({ page_title: 'Gradebook · PREP', status: 'new' }),
  row({ page_title: 'Gradebook · PREP', status: 'accepted', roadmap_ref: 'P1.16' }),
  row({ page_title: 'Grade · PREP', status: 'declined' }),
  row({ page_title: 'Grade · PREP', status: 'duplicate' }),
  row({ page_title: 'Roster · PREP', status: 'new' }),
];
const m = F.buildMatrix(rows);

eq('one row per distinct page', m.pages.length, 3);
eq('cells count per status', [m.pages[0].page, m.pages[0].new, m.pages[0].accepted], ['Gradebook · PREP', 2, 1]);
eq('the page total is the sum of its cells', m.pages[0].total, 3);
eq('column totals add up across pages', [m.totals.new, m.totals.accepted, m.totals.declined, m.totals.duplicate],
   [3, 1, 1, 1]);
eq('the grand total is every comment', m.totals.total, 6);

// The sort is the point of the matrix: an admin opens this asking "what still needs a decision",
// so the page with the most untriaged comments leads — not the busiest page.
eq('pages sort by UNTRIAGED count first', m.pages.map((p) => p.page),
   ['Gradebook · PREP', 'Roster · PREP', 'Grade · PREP']);

// Stability matters — rows must not shuffle as unrelated items are resolved.
{
  const tied = F.buildMatrix([
    row({ page_title: 'B page', status: 'new' }),
    row({ page_title: 'A page', status: 'new' }),
  ]);
  eq('an exact tie breaks alphabetically, so the order is stable', tied.pages.map((p) => p.page),
     ['A page', 'B page']);
}

eq('no rows yields an empty matrix rather than throwing', F.buildMatrix([]).totals.total, 0);
eq('a null list is treated as empty', F.buildMatrix(null).pages.length, 0);
// A row with a status the UI does not know must still be counted somewhere, or the matrix totals
// would silently disagree with the list beneath it.
eq('an unrecognised status is counted as new rather than dropped',
   F.buildMatrix([row({ status: 'weird' })]).totals.new, 1);

{
  // The Accepted column must mean "agreed to and STILL TO BUILD". If a completed item kept
  // counting there, the column would say how much was ever agreed to rather than how much is
  // left — which is the number an admin is actually reading it for.
  const m2 = F.buildMatrix([
    row({ page_title: 'P', status: 'accepted' }),
    row({ page_title: 'P', status: 'accepted', completed_at: DONE }),
    row({ page_title: 'P', status: 'new' }),
  ]);
  eq('a completed item leaves the Accepted column', m2.totals.accepted, 1);
  eq('and lands in its own', m2.totals.completed, 1);
  eq('the columns still sum to the total', m2.totals.total, 3);
  eq('open counts only the unfinished buckets', m2.totals.open, 2);
  eq('the per-page open count matches', m2.pages[0].open, 2);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('pendingRoadmap — the work list the future skill consumes');

const pend = F.pendingRoadmap([
  row({ id: 'a', status: 'accepted', roadmap_ref: null }),
  row({ id: 'b', status: 'accepted', roadmap_ref: 'P1.16' }),
  row({ id: 'c', status: 'new' }),
  row({ id: 'd', status: 'declined' }),
]);
eq('only accepted-and-unwritten items are pending', pend.map((r) => r.id), ['a']);
// The failure this guards: '' is not NULL, and `roadmap_ref IS NULL` in SQL would not match it.
check('an empty-string ref must NOT count as written down',
      F.pendingRoadmap([row({ id: 'e', status: 'accepted', roadmap_ref: '' })]).length === 1,
      'an empty string is not a roadmap reference');
// Deliberate, and the thing most likely to be "fixed" by mistake: ROADMAP.md §8 records what
// LANDED, so a shipped item still wants a line. Migration 018's header says the same about the
// partial index — if this ever flips, flip both.
eq('completion does NOT remove an item from the roadmap work list',
   F.pendingRoadmap([row({ id: 'f', status: 'accepted', completed_at: DONE })]).length, 1);

/* ══════════════════════════════════════════════════════════════════════════ */
section('filterRows — the matrix cells drive this');

const fr = [
  row({ id: '1', page_title: 'Gradebook · PREP', status: 'new', message: 'add CSV export' }),
  row({ id: '2', page_title: 'Grade · PREP', status: 'accepted', message: 'colours are unclear' }),
  row({ id: '3', page_title: 'Gradebook · PREP', status: 'accepted', message: 'sticky column please' }),
];
eq('no filter returns everything', F.filterRows(fr, {}).length, 3);
eq('by bucket', F.filterRows(fr, { bucket: 'accepted' }).map((r) => r.id), ['2', '3']);
eq('by page', F.filterRows(fr, { page: 'Gradebook · PREP' }).map((r) => r.id), ['1', '3']);
eq('by page AND bucket together — what a matrix cell means',
   F.filterRows(fr, { page: 'Gradebook · PREP', bucket: 'accepted' }).map((r) => r.id), ['3']);
// The Done cell has to reach its rows, or the column would be a count you cannot click through.
eq('the completed bucket is filterable',
   F.filterRows([...fr, row({ id: '4', status: 'accepted', completed_at: DONE })],
                { bucket: 'completed' }).map((r) => r.id), ['4']);
eq('search matches the comment text', F.filterRows(fr, { q: 'csv' }).map((r) => r.id), ['1']);
eq('search is case-insensitive', F.filterRows(fr, { q: 'CSV' }).map((r) => r.id), ['1']);
eq('search also matches the submitter', F.filterRows(fr, { q: 'ada' }).length, 3);

/* ══════════════════════════════════════════════════════════════════════════ */
section('validateResolution — mirrors the migration-013 constraints');

eq('a plain accepted decision passes',
   F.validateResolution({ status: 'accepted', resolutionNote: 'good idea', roadmapRef: 'P1.16' }), null);
eq('a decision with no note or ref passes',
   F.validateResolution({ status: 'declined', resolutionNote: '', roadmapRef: '' }), null);
check('an unknown status is rejected', !!F.validateResolution({ status: 'nope' }));
check('a note over 2000 chars is rejected',
      !!F.validateResolution({ status: 'new', resolutionNote: 'x'.repeat(2001) }));
check('a roadmap ref over 60 chars is rejected (it is an id, not a description)',
      !!F.validateResolution({ status: 'accepted', roadmapRef: 'x'.repeat(61) }));
// Mirrors feedback_roadmap_ref_accepted_ck. Explaining WHY is the whole reason to duplicate it.
check('a roadmap ref on a NON-accepted row is rejected',
      !!F.validateResolution({ status: 'declined', roadmapRef: 'P1.16' }));
// Mirrors feedback_completed_accepted_ck (018).
check('marking a NON-accepted row done is rejected',
      !!F.validateResolution({ status: 'declined', completed: true }));
eq('an accepted row may be marked done',
   F.validateResolution({ status: 'accepted', completed: true }), null);
check('every rejection is a human sentence',
      typeof F.validateResolution({ status: 'nope' }) === 'string');

/* ══════════════════════════════════════════════════════════════════════════ */
section('resolutionPatch — what actually gets written');

const NOW = new Date('2026-07-23T18:00:00.000Z');
{
  const p = F.resolutionPatch({ status: 'accepted', resolutionNote: '  yes  ',
                                roadmapRef: ' P1.16 ', adminId: 'admin-1', now: NOW });
  eq('status is written', p.status, 'accepted');
  eq('the note is trimmed', p.resolution_note, 'yes');
  eq('the ref is trimmed', p.roadmap_ref, 'P1.16');
  eq('the decider is attributed', p.resolved_by, 'admin-1');
  eq('the decision is timestamped', p.resolved_at, NOW.toISOString());
}
{
  // Empty must become NULL, not '' — the skill's work list keys on IS NULL and '' would break it
  // silently while looking correct in the UI.
  const p = F.resolutionPatch({ status: 'accepted', resolutionNote: '   ', roadmapRef: '   ',
                                adminId: 'a', now: NOW });
  eq('a blank note becomes NULL', p.resolution_note, null);
  eq('a blank ref becomes NULL, so the item stays on the work list', p.roadmap_ref, null);
}
{
  // Belt and braces with validateResolution — a ref must never ride on a non-accepted row, or the
  // DB CHECK rejects the write and the admin sees a constraint name.
  const p = F.resolutionPatch({ status: 'declined', roadmapRef: 'P1.16', adminId: 'a', now: NOW });
  eq('a ref is dropped when the status is not accepted', p.roadmap_ref, null);
}
{
  // Withdrawing a decision must withdraw its attribution too: an admin name left on an untriaged
  // row reads as a decision that nobody made.
  const p = F.resolutionPatch({ status: 'new', resolutionNote: 'never mind', adminId: 'a', now: NOW });
  eq('going back to new clears the decider', p.resolved_by, null);
  eq('going back to new clears the timestamp', p.resolved_at, null);
  eq('going back to new drops any ref', p.roadmap_ref, null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('resolutionPatch — the completion stamp (migration 018)');
{
  const p = F.resolutionPatch({ status: 'accepted', completed: true, adminId: 'admin-1', now: NOW });
  eq('completing stamps the time', p.completed_at, NOW.toISOString());
  eq('and attributes it', p.completed_by, 'admin-1');
}
{
  // The bug this prevents: fixing a typo in the note re-dates the completion, and "done on"
  // quietly becomes "last touched". The row's existing stamp always wins.
  const p = F.resolutionPatch({ status: 'accepted', completed: true, resolutionNote: 'edited later',
                                completedAt: DONE, completedBy: 'admin-1',
                                adminId: 'admin-2', now: NOW });
  eq('an unrelated edit does not re-date an existing completion', p.completed_at, DONE);
  eq('nor reassign who finished it', p.completed_by, 'admin-1');
}
{
  const p = F.resolutionPatch({ status: 'accepted', completed: false, completedAt: DONE,
                               completedBy: 'admin-1', adminId: 'a', now: NOW });
  eq('unticking clears the stamp', p.completed_at, null);
  eq('and the attribution with it', p.completed_by, null);
}
{
  // Belt and braces with feedback_completed_accepted_ck: withdrawing the acceptance must withdraw
  // the completion in the SAME write, or the CHECK rejects it and the admin sees a constraint name.
  const p = F.resolutionPatch({ status: 'declined', completed: true, completedAt: DONE,
                               completedBy: 'admin-1', adminId: 'a', now: NOW });
  eq('un-accepting clears the completion', p.completed_at, null);
  eq('un-accepting clears its attribution', p.completed_by, null);
}
{
  // Every existing caller passes no completion fields at all. They must keep writing NULL rather
  // than undefined — PostgREST would omit an undefined key and leave a stale stamp in place.
  const p = F.resolutionPatch({ status: 'accepted', adminId: 'a', now: NOW });
  eq('an omitted completion is written as NULL, not left out', p.completed_at, null);
  check('the key is present', 'completed_at' in p && 'completed_by' in p);
}

summary();
