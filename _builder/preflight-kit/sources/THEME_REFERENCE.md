# Preflight Artifact — Canonical Theme & Layout Reference

This file is the **single source of truth** for the visual theme, layout structure, and text
rendering of every generated preflight artifact. The factory copies the code blocks below
**verbatim** into each artifact — no per-lesson restyling, no improvisation. Only the text
content of the header strings changes per lesson.

If the instructor wants the look changed, change it HERE, once. Every future artifact inherits it.

---

## 1. Design Tokens

| Token | Value | Used for |
|---|---|---|
| `--navy` | `#1b2a4a` | Header background, Start button |
| `--navy-light` | `#243560` | Header hover/accents |
| `--blue` | `#3b82f6` | Send button, focus rings, typing dots, accents |
| `--blue-light` | `#eff6ff` | Tutor bubble fill |
| `--blue-mid` | `#bfdbfe` | Tutor bubble border, header eyebrow text |
| `--cadet-bg` / `--cadet-border` | `#f1f5f9` / `#e2e8f0` | Cadet bubble fill / border |
| Report bubble | `#f0fdf4` fill / `#86efac` border / `#166534` headers / `#bbf7d0` dividers | Green = report delivered |
| Extension bubble | `#fefce8` fill / `#fde047` border | Amber = untimed extension |
| Error bar | `#fef2f2` / `#fecaca` / `#dc2626` | API / connection errors |
| Timer states | `#ffffff` only. The `.warn`/`.close` amber/red classes remain in the sheet but are **unused** — pacing is per-topic, not a global clock | Pacing cues |
| Honor box | `#f8fafc` fill / 2px `--navy` border | Start-screen Honor Code callout |
| Study button | `--white` fill / 1.5px `--navy` border | Study Mode secondary button |
| Connection dot | `#16a34a` ok · `#f59e0b` checking · `#dc2626` unavailable | Start-screen model-reachability light |
| Backup button | `--navy` fill / `--white` text — **no reserved color** | Backup-version route: the start-screen button under a red connection light, and the error bar's `Continue on Gemini` |
| Readiness callouts | green `#f0fdf4`/`#86efac`, amber `#fefce8`/`#fde047`, red `#fef2f2`/`#fecaca` | Flag tint matches flag |
| Text | `#0f172a` primary / `#64748b` soft / `#94a3b8` muted | |
| Geometry | 760px max column · **fixed 680px shell height** (never viewport-relative) · radius 12px / 6px · bubble tail radius 3px | App shell |
| Type | `system-ui` body · mono stack for eyebrow / timer / section code | |

Semantic color rules (do not violate):
- **Green is reserved for the report bubble** and the Green readiness callout. Nothing else is green.
- **Amber is reserved for the extension bubble**, the timer warn state, and the Yellow readiness callout.
- **Red is reserved for errors**, the timer close state, and the Red readiness callout.

**One documented exception.** The start-screen connection light (`.conn-dot`) uses green/amber/red
outside those reservations. It is a 10px status dot, not a bubble or callout, and the traffic-light
convention is what makes it readable at a glance — an instructor-approved exception scoped to that
one element. Do not let it spread: nothing else outside the rules above gets these colors.

**The backup button is where that rule was tested, and held.** `.backup-btn` appears when the
connection check has failed, and `.error-transfer` when a turn has failed mid-lesson — degraded-mode
actions, which naturally want amber — and neither gets amber. Both are action buttons, exactly the
kind of element the reservation exists to protect, and the red text immediately beside them is
already carrying the alarm; a second warning color would compete rather than clarify. So they take
**navy fill**, which is the theme's own primary-action treatment (`.start-btn`, `.submit-btn`) and
therefore borrows nothing. **They are deliberately un-tinted — if a future artifact reaches for
`#fefce8`/`#fde047` here, that is the drift this paragraph exists to catch.** The `.conn-dot`
exception covers `.conn-dot`, and stops there.

*Changed 2026-08-20.* `.backup-btn` was navy **outline** on white until then, matching `.study-btn`
down to the `#f1f5f9` hover, and the argument was that the two are the same kind of thing: the
secondary way to take the lesson. That held while the backup was a last resort. It stopped holding
when rate limits made the Gemini path the route a capped cadet actually has to take — an escape
hatch someone is being *sent* to has to read as an action, not as a footnote under the thing that
just failed — so it moved to `.start-btn`'s fill, padding and hover. **Only the outline-vs-fill
question moved; the amber reservation above is untouched, and promoting a button to a fill the theme
already uses everywhere spreads no exception.** `.study-btn` keeps the outline treatment: it is
still genuinely the secondary option, and the two buttons are no longer the same kind of thing.

