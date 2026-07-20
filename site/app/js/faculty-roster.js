// faculty-roster.js — data layer for the director Roster + Sections page, against schema `app`.
//
// WHAT MOVED
//   students.section_id          ->  enrollments(student_id, section_id, status)
//   sections.instructor_id       ->  staff_assignments(instructor_id, course_offering_id,
//                                                      section_id, role)
//   sections.id 'M1A' (global)   ->  sections.id uuid + sections.code, unique PER OFFERING
//
// The last one is why nothing here keys on a section code any more: 'M1A' is no longer
// unique across the database — two courses may each have one, and next term reuses it. A
// section is identified by its uuid, and the code is a label scoped to the offering.
//
// The old `^[MT][135][A-D]$` CSV validation is also gone. That regex hardcoded the meeting
// pattern of exactly two courses; 001_core_model.sql dropped the matching CHECK for the same
// reason. Import now validates against the sections that actually exist in the offering,
// which is both more permissive and more correct — a typo'd section is caught by name
// instead of by shape.

import { db } from './supabase.js';
import { lastFirst } from './util.js';

/** Sections of the current offering, keyed both ways for import and display. */
export async function loadOfferingSections(ctx) {
  if (!ctx.currentOffering) return { sections: [], byCode: {}, byId: {} };
  const { data } = await db.from('sections')
    .select('id, code, meeting_days, period')
    .eq('course_offering_id', ctx.currentOffering).order('code');
  const sections = data || [];
  return {
    sections,
    byCode: Object.fromEntries(sections.map(s => [s.code.toUpperCase(), s])),
    byId: Object.fromEntries(sections.map(s => [s.id, s])),
  };
}

/**
 * Roster for the current offering: every active enrolment, with the person behind it.
 *
 * Reads through `enrollments` rather than `students` on purpose. The legacy version fetched
 * the WHOLE students table unfiltered and narrowed it in JS, which only ever worked because
 * the old policy made the roster world-readable. Here the enrolment is both the correct
 * join path and the thing RLS scopes.
 */
export async function loadRoster(ctx) {
  if (!ctx.currentOffering) return { students: [], sections: [], total: 0, unprovisioned: 0 };
  const { sections, byId } = await loadOfferingSections(ctx);
  const sectionIds = sections.map(s => s.id);
  if (!sectionIds.length) return { students: [], sections, total: 0, unprovisioned: 0 };

  const { data } = await db.from('enrollments')
    .select('id, status, student_id, section_id, students!inner(student_id, name, auth_user_id)')
    .in('section_id', sectionIds);

  const students = (data || [])
    .map(e => ({
      enrollment_id: e.id,
      status: e.status,
      student_id: e.student_id,
      name: e.students?.name || String(e.student_id),
      auth_user_id: e.students?.auth_user_id || null,
      section_id: e.section_id,
      section_code: byId[e.section_id]?.code || '—',
    }))
    .sort((a, b) => a.section_code.localeCompare(b.section_code)
                 || lastFirst(a.name).localeCompare(lastFirst(b.name)));

  return {
    students, sections,
    total: students.length,
    unprovisioned: students.filter(s => !s.auth_user_id).length,
  };
}

/**
 * Bulk-create auth accounts for enrolled students with no auth_user_id.
 * Scoped by OFFERING: provisioning is a per-term action, and the same person may be enrolled
 * in another course that a different director is responsible for.
 */
export function provision(ctx) {
  return db.functions.invoke('provision-students', {
    body: { course_offering_id: ctx.currentOffering },
  });
}

/**
 * Remove a student from THIS offering.
 *
 * Deletes the enrolment, not the person: `students` is the human, independent of any course,
 * and someone may legitimately be enrolled elsewhere. The cascade from enrollments removes
 * their submissions and grades for this offering only — which is destructive, so the page
 * confirms first. Prefer dropStudent() when the intent is "they withdrew".
 */
export function removeEnrollment(enrollmentId) {
  return db.from('enrollments').delete().eq('id', enrollmentId);
}

/** The non-destructive alternative: mark them dropped and keep the history. */
export function dropStudent(enrollmentId) {
  return db.from('enrollments')
    .update({ status: 'dropped', dropped_at: new Date().toISOString() })
    .eq('id', enrollmentId);
}

/**
 * Move a student to a different section within the same offering.
 * Their work moves with them, because it hangs off this enrolment row.
 */
export function updateStudentSection(enrollmentId, sectionId) {
  return db.from('enrollments').update({ section_id: sectionId }).eq('id', enrollmentId);
}

/**
 * Parse a roster CSV (columns: student_id, name, section). Pure — returns {rows, errors}.
 * `knownSections` maps an upper-cased section code to its row; pass the offering's sections
 * so an unknown code is reported by name.
 */
