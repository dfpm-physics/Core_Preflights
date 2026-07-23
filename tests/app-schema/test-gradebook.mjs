// test-gradebook.mjs — the grid's arithmetic.  (Roadmap P1.1)
//
// WHY THIS EARNS ITS PLACE
//   A gradebook is believed or it is useless. Every rule in faculty-gradebook.js exists because
//   a plausible-looking simplification of it produces a grid that is quietly, confidently wrong —
//   and wrong in a way nobody can see by looking at the page, because a wrong cell renders exactly
//   like a right one. Four such simplifications, all of which this suite makes expensive:
//
//     1. "a blank cell is a zero" — counts 39 not-yet-due lessons against every cadet on day one,
//        so the whole class reads 0% and the page is abandoned in week one;
//     2. "zero is just the bottom of the failing band" — merges did-not-do-it with did-it-and-
//        did-not-understand-it, which are opposite conversations with a cadet;
//     3. "the deadline is the offering's due_at" — ignores the section override AND the extension,
//        so a cadet who was granted more time is shown a red MISSING cell for work that is not
//        late. This module's own header names that as the reason it does not reuse
//        loadFacultyDashboard(); the extension case below is that bug, pinned;
//     4. "an ungraded submission should not drag the average" — hides the instructor's own
//        backlog from the instructor.
//
//   The column shortcodes are here for a duller reason: they are the only text in a 40-column
//   header, so a collision makes two columns literally indistinguishable at the width they are
//   read at.
//
// Offline: every function under test is pure. The client below exists only because
// faculty-gradebook.js imports supabase.js, which throws at import when window.db is absent —
// nothing here reaches the network (loadGradebook() needs a faculty session and is not covered).

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/gradebook.html' });
globalThis.window.db = makeClient();

const G = await import('../../site/app/js/faculty-gradebook.js');

/* ── Fixtures ─────────────────────────────────────────────────────────────────
 * Every date is fixed and `now` is injected everywhere, so this suite says the same thing in
 * January as in July. */

const NOW    = new Date('2026-07-22T18:00:00.000Z');
const PAST   = '2026-07-20T05:59:00.000Z';
const FUTURE = '2026-07-30T05:59:00.000Z';

const SEC_M = '11111111-1111-1111-1111-111111111111';
const SEC_T = '22222222-2222-2222-2222-222222222222';

const offering = (over = {}) => ({
  offeringId: 'o1', slug: 'preflight-02', title: 'Preflight 2',
  pointsPossible: 2, dueAt: PAST, position: 1, dueBySection: {}, ...over,
});

const committed = (at) => ({ id: 's1', status: 'committed', committed_at: at });

