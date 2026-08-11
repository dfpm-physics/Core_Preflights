// faculty-lessons.js — data layer for the faculty Lesson builder, against schema `app`.
//
// WHAT MOVED
//   lessons (own table)          ->  gone. A "lesson" IS an assignment offering.
//   lessons.preflight_id         ->  activities(modality='written')   of the same assignment
//   lessons.interaction_id       ->  activities(modality='interactive') of the same assignment
//   assignments.questions        ->  activities.content.questions
//   interactions.artifact_url    ->  activities.content.artifact_url
//   lessons.completion_policy    ->  DERIVED from offering_activities.grading_role
//   due_date_m / due_date_t      ->  assignment_offerings.due_at + assignment_due_dates(section)
//   *.is_published (3 places)    ->  assignment_offerings.is_published (one place, per term)
//   scores(student, assignment)  ->  grades(enrollment, assignment_offering)
//
// ── THE THREE THINGS A DIRECTOR WILL NOTICE ─────────────────────────────────────────
//
// 1. A LESSON IS NO LONGER ASSEMBLED FROM TWO INDEPENDENT PIECES.
//    The old page let you drag ANY orphan preflight together with ANY orphan interaction and
//    staple them into a lesson. In v2 the written question set and the interactive artifact are
//    both `activities` OF ONE `assignments` container — they are what is inside it, not two
//    rows a third row points at. So composing means picking a CONTAINER (which brings its
//    activities with it) and scheduling it into this term. The old cross-pairing is not
//    expressible, and deliberately so: it was the reconciliation layer the v2 model removes.
//
// 2. "ALLOWED MODE" IS DERIVED, NEVER STORED.
//    There is no completion_policy column. Two graded activities in the offering means the
//    student chooses; exactly one means it is required. This module translates the three
//    familiar labels to and from `offering_activities.grading_role` so the UI is unchanged:
//      preflight   -> written graded,     interactive practice (if attached)
//      interaction -> interactive graded, written practice     (if attached)
//      choice      -> both graded
//
// 3. SETTING A COMPONENT TO "NONE" NO LONGER DELETES IT.
//    It removes the offering_activity row — the activity stays in the library and can be
//    re-attached to this same term's run. Publish state moved with it: activities have no
//    is_published, so unpublishing a lesson no longer reaches into shared content. That whole
//    class of "a lesson silently unpublished a standalone assignment" bug is gone with the columns.
//
// 4. SCHEDULING A CONTAINER ANOTHER TERM RUNS COPIES IT (2026-07-28).
//    Cross-term REUSE is over; cross-term COPY replaces it. Two runs of a course each get their
//    own `assignments` row and their own `activities`, because sharing one meant editing a lesson
//    in one term rewrote it in the other and deleting it in one deleted the other's student
//    reports. The interaction does not come along — its slug is the frozen `#i=` surface and
//    belongs to the term whose artifact posts to it. See saveLesson() step 1 and
//    docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md.
//
// SAFETY NOTE ON DELETES. `submissions` and `grades` hang off the OFFERING with ON DELETE
// CASCADE, so removing a scheduled lesson destroys this term's student work — which the old
// "delete container only" did NOT. countLessonWork() exists so the page can state the number
// before the director commits, never after.

import { db } from './supabase.js';
import {
  OFFERING_SELECT, shapeOffering, questionsOf, lessonNumber, chunked, policyOf,
} from './schema.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Derived policy  <->  offering_activities.grading_role
 * ════════════════════════════════════════════════════════════════════════════ */

// policyOf() moved to schema.js so the STUDENT surfaces read the label back the same way this
// editor writes it. Re-exported here because this module is where the pairing with roleFor()
// belongs, and callers (and site/faculty/lessons.html) already name this file for both.
export { policyOf };

