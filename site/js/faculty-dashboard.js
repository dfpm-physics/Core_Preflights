// faculty-dashboard.js — the Just-in-Time-Teaching faculty dashboard view.
//
// Ported from the INBOX/dashboard-redesign.html exploration and wired to live Supabase data:
// KPI tiles + an active-lesson spotlight (completion ring · effort histogram · misconceptions ·
// flagged callout) with lesson navigation, the logged-in user's own section cards, and a
// director-only section×lesson heatmap matrix. All numbers come from one fetch
// (loadFacultyDashboard) and are aggregated live with summarizeReports() — the same numeric
// engine the interactions rollup uses, so the two views agree.
//
// Role is real (from ctx), not a preview toggle: instructors get their own sections scoped and
// no matrix; directors/admins get the scope toggle (all ↔ mine) and the matrix.

import { loadFacultyDashboard } from './faculty-data.js';
import { summarizeReports } from './faculty-rollup.js';
import { loadTasks, renderTasks } from './faculty-tasks.js';
import { actionableSections, titleTopic } from './schema.js';
import { loadEiForSections, summarizeEi, renderEiPanel } from './faculty-ei.js';
import { esc, iconHTML, fmtDate } from './util.js';

let CTX = null, ROOT = null, MODEL = null;
// STATE.scope is 'all', 'mine', or a section uuid. The uuid case is P1.7: the control could
// previously only toggle all-vs-mine, so a director with six sections had no way to look at one.
const STATE = { scope: 'all', metric: 'completion', viewLesson: null };
// null while the task queries are still in flight — the panel renders a placeholder rather than
// an empty state, because "nothing outstanding" and "not asked yet" must not look the same.
let TASKS = null;
// P1.8's extra-instruction panel, on the same late-arriving contract as TASKS: null while the
// query is in flight, `{ stats, nameOf }` once it lands. It renders nothing when nothing has been
// logged, which is most instructors in week one — see renderEiPanel().
let EI = null;
// Bumped on every mount. The task load is async and ctx is the SAME OBJECT across a course
// switch, so an identity check on ctx/root cannot tell a stale response from a current one — a
// slow phys-110 load would paint its boxes over phys-215. The generation can.
let MOUNT_GEN = 0;
let _observersWired = false;

/** Load the model and render the dashboard into `root`. Re-callable (e.g. on course change). */
export async function mountDashboard(ctx, root) {
  const gen = ++MOUNT_GEN;
  CTX = ctx; ROOT = root;
  root.innerHTML = `<div class="center-load"><span class="spinner"></span><span>Loading your dashboard…</span></div>`;
  MODEL = await loadFacultyDashboard(ctx);
  if (gen !== MOUNT_GEN) return;          // a newer mount overtook this one
  STATE.scope = 'all';
  STATE.metric = 'completion';
  STATE.viewLesson = MODEL.activeId;
  TASKS = null;
  EI = null;
  render();
  wireGlobalObservers();

  // Deliberately AFTER the first paint and not awaited into it. These are five extra round
  // trips; blocking the whole dashboard on them would make every page load as slow as the
  // slowest one, to show a panel that is empty most of the term.
  loadTasks(ctx)
    .catch(() => [])
    .then(tasks => {
      if (gen !== MOUNT_GEN) return;      // belongs to a course the reader has left
      TASKS = tasks;
      paintTasks();
    });

  // Same contract, same reasoning, separate failure: EI is a nice-to-have panel and its two
  // queries must not be able to cost the reader the due-out row, or vice versa.
  loadEi(ctx)
    .catch(() => null)
    .then(ei => {
      if (gen !== MOUNT_GEN) return;
      EI = ei || { stats: { total: 0 }, nameOf: () => '' };
      paintEi();
    });
}

/**
 * Extra-instruction sessions for the sections the viewer TEACHES.
 *
 * Scoped the same way the due-out row is, and for the same reason: "how much EI have I held" is a
 * question about your own teaching. A director reading the whole course's EI total would be
 * reading a different, also-useful number that this panel does not claim to be.
 */
async function loadEi(ctx) {
  const { ids, narrowed } = actionableSections(ctx);
  if (!ids.length) return null;
  const { rows, nameOf } = await loadEiForSections(ids);
  return { stats: summarizeEi(rows), nameOf, scoped: narrowed };
}

/** Render-only entry (no network) for offline previews/tests: drive the real view with a
 *  pre-built model + a minimal ctx-like object ({ isDirectorForCurrent, instructorRow }). */
