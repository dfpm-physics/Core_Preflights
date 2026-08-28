// blackboard-fill.js — write preflight scores into a Blackboard gradebook file and hand it back.
//
// WHY THIS SHAPE, AND NOT AN EXPORT
//
// `faculty-admin.js` already builds a grades CSV, but it invents its own column headers
// (`Lesson 08 Preflight — Gauss's Law [2]`). Blackboard will not accept that file: its headers
// encode an internal column id, and a hand-built header is rejected on upload. ROADMAP P2.1 names
// that as the single largest risk in the whole LMS-export problem.
//
// So this module never writes a header. It takes Blackboard's OWN export, writes numbers into the
// cells of columns that already exist, and returns the same file. There is nothing for Blackboard
// to reject because nothing about the file's structure changed.
//
// THREE RULES, ALL LOAD-BEARING
//
//   1. Match on the cadet id and only on it (director, 2026-08-28; ROADMAP P2.1). Never on name —
//      two cadets share a surname and the collision is silent. If no id column can be found the
//      file is REFUSED; a weaker match is worse than no answer.
//   2. Blank, never zero. A cadet with no finalized grade gets an EMPTY cell. A zero posts to
//      Blackboard as a real score an instructor never gave, and no one can tell it apart from one
//      that was earned. `gradeMatrix()` already returns null for this case; we must not turn it
//      into 0 on the way out.
//   3. Only ever write into cells. Never add, rename, reorder or remove a column or a row.
//      Exams, homework, Total, and Blackboard's own bookkeeping columns pass through untouched.
//      This rule is the entire reason the round trip is safe.
//
// PURE ON PURPOSE. No DOM, no network, no imports that bind a Supabase client — so the whole
// module is testable in Node the way `roster-import.js` is. The caller does the I/O.

import { parseDelimited, sniffDelimiter, studentIdProblem } from './roster-import.js';

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Finding the cadet-id column
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Header spellings that mean "the cadet's registrar id".
 *
 * Normalised the same way `roster-import.js` does it (lower-cased, non-alphanumerics stripped),
 * so "Student ID", "student_id" and "StudentID" all collapse together and only genuinely
 * different words need listing.
 *
 * This list is a STARTING POINT and is expected to grow once a real Blackboard export is in
 * hand — which is exactly why `findIdColumn` does not depend on it alone.
 */
const ID_HEADER_ALIASES = [
  'studentid', 'cadetemplid', 'emplid', 'cadetid', 'username', 'userid', 'id',
];

const normKey = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** A cell holds a cadet id if it parses into the 30xxxxxxxx range the students CHECK enforces. */
function cadetIdIn(cell) {
  const r = studentIdProblem(cell);
  return r.error ? null : r.value;
}

/**
 * Which column carries the cadet id — by header name first, then by CONTENT.
 *
 * The content pass is what makes this robust to a Blackboard export nobody has seen yet. A cadet
 * id is a 10-digit number in a narrow, published range (3000000000–3009999999), so the column
 * holding them is identifiable without knowing what Blackboard decided to call it. A header-only
 * matcher would have to be rewritten the first time the export used an unexpected word; this one
 * only gets faster.
 *
 * The two passes also cross-check each other. When the header says one column and the content
 * says another, the CONTENT wins and the disagreement is reported — a column labelled "ID" that
 * holds Blackboard's own internal user keys is a real possibility, and it would produce a file
 * where every single lookup silently missed.
 *
 * @returns {{ index, how: 'header'|'content', hits, rows, disagreedWith }} or
 *          {{ error }} when no column qualifies — the file is then refused, never guessed at.
 */
