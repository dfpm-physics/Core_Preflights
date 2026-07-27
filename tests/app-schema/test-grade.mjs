// test-grade.mjs — the Grade tab's grading-model assembly, and the one rule that keeps an
// interactive taker's effort grade from being silently zeroed. (Roadmap P0.14)
//
// WHY THIS EARNS ITS PLACE
//   On a `choice` offering both the written and the interactive activity are `graded`, and each
//   student picks. The grading MECHANISM is therefore a property of the student, not the offering:
//   an interactive taker is graded by effort (grades.effort -> the DB trigger), a written taker by
//   question_scores. buildGradeData() builds the editable per-question model, and it must exclude
//   the interactive takers — because:
//
//     they answered no written question, so every question defaults to `zero` (hasAnswer false),
//     AND they have a prior grade row, so gradeRows() rule 2 would NOT skip them — meaning one
//     click of Save writes a question_scores full of zeros over their effort grade and sets
//     points_earned to 0.
//
//   Giving them no gradeData entry is what makes rule 2 skip them. This suite pins that, plus the
//   `chosen_activity_id` predicate it turns on, because a plausible simplification of either
//   ("just grade everyone with a submission") reintroduces the zeroing bug and it renders exactly
//   like a correct card.
//
// Offline: buildGradeData/isEffortGraded/gradeRows are pure. The client below exists only because
// faculty-grade.js imports supabase.js, which throws at import when window.db is absent.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/grade.html' });
globalThis.window.db = makeClient();

const G = await import('../../site/app/js/faculty-grade.js');

/* ── Fixtures ─────────────────────────────────────────────────────────────────
 * A `choice` offering: one written activity, one interactive, both graded. Two questions on the
 * written side, worth 1 point each (the Fall build: Q2 reflection + Q3 free response). */

const WRITTEN_ID = 'act-written';
const INTERACTIVE_ID = 'act-interactive';

const OFFERING = {
  offeringId: 'off-1',
  slug: 'preflight-03',
  pointsPossible: 2,
  written: {
    id: WRITTEN_ID,
    content: { questions: [
      { id: 'q2', text: 'Reading reflection', points: 1 },
      { id: 'q3', text: 'Free response',      points: 1 },
    ] },
  },
  interactive: { id: INTERACTIVE_ID },
};

const STUDENTS = [
  { student_id: 1001, name: 'Wrote, Wendy',       enrollment_id: 'enr-1001', section_id: 'sec-a' },
  { student_id: 1002, name: 'Interacted, Ivan',   enrollment_id: 'enr-1002', section_id: 'sec-a' },
  { student_id: 1003, name: 'Undecided, Uma',     enrollment_id: 'enr-1003', section_id: 'sec-a' },
];

// Wendy committed to the written activity; Ivan to the interactive; Uma has a draft (no choice).
const SUBMISSION_MAP = {
  1001: { chosenActivityId: WRITTEN_ID,     committedAt: '2026-08-11T05:00:00Z' },
  1002: { chosenActivityId: INTERACTIVE_ID, committedAt: '2026-08-11T05:00:00Z' },
  1003: { chosenActivityId: null,           committedAt: null },
};

const RESPONSE_MAP = {
  1001: { q2: 'I read it and reflected.', q3: 'The forces add as vectors.' },
  1002: {},   // interactive taker wrote nothing on the written side
  1003: { q2: 'Half an answer' },
};

// Ivan already has an effort grade (2/5 -> 1 pt) from grade_interactive.py. Wendy and Uma have none.
const GRADE_MAP = {
  1002: { gradeId: 'g-1002', qs: {}, finalized: false, effort: 2, pointsEarned: 1,
          source: 'ai_suggested' },
};

/* ── isEffortGraded — the predicate ──────────────────────────────────────────── */
section('isEffortGraded: which students are graded by effort, not questions');

check('committed to the interactive activity -> effort-graded',
      G.isEffortGraded(OFFERING, SUBMISSION_MAP[1002]) === true);
check('committed to the written activity -> NOT effort-graded',
      G.isEffortGraded(OFFERING, SUBMISSION_MAP[1001]) === false);
check('nothing chosen yet -> NOT effort-graded (still show the written card)',
      G.isEffortGraded(OFFERING, SUBMISSION_MAP[1003]) === false);