export function renderModel(ctx, root, model, state = {}) {
  MOUNT_GEN++;
  CTX = ctx; ROOT = root; MODEL = model;
  STATE.scope = state.scope || 'all';
  STATE.metric = state.metric || 'completion';
  STATE.viewLesson = state.viewLesson ?? model.activeId;
  // Defaults to [] rather than null: this path never queries, so leaving it null would render
  // the loading skeleton forever in an offline preview. Pass state.tasks to exercise the panel.
  TASKS = state.tasks || [];
  EI = state.ei || { stats: { total: 0 }, nameOf: () => '' };
  render();
  wireGlobalObservers();
}

/* ── aggregation helpers (live, over the one fetch) ─────────────────────────── */

const dir = () => CTX.isDirectorForCurrent();
const mySections = () => MODEL.sections.filter(s => s.isMine);

/* Which sections the current scope covers.
 *
 * P1.7 added the third case. 'all' and 'mine' are the two set-scopes; anything else is a
 * section uuid, and an unknown one falls back to 'mine' rather than returning [] — a stale
 * pick (a section that was renamed away, or a course switch) would otherwise render a
 * dashboard of zeroes that looks like real data. */
const scopeSections = () => {
  if (STATE.scope === 'mine') return mySections();
  if (STATE.scope === 'all') return dir() ? MODEL.sections : mySections();
  const one = MODEL.sections.filter(s => s.id === STATE.scope);
  return one.length ? one : mySections();
};
const activeIdx = () => MODEL.lessons.findIndex(l => l.id === MODEL.activeId);
const lessonIdx = (id) => MODEL.lessons.findIndex(l => l.id === id);

// Aggregate one lesson across a set of sections → the spotlight / KPI numbers.
//
// `paths` rides along on every aggregate because these numbers changed meaning when the written
// path started feeding them. Effort is now one distribution over both modalities (Q2 of a
// written preflight is the same reading reflection the artifact scores — see schema.js), so
// "avg effort 3.8" is a claim about everyone who worked the lesson, not just the artifact
// takers. The UI has to be able to say which, or the reader cannot calibrate it.
function aggregateScope(lessonId, secs) {
  const ids = new Set(secs.map(s => s.id));
  const rows = (MODEL.rowsByLesson[lessonId] || []).filter(r => ids.has(r.sectionId));
  const s = summarizeReports(rows);
  const total = secs.reduce((sum, sec) => sum + (MODEL.sectionSize[sec.id] || 0), 0);
  const done = rows.length;
  return {
    done, total, pct: total ? done / total : 0,
    effort: s.effort.avg, und: s.understanding.overall, flags: s.flags.needs_follow_up,
    dist: s.effort.hist, paths: s.paths, undFrom: s.understanding.from,
    mis: s.misconceptions.map(m => ({ label: m.label, sev: m.major > 0 ? 'major' : 'minor', cnt: m.count })),
  };
}

// Aggregate one (section, lesson) cell → section cards + matrix.
function cellFor(sectionId, lessonId) {
  const rows = (MODEL.rowsByLesson[lessonId] || []).filter(r => r.sectionId === sectionId);
  const s = summarizeReports(rows);
  const total = MODEL.sectionSize[sectionId] || 0;
  const done = rows.length;
  return { done, total, pct: total ? done / total : 0,
    effort: s.effort.avg, und: s.understanding.overall, flags: s.flags.needs_follow_up,
    paths: s.paths };
}

/* How a cohort worked the lesson, in as few words as a tile sub-line allows. Returns '' when
   there is nothing to disambiguate (no work yet, or a single-modality lesson doing the obvious
   thing) — a label that always fires is a label nobody reads. */
function pathNote(paths) {
  if (!paths) return '';
  const { interactiveN: i = 0, writtenN: w = 0 } = paths;
  if (!i && !w) return '';
  if (i && w) return `${i} interactive + ${w} questions`;
  return w ? 'question set only' : '';
}

const f1 = v => (v == null ? '—' : v.toFixed(1));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* completion (0..1) or effort/5 → institutional red→amber→green tint (theme-aware). */
function tint(val01) {
  const hue = clamp(val01, 0, 1) * 130;                       // 0 = red, 130 = green
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return dark
    ? { bg: `hsl(${hue} 42% 17%)`, bd: `hsl(${hue} 42% 28%)` }
    : { bg: `hsl(${hue} 60% 90%)`, bd: `hsl(${hue} 55% 78%)` };
}
const NEUTRAL_CELL = () => ({ bg: 'var(--surface-sunken)', bd: 'var(--border)' });

