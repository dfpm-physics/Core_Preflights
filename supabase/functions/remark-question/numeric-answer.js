// numeric-answer.js — the ONE reader of a typed number, and the ONE checker of an answer. Pure: no DOM, no network,
// no imports, so the browser and the Deno edge function run the same file.
//
// WHERE THIS FILE LIVES TWICE
//   site/js/numeric-answer.js                              the source (a staff preview imports it from here)
//   supabase/functions/check-answer/numeric-answer.js      a byte-for-byte copy, because a deployed function can
//                                                          only carry files inside its own folder.
//   tests/app-schema/test-check-answer-function.mjs fails if the two differ (line endings aside), and
//   test-numeric-answer.mjs runs the same vectors through both. Edit the site copy, then copy it over.
//
// WHAT THIS DOES NOT DO
//   It does not mark prose, and it never calls AI. Code reads the number; a person or the key decides what is right.
//
// ── THE COMMA RULE ─────────────────────────────────────────────────────────────────────────────────────────
//   A comma is a THOUSANDS separator, and nothing else. It is accepted only in the strict shape: one to three
//   digits, then groups of exactly three (1,000   12,345,678   1,234.5). Anything else with a comma is REFUSED
//   with a plain message and is not guessed at: 1,5   1,50   1000,5   1,0000   ,5   1,
//   WHY THIS RULE
//     * The course is taught in the United States, and the keys are written with a decimal POINT. The only
//       reading a student can mean by 1,000 that matters here is one thousand.
//     * A comma between a one-digit group and fewer than three digits (1,5) is how many countries write a
//       decimal. Reading it as 15, or as 1.5, would give a wrong mark either way, so the person is asked to
//       retype it. Refusing costs nothing: a refused answer is NOT an attempt.
//     * Strict grouping means a typo such as 1,00 is caught instead of becoming 100.
//   `1,000` itself is therefore one thousand, never one. A key of 1.0 will mark 1,000 wrong.
//
// ── THE OTHER FORMS ───────────────────────────────────────────────────────────────────────────────────────
//   1E3  1.0e3  1000  1,000  +5  -5  −5 (U+2212)  .5  5.  1.5e-3  1.0×10^3  1.0 x 10^3  1.0*10^3
//   Then an optional unit, written after the number: "9.8 m/s^2". A unit must start with a letter or one of
//   ° µ μ Ω %, so "1/2" is refused (it is not one number) instead of reading as 1 with a unit "/2".
//   Refused: nothing, words, NaN, Infinity, hex, a second number, more than 40 digits, an exponent beyond ±400,
//   more than 80 characters.
//
// ── EXACT ARITHMETIC ─────────────────────────────────────────────────────────────────────────────────────
//   A number is a sign, a BigInt coefficient and a power of ten. Nothing goes through floating point, so a
//   boundary (an answer exactly on the edge of the tolerance) is decided exactly, and inclusive.

export const MAX_ANSWER_CHARS = 80;
export const MAX_DIGITS = 40;
export const MAX_EXPONENT = 400;

/* ── exact decimals ──────────────────────────────────────────────────────────────────────────────────── */

/** A decimal: { s: 1 or -1, c: BigInt >= 0, e: integer }. Value = s * c * 10^e. Zero is always positive. */
const dec = (s, c, e) => ({ s: c === 0n ? 1 : s, c, e });

/** Bring two decimals to a common exponent. Returns [a.c scaled, b.c scaled, exponent]. */
function align(a, b) {
  const e = Math.min(a.e, b.e);
  const sa = BigInt(a.s) * a.c * 10n ** BigInt(a.e - e);
  const sb = BigInt(b.s) * b.c * 10n ** BigInt(b.e - e);
  return [sa, sb, e];
}
const cmp = (a, b) => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
const sub = (a, b) => { const [x, y, e] = align(a, b); const d = x - y; return dec(d < 0n ? -1 : 1, d < 0n ? -d : d, e); };
const abs = (a) => dec(1, a.c, a.e);
const mul = (a, b) => dec(a.s * b.s, a.c * b.c, a.e + b.e);

const LITERAL = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/;

/**
 * A plain decimal literal as a database or a key writes it (no commas, no units): "9.8", "-1e3", ".5".
 * Returns a decimal, or null when the text is not one. Used for keys, never for what a student typed.
 */
export function decimalFromLiteral(value) {
  if (value === null || value === undefined) return null;
  const m = LITERAL.exec(String(value).trim());
  if (!m) return null;
  const [, sign, body, exp] = m;
  const [ip, fp = ''] = body.split('.');
  const digits = (ip + fp).replace(/^0+(?=\d)/, '');
  const e = (exp ? parseInt(exp, 10) : 0) - fp.length;
  if (digits.length > 60 || Math.abs(e) > 1000) return null;
  return dec(sign === '-' ? -1 : 1, BigInt(digits || '0'), e);
}

