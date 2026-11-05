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

installBrowser({ pathname: '/site/faculty/gradebook.html' });
globalThis.window.db = makeClient();

const G = await import('../../site/js/faculty-gradebook.js');

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

/* ── "—" vs "0": a missing cell only becomes a zero once the column has been graded ──────
 * Director, 2026-07-28. The distinction is display-only and must stay that way: MISSING has always
 * counted as zero-out-of-full in the total, so if `columnGraded` ever reached totalsFor() a
 * student's percentage would move when an instructor finished grading rather than when the work
 * did or did not arrive. The last two assertions here are what pin that. */
eq('a missing cell shows no number while the column is still being graded',
   G.cellState({ grade: null, submission: null, offering: offering(),
                 sectionId: SEC_M, columnGraded: false, now: NOW }).points, null);
eq('…and becomes an explicit 0 once it has been graded',
   G.cellState({ grade: null, submission: null, offering: offering(),
                 sectionId: SEC_M, columnGraded: true, now: NOW }).points, 0);
// PENDING must never pick up the zero: the work is not due, so there is nothing to be missing.
eq('a graded column does not put a 0 on work that is not due yet',
   G.cellState({ grade: null, submission: null, offering: offering({ dueAt: FUTURE }),
                 sectionId: SEC_M, columnGraded: true, now: NOW }).points, null);
eq('…nor does an active extension, which makes the cell PENDING',
   G.cellState({ grade: null, submission: null, offering: offering(), sectionId: SEC_M,
                 extensionISO: FUTURE, columnGraded: true, now: NOW }).points, null);
/* ══ 5. The database's cells and totals are the only ones ═══════════════════════
 * Everything below was a second calculation (totalsFor, countsTowardTotal, gradedScopes) until step 2. A staff
 * page that adds its own total will disagree with the student's page, the export and the backlog, so the grid now
 * shows what gradebook_cells and course_totals return and adds nothing. The cases are the ones the two rules
 * disagreed on. */

section('faculty-gradebook.js — no second total is left');
check('totalsFor is gone', G.totalsFor === undefined);
check('countsTowardTotal is gone', G.countsTowardTotal === undefined);
check('gradedScopes is gone', G.gradedScopes === undefined);
check('the percent-number band is gone; a band comes from the database text', G.bandOf === undefined && typeof G.bandOfKey === 'function');
check('there is no median or mean to compute', !('median' in G.matrixStats([])) && !('mean' in G.matrixStats([])));

section('faculty-gradebook.js — dbCellView: the database state decides');

const dbc = (o = {}) => ({ enrollment_id: 'e1', section_id: SEC_M, assignment_offering_id: 'o1', state: 'released',
  has_draft_score: false, is_late: false, no_work_received: false, deadline_invalid: false, late_closed: false,
  points_earned: 8, points_possible: 10, ...o });
eq('released is GRADED with its points', [G.dbCellView(dbc()).state, G.dbCellView(dbc()).points], [G.CELL.GRADED, 8]);
eq('a draft score is a DRAFT, not a grade', G.dbCellView(dbc({ state: 'submitted_ungraded', has_draft_score: true })).state, G.CELL.DRAFT);
eq('…and keeps the drafted points so the instructor can see them', G.dbCellView(dbc({ state: 'submitted_ungraded', has_draft_score: true })).points, 8);
eq('work in with no score is UNGRADED, with no points', [G.dbCellView(dbc({ state: 'submitted_ungraded', points_earned: null })).state, G.dbCellView(dbc({ state: 'submitted_ungraded', points_earned: null })).points], [G.CELL.UNGRADED, null]);
eq('missing is MISSING and counts 0', [G.dbCellView(dbc({ state: 'missing', points_earned: null })).state, G.dbCellView(dbc({ state: 'missing', points_earned: null })).points], [G.CELL.MISSING, 0]);
eq('excused is EXCUSED and shows no points', [G.dbCellView(dbc({ state: 'excused' })).state, G.dbCellView(dbc({ state: 'excused' })).points], [G.CELL.EXCUSED, null]);
eq('held by a release date is HELD', G.dbCellView(dbc({ state: 'graded_unreleased' })).state, G.CELL.HELD);
eq('in progress and not due are both PENDING', [G.dbCellView(dbc({ state: 'in_progress' })).state, G.dbCellView(dbc({ state: 'not_due', points_earned: null })).state], [G.CELL.PENDING, G.CELL.PENDING]);
eq('late comes from the database', G.dbCellView(dbc({ is_late: true })).late, true);
check('a state the page does not know is not drawn as a number', G.dbCellView(dbc({ state: 'something_new' })).state === G.CELL.PENDING && G.dbCellView(dbc({ state: 'something_new' })).points == null);

