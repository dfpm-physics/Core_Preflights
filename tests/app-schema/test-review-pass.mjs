// test-review-pass.mjs -- the 2026-11-09 review pass, offline: the shorter staff bar, the dashboard's Backlog and Recent
// reports summaries, the student "All classes" page, the gradebook heading link, and the info control. Every name and id
// below is invented. Nothing here reaches a network.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/student/summary.html' });
globalThis.fetch = async () => { throw new Error('offline'); };
globalThis.window.db = {};
const ROOT = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const { backlogSummary, groupBacklog, PILES } = await import('../../site/js/faculty-backlog.js');
const { recentReportRows, reportPickerRows } = await import('../../site/js/faculty-rollup.js');
const S = await import('../../site/js/student-summary.js');
const { STATE } = await import('../../site/js/student-lessons.js');
const { infoHTML } = await import('../../site/js/util.js');

section('backlog summary: reshaped from groupBacklog, nothing added');
{
  const cells = [
    { assignment_offering_id: 'a', section_id: 's1', state: 'submitted_ungraded' },
    { assignment_offering_id: 'a', section_id: 's2', state: 'submitted_ungraded', is_late: true },
    { assignment_offering_id: 'b', section_id: 's1', has_draft_score: true },
    { assignment_offering_id: 'c', section_id: 's1', state: 'graded' },
  ];
  const sum = backlogSummary(groupBacklog(cells));
  eq('two non-empty piles, in the Backlog page order', sum.piles.map(p => p.key), ['toGrade', 'toPublish']);
  eq('cadets and assignments per pile', sum.piles.map(p => [p.cadets, p.assignments]), [[2, 1], [1, 1]]);
  eq('waiting is the page total (pile rows)', sum.waiting, 2);
  eq('nothing waiting reads as zero piles', backlogSummary(groupBacklog([])).waiting, 0);
  check('every pile title comes from PILES', sum.piles.every(p => PILES.some(q => q.title === p.title)));
}

section('recent reports: the Reports page rows, trimmed');
{
  const now = new Date('2026-11-09T12:00:00Z');
  const rows = reportPickerRows([
    { id: 'p1', title: 'Past', due_at: '2026-11-01T00:00:00Z', is_published: true, done: 3, total: 10 },
    { id: 'f1', title: 'Future, none done', due_at: '2026-12-01T00:00:00Z', is_published: true, done: 0, total: 10 },
    { id: 'f2', title: 'Future, some done', due_at: '2026-12-02T00:00:00Z', is_published: true, done: 2, total: 10 },
    { id: 'd1', title: 'Draft', due_at: '2026-10-01T00:00:00Z', is_published: false, done: 0, total: 0 },
  ]);
  eq('published and (past or started), newest first', recentReportRows(rows, now, 5).map(r => r.id), ['f2', 'p1']);
  eq('limit is respected', recentReportRows(rows, now, 1).map(r => r.id), ['f2']);
}

