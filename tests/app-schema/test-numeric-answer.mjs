// test-numeric-answer.mjs — the shared number reader and checker (site/js/numeric-answer.js).
//
// WHAT THIS DEFENDS
//   * One parser reads 1E3, 1.0e3, 1000 and 1,000 as the same number, exactly (no floating point).
//   * The comma is a thousands separator in strict shape only; every other comma is REFUSED with a message, and
//     a refusal never guesses.
//   * Nothing odd gets through as a number: words, NaN, Infinity, a fraction, two numbers, a huge exponent.
//   * Tolerance: absolute, percentage, either; the boundary is inclusive and decided exactly; a key of 0 is judged
//     by its absolute tolerance only.
//   * Significant figures and units only change the result in `require` mode.
//   * Choices: all or nothing; an unmarkable selection is refused rather than marked wrong.
//   * Every plain number the staff key-entry page accepts is read to the same value here (the two agree).
//
// WHAT THIS CANNOT PROVE
//   That the edge function carries the same file (test-check-answer-function.mjs), or that the database stores it.
//
// NA_MODULE (optional) points the suite at another copy of the module; it exists so the suite can be shown to fail
// against a deliberately broken one.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { check, eq, section, summary } from './mini-assert.mjs';

const here = new URL('.', import.meta.url);
const target = process.env.NA_MODULE ? pathToFileURL(resolve(process.env.NA_MODULE)).href
  : new URL('../../site/js/numeric-answer.js', here).href;
const na = await import(target);
const { parseAnswer, checkNumeric, checkChoices, decimalToPlain, decimalFromLiteral } = na;

const j = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x));
const plain = (s) => { const r = parseAnswer(s); return r.ok ? decimalToPlain(r.value) : `REFUSED:${r.code}`; };

section('the four formats are one number');
for (const [text, want] of [
  ['1E3', '1000'], ['1.0e3', '1000'], ['1000', '1000'], ['1,000', '1000'],
  ['1e+3', '1000'], ['+1000', '1000'], ['-1000', '-1000'], ['−1000', '-1000'], ['.5', '0.5'], ['5.', '5'],
  ['0.00123', '0.00123'], ['1.5e-3', '0.0015'], ['12,345,678', '12345678'], ['1,234.5', '1234.5'],
  ['1.0×10^3', '1000'], ['1.0 x 10^3', '1000'], ['1.0*10^-3', '0.0010'], ['  42  ', '42'], ['0', '0'], ['-0', '0'],
  ['007', '7'], ['1e0', '1'],
]) eq(`"${text}" reads as ${want}`, plain(text), want);

section('exact, not floating point');
eq('0.1 + nothing is exactly 1/10', plain('0.1'), '0.1');
eq('a 20 digit number keeps every digit', plain('12345678901234567890'), '12345678901234567890');
eq('a very small number keeps its digits', plain('1.23456789e-30').length > 30, true);
{
  const r = parseAnswer('1,000');
  eq('database text is exact', r.dbText, '1000e0');
  eq('database text of 1.50', parseAnswer('1.50').dbText, '150e-2');
  eq('database text of a negative', parseAnswer('-2.5e3').dbText, '-25e2');
}

section('THE COMMA RULE: thousands separator, strict shape, everything else refused');
for (const bad of ['1,5', '1,50', '1000,5', '1,0000', ',5', '1,', '1,,000', '12,34', '1,000,00', '0,5', '1, 000', '1,000,']) {
  const r = parseAnswer(bad);
  check(`"${bad}" is refused as a comma problem`, !r.ok && r.code === 'comma', j(r));
  check(`"${bad}" refusal is a plain sentence`, !r.ok && /comma/i.test(r.message) && r.message.length > 40, r.message);
}
eq('1,000 is one thousand, never one', plain('1,000'), '1000');
eq('1,000.5 is one thousand and a half', plain('1,000.5'), '1000.5');
eq('a comma inside an exponent form is still grouped by the same rule', plain('1,000e3'), '1000000');

section('not a number, refused with a reason');
for (const [text, code] of [
  ['', 'empty'], ['   ', 'empty'], ['abc', 'not_a_number'], ['NaN', 'not_a_number'], ['Infinity', 'not_a_number'],
  ['-', 'not_a_number'], ['.', 'not_a_number'], ['e3', 'not_a_number'], ['0x1F', 'not_a_number'],
  ['1/2', 'not_a_unit'], ['3 4', 'second_number'], ['1.2.3', 'second_number'], ['5 + 3', 'not_a_unit'],
  ['1e999', 'exponent_range'], ['1e-401', 'exponent_range'], ['1e12345678901234567890', 'exponent_range'],
  ['1'.repeat(41), 'too_many_digits'], ['9'.repeat(81), 'too_long'],
]) {
  const r = parseAnswer(text);
  check(`"${text.slice(0, 20)}" refused as ${code}`, !r.ok && r.code === code, j(r));
}
check('a non-string is refused', !parseAnswer(5).ok && parseAnswer(5).code === 'not_text');
check('null is refused', !parseAnswer(null).ok);