section('faculty-gradebook.js — bandOfKey: an exact band from the database text');
eq('no text, no band', G.bandOfKey(null), null);
eq('zero is its own band', G.bandOfKey('0')?.key, 'd0');
eq('a hair above zero is not', G.bandOfKey('0.0000000000000000000001')?.key, 'd1');
eq('59.99 is d1', G.bandOfKey('59.99')?.key, 'd1');
eq('exactly 60 is d2', G.bandOfKey('60')?.key, 'd2');
eq('exactly 90 is d5', G.bandOfKey('90.0000000000000000000000')?.key, 'd5');
eq('a float would call this 90; it is below the line', G.bandOfKey('89.9999999999999999999999')?.key, 'd4');
eq('over 100 stays in the top band (bonus)', G.bandOfKey('104.5')?.key, 'd5');
eq('junk is no band', G.bandOfKey('NaN'), null);

section('faculty-gradebook.js — totalView: text straight from course_totals');
const dbt = (o = {}) => ({ enrollment_id: 'e1', section_id: SEC_M, student_id: 3000000001, earned_text: '8', possible_text: '10',
  percent_text: '80', percent_key_text: '80.0000000000000000000000', letter: 'B-', gpa: 2.7, near_line_letter: null, rank: 3, tie_group: null,
  missing_count: 0, ungraded_count: 0, unreleased_count: 0, excused_count: 0, bonus_only: false, no_work_count: 0, invalid_deadline_count: 0, ...o });
{
  const v = G.totalView(dbt());
  eq('the percent is the database text, not a rounded number', [v.percentText, v.earnedText, v.possibleText, v.letter, v.rank], ['80', '8', '10', 'B-', 3]);
  eq('a band comes with it', v.band.key, 'd4');
  eq('a repeating percent keeps its ellipsis, never a rounded 67', G.totalView(dbt({ percent_text: '66.666666…', percent_key_text: '66.6666666666666666666666' })).percentText, '66.666666…');
  eq('nothing counted yet has no percent and no band', [G.totalView(dbt({ earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null })).percentText, G.totalView(dbt({ percent_key_text: null, percent_text: null })).band], [null, null]);
  eq('a bonus-only cadet is marked so the page prints points, not a dash', G.totalView(dbt({ earned_text: '3', possible_text: '0', percent_text: null, percent_key_text: null, bonus_only: true })).bonusOnly, true);
  eq('no row, no view', G.totalView(undefined), null);
}

/* ══ 6. buildMatrix ═══════════════════════════════════════════════════════════ */

section('faculty-gradebook.js — buildMatrix');

const need = (f) => { try { f(); return null; } catch (e) { return e; } };
check('a grid with no database cells is refused, not drawn from a local guess',
  need(() => G.buildMatrix({ enrollments: [], offerings: [], grades: [], submissions: [], extensions: [] })) instanceof Error);

/* Ordering. Columns run by deadline, then by the author's position for a tie, then anything with
 * no deadline at all lands at the end. */
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
  offerings: orderOfferings, grades: [], submissions: [], extensions: [], dbCells: [], dbTotals: [], now: NOW,
});
eq('columns sort by due date, then position, with undated last',
   ordered.columns.map((c) => c.offeringId), ['a-pos1', 'b-pos2', 'c-late', 'd-undated']);
