// test-faculty-items.mjs — the item entry page's data layer (site/js/faculty-items.js).
//
// WHAT THIS DEFENDS
//   * Nothing the page writes is ever published, and every new item carries the marker that holds
//     it back (docs/decisions/V2-DATA-MODEL.md section 1).
//   * No code branches on kind. Kind only prefills delivery and grading, from data.
//   * Only (delivery, grading) pairs migration 077 accepts (027's list plus ai_drafted) are offered. The test reads that file.
//   * Deadlines come out as 23:59:59 Mountain time stored as UTC, from ANY browser zone, through the
//     older editor's own helpers (imported, not copied).
//   * A removal with submissions or grades is refused, with the counts, before anything is deleted.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db. It shows which queries and writes the shipped module
//   issues, not that the database accepts them. tests/browser-harness/v2-items-entry.mjs does that on
//   staging, with a real browser and a real signed-in director.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/items.html' });

let RESPONSES = {};
let CALLS = [];
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
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    if (data && data.__count !== undefined) return { data: null, count: data.__count, error: null };
    if (data === undefined) {
      if (state.verb === 'insert' && mode !== 'many') return { data: { id: `${table}-${++SEQ}` }, error: null };
      // A guarded update or delete asks for its rows back (`.select('id')`); by default one row was touched.
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

const I = await import('../../site/js/faculty-items.js');
const G = await import('../../site/js/new-page-guard.js');
const db = window.db;
const reset = (r = {}) => { RESPONSES = r; CALLS = []; SEQ = 0; };
const writesTo = (table, verb) => CALLS.filter(c => c.table === table && (!verb || c.verb === verb));

const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('allowed pairs match migration 077 (the newest text of the check)');
{
  const sql = read('supabase/migrations/app/077_ai_drafted_grading.sql');
  const start = sql.indexOf('ADD CONSTRAINT offering_activities_delivery_grading_ck');
  const block = sql.slice(start, sql.indexOf('offering_activities_warn_needs_human_ck', start));
  const pairs = [...block.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map(m => [m[1], m[2]]);
  const mine = JSON.stringify([...I.ALLOWED_PAIRS].sort());
  check('the page offers exactly the pairs the database check accepts (both ways)',
    JSON.stringify(pairs.sort()) === mine, `${JSON.stringify(pairs.sort())} vs ${mine}`);
  eq('there are nine pairs', I.ALLOWED_PAIRS.length, 9);
  const old = read('supabase/migrations/app/027_path_delivery_grading.sql');
  const oldPairs = [...old.slice(old.indexOf('ADD CONSTRAINT offering_activities_delivery_grading_ck'),
    old.indexOf('offering_activities_warn_needs_human_ck', old.indexOf('ADD CONSTRAINT offering_activities_delivery_grading_ck')))
    .matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map(m => [m[1], m[2]]);
  check('077 adds exactly one pair to 027\'s eight, typed_response with ai_drafted',
    oldPairs.length === 8 && pairs.length === 9 && oldPairs.every(p => pairs.some(q => q[0] === p[0] && q[1] === p[1]))
    && pairs.filter(q => !oldPairs.some(p => p[0] === q[0] && p[1] === q[1])).map(q => q.join('/')).join() === 'typed_response/ai_drafted');
  eq('a typed response can be graded two ways', I.gradingsFor('typed_response'), ['human_graded', 'ai_drafted']);
  check('a yellow mark earns full credit on both typed-response gradings and on nothing else',
    I.warnEarnsFull('typed_response', 'human_graded') && I.warnEarnsFull('typed_response', 'ai_drafted')
    && !I.warnEarnsFull('interactive_tutor', 'effort') && !I.warnEarnsFull('online_questions', 'human_graded'));
  check('every pair offered is marked by pairAllowed()', I.ALLOWED_PAIRS.every(p => I.pairAllowed(p[0], p[1])));
  check('a pair the database refuses is not offered (typed response, hand entered)', !I.pairAllowed('typed_response', 'hand_entered'));
  check('every delivery has a modality and a label',
    I.deliveries().every(d => I.DELIVERY_MODALITY[d] && I.DELIVERY_LABEL[d]));
  check('every grading has a label', I.ALLOWED_PAIRS.every(p => I.GRADING_LABEL[p[1]]));
  eq('online questions can be graded two ways', I.gradingsFor('online_questions'), ['auto_checked', 'human_graded']);
  eq('the tutor has one grading', I.gradingsFor('interactive_tutor'), ['effort']);
}

section('kinds prefill from data, and no code branches on kind');
{
  const sql = read('supabase/migrations/app/026_assignment_kinds_seed.sql');
  const kinds = [...sql.matchAll(/\('([a-z_]+)',\s*'[^']*',\s*\d+,\s*'[A-Z]+',\s*'([a-z_]+)',\s*'([a-z_]+)'\)/g)]
    .map(m => ({ id: m[1], default_delivery: m[2], default_grading: m[3] }));
  eq('migration 026 seeds seven kinds', kinds.length, 7);
  for (const k of kinds) {
    const p = I.prefillFromKind(k);
    check(`${k.id}: the prefill is a pair the database accepts`, I.pairAllowed(p.delivery, p.grading), JSON.stringify(p));
    check(`${k.id}: the prefill is the kind's own stored pair`, p.delivery === k.default_delivery && p.grading === k.default_grading);
  }
  eq('a kind with a pair that is not allowed falls back to an allowed grading',
    I.prefillFromKind({ default_delivery: 'typed_response', default_grading: 'hand_entered' }),
    { delivery: 'typed_response', grading: 'human_graded' });
  eq('a kind with nothing stored gets the first allowed pair',
    I.prefillFromKind({}), { delivery: 'online_questions', grading: 'auto_checked' });
  const src = read('site/js/faculty-items.js') + read('site/faculty/items.html');
  const hits = kinds.map(k => k.id).filter(id => new RegExp(`['"\`]${id}['"\`]`).test(src));
  eq('neither the module nor the page names a kind id', hits, []);
  check('the page has no publish control and the module never sends is_published true',
    !/is_published\s*:\s*true/.test(src) && !/>\s*Publish\s*</i.test(src) && !/data-pub/.test(src));
}

section('Mountain time, from any browser zone');
{
  eq('a December deadline is 06:59 UTC the next day (standard time)',
    new Date(I.zoneWallToInstant('2026-12-10', '23:59')).toISOString(), '2026-12-11T06:59:00.000Z');
  eq('a July deadline is 05:59 UTC the next day (daylight time)',
    new Date(I.zoneWallToInstant('2026-07-15', '23:59')).toISOString(), '2026-07-16T05:59:00.000Z');
  eq('the day daylight time starts (8 March 2027)',
    new Date(I.zoneWallToInstant('2027-03-14', '23:59')).toISOString(), '2027-03-15T05:59:00.000Z');
  eq('the day daylight time ends (1 November 2026)',
    new Date(I.zoneWallToInstant('2026-11-01', '23:59')).toISOString(), '2026-11-02T06:59:00.000Z');
  eq('the same instant reads back as the Mountain date and time', I.instantToZone('2026-12-11T06:59:59Z'),
    { date: '2026-12-10', time: '23:59' });
  eq('midnight in Mountain time reads 00:00', I.instantToZone('2026-12-11T07:00:00Z'), { date: '2026-12-11', time: '00:00' });
  check('real dates and times are told from unreal ones',
    I.isRealDate('2026-02-28') && !I.isRealDate('2026-02-30') && !I.isRealDate('26-1-1') &&
    I.isRealTime('23:59') && !I.isRealTime('24:00') && !I.isRealTime('9:5'));

  const sections = [{ id: 's-none', code: 'ENT-A', meeting_days: [] }, { id: 's-wf', code: 'ENT-B', meeting_days: ['W', 'F'] }];
  const wanted = '2026-12-11T06:59:59.000Z';
  const zones = ['America/Denver', 'UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata'];
  const original = process.env.TZ;
  for (const z of zones) {
    process.env.TZ = z;
    const s = I.buildSchedule({ allDate: '2026-12-10', time: '23:59', sectionDates: {} }, sections, 'off-1');
    check(`browser zone ${z}: due_at is 23:59:59 Mountain as UTC`, s.dueAt === wanted, s.dueAt);
    check(`browser zone ${z}: the W and F entries and the section row are the same instant`,
      s.dueByDay.W === wanted && s.dueByDay.F === wanted && s.rows.length === 1 && s.rows[0].due_at === wanted,
      JSON.stringify(s));
  }
  process.env.TZ = original ?? '';
  if (original === undefined) delete process.env.TZ;
}

section('the three date shapes');
{
  const sections = [
    { id: 'a', code: 'A', meeting_days: [] }, { id: 'b', code: 'B', meeting_days: ['W', 'F'] },
    { id: 'm1', code: 'M1A', meeting_days: ['M'] }, { id: 'm2', code: 'M3A', meeting_days: ['M'] },
  ];
  let s = I.buildSchedule({ allDate: '', time: '23:59', sectionDates: {} }, sections, 'o');
  eq('no date at all stores no deadline', [s.dueAt, s.dueByDay, s.rows], [null, {}, []]);

  s = I.buildSchedule({ allDate: '2026-12-10', time: '23:59', sectionDates: { a: '', b: '2026-12-10', m1: '' } }, sections, 'o');
  eq('one date for all: due_at and a day entry per meeting day', [s.dueAt, Object.keys(s.dueByDay).sort()],
    ['2026-12-11T06:59:59.000Z', ['F', 'M', 'W']]);
  eq('... and one row for each section that meets on a day, none for the section with no days',
    s.rows.map(r => r.section_id).sort(), ['b', 'm1', 'm2']);

  s = I.buildSchedule({ allDate: '2026-12-10', time: '23:59', sectionDates: { a: '2026-12-14', m2: '2026-12-16' } }, sections, 'o');
  const byId = Object.fromEntries(s.rows.map(r => [r.section_id, r.due_at]));
  eq('an exception for a section with no days is its own row', byId.a, '2026-12-15T06:59:59.000Z');
  eq('an exception overrides a section that meets M, and its twin keeps the shared date',
    [byId.m2, byId.m1], ['2026-12-17T06:59:59.000Z', '2026-12-11T06:59:59.000Z']);
  eq('exceptions do not move the offering default', s.dueAt, '2026-12-11T06:59:59.000Z');

  s = I.buildSchedule({ allDate: '', time: '23:59', sectionDates: { a: '2026-12-14', b: '2026-12-12' } }, sections, 'o');
  eq('dates per section only: no offering default, no day entries, two rows',
    [s.dueAt, s.dueByDay, s.rows.map(r => r.section_id).sort()], [null, {}, ['a', 'b']]);

  s = I.buildSchedule({ allDate: '2026-12-10', time: '17:30', sectionDates: {} }, sections, 'o');
  eq('another time of day is kept, with seconds at :59', s.dueAt, '2026-12-11T00:30:59.000Z');

  const back = I.scheduleToForm({ due_at: '2026-12-11T06:59:59Z' }, [
    { section_id: 'a', due_at: '2026-12-15T06:59:59Z' }, { section_id: 'b', due_at: '2026-12-11T06:59:59Z' }]);
  eq('a saved item opens with its date and time, and only the real exceptions as section dates', back,
    { allDate: '2026-12-10', time: '23:59', sectionDates: { a: '2026-12-14' } });
  eq('with no date for all, every row is a section date', I.scheduleToForm({ due_at: null },
    [{ section_id: 'a', due_at: '2026-12-15T06:59:59Z' }]).sectionDates, { a: '2026-12-14' });
}

section('form checks');
{
  const kinds = [{ id: 'homework' }];
  const base = { kindId: 'homework', title: 'T', description: '', delivery: 'online_questions', grading: 'human_graded',
                 points: '10', time: '23:59', allDate: '', sectionDates: {} };
  eq('a good form has no problems', I.checkForm(base, { kinds }), []);
  check('no title', I.checkForm({ ...base, title: '  ' }, { kinds }).length === 1);
  check('a pair the database refuses', I.checkForm({ ...base, delivery: 'typed_response', grading: 'hand_entered' }, { kinds }).length === 1);
  check('a third decimal in points', I.checkForm({ ...base, points: '2.555' }, { kinds }).length === 1);
  check('negative points', I.checkForm({ ...base, points: '-1' }, { kinds }).length === 1);
  eq('zero points are fine (a bonus item)', I.checkForm({ ...base, points: '0' }, { kinds }), []);
  check('a made-up date', I.checkForm({ ...base, allDate: '2026-02-30' }, { kinds }).length === 1);
  check('the tutor needs its id', I.checkForm({ ...base, delivery: 'interactive_tutor', grading: 'effort' }, { kinds }).length === 1);
  eq('... and passes with one', I.checkForm({ ...base, delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'lesson-02' }, { kinds }), []);
  check('no kind chosen', I.checkForm({ ...base, kindId: '' }, { kinds }).length === 1);
  eq('an auto-checked item needs no points: its questions set them', I.checkForm({ ...base, grading: 'auto_checked', points: '' }, { kinds }), []);
  check('... but a person-graded online item does', I.checkForm({ ...base, points: '' }, { kinds }).length === 1);
  eq('only auto_checked is owned by questions', I.ALLOWED_PAIRS.filter(p => I.pointsOwnedByQuestions(p[1])).length, 1);
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('createItem: every write, in order, never published');
const sections = [{ id: 's-none', code: 'ENT-A', meeting_days: [] }, { id: 's-wf', code: 'ENT-B', meeting_days: ['W', 'F'] }];
const ctx = { courseId: 'course-1', courseCode: 'gate-entry', courseOfferingId: 'co-1', sections };
const form = (o = {}) => ({ kindId: 'homework', title: 'Problem Set 3', description: 'Made up.', delivery: 'online_questions',
  grading: 'human_graded', points: '10', lateAllowed: true, isBonus: false, progIncluded: true,
  allDate: '2026-12-10', time: '23:59', sectionDates: {}, interactiveSlug: '', interactiveUrl: '', ...o });
{
  reset({ 'assignments.select': [{ slug: 'problem-set-3' }] });
  const r = await I.createItem(db, ctx, form());
  eq('it succeeds', r.error, null);
  eq('the order is assignment, activity, offering, path, then dates',
    CALLS.map(c => `${c.table}.${c.verb}`),
    ['assignments.insert', 'activities.insert', 'assignment_offerings.insert', 'offering_activities.insert',
     'assignment_due_dates.delete', 'assignment_due_dates.insert']);
  check('the slug avoids one already taken in the course', writesTo('assignments', 'insert')[0].payload.slug.startsWith('problem-set-3-'),
    writesTo('assignments', 'insert')[0].payload.slug);
  const ao = writesTo('assignment_offerings', 'insert')[0].payload;
  eq('the offering is unpublished and marked as the newer page\'s', [ao.is_published, ao.entered_on_new_page], [false, true]);
  eq('no lesson number is written', ao.position, null);
  eq('the offering carries points, late, bonus, Prog', [ao.points_possible, ao.late_allowed, ao.is_bonus, ao.prog_included], [10, true, false, true]);
  eq('the deadline is stored as Mountain time in UTC', ao.due_at, '2026-12-11T06:59:59.000Z');
  eq('and per meeting day', ao.due_by_day, { W: '2026-12-11T06:59:59.000Z', F: '2026-12-11T06:59:59.000Z' });
  const act = writesTo('activities', 'insert')[0].payload;
  eq('online questions make a questions activity with no content', [act.modality, act.content], ['questions', {}]);
  check('the path slug is generated', /^gate-entry-problem-set-3-.*-questions-[0-9a-f]{8}$/.test(act.slug), act.slug);
  const oa = writesTo('offering_activities', 'insert')[0].payload;
  eq('the path carries delivery and grading, and warn does not earn full', [oa.delivery, oa.grading, oa.warn_earns_full],
    ['online_questions', 'human_graded', false]);
  eq('the section row is for the section that meets', writesTo('assignment_due_dates', 'insert')[0].payload.map(x => x.section_id), ['s-wf']);
  check('no write anywhere sends is_published true',
    !CALLS.some(c => JSON.stringify(c.payload || '').includes('"is_published":true')));
  reset();
  await I.createItem(db, ctx, form({ grading: 'auto_checked', points: '10' }));
  eq('an auto-checked item is created with 0 points, which its questions will replace',
    writesTo('assignment_offerings', 'insert')[0].payload.points_possible, 0);
}

section('createItem: each delivery makes the right activity');
for (const [delivery, grading, modality] of [
  ['online_questions', 'human_graded', 'questions'], ['typed_response', 'human_graded', 'written'],
  ['in_person', 'hand_entered', 'external'], ['elsewhere', 'imported', 'external'], ['interactive_tutor', 'effort', 'interactive']]) {
  reset();
  const r = await I.createItem(db, ctx, form({ delivery, grading, interactiveSlug: 'tutor-id-1', interactiveUrl: 'https://example.org/x' }));
  const act = writesTo('activities', 'insert')[0].payload;
  check(`${delivery} / ${grading} -> ${modality}`, !r.error && act.modality === modality, JSON.stringify(act));
  if (delivery === 'interactive_tutor') {
    eq('the tutor keeps the id the director typed, and its link', [act.slug, act.content.artifact_url], ['tutor-id-1', 'https://example.org/x']);
  }
}

section('createItem: a failure part way leaves nothing behind');
{
  reset({ 'assignment_offerings.insert': () => ({ __error: { code: '23514', message: 'refused' } }) });
  const r = await I.createItem(db, ctx, form());
  check('the error comes back', r.error?.code === '23514');
  eq('the half-made assignment is deleted, and there was no offering to delete',
    [writesTo('assignments', 'delete').length, writesTo('assignment_offerings', 'delete').length], [1, 0]);

  reset({ 'offering_activities.insert': () => ({ __error: { code: '23514', message: 'refused' } }) });
  await I.createItem(db, ctx, form());
  eq('a path refusal deletes the offering first, then the assignment',
    CALLS.filter(c => c.verb === 'delete').map(c => c.table), ['assignment_offerings', 'assignments']);
}

section('updateItem');
const item = (o = {}) => ({ offeringId: 'o-1', assignmentId: 'a-1', slug: 'x', isNew: true,
  paths: [{ delivery: 'elsewhere', grading: 'imported', modality: 'external', activityId: 'act-1', content: {} }], ...o });
{
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: false } });
  let r = await I.updateItem(db, ctx, item(), form());
  check('an item the older page owns is refused, and nothing is written', r.error && CALLS.length === 0);

  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  r = await I.updateItem(db, ctx, item(), form({ delivery: 'in_person', grading: 'hand_entered' }));
  eq('a same-kind path change updates the path in place', r.error, null);
  check('and its points are written', writesTo('assignment_offerings', 'update')[0].payload.points_possible === 10);
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  await I.updateItem(db, ctx, item({ paths: [{ delivery: 'online_questions', grading: 'auto_checked', modality: 'questions', activityId: 'act-1', content: {} }] }),
    form({ delivery: 'online_questions', grading: 'auto_checked', points: '99' }));
  check('points of an auto-checked item are never written (the questions own them)',
    !('points_possible' in writesTo('assignment_offerings', 'update')[0].payload));
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  r = await I.updateItem(db, ctx, item(), form({ delivery: 'in_person', grading: 'hand_entered' }));
  eq('... delivery and grading on the existing row', writesTo('offering_activities', 'update')[0].payload,
    { delivery: 'in_person', grading: 'hand_entered' });
  const upd = writesTo('assignment_offerings', 'update')[0].payload;
  check('the offering update never touches publish state or the marker',
    !('is_published' in upd) && !('entered_on_new_page' in upd) && !('position' in upd), Object.keys(upd).join());

  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true }, 'submissions.select': { __count: 2 } });
  r = await I.updateItem(db, ctx, item(), form({ delivery: 'typed_response', grading: 'human_graded' }));
  check('changing to a different kind of path is refused when work exists', r.error && /2 submissions/.test(r.error.message));
  eq('... before any path is touched', writesTo('activities').length + writesTo('offering_activities').length, 0);

  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  r = await I.updateItem(db, ctx, item(), form({ delivery: 'typed_response', grading: 'human_graded' }));
  eq('with no work, a different kind of path is a new activity', r.error, null);
  eq('the new path goes in before the old one comes out',
    CALLS.filter(c => ['activities', 'offering_activities'].includes(c.table)).map(c => `${c.table}.${c.verb}`),
    ['activities.insert', 'offering_activities.insert', 'offering_activities.delete', 'activities.delete']);

  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  r = await I.updateItem(db, ctx, item({ paths: [item().paths[0], item().paths[0]] }), form());
  eq('an item with two paths leaves its paths alone', writesTo('offering_activities').length + writesTo('activities').length, 0);
}

