// test-blackboard-fill.mjs — the pure rules in site/js/blackboard-fill.js.
// No network, no login: this imports the shipped module and exercises it directly.
//
// The fixtures are shaped like a Blackboard export rather than like a tidy CSV, because the two
// differ in exactly the ways that break a naive reader: metadata baked into the column header, a
// non-student "Points Possible" row, and names containing commas.
//
// The assertions that matter most are the NEGATIVE ones — that an ungraded lesson produces an
// empty cell and not a zero, that an exam column is never mistaken for a preflight, and that a
// file with no cadet ID column is refused rather than matched on something weaker.

import { check, eq, section } from './harness.mjs';
import {
  findIdColumn, lessonNumberOf, matchColumns, fillGrid, toCsv, readFile, checkFiles,
} from '../../site/js/blackboard-fill.js';

/* Synthetic cadet IDs in the real 30xxxxxxxx range, and synthetic names. CORE.md §3: a fixture
 * that looks synthetic and is not survives every redaction pass done by eye. */
const A = 3000111111, B = 3000222222, C = 3000333333, D = 3000444444,
      E = 3000555555, F = 3000666666;

const OFFERINGS = [
  { id: 'off-07', lesson: 7,  title: 'Lesson 07 Preflight — Charge Distributions' },
  { id: 'off-08', lesson: 8,  title: "Lesson 08 Preflight — Gauss's Law" },
  { id: 'off-09', lesson: 9,  title: 'Lesson 09 Preflight — Electric Potential' },
];

/* A Blackboard-shaped export: metadata in the headers, an exam column, and a trailing
 * non-student row of the kind Blackboard emits. */
const BB_HEADER = ['Last Name', 'First Name', 'Student ID',
                   'Preflight 7 [Total Pts: 2] |8842001',
                   'Preflight 8 [Total Pts: 2] |8842002',
                   'Preflight 9 [Total Pts: 2] |8842003',
                   'Exam 1 [Total Pts: 100] |8842900'];

const BB_GRID = [
  BB_HEADER,
  ['Testcadet', 'Alpha',  String(A), '', '', '', '88'],
  ['Testcadet', 'Bravo',  String(B), '', '', '', '91'],
  ['Points Possible', '', '', '2', '2', '2', '100'],
];


/* ── Finding the cadet ID column ────────────────────────────────────────────── */
section('findIdColumn');

{
  const r = findIdColumn(BB_GRID);
  eq('finds the ID column', r.index, 2);
  eq('and says it proved it from the data', r.how, 'content');
  eq('counting only real cadet IDs', r.hits, 2);
}

{
  // No header the alias list knows, but the content is unmistakable. This is the case that makes
  // the module robust to a Blackboard export nobody has seen yet.
  const g = [['Surname', 'Given', 'Blackboard Key'], ['X', 'Y', String(A)], ['P', 'Q', String(B)]];
  eq('finds it by content when the header is unfamiliar', findIdColumn(g).index, 2);
}

{
  // A column CALLED "ID" holding Blackboard's own internal keys. Header says column 0, content
  // says column 2. Content must win, or every lookup silently misses and the output looks like
  // "nobody has a grade yet".
  const g = [['ID', 'Name', 'Registrar Number'],
             ['_9931_1', 'X', String(A)],
             ['_9932_1', 'Y', String(B)]];
  const r = findIdColumn(g);
  eq('content beats a misleading header', r.index, 2);
  eq('and the disagreement is reported', r.disagreedWith, 'ID');
}

{
  const g = [['Last', 'First', 'Email'], ['X', 'Y', 'a@b.edu'], ['P', 'Q', 'c@d.edu']];
  const r = findIdColumn(g);
  check('refuses a file with no cadet ID column', !!r.error);
  check('and says why, naming the ID', /30/.test(r.error || ''));
  check('and does not fall back to name matching', !/name/i.test(r.error || '') || /not supported/i.test(r.error));
}

{
  const r = findIdColumn([['Student ID', 'Score']]);
  check('refuses a header-only file', !!r.error);
}

{
  // One stray cadet-shaped number in a free-text column must not win the column.
  const g = [['Note', 'Student ID'],
             ['ref 3000111111', String(A)],
             ['no number here', String(B)],
             ['nor here', String(C)]];
  eq('a single stray ID does not claim the column', findIdColumn(g).index, 1);
}


/* ── Reading a lesson number out of a column header ──────────────────────────── */
section('lessonNumberOf');

