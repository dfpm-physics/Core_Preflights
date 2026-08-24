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

/* ── The student-side pair. Same tables, deliberately less. ─────────────────────────────────
 *
 * The two constants above are FACULTY-shaped and were being used by the student loaders too,
 * which shipped every diagnostic PREP holds about a cadet to that cadet's own browser on every
 * page load. RLS permits it — these are their own rows (`sa_own`, `grades_own_finalized`) — so
 * nothing was leaking across students. But the site was asking for columns it never renders, and
 * the most sensitive strings the system produces were among them:
 *
 *   • `submission_activities.content` on an INTERACTIVE activity is the contract's `d` payload —
 *     `honor.status` (`disclosed` / `concern`) and its free-text `note`, `flags.needs_follow_up`,
 *     `reading_reflection.meaningful`, per-objective understanding, misconceptions. The faculty
 *     rollup turns those into "Inappropriate resources" and "Integrity concern" pills. A cadet
 *     with devtools open could read the finding about themselves.
 *   • `grades.diagnostic` is the same material for a written preflight.
 *   • `report_markdown` is the prose report; no student page has ever rendered it.
 *
 * `grades_own_finalized` at least withholds a grade until it is published. `sa_own` has no such
 * gate: an interactive `d` is readable by its author the instant it is written.
 *
 * PROJECT.md claimed student pages "omit it from their explicit Supabase selects and rendering".
 * The rendering half was true; this makes the other half true. The same reasoning — and the same
 * shape of fix — is already in faculty-gradebook.js (`GB_GRADE_SELECT` / `GB_SUBMISSION_SELECT`).
 *
 * WHY `content` IS ABSENT HERE RATHER THAN FILTERED. It is one column carrying two unrelated
 * things: a cadet's own written ANSWERS on a written activity, which they must have to resume a
 * draft, and the AI's assessment of them on an interactive one. PostgREST cannot select different
 * columns for different rows, so the student loader fetches this shape and then asks separately
 * for the written activities' content by `activity_id` — see loadAssignmentStatuses().
 */
export const SUBMISSION_SELECT_STUDENT =
  'id,enrollment_id,assignment_offering_id,chosen_activity_id,status,committed_at,' +
  'unlocked_by,unlocked_at,updated_at,' +
  'submission_activities(id,activity_id,payload_bytes,is_final,updated_at)';

/* `instructor_note` is projected as a SINGLE JSONB KEY, never the column around it. An interactive
 * grade has no question_scores, so it has nowhere else to carry the instructor's reason — and a
 * score withheld without one is the thing the course rule exists to prevent. Selecting
 * `diagnostic` outright would undo the privacy fix documented above: that column holds the whole
 * schema:1 assessment (honor.status and its free text, needs_follow_up, per-objective
 * understanding, misconceptions), which is the material the faculty rollup turns into
 * "Integrity concern" pills. PostgREST projects the one key; the rest never leaves the server. */
export const GRADE_SELECT_STUDENT =
  'id,enrollment_id,assignment_offering_id,submission_id,points_earned,points_possible,' +
  'effort,question_scores,source,is_finalized,graded_by,graded_at,updated_at,' +
  'instructor_note:diagnostic->instructor_note';

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
/** The two access values, and the reason there is a default.
 *
 *  'open'           anyone offered this path may take it — the historical behaviour, and what
 *                   every activity written before 2026-08-24 reads as.
 *  'by_permission'  the path carries credit, but the lesson expects the other one; a student
 *                   takes it only with their instructor's permission.
 *
 *  ANYTHING UNRECOGNISED READS AS 'open', deliberately. This flag can only ever take a route
 *  AWAY from a student, so a typo or a half-written value must fail toward offering the work,
 *  not toward withholding it.
 */
export const ACCESS_OPEN = 'open';
export const ACCESS_BY_PERMISSION = 'by_permission';