section('removeItem');
{
  reset({ 'assignment_offerings.select': { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true } });
  let r = await I.removeItem(db, 'o-1');
  eq('an item with no work is removed, offering first then assignment', [r.error, CALLS.filter(c => c.verb === 'delete').map(c => c.table)],
    [null, ['assignment_offerings', 'assignments']]);

  reset({ 'assignment_offerings.select': { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true },
          'submissions.select': { __count: 3 } });
  r = await I.removeItem(db, 'o-1');
  check('submissions refuse the removal and name the count', r.refused && /3 submissions/.test(r.error.message), r.error?.message);
  eq('... and nothing was deleted', CALLS.length, 0);

  reset({ 'assignment_offerings.select': { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true },
          'grades.select': { __count: 1 } });
  r = await I.removeItem(db, 'o-1');
  check('a grade refuses it', r.refused && /1 grade\b/.test(r.error.message) && CALLS.length === 0, r.error?.message);

  reset({ 'assignment_offerings.select': { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true },
          'grades.select': { __error: { message: 'down' } } });
  r = await I.removeItem(db, 'o-1');
  check('a count that cannot be read refuses it', r.refused && CALLS.length === 0);

  reset({ 'assignment_offerings.select': { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: false } });
  r = await I.removeItem(db, 'o-1');
  check('an item the older page owns is refused', r.refused && /older page/.test(r.error.message) && CALLS.length === 0);
}

