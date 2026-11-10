// tutorials.js -- the guide engine. It draws a highlight and a small card over the real page and watches what the
// person does. It never clicks for them and never stops a click: the real thing is made by the page's own buttons,
// under the person's own permissions. The only thing it writes is the synced preference `cp.tutorials`.
//
// The catalog is tutorials-catalog.js. The rules, and how to add a tutorial, are in docs/decisions/TUTORIALS.md.
//
// Mounted from renderNav (nav.js), like the feedback box, so it rides onto every signed-in page. Idempotent.
//
// Nothing here may touch the DOM, the network or storage at import time: the offline test imports this module under
// Node to check the pure rules (parsePrefs, shouldShowAuto, pickAuto, ...), and so does the nav test.

import { esc } from './util.js';
import { getPref, setPref } from './prefs.js';
import { viewerTier } from './help.js';
import { TUTORIALS, TUTORIAL_RELEASE, PAGE_NAMES, stepsFor, tutorialById, tierRank } from './tutorials-catalog.js';

export { TUTORIAL_RELEASE };

/* ── The off switch: pure rules ────────────────────────────────────────────────── */

export const PREF_KEY = 'cp.tutorials';
const RUN_KEY = 'cp.tutorial.run';

export const defaultPrefs = () => ({ auto: true, offAt: null, seen: [] });

/** The stored value (a JSON string, as the preference store keeps strings) as a clean object. Anything odd gives the default. */
export function parsePrefs(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  const d = defaultPrefs();
  if (!o || typeof o !== 'object') return d;
  return {
    auto: o.auto === false ? false : true,
    offAt: typeof o.offAt === 'string' && o.offAt ? o.offAt : null,
    seen: Array.isArray(o.seen) ? o.seen.filter(x => typeof x === 'string').slice(-200) : [],
  };
}

export const seenKey = (t) => `${t.id}@${t.version}`;

/**
 * Whether a tour may start by itself, given what the person has chosen.
 *   - not already seen at this version, AND
 *   - automatic tutorials are on, OR the tour is about a feature newer than the moment they were turned off.
 * "Off" with no recorded moment never shows anything: it cannot be told apart from "off for good".
 */
export function shouldShowAuto(t, prefs) {
  if (!t || t.kind !== 'tour' || !t.auto) return false;
  if (prefs.seen.includes(seenKey(t))) return false;
  if (prefs.auto) return true;
  return !!prefs.offAt && t.since > prefs.offAt;
}

/** True when the tour shows only because it is newer than the moment the person turned tutorials off. */
export const isNewFeatureShow = (t, prefs) => !prefs.auto && !!prefs.offAt && t.since > prefs.offAt;

/** The one automatic tour for this page and viewer, or null. At most one, whatever the catalog holds. */
export function pickAuto({ list = TUTORIALS, path, tier, prefs }) {
  const mine = tierRank(tier);
  return list.find(t => t.auto && pathMatches(path, t.auto.page) && tierRank(t.tier) >= 0 && tierRank(t.tier) <= mine
    && shouldShowAuto(t, prefs)) || null;
}

export function withSeen(prefs, t) {
  const k = seenKey(t);
  return prefs.seen.includes(k) ? prefs : { ...prefs, seen: [...prefs.seen, k] };
}
export const withAutoOff = (prefs, release = TUTORIAL_RELEASE) => ({ ...prefs, auto: false, offAt: release });
export const withAutoOn = (prefs) => ({ ...prefs, auto: true, offAt: null });
export const withSeenCleared = (prefs) => ({ ...prefs, seen: [] });

/** A path such as /site/faculty/terms.html ends with the catalog's 'faculty/terms.html'. */
export function pathMatches(path, page) {
  if (!page) return true;
  const p = String(path || '');
  return p === page || p.endsWith('/' + page);
}

export function loadPrefs() { return parsePrefs(getPref(PREF_KEY)); }
export function savePrefs(prefs) { setPref(PREF_KEY, JSON.stringify(prefs)); }

/* ── Run state (this browser tab only) ─────────────────────────────────────────── */

function readRun() {
  try {
    const o = JSON.parse(sessionStorage.getItem(RUN_KEY));
    return o && typeof o.id === 'string' && Number.isInteger(o.step) && o.step >= 0 ? o : null;
  } catch { return null; }
}
function writeRun(run) {
  try { if (run) sessionStorage.setItem(RUN_KEY, JSON.stringify(run)); else sessionStorage.removeItem(RUN_KEY); } catch { /* a tab with no storage just cannot resume */ }
}

