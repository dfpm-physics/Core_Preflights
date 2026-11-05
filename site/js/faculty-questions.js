// faculty-questions.js — data layer for question and key entry (faculty/questions.html), schema `app`.
//
// WHAT IT DOES
//   For one item whose single path is online_questions (graded auto_checked or human_graded), a
//   director adds, edits, reorders, retires and removes questions, writes the answer key for each,
//   and bulk imports a whole set from a CSV. Design: docs/decisions/V2-DATA-MODEL.md section 12.
//
// RULES IT KEEPS (the database enforces all of them; this file keeps the page from asking)
//   * A question has a stable `qid`, never reused. A retired question stays.
//   * Keys live in `question_keys`, a separate staff-only table. They are never written into
//     `activities.content` and never rendered in a student preview.
//   * A key edit is a NEW VERSION: the current row gets `superseded_at`, a new row is inserted with
//     version + 1. Nothing is overwritten. (Re-marking existing attempts is Stage E; none exist yet.)
//     The question update and both key steps are ONE database function (save_question, migration app/041), so
//     a refusal or a dropped connection cannot leave the question without a current key. The function also
//     refuses when the question or its key changed since the page read it (updated_at, key version).
//   * A correct value of 0 is a real value. It must carry an absolute tolerance, because a percentage
//     of zero is useless (CHECK question_keys_zero_needs_abs).
//   * Points have two decimals at most (numeric(6,2)). A third decimal is refused, not rounded.
//   * Prose is never machine-marked: no key fields, and not on an auto_checked path.
//   * The page never sends `checked_by`, `checked_at` or `created_by`. The database sets them from the
//     signed-in caller. `written_by` is always 'human' from this page.
//   * Nothing here publishes, and the points of an auto_checked item follow the questions by trigger.
//
// TESTABILITY
//   The CSV parser and every check are pure. The database functions take the client as first argument,
//   so tests/app-schema/test-faculty-questions.mjs drives them with a recording stub.

import { NEW_PAGE_COLUMN } from './new-page-guard.js';
import { esc } from './util.js';

export const FORMATS = ['multiple_choice', 'multiple_select', 'numeric', 'prose'];
export const FORMAT_LABEL = {
  multiple_choice: 'Multiple choice (one answer)',
  multiple_select: 'Multiple select (all that apply)',
  numeric: 'Numeric',
  prose: 'Prose (a person marks it)',
};
export const MODES = ['ignore', 'warn', 'require'];
export const MAX_POINTS = 9999.99;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CHARS = 400000;
export const MAX_PROMPT = 5000;

const QID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const CHOICE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Formats a path may hold: an auto_checked path never holds prose. */
export const formatsFor = (grading) => grading === 'auto_checked'
  ? FORMATS.filter(f => f !== 'prose') : FORMATS.slice();

/* ══════════════════════════════════════════════════════════════════════════════
 * Small pure helpers
 * ════════════════════════════════════════════════════════════════════════════ */

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Read a number the way a person writes one in a cell. Blank is null. Anything else that is not a plain
 * number is NaN (no thousands commas, no units, no words), so a bad cell is refused instead of guessed.
 */
