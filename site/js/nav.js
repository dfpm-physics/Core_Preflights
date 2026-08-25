// nav.js — renders the shared top navigation bar for every authenticated page.
//
// renderNav(ctx, { active, onCourseChange, mount }) injects the bar into `mount`
// (default: <header id="topnav">). Links are role-appropriate; faculty get a course
// switcher (when they have >1 course) that calls ctx.setCurrentCourse + onCourseChange.
//
// Help lives in the user dropdown rather than the main nav: it is a reference surface, not a
// place work happens, and the nav bar is reserved for the latter. `help.html` is a bare filename
// for the same reason the role links are — both student/ and faculty/ have one, and each shows
// the topics that role may see (js/help.js). System joined it there on 2026-07-30, and the test
// views on 2026-08-01 — the dropdown's contents are USER_MENU_LINKS, which says why for each.

import { iconHTML, initials, esc } from './util.js';
import { updateToggleButtons } from './theme.js';
import { mountRunBanners } from './run-banner.js';
import { mountFeedback } from './feedback.js';

// All nav-rendering pages live one level deep (student/ , faculty/), so same-role links are
// bare filenames. The nav no longer links out to the legacy site at all (see FACULTY_LINKS).
// The legacyUrl() helper it used to need was deleted with those pages at the 2026-07-28
// promotion; nothing links to the legacy tree because the legacy tree is gone.
// Students navigate by ASSIGNMENT, not by modality. Listing "Assignments" and "Interactions"
// side by side showed a choice assignment twice — as two separate mandatory items — with nothing
// saying they were alternatives (STUDENT-LESSON-VIEW.md §1). assignments.html still exists as
// the written-preflight surface, reached from an assignment; it is titled "Written preflights"
// so it does not collide with the nav entry below, which is the assignment LIST (lessons.html).
// interactions.html was deleted 2026-07-20.
const STUDENT_LINKS = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard',   emoji: '🏠' },
  { key: 'lessons',   label: 'Assignments', href: 'lessons.html', icon: 'assignments', emoji: '📚' },
];
// Report (the lesson rollup) is intentionally absent: it is reached only via a link carrying its
// lesson key (?i=) — from an Interactions card or the dashboard's "Open full rollup →".
//
// GRADE IS ABSENT TOO, as of 2026-07-23 (P1.14), and this is the one removal that will look like a
// mistake. It is not. Grading is not a place you browse to, it is work that arrives: the dashboard's
// due-out row already carries "N · Review grades" and "N · Review AI grades" boxes that link
// straight here, and the Grade page's own queue now names the students waiting. A permanent nav
// entry beside them said "go and check whether you owe anything", which is the question those boxes
// answer without being asked. grade.html is unchanged and still reachable — from the due-out boxes,
// from the queue, from the gradebook, and by URL — it simply is not a destination on the bar.
//
// Lessons is not director-gated — instructors get a read-only view of published lessons
// (faculty-lessons.js filters to is_published; the page gates every authoring control on isDirector).
// Two links were removed on 2026-07-20:
//   Interactions — the page was deleted. A lesson is now an assignment offering, so a standalone
//     interaction cannot exist and the page's authoring half was unbuildable. Its read side lives
//     on in the lesson rollup (faculty/report.html, reached from the dashboard).
//   Admin — pointed at the legacy site/admin.html, which reads schema `public`. Now that the portal
//     writes to `app`, that page shows stale data and edits made there never reach students, so
//     linking to it from the portal was actively misleading.
// That gap (Export + staff management, which lived ONLY on legacy admin.html) is closed by the
// native faculty/admin.html — director-gated, reading `app`. PLAN-2026-07-16-ADMIN.md T1.1.
//
// System is a SEPARATE destination gated on is_global_admin, not on director. The split is a
// permission boundary, not tidiness: creating an offering means appointing its director, i.e.
// minting course-level authority, which a director must not be able to do for themselves.
// Exported for tests. Which pages the bar offers, and to whom, is a decision that has been quietly
// wrong before (Admin pointing at a legacy page reading the wrong schema), and it is the kind of
// thing nobody notices until a role that should not see a link does. String in, no DOM needed.
export const FACULTY_LINKS = [
  { key: 'dashboard',    label: 'Dashboard',    href: 'dashboard.html',         icon: 'dashboard',     emoji: '🏠' },
  // Ungated: an instructor sees their own sections, resolved from ctx.sectionIds and enforced by
  // RLS. It is not a director surface — "how is my section doing across the term" is the ordinary
  // question this answers.
  //
  // student.html is deliberately ABSENT from this list. It is a drill-down reached by clicking a
  // name, exactly as report.html is, and a nav entry for it would have nothing to point at.
  { key: 'gradebook',    label: 'Gradebook',    href: 'gradebook.html',         icon: 'progress',      emoji: '📊' },
  // NO Roster or Enrollment entry. Both were standalone pages for a few hours on 2026-07-23
  // (roadmap P1.9) and are now the **Students** tab of Course Admin — one page, one nav entry, and
  // the tab sits beside Staff and Export because "who is in this offering" and "who runs it" are
  // the same visit. Two nav entries for one job was the cost that made the split not worth it.
  // Label, not path. The page is the term's list of assignment offerings, which is what the
  // schema calls them; the FILE stays `lessons.html` because `site/faculty/lessons.html` is a
  // frozen contract URL (CORE.md §6) that AI-generated prefill links target — renaming it would
  // break every deployed artifact. Same for the student list.
  { key: 'lessons',      label: 'Assignments',  href: 'lessons.html',           icon: 'assignments',   emoji: '📚' },
  // NO Extensions entry. It was its own destination from 2026-07-22 until 2026-07-30, on the
  // argument that a recurring review should not be buried inside an administrative page. The
  // director's call reverses that: it is the **Extensions tab of Course Admin** now, beside
  // Students, Staff and Export. The argument was about being *found*, and a tab on the page a
  // director already opens to look at staffing is found; a fifth entry on the bar is the cost
  // P1.9 already established the bar cannot keep paying. `extensions.html` survives as a redirect
  // into that tab so nobody's bookmark breaks.
  { key: 'admin',        label: 'Admin',        href: 'admin.html',             icon: 'settings',      emoji: '⚙️', directorOnly: true },
  // Site admins only, matching the RLS on app.feedback (is_admin()). The nav entry is convenience,
  // not the boundary — a director who types the URL gets an empty list from the database.
  //
  // Feedback stays on the bar and System does not, though both are adminOnly — see USER_MENU_LINKS
  // for why they are opposite kinds of thing.
  { key: 'feedback',     label: 'Feedback',     href: 'feedback.html',          icon: 'info',          emoji: '💬', adminOnly: true },
];

