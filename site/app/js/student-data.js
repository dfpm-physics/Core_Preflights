// student-data.js — dashboard + list queries for a logged-in student, against schema `app`.
//
// SHAPE OF THE READ
//   One assignment now spans four tables, so a student's list is three batched queries —
//   what is scheduled (assignment_offerings + its activities + per-section deadlines), what
//   they have done (submissions + submission_activities), and what it was worth (grades) —
//   stitched together in memory. No N+1: nothing is fetched per assignment.
//
//   RLS does most of the filtering for us. ao_read_student already restricts
//   assignment_offerings to published rows in offerings the caller is enrolled in, so the
//   explicit .eq() filters here are belt-and-braces for clarity, not the security boundary.
//
// WHAT A STUDENT CAN SEE OF THEIR GRADE
//   grades_own_finalized is `is_finalized AND enrollment_id IN my_enrollments()`. An
//   unfinalized grade is invisible to the student, so there is no need to filter on
//   is_finalized here — the row simply will not arrive. That is a change worth knowing:
//   in `public` the policy checked is_finalized with NO owner check, so every finalized
//   score in the course was readable by anyone holding the anon key.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT,
  shapeOffering, shapeSubmission, effectiveDue, deriveStatus, isOpen,
  questionsOf, questionPoints, displayPoints, isActivityAvailable, answeredCount,
} from './schema.js';

/** The enrolment ids the current student holds in the current offering. */
function myEnrollmentIds(ctx) {
  return ctx.enrollmentIds || [];
}

/** The section the student sits in for the current offering (drives the deadline). */
function mySectionId(ctx) {
  return ctx.sectionIds?.[0] ?? null;
}

/**
 * Everything scheduled for this student in the current offering, stitched with their own
 * work and grades.
 *
 * @returns {Promise<Array>} sorted by effective due date (undated last), each:
 *   { offeringId, slug, title, description, pointsPossible, activities, written, interactive,
 *     isChoice, due, isPast, dueSource, submission, grade, status, chosenActivity,
 *     answered, qCount, earned }
 */
