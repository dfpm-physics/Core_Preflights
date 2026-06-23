// student-data.js — dashboard + list queries for a logged-in student.
// Uses only existing tables. All filtered by the student's id + course; batched, no N+1.

import { db } from './supabase.js';
import { dueDateForSection } from './util.js';

/**
 * Full assignment status list for the student (used by both dashboard + assignments page).
 * @returns {Promise<Array>} items sorted by due date asc, each:
 *   { id, title, description, questions, qCount, totalPts, reading_link, figure_url,
 *     due, isPast, submittedAt, status, score|null }
 *   status ∈ 'graded' | 'pending' | 'submitted' | 'overdue' | 'not-started'
 */
export async function loadAssignmentStatuses(ctx) {
  const sid = ctx.studentRow.student_id;
  const sectionId = ctx.studentRow.section_id;

  const { data: asgns } = await db.from('assignments')
    .select('id, title, description, due_date_m, due_date_t, reading_link, figure_url, questions')
    .eq('is_published', true).eq('course_id', ctx.currentCourse)
    .order('due_date_m', { ascending: true, nullsFirst: false });

  if (!asgns?.length) return [];
  const asgnIds = asgns.map(a => a.id);

  const [{ data: responses }, { data: scores }, { data: exts }] = await Promise.all([
    db.from('responses').select('assignment_id, updated_at')
      .eq('student_id', sid).in('assignment_id', asgnIds),
    db.from('scores').select('assignment_id, total_score, max_total, question_scores, is_finalized')
      .eq('student_id', sid).eq('is_finalized', true).in('assignment_id', asgnIds),
    db.from('extensions').select('assignment_id, extended_due_date')
      .eq('student_id', sid).in('assignment_id', asgnIds),
  ]);

  const subMap = Object.fromEntries((responses || []).map(r => [r.assignment_id, r.updated_at]));
  const scoreMap = Object.fromEntries((scores || []).map(s => [s.assignment_id, s]));
  const extMap = Object.fromEntries((exts || []).map(e => [e.assignment_id, e.extended_due_date]));

  return asgns.map(a => {
    const { due, isPast } = dueDateForSection(a, sectionId, extMap[a.id]);
    const submittedAt = subMap[a.id];
    const score = scoreMap[a.id] || null;
    let status;
    if (score) status = 'graded';
    else if (submittedAt && isPast) status = 'pending';
    else if (submittedAt) status = 'submitted';
    else if (isPast) status = 'overdue';
    else status = 'not-started';

    const qCount = a.questions?.length ?? 0;
    const totalPts = (a.questions || []).reduce((s, q) => s + (q.points || 0), 0);
    return { ...a, qCount, totalPts, due, isPast, submittedAt, status, score };
  });
}

/** Published interactions for the course paired with the student's submitted reports.
 *  effort (0–5) is the engagement grade; score (0–2) is the trigger-derived points. */
export async function loadInteractionStatuses(ctx) {
  const sid = ctx.studentRow.student_id;
  const [{ data: pub }, { data: reports }] = await Promise.all([
    db.from('interactions').select('id, title, description, artifact_url')
      .eq('course_id', ctx.currentCourse).eq('is_published', true).order('title'),
    db.from('preflight_interaction_reports').select('interaction_id, updated_at, effort, score')
      .eq('student_id', sid),
  ]);
  const repMap = Object.fromEntries((reports || []).map(r => [r.interaction_id, r]));
  return (pub || []).map(it => {
    const r = repMap[it.id];
    return { ...it, done: !!r, submittedAt: r?.updated_at || null,
      effort: r?.effort ?? null, score: r?.score ?? null };
  });
}

/** Aggregate everything the student dashboard needs into one view-model. */
export async function loadStudentDashboard(ctx) {
  if (!ctx.currentCourse) return { noCourse: true };

  const [assignments, interactions] = await Promise.all([
    loadAssignmentStatuses(ctx),
    loadInteractionStatuses(ctx),
  ]);

  const upcoming  = assignments.filter(a => a.status === 'not-started' || a.status === 'submitted');
  const overdue   = assignments.filter(a => a.status === 'overdue');
  const completed = assignments.filter(a => a.status === 'graded' || a.status === 'pending');
  const graded    = assignments.filter(a => a.status === 'graded');

  // Average graded percentage (across finalized scores).
  let earned = 0, possible = 0;
  graded.forEach(a => { earned += a.score.total_score || 0; possible += a.score.max_total || 0; });
  const avgPct = possible > 0 ? Math.round((earned / possible) * 100) : null;

  const toDoCount = assignments.filter(a => a.status === 'not-started').length;
  const interTodo = interactions.filter(i => !i.done);

  return {
    noCourse: false,
    stats: {
      toDo: toDoCount,
      overdue: overdue.length,
      submitted: assignments.filter(a => a.submittedAt).length,
      graded: graded.length,
      avgPct,
      interactionsToDo: interTodo.length,
      interactionsTotal: interactions.length,
    },
    upcoming, overdue, completed, graded,
    interactions,
    interactionsTodo: interTodo,
  };
}
