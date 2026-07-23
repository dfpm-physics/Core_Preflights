// faculty-admin.js — data layer for faculty/admin.html (Staff · Export), against schema `app`.
//
// BOUNDARY: Roster owns the students *in* an offering. Admin owns the offering itself and the
// people who *run* it. Everything here is scoped to ctx.currentOffering — the global tier
// (creating courses, terms, offerings; granting system admin) lives in system-admin.js, gated
// on is_global_admin rather than on director.
//
// WHAT MOVED FROM LEGACY
//   instructor_course_access  ->  staff_assignments (term-scoped; section_id NULL = offering-wide)
//   sections.instructor_id    ->  the same table, so "add staff" and "assign a section" are now
//                                 one concept rather than two screens
//   instructors.is_director   ->  gone; is_global_admin is the only flag on the person
//   scores                    ->  grades, reached through enrollments
//
// Plan: site/app/PLAN-2026-07-16-ADMIN.md §4. Roles are director | instructor | grader.

import { db } from './supabase.js';
import { lastFirst } from './util.js';
import { gradeAssignmentList } from './faculty-grade.js';

export const ROLE_LABEL = { director: 'Director', instructor: 'Instructor', grader: 'Grader' };

/* ══════════════════════════════════════════════════════════════════════════════
 * Staff
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Everyone with authority over the current offering.
 *
 * Three queries, not a join. Legacy already knew this and said so: a join silently returns null
 * for the joined table when RLS blocks it, which reads as "no name" rather than "no permission"
 * and is impossible to debug from the UI. Querying separately means a blocked read is visible.
 *
 * Global admins are folded in even though they hold no staff_assignments row — they implicitly
 * staff every offering (auth.js resolveFacultyOfferings), so omitting them would show a director
 * a staff list that does not include the people who can actually override them.
 */
export async function loadStaff(ctx) {
  if (!ctx.currentOffering) return { staff: [], sections: [], instructors: [] };

  const [{ data: rows }, { data: admins }, { data: instructors }, { data: sections }] = await Promise.all([
    db.from('staff_assignments')
      .select('id, instructor_id, section_id, role, instructors(id, name)')
      .eq('course_offering_id', ctx.currentOffering),
    db.from('instructors').select('id, name').eq('is_global_admin', true),
    db.from('instructors').select('id, name').order('name'),
    db.from('sections').select('id, code').eq('course_offering_id', ctx.currentOffering).order('code'),
  ]);

  const codeOf = Object.fromEntries((sections || []).map(s => [s.id, s.code]));
  const adminIds = new Set((admins || []).map(a => a.id));

  // Collapse many rows per person into one entry: offering-wide beats section-scoped, and the
  // strongest role wins when someone holds both (a director with a leftover instructor row).
  const byPerson = new Map();
  (rows || []).forEach(r => {
    const cur = byPerson.get(r.instructor_id) || {
      instructorId: r.instructor_id,
      name: r.instructors?.name || '(unknown)',
      role: r.role, wide: false, sections: [], assignmentIds: [],
    };
    cur.assignmentIds.push(r.id);
    if (!r.section_id) cur.wide = true;
    else if (codeOf[r.section_id]) cur.sections.push({ id: r.section_id, code: codeOf[r.section_id] });
    if (r.role === 'director') cur.role = 'director';
    else if (r.role === 'instructor' && cur.role === 'grader') cur.role = 'instructor';
    byPerson.set(r.instructor_id, cur);
  });

  (admins || []).forEach(a => {
    const cur = byPerson.get(a.id);
    if (cur) { cur.sysadmin = true; return; }
    byPerson.set(a.id, {
      instructorId: a.id, name: a.name, role: null, wide: true,
      sections: [], assignmentIds: [], sysadmin: true, implicit: true,
    });
  });

  const staff = [...byPerson.values()].map(s => ({ ...s, sysadmin: !!s.sysadmin || adminIds.has(s.instructorId) }))
    .sort((a, b) => (b.sysadmin - a.sysadmin)
                 || (a.role === 'director' ? -1 : b.role === 'director' ? 1 : 0)
                 || lastFirst(a.name).localeCompare(lastFirst(b.name)));

  return { staff, sections: sections || [], instructors: instructors || [] };
}

/**
 * Add someone to this offering, creating their login if they do not have one.
 *
 * The edge function owns authorization, and it is stricter than the client can be: only a global
 * admin may pass role 'system_admin', which is a real fix over legacy — `site/admin.html` sent
 * the dropdown value straight through with no check, so any course director could mint a system
 * admin. See create-instructor/index.ts.
 */
export function addStaff(ctx, { name, email, password, role }) {
  return db.functions.invoke('create-instructor', {
    body: { name, email, password, role, course_offering_id: ctx.currentOffering },
  });
}

