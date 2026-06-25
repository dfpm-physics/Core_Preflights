// nav.js — renders the shared top navigation bar for every authenticated page.
//
// renderNav(ctx, { active, onCourseChange, mount }) injects the bar into `mount`
// (default: <header id="topnav">). Links are role-appropriate; faculty get a course
// switcher (when they have >1 course) that calls ctx.setCurrentCourse + onCourseChange.

import { iconHTML, initials, esc, legacyUrl } from './util.js';
import { updateToggleButtons } from './theme.js';

// All nav-rendering pages live one level deep (student/ , faculty/), so same-role links
// are bare filenames; legacy out-links use legacyUrl() so they resolve in both phases.
const STUDENT_LINKS = [
  { key: 'dashboard',    label: 'Dashboard',    href: 'dashboard.html',    icon: 'dashboard',    emoji: '🏠' },
  { key: 'assignments',  label: 'Assignments',  href: 'assignments.html',  icon: 'assignments',  emoji: '📋' },
  { key: 'interactions', label: 'Interactions', href: 'interactions.html', icon: 'interactions', emoji: '💡' },
];
// Grade and Report are intentionally absent: Grade is reached from Roster, and Report (the lesson
// rollup) is reached only via a link carrying its lesson key (?i=) — from an Interactions card or
// the dashboard's "Open full rollup →".
const FACULTY_LINKS = [
  { key: 'dashboard',    label: 'Dashboard',    href: 'dashboard.html',         icon: 'dashboard',     emoji: '🏠' },
  { key: 'roster',       label: 'Roster',       href: 'roster.html',            icon: 'roster',        emoji: '🧑‍🎓', directorOnly: true },
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
  const courseTitle = ctx.currentCourse ? ctx.courseTitleOf(ctx.currentCourse) : '';

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
        <button class="course-pill${c.course_id === ctx.currentCourse ? ' active' : ''}"
          data-course="${esc(c.course_id)}">${esc(c.course_title || c.course_id)}</button>`).join('')}
    </div>` : '';

  mount.className = 'topnav';
  mount.innerHTML = `
    <div class="topnav-inner">
      <div class="nav-left">
        <a class="brand" href="dashboard.html" title="iPREP — interactive Pre-lesson Readiness Engagement Platform">
          <span class="brand-mark">${iconHTML('atom', '⚛️', 'ic')}</span>
          <span>iPREP${courseTitle ? `<span class="brand-sub">${esc(courseTitle)}</span>` : ''}</span>
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
      <span>iPREP · USAFA Physics</span>
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
  mount.querySelectorAll('.course-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.course;
      if (id === ctx.currentCourse) return;
      ctx.setCurrentCourse(id);
      mount.querySelectorAll('.course-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.course === id));
      // Refresh the brand subtitle to the newly selected course.
      const sub = mount.querySelector('.brand-sub');
      if (sub) sub.textContent = ctx.courseTitleOf(id);
      onCourseChange?.(id);
    });
  });
}
