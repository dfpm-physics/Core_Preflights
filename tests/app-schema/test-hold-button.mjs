// test-hold-button.mjs — the press-and-hold control (site/js/hold-button.js) and how the Assignments page wires it.
//
// WHAT THIS DEFENDS
//   One hold may act on one assignment: the one the removal dialog is showing now. The control used to add its listeners to
//   a persistent button and never take them off, so after the dialog had been opened for A, cancelled, and opened for B, a
//   single hold on B completed once for A as well and removed both. `dispose()` now removes every listener it added, and the
//   page disposes on every way out of the dialog.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a fake button, document and clock. The real pointer and the real page are driven by walk J12 on staging.

import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

installBrowser({ pathname: '/site/faculty/items.html' });

/* A fake event target that remembers its listeners, so a test can count them and fire them. */
const target = () => {
  const m = new Map();
  return {
    m, textContent: 'idle',
    classList: { add() {}, remove() {} },
    addEventListener(t, f) { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(f); },
    removeEventListener(t, f) { m.get(t)?.delete(f); },
    fire(t, e = {}) { for (const f of [...(m.get(t) || [])]) f(e); },
    count: () => [...m.values()].reduce((n, s) => n + s.size, 0),
    setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {},
  };
};

let clock = 0, frames = new Map(), nextFrame = 1;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
const advance = (ms) => { clock += ms; const run = [...frames.values()]; frames = new Map(); run.forEach(fn => fn()); };
const holdFor = (button, ms) => {
  button.fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, preventDefault() {} });
  for (let t = 0; t < ms; t += 100) advance(100);
  advance(1);
};

const { wireHoldButton } = await import('../../site/js/hold-button.js');

section('dispose removes every listener the control added');
{
  const button = target();
  globalThis.document = target();
  const ctl = wireHoldButton({ button, ms: 1000, onComplete() {} });
  check('wiring adds listeners to the button and the document', button.count() === 3 && document.count() === 1, `${button.count()}/${document.count()}`);
  ctl.dispose();
  eq('after dispose the button has none', button.count(), 0);
  eq('... and the document has none', document.count(), 0);
  ctl.dispose();
  check('disposing twice is harmless', button.count() === 0 && document.count() === 0);
}

section('a second completion cannot fire after dispose');
{
  const button = target();
  globalThis.document = target();
  let done = 0;
  const ctl = wireHoldButton({ button, ms: 1000, onComplete() { done++; } });
  holdFor(button, 1000);
  eq('a full hold completes once', done, 1);
  ctl.dispose();
  holdFor(button, 1000);
  eq('after dispose a full hold completes nothing', done, 1);
  // Disposed in the middle of a hold: the running timer must not complete either.
  const b2 = target(); globalThis.document = target();
  let d2 = 0;
  const c2 = wireHoldButton({ button: b2, ms: 1000, onComplete() { d2++; } });
  b2.fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, preventDefault() {} });
  advance(500);
  c2.dispose();
  for (let i = 0; i < 12; i++) advance(100);
  eq('disposed mid-hold, the hold never completes', d2, 0);
  eq('... and no timer is left running', frames.size, 0);
}

section('open the removal dialog for A, cancel, open it for B, hold: one delete, for B');
{
  // The page's own pattern: one persistent button, one control at a time, disposed on every way out.
  const button = target();
  globalThis.document = target();
  const deletes = [];
  let rmHold = null;
  const closeRm = () => { rmHold?.dispose(); rmHold = null; };
  const open = (id) => {
    rmHold?.dispose(); rmHold = null;
    const mine = wireHoldButton({ button, ms: 1000, onComplete() { if (rmHold !== mine) return; closeRm(); deletes.push(id); } });
    rmHold = mine;
  };
  open('A'); closeRm();           // cancelled
  open('B');
  eq('only the listeners for B are on the button', button.count(), 3);
  holdFor(button, 1000);
  eq('one hold, one delete, and it is for B', deletes, ['B']);
  eq('nothing is left wired once it completed', button.count() + document.count(), 0);

  // Opened for A, then for B with no close in between (the dialog was replaced), then A again is not possible either.
  deletes.length = 0;
  open('A'); open('B'); open('C');
  holdFor(button, 1000);
  eq('opening for a new item stands the old one down', deletes, ['C']);

  // Escape, from the document, also ends a hold in progress without deleting.
  deletes.length = 0;
  open('D');
  button.fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, preventDefault() {} });
  advance(500);
  document.fire('keydown', { key: 'Escape' });
  for (let i = 0; i < 12; i++) advance(100);
  eq('Escape mid-hold deletes nothing', deletes, []);
  closeRm();
}

section('the Assignments page wires the control only through those paths');
{
  const html = readFileSync(resolve(REPO, 'site/faculty/items.html'), 'utf8');
  check('it keeps the control it made and stands it down before wiring another', /rmHold\?\.dispose\(\)/.test(html) && /function closeRm\(\)/.test(html));
  check('every way out of the dialog goes through closeRm', /wireModalDismiss\(document\.getElementById\('rm-modal'\), \(\) => closeRm\(\)\)/.test(html) && /rm-modal'\)\.querySelectorAll\('\[data-close\]'\)[^\n]*closeRm\(\)/.test(html));
  check('the page has one wireHoldButton call', (html.match(/wireHoldButton\(/g) || []).length === 1);
  check('the completed hold checks it is still the current control', /if \(rmHold !== mine\) return;/.test(html));
}

process.exit(summary() ? 0 : 1);