/* ── The engine ────────────────────────────────────────────────────────────────── */

const S = {
  ctx: null, run: null, t: null, steps: null,
  root: null, hl: null, card: null, observer: null, timer: null, raf: 0,
  mounted: false, autoDone: false,
  enteredAt: 0, baseline: new Map(), scrolled: null, sig: '', lostAt: 0, dockFixed: null,
};

const SKIP_OPTIONAL_MS = 8000;     // an optional step whose target never shows is skipped
const ABSENT_MS = 1500;            // ...unless it is a plain 'next' step: then it is shown, with a note, after this
const ABSENT_NOTE = 'There is nothing of this kind on the page yet, so there is nothing to point at.';
const LOST_MS = 20000;             // a required one says so, plainly

const isVisible = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width || r.height)) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};
const inRoot = (el) => !!(S.root && S.root.contains(el));
function all(sel) { try { return [...document.querySelectorAll(sel)].filter(el => !inRoot(el)); } catch { return []; } }
function resolve(sel) {
  for (const s of [].concat(sel || [])) { const el = all(s).find(isVisible); if (el) return el; }
  return null;
}

const urlFor = (page, tab) => {
  try { return new URL('../' + page + (tab ? `?tab=${encodeURIComponent(tab)}` : ''), location.href).href; } catch { return '#'; }
};

const curStep = () => S.steps && S.steps[S.run?.step];

/** Start a tutorial by hand. Safe to call from any page: it sends the person to the first page it needs. */
export function startTutorial(id, ctx = S.ctx, { auto = false, newFeature = false } = {}) {
  const t = tutorialById(id);
  if (!t) return false;
  if (ctx) S.ctx = ctx;
  const steps = stepsFor(t, S.ctx);
  const path = location.pathname;
  // A task may begin partway when the person is already on its page.
  let first = 0;
  if (t.kind === 'task') {
    const i = steps.findIndex(s => s.entry && pathMatches(path, s.page));
    if (i > 0) first = i;
  }
  S.run = { id, step: first, startedAt: Date.now(), mode: auto ? (newFeature ? 'newfeature' : 'auto') : 'hand' };
  S.t = t; S.steps = steps;
  writeRun(S.run);
  const page = steps[first].page;
  if (page && !pathMatches(path, page)) { location.href = urlFor(page, steps[first].tab); return true; }
  begin();
  return true;
}

function begin() {
  ensureUi();
  enterStep();
  startLoop();
  schedule();
}

function enterStep() {
  const step = curStep();
  S.enteredAt = Date.now(); S.lostAt = 0; S.scrolled = null; S.sig = '';
  // What was already showing when the step began does not count as its result: a result is something NEW, or something that
  // was hidden and now shows. (A stale error from an earlier try must not read as the answer to this one.)
  S.baseline = new Map();
  const a = step?.advance;
  const showing = (sel) => new Set(all(sel).filter(isVisible));
  if (a && typeof a === 'object' && a.until) S.baseline.set(a.until, showing(a.until));
  if (step?.fail) S.baseline.set(step.fail, showing(step.fail));
}

function setStep(i) {
  if (!S.run) return;
  if (i < 0) i = 0;
  if (i >= S.steps.length) return finish();
  S.run = { ...S.run, step: i };
  writeRun(S.run);
  enterStep();
  schedule();
}
const advance = () => setStep(S.run.step + 1);

function teardown() {
  S.run = null; S.t = null; S.steps = null;
  writeRun(null);
  stopLoop();
  S.root?.remove(); S.root = S.hl = S.card = null;
}

/** Done: the last step passed. A tour is marked seen; a task is not (it never starts by itself). */
function finish() { markSeenIfTour(); teardown(); }
/** The person left. A tour is marked seen, and a task simply closes: the page stays exactly as it is. */
function leave() { markSeenIfTour(); teardown(); }

function markSeenIfTour() {
  if (S.t?.kind === 'tour') savePrefs(withSeen(loadPrefs(), S.t));
}

function turnOff() {
  let p = withAutoOff(loadPrefs());
  if (S.t) p = withSeen(p, S.t);
  savePrefs(p);
  teardown();
}

