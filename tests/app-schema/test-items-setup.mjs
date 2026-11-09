// test-items-setup.mjs — "How cadets do this work": the cards on an assignment's setup. There are two sets, chosen from the kind's own
// default delivery: typed work (AI-graded questions, Instructor-graded questions, Interactive tutor, Both) and everything else
// (In class, Auto-graded questions, Done elsewhere). Offline: it reads files and runs the page's own functions against stand-ins.
// It makes no network call.
//
// WHAT THIS DEFENDS
//   * Each card is one exact delivery, grading and tutor flag, so pathPlan() (the paths a save writes) is the pair the card names.
//   * The set a kind gets is decided by the kind's default_delivery column and never by its id, so the database comment
//     "no code branches on kind" stays true.
//   * Auto-graded questions is grayed (with a reason) unless the kind's default delivery is questions on the site, and a saved
//     assignment that already has a card keeps it usable. A saved setting that is none of the cards is shown, never changed on open.
//   * The page draws the cards from that set, wires them, reads the card in readForm, and styles them with the classes the cadets'
//     chooser uses (one look).
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
const src = readFileSync(resolve(REPO, 'site/js/faculty-items.js'), 'utf8');

// The kinds as migration 026 seeds them: the data the chooser reads.
const K = (id, default_delivery, default_grading) => ({ id, label: id, default_delivery, default_grading });
const kinds = {
  preflight: K('preflight', 'typed_response', 'human_graded'),
  case_study: K('case_study', 'typed_response', 'human_graded'),
  homework: K('homework', 'online_questions', 'auto_checked'),
  group_project: K('group_project', 'elsewhere', 'imported'),
  quiz: K('quiz', 'elsewhere', 'imported'),
  exam: K('exam', 'in_person', 'hand_entered'),
  lab: K('lab', 'elsewhere', 'imported'),
};
const ids = (kind) => I.cardsFor(kind).map(c => c.id);

section('the set a kind gets comes from its default delivery, never from its name');
{
  eq('preflight gets the typed-work cards', ids(kinds.preflight), ['ai', 'human', 'tutor', 'both']);
  eq('case study gets them too, because its default delivery is a typed response', ids(kinds.case_study), ['ai', 'human', 'tutor', 'both']);
  eq('a kind whose default is the tutor gets them', ids(K('x', 'interactive_tutor', 'effort')), ['ai', 'human', 'tutor', 'both']);
  for (const k of ['homework', 'group_project', 'quiz', 'exam', 'lab']) eq(`${k} gets the other cards`, ids(kinds[k]), ['class', 'auto', 'elsewhere']);
  eq('a kind with no defaults gets the other cards', ids(K('new', null, null)), ['class', 'auto', 'elsewhere']);
  eq('a kind renamed to preflight with another delivery follows its delivery, not its name', ids(K('preflight', 'in_person', 'hand_entered')), ['class', 'auto', 'elsewhere']);
  check('the helpers name no kind', !/preflight|homework|case_study|group_project|'quiz'|'exam'|'lab'/.test(
    [I.chooserFor, I.cardsFor, I.cardOffered, I.cardOf, I.defaultCardFor, I.chooserState].map(f => f.toString()).join('')));
}

