// roster-import.js — parse a registrar roster export and reconcile it against the roster we hold.
//
// Pure functions only: no network, no DOM, no imports from the data layer. That is what lets the
// whole of this file run under tests/app-schema/ without a database, and it is why the conflict
// logic lives here rather than inside the page that renders it.
//
// ── WHAT CHANGED, AND WHY THE OLD PARSER COULD NOT BE EXTENDED ───────────────────────────────
// The previous importer took a hand-made three-column file (`student_id, name, section`). The
// registrar export is a different kind of artifact: ~30 columns, most irrelevant, covering EVERY
// course a query returned rather than the one being imported. Four consequences drove the rewrite.
//
//   1. Names contain commas. "Cadet Name" arrives as `Doe, Jane M.`, so a `split(',')` parser
//      shifts every column after it by one and silently mis-assigns data. Real RFC-4180 field
//      parsing is not optional here — it is the difference between a correct import and a
//      plausible, wrong one.
//   2. The file is not about one course. Rows for other subjects must be filtered out, and the
//      filter has to be VISIBLE — silently dropping rows is how a section goes missing without
//      anybody noticing until grading.
//   3. Email is now real data, not a derived string, so it is required and must be checked for
//      collisions before it becomes somebody's login identity.
//   4. Columns come and go between exports. Matching headers exactly by name guarantees a
//      breakage the first time the registrar changes "Cadet EMPLID" to "Cadet Emplid".
//
// Cell contents from the file are untrusted: every value is trimmed, length-capped, and rendered
// through esc() by the page. Nothing here is ever interpolated into SQL — the data layer uses
// PostgREST parameter binding.

/** Longest value we will accept in any single cell. Guards against a mangled export. */
const MAX_CELL = 200;

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Delimited-text parsing (RFC 4180)
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Split delimited text into rows of fields, honouring quoted fields.
 *
 * Handles the three things a naive split gets wrong: a delimiter inside quotes, a newline
 * inside quotes (registrar exports do this for multi-line advisor names), and the doubled
 * `""` escape for a literal quote. CRLF is normalised because the export is Windows-authored
 * and a trailing \r would end up inside the last field of every row.
 */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" -> a literal quote
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely empty — trailing newlines, and the blank spacer rows Excel
  // leaves behind when a sheet is exported from a larger selection.
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/**
 * Guess the delimiter from the header line.
 *
 * "Save As" from Excel produces a comma file; "Save As → Unicode Text" produces a tab file and
 * is what people reach for when a cell contains a comma. Both arrive named .csv often enough
 * that asking the user is worse than counting separators on the first line.
 */
export function sniffDelimiter(text) {
  const first = String(text || '').split(/\r?\n/)[0] || '';
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas && semis > tabs) return ';';       // some locales export this
  return ',';
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Header mapping
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Header aliases, canonical field -> accepted spellings.
 *
 * Matching is done on a normalised key (lower-cased, non-alphanumerics stripped), so
 * "Cadet EMPLID", "cadet_emplid", and "Cadet Emplid" all collapse to `cademplid`-style forms
 * and only genuinely different words need listing here.
 *
 * The legacy three-column spellings (`student_id`, `name`, `section`) are kept deliberately:
 * hand-made files from previous terms still exist, the help docs described that format for a
 * year, and accepting both costs one array entry each.
 */
const HEADER_ALIASES = {
  student_id:    ['cadetemplid', 'emplid', 'studentid', 'cadetid', 'id'],
  name:          ['cadetname', 'name', 'studentname'],
  email:         ['email', 'emailaddress', 'cadetemail'],
  squadron:      ['cadetsquadron', 'squadron', 'sq'],
  section:       ['section', 'sectionid', 'sectioncode'],
  term:          ['term'],
  class_nbr:     ['classnbr', 'classnumber'],
  subject:       ['subject', 'subj'],
  course_number: ['coursenumber', 'coursenbr', 'catalognbr'],
  course_title:  ['coursetitle', 'title'],
  sex:           ['sex', 'gender'],
  // THREE separate columns — "Major 1", "Major 2", "Major 3" — each of which may or may not be
  // present in a given export. There is no single "Major"/"Majors" column; the bare `major` alias
  // is a fallback for a hand-made file and binds to major_1 only (see mapHeaders).
  major_1:       ['major1', 'major'],
  major_2:       ['major2'],
  major_3:       ['major3'],
  advisor_name:  ['advisorname', 'advisor'],
};

