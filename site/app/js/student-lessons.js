// student-lessons.js — lesson-centric view for a logged-in student, against schema `app`.
//
// Spec: docs/architecture/STUDENT-LESSON-VIEW.md §4 (states) and §9 (this file).
//
// ── WHY THIS FILE IS NOW THIN ────────────────────────────────────────────────────
// It used to carry its own queries, its own deadline maths, and its own state machine over
// four tables (lessons, assignments, interactions, responses, lesson_completions) — because
// in `public` a "lesson" was a reconciliation layer bolted over two parallel worlds, and the
// student view had to do that reconciliation itself.
//
// In `app` a lesson IS an assignment offering: one container, whose activities are the paths
// through it. So the reconciliation is gone, and this file is a PROJECTION over
// student-data.js rather than a second query layer. That is deliberate — two independent
// loaders is exactly how the old frontend drifted into showing a lesson twice, once per
// modality, as two separate mandatory items (STUDENT-LESSON-VIEW §1).
//
// The eight-state vocabulary below is preserved verbatim, because it is the student-facing
// contract the page renders and the doc describes. Only its derivation changed.
//
// `lesson_completions` is gone with no replacement: it existed to reconcile two grade
// sources, and there is now exactly one (app.grades, UNIQUE per enrolment per offering).

import { loadAssignmentStatuses } from './student-data.js';
import { questionsOf, answeredCount, displayPoints } from './schema.js';

/**
 * The states a lesson can be in for one student (STUDENT-LESSON-VIEW §4).
 * Computed once, here — never re-derived in a renderer, so the list and the dashboard
 * cannot disagree.
 */
export const STATE = {
  NOT_STARTED: 'not-started',   // 1 · nothing yet, still open
  DRAFT:       'draft',         // 2 · written answers saved, not submitted
  SUBMITTED:   'submitted',     // 3 · written submitted — still editable until the deadline
  COMPLETE:    'complete',      // 4 · interaction submitted — the only lock
  GRADING:     'grading',       // 5 · past due, submitted, not yet released
  GRADED:      'graded',        // 6 · instructor released the grade
  MISSED:      'missed',        // 7 · past due, nothing submitted → 0
};

/** Status-dot colour per state. Deliberately modality-neutral: a `.tag` says which path was
 *  taken, the dot only says how far along they are. Colouring the dot by modality would make
 *  one path read as "better" at a glance down the whole list (STUDENT-LESSON-VIEW §10). */
export const STATE_DOT = {
  [STATE.NOT_STARTED]: 'grey',
  [STATE.DRAFT]:       'amber',
  [STATE.SUBMITTED]:   'green',
  [STATE.COMPLETE]:    'green',
  [STATE.GRADING]:     'blue',
  [STATE.GRADED]:      'green',
  [STATE.MISSED]:      'red',
};

/**
 * Map one stitched assignment item onto the lesson state machine.
 *
 * The one asymmetry worth naming, carried over unchanged from the old model: committing the
 * INTERACTIVE path is a lock (STATE.COMPLETE), while committing the WRITTEN path is not
 * (STATE.SUBMITTED — still editable until the deadline). The database agrees: switch_policy
 * locks which ACTIVITY carries credit, but nothing stops a student refining their written
 * answers afterwards, and nothing should.
 */
function resolveState(item) {
  const grade = item.grade;
  if (grade?.is_finalized) return STATE.GRADED;

  const committed = item.submission?.status === 'committed';
  const chosenModality = item.chosenActivity?.modality || null;

  if (committed) {
    if (item.isPast) return STATE.GRADING;
    return chosenModality === 'interactive' ? STATE.COMPLETE : STATE.SUBMITTED;
  }
  if (item.isPast) return STATE.MISSED;
  return item.answered > 0 ? STATE.DRAFT : STATE.NOT_STARTED;
}

/**
 * Every published lesson for the student's current offering, one row each.
 *
 * @returns {Promise<Array>} sorted by lesson number then deadline, each:
 *   { id, offeringId, title, description, lesson_number, objectives, points,
 *     preflight, interaction,        // the two activities; either may be null
 *     due, isPast, isExtended,
 *     draft,                         // { answers } | null
 *     completion,                    // { path, points, is_finalized } | null — shape preserved
 *     state, dot, writtenAnswerCount,
 *     canChoose, hasInteraction }
 */
