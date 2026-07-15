// faculty-data.js — per-section roll-up for the faculty dashboard, scoped to the
// instructor's current course. Uses only existing tables. Section scoping mirrors the
// legacy admin.html (client-side): directors/admins see all sections in the course,
// instructors see only the sections they teach. (RLS is permissive — see plan notes.)

import { db } from './supabase.js';
import { loadInteractionData } from './faculty-interactions.js';

const CHUNK = 300; // keep .in() URLs under GET length limits for large courses

// Pull a lesson number out of a slug ("lesson-08-charge") or title ("08 — …"); else null.
function lessonNumber(id, title) {
  const m = String(id || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/)
        || String(title || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/);
  return m ? parseInt(m[1], 10) : null;
}

async function reportsByStudent(studentIds) {
  if (!studentIds.length) return [];
  const out = [];
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const { data } = await db.from('preflight_interaction_reports')
      .select('student_id, interaction_id').in('student_id', studentIds.slice(i, i + CHUNK));
    if (data) out.push(...data);
  }
  return out;
}

/**
 * Just-in-Time-Teaching dashboard model. Unlike the interactions page (which rolls up one
 * lesson at a time), this loads EVERY published lesson's per-student report rows up front and
 * groups them by (lesson, section) so the view can aggregate any scope live via
 * `summarizeReports()` — KPI tiles, the active-lesson spotlight, the section cards, and the
 * all-sections matrix all read from one fetch.
 *
 * @returns {{
 *   noCourse?, noSections?, isDirector, courseTitle, myName,
 *   sections: Array<{id, instructorName, isMine, n}>,        // every in-scope section, roster size n
 *   lessons:  Array<{id, title, due_date, num, short}>,      // published, ordered by effective date asc
 *   activeId: string|null,                                   // the "today" (next-due) lesson
 *   rowsByLesson: Record<string, Array<{student_id, sectionId, effort, score, report_data}>>,
 *   sectionSize: Record<string, number>,
 *   counts: { sections, students, lessons },
 * }}
 */
export async function loadFacultyDashboard(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true };

  const isDirector = ctx.isDirectorForCurrent();
  const myId = ctx.instructorRow.id;

  // 1) Sections in scope. Directors see every section in the course (the view splits the ones
  //    they personally teach from the rest); instructors see only their own.
  let secQuery = db.from('sections').select('id, instructor_id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', myId);
  const { data: sectionRows } = await secQuery;
  const sections = sectionRows || [];
  if (!sections.length) return { noCourse: false, isDirector, noSections: true, courseTitle: ctx.courseTitleOf(course) };
  const sectionIds = sections.map(s => s.id);

  // 2) Roster + published interactions (with due dates) + instructor names, in parallel.
  const [{ data: studentsRaw }, { data: interRaw }] = await Promise.all([
    db.from('students').select('student_id, section_id').in('section_id', sectionIds),
    db.from('interactions').select('id, title, due_date_m, due_date_t, created_at')
      .eq('course_id', course).eq('is_published', true),
  ]);
  const students = studentsRaw || [];
  const studentIds = students.map(s => s.student_id);
  const sectionOf = Object.fromEntries(students.map(s => [s.student_id, s.section_id]));

  let instrName = {};
  const instrIds = [...new Set(sections.map(s => s.instructor_id).filter(Boolean))];
  if (instrIds.length) {
    const { data: instrs } = await db.from('instructors').select('id, name').in('id', instrIds);
    instrName = Object.fromEntries((instrs || []).map(i => [i.id, i.name]));
  }

  // Roster size per section.
  const sectionSize = {};
  sectionIds.forEach(id => sectionSize[id] = 0);
  students.forEach(s => { if (sectionSize[s.section_id] != null) sectionSize[s.section_id]++; });

  // 3) Lesson sequence: order by effective date (due_date, falling back to created_at). The
  //    "active"/today lesson is the next one due; if all are past, the most recent; if no due
  //    dates are set at all, the newest by creation (migration 015 / the open due-date question
  //    in INTERACTION-AGGREGATION.md / the redesign summary).
  const effDue  = it => it.due_date_m || it.due_date_t || null;   // M/T-aware effective due date
  const effDate = it => +new Date(effDue(it) || it.created_at || 0);
  const lessons = (interRaw || []).slice().sort((a, b) => effDate(a) - effDate(b)).map(it => {
    const num = lessonNumber(it.id, it.title);
    return { id: it.id, title: it.title, due_date: effDue(it),
      num, short: num != null ? String(num).padStart(2, '0') : null };
  });
  // Fill a short label for un-numbered lessons from their position so chips never read blank.
  lessons.forEach((l, i) => { if (l.short == null) l.short = String(i + 1).padStart(2, '0'); });

  let activeId = null;
  if (lessons.length) {
    const now = Date.now();
    const withDue = lessons.filter(l => l.due_date);
    if (withDue.length) {
      const upcoming = withDue.filter(l => +new Date(l.due_date) >= now);
      activeId = upcoming.length
        ? upcoming[0].id                                                   // earliest still-upcoming = next due
        : withDue[withDue.length - 1].id;                                  // all past → most recent
    } else {
      activeId = lessons[lessons.length - 1].id;                           // no due dates → newest
    }
  }

  // 4) Per-student report rows for every published lesson, grouped by lesson then tagged with the
  //    student's section. RLS scopes which rows actually return; we ask for the in-scope roster.
  const rowsByLesson = {};
  await Promise.all(lessons.map(async (l) => {
    const rows = await loadInteractionData(l.id, studentIds);
    rowsByLesson[l.id] = rows.map(r => ({
      student_id: r.student_id, sectionId: sectionOf[r.student_id],
      effort: r.effort, score: r.score, report_data: r.report_data,
    })).filter(r => r.sectionId);   // drop any row whose student isn't in the in-scope roster
  }));

  return {
    noCourse: false, noSections: false, isDirector,
    courseTitle: ctx.courseTitleOf(course),
    myName: ctx.instructorRow?.name || '',
    sections: sections.map(s => ({
      id: s.id, instructorName: instrName[s.instructor_id] || null,
      isMine: s.instructor_id === myId, n: sectionSize[s.id] || 0,
    })),
    lessons, activeId, rowsByLesson, sectionSize,
    counts: { sections: sections.length, students: students.length, lessons: lessons.length },
  };
}

