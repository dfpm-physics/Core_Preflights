// test-items-setup.mjs — "How cadets do this work": the three cards on an assignment's setup (Questions, Interactive tutor,
// Both). Offline: it reads files and runs the page's own functions against stand-ins. It makes no network call.
//
// WHAT THIS DEFENDS
//   * The cards are only a different way to set what the form already set. For every choice the old checkbox and boxes could
//     make, the card makes the same delivery, grading and tutor flag, so pathPlan() (the paths a save writes) is identical.
//   * A kind decides at most what the Questions card starts on; nothing else reads a kind.
//   * The page wires the cards, drops the checkbox, reads the mode in readForm, saves a new assignment unpublished and opens
//     it for setup, and styles the cards with the classes the cadets' chooser uses (one look).
//
// WHAT THIS CANNOT PROVE
//   That the page looks right or that a real save reaches the database. The browser walk and the staging save are separate.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/items.html' });
globalThis.window.db = { from: () => { throw new Error('no database in this test'); } };

const I = await import('../../site/js/faculty-items.js');
const html = readFileSync(resolve(REPO, 'site/faculty/items.html'), 'utf8').replace(/\r\n/g, '\n');
const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
const css = readFileSync(resolve(REPO, 'site/css/styles.css'), 'utf8');
const lessons = readFileSync(resolve(REPO, 'site/student/lessons.html'), 'utf8');

// What the form used to hold: a delivery, a grading, and the "also offer a tutor" box. readForm's withTutor was
// `box && delivery === 'typed_response'`.
const legacyForm = (delivery, grading, box, policy = 'choice') => ({ delivery, grading, withTutor: box && delivery === 'typed_response', policy });

section('each card sets the same paths a save used to write for the same choice');
{
  const cases = [
    // [card, starting delivery/grading, what the old controls would hold for the same intent]
    ['questions', ['online_questions', 'auto_checked'], ['online_questions', 'auto_checked', false]],
    ['questions', ['typed_response', 'ai_drafted'], ['typed_response', 'ai_drafted', false]],
    ['both', ['typed_response', 'human_graded'], ['typed_response', 'human_graded', true]],
    ['both', ['typed_response', 'ai_drafted'], ['typed_response', 'ai_drafted', true]],
    ['tutor', ['interactive_tutor', 'effort'], ['interactive_tutor', 'effort', false]],
  ];
  for (const [mode, [d, g], [ld, lg, box]] of cases) {
    const r = I.applyMode(mode, { delivery: d, grading: g }, null);
    for (const policy of ['choice', 'typed', 'tutor']) {
      eq(`${mode} on ${d}/${g}, policy ${policy}: same plan as the old controls`,
        I.pathPlan({ ...r, policy }), I.pathPlan(legacyForm(ld, lg, box, policy)));
    }
  }
  // moving between cards from another delivery: the delivery the old boxes would have been set to by hand
  eq('Both from questions-on-the-site moves to a typed response with the tutor',
    I.pathPlan({ ...I.applyMode('both', { delivery: 'online_questions', grading: 'auto_checked' }), policy: 'choice' }),
    I.pathPlan(legacyForm('typed_response', I.gradingsFor('typed_response')[0], true)));
  eq('Tutor from a typed response moves to the tutor alone, graded by effort',
    I.pathPlan(I.applyMode('tutor', { delivery: 'typed_response', grading: 'ai_drafted' })),
    I.pathPlan(legacyForm('interactive_tutor', 'effort', false)));
  check('every plan a card makes uses a pair the database accepts',
    cases.every(([mode, [d, g]]) => { const r = I.applyMode(mode, { delivery: d, grading: g }); return I.pairAllowed(r.delivery, r.grading); }));
}

