// faculty-tasks.js — what is waiting for you, as a registry.  (Roadmap P1.6 + P1.15)
//
// ── WHY A REGISTRY AND NOT FOUR HARD-CODED QUERIES ───────────────────────────────
// The director's own note on P1.6 was that none of these tasks exist yet — so the deliverable
// is the surface and its plumbing, with sources registered as they appear. That framing is the
// whole design: every source is one object in SOURCES with a `load()`, and adding the fifth is
// an entry in an array rather than a rewrite of the dashboard.
//
// The shape each source returns — `{ severity, text, link, count }` — is fixed by P1.6 and is
// the reason the panel can render sources it knows nothing about.
//
// ── ONE BOX PER KIND — EXCEPT GRADING, WHICH IS ONE PER LESSON ───────────────────
// P1.15 said one box per kind, and for most sources that is still right: "2 · Assign instructors"
// is one errand however many sections are behind it.
//
// GRADING IS NOT LIKE THAT, and the faculty beta (2026-07-27) named why. "9 · Review grades" is
// not one errand, it is three lessons' worth of them, and the box could not say which — the Grade
// page took no assignment parameter, so the link landed on an empty picker and the reader had to
// re-derive which lesson the 9 came from. A source may now return an ARRAY, one entry per lesson,
// each deep-linking to `grade.html?a=<offering>`: the box names the lesson, and clicking it opens
// exactly the work it counted.
//
// The cap is what keeps that from becoming the list P1.15 objected to — past MAX_PER_SOURCE
// lessons the entries collapse back into one summary box. In week ten with a term's backlog, six
// named lessons is a worklist and sixteen is wallpaper.
//
// ── ZERO IS THE COMMON STATE, SO ZERO RENDERS NOTHING ────────────────────────────
// Most of these are empty most of the term. A box sitting at `0` trains people to ignore the
// row — the same failure as a dashboard full of green ticks. A source with nothing outstanding
// is omitted entirely, and when every source is empty the panel says so once, cheerfully, in
// one line.
//
// ── SCOPE: WHAT YOU TEACH, NOT WHAT YOU CAN SEE ──────────────────────────────────
// The per-student sources are scoped to the sections the caller personally TEACHES
// (schema.js `actionableSections`), not to ctx.sectionIds.
//
// That distinction was wrong here until 2026-07-23 and the difference is not small. A director's
// staff row carries section_id NULL, which app.staff_sections() expands to EVERY section of the
// offering — so "9 · Review grades" was counting the whole course, including nine other
// instructors' ungraded work, in a panel headed "Needs YOUR attention". A worklist that lists work
// belonging to somebody else is a course status report wearing a worklist's clothes, and the
// number is large enough that people stop reading the row.
//
// Someone who staffs the offering but teaches no section of it still gets the course-wide list —
// otherwise a pure director's panel would be permanently empty, which is a worse lie.
//
// The three director-only sources are unaffected: they ask about the OFFERING (unstaffed sections,
// missing rollups, failed runs), where course-wide is the right and only scope. Their gating is a
// UI convention, exactly like the run banner's — RLS admits any staff member of the offering to
// these tables, so if the convention is not applied here it is not applied at all.
//
// ── FAILURE IS PER-SOURCE ────────────────────────────────────────────────────────
// A source that throws is dropped, not fatal. This panel sits at the top of the dashboard; a
// single failing query must not take the page with it, and a missing box is a far better
// outcome than a dashboard that will not render.

import { db } from './supabase.js';
import { actionableSections } from './schema.js';
import { pastDueUngraded } from './faculty-grade.js';

/** A run still marked 'running' this long after it started did not finish (mirrors run-banner.js). */
const STALE_RUNNING_H = 2;

/** Past this many lessons a per-lesson source collapses to one summary box — see the header. */
export const MAX_PER_SOURCE = 6;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** grade.html deep link for one assignment offering. The page reads `?a=` in populate(). */
const gradeLinkFor = (offeringId) => `grade.html?a=${encodeURIComponent(offeringId)}`;

/**
 * Per-lesson boxes, or one summary box when there are too many to read at a glance.
 *
 * @param {Array} lessons  [{ offeringId, title, count }] — already ordered most-urgent first
 * @param {object} opts    { action, summaryAction, summaryText, textFor }
 */
