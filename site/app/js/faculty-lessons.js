// faculty-lessons.js — data layer for the faculty Lesson builder, against schema `app`.
//
// WHAT MOVED
//   lessons (own table)          ->  gone. A "lesson" IS an assignment offering.
//   lessons.preflight_id         ->  activities(modality='written')   of the same assignment
//   lessons.interaction_id       ->  activities(modality='interactive') of the same assignment
//   assignments.questions        ->  activities.content.questions
//   interactions.artifact_url    ->  activities.content.artifact_url
//   lessons.completion_policy    ->  DERIVED from offering_activities.grading_role
//   due_date_m / due_date_t      ->  assignment_offerings.due_at + assignment_due_dates(section)
//   *.is_published (3 places)    ->  assignment_offerings.is_published (one place, per term)
//   scores(student, assignment)  ->  grades(enrollment, assignment_offering)
//
// ── THE THREE THINGS A DIRECTOR WILL NOTICE ─────────────────────────────────────────
//
// 1. A LESSON IS NO LONGER ASSEMBLED FROM TWO INDEPENDENT PIECES.
//    The old page let you drag ANY orphan preflight together with ANY orphan interaction and
//    staple them into a lesson. In v2 the written question set and the interactive artifact are
//    both `activities` OF ONE `assignments` container — they are what is inside it, not two
//    rows a third row points at. So composing means picking a CONTAINER (which brings its
//    activities with it) and scheduling it into this term. The old cross-pairing is not
//    expressible, and deliberately so: it was the reconciliation layer the v2 model removes.
//
// 2. "ALLOWED MODE" IS DERIVED, NEVER STORED.
//    There is no completion_policy column. Two graded activities in the offering means the
//    student chooses; exactly one means it is required. This module translates the three
//    familiar labels to and from `offering_activities.grading_role` so the UI is unchanged:
//      preflight   -> written graded,     interactive practice (if attached)
//      interaction -> interactive graded, written practice     (if attached)
//      choice      -> both graded
//
// 3. SETTING A COMPONENT TO "NONE" NO LONGER DELETES IT.
//    It removes the offering_activity row — the activity stays in the library and can be
//    re-attached next term. Publish state moved with it: activities have no is_published, so
//    unpublishing a lesson no longer reaches into shared content. That whole class of "a lesson
//    silently unpublished a standalone assignment" bug is gone with the columns.
//
// SAFETY NOTE ON DELETES. `submissions` and `grades` hang off the OFFERING with ON DELETE
// CASCADE, so removing a scheduled lesson destroys this term's student work — which the old
// "delete container only" did NOT. countLessonWork() exists so the page can state the number
// before the director commits, never after.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, shapeOffering, questionsOf, lessonNumber, chunked,
} from './schema.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Derived policy  <->  offering_activities.grading_role
 * ════════════════════════════════════════════════════════════════════════════ */

/** The familiar three-way label for an offering, read back out of the graded roles. */
export function policyOf(offering) {
  const graded = offering?.gradedActivities || [];
  if (graded.length > 1) return 'choice';
  if (graded.length === 1) return graded[0].modality === 'interactive' ? 'interaction' : 'preflight';
  return 'choice';   // nothing graded yet — the editor's neutral default
}

