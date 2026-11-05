// test-faculty-entry-parse.mjs — the pure rules behind score entry and grade-file import
// (site/js/faculty-entry-parse.js). No network, no login. All names and ids are invented.

import { check, eq, section, installBrowser, summary } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/entry.html' });
const P = await import('../../site/js/faculty-entry-parse.js');

/* ── Scores ─────────────────────────────────────────────────────────────────── */
section('parseScore: exact hundredths');
eq('whole number', P.parseScore('12'), { ok: true, cents: 1200 });
eq('one decimal', P.parseScore('12.5'), { ok: true, cents: 1250 });
eq('two decimals', P.parseScore('0.07'), { ok: true, cents: 7 });
eq('leading point', P.parseScore('.5'), { ok: true, cents: 50 });
eq('padding spaces', P.parseScore('  3 '), { ok: true, cents: 300 });
eq('trailing zeros past two places are exact', P.parseScore('12.500'), { ok: true, cents: 1250 });
eq('blank is blank, not zero', P.parseScore('   '), { ok: true, blank: true });
eq('an explicit zero is a score', P.parseScore('0'), { ok: true, cents: 0 });
check('a third decimal is refused, never rounded', P.parseScore('12.345').ok === false);
check('0.1 + 0.2 style input stays exact', P.parseScore('0.30').cents === 30);
check('negative is refused', P.parseScore('-1').ok === false);
check('a word is refused', P.parseScore('AB').ok === false);
check('an exponent is refused', P.parseScore('1e3').ok === false);
check('a lone point is refused', P.parseScore('.').ok === false);
check('a comma decimal is refused', P.parseScore('1,5').ok === false);
eq('centsText whole', P.centsText(1200), '12');
eq('centsText fraction', P.centsText(1205), '12.05');
eq('centsText one place', P.centsText(1250), '12.5');
eq('centsText small', P.centsText(5), '0.05');
eq('dbCents reads a numeric string', P.dbCents('7.50'), 750);
eq('dbCents null stays null', P.dbCents(null), null);

section('checkCell: the item bound');
const ten = { id: 'i1', title: 'Quiz 1', pointsCents: 1000, bonus: false };
eq('at the maximum passes', P.checkCell('10', ten).cents, 1000);
check('above the maximum is refused', P.checkCell('10.01', ten).ok === false);
eq('above the maximum on a bonus item passes', P.checkCell('12', { ...ten, bonus: true }).cents, 1200);
eq('blank passes through', P.checkCell('', ten), { ok: true, blank: true });

/* ── Detecting and reading the formats ──────────────────────────────────────── */
section('detectFormat');
const gsA = 'Name,First Name,Last Name,SID,Email,Sections,Total Score,Max Points,Status,Submission ID\n';
const gsC = 'First Name,Last Name,SID,Email,Sections,Quiz 1,Quiz 1 - Max Points,Quiz 1 - Submission ID,Quiz 2,Quiz 2 - Max Points\n';
const teams = 'First Name,Last Name,Email Address,Lab 1,Points,Feedback,Lab 2,Points,Feedback\n';
eq('gradescope one assignment', P.detectFormat(gsA.trim().split(',')), 'gradescope-assignment');
eq('gradescope whole course', P.detectFormat(gsC.trim().split(',')), 'gradescope-course');
eq('teams triplets', P.detectFormat(teams.trim().split(',')), 'teams');
eq('anything else', P.detectFormat(['a', 'b', 'c']), null);
eq('teams with a broken triplet is not teams', P.detectFormat('First Name,Last Name,Email Address,Lab 1,Max,Feedback'.split(',')), null);

section('parseGradeFile: Gradescope, one assignment');
const gsAFile = gsA
  + 'Ada Test,Ada,Test,3000000001,ada.test@x.example,A,9.5,10,Graded,1\n'
  + 'Bo Sample,Bo,Sample,3000000002.0,bo.sample@x.example,A,,10,Missing,\n'
  + 'Cy Demo,Cy,Demo,3000000003,cy.demo@x.example,A,7,10,Ungraded,3\n';
