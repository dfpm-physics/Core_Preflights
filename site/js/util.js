// util.js — pure, DOM-light helpers shared across the portal. No Supabase, no app state.

/** HTML-escape a value for safe interpolation into innerHTML. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Icons ──────────────────────────────────────────────────────────────────
 * Icons live in site/media/icons as ic-<name>.png (256×256, downscaled by CSS to
 * 16–28px). Not every icon is necessarily present, so iconHTML degrades gracefully:
 *   missing ic-<name>.png  →  ic-dashboard.png (the universal default)
 *   if that's missing too  →  the emoji passed in
 * The UI is fully usable with only a handful of PNGs in place.
 */
const DEFAULT_ICON = 'dashboard'; // ic-dashboard.png is the catch-all placeholder

let ICON_BASE = (function detectBase() {
  // Depth-based, not path-based: nested pages (student/ faculty/) are one level deep and
  // climb one directory to reach media/. That is why it needed no edit when the tree moved
  // from /site/app/ to /site/ at the 2026-07-28 promotion.
  return /\/(student|faculty)\/[^/]*$/.test(location.pathname) ? '../media/icons/' : 'media/icons/';
})();

export function setIconBase(base) { ICON_BASE = base; }

// legacyUrl() lived here until the 2026-07-28 promotion. It built a relative link to a
// legacy page at the site root — admin.html, interactions-admin.html — and adjusted its
// depth for whether the caller sat under /site/app/<role>/ or /site/<role>/. Those pages
// were deleted by that promotion, so every link it could return is now a 404. It had zero
// live callers throughout (LEGACY-AUDIT-2026-07-20.md §5, ROADMAP), so it is removed rather
// than repointed: there is nothing left for it to point AT.

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

/* ── Modals ──────────────────────────────────────────────────────────────────
 *
 * WHY THIS IS NOT `if (e.target === backdrop) close()`
 *   That was the pattern in every one of the site's twenty dialogs until 2026-07-30, and it loses
 *   work. Select text inside a modal, drag past its edge, release — `mouseup` lands on the
 *   backdrop, and the browser fires `click` on the nearest COMMON ANCESTOR of the two, which is
 *   the backdrop. The handler cannot tell that from a real click on the backdrop, so the dialog
 *   closes and everything typed into it is gone. Highlighting a sentence of feedback to replace it
 *   is the single most ordinary thing to do in the grading modal, so this fired constantly and
 *   always at the worst moment.
 *
 * THE FIX is to require BOTH ends of the gesture to be on the backdrop. A dismissal is a click
 * that starts and finishes on the overlay; anything that starts inside the dialog is part of
 * working in it, however far the mouse travels afterwards.
 *
 * Escape closes too, and `[data-close]` (the × and any Cancel button) always closes regardless of
 * where the drag began — those are unambiguous.
 *
 * @param {HTMLElement} backdrop the `.modal-backdrop` element
 * @param {() => void} close what to run; callers that guard unsaved work pass their own confirm
 * @param {{escape?: boolean}} [opts] `escape: false` for a dialog that must be answered
 */
export function wireModalDismiss(backdrop, close, opts = {}) {
  if (!backdrop) return;
  let downOnBackdrop = false, upOnBackdrop = false;
  // Both ends, recorded literally. `click` alone cannot tell them apart: it fires on the nearest
  // common ancestor, so a gesture with either end inside the dialog still arrives with the
  // backdrop as its target. Recorded on the backdrop rather than the document so a drag beginning
  // outside the overlay entirely is not counted.
  backdrop.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('mouseup',   (e) => { upOnBackdrop   = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => {
    const bothEnds = downOnBackdrop && upOnBackdrop;
    downOnBackdrop = upOnBackdrop = false;     // consume it — one gesture, one chance
    // `[data-close]` (the × and any Cancel) has no mousedown at all when it is reached by
    // keyboard, so it is answered before the gesture test rather than through it.
    if (e.target.closest && e.target.closest('[data-close]')) { close(); return; }
    if (e.target === backdrop && bothEnds) close();
  });
  if (opts.escape !== false) {
    // Escape answers ONE dialog — the top one. Each wired backdrop listens on `document`, so with
    // two open (a preview over the lesson editor, an extension over a grade) a single keypress
    // reached both handlers and closed the stack, taking the dialog underneath that the user was
    // still working in. A backdrop click cannot do this — the top overlay covers the one below —
    // which is why only the key needs the guard.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('open') && topmostOpenModal() === backdrop) close();
    });
  }
}

/** The open dialog stacked highest: greatest z-index, later-in-document breaking a tie (which is
 *  the common case — every `.modal-backdrop` shares one z-index unless a page overrides it). */
export function topmostOpenModal() {
  let best = null, bestZ = -Infinity;
  document.querySelectorAll('.modal-backdrop.open').forEach(el => {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    const zz = Number.isFinite(z) ? z : 0;
    if (zz >= bestZ) { bestZ = zz; best = el; }
  });
  return best;
}

/* ── People / formatting ────────────────────────────────────────────────────── */

/**
 * Generational suffixes that belong to the SURNAME, not to the given names.
 *
 * Deliberately short. `I` is excluded because a lone capital I is far more likely to be a middle
 * initial than a first-generation suffix, and the roman numerals past VIII are excluded because
 * nothing at this scale reaches them. `2nd`/`3rd` are not here because the registrar does not
 * emit them — add one when an export actually contains it, not in anticipation.
 */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii']);

