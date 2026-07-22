// run-banner.js — site-wide status of the automated analysis runs.
//
// WHAT THIS IS FOR
//   /lesson-cycle can run unattended after a deadline. Nobody is watching when it does, so the
//   only way a director learns it failed is if something tells them. This is that something: a
//   strip under the nav, on every page, driven by app.analysis_runs.
//
// WHO SEES IT
//   Directors and system admins only. An instructor cannot fix a failed overnight run and cannot
//   act on a successful one, so showing it to them is noise.
//
//   A director sees EVERY course they direct, not just the one they happen to be viewing. That is
//   the whole point — a failure in phys-110 must not stay invisible because they are looking at
//   phys-215. ctx.courses already carries one entry per offering the viewer staffs, with a `role`,
//   and a global admin is given role:'director' on all of them (auth.js resolveFacultyOfferings),
//   so filtering on role === 'director' expresses both rules at once.
//
//   RLS is NOT what enforces this. analysis_runs_read_staff lets any staff member of the offering
//   read the rows; the director-only rule is a UI convention, like the '__all__' rule on the
//   rollup. Enforce it here or it is not enforced.
//
// WHAT COUNTS AS NEEDING ATTENTION
//   Only SCHEDULED runs. A human who types the command sees the outcome in front of them and does
//   not need to be told again on every page afterwards.
//
//   Per offering, only the LATEST run matters. That is what makes "until corrected" work without
//   any explicit clearing step: a failed Monday run stops showing the moment Tuesday's run
//   succeeds, because the later row is the one being read.

// NOTE: supabase.js is imported lazily inside mountRunBanners, NOT at module scope. It captures
// window.db when it loads, so a static import here would give nav.js — which every page renders —
// a hard dependency on a live client just to draw the chrome. Two existing suites assert nav can
// be imported without one, and they are right to.
import { esc } from './util.js';

const LS_DISMISSED = 'prep.runbanner.dismissed';
// A success is news for a day. A failure is news until it is fixed, however long that takes —
// hence no upper bound on the alert side.
const SUCCESS_WINDOW_H = 24;
// A run still marked 'running' this long after it started did not finish. The row is written
// before the work starts precisely so this case is visible (migration 009).
const STALE_RUNNING_H = 2;

const hoursAgo = iso => (Date.now() - new Date(iso).getTime()) / 36e5;

function dismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_DISMISSED) || '[]')); }
  catch (_) { return new Set(); }
}
function dismiss(id) {
  const s = dismissed();
  s.add(id);
  // Bounded: a term of nightly runs would otherwise grow this forever. The newest 200 ids is far
  // more than enough to keep every banner a person has actually seen suppressed.
  try { localStorage.setItem(LS_DISMISSED, JSON.stringify([...s].slice(-200))); } catch (_) {}
}

/**
 * Decide what one offering's latest scheduled run should show, or null for nothing.
 * Pure, so the rules are testable without a database or a DOM.
 */
export function bannerFor(run, courseLabel) {
  if (!run) return null;
  const stale = run.status === 'running' && hoursAgo(run.started_at) > STALE_RUNNING_H;

  if (run.status === 'success') {
    if (hoursAgo(run.finished_at || run.started_at) > SUCCESS_WINDOW_H) return null;
    return { id: run.id, level: 'success', course: courseLabel,
             text: run.summary || 'The overnight analysis completed.' };
  }
  if (stale) {
    return { id: run.id, level: 'error', course: courseLabel,
             text: 'The overnight analysis started but never finished. Grades and the rollup may '
                 + 'be incomplete for this lesson.' };
  }
  if (run.status === 'failed') {
    return { id: run.id, level: 'error', course: courseLabel,
             text: run.error || run.summary || 'The overnight analysis failed.' };
  }
  if (run.status === 'partial') {
    return { id: run.id, level: 'warn', course: courseLabel,
             text: run.summary || 'The overnight analysis ran but did less than a full pass.' };
  }
  // 'skipped' is a correct outcome (deadline not passed, nothing to grade) and 'running' inside
  // its window is simply in progress. Neither is worth interrupting anyone for.
  return null;
}

/** The offerings this viewer should be told about: every one they direct. */
function directedOfferings(ctx) {
  if (ctx?.role !== 'faculty') return [];
  return (ctx.courses || []).filter(c => c.role === 'director');
}

/**
 * Query, decide, render. Called by renderNav on every faculty page; never awaited, so a slow or
 * failing query delays nothing.
 */
export async function mountRunBanners(ctx) {
  const offerings = directedOfferings(ctx);
  if (!offerings.length) return;

  let rows;
  try {
    const { db } = await import('./supabase.js');
    const { data, error } = await db.from('analysis_runs')
      .select('id, skill, invoked_by, status, started_at, finished_at, summary, error, '
            + 'course_offering_id, assignment_offering_id, day_track')
      .in('course_offering_id', offerings.map(o => o.offeringId))
      .eq('invoked_by', 'scheduled')
      .order('started_at', { ascending: false });
    // A deployment predating migration 009 has no table. That is not worth an error to a user
    // who did not ask for this — degrade to showing nothing.
    if (error) return;
    rows = data || [];
  } catch (_) { return; }

  // Latest run per offering. The query is already newest-first, so the first sighting wins.
  const latest = {};
  rows.forEach(r => { if (!(r.course_offering_id in latest)) latest[r.course_offering_id] = r; });

  const skip = dismissed();
  const banners = offerings
    .map(o => bannerFor(latest[o.offeringId], ctx.courseTitleOf?.(o.offeringId) || o.courseCode))
    .filter(b => b && !skip.has(b.id));
  if (!banners.length) return;

  render(banners);
}

function render(banners) {
  let host = document.getElementById('run-banners');
  if (!host) {
    host = document.createElement('div');
    host.id = 'run-banners';
    host.className = 'run-banners';
    const nav = document.getElementById('topnav');
    // After the nav, before the page — visible without displacing the page's own heading.
    if (nav && nav.parentNode) nav.parentNode.insertBefore(host, nav.nextSibling);
    else document.body.insertBefore(host, document.body.firstChild);
  }

  host.innerHTML = banners.map(b => `
    <div class="alert alert-${esc(b.level)} run-banner" data-run="${esc(b.id)}" role="status">
      <div class="run-banner-body">
        <strong>${esc(b.course)}</strong> — ${esc(b.text)}
      </div>
      <button class="run-banner-x" data-dismiss aria-label="Dismiss">&times;</button>
    </div>`).join('');

  host.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.currentTarget.closest('.run-banner');
      if (!card) return;
      dismiss(card.dataset.run);
      card.remove();
      if (!host.querySelector('.run-banner')) host.remove();
    });
  });
}
