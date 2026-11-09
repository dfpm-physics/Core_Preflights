// hold-button.js — "press and hold for N seconds to confirm", done so that it actually works.
//
// WHY THIS IS ITS OWN MODULE
//   There is one hold button in PREP (delete an assignment's library copy, lessons.html) and it
//   was broken for as long as it existed. It is here rather than inline because the failure was
//   only findable by DRIVING it in a browser, and a test can drive a module — `tests/browser-
//   harness/hold.mjs` inlines this exact file into a page and holds the mouse down. Left inline in
//   a 1500-line page it was untestable, which is why it shipped broken and stayed that way.
//
// THE BUG IT FIXES (director, 2026-07-30: "the hold down for 5 seconds doesn't work")
//   The old implementation armed on `mousedown` and cancelled on `mouseup`, `mouseleave`,
//   `touchend` and `touchcancel`. Reproduced in Edge: holding perfectly still fires correctly, and
//   moving the cursor ONE PIXEL off the button fires `mouseleave` and silently cancels. Over five
//   seconds, on a target about 130px wide, drifting off it is not an edge case — it is what a hand
//   does. The progress bar reset with no explanation, so the control read as broken rather than as
//   cancelled, and no amount of holding it "properly" would have helped.
//
//   `setPointerCapture` is both the fix and the correct semantics: once the gesture starts, the
//   element owns that pointer until it is released, so where the cursor wanders in between is not
//   a decision this control has to make. Cancellation is now exactly the three things that mean "I
//   changed my mind" — releasing, the OS cancelling the pointer, and Escape.
//
//   Pointer events also collapse the old mouse/touch pair into one path. Two sets of listeners
//   kept in step by hand is how `mouseleave` ended up in the cancel set in the first place.
//
// THE COUNTDOWN IS PART OF THE FIX, not decoration. A bar that fills is ambiguous when the hold
// can silently restart; a number counting down cannot be misread, and if it ever does reset the
// reader sees it happen.

/**
 * @param {object} opts
 *   button      the <button> — gets `.holding` while held
 *   label       the element whose textContent is the countdown (defaults to `button`)
 *   ms          how long to hold (default 5000)
 *   idleText    label text when not holding
 *   holdText    (n) => label text at n whole seconds remaining
 *   onComplete  called once, when the hold completes
 * @returns {{cancel: () => void, dispose: () => void}} `cancel` ends a hold in progress; `dispose` also removes every listener
 *   (button and document) and makes the control inert, so a caller can stand it down when its dialog closes
 */
export function wireHoldButton({
  button, label = button, ms = 5000, idleText = label?.textContent || '',
  holdText = (n) => `Keep holding… ${n}`, onComplete,
}) {
  if (!button) return { cancel() {}, dispose() {} };
  let raf = null, pointerId = null;

  const cancel = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    button.classList.remove('holding');
    if (pointerId != null && button.hasPointerCapture?.(pointerId)) {
      try { button.releasePointerCapture(pointerId); } catch (_) { /* already gone */ }
    }
    pointerId = null;
    if (label) label.textContent = idleText;
  };

  const begin = (e) => {
    if (disposed) return;
    // Right-click is not a hold. Touch and pen have no meaningful `button`, so only gate the mouse.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    cancel();
    // Capture FIRST: if it throws, the catch leaves the hold un-armed rather than arming one that
    // cannot be cancelled.
    try { button.setPointerCapture(e.pointerId); pointerId = e.pointerId; } catch (_) { pointerId = null; }
    button.classList.add('holding');

    const started = performance.now();
    const tick = () => {
      const left = ms - (performance.now() - started);
      if (disposed) return;
      if (left <= 0) { raf = null; cancel(); onComplete?.(); return; }
      if (label) label.textContent = holdText(Math.ceil(left / 1000));
      raf = requestAnimationFrame(tick);
    };
    tick();
  };

  const onKey = (e) => { if (e.key === 'Escape') cancel(); };
  let disposed = false;

  button.addEventListener('pointerdown', begin);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  // NOTE the absence of pointerleave/pointerout. That absence IS the fix — with the pointer
  // captured, leaving the button is not a cancellation and must not be treated as one.
  document.addEventListener('keydown', onKey);

  /* Stand the control down for good: stop any hold in progress and remove every listener this call added, on the button
   * and on the document. A button that is wired again for a new target (a dialog opened for a different item) must be
   * disposed first, or the old listeners stay and one hold completes once for each of them. */
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    button.removeEventListener('pointerdown', begin);
    button.removeEventListener('pointerup', cancel);
    button.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', onKey);
  };

  return { cancel, dispose };
}
