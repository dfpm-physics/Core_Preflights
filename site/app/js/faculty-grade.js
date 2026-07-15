// faculty-grade.js — data layer for the faculty Grade view. Ported from admin.html's
// grade tab; same tables, same question_scores shape, same finalize/extension semantics.
// All section scoping is client-side (mirrors the legacy app). No DB changes.

import { db } from './supabase.js';
import { lastFirst } from './util.js';

/** Assignments for the current course, newest first (for the picker). */
export async function gradeAssignmentList(ctx) {
  const { data } = await db.from('assignments').select('id, title')
    .eq('course_id', ctx.currentCourse)
    .order('due_date_m', { ascending: false, nullsFirst: false });
  return data || [];
}

/** Section ids this instructor teaches in the current course ("my sections"). */
export async function mySectionIds(ctx) {
  const { data } = await db.from('sections').select('id')
    .eq('course_id', ctx.currentCourse).eq('instructor_id', ctx.instructorRow.id).order('id');
  return (data || []).map(s => s.id);
}

/** Every section in the current course (directors/admins). */
export async function allSectionIds(ctx) {
  const { data } = await db.from('sections').select('id').eq('course_id', ctx.currentCourse).order('id');
  return (data || []).map(s => s.id);
}

/**
 * Load everything needed to grade one assignment for a set of sections.
 * @returns {{assignment, students, responseMap, scoreMap, extensionMap}}
 *   responseMap: studentId -> answers{}; scoreMap: studentId -> {qs, finalized};
 *   extensionMap: studentId -> ISO date string.
 */
export async function loadGradingData(ctx, asgnId, sectionIds) {
  const { data: assignment } = await db.from('assignments').select('*').eq('id', asgnId).maybeSingle();
  if (!assignment) return { assignment: null, students: [], responseMap: {}, scoreMap: {}, extensionMap: {} };

  const { data: studentsRaw } = await db.from('students').select('student_id, name, section_id')
    .in('section_id', sectionIds.length ? sectionIds : ['__none__']);
  const students = (studentsRaw || []).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  const studentIds = students.map(s => s.student_id);

  if (!studentIds.length) return { assignment, students, responseMap: {}, scoreMap: {}, extensionMap: {} };

  const [{ data: responses }, { data: scores }, { data: exts }] = await Promise.all([
    db.from('responses').select('student_id, answers').eq('assignment_id', asgnId).in('student_id', studentIds),
    db.from('scores').select('student_id, question_scores, is_finalized').eq('assignment_id', asgnId).in('student_id', studentIds),
    db.from('extensions').select('student_id, extended_due_date').eq('assignment_id', asgnId).in('student_id', studentIds),
  ]);

  const responseMap  = Object.fromEntries((responses || []).map(r => [r.student_id, r.answers || {}]));
  const scoreMap     = Object.fromEntries((scores || []).map(s => [s.student_id, { qs: s.question_scores || {}, finalized: s.is_finalized }]));
  const extensionMap = Object.fromEntries((exts || []).map(e => [e.student_id, e.extended_due_date]));
  return { assignment, students, responseMap, scoreMap, extensionMap };
}

/** Build the editable gradeData (binary full/warn/zero) — port of admin.html:1026. */
export function buildGradeData(assignment, students, responseMap, scoreMap) {
  const gradeData = {};
  (students || []).forEach(st => {
    gradeData[st.student_id] = {};
    (assignment.questions || []).forEach(q => {
      const saved = scoreMap[st.student_id]?.qs[q.id];
      const hasAnswer = String(responseMap[st.student_id]?.[q.id] ?? '').trim().length > 0;
      const savedScore = saved?.score !== undefined ? Number(saved.score) : null;
      const hasFeedback = !!(saved?.feedback && saved.feedback.trim());
      const status = saved?.status
        || (savedScore === null ? (hasAnswer ? 'full' : 'zero')
            : savedScore > 0 ? (hasFeedback ? 'warn' : 'full') : 'zero');
      gradeData[st.student_id][q.id] = {
        score: status === 'zero' ? 0 : q.points,
        feedback: saved?.feedback ?? '',
        status,
        modified: false,
      };
    });
  });
  return gradeData;
}

/** Upsert all scores as a draft (is_finalized:false), exactly like admin.html:1189. */
export function saveScores(ctx, assignment, gradeData) {
  const qs = assignment.questions || [];
  const maxTotal = qs.reduce((s, q) => s + (isNaN(Number(q.points)) ? 0 : Number(q.points)), 0);
  const upserts = Object.entries(gradeData).map(([sid, qMap]) => {
    const questionScores = {};
    let total = 0;
    qs.forEach(q => {
      const gd = qMap[q.id];
      questionScores[q.id] = { score: gd.score, max: q.points, feedback: gd.feedback, status: gd.status || (gd.score > 0 ? 'full' : 'zero') };
      total += Number(gd.score) || 0;
    });
    return {
      student_id: parseInt(sid), assignment_id: assignment.id,
      question_scores: questionScores,
      total_score: Math.round(total * 1000) / 1000, max_total: maxTotal,
      is_finalized: false, graded_by: ctx.user.id, graded_at: new Date().toISOString(),
    };
  });
  return db.from('scores').upsert(upserts, { onConflict: 'student_id,assignment_id' });
}

/** Save then publish (is_finalized:true) for everyone in gradeData. */
export async function finalizeScores(ctx, assignment, gradeData) {
  const res = await saveScores(ctx, assignment, gradeData);
  if (res.error) return res;
  return db.from('scores').update({ is_finalized: true })
    .eq('assignment_id', assignment.id).in('student_id', Object.keys(gradeData).map(Number));
}

export function reopenScore(assignmentId, studentId) {
  return db.from('scores').update({ is_finalized: false })
    .eq('student_id', studentId).eq('assignment_id', assignmentId);
}

export function setExtension(ctx, assignmentId, studentId, iso) {
  return db.from('extensions').upsert(
    { student_id: studentId, assignment_id: assignmentId, extended_due_date: iso, granted_by: ctx.user.id },
    { onConflict: 'student_id,assignment_id' });
}

export function removeExtension(assignmentId, studentId) {
  return db.from('extensions').delete().eq('student_id', studentId).eq('assignment_id', assignmentId);
}