section('each card is one exact setting, and the plan a save writes follows it');
{
  const plan = (id, kind = kinds.preflight) => I.pathPlan({ ...I.applyCard(I.cardsFor(kind).find(c => c.id === id)), policy: 'choice' });
  eq('AI-graded questions: one typed path, drafted by the AI', plan('ai'), [{ which: 'main', delivery: 'typed_response', grading: 'ai_drafted', role: 'graded', position: 0 }]);
  eq('Instructor-graded questions: one typed path, graded by a person', plan('human'), [{ which: 'main', delivery: 'typed_response', grading: 'human_graded', role: 'graded', position: 0 }]);
  eq('Interactive tutor: the tutor alone, graded by effort', plan('tutor'), [{ which: 'main', delivery: 'interactive_tutor', grading: 'effort', role: 'graded', position: 0 }]);
  const both = plan('both');
  eq('Both: a typed path drafted by the AI and the tutor beside it', both.map(p => [p.which, p.delivery, p.grading]), [['typed', 'typed_response', 'ai_drafted'], ['tutor', 'interactive_tutor', 'effort']]);
  eq('Both: the cadet chooses, so both paths earn credit', both.map(p => p.role), ['graded', 'graded']);
  eq('In class: in person, scores typed in', plan('class', kinds.exam), [{ which: 'main', delivery: 'in_person', grading: 'hand_entered', role: 'graded', position: 0 }]);
  eq('Auto-graded questions: questions on the site, checked automatically', plan('auto', kinds.homework), [{ which: 'main', delivery: 'online_questions', grading: 'auto_checked', role: 'graded', position: 0 }]);
  eq('Done elsewhere: scores imported', plan('elsewhere', kinds.quiz), [{ which: 'main', delivery: 'elsewhere', grading: 'imported', role: 'graded', position: 0 }]);
  check('every card is a pair the database accepts', Object.values(I.CARD_SETS).flat().every(c => I.pairAllowed(c.delivery, c.grading)));
  check('the less common pairs are still reachable through the grading box', [
    ['online_questions', 'human_graded'], ['in_person', 'imported'], ['elsewhere', 'hand_entered'], ['typed_response', 'human_graded']].every(([d, g]) => I.gradingsFor(d).includes(g)));
  check('every pair the database allows is still offered by the delivery and grading boxes',
    I.ALLOWED_PAIRS.every(([d, g]) => I.deliveries().includes(d) && I.gradingsFor(d).includes(g)));
}

section('the card a new assignment starts on, and the card a setting is');
{
  eq('a preflight starts on Instructor-graded questions', I.defaultCardFor(kinds.preflight).id, 'human');
  eq('a case study starts on Instructor-graded questions', I.defaultCardFor(kinds.case_study).id, 'human');
  eq('homework starts on Auto-graded questions', I.defaultCardFor(kinds.homework).id, 'auto');
  eq('a quiz starts on Done elsewhere', I.defaultCardFor(kinds.quiz).id, 'elsewhere');
  eq('an exam starts on In class', I.defaultCardFor(kinds.exam).id, 'class');
  eq('a kind with no defaults starts on the first card it offers (not the grayed one)', I.defaultCardFor(K('n', null, null)).id, 'class');
  eq('Both with the typed side drafted by the AI is Both', I.cardOf(kinds.preflight, { delivery: 'typed_response', grading: 'ai_drafted', withTutor: true }), 'both');
  eq('Both with a person grading the typed side is not a card', I.cardOf(kinds.preflight, { delivery: 'typed_response', grading: 'human_graded', withTutor: true }), null);
  eq('a tutor flag on a non-typed delivery is ignored', I.cardOf(kinds.preflight, { delivery: 'interactive_tutor', grading: 'effort', withTutor: true }), 'tutor');
  eq('the same pair on another kind has no card in that kind\'s set', I.cardOf(kinds.homework, { delivery: 'typed_response', grading: 'human_graded', withTutor: false }), null);
}

section('the grayed card: Auto-graded questions only where the kind is answered on the site');
{
  const find = (state, id) => state.cards.find(c => c.id === id);
  const fresh = (kind) => I.chooserState(kind, I.applyCard(I.defaultCardFor(kind)), false);
  eq('homework: Auto-graded questions is usable and selected', [find(fresh(kinds.homework), 'auto').usable, find(fresh(kinds.homework), 'auto').selected], [true, true]);
  for (const k of ['quiz', 'exam', 'lab', 'group_project']) {
    const st = fresh(kinds[k]);
    eq(`${k}: Auto-graded questions is grayed`, [find(st, 'auto').usable, find(st, 'auto').selected], [false, false]);
    eq(`${k}: In class and Done elsewhere stay usable`, [find(st, 'class').usable, find(st, 'elsewhere').usable], [true, true]);
  }
  eq('the reason is the plain sentence', find(fresh(kinds.quiz), 'auto').offReason, 'Only homework is answered on the site.');
  check('only that card is ever grayed for a kind that never saved it', ['quiz', 'exam', 'lab', 'group_project', 'preflight', 'case_study', 'homework']
    .every(k => fresh(kinds[k]).cards.filter(c => !c.usable).every(c => c.id === 'auto')));
  check('no card of the typed-work set is ever grayed', I.chooserState(kinds.preflight, { delivery: 'typed_response', grading: 'human_graded' }).cards.every(c => c.usable));
  eq('Done elsewhere is one object in the other set, in one place', Object.values(I.CARD_SETS).flat().filter(c => c.id === 'elsewhere').length, 1);
  check('removing that one object leaves the rest of the set intact', I.CARD_SETS.other.filter(c => c.id !== 'elsewhere').map(c => c.id).join() === 'class,auto');
}

