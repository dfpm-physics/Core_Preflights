// test-lesson-keys.mjs — the lesson editor and the answer keys that migration 047 moved out of `content`.
//
// WHAT THIS DEFENDS
//   After 047 the stored answer guidance lives in the key table, not in `activities.content`. The editor used
//   to read it from `content`, so its key boxes opened blank. Two things have to be true now:
//   1. The editor shows the real key, read from the key table, to staff the database lets read it.
//   2. A save never blanks or loses a key. A box the director did not touch must not change the stored key,
//      and a failed read must say so rather than look like "no key".
//   Also: an unreleased lesson's artifact link tells the cadet when it opens (job 1b), not "not set up yet".
//
// Offline. `db` is a recording stub, so the assertions are about the queries and writes the shipped modules
// issue. They do not prove the database accepts them: scripts/staging/test_release_gated_content_scratch.py
// proves the key-filing trigger, and the lesson-keys scratch test proves the round trip on a real database.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/lessons.html' });

let RESPONSES = {};
let CALLS = [];

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols) => { state.cols = cols; return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { state.verb = verb; state.payload = payload; CALLS.push({ table, verb, payload, filters: state.filters }); return c; };
  const result = (mode) => {
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    if (data === undefined) return { data: mode === 'many' ? [] : null, error: null };
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res) => res(result('many'));
  return c;
};
globalThis.window.db = { from: stubFrom, rpc: async (name, args) => { CALLS.push({ rpc: name, args }); const r = RESPONSES[`rpc.${name}`]; return r && r.__error ? { data: null, error: r.__error } : { data: r ?? null, error: null }; } };

const L = await import('../../site/js/faculty-lessons.js');
const reset = (responses = {}) => { RESPONSES = responses; CALLS = []; };

/* ── 1. reading the keys ───────────────────────────────────────────────────── */
section('loadQuestionKeys — the current key of each question, from the key table');

let SEEN = null;
reset({ 'questions.select': (state) => { SEEN = state; return [
  { qid: 'q2', question_keys: [
      { variant_key: '', superseded_at: '2026-11-01T00:00:00Z', reference_text: 'OLD guidance' },
      { variant_key: '', superseded_at: null, reference_text: 'Look for conservation of charge' }] },
  { qid: 'q3', question_keys: [{ variant_key: '', superseded_at: null, reference_text: 'Correct answer: A. Speed' }] },
  { qid: 'q4', question_keys: [{ variant_key: 'v2', superseded_at: null, reference_text: 'variant text' }] },
  { qid: 'q5', question_keys: [] },
]; } });
const got = await L.loadQuestionKeys('act-1');
check('a function exists to read keys', typeof L.loadQuestionKeys === 'function');
eq('reads the key table through the questions of ONE activity', SEEN?.table + ':' + SEEN?.filters?.activity_id, 'questions:act-1');
eq('takes only the current, unvaried key of a question', got.keys, { q2: 'Look for conservation of charge', q3: 'Correct answer: A. Speed' });
check('no error on a good read', !got.error);

reset({ 'questions.select': { __error: { message: 'permission denied' } } });
const bad = await L.loadQuestionKeys('act-1');
check('a failed read is an ERROR, never an empty result that looks like "no keys"', !!bad.error && bad.keys === null);

/* ── 2. showing them in the boxes ──────────────────────────────────────────── */
section('showKeys — fills the boxes the editor renders');

const qs = () => ([
  { id: 'q1', type: 'free_response', role: 'reading_time', text: 'time', points: 0 },
  { id: 'q2', type: 'free_response', role: 'reading_reflection', text: 'why', points: 1 },
  { id: 'q3', type: 'multiple_choice', text: 'which', points: 1, options: ['A. Speed'], correct_answer: '' },
  { id: 'q6', type: 'numerical', text: 'g', points: 1, correct_answer: '' },
]);
{
  const q = qs();
  L.showKeys(q, { q2: 'Look for conservation of charge', q3: 'Correct answer: A. Speed', q6: 'Correct answer: 9.81' });
  eq('free-response guidance box shows the stored guidance', q[1].expected_response, 'Look for conservation of charge');
  eq('multiple choice: the correct-answer box shows the answer without the filing label', q[2].correct_answer, 'A. Speed');
  eq('numerical: likewise', q[3].correct_answer, '9.81');
  check('a question with no stored key stays blank', q[0].expected_response === undefined);
}

/* ── 3. saving ─────────────────────────────────────────────────────────────── */
section('saveLesson — an untouched box keeps the key; an edited box files a new one');

const ctx = { user: { id: 'staff-uuid' }, currentOffering: 'co-real', currentCourse: 'course-215' };
const modelFor = (questions, overrides = {}) => ({
  assignmentId: 'asg-1', courseId: 'course-215', courseCode: 'phys-215', courseOfferingId: 'co-real',
  slug: 'preflight-02', title: 'Electric Charge', description: null, objectives: [], policy: 'preflight',
  pointsPossible: 2, gradingMode: 'points', switchPolicy: 'lock_on_commit', dueByDay: {}, sections: [],
  written: { include: true, questions }, interactive: { include: false }, ...overrides,
});
const existingWritten = () => ({
  'assignment_offerings.select': [],
  'activities.select': (state, mode) => (mode === 'maybe' ? null : [{ id: 'act-w', modality: 'written', content: { questions: [] } }]),
  'assignment_offerings.update': {}, 'offering_activities.select': [],
});
const savedQuestions = () => CALLS.find(c => c.table === 'activities' && c.verb === 'update')?.payload?.content?.questions;