/* understanding (0–5) → score-ramp color, used as TEXT color (matches the rollup). */
function sColor(v) {
  if (v == null) return 'var(--muted)';
  const z = Math.min(4, Math.max(0, Math.floor(v)));
  return ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'][z];
}
/* effort histogram bucket 0..5 → distribution ramp (matches the rollup effort chart). */
const dColor = b => ['var(--d0)', 'var(--d1)', 'var(--d2)', 'var(--d3)', 'var(--d4)', 'var(--d5)'][b];

const statusOf = (vIdx) => vIdx < activeIdx() ? 'past' : vIdx > activeIdx() ? 'upcoming' : 'today';

/* ── render ─────────────────────────────────────────────────────────────────── */

function render() {
  const roleLabel = CTX.instructorRow?.is_global_admin ? 'Global admin'
    : dir() ? 'Director' : 'Instructor';
  const firstName = (MODEL.myName || '').split(/\s+/)[0] || 'Instructor';

  if (MODEL.noCourse) {
    ROOT.innerHTML = head(firstName, roleLabel)
      + `<div class="alert alert-warn">No course access found. Contact the course director.</div>`;
    return;
  }
  if (MODEL.noSections) {
    ROOT.innerHTML = head(firstName, roleLabel) + `<div class="empty-state"><div class="es-ic">🗂️</div>
      <h3>No sections yet</h3><p>You don't have any sections in ${esc(MODEL.courseTitle)} yet.
      ${dir() ? 'Create sections and upload a roster in the gradebook.' : 'Ask your course director to assign you to sections.'}</p></div>`;
    return;
  }
  if (!MODEL.lessons.length) {
    ROOT.innerHTML = head(firstName, roleLabel) + `<div class="empty-state"><div class="es-ic">💡</div>
      <h3>No published assignments yet</h3><p>Once interactions are published for ${esc(MODEL.courseTitle)},
      this dashboard fills in with completion, effort, and misconception trends.
      ${dir() ? '<a href="lessons.html">Manage assignments →</a>' : ''}</p></div>`;
    return;
  }

  // Default the view to the active lesson if the current pick fell out of scope.
  if (lessonIdx(STATE.viewLesson) < 0) STATE.viewLesson = MODEL.activeId;
  const secs = scopeSections();
  const agg = aggregateScope(STATE.viewLesson, secs);
  const ctx = { vIdx: lessonIdx(STATE.viewLesson), lesson: MODEL.lessons[lessonIdx(STATE.viewLesson)] };
  ctx.status = statusOf(ctx.vIdx);

  // The tasks row sits BELOW the spotlight, not above the stat tiles where it started.
  //
  // It loads a beat after everything else and its height depends on how much is outstanding, so
  // at the top of the page it pushed the two things people actually come here for — the KPI tiles
  // and the active preflight — to a different vertical position on every visit, and moved them
  // again once the queries landed. Underneath, the numbers and the spotlight are in the same
  // place whether you have five things to do or none.
  ROOT.innerHTML =
    head(firstName, roleLabel) +
    statTiles(agg, ctx) +
    spotlight(agg, ctx) +
    `<div id="dashTasks">${tasksMarkup()}</div>` +
    yourSections() +
    // Below your sections, because it is a record of what you have done rather than something
    // waiting on you — the due-out row above owns that job and should not have to share the
    // reader's first glance.
    `<div id="dashEi">${eiMarkup()}</div>` +
    (dir() ? matrix() : '');

  wire();
}

/* The tasks panel is the one part of the dashboard that arrives late, so it owns a stable host
 * element and repaints into it. Re-rendering the whole dashboard when the queries land would
 * discard the reader's lesson navigation and scope pick for a panel above the fold. */
function tasksMarkup() {
  if (TASKS === null) {
    return `<section class="dash-section"><div class="duo-row duo-loading">
      <span class="duo-box duo-skel"></span><span class="duo-box duo-skel"></span>
    </div></section>`;
  }
  return renderTasks(TASKS, { esc, scoped: actionableSections(CTX).narrowed });
}

function paintTasks() {
  const host = ROOT?.querySelector('#dashTasks');
  if (host) host.innerHTML = tasksMarkup();
}

/* P1.8's panel, on the same late-arriving/stable-host contract as the tasks row. No skeleton:
 * unlike the due-out boxes this is often legitimately empty forever, so a placeholder would
 * promise a panel that never appears. */
function eiMarkup() {
  if (EI === null) return '';
  return renderEiPanel(EI.stats, { esc, fmtDate, nameOf: EI.nameOf, scoped: EI.scoped });
}

