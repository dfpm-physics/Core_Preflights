// faculty-interactions.js — data layer for the native in-app interaction manager.
// Ported from interactions-admin.html: list (incl. drafts for directors), submission
// counts, per-section completion, section rosters for the report viewer, and CRUD.
// Directors manage; instructors get a read-only published view (scoped to their sections).

import { db } from './supabase.js';

const CHUNK = 300; // keep .in() URLs under GET length limits for large courses

/**
 * @returns {{ noCourse?, interactions:[{...it, count, perSection, done, total}], sections:[{id,students}] }}
 *   Directors see all interactions (incl. drafts) across all course sections; instructors
 *   see only published interactions and only their own sections.
 */
export async function loadManager(ctx) {
  const course = ctx.currentCourse;
  if (!course) return { noCourse: true, interactions: [], sections: [] };
  const isDirector = ctx.isDirectorForCurrent();

  let secQuery = db.from('sections').select('id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', ctx.instructorRow.id);

  let interQuery = db.from('interactions')
    .select('id, course_id, title, description, artifact_url, is_published')
    .eq('course_id', course).order('title');
  if (!isDirector) interQuery = interQuery.eq('is_published', true);

  const [{ data: sectionRows }, { data: interRaw }] = await Promise.all([secQuery, interQuery]);
  const sectionIds = (sectionRows || []).map(s => s.id);
  const interactions = interRaw || [];

  const { data: studentsRaw } = sectionIds.length
    ? await db.from('students').select('student_id, name, section_id').in('section_id', sectionIds).order('name')
    : { data: [] };
  const students = studentsRaw || [];
  const studentIds = students.map(s => s.student_id);
  const sectionOf = Object.fromEntries(students.map(s => [s.student_id, s.section_id]));

  const { data: reports } = studentIds.length
    ? await db.from('preflight_interaction_reports').select('student_id, interaction_id').in('student_id', studentIds)
    : { data: [] };

  const countByInter = {}, doneKey = {}, doneStudentsByInter = {};
  (reports || []).forEach(r => {
    countByInter[r.interaction_id] = (countByInter[r.interaction_id] || 0) + 1;
    (doneStudentsByInter[r.interaction_id] ||= new Set()).add(r.student_id);
    const sec = sectionOf[r.student_id];
    if (sec) doneKey[`${r.interaction_id}|${sec}`] = (doneKey[`${r.interaction_id}|${sec}`] || 0) + 1;
  });

  const sectionSize = {};
  sectionIds.forEach(id => sectionSize[id] = 0);
  students.forEach(s => { if (sectionSize[s.section_id] != null) sectionSize[s.section_id]++; });

  const items = interactions.map(it => {
    let done = 0, total = 0;
    const perSection = sectionIds.map(secId => {
      const d = doneKey[`${it.id}|${secId}`] || 0, n = sectionSize[secId] || 0;
      done += d; total += n;
      return { sectionId: secId, done: d, total: n };
    });
    return { ...it, count: countByInter[it.id] || 0, perSection, done, total,
      doneStudentIds: [...(doneStudentsByInter[it.id] || [])] };
  });

  const sections = sectionIds.map(id => ({
    id, students: students.filter(s => s.section_id === id).map(s => ({ student_id: s.student_id, name: s.name })),
  }));

  return { noCourse: false, interactions: items, sections };
}

/** Insert (when editingId is null) or update an interaction. */
export function saveInteraction(fields, editingId) {
  const { id, course_id, title, description, artifact_url, is_published } = fields;
  return editingId
    ? db.from('interactions').update({ course_id, title, description, artifact_url, is_published }).eq('id', editingId)
    : db.from('interactions').insert({ id, course_id, title, description, artifact_url, is_published });
}

export function togglePublish(id, current) {
  return db.from('interactions').update({ is_published: !current }).eq('id', id);
}

/** Deletes the interaction (and, by FK cascade, its student reports). */
export function deleteInteraction(id) {
  return db.from('interactions').delete().eq('id', id);
}