export function parseNumber(s) {
  if (blank(s)) return null;
  const t = String(s).trim();
  if (!NUMBER_RE.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** True when a number has no more than two decimals (numeric(6,2) would otherwise round it silently). */
export const hasTwoDecimalsAtMost = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;

/** True when points are written as a plain decimal with at most two places: no exponent (1e-10 would round to 0.00). */
export const plainTwoDecimalText = (t) => /^[+]?(\d+\.?\d{0,2}|\.\d{1,2})$/.test(String(t).trim());

/** Significant digits written in a number's text, for the 15-digit limit on a key value (more is altered by Number()). */
export function digitCount(t) {
  const mant = String(t).trim().replace(/^[+-]/, '').split(/[eE]/)[0].replace('.', '').replace(/^0+/, '');
  return mant.length;
}

/** The letters a, b, c ... then c1, c2 ... for choices that have no id yet. */
export function choiceIdFor(index) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return index < letters.length ? letters[index] : `c${index + 1}`;
}

/** The next free choice id for a list that may already have gaps (ids are stable once given). */
export function nextChoiceId(choices) {
  const taken = new Set((choices || []).map(c => c.id));
  for (let i = 0; i < 1000; i++) { const id = choiceIdFor(i); if (!taken.has(id)) return id; }
  return `c${taken.size + 1}`;
}

/** The next question id: q1, q2 ... Counts retired questions too, because a qid is never reused. */
export function nextQid(existing = [], reserved = []) {
  const taken = new Set([...existing.map(q => q.qid), ...reserved]);
  let n = existing.length + reserved.length + 1;
  while (taken.has(`q${n}`)) n++;
  return `q${n}`;
}

const splitList = (s) => blank(s) ? [] : String(s).split('|').map(x => x.trim()).filter(x => x !== '');
const splitAliases = (s) => blank(s) ? [] : String(s).split(/[|,]/).map(x => x.trim()).filter(x => x !== '');

/* ══════════════════════════════════════════════════════════════════════════════
 * One question: checks
 * ════════════════════════════════════════════════════════════════════════════ */

/** An empty question for the entry form. */
export const emptyQuestion = (format = 'multiple_choice') => ({
  qid: '', format, prompt: '', points: '1', unitHint: '',
  choices: format === 'multiple_choice' || format === 'multiple_select'
    ? [{ id: 'a', text: '' }, { id: 'b', text: '' }] : [],
  key: { correct: [], value: '', tolAbs: '', tolPct: '', sigFigs: '', sigFigMode: 'ignore',
         unit: '', unitAliases: [], unitMode: 'ignore', reference: '' },
});

/**
 * Check one question and its key. Returns plain sentences; empty means acceptable.
 *   opts.grading     the path's grading, for the prose rule
 *   opts.takenQids   qids already used in this item (retired ones included)
 *   opts.isNew       true when the qid must also be unused
 */
export function checkQuestion(q, { grading = 'auto_checked', takenQids = [], isNew = true } = {}) {
  const out = [];
  const label = q.qid ? `Question ${q.qid}` : 'This question';
  const fmt = q.format;
  if (!FORMATS.includes(fmt)) { out.push(`${label}: the format must be one of ${FORMATS.join(', ')}.`); return out; }
  if (fmt === 'prose' && grading === 'auto_checked') {
    out.push(`${label}: a prose question cannot be on an auto-checked item, because a machine never marks prose. Choose another format, or make the item human graded.`);
  }
  if (blank(q.qid)) out.push('Each question needs an id.');
  else if (!QID_RE.test(String(q.qid))) out.push(`${label}: the id may use letters, numbers, dot, dash and underscore only (up to 64).`);
  else if (isNew && takenQids.includes(q.qid)) out.push(`${label}: that id is already used in this item. An id is never reused, even after the question is retired.`);

  if (blank(q.prompt)) out.push(`${label}: write the question.`);
  else if (String(q.prompt).length > MAX_PROMPT) out.push(`${label}: the question text is longer than ${MAX_PROMPT} characters.`);

  const pts = parseNumber(q.points);
  if (pts === null) out.push(`${label}: enter the points (0 is allowed).`);
  else if (Number.isNaN(pts)) out.push(`${label}: points must be a plain number such as 2 or 1.5.`);
  else if (pts < 0) out.push(`${label}: points cannot be negative.`);
  else if (pts > MAX_POINTS) out.push(`${label}: points cannot be more than ${MAX_POINTS}.`);
  else if (!plainTwoDecimalText(q.points)) {
    out.push(/[eE]/.test(String(q.points))
      ? `${label}: write the points as a plain number such as 2 or 1.5, not with an exponent.`
      : `${label}: points can have two decimal places at most. ${q.points} has a third. Use ${pts.toFixed(2)} if that is what you mean.`);
  }

  const k = q.key || {};
  const choiceFormat = fmt === 'multiple_choice' || fmt === 'multiple_select';
  const machineFilled = (k.correct || []).length > 0 || !blank(k.value) || !blank(k.tolAbs) || !blank(k.tolPct) ||
    !blank(k.sigFigs) || !blank(k.unit) || (k.unitAliases || []).length > 0 ||
    (k.sigFigMode && k.sigFigMode !== 'ignore') || (k.unitMode && k.unitMode !== 'ignore');

  if (choiceFormat) {
    const ch = q.choices || [];
    if (ch.length < 2) out.push(`${label}: a choice question needs at least two choices.`);
    const ids = new Set(); const texts = new Set();
    ch.forEach((c, i) => {
      if (blank(c.text)) out.push(`${label}: choice ${i + 1} is empty.`);
      if (!CHOICE_ID_RE.test(String(c.id || ''))) out.push(`${label}: choice ${i + 1} has no valid id.`);
      if (ids.has(c.id)) out.push(`${label}: two choices share the id ${c.id}.`);
      ids.add(c.id);
      const t = String(c.text || '').trim().toLowerCase();
      if (t && texts.has(t)) out.push(`${label}: two choices read the same ("${String(c.text).trim()}").`);
      texts.add(t);
    });
    const correct = k.correct || [];
    if (!correct.length) out.push(`${label}: mark which ${fmt === 'multiple_choice' ? 'choice is' : 'choices are'} correct.`);
    else {
      for (const c of correct) if (!ids.has(c)) out.push(`${label}: the correct choice "${c}" is not one of the choices.`);
      if (new Set(correct).size !== correct.length) out.push(`${label}: a correct choice is listed twice.`);
      if (fmt === 'multiple_choice' && correct.length !== 1) out.push(`${label}: a multiple choice question has exactly one correct choice. Use multiple select for more.`);
    }
    if (!blank(k.value) || !blank(k.tolAbs) || !blank(k.tolPct) || !blank(k.sigFigs) || !blank(k.unit) ||
        (k.unitAliases || []).length || (k.sigFigMode && k.sigFigMode !== 'ignore') || (k.unitMode && k.unitMode !== 'ignore')) {
      out.push(`${label}: a choice question cannot carry numeric fields (value, tolerance, significant figures, unit).`);
    }
  } else {
    if ((q.choices || []).length) out.push(`${label}: only choice questions have choices.`);
    if ((k.correct || []).length) out.push(`${label}: only choice questions have correct choices.`);
  }

  if (fmt === 'numeric') {
    const v = parseNumber(k.value);
    const ta = parseNumber(k.tolAbs);
    const tp = parseNumber(k.tolPct);
    const sf = parseNumber(k.sigFigs);
    if (v === null) out.push(`${label}: enter the correct value (0 is a valid value).`);
    else if (Number.isNaN(v)) out.push(`${label}: the correct value must be a plain number such as 9.8 or 1e3.`);
    else if (digitCount(k.value) > 15) out.push(`${label}: the correct value has more than 15 digits, more than can be stored exactly. Round it to 15 digits or fewer.`);
    if (Number.isNaN(ta)) out.push(`${label}: the absolute tolerance must be a plain number.`);
    else if (ta !== null && ta < 0) out.push(`${label}: the absolute tolerance cannot be negative.`);
    if (Number.isNaN(tp)) out.push(`${label}: the percent tolerance must be a plain number.`);
    else if (tp !== null && tp < 0) out.push(`${label}: the percent tolerance cannot be negative.`);
    else if (tp !== null && tp > 100) out.push(`${label}: the percent tolerance cannot be over 100, which would accept almost any answer.`);
    if (v === 0 && ta === null) out.push(`${label}: a correct value of 0 needs an absolute tolerance (0 for exactly zero), because a percentage of zero means nothing.`);
    if (Number.isNaN(sf) || (sf !== null && (!Number.isInteger(sf) || sf < 1 || sf > 15))) out.push(`${label}: significant figures must be a whole number from 1 to 15.`);
    if (!MODES.includes(k.sigFigMode || 'ignore')) out.push(`${label}: the significant figures rule must be ignore, warn or require.`);
    else if ((k.sigFigMode || 'ignore') !== 'ignore' && sf === null) out.push(`${label}: significant figures are ${k.sigFigMode}d, so say how many.`);
    if (!MODES.includes(k.unitMode || 'ignore')) out.push(`${label}: the unit rule must be ignore, warn or require.`);
    else if ((k.unitMode || 'ignore') !== 'ignore' && blank(k.unit)) out.push(`${label}: the unit is ${k.unitMode}d, so name the unit.`);
    if ((k.unitAliases || []).length && blank(k.unit)) out.push(`${label}: unit aliases need a unit.`);
  } else if (fmt !== 'prose') {
    if (!blank(q.unitHint)) out.push(`${label}: a unit hint is for numeric questions.`);
  }

  if (fmt === 'prose' && machineFilled) {
    out.push(`${label}: a prose question may carry only reference text for the person who marks it, never a machine field.`);
  }
  if (!blank(k.reference) && fmt !== 'prose') {
    out.push(`${label}: reference text is for prose questions.`);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Rows the database stores
 * ════════════════════════════════════════════════════════════════════════════ */

const num = (s) => { const n = parseNumber(s); return n === null || Number.isNaN(n) ? null : n; };

/** The `questions` columns for a checked question. */
export function questionColumns(q, position) {
  const choiceFormat = q.format === 'multiple_choice' || q.format === 'multiple_select';
  return {
    qid: String(q.qid).trim(),
    position,
    prompt_md: String(q.prompt).trim(),
    format: q.format,
    choices: choiceFormat ? q.choices.map(c => ({ id: c.id, text: String(c.text).trim() })) : null,
    points: num(q.points),
    unit_hint: q.format === 'numeric' && !blank(q.unitHint) ? String(q.unitHint).trim() : null,
  };
}

/**
 * The `question_keys` columns for a checked question. Never includes checked_by, checked_at or created_by:
 * the database sets those from the caller. A prose question gets only reference_text (or no key at all).
 * A correct value of 0 stays 0.
 */
export function keyColumns(q) {
  const k = q.key || {};
  if (q.format === 'multiple_choice' || q.format === 'multiple_select') {
    return { correct_choice_ids: [...k.correct], select_rule: 'all_or_nothing' };
  }
  if (q.format === 'numeric') {
    const aliases = (k.unitAliases || []).map(a => String(a).trim()).filter(Boolean);
    return {
      value: num(k.value), tol_abs: num(k.tolAbs), tol_pct: num(k.tolPct),
      sig_figs: num(k.sigFigs), sig_fig_mode: k.sigFigMode || 'ignore',
      unit: blank(k.unit) ? null : String(k.unit).trim(),
      unit_aliases: aliases.length ? aliases : null, unit_mode: k.unitMode || 'ignore',
    };
  }
  return blank(k.reference) ? null : { reference_text: String(k.reference).trim() };
}

const KEY_FIELDS = ['correct_choice_ids', 'value', 'tol_abs', 'tol_pct', 'sig_figs', 'sig_fig_mode', 'unit',
  'unit_aliases', 'unit_mode', 'reference_text'];
const KEY_DEFAULTS = { sig_fig_mode: 'ignore', unit_mode: 'ignore' };

const normalizeKeyRow = (row) => {
  const out = {};
  for (const f of KEY_FIELDS) {
    let v = row && row[f] !== undefined ? row[f] : null;
    if (v === null && KEY_DEFAULTS[f]) v = KEY_DEFAULTS[f];
    if (v !== null && (f === 'value' || f === 'tol_abs' || f === 'tol_pct' || f === 'sig_figs')) v = Number(v);
    if (Array.isArray(v) && !v.length) v = null;
    out[f] = v;
  }
  return out;
};

/** True when two key rows say the same thing, so saving an unchanged key makes no new version. */
export const sameKey = (a, b) => JSON.stringify(normalizeKeyRow(a)) === JSON.stringify(normalizeKeyRow(b));

/** A question as the entry form holds it, from a stored question and its current key. */
export function questionFromRows(row, key) {
  const k = key || {};
  const str = (v) => v === null || v === undefined ? '' : String(v);
  return {
    id: row.id, qid: row.qid, format: row.format, prompt: row.prompt_md || '', points: str(row.points),
    unitHint: str(row.unit_hint), position: row.position, isRetired: row.is_retired === true,
    updatedAt: row.updated_at || null,         // sent back to save_question, unchanged, as the optimistic check
    choices: (row.choices || []).map(c => ({ id: c.id, text: c.text })),
    keyVersion: key ? key.version : null, keyId: key ? key.id : null,
    key: {
      correct: k.correct_choice_ids || [], value: str(k.value), tolAbs: str(k.tol_abs), tolPct: str(k.tol_pct),
      sigFigs: str(k.sig_figs), sigFigMode: k.sig_fig_mode || 'ignore', unit: str(k.unit),
      unitAliases: k.unit_aliases || [], unitMode: k.unit_mode || 'ignore', reference: str(k.reference_text),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Preview: how a question reads to a student. The key is never in this output.
 * ════════════════════════════════════════════════════════════════════════════ */

/** Escaped HTML for one question as a student would see it. Takes the entry-form shape; reads no key field. */
export function previewHtml(q, number = 1) {
  const text = esc(q.prompt || '').replace(/\n/g, '<br>');
  const pts = parseNumber(q.points);
  const ptsText = pts !== null && !Number.isNaN(pts) ? ` <span class="muted">(${esc(String(pts))} ${pts === 1 ? 'point' : 'points'})</span>` : '';
  let answer = '';
  if (q.format === 'multiple_choice' || q.format === 'multiple_select') {
    const type = q.format === 'multiple_choice' ? 'radio' : 'checkbox';
    answer = (q.choices || []).map(c =>
      `<label style="display:block;margin:4px 0"><input type="${type}" name="pv-${esc(q.qid || 'q')}" disabled> ${esc(c.text)}</label>`).join('');
    if (q.format === 'multiple_select') answer = `<div class="muted" style="font-size:0.84em">Select all that apply.</div>` + answer;
  } else if (q.format === 'numeric') {
    answer = `<input type="text" disabled placeholder="Your answer"> ${q.unitHint ? `<span class="muted">${esc(q.unitHint)}</span>` : ''}`;
  } else {
    answer = `<textarea disabled placeholder="Your answer" style="width:100%;min-height:70px"></textarea>`;
  }
  return `<div class="q-preview"><div style="font-weight:600">${number}. ${text}${ptsText}</div><div style="margin-top:8px">${answer}</div></div>`;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * CSV: parse, then plan. Both are pure.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Parse CSV text (RFC 4180: quoted cells, "" for a quote, line breaks inside quotes). A tab-separated paste
 * from a spreadsheet works too: the delimiter is a tab when the first line has a tab and no comma.
 * Returns { rows: string[][], lines: number[], error }. `lines[i]` is the line of the file on which row i begins,
 * counting blank lines, so a refusal names the row as the person sees it in a spreadsheet. A quote that never
 * closes is an error, not a guess.
 */
export function parseCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const firstLine = s.split(/\r\n|\n|\r/, 1)[0] || '';
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const all = [], allLines = [];
  let row = [], cell = '', inQuotes = false, i = 0, line = 1, quoteStart = 0, rowLine = 1;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); all.push(row); allLines.push(rowLine); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      if (ch === '\n') line++;
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; quoteStart = line; i++; continue; }
    if (ch === delim) { endCell(); i++; continue; }
    if (ch === '\r') { endRow(); line++; rowLine = line; i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); line++; rowLine = line; i++; continue; }
    cell += ch; i++;
  }
  if (inQuotes) return { rows: [], lines: [], error: `A quoted cell that starts on line ${quoteStart} never closes.` };
  if (cell !== '' || row.length) endRow();
  const rows = [], lines = [];
  all.forEach((r, n) => { if (r.some(c => String(c).trim() !== '')) { rows.push(r); lines.push(allLines[n]); } });
  return { rows, lines, error: null };
}

/**
 * Decode the bytes of a chosen file as UTF-8 and refuse anything else. Excel's plain "CSV (Comma delimited)" is saved
 * in an older code page, so a degree sign or a micro sign would arrive as a replacement mark and be stored; a strict
 * decode refuses the file instead. Returns { text, error }.
 */
export function decodeUtf8Strict(bytes) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), error: null };
  } catch {
    return { text: '', error: NOT_UTF8 };
  }
}
export const NOT_UTF8 = 'This file is not saved as UTF-8, so some characters could not be read: save it as "CSV UTF-8" in your spreadsheet program and choose it again.';