function accessOf(content) {
  return content?.access === ACCESS_BY_PERMISSION ? ACCESS_BY_PERMISSION : ACCESS_OPEN;
}

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
        // Whether this path may be taken freely or only with an instructor's say-so. Stored in
        // the activity's own content because there is no column for it and DDL on `app` is
        // coordinated (CORE.md section 0); `activities` rows have been per-offering since the
        // 2026-07-28 content isolation, so a flag here is already a per-term fact.
        access: accessOf(act.content),
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

/**
 * The three-way policy an offering expresses, read back out of which activities carry credit.
 *
 * Lives here rather than beside the editor that writes it because BOTH sides must agree: the
 * director picks a label, `roleFor()` turns it into grading_role, and every student surface has
 * to read the same answer back out. It used to live only in faculty-lessons.js, and the student
 * lesson page re-derived its own version from `interactiveGraded` alone — which cannot tell
 * "both graded" from "only the interactive is graded", so an interaction-only lesson rendered as
 * a free choice and offered the written path it had just taken away.
 *
 *   preflight   written graded,     interactive practice (if attached)
 *   interaction interactive graded, written practice     (if attached)
 *   choice      both graded
 *
 * Nothing graded returns 'choice' — the editor's neutral default for a lesson still being built.
 * That is a sensible default for an AUTHORING form and a bad one for a student page, so student
 * surfaces branch on the two booleans below instead of on this label alone.
 */
export function policyOf(offering) {
  const graded = offering?.gradedActivities || [];
  if (graded.length > 1) return 'choice';
  if (graded.length === 1) return graded[0].modality === 'interactive' ? 'interaction' : 'preflight';
  return 'choice';   // nothing graded yet — the editor's neutral default
}

/** Does this modality carry credit on this offering? Explicit, so "absent" never reads as "graded". */
export const isGradedPath = (activity) => activity?.gradingRole === 'graded';

/**
 * May the written path be taken freely, or only with an instructor's permission?
 *
 * Here, beside policyOf() and writtenPathCounts(), for the reason the whole module exists: the
 * student lesson page renders it and the faculty editor writes it, and two independent
 * derivations of one rule is exactly how those two once disagreed about whether a lesson was a
 * choice at all.
 *
 * IT IS NOT A SECOND GRADING RULE. `by_permission` says nothing about credit — the written
 * activity must still be `grading_role='graded'` for the points to exist, and this only changes
 * how the choice is PRESENTED. A gated path that is not graded would be a lesson offering work
 * worth nothing, which is the defect writtenPathCounts() already guards; ask both questions.
 *
 * Returns 'open' when there is no written activity at all, so a caller that forgets to check
 * gets the harmless answer rather than a gate on a path that does not exist.
 */
export function writtenAccessOf(offering) {
  return offering?.written?.access === ACCESS_BY_PERMISSION ? ACCESS_BY_PERMISSION : ACCESS_OPEN;
}

/** Is the written path offered, graded, AND gated behind instructor permission? The three
 *  questions the lesson page has to ask together — a gate only means anything on a real choice. */
export function isWrittenByPermission(offering) {
  return !!offering?.isChoice && writtenAccessOf(offering) === ACCESS_BY_PERMISSION;
}

/**
 * May a student surface still offer the WRITTEN path as a way to complete this assignment?
 *
 * Lives here, not in a renderer, for the reason the rest of this module exists: the lesson page
 * used to answer it inline from `interactiveGraded` alone and got it wrong in both directions —
 * showing the questions on an interaction-only lesson, and showing them again after an
 * interactive report had already become the grade. Two independent derivations of one rule is
 * how those disagreed; this is the one derivation.
 *
 * @param {object} a
 * @param {boolean} a.hasWritten          a written activity is attached at all
 * @param {boolean} a.writtenGraded       …and it carries credit this term
 * @param {boolean} a.interactiveGraded   the interactive path carries credit this term
 * @param {string|null} a.committedModality  what the student committed to, or null while open
 */
