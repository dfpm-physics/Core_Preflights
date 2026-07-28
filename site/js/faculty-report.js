// ⚠ NOT MIGRATED TO SCHEMA `app`. DO NOT WIRE THIS UP AS-IS.
//
// Nothing imports this module — which is why the app works, and also why the import checker
// (tests/app-schema/test-imports.mjs) cannot catch what follows. Every query below targets
// `public` tables and columns that this client can no longer reach: site/js/config.js
// pins it to schema `app`, so importing this file yields 404s on `responses` and 400s on
// `assignments.questions`, `assignments.analysis_report` and `students.section_id`.
//
// It is kept deliberately (see docs/app/README.md): it is the ported query layer for the
// by-question report, which is to be MERGED INTO THE LESSON ROLLUP rather than shipped as its
// own page. Migrate it as part of that merge, not before — the replacement reads the
// `analysis_reports` table (scope='assignment_offering'), which
// faculty-data.js:loadAnalysisReports() already implements.
//
// The Report page you can actually reach (faculty/report.html) does NOT use this file: it
// imports faculty-rollup.js, and that path IS migrated.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// faculty-report.js — data layer for the faculty Report (submission analysis) view.
// Ported from admin.html's report tab. Reuses the shared assignment/section pickers from
// faculty-grade.js so there's one source of truth.

import { db } from './supabase.js';
import { lastFirst } from './util.js';
export { gradeAssignmentList as reportAssignmentList, mySectionIds, allSectionIds } from './faculty-grade.js';

/**
 * @returns {{assignment, students, submitted, missing, qs, reportAnswers, qSummaries}}
 *   reportAnswers: idx -> [{name, section, answer}] for submitters;
 *   qSummaries: questionId -> [summary strings] from assignments.analysis_report
 *               (the /preflight-analyze skill output) for sections in view.
 */
export async function loadReportData(ctx, asgnId, sectionIds) {
  const { data: assignment } = await db.from('assignments').select('*').eq('id', asgnId).maybeSingle();
  if (!assignment) return { assignment: null };

  const { data: studentsRaw } = await db.from('students').select('student_id, name, section_id')
    .in('section_id', sectionIds.length ? sectionIds : ['__none__']);
  const students = (studentsRaw || []).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  const studentIds = students.map(s => s.student_id);

  const { data: responses } = studentIds.length
    ? await db.from('responses').select('student_id, answers').eq('assignment_id', asgnId).in('student_id', studentIds)
    : { data: [] };

  const responseMap = Object.fromEntries((responses || []).map(r => [r.student_id, r.answers || {}]));
  const submittedIds = new Set((responses || []).map(r => r.student_id));
  const submitted = students.filter(s => submittedIds.has(s.student_id));
  const missing = students.filter(s => !submittedIds.has(s.student_id));
  const qs = assignment.questions || [];

  const reportAnswers = {};
  qs.forEach((q, idx) => {
    reportAnswers[idx] = submitted.map(s => ({
      name: lastFirst(s.name), section: s.section_id,
      answer: String(responseMap[s.student_id]?.[q.id] ?? ''),
    }));
  });

  // Aggregate class summaries from analysis_report for instructors whose sections are in view.
  const sectionsInView = new Set(students.map(s => s.section_id));
  const qSummaries = {};
  const ar = assignment.analysis_report || null;
  if (ar?.by_instructor) {
    Object.values(ar.by_instructor).forEach(instr => {
      if ((instr.sections || []).some(s => sectionsInView.has(s))) {
        Object.entries(instr.questions || {}).forEach(([qId, qData]) => {
          if (qData.summary) (qSummaries[qId] ||= []).push(qData.summary);
        });
      }
    });
  }

  return { assignment, students, submitted, missing, qs, reportAnswers, qSummaries };
}
