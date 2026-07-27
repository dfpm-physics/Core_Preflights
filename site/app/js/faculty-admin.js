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
// Plan: site/app/PLAN-2026-07-16-ADMIN.md §4.

import { db } from './supabase.js';
import { lastFirst } from './util.js';
import { gradeAssignmentList } from './faculty-grade.js';

/* ── Roles: TWO, as of 2026-07-27 ─────────────────────────────────────────────
 * `grader` is withdrawn. It was defined as "grades only, no authoring" and never meant anything:
 * authoring is gated on DIRECTOR everywhere it is gated at all (lessons.html, admin.html, the
 * `*_write` policies in 002_rls.sql all key on director_offerings()), so a grader and an
 * instructor had byte-identical privileges. A third option that changes nothing is a question the
 * director has to answer, wrongly or rightly, every time they add somebody.
 *
 * THE CHECK CONSTRAINT STILL ALLOWS IT — `role IN ('director','instructor','grader')`, and DDL on
 * `app` is sealed (CORE.md §0), so this is a UI withdrawal, not a schema change. Any row that
 * still says 'grader' keeps working and is shown as such (see LEGACY_ROLE_LABEL) rather than being
 * silently relabelled: a row saying one thing while the screen says another is how P0.15 happened.
 */
export const ROLE_LABEL = { director: 'Director', instructor: 'Instructor' };

/** Roles no longer offered, but still renderable when a pre-existing row carries one. */
export const LEGACY_ROLE_LABEL = { grader: 'Grader (retired — change to Instructor)' };

/**
 * A staff account's default password: last name + `1234`.
 *
 * "First word before any hyphen and space" (director, 2026-07-27): the surname is the last
 * whitespace-separated token of the full name, and a compound one is cut at its first hyphen or
 * space — `Jane Smith-Jones` -> `smith1234`.
 *
 * ── WHY A DERIVABLE DEFAULT IS SAFE, WHEN A CHOSEN PASSWORD IS NOT ───────────────────────
 * This module argued until today that staff had no default and therefore no delegated reset,
 * because resetting one would mean a person CHOOSING another person's password — and someone who
 * knows a colleague's password is indistinguishable, at the database level, from that colleague,
 * including for grade finalization. That argument is about CHOOSING, and it still holds: nothing
 * here or in `reset-staff-password` accepts a password parameter.
 *
 * Deriving is different, and it is the same argument that has always licensed the cadet reset: the
 * director learns nothing, because the input is the person's name, which they are already looking
 * at. What makes it hold is the other half — the account is flagged `must_change_password`, so the
 * shared-knowledge default survives exactly one sign-in and every page bounces the user to their
 * account until they replace it (auth.js). Neither half works alone.
 *
 * Duplicated in `create-instructor` and `reset-staff-password`, which are the ENFORCING copies —
 * a Deno edge function and a browser module share no import path. This copy exists so the page can
 * TELL the director what to say to the new instructor; it never travels over the wire.
 */
export function defaultStaffPassword(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : '';
  const stem = surname.split(/[-\s]/)[0].replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  // A name with nothing alphanumeric in its surname would otherwise derive the password "1234".
  return stem ? `${stem}1234` : '';
}

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
    // 'grader' is retired but rows may still carry it; instructor outranks it, as it always did.
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
 * Create a NEW account and add it to this offering.
 *
 * No `password` is sent — and there is no parameter for one as of 2026-07-27. The edge function
 * derives `defaultStaffPassword(name)` itself and flags the account for forced rotation, which is
 * what makes the value safe to know (see that function's header). Before this, the director typed
 * a temporary password into a form field pre-filled with the literal string `prep-temp-2026`: one
 * shared credential across every account anybody accepted the default for, with nothing forcing a
 * change afterwards.
 *
 * The edge function owns authorization, and it is stricter than the client can be: only a global
 * admin may pass role 'system_admin', which is a real fix over legacy — `site/admin.html` sent
 * the dropdown value straight through with no check, so any course director could mint a system
 * admin. See create-instructor/index.ts.
 */
export function addStaff(ctx, { name, email, role }) {
  return db.functions.invoke('create-instructor', {
    body: { name, email, role, course_offering_id: ctx.currentOffering },
  });
}

/**
 * Add somebody who ALREADY has a PREP login to this offering.
 *
 * The common case at the start of a term and, until 2026-07-27, the one the page could not do:
 * "+ Add staff" only ever created accounts, so adding a colleague who already teaches the other
 * course meant creating a second login for the same person under a second address. That is not a
 * cosmetic duplicate — grades, extensions and unlocks are attributed to `instructors.id`, so their
 * history would split across two identities with no way to rejoin it.
 *
 * No edge function: this writes one `staff_assignments` row, and `staff_write` (002_rls.sql)
 * already admits exactly the caller who may do it — a director of this offering. Nothing about the
 * PERSON changes, which is the point.
 *
 * Offering-wide (`section_id NULL`), matching what create-instructor writes by default. Which
 * sections they actually teach is the Section Coverage grid below the table.
 */
export function addExistingStaff(ctx, instructorId, role) {
  return db.from('staff_assignments').upsert({
    instructor_id: instructorId,
    course_offering_id: ctx.currentOffering,
    section_id: null,
    role: role || 'instructor',
  }, { onConflict: 'instructor_id,course_offering_id,section_id' });
}

/**
 * Put one staff member back on the default password (last name + 1234) and force a rotation.
 *
 * The student equivalent with the same shape and the same constraint: no password parameter
 * exists, so the caller cannot choose a credential and then sign in as a colleague. See
 * `defaultStaffPassword()` for why deriving is safe where choosing is not, and
 * supabase/functions/reset-staff-password/index.ts for the authorization.
 */
export function resetStaffPassword(ctx, instructorId) {
  return db.functions.invoke('reset-staff-password', {
    body: { course_offering_id: ctx.currentOffering, instructor_id: instructorId },
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

/* ── Staff password recovery: the history, because the reasoning changed twice ─
 *
 * `sendResetEmail()` lived here and called Supabase's public recovery endpoint. Deleted
 * 2026-07-21: PREP has no SMTP, so the mail was never delivered and the button reported success
 * regardless. It also took the target address as free text, so it would happily "send" a recovery
 * mail for any address at all.
 *
 * It was then left with NO replacement, on this argument: an instructor account has no cadet ID
 * and therefore no derivable default, so any staff reset would mean one person CHOOSING another
 * person's password — and whoever knows a colleague's password is indistinguishable, at the
 * database level, from that colleague, including for grade finalization. Staff recovery was a
 * Supabase-dashboard action by a system admin.
 *
 * `resetStaffPassword()` above replaces it (2026-07-27), and note WHAT changed: not the argument,
 * its premise. Staff now DO have a derivable default — `defaultStaffPassword()`, from the name the
 * director is already looking at — so the reset can restore one without anybody choosing anything.
 * The prohibition on choosing is intact and enforced by the absence of a parameter, in both the
 * client and the edge function. The unbuilt "set an arbitrary password" tier
 * (PLAN-2026-07-20-ACCOUNTS.md §3, tier D) is still unbuilt and still a system-admin action.
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