export function writtenPathCounts({ hasWritten, writtenGraded, interactiveGraded, committedModality }) {
  if (!hasWritten) return false;
  // Their report IS the grade now; the answers stop counting and must stop looking submittable.
  if (committedModality === 'interactive') return false;
  // Graded → obviously. Not graded, but nothing else is either → a misconfigured lesson, where
  // rendering the written card beats rendering an empty page. Hidden only when the interactive
  // is demonstrably the path carrying the points.
  return writtenGraded || !interactiveGraded;
}

/**
 * Which grading card one student gets for one offering. The FACULTY-side counterpart to
 * writtenPathCounts(), and here for the same reason: two independent derivations of "which path
 * is this person on" is how the student page once offered a written path it had already taken away.
 *
 *   'written'       the question rows, credit chips and feedback boxes — unchanged behaviour
 *   'interactive'   the lesson report earned this grade; there are no questions to score
 *   'nosubmission'  nothing committed and nothing typed; there is no work here yet
 *
 * THE BUG THIS EXISTS TO FIX. The Grade page used to ask only `isEffortGraded()` — "did they commit
 * to something other than the written activity" — which is false for a cadet who has not committed
 * *at all*. On an interaction-required offering that is most of the roster right up to the deadline,
 * and every one of them fell through to a written card whose unanswered questions default to `zero`.
 * The screen showed ~157 cadets stamped red "No credit" on questions that carry no credit for them.
 *
 * `committed` outranks the policy, and deliberately so: on a `choice` offering the grading MECHANISM
 * is a property of the student, not of the offering, and `chosen_activity_id` IS that decision.
 *
 * The uncommitted cases split three ways rather than two:
 *   preflight    — written is the only graded path, so it is the card, exactly as before.
 *   interaction  — the written activity is `practice` here. Practice answers are not work anybody
 *                  grades, so rendering them as a gradable card is what produced the red wall.
 *   choice       — either path is still open, so the answer depends on whether they have started
 *                  one. Typed answers with no commit is a real state (autosave without pressing
 *                  submit) and it must keep its written card, or the placeholder hides real work.
 *
 * @param {object}      a
 * @param {object}      a.offering        a shapeOffering() result
 * @param {object|null} a.submission      a shapeSubmission() result, or null
 * @param {object|null} a.writtenAnswers  their answers on the written activity, if any
 */
export function cardKindFor({ offering, submission, writtenAnswers }) {
  const chosen = submission?.chosenActivityId;
  if (chosen) return chosen === offering?.written?.id ? 'written' : 'interactive';

  const policy = policyOf(offering);
  if (policy === 'preflight') return 'written';
  if (policy === 'interaction') return 'nosubmission';
  return hasAnyAnswer(writtenAnswers) ? 'written' : 'nosubmission';
}

