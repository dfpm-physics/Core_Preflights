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

installBrowser({ pathname: '/site/faculty/grade.html' });
globalThis.window.db = makeClient();

const G = await import('../../site/js/faculty-grade.js');

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

/* THE EXCLUSION NO LONGER DEPENDS ON THE CALLER (2026-08-21).
 *
 * This used to assert the opposite — that calling without submissionMap excluded nobody, the old
 * signature being "safe" only in the sense that it did not throw. It was a real hole: the one
 * argument that protected an effort grade was optional, and forgetting it produced a model that
 * renders identically to a correct one and zeroes somebody on Save.
 *
 * buildGradeData now asks cardKindFor(), which falls back to the OFFERING'S POLICY when it has no
 * submission to go on. On a choice offering a cadet with no commitment and no typed answers is
 * 'nosubmission', so Ivan is excluded either way. The guarantee got stronger, and the assertion
 * has to say so rather than keep describing the weaker one. */
const gdNoSub = G.buildGradeData(OFFERING, STUDENTS, RESPONSE_MAP, GRADE_MAP);
check('the interactive taker is excluded even without submissionMap',
      gdNoSub[1002] === undefined);
check('...and the written taker is still included, so it is not excluding everyone',
      !!gdNoSub[1001]);

/* ── `original` — the load-time baseline (2026-07-30) ────────────────────────
 * Two things in grade.html read it and neither works off `status`: the status-lamp filter (so
 * re-scoring an answer does not make the card vanish under the reader) and the before → after
 * control (so an unsaved change is legible AS a change). Both are silent when it is wrong — the
 * filter simply behaves the way it used to, which is the bug this replaced. */
section('buildGradeData: `original` is the status as loaded, and is not the live one');

eq('every question carries one', Object.values(gd[1001]).map(x => typeof x.original),
   ['string', 'string']);
eq('it starts equal to status — an untouched answer shows one chip, not a pair',
   Object.values(gd[1001]).map(x => x.original === x.status), [true, true]);
// The two shapes buildGradeData derives a status from, since `original` has to survive both.
eq('an answered, ungraded question baselines at full', gd[1001].q3.original, 'full');
eq('a blank, ungraded question baselines at zero', gd[1003].q3.original, 'zero');

// A saved AI suggestion: q3 scored with feedback is `warn`, and that — not `full` — is what the
// lamps must filter it under.
const gdSaved = G.buildGradeData(OFFERING, STUDENTS, RESPONSE_MAP, {
  1001: { gradeId: 'g-1001', finalized: false, source: 'ai_suggested',
          qs: { q2: { score: 1, status: 'full', feedback: '' },
                q3: { score: 1, status: 'warn', feedback: 'Close, but the direction is reversed.' } } },
}, SUBMISSION_MAP);
eq('a saved status is the baseline, not a recomputed one', gdSaved[1001].q3.original, 'warn');

// The property the filter depends on: mutating `status` the way toggleCredit does must leave
// `original` alone. If these ever move together the filter silently reverts to its old behaviour.
gdSaved[1001].q3.status = 'zero';
gdSaved[1001].q3.modified = true;
eq('re-scoring moves status…', gdSaved[1001].q3.status, 'zero');
eq('…and leaves original where it was', gdSaved[1001].q3.original, 'warn');

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

/* The counterfactual that proves the bug is real. It can no longer be produced by dropping
 * submissionMap — see above — so it is built by HAND: the model buildGradeData would have to
 * return for Ivan in order for the zeroing to happen, with his blank answers defaulted to `zero`
 * exactly as the written toggle would. He has a prior row, so rule 2 does not skip him.
 *
 * Constructing it by hand is the point. It asserts what the CONSEQUENCE would be if the exclusion
 * ever regressed, independently of the mechanism currently doing the excluding — so a future
 * refactor of cardKindFor() that quietly lets an effort taker back in still fails here. */
section('counterfactual: what the exclusion prevents');
const gdUnsafe = {
  ...gd,
  1002: {
    q2: { score: 0, feedback: '', status: 'zero', original: 'zero', modified: false },
    q3: { score: 0, feedback: '', status: 'zero', original: 'zero', modified: true },
  },
};
check('a model that DID include the interactive taker would write a row for him',
      G.writableCount(ctx, OFFERING, STUDENTS, gdUnsafe, GRADE_MAP) === 1);
check('...and that row would zero the 1-pt effort grade he already holds',
      G.writableCount(ctx, OFFERING, STUDENTS, gdUnsafe, GRADE_MAP) >
      G.writableCount(ctx, OFFERING, STUDENTS, gd, GRADE_MAP));
check('...whereas the real model never contains him to be touched',
      gd[1002] === undefined);

/* ── buildEffortData — the other half of the split (2026-08-21) ──────────────
 * The two models must be EXACT COMPLEMENTS: a student in both is written twice by one Save, in
 * two separate upserts, and the second silently overwrites the first. */
section('buildEffortData: everyone buildGradeData excluded, and nobody it kept');

const ed = G.buildEffortData(OFFERING, STUDENTS, GRADE_MAP, SUBMISSION_MAP, RESPONSE_MAP);

check('the interactive taker is here', !!ed[1002]);
eq('...marked as the interactive card', ed[1002].kind, 'interactive');
eq('...opening on the points his effort grade already earned', ed[1002].points, 1);
check('the written taker is NOT here', ed[1001] === undefined);
check('the draft student is NOT here — he has answers, so he keeps the written card',
      ed[1003] === undefined);

const inBoth = STUDENTS.filter(s => gd[s.student_id] && ed[s.student_id]);
const inNeither = STUDENTS.filter(s => !gd[s.student_id] && !ed[s.student_id]);
eq('no student is in both models', inBoth.map(s => s.student_id), []);
eq('no student is in neither', inNeither.map(s => s.student_id), []);

