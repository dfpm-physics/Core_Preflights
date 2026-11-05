// test-student-view.mjs -- the wording, grouping and release handling behind the student schedule and
// grade list (site/js/student-view.js), plus the wording rules on the student pages. Offline and pure.
// Every title below is invented.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary } from './harness.mjs';

const V = await import('../../site/js/student-view.js');
const ROOT = resolve(import.meta.dirname, '../..');

const item = (over = {}) => ({
  offeringId: 'o1', title: 'Item A', pointsPossible: 10, gradingMode: 'points',
  due: new Date(2027, 0, 20, 23, 59), dueSource: 'section', released: true, releasesAt: null,
  written: { id: 'w' }, interactive: null, submission: null, grade: null, ...over,
});
const cell = (over = {}) => ({ assignment_offering_id: 'o1', state: 'not_due', points_earned: null,
  points_possible: 10, is_late: false, late_closed: false, ...over });

section('state words');
eq('released reads Graded', V.stateWords('released').word, 'Graded');
eq('held grade state reads as waiting', V.stateWords('submitted_ungraded').word, 'Waiting for a grade');
eq('missing says not submitted, not missed', V.stateWords('missing').word, 'Not submitted');
eq('excused is said to leave the total', V.stateWords('excused').note, 'Left out of your total.');
eq('an unknown state says nothing', V.stateWords('zzz').word, '');
check('no state word uses the old "missed"', ['excused','released','submitted_ungraded','missing','in_progress','not_due']
  .every(s => !/missed/i.test(V.stateWords(s).word + V.stateWords(s).note)));

section('numbers and points');
eq('points text has no default', V.pointsText(null), '');
eq('one point is singular', V.pointsText(1), '1 pt');
eq('fractional points keep their value', V.pointsText(1.5), '1.5 pts');
eq('zero points is stated, not hidden', V.pointsText(0), '0 pts');
eq('score text', V.scoreText('8.50', 10), '8.5 / 10 pts');
eq('score text with no score is empty', V.scoreText(null, 10), '');
eq('effort is named only for effort items', [V.gradingNote('effort'), V.gradingNote('points'), V.gradingNote(null)], ['Graded on effort', '', '']);