section('units after the number');
eq('9.8 m/s^2 has a unit', parseAnswer('9.8 m/s^2').unit, 'm/s^2');
eq('5eV is 5 with unit eV, not an exponent', [plain('5eV'), parseAnswer('5eV').unit], ['5', 'eV']);
eq('1e3m is 1000 with unit m', [plain('1e3m'), parseAnswer('1e3m').unit], ['1000', 'm']);
eq('a bare number has no unit', parseAnswer('9.8').unit, '');
eq('degrees and percent are units', [parseAnswer('30°').unit, parseAnswer('5%').unit], ['°', '%']);

section('significant figures as written');
for (const [text, min, max] of [
  ['1.0e3', 2, 2], ['1000.', 4, 4], ['1000', 1, 4], ['1.50', 3, 3], ['0.0120', 3, 3], ['100', 1, 3],
  ['1e3', 1, 1], ['2', 1, 1], ['0', 1, 1], ['0.00', 1, 1], ['120', 2, 3], ['3.14159', 6, 6],
]) {
  const r = parseAnswer(text);
  eq(`${text} has ${min}${max === min ? '' : ' to ' + max} figures`, [r.sigFigsMin, r.sigFigsMax], [min, max]);
}

section('the checker: tolerance');
const K = (o) => ({ value: '9.8', tol_abs: null, tol_pct: null, sig_figs: null, sig_fig_mode: 'ignore', unit: null, unit_aliases: null, unit_mode: 'ignore', ...o });
const ok = (text, key) => checkNumeric(parseAnswer(text), key).correct;
check('exact match, no tolerance', ok('9.8', K({})));
check('off by a hair, no tolerance, is wrong', !ok('9.81', K({})));
check('percentage: 2 percent of 9.8 (0.196) accepts 9.99', ok('9.99', K({ tol_pct: '2' })));
check('percentage: refuses 10.1', !ok('10.1', K({ tol_pct: '2' })));
check('absolute: 0.05 accepts 9.85 and 9.75', ok('9.85', K({ tol_abs: '0.05' })) && ok('9.75', K({ tol_abs: '0.05' })));
check('absolute: refuses 9.86', !ok('9.86', K({ tol_abs: '0.05' })));
check('either tolerance is enough (absolute misses, percent hits)', ok('10', K({ tol_abs: '0.01', tol_pct: '3' })));
check('either tolerance is enough (percent misses, absolute hits)', ok('9.8', K({ tol_abs: '0.01', tol_pct: '0' })) && ok('9.805', K({ tol_abs: '0.01', tol_pct: '0.01' })));
check('negative key, percent uses the size of the key', ok('-9.99', K({ value: '-9.8', tol_pct: '2' })) && !ok('-10.1', K({ value: '-9.8', tol_pct: '2' })));
check('1E3 form is marked against a 1000 key', ok('1E3', K({ value: '1000' })) && ok('1,000', K({ value: '1000' })) && ok('1.0e3', K({ value: '1000' })));
check('1,000 is not marked as 1', !ok('1,000', K({ value: '1' })));

section('the checker: boundaries are exact and inclusive');
check('exactly on the percentage edge is right (10 percent of 100)', ok('110', K({ value: '100', tol_pct: '10' })) && ok('90', K({ value: '100', tol_pct: '10' })));
check('one hair outside the edge is wrong', !ok('110.0000000000000001', K({ value: '100', tol_pct: '10' })) && !ok('89.9999999999999999', K({ value: '100', tol_pct: '10' })));
check('floating point would say 0.1+0.2 differs from 0.3; here 0.3 is exactly on a 0.3 key', ok('0.3', K({ value: '0.3' })));
check('exactly on the absolute edge', ok('0.3', K({ value: '0.1', tol_abs: '0.2' })));
check('a hair past the absolute edge', !ok('0.30000000000000001', K({ value: '0.1', tol_abs: '0.2' })));
check('tolerance written 0.10 equals 0.1', ok('1.1', K({ value: '1', tol_abs: '0.10' })));

section('the checker: a key of 0 needs absolute tolerance');
check('zero key, absolute 0.01: accepts 0.01, 0, -0.01', ok('0.01', K({ value: '0', tol_abs: '0.01' })) && ok('0', K({ value: '0', tol_abs: '0.01' })) && ok('-0.01', K({ value: '0', tol_abs: '0.01' })));
check('zero key, absolute 0.01: refuses 0.011', !ok('0.011', K({ value: '0', tol_abs: '0.01' })));
check('zero key with only a percentage accepts only exact zero', ok('0', K({ value: '0', tol_pct: '50' })) && !ok('0.0001', K({ value: '0', tol_pct: '50' })));
check('zero key, absolute 0 (exactly zero)', ok('0', K({ value: '0', tol_abs: '0' })) && !ok('1e-30', K({ value: '0', tol_abs: '0' })));

