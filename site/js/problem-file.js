// problem-file.js — the ONE file format for making auto-checked problems from a spreadsheet, and the ONE reader of it.
// Plain ES module. Its only import is numeric-answer.js, so the staff page and the offline tests run the same code.
// No DOM, no network, no AI. A person types the file, or asks their own AI model to write it; code reads it.
//
// THE FORMAT (CSV, UTF-8, comma between columns; the first row names the columns; one row per question)
//   type                 number | choice | select          (required)  choice = one correct answer, select = several
//   question             the text the student reads          (required)  put this problem's numbers in the text
//   points               0 to 9999.99, two decimals at most  (required)
//   question_id          optional. Letters, digits, . _ -. Left empty, the next free q-number is used.
//   choices              choice and select only: texts separated by |   (they become a, b, c ...)
//   correct              choice and select only: the letters of the right choices, separated by |   (b   or   a|c)
//   answer               number only: the correct value, a plain number (9.8   -3   1e3   0)
//   tolerance_percent    number only: percent of the answer that is still right (2 means 2 percent)
//   tolerance_absolute   number only: distance from the answer that is still right (required when the answer is 0)
//   unit, unit_aliases   number only: the unit, and other ways to write it (separated by |)
//   unit_rule            ignore | warn | require     (default ignore)
//   sig_figs, sig_fig_rule   number only: required significant figures, and ignore | warn | require (default ignore)
//   unit_hint            number only: a unit shown to the student beside the box
//   variant              KEPT FOR LATER. Must be empty now. Today every student gets the same numbers. When different
//                        numbers per student exist, several rows with one question_id and different variant values
//                        will be the way to say it, and a file written today will still be valid.
//   written_by           human | ai   who wrote the answers. If the column is missing, the upload form asks.
//
// THE REJECTION RULE  (the whole file is refused, and every bad row is listed at once)
//   * Any cell that begins with =, @, or a + or - that is not a plain signed number (spreadsheet formula text), or a
//     tab or line break, is refused, in every column.
//   * A number cell must be a plain number: digits, one optional point, one optional sign, one optional exponent.
//     A comma (1,5 or 1,000), a unit (9.8 m/s), words, NaN, Infinity, hex, a fraction (1/2), a unit sign are refused.
//   * An empty answer, or an empty correct choice, is refused. A key is never guessed.
//   * Numbers are read by numeric-answer.js (decimalFromLiteral), the same reader the answer checker uses. There is no
//     second number parser here. Every number key is also put through the real checker: a key the checker could not
//     accept when typed back is refused.
//
// EXCEL
//   This repository has no .xlsx reader, and adding a library is a build-step decision this file does not make. So only
//   CSV is accepted. A workbook is recognised by its first bytes and answered with the steps to save it as CSV UTF-8.

import { decimalFromLiteral, decimalToPlain, parseAnswer, checkNumeric } from './numeric-answer.js';

export const MAX_ROWS = 500;
export const MAX_CHARS = 400000;
export const MAX_QUESTION = 5000;
export const MAX_CHOICE = 400;
export const MAX_CHOICES = 10;
export const MAX_POINTS = 9999.99;

export const COLUMNS = [
  'question_id', 'type', 'question', 'points', 'choices', 'correct', 'answer', 'tolerance_percent', 'tolerance_absolute',
  'unit', 'unit_aliases', 'unit_rule', 'sig_figs', 'sig_fig_rule', 'unit_hint', 'variant', 'written_by',
];
const REQUIRED = ['type', 'question', 'points'];
const TYPE_TO_FORMAT = { number: 'numeric', choice: 'multiple_choice', select: 'multiple_select' };
const MODES = ['ignore', 'warn', 'require'];
const QID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export const XLSX_MESSAGE = 'This is an Excel workbook (.xlsx), and this page reads CSV files only. In Excel choose File, Save As, then "CSV UTF-8 (Comma delimited)", and choose that file instead.';
export const NOT_UTF8_MESSAGE = 'This file is not saved as UTF-8, so some characters could not be read. In your spreadsheet program choose File, Save As, then "CSV UTF-8 (Comma delimited)", and choose that file again.';

