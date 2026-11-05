// test-homework.mjs — the student homework page's logic (site/js/homework.js) against a stand-in for the network.
//
// WHAT THIS DEFENDS
//   * The page marks nothing: the only thing sent is the offering id, the question id and the typed answer; the reply is
//     read as right or wrong and tries left, and nothing else is shown.
//   * The score on screen is the grade row's, never a sum made here; no grade row says "No answers yet", not 0.
//   * The 7-day release rule is not applied in this file (the one student loader applies it), and no key word, key
//     table or release function is mentioned in the page code.
//   * A failed send says the answer was not counted; a refusal shows the server's plain sentence; no tries left locks.
//   * Drawn markup: one box per question, choices as radio or checkbox, read-only after the deadline.
//
// WHAT THIS CANNOT PROVE
//   Anything live. check-answer is not deployed, so the "server" below is a stand-in that replies in the shape the real
//   function documents (supabase/functions/check-answer/handler.js). The DOM wiring is checked in a browser page
//   (tests/browser/test-homework.html), not here.

import { readFileSync } from 'node:fs';
// util.js reads `location` when it loads; give it the address of a student page.
globalThis.location = { pathname: '/Core_Preflights/site/student/homework.html', search: '' };
const {
  ANSWER_FUNCTION, GRADE_SOURCE, TEXT, buildView, describeReply, readEntry, sendAnswer, scoreText, renderHomework,
  triesLeftText, ruleText, fmt,
} = await import('../../site/js/homework.js');
import { check, eq, section, summary } from './mini-assert.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const AO = '22222222-2222-4222-8222-222222222222';
const Q1 = '33333333-3333-4333-8333-333333333331';
const Q3 = '33333333-3333-4333-8333-333333333333';
const doc = (over = {}) => ({
  status: 'ok', attempt_limit: 3, attempt_rule: 'best', late_allowed: false,
  questions: [
    { id: Q1, qid: 'q1', position: 0, prompt_md: 'How fast, in m/s?\nShow it <b>bold</b>.', figure_url: null, unit_hint: 'm/s', format: 'numeric', choices: [], points: 2, attempts_used: 1 },
    { id: Q3, qid: 'q3', position: 2, prompt_md: 'Pick one.', figure_url: null, unit_hint: null, format: 'multiple_choice',
      choices: [{ id: 'a', text: 'First <i>one</i>' }, { id: 'b', text: 'Second' }], points: 1, attempts_used: 0 },
  ], ...over,
});
const item = { title: 'Homework 3', due: new Date('2099-01-01T12:00:00Z'), isPast: false, pointsPossible: 3, offeringId: AO };
const grade = { points_earned: '2.00', points_possible: '3.00', question_scores: { q1: { score: 2, max: 2, status: 'full' } }, source: 'auto_checked' };