/* ── Mounting ──────────────────────────────────────────────────────────────────── */

/** Called from renderNav on every signed-in page. Resumes a running guide, or starts the one automatic tour that applies. */
export function mountTutorials(ctx) {
  if (typeof document === 'undefined') return;
  S.ctx = ctx;
  if (S.mounted) { if (S.run) schedule(); return; }
  S.mounted = true;

  document.addEventListener('click', onDocClick, true);
  document.addEventListener('input', () => { if (S.run) schedule(); }, true);

  const run = readRun();
  const tier = viewerTier(ctx);
  const plan = planMount({ run, tier, path: location.pathname, prefs: loadPrefs(), autoDone: S.autoDone });
  if (plan.action === 'resume') {
    const t = tutorialById(run.id);
    S.run = run; S.t = t; S.steps = stepsFor(t, ctx);
    if (run.step >= S.steps.length) { teardown(); return; }
    begin();
    return;
  }
  if (plan.clear) writeRun(null);       // a run for a tutorial that is gone, or one this person may not use
  if (plan.action !== 'auto') return;
  S.autoDone = true;                    // one automatic tour per page load, whatever happens to it
  const tour = tutorialById(plan.id);
  startTutorial(tour.id, ctx, { auto: true, newFeature: isNewFeatureShow(tour, loadPrefs()) });
}

/**
 * What mounting does, as a plain decision so the rules can be tested without a page:
 *   a guide that is running is resumed, and nothing automatic starts while it runs;
 *   otherwise at most ONE automatic tour starts per page load.
 */
export function planMount({ run = null, list = TUTORIALS, tier, path, prefs, autoDone = false }) {
  const t = run && list.find(x => x.id === run.id);
  if (t && tierRank(t.tier) <= tierRank(tier)) return { action: 'resume' };
  const clear = !!run;
  if (autoDone) return { action: 'none', clear };
  const tour = pickAuto({ list, path, tier, prefs });
  return tour ? { action: 'auto', id: tour.id, clear } : { action: 'none', clear };
}

/* ── Watching the person ───────────────────────────────────────────────────────── */

function onDocClick(e) {
  if (!S.run || inRoot(e.target)) return;
  const step = curStep();
  const sel = step?.advance && typeof step.advance === 'object' ? step.advance.click : null;
  if (!sel || !(e.target instanceof Element)) return;
  let hit = null;
  try { hit = e.target.closest(sel); } catch { return; }
  if (hit) advance();                   // never preventDefault: the page does what it always does
}

function startLoop() {
  if (S.timer) return;
  S.timer = setInterval(tick, 250);
  if (!S.observer && typeof MutationObserver !== 'undefined') {
    S.observer = new MutationObserver((muts) => {
      if (muts.every(m => inRoot(m.target))) return;      // our own card moving must not wake us again
      schedule();
    });
    S.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'disabled'] });
  }
  addEventListener('resize', schedule);
  addEventListener('scroll', schedule, true);
}
function stopLoop() {
  clearInterval(S.timer); S.timer = null;
  S.observer?.disconnect(); S.observer = null;
  removeEventListener('resize', schedule);
  removeEventListener('scroll', schedule, true);
  cancelAnimationFrame(S.raf); S.raf = 0;
}
function schedule() {
  if (S.raf || !S.run) return;
  S.raf = requestAnimationFrame(() => { S.raf = 0; tick(); });
}

/* ── One look at the page ──────────────────────────────────────────────────────── */

