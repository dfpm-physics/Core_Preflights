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

import { iconHTML, initials, esc, legacyUrl } from './util.js';
import { updateToggleButtons } from './theme.js';

// All nav-rendering pages live one level deep (student/ , faculty/), so same-role links
// are bare filenames; legacy out-links use legacyUrl() so they resolve in both phases.
// Students navigate by LESSON, not by modality. Listing "Assignments" and "Interactions"
// side by side showed a choice lesson twice — as two separate mandatory items — with nothing
// saying they were alternatives (STUDENT-LESSON-VIEW.md §1). assignments.html still exists as
// the written-preflight surface, reached from a lesson; interactions.html is superseded.
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
const FACULTY_LINKS = [
  { key: 'dashboard',    label: 'Dashboard',    href: 'dashboard.html',         icon: 'dashboard',     emoji: '🏠' },
  { key: 'grade',        label: 'Grade',        href: 'grade.html',             icon: 'grades',        emoji: '✅' },
  { key: 'roster',       label: 'Roster',       href: 'roster.html',            icon: 'roster',        emoji: '🧑‍🎓', directorOnly: true },
  { key: 'lessons',      label: 'Lessons',      href: 'lessons.html',           icon: 'assignments',   emoji: '📚' },
  { key: 'interactions', label: 'Interactions', href: 'interactions.html',      icon: 'interactions',  emoji: '💡' },
  { key: 'admin',        label: 'Admin',        href: legacyUrl('admin.html'),  icon: 'settings',      emoji: '⚙️', external: true },
];

export function renderNav(ctx, opts = {}) {
  const { active = '', onCourseChange } = opts;
  const mount = opts.mount || document.getElementById('topnav') || (() => {
    const h = document.createElement('header'); h.id = 'topnav';
    document.body.insertBefore(h, document.body.firstChild); return h;
  })();

  const links = (ctx.role === 'faculty' ? FACULTY_LINKS : STUDENT_LINKS)
    .filter(l => !l.directorOnly || ctx.isDirectorForCurrent?.());
  const name = ctx.studentRow?.name || ctx.instructorRow?.name || 'Account';
  const roleLabel = ctx.role === 'faculty'
    ? (ctx.instructorRow?.is_global_admin ? 'Global admin'
        : ctx.isDirectorForCurrent?.() ? 'Director' : 'Instructor')
    : 'Student';
  const courseTitle = ctx.currentOffering ? ctx.courseTitleOf(ctx.currentOffering) : '';

  // Only disambiguate by term when the caller actually spans more than one. Showing
  // "Physics 215 · Fall 2026" to everyone in a single-term deployment is noise.
  const spansTerms = new Set(ctx.courses.map(c => c.termCode)).size > 1;
  const pillLabel = (c) =>
    (c.courseTitle || c.courseCode) + (spansTerms && c.termLabel ? ` · ${c.termLabel}` : '');

  const linksHTML = links.map(l => `
    <a class="nav-link${l.key === active ? ' active' : ''}${l.external ? ' external' : ''}"
       href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>
      <span>${esc(l.label)}</span>
    </a>`).join('');

  // Faculty course switcher (only when more than one course is accessible)
  const switcherHTML = (ctx.role === 'faculty' && ctx.courses.length > 1) ? `
    <div class="course-switch" role="tablist" aria-label="Course">
      <span class="cs-ic">${iconHTML('course', '📚', 'ic')}</span>
      ${ctx.courses.map(c => `
        <button class="course-pill${c.offeringId === ctx.currentOffering ? ' active' : ''}"
          data-course="${esc(c.offeringId)}">${esc(pillLabel(c))}</button>`).join('')}
    </div>` : '';

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
        ${switcherHTML}
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
                <div class="rl">${esc(roleLabel)}${courseTitle ? ' · ' + esc(courseTitle) : ''}</div></div>
            </div>
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
  // Course switcher. setCurrentOffering is async — it re-resolves the section scope for the
  // newly selected offering — so the page callback must wait for it, or the page would reload
  // its data against the previous offering's sections.
  mount.querySelectorAll('.course-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.course;
      if (id === ctx.currentOffering) return;
      await ctx.setCurrentOffering(id);
      mount.querySelectorAll('.course-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.course === id));
      // Refresh the brand subtitle to the newly selected course.
      const sub = mount.querySelector('.brand-sub');
      if (sub) sub.textContent = ctx.courseTitleOf(id);
      onCourseChange?.(id);
    });
  });
}
