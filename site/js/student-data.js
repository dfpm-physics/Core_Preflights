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
  OFFERING_SELECT, SUBMISSION_SELECT, SUBMISSION_SELECT_STUDENT, GRADE_SELECT_STUDENT,
  shapeOffering, shapeOfferings, withResolvedDue, offeringSections,
  shapeSubmission, effectiveDue, deriveStatus, isOpen,
  releaseAt, isReleased, LOOKAHEAD_DAYS,
  questionsOf, questionPoints, displayPoints, isActivityAvailable, answeredCount,
} from './schema.js';

/** The enrollment ids the current student holds in the current offering. */
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
 * ── WHAT THIS DELIBERATELY DOES NOT RETURN ───────────────────────────────────────────────
 * An assignment that has not reached its release date yet (schema.js `isReleased`) is dropped
 * here rather than in the pages, because this is the ONE loader every student surface runs
 * through — the dashboard, the lesson list, the written-preflight list and the artifact
 * receiver are all projections over it. A filter in each renderer would be four chances to
 * forget one, and forgetting one is how a cadet gets a working deep link to a lesson that is
 * supposed to be three weeks away.
 *
 * `lockedCount` rides back on the returned array so a list can SAY that later work exists
 * without being handed it. Silence would read as a broken page: lessons are numbered, so a
 * cadet who sees 1–11 and then nothing has no way to tell a release window from an outage,
 * and the instructor gets the email.
 *
 * @param {object} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.includeLocked=false] return unreleased assignments too, each carrying
 *   `released:false` and `releasesAt`. For surfaces that must reason about an assignment the
 *   student cannot yet see — the artifact receiver, which has to refuse an early submission
 *   rather than silently accept one against a lesson that is not open.
 * @returns {Promise<Array>} sorted by effective due date (undated last), each:
 *   { offeringId, slug, title, description, pointsPossible, activities, written, interactive,
 *     isChoice, due, isPast, dueSource, released, releasesAt, submission, grade, status,
 *     chosenActivity, answered, qCount, earned }
 *   plus `lockedCount` on the array itself — how many were withheld.
 */