/* ── The user menu's own destinations ─────────────────────────────────────────
 * Account and Help have always lived here. SYSTEM JOINED THEM 2026-07-30, off the bar.
 *
 * The bar states where the work of running a COURSE happens, and `system.html` is not that: it
 * administers the things courses are made OF — offerings, terms, people, raw tables — and it is
 * opened when something needs setting up or repairing, not while teaching. It is also the one
 * destination the course picker beside it does not apply to, because it reaches across every
 * course at once. Sitting on the bar it read as a peer of Gradebook and Assignments, which it is
 * not, and it read that way permanently for the handful of people who hold the flag.
 *
 * FEEDBACK STAYS ON THE BAR, though it carries the same `adminOnly` gate. It is the opposite kind
 * of thing: a queue that accumulates work and wants checking, which is what a bar entry is for.
 * The gate is the same; what the two pages ARE is not.
 *
 * Exported and pure for the same reason FACULTY_LINKS is — who sees which destination has been
 * quietly wrong before, and it is invisible from every other end of the app.
 */
export const USER_MENU_LINKS = [
  { key: 'account', label: 'Account', href: 'account.html', icon: 'user', emoji: '👤' },
  { key: 'help',    label: 'Help',    href: 'help.html',    icon: 'info', emoji: '❔' },
  /* Artifacts — the library of built interactive lessons and what went into each.
   *
   * IN THE MENU, NOT ON THE BAR, and that is this file's own argument rather than a new one: the
   * bar states where the work of running a COURSE happens, and P1.9 already established that it
   * cannot keep paying for a further entry — Roster, Enrollment and Extensions each came off it.
   * This is a reference surface opened when building or registering a lesson, not while teaching,
   * which is the same shape as System.
   *
   * `facultyOnly` but NOT `adminOnly`: Storage read is gated on app.is_staff(), because an
   * instructor teaching a section has a legitimate reason to see what their cadets are about to
   * work through. WRITING a review is director-only and enforced by the bucket policy, not here —
   * the page renders the decisions read-only for everybody else. The gate below is
   * discoverability; RLS is the boundary. */
  { key: 'artifacts', label: 'Artifacts', href: 'artifacts.html', icon: 'interactions', emoji: '🧪',
    facultyOnly: true },
  /* Tutor errors -- every failure a cadet actually saw in a backup (Gemini) lesson.
   *
   * `facultyOnly` but NOT `adminOnly`, which was asked for explicitly: instructors,
   * directors and admins all read it, and RLS (migration app/020) is what enforces that. An
   * instructor needs it precisely because the useful question is comparative -- is lesson 14
   * failing for everyone, or only for my section? -- and a per-section slice cannot answer it.
   *
   * It sits beside Artifacts rather than on the bar: like Artifacts it is a reference surface
   * opened when something has gone wrong, not while teaching. */
  { key: 'tutor-errors', label: 'Tutor errors', href: 'tutor-errors.html',
    icon: 'info', emoji: '⚠️', facultyOnly: true },
  // Separated by a rule above it: it is a different tier from "your own account", and running the
  // two together is how somebody lands on the raw table browser looking for their password.
  { key: 'system',  label: 'System',  href: 'system.html',  icon: 'settings', emoji: '🛠️',
    adminOnly: true, facultyOnly: true, groupBefore: true },
  /* Test & mockup views — `tests/index.html`, the landing page for everything under `tests/`.
   *
   * IT IS NOT PART OF THE APP, which is the whole reason it is here rather than on the bar and why
   * it opens in a NEW TAB. The bar states where the work of running a course happens; these are
   * design sandboxes and mockups that touch no live data, and following one should not cost an
   * admin the page they were on.
   *
   * The href is the only one in either list that is not a bare filename. Every other destination
   * is a sibling under student/ or faculty/; this one climbs to the repo root, which resolves the
   * same locally (`python -m http.server` from the root) and on Pages, where the site is served
   * from `/Core_Preflights/site/` and so the tests tree is `/Core_Preflights/tests/`.
   *
   * Gated on the GLOBAL flag, like System — the sandboxes carry their own director gate
   * (tests/browser/guard.js), so this is discoverability, not the boundary. */
  { key: 'tests',   label: 'Test views', href: '../../tests/index.html', icon: 'beaker', emoji: '🧪',
    adminOnly: true, facultyOnly: true, external: true },
];

