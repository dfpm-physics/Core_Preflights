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
// Pure, DOM-free, and therefore testable without a browser shim — same reason the
// parsing rules live there rather than here.
import { sectionDefaultsFrom } from './roster-import.js';
export { sectionDefaultsFrom };
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
 * Roster for the current offering: every active enrollment, with the person behind it.
 *
 * Reads through `enrollments` rather than `students` on purpose. The legacy version fetched
 * the WHOLE students table unfiltered and narrowed it in JS, which only ever worked because
 * the old policy made the roster world-readable. Here the enrollment is both the correct
 * join path and the thing RLS scopes.
 *
 * @param {object} ctx
 * @param {string[]} [scope]  narrow to these sections. Roster passes ctx.sectionIds so an
 *   instructor's page asks only for their own sections rather than asking for the whole offering
 *   and letting RLS silently drop most of the answer. Enrollment omits it — a director is looking
 *   at the offering. The argument narrows the query; it does not secure it.
 */
export async function loadRoster(ctx, scope = null) {
  if (!ctx.currentOffering) return { students: [], sections: [], total: 0, unprovisioned: 0 };
  const { sections, byId } = await loadOfferingSections(ctx);
  const inScope = scope?.length ? new Set(scope.map(String)) : null;
  const sectionIds = sections.map(s => s.id).filter(id => !inScope || inScope.has(String(id)));
  if (!sectionIds.length) return { students: [], sections, total: 0, unprovisioned: 0 };

  const { data } = await db.from('enrollments')
    .select('id, status, student_id, section_id, ' +
            'students!inner(student_id, name, email, squadron, auth_user_id)')
    .in('section_id', sectionIds);

  const students = (data || [])
    .map(e => ({
      enrollment_id: e.id,
      status: e.status,
      student_id: e.student_id,
      name: e.students?.name || String(e.student_id),
      email: e.students?.email || null,
      squadron: e.students?.squadron || null,
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
 * Deletes the enrollment, not the person: `students` is the human, independent of any course,
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
 * Their work moves with them, because it hangs off this enrollment row.
 */
export function updateStudentSection(enrollmentId, sectionId) {
  return db.from('enrollments').update({ section_id: sectionId }).eq('id', enrollmentId);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Adding one cadet at a time (faculty beta, 2026-07-27)
 * ════════════════════════════════════════════════════════════════════════════
 * The roster import is the right tool for a registrar export and the wrong one for the cadet who
 * transfers in during week three. Until now that cadet meant either hand-editing a CSV or asking
 * for a fresh export, so in practice it meant they were missing from PREP.
 *
 * ── DOES ADDING SOMEBODY WHO ALREADY EXISTS CREATE A SECOND RECORD? NO. ────────────────────
 * `students` is keyed on the CADET ID (`student_id bigint PRIMARY KEY`, 001_core_model.sql) — the
 * person, independent of any course — and `enrollments` is what attaches them to a section. So a
 * cadet taking both Physics 110 and Physics 215 is ONE students row with TWO enrollments, and
 * everything per-student (submissions, grades, extensions) hangs off the enrollment, which is what
 * keeps the two courses' work from colliding. Adding an existing cadet to a second course MERGES:
 * it enrolls the record that is already there and leaves the person untouched.
 *
 * That is not a new property of this function — `commitRoster()` has always upserted people on
 * `student_id` with `ignoreDuplicates` for the same reason. It is stated here because this is the
 * screen where somebody will wonder.
 */

/**
 * Find cadets by name or cadet ID, for the "add someone who is already in PREP" picker.
 *
 * WHAT THIS CAN AND CANNOT SEE, because the limit is load-bearing and invisible from the UI:
 * `students_read_staff` (002_rls.sql) exposes a student only through an enrollment in a section
 * the caller staffs. So this returns cadets from the caller's OTHER offerings — the case the
 * picker exists for, a director who runs both courses — and returns nothing for a cadet who has
 * only ever taken somebody else's class. That cadet is not unreachable: typing their cadet ID into
 * the new-student fields still merges onto their existing record, because the upsert below keys on
 * a primary key RLS does not hide.
 *
 * @param {string} query  a name fragment or a (partial) cadet ID
 * @param {number} [limit]
 */
export async function searchStudents(query, limit = 20) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  // Numeric input is matched as an id PREFIX rather than by equality: a director types the first
  // few digits off a form, and 3000990009 is not a number anyone recalls in full.
  const filter = /^\d+$/.test(q)
    ? `student_id::text.like.${q}%`
    : `name.ilike.%${q}%`;
  const { data } = await db.from('students')
    .select('student_id, name, email, squadron')
    .or(filter)
    .order('name')
    .limit(limit);
  return data || [];
}

/**
 * Enroll one cadet in one section of the current offering, creating the person if they are new.
 *
 * Two writes, in this order, and neither is a blind overwrite:
 *
 *   1. The PERSON. `ignoreDuplicates` on the `student_id` primary key, so an existing record is
 *      left exactly as it is — this screen enrolls people, it does not edit them, and quietly
 *      rewriting a name or an address the operator was never shown is what the import's whole
 *      review step exists to prevent. Editing a record is the roster import's job.
 *   2. The ENROLLMENT. Also idempotent (`student_id,section_id` is UNIQUE), so re-adding somebody
 *      who is already in that section reports success rather than an error about a duplicate key.
 *
 * @returns {{ error, created }} `created` = a new person was written, vs. an existing one enrolled
 */
export async function addStudentToOffering(ctx, { student_id, name, email, squadron, section_id }) {
  const sid = Number(student_id);
  if (!Number.isInteger(sid)) return { error: { message: 'Cadet ID must be a number.' } };
  // Mirrors students_cadet_id_range so the operator gets a sentence instead of a constraint name.
  if (sid < 3000000000 || sid > 3009999999) {
    return { error: { message: 'That is not a cadet ID — it must be a 10-digit number starting 300.' } };
  }
  if (!section_id) return { error: { message: 'Choose a section.' } };

  const { data: person, error: pErr } = await db.from('students')
    .upsert([{ student_id: sid, name: String(name || '').trim() || String(sid),
               email: (email || '').trim() || null, squadron: (squadron || '').trim() || null }],
            { onConflict: 'student_id', ignoreDuplicates: true })
    .select('student_id');
  if (pErr) return { error: pErr };

  const { error: eErr } = await db.from('enrollments').upsert(
    [{ student_id: sid, section_id, status: 'active' }],
    { onConflict: 'student_id,section_id', ignoreDuplicates: true });
  if (eErr) return { error: eErr };

  // Empty `person` means ON CONFLICT DO NOTHING fired: the cadet already existed, here or in a
  // course this director cannot see. Their record was not touched, and they are now enrolled —
  // which is the merge the header describes, and worth saying out loud on screen.
  return { error: null, created: (person || []).length > 0 };
}

/* ── Roster import ───────────────────────────────────────────────────────────
 * Parsing and reconciliation moved to roster-import.js, which is pure and unit-tested
 * (tests/app-schema/test-roster-import.mjs). What remains here is the part that touches the
 * database: fetching the students an import might collide with, and committing the result.
 */

/**
 * Fetch the `students` rows an import could conflict with, by cadet ID.
 *
 * Chunked because a roster is a few hundred cadets and PostgREST puts the `in.()` list in the
 * query string, which proxies truncate somewhere north of a few kilobytes. 200 ids is roughly
 * 2 KB and leaves headroom.
 *
 * Note what this can and cannot see: RLS lets a director read a student row only through an
 * enrollment in an offering they direct (students_read_staff), so a cadet who exists in the
 * database but has never been in one of your sections comes back EMPTY here and is staged as
 * new. The upsert then updates them anyway. That is the correct outcome — the alternative is
 * showing one director another director's roster — but it means "fresh" honestly means "not
 * visible to you", and an overwrite can still touch a row you were never shown.
 */
export async function loadExistingStudents(studentIds) {
  const ids = [...new Set(studentIds.map(Number))];
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('students')
      .select('student_id, name, email, squadron, sex, major_1, major_2, major_3, advisor_name')
      .in('student_id', ids.slice(i, i + 200));
    if (error) return { students: [], error };
    out.push(...(data || []));
  }
  return { students: out, error: null };
}

/** Which of these cadets already hold an enrollment in this offering. */
export async function loadEnrolledIds(ctx) {
  const { sections } = await loadOfferingSections(ctx);
  if (!sections.length) return new Set();
  const { data } = await db.from('enrollments')
    .select('student_id').in('section_id', sections.map(s => s.id));
  return new Set((data || []).map(e => Number(e.student_id)));
}

/** Create any sections the file referenced that the offering does not have yet. */
export async function createSections(ctx, codes) {
  if (!codes.length) return { created: 0, error: null };
  const { error } = await db.from('sections').insert(codes.map(code => ({
    course_offering_id: ctx.currentOffering,
    code: code.toUpperCase(),
    ...sectionDefaultsFrom(code),
  })));
  return { created: error ? 0 : codes.length, error };
}

/**
 * Commit a reviewed roster import.
 *
 * @param {object} ctx
 * @param {Array}  fresh      rows for cadets we have not seen — always written in full
 * @param {Array}  conflicts  reconciled conflicts, each carrying the operator's `resolution`
 * @param {object} meta       { filename } for the audit row
 *
 * THREE WRITES, IN THIS ORDER, AND THE ORDER MATTERS.
 *
 *   1. INSERT the people we do not have. Never an upsert: an insert that collides tells us
 *      the reconciliation was computed against a roster that has since changed (another
 *      director importing the same cadet in a parallel session — CORE.md §0 is a convention,
 *      not a lock). Failing loudly there is better than silently overwriting a row the
 *      operator was never shown and never approved.
 *   2. UPDATE only the conflicts explicitly resolved as `overwrite`, one statement each. A
 *      bulk upsert cannot express "these ten yes, those thirty no" without also re-writing the
 *      thirty, which is exactly the data loss `attach` exists to prevent.
 *   3. UPSERT enrollments for everyone in the file regardless of resolution, because being in
 *      the file IS the enrollment claim. ignoreDuplicates keeps a re-import idempotent rather
 *      than resurrecting a dropped enrollment.
 *
 * This is deliberately NOT a transaction, because PostgREST has no way to express one from the
 * browser. A failure part-way leaves people created but not enrolled — recoverable by simply
 * re-importing the same file, which is why step 1 is the only step that can fail hard and why
 * step 3 is idempotent. The audit row is written last and records what actually landed.
 */
export async function commitRoster(ctx, fresh, conflicts, meta = {}) {
  const { byCode } = await loadOfferingSections(ctx);
  const all = [...fresh, ...conflicts.map(c => c.row)];

  const unknown = [...new Set(all.map(r => r.section_code).filter(c => !byCode[c]))];
  if (unknown.length) {
    return { error: { message: `Unknown section(s) for this course: ${unknown.join(', ')}. ` +
                               `Create them first, then re-run the import.` } };
  }

  const FIELDS = ['name', 'email', 'squadron', 'sex', 'major_1', 'major_2', 'major_3', 'advisor_name'];
  const pick = (row) => Object.fromEntries(FIELDS.map(f => [f, row[f] ?? null]));

  // 1 — the people we do not have.
  const freshPeople = [...new Map(
    fresh.map(r => [r.student_id, { student_id: r.student_id, ...pick(r) }])
  ).values()];

  let created = 0, invisible = 0;
  if (freshPeople.length) {
    const { data, error } = await db.from('students')
      .upsert(freshPeople, { onConflict: 'student_id', ignoreDuplicates: true })
      .select('student_id');
    if (error) return { error };
    created = (data || []).length;
    invisible = freshPeople.length - created;
  }

  // 2 — the conflicts the operator chose to refresh.
  const toOverwrite = conflicts.filter(c => c.resolution === 'overwrite');
  for (const c of toOverwrite) {
    const { error } = await db.from('students')
      .update(pick(c.row)).eq('student_id', c.row.student_id);
    if (error) {
      return { error: { message: `Updating ${c.row.name} (${c.row.student_id}) failed: ${error.message}` } };
    }
  }

  // 3 — enrollments for everyone named in the file.
  const enrollments = all.map(r => ({
    student_id: r.student_id,
    section_id: byCode[r.section_code].id,
    status: 'active',
  }));
  const { error: eErr } = await db.from('enrollments').upsert(enrollments, {
    onConflict: 'student_id,section_id', ignoreDuplicates: true,
  });
  if (eErr) return { error: eErr };

  // `created` is what the database actually inserted, not what we asked it to. The two differ
  // when a "fresh" cadet already existed but was invisible to this director — RLS only exposes
  // a student through an enrollment in an offering you direct, so someone who has only ever
  // taken another course reads as new here. ON CONFLICT DO NOTHING leaves their record intact
  // and step 3 still enrolls them, which is exactly the `attach` outcome. Recording the attempt
  // count instead would put a number in the audit trail that never happened.
  const counts = {
    students_created: created,
    students_updated: toOverwrite.length,
    students_untouched: (conflicts.length - toOverwrite.length) + invisible,
    enrollments_created: enrollments.length,
  };

  // The audit row is best-effort on purpose. The roster landed; failing the whole import
  // because the log did not is the wrong trade, and the operator would have no way to act on
  // it. Surfaced as a warning instead.
  const { error: aErr } = await db.from('roster_imports').insert({
    course_offering_id: ctx.currentOffering,
    imported_by: ctx.user?.id || null,
    filename: meta.filename || null,
    rows_in_file: meta.rowsInFile ?? all.length,
    rows_matched: all.length,
    sections_created: meta.sectionsCreated || 0,
    notes: invisible
      ? `${invisible} cadet(s) already existed outside this director's visibility and were ` +
        `enrolled without changing their record.`
      : null,
    ...counts,
  });

  return { error: null, counts, invisible, auditWarning: aErr ? aErr.message : null };
}

/**
 * Turn a primary-key collision into the sentence that explains what actually happened.
 *
 * Two different situations produce it, and the operator cannot tell them apart from the raw
 * PostgREST message:
 *
 *   1. Another director imported the same cadet while this one was reviewing. CORE.md §0
 *      coordination is a convention, not a lock.
 *   2. The cadet already exists but is INVISIBLE to this director — students_read_staff only
 *      exposes a student through an enrollment in an offering you direct, so someone who has
 *      only ever taken another course reads as new here and collides on insert.
 *
 * (2) is the common one at the start of a term and is not an error in any meaningful sense.
 * Both have the same remedy, and in neither case was anything overwritten.
 */
function duplicateHint(error) {
  if (/duplicate key|already exists|23505/i.test(error.message || '')) {
    return 'Some of these cadets already have a record — either from a course you do not ' +
           'teach, or added by someone else while you were reviewing. Nothing was ' +
           'overwritten and nothing was lost. Re-upload the file: they will show up as ' +
           'returning students so you can choose what to keep.';
  }
  return error.message;
}

/**
 * Reset one student's password to the default (last 6 digits of their cadet ID).
 *
 * Goes through an edge function rather than the browser because setting someone else's
 * password needs the Admin API and the service-role key, which must never reach a client. The
 * function derives the password itself — the caller cannot choose one, by construction, so an
 * instructor has no way to set a password they then know.
 */
export function resetStudentPassword(ctx, studentId) {
  return db.functions.invoke('reset-student-password', {
    body: { course_offering_id: ctx.currentOffering, student_id: studentId },
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

/* `loadSections()` and `assignInstructor()` lived here until 2026-07-23 and are GONE.
 *
 * They powered Roster's "Sections" tab — one <select> per section, "assign an instructor". That
 * whole surface moved to Course Admin's Section Coverage grid (roadmap P1.10), which is where a
 * director looking at staffing already was, and which offers both a drag target and a dropdown.
 * `faculty-admin.js` addStaffSection()/removeStaffSection() are the replacements.
 *
 * assignInstructor() is not worth resurrecting even as a reference: it deleted every
 * `role='instructor'` row for the section first, so one section could hold exactly one
 * instructor. That was never a rule anybody stated — two people co-teaching a section is
 * ordinary — and the grid does not reproduce it.
 */

/** Grant or revoke an offering-wide role (director / instructor / grader).
 *
 * ⚠ UNUSED, and do not reach for it as a role-setter: it writes ONLY the offering-wide row, which
 * is precisely the P0.15 bug (a demoted director kept `role='director'` on their section rows, and
 * `director_offerings()` grants the privilege on a director role in ANY row). `faculty-admin.js`
 * setRole() is the one that updates every row and is what the Staff table calls. This is kept for
 * the revoke path — passing a falsy role deletes the offering-wide row and nothing else. */
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