---

## 2. The Canonical `STYLE` Constant

Copy this entire constant into every artifact, byte-for-byte.

```javascript
const STYLE = `
  :root {
    --navy: #1b2a4a;
    --navy-light: #243560;
    --blue: #3b82f6;
    --blue-light: #eff6ff;
    --blue-mid: #bfdbfe;
    --cadet-bg: #f1f5f9;
    --cadet-border: #e2e8f0;
    --text: #0f172a;
    --text-soft: #64748b;
    --text-muted: #94a3b8;
    --white: #ffffff;
    --radius: 12px;
    --radius-sm: 6px;
    --mono: "SF Mono", "Cascadia Code", "Fira Mono", "Consolas", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; }

  /* ── Layout ── */
  /* Height is a CONSTANT, never viewport-relative. The artifact renders in an auto-sizing
     embed that ratchets taller to fit content, so 100vh/100dvh/position:fixed create a
     content -> measure -> grow loop. 680px is the first-paint fallback; the component
     overrides it inline from window.innerHeight (measured on resize only). */
  .app { display: flex; flex-direction: column; height: 680px; max-height: 680px;
         max-width: 760px; margin: 0 auto; background: var(--white);
         box-shadow: 0 0 0 1px #e2e8f0; }

  /* ── Header ── */
  .header { background: var(--navy); color: var(--white); padding: 14px 20px;
            display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .eyebrow { font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
             color: var(--blue-mid); font-family: var(--mono); margin-bottom: 2px; }
  .title { font-size: 15px; font-weight: 700; color: var(--white); }
  .subtitle { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
  .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .timer { font-family: var(--mono); font-size: 20px; font-weight: 700;
           color: var(--white); letter-spacing: .04em; }
  .timer.warn { color: #fbbf24; }
  .timer.close { color: #f87171; }
  .timer-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase;
                 letter-spacing: .08em; font-family: var(--mono); }

  /* ── Start screen ── */
  .start { flex: 1; display: flex; flex-direction: column; align-items: center;
           justify-content: flex-start; padding: 32px 24px; gap: 16px; overflow-y: auto;
           background: #f8fafc; }
  .start-card { width: 100%; max-width: 480px; background: var(--white);
                border: 1px solid var(--cadet-border); border-radius: var(--radius);
                padding: 18px 20px; font-size: 14px; color: var(--text); line-height: 1.6; }
  .start-card h2 { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: var(--text); }
  .start-card p { font-size: 13px; color: var(--text-soft); margin-bottom: 10px; }
  .field-label { display: block; font-size: 11px; color: var(--text-soft);
                 margin: 10px 0 4px; font-weight: 600; }
  .field-input { width: 100%; padding: 10px 12px; border: 1.5px solid #cbd5e1;
                 border-radius: var(--radius-sm); font-size: 14px; font-family: inherit;
                 outline: none; transition: border .15s; color: var(--text); }
  .field-input:focus { border-color: var(--blue); }
  .field-input.mono { font-family: var(--mono); width: 110px; text-transform: uppercase; }
  .field-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .field-error { font-size: 11px; color: #dc2626; margin-top: 4px; }
  .start-btn { width: 100%; margin-top: 16px; padding: 11px; background: var(--navy);
               color: var(--white); border: none; border-radius: var(--radius-sm);
               font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .start-btn:hover:not(:disabled) { background: var(--navy-light); }
  .start-btn:disabled { opacity: .45; cursor: not-allowed; }

  /* Honor Code callout — bold and fenced so it cannot be skimmed past. Navy on neutral,
     deliberately avoiding the reserved green/amber/red semantics. */
  .honor-box { background: #f8fafc; border: 2px solid var(--navy); border-radius: var(--radius-sm);
               padding: 12px 14px; margin: 12px 0 4px; font-size: 13px; font-weight: 700;
               line-height: 1.55; color: var(--text); }

  /* Study Mode — secondary action under the navy-filled primary. */
  .study-btn { width: 100%; margin-top: 8px; padding: 10px; background: var(--white);
               color: var(--navy); border: 1.5px solid var(--navy); border-radius: var(--radius-sm);
               font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .study-btn:hover { background: #f1f5f9; }
  .study-hint { font-size: 11px; color: var(--text-muted); margin-top: 8px; line-height: 1.5; }

  /* Connection light — see the documented color exception in section 1.
     The width cap on .conn-row / .conn-msg / .backup-row is NOT cosmetic. `.start` is a
     centering flex column (align-items: center), which overrides the default stretch — so a
     child with no max-width sizes to its own MAX-CONTENT. For .backup-row that is the whole
     .backup-hint sentence on one unwrapped line, which drags the button out past every card
     on screen. The .start-cards escape it only by carrying max-width: 480px themselves;
     these three siblings did not. All three are capped, not just the visible offender, so the
     next paragraph added to this block cannot quietly reintroduce it. */
  .conn-row { width: 100%; max-width: 480px; box-sizing: border-box;
              display: flex; align-items: center; gap: 8px; margin: 10px 0 2px; }
  .conn-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .conn-ok { background: #16a34a; }
  .conn-checking { background: #f59e0b; }
  .conn-unavailable { background: #dc2626; }
  .conn-text { font-size: 12px; color: var(--text-soft); }
  .conn-recheck { margin-left: auto; font-size: 11px; padding: 3px 10px; background: var(--white);
                  color: var(--navy); border: 1px solid #cbd5e1; border-radius: var(--radius-sm);
                  cursor: pointer; }
  .conn-recheck:disabled { opacity: .5; cursor: default; }
  .conn-msg { width: 100%; max-width: 480px; box-sizing: border-box;
              font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1.5; }

  /* Backup version — shown under a red connection light. NO reserved color: navy FILL,
     matching .start-btn and .submit-btn, per the second exception note in section 1. It is
     an anchor rather than a button (a real click is the only way out of the sandbox), so it
     needs display/text-align/box-sizing/text-decoration that .start-btn gets for free.
     It was a navy OUTLINE matching .study-btn until 2026-08-20, when the Gemini path stopped
     being a last resort: a cadet whose Claude account is capped needs the escape hatch to
     read as an action, not as a footnote under the thing that just failed. */
  .backup-row { width: 100%; max-width: 480px; margin-top: 10px; }
  .backup-btn { display: block; box-sizing: border-box; width: 100%; text-align: center;
                padding: 11px 10px; background: var(--navy); color: var(--white);
                border: 1.5px solid var(--navy); border-radius: var(--radius-sm);
                font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer;
                transition: background .15s; }
  .backup-btn:hover { background: var(--navy-light); }
  .backup-hint { font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }

  /* ── Messages ── */
  /* min-height: 0 is REQUIRED — without it this flex item expands the shell instead of
     scrolling (the classic flexbox-scroll gotcha). The conversation scrolls strictly here. */
  .messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px;
              display: flex; flex-direction: column; gap: 12px; }
  .bubble-wrap { display: flex; }
  .bubble-wrap.user { justify-content: flex-end; }
  .bubble-wrap.assistant { justify-content: flex-start; }
  .bubble { max-width: 85%; padding: 11px 14px; border-radius: var(--radius);
            font-size: 14px; line-height: 1.6; color: var(--text);
            overflow-wrap: break-word; }
  .bubble.assistant { background: var(--blue-light); border: 1px solid var(--blue-mid);
                      border-bottom-left-radius: 3px; }
  .bubble.user { background: var(--cadet-bg); border: 1px solid var(--cadet-border);
                 border-bottom-right-radius: 3px; }
  .bubble.report-bubble { background: #f0fdf4; border: 1px solid #86efac; max-width: 97%; }
  .bubble.extension-bubble { background: #fefce8; border: 1px solid #fde047; }

  /* ── Rich text inside bubbles ── */
  .rt h1 { font-size: 16px; font-weight: 700; margin: 4px 0 8px; }
  .rt h2 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; }
  .rt h3 { font-size: 13px; font-weight: 700; margin: 8px 0 4px; }
  .rt p { margin: 6px 0; }
  .rt ul, .rt ol { margin: 6px 0 6px 20px; }
  .rt li { margin: 3px 0; }
  .rt code { font-family: var(--mono); font-size: .9em; background: rgba(15,23,42,.06);
             padding: 1px 5px; border-radius: 4px; }
  .rt pre { font-family: var(--mono); font-size: 12px; background: rgba(15,23,42,.06);
            padding: 10px 12px; border-radius: var(--radius-sm); overflow-x: auto; margin: 8px 0; }
  .rt pre code { background: none; padding: 0; }
  .rt blockquote { border-left: 3px solid #cbd5e1; padding: 4px 10px; margin: 6px 0;
                   color: #334155; font-style: italic; background: rgba(255,255,255,.6); }
  .rt hr { border: none; border-top: 1px solid #cbd5e1; margin: 10px 0; }
  .rt table { width: 100%; border-collapse: collapse; font-size: 12px;
              table-layout: fixed; margin: 8px 0; }
  .rt th { text-align: left; padding: 5px 6px; font-weight: 600;
           border-bottom: 1px solid #cbd5e1; }
  .rt td { padding: 5px 6px; vertical-align: top;
           border-bottom: 1px solid rgba(203,213,225,.5); }
  .rt .math-display { display: block; text-align: center; margin: 8px 0; overflow-x: auto; }
  .rt .math-fallback { font-family: var(--mono); background: rgba(15,23,42,.06);
                       padding: 1px 5px; border-radius: 4px; font-size: .92em; }
  .rt .katex { font-size: 1.05em; }

  /* ── Report bubble internals ── */
  .report-bubble .rt h1 { font-size: 15px; }
  .report-bubble .rt h2, .report-bubble .rt h3 { color: #166534; }
  .report-bubble .rt hr { border-top: 1px solid #bbf7d0; }
  .report-bubble .rt th { color: #166534; border-bottom: 1px solid #bbf7d0; }
  .report-bubble .rt td { border-bottom: 1px solid #dcfce7; }
  .report-bubble .rt blockquote { border-left-color: #86efac; background: var(--white); }
  .rt .flag-callout { border-radius: var(--radius-sm); padding: 8px 10px; margin: 6px 0;
                      font-style: normal; }
  .rt .flag-green  { background: #f0fdf4; border: 1px solid #86efac; }
  .rt .flag-yellow { background: #fefce8; border: 1px solid #fde047; }
  .rt .flag-red    { background: #fef2f2; border: 1px solid #fecaca; }

  /* ── Typing indicator ── */
  .typing { display: flex; align-items: center; gap: 5px; padding: 12px 15px;
            background: var(--blue-light); border: 1px solid var(--blue-mid);
            border-radius: var(--radius); border-bottom-left-radius: 3px;
            width: fit-content; }
  .dot { width: 7px; height: 7px; background: var(--blue); border-radius: 50%;
         animation: blink 1.2s infinite; }
  .dot:nth-child(2) { animation-delay: .2s; }
  .dot:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%,80%,100% { opacity:.2; } 40% { opacity:1; } }

  /* ── Error ── */
  .error-bar { background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-sm);
               padding: 10px 14px; font-size: 13px; color: #dc2626; margin: 0 16px; }
  .error-retry { margin-left: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600;
                 background: var(--white); color: #dc2626; border: 1px solid #fecaca;
                 border-radius: var(--radius-sm); cursor: pointer; }
  /* Retry stays the quiet one and this stays filled: by the time both are on screen,
     Retry has usually already failed. Navy, not amber -- see .backup-btn for why. */
  .error-transfer { margin-left: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600;
                    background: var(--navy); color: var(--white); border: 1px solid var(--navy);
                    border-radius: var(--radius-sm); cursor: pointer; text-decoration: none;
                    display: inline-block; }
  .error-transfer:hover { background: var(--navy-light); }

  /* ── Composer ── */
  .composer { border-top: 1px solid #e2e8f0; padding: 12px 16px;
              display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
              background: var(--white); }
  .composer textarea { flex: 1; padding: 10px 12px; border: 1.5px solid #cbd5e1;
                       border-radius: var(--radius-sm); font-size: 14px; font-family: inherit;
                       resize: none; outline: none; min-height: 42px; max-height: 140px;
                       line-height: 1.5; transition: border .15s; color: var(--text); }
  .composer textarea:focus { border-color: var(--blue); }
  .composer textarea:disabled { background: #f8fafc; color: var(--text-soft); }
  .send-btn { padding: 10px 18px; background: var(--blue); color: var(--white);
              border: none; border-radius: var(--radius-sm); font-size: 14px; font-weight: 600;
              cursor: pointer; transition: background .15s; white-space: nowrap;
              align-self: flex-end; }
  .send-btn:hover:not(:disabled) { background: #2563eb; }
  .send-btn:disabled { opacity: .45; cursor: not-allowed; }

  /* ── Footer ── */
  .footer { border-top: 1px solid #e2e8f0; padding: 8px 16px; display: flex;
            align-items: center; justify-content: space-between; flex-shrink: 0;
            background: var(--white); }
  .footer-note { font-size: 11px; color: var(--text-muted); }
  .report-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .submit-btn { display: inline-block; padding: 6px 16px; background: var(--navy);
                color: var(--white); border: none; border-radius: var(--radius-sm);
                font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer;
                transition: background .15s; }
  .submit-btn:hover { background: var(--navy-light); }
  .submit-hint { font-size: 11px; color: var(--text-muted); align-self: center; }
`;
```

---

## 3. The Standard Layout — Eight Required Elements

Every artifact contains exactly these elements, in this order. Nothing added, nothing dropped.

1. **Header** (`.header`) — left: `.eyebrow` (`[Course] · [Semester] · JiTT Preflight`),
   `.title` (`Lesson [N] — [Topic]`), `.subtitle` (cadet ID once the session starts);
   right: `.timer` + `.timer-label`. The timer stays a single neutral color — it counts **active
   engagement**, not wall-clock, and pacing is governed by independent per-topic budgets rather than
   a global deadline, so there is nothing for a warn/close threshold to mean. The label flips from
   `elapsed` to `complete` and the timer **freezes** when the report arrives. In Study Mode the
   numeric timer is replaced by a static `study mode · untimed` label.
2. **Start screen** (`.start`) — two `.start-card`s: the briefing card (purpose, ~10 minutes, and
   the Honor Code as a bold `.honor-box` callout — not ordinary card text) and the identity card
   (last-name input, `Start Preflight →` gated on non-empty, plus the `.study-btn` Study Mode entry
   and its `.study-hint`). The `.conn-row` connection light sits between them, pinging the model on
   mount so a cadet learns the tutor is unreachable before investing ten minutes. When that check
   comes back unavailable, and only then, two more elements render directly under the light and
   above the identity card: the red `.conn-msg` explaining the failure, then the `.backup-row`
   holding the `.backup-btn` route to the backup version and its `.backup-hint`. Both are gated on
   the same condition, so they appear and vanish together and a cadet with a green light never sees
   either. The order is the argument: the failure is explained before the way around it is offered.
   **All three of `.conn-row`, `.conn-msg` and `.backup-row` are width-capped to the 480px the
   `.start-card`s use** — `.start` centers rather than stretches its children, so an uncapped one
   sizes to its own max-content and overhangs the cards (see the comment in §2). Anything added to
   this block inherits the cap or repeats the bug.
   **There is no class-section input** — section is handled outside the artifact, so do not collect,
   validate, or store it.
3. **Message area** (`.messages`) — four bubble variants: `.bubble.assistant` (tutor, blue-light,
   left, tail bottom-left), `.bubble.user` (cadet, slate, right, tail bottom-right),
   `.bubble.report-bubble` (green), `.bubble.extension-bubble` (amber). All bubble content
   renders through `RichText`.
4. **Typing indicator** (`.typing`) — three animated dots, styled as a tutor bubble.
5. **Error bar** (`.error-bar`) — shown on API failure, carrying a **typed** message plus an
   `.error-retry` button that re-runs the failed turn and, beside it, an `.error-transfer` anchor
   (`Continue on Gemini →`) that hands the session to the backup build. The wording must match the
   failure: a 529 is server-side *capacity*, not a connection problem, and a 429 is this account's
   usage limit, which is neither. The session is recoverable, never crashed —
   reloading the page in this context can reset the account session, so Retry is the way back.
   **Retry is the quiet control and the transfer is the filled one**, because by the time both are
   on screen Retry has usually already failed once; equal weight would present two options that look
   equally promising when only one of them is. Both are conditional — Retry on the error carrying a
   retry callback, the anchor on the handoff URL being available — so an error with neither renders
   as bare text, which is correct. *(Added 2026-08-20. Before that this bar held Retry alone, and
   cadet-facing copy therefore had to point at the start screen rather than say "below".)*
6. **Composer** (`.composer`) — auto-growing textarea (Enter sends, Shift+Enter newline) + Send.
7. **Footer** (`.footer`) — before the report: `Enter to send · Shift+Enter for new line`;
   after: `Timed portion complete — submit your report. The first report you submit is the one your
   instructor grades.` plus the `.report-actions` slot holding a single **Submit report →** anchor.
   The anchor is gated: it renders as a disabled `.submit-hint` (`Preparing submit…`) until
   LZ-String has loaded **and** the structured-data payload attempt has settled, so a cadet can
   never click an uncompressed URL or beat the payload to the submit. There is no Copy or Download
   button. The wording is not decorative: on a graded lesson the grade finalizes when the first
   report commits and a second is refused, so copy implying the cadet can resubmit is false.
8. **Frozen-timer behavior** — post-report elapsed display uses the stored frozen value, not live time.
9. **Fixed-height shell** — every `.app` (start screen *and* conversation view) carries an inline
   height measured from `window.innerHeight` on mount and on `resize` only — never from content, or
   the embed ratchets. Autoscroll targets the `.messages` container (`scrollTop = scrollHeight`
   inside `requestAnimationFrame`), never `scrollIntoView`, which scrolls the outer document and
   feeds the same loop.

### Layout skeleton (conversation view)

```jsx
<>
  <style>{STYLE}</style>
  <div className="app" style={appStyle}>
    <div className="header">
      <div>
        <div className="eyebrow">[Course] · [Semester] · JiTT Preflight</div>
        <div className="title">Lesson [N] — [Topic]</div>
        <div className="subtitle">{cadetId}</div>
      </div>
      <div className="header-right">
        {mode === "graded" ? (
          <>
            <div className="timer">{timerStr}</div>
            <div className="timer-label">{hasReport ? "complete" : "elapsed"}</div>
          </>
        ) : (
          <div className="timer-label">study mode · untimed</div>
        )}
      </div>
    </div>

    <div className="messages" ref={messagesRef}>
      {visibleMessages.map((m, idx) => {
        const isReport = m.role === "assistant" && isReportMsg(m.content);
        const isExt = m.role === "assistant" && isExtensionMsg(m.content, messages.indexOf(m), messages);
        const bubbleClass = isReport ? "bubble assistant report-bubble"
          : isExt ? "bubble assistant extension-bubble"
          : `bubble ${m.role}`;
        return (
          <div key={idx} className={`bubble-wrap ${m.role}`}>
            <div className={bubbleClass}>
              <RichText text={m.content} />
            </div>
          </div>
        );
      })}
      {loading && (
        <div className="bubble-wrap assistant">
          <div className="typing"><div className="dot" /><div className="dot" /><div className="dot" /></div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>

    {error && (
      <div className="error-bar">
        ⚠ {error.text}
        {error.retry && <button className="error-retry" onClick={error.retry}>Retry</button>}
        {handoffUrl && (
          <a className="error-transfer" href={handoffUrl} rel="noopener noreferrer">
            Continue on Gemini &rarr;
          </a>
        )}
      </div>
    )}

    <div className="composer">
      <textarea
        ref={inputRef}
        rows={1}
        placeholder={loading ? "Tutor is typing…" : "Type your response…"}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        disabled={loading}
        style={{ overflow: "hidden" }}
        onInput={(e) => {
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
      />
      <button className="send-btn" onClick={send} disabled={!input.trim() || loading}>Send</button>
    </div>

    <div className="footer">
      <span className="footer-note">
        {hasReport
          ? "Timed portion complete — submit your report. The first report you submit is the one your instructor grades."
          : "Enter to send · Shift+Enter for new line"}
      </span>
      {mode === "graded" && hasReport && (
        <span className="report-actions">
          {submitUrl
            ? <a className="submit-btn" href={submitUrl} rel="noopener noreferrer">Submit report →</a>
            : <span className="submit-hint">Preparing submit…</span>}
        </span>
      )}
    </div>
  </div>
</>
```

---

## 4. The Canonical `RichText` Component — Markdown + LaTeX

`RichText` renders all bubble content. It supports the markdown that actually occurs in these
sessions (bold, italic, inline code, fenced code, headers, lists, blockquotes, horizontal rules,
**tables** — the report's concept assessment is a markdown table) and LaTeX math via **KaTeX
0.16.9 loaded from cdnjs**. Recognized math delimiters: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`.

Three non-negotiable behaviors:

1. **Math is extracted before markdown parsing** so `*`, `_`, and `|` inside equations are never
   mangled into italics or table cells.
2. **Graceful fallback** — if KaTeX has not loaded (restricted network, CDN blocked), math renders
   as readable raw LaTeX in monospace. Rendering must never crash the session.
3. **Copy/Download are untouched** — they operate on the raw markdown source, never rendered HTML.

Copy this implementation verbatim:

```javascript
// ── KaTeX loader (CDN, injected once) ────────────────────────────────────────
const KATEX_CSS = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
const KATEX_JS  = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";

function useKatex() {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.katex);
  useEffect(() => {
    if (window.katex) { setReady(true); return; }
    if (!document.getElementById("katex-css")) {
      const l = document.createElement("link");
      l.id = "katex-css"; l.rel = "stylesheet"; l.href = KATEX_CSS;
      document.head.appendChild(l);
    }
    if (!document.getElementById("katex-js")) {
      const s = document.createElement("script");
      s.id = "katex-js"; s.src = KATEX_JS; s.async = true;
      document.head.appendChild(s);
    }
    const poll = setInterval(() => {
      if (window.katex) { setReady(true); clearInterval(poll); }
    }, 200);
    const giveUp = setTimeout(() => clearInterval(poll), 10000);
    return () => { clearInterval(poll); clearTimeout(giveUp); };
  }, []);
  return ready;
}

function MathSpan({ tex, display, ready }) {
  if (ready && window.katex) {
    let html;
    try {
      html = window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch (e) { html = null; }
    if (html) {
      return (
        <span
          className={display ? "math-display" : "math-inline"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
  }
  return <code className="math-fallback">{display ? "$$" + tex + "$$" : "$" + tex + "$"}</code>;
}

// ── Math extraction (runs BEFORE markdown parsing) ───────────────────────────
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

function extractMath(src) {
  const math = [];
  const text = src.replace(MATH_RE, (m, d1, d2, i1, i2) => {
    const display = d1 !== undefined || d2 !== undefined;
    const tex = d1 !== undefined ? d1 : d2 !== undefined ? d2 : i1 !== undefined ? i1 : i2;
    math.push({ tex: tex.trim(), display });
    return "\u0000" + (math.length - 1) + "\u0000";
  });
  return { text, math };
}

// ── Inline renderer: math placeholders, bold, italic, inline code ────────────
function renderInline(text, math, ready, keyBase) {
  const parts = text
    .split(/(\u0000\d+\u0000|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)
    .filter(Boolean);
  return parts.map((p, i) => {
    const key = keyBase + "-" + i;
    const mm = p.match(/^\u0000(\d+)\u0000$/);
    if (mm) {
      const item = math[+mm[1]];
      return <MathSpan key={key} tex={item.tex} display={item.display} ready={ready} />;
    }
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={key}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={key}>{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={key}>{p.slice(1, -1)}</em>;
    return p;
  });
}

// ── Block-level renderer ──────────────────────────────────────────────────────
function RichText({ text }) {
  const ready = useKatex();
  const { text: safe, math } = extractMath(text || "");
  const lines = safe.split("\n");
  const blocks = [];
  let i = 0, key = 0;

  const isTableLine = (s) => /^\s*\|.*\|\s*$/.test(s);
  const isTableSep = (s) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s) && s.includes("-");

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(<pre key={key++}><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={key++} />); i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = "h" + h[1].length;
      blocks.push(<Tag key={key++}>{renderInline(h[2], math, ready, "h" + key)}</Tag>);
      i++; continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, "")); i++;
      }
      blocks.push(
        <blockquote key={key++}>{renderInline(buf.join(" "), math, ready, "q" + key)}</blockquote>
      );
      continue;
    }

    if (isTableLine(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headerCells = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++;
      }
      blocks.push(
        <table key={key++}>
          <thead><tr>{headerCells.map((c, ci) =>
            <th key={ci}>{renderInline(c, math, ready, "th" + key + ci)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) =>
            <tr key={ri}>{r.map((c, ci) =>
              <td key={ci}>{renderInline(c, math, ready, "td" + key + ri + "-" + ci)}</td>)}</tr>)}</tbody>
        </table>
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++;
      }
      blocks.push(
        <ul key={key++}>{items.map((it, ii) =>
          <li key={ii}>{renderInline(it, math, ready, "ul" + key + ii)}</li>)}</ul>
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++;
      }
      blocks.push(
        <ol key={key++}>{items.map((it, ii) =>
          <li key={ii}>{renderInline(it, math, ready, "ol" + key + ii)}</li>)}</ol>
      );
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    // Paragraph (group consecutive non-blank, non-special lines)
    const buf = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^\s*```|^#{1,3}\s|^\s*>|^\s*[-*]\s+|^\s*\d+\.\s+/.test(lines[i]) &&
      !(isTableLine(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) { buf.push(lines[i]); i++; }
    const para = buf.join(" ");

    // Readiness flag callout: a paragraph beginning with 🟢 / 🟡 / 🔴 gets a tinted box
    const flag = para.match(/^(🟢|🟡|🔴)/);
    if (flag) {
      const cls = flag[1] === "🟢" ? "flag-green" : flag[1] === "🟡" ? "flag-yellow" : "flag-red";
      blocks.push(
        <p key={key++} className={"flag-callout " + cls}>
          {renderInline(para, math, ready, "fl" + key)}
        </p>
      );
      continue;
    }
    blocks.push(<p key={key++}>{renderInline(para, math, ready, "p" + key)}</p>);
  }

  return <div className="rt">{blocks}</div>;
}
```

### System-prompt companion rule

For rendering to be deterministic, the generated `buildSystemPrompt()` must include this
instruction (see SKILL.md Step 6):

> Write every mathematical expression in LaTeX delimiters — `$...$` for inline math and `$$...$$`
> for displayed equations. Do not write equations in plain ASCII, Unicode symbols, or code spans;
> the app renders LaTeX directly.

### What submission must and must not do

Governed by `INTERACTION-DATA-CONTRACT.md`, which wins over this file on any disagreement. The
render-side rules that belong here:

**Two payloads, always.** The submit URL carries `r` (the Markdown report) **and** `d` (the
structured assessment), both compressed with `window.LZString.compressToEncodedURIComponent(...)`
and carried in the hash. `r` alone reaches the database and earns the cadet nothing — no grade, no
contribution to the cohort rollup — so an artifact that sends only `r` is broken even though every
visible part of it appears to work. It also carries `&v=claude` immediately after `#t=interaction`,
naming the transport that produced it; that key is optional and additive, and nothing branches on
it. *(Added 2026-08-20, alongside `d.model` / `d.model_downgraded`, so a term's submissions can be
counted by runtime and by whether the session was downgraded mid-way.)*

**Never serialize rendered DOM.** Both payloads are built from the raw assistant message text, never
from the DOM. The instructor's system receives clean markdown with `$...$` LaTeX intact, which
renders and aggregates cleanly across the class.

**The structured payload never renders.** The tutor emits `d` as a fenced `jitt-data` block appended
to the report. It is stripped from the stored message the moment the report is detected, so the
report bubble, the API history, and `r` all carry the same clean markdown. `RichText` renders every
bubble verbatim — anything left in the message *will* be shown to the cadet, which is both ugly and
an invitation to edit the effort score before submitting.

**Copy and Download are gone.** Submit is the only exit **for the cadet's work**. It must be a real
user-clicked `<a href={submitUrl}>` inside a `.jsx` artifact — never a scripted redirect and never
raw HTML — and stays disabled until LZ-String has loaded *and* the payload attempt has settled.

**Two other anchors leave the artifact, and both are built the same way.** `.backup-btn` on the
start screen and `.error-transfer` in the error bar are also user-clicked `<a href>` elements with
`rel="noopener noreferrer"` and **no** `target` — the same construction as Submit, because a real
click routing through the external-link handler is the *only* way out of the sandbox and
`window.open` silently does nothing. Neither carries the cadet's report: the start-screen button
carries only the lesson slug, and the handoff carries the transcript so the backup can resume, both
in the URL rather than through any other channel. *(This paragraph read "a single Submit anchor is
the only exit" until 2026-08-20; that had been untrue since the backup button shipped, and the
error-bar handoff made it a second time untrue.)*

**Study Mode has none of this.** No `submitUrl`, no LZ-String path, no payload extraction, no Submit
anchor in the render tree. No report or assessment can leave the artifact in that mode.
The two escape anchors are a separate matter and are **not** mode-gated: the error bar is shared
across both modes, so a study-mode failure offers the same handoff. That carries a transcript to a
backup build and no graded material, so it does not weaken the guarantee above — but it is the one
place where "study mode is wired to nothing" is loose language rather than literal truth, and it is
worth knowing before someone reads the guarantee as broader than it is.

---

## 5. Per-Lesson Variability — The Complete List

Only these strings change between lessons. Everything else above is frozen.

| Location | Changes to |
|---|---|
| `.eyebrow` | `[Course] · [Semester] · JiTT Preflight` |
| `.title` | `Lesson [N] — [Topic]` |
| Component name | `Lesson[NN]Preflight` |
| `LESSON_NUMBER` | `"[N]"` (drives the download filename) |
| `INTERACTION_ID` | `"[lesson slug]"` — the `#i=` value in the submit URL **and** the `?i=` the backup button and the error-bar handoff send to the router; must equal the lesson's `activities.slug` exactly |
| `OBJECTIVE_KEYS` | one `{ key, label }` per probe topic, in priority order — the fixed set the tutor reports understanding against in `d` |
| `PROBE_TOPIC_COUNT` | `3`–`5`, matching `OBJECTIVE_KEYS.length`. Feeds the pacing note **and** the `overBudget` fallback that puts `REPORT_FORMAT` back into the system prompt near the end of a session |
| `ARTIFACT_VERSION` | build year-month, stamped into `d.producer` |
| The four content constants | `TEXTBOOK_REFERENCE`, `LESSON_CONFIG`, `EXTENSION_PROBLEMS` (the fourth, `REPORT_FORMAT`, is itself constant) |

If a request seems to require changing anything else visually, the answer is to change THIS file —
not the individual artifact.
