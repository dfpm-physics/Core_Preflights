// faculty-grade.js — data layer for the faculty Grade view, against schema `app`.
//
// WHAT MOVED
//   scores(student_id, assignment_id)  ->  grades(enrollment_id, assignment_offering_id)
//   responses.answers                  ->  submission_activities.content
//   extensions(student_id, ...)        ->  extensions(enrollment_id, ...)   [migration 005]
//
// Everything is keyed on the ENROLLMENT now, not the student. That is the change with real
// consequences: a grade belongs to a student's place in a section in a term, so moving a
// cadet between sections no longer silently re-attributes their history, and one student
// taking two courses cannot collide.
//
// SECTION SCOPING IS NO LONGER CLIENT-SIDE. The legacy page filtered by section in JS and
// relied on a permissive policy; here grades_staff_read/_write already restrict rows to
// sections the caller staffs, and ctx.sectionIds mirrors that same predicate. The .in()
// filters below narrow the query, they do not secure it.
//
// ONE GRADE PER STUDENT PER OFFERING is a UNIQUE constraint, and points_earned is bounded by
// points_possible by a CHECK. Both replace application-level care that the old model lacked.

import { db } from './supabase.js';
import { lastFirst } from './util.js';
import {
  OFFERING_SELECT, GRADE_SELECT, SUBMISSION_SELECT, EXTENSION_SELECT,
  shapeOffering, withResolvedDue, offeringSections,
  shapeSubmission, questionsOf, effectiveDue, submissionLateness,
  actionableSections, fetchAll, cardKindFor, hasAnyAnswer,
} from './schema.js';

/** Scheduled assignments for the current offering, for the picker. */
export async function gradeAssignmentList(ctx) {
  if (!ctx.currentOffering) return [];
  const { data } = await db.from('assignment_offerings')
    .select('id, due_at, position, is_published, points_possible, assignments!inner(slug, title)')
    .eq('course_offering_id', ctx.currentOffering)
    .order('position', { ascending: false, nullsFirst: false });
  return (data || []).map(r => ({
    id: r.id,
    slug: r.assignments?.slug,
    title: r.assignments?.title,
    due_at: r.due_at,
    is_published: r.is_published,
    points_possible: Number(r.points_possible ?? 0),
  }));
}

/**
 * The sections behind the picker's "— all my sections —" option.
 *
 * This returned `ctx.sectionIds` until 2026-07-27, and for an instructor that was right. For a
 * DIRECTOR it was not, and the difference was invisible: a director's offering-wide staff row
 * makes `staff_sections()` (and therefore ctx.sectionIds) every section of the offering, so
 * "all my sections" silently loaded the entire course — byte-identical to the "All sections
 * (entire course)" option sitting next to it. Picking one section filtered correctly, picking
 * "mine" did not, which is exactly what the beta reported.
 *
 * `actionableSections()` is the same predicate the dashboard's due-out row and the grading queue
 * already use — taught ∩ visible, falling back to visible so a director who teaches nothing gets
 * the course rather than an empty page.
 */
export function mySectionIds(ctx) { return actionableSections(ctx).ids; }

/** Every section in the current offering (directors/admins see all of them anyway). */
export async function allSectionIds(ctx) {
  if (!ctx.currentOffering) return [];
  const { data } = await db.from('sections').select('id')
    .eq('course_offering_id', ctx.currentOffering).order('code');
  return (data || []).map(s => s.id);
}

/**
 * Everything needed to grade one assignment offering across a set of sections.
 *
 * @returns {{ offering, students, responseMap, gradeMap, extensionMap, submissionMap }}
 *   students:     [{ student_id, name, enrollment_id, section_id }]
 *   responseMap:  studentId -> answers{} from the CHOSEN activity (or the written one)
 *   gradeMap:     studentId -> { qs, finalized, effort, pointsEarned, gradeId }
 *   extensionMap: studentId -> ISO date
 */
export async function loadGradingData(ctx, offeringId, sectionIds) {
  const empty = { offering: null, students: [], responseMap: {}, gradeMap: {}, extensionMap: {}, submissionMap: {} };
  if (!offeringId) return empty;

  const { data: offeringRow } = await db.from('assignment_offerings')
    .select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  const offering = withResolvedDue(shapeOffering(offeringRow), offeringSections(ctx));
  if (!offering) return empty;

  const scope = (sectionIds && sectionIds.length) ? sectionIds : ['00000000-0000-0000-0000-000000000000'];
  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, status, students!inner(student_id, name)')
    .in('section_id', scope).eq('status', 'active');

  const students = (enrolRows || [])
    .map(e => ({
      student_id: e.student_id,
      name: e.students?.name || String(e.student_id),
      enrollment_id: e.id,
      section_id: e.section_id,
    }))
    .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));

  if (!students.length) return { ...empty, offering, students };

  const enrollmentIds = students.map(s => s.enrollment_id);
  const studentOf = Object.fromEntries(students.map(s => [s.enrollment_id, s.student_id]));

  const [subs, grds, exts] = await Promise.all([
    db.from('submissions').select(SUBMISSION_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds),
    db.from('grades').select(GRADE_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds),
    // Active extensions only. A revoked row still exists (007 keeps it so the director's
    // report can count it) but it must not move anybody's deadline.
    db.from('extensions').select(EXTENSION_SELECT)
      .eq('assignment_offering_id', offeringId).in('enrollment_id', enrollmentIds)
      .is('revoked_at', null),
  ]);

  const responseMap = {}, submissionMap = {}, gradeMap = {}, extensionMap = {};

  (subs.data || []).map(shapeSubmission).forEach(s => {
    const sid = studentOf[s.enrollmentId];
    if (!sid) return;
    submissionMap[sid] = s;
    // Grade what the student actually chose. Falling back to the written activity keeps a
    // draft (nothing chosen yet) visible to the grader instead of showing a blank card.
    const actId = s.chosenActivityId || offering.written?.id;
    responseMap[sid] = s.activities?.[actId]?.content || {};
  });

  (grds.data || []).forEach(g => {
    const sid = studentOf[g.enrollment_id];
    if (!sid) return;
    gradeMap[sid] = {
      gradeId: g.id,
      qs: g.question_scores || {},
      finalized: g.is_finalized,
      effort: g.effort,
      // Carried for confirmEffortRows(): finalizing full credit raises a capped
      // diagnostic effort, and that needs the payload it is amending.
      diagnostic: g.diagnostic || null,
      pointsEarned: g.points_earned == null ? null : Number(g.points_earned),
      // Carried so a save can PRESERVE them for a student nobody edited. Writing the
      // current user over every row was what erased the ai_suggested/instructor
      // distinction the moment anyone clicked Save. See gradeRows().
      source: g.source,
      gradedBy: g.graded_by,
      gradedAt: g.graded_at,
      updatedAt: g.updated_at,
    };
  });

  (exts.data || []).forEach(e => {
    const sid = studentOf[e.enrollment_id];
    if (sid) extensionMap[sid] = shapeExtension(e);
  });

  return { offering, students, responseMap, gradeMap, extensionMap, submissionMap };
}

/** One extensions row, flattened. `due` is the field effectiveDue() wants. */
export function shapeExtension(e) {
  if (!e) return null;
  return {
    id: e.id,
    enrollmentId: e.enrollment_id,
    offeringId: e.assignment_offering_id,
    due: e.extended_due_at,
    reason: e.reason || '',
    grantedBy: e.granted_by,
    grantedAt: e.created_at,
    revokedAt: e.revoked_at || null,
    revokedBy: e.revoked_by || null,
    revokedReason: e.revoked_reason || '',
    get isRevoked() { return !!e.revoked_at; },
  };
}

/** The deadline that applies to one student in the grading view. */
export function dueForStudent(offering, student, extensionMap) {
  return effectiveDue(offering, student.section_id, extensionMap[student.student_id]?.due || null);
}

/**
 * Did this student commit to something other than the written activity?
 *
 * On a `choice` offering both activities are `graded` and each student picks, so the grading
 * MECHANISM is a property of the student, not of the offering: an interactive taker is graded by
 * effort (grades.effort -> the DB trigger), a written taker by question_scores. This is the
 * predicate that tells the two apart, and `chosen_activity_id` is the right source for it because
 * that commitment IS the decision — the same one submissions_lock enforces.
 *
 * Nothing chosen yet => false, so a draft still shows the written card to grade against.
 */
export function isEffortGraded(offering, submission) {
  const chosen = submission?.chosenActivityId;
  if (!chosen) return false;
  return chosen !== offering?.written?.id;
}

/**
 * Build the editable 3-state grade model (full / warn / zero).
 * Unchanged in spirit from the legacy view — the states and their meaning are a course
 * policy, not a schema detail — but it now reads questions out of the written activity's
 * content rather than off the assignment row.
 *
 * ANYONE NOT ON THE WRITTEN CARD IS EXCLUDED ENTIRELY, and that omission is load-bearing. An
 * interactive taker's grade comes from effort; they answered no written question, so every question
 * would default to `zero` here (`hasAnswer` false), and because they DO have a prior grade row,
 * gradeRows() rule 2 would not skip them — one click of Save on somebody else's card would write
 * `question_scores` full of zeros over their effort grade and set points_earned to 0. Giving them
 * no gradeData entry is what makes rule 2 skip them for the right reason. Migration 014's
 * `grades_one_grading_mechanism` CHECK is the second line of defence, turning the same mistake
 * into a rejected write rather than a silent zero.
 *
 * The test is cardKindFor() rather than isEffortGraded() because THIS MODEL AND buildEffortData()
 * MUST BE EXACT COMPLEMENTS. Every student belongs to exactly one of them; a student in both would
 * be written twice by one Save, in two upserts, and the second would silently overwrite the first.
 * isEffortGraded() only catches a cadet who has already COMMITTED elsewhere, which on an
 * interaction-required offering is nobody until the deadline nears — so it left the whole roster in
 * this model, holding a full set of red zeros for questions that carry no credit for them.
 */