/** What this caller may see in the dropdown. Same gate vocabulary as FACULTY_LINKS. */
export function userMenuLinks(ctx) {
  return USER_MENU_LINKS
    .filter(l => !l.facultyOnly || ctx?.role === 'faculty')
    .filter(l => !l.adminOnly || ctx?.instructorRow?.is_global_admin)
    .filter(l => !l.directorOnly || ctx?.isDirectorForCurrent?.());
}

/* ── Course-view picker ────────────────────────────────────────────────────────
 * Lives on the BRAND, as a dropdown hanging off the course name beside "PREP".
 *
 * It used to live in the user menu, on the reasoning that course is context rather than a
 * destination and the user menu is where context lives. That reasoning still holds — what it
 * missed is that the course name was ALREADY printed beside the wordmark on every page, so the
 * label and the control that changes it sat at opposite ends of the nav bar. Making the label
 * itself the control is the shorter path to the same idea: the thing you read is the thing you
 * click. (The dashboard briefly grew its own inline switcher for the same discoverability
 * reason; that one is gone now — see faculty-dashboard.js.)
 *
 * It replaced the older `.course-switch` pill row, which the term axis made untenable: a flat
 * row of pills cannot express one course offered across several semesters, and it only appeared
 * at all when someone held more than one course.
 *
 * Offered to ANY role with more than one offering — a student enrolled in two courses
 * needs this for the same reason a system administrator does. It grants no access:
 * the list is whatever RLS already allowed auth.js to resolve, so switching can only
 * ever reach a course the caller could already read.
 *
 * Exported and pure (string in, string out) so it can be unit-tested without a DOM.
 */

