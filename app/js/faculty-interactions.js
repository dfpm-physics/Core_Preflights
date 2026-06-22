// faculty-interactions.js — data layer for the native in-app interaction manager.
// Ported from interactions-admin.html: list (incl. drafts for directors), submission
// counts, per-section completion, section rosters for the report viewer, and CRUD.
// Directors manage; instructors get a read-only published view (scoped to their sections).

import { db } from './supabase.js';

/**
 * @returns {{ noCourse?, interactions:[{...it, count, perSection, done, total}], sections:[{id,students}] }}
 *   Directors see all interactions (incl. drafts) across all course sections; instructors
 *   see only published interactions and only their own sections.
 */
export async function loadManager(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true, interactions: [], sections: [] };
  const isDirector = ctx.isDirectorForCurrent();

  let secQuery = db.from('sections').select('id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', ctx.instructorRow.id);

  let interQuery = db.from('interactions')
    .select('id, course_id, title, description, artifact_url, is_published')
    .eq('course_id', course).order('title');
  if (!isDirector) interQuery = interQuery.eq('is_published', true);

  const [{ data: sectionRows }, { data: interRaw }] = await Promise.all([secQuery, interQuery]);
  const sectionIds = (sectionRows || []).map(s => s.id);
  const interactions = interRaw || [];

  const { data: studentsRaw } = sectionIds.length
    ? await db.from('students').select('student_id, name, section_id').in('section_id', sectionIds).order('name')
    : { data: [] };
  const students = studentsRaw || [];
  const studentIds = students.map(s => s.student_id);
  const sectionOf = Object.fromEntries(students.map(s => [s.student_id, s.section_id]));

  const { data: reports } = studentIds.length
    ? await db.from('preflight_interaction_reports').select('student_id, interaction_id').in('student_id', studentIds)
    : { data: [] };

  const countByInter = {}, doneKey = {}, doneStudentsByInter = {};
  (reports || []).forEach(r => {
    countByInter[r.interaction_id] = (countByInter[r.interaction_id] || 0) + 1;
    (doneStudentsByInter[r.interaction_id] ||= new Set()).add(r.student_id);
    const sec = sectionOf[r.student_id];
    if (sec) doneKey[`${r.interaction_id}|${sec}`] = (doneKey[`${r.interaction_id}|${sec}`] || 0) + 1;
  });

  const sectionSize = {};
  sectionIds.forEach(id => sectionSize[id] = 0);
  students.forEach(s => { if (sectionSize[s.section_id] != null) sectionSize[s.section_id]++; });

  const items = interactions.map(it => {
    let done = 0, total = 0;
    const perSection = sectionIds.map(secId => {
      const d = doneKey[`${it.id}|${secId}`] || 0, n = sectionSize[secId] || 0;
      done += d; total += n;
      return { sectionId: secId, done: d, total: n };
    });
    return { ...it, count: countByInter[it.id] || 0, perSection, done, total,
      doneStudentIds: [...(doneStudentsByInter[it.id] || [])] };
  });

  const sections = sectionIds.map(id => ({
    id, students: students.filter(s => s.section_id === id).map(s => ({ student_id: s.student_id, name: s.name })),
  }));

  return { noCourse: false, interactions: items, sections };
}

/** Insert (when editingId is null) or update an interaction. */
export function saveInteraction(fields, editingId) {
  const { id, course_id, title, description, artifact_url, is_published } = fields;
  return editingId
    ? db.from('interactions').update({ course_id, title, description, artifact_url, is_published }).eq('id', editingId)
    : db.from('interactions').insert({ id, course_id, title, description, artifact_url, is_published });
}

export function togglePublish(id, current) {
  return db.from('interactions').update({ is_published: !current }).eq('id', id);
}

/** Deletes the interaction (and, by FK cascade, its student reports). */
export function deleteInteraction(id) {
  return db.from('interactions').delete().eq('id', id);
}

/** One student's report markdown for an interaction (rendered/sanitized by the caller). */
export async function loadReport(interactionId, studentId) {
  const { data } = await db.from('preflight_interaction_reports')
    .select('report_markdown').eq('interaction_id', interactionId).eq('student_id', studentId).maybeSingle();
  return data?.report_markdown || null;
}
