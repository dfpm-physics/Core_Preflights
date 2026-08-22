// grade-controls.js — the 3-state credit control, and the pending-change model behind it.
//
// WHY THIS IS A MODULE AND NOT TWO COPIES
//   Two screens now grade: `faculty/grade.html`, which works a whole section at a time, and the
//   per-student modal on `faculty/student.html` (2026-07-30), which works one submission. They are
//   different screens with different scopes and they must render the SAME control, because the
//   3-state toggle is a course policy — full / warn / zero, yellow means full credit flagged — and
//   a policy that exists in two hand-maintained copies is a policy that will be two policies by
//   the end of term. The wording of the labels is part of that: `question_scores[].status` is a
//   contract with /preflight-analyze, DESIGN.md and the student's feedback card.
//
// WHAT IS DELIBERATELY NOT HERE
//   Saving. `faculty-grade.js` owns every write, including the two rules in gradeRows() that stop
//   a Save inventing a grade or relabelling AI work as instructor work. This module produces
//   markup and mutates the in-memory model; it never touches the database, so there is exactly one
//   place a grade can be written from however many screens grow controls.

import { esc } from './util.js';

/** The three states, and the words for them. Changing these changes what a student reads. */
export const CREDIT_LABEL = {
  full: '✓ Full credit',
  warn: '⚠ Full credit — review',
  zero: '✗ No credit',
};

/**
 * The cycle: green → yellow → red → green.
 *
 * Yellow sits between the two definite answers on purpose. It is "full credit, but flagged" —
 * the state /preflight-analyze reaches for whenever an answer is a genuine attempt with flawed
 * reasoning — so cycling off green lands on the judgement a grader most often wants to record,
 * and one more click reaches the only state that actually costs the student points.
 */
export const nextCredit = (s) => ({ full: 'warn', warn: 'zero', zero: 'full' })[s] || 'full';

/**
 * Advance one question's state in place, and mark it unsaved.
 *
 * `score` is derived here rather than by the caller because the rule — full and warn BOTH award
 * the question's whole points, only zero withholds them — is the part people get wrong. Partial
 * credit on a free response does not exist in this system (preflight-analyze SKILL.md, rule 5).
 */
export function applyCredit(gd, points) {
  gd.status = nextCredit(gd.status);
  gd.score = gd.status === 'zero' ? 0 : Number(points) || 0;
  gd.modified = true;
  return gd;
}

/**
 * The control itself: one chip, or `was → will be` once an edit has moved it.
 *
 * The pair exists because of the status-lamp filter on the Grade page (faculty beta, 2026-07-30).
 * Narrowing a section to its red answers and re-scoring one used to remove that card from the
 * filtered set immediately, so the answer you were reading vanished mid-sentence — taking with it
 * the evidence for a decision you had not yet saved. Filtering now runs off the status at LOAD
 * (`gd.original`, set by buildGradeData), and this control is the other half: the change is
 * visible AS a change rather than as a state that was always so.
 *
 * Only the right-hand chip is a <button>. The left is inert and faded, so the pair reads as a
 * direction of travel and there is exactly one thing to click. Cycling back to the original
 * collapses it to a single chip, because at that point there is no change to show.
 *
 * @param {number|string} sid  student id — part of the element id the caller updates
 * @param {{id:string, points:number}} q
 * @param {{status:string, original:string}} gd
 * @param {string} [idPrefix] distinguishes two graders on one page; defaults to the Grade page's.
 */
export function creditControl(sid, q, gd, idPrefix = 'tg') {
  const id = `${idPrefix}-${sid}-${esc(q.id)}`;
  const btn = (status, extra = '') =>
    `<button class="credit-toggle ${status}" id="${id}" data-act="toggle" data-sid="${esc(String(sid))}"
             data-qid="${esc(q.id)}" data-pts="${esc(String(q.points))}"${extra}>${CREDIT_LABEL[status]}</button>`;

  // No baseline recorded (an older caller, or a model built by hand) means no change can be
  // detected, so fall back to the single chip rather than drawing a pair against `undefined`.
  if (!gd.original || gd.status === gd.original) return btn(gd.status);

  return `<span class="credit-change">
    <span class="credit-toggle ${gd.original} was" aria-hidden="true">${CREDIT_LABEL[gd.original]}</span>
    <span class="credit-arrow" aria-hidden="true">→</span>
    ${btn(gd.status, ` aria-label="Changing from ${CREDIT_LABEL[gd.original]} to ${CREDIT_LABEL[gd.status]}. Click to keep cycling."`)}
  </span>`;
}