/**
 * Columns without which an import cannot proceed. Everything else is enrichment.
 *
 * SQUADRON IS NOT ONE OF THEM (director, 2026-07-28). It was, and a cadet with an empty squadron
 * cell was skipped outright — which is the wrong trade twice over: `students.squadron` is a
 * nullable text column carrying "advisory context for instructors" and no authorization meaning
 * (008_student_identity.sql), so refusing the row loses a real cadet's name, email and section to
 * protect a field nothing reads. It is dropped from the ROW check and from the COLUMN check
 * together, because those are the same rule at two scales: if one cadet may be imported without a
 * squadron, so may a file whose export did not include the column at all.
 *
 * The three that remain are each load-bearing: `student_id` is the primary key, `name` is what
 * every roster and grade page displays, and `email` becomes the cadet's sign-in identity.
 */
export const REQUIRED_FIELDS = ['student_id', 'name', 'email'];

const normKey = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map header cells to canonical field names: { field -> column index }. */
export function mapHeaders(headerCells) {
  const seen = headerCells.map(normKey);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = seen.indexOf(alias);
      // First alias wins, and a column already claimed by a more specific field is not
      // re-used: 'major' must not also satisfy 'major_2' when both columns are present.
      if (idx >= 0 && !Object.values(map).includes(idx)) { map[field] = idx; break; }
    }
  }
  return map;
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Value normalisation
 * ════════════════════════════════════════════════════════════════════════════════════ */

const clean = (v) => String(v ?? '').trim().slice(0, MAX_CELL);

/**
 * "Doe, Jane M." -> "Jane M. Doe".
 *
 * `students.name` is stored First-Last, because util.lastFirst() flips it for display and the
 * whole app sorts on that. The registrar exports Last-First. Storing the registrar's order
 * verbatim would make lastFirst() produce "M., Doe, Jane" — visibly broken on every roster,
 * grade, and report page. Only the FIRST comma splits, so suffixes survive: "Doe, Jane, III"
 * becomes "Jane, III Doe", which is wrong-ish but rare and never silently mis-sorts.
 */
export function normalizeName(raw) {
  const s = clean(raw).replace(/\s+/g, ' ');
  if (!s.includes(',')) return s;
  const i = s.indexOf(',');
  const last = s.slice(0, i).trim();
  const rest = s.slice(i + 1).trim();
  return rest && last ? `${rest} ${last}` : s.replace(',', ' ').trim();
}

/** Mirrors the students_email_shape CHECK, so a bad address is caught before the round trip. */
export function emailProblem(email) {
  const e = clean(email);
  if (!e) return 'missing email';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return `"${e}" is not a valid email address`;
  return null;
}

/** Mirrors the students_cadet_id_range CHECK. */
export function studentIdProblem(raw) {
  const digits = clean(raw).replace(/[^0-9]/g, '');
  if (!digits) return { error: 'missing cadet ID' };
  const n = parseInt(digits, 10);
  if (isNaN(n) || n < 3000000000 || n > 3009999999) {
    return { error: `"${clean(raw)}" is not a cadet ID in the 30xxxxxxxx range` };
  }
  return { value: n };
}

/**
 * Does this row belong to the course being imported?
 *
 * The export is the result of a registrar query that may span courses, so this is a real
 * filter and not a formality. It compares the row's Subject + Course Number against the
 * offering's course code (`phys-215` -> subject `phys`, number `215`).
 *
 * Returns true when the file carries no course columns at all — a hand-made section list has
 * no Subject column and is, by construction, already about one course. Being permissive here
 * is safe because the SECTION filter still applies and is the tighter of the two.
 */