/** Column names the import understands, with the words a person might use for each. */
export const CSV_COLUMNS = {
  qid: ['qid', 'id', 'question id'],
  format: ['format', 'type', 'question type'],
  prompt: ['prompt', 'question', 'text', 'question text'],
  points: ['points', 'point', 'pts'],
  choices: ['choices', 'options', 'answers'],
  correct: ['correct', 'correct choice', 'correct choices', 'answer'],
  value: ['value', 'correct value', 'numeric answer'],
  tol_abs: ['tol_abs', 'tolerance', 'abs tolerance', 'absolute tolerance'],
  tol_pct: ['tol_pct', 'pct tolerance', 'percent tolerance', 'tolerance %'],
  sig_figs: ['sig_figs', 'sig figs', 'significant figures'],
  sig_fig_mode: ['sig_fig_mode', 'sig fig mode', 'sig figs mode'],
  unit: ['unit', 'units'],
  unit_aliases: ['unit_aliases', 'unit aliases', 'aliases'],
  unit_mode: ['unit_mode', 'unit mode'],
  unit_hint: ['unit_hint', 'unit hint'],
  reference: ['reference', 'reference_text', 'reference text', 'guidance'],
};
const REQUIRED_COLUMNS = ['format', 'prompt', 'points'];
const FORMAT_WORDS = {
  multiple_choice: 'multiple_choice', 'multiple choice': 'multiple_choice', mc: 'multiple_choice', choice: 'multiple_choice',
  multiple_select: 'multiple_select', 'multiple select': 'multiple_select', ms: 'multiple_select', select: 'multiple_select',
  numeric: 'numeric', number: 'numeric', num: 'numeric',
  prose: 'prose', text: 'prose', 'free response': 'prose',
};