export async function loadAssignmentStatuses(ctx) {
  if (!ctx.currentOffering) return [];
  const enrollmentIds = myEnrollmentIds(ctx);
  const sectionId = mySectionId(ctx);

  const { data: offeringRows } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('course_offering_id', ctx.currentOffering)
    .eq('is_published', true)
    .order('position', { ascending: true, nullsFirst: false });

  const offerings = (offeringRows || []).map(shapeOffering).filter(Boolean);
  if (!offerings.length) return [];

  // Their work + their grades + any extension. Scoped by enrolment, which is what every
  // per-student table in this model keys on.
  let submissions = [], grades = [], extensions = [];
  if (enrollmentIds.length) {
    const [subs, grds, exts] = await Promise.all([
      db.from('submissions').select(SUBMISSION_SELECT).in('enrollment_id', enrollmentIds),
      db.from('grades').select(GRADE_SELECT).in('enrollment_id', enrollmentIds),
      db.from('extensions').select('assignment_offering_id, extended_due_at')
        .in('enrollment_id', enrollmentIds),
    ]);
    submissions = (subs.data || []).map(shapeSubmission);
    grades = grds.data || [];
    extensions = exts.data || [];
  }

  const subByOffering   = Object.fromEntries(submissions.map(s => [s.offeringId, s]));
  const gradeByOffering = Object.fromEntries(grades.map(g => [g.assignment_offering_id, g]));
  const extByOffering   = Object.fromEntries(extensions.map(e => [e.assignment_offering_id, e.extended_due_at]));

  const items = offerings.map(o => {
    const submission = subByOffering[o.offeringId] || null;
    const grade = gradeByOffering[o.offeringId] || null;
    const { due, isPast, source } = effectiveDue(o, sectionId, extByOffering[o.offeringId]);
    const status = deriveStatus({ submission, grade, isPast });

    const chosenActivity = submission?.chosenActivityId
      ? o.activities.find(a => a.id === submission.chosenActivityId) || null
      : null;

    // Progress is only meaningful for the written path.
    const written = o.written;
    const savedAnswers = written ? (submission?.activities?.[written.id]?.content || null) : null;
    const questions = questionsOf(written);

    return {
      ...o,
      due, isPast, dueSource: source,
      isOpen: isOpen(o),
      submission, grade, status, chosenActivity,
      qCount: questions.length,
      totalPts: o.pointsPossible || questionPoints(written),
      answered: answeredCount(savedAnswers, questions),
      earned: displayPoints(grade, o),
      // Which activities the student may actually work right now.
      availableActivities: o.activities.filter(a =>
        isActivityAvailable(a, { submission, isPast })),
    };
  });

  // Undated assignments sort last rather than first — an assignment with no deadline is not
  // the most urgent thing on the list.
  return items.sort((a, b) => {
    if (a.due && b.due) return a.due - b.due;
    if (a.due) return -1;
    if (b.due) return 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

/**
 * The interactive slice of the same data, for surfaces that still present interactions on
 * their own. An "interaction" is no longer a top-level entity — it is an activity with
 * modality 'interactive' inside an assignment — so this is a projection, not a second query.
 */
export async function loadInteractionStatuses(ctx) {
  const items = await loadAssignmentStatuses(ctx);
  return items
    .filter(i => i.interactive)
    .map(i => {
      const act = i.interactive;
      const work = i.submission?.activities?.[act.id] || null;
      return {
        offeringId: i.offeringId,
        activityId: act.id,
        slug: act.slug,
        title: act.title || i.title,
        description: act.content?.description || i.description,
        artifact_url: act.content?.artifact_url || null,
        gradingRole: act.gradingRole,
        isChoice: i.isChoice,
        due: i.due,
        isPast: i.isPast,
        done: !!work,
        submittedAt: work?.updatedAt || null,
        effort: i.grade?.effort ?? null,
        earned: i.earned,
        available: isActivityAvailable(act, { submission: i.submission, isPast: i.isPast }),
      };
    });
}

/** Aggregate everything the student dashboard needs into one view-model. */
export async function loadStudentDashboard(ctx) {
  if (!ctx.currentOffering) return { noCourse: true };

  const assignments = await loadAssignmentStatuses(ctx);
  const interactions = assignments.filter(a => a.interactive).map(a => ({
    offeringId: a.offeringId, title: a.title, done: !!(a.interactive &&
      a.submission?.activities?.[a.interactive.id]),
  }));

  const upcoming  = assignments.filter(a => a.status === 'not-started' || a.status === 'in-progress' || a.status === 'submitted');
  const overdue   = assignments.filter(a => a.status === 'overdue');
  const completed = assignments.filter(a => a.status === 'graded' || a.status === 'pending');
  const graded    = assignments.filter(a => a.status === 'graded');

  // Average graded percentage across finalized grades only.
  let earned = 0, possible = 0;
  graded.forEach(a => {
    earned += Number(a.earned ?? 0);
    possible += Number(a.grade?.points_possible ?? a.pointsPossible ?? 0);
  });
  const avgPct = possible > 0 ? Math.round((earned / possible) * 100) : null;

  const interTodo = interactions.filter(i => !i.done);

  return {
    noCourse: false,
    stats: {
      toDo: assignments.filter(a => a.status === 'not-started').length,
      inProgress: assignments.filter(a => a.status === 'in-progress').length,
      overdue: overdue.length,
      submitted: assignments.filter(a => a.submission?.status === 'committed').length,
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

/* ══════════════════════════════════════════════════════════════════════════════
 * WRITES — a student's own work
 *
 * Two rows, not one. `submissions` is the identity of the attempt (which activity counts,
 * and whether it is locked); `submission_activities` is the work itself, one row per
 * activity engaged with — including practice ones, because keeping both is the
 * revealed-preference signal the research design is after.
 *
 * ensureSubmission() is the only place a submission row is created, so the choice and the
 * lock are always established the same way.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Get-or-create the submission row for one offering, optionally recording the chosen
 * activity. Returns { data, error }.
 *
 * `chosenActivityId` is only written when the caller passes one AND nothing is chosen yet:
 * changing an existing choice is governed by switch_policy and goes through
 * chooseActivity() so the lock rules are applied in one place.
 */
export async function ensureSubmission(ctx, offeringId, chosenActivityId = null) {
  const enrollmentId = myEnrollmentIds(ctx)[0];
  if (!enrollmentId) return { data: null, error: new Error('No active enrolment for this course.') };

  const { data: existing } = await db.from('submissions')
    .select(SUBMISSION_SELECT)
    .eq('enrollment_id', enrollmentId).eq('assignment_offering_id', offeringId).maybeSingle();

  if (existing) {
    if (chosenActivityId && !existing.chosen_activity_id) {
      const { data, error } = await db.from('submissions')
        .update({ chosen_activity_id: chosenActivityId })
        .eq('id', existing.id).select(SUBMISSION_SELECT).maybeSingle();
      return { data: shapeSubmission(data || existing), error };
    }
    return { data: shapeSubmission(existing), error: null };
  }

  const { data, error } = await db.from('submissions').insert({
    enrollment_id: enrollmentId,
    assignment_offering_id: offeringId,
    chosen_activity_id: chosenActivityId,
    status: 'draft',
  }).select(SUBMISSION_SELECT).maybeSingle();
  return { data: shapeSubmission(data), error };
}

/**
 * Save (autosave) written answers for one activity, without committing.
 * The submission row is created on first save so a draft is never orphaned.
 */
export async function saveWrittenAnswers(ctx, offeringId, activityId, answers) {
  const { data: submission, error } = await ensureSubmission(ctx, offeringId);
  if (error || !submission) return { error: error || new Error('Could not open a submission.') };

  return db.from('submission_activities').upsert({
    submission_id: submission.id,
    activity_id: activityId,
    content: answers,
  }, { onConflict: 'submission_id,activity_id' });
}

/**
 * Commit: mark the work final and record which activity carries credit.
 *
 * Two writes on purpose. The DB trigger submissions_check_gradable() rejects a
 * chosen_activity_id that is not `graded` in this offering, and submissions_lock_activity()
 * governs changing one already committed — so this deliberately does NOT try to force a
 * choice through. If the trigger refuses, the error surfaces to the student rather than
 * being papered over.
 */
export async function commitSubmission(ctx, offeringId, activityId) {
  const { data: submission, error } = await ensureSubmission(ctx, offeringId);
  if (error || !submission) return { error: error || new Error('Could not open a submission.') };

  const { error: aErr } = await db.from('submission_activities')
    .update({ is_final: true })
    .eq('submission_id', submission.id).eq('activity_id', activityId);
  if (aErr) return { error: aErr };

  return db.from('submissions').update({
    chosen_activity_id: activityId,
    status: 'committed',
    committed_at: new Date().toISOString(),
  }).eq('id', submission.id);
}

/**
 * Change which activity counts for credit. Whether this is allowed is decided by the
 * database (switch_policy → submissions_lock_activity), so the error is passed through
 * verbatim: it names the policy that refused, which is what the student needs to be told.
 */
export async function chooseActivity(ctx, offeringId, activityId) {
  const { data: submission, error } = await ensureSubmission(ctx, offeringId);
  if (error || !submission) return { error: error || new Error('Could not open a submission.') };
  return db.from('submissions')
    .update({ chosen_activity_id: activityId })
    .eq('id', submission.id);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * INTERACTION REPORTS — the frozen artifact↔site contract
 *
 * A deployed Claude artifact posts to interaction-submit.html#i=<slug>. That slug is
 * activities.slug, which is globally UNIQUE precisely because the artifact sends no other
 * context — no course, no term, no student. Everything else is resolved from it here.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve an interactive activity slug to the offering this student can actually submit
 * against: published, in an offering they are enrolled in.
 *
 * The slug identifies the LESSON, not one term's run of it, so the same slug may be
 * scheduled in several terms. RLS narrows offering_activities to the caller's own published
 * offerings, so at most one survives for a given student — but the filter is explicit here
 * too, because relying on "RLS will make it unambiguous" would break silently the day a
 * student is enrolled in two terms at once.
 *
 * @returns {{activity, offering, error}} — offering is null when nothing is scheduled for them.
 */
export async function resolveActivityBySlug(ctx, slug) {
  const { data, error } = await db.from('activities')
    .select('id, slug, modality, title, content, assignment_id,' +
            'assignments!inner(id, slug, title, course_id)')
    .eq('slug', slug).maybeSingle();
  if (error || !data) return { activity: null, offering: null, error };

  // Which of this activity's offerings is live for this student, in the current course?
  const { data: offeringRows } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('assignment_id', data.assignment_id)
    .eq('course_offering_id', ctx.currentOffering)
    .eq('is_published', true);

  const offering = (offeringRows || []).map(shapeOffering)[0] || null;
  return { activity: data, offering, error: null };
}

/**
 * Save a finished interaction report.
 *
 * WHERE THE EFFORT SCORE GOES — this is the one real behavioural change in the receiver.
 * In `public`, the student's own upsert into preflight_interaction_reports carried `effort`,
 * and a trigger turned it into `score`: the student was, in effect, writing an input to
 * their own grade. In `app`, grades_staff_write means a student cannot write a `grades` row
 * at all, which is correct. So effort travels INSIDE the stored schema:1 payload on
 * submission_activities, and becomes a grade only when staff or the analysis workflow reads
 * it and writes one. Nothing here touches `grades`, and an attempt to would be refused.
 *
 * COMMITTING: submitting the report commits the student to the interactive path only when
 * that activity is `graded` this term. When it is `practice`, the work is still recorded —
 * that is the revealed-preference signal — but the choice is left alone, because a practice
 * activity can never carry credit and the DB would reject it anyway.
 */
export async function submitInteractionReport(ctx, { activity, offering, markdown, data }) {
  if (!offering) return { error: new Error('This assignment is not scheduled for you this term.') };

  // Data-layer backstop for "already graded": an interactive grade is auto-final, so the first
  // submitted report is the one that counts and a later one must not overwrite it. The submit page
  // blocks this in the UI, but interaction-submit.html is a public receiver URL, so the rule is
  // re-checked here where it cannot be skipped. (Past-due is enforced in the UI today; a DB-level
  // deadline guard is a hardening follow-up — see CHANGELOG 2026-07-23.)
  const enrollmentId = myEnrollmentIds(ctx)[0];
  if (enrollmentId) {
    const { data: g } = await db.from('grades')
      .select('is_finalized')
      .eq('enrollment_id', enrollmentId)
      .eq('assignment_offering_id', offering.offeringId)
      .maybeSingle();
    if (g?.is_finalized) {
      return { error: new Error('This assignment has already been graded and can’t be resubmitted. '
                              + 'Ask your instructor to reopen it if you need to.') };
    }
  }

  const { data: submission, error } = await ensureSubmission(ctx, offering.offeringId);
  if (error || !submission) return { error: error || new Error('Could not open a submission.') };

  const { error: workErr } = await db.from('submission_activities').upsert({
    submission_id: submission.id,
    activity_id: activity.id,
    content: data ?? null,
    report_markdown: markdown,
    payload_bytes: markdown ? markdown.length : null,
    is_final: true,
  }, { onConflict: 'submission_id,activity_id' });
  if (workErr) return { error: workErr };

  const offered = offering.activities.find(a => a.id === activity.id);
  if (offered?.gradingRole !== 'graded') {
    // Practice: recorded, not chosen. Nothing more to do.
    return { error: null, committed: false, role: offered?.gradingRole || 'unknown' };
  }

  const { error: commitErr } = await db.from('submissions').update({
    chosen_activity_id: activity.id,
    status: 'committed',
    committed_at: new Date().toISOString(),
  }).eq('id', submission.id);

  return { error: commitErr, committed: !commitErr, role: 'graded' };
}