export function rowMatchesCourse(row, courseCode) {
  if (!courseCode) return true;
  const [subj, num] = String(courseCode).toLowerCase().split('-');
  const rowSubj = clean(row.subject).toLowerCase().replace(/[^a-z]/g, '');
  const rowNum = clean(row.course_number).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!rowSubj && !rowNum) return true;
  if (rowSubj && subj && rowSubj !== subj) return false;
  if (rowNum && num && rowNum !== num) return false;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * The parse
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a registrar export into staged roster rows.
 *
 * @param {string} text          raw file contents
 * @param {object} opts
 * @param {object} opts.knownSections  upper-cased code -> section row, from the offering
 * @param {string} opts.courseCode     e.g. 'phys-215', for the course filter
 * @returns {{rows, skipped, errors, warnings, headers, unmatchedHeaders, delimiter}}
 *
 * `errors` are problems with the FILE (wrong shape, missing required columns) — they stop the
 * import. `skipped` are rows deliberately excluded, each with a reason, and are shown to the
 * operator rather than dropped quietly. A row with a bad value goes into `skipped` too, not
 * into `errors`: one cadet with a malformed ID must not block the other 200.
 */
export function parseRosterFile(text, opts = {}) {
  const { knownSections = null, courseCode = null } = opts;
  const delimiter = sniffDelimiter(text);
  const grid = parseDelimited(text, delimiter);

  if (!grid.length) return blank(delimiter, ['The file is empty.']);

  const headerCells = grid[0].map(clean);
  const map = mapHeaders(headerCells);
  const missing = REQUIRED_FIELDS.filter(f => !(f in map));

  if (missing.length) {
    const LABEL = {
      student_id: 'Cadet EMPLID', name: 'Cadet Name', email: 'Email',
    };
    return blank(delimiter, [
      `The file is missing required column${missing.length > 1 ? 's' : ''}: ` +
      missing.map(f => LABEL[f]).join(', ') + '.',
      `Found: ${headerCells.filter(Boolean).join(', ') || '(no headers)'}`,
    ]);
  }

  const at = (cells, field) => (field in map ? clean(cells[map[field]]) : '');
  const rows = [], skipped = [], warnings = [];
  const seenIds = new Map();      // student_id  -> first line it appeared on
  const seenEmails = new Map();   // lower(email) -> first line it appeared on

  grid.slice(1).forEach((cells, i) => {
    const line = i + 2;           // 1-based, and the header is line 1
    const raw = {
      student_id: at(cells, 'student_id'),
      name: at(cells, 'name'),
      email: at(cells, 'email'),
      squadron: at(cells, 'squadron'),
      section: at(cells, 'section'),
      subject: at(cells, 'subject'),
      course_number: at(cells, 'course_number'),
      course_title: at(cells, 'course_title'),
      term: at(cells, 'term'),
      sex: at(cells, 'sex'),
      major_1: at(cells, 'major_1'),
      major_2: at(cells, 'major_2'),
      major_3: at(cells, 'major_3'),
      advisor_name: at(cells, 'advisor_name'),
    };
    const label = raw.name || raw.student_id || `line ${line}`;
    // `code` classifies the skip for the caller; `reason` is the sentence shown to a human.
    // The two are separate so the page can group by cause without parsing prose.
    const skip = (reason, code = 'invalid') => skipped.push({ line, label, reason, code, raw });

    // Course filter first: a row for another course should be reported as "not this course",
    // not as "bad cadet ID". Ordering the checks this way keeps the reasons honest.
    if (!rowMatchesCourse(raw, courseCode)) {
      const what = [raw.subject, raw.course_number].filter(Boolean).join(' ') || 'another course';
      return skip(`${what} — not this course`, 'other-course');
    }

    const id = studentIdProblem(raw.student_id);
    if (id.error) return skip(id.error);

    const name = normalizeName(raw.name);
    if (!name) return skip('missing name');

    const emailErr = emailProblem(raw.email);
    if (emailErr) return skip(emailErr);

    // No squadron check here, deliberately — see REQUIRED_FIELDS. A blank cell is imported as
    // NULL rather than as '', which is what keeps reconcile() from reading "the file said
    // nothing" as "clear the squadron we already hold".

    const code = raw.section.toUpperCase();
    if (!code) return skip('missing section');
    if (knownSections && !knownSections[code]) {
      // Not an error: a first import into an empty offering legitimately has no sections yet,
      // and the page offers to create them. Recorded so the count still reconciles.
      return skip(`section "${raw.section}" does not exist in this course yet`, 'unknown-section');
    }


    // Duplicates WITHIN the file. The database would reject these too, but as one opaque
    // constraint violation on commit — naming both line numbers here is the difference
    // between a fixable message and a mystery.
    const emailKey = raw.email.toLowerCase();
    if (seenIds.has(id.value)) {
      return skip(`duplicate of line ${seenIds.get(id.value)} (same cadet ID)`);
    }
    if (seenEmails.has(emailKey)) {
      return skip(`shares an email with line ${seenEmails.get(emailKey)}`);
    }
    seenIds.set(id.value, line);
    seenEmails.set(emailKey, line);

    rows.push({
      line,
      student_id: id.value,
      name,
      email: raw.email,
      squadron: raw.squadron || null,
      sex: raw.sex || null,
      major_1: raw.major_1 || null,
      major_2: raw.major_2 || null,
      major_3: raw.major_3 || null,
      advisor_name: normalizeName(raw.advisor_name) || null,
      section_code: code,
      term: raw.term || null,
      course_title: raw.course_title || null,
    });
  });

  const unknownSections = [...new Set(
    skipped.filter(s => s.code === 'unknown-section')
           .map(s => s.raw.section.toUpperCase())
  )];
  if (unknownSections.length) {
    warnings.push(`${unknownSections.length} unknown section code(s): ${unknownSections.join(', ')}`);
  }
  // Counted rather than skipped. Importing without a squadron is allowed, but it is still worth
  // showing the operator a number — a whole file with no squadrons usually means the export
  // dropped the column, which is something to notice and not something to block.
  const noSquadron = rows.filter(r => !r.squadron).length;
  if (noSquadron) warnings.push(`${noSquadron} row(s) have no squadron — imported without one.`);
  if (!rows.length && !skipped.length) warnings.push('The file has headers but no data rows.');

  return {
    rows, skipped, warnings, errors: [],
    headers: headerCells,
    unmatchedHeaders: headerCells.filter((h, i) => h && !Object.values(map).includes(i)),
    unknownSections,
    noSquadron,
    delimiter,
  };
}

