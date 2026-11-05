// faculty-scale.js — letter scale and near-line width for one course offering (faculty/scale.html), schema `app`.
//
// WHAT IT DOES
//   A director reads the scale in force (the default until a director changes something), edits the lines and the
//   near-line width, SEES who would change letter or flag, and saves. Saving makes a new version and retires the old
//   one. Design: docs/decisions/V2-DATA-MODEL.md section 11; the grade rules are in docs/decisions/GRADE-RULES.md.
//
// RULES IT KEEPS (the database enforces every one of them in letter_scale_is_valid, used in a CHECK; this file
// keeps the page from asking, and says why in a sentence)
//   * Not empty. Cutoffs strictly descending. The last cutoff exactly 0. Letters unique. GPA never increasing.
//   * Width at least 0 and below the smallest gap between two cutoffs, so only the next line up can ever apply.
//   * Editing makes a NEW VERSION: the current row gets retired_at, a new row is inserted with the next number.
//     Nothing is overwritten. An offering with no unretired row uses the default scale. The two steps are ONE
//     database function (save_letter_scale, migration app/041), so a dropped connection or a refusal cannot leave
//     the offering with no scale in force. It also refuses when the version in force is not the one the page showed.
//   * On an ACTIVE offering a save is allowed only after the effect of exactly this scale has been shown
//     (scale_change_preview, directors only, saves nothing). Change one box and the preview is stale again.
//   * Nothing here moves a total. Totals are computed from the scale at read time; saving a scale changes the
//     letter a cadet sees, never earned or possible.
//
// HOW IT IS BUILT
//   Everything that decides is pure and exact: decimals are read as integers (thousandths for cutoffs and width,
//   hundredths for GPA) so 89.9 never meets floating point. The database functions take the client first, so
//   tests/app-schema/test-faculty-scale.mjs drives them with a recording stub.

import { esc } from './util.js';

export const MAX_LINES = 30;
/** The default scale from GRADE-RULES.md. Must equal default_letter_scale() in migration 032; a test reads both. */
export const DEFAULT_LINES = [
  { letter: 'A', cutoff: 93, gpa: 4.0 }, { letter: 'A-', cutoff: 90, gpa: 3.7 },
  { letter: 'B+', cutoff: 87, gpa: 3.3 }, { letter: 'B', cutoff: 83, gpa: 3.0 },
  { letter: 'B-', cutoff: 80, gpa: 2.7 }, { letter: 'C+', cutoff: 77, gpa: 2.3 },
  { letter: 'C', cutoff: 73, gpa: 2.0 }, { letter: 'C-', cutoff: 70, gpa: 1.7 },
  { letter: 'D', cutoff: 60, gpa: 1.0 }, { letter: 'F', cutoff: 0, gpa: 0.0 },
];
export const DEFAULT_WIDTH = 0.1;

// ---------------------------------------------------------------------------------------------------------------
// exact decimals

/**
 * Read a decimal typed by a person as an integer count of 10^-places. Returns { ok, n } or { ok:false, error }.
 * `what` names the box in the sentence. No exponent, no commas, no sign other than a refusal of a minus.
 */
export function readDecimal(text, places, what) {
  const t = String(text ?? '').trim();
  if (t === '') return { ok: false, error: `${what} is empty.` };
  if (/^-/.test(t)) return { ok: false, error: `${what} cannot be negative.` };
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return { ok: false, error: `${what} must be a plain number such as 93 or 89.5.` };
  const [whole, frac = ''] = t.split('.');
  if (frac.length > places) {
    return { ok: false, error: `${what} can have ${places === 1 ? 'one decimal place' : places + ' decimal places'} at most.` };
  }
  if (whole.length > 6) return { ok: false, error: `${what} is too large.` };
  return { ok: true, n: Number(whole || '0') * 10 ** places + Number((frac + '0'.repeat(places)).slice(0, places) || '0') };
}

