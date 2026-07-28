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
  'id,points_possible,grading_mode,switch_policy,opens_at,due_at,due_by_day,is_published,position,' +
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

// updated_at is carried because it is the staleness clock for a review sign-off
// (migration 007): an attestation stops holding once a grade moves under it.
export const GRADE_SELECT =
  'id,enrollment_id,assignment_offering_id,submission_id,points_earned,points_possible,' +
  'effort,question_scores,diagnostic,source,is_finalized,graded_by,graded_at,updated_at';

/** A per-student deadline override, with its grant and revocation provenance (migration 007).
 *  ALWAYS pair this with `.is('revoked_at', null)` when computing a deadline — see the note
 *  on effectiveDue(). Fetch revoked rows only where the point is to report on them. */
export const EXTENSION_SELECT =
  'id,enrollment_id,assignment_offering_id,extended_due_at,reason,granted_by,created_at,' +
  'revoked_at,revoked_by,revoked_reason';

/** Faculty view of submissions/grades: reach through the enrollment to the person. */
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
    // The per-day schedule (migration 017). resolveDueBySection() folds this into dueBySection
    // for any section that has no explicit row of its own.
    dueByDay: (row.due_by_day && typeof row.due_by_day === 'object' && !Array.isArray(row.due_by_day))
      ? row.due_by_day : {},
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

/* ── The two pinned questions, and how to find them when nobody marked them ────
 *
 * `role` is the durable contract (LESSON-UNIFICATION.md §11) and faculty/lessons.html writes it
 * on every newly authored lesson. It was added AFTER the Fall 2026 preflights were built, though:
 * build_fall_preflights.py emits `{id, type, text, points}` with no role, and a read of the live
 * database on 2026-07-21 found **0 of 74** written activities carrying any role at all. A
 * role-only lookup therefore returns null for every lesson in the term.
 *
 * So: role, then the prompt text, then position. Text matching is normally a smell; here it is
 * anchored to a prompt the builder pins verbatim and a director does not hand-edit. The id
 * fallback is last and deliberately weakest — position is the first thing an edit changes.
 *
 * This mirrors `_pinned_question_id` in supabase/admin/lesson_aggregate.py, needle for needle.
 * The two engines must agree: the aggregator quotes reflections the browser also renders, and a
 * disagreement would show different students in the prose than in the panel. Both suites assert
 * the same cases so they cannot drift.
 */
const PINNED_TEXT_MATCH = {
  reading_time: 'how much time did you spend reading',
  reading_reflection: 'confusing or most interesting',
};
const PINNED_FALLBACK_ID = { reading_time: 'q1', reading_reflection: 'q2' };

/**
 * The question id for a pinned role — by role, else by prompt text, else by position.
 *
 * @returns {{id: string|null, how: 'role'|'text'|'position'|null}} `how` names the signal that
 *   identified it, so a caller can tell a positional guess from a declared contract.
 */
export function pinnedQuestion(activity, role) {
  const questions = questionsOf(activity).filter(q => q && typeof q === 'object');

  const byRole = questions.find(q => q.role === role && q.id);
  if (byRole) return { id: byRole.id, how: 'role' };

  const needle = PINNED_TEXT_MATCH[role];
  if (needle) {
    const byText = questions.find(q => String(q.text || '').toLowerCase().includes(needle) && q.id);
    if (byText) return { id: byText.id, how: 'text' };
  }

  const want = PINNED_FALLBACK_ID[role];
  const byPos = questions.find(q => q.id === want);
  return byPos ? { id: byPos.id, how: 'position' } : { id: null, how: null };
}

