// test-faculty-entry.mjs — the read/write layer behind the score entry page (site/js/faculty-entry.js).
// No network, no login. A stub client stands in for the database; ids and names are invented.

import { check, eq, section, installBrowser, summary } from './harness.mjs';
import { readFileSync } from 'node:fs';

installBrowser({ pathname: '/site/faculty/entry.html' });
// faculty-grade.js (imported for the Grade page's own cadet test) binds the page's db at import. The tests below pass their own stub.
globalThis.window.db = { from: () => { throw new Error('the stub client is passed in, not this one'); } };
const E =await import('../../site/js/faculty-entry.js');

const stub = (impl) => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return impl(name, args); } };
};

section('enterGrades: what the database says about the save');
{
  const db = stub(() => ({ data: { saved: 3, replaced_published: 1 }, error: null }));
  const r = await E.enterGrades(db, 'i1', [{ enrollmentId: 'e1', cents: 850, updatedAt: null }, { enrollmentId: 'e2', cents: 1000, updatedAt: 'v' }]);
  eq('saved and replaced are both reported', r, { saved: 3, replacedPublished: 1 });
  eq('scores go as exact text, with the version the page read', db.calls[0][1].p_rows, [
    { enrollment_id: 'e1', points: '8.5', expect: null }, { enrollment_id: 'e2', points: '10', expect: 'v' }]);
}
{
  const db = stub(() => ({ data: null, error: { message: 'x' } }));
  eq('an error comes back as an error', Object.keys(await E.enterGrades(db, 'i1', [])), ['error']);
}

section('writeSummary: a replaced published score is not called a draft');
eq('all drafts', E.writeSummary({ saved: 3, replacedPublished: 0 }), { kind: 'success', text: 'Saved 3 score(s) as drafts.' });
{
  const s = E.writeSummary({ saved: 3, replacedPublished: 2 });
  check('some replaced', s.kind === 'warn' && /2 of them replaced/.test(s.text) && /live to students/.test(s.text) && /1 .*draft/.test(s.text), s.text);
}
{
  const s = E.writeSummary({ saved: 2, replacedPublished: 2 });
  check('all replaced says none are drafts', /live to students/.test(s.text) && !/as drafts/.test(s.text), s.text);
}

section('publishColumn and publishPreview: the answer comes from the database');
{
  const db = stub(() => ({ data: { published: 4, closed: 2, zeroed: 3, held_ai: 1, close_applies: true }, error: null }));
  const r = await E.publishColumn(db, 'i1', 's1', 'fp-1');
  eq('counts are passed through', r, { published: 4, closed: 2, zeroed: 3, heldAi: 1, closeApplies: true });
  eq('the page sends the preview fingerprint and does not choose to close', db.calls[0], ['publish_column', { p_offering: 'i1', p_section: 's1', p_fingerprint: 'fp-1' }]);
}
{
  const db = stub(() => ({ data: { item_published: false, hand_entered: true, drafts: 2, held_ai: 0, live: 0, close_applies: true, open_sections: 2, sections: 2,
    blank_count: 1, blank_cadets: [{ enrollment_id: 'e1', section_id: 's1' }], waiting_count: 1, fingerprint: 'fp-2', publish_closed_sections: 0, hand_closed_sections: 1 }, error: null }));
  const r = await E.publishPreview(db, 'i1', null);
  eq('the preview is camel-cased and nothing is computed', r.preview, { itemPublished: false, handEntered: true, drafts: 2, heldAi: 0, live: 0, closeApplies: true, openSections: 2, sections: 2,
    blankCount: 1, blankCadets: [{ enrollment_id: 'e1', section_id: 's1' }], waitingCount: 1, fingerprint: 'fp-2', publishClosedSections: 0, handClosedSections: 1 });
}
{
  const db = stub(() => ({ data: null, error: { message: 'boom' } }));
  check('a failed preview is an error, not an empty preview', !!(await E.publishPreview(db, 'i1', null)).error);
}
{
  const db = stub(() => ({ data: { unpublished: 3, reopened: 2, kept_closed: 1 }, error: null }));
  eq('unpublish returns the counts, including the columns it left closed', await E.unpublishColumn(db, 'i1', null), { unpublished: 3, reopened: 2, keptClosed: 1 });
  eq('and reopens by default', db.calls[0], ['unpublish_column', { p_offering: 'i1', p_section: null, p_reopen: true }]);
}