export function buildGradeData(offering, students, responseMap, gradeMap, submissionMap = {}, staleIds = null) {
  const questions = questionsOf(offering.written);
  const gradeData = {};
  (students || []).forEach(st => {
    const kind = cardKindFor({
      offering,
      submission: submissionMap[st.student_id],
      writtenAnswers: responseMap?.[st.student_id],
    });
    if (kind !== 'written') return;
    gradeData[st.student_id] = {};
    questions.forEach(q => {
      // An UNPUBLISHED STALE ZERO is not this card's starting point. It says "No submission
      // received." about a cadet whose answers are now on screen (staleZeroIds()), so its red chips
      // and its feedback describe an absence that stopped being true. Loading them is how the
      // 2026-09 re-published zeros happened: the card looked graded, and Finalize published it.
      // A PUBLISHED one still loads — a locked card must show what the cadet is actually seeing.
      const prior = gradeMap[st.student_id];
      const saved = staleIds?.has(st.student_id) && !prior?.finalized ? undefined : prior?.qs[q.id];
      const hasAnswer = String(responseMap[st.student_id]?.[q.id] ?? '').trim().length > 0;
      const savedScore = saved?.score !== undefined ? Number(saved.score) : null;
      const hasFeedback = !!(saved?.feedback && saved.feedback.trim());
      const status = saved?.status
        || (savedScore === null ? (hasAnswer ? 'full' : 'zero')
            : savedScore > 0 ? (hasFeedback ? 'warn' : 'full') : 'zero');
      gradeData[st.student_id][q.id] = {
        score: status === 'zero' ? 0 : Number(q.points) || 0,
        feedback: saved?.feedback ?? '',
        status,
        // What this answer was when the page loaded, and it never changes for the life of the
        // view. Two things read it, and neither works off `status`:
        //
        //   The STATUS-LAMP FILTER. Filtering on the live status meant re-scoring an answer made
        //   it vanish under your cursor — turn a red into a green while "no credit" is the only
        //   lit lamp and the card you were reading disappears, which reads as data loss. The
        //   filter is a statement about the set you chose to review, and re-grading a member of
        //   that set does not remove it from it. It re-settles on the next load, which is exactly
        //   when the reader's chosen set is genuinely stale.
        //
        //   The PENDING-CHANGE CONTROL. `status !== original` is what makes grade.html draw the
        //   before → after pair instead of one chip, so an unsaved change is legible as a change
        //   rather than as the state having always been that.
        original: status,
        modified: false,
      };
    });
  });
  return gradeData;
}

/**
 * The editable model for every student who is NOT on the written card.
 *
 * Complements buildGradeData() and is deliberately a SECOND model rather than more keys in the
 * first. The two produce different row shapes — question_scores vs a bare points_earned — and
 * confirmEffortRows()'s header already records what happens when unlike rows share an array: "a
 * PostgREST bulk upsert requires identical keys across the array". Keeping them apart is also what
 * lets gradeRows() go on assuming every entry it sees has questions in it.
 *
 * Covers both non-written cards, distinguished by `kind` for the renderer's benefit only — they
 * save identically:
 *   'interactive'   the lesson report earned this grade (migration 015 wrote it, finalized)
 *   'nosubmission'  nothing committed, nothing typed — usually no grade row at all yet
 *
 * `points` starts at whatever is stored, and `null` when nothing is: that is the control's
 * "— not graded" state, and it is why a placeholder does not open wearing a red zero.
 */
export function buildEffortData(offering, students, gradeMap = {}, submissionMap = {}, responseMap = {}) {
  const effortData = {};
  (students || []).forEach(st => {
    const sid = st.student_id;
    const kind = cardKindFor({
      offering,
      submission: submissionMap[sid],
      writtenAnswers: responseMap[sid],
    });
    if (kind === 'written') return;

    const prior = gradeMap[sid];
    const points = prior?.pointsEarned ?? null;
    const note = instructorNote(prior?.diagnostic);
    effortData[sid] = {
      kind,
      points,
      original: points,     // the baseline the `was → will be` pair is drawn against
      note,
      noteOriginal: note,
      modified: false,
    };
  });
  return effortData;
}

/** The instructor's note off a grade's diagnostic, or '' — the column is polymorphic, so guard it. */
export function instructorNote(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return '';
  return String(diagnostic.instructor_note?.text ?? '');
}

/**
 * Rows for the non-written cards.
 *
 * THREE THINGS HERE ARE LOAD-BEARING.
 *
 * 1. `effort: null`, ALWAYS. `app.grades_points_from_effort()` (migration 019) is a BEFORE INSERT
 *    OR UPDATE trigger that recomputes points_earned from effort on every write where effort is
 *    not null. Send the instructor's 1 point with the effort still populated and the trigger
 *    silently puts it back to 2 — the override would appear to save and then not be there. Nulling
 *    it is what hands ownership of points_earned to the instructor, and it satisfies migration
 *    014's grades_one_grading_mechanism CHECK alongside the empty question_scores.
 *
 *    It costs no measurement. The artifact's own effort survives in `diagnostic` — every live
 *    effort grade carries the schema:1 payload with the identical value — so effortSignal()
 *    (schema.js) falls through to it and the dashboard, the histogram, the gradebook and the
 *    rollup all keep reading the same number. What changes is its provenance, from 'grade' to
 *    'report', which is exactly what has happened: it is the lesson's claim again, not the grade.
 *
 * 2. ONLY EDITED ROWS ARE SENT — the inverse of gradeRows() rule 1, for the inverse reason.
 *    gradeRows() re-sends untouched written rows to preserve provenance a bulk write would
 *    otherwise stamp over. Re-sending an untouched INTERACTIVE row would do the damage instead:
 *    every derived grade in the section would have its `grades.effort` cleared by rule 1 above the
 *    first time anyone clicked Save on somebody else's card. There is nothing to preserve on a row
 *    nobody touched — the database already holds the derived truth — so it is not sent at all.
 *
 * 3. THE NOTE MERGES INTO `diagnostic`, it does not replace it. That column holds the artifact's
 *    frozen schema:1 payload, and clobbering it would destroy the assessment the whole rollup is
 *    built from. Clearing the text removes just that one key.
 */
function effortRows(ctx, offering, students, effortData, isFinalized, gradeMap = {}) {
  const enrollmentOf = Object.fromEntries(students.map(s => [s.student_id, s.enrollment_id]));
  const possible = Number(offering.pointsPossible ?? 0);
  const now = new Date().toISOString();

  return Object.entries(effortData || {}).map(([sid, ed]) => {
    if (!ed?.modified) return null;                       // rule 2

    const prior = gradeMap[sid];
    const base = (prior?.diagnostic && typeof prior.diagnostic === 'object' && !Array.isArray(prior.diagnostic))
      ? { ...prior.diagnostic } : {};
    const text = String(ed.note ?? '').trim();
    if (text) base.instructor_note = { text, by: ctx.user.id, at: now };
    else delete base.instructor_note;                     // rule 3

    return {
      enrollment_id: enrollmentOf[sid],
      assignment_offering_id: offering.offeringId,
      effort: null,                                       // rule 1
      question_scores: {},
      points_earned: ed.points == null ? null : Math.min(Math.max(Number(ed.points), 0), possible),
      points_possible: possible,
      // `{}`, never null — the column is `jsonb NOT NULL DEFAULT '{}'` (001_core_model.sql).
      // A null here is rejected outright, and the case that produces one is the commonest of
      // all: a placeholder with no prior grade and no note typed, i.e. awarding credit to a
      // cadet who submitted nothing.
      diagnostic: base,
      source: 'instructor',
      is_finalized: isFinalized,
      graded_by: ctx.user.id,
      graded_at: now,
    };
  }).filter(r => r && r.enrollment_id);
}

/** Did the instructor actually touch this student's card in this sitting? */
function wasEdited(qMap, questions) {
  return questions.some(q => qMap?.[q.id]?.modified);
}

/**
 * Rows for a grades upsert. Shared by save and finalize so they cannot diverge.
 *
 * TWO RULES HERE ARE LOAD-BEARING, and both were bugs before migration 007's review work:
 *
 * 1. PROVENANCE IS PRESERVED, NOT STAMPED. This used to hardcode source:'instructor',
 *    graded_by:<caller>, graded_at:<now> for EVERY row in scope. One click of Save draft
 *    therefore relabelled every AI suggestion in the section as instructor-authored,
 *    including cards nobody had scrolled to — which destroyed the only column that could
 *    answer "has a human looked at this?". A row is marked instructor-authored only when
 *    that student's card was actually edited; otherwise the prior values ride through
 *    unchanged. (They must be sent explicitly: a PostgREST upsert builds its column list
 *    from the payload keys, so omitting them is not the same as leaving them alone.)
 *
 * 2. AN UNGRADED STUDENT IS NOT INVENTED. buildGradeData() defaults a submitted-but-
 *    ungraded student to `full`, so writing every row meant Finalize & publish handed full
 *    credit to every student the AI never scored — and a director who had picked "All
 *    sections" did it course-wide. A student with no existing grade AND no edit is now
 *    skipped entirely, which is also what makes the "past due, not graded" queue truthful.
 *
 * 3. A PUBLISHED GRADE IS NEVER RE-SENT. Rule 1 re-sends every untouched row so its provenance
 *    survives, and until 2026-09-29 that included rows already finalized — carrying `is_finalized`
 *    set to whatever the button meant. So a Save draft took every published grade in scope back
 *    down, silently: one Save draft on "All sections" that morning un-published 117 phys-110
 *    preflight-18 grades across six instructors' sections, a day after those instructors had
 *    published them, and nothing on screen said so. A published card cannot be edited (its
 *    controls are disabled; Reopen is the way back in), so there is never anything to send for one.
 *
 * 4. A HELD ROW IS NOT RE-SENT UNLESS IT WAS EDITED. `skipIds` carries the stale zeros
 *    (staleZeroIds()) on every save, and on Finalize also whatever planPublish() holds back — a
 *    cadet who still has time, work handed in after its grade. Re-sending a stale zero would write
 *    the card's fresh defaults over it on a draft save and publish it on Finalize; re-sending a held
 *    row on Finalize publishes what the rule has just decided a person must look at first.
 */
