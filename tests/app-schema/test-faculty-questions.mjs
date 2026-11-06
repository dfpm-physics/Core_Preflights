// test-faculty-questions.mjs — question and key entry (site/js/faculty-questions.js).
//
// WHAT THIS DEFENDS
//   * The CSV parser and the import plan are pure: every refusal is a sentence naming the row, and ONE bad
//     row refuses the WHOLE file before anything is written.
//   * A correct value of 0 survives as 0 (not null, not dropped), and refuses without an absolute tolerance.
//   * A third decimal in points is refused, not rounded.
//   * Prose is never offered on an auto_checked item and never carries a machine field.
//   * The page never sends checked_by, checked_at, created_by or a student-visible key.
//   * A key edit makes a NEW VERSION (supersede, then insert version + 1); an unchanged key makes none.
//   * The student preview carries no key.
//   * The example file under docs/ is the one the import page offers, and it passes its own import.
//
// WHAT THIS CANNOT PROVE
//   Offline, against a recording stub. It shows which statements the shipped module issues, not that the
//   database accepts them. tests/browser-harness/v2-questions-entry.mjs does that on staging.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/questions.html' });

let RESPONSES = {};
let CALLS = [];
let SEQ = 0;

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'range'])
    c[m] = (col, val) => { state.filters[`${m}:${col}`] = val; return c; };
  c.select = (cols) => { state.cols = cols; if (state.verb !== 'select') return c; CALLS.push({ table, verb: 'select', cols, filters: state.filters }); return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => { state.verb = verb; state.payload = payload; CALLS.push({ table, verb, payload, filters: state.filters }); return c; };
  const result = (mode) => {
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    if (data === undefined) {
      if (state.verb === 'insert' && mode === 'single') return { data: { id: `${table}-${++SEQ}` }, error: null };
      return { data: mode === 'many' ? [] : null, error: null };
    }
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};
const db = {
  from: stubFrom,
  rpc: (name, args) => { CALLS.push({ table: `rpc:${name}`, verb: 'rpc', payload: args });
    const r = RESPONSES[`rpc:${name}`]; const data = typeof r === 'function' ? r(args) : r;
    if (data && data.__error) return Promise.resolve({ data: null, error: data.__error });
    return Promise.resolve({ data: data === undefined ? [] : data, error: null }); },
};
const rpcs = (name) => CALLS.filter(c => c.table === `rpc:${name}`);

const Q = await import('../../site/js/faculty-questions.js');
const reset = (r = {}) => { RESPONSES = r; CALLS = []; SEQ = 0; };
const writes = (table, verb) => CALLS.filter(c => c.table === table && c.verb !== 'select' && (!verb || c.verb === verb));
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

const mc = (over = {}) => ({ ...Q.emptyQuestion('multiple_choice'), qid: 'q1', prompt: 'Which?', points: '1',
  choices: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }], key: { ...Q.emptyQuestion().key, correct: ['b'] }, ...over });
const numeric = (key = {}, over = {}) => ({ ...Q.emptyQuestion('numeric'), qid: 'n1', prompt: 'How much?', points: '2',
  key: { ...Q.emptyQuestion('numeric').key, value: '9.8', ...key }, ...over });
const symbolic = (key = {}, over = {}) => ({ ...Q.emptyQuestion('symbolic'), qid: 's1', prompt: 'Energy?', points: '2', variables: 'm, v',
  key: { ...Q.emptyQuestion('symbolic').key, expression: 'm*v^2/2', variables: 'm, v', ...key }, ...over });
