// faculty-interactions.js — MONITORING ONLY. Read-side data layer for the interactions page.
//
// ── THERE IS NO AUTHORING HERE, AND THERE CANNOT BE ─────────────────────────────────
// Everything this page used to create, edit, publish and delete now belongs to an assignment
// or its offering, i.e. to the lesson builder (faculty/lessons.html + faculty-lessons.js).
// This is a property of the model, not a division of labour we chose:
//
//   * `activities.assignment_id` is NOT NULL — a standalone interaction cannot exist. Every
//     interactive artifact is an activity INSIDE an assignment container.
//   * publishing is `assignment_offerings.is_published`, which covers the whole assignment for
//     one term. There is no per-interaction publish flag to toggle.
//   * graded-vs-practice is `offering_activities.grading_role` — a per-term delivery decision.
//   * deadlines are `assignment_offerings.due_at` + `assignment_due_dates`.
//
// So do not add save/publish/delete back here: each one would write a row owned by the lesson,
// and two pages writing the same rows is how the old three-places-to-publish bug happened.
// Authoring lives in ONE place now. This module reads.
//
// WHAT REMAINS: completion tracking per lesson × section, the per-student report viewer, and the
// cohort AI panels — three things that still have no other home.
//
// WHAT MOVED
//   interactions (own table)      ->  activities WHERE modality='interactive'
//   interactions.artifact_url     ->  activities.content.artifact_url
//   interactions.is_published     ->  assignment_offerings.is_published  (per TERM, not per artifact)
//   interactions.due_date_m/_t    ->  assignment_offerings.due_at + assignment_due_dates
//   preflight_interaction_reports ->  submission_activities (content = schema:1, report_markdown)
//   …reports.effort / .score      ->  grades.effort / grades.points_earned
//   interaction_analysis          ->  analysis_reports (scope='assignment_offering')
//
// ── WHAT A DIRECTOR NOTICES ─────────────────────────────────────────────────────────
//
// THERE IS NO STANDALONE INTERACTION ANY MORE. An interactive artifact is an ACTIVITY inside
// an assignment container, scheduled into a term by an offering. So this page manages the
// interactive activity of each scheduled lesson, and "new interaction" creates the whole
// three-row chain (assignment -> activity -> offering + offering_activity) rather than one row.
// That is not ceremony: it is what gives the artifact a deadline, a point value, and a term.
//
// THE IDENTITY OF A CARD IS THE OFFERING, NOT THE SLUG. `it.id` below is an
// assignment_offering uuid. The artifact's `#i=` slug still exists and is still frozen — it is
// `activities.slug`, surfaced as `it.slug` — but it is no longer the key the page keys on,
// because the same artifact can now run in more than one term.
//
// PUBLISH IS PER TERM. Unpublishing here retires this term's run; it cannot reach the library
// content, which is the bug the old three-places-to-publish arrangement kept producing.
//
// ── API COMPATIBILITY ───────────────────────────────────────────────────────────────
// site/app/faculty/report.html imports this module and calls loadManager, loadInteractionData,
// loadAnalysis, summarizeReports, loadReport and buildLessonCorpus. Those names and their
// argument shapes are preserved deliberately: the interaction key each takes is now an offering
// uuid instead of a slug, but it stays an opaque string that this module mints and consumes, so
// report.html did not have to change to keep working.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT,
  shapeOffering, shapeSubmission, artifactUrlOf, chunked,
} from './schema.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Listing
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Every scheduled lesson in ctx.currentOffering that HAS an interactive activity, with
 * completion broken down by section, plus the section rosters the report viewer needs.
 *
 * Scope comes from ctx.sectionIds, which auth.js resolved from staff_sections() — the same
 * predicate RLS uses. The legacy version re-derived scope here by querying
 * sections.instructor_id, a column that no longer exists and a second authorization decision
 * that could disagree with the first.
 *
 * @returns {{ noCourse?, interactions:[…], sections:[{id, code, students:[…]}] }}
 */