function gradeRows(ctx, offering, students, gradeData, isFinalized, gradeMap = {}, skipIds = null) {
  const questions = questionsOf(offering.written);
  const enrollmentOf = Object.fromEntries(students.map(s => [s.student_id, s.enrollment_id]));
  const now = new Date().toISOString();

  return Object.entries(gradeData).map(([sid, qMap]) => {
    const prior = gradeMap[sid];
    const edited = wasEdited(qMap, questions);
    // Rule 2 — nothing to say about this student, so say nothing.
    if (!prior && !edited) return null;
    // Rule 3 — a published grade stays exactly as it was published.
    if (prior?.finalized) return null;
    // Rule 4 — held back, and nobody changed it. (gradeData is keyed by the numeric cadet id.)
    if (!edited && skipIds?.has(Number(sid))) return null;

    const questionScores = {};
    let total = 0;
    questions.forEach(q => {
      const gd = qMap[q.id];
      if (!gd) return;
      questionScores[q.id] = {
        score: gd.score, max: Number(q.points) || 0,
        feedback: gd.feedback, status: gd.status || (gd.score > 0 ? 'full' : 'zero'),
      };
      total += Number(gd.score) || 0;
    });

    // points_possible comes from the OFFERING, not from the question list: it is the
    // per-term value, and the DB CHECK bounds points_earned against exactly this column.
    const possible = Number(offering.pointsPossible ?? 0);
    const earned = Math.min(Math.round(total * 1000) / 1000, possible);

    return {
      enrollment_id: enrollmentOf[sid],
      assignment_offering_id: offering.offeringId,
      question_scores: questionScores,
      points_earned: earned,
      points_possible: possible,
      // Rule 1
      source: edited ? 'instructor' : (prior?.source || 'ai_suggested'),
      is_finalized: isFinalized,
      graded_by: edited ? ctx.user.id : (prior?.gradedBy ?? ctx.user.id),
      graded_at: edited ? now : (prior?.gradedAt ?? now),
    };
  }).filter(r => r && r.enrollment_id);
}

/**
 * Finalizing full credit CONFIRMS the effort the AI only suspected.
 *
 * `/preflight-analyze` applies the reading-reflection gate last, as a ceiling:
 * `effort = min(effort, 2)` whenever the reflection is not a genuine attempt. That is a
 * judgement about substance, and on the written path it costs the student nothing — points
 * come from `question_scores`, where yellow earns full credit. So a student could sit under a
 * "Reflection capped" pill on the rollup while holding every point the assignment was worth,
 * which is the contradiction this closes.
 *
 * When an instructor FINALIZES — the deliberate, published act, not a draft save — and has
 * awarded full credit on every question that carries points, they have asserted the work was
 * worth full marks. Raise a capped OR ZEROED effort to 3, the bottom of the "earns what the
 * assignment is worth" band, so the charts and the pill agree with the grade that was actually
 * published.
 *
 * Deliberately narrow:
 *  - **0, 1 and 2 all move, and only ever up to 3.** The gate is a ceiling, not a fixed value, so
 *    a student can land on 1 by engaging thinly everywhere *and* failing the reflection. Both
 *    are confirmed by the same act.
 *
 *    **0 was excluded until 2026-08-10**, on the reasoning that no substantive participation
 *    anywhere is not something full credit can retroactively assert. That reads the zero as a
 *    finding about the student, and it is not always one: `/preflight-analyze` also writes
 *    `effort: 0` (with `no_submission: true`) for every student it finds nothing from once a
 *    deadline passes, so a zero equally means *the system has no work for this person* — which is
 *    what it meant for the submissions lost on 2026-08-10. An instructor who then awards two
 *    points is not overriding a judgement about thin work; they are stating that the work existed.
 *    Leaving those students on 0 kept them in the low-effort band and under the follow-up flag on
 *    the strength of a submission the site had already conceded it lost.
 *  - **It never lowers an effort** and never exceeds 3 — an instructor confirming full credit
 *    says "at least enough", not "exemplary".
 *  - **The AI's own reading survives** in `reading_reflection.meaningful` and in
 *    `effort_override.from`. Nothing here rewrites the judgement; it records that a human
 *    overrode its consequence, and who.
 *
 * Applied as targeted updates AFTER the upsert rather than as a `diagnostic` key on every row:
 * a PostgREST bulk upsert requires identical keys across the array, so folding it into
 * gradeRows() would mean writing `diagnostic` for every student in scope — re-sending a
 * payload this page never edits, and racing any concurrent `/preflight-analyze` write.
 */
export function confirmEffortRows(ctx, offering, students, gradeData, gradeMap = {}) {
  const graded = questionsOf(offering.written).filter(q => (Number(q.points) || 0) > 0);
  if (!graded.length) return [];
  const enrollmentOf = Object.fromEntries(students.map(s => [s.student_id, s.enrollment_id]));
  const now = new Date().toISOString();

  return Object.entries(gradeData).map(([sid, qMap]) => {
    const prior = gradeMap[sid];
    if (!prior || !enrollmentOf[sid]) return null;

    // Full credit on every question that carries points. Yellow qualifies: it IS full credit,
    // and an instructor who published it reviewed the flag and let it stand.
    const fullCredit = graded.every(q => {
      const gd = qMap?.[q.id];
      return gd && gd.status !== 'zero' && Number(gd.score) === (Number(q.points) || 0);
    });
    if (!fullCredit) return null;

    const d = prior.diagnostic;
    if (!d || typeof d !== 'object') return null;
    const from = d.effort;
    if (!(from === 0 || from === 1 || from === 2)) return null;   // >=3, null, non-integers stand

    return {
      enrollment_id: enrollmentOf[sid],
      diagnostic: {
        ...d,
        effort: 3,
        effort_override: { from, to: 3, by: ctx.user.id, at: now, rule: 'finalized-full-credit' },
      },
    };
  }).filter(Boolean);
}

/**
 * TWO UPSERTS, NOT ONE, and they cannot be merged.
 *
 * The written rows and the effort rows carry different columns — question_scores and a summed
 * points_earned on one side, a nulled effort and a merged diagnostic on the other. PostgREST
 * builds its column list from the union of the payload keys, so putting them in one array would
 * send `diagnostic` for every written student in the section (re-writing a column this page never
 * edits, and racing any concurrent /preflight-analyze run) and `question_scores` for every
 * interactive one. Sequential and separate is the only shape that writes exactly what was edited.
 *
 * Either array may be empty; an empty one is skipped rather than sent.
 */
async function writeGrades(ctx, offering, students, gradeData, gradeMap, effortData, isFinalized, skipIds = null) {
  const written = gradeRows(ctx, offering, students, gradeData, isFinalized, gradeMap, skipIds);
  const effort = effortRows(ctx, offering, students, effortData, isFinalized, gradeMap);
  if (!written.length && !effort.length) return { data: [], error: null, skipped: true };

  const ids = [];
  for (const rows of [written, effort]) {
    if (!rows.length) continue;
    const res = await db.from('grades')
      .upsert(rows, { onConflict: 'enrollment_id,assignment_offering_id' }).select('id');
    if (res.error) return res;
    ids.push(...(res.data || []));
  }
  return { data: ids, error: null };
}

/**
 * How many rows a save/finalize would actually write — for an honest confirm prompt.
 *
 * `extras` is finalizeExtras()'s result on Finalize: the held-back ids the upserts must skip, and
 * the rows the upserts never reach — untouched no-submission and interactive cards the rule says
 * are due (published by flag), and the zeros it creates. A draft save passes only `skipIds`.
 */
export function writableCount(ctx, offering, students, gradeData, gradeMap = {}, effortData = {}, extras = {}) {
  return gradeRows(ctx, offering, students, gradeData, false, gradeMap, extras.skipIds).length
       + effortRows(ctx, offering, students, effortData, false, gradeMap).length
       + (extras.flipItems?.length || 0) + (extras.zeroItems?.length || 0);
}

/** Upsert all scores as a draft (is_finalized:false). `opts.skipIds`: see gradeRows() rule 4. */
export function saveScores(ctx, offering, students, gradeData, gradeMap = {}, effortData = {}, opts = {}) {
  return writeGrades(ctx, offering, students, gradeData, gradeMap, effortData, false, opts.skipIds);
}

/**
 * Save then publish. Finalizing is what makes a grade visible to the student
 * (grades_own_finalized), so it is also the moment worth recording in the audit log.
 *
 * `extras` (finalizeExtras()) is what makes it complete. Until 2026-09-29 this published only what
 * the two upserts send, and effortRows() sends edited rows only — so on every lesson with an iPREP
 * option the AI's zero for a cadet who handed in nothing was never published, and reached
 * Blackboard as a blank. Instructors had taken to typing "no submission" into each of those boxes
 * to force it through. Those rows, and a zero for a cadet who has no grade at all, now go out here
 * through applyPublishPlan(), under the same rule the director's Publish-all uses.
 */
export async function finalizeScores(ctx, offering, students, gradeData, gradeMap = {}, effortData = {}, extras = {}) {
  const res = await writeGrades(ctx, offering, students, gradeData, gradeMap, effortData, true, extras.skipIds);
  if (res.error) return res;

  if (!res.skipped) {
    // Publishing full credit confirms a capped effort. Best-effort and deliberately after the
    // upsert: this amends a diagnostic, and failing to raise it must never cost the grades that
    // were just published. See confirmEffortRows().
    //
    // Written rows only — it is passed `gradeData`, and an effort row has no effort left to raise.
    for (const u of confirmEffortRows(ctx, offering, students, gradeData, gradeMap)) {
      const { error } = await db.from('grades').update({ diagnostic: u.diagnostic })
        .eq('enrollment_id', u.enrollment_id)
        .eq('assignment_offering_id', offering.offeringId);
      if (error) console.warn('[grade] published, but confirming effort failed:', error.message);
    }

    // Append-only audit. Best-effort: a failed log entry must not lose the grades that were
    // just published, so the error is reported but not thrown.
    const events = (res.data || []).map(g => ({
      grade_id: g.id, event: 'finalized', actor: ctx.user.id,
      detail: { offering: offering.offeringId, slug: offering.slug },
    }));
    if (events.length) {
      const { error } = await db.from('grade_events').insert(events);
      if (error) console.warn('[grade] finalized, but the audit event failed:', error.message);
    }
  }

  const more = [...(extras.flipItems || []), ...(extras.zeroItems || [])];
  if (!more.length) return res;
  const out = await applyPublishPlan(ctx, more, [planOffering(offering)], { via: 'grade-page' });
  return { data: res.data || [], error: out.error, skipped: false,
           published: out.published, created: out.created };
}

/** Re-open one student's grade so it leaves the student's view again. */
export async function reopenScore(ctx, offeringId, enrollmentId) {
  const res = await db.from('grades').update({ is_finalized: false })
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId).select('id');
  if (!res.error && res.data?.length) {
    await db.from('grade_events').insert({
      grade_id: res.data[0].id, event: 'reopened', actor: ctx.user.id, detail: {},
    });
  }
  return res;
}