section('score shown on the grades page');
{
  const sw = (c, i = item()) => V.visibleScore(V.scheduleRow(i, c));
  eq('an auto-checked cell still in progress shows the points the database gave', sw(cell({ state: 'in_progress', points_earned: '10.00', points_possible: '10.00' })), '10 / 10 pts');
  eq('a released cell shows its score', sw(cell({ state: 'released', points_earned: '8.5' })), '8.5 / 10 pts');
  eq('a held cell (no points from the database) shows no score', sw(cell({ state: 'submitted_ungraded', points_earned: null })), '');
  eq('an in-progress cell with no points shows no score', sw(cell({ state: 'in_progress', points_earned: null })), '');
  check('grades.html uses the one rule, not a state test of its own', /visibleScore\(/.test(readFileSync(resolve(ROOT, 'site/student/grades.html'), 'utf8')) && !/state === 'released' \? scoreText/.test(readFileSync(resolve(ROOT, 'site/student/grades.html'), 'utf8')));
}

section('schedule row');
const locked = V.scheduleRow(item({ released: false, releasesAt: new Date(2027, 0, 13) }), cell());
check('a locked item keeps its date and title', locked.locked && locked.due instanceof Date && locked.title === 'Item A');
check('a locked item does not link anywhere', locked.openable === false);
check('an open item with a path links', V.scheduleRow(item(), cell()).openable === true);
check('an item with no path on this site does not link', V.scheduleRow(item({ written: null }), cell()).openable === false);
eq('a late flag comes from the cell', V.scheduleRow(item(), cell({ is_late: true })).isLate, true);
eq('an extension is marked', V.scheduleRow(item({ dueSource: 'extension' }), cell()).isExtended, true);
eq('no cell means no state word', V.scheduleRow(item(), undefined).stateWord, '');
eq('opens text names the time', V.opensText(new Date(2027, 0, 13), d => 'X'), 'Questions open X');

section('order and groups');
const rows = [
  V.scheduleRow(item({ offeringId: 'c', title: 'C', due: null }), null),
  V.scheduleRow(item({ offeringId: 'b', title: 'B', due: new Date(2027, 1, 3) }), null),
  V.scheduleRow(item({ offeringId: 'a', title: 'A', due: new Date(2027, 0, 5) }), null),
  V.scheduleRow(item({ offeringId: 'd', title: 'D', due: new Date(2027, 0, 30) }), null),
];
eq('sorted by date, undated last', V.sortRows(rows).map(r => r.offeringId), ['a', 'd', 'b', 'c']);
const g = V.groupByMonth(V.sortRows(rows));
eq('grouped by month, undated group last', g.map(x => x.label), ['January 2027', 'February 2027', 'No date yet']);
eq('January holds two rows', g[0].rows.length, 2);

section('the total is passed through, never worked out');
const t = V.totalView({ earned_text: '45', possible_text: '50', percent_text: '90', percent_key_text: '90.0' });
eq('line text', t.line, '45 of 50 points · 90%');
const t2 = V.totalView({ earned_text: '2', possible_text: '3', percent_text: '66.666666…' });
check('a cut value keeps its ellipsis and is not rounded', t2.percent === '66.666666…%');
eq('no possible points says nothing counts yet', V.totalView({ earned_text: '0', possible_text: '0', percent_text: null }).line, 'No graded work counts yet.');
eq('no row, no view', V.totalView(null), null);
check('the view has no letter field', !('letter' in t));

section('grade rows: feedback only when released');
const grade = { question_scores: { q2: { score: 1, max: 1, feedback: 'Good reasoning.' }, q1: { score: 0, max: 0, feedback: '' } },
  instructor_note: { text: 'Well done.' } };
const gr = V.gradeRows([
  item({ offeringId: 'r', title: 'R', grade }),
  item({ offeringId: 'h', title: 'H', grade }),
], new Map([
  ['r', cell({ assignment_offering_id: 'r', state: 'released', points_earned: 9 })],
  ['h', cell({ assignment_offering_id: 'h', state: 'submitted_ungraded', points_earned: null })],
]));
const r = gr.find(x => x.offeringId === 'r'), h = gr.find(x => x.offeringId === 'h');
eq('released row carries its comment', r.feedback.map(f => f.text).filter(Boolean), ['Good reasoning.']);
eq('released row carries the instructor note', r.note, 'Well done.');
eq('held row carries no comment', h.feedback, []);
eq('held row carries no note and no score', [h.note, h.earned], ['', null]);
eq('question order is numeric', V.feedbackOf({ question_scores: { q10: { max: 1, feedback: 'b' }, q2: { max: 1, feedback: 'a' } } }).map(f => f.key), ['q2', 'q10']);

section('past term');
check('all completed is past', V.isPastTerm([{ status: 'completed' }, { status: 'completed' }]));
check('one active is current', !V.isPastTerm([{ status: 'completed' }, { status: 'active' }]));
check('none is not past', !V.isPastTerm([]));

section('student pages: wording and the one-total rule (read from the shipped files)');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const pages = ['site/student/dashboard.html', 'site/student/lessons.html', 'site/student/schedule.html',
  'site/student/grades.html', 'site/student/interaction-submit.html', 'site/js/student-lessons.js', 'site/js/student-view.js']
  .map(p => [p, read(p)]);
for (const [p, src] of pages) {
  check(`${p}: no points default of 2`, !/points\s*\?\?\s*2\b|pointsPossible\s*\?\?\s*2\b/.test(src));
}
for (const p of ['site/student/dashboard.html', 'site/student/schedule.html', 'site/student/grades.html']) {
  const src = read(p);
  check(`${p}: no "Missed" label`, !/>\s*Missed\s*<|'Missed'/.test(src));
  check(`${p}: no unconditional "Graded on effort"`, !/['"`>]Graded on effort/.test(src));
}
for (const p of ['site/js/student-data.js', 'site/js/student-lessons.js', 'site/student/dashboard.html', 'site/student/grades.html', 'site/student/schedule.html']) {
  check(`${p}: does not divide a score or add points up`, !/earned\s*\/\s*possible|\.reduce\([^)]*points/.test(read(p)));
}
for (const p of ['site/student/schedule.html', 'site/student/grades.html', 'site/js/student-data.js', 'site/js/student-view.js', 'site/js/student-lessons.js']) {
  check(`${p}: never selects diagnostic`, !/diagnostic/.test(read(p).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/instructor_note:diagnostic->instructor_note/g, '')));
}
check('the student grade select names instructor_note (a my_grades column) and never diagnostic', /GRADE_SELECT_STUDENT\s*=[^;]*instructor_note/.test(read('site/js/schema.js')) && !/GRADE_SELECT_STUDENT\s*=[^;]*diagnostic/.test(read('site/js/schema.js')));

summary();