/* ══ 1. shortCode ═════════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — shortCode');

eq('a preflight slug abbreviates to PF + two digits', G.shortCode('preflight-02'), 'PF02');
eq('an interactive lesson slug drops its topic tail', G.shortCode('lesson-02-charge'), 'L02');
// Single-digit numbers are zero-padded so the codes column-align in a 40-wide header.
eq('a single-digit homework is padded to two', G.shortCode('hw-3'), 'HW03');
eq('a two-digit lab keeps both digits', G.shortCode('lab-11'), 'LAB11');
eq('a quiz is padded the same way', G.shortCode('quiz-1'), 'QZ01');

// The number is allowed to live in the title instead of the slug — lessonNumber() falls back to
// it — because an author who names an offering "preflight" and titles it "Preflight 7" has still
// told us which lesson it is.
eq('the number is read from the title when the slug has none',
   G.shortCode('preflight', 'Preflight 7 — Optics'), 'PF07');

// No number anywhere: the code degrades to first-two-letters + last-two-alphanumerics rather
// than collapsing every unnumbered item onto one code.
eq('a numberless slug still yields a code', G.shortCode('syllabus'), 'SYUS');
check('…and that code is short enough for the column', G.shortCode('syllabus').length <= 5);

// Garbage must not throw and must not produce '' — an empty <th> is unclickable and unreadable.
eq('an empty slug yields a placeholder, not an empty string', G.shortCode(''), 'A');
eq('a punctuation-only slug yields the same placeholder', G.shortCode('!!!'), 'A');
eq('null does not throw', G.shortCode(null), 'A');

/* ══ 2. uniqueCodes ═══════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — uniqueCodes');

eq('a non-colliding list is passed through unchanged',
   G.uniqueCodes([{ slug: 'preflight-01' }, { slug: 'preflight-02' }, { slug: 'lesson-03-fields' }]),
   ['PF01', 'PF02', 'L03']);

// A genuine collision: two spellings of the same prefix and the same lesson number. The suffix is
// assigned in COLUMN order, not by hashing, so a lesson keeps the same code across reloads —
// otherwise a director who learns "PF02b is the make-up" is taught it again every refresh.
eq('a genuine collision gets a deterministic suffix in column order',
   G.uniqueCodes([{ slug: 'preflight-02' }, { slug: 'pre-flight-02' }, { slug: 'preflight-02' }]),
   ['PF02', 'PF02b', 'PF02c']);

/* ══ 3. bandOf ════════════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — bandOf');

// THE rule of this section: zero is its own band, never the bottom of "under 60%". A cadet who
// handed in nothing and a cadet who scored 12% must not share a colour.
eq('exactly zero is the No-credit band, not the failing band', G.bandOf(0)?.key, 'd0');
eq('…and it is labelled as such', G.bandOf(0)?.label, 'No credit');
check('…which is a different band from anything above zero', G.bandOf(0).key !== G.bandOf(0.01).key);

eq('just under 60% is d1', G.bandOf(0.599)?.key, 'd1');
eq('exactly 60% moves up to d2', G.bandOf(0.60)?.key, 'd2');
eq('just under 70% is still d2', G.bandOf(0.699)?.key, 'd2');
eq('exactly 70% moves up to d3', G.bandOf(0.70)?.key, 'd3');
eq('just under 80% is still d3', G.bandOf(0.799)?.key, 'd3');
eq('exactly 80% moves up to d4', G.bandOf(0.80)?.key, 'd4');
eq('just under 90% is still d4', G.bandOf(0.899)?.key, 'd4');
eq('exactly 90% moves up to d5', G.bandOf(0.90)?.key, 'd5');
eq('full marks is d5', G.bandOf(1.0)?.key, 'd5');

// null is "nothing has come due yet" and must stay visually distinct from "scored zero".
eq('null has no band at all', G.bandOf(null), null);
eq('undefined has no band', G.bandOf(undefined), null);
eq('NaN has no band', G.bandOf(NaN), null);

/* ══ 4. cellState ═════════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — cellState');

const graded = G.cellState({
  grade: { points_earned: 2, points_possible: 2, is_finalized: true, source: 'human' },
  submission: committed(PAST), offering: offering(), sectionId: SEC_M, now: NOW,
});
eq('a finalized grade is GRADED', graded.state, G.CELL.GRADED);
eq('…and carries its points', [graded.points, graded.possible], [2, 2]);
eq('…and reports itself finalized', graded.isFinalized, true);

const draft = G.cellState({
  grade: { points_earned: 1, points_possible: 2, is_finalized: false, source: 'ai' },
  submission: committed(PAST), offering: offering(), sectionId: SEC_M, now: NOW,
});
eq('an unconfirmed grade is DRAFT, not GRADED', draft.state, G.CELL.DRAFT);
// /preflight-analyze writes is_finalized=false by contract (CORE.md §6). If DRAFT collapsed into
// GRADED the grid would present a machine suggestion as a human decision.
eq('…and says so, so an AI suggestion is never shown as confirmed', draft.isFinalized, false);
eq('…and keeps the source that produced it', draft.source, 'ai');

const ungraded = G.cellState({
  grade: null, submission: committed(PAST), offering: offering(), sectionId: SEC_M, now: NOW,
});
eq('a committed submission with no grade is UNGRADED', ungraded.state, G.CELL.UNGRADED);
eq('…with no points but the offering\'s full value', [ungraded.points, ungraded.possible], [null, 2]);

const missing = G.cellState({
  grade: null, submission: null, offering: offering(), sectionId: SEC_M, now: NOW,
});
eq('nothing at all, past the deadline, is MISSING', missing.state, G.CELL.MISSING);

const pending = G.cellState({
  grade: null, submission: null, offering: offering({ dueAt: FUTURE }), sectionId: SEC_M, now: NOW,
});
eq('nothing at all, before the deadline, is PENDING', pending.state, G.CELL.PENDING);

// A draft (uncommitted) submission is not work that arrived. Treating it as committed would let a
// cadet suppress a MISSING cell by opening the assignment and typing nothing.
eq('an uncommitted draft does not count as work arriving',
   G.cellState({ grade: null, submission: { id: 's', status: 'draft', committed_at: null },
                 offering: offering(), sectionId: SEC_M, now: NOW }).state, G.CELL.MISSING);

/* ── The extension case: the specific bug this module exists to avoid ──────────
 * faculty-data.js:148 hardcodes the extension argument to null, so its status calls a cadet
 * overdue who holds an active extension. On a dashboard tile that is a rounding error; here it is
 * a red cell against a cadet who did nothing wrong. Do not "simplify" cellState() by dropping the
 * extensionISO pass-through. */