/* ── Extensions (migrations 005 + 007) ───────────────────────────────────────
 * Keyed on the enrollment, like everything else per-student. `granted_by` is recorded so an
 * extension is attributable the same way an unlock is.
 *
 * Three verbs, and the difference between them is the whole governance model:
 *   setExtension    — grant or amend. Any staff of the section. `reason` is REQUIRED (007):
 *                     the director's report counts these per instructor, and a count with a
 *                     blank reason column cannot start the conversation it exists to start.
 *                     Also RE-OPENS a published grade when the extension can only mean
 *                     "let them work" — see reopenForExtension() for which cases those are.
 *   removeExtension — the granter's undo, for a genuine mistake. Erases the row, so it is
 *                     refused by the DB once the student has committed work under it.
 *   revokeExtension — the director's override. Soft: the row stays and keeps counting.
 *                     Also refused after a committed submission, and the trigger rejects it
 *                     from anyone who does not direct the offering.
 */
export async function setExtension(ctx, offeringId, enrollmentId, iso, reason) {
  const why = String(reason || '').trim();
  if (!why) return { error: { message: 'A reason is required to grant an extension.' } };
  const res = await db.from('extensions').upsert({
    enrollment_id: enrollmentId,
    assignment_offering_id: offeringId,
    extended_due_at: iso,
    reason: why,
    granted_by: ctx.user.id,
    // Amending a revoked extension reinstates it — the UNIQUE key means there is only ever
    // one row per (enrollment, offering), so this is the reinstatement path too.
    revoked_at: null, revoked_by: null, revoked_reason: null,
  }, { onConflict: 'enrollment_id,assignment_offering_id' });
  if (res.error) return res;
  return { ...res, reopened: await reopenForExtension(ctx, offeringId, enrollmentId, iso, why) };
}

/* ── Re-opening a grade to make an extension mean something ──────────────────
 *
 * WHY THIS EXISTS. A finalized grade outranks the deadline everywhere a student can see it:
 * resolveState() checks `is_finalized` before it checks anything else, and the assignment page
 * branches on that state before it ever reads `isPast`. So the read-only lock an extension is
 * meant to lift is in a branch a graded student never reaches. Extending someone who has been
 * graded moved a date nothing looked at — the chip rendered, the director's report counted it,
 * and the student stayed locked out with nothing reporting the discrepancy. The fix used to be
 * "reopen first, then extend", which is a two-step whose first step is invisible when forgotten.
 *
 * WHY IT IS NOT UNCONDITIONAL. Re-opening does two things, and only one of them is implied by
 * granting an extension. It lets the student work again — intended — and it takes their score
 * off their screen entirely (grades_own_finalized: an unfinalized row is not merely greyed out,
 * it stops being SELECTable), which is not. The case that separates them is a student who handed
 * work in late, was graded, and is granted an extension afterwards so the lateness is forgiven on
 * the record. Nothing there is waiting to be resubmitted, and retracting a correct published
 * grade over a bookkeeping fix is a surprise the student discovers before the instructor does.
 *
 * So the two conditions below are the question "could this extension mean anything other than
 * let-them-work?", asked of facts the system already holds:
 *
 *   FUTURE DEADLINE — a back-dated extension cannot be giving anybody time. It is forgiving
 *                     lateness that already happened, which is the record-keeping case exactly.
 *   NOTHING COMMITTED — no submission, or one still in draft, means there is no work in hand to
 *                     protect and the zero can only be standing in for work not yet done. A
 *                     COMMITTED submission is left alone: an instructor who wants to throw out
 *                     graded work and let a student redo it still has Reopen, and that decision
 *                     is deliberate enough to deserve a deliberate click.
 *
 * This lives in the data layer rather than in the three modals that call it (Grade, Student,
 * Report — the last granting in bulk) so a fourth entry point cannot be added without it.
 *
 * Failures are reported and swallowed: the extension is the operation the user asked for and it
 * has already landed, so it must not be lost to a follow-up write. Same bargain as the audit
 * insert in finalizeScores().
 */

/**
 * The rule itself, with the database taken out of it: does this extension mean "let them work"?
 *
 * Exported and pure so the two conditions are pinned by a test rather than only by the prose
 * above — the lesson of test-student-completion.mjs is that a rule which lives in one function
 * and is described in another place drifts. Called twice by reopenForExtension(): once on `iso`
 * alone, to skip two reads when the date already settles it, and once with the rows. A missing
 * `grade` key means "not read yet" and passes the probe; a `grade` of null means "no grade row"
 * and does not.
 *
 * @param {{iso: string, grade?: {is_finalized?: boolean}|null,
 *          submission?: {status?: string}|null}} facts
 * @param {number} now  epoch ms; injectable so a test does not depend on the clock.
 */
export function extensionReopensGrade({ iso, grade, submission }, now = Date.now()) {
  const when = Date.parse(iso);
  if (!Number.isFinite(when) || when <= now) return false;   // back-dated: forgiving lateness
  if (grade === undefined) return true;                      // date-only probe, rows not read yet
  if (!grade?.is_finalized) return false;                    // nothing published to take back down
  return submission?.status !== 'committed';                 // work already in: leave it alone
}

/** Apply the rule above. @returns {Promise<boolean>} whether a grade was taken back down. */
async function reopenForExtension(ctx, offeringId, enrollmentId, iso, reason) {
  if (!extensionReopensGrade({ iso })) return false;   // cheap: skip two reads on a back-date

  const { data: grade, error: gErr } = await db.from('grades')
    .select('id, is_finalized')
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId)
    .maybeSingle();
  if (gErr) return false;

  const { data: sub, error: sErr } = await db.from('submissions')
    .select('status')
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId)
    .maybeSingle();
  if (sErr) return false;

  if (!extensionReopensGrade({ iso, grade, submission: sub })) return false;

  const { error } = await db.from('grades').update({ is_finalized: false }).eq('id', grade.id);
  if (error) {
    console.warn('[grade] extension granted, but re-opening the grade failed:', error.message);
    return false;
  }

  // `cause` is the whole point of logging this separately: a month later, a bare 'reopened'
  // event beside a grade nobody remembers touching reads as an unexplained retraction. The
  // extension's own reason is copied in rather than referenced, so the entry still says why
  // if the extension is later amended or removed.
  const { error: logErr } = await db.from('grade_events').insert({
    grade_id: grade.id, event: 'reopened', actor: ctx.user.id,
    detail: { cause: 'extension', extended_due_at: iso, reason },
  });
  if (logErr) console.warn('[grade] re-opened by extension, but the audit event failed:', logErr.message);
  return true;
}

export function removeExtension(offeringId, enrollmentId) {
  return db.from('extensions').delete()
    .eq('assignment_offering_id', offeringId).eq('enrollment_id', enrollmentId);
}

/** Director override. Soft by design — see the 007 header. */
export function revokeExtension(ctx, extensionId, reason) {
  const why = String(reason || '').trim();
  if (!why) return Promise.resolve({ error: { message: 'A reason is required to revoke an extension.' } });
  return db.from('extensions').update({
    revoked_at: new Date().toISOString(),
    revoked_by: ctx.user.id,
    revoked_reason: why,
  }).eq('id', extensionId).is('revoked_at', null);
}

/** Undo a revocation. The row's original grant details are untouched by revocation. */
export function reinstateExtension(extensionId) {
  return db.from('extensions').update({
    revoked_at: null, revoked_by: null, revoked_reason: null,
  }).eq('id', extensionId);
}

/**
 * Every extension in the current course offering, for the director's report.
 *
 * No DDL was needed to make this visible: a director's staff_assignments row carries
 * section_id IS NULL, so app.staff_sections() already returns every section of the offering
 * and extensions_staff_read admits the rows. The `.in()` below narrows, it does not secure.
 *
 * Revoked rows ARE included — the report's job is to count what was granted, and a revoked
 * extension that vanished would quietly flatter whoever granted it.
 */
export async function courseExtensions(ctx, sectionIds) {
  const scope = (sectionIds && sectionIds.length) ? sectionIds : null;
  if (!scope) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', scope);
  const byEnrollment = Object.fromEntries((enrolRows || []).map(e => [e.id, e]));
  const enrollmentIds = Object.keys(byEnrollment);
  if (!enrollmentIds.length) return [];

  const [exts, offerings, staff] = await Promise.all([
    fetchAll(() => db.from('extensions').select(EXTENSION_SELECT)
      .in('enrollment_id', enrollmentIds).order('created_at', { ascending: false })),
    db.from('assignment_offerings')
      .select('id, due_at, points_possible, assignments!inner(slug, title)')
      .eq('course_offering_id', ctx.currentOffering),
    db.from('instructors').select('id, name'),
  ]);

  const offeringOf = Object.fromEntries((offerings.data || []).map(o => [o.id, o]));
  const nameOf = Object.fromEntries((staff.data || []).map(i => [i.id, i.name]));

  return (exts.data || []).map(row => {
    const x = shapeExtension(row);
    const e = byEnrollment[x.enrollmentId];
    const o = offeringOf[x.offeringId];
    return {
      ...x,
      studentId: e?.student_id ?? null,
      studentName: e?.students?.name || String(e?.student_id ?? ''),
      sectionId: e?.section_id ?? null,
      assignmentTitle: o?.assignments?.title || '—',
      assignmentSlug: o?.assignments?.slug || '',
      originalDue: o?.due_at || null,
      grantedByName: nameOf[x.grantedBy] || (x.grantedBy ? 'Unknown instructor' : '—'),
      revokedByName: nameOf[x.revokedBy] || null,
    };
  }).filter(r => r.offeringId in offeringOf);   // other offerings' rows are not this report
}

