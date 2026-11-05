// test-student-loader.mjs -- the one student loader reads the database's state for every page, and a failed
// read shows an error. Offline: window.db is a recording fake, nothing reaches a network.
// Every title and id below is invented.
//
// What is pinned:
//   1. With the database cells applied, a grade the database holds back is not on the item at all, so the
//      dashboard, lesson list and written-assignment page cannot show it, and it is never downloaded.
//   2. A stale zero (counted by the database as waiting) reads as not graded.
//   3. An excused item reads as excused on the lesson view.
//   4. A failed cell read, or a failed work read, throws. It never becomes an empty list or a zero.
//   5. The dashboard's "Graded" count and total follow the same cells.
//   6. The frozen receiver page catches a failed load and shows a plain error.
//   7. A failed reload on course switch shows an error (util.guarded).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/student/dashboard.html' });
globalThis.fetch = async () => { throw new Error('offline'); };   // the backup manifest read degrades to none

const ROOT = resolve(import.meta.dirname, '../..');
const PAST = '2026-01-10T06:59:00.000Z';

// ── a fake query builder: every call is recorded, a terminal await resolves the table's rows ──
const calls = [];
let tables = {}, rpcs = {};
function builder(table) {
  const q = { table, filters: [] };
  const chain = new Proxy({}, { get(_, prop) {
    if (prop === 'then') {
      return (res, rej) => {
        calls.push(q);
        const t = tables[table];
        const out = t instanceof Error ? { data: null, error: { message: t.message } } : { data: t ?? [], error: null };
        Promise.resolve(out).then(res, rej);
      };
    }
    return (...args) => { q.filters.push([prop, ...args]); return chain; };
  } });
  return chain;
}
globalThis.window.db = {
  from: builder,
  rpc: async (name, args) => {
    calls.push({ rpc: name, args });
    const r = rpcs[name];
    if (r instanceof Error) return { data: null, error: { message: r.message } };
    return { data: r ?? [], error: null };
  },
};

const D = await import('../../site/js/student-data.js');
const L = await import('../../site/js/student-lessons.js');

const off = (id, title) => ({
  id, points_possible: 10, grading_mode: 'points', switch_policy: 'free', opens_at: null, due_at: PAST,
  due_by_day: {}, is_published: true, position: Number(id.slice(1)), course_offering_id: 'co1',
  assignments: { id: 'a' + id, slug: 's' + id, title, description: '', objectives: [], kind_id: 'k', course_id: 'c1' },
  offering_activities: [{ grading_role: 'graded', available_after: null, is_visible: true, position: 0,
    activities: { id: 'w' + id, slug: 'w' + id, modality: 'written', title, content: { questions: [] } } }],
  assignment_due_dates: [],
});
const grade = (id, pts, over = {}) => ({ assignment_offering_id: id, enrollment_id: 'e1', is_finalized: true,
  points_earned: pts, points_possible: 10, effort: null, question_scores: null, source: 'instructor',
  instructor_note: null, ...over });
const cell = (id, state, pts = null) => ({ assignment_offering_id: id, state, points_earned: pts, points_possible: 10 });

const ctx = { currentOffering: 'co1', enrollmentIds: ['e1'], sectionIds: ['s1'], sections: [], sectionsByOffering: {} };

function setup({ cells, grades }) {
  calls.length = 0;
  tables = {
    assignment_offerings: [off('o1', 'Released item'), off('o2', 'Held item'), off('o3', 'Stale zero item'),
      off('o4', 'Excused item')],
    submissions: [], my_work: [], my_grades: grades, extensions: [], submission_activities: [],
  };
  rpcs = { gradebook_cells: cells, my_course_total: [{ earned_text: '10', possible_text: '10', percent_text: '100.00' }] };
}
const happyCells = [cell('o1', 'released', 10), cell('o2', 'submitted_ungraded'), cell('o3', 'submitted_ungraded'),
  cell('o4', 'excused')];
const happyGrades = [grade('o1', 10), grade('o2', 8), grade('o3', 0, { diagnostic: { no_submission: true } })];

section('the loader applies the database state');
setup({ cells: happyCells, grades: happyGrades });
let items = await D.loadAssignmentStatuses(ctx, { withCells: true });
const by = (id) => items.find(i => i.offeringId === id);
eq('a released grade stays on its item', by('o1').grade?.points_earned, 10);
eq('a held grade is not on the item', by('o2').grade, null);
eq('a held item is not graded', by('o2').status === 'graded', false);
eq('a stale zero is not on the item', by('o3').grade, null);
eq('a stale zero is not graded', by('o3').status === 'graded', false);
eq('an excused item says so', [by('o4').excused, by('o1').excused], [true, false]);
check('the cells ride back on the array', items.cells instanceof Map && items.cells.size === 4);
const gradeQuery = calls.find(c => c.table === 'my_grades');
const narrowed = gradeQuery.filters.find(f => f[0] === 'in' && f[1] === 'assignment_offering_id');
eq('only the released item is downloaded', narrowed && narrowed[2], ['o1']);

