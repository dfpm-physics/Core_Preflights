// test-grade-page-logic.mjs — the grading page's save path: what rows it builds, which it withholds, and when it refuses.
//
// Covers the page logic added with the stale-save check and the rescore guard (commit 18a200a) that test-grade-safety.mjs
// does not reach: the exact rows a draft save and a finalize put on the wire, and the version rule's edge cases.
//
//   P1  an untouched card re-sends the grader and the time it was read with; an edited card sends the signed-in user
//   P2  a published card is never sent, and a held-back card is not re-sent unless it was edited
//   P3  a finalize sends is_finalized for what it sends, a draft save sends false
//   P4  the version rule: every way a held grade can differ from the stored one, and the cases that are current
//   P5  the grade is never sent with a grader the signed-in user did not choose (no client-chosen third party)
//
// WHAT THIS CANNOT PROVE
//   It reads the rows the shipped module builds with a recording stub as window.db. It does not show what the database
//   does with them: that an untouched card keeps its first grader through the upsert is decided by migration 049 and is
//   proved by scripts/staging/test_grade_audit_scratch.py, on a real upsert. Two live sessions racing are not shown.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });

let CALLS = [];
let GRADES_NOW = [];
const stubFrom = (table) => {
  const call = { table, verb: 'select', payload: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'select', 'range'])
    c[m] = () => c;
  c.maybeSingle = () => { call.single = true; return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete']) c[verb] = (payload) => { call.verb = verb; call.payload = payload; return c; };
  c.then = (res) => {
    CALLS.push(call);
    if (call.verb === 'select') return res({ data: table === 'grades' ? GRADES_NOW : [], error: null });
    return res({ data: Array.isArray(call.payload) ? call.payload.map((_, i) => ({ id: `row-${i}` })) : null, error: null });
  };
  return c;
};
globalThis.window.db = { from: stubFrom };

const G = await import('../../site/js/faculty-grade.js');
const sent = () => CALLS.filter(c => c.table === 'grades' && c.verb === 'upsert').flatMap(c => c.payload);

const ME = 'instr-b';             // the signed-in user
const COLLEAGUE = 'instr-a';      // who graded the draft before
const ctx = { user: { id: ME } };
const OFFERING = {
  offeringId: 'off-1', slug: 'lesson-07', pointsPossible: 2,
  written: { id: 'act-w', content: { questions: [
    { id: 'q2', text: 'Reflection', points: 1 }, { id: 'q3', text: 'Free response', points: 1 }] } },
};
const STUDENTS = [
  { student_id: 5001, name: 'Xavier Invented', enrollment_id: 'enr-X', section_id: 'sec-a' },
  { student_id: 5002, name: 'Yara Invented',   enrollment_id: 'enr-Y', section_id: 'sec-a' },
  { student_id: 5003, name: 'Zed Invented',    enrollment_id: 'enr-Z', section_id: 'sec-a' },
];
const full = { score: 1, max: 1, feedback: '', status: 'full' };
const draft = (id, extra = {}) => ({ gradeId: id, qs: { q2: { ...full }, q3: { ...full } }, finalized: false, source: 'ai_suggested',
  pointsEarned: 2, updatedAt: 'v1', gradedBy: COLLEAGUE, gradedAt: '2026-11-01T12:00:00.000Z', ...extra });
const submissionMap = Object.fromEntries(STUDENTS.map(s => [s.student_id, { chosenActivityId: 'act-w' }]));
const dataFor = (gradeMap, edit = []) => {
  const gd = G.buildGradeData(OFFERING, STUDENTS, { 5001: {}, 5002: {}, 5003: {} }, gradeMap, submissionMap, new Set());
  for (const sid of edit) { gd[sid].q3.score = 0; gd[sid].q3.status = 'zero'; gd[sid].q3.modified = true; }
  return gd;
};
const currentFor = (gradeMap) => Object.values(gradeMap).map(g => ({ id: g.gradeId, enrollment_id: STUDENTS.find(s => gradeMap[s.student_id] === g).enrollment_id, updated_at: g.updatedAt }));

