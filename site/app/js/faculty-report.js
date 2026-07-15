// faculty-report.js — data layer for the faculty Report (submission analysis) view.
// Ported from admin.html's report tab. Reuses the shared assignment/section pickers from
// faculty-grade.js so there's one source of truth. No DB changes.

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
