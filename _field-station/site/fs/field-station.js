// Field Station: the one module script the overlay server adds to every portal page.
// It does three small things and touches no page data.
//   1. Marks the page (html.fs) so the stylesheet applies only where the overlay is running.
//   2. Points the shared icon helper at the Field Station icon set, light or dark, and keeps
//      icons already on the page in step when the theme switch is used.
//   3. Makes a table that is wider than its box scroll inside that box, not push the page.

import { setIconBase } from '../js/util.js';

const root = document.documentElement;
root.classList.add('fs');
// Page and role as classes, so a rule can name one page without touching the page's own markup.
{
  const m = location.pathname.match(/\/(student|faculty)\/([^/.]+)(?:\.html)?$/);
  if (m) root.classList.add(`fs-r-${m[1]}`, `fs-p-${m[2]}`);
}

const BASE = new URL('./icons/', import.meta.url).pathname;     // /site/fs/icons/
const themeName = () => (root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

function applyIcons() {
  const t = themeName();
  setIconBase(`${BASE}${t}/`);
  document.querySelectorAll('img.ic').forEach(img => {
    const s = img.getAttribute('src') || '';
    if (s.includes('/fs/icons/') && !s.includes(`/icons/${t}/`)) {
      img.setAttribute('src', s.replace(/\/icons\/(light|dark)\//, `/icons/${t}/`));
    }
  });
}

applyIcons();
new MutationObserver(applyIcons).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
// Icons rendered after a theme change come from setIconBase; ones rendered before it are re-pointed above.

// Wide tables scroll inside their own box. Done once per table as it appears; the page keeps its width.
function inScroller(tb) {
  // A table already inside its own scrolling box (a sticky-header grid, say) is left alone: a second
  // box would take over its scroll position and break the stickiness.
  for (let e = tb.parentElement; e && e.tagName !== 'MAIN' && e !== document.body; e = e.parentElement) {
    const o = getComputedStyle(e);
    if (/(auto|scroll)/.test(o.overflowX + o.overflowY)) return true;
  }
  return false;
}
function wrapTables(scope) {
  scope.querySelectorAll?.('table').forEach(tb => {
    if (tb.closest('.fs-scroll') || tb.dataset.fsWrapped) return;
    if (inScroller(tb)) { tb.dataset.fsWrapped = 'own'; return; }
    tb.dataset.fsWrapped = '1';
    const box = document.createElement('div');
    box.className = 'fs-scroll';
    tb.parentNode.insertBefore(box, tb);
    box.appendChild(tb);
  });
}
// The two frozen contract pages (the lesson editor that artifact prefill links open, and the artifact receiver) get the
// theme and nothing else: no table wrapping, no heading rewriting. Their markup stays exactly as authored.
const FROZEN = /\/(faculty\/lessons|student\/interaction-submit)(?:\.html)?$/.test(location.pathname);
function watchTables() {
  if (FROZEN) return;
  wrapTables(document);
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.tagName === 'TABLE') wrapTables(n.parentNode); else wrapTables(n); } });
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.body) watchTables(); else document.addEventListener('DOMContentLoaded', watchTables);

// Emoji in headings, empty-state pictures and the Feedback button become the package icons. The words stay live
// text next to the icon; only the emoji glyph is swapped. Done on the page, so no shared module is overlaid.
const EMOJI_ICON = [
  [/⚠/u, 'warning'], [/❌|✖|⛔|🚫/u, 'error'], [/✅|✔|☑/u, 'success'],
  [/📌/u, 'pending-grade'], [/🏫/u, 'sections'], [/🧑/u, 'class'], [/💬|🔍|❓|📘|ℹ/u, 'info'],
  [/🔒|⚙/u, 'settings'], [/🧾|📚|✏|📄|📋/u, 'assignments'], [/📊|📈/u, 'analytics'], [/⭐|★|🏅/u, 'award'],
  [/⏰|📅|⏳|🔭|🗓/u, 'due-soon'], [/⬇/u, 'export'],
];
const GLYPH = /^\s*((?:\p{Extended_Pictographic}[️‍]*)+)\s*/u;
// A glyph with no matching icon is left exactly as the page wrote it: a guess would change what it says.
const iconFor = (g) => (EMOJI_ICON.find(([re]) => re.test(g)) || [0, null])[1];
const iconImg = (name, cls) => {
  const img = document.createElement('img');
  img.className = `ic fs-emoji ${cls}`;
  img.alt = ''; img.setAttribute('aria-hidden', 'true');
  img.src = `${BASE}${themeName()}/ic-${name}.png`;
  return img;
};
function swapEmoji(scope) {
  scope.querySelectorAll?.('h1,h2,h3,h4,.due-chip,.es-ic,.fb-launch-ic,.dz-ic').forEach(el => {
    if (el.dataset.fsEmoji) return;
    if (el.matches('.es-ic,.fb-launch-ic,.dz-ic')) {
      const g = el.textContent.trim();
      if (!g || !GLYPH.test(g) || el.querySelector('img') || !iconFor(g)) return;
      el.dataset.fsEmoji = '1';
      el.textContent = '';
      el.appendChild(iconImg(iconFor(g), 'fs-emoji-lg'));
      return;
    }
    const n = el.firstChild;
    if (!n || n.nodeType !== 3) return;
    const m = n.textContent.match(GLYPH);
    if (!m || !iconFor(m[1])) return;
    el.dataset.fsEmoji = '1';
    n.textContent = n.textContent.slice(m[0].length);
    el.insertBefore(iconImg(iconFor(m[1]), 'fs-emoji-sm'), n);
  });
}
// Text the rail shortens with an ellipsis (a long name, a long course) gets its full text as a hover title.
// The words are whole in the page, so a screen reader reads the full name; only the drawing is cut short.
function fullText(scope) {
  scope.querySelectorAll?.('.user-chip, .course-btn').forEach(b => {
    const t = (b.querySelector('.nm, .cb-name') || b).textContent.replace(/\s+/g, ' ').trim();
    if (t && b.getAttribute('title') !== t) b.setAttribute('title', t);
  });
}
function watchEmoji() {
  if (!FROZEN) swapEmoji(document);
  fullText(document);
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (!FROZEN) swapEmoji(n.parentNode || n); fullText(n.parentNode || n); } });
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.body) watchEmoji(); else document.addEventListener('DOMContentLoaded', watchEmoji);