check('no submission at all -> NOT effort-graded',
      G.isEffortGraded(OFFERING, undefined) === false);
// A preflight-only offering has no interactive id; a written commit must never read as effort.
check('written-only offering: written commit is not effort-graded',
      G.isEffortGraded({ written: { id: WRITTEN_ID } }, SUBMISSION_MAP[1001]) === false);

/* ── buildGradeData — the exclusion ──────────────────────────────────────────── */
section('buildGradeData: interactive takers get no editable question model');

const gd = G.buildGradeData(OFFERING, STUDENTS, RESPONSE_MAP, GRADE_MAP, SUBMISSION_MAP);

check('the written taker has a gradeData entry', !!gd[1001]);
check('the undecided (draft) student has one too', !!gd[1003]);
check('the interactive taker is EXCLUDED — this is the safety rule',
      gd[1002] === undefined);
eq('the written taker keeps both questions', Object.keys(gd[1001]).sort(), ['q2', 'q3']);

// Back-compat: called WITHOUT submissionMap, nobody is excluded (the old signature still works,
// it just cannot protect an effort taker — every caller in the app now passes it).
const gdNoSub = G.buildGradeData(OFFERING, STUDENTS, RESPONSE_MAP, GRADE_MAP);
check('without submissionMap, no student is excluded (old signature safe)',
      !!gdNoSub[1002]);

/* ── writableCount — the zeroing this prevents ───────────────────────────────
 * writableCount() is the exported wrapper over the private gradeRows(); it returns exactly how
 * many rows a Save/Finalize would write, which is the number the confirm prompt shows. Asserting
 * on it proves the interactive taker is not among them without reaching into a private. */
section('writableCount: a Save over this model must not write the interactive taker');

const ctx = { user: { id: 'instr-1' } };

// Nobody edited any card (modified stays false), so gradeRows rule 2 writes only students with a
// prior grade AND an edit — i.e. nobody. The point is that this holds WITH Ivan present in the
// roster and holding a prior effort grade.
check('an unedited Save writes nothing at all',
      G.writableCount(ctx, OFFERING, STUDENTS, gd, GRADE_MAP) === 0);

// The counterfactual that proves the bug is real. Build the model the PRE-FIX way (no
// submissionMap, so Ivan is NOT excluded) and edit his q3 to zero — the exact effect of the
// written toggle defaulting his blank answer to `zero`. He has a prior row, so rule 2 does not
// skip him: writableCount rises, and a Save would overwrite his effort grade with 0.
section('counterfactual: what the exclusion prevents');
const gdUnsafe = G.buildGradeData(OFFERING, STUDENTS, RESPONSE_MAP, GRADE_MAP); // no submissionMap
check('WITHOUT the fix, the interactive taker gets an editable model', !!gdUnsafe[1002]);
gdUnsafe[1002].q3.status = 'zero';
gdUnsafe[1002].q3.score = 0;
gdUnsafe[1002].q3.modified = true;
check('...so a Save WOULD write a row that zeroes their 1-pt effort grade',
      G.writableCount(ctx, OFFERING, STUDENTS, gdUnsafe, GRADE_MAP) === 1);
check('...whereas WITH the fix that student is not in the model to be touched',
      gd[1002] === undefined);

/* ══════════════════════════════════════════════════════════════════════════════
 * buildGradingQueue — the hand-grading queue (Roadmap P1.14)
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EARNS ITS PLACE
 *   The queue's whole claim is "these, and only these, need a human". Two failure modes destroy
 *   that and neither is visible on the page:
 *
 *     1. LISTING SOMEBODY WHO IS ALREADY HANDLED — most importantly an interactive taker, whose
 *        grade migration 015 writes on commit. A queue that lists work nobody has to do is a queue
 *        people stop opening, and this is the one rule here that depends on another part of the
 *        system being true.
 *     2. OMITTING SOMEBODY WHO IS NOT — a student inside an extension that has since run out is
 *        exactly the person the AI pass missed, because /preflight-analyze ran before they
 *        submitted. They are invisible everywhere else.
 *
 *   Extensions also flip the meaning of "late": granted until Friday and submitted Thursday is NOT
 *   late, and badging it would turn an on-time submission into an accusation.
 */
section('buildGradingQueue — who is waiting on a human');

