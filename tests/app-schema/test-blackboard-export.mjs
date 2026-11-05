// test-blackboard-export.mjs -- the Blackboard export for every kind of item, built the way the live
// preflight fill works: the staff member uploads Blackboard's OWN export, the page writes numbers into
// columns that already exist, and the same file shape comes back. No network, no login.
//
// The live workflow it mirrors is site/js/blackboard-fill.js (read from the published site code):
//   * match cadets by the 30xxxxxxxx ID only, never by name; refuse a file with no ID column
//   * match columns by a safe key, never by a guess; a duplicate claims neither
//   * a blank where the database has no score to give, never an invented zero
//   * add, rename and reorder nothing; send back only the identity columns and the columns posted
//   * keep the file's own delimiter, line ending, BOM and quoting
// What is new: every kind of item (matched by its exact title when it is not a preflight), and the course's
// Prog and Final grade columns (matched by the names the Director saved), filled from course_totals.
//
// Names and IDs are invented.

import { check, eq, section, summary } from './harness.mjs';
import { readFile, fillGrid, narrowToPosted, toCsv, checkFiles } from '../../site/js/blackboard-fill.js';
import * as BB from '../../site/js/blackboard-fill.js';
import * as X from '../../site/js/faculty-export.js';

const A = 3000111111, B = 3000222222, C = 3000333333, D = 3000444444;

const settings = { blackboard_export: true, bb_prog_column: 'Prog Grade', bb_final_column: 'Final Grade' };
const items = [
  { id: 'i-pf7', title: 'Lesson 07 Preflight - Charge', slug: 'preflight-07' },
  { id: 'i-quiz', title: 'Quiz 1 - Gauss', slug: 'quiz-1' },
  { id: 'i-lab', title: 'Lab 2 - Fields', slug: 'lab-2' },
  { id: 'i-pf8', title: 'Lesson 08 Preflight - Gauss', slug: 'preflight-08' },
];
const { targets, error } = X.blackboardTargets({ items, settings });
check('a course that chose the export gets targets', !error && targets.length > 0, String(error));

// A Blackboard-shaped export: every field quoted, a BOM, bare LF, two-decimal scores, an identity block that
// carries no points, a homework column that holds real marks, and a trailing non-student row.
const HEAD = ['Last Name', 'First Name', 'Username', 'Student ID', 'Availability',
  'PF 07 [Total Pts: 2 Score] |574260',
  'Quiz 1 - Gauss [Total Pts: 20 Score] |574261',
  'Lab 2 - Fields [Total Pts: 10 Score] |574262',
  'Lesson 8 Homework [Total Pts: 5 Score] |574263',
  'Prog Grade [Total Pts: 100 Score] |574270',
  'Prog Grade letter [Total Pts: 0 Text] |574271',
  'Final Grade [Total Pts: 100 Score] |574272'];
const GRID = [HEAD,
  ['Testcadet', 'Alpha', 'tc.alpha', String(A), 'Yes', '', '', '', '4.00', '', '', ''],
  ['Testcadet', 'Bravo', 'tc.bravo', String(B), 'Yes', '', '', '', '', '', '', ''],
  ['Testcadet', 'Charlie', 'tc.charlie', String(C), 'Yes', '', '', '', '3.00', '', '', ''],
  ['Points Possible', '', '', '', '', '2.00', '20.00', '10.00', '5.00', '100.00', '', '100.00']];
const FILE = toCsv(GRID, ',', { eol: '\n', bom: true, trailingEol: true });

section('matching: every kind of item, and the total columns');
const f = readFile(FILE, targets, BB.matchTargets);
check('the file is read', !f.error, String(f.error));
const keyAt = (name) => f.matched[HEAD.findIndex(h => h.startsWith(name))];
eq('a preflight column matches by the PF token and the lesson number', keyAt('PF 07'), 'i-pf7');
eq('a quiz column matches by its exact title', keyAt('Quiz 1 - Gauss'), 'i-quiz');
eq('a lab column matches by its exact title', keyAt('Lab 2 - Fields'), 'i-lab');
eq('the Prog column matches the name the Director saved', keyAt('Prog Grade ['), 'total:prog:percent');
eq('a letter column matches the saved name plus "letter"', keyAt('Prog Grade letter'), 'total:prog:letter');
eq('the Final column matches', keyAt('Final Grade'), 'total:final:percent');
check('a homework column we hold no item for is never matched', keyAt('Lesson 8 Homework') === undefined);
check('the identity columns are never matched', [0, 1, 2, 3, 4].every(i => f.matched[i] === undefined));
eq('the preflight we hold with no column is reported, not dropped', f.unmatched.map(t => t.key), ['i-pf8', 'total:final:letter']);