section('publishSummary: publishing nothing is not success');
{
  const s = E.publishSummary({ published: 0, closed: 0, heldAi: 0, closeApplies: false });
  check('nothing at all', s.kind === 'info' && /Nothing was published/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 0, closed: 0, heldAi: 2, closeApplies: true });
  check('only AI drafts, and they are named', s.kind === 'warn' && /2 AI-suggested/.test(s.text) && /grade page/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 3, closed: 2, heldAi: 0, closeApplies: true });
  check('a real publish', s.kind === 'success' && /Published 3/.test(s.text) && /closed 2/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 3, closed: 0, heldAi: 1, closeApplies: true });
  check('a real publish that left an AI draft out says so', s.kind === 'warn' && /Published 3/.test(s.text) && /1 AI-suggested/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 0, closed: 2, heldAi: 0, closeApplies: true });
  check('closing alone is reported as closing', s.kind === 'success' && /closed 2/.test(s.text) && /No scores needed/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 1, closed: 1, zeroed: 4, heldAi: 0, closeApplies: true });
  check('the number of blanks that now count as 0 is said', /4 blank score\(s\) now count as 0/.test(s.text), s.text);
}
{
  check('a changed column gets its own sentence', /changed after the preview/.test(E.plainEntryError({ code: '40001', message: 'publish_column: the column changed since you read the preview; read it again' })));
  check('and so does a publish that skipped the preview', /preview was not confirmed/.test(E.plainEntryError({ message: 'publish_column: this publish would count 3 blank score(s) as 0; read the preview and confirm it first' })));
}

section('afterWrite: a saved change is not hidden by a failed reload');
{
  const ok = { kind: 'success', text: 'Saved 2 score(s) as drafts.' };
  const good = E.afterWrite(ok, { sections: [], items: [] });
  eq('a good reload keeps the data and the note', [!!good.vm, good.banners], [true, [ok]]);
  const bad = E.afterWrite(ok, { error: { message: 'Failed to fetch' } });
  eq('a failed reload keeps no stale data', bad.vm, null);
  check('and still says the save succeeded', bad.banners[0].kind === 'success' && /Saved 2/.test(bad.banners[0].text));
  check('and says the read failed, plainly', bad.banners[1].kind === 'error' && /could not be read back/.test(bad.banners[1].text) && /Reload/.test(bad.banners[1].text), bad.banners[1].text);
}

section('plainEntryError: words for the new refusals');
check('not a plain number', /not a plain number|out of range|cannot be read/i.test(E.plainEntryError({ message: 'enter_grades: a score is not a plain number' })));
check('item not published', /not published to students/.test(E.plainEntryError({ message: 'publish_column: this item is not published to students yet, so publishing its scores would show them nothing' })));
check('not hand entered', /grade page/.test(E.plainEntryError({ message: 'publish_column: this item is not entered by hand or by import; its scores are published from the grade page' })));
check('too large', /out of range/.test(E.plainEntryError({ message: 'enter_grades: a score is too large' })));

section('shapeEntryItem: no second rule about closing');
{
  const it = E.shapeEntryItem({ id: 'i', points_possible: '10.00', is_published: false, offering_activities: [{ delivery: 'in_person', grading: 'hand_entered' }], assignments: { title: 'Q', slug: 'q' } });
  check('the item says whether students can see it', it.published === false);
  check('and carries no copy of the closing rule', !('noSubmission' in it) && !('takesNoSubmission' in E));
}