eq('an unexpired extension keeps the cell PENDING, not MISSING',
   G.cellState({ grade: null, submission: null, offering: offering(),
                 sectionId: SEC_M, extensionISO: FUTURE, now: NOW }).state, G.CELL.PENDING);
eq('an extension that has itself expired returns the cell to MISSING',
   G.cellState({ grade: null, submission: null, offering: offering(),
                 sectionId: SEC_M, extensionISO: PAST, now: NOW }).state, G.CELL.MISSING);
// The extension has to move the lateness verdict too, not just the blank-cell verdict.
eq('work handed in inside an extension is not badged late',
   G.cellState({ grade: { points_earned: 2, points_possible: 2, is_finalized: true },
                 submission: committed('2026-07-25T12:00:00.000Z'), offering: offering(),
                 sectionId: SEC_M, extensionISO: FUTURE, now: NOW }).late, false);
eq('…and without the extension the same submission is late',
   G.cellState({ grade: { points_earned: 2, points_possible: 2, is_finalized: true },
                 submission: committed('2026-07-25T12:00:00.000Z'), offering: offering(),
                 sectionId: SEC_M, now: NOW }).late, true);

/* ── Section-specific due dates, both directions ─────────────────────────────
 * M-day and T-day sections meet on different days, so one offering has two deadlines. The
 * override is a row keyed by section (assignment_due_dates), NOT a code sniffed out of the
 * section name the way the retired due_date_m/due_date_t pair did it. */
const splitPastForM = offering({ dueAt: FUTURE, dueBySection: { [SEC_M]: PAST } });
eq('a section override past its date makes that section MISSING',
   G.cellState({ grade: null, submission: null, offering: splitPastForM,
                 sectionId: SEC_M, now: NOW }).state, G.CELL.MISSING);
eq('…while a section with no override falls back to the offering default',
   G.cellState({ grade: null, submission: null, offering: splitPastForM,
                 sectionId: SEC_T, now: NOW }).state, G.CELL.PENDING);

const splitFutureForT = offering({ dueAt: PAST, dueBySection: { [SEC_T]: FUTURE } });
eq('an override can also push a deadline out, keeping that section PENDING',
   G.cellState({ grade: null, submission: null, offering: splitFutureForT,
                 sectionId: SEC_T, now: NOW }).state, G.CELL.PENDING);
eq('…while the un-overridden section stays MISSING against the default',
   G.cellState({ grade: null, submission: null, offering: splitFutureForT,
                 sectionId: SEC_M, now: NOW }).state, G.CELL.MISSING);

/* ══ 5. countsTowardTotal / totalsFor ═════════════════════════════════════════ */

section('faculty-gradebook.js — totals');

const cell = (state, points, possible = 2) =>
  ({ state, points, possible, isFinalized: false, source: null, late: false, due: null });

eq('PENDING is the only state kept out of the sum',
   [G.CELL.GRADED, G.CELL.DRAFT, G.CELL.UNGRADED, G.CELL.MISSING, G.CELL.PENDING]
     .map((s) => G.countsTowardTotal(cell(s, null))),
   [true, true, true, true, false]);

// PENDING must leave BOTH sides of the fraction alone. Counting it in the denominator only is the
// day-one 0% bug: 39 lessons nobody could have done yet, all counted against every cadet.
const withPending = G.totalsFor([cell(G.CELL.GRADED, 2), cell(G.CELL.PENDING, null),
                                 cell(G.CELL.PENDING, null)]);
eq('a not-yet-due cell is in neither the numerator nor the denominator',
   [withPending.earned, withPending.possible, withPending.pct], [2, 2, 1]);
eq('…and is not counted as a cell at all', withPending.counted, 1);