section('Questions after Tutor starts on the kind\'s own delivery, and never on a kind name');
{
  const kind = (delivery, grading) => ({ default_delivery: delivery, default_grading: grading });
  eq('a kind that defaults to site questions', I.applyMode('questions', { delivery: 'interactive_tutor', grading: 'effort' }, I.prefillFromKind(kind('online_questions', 'human_graded'))),
    { delivery: 'online_questions', grading: 'human_graded', withTutor: false });
  eq('a kind that defaults to a typed response', I.applyMode('questions', { delivery: 'interactive_tutor', grading: 'effort' }, I.prefillFromKind(kind('typed_response', 'ai_drafted'))),
    { delivery: 'typed_response', grading: 'ai_drafted', withTutor: false });
  eq('a kind that defaults to in person falls back to a typed response', I.applyMode('questions', { delivery: 'interactive_tutor', grading: 'effort' }, I.prefillFromKind(kind('in_person', 'hand_entered'))).delivery, 'typed_response');
  eq('Questions on a delivery that is already questions changes nothing', I.applyMode('questions', { delivery: 'online_questions', grading: 'human_graded' }, I.prefillFromKind(kind('typed_response', 'ai_drafted'))),
    { delivery: 'online_questions', grading: 'human_graded', withTutor: false });
  check('the helpers name no kind', !/preflight|homework|case_study|group_project/.test(
    I.applyMode.toString() + I.modeOfShape.toString() + I.modeFromDelivery.toString()));
}

section('the card an assignment opens on, and how a changed delivery box moves it');
{
  const typed = { modality: 'written', delivery: 'typed_response', grading: 'human_graded', role: 'graded' };
  const tutor = { modality: 'interactive', delivery: 'interactive_tutor', grading: 'effort', role: 'graded' };
  eq('one typed path opens on Questions', I.modeOfShape(I.pathShape([typed])), 'questions');
  eq('one tutor path opens on Interactive tutor', I.modeOfShape(I.pathShape([tutor])), 'tutor');
  eq('a typed response with the tutor opens on Both', I.modeOfShape(I.pathShape([typed, { ...tutor }])), 'both');
  eq('site questions open on Questions', I.modeOfShape(I.pathShape([{ modality: 'questions', delivery: 'online_questions', grading: 'auto_checked' }])), 'questions');
  eq('a locked shape opens on Questions (the cards are not shown for it)', I.modeOfShape(I.pathShape([typed, typed, tutor])), 'questions');
  eq('picking the tutor in the delivery box selects Tutor', I.modeFromDelivery('interactive_tutor', 'questions'), 'tutor');
  eq('Both survives a typed response', I.modeFromDelivery('typed_response', 'both'), 'both');
  eq('Both does not survive site questions', I.modeFromDelivery('online_questions', 'both'), 'questions');
  eq('a typed response after Tutor is Questions', I.modeFromDelivery('typed_response', 'tutor'), 'questions');
  check('cards apply to questions, typed and tutor only', ['online_questions', 'typed_response', 'interactive_tutor'].every(I.cardsApply)
    && !I.cardsApply('in_person') && !I.cardsApply('elsewhere'));
}

