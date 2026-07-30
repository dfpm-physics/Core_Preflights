// faculty-student.js — one cadet, everything (roadmap P1.2).
//
// This is the page the gradebook drills into, and it is the only screen in PREP that answers
// "what is going on with THIS student" rather than "what is going on with this lesson". That makes
// it the most useful page for an instructor and the most sensitive page in the app.
//
// FERPA — READ THIS BEFORE ADDING A QUERY
//   Everything about one identifiable cadet lands on one screen: name, cadet id, squadron, email,
//   every answer they wrote, every score, every AI judgment about their understanding, and now
//   their EI history. The roadmap's instruction is explicit and is not satisfied by a UI check:
//   "Instructor access must be section-scoped in RLS, not just in the UI."
//
//   Every table read below is section-scoped by an existing, tested policy — `students`,
//   `enrollments`, `grades`, `submissions`, `submission_activities` and `ei_sessions` all gate on
//   `staff_sections()`. app_rls_test.py proves it per persona. If you add a read here, check that
//   the table has an equivalent policy FIRST, and add a persona check to that suite. A page that
//   relies on nobody guessing a URL is not access control.
//
// THE TWO LAYERS, AGAIN
//   The gradebook deals in points because a grid cell cannot explain itself. This page is where
//   the 0-5 diagnostics belong — effort, understanding, misconceptions — because here there is
//   room to label them and say what they are not. They are never summed into the total.

import { db } from './supabase.js';
import {
  GRADE_SELECT, SUBMISSION_SELECT, shapeSubmission, shapeOffering, shapeOfferings, OFFERING_SELECT,
  EXTENSION_SELECT, effectiveDue, submissionLateness, lateBy, writtenReport, writtenSignals,
  effortSignal, questionsOf, chunked, int05,
} from './schema.js';
import { canonMisconceptionId } from './faculty-rollup.js';
import {
  cellState, totalsFor, bandOf, CELL, shortCode, loadGradebook, buildMatrix, matrixStats,
} from './faculty-gradebook.js';
import { loadEiForEnrollment } from './faculty-ei.js';

/* ---------------------------------------------------------------------------
 * Loader
 * ------------------------------------------------------------------------- */

/**
 * Everything for one enrollment.
 *
 * Keyed on the ENROLLMENT, not the cadet id, because that is what every policy keys on and what
 * scopes the read to one section in one term. A cadet id would have to be resolved to an enrollment
 * before anything could be read anyway, and resolving it in the browser would mean a query that
 * is not itself section-scoped.
 */
export async function loadStudentDetail(ctx, enrollmentId) {
  if (!ctx?.currentOffering) return { noCourse: true };
  if (!enrollmentId) return { notFound: true };

  const { data: enr, error: enrErr } = await db.from('enrollments')
    .select('id, student_id, section_id, status, '
          + 'students!inner(student_id, name, email, squadron, auth_user_id, major_1, advisor_name), '
          + 'sections!inner(id, code, meeting_days, period, course_offering_id)')
    .eq('id', enrollmentId).maybeSingle();

  if (enrErr) return { error: enrErr };
  // RLS returns an empty result rather than an error when the caller may not see this enrollment,
  // so "not found" and "not yours" are the same answer here — deliberately. Telling an instructor
  // that a cadet exists but belongs to somebody else is itself a disclosure.
  if (!enr) return { notFound: true };
  if (enr.sections?.course_offering_id !== ctx.currentOffering) return { otherCourse: true };

  const [offRes, gradeRes, subRes, extRes, eiRes] = await Promise.all([
    db.from('assignment_offerings').select(OFFERING_SELECT)
      .eq('course_offering_id', ctx.currentOffering).eq('is_published', true)
      .order('position', { ascending: true, nullsFirst: false }),
    db.from('grades').select(GRADE_SELECT).eq('enrollment_id', enrollmentId),
    db.from('submissions').select(SUBMISSION_SELECT).eq('enrollment_id', enrollmentId),
    db.from('extensions').select(EXTENSION_SELECT).eq('enrollment_id', enrollmentId)
      .is('revoked_at', null),
    loadEiForEnrollment(enrollmentId),
  ]);
  if (offRes.error) return { error: offRes.error };
  if (gradeRes.error) return { error: gradeRes.error };
  if (subRes.error) return { error: subRes.error };

  const offerings = shapeOfferings(offRes.data, ctx);
  const grades = gradeRes.data || [];
  const submissions = (subRes.data || []).map(shapeSubmission);
  const extensions = extRes.data || [];

  return {
    noCourse: false,
    enrollment: {
      enrollmentId: enr.id,
      studentId: enr.student_id,
      sectionId: enr.section_id,
      sectionCode: enr.sections?.code || '',
      status: enr.status,
    },
    student: enr.students || {},
    offerings, grades, submissions, extensions,
    ei: eiRes.rows || [],
    eiError: eiRes.error || null,
  };
}

