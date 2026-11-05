// faculty-entry-parse.js — the pure rules behind score entry and grade-file import.
//
// No network and no page: this module only turns text into a plan. It is tested offline
// (tests/app-schema/test-faculty-entry-parse.mjs) and the entry page does nothing else with a file.
//
// WHY EVERYTHING IS COUNTED IN HUNDREDTHS
//   A score has at most two decimals (the grades column is numeric(6,2)). Floating point would let
//   0.1 + 0.2 stand in for a score, so a score here is an integer count of hundredths ("cents")
//   from the moment it is read. A third decimal is refused, never rounded: a silent round would
//   put a different number in the gradebook than the file the instructor holds.
//
// THE FORMATS
//   Gradescope, one assignment   SID, Total Score, Max Points, Status, ...        (one score column)
//   Gradescope, whole course     First Name, Last Name, SID, Email, ... then <Name>, <Name> - Max Points, ...
//   Teams                        First Name, Last Name, Email Address, then <Name>, Points, Feedback triplets
//   These follow the comparison gradebook's importers. One deliberate difference: a Gradescope
//   "Missing" or "Ungraded" row is left BLANK here, not turned into a 0. In this system a blank is
//   awaiting entry, and it becomes a 0 when the instructor closes the column; storing a 0 now would
//   make late work arrive on top of a stored zero and would stop a blank from meaning anything.
//   A Teams "Feedback" column is read and dropped: a points grade has nowhere to keep it.

import { parseDelimited, sniffDelimiter } from './roster-import.js';

/* ---------------------------------------------------------------------------------------------
 * Scores
 * ------------------------------------------------------------------------------------------- */

/**
 * Read one score cell.
 *   blank            -> { ok: true, blank: true }
 *   "12", "12.5"     -> { ok: true, cents: 1250 }
 *   anything else    -> { ok: false, reason }
 * Trailing zeros past two places are exact ("12.500" is 12.50); a real third decimal is refused.
 */
export function parseScore(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: true, blank: true };
  const m = /^(\d+)?(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === undefined && (m[2] === undefined || m[2] === ''))) {
    return { ok: false, reason: `"${s.slice(0, 20)}" is not a plain number` };
  }
  const whole = m[1] ?? '0';
  let frac = m[2] ?? '';
  if (frac.length > 2) {
    if (/[1-9]/.test(frac.slice(2))) return { ok: false, reason: `"${s.slice(0, 20)}" has more than two decimals` };
    frac = frac.slice(0, 2);
  }
  frac = (frac + '00').slice(0, 2);
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents > 99999999) return { ok: false, reason: `"${s.slice(0, 20)}" is too large` };
  return { ok: true, cents };
}