export function findIdColumn(grid) {
  if (!grid || grid.length < 2) return { error: 'The file has no data rows.' };

  const header = grid[0].map(normKey);
  const body = grid.slice(1);

  // Pass 1 — the header says so.
  let byHeader = -1;
  for (const alias of ID_HEADER_ALIASES) {
    const i = header.indexOf(alias);
    if (i >= 0) { byHeader = i; break; }
  }

  // Pass 2 — the data says so. Count real cadet ids per column.
  const width = Math.max(...grid.map(r => r.length));
  let best = -1, bestHits = 0;
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (const row of body) if (cadetIdIn(row[c]) != null) hits++;
    if (hits > bestHits) { best = c; bestHits = hits; }
  }

  // A column has to hold ids for most of the file to count. A stray 30xxxxxxxx sitting in a
  // free-text column must not be mistaken for the identity column.
  const strong = bestHits >= Math.max(1, Math.floor(body.length * 0.5));

  if (strong) {
    return {
      index: best,
      how: 'content',
      hits: bestHits,
      rows: body.length,
      disagreedWith: byHeader >= 0 && byHeader !== best ? grid[0][byHeader] : null,
    };
  }
  if (byHeader >= 0) {
    // The header named a column but its contents do not look like cadet ids. Report it rather
    // than proceed: every lookup would miss, and a file of empty cells looks like "nobody has a
    // grade yet" rather than like a failure.
    return {
      error: `Column "${grid[0][byHeader]}" looks like the ID column, but ${bestHits} of `
           + `${body.length} rows hold a cadet ID in the 30xxxxxxxx range. `
           + 'Check that this export includes the registrar cadet ID.',
    };
  }
  return {
    error: 'No cadet ID column found. The file must include the registrar cadet ID '
         + '(a 10-digit number starting 30…). Matching by name is not supported, because '
         + 'two cadets can share a name.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Matching a Blackboard column to one of our assignments
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Strip Blackboard's bookkeeping out of a column header before reading it.
 *
 * A Blackboard column header carries its own metadata — `[Total Pts: 2]` and a trailing
 * `|1234567` column id are both common. Both contain digits, and both would poison a naive
 * "first number in the string" reader: `Preflight 8 [Total Pts: 2]` must resolve to 8, not 2.
 */
function stripColumnMeta(text) {
  return String(text || '')
    .split('|')[0]                 // drop the trailing column id
    .replace(/\[[^\]]*\]/g, ' ')   // drop [Total Pts: 2] and friends
    .replace(/\([^)]*\)/g, ' ');   // and any parenthetical
}

/**
 * A token that means "this column is a preflight". THE most safety-critical thing in this file.
 *
 * The real Physics 215 Blackboard export (2026-08-28) names its preflight columns `PF 02` … `PF 41`
 * — and in the SAME file sits a full set of `Lesson 2 Homework - Electric Charge, Coulombs`
 * columns carrying real homework marks, one per lesson, with the same lesson numbers and the same
 * `[Total Pts: 2 Score]` suffix.
 *
 * So "Lesson N" is NOT a usable signal and must never become one: a matcher that read the lesson
 * number alone would map `Lesson 8 Homework` onto lesson 8 and overwrite a homework grade with a
 * preflight score. The `PF`/`preflight` token is the ONLY thing that separates the two, which is
 * why it is required rather than merely preferred.
 *
 * Also deliberately excluded, all present in that same file: `Exam`, `Lab`, `GR`, `EPQ`, `MSE`,
 * `Block N Comprehensive`, `Total Points`, `Prog Grade`, `Final Grade`, `Overall Grade`.
 */
const PREFLIGHT_TOKEN = /\bpf\b|pre\s*-?\s*flight|\bprep\b|\bipr?ep\b/i;

/**
 * The lesson number a piece of text refers to, or null.
 *
 * Two steps, and the order is the point: the text must FIRST be identified as a preflight, and
 * only then is a number read out of it. Reading the number first and checking the word afterwards
 * is the same logic, but it invites the version of this function that skips the check.
 *
 * The number may sit on either side of the token — `PF 02` (Blackboard) and `preflight-02` (our
 * slug) both work, as does `Lesson 08 Preflight — …` (our title) — because the token is a filter
 * and the first number in the cleaned string is the answer.
 */