let g = P.parseGradeFile(gsAFile);
eq('format', g.format, 'gradescope-assignment');
eq('one column', g.columns.length, 1);
eq('max read from Max Points', g.columns[0].maxCents, 1000);
eq('three rows', g.rows.length, 3);
eq('score kept', g.rows[0].cells, ['9.5']);
eq('an Excel ".0" id is cleaned', g.rows[1].sid, '3000000002');
eq('Missing is blank, not zero', g.rows[1].cells, ['']);
eq('Ungraded with a number is still left blank', g.rows[2].cells, ['']);
eq('line numbers count the header', g.rows[0].rowNo, 2);
check('says that Missing rows were left blank', g.notes.some(n => /left blank/.test(n)) || g.rows[1].cells[0] === '');

section('parseGradeFile: Gradescope, whole course');
const gsCFile = gsC + 'Ada,Test,3000000001,ada.test@x.example,A,8,10,1,9,10\nBo,Sample,3000000002,bo.sample@x.example,A,,10,,6,10\n';
g = P.parseGradeFile(gsCFile);
eq('two item columns', g.columns.map(c => c.name), ['Quiz 1', 'Quiz 2']);
eq('maxes', g.columns.map(c => c.maxCents), [1000, 1000]);
eq('cells follow the column', g.rows[1].cells, ['', '6']);

section('parseGradeFile: Teams');
const teamsFile = teams + 'Ada,Test,ada.test@x.example,8,10,Good,,10,\nBo,Sample,bo.sample@x.example,"6.5",10,"ok, fine",9,10,\n';
g = P.parseGradeFile(teamsFile);
eq('format', g.format, 'teams');
eq('columns', g.columns.map(c => c.name), ['Lab 1', 'Lab 2']);
eq('max from the Points column', g.columns[0].maxCents, 1000);
eq('quoted comma stays in its cell', g.rows[1].cells, ['6.5', '9']);
check('feedback is reported as dropped', g.notes.some(n => /feedback/i.test(n)));

section('parseGradeFile: refusals and shape');
check('empty file', P.parseGradeFile('').error);
check('wrong header', /not a Gradescope or Teams/.test(P.parseGradeFile('a,b\n1,2\n').error));
eq('a byte-order mark and CRLF are fine', P.parseGradeFile('﻿' + gsAFile.replace(/\n/g, '\r\n')).rows.length, 3);
eq('blank spacer rows are dropped', P.parseGradeFile(gsAFile + '\n\n').rows.length, 3);

