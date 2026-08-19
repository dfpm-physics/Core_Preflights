// faculty-data.js — per-section roll-up for the faculty dashboard, against schema `app`.
//
// WHAT MOVED
//   sections.instructor_id       ->  staff_assignments (resolved into ctx.sectionIds by auth.js)
//   interactions (own table)     ->  activities with modality='interactive'
//   preflight_interaction_reports->  submission_activities
//   due_date_m / due_date_t      ->  assignment_offerings.due_at + assignment_due_dates
//
// THE BIG SIMPLIFICATION: the legacy dashboard fetched every published interaction and then
// issued one report query PER LESSON (loadInteractionData in a Promise.all over lessons) —
// N+1 by construction, and the reason the page slowed as the term went on. The v2 model
// reaches everything through the offering, so the query count is fixed regardless of how many
// lessons exist.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT,
  shapeOffering, shapeOfferings, withResolvedDue, offeringSections,
  shapeSubmission, effectiveDue, deriveStatus, lessonNumber, chunked, fetchAll,
  effortSignal, writtenSignals,
} from './schema.js';

// Only the three columns a deadline needs. Deliberately not schema.js's EXTENSION_SELECT, which
// carries the grant/revocation provenance the extensions REPORT is about; a status calculation
// needs the date and nothing else. Same shape faculty-gradebook.js fetches, for the same reason.
const DASH_EXTENSION_SELECT = 'enrollment_id,assignment_offering_id,extended_due_at';

const rowKey = (enrollmentId, offeringId) => `${enrollmentId}|${offeringId}`;

/**
 * The dashboard's per-lesson rows.
 *
 * Pure, and separated from the loader for one reason: the deadline rule below was wrong for
 * months and nothing could catch it. `effectiveDue` was called with the extension argument
 * hardcoded `null`, so a student holding an active extension was reported `overdue` — on the
 * dashboard, in the outstanding-tasks panel, and in the due-out row — for work that was not
 * late. faculty-grade.js and faculty-gradebook.js both did it correctly; this was the one
 * caller that did not, and faculty-gradebook.js's header says so as its reason for not reusing
 * this loader. Extracting it is what lets a test pin the rule without a database.
 *
 * `extensions` must already be filtered to non-revoked rows — same contract as effectiveDue().
 *
 * @param {object[]} submissions  shapeSubmission() results
 * @param {object[]} lessons      the ordered lesson list (each with .offeringId)
 * @param {object[]} offerings    shapeOffering() results
 * @param {object[]} grades       raw grades rows
 * @param {object[]} extensions   ACTIVE extension rows
 * @param {Record<string,string>} sectionOf  enrollment id -> section id (in-scope roster only)
 * @param {Record<string,number>} studentOf  enrollment id -> registrar student id
 * @param {Date} [now]  injected so tests are not clock-dependent
 * @returns {Record<string, object[]>} rows keyed by offering id
 */
