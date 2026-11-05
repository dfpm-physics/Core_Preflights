// test-faculty-export.mjs — the backlog piles (site/js/faculty-backlog.js) and both exports
// (site/js/faculty-export.js). No network, no login. Names and ids are invented.

import { check, eq, section, installBrowser, summary } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/backlog.html' });
const B = await import('../../site/js/faculty-backlog.js');
const X = await import('../../site/js/faculty-export.js');

section('pileOf: first match wins');
const c = (o) => ({ state: 'not_due', has_draft_score: false, no_work_received: false, deadline_invalid: false, is_late: false, section_id: 's1', assignment_offering_id: 'i1', ...o });
eq('a draft score waits to be published', B.pileOf(c({ state: 'submitted_ungraded', has_draft_score: true })), 'toPublish');
eq('handed in with no score is work to grade', B.pileOf(c({ state: 'submitted_ungraded' })), 'toGrade');
eq('a no-submission item past due with the column open is scores to enter', B.pileOf(c({ state: 'submitted_ungraded', no_work_received: true })), 'toEnter');
eq('graded but held by a release date', B.pileOf(c({ state: 'graded_unreleased' })), 'held');
eq('an unusable deadline outranks everything', B.pileOf(c({ state: 'missing', deadline_invalid: true })), 'badDate');
eq('missing is not backlog', B.pileOf(c({ state: 'missing' })), null);
eq('released is not backlog', B.pileOf(c({ state: 'released' })), null);
eq('excused is not backlog', B.pileOf(c({ state: 'excused' })), null);

section('groupBacklog counts per item');
const g = B.groupBacklog([c({ state: 'submitted_ungraded' }), c({ state: 'submitted_ungraded', is_late: true, section_id: 's2' }),
  c({ state: 'submitted_ungraded', assignment_offering_id: 'i2' }), c({ state: 'released' })]);
eq('two items in the grade pile, biggest first', g.toGrade.map(r => [r.itemId, r.count, r.late, r.sections.size]), [['i1', 2, 1, 2], ['i2', 1, 0, 1]]);
eq('other piles are empty', [g.toPublish.length, g.toEnter.length], [0, 0]);

section('nearLineRows trusts the database flag');
const near = B.nearLineRows([{ enrollment_id: 'a', near_line_letter: null, rank: 1 }, { enrollment_id: 'b', near_line_letter: 'A-', rank: 9 }, { enrollment_id: 'c', near_line_letter: 'B', rank: 3 }]);
eq('only flagged cadets, closest rank first', near.map(t => t.enrollment_id), ['c', 'b']);

section('csvCell');
eq('plain', X.csvCell('abc'), 'abc');
eq('comma is quoted', X.csvCell('a,b'), '"a,b"');
eq('quote is doubled', X.csvCell('a"b'), '"a""b"');
eq('a formula is defused', X.csvCell('=1+1'), "'=1+1");
eq('a negative number is left alone', X.csvCell('-5'), '-5');
eq('null is empty', X.csvCell(null), '');

section('cellText: a translation of the database state');
eq('released shows the points', X.cellText({ state: 'released', points_earned: 7.5 }), '7.5');
eq('missing shows 0', X.cellText({ state: 'missing' }), '0');
eq('excused shows EX', X.cellText({ state: 'excused', points_earned: 3 }), 'EX');
eq('an ungraded cell is blank', X.cellText({ state: 'submitted_ungraded', points_earned: 3 }), '');
eq('a held score is blank', X.cellText({ state: 'graded_unreleased', points_earned: 3 }), '');
eq('no cell is blank', X.cellText(undefined), '');