section('the checker: significant figures and units');
check('sig figs ignore: any count passes', ok('9.8000', K({ sig_figs: 2, sig_fig_mode: 'ignore' })));
check('sig figs warn: never changes the mark', ok('9.8000', K({ sig_figs: 2, sig_fig_mode: 'warn' })));
check('sig figs require: 2 figures passes, 5 fails', ok('9.8', K({ sig_figs: 2, sig_fig_mode: 'require' })) && !ok('9.8000', K({ sig_figs: 2, sig_fig_mode: 'require' })));
check('sig figs require: 100 may be 1, 2 or 3 figures (ambiguous trailing zeros pass)', ok('100', K({ value: '100', sig_figs: 3, sig_fig_mode: 'require' })) && ok('100', K({ value: '100', sig_figs: 1, sig_fig_mode: 'require' })));
check('unit ignore: wrong unit still passes', ok('9.8 furlongs', K({ unit: 'm/s^2', unit_mode: 'ignore' })));
check('unit warn: never changes the mark', ok('9.8', K({ unit: 'm/s^2', unit_mode: 'warn' })));
check('unit require: right unit, alias, spacing', ok('9.8 m/s^2', K({ unit: 'm/s^2', unit_mode: 'require' })) && ok('9.8 m/s2', K({ unit: 'm/s^2', unit_aliases: ['m/s2'], unit_mode: 'require' })) && ok('9.8m/s^2', K({ unit: 'm/s^2', unit_mode: 'require' })));
check('unit require: missing or wrong unit fails', !ok('9.8', K({ unit: 'm/s^2', unit_mode: 'require' })) && !ok('9.8 m/s', K({ unit: 'm/s^2', unit_mode: 'require' })));
check('unit is case-sensitive (N is not n)', !ok('5 n', K({ value: '5', unit: 'N', unit_mode: 'require' })) && ok('5 N', K({ value: '5', unit: 'N', unit_mode: 'require' })));
check('a refused answer is not marked', !checkNumeric(parseAnswer('1,5'), K({ value: '1.5' })).correct);
check('a damaged key marks nothing right', !checkNumeric(parseAnswer('1'), K({ value: 'abc' })).correct);

section('choices');
{
  const valid = ['a', 'b', 'c', 'd'];
  eq('single choice right', checkChoices(['b'], valid, ['b'], 'multiple_choice'), { ok: true, correct: true });
  eq('single choice wrong', checkChoices(['a'], valid, ['b'], 'multiple_choice'), { ok: true, correct: false });
  eq('select: all or nothing, order does not matter', checkChoices(['c', 'a'], valid, ['a', 'c'], 'multiple_select'), { ok: true, correct: true });
  eq('select: a missing one is wrong', checkChoices(['a'], valid, ['a', 'c'], 'multiple_select').correct, false);
  eq('select: an extra one is wrong', checkChoices(['a', 'b', 'c'], valid, ['a', 'c'], 'multiple_select').correct, false);
  eq('duplicate ids count once', checkChoices(['b', 'b'], valid, ['b'], 'multiple_choice').correct, true);
  check('nothing chosen is refused, not wrong', checkChoices([], valid, ['a'], 'multiple_choice').ok === false);
  check('an id that is not a choice is refused', checkChoices(['z'], valid, ['a'], 'multiple_choice').ok === false);
  check('two for a single-answer question is refused', checkChoices(['a', 'b'], valid, ['a'], 'multiple_choice').ok === false);
  check('a non-list is refused', checkChoices('a', valid, ['a'], 'multiple_choice').ok === false);
}

section('agreement with the staff key-entry page (faculty-questions.js parseNumber)');
{
  // That page accepts only plain numbers (no commas, no units). Everything it accepts must read to the same value here.
  const loc = { pathname: '/site/faculty/questions.html', search: '', hash: '', href: 'http://localhost/site/faculty/questions.html' };
  globalThis.location ??= loc;
  globalThis.window ??= { location: loc };
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  let fq = null;
  try { fq = await import(new URL('../../site/js/faculty-questions.js', here).href); } catch (e) { fq = null; }
  if (!fq) {
    check('faculty-questions.js can be loaded for the agreement check', false, 'import failed');
  } else {
    let agreed = 0, disagreed = [];
    for (const t of ['9.8', '1e3', '1E3', '-0.5', '+2', '.5', '5.', '0', '1.5e-3', '100', '123456789012345', '2.5E+2']) {
      const a = fq.parseNumber(t);
      const b = parseAnswer(t);
      const same = b.ok && Math.abs(Number(decimalToPlain(b.value)) - a) <= Math.abs(a) * 1e-12;
      if (same) agreed++; else disagreed.push(t);
    }
    eq('every plain number the staff page accepts is read to the same value', disagreed, []);
    check('the staff page refuses 1,000 (key entry stays strict); the answer parser reads it', Number.isNaN(fq.parseNumber('1,000')) && parseAnswer('1,000').ok);
    check('a key written through the staff page is a literal the checker can read', decimalFromLiteral('1.5e-3') !== null && decimalFromLiteral('abc') === null);
  }
}

process.exit(summary() ? 0 : 1);
