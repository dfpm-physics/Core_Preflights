// test-faculty-terms.mjs — the courses-and-terms page's data layer (site/js/faculty-terms.js), and the
// guard on hardcoded course lists (finding E30).
//
// WHAT THIS DEFENDS
//   * Rollover is a COPY of design: it writes only to the tables that hold design, never to the tables
//     that hold people or work, never changes the source, and never publishes.
//   * Lineage: every copied assignment names its source in origin_assignment_id; a second run skips what
//     is already copied.
//   * Keys are copied unchecked, as version 1. A tutor activity is copied without its link and with a new id.
//   * Dates are never carried silently: blank by default, or shifted by calendar days in Mountain time,
//     keeping the clock time across a daylight-saving change.
//   * An offering's active flag is always stated by the caller, never defaulted.
//   * No course code is hardcoded where it would hide or break a new course (an allowlist of three
//     harmless fallbacks; any other occurrence in code fails this test).
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db: it shows what the shipped module asks for, not that the
//   database accepts it. tests/browser-harness/v2-terms.mjs does that on staging with a real browser.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/terms.html' });

let CALLS = [];
let SEQ = 0;
let FAIL = null;       // { table, verb } -> an error for that write
let OVERRIDE = {};     // 'table.verb' -> a whole { data, count, error } result

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {} };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'range'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = () => c;
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { state.verb = verb; state.payload = payload; CALLS.push({ table, verb, payload, filters: state.filters }); return c; };
  const result = (mode) => {
    const ov = OVERRIDE[`${table}.${state.verb}`];
    if (ov !== undefined) return typeof ov === 'function' ? ov(state, mode) : ov;
    if (FAIL && FAIL.table === table && FAIL.verb === state.verb) return { data: null, error: FAIL.error };
    if (state.verb === 'insert') {
      const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
      const made = rows.map(r => ({ id: `${table}-${++SEQ}`, qid: r.qid }));
      return { data: mode === 'many' ? made : made[0], error: null };
    }
    if (mode === 'maybe' && table === 'course_offerings') return { data: { id: 'offering-new' }, error: null };
    return { data: mode === 'many' ? [] : null, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};
let RPCS = [];
let RPC_RESULT = null;
globalThis.window.db = { from: stubFrom, rpc: (fn, args) => { RPCS.push({ fn, args }); return Promise.resolve(RPC_RESULT || { data: 2, error: null }); } };
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const T = await import('../../site/js/faculty-terms.js');
const db = window.db;
const reset = () => { CALLS = []; SEQ = 0; FAIL = null; OVERRIDE = {}; RPCS = []; RPC_RESULT = null; };
const writes = () => CALLS.filter(c => c.verb !== 'select');
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the three small forms');
{
  eq('a good course passes', T.checkCourse({ code: 'phys-310', title: 'Physics 310' }), []);
  check('a course code with capitals or spaces is refused', T.checkCourse({ code: 'Phys 310', title: 'x' }).length === 1);
  check('a course with no title is refused', T.checkCourse({ code: 'phys-310', title: ' ' }).length === 1);
  eq('a good term passes', T.checkTerm({ code: 'spring-2027', label: 'Spring 2027', startsOn: '2027-01-06', endsOn: '2027-05-14' }), []);
  check('a term that ends before it starts is refused',
    T.checkTerm({ code: 'spring-2027', label: 'x', startsOn: '2027-05-14', endsOn: '2027-01-06' }).length === 1);
  check('a term with an impossible date is refused', T.checkTerm({ code: 'spring-2027', label: 'x', startsOn: '2027-02-30' }).length === 1);
  check('an offering must say active or inactive (undefined is refused)',
    T.checkOffering({ courseId: 'c', termId: 't' }).length === 1);
  eq('an offering that says inactive passes', T.checkOffering({ courseId: 'c', termId: 't', isActive: false }), []);
}

section('plain sentences for the database refusals');
{
  const one = T.termsError({ message: 'duplicate key value violates unique constraint "course_offerings_one_active"', code: '23505' });
  check('a second active offering is a sentence about one active term', /only one term of a course can be active/.test(one), one);
  check('...and does not leak the constraint name', !/course_offerings_one_active/.test(one));
  check('a second offering in a term says so', /already has an offering in that term/.test(T.termsError({ message: 'violates "course_offerings_unique"' })));
  check('a duplicate course code says so', /course with that code already exists/.test(T.termsError({ message: 'violates "courses_code_key"' })));
  check('a row-level refusal names the administrator', /site administrator/.test(T.termsError({ code: '42501', message: 'x' })));
  const lost = T.termsError({ message: 'TypeError: Failed to fetch' });
  check('a dropped connection says it is not known what was written (B2 S1)', /connection dropped/.test(lost) && /not known/.test(lost) && !/database refused/.test(lost), lost);
  check('a clash during a partly finished run does not claim nothing changed', !/Nothing was changed/.test(T.termsError({ code: '23505', message: 'x' }, { partial: true })) && /Nothing was changed/.test(T.termsError({ code: '23505', message: 'x' })));
  check('a refusal the database worded for a person passes through without its function name',
    T.termsError({ code: '22023', message: 'save_letter_scale: A letter must be 1 to 8 characters. Nothing was saved.' }) === 'A letter must be 1 to 8 characters. Nothing was saved.');
}

section('shifting a date: calendar days in Mountain time, same clock time');
{
  const dec = '2026-12-11T06:59:59Z';        // 10 Dec 2026, 23:59:59 Mountain (standard time)
  eq('seven days later keeps 23:59:59', T.shiftInstant(dec, 7), '2026-12-18T06:59:59.000Z');
  eq('across the spring change the UTC hour moves but the clock time does not', T.shiftInstant(dec, 126), '2027-04-16T05:59:59.000Z');
  eq('a negative shift moves earlier', T.shiftInstant('2027-04-16T05:59:59Z', -126), '2026-12-11T06:59:59.000Z');
  eq('a zero shift is the same instant', T.shiftInstant(dec, 0), '2026-12-11T06:59:59.000Z');
  eq('null stays null', T.shiftInstant(null, 7), null);
  eq('a map is shifted value by value, and a JSON null stays', T.shiftDueByDay({ M: dec, T: null }, 7), { M: '2026-12-18T06:59:59.000Z', T: null });
  eq('an empty map stays empty', T.shiftDueByDay({}, 7), {});
  check('blank dates need no number', T.checkRolloverOptions({ dates: 'blank' }).length === 0);
  check('a shift needs a whole number', T.checkRolloverOptions({ dates: 'shift', days: '1.5' }).length === 1);
  for (const bad of ['1e2', '0x10', '7.0', '0', '+0', '-0', ' ', 'abc', '123456'])
    check(`a shift of "${bad}" is refused`, T.checkRolloverOptions({ dates: 'shift', days: bad }).length === 1, bad);
  for (const good of ['126', '-7', '+14', ' 30 '])
    check(`a shift of "${good}" is accepted`, T.checkRolloverOptions({ dates: 'shift', days: good }).length === 0, good);
  check('the sentence for a zero shift says dates are never copied as they are', /never copied as they are/.test(T.checkRolloverOptions({ dates: 'shift', days: '0' })[0]));
  check('a shift with nothing typed is refused', T.checkRolloverOptions({ dates: 'shift', days: '' }).length === 1);
  check('no choice at all is refused', T.checkRolloverOptions({}).length === 1);
}

section('slugs');
{
  const taken = new Set(['preflight-02', 'preflight-02-spring-2027']);
  const rand = () => 'abcd';
  eq('a copy is qualified by the term', T.copySlug('preflight-03', 'spring-2027', taken, rand), 'preflight-03-spring-2027');
  eq('a taken qualified slug gets a tail', T.copySlug('preflight-02', 'spring-2027', taken, rand), 'preflight-02-spring-2027-abcd');
  check('the set is extended, so two copies cannot collide', taken.has('preflight-03-spring-2027'));
  eq('a tutor id keeps its stem and takes new hex', T.copyTutorSlug('lesson-02-charge-a3f9c1e2', 'x', () => '12345678'), 'lesson-02-charge-12345678');
}

/* ── a fixture: two items, one with questions and a checked key, one tutor with a link ─────── */
const DEC = '2026-12-11T06:59:59Z';
function fixture({ targetDone = [], targetScale = null, srcScale = { lines: [['A', 90]], near_line_width: 0.1 }, targetPaths = 1, targetActive = false } = {}) {
  const item = (n, extra = {}) => ({
    id: `ao-${n}`, assignment_id: `as-${n}`, points_possible: 2, grading_mode: 'points', switch_policy: 'lock_on_commit',
    position: n, late_allowed: true, is_bonus: false, allow_over_max: false, prog_included: true, attempt_limit: null,
    attempt_rule: 'best', is_group_work: false, entered_on_new_page: true, is_published: true,
    due_at: DEC, opens_at: null, grades_release_at: null, due_by_day: { M: DEC, T: null },
    assignments: { id: `as-${n}`, course_id: 'course-1', kind_id: 'homework', slug: `hw-${n}`, title: `Homework ${n}`, description: null, objectives: [] },
    assignment_due_dates: [{ section_id: 'sec-m1', due_at: DEC }, { section_id: 'sec-gone', due_at: DEC }],
    offering_activities: [], ...extra,
  });
  const a = item(1, { offering_activities: [{ activity_id: 'act-1', grading_role: 'graded', available_after: 'always', is_visible: true,
    position: 0, delivery: 'online_questions', grading: 'auto_checked', warn_earns_full: null,
    activities: { id: 'act-1', modality: 'written', slug: 'old-written', title: 'Homework 1', content: {}, position: 0 } }] });
  const b = item(2, { offering_activities: [{ activity_id: 'act-2', grading_role: 'graded', available_after: 'always', is_visible: true,
    position: 0, delivery: 'interactive_tutor', grading: 'effort', warn_earns_full: null,
    activities: { id: 'act-2', modality: 'interactive', slug: 'lesson-02-charge-a3f9c1e2', title: 'Tutor', content: { artifact_url: 'https://example.invalid/x' }, position: 0 } }] });
  const questions = new Map([['act-1', [
    { id: 'q-1', activity_id: 'act-1', qid: 'Q1', position: 0, prompt_md: 'p', figure_url: null, unit_hint: null, is_retired: false, format: 'numeric', choices: null, points: 2 },
    { id: 'q-2', activity_id: 'act-1', qid: 'Q2', position: 1, prompt_md: 'gone', is_retired: true, format: 'numeric', points: 1 },
  ].filter(q => !q.is_retired)]]);
  const keys = new Map([['q-1', [{ id: 'k-1', question_id: 'q-1', variant_key: '', version: 4, value: 9.8, tol_abs: 0.1, tol_pct: null, sig_figs: null,
    sig_fig_mode: 'ignore', unit: 'm/s', unit_aliases: null, unit_mode: 'ignore', reference_text: null, written_by: 'human', select_rule: 'all_or_nothing',
    correct_choice_ids: null, checked_by: 'someone', checked_at: '2026-10-01T00:00:00Z', superseded_at: null }]]]);
  const lineage = [
    { id: 'as-1', slug: 'hw-1', title: 'Homework 1', origin_assignment_id: null, assignment_offerings: [{ id: 'ao-1' }] },
    { id: 'as-2', slug: 'hw-2', title: 'Homework 2', origin_assignment_id: null, assignment_offerings: [{ id: 'ao-2' }] },
    ...targetDone.map(id => ({ id: `t-${id}`, slug: `t-${id}-slug`, title: 'Renamed in the target', origin_assignment_id: id, assignment_offerings: [{ id: `tao-${id}` }] })),
  ];
  const src = { offering: { id: 'co-fall', courseId: 'course-1', courseCode: 'c-1', courseTitle: 'Course', termCode: 'fall-2026', termLabel: 'Fall 2026' },
    items: [a, b], sections: [{ id: 'sec-m1', code: 'M1' }, { id: 'sec-gone', code: 'GONE' }], takenSlugs: ['hw-1', 'hw-2'], lineage,
    scale: srcScale, questions, keys };
  const tgt = { offering: { id: 'co-spring', courseId: 'course-1', courseCode: 'c-1', courseTitle: 'Course', termCode: 'spring-2027', termLabel: 'Spring 2027', isActive: targetActive },
    items: targetDone.map(id => ({ id: `tao-${id}`, assignments: { id: `t-${id}`, origin_assignment_id: id },
      offering_activities: Array.from({ length: targetPaths }, () => ({})) })), sections: [{ id: 'tsec-m1', code: 'M1' }],
    takenSlugs: [], lineage, scale: targetScale, questions: new Map(), keys: new Map() };
  return { src, tgt };
}
const rand = () => 'deadbeef';

section('the plan: what would be copied');
{
  const { src, tgt } = fixture();
  const blank = T.buildRolloverPlan(src, tgt, { dates: 'blank' }, rand);
  eq('no problems', blank.problems, []);
  eq('both items are to be copied', [blank.toCopy, blank.skipped], [2, 0]);
  eq('counts', blank.counts, { items: 2, activities: 2, questions: 1, keys: 1 });
  const [p1, p2] = blank.items;
  eq('the copy names its source (lineage)', p1.assignment.origin_assignment_id, 'as-1');
  eq('the copy is in the target course', p1.assignment.course_id, 'course-1');
  eq('the slug is qualified by the target term', p1.slug, 'hw-1-spring-2027');
  eq('the copy is never published', p1.offering.is_published, false);
  eq('dates are blank by default', [p1.offering.due_at, p1.offering.due_by_day, p1.dueRows], [null, {}, []]);
  eq('the key is version 1', p1.activities[0].questions[0].key[0].version, 1);
  eq('the key is unchecked', [p1.activities[0].questions[0].key[0].checked_by, p1.activities[0].questions[0].key[0].checked_at], [null, null]);
  eq('the key value is carried', p1.activities[0].questions[0].key[0].value, 9.8);
  eq('a retired question is not copied', p1.activities[0].questions.length, 1);
  eq('the tutor link is removed', p2.activities[0].activity.content.artifact_url, null);
  eq('the tutor gets a new id with its stem', p2.activities[0].activity.slug, 'lesson-02-charge-deadbeef');
  check('the tutor copy says it has no link and where to set one', p2.notes.some(n => /without its link, under a new tutor id/.test(n) && /assignments page/.test(n)));
  check('a written path gets a fresh generated slug, not the old one', p1.activities[0].activity.slug !== 'old-written' && /^c-1-hw-1-spring-2027-written-/.test(p1.activities[0].activity.slug));
  check('a published source item is noted as unpublished in the copy', p1.notes.some(n => /copy is unpublished/.test(n)));
  eq('the letter scale is to be copied', blank.scale, 'copy');

  const shifted = T.buildRolloverPlan(src, tgt, { dates: 'shift', days: '7' }, rand);
  eq('a shift moves due_at', shifted.items[0].offering.due_at, '2026-12-18T06:59:59.000Z');
  eq('...and each day in the map, leaving a JSON null alone', shifted.items[0].offering.due_by_day, { M: '2026-12-18T06:59:59.000Z', T: null });
  eq('a section row follows its section code into the new term', shifted.items[0].dueRows, [{ section_id: 'tsec-m1', due_at: '2026-12-18T06:59:59.000Z' }]);
  check('a section with no match is reported, not guessed', shifted.items[0].notes.some(n => /No section GONE/.test(n)));

  const again = T.buildRolloverPlan(...Object.values(fixture({ targetDone: ['as-1'] })), { dates: 'blank' }, rand);
  eq('an item already copied is skipped', [again.toCopy, again.skipped], [1, 1]);
  check('...and says so', again.items[0].alreadyDone && /Already in this offering/.test(again.items[0].notes[0]));

  const has = T.buildRolloverPlan(...Object.values(fixture({ targetScale: { lines: [] } })), { dates: 'blank' }, rand);
  eq('a target that has a scale keeps it', has.scale, 'target-has-one');

  const f = fixture();
  check('copying an offering onto itself is refused', T.buildRolloverPlan(f.src, { ...f.src }, { dates: 'blank' }).problems.length === 1);
  const other = fixture(); other.tgt.offering.courseId = 'course-2';
  check('copying between two different courses is refused', T.buildRolloverPlan(other.src, other.tgt, { dates: 'blank' }).problems.length === 1);
  check('no date choice means no plan', T.buildRolloverPlan(f.src, f.tgt, {}).problems.length === 1);
}

section('lineage follows the whole chain, and a half-built copy is never taken for a whole one (B2 S1, S2)');
{
  const plan = (f, o = { dates: 'blank' }) => T.buildRolloverPlan(f.src, f.tgt, o, rand);
  // Second generation: Fall A -> Spring A' (origin A) -> Fall 2027 A'' (origin A'); now Fall 2026 is rolled into Fall 2027.
  let f = fixture();
  f.tgt.items = [{ id: 'tao-2', assignments: { id: 'z-2', origin_assignment_id: 'z-1' }, offering_activities: [{}] }];
  f.src.lineage = f.tgt.lineage = [...f.src.lineage,
    { id: 'z-1', slug: 'hw-1-spring', title: 'x', origin_assignment_id: 'as-1', assignment_offerings: [{ id: 'q' }] },
    { id: 'z-2', slug: 'hw-1-spring-fall', title: 'y', origin_assignment_id: 'z-1', assignment_offerings: [{ id: 'r' }] }];
  let p = plan(f);
  eq('a copy of a copy is recognised: the original is not copied a third time', [p.toCopy, p.skipped], [1, 1]);
  // Backward: Spring's A' (origin A) is rolled into Fall, which still holds A.
  f = fixture();
  f.src.items = [{ ...f.src.items[0], assignment_id: 'sp-1', assignments: { ...f.src.items[0].assignments, id: 'sp-1', slug: 'hw-1-spring-2027' } }];
  f.tgt.items = [{ id: 'tao-a', assignments: { id: 'as-1', origin_assignment_id: null }, offering_activities: [{}] }];
  f.src.lineage = f.tgt.lineage = [{ id: 'as-1', slug: 'hw-1', title: 'a', origin_assignment_id: null, assignment_offerings: [{ id: 'a' }] },
    { id: 'sp-1', slug: 'hw-1-spring-2027', title: 'a', origin_assignment_id: 'as-1', assignment_offerings: [{ id: 'b' }] }];
  p = plan(f);
  eq('a roll back to the term the item came from copies nothing', [p.toCopy, p.skipped], [0, 1]);
  // Retitled
  p = plan(fixture({ targetDone: ['as-1'] }));
  check('a retitled copy is still recognised (the title never enters into it)', p.items[0].alreadyDone && p.toCopy === 1);
  // Half built: the lineage is there but the paths are not
  p = plan(fixture({ targetDone: ['as-1'], targetPaths: 0 }));
  check('a copy with fewer paths than its source is NOT counted as already copied', !p.items[0].alreadyDone && p.items[0].blocked, JSON.stringify(p.items[0]));
  check('...it is held back, not copied a second time, and says what to do', p.toCopy === 1 && p.blocked === 1 && /not whole/.test(p.items[0].notes[0]) && /assignments page/.test(p.items[0].notes[0]));
  // Orphan: an assignment with lineage and no offering at all
  f = fixture();
  f.src.lineage = f.tgt.lineage = [...f.src.lineage,
    { id: 'orph-1', slug: 'hw-1-spring-2027-dead', title: 'x', origin_assignment_id: 'as-1', assignment_offerings: [] }];
  p = plan(f);
  check('a leftover assignment with no offering holds its source item back and is named', p.items[0].blocked && /no offering/.test(p.items[0].notes[0]) && /hw-1-spring-2027-dead/.test(p.items[0].notes[0]));
  check('...while the other item is still copied', p.toCopy === 1 && !p.items[1].blocked);
}

section('dates on a shift: an empty per-day map on a two-track course is not copied forward (B2 S6)');
{
  const f = fixture();
  f.src.sections = [{ id: 'sec-m1', code: 'M1', meeting_days: ['M'] }, { id: 'sec-t1', code: 'T1', meeting_days: ['T'] }];
  f.tgt.sections = [{ id: 'tsec-m1', code: 'M1', meeting_days: ['M'] }, { id: 'tsec-t1', code: 'T1', meeting_days: ['T'] }];
  f.src.items[0] = { ...f.src.items[0], due_by_day: {}, assignment_due_dates: [] };
  const p = T.buildRolloverPlan(f.src, f.tgt, { dates: 'shift', days: '7' }, rand);
  eq('the item with one main date and no per-day dates gets BLANK dates', [p.items[0].offering.due_at, p.items[0].offering.due_by_day, p.items[0].dueRows], [null, {}, []]);
  check('...with a note that names why and where to fix it', /M-day and T-day/.test(p.items[0].notes.join(' ')) && /assignments page/.test(p.items[0].notes.join(' ')));
  eq('...and the dry run says blank, not a plausible date', p.items[0].dueText, 'blank (see note)');
  eq('the item that does have a per-day map is shifted as before', p.items[1].offering.due_at, '2026-12-18T06:59:59.000Z');
  // The same item on a one-track course is shifted: there the empty map is not the trap.
  const g = fixture();
  g.src.items[0] = { ...g.src.items[0], due_by_day: {}, assignment_due_dates: [] };
  const q = T.buildRolloverPlan(g.src, g.tgt, { dates: 'shift', days: '7' }, rand);
  eq('on a course with no M and T sections the shift still applies', q.items[0].offering.due_at, '2026-12-18T06:59:59.000Z');
  // A map holding only one of the two days is noted
  const h = fixture();
  h.src.sections = f.src.sections; h.tgt.sections = f.tgt.sections;
  h.src.items[0] = { ...h.src.items[0], due_by_day: { M: DEC }, assignment_due_dates: [] };
  const r = T.buildRolloverPlan(h.src, h.tgt, { dates: 'shift', days: '7' }, rand);
  check('a map that names only M on a two-track course is noted', /dates for M only/.test(r.items[0].notes.join(' ')));
}

section('what is not copied is said, item by item (B2 S7)');
{
  const f = fixture();
  f.src.items[0] = { ...f.src.items[0], part_set_id: 'ps-1', is_group_work: true };
  const p = T.buildRolloverPlan(f.src, f.tgt, { dates: 'blank' }, rand);
  const n = p.items[0].notes.join(' ');
  check('a part set that is dropped is noted', /part set/.test(n));
  check('group work that is dropped is noted', /group work/.test(n));
  check('the copied offering carries neither the part set nor the group flag', !('part_set_id' in p.items[0].offering) && !('is_group_work' in p.items[0].offering));
}

section('the letter scale: one step, never into an active target (B2 S5)');
{
  const f = fixture({ targetActive: true });
  const p = T.buildRolloverPlan(f.src, f.tgt, { dates: 'blank' }, rand);
  eq('an active target is not given a copied scale', p.scale, 'target-active');
  reset();
  const res = await T.runRollover(db, p, 'co-spring', f.src, { id: 'me' });
  check('...and no scale is written for it', RPCS.length === 0 && res.scaleCopied === false && !res.scaleError);
  // A target whose only scale rows are retired has none in force: the copy goes through the one-step function.
  const g = fixture({ targetScale: null });
  const q = T.buildRolloverPlan(g.src, g.tgt, { dates: 'blank' }, rand);
  eq('an inactive target with no scale in force gets one', q.scale, 'copy');
  reset();
  const r2 = await T.runRollover(db, q, 'co-spring', g.src, { id: 'me' });
  eq('the scale goes through save_letter_scale with expected version 0', [RPCS.length, RPCS[0]?.fn, RPCS[0]?.args.p_expected_version, RPCS[0]?.args.p_course_offering], [1, 'save_letter_scale', 0, 'co-spring']);
  check('...with no author and no version number of its own', !('created_by' in RPCS[0].args) && !('version' in RPCS[0].args) && r2.scaleCopied === true);
  check('the scale is no longer inserted into letter_scales directly', !CALLS.some(c => c.table === 'letter_scales'));
  reset();
  RPC_RESULT = { data: null, error: { code: '22023', message: 'save_letter_scale: A cutoff can have three decimal places at most. Nothing was saved.' } };
  const r3 = await T.runRollover(db, q, 'co-spring', g.src, { id: 'me' });
  check('a refused scale is reported, and the assignments were still copied', r3.copied === 2 && !!r3.scaleError && r3.scaleCopied === false);
}

section('the write: only design tables, no publish, no change to the source');
{
  reset();
  const { src, tgt } = fixture();
  const plan = T.buildRolloverPlan(src, tgt, { dates: 'shift', days: '7' }, rand);
  const res = await T.runRollover(db, plan, 'co-spring', src, { id: 'me' });
  eq('no error', res.error, null);
  eq('two items copied', res.copied, 2);
  eq('the letter scale was copied', res.scaleCopied, true);
  const tables = [...new Set(writes().map(c => c.table))].sort();
  eq('the only tables written', tables, ['activities', 'assignment_due_dates', 'assignment_offerings', 'assignments',
    'offering_activities', 'question_keys', 'questions']);
  check('every write is an insert', writes().every(c => c.verb === 'insert'));
  check('the scale copy sends no created_by (a trigger stamps it from the sign-in)', RPCS.length === 1 && !('created_by' in RPCS[0].args));
  check('nothing writes to the source offering', !JSON.stringify(writes()).includes('"co-fall"') && !JSON.stringify(writes()).includes('"ao-1"'));
  const offerings = writes().filter(c => c.table === 'assignment_offerings');
  check('every offering row goes into the target and is unpublished',
    offerings.every(c => c.payload.course_offering_id === 'co-spring' && c.payload.is_published === false));
  check('the word true never appears against is_published', !/"is_published":true/.test(JSON.stringify(writes())));
  const keysW = writes().filter(c => c.table === 'question_keys');
  check('keys are written unchecked', keysW.every(c => c.payload.every(k => k.checked_by === null && k.checked_at === null && k.version === 1)));
  const order = writes().map(c => c.table);
  check('assignments come before activities, and activities before the offering row',
    order.indexOf('assignments') < order.indexOf('activities') && order.indexOf('activities') < order.indexOf('assignment_offerings'));
  const code = read('site/js/faculty-terms.js').replace(/\/\*[\s\S]*?\*\//g, '').split(String.fromCharCode(10)).filter(l => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
  check('the module never sends is_published true', !/is_published\s*:\s*true/.test(code));
}

section('a failure removes the half-made item and stops');
{
  reset();
  const { src, tgt } = fixture();
  const plan = T.buildRolloverPlan(src, tgt, { dates: 'blank' }, rand);
  FAIL = { table: 'offering_activities', verb: 'insert', error: { message: 'boom', code: 'XX000' } };
  const res = await T.runRollover(db, plan, 'co-spring', src, { id: 'me' });
  check('the error is returned with the title of the item', !!res.error && res.failedTitle === 'Homework 1');
  eq('nothing counted as copied', res.copied, 0);
  const del = CALLS.filter(c => c.verb === 'delete').map(c => c.table);
  eq('the offering row then the assignment were removed', del, ['assignment_offerings', 'assignments']);
  check('the second item was never started', writes().filter(c => c.table === 'assignments' && c.verb === 'insert').length === 1);
  eq('a clean undo reports nothing left behind', res.stayed, []);

  // The undo itself fails (B2 S1): the result must say what stayed, not "removed whole".
  reset();
  FAIL = { table: 'offering_activities', verb: 'insert', error: { message: 'boom', code: 'XX000' } };
  OVERRIDE = { 'assignment_offerings.delete': { data: null, error: { message: 'TypeError: Failed to fetch' } } };
  let r2 = await T.runRollover(db, plan, 'co-spring', src, { id: 'me' });
  check('a failed undo names what stayed behind, offering row and assignment', r2.stayed.length === 2 && /offering row/.test(r2.stayed[0]) && /the assignment itself/.test(r2.stayed[1]), JSON.stringify(r2.stayed));
  check('...and does not try to delete the item its offering row still protects', CALLS.filter(c => c.verb === 'delete').map(c => c.table).join() === 'assignment_offerings');
  reset();
  FAIL = { table: 'offering_activities', verb: 'insert', error: { message: 'boom', code: 'XX000' } };
  OVERRIDE = { 'assignments.delete': { data: null, error: { code: '23503', message: 'fk' } } };
  r2 = await T.runRollover(db, plan, 'co-spring', src, { id: 'me' });
  check('a failed delete of the item alone is reported too', r2.stayed.length === 1 && /the assignment itself/.test(r2.stayed[0]));
  // A lost response at the very first write: nothing is known to have been made.
  reset();
  FAIL = { table: 'assignments', verb: 'insert', error: { message: 'TypeError: Failed to fetch' } };
  r2 = await T.runRollover(db, plan, 'co-spring', src, { id: 'me' });
  check('a lost response is flagged as an unknown outcome', r2.outcomeUnknown === true && r2.stayed.length === 0 && r2.copied === 0);
}

section('reading past the 1000-row cap (B2 S8)');
{
  reset();
  const rows = (n, base) => Array.from({ length: n }, (_, i) => ({ id: `a-${base + i}`, slug: `slug-${base + i}`, title: 't', origin_assignment_id: null, assignment_offerings: [] }));
  const offering = (id) => ({ data: { id, is_active: false, course_id: 'course-1', term_id: 't', courses: { id: 'course-1', code: 'c-1', title: 'Course' }, terms: { id: 't', code: id, label: id } }, error: null });
  OVERRIDE = {
    'course_offerings.select': (state) => offering(state.filters.id),
    'assignment_offerings.select': { data: [], error: null },
    'sections.select': { data: [], error: null },
    'letter_scales.select': { data: [], error: null },
    'assignments.select': (state) => ({ data: state.filters[0] !== undefined ? rows(1000, 0) : rows(250, 1000), error: null }),
  };
  const r = await T.previewRollover(db, 'co-a', 'co-b', { dates: 'blank' }, rand);
  eq('a course of 1250 assignments gives 1250 taken slugs, not 1000', [r.error, r.tgt?.takenSlugs.length, r.tgt?.lineage.length], [undefined, 1250, 1250]);
}

section('creating: the active flag is stated, never defaulted');
{
  reset();
  await T.createOffering(db, { courseId: 'c', termId: 't', isActive: false });
  eq('inactive is sent as false', writes()[0].payload.is_active, false);
  reset();
  await T.createOffering(db, { courseId: 'c', termId: 't', isActive: true, directorId: 'person' });
  eq('active is sent as true', writes()[0].payload.is_active, true);
  eq('a director is added with no section (offering-wide)', [writes()[1].table, writes()[1].payload.role, writes()[1].payload.section_id], ['staff_assignments', 'director', null]);
  reset();
  await T.createOffering(db, { courseId: 'c', termId: 't' });
  eq('an offering with no choice is sent as inactive, not active', writes()[0].payload.is_active, false);
  reset();
  FAIL = { table: 'course_offerings', verb: 'insert', error: { message: 'x "course_offerings_one_active"', code: '23505' } };
  const r = await T.createOffering(db, { courseId: 'c', termId: 't', isActive: true });
  check('a second active offering comes back as an error the page turns into a sentence', !!r.error && /only one term/.test(T.termsError(r.error)));
}

section('the page and the menu');
{
  const html = read('site/faculty/terms.html');
  check('the page tells a non-administrator what only an administrator can do', /Only a site administrator can create a course, a term or an offering/.test(html));
  check('the create forms are drawn only for an administrator', /isAdmin\(\) \? createHtml\(\) : adminNote\(\)/.test(html));
  check('the page checks the director test before it loads anything', html.indexOf('if (!directs())') > -1 && html.indexOf('if (!directs())') < html.indexOf('T.loadOfferings('));
  check('dates default to blank', /id="ro-blank" value="blank" checked/.test(html));
  check('the offering is inactive unless the person picks active', /id="o-inactive" value="no" checked/.test(html));
  check('the page has no publish control', !/>\s*Publish\s*</i.test(html));
  const nav = read('site/js/nav.js');
  check('the menu links to it for directors', /key: 'terms'[\s\S]{0,200}directorOnly: true/.test(nav));
}

section('E30: no course code gates a page where it would hide or break a new course');
{
  const strip = (s, html) => {
    let t = s.replace(/\/\*[\s\S]*?\*\//g, '');
    if (html) t = t.replace(/<!--[\s\S]*?-->/g, '');
    return t.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  };
  const files = [];
  for (const dir of ['site/js', 'site/faculty', 'site/student', 'site']) {
    for (const f of readdirSync(resolve(REPO, dir), { withFileTypes: true })) {
      if (f.isFile() && /\.(js|html)$/.test(f.name)) files.push(`${dir}/${f.name}`);
    }
  }
  const hits = [];
  for (const rel of [...new Set(files)]) {
    if (rel === 'site/js/db-schema.js') continue;       // a generated catalogue of the database, comments only
    const code = strip(read(rel), rel.endsWith('.html'));
    code.split(String.fromCharCode(10)).forEach((line) => {
      if (/placeholder=/.test(line)) return;             // an example in an empty box, not a gate
      if (/['"`]phys-?(110|215|310)['"`]/.test(line)) hits.push(rel);
    });
  }
  // Each of these is a label or a fallback that degrades to the course's own code from the database;
  // none filters a course out. A fourth file, or one fewer, is a change somebody should look at.
  eq('the only files with a course-code literal in code are the three known harmless fallbacks',
    [...new Set(hits)].sort(), ['site/js/faculty-artifacts.js', 'site/js/util.js', 'site/student/backup.html']);
}

section('active or inactive: a statement, a count, a confirm, one active offering per course');
{
  const offs = [
    { id: 'a', courseId: 'c1', courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Fall 2026', isActive: true },
    { id: 'b', courseId: 'c1', courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Spring 2027', isActive: false },
    { id: 'c', courseId: 'c2', courseCode: 'phys-110', courseTitle: 'Physics 110', termLabel: 'Fall 2026', isActive: false },
  ];
  eq('making an inactive offering active when none is: allowed', T.checkActiveChange(offs[2], true, offs), []);
  const second = T.checkActiveChange(offs[1], true, offs);
  check('a second active offering of the same course is refused in a sentence that names the other', second.length === 1 && /Fall 2026/.test(second[0]) && /only one/.test(second[0]), second.join('|'));
  eq('making the active one inactive is allowed', T.checkActiveChange(offs[0], false, offs), []);
  check('setting it to what it already is is refused', T.checkActiveChange(offs[0], true, offs).length === 1);
  check('an offering the person cannot see is refused', T.checkActiveChange(null, true, offs).length === 1);

  check('the statement says what active steers', /nightly jobs/.test(T.activeStatement(true)) && /Health page/.test(T.activeStatement(true)) && /publish/.test(T.activeStatement(true)));
  check('the inactive statement says nothing is deleted or hidden', /deletes nothing/.test(T.activeStatement(false)) && /hides nothing/.test(T.activeStatement(false)));

  reset();
  OVERRIDE = {
    'sections.select': { data: [{ id: 's1' }, { id: 's2' }], error: null },
    'enrollments.select': { data: null, count: 18, error: null },
    'assignment_offerings.select': { data: null, count: 5, error: null },
  };
  const imp = await T.offeringImpact(db, 'b');
  eq('the impact counts the enrolled cadets and the published assignments', [imp.error, imp.enrolled, imp.published], [null, 18, 5]);
  const txt = T.activeConfirmText(offs[1], true, imp);
  check('the confirmation states both counts and the statement', /18 enrolled cadets/.test(txt) && /5 published assignments/.test(txt) && /nightly jobs/.test(txt), txt);
  check('one cadet and one assignment use the singular', /1 enrolled cadet and 1 published assignment./.test(T.activeConfirmText(offs[1], false, { enrolled: 1, published: 1 })));
  reset();
  OVERRIDE = { 'sections.select': { data: null, error: { message: 'down' } } };
  check('a count that cannot be read is an error, so no confirm is shown', !!(await T.offeringImpact(db, 'b')).error);

  reset();
  OVERRIDE = { 'course_offerings.update': { data: [{ id: 'b', is_active: true }], error: null } };
  let r = await T.setOfferingActive(db, 'b', true);
  eq('setting active writes one column on one row and reads it back', [r.error, r.isActive, writes().length, Object.keys(writes()[0].payload), writes()[0].filters.id], [null, true, 1, ['is_active'], 'b']);
  check('nothing else is touched: no delete anywhere', CALLS.every(c => c.verb !== 'delete'));
  reset();
  OVERRIDE = { 'course_offerings.update': { data: [], error: null } };
  check('a row that did not change is an error, never a silent success', !!(await T.setOfferingActive(db, 'b', true)).error);
  reset();
  OVERRIDE = { 'course_offerings.update': { data: [{ id: 'b', is_active: false }], error: null } };
  check('a value the database did not keep is an error', !!(await T.setOfferingActive(db, 'b', true)).error);
  reset();
  OVERRIDE = { 'course_offerings.update': { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "course_offerings_one_active"' } } };
  check('the database refusing a second active offering comes back as an error', !!(await T.setOfferingActive(db, 'b', true)).error);

  const html = read('site/faculty/terms.html');
  check('the control is for a global admin only', /isAdmin|is_global_admin|isGlobalAdmin/.test(html) && /toggleActive/.test(html));
  check('the page asks with window.confirm before it writes', html.indexOf('window.confirm') > -1 && html.indexOf('window.confirm') < html.indexOf('T.setOfferingActive'));
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the guided setup: one form over the same three writes');
{
  const newBoth = { course: { mode: 'new', code: 'mock-101', title: 'Mock Course' }, term: { mode: 'new', code: 'mock-term', label: 'Mock Term', startsOn: '2027-01-10', endsOn: '2027-05-10' }, directorId: 'person' };
  reset();
  let r = await T.runSetup(db, newBoth, []);
  eq('everything is made in order: course, term, then the course for the term', writes().map(c => c.table), ['courses', 'terms', 'course_offerings', 'staff_assignments']);
  eq('it succeeds with nothing failed', [r.error, r.failedAt], [null, null]);
  eq('the course for the term is made not active', writes().find(c => c.table === 'course_offerings').payload.is_active, false);
  check('the done message names what was made and has no mention of an offering', /Done\. Made the course “Mock Course”, the term “Mock Term”/.test(T.setupMessage(r, newBoth)) && !/offering/i.test(T.setupMessage(r, newBoth)));

  reset();
  r = await T.runSetup(db, { course: { mode: 'existing', id: 'c1' }, term: { mode: 'existing', id: 't1' }, directorId: '' }, []);
  eq('an existing course and term make only the link', writes().map(c => c.table), ['course_offerings']);

  reset();
  r = await T.runSetup(db, { course: { mode: 'existing', id: 'c1' }, term: { mode: 'existing', id: 't1' } }, [{ courseId: 'c1', termId: 't1' }]);
  eq('a course already set up for that term is refused before any write', [writes().length, r.refused], [0, true]);
  check('...in a sentence', /already set up/.test(T.setupMessage(r, {})));

  reset();
  FAIL = { table: 'terms', verb: 'insert', error: { code: '23505', message: 'duplicate key "terms_code_key"' } };
  r = await T.runSetup(db, newBoth, []);
  eq('a term that fails stops there: the course stays made, nothing else is written', [r.failedAt, r.made.courseCreated, writes().map(c => c.table)], ['term', true, ['courses', 'terms']]);
  const msg = T.setupMessage(r, newBoth);
  check('the message says what was made, what failed, and what to do next',
    /Made the course “Mock Course”\./.test(msg) && /The term could not be made/.test(msg) && /press Set up again/.test(msg) && !/offering/i.test(msg), msg);

  reset();
  FAIL = { table: 'courses', verb: 'insert', error: { code: '42501', message: 'row-level security' } };
  r = await T.runSetup(db, newBoth, []);
  check('a course that fails makes nothing and says so', r.failedAt === 'course' && /Nothing was made/.test(T.setupMessage(r, newBoth)) && writes().length === 1);

  reset();
  FAIL = { table: 'staff_assignments', verb: 'insert', error: { message: 'x' } };
  r = await T.runSetup(db, newBoth, []);
  check('a director that cannot be added leaves the rest done and says where to add them', !r.error && !!r.directorError && /Staff tab/.test(T.setupMessage(r, newBoth)));

  check('the form is checked in words before any write', T.checkSetup({ course: { mode: 'existing' }, term: { mode: 'new', code: 'x' } }).length >= 2);
}

section('the checklist');
{
  const steps = T.checklistSteps({ enrolled: 0, assignments: 3, scaleSaved: false, isActive: false });
  eq('four steps in order', steps.map(s => s.key), ['roster', 'assignments', 'scale', 'active']);
  eq('done and not done come from the counts', steps.map(s => s.done), [false, true, false, false]);
  eq('all done', T.checklistSteps({ enrolled: 5, assignments: 1, scaleSaved: true, isActive: true }).every(s => s.done), true);
  reset();
  const html = read('site/faculty/terms.html');
  check('the guided page has the set-up form, the checklist and the old forms under Advanced',
    /Set up a course for a term/.test(html) && /checklistsHtml\(\)/.test(html) && /id="sec-advanced"/.test(html));
  const guided = html.slice(html.indexOf('function setupHtml'), html.indexOf('function readSetup'));
  check('no "offering" in the words on the guided form', !/offering/i.test(guided.replace(/offeringId|c-offering/g, '')), (guided.match(/.{20}offering.{20}/i) || [''])[0]);
  check('the copy into the next term is reachable from the checklist', /data-scroll="sec-rollover"/.test(html));
  check('turning a course on stays a site-administrator button', /isAdmin\(\)\s*\n?\s*\? \(o\.isActive/.test(html));
}

process.exit(summary() ? 0 : 1);