/** The same markup as a live node, for swapping one control in place after a click. */
export function creditControlNode(sid, q, gd, idPrefix) {
  const tmp = document.createElement('div');
  tmp.innerHTML = creditControl(sid, q, gd, idPrefix).trim();
  return tmp.firstElementChild;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The POINTS control — the same three-state idea, for a card with no questions
 *
 * An interactive grade has no question rows to chip, so there is nothing for creditControl() to
 * attach to: migration 014's `grades_one_grading_mechanism` CHECK forces `question_scores = '{}'`
 * on any row carrying an effort, and the whole grade is one number. This is that number's control,
 * kept beside the credit chip so the two screens that grade cannot render one and not the other.
 *
 * It cycles POINTS, not effort, and the write path clears `grades.effort` — see effortRows() in
 * faculty-grade.js for why that is load-bearing rather than incidental.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The three point values an instructor can land on, mirroring the effort curve's own three bands
 * (`app.grades_points_from_effort`, migration 019): nothing, the flat partial point, or the whole
 * assignment. `full` is the OFFERING's points_possible — 2 in Physics 215, 3 in Physics 310 — so
 * this never hardcodes a 2.
 *
 * `null` is a fourth, display-only state meaning NO GRADE ROW EXISTS. It is not a score and the
 * cycle never returns to it. Without it a cadet nobody has graded renders a red "0 pts" chip,
 * which is precisely the "graded 0 looks identical to never graded" confusion that the
 * `Not yet graded` tag was added to the card header to end.
 */
export function pointsLabel(v, pointsPossible) {
  if (v == null) return '— not graded';
  const pp = Number(pointsPossible) || 0;
  if (v <= 0) return '✗ 0 pts';
  if (v >= pp) return `✓ ${fmtPts(pp)} pts`;
  return `◐ ${fmtPts(v)} pt${v === 1 ? '' : 's'}`;
}

/** Drop the trailing `.00` the DB numeric carries, while keeping a genuine half point legible. */
const fmtPts = n => String(Number(n));

/** Which credit-chip colour a point value wears, so red/amber/green mean one thing site-wide. */
export function pointsStatus(v, pointsPossible) {
  if (v == null) return 'none';
  const pp = Number(pointsPossible) || 0;
  if (v <= 0) return 'zero';
  return v >= pp ? 'full' : 'warn';
}

/**
 * The cycle: not-graded → 0 → partial → full → 0 → …
 *
 * THE PARTIAL STEP COLLAPSES on a one-point assignment, and must. The curve's partial band is
 * `LEAST(1, points_possible)`, so where the offering is worth a single point a "partial" 1 IS full
 * credit — offering it as a separate stop would show two chips that write the same number and
 * disagree about their colour.
 */
export function nextPoints(v, pointsPossible) {
  const pp = Number(pointsPossible) || 0;
  const partial = Math.min(1, pp);
  const stops = partial > 0 && partial < pp ? [0, partial, pp] : [0, pp];
  if (v == null) return stops[0];
  const i = stops.findIndex(s => Math.abs(s - Number(v)) < 1e-9);
  return stops[(i + 1) % stops.length];   // an off-curve value (i === -1) lands on stops[0]
}

/** Advance one student's points in place, and mark the card unsaved. */
export function applyPoints(ed, pointsPossible) {
  ed.points = nextPoints(ed.points, pointsPossible);
  ed.modified = true;
  return ed;
}

/**
 * The control itself: one chip, or `was → will be` once an edit has moved it — the same pending
 * change model as creditControl(), so an unsaved points change reads as a change rather than as a
 * state that was always so.
 *
 * @param {number|string} sid
 * @param {{points:number|null, original:number|null}} ed
 * @param {number} pointsPossible
 * @param {string} [idPrefix] distinguishes the two screens; defaults to the Grade page's.
 */
export function pointsControl(sid, ed, pointsPossible, idPrefix = 'pts') {
  const id = `${idPrefix}-${sid}`;
  const chip = (v, extra = '') =>
    `<button class="credit-toggle ${pointsStatus(v, pointsPossible)}" id="${id}" data-act="points"
             data-sid="${esc(String(sid))}"${extra}>${esc(pointsLabel(v, pointsPossible))}</button>`;

  const same = (a, b) => (a == null && b == null) || Number(a) === Number(b);
  if (same(ed.points, ed.original)) return chip(ed.points);

  return `<span class="credit-change">
    <span class="credit-toggle ${pointsStatus(ed.original, pointsPossible)} was" aria-hidden="true">${esc(pointsLabel(ed.original, pointsPossible))}</span>
    <span class="credit-arrow" aria-hidden="true">→</span>
    ${chip(ed.points, ` aria-label="Changing from ${esc(pointsLabel(ed.original, pointsPossible))} to ${esc(pointsLabel(ed.points, pointsPossible))}. Click to keep cycling."`)}
  </span>`;
}

/** The same markup as a live node, for swapping one control in place after a click. */
export function pointsControlNode(sid, ed, pointsPossible, idPrefix) {
  const tmp = document.createElement('div');
  tmp.innerHTML = pointsControl(sid, ed, pointsPossible, idPrefix).trim();
  return tmp.firstElementChild;
}

/**
 * How many edits are unwritten, across a whole grading model.
 *
 * Counts the UNIT BEING CHANGED, which differs by card: a question on the written card (four
 * re-scored answers on one cadet is four), and the whole card on an interactive or no-submission
 * one (there is only the one number and its note). Both are numbers a reader can check against
 * what they remember doing. Feedback typing counts — `modified` is set by the textarea handlers
 * too, and losing a paragraph of written feedback is worse than losing a click.
 *
 * Takes either shape, so the two models share one banner rather than racing two counters:
 * `gradeData` is sid → questionId → entry, `effortData` is sid → entry. An entry is recognised by
 * carrying `modified` itself.
 */
export function dirtyCount(model) {
  let n = 0;
  for (const entry of Object.values(model || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if ('modified' in entry) { if (entry.modified) n++; continue; }
    for (const gd of Object.values(entry)) if (gd?.modified) n++;
  }
  return n;
}

/** The hint under a yellow chip. Here so both screens explain the amber state identically. */
export const WARN_HINT =
  'Yellow = full credit flagged for review. Click for red (no credit), again for green (confirmed).';