/**
 * Change someone's role for THIS offering — on EVERY row they hold in it.
 *
 * The role lives on each staff_assignments row: the offering-wide one (section_id NULL) AND any
 * section-scoped rows. This used to upsert only the offering-wide row, which left a demoted
 * director's section rows still reading 'director' — and `director_offerings()` (002_rls.sql)
 * grants the director privilege on a director role in ANY row. So the person stayed a director
 * however many times you picked "Instructor": the "once a director, always a director" bug.
 *
 * A person holds ONE role per offering; split-role rows are never intended and are what broke.
 * So: set the role on every existing row, then guarantee the offering-wide row exists (that is how
 * a director is recorded, and a harmless default for an instructor the admin can narrow later with
 * Sections). Director is the per-offering privilege here; system admin is the global one
 * (instructors.is_global_admin) and is deliberately untouched by this.
 *
 * (Self-demotion isn't reachable — admin.html disables the select on your own row — so the RLS
 * corner where a director updates their own last director row away mid-statement never arises.)
 */
export async function setRole(ctx, instructorId, role) {
  const upd = await db.from('staff_assignments')
    .update({ role })
    .eq('instructor_id', instructorId)
    .eq('course_offering_id', ctx.currentOffering);
  if (upd.error) return upd;
  return db.from('staff_assignments').upsert({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: null,
    role,
  }, { onConflict: 'instructor_id,course_offering_id,section_id' });
}

/**
 * Revoke access to THIS offering only.
 *
 * Never deletes the login and never touches another term — someone removed from Fall 2026 may
 * still be directing the same course next spring. Passing the offering (rather than omitting it)
 * is what keeps the edge function from revoking everywhere.
 */
export function removeStaff(ctx, instructorId) {
  return db.functions.invoke('remove-instructor', {
    body: { instructor_id: instructorId, course_offering_id: ctx.currentOffering },
  });
}

/** Replace a person's section-scoped rows with exactly `sectionIds`. */
export async function setStaffSections(ctx, instructorId, role, sectionIds) {
  await db.from('staff_assignments').delete()
    .eq('course_offering_id', ctx.currentOffering)
    .eq('instructor_id', instructorId)
    .not('section_id', 'is', null);
  if (!sectionIds.length) return { error: null };
  return db.from('staff_assignments').insert(sectionIds.map(id => ({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: id,
    role: role || 'instructor',
  })));
}

/* ── One section at a time (P1.10) ───────────────────────────────────────────
 * The Section Coverage grid assigns and unassigns a SINGLE (person, section) pair, because that
 * is what dropping a name on a tile means. setStaffSections() above replaces the whole set, which
 * is right for the tick-box modal and wrong here: a drop that silently rewrote every other section
 * the person holds would be a data-loss bug the operator has no way to see coming.
 *
 * ROLE IS CARRIED, NOT CHOSEN. Every row a person holds in an offering must agree on their role —
 * P0.15 was exactly the bug where they did not, and `director_offerings()` grants the privilege on
 * a director role in ANY row, so a stray 'instructor' row is harmless but a stray 'director' row
 * silently re-promotes. The caller passes the person's existing role and this writes that.
 */

/** Add one person to one section. Idempotent — re-dropping the same name changes nothing. */
export function addStaffSection(ctx, instructorId, role, sectionId) {
  return db.from('staff_assignments').upsert({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: sectionId,
    role: role || 'instructor',
  }, { onConflict: 'instructor_id,course_offering_id,section_id' });
}

/**
 * Remove one person from one section.
 *
 * Their offering-wide row (section_id NULL) is untouched, which matters: a director who also
 * teaches M1A and is dropped from M1A stays a director of the offering. Only the teaching
 * assignment goes.
 */
export function removeStaffSection(ctx, instructorId, sectionId) {
  return db.from('staff_assignments').delete()
    .eq('course_offering_id', ctx.currentOffering)
    .eq('instructor_id', instructorId)
    .eq('section_id', sectionId);
}

/* ── Staff password recovery: removed, not relocated ──────────────────────────
 *
 * `sendResetEmail()` used to live here and called Supabase's public recovery endpoint. It was
 * deleted on 2026-07-21 because PREP has no SMTP: the mail it triggered was never delivered,
 * and the button reported success regardless. It also took the target address as free text
 * typed by the operator, so it would happily send a recovery mail for any address at all.
 *
 * There is deliberately NO replacement here. Students are covered by
 * `reset-student-password` (any staff member of the offering, default password only), because
 * the default is derived from a cadet ID the instructor is already looking at — the reset
 * reveals nothing.
 *
 * That argument does not carry over to instructors. An instructor account has no cadet ID and
 * therefore no derivable default, so any staff reset would mean one person CHOOSING another
 * person's password — and an instructor who knows a colleague's password is indistinguishable,
 * at the database level, from that colleague, including for grade finalization. Until the
 * system-admin-only tier in PLAN-2026-07-20-ACCOUNTS.md §3 (tier D) is built, staff recovery
 * is a Supabase-dashboard action by a system admin. That is a real gap, and it is a smaller one
 * than a button that hands out working credentials for a grader account.
 */