const canonHeader = (h) => String(h).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Turn CSV text into a plan: every row, what it becomes, and every refusal. The whole file is refused when
 * any row is bad (`ok` false). Nothing here touches the database.
 *
 *   opts.grading      the path's grading
 *   opts.existing     the item's questions now (retired included), for the id rules and positions
 *
 * Returns { ok, fileErrors[], rows: [{ line, ok, problems[], question, columns, key }], toWrite }.
 */
export function planImport(text, { grading = 'auto_checked', existing = [] } = {}) {
  const plan = { ok: false, fileErrors: [], rows: [], toWrite: [] };
  const raw = String(text ?? '');
  if (!raw.trim()) { plan.fileErrors.push('The file is empty.'); return plan; }
  if (raw.length > MAX_IMPORT_CHARS) { plan.fileErrors.push(`The file is larger than ${MAX_IMPORT_CHARS} characters.`); return plan; }
  if (raw.includes('\uFFFD')) {
    const at = raw.split(/\r\n|\n|\r/).findIndex(l => l.includes('\uFFFD')) + 1;
    plan.fileErrors.push(`Line ${at} holds a character that could not be read, so the file was probably not saved as UTF-8: save it as "CSV UTF-8" in your spreadsheet program and import it again.`);
    return plan;
  }
  const parsed = parseCsv(raw);
  if (parsed.error) { plan.fileErrors.push(parsed.error); return plan; }
  if (parsed.rows.length < 2) { plan.fileErrors.push('The file needs a header row and at least one question.'); return plan; }
  if (parsed.rows.length - 1 > MAX_IMPORT_ROWS) { plan.fileErrors.push(`The file has more than ${MAX_IMPORT_ROWS} questions. Split it.`); return plan; }

  const header = parsed.rows[0].map(canonHeader);
  const colOf = {};
  const unknown = [];
  header.forEach((h, idx) => {
    const name = Object.keys(CSV_COLUMNS).find(k => CSV_COLUMNS[k].includes(h));
    if (!name) { if (h) unknown.push(parsed.rows[0][idx].trim()); return; }
    if (colOf[name] !== undefined) plan.fileErrors.push(`The column "${name}" appears twice in the header.`);
    colOf[name] = idx;
  });
  for (const r of REQUIRED_COLUMNS) if (colOf[r] === undefined) plan.fileErrors.push(`The header has no "${r}" column.`);
  if (unknown.length) plan.fileErrors.push(`Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Nothing is guessed; rename or remove ${unknown.length > 1 ? 'them' : 'it'}.`);
  if (plan.fileErrors.length) return plan;

  const get = (cells, name) => colOf[name] === undefined ? '' : String(cells[colOf[name]] ?? '').trim();
  const taken = new Set(existing.map(q => q.qid));
  const seen = new Set();
  const reserved = [];
  let position = existing.reduce((m, q) => Math.max(m, Number(q.position) || 0), 0);
  const pending = [];
  // Ids typed anywhere in the file are set aside first, so a blank id never takes one a later row spells out.
  const explicitIds = parsed.rows.slice(1).map(c => get(c, 'qid')).filter(Boolean);

  parsed.rows.slice(1).forEach((cells, i) => {
    const line = parsed.lines[i + 1];
    const row = { line, ok: false, problems: [], question: null };
    plan.rows.push(row);
    if (cells.length > header.length && cells.slice(header.length).some(c => String(c).trim() !== '')) {
      row.problems.push(`Row ${line} has ${cells.length} cells but the header has ${header.length}. A comma inside a cell needs quotes around the cell.`);
    }
    const fmtWord = get(cells, 'format').toLowerCase();
    const format = FORMAT_WORDS[fmtWord] || null;
    if (!format) row.problems.push(`Row ${line}: the format "${get(cells, 'format')}" is not multiple_choice, multiple_select, numeric or prose.`);

    const choiceTexts = splitList(get(cells, 'choices'));
    const q = {
      qid: get(cells, 'qid'), format: format || fmtWord, prompt: get(cells, 'prompt'), points: get(cells, 'points'),
      unitHint: get(cells, 'unit_hint'),
      choices: choiceTexts.map((t, idx) => ({ id: choiceIdFor(idx), text: t })),
      key: {
        correct: [], value: get(cells, 'value'), tolAbs: get(cells, 'tol_abs'), tolPct: get(cells, 'tol_pct'),
        sigFigs: get(cells, 'sig_figs'), sigFigMode: get(cells, 'sig_fig_mode').toLowerCase() || 'ignore',
        unit: get(cells, 'unit'), unitAliases: splitAliases(get(cells, 'unit_aliases')),
        unitMode: get(cells, 'unit_mode').toLowerCase() || 'ignore', reference: get(cells, 'reference'),
      },
    };
    // The correct cell names choices by letter (a, b ...) or by exact text, separated by | .
    for (const c of splitList(get(cells, 'correct'))) {
      const byId = q.choices.find(ch => ch.id === c.toLowerCase());
      const byText = q.choices.find(ch => ch.text.toLowerCase() === c.toLowerCase());
      const hit = byId || byText;
      if (byId && byText && byId.id !== byText.id) {
        row.problems.push(`Row ${line}: the correct choice "${c}" is ambiguous: it is the letter of one choice and the exact text of another. Reword one of the choices, then check the file again.`);
      } else if (hit) q.key.correct.push(hit.id);
      else row.problems.push(`Row ${line}: the correct choice "${c}" is not one of the choices (use a letter such as b, or the exact text).`);
    }
    // A question with no id gets the next free one; ids typed in the file are kept.
    if (!q.qid) { q.qid = nextQid(existing, [...reserved, ...explicitIds]); q.autoId = true; }
    reserved.push(q.qid);
    if (seen.has(q.qid)) row.problems.push(`Row ${line}: the id ${q.qid} appears twice in this file.`);
    seen.add(q.qid);
    if (taken.has(q.qid)) row.problems.push(`Row ${line}: the id ${q.qid} is already used in this item (retired questions keep their ids). The import only adds questions; change the id.`);

    if (format) row.problems.push(...checkQuestion(q, { grading, takenQids: [], isNew: false }).map(p => `Row ${line}: ${p}`));
    row.question = q;
    row.ok = row.problems.length === 0;
    if (row.ok) pending.push(q);
  });

  plan.ok = plan.rows.every(r => r.ok);
  if (plan.ok) {
    plan.toWrite = pending.map(q => ({ question: q, columns: questionColumns(q, ++position), key: keyColumns(q) }));
  }
  return plan;
}