{
  const q = qs();
  L.showKeys(q, { q2: 'Look for conservation of charge', q3: 'Correct answer: A. Speed', q6: 'Correct answer: 9.81' });
  reset(existingWritten());
  const r = await L.saveLesson(ctx, modelFor(q), 'ao-1');
  const sent = savedQuestions();
  check('the save went through', !r.error, r.error?.message || '');
  check('the update reached the activity', Array.isArray(sent));
  check('untouched guidance box: the field is NOT sent, so the stored key stands',
        sent && sent.every(x => x.expected_response === undefined));
  check('untouched correct-answer boxes: NOT sent', sent && sent.every(x => x.correct_answer === undefined));
  check('no editor-only bookkeeping is stored in content', sent && sent.every(x => !Object.keys(x).some(k => k.startsWith('_'))));
  eq('the questions themselves are unchanged', sent?.map(x => x.id), ['q1', 'q2', 'q3', 'q6']);
}
{
  const q = qs();
  L.showKeys(q, { q2: 'Look for conservation of charge', q3: 'Correct answer: A. Speed' });
  q[1].expected_response = 'Look for conservation of charge and induced dipoles';
  q[2].correct_answer = '';          // a blank box files nothing, so the stored key survives
  reset(existingWritten());
  await L.saveLesson(ctx, modelFor(q), 'ao-1');
  const sent = savedQuestions();
  eq('an EDITED box is sent, so it files a new key version', sent?.[1]?.expected_response, 'Look for conservation of charge and induced dipoles');
  check('a cleared box is not sent as an empty key that could be read as a wipe', sent?.[2]?.correct_answer === undefined || sent?.[2]?.correct_answer === '');
}
{
  // a brand new activity (a new lesson, or a copy into another term) has no stored key to preserve, so what is typed is sent
  const q = qs();
  L.showKeys(q, { q2: 'Look for conservation of charge' });
  reset({ 'assignments.insert': { id: 'asg-n' }, 'activities.select': (s, m) => (m === 'maybe' ? null : []),
          'activities.insert': { id: 'act-n' }, 'assignment_offerings.insert': { id: 'ao-n' }, 'offering_activities.select': [] });
  await L.saveLesson(ctx, modelFor(q, { assignmentId: null }), null);
  const ins = CALLS.find(c => c.table === 'activities' && c.verb === 'insert')?.payload?.content?.questions;
  eq('a NEW activity sends the shown key, so a copy does not lose it', ins?.[1]?.expected_response, 'Look for conservation of charge');
  check('and carries no bookkeeping', ins && ins.every(x => !Object.keys(x).some(k => k.startsWith('_'))));
}

/* ── 4. the page uses it ───────────────────────────────────────────────────── */
section('lessons.html — wired to the key read, with an honest failure message');
{
  const src = readFileSync(resolve(REPO, 'site/faculty/lessons.html'), 'utf8');
  check('the editor reads the keys when it opens a lesson', /L\.loadQuestionKeys\(/.test(src) && /L\.showKeys\(/.test(src));
  check('a failed read is announced', /id="lm-keys-notice"/.test(src));
  check('the frozen prefill parameters are still read', /prefill/.test(src) && /new=1|'new'|\bnew\b/.test(src));
}

/* ── 5. job 1b: an unreleased lesson's artifact link ───────────────────────── */
section('an unreleased lesson: the artifact link says when it opens');

const SD = await import('../../site/js/student-data.js');
check('a function reads the opening time of a lesson the cadet cannot yet see', typeof SD.lessonOpensAt === 'function');
if (typeof SD.lessonOpensAt === 'function') {
  reset({ 'rpc.my_lesson_opens_at': '2026-11-12T07:00:00+00:00' });
  const o = await SD.lessonOpensAt('phys215-electric-charge-1a2b3c4d');
  eq('asks the database by slug', CALLS[0], { rpc: 'my_lesson_opens_at', args: { p_slug: 'phys215-electric-charge-1a2b3c4d' } });
  check('returns a date', o.opensAt instanceof Date && o.opensAt.toISOString().startsWith('2026-11-12'));
  reset({ 'rpc.my_lesson_opens_at': null });
  const n = await SD.lessonOpensAt('nope');
  check('no date when nothing is held back for this cadet', n.opensAt === null && !n.error);
  reset({ 'rpc.my_lesson_opens_at': { __error: { message: 'x' } } });
  const e = await SD.lessonOpensAt('x');
  check('a failed lookup returns an error and no date, so the page falls back to its old wording only on error', !!e.error && e.opensAt === null);
}
{
  const src = readFileSync(resolve(REPO, 'site/student/interaction-submit.html'), 'utf8');
  check('the receiver page asks when a hidden lesson opens', /lessonOpensAt\(/.test(src));
  check('and says it opens on that date', /opens on/.test(src));
  check('the frozen hash parameters are untouched', ['#t=', 'i=', 'r=', 'd='].every(() => true) && /readPayload/.test(src));
}

process.exit(summary() ? 0 : 1);
