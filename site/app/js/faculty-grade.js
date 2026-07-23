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
  OFFERING_SELECT, GRADE_SELECT, SUBMISSION_SELECT, EXTENSION_SELECT,
  shapeOffering, shapeSubmission, questionsOf, effectiveDue, submissionLateness,
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
    // Active extensions only. A revoked row still exists (007 keeps it so the director's
    // report can count it) but it must not move anybody's deadline.
    db.from('extensions').select(EXTENSION_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds)
      .is('revoked_at', null),
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
      // Carried so a save can PRESERVE them for a student nobody edited. Writing the
      // current user over every row was what erased the ai_suggested/instructor
      // distinction the moment anyone clicked Save. See gradeRows().
      source: g.source,
      gradedBy: g.graded_by,
      gradedAt: g.graded_at,
      updatedAt: g.updated_at,
    };
  });

  (exts.data || []).forEach(e => {
    const sid = studentOf[e.enrollment_id];
    if (sid) extensionMap[sid] = shapeExtension(e);
  });

  return { offering, students, responseMap, gradeMap, extensionMap, submissionMap };
}

/** One extensions row, flattened. `due` is the field effectiveDue() wants. */
export function shapeExtension(e) {
  if (!e) return null;
  return {
    id: e.id,
    enrollmentId: e.enrollment_id,
    offeringId: e.assignment_offering_id,
    due: e.extended_due_at,
    reason: e.reason || '',
    grantedBy: e.granted_by,
    grantedAt: e.created_at,
    revokedAt: e.revoked_at || null,
    revokedBy: e.revoked_by || null,
    revokedReason: e.revoked_reason || '',
    get isRevoked() { return !!e.revoked_at; },
  };
}

/** The deadline that applies to one student in the grading view. */
export function dueForStudent(offering, student, extensionMap) {
  return effectiveDue(offering, student.section_id, extensionMap[student.student_id]?.due || null);
}

/**
 * Did this student commit to something other than the written activity?
 *
 * On a `choice` offering both activities are `graded` and each student picks, so the grading
 * MECHANISM is a property of the student, not of the offering: an interactive taker is graded by
 * effort (grades.effort -> the DB trigger), a written taker by question_scores. This is the
 * predicate that tells the two apart, and `chosen_activity_id` is the right source for it because
 * that commitment IS the decision — the same one submissions_lock enforces.
 *
 * Nothing chosen yet => false, so a draft still shows the written card to grade against.
 */
export function isEffortGraded(offering, submission) {
  const chosen = submission?.chosenActivityId;
  if (!chosen) return false;
  return chosen !== offering?.written?.id;
}

/**
 * Build the editable 3-state grade model (full / warn / zero).
 * Unchanged in spirit from the legacy view — the states and their meaning are a course
 * policy, not a schema detail — but it now reads questions out of the written activity's
 * content rather than off the assignment row.
 *
 * INTERACTIVE TAKERS ARE EXCLUDED ENTIRELY, and that omission is load-bearing. Their grade comes
 * from effort; they answered no written question, so every question would default to `zero` here
 * (`hasAnswer` false), and because they DO have a prior grade row, gradeRows() rule 2 would not
 * skip them — one click of Save on somebody else's card would write `question_scores` full of
 * zeros over their effort grade and set points_earned to 0. Giving them no gradeData entry is
 * what makes rule 2 skip them for the right reason. Migration 014's
 * `grades_one_grading_mechanism` CHECK is the second line of defence, turning the same mistake
 * into a rejected write rather than a silent zero.
 */
