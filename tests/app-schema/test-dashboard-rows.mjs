// test-dashboard-rows.mjs — the faculty dashboard's per-lesson rows.  (Roadmap §5, extensions bug)
//
// WHY THIS EARNS ITS PLACE
//   For months this loader called effectiveDue(offering, sectionId, **null**) — the extension
//   argument hardcoded — so a cadet holding an active extension was reported `overdue` on the
//   dashboard, in the outstanding-tasks panel, and in the due-out row, for work that was not
//   late. Nothing caught it, and nothing could have: the rule lived inside an async loader that
//   needed a faculty session, so the only way to see it was to grant a real extension to a real
//   student and look at a real page. It was found by reading the code, twice, months apart.
//
//   So the fix is not only "pass the extension". It is "put the rule somewhere a test can reach
//   it", which is what buildLessonRows() now is. Four properties are pinned:
//
//     1. an active extension moves the deadline, so the student is not overdue;
//     2. a REVOKED extension does not — and because filtering revoked rows is the CALLER's job
//        (see effectiveDue's contract), the counterfactual is the only thing standing between
//        that contract and a silent regression in the query;
//     3. an extension belonging to a DIFFERENT lesson does not leak across offerings — the bug
//        a single-keyed map would introduce;
//     4. without any extension the old behaviour is unchanged, which is what makes 1-3 mean
//        something rather than being true of a function that always returns 'submitted'.
//
//   `now` is injected, so this suite says the same thing in January as in July.
//
// Offline: buildLessonRows is pure. The client below exists only because faculty-data.js imports
// supabase.js, which throws at import when window.db is absent — nothing here reaches the network.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/dashboard.html' });
globalThis.window.db = makeClient();

const D = await import('../../site/js/faculty-data.js');

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const NOW      = new Date('2026-07-27T18:00:00.000Z');
const PAST     = '2026-07-20T05:59:00.000Z';   // deadline behind us
const FUTURE   = '2026-08-03T05:59:00.000Z';   // extension that has not run out
const ALSO_PAST = '2026-07-25T05:59:00.000Z';  // an extension that itself expired

const SEC_M = '11111111-1111-1111-1111-111111111111';
const ENR   = 'e-1';
const OFF   = 'o-1';
const OTHER = 'o-2';

const WRITTEN = { id: 'act-w', slug: 'preflight-05-written', modality: 'written',
                  gradingRole: 'graded', content: { questions: [] } };

const offering = (id = OFF) => ({
  offeringId: id, slug: 'preflight-05', title: 'Preflight 5',
  pointsPossible: 2, dueAt: PAST, position: 1, dueBySection: {},
  activities: [WRITTEN], written: WRITTEN, interactive: null,
});

// Nothing committed: the only state where the deadline decides between 'not-started' and
// 'overdue'. A committed submission is 'submitted'/'pending' either way, which would hide the bug.
const draftOnly = (offeringId = OFF) => ({
  id: 's-1', enrollmentId: ENR, offeringId, chosenActivityId: null,
  status: 'draft', committedAt: null, activities: {},
});

const lessons  = [{ offeringId: OFF }, { offeringId: OTHER }];
const sectionOf = { [ENR]: SEC_M };
const studentOf = { [ENR]: 3009999999 };

const ext = (over = {}) => ({
  enrollment_id: ENR, assignment_offering_id: OFF, extended_due_at: FUTURE, ...over,
});

const allRowsFor = (extensions) => D.buildLessonRows({
  submissions: [draftOnly()],
  lessons,
  offerings: [offering(OFF), offering(OTHER)],
  grades: [],
  extensions,
  sectionOf, studentOf, now: NOW,
});

const rowsFor   = (extensions) => allRowsFor(extensions)[OFF];
const statusFor = (extensions) => rowsFor(extensions)[0].status;

/* ══ 1. The deadline rule ═════════════════════════════════════════════════════ */

section('faculty-data.js — buildLessonRows honours extensions');

// The baseline. If this ever stops being 'overdue' the three checks below prove nothing.
eq('no extension, deadline passed, nothing handed in -> overdue',
   statusFor([]), 'overdue');

eq('an ACTIVE extension past `now` moves the deadline -> not-started, not overdue',
   statusFor([ext()]), 'not-started');

// The caller filters `revoked_at IS NULL`; buildLessonRows trusts what it is handed. This asserts
// the trust is safe to place — a revoked row that reached it would still have to carry a date,
// and the loader's .is('revoked_at', null) is what keeps it out.
eq('an extension whose own date has passed does not rescue the student',
   statusFor([ext({ extended_due_at: ALSO_PAST })]), 'overdue');

eq('an extension on a DIFFERENT offering does not leak onto this one',
   statusFor([ext({ assignment_offering_id: OTHER })]), 'overdue');

eq('an extension for a DIFFERENT enrollment does not leak onto this student',
   statusFor([ext({ enrollment_id: 'e-2' })]), 'overdue');

/* ══ 2. The extension must not disturb anything else the row carries ══════════ */

section('faculty-data.js — buildLessonRows row shape');

const withExt = rowsFor([ext()])[0];
const without = rowsFor([])[0];

eq('the student id survives', withExt.student_id, 3009999999);
eq('the section tag survives', withExt.sectionId, SEC_M);
eq('an extension changes the status and nothing else',
   JSON.stringify({ ...withExt, status: null }),
   JSON.stringify({ ...without, status: null }));