section('gradebookCsv carries the database totals as text, untouched');
const people = { e1: { name: 'Ada Test', cadetId: 3000000001, section: 'M1A' }, e2: { name: 'Bo, Sample', cadetId: 3000000002, section: 'M1A' } };
const totals = [
  { enrollment_id: 'e2', student_id: 3000000002, earned_text: '7', possible_text: '10', percent_text: '70', percent_key_text: '70.0000000000000000000000', letter: 'C-', gpa: 1.7, rank: 2, missing_count: 1, ungraded_count: 0, unreleased_count: 0, excused_count: 0 },
  { enrollment_id: 'e1', student_id: 3000000001, earned_text: '9.5', possible_text: '10', percent_text: '95', percent_key_text: '95.0000000000000000000000', letter: 'A', gpa: 4, rank: 1, missing_count: 0, ungraded_count: 0, unreleased_count: 0, excused_count: 1 },
];
const cells = [
  { enrollment_id: 'e1', assignment_offering_id: 'i1', state: 'released', points_earned: 9.5 },
  { enrollment_id: 'e2', assignment_offering_id: 'i1', state: 'missing', points_earned: null },
];
const csv = X.gradebookCsv({ items: [{ id: 'i1', title: 'Quiz 1' }], people, cells, totals, scope: 'final' });
const lines = csv.trim().split('\r\n');
eq('a header and two rows', lines.length, 3);
eq('rows are sorted by name', lines[1].startsWith('3000000001,Ada Test'), true);
check('the total is the database text, not recomputed', lines[1].includes(',9.5,10,95.0000000000000000000000,A,4,1,'));
check('a name with a comma is quoted', lines[2].includes('"Bo, Sample"'));
check('missing shows as 0 in its cell', lines[2].split(',').includes('0') || lines[2].includes(',0,'));

section('blackboardCsv');
const st = { blackboard_export: true, bb_prog_column: 'Prog Grade', bb_final_column: 'Final Grade' };
let r = X.blackboardCsv({ totals, people, scope: 'prog', settings: st, courseCode: 'phys' });
eq('named column, one row per cadet', r.csv.trim().split('\r\n')[0], 'Student ID,Prog Grade,Prog Grade letter');
eq('percent has no trailing zeros and is not rounded', r.csv.trim().split('\r\n')[1], '3000000001,95,A');
eq('filename says scope', r.filename, 'phys-blackboard-prog.csv');
r = X.blackboardCsv({ totals, people, scope: 'final', settings: { ...st, blackboard_export: false } });
check('a course that has not chosen it gets a plain refusal', /not chosen/.test(r.error));
r = X.blackboardCsv({ totals, people, scope: 'final', settings: { ...st, bb_final_column: '' } });
check('an unnamed column is refused', /not set/.test(r.error));
r = X.blackboardCsv({ totals: [{ ...totals[0], percent_key_text: '66.6666666666666666666666' }], people, scope: 'prog', settings: st });
check('a repeating percent is cut at the database digits, never rounded', r.csv.includes('66.6666666666666666666666'));

section('the loaders read every page of a capped API');
{
  // 2,500 cells and 60 totals; the stub returns at most 1,000 rows per request, like the real API.
  const cells = Array.from({ length: 2500 }, (_, i) => ({ enrollment_id: 'e' + String(Math.floor(i / 40)).padStart(4, '0'), assignment_offering_id: 'i' + String(i % 40).padStart(3, '0'), state: 'released', section_id: 's1' }));
  const tot = Array.from({ length: 63 }, (_, i) => ({ enrollment_id: 'e' + String(i).padStart(4, '0'), section_id: 's1' }));
  const sorted = (rows, keys) => [...rows].sort((a, b) => keys.map(k => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)).find(x => x) || 0);
  const chain = (data) => { const c = { select: () => c, eq: () => c, in: () => c, order: () => c, range: () => c, maybeSingle: () => c, then: (res) => res({ data, error: null }) }; return c; };
  const db = {
    rpc(name) {
      const keys = []; const src = name === 'gradebook_cells' ? cells : tot;
      const b = { order(k) { keys.push(k); return b; }, range(from, to) { return Promise.resolve({ data: sorted(src, keys).slice(from, Math.min(to + 1, from + 1000)), error: null }); } };
      return b;
    },
    from(t) { return chain(t === 'assignment_offerings' ? [] : t === 'course_offering_settings' ? null : []); },
  };
  const bl = await B.loadBacklog(db, 'co', 'final');
  eq('the backlog sees all 2,500 cells', bl.cells.length, 2500);
  const ex = await X.loadExport(db, 'co', 'final');
  eq('the export sees all 2,500 cells', ex.cells.length, 2500);
  eq('and all 63 totals', ex.totals.length, 63);
}

process.exit(summary() ? 0 : 1);
