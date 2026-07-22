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
// ── ONE BOX PER KIND, NOT ONE PER ITEM ───────────────────────────────────────────
// P1.15 is explicit about this and it is the thing that keeps the panel usable in week ten: a
// box says "9 submissions to grade" and clicking it goes to the page that clears them. A list
// of nine rows here would duplicate the Grade tab badly and push everything else off screen.
//
// ── ZERO IS THE COMMON STATE, SO ZERO RENDERS NOTHING ────────────────────────────
// Most of these are empty most of the term. A box sitting at `0` trains people to ignore the
// row — the same failure as a dashboard full of green ticks. A source with nothing outstanding
// is omitted entirely, and when every source is empty the panel says so once, cheerfully, in
// one line.
//
// ── SCOPE: WHAT YOU CAN ACT ON, NOT WHAT YOU CAN SEE ─────────────────────────────
// Everything here is scoped to ctx.sectionIds — the sections the caller actually staffs — and
// two sources are director-only because an instructor cannot act on them. That is a UI
// convention, exactly like the run banner's: RLS admits any staff member of the offering to
// these tables, so if the convention is not applied here it is not applied at all.
//
// ── FAILURE IS PER-SOURCE ────────────────────────────────────────────────────────
// A source that throws is dropped, not fatal. This panel sits at the top of the dashboard; a
// single failing query must not take the page with it, and a missing box is a far better
// outcome than a dashboard that will not render.

import { db } from './supabase.js';
import { pastDueUngraded } from './faculty-grade.js';

/** A run still marked 'running' this long after it started did not finish (mirrors run-banner.js). */
const STALE_RUNNING_H = 2;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ══════════════════════════════════════════════════════════════════════════════
 * The registry
 * ══════════════════════════════════════════════════════════════════════════════
 * Each source:
 *   id         stable key, used for ordering and tests
 *   severity   'alert' | 'warn' | 'info' — drives colour only, never order
 *   icon       emoji; the dashboard's stat tiles already use this vocabulary
 *   director   true = only a director/admin sees it
 *   load(ctx)  → { count, text, link } | null
 *
 * `text` is written by the source rather than assembled from a template, because "3 lessons
 * need aggregating" and "3 sections have nobody assigned" want different words and a generic
 * `${count} ${label}` would produce a worse sentence for both.
 */
export const SOURCES = [
  {
    id: 'to-grade',
    severity: 'alert',
    icon: '📝',
    director: false,
    async load(ctx) {
      const rows = await pastDueUngraded(ctx, ctx.sectionIds);
      const count = rows.reduce((sum, r) => sum + r.outstanding, 0);
      if (!count) return null;
      const lessons = rows.length;
      return {
        count,
        text: `${plural(count, 'submission', 'submissions')} past due and not finalized`
            + ` · ${plural(lessons, 'lesson', 'lessons')}`,
        // Plain grade.html: the page takes no assignment parameter today, so deep-linking to
        // the oldest one would be a URL that silently does nothing. When P1.14 gives it a
        // queue, this is where that link goes.
        link: 'grade.html',
      };
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
      const { data: enrol } = await db.from('enrollments')
        .select('id').in('section_id', ctx.sectionIds).eq('status', 'active');
      const ids = (enrol || []).map(e => e.id);
      if (!ids.length) return null;

      const { data, error } = await db.from('grades')
        .select('id, assignment_offering_id')
        .in('enrollment_id', ids)
        .eq('is_finalized', false)
        .eq('source', 'ai_suggested');
      if (error) throw error;
      const count = (data || []).length;
      if (!count) return null;
      const lessons = new Set((data || []).map(g => g.assignment_offering_id)).size;
      return {
        count,
        text: `${plural(count, 'AI-suggested grade', 'AI-suggested grades')} awaiting your review`
            + ` · ${plural(lessons, 'lesson', 'lessons')}`,
        link: 'grade.html',
      };
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
        text: `${plural(missing.length, 'lesson', 'lessons')} past due with no readiness rollup yet`,
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
 * @param {object} ctx  the auth context
 * @param {object} opts `{ only }` — restrict to these source ids (tests, and future filtering)
 * @returns {Promise<Array<{id, severity, icon, count, text, link}>>} in SOURCES order
 */
export async function loadTasks(ctx, opts = {}) {
  if (!ctx?.currentOffering || !ctx.sectionIds?.length) return [];
  const isDirector = !!ctx.isDirectorForCurrent?.();

  const eligible = SOURCES.filter(s =>
    (!s.director || isDirector) && (!opts.only || opts.only.includes(s.id)));

  const settled = await Promise.all(eligible.map(async (src) => {
    try {
      const out = await src.load(ctx);
      if (!out || !out.count) return null;
      return { id: src.id, severity: src.severity, icon: src.icon, ...out };
    } catch (err) {
      // Deliberately swallowed — see the header. One dead query must not cost the dashboard.
      console.warn(`[tasks] source "${src.id}" failed:`, err?.message || err);
      return null;
    }
  }));

  return settled.filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * View
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The due-out row. Pure — takes the loaded tasks, returns markup — so it can be rendered in a
 * test without a database, which is how the empty state stays verified.
 */
export function renderTasks(tasks, { esc }) {
  if (!tasks.length) {
    return `<section class="dash-section duo-empty-wrap">
      <div class="duo-empty"><span class="duo-empty-ic">✓</span>
        <span>Nothing outstanding — grading is current and every lesson past its deadline has a rollup.</span>
      </div></section>`;
  }

  const boxes = tasks.map(t => `
    <a class="duo-box sev-${esc(t.severity)}" href="${esc(t.link)}" data-task="${esc(t.id)}">
      <span class="duo-ic" aria-hidden="true">${t.icon}</span>
      <span class="duo-n">${t.count}</span>
      <span class="duo-txt">${esc(t.text)}</span>
    </a>`).join('');

  return `<section class="dash-section">
    <div class="section-head"><h2>📌 Needs your attention</h2>
      <span class="count-pill">${tasks.length}</span></div>
    <div class="duo-row">${boxes}</div>
  </section>`;
}