section('values: the database text, a blank where it has none');
const people = { e1: { cadetId: A }, e2: { cadetId: B }, e3: { cadetId: C } };
const cells = [
  { enrollment_id: 'e1', assignment_offering_id: 'i-pf7', state: 'released', points_earned: 2 },
  { enrollment_id: 'e1', assignment_offering_id: 'i-quiz', state: 'released', points_earned: 17.5 },
  { enrollment_id: 'e1', assignment_offering_id: 'i-lab', state: 'excused', points_earned: 9 },
  { enrollment_id: 'e2', assignment_offering_id: 'i-pf7', state: 'missing', points_earned: null },
  { enrollment_id: 'e2', assignment_offering_id: 'i-quiz', state: 'submitted_ungraded', points_earned: 3 },
  { enrollment_id: 'e2', assignment_offering_id: 'i-lab', state: 'graded_unreleased', points_earned: 8 },
  { enrollment_id: 'e3', assignment_offering_id: 'i-quiz', state: 'released', points_earned: 20 },
];
const tot = (id, pk, letter) => ({ enrollment_id: id, percent_key_text: pk, letter });
const totalsFinal = [tot('e1', '95.0000000000000000000000', 'A'), tot('e2', '66.6666666666666666666666', 'D'), tot('e3', null, null)];
const totalsProg = [tot('e1', '90.5000000000000000000000', 'A-'), tot('e2', '70.0000000000000000000000', 'C-'), tot('e3', null, null)];
const lookup = X.blackboardLookup({ cells, totals: { final: totalsFinal, prog: totalsProg }, people });
eq('a released score is the database number, as the gradebook export prints it', lookup(A, 'i-quiz'), '17.5');
eq('a missing score is 0, as the total counts it', lookup(B, 'i-pf7'), '0');
eq('a cadet with no cell gets a blank, never a zero', lookup(C, 'i-pf7'), '');
eq('a score waiting to be graded is blank', lookup(B, 'i-quiz'), '');
eq('a held score is blank', lookup(B, 'i-lab'), '');
eq('an excused item is blank, not text in a number column', lookup(A, 'i-lab'), '');
eq('the Final percent is the database digits, trailing zeros cut', lookup(A, 'total:final:percent'), '95');
eq('a repeating percent is cut at the database digits, never rounded', lookup(B, 'total:final:percent'), '66.6666666666666666666666');
eq('the Prog percent reads the Prog total, not the Final one', lookup(A, 'total:prog:percent'), '90.5');
eq('the letter is the database letter', lookup(A, 'total:prog:letter'), 'A-');
eq('no percent yet is a blank', lookup(C, 'total:final:percent'), '');
eq('an unknown cadet is a blank', lookup(3000999999, 'i-quiz'), '');

section('fill and narrow: only what is posted leaves, in the shape it came');
const filled = fillGrid(f.grid, f.idColumn.index, f.matched, lookup, { decimals: f.format.decimals });
const col = (name) => HEAD.findIndex(h => h.startsWith(name));
eq('the percent is written verbatim, not re-rounded to the file width', filled.grid[2][col('Final Grade')], '66.6666666666666666666666');
eq('Alpha quiz', filled.grid[1][col('Quiz 1')], '17.5');
eq('the non-student row is copied through untouched', filled.grid[4], GRID[4]);
eq('the homework column is not touched', filled.grid.slice(1, 4).map(r => r[col('Lesson 8')]), ['4.00', '', '3.00']);
const n = narrowToPosted(filled.grid, f.matched, f.idColumn.index);
const kept = n.grid[0];
check('the identity block stays', ['Last Name', 'First Name', 'Username', 'Student ID', 'Availability'].every(h => kept.includes(h)));
check('the homework column is dropped, so Blackboard cannot read a blank as erase', !kept.some(h => h.startsWith('Lesson 8')));
check('the lab column that carried no posted value is dropped', !kept.some(h => h.startsWith('Lab 2')));
check('the posted columns stay with their headers unchanged', kept.includes('Quiz 1 - Gauss [Total Pts: 20 Score] |574261') && kept.includes('Final Grade [Total Pts: 100 Score] |574272'));
const out = toCsv(n.grid, f.delimiter, f.format);
check('the BOM, bare LF and trailing newline of the original survive', out.charCodeAt(0) === 0xFEFF && !out.includes('\r') && out.endsWith('\n'));
check('every field stays quoted like the original', out.split('\n')[1].startsWith('"Testcadet","Alpha"'));