function tick() {
  if (!S.run || !S.root) return;
  const step = curStep();
  if (!step) return finish();
  const a = step.advance;

  // Arriving on a named page is itself the way forward for some steps.
  if (a && typeof a === 'object' && a.page && pathMatches(location.pathname, a.page)) return advance();

  let view = null, el = null;

  if (step.page && !pathMatches(location.pathname, step.page)) {
    // A tour belongs to its page: wandering off ends it. A task says where to go.
    if (S.t.kind === 'tour') return leave();
    view = { kind: 'goto', title: step.title, text: `This step is on the ${PAGE_NAMES[step.page] || 'next'} page.`,
      link: { href: urlFor(step.page, step.tab), label: `Open ${PAGE_NAMES[step.page] || 'the page'}` } };
  } else if (step.tab && document.querySelector('.subtab.active')?.dataset.tab !== step.tab) {
    const tabEl = resolve(`.subtab[data-tab="${step.tab}"]`);
    if (tabEl) { el = tabEl; view = { kind: 'tab', title: step.title, text: `Click the ${tabEl.textContent.trim()} tab first.` }; }
    else view = { kind: 'wait', title: step.title, text: 'Looking for it on the page.' };
  } else {
    el = resolve(step.target);
    const fail = step.fail ? all(step.fail).find(f => isVisible(f) && f.textContent.trim() && !S.baseline.get(step.fail)?.has(f)) : null;

    if (a && typeof a === 'object' && a.until) {
      const base = S.baseline.get(a.until) || new Set();
      if (all(a.until).some(n => isVisible(n) && !base.has(n))) return advance();
    }
    if (a && typeof a === 'object' && a.gone && !all(a.gone).some(isVisible)) return advance();

    const waiting = a && typeof a === 'object' && (a.until || a.gone);
    if (fail) {
      view = { kind: 'fail', title: step.title, text: fail.textContent.trim().slice(0, 400), note: 'Fix it on the page and press the button again.', back: true };
    } else if (step.target != null && !el && !waiting) {
      const waited = Date.now() - S.enteredAt;
      // A tour step that explains something the page does not have yet (a new course has no backlog and no
      // columns) is still worth reading. Show it without a highlight rather than leave the person waiting.
      if (step.optional && a === 'next' && waited > ABSENT_MS) {
        view = { kind: 'step', title: step.title, text: step.text, note: step.absent || ABSENT_NOTE };
      } else if (step.optional && waited > SKIP_OPTIONAL_MS) return advance();
      if (!step.optional && waited > LOST_MS) {
        if (!S.lostAt) S.lostAt = Date.now();
        view = { kind: 'lost', title: step.title, text: `I can't find "${step.title}" on this page.` };
      } else if (!view) view = { kind: 'wait', title: step.title, text: 'Looking for it on the page.' };
    } else {
      view = { kind: 'step', title: step.title, text: step.text };
    }
  }

  render(view, step);
  place(el && view.kind !== 'goto' ? el : null);
}

/* ── Drawing ───────────────────────────────────────────────────────────────────── */

function ensureUi() {
  if (S.root) return;
  const root = document.createElement('div');
  root.id = 'tut-root';
  root.innerHTML = `<div class="tut-hl" aria-hidden="true" hidden></div><div class="tut-card" role="dialog" aria-live="polite" aria-label="Tutorial"></div>`;
  document.body.appendChild(root);
  S.root = root; S.hl = root.querySelector('.tut-hl'); S.card = root.querySelector('.tut-card');
  S.card.addEventListener('click', onCardClick);
}

function inputFilled(step) {
  const a = step.advance;
  if (!a || typeof a !== 'object' || !a.input) return true;
  const el = all(a.input).find(isVisible);
  return !!(el && String(el.value ?? '').trim());
}

function render(view, step) {
  const mode = S.run.mode;
  const tour = S.t.kind === 'tour';
  const n = S.run.step + 1, N = S.steps.length;
  const canNext = view.kind === 'step' && (step.advance === 'next' || (typeof step.advance === 'object' && step.advance.input && inputFilled(step)));
  const needsInput = view.kind === 'step' && typeof step.advance === 'object' && step.advance.input && !inputFilled(step);
  const last = S.run.step === N - 1;
  const sig = JSON.stringify([S.run.id, S.run.step, view.kind, view.text, canNext, mode, needsInput]);
  if (sig === S.sig) return;
  S.sig = sig;

  const leaveLabel = tour ? 'End tour' : 'I\'ve got it from here';
  const hint = view.kind === 'step' && step.advance && typeof step.advance === 'object'
    ? (step.advance.click ? 'Click it on the page to go on.' : needsInput ? 'Fill it in, then Next will work.' : '') : '';
  S.card.setAttribute('aria-label', `Tutorial: ${S.t.title}`);
  S.card.innerHTML = `
    <div class="tut-top"><span class="tut-count">${esc(S.t.title)} · step ${n} of ${N}</span>${mode === 'newfeature' ? '<span class="tut-new">New feature</span>' : ''}</div>
    <div class="tut-title">${esc(view.title)}</div>
    <div class="tut-text">${esc(view.text)}</div>
    ${view.note ? `<div class="tut-text tut-note">${esc(view.note)}</div>` : ''}
    ${hint ? `<div class="tut-hint">${esc(hint)}</div>` : ''}
    ${view.link ? `<div class="tut-goto"><a class="btn btn-secondary btn-sm" href="${esc(view.link.href)}">${esc(view.link.label)}</a></div>` : ''}
    <div class="tut-actions">
      ${tour && S.run.step > 0 && view.kind === 'step' ? '<button type="button" class="btn btn-ghost btn-sm" data-tut="back">Back</button>' : ''}
      ${view.back ? '<button type="button" class="btn btn-secondary btn-sm" data-tut="back">Back to the form</button>' : ''}
      ${view.kind === 'lost' ? '<button type="button" class="btn btn-secondary btn-sm" data-tut="retry">Try again</button>' : ''}
      ${view.kind === 'step' && (step.advance === 'next' || (typeof step.advance === 'object' && step.advance.input))
        ? `<button type="button" class="btn btn-primary btn-sm" data-tut="next"${canNext ? '' : ' disabled'}>${last ? 'Finish' : 'Next'}</button>` : ''}
      <span class="tut-grow"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-tut="leave">${esc(leaveLabel)}</button>
    </div>
    ${tour && (mode === 'auto' || mode === 'newfeature') ? '<div class="tut-off"><button type="button" class="tut-linkbtn" data-tut="off">Turn off automatic tutorials</button></div>' : ''}`;
}