/**
 * The class context for the comparison card. Deliberately a SEPARATE call — it reads the cohort,
 * which is a much wider query than the rest of this page, and the page must render without it if
 * it is slow or denied. A missing comparison is a missing card, not a broken page.
 */
export async function loadClassContext(ctx, sectionId) {
  const out = { section: null, course: null };
  try {
    const all = await loadGradebook(ctx, ctx.sectionIds || []);
    if (all?.error || all?.noCourse) return out;
    const m = buildMatrix(all);
    out.course = m.stats;
    out.section = matrixStats(m.rows.filter((r) => String(r.sectionId) === String(sectionId)));
  } catch { /* comparison is optional; see above */ }
  return out;
}

/* ---------------------------------------------------------------------------
 * Per-lesson rows — the table
 * ------------------------------------------------------------------------- */

/**
 * One row per published lesson, in due order, carrying grade, diagnostics and the student's
 * actual work. This is where the two layers sit side by side and it is the only place they should.
 */
export function lessonRows({ offerings, grades, submissions, extensions, enrollment,
                             now = new Date() }) {
  const gradeBy = new Map((grades || []).map((g) => [g.assignment_offering_id, g]));
  const subBy = new Map((submissions || []).map((s) => [s.offeringId, s]));
  const extBy = new Map((extensions || []).map((x) => [x.assignment_offering_id, x.extended_due_at]));
  const sectionId = enrollment?.sectionId;

  return [...(offerings || [])]
    .sort((a, b) => {
      const da = a.dueAt ? +new Date(a.dueAt) : Infinity;
      const dbb = b.dueAt ? +new Date(b.dueAt) : Infinity;
      return da - dbb || (a.position ?? 0) - (b.position ?? 0);
    })
    .map((o) => {
      const grade = gradeBy.get(o.offeringId) || null;
      const sub = subBy.get(o.offeringId) || null;
      const extensionISO = extBy.get(o.offeringId) || null;

      // cellState wants the light offering shape; shapeOffering is a superset, so it fits.
      const cell = cellState({
        grade,
        submission: sub ? { status: sub.status, committed_at: sub.committedAt } : null,
        offering: o, sectionId, extensionISO, now,
      });

      const interactiveWork = o.interactive ? sub?.activities?.[o.interactive.id] : null;
      const writtenWork = o.written ? sub?.activities?.[o.written.id] : null;
      const reportData = interactiveWork?.content || null;

      const lateness = sub?.committedAt
        ? submissionLateness(o, sectionId, extensionISO, sub.committedAt)
        : { late: false, ms: 0 };

      const signals = writtenSignals(grade);
      const report = writtenReport(grade) || (reportData && reportData.schema === 1 ? reportData : null);

      return {
        offeringId: o.offeringId,
        slug: o.slug,
        title: o.title || o.slug,
        code: shortCode(o.slug, o.title),
        due: cell.due,
        extended: !!extensionISO,
        pointsPossible: o.pointsPossible,
        cell,
        late: !!lateness.late,
        lateLabel: lateness.late ? lateBy(lateness.ms) : '',
        // Layer two. Never summed into cell.points — see the header.
        effort: effortSignal(grade, reportData).effort,
        understanding: signals.understanding != null
          ? signals.understanding
          : int05(report?.overall_understanding),
        report,
        writtenAnswers: writtenWork?.content || null,
        writtenQuestions: o.written ? questionsOf(o.written) : [],
        reportMarkdown: interactiveWork?.reportMarkdown || null,
        modality: interactiveWork ? (writtenWork ? 'both' : 'interactive')
                : writtenWork ? 'written' : null,
      };
    });
}