/** Which written question IS the reading reflection. See pinnedQuestion. */
export const reflectionQuestionId = activity => pinnedQuestion(activity, 'reading_reflection').id;
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
 * Resolve every section's deadline for one offering, folding the per-day schedule in.
 *
 * WHY THIS EXISTS. `assignment_due_dates` rows are written only when a director saves the lesson
 * in the editor, so a section created AFTER scheduling had no row and fell through to the
 * offering's `due_at` — which on every Fall 2026 row is the M-day date. A new T-day section was
 * therefore silently one day early on every lesson. `due_by_day` (migration 017) records the
 * per-day schedule as a stored fact, so a section's deadline can be derived from its own
 * `meeting_days` the moment it exists, with no lesson re-save and nothing to regenerate.
 *
 * An explicit row still wins, which is what keeps `assignment_due_dates` meaningful: it is now a
 * deliberate per-section OVERRIDE (the cancelled-class case) rather than the normal path.
 *
 * Call this once after shaping, wherever sections are already in hand, and assign the result onto
 * the offering. Every effectiveDue() caller then gets the derived dates without changing its own
 * signature — the alternative was threading `meeting_days` through six call sites.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {Array}  sections  [{ id, meeting_days }] — the offering's sections
 * @returns {{ dueBySection: object, dueDerivedFor: Set<string> }}
 */
export function resolveDueBySection(offering, sections) {
  const dueBySection = { ...(offering?.dueBySection || {}) };
  const dueDerivedFor = new Set();
  const byDay = offering?.dueByDay || {};
  (sections || []).forEach(sec => {
    if (!sec?.id || dueBySection[sec.id]) return;          // an explicit row always wins
    // First meeting day carrying a date wins, matching dueRowsFor(): a section meeting M/W/F
    // takes the M date. `meeting_days` is NOT NULL default '{}', so [] means "no day declared"
    // and the offering default is the honest answer for it.
    const day = (sec.meeting_days || []).find(d => byDay[d]);
    if (!day) return;
    dueBySection[sec.id] = byDay[day];
    dueDerivedFor.add(sec.id);
  });
  return { dueBySection, dueDerivedFor };
}

/** Apply resolveDueBySection() to an offering in place, and return it. */
export function withResolvedDue(offering, sections) {
  if (!offering) return offering;
  const { dueBySection, dueDerivedFor } = resolveDueBySection(offering, sections);
  offering.dueBySection = dueBySection;
  offering.dueDerivedFor = dueDerivedFor;
  return offering;
}

/**
 * Every section of the current offering, as resolveDueBySection() wants them.
 *
 * auth.js populates `ctx.sectionsById` with {id, code, meeting_days, period} for the WHOLE
 * offering, for students and faculty alike — so folding the per-day schedule in costs no extra
 * query anywhere. (`ctx.sectionIds` is the narrower "which do I teach / sit in" scope and is the
 * wrong input here: a deadline must resolve for any section the data mentions, not only mine.)
 */
export const offeringSections = (ctx) => Object.values(ctx?.sectionsById || {});

/** Shape a list of offering rows and fold in the per-day deadlines. The common case. */
export const shapeOfferings = (rows, ctx) =>
  (rows || []).map(shapeOffering).filter(Boolean)
    .map(o => withResolvedDue(o, offeringSections(ctx)));

/**
 * The deadline that actually applies to one student.
 *
 * Precedence, highest first:
 *   1. a per-student extension          (app.extensions)
 *   2. an explicit per-section override (app.assignment_due_dates)
 *   3. the per-day schedule             (assignment_offerings.due_by_day × section.meeting_days)
 *   4. the offering's default           (assignment_offerings.due_at)
 *
 * Level 3 is applied by resolveDueBySection() BEFORE this runs — it folds the derived dates into
 * `dueBySection` and records which ids it derived, so this function stays a plain lookup and the
 * six call sites did not have to grow a `meeting_days` argument. An offering that never went
 * through that step simply has no level 3, which is exactly the old behaviour.
 *
 * This replaces the old due_date_m / due_date_t pair and the `isMDay()` string sniffing
 * that went with it: the meeting pattern is now data on the section, and the override is
 * a row keyed by section, so nothing has to be inferred from a section code any more.
 *
 * A REVOKED extension is not an extension. Since migration 007 the row survives revocation
 * (so the director's report can still count it), which means the caller — not this function —
 * is responsible for not passing a revoked row's date in. Every query that feeds a deadline
 * filters `revoked_at IS NULL`; see EXTENSION_SELECT.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {string|null} sectionId
 * @param {string|null} extensionISO  an ACTIVE extension's date, or null
 * @param {Date} [now]  injected so tests are not clock-dependent
 * @returns {{ due: Date|null, isPast: boolean,
 *            source: 'extension'|'section'|'day'|'offering'|'none' }}
 */
