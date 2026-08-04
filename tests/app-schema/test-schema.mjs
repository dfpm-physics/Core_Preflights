// test-schema.mjs — the pure domain rules in site/js/schema.js.
// No network, no login: these import the shipped module and exercise it directly.

import { check, eq, section } from './harness.mjs';
import {
  shapeOffering, shapeSubmission, effectiveDue, isOpen, deriveStatus,
  releaseAt, isReleased, releaseNote, LOOKAHEAD_DAYS,
  resolveDueBySection, withResolvedDue,
  canSwitchActivity, isActivityAvailable, pointsFromEffort, displayPoints,
  questionsOf, questionPoints, answeredCount, lessonNumber, chunked,
  taughtSectionIds, actionableSections, isArtifactLaunchable,
  policyOf, isGradedPath, writtenPathCounts,
} from '../../site/js/schema.js';

const NOW = new Date('2026-09-01T12:00:00Z');
const EARLIER = '2026-08-01T05:59:00Z';
const LATER = '2026-10-01T05:59:00Z';

/* ── shapeOffering ─────────────────────────────────────────────────────────── */
section('shapeOffering');

const rawOffering = {
  id: 'off-1',
  course_offering_id: 'co-1',
  points_possible: '2.00',
  grading_mode: 'points',
  switch_policy: 'lock_on_commit',
  opens_at: null,
  due_at: LATER,
  is_published: true,
  position: 2,
  assignments: {
    id: 'asg-1', slug: 'preflight-02', title: 'Lesson 02', description: 'd',
    objectives: [{ key: 'o1' }], kind_id: 'preflight', course_id: 'crs-1',
  },
  offering_activities: [
    // Deliberately out of order, and the interactive one is listed first.
    { grading_role: 'practice', available_after: 'submit', is_visible: true, position: 1,
      activities: { id: 'act-i', slug: 'lesson-02-x', modality: 'interactive', title: 'Interactive',
                    content: { artifact_url: 'https://claude.ai/a', description: 'desc' } } },
    { grading_role: 'graded', available_after: 'always', is_visible: true, position: 0,
      activities: { id: 'act-w', slug: 'p02-written', modality: 'written', title: 'Written',
                    content: { questions: [
                      { id: 'q1', text: 'Q1', points: 0 },
                      { id: 'q2', text: 'Q2', points: 1 },
                      { id: 'q3', text: 'Q3', points: 1, figure_url: 'https://x/f.png' }],
                      reading_link: 'https://book' } } },
  ],
  assignment_due_dates: [
    { section_id: 'sec-M', due_at: EARLIER },
    { section_id: 'sec-T', due_at: LATER },
  ],
};

const off = shapeOffering(rawOffering);
eq('slug flattened from the embedded assignment', off.slug, 'preflight-02');
eq('points_possible coerced to a number', off.pointsPossible, 2);
eq('activities ordered by offering position, not embed order', off.activities.map(a => a.slug),
   ['p02-written', 'lesson-02-x']);
eq('written accessor finds the written activity', off.written.id, 'act-w');
eq('interactive accessor finds the interactive activity', off.interactive.id, 'act-i');
eq('one graded activity => not a choice', off.isChoice, false);
eq('dueBySection keyed by section', off.dueBySection['sec-M'], EARLIER);
check('shapeOffering(null) is null', shapeOffering(null) === null);

// Two graded activities is what makes it a choice — derived, never stored.
const choiceRaw = structuredClone(rawOffering);
choiceRaw.offering_activities[0].grading_role = 'graded';
eq('two graded activities => choice', shapeOffering(choiceRaw).isChoice, true);
eq('gradedActivities lists both', shapeOffering(choiceRaw).gradedActivities.length, 2);

// The fourth combination — interactive graded, written attached as practice. The director's
// "Interaction only". It is the one the student pages had no branch for.
const interactionOnlyRaw = structuredClone(rawOffering);
interactionOnlyRaw.offering_activities[0].grading_role = 'graded';    // interactive
interactionOnlyRaw.offering_activities[1].grading_role = 'practice';  // written
const interactionOnly = shapeOffering(interactionOnlyRaw);

/* ── policyOf: all four role combinations ──────────────────────────────────── */
// Regression cover for the bug where the lesson page derived "is this a choice?" from
// `interactiveGraded` alone. That predicate cannot separate the two rows marked (!) below, so an
// interaction-only lesson rendered as a free choice and offered the written path it had removed.
section('policyOf');

