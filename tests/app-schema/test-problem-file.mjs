// test-problem-file.mjs — the problem-file format and its reader (site/js/problem-file.js). Offline: no network, no database.
//
// WHAT THIS DEFENDS
//   * The example file is accepted, and every key in it is one the real answer checker accepts typed back.
//   * The rejection rule: formula text, a comma decimal, a thousands comma, unit text in a number cell, an empty key,
//     words, NaN, Infinity, hex, a fraction, a missing tolerance on an answer of 0 — each refused with row and column.
//   * A bad file shows EVERY bad row at once, and writes nothing (toWrite is empty).
//   * A hostile file (formulas in every column, a script tag, a zero byte, a huge file, semicolons, a workbook) is
//     refused or carried only as inert text.
//   * Origin: a file can mark who wrote the answers; without a mark the form must say; an AI mark reaches every key.
//   * The door to per-student numbers stays open: a `variant` column exists and must be empty today.
//   * Excel: a workbook's bytes are recognised and answered with the steps to save a CSV; no reader is claimed.
//
// WHAT THIS CANNOT PROVE
//   The page, the database write, or that unchecked AI keys cannot publish (scratch_problem_file_proof.py proves that).
//
// PF_MODULE (optional) points the suite at another copy of the module, so it can be shown to fail against a broken one.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { check, eq, section, summary } from './mini-assert.mjs';

const here = new URL('.', import.meta.url);
const target = process.env.PF_MODULE ? pathToFileURL(resolve(process.env.PF_MODULE)).href
  : new URL('../../site/js/problem-file.js', here).href;
const P = await import(target);
const NA = await import(new URL('../../site/js/numeric-answer.js', here).href);