export function buildLessonRows({ submissions, lessons, offerings, grades, extensions,
                                  sectionOf, studentOf, now = new Date() }) {
  const gradeBy = new Map((grades || [])
    .map(g => [rowKey(g.enrollment_id, g.assignment_offering_id), g]));
  const extBy = new Map((extensions || [])
    .map(x => [rowKey(x.enrollment_id, x.assignment_offering_id), x.extended_due_at]));
  const offeringById = Object.fromEntries((offerings || []).map(o => [o.offeringId, o]));

  const rowsByLesson = {};
  (lessons || []).forEach(l => { rowsByLesson[l.offeringId] = []; });

  (submissions || []).forEach(s => {
    const bucket = rowsByLesson[s.offeringId];
    if (!bucket) return;                       // a submission for an unpublished offering
    const sectionId = sectionOf[s.enrollmentId];
    if (!sectionId) return;                    // outside the in-scope roster
    const offering = offeringById[s.offeringId];
    const grade = gradeBy.get(rowKey(s.enrollmentId, s.offeringId)) || null;
    const extensionISO = extBy.get(rowKey(s.enrollmentId, s.offeringId)) || null;
    const { isPast } = effectiveDue(offering, sectionId, extensionISO, now);

    // The interactive report's schema:1 payload — where the artifact's claimed effort lives (a
    // student cannot write a grades row, so the receiver stores it on the submission).
    const interactiveWork = offering?.interactive ? s.activities?.[offering.interactive.id] : null;
    const writtenWork     = offering?.written     ? s.activities?.[offering.written.id]     : null;
    const reportData = interactiveWork?.content || null;

    // Effort resolves the same way for both paths — grade, then the analysis diagnostic
    // (`q2_effort`, the only place a written preflight's effort exists), then the artifact's
    // claim. Before this, a written student's effort was always null: they scored nothing in
    // `grades.effort` and had no report_data, so they fell into "not assessed" and vanished
    // from the effort tile, the histogram and every section average.
    const { effort, source: effortSource } = effortSignal(grade, reportData);
    const { understanding: frUnderstanding } = writtenSignals(grade);

    bucket.push({
      student_id: studentOf[s.enrollmentId],
      enrollmentId: s.enrollmentId,
      sectionId,
      status: deriveStatus({ submission: s, grade, isPast }),
      chosenModality: offering?.activities.find(a => a.id === s.chosenActivityId)?.modality || null,
      effort,
      effortSource,
      points: grade?.points_earned == null ? null : Number(grade.points_earned),
      isFinalized: !!grade?.is_finalized,
      report_data: reportData,
      // Free-response understanding, present only when they answered the questions.
      understanding: writtenWork ? frUnderstanding : null,
      hasReport: !!interactiveWork,
      hasWritten: !!writtenWork,
      // Which path this student actually took, independent of what the offering allows.
      workedPath: interactiveWork && writtenWork ? 'both'
                : interactiveWork ? 'interactive'
                : writtenWork ? 'written' : null,
    });
  });

  return rowsByLesson;
}

/**
 * The lesson the dashboard opens on — the MOST RECENTLY DUE one, not the next one due.
 *
 * A preflight is due the night before its lesson, and one offering carries two deadlines: the
 * M-day sections' and the T-day sections' (`due_at` is the earlier of the two, so it is the
 * M-day one). Picking the next deadline still ahead of us therefore skipped past the lesson
 * being taught the moment its M deadline passed — at 2359 the night before the M-day class,
 * every instructor's dashboard jumped to the NEXT lesson, and both days' classes were then
 * taught with the following lesson's near-empty numbers on screen. Reported 2026-08-10, on the
 * morning of L2's M-day, with the dashboard showing L3.
 *
 * The last deadline already behind us names the lesson in class now, on both tracks, because the
 * deadlines interleave: L2's M deadline passes the night before L2's M class and stays the most
 * recent one through L2's T class the next day, since the next deadline (L3's M) does not pass
 * until that evening. So an M instructor, a T instructor and someone teaching both all see the
 * lesson they are actually walking into. The lookahead arrows and the "↩ Today" pill still reach
 * everything else.
 *
 * Before the term's first deadline nothing is behind us, so it falls back to the first lesson
 * due — otherwise week one would open on an empty page.
 *
 * @param {Array<{offeringId: string, due: ?string}>} lessons  ordered by deadline, ascending
 * @param {Date} [now]  injected so tests are not clock-dependent
 * @returns {string|null} the offering id, or null when there are no lessons
 */
export function activeLessonId(lessons, now = new Date()) {
  if (!lessons || !lessons.length) return null;
  const withDue = lessons.filter(l => l.due);
  if (!withDue.length) return lessons[lessons.length - 1].offeringId;
  const t = +now;
  const past = withDue.filter(l => +new Date(l.due) <= t);
  return past.length ? past[past.length - 1].offeringId : withDue[0].offeringId;
}

/**
 * Just-in-Time-Teaching dashboard model.
 *
 * @returns {{
 *   noCourse?, noSections?, isDirector, courseTitle, myName,
 *   sections: Array<{id, code, instructorName, isMine, n}>,
 *   lessons:  Array<{offeringId, slug, title, due, num, short}>,   // published, due asc
 *   activeId: string|null,                                         // see activeLessonId()
 *   rowsByLesson: Record<string, Array<{student_id, sectionId, status, effort, report_data}>>,
 *   sectionSize: Record<string, number>,
 *   counts: { sections, students, lessons },
 * }}
 */