/* ── bytes to text ───────────────────────────────────────────────────────────────────────────────────── */

/** Decode a chosen file's bytes. Refuses a workbook and anything that is not UTF-8. Returns { text, error }. */
export function decodeProblemFile(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4B && (u[2] === 0x03 || u[2] === 0x05) && (u[3] === 0x04 || u[3] === 0x06)) {
    return { text: '', error: XLSX_MESSAGE };                 // a zip container: .xlsx, .xlsm, .ods
  }
  if (u.length >= 8 && u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0) {
    return { text: '', error: XLSX_MESSAGE };                 // an old .xls
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u), error: null };
  } catch {
    return { text: '', error: NOT_UTF8_MESSAGE };
  }
}

/* ── the CSV reader ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * RFC 4180 reading: quoted cells, "" for a quote, line breaks inside quotes. The delimiter is a comma, or a tab when
 * the first line has a tab and no comma (a paste from a spreadsheet). Returns { rows, lines, delimiter, error };
 * lines[i] is the line of the file where row i begins, counting blank lines, so a refusal names the row as the
 * person sees it. A quote that never closes is an error.
 */
export function readCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const first = s.split(/\r\n|\n|\r/, 1)[0] || '';
  const delim = first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const all = [], starts = [];
  let row = [], cell = '', inQ = false, i = 0, line = 1, rowLine = 1, quoteLine = 1, wasQuoted = false;
  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); all.push(row); starts.push(rowLine); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      if (ch === '\n') line++;
      cell += ch; i++; continue;
    }
    if (wasQuoted && ch !== delim && ch !== '\r' && ch !== '\n') {
      return { rows: [], lines: [], delimiter: delim, error: `Line ${line} has text straight after a closing quote. A quoted cell must end at its closing quote; put a comma after it.` };
    }
    if (ch === '"' && cell === '' && !wasQuoted) { inQ = true; wasQuoted = true; quoteLine = line; i++; continue; }
    if (ch === delim) { endCell(); i++; continue; }
    if (ch === '\r') { endRow(); line++; rowLine = line; i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); line++; rowLine = line; i++; continue; }
    cell += ch; i++;
  }
  if (inQ) return { rows: [], lines: [], delimiter: delim, error: `A quoted cell that starts on line ${quoteLine} never closes.` };
  if (cell !== '' || row.length) endRow();
  const rows = [], lines = [];
  all.forEach((r, n) => { if (r.some(c => String(c).trim() !== '')) { rows.push(r); lines.push(starts[n]); } });
  return { rows, lines, delimiter: delim, error: null };
}

/* ── single cells ────────────────────────────────────────────────────────────────────────────────────── */

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** Formula text a spreadsheet would run: = or @ first; + or - first and then a letter, bracket, @ or =; a tab or break first. */
export function looksLikeFormula(cell) {
  const raw = String(cell ?? '');
  if (/^[\t\r\n]/.test(raw)) return true;
  const t = raw.trim();
  if (/^[=@＝＠]/.test(t)) return true;
  // A cell that starts with + or - is a formula to a spreadsheet whatever follows, so only a plain signed number is let through.
  if (/^[+\-−]/.test(t) && t.length > 1) return !/^[+\-−]\s?(?:\d[\d,]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t);
  return false;
}

/**
 * Read a number cell as a plain literal. Returns { ok:true, d, text } (text is a plain decimal string the database
 * reads exactly) or { ok:false, why } with a plain sentence. Nothing is guessed.
 */
