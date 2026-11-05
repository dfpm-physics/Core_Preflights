// faculty-gradebook.js — the grid (roadmap P1.1).
//
// ONE CALCULATION (step 2). A cell's state, a cadet's total, percent, letter and rank are NOT computed here.
// They are what the database functions gradebook_cells and course_totals return, read through
// faculty-totals.js, and this module lays them out. Until step 2 this file kept its own copy of the rule
// (totalsFor, countsTowardTotal, gradedScopes) and it disagreed with the database on drafts, excused work,
// bonus items and a held score. The copy is gone; do not write another. What stays local is display only:
// the deadline and lateness a cell shows (cellState), the shortcodes, the 0-5 colours, and a colour band
// chosen from the database's exact percent text.
//
// Everything here except loadGradebook() is pure, so it is testable without a database.
//
// TWO LAYERS, KEPT APART
//   The grade is 2 points. The diagnostics are 0-5. Both are live and they are NOT the same
//   measure (ROADMAP §6 Q2). This module deals only in points — `points_earned` against
//   `points_possible` — because both modalities already land there by two different mechanisms
//   (the effort trigger for interactive, question_scores for written) and therefore sum directly
//   with no normalization layer. The 0-5 scales belong to the per-student page, which can afford
//   to explain them; a grid cell cannot.
//
// WHY NOT loadFacultyDashboard()
//   Payload, now that the correctness objection is gone. When this was written that loader called
//   effectiveDue() with the extension argument hardcoded null, so its status called a student
//   overdue who held an active extension — a rounding error on a dashboard tile, a red cell
//   against a blameless cadet on a grid. That is FIXED (faculty-data.js buildLessonRows, ROADMAP
//   §5), and both modules now honour extensions identically.
//   What remains is the reason in "Selects" below: the dashboard pulls SUBMISSION_SELECT and
//   GRADE_SELECT — every interactive report blob, every question_scores and diagnostic — for the
//   whole roster. A cell needs five fields. At 400 students x 40 lessons that difference is the
//   page, so the two loaders stay separate on cost, not on truth.

import { db } from './supabase.js';
import { loadCellsAndTotals } from './faculty-totals.js';
import {
  chunked, fetchAll, lessonNumber, effectiveDue, submissionLateness,
  withResolvedDue, offeringSections,
  effortSignal, writtenSignals, writtenReport, int05,
} from './schema.js';

/* ---------------------------------------------------------------------------
 * Selects — deliberately narrower than the shared ones
 * ------------------------------------------------------------------------- */

// NOT schema.js's OFFERING_SELECT. That one pulls offering_activities -> activities -> content,
// i.e. every question of every lesson. Across 40 lessons that is the single largest payload in the
// app, and a grid renders none of it. P3.7 asks for a performance budget before this page is
// built rather than after; this is that, applied.
export const GB_OFFERING_SELECT =
  'id,points_possible,grading_mode,due_at,due_by_day,is_published,position,'
  + 'assignments!inner(id,slug,title),'
  + 'assignment_due_dates(section_id,due_at)';

// Narrower than GRADE_SELECT, but `diagnostic` now IS rendered — the cell tints by understanding
// and draws an effort bar, both of which live there for the written path (`q2_effort` /
// `q3_understanding`, or a schema:1 payload). `question_scores` stays out; no cell shows per-
// question points. This is the one place the "no diagnostic" narrowing from the first cut was
// wrong: a colour the director explicitly asked for is worth the jsonb. It is still bounded —
// one small payload per grade, not the report blobs SUBMISSION_SELECT would drag in.
export const GB_GRADE_SELECT =
  'enrollment_id,assignment_offering_id,points_earned,points_possible,effort,diagnostic,'
  + 'is_finalized,source';

// NOT SUBMISSION_SELECT — that drags in every submission_activities blob, including the
// interactive report markdown. A cell needs to know only whether work arrived, and when.
export const GB_SUBMISSION_SELECT =
  'id,enrollment_id,assignment_offering_id,status,committed_at';