eq('reads our own assignment title', lessonNumberOf('Lesson 08 Preflight — Gauss'), 8);
eq('reads a slug', lessonNumberOf('preflight-08'), 8);
eq('ignores [Total Pts: 2]', lessonNumberOf('Preflight 8 [Total Pts: 2]'), 8);
eq('ignores a trailing column id', lessonNumberOf('Preflight 8 |8842002'), 8);
eq('ignores both at once', lessonNumberOf('Preflight 7 [Total Pts: 2] |8842001'), 7);
eq('accepts a hyphenated spelling', lessonNumberOf('Pre-Flight 12'), 12);
eq('accepts iPREP wording', lessonNumberOf('iPREP 3'), 3);
eq('rejects an exam column', lessonNumberOf('Exam 1 [Total Pts: 100]'), null);
eq('rejects homework', lessonNumberOf('Homework 8'), null);
eq('rejects a preflight column with no number', lessonNumberOf('Preflight Total'), null);
eq('rejects an empty header', lessonNumberOf(''), null);


/* ── Matching columns to offerings ───────────────────────────────────────────── */
section('matchColumns');

{
  const m = matchColumns(BB_HEADER, OFFERINGS);
  eq('matches all three preflights', Object.keys(m.matched).length, 3);
  eq('lesson 7 to its column', m.matched[3], 'off-07');
  eq('lesson 8 to its column', m.matched[4], 'off-08');
  eq('lesson 9 to its column', m.matched[5], 'off-09');
  check('never claims the exam column', !Object.keys(m.matched).includes('6'));
  eq('nothing left unmatched', m.unmatchedOfferings.length, 0);
}

{
  // A lesson we hold that the director has not made a Blackboard column for. It must be
  // REPORTED, not silently dropped — that is a grade with nowhere to go.
  const m = matchColumns(['Student ID', 'Preflight 7 [Total Pts: 2]'], OFFERINGS);
  eq('reports offerings with no column', m.unmatchedOfferings.length, 2);
  eq('and names them', m.unmatchedOfferings.map(o => o.lesson).sort(), [8, 9]);
}

{
  // Two columns both claiming lesson 8. Filling either is a guess the director cannot see.
  const m = matchColumns(['Student ID', 'Preflight 8', 'Preflight 8 makeup'], OFFERINGS);
  eq('fills only the first of a duplicate pair', Object.keys(m.matched).length, 1);
  const dup = m.columns.find(c => c.note);
  check('and flags the duplicate for the director', !!dup);
}


/* ── Filling ─────────────────────────────────────────────────────────────────── */
section('fillGrid');

{
  // A has lesson 7 and 8; nobody has lesson 9 yet (not taught).
  const grades = { [`${A}|off-07`]: 2, [`${A}|off-08`]: 1, [`${B}|off-07`]: 0 };
  const lookup = (id, off) => (grades[`${id}|${off}`] ?? null);
  const map = { 3: 'off-07', 4: 'off-08', 5: 'off-09' };

  const r = fillGrid(BB_GRID, 2, map, lookup);

  eq("writes A's lesson 7", r.grid[1][3], '2');
  eq("writes A's lesson 8", r.grid[1][4], '1');
  eq('LEAVES AN UNGRADED LESSON BLANK, NOT ZERO', r.grid[1][5], '');
  eq('and blank for the other cadet too', r.grid[2][5], '');

  // The rule that costs the most if it breaks: a real zero is a real score and must survive.
  eq('a genuine zero is written as 0', r.grid[2][3], '0');
  check('a genuine zero is not blanked', r.grid[2][3] !== '');

  eq('leaves the exam column untouched', r.grid[1][6], '88');
  eq('leaves the name columns untouched', r.grid[1][0], 'Testcadet');
  eq('leaves the header row untouched', r.grid[0][6], 'Exam 1 [Total Pts: 100] |8842900');

  // The "Points Possible" row has no cadet ID, so every cell of it must survive.
  eq('leaves a non-student row completely alone', r.grid[3], BB_GRID[3]);
  eq('and counts it as skipped', r.skippedRows, 1);

  eq('counts what it wrote', r.filled, 3);
  eq('and what it blanked', r.blanks, 3);
  eq('reports the IDs it saw', r.ids, [A, B]);
}

{
  // Nothing graded at all: the grid must come back byte-identical except that the matched
  // preflight cells are emptied. Nothing else may move.
  const r = fillGrid(BB_GRID, 2, { 3: 'off-07' }, () => null);
  eq('no grades → the exam column is unchanged', r.grid[1][6], '88');
  eq('no grades → the preflight cell is empty', r.grid[1][3], '');
  eq('no grades → nothing was written', r.filled, 0);
}

{
  // The input grid must not be mutated — the preview renders from it after the fill is computed.
  const before = JSON.stringify(BB_GRID);
  fillGrid(BB_GRID, 2, { 3: 'off-07' }, () => 2);
  eq('does not mutate the input grid', JSON.stringify(BB_GRID), before);
}


/* ── Serialising ─────────────────────────────────────────────────────────────── */
section('toCsv');

