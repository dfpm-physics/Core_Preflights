// auth.js — the single shared session/role bootstrap for every portal page.
//
// One call, `await bootstrap({ require })`, does all of:
//   • restore the persisted session (survives reload + navigation)
//   • redirect unauthenticated users to login (with a ?next round-trip)
//   • resolve role by TABLE MEMBERSHIP (instructors vs students), not email guessing
//   • resolve the faculty course list + current course (persisted), or the student's
//     course (derived from their section), with the same RLS fallbacks as admin.html
//   • enforce a required role (redirect to the user's own dashboard on mismatch)
//
// Returns a uniform context object consumed by nav.js and the *-data.js query modules.

import { db } from './supabase.js';
import { COURSE_TITLE_FALLBACK, courseTitle } from './util.js';

// App root relative to the current page: nested pages (student/ faculty/) are one
// level deep. Works under /site/app/.
const APP_ROOT = /\/(student|faculty)\/[^/]*$/.test(location.pathname) ? '../' : '';
const LS_COURSE = 'cp.currentCourse';

const roleHome = (role) => `${APP_ROOT}${role === 'faculty' ? 'faculty' : 'student'}/dashboard.html`;

function go(url) { location.replace(url); }

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
  const { data: instructorRow } = await db.from('instructors')
    .select('id, name, is_director, is_global_admin').eq('id', user.id).maybeSingle();

  let role, studentRow = null;
  if (instructorRow) {
    role = 'faculty';
  } else {
    const { data: stu } = await db.from('students')
      .select('student_id, name, section_id, auth_user_id').eq('auth_user_id', user.id).maybeSingle();
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
    courses: [], currentCourse: null,
    appRoot: APP_ROOT,
    signOut: async () => { await db.auth.signOut(); go(loginPath); },
  };

  if (role === 'faculty') await resolveFacultyCourses(ctx);
  else await resolveStudentCourse(ctx);

  ctx.isDirectorForCurrent = () => isDirectorForCurrent(ctx);
  ctx.setCurrentCourse = (id) => {
    if (!ctx.courses.some(c => c.course_id === id)) return;
    ctx.currentCourse = id;
    try { localStorage.setItem(LS_COURSE, id); } catch (_) {}
  };
  ctx.courseTitleOf = (id) =>
    courseTitle(id, ctx.courses.find(c => c.course_id === id)?.course_title);

  return ctx;
}

// ── Faculty: port of admin.html initAdmin course-access resolution + fallbacks ──
async function resolveFacultyCourses(ctx) {
  const instr = ctx.instructorRow;

  if (instr.is_global_admin) {
    let { data: courses } = await db.from('courses').select('id, title').order('id');
    if (!courses?.length) {
      const { data: sects } = await db.from('sections').select('course_id').order('course_id');
      const ids = [...new Set((sects || []).map(s => s.course_id).filter(Boolean))];
      courses = ids.map(id => ({ id, title: COURSE_TITLE_FALLBACK[id] || id }));
    }
    ctx.courses = (courses || []).map(c => ({
      course_id: c.id, role: 'director', course_title: c.title || COURSE_TITLE_FALLBACK[c.id] || c.id,
    }));
  } else {
    const [{ data: access }, { data: allCourses }] = await Promise.all([
      db.from('instructor_course_access').select('course_id, role').eq('instructor_id', instr.id),
      db.from('courses').select('id, title'),
    ]);
    if (access?.length) {
      const titleMap = Object.fromEntries([
        ...(allCourses || []).map(c => [c.id, c.title]),
        ...Object.entries(COURSE_TITLE_FALLBACK),
      ]);
      ctx.courses = access.map(a => ({
        course_id: a.course_id, role: a.role, course_title: titleMap[a.course_id],
      }));
    } else {
      const { data: sects } = await db.from('sections').select('course_id')
        .eq('instructor_id', instr.id).order('course_id');
      const ids = [...new Set((sects || []).map(s => s.course_id).filter(Boolean))];
      ctx.courses = ids.map(id => ({
        course_id: id, role: instr.is_director ? 'director' : 'instructor',
        course_title: COURSE_TITLE_FALLBACK[id] || id,
      }));
    }
  }

  // Pick current course: persisted choice if still valid, else the first.
  let stored = null;
  try { stored = localStorage.getItem(LS_COURSE); } catch (_) {}
  const valid = ctx.courses.find(c => c.course_id === stored);
  ctx.currentCourse = valid ? valid.course_id : (ctx.courses[0]?.course_id ?? null);
  if (ctx.currentCourse) { try { localStorage.setItem(LS_COURSE, ctx.currentCourse); } catch (_) {} }
}

// ── Student: derive course from their section (legacy used a ?course= param) ──
async function resolveStudentCourse(ctx) {
  const secId = ctx.studentRow?.section_id;
  if (!secId) { ctx.currentCourse = null; ctx.courses = []; return; }

  const { data: sec } = await db.from('sections')
    .select('id, course_id').eq('id', secId).maybeSingle();
  if (!sec?.course_id) { ctx.currentCourse = null; ctx.courses = []; return; }

  let title = COURSE_TITLE_FALLBACK[sec.course_id] || sec.course_id;
  const { data: course } = await db.from('courses')
    .select('id, title').eq('id', sec.course_id).maybeSingle();
  if (course?.title) title = course.title;

  ctx.currentCourse = sec.course_id;
  ctx.courses = [{ course_id: sec.course_id, course_title: title }];
}

function isDirectorForCurrent(ctx) {
  if (ctx.instructorRow?.is_global_admin) return true;
  return ctx.courses.find(c => c.course_id === ctx.currentCourse)?.role === 'director';
}