eq('written graded + interactive practice => preflight', policyOf(off), 'preflight');
eq('both graded => choice', policyOf(shapeOffering(choiceRaw)), 'choice');
eq('interactive graded + written practice => interaction (!)', policyOf(interactionOnly), 'interaction');
eq('nothing graded => choice, the editor neutral default', policyOf({ gradedActivities: [] }), 'choice');
eq('a missing offering does not throw', policyOf(null), 'choice');

// The old predicate, shown failing to distinguish them — this is what the page used to use.
eq('interactiveGraded is true for BOTH choice and interaction-only, which is why it was wrong',
   [isGradedPath(shapeOffering(choiceRaw).interactive), isGradedPath(interactionOnly.interactive)],
   [true, true]);
eq('isGradedPath is false for a practice activity', isGradedPath(interactionOnly.written), false);
eq('isGradedPath of a missing activity is false, not undefined', isGradedPath(null), false);

/* ── writtenPathCounts: may the questions be offered at all? ───────────────── */
section('writtenPathCounts');

const wpc = (o) => ({
  hasWritten: !!o.written,
  writtenGraded: isGradedPath(o.written),
  interactiveGraded: isGradedPath(o.interactive),
});

eq('written-required lesson shows the questions',
   writtenPathCounts({ ...wpc(off), committedModality: null }), true);
eq('choice lesson shows the questions while still open',
   writtenPathCounts({ ...wpc(shapeOffering(choiceRaw)), committedModality: null }), true);
eq('INTERACTION-ONLY never shows the questions',
   writtenPathCounts({ ...wpc(interactionOnly), committedModality: null }), false);
eq('a choice lesson stops showing them once the interactive report is the grade',
   writtenPathCounts({ ...wpc(shapeOffering(choiceRaw)), committedModality: 'interactive' }), false);
eq('committing to the WRITTEN path keeps them visible (still editable until the deadline)',
   writtenPathCounts({ ...wpc(shapeOffering(choiceRaw)), committedModality: 'written' }), true);
eq('no written activity at all => nothing to show',
   writtenPathCounts({ hasWritten: false, writtenGraded: false, interactiveGraded: true,
                       committedModality: null }), false);
eq('a misconfigured lesson with NOTHING graded still renders the questions, not a blank page',
   writtenPathCounts({ hasWritten: true, writtenGraded: false, interactiveGraded: false,
                       committedModality: null }), true);

/* ── content accessors ─────────────────────────────────────────────────────── */
section('content accessors');
eq('questionsOf reads content.questions', questionsOf(off.written).length, 3);
eq('questionsOf on interactive is empty, not undefined', questionsOf(off.interactive), []);
eq('questionsOf(null) is empty', questionsOf(null), []);
eq('questionPoints sums declared points', questionPoints(off.written), 2);
eq('figure_url survives on the question', questionsOf(off.written)[2].figure_url, 'https://x/f.png');

/* ── effectiveDue: the three-source precedence ─────────────────────────────── */
section('effectiveDue precedence');

eq('offering default when no section override',
   effectiveDue(off, 'sec-other', null, NOW).source, 'offering');
eq('per-section override beats the offering default',
   effectiveDue(off, 'sec-M', null, NOW).source, 'section');
eq('extension beats the per-section override',
   effectiveDue(off, 'sec-M', '2026-12-01T00:00:00Z', NOW).source, 'extension');
eq('extension beats the offering default too',
   effectiveDue(off, null, '2026-12-01T00:00:00Z', NOW).source, 'extension');
eq('no dates at all => none',
   effectiveDue({ dueBySection: {}, dueAt: null }, null, null, NOW).source, 'none');

check('section deadline in the past is flagged past',
      effectiveDue(off, 'sec-M', null, NOW).isPast === true);
check('offering deadline in the future is not past',
      effectiveDue(off, 'sec-T', null, NOW).isPast === false);
check('null deadline is never past',
      effectiveDue({ dueBySection: {}, dueAt: null }, null, null, NOW).isPast === false);
eq('an unparseable date degrades to none rather than an Invalid Date',
   effectiveDue({ dueBySection: {}, dueAt: 'not-a-date' }, null, null, NOW).source, 'none');

/* ── the per-day schedule: level 3 of the precedence (migration 017) ───────── */
section('due_by_day → per-section resolution');

