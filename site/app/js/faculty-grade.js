// faculty-grade.js — data layer for the faculty Grade view, against schema `app`.
//
// WHAT MOVED
//   scores(student_id, assignment_id)  ->  grades(enrollment_id, assignment_offering_id)
//   responses.answers                  ->  submission_activities.content
//   extensions(student_id, ...)        ->  extensions(enrollment_id, ...)   [migration 005]
//
// Everything is keyed on the ENROLMENT now, not the student. That is the change with real
// consequences: a grade belongs to a student's place in a section in a term, so moving a
// cadet between sections no longer silently re-attributes their history, and one student
// taking two courses cannot collide.
//
// SECTION SCOPING IS NO LONGER CLIENT-SIDE. The legacy page filtered by section in JS and
// relied on a permissive policy; here grades_staff_read/_write already restrict rows to
// sections the caller staffs, and ctx.sectionIds mirrors that same predicate. The .in()
// filters below narrow the query, they do not secure it.
//
// ONE GRADE PER STUDENT PER OFFERING is a UNIQUE constraint, and points_earned is bounded by
// points_possible by a CHECK. Both replace application-level care that the old model lacked.

import { db } from './supabase.js';
import { lastFirst } from './util.js';
import {
  OFFERING_SELECT, GRADE_SELECT, SUBMISSION_SELECT,
  shapeOffering, shapeSubmission, questionsOf, effectiveDue,
} from './schema.js';

/** Scheduled assignments for the current offering, for the picker. */
export async function gradeAssignmentList(ctx) {
  if (!ctx.currentOffering) return [];
  const { data } = await db.from('assignment_offerings')
    .select('id, due_at, position, is_published, points_possible, assignments!inner(slug, title)')
    .eq('course_offering_id', ctx.currentOffering)
    .order('position', { ascending: false, nullsFirst: false });
  return (data || []).map(r => ({
    id: r.id,
    slug: r.assignments?.slug,
    title: r.assignments?.title,
    due_at: r.due_at,
    is_published: r.is_published,
    points_possible: Number(r.points_possible ?? 0),
  }));
}

/** Sections the caller personally staffs — already resolved by auth.js from staff_sections(). */
export function mySectionIds(ctx) { return ctx.sectionIds || []; }

/** Every section in the current offering (directors/admins see all of them anyway). */
export async function allSectionIds(ctx) {
  if (!ctx.currentOffering) return [];
  const { data } = await db.from('sections').select('id')
    .eq('course_offering_id', ctx.currentOffering).order('code');
  return (data || []).map(s => s.id);
}

/**
 * Everything needed to grade one assignment offering across a set of sections.
 *
 * @returns {{ offering, students, responseMap, gradeMap, extensionMap, submissionMap }}
 *   students:     [{ student_id, name, enrollment_id, section_id }]
 *   responseMap:  studentId -> answers{} from the CHOSEN activity (or the written one)
 *   gradeMap:     studentId -> { qs, finalized, effort, pointsEarned, gradeId }
 *   extensionMap: studentId -> ISO date
 */
export async function loadGradingData(ctx, offeringId, sectionIds) {
  const empty = { offering: null, students: [], responseMap: {}, gradeMap: {}, extensionMap: {}, submissionMap: {} };
  if (!offeringId) return empty;

  const { data: offeringRow } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = shapeOffering(offeringRow);
  if (!offering) return empty;

  const scope = (sectionIds && sectionIds.length) ? sectionIds : ['00000000-0000-0000-0000-000000000000'];
  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, status, students!inner(student_id, name)')
    .in('section_id', scope).eq('status', 'active');

  const students = (enrolRows || [])
    .map(e => ({
      student_id: e.student_id,
      name: e.students?.name || String(e.student_id),
      enrollment_id: e.id,
      section_id: e.section_id,
    }))
    .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));

  if (!students.length) return { ...empty, offering, students };

  const enrollmentIds = students.map(s => s.enrollment_id);
  const studentOf = Object.fromEntries(students.map(s => [s.enrollment_id, s.student_id]));

  const [subs, grds, exts] = await Promise.all([
    db.from('submissions').select(SUBMISSION_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds),
    db.from('grades').select(GRADE_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds),
    db.from('extensions').select('enrollment_id, extended_due_at')
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds),
  ]);

  const responseMap = {}, submissionMap = {}, gradeMap = {}, extensionMap = {};

  (subs.data || []).map(shapeSubmission).forEach(s => {
    const sid = studentOf[s.enrollmentId];
    if (!sid) return;
    submissionMap[sid] = s;
    // Grade what the student actually chose. Falling back to the written activity keeps a
    // draft (nothing chosen yet) visible to the grader instead of showing a blank card.
    const actId = s.chosenActivityId || offering.written?.id;
    responseMap[sid] = s.activities?.[actId]?.content || {};
  });

  (grds.data || []).forEach(g => {
    const sid = studentOf[g.enrollment_id];
    if (!sid) return;
    gradeMap[sid] = {
      gradeId: g.id,
      qs: g.question_scores || {},
      finalized: g.is_finalized,
      effort: g.effort,
      pointsEarned: g.points_earned == null ? null : Number(g.points_earned),
      source: g.source,
    };
  });

  (exts.data || []).forEach(e => {
    const sid = studentOf[e.enrollment_id];
    if (sid) extensionMap[sid] = e.extended_due_at;
  });

  return { offering, students, responseMap, gradeMap, extensionMap, submissionMap };
}

/** The deadline that applies to one student in the grading view. */
export function dueForStudent(offering, student, extensionMap) {
  return effectiveDue(offering, student.section_id, extensionMap[student.student_id]);
}