/** The option rows themselves — term subheadings + one `.course-opt` per offering. '' for <2. */
export function courseOptionsHTML(ctx) {
  const courses = ctx.courses || [];
  if (courses.length < 2) return '';                    // nothing to switch between

  const spansTerms = new Set(courses.map(c => c.termCode)).size > 1;
  const roleWord = (c) => ctx.instructorRow?.is_global_admin
    ? 'Admin' : c.role ? c.role[0].toUpperCase() + c.role.slice(1) : '';

  // Group by term. auth.js already sorted newest term first, so insertion order is right.
  const byTerm = new Map();
  courses.forEach(c => {
    const key = c.termLabel || c.termCode || '';
    if (!byTerm.has(key)) byTerm.set(key, []);
    byTerm.get(key).push(c);
  });

  const option = (c) => {
    const active = c.offeringId === ctx.currentOffering;
    // When the term is already a heading above, repeating it on every row is noise.
    const sub = [spansTerms ? null : c.termLabel, roleWord(c)].filter(Boolean).join(' · ');
    return `
      <button class="menu-item course-opt${active ? ' active' : ''}" role="menuitemradio"
              aria-checked="${active}" data-course="${esc(c.offeringId)}">
        <span class="co-check" aria-hidden="true">${active ? '✓' : ''}</span>
        <span class="co-body">
          <span class="co-title">${esc(c.courseTitle || c.courseCode)}</span>
          ${sub ? `<span class="co-sub">${esc(sub)}</span>` : ''}
        </span>
      </button>`;
  };

  return [...byTerm.entries()].map(([term, list]) =>
    (spansTerms && term ? `<div class="menu-subhead">${esc(term)}</div>` : '') +
    list.map(option).join('')).join('');
}

/**
 * The brand-mounted picker: the course name beside "PREP", as a button with a dropdown.
 *
 * With a single course it degrades to the plain `.brand-sub` label it has always been — a
 * dropdown holding one option is a label pretending to be a control, and the caret would
 * promise a choice that does not exist.
 */
function brandCourseHTML(ctx, courseTitle) {
  if (!courseTitle) return '';
  const opts = courseOptionsHTML(ctx);
  if (!opts) return `<span class="brand-sub">${esc(courseTitle)}</span>`;
  return `
    <span class="course-menu">
      <button class="brand-sub course-btn" data-course-toggle aria-haspopup="true"
              aria-expanded="false" aria-controls="course-menu-pop"
              title="Switch course">
        <span class="cb-name">${esc(courseTitle)}</span><span class="cb-caret" aria-hidden="true">▾</span>
      </button>
      <div class="menu-pop course-pop" id="course-menu-pop" role="menu">
        <div class="menu-label">Course view</div>
        <div class="menu-scroll">${opts}</div>
      </div>
    </span>`;
}