/** An integer count of 10^-places back to the shortest decimal text, 93000 -> "93", 89900 -> "89.9". */
export function showDecimal(n, places) {
  const s = String(Math.abs(n)).padStart(places + 1, '0');
  const whole = s.slice(0, s.length - places), frac = s.slice(s.length - places).replace(/0+$/, '');
  return (n < 0 ? '-' : '') + whole + (frac ? '.' + frac : '');
}

const CUT = 3, GPA = 2, WID = 3;

/**
 * Check the editor's rows, in the database's own terms. `rows` is [{letter, cutoff, gpa}] with text values.
 * Returns { errors: string[], lines, width } — lines and width only when there are no errors. Each sentence names
 * the line it is about, by position and letter, so a person can find the box.
 */
export function validateScale(rows, widthText) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { errors: ['The scale needs at least one line. The last line must start at 0.'] };
  }
  if (rows.length > MAX_LINES) errors.push(`A scale can have ${MAX_LINES} lines at most.`);
  const lines = [], seen = new Set();
  let prevCut = null, prevGpa = null, minGap = null, lastCut = null;
  rows.forEach((r, i) => {
    const n = i + 1;
    const letter = String(r.letter ?? '').trim();      // " A" and "A" are one letter, not two
    const tag = letter.trim() ? `Line ${n} (${letter.trim()})` : `Line ${n}`;
    if (letter.trim() === '') { errors.push(`Line ${n} has no letter.`); }
    else if (letter.length > 8) errors.push(`${tag}: a letter can have 8 characters at most.`);
    else if (seen.has(letter)) errors.push(`${tag}: the letter ${letter} is used twice. Each letter appears once.`);
    seen.add(letter);
    const c = readDecimal(r.cutoff, CUT, `${tag}: the cutoff`);
    const g = readDecimal(r.gpa, GPA, `${tag}: the GPA`);
    if (!c.ok) errors.push(c.error);
    if (!g.ok) errors.push(g.error);
    if (c.ok) {
      if (prevCut !== null && c.n >= prevCut) {
        errors.push(`${tag}: the cutoff ${showDecimal(c.n, CUT)} must be lower than the line above it, ${showDecimal(prevCut, CUT)}. Cutoffs go from high to low.`);
      } else if (prevCut !== null) {
        minGap = minGap === null ? prevCut - c.n : Math.min(minGap, prevCut - c.n);
      }
      prevCut = c.n; lastCut = c.n;
    }
    if (g.ok) {
      if (prevGpa !== null && g.n > prevGpa) {
        errors.push(`${tag}: the GPA ${showDecimal(g.n, GPA)} is higher than the line above it, ${showDecimal(prevGpa, GPA)}. A lower line cannot be worth more.`);
      }
      prevGpa = g.n;
    }
    if (c.ok && g.ok && letter.trim() !== '') lines.push({ letter, cutoff: c.n / 10 ** CUT, gpa: g.n / 10 ** GPA });
  });
  if (lastCut !== null && lastCut !== 0) {
    errors.push(`The last line must have a cutoff of exactly 0, so every score lands on a letter. It is ${showDecimal(lastCut, CUT)}.`);
  }
  const w = readDecimal(widthText, WID, 'The near-line width');
  if (!w.ok) errors.push(w.error);
  else if (minGap !== null && w.n >= minGap && errors.length === 0) {
    errors.push(`The near-line width ${showDecimal(w.n, WID)} must be below the smallest gap between two cutoffs, which is ${showDecimal(minGap, CUT)}. Otherwise a score could be near two lines at once.`);
  }
  if (errors.length) return { errors };
  return { errors: [], lines, width: w.n / 10 ** WID };
}

/** Rows (text) for the editor from stored lines. */
export function rowsFromLines(lines) {
  return (lines || []).map(l => ({ letter: String(l.letter), cutoff: showNumber(l.cutoff), gpa: gpaText(l.gpa) }));
}
const showNumber = (v) => showDecimal(Math.round(Number(v) * 10 ** CUT), CUT);
const gpaText = (v) => showDecimal(Math.round(Number(v) * 10 ** GPA), GPA);
export const widthText = (w) => showDecimal(Math.round(Number(w) * 10 ** WID), WID);