/**
 * Build the editable 3-state grade model (full / warn / zero).
 * Unchanged in spirit from the legacy view — the states and their meaning are a course
 * policy, not a schema detail — but it now reads questions out of the written activity's
 * content rather than off the assignment row.
 */
export function buildGradeData(offering, students, responseMap, gradeMap) {
  const questions = questionsOf(offering.written);
  const gradeData = {};
  (students || []).forEach(st => {
    gradeData[st.student_id] = {};
    questions.forEach(q => {
      const saved = gradeMap[st.student_id]?.qs[q.id];
      const hasAnswer = String(responseMap[st.student_id]?.[q.id] ?? '').trim().length > 0;
      const savedScore = saved?.score !== undefined ? Number(saved.score) : null;
      const hasFeedback = !!(saved?.feedback && saved.feedback.trim());
      const status = saved?.status
        || (savedScore === null ? (hasAnswer ? 'full' : 'zero')
            : savedScore > 0 ? (hasFeedback ? 'warn' : 'full') : 'zero');
      gradeData[st.student_id][q.id] = {
        score: status === 'zero' ? 0 : Number(q.points) || 0,
        feedback: saved?.feedback ?? '',
        status,
        modified: false,
      };
    });
  });
  return gradeData;
}

/** Rows for a grades upsert. Shared by save and finalize so they cannot diverge. */
function gradeRows(ctx, offering, students, gradeData, isFinalized) {
  const questions = questionsOf(offering.written);
  const enrollmentOf = Object.fromEntries(students.map(s => [s.student_id, s.enrollment_id]));

  return Object.entries(gradeData).map(([sid, qMap]) => {
    const questionScores = {};
    let total = 0;
    questions.forEach(q => {
      const gd = qMap[q.id];
      if (!gd) return;
      questionScores[q.id] = {
        score: gd.score, max: Number(q.points) || 0,
        feedback: gd.feedback, status: gd.status || (gd.score > 0 ? 'full' : 'zero'),
      };
      total += Number(gd.score) || 0;
    });

    // points_possible comes from the OFFERING, not from the question list: it is the
    // per-term value, and the DB CHECK bounds points_earned against exactly this column.
    const possible = Number(offering.pointsPossible ?? 0);
    const earned = Math.min(Math.round(total * 1000) / 1000, possible);

    return {
      enrollment_id: enrollmentOf[sid],
      assignment_offering_id: offering.offeringId,
      question_scores: questionScores,
      points_earned: earned,
      points_possible: possible,
      source: 'instructor',
      is_finalized: isFinalized,
      graded_by: ctx.user.id,
      graded_at: new Date().toISOString(),
    };
  }).filter(r => r.enrollment_id);
}

/** Upsert all scores as a draft (is_finalized:false). */
export function saveScores(ctx, offering, students, gradeData) {
  return db.from('grades').upsert(
    gradeRows(ctx, offering, students, gradeData, false),
    { onConflict: 'enrollment_id,assignment_offering_id' });
}

/**
 * Save then publish. Finalizing is what makes a grade visible to the student
 * (grades_own_finalized), so it is also the moment worth recording in the audit log.
 */
export async function finalizeScores(ctx, offering, students, gradeData) {
  const rows = gradeRows(ctx, offering, students, gradeData, true);
  const res = await db.from('grades').upsert(rows, { onConflict: 'enrollment_id,assignment_offering_id' })
    .select('id');
  if (res.error) return res;

  // Append-only audit. Best-effort: a failed log entry must not lose the grades that were
  // just published, so the error is reported but not thrown.
  const events = (res.data || []).map(g => ({
    grade_id: g.id, event: 'finalized', actor: ctx.user.id,
    detail: { offering: offering.offeringId, slug: offering.slug },
  }));
  if (events.length) {
    const { error } = await db.from('grade_events').insert(events);
    if (error) console.warn('[grade] finalized, but the audit event failed:', error.message);
  }
  return res;
}

/** Re-open one student's grade so it leaves the student's view again. */
export async function reopenScore(ctx, offeringId, enrollmentId) {
  const res = await db.from('grades').update({ is_finalized: false })
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId).select('id');
  if (!res.error && res.data?.length) {
    await db.from('grade_events').insert({
      grade_id: res.data[0].id, event: 'reopened', actor: ctx.user.id, detail: {},
    });
  }
  return res;
}

/* ── Extensions (migration 005) ──────────────────────────────────────────────
 * Keyed on the enrolment, like everything else per-student. `granted_by` is recorded so an
 * extension is attributable the same way an unlock is.
 */
export function setExtension(ctx, offeringId, enrollmentId, iso, reason = null) {
  return db.from('extensions').upsert({
    enrollment_id: enrollmentId,
    assignment_offering_id: offeringId,
    extended_due_at: iso,
    reason,
    granted_by: ctx.user.id,
  }, { onConflict: 'enrollment_id,assignment_offering_id' });
}

export function removeExtension(offeringId, enrollmentId) {
  return db.from('extensions').delete()
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId);
}

/**
 * Clear a student's committed choice so they may pick again.
 *
 * unlocked_by MUST be the caller: submissions_lock_activity() (hardened in migration 006)
 * rejects an unlock attributed to anyone else, which is what stops an unlock from being
 * pinned on a colleague who did not perform it.
 */
export async function unlockSubmission(ctx, submissionId) {
  return db.from('submissions').update({
    chosen_activity_id: null,
    status: 'draft',
    unlocked_by: ctx.user.id,
    unlocked_at: new Date().toISOString(),
  }).eq('id', submissionId);
}