/** Row totals, reusing the gradebook's arithmetic so the two pages cannot disagree. */
export function studentTotals(rows) {
  const t = totalsFor(rows.map((r) => r.cell));
  return { ...t, band: bandOf(t.pct) };
}

/**
 * Zero-point questions are scored but never rendered (CORE.md §2; grade.html:207,215 does the same
 * filter on the Grade tab). Q1 is the reading-time reflection and showing it here would reintroduce
 * on a per-student page exactly the privacy rule the Grade tab keeps.
 */
export function visibleQuestions(questions) {
  return (questions || []).filter((q) => Number(q?.points ?? 0) > 0);
}

/* ---------------------------------------------------------------------------
 * Misconceptions across the term
 * ------------------------------------------------------------------------- */

/**
 * Fold every misconception the term has recorded against this cadet into one ranked list.
 *
 * This is the one view in PREP that answers "is this student repeatedly wrong about the SAME
 * thing?" — a question no per-lesson screen can answer and the single most useful thing an
 * advisor can know before a conversation.
 *
 * Ids are canonicalized with the same helper the rollup uses, so `scalar-sum`, `Scalar-Sum` and
 * `scalar sum` fold together here exactly as they do on the cohort view. Using a different rule
 * would make one page contradict the other.
 */
export function foldMisconceptions(rows, aliases = null) {
  const byId = new Map();
  for (const r of rows || []) {
    const list = r?.report?.misconceptions;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const raw = typeof m === 'string' ? m : m?.id;
      const id = canonMisconceptionId(raw, aliases);
      if (!id) continue;
      const cur = byId.get(id) || { id, count: 0, lessons: [], description: '', evidence: [] };
      cur.count += 1;
      cur.lessons.push({ code: r.code, title: r.title, offeringId: r.offeringId });
      if (!cur.description && typeof m === 'object' && m?.description) cur.description = m.description;
      if (typeof m === 'object' && m?.evidence) cur.evidence.push(m.evidence);
      byId.set(id, cur);
    }
  }
  // Repeats first — a misconception seen three times is the conversation; one seen once is noise.
  return [...byId.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/* ---------------------------------------------------------------------------
 * The comment card
 * ------------------------------------------------------------------------- */

const pctStr = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);

/**
 * An advising blurb the instructor pastes into an email.
 *
 * Taken wholesale from djGradebookProject's Comment Card, which is the best idea in that project:
 * the instructor does not want a report, they want a paragraph they can send in the next thirty
 * seconds. It is the Report tab's copy-for-slides muscle pointed at one student.
 *
 * PLAIN TEXT, deliberately. It is going into an email or an advising system, and every one of
 * those mangles HTML differently. It also means the output is exactly what the instructor sees
 * before they copy it, which is the property that makes them trust it.
 *
 * NOTE it names the cadet. That is the point — it is addressed to a person about a person — but it
 * also means this string must never be built for a "copy all" of a whole section, which would be a
 * roster leak wearing a helpful hat. There is deliberately no such control.
 */
