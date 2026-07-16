# Student Lesson View — the cadet-facing side of lesson unification

*Design doc. Authored 2026-07-16 by Matthew Recker (via Claude). Status: **proposed** — not yet
built. This is **Phase 5** of [`LESSON-UNIFICATION.md`](LESSON-UNIFICATION.md) §15, and the first
document to specify what a student actually sees. Companions:
[`LESSON-UNIFICATION.md`](LESSON-UNIFICATION.md) (the data model and lifecycle rules — what is
*true*), [`site/app/DESIGN.md`](../../site/app/DESIGN.md) (the visual language — how it *looks*),
and [`INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md) (frozen).*

Everything here is composition of existing components. **No new CSS is expected** — the faculty
pages already carry every primitive this needs.

---

## 1. The problem

The student side is still the pre-unification world: two parallel lists, one per modality.

- [`student/assignments.html`](../../site/app/student/assignments.html) lists `assignments`.
- [`student/interactions.html`](../../site/app/student/interactions.html) lists `interactions`.
- The dashboard renders **both**, with two separate to-do counts
  ([`student-data.js`](../../site/app/js/student-data.js) `stats.toDo` and
  `stats.interactionsToDo`).

So a `choice` lesson — one piece of work, two ways to do it — appears to a cadet as **two
assignments**, counted twice, each looking independently mandatory. Nothing on screen says they're
alternatives, and nothing says doing one closes the other. The faculty side already thinks in
lessons ([`faculty/lessons.html`](../../site/app/faculty/lessons.html)); the student side has never
heard of them.

**The fix is a wrapper, not a rewrite.** A lesson list and a lesson detail sit *above* the existing
assignment-detail and interaction-launch components, which keep working underneath.

---

## 2. What the student is choosing between

Worth stating plainly, because the UI has to carry it: the two paths are **equal in credit and
different in kind**. A lesson is worth 2 points on either path, graded on *effort*, not
correctness (D3). A cadet who engages honestly and gets the physics wrong earns full credit either
way.

This is the single most student-visible consequence of the whole design (§17 of the parent doc
flags it as a risk), and the choice UI is where it lands. If the modal reads as "pick the easy one,"
the research signal is contaminated by grade-shopping rather than by preference. **The copy must
make credit-equivalence obvious and lead with the difference in experience.**

---

## 3. Information architecture

| Today | Proposed |
|---|---|
| Nav: `Dashboard · Assignments · Interactions` | Nav: `Dashboard · Lessons` |
| `student/assignments.html` — assignment list + detail | `student/lessons.html` — **lesson** list + detail |
| `student/interactions.html` — interaction list | *(folded into the lesson detail)* |

`assignments.html` is **kept, not deleted**: it stays the written-preflight surface (the question
form, autosave, Submit), reached from a lesson rather than from the nav. That preserves everything
already built and tested. Orphan assignments with no owning lesson — which
[`COURSE-ADMIN-INVENTORY`](../../site/app/COURSE-ADMIN-INVENTORY.md) and the faculty orphan view
exist to drain — keep resolving there directly, so nothing 404s mid-transition.

New files: `student/lessons.html`, `js/student-lessons.js`.

---

## 4. The state machine (the heart of it)

Every lesson resolves to exactly one state per student. This table is the spec — the UI is a
rendering of it, and the grading tab (Phase 6) reads the same signals.

Inputs: `lessons.completion_policy`, the effective deadline
(`lesson_due_for_student()` — section day + extensions, migration 021), the `responses` row
(`answers`, `is_final`), and the `lesson_completions` row (`path`, `points`, `is_finalized`).

| # | State | Condition | Primary action | Status dot |
|---|---|---|---|---|
| 1 | **Not started** | no completion, no draft, open | Start (→ §5 if `choice`) | grey |
| 2 | **Draft** | `responses.answers` non-empty, `is_final=false`, open | Resume writing | amber |
| 3 | **Submitted (written)** | completion `path='preflight'`, open | Edit answers · *Switch to interactive* | green |
| 4 | **Complete (interactive)** | completion `path='interaction'` | *(none — locked)* · Launch to study | green |
| 5 | **Grading** | completion exists, past due, `is_finalized=false` | View submission | blue |
| 6 | **Graded** | completion `is_finalized=true` | View grade + feedback | green |
| 7 | **Missed** | no completion, past due | *(none)* — 0 pts | red |
| 8 | **Re-opened** | past due **and** `lesson_extension_active()` | Same as 1–3 by content | amber |

Notes that matter:

- **State 3 is not a lock.** The written path stays editable until the deadline (2026-07-16
  decision), so "Submitted" here means *complete*, not *closed*. The copy must say so — the old
  assignment page said "you can edit until the deadline" and that stays true.
- **State 4 is the only lock.** Once a report is submitted the choice is final; the written answers
  are frozen and locked out of grading (kept as research data, never shown as a grade).
- **State 8 is invisible to the student as a distinct state.** An extension just moves the deadline,
  so the lesson quietly behaves as open again. No "you have an extension" badge is specified —
  see §9.

---

## 5. The choice modal

Shown when a `choice` lesson is opened from state 1. Not shown for single-path lessons — those open
their component directly, with no modal and no mention of a path that isn't offered.

```
┌──────────────────────────────────────────────────────────┐
│  Lesson 12 — Magnetic Flux                    Due 2359    │
│  Choose how to complete this lesson.                      │
│  Both are worth the same 2 points. Pick whichever suits    │
│  you — you're graded on effort, not on getting it right.   │
│                                                            │
│  ┌────────────────────────┐  ┌────────────────────────┐   │
│  │  ✎  Written preflight  │  │  ⚡ Interactive lesson │   │
│  │  3 questions           │  │  ~15 min conversation  │   │
│  │  Answer in your own    │  │  Work through it with  │   │
│  │  words. Save and come  │  │  an AI tutor that asks │   │
│  │  back any time before  │  │  questions and gives   │   │
│  │  the deadline.         │  │  feedback as you go.   │   │
│  │        [ Start ]       │  │       [ Launch ↗ ]     │   │
│  └────────────────────────┘  └────────────────────────┘   │
│                                                            │
│  You can switch later — but submitting an interactive      │
│  report locks your written answers out of grading.         │
└──────────────────────────────────────────────────────────┘
```

Built from `.modal` + two `.card`s (`DESIGN.md` §Components). **Neither option is visually
primary** — no default, no recommendation, equal weight. A styled default is a thumb on the scale
of the exact measurement this is here to take (§2).

The switch warning at the bottom is the **first of three**; see §6.

---

## 6. The three warnings

Switching paths is one-way and consequential, so it is warned three times, escalating. The first
two are Phase 5; the third is **already built** (migration 021 + the receiver).

| # | Where | When | Form |
|---|---|---|---|
| 1 | Choice modal footer | Always, on a `choice` lesson | Static line (§5) |
| 2 | **Before launching the artifact** | Launching when written answers exist | Confirm dialog — *"You have N answers saved on the written version. If you submit an interactive report, those answers stop counting and this becomes your grade. You can still launch it to study without submitting."* |
| 3 | **On the submission page** | Submitting when written answers exist | Amber banner + confirm — ✅ **built** ([`interaction-submit.html`](../../site/app/student/interaction-submit.html)) |

Warning 2 is the one this doc adds. It fires on the **launch**, not the submit, because by the time
a cadet reaches the receiver they've already done the interaction — warning them there and having
them back out wastes the work they just did. Note it must *not* block: launching to study is always
legitimate (D8), so it's a confirm, not a refusal.

---

## 7. Study mode

Per D8, launch and view **never close**. A cadet may re-launch a lesson's artifact any number of
times — after submitting, after the deadline, after grading — to study. The artifact ships a study
mode for exactly this.

The launch CTA is therefore present in **every** state where the lesson has an interaction — it is
just a link to the artifact, so running it is never restricted. **The database is the only thing
that limits anything: one accepted submission per lesson.** `pir_due_guard` (migration 021) refuses
the second write, and refuses any write past the effective deadline.

So the copy is one message in every state, not a per-state variant:

> **Launch this lesson any time — to review, or to study. You can run it as many times as you
> like; only your first submitted report counts toward your grade.**

The single exception is state 3 (written answers exist, nothing submitted interactively yet), where
the *first* report is still ahead of them and submitting it would switch their grade. That case is
already covered by warnings 2 and 3 in §6 — it does not need different launch copy.

---

## 8. The dashboard

Keep the shell — `.page-head` → `.stat-grid` → `.dash-section` list stack. It reads well and matches
faculty. Two changes:

**Stat tiles — collapse the double count.** Today: `To do · Overdue · Interactions to do · Average
grade` (four tiles, two of which count the same lesson twice for a `choice` lesson). Proposed:

| Tile | Accent | Source |
|---|---|---|
| To do | blue | lessons in states 1–2 |
| Overdue | red | state 7 |
| Points | green | `SUM(lesson_completions.points)` / `2 × published lessons` |
| Graded | gold | state 6 |

**Points, not percent.** The current tile shows an average percentage of `scores.total_score` —
per-question correctness, which under D3 is no longer what a lesson grade *is*. A lesson is 2 points
of effort, so the honest headline is **points earned of points available**. Keeping a percentage
here would quietly tell cadets they're being graded on correctness, contradicting §2.

**Sections.** `Up next` (states 1–2, by deadline) · `Needs attention` (state 7) · `Recently graded`
(state 6). The standalone "Lesson interactions" section is **removed** — it's the double-count made
visible. Everything routes through a lesson.

Optional, deferred: an **active-lesson spotlight** hero mirroring the faculty dashboard's. Nice, not
load-bearing; the faculty version's M/T ambiguity caveat (§17 of the parent doc) doesn't apply here
since a student has exactly one section and therefore one deadline.

---

## 9. Data layer

New: `js/student-lessons.js`, mirroring [`student-data.js`](../../site/app/js/student-data.js)'s
shape — batched, no N+1, one view-model.

```js
loadLessonStatuses(ctx) -> [{
  id, title, description, lesson_number, completion_policy,
  preflight, interaction,        // joined component rows, either may be null
  due, isPast, isExtended,       // effective deadline (section day + extension)
  draft,                         // { answers, is_final } | null
  completion,                    // { path, points, understanding, is_finalized } | null
  state,                         // 1–8 per §4 — computed once, here
  writtenAnswerCount,            // drives warning 2
}]
```

`state` is computed **once, in the data layer** — not re-derived in each renderer. Today's
[`student-data.js:43-48`](../../site/app/js/student-data.js#L43-L48) already does this for
assignments (`status`), and that pattern is why the dashboard and the list can't disagree. Keep it.

Queries: `lessons` (published, course) → components by id → `responses` + `lesson_completions` +
`extensions` for this student, batched by `.in()`. Reuse `dueDateForSection()` from `util.js`, which
already handles the M/T split and an extension override.

> **Must mirror the DB, not reinvent it.** The effective deadline is defined by
> `lesson_due_for_student()` (migration 021) and enforced by triggers. The client copy exists only
> so the UI can gate *before* the server refuses. If the two disagree, the DB wins and the student
> sees a confusing failure — so any change to one is a change to both.

---

## 10. Component mapping

Everything is already in [`DESIGN.md`](../../site/app/DESIGN.md). Nothing new.

| Need | Existing |
|---|---|
| Lesson row | `.list-item` + `.status-dot` (grey/amber/green/red/blue — already the §4 palette) |
| Choice modal | `.modal` + two `.card`s |
| Stat tiles | `.stat-tile` + `.accent-*` |
| Points / grade | `.score-badge` (`full/partial/zero/pending`) |
| Path taken | `.tag` (blue = written, gold = interactive) |
| Re-opened / past due | `.alert-warn` |
| Submitted | `.alert-ok` |
| Report render | `.md-render` + DOMPurify (as the receiver does) |

The one judgement call: **status dots stay the modality-neutral progress palette**; the `.tag`
carries which path was taken. Colour-coding the *dot* by modality would make one path read as
"better" at a glance across the whole list — the §2 problem again, at list scale.

---

## 11. Sequencing

1. ✅ **Built 2026-07-16** — `js/student-lessons.js`: the data layer + the §4 state machine.
2. ✅ **Built 2026-07-16** — `student/lessons.html`: list + detail.
3. ✅ **Built 2026-07-16** — the choice modal + warning 2.
4. ✅ **Built 2026-07-16** — dashboard rework (§8) + the nav swap to `Dashboard · Lessons`.
5. ⏳ **Remaining** — retire `student/interactions.html` (still present, no longer linked from nav).

**All of it is inert until migration 021 is applied** — without `lesson_completions` rows every
lesson resolves to state 1 and the whole thing renders as "nothing started".

Verified so far (headless Chrome, local server): both pages parse, the import graph resolves,
`bootstrap()` redirects an unauthenticated visitor to login, and every state maps to a dot class the
stylesheet defines. **Nothing behind a login has been exercised** — no student accounts are
provisioned yet, so the states themselves are unverified against real data.

---

## 12. Open questions

- **Should an extension be visible to the student?** §4 state 8 currently says no — the lesson just
  behaves as open. The argument for showing it: a cadet who doesn't know they were granted time may
  not use it. Against: it advertises that extensions exist. *Instructor call.*
- **What does a student see for a superseded written submission?** Their answers exist, are frozen,
  and don't count. Show them read-only ("these no longer count toward your grade") or hide them
  entirely? Read-only is more honest; hiding is simpler. Note warning copy says the answers
  "stop counting", **not** that they're deleted — the row survives for research (D5/§13), so the
  student-facing wording must not claim deletion.
- **Does the legacy [`site/index.html`](../../site/index.html) student page get any of this?** It
  still submits without `is_final` and knows nothing of lessons. If cadets reach it in Fall 2026 it
  needs at minimum the `is_final` change; if not, it should be retired rather than left as a
  divergent second front door.
- **Lesson-scoped extensions have no faculty UI.** Migration 021 adds `extensions.lesson_id`, but
  the only granting surface is the legacy Grade tab's assignment-scoped button. Interaction-only
  lessons therefore can't be extended from any UI until Phase 6 adds one.
