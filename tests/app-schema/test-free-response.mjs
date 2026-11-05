// test-free-response.mjs — the free-response question editor for the Assignments page
// (site/js/free-response.js, and its use in site/js/faculty-items.js).
//
// WHAT THIS DEFENDS
//   * What the new editor stores is what the older editor stores for the same input: the question set is run through
//     BOTH writers (saveLesson in faculty-lessons.js, and createItem here) with a recording stub, and the activity
//     content they would write is compared.
//   * The grader's guidance never rides in a save when the person did not touch it (a stored key stays as it is), and a
//     new activity does carry what the boxes hold.
//   * The two pinned questions are stamped with roles, ordered first, and unpinning never destroys authored text.
//   * The standard wording of the pinned questions equals the older page's own text.
//   * The AI-drafted option writes (typed_response, ai_drafted) with warn_earns_full true, and never publishes.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db: it shows what the shipped modules would send, not that the database
//   accepts it or that the key-filing trigger (migration 047) files the guidance. A session on staging does that.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/items.html' });

let RESPONSES = {};
let CALLS = [];
let QUERIES = [];
let SEQ = 0;

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null, opts: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'range'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols, opts) => { state.cols = cols; state.opts = opts || null; return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { state.verb = verb; state.payload = payload; CALLS.push({ table, verb, payload, filters: state.filters }); return c; };
  const result = (mode) => {
    if (state.verb === 'select') QUERIES.push({ table, cols: state.cols, filters: state.filters });
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    if (data === undefined) {
      if (state.verb === 'insert' && mode !== 'many') return { data: { id: `${table}-${++SEQ}` }, error: null };
      if ((state.verb === 'update' || state.verb === 'delete') && state.cols !== null && mode === 'many') return { data: [{ id: 'row-1' }], error: null, count: 1 };
      return { data: mode === 'many' ? [] : null, error: null, count: 0 };
    }
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};

globalThis.window.db = { from: stubFrom };
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const F = await import('../../site/js/free-response.js');
const I = await import('../../site/js/faculty-items.js');
const L = await import('../../site/js/faculty-lessons.js');
const db = window.db;
const reset = (r = {}) => { RESPONSES = r; CALLS = []; QUERIES = []; SEQ = 0; };
const writesTo = (table, verb) => CALLS.filter(c => c.table === table && (!verb || c.verb === verb));
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the standard wording equals the older page\'s own text');
{
  const page = read('site/faculty/lessons.html');
  const unwrap = (s) => s.replace(/\\'/g, "'");
  for (const [name, value] of [['READING_REFLECTION_TEXT', F.READING_REFLECTION_TEXT], ['READING_TIME_TEXT', F.READING_TIME_TEXT]]) {
    const m = new RegExp(`const ${name} = '((?:[^'\\\\]|\\\\.)*)'`).exec(page);
    check(`${name} is in the older page`, !!m);
    eq(`${name} is the same string`, value, m ? unwrap(m[1]) : null);
  }
  const note = /const READING_TIME_NOTE =\s*'((?:[^'\\]|\\.)*)'/.exec(page);
  eq('READING_TIME_NOTE is the same string', F.READING_TIME_NOTE, note ? unwrap(note[1]) : null);
  const g = /const READING_REFLECTION_GUIDANCE =\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+);/.exec(page);
  const joined = g ? [...g[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => unwrap(x[1])).join('') : null;
  eq('READING_REFLECTION_GUIDANCE is the same string', F.READING_REFLECTION_GUIDANCE, joined);
}

