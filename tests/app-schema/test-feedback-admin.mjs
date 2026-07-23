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

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/feedback.html' });
globalThis.window.db = makeClient();

const F = await import('../../site/app/js/faculty-feedback.js');

const row = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  submitter_name: o.name || 'Dr. Ada Byron',
  role: o.role || 'faculty',
  page: o.page || '/site/app/faculty/gradebook.html',
  page_title: o.page_title === undefined ? 'Gradebook · PREP' : o.page_title,
  category: o.category || 'other',
  message: o.message || 'a comment',
  status: o.status || 'new',
  roadmap_ref: o.roadmap_ref === undefined ? null : o.roadmap_ref,
  resolution_note: o.resolution_note || null,
  created_at: o.created_at || '2026-07-23T12:00:00.000Z',
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('statuses — the four triage decisions, and no more');

eq('exactly four statuses, in offer order', F.STATUS_KEYS,
   ['new', 'accepted', 'declined', 'duplicate']);
check('every status carries a label and a hint',
      F.STATUSES.every((s) => s.label && s.hint));
// There is deliberately no 'roadmapped' status — being written down is roadmap_ref, not a state.
check('there is no roadmapped status (that fact lives in roadmap_ref)',
      !F.STATUS_KEYS.includes('roadmapped'));

/* ══════════════════════════════════════════════════════════════════════════ */
section('pageKey — a readable, stable row label');

eq('the page title is preferred', F.pageKey(row({ page_title: 'Gradebook · PREP' })), 'Gradebook · PREP');
eq('falls back to the file name when there is no title',
   F.pageKey(row({ page_title: null, page: '/site/app/faculty/grade.html' })), 'grade.html');
eq('an unknown page is labelled, not blank',
   F.pageKey({ page: '', page_title: '' }), '(unknown)');
eq('a null row does not throw', F.pageKey(null), '(unknown)');

/* ══════════════════════════════════════════════════════════════════════════ */
section('buildMatrix — page x status cross-tab');

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

/* ══════════════════════════════════════════════════════════════════════════ */
section('filterRows — the matrix cells drive this');

const fr = [
  row({ id: '1', page_title: 'Gradebook · PREP', status: 'new', message: 'add CSV export' }),
  row({ id: '2', page_title: 'Grade · PREP', status: 'accepted', message: 'colours are unclear' }),
  row({ id: '3', page_title: 'Gradebook · PREP', status: 'accepted', message: 'sticky column please' }),
];
eq('no filter returns everything', F.filterRows(fr, {}).length, 3);
eq('by status', F.filterRows(fr, { status: 'accepted' }).map((r) => r.id), ['2', '3']);
eq('by page', F.filterRows(fr, { page: 'Gradebook · PREP' }).map((r) => r.id), ['1', '3']);
eq('by page AND status together — what a matrix cell means',
   F.filterRows(fr, { page: 'Gradebook · PREP', status: 'accepted' }).map((r) => r.id), ['3']);
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

summary();