export function parseRosterCsv(text, knownSections = null) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['The file is empty.'] };
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const idIdx = headers.indexOf('student_id'), nameIdx = headers.indexOf('name'), sectIdx = headers.indexOf('section');
  if (idIdx < 0 || nameIdx < 0 || sectIdx < 0) {
    return { rows: [], errors: ['CSV must have columns: student_id, name, section'] };
  }

  const rows = [], errors = [];
  lines.slice(1).forEach((line, li) => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const sid = parseInt(cols[idIdx], 10);
    const name = cols[nameIdx];
    const code = (cols[sectIdx] || '').toUpperCase();
    const row = li + 2;

    // Mirrors the students_cadet_id_range CHECK, so a bad id is caught before the round trip.
    if (isNaN(sid) || sid < 3000000000 || sid > 3009999999) {
      errors.push(`Row ${row}: invalid student_id "${cols[idIdx]}"`);
    } else if (!name) {
      errors.push(`Row ${row}: missing name`);
    } else if (!code) {
      errors.push(`Row ${row}: missing section`);
    } else if (knownSections && !knownSections[code]) {
      errors.push(`Row ${row}: section "${cols[sectIdx]}" does not exist in this course — ` +
                  `create it first, or fix the spelling. Known: ${Object.keys(knownSections).join(', ') || 'none'}`);
    } else {
      rows.push({ student_id: sid, name, section_code: code });
    }
  });
  return { rows, errors };
}

/**
 * Commit an imported roster: upsert the people, then their enrolments.
 *
 * Two steps because they are two different things now. `students` is the person and may
 * already exist from another course or an earlier term — upserting by student_id updates the
 * name without disturbing auth_user_id. `enrollments` places them in a section of THIS
 * offering; ON CONFLICT DO NOTHING makes a re-import idempotent instead of resurrecting a
 * dropped enrolment or duplicating work.
 */
export async function commitRoster(ctx, rows) {
  const { byCode } = await loadOfferingSections(ctx);
  const unknown = [...new Set(rows.map(r => r.section_code).filter(c => !byCode[c]))];
  if (unknown.length) {
    return { error: { message: `Unknown section(s) for this course: ${unknown.join(', ')}` } };
  }

  const people = [...new Map(rows.map(r => [r.student_id, { student_id: r.student_id, name: r.name }])).values()];
  const { error: sErr } = await db.from('students').upsert(people, { onConflict: 'student_id' });
  if (sErr) return { error: sErr };

  const enrolments = rows.map(r => ({
    student_id: r.student_id,
    section_id: byCode[r.section_code].id,
    status: 'active',
  }));
  return db.from('enrollments').upsert(enrolments, {
    onConflict: 'student_id,section_id', ignoreDuplicates: true,
  });
}

/** Create a section in the current offering. */
export function createSection(ctx, code, meetingDays = [], period = null) {
  return db.from('sections').insert({
    course_offering_id: ctx.currentOffering,
    code: code.toUpperCase(),
    meeting_days: meetingDays,
    period,
  });
}

/* ── Staffing ────────────────────────────────────────────────────────────────
 * `sections.instructor_id` is gone. Who teaches what is a staff_assignments row scoped to
 * the offering, which is what makes "director of Physics 215 in Fall 2026" expressible
 * without also meaning "director of it forever".
 */

/** Sections of the offering plus who is assigned to each, and every instructor for the picker. */
export async function loadSections(ctx) {
  const { sections } = await loadOfferingSections(ctx);
  const [{ data: staff }, { data: instructors }] = await Promise.all([
    db.from('staff_assignments')
      .select('id, instructor_id, section_id, role, instructors(id, name)')
      .eq('course_offering_id', ctx.currentOffering),
    db.from('instructors').select('id, name').order('name'),
  ]);

  const bySection = {};
  (staff || []).filter(s => s.section_id).forEach(s => {
    (bySection[s.section_id] ||= []).push({
      assignmentId: s.id, instructorId: s.instructor_id,
      name: s.instructors?.name || '—', role: s.role,
    });
  });
  // A staff row with no section covers the whole offering — that is how a director is
  // recorded, and the page shows them separately rather than against every section.
  const offeringWide = (staff || []).filter(s => !s.section_id).map(s => ({
    assignmentId: s.id, instructorId: s.instructor_id,
    name: s.instructors?.name || '—', role: s.role,
  }));

  return { sections, bySection, offeringWide, instructors: instructors || [] };
}

/** Assign an instructor to one section (replacing whoever held that section-level slot). */
export async function assignInstructor(ctx, sectionId, instructorId) {
  await db.from('staff_assignments').delete()
    .eq('course_offering_id', ctx.currentOffering)
    .eq('section_id', sectionId).eq('role', 'instructor');
  if (!instructorId) return { data: null, error: null };
  return db.from('staff_assignments').insert({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: sectionId,
    role: 'instructor',
  });
}

/** Grant or revoke an offering-wide role (director / instructor / grader). */
export function setOfferingRole(ctx, instructorId, role) {
  if (!role) {
    return db.from('staff_assignments').delete()
      .eq('course_offering_id', ctx.currentOffering)
      .eq('instructor_id', instructorId).is('section_id', null);
  }
  return db.from('staff_assignments').upsert({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: null,
    role,
  }, { onConflict: 'instructor_id,course_offering_id,section_id' });
}