/**
 * Interaction-completion roll-up for the faculty interactions page: per published
 * interaction, completion broken down by covered section, plus section rosters (with
 * student names) for the per-student report viewer.
 */
export async function loadFacultyInteractions(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true };
  const isDirector = ctx.isDirectorForCurrent();

  let secQuery = db.from('sections').select('id, instructor_id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', ctx.instructorRow.id);
  const { data: sectionRows } = await secQuery;
  const sections = sectionRows || [];
  if (!sections.length) return { noCourse: false, noSections: true };
  const sectionIds = sections.map(s => s.id);

  const [{ data: studentsRaw }, { data: interRaw }] = await Promise.all([
    db.from('students').select('student_id, name, section_id').in('section_id', sectionIds).order('name'),
    db.from('interactions').select('id, title, description').eq('course_id', course).eq('is_published', true).order('title'),
  ]);
  const students = studentsRaw || [];
  const interactions = interRaw || [];
  const studentIds = students.map(s => s.student_id);
  const sectionOf = Object.fromEntries(students.map(s => [s.student_id, s.section_id]));

  const reports = await reportsByStudent(studentIds);
  const interIds = new Set(interactions.map(i => i.id));
  // (interactionId, sectionId) -> count done
  const doneKey = {};
  reports.forEach(r => {
    if (!interIds.has(r.interaction_id)) return;
    const sec = sectionOf[r.student_id]; if (!sec) return;
    doneKey[`${r.interaction_id}|${sec}`] = (doneKey[`${r.interaction_id}|${sec}`] || 0) + 1;
  });

  const sectionSize = {};
  sectionIds.forEach(id => sectionSize[id] = 0);
  students.forEach(s => { if (sectionSize[s.section_id] != null) sectionSize[s.section_id]++; });

  const interactionCards = interactions.map(it => {
    let done = 0, total = 0;
    const perSection = sections.map(sec => {
      const d = doneKey[`${it.id}|${sec.id}`] || 0;
      const n = sectionSize[sec.id] || 0;
      done += d; total += n;
      return { sectionId: sec.id, done: d, total: n };
    });
    return { ...it, perSection, done, total };
  });

  const sectionRosters = sections.map(sec => ({
    id: sec.id,
    students: students.filter(s => s.section_id === sec.id).map(s => ({ student_id: s.student_id, name: s.name })),
  }));

  return { noCourse: false, noSections: false, courseTitle: ctx.courseTitleOf(course),
    interactions: interactionCards, sections: sectionRosters };
}
