// test-items-paths.mjs — the Assignments page's release window, assignment number, two-path items (a typed response and a
// tutor on one item), tutor replacement and removal, unlock, the points warning and removal with counts.
//
// WHAT THIS DEFENDS
//   * The release window matches the rule the student pages apply (schema.js releaseAt), floored to the start of a
//     Mountain day, and "N days before" gives N full days. A fixed date reads back the way it was stored.
//   * A two-path item writes the right grading role on each path under each policy (the older editor's roleFor,
//     compared for every combination), stores the commit rule only when there is a choice to lock, and reads back to the
//     same policy, switch rule, number and opening date it was written from (a round trip through loadItems' shaping).
//   * The tutor id is a posting address: replacing it counts the reports it would delete and the cadets it would release,
//     writes nothing until the person has been told those numbers, releases the cadets in the person's own name BEFORE the
//     delete, and refuses when another term schedules the same tutor.
//   * Who earns credit does not move once cadets have started; the typed path cannot be dropped to a practice-only AI
//     draft; a save that changes points on an assignment with grades is stopped until the person confirms.
//   * Removal states what goes with the item, tutors included.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db. It shows which queries and writes the module issues, in what order. It does
//   not show that the database accepts them: tests/staging/test_items_paths_scratch.py runs the same writes against a
//   scratch database with the finalize guard (migration 078) in place.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

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
const LK = await import('../../site/js/lesson-link.js');
const L = await import('../../site/js/faculty-lessons.js');
const S = await import('../../site/js/schema.js');
const db = window.db;
const reset = (r = {}) => { RESPONSES = r; CALLS = []; SEQ = 0; };
const writesTo = (table, verb) => CALLS.filter(c => c.table === table && (!verb || c.verb === verb));
const order = () => CALLS.map(c => `${c.table}.${c.verb}`);

const sections = [{ id: 's-m', code: 'M1A', meeting_days: ['M'] }, { id: 's-t', code: 'T1A', meeting_days: ['T'] }];
// What bootstrap() gives a page (site/js/auth.js), and what the page turns it into for a save. The test used to write the save
// context by hand, with a `user` the real page did not send, so a release of committed cadets passed here and threw there.
const pageCtx = { currentCourse: 'course-1', currentCourseCode: 'gate-entry', currentOffering: 'co-1',
  user: { id: 'user-director', email: 'director@example.test' }, instructorRow: { id: 'user-director', is_global_admin: false }, role: 'faculty' };
const ctx = I.saveContext(pageCtx, sections);
const kinds = [{ id: 'k1', label: 'K', sort_order: 1, default_delivery: 'typed_response', default_grading: 'human_graded' }];
const base = (o = {}) => ({ ...I.emptyForm(kinds[0], sections), title: 'Circuits', points: '2', dayDates: { M: '2026-12-10', T: '2026-12-10' }, sameDate: true,
  delivery: 'typed_response', grading: 'human_graded', ...o });
const twoPath = (o = {}) => base({ withTutor: true, policy: 'choice', switchPolicy: 'lock_on_commit',
  interactiveSlug: 'tutor-1', interactiveUrl: 'https://example.test/t', ...o });

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the release window: Mountain days, floored, and the same rule the student pages apply');
{
  const original = process.env.TZ;
  process.env.TZ = 'America/Denver';
  eq('the standard option names the lookahead the student pages use', I.RELEASE_CHOICES[0].label.startsWith(`${S.LOOKAHEAD_DAYS} days`), true);
  eq('the five choices', I.RELEASE_CHOICES.map(c => c.id), ['standard', 'd3', 'd14', 'now', 'custom']);
  const due = '2026-12-11T06:59:59.000Z';                        // 10 December, 23:59:59 in Denver
  eq('standard clears the boxes', I.resolveReleasePreset('standard', due), null);
  eq('3 days before 10 Dec opens on 7 Dec at 00:00', I.resolveReleasePreset('d3', due), { date: '2026-12-07', time: '00:00' });
  eq('14 days before opens on 26 Nov at 00:00: fourteen full days', I.resolveReleasePreset('d14', due), { date: '2026-11-26', time: '00:00' });
  eq('with no deadline a relative preset gives nothing, never a date off today\'s clock', I.resolveReleasePreset('d3', null), null);
  eq('"as soon as it is published" is the minute now, in Mountain time',
    I.resolveReleasePreset('now', null, Date.UTC(2027, 0, 15, 17, 45, 30)), { date: '2027-01-15', time: '10:45' });
  // The same instant the student pages compute for the standard window.
  for (const dueDate of ['2026-12-10', '2027-03-15', '2027-03-08', '2026-11-03', '2027-01-04']) {
    const dueIso = new Date(I.zoneWallToInstant(dueDate, '23:59')).toISOString();
    const seed = I.resolveReleasePreset('custom', dueIso);                    // the standard date, seeded into the boxes
    const stored = I.opensAtFor({ opensDate: seed.date, opensTime: seed.time });
    const student = S.releaseAt({ opensAt: null }, new Date(dueIso));
    eq(`due ${dueDate}: a seeded custom date is the instant releaseAt gives the student`, new Date(stored).getTime(), student.getTime());
  }
  eq('no date stores the standard window (null)', I.opensAtFor({ opensDate: '', opensTime: '00:00' }), null);
  eq('a date and time are stored as Mountain wall clock in UTC', I.opensAtFor({ opensDate: '2026-12-07', opensTime: '08:30' }), '2026-12-07T15:30:00.000Z');
  eq('it reads back the way it was stored', I.releaseFromOpensAt('2026-12-07T15:30:00.000Z'), { mode: 'custom', date: '2026-12-07', time: '08:30' });
  eq('null reads back as the standard window', I.releaseFromOpensAt(null), { mode: 'standard', date: '', time: '00:00' });
  eq('the assignment number is a position or nothing', [I.positionFor({ lessonNumber: '' }), I.positionFor({ lessonNumber: '7' }), I.positionFor({})], [null, 7, null]);
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
}

