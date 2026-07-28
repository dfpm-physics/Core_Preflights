// test-schema.mjs — the pure domain rules in site/js/schema.js.
// No network, no login: these import the shipped module and exercise it directly.

import { check, eq, section } from './harness.mjs';
import {
  shapeOffering, shapeSubmission, effectiveDue, isOpen, deriveStatus,
  resolveDueBySection, withResolvedDue,
  canSwitchActivity, isActivityAvailable, pointsFromEffort, displayPoints,
  questionsOf, questionPoints, answeredCount, lessonNumber, chunked,
  taughtSectionIds, actionableSections,
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