/** The decimal as text the database reads exactly: "1000e0", "-12345e-3". */
export function decimalToDbText(d) {
  return `${d.s < 0 && d.c !== 0n ? '-' : ''}${d.c}e${d.e}`;
}

/** A readable form of a decimal, for tests and messages: 1000, -0.0123. */
export function decimalToPlain(d) {
  const digits = d.c.toString();
  let body;
  if (d.e >= 0) body = digits + '0'.repeat(d.e);
  else if (digits.length > -d.e) body = digits.slice(0, digits.length + d.e) + '.' + digits.slice(digits.length + d.e);
  else body = '0.' + '0'.repeat(-d.e - digits.length) + digits;
  return (d.s < 0 && d.c !== 0n ? '-' : '') + body;
}

/* ── the parser ──────────────────────────────────────────────────────────────────────────────────────── */

const refuse = (code, message) => ({ ok: false, code, message });

const NUMBER_TOKEN = /^([+-]?)([\d,]*)(?:\.(\d*))?/;
const EXPONENT_E = /^[eE]([+-]?\d+)/;
const EXPONENT_TEN = /^\s*[x×*]\s*10\s*\^\s*([+-]?\d+)/;
const UNIT_START = /^[A-Za-zµμΩ°%]/;
const GROUPED = /^\d{1,3}(,\d{3})+$/;

/** Collapse the characters people paste: a real minus sign, a multiplication sign, odd spaces. */
const normalize = (t) => String(t)
  .replace(/[−‒–]/g, '-')
  .replace(/[   ]/g, ' ')
  .trim();

/**
 * Significant figures as WRITTEN, as a range [min, max]. With a decimal point every digit after the leading zeros
 * counts (1.0e3 is 2, 1000. is 4). Without one, trailing zeros are ambiguous (1000 may be 1, 2, 3 or 4), so the
 * range runs from the digits before them to all of them, and a key asking for N matches when N is in the range.
 */
function countSigFigs(intDigits, fracDigits, hasPoint) {
  const all = (intDigits + fracDigits).replace(/^0+/, '');
  if (all === '') return [1, 1];                           // zero
  if (hasPoint) return [all.length, all.length];
  const stripped = all.replace(/0+$/, '').length || 1;
  return [stripped, all.length];
}

/**
 * Read what a student typed.
 *   ok:    { ok: true, value: <decimal>, dbText, sigFigsMin, sigFigsMax, unit, text }   unit is '' when none was typed
 *   not:   { ok: false, code, message }   message is a plain sentence for the student. Nothing is guessed.
 */
export function parseAnswer(input) {
  if (typeof input !== 'string') return refuse('not_text', 'Type your answer as a number.');
  const raw = input;
  if (raw.length > MAX_ANSWER_CHARS) return refuse('too_long', `That answer is longer than ${MAX_ANSWER_CHARS} characters. Type just the number and its unit.`);
  const t = normalize(raw);
  if (t === '') return refuse('empty', 'Type your answer first.');

  const m = NUMBER_TOKEN.exec(t);
  const sign = m[1];
  const intRaw = m[2];
  const fracRaw = m[3];
  const hasPoint = fracRaw !== undefined;
  if (intRaw === '' && (fracRaw === undefined || fracRaw === '')) {
    return refuse('not_a_number', 'That is not a number. Type digits, for example 9.8, 1e3 or 1,000.');
  }

  let intDigits = intRaw;
  if (intRaw.includes(',')) {
    if (!GROUPED.test(intRaw)) {
      return refuse('comma',
        'A comma is read only as a thousands separator, as in 1,000 or 12,345. This one is not, so it is unclear what you mean. '
        + 'Retype it with no comma, and use a decimal point for a decimal, for example 1.5.');
    }
    intDigits = intRaw.replace(/,/g, '');
  }
  let rest = t.slice(m[0].length);
  const frac = fracRaw || '';
  if (!/\d/.test(intDigits + frac)) return refuse('not_a_number', 'That is not a number. Type digits, for example 9.8, 1e3 or 1,000.');
  if ((intDigits + frac).replace(/^0+/, '').length > MAX_DIGITS) return refuse('too_many_digits', `That has more than ${MAX_DIGITS} digits. Round it.`);

  let exp = 0;
  const e1 = EXPONENT_E.exec(rest);
  if (e1) { exp = parseInt(e1[1], 10); rest = rest.slice(e1[0].length); }
  else {
    const e2 = EXPONENT_TEN.exec(rest);
    if (e2) { exp = parseInt(e2[1], 10); rest = rest.slice(e2[0].length); }
  }
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > MAX_EXPONENT) return refuse('exponent_range', 'That power of ten is too large or too small.');

  const unit = rest.trim();
  if (/^0[xXbBoO][0-9A-Za-z]/.test(t)) return refuse('not_a_number', 'That looks like a number in another base (such as 0x1F). Type an ordinary decimal number.');
  if (unit !== '') {
    if (/^[\d.,]/.test(unit)) {
      return refuse('second_number', 'Type one number. If that is a comma or a second point, remove it.');
    }
    if (!UNIT_START.test(unit)) {
      return refuse('not_a_unit', 'After the number I can read only a unit (for example m/s), and "' + unit.slice(0, 12) + '" is not one. Type just the number and its unit.');
    }
    if (unit.length > 24) return refuse('unit_long', 'That unit is too long to be a unit. Type just the number and its unit.');
  }

  const sf = countSigFigs(intDigits, frac, hasPoint);
  const digits = (intDigits + frac).replace(/^0+(?=\d)/, '');
  const value = dec(sign === '-' ? -1 : 1, BigInt(digits || '0'), exp - frac.length);
  return {
    ok: true,
    value,
    dbText: decimalToDbText(value),
    sigFigsMin: sf[0],
    sigFigsMax: sf[1],
    unit,
    text: t,
  };
}