/* ── P1 ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('P1 — who and when each row is sent with');
{
  const LOADED = { 5001: draft('g-X'), 5002: draft('g-Y') };
  CALLS = []; GRADES_NOW = currentFor(LOADED);
  const res = await G.finalizeScores(ctx, OFFERING, STUDENTS, dataFor(LOADED, [5002]), LOADED, {});
  check('the finalize goes through', !res.error, res.error?.message);
  const byEnr = Object.fromEntries(sent().map(r => [r.enrollment_id, r]));
  eq('an untouched card re-sends the earlier grader (provenance is not stamped over)', byEnr['enr-X']?.graded_by, COLLEAGUE);
  eq('…and the time it was graded', byEnr['enr-X']?.graded_at, '2026-11-01T12:00:00.000Z');
  eq('…and keeps its source', byEnr['enr-X']?.source, 'ai_suggested');
  eq('an edited card sends the signed-in user as grader', byEnr['enr-Y']?.graded_by, ME);
  eq('…and is marked as the instructor\'s', byEnr['enr-Y']?.source, 'instructor');
  check('no row names a grader who is neither the earlier grader nor the signed-in user',
        sent().every(r => [COLLEAGUE, ME].includes(r.graded_by)), JSON.stringify(sent().map(r => r.graded_by)));
}

/* ── P2 ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('P2 — what is not sent');
{
  const LOADED = { 5001: draft('g-X', { finalized: true }), 5002: draft('g-Y') };
  CALLS = []; GRADES_NOW = currentFor(LOADED);
  await G.saveScores(ctx, OFFERING, STUDENTS, dataFor(LOADED, [5001, 5002]), LOADED, {});
  const enrs = sent().map(r => r.enrollment_id);
  check('a published card is never sent, even when edited on screen', !enrs.includes('enr-X'), enrs.join());
  check('an edited, unpublished card is', enrs.includes('enr-Y'));
  check('a cadet with no grade and no edit is not sent', !enrs.includes('enr-Z'));

  const held = { 5002: draft('g-Y') };
  CALLS = []; GRADES_NOW = currentFor(held);
  await G.saveScores(ctx, OFFERING, STUDENTS, dataFor(held), held, {}, { skipIds: new Set([5002]) });
  check('a held-back card nobody edited is not re-sent', sent().length === 0, JSON.stringify(sent().map(r => r.enrollment_id)));
  CALLS = []; GRADES_NOW = currentFor(held);
  await G.saveScores(ctx, OFFERING, STUDENTS, dataFor(held, [5002]), held, {}, { skipIds: new Set([5002]) });
  check('a held-back card that was edited is', sent().length === 1);
}

/* ── P3 ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('P3 — draft or published');
{
  const LOADED = { 5002: draft('g-Y') };
  CALLS = []; GRADES_NOW = currentFor(LOADED);
  await G.saveScores(ctx, OFFERING, STUDENTS, dataFor(LOADED, [5002]), LOADED, {});
  check('a draft save sends is_finalized false', sent().length === 1 && sent().every(r => r.is_finalized === false));
  CALLS = []; GRADES_NOW = currentFor(LOADED);
  await G.finalizeScores(ctx, OFFERING, STUDENTS, dataFor(LOADED, [5002]), LOADED, {});
  check('a finalize sends is_finalized true', sent().length === 1 && sent().every(r => r.is_finalized === true));
  eq('a row\'s points never exceed the offering\'s value', Math.max(...sent().map(r => r.points_earned)), 1);
}

/* ── P4 ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('P4 — the version rule');
const rows = (...ids) => ids.map(enrollment_id => ({ enrollment_id }));
const held = (v, id = 'g') => ({ gradeId: id, updatedAt: v });
eq('same version: current', G.staleEnrollments(rows('e'), { e: { updated_at: 'v1' } }, { e: held('v1') }), []);
eq('different version: stale', G.staleEnrollments(rows('e'), { e: { updated_at: 'v2' } }, { e: held('v1') }), ['e']);
eq('held a grade, now gone: stale', G.staleEnrollments(rows('e'), {}, { e: held('v1') }), ['e']);
eq('held no grade, one exists now: stale', G.staleEnrollments(rows('e'), { e: { updated_at: 'v1' } }, {}), ['e']);
eq('held no grade and none exists: current (a new grade)', G.staleEnrollments(rows('e'), {}, {}), []);
eq('held a grade with no version: stale (cannot be shown current)', G.staleEnrollments(rows('e'), { e: { updated_at: 'v1' } }, { e: { gradeId: 'g' } }), ['e']);
eq('only the changed rows are named', G.staleEnrollments(rows('a', 'b', 'c'),
  { a: { updated_at: '1' }, b: { updated_at: '9' }, c: { updated_at: '1' } }, { a: held('1'), b: held('2'), c: held('1') }), ['b']);
eq('no rows: nothing to refuse', G.staleEnrollments([], { e: { updated_at: 'v2' } }, { e: held('v1') }), []);
{
  // A retry after the page's own write must not be refused as a colleague's; a colleague's later write still is.
  const studs = [{ enrollment_id: 'e', student_id: 5002 }];
  const gm = { 5002: { gradeId: 'g', updatedAt: 'v1', qs: {} } };
  G.applyOwnWrites(studs, gm, [{ enrollment_id: 'e' }], [{ id: 'g', enrollment_id: 'e', updated_at: 'v2' }], false);
  eq('the page takes the version its own write produced', gm[5002].updatedAt, 'v2');
  eq('so a retry after a half-finished save is current', G.staleEnrollments(rows('e'), { e: { updated_at: 'v2' } }, { e: gm[5002] }), []);
  eq('and a colleague writing after that is still refused', G.staleEnrollments(rows('e'), { e: { updated_at: 'v3' } }, { e: gm[5002] }), ['e']);
  const gm2 = {};
  G.applyOwnWrites(studs, gm2, [{ enrollment_id: 'e', question_scores: { q1: { score: 1 } } }], [{ id: 'g2', enrollment_id: 'e', updated_at: 'w1' }], true);
  eq('a grade this page created is held with its id and version', [gm2[5002].gradeId, gm2[5002].updatedAt, gm2[5002].finalized], ['g2', 'w1', true]);
  eq('so the retry sees it as its own', G.staleEnrollments(rows('e'), { e: { updated_at: 'w1' } }, { e: gm2[5002] }), []);
  const gm3 = { 5002: { gradeId: 'g', updatedAt: 'v1' } };
  G.applyOwnWrites(studs, gm3, [{ enrollment_id: 'e' }], [{ id: 'g', enrollment_id: 'e' }], false);
  eq('a response with no version changes nothing (the safe direction)', gm3[5002].updatedAt, 'v1');
}

/* ── P5 ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
section('P5 — a card with no earlier grader');
{
  const LOADED = { 5002: draft('g-Y', { gradedBy: null, gradedAt: null }) };
  CALLS = []; GRADES_NOW = currentFor(LOADED);
  await G.finalizeScores(ctx, OFFERING, STUDENTS, dataFor(LOADED), LOADED, {});
  const r = sent().find(x => x.enrollment_id === 'enr-Y');
  eq('an untouched suggestion nobody graded is attributed to the person who published it', r?.graded_by, ME);
}

summary();