section('plain errors');
{
  const uuid = '6b5d06ef-77ec-59fb-bf28-a4f925e677a7';
  const raw = `assignment offering ${uuid}: cannot be published while its course offering is inactive (assignment_offerings_publish_needs_active)`;
  const sentence = 'This term is not active, so its lessons cannot be published.';
  eq('the older editor shows one plain sentence for the inactive-term refusal', G.publishRefusalMessage({ message: raw }), sentence);
  eq('and nothing for any other error', G.publishRefusalMessage({ message: 'network down' }), null);
  eq('and nothing for no error', G.publishRefusalMessage(null), null);
  check('the page strips ids from other messages', !I.plainError({ message: `row ${uuid} is wrong (some_rule)` }).includes(uuid));
  check('a permission refusal says who can', /director/.test(I.plainError({ code: '42501', message: 'x' })));
  check('a database without the columns says so', /not been upgraded/.test(I.plainError({ code: '42703', message: 'x' })));
  check('databaseNotReady spots a missing column', I.databaseNotReady({ code: '42703', message: 'x' }) && !I.databaseNotReady({ message: 'timeout' }));
  const html = read('site/faculty/lessons.html');
  check('the older editor calls the helper where it shows the publish error',
    /publishRefusalMessage\(error\)/.test(html) && /console\.warn\('Publish refused:'/.test(html));
}

section('reading the list');
{
  const kinds = [{ id: 'exam', label: 'Exam' }];
  const row = { id: 'o-9', assignment_id: 'a-9', points_possible: '100.00', due_at: '2026-12-11T06:59:59Z',
    is_published: false, entered_on_new_page: true, late_allowed: true, is_bonus: false, prog_included: false,
    assignments: { id: 'a-9', slug: 'midterm', title: 'Midterm', description: null, kind_id: 'exam' },
    offering_activities: [{ delivery: 'in_person', grading: 'hand_entered', grading_role: 'graded', position: 0,
      activities: { id: 'act', slug: 's', modality: 'external', content: {} } }],
    assignment_due_dates: [{ section_id: 'a', due_at: '2026-12-11T06:59:59Z' }, { section_id: 'b', due_at: '2026-12-15T06:59:59Z' }] };
  const it = I.shapeItem(row, kinds, [{}, {}]);
  eq('kind label, delivery and grading come out as words', [it.kindLabel, it.deliveryText, it.gradingText], ['Exam', 'In person', 'Scores typed in by staff']);
  eq('two dates read as a range', it.dueText, '2 dates by section, 10 Dec 2026 to 14 Dec 2026');
  eq('a lone date reads plainly', I.describeDates({ due_at: '2026-12-11T06:59:59Z' }), '10 Dec 2026');
  eq('no date reads as no date', I.describeDates({}), 'No date');
  eq('the marker is read', it.isNew, true);
}

section('the page is for directors, and only directors see the entry');
{
  const nav = await import('../../site/js/nav.js');
  const link = nav.FACULTY_LINKS.find(l => l.key === 'items');
  check('the bar has an Items entry pointing at items.html', link?.href === 'items.html');
  check('and it is director-only, not admin-only', link?.directorOnly === true && !link?.adminOnly);
  eq('the older pages link to the same file', G.NEW_PAGE_HREF, 'items.html');
  const html = read('site/faculty/items.html');
  check('the page checks the director test before it loads any item',
    html.indexOf('if (!isDirector())') > -1 && html.indexOf('if (!isDirector())') < html.indexOf('I.loadItems('));
  check('the page no longer says items wait for step 2 and still says they stay unpublished', !/until step 2/.test(html) && /Items saved here stay unpublished/.test(html));
  check('the page escapes what it renders (no data goes into innerHTML without esc)',
    !/\$\{(it|item|s)\.(title|slug|description|kindLabel|deliveryText|gradingText|dueText)\}/.test(html));
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('two-track courses: an M date and a T date (review B S9)');
{
  const mt = [
    { id: 'm1', code: 'M1A', meeting_days: ['M'] }, { id: 't1', code: 'T1A', meeting_days: ['T'] },
  ];
  const one = [{ id: 'x', code: 'W1', meeting_days: ['W', 'F'] }];
  check('a course with M and T sections is two-track', I.isTwoTrack(mt));
  check('a course with only M sections is not', !I.isTwoTrack([mt[0]]) && !I.isTwoTrack(one) && !I.isTwoTrack([]));
  eq('the meeting days are the sorted set', I.meetingDays(mt), ['M', 'T']);

  const kinds = [{ id: 'homework' }];
  const base = { kindId: 'homework', title: 'T', description: '', delivery: 'online_questions', grading: 'human_graded',
                 points: '10', time: '23:59', allDate: '', sectionDates: {}, dayDates: {}, sameDate: false };
  eq('a two-track course with no date at all is fine (no deadline)', I.checkForm(base, { kinds, sections: mt }), []);
  const onlyM = I.checkForm({ ...base, dayDates: { M: '2026-12-10' } }, { kinds, sections: mt });
  check('only an M date is refused, in a sentence that names the T date', onlyM.length === 1 && /T/.test(onlyM[0]), onlyM.join('|'));
  eq('... unless the person ticks that both tracks get the same date',
    I.checkForm({ ...base, dayDates: { M: '2026-12-10' }, sameDate: true }, { kinds, sections: mt }), []);
  const tickDiffer = I.checkForm({ ...base, dayDates: { M: '2026-12-10', T: '2026-12-11' }, sameDate: true }, { kinds, sections: mt });
  check('the tick with two different dates is refused', tickDiffer.length === 1, tickDiffer.join('|'));
  eq('both dates and no tick is fine', I.checkForm({ ...base, dayDates: { M: '2026-12-10', T: '2026-12-11' } }, { kinds, sections: mt }), []);
  eq('a course that is not two-track keeps the single date box and ignores the day boxes',
    I.checkForm({ ...base, allDate: '2026-12-10' }, { kinds, sections: one }), []);

  let s = I.buildSchedule({ ...base, dayDates: { M: '2026-12-10', T: '2026-12-11' } }, mt, 'o');
  eq('two dates become two day entries and two section rows',
    [s.dueByDay, s.rows.map(r => [r.section_id, r.due_at]).sort()],
    [{ M: '2026-12-11T06:59:59.000Z', T: '2026-12-12T06:59:59.000Z' },
     [['m1', '2026-12-11T06:59:59.000Z'], ['t1', '2026-12-12T06:59:59.000Z']]]);
  eq('... and no _all entry (that is the single-date shape)', Object.keys(s.dueByDay).includes('_all'), false);
  s = I.buildSchedule({ ...base, dayDates: { M: '2026-12-10' }, sameDate: true }, mt, 'o');
  eq('the tick fills the T day with the M date', s.dueByDay.T, s.dueByDay.M);

  const back = I.scheduleToForm({ due_at: '2026-12-11T06:59:59Z', due_by_day: { M: '2026-12-11T06:59:59Z', T: '2026-12-12T06:59:59Z' } }, [], mt);
  eq('a saved two-track item opens with both dates', back.dayDates, { M: '2026-12-10', T: '2026-12-11' });
  const flat = I.scheduleToForm({ due_at: '2026-12-11T06:59:59Z' }, [{ section_id: 'a', due_at: '2026-12-15T06:59:59Z' }]);
  eq('without sections the older shape is unchanged', flat, { allDate: '2026-12-10', time: '23:59', sectionDates: { a: '2026-12-14' } });
}

section('a clock time that does not exist (review B M7a)');
{
  check('02:30 on the night clocks go forward does not exist in Mountain time', !I.timeExists('2027-03-14', '02:30'));
  check('23:59 on an ordinary day does', I.timeExists('2026-12-10', '23:59'));
  const kinds = [{ id: 'homework' }];
  const r = I.checkForm({ kindId: 'homework', title: 'T', description: '', delivery: 'online_questions', grading: 'human_graded',
    points: '10', time: '02:30', allDate: '2027-03-14', sectionDates: {} }, { kinds });
  check('the form says so rather than saving a different time', r.length === 1 && /does not exist|skip/i.test(r[0]), r.join('|'));
}

section('removing an item states what goes with it (review B1)');
{
  const off = { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true };
  const withQ = (nq, nk) => ({
    'assignment_offerings.select': (s) => (s.filters.neq ? [] : off),
    'activities.select': [{ id: 'act-9' }],
    'questions.select': Array.from({ length: nq }, (_, i) => ({ id: `q${i}` })),
    'question_keys.select': { __count: nk },
  });
  reset(withQ(3, 4));
  let pre = await I.previewRemoval(db, 'o-1');
  eq('the preview counts questions and key versions', [pre.error, pre.impact], [null, { questions: 3, keys: 4 }]);
  check('the warning states both numbers', /3 questions/.test(I.removalWarning('Quiz', pre.impact)) && /4 answer key versions/.test(I.removalWarning('Quiz', pre.impact)));
  check('an item with nothing under it gets the short warning', !/also deletes/.test(I.removalWarning('Quiz', { questions: 0, keys: 0 })));
  check('one question and one key use the singular', /1 question and 1 answer key version\./.test(I.removalWarning('Quiz', { questions: 1, keys: 1 })));

  reset(withQ(3, 4));
  let r = await I.removeItem(db, 'o-1');
  check('without an acknowledgement nothing is deleted and the counts come back',
    !r.error && r.needsConfirm?.questions === 3 && r.needsConfirm?.keys === 4 && writesTo('assignment_offerings', 'delete').length === 0);
  reset(withQ(3, 4));
  r = await I.removeItem(db, 'o-1', { questions: 3, keys: 4 });
  check('an acknowledgement of the counts WITHOUT the second keys confirm is not enough', !!r.needsConfirm && CALLS.every(c => c.verb !== 'delete'));
  reset(withQ(3, 4));
  r = await I.removeItem(db, 'o-1', { questions: 2, keys: 4, keysConfirmed: true });
  check('an acknowledgement of OTHER counts is not enough (the item changed while the dialog was open)', !!r.needsConfirm && CALLS.every(c => c.verb !== 'delete'));
  reset(withQ(3, 4));
  r = await I.removeItem(db, 'o-1', { questions: 3, keys: 4, keysConfirmed: true });
  eq('with the counts and the second confirm it deletes, offering first', [r.error, CALLS.filter(c => c.verb === 'delete').map(c => c.table)],
    [null, ['assignment_offerings', 'assignments']]);
  reset(withQ(2, 0));
  r = await I.removeItem(db, 'o-1', { questions: 2, keys: 0 });
  eq('questions with no keys need only the first confirm', r.error, null);
  check('the second confirm names the loss', /cannot be recovered/.test(I.KEYS_SECOND_CONFIRM));
  reset({ ...withQ(3, 4), 'assignment_offerings.delete': [] });
  r = await I.removeItem(db, 'o-1', { questions: 3, keys: 4, keysConfirmed: true });
  check('a delete that touched no row is not reported as removed', !!r.error && /not removed/.test(r.error.message));
  reset({ ...withQ(3, 4), 'question_keys.select': { __error: { message: 'down' } } });
  r = await I.removeItem(db, 'o-1');
  check('a count that cannot be read refuses the removal', !!r.refused && CALLS.every(c => c.verb !== 'delete'));
}

section('switching delivery states what goes with it, and the cancel path writes nothing (review B1)');
{
  const q = { id: 'o-1', entered_on_new_page: true };
  const stubs = (nq, nk) => ({
    'assignment_offerings.select': q,
    'questions.select': Array.from({ length: nq }, (_, i) => ({ id: `q${i}` })),
    'question_keys.select': { __count: nk },
  });
  const qItem = item({ paths: [{ delivery: 'online_questions', grading: 'human_graded', modality: 'questions', activityId: 'act-1', content: {} }] });
  const sw = form({ delivery: 'typed_response', grading: 'human_graded' });
  reset(stubs(5, 7));
  let r = await I.updateItem(db, ctx, qItem, sw);
  check('without an acknowledgement it asks, with the counts, and writes nothing',
    !r.error && r.needsConfirm?.questions === 5 && r.needsConfirm?.keys === 7 && CALLS.every(c => c.verb === 'select' || c.table === 'questions' || c.table === 'question_keys') &&
    CALLS.filter(c => c.verb !== 'select').length === 0, JSON.stringify(r));
  check('the cancel path is just that: the person never calls again, and there is nothing to undo', writesTo('activities').length === 0);
  check('the switch warning states both numbers', /5 questions/.test(I.switchWarning('Quiz', { questions: 5, keys: 7 })) && /7 answer key versions/.test(I.switchWarning('Quiz', { questions: 5, keys: 7 })));
  reset(stubs(5, 7));
  r = await I.updateItem(db, ctx, qItem, sw, { questions: 5, keys: 7 });
  check('keys need the second confirm too', !!r.needsConfirm && writesTo('assignment_offerings', 'update').length === 0);
  reset(stubs(5, 7));
  r = await I.updateItem(db, ctx, qItem, sw, { questions: 5, keys: 7, keysConfirmed: true });
  eq('with both confirms the switch goes through', r.error, null);
  reset(stubs(0, 0));
  r = await I.updateItem(db, ctx, qItem, sw);
  eq('an empty path switches with no question', r.error, null);
}

section('a switch to or from "Checked automatically" with a different kind is refused (review B M1)');
{
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  const auto = item({ paths: [{ delivery: 'online_questions', grading: 'auto_checked', modality: 'questions', activityId: 'act-1', content: {} }] });
  let r = await I.updateItem(db, ctx, auto, form({ delivery: 'typed_response', grading: 'human_graded' }));
  check('away from auto-checked: refused before anything is written', !!r.error && /Checked automatically/.test(r.error.message) && CALLS.filter(c => c.verb !== 'select').length === 0, r.error?.message);
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } });
  r = await I.updateItem(db, ctx, item(), form({ delivery: 'online_questions', grading: 'auto_checked' }));
  check('toward auto-checked: refused the same way', !!r.error && /Checked automatically/.test(r.error.message) && CALLS.filter(c => c.verb !== 'select').length === 0);
}