section('student summary: one loader per class, merged, soonest first');
{
  const mk = (id, due, state) => ({ id, title: 'Title ' + id, lesson_number: null, due: due ? new Date(due) : null,
    isPast: state === STATE.MISSED, state, dot: 'grey' });
  const courseA = { offeringId: 'oa', courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Fall', past: false };
  const courseB = { offeringId: 'ob', courseCode: 'phys-120', courseTitle: 'Physics 120', termLabel: 'Fall', past: false };
  const courseC = { offeringId: 'oc', courseCode: 'phys-110', courseTitle: 'Physics 110', termLabel: 'Spring', past: true };
  const ctx = { courses: [courseA, courseB, courseC], enrollments: [
    { id: 'ea', section_id: 'sa', sections: { course_offering_id: 'oa' } },
    { id: 'eb', section_id: 'sb', sections: { course_offering_id: 'ob' } }] };
  const seen = [];
  const load = async (c) => {
    seen.push([c.currentOffering, c.sectionIds, c.enrollmentIds]);
    if (c.currentOffering === 'oa') {
      const items = [mk('a1', '2026-11-20T00:00:00Z', STATE.NOT_STARTED), mk('a2', '2026-11-01T00:00:00Z', STATE.MISSED),
        mk('a3', '2026-11-12T00:00:00Z', STATE.SUBMITTED)];
      items.lockedCount = 2; return items;
    }
    const items = [mk('b1', '2026-11-10T00:00:00Z', STATE.DRAFT)]; items.lockedCount = 0; return items;
  };
  const per = await S.loadSummary(ctx, { load });
  eq('only active classes are loaded (a finished term is skipped)', seen.map(s => s[0]), ['oa', 'ob']);
  eq('each call is narrowed to that class own enrollment', seen.map(s => [s[1], s[2]]), [[['sa'], ['ea']], [['sb'], ['eb']]]);
  eq('submitted work is not listed; open and past due are', per[0].rows.map(r => r.id), ['a1', 'a2']);
  const g = S.groupRows(per, new Date('2026-11-09T12:00:00Z'));
  eq('overdue group', g.overdue.map(r => r.id), ['a2']);
  eq('due soon (within 48h)', g.soon.map(r => r.id), ['b1']);
  eq('later', g.later.map(r => r.id), ['a1']);
  const href = S.rowHref(g.soon[0]);
  check('a row opens that assignment in that class, on the page the course dashboard uses', href === 'lessons.html?l=b1&offering=ob', href);
  const h = {};
  const html = S.renderSummary(per, { ...h, now: new Date('2026-11-09T12:00:00Z') });
  check('it names each class on each row', html.includes('Physics 215') && html.includes('Physics 120'));
  check('a class with later work held back says so', /not open yet|later|open/i.test(html) && html.includes('data-course="oa"'));

  // A failed class is an error for that class; the other still shows; nothing says all caught up.
  const failing = await S.loadSummary(ctx, { load: async (c) => { if (c.currentOffering === 'oa') throw new Error('down'); return load(c); } });
  eq('the failed class carries an error, the other its rows', [!!failing[0].error, failing[1].rows.length], [true, 1]);
  const failHtml = S.renderSummary(failing, h);
  check('the error is shown', failHtml.includes('data-summary-error'));
  check('the other class still shows', failHtml.includes('Title b1'));
  const allFail = await S.loadSummary(ctx, { load: async () => { throw new Error('down'); } });
  check('every class failing is never All caught up', !S.renderSummary(allFail, h).includes('All caught up'));
  const none = [{ course: courseA, rows: [], lockedCount: 0 }];
  check('a class that loaded and has nothing open IS All caught up', S.renderSummary(none, h).includes('All caught up'));
  check('a student with no classes gets a plain page', S.renderSummary([], h).includes('No classes yet'));
}

section('the summary page and the route to it');
{
  check('index.html sends a student to the summary', /student\/summary\.html/.test(read('site/index.html')));
  check('auth.js sends a student home to the summary', /student\/summary\.html/.test(read('site/js/auth.js')));
  const nav = read('site/js/nav.js').replace(/\/\/[^\n]*\n/g, '\n');
  check('the summary is first on the student bar', /STUDENT_LINKS = \[\s*\{ key: 'summary'/.test(nav));
  check('student summary page has no inline handler', !/\son\w+=/.test(read('site/student/summary.html')));
  const js = read('site/js/student-summary.js');
  check('the loader is the course dashboard loader (no second query shape)', /loadLessonStatuses/.test(js) && !/\.from\(/.test(js));
}

section('gradebook heading opens the class report; frozen page untouched');
{
  const gb = read('site/faculty/gradebook.html');
  check('a column heading is a link to report.html?i=<offering id>', gb.includes('<a href="report.html?i=${esc(encodeURIComponent(c.offeringId))}"'));
  check('faculty/lessons.html is a forwarder to items.html, with an external script only', /<script src="\.\.\/js\/lessons-forward\.js"><\/script>/.test(read('site/faculty/lessons.html')) && !/<script>/.test(read('site/faculty/lessons.html')));
}

section('assignments page: read-only for an instructor');
{
  const it = read('site/faculty/items.html');
  check('the Directors only wall is gone', !/Directors only/.test(it));
  check('an instructor row holds only the read actions', /!isDirector\(\)\s*\? reads/.test(it));
  check('the New button is a director control', /isDirector\(\)\s*\? `<span class="row"/.test(it));
  check('every staff role gets Grade assignments', it.includes('id="grade-assignments-btn" href="entry.html"'));
  check('an address cannot open a form for an instructor', /if \(!isDirector\(\)\) \{[\s\S]{0,400}?return;\s*\}\s*if \(!LK\.hasPrefill\(location\.search\)\) return openFromQuery\(\);/.test(it));
}

section('info control');
{
  const h = infoHTML('Because <b>x</b>', 'About this page');
  check('a real button, type=button, with an accessible name', h.includes('<button type="button" class="info-btn" aria-label="About this page"'));
  check('the text is real, escaped text in the page, linked by aria-describedby',
        /aria-describedby="info-pop-\d+"/.test(h) && h.includes('Because &lt;b&gt;x&lt;/b&gt;'));
  check('not carried by a title attribute', !/title=/.test(h));
  const ids = [infoHTML('a'), infoHTML('b')].map(s => s.match(/id="(info-pop-\d+)"/)[1]);
  check('each control has its own id', ids[0] !== ids[1]);
}

summary();