export function commentCard({ student, enrollment, totals, rows, ei = [], classStats = null,
                              freeText = '' }) {
  const name = student?.name || String(enrollment?.studentId || '');
  const L = [];

  L.push(`${name} — ${enrollment?.sectionCode || ''}`.trim());
  L.push('');
  L.push(`Grade to date: ${totals.earned} / ${totals.possible} (${pctStr(totals.pct)})`);

  if (classStats?.median != null && totals.pct != null) {
    const d = Math.round((totals.pct - classStats.median) * 100);
    const where = d > 1 ? `${d} points above` : d < -1 ? `${Math.abs(d)} points below` : 'level with';
    L.push(`Section median: ${pctStr(classStats.median)} — ${where} the median.`);
  }

  const missing = rows.filter((r) => r.cell.state === CELL.MISSING);
  if (missing.length) {
    L.push('');
    L.push(`Missing work (${missing.length}):`);
    // With the due date, because "you have three missing assignments" starts an argument and
    // "Preflight 4, due Aug 24" ends one.
    missing.forEach((r) => {
      L.push(`  - ${r.title}${r.due ? ` (due ${new Date(r.due).toLocaleDateString()})` : ''}`);
    });
  } else {
    L.push('');
    L.push('Missing work: none.');
  }

  const understandings = rows.map((r) => r.understanding).filter((u) => u != null);
  if (understandings.length) {
    const avg = understandings.reduce((a, b) => a + b, 0) / understandings.length;
    L.push('');
    L.push(`Demonstrated understanding: ${avg.toFixed(1)} / 5 across ${understandings.length} graded assignment(s).`);
  }

  const mc = foldMisconceptions(rows).filter((m) => m.count > 1);
  if (mc.length) {
    L.push('');
    L.push('Recurring sticking points:');
    mc.slice(0, 3).forEach((m) => L.push(`  - ${m.description || m.id} (seen ${m.count}x)`));
  }

  if (ei.length) {
    const last = ei[0];
    L.push('');
    L.push(`Extra instruction: ${ei.length} session(s)`
         + (last?.started_at ? `, most recently ${new Date(last.started_at).toLocaleDateString()}.` : '.'));
  }

  if (freeText && freeText.trim()) {
    L.push('');
    L.push(freeText.trim());
  }
  return L.join('\n');
}

/* ---------------------------------------------------------------------------
 * Back link
 * ------------------------------------------------------------------------- */

const ALLOWED_BACK = new Set([
  'gradebook.html', 'grade.html', 'dashboard.html', 'report.html',
  // `extensions.html` was on this list and came off on 2026-07-30. The report is Course Admin's
  // Extensions tab now and that file is a redirect into it — so allowing it would send "Done"
  // through a bounce to land on the page `admin.html` (below) already reaches directly.
  // admin.html replaced roster.html here on 2026-07-23: the roster moved into Course Admin's
  // Students tab, whose table links a cadet's name to this page. Without it, a director drilling
  // in from that list is bounced to the gradebook instead of back to what they were working
  // through. (It returns to the tab the page opens on, which IS Students — good enough, and a
  // fragment would have to survive this allowlist to do better.)
  'admin.html',
]);

/**
 * "Done" returns you wherever you came from, so this page works equally as a gradebook drill-down
 * and a roster drill-down (djGradebookProject's `back_url`).
 *
 * ALLOWLISTED, not merely same-origin-checked. `document.referrer` is attacker-controllable — a
 * page anywhere can link here with any referrer — and a "back" link built from it unvalidated is
 * an open redirect. An allowlist of the faculty pages that legitimately link here costs nothing
 * and cannot be talked into pointing somewhere else.
 */
export function backTarget(referrer, fallback = 'gradebook.html') {
  if (!referrer) return fallback;
  let file;
  try {
    file = new URL(referrer, 'https://example.invalid').pathname.split('/').pop() || '';
  } catch { return fallback; }
  return ALLOWED_BACK.has(file) ? file : fallback;
}