section('a mismatch refuses or reports, and never guesses');
{
  const dup = [['Student ID', 'Quiz 1 - Gauss [Total Pts: 20] |1', 'Quiz 1 - Gauss [Total Pts: 20] |2'], [String(A), '', '']];
  const m = BB.matchTargets(dup[0], targets);
  eq('two columns with one title fill neither', Object.keys(m.matched).length, 0);
  check('and the duplicate is named', m.columns.some(c => /duplicate/.test(c.note || '')));
}
{
  const twin = X.blackboardTargets({ items: [{ id: 'a', title: 'Quiz 5', slug: 'q5a' }, { id: 'b', title: 'Quiz 5', slug: 'q5b' }], settings });
  const m = BB.matchTargets(['Student ID', 'Quiz 5 [Total Pts: 10] |9'], twin.targets);
  eq('two items with one title match no column', Object.keys(m.matched).length, 0);
  check('and the ambiguity is reported', (m.ambiguous || []).length === 1);
}
{
  const m = BB.matchTargets(['Student ID', 'Homework 3 [Total Pts: 10] |1', 'Quiz 1 - Gauss Extra Credit [Total Pts: 5] |2'], targets);
  eq('a title that only starts like ours is not a match', Object.keys(m.matched).length, 0);
}
{
  const bad = readFile('"Name","Quiz 1 - Gauss"\n"x","1"\n', targets, BB.matchTargets);
  check('a file with no cadet ID column is refused', !!bad.error);
  check('an Excel workbook is refused with the way out', /CSV/.test(readFile('PK\x03\x04junk', targets, BB.matchTargets).error));
}
{
  const t = X.blackboardTargets({ items, settings: { ...settings, bb_prog_column: '', bb_final_column: null } });
  check('a column name the Director has not saved makes no total target', !t.targets.some(x => x.kind === 'total'));
  const none = X.blackboardTargets({ items, settings: { ...settings, blackboard_export: false } });
  check('a course that has not chosen the export gets a plain refusal', /not chosen/.test(none.error));
  check('and no settings row at all is the same refusal', /not chosen/.test(X.blackboardTargets({ items, settings: null }).error));
}
{
  const x = checkFiles([{ label: 'one.csv', ids: [A, B] }], [
    { studentId: A, sectionCode: 'M1A' }, { studentId: B, sectionCode: 'M1A' }, { studentId: C, sectionCode: 'M1A' }, { studentId: D, sectionCode: 'T1B' }]);
  eq('a section that is only partly in the upload is an error the page can show', x.partial.map(p => p.sectionCode), ['M1A']);
  eq('a section in no file is reported as not in this upload', x.uncovered.map(s => s.sectionCode), ['T1B']);
}

section('the preflight fill still behaves as it did');
{
  const offs = [{ id: 'off-07', lesson: 7, title: 'x' }];
  const g = [['Student ID', 'PF 07 [Total Pts: 2] |1'], [String(A), '']];
  const r = readFile(toCsv(g), offs);
  const o = fillGrid(r.grid, r.idColumn.index, r.matched, () => 2, { decimals: 2 });
  eq('a number is still written to the width of the file', o.grid[1][1], '2.00');
  const z = fillGrid(r.grid, r.idColumn.index, r.matched, () => null, { decimals: 2 });
  eq('and no grade is still an empty cell', z.grid[1][1], '');
}

summary();