/** True when two scales are the same lines in the same order with the same width. */
export function sameScale(a, b) {
  if (!a || !b || a.lines.length !== b.lines.length) return false;
  if (Math.round(Number(a.width) * 1000) !== Math.round(Number(b.width) * 1000)) return false;
  return a.lines.every((l, i) => l.letter === b.lines[i].letter
    && Math.round(Number(l.cutoff) * 1000) === Math.round(Number(b.lines[i].cutoff) * 1000)
    && Math.round(Number(l.gpa) * 100) === Math.round(Number(b.lines[i].gpa) * 100));
}

/** A stable text for a scale, used to tell whether the preview on screen is for exactly this scale. */
export function scaleKey(scale) {
  return JSON.stringify([Math.round(Number(scale.width) * 1000),
    scale.lines.map(l => [l.letter, Math.round(Number(l.cutoff) * 1000), Math.round(Number(l.gpa) * 100)])]);
}

/** What changed between two scales, as short sentences. */
export function describeChange(oldScale, newScale) {
  const out = [];
  const oldBy = new Map(oldScale.lines.map(l => [l.letter, l]));
  const newBy = new Map(newScale.lines.map(l => [l.letter, l]));
  for (const l of newScale.lines) {
    const o = oldBy.get(l.letter);
    if (!o) out.push(`${l.letter} is a new line at ${showNumber(l.cutoff)}.`);
    else {
      if (Math.round(o.cutoff * 1000) !== Math.round(l.cutoff * 1000)) out.push(`${l.letter} moves from ${showNumber(o.cutoff)} to ${showNumber(l.cutoff)}.`);
      if (Math.round(o.gpa * 100) !== Math.round(l.gpa * 100)) out.push(`${l.letter} GPA goes from ${gpaText(o.gpa)} to ${gpaText(l.gpa)}.`);
    }
  }
  for (const l of oldScale.lines) if (!newBy.has(l.letter)) out.push(`${l.letter} is removed.`);
  if (Math.round(oldScale.width * 1000) !== Math.round(newScale.width * 1000)) {
    out.push(`The near-line width goes from ${widthText(oldScale.width)} to ${widthText(newScale.width)} points.`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the letter rule, exact, for the "try a score" box. The database owns the real answer (_letter_for); this is the
// same arithmetic so a director can see what a width does before running the preview. Tests hold the two together.

/**
 * Letter, GPA and near-line letter for earned and possible points, given validated lines and width.
 * earned/possible are text with up to 4 decimals. Returns { letter, gpa, near } or { error }.
 */
export function letterFor(earnedText, possibleText, lines, width) {
  const e = readDecimal(earnedText, 4, 'Points earned');
  const p = readDecimal(possibleText, 4, 'Points possible');
  if (!e.ok) return { error: e.error };
  if (!p.ok) return { error: p.error };
  if (p.n === 0) return { letter: null, gpa: null, near: null };   // never divide; the database does the same
  const E = BigInt(e.n), P = BigInt(p.n);                          // both in 10^-4
  const lhs = E * 100n * 1000n;                                    // earned*100 in units of 10^-7
  const cuts = lines.map(l => ({ ...l, C: BigInt(Math.round(l.cutoff * 1000)) })).sort((a, b) => (a.C > b.C ? -1 : a.C < b.C ? 1 : 0));
  const hit = cuts.find(l => lhs >= l.C * P);
  const W = BigInt(Math.round(width * 1000));
  const near = [...cuts].reverse().find(l => (l.C - W) * P <= lhs && lhs < l.C * P);
  return { letter: hit ? hit.letter : null, gpa: hit ? hit.gpa : null, near: near ? near.letter : null };
}

// ---------------------------------------------------------------------------------------------------------------
// the preview

/**
 * Summarise scale_change_preview rows: who changes letter, who gains or loses a near-line flag.
 * Returns { total, letterMoves: [{from,to,count}], nearGained, nearLost, rows }.
 */
export function summarizePreview(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const moves = new Map();
  let nearGained = 0, nearLost = 0, letterChanged = 0;
  for (const r of list) {
    if ((r.old_letter ?? null) !== (r.new_letter ?? null)) {
      letterChanged++;
      const k = `${r.old_letter ?? 'none'}\u0000${r.new_letter ?? 'none'}`;
      moves.set(k, (moves.get(k) || 0) + 1);
    }
    const o = r.old_near_line_letter ?? null, n = r.new_near_line_letter ?? null;
    if (o === null && n !== null) nearGained++;
    else if (o !== null && n === null) nearLost++;
  }
  const letterMoves = [...moves.entries()].map(([k, count]) => {
    const [from, to] = k.split('\u0000'); return { from, to, count };
  }).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
  return { total: list.length, letterChanged, letterMoves, nearGained, nearLost,
    rows: [...list].sort((a, b) => Number(a.student_id) - Number(b.student_id)) };
}

/** One sentence for the headline of a preview. */
export function previewSentence(sum) {
  if (sum.total === 0) return 'No cadet changes letter or near-line flag under this scale.';
  const parts = [];
  if (sum.letterChanged) parts.push(`${sum.letterChanged} cadet${sum.letterChanged === 1 ? '' : 's'} would change letter`);
  if (sum.nearGained) parts.push(`${sum.nearGained} would become near a line`);
  if (sum.nearLost) parts.push(`${sum.nearLost} would stop being near a line`);
  if (!parts.length) {
    return `${sum.total} cadet${sum.total === 1 ? '' : 's'} would keep ${sum.total === 1 ? 'the' : 'their'} letter but be near a different line.`;
  }
  return parts.join('; ') + '.';
}

// ---------------------------------------------------------------------------------------------------------------
// the decision to save

/**
 * Decide whether a save may go ahead. Pure.
 *   scale       { lines, width } validated, or null when the form has errors
 *   current     the scale in force { lines, width, isDefault }
 *   isActive    the offering is the active one for its course (its cadets are using it now)
 *   previewKey  scaleKey of the scale the preview on screen was run for, or null
 * Returns { ok, reason }.
 */
export function planSave({ scale, current, isActive, previewKey }) {
  if (!scale) return { ok: false, reason: 'Fix the problems listed above first.' };
  if (current && sameScale(scale, current)) return { ok: false, reason: 'This is the scale already in force. Nothing to save.' };
  if (isActive && previewKey !== scaleKey(scale)) {
    return { ok: false, reason: 'This course is active, so its cadets are using the scale now. Show the effect of exactly this scale first.' };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------------------------------------------
// refusals in a sentence

/** True when no answer reached the page (a dropped connection), so the outcome of a write is unknown. */
export function isLostResponse(error) {
  if (!error || error.code) return false;
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timed? ?out|fetch/i.test(String(error.message || error));
}

export function scaleError(error) {
  const raw = String(error?.message || error || 'Unknown error');
  if (error?.code === '42501' || /row-level security|permission denied|not permitted/i.test(raw)) {
    return 'You do not have permission to change the scale. Only a director of this course can.';
  }
  if (error?.code === '57014' || /statement timeout/i.test(raw)) {
    return 'The database took too long to answer, so nothing was saved or shown. Nothing was changed. Wait a moment and try again.';
  }
  if (/letter_scales_valid_ck|not a usable scale|letter_scale_is_valid/i.test(raw) || error?.code === '23514') {
    return 'The database refused this scale: cutoffs must run high to low and end at 0, each letter once, GPA never rising, and the width must be below the smallest gap between cutoffs.';
  }
  if (error?.code === '40001' || /changed since you opened/i.test(raw)) {
    return 'The scale in force changed after you opened this page (someone saved in another window). Nothing was saved. Reload the page, look at the scale now in force, and try again.';
  }
  if (error?.code === '23505') return 'Someone saved a scale for this course a moment ago. Nothing was saved. Reload the page, look at the scale now in force, and try again.';
  if (isLostResponse(error)) {
    return 'The connection dropped before an answer came back, so it is not known whether this was saved. Reload the page and look at the scale in force before you try again.';
  }
  if (error?.code === '42703' || error?.code === 'PGRST205' || error?.code === '42883' || /schema cache|does not exist/i.test(raw)) {
    return 'This database has not been upgraded for letter scales yet. Nothing was changed.';
  }
  return raw.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this course');
}

// ---------------------------------------------------------------------------------------------------------------
// the database

const asScale = (row) => ({ lines: row.lines, width: Number(row.near_line_width), version: row.version, isDefault: !!row.is_default });

/** The scale in force, its history, and whether the offering is active. */
export async function loadScale(db, offeringId) {
  const cur = await db.rpc('current_letter_scale', { p_course_offering: offeringId });
  if (cur.error) return { error: cur.error };
  const row = Array.isArray(cur.data) ? cur.data[0] : cur.data;
  if (!row) return { error: { message: 'No scale came back.' } };
  const hist = await db.from('letter_scales')
    .select('id,version,lines,near_line_width,created_at,retired_at')
    .eq('course_offering_id', offeringId).order('version', { ascending: false });
  if (hist.error) return { error: hist.error };
  const off = await db.from('course_offerings').select('id,is_active').eq('id', offeringId).maybeSingle();
  if (off.error) return { error: off.error };
  const history = hist.data || [];
  const open = history.find(h => h.retired_at === null) || null;
  return {
    current: asScale(row),
    history,
    currentRowId: open ? open.id : null,
    maxVersion: history.reduce((m, h) => Math.max(m, h.version), 0),
    // No row back means the state is unknown; treat that as active, so the preview is still required.
    isActive: off.data ? !!off.data.is_active : true,
  };
}

/** Who would change letter or near-line flag. Saves nothing. */
export async function previewScale(db, offeringId, scale) {
  const r = await db.rpc('scale_change_preview', { p_course_offering: offeringId, p_lines: scale.lines, p_width: scale.width });
  if (r.error) return { error: r.error };
  return { rows: r.data || [] };
}

/**
 * Save a scale as the next version, in ONE database call (save_letter_scale): it retires the scale in force, inserts
 * the new row, and does both or neither. `state` is what loadScale returned; its version is sent back so the database
 * can refuse when someone else saved in between. The author is stamped from the sign-in by a trigger, so it is not sent.
 * Returns { error } or { saved: true, version }. An error with a code means the database answered and rolled back; an
 * error with no code (a dropped connection) means the outcome is unknown, and scaleError says so.
 */
export async function saveScale(db, offeringId, scale, state) {
  const r = await db.rpc('save_letter_scale', {
    p_course_offering: offeringId, p_lines: scale.lines, p_width: scale.width,
    p_expected_version: state.current && !state.current.isDefault ? state.current.version : 0,
  });
  if (r.error) return { error: r.error };
  const version = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!Number.isInteger(Number(version))) return { error: { message: 'The database did not say which version was saved. Reload the page and check.' } };
  return { saved: true, version: Number(version) };
}

// ---------------------------------------------------------------------------------------------------------------
// rendering helpers shared by the page and tests

export function previewHtml(sum) {
  const moves = sum.letterMoves.map(m => `<li>${esc(m.from)} to ${esc(m.to)}: ${m.count}</li>`).join('');
  const rows = sum.rows.slice(0, 200).map(r => `<tr><td>${esc(r.student_id)}</td><td>${esc(r.percent_text ?? '')}</td>
    <td>${esc(r.old_letter ?? 'none')}</td><td>${esc(r.new_letter ?? 'none')}</td>
    <td>${esc(r.old_near_line_letter ?? '')}</td><td>${esc(r.new_near_line_letter ?? '')}</td></tr>`).join('');
  return `<p><strong>${esc(previewSentence(sum))}</strong></p>${moves ? `<ul>${moves}</ul>` : ''}
    ${sum.rows.length ? `<table class="table"><thead><tr><th>Cadet</th><th>Percent</th><th>Letter now</th><th>Letter then</th><th>Near line now</th><th>Near line then</th></tr></thead><tbody>${rows}</tbody></table>
    ${sum.rows.length > 200 ? `<p class="muted">The first 200 of ${sum.rows.length} are listed.</p>` : ''}` : ''}`;
}
