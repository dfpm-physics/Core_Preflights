// faculty-gradebook.js — the grid (roadmap P1.1), and the arithmetic under it.
//
// Everything here except loadGradebook() is pure, because everything here except loadGradebook()
// is a rule somebody will argue with: what counts toward a percentage, what a blank cell means,
// what colour 61% is. Rules that get argued with need to be testable.
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
//   It is close, and it is wrong in one specific way: faculty-data.js:148 calls
//   effectiveDue(offering, sectionId, null) with the extension argument hardcoded null. Its status
//   therefore calls a student overdue who holds an active extension. On a dashboard tile that is a
//   rounding error; on a gradebook it is a red cell against a cadet who did nothing wrong.
//   faculty-grade.js does it correctly and this follows that instead.

import { db } from './supabase.js';
import {
  chunked, lessonNumber, effectiveDue, submissionLateness,
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
  'id,points_possible,grading_mode,due_at,is_published,position,'
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

/** @param pct 0..1, or null when there is nothing to judge yet. */
export function bandOf(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  return BANDS.find((b) => b.test(pct)) || BANDS[BANDS.length - 1];
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
  GRADED: 'graded',     // finalized grade
  DRAFT: 'draft',       // a grade exists but nobody has confirmed it
  UNGRADED: 'ungraded', // work arrived, no grade yet
  MISSING: 'missing',   // deadline passed, nothing arrived
  PENDING: 'pending',   // not due yet — absence means nothing
};

/**
 * What one cell is, and it must never be ambiguous: a blank that could mean either "not due" or
 * "never handed in" is the defect that makes a gradebook untrustworthy. Five states, each with a
 * distinct rendering, and PENDING is the only one that renders as nothing.
 *
 * `extensionISO` must already be filtered to non-revoked rows — same contract as effectiveDue().
 */
export function cellState({ grade, submission, offering, sectionId, extensionISO = null,
                            now = new Date() }) {
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
      due,
    };
  }
  if (committed) {
    const late = submissionLateness(offering, sectionId, extensionISO, submission.committed_at);
    return { state: CELL.UNGRADED, points: null,
             possible: Number(offering?.pointsPossible ?? 0),
             isFinalized: false, source: null, late: !!late.late, due };
  }
  return {
    state: isPast ? CELL.MISSING : CELL.PENDING,
    points: null,
    possible: Number(offering?.pointsPossible ?? 0),
    isFinalized: false, source: null, late: false, due,
  };
}

/**
 * Does this cell count toward the student's percentage yet?
 *
 * Only once its deadline has passed. This is the due-date-aware rule the roadmap flags in P3.2
 * ("without that rule, importing mid-term tanks every average") and it matters more here than
 * there: without it, on the first day of term every cadet reads 0% because 39 lessons they cannot
 * yet have done are already counted against them. A MISSING cell counts as a zero out of full —
 * that is the point of it — but a PENDING cell is not in the sum at all.
 */
export function countsTowardTotal(cell) {
  return cell.state !== CELL.PENDING;
}

/** Sum a student's row into {earned, possible, pct}. pct is null while nothing has come due. */
export function totalsFor(cells) {
  let earned = 0, possible = 0, counted = 0;
  for (const c of cells) {
    if (!countsTowardTotal(c)) continue;
    counted += 1;
    possible += Number(c.possible) || 0;
    // UNGRADED contributes its possible but no points — an ungraded submission is not a zero, it
    // is unfinished work by the INSTRUCTOR, so it drags the percentage exactly as a missing one
    // does until somebody grades it. Shown as such rather than quietly excluded, because
    // excluding it hides the instructor's own backlog from the instructor.
    earned += Number(c.points) || 0;
  }
  return { earned, possible, counted, pct: possible > 0 ? earned / possible : null };
}

/* ---------------------------------------------------------------------------
 * Matrix
 * ------------------------------------------------------------------------- */

/**
 * Assemble the grid. Pure: give it rows and it gives you a table, so every rule above is testable
 * without a database.
 *
 * Returns { columns[], rows[], stats } where a row carries its own cells in column order.
 */
export function buildMatrix({ enrollments, offerings, grades, submissions, extensions,
                              now = new Date() }) {
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

  const rows = (enrollments || []).map((en) => {
    const cells = columns.map((c) => {
      const grade = gradeBy.get(key(en.enrollmentId, c.offeringId)) || null;
      const cell = cellState({
        grade,
        submission: subBy.get(key(en.enrollmentId, c.offeringId)) || null,
        offering: c.offering,
        sectionId: en.sectionId,
        extensionISO: extBy.get(key(en.enrollmentId, c.offeringId)) || null,
        now,
      });
      // The two 0–5 signals live alongside the state, not inside it: a colour is a property of the
      // cell, but it is not what the cell IS (its state is), and cellState has a wall of tests
      // pinning exactly what it returns.
      return { ...cell, ...cellSignals(grade) };
    });
    const totals = totalsFor(cells);
    return { ...en, cells, totals, band: bandOf(totals.pct) };
  });

  return { columns, rows, stats: matrixStats(rows) };
}

/**
 * Class-level numbers, computed here so the page and the per-student comparison card agree by
 * construction rather than by two people writing the same average twice.
 */
export function matrixStats(rows) {
  const pcts = rows.map((r) => r.totals.pct).filter((p) => p != null);
  return {
    n: rows.length,
    median: median(pcts),
    mean: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    missing: rows.reduce((s, r) => s + r.cells.filter((c) => c.state === CELL.MISSING).length, 0),
    ungraded: rows.reduce((s, r) => s + r.cells.filter((c) => c.state === CELL.UNGRADED).length, 0),
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

  const enrollments = (enrRes.data || []).map((e) => ({
    enrollmentId: e.id,
    studentId: e.student_id,
    sectionId: e.section_id,
    name: e.students?.name || String(e.student_id),
  }));
  const offerings = (offRes.data || []).map(shapeLightOffering);
  const ids = enrollments.map((e) => e.enrollmentId);

  const grades = [], submissions = [], extensions = [];
  for (const chunk of chunked(ids)) {
    const [g, s, x] = await Promise.all([
      db.from('grades').select(GB_GRADE_SELECT).in('enrollment_id', chunk),
      db.from('submissions').select(GB_SUBMISSION_SELECT).in('enrollment_id', chunk),
      // revoked_at IS NULL or a withdrawn extension still moves the deadline. Same contract the
      // EXTENSION_SELECT docs state and the same filter faculty-grade.js applies.
      db.from('extensions').select(GB_EXTENSION_SELECT).in('enrollment_id', chunk)
        .is('revoked_at', null),
    ]);
    if (g.error) return { error: g.error };
    if (s.error) return { error: s.error };
    if (x.error) return { error: x.error };
    grades.push(...(g.data || []));
    submissions.push(...(s.data || []));
    extensions.push(...(x.data || []));
  }

  return { noCourse: false, enrollments, offerings, grades, submissions, extensions };
}