// The bug this exists for: a section created AFTER the lessons were scheduled has no
// assignment_due_dates row, so it fell through to the offering's due_at — which on every Fall
// 2026 row is the M-day date. A new T-day section was therefore silently one day early.
const M_DUE = '2026-08-12T23:59:59Z';
const T_DUE = '2026-08-13T23:59:59Z';
const dayOff = () => ({
  dueAt: M_DUE,                       // the offering default IS the M date — that is the trap
  dueBySection: { 'sec-explicit': LATER },
  dueByDay: { M: M_DUE, T: T_DUE },
});
const SECTIONS = [
  { id: 'sec-explicit', meeting_days: ['T'] },   // has its own row: the override must win
  { id: 'sec-newT',     meeting_days: ['T'] },   // added later: the actual bug
  { id: 'sec-newM',     meeting_days: ['M'] },
  { id: 'sec-noDays',   meeting_days: [] },      // roster-import default before the fix
  { id: 'sec-W',        meeting_days: ['W'] },   // a day the schedule does not mention
];

const r = resolveDueBySection(dayOff(), SECTIONS);
eq('a NEW T-day section resolves to the T deadline, not the M-day default',
   r.dueBySection['sec-newT'], T_DUE);
eq('a new M-day section resolves to the M deadline', r.dueBySection['sec-newM'], M_DUE);
eq('an EXPLICIT per-section row still wins over the per-day schedule',
   r.dueBySection['sec-explicit'], LATER);
check('the explicit section is not marked derived', !r.dueDerivedFor.has('sec-explicit'));
check('the new T section IS marked derived', r.dueDerivedFor.has('sec-newT'));
check('a section declaring no meeting days gets no derived date',
      r.dueBySection['sec-noDays'] === undefined);
check('a section whose day the schedule omits gets no derived date',
      r.dueBySection['sec-W'] === undefined);

// The counterfactual that proves the fix is load-bearing: without the per-day map, the same
// new T-day section reads the offering default and lands on the M date.
const noMap = resolveDueBySection({ dueAt: M_DUE, dueBySection: {}, dueByDay: {} }, SECTIONS);
check('WITHOUT due_by_day the new T section has no date of its own (the old bug)',
      noMap.dueBySection['sec-newT'] === undefined);
eq('...and effectiveDue then hands it the M-day default',
   effectiveDue({ dueAt: M_DUE, dueBySection: noMap.dueBySection }, 'sec-newT', null, NOW).due.toISOString(),
   new Date(M_DUE).toISOString());

const resolved = withResolvedDue(dayOff(), SECTIONS);
eq('effectiveDue reports source "day" for a derived deadline',
   effectiveDue(resolved, 'sec-newT', null, NOW).source, 'day');
eq('...and still reports "section" for an explicit row',
   effectiveDue(resolved, 'sec-explicit', null, NOW).source, 'section');
eq('...and "extension" still outranks a derived deadline',
   effectiveDue(resolved, 'sec-newT', '2026-12-01T00:00:00Z', NOW).source, 'extension');
eq('a section with no derivable date falls back to the offering default',
   effectiveDue(resolved, 'sec-W', null, NOW).source, 'offering');

// An offering that never went through the resolver behaves exactly as before.
eq('un-resolved offerings keep the old two-source behaviour',
   effectiveDue(off, 'sec-M', null, NOW).source, 'section');
eq('a malformed due_by_day (array) is ignored rather than throwing',
   resolveDueBySection({ dueAt: M_DUE, dueBySection: {}, dueByDay: [] }, SECTIONS)
     .dueBySection['sec-newT'], undefined);
check('resolveDueBySection does not mutate the offering it was given', (() => {
  const o = dayOff();
  resolveDueBySection(o, SECTIONS);
  return Object.keys(o.dueBySection).length === 1;
})());

/* ── isOpen ────────────────────────────────────────────────────────────────── */
section('isOpen');
check('no opens_at means always open', isOpen({ opensAt: null }, NOW) === true);
check('opens_at in the past means open', isOpen({ opensAt: EARLIER }, NOW) === true);
check('opens_at in the future means not open yet', isOpen({ opensAt: LATER }, NOW) === false);

/* ── the release window ────────────────────────────────────────────────────── */
section('releaseAt / isReleased');

const DAY = 86400000;
const dueIn = (days) => new Date(NOW.getTime() + days * DAY);
const noOpen = { opensAt: null };

check('LOOKAHEAD_DAYS is the documented 7', LOOKAHEAD_DAYS === 7);

