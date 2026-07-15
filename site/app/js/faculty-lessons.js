// faculty-lessons.js — data layer for the faculty Lesson creation/management tool.
//
// A *lesson* (migration 016) groups at most one written preflight (an assignments row)
// and at most one Claude-artifact interaction (an interactions row) under one slug, with a
// completion_policy (preflight | interaction | choice), a shared objective taxonomy, and
// M/T due dates. This tool authors BOTH component types inline (new-content-only: there is
// no "attach an existing standalone assignment" path), then writes the lesson that points
// at them. Directors manage; instructors get a read-only published view.
//
// Scope note: this is the authoring tool only. The student Save/Submit lifecycle, the
// completion-creating triggers, and the merged rollup are later phases of LESSON-UNIFICATION.

import { db } from './supabase.js';

const LESSON_COLS =
  'id, course_id, title, description, lesson_number, preflight_id, interaction_id, ' +
  'completion_policy, objectives, points, due_date_m, due_date_t, is_published';

// The preflight assignment a lesson owns is keyed off the lesson slug — there is no external
// contract on an assignments.id, so the director never manages a second id. (The interaction
// id, by contrast, is the artifact's `#i=` slug and is typed explicitly.)
export const preflightIdFor = (lessonSlug) => lessonSlug;

/**
 * @returns {{ noCourse?, lessons:[{...lesson, preflight, interaction}] }}
 *   Directors see all lessons (incl. drafts); instructors see only published ones.
 *   Each lesson is hydrated with its preflight assignment (incl. `questions`) and its
 *   interaction row so the editor can repopulate the inline builders.
 */
export async function loadManager(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true, lessons: [] };
  const isDirector = ctx.isDirectorForCurrent();

  let q = db.from('lessons').select(LESSON_COLS).eq('course_id', course)
    .order('lesson_number', { nullsFirst: false }).order('title');
  if (!isDirector) q = q.eq('is_published', true);
  const { data: lessonRows } = await q;
  const lessons = lessonRows || [];

  const preflightIds   = [...new Set(lessons.map(l => l.preflight_id).filter(Boolean))];
  const interactionIds = [...new Set(lessons.map(l => l.interaction_id).filter(Boolean))];

  const [{ data: asgnRows }, { data: interRows }] = await Promise.all([
    preflightIds.length
      ? db.from('assignments').select('id, title, description, questions, is_published').in('id', preflightIds)
      : Promise.resolve({ data: [] }),
    interactionIds.length
      ? db.from('interactions').select('id, title, description, artifact_url, is_published').in('id', interactionIds)
      : Promise.resolve({ data: [] }),
  ]);
  const asgnById  = Object.fromEntries((asgnRows  || []).map(a => [a.id, a]));
  const interById = Object.fromEntries((interRows || []).map(i => [i.id, i]));

  const items = lessons.map(l => ({
    ...l,
    objectives: Array.isArray(l.objectives) ? l.objectives : [],
    preflight:   l.preflight_id   ? (asgnById[l.preflight_id]   || null) : null,
    interaction: l.interaction_id ? (interById[l.interaction_id] || null) : null,
  }));

  return { noCourse: false, lessons: items };
}

/**
 * Create (editingId null) or update a lesson and its inline-authored components.
 * Order matters: components are upserted first so the lesson's FKs resolve.
 *
 * model = {
 *   id, course_id, title, description, lesson_number,
 *   completion_policy, objectives:[{key,label}], due_date_m, due_date_t, is_published,
 *   preflight:    { enabled, questions:[…] } | null,
 *   interaction:  { enabled, id, title, artifact_url, description } | null,
 * }
 * @returns {{ error: object|null }} the first error encountered, or null on success.
 */
export async function saveLesson(model, editingId) {
  const { id, course_id, is_published } = model;
  let preflight_id = null, interaction_id = null;

  // 1) Preflight component → an assignments row keyed off the lesson slug.
  if (model.preflight?.enabled) {
    const asgnId = preflightIdFor(id);
    // assignments.due_date is NOT NULL — mirror admin.html and seed it from the lesson dates.
    const seed = model.due_date_m || model.due_date_t || new Date().toISOString();
    const { error } = await db.from('assignments').upsert({
      id: asgnId,
      course_id,
      title: model.title,
      description: model.description,
      questions: model.preflight.questions || [],
      due_date:   seed,
      due_date_m: model.due_date_m,
      due_date_t: model.due_date_t,
      is_published,
    }, { onConflict: 'id' });
    if (error) return { error };
    preflight_id = asgnId;
  }

  // 2) Interaction component → an interactions row keyed by its artifact `#i=` slug.
  if (model.interaction?.enabled) {
    const { error } = await db.from('interactions').upsert({
      id: model.interaction.id,
      course_id,
      title: model.interaction.title || model.title,
      description: model.interaction.description,
      artifact_url: model.interaction.artifact_url,
      is_published,
    }, { onConflict: 'id' });
    if (error) return { error };
    interaction_id = model.interaction.id;
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

/** Toggle a lesson's published flag and mirror it onto its built components so a published
 *  lesson's parts are visible (and an unpublished lesson's parts are hidden). */
export async function togglePublish(lesson) {
  const next = !lesson.is_published;
  const { error } = await db.from('lessons').update({ is_published: next }).eq('id', lesson.id);
  if (error) return { error };
  if (lesson.preflight_id)
    await db.from('assignments').update({ is_published: next }).eq('id', lesson.preflight_id);
  if (lesson.interaction_id)
    await db.from('interactions').update({ is_published: next }).eq('id', lesson.interaction_id);
  return { error: null };
}

/** Delete the lesson row only. Its component assignment/interaction rows are left intact
 *  (the FK is ON DELETE SET NULL); deleting student work is never implicit here. */
export function deleteLesson(id) {
  return db.from('lessons').delete().eq('id', id);
}
