// auth.js — the single shared session/role bootstrap for every portal page.
//
// One call, `await bootstrap({ require })`, does all of:
//   • restore the persisted session (survives reload + navigation)
//   • redirect unauthenticated users to login (with a ?next round-trip)
//   • resolve role by TABLE MEMBERSHIP (instructors vs students), not email guessing
//   • resolve which COURSE OFFERINGS the caller can act in, and pick the current one
//   • enforce a required role (redirect to the user's own dashboard on mismatch)
//
// ── WHAT CHANGED MOVING TO SCHEMA `app` ──────────────────────────────────────────
// The unit of scope is no longer a course, it is a COURSE OFFERING — a course in one
// term. That is not cosmetic: staff_assignments and enrollments both attach people to a
// term, so "who directs Physics 215" is only answerable for a given semester. Everything
// downstream (sections, assignments, grades) hangs off the offering.
//
//   instructor_course_access  ->  staff_assignments  (term-aware, may be section-scoped)
//   instructors.is_director   ->  gone; authority lives only in staff_assignments.role
//   students.section_id       ->  enrollments        (a student may hold several)
//   courses.id 'phys-215'     ->  courses.id uuid + courses.code 'phys-215'
//
// ctx.sectionIds mirrors app.staff_sections() from 002_rls.sql exactly. Keeping the two in
// step matters: if the UI scopes wider than RLS the page shows empty rows it cannot explain,
// and if it scopes narrower it hides work the instructor is meant to grade.

import { db } from './supabase.js';
import { STAFF_SELECT, ENROLLMENT_SELECT } from './schema.js';
import { COURSE_TITLE_FALLBACK } from './util.js';

// App root relative to the current page: nested pages (student/ faculty/) are one
// level deep. Works under /site/app/.
const APP_ROOT = /\/(student|faculty)\/[^/]*$/.test(location.pathname) ? '../' : '';

// Persisted as "<courseCode>|<termCode>" rather than the offering uuid: the pair is stable
// and readable, and it survives a re-run of the migration that would issue new uuids.
const LS_OFFERING = 'cp.currentOffering';

const roleHome = (role) => `${APP_ROOT}${role === 'faculty' ? 'faculty' : 'student'}/dashboard.html`;

function go(url) { location.replace(url); }

const offeringKey = (c) => `${c.courseCode}|${c.termCode}`;

/**
 * @param {{ require?: 'student'|'faculty', loginPath?: string }} opts
 * @returns {Promise<object|undefined>} the context, or undefined if a redirect fired.
 */