/* ══ 3. Scoping guards that were already there and must stay ══════════════════ */

section('faculty-data.js — buildLessonRows scoping');

const unpublished = D.buildLessonRows({
  submissions: [draftOnly('o-unpublished')],
  lessons, offerings: [offering(OFF)], grades: [], extensions: [],
  sectionOf, studentOf, now: NOW,
});
check('a submission for an unpublished offering is dropped',
      Object.values(unpublished).every(rows => rows.length === 0));

const offRoster = D.buildLessonRows({
  submissions: [draftOnly()],
  lessons, offerings: [offering(OFF)], grades: [], extensions: [],
  sectionOf: {}, studentOf, now: NOW,
});
eq('a submission from outside the in-scope roster is dropped', offRoster[OFF].length, 0);

// Every lesson gets a bucket even when nobody has touched it — the view indexes by offering id,
// and a missing key would be `undefined` where it expects an array.
eq('every lesson gets a bucket, touched or not',
   Object.keys(allRowsFor([])).sort().join(','), [OFF, OTHER].sort().join(','));
eq('an untouched lesson gets an EMPTY bucket, not a missing one',
   allRowsFor([])[OTHER].length, 0);

/* ══ 4. Which lesson the dashboard opens on ═══════════════════════════════════
 *
 * WHY THIS EARNS ITS PLACE
 *   The pick used to be "the next deadline still ahead of us", and an offering's `due_at` is the
 *   M-day deadline (the earlier of its two). So at 2359 the night before a lesson's M-day class,
 *   every dashboard in the course advanced to the NEXT lesson and stayed there through both of
 *   this one's class days — instructors taught L2 looking at L3's empty numbers. Found on the
 *   morning of 2026-08-10, L2's M-day, with the dashboard showing L3.
 *
 *   The dates below are Physics 215 Fall 2026 verbatim (scripts/fall2026/set_due_dates.py):
 *   L2 meets M Aug 10 / T Aug 11, L3 meets M Aug 12 / T Aug 13, L4 meets M Aug 14 / T Aug 17 —
 *   which is what makes the two interesting cases real rather than invented: a T-day class that
 *   sits after the NEXT lesson's deadline day has begun, and a Monday T-day class three days
 *   after its own M-day.
 */

section('faculty-data.js — activeLessonId picks the lesson in class now');

// M-day deadlines (2359 Denver = 0559Z next day), one per lesson, ascending.
const L = [
  { offeringId: 'L2', due: '2026-08-10T05:59:59.000Z' },   // 2359 Sun Aug 9  -> M class Aug 10
  { offeringId: 'L3', due: '2026-08-12T05:59:59.000Z' },   // 2359 Tue Aug 11 -> M class Aug 12
  { offeringId: 'L4', due: '2026-08-14T05:59:59.000Z' },   // 2359 Thu Aug 13 -> M class Aug 14
  { offeringId: 'L5', due: '2026-08-18T05:59:59.000Z' },   // 2359 Mon Aug 17 -> M class Aug 18
];
const at = (iso) => D.activeLessonId(L, new Date(iso));

eq('M-day morning: the lesson being taught, not the next one due',
   at('2026-08-10T15:00:00.000Z'), 'L2');                  // 0900 Mon Aug 10, L2's M class
eq('T-day morning: still the same lesson, whose T deadline was last night',
   at('2026-08-11T15:00:00.000Z'), 'L2');                  // 0900 Tue Aug 11, L2's T class
eq('T-day afternoon, before the next lesson\'s deadline that evening',
   at('2026-08-11T22:00:00.000Z'), 'L2');                  // 1600 Tue Aug 11
eq('the next M-day morning has moved on',
   at('2026-08-12T15:00:00.000Z'), 'L3');                  // 0900 Wed Aug 12, L3's M class
eq('a Monday T-day class three days after its own M-day still shows its own lesson',
   at('2026-08-17T15:00:00.000Z'), 'L4');                  // 0900 Mon Aug 17, L4's T class

// The boundary itself: the deadline instant belongs to the lesson it closes, not to the next one.
eq('one minute before the deadline it still shows the outgoing lesson',
   at('2026-08-12T05:58:59.000Z'), 'L2');
eq('at the deadline instant the incoming lesson takes over',
   at('2026-08-12T05:59:59.000Z'), 'L3');

// Week one, before anything has been due. Falling back to the newest lesson would open the term
// on the LAST preflight of December.
eq('before the first deadline it falls back to the first lesson due',
   at('2026-08-06T15:00:00.000Z'), 'L2');
eq('after the last deadline it stays on the last lesson',
   at('2026-12-20T15:00:00.000Z'), 'L5');

eq('no lessons at all -> null', D.activeLessonId([], new Date()), null);
eq('lessons but no deadlines -> the last one', D.activeLessonId(
   [{ offeringId: 'a', due: null }, { offeringId: 'b', due: null }], new Date()), 'b');
// Undated offerings sort to the end of the list; they must not be mistaken for the most recent.
eq('an undated lesson does not outrank a dated one that is already due', D.activeLessonId(
   [...L, { offeringId: 'Lx', due: null }], new Date('2026-08-10T15:00:00.000Z')), 'L2');

summary();