// MISSING is a zero out of full — that is the entire point of distinguishing it from PENDING.
const withMissing = G.totalsFor([cell(G.CELL.GRADED, 2), cell(G.CELL.MISSING, null)]);
eq('a missing cell scores zero out of full', [withMissing.earned, withMissing.possible], [2, 4]);
eq('…so it halves a perfect score', withMissing.pct, 0.5);

// UNGRADED drags the average exactly as MISSING does, deliberately: it is unfinished work by the
// INSTRUCTOR, and excluding it would hide the grading backlog from the person who owes it.
const withUngraded = G.totalsFor([cell(G.CELL.GRADED, 2), cell(G.CELL.UNGRADED, null)]);
eq('an ungraded submission also scores zero out of full',
   [withUngraded.earned, withUngraded.possible, withUngraded.pct], [2, 4, 0.5]);

// null, not 0 and not NaN: on the first day of term there is nothing to judge, and a 0% would be
// a false statement about every cadet in the course.
const allPending = G.totalsFor([cell(G.CELL.PENDING, null), cell(G.CELL.PENDING, null)]);
eq('a row where nothing has come due has a null percentage, not zero', allPending.pct, null);
check('…and specifically not NaN', !Number.isNaN(allPending.pct));
eq('…and no band, so it renders as nothing', G.bandOf(allPending.pct), null);
eq('an empty row is the same', G.totalsFor([]).pct, null);

/* ══ 6. buildMatrix ═══════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — buildMatrix');

/* Ordering. Columns run by deadline, then by the author's position for a tie, then anything with
 * no deadline at all lands at the end — a grid that does not run left-to-right in time is not a
 * grid a human can read a term off. */
const orderOfferings = [
  offering({ offeringId: 'c-late',  slug: 'preflight-03', dueAt: '2026-07-15T05:59:00.000Z',
             position: 9, pointsPossible: 2 }),
  offering({ offeringId: 'd-undated', slug: 'preflight-04', dueAt: null, position: 5,
             pointsPossible: 3 }),
  offering({ offeringId: 'b-pos2',  slug: 'preflight-02', dueAt: '2026-07-10T05:59:00.000Z',
             position: 2, pointsPossible: 1 }),
  offering({ offeringId: 'a-pos1',  slug: 'preflight-01', dueAt: '2026-07-10T05:59:00.000Z',
             position: 1, pointsPossible: 4 }),
];
const ordered = G.buildMatrix({
  enrollments: [{ enrollmentId: 'e1', studentId: 3000000001, name: 'Alpha', sectionId: SEC_M }],
  offerings: orderOfferings, grades: [], submissions: [], extensions: [], now: NOW,
});
eq('columns sort by due date, then position, with undated last',
   ordered.columns.map((c) => c.offeringId), ['a-pos1', 'b-pos2', 'c-late', 'd-undated']);
eq('…and each column carries a unique shortcode',
   ordered.columns.map((c) => c.code), ['PF01', 'PF02', 'PF03', 'PF04']);

// The cells are a bare array with no column key of their own, so "cells are in column order" is
// the invariant the renderer relies on. Distinct point values per column make it checkable.
eq('a row\'s cells are in column order',
   ordered.rows[0].cells.map((c) => c.possible),
   ordered.columns.map((c) => c.pointsPossible));

// An enrolment with nothing at all must still produce a full-width row; a short row would shift
// every cell after it into the wrong column.
eq('an enrolment with no grades and no submissions still gets a full row of cells',
   ordered.rows[0].cells.length, ordered.columns.length);
eq('…all of which are MISSING or PENDING by deadline',
   ordered.rows[0].cells.map((c) => c.state),
   [G.CELL.MISSING, G.CELL.MISSING, G.CELL.MISSING, G.CELL.PENDING]);
eq('…and the undated column is the PENDING one', ordered.columns[3].dueAt, null);

/* Statistics, over a set small enough to compute by hand.
 * Two 2-point columns, both past due:
 *   e1  2/2 + 2/2 = 4/4 = 1.0
 *   e2  2/2 + missing = 2/4 = 0.5
 *   e3  missing + missing = 0/4 = 0.0
 *   e4  ungraded + missing = 0/4 = 0.0
 * median of [0, 0, 0.5, 1] = 0.25 · mean = 1.5/4 = 0.375 · missing cells = 4 · ungraded = 1 */