const QNOW = new Date('2026-09-10T12:00:00Z');
const DUE  = '2026-09-01T05:59:00Z';          // the offering deadline, well past QNOW

const qOffering = (over = {}) => ({
  id: 'off-q', slug: 'preflight-05', title: 'Preflight 5', dueAt: DUE, position: 5,
  dueBySection: {}, writtenActivityId: WRITTEN_ID, ...over,
});
const qStudent = (n, section = 'sec-A') => ({
  student_id: n, name: `Cadet ${n}`, enrollment_id: `enr-${n}`, section_id: section,
});
const qSub = (n, over = {}) => ({
  enrollment_id: `enr-${n}`, assignment_offering_id: 'off-q',
  chosen_activity_id: WRITTEN_ID, status: 'committed',
  committed_at: '2026-09-03T10:00:00Z',        // two days after the deadline => late
  ...over,
});

const runQ = (d) => G.buildGradingQueue({
  offerings: [qOffering()], students: [], submissions: [], grades: [], extensions: [], ...d,
}, QNOW);

// The base case: committed late, nothing published.
const late1 = runQ({ students: [qStudent(1)], submissions: [qSub(1)] });
eq('a late submission is queued', late1.map(r => r.studentId), [1]);
eq('…labelled as late', late1[0].reason, 'late');
eq('…with no grade row it reads as ungraded', late1[0].state, 'ungraded');
check('…and carries the assignment so one click can open it',
      late1[0].offeringId === 'off-q' && late1[0].title === 'Preflight 5');

// THE RULE THAT DEPENDS ON MIGRATION 015. An interactive taker is auto-graded on commit; listing
// them would be listing work that does not exist.
eq('an interactive taker is never queued, however late',
   runQ({ students: [qStudent(2)], submissions: [qSub(2, { chosen_activity_id: INTERACTIVE_ID })] }), []);
// …but a student who has not chosen yet still might land on the written path, so they stay in.
eq('an undecided (nothing chosen) late submitter IS queued',
   runQ({ students: [qStudent(3)], submissions: [qSub(3, { chosen_activity_id: null })] })
     .map(r => r.studentId), [3]);

// Already dealt with, in each of the three ways.
eq('a finalized grade removes them',
   runQ({ students: [qStudent(4)], submissions: [qSub(4)],
          grades: [{ enrollment_id: 'enr-4', assignment_offering_id: 'off-q', is_finalized: true }] }), []);
eq('an unfinalized AI suggestion keeps them, flagged as AI-only',
   runQ({ students: [qStudent(5)], submissions: [qSub(5)],
          grades: [{ enrollment_id: 'enr-5', assignment_offering_id: 'off-q',
                     is_finalized: false, source: 'ai_suggested' }] })[0].state, 'ai-only');
eq('an unfinalized instructor draft keeps them, flagged as a draft',
   runQ({ students: [qStudent(6)], submissions: [qSub(6)],
          grades: [{ enrollment_id: 'enr-6', assignment_offering_id: 'off-q',
                     is_finalized: false, source: 'instructor' }] })[0].state, 'draft');

// Nothing to grade.
eq('a draft submission is not queued — nobody handed anything in',
   runQ({ students: [qStudent(7)], submissions: [qSub(7, { status: 'draft', committed_at: null })] }), []);
eq('an on-time submission is not queued',
   runQ({ students: [qStudent(8)],
          submissions: [qSub(8, { committed_at: '2026-08-31T22:00:00Z' })] }), []);

/* Extensions — the case the whole feature turns on. */
const ext = (n, iso, reason = 'Team trip') =>
  ({ enrollment_id: `enr-${n}`, assignment_offering_id: 'off-q', extended_due_at: iso, reason });

eq('a student INSIDE a live extension is not queued and not called late',
   runQ({ students: [qStudent(9)], submissions: [qSub(9)],
          extensions: [ext(9, '2026-09-20T05:59:00Z')] }), []);

const expired = runQ({
  students: [qStudent(10)],
  // Submitted before their extension ran out, so they are NOT late — but the extension has now
  // passed and nothing is published, which is precisely the student the AI pass never saw.
  submissions: [qSub(10, { committed_at: '2026-09-04T10:00:00Z' })],
  extensions: [ext(10, '2026-09-05T05:59:00Z')],
});
eq('an expired extension with work in IS queued', expired.map(r => r.studentId), [10]);
eq('…and is labelled as an extension, not as late', expired[0].reason, 'extension-expired');
eq('…carrying the reason the director will want', expired[0].extensionReason, 'Team trip');

