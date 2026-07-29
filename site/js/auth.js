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
import { hydrate as hydratePrefs, setPref, getPref, resetPrefs } from './prefs.js';
import { applyTheme, updateToggleButtons } from './theme.js';

// App root relative to the current page: nested pages (student/ faculty/) are one
// level deep. Depth-based, not path-based, so it survived the move from /site/app/
// to /site/ unchanged and would survive another one.
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
  let user = session.user;

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

  // ── Preferences (P1.3) ────────────────────────────────────────────────────
  // Before offerings are resolved, because sortAndPick() reads cp.currentOffering out of the
  // local cache — hydrating after it would apply the stored course one navigation late.
  //
  // The theme is re-applied only when the row actually disagreed with this browser's cache.
  // The <head> snippet has already painted the cached value, so a no-op reassignment on every
  // page load would be pure churn; the correction is the exception, not the rule.
  const { changed } = await hydratePrefs(user.id);
  if (changed.includes('cp.theme')) {
    const mode = localStorage.getItem('cp.theme');
    applyTheme(mode || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    updateToggleButtons();
  }

  // ── Enforce required role ─────────────────────────────────────────────────
  if (opts.require && role !== opts.require) { go(roleHome(role)); return; }

  // ── Forced password rotation ──────────────────────────────────────────────
  // Set by `provision-students` (a new account) and `reset-student-password` (a staff reset).
  // Both leave the user on the default derived from their cadet ID — a value on the roster and,
  // in a squadron, effectively public. So it cannot be carried into normal use: every page
  // bounces here until the user picks their own.
  //
  // The flag lives on the auth user rather than in a table because schema `app` DDL is sealed
  // (PLAN-2026-07-20-ACCOUNTS.md §3). It reads BOTH metadata bags: `app_metadata` is where it
  // lives now — service-role-only, so the user cannot clear it themselves — and `user_metadata`
  // is the pre-2026-07-21 location, honoured until every account flagged there has rotated.
  // The account page is exempt from the REDIRECT, or it would loop.
  //
  // ── THE COPY IN HAND IS NOT THE ANSWER, IT IS THE QUESTION ───────────────────────────────
  // `session.user` is a snapshot minted when the session started and cached in localStorage. It
  // can say "must change" about an account that changed its password minutes ago, because
  // clearing the flag is a server-side write nothing pushes back down. Trusting it is what
  // trapped people on this page for the rest of the token's hour (fixed 2026-07-29; the other
  // half of the fix is the re-sign-in in account.js changePassword()).
  //
  // So a set flag triggers ONE server round trip to ask whether it is still set. Only flagged
  // sessions pay for it, which is a handful of sign-ins per term. Three outcomes:
  //   still set   → redirect, exactly as before
  //   cleared     → carry on with the fresh copy, so the account page also stops showing the banner
  //   error       → the session is dead server-side (a password change destroys it). Sign out and
  //                 send them to the login page, which is the one place that can hand back a live
  //                 one. Only reachable for an already-flagged session, so a transient network
  //                 blip costs a sign-in, not a lost session.
  if (user.app_metadata?.must_change_password || user.user_metadata?.must_change_password) {
    const { data: fresh, error: freshErr } = await db.auth.getUser();
    if (freshErr || !fresh?.user) {
      await db.auth.signOut();
      go(`${loginPath}?err=stale`);
      return;
    }
    user = fresh.user;
    if ((user.app_metadata?.must_change_password || user.user_metadata?.must_change_password)
        && !/\/account\.html$/.test(location.pathname)) {
      go(`${APP_ROOT}${role === 'faculty' ? 'faculty' : 'student'}/account.html?rotate=1`);
      return;
    }
  }

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
    // resetPrefs() before signOut so this user's pending push cannot land under the next
    // person to sign in on a shared lab machine.
    signOut: async () => { resetPrefs(); await db.auth.signOut(); go(loginPath); },
  };

  if (role === 'faculty') await resolveFacultyOfferings(ctx);
  else await resolveStudentOfferings(ctx);

  ctx.isDirectorForCurrent = () => isDirectorForCurrent(ctx);

  ctx.setCurrentOffering = async (offeringId) => {
    const c = ctx.courses.find(x => x.offeringId === offeringId);
    if (!c) return;
    applyCurrent(ctx, c);
    setPref(LS_OFFERING, offeringKey(c));
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
    // A global admin's AUTHORITY comes from the flag, not from staff rows — that is what the
    // branch above is for and it is unchanged. But authority is not the same question as "which
    // sections do I personally teach", and a global admin very often teaches: the course director
    // holds is_global_admin AND a section-scoped staff row.
    //
    // Leaving ctx.staff empty here made taughtSectionIds() return nothing, so the rollup's
    // "My sections" scope silently disappeared for exactly the people most likely to want it.
    // Load the rows for that question alone; nothing downstream derives permission from them.
    const { data: staff } = await db.from('staff_assignments')
      .select(STAFF_SELECT).eq('instructor_id', instr.id);
    ctx.staff = staff || [];
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

  // A stored offering SELECTS a scope, it does not grant one: the lookup runs against
  // ctx.courses, which was built from staff_assignments, so a hand-edited preference naming an
  // offering the caller does not staff simply falls through to the first real one.
  const stored = getPref(LS_OFFERING);
  const chosen = ctx.courses.find(c => offeringKey(c) === stored) || ctx.courses[0] || null;
  if (chosen) {
    applyCurrent(ctx, chosen);
    setPref(LS_OFFERING, offeringKey(chosen));
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
