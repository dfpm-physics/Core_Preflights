// test-schema.mjs — the pure domain rules in site/app/js/schema.js.
// No network, no login: these import the shipped module and exercise it directly.

import { check, eq, section } from './harness.mjs';
import {
  shapeOffering, shapeSubmission, effectiveDue, isOpen, deriveStatus,
  canSwitchActivity, isActivityAvailable, pointsFromEffort, displayPoints,
  questionsOf, questionPoints, answeredCount, lessonNumber, chunked,
} from '../../site/app/js/schema.js';

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

/* ── isOpen ────────────────────────────────────────────────────────────────── */
section('isOpen');
check('no opens_at means always open', isOpen({ opensAt: null }, NOW) === true);
check('opens_at in the past means open', isOpen({ opensAt: EARLIER }, NOW) === true);
check('opens_at in the future means not open yet', isOpen({ opensAt: LATER }, NOW) === false);

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

/* ── pointsFromEffort — MUST match app.grades_points_from_effort() ─────────── */
section('pointsFromEffort (migration-013 curve)');

eq('effort 5 => full', pointsFromEffort(5, 2), 2);
eq('effort 4 => full', pointsFromEffort(4, 2), 2);
eq('effort 3 => full', pointsFromEffort(3, 2), 2);
eq('effort 2 => half', pointsFromEffort(2, 2), 1);
eq('effort 1 => half', pointsFromEffort(1, 2), 1);
eq('effort 0 => zero', pointsFromEffort(0, 2), 0);
eq('effort null => zero', pointsFromEffort(null, 2), 0);
// The curve scales, so a 10-point assignment works off the same 0–5 scale.
eq('scales to a 10-point offering (full)', pointsFromEffort(3, 10), 10);
eq('scales to a 10-point offering (half)', pointsFromEffort(1, 10), 5);
eq('half of an odd value rounds to 2dp like the trigger', pointsFromEffort(1, 5), 2.5);

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

/* ── misc ──────────────────────────────────────────────────────────────────── */
section('misc helpers');
eq('lessonNumber from a slug', lessonNumber('preflight-08', null), 8);
eq('lessonNumber from a lesson slug', lessonNumber('lesson-02-charge', null), 2);
eq('lessonNumber falls back to the title', lessonNumber('x', 'Lesson 14 — Fields'), 14);
eq('lessonNumber gives null when absent', lessonNumber('preflight', 'no digits'), null);
eq('chunked splits at the boundary', chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq('chunked of empty is empty', chunked([], 2), []);