/* ══════════════════════════════════════════════════════════════════════════════
 * Export
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The whole gradebook for an offering, as one addressable matrix.
 *
 * Deliberately the single place that knows grades live in `grades`. Lesson unification moves
 * scoring to per-lesson effort later; when it does, this function changes and the CSV writer
 * below does not. Building the export inline against `grades` would guarantee a rewrite
 * (PLAN-2026-07-16-ADMIN.md T1.3).
 *
 * @returns {{ columns, students, cell(enrollmentId, columnId) }}
 */
export async function gradeMatrix(ctx, sectionIds) {
  const columns = (await gradeAssignmentList(ctx))
    .filter(a => a.is_published)
    .reverse();                       // oldest first reads correctly left-to-right in a gradebook

  if (!sectionIds.length || !columns.length) {
    return { columns, students: [], cell: () => null };
  }

  const { data: enrollments } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', sectionIds).eq('status', 'active');

  const students = (enrollments || []).map(e => ({
    enrollmentId: e.id,
    studentId: e.student_id,
    name: e.students?.name || String(e.student_id),
    sectionId: e.section_id,
  })).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));

  // Finalized only. A student with no finalized grade exports BLANK, never zero — a zero posts
  // to Blackboard as a real score the instructor never gave.
  const { data: grades } = await db.from('grades')
    .select('enrollment_id, assignment_offering_id, points_earned, is_finalized')
    .in('enrollment_id', students.map(s => s.enrollmentId))
    .eq('is_finalized', true);

  const byKey = {};
  (grades || []).forEach(g => { byKey[`${g.enrollment_id}|${g.assignment_offering_id}`] = g.points_earned; });

  return {
    columns, students,
    cell: (enrollmentId, columnId) => byKey[`${enrollmentId}|${columnId}`] ?? null,
  };
}

/** RFC-4180 quoting: wrap every field, double any embedded quote. */
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Blackboard-shaped CSV text from a gradeMatrix(). Pure — takes data, returns a string. */
export function buildGradesCsv(matrix, sectionCodeOf) {
  const head = ['Student ID', 'Last Name', 'First Name', 'Section',
    ...matrix.columns.map(c => `${c.title} [${c.points_possible}]`)];
  const lines = [head.map(csvCell).join(',')];

  matrix.students.forEach(s => {
    const parts = String(s.name).trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : s.name;
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    lines.push([
      s.studentId, last, first, sectionCodeOf(s.sectionId) || '',
      ...matrix.columns.map(c => {
        const v = matrix.cell(s.enrollmentId, c.id);
        return v == null ? '' : v;      // blank, not zero — see gradeMatrix()
      }),
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

/**
 * Full JSON backup of ONE offering.
 *
 * Legacy's version had three defects this does not inherit: it was unscoped by role (any grader
 * could pull the whole dataset), unscoped by course, and it ordered `assignments` by a `due_date`
 * column that no longer exists — so the query would fail if copied as-is. This is director-gated
 * by the page, scoped to the offering, and orders by nothing it does not select.
 */
export async function buildBackup(ctx, sectionIds) {
  const [{ data: offerings }, { data: enrollments }] = await Promise.all([
    db.from('assignment_offerings')
      .select('id, points_possible, grading_mode, opens_at, due_at, is_published, position, assignments!inner(slug, title, description)')
      .eq('course_offering_id', ctx.currentOffering),
    db.from('enrollments')
      .select('id, status, student_id, section_id, students!inner(student_id, name)')
      .in('section_id', sectionIds),
  ]);

  const enrollmentIds = (enrollments || []).map(e => e.id);
  const [{ data: submissions }, { data: grades }] = await Promise.all([
    enrollmentIds.length
      ? db.from('submissions').select('*').in('enrollment_id', enrollmentIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? db.from('grades').select('*').in('enrollment_id', enrollmentIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    exported_at: new Date().toISOString(),
    course_offering_id: ctx.currentOffering,
    course: ctx.courseTitleOf(ctx.currentOffering),
    term: ctx.currentTermLabel || null,
    assignment_offerings: offerings || [],
    enrollments: enrollments || [],
    submissions: submissions || [],
    grades: grades || [],
  };
}

/** Blob → synthetic <a download> → click → revoke. Shared by both exports. */
export function triggerDownload(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** `Core_Preflights_Grades_2026-07-20.csv` — the repo name is load-bearing for Blackboard imports. */
export function exportFilename(kind, ext) {
  return `Core_Preflights_${kind}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}