/** One student's report markdown for an interaction (rendered/sanitized by the caller). */
export async function loadReport(interactionId, studentId) {
  const { data } = await db.from('preflight_interaction_reports')
    .select('report_markdown').eq('interaction_id', interactionId).eq('student_id', studentId).maybeSingle();
  return data?.report_markdown || null;
}

// ── Structured data + rollup summary (contract: INTERACTION-DATA-CONTRACT.md, schema 1) ──
// The website computes ALL numeric rollups from report_data without AI; the AI passes only
// ever read the free-text fields (misconception descriptions, reflection text, narratives)
// to produce the *aggregated* trend prose, which the UI shows as placeholders until built.

/**
 * Fetch the graded columns + structured blob for every in-scope report of one interaction.
 * RLS scopes which rows the caller can read (instructors: own sections; directors: course),
 * so passing the full roster's ids is safe — unreadable rows simply don't come back.
 * Chunked to keep the `.in()` URL under length limits for large courses.
 * @returns {Promise<Array<{ student_id, effort, score, report_data, updated_at }>>}
 */
export async function loadInteractionData(interactionId, studentIds) {
  if (!studentIds?.length) return [];
  const out = [];
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const { data } = await db.from('preflight_interaction_reports')
      .select('student_id, effort, score, report_data, updated_at')
      .eq('interaction_id', interactionId)
      .in('student_id', studentIds.slice(i, i + CHUNK));
    if (data) out.push(...data);
  }
  return out;
}

// Defensive coercion — report_data is LLM-produced and occasionally imperfect (contract §7):
// keep only valid 0–5 ints / 0–2 scores; everything else becomes null and drops out of means.
const int05  = v => (Number.isInteger(v) && v >= 0 && v <= 5) ? v : null;
const score2 = v => (Number.isInteger(v) && v >= 0 && v <= 2) ? v : null;
const mean   = xs => { const a = xs.filter(n => n != null); return a.length ? a.reduce((s, n) => s + n, 0) / a.length : null; };
// effort → points, mirroring the DB trigger (013): 3–5 → 2, 1–2 → 1, 0/null → 0.
const pointsForEffort = e => e == null ? 0 : e >= 3 ? 2 : e >= 1 ? 1 : 0;

/**
 * Numeric-only rollup over a set of interaction reports. Pure (no I/O). Takes the rows from
 * loadInteractionData and folds them into every aggregate the contract marks computable
 * without AI. Free-text trend synthesis (cohort narrative, misconception clustering of novel
 * descriptions, reflection themes) is NOT done here — that's the deferred AI pass.
 */
export function summarizeReports(rows) {
  const list = (rows || []).map(r => ({
    effort: int05(r?.effort),
    score:  score2(r?.score),
    d:      (r?.report_data && typeof r.report_data === 'object') ? r.report_data : {},
  }));
  const n = list.length;

  // ── Effort & points (GRADED). Effort column is authoritative (receiver-copied); fall
  //    back to report_data.effort. Points prefer the trigger-derived score column.
  const effortHist = [0, 0, 0, 0, 0, 0];
  let effortNA = 0;
  const efforts = [], points = [];
  list.forEach(({ effort, score, d }) => {
    const e = effort != null ? effort : int05(d.effort);
    if (e == null) effortNA++; else { effortHist[e]++; efforts.push(e); }
    points.push(score != null ? score : pointsForEffort(e));
  });

  // ── Engagement metadata.
  const completed = list.filter(({ d }) => d.completed === true).length;
  const durations = list.map(({ d }) => typeof d.duration_min === 'number' ? d.duration_min : null);
  const messages  = list.map(({ d }) => Number.isInteger(d.message_count) ? d.message_count : null);

  // ── Understanding (DIAGNOSTIC).
  const overall = list.map(({ d }) => int05(d.overall_understanding));
  const self    = list.map(({ d }) => int05(d.self_rated_understanding));
  const overallAvg = mean(overall), selfAvg = mean(self);

  // ── Objectives — group by key, average understanding/confidence, carry inline label.
  const objMap = {};
  list.forEach(({ d }) => (Array.isArray(d.objectives) ? d.objectives : []).forEach(o => {
    if (!o || typeof o !== 'object' || !o.key) return;
    const m = (objMap[o.key] ||= { key: o.key, label: o.label || o.key, u: [], c: [] });
    if ((!m.label || m.label === m.key) && o.label) m.label = o.label;
    const u = int05(o.understanding); if (u != null) m.u.push(u);
    const c = int05(o.confidence);    if (c != null) m.c.push(c);
  }));
  const objectives = Object.values(objMap)
    .map(m => ({ key: m.key, label: m.label, assessed: m.u.length, understanding: mean(m.u), confidence: mean(m.c) }))
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
      pointsTotal: points.reduce((s, p) => s + p, 0), pointsMax: n * 2,
    },
    completed, completedPct: n ? Math.round((completed / n) * 100) : 0,
    durationAvg: mean(durations), messageAvg: mean(messages),
    understanding: { overall: overallAvg, self: selfAvg,
      gap: (overallAvg != null && selfAvg != null) ? selfAvg - overallAvg : null },
    objectives, misconceptions,
    reflection: { meaningful: reflMeaningful, assessed: reflAssessed,
      capped: reflAssessed - reflMeaningful, engagement: mean(reflEng), sentiment, topics },
    honor, flags,
  };
}

