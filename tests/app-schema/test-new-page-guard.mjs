// test-new-page-guard.mjs — the guards that keep older staff pages away from items entered on the
// newer pages (docs/decisions/V2-DATA-MODEL.md, section 22.1).
//
// WHAT THIS DEFENDS
//   An item flagged `entered_on_new_page` must not be saved, removed, deleted or have its
//   interaction swapped by the lesson editor, because that editor would put the kind back to
//   `preflight` and drop any path it does not recognise. The Grade picker, the Report list and the
//   Health page must leave such items out.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db. It shows which queries and writes the shipped
//   modules issue. It does not show that the database has the column, that PostgREST accepts the
//   filter, or that the rules in the database refuse what these guards decline to send. Those wait
//   for the migrations to exist on a database.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/lessons.html' });

let RESPONSES = {};
let CALLS = [];       // every write
let QUERIES = [];     // every table read: { table, cols, filters }

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte',
                   'order', 'limit', 'filter', 'or', 'range'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols) => { state.cols = cols; return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => {
      state.verb = verb;
      state.payload = payload;
      CALLS.push({ table, verb, payload, filters: state.filters });
      return c;
    };
  const result = (mode) => {
    if (state.verb === 'select') QUERIES.push({ table, cols: state.cols, filters: state.filters });
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    if (data === undefined) return { data: mode === 'many' ? [] : null, error: null };
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};

globalThis.window.db = { from: stubFrom };
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const G = await import('../../site/js/new-page-guard.js');
const L = await import('../../site/js/faculty-lessons.js');

const MARKER_COLS = 'entered_on_new_page';
const markerIs = (flag) => (state) =>
  state.cols === MARKER_COLS ? { entered_on_new_page: flag } : undefined;
const reset = (responses = {}) => { RESPONSES = responses; CALLS = []; QUERIES = []; };
const writes = () => CALLS.length;
const ctx = { user: { id: 'staff' }, currentOffering: 'co-real', currentCourse: 'course-1',
              isDirectorForCurrent: () => true };

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the marker test');
eq('a raw row with the flag is a new-page item', G.isNewPageItem({ entered_on_new_page: true }), true);
eq('a shaped lesson with the flag is a new-page item', G.isNewPageItem({ enteredOnNewPage: true }), true);
eq('an unflagged row is not', G.isNewPageItem({ entered_on_new_page: false }), false);
eq('a row that has never heard of the column is not', G.isNewPageItem({ id: 'x' }), false);
eq('null is not', G.isNewPageItem(null), false);
check('the refusal names the newer page and says nothing was changed',
  /newer page/.test(G.newPageMessage('save changes to')) && /Nothing was changed/.test(G.newPageMessage('remove')));

section('refuseIfNewPage');
reset({ 'assignment_offerings.select': markerIs(true) });
let r = await G.refuseIfNewPage(window.db, 'off-1', 'remove');
eq('a flagged offering is refused', r?.error?.code, 'new_page_item');

reset({ 'assignment_offerings.select': markerIs(false) });
eq('an unflagged offering goes ahead', await G.refuseIfNewPage(window.db, 'off-1', 'remove'), null);

reset();
eq('an offering that cannot be read as a row goes ahead (nothing to own)',
  await G.refuseIfNewPage(window.db, 'off-1', 'remove'), null);

reset({ 'assignment_offerings.select': () => ({ __error: { code: '42703',
  message: 'column assignment_offerings.entered_on_new_page does not exist' } }) });
eq('a missing column means no item can carry the flag, so it goes ahead',
  await G.refuseIfNewPage(window.db, 'off-1', 'remove'), null);

reset({ 'assignment_offerings.select': () => ({ __error: { code: '08006', message: 'connection lost' } }) });
r = await G.refuseIfNewPage(window.db, 'off-1', 'remove');
eq('any other read failure refuses, because the owner cannot be told', r?.error?.code, 'new_page_unknown');

reset();
r = await G.refuseIfNewPage(window.db, 'off-1', 'delete', { enteredOnNewPage: true });
eq('a lesson already known to be flagged is refused without asking the database', r?.error?.code, 'new_page_item');
eq('... and no query was made', QUERIES.length, 0);

section('the lesson editor: each action on a flagged item');
const model = {
  assignmentId: 'asg-1', courseId: 'course-1', courseCode: 'phys-215', courseOfferingId: 'co-real',
  slug: 'hw-01', title: 'Homework 1', policy: 'preflight', pointsPossible: 2,
  written: { include: true, questions: [] }, interactive: { include: false },
  dueByDay: {}, sections: [], isPublished: false, lessonNumber: null,
};

reset({ 'assignment_offerings.select': markerIs(true) });
let out = await L.saveLesson(ctx, model, 'off-flagged');
eq('save is refused', out.error?.code, 'new_page_item');
eq('save wrote nothing at all', writes(), 0);

reset({ 'assignment_offerings.select': markerIs(true) });
out = await L.unscheduleLesson('off-flagged');
eq('remove is refused', out.error?.code, 'new_page_item');
eq('remove deleted nothing', writes(), 0);

reset({ 'assignment_offerings.select': markerIs(true) });
out = await L.deleteLessonAndContents({ offeringId: 'off-flagged', assignmentId: 'asg-1' });
eq('delete is refused', out.error?.code, 'new_page_item');
eq('delete deleted nothing', writes(), 0);

reset({ 'assignment_offerings.select': markerIs(true) });
out = await L.replaceInteractive(ctx, 'asg-1', 'act-old', 'off-flagged',
  { slug: 'lesson-99-x', title: 'x', artifact_url: 'https://example.org/a' });
eq('swapping the interaction is refused', out.error?.code, 'new_page_item');
eq('the swap deleted and inserted nothing', writes(), 0);

section('the lesson editor: the same actions on an ordinary item');
reset({ 'assignment_offerings.select': markerIs(false),
        'activities.insert': () => ({ id: 'act-new' }) });
out = await L.saveLesson(ctx, model, 'off-plain');
check('save still writes (the guard did not stop it)', writes() > 0,
  `error: ${out.error?.message}`);
check('save was not refused', out.error?.code !== 'new_page_item');

reset({ 'assignment_offerings.select': markerIs(false) });
await L.unscheduleLesson('off-plain');
check('remove still deletes',
  CALLS.some(c => c.table === 'assignment_offerings' && c.verb === 'delete'));

reset();
out = await L.saveLesson(ctx, model, null).catch(() => null);
check('scheduling a new item asks no owner question',
  !QUERIES.some(q => q.table === 'assignment_offerings' && q.cols === MARKER_COLS));

section('publishing is left to the database');
reset();
const pub = L.togglePublish('off-flagged', false);
check('togglePublish still sends the update (the database rules refuse it)', typeof pub.then === 'function');
await pub;
check('... as a single is_published update',
  CALLS.length === 1 && CALLS[0].payload.is_published === true);

section('the editor list');
reset({ 'assignment_offerings.select': () => [] });
await L.loadManager(ctx);
const listQ = QUERIES.find(q => q.table === 'assignment_offerings');
check('the editor list selects the marker', listQ && listQ.cols.includes('entered_on_new_page'), listQ?.cols);
check('the shared select string is unchanged for every other page',
  !(await import('../../site/js/schema.js')).OFFERING_SELECT.includes('entered_on_new_page'));

const S = await import('../../site/js/schema.js');
eq('a shaped offering carries the flag', S.shapeOffering({ id: 'o', entered_on_new_page: true,
  assignments: {}, offering_activities: [] }).enteredOnNewPage, true);
eq('a row from a query that never named the column shapes to false',
  S.shapeOffering({ id: 'o', assignments: {}, offering_activities: [] }).enteredOnNewPage, false);

section('pages no longer leave flagged items out (migration 079; the older editor still refuses them)');
reset();
const Gr = await import('../../site/js/faculty-grade.js');
await Gr.gradeAssignmentList(ctx);
eq('the Grade picker does not filter on the marker',
  QUERIES.find(q => q.table === 'assignment_offerings')?.filters.entered_on_new_page, undefined);
eq('the Grade picker still asks for this course offering',
  QUERIES.find(q => q.table === 'assignment_offerings')?.filters.course_offering_id, 'co-real');

reset({ 'assignment_offerings.select': markerIs(true) });
const gd = await Gr.loadGradingData(ctx, 'off-flagged', []);
check('the Grade page does not refuse a flagged item', gd.refusal?.code !== 'new_page_item', gd.refusal);
check('... and never asks which page owns it',
  !QUERIES.some(q => q.table === 'assignment_offerings' && q.cols === MARKER_COLS));
reset();

reset({ 'assignment_offerings.select': () => [], 'enrollments.select': () => [] });
const Ro = await import('../../site/js/faculty-rollup.js');
try { await Ro.loadManager(ctx); } catch { /* only the query matters here */ }
eq('the Report list does not filter on the marker',
  QUERIES.find(q => q.table === 'assignment_offerings')?.filters.entered_on_new_page, undefined);

reset();
const H = await import('../../site/js/faculty-health.js');
try { await H.loadHealth(); } catch { /* only the query matters here */ }
eq('the Health page does not filter on the marker',
  QUERIES.find(q => q.table === 'assignment_offerings')?.filters.entered_on_new_page, undefined);
eq('... and still reads course offerings by the active flag',
  QUERIES.find(q => q.table === 'course_offerings')?.filters.is_active, true);

if (!summary()) process.exit(1);