export async function loadLessonStatuses(ctx) {
  const items = await loadAssignmentStatuses(ctx);

  const rows = items.map(item => {
    const written = item.written;
    const interactive = item.interactive;
    const state = resolveState(item);
    const savedAnswers = written ? (item.submission?.activities?.[written.id]?.content || null) : null;

    // `completion` keeps its old shape so the page's renderers are untouched, but it is now
    // derived from the single grades row rather than a separate lesson_completions table.
    const committed = item.submission?.status === 'committed';
    const completion = committed ? {
      path: item.chosenActivity?.modality === 'interactive' ? 'interaction' : 'preflight',
      points: displayPoints(item.grade, item) ?? 0,
      understanding: item.grade?.diagnostic?.overall_understanding ?? null,
      is_finalized: !!item.grade?.is_finalized,
      completed_at: item.submission?.committedAt || null,
    } : null;

    return {
      id: item.offeringId,
      offeringId: item.offeringId,
      title: item.title,
      description: item.description,
      lesson_number: item.position ?? null,
      objectives: item.objectives,
      points: item.pointsPossible,

      // The two paths, under the names the page already uses.
      preflight: written ? {
        id: written.id, title: written.title,
        questions: questionsOf(written),
        reading_link: written.content?.reading_link || null,
        gradingRole: written.gradingRole,
      } : null,
      interaction: interactive ? {
        id: interactive.id, slug: interactive.slug, title: interactive.title,
        description: interactive.content?.description || null,
        artifact_url: interactive.content?.artifact_url || null,
        gradingRole: interactive.gradingRole,
      } : null,

      due: item.due, isPast: item.isPast, isExtended: item.dueSource === 'extension',
      draft: savedAnswers ? { answers: savedAnswers } : null,
      completion,
      state, dot: STATE_DOT[state],
      writtenAnswerCount: answeredCount(savedAnswers, questionsOf(written)),

      // A choice is only real while BOTH paths are graded this term and the lesson is still
      // open and uncommitted. `isChoice` is derived from offering_activities, not declared —
      // there is no completion_policy column to drift out of step with reality.
      canChoose: item.isChoice && !!written && !!interactive && !item.isPast && !committed,
      hasInteraction: !!interactive,
      // Kept for renderers that showed the policy; derived, not stored.
      completion_policy: item.isChoice ? 'choice' : 'preflight',
    };
  });

  // Position is optional; fall back to the deadline so ordering is always stable.
  return rows.sort((a, b) => {
    const an = a.lesson_number, bn = b.lesson_number;
    if (an != null && bn != null && an !== bn) return an - bn;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity);
  });
}

/** One view-model for the student dashboard (STUDENT-LESSON-VIEW §8). */
export async function loadStudentLessonDashboard(ctx) {
  if (!ctx.currentOffering) return { noCourse: true };

  const lessons = await loadLessonStatuses(ctx);

  const toDo   = lessons.filter(l => l.state === STATE.NOT_STARTED || l.state === STATE.DRAFT);
  const missed = lessons.filter(l => l.state === STATE.MISSED);
  const graded = lessons.filter(l => l.state === STATE.GRADED);
  const done   = lessons.filter(l => l.completion);

  // Points earned out of points available — NOT a correctness percentage. A lesson is worth
  // its offering's points_possible; showing a percentage of per-question scores here would
  // tell cadets they're graded on getting it right, which is the one thing the choice UI must
  // not imply (STUDENT-LESSON-VIEW §2, §8).
  const earned    = done.reduce((s, l) => s + (l.completion.points || 0), 0);
  const available = lessons.reduce((s, l) => s + (l.points ?? 2), 0);

  return {
    noCourse: false,
    stats: { toDo: toDo.length, missed: missed.length, graded: graded.length, earned, available },
    lessons, toDo, missed, graded,
    upNext: toDo.slice(0, 6),
  };
}
