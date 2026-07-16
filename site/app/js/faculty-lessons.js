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
      .select('id, title, description, questions, is_published, due_date_m, due_date_t, reference_pdf, reference_pages, reading_link')
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

  // Due dates flow from the lesson onto every component so they all share one deadline. Interactions
  // use M/T only (migration 020); assignments additionally keep the legacy NOT-NULL `due_date`.
  const lessonM = model.due_date_m || null, lessonT = model.due_date_t || null;
  const hasDates = !!(lessonM || lessonT);
  const interactionDates = hasDates ? { due_date_m: lessonM, due_date_t: lessonT } : {};
  const assignmentDates  = hasDates
    ? { due_date_m: lessonM, due_date_t: lessonT, due_date: lessonM || lessonT }
    : {};

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
      reference_pdf:   pf.reference_pdf   || null,   // grading RAG grounding for /preflight-analyze
      reference_pages: pf.reference_pages || null,
      reading_link:    pf.reading_link    || null,   // reading link shown to students
      is_published,
    }, { onConflict: 'id' });
    if (error) return { error };
    preflight_id = asgnId;
  } else if (pf.source === 'existing') {
    if (!pf.existingId) return { error: { message: 'Select an existing preflight assignment.' } };
    preflight_id = pf.existingId;
    // Attached existing preflights are EDITABLE: write the revised questions + reference fields back
    // onto that same assignment, preserving its own title / publish state / due dates (a plain
    // UPDATE touches only these columns). Skip if no questions were loaded (avoids wiping the row).
    const upd = { ...assignmentDates };                // sync the shared due dates onto the assignment
    if (Array.isArray(pf.questions) && pf.questions.length) {
      upd.questions       = pf.questions;
      upd.reference_pdf   = pf.reference_pdf   ?? null;
      upd.reference_pages = pf.reference_pages ?? null;
      upd.reading_link    = pf.reading_link    ?? null;
    }
    if (Object.keys(upd).length) {
      const { error } = await db.from('assignments').update(upd).eq('id', pf.existingId);
      if (error) return { error };
    }
  }

  // 2) Interaction component (M/T due dates only — migration 020).
  if (it.source === 'new') {
    const { error } = await db.from('interactions').upsert({
      id: it.id,
      course_id,
      title: it.title || model.title,
      description: it.description,
      artifact_url: it.artifact_url,
      is_published,
      ...interactionDates,
    }, { onConflict: 'id' });
    if (error) return { error };
    interaction_id = it.id;
  } else if (it.source === 'existing') {
    if (!it.existingId) return { error: { message: 'Select an existing interaction.' } };
    interaction_id = it.existingId;
    // Attached existing interactions are EDITABLE: update title/url/description + the shared due
    // dates on that same row, preserving its id (the artifact `#i=` slug), course, and publish
    // state. title is NOT NULL, so only overwrite it when a non-empty value is provided.
    const upd = { ...interactionDates };
    if (it.title && it.title.trim()) upd.title = it.title.trim();
    if (it.artifact_url !== undefined) upd.artifact_url = it.artifact_url || null;
    if (it.description !== undefined) upd.description = it.description || null;
    if (Object.keys(upd).length) {
      const { error } = await db.from('interactions').update(upd).eq('id', it.existingId);
      if (error) return { error };
    }
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

/** Delete the lesson CONTAINER only. Its component assignment/interaction rows are left intact
 *  (the FK is ON DELETE SET NULL), so they become reusable orphans; the lesson's own children
 *  (lesson_chat_inputs, lesson_completions) cascade away. Deleting student work is never implicit. */
export function deleteLesson(id) {
  return db.from('lessons').delete().eq('id', id);
}

/** Upload a figure image to the PUBLIC `lesson-figures` Storage bucket and return its public URL.
 *  Static-site friendly: the browser posts straight to Supabase Storage (never to GitHub Pages),
 *  and figure_url then stores the returned public URL. Requires the bucket + faculty-insert policy
 *  from migration 019. Returns { url } on success or { error }. */
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

/** Fetch an existing assignment's editable content (title, questions, reference fields) so the
 *  lesson editor can load it into the builder (attached existing preflights are editable) and the
 *  student-view Preview can render it. The picker list omits the heavy questions blob. */
export async function getAssignment(id) {
  const { data } = await db.from('assignments')
    .select('title, questions, reference_pdf, reference_pages, reading_link, due_date_m, due_date_t')
    .eq('id', id).maybeSingle();
  return data || null;
}

/** Fetch an existing interaction's editable fields so the lesson editor can load and revise it
 *  (attached existing interactions are editable, like preflights). Tolerates a pre-migration-020
 *  schema (no due_date_m/t columns) by falling back to the legacy single due_date. */
export async function getInteraction(id) {
  const { data } = await db.from('interactions')
    .select('title, artifact_url, description, due_date_m, due_date_t')
    .eq('id', id).maybeSingle();
  return data || null;
}

/** Count the student reports attached to ONE interaction. Used before swapping a lesson's
 *  interaction: reports are keyed by `interaction_id`, so they follow the OLD interaction when it
 *  is displaced and stop being reachable from the lesson. The director should see that number
 *  before saving, not discover it afterward. */
export async function countInteractionReports(interactionId) {
  if (!interactionId) return 0;
  const { count } = await db.from('preflight_interaction_reports')
    .select('*', { count: 'exact', head: true }).eq('interaction_id', interactionId);
  return count || 0;
}

/** Count the student work that a "delete all contents" would destroy, so the confirm dialog can
 *  state it exactly: preflight responses (assignment → responses CASCADE) + interaction reports
 *  (interaction → preflight_interaction_reports CASCADE). */
export async function countLessonWork(lesson) {
  let responses = 0, reports = 0;
  if (lesson.preflight_id) {
    const { count } = await db.from('responses')
      .select('*', { count: 'exact', head: true }).eq('assignment_id', lesson.preflight_id);
    responses = count || 0;
  }
  if (lesson.interaction_id) {
    const { count } = await db.from('preflight_interaction_reports')
      .select('*', { count: 'exact', head: true }).eq('interaction_id', lesson.interaction_id);
    reports = count || 0;
  }
  return { responses, reports };
}

/** Delete the lesson AND its attached component rows (the nuclear "delete all contents").
 *  Deleting the assignment CASCADEs its responses/scores/extensions; deleting the interaction
 *  CASCADEs its reports/analysis. Gated in the UI behind a 5-second hold. Order: the lesson first
 *  (its SET NULL FKs release), then each component. Stops and returns the first error. */
export async function deleteLessonAndContents(lesson) {
  let { error } = await db.from('lessons').delete().eq('id', lesson.id);
  if (error) return { error };
  if (lesson.preflight_id) {
    ({ error } = await db.from('assignments').delete().eq('id', lesson.preflight_id));
    if (error) return { error };
  }
  if (lesson.interaction_id) {
    ({ error } = await db.from('interactions').delete().eq('id', lesson.interaction_id));
    if (error) return { error };
  }
  return { error: null };
}
