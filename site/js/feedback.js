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

// Every value app.feedback.category accepts (migration 012 CHECK). The box collects a like/dislike
// SENTIMENT and folds "add / remove / feature request" into the free-text comment — the placeholder
// asks for exactly those — so the UI only ever sends 'like', 'dislike', or 'other'. The fuller set
// stays valid so a later control can use it without a migration; this is the DB-parity list.
export const FEEDBACK_CATEGORIES = ['like', 'dislike', 'feature', 'add', 'remove', 'other'];

// The two optional sentiment buttons the panel shows. A comment with no sentiment is a valid
// submission (it becomes 'other') — a feature request is not necessarily a like or a dislike.
export const FEEDBACK_SENTIMENTS = [
  { key: 'like',    label: 'Like',    icon: '👍' },
  { key: 'dislike', label: 'Dislike', icon: '👎' },
];

/**
 * Validate the form. Returns a sentence to show, or null when it is fine. The comment is the only
 * required field — sentiment is optional — and the length rule mirrors the migration-012 CHECK so
 * the person gets words, not a Postgres error.
 */
export function validateFeedback({ message }) {
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
 *
 * Category defaults to 'other' when no sentiment was chosen, and any stray value is coerced to it,
 * so the NOT NULL + CHECK column always receives something it accepts.
 */
export function feedbackRow(ctx, { category, message, page, pageTitle, userAgent }) {
  return {
    submitted_by: ctx?.user?.id || null,
    submitter_name: ctx?.instructorRow?.name || ctx?.studentRow?.name || null,
    role: ctx?.role || null,
    page: page || '',
    page_title: pageTitle || null,
    category: FEEDBACK_CATEGORIES.includes(category) ? category : 'other',
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
      <label class="fb-label">Reaction <span class="fb-opt">(optional)</span></label>
      <div class="fb-cats" role="group" aria-label="Reaction">
        ${FEEDBACK_SENTIMENTS.map((c) =>
          `<button type="button" class="fb-cat fb-cat-${esc(c.key)}" data-cat="${esc(c.key)}" aria-pressed="false">
             <span aria-hidden="true">${c.icon}</span> ${esc(c.label)}</button>`).join('')}
      </div>
      <label class="fb-label" for="fb-msg">Your feedback</label>
      <textarea class="fb-msg" id="fb-msg" rows="4" maxlength="4000"
        placeholder="Tell us anything — what to add, what to remove, a feature you'd like, or what's working well."></textarea>
      <div class="fb-err" id="fb-err"></div>
      <div class="fb-foot">
        <button type="button" class="btn btn-secondary btn-sm fb-cancel">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm fb-send">Send feedback</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const panel = root.querySelector('#fb-panel');
  const launch = root.querySelector('.fb-launch');
  const msg = root.querySelector('.fb-msg');
  const err = root.querySelector('#fb-err');

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
  root.querySelector('.fb-cancel').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  root.querySelectorAll('.fb-cat').forEach((b) => b.addEventListener('click', () => {
    const already = b.classList.contains('on');
    root.querySelectorAll('.fb-cat').forEach((x) => {
      x.classList.remove('on'); x.setAttribute('aria-pressed', 'false');
    });
    // Clicking the active reaction clears it — the sentiment is optional, so it must be
    // deselectable, not a one-way choice.
    if (already) {
      chosen = null;
    } else {
      chosen = b.dataset.cat;
      b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
    }
    err.textContent = '';
  }));

  root.querySelector('.fb-send').addEventListener('click', async () => {
    if (sending) return;
    err.textContent = '';
    const problem = validateFeedback({ message: msg.value });
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
      panel.querySelectorAll('.fb-label, .fb-cats, .fb-msg, .fb-err, .fb-foot')
        .forEach((el) => { el.style.display = 'none'; });
      root.querySelector('#fb-sub').textContent = 'Thanks — that went to the team.';
      setTimeout(close, 1400);
    } catch (e) {
      err.textContent = 'Could not send: ' + (e?.message || 'unknown error') + '. Please try again.';
      send.disabled = false; send.textContent = 'Send feedback';
    } finally {
      sending = false;
    }
  });
}