/** A small example file: one of each kind, including a correct value of 0 with its absolute tolerance. */
export const EXAMPLE_CSV = [
  'qid,format,prompt,points,choices,correct,value,tol_abs,tol_pct,sig_figs,sig_fig_mode,unit,unit_aliases,unit_mode,unit_hint,reference',
  'speed,multiple_choice,"Which quantity is a vector?",1,Speed|Velocity|Distance|Time,b,,,,,,,,,,',
  'forces,multiple_select,"Select every force that acts on a block at rest on a table.",2,Weight|Normal force|Friction|Thrust,a|b,,,,,,,,,,',
  'accel,numeric,"A 2.0 kg block is pushed by a net force of 6.0 N. What is its acceleration?",2,,,3.0,,2,2,warn,m/s^2,m/s2|m s^-2,warn,m/s^2,',
  'net,numeric,"What is the net force on an object moving at constant velocity?",1,,,0,0.01,,,,N,,warn,N,',
].join('\n') + '\n';

/* ══════════════════════════════════════════════════════════════════════════════
 * Database: reading
 * ════════════════════════════════════════════════════════════════════════════ */

/** True when no answer reached the page (a dropped connection), so the outcome of a write is unknown. */
export function isLostResponse(error) {
  if (!error || error.code) return false;
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timed? ?out|fetch/i.test(String(error.message || error));
}