export function plainNumber(cell) {
  const t = String(cell ?? '').trim();
  if (t === '') return { ok: false, why: 'is empty' };
  if (t.includes(',')) {
    return { ok: false, why: /^[+-]?\d+,\d+$/.test(t)
      ? `"${t}" uses a comma. Write a decimal point for a decimal (1.5, not 1,5), and no comma in a large number (1000, not 1,000)`
      : `"${t}" has a comma. A number here has no comma: write 1000, not 1,000, and 1.5, not 1,5` };
  }
  if (/^[+-]?[\d.]+(?:[eE][+-]?\d+)?\s*[A-Za-zµμΩ°%]/.test(t) && !/^[+-]?[\d.]+[eE][+-]?\d+$/.test(t)) {
    return { ok: false, why: `"${t}" has a unit or a word in it. Put only the number here and the unit in the unit column` };
  }
  const d = decimalFromLiteral(t);
  if (!d) return { ok: false, why: `"${t.slice(0, 30)}" is not a plain number. Use digits, one decimal point, and an exponent such as 1e3 if needed` };
  if (d.c.toString().length > 40) return { ok: false, why: 'has more than 40 digits. Round it' };
  const text = normalizedPlain(d);
  // written out in full it must still be a number the answer checker and the database both read (no more than 40 digits)
  if (text.replace(/^-/, '').replace('.', '').replace(/^0+(?=d)/, '').length > 40) {
    return { ok: false, why: 'is too large or too small to store as it stands (written out it has more than 40 digits). Use an ordinary-sized number' };
  }
  return { ok: true, d, text };
}

/** A decimal as plain text without trailing zeros after the point (the value is the same). */
function normalizedPlain(d) {
  let { c, e } = d;
  while (e < 0 && c !== 0n && c % 10n === 0n) { c /= 10n; e += 1; }
  if (c === 0n) e = 0;
  return decimalToPlain({ s: d.s, c, e });
}

/* ── the accepted range, in exact arithmetic ─────────────────────────────────────────────────────────── */

const scaled = (d, e) => BigInt(d.s) * d.c * 10n ** BigInt(d.e - e);
const fromScaled = (n, e) => ({ s: n < 0n ? -1 : 1, c: n < 0n ? -n : n, e });

/**
 * The range of answers a key accepts, from the key's own fields (value, tol_abs, tol_pct as text or numbers).
 * Returns { low, high, text } as plain text; text is a sentence for a person. Nothing here marks an answer: the
 * checker does that; this only shows the person what the checker will accept.
 */
export function acceptedRange(key) {
  const v = decimalFromLiteral(key.value);
  if (!v) return { low: null, high: null, text: 'the answer cannot be read' };
  const ta = blank(key.tol_abs) ? null : decimalFromLiteral(key.tol_abs);
  const tp = blank(key.tol_pct) ? null : decimalFromLiteral(key.tol_pct);
  if (!ta && !tp) return { low: normalizedPlain(v), high: normalizedPlain(v), text: `exactly ${normalizedPlain(v)}, no tolerance` };
  const pctWidth = tp ? { s: 1, c: v.c * tp.c, e: v.e + tp.e - 2 } : null;      // |value| * percent / 100
  const e = Math.min(v.e, ta ? ta.e : v.e, pctWidth ? pctWidth.e : v.e);
  const wa = ta ? scaled({ ...ta, s: 1 }, e) : 0n;
  const wp = pctWidth ? scaled(pctWidth, e) : 0n;
  const w = wa > wp ? wa : wp;
  const center = scaled(v, e);
  const low = normalizedPlain(fromScaled(center - w, e));
  const high = normalizedPlain(fromScaled(center + w, e));
  const parts = [];
  if (ta) parts.push(`${normalizedPlain(ta)} either way`);
  if (tp) parts.push(`${normalizedPlain(tp)} percent`);
  return { low, high, text: `${low} to ${high} (the edges count${parts.length > 1 ? '; the wider of ' + parts.join(' and ') : '; ' + parts[0]})` };
}

/* ── reading a whole file ────────────────────────────────────────────────────────────────────────────── */