section('a new editor: both pinned questions, roles stamped, in order');
{
  const e = F.emptyEditor();
  eq('two questions', e.questions.length, 2);
  eq('reading time first, reflection second', e.questions.map(q => q.role), ['reading_time', 'reading_reflection']);
  eq('their ids', e.questions.map(q => q.id), ['q1', 'q2']);
  eq('reading time is worth 0, the reflection 1', e.questions.map(q => q.points), [0, 1]);
  check('the reflection carries the grader\'s guidance', e.questions[1].expected_response === F.READING_REFLECTION_GUIDANCE);
  eq('the pinned toggles read both on', F.pinnedState(e), { reading_time: true, reading_reflection: true });
  eq('a new ordinary question is a declared free response with the next id', F.newQuestion('free_response', e.questions).role, 'free_response');
  eq('... and id q3', F.newQuestion('free_response', e.questions).id, 'q3');
  eq('a numerical question starts with a 5 percent tolerance', F.newQuestion('numerical', []).tolerance, 0.05);
  eq('a multiple-choice question starts with four options', F.newQuestion('multiple_choice', []).options.length, 4);
  eq('an unknown type becomes a free response', F.newQuestion('essay', []).type, 'free_response');
}

section('the content written equals what the older editor writes for the same input');
{
  const e = F.emptyEditor();
  e.reference_pdf = 'Text_Book_PDFs/215 Sections/Some Section.pdf';
  e.reference_pages = '170-179';
  e.reading_link = 'https://example.org/reading';
  e.questions.push({ ...F.newQuestion('free_response', e.questions), text: 'Explain why the force is attractive.', points: 1,
    expected_response: 'Look for polarisation of the conductor.' });
  e.questions.push({ ...F.newQuestion('numerical', e.questions), text: 'How large is g?', points: 1, correct_answer: '9.81', tolerance: 0.02 });
  e.questions.push({ ...F.newQuestion('multiple_choice', e.questions), text: 'Which is a vector?', points: 1,
    options: ['A. Speed', 'B. Velocity', 'C. Mass', 'D. Time'], correct_answer: 'B. Velocity' });
  e.questions[e.questions.length - 1].figure_url = 'https://example.org/fig.png';

  // The older writer, as saveLesson runs it for a new lesson.
  reset();
  const model = {
    courseId: 'course-1', courseCode: 'phys-215', courseOfferingId: 'co-1', slug: 'aid-1', title: 'T', description: null,
    policy: 'preflight', pointsPossible: 2, dueByDay: {}, sections: [], isPublished: false, lessonNumber: null,
    written: { include: true, questions: structuredClone(e.questions), reference_pdf: e.reference_pdf,
               reference_pages: e.reference_pages, reading_link: e.reading_link },
    interactive: { include: false },
  };
  const out = await L.saveLesson({ currentOffering: 'co-1' }, model, null);
  eq('the older writer ran without an error', out.error, null);
  const legacy = writesTo('activities', 'insert').find(c => c.payload.modality === 'written').payload.content;

  // The new writer.
  reset();
  const ctx = { courseId: 'course-1', courseCode: 'phys-215', courseOfferingId: 'co-1', sections: [] };
  const form = { kindId: 'preflight', title: 'T', description: '', delivery: 'typed_response', grading: 'ai_drafted', points: '2',
    lateAllowed: true, isBonus: false, progIncluded: false, allDate: '', dayDates: {}, sameDate: false, time: '23:59',
    sectionDates: {}, freeResponse: structuredClone(e) };
  const res = await I.createItem(db, ctx, form);
  eq('createItem ran without an error', res.error, null);
  const mine = writesTo('activities', 'insert')[0].payload;
  eq('the new activity is a written one', mine.modality, 'written');
  eq('the content is byte for byte the older editor\'s', JSON.stringify(mine.content), JSON.stringify(legacy));
  eq('and so is its parsed form (key order aside)', mine.content, legacy);
  check('every question carries a role', mine.content.questions.every(q => typeof q.role === 'string' && q.role));
  eq('the access value is open', mine.content.access, 'open');
  eq('the reference file and pages are kept', [mine.content.reference_pdf, mine.content.reference_pages], [e.reference_pdf, e.reference_pages]);

  const oa = writesTo('offering_activities', 'insert')[0].payload;
  eq('the path is typed_response graded ai_drafted', [oa.delivery, oa.grading], ['typed_response', 'ai_drafted']);
  eq('a yellow mark earns full credit', oa.warn_earns_full, true);
  eq('it is the graded path', oa.grading_role, 'graded');
  const off = writesTo('assignment_offerings', 'insert')[0].payload;
  eq('the item is not published', off.is_published, false);
  eq('the item carries the page marker', off.entered_on_new_page, true);
  eq('the points are the ones typed', off.points_possible, 2);
}