/* ── The list of assignments to grade (Change C, 2026-11-06) ───────────────────── */
section('openWith: the one rule that decides where an assignment is graded');
{
  const hand = [{ delivery: 'in_person', grading: 'hand_entered' }];
  const imp = [{ delivery: 'elsewhere', grading: 'imported' }];
  const typed = [{ delivery: 'typed_response', grading: 'ai_drafted' }];
  const human = [{ delivery: 'typed_response', grading: 'human_graded' }];
  const auto = [{ delivery: 'online_questions', grading: 'auto_checked' }];
  const both = [{ delivery: 'typed_response', grading: 'human_graded' }, { delivery: 'interactive_tutor', grading: 'effort' }];
  eq('typed in by staff opens the table', E.openWith(hand), 'table');
  eq('imported opens the table', E.openWith(imp), 'table');
  eq('a response read one answer at a time opens the grade page', E.openWith(typed), 'review');
  eq('graded by a person opens the grade page', E.openWith(human), 'review');
  eq('checked automatically has nothing for a person to grade', E.openWith(auto), 'auto');
  eq('a choice with no hand-entered path opens the grade page', E.openWith(both), 'review');
  eq('a choice with a hand-entered path opens the table', E.openWith([...human, ...hand]), 'table');
  eq('no paths opens the grade page', E.openWith([]), 'review');
  const src = readFileSync(new URL('../../site/js/faculty-entry.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function openWith'), src.indexOf('export function openWith') + 400);
  check('the rule reads delivery and grading and never the kind', !/kind/.test(fn.replace(/\/\/.*$/gm, '')), fn);
}

section('buildGradeList: counts come from the database cells; nothing is added up from scores');
{
  const mk = (id, over = {}) => ({ id, title: id.toUpperCase(), dueAt: '2026-11-01T00:00:00Z', published: true, paths: [{ delivery: 'in_person', grading: 'hand_entered' }], ...over });
  const cell = (item, over) => ({ assignment_offering_id: item, section_id: 's1', state: 'graded', ...over });
  const cells = [
    cell('a', { has_draft_score: true, state: 'submitted_ungraded' }), cell('a', { has_draft_score: true, state: 'submitted_ungraded' }),
    cell('a', { no_work_received: true, state: 'submitted_ungraded' }),
    cell('b', {}), cell('b', {}),
    cell('d', { state: 'submitted_ungraded' }),
    cell('e', { deadline_invalid: true }),
  ];
  const r = E.buildGradeList({ items: [mk('a'), mk('b'), mk('c', { published: false }), mk('d', { paths: [{ delivery: 'typed_response', grading: 'ai_drafted' }] }), mk('e')], cells, aiCounts: { d: 3 } });
  const by = Object.fromEntries(r.map(x => [x.id, x]));
  eq('waiting for approval is the database draft count', by.a.waiting, 2);
  eq('no score yet is the database no-work count', by.a.noScore, 1);
  check('a fully graded assignment is finished', by.b.finished === true && by.b.waiting === 0 && by.b.noScore === 0);
  check('an unpublished assignment is not finished, and says so', by.c.finished === false && by.c.notPublished === true);
  eq('AI drafts that need a person are counted on the row', by.d.aiDrafts, 3);
  check('a row with AI drafts is not finished', by.d.finished === false);
  eq('work handed in and not graded is counted apart', by.d.toGrade, 1);
  check('an assignment whose date cannot be worked out is flagged, not finished', by.e.finished === false && by.e.badDate === 1);
  eq('table work opens the table, review work opens the grade page', [by.a.opensWith, by.d.opensWith], ['table', 'review']);
  eq('the order is unfinished first, then by due date', r.map(x => x.id).slice(0, 4).sort(), ['a', 'c', 'd', 'e']);
  eq('plain words for how it is graded', [by.a.howGraded, by.d.howGraded], ['Scores typed in by staff', 'Free response: AI drafts overnight, a person reviews']);
}