eq('…and each column carries a unique shortcode',
   ordered.columns.map((c) => c.code), ['PF01', 'PF02', 'PF03', 'PF04']);
eq('a row\'s cells are in column order',
   ordered.rows[0].cells.map((c) => c.possible),
   ordered.columns.map((c) => c.pointsPossible));
eq('an enrollment the database has no cells for still gets a full row',
   ordered.rows[0].cells.length, ordered.columns.length);
eq('…none of them drawn as a number or a zero',
   ordered.rows[0].cells.map((c) => [c.state, c.points]), ordered.columns.map(() => [G.CELL.PENDING, null]));
eq('…and no total, which is not the same as a total of zero', ordered.rows[0].total, null);

/* THE CASE THE TWO RULES DISAGREED ON. One item worth 10.
 *   A  a draft of 8 typed on the entry page, not published.   old grid: 8/10 = 80%.  Database: the draft is out.
 *   B  published 10.
 *   C  excused.                                               old grid: 0 earned, 10 possible.  Database: out.
 *   D  a bonus item worth 5, scored 5.                        old grid: 5 possible.  Database: possible 0.
 * The grid must print the database's numbers for all four, whatever those numbers are. */
const item10 = offering({ offeringId: 'o1', slug: 'quiz-1', title: 'Quiz 1', pointsPossible: 10, dueAt: PAST });
const bonus5 = offering({ offeringId: 'o2', slug: 'quiz-2', title: 'Bonus', pointsPossible: 5, dueAt: PAST, position: 2 });
const people = ['A', 'B', 'C', 'D'].map((n, i) => ({ enrollmentId: 'e' + n, studentId: 3000000010 + i, name: 'Cadet ' + n, sectionId: SEC_M }));
const cellsDb = [
  dbc({ enrollment_id: 'eA', assignment_offering_id: 'o1', state: 'submitted_ungraded', has_draft_score: true, points_earned: 8 }),
  dbc({ enrollment_id: 'eB', assignment_offering_id: 'o1', state: 'released', points_earned: 10 }),
  dbc({ enrollment_id: 'eC', assignment_offering_id: 'o1', state: 'excused', points_earned: null }),
  dbc({ enrollment_id: 'eD', assignment_offering_id: 'o1', state: 'released', points_earned: 10 }),
  dbc({ enrollment_id: 'eD', assignment_offering_id: 'o2', state: 'released', points_earned: 5, points_possible: 5 }),
];
const totalsDb = [
  dbt({ enrollment_id: 'eA', earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null, rank: null, ungraded_count: 1 }),
  dbt({ enrollment_id: 'eB', earned_text: '10', possible_text: '10', percent_text: '100', percent_key_text: '100.0000000000000000000000', letter: 'A', rank: 1 }),
  dbt({ enrollment_id: 'eC', earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null, rank: null, excused_count: 1 }),
  dbt({ enrollment_id: 'eD', earned_text: '15', possible_text: '10', percent_text: '150', percent_key_text: '150.0000000000000000000000', letter: 'A', rank: 1 }),
];
const tm = G.buildMatrix({ enrollments: people, offerings: [item10, bonus5],
  grades: [{ enrollment_id: 'eA', assignment_offering_id: 'o1', points_earned: 8, points_possible: 10, is_finalized: false, source: 'instructor' }],
  submissions: [], extensions: [], dbCells: cellsDb, dbTotals: totalsDb, now: NOW });
