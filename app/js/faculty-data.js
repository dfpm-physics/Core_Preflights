// faculty-data.js — per-section roll-up for the faculty dashboard, scoped to the
// instructor's current course. Uses only existing tables. Section scoping mirrors the
// legacy admin.html (client-side): directors/admins see all sections in the course,
// instructors see only the sections they teach. (RLS is permissive — see plan notes.)

import { db } from './supabase.js';

const CHUNK = 300; // keep .in() URLs under GET length limits for large courses

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

export async function loadFacultyDashboard(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true };

  const isDirector = ctx.isDirectorForCurrent();
  const myId = ctx.instructorRow.id;

  // 1) Sections in scope. Directors see every section in the course (split below into the
  //    ones they personally teach vs. everyone else's); instructors see only their own.
  let secQuery = db.from('sections').select('id, instructor_id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', myId);
  const { data: sectionRows } = await secQuery;
  const sections = sectionRows || [];
  if (!sections.length) return { noCourse: false, isDirector, noSections: true };

  const sectionIds = sections.map(s => s.id);

  // 2) Roster + published interactions (parallel). Preflight assignments are intentionally
  //    excluded — the dashboard roll-up is interactions-only (see app/PLAN-2026-06-22.md).
  const [{ data: studentsRaw }, { data: interRaw }] = await Promise.all([
    db.from('students').select('student_id, name, section_id').in('section_id', sectionIds),
    db.from('interactions').select('id, title').eq('course_id', course).eq('is_published', true).order('title'),
  ]);

  const students = studentsRaw || [];
  const interactions = interRaw || [];
  const studentIds = students.map(s => s.student_id);

  // Instructor names for section labels (directors view shows who teaches each section)
  let instrName = {};
  const instrIds = [...new Set(sections.map(s => s.instructor_id).filter(Boolean))];
  if (instrIds.length) {
    const { data: instrs } = await db.from('instructors').select('id, name').in('id', instrIds);
    instrName = Object.fromEntries((instrs || []).map(i => [i.id, i.name]));
  }

  // 3) Interaction reports → studentId -> Set(published interactionId)
  const reports = await reportsByStudent(studentIds);
  const interIds = new Set(interactions.map(i => i.id));
  const reportsOf = {};
  reports.forEach(r => {
    if (!interIds.has(r.interaction_id)) return;
    (reportsOf[r.student_id] ||= new Set()).add(r.interaction_id);
  });

  // 4) Per-section aggregation (pure JS, no extra queries)
  const studentsBySection = {};
  sectionIds.forEach(id => studentsBySection[id] = []);
  students.forEach(s => studentsBySection[s.section_id]?.push(s.student_id));

  let totInterDone = 0, totInterPossible = 0;

  const buildCard = (sec) => {
    const roster = studentsBySection[sec.id] || [];
    const n = roster.length;
    // Per published interaction: how many of this section's students submitted a report.
    const perInteraction = interactions.map(it => {
      const done = roster.filter(id => reportsOf[id]?.has(it.id)).length;
      totInterDone += done; totInterPossible += n;
      return { id: it.id, title: it.title, done, total: n };
    });
    const interDone = perInteraction.reduce((sum, it) => sum + it.done, 0);
    return {
      id: sec.id,
      instructorName: instrName[sec.instructor_id] || null,
      isMine: sec.instructor_id === myId,
      studentCount: n,
      perInteraction,
      interaction: { done: interDone, total: n * interactions.length },
    };
  };

  const sectionCards = sections.map(buildCard);
  const mySections = sectionCards.filter(c => c.isMine);
  const otherSections = isDirector ? sectionCards.filter(c => !c.isMine) : [];

  return {
    noCourse: false, noSections: false, isDirector,
    courseTitle: ctx.courseTitleOf(course),
    totals: {
      sections: sections.length,
      students: students.length,
      lessonsPublished: interactions.length,
      interactionsPct: totInterPossible ? Math.round((totInterDone / totInterPossible) * 100) : 0,
    },
    interactions, sections: sectionCards, mySections, otherSections,
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
