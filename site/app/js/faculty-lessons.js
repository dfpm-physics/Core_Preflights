// faculty-lessons.js — data layer for the faculty Lesson creation/management tool.
//
// A *lesson* (migration 016) groups at most one written preflight (an assignments row)
// and at most one Claude-artifact interaction (an interactions row) under one slug, with a
// completion_policy (preflight | interaction | choice) that decides which mode(s) are allowed.
//
// Each component can come from one of two sources:
//   • "new"      — author the component inline (the preflight is keyed off the lesson slug;
//                  the interaction is keyed by the artifact's `#i=` slug).
//   • "existing" — REFERENCE an already-created assignment / interaction by id. Its content and
//                  publish state are NOT modified here; the lesson just points at it. This is how
//                  the pre-built Fall preflights and standalone interactions are combined into
//                  lessons without duplicating them.
// A component may also be omitted ("none"). "1 or both" — a lesson may carry just a preflight,
// just an interaction, or both; completion_policy then declares which of those modes students may use.
//
// Ownership rule: a component is lesson-OWNED (created inline) iff its id equals the lesson id.
// Only owned components are touched by publish mirroring; attached-existing (referenced) components
// are managed in their own tool. This keeps a shared standalone assignment/interaction from being
// silently unpublished when a lesson that references it is unpublished.
//
// Scope note: this is the authoring tool only. The student Save/Submit lifecycle, the
// completion-creating triggers, and the merged rollup are later phases of LESSON-UNIFICATION.

import { db } from './supabase.js';

const LESSON_COLS =
  'id, course_id, title, description, lesson_number, preflight_id, interaction_id, ' +
  'completion_policy, objectives, points, due_date_m, due_date_t, is_published';

// The preflight assignment a lesson AUTHORS inline is keyed off the lesson slug — there is no
// external contract on an assignments.id, so the director never manages a second id. (Attached
// existing preflights keep their own id; the interaction id is the artifact's `#i=` slug.)
export const preflightIdFor = (lessonSlug) => lessonSlug;

/** A component is created-inline (lesson-owned) iff its id equals the lesson id. */
export const isOwnedComponent = (lessonId, componentId) => !!componentId && componentId === lessonId;

/**
 * @returns {{ noCourse?, lessons:[...], assignments:[...], interactions:[...] }}
 *   Directors see all lessons (incl. drafts); instructors see only published ones.
 *   `assignments`/`interactions` are the full course-scoped lists that back the "use existing"
 *   pickers, each annotated with `ownedBy` (the lesson id already referencing it, or null).
 */
export async function loadManager(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true, lessons: [], assignments: [], interactions: [] };
  const isDirector = ctx.isDirectorForCurrent();

  let q = db.from('lessons').select(LESSON_COLS).eq('course_id', course)
    .order('lesson_number', { nullsFirst: false }).order('title');
  if (!isDirector) q = q.eq('is_published', true);

  // Full course lists power both the "use existing" pickers and the lesson-card hydration below.
  const [{ data: lessonRows }, { data: allAsgn }, { data: allInter }] = await Promise.all([
    q,
    db.from('assignments')
      .select('id, title, description, questions, is_published, due_date_m, due_date_t')
      .eq('course_id', course)
      .order('due_date_m', { ascending: true, nullsFirst: false }).order('title'),
    db.from('interactions')
      .select('id, title, description, artifact_url, is_published')
      .eq('course_id', course).order('title'),
  ]);
  const lessons = lessonRows || [];
  const assignments = allAsgn || [];
  const interactions = allInter || [];

  // Which existing rows are already referenced by a lesson (and by which one).
  const asgnOwner = {}, interOwner = {};
  lessons.forEach(l => {
    if (l.preflight_id)   asgnOwner[l.preflight_id]   = l.id;
    if (l.interaction_id) interOwner[l.interaction_id] = l.id;
  });

  const asgnById  = Object.fromEntries(assignments.map(a => [a.id, a]));
  const interById = Object.fromEntries(interactions.map(i => [i.id, i]));

  const items = lessons.map(l => ({
    ...l,
    objectives: Array.isArray(l.objectives) ? l.objectives : [],
    preflight:   l.preflight_id   ? (asgnById[l.preflight_id]   || null) : null,
    interaction: l.interaction_id ? (interById[l.interaction_id] || null) : null,
  }));

  return {
    noCourse: false,
    lessons: items,
    assignments: assignments.map(a => ({
      id: a.id, title: a.title, is_published: a.is_published,
      nq: (a.questions || []).length, ownedBy: asgnOwner[a.id] || null,
    })),
    interactions: interactions.map(i => ({
      id: i.id, title: i.title, artifact_url: i.artifact_url, is_published: i.is_published,
      ownedBy: interOwner[i.id] || null,
    })),
  };
}