{
  const csv = toCsv([['a', 'b'], ['Testcadet, Alpha', '2']]);
  check('quotes every field', csv.startsWith('"a","b"'));
  check('keeps a comma inside a name', csv.includes('"Testcadet, Alpha"'));
  check('uses CRLF', csv.includes('\r\n'));
}

{
  const csv = toCsv([['say "hi"']]);
  eq('doubles an embedded quote', csv, '"say ""hi"""');
}


/* ── Reading a whole uploaded file ───────────────────────────────────────────── */
section('readFile');

{
  const text = toCsv(BB_GRID);
  const r = readFile(text, OFFERINGS);
  check('parses a Blackboard-shaped file', !r.error);
  eq('finds the ID column', r.idColumn.index, 2);
  eq('matches three preflight columns', Object.keys(r.matched).length, 3);
  eq('and reads both cadets', r.ids, [A, B]);
}

{
  const r = readFile('PK\x03\x04 binary junk', OFFERINGS);
  check('refuses an .xlsx by signature', !!r.error);
  check('and tells the user how to fix it', /Save As/.test(r.error));
}

{
  check('refuses an empty file', !!readFile('', OFFERINGS).error);
}


/* ── Checking a SET of files: one PREP course, several Blackboard courses ───── */
section('checkFiles');

/* The real shape, learned 2026-08-28: phys-215 is ONE PREP course whose sections live in THREE
 * Blackboard courses. The third belongs to another instructor and mixes M-day and T-day sections
 * in one shell — which is why coverage is computed per SECTION and never per day. */
const ROSTER = [
  { studentId: A, sectionCode: 'M1A' },
  { studentId: B, sectionCode: 'M1A' },
  { studentId: C, sectionCode: 'T1A' },
  { studentId: D, sectionCode: 'T1A' },
  { studentId: E, sectionCode: 'M1C' },   // the other instructor's course…
  { studentId: F, sectionCode: 'T5C' },   // …which mixes M and T
];

{
  const r = checkFiles([{ label: 'm.csv', ids: [A, B] }, { label: 't.csv', ids: [C, D] }], ROSTER);
  eq('two complete sections are covered', r.covered.map(s => s.sectionCode), ['M1A', 'T1A']);
  eq('nothing is partly covered', r.partial.length, 0);
  check('no duplicate files', !r.duplicateFiles.length);
  eq('counts the cadets it covers', r.coveredCadets, 4);
}

{
  // THE CASE THIS WAS REBUILT FOR. M1C and T5C belong to another instructor's Blackboard course.
  // They are NOT an error — but they must be reported, or nobody remembers they need a file.
  const r = checkFiles([{ label: 'm.csv', ids: [A, B] }, { label: 't.csv', ids: [C, D] }], ROSTER);
  eq('a section in no file is reported as uncovered', r.uncovered.map(s => s.sectionCode), ['M1C', 'T5C']);
  eq('and is NOT reported as a partial-coverage error', r.partial.length, 0);
  eq('with its headcount, so the gap can be sized', r.uncovered.map(s => s.enrolled), [1, 1]);
}

{
  // A section that IS in the upload but missing a cadet. This one IS an error: there is a column
  // waiting for them in a file that was uploaded, and their grade would silently not post.
  const r = checkFiles([{ label: 'm.csv', ids: [A] }, { label: 't.csv', ids: [C, D] }], ROSTER);
  eq('a partly-present section is an error', r.partial.map(p => p.sectionCode), ['M1A']);
  eq('and it names who is missing', r.partial[0].missing, [B]);
  check('and it is not also called uncovered', !r.uncovered.some(s => s.sectionCode === 'M1A'));
}

{
  const r = checkFiles([{ label: 'a.csv', ids: [A, B, C] }, { label: 'b.csv', ids: [C, D] }], ROSTER);
  eq('catches a cadet in two files', r.inMultiple.map(s => s.studentId), [C]);
  eq('and says which files', r.inMultiple[0].files, ['a.csv', 'b.csv']);
}

{
  const r = checkFiles([{ label: 'x.csv', ids: [A, B] }, { label: 'y.csv', ids: [A, B] }], ROSTER);
  eq('catches the same export uploaded twice', r.duplicateFiles, [['x.csv', 'y.csv']]);
}

{
  const r = checkFiles([{ label: 'm.csv', ids: [A, B, 3009999998] }], ROSTER);
  eq('reports an ID we do not hold', r.notOnRoster.map(x => x.studentId), [3009999998]);
}

{
  // A third file closes the gap, and the mixed-day course is handled like any other.
  const r = checkFiles([{ label: 'm.csv', ids: [A, B] }, { label: 't.csv', ids: [C, D] },
                        { label: 'other.csv', ids: [E, F] }], ROSTER);
  eq('three files cover everything', r.uncovered.length, 0);
  eq('including the mixed M/T course', r.covered.map(s => s.sectionCode), ['M1A', 'M1C', 'T1A', 'T5C']);
  eq('and every cadet', r.coveredCadets, 6);
}

