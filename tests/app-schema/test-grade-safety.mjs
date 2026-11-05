// test-grade-safety.mjs — three ways a grade, a screen or a file could be wrong without anyone being told.
//
//   E7  a save from a stale page must not overwrite a grade someone else has since changed
//   E8  changing a question's point value must not turn a hand-entered grade into zero
//   E9  a read that failed must not look like a read that found nothing (grading page, export, backup)
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db. It shows which reads and writes the shipped modules issue and what
//   they do with an error. It does not show two real sessions racing (the check is a read before the write, so two
//   saves inside the same few milliseconds are not stopped by it), nor that the database stamps `updated_at` on every
//   change (the `grades_touch` trigger does; the scratch proof of migration 049 changes grades under that trigger).

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });

/* ── a recording stub whose answer for each table and verb is set by the test ──────────────────────────────────── */
let CALLS = [];
let ANSWER = {};          // 'table.verb' -> { data, error } or a function returning one
const answerFor = (table, verb) => {
  const a = ANSWER[`${table}.${verb}`];
  const v = typeof a === 'function' ? a() : a;
  return v ?? { data: verb === 'select' ? [] : null, error: null };
};
const stubFrom = (table) => {
  const call = { table, verb: 'select', payload: null, filters: [] };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'select'])
    c[m] = (...args) => { if (m === 'eq' || m === 'in') call.filters.push([m, ...args]); return c; };
  c.range = (from) => { call.from = from; return c; };           // a second page is empty, so fetchAll stops
  c.maybeSingle = () => { call.single = true; return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { call.verb = verb; call.payload = payload; return c; };
  c.then = (res) => {
    CALLS.push(call);
    const a = call.from > 0 ? { data: [], error: null } : answerFor(table, call.verb);
    if (call.single && Array.isArray(a.data)) return res({ data: a.data[0] ?? null, error: a.error });
    return res(a);
  };
  return c;
};
globalThis.window.db = { from: stubFrom };

const G = await import('../../site/js/faculty-grade.js');
const L = await import('../../site/js/faculty-lessons.js');
const A = await import('../../site/js/faculty-admin.js');
const R = await import('../../site/js/checked-read.js');

const writesTo = (table) => CALLS.filter(c => c.table === table && c.verb !== 'select');