/** grading_role for one modality under a chosen policy. */
export function roleFor(policy, modality) {
  if (policy === 'choice') return 'graded';
  if (policy === 'interaction') return modality === 'interactive' ? 'graded' : 'practice';
  return modality === 'written' ? 'graded' : 'practice';   // 'preflight'
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Slugs
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Eight random lowercase hex characters — the per-offering suffix of contract §3.2.
 *
 * `crypto.getRandomValues` in every browser and in Node 19+; the arithmetic fallback exists so a
 * module imported under an older runtime still mints a slug rather than throwing. Uniqueness is
 * enforced by the database either way (`activities.slug` is UNIQUE), so the fallback's weaker
 * randomness costs a retry at worst, never a collision that lands.
 */
function slugSuffix() {
  const buf = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mint the slug for a written activity: course code, assignment slug, and a random suffix.
 *
 * `activities.slug` is globally unique, so it cannot just be the assignment slug — phys-110 and
 * phys-215 both have a `preflight-02`. It also cannot be DETERMINISTIC, which is what this used
 * to be (`phys-215-preflight-02-written`, the namespacing the migration used).
 *
 * ── WHY THE SUFFIX (2026-07-28) ──────────────────────────────────────────────────────────────
 * A deterministic mint means two runs of the same course cannot each hold their own copy of
 * `preflight-02` — the second copy's slug collides with the first, so the only expressible
 * arrangement was ONE activity row shared by both terms. That sharing is what let a director
 * editing one term rewrite another's content, and put 8 student reports one confirm-click from
 * deletion. Per-offering content needs per-offering slugs, so the mint is now random.
 * See docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md.
 *
 * Safe to change because nothing reconstructs this string: no page renders a written activity
 * slug, `lesson_aggregate.py` reads it back off its own query, and the one place that ever
 * rebuilt it (`scripts/app_migration/migrate_public_to_app.py`) is a one-time migration already
 * run. The readable stem is kept so the slug stays greppable.
 */
export const mintWrittenSlug = (courseCode, assignmentSlug) =>
  `${courseCode || 'course'}-${assignmentSlug}-written-${slugSuffix()}`;

/**
 * An interactive activity's slug is the OPPOSITE case: it is the FROZEN contract surface.
 * Deployed Claude artifacts post to `interaction-submit.html#i=<slug>`, so the director types
 * it, it must match the artifact, and it is never regenerated or renamed once shipped.
 */
export const isValidSlug = (s) => /^[a-z0-9-]+$/.test(String(s || '').trim());

/**
 * Does the interaction slug already have an authoritative value, so the editor's
 * lesson-id → interaction-slug mirror must start DISARMED?
 *
 * The mirror ("one slug serves both") is a convenience for authoring a lesson with no built
 * artifact behind it. It has to switch off the instant the slug is a real one, because the two
 * fields pull in opposite directions: the interaction slug is the frozen `#i=` surface above,
 * while the assignment id beside it is a container name the director is *meant* to make readable.
 * Renaming `phys310-radioactivity-77500fd7` to `lesson-04` is the intended use of that field.
 *
 * The artifact's slug reaches a prefill by two routes — `iid` on a hand-built link, and `id` on
 * the Artifacts page's own registration link, since `prefillLink()` emits `['id', slug]`. This
 * lived in `lessons.html` testing only `iid`, so on the sanctioned registration path the mirror
 * stayed armed over an artifact-supplied slug and the rename silently rewrote it. That is how
 * phys-310 lesson 4 came to carry `lesson-04` as its interaction slug, which no artifact posts.
 *
 * It is here rather than in the page for the reason given above `pinnedQuestion()`: page-resident
 * logic that decides a contract surface is unreachable by every test, and this one is load-bearing
 * enough that "it looked right" is not a standard worth relying on twice.
 *
 * @param {{editingId?: any, prefill?: any, interactiveSlug?: string}} o
 */
export const interactionSlugIsPinned = ({ editingId, prefill, interactiveSlug }) =>
  !!editingId || !!(prefill && interactiveSlug);

/* ══════════════════════════════════════════════════════════════════════════════
 * Question roles — which questions are the pinned two, and what "absent" means
 *
 * WHY THIS IS HERE AND NOT IN THE PAGE
 *   It was in the page, and it shipped a bug the director hit within minutes of standing up a new
 *   course: authoring a fresh lesson produced ONE question carrying the reflection's text and the
 *   reading-time role, reported as "the reading reflection is showing up in Q1". Nothing could
 *   have caught it — the logic lived inside a 1500-line HTML file where no test can import it.
 *   The rule below now decides what the ROLLUP will later conclude about a lesson, which makes it
 *   too load-bearing to leave unreachable. Same lesson as `hold-button.js`, same week.
 *
 * THE RULE, and it is deliberately the same one `pinnedQuestion()` in schema.js applies, because
 * the editor must agree with what the aggregator will decide about the lesson it just saved:
 *
 *   The list DECLARES roles (any question carries one) → roles are the whole answer.
 *   The list declares nothing (every Fall 2026 lesson) → bridge: prompt text, then position.
 * ════════════════════════════════════════════════════════════════════════════ */

export const PINNED_ROLES = ['reading_time', 'reading_reflection'];
/** Ordinary questions carry this, so that a list with NEITHER pinned question still reads as
 *  declared rather than as legacy content the resolvers should guess about. */
export const FREE_RESPONSE_ROLE = 'free_response';

const PINNED_NEEDLE = {
  reading_time: 'how much time did you spend reading',
  reading_reflection: 'confusing or most interesting',
};
const PINNED_FALLBACK_ID = { reading_time: 'q1', reading_reflection: 'q2' };

/** Sort key: reading time first, reflection second, everything else after, stably. */
export const roleRank = (q) =>
  q?.role === 'reading_time' ? 0 : q?.role === 'reading_reflection' ? 1 : 2;

export const declaresRoles = (questions) =>
  (questions || []).some(q => q && typeof q.role === 'string' && q.role);

/**
 * Which question object IS each pinned role, for a given list.
 *
 * THE PASSES GO BY SIGNAL STRENGTH ACROSS BOTH ROLES, NOT ROLE BY ROLE, and that ordering is the
 * whole fix. Resolving one role completely before starting the other lets a WEAK signal for the
 * first role claim a question that a STRONG signal for the second role was going to match — which
 * is exactly the reported bug. A lesson holding only a reading reflection has it at `q1`;
 * `PINNED_FALLBACK_ID.reading_time` is also `q1`; so a role-at-a-time loop hands the reflection to
 * reading_time on a positional guess, and the reflection's own prompt text — an exact match, the
 * strongest signal available — never gets to speak. One question, reflection text, reading-time
 * role: "the reading reflection is showing up in Q1".
 *
 * So: every explicit role first, then every prompt-text match, then positions for whatever is
 * still unresolved. `claimed` enforces the other half — one question answers for one role.
 *
 * @returns {{reading_time?: object, reading_reflection?: object}}
 */
export function resolvePinnedQuestions(questions) {
  const qs = (questions || []).filter(q => q && typeof q === 'object');
  const claimed = new Set(), out = {};
  const take = (role, q) => { if (q) { out[role] = q; claimed.add(q); } };
  const free = (q) => !claimed.has(q);
  const unresolved = () => PINNED_ROLES.filter(r => !out[r]);

  // 1. Declared roles. Always, and on their own once anything declares one.
  for (const role of PINNED_ROLES) take(role, qs.find(q => q.role === role && free(q)));
  if (declaresRoles(qs)) return out;

  // 2. The prompt text, for legacy content. Anchored to prompts a builder pins verbatim.
  for (const role of unresolved()) {
    const needle = PINNED_NEEDLE[role];
    take(role, qs.find(q => free(q) && String(q.text || '').toLowerCase().includes(needle)));
  }
  // 3. Position, last and weakest — the first thing an edit changes.
  for (const role of unresolved()) {
    take(role, qs.find(q => free(q) && q.id === PINNED_FALLBACK_ID[role]));
  }
  return out;
}

/** Which pinned roles a list already has — the editor's two toggles, derived from content. */
export function pinnedPresence(questions) {
  const found = resolvePinnedQuestions(questions);
  return { reading_time: !!found.reading_time, reading_reflection: !!found.reading_reflection };
}

/** Stamp the resolved pinned roles onto the questions themselves. Mutates, returns the list. */
export function adoptPinnedRoles(questions) {
  const found = resolvePinnedQuestions(questions);
  for (const [role, q] of Object.entries(found)) q.role = role;
  return questions;
}

/** Every un-roled question becomes an explicit free response. See FREE_RESPONSE_ROLE. */
export function stampRoles(questions) {
  (questions || []).forEach(q => { if (q && !q.role) q.role = FREE_RESPONSE_ROLE; });
  return questions;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Loading
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the Lessons page renders: what is SCHEDULED in ctx.currentOffering, and the sections
 * whose deadlines the editor sets.
 *
 * ── THE SECOND LIST IS GONE (2026-07-28) ─────────────────────────────────────────────────────
 * This also returned a `library` — every assignment of the course not scheduled in THIS offering,
 * which the page rendered as a strip of pickable cards. It was the last survivor of the old
 * "orphan" model, where a lesson was assembled from loose preflight and interaction rows, and it
 * had stopped telling the truth: after each term got its own copy of its content, every OTHER
 * term's containers showed up in that strip, labelled as unscheduled material to pick from. They
 * are not unscheduled — they belong to a different run of the course.
 *
 * Removing the list removes the query. Assignments are now authored for the term they are in
 * (the editor, or scripts/fall2026/), which is what per-offering content isolation already made
 * true underneath. saveLesson() still refuses to SHARE a container across offerings if some
 * future caller hands it one — see its step 1; that is a data-layer guarantee, not a UI feature.
 *
 * Directors see drafts; instructors see only published offerings (RLS already enforces the
 * read side — the filter narrows the query, it does not secure it).
 *
 * @returns {{ noCourse?, isDirector, lessons:[], meetingDays:[], sections:[] }}
 */
export async function loadManager(ctx) {
  const empty = { noCourse: true, isDirector: false, lessons: [], meetingDays: [], sections: [] };
  if (!ctx.currentOffering || !ctx.currentCourse) return empty;
  const isDirector = ctx.isDirectorForCurrent();

  let offeringQ = db.from('assignment_offerings')
    .select(OFFERING_SELECT)
    .eq('course_offering_id', ctx.currentOffering)
    .order('position', { ascending: true, nullsFirst: false });
  if (!isDirector) offeringQ = offeringQ.eq('is_published', true);

  const [{ data: offeringRows }, { data: sectionRows }] = await Promise.all([
    offeringQ,
    db.from('sections')
      .select('id,code,meeting_days,period')
      .eq('course_offering_id', ctx.currentOffering).order('code'),
  ]);

  const lessons = (offeringRows || [])
    .map(shapeOffering)
    .filter(Boolean)
    .map(o => ({
      ...o,
      policy: policyOf(o),
      lessonNumber: o.position ?? lessonNumber(o.slug, o.title),
      questionCount: questionsOf(o.written).length,
    }))
    .sort((a, b) => (a.lessonNumber ?? 1e9) - (b.lessonNumber ?? 1e9)
                 || String(a.slug || '').localeCompare(String(b.slug || '')));

  const sections = sectionRows || [];
  // The distinct meeting-day letters actually present in this offering. The old page hardcoded
  // M and T; the pattern is data on the section now, so the due-date UI is generated from it
  // and a course meeting W/F needs no code change.
  const meetingDays = [...new Set(sections.flatMap(s => s.meeting_days || []))].sort();

  return { noCourse: false, isDirector, lessons, sections, meetingDays };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Due dates — per meeting-day, materialized per section
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * An editor due value -> the UTC ISO timestamp the DB stores.
 *
 * ── WHAT THE EDITOR SENDS ────────────────────────────────────────────────────────────────
 * 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM', both in the DIRECTOR'S LOCAL time. The time half is new
 * (2026-07-27, faculty beta): the field was a bare date and the hour was hardcoded, which is fine
 * as a default and wrong as the only option — a preflight due before an 0750 class had no way to
 * say so. A bare date still means 2359, so every stored deadline and every prefill link
 * (`due_m=`/`due_t=`, a FROZEN contract — docs/contracts/INTERACTION-PREFILL-LINK.md) keeps
 * meaning exactly what it meant.
 *
 * ── AND WHY IT IS CONVERTED HERE RATHER THAN PASSED THROUGH ──────────────────────────────
 * This used to return the naive string unchanged: `'2026-08-24' -> '2026-08-24T23:59:59'`.
 * PostgREST hands that to a `timestamptz` column, and Postgres resolves a literal with no offset
 * using the SESSION time zone — UTC on Supabase. So "due 2359" was stored as 23:59 UTC and
 * enforced at 1659 in Denver: every lesson whose deadline was set in this editor was silently due
 * six hours early, and the students who lost the evening had no way to see why.
 *
 * (Fall 2026 is not affected. Those deadlines came from `scripts/fall2026/build_fall_preflights.py`,
 * which does the zoneinfo conversion CORE.md §2 requires. This was only ever the editor's path.)
 *
 * `new Date('YYYY-MM-DDTHH:MM:SS')` — no offset, with a time — is parsed as LOCAL by every engine,
 * so one Date round-trip is the whole conversion. It is the browser's zone rather than the
 * course's, which is the same trade the extension modal already makes (grade.html saveExt) and
 * right for the case that matters: a director scheduling from their desk in Colorado.
 *
 * Seconds are pinned to :59 — a deadline is inclusive of its minute, and :00 would make the last
 * 59 seconds of it late.
 */
const endOfDay = (d) => {
  if (!d) return null;
  const s = String(d);
  const local = s.length <= 10 ? `${s}T23:59:59` : `${s.slice(0, 16)}:59`;
  const at = new Date(local);
  return isNaN(at) ? null : at.toISOString();
};

/**
 * An editor OPEN value -> the UTC ISO timestamp `assignment_offerings.opens_at` stores.
 *
 * The same local-time conversion endOfDay() does, and deliberately NOT the same rounding. A
 * deadline is inclusive of its minute, so it pins to :59; a release date is the instant access
 * BEGINS, so it pins to :00 — and a bare date means the start of that day rather than the end
 * of it. Sharing one helper would have made "opens 5 Aug" mean 2359 on the 5th, which is a day
 * of access quietly lost.
 */
export function openAtFrom(v) {
  if (!v) return null;
  const s = String(v);
  const local = s.length <= 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`;
  const at = new Date(local);
  return isNaN(at) ? null : at.toISOString();
}

/**
 * The inverse, for loading a stored deadline back into the editor: UTC ISO -> local
 * 'YYYY-MM-DDTHH:MM'. Built from the local getters rather than from the string, because the
 * string is UTC and slicing it would put a Denver evening deadline on the following day —
 * which is what the date-only editor did, visibly, before the time box existed.
 */
export function toEditorDue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Turn the editor's per-day map ({M:'2026-08-24', T:'2026-08-25'}) into one
 * assignment_due_dates row per section, using each section's own meeting_days.
 *
 * This is the generalization of due_date_m / due_date_t. The old pair inferred the day by
 * sniffing the FIRST CHARACTER of a section code ('M1A' -> M-day), which broke the moment a
 * course met on any other pattern. Now the pattern is a column and the override is a row.
 */
export function dueRowsFor(offeringId, dueByDay, sections) {
  const rows = [];
  (sections || []).forEach(sec => {
    // First meeting day with a date wins; a section meeting M/W/F takes the M date.
    const day = (sec.meeting_days || []).find(d => dueByDay?.[d]);
    if (!day) return;
    rows.push({ assignment_offering_id: offeringId, section_id: sec.id, due_at: endOfDay(dueByDay[day]) });
  });
  return rows;
}

/**
 * The offering's DEFAULT deadline: the earliest per-day value, so nobody's default is late.
 *
 * Sorted as strings, which is exact for both accepted shapes: 'YYYY-MM-DD' and
 * 'YYYY-MM-DDTHH:MM' are both lexicographically ordered by time. Mixing them is ordered too —
 * '2026-08-24' sorts before '2026-08-24T08:00', and a bare date means 2359, so a date-only entry
 * would in fact be the LATER of the two. Resolve to full timestamps before comparing.
 */
export function defaultDueFrom(dueByDay) {
  const all = Object.values(dueByDay || {}).filter(Boolean).map(endOfDay).sort();
  return all.length ? all[0] : null;
}

/**
 * The editor's per-day map as the `due_by_day` column wants it: real day letters only, each a
 * full timestamp.
 *
 * `_all` is dropped deliberately. The editor invents that key when the offering's sections declare
 * no meeting days at all, to render a single plain date box — it is a UI placeholder, not a day,
 * and storing it would create a key no section's `meeting_days` can ever match. `due_at` already
 * carries that case, which is exactly what level 4 of the precedence is for.
 */
export function dueByDayRow(dueByDay) {
  const out = {};
  Object.entries(dueByDay || {}).forEach(([day, date]) => {
    if (!date || day === '_all') return;
    out[day] = endOfDay(date);
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Retroactive grade correction
 * ════════════════════════════════════════════════════════════════════════════ */

const pointsOf = (q) => (isNaN(Number(q?.points)) ? 0 : Number(q.points));

/** True iff a question that ALREADY existed changed its point value. Added/removed questions
 *  don't qualify — they have no graded rows to correct. */
export function pointsChanged(oldQs, newQs) {
  return (newQs || []).some(q => {
    const old = (oldQs || []).find(oq => oq.id === q.id);
    return old && pointsOf(old) !== pointsOf(q);
  });
}

/**
 * Propagate changed question points onto every existing grade for an offering.
 *
 * Without this, editing a question's value on an already-graded lesson leaves each row stale:
 * `question_scores[q].max` keeps the OLD number and the total no longer agrees with the
 * questions — students see wrong totals and the export ships them.
 *
 * ONE V2 DIFFERENCE THAT MATTERS: the ceiling is no longer the sum of the question points, it
 * is `assignment_offerings.points_possible`, and `grades_within_bounds` is a CHECK. So the
 * recomputed total is clamped to the offering's value — the write is rejected outright
 * otherwise, which is the constraint doing the job the old code had to remember to do.
 *
 * Preserves the 3-state status: `zero` stays 0, `full`/`warn` take the new value (warn is full
 * credit with a flag). Questions absent from a row are left alone — they were never graded.
 *
 * @returns {number} rows rewritten (0 if none existed or the write failed).
 */
export async function retroactivelyUpdateGrades(offeringId, questions, pointsPossible) {
  const qs_ = questions || [];
  const { data: grades, error } = await db.from('grades')
    .select('id, enrollment_id, question_scores, is_finalized, points_possible')
    .eq('assignment_offering_id', offeringId);
  if (error || !grades?.length) return 0;

  const possible = Number(pointsPossible ?? 0);
  const rows = grades.map(row => {
    const qs = { ...(row.question_scores || {}) };
    qs_.forEach(q => {
      if (!qs[q.id]) return;                       // never graded — nothing to correct
      const status = qs[q.id].status || (Number(qs[q.id].score) > 0 ? 'full' : 'zero');
      qs[q.id] = { ...qs[q.id], max: pointsOf(q), score: status === 'zero' ? 0 : pointsOf(q) };
    });
    const total = qs_.reduce((s, q) => s + (Number(qs[q.id]?.score) || 0), 0);
    return {
      enrollment_id: row.enrollment_id,
      assignment_offering_id: offeringId,
      question_scores: qs,
      points_earned: Math.min(Math.round(total * 1000) / 1000, possible),
      points_possible: possible,
      is_finalized: row.is_finalized,
    };
  });

  const { error: upErr } = await db.from('grades')
    .upsert(rows, { onConflict: 'enrollment_id,assignment_offering_id' });
  return upErr ? 0 : rows.length;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Saving
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Which OFFERINGS schedule this container, other than the one being saved into.
 *
 * A non-empty answer means saveLesson() must COPY rather than attach (step 1). No UI path reaches
 * that branch any more — the library picker that did was removed 2026-07-28 — so this is what
 * keeps the guarantee true for whatever calls saveLesson() next, not a live flow.
 *
 * Same RLS limit as otherOfferingsUsing(): `ao_read_staff` scopes `assignment_offerings` to
 * offerings the caller staffs, so a term run entirely by somebody else is invisible here and the
 * copy does not trigger. That fails to the OLD behaviour — shared content — rather than to a wrong
 * write, and `supabase/admin/content_isolation_check.py` reports any sharing that survives, from
 * the operator tier, which is not subject to RLS.
 *
 * @returns {Array<{offeringId, courseOfferingId, label}>}
 */
export async function offeringsUsingAssignment(assignmentId, exceptCourseOfferingId) {
  if (!assignmentId) return [];
  const { data } = await db.from('assignment_offerings')
    .select('id, course_offering_id, course_offerings(courses(code), terms(label))')
    .eq('assignment_id', assignmentId);
  return (data || [])
    .filter(r => r.course_offering_id !== exceptCourseOfferingId)
    .map(r => {
      const co = r.course_offerings;
      return {
        offeringId: r.id,
        courseOfferingId: r.course_offering_id,
        label: [co?.courses?.code, co?.terms?.label].filter(Boolean).join(' · ') || 'another term',
      };
    });
}

/** The term code of an offering ('fall-2026'), used to qualify a copied container's slug. */
async function termCodeOf(courseOfferingId) {
  if (!courseOfferingId) return null;
  const { data } = await db.from('course_offerings')
    .select('terms(code)').eq('id', courseOfferingId).maybeSingle();
  return data?.terms?.code || null;
}

/**
 * A slug the copied container can actually take, given `assignments_slug_unique (course_id, slug)`.
 *
 * The clean slug when it is free; otherwise the term qualifies it (`preflight-02-spring-2027`),
 * which is both unique and the thing a human would have written by hand. A random tail is the
 * last resort, for a term that has already been copied into once.
 *
 * ── WHY QUALIFY RATHER THAN DROP THE CONSTRAINT ──────────────────────────────────────────────
 * Dropping `assignments_slug_unique` is the cleaner end state and is recommended in
 * docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md §6 — but it is DDL, and DDL on `app` is sealed
 * behind a human unsealing `prep_app_owner` (CORE.md §0). Qualifying the slug needs none of that,
 * so per-offering content works today and the constraint can be dropped at the next unseal
 * without any of this changing meaning. Unlike `activities.slug`, this one is read by humans —
 * `/preflight-analyze phys-215 preflight-02 M` — so it keeps a readable shape rather than a uuid.
 */
async function freeAssignmentSlug(courseId, base, courseOfferingId) {
  const { data, error } = await db.from('assignments').select('slug').eq('course_id', courseId);
  if (error) return { error };
  const taken = new Set((data || []).map(r => r.slug));
  if (!taken.has(base)) return { slug: base };

  const term = await termCodeOf(courseOfferingId);
  const qualified = `${base}-${term || 'copy'}`;
  if (!taken.has(qualified)) return { slug: qualified };

  let candidate = `${qualified}-${slugSuffix().slice(0, 4)}`;
  while (taken.has(candidate)) candidate = `${qualified}-${slugSuffix().slice(0, 4)}`;
  return { slug: candidate };
}

/** Existing activities of a container, keyed by modality. */
async function activitiesOf(assignmentId) {
  const { data } = await db.from('activities')
    .select('id,slug,modality,title,content,position').eq('assignment_id', assignmentId);
  const out = { written: null, interactive: null };
  (data || []).forEach(a => { out[a.modality] = a; });
  return out;
}

/**
 * Create or update one lesson: container -> activities -> offering -> roles -> deadlines.
 *
 * The order is forced by the foreign keys, and each step is a separate round trip because
 * PostgREST has no transaction across requests. A failure therefore leaves the earlier steps
 * applied — which is survivable precisely because every step is an upsert keyed on something
 * stable, so re-clicking Save converges rather than duplicating.
 *
 * model = {
 *   offeringId, assignmentId, courseId, courseOfferingId, courseCode,
 *   slug, title, description, lessonNumber, objectives[],
 *   policy: 'preflight'|'interaction'|'choice',
 *   pointsPossible, gradingMode, switchPolicy, isPublished,
 *   dueByDay: { M:'YYYY-MM-DD', … }, sections: [{id, meeting_days}],
 *   opensAt: 'YYYY-MM-DDTHH:MM' | null,   // null = the rolling default window

 *   written:     { include, questions[], reference_pdf, reference_pages, reading_link },
 *   interactive: { include, slug, title, artifact_url, description },
 * }
 *
 * @returns {{ error, offeringId, assignmentId, assignmentSlug, rescored, unchosen, copiedFrom }}
 *   rescored — grades rewritten because a question's point value changed (the page must SAY so;
 *              a silent bulk total rewrite is exactly what a director has to be told about).
 *   unchosen — students whose committed choice was cleared because the activity they picked was
 *              detached from the offering (the composite FK is ON DELETE SET NULL).
 *   copiedFrom — set when the container handed in was already running in another term, so this
 *              term got its own copy instead of sharing one: { assignmentId, terms[] }. Nothing in
 *              the page can produce this today; it is reported rather than swallowed so a caller
 *              that does gets told the slug may be term-qualified. See step 1.
 */
export async function saveLesson(ctx, model, editingOfferingId) {
  const out = { error: null, offeringId: editingOfferingId || null, rescored: 0, unchosen: 0,
                copiedFrom: null };
  const courseOfferingId = model.courseOfferingId || ctx.currentOffering;

  /* 1 ── the CONTAINER (assignments). Term-free, reusable, carries no grading policy. */
  let assignmentId = model.assignmentId || null;
  let containerSlug = model.slug;

  /* ── COPY, DON'T SHARE (2026-07-28) ──────────────────────────────────────────────────────
   * Scheduling a container that ANOTHER term already runs used to attach this term to the very
   * same `assignments` row and the very same `activities` rows. Two terms then shared one copy
   * of the content, which is the defect this branch exists to end: a director editing Fall 2026
   * silently rewrote the sandbox's questions, a director swapping an interaction was one confirm
   * from deleting the other term's student reports, and `activities_write` — scoped by COURSE,
   * not by offering — meant a sandbox director could write real-term content at all.
   * See docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md.
   *
   * So this term gets its own copy. Only on SCHEDULING (`editingOfferingId` null): editing a
   * lesson already scheduled here must never copy, because its submissions point at the activity
   * ids it already has and a copy would strand them.
   */
  let copiedFrom = null;
  if (assignmentId && !editingOfferingId) {
    const others = await offeringsUsingAssignment(assignmentId, courseOfferingId);
    if (others.length) {
      const { slug, error } = await freeAssignmentSlug(model.courseId, model.slug, courseOfferingId);
      if (error) return { ...out, error };
      copiedFrom = assignmentId;
      assignmentId = null;          // fall through to the INSERT below — a new container
      containerSlug = slug;
      out.copiedFrom = { assignmentId: copiedFrom, terms: others.map(o => o.label) };
    }
  }

  const container = {
    course_id: model.courseId,
    kind_id: model.kind || 'preflight',
    title: model.title,
    description: model.description ?? null,
    objectives: Array.isArray(model.objectives) ? model.objectives : [],
  };
  if (assignmentId) {
    const { error } = await db.from('assignments').update(container).eq('id', assignmentId);
    if (error) return { ...out, error };
  } else {
    const { data, error } = await db.from('assignments')
      .insert({ ...container, slug: containerSlug }).select('id').single();
    if (error) return { ...out, error };
    assignmentId = data.id;
  }
  out.assignmentId = assignmentId;
  out.assignmentSlug = containerSlug;

  /* An interaction cannot be copied. Its slug is the frozen `#i=` contract surface, globally
   * unique, and it belongs to the term whose deployed artifact posts to it — so the copy needs a
   * REBUILT artifact with a fresh §3.2 slug, not this one. The page drops the interaction from
   * the model when it knows a copy is coming; this catches the paths that don't (a prefill link
   * carrying a slug someone pasted), with a sentence instead of a unique-violation. */
  if (copiedFrom && model.interactive?.include) {
    const { data: clash } = await db.from('activities')
      .select('id').eq('slug', model.interactive.slug).maybeSingle();
    if (clash) return { ...out, error: { message:
      `The interaction id “${model.interactive.slug}” already belongs to another term's copy of ` +
      `this assignment. An artifact posts to one id and one term — rebuild it with a new id ` +
      `(see the interaction data contract §3.2), or save this assignment without the interaction ` +
      `and add it once the new artifact exists.` } };
  }

  /* 2 ── the ACTIVITIES (what is inside the container). */
  const existing = await activitiesOf(assignmentId);
  const wanted = [];      // [{ id, modality }] — everything that should be attached this term

  if (model.written?.include) {
    const content = {
      questions: model.written.questions || [],
      reading_link: model.written.reading_link || null,
      reference_pdf: model.written.reference_pdf || null,
      reference_pages: model.written.reference_pages || null,
    };
    if (existing.written) {
      // Snapshot the stored points BEFORE the overwrite so a change can be detected.
      const prevQs = existing.written.content?.questions || [];
      const { error } = await db.from('activities')
        .update({ title: model.title, content }).eq('id', existing.written.id);
      if (error) return { ...out, error };
      wanted.push({ id: existing.written.id, modality: 'written' });
      if (pointsChanged(prevQs, content.questions) && editingOfferingId) {
        out.rescored = await retroactivelyUpdateGrades(
          editingOfferingId, content.questions, model.pointsPossible);
      }
    } else {
      const { data, error } = await db.from('activities').insert({
        assignment_id: assignmentId,
        modality: 'written',
        slug: mintWrittenSlug(model.courseCode, containerSlug),
        title: model.title,
        content,
        position: 0,
      }).select('id').single();
      if (error) return { ...out, error };
      wanted.push({ id: data.id, modality: 'written' });
    }
  }

  if (model.interactive?.include) {
    const content = {
      artifact_url: model.interactive.artifact_url || null,
      description: model.interactive.description || null,
    };
    if (existing.interactive) {
      // The slug is NEVER rewritten here. It is the frozen `#i=` contract and every student
      // report already posted resolves through it; a swap is an explicit delete + create,
      // handled by replaceInteractive() so the report loss is confirmed first.
      const { error } = await db.from('activities')
        .update({ title: model.interactive.title || model.title, content })
        .eq('id', existing.interactive.id);
      if (error) return { ...out, error };
      wanted.push({ id: existing.interactive.id, modality: 'interactive' });
    } else {
      const { data, error } = await db.from('activities').insert({
        assignment_id: assignmentId,
        modality: 'interactive',
        slug: model.interactive.slug,
        title: model.interactive.title || model.title,
        content,
        position: 1,
      }).select('id').single();
      if (error) return { ...out, error };
      wanted.push({ id: data.id, modality: 'interactive' });
    }
  }

  /* 3 ── the OFFERING (this term's run: points, deadline, publish). */
  const offeringRow = {
    points_possible: Number(model.pointsPossible ?? 2),
    grading_mode: model.gradingMode || 'points',
    switch_policy: model.switchPolicy || 'lock_on_commit',
    due_at: defaultDueFrom(model.dueByDay),
    // The per-day schedule, stored (migration 017). Until this existed, the M/T split lived ONLY
    // in the materialized assignment_due_dates rows, so a section created later had nothing to
    // derive its deadline from and silently took due_at — the M-day date. Persisting it here is
    // what lets a section added after scheduling be correct with no lesson re-save.
    due_by_day: dueByDayRow(model.dueByDay),
    // NULL is not "no answer" here, it is the DEFAULT ANSWER: it selects the rolling window in
    // schema.js (LOOKAHEAD_DAYS before each student's own deadline), which is what the editor's
    // standard option means and what nearly every lesson should carry. A value is the explicit
    // per-lesson override — one fixed instant for every section, which does not follow a due
    // date edited afterwards.
    opens_at: openAtFrom(model.opensAt),
    is_published: !!model.isPublished,
    position: model.lessonNumber == null ? null : model.lessonNumber,
  };
  let offeringId = editingOfferingId || null;
  if (offeringId) {
    const { error } = await db.from('assignment_offerings').update(offeringRow).eq('id', offeringId);
    if (error) return { ...out, error };
  } else {
    const { data, error } = await db.from('assignment_offerings').insert({
      course_offering_id: courseOfferingId,
      assignment_id: assignmentId,
      ...offeringRow,
    }).select('id').single();
    if (error) return { ...out, error };
    offeringId = data.id;
  }
  out.offeringId = offeringId;

  /* 4 ── offering_activities: WHICH activities are live and WHICH carries credit.
   *      Diffed rather than delete-all-then-insert. Deleting a row a student already
   *      committed to nulls their chosen_activity_id through the composite FK, so rows that
   *      are staying must not be churned just to change a role. */
  const { data: currentOA } = await db.from('offering_activities')
    .select('activity_id, grading_role, available_after, is_visible, position')
    .eq('assignment_offering_id', offeringId);

  const wantIds = new Set(wanted.map(w => w.id));
  const stale = (currentOA || []).filter(r => !wantIds.has(r.activity_id));
  if (stale.length) {
    const staleIds = stale.map(r => r.activity_id);
    out.unchosen = await countCommittedTo(offeringId, staleIds);
    // Release them BEFORE the delete. Letting the FK's ON DELETE SET NULL do it looks equivalent
    // and is not: that cascade is an unattributed unlock, which submissions_lock_activity()
    // refuses outright, failing the whole save. See unlockCommittedTo().
    const { error: unlockErr } = await unlockCommittedTo(ctx, offeringId, staleIds);
    if (unlockErr) return { ...out, error: unlockErr };
    const { error } = await db.from('offering_activities').delete()
      .eq('assignment_offering_id', offeringId)
      .in('activity_id', staleIds);
    if (error) return { ...out, error };
  }

  const oaRows = wanted.map((w, i) => ({
    assignment_offering_id: offeringId,
    activity_id: w.id,
    grading_role: roleFor(model.policy, w.modality),
    available_after: model.availableAfter?.[w.modality] || 'always',
    is_visible: true,
    position: i,
  }));
  if (oaRows.length) {
    const { error } = await db.from('offering_activities')
      .upsert(oaRows, { onConflict: 'assignment_offering_id,activity_id' });
    if (error) return { ...out, error };
  }

  /* 5 ── per-section deadlines. No dependents, so a clean replace is safe. */
  const dueRows = dueRowsFor(offeringId, model.dueByDay, model.sections);
  const { error: delErr } = await db.from('assignment_due_dates')
    .delete().eq('assignment_offering_id', offeringId);
  if (delErr) return { ...out, error: delErr };
  if (dueRows.length) {
    const { error } = await db.from('assignment_due_dates')
      .upsert(dueRows, { onConflict: 'assignment_offering_id,section_id' });
    if (error) return { ...out, error };
  }

  return out;
}

/** How many students have COMMITTED to one of these activities — i.e. how many choices
 *  detaching them would silently clear. */
async function countCommittedTo(offeringId, activityIds) {
  if (!activityIds?.length) return 0;
  const { data } = await db.from('submissions')
    .select('id, chosen_activity_id')
    .eq('assignment_offering_id', offeringId)
    .in('chosen_activity_id', activityIds);
  return (data || []).length;
}

/**
 * Release the students committed to activities that are about to be detached or deleted.
 *
 * ── THE BUG THIS FIXES, because "the FK does it for us" was wrong ────────────────────────────
 * `submissions_activity_in_offering` is `ON DELETE SET NULL`, so removing an `offering_activities`
 * row (or the `activities` row above it) makes Postgres NULL out `submissions.chosen_activity_id`
 * by itself. Every caller here was written against that and needed no unlock step.
 *
 * But that cascade is an UPDATE on `submissions`, and `submissions_lock_activity()` fires on it.
 * The trigger sees a committed choice becoming NULL — an unlock — with `unlocked_by` unset, and
 * refuses:  *"submission <id>: an unlock must set unlocked_by so it is attributable"*. The whole
 * statement rolls back. So the moment ONE student had committed, a director could no longer swap
 * a broken interaction or change an assignment's modality, and the error they were shown named an
 * internal trigger and a raw submission uuid.
 *
 * The trigger is right and is not the thing to change (migration 006 hardened it deliberately, and
 * DDL on `app` is sealed — CORE.md §0). What was missing is that these operations ARE unlocks and
 * were never being performed as such. Doing it explicitly, first, satisfies the trigger on its own
 * terms — attributed to the caller, which is exactly who is performing it — and leaves the FK with
 * nothing left to null when the delete lands.
 *
 * `status` goes back to `draft` alongside the cleared choice, matching unlockSubmission() in
 * faculty-grade.js. A submission left `committed` with no chosen activity is a state no reader
 * expects and nothing would ever clear.
 *
 * @returns {{ error, unlocked }} `unlocked` = how many students were released
 */
async function unlockCommittedTo(ctx, offeringId, activityIds) {
  if (!activityIds?.length) return { error: null, unlocked: 0 };
  let q = db.from('submissions')
    .select('id')
    .in('chosen_activity_id', activityIds);
  // Scoped to one offering when the caller has one. replaceInteractive() deliberately does not:
  // it deletes the library ACTIVITY, whose reach is every offering that schedules it.
  if (offeringId) q = q.eq('assignment_offering_id', offeringId);
  const { data: hits, error: readErr } = await q;
  if (readErr) return { error: readErr, unlocked: 0 };
  if (!hits?.length) return { error: null, unlocked: 0 };

  const { error } = await db.from('submissions').update({
    chosen_activity_id: null,
    status: 'draft',
    // MUST be the caller: migration 006 rejects an unlock attributed to anybody else, which is
    // what stops one person's unlock from being recorded against a colleague.
    unlocked_by: ctx.user.id,
    unlocked_at: new Date().toISOString(),
  }).in('id', hits.map(s => s.id));
  return { error: error || null, unlocked: error ? 0 : hits.length };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Publish
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Publish state is now ONE boolean in ONE place, on the offering.
 *
 * The old version mirrored the flag onto the assignment and interaction rows it "owned",
 * with an ownership rule (id === lesson id) invented purely to stop a lesson from
 * unpublishing shared content. Activities have no publish column, so both the mirroring and
 * the ownership rule are gone. Per-activity visibility, if ever needed, is
 * offering_activities.is_visible — a per-term decision, where it belongs.
 */
export function togglePublish(offeringId, isPublished) {
  return db.from('assignment_offerings')
    .update({ is_published: !isPublished }).eq('id', offeringId);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Removal
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Count the student work a removal would destroy.
 *
 * Worth being precise about, because the v2 answer is different from the old one: the old
 * "container only" delete destroyed NOTHING (responses hung off the assignment, which
 * survived). Here submissions and grades hang off the OFFERING, so unscheduling the lesson
 * takes this term's work with it.
 *
 * @returns {{ submissions, grades, reports }} reports = interactive artifacts received
 */
export async function countLessonWork(lesson) {
  const offeringId = lesson?.offeringId;
  if (!offeringId) return { submissions: 0, grades: 0, reports: 0 };

  const [{ data: subs }, { count: gradeCount }] = await Promise.all([
    db.from('submissions').select('id').eq('assignment_offering_id', offeringId),
    db.from('grades').select('*', { count: 'exact', head: true })
      .eq('assignment_offering_id', offeringId),
  ]);

  let reports = 0;
  const interactiveId = lesson.interactive?.id;
  const submissionIds = (subs || []).map(s => s.id);
  if (interactiveId && submissionIds.length) {
    for (const ids of chunked(submissionIds)) {
      const { count } = await db.from('submission_activities')
        .select('*', { count: 'exact', head: true })
        .eq('activity_id', interactiveId).in('submission_id', ids);
      reports += count || 0;
    }
  }
  return { submissions: (subs || []).length, grades: gradeCount || 0, reports };
}

/** Count the reports attached to ONE interactive activity — the swap/replace warning. */
export async function countActivityReports(activityId) {
  if (!activityId) return 0;
  const { count } = await db.from('submission_activities')
    .select('*', { count: 'exact', head: true }).eq('activity_id', activityId);
  return count || 0;
}

/**
 * Unschedule: delete the assignment_offering only.
 *
 * The assignment and its activities survive, belonging to no term — the v2 equivalent of "delete
 * the container, keep the parts". Since the library picker was removed (2026-07-28) nothing
 * schedules them again, so this leaves content no page reads; deleteLessonAndContents() is the
 * one that clears it too. What does NOT survive is this term's submissions and grades, which
 * cascade. countLessonWork() first, always.
 */
export function unscheduleLesson(offeringId) {
  return db.from('assignment_offerings').delete().eq('id', offeringId);
}

/**
 * Delete the lesson AND its library definition (the nuclear "delete all contents").
 *
 * Order is forced: assignment_offerings.assignment_id is ON DELETE RESTRICT, so the offering
 * must go first or the assignment delete is refused. Activities cascade from the assignment,
 * and submission_activities cascade from the activities.
 *
 * Refuses when the container is scheduled in ANOTHER term — deleting shared library content
 * from inside one term's page would silently destroy a different offering's lesson.
 */
export async function deleteLessonAndContents(lesson) {
  const { offeringId, assignmentId } = lesson;
  const { data: others } = await db.from('assignment_offerings')
    .select('id').eq('assignment_id', assignmentId).neq('id', offeringId);
  if (others?.length) {
    return { error: { message:
      `This assignment is also scheduled in ${others.length} other term${others.length === 1 ? '' : 's'}. ` +
      `Remove it from this term instead — deleting the library definition would delete those too.` } };
  }
  let { error } = await db.from('assignment_offerings').delete().eq('id', offeringId);
  if (error) return { error };
  ({ error } = await db.from('assignments').delete().eq('id', assignmentId));
  return { error: error || null };
}

/**
 * Which OTHER offerings schedule this activity — i.e. whose work a delete here would also take.
 *
 * An `activities` row hangs off the library `assignment`, not off one term's offering, so several
 * offerings can schedule the same one. Every caller that deletes an activity has to ask this
 * first; `deleteLessonAndContents()` asks the same question one level up, about the assignment.
 *
 * ONLY SEES WHAT THE CALLER STAFFS. `oa_read_staff` (002_rls.sql) scopes offering_activities to
 * offerings the caller staffs, so an offering run by somebody else comes back invisible and this
 * returns an empty list. That is a real limit and not one this function can close from the
 * browser — but it fails safe rather than silently: if a student in that hidden offering had
 * committed, unlockCommittedTo() cannot reach them either, and the delete is then refused by
 * submissions_lock_activity() with nothing written. replaceInteractive() translates that refusal
 * rather than passing the trigger's wording through.
 */
async function otherOfferingsUsing(activityId, keepOfferingId) {
  const { data } = await db.from('offering_activities')
    .select('assignment_offering_id, ' +
            'assignment_offerings!inner(id, course_offerings(courses(code), terms(label)))')
    .eq('activity_id', activityId);
  return (data || [])
    .filter(r => r.assignment_offering_id !== keepOfferingId)
    .map(r => {
      const co = r.assignment_offerings?.course_offerings;
      return [co?.courses?.code, co?.terms?.label].filter(Boolean).join(' · ') || 'another term';
    });
}

/**
 * Replace an assignment's interactive activity with a different SLUG.
 *
 * UNIQUE(assignment_id, modality) means a container holds at most one interactive activity, so
 * a new slug is not an edit — the old activity must go, and its student reports cascade with
 * it. That is a harder consequence than the old model's ("the old interaction is orphaned, never
 * deleted"), and the reason the page confirms with a real count first.
 *
 * When the slug is UNCHANGED, never call this: saveLesson() updates the URL in place and every
 * report stays attached. That is the safe path and the one to prefer.
 *
 * ── TWO THINGS IT HAS TO DO BEFORE THE DELETE (2026-07-28) ───────────────────────────────────
 * Both were missing, and the first made this function unusable in exactly the situation it exists
 * for — a lesson students had already worked.
 *
 *   1. REFUSE when another offering schedules this activity. The activity belongs to the library
 *      assignment, so the delete reaches every term that scheduled it, silently destroying a
 *      different term's reports from inside this one's editing modal. This mirrors
 *      deleteLessonAndContents(), which has always refused for the same reason. There is no
 *      per-term slug in this model, so the honest answer is to say so rather than to pick a term
 *      to damage.
 *
 *   2. UNLOCK the students committed to it, attributably. Otherwise the FK's ON DELETE SET NULL
 *      performs an unattributed unlock, submissions_lock_activity() refuses it, and the delete
 *      fails with a trigger message naming a raw submission uuid. That is the error a director
 *      hit on a lesson with 8 reports. See unlockCommittedTo().
 *
 * @param {object} ctx
 * @param {string} assignmentId    the library container
 * @param {string} oldActivityId   the interactive activity being replaced
 * @param {string} offeringId      the offering being edited — the ONE whose work may be affected
 * @param {object} next            { slug, title, artifact_url, description }
 */
export async function replaceInteractive(ctx, assignmentId, oldActivityId, offeringId, next) {
  if (oldActivityId) {
    const others = await otherOfferingsUsing(oldActivityId, offeringId);
    if (others.length) {
      const list = [...new Set(others)].join(', ');
      return { error: { message:
        `This interaction is also scheduled in ${list}. Changing its id here would delete it — ` +
        `and every student report attached to it — from that term too, because the interaction ` +
        `belongs to the shared library assignment rather than to one term. Remove it from the ` +
        `other term first, or keep this id and change only the URL.` } };
    }

    const { error: unlockErr } = await unlockCommittedTo(ctx, null, [oldActivityId]);
    if (unlockErr) return { error: unlockErr };

    const { error } = await db.from('activities').delete().eq('id', oldActivityId);
    // Reaching the lock trigger here means a student committed to this activity in an offering
    // the unlock above could not see — see otherOfferingsUsing() on the RLS limit. Nothing was
    // written; say what happened instead of forwarding "an unlock must set unlocked_by", which
    // names a column no director has heard of.
    if (error && /unlocked_by|unlock a committed submission/i.test(error.message || '')) {
      return { error: { message:
        'A student in another term has committed to this interaction, and that term is not one ' +
        'you staff — so it cannot be released from here and nothing was changed. Ask whoever ' +
        'runs that offering to remove the interaction from it first, or keep this id and change ' +
        'only the URL.' } };
    }
    if (error) return { error };
  }
  return db.from('activities').insert({
    assignment_id: assignmentId,
    modality: 'interactive',
    slug: next.slug,
    title: next.title || null,
    content: { artifact_url: next.artifact_url || null, description: next.description || null },
    position: 1,
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Figures — unchanged: Supabase Storage is schema-agnostic
 * ════════════════════════════════════════════════════════════════════════════ */

/** Upload a figure to the PUBLIC `lesson-figures` bucket and return its public URL.
 *  Static-site friendly: the browser posts straight to Storage, never to GitHub Pages, and
 *  the question's `figure_url` then stores the returned public URL. */
const FIGURE_BUCKET = 'lesson-figures';
export async function uploadFigure(file) {
  if (!file || !(file.type || '').startsWith('image/')) return { error: { message: 'Choose an image file.' } };
  if (file.size > 5 * 1024 * 1024) return { error: { message: 'Image must be under 5 MB.' } };
  const ext  = ((file.name || '').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `q/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from(FIGURE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error };
  const { data } = db.storage.from(FIGURE_BUCKET).getPublicUrl(path);
  return { url: data?.publicUrl || null };
}