const prose = (over = {}) => ({ ...Q.emptyQuestion('prose'), qid: 'p1', prompt: 'Explain.', points: '3', ...over });
const problems = (q, o = {}) => Q.checkQuestion(q, { grading: 'auto_checked', ...o });

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the spec: formats, the zero rule, the prose rule (read from migration 030)');
{
  const sql = read('supabase/migrations/app/030_questions_and_keys.sql');
  const m = sql.match(/questions_format_ck CHECK \(format IN \(([^)]*)\)\)/);
  // 085 widens the format check (symbolic answers); the formats the database accepts are the last definition.
  const m85 = read('supabase/migrations/app/085_symbolic_answers.sql').match(/ADD CONSTRAINT questions_format_ck\s+CHECK \(format IN \(([^)]*)\)\)/);
  const formats = [...(m85 || m)[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  eq('the page offers exactly the formats the database accepts', [...Q.FORMATS].sort(), formats.sort());
  check('the database requires an absolute tolerance for a value of 0', /question_keys_zero_needs_abs CHECK \(value IS NULL OR value <> 0 OR tol_abs IS NOT NULL\)/.test(sql));
  check('points are numeric(6,2), so a third decimal is a real problem', /points\s+numeric\(6,2\)/.test(sql));
  eq('MAX_POINTS fits numeric(6,2)', Q.MAX_POINTS, 9999.99);
  check('the database sets the key stamps (the page need not and does not)', /question_keys_stamp/.test(sql));
  eq('an auto_checked item is not offered prose', Q.formatsFor('auto_checked'), ['multiple_choice', 'multiple_select', 'numeric', 'symbolic']);
  eq('a human graded item is offered all five', Q.formatsFor('human_graded'), Q.FORMATS);
}

section('numbers and ids');
{
  eq('blank is null', Q.parseNumber('  '), null);
  eq('0 is a number, not blank', Q.parseNumber('0'), 0);
  eq('0.0 is 0', Q.parseNumber('0.0'), 0);
  eq('scientific notation', Q.parseNumber('1e3'), 1000);
  eq('negative', Q.parseNumber('-4.5'), -4.5);
  check('a thousands comma is refused, not guessed', Number.isNaN(Q.parseNumber('1,000')));
  check('a number with a unit is refused', Number.isNaN(Q.parseNumber('5 m')));
  check('"abc" is refused', Number.isNaN(Q.parseNumber('abc')));
  check('NaN and Infinity words are refused', Number.isNaN(Q.parseNumber('Infinity')) && Number.isNaN(Q.parseNumber('NaN')));
  check('2 and 1.5 and 0.25 have two decimals at most', [2, 1.5, 0.25, 1.25].every(Q.hasTwoDecimalsAtMost));
  check('1.255 and 0.001 have a third decimal', !Q.hasTwoDecimalsAtMost(1.255) && !Q.hasTwoDecimalsAtMost(0.001));
  eq('choice ids run a, b, c', [0, 1, 2].map(Q.choiceIdFor), ['a', 'b', 'c']);
  eq('a removed choice id is not reused', Q.nextChoiceId([{ id: 'a' }, { id: 'c' }]), 'b');
  eq('the next qid skips a retired one', Q.nextQid([{ qid: 'q1' }, { qid: 'q2' }]), 'q3');
  eq('the next qid skips one already taken further up', Q.nextQid([{ qid: 'q2' }]), 'q3');
  eq('the next qid honours ids reserved in the same file', Q.nextQid([], ['q1']), 'q2');
}

section('checking one question');
{
  eq('a good multiple choice passes', problems(mc()), []);
  eq('a good multiple select passes', problems(mc({ format: 'multiple_select', key: { ...mc().key, correct: ['a', 'b'] } })), []);
  eq('a good numeric passes', problems(numeric()), []);
  eq('prose passes on a human graded item', Q.checkQuestion(prose(), { grading: 'human_graded' }), []);
  check('prose is refused on an auto_checked item, in words', problems(prose()).some(p => /prose question cannot be on an auto-checked assignment/.test(p)));
  check('prose with a machine field is refused', Q.checkQuestion(prose({ key: { ...prose().key, value: '4' } }), { grading: 'human_graded' }).some(p => /never a machine field/.test(p)));
  check('prose with a sig fig rule is refused', Q.checkQuestion(prose({ key: { ...prose().key, sigFigMode: 'warn' } }), { grading: 'human_graded' }).length > 0);
  check('a multiple choice with two correct is refused', problems(mc({ key: { ...mc().key, correct: ['a', 'b'] } })).some(p => /exactly one correct/.test(p)));
  check('a multiple choice with no correct is refused', problems(mc({ key: { ...mc().key, correct: [] } })).some(p => /mark which/.test(p)));
  check('a correct choice that does not exist is refused', problems(mc({ key: { ...mc().key, correct: ['z'] } })).some(p => /not one of the choices/.test(p)));
  check('one choice only is refused', problems(mc({ choices: [{ id: 'a', text: 'One' }], key: { ...mc().key, correct: ['a'] } })).some(p => /at least two/.test(p)));
  check('an empty choice is refused', problems(mc({ choices: [{ id: 'a', text: 'One' }, { id: 'b', text: ' ' }] })).some(p => /choice 2 is empty/.test(p)));
  check('two choices that read the same are refused', problems(mc({ choices: [{ id: 'a', text: 'Same' }, { id: 'b', text: 'same' }] })).some(p => /read the same/.test(p)));
  check('a blank question is refused', problems(mc({ prompt: '  ' })).some(p => /write the question/.test(p)));
  check('a bad qid is refused', problems(mc({ qid: 'has space' })).some(p => /letters, numbers/.test(p)));
  check('a reused qid is refused for a new question', problems(mc(), { takenQids: ['q1'] }).some(p => /never reused/.test(p)));
  eq('...but not when editing that question', problems(mc(), { takenQids: ['q1'], isNew: false }), []);
  check('a negative points value is refused', problems(mc({ points: '-1' })).some(p => /negative/.test(p)));
  check('points above the column are refused', problems(mc({ points: '10000' })).some(p => /more than 9999.99/.test(p)));
  check('missing points are refused', problems(mc({ points: '' })).some(p => /enter the points/.test(p)));
  eq('0 points is allowed', problems(mc({ points: '0' })), []);
  const third = problems(mc({ points: '1.255' }));
  check('a third decimal is refused, naming the number', third.some(p => /two decimal places at most.*1\.255/.test(p)), third.join('|'));
  check('a numeric with no value is refused', problems(numeric({ value: '' })).some(p => /enter the correct value/.test(p)));
  check('a value of 0 is accepted only with an absolute tolerance', problems(numeric({ value: '0' })).some(p => /needs an absolute tolerance/.test(p)));
  eq('a value of 0 with tolerance 0 passes (exactly zero)', problems(numeric({ value: '0', tolAbs: '0' })), []);
  eq('a value of 0 with tolerance 0.01 passes', problems(numeric({ value: '0.0', tolAbs: '0.01' })), []);
  check('a percent tolerance over 100 is refused', problems(numeric({ value: '9.8', tolPct: '500' })).some(p => /percent tolerance.*100/.test(p)));
  check('a percent tolerance of exactly 100 is allowed', !problems(numeric({ value: '9.8', tolPct: '100' })).some(p => /percent tolerance/.test(p)));
  check('a percent tolerance alone does not save a zero', problems(numeric({ value: '0', tolPct: '5' })).some(p => /needs an absolute tolerance/.test(p)));
  check('a negative tolerance is refused', problems(numeric({ tolAbs: '-1' })).some(p => /cannot be negative/.test(p)));
  check('a sig fig rule without a count is refused', problems(numeric({ sigFigMode: 'require' })).some(p => /say how many/.test(p)));
  check('a fractional sig fig count is refused', problems(numeric({ sigFigs: '2.5' })).some(p => /whole number/.test(p)));
  check('a unit rule without a unit is refused', problems(numeric({ unitMode: 'require' })).some(p => /name the unit/.test(p)));
  check('unit aliases without a unit are refused', problems(numeric({ unitAliases: ['m/s'] })).some(p => /aliases need a unit/.test(p)));
  check('a value typed as "1,000" is refused', problems(numeric({ value: '1,000' })).some(p => /plain number/.test(p)));
  check('numeric fields on a choice question are refused', problems(mc({ key: { ...mc().key, value: '3' } })).some(p => /cannot carry numeric fields/.test(p)));
  check('choices on a numeric question are refused', problems(numeric({}, { choices: [{ id: 'a', text: 'x' }] })).some(p => /only choice questions have choices/.test(p)));
  check('an unknown format is refused', problems(mc({ format: 'essay' })).some(p => /format must be/.test(p)));
}

section('rows the database stores');
{
  const k0 = Q.keyColumns(numeric({ value: '0', tolAbs: '0' }));
  eq('a correct value of 0 is stored as 0, not dropped', k0.value, 0);
  check('...and its tolerance of 0 is stored as 0', k0.tol_abs === 0);
  eq('a numeric key carries the modes', [k0.sig_fig_mode, k0.unit_mode], ['ignore', 'ignore']);
  eq('empty aliases become null', k0.unit_aliases, null);
  const kn = Q.keyColumns(numeric({ unit: 'm/s', unitAliases: ['m/s2', ' m s^-2 '], unitMode: 'warn', sigFigs: '3', sigFigMode: 'require', tolPct: '2' }));
  eq('aliases are trimmed and kept', kn.unit_aliases, ['m/s2', 'm s^-2']);
  eq('sig figs and percent tolerance are numbers', [kn.sig_figs, kn.tol_pct], [3, 2]);
  const kc = Q.keyColumns(mc());
  eq('a choice key holds the correct ids and the all-or-nothing rule', kc, { correct_choice_ids: ['b'], select_rule: 'all_or_nothing' });
  eq('a prose question with no note has no key', Q.keyColumns(prose()), null);
  eq('a prose note is the only key field', Q.keyColumns(prose({ key: { ...prose().key, reference: ' Look for energy. ' } })), { reference_text: 'Look for energy.' });
  for (const q of [mc(), numeric(), prose({ key: { ...prose().key, reference: 'x' } })]) {
    const cols = Q.keyColumns(q);
    check(`${q.format}: the key never carries checked_by, checked_at, created_by or written_by`,
      !cols || !['checked_by', 'checked_at', 'created_by', 'created_at', 'written_by', 'superseded_at', 'version'].some(f => f in cols), JSON.stringify(cols));
  }
  const qc = Q.questionColumns(mc(), 4);
  eq('question columns: position, format, choices', [qc.position, qc.format, qc.choices.length], [4, 'multiple_choice', 2]);
  check('question columns carry no key field', !('correct_choice_ids' in qc) && !('value' in qc));
  eq('a numeric question stores its unit hint, a choice question does not', [Q.questionColumns(numeric({}, { unitHint: ' m/s ' }), 1).unit_hint, qc.unit_hint], ['m/s', null]);
  eq('a numeric question has no choices column value', Q.questionColumns(numeric(), 1).choices, null);

  const a = { correct_choice_ids: ['b'], select_rule: 'all_or_nothing' };
  check('the same key is the same', Q.sameKey({ ...a, id: 'x', version: 1, checked_by: null }, a));
  check('a different correct choice is a different key', !Q.sameKey({ correct_choice_ids: ['a'] }, a));
  check('0 and "0" are the same value (the database returns numbers)', Q.sameKey({ value: 0, tol_abs: 0 }, { value: '0', tol_abs: 0 }));
  check('null and a missing field are the same', Q.sameKey({ value: 3, unit: null }, { value: 3 }));
  check('a changed tolerance is a different key', !Q.sameKey({ value: 3, tol_abs: 0.1 }, { value: 3, tol_abs: 0.2 }));
}

section('the student preview carries no key');
{
  const q = mc({ prompt: 'Pick <b>one</b>', key: { ...mc().key, correct: ['b'] } });
  const html = Q.previewHtml(q, 1);
  check('the prompt is escaped', html.includes('&lt;b&gt;one&lt;/b&gt;') && !html.includes('<b>one</b>'));
  check('every choice is shown', html.includes('One') && html.includes('Two'));
  check('no choice is checked, and nothing says which is correct', !/checked/.test(html) && !/correct/i.test(html));
  check('inputs are disabled, so a preview cannot be answered', (html.match(/disabled/g) || []).length >= 2);
  const n = Q.previewHtml(numeric({ value: '9.81', tolAbs: '0.2', unit: 'm/s^2' }, { unitHint: 'm/s^2' }), 2);
  check('a numeric preview shows the unit hint and not the value', n.includes('m/s^2') && !n.includes('9.81') && !n.includes('0.2'));
  check('a multiple select says so', Q.previewHtml(mc({ format: 'multiple_select' }), 1).includes('Select all that apply'));
  check('a hostile choice is escaped', Q.previewHtml(mc({ choices: [{ id: 'a', text: '<img src=x onerror=1>' }, { id: 'b', text: 'ok' }] }), 1).includes('&lt;img'));
  const src = read('site/js/faculty-questions.js');
  const fn = src.slice(src.indexOf('export function previewHtml'), src.indexOf('/* ══', src.indexOf('export function previewHtml')));
  check('previewHtml never reads the key object', !/\.key\b/.test(fn));
  const sy = Q.previewHtml(symbolic({ expression: 'm*v^2/2', variables: 'm, v' }, { variables: 'm, v' }), 1);
  check('a symbolic preview names the variables and never the expression', sy.includes('m, v') && !sy.includes('v^2') && /disabled/.test(sy), sy);
}

section('the CSV parser');
{
  eq('plain rows', Q.parseCsv('a,b\n1,2\n').rows, [['a', 'b'], ['1', '2']]);
  eq('CRLF and a missing final newline', Q.parseCsv('a,b\r\n1,2').rows, [['a', 'b'], ['1', '2']]);
  eq('lone CR (old spreadsheet export)', Q.parseCsv('a,b\r1,2\r').rows, [['a', 'b'], ['1', '2']]);
  eq('quotes protect a comma', Q.parseCsv('a,b\n"x, y",2').rows[1], ['x, y', '2']);
  eq('a doubled quote is one quote', Q.parseCsv('a\n"say ""hi"""').rows[1], ['say "hi"']);
  eq('a line break inside quotes stays in the cell', Q.parseCsv('a,b\n"line1\nline2",2').rows[1], ['line1\nline2', '2']);
  eq('a byte order mark is dropped', Q.parseCsv('﻿a,b\n1,2').rows[0], ['a', 'b']);
  eq('a tab-separated paste from a spreadsheet works', Q.parseCsv('a\tb\n1\t2').rows, [['a', 'b'], ['1', '2']]);
  eq('blank lines are skipped', Q.parseCsv('a,b\n\n1,2\n\n').rows.length, 2);
  eq('empty cells stay empty', Q.parseCsv('a,b,c\n1,,3').rows[1], ['1', '', '3']);
  const bad = Q.parseCsv('a,b\n"never closed,2\n');
  check('an unclosed quote is an error naming the line', /never closes/.test(bad.error) && /line 2/.test(bad.error), bad.error);
}

section('the import plan: the example file, and the whole file refused for one bad row');
{
  const example = read('docs/examples/questions-example.csv');
  check('the example under docs/ is exactly the one the page offers', example.replace(/\r\n/g, '\n') === Q.EXAMPLE_CSV);
  const ok = Q.planImport(Q.EXAMPLE_CSV, { grading: 'auto_checked', existing: [] });
  check('the example file imports cleanly', ok.ok && ok.fileErrors.length === 0 && ok.rows.every(r => r.ok), JSON.stringify(ok.rows.map(r => r.problems)));
  eq('four questions to write', ok.toWrite.length, 4);
  eq('qids are kept as given', ok.toWrite.map(w => w.columns.qid), ['speed', 'forces', 'accel', 'net']);
  eq('positions run 1..4', ok.toWrite.map(w => w.columns.position), [1, 2, 3, 4]);
  eq('choices get the letters a, b, c, d', ok.toWrite[0].columns.choices.map(c => c.id), ['a', 'b', 'c', 'd']);
  eq('"b" names Velocity', ok.toWrite[0].key.correct_choice_ids, ['b']);
  eq('a|b names two choices', ok.toWrite[1].key.correct_choice_ids, ['a', 'b']);
  const net = ok.toWrite[3];
  eq('the key of 0 arrives as 0 with its tolerance', [net.key.value, net.key.tol_abs], [0, 0.01]);
  eq('aliases split on |', ok.toWrite[2].key.unit_aliases, ['m/s2', 'm s^-2']);
  eq('the total of the example is 6 points', ok.toWrite.reduce((s, w) => s + w.columns.points, 0), 6);

  const withPositions = Q.planImport(Q.EXAMPLE_CSV, { grading: 'auto_checked', existing: [{ qid: 'older', position: 7 }] });
  eq('positions continue after the existing questions', withPositions.toWrite.map(w => w.columns.position), [8, 9, 10, 11]);

  // one bad row among good ones
  const lines = Q.EXAMPLE_CSV.trim().split('\n');
  const mixed = [lines[0], lines[1], 'bad,numeric,"No value here",1,,,,,,,,,,,,'].join('\n');
  const refused = Q.planImport(mixed, { grading: 'auto_checked' });
  check('one bad row refuses the whole file', !refused.ok && refused.toWrite.length === 0);
  check('the good row is still reported good, and the bad one by its line', refused.rows[0].ok && !refused.rows[1].ok && refused.rows[1].line === 3);
  check('the refusal names the row and the reason', /Row 3.*correct value/.test(refused.rows[1].problems.join(' ')));

  const head = 'qid,format,prompt,points,choices,correct,value,tol_abs';
  const one = (row, grading = 'auto_checked', existing = []) => Q.planImport(`${head}\n${row}`, { grading, existing });
  const why = (p) => p.rows.flatMap(r => r.problems).concat(p.fileErrors).join(' | ');
  check('a value of 0 with no tolerance is refused', /absolute tolerance/.test(why(one('z,numeric,"Zero?",1,,,0,'))));
  check('a value of 0 with a tolerance is accepted', one('z,numeric,"Zero?",1,,,0,0').ok);
  check('a third decimal in points is refused', /two decimal places at most/.test(why(one('t,numeric,"x",1.005,,,3,0.1'))));
  check('an unknown format is refused, naming the word', /"essay"/.test(why(one('t,essay,"x",1,,,,'))));
  check('prose on an auto_checked item is refused', /prose question cannot be on an auto-checked/.test(why(one('t,prose,"Explain",2,,,,'))));
  check('prose on a human graded item is accepted', one('t,prose,"Explain",2,,,,', 'human_graded').ok);
  check('a correct choice that is not a choice is refused', /not one of the choices/.test(why(one('t,multiple_choice,"x",1,A|B,c,,'))));
  check('the correct choice can be named by its text', one('t,multiple_choice,"x",1,Alpha|Beta,beta,,').ok);
  check('a multiple choice with two correct is refused', /exactly one correct/.test(why(one('t,multiple_choice,"x",1,A|B,a|b,,'))));
  check('a duplicate qid inside the file is refused', /appears twice/.test(why(Q.planImport(`${head}\nt,numeric,"x",1,,,1,0\nt,numeric,"y",1,,,1,0`, {}))));
  check('a qid that already exists (even retired) is refused', /already used in this assignment/.test(why(one('q1,numeric,"x",1,,,1,0', 'auto_checked', [{ qid: 'q1', position: 1 }]))));
  check('a missing qid gets the next free one, skipping existing', one('  ,numeric,"x",1,,,1,0', 'auto_checked', [{ qid: 'q1', position: 1 }]).toWrite[0].columns.qid === 'q2');
  check('a cell count above the header is refused (an unquoted comma)', /needs quotes/.test(why(one('t,numeric,"x",1,,,1,0,extra'))));
  check('an empty file is refused', /empty/.test(why(Q.planImport('   '))));
  check('a header only is refused', /at least one question/.test(why(Q.planImport(head))));
  check('a missing required column is refused', /no "points" column/.test(why(Q.planImport('format,prompt\nnumeric,x'))));
  check('an unknown column is refused, not ignored', /Unknown column.*colour/.test(why(Q.planImport(`${head},colour\nt,numeric,"x",1,,,1,0,red`))));
  check('a repeated column is refused', /appears twice in the header/.test(why(Q.planImport('format,prompt,points,points\nnumeric,x,1,1'))));
  check('an unclosed quote is refused', /never closes/.test(why(Q.planImport(`${head}\nt,numeric,"x,1`))));
  const many = `${head}\n` + Array.from({ length: 501 }, (_, i) => `m${i},numeric,"x",1,,,1,0`).join('\n');
  check('more than 500 rows is refused', /more than 500/.test(why(Q.planImport(many))));
  check('headers may be written the way a person writes them', Q.planImport('Type,Question,Points,Value,Tolerance\nnumeric,"x",1,1,0').ok);
  check('a whole file with no problem has nothing refused', ok.rows.every(r => r.problems.length === 0));
}

section('import: the file as bytes, ambiguity, row numbers, ids (reviews B S1, S10, M2, M3, S5 points)');
{
  const head = 'qid,format,prompt,points,choices,correct,value,tol_abs';
  const one = (row, grading = 'auto_checked', existing = []) => Q.planImport(`${head}\n${row}`, { grading, existing });
  const why = (p) => p.rows.flatMap(r => r.problems).concat(p.fileErrors).join(' | ');

  const good = new TextEncoder().encode('format,prompt,points\nnumeric,"Caf\u00e9?",1');
  const dec = Q.decodeUtf8Strict(good);
  check('valid UTF-8 decodes, accents intact', !dec.error && dec.text.includes('Caf\u00e9'));
  const latin1 = new Uint8Array([0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x2c, 0x70, 0x72, 0x6f, 0x6d, 0x70, 0x74, 0x0a, 0x6e, 0x2c, 0x43, 0x61, 0x66, 0xe9]);
  const bad = Q.decodeUtf8Strict(latin1);
  check('bytes that are not UTF-8 are refused, not guessed at, with the one-sentence fix', !!bad.error && /CSV UTF-8/.test(bad.error) && bad.text === '');
  const fffd = Q.planImport(`${head}\nt,numeric,"Caf\uFFFD?",1,,,1,0`, {});
  check('a replacement character in the text refuses the file and names the line', !fffd.ok && fffd.toWrite.length === 0 && /Line 2/.test(fffd.fileErrors.join(' ')) && /CSV UTF-8/.test(fffd.fileErrors.join(' ')), fffd.fileErrors.join('|'));

  const amb = one('t,multiple_choice,"x",1,b|a,a,,');
  check('"a" is the letter of one choice and the text of another: refused as ambiguous', !amb.ok && /ambiguous/.test(why(amb)), why(amb));
  check('a value that is only a letter still works', one('t,multiple_choice,"x",1,Alpha|Beta,b,,').ok);
  check('a value that is only a text still works', one('t,multiple_choice,"x",1,Alpha|Beta,Beta,,').ok);

  const multi = Q.planImport(`${head}\nt1,numeric,"first\nline two",1,,,1,0\nt2,numeric,"x",1,,,,`, {});
  check('a row after a multi-line cell is reported at its line in the FILE, not its row count', !multi.ok && /Row 4/.test(why(multi)), why(multi));

  const ids = Q.planImport(`${head}\n,numeric,"auto",1,,,1,0\nq1,numeric,"explicit",1,,,1,0`, { existing: [] });
  eq('an explicit q1 later in the file is not taken by an earlier blank row', ids.toWrite.map(w => w.columns.qid), ['q2', 'q1']);

  check('points written in exponent form are refused', /plain number|two decimal/.test(why(one('t,numeric,"x",1e-10,,,1,0'))), why(one('t,numeric,"x",1e-10,,,1,0')));
  check('points of 2.50 are fine', one('t,numeric,"x",2.50,,,1,0').ok);
  check('a key value of more than 15 digits is refused', /15 digits/.test(why(one('t,numeric,"x",1,,,1234567890123456789,0'))), why(one('t,numeric,"x",1,,,1234567890123456789,0')));
  check('a key value of 15 digits is accepted', one('t,numeric,"x",1,,,123456789012345,0').ok);
}

section('database: add, edit (versions), move, remove, import');
{
  // add
  reset();
  let r = await Q.addQuestion(db, 'act-1', mc(), [{ position: 2 }, { position: 5 }]);
  check('an add inserts the question, then its key at version 1', !r.error && r.keyVersion === 1);
  eq('the question is written at the next position', writes('questions', 'insert')[0].payload.position, 6);
  eq('...for this activity', writes('questions', 'insert')[0].payload.activity_id, 'act-1');
  const k1 = writes('question_keys', 'insert')[0].payload;
  eq('the key is version 1, written by a human', [k1.version, k1.written_by], [1, 'human']);
  eq('a single add names the same NOT NULL defaults', [k1.select_rule, k1.sig_fig_mode, k1.unit_mode, k1.variant_key], ['all_or_nothing', 'ignore', 'ignore', '']);
  check('the key payload carries no checked_by, checked_at or created_by', !('checked_by' in k1) && !('checked_at' in k1) && !('created_by' in k1));
  eq('the key points at the new question', k1.question_id, 'questions-1');
  check('the question is written before the key', CALLS.findIndex(c => c.table === 'questions') < CALLS.findIndex(c => c.table === 'question_keys'));

  reset({ 'question_keys.insert': { __error: { code: '23514', message: 'violates check constraint' } } });
  r = await Q.addQuestion(db, 'act-1', numeric({ value: '0', tolAbs: '0' }), []);
  check('a key that fails removes the question just made', !!r.error && writes('questions', 'delete').length === 1);
  eq('... and the clean-up is read back and reported as clean', r.outcome, 'Nothing was kept.');

  let leftover = 1;
  reset({ 'question_keys.insert': { __error: { code: '23514', message: 'violates check constraint' } },
    'questions.select': () => (leftover ? [{ id: 'questions-1' }] : []) });
  r = await Q.addQuestion(db, 'act-1', numeric({ value: '0', tolAbs: '0' }), []);
  check('a clean-up that cannot remove the question says one was kept (review B S8)', !!r.error && /1 question from this write was kept/.test(r.outcome), r.outcome);
  reset({ 'question_keys.insert': { __error: { code: '23514', message: 'x' } }, 'questions.select': { __error: { message: 'down' } } });
  r = await Q.addQuestion(db, 'act-1', numeric({ value: '0', tolAbs: '0' }), []);
  check('a clean-up that cannot be read back says it could not be confirmed', /could not be confirmed/.test(r.outcome), r.outcome);
  reset({ 'questions.insert': { __error: { message: 'TypeError: Failed to fetch' } }, 'questions.select': [] });
  r = await Q.addQuestion(db, 'act-1', mc(), []);
  check('an insert whose answer was lost looks for the question before it says anything', !!r.error && CALLS.some(c => c.table === 'questions' && c.verb === 'select') && /Nothing was kept/.test(r.outcome));

  reset();
  r = await Q.addQuestion(db, 'act-1', prose(), []);
  check('prose with no note writes a question and no key', !r.error && writes('question_keys').length === 0);

  reset({ 'questions.insert': { __error: { code: '23505', message: 'duplicate key value violates unique constraint "questions_activity_qid_key"' } } });
  r = await Q.addQuestion(db, 'act-1', mc(), []);
  check('a reused qid is a sentence', /never reused/.test(Q.questionError(r.error)));

  // edit: one database call, save_question
  const prev = { id: 'q-id', position: 3, updatedAt: '2026-11-05T10:00:00Z', keyRow: { id: 'k-id', version: 2, correct_choice_ids: ['b'], select_rule: 'all_or_nothing' } };
  reset({ 'rpc:save_question': [{ key_version: 2, new_version: false }] });
  r = await Q.saveQuestion(db, mc(), prev);
  check('an unchanged key asks for no new version', !r.error && r.newVersion === false && r.keyVersion === 2 && rpcs('save_question')[0].payload.p_write_key === false);
  check('the edit is ONE call and no other write', CALLS.length === 1 && rpcs('save_question').length === 1);
  const uq = rpcs('save_question')[0].payload;
  check('the edit never sends qid, format or position', !('qid' in uq.p_cols) && !('format' in uq.p_cols) && !('position' in uq.p_cols));
  eq('the call names the question, the stamp it was opened on and the key version it saw',
    [uq.p_question, uq.p_expected_updated_at, uq.p_expected_key_version], ['q-id', '2026-11-05T10:00:00Z', 2]);

  reset({ 'rpc:save_question': [{ key_version: 3, new_version: true }] });
  r = await Q.saveQuestion(db, mc({ key: { ...mc().key, correct: ['a'] } }), prev);
  check('a changed key asks for a new version, and the answer says version 3', !r.error && r.keyVersion === 3 && r.newVersion === true);
  const sk = rpcs('save_question')[0].payload;
  eq('the new key travels in the same call', [sk.p_write_key, sk.p_key.correct_choice_ids], [true, ['a']]);
  check('nothing else is written, so there is no half-state to undo', CALLS.every(c => c.verb === 'rpc'));
  check('no checked_by, checked_at or created_by in the key', !('checked_by' in sk.p_key) && !('checked_at' in sk.p_key) && !('created_by' in sk.p_key));

  reset({ 'rpc:save_question': { __error: { code: '40001', message: 'this question changed since you opened it' } } });
  r = await Q.saveQuestion(db, mc(), prev);
  check('a question changed in another window is refused and says so', !!r.error && /after you opened/i.test(Q.questionError(r.error)) && /Nothing was saved/.test(Q.questionError(r.error)), Q.questionError(r.error));
  reset({ 'rpc:save_question': { __error: { code: '40001', message: 'the answer key changed since you opened this question' } } });
  r = await Q.saveQuestion(db, mc(), prev);
  check('a key changed in another window is refused too', !!r.error && /Nothing was saved/.test(Q.questionError(r.error)));

  reset({ 'rpc:save_question': [{ key_version: 3, new_version: true }] });
  r = await Q.saveQuestion(db, numeric({ value: '0', tolAbs: '0' }), { id: 'q2', position: 1, updatedAt: 'T', keyRow: { id: 'k2', version: 2, value: 4, tol_abs: 0 } });
  check('changing a key to 0 is a new version, and 0 is sent as 0', r.keyVersion === 3 && rpcs('save_question')[0].payload.p_key.value === 0);

  reset({ 'rpc:save_question': [{ key_version: 1, new_version: true }] });
  r = await Q.saveQuestion(db, mc(), { id: 'q3', position: 1, updatedAt: 'T', keyRow: null });
  check('a question with no key yet gets version 1 on save, expecting no prior key', r.keyVersion === 1 && rpcs('save_question')[0].payload.p_expected_key_version === null);

  reset({ 'rpc:save_question': [{ key_version: 2, new_version: true }] });
  r = await Q.saveQuestion(db, prose({ reference_text: '' }), { id: 'q4', position: 1, updatedAt: 'T', keyRow: { id: 'k4', version: 1, reference_text: 'Look for the force balance.' } });
  const clr = rpcs('save_question')[0].payload;
  check('clearing prose guidance is a new key version with no text (review B S6)', clr.p_write_key === true && clr.p_key.reference_text === null, JSON.stringify(clr.p_key));

  reset({ 'rpc:save_question': { __error: { message: 'TypeError: Failed to fetch' } } });
  r = await Q.saveQuestion(db, mc(), prev);
  check('a dropped connection does not claim nothing changed', !/Nothing was saved|Nothing was changed/.test(Q.questionError(r.error)) && /not known/.test(Q.questionError(r.error)));
  check('a timeout does not claim nothing changed', !/Nothing was changed/.test(Q.questionError({ code: '57014', message: 'canceling statement due to statement timeout' })));

  // move
  const list = [{ id: 'a', position: 0 }, { id: 'b', position: 0 }, { id: 'c', position: 0 }];
  reset();
  r = await Q.moveQuestion(db, list, 'c', 'up');
  check('moving up renumbers 1..n', r.moved && writes('questions', 'update').map(c => [c.filters['eq:id'], c.payload.position]).join() === 'a,1,c,2,b,3', writes('questions', 'update').map(c => [c.filters['eq:id'], c.payload.position]).join());
  reset();
  r = await Q.moveQuestion(db, list, 'a', 'up');
  check('the first cannot move up', r.moved === false && CALLS.length === 0);
  reset();
  r = await Q.moveQuestion(db, [{ id: 'a', position: 1 }, { id: 'b', position: 2 }], 'a', 'down');
  eq('a clean list writes only the two that change', writes('questions', 'update').length, 2);

  // remove / retire
  reset();
  r = await Q.removeQuestion(db, 'q-id');
  check('a remove with no attempts deletes', r.removed === true && writes('questions', 'delete').length === 1);
  reset({ 'questions.delete': { __error: { code: '23503', message: 'violates foreign key constraint "question_attempts_question_id_fkey"' } } });
  r = await Q.removeQuestion(db, 'q-id');
  check('a remove that attempts restrict retires instead', r.retired === true && writes('questions', 'update')[0].payload.is_retired === true);
  reset({ 'questions.delete': { __error: { code: '42501', message: 'permission denied' } } });
  r = await Q.removeQuestion(db, 'q-id');
  check('another failure is reported, not retired', !!r.error && writes('questions', 'update').length === 0);
  reset();
  await Q.setRetired(db, 'q-id', false);
  eq('restoring sets is_retired false', writes('questions', 'update')[0].payload, { is_retired: false });

  // import
  const plan = Q.planImport(Q.EXAMPLE_CSV, { grading: 'auto_checked' });
  reset({ 'questions.insert': (s, mode) => plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid })) });
  r = await Q.writeImport(db, 'act-1', plan);
  check('an import writes all questions in one statement and all keys in one', r.count === 4 && writes('questions', 'insert').length === 1 && writes('question_keys', 'insert').length === 1);
  eq('four question rows', writes('questions', 'insert')[0].payload.length, 4);
  const keys = writes('question_keys', 'insert')[0].payload;
  eq('four key rows, version 1, human, none stamped', [keys.length, keys.every(k => k.version === 1 && k.written_by === 'human'), keys.some(k => 'checked_by' in k || 'created_by' in k)], [4, true, false]);
  eq('the key of 0 is sent as 0', keys.find(k => k.question_id === 'id-3').value, 0);
  check('the questions are written before the keys', CALLS.findIndex(c => c.table === 'questions') < CALLS.findIndex(c => c.table === 'question_keys'));
  const notNull = ['select_rule', 'sig_fig_mode', 'unit_mode', 'written_by', 'variant_key', 'version', 'question_id'];
  check('every imported key row names every NOT NULL column (a bulk insert turns a missing field into NULL)',
    keys.every(k => notNull.every(f => k[f] !== undefined && k[f] !== null)), JSON.stringify(keys.find(k => notNull.some(f => k[f] === undefined || k[f] === null))));
  const sql = read('supabase/migrations/app/030_questions_and_keys.sql');
  const body = sql.slice(sql.indexOf('CREATE TABLE question_keys'), sql.indexOf('CREATE UNIQUE INDEX question_keys_current_idx'));
  const dbNotNull = [...body.matchAll(/^\s{2}([a-z_]+)\s+[a-z\[\]()0-9,]+\s+NOT NULL/gm)].map(m => m[1]).filter(c => !['id', 'created_at'].includes(c));
  check('the list of NOT NULL columns the page names covers every NOT NULL column of the table (read from migration 030)',
    dbNotNull.every(c => c in Q.KEY_NOT_NULL_DEFAULTS || c === 'question_id' || c === 'version'), JSON.stringify(dbNotNull));

  let gone = false;
  reset({ 'questions.insert': () => plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid })), 'question_keys.insert': { __error: { message: 'no' } },
    'questions.select': () => (gone ? [] : plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid }))),
    'questions.delete': () => { gone = true; return []; } });
  r = await Q.writeImport(db, 'act-1', plan);
  check('a key failure undoes the inserted questions, and reads back that they are gone',
    !!r.error && writes('questions', 'delete').length === 1 && writes('questions', 'delete')[0].filters['in:id'].length === 4 && r.outcome === 'Nothing was kept.', r.outcome);
  reset({ 'questions.insert': () => plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid })), 'question_keys.insert': { __error: { message: 'no' } },
    'questions.select': () => plan.toWrite.map((w, i) => ({ id: `id-${i}`, qid: w.columns.qid })), 'questions.delete': { __error: { message: 'refused' } } });
  r = await Q.writeImport(db, 'act-1', plan);
  check('a clean-up that fails says how many were kept (review B S8)', /4 questions from this write were kept/.test(r.outcome), r.outcome);

  reset();
  const refused = Q.planImport('format,prompt,points\nnumeric,x,1', {});
  r = await Q.writeImport(db, 'act-1', refused);
  check('a refused plan writes nothing at all', !!r.error && CALLS.length === 0);
}