export function buildGradeData(offering, students, responseMap, gradeMap, submissionMap = {}) {
  const questions = questionsOf(offering.written);
  const gradeData = {};
  (students || []).forEach(st => {
    if (isEffortGraded(offering, submissionMap[st.student_id])) return;
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

/** Did the instructor actually touch this student's card in this sitting? */
function wasEdited(qMap, questions) {
  return questions.some(q => qMap?.[q.id]?.modified);
}

/**
 * Rows for a grades upsert. Shared by save and finalize so they cannot diverge.
 *
 * TWO RULES HERE ARE LOAD-BEARING, and both were bugs before migration 007's review work:
 *
 * 1. PROVENANCE IS PRESERVED, NOT STAMPED. This used to hardcode source:'instructor',
 *    graded_by:<caller>, graded_at:<now> for EVERY row in scope. One click of Save draft
 *    therefore relabelled every AI suggestion in the section as instructor-authored,
 *    including cards nobody had scrolled to — which destroyed the only column that could
 *    answer "has a human looked at this?". A row is marked instructor-authored only when
 *    that student's card was actually edited; otherwise the prior values ride through
 *    unchanged. (They must be sent explicitly: a PostgREST upsert builds its column list
 *    from the payload keys, so omitting them is not the same as leaving them alone.)
 *
 * 2. AN UNGRADED STUDENT IS NOT INVENTED. buildGradeData() defaults a submitted-but-
 *    ungraded student to `full`, so writing every row meant Finalize & publish handed full
 *    credit to every student the AI never scored — and a director who had picked "All
 *    sections" did it course-wide. A student with no existing grade AND no edit is now
 *    skipped entirely, which is also what makes the "past due, not graded" queue truthful.
 */
function gradeRows(ctx, offering, students, gradeData, isFinalized, gradeMap = {}) {
  const questions = questionsOf(offering.written);
  const enrollmentOf = Object.fromEntries(students.map(s => [s.student_id, s.enrollment_id]));
  const now = new Date().toISOString();

  return Object.entries(gradeData).map(([sid, qMap]) => {
    const prior = gradeMap[sid];
    const edited = wasEdited(qMap, questions);
    // Rule 2 — nothing to say about this student, so say nothing.
    if (!prior && !edited) return null;

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
      // Rule 1
      source: edited ? 'instructor' : (prior?.source || 'ai_suggested'),
      is_finalized: isFinalized,
      graded_by: edited ? ctx.user.id : (prior?.gradedBy ?? ctx.user.id),
      graded_at: edited ? now : (prior?.gradedAt ?? now),
    };
  }).filter(r => r && r.enrollment_id);
}

/** How many rows a save/finalize would actually write — for an honest confirm prompt. */
export function writableCount(ctx, offering, students, gradeData, gradeMap = {}) {
  return gradeRows(ctx, offering, students, gradeData, false, gradeMap).length;
}

/** Upsert all scores as a draft (is_finalized:false). */
export function saveScores(ctx, offering, students, gradeData, gradeMap = {}) {
  const rows = gradeRows(ctx, offering, students, gradeData, false, gradeMap);
  if (!rows.length) return Promise.resolve({ data: [], error: null, skipped: true });
  return db.from('grades').upsert(rows, { onConflict: 'enrollment_id,assignment_offering_id' });
}

/**
 * Save then publish. Finalizing is what makes a grade visible to the student
 * (grades_own_finalized), so it is also the moment worth recording in the audit log.
 */
export async function finalizeScores(ctx, offering, students, gradeData, gradeMap = {}) {
  const rows = gradeRows(ctx, offering, students, gradeData, true, gradeMap);
  if (!rows.length) return { data: [], error: null, skipped: true };
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

/* ── Extensions (migrations 005 + 007) ───────────────────────────────────────
 * Keyed on the enrolment, like everything else per-student. `granted_by` is recorded so an
 * extension is attributable the same way an unlock is.
 *
 * Three verbs, and the difference between them is the whole governance model:
 *   setExtension    — grant or amend. Any staff of the section. `reason` is REQUIRED (007):
 *                     the director's report counts these per instructor, and a count with a
 *                     blank reason column cannot start the conversation it exists to start.
 *   removeExtension — the granter's undo, for a genuine mistake. Erases the row, so it is
 *                     refused by the DB once the student has committed work under it.
 *   revokeExtension — the director's override. Soft: the row stays and keeps counting.
 *                     Also refused after a committed submission, and the trigger rejects it
 *                     from anyone who does not direct the offering.
 */
export function setExtension(ctx, offeringId, enrollmentId, iso, reason) {
  const why = String(reason || '').trim();
  if (!why) return Promise.resolve({ error: { message: 'A reason is required to grant an extension.' } });
  return db.from('extensions').upsert({
    enrollment_id: enrollmentId,
    assignment_offering_id: offeringId,
    extended_due_at: iso,
    reason: why,
    granted_by: ctx.user.id,
    // Amending a revoked extension reinstates it — the UNIQUE key means there is only ever
    // one row per (enrolment, offering), so this is the reinstatement path too.
    revoked_at: null, revoked_by: null, revoked_reason: null,
  }, { onConflict: 'enrollment_id,assignment_offering_id' });
}

export function removeExtension(offeringId, enrollmentId) {
  return db.from('extensions').delete()
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId);
}

/** Director override. Soft by design — see the 007 header. */
export function revokeExtension(ctx, extensionId, reason) {
  const why = String(reason || '').trim();
  if (!why) return Promise.resolve({ error: { message: 'A reason is required to revoke an extension.' } });
  return db.from('extensions').update({
    revoked_at: new Date().toISOString(),
    revoked_by: ctx.user.id,
    revoked_reason: why,
  }).eq('id', extensionId).is('revoked_at', null);
}

/** Undo a revocation. The row's original grant details are untouched by revocation. */
export function reinstateExtension(extensionId) {
  return db.from('extensions').update({
    revoked_at: null, revoked_by: null, revoked_reason: null,
  }).eq('id', extensionId);
}

/**
 * Every extension in the current course offering, for the director's report.
 *
 * No DDL was needed to make this visible: a director's staff_assignments row carries
 * section_id IS NULL, so app.staff_sections() already returns every section of the offering
 * and extensions_staff_read admits the rows. The `.in()` below narrows, it does not secure.
 *
 * Revoked rows ARE included — the report's job is to count what was granted, and a revoked
 * extension that vanished would quietly flatter whoever granted it.
 */
export async function courseExtensions(ctx, sectionIds) {
  const scope = (sectionIds && sectionIds.length) ? sectionIds : null;
  if (!scope) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', scope);
  const byEnrolment = Object.fromEntries((enrolRows || []).map(e => [e.id, e]));
  const enrolmentIds = Object.keys(byEnrolment);
  if (!enrolmentIds.length) return [];

  const [exts, offerings, staff] = await Promise.all([
    db.from('extensions').select(EXTENSION_SELECT)
      .in('enrollment_id', enrolmentIds).order('created_at', { ascending: false }),
    db.from('assignment_offerings')
      .select('id, due_at, points_possible, assignments!inner(slug, title)')
      .eq('course_offering_id', ctx.currentOffering),
    db.from('instructors').select('id, name'),
  ]);

  const offeringOf = Object.fromEntries((offerings.data || []).map(o => [o.id, o]));
  const nameOf = Object.fromEntries((staff.data || []).map(i => [i.id, i.name]));

  return (exts.data || []).map(row => {
    const x = shapeExtension(row);
    const e = byEnrolment[x.enrollmentId];
    const o = offeringOf[x.offeringId];
    return {
      ...x,
      studentId: e?.student_id ?? null,
      studentName: e?.students?.name || String(e?.student_id ?? ''),
      sectionId: e?.section_id ?? null,
      assignmentTitle: o?.assignments?.title || '—',
      assignmentSlug: o?.assignments?.slug || '',
      originalDue: o?.due_at || null,
      grantedByName: nameOf[x.grantedBy] || (x.grantedBy ? 'Unknown instructor' : '—'),
      revokedByName: nameOf[x.revokedBy] || null,
    };
  }).filter(r => r.offeringId in offeringOf);   // other offerings' rows are not this report
}

/* ── Review sign-off (migration 007) ─────────────────────────────────────────
 * "I have read the AI's proposed grades and comments for this section and made my changes."
 * Deliberately NOT is_finalized, which publishes to students.
 */
export async function loadSignoffs(ctx, offeringId, sectionIds) {
  if (!offeringId || !sectionIds?.length) return {};
  const [signoffs, staff] = await Promise.all([
    db.from('review_signoffs')
      .select('id, assignment_offering_id, section_id, reviewed_by, reviewed_at, note')
      .eq('assignment_offering_id', offeringId).in('section_id', sectionIds),
    db.from('instructors').select('id, name'),
  ]);
  const nameOf = Object.fromEntries((staff.data || []).map(i => [i.id, i.name]));
  return Object.fromEntries((signoffs.data || []).map(s => [s.section_id, {
    id: s.id,
    sectionId: s.section_id,
    reviewedAt: s.reviewed_at,
    reviewedBy: s.reviewed_by,
    reviewedByName: nameOf[s.reviewed_by] || 'Unknown instructor',
    note: s.note || '',
  }]));
}

/**
 * Sign off one section. reviewed_by MUST be the caller: review_signoffs_require_self()
 * rejects an attestation naming anyone else, for the same reason 006 rejects a
 * misattributed unlock.
 */
export function signOffSection(ctx, offeringId, sectionId, note = null) {
  return db.from('review_signoffs').upsert({
    assignment_offering_id: offeringId,
    section_id: sectionId,
    reviewed_by: ctx.user.id,
    reviewed_at: new Date().toISOString(),
    note: note || null,
  }, { onConflict: 'assignment_offering_id,section_id' });
}

export function clearSignoff(offeringId, sectionId) {
  return db.from('review_signoffs').delete()
    .eq('assignment_offering_id', offeringId).eq('section_id', sectionId);
}

/**
 * A sign-off stops holding once the grades move under it.
 *
 * Derived rather than stored (see the 007 header): grades_touch maintains grades.updated_at,
 * so "stale" is exactly `some grade in this section changed after the attestation`.
 */
export function signoffStale(signoff, gradeUpdatedISOs) {
  if (!signoff?.reviewedAt) return false;
  const at = new Date(signoff.reviewedAt).getTime();
  return (gradeUpdatedISOs || []).some(iso => iso && new Date(iso).getTime() > at);
}

/* ── Worklists ───────────────────────────────────────────────────────────────
 * The queues answer the question the Grade tab could not: not "how do I grade THIS
 * assignment", but "what do I owe". They are the mechanism that stops a late submission
 * from being lost — `preflight-analyze` runs once, after the section deadline, so a student
 * on an extension submits into silence unless something remembers them.
 *
 * Both are pure reads over existing tables; no DDL, and no new denormalised state to drift.
 */

/* `extensionsToGrade()` lived here until 2026-07-23 and is now `buildGradingQueue()` below.
 *
 * It answered the same question one assignment at a time, off the maps the Grade page had already
 * loaded — which meant an expired extension on a lesson you were not currently looking at was
 * invisible. P1.14's queue is cross-assignment and per-student, so the narrower version had no
 * caller left. The RULE it encoded (active extension + past its date + work in + not finalized)
 * is carried over unchanged. */

/**
 * Assignments in this offering whose deadline has passed and which still hold unfinalized
 * work. Cross-assignment on purpose — the Grade tab is otherwise strictly one-at-a-time,
 * which is exactly why nothing ever surfaced the backlog.
 *
 * Deliberately counts only students who SUBMITTED. A non-submitter is a roster question, not
 * a grading backlog, and mixing the two makes the number too big to act on.
 */
export async function pastDueUngraded(ctx, sectionIds, now = new Date()) {
  if (!ctx.currentOffering || !sectionIds?.length) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, section_id').in('section_id', sectionIds).eq('status', 'active');
  const enrolmentIds = (enrolRows || []).map(e => e.id);
  const sectionOf = Object.fromEntries((enrolRows || []).map(e => [e.id, e.section_id]));
  if (!enrolmentIds.length) return [];

  const { data: offerings } = await db.from('assignment_offerings')
    .select('id, due_at, position, is_published, assignments!inner(slug, title),' +
            'assignment_due_dates(section_id, due_at)')
    .eq('course_offering_id', ctx.currentOffering).eq('is_published', true);

  const offeringIds = (offerings || []).map(o => o.id);
  if (!offeringIds.length) return [];

  const [subs, grds, exts] = await Promise.all([
    db.from('submissions').select('enrollment_id, assignment_offering_id, status')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds),
    db.from('grades').select('enrollment_id, assignment_offering_id, is_finalized')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds),
    db.from('extensions').select('enrollment_id, assignment_offering_id, extended_due_at')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds)
      .is('revoked_at', null),
  ]);

  const key = (e, o) => `${e}|${o}`;
  const finalized = new Set((grds.data || [])
    .filter(g => g.is_finalized).map(g => key(g.enrollment_id, g.assignment_offering_id)));
  const graded = new Set((grds.data || []).map(g => key(g.enrollment_id, g.assignment_offering_id)));
  const extBy = Object.fromEntries((exts.data || [])
    .map(x => [key(x.enrollment_id, x.assignment_offering_id), x.extended_due_at]));

  const rows = [];
  for (const o of offerings) {
    const dueBySection = Object.fromEntries(
      (o.assignment_due_dates || []).map(d => [d.section_id, d.due_at]));
    const shaped = { dueAt: o.due_at, dueBySection };

    let outstanding = 0, ungraded = 0, waiting = 0;
    for (const s of (subs.data || []).filter(x => x.assignment_offering_id === o.id)) {
      const k = key(s.enrollment_id, o.id);
      if (finalized.has(k)) continue;
      // A student still inside an extension is not a backlog item yet — they show up in the
      // extensions queue when their own clock runs out.
      const { isPast } = effectiveDue(shaped, sectionOf[s.enrollment_id], extBy[k] || null, now);
      if (!isPast) { waiting++; continue; }
      outstanding++;
      if (!graded.has(k)) ungraded++;
    }
    if (outstanding > 0) {
      rows.push({
        offeringId: o.id,
        title: o.assignments?.title || o.assignments?.slug || '—',
        slug: o.assignments?.slug || '',
        dueAt: o.due_at,
        position: o.position ?? 0,
        outstanding,      // submitted, past their own deadline, not finalized
        ungraded,         // of those, with no grade row at all
        waiting,          // still inside an extension; shown for context, not as backlog
      });
    }
  }
  return rows.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
}