/* ── the checker ─────────────────────────────────────────────────────────────────────────────────────── */

/** Units compare as written, case-sensitive (N is not n, M is not m), with spaces and middle dots tidied. */
export const normalizeUnit = (u) => String(u ?? '').replace(/[·⋅]/g, '*').replace(/\s+/g, '').replace(/−/g, '-');

/**
 * Is a parsed answer right against a key? `key` fields are the question_keys columns:
 *   value, tol_abs, tol_pct (percent: 2 means 2 percent), sig_figs, sig_fig_mode, unit, unit_aliases, unit_mode.
 * Right when it is within the absolute tolerance OR within the percentage tolerance, edge inclusive. With neither
 * tolerance the answer must equal the key exactly. A correct value of 0 is judged by the absolute tolerance
 * alone (a percentage of zero is zero). `warn` modes never change the result; only `require` does.
 * Returns { correct: boolean, why: string }  (why is for tests and staff; it is never sent to a student).
 */
export function checkNumeric(parsed, key) {
  if (!parsed || !parsed.ok) return { correct: false, why: 'unreadable' };
  const target = decimalFromLiteral(key.value);
  if (!target) return { correct: false, why: 'key_value_unreadable' };
  const ta = key.tol_abs === null || key.tol_abs === undefined ? null : decimalFromLiteral(key.tol_abs);
  const tp = key.tol_pct === null || key.tol_pct === undefined ? null : decimalFromLiteral(key.tol_pct);
  if ((key.tol_abs ?? null) !== null && !ta) return { correct: false, why: 'key_tolerance_unreadable' };
  if ((key.tol_pct ?? null) !== null && !tp) return { correct: false, why: 'key_tolerance_unreadable' };

  const diff = abs(sub(parsed.value, target));
  let within = diff.c === 0n;
  if (!within && ta && cmp(diff, ta) <= 0) within = true;
  if (!within && tp && cmp(mul(diff, dec(1, 100n, 0)), mul(abs(target), tp)) <= 0) within = true;
  if (!within) return { correct: false, why: 'out_of_tolerance' };

  if (key.sig_fig_mode === 'require' && key.sig_figs !== null && key.sig_figs !== undefined
      && !(parsed.sigFigsMin <= Number(key.sig_figs) && Number(key.sig_figs) <= parsed.sigFigsMax)) {
    return { correct: false, why: 'sig_figs' };
  }
  if (key.unit_mode === 'require') {
    const accepted = [key.unit, ...(key.unit_aliases || [])].filter(u => u !== null && u !== undefined && u !== '').map(normalizeUnit);
    if (!accepted.includes(normalizeUnit(parsed.unit))) return { correct: false, why: 'unit' };
  }
  return { correct: true, why: 'ok' };
}

/**
 * Choice questions. `selected` is the list of choice ids the student chose; `valid` the ids the question offers
 * (the choices are not secret); `correct` the key. All or nothing. Returns { ok:false, message } when the
 * selection cannot be marked at all (nothing chosen, an id that is not a choice, two for a single-answer
 * question): that is refused and is not an attempt.
 */
export function checkChoices(selected, valid, correct, format) {
  if (!Array.isArray(selected) || selected.some(s => typeof s !== 'string')) return { ok: false, code: 'bad_choice', message: 'Choose an answer.' };
  const uniq = [...new Set(selected)];
  if (uniq.length === 0) return { ok: false, code: 'nothing_chosen', message: 'Choose an answer first.' };
  if (uniq.some(s => !valid.includes(s))) return { ok: false, code: 'bad_choice', message: 'One of those is not a choice for this question. Reload the page.' };
  if (format === 'multiple_choice' && uniq.length !== 1) return { ok: false, code: 'one_only', message: 'Choose one answer.' };
  const want = [...new Set(correct || [])].sort();
  const got = uniq.slice().sort();
  return { ok: true, correct: want.length === got.length && want.every((v, i) => v === got[i]) };
}