const statCols = [
  offering({ offeringId: 'k1', slug: 'preflight-01', dueAt: PAST, position: 1, pointsPossible: 2 }),
  offering({ offeringId: 'k2', slug: 'preflight-02', dueAt: PAST, position: 2, pointsPossible: 2 }),
];
const full = (e, o) => ({ enrollment_id: e, assignment_offering_id: o,
                          points_earned: 2, points_possible: 2, is_finalized: true });
const stats = G.buildMatrix({
  enrollments: [
    { enrollmentId: 'e1', sectionId: SEC_M }, { enrollmentId: 'e2', sectionId: SEC_M },
    { enrollmentId: 'e3', sectionId: SEC_M }, { enrollmentId: 'e4', sectionId: SEC_M },
  ],
  offerings: statCols,
  grades: [full('e1', 'k1'), full('e1', 'k2'), full('e2', 'k1')],
  submissions: [{ enrollment_id: 'e4', assignment_offering_id: 'k1',
                  status: 'committed', committed_at: PAST }],
  extensions: [], now: NOW,
});
eq('each row totals to its hand-computed percentage',
   stats.rows.map((r) => r.totals.pct), [1, 0.5, 0, 0]);
// Note e3 and e4 (both 0.0) land in d0 while e2 (0.5) lands in d1 — the zero-is-its-own-band rule
// from §3, arriving where it actually matters: on a real row of a real grid.
eq('…and each row gets the band for that percentage',
   stats.rows.map((r) => r.band.key), ['d5', 'd1', 'd0', 'd0']);
eq('the class median is the middle of the four', stats.stats.median, 0.25);
eq('the class mean is the average of the four', stats.stats.mean, 0.375);
eq('every row is counted', stats.stats.n, 4);
eq('missing cells are tallied across the whole grid', stats.stats.missing, 4);
eq('ungraded cells are tallied separately, as the instructor\'s own backlog',
   stats.stats.ungraded, 1);

// A class where nothing has come due yet has no median and no mean — the same null the row-level
// percentage uses, for the same reason.
const early = G.buildMatrix({
  enrollments: [{ enrollmentId: 'e1', sectionId: SEC_M }],
  offerings: [offering({ offeringId: 'f1', slug: 'preflight-01', dueAt: FUTURE })],
  grades: [], submissions: [], extensions: [], now: NOW,
});
eq('before any deadline the class statistics are null, not zero',
   [early.stats.median, early.stats.mean], [null, null]);

// The extension has to survive the trip through buildMatrix, not just cellState — extBy is keyed
// on the same enrolment/offering pair as grades and submissions, and a mismatch there would look
// exactly like "no extensions exist".
const extended = G.buildMatrix({
  enrollments: [{ enrollmentId: 'e1', sectionId: SEC_M }, { enrollmentId: 'e2', sectionId: SEC_M }],
  offerings: [offering({ offeringId: 'x1', slug: 'preflight-01', dueAt: PAST })],
  grades: [], submissions: [],
  extensions: [{ enrollment_id: 'e2', assignment_offering_id: 'x1', extended_due_at: FUTURE }],
  now: NOW,
});
eq('an extension row reaches the cell it belongs to, and only that one',
   extended.rows.map((r) => r.cells[0].state), [G.CELL.MISSING, G.CELL.PENDING]);
eq('…so the extended cadet has no percentage yet rather than a zero',
   extended.rows[1].totals.pct, null);

/* ══════════════════════════════════════════════════════════════════════════
 * Colour layer — zoneIndex + cellSignals (director request: tint = understanding,
 * bar = effort, both reusing the rollup ramp)
 * ════════════════════════════════════════════════════════════════════════════ */
section('zoneIndex — the rollup ramp arithmetic, reproduced exactly');

