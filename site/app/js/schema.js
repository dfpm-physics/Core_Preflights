// schema.js — the single place that knows the shape of the PREP v2 model (schema `app`).
//
// WHY THIS FILE EXISTS
//   The v2 model splits what `public` kept in one row across four layers: an assignment is
//   defined (catalogue), scheduled (assignment_offerings), worked (submissions) and scored
//   (grades). Reassembling those four into the one object a page wants to render is the same
//   job on every page, and getting it subtly different per page is exactly how the old
//   frontend drifted. So the SELECT strings and the derived-status rules live here once.
//
// TWO KINDS OF EXPORT, deliberately separated:
//   • SELECT constants — the exact PostgREST projections the app ships. Tests assert against
//     these strings, so a test proves what the browser actually sends, not a paraphrase.
//   • Pure functions — no `db`, no DOM, no clock except where a date is passed in. Every
//     status/points/lock rule is here and unit-testable without a network or a login.
//
// Query-running lives in the *-data.js modules; this file stays dependency-free on purpose.

/* ══════════════════════════════════════════════════════════════════════════════
 * SELECT projections
 * ════════════════════════════════════════════════════════════════════════════ */

/** An assignment offering with everything needed to render it: the library definition,
 *  which activities are live and in what role, and any per-section deadline overrides. */
export const OFFERING_SELECT =
  'id,points_possible,grading_mode,switch_policy,opens_at,due_at,is_published,position,' +
  'course_offering_id,' +
  'assignments!inner(id,slug,title,description,objectives,kind_id,course_id),' +
  'offering_activities(grading_role,available_after,is_visible,position,' +
  'activities(id,slug,modality,title,content)),' +
  'assignment_due_dates(section_id,due_at)';

/** A student's own work: the choice + lock, plus each activity they engaged with. */
export const SUBMISSION_SELECT =
  'id,enrollment_id,assignment_offering_id,chosen_activity_id,status,committed_at,' +
  'unlocked_by,unlocked_at,updated_at,' +
  'submission_activities(id,activity_id,content,report_markdown,payload_bytes,is_final,updated_at)';

export const GRADE_SELECT =
  'id,enrollment_id,assignment_offering_id,submission_id,points_earned,points_possible,' +
  'effort,question_scores,diagnostic,source,is_finalized,graded_by,graded_at';

/** Faculty view of submissions/grades: reach through the enrolment to the person. */
export const ENROLLMENT_JOIN = 'enrollments!inner(id,student_id,section_id,students(student_id,name))';

export const STAFF_SELECT =
  'id,role,section_id,course_offering_id,' +
  'course_offerings(id,course_id,term_id,courses(id,code,title),' +
  'terms(id,code,label,starts_on,ends_on,grades_due_on))';

export const ENROLLMENT_SELECT =
  'id,status,section_id,student_id,' +
  'sections(id,code,meeting_days,period,course_offering_id,' +
  'course_offerings(id,course_id,courses(id,code,title),terms(id,code,label)))';

/* ══════════════════════════════════════════════════════════════════════════════
 * Shaping — flatten the nested PostgREST result into one flat view-model
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize one `assignment_offerings` row (with embeds) into the object pages render.
 *
 * Note on ordering: `offering_activities` carries its own `position`, and the library
 * `activities` row carries another. The offering's position wins — it is the per-term
 * decision — with the activity slug as a stable tiebreak so ordering never depends on
 * the order PostgREST happened to return embedded rows in.
 */