function paintEi() {
  const host = ROOT?.querySelector('#dashEi');
  if (host) host.innerHTML = eiMarkup();
}

function head(firstName, roleLabel) {
  const c = MODEL.counts || { sections: 0, students: 0, lessons: 0 };
  return `<div class="page-head">
    <h1>Welcome, ${esc(firstName)}</h1>
    <div class="sub">${esc(MODEL.courseTitle)} · ${esc(roleLabel)} · ${c.sections} section${c.sections === 1 ? '' : 's'}
      · ${c.students} student${c.students === 1 ? '' : 's'} · ${c.lessons} assignment${c.lessons === 1 ? '' : 's'} published</div>
  </div>`;
}

/* ── The inline course switcher that used to sit here (P1.7, removed 2026-07-23) ──────────────
 * It was a segmented group (or a <select> past four courses) under the page heading, mirroring
 * the rollup's renderScope() shape, with a switchCourse() that re-set the offering and remounted
 * the whole dashboard.
 *
 * WHY IT EXISTED, because the reason is still valid: switching course from the dashboard meant
 * opening the user menu, which is not where you look while reading a course.
 *
 * WHY IT IS GONE: the answer to that turned out to belong in the nav, not on one page. The course
 * name was already printed beside the wordmark on EVERY page, and it is now the switcher itself
 * (nav.js → brandCourseHTML). Keeping this one as well would have put two controls for the same
 * choice on the same screen, one of which only exists on the dashboard.
 *
 * Course changes still remount this view — dashboard.html passes `onCourseChange` into renderNav,
 * so nothing about the reload path changed, only who triggers it. */

function statTiles(a, ctx) {
  const tile = (accent, icon, emoji, num, label, sub) => `
    <div class="stat-tile accent-${accent}">
      <div class="stat-ic">${iconHTML(icon, emoji, 'ic')}</div>
      <div class="stat-body"><div class="stat-num">${num}</div>
        <div class="stat-label">${esc(label)}</div><div class="stat-sub">${esc(sub)}</div></div>
    </div>`;
  const scopeLabel = (dir() && STATE.scope === 'all') ? 'all sections' : 'your sections';
  const L = ctx.lesson.short;
  const compLabel = ctx.status === 'today' ? 'Active preflight complete'
    : ctx.status === 'past' ? `Assignment ${L} complete` : `Upcoming preflight (A${L})`;
  const compSub = ctx.status === 'today' ? `Assignment ${L} · ${a.done}/${a.total} · before next class`
    : ctx.status === 'past' ? `Assignment ${L} · ${a.done}/${a.total} · already covered`
    : `Assignment ${L} · ${a.done}/${a.total} · not yet due · early submissions`;
  return `<div class="stat-grid">
    ${tile('blue',  'completion', '📨', Math.round(a.pct * 100) + '%', compLabel, compSub)}
    ${tile('gold',  'bolt',       '⚡', f1(a.effort), 'Avg effort (graded)',
           pathNote(a.paths) || `engagement · ${scopeLabel}`)}
    ${tile('red',   'warning',    '🚩', a.flags, 'Flagged for follow-up', 'low engagement or major gap')}
    ${tile('green', 'analytics',  '🧭', f1(a.und), 'Avg understanding',
           a.undFrom?.written && a.undFrom?.interactive ? 'diagnostic · both paths'
           : a.undFrom?.written ? 'diagnostic · free response'
           : 'diagnostic · not graded')}
  </div>`;
}

/* ── P1.7 — section scope, including individual sections ──────────────────────
 * The old control was two buttons, all-vs-mine, so a director could see the whole course or the
 * sections they teach and nothing in between. "How did M3A do?" — the most ordinary question a
 * director asks — had no answer here; you had to open the full rollup.
 *
 * Beyond a handful of sections the segmented group stops fitting, so it becomes a <select>,
 * matching the rollup's threshold behaviour. Counts ride along in the dropdown because an
 * unlabelled section code tells you nothing about how much is behind it. */
const SEG_MAX_SECTIONS = 5;