section('a save checks that the item is the one that was opened (review B S4)');
{
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true, updated_at: '2026-11-05T10:00:00Z' } });
  let r = await I.updateItem(db, ctx, item({ updatedAt: '2026-11-05T09:00:00Z' }), form({ delivery: 'in_person', grading: 'hand_entered' }));
  check('an item changed since the form opened is refused and nothing is written', r.error?.code === '40001' && CALLS.filter(c => c.verb !== 'select').length === 0);
  check('the refusal reads as a sentence', /changed after you opened/.test(I.plainError(r.error)));

  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true, updated_at: '2026-11-05T10:00:00Z' } });
  r = await I.updateItem(db, ctx, item({ updatedAt: '2026-11-05T10:00:00Z' }), form({ delivery: 'in_person', grading: 'hand_entered' }));
  eq('the same stamp saves', r.error, null);
  const up = writesTo('assignment_offerings', 'update')[0];
  eq('and the update itself is guarded by that stamp', up.filters.updated_at, '2026-11-05T10:00:00Z');

  // The race: the stamp read at the start differs from the one read again after the empty update.
  let reads = 0;
  reset({ 'assignment_offerings.select': () => ({ id: 'o-1', entered_on_new_page: true, updated_at: ++reads === 1 ? 'T1' : 'T2' }),
          'assignment_offerings.update': [] });
  r = await I.updateItem(db, ctx, item({ updatedAt: 'T1' }), form({ delivery: 'in_person', grading: 'hand_entered' }));
  check('an update that touched no row because another window saved first is refused as a clash',
    r.error?.code === '40001' && writesTo('assignments', 'update').length === 0, JSON.stringify(r.error));
  // No race: the row is unchanged and still the update matched nothing, so the database would not let this person write.
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true, updated_at: 'T1' }, 'assignment_offerings.update': [] });
  r = await I.updateItem(db, ctx, item({ updatedAt: 'T1' }), form({ delivery: 'in_person', grading: 'hand_entered' }));
  check('...and an empty update on an unchanged row reads as no permission, not as an edit clash (B2 M7)',
    r.error?.code === '42501' && /permission/.test(I.plainError(r.error)) && writesTo('assignments', 'update').length === 0, JSON.stringify(r.error));
}