/* ── The hand-grading queue (P1.14) ──────────────────────────────────────────
 *
 * WHAT THIS REPLACED, AND WHY IT IS A DIFFERENT SHAPE
 *   The Grade page used to carry a "Submitted late" FILTER: pick an assignment, pick a section,
 *   then narrow the cards down to the late ones. That answers the wrong question. An instructor
 *   does not want to filter a section down to late work — they want the short standing list of
 *   the handful of submissions that need a human, without first guessing which assignment holds
 *   them. A filter makes you go looking; a queue comes to you.
 *
 * WHAT IS IN IT
 *   Exactly two things, both of which are "the AI run has already happened and missed this":
 *     late            — committed after that student's own deadline, not finalized
 *     extension-expired — their extension has now passed, work is in, nothing published
 *   /preflight-analyze runs once, after the section deadline. Anything that arrives afterwards is
 *   invisible unless something remembers it, and these are the two ways that happens.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *   INTERACTIVE TAKERS. Migration 015 grades them on commit — finalized, derived, from the report
 *   effort — so there is nothing for a human to do and listing them would train people to ignore
 *   the queue. This is the one rule here that is a claim about another part of the system rather
 *   than about this data, so it is asserted narrowly: a submission whose CHOSEN activity is not
 *   the written one is out. A draft (nothing chosen) is still in, because that student may yet
 *   land on the written path.
 *
 *   Also out: non-submitters. That is a roster conversation, not a grading backlog, and the
 *   rollup's "Did not submit" panel is where it already lives.
 */

