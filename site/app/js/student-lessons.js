// student-lessons.js — lesson-centric queries for a logged-in student.
//
// The student's view of a lesson: which paths it offers, where they are in it, and what their
// single 2-point grade is. Replaces the two parallel worlds in student-data.js (assignments and
// interactions listed side by side, each with its own to-do count) with one lesson per row.
//
// Spec: docs/architecture/STUDENT-LESSON-VIEW.md §4 (states) and §9 (this file).
// Model + rules: docs/architecture/LESSON-UNIFICATION.md (see its §6 amendment for the lock).
//
// Requires migration 021. Without lesson_completions rows every lesson resolves to 'not-started'.

import { db } from './supabase.js';
import { isMDay } from './util.js';

/**
 * The eight states a lesson can be in for one student (STUDENT-LESSON-VIEW §4).
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

/** Count non-empty answers in a responses.answers blob. Drives warning 2 (§6). */
function countAnswers(answers) {
  return Object.values(answers || {}).filter(v => String(v ?? '').trim().length > 0).length;
}

/**
 * Effective deadline for this student on this lesson.
 *
 * MIRRORS lesson_due_for_student() in migration 021 — section day picks the M/T date, and an
 * extension REPLACES it (lesson-scoped wins over assignment-scoped). This copy exists only so
 * the UI can gate before the server refuses; the DB is authoritative. If the two ever disagree
 * the student gets a confusing failure, so a change to one is a change to both.
 */
function effectiveDue(lesson, sectionId, extensionISO) {
  const m = isMDay(sectionId);
  const base = m ? (lesson.due_date_m || lesson.due_date_t)
                 : (lesson.due_date_t || lesson.due_date_m);
  const raw = extensionISO || base;
  const due = raw ? new Date(raw) : null;
  if (!due || isNaN(due)) return { due: null, isPast: false };
  return { due, isPast: due < new Date() };
}

function resolveState(completion, draft, isPast) {
  if (completion) {
    if (completion.is_finalized) return STATE.GRADED;
    if (isPast) return STATE.GRADING;
    // An interaction completion is the lock; a preflight completion still allows editing.
    return completion.path === 'interaction' ? STATE.COMPLETE : STATE.SUBMITTED;
  }
  if (isPast) return STATE.MISSED;
  return countAnswers(draft?.answers) > 0 ? STATE.DRAFT : STATE.NOT_STARTED;
}

/**
 * Every published lesson for the student's course, resolved to one row each.
 *
 * @returns {Promise<Array>} sorted by lesson_number then deadline, each:
 *   { id, title, description, lesson_number, completion_policy, objectives, points,
 *     preflight, interaction,      // joined component rows; either may be null
 *     due, isPast, isExtended,
 *     draft,                       // { answers, is_final } | null
 *     completion,                  // { path, points, understanding, is_finalized } | null
 *     state, dot, writtenAnswerCount,
 *     canChoose,                   // choice policy AND both components attached AND still open
 *     hasInteraction }             // artifact is launchable — always true if one is attached
 */
