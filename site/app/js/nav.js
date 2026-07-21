// nav.js — renders the shared top navigation bar for every authenticated page.
//
// renderNav(ctx, { active, onCourseChange, mount }) injects the bar into `mount`
// (default: <header id="topnav">). Links are role-appropriate; faculty get a course
// switcher (when they have >1 course) that calls ctx.setCurrentCourse + onCourseChange.
//
// Help lives in the user dropdown rather than the main nav: it is a reference surface, not a
// place work happens, and the nav bar is reserved for the latter. `help.html` is a bare filename
// for the same reason the role links are — both student/ and faculty/ have one, and each shows
// the topics that role may see (js/help.js).

import { iconHTML, initials, esc } from './util.js';
import { updateToggleButtons } from './theme.js';

// All nav-rendering pages live one level deep (student/ , faculty/), so same-role links are
// bare filenames. The nav no longer links out to the legacy site at all (see FACULTY_LINKS),
// so legacyUrl() is not needed here; it remains in util.js for any page that still needs it.
// Students navigate by LESSON, not by modality. Listing "Assignments" and "Interactions"
// side by side showed a choice lesson twice — as two separate mandatory items — with nothing
// saying they were alternatives (STUDENT-LESSON-VIEW.md §1). assignments.html still exists as
// the written-preflight surface, reached from a lesson. interactions.html was deleted 2026-07-20.
const STUDENT_LINKS = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard',   emoji: '🏠' },
  { key: 'lessons',   label: 'Lessons',   href: 'lessons.html',   icon: 'assignments', emoji: '📚' },
];
// Report (the lesson rollup) is intentionally absent: it is reached only via a link carrying its
// lesson key (?i=) — from an Interactions card or the dashboard's "Open full rollup →".
//
// Grade is NOT director-gated: instructors grade their own sections (grade.html resolves scope from
// the role). Lessons is not gated either — instructors get a read-only view of published lessons
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
const FACULTY_LINKS = [
  { key: 'dashboard',    label: 'Dashboard',    href: 'dashboard.html',         icon: 'dashboard',     emoji: '🏠' },
  { key: 'grade',        label: 'Grade',        href: 'grade.html',             icon: 'grades',        emoji: '✅' },
  { key: 'roster',       label: 'Roster',       href: 'roster.html',            icon: 'roster',        emoji: '🧑‍🎓', directorOnly: true },
  { key: 'lessons',      label: 'Lessons',      href: 'lessons.html',           icon: 'assignments',   emoji: '📚' },
  // Extensions is its own destination rather than a panel inside Admin because it is a
  // recurring review, not a one-off administrative action: the director reads it to see how
  // many extensions each instructor is granting and then goes and talks to them. Burying a
  // number someone is meant to check every few weeks inside an export page hides it.
  { key: 'extensions',   label: 'Extensions',   href: 'extensions.html',        icon: 'assignments',   emoji: '📅', directorOnly: true },
  { key: 'admin',        label: 'Admin',        href: 'admin.html',             icon: 'settings',      emoji: '⚙️', directorOnly: true },
  { key: 'system',       label: 'System',       href: 'system.html',            icon: 'settings',      emoji: '🛠️', adminOnly: true },
];

/* ── Course-view picker ────────────────────────────────────────────────────────
 * Lives in the USER MENU, not the nav bar. The nav bar is for destinations; which
 * course you are looking at is context, and context already lives in that menu —
 * its header names you, your role and your course. Putting the control beside the
 * thing it describes is why this is not a separate nav control.
 *
 * It replaces the old `.course-switch` pill row, which the term axis made untenable:
 * a flat row of pills cannot express one course offered across several semesters,
 * and it only appeared at all when someone held more than one course.
 *
 * Offered to ANY role with more than one offering — a student enrolled in two courses
 * needs this for the same reason a system administrator does. It grants no access:
 * the list is whatever RLS already allowed auth.js to resolve, so switching can only
 * ever reach a course the caller could already read.
 *
 * Exported and pure (string in, string out) so it can be unit-tested without a DOM.
 */
export function courseMenuHTML(ctx) {
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

  return `
    <div class="menu-sep"></div>
    <div class="menu-label" id="course-view-label">Course view</div>
    <div class="menu-scroll" role="group" aria-labelledby="course-view-label">
      ${[...byTerm.entries()].map(([term, list]) =>
        (spansTerms && term ? `<div class="menu-subhead">${esc(term)}</div>` : '') +
        list.map(option).join('')).join('')}
    </div>`;
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
  const switcherHTML = courseMenuHTML(ctx);

  const linksHTML = links.map(l => `
    <a class="nav-link${l.key === active ? ' active' : ''}${l.external ? ' external' : ''}"
       href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>
      <span>${esc(l.label)}</span>
    </a>`).join('');

  mount.className = 'topnav';
  mount.innerHTML = `
    <div class="topnav-inner">
      <div class="nav-left">
        <a class="brand" href="dashboard.html" title="PREP — Pre-lesson Readiness Engagement Platform">
          <span class="brand-mark">${iconHTML('atom', '⚛️', 'ic')}</span>
          <span>PREP${courseTitle ? `<span class="brand-sub">${esc(courseTitle)}</span>` : ''}</span>
        </a>
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
            ${switcherHTML}
            ${switcherHTML ? '<div class="menu-sep"></div>' : ''}
            <a class="menu-item" href="account.html">
              ${iconHTML('user', '👤', 'ic')}<span>Account</span>
            </a>
            <a class="menu-item" href="help.html">
              ${iconHTML('info', '❔', 'ic')}<span>Help</span>
            </a>
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

/** Site footer with the required Flaticon attribution. Idempotent — safe to call again. */
export function renderFooter() {
  if (document.getElementById('site-footer')) return;
  const f = document.createElement('footer');
  f.id = 'site-footer';
  f.className = 'site-footer';
  f.innerHTML = `
    <div class="footer-inner">
      <span>PREP · USAFA Physics</span>
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
      if (id === ctx.currentOffering) { pop?.classList.remove('open'); return; }

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
      const sub = mount.querySelector('.brand-sub');
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
      onCourseChange?.(id);
    });
  });
}
