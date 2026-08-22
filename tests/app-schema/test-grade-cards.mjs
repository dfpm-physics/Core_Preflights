// test-grade-cards.mjs — which grading card a student gets, and what the points toggle writes.
//
// Covers the 2026-08-21 change that stopped the Grade page stamping red "No credit" on cadets
// working an interaction-required lesson. The bug was not in the rendering: the page asked
// `isEffortGraded()` — "has this cadet COMMITTED to something other than the written activity" —
// which is false for a cadet who has committed to NOTHING. On preflight-07 that was ~157 of ~169
// cadets, every one of them falling through to a written card whose unanswered questions default
// to `zero`.
//
// Two pure units under test:
//   site/js/schema.js          cardKindFor — one derivation of which card, for both screens
//   site/js/grade-controls.js  nextPoints / pointsStatus / pointsLabel — the 0/1/full cycle
//
// Both are pure and import nothing that touches the network, so this suite is offline.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

// Both modules reach util.js, which reads `location.pathname` at module load to resolve its icon
// base. Static imports hoist above any statement, so the shim has to be installed first and the
// modules pulled in dynamically — the same reason test-rollup.mjs installs before importing.
installBrowser({ pathname: '/site/faculty/grade.html' });
const { cardKindFor, hasAnyAnswer } = await import('../../site/js/schema.js');
const { nextPoints, pointsStatus, pointsLabel } = await import('../../site/js/grade-controls.js');

/* ── Fixtures ────────────────────────────────────────────────────────────────
 * Shaped exactly as shapeOffering() returns: `written`/`interactive` resolved, and
 * `gradedActivities` the list policyOf() reads. Building them by hand rather than importing
 * shapeOffering keeps the failure local to the rule being tested. */
const W = { id: 'w-1', modality: 'written', gradingRole: 'graded' };
const I = { id: 'i-1', modality: 'interactive', gradingRole: 'graded' };
const Wp = { ...W, gradingRole: 'practice' };
const Ip = { ...I, gradingRole: 'practice' };

const offering = (written, interactive) => ({
  written, interactive,
  gradedActivities: [written, interactive].filter(a => a && a.gradingRole === 'graded'),
});

// preflight-01..06 — written only, interactive absent or practice
const PREFLIGHT = offering(W, Ip);
// preflight-07..10 — interactive required, written demoted to practice
const INTERACTION = offering(Wp, I);
// preflight-13..41 — both graded, the cadet picks
const CHOICE = offering(W, I);

const committed = id => ({ chosenActivityId: id, status: 'committed' });

section('cardKindFor — a committed choice outranks the policy');

for (const [name, o] of [['preflight', PREFLIGHT], ['interaction', INTERACTION], ['choice', CHOICE]]) {
  eq(`${name}: committed to written  -> written`,
    cardKindFor({ offering: o, submission: committed('w-1') }), 'written');
  eq(`${name}: committed to interactive -> interactive`,
    cardKindFor({ offering: o, submission: committed('i-1') }), 'interactive');
}

section('cardKindFor — nothing committed splits three ways');

eq('preflight: written is the only graded path, so it is the card',
  cardKindFor({ offering: PREFLIGHT, submission: null }), 'written');

// THE REGRESSION. This is the case that produced the red wall.
eq('interaction: nothing committed -> nosubmission, NOT a written card  <- the regression',
  cardKindFor({ offering: INTERACTION, submission: null }), 'nosubmission');

eq('interaction: practice answers typed are still not gradable work',
  cardKindFor({ offering: INTERACTION, submission: null, writtenAnswers: { q3: 'a practice go' } }),
  'nosubmission');

eq('choice: nothing committed and nothing typed -> nosubmission',
  cardKindFor({ offering: CHOICE, submission: null }), 'nosubmission');

eq('choice: answers typed but never submitted keep their written card',
  cardKindFor({ offering: CHOICE, submission: null, writtenAnswers: { q3: 'my answer' } }), 'written');

eq('choice: a draft submission with answers still reads as written',
  cardKindFor({ offering: CHOICE, submission: { chosenActivityId: null, status: 'draft' },
                writtenAnswers: { q2: 'x' } }), 'written');

section('cardKindFor — degenerate offerings do not throw');

eq('an offering with no activities at all',
  cardKindFor({ offering: offering(null, null), submission: null }), 'nosubmission');
eq('an interactive-only offering, nothing committed',
  cardKindFor({ offering: offering(null, I), submission: null }), 'nosubmission');
eq('committed to an activity the offering does not list -> interactive, not written',
  cardKindFor({ offering: CHOICE, submission: committed('gone-1') }), 'interactive');

section('hasAnyAnswer — blank strings are not answers');

check('empty object', hasAnyAnswer({}) === false);
check('null', hasAnyAnswer(null) === false);
check('whitespace only', hasAnyAnswer({ q2: '   ', q3: '\n' }) === false);
check('one real answer among blanks', hasAnyAnswer({ q2: '  ', q3: 'yes' }) === true);
check('a zero is an answer', hasAnyAnswer({ q2: 0 }) === true);

section('nextPoints — the 0 / partial / full cycle on a 2-point assignment');

eq('not graded enters at 0', nextPoints(null, 2), 0);
eq('0 -> 1', nextPoints(0, 2), 1);
eq('1 -> 2', nextPoints(1, 2), 2);
eq('2 wraps to 0, never back to not-graded', nextPoints(2, 2), 0);

section('nextPoints — the partial step collapses where 1 IS full credit');

// The curve's partial band is LEAST(1, points_possible), so on a 1-point offering a "partial" 1
// and full credit are the same number. Two stops that write the same value and disagree about
// their colour is the bug this guards.
eq('1-point: not graded -> 0', nextPoints(null, 1), 0);
eq('1-point: 0 -> 1 (full)', nextPoints(0, 1), 1);
eq('1-point: 1 wraps straight to 0', nextPoints(1, 1), 0);

section('nextPoints — a 3-point assignment still pays a FLAT partial point');

// Physics 310 shipped the first 3-point assignment. Partial credit is 1, not 1.5 — migration 019
// changed it from points_possible/2 for exactly this reason.
eq('3-point: 0 -> 1', nextPoints(0, 3), 1);
eq('3-point: 1 -> 3', nextPoints(1, 3), 3);
eq('3-point: 3 wraps to 0', nextPoints(3, 3), 0);

section('nextPoints — an off-curve stored value recovers rather than sticking');

// A grade edited elsewhere, or a legacy row, can hold a value the cycle does not contain.
eq('1.5 on a 2-point assignment lands back on the curve', nextPoints(1.5, 2), 0);

section('pointsStatus / pointsLabel — colour and wording');

eq('null is colourless, not red', pointsStatus(null, 2), 'none');
eq('0 is red', pointsStatus(0, 2), 'zero');
eq('partial is amber', pointsStatus(1, 2), 'warn');
eq('full is green', pointsStatus(2, 2), 'full');
eq('1 on a 1-point assignment is green, not amber', pointsStatus(1, 1), 'full');

eq('null reads as not graded', pointsLabel(null, 2), '— not graded');
eq('0 reads as no credit', pointsLabel(0, 2), '✗ 0 pts');
eq('partial names the single point', pointsLabel(1, 2), '◐ 1 pt');
eq('full names the assignment value, not a hardcoded 2', pointsLabel(3, 3), '✓ 3 pts');
eq('a numeric 2.00 from the DB does not print as "2.00"', pointsLabel(2.0, 2.0), '✓ 2 pts');

summary();