/**
 * Split a stored First-Last name into its given names and its surname.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
 * "the last whitespace token is the surname" is right for 99% of a roster and catastrophically
 * wrong for the rest. The registrar exports a suffix INSIDE the last-name field —
 * `"Fixture IV,Testcadet Alpha"` (synthetic name, real shape) — which roster-import.js correctly
 * stores as `Testcadet Alpha Fixture IV`. Reading the final token back as the surname then renders
 * that cadet as **"IV, Testcadet Alpha Fixture"** on every roster, grade and report page, files them under I in
 * every sort, and — worse than cosmetic — writes `Last Name = IV` into the Blackboard grade export.
 * Fifteen cadets across the two Fall 2026 courses are affected.
 *
 * The suffix is peeled only when something is left to be a surname (three tokens or more), so a
 * two-token name can never end up with an empty last name. The residual risk is a genuine
 * one-letter surname `V` sitting third in a three-token name; that is rarer than the suffix case
 * this fixes, and unlike it, it is visible to whoever reads the roster.
 *
 * @param {string} name a stored `students.name` / `instructors.name`, First-Last
 * @returns {{first: string, last: string}} `last` carries any suffix; either may be ''
 */
export function splitName(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return { first: '', last: '' };
  if (p.length === 1) return { first: '', last: p[0] };

  const tail = p[p.length - 1].replace(/\.$/, '').toLowerCase();
  const take = (p.length >= 3 && NAME_SUFFIXES.has(tail)) ? 2 : 1;
  return { first: p.slice(0, -take).join(' '), last: p.slice(-take).join(' ') };
}

export function initials(name) {
  const { first, last } = splitName(name);
  if (!first && !last) return '?';
  if (!first) return last.slice(0, 2).toUpperCase();
  return (first[0] + last[0]).toUpperCase();
}

/** "First Last" -> "Last, First" for roster-style sorting/display. Suffix-aware; see splitName(). */
export function lastFirst(name) {
  const { first, last } = splitName(name);
  if (!first) return name || '';
  return `${last}, ${first}`;
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

/**
 * Blob → synthetic `<a download>` → click → revoke. The site is static with no server, so this
 * is the only way it hands a file to the user.
 *
 * Lived in `faculty-admin.js` until 2026-08-07, where the gradebook CSV and the JSON backup were
 * its only callers. It moved here when the Artifacts page needed to hand a director an artifact's
 * `.jsx` to attach to a claude.ai session: nothing about turning text into a download is about
 * course administration, and importing the admin data layer to reach it would have coupled two
 * unrelated pages.
 */
export function triggerDownload(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ── Course titles (fallback only; real titles come from the courses table) ── */
export const COURSE_TITLE_FALLBACK = {
  'phys-110': 'Physics 110',
  'phys-215': 'Physics 215',
};
export function courseTitle(id, fromDb) {
  return fromDb || COURSE_TITLE_FALLBACK[id] || id || '—';
}

/* ── Tutor brand marks ───────────────────────────────────────────────────────────
 * Inline SVG, not `iconHTML()`, and the difference is deliberate. These sit on the two
 * launch buttons a student chooses between, so they must (a) render before any network
 * round trip, since a cadet reaching for the backup is usually one whose network or
 * quota already failed them, and (b) carry the brand's own colour rather than the theme's
 * — the colour is most of what makes a logo scannable at 20px, and `iconHTML()`'s PNGs
 * are monochrome and can 404 into an emoji.
 *
 * Drawn from each vendor's public mark and used NOMINATIVELY: they label a button that
 * launches that vendor's product and claim nothing else. `aria-hidden` throughout — the
 * button's own text names the tutor, so a screen reader that also read the mark would say
 * it twice.
 *
 * `currentColor` is deliberately NOT used. Both buttons sit on the card surface in both
 * themes, and both brand colours clear contrast against it either way.
 */
const BRAND_MARKS = {
  // Anthropic's radiating burst, in Claude's coral. Eleven spokes at 360/11 degrees, which
  // is what gives the mark its off-axis look — an 8- or 12-spoke version reads as a plain
  // asterisk and stops looking like anything.
  claude: `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g stroke="#D97757" stroke-width="2.3" stroke-linecap="round">${
        Array.from({ length: 11 }, (_, i) =>
          `<line x1="12" y1="12" x2="12" y2="2.6" transform="rotate(${(i * 360 / 11).toFixed(2)} 12 12)"/>`
        ).join('')}</g>
    </svg>`,

  // Gemini's four-pointed spark: four quadratic arcs pulled in to the centre, so the sides
  // are concave. A straight-sided diamond is a different shape and reads as a generic star.
  gemini: `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M12 1.6c0 5.6 4.8 10.4 10.4 10.4C16.8 12 12 16.8 12 22.4
        c0-5.6-4.8-10.4-10.4-10.4C7.2 12 12 7.2 12 1.6z"/>
    </svg>`,
};

/**
 * Inline SVG for one tutor's mark. Unknown name → empty string, never a broken glyph:
 * a launch button with no logo is still a launch button.
 */
export function brandMark(name) {
  return BRAND_MARKS[String(name || '').toLowerCase()] || '';
}
