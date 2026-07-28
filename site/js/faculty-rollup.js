// faculty-rollup.js — read-side data layer for the LESSON ROLLUP (faculty/report.html).
//
// Named faculty-interactions.js until 2026-07-20, when the interactions page it was written for
// was deleted: a lesson is now an assignment offering, so a standalone interaction cannot exist
// and its authoring half was unbuildable. The read side survived because report.html and the
// faculty dashboard both depend on it — hence the rename rather than a deletion. Function names
// and arities are unchanged, so the two consumers were untouched by the move.
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
// ── IT IS NOT AN INTERACTIVE-ONLY PAGE ANY MORE (2026-07-21) ────────────────────────
// It was, and the name `faculty-interactions.js` said so. But a lesson can be worked two ways
// and BOTH paths now produce the two numbers this file summarizes — effort and understanding.
// The written path's live in `grades.diagnostic` (`q2_effort` / `q3_understanding`, written by
// /preflight-analyze) rather than in a schema:1 report; see the "Learner signals" note in
// schema.js for where each one comes from and why effort is one measurement across both.
//
// So: a written-only lesson gets a rollup, a mixed lesson's rollup describes everyone, and the
// three things that genuinely require an artifact — the markdown report viewer, misconception
// trends, and the AI corpus — stay interactive-only and say so where they are empty.
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
// site/faculty/report.html imports this module and calls loadManager, loadInteractionData,
// loadAnalysis, summarizeReports, loadReport and buildLessonCorpus. Those names and their
// argument shapes are preserved deliberately: the interaction key each takes is now an offering
// uuid instead of a slug, but it stays an opaque string that this module mints and consumes, so
// report.html did not have to change to keep working.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT,
  shapeOfferings, withResolvedDue, offeringSections,
  shapeOffering, shapeSubmission, artifactUrlOf, chunked,
  int05, writtenSignals, writtenReport, effortSignal, FREE_RESPONSE_KEY, FREE_RESPONSE_LABEL,
  minutes, median, READING_BUCKETS, reflectionQuestionId,
} from './schema.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Listing
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Every scheduled lesson in ctx.currentOffering that can be worked at all — interactive,
 * written, or both — with completion broken down by section, plus the section rosters the
 * report viewer needs.
 *
 * Was "…that HAS an interactive activity" until 2026-07-21. Both modalities now produce the
 * effort and understanding the rollup summarizes, so restricting the list to one of them hid
 * whole lessons and, on mixed lessons, half of every cohort.
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

  // Every scheduled lesson, whichever way it can be worked. This used to be
  // `.filter(o => o.interactive)` — "this page is only about interactive work" — which meant a
  // question-only lesson had no rollup at all, and a mixed lesson's rollup silently described
  // only the half of the cohort that took the artifact. Both modalities now produce effort and
  // understanding (schema.js, "Learner signals"), so the filter was hiding real data.
  const offerings = shapeOfferings(offeringRows, ctx)
    .filter(o => o.interactive || o.written);

  const enrollments = enrolRows || [];
  const studentOf = Object.fromEntries(enrollments.map(e => [e.id, e.student_id]));
  const sectionOf = Object.fromEntries(enrollments.map(e => [e.id, e.section_id]));

  const sectionSize = {};
  sectionIds.forEach(id => { sectionSize[id] = 0; });
  enrollments.forEach(e => { if (sectionSize[e.section_id] != null) sectionSize[e.section_id]++; });

  // ONE query for every submission in scope, not one per lesson. The legacy page issued a
  // report query per interaction inside a Promise.all — N+1 by construction, and the reason
  // it slowed as the term filled up. Everything reaches through the offering now.
  const submissions = [];
  for (const ids of chunked(enrollments.map(e => e.id))) {
    const { data } = await db.from('submissions').select(SUBMISSION_SELECT).in('enrollment_id', ids);
    submissions.push(...(data || []).map(shapeSubmission));
  }

  // "Done" = a submission_activities row exists for EITHER of that lesson's activities. The old
  // rule counted only the interactive one, so on a mixed lesson every student who answered the
  // questions read as "not done" — the completion ring and the numbers underneath it were
  // describing different cohorts. A student who did both counts once (it is a Set of people).
  const doneByOffering = {};      // offeringId -> Set(student_id)
  const doneKey = {};             // `${offeringId}|${sectionId}` -> count
  const activityIdsOf = Object.fromEntries(offerings.map(o => [
    o.offeringId, [o.interactive?.id, o.written?.id].filter(Boolean),
  ]));
  submissions.forEach(s => {
    const actIds = activityIdsOf[s.offeringId] || [];
    if (!actIds.some(id => s.activities?.[id])) return;
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
    // A written-only lesson has no artifact, no frozen slug and no interactive activity id.
    // Those three fields are therefore nullable now; every consumer must treat them as
    // "this lesson may not have an artifact" rather than assuming one exists.
    return {
      id: o.offeringId,                        // the page's key — see the header note
      offeringId: o.offeringId,
      assignmentId: o.assignmentId,
      activityId: o.interactive?.id || null,
      writtenActivityId: o.written?.id || null,
      slug: o.interactive?.slug || null,       // the FROZEN artifact `#i=` slug, when there is one
      assignmentSlug: o.slug,
      title: o.interactive?.title || o.title,
      description: o.interactive?.content?.description || o.description || null,
      artifact_url: artifactUrlOf(o.interactive),   // already null-safe on a written-only lesson
      is_published: o.isPublished,
      gradingRole: o.interactive?.gradingRole || o.written?.gradingRole || null,
      pointsPossible: o.pointsPossible,
      due_at: o.dueAt,
      dueBySection: o.dueBySection,
      hasInteractive: !!o.interactive,
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
    students: enrollments.filter(e => e.section_id === id)
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

/** Both activity ids for one offering, either of which may be null. Used by the reads that
 *  summarize the whole cohort and so must not care how a given student worked the lesson.
 *
 *  TAKES ctx, and that is the whole point of this signature. The `offeringSections(ctx)` call
 *  below arrived with migration 017's per-day deadlines (2026-07-27) inside a function that had
 *  no `ctx` in scope and no parameter for one — a free variable, which under a module's strict
 *  mode is a ReferenceError on every single call, not a silent undefined. It took the rollup's
 *  numbers, the per-student markdown viewer and the corpus builder with it; see loadInteractionData.
 *  ctx is threaded rather than kept in a module-level global so the dependency is visible in every
 *  signature that has it, which is the convention loadManager() and buildLessonCorpus() already
 *  follow. */
async function activitiesOf(ctx, offeringId) {
  const { data } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = withResolvedDue(shapeOffering(data), offeringSections(ctx));
  if (!offering) return null;
  return {
    offering,
    interactiveId: offering.interactive?.id || null,
    writtenId: offering.written?.id || null,
  };
}

/** The interactive activity id for one offering, or null. Narrows activitiesOf() for the reads
 *  that are genuinely artifact-specific — the markdown report viewer and the corpus builder,
 *  neither of which a written submission can satisfy (there is no report to show or to feed to
 *  the analysis AI). Returning null here is what makes those two degrade rather than break on a
 *  question-only lesson. */
async function interactiveActivityOf(ctx, offeringId) {
  const found = await activitiesOf(ctx, offeringId);
  return found?.interactiveId ? { offering: found.offering, activityId: found.interactiveId } : null;
}

/** One student's report markdown for a lesson (the caller sanitizes before rendering — the
 *  payload originated in a URL hash and is stored inert, per INTERACTION-DATA-CONTRACT.md). */
export async function loadReport(ctx, offeringId, studentId) {
  const found = await interactiveActivityOf(ctx, offeringId);
  if (!found) return null;

  const { data: enroll } = await db.from('enrollments')
    .select('id').eq('student_id', studentId);
  const enrolIds = (enroll || []).map(e => e.id);
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
 * The graded columns + structured blob for every in-scope student who worked one lesson —
 * BY EITHER PATH.
 *
 * Where the numbers now live is the substantive change. `preflight_interaction_reports` carried
 * effort and score ON the report row, so a student's write set their own grade. In v2 a student
 * can only write `submission_activities`, and effort/points live in `grades`, which students
 * cannot write at all. So effort is read from the grade first and falls back to the schema:1
 * payload the artifact sent — which is a claim, not a grade, until a grader confirms it.
 *
 * The second change: this used to return only students with an interactive
 * `submission_activities` row, so on a mixed lesson every summary downstream described the
 * artifact-takers and quietly omitted everyone who answered the questions. A student is
 * included here if they engaged with EITHER activity; `path` says which, and `understanding`
 * carries the written free-response diagnostic that has no interactive equivalent.
 *
 * RLS scopes which rows come back, so passing the full roster's ids is safe.
 * @returns {Promise<Array<{student_id, enrollment_id, path, effort, effortSource, understanding,
 *                          score, report_data, report_markdown, updated_at}>>}
 */
export async function loadInteractionData(ctx, offeringId, studentIds) {
  if (!studentIds?.length) return [];
  const found = await activitiesOf(ctx, offeringId);
  if (!found || (!found.interactiveId && !found.writtenId)) return [];
  // Resolved once per lesson, not per student: which written question is the reading reflection.
  const reflectionQid = reflectionQuestionId(found.offering?.written);

  const enrollments = [];
  for (const ids of chunked(studentIds)) {
    const { data } = await db.from('enrollments')
      .select('id, student_id, section_id').in('student_id', ids).eq('status', 'active');
    enrollments.push(...(data || []));
  }
  if (!enrollments.length) return [];
  const studentOf = Object.fromEntries(enrollments.map(e => [e.id, e.student_id]));

  const submissions = [], grades = [];
  for (const ids of chunked(enrollments.map(e => e.id))) {
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

  // Only work on a GRADED path counts toward the rollup — a practice activity is not the
  // assignment. A student who ran the interactive lesson for practice (grading_role='practice')
  // but never did the required written questions has completed nothing, and must not be counted
  // "complete" in the cohort (the bug this fixes: lesson-02 practice interactives showed complete
  // with no question responses). Committing an activity for credit also counts it — that is how a
  // 'choice' offering's chosen interactive path is included.
  const iGraded = found.offering?.interactive?.gradingRole === 'graded';
  const wGraded = found.offering?.written?.gradingRole === 'graded';

  const out = [];
  submissions.forEach(s => {
    const rawInteractive = found.interactiveId ? s.activities?.[found.interactiveId] : null;
    const rawWritten     = found.writtenId     ? s.activities?.[found.writtenId]     : null;
    const chosen = s.chosenActivityId;
    const interactiveWork = rawInteractive && (iGraded || chosen === found.interactiveId) ? rawInteractive : null;
    const writtenWork     = rawWritten     && (wGraded || chosen === found.writtenId)     ? rawWritten     : null;
    if (!interactiveWork && !writtenWork) return;

    const grade = gradeBy[s.enrollmentId] || null;

    // THE BRIDGE. An interactive student's schema:1 assessment rides on their submission (the
    // artifact wrote it); a written student's rides on their GRADE (/preflight-analyze wrote it).
    // Different tables, same shape — so both are surfaced as `report_data` and everything
    // downstream folds one uniform structure instead of branching on modality.
    //
    // Without this the schema:1 emission would be written and never read, which is the same
    // failure the by_question breakdown had. Writing to the database is not the same as it
    // being used.
    const written = writtenReport(grade);
    let reportData = interactiveWork?.content || written || null;

    // …and the one field the bridge has to reconstitute rather than pass through.
    //
    // WRITTEN-SCHEMA1.md deliberately does NOT copy the reflection text into `grades.diagnostic`
    // — it would duplicate an answer the submission already stores — so a written student's
    // schema:1 carries the JUDGMENT (`{engagement, meaningful}`) and no `text`. The interactive
    // payload carries both. Consumers that read `reading_reflection.text` therefore found it on
    // one path and not the other: report.html resolves showcase quotes AND its random reflection
    // sample through that field, so a question-set cohort rendered an empty responses panel with
    // no error — the AI picked real students and none of them could be resolved to a quote.
    //
    // Lifting the answer here restores the "one shape, two producers" contract at the point the
    // shapes are already being unified, so nothing downstream has to know where the text lived.
    if (written && !interactiveWork?.content && reflectionQid) {
      const answer = writtenWork?.content?.[reflectionQid];
      if (typeof answer === 'string' && answer.trim()) {
        reportData = {
          ...written,
          reading_reflection: { ...(written.reading_reflection || {}), text: answer.trim() },
        };
      }
    }

    const { effort, source } = effortSignal(grade, reportData);
    const { understanding } = writtenSignals(grade);

    // A student who did both is reported once, tagged 'both'. Their effort resolves through the
    // same precedence as anyone else's, so doing the questions as practice beside a graded
    // artifact cannot double-count them into the distribution.
    const path = interactiveWork && writtenWork ? 'both'
               : interactiveWork ? 'interactive'
               : 'written';

    out.push({
      student_id: studentOf[s.enrollmentId],
      enrollment_id: s.enrollmentId,
      path,
      effort,
      effortSource: source,
      // The written free-response measure. Null on a pure interactive row — that path resolves
      // understanding per objective instead, and the two are not interchangeable.
      understanding: writtenWork ? understanding : null,
      score: grade?.points_earned == null ? null : Number(grade.points_earned),
      report_data: reportData,
      report_markdown: interactiveWork?.reportMarkdown || null,
      updated_at: interactiveWork?.updatedAt || writtenWork?.updatedAt || null,
    });
  });
  return out;
}

/**
 * Cohort AI synthesis for one lesson — the free-text panels the rollup shows as placeholders
 * until the /lesson-aggregate skill has run: readiness summary, misconception-trend prose plus
 * its recommendation, and showcase quotes. Numeric rollups stay computed live in the browser
 * (summarizeReports).
 *
 * `interaction_analysis` (one row per section, with a '__all__' sentinel) collapsed into
 * `analysis_reports`, one generic table keyed by (scope, scope_id, audience_id, kind). The
 * per-section breakdown therefore rides INSIDE the payload rather than in the row key, and this
 * function flattens it back to the map the viewer expects.
 *
 * ── ONE SKILL WRITES THIS TABLE NOW (changed 2026-07-21) ────────────────────────────
 * `/lesson-aggregate` owns every cohort output: `kind='readiness'`, `audience_id=NULL`, panels
 * inside `payload.scopes`. `/preflight-analyze` is purely per-student and writes nothing here.
 *
 * Its old `kind='by_question'` rows were keyed per INSTRUCTOR, which is not a unit of analysis —
 * one row pooled an instructor's M1A and M3A, so it could never be shown on a section view and
 * could not be split. They are retired; the per-question material now lives inside
 * `readiness_summary`. Rows written before the retirement survive in the database and are
 * ignored here: a by_question payload has no `scopes`, no `by_section` and no `section_id`, so
 * the branch below would file it under '__all__' with null panels and clobber a real cohort row.
 * That is what the `kind` guard prevents. See docs/decisions/ROLLUP-AGREEMENT.md §6.
 *
 * RLS is NOT a scope filter here, contrary to what this comment used to claim: `ar_read` is an OR
 * chain whose `scope='assignment_offering'` clause grants every such row to any staff member of
 * the offering. "An instructor's All-sections view is the union of THEIR sections, never
 * '__all__'" is therefore a UI rule the renderer must enforce — nothing below does it.
 *
 * @returns {Promise<Record<string, object>>} keyed by section id, with '__all__' for the
 *   whole-course scope.
 */
export async function loadAnalysis(offeringId) {
  const { data } = await db.from('analysis_reports')
    .select('id, scope, scope_id, audience_id, kind, payload, generated_at')
    .eq('scope', 'assignment_offering').eq('scope_id', offeringId);

  const out = {};
  const aliases = {};
  const glossary = {};
  (data || []).forEach(row => {
    const p = row.payload || {};
    const panels = (obj, sectionId) => ({
      section_id: sectionId,
      readiness_summary: obj?.readiness_summary ?? null,
      // DEPRECATED 2026-07-22 — the trends paragraph is no longer written or rendered; the
      // Misconceptions panel is now bars (which explain themselves via description/evidence) plus
      // the one-line recommendation. Still read so historical rows do not lose data, and still
      // accepted by the writer. Nothing in the UI displays it.
      misconception_trends: obj?.misconception_trends ?? null,
      // A sibling of the trends prose, not part of it: the UI renders it as its own line, and the
      // writer caps it separately so it stays one. Forgetting to list it here is how a stored
      // field ends up displayed nowhere — the exact failure this function had with `scopes`.
      misconception_recommendation: obj?.misconception_recommendation ?? null,
      selected_quotes: obj?.selected_quotes ?? null,
      // Instructor-scope fields ('instr:<uuid>' keys). The readiness summary is now written per
      // INSTRUCTOR across all the sections they teach, with per-section departures called out
      // separately so the summary itself stays short. Null on section and '__all__' scopes.
      instructor_id: obj?.instructor_id ?? null,
      instructor_name: obj?.instructor_name ?? null,
      section_ids: Array.isArray(obj?.section_ids) ? obj.section_ids : null,
      // The human-readable codes for those ids. The rollup names them above a combined summary so
      // an instructor can verify no section of theirs was left out — a check that must not depend
      // on the AI prose mentioning them. Omitting it here is the exact failure this whitelist
      // documents: the writer stores it and nothing ever shows it.
      section_codes: Array.isArray(obj?.section_codes) ? obj.section_codes : null,
      section_notes: Array.isArray(obj?.section_notes) ? obj.section_notes : null,
      meta: obj?.meta ?? null,
      generated_at: row.generated_at,
    });

    // Offering-level, NOT per scope: the same misconception means the same thing in every section,
    // so folding it per scope would let one section's bars disagree with another's. Merged across
    // rows rather than replaced, for the same reason scopes merge — a day-scoped run must not drop
    // what the other day's run learned.
    if (p.misconception_aliases && typeof p.misconception_aliases === 'object') {
      Object.entries(p.misconception_aliases).forEach(([from, to]) => {
        const f = String(from || '').trim().toLowerCase();
        const t = String(to || '').trim().toLowerCase();
        if (f && t && f !== t) aliases[f] = t;
      });
    }
    if (p.misconception_glossary && typeof p.misconception_glossary === 'object') {
      Object.entries(p.misconception_glossary).forEach(([id, g]) => {
        const k = String(id || '').trim().toLowerCase();
        if (k && g && typeof g === 'object') glossary[k] = { label: g.label || null, description: g.description || null };
      });
    }

    // Retired `by_question` rows, still present in the database. Skip them: they carry no scope
    // map, so the branch below would file one under '__all__' with null panels and overwrite a
    // real cohort scope. Recognized by `kind` first and by payload shape as a fallback, because
    // some predate the `kind` column.
    if (row.kind === 'by_question' || p.breakdown?.axis === 'question') return;

    // Either one row carrying a map of per-scope panels, or a row that IS one scope's panels.
    //
    // `scopes` is the key lesson_aggregate.py actually writes — keyed by section uuid plus
    // '__all__' for the whole course (SKILL.md, "Why the per-section rows became one row with
    // scopes inside it"). `by_section` is the name this reader was built against and that no
    // producer has ever emitted; it stays accepted so a hand-written row still loads.
    //
    // Reading only `by_section` meant every real /lesson-aggregate row fell through to the
    // single-scope branch below, where the top level has no panels — so readiness_summary,
    // misconception_trends and selected_quotes all resolved to null and the rollup showed its
    // "coming soon" placeholders on every scope. The analysis was written to the database and
    // displayed nowhere, which is the same failure mode the by_question breakdown had.
    const scopeMap = (p.scopes && typeof p.scopes === 'object') ? p.scopes
                   : (p.by_section && typeof p.by_section === 'object') ? p.by_section : null;
    if (scopeMap) {
      Object.entries(scopeMap).forEach(([sid, obj]) => { out[sid] = panels(obj, sid); });
      // The whole-course entry rides inside `scopes` under the '__all__' key; the older
      // by_section shape carried it at the top level instead. Never let that fallback clobber a
      // real one the map already supplied.
      if (!out.__all__ && (p.readiness_summary || p.misconception_trends)) {
        out.__all__ = panels(p, '__all__');
      }
    } else {
      const sid = p.section_id || '__all__';
      out[sid] = panels(p, sid);
    }
  });
  return { scopes: out, aliases, glossary };
}

/* `taughtSectionIds` moved to schema.js on 2026-07-23 and is re-exported here unchanged.
 *
 * Two other surfaces needed the same question answered — the Grade page's queue (P1.14) and the
 * dashboard's due-out row (P1.8's scoping fix) — and neither should import this module to get it:
 * it is 56 KB of aggregation maths they have no other use for. It is a pure function over `ctx`
 * with no `db` in it, so schema.js is where it always belonged.
 *
 * Re-exported rather than moved-and-updated-at-every-call-site: report.html reaches it as
 * `I.taughtSectionIds` through a namespace import, and gradebook.html imports it by name from
 * here. Both keep working, and neither reads a second definition. */
export { taughtSectionIds } from './schema.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Numeric rollup — PURE, unchanged by the migration
 * ════════════════════════════════════════════════════════════════════════════ */
// The website computes ALL numeric rollups from report_data without AI; the AI passes only
// ever read the free-text fields to produce aggregated trend prose. schema:1 is a FROZEN
// contract (docs/contracts/INTERACTION-DATA-CONTRACT.md), so the payload this folds over did
// not change shape when it moved from preflight_interaction_reports.report_data to
// submission_activities.content — and neither did any of the maths below.

// int05 — the defensive 0–5 coercion — moved to schema.js when the written path started
// feeding these summaries, so both modalities' numbers are cleaned by one definition.
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
/**
 * Canonicalize a misconception id.
 *
 * Both producers are explicitly licensed to coin new ids (contract §5.4: "May be a new key the
 * artifact coins"), and every counting site keys on the exact string — so `scalar-sum`,
 * `Scalar-Sum` and `scalar-sum ` counted as three separate bars. Reading-reflection topics have
 * always been trimmed and lowercased one block below; misconception ids never were. This closes
 * that gap, and then applies the alias map /lesson-aggregate persists so the clustering it does in
 * prose finally reaches the bars it sits under.
 *
 * @param {string} id
 * @param {Record<string,string>} [aliases]  variant id -> canonical id, from the payload
 */
export function canonMisconceptionId(id, aliases) {
  const k = String(id || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!k) return '';
  const to = aliases && aliases[k];
  // One hop only. A cycle or a chain in a hand-edited map must not hang the render.
  return (typeof to === 'string' && to.trim()) ? to.trim().toLowerCase() : k;
}

/**
 * Flag keys this UI consumes explicitly. `note` is included because it already has its own render
 * path in the student panel — it is recognized, just not counted.
 *
 * Everything else a producer emits is a RESIDUAL flag. `flags` is a field in the frozen schema:1
 * contract but its VALUES are not enumerated, so the artifact and /preflight-analyze both coin
 * keys freely; until the taxonomy exists (P3.3) a novel key was dropped at every surface, silently.
 * Director's decision (ROADMAP Q4): surface them with their detail — never drop, never error.
 */
export const KNOWN_FLAG_KEYS = new Set(['needs_follow_up', 'notable', 'note']);

/**
 * One student's residual flags as `[key, detail]` pairs, detail `''` for a bare `true`.
 *
 * A `false`/null/empty value is a flag the producer explicitly CLEARED, not one it raised, and is
 * dropped — otherwise every student carrying `{suspected_ai: false}` would surface as flagged and
 * the container would be noise instead of signal.
 *
 * @param {unknown} flags  the raw `flags` object from a schema:1 payload
 * @returns {Array<[string,string]>}
 */
export function residualFlags(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return [];
  return Object.entries(flags)
    .filter(([k, v]) => !KNOWN_FLAG_KEYS.has(k) && v !== false && v != null && v !== '')
    .map(([k, v]) => [k, v === true ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))]);
}

export function summarizeReports(rows, possible = 2, opts = {}) {
  const mcAliases = opts.aliases || null;
  const mcGlossary = opts.glossary || null;
  const list = (rows || []).map(r => ({
    effort: int05(r?.effort),
    // The written free-response understanding. Distinct from the interactive path's
    // per-objective understanding — see the "Learner signals" note in schema.js.
    frUnderstanding: int05(r?.understanding),
    path:   r?.path || (r?.report_data ? 'interactive' : 'written'),
    score:  num(r?.score),
    d:      (r?.report_data && typeof r.report_data === 'object') ? r.report_data : {},
  })).map(it => ({
    // Does an assessment exist for this student at all? Distinguishes "answered but named no
    // duration" from "nothing has assessed this submission yet", which are different facts.
    ...it, hasWork: Object.keys(it.d).length > 0,
  }));
  const n = list.length;

  // ── How this cohort worked the lesson. Every panel below is only interpretable against this:
  //    "avg effort 3.8" means something different when it is 40 artifacts vs 40 question sets vs
  //    a 50/50 split, and the UI says which.
  const paths = { interactive: 0, written: 0, both: 0 };
  list.forEach(({ path }) => { if (path in paths) paths[path]++; });
  const interactiveN = paths.interactive + paths.both;
  const writtenN     = paths.written + paths.both;

  // ── Effort & points (GRADED). ONE distribution across both modalities.
  //    Q2 of a written preflight is the same reading-reflection prompt the artifact scores, on
  //    the same 0–5 engagement rubric, so these are one population rather than two that happen
  //    to share a scale. loadInteractionData has already resolved each row's effort through the
  //    grade → diagnostic → claim precedence; the payload fallback here only catches a row
  //    assembled by an older caller.
  const effortHist = [0, 0, 0, 0, 0, 0];
  let effortNA = 0;
  const efforts = [], points = [];
  list.forEach(({ effort, score, d }) => {
    const e = effort != null ? effort : int05(d.effort);
    if (e == null) effortNA++; else { effortHist[e]++; efforts.push(e); }
    points.push(score != null ? score : pointsForEffort(e, possible));
  });

  // ── Reading time (DIAGNOSTIC). Q1 of every preflight asks how long the student spent on the
  //    reading; it is worth 0 points, its answers are anonymous to instructors, and until now
  //    nothing read them. /preflight-analyze parses the prose to whole minutes.
  //
  //    Median + buckets, never a mean — see READING_BUCKETS in schema.js for why. `notStated`
  //    is tracked separately from "no data": a student who answered without naming a duration is
  //    a different fact from a student who did not submit, and collapsing them would let a
  //    half-answered cohort look fully measured.
  const readingVals = [];
  let readingNotStated = 0;
  list.forEach(({ d, hasWork, path }) => {
    const m = minutes(d.reading_minutes);
    if (m != null) { readingVals.push(m); return; }
    // Only a student who WORKED the question set can have withheld a duration. Q1 does not
    // exist on the interactive path, so counting an artifact taker as "gave no duration" would
    // manufacture a refusal out of a question they were never asked.
    if (hasWork && (path === 'written' || path === 'both')) readingNotStated++;
  });
  const readingBuckets = READING_BUCKETS.map(b => ({
    ...b, count: readingVals.filter(m => m >= b.min && m < b.max).length,
  }));

  // ── Engagement metadata.
  const completed = list.filter(({ d }) => d.completed === true).length;
  const durations = list.map(({ d }) => typeof d.duration_min === 'number' ? d.duration_min : null);
  const messages  = list.map(({ d }) => Number.isInteger(d.message_count) ? d.message_count : null);

  // ── Understanding (DIAGNOSTIC — never contributes to points).
  //    The headline number folds both paths: a student's interactive overall_understanding, or
  //    their written free-response understanding when they have no interactive one. Without the
  //    fallback a question-only cohort reports no understanding at all, which is the case this
  //    whole change exists to fix. `from` records the split so the UI never implies the two
  //    measures are the same instrument.
  const overall = list.map(({ d, frUnderstanding }) => int05(d.overall_understanding) ?? frUnderstanding);
  const self    = list.map(({ d }) => int05(d.self_rated_understanding));
  const overallAvg = mean(overall), selfAvg = mean(self);
  const overallHist = [0, 0, 0, 0, 0, 0];
  overall.forEach(u => { if (u != null) overallHist[u]++; });
  // Attribute by the PATH the student took, not by which field happened to supply the number.
  // Once /preflight-analyze emits schema:1, a written student HAS an overall_understanding, so
  // keying off "which field was populated" would file them under interactive and quietly
  // overstate artifact coverage — the exact miscount this whole change exists to remove.
  const understandingFrom = { interactive: 0, written: 0 };
  list.forEach(({ d, frUnderstanding, path }) => {
    if (int05(d.overall_understanding) == null && frUnderstanding == null) return;
    if (path === 'written') understandingFrom.written++; else understandingFrom.interactive++;
  });

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
    .map(m => ({ key: m.key, label: m.label, assessed: m.u.length, understanding: mean(m.u),
                 confidence: mean(m.c), dist: m.hist, source: 'interactive' }))
    .sort((a, b) => (a.understanding ?? 99) - (b.understanding ?? 99));   // weakest first

  // ── The written path's contribution to that list: ONE synthetic objective.
  //    The free-response question measures understanding on the same 0–5 scale the artifact
  //    uses per objective, so it belongs in the same breakdown and reads the same way. What it
  //    deliberately does NOT do is claim to decompose — the analysis produces one number for
  //    the question, not a per-objective resolution, so it appears as a single row labelled
  //    "Free response" rather than being spread across the authored objectives. (Teasing real
  //    objectives out of the free-response answer is the future version of this; it would slot
  //    in here by replacing this one entry with several.)
  //
  //    IT LEADS THE LIST — always first, hence always axis A on the radar and the top row of the
  //    breakdown. It was previously re-sorted into the weakest-first order with everything else,
  //    which meant the one measure that is not a resolved learning objective moved position from
  //    lesson to lesson and from section to section: axis A on Monday, axis D on Tuesday. A fixed
  //    seat makes the radar comparable across cohorts, and it is the row a reader most often wants
  //    to find deliberately rather than hunt for. Everything after it is still weakest first.
  const frHist = [0, 0, 0, 0, 0, 0];
  const frVals = [];
  list.forEach(({ frUnderstanding: u }) => { if (u != null) { frHist[u]++; frVals.push(u); } });
  if (frVals.length) {
    objectives.unshift({ key: FREE_RESPONSE_KEY, label: FREE_RESPONSE_LABEL, assessed: frVals.length,
                         understanding: mean(frVals), confidence: null, dist: frHist, source: 'written' });
  }

  // ── Misconceptions — counted by CANONICAL id, and now carrying enough to explain themselves.
  //
  // Two long-standing losses fixed here:
  //  1. Ids were keyed by exact string while both producers may coin their own, so casing and
  //     whitespace variants split one misconception across several bars. canonMisconceptionId()
  //     normalizes, then applies the alias map /lesson-aggregate persists.
  //  2. `description` and `evidence` were collected by both producers, passed to the aggregator,
  //     and then dropped right here — so the cohort bars showed a label and a percentage with no
  //     way to find out what the misconception actually was. They now survive.
  const mcMap = {};
  list.forEach(({ d }) => (Array.isArray(d.misconceptions) ? d.misconceptions : []).forEach(mc => {
    if (!mc || typeof mc !== 'object' || !mc.id) return;
    const id = canonMisconceptionId(mc.id, mcAliases);
    if (!id) return;
    const m = (mcMap[id] ||= {
      id, label: mc.label || id, count: 0, major: 0,
      description: '', examples: [], variants: new Set(),
    });
    // First non-empty label wins, but an id-as-label is always replaced by a real one.
    if ((!m.label || m.label === m.id) && mc.label) m.label = mc.label;
    // Longest description wins: the producers write these per student, and the fuller one is the
    // more useful tooltip. Cheap, deterministic, and independent of row order.
    const desc = String(mc.description || '').trim();
    if (desc.length > m.description.length) m.description = desc;
    // `evidence` is a one-clause quote from a student's answer. It was emitted by both producers,
    // passed to the aggregator, and rendered NOWHERE in the entire UI until now. Two per
    // misconception is enough to make an abstract label concrete, and they stay unattributed.
    const ev = String(mc.evidence || '').trim();
    if (ev && m.examples.length < 2 && !m.examples.includes(ev)) m.examples.push(ev);
    // A "variant" is a genuinely DIFFERENT id that folded onto this one (via the alias map), not
    // the same id cased or spaced differently — `Scalar-Sum` and `scalar sum` both normalize to
    // `scalar-sum`, and listing those in the popover would be noise. Compare the normalized form,
    // WITHOUT aliases, so only a real fold shows up.
    const raw = String(mc.id || '').trim();
    if (raw && canonMisconceptionId(raw) !== id) m.variants.add(raw);
    m.count++; if (mc.severity === 'major') m.major++;
  }));
  // A glossary entry from the payload backfills a description the raw rows never carried — which
  // is the case for any misconception whose producers left `description` empty.
  const misconceptions = Object.values(mcMap).map(m => {
    const g = mcGlossary && mcGlossary[m.id];
    return {
      ...m,
      label: (g && g.label) || m.label,
      description: m.description || (g && g.description) || '',
      variants: [...m.variants],
    };
  }).sort((a, b) => b.count - a.count || b.major - a.major);

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
  // Residual flags are tallied but deliberately NOT folded into the two counts above: those drive
  // styled pills that assert a meaning, and the whole point of a residual flag is that its meaning
  // is not yet known. Two tallies, because they answer different questions — `other` is per key
  // (what is being coined out there), `otherStudents` is per student (how many rows the pill opens).
  const otherMap = {};
  let otherStudents = 0;
  list.forEach(({ d }) => {
    if (d.flags?.needs_follow_up === true) flags.needs_follow_up++;
    if (d.flags?.notable === true) flags.notable++;
    const residual = residualFlags(d.flags);
    if (residual.length) otherStudents++;
    residual.forEach(([k]) => { otherMap[k] = (otherMap[k] || 0) + 1; });
  });
  flags.other = Object.entries(otherMap).map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  flags.otherStudents = otherStudents;

  // ── Can the radar be drawn, and if not, why not?
  //    Decided here rather than in the view so every consumer gives the same answer and the
  //    "unavailable" case carries a REASON. A radar needs ≥3 axes to enclose an area; a
  //    question-only cohort produces exactly one understanding measure, so its chart is not
  //    empty-because-nobody-worked — it is structurally unavailable, and saying so is the
  //    difference between an explanation and a blank panel that reads like a bug.
  const radarAxes = objectives.filter(o => o.understanding != null);
  const radar = {
    axes: radarAxes,
    available: radarAxes.length >= 3,
    reason: radarAxes.length >= 3 ? null
          : n === 0 ? 'no-data'
          : radarAxes.every(o => o.source === 'written') ? 'written-only'
          : 'too-few-objectives',
    axisCount: radarAxes.length,
  };

  return {
    n,
    // Provenance for every number below it. `interactive`/`written` count PEOPLE, and a student
    // who did both is counted in each (plus once in `both`), so they do not sum to n.
    paths: { ...paths, interactiveN, writtenN, mixed: interactiveN > 0 && writtenN > 0 },
    effort: {
      hist: effortHist, notAssessed: effortNA, avg: mean(efforts),
      pointsTotal: points.reduce((s, p) => s + p, 0), pointsMax: n * possible,
    },
    completed, completedPct: n ? Math.round((completed / n) * 100) : 0,
    durationAvg: mean(durations), messageAvg: mean(messages),
    // Reading time: minutes, so median + buckets rather than the 0–5 treatment everything else gets.
    reading: {
      median: median(readingVals), assessed: readingVals.length, notStated: readingNotStated,
      buckets: readingBuckets,
      min: readingVals.length ? Math.min(...readingVals) : null,
      max: readingVals.length ? Math.max(...readingVals) : null,
    },
    understanding: { overall: overallAvg, self: selfAvg, dist: overallHist,
      gap: (overallAvg != null && selfAvg != null) ? selfAvg - overallAvg : null,
      from: understandingFrom },
    objectives, radar, misconceptions,
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
  const found = await interactiveActivityOf(ctx, offeringId);
  const title = found?.offering?.interactive?.title || found?.offering?.title || 'Assignment';
  const base = { title, interactionId: offeringId, studentCount: 0, text: '' };
  if (!found || !ctx.sectionIds?.length) return base;

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', ctx.sectionIds).eq('status', 'active');
  const enrollments = enrolRows || [];
  if (!enrollments.length) return base;
  const byEnrollment = Object.fromEntries(enrollments.map(e => [e.id, e]));

  const reports = [];
  for (const ids of chunked(enrollments.map(e => e.id))) {
    const { data } = await db.from('submissions')
      .select(SUBMISSION_SELECT).eq('assignment_offering_id', offeringId).in('enrollment_id', ids);
    (data || []).map(shapeSubmission).forEach(s => {
      const work = s.activities?.[found.activityId];
      if (work?.reportMarkdown) reports.push({ enrollmentId: s.enrollmentId, md: work.reportMarkdown });
    });
  }

  // Stable order: section code, then student id.
  reports.sort((a, b) => {
    const ea = byEnrollment[a.enrollmentId] || {}, eb = byEnrollment[b.enrollmentId] || {};
    return String(ctx.sectionCodeOf(ea.section_id)).localeCompare(String(ctx.sectionCodeOf(eb.section_id)))
        || String(ea.student_id).localeCompare(String(eb.student_id));
  });

  const head = `# ${title} — combined reports for analysis\n`
    + `Assignment: ${offeringId} · ${reports.length} report${reports.length === 1 ? '' : 's'}.\n`
    + `Each block is labeled with the student's name, ID, and section.\n`;

  const blocks = reports.map(r => {
    const e = byEnrollment[r.enrollmentId] || {};
    const name = e.students?.name ? `${e.students.name} · ` : '';
    return `\n\n---\n\n## ${name}${e.student_id} · Section ${ctx.sectionCodeOf(e.section_id) || '—'}\n\n${r.md}`;
  });

  return { title, interactionId: offeringId, studentCount: reports.length, text: head + blocks.join('') };
}