/* ── Review sign-off (migration 007): WITHDRAWN 2026-07-27 ───────────────────
 *
 * `loadSignoffs()`, `signOffSection()`, `clearSignoff()` and `signoffStale()` lived here and
 * backed the Grade page's "Mark section reviewed" button, the pill bar under it, and the
 * `review_signoffs` table.
 *
 * WHAT IT ASSUMED. Two roles and two steps: the instructor attests "I have read the AI's
 * proposals for my section", and then somebody else — the director — publishes. The attestation
 * existed so that second person could see who was ready.
 *
 * WHY IT IS GONE. Faculty beta, 2026-07-27: there is no second person. Finalizing publishes
 * exactly the sections currently loaded, and `grades_staff_write` has always admitted any
 * staff member of those sections, so an instructor pressing **Finalize & publish** releases
 * their own section and nothing else — which is the whole authorization argument. With the
 * instructor doing both, the attestation is a note-to-self placed one click from the button
 * that actually does the work, and a second control that publishes nothing is a control people
 * click by mistake.
 *
 * THE TABLE IS NOT DROPPED. DDL on `app` is sealed (CORE.md §0), and dropping it would also
 * discard the rows already written. It is simply no longer read or written; nothing renders it.
 * If a two-step review is ever wanted again, this is the git history to start from — but note
 * that it should not come back as a button beside Finalize.
 */

/* ── Worklists ───────────────────────────────────────────────────────────────
 * The queues answer the question the Grade tab could not: not "how do I grade THIS
 * assignment", but "what do I owe". They are the mechanism that stops a late submission
 * from being lost — `preflight-analyze` runs once, after the section deadline, so a student
 * on an extension submits into silence unless something remembers them.
 *
 * Both are pure reads over existing tables; no DDL, and no new denormalised state to drift.
 */

/* `extensionsToGrade()` lived here until 2026-07-23 and is now `buildGradingQueue()` below.
 *
 * It answered the same question one assignment at a time, off the maps the Grade page had already
 * loaded — which meant an expired extension on a lesson you were not currently looking at was
 * invisible. P1.14's queue is cross-assignment and per-student, so the narrower version had no
 * caller left. The RULE it encoded (active extension + past its date + work in + not finalized)
 * is carried over unchanged. */

/**
 * Assignments in this offering whose deadline has passed and which still hold unfinalized
 * work. Cross-assignment on purpose — the Grade tab is otherwise strictly one-at-a-time,
 * which is exactly why nothing ever surfaced the backlog.
 *
 * Deliberately counts only students who SUBMITTED. A non-submitter is a roster question, not
 * a grading backlog, and mixing the two makes the number too big to act on.
 */
export async function pastDueUngraded(ctx, sectionIds, now = new Date()) {
  if (!ctx.currentOffering || !sectionIds?.length) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, section_id').in('section_id', sectionIds).eq('status', 'active');
  const enrollmentIds = (enrolRows || []).map(e => e.id);
  const sectionOf = Object.fromEntries((enrolRows || []).map(e => [e.id, e.section_id]));
  if (!enrollmentIds.length) return [];

  // offering_activities rides along so the WRITTEN activity id is known per offering — the only
  // way to tell an interactive taker from a written one, and since 2026-07-27 the Grade page
  // does not show interactive takers at all. A box counting work that is not on the page it
  // links to is the same confusion the queue exists to prevent.
  const { data: offerings } = await db.from('assignment_offerings')
    .select('id, due_at, due_by_day, position, is_published, assignments!inner(slug, title),' +
            'assignment_due_dates(section_id, due_at),' +
            'offering_activities(activity_id, activities(id, modality))')
    .eq('course_offering_id', ctx.currentOffering).eq('is_published', true);

  const offeringIds = (offerings || []).map(o => o.id);
  if (!offeringIds.length) return [];

  const [subs, grds, exts] = await Promise.all([
    fetchAll(() => db.from('submissions').select('enrollment_id, assignment_offering_id, status, chosen_activity_id')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)),
    fetchAll(() => db.from('grades').select('enrollment_id, assignment_offering_id, is_finalized')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)),
    fetchAll(() => db.from('extensions').select('enrollment_id, assignment_offering_id, extended_due_at')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)
      .is('revoked_at', null)),
  ]);

  const key = (e, o) => `${e}|${o}`;
  const finalized = new Set((grds.data || [])
    .filter(g => g.is_finalized).map(g => key(g.enrollment_id, g.assignment_offering_id)));
  const graded = new Set((grds.data || []).map(g => key(g.enrollment_id, g.assignment_offering_id)));
  const extBy = Object.fromEntries((exts.data || [])
    .map(x => [key(x.enrollment_id, x.assignment_offering_id), x.extended_due_at]));

  const rows = [];
  for (const o of offerings) {
    const dueBySection = Object.fromEntries(
      (o.assignment_due_dates || []).map(d => [d.section_id, d.due_at]));
    // Same level-3 fold as everywhere else: a section with no explicit row takes its own
    // meeting day's deadline rather than the offering default (migration 017).
    const shaped = withResolvedDue(
      { dueAt: o.due_at, dueBySection, dueByDay: o.due_by_day || {} }, offeringSections(ctx));
    const writtenActivityId =
      (o.offering_activities || []).find(oa => oa.activities?.modality === 'written')?.activity_id || null;

    let outstanding = 0, ungraded = 0, waiting = 0;
    for (const s of (subs.data || []).filter(x => x.assignment_offering_id === o.id)) {
      const k = key(s.enrollment_id, o.id);
      if (finalized.has(k)) continue;
      // Committed to the interactive path — auto-graded on commit (migration 015) and not shown
      // on the Grade page. A draft (nothing chosen) stays in: they may yet land on the written one.
      if (s.chosen_activity_id && s.chosen_activity_id !== writtenActivityId) continue;
      // A student still inside an extension is not a backlog item yet — they show up in the
      // extensions queue when their own clock runs out.
      const { isPast } = effectiveDue(shaped, sectionOf[s.enrollment_id], extBy[k] || null, now);
      if (!isPast) { waiting++; continue; }
      outstanding++;
      if (!graded.has(k)) ungraded++;
    }
    if (outstanding > 0) {
      rows.push({
        offeringId: o.id,
        title: o.assignments?.title || o.assignments?.slug || '—',
        slug: o.assignments?.slug || '',
        dueAt: o.due_at,
        position: o.position ?? 0,
        outstanding,      // submitted, past their own deadline, not finalized
        ungraded,         // of those, with no grade row at all
        waiting,          // still inside an extension; shown for context, not as backlog
      });
    }
  }
  return rows.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
}

/* ── The hand-grading queue (P1.14) ──────────────────────────────────────────
 *
 * WHAT THIS REPLACED, AND WHY IT IS A DIFFERENT SHAPE
 *   The Grade page used to carry a "Submitted late" FILTER: pick an assignment, pick a section,
 *   then narrow the cards down to the late ones. That answers the wrong question. An instructor
 *   does not want to filter a section down to late work — they want the short standing list of
 *   the handful of submissions that need a human, without first guessing which assignment holds
 *   them. A filter makes you go looking; a queue comes to you.
 *
 * WHAT IS IN IT
 *   Exactly two things, both of which are "the AI run has already happened and missed this":
 *     late            — committed after that student's own deadline, not finalized
 *     extension-expired — their extension has now passed, work is in, nothing published
 *   /preflight-analyze runs once, after the section deadline. Anything that arrives afterwards is
 *   invisible unless something remembers it, and these are the two ways that happens.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *   INTERACTIVE TAKERS. Migration 015 grades them on commit — finalized, derived, from the report
 *   effort — so there is nothing for a human to do and listing them would train people to ignore
 *   the queue. This is the one rule here that is a claim about another part of the system rather
 *   than about this data, so it is asserted narrowly: a submission whose CHOSEN activity is not
 *   the written one is out. A draft (nothing chosen) is still in, because that student may yet
 *   land on the written path.
 *
 *   Also out: non-submitters. That is a roster conversation, not a grading backlog, and the
 *   rollup's "Did not submit" panel is where it already lives.
 */

/**
 * Pure half — takes the five row-sets, returns the queue. Unit-tested without a network.
 *
 * @param {object} data
 *   offerings   [{ id, dueAt, dueBySection, slug, title, position, writtenActivityId }]
 *   students    [{ student_id, name, enrollment_id, section_id }]
 *   submissions [{ enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at }]
 *   grades      [{ enrollment_id, assignment_offering_id, is_finalized, source }]
 *   extensions  [{ enrollment_id, assignment_offering_id, extended_due_at, reason }]  ACTIVE only
 * @param {Date} [now]
 */
export function buildGradingQueue({ offerings, students, submissions, grades, extensions }, now = new Date()) {
  const key = (e, o) => `${e}|${o}`;
  const studentOf = Object.fromEntries((students || []).map(s => [s.enrollment_id, s]));
  const gradeBy = Object.fromEntries((grades || []).map(g => [key(g.enrollment_id, g.assignment_offering_id), g]));
  const extBy = Object.fromEntries((extensions || []).map(x => [key(x.enrollment_id, x.assignment_offering_id), x]));
  const offeringBy = Object.fromEntries((offerings || []).map(o => [o.id, o]));

  const out = [];
  for (const sub of (submissions || [])) {
    if (sub.status !== 'committed') continue;              // a draft is not waiting on a grader
    const st = studentOf[sub.enrollment_id];
    const off = offeringBy[sub.assignment_offering_id];
    if (!st || !off) continue;

    // Auto-graded on commit — see the header.
    if (sub.chosen_activity_id && sub.chosen_activity_id !== off.writtenActivityId) continue;

    const k = key(sub.enrollment_id, off.id);
    const g = gradeBy[k];
    if (g?.is_finalized) continue;                          // already published

    const ext = extBy[k];
    const extISO = ext?.extended_due_at || null;
    // shapeOffering()'s two fields are all effectiveDue/submissionLateness read.
    const shaped = { dueAt: off.dueAt, dueBySection: off.dueBySection || {} };
    const late = submissionLateness(shaped, st.section_id, extISO, sub.committed_at);
    const extExpired = !!extISO && new Date(extISO) <= now;

    // Late wins when both apply: it is the more specific fact, and an extension that was blown
    // through is exactly the case a grader wants named as late rather than as "extension over".
    const reason = late.late ? 'late' : extExpired ? 'extension-expired' : null;
    if (!reason) continue;

    out.push({
      offeringId: off.id,
      slug: off.slug,
      title: off.title,
      dueAt: off.dueAt,
      position: off.position ?? 0,
      studentId: st.student_id,
      studentName: st.name,
      sectionId: st.section_id,
      enrollmentId: st.enrollment_id,
      reason,
      lateMs: late.late ? late.ms : 0,
      due: late.due || (extISO ? new Date(extISO) : null),
      extendedDue: extISO,
      extensionReason: ext?.reason || '',
      // Same vocabulary extensionsToGrade() already uses, so the two read alike.
      state: !g ? 'ungraded' : (g.source === 'ai_suggested' ? 'ai-only' : 'draft'),
    });
  }

  // Oldest deadline first, then by name. The thing that has been waiting longest is the thing
  // most likely to be forgotten, and it is also the one a cadet is most likely to ask about.
  return out.sort((a, b) =>
    new Date(a.dueAt || 0) - new Date(b.dueAt || 0)
    || lastFirst(a.studentName).localeCompare(lastFirst(b.studentName)));
}

