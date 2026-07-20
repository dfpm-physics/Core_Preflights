// util.js — pure, DOM-light helpers shared across the portal. No Supabase, no app state.

/** HTML-escape a value for safe interpolation into innerHTML. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Icons ──────────────────────────────────────────────────────────────────
 * Icons live in site/app/media/icons as ic-<name>.png (256×256, downscaled by CSS to
 * 16–28px). Not every icon is necessarily present, so iconHTML degrades gracefully:
 *   missing ic-<name>.png  →  ic-dashboard.png (the universal default)
 *   if that's missing too  →  the emoji passed in
 * The UI is fully usable with only a handful of PNGs in place.
 */
const DEFAULT_ICON = 'dashboard'; // ic-dashboard.png is the catch-all placeholder

let ICON_BASE = (function detectBase() {
  // Works at /site/app/ and after promotion to repo root. Nested pages (student/ faculty/)
  // are one level deep and need to climb one directory to reach media/.
  return /\/(student|faculty)\/[^/]*$/.test(location.pathname) ? '../media/icons/' : 'media/icons/';
})();

export function setIconBase(base) { ICON_BASE = base; }

/**
 * Build a link to a LEGACY page that lives at the SITE ROOT (admin.html,
 * interactions-admin.html). The relative depth differs between the two phases:
 *   • review:    .../site/app/faculty/x.html  →  ../../admin.html
 *   • promoted:  .../faculty/x.html      →  ../admin.html
 * Detecting the `/site/app/<role>/` segment lets the same markup work in BOTH phases with
 * no manual find/replace at go-live. (Relative only — safe under GitHub project pages.)
 */
export function legacyUrl(file) {
  const underApp = /\/app\/(student|faculty)\//.test(location.pathname);
  return (underApp ? '../../' : '../') + file;
}

/**
 * Returns an <img> string for ic-<name>.png. If that file 404s it falls back to
 * ic-dashboard.png (the universal default); if THAT is also missing it replaces the
 * <img> with an inline emoji span so layout is always preserved.
 */
export function iconHTML(name, emoji = '•', cls = 'ic') {
  const src = ICON_BASE + 'ic-' + name + '.png';
  const def = ICON_BASE + 'ic-' + DEFAULT_ICON + '.png';
  const cl = esc(cls);
  const toEmoji = `this.replaceWith(Object.assign(document.createElement('span'),` +
    `{className:'icon-fallback ${cl}',textContent:'${esc(emoji)}'}))`;

  // The default icon itself can only fall back to the emoji (avoid a self-loop).
  if (name === DEFAULT_ICON) {
    return `<img class="${cl}" alt="" src="${esc(src)}" onerror="${toEmoji}">`;
  }
  // First error → swap to the default PNG; second error (default also missing) → emoji.
  const onerr = `if(!this.dataset.fb){this.dataset.fb=1;this.src='${esc(def)}';}else{${toEmoji};}`;
  return `<img class="${cl}" alt="" src="${esc(src)}" onerror="${onerr}">`;
}

/* ── Failure surfacing ────────────────────────────────────────────────────────
 * Every portal page opens with a `.center-load` spinner and replaces it once its data
 * arrives. That means ANY thrown error — a bad query, a renamed export, a bootstrap that
 * returns nothing — leaves the spinner turning forever, with the real cause visible only in
 * a console nobody has open. A page that fails should say so.
 *
 * Wrap a page's entry point:
 *     try { await init(); } catch (e) { showFatal(e); }
 *
 * Errors are shown verbatim. These are authenticated staff/student pages, not a public
 * surface, and a director who can read the message can tell us what broke — which is worth
 * far more than the vague apology a "friendly" message would give them.
 */
export function showFatal(err, mountId = 'main') {
  const mount = document.getElementById(mountId) || document.body;
  const msg = err?.message || String(err ?? 'Unknown error');
  console.error('[PREP] page failed to load:', err);
  mount.innerHTML = `
    <div class="page-head"><h1>This page didn’t load</h1></div>
    <div class="alert alert-error">
      <strong>${esc(msg)}</strong>
      <div style="margin-top:6px;font-size:0.9em">
        Try reloading. If it keeps happening, send this message to whoever maintains PREP —
        it names the actual failure.
      </div>
    </div>
    <details style="margin-top:14px">
      <summary class="muted" style="cursor:pointer;font-size:0.85em">Technical detail</summary>
      <pre style="white-space:pre-wrap;font-size:0.78em;color:var(--muted);margin-top:8px">${esc(err?.stack || msg)}</pre>
    </details>`;
}

/**
 * Guard a page entry point. Also catches the case that produced a silent spinner most often:
 * `bootstrap()` returning undefined because it fired a redirect that never completed, which
 * left the page sitting on its loading state with no error anywhere.
 */
export function runPage(ctx, init, mountId = 'main') {
  if (!ctx) {
    // A redirect was issued. If it lands, this never renders; if it did NOT land, the user
    // gets an explanation instead of a spinner.
    setTimeout(() => {
      const mount = document.getElementById(mountId);
      if (mount && mount.querySelector('.center-load')) {
        showFatal(new Error(
          'Your session could not be resolved, and the redirect to sign-in did not complete. ' +
          'Open the sign-in page directly.'), mountId);
      }
    }, 2500);
    return;
  }
  Promise.resolve()
    .then(init)
    .catch(e => showFatal(e, mountId));
}

/* ── People / formatting ────────────────────────────────────────────────────── */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "First Last" -> "Last, First" for roster-style sorting/display. */
export function lastFirst(name) {
  const p = String(name || '').trim().split(/\s+/);
  if (p.length < 2) return name || '';
  return p[p.length - 1] + ', ' + p.slice(0, -1).join(' ');
}

export function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

export function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── Deadlines ────────────────────────────────────────────────────────────────
 * `isMDay()` and `dueDateForSection()` used to live here. Both are gone: they inferred a
 * meeting pattern from the first letter of a section code, which only ever worked for the
 * two courses that happened to use [MT][135][A-D]. In schema `app` the meeting pattern is
 * data (sections.meeting_days) and a deadline override is a row keyed by section
 * (assignment_due_dates), so nothing needs to be guessed from a string.
 *
 * The replacement is `effectiveDue()` in js/schema.js, which also handles the per-student
 * extension and reports which of the three sources won.
 */

/** Human "Due in 3 days" / "Due today" / "2 days overdue" string. */
export function relativeDue(due) {
  if (!due) return 'No due date';
  const ms = due - new Date();
  const days = Math.round(ms / 86400000);
  if (ms < 0) {
    const d = Math.abs(days);
    return d === 0 ? 'Due earlier today' : `${d} day${d === 1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

/** CSS class for a deadline: 'overdue' | 'soon' (<48h) | ''. */
export function deadlineClass(due, isPast) {
  if (!due) return '';
  if (isPast) return 'overdue';
  return (due - new Date()) < 48 * 3600000 ? 'soon' : '';
}

/* ── Course titles (fallback only; real titles come from the courses table) ── */
export const COURSE_TITLE_FALLBACK = {
  'phys-110': 'Physics 110',
  'phys-215': 'Physics 215',
};
export function courseTitle(id, fromDb) {
  return fromDb || COURSE_TITLE_FALLBACK[id] || id || '—';
}