/** Turn an error into a sentence. The raw error is logged by the caller. */
export function questionError(error) {
  const raw = String(error?.message || error || 'Unknown error');
  if (error?.code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return 'You do not have permission to change this. Only a director of this course can.';
  }
  if (error?.code === '57014' || /statement timeout/i.test(raw)) {
    return 'The database took too long to answer. Wait a moment and try again.';
  }
  if (error?.code === '40001' || /changed since you opened/i.test(raw)) {
    return 'This question, or its answer key, was changed by someone else or in another window after you opened it. Nothing was saved. Close this window, reload the page, and make your change again.';
  }
  if (isLostResponse(error)) {
    return 'The connection dropped before an answer came back, so it is not known whether this was saved. Reload the page and look before you try again.';
  }
  if (error?.code === '23505' && /questions_activity_qid_key/.test(raw)) {
    return 'That question id is already used in this item. An id is never reused.';
  }
  if (error?.code === '23505') return 'Someone else changed this question at the same moment. Reload the page and try again.';
  if (/question_keys_zero_needs_abs/.test(raw)) {
    return 'A correct value of 0 needs an absolute tolerance, because a percentage of zero means nothing.';
  }
  if (/prose question/i.test(raw)) return 'Prose is never marked by a machine, so it cannot sit on an auto-checked item or carry a machine key.';
  if (/numeric\b.*(field overflow|out of range)|numeric field overflow/i.test(raw)) return 'A number is too large for its column.';
  if (error?.code === '42703' || error?.code === 'PGRST205' || /schema cache|does not exist/i.test(raw)) {
    return 'This database has not been upgraded for question entry yet. Nothing was changed.';
  }
  return raw.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this item');
}

const ITEM_SELECT =
  `id,points_possible,is_published,${NEW_PAGE_COLUMN},course_offering_id,assignments(title,slug),` +
  'offering_activities(position,delivery,grading,activities(id,slug,modality))';

/**
 * Load one item and what the page needs to decide whether questions can be entered on it.
 * Returns { error } or { item: { offeringId, title, slug, points, isNew, isPublished, paths[], path|null,
 *   activityId, grading, reason|null } }. `reason` says why questions cannot be entered, in words.
 */