export async function loadFacultyDashboard(ctx) {
  if (!ctx.currentOffering) return { noCourse: true };

  const isDirector = ctx.isDirectorForCurrent();
  const courseTitle = ctx.courseTitleOf(ctx.currentOffering);

  // 1) Sections in scope. auth.js already mirrored staff_sections(), so this is a lookup,
  //    not a second authorization decision.
  const sectionIds = ctx.sectionIds || [];
  if (!sectionIds.length) {
    return { noCourse: false, isDirector, noSections: true, courseTitle };
  }

  // 2) Roster, published offerings, and staffing — in parallel.
  const [{ data: enrolRows }, { data: offeringRows }, { data: staffRows }] = await Promise.all([
    db.from('enrollments')
      .select('id, student_id, section_id, status')
      .in('section_id', sectionIds).eq('status', 'active'),
    db.from('assignment_offerings')
      .select(OFFERING_SELECT)
      .eq('course_offering_id', ctx.currentOffering).eq('is_published', true)
      .order('position', { ascending: true, nullsFirst: false }),
    db.from('staff_assignments')
      .select('instructor_id, section_id, role, instructors(id, name)')
      .eq('course_offering_id', ctx.currentOffering),
  ]);

  const enrollments = enrolRows || [];
  const enrollmentIds = enrollments.map(e => e.id);
  const sectionOf = Object.fromEntries(enrollments.map(e => [e.id, e.section_id]));
  const studentOf = Object.fromEntries(enrollments.map(e => [e.id, e.student_id]));

  const instrName = {};
  (staffRows || []).filter(s => s.section_id).forEach(s => {
    instrName[s.section_id] = s.instructors?.name || null;
  });
  const myId = ctx.instructorRow?.id;
  const mySections = new Set((staffRows || [])
    .filter(s => s.instructor_id === myId && s.section_id).map(s => s.section_id));

  const sectionSize = {};
  sectionIds.forEach(id => { sectionSize[id] = 0; });
  enrollments.forEach(e => { if (sectionSize[e.section_id] != null) sectionSize[e.section_id]++; });

  // 3) The lesson sequence, ordered by the deadline that actually applies. Section overrides
  //    differ per section, so the dashboard orders by the offering's own due_at — the one
  //    date that is the same for everyone looking at this list.
  const offerings = shapeOfferings(offeringRows, ctx);
  const lessons = offerings
    .slice()
    .sort((a, b) => {
      const da = a.dueAt ? +new Date(a.dueAt) : Infinity;
      const dbb = b.dueAt ? +new Date(b.dueAt) : Infinity;
      return da - dbb || (a.position ?? 0) - (b.position ?? 0);
    })
    .map(o => {
      const num = lessonNumber(o.slug, o.title);
      return {
        // `id` and `due_date` are the names the dashboard view uses as its lesson key and
        // deadline. Kept as aliases rather than renamed through the view: the identity of a
        // "lesson" on this page IS its assignment offering, so the alias is accurate, and
        // leaving it lets the view stay untouched by the schema move.
        id: o.offeringId,
        due_date: o.dueAt,
        // The per-day schedule, carried through so the card can show BOTH tracks' deadlines.
        // `due_date` above is the offering default, which is the earliest per-day value — the
        // M-day date on every Fall 2026 row. See dueDayDates() in schema.js.
        dueByDay: o.dueByDay,
        offeringId: o.offeringId, slug: o.slug, title: o.title,
        due: o.dueAt, num,
        short: num != null ? String(num).padStart(2, '0') : null,
        hasInteractive: !!o.interactive,
        pointsPossible: o.pointsPossible,
      };
    });
  lessons.forEach((l, i) => { if (l.short == null) l.short = String(i + 1).padStart(2, '0'); });

  const activeId = activeLessonId(lessons);

  // 4) All work, grades and extensions for the in-scope roster, in one pass each. Chunked so the
  //    .in() URL stays under GET length limits on a large course.
  const submissions = [], grades = [], extensions = [];
  for (const ids of chunked(enrollmentIds)) {
    const [s, g, x] = await Promise.all([
      fetchAll(() => db.from('submissions').select(SUBMISSION_SELECT).in('enrollment_id', ids)),
      fetchAll(() => db.from('grades').select(GRADE_SELECT).in('enrollment_id', ids)),
      // A revoked extension is not an extension — the row survives revocation so the director's
      // report can still count it, so the filter is the caller's job. See effectiveDue().
      fetchAll(() => db.from('extensions').select(DASH_EXTENSION_SELECT).in('enrollment_id', ids)
        .is('revoked_at', null)),
    ]);
    submissions.push(...(s.data || []).map(shapeSubmission));
    grades.push(...(g.data || []));
    extensions.push(...(x.data || []));
  }

  // 5) Group per lesson, tagged with the student's section — the shape the view aggregates.
  const rowsByLesson = buildLessonRows({
    submissions, lessons, offerings, grades, extensions, sectionOf, studentOf,
  });

  return {
    noCourse: false, noSections: false, isDirector,
    courseTitle,
    myName: ctx.instructorRow?.name || '',
    sections: sectionIds.map(id => ({
      id,
      code: ctx.sectionsById?.[id]?.code || id,
      instructorName: instrName[id] || null,
      isMine: mySections.has(id),
      n: sectionSize[id] || 0,
    })),
    lessons, activeId, rowsByLesson, sectionSize,
    counts: { sections: sectionIds.length, students: enrollments.length, lessons: lessons.length },
  };
}