const HEAD = P.COLUMNS.join(',');
const cols = P.COLUMNS;
/** One row from named fields; every other column empty. */
const rowOf = (f) => cols.map(c => f[c] ?? '').map(v => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',');
const file = (...rows) => [HEAD, ...rows.map(rowOf)].join('\n') + '\n';
const num = (extra = {}) => ({ type: 'number', question: 'A made-up question.', points: '1', answer: '9.8', tolerance_percent: '2', written_by: 'human', ...extra });
const read = (text, opts) => P.readProblemFile(text, opts);
const ascii = (t) => JSON.stringify(t).replace(/[^ -~]/g, (c) => 'U+' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const allProblems = (plan) => plan.rows.flatMap(r => r.problems);

section('the example file');
for (const origin of ['human', 'ai']) {
  const plan = read(P.exampleProblemFile(origin));
  check(`the ${origin} example is accepted`, plan.ok && plan.rows.length === 4, JSON.stringify(allProblems(plan)));
  eq(`the ${origin} example marks every key ${origin}`, plan.toWrite.map(w => w.key.written_by), Array(4).fill(origin));
}
{
  const plan = read(P.exampleProblemFile('human'));
  eq('the example reads its numbers exactly (value, tolerance, unit)', plan.toWrite[0].key,
    { variant_key: '', value: '3', tol_abs: null, tol_pct: '2', sig_figs: 2, sig_fig_mode: 'warn', unit: 'm/s^2', unit_aliases: ['m/s2', 'm s^-2'], unit_mode: 'warn', written_by: 'human' });
  eq('an answer of 0 keeps its absolute tolerance', [plan.toWrite[1].key.value, plan.toWrite[1].key.tol_abs], ['0', '0.01']);
  eq('choices get the letters a, b, c, d in order', plan.toWrite[2].columns.choices.map(c => c.id), ['a', 'b', 'c', 'd']);
  eq('the correct letters are kept', plan.toWrite[3].key.correct_choice_ids, ['a', 'b']);
  eq('positions count from the start position', plan.toWrite.map(w => w.columns.position), [1, 2, 3, 4]);
  eq('start position is respected', read(P.exampleProblemFile(), { startPosition: 7 }).toWrite.map(w => w.columns.position), [8, 9, 10, 11]);
  // every number key is accepted by the real checker when its own value is typed back
  let allBack = true;
  for (const w of plan.toWrite.filter(x => x.key.value !== undefined)) {
    const back = NA.parseAnswer(w.key.value);
    allBack = allBack && back.ok && NA.checkNumeric(back, { ...w.key, unit_mode: 'ignore', sig_fig_mode: 'ignore' }).correct;
  }
  check('each number key typed back is accepted by the answer checker', allBack);
}

section('what is accepted as a plain number');
for (const [text, want] of [['9.8', '9.8'], ['-3', '-3'], ['+3', '3'], ['1e3', '1000'], ['1.0E3', '1000'], ['.5', '0.5'], ['5.', '5'], ['0', '0'],
  ['1.5e-3', '0.0015'], ['2.50', '2.5'], ['  7  ', '7'], ['-0.001', '-0.001']]) {
  const plan = read(file(num({ answer: text, tolerance_absolute: '0.5', tolerance_percent: '' })));
  eq(`"${text}" is accepted as ${want}`, plan.ok ? plan.toWrite[0].key.value : allProblems(plan), want);
}

section('the rejection rule: each refusal names the row and the column');
const refused = (label, fields, column, mustSay) => {
  const plan = read(file(num(fields)));
  const text = allProblems(plan).join(' ');
  check(`${label}: refused`, !plan.ok && plan.toWrite.length === 0, JSON.stringify(allProblems(plan)));
  check(`${label}: names row 2 and column "${column}"`, text.includes('Row 2') && text.includes(`column "${column}"`), text);
  if (mustSay) check(`${label}: says ${mustSay}`, text.toLowerCase().includes(mustSay), text);
};
refused('a comma decimal 1,5', { answer: '1,5' }, 'answer', 'comma');
refused('a thousands comma 1,000', { answer: '1,000' }, 'answer', 'comma');
refused('unit text in the answer', { answer: '9.8 m/s' }, 'answer', 'unit');
refused('unit text glued on', { answer: '9.8m' }, 'answer', 'unit');
refused('a word', { answer: 'about ten' }, 'answer', 'plain number');
refused('NaN', { answer: 'NaN' }, 'answer');
refused('Infinity', { answer: 'Infinity' }, 'answer');
refused('hex', { answer: '0x1F' }, 'answer');
refused('a fraction', { answer: '1/2' }, 'answer');
refused('a Unicode minus', { answer: '−3' }, 'answer');
refused('two numbers', { answer: '3 4' }, 'answer');
refused('an empty answer', { answer: '' }, 'answer', 'empty');
refused('a spaces-only answer', { answer: '   ' }, 'answer', 'empty');
refused('a formula answer =1+2', { answer: '=1+2' }, 'answer', 'formula');
refused('a formula answer +SUM(A1)', { answer: '+SUM(A1)' }, 'answer', 'formula');
refused('a formula answer -cmd', { answer: '-cmd' }, 'answer', 'formula');
refused('an @ answer', { answer: '@A1' }, 'answer', 'formula');
refused('a comma in the tolerance', { tolerance_percent: '2,5' }, 'tolerance_percent', 'comma');
refused('a unit in the tolerance', { tolerance_absolute: '0.1 m' }, 'tolerance_absolute', 'unit');
refused('a negative tolerance', { tolerance_percent: '-2' }, 'tolerance_percent', 'negative');
refused('a tolerance over 100 percent', { tolerance_percent: '150' }, 'tolerance_percent', '100');
refused('an answer of 0 with no absolute tolerance', { answer: '0', tolerance_percent: '2' }, 'tolerance_absolute', 'required');
refused('an exponent too large to store written out', { answer: '1e300', tolerance_percent: '1' }, 'answer', 'too large');
refused('an answer of 1e100 names the number, not the typed-back form', { answer: '1e100' }, 'answer', 'more than 40 digits');
refused('a tiny tolerance written out in full', { answer: '5', tolerance_absolute: '1e-60' }, 'tolerance_absolute', 'too large or too small');
refused('more than 40 digits', { answer: '1.' + '1'.repeat(41) }, 'answer', '40');
refused('points with three decimals', { points: '1.234' }, 'points', 'two decimals');
refused('points with a comma', { points: '1,5' }, 'points');
refused('empty points', { points: '' }, 'points');
refused('negative points', { points: '-1' }, 'points');
refused('an unknown type', { type: 'essay' }, 'type');
refused('an empty question', { question: '' }, 'question');
refused('a question that is a formula', { question: '=HYPERLINK("http://x")' }, 'question', 'formula');
refused('a mode that does not exist', { unit_rule: 'maybe' }, 'unit_rule');
refused('require with no unit', { unit_rule: 'require' }, 'unit_rule', 'unit');
refused('a unit that starts with a digit when it is required', { unit: '1/s', unit_rule: 'require' }, 'answer', 'checker');
refused('sig figs that are not whole', { sig_figs: '2.5' }, 'sig_figs');
refused('a sig-fig rule with no count', { sig_fig_rule: 'require' }, 'sig_fig_rule', 'sig_figs');
refused('a bad id', { question_id: 'has space' }, 'question_id');
refused('choices on a number question', { choices: 'a|b' }, 'choices');
refused('a bad origin word', { written_by: 'robot' }, 'written_by');

section('choice questions');
const choice = (extra = {}) => ({ type: 'choice', question: 'Pick one.', points: '1', choices: 'Red|Green|Blue', correct: 'b', written_by: 'human', ...extra });
check('a choice row is accepted', read(file(choice())).ok);
for (const [label, f, column, say] of [
  ['an empty correct', { correct: '' }, 'correct', 'empty'],
  ['a letter that is not a choice', { correct: 'd' }, 'correct', 'letter'],
  ['two correct on a choice', { correct: 'a|b' }, 'correct', 'one correct'],
  ['one choice only', { choices: 'Red' }, 'choices', 'two'],
  ['two identical choices', { choices: 'Red|red|Blue' }, 'choices', 'same'],
  ['a number key on a choice row', { answer: '4' }, 'answer', 'choice'],
  ['a formula choice', { choices: '=1+1|Green' }, 'choices', 'formula'],
]) refused(label, choice(label === 'x' ? {} : f), column, say);
check('a select row with two correct is accepted', read(file(choice({ type: 'select', correct: 'a|c' }))).ok);
refused('a select where every choice is correct', choice({ type: 'select', correct: 'a|b|c' }), 'correct');

section('a bad file shows every bad row at once, and writes nothing');
{
  const text = file(num({ answer: '1,5' }), num({ answer: '4' }), num({ answer: '=2+2' }), num({ answer: '3 m' }), choice({ correct: '' }));
  const plan = read(text);
  eq('five rows are read', plan.rows.length, 5);
  eq('the good row is marked good, the other four bad', plan.rows.map(r => r.ok), [false, true, false, false, false]);
  check('every bad row has its own problems listed', plan.rows.filter(r => !r.ok).every(r => r.problems.length >= 1));
  check('the problems name rows 2, 4, 5 and 6', ['Row 2', 'Row 4', 'Row 5', 'Row 6'].every(t => allProblems(plan).join(' ').includes(t)));
  eq('nothing is queued to be written', plan.toWrite, []);
  check('the file as a whole is not ok', plan.ok === false);
}
{
  const plan = read(file(num({ answer: '' , tolerance_absolute: 'x' }), num({ question: '' })));
  check('several problems in one row are all listed', plan.rows[0].problems.length >= 2, JSON.stringify(plan.rows[0].problems));
}

section('text after a closing quote is refused, not merged into the cell');
{
  const r = P.readCsv('a,b\n"abc"def,x\n');
  check('"abc"def is an error', !!r.error && /closing quote/.test(r.error), JSON.stringify(r.error));
  check('"abc",def is fine', P.readCsv('a,b\n"abc",def\n').error === null);
  check('a doubled quote inside quotes is fine', P.readCsv('a,b\n"a""b",x\n').rows[1][0] === 'a"b');
}

section('a hostile file');
{
  const cells = Object.fromEntries(cols.map(c => [c, '=cmd|\' /C calc\'!A0']));
  const plan = read(file(cells));
  check('formula text in every column is refused', !plan.ok && plan.toWrite.length === 0);
  check('it is refused once per cell, with the column named', allProblems(plan).filter(p => p.includes('formula')).length >= cols.length - 1, String(allProblems(plan).length));
}
for (const bad of ['\t=1+1', '\r=1+1', '+cmd', '-cmd', '-(1+1)', '@SUM(1)', '=1', '＝1+1', "+1+cmd|' /C calc'!A0", '-1+2', '+5 m/s is the speed', '-2-3']) {
  check(`"${ascii(bad)}" reads as formula text`, P.looksLikeFormula(bad) === true);
}
for (const fine of ['-5', '+5', '-.5', '-1e3', '-1,000', '- 5', '5 m', 'Which force?', '-', 'a=b', '3 = 3']) {
  check(`"${fine}" does not read as formula text`, P.looksLikeFormula(fine) === false);
}
{
  const plan = read(file(num({ question: '<script>alert(1)</script> Find the speed.' })));
  check('markup in a question is carried as inert text (the page escapes it), not refused or run', plan.ok && plan.toWrite[0].columns.prompt_md.startsWith('<script>'));
}
check('a file with a replacement character is refused', read(file(num({ question: 'bad � char' }))).fileErrors.length === 1);
check('a file with a zero byte is refused', read(file(num({ question: 'a\u0000b' }))).fileErrors.length === 1);
check('a file over the size limit is refused', read('x'.repeat(P.MAX_CHARS + 1)).fileErrors.length === 1);
check('a file of many rows is refused', read(file(...Array.from({ length: P.MAX_ROWS + 1 }, () => num()))).fileErrors.length === 1);
check('an empty file is refused', read('').fileErrors.length === 1 && read('   \n  ').fileErrors.length === 1);
check('a header and no rows is refused', read(HEAD + '\n').fileErrors.length === 1);
check('an unclosed quote is refused', read(HEAD + '\n"never closes,1').fileErrors[0].includes('never closes'));
{
  const semi = read(HEAD.replace(/,/g, ';') + '\n' + 'x;number;Q;1;;;9,8\n');
  check('a semicolon-separated file is refused with a plain reason', semi.fileErrors.length === 1 && semi.fileErrors[0].includes('semicolons'));
}
check('an unknown column is refused', read(HEAD + ',extra\n').fileErrors.some(e => e.includes('Unknown column')) || read(HEAD + ',extra\n' + rowOf(num()) + ',x\n').fileErrors.some(e => e.includes('Unknown column')));
check('a missing required column is refused', read('type,question\nnumber,Q\n').fileErrors.some(e => e.includes('"points"')));
check('a repeated column is refused', read(HEAD + ',answer\n' + rowOf(num()) + ',3\n').fileErrors.some(e => e.includes('twice')));
check('a formula in the header is refused', read(HEAD + ',=1+1\n').fileErrors.length >= 1);
check('too many cells in a row is refused (a comma inside a cell)', !read(HEAD + '\n' + rowOf(num()) + ',stray\n').ok);
check('a header name is read leniently (Capitals, spaces)', read(HEAD.replace('sig_figs', 'Sig Figs').replace('written_by', 'Written By') + '\n' + rowOf(num()) + '\n').ok);
check('a byte-order mark is skipped', read('﻿' + file(num())).ok);
check('Windows line endings are read', read(file(num(), num({ answer: '5' })).replace(/\n/g, '\r\n')).rows.length === 2);
check('a tab-separated paste is read', read(file(num()).split('\n').map(l => l.replace(/,/g, '\t')).join('\n').replace(/\t(?=[^\t]*\t)/g, '\t')).fileErrors.length <= 2);

section('quoted cells and line numbers');
{
  const q = 'Line one,\nline two, "quoted"';
  const plan = read(file(num({ question: q }), num({ answer: '1,5' })));
  eq('a question with commas, quotes and a line break survives', plan.rows[0].question, q);
  check('a bad row after a multi-line cell is named by its line in the file', allProblems(plan).join(' ').includes('Row 4'), allProblems(plan).join(' '));
}

section('ids');
{
  const plan = read(file(num(), num({ question_id: 'q1' }), num()));
  eq('a blank id takes the next free q-number, never one typed elsewhere in the file', plan.toWrite.map(w => w.columns.qid), ['q2', 'q1', 'q3']);
  check('an id used on the item already is refused', !read(file(num({ question_id: 'hw1' })), { existingQids: ['hw1'] }).ok);
  check('the same id twice in a file is refused', !read(file(num({ question_id: 'a' }), num({ question_id: 'a' }))).ok);
  check('existing ids are skipped when numbering', read(file(num()), { existingQids: ['q1', 'q2'] }).toWrite[0].columns.qid === 'q3');
}

section('who wrote the answers');
{
  const noCol = (rest) => [HEAD.replace(',written_by', ''), rest].join('\n') + '\n';
  const body = rowOf(num()).split(',').slice(0, -1).join(',');
  const plain = noCol(body);
  const a = read(plain);
  check('no written_by column and no answer from the form: refused, asking', !a.ok && a.fileErrors[0].includes('written_by') && a.hasOriginColumn === false);
  const h = read(plain, { askedOrigin: 'human' });
  check('the form says human: accepted, keys marked human', h.ok && h.toWrite[0].key.written_by === 'human' && h.aiCount === 0, JSON.stringify(h.fileErrors));
  const ai = read(plain, { askedOrigin: 'ai' });
  check('the form says ai: accepted, keys marked ai', ai.ok && ai.toWrite[0].key.written_by === 'ai' && ai.aiCount === 1);
  check('a value other than human or ai from the form is not trusted', !read(plain, { askedOrigin: 'robot' }).ok);
  const mixed = read(file(num({ written_by: 'human' }), num({ written_by: 'ai' })), { askedOrigin: 'human' });
  eq('the column wins over the form, row by row', mixed.toWrite.map(w => w.key.written_by), ['human', 'ai']);
  eq('a file with any ai row is an ai file', mixed.origin, 'ai');
  check('an empty written_by cell is refused when the column exists', !read(file(num({ written_by: '' }))).ok);
  check('"AI" in capitals is read as ai', read(file(num({ written_by: 'AI' }))).toWrite[0].key.written_by === 'ai');
}

section('different numbers per student are later, and the door stays open');
{
  check('the format has a variant column', P.COLUMNS.includes('variant'));
  const plan = read(file(num({ variant: 'v2' })));
  check('a value in variant is refused today, with a plain reason', !plan.ok && allProblems(plan).join(' ').includes('not available yet'));
  check('an empty variant is accepted and the key gets variant_key empty', read(file(num())).toWrite[0].key.variant_key === '');
  check('a file without the variant column is also accepted', read([HEAD.replace(',variant', ''), rowOf(num()).split(',').filter((_, i) => cols[i] !== 'variant').join(',')].join('\n') + '\n').ok);
}

section('the accepted range, in exact arithmetic');
for (const [key, low, high] of [
  [{ value: '9.8', tol_pct: '2' }, '9.604', '9.996'],
  [{ value: '9.8', tol_abs: '0.1' }, '9.7', '9.9'],
  [{ value: '9.8', tol_abs: '0.1', tol_pct: '2' }, '9.604', '9.996'],
  [{ value: '0', tol_abs: '0.01' }, '-0.01', '0.01'],
  [{ value: '-50', tol_pct: '10' }, '-55', '-45'],
  [{ value: '1000', tol_pct: '0.1' }, '999', '1001'],
  [{ value: '1e3', tol_pct: '5' }, '950', '1050'],
  [{ value: '0.1', tol_abs: '0.2' }, '-0.1', '0.3'],
]) {
  const r = P.acceptedRange(key);
  eq(`${JSON.stringify(key)} accepts ${low} to ${high}`, [r.low, r.high], [low, high]);
  // the edges are right and just outside is wrong, by the real checker
  const edge = (t) => { const p = NA.parseAnswer(t); return p.ok && NA.checkNumeric(p, { value: key.value, tol_abs: key.tol_abs ?? null, tol_pct: key.tol_pct ?? null }).correct; };
  check(`  the checker agrees on both edges of ${JSON.stringify(key)}`, edge(low) && edge(high));
}
eq('no tolerance reads as exactly', P.acceptedRange({ value: '4' }).text, 'exactly 4, no tolerance');
check('an unreadable value says so', P.acceptedRange({ value: 'abc' }).text.includes('cannot be read'));
{
  const plan = read(file(num({ tolerance_percent: '' })));
  check('a number key with no tolerance is accepted but warned about', plan.ok && plan.warnings.length === 1, JSON.stringify(plan.warnings));
}

section('Excel');
{
  const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
  const r = P.decodeProblemFile(zip);
  check('an .xlsx (a zip) is recognised and answered with the steps to save a CSV', r.error && r.error.includes('CSV UTF-8') && r.text === '');
  check('an old .xls is recognised', P.decodeProblemFile(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])).error.includes('CSV UTF-8'));
  check('text that starts with PK is also refused by the reader', read('PK\u0003\u0004 x').fileErrors[0].includes('CSV UTF-8'));
  check('a file that is not UTF-8 is refused with the steps', P.decodeProblemFile(new Uint8Array([0x62, 0xB0, 0x63])).error.includes('UTF-8'));
  const ok = P.decodeProblemFile(new TextEncoder().encode(file(num({ unit: '°C' }))));
  check('UTF-8 text decodes and reads (a degree sign is kept)', !ok.error && read(ok.text).toWrite[0].key.unit === '°C');
}