/** grading_role for one modality under a chosen policy. */
export function roleFor(policy, modality) {
  if (policy === 'choice') return 'graded';
  if (policy === 'interaction') return modality === 'interactive' ? 'graded' : 'practice';
  return modality === 'written' ? 'graded' : 'practice';   // 'preflight'
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Slugs
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The slug for a written activity, minted from the course code and the assignment slug.
 *
 * `activities.slug` is globally unique, so it CANNOT just be the assignment slug —
 * phys-110 and phys-215 both have a `preflight-02`. This reproduces the namespacing the
 * migration used (`phys-110-preflight-31-written`), which is also why written slugs are
 * generated rather than typed: nothing external references them.
 */
export const writtenSlugFor = (courseCode, assignmentSlug) =>
  `${courseCode || 'course'}-${assignmentSlug}-written`;

/**
 * An interactive activity's slug is the OPPOSITE case: it is the FROZEN contract surface.
 * Deployed Claude artifacts post to `interaction-submit.html#i=<slug>`, so the director types
 * it, it must match the artifact, and it is never regenerated or renamed once shipped.
 */
export const isValidSlug = (s) => /^[a-z0-9-]+$/.test(String(s || '').trim());

/* ══════════════════════════════════════════════════════════════════════════════
 * Loading
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the Lessons page renders.
 *
 * Two lists, because v2 separates the two questions the old single list conflated:
 *   lessons — what is SCHEDULED in ctx.currentOffering (this term's run)
 *   library — assignments in ctx.currentCourse NOT scheduled here yet (available to schedule)
 *
 * Directors see drafts; instructors see only published offerings (RLS already enforces the
 * read side — the filter narrows the query, it does not secure it).
 *
 * @returns {{ noCourse?, isDirector, lessons:[], library:[], meetingDays:[], sections:[] }}
 */
export async function loadManager(ctx) {
  const empty = { noCourse: true, isDirector: false, lessons: [], library: [], meetingDays: [], sections: [] };
  if (!ctx.currentOffering || !ctx.currentCourse) return empty;
  const isDirector = ctx.isDirectorForCurrent();

  let offeringQ = db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('course_offering_id', ctx.currentOffering)
    .order('position', { ascending: true, nullsFirst: false });
  if (!isDirector) offeringQ = offeringQ.eq('is_published', true);

  const [{ data: offeringRows }, { data: libraryRows }, { data: sectionRows }] = await Promise.all([
    offeringQ,
    // The catalogue for this course, with its activities — the "schedule an existing
    // assignment" picker. Archived containers are hidden; they are the v2 retirement flag.
    db.from('assignments')
      .select('id,course_id,kind_id,slug,title,description,objectives,is_archived,' +
              'activities(id,slug,modality,title,content,position)')
      .eq('course_id', ctx.currentCourse).eq('is_archived', false)
      .order('slug'),
    db.from('sections')
      .select('id,code,meeting_days,period')
      .eq('course_offering_id', ctx.currentOffering).order('code'),
  ]);

  const lessons = (offeringRows || [])
    .map(shapeOffering)
    .filter(Boolean)
    .map(o => ({
      ...o,
      policy: policyOf(o),
      lessonNumber: o.position ?? lessonNumber(o.slug, o.title),
      questionCount: questionsOf(o.written).length,
    }))
    .sort((a, b) => (a.lessonNumber ?? 1e9) - (b.lessonNumber ?? 1e9)
                 || String(a.slug || '').localeCompare(String(b.slug || '')));

  const scheduled = new Set(lessons.map(l => l.assignmentId));
  const library = (libraryRows || []).map(a => {
    const acts = (a.activities || []).slice()
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      courseId: a.course_id,
      kind: a.kind_id,
      objectives: Array.isArray(a.objectives) ? a.objectives : [],
      activities: acts,
      written: acts.find(x => x.modality === 'written') || null,
      interactive: acts.find(x => x.modality === 'interactive') || null,
      questionCount: (acts.find(x => x.modality === 'written')?.content?.questions || []).length,
      // Which offering in THIS term already runs it (null = free to schedule).
      scheduledAs: lessons.find(l => l.assignmentId === a.id)?.offeringId || null,
      isScheduled: scheduled.has(a.id),
    };
  });

  const sections = sectionRows || [];
  // The distinct meeting-day letters actually present in this offering. The old page hardcoded
  // M and T; the pattern is data on the section now, so the due-date UI is generated from it
  // and a course meeting W/F needs no code change.
  const meetingDays = [...new Set(sections.flatMap(s => s.meeting_days || []))].sort();

  return { noCourse: false, isDirector, lessons, library, sections, meetingDays };
}