// The default window, measured back from the student's own deadline.
check('due inside the window is released',
  isReleased(noOpen, dueIn(LOOKAHEAD_DAYS - 1), NOW) === true);
check('due beyond the window is not released yet',
  isReleased(noOpen, dueIn(LOOKAHEAD_DAYS + 1), NOW) === false);
check('due exactly LOOKAHEAD_DAYS out is released — the boundary is inclusive',
  isReleased(noOpen, dueIn(LOOKAHEAD_DAYS), NOW) === true);
check('a past deadline stays released — the window never withdraws finished work',
  isReleased(noOpen, dueIn(-30), NOW) === true);
/* The default release instant is floored to the START of the day LOOKAHEAD_DAYS before the
 * deadline, and that is not cosmetic. Deadlines are 2359, so plain subtraction would open the
 * assignment at 2359 — absent for the whole of the day it is supposed to appear, delivering six
 * days against a note that promises seven. */
const flooredExpectation = (() => {
  const d = new Date(dueIn(10).getTime() - LOOKAHEAD_DAYS * DAY);
  d.setHours(0, 0, 0, 0);
  return d;
})();
eq('the default release instant is floored to the start of its day',
  releaseAt(noOpen, dueIn(10)).toISOString(), flooredExpectation.toISOString());
check('the default release instant is local midnight, not the deadline hour',
  releaseAt(noOpen, dueIn(10)).getHours() === 0 &&
  releaseAt(noOpen, dueIn(10)).getMinutes() === 0);

// A 2359 deadline must open at the start of its release day, not one minute before midnight.
const lateDeadline = new Date('2026-08-20T23:59:00');
const lateRelease = releaseAt(noOpen, lateDeadline);
eq('a 2359 deadline releases at the start of the day 7 days earlier',
  `${lateRelease.getFullYear()}-${String(lateRelease.getMonth() + 1).padStart(2, '0')}`
  + `-${String(lateRelease.getDate()).padStart(2, '0')}T`
  + `${String(lateRelease.getHours()).padStart(2, '0')}:${String(lateRelease.getMinutes()).padStart(2, '0')}`,
  '2026-08-13T00:00');

// An explicit date is an instant the director chose — it is NOT floored.
eq('an explicit opens_at keeps its exact time', releaseAt({ opensAt: '2026-08-13T08:30:00Z' }, dueIn(10)).toISOString(),
  new Date('2026-08-13T08:30:00Z').toISOString());

// An undated assignment has no window to be outside of — hiding it would hide it all term.
check('no deadline and no opens_at is always released', isReleased(noOpen, null, NOW) === true);
check('no deadline and no opens_at has no release instant', releaseAt(noOpen, null) === null);

// An explicit opens_at overrides the default IN BOTH DIRECTIONS.
check('opens_at can release earlier than the default window would',
  isReleased({ opensAt: EARLIER }, dueIn(90), NOW) === true);
check('opens_at can hold back something the default window would have released',
  isReleased({ opensAt: LATER }, dueIn(1), NOW) === false);
check('opens_at gates an undated assignment too',
  isReleased({ opensAt: LATER }, null, NOW) === false);
eq('opens_at is used verbatim, not offset', releaseAt({ opensAt: EARLIER }, dueIn(10)).toISOString(),
  new Date(EARLIER).toISOString());

// A garbage opens_at must not swallow the default — it falls through to the window.
check('an unparseable opens_at falls back to the default window',
  isReleased({ opensAt: 'not-a-date' }, dueIn(30), NOW) === false);

/* ── releaseNote ───────────────────────────────────────────────────────────── */
section('releaseNote');
eq('nothing withheld produces no note', releaseNote(0), '');
eq('undefined produces no note', releaseNote(undefined), '');
check('one withheld reads as singular', releaseNote(1).includes('1 more assignment is'));
check('several read as plural', releaseNote(4).includes('4 more assignments are'));
check('the note states the same number of days the rule uses',
  releaseNote(3).includes(`opens ${LOOKAHEAD_DAYS} days before`));

/* ── deriveStatus ──────────────────────────────────────────────────────────── */
section('deriveStatus');

const draftWithWork = { status: 'draft', activities: { 'act-w': { content: { q1: 'x' } } } };
const committed = { status: 'committed', activities: { 'act-w': {} } };
const emptyDraft = { status: 'draft', activities: {} };