section('a human-graded typed response and a tutor write the flag the grader needs, and nothing else changes');
{
  reset();
  const ctx = { courseId: 'course-1', courseCode: 'phys-215', courseOfferingId: 'co-1', sections: [] };
  const base = { kindId: 'preflight', title: 'T2', description: '', points: '2', lateAllowed: true, isBonus: false, progIncluded: false,
    allDate: '', dayDates: {}, sameDate: false, time: '23:59', sectionDates: {}, interactiveSlug: 'lesson-02', interactiveUrl: '' };
  await I.createItem(db, ctx, { ...base, delivery: 'typed_response', grading: 'human_graded', freeResponse: F.emptyEditor() });
  eq('human_graded typed response: warn_earns_full true', writesTo('offering_activities', 'insert')[0].payload.warn_earns_full, true);
  reset();
  await I.createItem(db, ctx, { ...base, delivery: 'interactive_tutor', grading: 'effort' });
  eq('a tutor: warn_earns_full false', writesTo('offering_activities', 'insert')[0].payload.warn_earns_full, false);
  eq('a tutor: content has its link and no questions', Object.keys(writesTo('activities', 'insert')[0].payload.content).sort(), ['artifact_url', 'description']);
  reset();
  await I.createItem(db, ctx, { ...base, delivery: 'in_person', grading: 'hand_entered' });
  eq('an in-person path: empty content', writesTo('activities', 'insert')[0].payload.content, {});
}

section('stored guidance is not sent unless the person changed it');
{
  const content = { questions: [
    { id: 'q1', role: 'reading_time', type: 'free_response', text: F.READING_TIME_TEXT, points: 0 },
    { id: 'q2', role: 'reading_reflection', type: 'free_response', text: F.READING_REFLECTION_TEXT, points: 1 },
    { id: 'q3', role: 'free_response', type: 'free_response', text: 'Why?', points: 1 },
    { id: 'q4', role: 'free_response', type: 'multiple_choice', text: 'Which?', points: 1, options: ['A. x', 'B. y'] },
  ], reference_pdf: 'Text_Book_PDFs/x.pdf' };
  const keys = { q2: 'Judge meaning.', q3: 'Mention polarisation.', q4: 'Correct answer: B. y' };
  const e = F.editorFromContent(content, keys);
  eq('the box shows the stored guidance', e.questions.find(q => q.id === 'q3').expected_response, 'Mention polarisation.');
  eq('a multiple-choice box shows the answer without the label', e.questions.find(q => q.id === 'q4').correct_answer, 'B. y');
  let out = F.contentFromEditor(e, { keepKeys: false });
  check('an untouched guidance box is left out of an update',
    out.questions.every(q => !('expected_response' in q) && !('correct_answer' in q)), JSON.stringify(out.questions));
  e.questions.find(q => q.id === 'q3').expected_response = 'Mention polarisation and the near face.';
  out = F.contentFromEditor(e, { keepKeys: false });
  eq('an edited box is sent', out.questions.find(q => q.id === 'q3').expected_response, 'Mention polarisation and the near face.');
  check('... and the private marker never leaves the page', out.questions.every(q => !('_keyShown' in q)));
  out = F.contentFromEditor(e, { keepKeys: true });
  check('a NEW activity sends what the boxes hold', out.questions.find(q => q.id === 'q2').expected_response === 'Judge meaning.');
  const blank = F.editorFromContent(content, null);
  out = F.contentFromEditor(blank, { keepKeys: false });
  check('keys that could not be read leave every box blank and send nothing', out.questions.every(q => !String(q.expected_response || '').trim()));
}

