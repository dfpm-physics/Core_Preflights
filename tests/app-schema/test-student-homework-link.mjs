// test-student-homework-link.mjs -- the student lesson list leads to the homework page for an auto-checked item, and the
// homework page reads its grade from the student's own view. Offline: window.db is a recording fake, no network.
// Every title and id below is invented.
//
// What is pinned:
//   1. An item with an online-questions path graded auto_checked gets homework.html?a=<id> on the lesson list, and an
//      ordinary written item does not.
//   2. The student query asks for the two columns that tell the paths apart, so the list never guesses from the kind.
//   3. The lesson page renders a link to the homework page for such an item, and the label in the list says homework.
//   4. The homework page reads its grade from my_grades and never from the grades table.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/student/lessons.html' });
globalThis.fetch = async () => { throw new Error('offline'); };

const ROOT = resolve(import.meta.dirname, '../..');
const FUTURE = new Date(Date.now() + 2 * 86400e3).toISOString();

const calls = [];
let tables = {}, rpcs = {};
function builder(table) {
  const q = { table, filters: [] };
  const chain = new Proxy({}, { get(_, prop) {
    if (prop === 'then') {
      return (res, rej) => { calls.push(q); Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej); };
    }
    return (...args) => { q.filters.push([prop, ...args]); return chain; };
  } });
  return chain;
}
globalThis.window.db = {
  from: builder,
  rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: rpcs[name] ?? [], error: null }; },
};

const D = await import('../../site/js/student-data.js');
const L = await import('../../site/js/student-lessons.js');
const S = await import('../../site/js/schema.js');
const H = await import('../../site/js/homework.js');

const path = (extra, act) => ({ grading_role: 'graded', available_after: null, is_visible: true, position: 0, ...extra,
  activities: { id: 'act-' + act.slug, slug: act.slug, modality: act.modality, title: act.slug, content: {} } });
const off = (id, title, offeringActivities) => ({
  id, points_possible: 4, grading_mode: 'points', switch_policy: 'free', opens_at: null, due_at: FUTURE,
  due_by_day: {}, is_published: true, position: Number(id.slice(1)), course_offering_id: 'co1',
  assignments: { id: 'a' + id, slug: 's' + id, title, description: '', objectives: [], kind_id: 'k', course_id: 'c1' },
  offering_activities: offeringActivities, assignment_due_dates: [],
});
const ctx = { currentOffering: 'co1', enrollmentIds: ['e1'], sectionIds: ['s1'], sections: [], sectionsByOffering: {} };

tables = {
  assignment_offerings: [
    off('o1', 'Invented homework', [path({ delivery: 'online_questions', grading: 'auto_checked' }, { slug: 'hw', modality: 'questions' })]),
    off('o2', 'Invented written item', [path({ delivery: 'typed_response', grading: 'human_graded' }, { slug: 'wr', modality: 'written' })]),
  ],
  submissions: [], my_work: [], my_grades: [], extensions: [], submission_activities: [],
};
rpcs = { gradebook_cells: [], my_course_total: [] };

section('the lesson list leads to the homework page');
{
  const lessons = await L.loadLessonStatuses(ctx);
  const by = (id) => lessons.find(l => l.id === id);
  eq('an auto-checked item links to the homework page with its own id', by('o1').homeworkHref, 'homework.html?a=o1');
  eq('and says it is auto-checked', by('o1').autoChecked, true);
  eq('a written item has no homework link', [by('o2').homeworkHref, by('o2').autoChecked], [null, false]);
  const q = calls.find(c => c.table === 'assignment_offerings');
  check('the student query is the shared one', !!q);
}

section('the query names the two columns that tell the paths apart');
check('OFFERING_SELECT carries delivery and grading', /offering_activities\([^)]*delivery,grading/.test(S.OFFERING_SELECT), S.OFFERING_SELECT);
{
  const shaped = S.shapeOffering(tables.assignment_offerings[0]);
  eq('the shaped path keeps both', [shaped.activities[0].delivery, shaped.activities[0].grading], ['online_questions', 'auto_checked']);
  eq('a row from an older select (no such columns) reads as not auto-checked', S.shapeOffering({
    ...tables.assignment_offerings[1], offering_activities: [{ grading_role: 'graded', activities: { id: 'x', slug: 'x', modality: 'written', content: {} } }],
  }).autoChecked, false);
}

section('the lesson page renders the link');
{
  const html = readFileSync(resolve(ROOT, 'site/student/lessons.html'), 'utf8');
  check('the page has a homework block that links to l.homeworkHref', /function homeworkBlock\(l\)/.test(html) && /href="\$\{esc\(l\.homeworkHref\)\}"/.test(html));
  check('openLesson shows it before any written or interactive block', html.indexOf('if (l.homeworkHref)') > 0
    && html.indexOf('if (l.homeworkHref)') < html.indexOf('const bothOpen'));
  const view = readFileSync(resolve(ROOT, 'site/js/student-view.js'), 'utf8');
  check('the list label says homework (the shared helper, which the assignments page uses)', /if \(l\.autoChecked\) return 'Homework/.test(view) && /sharedModeLabel\(l,/.test(html));
  const dash = readFileSync(resolve(ROOT, 'site/student/dashboard.html'), 'utf8');
  check('the dashboard list uses the same helper', /modeLabel/.test(dash) && !/function modeLabel\(/.test(dash));
}

section('the homework page reads the student view of grades');
{
  const html = readFileSync(resolve(ROOT, 'site/student/homework.html'), 'utf8');
  eq('the named source is my_grades', H.GRADE_SOURCE, 'my_grades');
  check('the page reads through the named source, not the table', /db\.from\(GRADE_SOURCE\)/.test(html) && !/from\('grades'\)/.test(html));
  const cols = H.GRADE_COLUMNS.split(',');
  check('every column it asks for is a column of the view (diagnostic is not one of them)', !cols.includes('diagnostic')
    && cols.every(c => ['enrollment_id', 'assignment_offering_id', 'points_earned', 'points_possible', 'question_scores', 'source', 'is_finalized'].includes(c)));
}

summary();