function blank(delimiter, errors) {
  return {
    rows: [], skipped: [], warnings: [], errors,
    headers: [], unmatchedHeaders: [], unknownSections: [], noSquadron: 0, delimiter,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Conflict reconciliation
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Fields an import may overwrite on an existing student, with their display labels.
 *
 * The labels are the registrar's own column names wherever there is one, because this list is
 * rendered as "what would change" next to a cadet's name and the director's next move is to go
 * look at that column in the spreadsheet. `major_1` was labelled "Major" until 2026-07-28; there
 * is no Major column — the export carries **Major 1**, **Major 2** and **Major 3**, any of which
 * may be absent — so the label named a column nobody could find.
 */
export const COMPARED_FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['squadron', 'Squadron'],
  ['sex', 'Sex'],
  ['major_1', 'Major 1'],
  ['major_2', 'Major 2'],
  ['major_3', 'Major 3'],
  ['advisor_name', 'Advisor'],
];

/**
 * Split staged rows into new students and conflicts, against the students we already hold.
 *
 * A "conflict" is a cadet ID we have seen before — the same human, returning from a previous
 * course or term. It is NOT an error, and the common resolution is the harmless one: attach
 * them to this section and leave their record alone.
 *
 * `student_id` is the primary key of `students`, so "create a second separate account" is not
 * an available resolution — one cadet ID is one row, structurally. The two real choices are
 * whether the file's values replace what we hold.
 *
 * Default resolution is `attach`, and that is a safety decision rather than a taste one: it is
 * the only resolution that cannot destroy data. `overwrite` is opt-in per student, because a
 * stale export would otherwise quietly revert a correction somebody made by hand.
 *
 * @param {Array}  rows      staged rows from parseRosterFile
 * @param {Array}  existing  student rows we hold: { student_id, name, email, ... }
 * @param {Object} enrolledIds  Set of student_ids already enrolled in this offering
 */
export function reconcile(rows, existing, enrolledIds = new Set()) {
  const have = new Map((existing || []).map(s => [Number(s.student_id), s]));
  const fresh = [], conflicts = [];

  rows.forEach(row => {
    const prior = have.get(Number(row.student_id));
    if (!prior) { fresh.push(row); return; }

    const diffs = COMPARED_FIELDS
      .map(([field, label]) => ({
        field, label,
        from: prior[field] ?? null,
        to: row[field] ?? null,
      }))
      // Only fields that actually differ, and never treat "the file omitted this" as a change
      // worth showing — an export without a Major column should not look like it clears one.
      .filter(d => d.to !== null && String(d.from ?? '') !== String(d.to));

    conflicts.push({
      row, prior, diffs,
      alreadyEnrolled: enrolledIds.has(Number(row.student_id)),
      // Nothing to overwrite means nothing to decide; the page can commit these silently.
      trivial: diffs.length === 0,
      resolution: 'attach',
    });
  });

  return { fresh, conflicts };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Departures — who is enrolled but no longer on the roster
 * ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Cadets holding an active enrollment that the file does not name.
 *
 * WHY THIS EXISTS. A registrar export is the roster, not an addition to it. Until now an import
 * was purely additive, so a cadet who dropped in week two stayed enrolled forever: still on the
 * roster page, still counted in every cohort denominator, still rendered as a red MISSING cell on
 * every lesson after they left. Nobody noticed, because the only symptom is a number being
 * slightly wrong.
 *
 * ── THE WHOLE OFFERING, NOT JUST THE SECTIONS IN THE FILE ────────────────────────────────────
 * The first cut of this scoped departures to sections the file itself covered, as a hedge against
 * a partial export proposing to empty a section it never mentioned. The director's rule
 * (2026-07-28) is that this does not happen: **only directors import, and they import a whole
 * course at a time.** The hedge therefore bought nothing and cost the thing the feature is for —
 * a section that emptied out, or one the export dropped entirely, would never be reconciled.
 *
 * So a departure is anyone actively enrolled in the offering and absent from the file, wherever
 * they sit. Two guards remain, and they are not the scope rule in disguise:
 *
 *   1. **A file that matched nothing proposes nothing.** Zero matched rows is the signature of a
 *      wrong file — bad course filter, wrong export, sections that do not exist yet — and reading
 *      it as "remove the entire roster" is the worst thing this function could do. The operator
 *      sees the parse errors instead.
 *   2. **A cadet named anywhere in the file is never a departure**, including on a row that was
 *      SKIPPED for a data problem (a malformed email, a bad cadet ID). Those rows are reported
 *      separately for the operator to fix; a typo in one cell must not read as "this person left".
 *      Rows skipped as `other-course` do NOT protect anyone — a cadet appearing in the export only
 *      under a different course genuinely is not in this one.
 *
 * Past those, the confirmation step is the control: the list is shown by name, individually
 * un-tickable, and confirmed a second time before anything is written. And nothing here deletes —
 * a removal is reversible by re-importing a file that names them.
 *
 * @param {object} parsed    the parseRosterFile result: { rows, skipped }
 * @param {Array}  enrolled  every enrollment in the offering, active and dropped:
 *                           { enrollment_id, status, student_id, name, section_id, section_code }
 * @returns {Array} the same enrollment objects, for everyone the file does not name
 */
export function departures(parsed, enrolled) {
  const rows = parsed?.rows || [];
  if (!rows.length) return [];

  const named = new Set(rows.map(r => Number(r.student_id)));
  for (const s of parsed?.skipped || []) {
    if (s.code === 'other-course') continue;
    const id = Number(String(s.raw?.student_id ?? '').replace(/[^0-9]/g, ''));
    if (Number.isFinite(id) && id > 0) named.add(id);
  }

  return (enrolled || [])
    // Already dropped is already removed. Re-proposing them every import would grow the
    // confirmation list without bound and train the operator to stop reading it.
    .filter(e => e.status !== 'dropped')
    .filter(e => !named.has(Number(e.student_id)))
    .sort((a, b) => String(a.section_code).localeCompare(String(b.section_code))
                 || String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * Cadets the file names whose enrollment we had previously dropped.
 *
 * The exact inverse of departures(), and it exists for the same reason: once an import can remove
 * somebody, it has to be able to put them back from the same kind of evidence. A cadet left off
 * one week's export by mistake would otherwise be stuck outside the course permanently — the
 * enrollment upsert in commitRoster() is `ignoreDuplicates`, so it finds their row, changes
 * nothing, and leaves the `dropped` status exactly where it was.
 *
 * NO scope rule here, deliberately. departures() is narrow because removing somebody is the
 * dangerous direction; putting a cadet the registrar still lists back into the course is the safe
 * one, so it applies wherever the file names them.
 *
 * @param {Array} rows      staged rows from parseRosterFile
 * @param {Array} enrolled  every enrollment in the offering, active and dropped
 */
export function returning(rows, enrolled) {
  const named = new Set((rows || []).map(r => Number(r.student_id)));
  return (enrolled || [])
    .filter(e => e.status === 'dropped' && named.has(Number(e.student_id)))
    .sort((a, b) => String(a.section_code).localeCompare(String(b.section_code))
                 || String(a.name || '').localeCompare(String(b.name || '')));
}

/** Summary counts for the preview header. */
export function summarize(parsed, reconciled, departing = []) {
  const decidable = reconciled.conflicts.filter(c => !c.trivial);
  return {
    inFile: parsed.rows.length + parsed.skipped.length,
    matched: parsed.rows.length,
    skipped: parsed.skipped.length,
    fresh: reconciled.fresh.length,
    conflicts: reconciled.conflicts.length,
    needsDecision: decidable.length,
    departing: departing.length,
    sections: [...new Set(parsed.rows.map(r => r.section_code))].sort(),
  };
}

/**
 * Guess a section's meeting pattern and period from its code — `M1A` -> `['M']`, period 1.
 *
 * A DEFAULT, NOT A RULE, and the distinction is the whole point. `isMDay()` and
 * `dueDateForSection()` were deleted from util.js precisely because they sniffed the first letter
 * of a section code at READ time, which only ever worked for the two courses using `[MT][135][A-D]`.
 * Nothing here is consulted again after the row is written: the value lands in `meeting_days`,
 * where it is visible, editable, and authoritative. A course meeting W/F stores W/F and every
 * reader keeps working, because no reader asks about the code.
 *
 * The alternative was what this replaced — writing `[]` — which is not neutral. An empty
 * meeting_days means `dueRowsFor()` skips the section and `resolveDueBySection()` cannot place it,
 * so it silently inherits the offering default: on Fall 2026 that is the M-day date, making every
 * imported T-day section one day early on every lesson, with nothing to notice. A wrong guess is
 * visible and one click to fix; no guess was invisible and nobody fixed it.
 *
 * Unrecognised codes get `[]` — the honest answer for a pattern we cannot read, and identical to
 * the old behaviour for exactly the codes the old behaviour was defensible for.
 */
export function sectionDefaultsFrom(code) {
  const c = String(code || '').trim().toUpperCase();
  const m = c.match(/^([A-Z])(\d)?/);
  const letter = m?.[1] || '';
  const digit = m?.[2] ? Number(m[2]) : null;
  // Only the day letters this convention actually uses. 'A1B' must not become an 'A-day' section.
  const meeting_days = ['M', 'T', 'W', 'R', 'F'].includes(letter) ? [letter] : [];
  return { meeting_days, period: Number.isFinite(digit) ? digit : null };
}