section('review fix 1: a table assignment with scores not entered is unfinished whatever its date');
{
  const tablePaths = [{ delivery: 'in_person', grading: 'hand_entered' }];
  const enr = [{ id: 'e1', section_id: 's1', status: 'active' }, { id: 'e2', section_id: 's1', status: 'completed' },
    { id: 'e3', section_id: 's1', status: 'dropped' }, { id: 'e4', section_id: 's2', status: 'active' }, { id: 'e5', section_id: 's1', status: 'active' }];
  const items = [{ id: 'a', paths: tablePaths }, { id: 'r', paths: [{ delivery: 'typed_response', grading: 'human_graded' }] }];
  const u = E.countUnentered({ items, enrollments: enr,
    grades: [{ enrollment_id: 'e1', assignment_offering_id: 'a', points_earned: '2.00' }],
    excusals: [{ enrollment_id: 'e5', assignment_offering_id: 'a' }], closures: [{ section_id: 's2', assignment_offering_id: 'a' }] });
  eq('counted cadets only; a score, an excusal or a closed section removes a cadet; review work is not counted here', u, { a: 1 });
  const rows = E.buildGradeList({ items: [{ id: 'a', title: 'A', dueAt: '2099-01-01T00:00:00Z', published: true, paths: tablePaths }], cells: [], unentered: { a: 3 } });
  check('a published table item due in the future with no scores is NOT finished', rows[0].finished === false && rows[0].notEntered === 3);
  eq('the words say the scores are not entered yet', E.waitingParts(rows[0]), ['3 cadets have no score entered yet']);
  const both = E.waitingParts({ notEntered: 3, noScore: 2 });
  eq('the overdue count stays its own line', both, ['3 cadets have no score entered yet', '2 cadets with no score are past the due date']);
  const done = E.buildGradeList({ items: [{ id: 'a', title: 'A', dueAt: null, published: true, paths: tablePaths }], cells: [], unentered: { a: 0 } });
  check('with every score entered it is finished', done[0].finished === true);
  const html = readFileSync(new URL('../../site/faculty/entry.html', import.meta.url), 'utf8');
  check('the empty-state wording no longer claims more than the list checks', !/Every assignment is fully graded/.test(html) && /Nothing is waiting/.test(html));
}

section('review fix 2: AI drafts are counted over the set the Grade page works on, and can be reached');
{
  const W = 'w1', T = 't1';
  const aiPaths = [{ grading: 'ai_drafted', activity_id: W, activities: { modality: 'written' } }, { grading: 'effort', activity_id: T, activities: { modality: 'interactive' } }];
  const items = [{ id: 'a', paths: aiPaths }, { id: 'h', paths: [{ grading: 'human_graded', activity_id: 'x', activities: { modality: 'written' } }] }];
  const enr = [{ id: 'e1', status: 'active' }, { id: 'e2', status: 'dropped' }, { id: 'e3', status: 'active' }, { id: 'e4', status: 'completed' }, { id: 'e5', status: 'active' }];
  const g = (e, i, over = {}) => ({ enrollment_id: e, assignment_offering_id: i, source: 'ai_suggested', is_finalized: false, ...over });
  const grades = [g('e1', 'a'), g('e2', 'a'), g('e3', 'a'), g('e4', 'a'), g('e5', 'a', { is_finalized: true }), g('e1', 'h'), g('e1', 'a', { source: 'instructor' })];
  const submissions = [{ enrollment_id: 'e3', assignment_offering_id: 'a', chosen_activity_id: T }, { enrollment_id: 'e4', assignment_offering_id: 'a', chosen_activity_id: W }];
  eq('dropped, tutor-path, finalized, other-source and non-AI-path rows are left out', E.countAiDrafts({ items, enrollments: enr, grades, submissions }), { a: 2 });
  const src = readFileSync(new URL('../../site/js/faculty-entry.js', import.meta.url), 'utf8');
  check('it uses the Grade page\'s own test rather than a second rule', /isEffortGraded/.test(src) && /from '\.\/faculty-grade\.js'/.test(src));
  const rows = E.buildGradeList({ items: [{ id: 'a', title: 'A', dueAt: null, published: true, paths: [...aiPaths, { grading: 'hand_entered' }] }], cells: [], aiCounts: { a: 2 } });
  check('a table item that also holds AI drafts offers the review route too', rows[0].opensWith === 'table' && rows[0].alsoReview === true);
  const rv = E.buildGradeList({ items: [{ id: 'a', title: 'A', dueAt: null, published: true, paths: aiPaths }], cells: [], aiCounts: { a: 2 } });
  check('a review item has its own button and no extra one', rv[0].opensWith === 'review' && rv[0].alsoReview === false);
  const html = readFileSync(new URL('../../site/faculty/entry.html', import.meta.url), 'utf8');
  check('the page draws the extra review link', /r\.alsoReview/.test(html));
}

