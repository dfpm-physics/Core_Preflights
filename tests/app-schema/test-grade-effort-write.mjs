// test-grade-effort-write.mjs — what a Save actually SENDS for a non-written card.
//
// The three rules in effortRows() are all invisible from the outside and all destructive when
// wrong, so they are asserted against the upsert payload rather than through a count:
//
//   1. `effort: null` on every row. app.grades_points_from_effort() (migration 019) is a BEFORE
//      INSERT OR UPDATE trigger that recomputes points_earned from effort whenever effort is not
//      null. Leave it populated and the instructor's 1 point is put straight back to 2 by the
//      database — the override appears to save and then is not there.
//   2. ONLY EDITED ROWS. The inverse of gradeRows() rule 1. Re-sending an untouched interactive
//      row would clear grades.effort on every derived grade in the section the first time anyone
//      clicked Save on somebody else's card.
//   3. THE NOTE MERGES into `diagnostic`, never replaces it. That column holds the artifact's
//      frozen schema:1 payload, which the whole cohort rollup is built from.
//
// It also pins the two-upsert split: written rows and effort rows cannot share one array, because
// PostgREST builds its column list from the union of the payload keys.
//
// Offline. window.db is a recording stub, so the assertions are about the writes issued — the
// same pattern and the same reasoning as test-grace.mjs.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });

let CALLS = [];
const stubFrom = (table) => {
  const state = { table, verb: 'select' };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte',
                   'order', 'limit', 'filter', 'or', 'select'])
    c[m] = () => c;
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { state.verb = verb; CALLS.push({ table, verb, payload }); return c; };
  // Every write here is followed by .select('id'); resolve with one row per payload row so the
  // grade_events fan-out in finalizeScores has something to map over.
  c.then = (res) => res({
    data: Array.isArray(CALLS.at(-1)?.payload)
      ? CALLS.at(-1).payload.map((_, i) => ({ id: `g-${i}` })) : [],
    error: null,
  });
  return c;
};
globalThis.window.db = { from: stubFrom };

const G = await import('../../site/js/faculty-grade.js');

const WRITTEN_ID = 'act-written';
const OFFERING = {
  offeringId: 'off-1', slug: 'preflight-07', pointsPossible: 2,
  written: { id: WRITTEN_ID, content: { questions: [
    { id: 'q2', text: 'Reading reflection', points: 1 },
    { id: 'q3', text: 'Free response',      points: 1 },
  ] } },
  interactive: { id: 'act-interactive' },
};
const STUDENTS = [
  { student_id: 1002, name: 'Interacted, Ivan', enrollment_id: 'enr-1002', section_id: 'sec-a' },
  { student_id: 1004, name: 'Absent, Alice',    enrollment_id: 'enr-1004', section_id: 'sec-a' },
];
const ctx = { user: { id: 'instr-1' } };

// Ivan's derived grade, exactly as migration 015 writes it: the whole schema:1 payload in
// `diagnostic`, effort 4 -> 2 points, finalized on commit.
const ARTIFACT = {
  schema: 1, effort: 4, overall_understanding: 3,
  reading_reflection: { meaningful: true },
  misconceptions: [{ key: 'shielding' }],
};
const GRADE_MAP = {
  1002: { gradeId: 'g-1002', qs: {}, finalized: true, effort: 4, pointsEarned: 2,
          diagnostic: ARTIFACT, source: 'derived' },
};

const freshEffort = () => G.buildEffortData(
  OFFERING, STUDENTS, GRADE_MAP,
  { 1002: { chosenActivityId: 'act-interactive', committedAt: '2026-08-22T05:00:00Z' } },
  {});

const lastGradeUpserts = () => CALLS.filter(c => c.table === 'grades' && c.verb === 'upsert');

section('rule 2 — an untouched card sends nothing at all');

CALLS = [];
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, freshEffort());
eq('no grades write was issued', lastGradeUpserts().length, 0);

section('rule 1 — an edited card nulls effort and owns points_earned');

CALLS = [];
const ed1 = freshEffort();
ed1[1002].points = 1;
ed1[1002].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, ed1);

eq('exactly one upsert', lastGradeUpserts().length, 1);
const rows = lastGradeUpserts()[0].payload;
eq('carrying exactly one row', rows.length, 1);
const row = rows[0];

eq('keyed on the enrollment', row.enrollment_id, 'enr-1002');
check('effort is NULL — otherwise the trigger overwrites points_earned', row.effort === null);
eq('points_earned is the instructor\'s value', row.points_earned, 1);
eq('points_possible comes from the offering', row.points_possible, 2);
eq('question_scores stays empty — migration 014\'s CHECK', row.question_scores, {});
eq('source becomes instructor', row.source, 'instructor');
eq('a draft save does not publish', row.is_finalized, false);

section('rule 1 — the measurement survives in diagnostic');

eq('the artifact\'s effort is untouched', row.diagnostic.effort, 4);
eq('…and the rest of the schema:1 payload with it', row.diagnostic.schema, 1);
eq('…including the misconceptions the rollup reads', row.diagnostic.misconceptions.length, 1);
check('the stored payload object was not mutated in place', GRADE_MAP[1002].diagnostic === ARTIFACT);
eq('…and still has no note on it', ARTIFACT.instructor_note, undefined);