section('database: reading');
{
  reset({
    'questions.select': [{ id: 'u1', qid: 'q1', position: 1, prompt_md: 'P', format: 'numeric', choices: null, points: 2, unit_hint: null, is_retired: false }],
    'question_keys.select': [{ id: 'k1', question_id: 'u1', version: 3, value: 0, tol_abs: 0, sig_fig_mode: 'ignore', unit_mode: 'ignore' }],
  });
  const r = await Q.loadQuestions(db, 'act-1');
  check('questions load with their current key', r.questions.length === 1 && r.questions[0].keyVersion === 3);
  eq('a stored value of 0 comes back as "0", not blank', r.questions[0].key.value, '0');
  const kq = CALLS.find(c => c.table === 'question_keys');
  check('every key version is requested, so the page knows the history', kq && !('is:superseded_at' in kq.filters));
  eq('the keys are asked for by question id', kq.filters['in:question_id'], ['u1']);
  eq('the highest version seen is kept for the next save', r.questions[0].maxVersion, 3);

  reset({
    'questions.select': [{ id: 'u2', qid: 'q2', position: 1, prompt_md: 'P', format: 'numeric', choices: null, points: 1, unit_hint: null, is_retired: false }],
    'question_keys.select': [{ id: 'k1', question_id: 'u2', version: 1, value: 4, superseded_at: '2026-11-05T00:00:00Z' },
                             { id: 'k2', question_id: 'u2', version: 2, value: 5, superseded_at: '2026-11-05T00:01:00Z' }],
  });
  const broken = (await Q.loadQuestions(db, 'act-1')).questions[0];
  check('a question whose every key is superseded (an interrupted edit) shows no current key but remembers version 2', broken.keyRow === null && broken.maxVersion === 2 && broken.keyId === null);
  reset({ 'rpc:save_question': [{ key_version: 3, new_version: true }] });
  const fixed = await Q.saveQuestion(db, numeric({ value: '6' }), broken);
  check('saving it again asks for a new key and expects no current key; the database makes version 3',
    fixed.keyVersion === 3 && rpcs('save_question')[0].payload.p_expected_key_version === null && rpcs('save_question')[0].payload.p_write_key === true, JSON.stringify(fixed));

  reset({ 'rpc:save_question': { __error: { code: '57014', message: 'canceling statement due to statement timeout' } } });
  const slow = await Q.saveQuestion(db, mc({ key: { ...mc().key, correct: ['a'] } }), { id: 'q-id', position: 3, maxVersion: 1, keyRow: { id: 'k-id', version: 1, correct_choice_ids: ['b'] } });
  check('a timeout is one failed call, with no second write after it', !!slow.error && CALLS.length === 1);
  check('...and is reported as a timeout that does not claim a verified state', /took too long/.test(Q.questionError(slow.error)) && !/Nothing was changed/.test(Q.questionError(slow.error)), Q.questionError(slow.error));

  const mk = (over = {}) => ({ id: 'o1', points_possible: 4, is_published: false, entered_on_new_page: true, course_offering_id: 'co',
    assignments: { title: 'T', slug: 't' }, offering_activities: [{ position: 0, delivery: 'online_questions', grading: 'auto_checked', activities: { id: 'a1', slug: 's', modality: 'questions' } }], ...over });
  reset({ 'assignment_offerings.select': mk() });
  let it = (await Q.loadItem(db, 'o1')).item;
  check('an unpublished new-page item with one questions path can take questions', it.reason === null && it.activityId === 'a1' && it.grading === 'auto_checked');
  reset({ 'assignment_offerings.select': mk({ entered_on_new_page: false }) });
  check('an item from the older page is refused with a reason', /older page/.test((await Q.loadItem(db, 'o1')).item.reason));
  reset({ 'assignment_offerings.select': mk({ is_published: true }) });
  check('a published item is refused with a reason', /published/.test((await Q.loadItem(db, 'o1')).item.reason));
  reset({ 'assignment_offerings.select': mk({ offering_activities: [{ position: 0, delivery: 'typed_response', grading: 'human_graded', activities: { id: 'a2', modality: 'written' } }] }) });
  check('an item not delivered as questions is refused', /not delivered as questions/.test((await Q.loadItem(db, 'o1')).item.reason));
  reset({ 'assignment_offerings.select': mk({ offering_activities: [] }) });
  check('an item with no path is refused', /exactly one path/.test((await Q.loadItem(db, 'o1')).item.reason));
  reset({ 'assignment_offerings.select': null });
  eq('an unknown item is null, not an error', (await Q.loadItem(db, 'zz')).item, null);

  eq('the sum ignores retired questions and keeps cents', Q.sumPoints([{ points: '1.25', isRetired: false }, { points: '2', isRetired: true }, { points: '0.1', isRetired: false }]), 1.35);
  check('a database error is a sentence', /permission/.test(Q.questionError({ code: '42501', message: 'new row violates row-level security' })));
  check('the zero-needs-tolerance constraint is a sentence', /absolute tolerance/.test(Q.questionError({ message: 'violates check constraint "question_keys_zero_needs_abs"' })));
}