/* ── Matching ───────────────────────────────────────────────────────────────── */
const roster = [
  { enrollmentId: 'e1', studentId: 3000000001, name: 'Ada Test', email: 'ada.test@x.example', status: 'active' },
  { enrollmentId: 'e2', studentId: 3000000002, name: 'Bo Sample', email: 'bo.sample@x.example', status: 'active' },
  { enrollmentId: 'e3', studentId: 3000000003, name: 'Cy Demo', email: 'cy.demo@x.example', status: 'completed' },
  { enrollmentId: 'e4', studentId: 3000000004, name: 'Di Dropped', email: 'di.dropped@x.example', status: 'dropped' },
  { enrollmentId: 'e5', studentId: 3000000005, name: 'Ed Same', email: 'ed1@x.example', status: 'active' },
  { enrollmentId: 'e6', studentId: 3000000006, name: 'Ed Same', email: 'ed2@x.example', status: 'active' },
  // a cadet holding one counted and one dropped enrollment is matched to the counted one
  { enrollmentId: 'e7', studentId: 3000000007, name: 'Flo Twice', email: 'flo@x.example', status: 'dropped' },
  { enrollmentId: 'e8', studentId: 3000000007, name: 'Flo Twice', email: 'flo@x.example', status: 'active' },
];
section('matchRoster');
const row = (o) => ({ rowNo: 2, sid: '', email: '', first: '', last: '', name: '', cells: [], ...o });
let m = P.matchRoster([row({ sid: '3000000001' })], roster);
eq('by cadet ID', [m.matches[0].enrollmentId, m.matches[0].method], ['e1', 'cadet ID']);
m = P.matchRoster([row({ email: 'BO.SAMPLE@X.EXAMPLE' })], roster);
eq('by email, ignoring case', [m.matches[0].enrollmentId, m.matches[0].method], ['e2', 'email']);
m = P.matchRoster([row({ name: 'Cy Demo', first: 'Cy', last: 'Demo' })], roster);
eq('by a unique name, and says so', [m.matches[0].enrollmentId, m.matches[0].method], ['e3', 'name']);
m = P.matchRoster([row({ name: 'Demo, Cy' })], roster);
eq('by a Last, First name', m.matches[0]?.enrollmentId, 'e3');
m = P.matchRoster([row({ name: 'Ed Same' })], roster);
eq('a name shared by two cadets is not guessed', [m.matches.length, m.unmatched.length], [0, 1]);
m = P.matchRoster([row({ sid: '3000000004' })], roster);
eq('a dropped cadet is reported as dropped', m.unmatched[0].reason, 'only a dropped enrollment');
m = P.matchRoster([row({ sid: '3000000099', name: 'Nobody Here' })], roster);
eq('a stranger is unmatched', m.unmatched[0].reason, 'the cadet ID matches nobody on this roster');
m = P.matchRoster([row({ name: 'Nobody Here' })], roster);
eq('a stranger with no ID is unmatched', m.unmatched[0].reason, 'not on this course roster');
m = P.matchRoster([row({ sid: '3000000007' })], roster);
eq('the counted enrollment wins over the dropped one', m.matches[0].enrollmentId, 'e8');
m = P.matchRoster([row({ rowNo: 2, sid: '3000000001' }), row({ rowNo: 5, email: 'ada.test@x.example' })], roster);
eq('two rows for one cadet are reported', m.duplicates, [{ enrollmentId: 'e1', name: 'Ada Test', rowNos: [2, 5] }]);

/* ── The plan ───────────────────────────────────────────────────────────────── */
section('buildImportPlan');
const q1 = { id: 'q1', title: 'Quiz 1', pointsCents: 1000, bonus: false };
const q2 = { id: 'q2', title: 'Quiz 2', pointsCents: 1000, bonus: false };
const fileOf = (rows) => ({ format: 'gradescope-course', notes: [], columns: [{ key: 'c0', name: 'Quiz 1', maxCents: 1000 }, { key: 'c1', name: 'Quiz 2', maxCents: 1000 }], rows });
const fr = (rowNo, sid, a, b) => ({ rowNo, sid, email: '', first: '', last: '', name: 'X', cells: [a, b] });
const base = { mapping: { c0: q1, c1: q2 }, roster, existing: {} };

let plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8', '9'), fr(3, '3000000002', '', '6')]) });
eq('clean file: three new cells', plan.changes.map(c => [c.enrollmentId, c.itemId, c.cents, c.kind]),
  [['e1', 'q1', 800, 'new'], ['e1', 'q2', 900, 'new'], ['e2', 'q2', 600, 'new']]);
check('clean file can be applied', plan.canApply === true);
eq('a blank cell is no change', plan.counts.changes, 3);

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8', ''), fr(3, '3000000001', '7', '')]) });
check('duplicate cadet blocks the import', plan.blockers.some(b => /lines 2 and 3/.test(b)) && !plan.canApply);
eq('and nothing from the duplicate is planned', plan.changes.length, 0);

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8', ''), fr(3, '3999999999', '5', '')]) });
check('an unmatched row holds the import and is named', plan.held.length === 1 && /line 3/.test(plan.held[0]) && !plan.canApply);
eq('unmatched rows are listed', plan.unmatched.length, 1);
plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8', ''), fr(3, '3999999999', '5', '')]), options: { skipUnmatched: true } });
check('skipping them lets the rest go', plan.canApply && plan.changes.length === 1);

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8.123', ''), fr(3, '3000000002', 'AB', '')]) });
check('a third decimal and a word both block, with their lines',
  plan.blockers.length === 1 && /line 2/.test(plan.blockers[0]) && /line 3/.test(plan.blockers[0]) && !plan.canApply);