export async function loadItem(db, offeringId) {
  const r = await db.from('assignment_offerings').select(ITEM_SELECT).eq('id', offeringId).maybeSingle();
  if (r.error) return { error: r.error };
  if (!r.data) return { item: null };
  const d = r.data;
  const paths = [...(d.offering_activities || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(p => ({ delivery: p.delivery, grading: p.grading, activityId: p.activities?.id, slug: p.activities?.slug, modality: p.activities?.modality }));
  const isNew = d[NEW_PAGE_COLUMN] === true;
  const path = paths.length === 1 ? paths[0] : null;
  let reason = null;
  if (!isNew) reason = 'This item was entered on the older page, so its questions are not edited here.';
  else if (d.is_published) reason = 'This item is published, so its questions cannot be changed here.';
  else if (!path) reason = 'Questions are entered on an item with exactly one path, delivered as questions on the site.';
  else if (path.delivery !== 'online_questions') reason = 'This item is not delivered as questions on the site, so it has no questions to enter.';
  return {
    item: {
      offeringId: d.id, title: d.assignments?.title || '', slug: d.assignments?.slug || '',
      points: Number(d.points_possible), isNew, isPublished: d.is_published === true,
      courseOfferingId: d.course_offering_id, paths, path,
      activityId: path?.activityId || null, grading: path?.grading || null, reason,
    },
  };
}

const QUESTION_COLUMNS = 'id,activity_id,qid,position,prompt_md,format,choices,points,unit_hint,is_retired,updated_at';
const KEY_COLUMNS = 'id,question_id,version,correct_choice_ids,select_rule,value,tol_abs,tol_pct,sig_figs,sig_fig_mode,unit,unit_aliases,unit_mode,reference_text,written_by,checked_by,checked_at,created_at,superseded_at';

/**
 * Every question of an activity with its CURRENT key, in order. All versions of a key are read, so the page can
 * show the version, and so a question whose current key is missing (an interrupted edit) still saves as the NEXT
 * version rather than colliding with its own history. `keyRow` is the current row or null; `maxVersion` is the
 * highest version ever written.
 */
export async function loadQuestions(db, activityId) {
  const qr = await db.from('questions').select(QUESTION_COLUMNS).eq('activity_id', activityId).order('position');
  if (qr.error) return { error: qr.error, questions: [] };
  const rows = qr.data || [];
  const current = {}, maxVersion = {};
  if (rows.length) {
    const kr = await db.from('question_keys').select(KEY_COLUMNS).in('question_id', rows.map(r => r.id));
    if (kr.error) return { error: kr.error, questions: [] };
    for (const k of kr.data || []) {
      if (k.superseded_at === null || k.superseded_at === undefined) current[k.question_id] = k;
      maxVersion[k.question_id] = Math.max(maxVersion[k.question_id] || 0, Number(k.version) || 0);
    }
  }
  const questions = rows.map(r => ({ ...questionFromRows(r, current[r.id]), keyRow: current[r.id] || null, maxVersion: maxVersion[r.id] || 0 }))
    .sort((a, b) => (a.position - b.position) || a.qid.localeCompare(b.qid, undefined, { numeric: true }));
  return { questions };
}

/** The item's points as the database now holds them (the questions own them on an auto_checked path). */
export async function loadPoints(db, offeringId) {
  const r = await db.from('assignment_offerings').select('points_possible').eq('id', offeringId).maybeSingle();
  if (r.error || !r.data) return null;
  return Number(r.data.points_possible);
}

/** Sum of unretired points, for the page's own cross-check against `loadPoints`. */
export const sumPoints = (questions) =>
  Math.round(questions.filter(q => !q.isRetired).reduce((s, q) => s + (num(q.points) || 0), 0) * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════════
 * Database: writing
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Every column of `question_keys` that is NOT NULL and has a default, spelled out. A bulk insert (the CSV import
 * sends many keys in one statement) turns a missing field into an explicit NULL, which the NOT NULL columns
 * refuse, so each key row names them all rather than relying on the database default.
 */
export const KEY_NOT_NULL_DEFAULTS = Object.freeze({
  select_rule: 'all_or_nothing', sig_fig_mode: 'ignore', unit_mode: 'ignore', written_by: 'human', variant_key: '',
});

/** A full key row for insert: the NOT NULL defaults, then the fields of this key. */
export const keyInsertRow = (questionId, version, cols) =>
  ({ ...KEY_NOT_NULL_DEFAULTS, question_id: questionId, version, ...cols });

async function insertKey(db, questionId, version, cols) {
  return db.from('question_keys').insert(keyInsertRow(questionId, version, cols));
}

/** Words for what is left in the database after a failed write, once it has been checked. */
export function outcomeText(left) {
  if (left === 0) return 'Nothing was kept.';
  if (left === null) return 'It could not be confirmed whether anything was kept. Reload the page and look at the question list before you try again.';
  return `${left} question${left === 1 ? '' : 's'} from this write ${left === 1 ? 'was' : 'were'} kept and could not be removed. Reload the page, then remove ${left === 1 ? 'it' : 'them'} or finish ${left === 1 ? 'it' : 'them'} by hand before you try again.`;
}

const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/**
 * Remove the questions a failed write may have left, then READ BACK what is still there. Returns how many remain,
 * or null when that could not be read. A delete that fails, or a read that fails, is never reported as clean.
 * The ids are found by qid because after a dropped connection the page may not know them.
 */
export async function removeLeftovers(db, activityId, qids) {
  let left = 0;
  for (const part of chunks(qids, 100)) {
    const sel = await db.from('questions').select('id').eq('activity_id', activityId).in('qid', part);
    if (sel.error) return null;
    const ids = (sel.data || []).map(r => r.id);
    if (!ids.length) continue;
    await db.from('questions').delete().in('id', ids);          // its result is not trusted: the read below decides
    const chk = await db.from('questions').select('id').eq('activity_id', activityId).in('qid', part);
    if (chk.error) return null;
    left += (chk.data || []).length;
  }
  return left;
}

/**
 * Add a question and its key. The key is written second; if it fails, the question is removed again, and the
 * removal is READ BACK. Returns { error, outcome } on failure, where `outcome` says what is left in plain words, or
 * { id, keyVersion }.
 */
export async function addQuestion(db, activityId, q, existing = []) {
  const position = existing.reduce((m, x) => Math.max(m, Number(x.position) || 0), 0) + 1;
  const cols = questionColumns(q, position);
  const ins = await db.from('questions').insert({ activity_id: activityId, ...cols }).select('id').single();
  if (ins.error) {
    // A coded error came from the database, which rolled the statement back. No code: the answer was lost.
    return ins.error.code ? { error: ins.error, outcome: outcomeText(0) }
      : { error: ins.error, outcome: outcomeText(await removeLeftovers(db, activityId, [cols.qid])) };
  }
  const id = ins.data.id;
  const key = keyColumns(q);
  if (!key) return { id, keyVersion: null };
  const k = await insertKey(db, id, 1, key);
  if (k.error) {
    await db.from('questions').delete().eq('id', id);
    return { error: k.error, outcome: outcomeText(await removeLeftovers(db, activityId, [cols.qid])) };
  }
  return { id, keyVersion: 1 };
}

/**
 * Save an edit, in ONE database call (save_question): the question row is updated, and the key is a NEW VERSION only
 * when it differs from the current one (the current row is superseded and version + 1 inserted) or when a prose
 * guidance was cleared (a new version with no text). The call is refused, with nothing saved, when the question or its
 * key changed since this page read it. Returns { error } or { keyVersion, newVersion }.
 */
export async function saveQuestion(db, q, previous) {
  const cols = questionColumns(q, previous.position);
  delete cols.qid; delete cols.format; delete cols.position;
  const current = previous.keyRow || null;
  const key = keyColumns(q);
  let writeKey = false, keyCols = null;
  if (key) {
    writeKey = !(current && sameKey(current, key));
    keyCols = key;
  } else if (q.format === 'prose' && current && !blank(current.reference_text)) {
    writeKey = true;                                  // the guidance was emptied: that is a change, kept as a new version
    keyCols = { reference_text: null };
  }
  const r = await db.rpc('save_question', {
    p_question: previous.id, p_expected_updated_at: previous.updatedAt, p_cols: cols,
    p_write_key: writeKey, p_key: keyCols, p_expected_key_version: current ? Number(current.version) : null,
  });
  if (r.error) return { error: r.error };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return { keyVersion: row ? row.key_version : null, newVersion: !!(row && row.new_version) };
}

/** Swap a question with its neighbour. `list` is the full ordered list; positions are renumbered 1..n. */
export async function moveQuestion(db, list, id, direction) {
  const order = list.map(q => q.id);
  const at = order.indexOf(id);
  const to = at + (direction === 'up' ? -1 : 1);
  if (at < 0 || to < 0 || to >= order.length) return { error: null, moved: false };
  [order[at], order[to]] = [order[to], order[at]];
  for (let i = 0; i < order.length; i++) {
    const want = i + 1;
    const q = list.find(x => x.id === order[i]);
    if (Number(q.position) === want) continue;
    const r = await db.from('questions').update({ position: want }).eq('id', q.id);
    if (r.error) return { error: r.error, moved: false };
  }
  return { error: null, moved: true };
}

/** Retire (keeps the row, so old attempts resolve and the id is never reused) or bring it back. */
export async function setRetired(db, id, retired) {
  return db.from('questions').update({ is_retired: !!retired }).eq('id', id);
}

/**
 * Remove a question. If attempts already point at it the database refuses the delete (RESTRICT); the question
 * is retired instead and the answer says so. Returns { error } or { removed } or { retired }.
 */
export async function removeQuestion(db, id) {
  const r = await db.from('questions').delete().eq('id', id);
  if (!r.error) return { removed: true };
  if (r.error.code === '23503' || /violates foreign key/i.test(String(r.error.message || ''))) {
    const s = await setRetired(db, id, true);
    return s.error ? { error: s.error } : { retired: true };
  }
  return { error: r.error };
}

/**
 * Write a planned import. The plan was already checked and the file already accepted as a whole. All the
 * questions go in one statement and all the keys in a second. If the keys fail, the questions just inserted are
 * removed again and the removal is READ BACK. Returns { count } or { error, outcome }, where `outcome` says in
 * plain words what is left in the database: nothing (verified), some questions, or unknown.
 */
export async function writeImport(db, activityId, plan) {
  if (!plan || !plan.ok || !plan.toWrite.length) return { error: { message: 'There is nothing to import.' }, outcome: outcomeText(0) };
  const qids = plan.toWrite.map(w => w.columns.qid);
  const qIns = await db.from('questions')
    .insert(plan.toWrite.map(w => ({ activity_id: activityId, ...w.columns }))).select('id,qid');
  if (qIns.error) {
    // One statement. A coded error means the database refused it and wrote nothing. No code: the answer was lost,
    // and the statement may have landed, so look.
    return qIns.error.code ? { error: qIns.error, outcome: outcomeText(0) }
      : { error: qIns.error, outcome: outcomeText(await removeLeftovers(db, activityId, qids)) };
  }
  const idByQid = Object.fromEntries((qIns.data || []).map(r => [r.qid, r.id]));
  const keys = plan.toWrite.filter(w => w.key).map(w => keyInsertRow(idByQid[w.columns.qid], 1, w.key));
  if (keys.some(k => !k.question_id)) {
    return { error: { message: 'The database did not return every question it stored, so the import was undone.' },
      outcome: outcomeText(await removeLeftovers(db, activityId, qids)) };
  }
  if (keys.length) {
    const kIns = await db.from('question_keys').insert(keys);
    if (kIns.error) return { error: kIns.error, outcome: outcomeText(await removeLeftovers(db, activityId, qids)) };
  }
  return { count: plan.toWrite.length };
}