section('review fix 4: switching assignment does not drop typed scores silently');
{
  const html = readFileSync(new URL('../../site/faculty/entry.html', import.meta.url), 'utf8');
  const at = html.indexOf("$('f-item').onchange");
  const h = html.slice(at, at + 700);
  check('the select change asks first, with the Back button\'s wording', /confirm\(UNSAVED_LOSE\)/.test(h) && /gridInputs\(\)/.test(h), h);
  check('and puts the select back when the person cancels', /e\.target\.value = itemId/.test(h), h);
  check('the Back button uses the same question', /confirm\(UNSAVED_LOSE\)/.test(html.slice(html.indexOf("$('back-btn').onclick"), html.indexOf("$('back-btn').onclick") + 300)));
}

section('waitingParts: plain words, singular and plural');
{
  eq('nothing waiting says nothing', E.waitingParts({}), []);
  eq('one of each reads as one', E.waitingParts({ waiting: 1, noScore: 1, aiDrafts: 1 }),
    ['1 score is drafted and waiting for approval', '1 AI-suggested draft needs a person to review', '1 cadet with no score is past the due date']);
  check('several read as several', E.waitingParts({ waiting: 4, noScore: 2, toGrade: 3 }).join('|').includes('4 scores are drafted') && E.waitingParts({ noScore: 2 })[0] === '2 cadets with no score are past the due date');
  eq('not published comes first', E.waitingParts({ notPublished: true, noScore: 1 })[0], 'Not published to cadets yet');
}

section('loadGradeList: a failed read is an error, never an empty list');
{
  const chain = (result) => { const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, range: async () => result, then: (f, r) => Promise.resolve(result).then(f, r) }; return q; };
  const dbItemsFail = { from: (t) => chain(t === 'assignment_offerings' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }), rpc: () => chain({ data: [], error: null }) };
  const a = await E.loadGradeList(dbItemsFail, 'co1');
  check('items read fails -> { error }', !!a.error && !a.items);
  const itemRow = { id: 'a', is_published: true, due_at: null, position: 1, assignments: { slug: 'a', title: 'A' }, offering_activities: [] };
  const cellsFail = { from: (t) => chain({ data: t === 'assignment_offerings' ? [itemRow] : [], error: null }), rpc: () => { const q = { order: () => q, range: async () => ({ data: null, error: { message: 'cells down' } }) }; return q; } };
  const b = await E.loadGradeList(cellsFail, 'co1');
  check('cells read fails -> { error }', !!b.error && !b.items);
  const aiFail = { from: (t) => chain(t === 'grades' ? { data: null, error: { message: 'grades down' } } : { data: t === 'assignment_offerings' ? [itemRow] : [], error: null }), rpc: () => { const q = { order: () => q, range: async () => ({ data: [], error: null }) }; return q; } };
  const c = await E.loadGradeList(aiFail, 'co1');
  check('AI-draft read fails -> { error }', !!c.error && !c.items);
  for (const table of ['enrollments', 'submissions', 'grade_excusals', 'column_closures']) {
    const bad = { from: (t) => chain(t === table ? { data: null, error: { message: `${table} down` } } : { data: t === 'assignment_offerings' ? [itemRow] : t === 'sections' ? [{ id: 's1' }] : [], error: null }), rpc: () => { const q = { order: () => q, range: async () => ({ data: [], error: null }) }; return q; } };
    const r = await E.loadGradeList(bad, 'co1');
    check(`a failed ${table} read is an error, not a short list`, !!r.error && !r.items);
  }
  const ok = { from: (t) => chain({ data: t === 'assignment_offerings' ? [itemRow] : [], error: null }), rpc: () => { const q = { order: () => q, range: async () => ({ data: [], error: null }) }; return q; } };
  const d = await E.loadGradeList(ok, 'co1');
  check('a good read returns the rows', !d.error && d.items.length === 1 && d.items[0].finished === true, JSON.stringify(d));
}

process.exit(summary() ? 0 : 1);