// This MUST match report.html's zoneVar: v => RAMP5[clamp(0,4, ceil(v)-1)]. If it drifts, the
// gradebook and the rollup colour the same 0–5 value differently, which is the one thing the
// director asked us not to do. The boundaries below are that formula pinned.
eq('0 lands on the first zone (red), same as the rollup', G.zoneIndex(0), 0);
eq('a hair above 0 is still the first zone', G.zoneIndex(0.1), 0);
eq('1 is the first zone', G.zoneIndex(1), 0);
eq('2 is the second', G.zoneIndex(2), 1);
eq('3 is the third', G.zoneIndex(3), 2);
eq('4 is the fourth', G.zoneIndex(4), 3);
eq('5 is the fifth (green)', G.zoneIndex(5), 4);
eq('a fractional 3.4 rounds UP into zone 4, exactly as ceil() does', G.zoneIndex(3.4), 3);
eq('above range clamps to the top zone', G.zoneIndex(9), 4);
eq('null has no zone — a future assignment that tracks nothing gets no colour', G.zoneIndex(null), null);
eq('undefined has no zone', G.zoneIndex(undefined), null);
eq('NaN has no zone', G.zoneIndex(NaN), null);

section('cellSignals — effort and understanding from the grade alone');

// Interactive path: effort is grades.effort, source "grade". No understanding on the grade (it is
// per-objective in the submission payload the gradebook does not fetch) — so it is null, and the
// cell simply gets an effort bar and no tint. That IS the graceful-degradation case.
eq('interactive effort comes from grades.effort',
   G.cellSignals({ effort: 4, diagnostic: {} }),
   { effort: 4, understanding: null, effortSource: 'grade' });

// Written path: both signals live in grades.diagnostic (q2_effort / q3_understanding).
eq('written effort and understanding come from the diagnostic q2/q3 pair',
   G.cellSignals({ effort: null, diagnostic: { q2_effort: 3, q3_understanding: 5 } }),
   { effort: 3, understanding: 5, effortSource: 'diagnostic' });

// A schema:1 payload outranks q2_effort for effort (it is the commensurable measure) and supplies
// understanding via overall_understanding when q3 is absent.
eq('a schema:1 payload supplies effort and overall_understanding',
   G.cellSignals({ effort: null, diagnostic: { schema: 1, effort: 2, overall_understanding: 4 } }),
   { effort: 2, understanding: 4, effortSource: 'report' });

check('q3_understanding wins over a schema:1 overall_understanding when both are present',
      G.cellSignals({ effort: null,
        diagnostic: { schema: 1, effort: 2, overall_understanding: 4, q3_understanding: 1 } })
        .understanding === 1,
      'q3 is the more specific written signal; overall is the fallback');

// The degradation cases the director asked us to design for.
eq('a grade with an empty diagnostic yields no signals',
   G.cellSignals({ effort: null, diagnostic: {} }),
   { effort: null, understanding: null, effortSource: null });
eq('no grade at all yields no signals',
   G.cellSignals(null),
   { effort: null, understanding: null, effortSource: null });
eq('a grade with no diagnostic key at all is safe',
   G.cellSignals({ effort: null }),
   { effort: null, understanding: null, effortSource: null });

section('buildMatrix attaches the signals to each graded cell');

// The signals have to survive the trip through buildMatrix onto the cell, beside the state —
// that is what the page reads to draw the tint and bar.
const coloured = G.buildMatrix({
  enrollments: [{ enrollmentId: 'e1', sectionId: SEC_M }],
  offerings: [offering({ offeringId: 'x1', slug: 'preflight-01', dueAt: PAST })],
  grades: [{ enrollment_id: 'e1', assignment_offering_id: 'x1', points_earned: 2,
             points_possible: 2, is_finalized: true, effort: null,
             diagnostic: { q2_effort: 4, q3_understanding: 2 } }],
  submissions: [{ enrollment_id: 'e1', assignment_offering_id: 'x1', status: 'committed',
                  committed_at: PAST }],
  extensions: [], now: NOW,
});
{
  const cell = coloured.rows[0].cells[0];
  eq('a graded cell carries its effort', cell.effort, 4);
  eq('…and its understanding', cell.understanding, 2);
  check('…without disturbing the state or points the earlier tests pin',
        cell.state === G.CELL.GRADED && cell.points === 2);
}

// A MISSING cell (no grade) must carry no signals, so the page draws no colour on it.
const bare = G.buildMatrix({
  enrollments: [{ enrollmentId: 'e9', sectionId: SEC_M }],
  offerings: [offering({ offeringId: 'x1', slug: 'preflight-01', dueAt: PAST })],
  grades: [], submissions: [], extensions: [], now: NOW,
});
eq('a cell with no grade has null signals, so it renders plain',
   [bare.rows[0].cells[0].effort, bare.rows[0].cells[0].understanding], [null, null]);

process.exitCode = summary() ? 0 : 1;
