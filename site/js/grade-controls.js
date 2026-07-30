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

/**
 * How many answers are edited but unwritten, across a whole gradeData model.
 *
 * Counts QUESTIONS rather than students: that is the unit being changed, and it is the number a
 * reader can check against what they remember doing. Feedback typing counts — `modified` is set by
 * the textarea handler too, and losing a paragraph of written feedback is worse than losing a
 * click.
 */
export function dirtyCount(gradeData) {
  let n = 0;
  for (const qMap of Object.values(gradeData || {})) {
    for (const gd of Object.values(qMap || {})) if (gd?.modified) n++;
  }
  return n;
}

/** The hint under a yellow chip. Here so both screens explain the amber state identically. */
export const WARN_HINT =
  'Yellow = full credit flagged for review. Click for red (no credit), again for green (confirmed).';