export function lessonNumberOf(text) {
  const s = stripColumnMeta(text);
  if (!PREFLIGHT_TOKEN.test(s)) return null;
  const m = s.match(/\d{1,2}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 99 ? n : null;
}

/**
 * Map Blackboard columns onto our assignment offerings, by LESSON NUMBER.
 *
 * Not by title. Our title is `Lesson 08 Preflight — Gauss's Law and Its Applications`; the
 * director's Blackboard column is whatever they typed there, plus Blackboard's appended
 * metadata. Exact-title matching would match nothing. The lesson number is the one token both
 * sides genuinely share.
 *
 * @param headerCells the file's header row
 * @param offerings   [{ id, lesson, title }] — `lesson` already extracted by the caller
 * @returns {{ matched: {colIndex: offeringId}, columns: [...], unmatchedOfferings: [...] }}
 */
export function matchColumns(headerCells, offerings) {
  const byLesson = new Map();
  for (const o of offerings || []) if (o.lesson != null) byLesson.set(o.lesson, o);

  const matched = {};
  const columns = [];
  const claimed = new Set();

  (headerCells || []).forEach((h, i) => {
    const lesson = lessonNumberOf(h);
    const off = lesson != null ? byLesson.get(lesson) : null;
    if (off && !claimed.has(off.id)) {
      matched[i] = off.id;
      claimed.add(off.id);
      columns.push({ index: i, header: h, lesson, offeringId: off.id, title: off.title });
    } else if (off) {
      // Two columns claim the same lesson. Fill neither — a guess here writes a grade into a
      // column the director did not mean, and they cannot see which one we picked.
      columns.push({ index: i, header: h, lesson, offeringId: null, title: null,
                     note: `duplicate — lesson ${lesson} is already matched` });
    }
  });

  return {
    matched,
    columns,
    unmatchedOfferings: (offerings || []).filter(o => !claimed.has(o.id)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Filling
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Write scores into the matched columns. Returns a NEW grid; the input is not mutated.
 *
 * Rows whose id cell does not parse as a cadet id are copied through completely untouched. That
 * is not just defensive: a Blackboard export can carry non-student rows (a "Points Possible"
 * row), and the correct handling of one is to leave every cell of it exactly as it was.
 *
 * @param lookup (cadetId, offeringId) => number | null   null means "no finalized grade"
 */
export function fillGrid(grid, idCol, colMap, lookup, { decimals = 0 } = {}) {
  const fmt = (n) => (decimals > 0 ? Number(n).toFixed(decimals) : String(n));
  const out = [];
  let filled = 0, blanks = 0, skippedRows = 0;
  const unknownIds = [];
  const seenIds = [];

  grid.forEach((row, r) => {
    if (r === 0) { out.push(row.slice()); return; }        // header, verbatim

    const id = cadetIdIn(row[idCol]);
    if (id == null) { out.push(row.slice()); skippedRows++; return; }
    seenIds.push(id);

    const copy = row.slice();
    let touchedAny = false;
    for (const [colIdx, offeringId] of Object.entries(colMap)) {
      const c = Number(colIdx);
      const v = lookup(id, offeringId);
      // RULE 2. null → empty string, never 0. See the header of this file.
      if (v == null) { copy[c] = ''; blanks++; }
      else { copy[c] = fmt(v); filled++; touchedAny = true; }
    }
    if (!touchedAny) unknownIds.push(id);
    out.push(copy);
  });

  return { grid: out, filled, blanks, skippedRows, ids: seenIds, unknownIds };
}

/**
 * RFC-4180: wrap every field, double any embedded quote.
 *
 * A deliberate copy of the one-liner in `faculty-admin.js`, not an import. Importing that module
 * would pull in `supabase.js`, which binds a client at import time — and this module's whole
 * value is that it is pure and can be exercised without a session. One line is the cheaper price.
 */
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Grid → delimited text, in the SHAPE THE FILE ARRIVED IN.
 *
 * Every one of these defaults is wrong for the real Blackboard export, which is why they are
 * parameters rather than constants:
 *
 *   - It uses **bare LF**, not CRLF, despite being a Windows-authored export. Emitting CRLF would
 *     rewrite every line ending in a file the director is about to upload to a live course — a
 *     whole-file change presented as a preflight edit.
 *   - It carries a **UTF-8 BOM**. Dropping it changes the first byte of the file; leaving it
 *     unstripped on the way IN corrupts the first header cell into `﻿"Last Name"`, quotes
 *     and all, because the BOM stops the parser seeing the opening quote.
 *   - It ends with a **trailing newline**, which `parseDelimited` drops as an empty row.
 *
 * Quoting needs no such care: Blackboard quotes every field including the empty ones, which is
 * exactly what `csvCell` does, so a round trip is already byte-identical there.
 */
export function toCsv(grid, delimiter = ',', { eol = '\r\n', bom = false, trailingEol = false } = {}) {
  const body = grid.map(row => row.map(csvCell).join(delimiter)).join(eol);
  return (bom ? '﻿' : '') + body + (trailingEol ? eol : '');
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Reading one uploaded file
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Parse one uploaded file and work out what we could do with it — without doing it yet.
 *
 * Returns everything the preview needs. Nothing is filled and nothing is downloaded until the
 * director has seen this, which is the same preview-then-commit shape the roster import uses and
 * for the same reason: a file nobody has looked at should not be acted on.
 */
export function readFile(text, offerings) {
  if (/^PK\x03\x04/.test(String(text || '').slice(0, 4))) {
    return { error: 'That looks like an Excel workbook (.xlsx), which this page cannot read. '
                  + 'In Excel: File → Save As → CSV UTF-8 (Comma delimited), then upload that file.' };
  }

  let raw = String(text || '');

  // The BOM must come off BEFORE parsing, not after. Left on, it sits inside the first field and
  // stops the parser recognising that field's opening quote — the first header reads back as
  // `﻿"Last Name"`, with the quotes as literal characters. Everything downstream then works
  // perfectly on a header cell that is quietly wrong.
  const bom = raw.charCodeAt(0) === 0xFEFF;
  if (bom) raw = raw.slice(1);

  // Preserve what we were given rather than imposing a house style — see toCsv().
  const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
  const trailingEol = /\n$/.test(raw);

  const delimiter = sniffDelimiter(raw);
  const grid = parseDelimited(raw, delimiter);
  if (!grid.length) return { error: 'The file is empty.' };

  const id = findIdColumn(grid);
  if (id.error) return { error: id.error };

  const cols = matchColumns(grid[0], offerings);
  const ids = grid.slice(1).map(r => cadetIdIn(r[id.index])).filter(v => v != null);

  return { grid, delimiter, idColumn: id, ...cols, ids, rows: grid.length - 1,
           format: { eol, bom, trailingEol, decimals: decimalsUsedBy(grid) } };
}

/**
 * How many decimal places this file writes a score with.
 *
 * Blackboard's export writes `"2.00"`, not `"2"`. Writing a bare `2` back would be accepted, but
 * it makes our cells visibly different from every other cell in the column — and a director
 * eyeballing the file before uploading it to a live course should not have to wonder whether that
 * difference means something. Read from the file's own preflight cells, so it follows the file
 * rather than assuming a convention.
 */
function decimalsUsedBy(grid) {
  // Scan the WHOLE grid, not just the preflight columns. The preflight columns are the ones we are
  // about to fill, so in the file that matters they are entirely empty and would report "no
  // decimals" — the convention has to be read from the columns that already carry marks
  // (homework, labs, exams). Found the hard way on the real 2026-08-28 export.
  const seen = new Map();
  for (let r = 1; r < grid.length; r++) {
    for (const cell of grid[r]) {
      const m = /^\s*-?\d+\.(\d+)\s*$/.exec(cell ?? '');
      if (m) seen.set(m[1].length, (seen.get(m[1].length) || 0) + 1);
    }
  }
  // The most common width wins, so one stray `3.5` cannot outvote a file full of `2.00`.
  let best = 0, bestN = 0;
  for (const [width, n] of seen) if (n > bestN) { best = width; bestN = n; }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Checking a SET of uploaded files against the roster
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * One PREP course is not one Blackboard course, and that is the fact this function exists for.
 *
 * phys-215 Fall 2026 is a single PREP offering with 17 sections, spread across at least THREE
 * Blackboard courses: one holding six M-day sections, one holding eight T-day sections, and a third
 * — belonging to a different instructor, who uploads separately — holding `M1C`, `M3C` and `T5C`.
 * That third course mixes M-day and T-day sections in one shell, which is why "the M file and the
 * T file" was the wrong model: **the split is by Blackboard course, not by teaching day.**
 *
 * So any number of files may be uploaded, and a cadet who is in none of them is NOT automatically
 * an error — they may simply belong to a course somebody else is filling. The question therefore
 * changes from *"is everyone here?"* to *"which sections do these files cover, and is every cadet
 * of a COVERED section present?"*
 *
 * A section's coverage is read from OUR roster (which section each id in the file enrols in), not
 * from Blackboard's `Child Course ID` column. That column happens to exist in these exports and
 * agrees, but it is Blackboard's own bookkeeping and may not always be there; the roster is ours
 * and always is.
 *
 * The distinction that carries the weight:
 *   - a section with **nothing** present is *not in this upload* — expected, reported plainly, and
 *     the reason another file is still needed;
 *   - a section that is **partly** present is a **real error** — those cadets have a column waiting
 *     for them in a file that was uploaded, and their grades would silently not post.
 *
 * @param files  [{ label, ids: number[] }]  one entry per uploaded file
 * @param roster [{ studentId, sectionCode }]
 */
export function checkFiles(files, roster) {
  const list = (files || []).filter(f => f && Array.isArray(f.ids));
  const sectionOf = new Map((roster || []).map(s => [s.studentId, s.sectionCode]));

  // Enrolled headcount per section, and which file(s) each cadet turned up in.
  const enrolled = new Map();
  for (const s of roster || []) {
    enrolled.set(s.sectionCode, (enrolled.get(s.sectionCode) || 0) + 1);
  }
  const seenIn = new Map();                       // studentId -> [labels]
  for (const f of list) {
    for (const id of new Set(f.ids)) {
      if (!seenIn.has(id)) seenIn.set(id, []);
      seenIn.get(id).push(f.label);
    }
  }

  // Per-section tally over everything uploaded.
  const present = new Map();
  for (const [id] of seenIn) {
    const sec = sectionOf.get(id);
    if (sec) present.set(sec, (present.get(sec) || 0) + 1);
  }

  const covered = [], uncovered = [], partial = [];
  for (const [sec, total] of [...enrolled].sort()) {
    const n = present.get(sec) || 0;
    if (n === 0) uncovered.push({ sectionCode: sec, enrolled: total });
    else if (n < total) {
      partial.push({
        sectionCode: sec, enrolled: total, present: n,
        missing: (roster || []).filter(s => s.sectionCode === sec && !seenIn.has(s.studentId))
                               .map(s => s.studentId),
      });
    } else covered.push({ sectionCode: sec, enrolled: total });
  }

  // A cadet listed in two different files. Their grade posts twice, into two Blackboard courses.
  const inMultiple = [...seenIn].filter(([, labels]) => labels.length > 1)
    .map(([studentId, labels]) => ({ studentId, sectionCode: sectionOf.get(studentId) || '?', files: labels }));

  // Two uploads with an identical id set: the same export picked twice.
  const duplicateFiles = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = new Set(list[i].ids), b = new Set(list[j].ids);
      if (a.size && a.size === b.size && [...a].every(id => b.has(id))) {
        duplicateFiles.push([list[i].label, list[j].label]);
      }
    }
  }

  const notOnRoster = [];
  for (const f of list) {
    for (const id of new Set(f.ids)) if (!sectionOf.has(id)) notOnRoster.push({ studentId: id, file: f.label });
  }

  return {
    files: list.length,
    covered, uncovered, partial, inMultiple, duplicateFiles, notOnRoster,
    coveredCadets: [...seenIn].filter(([id]) => sectionOf.has(id)).length,
    rosterSize: (roster || []).length,
  };
}
