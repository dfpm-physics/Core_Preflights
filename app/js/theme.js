// theme.js — light/dark mode for the Preflights portal.
//
// The actual first-paint application happens via a tiny inline snippet in each page's
// <head> (see THEME_HEAD_SNIPPET below / the copy pasted into every HTML head) so there
// is no flash of the wrong theme. This module only wires up runtime toggling.

import { iconHTML } from './util.js';

const KEY = 'cp.theme';

/** Reference copy of the no-flash snippet that must live inline in every <head>,
 *  BEFORE the stylesheet link. Kept here as documentation. */
export const THEME_HEAD_SNIPPET = `(function(){try{
  var s=localStorage.getItem('cp.theme');
  var m=s||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  if(m==='dark')document.documentElement.setAttribute('data-theme','dark');
}catch(e){}})();`;

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function storedTheme() {
  try { return localStorage.getItem(KEY); } catch (_) { return null; }
}

export function applyTheme(mode) {
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

export function setTheme(mode) {
  applyTheme(mode);
  try { localStorage.setItem(KEY, mode); } catch (_) {}
  updateToggleButtons();
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Sync any [data-theme-toggle] button's icon/label to the active theme.
 *  Shows the icon of the ACTIVE theme (moon in dark mode, sun in light); the
 *  aria-label/title still describe the action the click performs. */
export function updateToggleButtons() {
  const dark = currentTheme() === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Light mode' : 'Dark mode';
    const span = btn.querySelector('[data-theme-icon]') || btn;
    span.innerHTML = iconHTML(dark ? 'moon' : 'sun', dark ? '🌙' : '☀️', 'ic');
  });
}

/** Wire delegated click handling + react to OS changes when the user hasn't chosen. */
export function initTheme() {
  updateToggleButtons();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-toggle]');
    if (btn) { e.preventDefault(); toggleTheme(); }
  });
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!storedTheme()) { applyTheme(e.matches ? 'dark' : 'light'); updateToggleButtons(); }
    });
  } catch (_) {}
}