export const GB_EXTENSION_SELECT =
  'enrollment_id,assignment_offering_id,extended_due_at';

/* ---------------------------------------------------------------------------
 * Column shortcodes
 * ------------------------------------------------------------------------- */

const PREFIXES = [
  [/^pre-?flight/, 'PF'],
  [/^lesson/, 'L'],
  [/^(hw|homework)/, 'HW'],
  [/^lab/, 'LAB'],
  [/^quiz/, 'QZ'],
  [/^(exam|test|gr)/, 'EX'],
  [/^project/, 'PR'],
];

/**
 * 'preflight-02' -> 'PF02'. Keeps a column ~5rem instead of ~14rem, which is what makes 40 lessons
 * fit on a screen at all. The full title stays on the <th> title= and aria-label, so nothing is
 * actually hidden — it is abbreviated, which is different.
 */
export function shortCode(slug, title) {
  const s = String(slug || '').trim().toLowerCase();
  const num = lessonNumber(slug, title);
  let prefix = null;
  for (const [re, p] of PREFIXES) if (re.test(s)) { prefix = p; break; }
  if (!prefix) {
    const word = s.match(/^[a-z]+/)?.[0] || '';
    prefix = word ? word.slice(0, 2).toUpperCase() : 'A';
  }
  if (num == null) return prefix + (s.replace(/[^a-z0-9]/g, '').slice(-2).toUpperCase() || '');
  return `${prefix}${String(num).padStart(2, '0')}`;
}

/**
 * Shortcodes must be unique or two columns become indistinguishable at the only width they are
 * ever read at. A collision gets a letter suffix in column order — deterministic, so the same
 * lesson keeps the same code across reloads.
 */