// ── Analysis export ──────────────────────────────────────────────────────────
// Name + student ID + score is not treated as PII here, so reports are exported as-is.
// Access is still gated by faculty auth + RLS (instructors: own sections; directors: course).

/**
 * Combine every report for one interaction into a single Markdown corpus for the analysis
 * AI — one block per student, labeled with name · student ID · section. Scope matches the
 * rest of the page: directors/admins get all sections in the course; instructors get their
 * own. RLS independently gates which report rows the caller can read.
 *
 * @returns {{ title:string, interactionId:string, studentCount:number, text:string }}
 */
export async function buildLessonCorpus(ctx, interactionId) {
  const course = ctx.currentCourse;
  const isDirector = ctx.isDirectorForCurrent();

  let secQuery = db.from('sections').select('id, instructor_id').eq('course_id', course).order('id');
  if (!isDirector) secQuery = secQuery.eq('instructor_id', ctx.instructorRow.id);
  const [{ data: secRows }, { data: itRow }] = await Promise.all([
    secQuery,
    db.from('interactions').select('id, title').eq('id', interactionId).maybeSingle(),
  ]);
  const title = itRow?.title || interactionId;
  const sectionIds = (secRows || []).map(s => s.id);
  if (!sectionIds.length) return { title, interactionId, studentCount: 0, text: '' };

  const { data: studentsRaw } = await db.from('students')
    .select('student_id, name, section_id').in('section_id', sectionIds);
  const students = studentsRaw || [];
  const byId = Object.fromEntries(students.map(s => [s.student_id, s]));
  const studentIds = students.map(s => s.student_id);

  const reports = [];
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const { data } = await db.from('preflight_interaction_reports')
      .select('student_id, report_markdown')
      .eq('interaction_id', interactionId)
      .in('student_id', studentIds.slice(i, i + CHUNK));
    if (data) reports.push(...data);
  }

  // Stable order: section, then student id.
  reports.sort((a, b) => {
    const sa = byId[a.student_id]?.section_id || '', sb = byId[b.student_id]?.section_id || '';
    return sa.localeCompare(sb) || String(a.student_id).localeCompare(String(b.student_id));
  });

  const head = `# ${title} — combined reports for analysis\n`
    + `Interaction: ${interactionId} · ${reports.length} report${reports.length === 1 ? '' : 's'}.\n`
    + `Each block is labeled with the student's name, ID, and section.\n`;

  const blocks = reports.map(r => {
    const stu = byId[r.student_id] || {};
    const who = stu.name ? `${stu.name} · ` : '';
    return `\n\n---\n\n## ${who}${r.student_id} · Section ${stu.section_id || '—'}\n\n${r.report_markdown || ''}`;
  });

  return { title, interactionId, studentCount: reports.length, text: head + blocks.join('') };
}