{
  const r = checkFiles([], ROSTER);
  eq('no files → every section is uncovered', r.uncovered.length, 4);
  eq('and nothing is claimed as an error', r.partial.length + r.inMultiple.length, 0);
}


/* ── The real Blackboard export, 2026-08-28 ──────────────────────────────────
 * Everything below was learned from the actual Physics 215 files and would have shipped wrong
 * without them. These are regression pins, not hypotheticals.
 */
section('real Blackboard export (phys-215, 2026-08-28)');

// Its preflight columns are called "PF NN". Nothing said "Preflight".
eq('reads a real PF column', lessonNumberOf('PF 02 [Total Pts: 2 Score] |574260'), 2);
eq('and a two-digit one', lessonNumberOf('PF 41 [Total Pts: 2 Score] |574300'), 41);

// THE ONE THAT MATTERS. The same file carries a full set of homework columns with the SAME
// lesson numbers and the SAME [Total Pts: 2 Score] suffix. Matching one of these would overwrite
// a real homework grade on a live course.
eq('NEVER matches a homework column',
   lessonNumberOf("Lesson 8 Homework - Gauss's Law [Total Pts: 2 Score] |534283"), null);
eq('nor lesson 2 homework',
   lessonNumberOf('Lesson 2 Homework - Electric Charge, Coulombs [Total Pts: 2 Score] |534277'), null);
for (const h of ['MSE 1 - Algebra and Trig [Total Pts: 2 Score] |534276',
                 'Block 1 Comprehensive Problem Set [Total Pts: 7 Score] |534287',
                 'GR2 [Total Pts: 100 Score] |526958', 'EPQ3 [Total Pts: 15 Score] |526952',
                 'Lab4 [Total Pts: 20 Score] |526963', 'FinalExam [Total Pts: 300 Score] |526943',
                 'Total Points [Total Pts: up to 505 Score] |526940',
                 'Overall Grade [Total Pts: up to 100 USAFA Letter] |530834']) {
  eq(`ignores "${h.split(' [')[0]}"`, lessonNumberOf(h), null);
}

{
  // A miniature of the real file: BOM, bare LF, every field quoted, "2.00" scores, a homework
  // column sharing lesson 8, and PF 25 sitting before PF 24 (which the real export does).
  const hdr = '"Last Name","First Name","Username","Student ID",'
    + '"Lesson 8 Homework - Gauss\'s Law [Total Pts: 2 Score] |534283",'
    + '"PF 25 [Total Pts: 2 Score] |574283","PF 24 [Total Pts: 2 Score] |574282",'
    + '"PF 08 [Total Pts: 2 Score] |574266"';
  const text = '﻿' + [hdr,
    `"Testcadet","Alpha","c30a.alpha","${A}","2.00","","",""`,
    `"Testcadet","Bravo","c30b.bravo","${B}","0.00","","",""`,
  ].join('\n') + '\n';

  const offs = [{ id:'o24', lesson:24, title:'Lesson 24 Preflight' },
                { id:'o25', lesson:25, title:'Lesson 25 Preflight' },
                { id:'o08', lesson:8,  title:'Lesson 08 Preflight' }];
  const f = readFile(text, offs);

  eq('strips the BOM so the first header parses', f.grid[0][0], 'Last Name');
  eq('detects bare LF', f.format.eol, '\n');
  eq('detects the BOM', f.format.bom, true);
  eq('detects the trailing newline', f.format.trailingEol, true);
  eq('detects 2-decimal scores from the HOMEWORK column', f.format.decimals, 2);
  eq('finds the Student ID column', f.idColumn.index, 3);
  eq('matches three preflight columns', Object.keys(f.matched).length, 3);
  eq('does not match the homework column', f.matched[4], undefined);
  eq('maps PF 25 to lesson 25 despite the odd order', f.matched[5], 'o25');
  eq('maps PF 24 to lesson 24', f.matched[6], 'o24');

  const r = fillGrid(f.grid, f.idColumn.index, f.matched,
                     (id, o) => (id === A && o === 'o08' ? 2 : null), { decimals: f.format.decimals });
  eq('writes the score in the file\'s own 2-decimal style', r.grid[1][7], '2.00');
  eq('leaves the homework cell alone', r.grid[1][4], '2.00');
  eq('leaves the other homework cell alone', r.grid[2][4], '0.00');
  eq('blanks an ungraded preflight', r.grid[1][5], '');

  const out = toCsv(r.grid, f.delimiter, f.format);
  check('re-emits the BOM', out.charCodeAt(0) === 0xFEFF);
  check('does not introduce CRLF', !out.includes('\r\n'));
  check('keeps the trailing newline', out.endsWith('\n'));
  check('the homework column survives the round trip', out.includes('"2.00"'));
}