section('a tutor with no link can be given its id; one with a link or a student cannot (B2 S3)');
{
  const tutor = (content) => item({ paths: [{ delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', activityId: 'act-t', slug: 'phys-x-tutor-e0114065', content }] });
  const tf = (o = {}) => form({ delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'lesson-04-fields', interactiveUrl: '', ...o });
  const base = { 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } };
  reset({ ...base, 'activities.select': { content: { artifact_url: null } }, 'submission_activities.select': { __count: 0 } });
  let r = await I.updateItem(db, ctx, tutor({}), tf());
  const act = writesTo('activities', 'update')[0];
  check('a tutor with no link and no student work takes the new id', r.error === null && act?.payload.slug === 'lesson-04-fields', JSON.stringify([r.error, act?.payload]));
  reset({ ...base, 'activities.select': { content: { artifact_url: 'https://claude.ai/x' } }, 'submission_activities.select': { __count: 0 } });
  r = await I.updateItem(db, ctx, tutor({}), tf());
  check('a tutor that has meanwhile been given a link keeps its id (read again at the write)', !!r.error && /fixed/.test(r.error.message) && writesTo('activities', 'update').length === 0, JSON.stringify(r.error));
  reset({ ...base, 'activities.select': { content: { artifact_url: null } }, 'submission_activities.select': { __count: 2 } });
  r = await I.updateItem(db, ctx, tutor({}), tf());
  check('a tutor a student has used keeps its id', !!r.error && /fixed/.test(r.error.message) && writesTo('activities', 'update').length === 0);
  reset({ ...base });
  r = await I.updateItem(db, ctx, tutor({ artifact_url: 'https://claude.ai/x' }), tf({ interactiveSlug: 'phys-x-tutor-e0114065', interactiveUrl: 'https://claude.ai/x' }));
  check('an unchanged id writes no slug', r.error === null && !('slug' in (writesTo('activities', 'update')[0]?.payload || {})), JSON.stringify(r.error));
}

section('counting questions reads past the 1000-row cap (B2 S8)');
{
  const rows = (n, from) => Array.from({ length: n }, (_, i) => ({ id: `q-${from + i}` }));
  reset({ 'questions.select': (state) => (state.filters[0] !== undefined ? rows(1000, 0) : rows(250, 1000)),
          'question_keys.select': { __count: 3 } });
  const rangeCalls = [];
  const wrapped = { from: (table) => { const c = window.db.from(table); const orig = c.range; c.range = (a, b) => { rangeCalls.push([table, a, b]); return orig(a, b); }; return c; } };
  const r = await I.countQuestionsAndKeys(wrapped, ['act-1']);
  check('a second page is requested when the first is full', rangeCalls.filter(c => c[0] === 'questions').length >= 2, JSON.stringify(rangeCalls));
}

section('a failure after the offering row says what was already saved (review B M9)');
{
  reset({ 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true }, 'assignments.update': () => ({ __error: { code: '23505', message: 'x (assignments_slug_unique)' } }) });
  const r = await I.updateItem(db, ctx, item(), form());
  check('the error comes back with a partial sentence', !!r.error && /already saved/.test(r.partial || ''), JSON.stringify(r));
}

section('database refusals read as the rule that was hit (review B S7)');
{
  const e = I.plainError;
  check('a title clash says change the title', /Change the title/.test(e({ code: '23505', message: 'duplicate key value violates unique constraint "assignments_slug_unique"' })));
  check('a tutor id clash does not tell you to change the title', /tutor id/.test(e({ code: '23505', message: 'duplicate key ... "activities_slug_key"' })) && !/title/.test(e({ code: '23505', message: '"activities_slug_key"' })));
  check('a due-date clash says it was another window', /another window/.test(e({ code: '23505', message: '"assignment_due_dates_pkey"' })));
  check('an unknown clash does not blame the title', !/title/.test(e({ code: '23505', message: '"something_else"' })));
  check('a timeout does not claim nothing changed', !/Nothing was changed/.test(e({ code: '57014', message: 'canceling statement due to statement timeout' })));
  check('a dropped connection says it is not known', /not known/.test(e({ message: 'TypeError: Failed to fetch' })));
  check('a foreign key refusal is explained', /depend/.test(e({ code: '23503', message: 'x' })));
}

process.exit(summary() ? 0 : 1);