function scopeControl() {
  const secs = MODEL.sections;
  const mine = mySections();
  // 'mine' is only meaningful when it is a real subset — a director who teaches every section,
  // or none, gets a duplicate option that answers the same question as 'all'.
  const showMine = mine.length > 0 && mine.length < secs.length;
  const opts = ['all', ...(showMine ? ['mine'] : []), ...secs.map(s => s.id)];

  if (!opts.includes(STATE.scope)) STATE.scope = 'all';

  const codeOf = id => secs.find(s => s.id === id)?.code || id;
  const label = v => v === 'all' ? 'All sections' : v === 'mine' ? 'My sections' : codeOf(v);
  const countOf = v => v === 'all' ? secs.length
                     : v === 'mine' ? mine.length
                     : (MODEL.sectionSize[v] || 0);

  if (opts.length <= SEG_MAX_SECTIONS) {
    return `<div class="seg" id="scopeSeg" role="group" aria-label="Section scope">`
      + opts.map(v => `<button data-scope="${esc(v)}" aria-pressed="${STATE.scope === v}">${esc(label(v))}</button>`).join('')
      + `</div>`;
  }
  return `<select id="scopeSel" class="scope-sel" aria-label="Section scope">`
    + opts.map(v => `<option value="${esc(v)}" ${STATE.scope === v ? 'selected' : ''}>`
        + `${esc(label(v))}${v === 'all' || v === 'mine'
            ? ` (${countOf(v)} section${countOf(v) === 1 ? '' : 's'})`
            : ` (${countOf(v)})`}</option>`).join('')
    + `</select>`;
}

function ring(pct) {
  const r = 64, c = 2 * Math.PI * r, off = c * (1 - pct);
  const col = pct >= 0.8 ? 'var(--green)' : pct >= 0.5 ? 'var(--gold)' : 'var(--red)';
  return `<div class="ring">
    <svg width="148" height="148" viewBox="0 0 148 148">
      <circle cx="74" cy="74" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/>
      <circle cx="74" cy="74" r="${r}" fill="none" stroke="${col}" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="ring-center"><div class="ring-pct">${Math.round(pct * 100)}%</div></div>
  </div>`;
}