const row = (n) => tm.rows.find((r) => r.name === 'Cadet ' + n);
eq('A: the draft shows as a draft with its points', [row('A').cells[0].state, row('A').cells[0].points], [G.CELL.DRAFT, 8]);
eq('A: and is NOT in the total, which says so', [row('A').total.earnedText, row('A').total.possibleText, row('A').total.percentText], ['0', '0', null]);
eq('B: a published score counts', [row('B').cells[0].state, row('B').total.percentText], [G.CELL.GRADED, '100']);
eq('C: an excused item shows as excused and leaves the total', [row('C').cells[0].state, row('C').total.possibleText], [G.CELL.EXCUSED, '0']);
eq('D: a bonus item adds earned and no possible, and the percent passes 100', [row('D').total.earnedText, row('D').total.possibleText, row('D').total.percentText], ['15', '10', '150']);
check('D: and is in the top band', row('D').band?.key === 'd5');
eq('a total is never a number the page computed',
   tm.rows.every((r) => r.total === null || typeof r.total.percentText === 'string' || r.total.percentText === null), true);
eq('statistics are counts of database states', [tm.stats.n, tm.stats.ungraded, tm.stats.drafts, tm.stats.excused, tm.stats.missing], [4, 0, 1, 1, 0]);

// The old grid also called an M-day section's blank a zero off a finalized classmate; here a blank is whatever the database says.
{
  const m = G.buildMatrix({ enrollments: [people[0], people[1]], offerings: [item10], grades: [], submissions: [], extensions: [],
    dbCells: [dbc({ enrollment_id: 'eA', state: 'missing', points_earned: null }), dbc({ enrollment_id: 'eB', state: 'not_due', points_earned: null })],
    dbTotals: [dbt({ enrollment_id: 'eA', earned_text: '0', possible_text: '10', percent_text: '0', percent_key_text: '0', letter: 'F' }), dbt({ enrollment_id: 'eB', earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null })],
    now: NOW });
  eq('missing is a 0 and not-due is nothing', [m.rows[0].cells[0].state, m.rows[0].cells[0].points, m.rows[1].cells[0].state, m.rows[1].cells[0].points], [G.CELL.MISSING, 0, G.CELL.PENDING, null]);
  eq('missing is its own band (no credit)', m.rows[0].band.key, 'd0');
  eq('and nothing counted has no band', m.rows[1].band, null);
  eq('stats tally missing from the database state', m.stats.missing, 1);
  eq('"counted N of M" counts the database states in the total, and changes no total text',
     [m.rows[0].total.counted, m.rows[0].total.items, m.rows[0].total.percentText, m.rows[1].total.counted, m.rows[1].total.items],
     [1, 1, '0', 0, 1]);
}

// The extension has to survive the trip through buildMatrix for its display facts (the due date the cell shows).
{
  const extended = G.buildMatrix({
    enrollments: [{ enrollmentId: 'e1', sectionId: SEC_M }, { enrollmentId: 'e2', sectionId: SEC_M }],
    offerings: [offering({ offeringId: 'x1', slug: 'preflight-01', dueAt: PAST })],
    grades: [], submissions: [],
    extensions: [{ enrollment_id: 'e2', assignment_offering_id: 'x1', extended_due_at: FUTURE }],
    dbCells: [dbc({ enrollment_id: 'e1', assignment_offering_id: 'x1', state: 'missing', points_earned: null }), dbc({ enrollment_id: 'e2', assignment_offering_id: 'x1', state: 'not_due', points_earned: null })],
    dbTotals: [], now: NOW,
  });
  eq('the state is the database\'s for both cadets', extended.rows.map((r) => r.cells[0].state), [G.CELL.MISSING, G.CELL.PENDING]);
  check('the extended cadet\'s cell shows the extended date', +new Date(extended.rows[1].cells[0].due) === +new Date(FUTURE));
}


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
  extensions: [], dbTotals: [],
  dbCells: [dbc({ enrollment_id: 'e1', assignment_offering_id: 'x1', state: 'released', points_earned: 2, points_possible: 2 })], now: NOW,
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
  grades: [], submissions: [], extensions: [], dbTotals: [],
  dbCells: [dbc({ enrollment_id: 'e9', assignment_offering_id: 'x1', state: 'not_due', points_earned: null })], now: NOW,
});
eq('a cell with no grade has null signals, so it renders plain',
   [bare.rows[0].cells[0].effort, bare.rows[0].cells[0].understanding], [null, null]);

process.exitCode = summary() ? 0 : 1;