export async function loadManager(ctx) {
  const empty = { noCourse: true, interactions: [], sections: [] };
  if (!ctx.currentOffering) return empty;
  const isDirector = ctx.isDirectorForCurrent();
  const sectionIds = ctx.sectionIds || [];

  let offeringQ = db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('course_offering_id', ctx.currentOffering)
    .order('position', { ascending: true, nullsFirst: false });
  if (!isDirector) offeringQ = offeringQ.eq('is_published', true);

  const [{ data: offeringRows }, { data: enrolRows }] = await Promise.all([
    offeringQ,
    sectionIds.length
      ? db.from('enrollments')
          .select('id, student_id, section_id, students!inner(student_id, name)')
          .in('section_id', sectionIds).eq('status', 'active')
      : Promise.resolve({ data: [] }),
  ]);

  const offerings = (offeringRows || []).map(shapeOffering).filter(Boolean)
    .filter(o => o.interactive);                 // this page is only about interactive work

  const enrolments = enrolRows || [];
  const studentOf = Object.fromEntries(enrolments.map(e => [e.id, e.student_id]));
  const sectionOf = Object.fromEntries(enrolments.map(e => [e.id, e.section_id]));

  const sectionSize = {};
  sectionIds.forEach(id => { sectionSize[id] = 0; });
  enrolments.forEach(e => { if (sectionSize[e.section_id] != null) sectionSize[e.section_id]++; });

  // ONE query for every submission in scope, not one per lesson. The legacy page issued a
  // report query per interaction inside a Promise.all — N+1 by construction, and the reason
  // it slowed as the term filled up. Everything reaches through the offering now.
  const submissions = [];
  for (const ids of chunked(enrolments.map(e => e.id))) {
    const { data } = await db.from('submissions').select(SUBMISSION_SELECT).in('enrollment_id', ids);
    submissions.push(...(data || []).map(shapeSubmission));
  }

  // "Done" = a submission_activities row exists for that lesson's interactive activity, which
  // is the direct successor of "a preflight_interaction_reports row exists".
  const doneByOffering = {};      // offeringId -> Set(student_id)
  const doneKey = {};             // `${offeringId}|${sectionId}` -> count
  const interactiveOf = Object.fromEntries(offerings.map(o => [o.offeringId, o.interactive.id]));
  submissions.forEach(s => {
    const actId = interactiveOf[s.offeringId];
    if (!actId || !s.activities?.[actId]) return;
    const sid = studentOf[s.enrollmentId], sec = sectionOf[s.enrollmentId];
    if (sid == null) return;
    (doneByOffering[s.offeringId] ||= new Set()).add(sid);
    if (sec) doneKey[`${s.offeringId}|${sec}`] = (doneKey[`${s.offeringId}|${sec}`] || 0) + 1;
  });

  const interactions = offerings.map(o => {
    let done = 0, total = 0;
    const perSection = sectionIds.map(secId => {
      const d = doneKey[`${o.offeringId}|${secId}`] || 0, n = sectionSize[secId] || 0;
      done += d; total += n;
      return { sectionId: secId, code: ctx.sectionCodeOf(secId), done: d, total: n };
    });
    return {
      id: o.offeringId,                        // the page's key — see the header note
      offeringId: o.offeringId,
      assignmentId: o.assignmentId,
      activityId: o.interactive.id,
      slug: o.interactive.slug,                // the FROZEN artifact `#i=` slug
      assignmentSlug: o.slug,
      title: o.interactive.title || o.title,
      description: o.interactive.content?.description || o.description || null,
      artifact_url: artifactUrlOf(o.interactive),
      is_published: o.isPublished,
      gradingRole: o.interactive.gradingRole,  // graded here, or practice beside the questions
      pointsPossible: o.pointsPossible,
      due_at: o.dueAt,
      dueBySection: o.dueBySection,
      hasWritten: !!o.written,
      isChoice: o.isChoice,
      count: (doneByOffering[o.offeringId] || new Set()).size,
      perSection, done, total,
      doneStudentIds: [...(doneByOffering[o.offeringId] || [])],
    };
  });

  const sections = sectionIds.map(id => ({
    id,
    code: ctx.sectionCodeOf(id),
    students: enrolments.filter(e => e.section_id === id)
      .map(e => ({ student_id: e.student_id, name: e.students?.name || String(e.student_id),
                   enrollment_id: e.id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }));

  return { noCourse: false, interactions, sections };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * Authoring — deliberately absent
 * ═════════════════════════════════════════════════════════════════════════════ */
// saveInteraction / togglePublish / deleteInteraction used to live here. They are gone, not
// pending — see the header. Each wrote a row (assignments, activities, assignment_offerings,
// offering_activities) that the lesson builder owns, and a standalone interaction is not
// expressible at all now that activities.assignment_id is NOT NULL. Edit an artifact, its
// deadline, its point value, or whether it carries credit in faculty/lessons.html.

/* ══════════════════════════════════════════════════════════════════════════════
 * Report data
 * ════════════════════════════════════════════════════════════════════════════ */

/** The interactive activity id for one offering, or null. Small helper used by every read below. */
async function interactiveActivityOf(offeringId) {
  const { data } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = shapeOffering(data);
  return offering?.interactive ? { offering, activityId: offering.interactive.id } : null;
}

/** One student's report markdown for a lesson (the caller sanitizes before rendering — the
 *  payload originated in a URL hash and is stored inert, per INTERACTION-DATA-CONTRACT.md). */
export async function loadReport(offeringId, studentId) {
  const found = await interactiveActivityOf(offeringId);
  if (!found) return null;

  const { data: enrol } = await db.from('enrollments')
    .select('id').eq('student_id', studentId);
  const enrolIds = (enrol || []).map(e => e.id);
  if (!enrolIds.length) return null;

  const { data: subs } = await db.from('submissions')
    .select('id').eq('assignment_offering_id', offeringId).in('enrollment_id', enrolIds);
  const subIds = (subs || []).map(s => s.id);
  if (!subIds.length) return null;

  const { data } = await db.from('submission_activities')
    .select('report_markdown').eq('activity_id', found.activityId).in('submission_id', subIds)
    .maybeSingle();
  return data?.report_markdown || null;
}

/**
 * The graded columns + structured blob for every in-scope report of one lesson.
 *
 * Where the numbers now live is the substantive change. `preflight_interaction_reports` carried
 * effort and score ON the report row, so a student's write set their own grade. In v2 a student
 * can only write `submission_activities`, and effort/points live in `grades`, which students
 * cannot write at all. So effort is read from the grade first and falls back to the schema:1
 * payload the artifact sent — which is a claim, not a grade, until a grader confirms it.
 *
 * RLS scopes which rows come back, so passing the full roster's ids is safe.
 * @returns {Promise<Array<{student_id, effort, score, report_data, report_markdown, updated_at}>>}
 */
export async function loadInteractionData(offeringId, studentIds) {
  if (!studentIds?.length) return [];
  const found = await interactiveActivityOf(offeringId);
  if (!found) return [];

  const enrolments = [];
  for (const ids of chunked(studentIds)) {
    const { data } = await db.from('enrollments')
      .select('id, student_id, section_id').in('student_id', ids).eq('status', 'active');
    enrolments.push(...(data || []));
  }
  if (!enrolments.length) return [];
  const studentOf = Object.fromEntries(enrolments.map(e => [e.id, e.student_id]));

  const submissions = [], grades = [];
  for (const ids of chunked(enrolments.map(e => e.id))) {
    const [s, g] = await Promise.all([
      db.from('submissions').select(SUBMISSION_SELECT)
        .eq('assignment_offering_id', offeringId).in('enrollment_id', ids),
      db.from('grades').select(GRADE_SELECT)
        .eq('assignment_offering_id', offeringId).in('enrollment_id', ids),
    ]);
    submissions.push(...(s.data || []).map(shapeSubmission));
    grades.push(...(g.data || []));
  }
  const gradeBy = Object.fromEntries(grades.map(g => [g.enrollment_id, g]));

  const out = [];
  submissions.forEach(s => {
    const work = s.activities?.[found.activityId];
    if (!work) return;
    const grade = gradeBy[s.enrollmentId] || null;
    const claimed = Number.isInteger(work.content?.effort) ? work.content.effort : null;
    out.push({
      student_id: studentOf[s.enrollmentId],
      enrollment_id: s.enrollmentId,
      effort: grade?.effort ?? claimed,
      score: grade?.points_earned == null ? null : Number(grade.points_earned),
      report_data: work.content || null,
      report_markdown: work.reportMarkdown || null,
      updated_at: work.updatedAt,
    });
  });
  return out;
}

/**
 * Cohort AI synthesis for one lesson — the free-text panels the rollup shows as placeholders
 * until the /interaction-aggregate skill has run: readiness summary, misconception-trend prose,
 * showcase quotes. Numeric rollups stay computed live in the browser (summarizeReports).
 *
 * `interaction_analysis` (one row per section, with a '__all__' sentinel) collapsed into
 * `analysis_reports`, one generic table keyed by (scope, scope_id, audience_id, kind). The
 * per-section breakdown therefore rides INSIDE the payload rather than in the row key, and this
 * function flattens it back to the map the viewer expects.
 *
 * RLS still scopes the result: an instructor never receives a whole-course row, so their "All
 * sections" view falls back to the live placeholders instead of a cross-section summary.
 *
 * @returns {Promise<Record<string, {section_id, readiness_summary, misconception_trends, selected_quotes, meta, generated_at}>>}
 *   keyed by section id, with '__all__' for the whole-course row.
 */
export async function loadAnalysis(offeringId) {
  const { data } = await db.from('analysis_reports')
    .select('id, scope, scope_id, audience_id, kind, payload, generated_at')
    .eq('scope', 'assignment_offering').eq('scope_id', offeringId);

  const out = {};
  (data || []).forEach(row => {
    const p = row.payload || {};
    const panels = (obj, sectionId) => ({
      section_id: sectionId,
      readiness_summary: obj?.readiness_summary ?? null,
      misconception_trends: obj?.misconception_trends ?? null,
      selected_quotes: obj?.selected_quotes ?? null,
      meta: obj?.meta ?? null,
      generated_at: row.generated_at,
    });
    // Either one row carrying a by_section map, or a row that IS one scope's panels.
    if (p.by_section && typeof p.by_section === 'object') {
      Object.entries(p.by_section).forEach(([sid, obj]) => { out[sid] = panels(obj, sid); });
      if (p.readiness_summary || p.misconception_trends) out.__all__ = panels(p, '__all__');
    } else {
      const sid = p.section_id || '__all__';
      out[sid] = panels(p, sid);
    }
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Numeric rollup — PURE, unchanged by the migration
 * ════════════════════════════════════════════════════════════════════════════ */
// The website computes ALL numeric rollups from report_data without AI; the AI passes only
// ever read the free-text fields to produce aggregated trend prose. schema:1 is a FROZEN
// contract (docs/contracts/INTERACTION-DATA-CONTRACT.md), so the payload this folds over did
// not change shape when it moved from preflight_interaction_reports.report_data to
// submission_activities.content — and neither did any of the maths below.

// Defensive coercion — report_data is LLM-produced and occasionally imperfect (contract §7):
// keep only valid 0–5 ints; everything else becomes null and drops out of means.
const int05 = v => (Number.isInteger(v) && v >= 0 && v <= 5) ? v : null;
const num   = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const mean  = xs => { const a = xs.filter(n => n != null); return a.length ? a.reduce((s, n) => s + n, 0) / a.length : null; };

/** effort -> points, mirroring app.grades_points_from_effort(): 3–5 full, 1–2 half, 0/null zero. */
const pointsForEffort = (e, possible) =>
  e == null ? 0 : e >= 3 ? possible : e >= 1 ? Math.round((possible / 2) * 100) / 100 : 0;

/**
 * Numeric-only rollup over a set of interaction reports. Pure (no I/O).
 *
 * @param rows      loadInteractionData() output
 * @param possible  the offering's points_possible; defaults to 2, the preflight value the
 *                  legacy hardcoding assumed. Passing it makes the points total correct for a
 *                  lesson worth anything else — which the v2 model now allows per term.
 */
export function summarizeReports(rows, possible = 2) {
  const list = (rows || []).map(r => ({
    effort: int05(r?.effort),
    score:  num(r?.score),
    d:      (r?.report_data && typeof r.report_data === 'object') ? r.report_data : {},
  }));
  const n = list.length;

  // ── Effort & points (GRADED). The grade column is authoritative; fall back to the payload.
  const effortHist = [0, 0, 0, 0, 0, 0];
  let effortNA = 0;
  const efforts = [], points = [];
  list.forEach(({ effort, score, d }) => {
    const e = effort != null ? effort : int05(d.effort);
    if (e == null) effortNA++; else { effortHist[e]++; efforts.push(e); }
    points.push(score != null ? score : pointsForEffort(e, possible));
  });

  // ── Engagement metadata.
  const completed = list.filter(({ d }) => d.completed === true).length;
  const durations = list.map(({ d }) => typeof d.duration_min === 'number' ? d.duration_min : null);
  const messages  = list.map(({ d }) => Number.isInteger(d.message_count) ? d.message_count : null);

  // ── Understanding (DIAGNOSTIC — never contributes to points).
  const overall = list.map(({ d }) => int05(d.overall_understanding));
  const self    = list.map(({ d }) => int05(d.self_rated_understanding));
  const overallAvg = mean(overall), selfAvg = mean(self);
  const overallHist = [0, 0, 0, 0, 0, 0];
  overall.forEach(u => { if (u != null) overallHist[u]++; });

  // ── Objectives — group by key, average understanding/confidence + a 0–5 distribution.
  const objMap = {};
  list.forEach(({ d }) => (Array.isArray(d.objectives) ? d.objectives : []).forEach(o => {
    if (!o || typeof o !== 'object' || !o.key) return;
    const m = (objMap[o.key] ||= { key: o.key, label: o.label || o.key, u: [], c: [], hist: [0, 0, 0, 0, 0, 0] });
    if ((!m.label || m.label === m.key) && o.label) m.label = o.label;
    const u = int05(o.understanding); if (u != null) { m.u.push(u); m.hist[u]++; }
    const c = int05(o.confidence);    if (c != null) m.c.push(c);
  }));
  const objectives = Object.values(objMap)
    .map(m => ({ key: m.key, label: m.label, assessed: m.u.length, understanding: mean(m.u), confidence: mean(m.c), dist: m.hist }))
    .sort((a, b) => (a.understanding ?? 99) - (b.understanding ?? 99));   // weakest first

  // ── Misconceptions — count by id (the AI pass later clusters novel ones by description).
  const mcMap = {};
  list.forEach(({ d }) => (Array.isArray(d.misconceptions) ? d.misconceptions : []).forEach(mc => {
    if (!mc || typeof mc !== 'object' || !mc.id) return;
    const m = (mcMap[mc.id] ||= { id: mc.id, label: mc.label || mc.id, count: 0, major: 0 });
    if ((!m.label || m.label === m.id) && mc.label) m.label = mc.label;
    m.count++; if (mc.severity === 'major') m.major++;
  }));
  const misconceptions = Object.values(mcMap).sort((a, b) => b.count - a.count || b.major - a.major);

  // ── Reading reflection (DIAGNOSTIC + the effort gate).
  let reflMeaningful = 0, reflAssessed = 0;
  const reflEng = [];
  const sentiment = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  const topicMap = {};
  list.forEach(({ d }) => {
    const r = d.reading_reflection;
    if (!r || typeof r !== 'object') return;
    if (typeof r.meaningful === 'boolean') { reflAssessed++; if (r.meaningful) reflMeaningful++; }
    const e = int05(r.engagement); if (e != null) reflEng.push(e);
    if (r.sentiment in sentiment) sentiment[r.sentiment]++;
    (Array.isArray(r.topics) ? r.topics : []).forEach(t => {
      const k = String(t || '').trim().toLowerCase(); if (k) topicMap[k] = (topicMap[k] || 0) + 1;
    });
  });
  const topics = Object.entries(topicMap).map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  // ── Integrity + triage flags.
  const honor = { none: 0, disclosed: 0, concern: 0 };
  list.forEach(({ d }) => { const s = d.honor?.status; if (s in honor) honor[s]++; });
  const flags = { needs_follow_up: 0, notable: 0 };
  list.forEach(({ d }) => {
    if (d.flags?.needs_follow_up === true) flags.needs_follow_up++;
    if (d.flags?.notable === true) flags.notable++;
  });

  return {
    n,
    effort: {
      hist: effortHist, notAssessed: effortNA, avg: mean(efforts),
      pointsTotal: points.reduce((s, p) => s + p, 0), pointsMax: n * possible,
    },
    completed, completedPct: n ? Math.round((completed / n) * 100) : 0,
    durationAvg: mean(durations), messageAvg: mean(messages),
    understanding: { overall: overallAvg, self: selfAvg, dist: overallHist,
      gap: (overallAvg != null && selfAvg != null) ? selfAvg - overallAvg : null },
    objectives, misconceptions,
    reflection: { meaningful: reflMeaningful, assessed: reflAssessed,
      capped: reflAssessed - reflMeaningful, engagement: mean(reflEng), sentiment, topics },
    honor, flags,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Analysis export
 * ════════════════════════════════════════════════════════════════════════════ */
// Name + student ID + score is not treated as PII here, so reports are exported as-is.
// Access is still gated by faculty auth + RLS (instructors: own sections; directors: course).

/**
 * Combine every report for one lesson into a single Markdown corpus for the analysis AI — one
 * block per student, labeled with name · student id · section CODE.
 *
 * The section label is the visible change: `students.section_id` used to BE 'M1A', so the old
 * version could print it directly. Section ids are uuids now, so the code is resolved through
 * ctx.sectionCodeOf() — printing the raw id would put a uuid in front of a human.
 *
 * @returns {{ title, interactionId, studentCount, text }}
 */
export async function buildLessonCorpus(ctx, offeringId) {
  const found = await interactiveActivityOf(offeringId);
  const title = found?.offering?.interactive?.title || found?.offering?.title || 'Lesson';
  const base = { title, interactionId: offeringId, studentCount: 0, text: '' };
  if (!found || !ctx.sectionIds?.length) return base;

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', ctx.sectionIds).eq('status', 'active');
  const enrolments = enrolRows || [];
  if (!enrolments.length) return base;
  const byEnrolment = Object.fromEntries(enrolments.map(e => [e.id, e]));

  const reports = [];
  for (const ids of chunked(enrolments.map(e => e.id))) {
    const { data } = await db.from('submissions')
      .select(SUBMISSION_SELECT).eq('assignment_offering_id', offeringId).in('enrollment_id', ids);
    (data || []).map(shapeSubmission).forEach(s => {
      const work = s.activities?.[found.activityId];
      if (work?.reportMarkdown) reports.push({ enrolmentId: s.enrollmentId, md: work.reportMarkdown });
    });
  }

  // Stable order: section code, then student id.
  reports.sort((a, b) => {
    const ea = byEnrolment[a.enrolmentId] || {}, eb = byEnrolment[b.enrolmentId] || {};
    return String(ctx.sectionCodeOf(ea.section_id)).localeCompare(String(ctx.sectionCodeOf(eb.section_id)))
        || String(ea.student_id).localeCompare(String(eb.student_id));
  });

  const head = `# ${title} — combined reports for analysis\n`
    + `Lesson: ${offeringId} · ${reports.length} report${reports.length === 1 ? '' : 's'}.\n`
    + `Each block is labeled with the student's name, ID, and section.\n`;

  const blocks = reports.map(r => {
    const e = byEnrolment[r.enrolmentId] || {};
    const name = e.students?.name ? `${e.students.name} · ` : '';
    return `\n\n---\n\n## ${name}${e.student_id} · Section ${ctx.sectionCodeOf(e.section_id) || '—'}\n\n${r.md}`;
  });

  return { title, interactionId: offeringId, studentCount: reports.length, text: head + blocks.join('') };
}