section('the form refuses what it cannot store, and points at the field');
{
  const bad = (o) => I.checkForm(base(o), { kinds, sections });
  eq('the plain form is fine', bad({}), []);
  check('a number that is not whole', bad({ lessonNumber: '2.5' }).length === 1 && I.moreOptionsTarget(bad({ lessonNumber: '2.5' })[0]) === 'i-num');
  check('a number past the column', bad({ lessonNumber: '40000' }).length === 1);
  eq('a number of zero is allowed', bad({ lessonNumber: '0' }), []);
  check('an opening date that is not real', I.moreOptionsTarget(bad({ opensDate: '2026-02-30' })[0]) === 'i-opens');
  check('an opening time that is not real', bad({ opensDate: '2026-12-07', opensTime: '25:00' }).length === 1 && I.moreOptionsTarget(bad({ opensDate: '2026-12-07', opensTime: '25:00' })[0]) === 'i-opens');
  check('an opening time the clocks skip', bad({ opensDate: '2027-03-14', opensTime: '02:30' }).length === 1);
  eq('a tutor beside a typed response needs its id', bad({ withTutor: true, interactiveSlug: '' }).length, 1);
  eq('... and passes with one', bad({ withTutor: true, interactiveSlug: 'tutor-1' }), []);
  eq('a tutor id already saved is not asked for again', I.checkForm(base({ withTutor: true, interactiveSlug: '' }), { kinds, sections, slugFrozen: true }), []);
  const p = bad({ withTutor: true, interactiveSlug: 'tutor-1', policy: 'tutor', grading: 'ai_drafted' });
  check('an AI draft cannot sit on a practice-only typed response', p.length === 1 && I.moreOptionsTarget(p[0]) === 'i-policy', p.join());
  eq('an AI draft can sit on a typed response that earns credit', bad({ withTutor: true, interactiveSlug: 't', policy: 'typed', grading: 'ai_drafted' }), []);
  check('an unknown policy is refused', bad({ withTutor: true, interactiveSlug: 't', policy: 'both' }).length === 1);
  check('an unknown commit rule is refused', bad({ withTutor: true, interactiveSlug: 't', switchPolicy: 'whenever' }).length === 1);
  eq('a commit rule is not checked when there is no second path', bad({ switchPolicy: 'whenever' }), []);
  const dbFile = (await import('node:fs')).readFileSync(new URL('../../supabase/migrations/app/001_core_model.sql', import.meta.url), 'utf8');
  const stored = [...dbFile.slice(dbFile.indexOf('switch_policy      text')).split(')')[0].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  eq('the commit rules offered are the ones the database accepts', [...I.SWITCH_POLICIES].sort(), [...new Set(stored)].sort());
  check('every commit rule and policy has a label', I.SWITCH_POLICIES.every(s => I.SWITCH_LABEL[s]) && I.POLICIES.every(s => I.POLICY_LABEL[s]));
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('who earns credit: the page\'s words give the older editor\'s roles');
{
  for (const [policy, old] of [['choice', 'choice'], ['typed', 'preflight'], ['tutor', 'interaction']]) {
    const plan = I.pathPlan(twoPath({ policy }));
    eq(`${policy}: the typed path`, plan[0].role, L.roleFor(old, 'written'));
    eq(`${policy}: the tutor path`, plan[1].role, L.roleFor(old, 'interactive'));
    eq(`${policy}: delivery and grading of the two paths`, plan.map(p => `${p.delivery}/${p.grading}`), [`typed_response/human_graded`, 'interactive_tutor/effort']);
  }
  eq('one path when the form wants one', I.pathPlan(base()).map(p => p.which), ['main']);
  eq('a tutor-only item is one path', I.pathPlan(base({ delivery: 'interactive_tutor', grading: 'effort', withTutor: true })).map(p => p.which), ['main']);
  const path = (modality, delivery, grading, role) => ({ modality, delivery, grading, role, activityId: modality });
  eq('nothing', I.pathShape([]).kind, 'none');
  eq('one path', I.pathShape([path('written', 'typed_response', 'human_graded', 'graded')]).kind, 'single');
  const duo = I.pathShape([path('interactive', 'interactive_tutor', 'effort', 'graded'), path('written', 'typed_response', 'ai_drafted', 'graded')]);
  eq('a typed response and a tutor, in either order, are an item this page edits', [duo.kind, duo.policy], ['choice', 'choice']);
  eq('typed earns credit, tutor practice', I.pathShape([path('written', 'typed_response', 'human_graded', 'graded'), path('interactive', 'interactive_tutor', 'effort', 'practice')]).policy, 'typed');
  eq('tutor earns credit, typed practice', I.pathShape([path('written', 'typed_response', 'human_graded', 'practice'), path('interactive', 'interactive_tutor', 'effort', 'graded')]).policy, 'tutor');
  eq('a practice-only AI draft is not an item this page edits', I.pathShape([path('written', 'typed_response', 'ai_drafted', 'practice'), path('interactive', 'interactive_tutor', 'effort', 'graded')]).kind, 'locked');
  eq('two practice paths are not either', I.pathShape([path('written', 'typed_response', 'human_graded', 'practice'), path('interactive', 'interactive_tutor', 'effort', 'practice')]).kind, 'locked');
  eq('questions beside a tutor are not either', I.pathShape([path('questions', 'online_questions', 'auto_checked', 'graded'), path('interactive', 'interactive_tutor', 'effort', 'graded')]).kind, 'locked');
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('createItem with a typed response and a tutor, and the round trip back');
for (const [policy, grading] of [['choice', 'human_graded'], ['choice', 'ai_drafted'], ['typed', 'ai_drafted'], ['tutor', 'human_graded']]) {
  reset();
  const form = twoPath({ policy, grading, switchPolicy: 'lock_on_start', lessonNumber: '4', slug: 'lesson-04-circuits',
    opensDate: '2026-12-07', opensTime: '08:30', interactiveTitle: 'Circuits tutor', interactiveDesc: 'Ten minutes' });
  const r = await I.createItem(db, ctx, form);
  eq(`${policy}/${grading}: it succeeds`, r.error, null);
  eq(`${policy}/${grading}: the writes, in order: both activities, the offering, both paths, the dates`, order(),
    ['assignments.insert', 'activities.insert', 'activities.insert', 'assignment_offerings.insert', 'offering_activities.insert', 'offering_activities.insert',
     'assignment_due_dates.delete', 'assignment_due_dates.insert']);
  const acts = writesTo('activities', 'insert').map(c => c.payload);
  eq(`${policy}/${grading}: typed activity first, tutor second`, acts.map(a => [a.modality, a.position]), [['written', 0], ['interactive', 1]]);
  eq(`${policy}/${grading}: the tutor keeps the id typed, its link, title and description`,
    [acts[1].slug, acts[1].content, acts[1].title], ['tutor-1', { artifact_url: 'https://example.test/t', description: 'Ten minutes' }, 'Circuits tutor']);
  const paths = writesTo('offering_activities', 'insert').map(c => c.payload);
  eq(`${policy}/${grading}: delivery, grading and warn rule on each path`,
    paths.map(p => [p.delivery, p.grading, p.warn_earns_full]), [['typed_response', grading, true], ['interactive_tutor', 'effort', false]]);
  eq(`${policy}/${grading}: the role on each path is the older editor's`,
    paths.map(p => p.grading_role), [L.roleFor({ typed: 'preflight', tutor: 'interaction', choice: 'choice' }[policy], 'written'), L.roleFor({ typed: 'preflight', tutor: 'interaction', choice: 'choice' }[policy], 'interactive')]);
  const ao = writesTo('assignment_offerings', 'insert')[0].payload;
  eq(`${policy}/${grading}: still unpublished and marked`, [ao.is_published, ao.entered_on_new_page], [false, true]);
  eq(`${policy}/${grading}: number and opening date are stored`, [ao.position, ao.opens_at], [4, '2026-12-07T15:30:00.000Z']);
  eq(`${policy}/${grading}: the commit rule is stored only when the cadet chooses`, ao.switch_policy, policy === 'choice' ? 'lock_on_start' : undefined);
  eq(`${policy}/${grading}: the assignment takes the id the link gave`, writesTo('assignments', 'insert')[0].payload.slug, 'lesson-04-circuits');

  // Round trip: shape the rows the writes made as the list read would return them, and read the policy back.
  const row = {
    id: 'o-1', assignment_id: 'a-1', points_possible: 2, grading_mode: 'points', due_at: ao.due_at, due_by_day: ao.due_by_day,
    is_published: false, position: ao.position, updated_at: 't', late_allowed: true, is_bonus: false, prog_included: false,
    opens_at: ao.opens_at, switch_policy: ao.switch_policy || 'lock_on_commit', entered_on_new_page: true,
    assignments: { id: 'a-1', slug: 'lesson-04-circuits', title: 'Circuits', description: '', kind_id: 'k1' },
    offering_activities: paths.map((p, i) => ({
      grading_role: p.grading_role, available_after: p.available_after, is_visible: p.is_visible, delivery: p.delivery, grading: p.grading, position: p.position,
      activities: { id: 'act-' + i, slug: acts[i].slug, modality: acts[i].modality, title: acts[i].title, content: acts[i].content },
    })),
    assignment_due_dates: [],
  };
  const shaped = I.shapeItem(row, kinds, sections);
  const shape = I.pathShape(shaped.paths);
  eq(`${policy}/${grading}: read back as an item this page edits, with the same policy`, [shape.kind, shape.policy], ['choice', policy]);
  eq(`${policy}/${grading}: number, opening date, commit rule and tutor id read back`, [shaped.position, shaped.opensAt, shaped.switchPolicy, shaped.tutorSlug],
    [4, '2026-12-07T15:30:00.000Z', policy === 'choice' ? 'lock_on_start' : 'lock_on_commit', 'tutor-1']);
  eq(`${policy}/${grading}: and the opening date shows as the boxes the person typed`, I.releaseFromOpensAt(shaped.opensAt), { mode: 'custom', date: '2026-12-07', time: '08:30' });
}
{
  reset();
  await I.createItem(db, ctx, base());
  const ao = writesTo('assignment_offerings', 'insert')[0].payload;
  eq('an ordinary item stores no commit rule, no number, and the standard window', [ao.switch_policy, ao.position, ao.opens_at], [undefined, null, null]);
  eq('and one activity and one path', [writesTo('activities', 'insert').length, writesTo('offering_activities', 'insert').length], [1, 1]);
}
{
  reset({ 'activities.insert': (st) => (st.payload.modality === 'interactive' ? { __error: { code: '23505', message: 'activities_slug_key' } } : undefined) });
  const r = await I.createItem(db, ctx, twoPath());
  check('a tutor id that is taken stops the create', r.error?.code === '23505');
  eq('and the half-made assignment is removed', writesTo('assignments', 'delete').length, 1);
}

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('updateItem: add a tutor beside a typed response, change who earns credit');
const typedItem = (o = {}) => ({ offeringId: 'o-1', assignmentId: 'a-1', slug: 'x', title: 'Circuits', isNew: true, points: 2, position: null, opensAt: null, updatedAt: null,
  paths: [{ delivery: 'typed_response', grading: 'human_graded', modality: 'written', role: 'graded', activityId: 'act-w', slug: 'gate-x-written-aaaaaaaa', order: 0, content: { questions: [] } }], ...o });
const duoItem = (roles = { typed: 'graded', tutor: 'graded' }, o = {}) => typedItem({
  paths: [
    { delivery: 'typed_response', grading: 'human_graded', modality: 'written', role: roles.typed, activityId: 'act-w', slug: 'gate-x-written-aaaaaaaa', order: 0, content: { questions: [] } },
    { delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', role: roles.tutor, activityId: 'act-t', slug: 'tutor-1', order: 1, availableAfter: 'always', isVisible: true, content: { artifact_url: 'https://example.test/t' } },
  ], ...o });
const FRESH = { 'assignment_offerings.select': { id: 'o-1', entered_on_new_page: true } };
const withFresh = (extra = {}) => ({ ...FRESH, ...extra });
{
  reset(withFresh());
  let r = await I.updateItem(db, ctx, typedItem(), twoPath({ policy: 'choice' }));
  eq('adding a tutor succeeds', r.error, null);
  eq('the writes: offering row, assignment, tutor activity, tutor path, then the dates',
    order().filter(x => !x.startsWith('assignment_offerings.select')),
    ['assignment_offerings.update', 'assignments.update', 'activities.insert', 'offering_activities.insert', 'assignment_due_dates.delete', 'assignment_due_dates.insert']);
  const oa = writesTo('offering_activities', 'insert')[0].payload;
  eq('the new path is the tutor with effort grading, both earn credit', [oa.delivery, oa.grading, oa.grading_role, oa.position], ['interactive_tutor', 'effort', 'graded', 1]);
  eq('the commit rule goes on the offering row', writesTo('assignment_offerings', 'update')[0].payload.switch_policy, 'lock_on_commit');
  eq('the typed path is left as it is', writesTo('offering_activities', 'update').length, 0);

  reset(withFresh());
  await I.updateItem(db, ctx, typedItem(), twoPath({ policy: 'tutor' }));
  eq('"tutor earns credit" puts the typed path to practice when no cadet has started', writesTo('offering_activities', 'update').map(c => c.payload), [{ grading_role: 'practice' }]);
  eq('... and the tutor is graded', writesTo('offering_activities', 'insert')[0].payload.grading_role, 'graded');

  reset(withFresh({ 'submissions.select': { __count: 2 } }));
  r = await I.updateItem(db, ctx, typedItem(), twoPath({ policy: 'tutor' }));
  check('once cadets have started, who earns credit cannot move, and nothing is written',
    /already has 2 submissions/.test(r.error?.message || '') && CALLS.length === 0, JSON.stringify(r.error));

  reset(withFresh({ 'submissions.select': { __count: 2 } }));
  r = await I.updateItem(db, ctx, typedItem(), twoPath({ policy: 'choice' }));
  eq('but a tutor can be added where the typed path keeps earning credit', r.error, null);
}

section('updateItem: edit both paths of a two-path item');
{
  reset(withFresh());
  let r = await I.updateItem(db, ctx, duoItem(), twoPath({ interactiveUrl: 'https://example.test/new', interactiveDesc: 'New words' }));
  eq('a link change succeeds', r.error, null);
  const t = writesTo('activities', 'update').find(c => c.filters.id === 'act-t');
  eq('the tutor row takes the new link and description, and keeps its id', [t.payload.content.artifact_url, t.payload.content.description, t.payload.slug], ['https://example.test/new', 'New words', undefined]);
  eq('no path is added or removed', [writesTo('activities', 'insert').length, writesTo('activities', 'delete').length, writesTo('offering_activities', 'insert').length], [0, 0, 0]);

  reset(withFresh());
  await I.updateItem(db, ctx, duoItem(), twoPath({ grading: 'ai_drafted' }));
  const g = writesTo('offering_activities', 'update').map(c => c.payload);
  eq('the typed path\'s grading changes with its yellow-marks rule', g, [{ grading: 'ai_drafted', warn_earns_full: true }]);

  reset(withFresh());
  await I.updateItem(db, ctx, duoItem(), twoPath({ switchPolicy: 'free_until_commit' }));
  eq('the commit rule is a column on the offering row', writesTo('assignment_offerings', 'update')[0].payload.switch_policy, 'free_until_commit');

  reset(withFresh());
  r = await I.updateItem(db, ctx, duoItem(), base({ delivery: 'online_questions', grading: 'human_graded' }));
  check('changing how the work is done while the tutor is attached is refused, nothing written',
    /Untick/.test(r.error?.message || '') && CALLS.length === 0);

  reset(withFresh());
  await I.updateItem(db, ctx, duoItem({ typed: 'graded', tutor: 'practice' }), twoPath({ policy: 'choice' }));
  eq('with no cadet started, practice can become credit: the tutor row is updated', writesTo('offering_activities', 'update').map(c => [c.payload, c.filters.activity_id]), [[{ grading_role: 'graded' }, 'act-t']]);

  reset(withFresh({ 'grades.select': { __count: 3 } }));
  r = await I.updateItem(db, ctx, duoItem({ typed: 'graded', tutor: 'practice' }), twoPath({ policy: 'choice' }));
  check('with grades given, it is refused and says how many', /3 grades/.test(r.error?.message || '') && CALLS.length === 0, JSON.stringify(r.error));
}

section('updateItem: remove the tutor, with counts and an unlock first');
{
  const committed = (st) => (st.opts?.head ? { __count: 3 } : [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }]);
  const reports = (st) => (st.opts?.head ? { __count: 2 } : []);
  reset(withFresh({ 'submissions.select': committed, 'submission_activities.select': reports }));
  let r = await I.updateItem(db, ctx, duoItem(), base());
  eq('the first call writes nothing and says what would be lost', [r.error, r.needsTutorConfirm, CALLS.length],
    [null, { kind: 'drop', slug: 'tutor-1', committed: 3, reports: 2, marked: 0 }, 0]);
  check('the warning states both numbers', /2 reports/.test(I.tutorChangeWarning('drop', 'Circuits', r.needsTutorConfirm)) && /cadet who had committed to it \(3\)/.test(I.tutorChangeWarning('drop', 'Circuits', r.needsTutorConfirm)));
  r = await I.updateItem(db, ctx, duoItem(), base(), { tutor: { committed: 1, reports: 2 } });
  check('an acknowledgement of other numbers is not enough', !!r.needsTutorConfirm && CALLS.length === 0);
  r = await I.updateItem(db, ctx, duoItem({ typed: 'practice', tutor: 'graded' }), base(), { tutor: { committed: 3, reports: 2 } });
  eq('with the numbers acknowledged it goes ahead', r.error, null);
  const seq = order().filter(x => !x.endsWith('.select'));
  const iUnlock = seq.indexOf('submissions.update'), iDelete = seq.indexOf('activities.delete');
  check('the cadets are released BEFORE the tutor is deleted', iUnlock >= 0 && iDelete > iUnlock, seq.join(' > '));
  const un = writesTo('submissions', 'update')[0];
  eq('the release is attributed to the person acting, and sends the submissions back to draft',
    [un.payload.unlocked_by, un.payload.status, un.payload.chosen_activity_id], ['user-director', 'draft', null]);
  eq('only this term\'s cadets who chose the tutor', un.filters.assignment_offering_id ?? null, null);
  eq('the delete is the tutor activity', writesTo('activities', 'delete')[0].filters.id, 'act-t');
  eq('the typed path earns credit again, being the only one', writesTo('offering_activities', 'update').map(c => [c.payload, c.filters.activity_id]), [[{ grading_role: 'graded' }, 'act-w']]);

  reset(withFresh({ 'submissions.select': { __count: 0 } }));
  r = await I.updateItem(db, ctx, duoItem(), base());
  check('a tutor nobody has touched is removed without a question', r.error === null && !r.needsTutorConfirm && writesTo('activities', 'delete').length === 1);

  reset(withFresh({ 'offering_activities.select': [{ assignment_offering_id: 'o-1' }, { assignment_offering_id: 'o-other', assignment_offerings: { course_offerings: { courses: { code: 'phys-215' }, terms: { label: 'Fall 2026' } } } }] }));
  r = await I.updateItem(db, ctx, duoItem(), base());
  check('a tutor another term schedules is not deleted from here', /phys-215 · Fall 2026/.test(r.error?.message || '') && writesTo('activities', 'delete').length === 0, JSON.stringify(r.error));
}

section('updateItem: replace the tutor with a different id');
{
  const tutorOnly = () => typedItem({ paths: [{ delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', role: 'graded', activityId: 'act-t', slug: 'tutor-1', order: 0, availableAfter: 'always', isVisible: true, content: { artifact_url: 'https://example.test/t' } }] });
  const swapForm = (o = {}) => base({ delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'tutor-2', interactiveUrl: 'https://example.test/t2', swapTutor: true, ...o });
  const committed = (st) => (st.opts?.head ? { __count: 4 } : [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }, { id: 'sub-4' }]);
  reset(withFresh({ 'activities.select': { id: 'taken' } }));
  let r = await I.updateItem(db, ctx, tutorOnly(), swapForm());
  check('a new id that another lesson uses is refused before anything is written', /already used/.test(r.error?.message || '') && writesTo('activities', 'delete').length === 0);

  reset(withFresh({ 'submissions.select': committed, 'submission_activities.select': (st) => (st.opts?.head ? { __count: 5 } : []) }));
  r = await I.updateItem(db, ctx, tutorOnly(), swapForm());
  eq('it asks first, with both numbers, and writes nothing', [r.needsTutorConfirm, CALLS.length], [{ kind: 'swap', slug: 'tutor-1', committed: 4, reports: 5, marked: 0 }, 0]);
  r = await I.updateItem(db, ctx, tutorOnly(), swapForm(), { tutor: { committed: 4, reports: 5 } });
  eq('acknowledged, it replaces', r.error, null);
  const seq = order().filter(x => !x.endsWith('.select'));
  check('release, delete the old, create the new, attach it',
    seq.indexOf('submissions.update') < seq.indexOf('activities.delete') && seq.indexOf('activities.delete') < seq.indexOf('activities.insert')
    && seq.indexOf('activities.insert') < seq.indexOf('offering_activities.insert'), seq.join(' > '));
  const ins = writesTo('activities', 'insert')[0].payload, oa = writesTo('offering_activities', 'insert')[0].payload;
  eq('the new activity has the new id and link', [ins.slug, ins.content.artifact_url, ins.modality], ['tutor-2', 'https://example.test/t2', 'interactive']);
  eq('the new path takes the old one\'s role, delivery and grading', [oa.grading_role, oa.delivery, oa.grading], ['graded', 'interactive_tutor', 'effort']);

  reset(withFresh({ 'submissions.select': { __count: 0 } }));
  r = await I.updateItem(db, ctx, tutorOnly(), swapForm({ interactiveSlug: 'tutor-1' }));
  check('the same id with the replace box ticked is just a new link, in place', r.error === null && writesTo('activities', 'delete').length === 0 && writesTo('activities', 'update').length === 1);

  reset(withFresh({ 'submissions.select': { __count: 0 }, 'activities.insert': () => ({ __error: { code: '23505', message: 'activities_slug_key' } }) }));
  r = await I.updateItem(db, ctx, tutorOnly(), swapForm());
  check('if the new tutor cannot be created after the old is gone, the person is told to add it again', /removed/.test(r.error?.message || '') && !!r.partial);

  reset(withFresh({ 'submissions.select': { __count: 0 } }));
  r = await I.updateItem(db, ctx, duoItem(), twoPath({ interactiveSlug: 'tutor-9', swapTutor: true, policy: 'choice' }));
  eq('on a two-path item the replacement keeps both roles', [r.error, writesTo('offering_activities', 'insert')[0].payload.grading_role, writesTo('offering_activities', 'update').length], [null, 'graded', 0]);
}

section('the unlock helper names the person and does nothing when nobody chose');
{
  reset({ 'submissions.select': [{ id: 's1' }, { id: 's2' }] });
  let r = await I.unlockCommittedTo(db, ctx, 'o-1', ['act-t']);
  eq('two cadets released', r, { error: null, unlocked: 2 });
  eq('by this person, to draft, with the choice cleared', [writesTo('submissions', 'update')[0].payload.unlocked_by, writesTo('submissions', 'update')[0].payload.chosen_activity_id], ['user-director', null]);
  reset({});
  r = await I.unlockCommittedTo(db, ctx, 'o-1', ['act-t']);
  eq('nobody chose it: nothing released', r, { error: null, unlocked: 0 });
  check('no update was sent', writesTo('submissions', 'update').length === 0);
  eq('no activities named: nothing is read', await I.unlockCommittedTo(db, ctx, 'o-1', []), { error: null, unlocked: 0 });
}


section('the save context is what the page builds from bootstrap, and a release needs the person (review 3, C2)');
{
  eq('the context carries the course, the offering, the sections and the person acting',
    [ctx.courseId, ctx.courseCode, ctx.courseOfferingId, ctx.sections.length, ctx.user.id], ['course-1', 'gate-entry', 'co-1', 2, 'user-director']);
  eq('it holds nothing else from the page context', Object.keys(ctx).sort(), ['courseCode', 'courseId', 'courseOfferingId', 'sections', 'user']);
  eq('a page context with no user gives a context with no user, not a throw', I.saveContext({ currentOffering: 'co-1' }, []).user, null);
  const noUser = I.saveContext({ ...pageCtx, user: undefined }, sections);
  const committed = (st) => (st.opts?.head ? { __count: 3 } : [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }]);
  reset(withFresh({ 'submissions.select': committed }));
  let r;
  try { r = await I.updateItem(db, noUser, duoItem(), base(), { tutor: { committed: 3, reports: 0 } }); } catch (e) { r = { threw: String(e) }; }
  check('removing a tutor with committed cadets, with no person on the context, does not throw', !r.threw, r.threw);
  check('it says plainly why, and writes nothing at all (not the offering row either)',
    /who is acting/i.test(r.error?.message || '') && CALLS.filter(c => c.verb !== 'select').length === 0, JSON.stringify(r.error) + order().join());
  reset(withFresh({ 'submissions.select': committed }));
  r = await I.updateItem(db, ctx, duoItem(), base(), { tutor: { committed: 3, reports: 0 } });
  check('the same item with the page\'s own context goes through', r.error === null && writesTo('submissions', 'update').length === 1, JSON.stringify(r.error));
  reset({ 'submissions.select': [{ id: 's1' }] });
  let u;
  try { u = await I.unlockCommittedTo(db, noUser, 'o-1', ['act-t']); } catch (e) { u = { threw: String(e) }; }
  check('the release helper itself returns an error, it does not throw', !u.threw && !!u.error && u.unlocked === 0 && writesTo('submissions', 'update').length === 0, JSON.stringify(u));
  // replacing a tutor: the same
  const tutorOnly = () => typedItem({ paths: [{ delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', role: 'graded', activityId: 'act-t', slug: 'tutor-1', order: 0, availableAfter: 'always', isVisible: true, content: { artifact_url: 'https://example.test/t' } }] });
  reset(withFresh({ 'submissions.select': committed }));
  try { r = await I.updateItem(db, noUser, tutorOnly(), base({ delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'tutor-2', interactiveUrl: 'https://example.test/t2', swapTutor: true }), { tutor: { committed: 3, reports: 0 } }); }
  catch (e) { r = { threw: String(e) }; }
  check('replacing a tutor with committed cadets and no person: an error, no throw, nothing written', !r.threw && !!r.error && CALLS.filter(c => c.verb !== 'select').length === 0, r.threw || JSON.stringify(r.error));
}

section('the release counts what it is about to release, and says how many already have a mark (review 3, M5)');
{
  const subs = (n) => (st) => (st.opts?.head ? { __count: n } : Array.from({ length: n }, (_, i) => ({ id: 'sub-' + i })));
  const marked = (n) => (st) => (st.opts?.head ? { __count: n } : []);
  reset(withFresh({ 'submissions.select': subs(3), 'grades.select': marked(2) }));
  let r = await I.updateItem(db, ctx, duoItem(), base());
  eq('the impact carries the number of released cadets who already have a mark', [r.needsTutorConfirm.committed, r.needsTutorConfirm.marked], [3, 2]);
  const text = I.tutorChangeWarning('drop', 'Circuits', r.needsTutorConfirm);
  check('the warning says so, and does not promise those cadets a fresh start', /2 of them already have a mark/.test(text) && /mark stays/.test(text), text);
  const plain = I.tutorChangeWarning('drop', 'Circuits', { slug: 't', committed: 3, reports: 1, marked: 0 });
  check('with no marks it does not mention them', !/mark/.test(plain.replace(/Remove the tutor/, '')), plain);
  // A cadet who commits between the count and the release is not released without having been counted.
  reset({ 'submissions.select': [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }] });
  let u = await I.unlockCommittedTo(db, ctx, 'o-1', ['act-t'], 3);
  check('four are committed now where three were acknowledged: nobody is released', !!u.error && u.unlocked === 0 && writesTo('submissions', 'update').length === 0, JSON.stringify(u));
  reset({ 'submissions.select': [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
  u = await I.unlockCommittedTo(db, ctx, 'o-1', ['act-t'], 3);
  eq('the acknowledged number releases', [u.error, u.unlocked], [null, 3]);
  // more than one page of cadets: the read goes on until a short page
  let page = 0;
  reset({ 'submissions.select': () => { page++; return page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: 'p1-' + i })) : [{ id: 'p2-0' }, { id: 'p2-1' }]; } });
  u = await I.unlockCommittedTo(db, ctx, 'o-1', ['act-t']);
  eq('past a thousand cadets the read continues, and all are released', [u.error, u.unlocked], [null, 1002]);
  check('and the update is split so no request carries a thousand ids', writesTo('submissions', 'update').length > 1 && writesTo('submissions', 'update').every(c => (c.filters.id || []).length <= 200));
}

section('a replacement that cannot be created puts the old tutor back (review 3, M3)');
{
  const tutorOnly = () => typedItem({ paths: [{ delivery: 'interactive_tutor', grading: 'effort', modality: 'interactive', role: 'graded', activityId: 'act-t', slug: 'tutor-1', title: 'Old tutor', order: 0, availableAfter: 'always', isVisible: true, content: { artifact_url: 'https://example.test/t' } }] });
  const swapForm = (o = {}) => base({ delivery: 'interactive_tutor', grading: 'effort', interactiveSlug: 'tutor-2', interactiveUrl: 'https://example.test/t2', swapTutor: true, ...o });
  let n = 0;
  reset(withFresh({ 'submissions.select': { __count: 0 }, 'activities.insert': () => (++n === 1 ? { __error: { code: '23505', message: 'activities_slug_key' } } : undefined) }));
  const r = await I.updateItem(db, ctx, tutorOnly(), swapForm());
  const ins = writesTo('activities', 'insert').map(c => c.payload);
  check('the second insert is the old tutor, with its id, link and title', ins.length === 2 && ins[1].slug === 'tutor-1' && ins[1].content.artifact_url === 'https://example.test/t' && ins[1].title === 'Old tutor', JSON.stringify(ins));
  check('and it is attached again with its old role', writesTo('offering_activities', 'insert').length === 1 && writesTo('offering_activities', 'insert')[0].payload.grading_role === 'graded');
  check('the person is told it was put back, and that its reports are gone', /put back/.test(r.error?.message || '') && /reports/.test(r.error?.message || '') && !!r.partial, JSON.stringify(r.error));
  reset(withFresh({ 'submissions.select': { __count: 0 }, 'activities.insert': () => ({ __error: { code: '23505', message: 'activities_slug_key' } }) }));
  const r2 = await I.updateItem(db, ctx, tutorOnly(), swapForm());
  check('if even that fails, the person is told to add the tutor again', /removed/.test(r2.error?.message || '') && /could not be put back|Add the tutor again/.test(r2.error?.message || ''), JSON.stringify(r2.error));
  check('the swap warning says what happens if the new id turns out to be taken', /put back/.test(I.tutorChangeWarning('swap', 'Circuits', { slug: 'tutor-1', committed: 0, reports: 0 })));
}

section('updateItem: points that move on an assignment with grades are confirmed first');
{
  reset(withFresh({ 'grades.select': { __count: 12 } }));
  let r = await I.updateItem(db, ctx, typedItem(), base({ points: '5' }));
  eq('changing the assignment\'s points asks, with the count, and writes nothing',
    [r.needsPointsConfirm && [r.needsPointsConfirm.grades, r.needsPointsConfirm.from, r.needsPointsConfirm.to, r.needsPointsConfirm.assignmentPoints], CALLS.length], [[12, 2, 5, true], 0]);
  check('the warning says how many grades and what changes', /12 grades/.test(I.pointsChangeWarning('Circuits', r.needsPointsConfirm)) && /from 2 to 5/.test(I.pointsChangeWarning('Circuits', r.needsPointsConfirm)));
  r = await I.updateItem(db, ctx, typedItem(), base({ points: '5' }), { points: true });
  eq('confirmed, it saves', [r.error, writesTo('assignment_offerings', 'update')[0].payload.points_possible], [null, 5]);

  reset(withFresh({ 'grades.select': { __count: 0 } }));
  r = await I.updateItem(db, ctx, typedItem(), base({ points: '5' }));
  eq('with no grades there is nothing to ask', r.error, null);

  reset(withFresh({ 'grades.select': { __count: 12 } }));
  r = await I.updateItem(db, ctx, typedItem(), base({ points: '2' }));
  eq('and points that did not move ask nothing', r.error, null);

  // A question's points moving counts too.
  const q = (points) => ({ questions: [{ id: 'q1', type: 'free_response', text: 'Why?', points, role: 'free_response' }] });
  const withQ = typedItem({ paths: [{ ...typedItem().paths[0], content: q(1) }] });
  const F = await import('../../site/js/free-response.js');
  const editor = F.editorFromContent({ ...q(3), reading_link: null, reference_pdf: null, reference_pages: null }, null);
  reset(withFresh({ 'grades.select': { __count: 7 } }));
  r = await I.updateItem(db, ctx, withQ, base({ freeResponse: editor }));
  eq('a question whose points changed asks too', [r.needsPointsConfirm?.questionPoints, r.needsPointsConfirm?.grades, CALLS.length], [true, 7, 0]);
}

section('updateItem: the assignment number is written only when the person changed it');
{
  reset(withFresh());
  await I.updateItem(db, ctx, typedItem({ position: 6 }), base({ lessonNumber: '6' }));
  check('unchanged: not sent', !('position' in writesTo('assignment_offerings', 'update')[0].payload));
  reset(withFresh());
  await I.updateItem(db, ctx, typedItem({ position: 6 }), base({ lessonNumber: '7' }));
  eq('changed: sent', writesTo('assignment_offerings', 'update')[0].payload.position, 7);
  reset(withFresh());
  await I.updateItem(db, ctx, typedItem({ position: 6 }), base({ lessonNumber: '' }));
  eq('cleared: sent as nothing', writesTo('assignment_offerings', 'update')[0].payload.position, null);
}

section('removal states what goes with the item, tutor included');
{
  const acts = [{ id: 'act-w' }, { id: 'act-t' }];
  reset({
    'assignment_offerings.select': (st, mode) => (mode === 'maybe' ? { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true } : []),
    'activities.select': acts,
    'questions.select': (st) => (JSON.stringify(st.filters.activity_id || []).includes('act-w') ? [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] : []),
    'question_keys.select': { __count: 4 },
  });
  const pre = await I.previewRemoval(db, 'o-1');
  eq('both activities are counted, with the questions and key versions', [pre.error, pre.impact], [null, { questions: 3, keys: 4 }]);
  const text = I.removalWarning('Circuits', pre.impact);
  check('the warning names the counts', /3 questions/.test(text) && /4 answer key versions/.test(text), text);
  const res = await I.removeItem(db, 'o-1');
  eq('without an acknowledgement nothing is deleted', [res.needsConfirm, writesTo('assignment_offerings', 'delete').length], [{ questions: 3, keys: 4 }, 0]);
  reset({
    'assignment_offerings.select': (st, mode) => (mode === 'maybe' ? { id: 'o-1', assignment_id: 'a-1', entered_on_new_page: true } : []),
    'activities.select': acts, 'questions.select': [], 'question_keys.select': { __count: 0 },
    'submissions.select': { __count: 1 },
  });
  const refused = await I.removeItem(db, 'o-1');
  check('an item cadets have started is refused with the count, before any delete', /1 submission/.test(refused.error?.message || '') && CALLS.filter(c => c.verb === 'delete').length === 0);
}


section('updateItem: a stored question cannot be removed once the assignment has any work');
{
  const F = await import('../../site/js/free-response.js');
  const stored = { questions: [
    { id: 'q1', type: 'free_response', text: 'Why?', points: 1, role: 'free_response' },
    { id: 'q2', type: 'free_response', text: F.READING_REFLECTION_TEXT, points: 1, role: 'reading_reflection' },
    { id: 'q4', type: 'free_response', text: 'Second?', points: 0, role: 'free_response' }] };
  const item = typedItem({ paths: [{ ...typedItem().paths[0], content: stored }] });
  const content = { ...stored, reading_link: null, reference_pdf: null, reference_pages: null };
  // Input B: an ordinary stored question is removed.
  let editor = F.editorFromContent(content, null);
  F.removeQuestion(editor, 2);
  reset(withFresh({ 'submissions.select': { __count: 6 }, 'grades.select': { __count: 0 } }));
  let r = await I.updateItem(db, ctx, item, base({ freeResponse: editor }));
  check('removing a stored question with answers on it is refused, in words, before any write',
    /cannot be removed/.test(r.error?.message || '') && /0/.test(r.error?.message || '') && CALLS.filter(c => c.verb !== 'select').length === 0);
  // Input A: the reflection tick is cleared.
  editor = F.editorFromContent(content, null);
  editor.workLocked = true;
  const res = F.pinOff(editor, 'reading_reflection');
  eq('with work on the item the editor itself refuses to drop a stored pinned question', [res, editor.questions.length], ['locked', 3]);
  editor = F.editorFromContent(content, null);
  editor.workLocked = true;
  eq('the editor greys out Remove for a stored question when locked', [F.canRemove(editor, editor.questions[0]), F.canRemove(editor, F.newQuestion('free_response', editor.questions, editor.used_ids))], [false, true]);
  editor = F.editorFromContent(content, null);
  F.pinOff(editor, 'reading_reflection');          // an unlocked editor drops it, as before
  reset(withFresh({ 'submissions.select': { __count: 0 }, 'grades.select': { __count: 3 } }));
  r = await I.updateItem(db, ctx, item, base({ freeResponse: editor }));
  check('a grade alone counts as work', /cannot be removed/.test(r.error?.message || ''));
  reset(withFresh({ 'submissions.select': { __count: 0 }, 'grades.select': { __count: 0 } }));
  r = await I.updateItem(db, ctx, item, base({ freeResponse: editor }));
  eq('with no work the removal saves', r.error, null);
  reset(withFresh({ 'submissions.select': { __count: 6 }, 'grades.select': { __count: 6 } }));
  r = await I.updateItem(db, ctx, item, base({ freeResponse: F.editorFromContent(content, null) }));
  eq('and an unchanged question set with work is not stopped', r.error, null);
}

process.exit(summary() ? 0 : 1);