export async function loadAssignmentStatuses(ctx, { includeLocked = false } = {}) {
  if (!ctx.currentOffering) return [];
  const enrollmentIds = myEnrollmentIds(ctx);
  const sectionId = mySectionId(ctx);

  const { data: offeringRows } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('course_offering_id', ctx.currentOffering)
    .eq('is_published', true)
    .order('position', { ascending: true, nullsFirst: false });

  const offerings = shapeOfferings(offeringRows, ctx);
  if (!offerings.length) return [];

  // Their work + their grades + any extension. Scoped by enrollment, which is what every
  // per-student table in this model keys on.
  //
  // The STUDENT selects, not the faculty ones (schema.js) — no `diagnostic`, no `report_markdown`,
  // no `submission_activities.content`. A cadet's page never renders any of it, and `content` on
  // an interactive activity is the AI's assessment OF them, honor status included.
  //
  // Their own written ANSWERS live in that same column, though, and the draft-resume path needs
  // them — so they are fetched as a fourth query narrowed to the written activities of the
  // offerings just loaded. Filtering by `activity_id` is what makes the split safe: no interactive
  // activity's id is in the list, so no `d` can come back however RLS is written. It costs no
  // round trip (the offerings are already resolved, so it joins the same Promise.all) and it is a
  // structural guarantee rather than a client-side strip, which would be theatre — the data would
  // already have crossed the wire.
  const writtenActivityIds = offerings.map(o => o.written?.id).filter(Boolean);

  let submissions = [], grades = [], extensions = [], answerRows = [];
  if (enrollmentIds.length) {
    const [subs, grds, exts, answers] = await Promise.all([
      db.from('submissions').select(SUBMISSION_SELECT_STUDENT).in('enrollment_id', enrollmentIds),
      db.from('grades').select(GRADE_SELECT_STUDENT).in('enrollment_id', enrollmentIds),
      // revoked_at IS NULL is the EXTENSION_SELECT contract (schema.js): a revoked extension is
      // not an extension, and this loader feeding one to effectiveDue() would show the cadet an
      // extended deadline that commitSubmission()'s own fresh fetch then refuses.
      db.from('extensions').select('assignment_offering_id, extended_due_at')
        .in('enrollment_id', enrollmentIds).is('revoked_at', null),
      writtenActivityIds.length
        ? db.from('submission_activities').select('submission_id,activity_id,content')
            .in('activity_id', writtenActivityIds)
        : Promise.resolve({ data: [] }),
    ]);
    submissions = (subs.data || []).map(shapeSubmission);
    grades = grds.data || [];
    extensions = exts.data || [];
    answerRows = answers.data || [];
  }

  // Graft the answers back onto the activity entries shapeSubmission() already built, so every
  // reader downstream still finds them at `submission.activities[writtenId].content` and nothing
  // outside this function has to know the fetch was split.
  if (answerRows.length) {
    const subById = Object.fromEntries(submissions.map(s => [s.id, s]));
    answerRows.forEach(r => {
      const act = subById[r.submission_id]?.activities?.[r.activity_id];
      if (act) act.content = r.content || null;
    });
  }

  const subByOffering   = Object.fromEntries(submissions.map(s => [s.offeringId, s]));
  const gradeByOffering = Object.fromEntries(grades.map(g => [g.assignment_offering_id, g]));
  const extByOffering   = Object.fromEntries(extensions.map(e => [e.assignment_offering_id, e.extended_due_at]));

  const now = new Date();

  const items = offerings.map(o => {
    const submission = subByOffering[o.offeringId] || null;
    const grade = gradeByOffering[o.offeringId] || null;
    const { due, isPast, source } = effectiveDue(o, sectionId, extByOffering[o.offeringId]);
    const status = deriveStatus({ submission, grade, isPast });

    // The release window is measured from the SCHEDULED deadline — the same call with the
    // extension left out. Passing the extended date would mean that granting a student more
    // time could push the assignment past the window and remove it from their list, which is
    // the exact opposite of what an extension is for.
    const { due: scheduledDue } = effectiveDue(o, sectionId, null, now);

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
      released: isReleased(o, scheduledDue, now),
      releasesAt: releaseAt(o, scheduledDue),
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
  items.sort((a, b) => {
    if (a.due && b.due) return a.due - b.due;
    if (a.due) return -1;
    if (b.due) return 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });

  if (includeLocked) { items.lockedCount = 0; return items; }

  /* WORK THE STUDENT HAS ALREADY DONE IS NEVER WITHDRAWN.
   * The window is a pacing rule about starting something early, not a claim on anything
   * already started, and the two come apart in ordinary use: a director who pushes a deadline
   * back a fortnight, or sets an explicit open date after the fact, would otherwise take a
   * submitted assignment and its released grade off the student's page with no explanation.
   * A row that has a submission or a grade has by definition already been seen. */
  const visible = items.filter(a => a.released || a.submission || a.grade);
  visible.lockedCount = items.length - visible.length;
  return visible;
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

/* ── The deadline, at submit time ────────────────────────────────────────────────────────────
 *
 * Every other deadline on a student surface is resolved once when the page loads and then only
 * rendered. The submit button is the one place that consequence hangs on, and it is reached
 * arbitrarily long after that load: a tab left open across 2359 still holds "not past yet", which
 * is how a late submission got in even though the list, the card and the receiver page all had a
 * past-due state. So the writes below re-read the deadline instead of trusting what they were
 * handed — the offering with its per-section overrides and per-day schedule, and the student's own
 * active extension. The clock is not the only thing that moves: an extension granted or revoked
 * since the page loaded changes the answer too, and in the direction that matters most.
 *
 * The precedence itself is not re-implemented here. schema.js owns it; a second derivation in the
 * one code path that refuses a student is exactly the divergence that module exists to prevent.
 */

/** Mirrors util.js fmtDateTime, which is not imported here: util.js reads `location` at import
 *  time, and this module must load anywhere a student query does. */
function whenText(due) {
  if (!due || isNaN(due)) return '';
  return due.toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The deadline that applies to this student right now, read fresh from the database.
 *
 * `revoked_at IS NULL` is not optional — a revoked extension is not an extension (EXTENSION_SELECT).
 * Where a student somehow holds more than one active extension, the latest wins: a refusal must
 * never be produced by picking the stingier of two grants a director made.
 *
 * @returns {{ due: Date|null, isPast: boolean, source: string, offering: object|null }}
 *   `isPast` already carries GRACE_MS; `offering` is the freshly shaped row, so a caller that
 *   needs the current grading role does not fetch it twice.
 */
async function currentDeadline(ctx, offeringId) {
  const enrollmentIds = myEnrollmentIds(ctx);

  const [offeringRes, extRes] = await Promise.all([
    db.from('assignment_offerings').select(OFFERING_SELECT).eq('id', offeringId).maybeSingle(),
    enrollmentIds.length
      ? db.from('extensions').select('extended_due_at')
          .in('enrollment_id', enrollmentIds)
          .eq('assignment_offering_id', offeringId)
          .is('revoked_at', null)
          .order('extended_due_at', { ascending: false })
          .limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const offering = offeringRes.data
    ? withResolvedDue(shapeOffering(offeringRes.data), offeringSections(ctx))
    : null;
  // No row back means the read failed or RLS withheld it. Refusing on that would turn a network
  // blip into "you missed the deadline", which is the one error a student cannot argue with; the
  // write itself is still governed by RLS and the DB's own triggers.
  if (!offering) return { due: null, isPast: false, source: 'none', offering: null };

  return {
    ...effectiveDue(offering, mySectionId(ctx), extRes.data?.extended_due_at || null),
    offering,
  };
}

/** The refusal. It names the deadline, because "too late" without a date is the first thing a
 *  student has to ask their instructor about, and it says what happened to their work — a refusal
 *  that reads as data loss sends them to redo work that is already stored. */
function pastDueError(due, kept) {
  const when = whenText(due);
  return new Error(
    `The deadline for this assignment${when ? ` — ${when}` : ''} has passed, so it can no longer `
    + `be submitted. ${kept} If you think this is wrong, contact your instructor: they can grant `
    + 'you an extension or reopen the assignment.');
}

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
  if (!enrollmentId) return { data: null, error: new Error('No active enrollment for this course.') };

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
 * The DB is still the authority — submissions_check_gradable() rejects a chosen_activity_id that
 * is not `graded` in this offering, and submissions_lock_activity() governs changing one already
 * committed. This does NOT try to force a choice through either of them.
 *
 * What it does now do is check the same two conditions FIRST, for one reason: a PostgreSQL
 * `RAISE EXCEPTION` is not a sentence you can show a student. The refusals read
 * "submission 7f3a… is locked to interactive by switch_policy=lock_on_commit" and went straight
 * into the page's error banner verbatim. The triggers remain the guarantee; these are the words.
 * submitInteractionReport() has always checked its own preconditions this way.
 *
 * The two writes are also ordered the other way round than they were. `is_final` used to be set
 * before the commit, so a refused commit still left the activity flagged final — a write that
 * outlived the operation it belonged to. The commit is what the triggers police, so it goes first
 * and nothing is marked final until it lands.
 *
 * THE DEADLINE IS CHECKED HERE, not only in the page. The MISSED state a student sees is computed
 * at page load, so it gates opening the form and nothing else: a tab already open at 2359 kept a
 * live Submit button. Nothing else refused it — no trigger, no policy — so this is the whole
 * enforcement until the deadline-enforcement migration lands (schema.js GRACE_MS).
 */
export async function commitSubmission(ctx, offeringId, activityId) {
  // First, and from the database rather than from whatever the page believes. Before
  // ensureSubmission() too, so a refused late click writes nothing at all.
  const { due, isPast } = await currentDeadline(ctx, offeringId);
  if (isPast) {
    // Their answers are untouched: the caller saves them into submission_activities before
    // committing, and that row is written whether or not the commit is allowed. A refusal costs
    // them the submission, never the work.
    return { error: pastDueError(due, 'Your answers are saved and your instructor can still see '
                                    + 'them — nothing you wrote has been lost.') };
  }

  const { data: submission, error } = await ensureSubmission(ctx, offeringId);
  if (error || !submission) return { error: error || new Error('Could not open a submission.') };

  // Can this activity carry credit at all? (mirrors submissions_check_gradable)
  const { data: oa } = await db.from('offering_activities')
    .select('grading_role')
    .eq('assignment_offering_id', offeringId)
    .eq('activity_id', activityId)
    .maybeSingle();
  if (oa?.grading_role !== 'graded') {
    return { error: new Error('This isn’t the graded part of the assignment, so it can’t be '
                            + 'submitted for credit. Check the lesson page for how to complete it.') };
  }

  // Is the choice already spent elsewhere? (mirrors submissions_lock_activity)
  if (submission.status === 'committed' && submission.chosenActivityId
      && submission.chosenActivityId !== activityId) {
    return { error: new Error('You’ve already completed this assignment another way, and that '
                            + 'version is the one being graded. Ask your instructor if you need '
                            + 'it reopened.') };
  }

  const { error: cErr } = await db.from('submissions').update({
    chosen_activity_id: activityId,
    status: 'committed',
    committed_at: new Date().toISOString(),
  }).eq('id', submission.id);
  if (cErr) return { error: cErr };

  const { error: aErr } = await db.from('submission_activities')
    .update({ is_final: true })
    .eq('submission_id', submission.id).eq('activity_id', activityId);
  if (aErr) return { error: aErr };

  return { error: null };
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

  const offering = shapeOfferings(offeringRows, ctx)[0] || null;
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
  // re-checked here where it cannot be skipped. Past-due is now checked the same way, below; a
  // DB-level guard on both is still the hardening follow-up (CHANGELOG 2026-07-23).
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

  // The deadline, re-read at submit time. The page's past-due stop was computed when it loaded,
  // and this receiver is routinely opened long after that — the artifact runs on claude.ai and the
  // student comes back with the report in a URL whenever they finish.
  //
  // ONLY THE GRADED PATH IS REFUSED. A practice activity carries no credit, so a late practice
  // report costs nobody anything, and recording it is the revealed-preference signal the research
  // design is after — the same reason practice work is stored at all. The role is taken from the
  // freshly read offering, so a lesson whose grading role changed since the page loaded is judged
  // on what it is now.
  const fresh = await currentDeadline(ctx, offering.offeringId);
  const offered = (fresh.offering || offering).activities.find(a => a.id === activity.id) || null;
  if (offered?.gradingRole === 'graded' && fresh.isPast) {
    return { error: pastDueError(fresh.due, 'Your report is still shown on this page — copy it if '
                                          + 'you want to keep it; nothing about it has been lost.') };
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