export async function loadLessonStatuses(ctx) {
  const sid = ctx.studentRow.student_id;
  const sectionId = ctx.studentRow.section_id;

  const { data: lessons } = await db.from('lessons')
    .select('id, title, description, lesson_number, completion_policy, objectives, points, ' +
            'preflight_id, interaction_id, due_date_m, due_date_t')
    .eq('is_published', true).eq('course_id', ctx.currentCourse)
    .order('lesson_number', { ascending: true, nullsFirst: false });

  if (!lessons?.length) return [];

  const lessonIds = lessons.map(l => l.id);
  const preflightIds = lessons.map(l => l.preflight_id).filter(Boolean);
  const interactionIds = lessons.map(l => l.interaction_id).filter(Boolean);

  // Batched — no N+1. Extensions are fetched on both scopes (021 allows either).
  const [{ data: asgns }, { data: inters }, { data: responses }, { data: completions },
         { data: exts }] = await Promise.all([
    preflightIds.length
      ? db.from('assignments')
          .select('id, title, description, questions, reading_link, figure_url')
          .in('id', preflightIds)
      : Promise.resolve({ data: [] }),
    interactionIds.length
      ? db.from('interactions').select('id, title, description, artifact_url')
          .in('id', interactionIds)
      : Promise.resolve({ data: [] }),
    preflightIds.length
      ? db.from('responses').select('assignment_id, answers, is_final, updated_at')
          .eq('student_id', sid).in('assignment_id', preflightIds)
      : Promise.resolve({ data: [] }),
    db.from('lesson_completions')
      .select('lesson_id, path, points, understanding, is_finalized, completed_at')
      .eq('student_id', sid).in('lesson_id', lessonIds),
    db.from('extensions').select('assignment_id, lesson_id, extended_due_date')
      .eq('student_id', sid),
  ]);

  const asgnMap  = Object.fromEntries((asgns  || []).map(a => [a.id, a]));
  const interMap = Object.fromEntries((inters || []).map(i => [i.id, i]));
  const respMap  = Object.fromEntries((responses   || []).map(r => [r.assignment_id, r]));
  const compMap  = Object.fromEntries((completions || []).map(c => [c.lesson_id, c]));

  // Lesson-scoped extension wins over an assignment-scoped one on the lesson's preflight —
  // and an assignment-scoped grant extends the WHOLE lesson (both paths), matching 021.
  const extByLesson = Object.fromEntries(
    (exts || []).filter(e => e.lesson_id).map(e => [e.lesson_id, e.extended_due_date]));
  const extByAsgn = Object.fromEntries(
    (exts || []).filter(e => e.assignment_id).map(e => [e.assignment_id, e.extended_due_date]));

  const rows = lessons.map(l => {
    const ext = extByLesson[l.id] || (l.preflight_id ? extByAsgn[l.preflight_id] : null) || null;
    const { due, isPast } = effectiveDue(l, sectionId, ext);

    const preflight  = l.preflight_id  ? (asgnMap[l.preflight_id]   || null) : null;
    const interaction = l.interaction_id ? (interMap[l.interaction_id] || null) : null;
    const draft = l.preflight_id ? (respMap[l.preflight_id] || null) : null;
    const completion = compMap[l.id] || null;
    const state = resolveState(completion, draft, isPast);

    return {
      ...l,
      preflight, interaction,
      due, isPast, isExtended: !!ext,
      draft, completion, state,
      dot: STATE_DOT[state],
      writtenAnswerCount: countAnswers(draft?.answers),
      // A choice is only real while both components exist and the lesson is still open.
      canChoose: l.completion_policy === 'choice' && !!preflight && !!interaction && !isPast
                 && !completion,
      hasInteraction: !!interaction,
    };
  });

  // lesson_number is optional; fall back to the deadline so ordering is always stable.
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
  if (!ctx.currentCourse) return { noCourse: true };

  const lessons = await loadLessonStatuses(ctx);

  const toDo    = lessons.filter(l => l.state === STATE.NOT_STARTED || l.state === STATE.DRAFT);
  const missed  = lessons.filter(l => l.state === STATE.MISSED);
  const graded  = lessons.filter(l => l.state === STATE.GRADED);
  const done    = lessons.filter(l => l.completion);

  // Points earned out of points available — NOT a correctness percentage. A lesson is 2 points
  // of effort (LESSON-UNIFICATION D3); showing a percentage of per-question scores here would
  // tell cadets they're graded on getting it right, which is the one thing the choice UI must
  // not imply (STUDENT-LESSON-VIEW §2, §8).
  const earned    = done.reduce((s, l) => s + (l.completion.points || 0), 0);
  const available = lessons.reduce((s, l) => s + (l.points ?? 2), 0);

  return {
    noCourse: false,
    stats: {
      toDo: toDo.length,
      missed: missed.length,
      graded: graded.length,
      earned, available,
    },
    lessons, toDo, missed, graded,
    upNext: toDo.slice(0, 6),
  };
}