export function shapeOffering(row) {
  if (!row) return null;
  const a = row.assignments || {};
  const activities = (row.offering_activities || [])
    .map(oa => {
      const act = oa.activities || {};
      return {
        id: act.id,
        slug: act.slug,
        modality: act.modality,
        title: act.title,
        content: act.content || {},
        gradingRole: oa.grading_role,
        availableAfter: oa.available_after,
        isVisible: oa.is_visible,
        position: oa.position ?? 0,
      };
    })
    .sort((x, y) => (x.position - y.position) || String(x.slug || '').localeCompare(String(y.slug || '')));

  const dueBySection = {};
  (row.assignment_due_dates || []).forEach(d => { dueBySection[d.section_id] = d.due_at; });

  const graded = activities.filter(x => x.gradingRole === 'graded');

  return {
    offeringId: row.id,
    courseOfferingId: row.course_offering_id,
    assignmentId: a.id,
    slug: a.slug,
    title: a.title,
    description: a.description,
    // Declared as a jsonb ARRAY ([{key,label}]), but the migration wrote `{}` — an empty
    // OBJECT — into all 74 rows, and `x || []` passes that straight through because `{}` is
    // truthy. Anything calling .map() on it would throw. Coerce rather than trust the column:
    // the shape contract is what consumers rely on, and one bad writer should not reach them.
    objectives: Array.isArray(a.objectives) ? a.objectives : [],
    kind: a.kind_id,
    courseId: a.course_id,
    pointsPossible: Number(row.points_possible ?? 0),
    gradingMode: row.grading_mode,
    switchPolicy: row.switch_policy,
    opensAt: row.opens_at,
    dueAt: row.due_at,
    isPublished: row.is_published,
    position: row.position,
    activities,
    dueBySection,
    // "single vs choice" is DERIVED, never stored — see 001_core_model.sql. Two or more
    // graded activities this term means the student picks; exactly one means it is required.
    gradedActivities: graded,
    isChoice: graded.length > 1,
    written: activities.find(x => x.modality === 'written') || null,
    interactive: activities.find(x => x.modality === 'interactive') || null,
  };
}