eq('finalized grade => graded',
   deriveStatus({ submission: committed, grade: { is_finalized: true }, isPast: true }), 'graded');
eq('committed + past due, not finalized => pending',
   deriveStatus({ submission: committed, grade: null, isPast: true }), 'pending');
eq('committed before the deadline => submitted',
   deriveStatus({ submission: committed, grade: null, isPast: false }), 'submitted');
eq('work saved but not committed => in-progress',
   deriveStatus({ submission: draftWithWork, grade: null, isPast: false }), 'in-progress');
eq('nothing at all, before the deadline => not-started',
   deriveStatus({ submission: null, grade: null, isPast: false }), 'not-started');
eq('nothing at all, past the deadline => overdue',
   deriveStatus({ submission: null, grade: null, isPast: true }), 'overdue');
eq('an empty draft is not "in progress"',
   deriveStatus({ submission: emptyDraft, grade: null, isPast: false }), 'not-started');
// An unfinalized grade must not read as graded — a student cannot see one anyway (RLS),
// but faculty views share this function and must not show a draft score as final.
eq('unfinalized grade does not count as graded',
   deriveStatus({ submission: committed, grade: { is_finalized: false }, isPast: false }), 'submitted');

/* ── canSwitchActivity — mirrors submissions_lock_activity() ───────────────── */
section('canSwitchActivity');

const written = { id: 'act-w', modality: 'written' };
const interactive = { id: 'act-i', modality: 'interactive' };
const offLock = { switchPolicy: 'lock_on_commit', activities: [written, interactive] };
const offFree = { switchPolicy: 'free_until_commit', activities: [written, interactive] };
const offOneWay = { switchPolicy: 'one_way_to_interactive', activities: [written, interactive] };

check('nothing chosen yet => free to choose',
      canSwitchActivity(offLock, { chosenActivityId: null, status: 'draft' }, interactive) === true);
check('chosen but still a draft => free to change',
      canSwitchActivity(offLock, { chosenActivityId: 'act-w', status: 'draft' }, interactive) === true);
check('lock_on_commit blocks a switch after commit',
      canSwitchActivity(offLock, { chosenActivityId: 'act-w', status: 'committed' }, interactive) === false);
check('free_until_commit blocks a switch after commit',
      canSwitchActivity(offFree, { chosenActivityId: 'act-w', status: 'committed' }, interactive) === false);
check('one_way_to_interactive ALLOWS written -> interactive after commit',
      canSwitchActivity(offOneWay, { chosenActivityId: 'act-w', status: 'committed' }, interactive) === true);
check('one_way_to_interactive BLOCKS interactive -> written after commit',
      canSwitchActivity(offOneWay, { chosenActivityId: 'act-i', status: 'committed' }, written) === false);
check('re-selecting what is already chosen is always allowed',
      canSwitchActivity(offLock, { chosenActivityId: 'act-w', status: 'committed' }, written) === true);

/* ── isActivityAvailable — mirrors offering_activities.available_after ─────── */
section('isActivityAvailable');

const always = { availableAfter: 'always', isVisible: true };
const afterSubmit = { availableAfter: 'submit', isVisible: true };
const afterDue = { availableAfter: 'due', isVisible: true };

check('always => available', isActivityAvailable(always, { submission: null, isPast: false }) === true);
check('submit-gated is hidden before commit',
      isActivityAvailable(afterSubmit, { submission: { status: 'draft' }, isPast: false }) === false);
check('submit-gated opens once committed',
      isActivityAvailable(afterSubmit, { submission: { status: 'committed' }, isPast: false }) === true);
check('due-gated is hidden before the deadline',
      isActivityAvailable(afterDue, { submission: null, isPast: false }) === false);
check('due-gated opens after the deadline (study mode)',
      isActivityAvailable(afterDue, { submission: null, isPast: true }) === true);
check('is_visible=false is never available',
      isActivityAvailable({ availableAfter: 'always', isVisible: false }, { submission: null, isPast: false }) === false);

/* ── isArtifactLaunchable — attached is not the same as ready ──────────────────
 * The Assignments card and the student's lesson page both decide whether to offer a Launch, and
 * both must decide it the same way. Before this rule existed the card showed a green ✓ for an
 * interaction with no URL while the button beside it was disabled, and the student page opened
 * `'#'` — a second copy of the page — which reads as the site being broken. That state is now
 * ORDINARY: a Free-Response lesson may attach its interaction in August and get the address in
 * October (director, 2026-07-30). */