const canonHeader = (h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_');
const splitBar = (s) => blank(s) ? [] : String(s).split('|').map(x => x.trim()).filter(x => x !== '');

/**
 * Read a problem file. Nothing here touches a database.
 *   opts.existingQids   qids already on the item (retired ones too): an id is never reused
 *   opts.askedOrigin    'human' | 'ai' | null, from the upload form; used only when the file has no written_by column
 *   opts.startPosition  the position to count from for the first question
 * Returns { ok, fileErrors[], rows[], origin, hasOriginColumn, toWrite[], warnings[] }
 *   rows[i]    { line, ok, problems[], qid, type, question, points, summary }  — one per data row, whatever else is wrong
 *   toWrite[i] { line, columns, key }  — only when ok; columns are `questions` columns, key the `question_keys` columns
 */
export function readProblemFile(text, opts = {}) {
  const { existingQids = [], askedOrigin = null, startPosition = 0 } = opts;
  const plan = { ok: false, fileErrors: [], rows: [], origin: null, hasOriginColumn: false, toWrite: [], warnings: [] };
  const raw = String(text ?? '');
  if (!raw.trim()) { plan.fileErrors.push('The file is empty.'); return plan; }
  if (raw.startsWith('PK')) { plan.fileErrors.push(XLSX_MESSAGE); return plan; }
  if (raw.length > MAX_CHARS) { plan.fileErrors.push(`The file is longer than ${MAX_CHARS} characters. Split it into two files.`); return plan; }
  if (raw.includes('\uFFFD')) {
    const at = raw.split(/\r\n|\n|\r/).findIndex(l => l.includes('\uFFFD')) + 1;
    plan.fileErrors.push(`Line ${at} holds a character that could not be read. ${NOT_UTF8_MESSAGE}`);
    return plan;
  }
  if (/\u0000/.test(raw)) { plan.fileErrors.push('The file holds a zero byte, so it is not a text file.'); return plan; }
  const firstLine = raw.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 1)[0] || '';
  if (firstLine.includes(';') && !firstLine.includes(',') && !firstLine.includes('\t')) {
    plan.fileErrors.push('The columns in this file are separated by semicolons. A spreadsheet set to a country that writes decimals with a comma does this. Save it as "CSV UTF-8 (Comma delimited)" and choose it again.');
    return plan;
  }
  const parsed = readCsv(raw);
  if (parsed.error) { plan.fileErrors.push(parsed.error); return plan; }
  if (parsed.rows.length < 2) { plan.fileErrors.push('The file needs a header row and at least one question.'); return plan; }
  if (parsed.rows.length - 1 > MAX_ROWS) { plan.fileErrors.push(`The file has more than ${MAX_ROWS} questions. Split it.`); return plan; }

  // header: exact names only; an unknown or repeated column is refused
  const header = parsed.rows[0].map(canonHeader);
  const headerShown = parsed.rows[0].map(h => String(h).trim());
  const col = {};
  const unknown = [];
  header.forEach((h, idx) => {
    if (h === '') { if (parsed.rows.slice(1).some(r => !blank(r[idx]))) plan.fileErrors.push(`Column ${idx + 1} has data but no name in the header.`); return; }
    if (!COLUMNS.includes(h)) { unknown.push(headerShown[idx]); return; }
    if (col[h] !== undefined) plan.fileErrors.push(`The column "${h}" appears twice in the header.`);
    col[h] = idx;
  });
  for (const r of REQUIRED) if (col[r] === undefined) plan.fileErrors.push(`The header has no "${r}" column.`);
  if (unknown.length) plan.fileErrors.push(`Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Nothing is guessed. The columns are: ${COLUMNS.join(', ')}.`);
  headerShown.forEach((h, idx) => { if (looksLikeFormula(h)) plan.fileErrors.push(`Header column ${idx + 1} reads as spreadsheet formula text, so the file is refused.`); });
  plan.hasOriginColumn = col.written_by !== undefined;
  if (!plan.hasOriginColumn) {
    if (askedOrigin === 'human' || askedOrigin === 'ai') plan.origin = askedOrigin;
    else plan.fileErrors.push('This file does not say who wrote the answers (it has no "written_by" column). Choose below whether a person or an AI model wrote them, then check the file again.');
  }
  if (plan.fileErrors.length) return plan;

  const get = (cells, name) => col[name] === undefined ? '' : String(cells[col[name]] ?? '');
  const taken = new Set(existingQids);
  const explicit = new Set(parsed.rows.slice(1).map(c => get(c, 'question_id').trim()).filter(Boolean));
  const seenQid = new Set();
  let nextN = 1;
  const freeQid = () => { while (taken.has(`q${nextN}`) || explicit.has(`q${nextN}`) || seenQid.has(`q${nextN}`)) nextN++; return `q${nextN++}`; };
  let position = startPosition;
  const origins = new Set();

  parsed.rows.slice(1).forEach((cells, i) => {
    const line = parsed.lines[i + 1];
    const row = { line, ok: false, problems: [], qid: '', type: '', question: '', points: '', summary: null };
    plan.rows.push(row);
    const bad = (name, why) => row.problems.push(`Row ${line}, column "${name}": ${why}.`);

    if (cells.length > header.length && cells.slice(header.length).some(c => !blank(c))) {
      row.problems.push(`Row ${line} has ${cells.length} cells but the header has ${header.length}. A cell that holds a comma needs quotes around it.`);
    }
    // the formula rule applies to every cell of the row, named columns or not
    cells.forEach((c, idx) => {
      if (looksLikeFormula(c)) bad(header[idx] || `column ${idx + 1}`, 'this cell reads as spreadsheet formula text (it begins with = @ or a + or - that is not a plain number). Rewrite it as plain text');
    });
    const formulaNames = new Set(cells.map((c, idx) => looksLikeFormula(c) ? header[idx] : null).filter(Boolean));
    const cell = (name) => get(cells, name).trim();
    const usable = (name) => !formulaNames.has(name);

    // type
    const typeWord = cell('type').toLowerCase();
    const format = TYPE_TO_FORMAT[typeWord] || null;
    row.type = typeWord;
    if (!format && usable('type')) bad('type', `"${cell('type')}" is not number, choice or select`);

    // id
    let qid = cell('question_id');
    if (qid && usable('question_id')) {
      if (!QID_RE.test(qid)) bad('question_id', 'letters, digits, dot, dash and underscore only, up to 64 characters');
      else if (taken.has(qid)) bad('question_id', `${qid} is already used on this item (a retired question keeps its id, and an id is never reused)`);
    }
    // variant: kept for later
    if (!blank(get(cells, 'variant')) && usable('variant')) {
      bad('variant', 'different numbers for each student are not available yet. Leave this column empty. Every student gets the numbers in the question');
    }
    const variant = '';
    if (!qid) qid = freeQid();
    const dupKey = `${qid}\u0001${variant}`;
    if (seenQid.has(dupKey)) bad('question_id', `${qid} appears twice in this file`);
    seenQid.add(dupKey);
    seenQid.add(qid);
    row.qid = qid;

    // question text and points
    const q = get(cells, 'question').trim();
    row.question = q;
    if (usable('question')) {
      if (!q) bad('question', 'write the question');
      else if (q.length > MAX_QUESTION) bad('question', `longer than ${MAX_QUESTION} characters`);
    }
    const pts = cell('points');
    row.points = pts;
    let pointsNum = null;
    if (usable('points')) {
      if (!pts) bad('points', 'is empty. Write the points, for example 2');
      else if (!/^\d{1,4}(\.\d{1,2})?$/.test(pts)) bad('points', `"${pts.slice(0, 20)}" is not a plain number with at most two decimals, such as 2 or 1.5`);
      else {
        pointsNum = Number(pts);
        if (pointsNum > MAX_POINTS) bad('points', `more than ${MAX_POINTS}`);
      }
    }

    // who wrote it
    let rowOrigin = plan.origin;
    if (plan.hasOriginColumn && usable('written_by')) {
      const w = cell('written_by').toLowerCase();
      if (w === 'human' || w === 'ai') rowOrigin = w;
      else bad('written_by', w ? `"${cell('written_by').slice(0, 20)}" is not human or ai` : 'is empty. Write human or ai');
    }
    if (rowOrigin) origins.add(rowOrigin);

    // modes
    const modeOf = (name, label) => {
      const m = cell(name).toLowerCase() || 'ignore';
      if (!usable(name)) return 'ignore';
      if (!MODES.includes(m)) { bad(name, `"${cell(name).slice(0, 20)}" is not ignore, warn or require`); return 'ignore'; }
      return m;
    };

    const numCell = (name, required) => {
      if (!usable(name)) return null;
      const t = get(cells, name);
      if (blank(t)) { if (required) bad(name, 'is empty. A key is never guessed. Write the correct value'); return null; }
      const r = plainNumber(t);
      if (!r.ok) { bad(name, r.why); return null; }
      return r;
    };

    const isChoice = format === 'multiple_choice' || format === 'multiple_select';
    const numberCols = ['answer', 'tolerance_percent', 'tolerance_absolute', 'unit', 'unit_aliases', 'unit_rule', 'sig_figs', 'sig_fig_rule', 'unit_hint'];
    const choiceCols = ['choices', 'correct'];
    let questionCols = null, keyCols = null, shown = null;

    if (isChoice) {
      for (const n of numberCols) if (!blank(get(cells, n)) && usable(n)) bad(n, 'a choice question has no number key. Leave this empty');
      const texts = splitBar(get(cells, 'choices'));
      if (usable('choices')) {
        if (texts.length < 2) bad('choices', 'a choice question needs at least two choices, separated by |');
        if (texts.length > MAX_CHOICES) bad('choices', `no more than ${MAX_CHOICES} choices`);
        const lower = new Set();
        texts.forEach((t, k) => {
          if (t.length > MAX_CHOICE) bad('choices', `choice ${k + 1} is longer than ${MAX_CHOICE} characters`);
          if (lower.has(t.toLowerCase())) bad('choices', `two choices read the same ("${t.slice(0, 30)}")`);
          lower.add(t.toLowerCase());
        });
      }
      const ids = texts.map((_, k) => 'abcdefghij'[k]).filter(Boolean);
      const letters = splitBar(get(cells, 'correct')).map(x => x.toLowerCase());
      const correct = [];
      if (usable('correct')) {
        if (!letters.length) bad('correct', 'is empty. Name the correct choice by its letter (a is the first choice)');
        for (const l of letters) {
          if (!ids.includes(l)) bad('correct', `"${l.slice(0, 20)}" is not the letter of a choice. Use ${ids.length ? ids.join(', ') : 'a, b, c'} (a is the first choice)`);
          else if (correct.includes(l)) bad('correct', `the letter ${l} is given twice`);
          else correct.push(l);
        }
        if (format === 'multiple_choice' && correct.length > 1) bad('correct', 'a choice question has one correct answer. Use type select for several');
        if (format === 'multiple_select' && correct.length === ids.length && ids.length > 0) bad('correct', 'every choice is marked correct. Check the key');
      }
      if (!row.problems.length) {
        questionCols = { qid, position: ++position, prompt_md: q, format, choices: texts.map((t, k) => ({ id: ids[k], text: t })), points: pointsNum, unit_hint: null };
        keyCols = { variant_key: variant, correct_choice_ids: correct, select_rule: 'all_or_nothing', written_by: rowOrigin };
        shown = { kind: 'choice', choices: questionCols.choices, correct, range: null, text: `correct: ${correct.map(c => `${c} (${texts[ids.indexOf(c)]})`).join(', ')}` };
      }
    } else if (format === 'numeric') {
      for (const n of choiceCols) if (!blank(get(cells, n)) && usable(n)) bad(n, 'a number question has no choices. Leave this empty');
      const ans = numCell('answer', true);
      const tp = numCell('tolerance_percent', false);
      const ta = numCell('tolerance_absolute', false);
      if (tp && tp.d.s < 0) bad('tolerance_percent', 'cannot be negative');
      if (tp && tp.d.s > 0 && cmpToInt(tp.d, 100) > 0) bad('tolerance_percent', 'is more than 100 percent. Check it');
      if (ta && ta.d.s < 0) bad('tolerance_absolute', 'cannot be negative');
      if (ans && ans.d.c === 0n && !ta && blank(get(cells, 'tolerance_absolute')) && usable('tolerance_absolute')) bad('tolerance_absolute', 'is required when the answer is 0, because a percentage of 0 is 0');
      const unit = cell('unit');
      const aliases = splitBar(get(cells, 'unit_aliases'));
      const unitRule = modeOf('unit_rule');
      const sigRule = modeOf('sig_fig_rule');
      if (unit.length > 60 && usable('unit')) bad('unit', 'longer than 60 characters');
      if (aliases.length > 10) bad('unit_aliases', 'no more than 10');
      if (unitRule === 'require' && !unit && usable('unit_rule')) bad('unit_rule', 'require needs a unit in the unit column');
      if (!unit && aliases.length && usable('unit_aliases')) bad('unit_aliases', 'other ways to write a unit need a unit in the unit column');
      let sig = null;
      if (!blank(get(cells, 'sig_figs')) && usable('sig_figs')) {
        const t = cell('sig_figs');
        if (!/^\d{1,2}$/.test(t) || Number(t) < 1 || Number(t) > 15) bad('sig_figs', `"${t.slice(0, 12)}" is not a whole number from 1 to 15`);
        else sig = Number(t);
      }
      if (sigRule !== 'ignore' && sig === null && usable('sig_fig_rule')) bad('sig_fig_rule', `${sigRule} needs sig_figs`);
      const hint = cell('unit_hint');
      if (hint.length > 60 && usable('unit_hint')) bad('unit_hint', 'longer than 60 characters');

      if (ans && !row.problems.length) {
        const keyText = { value: ans.text, tol_abs: ta ? ta.text : null, tol_pct: tp ? tp.text : null };
        // the real checker must accept the key typed back, or no student could ever match it
        let typed = ans.text;
        if (unitRule === 'require') typed += ` ${unit}`;
        const back = parseAnswer(typed);
        const verdict = back.ok ? checkNumeric(back, { ...keyText, unit: unit || null, unit_aliases: aliases, unit_mode: unitRule,
          sig_figs: sig, sig_fig_mode: 'ignore' }) : { correct: false, why: back.message };
        if (!verdict.correct) {
          bad('answer', `the answer checker could not accept this key typed back (${back.ok ? verdict.why : back.message.replace(/\.$/, '')}). Write it with fewer digits or a smaller exponent${unitRule === 'require' ? ', and make the unit start with a letter' : ''}`);
        } else {
          const range = acceptedRange(keyText);
          if (!ta && !tp) plan.warnings.push(`Row ${line}: question ${qid} has no tolerance, so only exactly ${ans.text} is right.`);
          questionCols = { qid, position: ++position, prompt_md: q, format, choices: null, points: pointsNum, unit_hint: hint || null };
          keyCols = {
            variant_key: variant, value: ans.text, tol_abs: ta ? ta.text : null, tol_pct: tp ? tp.text : null,
            sig_figs: sig, sig_fig_mode: sigRule, unit: unit || null, unit_aliases: aliases.length ? aliases : null,
            unit_mode: unitRule, written_by: rowOrigin,
          };
          shown = { kind: 'number', value: ans.text, unit, range, text: `${ans.text}${unit ? ' ' + unit : ''}; accepts ${range.text}` };
        }
      }
    }

    row.summary = shown;
    row.ok = row.problems.length === 0 && !!questionCols;
    if (row.ok) plan.toWrite.push({ line, columns: questionCols, key: keyCols });
  });

  plan.ok = plan.rows.length > 0 && plan.rows.every(r => r.ok);
  if (!plan.ok) plan.toWrite = [];
  plan.origin = plan.origin || (origins.has('ai') ? 'ai' : origins.has('human') ? 'human' : null);
  plan.aiCount = plan.rows.length ? plan.toWrite.filter(w => w.key.written_by === 'ai').length : 0;
  return plan;
}