/**
 * Completion roll-up for the faculty interactions page: per published lesson that HAS an
 * interactive activity, completion broken down by section, plus section rosters for the
 * per-student report viewer.
 *
 * Built from the same dashboard load rather than re-querying, so the two surfaces cannot
 * disagree about who has completed what.
 */
export async function loadFacultyInteractions(ctx) {
  const model = await loadFacultyDashboard(ctx);
  if (model.noCourse || model.noSections) return model;

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', ctx.sectionIds).eq('status', 'active');

  const sectionRosters = model.sections.map(sec => ({
    id: sec.id,
    code: sec.code,
    students: (enrolRows || [])
      .filter(e => e.section_id === sec.id)
      .map(e => ({ student_id: e.student_id, name: e.students?.name || String(e.student_id),
                   enrollment_id: e.id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  const interactionCards = model.lessons.filter(l => l.hasInteractive).map(l => {
    const rows = model.rowsByLesson[l.offeringId] || [];
    let done = 0, total = 0;
    const perSection = model.sections.map(sec => {
      const d = rows.filter(r => r.sectionId === sec.id && r.hasReport).length;
      const n = model.sectionSize[sec.id] || 0;
      done += d; total += n;
      return { sectionId: sec.id, code: sec.code, done: d, total: n };
    });
    return { ...l, perSection, done, total };
  });

  return {
    noCourse: false, noSections: false,
    courseTitle: model.courseTitle,
    interactions: interactionCards,
    sections: sectionRosters,
  };
}

/**
 * Per-student rows for one lesson — the report viewer. Returns the stored schema:1 payload
 * and markdown for each student who engaged with the interactive activity.
 */
export async function loadInteractionData(ctx, offeringId) {
  const { data: offeringRow } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = withResolvedDue(shapeOffering(offeringRow), offeringSections(ctx));
  if (!offering?.interactive) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', ctx.sectionIds).eq('status', 'active');
  const enrollments = enrolRows || [];
  const byId = Object.fromEntries(enrollments.map(e => [e.id, e]));

  const out = [];
  for (const ids of chunked(enrollments.map(e => e.id))) {
    const { data } = await db.from('submissions')
      .select(SUBMISSION_SELECT).eq('assignment_offering_id', offeringId).in('enrollment_id', ids);
    (data || []).map(shapeSubmission).forEach(s => {
      const work = s.activities?.[offering.interactive.id];
      if (!work) return;
      const e = byId[s.enrollmentId];
      out.push({
        student_id: e?.student_id,
        name: e?.students?.name,
        sectionId: e?.section_id,
        report_data: work.content || null,
        report_markdown: work.reportMarkdown || null,
        effort: Number.isInteger(work.content?.effort) ? work.content.effort : null,
        updated_at: work.updatedAt,
      });
    });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Cohort AI panels for one lesson, written by the analysis workflows. */
export async function loadAnalysisReports(ctx, offeringId) {
  const { data } = await db.from('analysis_reports')
    .select('id, scope, scope_id, audience_id, kind, payload, generated_at')
    .eq('scope', 'assignment_offering').eq('scope_id', offeringId);
  return data || [];
}