section('the page: markup, wiring and the single look');
{
  check('three cards: Questions, Interactive tutor, Both (cadets choose)',
    ['questions', 'tutor', 'both'].every(m => new RegExp(`class="choice-card"[^>]*data-mode="${m}"`).test(markup))
    && /Both \(cadets choose\)/.test(markup) && /<span class="choice-title">Interactive tutor<\/span>/.test(markup));
  check('the section is titled in plain words', /How cadets do this work/.test(markup));
  check('the section sits above More options', markup.indexOf('id="i-cards"') < markup.indexOf('<details class="more-options"'));
  check('the cards are radios with a state a screen reader can read', /role="radiogroup"/.test(markup) && (markup.match(/role="radio" aria-checked="false"/g) || []).length === 3);
  check('each card is a real button, so the keyboard reaches it', (markup.match(/<button type="button" class="choice-card"/g) || []).length === 3);
  check('the page wires the cards', /querySelectorAll\('#i-cards \[data-mode\]'\)/.test(script) && /chooseMode\(b\.dataset\.mode\)/.test(script));
  check('readForm reads the card, not a checkbox', /withTutor: pathMode === 'both' && \$\('i-delivery'\)\.value === 'typed_response'/.test(script));
  check('a changed delivery box moves the card', /pathMode = I\.modeFromDelivery\(d, pathMode\)/.test(script));
  check('a locked shape shows why instead of the cards', /i-setup-locked/.test(script) && /\$\('i-cards'\)\.style\.display = locked/.test(script));
  check('a new assignment is opened for setup after it is saved, with a plain line', /openForm\(created\)/.test(script) && /Saved, and not published yet\. Next: choose how cadets do this work/.test(script));
  check('the new form stays short: the section is shown for a saved assignment, a tutor, or a link\'s tutor only', /editing \|\| two \|\| tutorOnly \? 'block' : 'none'/.test(script));
  check('the questions card links to the questions page and counts them', /questions\.html\?a=/.test(script) && /countQuestionsAndKeys/.test(script));
  check('a failed count says so, never zero', /could not be counted/.test(script));
  check('the section never opens More options for a control that is not in it', /\$\('i-more'\)\.contains\(el\)/.test(script));
  check('the card styles are shared: defined once, in styles.css', /\.choice-card \{/.test(css) && /\.choice-grid \{/.test(css) && !/\.choice-card \{/.test(lessons));
  check('the cadets\' chooser still uses the same classes', /class="choice-card"/.test(lessons) && /class="choice-grid"/.test(lessons));
  check('the cards add only a selected state to that look', /\.choice-card\.selected/.test(css));
}

section('the page\'s own chooseMode, run against stand-ins');
{
  const a = script.indexOf('function chooseMode(');
  const b = script.indexOf('/* The setup section:');
  check('chooseMode can be found', a > 0 && b > a);
  const chunk = script.slice(a, b);
  function drive(mode, { delivery, grading, locked = false, kindDelivery = 'typed_response', kindGrading = 'human_graded' }) {
    const el = { 'i-delivery': { value: delivery }, 'i-grading': { value: grading }, 'i-kind': { value: 'k' } };
    const log = { fr: [] };
    let pathMode = 'questions';
    const fillDelivery = (v) => { el['i-delivery'].value = v; };
    const fillGrading = (d, v) => { el['i-grading'].value = v; };
    const fr = { get: () => log.frSet ? {} : null, set: (v) => { log.frSet = true; log.fr.push('set'); } };
    const run = new Function('$', 'isLocked', 'editing', 'vm', 'I', 'fillDelivery', 'fillGrading', 'fr', 'emptyEditor', 'showInteractive', 'syncPoints', 'setMode',
      chunk.replace(/pathMode = mode;/, 'setMode(mode);') + '\nreturn chooseMode;');
    const choose = run((id) => el[id], () => locked, null,
      { kinds: [{ id: 'k', default_delivery: kindDelivery, default_grading: kindGrading }] }, I, fillDelivery, fillGrading, fr, () => ({}), () => {}, () => {}, (m) => { pathMode = m; });
    choose(mode);
    return { delivery: el['i-delivery'].value, grading: el['i-grading'].value, mode: pathMode, fr: log.fr };
  }
  eq('Both from site questions', drive('both', { delivery: 'online_questions', grading: 'auto_checked' }), { delivery: 'typed_response', grading: 'human_graded', mode: 'both', fr: ['set'] });
  eq('Tutor from a typed response', drive('tutor', { delivery: 'typed_response', grading: 'ai_drafted' }), { delivery: 'interactive_tutor', grading: 'effort', mode: 'tutor', fr: [] });
  eq('Questions after Tutor uses the kind\'s delivery', drive('questions', { delivery: 'interactive_tutor', grading: 'effort', kindDelivery: 'online_questions', kindGrading: 'auto_checked' }),
    { delivery: 'online_questions', grading: 'auto_checked', mode: 'questions', fr: [] });
  eq('Questions after Tutor, a typed kind, starts a question set', drive('questions', { delivery: 'interactive_tutor', grading: 'effort' }),
    { delivery: 'typed_response', grading: 'human_graded', mode: 'questions', fr: ['set'] });
  eq('a locked assignment ignores a card', drive('tutor', { delivery: 'typed_response', grading: 'ai_drafted', locked: true }),
    { delivery: 'typed_response', grading: 'ai_drafted', mode: 'questions', fr: [] });
}

section('a save is not changed: the writing code is untouched by the cards');
{
  const src = readFileSync(resolve(REPO, 'site/js/faculty-items.js'), 'utf8');
  check('pathPlan still builds the two paths from delivery and withTutor', /isTypedResponse\(form\.delivery\) && form\.withTutor/.test(src));
  check('the page still sends the tutor fields it always did', ['interactiveSlug', 'interactiveUrl', 'interactiveTitle', 'interactiveDesc', 'swapTutor', 'policy', 'switchPolicy']
    .every(k => script.includes(k + ':')));
  check('every refusal and warning loop is still in save()', ['needsConfirm', 'needsTutorConfirm', 'needsPointsConfirm', 'needsDeadlineConfirm', 'needsUnpublishConfirm'].every(k => script.includes(k)));
  check('the page still never writes a literal publish true', !/is_published:\s*true/.test(script));
}

process.exit(summary() ? 0 : 1);