section('isArtifactLaunchable');

check('https URL is launchable',
      isArtifactLaunchable({ content: { artifact_url: 'https://claude.ai/public/artifacts/abc' } }) === true);
check('http URL is launchable',
      isArtifactLaunchable({ content: { artifact_url: 'http://example.edu/lesson' } }) === true);
check('attached with no URL at all is NOT launchable — the case the director hit',
      isArtifactLaunchable({ content: {} }) === false);
check('empty-string URL is not launchable',
      isArtifactLaunchable({ content: { artifact_url: '' } }) === false);
check('a bare slug someone typed into the URL box is not launchable',
      isArtifactLaunchable({ content: { artifact_url: 'lesson-02-charge' } }) === false);
// The value reaches an href and window.open, so the scheme check is a security boundary too.
check('javascript: is refused',
      isArtifactLaunchable({ content: { artifact_url: 'javascript:alert(1)' } }) === false);
check('data: is refused',
      isArtifactLaunchable({ content: { artifact_url: 'data:text/html,<script>' } }) === false);
check('scheme match is case-insensitive',
      isArtifactLaunchable({ content: { artifact_url: 'HTTPS://claude.ai/x' } }) === true);
check('no activity at all is not launchable (written-only lesson)',
      isArtifactLaunchable(null) === false);

/* ── pointsFromEffort — MUST match app.grades_points_from_effort() ─────────── */
section('pointsFromEffort (migration-019 curve)');

eq('effort 5 => full', pointsFromEffort(5, 2), 2);
eq('effort 4 => full', pointsFromEffort(4, 2), 2);
eq('effort 3 => full', pointsFromEffort(3, 2), 2);
eq('effort 2 => one point', pointsFromEffort(2, 2), 1);
eq('effort 1 => one point', pointsFromEffort(1, 2), 1);
eq('effort 0 => zero', pointsFromEffort(0, 2), 0);
eq('effort null => zero', pointsFromEffort(null, 2), 0);

// FULL credit scales with the assignment. PARTIAL credit deliberately does not — it is a flat
// acknowledgement that the student engaged, not a fraction of the lesson. Until migration 019
// partial was `possible / 2`, which is the same 1 at 2 points and a half point at 3.
eq('scales to a 3-point offering (full)', pointsFromEffort(5, 3), 3);
eq('3-point offering, partial is 1 not 1.5', pointsFromEffort(2, 3), 1);
eq('scales to a 10-point offering (full)', pointsFromEffort(3, 10), 10);
eq('10-point offering, partial is still 1', pointsFromEffort(1, 10), 1);
// The clamp, mirroring the trigger's LEAST: partial can never exceed — or equal, above 1 —
// what the assignment is worth. Without it, a 1-point lesson would pay full credit for
// effort 1, and anything smaller would breach grades_within_bounds on write.
eq('1-point offering, partial is capped at the assignment', pointsFromEffort(2, 1), 1);
eq('half-point offering, partial is clamped', pointsFromEffort(1, 0.5), 0.5);

eq('displayPoints uses points_earned when grading_mode=points',
   displayPoints({ points_earned: '1.50' }, { gradingMode: 'points' }), 1.5);
eq('displayPoints derives from effort when grading_mode=effort',
   displayPoints({ effort: 4, points_possible: 2 }, { gradingMode: 'effort', pointsPossible: 2 }), 2);
eq('displayPoints(null) is null', displayPoints(null, off), null);

/* ── shapeSubmission ───────────────────────────────────────────────────────── */
section('shapeSubmission');

const sub = shapeSubmission({
  id: 'sub-1', enrollment_id: 'enr-1', assignment_offering_id: 'off-1',
  chosen_activity_id: 'act-w', status: 'committed', committed_at: LATER,
  submission_activities: [
    { id: 'sa-1', activity_id: 'act-w', content: { q1: 'answer' }, report_markdown: null, is_final: true },
    { id: 'sa-2', activity_id: 'act-i', content: null, report_markdown: '# report', is_final: false },
  ],
});
eq('submission activities keyed by activity id', Object.keys(sub.activities).sort(), ['act-i', 'act-w']);
eq('written answers land in content', sub.activities['act-w'].content.q1, 'answer');
eq('interactive report lands in reportMarkdown', sub.activities['act-i'].reportMarkdown, '# report');
// BOTH paths are kept when a student does both — the revealed-preference signal.
check('both modalities retained on one submission', Object.keys(sub.activities).length === 2);