function onCardClick(e) {
  const b = e.target instanceof Element ? e.target.closest('[data-tut]') : null;
  if (!b || b.disabled || !S.run) return;
  const act = b.dataset.tut;
  if (act === 'next') advance();
  else if (act === 'back') setStep(S.run.step - 1);
  else if (act === 'retry') { S.enteredAt = Date.now(); S.lostAt = 0; S.sig = ''; schedule(); }
  else if (act === 'leave') leave();
  else if (act === 'off') turnOff();
}

/** Put the highlight over the target and the card beside it, never on top of it. */
function place(el) {
  const hl = S.hl, card = S.card;
  if (!hl || !card) return;
  const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
  let r = null;
  if (el) {
    if (S.scrolled !== el) { S.scrolled = el; try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* old browser */ } }
    const b = el.getBoundingClientRect();
    r = { left: b.left - 4, top: b.top - 4, right: b.right + 4, bottom: b.bottom + 4 };
    hl.hidden = false;
    Object.assign(hl.style, { left: r.left + 'px', top: r.top + 'px', width: (r.right - r.left) + 'px', height: (r.bottom - r.top) + 'px' });
  } else hl.hidden = true;

  const narrow = vw < 640;
  card.classList.toggle('tut-dock', narrow);
  if (narrow) {
    card.style.left = card.style.top = '';
    // The card docks to the bottom edge, so keep the target above it.
    if (r) {
      const room = vh - card.offsetHeight - 16;
      if (r.bottom > room) { try { window.scrollBy(0, Math.ceil(r.bottom - room)); } catch { /* ignore */ } }
    }
    return;
  }
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 12, edge = 8;
  const fits = (x, y) => x >= edge && y >= edge && x + cw <= vw - edge && y + ch <= vh - edge;
  const overlap = (x, y) => {
    if (!r) return 0;
    const w = Math.min(x + cw, r.right) - Math.max(x, r.left), h = Math.min(y + ch, r.bottom) - Math.max(y, r.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  let spots;
  if (!r) spots = [[18, vh - ch - 18]];
  else {
    const cx = Math.min(Math.max(r.left, edge), vw - cw - edge), cy = Math.min(Math.max(r.top, edge), vh - ch - edge);
    spots = [[r.right + m, cy], [r.left - cw - m, cy], [cx, r.bottom + m], [cx, r.top - ch - m]];
  }
  let best = spots.find(([x, y]) => fits(x, y) && !overlap(x, y));
  if (!best) {                              // a big target: use a corner and cover as little of it as possible
    const corners = [[18, vh - ch - 18], [18, edge + 56], [vw - cw - 18, edge + 56], [vw - cw - 18, vh - ch - 70]];
    best = corners.filter(([x, y]) => fits(x, y)).sort((p, q) => overlap(...p) - overlap(...q))[0] || spots[0];
  }
  card.style.left = Math.round(best[0]) + 'px';
  card.style.top = Math.round(best[1]) + 'px';
}
