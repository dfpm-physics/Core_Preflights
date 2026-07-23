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

process.exit(summary() ? 0 : 1);