section('the page: no publish control, no key on the student side, no kind branch');
{
  const html = read('site/faculty/questions.html');
  const mod = read('site/js/faculty-questions.js');
  check('the page has no publish control', !/>\s*Publish\s*</i.test(html) && !/is_published\s*:\s*true/.test(html + mod));
  check('the module never writes activities.content', !/from\('activities'\)/.test(mod) && !/\.content\b/.test(mod.replace(/\/\/.*$/gm, '')));
  check('the module never names checked_by in a write', !/checked_by\s*:/.test(mod));
  check('the page is director only', /isDirectorForCurrent\(\)/.test(html));
  check('the page sanitizes with esc and sets no raw HTML from data', (html.match(/\$\{esc\(/g) || []).length > 20);
  check('the Assignments page links to it for an online-questions item', /questions\.html\?a=/.test(read('site/faculty/items.html')));
}

section('choice rows: a switch for correct, joined delete button');
{
  const set = (...a) => [...a];
  eq('one-answer: turning b on turns a off', Q.applyCorrectToggle(set('a'), 'b', true, 'multiple_choice'), ['b']);
  eq('one-answer: turning the only one off leaves none', Q.applyCorrectToggle(set('a'), 'a', false, 'multiple_choice'), []);
  eq('multiple-answer: toggles are independent (on)', Q.applyCorrectToggle(set('a'), 'b', true, 'multiple_select'), ['a', 'b']);
  eq('multiple-answer: toggles are independent (off)', Q.applyCorrectToggle(set('a', 'b'), 'a', false, 'multiple_select'), ['b']);
  const html = Q.choiceRowHtml({ id: 'c', text: 'x "q"' }, true);
  check('the correct control is a checkbox with role switch, keyboard focusable', /<input type="checkbox" role="switch"/.test(html) && !/tabindex="-1"/.test(html));
  check('the switch has an accessible label naming the choice', /aria-label="Choice c is correct"/.test(html));
  check('no radio and no word Correct as visible text', !/type="radio"/.test(html) && !/>\s*Correct\s*</.test(html));
  check('the text input and delete button sit in one joined control', /<span class="choice-join">\s*<input type="text"[^>]*data-text[^>]*>\s*<button[^>]*data-drop/.test(html));
  check('the letter label is kept', /class="choice-letter">c</.test(html));
  check('the switch is checked when correct and text is escaped', /checked/.test(html) && !/x "q"/.test(html));
  const css = read('site/css/styles.css');
  check('the shared CSS joins the input and button with no gap', /\.choice-join\s*\{[^}]*display:\s*flex/.test(css) && /\.choice-join > button[^{]*\{[^}]*margin:\s*0;[^}]*border-left-width:\s*0/.test(css));
}

section('symbolic questions: the expected expression and its variables');
{
  eq('a good symbolic question has no problems', problems(symbolic()), []);
  check('symbolic is offered on an auto-checked item', Q.formatsFor('auto_checked').includes('symbolic'));
  check('a missing expression is refused', problems(symbolic({ expression: '' })).some(p => /expected expression/.test(p)));
  check('no variables is refused', problems(symbolic({ variables: '' }, { variables: '' })).some(p => /at least one variable/.test(p)));
  check('a variable named like a function is refused', problems(symbolic({ variables: 'sin, x' })).some(p => /function or constant/.test(p)));
  check('a duplicate variable is refused', problems(symbolic({ variables: 'x, x', expression: 'x' })).some(p => /twice/.test(p)));
  check('nine variables are refused', problems(symbolic({ variables: 'a b c d e1 f g h i', expression: 'a' })).some(p => /at most 8/.test(p)));
  check('a key that does not parse is refused with the reason', problems(symbolic({ expression: '(m*v' })).some(p => /cannot be used/.test(p) && /bracket/i.test(p)), problems(symbolic({ expression: '(m*v' })).join('|'));
  check('a key using a name that is not a listed variable is refused', problems(symbolic({ expression: 'm*q' })).some(p => /cannot be used/.test(p) && /q/.test(p)));
  check('an unclear division in the key is refused', problems(symbolic({ expression: '1/2m' })).some(p => /cannot be used/.test(p)));
  check('a key defined almost nowhere is refused', problems(symbolic({ expression: 'sqrt(-1-m^2)' })).some(p => /no real value/.test(p)));
  check('a key over the length limit is refused', problems(symbolic({ expression: 'm+'.repeat(101) })).some(p => /longer than 200/.test(p)));
  check('numeric fields on a symbolic question are refused', problems(symbolic({ value: '3' })).some(p => /cannot carry numeric fields/.test(p)));
  check('a unit hint on a symbolic question is refused', problems(symbolic({}, { unitHint: 'm' })).some(p => /unit hint/.test(p)));
  check('a choice question may not carry an expression', problems(mc({ key: { ...Q.emptyQuestion().key, correct: ['b'], expression: 'x' } })).some(p => /expression/.test(p)));
  check('a prose question may not carry an expression', problems(prose({ key: { ...Q.emptyQuestion('prose').key, expression: 'x' } }), { grading: 'human_graded' }).some(p => /machine field/.test(p)));
  eq('the key columns are the expression, the variable list and the ones that can be negative, in order', Q.keyColumns(symbolic({ expression: ' m*v^2/2 ', variables: 'm,  v' })), { expression: 'm*v^2/2', variables: ['m', 'v'], signed_variables: [] });
  eq('the question columns carry no unit hint and no choices', [Q.questionColumns(symbolic(), 1).unit_hint, Q.questionColumns(symbolic(), 1).choices], [null, null]);
  const row = { id: 'q-id', qid: 's1', format: 'symbolic', prompt_md: 'E?', points: '2', unit_hint: null, position: 1, is_retired: false, updated_at: 't', choices: null };
  const back = Q.questionFromRows(row, { id: 'k', version: 2, expression: 'm*v^2/2', variables: ['m', 'v'] });
  eq('a stored symbolic question comes back into the form', [back.key.expression, back.key.variables, back.variables], ['m*v^2/2', 'm, v', 'm, v']);
  check('an unchanged key makes no new version', Q.sameKey({ expression: 'm*v^2/2', variables: ['m', 'v'] }, Q.keyColumns(symbolic())));
  // variables that can be negative
  eq('a variable marked can-be-negative goes into the key', Q.keyColumns(symbolic({ signed: 'v' })).signed_variables, ['v']);
  eq('a stored one comes back into the form', Q.questionFromRows(row, { id: 'k', version: 2, expression: 'm*v^2/2', variables: ['m', 'v'], signed_variables: ['v'] }).key.signed, 'v');
  check('marking one is a change to the key (a new version)', !Q.sameKey({ expression: 'm*v^2/2', variables: ['m', 'v'] }, Q.keyColumns(symbolic({ signed: 'v' }))));
  check('marking none and storing none are the same key', Q.sameKey({ expression: 'm*v^2/2', variables: ['m', 'v'], signed_variables: null }, Q.keyColumns(symbolic())));
  eq('a good signed list has no problems', problems(symbolic({ signed: 'v' })), []);
  check('a signed name that is not a listed variable is refused', problems(symbolic({ signed: 'q' })).some(p => /not one of the variables/.test(p)));
  check('a key that needs a negative value is usable only when that variable is marked',
    problems(symbolic({ expression: 'sqrt(-m)' })).some(p => /no real value/.test(p)) && problems(symbolic({ expression: 'sqrt(-m)', signed: 'm' })).length === 0);
  check('a choice question may not carry signed variables', problems(mc({ key: { ...Q.emptyQuestion().key, correct: ['b'], signed: 'x' } })).some(p => /expression or variables/.test(p)));
  check('the key columns read from the database include signed_variables', /signed_variables/.test(read('site/js/faculty-questions.js')));
  check('a changed expression makes a new version', !Q.sameKey({ expression: 'm*v^2/2', variables: ['m', 'v'] }, Q.keyColumns(symbolic({ expression: 'm*v^2' }))));
  check('a changed variable list makes a new version', !Q.sameKey({ expression: 'm*v^2/2', variables: ['m', 'v'] }, Q.keyColumns(symbolic({ variables: 'm, v, t' }))));
  check('the stored key columns include the new fields', /expression,variables/.test(read('site/js/faculty-questions.js')));
}

summary();
