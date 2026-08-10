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
  const blank = { students: [], dropped: [], sections: [], total: 0, unprovisioned: 0 };
  if (!ctx.currentOffering) return blank;
  const { sections, byId } = await loadOfferingSections(ctx);
  const inScope = scope?.length ? new Set(scope.map(String)) : null;
  const sectionIds = sections.map(s => s.id).filter(id => !inScope || inScope.has(String(id)));
  if (!sectionIds.length) return { ...blank, sections };

  const { data } = await db.from('enrollments')
    .select('id, status, student_id, section_id, ' +
            'students!inner(student_id, name, email, squadron, auth_user_id)')
    .in('section_id', sectionIds);

  const all = (data || [])
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

  /* ── Why this now splits on status (2026-07-28) ────────────────────────────────────────────
   * It did not, and that was the one place in the app where it did not. Every other reader —
   * grading, the gradebook, the dashboard, the rollup, EI, the task list — filters
   * `status = 'active'`, so a dropped cadet already vanishes from grading and from every cohort
   * denominator. Only this page still listed them, indistinguishable from everybody else, which
   * made `dropped` look like a status that did nothing and left the roster page contradicting
   * the rest of the system. It does something; the roster page just was not reading it.
   *
   * Splitting rather than filtering because "who did I remove" is a question worth being able to
   * answer, and a dropped enrollment still holds that cadet's submissions and grades. */
  const students = all.filter(s => s.status !== 'dropped');
  return {
    students,
    dropped: all.filter(s => s.status === 'dropped'),
    sections,
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

/* `removeEnrollment()` — a hard DELETE of the enrollment row — was here and is GONE (2026-07-28).
 *
 * Do not reintroduce it. Director's rule: **a student is never deleted, because they may be in
 * another course.** Deleting the enrollment would not touch the `students` row, so on a strict
 * reading it never endangered the other course — but it cascaded away every submission and grade
 * for THIS one, irreversibly, from a button sitting next to a search box. It stopped being
 * defensible the moment a file upload could do the same thing to twenty people at once.
 *
 * `dropEnrollments()` below achieves everything anybody means by "remove" and is reversible.
 * If a row genuinely must be purged — test residue, a cadet attached to the wrong course before
 * they did anything — that is an operator-tier script action (see `tests/app-schema/cleanup.py`
 * for the pattern), taken deliberately, not a click.
 */

/** One-student form of dropEnrollments(). Same semantics; see that function's header. */
export function dropStudent(enrollmentId) {
  return dropEnrollments([enrollmentId]);
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

/**
 * Every enrollment in this offering, with the section code and the person's name.
 *
 * Replaces the old `loadEnrolledIds()`, which returned bare ids. The import needs three different
 * things out of this one read and only one of them was expressible as a Set:
 *
 *   - `alreadyEnrolled` on a conflict row — was all the Set was for;
 *   - the DEPARTURE list (departures() in roster-import.js) — needs the enrollment id to drop, the
 *     name to show a director before they confirm, and the section code to apply the scope rule;
 *   - the RETURNING list — a cadet the file names whose enrollment is currently `dropped`, which
 *     is invisible in a Set of ids and would otherwise stay dropped forever (the enrollment upsert
 *     in commitRoster is `ignoreDuplicates`, so it cannot revive a row).
 *
 * Both statuses come back, tagged. A caller that wants "who is currently in the course" filters
 * on `status === 'active'`; nothing here does that for them, because the returning case is
 * precisely the one that cares about the rows an active-only filter would drop.
 */
export async function loadEnrollmentState(ctx) {
  const { sections, byId } = await loadOfferingSections(ctx);
  if (!sections.length) return [];
  const { data } = await db.from('enrollments')
    .select('id, status, student_id, section_id, students!inner(name)')
    .in('section_id', sections.map(s => s.id));
  return (data || []).map(e => ({
    enrollment_id: e.id,
    status: e.status,
    student_id: Number(e.student_id),
    name: e.students?.name || String(e.student_id),
    section_id: e.section_id,
    section_code: byId[e.section_id]?.code || '—',
  }));
}

/**
 * Drop a batch of enrollments — the bulk form of dropStudent().
 *
 * DROP, NOT DELETE, and the distinction is the point. The director's instruction was "remove them
 * from the course, do not delete their accounts", and there are two ways to read that. The
 * per-student Remove button takes the destructive one (DELETE the enrollment; submissions and
 * grades cascade with it) behind a confirm that says so. A bulk path reached by uploading a file
 * must not: an export that is stale, partial, or exported before an add/drop deadline would
 * silently take a term of work with it, and nothing would be recoverable.
 *
 * `dropped` is the whole answer here rather than a compromise. Every reader in the app already
 * filters `status = 'active'` (see loadRoster's header), so a dropped cadet is out of grading, out
 * of the gradebook, out of the dashboard, out of every cohort denominator — removed from the
 * course in every sense a person would mean — while their record and their work survive.
 */
export async function dropEnrollments(enrollmentIds) {
  const ids = [...new Set((enrollmentIds || []).map(String))];
  if (!ids.length) return { dropped: 0, error: null };
  const { error } = await db.from('enrollments')
    .update({ status: 'dropped', dropped_at: new Date().toISOString() })
    .in('id', ids);
  return { dropped: error ? 0 : ids.length, error };
}

/**
 * Put dropped enrollments back — the other half of dropEnrollments(), and not optional.
 *
 * Once an import can drop somebody, it must be able to undo that from the same evidence, or a
 * cadet mistakenly left off one export is stuck outside the course no matter how many correct
 * exports follow. `dropped_at` is cleared rather than kept as history: the column means "when did
 * this enrollment end", and an enrollment that is running again did not end.
 */
export async function reactivateEnrollments(enrollmentIds) {
  const ids = [...new Set((enrollmentIds || []).map(String))];
  if (!ids.length) return { reactivated: 0, error: null };
  const { error } = await db.from('enrollments')
    .update({ status: 'active', dropped_at: null })
    .in('id', ids);
  return { reactivated: error ? 0 : ids.length, error };
}

/**
 * Relocate enrollments the registrar file places in a different section — the bulk form of
 * updateStudentSection(). See sectionMoves() in roster-import.js for why this is a move and not a
 * drop-and-add: the row is the anchor for the cadet's submissions and grades, so it travels.
 *
 * One statement each, for the same reason step 2 of commitRoster() updates conflicts one at a
 * time — a bulk upsert cannot say "these rows to these different sections" without re-writing
 * columns nobody approved. Moves are rare (the worst Fall 2026 import would have been 25) and a
 * PATCH each is cheaper than the failure mode.
 *
 * Stops at the first failure and reports how far it got, so the caller can say something true.
 * Every move already applied is correct and idempotent; re-importing the same file re-runs only
 * the ones that did not land, because a cadet already in the named section is not a move.
 */
export async function moveEnrollments(moves, byCode) {
  let moved = 0;
  for (const m of moves || []) {
    const target = byCode[m.to_section_code];
    if (!target) {
      return { moved, error: { message: `Cannot move ${m.name} to ${m.to_section_code}: `
                                      + `no such section in this course.` } };
    }
    const { error } = await updateStudentSection(m.enrollment_id, target.id);
    if (error) {
      return { moved, error: { message: `Moving ${m.name} from ${m.section_code} to `
                                      + `${m.to_section_code} failed: ${error.message}` } };
    }
    moved++;
  }
  return { moved, error: null };
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
 * @param {object} plan       { departing[], returning[], moves[] } — enrollment rows the operator
 *                            confirmed for removal, dropped enrollments the file re-names in the
 *                            same section, and enrollments the file relocates to another section
 * @param {object} meta       { filename } for the audit row
 *
 * FIVE WRITES, IN THIS ORDER, AND THE ORDER MATTERS.
 *
 *   1. INSERT the people we do not have. Never an upsert: an insert that collides tells us
 *      the reconciliation was computed against a roster that has since changed (another
 *      director importing the same cadet in a parallel session — CORE.md §0 is a convention,
 *      not a lock). Failing loudly there is better than silently overwriting a row the
 *      operator was never shown and never approved.
 *   2. UPDATE only the conflicts explicitly resolved as `overwrite`, one statement each. A
 *      bulk upsert cannot express "these ten yes, those thirty no" without also re-writing the
 *      thirty, which is exactly the data loss `attach` exists to prevent.
 *   3. MOVE the enrollments the file puts in a different section, BEFORE the upsert below and not
 *      after it. The upsert keys on `(student_id, section_id)`, so once it has inserted a row in
 *      the target section the move becomes a UNIQUE violation — and if it somehow did not, the
 *      cadet would be left holding both rows, which is the exact bug this step was added to fix
 *      (2026-08-10; see sectionMoves() in roster-import.js). Moving first makes step 4 a no-op
 *      for that cadet, which is what "they are already enrolled where the file says" should mean.
 *   4. UPSERT enrollments for everyone in the file regardless of resolution, because being in
 *      the file IS the enrollment claim. ignoreDuplicates keeps a re-import idempotent — and it
 *      is also why step 5 has to exist, because a row that already exists is left exactly as it
 *      was, `dropped` status included.
 *   5. REACTIVATE the dropped enrollments the file names IN THAT SECTION. Being in the file is the
 *      same claim it was in step 4; step 4 simply cannot express it for a row that already exists.
 *   6. DROP the departures the operator confirmed. LAST, so a failure anywhere above leaves the
 *      roster additive-only — the state it was in before this feature existed — rather than a
 *      roster that has removed people without adding their replacements.
 *
 * This is deliberately NOT a transaction, because PostgREST has no way to express one from the
 * browser. A failure part-way leaves people created but not enrolled — recoverable by simply
 * re-importing the same file, which is why step 1 is the only step that can fail hard and why
 * steps 3–5 are idempotent. The audit row is written last and records what actually landed.
 */
export async function commitRoster(ctx, fresh, conflicts, plan = {}, meta = {}) {
  const { byCode } = await loadOfferingSections(ctx);
  const all = [...fresh, ...conflicts.map(c => c.row)];

  /* A last-line guard, and it should now be unreachable from the page: the preview parses against
   * the offering's sections (an EMPTY map included, since 2026-07-28) and offers to create any it
   * does not recognise, so a staged row always names a section that exists. It is kept because
   * this is the function that would otherwise write an enrollment against `undefined.id`, and
   * because the preview and the commit are separated by however long the operator spent reviewing.
   * The message names both routes deliberately — it used to say only "create them first", which
   * was the instruction a director could not act on. */
  const unknown = [...new Set(all.map(r => r.section_code).filter(c => !byCode[c]))];
  if (unknown.length) {
    return { error: { message: `Unknown section(s) for this course: ${unknown.join(', ')}. ` +
                               `Re-upload the file and use "Create these sections and re-check" ` +
                               `in the preview, or add them under Staff → Section coverage.` } };
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

  // 3 — cadets the file places in a different section. Before the upsert; see the header.
  const { moved, error: mErr } = await moveEnrollments(plan.moves || [], byCode);
  if (mErr) {
    return { error: { message: `${mErr.message} ${moved} of ${(plan.moves || []).length} section `
                             + `move(s) were applied; nothing else has been written. Re-run the `
                             + `import to finish — the moves already applied will be skipped.` } };
  }

  // 4 — enrollments for everyone named in the file.
  const enrollments = all.map(r => ({
    student_id: r.student_id,
    section_id: byCode[r.section_code].id,
    status: 'active',
  }));
  const { error: eErr } = await db.from('enrollments').upsert(enrollments, {
    onConflict: 'student_id,section_id', ignoreDuplicates: true,
  });
  if (eErr) return { error: eErr };

  // 5 — cadets the file names whose enrollment we had dropped. See reactivateEnrollments().
  const { reactivated, error: rErr } =
    await reactivateEnrollments((plan.returning || []).map(e => e.enrollment_id));
  if (rErr) return { error: rErr };

  // 6 — the departures the operator confirmed, one at a time in the UI or in bulk. `dropped`,
  // never deleted: their work stays, and every other reader in the app already ignores them.
  const { dropped, error: dErr } =
    await dropEnrollments((plan.departing || []).map(e => e.enrollment_id));
  if (dErr) {
    return { error: { message: `The roster imported, but removing ${(plan.departing || []).length} `
                             + `departed cadet(s) failed: ${dErr.message}. Re-run the import to `
                             + `retry — nothing else will be written twice.` } };
  }

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

  /* The drop and reactivate counts go in `notes`, not in columns of their own. DDL on schema `app`
   * is sealed (CORE.md §0: `prep_app_owner` is NOLOGIN and a human has to unseal it), so adding
   * two integer columns for this would mean a coordinated migration. A sentence in the free-text
   * column that already exists carries the same audit fact today, and the columns can follow the
   * next time the schema is opened for another reason. */
  const notes = [
    // What the operator overrode, verbatim from the preview. See admin.html's overrideNote():
    // the file is not kept, so this sentence is the only surviving evidence that these rows
    // named another course or term and a human said take them anyway.
    meta.overrides || null,
    invisible ? `${invisible} cadet(s) already existed outside this director's visibility and `
              + `were enrolled without changing their record.` : null,
    dropped ? `${dropped} enrollment(s) dropped — on the roster but not in this file. Their `
            + `records and work were kept.` : null,
    reactivated ? `${reactivated} previously dropped enrollment(s) reactivated — named in this `
                + `file again.` : null,
    moved ? `${moved} cadet(s) moved to the section this file names. Their enrollment row was `
          + `relocated, so their submissions and grades moved with them.` : null,
  ].filter(Boolean);

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
    notes: notes.length ? notes.join(' ') : null,
    ...counts,
  });

  return { error: null, counts, invisible, dropped, reactivated, moved,
           auditWarning: aErr ? aErr.message : null };
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

/**
 * Create ONE section in the current offering — the Section coverage card's "+ Add section".
 *
 * Had zero callers until 2026-07-28, which is how the setup deadlock survived: Staff → Section
 * coverage told the director sections came from a roster import, and the import refused any file
 * naming a section that did not exist, so neither screen could produce the first one. The bulk
 * path (createSections, from the file's own codes) is still the right tool for starting a term;
 * this is the one for the section added in week three.
 */
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