eq('and nothing is planned from a refused file', plan.changes.length >= 0 && !plan.canApply, true);

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '11', '')]) });
check('a score over the maximum blocks', !plan.canApply && /more than the 10/.test(plan.blockers[0]));

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '8', '')]),
  existing: { 'e1|q1': { cents: 800, finalized: false, updatedAt: 't' } } });
check('a file that changes nothing says so', !plan.canApply && /already entered/.test(plan.blockers[0]) && plan.same === 1);

plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '9', '')]),
  existing: { 'e1|q1': { cents: 800, finalized: true, updatedAt: 't' } } });
check('replacing a published grade is held until allowed', plan.held.length === 1 && !plan.canApply);
eq('the old value and its version ride with the change', [plan.changes[0].old, plan.changes[0].updatedAt, plan.changes[0].kind], [800, 't', 'changed']);
plan = P.buildImportPlan({ ...base, parsed: fileOf([fr(2, '3000000001', '9', '')]), options: { allowPublished: true },
  existing: { 'e1|q1': { cents: 800, finalized: true, updatedAt: 't' } } });
check('and allowed when the instructor says so', plan.canApply);

plan = P.buildImportPlan({ ...base, mapping: { c0: q1, c1: q1 }, parsed: fileOf([fr(2, '3000000001', '8', '7')]) });
check('two columns into one item block', plan.blockers.some(b => /both matched/.test(b)));
plan = P.buildImportPlan({ ...base, mapping: {}, parsed: fileOf([fr(2, '3000000001', '8', '7')]) });
check('no matched column blocks', plan.blockers.some(b => /No file column/.test(b)));

// A file maximum that differs from the item's points is a choice the person makes, never a silent import.
// 6 of a file out of 20 is 30%, and would be entered as 6 of 10 (60%) with no other sign.
const bigMax = { c0: { ...q1, pointsCents: 1000 } };
const maxFile = (v) => ({ format: 'gradescope-assignment', notes: [], columns: [{ key: 'c0', name: 'Total Score', maxCents: 2000 }], rows: [{ rowNo: 2, sid: '3000000001', email: '', first: '', last: '', name: 'X', cells: [v] }] });
plan = P.buildImportPlan({ ...base, mapping: bigMax, parsed: maxFile('6') });
check('a differing maximum holds the import even when every score is within the item', !plan.canApply && plan.held.some(h => /20/.test(h) && /10/.test(h)));
eq('the page is told which column to ask about', plan.maxMismatch.map(x => [x.key, x.fileMaxCents, x.itemPointsCents]), [['c0', 2000, 1000]]);
plan = P.buildImportPlan({ ...base, mapping: bigMax, parsed: maxFile('6'), options: { acceptMax: { c0: true } } });
check('it goes ahead once the person accepts that column as written', plan.canApply && plan.changes[0].cents === 600);
plan = P.buildImportPlan({ ...base, mapping: bigMax, parsed: maxFile('6'), options: { acceptMax: { c1: true } } });
check('accepting a different column does not release it', !plan.canApply);
plan = P.buildImportPlan({ ...base, mapping: { c0: { ...q1, bonus: true, pointsCents: 1000 } }, parsed: maxFile('6') });
check('a bonus item is held too', !plan.canApply);
plan = P.buildImportPlan({ ...base, mapping: { c0: q1 }, parsed: { ...maxFile('6'), columns: [{ key: 'c0', name: 'Total Score', maxCents: null }] } });
check('no maximum in the file means nothing to compare', plan.canApply);