/** Has this student typed anything at all into the written activity? Blank strings do not count. */
export function hasAnyAnswer(answers) {
  if (!answers || typeof answers !== 'object') return false;
  return Object.values(answers).some(v => String(v ?? '').trim().length > 0);
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
 * Does this question list declare its roles?
 *
 * ANY question carrying ANY role is enough, which is wider than "one of the pinned two" and has to
 * be. A lesson with BOTH pinned questions switched off carries neither pinned role by definition —
 * so a pinned-role-only test would read it as legacy content and start guessing, which is the very
 * case the toggles exist to express. The lesson editor therefore stamps `role: 'free_response'` on
 * ordinary questions as well (see faculty/lessons.html `stampRoles`), and that stamp is the signal
 * this reads: the list has been authored by something that knows about roles, so silence is an
 * answer rather than an absence of one.
 */
const declaresRoles = (questions) => questions.some(q => q && typeof q.role === 'string' && q.role);

/**
 * The question id for a pinned role — by role, else by prompt text, else by position.
 *
 * ONCE A LESSON DECLARES ANY PINNED ROLE, ROLES ARE THE WHOLE ANSWER. The weak lookups below are
 * a bridge for content authored before roles existed, and applying them to content that HAS roles
 * is how an absent pinned question gets faked. Concretely (director, 2026-07-30): the lesson
 * builder can now switch the reading-time question OFF, which leaves the reflection sitting at
 * `q1` — and `PINNED_FALLBACK_ID.reading_time === 'q1'` would then return the REFLECTION as the
 * reading-time question. The rollup would show a reading-time panel built from reflection prose,
 * and `freeResponseQuestion()` would exclude the wrong question from the free-response panel.
 * "If I toggle one or both off then I think our rollup will get confused because we did things by
 * question number" — exactly right, and this is the line that stops it.
 *
 * The bridge still applies in full to a lesson that declares nothing, which on 2026-07-21 was
 * 74 of 74 live written activities. Both engines must agree: the same rule is implemented in
 * `_pinned_question_id` in supabase/admin/lesson_aggregate.py.
 *
 * @returns {{id: string|null, how: 'role'|'text'|'position'|null}} `how` names the signal that
 *   identified it, so a caller can tell a positional guess from a declared contract.
 */
export function pinnedQuestion(activity, role) {
  const questions = questionsOf(activity).filter(q => q && typeof q === 'object');

  const byRole = questions.find(q => q.role === role && q.id);
  if (byRole) return { id: byRole.id, how: 'role' };

  // Declared, and this role is not among them → the question is deliberately absent. Guessing here
  // would invent one out of whatever happens to sit in its old position.
  if (declaresRoles(questions)) return { id: null, how: null };

  const needle = PINNED_TEXT_MATCH[role];
  if (needle) {
    const byText = questions.find(q => String(q.text || '').toLowerCase().includes(needle) && q.id);
    if (byText) return { id: byText.id, how: 'text' };
  }

  // Position, last and weakest — and it must not claim a question whose own PROMPT says it is the
  // other pinned role. A lesson holding only a reading reflection has it at `q1`, and `q1` is also
  // reading_time's positional fallback, so an unguarded lookup answers "the reading-time question"
  // with the reflection. That is the shape of the bug the editor hit on 2026-07-30; the editor's
  // resolver avoids it by resolving both roles together (faculty-lessons.js
  // `resolvePinnedQuestions`), which a one-role-per-call function cannot do — so it checks the
  // other needle instead. Same answer, reached differently.
  const otherNeedles = Object.entries(PINNED_TEXT_MATCH)
    .filter(([r]) => r !== role).map(([, n]) => n);
  const want = PINNED_FALLBACK_ID[role];
  const byPos = questions.find(q => q.id === want
    && !otherNeedles.some(n => String(q.text || '').toLowerCase().includes(n)));
  return byPos ? { id: byPos.id, how: 'position' } : { id: null, how: null };
}

/** Which written question IS the reading reflection. See pinnedQuestion. */
export const reflectionQuestionId = activity => pinnedQuestion(activity, 'reading_reflection').id;

/**
 * The free-response question — the JiTT one, `q3` in every Fall 2026 preflight.
 *
 * DEFINED BY ELIMINATION, and that is not laziness. The two pinned questions above can be found
 * by prompt text because their prompts are fixed strings a builder writes verbatim and a director
 * does not hand-edit. This one is the lesson's actual physics question: it is different every
 * lesson, by design, so there is no needle. What IS stable is its shape — a free-response
 * question that is neither of the pinned two — and across the 74 Fall 2026 written activities
 * that resolves to `q3` every time, including the six lab preflights whose Q1/Q2 use
 * lab-instruction wording (CORE.md §2) and therefore reach the pinned pair by POSITION rather
 * than by text.
 *
 * Returns the QUESTION OBJECT, not an id: every caller so far wants the prompt and the
 * `figure_url` alongside the answer, and a second lookup to get from the id back to those is the
 * kind of thing that drifts.
 *
 * Prefers a SCORED candidate, then falls back to any. A zero-point third question is not a shape
 * anything writes today, but "no scored one exists, so show nothing" would be a silent empty
 * panel, and a zero-point free response is still a free response.
 *
 * FIRST match when a lesson declares several. Fall 2026 has exactly one everywhere; a panel per
 * question is a bigger design than the term needs and is worth revisiting when a second exists.
 */
export function freeResponseQuestion(activity) {
  const questions = questionsOf(activity).filter(q => q && typeof q === 'object' && q.id);
  const byRole = questions.find(q => q.role === 'free_response');
  if (byRole) return byRole;

  const pinned = new Set([
    pinnedQuestion(activity, 'reading_reflection').id,
    pinnedQuestion(activity, 'reading_time').id,
  ].filter(Boolean));
  // `type` defaults to free_response only when absent — a multiple_choice or numerical question
  // is auto-graded and has no prose to show in a quote panel.
  const candidates = questions.filter(q =>
    !pinned.has(q.id) && (q.type || 'free_response') === 'free_response');
  return candidates.find(q => (Number(q.points) || 0) > 0) || candidates[0] || null;
}
export function artifactUrlOf(activity) { return activity?.content?.artifact_url || null; }

/**
 * Can this interactive activity actually be opened?
 *
 * ATTACHED IS NOT THE SAME AS READY. Since 2026-07-30 the lesson editor requires the artifact URL
 * only when the allowed mode lets a student reach the interaction (Choice or AI Interaction), so a
 * Free-Response lesson may carry its interaction for most of a term with no address on it. Every
 * surface that offers to launch one — the Assignments card, the student's lesson page — has to ask
 * this question, and they must all answer it the same way or the site tells two stories about the
 * same lesson. It lives here for the same reason the pinned-question rules do.
 *
 * `http(s)` specifically, not merely non-empty: the value ends up in an `href` and in
 * `window.open`, so this is also what keeps a `javascript:` URL out of both.
 */
export function isArtifactLaunchable(activity) {
  return /^https?:\/\//i.test(artifactUrlOf(activity) || '');
}
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

/**
 * Every distinct deadline this offering schedules, earliest first, as ISO strings.
 *
 * For display. `due_at` alone cannot answer "when is this lesson due" on a course that meets on
 * two tracks: defaultDueFrom() sets it to the EARLIEST per-day value, which on every Fall 2026
 * row is the M-day date, so anything showing `due_at` shows a T-day instructor the wrong night.
 *
 * Returns instants, not day letters, and the caller decides how to join them. The map is keyed by
 * whatever days the course actually meets — this must not assume M/T, for the same reason
 * `isMDay()` was deleted from util.js. Two days sharing one deadline collapse to one entry.
 *
 * An offering with no per-day schedule returns `[]`, not `[dueAt]`: "there is no per-day
 * schedule" and "the schedule happens to be one date" are different facts, and only the caller
 * knows whether `due_at` is the right thing to fall back to.
 *
 * @param {object} offering  a shapeOffering() result
 * @returns {string[]}
 */
export function dueDayDates(offering) {
  const byDay = offering?.dueByDay;
  if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) return [];
  const seen = new Set();
  return Object.values(byDay)
    .filter(Boolean)
    .filter(v => {
      const t = +new Date(v);
      if (isNaN(t) || seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .sort((a, b) => +new Date(a) - +new Date(b));
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

/* ── The acceptance window ──────────────────────────────────────────────────────────────────
 * A deadline is enforced with a fixed tolerance: work handed in within GRACE_MS of the deadline
 * is still accepted, anything past it is refused. The DISPLAYED deadline does not move — 2359 is
 * what every date on the site shows and what a cadet is told — because an advertised grace period
 * is simply a later deadline, and would need a grace period of its own.
 *
 * FOUR COPIES MUST AGREE. They are in JS, SQL, Python and prose, share no import path, and are
 * connected by nothing but this comment:
 *   • this constant — every client-side comparison (effectiveDue().isPast, submissionLateness())
 *   • the deadline-enforcement migration in supabase/migrations/app/ — the server-side guard.
 *     NOT YET WRITTEN; it lands later, and until it does the refusal below is a UI rule, in the
 *     same standing as isReleased() (RLS still accepts a late write from the REST API directly)
 *   • `.ai/skills/preflight-analyze/SKILL.md` Step 9 — condition 2 of the zeroing rule
 *   • `scripts/fall2026/zero_non_submitters.py` — the same conditions implemented independently
 *
 * A copy that drifts LOW zeroes a cadet for a submission the site had already accepted.
 */
export const GRACE_MS = 120000;

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
 * `due` is the REAL deadline and is returned untouched — it is what the site displays, so the
 * grace must never reach a date a student reads. `isPast` is the enforcement answer instead: it
 * turns true GRACE_MS after `due`, so every source above gets the same tolerance whichever one
 * won the precedence.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {string|null} sectionId
 * @param {string|null} extensionISO  an ACTIVE extension's date, or null
 * @param {Date} [now]  injected so tests are not clock-dependent
 * @returns {{ due: Date|null, isPast: boolean,
 *            source: 'extension'|'section'|'day'|'offering'|'none' }}
 *          due = the displayed deadline; isPast = due + GRACE_MS is behind us
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
  return { due, isPast: (now - due) > GRACE_MS, source };
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
 * @param {number} [graceMs]  the acceptance window; a submission inside it is not late. Defaults
 *   to GRACE_MS — the same tolerance the submit path enforces, because a badge saying "1 min late"
 *   on a submission the site itself accepted describes the site, not the student.
 * @returns {{ late: boolean, due: Date|null, at: Date|null, ms: number }} ms = how late, if late
 */
export function submissionLateness(offering, sectionId, extensionISO, committedAt, graceMs = GRACE_MS) {
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
 * The release window — how far ahead of a deadline a student may see an assignment
 * ══════════════════════════════════════════════════════════════════════════════
 * A preflight is meant to be done in the days before the lesson that discusses it. Publishing
 * a whole term at once let a cadet burn through fifteen of them in an afternoon and arrive at
 * each lesson having forgotten the reading — which defeats the point of the instrument, not
 * just the schedule. So a published assignment is not automatically a VISIBLE one: it appears
 * a bounded time before it is due, and stays visible from then on.
 *
 * TWO LAYERS, and which one applies is the director's call per lesson:
 *
 *   1. The default, when `opens_at` is NULL — a rolling LOOKAHEAD_DAYS before the deadline.
 *      Rolling is the important word. It is computed per student against THEIR OWN resolved
 *      deadline, so an M-day and a T-day section unlock on different days without anybody
 *      entering two dates, and moving a due date moves the unlock with it automatically.
 *
 *   2. An explicit `opens_at` — a fixed instant that wins in BOTH directions: it can release
 *      a review packet three weeks early, or hold one back longer than the default. Being an
 *      absolute timestamp it is the same instant for every section, and it does NOT follow a
 *      deadline that is edited afterwards. The editor says so where it is set.
 *
 * MEASURED FROM THE SCHEDULED DEADLINE, NEVER AN EXTENDED ONE. An extension pushes a
 * student's effective due date later; if the window were measured from that, granting a
 * cadet more time could push the assignment back out of their list and take it away. Callers
 * pass the section deadline with the extension deliberately left out — see student-data.js.
 *
 * THIS IS A UI RULE, NOT A SECURITY BOUNDARY — the same standing as isActivityAvailable()
 * below. RLS (`ao_read_student`) still returns every published offering to the browser, so
 * the questions of a locked assignment are readable by anyone who opens devtools and calls
 * the REST API directly. Closing that means adding the predicate to the policy, which is DDL
 * on `app` and sealed behind a human unsealing `prep_app_owner` (CORE.md §0). The rule here
 * is aimed at pacing ordinary use, which is what the problem actually is.
 *
 * One constant, not a per-course map, for the same reason DUE_TIME_BY_COURSE is a map and not
 * a setting: nothing under `app` stores course configuration. If a second course ever wants a
 * different window, this becomes a map keyed on course code and the per-lesson override above
 * covers everything finer than that.
 */

/** Days before its deadline that an assignment appears, absent an explicit `opens_at`. */
export const LOOKAHEAD_DAYS = 7;

const DAY_MS = 86400000;

/**
 * When this offering becomes visible to a student, or null if it always has been.
 *
 * @param {object} offering  a shapeOffering() result
 * @param {Date|null} scheduledDue  the student's own deadline, IGNORING any extension
 * @returns {Date|null} null = nothing gates it (no explicit open date and no deadline)
 */
export function releaseAt(offering, scheduledDue) {
  if (offering?.opensAt) {
    const o = new Date(offering.opensAt);
    if (!isNaN(o)) return o;             // explicit wins, earlier or later, at the exact instant
  }
  if (!scheduledDue || isNaN(scheduledDue)) return null;
  /* FLOORED TO THE START OF ITS DAY, which is not a rounding detail — it is the difference
   * between the rule and what the rule says. A deadline is 2359, so plain subtraction lands the
   * release at 2359 seven days earlier: the assignment is absent all through the day it is
   * supposed to appear and shows up one minute before midnight. Cadets would experience "opens 7
   * days before" as six, and the day they lose is the one the note on their list promised them.
   * Flooring makes it appear at the start of the day that is LOOKAHEAD_DAYS before the deadline,
   * which is how everybody reads the sentence.
   *
   * Local midnight, not UTC: the same trade toEditorDue() and the extension modal already make,
   * and right for the case that matters — a cadet in Colorado on a Colorado clock. */
  const at = new Date(scheduledDue.getTime() - LOOKAHEAD_DAYS * DAY_MS);
  at.setHours(0, 0, 0, 0);
  return at;
}

/**
 * May the student see this offering yet? An undated assignment with no explicit open date has
 * no window to be outside of, so it is visible — hiding it would hide it for the whole term.
 */
export function isReleased(offering, scheduledDue, now = new Date()) {
  const at = releaseAt(offering, scheduledDue);
  return at == null || at <= now;
}

/**
 * The sentence a student list shows in place of what the window is holding back. Empty when
 * nothing is held back, so a caller can drop it in unconditionally.
 *
 * Lives beside LOOKAHEAD_DAYS rather than in the pages so the number and the sentence that
 * explains the number cannot disagree — a note promising seven days over a fourteen-day window
 * is worse than no note, because a cadet will plan around it.
 */
export function releaseNote(lockedCount) {
  if (!lockedCount) return '';
  const n = Number(lockedCount);
  return `${n} more ${n === 1 ? 'assignment is' : 'assignments are'} scheduled this term. `
    + `Each one opens ${LOOKAHEAD_DAYS} days before it is due — preflights are meant to be done `
    + `just before the lesson that covers them.`;
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
 * MUST match app.grades_points_from_effort() exactly (019_effort_partial_credit_flat.sql):
 * 3–5 → the assignment, 1–2 → one point, 0/null → zero. This is display-only — the trigger is
 * authoritative and overwrites points_earned on write, so a divergence here shows a student one
 * score while the gradebook stores another.
 *
 * Partial credit stopped being `possible / 2` on 2026-07-30. Half of 2 is 1, so the two rules
 * were indistinguishable until Physics 310 became the first 3-point assignment and half credit
 * started paying 1.5 — a value no written taker on the same lesson can reach. The Math.min is
 * the clamp the trigger's LEAST does: on a sub-1-point assignment a flat 1 would be FULL credit
 * for partial effort, and would breach grades_within_bounds on write.
 */
export function pointsFromEffort(effort, pointsPossible) {
  if (effort == null) return 0;
  if (effort >= 3) return pointsPossible;
  if (effort >= 1) return Math.min(1, pointsPossible);
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

/**
 * Read EVERY row a query matches, instead of the first page of them.
 *
 * PostgREST caps a response at its `db-max-rows` and announces the cut only in a `Content-Range`
 * header that supabase-js does not surface. So a truncated read is indistinguishable from a
 * complete one: no error, and `data` that looks like an answer.
 *
 * That is not hypothetical. The cap was 1000 until 2026-08-19. On that day the faculty rollup
 * asked for phys-215's submissions 300 enrollments at a time; the first chunk matched 1189 rows,
 * 1000 came back, and the 189 that did not turned 45 cadets who HAD submitted preflight-05 - and
 * been graded 2/2 for it - into a "Did not submit" list. Every whole-course reader was wrong the
 * same way (phys-110 lost 180 submissions and 200 grades). The Grade tab was right throughout,
 * because it reads one offering at a time and never reached the cap, which is why the two
 * disagreed and why the rollup was believed.
 *
 * The cap was raised to 10000 the same day. That bought room, it did not remove the wall - a
 * 40-lesson term times a 470-cadet course is 18800 rows - and nothing in this repo would report
 * hitting it again. Paging is what makes the number stop mattering.
 *
 * Chunking the id list does NOT fix this and never did. Chunking bounds the request URL; the cap
 * bounds the response. A course big enough to need two chunks is a course whose chunks return
 * more rows than a chunk is allowed to.
 *
 * `build()` must return a FRESH query builder on every call - a supabase-js builder is a
 * thenable and cannot be awaited twice.
 *
 * Two details are load-bearing:
 *   - The `.order()` on a UNIQUE column. Without a total order the server may repeat one row
 *     across two pages and omit another - the same silent loss in a new costume.
 *   - Advancing by what ARRIVED and stopping only on an EMPTY page. Stopping on a short page
 *     would re-introduce the bug wherever the server's cap is smaller than `pageSize`, which is
 *     a value we do not control and cannot read back.
 */
export const PAGE = 1000;
export async function fetchAll(build, { column = 'id', pageSize = PAGE, maxPages = 200 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build()
      .order(column, { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || !data.length) return { data: rows, error: null };
    rows.push(...data);
  }
  return { data: null, error: new Error(`Refusing to page past ${maxPages * pageSize} rows`) };
}

/** Pull a lesson number out of a slug ("preflight-08" / "lesson-08-charge") or a title. */
export function lessonNumber(slug, title) {
  const m = String(slug || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/)
        || String(title || '').match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * The part of an assignment title worth printing beside a label that ALREADY names the number.
 *
 * Both courses title their work `Lesson 02 Preflight — Electric Charge, Coulombic Force`, and the
 * dashboard prefixes its own identifier, so the spotlight read "Assignment 02 — Lesson 02 Preflight
 * — Electric Charge, Coulombic Force": the number twice, the word "preflight" twice, and a third
 * time in the eyebrow above it. The topic — the only part that says what the lesson is about —
 * came third and got the least room.
 *
 * The prefix is what goes, not the identifier: "Assignment 02" is what the rest of the page calls
 * this thing (the section strip's `A02` cells, the due-out boxes, the rollup link), so dropping it
 * here would make the spotlight the odd one out.
 *
 * DELIBERATELY CONSERVATIVE — it strips only when it is certain, because a title it mangles is a
 * lesson nobody can identify. Three conditions, all required: the title opens with `Lesson <n>`,
 * the clause ends in a dash separator, and `<n>` is THIS assignment's own number. A director who
 * titles something "Lesson 12 review — see Lesson 02" keeps every word, and so does any title that
 * does not open with a lesson reference at all.
 *
 * @param {string} title  the stored assignment title
 * @param {number|string|null} num  the number already being displayed beside it
 */
export function titleTopic(title, num) {
  const t = String(title || '').trim();
  const n = parseInt(num, 10);
  if (!t || !Number.isFinite(n)) return t;
  // `[^—–-]*` covers the words between the number and the separator ("Preflight", "Lab", nothing)
  // without letting the match run past the first dash — which is what keeps a topic like
  // "1-D Motion" or "LAB 1: Projectile Motion" intact.
  const m = t.match(/^Lesson\s*0*(\d{1,2})\b[^—–-]*[—–-]\s*(.+)$/i);
  if (!m || parseInt(m[1], 10) !== n) return t;
  return m[2].trim() || t;
}
