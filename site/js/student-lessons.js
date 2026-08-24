// student-lessons.js — lesson-centric view for a logged-in student, against schema `app`.
//
// Spec: docs/architecture/STUDENT-LESSON-VIEW.md §4 (states) and §9 (this file).
//
// ── WHY THIS FILE IS NOW THIN ────────────────────────────────────────────────────
// It used to carry its own queries, its own deadline maths, and its own state machine over
// four tables (lessons, assignments, interactions, responses, lesson_completions) — because
// in `public` a "lesson" was a reconciliation layer bolted over two parallel worlds, and the
// student view had to do that reconciliation itself.
//
// In `app` a lesson IS an assignment offering: one container, whose activities are the paths
// through it. So the reconciliation is gone, and this file is a PROJECTION over
// student-data.js rather than a second query layer. That is deliberate — two independent
// loaders is exactly how the old frontend drifted into showing a lesson twice, once per
// modality, as two separate mandatory items (STUDENT-LESSON-VIEW §1).
//
// The eight-state vocabulary below is preserved verbatim, because it is the student-facing
// contract the page renders and the doc describes. Only its derivation changed.
//
// `lesson_completions` is gone with no replacement: it existed to reconcile two grade
// sources, and there is now exactly one (app.grades, UNIQUE per enrollment per offering).

import { loadAssignmentStatuses } from './student-data.js';
import { questionsOf, answeredCount, displayPoints, isActivityAvailable, isArtifactLaunchable,
         policyOf, writtenPathCounts, isWrittenByPermission } from './schema.js';

/**
 * Why the interactive path is not launchable yet, in words a student can act on.
 * `available_after` is the DB field; this turns it into the sentence the gated card shows.
 * Only 'submit' and 'due' gate; 'always' never reaches here.
 */
function interactiveGate(activity) {
  if (activity?.availableAfter === 'submit') return 'after you submit your written responses';
  if (activity?.availableAfter === 'due') return 'after the due date';
  // Checked LAST, so a gate the director actually configured is reported while it applies. This
  // one is not a schedule — it is an interaction attached without its address, which a
  // Free-Response lesson may legitimately be for most of a term (schema.js isArtifactLaunchable).
  if (!isArtifactLaunchable(activity)) return 'once your instructor adds the lesson link';
  return null;
}

/* ── The Gemini backup build ─────────────────────────────────────────────────────
   A cadet on a free claude.ai account can be turned away with an HTTP 429. The Claude artifact
   runs a connection check on its start screen and offers a way out when that check fails — but a
   cadet whose session dies PARTWAY THROUGH is already past that screen, so the way out never
   appears. That is the case this link exists for: the lesson page is the one surface such a cadet
   can always get back to.

   Same slug, same receiver, same activity row (`scripts/artifacts/to_gemini.py`), so a backup is
   a transport swap and not a second assignment — it cannot split a cohort or double-count.

   The link goes through `site/student/backup.html` rather than at a build path directly, for the
   reason that router's own header gives: which build a slug resolves to is allowed to change, and
   only the router is allowed to know it.

   `loadBackupBuilds()` resolves to a plain object and NEVER rejects. A manifest that will not load
   must degrade to "no backup offered" — which is exactly how this page behaved before the link
   existed — and never to a lesson page that fails to render. */
const BACKUP_MANIFEST = '../data/backup-builds.json';
const BACKUP_ROUTER   = 'backup.html';

let backupsOnce = null;

