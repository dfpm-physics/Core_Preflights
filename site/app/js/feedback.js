// feedback.js — the floating "tell us about this page" box, on every signed-in page.
//
// The app is going to instructors to test. This is where their reactions land: what they like,
// dislike, want added or removed, or want built — tagged with who said it and the page they were
// on, in app.feedback (migration 012). Meant to be polled later to steer what gets built next.
//
// MOUNTED FROM renderNav, so it rides the chrome onto every faculty and student page without
// editing each one — the same delivery mountRunBanners uses. Idempotent: renderNav runs again on
// every course change and re-render, and a second widget must not stack on the first.
//
// supabase.js is imported LAZILY inside submit(), never at module scope — exactly as run-banner.js
// documents. nav.js imports this module and every page renders nav.js, so a static supabase import
// would give the whole app (and the offline nav test) a hard dependency on a live client just to
// paint a button that has not been clicked yet.

import { esc } from './util.js';

export const FEEDBACK_CATEGORIES = [
  { key: 'like',    label: 'Like',    icon: '👍' },
  { key: 'dislike', label: 'Dislike', icon: '👎' },
  { key: 'feature', label: 'Feature', icon: '💡' },
  { key: 'add',     label: 'Add',     icon: '➕' },
  { key: 'remove',  label: 'Remove',  icon: '➖' },
  { key: 'other',   label: 'Other',   icon: '💬' },
];

const CATEGORY_KEYS = FEEDBACK_CATEGORIES.map((c) => c.key);

/**
 * Validate the form. Returns a sentence to show, or null when it is fine. Every rule mirrors a
 * migration-012 constraint so the person gets words, not a Postgres error — the same courtesy the
 * extension and EI modals already extend.
 */
export function validateFeedback({ category, message }) {
  if (!CATEGORY_KEYS.includes(category)) return 'Pick a category first.';
  const m = (message || '').trim();
  if (!m) return 'Add a sentence or two so we know what you mean.';
  if (m.length > 4000) return 'That is longer than 4000 characters — trim it a little.';
  return null;
}

/**
 * Build the row from the page context and the form. Pure — location/document/navigator are passed
 * in, not read here — so it is unit-testable and says the same thing under Node as in the browser.
 *
 * `submitted_by` is the auth uid; the migration's INSERT policy pins it to the caller's JWT, so a
 * forged value is rejected by the database regardless of what this builds. `submitter_name` and
 * `role` are readable hints captured alongside it.
 */
export function feedbackRow(ctx, { category, message, page, pageTitle, userAgent }) {
  return {
    submitted_by: ctx?.user?.id || null,
    submitter_name: ctx?.instructorRow?.name || ctx?.studentRow?.name || null,
    role: ctx?.role || null,
    page: page || '',
    page_title: pageTitle || null,
    category,
    message: (message || '').trim(),
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
  };
}

/* ---------------------------------------------------------------------------
 * The widget
 * ------------------------------------------------------------------------- */

const ROOT_ID = 'prep-feedback';

export function mountFeedback(ctx) {
  // Signed-in only — the row needs a submitter, and the box has nothing to say on the login page.
  if (!ctx?.user?.id) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(ROOT_ID)) return;   // idempotent across re-renders

  let chosen = null;
  let sending = false;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'fb-root';
  root.innerHTML = `
    <button type="button" class="fb-launch" aria-expanded="false" aria-controls="fb-panel"
            title="Tell us about this page">
      <span class="fb-launch-ic" aria-hidden="true">💬</span><span class="fb-launch-tx">Feedback</span>
    </button>
    <div class="fb-panel" id="fb-panel" role="dialog" aria-label="Page feedback" aria-modal="false" hidden>
      <div class="fb-head">
        <strong>Feedback</strong>
        <button type="button" class="fb-x" aria-label="Close">×</button>
      </div>
      <div class="fb-sub" id="fb-sub"></div>
      <div class="fb-cats" role="group" aria-label="Category">
        ${FEEDBACK_CATEGORIES.map((c) =>
          `<button type="button" class="fb-cat" data-cat="${esc(c.key)}">
             <span aria-hidden="true">${c.icon}</span> ${esc(c.label)}</button>`).join('')}
      </div>
      <textarea class="fb-msg" rows="4" maxlength="4000"
        placeholder="What works, what doesn't, what you'd add or remove…"></textarea>
      <div class="fb-err" id="fb-err"></div>
      <div class="fb-actions">
        <button type="button" class="btn btn-primary btn-sm fb-send">Send</button>
        <span class="fb-note" id="fb-note"></span>
      </div>
    </div>`;
  document.body.appendChild(root);

  const panel = root.querySelector('#fb-panel');
  const launch = root.querySelector('.fb-launch');
  const msg = root.querySelector('.fb-msg');
  const err = root.querySelector('#fb-err');
  const note = root.querySelector('#fb-note');

  const pageTitle = (document.title || '').replace(/\s*·\s*PREP\s*$/, '').trim();
  root.querySelector('#fb-sub').textContent = pageTitle ? `About: ${pageTitle}` : 'About this page';

  const open = () => {
    panel.hidden = false;
    launch.setAttribute('aria-expanded', 'true');
    setTimeout(() => msg.focus(), 30);
  };
  const close = () => {
    panel.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    launch.focus();
  };
  const toggle = () => (panel.hidden ? open() : close());

  launch.addEventListener('click', toggle);
  root.querySelector('.fb-x').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  root.querySelectorAll('.fb-cat').forEach((b) => b.addEventListener('click', () => {
    chosen = b.dataset.cat;
    root.querySelectorAll('.fb-cat').forEach((x) => x.classList.toggle('on', x === b));
    err.textContent = '';
  }));

  root.querySelector('.fb-send').addEventListener('click', async () => {
    if (sending) return;
    err.textContent = ''; note.textContent = '';
    const problem = validateFeedback({ category: chosen, message: msg.value });
    if (problem) { err.textContent = problem; return; }

    sending = true;
    const send = root.querySelector('.fb-send');
    send.disabled = true; send.textContent = 'Sending…';
    try {
      // Lazy — see the header. This is the only place the widget needs the client.
      const { db } = await import('./supabase.js');
      const row = feedbackRow(ctx, {
        category: chosen,
        message: msg.value,
        page: location.pathname,
        pageTitle: document.title,
        userAgent: navigator.userAgent,
      });
      const { error } = await db.from('feedback').insert(row);
      if (error) throw error;
      // Collapse the form to a thank-you rather than clearing it in place — a reset textarea reads
      // like the click did nothing.
      panel.querySelector('.fb-cats').style.display = 'none';
      msg.style.display = 'none';
      send.style.display = 'none';
      note.textContent = '';
      root.querySelector('#fb-sub').textContent = 'Thanks — that went to the team.';
      setTimeout(close, 1400);
    } catch (e) {
      err.textContent = 'Could not send: ' + (e?.message || 'unknown error') + '. Please try again.';
      send.disabled = false; send.textContent = 'Send';
    } finally {
      sending = false;
    }
  });
}