export function effectiveDue(offering, sectionId, extensionISO, now = new Date()) {
  let raw = null;
  let source = 'none';
  if (extensionISO) {
    raw = extensionISO; source = 'extension';
  } else if (sectionId && offering?.dueBySection?.[sectionId]) {
    raw = offering.dueBySection[sectionId];
    source = offering?.dueDerivedFor?.has?.(sectionId) ? 'day' : 'section';
  } else if (offering?.dueAt) {
    raw = offering.dueAt; source = 'offering';
  }
  if (!raw) return { due: null, isPast: false, source: 'none' };
  const due = new Date(raw);
  if (isNaN(due)) return { due: null, isPast: false, source: 'none' };
  return { due, isPast: due < now, source };
}

/**
 * Was this submission handed in after the deadline that applied to THAT student?
 *
 * effectiveDue() answers "is the deadline behind us *now*", which is the question the backlog
 * queues ask. Grading asks a different one: "did this arrive late", comparing the commit time to
 * the deadline rather than the clock to the deadline. Without it a grader cannot tell a punctual
 * submission from one that landed four days after everyone else's, and silently gives both full
 * credit — `committed_at` was fetched and shaped all along, but nothing ever compared it.
 *
 * Extensions are honoured, because they are the whole point: a student who was granted until
 * Friday and submitted Thursday is NOT late, and must not be badged as if they were.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {string|null} sectionId
 * @param {string|null} extensionISO  an ACTIVE extension's date, or null (see effectiveDue)
 * @param {string|null} committedAt   submissions.committed_at
 * @param {number} [graceMs]  tolerance for clock skew; a submission inside it is not late
 * @returns {{ late: boolean, due: Date|null, at: Date|null, ms: number }} ms = how late, if late
 */
export function submissionLateness(offering, sectionId, extensionISO, committedAt, graceMs = 60000) {
  const none = { late: false, due: null, at: null, ms: 0 };
  if (!committedAt) return none;                       // draft — nothing was handed in
  const { due } = effectiveDue(offering, sectionId, extensionISO);
  if (!due) return none;                               // no deadline set → nothing can be late
  const at = new Date(committedAt);
  if (isNaN(at)) return none;
  const ms = at - due;
  return { late: ms > graceMs, due, at, ms };
}