section('the instructions for an instructors own AI model');
{
  const t = P.aiInstructions();
  check('they list every column', cols.every(c => t.includes(c)));
  check('they tell the model to write ai in written_by', /written_by: write ai/.test(t));
  check('they say a person checks every answer', /person will check every answer/.test(t));
  check('they carry a worked example that the reader accepts', t.includes(P.exampleProblemFile('ai').split('\n')[1]));
  check('the example inside them is a whole accepted file', read(P.exampleProblemFile('ai')).ok);
  check('they ask for variant to be left empty', /variant: leave EMPTY/.test(t));
  check('they name the main refusals (comma, unit, formula, empty key)', ['1,5', '=', 'empty'].every(w => t.includes(w)));
}

section('what the page writes: the origin reaches every key, and a persons check is the only thing that clears it');
{
  const loc = { pathname: '/site/faculty/questions.html', search: '', hash: '', href: 'http://localhost/site/faculty/questions.html' };
  globalThis.location ??= loc;
  globalThis.window ??= { location: loc };
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const Q = await import(new URL('../../site/js/faculty-questions.js', here).href);

  let calls = [];
  let reply = {};
  const builder = (table) => {
    const st = { table, verb: 'select', payload: null, f: {} };
    const c = {};
    for (const m of ['eq', 'in', 'is', 'not', 'order']) c[m] = (col, v) => { st.f[`${m}:${col}`] = v; return c; };
    c.select = () => { if (st.verb === 'select') calls.push({ table, verb: 'select', f: st.f }); return c; };
    for (const v of ['insert', 'update', 'delete']) c[v] = (payload) => { st.verb = v; st.payload = payload; calls.push({ table, verb: v, payload, f: st.f }); return c; };
    c.then = (res, rej) => {
      const r = reply[`${table}.${st.verb}`];
      const out = typeof r === 'function' ? r(st) : r;
      return Promise.resolve(out ?? { data: [], error: null }).then(res, rej);
    };
    return c;
  };
  const db = { from: builder };

  // writing: the AI mark is carried into the key row
  const plan = read(P.exampleProblemFile('ai'));
  calls = []; reply = {
    'questions.insert': { data: plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid })), error: null },
  };
  const res = await Q.writeImport(db, 'act-1', plan);
  const keyInsert = calls.find(c => c.table === 'question_keys' && c.verb === 'insert');
  check('the plan is written', res.count === 4, JSON.stringify(res));
  check('every key row sent says written_by ai', keyInsert && keyInsert.payload.length === 4 && keyInsert.payload.every(k => k.written_by === 'ai'));
  check('no key row names a checker or a check time', keyInsert.payload.every(k => !('checked_by' in k) && !('checked_at' in k) && !('created_by' in k)));
  check('every key row is for variant "" (the same numbers for everyone)', keyInsert.payload.every(k => k.variant_key === ''));
  check('a refused file writes nothing', (await Q.writeImport(db, 'act-1', read(file(num({ answer: '1,5' }))))).error !== undefined);

  // finding what still needs a person
  const keyRow = (over) => ({ id: 'k1', written_by: 'ai', checked_by: null, checked_at: null, superseded_at: null, ...over });
  const q = (over = {}) => ({ id: 'q1', isRetired: false, keyRow: keyRow(), ...over });
  check('an AI key nobody checked needs checking', Q.isAiUnchecked(q()) === true);
  check('an AI key a person checked does not', Q.isAiUnchecked(q({ keyRow: keyRow({ checked_by: 'u1', checked_at: 'now' }) })) === false);
  check('a human key does not', Q.isAiUnchecked(q({ keyRow: keyRow({ written_by: 'human' }) })) === false);
  check('a retired question does not', Q.isAiUnchecked(q({ isRetired: true })) === false);
  check('a question with no key does not', Q.isAiUnchecked(q({ keyRow: null })) === false);
  eq('the list keeps only those that need it', Q.uncheckedAiQuestions([q({ id: 'a' }), q({ id: 'b', keyRow: keyRow({ written_by: 'human' }) })]).map(x => x.id), ['a']);

  // checking: only checked_at is sent, only for current unchecked keys
  calls = []; reply = { 'question_keys.update': { data: [{ id: 'k1' }, { id: 'k2' }], error: null } };
  const ok = await Q.markKeysChecked(db, ['k1', 'k2', 'k1']);
  const upd = calls.find(c => c.verb === 'update');
  eq('two keys checked, none missed', [ok.checked, ok.missed], [2, 0]);
  eq('only checked_at is sent (the database fills in who)', Object.keys(upd.payload), ['checked_at']);
  eq('it names each key once', upd.f['in:id'], ['k1', 'k2']);
  check('it only touches current keys nobody has checked', upd.f['is:superseded_at'] === null && upd.f['is:checked_by'] === null);
  calls = []; reply = { 'question_keys.update': { data: [{ id: 'k1' }], error: null } };
  const part = await Q.markKeysChecked(db, ['k1', 'k2']);
  eq('a key replaced meanwhile is reported as missed, not as checked', [part.checked, part.missed], [1, 1]);
  reply = { 'question_keys.update': { data: null, error: { message: 'nope' } } };
  check('a refusal is returned as an error', (await Q.markKeysChecked(db, ['k1'])).error?.message === 'nope');
  calls = []; check('no ids, no call', (await Q.markKeysChecked(db, [])).checked === 0 && calls.length === 0);
}

process.exit(summary() ? 0 : 1);
