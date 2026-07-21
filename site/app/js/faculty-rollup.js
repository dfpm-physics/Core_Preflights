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
// site/app/faculty/report.html imports this module and calls loadManager, loadInteractionData,
// loadAnalysis, summarizeReports, loadReport and buildLessonCorpus. Those names and their
// argument shapes are preserved deliberately: the interaction key each takes is now an offering
// uuid instead of a slug, but it stays an opaque string that this module mints and consumes, so
// report.html did not have to change to keep working.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT,
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
  const offerings = (offeringRows || []).map(shapeOffering).filter(Boolean)
    .filter(o => o.interactive || o.written);

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

/** Both activity ids for one offering, either of which may be null. Used by the reads that
 *  summarize the whole cohort and so must not care how a given student worked the lesson. */
async function activitiesOf(offeringId) {
  const { data } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = shapeOffering(data);
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
async function interactiveActivityOf(offeringId) {
  const found = await activitiesOf(offeringId);
  return found?.interactiveId ? { offering: found.offering, activityId: found.interactiveId } : null;
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
export async function loadInteractionData(offeringId, studentIds) {
  if (!studentIds?.length) return [];
  const found = await activitiesOf(offeringId);
  if (!found || (!found.interactiveId && !found.writtenId)) return [];
  // Resolved once per lesson, not per student: which written question is the reading reflection.
  const reflectionQid = reflectionQuestionId(found.offering?.written);

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
    const interactiveWork = found.interactiveId ? s.activities?.[found.interactiveId] : null;
    const writtenWork     = found.writtenId     ? s.activities?.[found.writtenId]     : null;
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

/** The reserved key under which loadAnalysis returns the per-question breakdowns. Not a section
 *  id and not '__all__', so it can never collide with a scope the viewer indexes by. */
export const BY_QUESTION_KEY = '__by_question__';

/**
 * Cohort AI synthesis for one lesson — the free-text panels the rollup shows as placeholders
 * until the /lesson-aggregate skill has run: readiness summary, misconception-trend prose,
 * showcase quotes. Numeric rollups stay computed live in the browser (summarizeReports).
 *
 * `interaction_analysis` (one row per section, with a '__all__' sentinel) collapsed into
 * `analysis_reports`, one generic table keyed by (scope, scope_id, audience_id, kind). The
 * per-section breakdown therefore rides INSIDE the payload rather than in the row key, and this
 * function flattens it back to the map the viewer expects.
 *
 * ── TWO SKILLS WRITE THIS TABLE, AND `kind` IS WHAT SEPARATES THEM ──────────────────
 * `kind='by_question'` rows come from /preflight-analyze: one per INSTRUCTOR, carrying the
 * written preflight's per-question analysis — including its misconception findings — as
 * `payload.breakdown.items[qid].summary` bullet strings. `kind='cohort'`-shaped rows come from
 * /lesson-aggregate and carry the section panels. See docs/decisions/ROLLUP-AGREEMENT.md §6.
 *
 * This function used to ignore `kind` entirely, and a by_question payload has neither
 * `by_section` nor `section_id` — so every one of them fell through to `out['__all__']`, each
 * instructor's row overwriting the last with four nulls, and clobbering a genuine cohort row if
 * one existed. It was latent only because written-only lessons had no rollup to load it from.
 * The breakdowns are now separated out and returned under BY_QUESTION_KEY instead of corrupting
 * the panel map.
 *
 * RLS still scopes the result: an instructor never receives a whole-course row, so their "All
 * sections" view falls back to the live placeholders instead of a cross-section summary. It also
 * means an instructor sees only THEIR OWN by_question row (audience_id = them), which is the
 * intended reach — the bullets are written per instructor, over their own sections.
 *
 * @returns {Promise<Record<string, object>>} keyed by section id, with '__all__' for the
 *   whole-course row and BY_QUESTION_KEY for the array of per-instructor question breakdowns.
 */
export async function loadAnalysis(offeringId) {
  const { data } = await db.from('analysis_reports')
    .select('id, scope, scope_id, audience_id, kind, payload, generated_at')
    .eq('scope', 'assignment_offering').eq('scope_id', offeringId);

  const out = {};
  const byQuestion = [];
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

    // The written path's per-question breakdown. Recognized by `kind` first and by the payload
    // shape as a fallback, so a row written before `kind` was set still routes correctly.
    const items = p.breakdown?.items;
    if (row.kind === 'by_question' || (p.breakdown?.axis === 'question' && items)) {
      byQuestion.push({
        audience_id: row.audience_id,
        instructor_name: p.instructor_name || null,
        sections: Array.isArray(p.sections) ? p.sections : [],
        day_filter: p.day_filter ?? null,
        items: items && typeof items === 'object' ? items : {},
        meta: p.meta || null,
        generated_at: row.generated_at,
      });
      // A by_question row ALSO carries the cohort panels when the skill writes them
      // (ROLLUP-AGREEMENT §6 requires readiness_summary / misconception_trends), so fall
      // through rather than returning — but only if it actually has any.
      if (!p.readiness_summary && !p.misconception_trends && !p.selected_quotes) return;
    }

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
  if (byQuestion.length) out[BY_QUESTION_KEY] = byQuestion;
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
export function summarizeReports(rows, possible = 2) {
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
  const frHist = [0, 0, 0, 0, 0, 0];
  const frVals = [];
  list.forEach(({ frUnderstanding: u }) => { if (u != null) { frHist[u]++; frVals.push(u); } });
  if (frVals.length) {
    const fr = { key: FREE_RESPONSE_KEY, label: FREE_RESPONSE_LABEL, assessed: frVals.length,
                 understanding: mean(frVals), confidence: null, dist: frHist, source: 'written' };
    // Re-sorted rather than pushed: the list is "weakest first", and the whole point of the row
    // is that it competes with the objectives for the reader's attention on the same terms.
    objectives.push(fr);
    objectives.sort((a, b) => (a.understanding ?? 99) - (b.understanding ?? 99));
  }

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