section('an auto-checked cell still in progress keeps the points the database gave it');
{
  const auto = [cell('o1', 'in_progress', 6), cell('o2', 'in_progress'), cell('o3', 'submitted_ungraded'), cell('o4', 'excused')];
  setup({ cells: auto, grades: [grade('o1', 6, { source: 'auto_checked' }), grade('o2', 3, { source: 'auto_checked' })] });
  const got = await D.loadAssignmentStatuses(ctx, { withCells: true });
  const q = calls.find(c => c.table === 'my_grades');
  eq('only the cell the database gave points for is downloaded', q.filters.find(f => f[0] === 'in' && f[1] === 'assignment_offering_id')[2], ['o1']);
  eq('that grade is on its item', got.find(i => i.offeringId === 'o1').grade?.points_earned, 6);
}

section('without cells the loader is unchanged (the receiver page uses this)');
setup({ cells: happyCells, grades: happyGrades });
items = await D.loadAssignmentStatuses(ctx, { includeLocked: true });
eq('raw grade kept', items.find(i => i.offeringId === 'o2').grade?.points_earned, 8);
check('no cell read happened', !calls.some(c => c.rpc));

section('lesson view and dashboard');
setup({ cells: happyCells, grades: happyGrades });
let lessons = await L.loadLessonStatuses(ctx);
const ls = (id) => lessons.find(l => l.id === id);
eq('released lesson is graded', ls('o1').state, L.STATE.GRADED);
eq('held lesson is not graded', ls('o2').state === L.STATE.GRADED, false);
eq('held lesson shows no score', ls('o2').completion, null);
eq('stale zero lesson is not graded', ls('o3').state === L.STATE.GRADED, false);
eq('excused lesson is excused', ls('o4').state, L.STATE.EXCUSED);
setup({ cells: happyCells, grades: happyGrades });
const vm = await L.loadStudentLessonDashboard(ctx);
eq('dashboard graded count follows the cells', vm.stats.graded, 1);
eq('dashboard total is the database total', vm.total?.earned_text, '10');
check('excused is not in the past-due list', !vm.missed.some(l => l.id === 'o4'));

section('a failed read throws');
setup({ cells: new Error('cells down'), grades: happyGrades });
let msg = '';
try { await D.loadAssignmentStatuses(ctx, { withCells: true }); } catch (e) { msg = e.message; }
check('a failed cell read throws', /cells down/.test(msg), msg);
setup({ cells: happyCells, grades: new Error('grades down') });
msg = '';
try { await L.loadLessonStatuses(ctx); } catch (e) { msg = e.message; }
check('a failed work read throws through the lesson loader', /grades down/.test(msg), msg);

section('the receiver page catches a failed load');
const recv = readFileSync(resolve(ROOT, 'site/student/interaction-submit.html'), 'utf8');
check('init() has a catch that shows a notice', /if \(ctx\) init\(\)\.catch\(/.test(recv));

section('course switch and reload errors show');
const U = await import('../../site/js/util.js');
check('util exports guarded', typeof U.guarded === 'function');
if (typeof U.guarded === 'function') {
  const mount = { innerHTML: '' };
  globalThis.document = { getElementById: () => mount, body: mount };
  const ok = U.guarded(async () => 'fine');
  await ok();
  eq('a good reload leaves the page alone', mount.innerHTML, '');
  const bad = U.guarded(async () => { throw new Error('reload failed'); });
  await bad();
  check('a failed reload shows the error', /reload failed/.test(mount.innerHTML));
}
for (const p of ['assignments', 'lessons', 'grades', 'schedule', 'dashboard']) {
  const src = readFileSync(resolve(ROOT, `site/student/${p}.html`), 'utf8');
  check(`${p}.html: course switch goes through guarded`, /onCourseChange:\s*guarded\(/.test(src));
}
check('assignments.html: the reload after a commit is guarded',
  /await loadData\(\);[^\n]*\n/.test(readFileSync(resolve(ROOT, 'site/student/assignments.html'), 'utf8'))
  && /try \{\s*await loadData\(\)/.test(readFileSync(resolve(ROOT, 'site/student/assignments.html'), 'utf8')));

// A cadet's grades come from the `my_grades` view. Since migration 046 the `grades` table returns a cadet no
// row at all, so a student module that reads it directly shows "no grade" with no error.
section('no student module reads the grades table');
{
  const { readdirSync } = await import('node:fs');
  const files = [
    ...readdirSync(resolve(ROOT, 'site/js')).filter(n => /^student-.*\.js$/.test(n)).map(n => `site/js/${n}`),
    ...readdirSync(resolve(ROOT, 'site/student')).filter(n => n.endsWith('.html')).map(n => `site/student/${n}`),
    'site/js/schema.js',
  ];
  check('the scan finds the student modules', files.length >= 8, String(files.length));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const p of files) {
    const src = strip(readFileSync(resolve(ROOT, p), 'utf8'));
    check(`${p}: does not read the grades table`, !/\.from\(\s*['"`]grades['"`]\s*\)/.test(src));
  }
  check('student-data.js reads my_grades', /\.from\('my_grades'\)/.test(readFileSync(resolve(ROOT, 'site/js/student-data.js'), 'utf8')));
}

summary();