/** Compare a decimal with a small integer. */
function cmpToInt(d, n) {
  const v = d.c * 10n ** BigInt(Math.max(d.e, 0));
  const scale = 10n ** BigInt(Math.max(-d.e, 0));
  const a = v, b = BigInt(n) * scale;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ── the example, and the instructions an instructor gives to their own AI model ────────────────────── */

const csvCell = (v) => /[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;
const csvLine = (cells) => cells.map(csvCell).join(',');

/** A small invented example file with one of each kind, including an answer of 0. `origin` is human or ai. */
export function exampleProblemFile(origin = 'human') {
  const o = origin === 'ai' ? 'ai' : 'human';
  const rows = [
    ['accel', 'number', 'A cart of mass 2.0 kg is pushed by a net force of 6.0 N. What is its acceleration in m/s^2?', '2', '', '', '3', '2', '', 'm/s^2', 'm/s2|m s^-2', 'warn', '2', 'warn', 'm/s^2', '', o],
    ['net', 'number', 'A crate slides at constant velocity on a level floor. What is the net force on it in newtons?', '1', '', '', '0', '', '0.01', 'N', '', 'ignore', '', 'ignore', 'N', '', o],
    ['vec', 'choice', 'Which of these is a vector quantity?', '1', 'Speed|Velocity|Distance|Time', 'b', '', '', '', '', '', '', '', '', '', '', o],
    ['forces', 'select', 'Select every force that acts on a book at rest on a table.', '2', 'Weight|Normal force|Friction|Thrust', 'a|b', '', '', '', '', '', '', '', '', '', '', o],
  ];
  return [csvLine(COLUMNS), ...rows.map(csvLine)].join('\n') + '\n';
}

/** The text an instructor copies into their own AI model. Plain words; the file it asks for is the format above. */
export function aiInstructions() {
  return [
    'I need a CSV file of auto-checked physics problems. Follow these rules exactly.',
    '',
    'THE FILE',
    '- Plain CSV, UTF-8, commas between columns. Put quotes around any cell that contains a comma.',
    '- The first row is the header, with exactly these column names in this order:',
    '  ' + COLUMNS.join(','),
    '- One row per problem. Give the problem its own numbers inside the question text. All students get the same numbers.',
    '',
    'THE COLUMNS',
    '- question_id: a short name such as accel1. Leave it empty if unsure.',
    '- type: number, choice (one correct answer) or select (several correct answers).',
    '- question: the text the student reads.',
    '- points: a plain number, two decimals at most.',
    '- choices (choice and select only): the choice texts separated by | . They become the letters a, b, c in order.',
    '- correct (choice and select only): the letters of the right choices, for example b or a|c.',
    '- answer (number only): the correct value as a plain number. Digits, a point for a decimal, an exponent such as 1e3 if needed. No comma, no unit, no fraction, no words.',
    '- tolerance_percent (number only): the percent of the answer that still counts as right, for example 2.',
    '- tolerance_absolute (number only): how far from the answer still counts, in the units of the answer. REQUIRED when the answer is 0.',
    '- unit, unit_aliases (number only): the unit, and other ways to write it separated by | .',
    '- unit_rule, sig_fig_rule: ignore, warn or require. Use ignore unless told otherwise.',
    '- sig_figs: a whole number, only if you set sig_fig_rule.',
    '- unit_hint: the unit shown beside the answer box.',
    '- variant: leave EMPTY.',
    '- written_by: write ai on every row.',
    '',
    'RULES THAT GET A FILE REFUSED',
    '- A cell may not start with = + - or @ followed by a letter or bracket.',
    '- A number cell holds a plain number only: 1.5 not 1,5; 1000 not 1,000; 9.8 not 9.8 m/s^2.',
    '- Every row needs its answer (number) or its correct letters (choice, select). Never leave a key empty.',
    '- Do not add columns, and do not rename them.',
    '- Give only the file, with no other text before or after it.',
    '',
    'AN EXAMPLE (invented; make your own problems)',
    exampleProblemFile('ai').trimEnd(),
    '',
    'IMPORTANT',
    'You can make a mistake in an answer without noticing. Work each answer out step by step before you write it. A person will check every answer before any student sees it, so do not say the answers are verified.',
    '',
    'Now write the file for these problems:',
    '(describe the problems here: topic, how many, level, the units you use)',
  ].join('\n');
}