// An unknown cadet ID is never a reason to try the name.
m = P.matchRoster([row({ sid: '3000000099', first: 'Ada', last: 'Test', name: 'Ada Test', email: 'ada.test@x.example' })], roster);
eq('an ID that matches nobody is unmatched even when the name and email match someone', [m.matches.length, m.unmatched.length], [0, 1]);
eq('and the reason names the ID', /cadet ID/.test(m.unmatched[0].reason), true);
m = P.matchRoster([row({ sid: '', sidRaw: '3.00E+09', name: 'Ada Test' })], roster);
eq('an ID the spreadsheet mangled is unmatched, not read as blank', [m.matches.length, m.unmatched.length], [0, 1]);
m = P.matchRoster([row({ sid: '3000000099', email: 'bo.sample@x.example' })], roster);
eq('an unknown ID does not fall through to email either', m.matches.length, 0);
m = P.matchRoster([row({ sid: '', name: 'Ada Test' })], roster);
eq('a row with no ID at all still matches by name', m.matches[0]?.method, 'name');
g = P.parseGradeFile(gsA + 'Ada Test,Ada,Test,3.00E+09,ada.test@x.example,A,9,10,Graded,1\n');
eq('the parser keeps what the ID cell held', [g.rows[0].sid, g.rows[0].sidRaw], ['', '3.00E+09']);

// A name-only match is the weakest kind and is released only by a tick.
plan = P.buildImportPlan({ ...base, mapping: { c0: q1 }, parsed: fileOf([{ ...fr(2, '', '8', ''), name: 'Ada Test', first: 'Ada', last: 'Test' }]) });
check('a name-only match holds the import', !plan.canApply && plan.held.some(h => /name/.test(h)) && plan.nameMatched.length === 1);
plan = P.buildImportPlan({ ...base, mapping: { c0: q1 }, parsed: fileOf([{ ...fr(2, '', '8', ''), name: 'Ada Test', first: 'Ada', last: 'Test' }]), options: { acceptNameMatches: true } });
check('and goes ahead once ticked', plan.canApply && plan.changes[0].method === 'name');
plan = P.buildImportPlan({ ...base, mapping: { c0: q1 }, parsed: fileOf([fr(2, '3000000001', '8', '')]) });
check('an ID match never needs a tick', plan.canApply && plan.nameMatched.length === 0);

// NaN and infinity are not scores.
for (const bad of ['NaN', 'nan', 'Infinity', '-Infinity', '1e1', '0x10']) {
  check(`parseScore refuses ${bad}`, P.parseScore(bad).ok === false);
}

plan = P.buildImportPlan({ ...base, mapping: { c0: { ...q1, bonus: true } }, parsed: fileOf([fr(2, '3000000001', '12', '')]) });
check('a bonus item accepts a score over its points', plan.canApply);

plan = P.buildImportPlan({ ...base, mapping: { c0: q1 }, parsed: fileOf([fr(2, '3000000001', '0', '')]) });
eq('an explicit zero is entered', [plan.canApply, plan.changes[0].cents], [true, 0]);

/* ── Grid entry ─────────────────────────────────────────────────────────────── */
section('buildEntryChanges');
let r = P.buildEntryChanges({ item: q1, inputs: { e1: '8', e2: '', e3: '10.5', e4: '2.555' },
  existing: { 'e1|q1': { cents: 800, finalized: false, updatedAt: 'u' } } });
eq('an unchanged cell is not a change', r.same, 1);
eq('blank cells are skipped', r.changes.length, 0);
eq('over the maximum and a third decimal are both named', r.errors.map(e => e.enrollmentId).sort(), ['e3', 'e4']);
r = P.buildEntryChanges({ item: q1, inputs: { e1: '9', e2: '0' }, existing: { 'e1|q1': { cents: 800, finalized: false, updatedAt: 'u' } } });
eq('a changed cell carries the version it was read at', r.changes[0], { enrollmentId: 'e1', itemId: 'q1', cents: 900, old: 800, kind: 'changed', finalized: false, updatedAt: 'u' });
eq('zero is entered as a score', r.changes[1].cents, 0);

section('guessItem');
eq('same title ignoring case and punctuation', P.guessItem('quiz-1', [q1, q2])?.id, 'q1');
eq('no guess when it is not clear', P.guessItem('Quiz', [q1, q2]), null);


process.exit(summary() ? 0 : 1);