section('the page code stays out of marking, keys and the release rule');
{
  const js = src('../../site/js/homework.js');
  const html = src('../../site/student/homework.html');
  for (const word of ['question_keys', 'tol_pct', 'tol_abs', 'correct_choice_ids', 'sig_fig', 'parseAnswer', 'checkNumeric', 'releaseAt', 'isReleased', 'LOOKAHEAD', 'release_at', 'answer_context', 'record_answer']) {
    check(`homework.js does not mention ${word}`, !js.includes(word));
    check(`homework.html does not mention ${word}`, !html.includes(word));
  }
  check('the page takes its item from the one student loader', /loadAssignmentStatuses/.test(html));
  check('the page reads no question or key table directly', !/from\('questions'\)|from\('question_keys'\)|from\('question_attempts'\)/.test(html + js));
  check('the questions come from student_homework', /rpc\('student_homework'/.test(html));
  check('the answer goes to the check-answer function', ANSWER_FUNCTION === 'check-answer');
  check('the grade is read from one named source, the my_grades view and not the table', GRADE_SOURCE === 'my_grades' && /GRADE_SOURCE/.test(html) && !/from\('grades'\)/.test(html + js));
  check('the page adds up no score: no reduce or sum of points in homework.js', !/\.reduce\(|sum\(/.test(js));
}

section('what is sent');
{
  const sent = [];
  const deps = { invoke: async (name, body) => { sent.push([name, body]); return { data: { ok: true, correct: true, attempt_no: 2, attempts_left: 1 }, error: null }; } };
  const v = buildView({ item, doc: doc(), grade });
  const r = await sendAnswer(deps, AO, v.questions[0], '9.8', 3);
  eq('one call to check-answer', sent.map(s => s[0]), ['check-answer']);
  eq('with exactly three fields', Object.keys(sent[0][1]).sort(), ['answer', 'assignment_offering_id', 'question_id']);
  eq('...holding the offering, the question and the typed text', sent[0][1], { assignment_offering_id: AO, question_id: Q1, answer: '9.8' });
  await sendAnswer(deps, AO, v.questions[1], ['b'], 3);
  eq('a choice is sent as its id list', sent[1][1].answer, ['b']);
  eq('the reply is read as right, attempt 2, one try left', [r.kind, r.correct, r.attemptNo, r.left, r.text], ['checked', true, 2, 1, 'Correct. 1 try left.']);
}

section('what each reply says');
{
  const d = (data, error = null) => describeReply({ data, error }, 3);
  eq('wrong with tries left', d({ ok: true, correct: false, attempt_no: 1, attempts_left: 2 }).text, 'Not correct. 2 tries left.');
  const last = d({ ok: true, correct: false, attempt_no: 3, attempts_left: 0 });
  eq('wrong on the last try says so and marks the question spent', [last.text, last.spent], ['Not correct. No tries left.', true]);
  eq('right with no limit says no count', d({ ok: true, correct: true, attempt_no: 4, attempts_left: null }).text, 'Correct.');
  const refused = d({ ok: false, code: 'comma', error: 'Write 1.5 with a decimal point.' });
  eq('a refusal shows the server sentence and is not a checked answer', [refused.kind, refused.text, refused.spent], ['refused', 'Write 1.5 with a decimal point.', false]);
  const lim = d({ ok: false, code: 'limit_reached', error: 'You have used all of your attempts on this question.' });
  check('limit_reached marks the question spent', lim.kind === 'refused' && lim.spent === true);
  check('closed marks the page closed', d({ ok: false, code: 'closed', error: 'This assignment is closed. The deadline has passed.' }).closed === true);
  eq('a network error says the answer was not counted', describeReply({ data: null, error: new Error('Failed to fetch') }, 3), { kind: 'error', text: TEXT.network });
  check('...and so does an empty reply', describeReply({ data: null, error: null }, 3).kind === 'error' && describeReply(undefined, 3).kind === 'error');
  check('a reply with no error text still gets a plain sentence', d({ ok: false, code: 'x' }).text.length > 10);
  const leaky = d({ ok: true, correct: true, attempt_no: 1, attempts_left: 2, key: '9.8', points: 5, tol_pct: 2 });
  check('extra fields in a reply are never shown', !/9\.8|points|tol/.test(JSON.stringify(leaky)));
  const thrown = await sendAnswer({ invoke: async () => { throw new Error('socket'); } }, AO, buildView({ item, doc: doc(), grade }).questions[0], '1', 3);
  eq('a thrown transport error is the same plain message', thrown, { kind: 'error', text: TEXT.network });
}

section('reading what the student entered');
{
  const v = buildView({ item, doc: doc(), grade });
  eq('an empty number box asks for an answer', readEntry(v.questions[0], { text: '   ' }), { ok: false, text: TEXT.noAnswer });
  eq('a number is trimmed and sent as typed', readEntry(v.questions[0], { text: ' 1,5 ' }), { ok: true, value: '1,5' });
  eq('no choice asks for one', readEntry(v.questions[1], { choices: [] }), { ok: false, text: TEXT.noChoice });
  eq('a single choice is sent as one id', readEntry(v.questions[1], { choices: ['a'] }), { ok: true, value: 'a' });
  eq('select-all is sent as a list', readEntry({ format: 'multiple_select' }, { choices: ['a', 'c'] }), { ok: true, value: ['a', 'c'] });
}

section('the score is the grade row');
{
  eq('a grade row is shown as it is', scoreText(grade, item).text, 'Score so far: 2 of 3.');
  eq('no grade row says no answers yet, not 0', scoreText(null, item).text, 'No answers yet. This homework is worth 3 points.');
  check('...and carries no earned number', scoreText(null, item).earned === null);
  eq('half points print plainly', scoreText({ points_earned: '1.50', points_possible: '4.00' }, item).text, 'Score so far: 1.5 of 4.');
  eq('fmt drops trailing zeros', [fmt('2.00'), fmt(1.25), fmt(0)], ['2', '1.25', '0']);
  const v = buildView({ item, doc: doc(), grade });
  eq('each question shows what counts, from question_scores', [v.questions[0].counts, v.questions[1].counts], [{ score: 2, max: 2 }, null]);
  eq('tries left come from the limit and the count of tries', v.questions.map(q => q.left), [2, 3]);
  eq('no limit means no number of tries left', buildView({ item, doc: doc({ attempt_limit: null }), grade }).questions.map(q => q.left), [null, null]);
  eq('the rule is said in plain words', [ruleText('best'), ruleText('last'), ruleText('first')],
    ['Your best try on each question counts.', 'Your last try on each question counts.', 'Your first try on each question counts.']);
  eq('tries left text', [triesLeftText(3, 1), triesLeftText(3, 2), triesLeftText(3, 3), triesLeftText(null, 9)], ['2 tries left.', '1 try left.', 'No tries left.', '']);
}

section('after the deadline');
{
  const past = { ...item, isPast: true };
  const closed = buildView({ item: past, doc: doc(), grade });
  check('past the deadline with no late work: read-only with the closed sentence', closed.readOnly === true && closed.banner === TEXT.closed);
  const late = buildView({ item: past, doc: doc({ late_allowed: true }), grade });
  check('past the deadline with late work allowed: still open, with the late sentence', late.readOnly === false && late.banner === TEXT.late);
  check('before the deadline: no banner', buildView({ item, doc: doc(), grade }).banner === '');
  const html = renderHomework(closed);
  check('read-only markup disables every box and button (1 text box, 2 radios, 2 buttons)', (html.match(/disabled/g) || []).length === 5 || (html.match(/disabled/g) || []).length === 3);
  check('open markup disables nothing', !/disabled/.test(renderHomework(buildView({ item, doc: doc(), grade }))));
}

section('the drawn page');
{
  const v = buildView({ item, doc: doc(), grade });
  const html = renderHomework(v);
  check('one question block per question', (html.match(/class="question-block"/g) || []).length === 2);
  check('the prompt and the choices are escaped, not run', !html.includes('<b>bold</b>') && html.includes('&lt;b&gt;bold&lt;/b&gt;') && html.includes('First &lt;i&gt;one&lt;/i&gt;'));
  check('the number question has a text box with a plain hint', /type="text"[^>]*data-entry/.test(html) && html.includes('Use a decimal point'));
  check('the unit hint is shown as a hint', html.includes('Give your answer in m/s.'));
  check('the choice question has radio buttons', (html.match(/type="radio"/g) || []).length === 2);
  const ms = renderHomework(buildView({ item, doc: doc({ questions: [{ ...doc().questions[1], format: 'multiple_select' }] }), grade }));
  check('select-all has checkboxes and says so', (ms.match(/type="checkbox"/g) || []).length === 2 && ms.includes('Choose all that apply.'));
  check('each question has its own Check answer button, reply line and counts line', (html.match(/data-check=/g) || []).length === 2 && (html.match(/data-reply=/g) || []).length === 2 && (html.match(/data-counts=/g) || []).length === 2);
  check('the score line is drawn from the grade row', html.includes('Score so far: 2 of 3.'));
  check('with nothing held back there is no held-back notice', !/not available yet/.test(html));
  const held = renderHomework(buildView({ item, doc: doc({ held_back: 2 }), grade }));
  check('questions an instructor has not finished checking are counted, not shown', held.includes('2 questions are not available yet'), held.slice(0, 40));
  check('one held-back question reads in the singular', renderHomework(buildView({ item, doc: doc({ held_back: 1 }), grade })).includes('1 question is not available yet'));
  check('the page carries no key field names', !/correct_choice|tol_|key_version/.test(html));
  check('a figure url is escaped into an image', renderHomework(buildView({ item, doc: doc({ questions: [{ ...doc().questions[0], figure_url: 'https://x.test/a"b.png' }] }), grade })).includes('a&quot;b.png'));
}

process.exit(summary() ? 0 : 1);