// Blowing through an extension: both facts are true and the more specific one wins.
eq('past their own extended deadline reads as late, not as "extension over"',
   runQ({ students: [qStudent(11)], submissions: [qSub(11, { committed_at: '2026-09-06T10:00:00Z' })],
          extensions: [ext(11, '2026-09-05T05:59:00Z')] })[0].reason, 'late');

// A per-section deadline override must beat the offering default, or a T-day section reads late.
eq('a section override moves the line',
   G.buildGradingQueue({
     offerings: [qOffering({ dueBySection: { 'sec-A': '2026-09-05T05:59:00Z' } })],
     students: [qStudent(12)], submissions: [qSub(12)], grades: [], extensions: [],
   }, QNOW), []);

// Ordering: oldest deadline first — what has waited longest is what gets forgotten.
const ordered = G.buildGradingQueue({
  offerings: [qOffering(), qOffering({ id: 'off-old', slug: 'preflight-01', title: 'Preflight 1',
                                       dueAt: '2026-08-10T05:59:00Z' })],
  students: [qStudent(13), qStudent(14)],
  submissions: [qSub(13), qSub(14, { assignment_offering_id: 'off-old' })],
  grades: [], extensions: [],
}, QNOW);
eq('the queue is cross-assignment', ordered.length, 2);
eq('…oldest deadline first', ordered.map(r => r.slug), ['preflight-01', 'preflight-05']);

// Rows we cannot resolve must drop rather than render half a card.
eq('a submission for an unknown offering is dropped',
   runQ({ students: [qStudent(15)], submissions: [qSub(15, { assignment_offering_id: 'gone' })] }), []);
eq('a submission for an unknown enrollment is dropped',
   runQ({ students: [], submissions: [qSub(16)] }), []);

/* ── "— all my sections —" means the sections you TEACH (2026-07-27) ──────────
 * mySectionIds() returned ctx.sectionIds, which for an instructor is right and for a DIRECTOR is
 * every section of the offering — because their offering-wide staff row carries section_id NULL
 * and staff_sections() expands it. So the picker's "all my sections" silently loaded the whole
 * course, byte-identical to the "All sections (entire course)" option beside it, and the faculty
 * beta reported exactly that: picking one section filters, picking "mine" does not.
 *
 * The failure is invisible on screen — a director who teaches two sections sees a longer list and
 * no reason to think it is wrong — which is what makes it worth a test rather than a re-read. */
section('faculty-grade.js — mySectionIds');

const teaches = (rows) => ({
  currentOffering: 'off-1',
  sectionIds: ['sec-a', 'sec-b', 'sec-c'],
  staff: rows,
});

eq('a director gets only the sections they personally teach',
   G.mySectionIds(teaches([
     { course_offering_id: 'off-1', section_id: null,    role: 'director' },   // sees everything
     { course_offering_id: 'off-1', section_id: 'sec-b', role: 'director' },   // teaches this one
   ])), ['sec-b']);

eq('an instructor is unaffected — what they see IS what they teach',
   G.mySectionIds({ currentOffering: 'off-1', sectionIds: ['sec-a', 'sec-b'],
     staff: [{ course_offering_id: 'off-1', section_id: 'sec-a', role: 'instructor' },
             { course_offering_id: 'off-1', section_id: 'sec-b', role: 'instructor' }] }),
   ['sec-a', 'sec-b']);

// The fallback, and the half that would otherwise fail silently: a pure director teaching nothing
// must get the whole course rather than an empty page that looks like "nothing to grade".
eq('a director who teaches nothing still gets everything they staff',
   G.mySectionIds(teaches([{ course_offering_id: 'off-1', section_id: null, role: 'director' }])),
   ['sec-a', 'sec-b', 'sec-c']);

// Another term's staff row must not widen or narrow this one.
eq('a staff row in a different offering is ignored',
   G.mySectionIds(teaches([
     { course_offering_id: 'off-1', section_id: 'sec-a', role: 'instructor' },
     { course_offering_id: 'off-2', section_id: 'sec-z', role: 'director' },
   ])), ['sec-a']);

process.exit(summary() ? 0 : 1);