/* ── E7 ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('E7 — a save from a stale page');

const ctx = { user: { id: 'instr-a' } };
const OFFERING = {
  offeringId: 'off-1', slug: 'lesson-07', pointsPossible: 2,
  written: { id: 'act-w', content: { questions: [
    { id: 'q2', text: 'Reflection', points: 1 }, { id: 'q3', text: 'Free response', points: 1 }] } },
};
const STUDENTS = [
  { student_id: 5001, name: 'Xavier Invented', enrollment_id: 'enr-X', section_id: 'sec-a' },
  { student_id: 5002, name: 'Yara Invented',   enrollment_id: 'enr-Y', section_id: 'sec-a' },
];
const draft = (id, v) => ({ gradeId: id, qs: { q2: { score: 1, max: 1, feedback: '', status: 'full' },
                                               q3: { score: 1, max: 1, feedback: '', status: 'full' } },
                            finalized: false, source: 'ai_suggested', pointsEarned: 2, updatedAt: v });
const LOADED = { 5001: draft('g-X', 'v1'), 5002: draft('g-Y', 'v1') };
// the instructor edits Y only; X rides along unedited, as a save sends every unpublished card in scope
const editedY = () => {
  const gd = G.buildGradeData(OFFERING, STUDENTS, { 5001: {}, 5002: {} }, LOADED,
    { 5001: { chosenActivityId: 'act-w' }, 5002: { chosenActivityId: 'act-w' } }, new Set());
  gd[5002].q3.score = 0; gd[5002].q3.status = 'zero'; gd[5002].q3.modified = true;
  return gd;
};
const holds = (xv, yv) => [{ id: 'g-X', enrollment_id: 'enr-X', updated_at: xv }, { id: 'g-Y', enrollment_id: 'enr-Y', updated_at: yv }];

CALLS = []; ANSWER = { 'grades.select': { data: holds('v1', 'v1'), error: null } };
let res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), LOADED, {});
check('current page: the save goes through', !res.error && writesTo('grades').length === 1, res.error?.message);

CALLS = []; ANSWER = { 'grades.select': { data: holds('v2', 'v1'), error: null } };   // a colleague published X
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), LOADED, {});
check('a grade a colleague changed since the page loaded refuses the save', !!res.error && res.error.stale?.length === 1, res.error?.message);
check('…nothing at all is written (all or nothing)', writesTo('grades').length === 0);
check('…and the message says what to do, in plain words', /Nothing was saved/.test(res.error?.message || '') && /Reload/.test(res.error?.message || ''));

CALLS = []; ANSWER = { 'grades.select': { data: holds('v1', 'v9'), error: null } };   // the edited card itself moved
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), LOADED, {});
check('the edited card itself having moved refuses the save too', !!res.error && writesTo('grades').length === 0);

CALLS = []; ANSWER = { 'grades.select': { data: [holds('v1', 'v1')[1]], error: null } };   // X was deleted
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), LOADED, {});
check('a grade that has gone since the page loaded refuses the save', !!res.error && writesTo('grades').length === 0);

CALLS = []; ANSWER = { 'grades.select': { data: [{ id: 'g-new', enrollment_id: 'enr-Y', updated_at: 'v1' }], error: null } };
const noPrior = { 5001: draft('g-X', 'v1') };   // the page held no grade for Y; one has appeared
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), { ...noPrior, 5001: { ...noPrior[5001] } }, {});
check('a grade created by someone else for a card this page held none for refuses the save', !!res.error && writesTo('grades').length === 0, res.error?.message);

CALLS = []; ANSWER = { 'grades.select': { data: null, error: { message: 'network down' } } };
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), LOADED, {});
check('if the version cannot be read, nothing is written and the error is shown', !!res.error && /network down/.test(res.error.message) && writesTo('grades').length === 0);

CALLS = []; ANSWER = { 'grades.select': { data: holds('v1', 'v1'), error: null } };
const noVersion = { 5001: { ...draft('g-X', 'v1'), updatedAt: undefined }, 5002: { ...draft('g-Y', 'v1') } };
res = await G.saveScores(ctx, OFFERING, STUDENTS, editedY(), noVersion, {});
check('a page that holds a grade with no version cannot be shown current, so it does not save', !!res.error && writesTo('grades').length === 0);

eq('the pure rule: a matching version is current', G.staleEnrollments([{ enrollment_id: 'e' }], { e: { updated_at: 'v1' } }, { e: { gradeId: 'g', updatedAt: 'v1' } }), []);
eq('the pure rule: a different version is stale', G.staleEnrollments([{ enrollment_id: 'e' }], { e: { updated_at: 'v2' } }, { e: { gradeId: 'g', updatedAt: 'v1' } }), ['e']);

/* ── E8 ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('E8 — changing a question\'s points beside a hand-entered grade');

const QS = [{ id: 'q1', points: 0 }, { id: 'q2', points: 1 }, { id: 'q3', points: 2 }];
const graded = (extra = {}) => ({ id: 'g1', enrollment_id: 'enr-graded', is_finalized: true, points_possible: 2,
  question_scores: { q2: { score: 1, max: 1, status: 'full', feedback: '' }, q3: { score: 1, max: 1, status: 'full', feedback: '' } }, ...extra });
const hand = { id: 'g2', enrollment_id: 'enr-hand', is_finalized: true, points_possible: 2, question_scores: {} };
const partlyZero = { id: 'g3', enrollment_id: 'enr-zero', is_finalized: false, points_possible: 2,
  question_scores: { q2: { score: 0, max: 1, status: 'zero', feedback: '' }, q3: { score: 1, max: 1, status: 'full', feedback: '' } } };

CALLS = []; ANSWER = { 'grades.select': { data: [graded(), hand, partlyZero], error: null }, 'grades.upsert': { data: null, error: null } };
let n = await L.retroactivelyUpdateGrades('off-1', QS, 3);
const sent = writesTo('grades').flatMap(c => c.payload);
eq('two graded rows are rewritten and the hand-entered one is not counted', n, 2);
check('the hand-entered grade (empty question_scores) is not sent at all, so it keeps its score',
      !sent.some(r => r.enrollment_id === 'enr-hand'));
const g1 = sent.find(r => r.enrollment_id === 'enr-graded');
eq('a graded row takes the new values: full credit on q2 (1) and q3 (2)', Number(g1.points_earned), 3);
const g3 = sent.find(r => r.enrollment_id === 'enr-zero');
eq('a zero stays zero while the rest takes the new value', Number(g3.points_earned), 2);
eq('the published state rides through unchanged', [g1.is_finalized, g3.is_finalized], [true, false]);

CALLS = []; ANSWER = { 'grades.select': { data: [hand], error: null } };
n = await L.retroactivelyUpdateGrades('off-1', QS, 3);
eq('only hand-entered grades: nothing is written', [n, writesTo('grades').length], [0, 0]);

CALLS = []; ANSWER = { 'grades.select': { data: null, error: { message: 'timeout' } } };
let threw = null;
try { await L.retroactivelyUpdateGrades('off-1', QS, 3); } catch (e) { threw = e; }
check('a failed read throws instead of reporting that nothing needed updating', threw && /timeout/.test(threw.message), threw?.message);

CALLS = []; ANSWER = { 'grades.select': { data: [graded()], error: null }, 'grades.upsert': { data: null, error: { message: 'check violated' } } };
threw = null;
try { await L.retroactivelyUpdateGrades('off-1', QS, 3); } catch (e) { threw = e; }
check('a failed write throws, so the page can say some grades still hold the old values', threw && /check violated/.test(threw.message));

/* ── E9 ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('E9 — a failed read is an error, not an empty result');

check('checkedRows returns the rows', R.checkedRows({ data: [1, 2], error: null }, 'x').length === 2);
check('checkedRows treats a null result with no error as no rows', R.checkedRows({ data: null, error: null }, 'x').length === 0);
for (const [name, fn] of [['checkedRows', () => R.checkedRows({ data: null, error: { message: 'boom' } }, 'the grades')],
                          ['checkedOne', () => R.checkedOne({ data: null, error: { message: 'boom' } }, 'the grades')],
                          ['checkedAll', () => R.checkedAll([{ data: [], error: null }, { data: null, error: { message: 'boom' } }], 'the grades')],
                          ['checkedRows on no response', () => R.checkedRows(undefined, 'the grades')]]) {
  let e = null; try { fn(); } catch (x) { e = x; }
  check(`${name} throws ReadFailed naming what could not be read`, e instanceof R.ReadFailed && /the grades/.test(e.message) && /Nothing was changed/.test(e.message), e?.message);
}

const OFF_ROW = { id: 'off-1', course_offering_id: 'co-1', assignments: { id: 'a1', slug: 'lesson-07', title: 'Lesson 7' }, points_possible: 2 };
const ENR = [{ id: 'enr-X', student_id: 5001, section_id: 'sec-a', status: 'active', students: { student_id: 5001, name: 'Xavier Invented' } }];
const ctxG = { user: { id: 'i' }, sectionsById: {}, currentOffering: 'co-1' };

for (const failing of ['submissions', 'grades', 'extensions', 'enrollments']) {
  CALLS = [];
  ANSWER = { 'assignment_offerings.select': { data: [OFF_ROW], error: null },
             'enrollments.select': { data: ENR, error: null },
             'submissions.select': { data: [], error: null }, 'grades.select': { data: [], error: null },
             'extensions.select': { data: [], error: null } };
  ANSWER[`${failing}.select`] = { data: null, error: { message: `${failing} unavailable` } };
  const d = await G.loadGradingData(ctxG, 'off-1', ['sec-a']);
  check(`grading page: a failed ${failing} read shows an error and no cards`,
        d.readFailed === true && d.offering === null && /unavailable/.test(d.refusal?.message || '') && d.students.length === 0, JSON.stringify(d.refusal));
}
ANSWER = { 'assignment_offerings.select': { data: [OFF_ROW], error: null }, 'enrollments.select': { data: ENR, error: null },
           'submissions.select': { data: [], error: null }, 'grades.select': { data: [], error: null }, 'extensions.select': { data: [], error: null } };
const okLoad = await G.loadGradingData(ctxG, 'off-1', ['sec-a']);
check('grading page: when every read works the cards load as before', !!okLoad.offering && okLoad.students.length === 1 && !okLoad.readFailed);

const adminCtx = { currentOffering: 'co-1' };
const COLS = [{ id: 'off-1', due_at: null, position: 1, is_published: true, points_possible: 2, assignments: { slug: 'lesson-07', title: 'Lesson 7' } }];
for (const failing of ['assignment_offerings', 'enrollments', 'grades']) {
  ANSWER = { 'assignment_offerings.select': { data: COLS, error: null }, 'enrollments.select': { data: ENR, error: null }, 'grades.select': { data: [], error: null } };
  ANSWER[`${failing}.select`] = { data: null, error: { message: `${failing} unavailable` } };
  let e = null; try { await A.gradeMatrix(adminCtx, ['sec-a']); } catch (x) { e = x; }
  check(`export: a failed ${failing} read stops the export with an error (no blank file)`, e instanceof R.ReadFailed && /unavailable/.test(e.message), e?.message);
}
ANSWER = { 'assignment_offerings.select': { data: COLS, error: null }, 'enrollments.select': { data: ENR, error: null },
           'grades.select': { data: [{ enrollment_id: 'enr-X', assignment_offering_id: 'off-1', points_earned: 2, is_finalized: true }], error: null } };
const m = await A.gradeMatrix(adminCtx, ['sec-a']);
check('export: when every read works the matrix is as before', m.students.length === 1 && m.cell('enr-X', 'off-1') === 2);

const bk = { courseTitleOf: () => 'Course', currentTermLabel: 'Term', currentOffering: 'co-1' };
for (const failing of ['assignment_offerings', 'enrollments', 'submissions', 'grades']) {
  ANSWER = { 'assignment_offerings.select': { data: COLS, error: null }, 'enrollments.select': { data: ENR, error: null },
             'submissions.select': { data: [], error: null }, 'grades.select': { data: [], error: null } };
  ANSWER[`${failing}.select`] = { data: null, error: { message: `${failing} unavailable` } };
  let e = null; try { await A.buildBackup(bk, ['sec-a']); } catch (x) { e = x; }
  check(`backup: a failed ${failing} read stops the backup with an error (no partial file that looks whole)`,
        e instanceof R.ReadFailed && /unavailable/.test(e.message), e?.message);
}
ANSWER = { 'assignment_offerings.select': { data: COLS, error: null }, 'enrollments.select': { data: ENR, error: null },
           'submissions.select': { data: [], error: null }, 'grades.select': { data: [], error: null } };
const bkOk = await A.buildBackup(bk, ['sec-a']);
check('backup: when every read works it is as before', bkOk.enrollments.length === 1 && Array.isArray(bkOk.grades));

summary();