/**
 * Pure half — takes the five row-sets, returns the queue. Unit-tested without a network.
 *
 * @param {object} data
 *   offerings   [{ id, dueAt, dueBySection, slug, title, position, writtenActivityId }]
 *   students    [{ student_id, name, enrollment_id, section_id }]
 *   submissions [{ enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at }]
 *   grades      [{ enrollment_id, assignment_offering_id, is_finalized, source }]
 *   extensions  [{ enrollment_id, assignment_offering_id, extended_due_at, reason }]  ACTIVE only
 * @param {Date} [now]
 */
export function buildGradingQueue({ offerings, students, submissions, grades, extensions }, now = new Date()) {
  const key = (e, o) => `${e}|${o}`;
  const studentOf = Object.fromEntries((students || []).map(s => [s.enrollment_id, s]));
  const gradeBy = Object.fromEntries((grades || []).map(g => [key(g.enrollment_id, g.assignment_offering_id), g]));
  const extBy = Object.fromEntries((extensions || []).map(x => [key(x.enrollment_id, x.assignment_offering_id), x]));
  const offeringBy = Object.fromEntries((offerings || []).map(o => [o.id, o]));

  const out = [];
  for (const sub of (submissions || [])) {
    if (sub.status !== 'committed') continue;              // a draft is not waiting on a grader
    const st = studentOf[sub.enrollment_id];
    const off = offeringBy[sub.assignment_offering_id];
    if (!st || !off) continue;

    // Auto-graded on commit — see the header.
    if (sub.chosen_activity_id && sub.chosen_activity_id !== off.writtenActivityId) continue;

    const k = key(sub.enrollment_id, off.id);
    const g = gradeBy[k];
    if (g?.is_finalized) continue;                          // already published

    const ext = extBy[k];
    const extISO = ext?.extended_due_at || null;
    // shapeOffering()'s two fields are all effectiveDue/submissionLateness read.
    const shaped = { dueAt: off.dueAt, dueBySection: off.dueBySection || {} };
    const late = submissionLateness(shaped, st.section_id, extISO, sub.committed_at);
    const extExpired = !!extISO && new Date(extISO) <= now;

    // Late wins when both apply: it is the more specific fact, and an extension that was blown
    // through is exactly the case a grader wants named as late rather than as "extension over".
    const reason = late.late ? 'late' : extExpired ? 'extension-expired' : null;
    if (!reason) continue;

    out.push({
      offeringId: off.id,
      slug: off.slug,
      title: off.title,
      dueAt: off.dueAt,
      position: off.position ?? 0,
      studentId: st.student_id,
      studentName: st.name,
      sectionId: st.section_id,
      enrollmentId: st.enrollment_id,
      reason,
      lateMs: late.late ? late.ms : 0,
      due: late.due || (extISO ? new Date(extISO) : null),
      extendedDue: extISO,
      extensionReason: ext?.reason || '',
      // Same vocabulary extensionsToGrade() already uses, so the two read alike.
      state: !g ? 'ungraded' : (g.source === 'ai_suggested' ? 'ai-only' : 'draft'),
    });
  }

  // Oldest deadline first, then by name. The thing that has been waiting longest is the thing
  // most likely to be forgotten, and it is also the one a cadet is most likely to ask about.
  return out.sort((a, b) =>
    new Date(a.dueAt || 0) - new Date(b.dueAt || 0)
    || lastFirst(a.studentName).localeCompare(lastFirst(b.studentName)));
}