function spotlight(a, ctx) {
  const L = ctx.lesson, vIdx = ctx.vIdx, st = ctx.status, last = MODEL.lessons.length - 1;
  const noData = a.done === 0;
  const lowData = st === 'upcoming' && a.done < 8;

  // effort distribution
  const maxC = Math.max(1, ...a.dist);
  const bars = a.dist.map((cnt, s) => `<div class="eff-col" title="Effort ${s}: ${cnt}">
      <span class="eff-cnt">${cnt}</span>
      <div class="eff-bar" style="height:${Math.round(cnt / maxC * 100)}%;background:${dColor(s)}"></div>
    </div>`).join('');
  const effBody = noData
    ? `<div class="empty-note">No submissions yet for this assignment.</div>`
    : lowData
      ? `<div class="empty-note">Only ${a.done} early submission${a.done === 1 ? '' : 's'} — too soon for a reliable distribution.</div>`
      : `<div class="eff-wrap">
           <div class="eff-mean">class mean <b>${f1(a.effort)}</b> · engagement${
             pathNote(a.paths) ? ` <span class="muted">· ${esc(pathNote(a.paths))}</span>` : ''}</div>
           <div class="eff-bars">${bars}</div>
           <div class="eff-x">${[0, 1, 2, 3, 4, 5].map(s => `<span>${s}</span>`).join('')}</div>
         </div>`;

  // misconceptions + flagged callout
  const mis = a.mis.slice(0, 5).map(m => `<div class="mis-item">
      <span class="mis-dot ${m.sev}"></span>
      <span class="mis-label">${esc(m.label)}</span>
      <span class="mis-cnt">${m.cnt}</span></div>`).join('');
  // A written-only cohort that has not been aggregated yet has no COUNTED misconceptions. Since
  // 2026-07-21 /preflight-analyze writes the structured misconceptions[] for the written path
  // too, so once it has run this tile counts them like any other cohort — but until then, never
  // let the tile read as "no misconceptions", which would be a clean bill of health nobody
  // earned. (It used to point at a per-question block in the rollup; that block is gone, and the
  // per-question material now lives inside the readiness summary there.)
  const writtenOnly = a.paths && a.paths.writtenN > 0 && a.paths.interactiveN === 0;
  const misBody = noData
    ? `<div class="empty-note">Trends appear once students submit.</div>`
    : writtenOnly && !a.mis.length
      ? `<div class="empty-note">Everyone worked the question set. Misconceptions appear here once
         the assignment has been graded and aggregated —
         <a href="report.html?i=${encodeURIComponent(L.id)}">open the full rollup</a>.</div>`
      : lowData
        ? `<div class="empty-note">Trends appear once more students submit.</div>`
        : (a.mis.length ? `<div class="mis-list">${mis}</div>` : `<div class="empty-note">No common misconceptions flagged.</div>`)
          + (a.flags ? `<div class="callout">🚩 <span><b>${a.flags}</b> student${a.flags === 1 ? '' : 's'} flagged for follow-up</span></div>` : '');

  const eyebrowTxt = st === 'today' ? 'Active preflight · due before next class'
    : st === 'past' ? 'Past assignment · already covered in class' : 'Upcoming preflight · not yet due';
  const metaTxt = st === 'today' ? 'What to know before you walk into class'
    : st === 'past' ? 'How this one landed' : 'Preview — students working ahead';
  const statusWord = st === 'today' ? 'Today' : st === 'past' ? 'Past' : 'Upcoming';
  const dueTxt = L.due_date ? `due ${esc(fmtDate(L.due_date))}` : (st === 'past' ? 'earlier assignment' : st === 'upcoming' ? 'not yet due' : 'current assignment');
  const dueChip = st === 'today' ? `⏳ ${dueTxt}` : st === 'past' ? `✓ ${dueTxt}` : `🔭 ${dueTxt}`;

  const scopeCtl = dir() ? scopeControl() : '';
  /* BACK-TO-TODAY RIDES ON THE STATUS TAG, AND ONLY WHEN THERE IS SOMEWHERE TO GO (2026-07-29).
   *
   * Three revisions, and the middle one is the instructive failure. It began conditional, in the
   * header's flex row immediately before "Open full rollup →" — so arrowing off the current
   * preflight made that link jump sideways, and the reader was aiming at the rollup link, not at
   * this. It was then made permanent-but-disabled to stop the jump (2026-07-27), which fixed the
   * movement by paying for it in width: a greyed-out button nobody can press held a slot in the
   * header on every single view, and at the common widths that is what pushed "Open full rollup →"
   * onto a second line. Trading a rare reflow for a permanent one is the wrong trade.
   *
   * So it moves out of the header row entirely and becomes a second pill beside the status tag,
   * which is already the thing on this card that says WHERE YOU ARE — "Upcoming ↩ Today" reads as
   * one statement, and the affordance sits next to the words that motivate it. Appearing and
   * disappearing is now free: the pill is inline in the title, so nothing in the button row can
   * move under a cursor, and the header keeps its full width for the controls that are always
   * there. */
  const onToday = st === 'today';
  const todayPill = onToday ? '' : `<button class="status-tag today-pill" data-today="1"
      title="Back to the current preflight">↩ Today</button>`;

  return `<div class="spot-shell">
    <button class="spot-arrow left"  data-nav="prev" ${vIdx === 0 ? 'disabled' : ''} aria-label="Previous assignment"><span class="arrow-tab">◀</span></button>
    <button class="spot-arrow right" data-nav="next" ${vIdx === last ? 'disabled' : ''} aria-label="Next assignment"><span class="arrow-tab">▶</span></button>
    <section class="card">
      <div class="card-head">
        <div>
          <span class="eyebrow">${eyebrowTxt}</span>
          <div class="card-title">Assignment ${esc(L.short)} — ${esc(titleTopic(L.title, L.num ?? L.short))} <span class="status-tag ${st}">${statusWord}</span>${todayPill}</div>
          <div class="card-meta">${metaTxt}</div>
        </div>
        <span class="grow"></span>
        ${scopeCtl}
        <div class="tnav">
          <button data-nav="prev" ${vIdx === 0 ? 'disabled' : ''} aria-label="Previous assignment">◀</button>
          <button data-nav="next" ${vIdx === last ? 'disabled' : ''} aria-label="Next assignment">▶</button>
        </div>
        <a class="btn btn-ghost btn-sm" href="report.html?i=${encodeURIComponent(L.id)}" title="Open the full assignment rollup">Open full rollup →</a>
      </div>
      <div class="spot">
        <div class="spot-col ring-wrap">
          ${ring(a.pct)}
          <div class="ring-cap">${a.done} of ${a.total} submitted</div>
          <span class="due-chip">${dueChip}</span>
        </div>
        <div class="spot-col">
          <span class="eyebrow">Effort distribution (0–5)</span>
          ${effBody}
        </div>
        <div class="spot-col">
          <span class="eyebrow">Top misconceptions surfacing</span>
          ${misBody}
        </div>
      </div>
    </section>
  </div>`;
}