/** 1250 -> "12.5", 1200 -> "12", 5 -> "0.05". Exact; the inverse of parseScore for display. */
export function centsText(c) {
  if (c == null) return '';
  const whole = Math.trunc(c / 100);
  const frac = String(c % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** A numeric string from the database ("12.50", "7") to hundredths, or null. */
export function dbCents(v) {
  if (v == null || v === '') return null;
  const r = parseScore(String(v));
  return r.ok && !r.blank ? r.cents : null;
}

/**
 * Check one typed score against one item. `item` is { pointsCents, bonus }.
 *   -> { ok: true, blank: true } | { ok: true, cents } | { ok: false, reason }
 * A score above the item's points is refused unless the item is a bonus, which is the same line the
 * database draws (grades_within_bounds, widened only for a bonus item).
 */
export function checkCell(raw, item) {
  const r = parseScore(raw);
  if (!r.ok || r.blank) return r;
  if (item && !item.bonus && item.pointsCents != null && r.cents > item.pointsCents) {
    return { ok: false, reason: `${centsText(r.cents)} is more than the ${centsText(item.pointsCents)} points this item is worth` };
  }
  return r;
}

/* ---------------------------------------------------------------------------------------------
 * Reading a file
 * ------------------------------------------------------------------------------------------- */

const norm = (h) => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase();
const clean = (v) => String(v ?? '').trim();

/** "3001234567.0" (an Excel habit) -> "3001234567"; non-digits -> ''. */
export function normalizeId(raw) {
  const s = clean(raw).replace(/\.0+$/, '');
  return /^\d{6,12}$/.test(s) ? s : '';
}

/**
 * Which export is this? Looks only at the header row.
 *   'gradescope-assignment' | 'gradescope-course' | 'teams' | null
 */
export function detectFormat(header) {
  const h = header.map(norm);
  if (h.length >= 6 && h[0] === 'first name' && h[1] === 'last name' && h[2] === 'email address') {
    const rest = h.slice(3);
    if (rest.length % 3 === 0 && rest.length > 0 && rest.every((x, i) => i % 3 !== 1 || x === 'points')) return 'teams';
  }
  if (h.includes('sid') && h.includes('total score')) return 'gradescope-assignment';
  if (h.includes('sid') && h.some(x => x.endsWith(' - max points'))) return 'gradescope-course';
  return null;
}

/**
 * Parse the text of a grade file.
 *   -> { error } | { format, columns: [{ key, name, maxCents }], rows: [{ rowNo, sid, email, first, last, name, cells: [raw...] }], notes: [] }
 * `rowNo` is the 1-based line number in the file, header included, so a message points at the line a
 * person sees in a spreadsheet.
 */
export function parseGradeFile(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (!src.trim()) return { error: 'The file is empty.' };
  const rows = parseDelimited(src, sniffDelimiter(src));
  if (!rows.length) return { error: 'The file is empty.' };
  const header = rows[0];
  const body = rows.slice(1);
  const format = detectFormat(header);
  if (!format) {
    return { error: 'This is not a Gradescope or Teams grade export. Gradescope needs "SID" and "Total Score" columns (or "SID" and "<name> - Max Points" columns). Teams needs "First Name, Last Name, Email Address" followed by "<name>, Points, Feedback" columns.' };
  }
  const notes = [];
  const h = header.map(norm);
  const cell = (r, i) => (i == null || i < 0 ? '' : clean(r[i]));
  const out = [];

  if (format === 'teams') {
    const n = (header.length - 3) / 3;
    const columns = [];
    for (let i = 0; i < n; i++) columns.push({ key: `c${i}`, name: clean(header[3 + i * 3]), maxCents: null, idx: 3 + i * 3 });
    body.forEach((r, k) => {
      const first = cell(r, 0), last = cell(r, 1), email = cell(r, 2);
      if (!first && !last && !email) return;
      out.push({ rowNo: k + 2, sid: '', email, first, last, name: `${first} ${last}`.trim(), cells: columns.map(c => cell(r, c.idx)) });
    });
    // The "Points" cell of a triplet is the maximum for that assignment.
    columns.forEach(c => {
      const maxes = new Set();
      body.forEach(r => { const p = parseScore(cell(r, c.idx + 1)); if (p.ok && !p.blank) maxes.add(p.cents); });
      if (maxes.size === 1) c.maxCents = [...maxes][0];
      else if (maxes.size > 1) notes.push(`"${c.name}": the maximum differs between rows, so it is not used to check scores.`);
    });
    notes.push('Teams feedback text is not imported: a points grade has nowhere to keep it.');
    return { format, columns: columns.map(({ idx, ...c }) => c), rows: out, notes };
  }

  const iSid = h.indexOf('sid'), iEmail = h.indexOf('email');
  const iFirst = h.indexOf('first name'), iLast = h.indexOf('last name'), iName = h.indexOf('name');
  const pushRow = (r, k, cells) => {
    const first = cell(r, iFirst), last = cell(r, iLast);
    const name = iName >= 0 && cell(r, iName) ? cell(r, iName) : `${first} ${last}`.trim();
    const sidRaw = cell(r, iSid), sid = normalizeId(sidRaw), email = cell(r, iEmail);
    if (!sid && !sidRaw && !email && !name) return;
    // `sidRaw` is kept because an ID cell that held something unreadable (Excel's 3.00E+09) is a claim about
    // WHO this row is. It must not be read as "no ID" and allowed to fall through to a name.
    out.push({ rowNo: k + 2, sid, sidRaw, email, first, last, name, cells });
  };

  if (format === 'gradescope-assignment') {
    const iScore = h.indexOf('total score'), iMax = h.indexOf('max points'), iStatus = h.indexOf('status');
    const maxes = new Set();
    let blanked = 0;
    body.forEach((r, k) => {
      let score = cell(r, iScore);
      const status = norm(cell(r, iStatus));
      if (status === 'missing' || status === 'ungraded') { if (score !== '') blanked++; score = ''; }
      const m = parseScore(cell(r, iMax));
      if (m.ok && !m.blank) maxes.add(m.cents);
      pushRow(r, k, [score]);
    });
    if (blanked) notes.push(`${blanked} row(s) marked Missing or Ungraded were left blank rather than set to 0. A blank becomes 0 when you close the column.`);
    const col = { key: 'c0', name: 'Total Score', maxCents: maxes.size === 1 ? [...maxes][0] : null };
    if (maxes.size > 1) notes.push('Max Points differs between rows, so it is not used to check scores.');
    return { format, columns: [col], rows: out, notes, singleColumn: true };
  }

  // gradescope-course
  const idxs = [];
  h.forEach((x, i) => { if (x.endsWith(' - max points')) { const base = x.slice(0, -' - max points'.length); const j = h.indexOf(base); if (j >= 0) idxs.push({ j, m: i }); } });
  const columns = idxs.map((c, n) => ({ key: `c${n}`, name: clean(header[c.j]), maxCents: null, idx: c.j, midx: c.m }));
  body.forEach((r, k) => pushRow(r, k, columns.map(c => cell(r, c.idx))));
  columns.forEach(c => {
    const maxes = new Set();
    body.forEach(r => { const p = parseScore(cell(r, c.midx)); if (p.ok && !p.blank) maxes.add(p.cents); });
    if (maxes.size === 1) c.maxCents = [...maxes][0];
  });
  return { format, columns: columns.map(({ idx, midx, ...c }) => c), rows: out, notes };
}

/* ---------------------------------------------------------------------------------------------
 * Matching file rows to the roster
 * ------------------------------------------------------------------------------------------- */

const fold = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const nameKeys = (s) => {
  const t = fold(s);
  if (!t) return [];
  if (t.includes(',')) { const [l, ...f] = t.split(','); return [`${f.join(' ').trim()} ${l.trim()}`.trim()]; }
  return [t];
};

/**
 * Match every file row to one counted enrollment.
 *
 * roster: [{ enrollmentId, studentId, name, email, status }] for the course offering. Only `active`
 * and `completed` enrollments are counted in a total, so only those can be written to; a cadet who
 * appears only as `dropped` is reported as such rather than silently skipped.
 *
 * Order: cadet ID, then email, then a full name that is unique on the roster. A name match is
 * reported as such so a person sees the weakest kind of match.
 *
 * A row that CLAIMS a cadet ID (a readable one, or a cell that held something unreadable) is matched by
 * that ID or not at all. An ID that matches nobody does not fall through to the email or the name: two
 * cadets can share a name, and the ID is the one thing in the file that says which of them this is.
 *
 * -> { matches: [{ rowNo, enrollmentId, method }], unmatched: [{ rowNo, name, reason }],
 *      duplicates: [{ enrollmentId, name, rowNos }] }
 */
export function matchRoster(rows, roster) {
  const counted = roster.filter(r => r.status === 'active' || r.status === 'completed');
  const byId = new Map(), byEmail = new Map(), byName = new Map();
  const add = (m, k, e) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(e); };
  for (const e of counted) {
    add(byId, String(e.studentId ?? ''), e);
    add(byEmail, fold(e.email), e);
    for (const k of nameKeys(e.name)) add(byName, k, e);
  }
  const droppedIds = new Set(roster.filter(r => r.status === 'dropped').map(r => String(r.studentId ?? '')));
  const droppedEmails = new Set(roster.filter(r => r.status === 'dropped').map(r => fold(r.email)).filter(Boolean));
  const unique = (list) => (list && new Set(list.map(e => e.enrollmentId)).size === 1 ? list[0] : null);

  const matches = [], unmatched = [];
  for (const r of rows) {
    const label = r.name || r.email || r.sid || '(blank row)';
    let hit = null, method = null;
    const tryHit = (list, how) => { if (hit) return; const u = unique(list); if (u) { hit = u; method = how; } };
    const claimsId = !!(r.sid || String(r.sidRaw ?? '').trim());
    if (r.sid) tryHit(byId.get(r.sid), 'cadet ID');
    if (!claimsId && !hit && r.email) tryHit(byEmail.get(fold(r.email)), 'email');
    if (!claimsId && !hit) { for (const k of [fold(r.name), fold(`${r.first} ${r.last}`), ...nameKeys(r.name)]) { if (k) tryHit(byName.get(k), 'name'); if (hit) break; } }
    if (hit) { matches.push({ rowNo: r.rowNo, enrollmentId: hit.enrollmentId, method }); continue; }
    let reason = 'not on this course roster';
    if (claimsId && !r.sid) reason = 'the cadet ID cell cannot be read as an ID';
    else if (claimsId && !byId.get(r.sid)?.length && !droppedIds.has(r.sid)) reason = 'the cadet ID matches nobody on this roster';
    else if ((r.sid && byId.get(r.sid)?.length > 1) || (r.email && byEmail.get(fold(r.email))?.length > 1)) reason = 'matches more than one counted enrollment';
    else if ((r.sid && droppedIds.has(r.sid)) || (r.email && droppedEmails.has(fold(r.email)))) reason = 'only a dropped enrollment';
    unmatched.push({ rowNo: r.rowNo, name: label, reason });
  }

  const seen = new Map();
  for (const m of matches) (seen.get(m.enrollmentId) || seen.set(m.enrollmentId, []).get(m.enrollmentId)).push(m.rowNo);
  const nameOf = new Map(counted.map(e => [e.enrollmentId, e.name]));
  const duplicates = [...seen].filter(([, n]) => n.length > 1)
    .map(([enrollmentId, rowNos]) => ({ enrollmentId, name: nameOf.get(enrollmentId) || '', rowNos }));
  return { matches, unmatched, duplicates };
}

/* ---------------------------------------------------------------------------------------------
 * The plan
 * ------------------------------------------------------------------------------------------- */

/**
 * Build the plan for an import. It reads, compares and reports; it never writes.
 *
 * parsed    parseGradeFile() output
 * mapping   { [column key]: item } — the item each file column fills; a column left out is ignored
 *           item = { id, title, pointsCents, bonus }
 * roster    see matchRoster
 * existing  { [`${enrollmentId}|${itemId}`]: { cents, finalized, updatedAt } } grades already stored
 * options   { skipUnmatched }  an import with unmatched rows is held until the instructor says to skip them
 *           { acceptNameMatches }  rows matched by name alone are held until the instructor accepts them
 *           { acceptMax: { [column key]: true } }  a column whose file maximum differs from the item is held until accepted
 *           { allowPublished }  replacing a published grade is held until allowed
 *
 * Returns
 *   blockers   things that stop the import whatever else is chosen (duplicates, bad scores, nothing to do)
 *   held       things the instructor can release by choosing (unmatched rows, published grades overwritten)
 *   changes    [{ enrollmentId, itemId, cents, old, kind: 'new'|'changed', finalized, rowNo, name }]
 *   same       count of cells that already hold the value
 *   canApply   true when nothing blocks or holds and at least one cell changes
 */
export function buildImportPlan({ parsed, mapping, roster, existing = {}, options = {} }) {
  const blockers = [], held = [], notes = [...(parsed.notes || [])];
  const mapped = (parsed.columns || []).map((c, i) => ({ c, i, item: mapping?.[c.key] })).filter(x => x.item);
  if (!mapped.length) blockers.push('No file column is matched to an item yet.');
  const usedItems = new Map();
  const maxMismatch = [];
  for (const x of mapped) {
    if (usedItems.has(x.item.id)) blockers.push(`"${usedItems.get(x.item.id)}" and "${x.c.name}" are both matched to "${x.item.title}".`);
    else usedItems.set(x.item.id, x.c.name);
    if (x.c.maxCents != null && x.item.pointsCents != null && x.c.maxCents !== x.item.pointsCents) {
      maxMismatch.push({ key: x.c.key, name: x.c.name, title: x.item.title, fileMaxCents: x.c.maxCents, itemPointsCents: x.item.pointsCents });
    }
  }

  // A file out of 20 into an item worth 10 would be entered as written and read as the wrong fraction, so it is
  // held until the person either accepts that column as written or sets it to "Do not import". It is never scaled:
  // a scaled score would need rounding, and nothing here rounds.
  for (const mm of maxMismatch) {
    if (options.acceptMax?.[mm.key]) continue;
    held.push(`"${mm.name}" is out of ${centsText(mm.fileMaxCents)} in the file but "${mm.title}" is worth ${centsText(mm.itemPointsCents)}. Scores would be entered as written, not scaled. Tick the box for that column to import it as written, or choose "Do not import".`);
  }

  const { matches, unmatched, duplicates } = matchRoster(parsed.rows || [], roster);
  for (const d of duplicates) blockers.push(`${d.name || 'One cadet'} appears on lines ${d.rowNos.join(' and ')} of the file.`);
  const byRow = new Map(matches.map(m => [m.rowNo, m]));
  const nameOfRow = new Map((parsed.rows || []).map(r => [r.rowNo, r.name || r.email || r.sid]));
  const dupIds = new Set(duplicates.map(d => d.enrollmentId));

  if (unmatched.length && !options.skipUnmatched) {
    held.push(`${unmatched.length} row(s) match nobody on this roster: ${unmatched.slice(0, 8).map(u => `line ${u.rowNo} (${u.reason})`).join('; ')}${unmatched.length > 8 ? '; …' : ''}. Skip them to go on.`);
  }

  const changes = [];
  const badCells = [];
  let same = 0, overwritesPublished = 0;
  for (const r of parsed.rows || []) {
    const m = byRow.get(r.rowNo);
    for (const x of mapped) {
      const raw = r.cells[x.i];
      const chk = checkCell(raw, x.item);
      if (!chk.ok) { badCells.push(`line ${r.rowNo}, "${x.c.name}": ${chk.reason}`); continue; }
      if (chk.blank || !m || dupIds.has(m.enrollmentId)) continue;
      const old = existing[`${m.enrollmentId}|${x.item.id}`] || null;
      if (old && old.cents === chk.cents) { same++; continue; }
      if (old?.finalized) overwritesPublished++;
      changes.push({
        enrollmentId: m.enrollmentId, itemId: x.item.id, cents: chk.cents,
        old: old ? old.cents : null, kind: old && old.cents != null ? 'changed' : 'new',
        finalized: !!old?.finalized, updatedAt: old?.updatedAt ?? null,
        rowNo: r.rowNo, name: nameOfRow.get(r.rowNo) || '', method: m.method,
      });
    }
  }
  if (badCells.length) blockers.push(`${badCells.length} score(s) cannot be read: ${badCells.slice(0, 8).join('; ')}${badCells.length > 8 ? '; …' : ''}. Nothing is imported until the file is fixed.`);
  if (overwritesPublished && !options.allowPublished) {
    held.push(`${overwritesPublished} score(s) would replace a grade already published to students. Tick the box to allow that.`);
  }
  const nameMatched = matches.filter(m => m.method === 'name');
  if (nameMatched.length && !options.acceptNameMatches) {
    held.push(`${nameMatched.length} row(s) were matched by name alone, with no cadet ID or email: ${nameMatched.slice(0, 8).map(m => `line ${m.rowNo}`).join(', ')}${nameMatched.length > 8 ? ', …' : ''}. Two cadets can share a name. Check them in the table, then tick the box to accept them.`);
  }
  if (!blockers.length && !changes.length) blockers.push(same ? 'Every score in the file is already entered. Nothing would change.' : 'The file holds no scores to enter.');

  return {
    blockers, held, notes, changes, same, unmatched, duplicates, maxMismatch,
    nameMatched: nameMatched.map(m => ({ rowNo: m.rowNo, enrollmentId: m.enrollmentId })),
    counts: { rows: (parsed.rows || []).length, matched: matches.length, unmatched: unmatched.length, changes: changes.length, same },
    canApply: blockers.length === 0 && held.length === 0 && changes.length > 0,
  };
}

/**
 * Turn typed grid input into changes, for one item.
 * inputs   { [enrollmentId]: typed text }   blank means "leave this alone"
 * existing as above. -> { changes, errors: [{ enrollmentId, reason }], same }
 */
export function buildEntryChanges({ item, inputs, existing = {} }) {
  const changes = [], errors = [];
  let same = 0;
  for (const [enrollmentId, raw] of Object.entries(inputs)) {
    const chk = checkCell(raw, item);
    if (!chk.ok) { errors.push({ enrollmentId, reason: chk.reason }); continue; }
    if (chk.blank) continue;
    const old = existing[`${enrollmentId}|${item.id}`] || null;
    if (old && old.cents === chk.cents) { same++; continue; }
    changes.push({ enrollmentId, itemId: item.id, cents: chk.cents, old: old ? old.cents : null,
      kind: old && old.cents != null ? 'changed' : 'new', finalized: !!old?.finalized, updatedAt: old?.updatedAt ?? null });
  }
  return { changes, errors, same };
}

/** A guess at which item a file column fills: the same title, ignoring case and punctuation. */
export function guessItem(columnName, items) {
  const k = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = k(columnName);
  if (!want) return null;
  const hits = items.filter(it => k(it.title) === want);
  return hits.length === 1 ? hits[0] : null;
}