/* ── answeredCount ─────────────────────────────────────────────────────────── */
section('answeredCount');
const qs = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
eq('counts non-blank answers', answeredCount({ q1: 'a', q2: '   ', q3: 'c' }, qs), 2);
eq('null answers => 0', answeredCount(null, qs), 0);
eq('empty object => 0', answeredCount({}, qs), 0);

/* ── scope: what you SEE vs what you TEACH ──────────────────────────────────
 *
 * WHY THIS EARNS ITS PLACE
 *   A director's staff row carries section_id NULL, which app.staff_sections() expands to EVERY
 *   section of the offering — so ctx.sectionIds for a director is the whole course. Anything that
 *   presents itself as a personal worklist ("Needs your attention", the Grade queue) has to use
 *   the narrower list or it counts nine other instructors' ungraded work as yours. That bug shipped
 *   in the due-out row and was fixed on 2026-07-23; it is invisible from the page, because a wrong
 *   number renders exactly like a right one.
 *
 *   The FALLBACK is the half that is easy to get wrong in the other direction: someone who staffs
 *   the offering but teaches no section of it must get the course-wide list, not an empty one.
 */
section('taughtSectionIds / actionableSections');

const staffRow = (sectionId, offering = 'off-1') =>
  ({ course_offering_id: offering, section_id: sectionId, role: 'instructor' });

const instructorCtx = {
  currentOffering: 'off-1',
  sectionIds: ['s1', 's2'],
  staff: [staffRow('s1'), staffRow('s2')],
};
// A director: one offering-wide row (section_id NULL) plus a section they actually teach.
const directorCtx = {
  currentOffering: 'off-1',
  sectionIds: ['s1', 's2', 's3', 's4'],
  staff: [staffRow(null), staffRow('s2')],
};
const pureDirectorCtx = { ...directorCtx, staff: [staffRow(null)] };

eq('an offering-wide row is NOT a teaching assignment', taughtSectionIds(pureDirectorCtx), []);
eq('a director who teaches one section is credited with exactly that one',
   taughtSectionIds(directorCtx), ['s2']);
eq('rows from another offering are ignored',
   taughtSectionIds({ ...instructorCtx, staff: [staffRow('s9', 'other')] }), []);
eq('duplicate section rows collapse',
   taughtSectionIds({ ...instructorCtx, staff: [staffRow('s1'), staffRow('s1')] }), ['s1']);

eq('a director acts on the sections they teach, not the whole course',
   actionableSections(directorCtx), { ids: ['s2'], narrowed: true });
// An instructor teaches everything they can see, so nothing is narrowed and the UI must not claim
// otherwise — "your sections" on a view that is already only your sections is noise.
eq('an instructor sees no narrowing, because there is none',
   actionableSections(instructorCtx), { ids: ['s1', 's2'], narrowed: false });
// The fallback. Empty-because-nothing-outstanding and empty-because-you-teach-nothing must not
// look the same, and only one of them is true here.
eq('someone who teaches nothing falls back to everything they staff',
   actionableSections(pureDirectorCtx), { ids: ['s1', 's2', 's3', 's4'], narrowed: false });
eq('no sections at all is empty, not a crash',
   actionableSections({ currentOffering: 'off-1', sectionIds: [], staff: [] }),
   { ids: [], narrowed: false });
eq('a missing ctx is survivable', actionableSections(undefined), { ids: [], narrowed: false });
// A stale section row (renamed away, or a course switch mid-flight) must not narrow the scope to
// a section that is not in view — that would render a dashboard of zeroes looking like real data.
eq('a taught section outside the visible set does not narrow anything',
   actionableSections({ ...instructorCtx, staff: [staffRow('gone')] }),
   { ids: ['s1', 's2'], narrowed: false });

/* ── misc ──────────────────────────────────────────────────────────────────── */
section('misc helpers');
eq('lessonNumber from a slug', lessonNumber('preflight-08', null), 8);
eq('lessonNumber from a lesson slug', lessonNumber('lesson-02-charge', null), 2);
eq('lessonNumber falls back to the title', lessonNumber('x', 'Lesson 14 — Fields'), 14);
eq('lessonNumber gives null when absent', lessonNumber('preflight', 'no digits'), null);
eq('chunked splits at the boundary', chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq('chunked of empty is empty', chunked([], 2), []);