section('points are clamped to the offering, so grades_within_bounds cannot be breached');

CALLS = [];
const edHigh = freshEffort();
edHigh[1002].points = 99;
edHigh[1002].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edHigh);
eq('clamped down to points_possible', lastGradeUpserts()[0].payload[0].points_earned, 2);

CALLS = [];
const edNeg = freshEffort();
edNeg[1002].points = -5;
edNeg[1002].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edNeg);
eq('and up to zero', lastGradeUpserts()[0].payload[0].points_earned, 0);

section('rule 3 — the note merges into diagnostic, and clearing it removes only that key');

CALLS = [];
const edNote = freshEffort();
edNote[1002].points = 0;
edNote[1002].note = '  Report was blank — see me.  ';
edNote[1002].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edNote);
const noted = lastGradeUpserts()[0].payload[0];
eq('the note text is trimmed', noted.diagnostic.instructor_note.text, 'Report was blank — see me.');
eq('…attributed to the grader', noted.diagnostic.instructor_note.by, 'instr-1');
check('…and timestamped', typeof noted.diagnostic.instructor_note.at === 'string');
eq('the artifact payload is still there beside it', noted.diagnostic.effort, 4);

// Clearing the text must not blank the whole column.
CALLS = [];
const WITH_NOTE = { ...ARTIFACT, instructor_note: { text: 'old', by: 'instr-0', at: 'then' } };
const gmNoted = { 1002: { ...GRADE_MAP[1002], diagnostic: WITH_NOTE } };
const edClear = G.buildEffortData(OFFERING, STUDENTS, gmNoted,
  { 1002: { chosenActivityId: 'act-interactive' } }, {});
eq('the existing note loads into the model', edClear[1002].note, 'old');
edClear[1002].note = '';
edClear[1002].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, gmNoted, edClear);
const cleared = lastGradeUpserts()[0].payload[0];
check('instructor_note is gone', cleared.diagnostic.instructor_note === undefined);
eq('…and nothing else went with it', cleared.diagnostic.effort, 4);

section('a no-submission card with no prior grade writes a whole new row');

CALLS = [];
const edNew = freshEffort();
eq('Alice opens ungraded', edNew[1004].points, null);
eq('…on the no-submission card', edNew[1004].kind, 'nosubmission');
edNew[1004].points = 2;
edNew[1004].note = 'Submission failed on our side; credit awarded.';
edNew[1004].modified = true;
await G.saveScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edNew);
const fresh = lastGradeUpserts()[0].payload.find(r => r.enrollment_id === 'enr-1004');
check('a row is written for her', !!fresh);
eq('at full credit', fresh.points_earned, 2);
check('with effort still null — she has no measured effort to record', fresh.effort === null);
eq('and a diagnostic holding only the note', Object.keys(fresh.diagnostic), ['instructor_note']);

section('the two row kinds go in SEPARATE upserts, never one array');

CALLS = [];
const gdWritten = G.buildGradeData(
  OFFERING,
  [{ student_id: 1005, name: 'Wrote, Wendy', enrollment_id: 'enr-1005', section_id: 'sec-a' }],
  { 1005: { q2: 'yes', q3: 'vectors' } },
  { 1005: { gradeId: 'g-1005', qs: {}, finalized: false, source: 'ai_suggested' } },
  { 1005: { chosenActivityId: WRITTEN_ID } });
gdWritten[1005].q3.status = 'zero';
gdWritten[1005].q3.score = 0;
gdWritten[1005].q3.modified = true;

const bothStudents = [...STUDENTS,
  { student_id: 1005, name: 'Wrote, Wendy', enrollment_id: 'enr-1005', section_id: 'sec-a' }];
const edBoth = freshEffort();
edBoth[1002].points = 0;
edBoth[1002].modified = true;

await G.saveScores(ctx, OFFERING, bothStudents, gdWritten,
  { ...GRADE_MAP, 1005: { gradeId: 'g-1005', qs: {}, finalized: false, source: 'ai_suggested' } },
  edBoth);

const ups = lastGradeUpserts();
eq('two upserts, not one', ups.length, 2);
const writtenRow = ups[0].payload[0];
const effortRow  = ups[1].payload[0];
eq('the written array is written rows', writtenRow.enrollment_id, 'enr-1005');
check('…and carries no diagnostic key, so a Save cannot race /preflight-analyze',
      !('diagnostic' in writtenRow));
eq('the effort array is effort rows', effortRow.enrollment_id, 'enr-1002');
check('…and carries no question_scores content', Object.keys(effortRow.question_scores).length === 0);

section('finalize publishes both, and counts both');

CALLS = [];
const edFin = freshEffort();
edFin[1002].points = 2;
edFin[1002].modified = true;
eq('writableCount sees the effort edit', G.writableCount(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edFin), 1);
await G.finalizeScores(ctx, OFFERING, STUDENTS, {}, GRADE_MAP, edFin);
eq('the row is published', lastGradeUpserts()[0].payload[0].is_finalized, true);
check('and an audit event is appended',
      CALLS.some(c => c.table === 'grade_events' && c.verb === 'insert'));

summary();