function perLesson(lessons, { action, summaryAction, summaryText, textFor }) {
  const total = lessons.reduce((s, l) => s + l.count, 0);
  if (!total) return null;
  if (lessons.length > MAX_PER_SOURCE) {
    return {
      count: total,
      action: summaryAction,
      text: summaryText(total, lessons.length),
      link: 'grade.html',
    };
  }
  return lessons.map(l => ({
    // The suffix keeps each box's id stable and distinct — `only:` filtering and the tests key
    // on the source id, and three boxes sharing one would be indistinguishable to both.
    idSuffix: l.offeringId,
    count: l.count,
    action: `${action} · ${l.title}`,
    text: textFor(l),
    link: gradeLinkFor(l.offeringId),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The registry
 * ══════════════════════════════════════════════════════════════════════════════
 * Each source:
 *   id         stable key, used for ordering and tests
 *   severity   'alert' | 'warn' | 'info' — drives colour only, never order
 *   icon       emoji; the dashboard's stat tiles already use this vocabulary
 *   director   true = only a director/admin sees it
 *   load(ctx)  → { count, action, text, link } | an ARRAY of those | null
 *
 * An array becomes several boxes, each rendered exactly like a single one. Entries may carry an
 * `idSuffix` so their ids stay distinct; loadTasks() folds it into `id` and drops the field.
 *
 * `text` is written by the source rather than assembled from a template, because "3 lessons
 * need aggregating" and "3 sections have nobody assigned" want different words and a generic
 * `${count} ${label}` would produce a worse sentence for both.
 *
 * `action` is the two-or-three-word version of the same thing — the imperative, no count in it.
 * The box shows `count + action`; `text` becomes its tooltip. The row used to print the number
 * and then the full sentence beside it, which said the count twice, ran four boxes to the full
 * width of the page, and buried the only decision the reader makes here (go, or not) in a
 * clause. What a box is FOR fits in two words; the sentence is detail, and detail belongs on
 * hover.
 */
export const SOURCES = [
  {
    id: 'to-grade',
    severity: 'alert',
    icon: '📝',
    director: false,
    async load(ctx) {
      // pastDueUngraded() returns one row per assignment, oldest deadline first — which is the
      // order these should be worked, so it is also the order they are rendered in.
      const rows = (await pastDueUngraded(ctx, ctx.sectionIds)).filter(r => r.outstanding > 0);
      return perLesson(
        rows.map(r => ({ offeringId: r.offeringId, title: r.title, count: r.outstanding })), {
          action: 'Review',
          textFor: (l) => `${plural(l.count, 'submission', 'submissions')} past due and not`
                        + ` finalized on ${l.title} — click to grade it`,
          summaryAction: 'Review grades',
          summaryText: (total, n) =>
            `${plural(total, 'submission', 'submissions')} past due and not finalized`
            + ` · ${plural(n, 'assignment', 'assignments')}`,
        });
    },
  },

  {
    id: 'ai-unfinalized',
    severity: 'warn',
    icon: '🤖',
    director: false,
    async load(ctx) {
      // An AI suggestion is not a grade until a human says so — that is the whole posture of
      // /preflight-analyze (is_finalized=false, always). This box is the queue that posture
      // creates, and without it the suggestions sit unreviewed and invisible.
      const { data: enroll } = await db.from('enrollments')
        .select('id').in('section_id', ctx.sectionIds).eq('status', 'active');
      const ids = (enroll || []).map(e => e.id);
      if (!ids.length) return null;

      // The offering is embedded so each box can NAME the lesson it counted and deep-link to it.
      // Without the title the box would read "4 · Review AI grades" and send the reader to a
      // picker to work out which four, which is what the beta objected to.
      const { data, error } = await db.from('grades')
        .select('id, assignment_offering_id,'
              + 'assignment_offerings!inner(id, due_at, assignments!inner(title, slug))')
        .in('enrollment_id', ids)
        .eq('is_finalized', false)
        .eq('source', 'ai_suggested');
      if (error) throw error;
      if (!(data || []).length) return null;

      const byOffering = new Map();
      (data || []).forEach(g => {
        const o = g.assignment_offerings;
        const cur = byOffering.get(g.assignment_offering_id) || {
          offeringId: g.assignment_offering_id,
          title: o?.assignments?.title || o?.assignments?.slug || 'this assignment',
          dueAt: o?.due_at || null,
          count: 0,
        };
        cur.count++;
        byOffering.set(g.assignment_offering_id, cur);
      });
      const lessons = [...byOffering.values()]
        .sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));

      return perLesson(lessons, {
        action: 'Review AI',
        textFor: (l) => `${plural(l.count, 'AI-suggested grade', 'AI-suggested grades')} awaiting`
                      + ` your review on ${l.title} — click to grade it`,
        summaryAction: 'Review AI grades',
        summaryText: (total, n) =>
          `${plural(total, 'AI-suggested grade', 'AI-suggested grades')} awaiting your review`
          + ` · ${plural(n, 'assignment', 'assignments')}`,
      });
    },
  },

  {
    id: 'to-aggregate',
    severity: 'warn',
    icon: '🧭',
    director: true,
    async load(ctx) {
      // A lesson whose deadline has passed but which has no readiness report yet: /lesson-aggregate
      // has not been run for it. The rollup is the page that shows the gap, so that is the link.
      const now = new Date().toISOString();
      const { data: offerings, error } = await db.from('assignment_offerings')
        .select('id, due_at, assignments!inner(slug, title)')
        .eq('course_offering_id', ctx.currentOffering)
        .eq('is_published', true)
        .not('due_at', 'is', null)
        .lt('due_at', now);
      if (error) throw error;
      if (!(offerings || []).length) return null;

      // scope_id is deliberately not a FK (it points at whichever table `scope` names), so the
      // scope filter is what stops this matching a same-uuid row of a different kind.
      const { data: reports } = await db.from('analysis_reports')
        .select('scope_id')
        .eq('scope', 'assignment_offering')
        .eq('kind', 'readiness')
        .in('scope_id', offerings.map(o => o.id));
      const done = new Set((reports || []).map(r => r.scope_id));

      const missing = offerings.filter(o => !done.has(o.id));
      if (!missing.length) return null;
      // Oldest first: the lesson furthest past its deadline is the one whose rollup is most
      // overdue, and it is also the one whose prose will be least useful if left much longer.
      missing.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
      return {
        count: missing.length,
        action: 'Run rollups',
        text: `${plural(missing.length, 'assignment', 'assignments')} past due with no readiness rollup yet`,
        link: `report.html?i=${encodeURIComponent(missing[0].assignments?.slug || '')}`,
      };
    },
  },

  {
    id: 'unstaffed-sections',
    severity: 'warn',
    icon: '🏫',
    director: true,
    async load(ctx) {
      const { data: sections, error } = await db.from('sections')
        .select('id, code').eq('course_offering_id', ctx.currentOffering);
      if (error) throw error;
      if (!(sections || []).length) return null;

      const { data: staff } = await db.from('staff_assignments')
        .select('section_id').eq('course_offering_id', ctx.currentOffering);

      // An offering-wide row (section_id NULL) covers every section, so if even one exists then
      // no section is unstaffed. Getting this backwards is the classic reading of that NULL —
      // it means "all sections", not "none".
      if ((staff || []).some(s => s.section_id == null)) return null;

      const covered = new Set((staff || []).map(s => s.section_id).filter(Boolean));
      const bare = sections.filter(s => !covered.has(s.id));
      if (!bare.length) return null;
      return {
        count: bare.length,
        action: 'Assign instructors',
        text: `${plural(bare.length, 'section has', 'sections have')} nobody assigned`
            + ` · ${bare.map(s => s.code).sort().join(', ')}`,
        link: 'admin.html',
      };
    },
  },

  {
    id: 'analysis-runs',
    severity: 'alert',
    icon: '⚠️',
    director: true,
    async load(ctx) {
      // Mirrors the run banner's rule rather than inventing a second one: a scheduled run that
      // failed, or one still claiming to be running long after it started (migration 009 writes
      // the row BEFORE the work so exactly this case is visible).
      const { data, error } = await db.from('analysis_runs')
        .select('id, status, started_at, skill')
        .eq('course_offering_id', ctx.currentOffering)
        .eq('invoked_by', 'scheduled')
        .order('started_at', { ascending: false })
        .limit(25);
      if (error) throw error;

      const stale = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5 > STALE_RUNNING_H;
      const bad = (data || []).filter(r =>
        r.status === 'failed' || (r.status === 'running' && stale(r.started_at)));
      if (!bad.length) return null;
      const failed = bad.filter(r => r.status === 'failed').length;
      return {
        count: bad.length,
        action: 'Check scheduled runs',
        text: failed === bad.length
          ? `${plural(failed, 'scheduled run', 'scheduled runs')} failed`
          : `${plural(bad.length, 'scheduled run needs', 'scheduled runs need')} attention`
            + ` · ${failed} failed, ${bad.length - failed} stalled`,
        link: 'system.html',
      };
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════════════
 * Loading
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Run every source the caller is entitled to, concurrently, and return the non-empty ones.
 *
 * A source may return one task or an array of them (see the registry header). Arrays are
 * flattened in place, so SOURCES order is preserved and a per-lesson source's entries stay
 * adjacent and in the order it emitted them.
 *
 * @param {object} ctx  the auth context
 * @param {object} opts `{ only }` — restrict to these source ids (tests, and future filtering)
 * @returns {Promise<Array<{id, severity, icon, count, text, link}>>} in SOURCES order
 */
export async function loadTasks(ctx, opts = {}) {
  if (!ctx?.currentOffering || !ctx.sectionIds?.length) return [];
  const isDirector = !!ctx.isDirectorForCurrent?.();

  // Narrow to what the caller teaches — see the header. Passed as a derived ctx rather than as a
  // second argument so a source added later cannot forget to apply it: `ctx.sectionIds` inside a
  // load() is already the right list, and there is no wider one within reach.
  const { ids } = actionableSections(ctx);
  if (!ids.length) return [];
  const scoped = { ...ctx, sectionIds: ids };

  const eligible = SOURCES.filter(s =>
    (!s.director || isDirector) && (!opts.only || opts.only.includes(s.id)));

  const settled = await Promise.all(eligible.map(async (src) => {
    try {
      const out = await src.load(scoped);
      if (!out) return [];
      return [out].flat()
        .filter(t => t && t.count)
        .map(({ idSuffix, ...t }) => ({
          id: idSuffix ? `${src.id}:${idSuffix}` : src.id,
          severity: src.severity, icon: src.icon, ...t,
        }));
    } catch (err) {
      // Deliberately swallowed — see the header. One dead query must not cost the dashboard.
      console.warn(`[tasks] source "${src.id}" failed:`, err?.message || err);
      return [];
    }
  }));

  return settled.flat();
}

/* ══════════════════════════════════════════════════════════════════════════════
 * View
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The due-out row. Pure — takes the loaded tasks, returns markup — so it can be rendered in a
 * test without a database, which is how the empty state stays verified.
 *
 * `opts.scoped` (from actionableSections().narrowed) only labels the row. It is computed by the
 * caller rather than carried on each task because it is a property of the VIEWER, not of any one
 * source, and putting it on the task objects would invite a future source to disagree with it.
 *
 * BOTH STATES CARRY A LINK TO GRADE, including the empty one. That is not decoration: the nav bar
 * stopped listing Grade on 2026-07-23 (P1.14) on the grounds that these boxes are the route to it,
 * and with nothing outstanding there are no boxes — so without this the page with the "nothing to
 * do" message would also be the page with no way to go and check.
 */
export function renderTasks(tasks, { esc, scoped = false } = {}) {
  const gradeLink = `<a class="duo-link" href="grade.html">Grade page →</a>`;

  if (!tasks.length) {
    return `<section class="dash-section duo-empty-wrap">
      <div class="duo-empty"><span class="duo-empty-ic">✓</span>
        <span>Nothing outstanding — grading is current and every assignment past its deadline has a rollup.</span>
        ${gradeLink}
      </div></section>`;
  }

  // count + imperative, and nothing else on the face of it. The full sentence rides along as the
  // title so the detail is one hover away rather than one line wider. `action` is optional so a
  // source added before this convention still renders something sensible.
  const boxes = tasks.map(t => `
    <a class="duo-box sev-${esc(t.severity)}" href="${esc(t.link)}" data-task="${esc(t.id)}"
       title="${esc(t.text)}">
      <span class="duo-n">${t.count}</span>
      <span class="duo-act">${esc(t.action || t.text)}</span>
    </a>`).join('');

  return `<section class="dash-section dash-tasks">
    <div class="section-head"><h2>📌 Needs your attention</h2>
      <span class="count-pill">${tasks.length}</span>
      <span class="muted duo-scope">${scoped ? 'your sections' : 'all sections you staff'}</span>
      <span class="grow"></span>${gradeLink}</div>
    <div class="duo-row">${boxes}</div>
  </section>`;
}