section('effort rows: an untouched card writes nothing, and a touched one nulls effort');

check('nobody edited, so a Save writes no effort row',
      G.writableCount(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, ed) === 0);

// THE RULE THAT MATTERS MOST. Re-sending an untouched interactive row would clear grades.effort
// on every derived grade in the section the first time anyone clicked Save on somebody else's
// card — the inverse of gradeRows() rule 1, and a far worse failure.
ed[1002].points = 0;
ed[1002].modified = true;
check('one edited card writes exactly one row',
      G.writableCount(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, ed) === 1);
check('...and the untouched no-submission cards are still not among them',
      G.writableCount(ctx, OFFERING, STUDENTS, {}, GRADE_MAP,
        G.buildEffortData(OFFERING, STUDENTS, GRADE_MAP, SUBMISSION_MAP, RESPONSE_MAP)) === 0);

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

/* ── confirmEffortRows — publishing full credit confirms a low effort ─────────
 * The reading-reflection gate is a CEILING (effort = min(effort, 2)), and on the written path it
 * costs nothing: points come from question_scores, where yellow is full credit. So a student could
 * sit under a "Reflection capped" pill while holding every point the assignment was worth.
 * Finalizing full credit is the instructor asserting the work was worth full marks, which raises
 * the effort to 3. These pin the boundaries, because every one of them is a plausible "simplify
 * this to `effort = 3`" away from being wrong.
 *
 * The floor moved from 1 to 0 on 2026-08-10 — see the 0 cases below. 3 and above are the boundary
 * that still holds, and the one an over-simplification would break. */
section('confirmEffortRows: finalizing full credit raises a low effort');

const CTX = { user: { id: 'instr-1' } };
const capped = (effort, extra = {}) => ({
  1001: { gradeId: 'g-1001', qs: {}, finalized: false, source: 'ai_suggested',
          diagnostic: { schema: 1, effort, reading_reflection: { meaningful: false, engagement: effort },
                        q2_effort: effort, ...extra } },
});
// Full credit on both graded questions — the yellow case, which IS full credit.
const fullCredit = {
  1001: { q2: { score: 1, status: 'warn', modified: false },
          q3: { score: 1, status: 'warn', modified: false } },
};
const oneZero = {
  1001: { q2: { score: 0, status: 'zero', modified: false },
          q3: { score: 1, status: 'full', modified: false } },
};

const bumped = G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(2));
eq('a capped 2 is raised to 3', bumped.map(r => r.diagnostic.effort), [3]);
eq('…on the right enrollment', bumped.map(r => r.enrollment_id), ['enr-1001']);
eq('…recording what it was and who confirmed it',
   [bumped[0].diagnostic.effort_override.from, bumped[0].diagnostic.effort_override.by], [2, 'instr-1']);

// The gate is a ceiling, not a fixed value: thin answers everywhere AND a failed reflection lands
// on 1, and the same act of publishing full credit confirms both.
eq('a capped 1 is also raised to 3',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(1)).map(r => r.diagnostic.effort), [3]);

// 0 moves too, as of 2026-08-10. It is not only "no substantive participation anywhere": it is
// also what /preflight-analyze writes for a student it found no work from, which includes work the
// site LOST. An instructor awarding full credit over that zero is asserting the work existed.
const fromZero = G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(0));
eq('a 0 is raised to 3', fromZero.map(r => r.diagnostic.effort), [3]);
eq('…recording that it came from 0', fromZero.map(r => r.diagnostic.effort_override.from), [0]);

// The lost-submission shape specifically: /preflight-analyze's non-submitter zero, published over.
eq('a no_submission zero is raised too',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(0, { no_submission: true }))
     .map(r => r.diagnostic.effort), [3]);
check('…and no_submission survives — the override records the correction, it does not rewrite '
      + 'what the AI saw',
      G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(0, { no_submission: true }))[0]
        .diagnostic.no_submission === true);

// Never lowers, never exceeds 3.
eq('an effort already above the cap is untouched',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(5)), []);
eq('an effort already at 3 is untouched',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, capped(3)), []);

// Any zero on a graded question means it was not full credit.
eq('a zero on one question blocks the bump',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, oneZero, capped(2)), []);

// The AI's own reading is preserved — this records an override, it does not rewrite the judgement.
check('the AI meaningful judgement survives untouched',
      bumped[0].diagnostic.reading_reflection.meaningful === false);
check('q2_effort survives untouched', bumped[0].diagnostic.q2_effort === 2);

// A student with no diagnostic at all has nothing to confirm.
eq('no diagnostic -> nothing to do',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit,
     { 1001: { gradeId: 'g-1001', qs: {}, source: 'ai_suggested', diagnostic: null } }), []);
// …and so does a student with no prior grade row: there is no capped effort to raise.
eq('no prior grade row -> nothing to do',
   G.confirmEffortRows(CTX, OFFERING, STUDENTS, fullCredit, {}), []);

// Q1 is worth 0 points and is filtered out of the grading UI, so it must not gate the bump.
const withQ1 = { ...OFFERING, written: { id: WRITTEN_ID, content: { questions: [
  { id: 'q1', text: 'Reading time', points: 0 },
  { id: 'q2', text: 'Reading reflection', points: 1 },
  { id: 'q3', text: 'Free response', points: 1 },
] } } };
eq('a zero-point Q1 does not block the bump',
   G.confirmEffortRows(CTX, withQ1, STUDENTS, fullCredit, capped(2)).map(r => r.diagnostic.effort), [3]);

process.exit(summary() ? 0 : 1);