function loadBackupBuilds() {
  if (!backupsOnce) {
    backupsOnce = (async () => {
      try {
        // Cache-busted exactly as backup.html does it: this file changes whenever a build is
        // added or withdrawn, and a stale copy would offer a lesson that is no longer there.
        const res = await fetch(`${BACKUP_MANIFEST}?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await res.json();
        return (doc && typeof doc.builds === 'object' && doc.builds) ? doc.builds : {};
      } catch {
        return {};
      }
    })();
  }
  return backupsOnce;
}

/**
 * The states a lesson can be in for one student (STUDENT-LESSON-VIEW §4).
 * Computed once, here — never re-derived in a renderer, so the list and the dashboard
 * cannot disagree.
 */
export const STATE = {
  NOT_STARTED: 'not-started',   // 1 · nothing yet, still open
  DRAFT:       'draft',         // 2 · written answers saved, not submitted
  SUBMITTED:   'submitted',     // 3 · written submitted — still editable until the deadline
  COMPLETE:    'complete',      // 4 · interaction submitted — the only lock
  GRADING:     'grading',       // 5 · past due, submitted, not yet released
  GRADED:      'graded',        // 6 · instructor released the grade
  MISSED:      'missed',        // 7 · past due, nothing submitted → 0
};

/** Status-dot colour per state. Deliberately modality-neutral: a `.tag` says which path was
 *  taken, the dot only says how far along they are. Colouring the dot by modality would make
 *  one path read as "better" at a glance down the whole list (STUDENT-LESSON-VIEW §10). */
export const STATE_DOT = {
  [STATE.NOT_STARTED]: 'grey',
  [STATE.DRAFT]:       'amber',
  [STATE.SUBMITTED]:   'green',
  [STATE.COMPLETE]:    'green',
  [STATE.GRADING]:     'blue',
  [STATE.GRADED]:      'green',
  [STATE.MISSED]:      'red',
};

/**
 * Map one stitched assignment item onto the lesson state machine.
 *
 * The one asymmetry worth naming, carried over unchanged from the old model: committing the
 * INTERACTIVE path is a lock (STATE.COMPLETE), while committing the WRITTEN path is not
 * (STATE.SUBMITTED — still editable until the deadline). The database agrees: switch_policy
 * locks which ACTIVITY carries credit, but nothing stops a student refining their written
 * answers afterwards, and nothing should.
 */
export function resolveState(item) {
  const grade = item.grade;
  if (grade?.is_finalized) return STATE.GRADED;

  const committed = item.submission?.status === 'committed';
  const chosenModality = item.chosenActivity?.modality || null;

  if (committed) {
    if (item.isPast) return STATE.GRADING;
    return chosenModality === 'interactive' ? STATE.COMPLETE : STATE.SUBMITTED;
  }
  if (item.isPast) return STATE.MISSED;
  return item.answered > 0 ? STATE.DRAFT : STATE.NOT_STARTED;
}

/**
 * What the student has FINISHED for one lesson, or null while it is still in play.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────────────
 * `resolveState(item) === STATE.GRADED` implies this returns non-null. Every renderer in a
 * GRADED branch reads `completion.points` and `completion.path` unguarded, and neither student
 * page wraps a row in try/catch — so one row that breaks the invariant throws out of main() and
 * replaces the student's whole dashboard with an error page.
 *
 * It broke on 2026-08-10 for 39 phys-110 and phys-215 cadets. This was derived from the
 * SUBMISSION (`status === 'committed'`) while the state is derived from the GRADE
 * (`is_finalized`), so the two could disagree — and they do for every cadet /preflight-analyze
 * zeroes after a deadline (`diagnostic.no_submission`): a finalized grade with no submission row
 * at all. resolveState() called that GRADED, this returned null, and simply missing preflight-02
 * locked a cadet out of the site. Exported, and tested against resolveState(), so the two
 * derivations cannot drift apart again silently.
 */
export function deriveCompletion(item, offering = item) {
  const committed = item.submission?.status === 'committed';
  const finalized = !!item.grade?.is_finalized;
  if (!committed && !finalized) return null;
  return {
    // null when there was nothing to take a path THROUGH — a zero for work never submitted.
    // Deliberately not 'preflight': that tells a cadet they were graded on a written attempt
    // they never made. Renderers treat null as "no work submitted".
    path: item.chosenActivity?.modality === 'interactive' ? 'interaction'
        : item.submission ? 'preflight' : null,
    points: displayPoints(item.grade, offering) ?? 0,
    // No `understanding` here. It read `grade.diagnostic.overall_understanding`, nothing on any
    // student page ever rendered it, and as of 2026-08-10 the student grade select does not fetch
    // `diagnostic` at all (schema.js, GRADE_SELECT_STUDENT) — so keeping the field would leave a
    // permanently-null property that reads as live. The diagnostic is faculty-side by design.
    //
    // The instructor's note is the one exception, and it is not a diagnostic: it is the reason for
    // a score a human chose. An interactive grade has no question_scores, so this is the ONLY
    // channel it has for the feedback that must accompany withheld credit. GRADE_SELECT_STUDENT
    // projects that single jsonb key and nothing else around it.
    instructorNote: String(item.grade?.instructor_note?.text ?? ''),
    is_finalized: finalized,
    completed_at: item.submission?.committedAt || null,
  };
}

/**
 * Every published lesson for the student's current offering, one row each.
 *
 * @returns {Promise<Array>} sorted by lesson number then deadline, each:
 *   { id, offeringId, title, description, lesson_number, objectives, points,
 *     preflight, interaction,        // the two activities; either may be null
 *     due, isPast, isExtended,
 *     draft,                         // { answers } | null
 *     completion,                    // { path, points, is_finalized } | null — shape preserved
 *     state, dot, writtenAnswerCount,
 *     canChoose, hasInteraction }
 */
export async function loadLessonStatuses(ctx) {
  const items = await loadAssignmentStatuses(ctx);
  const backups = await loadBackupBuilds();

  const rows = items.map(item => {
    const written = item.written;
    const interactive = item.interactive;
    const state = resolveState(item);
    const savedAnswers = written ? (item.submission?.activities?.[written.id]?.content || null) : null;

    // May the student LAUNCH the interactive right now? The DB field `available_after` gates it
    // (`submit` unlocks once written is committed; `due` unlocks after the deadline), and after
    // the deadline everything opens as study mode regardless — which is the "…or the assignment
    // has passed the due date" half of the rule. An invisible activity never opens.
    // An interaction with no usable URL is never available, whatever the schedule says. Since
    // 2026-07-30 the editor lets a Free-Response lesson attach its interaction and add the address
    // later in the term, so this is an ordinary mid-term state rather than a broken row — and
    // without this check the student got a live Launch button that opened nothing.
    const interactiveVisible = !!interactive && interactive.isVisible !== false;
    const interactiveAvailable = interactiveVisible && isArtifactLaunchable(interactive) &&
      (isActivityAvailable(interactive, { submission: item.submission, isPast: item.isPast })
       || item.isPast);
    const interactiveGraded = interactive?.gradingRole === 'graded';

    // WHERE THE BACKUP LINK POINTS, or null when there is nothing to point at. Gated on
    // `interactiveAvailable` ITSELF rather than on a re-statement of it: the backup is the same
    // lesson by another transport, so a cadet who may not launch one must not be handed the
    // other, and reusing the one boolean is what makes that true by construction instead of by
    // two rules staying in step.
    //
    // `null` is the ordinary answer, not a fault — a lesson never published on claude.ai has
    // nothing to back up, and an unreadable manifest lands here as well (see loadBackupBuilds).
    //
    // `go=1` tells the router to resolve the slug and go, skipping its explainer page. That page
    // exists for a cadet arriving from a FAILED Claude artifact, who has been given no context at
    // all; a cadet clicking the Gemini button on the lesson page has just read that context beside
    // the button, so making them read it again and click a second time is a toll, not a warning.
    // The route still goes THROUGH the router: which build a slug resolves to is allowed to
    // change, and only the router is allowed to know it (see the header above).
    const backupHref = (interactiveAvailable && interactive?.slug && backups[interactive.slug])
      ? `${BACKUP_ROUTER}?i=${encodeURIComponent(interactive.slug)}&go=1`
      : null;

    // WHICH PATHS CARRY CREDIT — the question every renderer below actually needs, and the one
    // `interactiveGraded` alone cannot answer. "The interactive is graded" is true both when the
    // student may choose and when the interactive is the ONLY way to earn the points; reading it
    // as "choice" offered an interaction-only lesson the written path it had just taken away.
    const writtenGraded = written?.gradingRole === 'graded';
    const policy = policyOf(item);   // 'choice' | 'interaction' | 'preflight'

    const committed = item.submission?.status === 'committed';
    // WHICH path the student actually committed to, or null while still open. The renderers used
    // STATE.COMPLETE as a stand-in for "committed to the interactive", which is not the same fact:
    // migration 015 finalizes an interactive grade the moment it commits, so resolveState()
    // returns GRADED and COMPLETE is reached only when the interactive submission did NOT grade
    // (no `#d=` payload). That made the stand-in fire in exactly the wrong half of the cases.
    const committedModality = committed ? (item.chosenActivity?.modality || null) : null;

    const completion = deriveCompletion(item);

    return {
      id: item.offeringId,
      offeringId: item.offeringId,
      title: item.title,
      description: item.description,
      lesson_number: item.position ?? null,
      objectives: item.objectives,
      points: item.pointsPossible,

      // The two paths, under the names the page already uses.
      preflight: written ? {
        id: written.id, title: written.title,
        questions: questionsOf(written),
        reading_link: written.content?.reading_link || null,
        gradingRole: written.gradingRole,
      } : null,
      interaction: interactive ? {
        id: interactive.id, slug: interactive.slug, title: interactive.title,
        description: interactive.content?.description || null,
        artifact_url: interactive.content?.artifact_url || null,
        gradingRole: interactive.gradingRole,
        availableAfter: interactive.availableAfter,
      } : null,

      // Whether the interactive path can be launched now, whether it carries a grade, and — when
      // it cannot be launched yet — the reason to show in its place. Computed here so the page
      // never re-derives the availability rule (STUDENT-LESSON-VIEW §4).
      interactiveAvailable,
      backupHref,
      interactiveGraded,
      writtenGraded,
      policy,
      // Whether the page may offer the written path at all — derived here, never in a renderer
      // (STUDENT-LESSON-VIEW §4, the same reason interactiveAvailable is computed here).
      showWrittenPath: writtenPathCounts({
        hasWritten: !!written, writtenGraded, interactiveGraded, committedModality,
      }),
      // Both paths carry credit, but the interactive is the one the lesson expects: the written
      // route is offered underneath it and only with an instructor's permission. Derived HERE for
      // the same reason as showWrittenPath — a renderer that re-derives it is a renderer that can
      // disagree with the one above about which lesson it is looking at.
      writtenByPermission: isWrittenByPermission(item),
      committedModality,
      interactiveGateReason: interactiveAvailable ? null : interactiveGate(interactive),

      due: item.due, isPast: item.isPast, isExtended: item.dueSource === 'extension',
      draft: savedAnswers ? { answers: savedAnswers } : null,
      completion,
      state, dot: STATE_DOT[state],
      writtenAnswerCount: answeredCount(savedAnswers, questionsOf(written)),

      // A choice is only real while BOTH paths are graded this term and the lesson is still
      // open and uncommitted. `isChoice` is derived from offering_activities, not declared —
      // there is no completion_policy column to drift out of step with reality.
      canChoose: item.isChoice && !!written && !!interactive && !item.isPast && !committed,
      hasInteraction: !!interactive,
      // Kept for renderers that showed the policy; derived, not stored. Was
      // `isChoice ? 'choice' : 'preflight'`, which called an interaction-only lesson a preflight.
      completion_policy: policy,
    };
  });

  // Position is optional; fall back to the deadline so ordering is always stable.
  rows.sort((a, b) => {
    const an = a.lesson_number, bn = b.lesson_number;
    if (an != null && bn != null && an !== bn) return an - bn;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity);
  });
  // Carried through the projection: .map() built a new array, so the count of lessons the
  // release window withheld would be lost here otherwise, and the list could not say that
  // later ones exist. See loadAssignmentStatuses().
  rows.lockedCount = items.lockedCount || 0;
  return rows;
}

/** One view-model for the student dashboard (STUDENT-LESSON-VIEW §8). */
export async function loadStudentLessonDashboard(ctx) {
  if (!ctx.currentOffering) return { noCourse: true };

  const lessons = await loadLessonStatuses(ctx);

  const toDo   = lessons.filter(l => l.state === STATE.NOT_STARTED || l.state === STATE.DRAFT);
  const missed = lessons.filter(l => l.state === STATE.MISSED);
  const graded = lessons.filter(l => l.state === STATE.GRADED);
  const done   = lessons.filter(l => l.completion);

  // Points earned out of points available — NOT a correctness percentage. A lesson is worth
  // its offering's points_possible; showing a percentage of per-question scores here would
  // tell cadets they're graded on getting it right, which is the one thing the choice UI must
  // not imply (STUDENT-LESSON-VIEW §2, §8).
  const earned    = done.reduce((s, l) => s + (l.completion.points || 0), 0);
  const available = lessons.reduce((s, l) => s + (l.points ?? 2), 0);

  return {
    noCourse: false,
    stats: { toDo: toDo.length, missed: missed.length, graded: graded.length, earned, available },
    lessons, toDo, missed, graded,
    upNext: toDo.slice(0, 6),
    // How many lessons the release window is holding back. Note what this does to `available`
    // above: the points denominator is now "out of what has been released to you so far"
    // rather than "out of the whole term", which is the more useful of the two readings —
    // 4/6 in week two says something a cadet can act on, 4/82 does not.
    lockedCount: lessons.lockedCount || 0,
  };
}