section('the pinned toggles');
{
  const e = F.emptyEditor();
  eq('turning the reflection off while it is the standard text removes it', F.pinOff(e, 'reading_reflection'), 'removed');
  eq('... leaving only reading time', e.questions.map(q => q.role), ['reading_time']);
  eq('turning it off again says it is absent', F.pinOff(e, 'reading_reflection'), 'absent');
  eq('turning it on adds the standard one back, second', (F.pinOn(e, 'reading_reflection'), e.questions.map(q => q.role)), ['reading_time', 'reading_reflection']);
  eq('turning it on twice adds nothing', F.pinOn(e, 'reading_reflection'), 'present');
  e.questions[1].text = 'My own reflection prompt.';
  eq('a rewritten pinned question is kept when unpinned', F.pinOff(e, 'reading_reflection'), 'kept');
  eq('... as an ordinary free response', e.questions[1].role, 'free_response');
  eq('unpinning reading time keeps a zero-point question worth something', (e.questions[0].text = 'Own time prompt', F.pinOff(e, 'reading_time'), e.questions[0].points), 1);
  const none = { questions: [F.newQuestion('free_response', [])], reading_link: '', reference_pdf: '', reference_pages: '', access: 'open' };
  check('a list with neither pinned question still declares its roles', F.contentFromEditor(none, { keepKeys: true }).questions.every(q => q.role === 'free_response'));
  const legacy = F.editorFromContent({ questions: [
    { id: 'q1', text: 'How much time did you spend reading the book in preparation for this lesson?', points: 0 },
    { id: 'q2', text: 'What did you find most confusing or most interesting about the reading? Be specific.', points: 1 },
    { id: 'q3', text: 'Explain.', points: 1 }] }, null);
  eq('an older list with no roles has them adopted by wording', legacy.questions.map(q => q.role), ['reading_time', 'reading_reflection', 'free_response']);
}

section('checks on the question set');
{
  const ok = F.emptyEditor();
  eq('the standard pair passes', F.checkEditor(ok), []);
  eq('no questions is refused', F.checkEditor({ questions: [] }).length, 1);
  const bad = F.emptyEditor();
  bad.questions.push({ ...F.newQuestion('free_response', bad.questions), text: '', points: -1 });
  bad.questions.push({ ...F.newQuestion('numerical', bad.questions), text: 'n', correct_answer: 'abc', tolerance: 3 });
  bad.questions.push({ ...F.newQuestion('multiple_choice', bad.questions), text: 'm', options: ['A. ', 'B. '], correct_answer: '' });
  const problems = F.checkEditor(bad);
  check('a blank question text is named', problems.some(p => /Question 3 needs its text/.test(p)), problems);
  check('negative points are named', problems.some(p => /Question 3 needs points/.test(p)));
  check('a non-number answer is named', problems.some(p => /Question 4 needs a number/.test(p)));
  check('a tolerance out of range is named', problems.some(p => /Question 4 needs a tolerance/.test(p)));
  check('a multiple-choice question with empty options is named', problems.some(p => /Question 5 needs at least two/.test(p)));
  check('a missing correct choice is named', problems.some(p => /Question 5 needs its correct answer/.test(p)));
  const link = F.emptyEditor(); link.reading_link = 'ftp://x';
  check('a reading link must be http or https', F.checkEditor(link).some(p => /reading link/.test(p)));
  const ungraded = F.emptyEditor(); ungraded.questions.push({ ...F.newQuestion('free_response', ungraded.questions), text: 'q', points: 1 });
  eq('a graded free response with no guidance is reported', F.missingGuidance(ungraded).length, 1);
  eq('the reading-time question needs no guidance', F.missingGuidance(F.emptyEditor()).length, 0);
  eq('the total of the question points', F.questionPoints(F.emptyEditor()), 1);
  eq('the manifest text parses to paths and skips comments', F.parseRagManifest('# c\nA/b.pdf\n\n C/d.pdf \n'), ['A/b.pdf', 'C/d.pdf']);
  eq('a reference label is the file name without its extension', F.ragLabel('Text_Book_PDFs/215 Sections/Section 5.2.pdf'), 'Section 5.2');
}