export function renderNav(ctx, opts = {}) {
  const { active = '', onCourseChange } = opts;
  const mount = opts.mount || document.getElementById('topnav') || (() => {
    const h = document.createElement('header'); h.id = 'topnav';
    document.body.insertBefore(h, document.body.firstChild); return h;
  })();

  const links = (ctx.role === 'faculty' ? FACULTY_LINKS : STUDENT_LINKS)
    .filter(l => !l.directorOnly || ctx.isDirectorForCurrent?.())
    // adminOnly is the global flag, NOT a director of the current course — the two are
    // different powers and a director must not inherit the system tier by switching course.
    .filter(l => !l.adminOnly || ctx.instructorRow?.is_global_admin);
  const name = ctx.studentRow?.name || ctx.instructorRow?.name || 'Account';
  const roleLabel = ctx.role === 'faculty'
    ? (ctx.instructorRow?.is_global_admin ? 'Global admin'
        : ctx.isDirectorForCurrent?.() ? 'Director' : 'Instructor')
    : 'Student';
  const courseTitle = ctx.currentOffering ? ctx.courseTitleOf(ctx.currentOffering) : '';

  // Only disambiguate by term when the caller actually spans more than one. Showing
  // "Physics 215 · Fall 2026" to everyone in a single-term deployment is noise.
  const spansTerms = new Set(ctx.courses.map(c => c.termCode)).size > 1;

  const linksHTML = links.map(l => `
    <a class="nav-link${l.key === active ? ' active' : ''}${l.external ? ' external' : ''}"
       href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>
      <span>${esc(l.label)}</span>
    </a>`).join('');

  mount.className = 'topnav';
  mount.innerHTML = `
    <div class="topnav-inner">
      <div class="nav-left">
        <a class="brand" href="dashboard.html"
           title="PREP — Pre-lesson Readiness Engagement Platform · iPREP — interactive PREP, the lesson interactions">
          <span class="brand-mark">${iconHTML('atom', '⚛️', 'ic')}</span>
          <span>PREP<span class="brand-alt"><span class="brand-slash">/</span>iPREP</span><span
            class="brand-lw">Portal</span></span>
        </a>
        ${brandCourseHTML(ctx, courseTitle)}
        <button class="nav-burger" aria-label="Menu" data-burger>${iconHTML('menu', '☰', 'ic')}</button>
      </div>
      <nav class="nav-links" id="nav-links">${linksHTML}</nav>
      <div class="nav-right">
        <button class="theme-toggle" data-theme-toggle><span data-theme-icon>🌙</span></button>
        <div class="user-menu">
          <button class="user-chip" data-user-toggle>
            <span class="avatar">${esc(initials(name))}</span>
            <span class="nm">${esc(name)}</span><span class="caret">▾</span>
          </button>
          <div class="menu-pop" id="user-menu-pop">
            <div class="menu-head">
              <span class="mh-ic">${iconHTML('user', '👤', 'ic')}</span>
              <div><div class="nm">${esc(name)}</div>
                <div class="rl">${esc(roleLabel)}${courseTitle ? ' · ' + esc(courseTitle) : ''}${
                  spansTerms && ctx.currentTermLabel ? ' · ' + esc(ctx.currentTermLabel) : ''}</div></div>
            </div>
            <div class="menu-sep"></div>
            ${userMenuLinks(ctx).map(l => `${l.groupBefore ? '<div class="menu-sep"></div>' : ''}
            <a class="menu-item" href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>
              ${iconHTML(l.icon, l.emoji, 'ic')}<span>${esc(l.label)}${l.external ? ' ↗' : ''}</span>
            </a>`).join('')}
            <div class="menu-sep"></div>
            <button class="menu-item danger" data-signout>
              ${iconHTML('signout', '🚪', 'ic')}<span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  wireNav(ctx, mount, onCourseChange);
  updateToggleButtons();
  renderFooter();

  // Status of the unattended analysis runs, for directors and admins. Deliberately NOT awaited:
  // renderNav is synchronous and every page depends on it, so a slow or failing query must not
  // hold up the chrome. The strip appears a beat later or not at all.
  mountRunBanners(ctx);

  // The floating feedback box, on every signed-in page. Idempotent and un-awaited for the same
  // reason as the banners: it must never hold up the chrome, and it appends its own fixed element
  // to <body> rather than living in the nav.
  mountFeedback(ctx);
}

/* ── Legacy Actions ────────────────────────────────────────────────────────────
 * A floating, collapsible panel for surfaces that still work but are on their way out.
 *
 * WHY IT EXISTS RATHER THAN A NAV LINK
 *   The nav bar states where work happens. A page that is being retired does not belong
 *   there — listing it says "this is a normal part of the job" of something we intend to
 *   delete. Demoting these to a labelled, director-only panel keeps them reachable while
 *   being honest that they are legacy.
 *
 * DIRECTOR AND ABOVE ONLY. This is a presentation gate, not a security boundary — the
 * pages themselves are RLS-gated. It exists so instructors are not sent to surfaces whose
 * data or lifetime they should not have to reason about.
 *
 * @param {object} ctx
 * @param {Array<{href, label, note?, emoji?}>} items
 */
export function mountLegacyActions(ctx, items = []) {
  if (!ctx?.isDirectorForCurrent?.()) return;          // director / global admin only
  if (!items.length) return;
  if (document.getElementById('legacy-actions')) return;   // idempotent

  const LS_KEY = 'cp.legacyActions.open';
  let open = false;
  try { open = localStorage.getItem(LS_KEY) === '1'; } catch (_) {}

  const el = document.createElement('aside');
  el.id = 'legacy-actions';
  el.className = 'legacy-actions' + (open ? ' open' : '');
  el.setAttribute('aria-label', 'Legacy actions');
  el.innerHTML = `
    <button class="la-toggle" data-la-toggle aria-expanded="${open}" aria-controls="la-body">
      <span class="la-dot" aria-hidden="true"></span>
      <span class="la-title">Legacy Actions</span>
      <span class="la-caret" aria-hidden="true">▾</span>
    </button>
    <div class="la-body" id="la-body">
      <p class="la-note">Older views kept while their replacements are built.</p>
      ${items.map(i => `
        <a class="la-item" href="${esc(i.href)}"${i.external ? ' target="_blank" rel="noopener"' : ''}>
          <span class="la-ic" aria-hidden="true">${esc(i.emoji || '↗')}</span>
          <span class="la-body-text">
            <span class="la-label">${esc(i.label)}${i.external ? ' ↗' : ''}</span>
            ${i.note ? `<span class="la-sub">${esc(i.note)}</span>` : ''}
          </span>
        </a>`).join('')}
    </div>`;

  document.body.appendChild(el);

  const toggle = el.querySelector('[data-la-toggle]');
  toggle.addEventListener('click', () => {
    const nowOpen = !el.classList.contains('open');
    el.classList.toggle('open', nowOpen);
    toggle.setAttribute('aria-expanded', String(nowOpen));
    try { localStorage.setItem(LS_KEY, nowOpen ? '1' : '0'); } catch (_) {}
  });
}

/**
 * Site footer with the required Flaticon attribution. Idempotent — safe to call again.
 *
 * It also spells out both acronyms. The bar can only afford the marks themselves, so the footer
 * is where "PREP" and "iPREP" are actually DEFINED — once per page, for the instructor who has
 * never been told what the letters are. Keep the two expansions here if the wordmark changes
 * again; a bar that names something it never defines is the problem this pair was chosen to fix.
 */
export function renderFooter() {
  if (document.getElementById('site-footer')) return;
  const f = document.createElement('footer');
  f.id = 'site-footer';
  f.className = 'site-footer';
  f.innerHTML = `
    <div class="footer-inner">
      <span>PREP — <span class="fx">Pre-lesson Readiness Engagement Platform</span>
        · iPREP — <span class="fx">interactive PREP, the lesson interactions</span>
        · USAFA Physics</span>
      <span class="grow"></span>
      <span>Icons by
        <a href="https://www.flaticon.com/authors/freepik" target="_blank" rel="noopener">Freepik</a>
        on <a href="https://www.flaticon.com/" target="_blank" rel="noopener">Flaticon</a></span>
    </div>`;
  document.body.appendChild(f);
}

function wireNav(ctx, mount, onCourseChange) {
  // Mobile menu
  mount.querySelector('[data-burger]')?.addEventListener('click', () => {
    mount.querySelector('#nav-links')?.classList.toggle('open');
  });

  // User dropdown (toggle + outside-click close)
  const chip = mount.querySelector('[data-user-toggle]');
  const pop = mount.querySelector('#user-menu-pop');
  chip?.addEventListener('click', (e) => { e.stopPropagation(); pop?.classList.toggle('open'); });
  document.addEventListener('click', (e) => {
    if (pop && !pop.contains(e.target) && e.target !== chip) pop.classList.remove('open');
  });

  // Course dropdown on the brand. Same open/close contract as the user menu, and the two are
  // mutually exclusive — two panels open at once over a 64px bar is never what was meant.
  const cbtn = mount.querySelector('[data-course-toggle]');
  const cpop = mount.querySelector('#course-menu-pop');
  const closeCourse = () => {
    cpop?.classList.remove('open');
    cbtn?.setAttribute('aria-expanded', 'false');
  };
  cbtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    pop?.classList.remove('open');
    const open = !cpop.classList.contains('open');
    cpop.classList.toggle('open', open);
    cbtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (cpop && !cpop.contains(e.target) && !cbtn?.contains(e.target)) closeCourse();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCourse(); });

  // Sign out
  mount.querySelector('[data-signout]')?.addEventListener('click', () => ctx.signOut());

  // Course switcher
  // Course-view picker. setCurrentOffering is async — it re-resolves the section scope for
  // the newly selected offering — so the page callback must WAIT for it, or the page reloads
  // its data against the previous offering's sections and silently shows the wrong course.
  mount.querySelectorAll('.course-opt').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();                       // don't let the outside-click handler close it yet
      const id = btn.dataset.course;
      if (id === ctx.currentOffering) { pop?.classList.remove('open'); closeCourse(); return; }

      btn.classList.add('busy');
      await ctx.setCurrentOffering(id);

      mount.querySelectorAll('.course-opt').forEach(p => {
        const on = p.dataset.course === id;
        p.classList.toggle('active', on);
        p.setAttribute('aria-checked', String(on));
        const tick = p.querySelector('.co-check');
        if (tick) tick.textContent = on ? '✓' : '';
      });
      btn.classList.remove('busy');

      // Keep the two places the course is named in step with the new selection.
      const sub = mount.querySelector('.cb-name') || mount.querySelector('.brand-sub');
      if (sub) sub.textContent = ctx.courseTitleOf(id);
      const rl = mount.querySelector('.menu-head .rl');
      if (rl) {
        const c = ctx.courses.find(x => x.offeringId === id);
        rl.textContent = [
          ctx.instructorRow?.is_global_admin ? 'Global admin'
            : ctx.isDirectorForCurrent?.() ? 'Director' : (ctx.role === 'faculty' ? 'Instructor' : 'Student'),
          ctx.courseTitleOf(id),
          c?.termLabel,
        ].filter(Boolean).join(' · ');
      }

      pop?.classList.remove('open');
      closeCourse();
      onCourseChange?.(id);
    });
  });
}