/**
 * The queue, fetched. Scoped by the CALLER to the sections they personally teach — see
 * schema.js `actionableSections()` for why "what I can see" is the wrong scope for a worklist.
 *
 * Cross-assignment on purpose: the Grade page is otherwise strictly one-at-a-time, which is
 * exactly why nothing ever surfaced a backlog.
 */
export async function gradingQueue(ctx, sectionIds, now = new Date()) {
  if (!ctx.currentOffering || !sectionIds?.length) return [];

  const { data: enrolRows } = await db.from('enrollments')
    .select('id, student_id, section_id, students!inner(student_id, name)')
    .in('section_id', sectionIds).eq('status', 'active');
  const students = (enrolRows || []).map(e => ({
    student_id: e.student_id,
    name: e.students?.name || String(e.student_id),
    enrollment_id: e.id,
    section_id: e.section_id,
  }));
  if (!students.length) return [];
  const enrollmentIds = students.map(s => s.enrollment_id);

  // offering_activities is embedded so the written activity id is known per offering — that is
  // what separates an interactive taker from a written one, and there is no other source for it.
  const { data: offeringRows } = await db.from('assignment_offerings')
    .select('id, due_at, due_by_day, position, assignments!inner(slug, title),' +
            'assignment_due_dates(section_id, due_at),' +
            'offering_activities(activity_id, activities(id, modality))')
    .eq('course_offering_id', ctx.currentOffering).eq('is_published', true);

  const gradeSections = offeringSections(ctx);
  const offerings = (offeringRows || []).map(o => withResolvedDue({
    id: o.id,
    dueAt: o.due_at,
    position: o.position ?? 0,
    slug: o.assignments?.slug || '',
    title: o.assignments?.title || o.assignments?.slug || '—',
    dueBySection: Object.fromEntries((o.assignment_due_dates || []).map(d => [d.section_id, d.due_at])),
    dueByDay: o.due_by_day || {},
    writtenActivityId:
      (o.offering_activities || []).find(oa => oa.activities?.modality === 'written')?.activity_id || null,
  }, gradeSections));
  const offeringIds = offerings.map(o => o.id);
  if (!offeringIds.length) return [];

  const [subs, grds, exts] = await Promise.all([
    fetchAll(() => db.from('submissions')
      .select('enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)),
    fetchAll(() => db.from('grades').select('enrollment_id, assignment_offering_id, is_finalized, source')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)),
    fetchAll(() => db.from('extensions').select('enrollment_id, assignment_offering_id, extended_due_at, reason')
      .in('assignment_offering_id', offeringIds).in('enrollment_id', enrollmentIds)
      .is('revoked_at', null)),
  ]);

  return buildGradingQueue({
    offerings, students,
    submissions: subs.data || [], grades: grds.data || [], extensions: exts.data || [],
  }, now);
}

/**
 * Clear a student's committed choice so they may pick again.
 *
 * unlocked_by MUST be the caller: submissions_lock_activity() (hardened in migration 006)
 * rejects an unlock attributed to anyone else, which is what stops an unlock from being
 * pinned on a colleague who did not perform it.
 */
export async function unlockSubmission(ctx, submissionId) {
  return db.from('submissions').update({
    chosen_activity_id: null,
    status: 'draft',
    unlocked_by: ctx.user.id,
    unlocked_at: new Date().toISOString(),
  }).eq('id', submissionId);
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * Publishing everything that is due  (2026-09-29)
 * ════════════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 *   Blackboard gets a blank for any grade that is not published (blackboard-fill.js rule 2, and
 *   rightly: a blank is honest, a zero nobody gave is not). Directors were finding blanks in every
 *   export, and each one traced back to this page:
 *
 *     - On a lesson with an iPREP option a cadet who handed in nothing gets the no-submission card,
 *       and Finalize sent only EDITED rows from those cards (effortRows() rule 2). The AI's zero for
 *       them was never published — 351 in phys-110 and 212 in phys-215 on the day this landed.
 *     - A cadet with no grade row at all stayed blank for good: all of Lesson 7 in both courses (the
 *       first iPREP lesson, which the zero rule never reached), and any night the scheduled run missed.
 *     - Save draft un-published whatever it re-sent (gradeRows() rule 3).
 *
 *   One failure ran the other way. A cadet who got a zero, then an extension, then did the work had
 *   the stale zero re-published over it by the next Finalize — six cadets across both courses, found
 *   the same day. The help page promised "the next run replaces the zero"; the scheduled run never
 *   goes back to an old lesson, so nothing did.
 *
 * ONE RULE, TWO BUTTONS
 *   planPublish() decides, per cadet per lesson, whether a saved grade is due to be published,
 *   whether a zero is owed, or whether a person must look first. The director's "Publish everything
 *   that is due" (admin.html → Export) runs it over the whole course; the Grade page's Finalize &
 *   publish runs it over the lesson and sections on screen. Neither decides anything the other does not.
 *
 * THE ZERO RULE HAS THREE COPIES, AND THEY MUST AGREE
 *   planPublish() here, `scripts/fall2026/zero_non_submitters.py` (conditions 1-6), and the zero
 *   section of `.ai/skills/preflight-analyze/SKILL.md`. Change one, change all three. zeroRow() is
 *   the script's zero_row() except for who wrote it: a person pressed a button here, so the row is
 *   `source: 'instructor'`, published, and `diagnostic.source: 'publish'`.
 *
 * WHAT IT NEVER DOES
 *   Re-publish a finalized grade, write over a grade that exists, publish for a cadet whose deadline
 *   or extension has not passed, or zero a cadet whose other enrollments it cannot see. A row it will
 *   not decide is HELD with a reason and listed, never dropped in silence.
 */

export const NO_SUBMISSION_FEEDBACK = 'No submission received.';

/** Why planPublish() held a row back — the words a director reads beside it. */
export const PUBLISH_HOLDS = {
  'still-open':         'Still has time — deadline or extension not passed',
  'stale-zero':         'Zero was written before they handed in — grade the work',
  'after-grading':      'Handed in again after it was graded — review it',
  'draft-answers':      'Started but never submitted — grade it by hand',
  'submitted-ungraded': 'Handed in, not graded yet',
  'stranded':           'Their work is on another enrollment — check their sections',
  'no-score':           'Saved draft has no score',
  'cannot-check':       'Cannot see all of their sections — a director can publish this',
};

const chunks = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * Can this viewer see every section of the offering? The zero rule's condition 6 — work on another
 * of the cadet's enrollments — cannot be checked otherwise: an instructor staffed to two sections
 * cannot read an enrollment or a submission in a third (enrollments_read_staff,
 * submissions_staff_read), so the absence would look like no work at all.
 */
export function seesWholeOffering(ctx) {
  const all = Object.keys(ctx?.sectionsById || {});
  const mine = new Set(ctx?.sectionIds || []);
  return all.length > 0 && all.every(id => mine.has(id));
}

/** A shapeOffering() result (deadlines resolved) → the fields planPublish() and zeroRow() read. */
export function planOffering(o) {
  return {
    id: o.offeringId ?? o.id,
    slug: o.slug || '',
    title: o.title || o.slug || '—',
    position: o.position ?? 0,
    dueAt: o.dueAt ?? null,
    dueBySection: o.dueBySection || {},
    dueDerivedFor: o.dueDerivedFor,
    writtenActivityId: o.written?.id ?? o.writtenActivityId ?? null,
    questions: o.written ? questionsOf(o.written) : (o.questions || []),
    pointsPossible: Number(o.pointsPossible ?? 0),
  };
}

/**
 * Was a grade written before the work it describes? True when the work's time is later than the
 * grade's, and — deliberately — when either time is missing: an answer nobody can date is a
 * question for a person, and every caller turns `true` into "hold it" or "show a warning".
 *
 * This is what separates a STALE no-submission zero from one a person has already dealt with.
 * `diagnostic.no_submission` is never cleared — gradeRows() does not send `diagnostic`, on purpose
 * — so it outlives a re-grade: on 2026-09-29, 48 phys-110 grades still carried it after an
 * instructor had opened the work and given it credit. The flag says who wrote the zero; only the
 * clock says whether anyone has looked since.
 */
function predates(gradedAt, workAt) {
  const g = Date.parse(gradedAt || ''), w = Date.parse(workAt || '');
  return !Number.isFinite(g) || !Number.isFinite(w) || w > g;
}

/**
 * Is this saved grade a no-submission ZERO denying work that nobody has looked at? The caller has
 * already established that work is behind it. Three conditions:
 *
 *   - it is worth 0 and carries `diagnostic.no_submission`. Credit given before the work arrived
 *     is not a zero, whatever the flag says (one phys-110 cadet holds 2/2 under it);
 *   - and EITHER it is still the AI's row — no person has touched it, so it cannot be a decision.
 *     The clock is not trusted here: when a writer left `graded_at` null, the next Finalize
 *     stamped it with the publish time, and one phys-215 zero reads 6 Sep over work handed in on
 *     20 Aug;
 *   - OR a person saved it (an edited card, or a zero this page created) before the work came in
 *     (predates()). A person's zero dated after the work is their decision — a late submission
 *     refused, say — and stands.
 */
function isStaleZero({ nosub, points, source, gradedAt }, workAt) {
  if (!nosub || points == null || Number(points) !== 0) return false;
  return source === 'ai_suggested' || predates(gradedAt, workAt);
}

/**
 * The cadets whose saved grade is a no-submission zero although their work is now in.
 *
 * `/preflight-analyze` and zero_non_submitters.py mark every zero they write with
 * `diagnostic.no_submission`. A cadet granted an extension who then hands in keeps that row until a
 * person grades the work — the scheduled run never revisits an old lesson — so the card looked
 * graded (red chips, "No submission received.") and Finalize published it. That is how six cadets
 * came to hold a published zero for work they had done under an extension.
 *
 * "Work is in" is the exact complement of the zero rule's condition 4: committed to the interactive
 * path, or any non-empty written answer, submitted or not. Whether the zero still stands is
 * isStaleZero()'s question — a zero an instructor has re-graded since is theirs, not stale.
 */
export function staleZeroIds(offering, students, gradeMap = {}, submissionMap = {}, responseMap = {}) {
  const writtenId = offering?.written?.id ?? null;
  const out = new Set();
  (students || []).forEach(st => {
    const sid = st.student_id;
    const prior = gradeMap[sid];
    if (prior?.diagnostic?.no_submission !== true) return;
    const sub = submissionMap[sid];
    const chosen = sub?.chosenActivityId;
    if (!((chosen && chosen !== writtenId) || hasAnyAnswer(responseMap[sid]))) return;
    const workAt = sub?.status === 'committed' ? sub?.committedAt : sub?.updatedAt;
    if (isStaleZero({ nosub: true, points: prior.pointsEarned, source: prior.source,
                      gradedAt: prior.gradedAt }, workAt)) out.add(sid);
  });
  return out;
}

/**
 * The rule. Pure — every row it needs is passed in — so it is unit-tested without a network, and
 * both buttons run exactly this.
 *
 * @param {object} data
 *   offerings    planOffering() shapes
 *   students     [{ student_id, name, enrollment_id, section_id }] — ACTIVE enrollments in scope
 *   submissions  [{ id, enrollment_id, assignment_offering_id, chosen_activity_id, status,
 *                   committed_at, updated_at }], including any on the `siblings` enrollments
 *   grades       [{ id, enrollment_id, assignment_offering_id, is_finalized, points_earned,
 *                   source, graded_at, nosub }] — nosub is `diagnostic.no_submission === true`
 *   extensions   [{ enrollment_id, assignment_offering_id, extended_due_at }] — ACTIVE only
 *   writtenContent  { [submission id]: the written activity's answers }. Needed for every
 *                submission that has no grade row or a no-submission grade; one that is missing is
 *                held as `cannot-check`, never read as blank.
 *   siblings     [{ id, student_id }] — every enrollment these cadets hold in the offering, any
 *                status (condition 6). Enrollments in scope are ignored if included.
 *   canZero      false when the viewer cannot see every section (seesWholeOffering())
 * @param {Date} [now]
 * @returns {object[]} one item per cadet-lesson that has something to say:
 *   kind 'publish' | 'zero' | 'hold' (with `reason`, a PUBLISH_HOLDS key) | 'wrong-published'
 */
export function planPublish({ offerings, students, submissions, grades, extensions,
                              writtenContent = {}, siblings = [], canZero = true }, now = new Date()) {
  const key = (e, o) => `${e}|${o}`;
  const subBy = {}, gradeBy = {}, extBy = {};
  (submissions || []).forEach(s => { subBy[key(s.enrollment_id, s.assignment_offering_id)] = s; });
  (grades || []).forEach(g => { gradeBy[key(g.enrollment_id, g.assignment_offering_id)] = g; });
  (extensions || []).forEach(x => { extBy[key(x.enrollment_id, x.assignment_offering_id)] = x; });

  const inScope = new Set((students || []).map(s => s.enrollment_id));
  const otherEnrollments = {};
  (siblings || []).forEach(e => {
    if (inScope.has(e.id)) return;
    (otherEnrollments[e.student_id] ||= []).push(e.id);
  });

  const items = [];
  for (const off of offerings || []) {
    for (const st of students || []) {
      const k = key(st.enrollment_id, off.id);
      const g = gradeBy[k] || null;
      const sub = subBy[k] || null;
      const item = (kind, reason = null) => items.push({
        kind, reason,
        offeringId: off.id, slug: off.slug, title: off.title, position: off.position ?? 0,
        studentId: st.student_id, name: st.name, sectionId: st.section_id,
        enrollmentId: st.enrollment_id, gradeId: g?.id || null,
      });

      const committed = sub?.status === 'committed';
      const interactive = !!(sub?.chosen_activity_id && sub.chosen_activity_id !== off.writtenActivityId);
      // Is there work? true / false, or null when the answers were needed and not loaded.
      const content = sub ? writtenContent[sub.id] : undefined;
      const work = !sub ? false : interactive ? true : content === undefined ? null : hasAnyAnswer(content);
      // A no-submission zero denying work nobody has looked at — see isStaleZero().
      const staleZero = !!g && work === true && isStaleZero(
        { nosub: g.nosub, points: g.points_earned, source: g.source, gradedAt: g.graded_at },
        committed ? sub.committed_at : sub.updated_at);

      if (g?.is_finalized) {
        // Published already. Nothing to do — unless it is a zero sitting on work that came in.
        if (staleZero) item('wrong-published');
        continue;
      }

      const extISO = extBy[k]?.extended_due_at || null;
      const { isPast } = effectiveDue(off, st.section_id, extISO, now);

      if (g) {
        // A saved, unpublished grade: publish it, unless a person has to look first.
        if (!isPast && !committed) item('hold', 'still-open');
        else if (g.nosub && work === null) item('hold', 'cannot-check');
        else if (staleZero) item('hold', 'stale-zero');
        else if (committed && g.graded_at && sub.committed_at
                 && new Date(sub.committed_at) > new Date(g.graded_at)) item('hold', 'after-grading');
        else if (g.points_earned == null) item('hold', 'no-score');
        else item('publish');
        continue;
      }

      // No grade at all.
      if (interactive) {
        // Migration 015 grades an interactive commit the moment it lands. One with no grade is a
        // report that arrived without the data it is graded from (contract §3.1): a person's job.
        if (committed) item('hold', 'submitted-ungraded');
        else if (isPast) item('hold', 'draft-answers');
        continue;
      }
      if (!isPast) continue;                                    // nothing is owed yet
      if (work === null) { item('hold', 'cannot-check'); continue; }
      if (work) { item('hold', committed ? 'submitted-ungraded' : 'draft-answers'); continue; }

      // Conditions 1-5 hold: active, past their own deadline plus the grace, no live extension, no
      // work, no grade row. Condition 6 is the refusal — work on another of their own enrollments.
      if (!canZero) { item('hold', 'cannot-check'); continue; }
      if ((otherEnrollments[st.student_id] || []).some(eid => subBy[key(eid, off.id)])) {
        item('hold', 'stranded'); continue;
      }
      item('zero');
    }
  }
  return items;
}

/** The zero for a cadet who handed in nothing — zero_non_submitters.py's zero_row(), except for who wrote it. */
export function zeroRow(off, enrollmentId, actorId, nowIso = new Date().toISOString()) {
  const question_scores = {};
  (off.questions || []).forEach(q => {
    if (!q?.id) return;
    const max = Number(q.points) || 0;
    question_scores[q.id] = {
      score: 0, max,
      // A zero-point question deducts nothing, so it carries no feedback (CORE.md §2, Q1 privacy).
      feedback: max ? NO_SUBMISSION_FEEDBACK : '',
      status: 'zero',
    };
  });
  return {
    enrollment_id: enrollmentId,
    assignment_offering_id: off.id,
    submission_id: null,
    points_earned: 0,
    points_possible: off.pointsPossible,
    question_scores,
    diagnostic: {
      q2_effort: 0, q3_understanding: 0, schema: 1,
      source: 'publish',
      // What separates this from a submission of gibberish, which scores identically.
      no_submission: true,
      effort: 0, overall_understanding: 0, objectives: [], misconceptions: [],
      reading_reflection: { meaningful: false, engagement: 0 },
      flags: { needs_follow_up: true, notable: false },
    },
    source: 'instructor',
    is_finalized: true,
    graded_by: actorId,
    graded_at: nowIso,
  };
}

/**
 * Carry out a plan: publish the `publish` items and create the `zero` items. Nothing else is written.
 *
 * PUBLISHING IS A FLAG, NEVER A REWRITE. grades_points_from_effort() (migration 019) recomputes
 * points on any UPDATE of a row that carries an effort — to the value it already holds — and leaves
 * every other row alone, so no score moves. Provenance (`source`, `graded_by`, `graded_at`) is kept,
 * as gradeRows() rule 1 keeps it: publishing records who RELEASED a grade, not who wrote it, and
 * grade_events is where that goes.
 *
 * `.eq('is_finalized', false)` makes a second press a no-op, and `ignoreDuplicates` means a zero
 * never lands on a row something else wrote in the meantime (a scheduled run, a colleague's Finalize).
 *
 * confirmEffortRows() is deliberately NOT applied. Finalize raises a capped effort because an
 * instructor looking at the card asserted the work was worth full marks; a bulk publish releases
 * what is saved and asserts nothing about work nobody opened.
 *
 * @returns {Promise<{ published: number, created: number, error: object|null }>}
 */
export async function applyPublishPlan(ctx, items, offerings, { via = 'publish-all' } = {}) {
  const offById = {};
  (offerings || []).forEach(o => { const p = planOffering(o); offById[p.id] = p; });
  const nowIso = new Date().toISOString();
  const flips = [...new Set((items || [])
    .filter(i => i.kind === 'publish' && i.gradeId).map(i => i.gradeId))];
  const zeros = (items || []).filter(i => i.kind === 'zero' && offById[i.offeringId]);

  const published = [], created = [];
  let error = null;

  for (const ids of chunks(flips, 100)) {
    const res = await db.from('grades').update({ is_finalized: true })
      .in('id', ids).eq('is_finalized', false).select('id, assignment_offering_id');
    if (res.error) { error = res.error; break; }
    published.push(...(res.data || []));
  }
  if (!error) {
    const rows = zeros.map(i => zeroRow(offById[i.offeringId], i.enrollmentId, ctx.user.id, nowIso));
    for (const batch of chunks(rows, 100)) {
      const res = await db.from('grades')
        .upsert(batch, { onConflict: 'enrollment_id,assignment_offering_id', ignoreDuplicates: true })
        .select('id, assignment_offering_id');
      if (res.error) { error = res.error; break; }
      created.push(...(res.data || []));
    }
  }

  // Append-only audit, best-effort — the same bargain as finalizeScores(): a failed log entry must
  // not cost the grades that were just published.
  const detail = (g, extra = {}) => ({
    offering: g.assignment_offering_id, slug: offById[g.assignment_offering_id]?.slug || '',
    via, bulk: true, ...extra,
  });
  const events = [
    ...created.map(g => ({ grade_id: g.id, event: 'created', actor: ctx.user.id,
                           detail: detail(g, { no_submission: true }) })),
    ...[...published, ...created].map(g => ({ grade_id: g.id, event: 'finalized', actor: ctx.user.id,
                                              detail: detail(g) })),
  ];
  for (const batch of chunks(events, 200)) {
    const { error: e } = await db.from('grade_events').insert(batch);
    if (e) { console.warn('[publish] published, but the audit event failed:', e.message); break; }
  }

  return { published: published.length, created: created.length, error };
}

/**
 * Split a plan for the Grade page: which rows the two upserts already send, which they must skip,
 * and which only applyPublishPlan() can reach.
 *
 *   - An EDITED card is the instructor's decision. The upserts write it, whatever the plan says.
 *   - A held WRITTEN card goes into `skipIds`, so gradeRows() does not re-send it (its rule 4).
 *   - `publish` on a no-submission or interactive card is a flag flip here: effortRows() never
 *     sends an untouched row, and must not (its rule 2).
 *   - `publish` on a written card needs nothing here — gradeRows() re-sends it, published.
 *   - `zero` is created here, on either kind of card.
 *
 * @returns {{ skipIds: Set<number>, flipItems: object[], zeroItems: object[], held: object[] }}
 */
export function finalizeExtras(items, gradeData = {}, effortData = {}, staleIds = null) {
  const skipIds = new Set(staleIds || []);
  const flipItems = [], zeroItems = [], held = [];
  for (const it of items || []) {
    const sid = it.studentId;
    const ed = effortData[sid];
    const edited = ed ? !!ed.modified : Object.values(gradeData[sid] || {}).some(q => q?.modified);
    if (edited) continue;
    if (it.kind === 'hold') { held.push(it); if (!ed) skipIds.add(sid); continue; }
    if (it.kind === 'publish' && ed) flipItems.push(it);
    else if (it.kind === 'zero') zeroItems.push(it);
  }
  return { skipIds, flipItems, zeroItems, held };
}

/**
 * planPublish() over what the Grade page already holds, plus the one thing it does not: the
 * cadets' other enrollments, for condition 6. Nothing else is re-read, so the plan describes
 * exactly the cards on screen.
 *
 * @returns {Promise<{ items: object[], error: object|null }>}
 */
export async function viewPublishPlan(ctx, { offering, students, gradeMap = {}, submissionMap = {},
                                             extensionMap = {} }, now = new Date()) {
  const off = planOffering(offering);
  const byStudent = Object.fromEntries((students || []).map(s => [s.student_id, s]));
  const submissions = [], grades = [], extensions = [], writtenContent = {};

  Object.entries(submissionMap).forEach(([sid, s]) => {
    const st = byStudent[sid];
    if (!st || !s) return;
    submissions.push({ id: s.id, enrollment_id: st.enrollment_id, assignment_offering_id: off.id,
      chosen_activity_id: s.chosenActivityId || null, status: s.status, committed_at: s.committedAt || null,
      updated_at: s.updatedAt || null });
    // The page loaded every submission with its activities, so nothing here is ever "unknown".
    writtenContent[s.id] = (off.writtenActivityId && s.activities?.[off.writtenActivityId]?.content) || {};
  });
  Object.entries(gradeMap).forEach(([sid, g]) => {
    const st = byStudent[sid];
    if (!st || !g) return;
    grades.push({ id: g.gradeId, enrollment_id: st.enrollment_id, assignment_offering_id: off.id,
      is_finalized: !!g.finalized, points_earned: g.pointsEarned, source: g.source || null,
      graded_at: g.gradedAt || null, nosub: g.diagnostic?.no_submission === true });
  });
  Object.entries(extensionMap).forEach(([sid, x]) => {
    const st = byStudent[sid];
    if (!st || !x?.due || x.isRevoked) return;
    extensions.push({ enrollment_id: st.enrollment_id, assignment_offering_id: off.id, extended_due_at: x.due });
  });

  const canZero = seesWholeOffering(ctx);
  let siblings = [];
  if (canZero && (students || []).length) {
    const wanted = new Set(students.map(s => s.student_id));
    const enr = await fetchAll(() => db.from('enrollments').select('id, student_id, status')
      .in('section_id', Object.keys(ctx.sectionsById || {})));
    if (enr.error) return { items: [], error: enr.error };
    siblings = (enr.data || []).filter(e => wanted.has(e.student_id));
    const others = siblings.filter(e => !byStudent[e.student_id] || byStudent[e.student_id].enrollment_id !== e.id);
    if (others.length) {
      const sib = await fetchAll(() => db.from('submissions')
        .select('id, enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at, updated_at')
        .eq('assignment_offering_id', off.id).in('enrollment_id', others.map(e => e.id)));
      if (sib.error) return { items: [], error: sib.error };
      submissions.push(...(sib.data || []));
    }
  }

  return {
    items: planPublish({ offerings: [off], students, submissions, grades, extensions,
                         writtenContent, siblings, canZero }, now),
    error: null,
  };
}

/**
 * The whole course's plan, for the director's Publish-all (admin.html → Export).
 *
 * Reads by OFFERING, never by a list of enrollment ids: a whole course is ~500 of them, and a URL
 * carrying 500 uuids is ~18 KB — past what some proxies accept, with nothing to say so. RLS already
 * confines every read to the caller's sections, and a director's are all of them. Any failed read
 * aborts the whole plan: a plan built from part of the data would zero cadets whose work it missed.
 *
 * @returns {Promise<{ items: object[], offerings: object[], error: object|null }>}
 */
export async function loadPublishPlan(ctx, now = new Date()) {
  const empty = { items: [], offerings: [], error: null };
  if (!ctx.currentOffering) return empty;
  const sectionIds = Object.keys(ctx.sectionsById || {});
  if (!sectionIds.length) return empty;
  const scope = new Set(ctx.sectionIds || []);

  const [offRes, enrRes] = await Promise.all([
    db.from('assignment_offerings').select(OFFERING_SELECT)
      .eq('course_offering_id', ctx.currentOffering).eq('is_published', true),
    fetchAll(() => db.from('enrollments')
      .select('id, student_id, section_id, status, students!inner(student_id, name)')
      .in('section_id', sectionIds)),
  ]);
  if (offRes.error) return { ...empty, error: offRes.error };
  if (enrRes.error) return { ...empty, error: enrRes.error };

  const offerings = (offRes.data || [])
    .map(r => withResolvedDue(shapeOffering(r), offeringSections(ctx)))
    .filter(Boolean)
    .map(planOffering);
  const offeringIds = offerings.map(o => o.id);
  if (!offeringIds.length) return { ...empty, offerings };

  const all = enrRes.data || [];
  const students = all
    .filter(e => e.status === 'active' && scope.has(e.section_id))
    .map(e => ({ student_id: e.student_id, name: e.students?.name || String(e.student_id),
                 enrollment_id: e.id, section_id: e.section_id }));
  const siblings = all.map(e => ({ id: e.id, student_id: e.student_id }));

  const [subs, grds, exts] = await Promise.all([
    fetchAll(() => db.from('submissions')
      .select('id, enrollment_id, assignment_offering_id, chosen_activity_id, status, committed_at, updated_at')
      .in('assignment_offering_id', offeringIds)),
    fetchAll(() => db.from('grades')
      .select('id, enrollment_id, assignment_offering_id, is_finalized, points_earned, source, graded_at,' +
              'nosub:diagnostic->>no_submission')
      .in('assignment_offering_id', offeringIds)),
    fetchAll(() => db.from('extensions')
      .select('id, enrollment_id, assignment_offering_id, extended_due_at')
      .in('assignment_offering_id', offeringIds).is('revoked_at', null)),
  ]);
  for (const r of [subs, grds, exts]) if (r.error) return { ...empty, offerings, error: r.error };

  // `->>` returns text, so the flag arrives as the string 'true'.
  const grades = (grds.data || []).map(g => ({ ...g, nosub: g.nosub === true || g.nosub === 'true' }));

  // Answers are read only where the rule needs them: a submission with no grade (zero, or work
  // nobody graded?) and one whose grade is a no-submission zero (stale?). Everything else is graded.
  const key = (e, o) => `${e}|${o}`;
  const gradeBy = Object.fromEntries(grades.map(g => [key(g.enrollment_id, g.assignment_offering_id), g]));
  const need = (subs.data || []).filter(s => {
    const g = gradeBy[key(s.enrollment_id, s.assignment_offering_id)];
    return !g || g.nosub;
  });
  const writtenOf = Object.fromEntries(offerings.map(o => [o.id, o.writtenActivityId]));
  const offeringOfSub = Object.fromEntries(need.map(s => [s.id, s.assignment_offering_id]));
  const writtenContent = {};
  need.forEach(s => { writtenContent[s.id] = {}; });        // read ⇒ known; no written row ⇒ blank
  for (const ids of chunks(need.map(s => s.id), 100)) {
    const res = await db.from('submission_activities')
      .select('submission_id, activity_id, content').in('submission_id', ids);
    if (res.error) return { ...empty, offerings, error: res.error };
    (res.data || []).forEach(sa => {
      if (sa.activity_id === writtenOf[offeringOfSub[sa.submission_id]]) {
        writtenContent[sa.submission_id] = sa.content || {};
      }
    });
  }

  const items = planPublish({
    offerings, students, submissions: subs.data || [], grades, extensions: exts.data || [],
    writtenContent, siblings, canZero: seesWholeOffering(ctx),
  }, now);
  return { items, offerings, error: null };
}

/** Per-lesson counts for the director's table, in lesson order. */
export function summarizePublishPlan(items) {
  const by = {};
  for (const it of items || []) {
    const r = (by[it.offeringId] ||= { offeringId: it.offeringId, slug: it.slug, title: it.title,
      position: it.position ?? 0, publish: 0, zero: 0, hold: 0, wrong: 0 });
    if (it.kind === 'publish') r.publish++;
    else if (it.kind === 'zero') r.zero++;
    else if (it.kind === 'hold') r.hold++;
    else if (it.kind === 'wrong-published') r.wrong++;
  }
  return Object.values(by).sort((a, b) =>
    (a.position - b.position) || String(a.slug).localeCompare(String(b.slug)));
}
