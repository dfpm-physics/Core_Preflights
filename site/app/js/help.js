// help.js — the Help centre. Renders an index of documentation topics the current user is
// allowed to see, and reads any one of them.
//
// Content is NOT in this file and not in the database: it is Markdown under site/app/help/,
// listed in site/app/help/MANIFEST.json. Adding a topic is a file plus a manifest entry — no
// code change. See site/app/help/README.md for the authoring contract.
//
// mountHelp(ctx, root) is called by student/help.html and faculty/help.html, and again on a
// course switch (a director in one course and an instructor in another sees a different set).

import { esc } from './util.js';

// Cumulative tiers, lowest first: a viewer sees their own tier and everything below it.
// A doc's `tier` is the LOWEST role allowed to see it.
const TIERS = ['student', 'instructor', 'director', 'admin'];
const TIER_LABEL = {
  student:    'For everyone',
  instructor: 'For instructors',
  director:   'For course directors',
  admin:      'For system admins',
};
const rank = (tier) => TIERS.indexOf(tier);

// Pages live one level deep (student/ , faculty/), so help content is one climb away.
const HELP_BASE = '../help/';
const MANIFEST_URL = HELP_BASE + 'MANIFEST.json';

let manifestCache = null;   // survives course switches; the filter re-runs, the fetch doesn't
let popstateWired = false;  // mountHelp can run twice; the listener must not stack
let visibleDocs = [];       // latest filtered set — popstate must not close over a stale one

/**
 * The viewer's tier. Global admin is checked FIRST: isDirectorForCurrent() returns true for
 * admins too, so the reverse order would never yield 'admin'.
 */
export function viewerTier(ctx) {
  if (ctx.role !== 'faculty') return 'student';
  if (ctx.instructorRow?.is_global_admin) return 'admin';
  return ctx.isDirectorForCurrent?.() ? 'director' : 'instructor';
}

export async function mountHelp(ctx, root) {
  root.innerHTML = `<div class="center-load"><span class="spinner"></span><span>Loading help…</span></div>`;

  if (!manifestCache) {
    try {
      // no-cache so a freshly pushed doc shows up without a hard reload (same reason as the
      // RAG manifest fetch in faculty/lessons.html).
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifestCache = await res.json();
    } catch (err) {
      root.innerHTML = `<div class="page-head"><h1>Help</h1></div>
        <div class="alert alert-error">Couldn't load the help index (${esc(err.message)}).
        If this persists, tell the course director.</div>`;
      return;
    }
  }

  const mine = rank(viewerTier(ctx));
  visibleDocs = (manifestCache.docs || []).filter(d => {
    const r = rank(d.tier);
    return r >= 0 && r <= mine;      // unknown tier → hidden, never shown by accident
  });

  if (!popstateWired) {
    popstateWired = true;
    // Reads visibleDocs at fire time: a course switch narrows or widens the set, and Back
    // must honour the current one, not the set that existed when the listener was attached.
    window.addEventListener('popstate', () => render(ctx, root, visibleDocs));
  }
  render(ctx, root, visibleDocs);
}

function render(ctx, root, visible) {
  const wanted = new URLSearchParams(location.search).get('doc');
  const doc = wanted ? visible.find(d => d.id === wanted) : null;
  // A `doc` the viewer may not see is indistinguishable from one that doesn't exist — on
  // purpose. Note the parameter selects a manifest id, never a path: no crafted ?doc= can
  // reach a file outside help/.
  if (wanted && !doc) return renderIndex(ctx, root, visible, wanted);
  if (doc) return renderDoc(ctx, root, doc);
  renderIndex(ctx, root, visible);
}

function renderIndex(ctx, root, visible, missingId) {
  const notFound = missingId
    ? `<div class="alert alert-warn">That help topic isn't available to you.</div>` : '';

  if (!visible.length) {
    root.innerHTML = `${head()}${notFound}
      <div class="empty-state"><div class="es-ic">📘</div><h3>No help topics yet</h3>
      <p>Documentation for this course hasn't been published yet.</p></div>`;
    return;
  }

  // Group by tier so the extra material a director or admin sees is visibly labelled as such.
  const groups = TIERS
    .map(tier => ({ tier, docs: visible.filter(d => d.tier === tier) }))
    .filter(g => g.docs.length);

  const html = groups.map(g => `
    <section class="help-group">
      <h2 class="help-group-title">${esc(TIER_LABEL[g.tier] || g.tier)}</h2>
      ${g.docs.map(d => `
        <a class="card help-card" href="help.html?doc=${encodeURIComponent(d.id)}">
          <div class="card-title">${esc(d.title)}</div>
          ${d.summary ? `<div class="muted" style="font-size:0.88em">${esc(d.summary)}</div>` : ''}
        </a>`).join('')}
    </section>`).join('');

  root.innerHTML = `${head()}${notFound}${html}`;
  wireDocLinks(ctx, root);
}

function head() {
  return `<div class="page-head"><h1>Help</h1>
    <div class="sub">Guides for using PREP, and how AI is used on student work.</div></div>`;
}

async function renderDoc(ctx, root, doc) {
  root.innerHTML = `
    <div class="page-head">
      <a class="help-back" href="help.html">← All help topics</a>
      <h1>${esc(doc.title)}</h1>
      ${doc.summary ? `<div class="sub">${esc(doc.summary)}</div>` : ''}
    </div>
    <div class="card help-doc"><div class="center-load"><span class="spinner"></span></div></div>`;

  const body = root.querySelector('.help-doc');
  try {
    const res = await fetch(HELP_BASE + doc.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    // Repo-authored, not user input — sanitized anyway, per the site-wide rule that nothing
    // reaches innerHTML through marked without DOMPurify.
    body.innerHTML = `<div class="md-render ai-prose">${DOMPurify.sanitize(marked.parse(md))}</div>`;
  } catch (err) {
    body.innerHTML = `<div class="alert alert-error">Couldn't load this topic (${esc(err.message)}).</div>`;
  }
  wireDocLinks(ctx, root);
}

/**
 * Turn in-page help links into history navigation so reading topics doesn't reload the page
 * (and re-run bootstrap). Real <a href>s stay, so middle-click and copy-link still work.
 */
function wireDocLinks(ctx, root) {
  root.querySelectorAll('a[href^="help.html"]').forEach(a => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      history.pushState({}, '', a.getAttribute('href'));
      mountHelp(ctx, root);
      window.scrollTo(0, 0);
    });
  });
}