section('an assignment already saved shows its real setting and is not changed on open');
{
  const quizOnline = I.chooserState(kinds.quiz, { delivery: 'online_questions', grading: 'auto_checked', withTutor: false }, true);
  const sel = quizOnline.cards.find(c => c.selected);
  eq('a quiz saved as questions on the site: that card is selected and usable', [sel?.id, sel?.usable], ['auto', true]);
  eq('and it says it is an older setting', [quizOnline.older, quizOnline.current], [true, null]);
  const hw = I.chooserState(kinds.homework, { delivery: 'online_questions', grading: 'human_graded', withTutor: false }, true);
  eq('homework graded by a person matches no card: it is shown as the current setting', [hw.cards.some(c => c.selected), hw.current?.text, hw.older],
    [false, 'Questions answered on the site, graded by a person', true]);
  const bothHuman = I.chooserState(kinds.preflight, { delivery: 'typed_response', grading: 'human_graded', withTutor: true }, true);
  eq('Both with a person grading the typed side is shown, and called older', [bothHuman.current?.text, bothHuman.older],
    ['Typed response, graded by a person, with the interactive tutor beside it', true]);
  const pf = I.chooserState(kinds.preflight, { delivery: 'typed_response', grading: 'human_graded', withTutor: false }, true);
  eq('a preflight on one of its own cards is not called older', [pf.older, pf.current], [false, null]);
  const newOne = I.chooserState(kinds.homework, { delivery: 'typed_response', grading: 'human_graded', withTutor: false }, false);
  eq('a new form with an odd setting (a link\'s) shows it but does not call it older', [!!newOne.current, newOne.older], [true, false]);
  // The page never calls a function that writes while it opens a saved assignment.
  const open = script.slice(script.indexOf('function openForm('), script.indexOf('function closeForm('));
  check('opening a saved assignment applies no card', open.includes('const start = item ? null : I.applyCard(I.defaultCardFor(kind0))') && !/chooseMode\(/.test(open));
  check('a saved assignment takes its delivery and grading from its own path', /const delivery = path \? path\.delivery : \(item \? '' : start\.delivery\)/.test(open));
  check('changing the kind of a saved assignment only redraws the cards', /if \(editing\) \{ renderSetup\(\); return; \}/.test(script));
  check('changing the kind of a new assignment re-picks the set and its default card', /I\.applyCard\(I\.defaultCardFor\(kind\)\)/.test(script));
  const old = I.needsMoreOptions({ paths: [{ modality: 'written', delivery: 'typed_response', grading: 'ai_drafted', content: { questions: [{ role: 'reading_time' }, { role: 'reading_reflection' }] } }], dueRows: [] },
    { prefill: I.prefillFromKind(kinds.preflight), kind: kinds.preflight, sections: [], sched: null });
  eq('a card choice other than the kind\'s default does not open More options', old, false);
}

section('the card an assignment opens on, and how a changed delivery box moves the tutor flag');
{
  const typed = { modality: 'written', delivery: 'typed_response', grading: 'human_graded', role: 'graded' };
  const tutor = { modality: 'interactive', delivery: 'interactive_tutor', grading: 'effort', role: 'graded' };
  eq('one typed path has no tutor flag', I.modeOfShape(I.pathShape([typed])), 'questions');
  eq('one tutor path is the tutor', I.modeOfShape(I.pathShape([tutor])), 'tutor');
  eq('a typed response with the tutor is two paths', I.modeOfShape(I.pathShape([typed, { ...tutor }])), 'both');
  eq('a locked shape has no tutor flag (the cards are not shown for it)', I.modeOfShape(I.pathShape([typed, typed, tutor])), 'questions');
  eq('picking the tutor in the delivery box sets the tutor flag', I.modeFromDelivery('interactive_tutor', 'questions'), 'tutor');
  eq('Both survives a typed response', I.modeFromDelivery('typed_response', 'both'), 'both');
  eq('Both does not survive questions on the site', I.modeFromDelivery('online_questions', 'both'), 'questions');
  eq('the flag of a setting', [I.modeOfSetting({ delivery: 'typed_response', withTutor: true }), I.modeOfSetting({ delivery: 'interactive_tutor' }), I.modeOfSetting({ delivery: 'in_person' })], ['both', 'tutor', 'questions']);
}

section('the page: markup, wiring and the single look');
{
  check('the section is titled in plain words', /How cadets do this work/.test(markup));
  check('the section sits above More options', markup.indexOf('id="i-cards"') < markup.indexOf('<details class="more-options" id="i-more"'));
  check('the cards are a radio group the page draws from the kind\'s set', /id="i-cards" role="radiogroup"/.test(markup) && !/class="choice-card"/.test(markup) && /cardsEl\.innerHTML = state\.cards\.map\(one\)/.test(script));
  check('each card is a real button with a state a screen reader can read', /<button type="button" class="choice-card/.test(script) && /role="radio" aria-checked=/.test(script));
  check('a grayed card keeps its reason for a screen reader and for a hover', /aria-disabled="true" title="\$\{esc\(why\)\}"/.test(script) && /class="choice-why"/.test(script));
  check('the page wires the cards once, on the group', /\$\('i-cards'\)\.addEventListener\('click'/.test(script) && /chooseMode\(b\.dataset\.mode\)/.test(script));
  check('a card that is not usable does nothing', /if \(!card \|\| !card\.usable\) return;/.test(script));
  check('readForm reads the tutor flag, not a checkbox', /withTutor: pathMode === 'both' && \$\('i-delivery'\)\.value === 'typed_response'/.test(script));
  check('a changed delivery box moves the tutor flag', /pathMode = I\.modeFromDelivery\(d, pathMode\)/.test(script));
  check('a changed grading box redraws the cards', /\$\('i-grading'\)\.addEventListener\('change', \(\) => \{ syncPoints\(\); fr\.redraw\(\); renderSetup\(\); \}\)/.test(script));
  check('a locked shape shows why instead of the cards', /i-setup-locked/.test(script) && /cardsEl\.style\.display = locked/.test(script));
  check('the section is shown for every assignment, new or saved', /\$\('i-setup'\)\.style\.display = 'block'/.test(script));
  check('the longer explanation sits behind the shared information control, not in a card', /infoHTML\(I\.CHOOSER_HELP\[chooser\]/.test(script) && /id="i-setup-info"/.test(markup));
  check('a new assignment is opened for setup after it is saved, with a plain line', /openForm\(created\)/.test(script) && /Saved, and not published yet\. Next: choose how cadets do this work/.test(script));
  check('the questions card links to the questions page and counts them', /questions\.html\?a=/.test(script) && /countQuestionsAndKeys/.test(script));
  check('a failed count says so, never zero', /could not be counted/.test(script));
  check('the section never opens More options for a control that is not in it', /\$\('i-more'\)\.contains\(el\)/.test(script));
  check('the card styles are shared: defined once, in styles.css', /\.choice-card \{/.test(css) && /\.choice-grid \{/.test(css) && !/\.choice-card \{/.test(lessons));
  check('the cadets\' chooser still uses the same classes', /class="choice-card"/.test(lessons) && /class="choice-grid"/.test(lessons));
  check('the cards add a selected state and a grayed state to that look', /\.choice-card\.selected/.test(css) && /\.choice-card\.is-off/.test(css));
  check('the file drop is in the tutor card, with a button for the keyboard', /id="i-drop"/.test(markup) && /Drop the tutor setup file here/.test(markup) && /id="i-drop-pick"[^>]*>Choose file</.test(markup));
  check('the hand-entry boxes sit under a closed disclosure', /<details class="more-options" id="i-hand"[^>]*>\s*<summary>Enter the details by hand<\/summary>/.test(markup) && !/id="i-hand"[^>]* open/.test(markup));
  check('the drop zone and the boxes show only when a tutor is on the item', /\$\('i-tutor-setup'\)\.style\.display = tutorOn && !locked/.test(script) && /\$\('i-hand'\)\.style\.display = tutorOn/.test(script));
  check('a refusal about a tutor box opens the disclosure', /\$\('i-hand'\)\.contains\(el\)/.test(script));
}

section('the page\'s own chooseMode, run against stand-ins');
{
  const a = script.indexOf('function chooseMode(');
  const b = script.indexOf('/* The setup section:');
  check('chooseMode can be found', a > 0 && b > a);
  const chunk = script.slice(a, b);
  function drive(id, { delivery, grading, withTutor = false, kind = 'preflight', locked = false, saved = false }) {
    const el = { 'i-delivery': { value: delivery }, 'i-grading': { value: grading } };
    const log = { fr: [] };
    let pathMode = withTutor ? 'both' : 'questions';
    const fillDelivery = (v) => { el['i-delivery'].value = v; };
    const fillGrading = (d, v) => { el['i-grading'].value = v; };
    const fr = { get: () => log.frSet ? {} : null, set: () => { log.frSet = true; log.fr.push('set'); }, redraw: () => log.fr.push('redraw') };
    const run = new Function('$', 'isLocked', 'editing', 'I', 'currentKind', 'currentSetting', 'fillDelivery', 'fillGrading', 'fr', 'emptyEditor', 'showInteractive', 'syncPoints', 'setMode',
      chunk.replace(/pathMode = (I\.modeOfSetting\(r\));/, 'setMode($1);') + '\nreturn chooseMode;');
    const choose = run((id) => el[id], () => locked, saved ? {} : null, I, () => kinds[kind],
      () => ({ delivery: el['i-delivery'].value, grading: el['i-grading'].value, withTutor: pathMode === 'both' && el['i-delivery'].value === 'typed_response' }),
      fillDelivery, fillGrading, fr, () => ({}), () => {}, () => {}, (m) => { pathMode = m; });
    choose(id);
    return { delivery: el['i-delivery'].value, grading: el['i-grading'].value, mode: pathMode, fr: log.fr };
  }
  eq('AI-graded questions from the tutor', drive('ai', { delivery: 'interactive_tutor', grading: 'effort' }), { delivery: 'typed_response', grading: 'ai_drafted', mode: 'questions', fr: ['set', 'redraw'] });
  eq('Instructor-graded questions from Both', drive('human', { delivery: 'typed_response', grading: 'ai_drafted', withTutor: true }), { delivery: 'typed_response', grading: 'human_graded', mode: 'questions', fr: ['set', 'redraw'] });
  eq('Interactive tutor from a typed response', drive('tutor', { delivery: 'typed_response', grading: 'ai_drafted' }), { delivery: 'interactive_tutor', grading: 'effort', mode: 'tutor', fr: [] });
  eq('Both from the tutor', drive('both', { delivery: 'interactive_tutor', grading: 'effort' }), { delivery: 'typed_response', grading: 'ai_drafted', mode: 'both', fr: ['set', 'redraw'] });
  eq('Auto-graded questions on homework', drive('auto', { delivery: 'in_person', grading: 'hand_entered', kind: 'homework' }), { delivery: 'online_questions', grading: 'auto_checked', mode: 'questions', fr: [] });
  eq('Auto-graded questions on a quiz does nothing (grayed)', drive('auto', { delivery: 'elsewhere', grading: 'imported', kind: 'quiz' }), { delivery: 'elsewhere', grading: 'imported', mode: 'questions', fr: [] });
  eq('Auto-graded questions on a quiz that already has it stays usable', drive('auto', { delivery: 'online_questions', grading: 'auto_checked', kind: 'quiz', saved: true }), { delivery: 'online_questions', grading: 'auto_checked', mode: 'questions', fr: [] });
  eq('In class from done elsewhere', drive('class', { delivery: 'elsewhere', grading: 'imported', kind: 'lab' }), { delivery: 'in_person', grading: 'hand_entered', mode: 'questions', fr: [] });
  eq('Done elsewhere from in class', drive('elsewhere', { delivery: 'in_person', grading: 'hand_entered', kind: 'exam' }), { delivery: 'elsewhere', grading: 'imported', mode: 'questions', fr: [] });
  eq('the current-setting card is not a card: clicking it changes nothing', drive('current', { delivery: 'online_questions', grading: 'human_graded', kind: 'homework', saved: true }), { delivery: 'online_questions', grading: 'human_graded', mode: 'questions', fr: [] });
  eq('a locked assignment ignores a card', drive('tutor', { delivery: 'typed_response', grading: 'ai_drafted', locked: true }), { delivery: 'typed_response', grading: 'ai_drafted', mode: 'questions', fr: [] });
}

section('a saved assignment shows why a card is locked: auto-graded questions cannot be switched to or from');
{
  const REASON = 'A saved assignment cannot switch to or from auto-graded questions. Make a new assignment instead.';
  const P = (delivery, grading) => ({ modality: I.DELIVERY_MODALITY[delivery], delivery, grading });
  const st = (kind, setting, saved, paths) => I.chooserState(kind, setting, saved, paths);
  const card = (state, id) => state.cards.find(c => c.id === id);
  // A saved homework item that is auto-graded: the two other cards are locked, with the reason.
  const hw = st(kinds.homework, { delivery: 'online_questions', grading: 'auto_checked' }, true, [P('online_questions', 'auto_checked')]);
  eq('saved auto-graded homework: In class and Done elsewhere are locked with the reason',
    ['class', 'elsewhere'].map(id => [card(hw, id).usable, card(hw, id).locked, card(hw, id).offReason]), [[false, true, REASON], [false, true, REASON]]);
  eq('and its own card stays selected and usable', [card(hw, 'auto').selected, card(hw, 'auto').usable, card(hw, 'auto').locked], [true, true, false]);
  // A saved in-person exam: Auto-graded questions is locked, with the lock reason (not the kind reason).
  const exam = st(kinds.homework, { delivery: 'in_person', grading: 'hand_entered' }, true, [P('in_person', 'hand_entered')]);
  eq('saved in-person work on a homework kind: Auto-graded questions is locked with the reason', [card(exam, 'auto').usable, card(exam, 'auto').offReason], [false, REASON]);
  eq('and Done elsewhere is not locked (neither side is auto-graded)', [card(exam, 'elsewhere').usable, card(exam, 'elsewhere').locked], [true, false]);
  // A saved questions assignment graded by a person is the same modality: moving to auto-graded is allowed.
  const same = st(kinds.homework, { delivery: 'online_questions', grading: 'human_graded' }, true, [P('online_questions', 'human_graded')]);
  eq('saved questions graded by a person can still take Auto-graded questions (same delivery)', [card(same, 'auto').usable, card(same, 'auto').locked], [true, false]);
  // A NEW assignment is never locked, with or without paths.
  const fresh = st(kinds.homework, { delivery: 'in_person', grading: 'hand_entered' }, false, [P('in_person', 'hand_entered')]);
  eq('a new assignment: no card is locked, Auto-graded questions is usable on homework', [fresh.cards.some(c => c.locked), card(fresh, 'auto').usable], [false, true]);
  eq('no paths given: nothing is locked', st(kinds.homework, { delivery: 'in_person', grading: 'hand_entered' }, true).cards.some(c => c.locked), false);
  check('the typed-work cards are never locked on a saved typed assignment', st(kinds.preflight, { delivery: 'typed_response', grading: 'ai_drafted' }, true, [P('typed_response', 'ai_drafted')]).cards.every(c => c.usable && !c.locked));
  eq('a typed response with a tutor beside it cannot take auto-graded questions', I.switchLocked([{ ...P('typed_response', 'ai_drafted'), role: 'graded' }, { ...P('interactive_tutor', 'effort'), role: 'graded' }], I.CARD_SETS.other[1]), true);
  // The lock is the rule updateItem applies: for every saved single path and every card, a lock means the save is refused, and no lock means it is not.
  const chain = new Proxy(function () {}, { get: (t, p) => p === 'then' ? undefined : (p === 'maybeSingle' || p === 'single') ? async () => ({ data: { id: 'o', updated_at: 't' }, error: null }) : () => chain, apply: () => chain });
  const stub = { from: () => chain };
  let agree = 0, total = 0;
  const bad = [];
  for (const [d, g] of I.ALLOWED_PAIRS) {
    for (const c of Object.values(I.CARD_SETS).flat()) {
      const paths = [{ ...P(d, g), activityId: 'a' }];
      const locked = I.switchLocked(paths, c);
      let refused = false;
      try {
        const r = await I.updateItem(stub, {}, { offeringId: 'o', updatedAt: 't', paths }, { ...I.applyCard(c), policy: 'choice' });
        refused = /switched to or from "Checked automatically"/.test(r?.error?.message || '');
      } catch { refused = false; }
      total++;
      if (locked === refused) agree++; else bad.push(`${d}/${g} -> ${c.id}: locked ${locked}, refused ${refused}`);
    }
  }
  eq(`the card lock and the refusal at Save agree for all ${total} combinations`, bad, []);
  check('the page passes the saved assignment\'s paths to the chooser, in the card and in the click', (script.match(/!!editing, editing\?\.paths\)/g) || []).length === 2);
  check('the refusal at Save is still in updateItem', /switched to or from "Checked automatically"/.test(src));
}

section('a prefill link that carries a tutor selects a card on a new form');
{
  const a = script.indexOf('if (f.withTutor) {');
  const b = script.indexOf('const days = [...document.querySelectorAll', a);
  check('the link block can be found', a > 0 && b > a);
  const chunk = script.slice(a, b);
  function land(f) {
    const el = { 'i-kind': { value: 'homework' }, 'i-delivery': { value: 'online_questions' }, 'i-grading': { value: 'auto_checked' }, 'i-policy': { value: 'choice' } };
    let mode = 'questions'; let editor = null; const set = (id, v) => { if (v != null && v !== '') (el[id] = el[id] || {}).value = v; };
    const fr = { get: () => editor, set: (e) => { editor = e; } };
    const run = new Function('f', 'vm', 'I', '$', 'set', 'fillDelivery', 'fillGrading', 'fr', 'emptyEditor', 'setMode', chunk.replace(/pathMode = (I\.modeOfSetting\(s\));/, 'setMode($1);'));
    run(f, { kinds: [kinds.homework, kinds.preflight] }, I, (id) => el[id], set,
      (v) => { el['i-delivery'].value = v; }, (d, v) => { el['i-grading'].value = v; }, fr, () => ({ questions: [] }), (m) => { mode = m; });
    const setting = { delivery: el['i-delivery'].value, grading: el['i-grading'].value, withTutor: mode === 'both' && el['i-delivery'].value === 'typed_response' };
    return { kind: el['i-kind'].value, card: I.cardOf(kinds[el['i-kind'].value], setting), mode, plan: I.pathPlan({ ...setting, policy: el['i-policy'].value }).map(p => [p.which, p.delivery, p.grading]) };
  }
  const both = land({ withTutor: true, interactiveSlug: 't-1', interactiveUrl: 'https://example.org/t' });
  eq('a link with a tutor (and the written path) lands on the Both card', [both.kind, both.card, both.mode], ['preflight', 'both', 'both']);
  eq('and the pair it would save is the AI-graded typed side plus the tutor', both.plan, [['typed', 'typed_response', 'ai_drafted'], ['tutor', 'interactive_tutor', 'effort']]);
  eq('a link that also names a written-path policy still lands on Both', land({ withTutor: true, policy: 'typed' }).card, 'both');
  const only = land({ withTutor: true, policy: 'tutor', interactiveSlug: 't-1' });
  eq('a link asking for the tutor alone lands on the Interactive tutor card', [only.kind, only.card, only.mode], ['preflight', 'tutor', 'tutor']);
  eq('and saves the tutor alone, graded by effort', only.plan, [['main', 'interactive_tutor', 'effort']]);
  eq('a link with no tutor selects nothing', I.settingForLink({ title: 'x' }), null);
  check('the page applies this only when laying a link over a new form, never to a saved assignment', /if \(lay\) applyLay\(lay\);/.test(script) && /I\.settingForLink\(f\)/.test(script));
  check('a saved assignment given a tutor by a link keeps its own setting (applyOverlay does not set a card)', !/settingForLink/.test(script.slice(script.indexOf('function applyOverlay('), script.indexOf('function clearTutorFile('))));
}

section('what an AI-graded setting still lacks is said plainly');
{
  const ai = { delivery: 'typed_response', grading: 'ai_drafted', withTutor: true };
  const q = (extra) => ({ type: 'free_response', points: 1, role: '', expected_response: '', ...extra });
  const gap = I.aiGuidanceGap(ai, { questions: [q({}), q({ expected_response: 'a good answer' })] });
  check('one question with no description of a good answer is counted', /1 question has none yet/.test(gap) && /description of a good answer/.test(gap));
  check('two are counted', /2 questions have none yet/.test(I.aiGuidanceGap(ai, { questions: [q({}), q({})] })));
  eq('nothing is said when every graded question has one', I.aiGuidanceGap(ai, { questions: [q({ expected_response: 'x' })] }), '');
  eq('nothing is said for the reading-time question', I.aiGuidanceGap(ai, { questions: [q({ role: 'reading_time' })] }), '');
  eq('nothing is said when a person grades', I.aiGuidanceGap({ ...ai, grading: 'human_graded' }, { questions: [q({})] }), '');
  eq('nothing is said with no editor', I.aiGuidanceGap(ai, null), '');
  check('the page shows it in a status box and refreshes it as the questions change', /id="i-ai-gap"[^>]*role="status"/.test(markup) && /onChange: \(\) => renderAiGap\(\)/.test(script) && /renderAiGap\(\);\s*const panel/.test(script));
  check('it never blocks a save (checkForm is not given it)', !/aiGuidanceGap/.test(src.slice(src.indexOf('export function checkForm('), src.indexOf('export function checkForm(') + 3500)));
}

section('a save is not changed: the writing code is untouched by the cards');
{
  check('pathPlan still builds the two paths from delivery and withTutor', /isTypedResponse\(form\.delivery\) && form\.withTutor/.test(src));
  check('the page still sends the tutor fields it always did', ['interactiveSlug', 'interactiveUrl', 'interactiveTitle', 'interactiveDesc', 'swapTutor', 'policy', 'switchPolicy']
    .every(k => script.includes(k + ':')));
  check('every refusal and warning loop is still in save()', ['needsConfirm', 'needsTutorConfirm', 'needsPointsConfirm', 'needsDeadlineConfirm', 'needsUnpublishConfirm'].every(k => script.includes(k)));
  check('the page still never writes a literal publish true', !/is_published:\s*true/.test(script));
  check('the objectives from a file ride on the form and nothing else writes them', /objectives: pendingObjectives/.test(script) && /form\.objectives/.test(src));
  check('a form with no file leaves the objectives alone on a save', /if \(Array\.isArray\(form\.objectives\) && form\.objectives\.length\) aRow\.objectives/.test(src));
}

process.exit(summary() ? 0 : 1);