/**
 * Create (editingId null) or update a lesson and its inline-authored components.
 * Inline ("new") components are upserted first so the lesson's FKs resolve; "existing" components
 * are referenced by id only (never modified); "none" leaves the FK null.
 *
 * model = {
 *   id, course_id, title, description, lesson_number,
 *   completion_policy, objectives:[{key,label}], due_date_m, due_date_t, is_published,
 *   questions:[…],                                   // inline preflight builder (source 'new')
 *   preflight:    { source:'none'|'existing'|'new', existingId },
 *   interaction:  { source:'none'|'existing'|'new', existingId, id, title, artifact_url, description },
 * }
 * @returns {{ error: object|null }} the first error encountered, or null on success.
 */
export async function saveLesson(model, editingId) {
  const { id, course_id, is_published } = model;
  const pf = model.preflight   || { source: 'none' };
  const it = model.interaction || { source: 'none' };
  let preflight_id = null, interaction_id = null;

  // 1) Preflight component.
  if (pf.source === 'new') {
    const asgnId = preflightIdFor(id);
    // assignments.due_date is NOT NULL — mirror admin.html and seed it from the lesson dates.
    const seed = model.due_date_m || model.due_date_t || new Date().toISOString();
    const { error } = await db.from('assignments').upsert({
      id: asgnId,
      course_id,
      title: model.title,
      description: model.description,
      questions: model.questions || [],
      due_date:   seed,
      due_date_m: model.due_date_m,
      due_date_t: model.due_date_t,
      is_published,
    }, { onConflict: 'id' });
    if (error) return { error };
    preflight_id = asgnId;
  } else if (pf.source === 'existing') {
    if (!pf.existingId) return { error: { message: 'Select an existing preflight assignment.' } };
    preflight_id = pf.existingId;                    // reference only — never modified here
  }

  // 2) Interaction component.
  if (it.source === 'new') {
    const { error } = await db.from('interactions').upsert({
      id: it.id,
      course_id,
      title: it.title || model.title,
      description: it.description,
      artifact_url: it.artifact_url,
      is_published,
    }, { onConflict: 'id' });
    if (error) return { error };
    interaction_id = it.id;
  } else if (it.source === 'existing') {
    if (!it.existingId) return { error: { message: 'Select an existing interaction.' } };
    interaction_id = it.existingId;                  // reference only — never modified here
  }

  // 3) The lesson row itself. Insert on create (surfaces a duplicate-slug 23505); update on edit.
  const row = {
    id, course_id,
    title: model.title,
    description: model.description,
    lesson_number: model.lesson_number,
    preflight_id, interaction_id,
    completion_policy: model.completion_policy,
    objectives: model.objectives || [],
    due_date_m: model.due_date_m,
    due_date_t: model.due_date_t,
    is_published,
  };
  const { error } = editingId
    ? await db.from('lessons').update(row).eq('id', editingId)
    : await db.from('lessons').insert(row);
  return { error: error || null };
}

/** Toggle a lesson's published flag. Mirror it ONLY onto components the lesson owns (created
 *  inline, id === lesson id) so a published lesson's own parts follow it — while a referenced,
 *  shared standalone assignment/interaction keeps whatever publish state its own tool set. */
export async function togglePublish(lesson) {
  const next = !lesson.is_published;
  const { error } = await db.from('lessons').update({ is_published: next }).eq('id', lesson.id);
  if (error) return { error };
  if (isOwnedComponent(lesson.id, lesson.preflight_id))
    await db.from('assignments').update({ is_published: next }).eq('id', lesson.preflight_id);
  if (isOwnedComponent(lesson.id, lesson.interaction_id))
    await db.from('interactions').update({ is_published: next }).eq('id', lesson.interaction_id);
  return { error: null };
}

/** Delete the lesson row only. Its component assignment/interaction rows are left intact
 *  (the FK is ON DELETE SET NULL); deleting student work is never implicit here. */
export function deleteLesson(id) {
  return db.from('lessons').delete().eq('id', id);
}