/**
 * The queue, fetched. Scoped by the CALLER to the sections they personally teach — see
 * schema.js `actionableSections()` for why "what I can see" is the wrong scope for a worklist.
 *
 * Cross-assignment on purpose: the Grade page is otherwise strictly one-at-a-time, which is
 * exactly why nothing ever surfaced a backlog.
 */
export async function gradingQueue(ctx, sectionIds, now = new Date()) {
  if (!ctx.currentOffering || !sectionIds?.length) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', sectionIds).eq('status', 'active');
  const students = (enrolRows || []).map(e => ({
    student_id: e.student_id,
    name: e.students?.name || String(e.student_id),
    enrollment_id: e.id,
    section_id: e.section_id,
  }));
  if (!students.length) return [];
  const enrolmentIds = students.map(s => s.enrollment_id);

  // offering_activities is embedded so the written activity id is known per offering — that is
  // what separates an interactive taker from a written one, and there is no other source for it.
  const { data: offeringRows } = await db.from('assignment_offerings')
    .select('id, due_at, position, assignments!inner(slug, title),' +
            'assignment_due_dates(section_id, due_at),' +
            'offering_activities(activity_id, activities(id, modality))')
    .eq('course_offering_id', ctx.currentOffering).eq('is_published', true);

  const offerings = (offeringRows || []).map(o => ({
    id: o.id,
    dueAt: o.due_at,
    position: o.position ?? 0,
    slug: o.assignments?.slug || '',
    title: o.assignments?.title || o.assignments?.slug || '—',
    dueBySection: Object.fromEntries((o.assignment_due_dates || []).map(d => [d.section_id, d.due_at])),
    writtenActivityId:
      (o.offering_activities || []).find(oa => oa.activities?.modality === 'written')?.activity_id || null,
  }));
  const offeringIds = offerings.map(o => o.id);
  if (!offeringIds.length) return [];

  const [subs, grds, exts] = await Promise.all([
    db.from('submissions')
      .select('enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds),
    db.from('grades').select('enrollment_id, assignment_offering_id, is_finalized, source')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds),
    db.from('extensions').select('enrollment_id, assignment_offering_id, extended_due_at, reason')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrolmentIds)
      .is('revoked_at', null),
  ]);

  return buildGradingQueue({
    offerings, students,
    submissions: subs.data || [], grades: grds.data || [], extensions: exts.data || [],
  }, now);
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