function yourSections() {
  const mine = mySections();
  const aIdx = activeIdx();
  const recent = MODEL.lessons.slice(0, aIdx + 1).slice(-5);   // assigned/in-progress, last few

  const body = mine.length ? `<div class="mine-grid">${mine.map(sec => {
    const c = cellFor(sec.id, MODEL.activeId);
    const strip = recent.map(L => {
      const cc = cellFor(sec.id, L.id);
      const u = cc.und, col = sColor(u);
      const act = L.id === MODEL.activeId ? 'active-col' : '';
      const title = `Assignment ${L.short} — understanding ${f1(u)}/5 · ${cc.done}/${cc.total} submitted`;
      return `<div class="us-cell ${act}" title="${esc(title)}">
        <div class="cl">A${esc(L.short)}</div>
        <div class="cv" style="color:${col}">${f1(u)}${u == null ? '' : '<span class="cv-unit">/5</span>'}</div></div>`;
    }).join('');
    return `<div class="sec-card mine">
      <div class="sec-top"><span class="sc-tag">${esc(sec.code)}</span>
        <div class="grow"><div class="sc-meta">${sec.n} student${sec.n === 1 ? '' : 's'}</div>
          ${sec.instructorName ? `<div class="sc-instr">${esc(sec.instructorName)}</div>` : ''}</div>
        <span class="you-badge">You</span></div>
      <div class="sec-stats">
        <div class="minstat"><div class="mv">${Math.round(c.pct * 100)}%</div><div class="ml">complete</div></div>
        <div class="minstat"><div class="mv">${f1(c.effort)}</div><div class="ml">avg effort</div></div>
        <div class="minstat"><div class="mv">${f1(c.und)}</div><div class="ml">understanding</div></div>
        <div class="minstat"><div class="mv ${c.flags ? 'flag' : ''}">${c.flags}</div><div class="ml">flagged</div></div>
      </div>
      <div class="strip-eyebrow">Understanding by assignment</div>
      <div class="us-strip">${strip}</div>
    </div>`;
  }).join('')}</div>`
    : `<div class="muted" style="font-size:0.86em">${dir()
        ? "You aren't personally assigned to any sections in this course — use the all-sections view below."
        : "You don't have any sections yet."}</div>`;

  return `<section class="dash-section">
    <div class="section-head"><h2>🏫 Your section${mine.length === 1 ? '' : 's'}</h2>
      <span class="count-pill">${mine.length}</span></div>
    ${body}
  </section>`;
}

function matrix() {
  const metric = STATE.metric;
  const aIdx = activeIdx();
  const upTo = MODEL.lessons.slice(0, aIdx + 1);   // columns stop at the active lesson
  const colHdr = upTo.map(L => `<th class="lcol ${L.id === MODEL.activeId ? 'active-col' : ''}"
    title="${esc(L.title)}">A${esc(L.short)}</th>`).join('');

  const ordered = [...MODEL.sections].sort((a, b) => (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0));
  const rows = ordered.map((s, i) => {
    const split = (i > 0 && ordered[i - 1].isMine && !s.isMine);
    const cells = upTo.map(L => {
      const c = cellFor(s.id, L.id);
      const act = L.id === MODEL.activeId ? 'active-col' : '';
      if (metric === 'effort' && c.effort == null) {
        const t = NEUTRAL_CELL();
        return `<td class="hcell ${act}" style="background:${t.bg};border-color:${t.bd};color:var(--muted)" title="no effort data">—</td>`;
      }
      const val = metric === 'completion' ? c.pct : c.effort / 5;
      const show = metric === 'completion' ? Math.round(c.pct * 100) : c.effort.toFixed(1);
      const t = tint(val);
      const ttl = metric === 'completion' ? `${c.done}/${c.total} (${Math.round(c.pct * 100)}%)` : `avg effort ${c.effort.toFixed(1)}/5`;
      return `<td class="hcell ${act}" style="background:${t.bg};border-color:${t.bd}" title="${esc(ttl)}">${show}</td>`;
    }).join('');
    const ca = cellFor(s.id, MODEL.activeId);
    return `<tr class="${s.isMine ? 'mine' : ''} ${split ? 'grp-split' : ''}">
      <td class="sticky-l"><span class="mx-sec">${esc(s.code)}</span>${s.instructorName ? ` <span class="mx-instr">· ${esc(s.instructorName)}</span>` : ''}</td>
      <td class="muted">${s.n}</td>
      ${cells}
      <td class="effcell">${f1(ca.effort)}</td>
      <td class="flagcell">${ca.flags ? `<b>${ca.flags}</b>` : `<span class="muted">0</span>`}</td>
    </tr>`;
  }).join('');

  const unit = metric === 'completion' ? '% complete per assignment' : 'avg effort (0–5) per assignment';
  const aShort = MODEL.lessons[aIdx]?.short || '';
  return `<details class="matrix">
    <summary>
      <span class="sum-chev">▸</span>
      <h2 style="font-size:1.12em;font-weight:700;margin:0">All sections — completion &amp; engagement</h2>
      <span class="count-pill">${MODEL.sections.length}</span>
      <span class="dir-only">Director view</span>
      <span class="grow"></span>
      <span class="muted" style="font-size:0.82em">collapsed by default</span>
    </summary>
    <div class="card matrix-card">
      <div class="matrix-toolbar">
        <span class="eyebrow" style="margin:0">Section × assignment · ${unit}</span>
        <span class="grow"></span>
        <div class="legend"><span>low</span>
          <span class="ramp"><span style="background:${tint(0).bg}"></span><span style="background:${tint(.25).bg}"></span><span style="background:${tint(.5).bg}"></span><span style="background:${tint(.75).bg}"></span><span style="background:${tint(1).bg}"></span></span>
          <span>high</span></div>
        <div class="seg" id="metricSeg">
          <button data-metric="completion" aria-pressed="${metric === 'completion'}">Completion</button>
          <button data-metric="effort"     aria-pressed="${metric === 'effort'}">Avg effort</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="mx">
          <thead><tr>
            <th class="sticky-l" style="text-align:left">Section</th>
            <th>Students</th>
            ${colHdr}
            <th title="Active assignment — average effort">Effort·A${esc(aShort)}</th>
            <th title="Active assignment — students flagged">Flags·A${esc(aShort)}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </details>`;
}

