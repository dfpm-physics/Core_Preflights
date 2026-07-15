// faculty-roster.js — data layer for the director Roster + Sections page.
// Ported from admin.html's roster & sections tabs. Director-only (enforced in the page).
// Provisioning uses the supabase client's functions.invoke (handles URL + auth) instead of
// the legacy raw fetch, so no SUPABASE_URL global is needed in module scope. No DB changes.

import { db } from './supabase.js';
import { lastFirst } from './util.js';

/** Roster for the current course (students whose section belongs to this course). */
export async function loadRoster(ctx) {
  const [{ data: allStudents }, { data: sections }] = await Promise.all([
    db.from('students').select('student_id, name, section_id, auth_user_id').order('section_id'),
    db.from('sections').select('id').eq('course_id', ctx.currentCourse).order('id'),
  ]);
  const sectionIds = (sections || []).map(s => s.id);
  const set = new Set(sectionIds);
  const students = (allStudents || [])
    .filter(s => set.has(s.section_id))
    .sort((a, b) => a.section_id.localeCompare(b.section_id) || lastFirst(a.name).localeCompare(lastFirst(b.name)));
  const unprovisioned = students.filter(s => !s.auth_user_id).length;
  return { students, sectionIds, total: students.length, unprovisioned };
}

/** Bulk-create auth accounts for students with no auth_user_id (edge function). */
export function provision(ctx) {
  return db.functions.invoke('provision-students', { body: { course_id: ctx.currentCourse } });
}

/** Delete a student and all their dependent rows (scores/responses/extensions first). */
export async function removeStudent(studentId) {
  await db.from('scores').delete().eq('student_id', studentId);
  await db.from('responses').delete().eq('student_id', studentId);
  await db.from('extensions').delete().eq('student_id', studentId);
  return db.from('students').delete().eq('student_id', studentId);
}

export function updateStudentSection(studentId, sectionId) {
  return db.from('students').update({ section_id: sectionId }).eq('student_id', studentId);
}

/** Parse a roster CSV (columns: student_id, name, section). Pure — returns {rows, errors}. */
export function parseRosterCsv(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['The file is empty.'] };
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const idIdx = headers.indexOf('student_id'), nameIdx = headers.indexOf('name'), sectIdx = headers.indexOf('section');
  if (idIdx < 0 || nameIdx < 0 || sectIdx < 0) return { rows: [], errors: ['CSV must have columns: student_id, name, section'] };

  const rows = [], errors = [];
  lines.slice(1).forEach((line, li) => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const sid = parseInt(cols[idIdx]);
    const name = cols[nameIdx];
    const sect = cols[sectIdx]?.toUpperCase();
    if (isNaN(sid) || sid < 3000000000 || sid > 3009999999) errors.push(`Row ${li + 2}: invalid student_id "${cols[idIdx]}"`);
    else if (!/^[MT][135][A-D]$/.test(sect)) errors.push(`Row ${li + 2}: invalid section "${cols[sectIdx]}"`);
    else rows.push({ student_id: sid, name, section_id: sect });
  });
  return { rows, errors };
}

/** Create sections (FK parent) then upsert students. */
export async function commitRoster(ctx, rows) {
  const sections = [...new Set(rows.map(r => r.section_id))];
  const { error: sectErr } = await db.from('sections').upsert(
    sections.map(id => ({ id, course_id: ctx.currentCourse })), { onConflict: 'id', ignoreDuplicates: false });
  if (sectErr) return { error: sectErr };
  return db.from('students').upsert(rows, { onConflict: 'student_id' });
}

/** Sections in the course + all instructors (for the assignment grid). */
export async function loadSections(ctx) {
  const [{ data: sections }, { data: instructors }] = await Promise.all([
    db.from('sections').select('id, instructor_id').eq('course_id', ctx.currentCourse).order('id'),
    db.from('instructors').select('id, name').order('name'),
  ]);
  return { sections: sections || [], instructors: instructors || [] };
}

export function assignInstructor(sectionId, instructorId) {
  return db.from('sections').update({ instructor_id: instructorId || null }).eq('id', sectionId);
}