section('checkForm carries the question-set problems for a typed response only');
{
  const kinds = [{ id: 'preflight', label: 'Preflight' }];
  const form = (over) => ({ kindId: 'preflight', title: 'T', description: '', delivery: 'typed_response', grading: 'ai_drafted', points: '2',
    allDate: '', dayDates: {}, sameDate: false, time: '23:59', sectionDates: {}, ...over });
  eq('a good typed response passes', I.checkForm(form({ freeResponse: F.emptyEditor() }), { kinds, sections: [] }), []);
  check('an empty question set is refused', I.checkForm(form({ freeResponse: { questions: [] } }), { kinds, sections: [] }).some(p => /at least one question/.test(p)));
  eq('a tutor ignores the question set', I.checkForm(form({ delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'a-b', freeResponse: { questions: [] } }), { kinds, sections: [] }), []);
  eq('a locked multi-path item ignores it too', I.checkForm(form({ freeResponse: { questions: [] } }), { kinds, sections: [], lockedPath: true }), []);
}

section('saving the questions of an existing item');
{
  const ctx = { courseId: 'course-1', courseCode: 'phys-215', courseOfferingId: 'co-1', sections: [] };
  const item = (over = {}) => ({ offeringId: 'o-1', assignmentId: 'a-1', slug: 'it', updatedAt: 'U1',
    paths: [{ delivery: 'typed_response', grading: 'human_graded', modality: 'written', activityId: 'act-1', slug: 's', content: over.content || { questions: [] } }] });
  const form = (over) => ({ kindId: 'preflight', title: 'T', description: '', delivery: 'typed_response', grading: 'human_graded', points: '2',
    lateAllowed: true, isBonus: false, progIncluded: false, allDate: '', dayDates: {}, sameDate: false, time: '23:59', sectionDates: {},
    freeResponse: F.emptyEditor(), ...over });
  const fresh = { id: 'o-1', updated_at: 'U1', entered_on_new_page: true };

  reset({ 'assignment_offerings.select': fresh });
  let r = await I.updateItem(db, ctx, item(), form({}));
  eq('saving questions succeeds', r.error, null);
  const up = writesTo('activities', 'update')[0];
  check('the activity content is replaced with the editor\'s', !!up && Array.isArray(up.payload.content.questions) && up.payload.content.questions.length === 2);
  eq('... on the right activity', up.filters.id, 'act-1');
  eq('no grade is rewritten when no question\'s points changed', QUERIES.filter(q => q.table === 'grades').length, 0);

  const prev = { questions: [{ id: 'q1', role: 'reading_time', points: 0 }, { id: 'q2', role: 'reading_reflection', points: 2 }] };
  reset({ 'assignment_offerings.select': fresh });
  r = await I.updateItem(db, ctx, item({ content: prev }), form({}));
  eq('a changed question point value still saves', r.error, null);
  check('... and the grades are read to be re-scored', QUERIES.some(q => q.table === 'grades'));
  eq('... reporting how many were rewritten', typeof r.rescored, 'number');

  reset({ 'assignment_offerings.select': fresh });
  r = await I.updateItem(db, ctx, item(), form({ grading: 'ai_drafted' }));
  eq('switching human_graded to ai_drafted saves', r.error, null);
  const pair = writesTo('offering_activities', 'update')[0].payload;
  eq('the pair changes in place and states the flag', pair, { delivery: 'typed_response', grading: 'ai_drafted', warn_earns_full: true });

  reset({ 'assignment_offerings.select': fresh });
  r = await I.updateItem(db, ctx, item(), form({ freeResponse: undefined }));
  eq('a form with no question set leaves the activity alone', writesTo('activities', 'update').length, 0);
}

if (!summary()) process.exit(1);