/* ── re-render that preserves transient UI state ────────────────────────────── */
function rerender() {
  const open = !!ROOT.querySelector('details.matrix[open]');
  render();
  if (open) { const d = ROOT.querySelector('details.matrix'); if (d) d.open = true; }
}

/* ── wiring ─────────────────────────────────────────────────────────────────── */
function wire() {
  const ss = ROOT.querySelector('#scopeSeg');
  if (ss) ss.querySelectorAll('button').forEach(b => b.onclick = () => { STATE.scope = b.dataset.scope; rerender(); });

  const ssel = ROOT.querySelector('#scopeSel');
  if (ssel) ssel.onchange = () => { STATE.scope = ssel.value; rerender(); };

  const ms = ROOT.querySelector('#metricSeg');
  if (ms) ms.querySelectorAll('button').forEach(b => b.onclick = (e) => { e.preventDefault(); STATE.metric = b.dataset.metric; rerender(); });

  ROOT.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    const i = lessonIdx(STATE.viewLesson);
    const ni = b.dataset.nav === 'prev' ? i - 1 : i + 1;
    if (ni >= 0 && ni < MODEL.lessons.length) { STATE.viewLesson = MODEL.lessons[ni].id; rerender(); }
  });

  // Absent on the current preflight — there is nowhere for it to go, so it is not drawn at all
  // (renderSpotlight). The null check is the whole guard; the disabled state it used to carry is
  // gone with the header button it belonged to.
  const td = ROOT.querySelector('[data-today]');
  if (td) td.onclick = () => { STATE.viewLesson = MODEL.activeId; rerender(); };

  setupWings();
}

/* Reveal a nav wing only when the cursor is near that edge of the spotlight box. */
function setupWings() {
  const shell = ROOT.querySelector('.spot-shell'); if (!shell) return;
  const left = shell.querySelector('.spot-arrow.left');
  const right = shell.querySelector('.spot-arrow.right');
  if (window.__cpWingMove) document.removeEventListener('mousemove', window.__cpWingMove);
  let raf = null;
  const handler = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const r = shell.getBoundingClientRect();
      const T = 130;                                          // proximity reach, inside the box
      const band = e.clientY >= r.top - 24 && e.clientY <= r.bottom + 24;
      const nearL = band && e.clientX >= r.left - 60 && e.clientX <= r.left + T;
      const nearR = band && e.clientX <= r.right + 60 && e.clientX >= r.right - T;
      if (left)  left.classList.toggle('show', nearL && !left.disabled);
      if (right) right.classList.toggle('show', nearR && !right.disabled);
    });
  };
  window.__cpWingMove = handler;
  document.addEventListener('mousemove', handler, { passive: true });
}

/* Re-render once when the theme flips, because the matrix heatmap tints are computed in JS
   (theme-aware hsl) and won't otherwise update. Wired once per page. */
function wireGlobalObservers() {
  if (_observersWired) return;
  _observersWired = true;
  let last = document.documentElement.getAttribute('data-theme');
  new MutationObserver(() => {
    const now = document.documentElement.getAttribute('data-theme');
    if (now !== last) { last = now; if (MODEL && MODEL.lessons?.length) rerender(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