/** One library assignment with its activities — used when the editor opens a container. */
export async function getLibraryAssignment(assignmentId) {
  if (!assignmentId) return null;
  const { data } = await db.from('assignments')
    .select('id,course_id,kind_id,slug,title,description,objectives,is_archived,' +
            'activities(id,slug,modality,title,content,position)')
    .eq('id', assignmentId).maybeSingle();
  if (!data) return null;
  const acts = data.activities || [];
  return {
    ...data,
    objectives: Array.isArray(data.objectives) ? data.objectives : [],
    written: acts.find(a => a.modality === 'written') || null,
    interactive: acts.find(a => a.modality === 'interactive') || null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Due dates — per meeting-day, materialized per section
 * ════════════════════════════════════════════════════════════════════════════ */

/** 'YYYY-MM-DD' -> the end-of-day local ISO the DB stores as timestamptz. */
const endOfDay = (d) => (d ? `${d}T23:59:59` : null);

/**
 * Turn the editor's per-day map ({M:'2026-08-24', T:'2026-08-25'}) into one
 * assignment_due_dates row per section, using each section's own meeting_days.
 *
 * This is the generalization of due_date_m / due_date_t. The old pair inferred the day by
 * sniffing the FIRST CHARACTER of a section code ('M1A' -> M-day), which broke the moment a
 * course met on any other pattern. Now the pattern is a column and the override is a row.
 */
export function dueRowsFor(offeringId, dueByDay, sections) {
  const rows = [];
  (sections || []).forEach(sec => {
    // First meeting day with a date wins; a section meeting M/W/F takes the M date.
    const day = (sec.meeting_days || []).find(d => dueByDay?.[d]);
    if (!day) return;
    rows.push({ assignment_offering_id: offeringId, section_id: sec.id, due_at: endOfDay(dueByDay[day]) });
  });
  return rows;
}

/** The offering's DEFAULT deadline: the earliest per-day date, so nobody's default is late. */
export function defaultDueFrom(dueByDay) {
  const all = Object.values(dueByDay || {}).filter(Boolean).sort();
  return all.length ? endOfDay(all[0]) : null;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Retroactive grade correction
 * ════════════════════════════════════════════════════════════════════════════ */

const pointsOf = (q) => (isNaN(Number(q?.points)) ? 0 : Number(q.points));

/** True iff a question that ALREADY existed changed its point value. Added/removed questions
 *  don't qualify — they have no graded rows to correct. */
export function pointsChanged(oldQs, newQs) {
  return (newQs || []).some(q => {
    const old = (oldQs || []).find(oq => oq.id === q.id);
    return old && pointsOf(old) !== pointsOf(q);
  });
}

/**
 * Propagate changed question points onto every existing grade for an offering.
 *
 * Without this, editing a question's value on an already-graded lesson leaves each row stale:
 * `question_scores[q].max` keeps the OLD number and the total no longer agrees with the
 * questions — students see wrong totals and the export ships them.
 *
 * ONE V2 DIFFERENCE THAT MATTERS: the ceiling is no longer the sum of the question points, it
 * is `assignment_offerings.points_possible`, and `grades_within_bounds` is a CHECK. So the
 * recomputed total is clamped to the offering's value — the write is rejected outright
 * otherwise, which is the constraint doing the job the old code had to remember to do.
 *
 * Preserves the 3-state status: `zero` stays 0, `full`/`warn` take the new value (warn is full
 * credit with a flag). Questions absent from a row are left alone — they were never graded.
 *
 * @returns {number} rows rewritten (0 if none existed or the write failed).
 */
export async function retroactivelyUpdateGrades(offeringId, questions, pointsPossible) {
  const qs_ = questions || [];
  const { data: grades, error } = await db.from('grades')
    .select('id, enrollment_id, question_scores, is_finalized, points_possible')
    .eq('assignment_offering_id', offeringId);
  if (error || !grades?.length) return 0;

  const possible = Number(pointsPossible ?? 0);
  const rows = grades.map(row => {
    const qs = { ...(row.question_scores || {}) };
    qs_.forEach(q => {
      if (!qs[q.id]) return;                       // never graded — nothing to correct
      const status = qs[q.id].status || (Number(qs[q.id].score) > 0 ? 'full' : 'zero');
      qs[q.id] = { ...qs[q.id], max: pointsOf(q), score: status === 'zero' ? 0 : pointsOf(q) };
    });
    const total = qs_.reduce((s, q) => s + (Number(qs[q.id]?.score) || 0), 0);
    return {
      enrollment_id: row.enrollment_id,
      assignment_offering_id: offeringId,
      question_scores: qs,
      points_earned: Math.min(Math.round(total * 1000) / 1000, possible),
      points_possible: possible,
      is_finalized: row.is_finalized,
    };
  });

  const { error: upErr } = await db.from('grades')
    .upsert(rows, { onConflict: 'enrollment_id,assignment_offering_id' });
  return upErr ? 0 : rows.length;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Saving
 * ════════════════════════════════════════════════════════════════════════════ */

/** Existing activities of a container, keyed by modality. */
async function activitiesOf(assignmentId) {
  const { data } = await db.from('activities')
    .select('id,slug,modality,title,content,position').eq('assignment_id', assignmentId);
  const out = { written: null, interactive: null };
  (data || []).forEach(a => { out[a.modality] = a; });
  return out;
}

/**
 * Create or update one lesson: container -> activities -> offering -> roles -> deadlines.
 *
 * The order is forced by the foreign keys, and each step is a separate round trip because
 * PostgREST has no transaction across requests. A failure therefore leaves the earlier steps
 * applied — which is survivable precisely because every step is an upsert keyed on something
 * stable, so re-clicking Save converges rather than duplicating.
 *
 * model = {
 *   offeringId, assignmentId, courseId, courseOfferingId, courseCode,
 *   slug, title, description, lessonNumber, objectives[],
 *   policy: 'preflight'|'interaction'|'choice',
 *   pointsPossible, gradingMode, switchPolicy, isPublished,
 *   dueByDay: { M:'YYYY-MM-DD', … }, sections: [{id, meeting_days}],
 *   written:     { include, questions[], reference_pdf, reference_pages, reading_link },
 *   interactive: { include, slug, title, artifact_url, description },
 * }
 *
 * @returns {{ error, offeringId, rescored, unchosen }}
 *   rescored — grades rewritten because a question's point value changed (the page must SAY so;
 *              a silent bulk total rewrite is exactly what a director has to be told about).
 *   unchosen — students whose committed choice was cleared because the activity they picked was
 *              detached from the offering (the composite FK is ON DELETE SET NULL).
 */
export async function saveLesson(ctx, model, editingOfferingId) {
  const out = { error: null, offeringId: editingOfferingId || null, rescored: 0, unchosen: 0 };
  const courseOfferingId = model.courseOfferingId || ctx.currentOffering;

  /* 1 ── the CONTAINER (assignments). Term-free, reusable, carries no grading policy. */
  let assignmentId = model.assignmentId || null;
  const container = {
    course_id: model.courseId,
    kind_id: model.kind || 'preflight',
    title: model.title,
    description: model.description ?? null,
    objectives: Array.isArray(model.objectives) ? model.objectives : [],
  };
  if (assignmentId) {
    const { error } = await db.from('assignments').update(container).eq('id', assignmentId);
    if (error) return { ...out, error };
  } else {
    const { data, error } = await db.from('assignments')
      .insert({ ...container, slug: model.slug }).select('id').single();
    if (error) return { ...out, error };
    assignmentId = data.id;
  }
  out.assignmentId = assignmentId;

  /* 2 ── the ACTIVITIES (what is inside the container). */
  const existing = await activitiesOf(assignmentId);
  const wanted = [];      // [{ id, modality }] — everything that should be attached this term

  if (model.written?.include) {
    const content = {
      questions: model.written.questions || [],
      reading_link: model.written.reading_link || null,
      reference_pdf: model.written.reference_pdf || null,
      reference_pages: model.written.reference_pages || null,
    };
    if (existing.written) {
      // Snapshot the stored points BEFORE the overwrite so a change can be detected.
      const prevQs = existing.written.content?.questions || [];
      const { error } = await db.from('activities')
        .update({ title: model.title, content }).eq('id', existing.written.id);
      if (error) return { ...out, error };
      wanted.push({ id: existing.written.id, modality: 'written' });
      if (pointsChanged(prevQs, content.questions) && editingOfferingId) {
        out.rescored = await retroactivelyUpdateGrades(
          editingOfferingId, content.questions, model.pointsPossible);
      }
    } else {
      const { data, error } = await db.from('activities').insert({
        assignment_id: assignmentId,
        modality: 'written',
        slug: writtenSlugFor(model.courseCode, model.slug),
        title: model.title,
        content,
        position: 0,
      }).select('id').single();
      if (error) return { ...out, error };
      wanted.push({ id: data.id, modality: 'written' });
    }
  }

  if (model.interactive?.include) {
    const content = {
      artifact_url: model.interactive.artifact_url || null,
      description: model.interactive.description || null,
    };
    if (existing.interactive) {
      // The slug is NEVER rewritten here. It is the frozen `#i=` contract and every student
      // report already posted resolves through it; a swap is an explicit delete + create,
      // handled by replaceInteractive() so the report loss is confirmed first.
      const { error } = await db.from('activities')
        .update({ title: model.interactive.title || model.title, content })
        .eq('id', existing.interactive.id);
      if (error) return { ...out, error };
      wanted.push({ id: existing.interactive.id, modality: 'interactive' });
    } else {
      const { data, error } = await db.from('activities').insert({
        assignment_id: assignmentId,
        modality: 'interactive',
        slug: model.interactive.slug,
        title: model.interactive.title || model.title,
        content,
        position: 1,
      }).select('id').single();
      if (error) return { ...out, error };
      wanted.push({ id: data.id, modality: 'interactive' });
    }
  }

  /* 3 ── the OFFERING (this term's run: points, deadline, publish). */
  const offeringRow = {
    points_possible: Number(model.pointsPossible ?? 2),
    grading_mode: model.gradingMode || 'points',
    switch_policy: model.switchPolicy || 'lock_on_commit',
    due_at: defaultDueFrom(model.dueByDay),
    is_published: !!model.isPublished,
    position: model.lessonNumber == null ? null : model.lessonNumber,
  };
  let offeringId = editingOfferingId || null;
  if (offeringId) {
    const { error } = await db.from('assignment_offerings').update(offeringRow).eq('id', offeringId);
    if (error) return { ...out, error };
  } else {
    const { data, error } = await db.from('assignment_offerings').insert({
      course_offering_id: courseOfferingId,
      assignment_id: assignmentId,
      ...offeringRow,
    }).select('id').single();
    if (error) return { ...out, error };
    offeringId = data.id;
  }
  out.offeringId = offeringId;

  /* 4 ── offering_activities: WHICH activities are live and WHICH carries credit.
   *      Diffed rather than delete-all-then-insert. Deleting a row a student already
   *      committed to nulls their chosen_activity_id through the composite FK, so rows that
   *      are staying must not be churned just to change a role. */
  const { data: currentOA } = await db.from('offering_activities')
    .select('activity_id, grading_role, available_after, is_visible, position')
    .eq('assignment_offering_id', offeringId);

  const wantIds = new Set(wanted.map(w => w.id));
  const stale = (currentOA || []).filter(r => !wantIds.has(r.activity_id));
  if (stale.length) {
    out.unchosen = await countCommittedTo(offeringId, stale.map(r => r.activity_id));
    const { error } = await db.from('offering_activities').delete()
      .eq('assignment_offering_id', offeringId)
      .in('activity_id', stale.map(r => r.activity_id));
    if (error) return { ...out, error };
  }

  const oaRows = wanted.map((w, i) => ({
    assignment_offering_id: offeringId,
    activity_id: w.id,
    grading_role: roleFor(model.policy, w.modality),
    available_after: model.availableAfter?.[w.modality] || 'always',
    is_visible: true,
    position: i,
  }));
  if (oaRows.length) {
    const { error } = await db.from('offering_activities')
      .upsert(oaRows, { onConflict: 'assignment_offering_id,activity_id' });
    if (error) return { ...out, error };
  }

  /* 5 ── per-section deadlines. No dependents, so a clean replace is safe. */
  const dueRows = dueRowsFor(offeringId, model.dueByDay, model.sections);
  const { error: delErr } = await db.from('assignment_due_dates')
    .delete().eq('assignment_offering_id', offeringId);
  if (delErr) return { ...out, error: delErr };
  if (dueRows.length) {
    const { error } = await db.from('assignment_due_dates')
      .upsert(dueRows, { onConflict: 'assignment_offering_id,section_id' });
    if (error) return { ...out, error };
  }

  return out;
}

/** How many students have COMMITTED to one of these activities — i.e. how many choices
 *  detaching them would silently clear. */
async function countCommittedTo(offeringId, activityIds) {
  if (!activityIds?.length) return 0;
  const { data } = await db.from('submissions')
    .select('id, chosen_activity_id')
    .eq('assignment_offering_id', offeringId)
    .in('chosen_activity_id', activityIds);
  return (data || []).length;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Publish
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Publish state is now ONE boolean in ONE place, on the offering.
 *
 * The old version mirrored the flag onto the assignment and interaction rows it "owned",
 * with an ownership rule (id === lesson id) invented purely to stop a lesson from
 * unpublishing shared content. Activities have no publish column, so both the mirroring and
 * the ownership rule are gone. Per-activity visibility, if ever needed, is
 * offering_activities.is_visible — a per-term decision, where it belongs.
 */
export function togglePublish(offeringId, isPublished) {
  return db.from('assignment_offerings')
    .update({ is_published: !isPublished }).eq('id', offeringId);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Removal
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Count the student work a removal would destroy.
 *
 * Worth being precise about, because the v2 answer is different from the old one: the old
 * "container only" delete destroyed NOTHING (responses hung off the assignment, which
 * survived). Here submissions and grades hang off the OFFERING, so unscheduling the lesson
 * takes this term's work with it.
 *
 * @returns {{ submissions, grades, reports }} reports = interactive artifacts received
 */
export async function countLessonWork(lesson) {
  const offeringId = lesson?.offeringId;
  if (!offeringId) return { submissions: 0, grades: 0, reports: 0 };

  const [{ data: subs }, { count: gradeCount }] = await Promise.all([
    db.from('submissions').select('id').eq('assignment_offering_id', offeringId),
    db.from('grades').select('*', { count: 'exact', head: true })
      .eq('assignment_offering_id', offeringId),
  ]);

  let reports = 0;
  const interactiveId = lesson.interactive?.id;
  const submissionIds = (subs || []).map(s => s.id);
  if (interactiveId && submissionIds.length) {
    for (const ids of chunked(submissionIds)) {
      const { count } = await db.from('submission_activities')
        .select('*', { count: 'exact', head: true })
        .eq('activity_id', interactiveId).in('submission_id', ids);
      reports += count || 0;
    }
  }
  return { submissions: (subs || []).length, grades: gradeCount || 0, reports };
}

/** Count the reports attached to ONE interactive activity — the swap/replace warning. */
export async function countActivityReports(activityId) {
  if (!activityId) return 0;
  const { count } = await db.from('submission_activities')
    .select('*', { count: 'exact', head: true }).eq('activity_id', activityId);
  return count || 0;
}

/**
 * Unschedule: delete the assignment_offering only.
 *
 * The library assignment and its activities survive and can be scheduled again — that is the
 * v2 equivalent of "delete the container, keep the parts". What does NOT survive is this
 * term's submissions and grades, which cascade. countLessonWork() first, always.
 */
export function unscheduleLesson(offeringId) {
  return db.from('assignment_offerings').delete().eq('id', offeringId);
}

/**
 * Delete the lesson AND its library definition (the nuclear "delete all contents").
 *
 * Order is forced: assignment_offerings.assignment_id is ON DELETE RESTRICT, so the offering
 * must go first or the assignment delete is refused. Activities cascade from the assignment,
 * and submission_activities cascade from the activities.
 *
 * Refuses when the container is scheduled in ANOTHER term — deleting shared library content
 * from inside one term's page would silently destroy a different offering's lesson.
 */
export async function deleteLessonAndContents(lesson) {
  const { offeringId, assignmentId } = lesson;
  const { data: others } = await db.from('assignment_offerings')
    .select('id').eq('assignment_id', assignmentId).neq('id', offeringId);
  if (others?.length) {
    return { error: { message:
      `This assignment is also scheduled in ${others.length} other term${others.length === 1 ? '' : 's'}. ` +
      `Remove it from this term instead — deleting the library definition would delete those too.` } };
  }
  let { error } = await db.from('assignment_offerings').delete().eq('id', offeringId);
  if (error) return { error };
  ({ error } = await db.from('assignments').delete().eq('id', assignmentId));
  return { error: error || null };
}

/**
 * Replace an assignment's interactive activity with a different SLUG.
 *
 * UNIQUE(assignment_id, modality) means a container holds at most one interactive activity, so
 * a new slug is not an edit — the old activity must go, and its student reports cascade with
 * it. That is a harder consequence than the old model's ("the old interaction is orphaned, never
 * deleted"), and the reason the page confirms with a real count first.
 *
 * When the slug is UNCHANGED, never call this: saveLesson() updates the URL in place and every
 * report stays attached. That is the safe path and the one to prefer.
 */
export async function replaceInteractive(assignmentId, oldActivityId, next) {
  if (oldActivityId) {
    const { error } = await db.from('activities').delete().eq('id', oldActivityId);
    if (error) return { error };
  }
  return db.from('activities').insert({
    assignment_id: assignmentId,
    modality: 'interactive',
    slug: next.slug,
    title: next.title || null,
    content: { artifact_url: next.artifact_url || null, description: next.description || null },
    position: 1,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Figures — unchanged: Supabase Storage is schema-agnostic
 * ════════════════════════════════════════════════════════════════════════════ */

/** Upload a figure to the PUBLIC `lesson-figures` bucket and return its public URL.
 *  Static-site friendly: the browser posts straight to Storage, never to GitHub Pages, and
 *  the question's `figure_url` then stores the returned public URL. */
const FIGURE_BUCKET = 'lesson-figures';
export async function uploadFigure(file) {
  if (!file || !(file.type || '').startsWith('image/')) return { error: { message: 'Choose an image file.' } };
  if (file.size > 5 * 1024 * 1024) return { error: { message: 'Image must be under 5 MB.' } };
  const ext  = ((file.name || '').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `q/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from(FIGURE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error };
  const { data } = db.storage.from(FIGURE_BUCKET).getPublicUrl(path);
  return { url: data?.publicUrl || null };
}