export async function bootstrap(opts = {}) {
  const loginPath = opts.loginPath || `${APP_ROOT}login.html`;

  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    go(`${loginPath}?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  const user = session.user;

  // ── Resolve role by membership ────────────────────────────────────────────
  // is_director is deliberately NOT selected: the column does not exist in `app`.
  const { data: instructorRow } = await db.from('instructors')
    .select('id, name, is_global_admin').eq('id', user.id).maybeSingle();

  let role, studentRow = null;
  if (instructorRow) {
    role = 'faculty';
  } else {
    const { data: stu } = await db.from('students')
      .select('student_id, name, auth_user_id').eq('auth_user_id', user.id).maybeSingle();
    if (stu) { role = 'student'; studentRow = stu; }
  }

  if (!role) {
    // Authenticated but provisioned in neither table — bounce out cleanly.
    await db.auth.signOut();
    go(`${loginPath}?err=notreg`);
    return;
  }

  // ── Enforce required role ─────────────────────────────────────────────────
  if (opts.require && role !== opts.require) { go(roleHome(role)); return; }

  const ctx = {
    user, role, studentRow, instructorRow,
    courses: [],            // [{ offeringId, courseId, courseCode, courseTitle, termCode, termLabel, role }]
    currentOffering: null,  // uuid — the term-scoped scope for everything
    currentCourse: null,    // uuid — the course, for library (catalogue) reads
    currentCourseCode: null,
    sectionIds: [],         // sections in scope for the current offering (mirrors staff_sections())
    enrollments: [],        // students only
    staff: [],              // faculty only — raw staff_assignments rows
    appRoot: APP_ROOT,
    signOut: async () => { await db.auth.signOut(); go(loginPath); },
  };

  if (role === 'faculty') await resolveFacultyOfferings(ctx);
  else await resolveStudentOfferings(ctx);

  ctx.isDirectorForCurrent = () => isDirectorForCurrent(ctx);

  ctx.setCurrentOffering = async (offeringId) => {
    const c = ctx.courses.find(x => x.offeringId === offeringId);
    if (!c) return;
    applyCurrent(ctx, c);
    try { localStorage.setItem(LS_OFFERING, offeringKey(c)); } catch (_) {}
    await resolveScopeSections(ctx);
  };

  /** Display label for an offering id (falls back to the course code). */
  ctx.courseTitleOf = (offeringId) => {
    const c = ctx.courses.find(x => x.offeringId === offeringId);
    if (!c) return '—';
    return c.courseTitle || COURSE_TITLE_FALLBACK[c.courseCode] || c.courseCode;
  };

  /** The section codes in scope, for display. Resolved alongside sectionIds. */
  ctx.sectionCodeOf = (id) => ctx.sectionsById?.[id]?.code || id;

  await resolveScopeSections(ctx);
  return ctx;
}

/* ── Faculty ─────────────────────────────────────────────────────────────────
 * A global admin implicitly staffs every offering (mirrors is_admin() short-circuits
 * throughout 002_rls.sql), so it reads course_offerings directly rather than expecting
 * staff rows it will never have.
 */
async function resolveFacultyOfferings(ctx) {
  const instr = ctx.instructorRow;

  if (instr.is_global_admin) {
    const { data } = await db.from('course_offerings')
      .select('id, is_active, courses(id, code, title), terms(id, code, label, starts_on, ends_on)');
    ctx.courses = (data || []).map(o => ({
      offeringId: o.id,
      courseId: o.courses?.id,
      courseCode: o.courses?.code,
      courseTitle: o.courses?.title,
      termCode: o.terms?.code,
      termLabel: o.terms?.label,
      termStarts: o.terms?.starts_on,
      role: 'director',
    }));
  } else {
    const { data: staff } = await db.from('staff_assignments')
      .select(STAFF_SELECT).eq('instructor_id', instr.id);
    ctx.staff = staff || [];

    // Several rows may name the same offering (one offering-wide, one per section).
    // Collapse to one entry per offering, keeping the strongest role.
    const byOffering = new Map();
    (staff || []).forEach(sa => {
      const o = sa.course_offerings;
      if (!o) return;
      const prev = byOffering.get(o.id);
      const isDirector = sa.role === 'director' || prev?.role === 'director';
      byOffering.set(o.id, {
        offeringId: o.id,
        courseId: o.courses?.id,
        courseCode: o.courses?.code,
        courseTitle: o.courses?.title,
        termCode: o.terms?.code,
        termLabel: o.terms?.label,
        termStarts: o.terms?.starts_on,
        role: isDirector ? 'director' : (prev?.role || sa.role),
      });
    });
    ctx.courses = [...byOffering.values()];
  }

  sortAndPick(ctx);
}

/* ── Student ──────────────────────────────────────────────────────────────── */
async function resolveStudentOfferings(ctx) {
  const { data: enr } = await db.from('enrollments')
    .select(ENROLLMENT_SELECT).eq('student_id', ctx.studentRow.student_id);
  ctx.enrollments = (enr || []).filter(e => e.status === 'active');

  const byOffering = new Map();
  ctx.enrollments.forEach(e => {
    const sec = e.sections;
    const o = sec?.course_offerings;
    if (!o) return;
    byOffering.set(o.id, {
      offeringId: o.id,
      courseId: o.courses?.id,
      courseCode: o.courses?.code,
      courseTitle: o.courses?.title,
      termCode: o.terms?.code,
      termLabel: o.terms?.label,
      role: 'student',
    });
  });
  ctx.courses = [...byOffering.values()];
  sortAndPick(ctx);
}

/** Newest term first, then course code. Restore the persisted pick when still valid. */
function sortAndPick(ctx) {
  ctx.courses.sort((a, b) =>
    String(b.termCode || '').localeCompare(String(a.termCode || '')) ||
    String(a.courseCode || '').localeCompare(String(b.courseCode || '')));

  let stored = null;
  try { stored = localStorage.getItem(LS_OFFERING); } catch (_) {}
  const chosen = ctx.courses.find(c => offeringKey(c) === stored) || ctx.courses[0] || null;
  if (chosen) {
    applyCurrent(ctx, chosen);
    try { localStorage.setItem(LS_OFFERING, offeringKey(chosen)); } catch (_) {}
  }
}

function applyCurrent(ctx, c) {
  ctx.currentOffering = c.offeringId;
  ctx.currentCourse = c.courseId;
  ctx.currentCourseCode = c.courseCode;
  ctx.currentTermLabel = c.termLabel;
}

/**
 * Which sections the caller may see in the current offering.
 *
 * Mirrors app.staff_sections() (002_rls.sql):
 *   explicit section rows
 *   ∪ EVERY section of an offering the caller staffs offering-wide (section_id IS NULL)
 *   ∪ everything, for a global admin
 *
 * The offering-wide clause is the one that is easy to get wrong — a director's staff row
 * carries section_id NULL, which means all sections, not none.
 */
async function resolveScopeSections(ctx) {
  ctx.sectionIds = [];
  ctx.sectionsById = {};
  if (!ctx.currentOffering) return;

  const { data: sections } = await db.from('sections')
    .select('id, code, meeting_days, period')
    .eq('course_offering_id', ctx.currentOffering).order('code');
  const all = sections || [];
  all.forEach(s => { ctx.sectionsById[s.id] = s; });

  if (ctx.role === 'student') {
    // A student's scope is the section(s) they are enrolled in for this offering.
    const mine = ctx.enrollments
      .filter(e => e.sections?.course_offering_id === ctx.currentOffering)
      .map(e => e.section_id);
    ctx.sectionIds = mine;
    ctx.enrollmentIds = ctx.enrollments
      .filter(e => e.sections?.course_offering_id === ctx.currentOffering)
      .map(e => e.id);
    return;
  }

  if (ctx.instructorRow?.is_global_admin) { ctx.sectionIds = all.map(s => s.id); return; }

  const rows = ctx.staff.filter(sa => sa.course_offering_id === ctx.currentOffering);
  const offeringWide = rows.some(sa => sa.section_id == null);
  ctx.sectionIds = offeringWide
    ? all.map(s => s.id)
    : rows.map(sa => sa.section_id).filter(Boolean);
}

function isDirectorForCurrent(ctx) {
  if (ctx.instructorRow?.is_global_admin) return true;
  return ctx.courses.find(c => c.offeringId === ctx.currentOffering)?.role === 'director';
}