export function uniqueCodes(items) {
  const seen = new Map();
  return items.map((it) => {
    const base = shortCode(it.slug, it.title);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}${String.fromCharCode(97 + n)}`;
  });
}

/* ---------------------------------------------------------------------------
 * Bands
 * ------------------------------------------------------------------------- */

/**
 * Six bands, and ZERO IS ITS OWN — the one idea worth taking from djGradebookProject
 * (helpers.py:286). Missing work and failing work are different facts about a student and must
 * not share a colour: one is "did not do it", the other is "did it and did not understand it",
 * and they call for opposite conversations.
 *
 * These deliberately do NOT reuse the full/warn/zero green-amber-red triad. That palette is a
 * contract with question_scores[].status (DESIGN.md:237-243) and repurposing it for a percentage
 * scale would make a 65% total look like a flagged answer. The --d0..--d5 data-viz ramp exists for
 * exactly this and is what the CSS binds to.
 */
export const BANDS = [
  { key: 'd0', label: 'No credit', test: (p) => p <= 0 },
  { key: 'd1', label: 'Under 60%', test: (p) => p < 0.60 },
  { key: 'd2', label: '60–69%', test: (p) => p < 0.70 },
  { key: 'd3', label: '70–79%', test: (p) => p < 0.80 },
  { key: 'd4', label: '80–89%', test: (p) => p < 0.90 },
  { key: 'd5', label: '90–100%', test: () => true },
];

/**
 * The colour band for a cadet, from course_totals' percent_key_text (plain digits, 22 decimals, cut and never
 * rounded). Compared as exact integers: a float would call 89.9999999999999999999999 "90" and tint a cadet one band
 * too high, which is the mistake GRADE-RULES section 3 forbids. -> a BANDS entry, or null when there is no percent.
 */
export function bandOfKey(text) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(text ?? ''));
  if (!m) return null;
  const scaled = BigInt(m[1] + (m[2] || '').padEnd(22, '0').slice(0, 22));   // percent x 10^22
  const at = (n) => BigInt(n) * 10n ** 22n;
  if (scaled <= 0n) return BANDS[0];
  if (scaled < at(60)) return BANDS[1];
  if (scaled < at(70)) return BANDS[2];
  if (scaled < at(80)) return BANDS[3];
  if (scaled < at(90)) return BANDS[4];
  return BANDS[5];
}

/**
 * One cadet's total as the page prints it. Every field is text the database produced. Nothing is added, divided or
 * rounded. -> null when the database returned no total row for this cadet (which is not a total of zero).
 */
export function totalView(t) {
  if (!t) return null;
  return {
    earnedText: t.earned_text, possibleText: t.possible_text, percentText: t.percent_text ?? null,
    percentKeyText: t.percent_key_text ?? null, letter: t.letter ?? null, gpa: t.gpa ?? null,
    nearLine: t.near_line_letter ?? null, rank: t.rank ?? null, tieGroup: t.tie_group ?? null,
    bonusOnly: !!t.bonus_only, missing: t.missing_count ?? 0, ungraded: t.ungraded_count ?? 0,
    unreleased: t.unreleased_count ?? 0, excused: t.excused_count ?? 0,
    band: bandOfKey(t.percent_key_text),
  };
}

/* ---------------------------------------------------------------------------
 * Effort / understanding colour — the SAME mapping the rollup uses
 * ------------------------------------------------------------------------- */

/**
 * A 0–5 value → an index 0..4 into the five-zone ramp (`--s1`…`--s5`).
 *
 * This is `report.html`'s `zoneVar` split in two: the arithmetic here (testable, no DOM), the
 * `--s{n}` lookup in the page. Reproduced rather than reused because that one lives inside the
 * rollup's page script — the same reason the scope control is copied, not imported — and the
 * director asked specifically for "the colours in the rollup", so drift between the two would be
 * the bug. `ceil(v) - 1`, clamped: 0 and (0,1] land on `--s1` (red), 5 on `--s5` (green).
 *
 * @returns {number|null} 0..4, or null when there is no value to colour (a future assignment type
 *   that tracks neither signal, which is the case the director asked us to design for).
 */
export function zoneIndex(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(4, Math.ceil(v) - 1));
}

/**
 * The two 0–5 signals for one cell, from the grade alone.
 *
 * Effort follows `effortSignal`'s precedence with **no** submission report in hand — the gradebook
 * does not fetch `submission_activities.content` (that is the report-blob payload P3.7 warns
 * about), so the artifact's *claimed* effort is out of reach here. In practice it does not matter:
 * `grades.effort` carries the interactive path and `diagnostic` carries the written path, which is
 * every graded cell. The per-student page, which does fetch the submission, is where the claimed
 * value can still surface.
 *
 * Understanding is the written diagnostic's `q3_understanding`, falling back to a schema:1
 * payload's `overall_understanding`. Both live in `grades.diagnostic`.
 *
 * Every field is nullable on purpose. A cell with neither signal renders as a plain points cell —
 * which is exactly what a future assignment type that tracks neither must degrade to.
 */
export function cellSignals(grade) {
  if (!grade) return { effort: null, understanding: null, effortSource: null };
  const { effort, source } = effortSignal(grade, null);
  const u = writtenSignals(grade).understanding;
  const understanding = u != null ? u : int05(writtenReport(grade)?.overall_understanding);
  return { effort, understanding, effortSource: source };
}

/* ---------------------------------------------------------------------------
 * Cell state
 * ------------------------------------------------------------------------- */

export const CELL = {
  GRADED: 'graded',     // released: the score counts in the total
  DRAFT: 'draft',       // a score is drafted (typed, imported or suggested) and is NOT published, so it is not in the total
  UNGRADED: 'ungraded', // work arrived, no score yet
  MISSING: 'missing',   // counts 0 in the total
  PENDING: 'pending',   // not due yet, or in progress — absence means nothing
  EXCUSED: 'excused',   // leaves the total
  HELD: 'held',         // scored and published, held by a release date: not in the total until it opens
};

/**
 * What one cell is, from the DATABASE's row for it (gradebook_cells). This is the only place a state is decided for
 * a staff page. A state the page does not recognise is drawn as nothing, never as a number.
 */
export function dbCellView(dbc) {
  const pts = dbc?.points_earned == null ? null : Number(dbc.points_earned);
  const base = { possible: Number(dbc?.points_possible ?? 0), late: !!dbc?.is_late, noWork: !!dbc?.no_work_received,
                 badDate: !!dbc?.deadline_invalid };
  switch (dbc?.state) {
    case 'released': return { ...base, state: CELL.GRADED, points: pts, isFinalized: true };
    case 'graded_unreleased': return { ...base, state: CELL.HELD, points: pts, isFinalized: true };
    case 'submitted_ungraded':
      return dbc.has_draft_score
        ? { ...base, state: CELL.DRAFT, points: pts, isFinalized: false }
        : { ...base, state: CELL.UNGRADED, points: null, isFinalized: false };
    case 'missing': return { ...base, state: CELL.MISSING, points: 0, isFinalized: false };
    case 'excused': return { ...base, state: CELL.EXCUSED, points: null, isFinalized: false };
    default: return { ...base, state: CELL.PENDING, points: null, isFinalized: false };
  }
}

/**
 * The LOCAL facts about one cell: its deadline (section override, extension) and whether work was late. The state and
 * points it also returns are a fallback for display only and feed no total. A page shows the database's state
 * (dbCellView) over this one.
 *
 * What one cell is, and it must never be ambiguous: a blank that could mean either "not due" or
 * "never handed in" is the defect that makes a gradebook untrustworthy. Five states, each with a
 * distinct rendering, and PENDING is the only one that renders as nothing.
 *
 * `extensionISO` must already be filtered to non-revoked rows — same contract as effectiveDue().
 *
 * `columnGraded` is always false now and is kept only so older callers still pass it. Whether a missing cell reads
 * as a counted 0 or as "nothing entered yet" is decided by the database (gradebook_cells), not here.
 */
export function cellState({ grade, submission, offering, sectionId, extensionISO = null,
                            columnGraded = false, now = new Date() }) {
  const { due, isPast } = effectiveDue(offering, sectionId, extensionISO, now);
  const committed = submission && submission.status === 'committed' && submission.committed_at;

  if (grade) {
    const late = committed
      ? submissionLateness(offering, sectionId, extensionISO, submission.committed_at)
      : { late: false };
    return {
      state: grade.is_finalized ? CELL.GRADED : CELL.DRAFT,
      points: grade.points_earned == null ? null : Number(grade.points_earned),
      possible: Number(grade.points_possible ?? offering?.pointsPossible ?? 0),
      isFinalized: !!grade.is_finalized,
      source: grade.source || null,
      late: !!late.late,
      columnGraded,
      due,
    };
  }
  if (committed) {
    const late = submissionLateness(offering, sectionId, extensionISO, submission.committed_at);
    return { state: CELL.UNGRADED, points: null,
             possible: Number(offering?.pointsPossible ?? 0),
             isFinalized: false, source: null, late: !!late.late, columnGraded, due };
  }
  return {
    state: isPast ? CELL.MISSING : CELL.PENDING,
    // Display fallback only. The page shows the database's state and points over this (dbCellView).
    points: (isPast && columnGraded) ? 0 : null,
    possible: Number(offering?.pointsPossible ?? 0),
    isFinalized: false, source: null, late: false, columnGraded, due,
  };
}

/* ---------------------------------------------------------------------------
 * Matrix
 * ------------------------------------------------------------------------- */

/**
 * Assemble the grid. Pure: give it rows and it gives you a table.
 *
 * `dbCells` (gradebook_cells) and `dbTotals` (course_totals) are required. A cell's state and points are the
 * database's; its deadline, lateness and colour signals are local display facts. A cadet with no database cells or no
 * total row gets blank cells and no total, never a guess.
 *
 * Returns { columns[], rows[], stats } where a row carries its own cells in column order and its `total`.
 */
export function buildMatrix({ enrollments, offerings, grades, submissions, extensions, dbCells, dbTotals,
                              now = new Date() }) {
  if (!Array.isArray(dbCells) || !Array.isArray(dbTotals)) {
    throw new Error('buildMatrix: the database cells and totals are required; the grid does not compute its own');
  }
  const cols = [...(offerings || [])].sort((a, b) => {
    const da = a.dueAt ? +new Date(a.dueAt) : Infinity;
    const dbb = b.dueAt ? +new Date(b.dueAt) : Infinity;
    return da - dbb || (a.position ?? 0) - (b.position ?? 0);
  });
  const codes = uniqueCodes(cols);
  const columns = cols.map((o, i) => ({
    offeringId: o.offeringId, slug: o.slug, title: o.title,
    code: codes[i], dueAt: o.dueAt, pointsPossible: o.pointsPossible, offering: o,
  }));

  const key = (e, o) => `${e}|${o}`;
  const gradeBy = new Map((grades || []).map((g) => [key(g.enrollment_id, g.assignment_offering_id), g]));
  const subBy = new Map((submissions || []).map((s) => [key(s.enrollment_id, s.assignment_offering_id), s]));
  const extBy = new Map((extensions || []).map((x) =>
    [key(x.enrollment_id, x.assignment_offering_id), x.extended_due_at]));
  const dbBy = new Map(dbCells.map((c) => [key(c.enrollment_id, c.assignment_offering_id), c]));
  const totBy = new Map(dbTotals.map((t) => [t.enrollment_id, t]));

  const rows = (enrollments || []).map((en) => {
    const cells = columns.map((c) => {
      const grade = gradeBy.get(key(en.enrollmentId, c.offeringId)) || null;
      const local = cellState({
        grade,
        submission: subBy.get(key(en.enrollmentId, c.offeringId)) || null,
        offering: c.offering,
        sectionId: en.sectionId,
        extensionISO: extBy.get(key(en.enrollmentId, c.offeringId)) || null,
        now,
      });
      const dbc = dbBy.get(key(en.enrollmentId, c.offeringId));
      // The database's state wins outright. With no database row the cell is blank, not the local guess.
      const view = dbc ? dbCellView(dbc)
        : { state: CELL.PENDING, points: null, possible: Number(c.pointsPossible ?? 0), isFinalized: false,
            late: false, noWork: false, badDate: false };
      const signals = cellSignals(grade);
      // A counted zero demonstrated NOTHING, and "not demonstrated" is literally 0 on the understanding scale
      // (INTERACTION-DATA-CONTRACT 5.1); it is not "unknown", which is what null means and leaves a cell
      // uncoloured. This only ever fills a gap, so a diagnostic that exists on a missing cell still wins.
      if (view.state === CELL.MISSING && signals.understanding == null) signals.understanding = 0;
      return { ...view, source: grade?.source || null, due: local.due, ...signals };
    });
    const total = totalView(totBy.get(en.enrollmentId));
    return { ...en, cells, total, band: total ? total.band : null };
  });

  return { columns, rows, stats: matrixStats(rows) };
}

/**
 * Counts of the database's states across the grid. There is deliberately no median or mean: a class average of
 * percentages is a second calculation, and the rank in course_totals already says where a cadet stands.
 */
export function matrixStats(rows) {
  const n = (state) => rows.reduce((s, r) => s + r.cells.filter((c) => c.state === state).length, 0);
  return {
    n: rows.length,
    missing: n(CELL.MISSING),
    ungraded: n(CELL.UNGRADED),
    drafts: n(CELL.DRAFT),
    held: n(CELL.HELD),
    excused: n(CELL.EXCUSED),
  };
}

/* ---------------------------------------------------------------------------
 * Loader
 * ------------------------------------------------------------------------- */

/** Minimal shape effectiveDue()/submissionLateness() need. Not shapeOffering — see the header. */
function shapeLightOffering(row) {
  const dueBySection = {};
  (row.assignment_due_dates || []).forEach((d) => {
    if (d.section_id) dueBySection[d.section_id] = d.due_at;
  });
  return {
    offeringId: row.id,
    slug: row.assignments?.slug || '',
    title: row.assignments?.title || row.assignments?.slug || '',
    assignmentId: row.assignments?.id || null,
    pointsPossible: Number(row.points_possible ?? 0),
    gradingMode: row.grading_mode,
    dueAt: row.due_at,
    position: row.position,
    dueBySection,
    // Carried so resolveDueBySection() can fold the per-day schedule in for sections with no
    // explicit row — the light shape needs the same level-3 source the full shape has.
    dueByDay: (row.due_by_day && typeof row.due_by_day === 'object' && !Array.isArray(row.due_by_day))
      ? row.due_by_day : {},
  };
}

/**
 * Everything the grid needs, bounded by the caller's section scope.
 *
 * Bounded is the operative word. loadRoster() fetches every student in the database and filters in
 * the browser (faculty-roster.js:11), which the roadmap calls "fine today; won't be" — and names
 * the gradebook as the thing that makes it not fine. This scopes at the database.
 */
export async function loadGradebook(ctx, sectionIds) {
  if (!ctx?.currentOffering) return { noCourse: true };
  // An empty .in() list matches EVERYTHING in PostgREST, so an instructor with no sections would
  // be handed the whole course. Same sentinel faculty-grade.js:74 uses, same reason.
  const secs = (sectionIds && sectionIds.length)
    ? sectionIds : ['00000000-0000-0000-0000-000000000000'];

  const [enrRes, offRes] = await Promise.all([
    db.from('enrollments')
      .select('id, student_id, section_id, students!inner(student_id, name)')
      .in('section_id', secs).eq('status', 'active'),
    db.from('assignment_offerings')
      .select(GB_OFFERING_SELECT)
      .eq('course_offering_id', ctx.currentOffering).eq('is_published', true)
      .order('position', { ascending: true, nullsFirst: false }),
  ]);
  if (enrRes.error) return { error: enrRes.error };
  if (offRes.error) return { error: offRes.error };

  // Fold the per-day schedule into each offering, so a section with no explicit
  // assignment_due_dates row still resolves to its own meeting day's deadline (migration 017).
  const gbSections = offeringSections(ctx);

  const enrollments = (enrRes.data || []).map((e) => ({
    enrollmentId: e.id,
    studentId: e.student_id,
    sectionId: e.section_id,
    name: e.students?.name || String(e.student_id),
  }));
  const offerings = (offRes.data || []).map(shapeLightOffering)
    .map((o) => withResolvedDue(o, gbSections));
  const ids = enrollments.map((e) => e.enrollmentId);

  const grades = [], submissions = [], extensions = [];
  for (const chunk of chunked(ids)) {
    const [g, s, x] = await Promise.all([
      fetchAll(() => db.from('grades').select(GB_GRADE_SELECT).in('enrollment_id', chunk)),
      fetchAll(() => db.from('submissions').select(GB_SUBMISSION_SELECT).in('enrollment_id', chunk)),
      // revoked_at IS NULL or a withdrawn extension still moves the deadline. Same contract the
      // EXTENSION_SELECT docs state and the same filter faculty-grade.js applies.
      fetchAll(() => db.from('extensions').select(GB_EXTENSION_SELECT).in('enrollment_id', chunk)
        .is('revoked_at', null)),
    ]);
    if (g.error) return { error: g.error };
    if (s.error) return { error: s.error };
    if (x.error) return { error: x.error };
    grades.push(...(g.data || []));
    submissions.push(...(s.data || []));
    extensions.push(...(x.data || []));
  }

  // The cells and the totals come from the database, scoped by the database to the sections the caller may see.
  // A failed read is an error here, so the grid is never drawn without them.
  const ct = await loadCellsAndTotals(db, ctx.currentOffering, 'final');
  if (ct.error) return { error: ct.error };

  return { noCourse: false, enrollments, offerings, grades, submissions, extensions, dbCells: ct.cells, dbTotals: ct.totals };
}
