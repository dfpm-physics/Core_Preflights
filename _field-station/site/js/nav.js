// Field Station overlay of site/js/nav.js.
//
// It does not copy the real navigation. `./nav-base.js` is the real site/js/nav.js (the overlay
// server serves it under that name), so every export, every link and every role gate comes from
// there unchanged. This file re-exports all of it, replaces only renderNav, and after the real
// one has built the bar it dresses the result for the left rail: an icon on each link, a Help
// row, a short descriptor under the wordmark, and the context bar (real section, today's date).
//
// Merging a change to site/js/nav.js later needs nothing here unless renderNav's markup changes.

import { renderNav as baseRenderNav, visibleNavLinks } from './nav-base.js';
import { iconHTML, esc } from './util.js';
import { taughtSectionIds } from './schema.js';

export * from './nav-base.js';

const fileOf = (href) => String(href || '').split('/').pop().split('?')[0];

// Staff see every section of an offering they may read, which is not the same as teaching them. The label names only
// sections the person teaches; with none, it names the role and makes no section claim. A student's own sections stand.
function sectionLabel(ctx) {
  const codeOf = (id) => ctx.sectionCodeOf?.(id);
  if (ctx.role === 'faculty') {
    const codes = taughtSectionIds(ctx).map(codeOf).filter(Boolean);
    if (!codes.length) return ctx.isDirectorForCurrent?.() ? 'Director' : 'Staff';
    if (codes.length > 4) return `${codes.length} sections`;
    return `${codes.length === 1 ? 'Section' : 'Sections'} ${codes.join(' · ')}`;
  }
  const codes = (ctx.sectionIds || []).map(codeOf).filter(Boolean);
  if (!codes.length) return '';
  return `${codes.length === 1 ? 'Section' : 'Sections'} ${codes.join(' · ')}`;
}

function contextHTML(ctx) {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const date = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  const course = ctx.currentOffering ? ctx.courseTitleOf(ctx.currentOffering) : '';
  const left = [sectionLabel(ctx), course, ctx.currentIsPast ? 'Past term' : ''].filter(Boolean).join(' · ');
  return `<span class="fs-ctx-left">${esc(left)}</span>
    <time class="fs-ctx-date" datetime="${now.toISOString().slice(0, 10)}">${esc(day)} / ${esc(date)}</time>`;
}

const RAIL_ICON = { gradebook: 'grades', backlog: 'pending-grade', items: 'todo', entry: 'submissions',
  admin: 'roster', terms: 'class', health: 'progress' };

function dress(ctx) {
  const mount = document.getElementById('topnav');
  if (!mount) return;
  mount.classList.add('fs-rail');

  // An icon on every link, taken from the entry the real list already holds for it.
  const byFile = new Map(visibleNavLinks(ctx).map(l => [fileOf(l.href), l]));
  mount.querySelectorAll('.nav-links .nav-link').forEach(a => {
    if (a.querySelector('.ic, .icon-fallback')) return;
    const def = byFile.get(fileOf(a.getAttribute('href')));
    // The real list reuses one icon for several pages (Gradebook and Backlog, Assignments and Grade assignments);
    // the rail gives each of those its own.
    if (def) a.insertAdjacentHTML('afterbegin', iconHTML(RAIL_ICON[def.key] || def.icon, def.emoji, 'ic'));
  });

  // The descriptor under the wordmark. The long names stay in the brand link's title and the footer.
  const left = mount.querySelector('.nav-left');
  if (left && !left.querySelector('.fs-brand-sub')) {
    left.querySelector('.brand')?.insertAdjacentHTML('afterend', '<span class="fs-brand-sub">USAFA Physics</span>');
  }

  // Help sits on the rail itself, above the account row, as a plain link to the page the user menu already names.
  const right = mount.querySelector('.nav-right');
  if (right && !right.querySelector('.fs-help')) {
    right.insertAdjacentHTML('afterbegin',
      `<a class="fs-help" href="help.html">${iconHTML('info', '❔', 'ic')}<span>Help</span></a>`);
  }

  // Context bar: one per page, kept in step when the course changes.
  let bar = document.getElementById('fs-context');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fs-context';
    bar.className = 'fs-context';
    mount.after(bar);
  }
  const paint = () => { bar.innerHTML = contextHTML(ctx); };
  paint();
  new MutationObserver(paint).observe(mount, { subtree: true, childList: true, characterData: true });
}

export function renderNav(ctx, opts = {}) {
  const out = baseRenderNav(ctx, opts);
  dress(ctx);
  return out;
}