/** "4 days late" / "3 hours late" / "12 minutes late" — for a submissionLateness() result. */
export function lateBy(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min late`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} late`;
  const d = Math.floor(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} late`;
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
 * Reading-time buckets, in minutes. Upper bound is exclusive; the last is open-ended.
 *
 * Reported as a distribution and a MEDIAN, never a mean. These are self-reported durations in
 * prose ("about half an hour", "a couple hours"), so the tail is long and one student who read
 * for three hours would drag a mean somewhere no individual sits. The median is the number a
 * director can act on, and the buckets are what show a bimodal class — the case that actually
 * matters, where half read properly and half skimmed.
 */
export const READING_BUCKETS = [
  { key: 'lt15',  label: '<15m',   min: 0,  max: 15 },
  { key: 'm15_29', label: '15–29m', min: 15, max: 30 },
  { key: 'm30_44', label: '30–44m', min: 30, max: 45 },
  { key: 'm45_59', label: '45–59m', min: 45, max: 60 },
  { key: 'gte60', label: '60m+',   min: 60, max: Infinity },
];

/** Whole positive minutes, or null. Zero is rejected on purpose: `/preflight-analyze` omits the
 *  key when a student stated no duration, so a 0 that reaches here is bad data, not a claim that
 *  someone read for zero minutes. */
export const minutes = v =>
  (Number.isFinite(v) && v > 0 && v < 1440) ? Math.round(v) : null;

/** Median of a numeric list, or null. */
export function median(xs) {
  const a = (xs || []).filter(n => n != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

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
 * The written path's `schema: 1` assessment, if /preflight-analyze has emitted one.
 *
 * `grades.diagnostic` is polymorphic, and this is the third thing it can hold: alongside the
 * per-question `q2_effort`/`q3_understanding` pair, a full schema:1 payload written by
 * /preflight-analyze (`.ai/skills/preflight-analyze/references/WRITTEN-SCHEMA1.md`) — the
 * written path's equivalent of what the artifact sends. It is what lets one cohort aggregator,
 * and `summarizeReports`, serve both modalities from one shape.
 *
 * Identified by `schema === 1` rather than by sniffing for fields, so a diagnostic holding only
 * the q2/q3 pair is never mistaken for one.
 *
 * @returns {object|null} the payload, or null when this grade carries no schema:1 assessment
 */
export function writtenReport(grade) {
  const d = grade?.diagnostic;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  return d.schema === 1 ? d : null;
}

/**
 * One student's effort for a lesson, whichever way they worked it, with its provenance.
 *
 * Precedence is "what a human graded" → "what the analysis assessed across the whole attempt"
 * → "the reading-reflection question alone" → "what the artifact claimed". The claim ranks last
 * on purpose: a student's own artifact writes it, so it is evidence until a grader confirms it,
 * not a grade.
 *
 * `report` (schema:1 `effort`) outranks `q2_effort` because it is the commensurable measure —
 * engagement across the whole attempt, gated by the reflection's meaningful-flag, exactly as the
 * artifact scores it. `q2_effort` scores the reflection answer alone and stays as the fallback
 * for grades written before /preflight-analyze emitted schema:1.
 *
 * @returns {{ effort: number|null, source: 'grade'|'report'|'diagnostic'|'claimed'|null }}
 */
export function effortSignal(grade, reportData) {
  const graded = int05(grade?.effort);
  if (graded != null) return { effort: graded, source: 'grade' };
  const assessed = int05(writtenReport(grade)?.effort);
  if (assessed != null) return { effort: assessed, source: 'report' };
  const { effort: diag } = writtenSignals(grade);
  if (diag != null) return { effort: diag, source: 'diagnostic' };
  const claimed = int05(reportData?.effort);
  if (claimed != null) return { effort: claimed, source: 'claimed' };
  return { effort: null, source: null };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Scope — what you may SEE vs what you personally TEACH
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The sections the viewer personally TEACHES in the current offering.
 *
 * Distinct from `ctx.sectionIds`, which is what they may SEE — for a director those are all
 * sections, and for a global admin they are every section in the offering. "My sections" has to
 * mean the narrower thing or the default scope would be meaningless for exactly the people who
 * have more than one section to choose between.
 *
 * A director's offering-wide staff row carries `section_id` NULL (auth.js documents this as the
 * gotcha: NULL means all sections, not none). That row grants visibility, not a teaching
 * assignment, so it is deliberately NOT counted here — a director who teaches M1A also holds a
 * section-scoped row for it. A director who teaches nothing gets an empty list, and the caller
 * falls back to the whole course.
 *
 * Lives here rather than in faculty-rollup.js (its original home, which still re-exports it)
 * because the Grade page and the dashboard's due-out row need it too, and neither should pull a
 * 56 KB aggregation module into the browser to ask a question about ctx.
 */
export function taughtSectionIds(ctx) {
  const rows = (ctx?.staff || []).filter(sa => sa.course_offering_id === ctx.currentOffering);
  return [...new Set(rows.map(sa => sa.section_id).filter(Boolean).map(String))];
}

/**
 * The sections whose work is YOURS TO ACT ON — taught ∩ visible, falling back to visible.
 *
 * This is the scope for anything that presents itself as a personal worklist: the dashboard's
 * due-out boxes and the Grade page's queue. A director may SEE the whole course, but a queue
 * headed "what you owe" that lists another instructor's ungraded section is not a worklist, it is
 * a course status report wearing one — and it is large enough that the reader stops opening it.
 *
 * The fallback matters: someone who staffs the offering but teaches no section of it (a pure
 * director, a grader) would otherwise get an empty queue rather than the course-wide one they
 * actually want. Empty-because-nothing-is-outstanding and empty-because-you-teach-nothing must
 * not look the same.
 *
 * @returns {{ ids: string[], narrowed: boolean }} `narrowed` = the caller may say "your sections"
 */
export function actionableSections(ctx) {
  const visible = (ctx?.sectionIds || []).map(String);
  const taught = new Set(taughtSectionIds(ctx));
  const mine = visible.filter(id => taught.has(id));
  return mine.length && mine.length < visible.length
    ? { ids: mine, narrowed: true }
    : { ids: visible, narrowed: false };
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