/** Normalize a submission row (with its submission_activities) for rendering. */
export function shapeSubmission(row) {
  if (!row) return null;
  const byActivity = {};
  (row.submission_activities || []).forEach(sa => {
    byActivity[sa.activity_id] = {
      id: sa.id,
      activityId: sa.activity_id,
      content: sa.content || null,
      reportMarkdown: sa.report_markdown || null,
      payloadBytes: sa.payload_bytes ?? null,
      isFinal: !!sa.is_final,
      updatedAt: sa.updated_at,
    };
  });
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    offeringId: row.assignment_offering_id,
    chosenActivityId: row.chosen_activity_id,
    status: row.status,
    committedAt: row.committed_at,
    unlockedBy: row.unlocked_by,
    unlockedAt: row.unlocked_at,
    updatedAt: row.updated_at,
    activities: byActivity,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Content accessors — `content` shape varies by modality (001_core_model.sql)
 *   written:     { questions:[{id,text,type,points,figure_url,...}], reading_link,
 *                  reference_pdf, reference_pages }
 *   interactive: { artifact_url, description }
 * ════════════════════════════════════════════════════════════════════════════ */

export function questionsOf(activity) {
  const q = activity?.content?.questions;
  return Array.isArray(q) ? q : [];
}
export function artifactUrlOf(activity) { return activity?.content?.artifact_url || null; }
export function readingLinkOf(activity) { return activity?.content?.reading_link || null; }

/** Total points declared by a written activity's questions (0 when it declares none). */
export function questionPoints(activity) {
  return questionsOf(activity).reduce((s, q) => s + (Number(q.points) || 0), 0);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Deadlines
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The deadline that actually applies to one student.
 *
 * Precedence, highest first:
 *   1. a per-student extension          (app.extensions)
 *   2. a per-section override           (app.assignment_due_dates)
 *   3. the offering's default           (assignment_offerings.due_at)
 *
 * This replaces the old due_date_m / due_date_t pair and the `isMDay()` string sniffing
 * that went with it: the meeting pattern is now data on the section, and the override is
 * a row keyed by section, so nothing has to be inferred from a section code any more.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {string|null} sectionId
 * @param {string|null} extensionISO
 * @param {Date} [now]  injected so tests are not clock-dependent
 * @returns {{ due: Date|null, isPast: boolean, source: 'extension'|'section'|'offering'|'none' }}
 */
export function effectiveDue(offering, sectionId, extensionISO, now = new Date()) {
  let raw = null;
  let source = 'none';
  if (extensionISO) {
    raw = extensionISO; source = 'extension';
  } else if (sectionId && offering?.dueBySection?.[sectionId]) {
    raw = offering.dueBySection[sectionId]; source = 'section';
  } else if (offering?.dueAt) {
    raw = offering.dueAt; source = 'offering';
  }
  if (!raw) return { due: null, isPast: false, source: 'none' };
  const due = new Date(raw);
  if (isNaN(due)) return { due: null, isPast: false, source: 'none' };
  return { due, isPast: due < now, source };
}

/** Has this offering opened yet? `opens_at` empty means always open. */
export function isOpen(offering, now = new Date()) {
  if (!offering?.opensAt) return true;
  const o = new Date(offering.opensAt);
  return isNaN(o) ? true : o <= now;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Availability + locking — the rules the DB also enforces, mirrored for the UI
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * May the student work this activity right now?
 * `available_after`: always | submit (unlocks once they commit) | due (study mode).
 * Mirrors offering_activities.available_after. The DB does not gate this — RLS only
 * hides invisible rows — so this is a UI affordance, not a security boundary.
 */
export function isActivityAvailable(activity, { submission, isPast }) {
  if (!activity || activity.isVisible === false) return false;
  switch (activity.availableAfter) {
    case 'submit': return submission?.status === 'committed';
    case 'due':    return !!isPast;
    default:       return true;   // 'always'
  }
}

/**
 * May the student still change which activity counts for credit?
 * Mirrors app.submissions_lock_activity() so the UI refuses before the DB has to.
 *   free_until_commit       — locked the moment they commit
 *   lock_on_commit          — same, but an instructor unlock can release it
 *   lock_on_start           — same
 *   one_way_to_interactive  — written → interactive stays allowed after commit
 */
export function canSwitchActivity(offering, submission, targetActivity) {
  if (!submission || !submission.chosenActivityId) return true;      // nothing committed yet
  if (submission.status !== 'committed') return true;
  if (submission.chosenActivityId === targetActivity?.id) return true;

  if (offering?.switchPolicy === 'one_way_to_interactive') {
    const from = offering.activities.find(a => a.id === submission.chosenActivityId);
    return from?.modality === 'written' && targetActivity?.modality === 'interactive';
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Points
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Effort (0–5) → points, scaled to the offering's value.
 * MUST match app.grades_points_from_effort() exactly (001_core_model.sql), which preserves
 * the migration-013 curve: 3–5 → full, 1–2 → half, 0/null → zero. This is display-only —
 * the trigger is authoritative and overwrites points_earned on write.
 */
export function pointsFromEffort(effort, pointsPossible) {
  if (effort == null) return 0;
  if (effort >= 3) return pointsPossible;
  if (effort >= 1) return Math.round((pointsPossible / 2) * 100) / 100;
  return 0;
}

/** Points a grade is worth for display, honouring the offering's grading mode. */
export function displayPoints(grade, offering) {
  if (!grade) return null;
  if (offering?.gradingMode === 'effort') {
    return pointsFromEffort(grade.effort, Number(grade.points_possible ?? offering.pointsPossible ?? 0));
  }
  return grade.points_earned == null ? null : Number(grade.points_earned);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Derived status — one definition, used by every page
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The student-facing state of one assignment offering.
 *
 * 'graded'      a finalized grade exists (RLS means a student can only ever see finalized ones)
 * 'pending'     committed, deadline passed, not yet finalized
 * 'submitted'   committed, still before the deadline
 * 'in-progress' work saved but not committed
 * 'overdue'     deadline passed with nothing committed
 * 'not-started' nothing at all
 *
 * Differs from the old rule in one way worth naming: `public` treated "a responses row
 * exists" as submitted, so an autosaved draft counted as a submission. Committing is now
 * explicit, which is why 'in-progress' exists as a distinct state.
 */
export function deriveStatus({ submission, grade, isPast }) {
  if (grade && grade.is_finalized) return 'graded';
  const committed = submission?.status === 'committed';
  if (committed) return isPast ? 'pending' : 'submitted';
  const hasWork = submission && Object.keys(submission.activities || {}).length > 0;
  if (hasWork) return isPast ? 'overdue' : 'in-progress';
  return isPast ? 'overdue' : 'not-started';
}

/** Count answered questions in a written activity's saved content. */
export function answeredCount(answers, questions) {
  if (!answers) return 0;
  return (questions || []).filter(q => String(answers[q.id] ?? '').trim().length > 0).length;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Learner signals — the two numbers BOTH modalities produce
 * ════════════════════════════════════════════════════════════════════════════ */
//
// A lesson can be worked two ways, and until now only the interactive path fed the summaries.
// That was never a design decision — it is just where the code started. Both paths in fact
// emit the same two 0–5 measures, and this section is the one place that says where each
// lives so no page has to re-derive it:
//
//                        EFFORT (graded)              UNDERSTANDING (diagnostic)
//   interactive   grades.effort, else the artifact's  report_data.overall_understanding
//                 claimed report_data.effort          + report_data.objectives[].understanding
//   written       grades.diagnostic.q2_effort         grades.diagnostic.q3_understanding
//
// EFFORT IS THE SAME MEASUREMENT ON BOTH SIDES. Q2 of a written preflight *is* the reading
// reflection, and QUESTION-DIAGNOSTICS.md scores it by adapting the same engagement rubric
// (INTERACTION-DATA-CONTRACT §5.2) the artifact applies. So the two are one population and
// summing them into a single distribution is the honest reading, not a convenience.
//
// UNDERSTANDING IS NOT. The interactive path resolves understanding per objective; the
// written path produces one number for one free-response question. We therefore carry the
// written value as a single synthetic objective (below) rather than pretending it decomposes.

/** Defensive 0–5 coercion. `report_data` is LLM-produced and occasionally imperfect
 *  (INTERACTION-DATA-CONTRACT §7); anything that is not a clean 0–5 int becomes null and
 *  drops out of every mean rather than skewing it. */
export const int05 = v => (Number.isInteger(v) && v >= 0 && v <= 5) ? v : null;

/** The synthetic objective the written free-response question contributes. Kept as a key that
 *  cannot collide with an authored objective key, with the label the faculty UI shows. */
export const FREE_RESPONSE_KEY = '__free_response__';
export const FREE_RESPONSE_LABEL = 'Free response';

/**
 * The written path's two diagnostics, pulled off a `grades` row.
 *
 * `grades.diagnostic` is polymorphic by modality: for an interactive grade it holds the frozen
 * schema:1 payload (overall_understanding, objectives[], …), for a written one the pair
 * `{q2_effort, q3_understanding}` that /preflight-analyze writes. Both keys are simply absent
 * on an interactive grade, so this is safe to call on any grade row — it returns nulls rather
 * than needing the caller to know which kind it holds.
 *
 * Note that written offerings are `grading_mode='points'` (the skill refuses to run against an
 * effort-graded one, because the trigger would overwrite `points_earned`). So `grades.effort`
 * is NULL on the written path and this diagnostic is the *only* place its effort exists.
 *
 * @returns {{ effort: number|null, understanding: number|null }}
 */
export function writtenSignals(grade) {
  const d = grade?.diagnostic;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { effort: null, understanding: null };
  return { effort: int05(d.q2_effort), understanding: int05(d.q3_understanding) };
}

/**
 * One student's effort for a lesson, whichever way they worked it, with its provenance.
 *
 * Precedence is "what a human graded" → "what the analysis produced" → "what the artifact
 * claimed". The claim ranks last on purpose: a student's own artifact writes it, so it is
 * evidence until a grader confirms it, not a grade.
 *
 * @returns {{ effort: number|null, source: 'grade'|'diagnostic'|'claimed'|null }}
 */
export function effortSignal(grade, reportData) {
  const graded = int05(grade?.effort);
  if (graded != null) return { effort: graded, source: 'grade' };
  const { effort: diag } = writtenSignals(grade);
  if (diag != null) return { effort: diag, source: 'diagnostic' };
  const claimed = int05(reportData?.effort);
  if (claimed != null) return { effort: claimed, source: 'claimed' };
  return { effort: null, source: null };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Misc
 * ════════════════════════════════════════════════════════════════════════════ */

/** Chunk an id list so `.in()` URLs stay under GET length limits on large courses. */
export const CHUNK = 300;
export function chunked(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Pull a lesson number out of a slug ("preflight-08" / "lesson-08-charge") or a title. */
export function lessonNumber(slug, title) {
  const m = String(slug || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/)
        || String(title || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/);
  return m ? parseInt(m[1], 10) : null;
}
