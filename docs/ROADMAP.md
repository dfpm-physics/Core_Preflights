# PREP Roadmap

**Status:** living document — reviewed 2026-07-22, revised same day with the course director's
decisions and a verification pass against the code. Unlike `docs/decisions/`, this file is
**refreshed, not superseded**. Update it as items land; do not fork a second copy.

*Authored 2026-07-22 by Casey (via Claude). Consolidates the outstanding-work sweep of the repo
with the course director's feature requests and decisions. Companion to
[`operations/PREP-V2-CUTOVER.md`](operations/PREP-V2-CUTOVER.md),
[`../site/app/LEGACY-AUDIT-2026-07-20.md`](../site/app/LEGACY-AUDIT-2026-07-20.md), and
[`../CHANGELOG.md`](../CHANGELOG.md).*

> **Nothing in this file is authorization to build.** Items are scoped and ordered, not approved.
> Every item still passes through the CORE.md §0 coordination gate before it touches the live system.

---

## 0. The constraint that orders everything

**Fall 2026 opens 2026-08-10.** That is ~19 days from this writing. The roadmap is organized around
one question — *what must be true on the first day a cadet signs in* — and everything else falls
behind it.

A useful test for any item below: **if this is missing on day one, does a cadet or an instructor hit
a wall?** Grading, rollups, and rosters answer yes. The gradebook, EI logging, and Blackboard export
answer no — they are needed within weeks, not on day one.

**Priority bands:**

| Band | Meaning |
|---|---|
| **P0** | Ship-blocking for 2026-08-10 |
| **P1** | First weeks of term — needed while teaching, not at open |
| **P2** | Before end of term — grades must leave the system |
| **P3** | Between terms — new capability, needs design time |
| **C** | Cleanup / debt — no deadline, but it compounds |

**Size:** S ≈ hours · M ≈ a day · L ≈ several days · XL ≈ needs its own design doc first.

---

## 1. P0 — Ship-blocking for 2026-08-10

### P0.1 — Complete the v2 cutover (Phase 4) · **L**

Phases 1–3 are effectively done (the `app` chain 007–009 is applied, `site/app/` reads `app`), but
the runbook was never refreshed and Phase 4 has not run. Remaining: promote the app tree onto the
frozen contract URLs, delete the legacy root pages, push.

- **Blocker:** the promotion deletes `site/admin.html`. Its replacements exist
  (`site/app/faculty/admin.html` Staff + Export tabs, shipped 2026-07-20), so this is no longer
  gated — but §5 of the legacy audit lists four surfaces that vanish undecided (see P0.6).
- **Hard rule:** `site/student/interaction-submit.html` and `site/faculty/lessons.html` must resolve
  identically before and after. If promotion cannot preserve them exactly, abort.
- **Also:** refresh `PREP-V2-CUTOVER.md:3`, the three `PREP-V2-*` doc status headers, and
  `CORE.md:38` — all still claim `app` is unwired.

### P0.2 — Seal `prep_app_owner` · **S**

`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres`. Flagged three separate times in CHANGELOG and
never closed. **Human-only** — no agent role holds `CREATEROLE`. Do this *after* P0.1, since the
cutover may still need DDL.

### P0.3 — Revive the two dead DB test suites · **M**

Both currently die in setup and therefore **guard nothing**:

- `app_invariant_test.py` — fixture inserts a random uuid into `instructors`, which has an FK to
  `auth.users`. Needs a real auth user in the fixture.
- `app_rls_test.py` — inserts an `extensions` row with no `reason`; migration `007` made it NOT NULL.

These are the only automated proof that RLS holds. Shipping a term with them red means the four
July 2026 audit findings are unverified.

### P0.4 — Instructors can read the `__all__` whole-course scope · ✅ **RESOLVED 2026-07-22 — by a different decision**

The original recommendation was to stop an instructor's "All sections" from reading `__all__`. **The
course director decided otherwise: All Sections stays visible to everyone**, and is simply no longer
the default. That is their call to make — the whole-course read is useful context, and the panel was
never a privacy boundary in the sense the sweep implied (RLS grants `analysis_reports` to any staff
member of the offering regardless).

What actually shipped removes the *harm* without removing the *view*:

- **"My sections" is the new default scope for everyone**, so nobody's first view is a cohort they
  do not teach. That alone resolves the practical complaint.
- **The readiness summary moved to instructor scope**, so what an instructor reads by default is
  written about their own sections.
- **When "All sections" is selected and the viewer cannot load the whole roster, the panel says so**
  — `meta.n` (the true course-wide count) is compared to the rows actually summarized, and a mismatch
  renders an explicit line. Previously whole-course prose sat silently above partial numbers.

Still true, and still worth a deliberate decision: none of this is enforced in the database. See P3.9.

### P0.5 — Verification pass in a browser · **M**

Eight CHANGELOG entries record the same gap: **no faculty login is available to the automated
harness**, so roster import, the review page, Grade/Roster, the rollup, and both new edge functions
have never been exercised against the live database by a signed-in human.

This is one session, not eight — a director walkthrough in light and dark mode as all three role
tiers. Everything else in P0 should land first so the pass covers the shipped state.

**Added 2026-07-22** — the four frontend fixes shipped that day are logic-verified and syntax-clean
but **have not been looked at**, and each is a visual change that only an eye can confirm:

- **Staff table** (P0.11) — rows equal height; your own row a disabled select; Role column no longer
  stretched. Check as a director *and* as a global admin, whose row renders the third variant
  (`implicit — no staff row`).
- **Late chip + Late-only filter** (P0.12) — needs a genuinely late submission and one covered by an
  extension, to confirm the second is *not* badged. Confirm the toggle is invisible when nothing is
  late.
- **Student responses** (P0.9) — 3 AI + 5 random = 8 cards, and the Shuffle control still reshuffles
  only the random 5.
- **KDE tuner** (P0.10) — absent from a plain rollup, present with `?kde=1` as a director, absent
  with `?kde=1` as an instructor.

### P0.6 — Decide the four surfaces promotion deletes · **S** (decision) + **M** (rebuild)

From [`LEGACY-AUDIT-2026-07-20.md`](../site/app/LEGACY-AUDIT-2026-07-20.md): *"Anything not decided
before then is not deferred; it is gone."*

| Surface | Recommendation |
|---|---|
| Report tab copy-for-slides (Show names / copy / anonymise) | Rebuild — folds into the rollup |
| "Did Not Submit (N)" table | Rebuild, and make it actionable (see P1.6) |
| "Show flagged only" toggle on Grade | Rebuild — small |
| `site/review.html` (credential-free grade viewer) | **Delete.** A re-enable away from a FERPA problem |

### P0.7 — Remove every email-reset reference · ✅ **RESOLVED 2026-07-22 — mostly a non-issue**

*Requested. On inspection this item was largely wrong, and acting on it as written would have made
the system worse. Recorded in full so it is not "fixed" again later.*

**What the sweep called a problem, and what it actually is:**

| Flagged | Verdict |
|---|---|
| `site/app/reset.html` — "orphaned, delete it" | **KEPT.** It is not an email-reset flow; it is the page that tells a locked-out person there *is* no email reset and who to ask instead. Its own header explains why it outlived the flow: the login page linked there for a year, so bookmarks and history still point at it, and a 404 is the worst possible answer at the moment someone is locked out. Deleting it would remove the one thing that redirects them correctly. |
| `DOC-SOURCES.json` listing `reset.html` as a source | **KEPT.** A correct dependency — `student-getting-started.md` was written from that page. Not a stale entry. |
| Help docs mentioning reset | **KEPT.** Every mention is a *denial* ("PREP cannot email you a reset link", "there is no reset link to send"). They are the tombstones, correctly phrased. |
| `tests/browser/test-account.html` | **KEPT.** Already carries a "Superseded 2026-07-21" banner and a comment reading *"Kept as the design record of the emailed-code flow, NOT as a picture of the system."* Deliberate archive. |
| `tests/browser/test-admin.html` | **FIXED** — the one real defect. It rendered "Send reset email" with **no** supersession marker, unlike its sibling. Given the same banner, and its "Password operations" card relabelled `Planned` → `Superseded` (the email tier was removed; the system-admin tier was never built). |

**The general lesson, worth keeping:** a reference to a removed feature is not automatically debt.
A *denial* of it is documentation. Only an artifact that still presents the removed feature as
available needed changing, and exactly one did.

Left alone deliberately: the tombstone comments in `account.js:7-26` and `faculty-admin.js:139-158`,
which explain *why* there is no email recovery — the thing a future operator will otherwise try to
re-add.

### P0.8 — AI prose is far too long · ✅ **DONE 2026-07-22**

*Requested.* Length was the main tell. Resolved harder than scoped — one of the three panels was
deleted rather than shortened.

| Panel | Was | Now |
|---|---|---|
| `readiness_summary` | ≤ 8000 chars, multi-paragraph | **≤ 1200, 2–3 sentences**, enforced by the writer |
| `misconception_trends` | ≤ 8000 chars, paragraphs | **Retired.** Not written, not rendered |
| `misconception_recommendation` | ran long despite "one line" | **One imperative sentence**, ≤ 1200, single-paragraph check |
| `section_notes[].note` *(new)* | — | ≤ 400 each, ≤ 12 |

**Trends went away rather than shrinking** because the bars beneath it now carry each
misconception's own description and student evidence (P0.13) — so the paragraph restating them had
nothing left to say, while still costing an AI panel and a "coming soon" placeholder under
fully-populated bars.

**Caps are enforced in `lesson_aggregate.py`, not requested in prose** — an instruction to "be
brief" is not a constraint. The skill also now bans the specific tells: no `Overall,` /
`It's worth noting` openers, no three-item parallel lists, no restating the question back, no
hedging stacks, and "name the physics" over "gaps in conceptual understanding".

**Falsification (unchanged, and still owed):** show a director three rollups without saying which
are new. If they cannot pick the rewritten ones, the caps were not the problem.

### P0.9 — Student responses: 3 AI picks + 5 random · ✅ **DONE 2026-07-22**

*Requested.* The panel capped itself at ~5 cards **total** via `randN = Math.max(0, 5 - ai.length)`,
so every AI pick displaced a random one — meaning a well-analysed section showed the *least*
unfiltered student writing. Inverted: the random sample is now a fixed 5, independent of the AI
count, bounded only by the pool. The panel is 8 cards where the section has the material.

- `report.html` `responsesSection()` — `RANDOM_N = 5`, `randN = Math.min(RANDOM_N, pool.length)`.
  The eyebrow note and Shuffle control follow the real count.
- `.ai/skills/lesson-aggregate/SKILL.md` — `selected_quotes` changed from "2-3 each" to **exactly
  3**, in all four places it was stated, with an explicit note that emitting fewer now shrinks the
  showcase without widening anything else, and that padding to 3 with a weak pick is wrong.

**Unchanged by design:** quotes render on single-section scope only; `__all__` carries none.

### P0.10 — Hide the histogram smoothing tuner, keep the code · ✅ **DONE 2026-07-22**

*Requested.* `mountKdeTuner()` was mounted for **every** director on **every** rollup, where a
floating panel of unexplained sliders reads as part of the product rather than the dev tool it is.

Now reached by **`?kde=1` only**, still director-gated on top of that. Code untouched and fully
working — it is the only thing that regenerates the KDE const line. To retune:
`report.html?i=<slug>&kde=1`.

Deliberately a query param rather than an account preference: it leaves no persisted state, so a
director cannot switch it on, forget, and file the panel as a bug three weeks later.

### P0.11 — Staff table row heights · ✅ **DONE 2026-07-22**

*Requested, and confirmed as diagnosed.* Your own row rendered a `.score-badge` (~20px); every other
row carried a `<select>` inheriting the global form rule `padding: 10px 14px` at `0.95em` (~40px)
plus `width: 100%`. No `td select` override existed. Result: the one row you always look at was the
odd one out, and the Role column stretched.

Both halves fixed:

- **`admin.html`** — your own row now renders the **same `<select>`, disabled**, instead of a badge.
  Same box, no special case, and it states "you cannot change your own role" in the place the role
  is changed. The change handler is scoped `[data-role-for]:not([disabled])`.
- **`styles.css`** — new `.staff-tbl` block: `vertical-align: middle`, a `.role-cell` flex box with
  `min-height: 30px` so the text-only *implicit* rows still occupy a select-sized cell, and a
  compact in-table select (`width: auto; min-width: 128px; padding: 5px 8px`) following the existing
  `.sec-assign select` house pattern.

### P0.12 — A late submission is invisible on the grade card · ✅ **DONE 2026-07-22**

**Shipped:** a new `submissionLateness()` + `lateBy()` pair in `schema.js` (beside `effectiveDue`,
which answers a different question — clock-vs-deadline, not commit-vs-deadline), an amber `⏰ N days
late` chip on the grade card beside the extension chip, and a **Late only** filter that ANDs with
the status lamps and hides itself entirely when nothing is late.

**Extensions are honoured** — a student granted until Friday who submitted Thursday is not badged.
That is the case the whole feature turns on, and it is covered by the harness below.

Amber, not red: arriving late is a fact the grader should see, not a verdict. Whether it costs
credit stays the instructor's call, and late work is routinely accepted by hand on purpose.

*Verified:* 16/16 in a dedicated logic harness (on-time · 4-days-late · inside-extension ·
past-extension · M/T section override both ways · draft · no-deadline · 30s clock-skew grace ·
unparseable timestamp · label boundaries · `effectiveDue` regression guard), plus the full
`tests/app-schema` suite green at 339/0. **Not yet seen in a browser** — folded into P0.5.

<details><summary>Original diagnosis (kept for context)</summary>

*The director asked "don't these show up in the Grade tab?" — they do, but you cannot tell which
ones are late.*

- `loadGradingData()` (`faculty-grade.js:93-103`) filters only by offering and enrolment. **Nothing
  compares against `due_at`.**
- The grade card (`grade.html:263-270`) renders name, section, finalized tag, provenance tag,
  extension chip, total — **no lateness indicator.**
- `committed_at` *is* fetched and shaped as `committedAt` (`schema.js:33-36`, `:154`) but is consumed
  in exactly one place repo-wide (`student-lessons.js:107`). **It is never compared to a deadline
  anywhere in the faculty UI.**
- There is no late filter and no late sort — the only filters are the three full/warn/zero lamps
  (`grade.html:336-368`), sorted alphabetically (`faculty-grade.js:86`).

The data is already loaded, so this is a badge and a filter, not a query change. Compare
`committedAt` against `effectiveDue()` — which already exists at `faculty-grade.js:552` and correctly
accounts for extensions — and render a chip beside the extension chip.

**In P0 because it affects grading from the first lesson**, it is small, and getting it wrong means
an instructor silently gives full credit to work that arrived four days late.

*(Note: the assignment-level `pastDueUngraded()` queue at `faculty-grade.js:506-571` already counts
these correctly. The gap is purely per-submission visibility once you open the assignment.)*

</details>

### P0.13 — Rollup rework: scopes, self-explaining misconceptions, misconception bucketing · ✅ **DONE 2026-07-22**

*Requested mid-stream, ahead of the P0.1 cutover. Groups several changes that share one payload
contract.*

**Display**
- **"My sections" scope, default for everyone** — the sections you personally teach, combined.
  `taughtSectionIds()` reads section-scoped staff rows only; a director's offering-wide row grants
  sight of every section but is not a teaching assignment, so it does not count. Teach none → falls
  back to All sections; teach all → the option is hidden as a duplicate.
- **All sections** stays available to everyone, no longer the default (see P0.4).
- **A single section shows its own numbers, quotes and recommendation, but its instructor's summary.**
- **Every misconception bar explains itself** — hover or click for a popover carrying the
  misconception's description, up to two verbatim (unattributed) student quotes, any coined ids that
  folded onto it, and the canonical id. Keyboard- and touch-reachable: the row is a real `<button>`
  with `aria-expanded`, Escape closes.
- **"Show all N" toggle** on student responses — swaps the 5-card random sample for the entire pool,
  AI picks still pinned on top. Reading every reflection previously meant opening students one at a
  time.

**Skill / data**
- **The readiness summary is written per instructor**, across every section they teach, with
  per-section departures as structured `section_notes[]` rendered with the section code in bold.
  Two sections taught by one person used to get two isolated paragraphs that could not be compared.
- **Misconception ids are canonicalized** at both counting sites — `canonMisconceptionId()` in JS and
  the mirrored `re.sub` in `lesson_aggregate.py`. `scalar-sum`, `Scalar-Sum` and `scalar sum` were
  three separate bars; reading-reflection topics had been trimmed and lowercased since day one while
  ids never were.
- **The clustering is finally persisted.** `/lesson-aggregate` was told to "fold novel ones into
  known buckets" but had nowhere to put the fold, so it was written as prose and discarded — the bars
  it sat under never changed and the work was redone every run. New offering-level
  `misconception_aliases` (variant → canonical) and `misconception_glossary` maps, merged across
  day-scoped runs, applied by the browser at render time.
- **`/preflight-analyze` matches before it coins.** A four-step resolution order, the first step
  being *query the ids already recorded against this assignment across every offering and term* —
  a self-maintaining bucket that grows as lessons are analyzed. Nothing validates a misconception
  id anywhere in the system, and the taxonomy covers 3 lessons of ~74, so the pressure to invent was
  constant and unchecked.
- **`description` and `evidence` survive to the cohort view.** Both producers emitted them, the
  aggregator received them, and both counting sites dropped them — which is why a bar could show
  `57%` and nothing about what the misconception was.

*Verified:* `test-rollup.mjs` 160/0 (30 new, covering canonicalization, alias folds, glossary
backfill, instructor scopes, and `taughtSectionIds`) · `aggregate_summarize_test.py` ALL PASS with a
new JS↔Python parity block · full `tests/app-schema` run exit 0. **Two real bugs were caught by
those parity tests**, not by review: the variant list compared only lowercase while the id also
collapses whitespace, so `scalar sum` was reported as a "variant" of the id it normalizes to.

**Not yet seen in a browser** — folded into P0.5.

---

## 2. P1 — First weeks of term

### P1.1 — Gradebook view · **L** · *unblocked — the scale question is already answered by the data*

*Requested.* Still the largest item here, but **materially smaller than first scoped.** The
open question that was going to block it turned out to be already resolved in the schema:

**Both modalities already land on the same 2-point grade — by two different mechanisms.** Keep the
two layers straight; conflating them is how this gets built wrong:

- **Measurement is 0–5 and is very much live.** `q2_effort` and `q3_understanding` are 0–5 integers
  in `grades.diagnostic` (`preflight-analyze/SKILL.md:319-320`); the schema:1 payload carries
  `effort` 0–5 (clamped to 2 when the reading reflection is not meaningful) and
  `overall_understanding` 0–5 (`SKILL.md:569-570`). The interactive artifact emits effort on the same
  0–5 scale.
- **The grade is 2 points**, reached two ways:

| Modality | `grading_mode` | How points are set | Result |
|---|---|---|---|
| Interactive lesson | `effort` | DB trigger `001_core_model.sql:579-584`: `effort ≥3 → possible` · `≥1 → possible/2` · `else 0` | Full effort **2**; capped effort (clamped to 2) **1** |
| Written preflight | `points` | `question_scores` — Q1 `points: 0`, Q2 reflection `1`, Q3 free response `1` (`build_fall_preflights.py:216,235-236`; identical in `build_110_preflights.py:219,236-237`) | Reflection **1** + free response **1** = **2** |

On the written path `effort` is **diagnostic only and must not be written to `grades.effort`** —
those offerings are `grading_mode='points'` and the trigger would seize `points_earned`
(`WRITTEN-SCHEMA1.md:118-121`).

Offering ceiling for both: `points_possible numeric(6,2) NOT NULL DEFAULT 2`
(`001_core_model.sql:255`).

**So no normalization layer is needed.** Both paths write `grades.points_earned` against the same
`points_possible`, so the gradebook sums them directly and is correct by construction. The 0–5
scales stay available underneath for the per-student view (P1.2) and the rollup histograms (P1.5).

⚠️ **`PROJECT.md:91-98` will mislead whoever builds this** — it shows `scores.question_scores` with
q1/q2/q3 each `"max": 5`, i.e. 15 points per preflight. **Only that per-question points shape is
retired** (both Fall builders now write 0/1/1); the 0–5 effort and understanding scales documented
elsewhere in the same file are current. Fix the example block, leave the diagnostics section alone
(see §5).

Design notes, with `djGradebookProject` mined for what is worth taking:

- **Shortcodes as column headers** (`PF01`, `HW03`) keep columns ~5rem wide. Derive a short form from
  the lesson slug.
- **Percentage → semantic class**, six bands, one function driving all color everywhere
  (`helpers.py:286` + `style.css:779-808`). The key idea worth stealing: **zero is its own band**
  (missing work) distinct from merely failing. PREP's 3-state (`full`/`warn`/`zero`) already covers
  per-question color; the band scale is for the *totals* columns.
- **`is_bonus`** (numerator only) and **`include_prog`** — two booleans that avoid needing a weighting
  engine at all. PREP has no weighting today, and these two flags may be sufficient forever.
- Its own grid is the **weakest** part of that project — no sticky columns, no virtualization,
  DataTables pagination. Do not copy it.

PREP should do better on two points: **sticky student-name column + sticky header row** (essential
past ~8 lessons), and a **bounded fetch** — `loadRoster` already fetches every student in the
database and filters client-side (`faculty-roster.js:11`), which a gradebook makes untenable.

Depends on: P1.2 (name click target), P1.3 (settings persistence, for column prefs).

### P1.2 — Per-student detail page · **L**

*Requested.* Reached by clicking a name in the gradebook. Shows completion, effort levels,
understanding levels, free-response answers, interactive reports, and whatever assignment types come
later.

`djGradebookProject`'s `student_view.html` is a strong template — three stat cards (identity /
performance / class comparison), performance-by-category bars, missing-work table, all-assignments
table. Two ideas there are worth taking wholesale:

- **The Comment Card** — an auto-assembled advising blurb (grade, per-category breakdown, missing
  work with due dates, EI attendance and dates, plus a free-text box) with a **Copy to Clipboard**
  button. Instructors paste it into an email or an advising system. This is exactly the "copy for
  slides" muscle the Report tab already has (P0.6), pointed at one student.
- **`back_url` from the referrer** — "Done" returns you wherever you came from, so the page works
  equally as a gradebook drill-down and a roster drill-down.

**FERPA note:** this page concentrates everything about one cadet on one screen. Instructor access
must be section-scoped in **RLS**, not just in the UI.

### P1.3 — Persist user and account settings · **M**

*Requested.* Today preferences are **localStorage only** and `account.js:182-194` says so
deliberately: `cp.theme`, `cp.currentOffering`, a nav-open key, and run-banner dismissals. Nothing
survives a device change.

Recommended: an `app.user_preferences` table keyed on the auth user id, with RLS restricted to self,
and a single jsonb `prefs` column so adding a preference is not a migration.

**Keep localStorage as a write-through cache.** The theme is read by an inline anti-FOUC script at
line 7 of *every* HTML file, before any module loads — a DB round-trip there would reintroduce the
flash. Write both; read local first, reconcile from the DB after sign-in.

This item is a **dependency for P1.5** (the understanding-histogram toggle) and for any per-user
gradebook column preferences.

### P1.4 — EI (Extra Instruction) logging, single and bulk · **M**

*Requested.* On the student detail page, a button opens a modal prefilled with **today's date, the
current local time, and a 30-minute duration**, editable before confirming.

**Bulk logging is core to this item, not an add-on.** The director's actual use case is the ~20
minutes at the end of every class when students hang around to ask questions — so the common event
is *several students at once, most days*, not a scheduled one-on-one. A design that only logs one
student at a time will be abandoned by week three. Build the roster-multi-select path in the same
pass: pick a date/time/duration once, tick the students who were there, log.

`djGradebookProject`'s `EIVisit` model is deliberately minimal — `date_time`, `notes`, FKs — and its
interaction pattern is the good part: **log-now-with-one-click, correct-later-in-a-modal**, with
row-click opening the edit modal.

Proposed shape — `app.ei_sessions`: enrolment (or student + offering), staff id, `started_at`,
`duration_minutes`, `notes`, `created_at`. **RLS: staff of the offering only — students cannot read
their own** (director's decision; additive to open later, breaking to close).

Timezone: reuse the `zoneinfo` America/Denver handling from
`scripts/fall2026/build_fall_preflights.py`. Store UTC, render local.

### P1.5 — Understanding-by-objective as an integer histogram · **M**

*Requested.* Replace the current per-objective rows (`report.html:639-653`) with an integer
histogram matching the effort histogram (`effortChart`, `report.html:601`), **with an account
preference to switch back to the current style. Default off for everyone.**

Both are computed locally in `faculty-rollup.js` from `report_data` — no AI text, no schema change,
so this is presentation only. **Depends on P1.3** (nowhere to store the toggle otherwise).

### P1.6 — Dashboard: outstanding tasks panel · **M**

*Requested.* A per-user task list. The director notes none of these tasks exist yet — so the
deliverable is **the surface and its plumbing**, with sources registered as they appear.

Likely first sources, all of which already exist as data:
- Lessons past due with ungraded submissions (`lesson_aggregate.py worklist` already answers this)
- Grades suggested by AI but not finalized (`is_finalized=false`)
- Sections with no staff assigned (Section Coverage already computes this)
- A failed or stuck analysis run (`analysis_runs`, already surfaced by the run banner)

Design it as a registry — each source contributes `{severity, text, link, count}` — so adding a
source later is not a rewrite. Take the **empty state** seriously: `djGradebookProject` gives every
dashboard widget a cheerful one ("All caught up!"), and a task panel blank half the term needs one.

### P1.7 — Dashboard course switcher · **S**

*Requested.* The dashboard delegates course switching to the global nav
(`dashboard.html:29`); the director wants inline buttons like the rollup's section switcher.

Copy `renderScope()` (`report.html:179-197`) — it is already the right component: a `.seg`
segmented group below a threshold, falling back to a `<select>` with counts above it. Point it at
`ctx.courses` and `ctx.setCurrentOffering()`.

Its current section control (`faculty-dashboard.js:264-267`) only toggles all-vs-mine and cannot
pick an individual section — worth fixing in the same pass.

### P1.8 — EI stats on the dashboard · **S**

*Requested.* Depends on P1.4. `djGradebookProject`'s `get_ei_stats()` is the right scope: total
visits, unique students, and the last five — two big numbers and a mini-table, nothing more.

### P1.9 — Move enrollment out of Roster into its own tab · **M**

*Requested.* Roster import currently lives entirely in `site/app/faculty/roster.html` +
`js/roster-import.js` + `js/faculty-roster.js`.

Recommended: a new **Enrollment** tab visible only to directors and system admins, holding import,
reconciliation, and section placement. The parsing module is already pure and DOM-free, so this is a
re-mount, not a rewrite. Leave day-to-day roster viewing where instructors expect it.

### P1.10 — Section assignment: drag-and-drop, in Course Admin · **M**

*Requested.* Three separate complaints, worth separating:

1. **Wrong location.** Assignment happens in a per-person modal on the Staff tab
   (`admin.html:217-238`); it belongs on the Section Coverage grid in Course Admin.
2. **Tickboxes are the wrong control.** Wanted: drag a name onto a section tile, *or* click a
   section and pick from a dropdown. `djGradebookProject` uses SortableJS + a post-on-drop handler
   in ~25 lines; the same shape works against Supabase. **Provide the dropdown path too** — drag and
   drop alone is a keyboard-accessibility failure and is unusable on a tablet.
3. **The modal text about directors is wrong.** It currently reads: *"Leave everything unticked to
   give them all sections of this offering. That is how a director is recorded, and it covers
   sections added later."* This describes the **data encoding**, not the role, and it implies a
   director does not teach. **Directors also teach sections** — the copy must say so, and the new UI
   should let a director hold both offering-wide coverage and a named section without that reading
   as a contradiction.

### P1.11 — Fix "+6 offering-wide" · **S**

*Answering the director's direct question:* it is the count of staff in this offering who hold a
`staff_assignments` row with `section_id IS NULL` — i.e. director-shaped, covering everything —
excluding global admins, who hold no staff row at all.

**It is the same number on every tile.** `admin.html:155` computes `wide` without ever referencing
the section it is being rendered under, so a director scanning the grid sees an identical "+6"
repeated on every card and learns nothing section-specific from it.

Fix in the P1.10 rework: either name the people (they are already loaded), or state it once above
the grid as "6 staff cover all sections", or drop it. A per-offering constant rendered per-section
is noise.

### P1.12 — Bulk / whole-section extensions · **M** · *new*

*The extension half of the director's "we need a way to grade this" — verified as partially built.*

**What already exists:** per-student grant/edit/remove in the Grade tab (`grade.html:239`, modal at
`:79-81`, write at `faculty-grade.js:327-340`), plus a director oversight page
(`faculty/extensions.html`) that is **read + revoke only**.

**What does not:** any lesson-scoped, section-wide, or bulk grant. Every write is keyed
`(enrollment_id, assignment_offering_id)` (`faculty-grade.js:339`). Extending a whole section after a
cancelled class means clicking through students one at a time — which is exactly when it is needed
and exactly when nobody will do it.

Add a bulk grant on the extensions page: pick an offering, pick a section or a multi-select of
students, one due date, one reason (`reason` is NOT NULL and non-blank-checked by
`007_extension_governance_and_review.sql:79-82`).

### P1.13 — Container for unrecognized flags · **S** · *new, director-specified*

*Director's Q4 decision: surface unknown flags in the summary so an instructor can see what the AI
writing them was thinking.*

**Verified gap:** both flag surfaces enumerate a **hardcoded 5-key whitelist** —
`report.html:659-665` (the pill bar: `notable`, `needs_follow_up`, `refl_capped`, `honor_disclosed`,
`honor_concern`) and `faculty-rollup.js:653-657` (the rollup counts only two booleans). A novel flag
key emitted by the artifact or by `/preflight-analyze` is **silently dropped everywhere.**

The one existing hook is `report.html:794`, which renders `flags.note` as free text inside the
per-student panel. Widen that from a single `note` key to arbitrary residual keys: anything not in
the whitelist renders as `key — detail` in an "Other flags" block, uncounted and unstyled, visible
in the summary section.

This is the **cheap half of P3.3** and worth doing first — it makes the taxonomy work observable
before the taxonomy exists, and it means an artifact emitting a flag nobody planned for is a
discovery rather than a silent loss.

---

## 3. P2 — Before end of term

### P2.1 — Blackboard grade export · **L**

*Requested.* Grades must leave the system at term end, and there is no LMS export today —
`djGradebookProject` has none either (its exports are human-readable Excel), so **there is no
in-house precedent to copy.** This is novel work.

The director has offered to supply real Blackboard files. **Take them early.** The entire risk here
is column-header format and student-key matching, and both are answerable in an hour with a real
file and unanswerable without one.

Design notes:
- Match on the registrar student id, not name or email.
- Blackboard column headers encode the column id; a hand-built header will be rejected on upload.
- **Test with a throwaway Blackboard course before the real one.** A rejected or misaligned grade
  upload at term end is the highest-consequence failure on this roadmap.

Start this in P1 time even though it is due in P2 — the lead time is in the round-trip testing, not
the code. A direct API connection (rather than file exchange) is desirable but **not expected to
happen** (director, Q5); design for files.

### P2.2 — Full JSON backup, done properly · **M**

*Requested — and the existing one is real but incomplete.* `buildBackup()`
(`faculty-admin.js:242-272`) is correctly course-scoped and director-gated, and exports offerings,
enrollments, submissions, and grades. It **omits**:

- **`analysis_reports`** — every readiness summary, trend, recommendation, and quote selection. This
  is the most expensive data in the system to regenerate and the most important thing to back up.
- **`sections`** — `enrollments[].section_id` exports as a bare uuid with no code anywhere in the
  file, so section identity is unrecoverable from the backup alone.
- **`submission_activities`** — the interactive artifact rows.
- **`staff_assignments`** — who ran the offering.

Add those four. Then **verify a restore**, because a backup that has never been restored is a
hypothesis, not a backup.

### P2.3 — Data retention and archival policy · **S** (decision) · *director: TBD, add it*

How long do submissions live · who may read a prior term · when is `public` finally dropped (still
open in `PREP-V2-SCHEMA.md` §8) · what happens to a graduated cadet's record. FERPA-adjacent, and a
decision rather than a build. Route to `docs/decisions/` when answered.

---

## 4. P3 — Between terms

### P3.1 — Course creation by instructors · **L**

*Requested.* Two halves:

1. **Any instructor can create a course and becomes its director.** Mechanically small; the
   governance question is whether an offering minted by anyone is acceptable. Recommendation: allow
   it, scoped so the creator gets `director` on **that offering only**, and system admins retain
   visibility across all.
2. **A create flow from the dashboard.** `djGradebookProject`'s pattern is directly portable: a grid
   of course cards where **the last card is a dashed-border "＋ Add New Course"**, the selected course
   carries a badge, and inactive courses collapse into a separate low-opacity section.

Two behaviors from its `Course.save()` worth stealing: **derive the code and semester from raw
inputs** rather than asking for them, and **auto-provision defaults on create** so a new course is
never left unconfigured.

Depends on `003_term_calendar.sql` semantics — a new course needs a term, sections, and a director
staff assignment created atomically.

### P3.2 — One import pipeline, several adapters · **XL** · *needs a design doc*

*Requested as three items — Gradescope, Teams, "other sources". Propose treating them as one.*
**Import-only** (director, Q5).

`djGradebookProject` has four importers (roster, Teams, Gradescope, WebAssign) sharing **one flow**,
and that flow is the most reusable architecture in that project:

> **parse → preview (with an explicit unmatched-students list) → confirm → commit**

with format auto-detection by column sniffing, and the staged import abandoned on navigation away.
Its Gradescope adapter matches on `SID`; its Teams adapter matches on email and maps a `Tag` column
onto an assignment category.

Three things worth copying exactly:
- **The unmatched-students list is the whole point of the preview.** Every import fails the same
  way — a handful of students do not match — and surfacing that before commit is what makes it safe.
- **Due-date-aware semantics:** its WebAssign importer only marks an assignment graded once its due
  date has passed, and only converts "not submitted" sentinels to zeros after the due date. Without
  that rule, importing mid-term tanks every average.
- **Name-pattern inference** — `"Preflight 7 - Vectors"` → `PF07`, type `Preflight`.

Two things **not** to copy: pickling staged imports into the session, and building preview HTML by
string concatenation server-side.

PREP's roster importer already has the right bones — `roster-import.js` is pure, DOM-free, and
unit-tested. Generalize it into an adapter interface rather than writing three more importers.

### P3.3 — Artifact flag taxonomy · **M**

*Requested.* A canonical enumerated list of flags the artifact should apply, made available to the
artifact-factory skill in the Claude project. **Do P1.13 first** — the unknown-flag container makes
this work observable.

`flags` is already a field in the frozen `schema: 1` contract
(`docs/contracts/INTERACTION-DATA-CONTRACT.md`), but the **values are not enumerated** — so the
artifact invents them and `/lesson-aggregate` cannot aggregate across lessons.

**The real problem is synchronization.** The artifact-factory skill lives in a Claude project,
outside this repo. A taxonomy maintained in two places will drift, and the drift is silent — the
artifact keeps emitting flags nobody reads.

Recommendation: **the repo file is the source of truth**, the Claude project references it by URL
(the raw GitHub Pages path is stable), and the file states its own version. Adding a flag is
additive and never removes one, because deployed artifacts outlive the taxonomy that made them.
Per the director's Q4 decision, the aggregator **surfaces** unknown flags rather than erroring or
dropping them.

### P3.4 — Term rollover · **L** · *director: yes*

Fall 2026 will end and Spring 2027 will want the same lessons with a new roster and new deadlines.

**Verified — cross-term reuse already works, and is automatic.** The three-layer model does it:
`assignments` is the term-agnostic container (`001_core_model.sql:130-133`), `activities` holds
content (`:139-155`), and `assignment_offerings` is one term's run (`:272-275`). Scheduling the same
assignment into a new course offering reuses the same activities. The library picker at
`lessons.html:337-349` is the UI, and it correctly offers only assignments not already scheduled
this term. Past cohorts are protected by `content_snapshot`, frozen at publish (`:265`, `:276-279`).

**So the director is right that reuse is handled.** Two real gaps remain:

- **No duplicate/clone.** Confirmed absent from `site/app/`, and already a known gap
  (`site/app/README.md:94`, `PLAN-2026-07-16-ADMIN.md:45`, legacy had `duplicateAssignment`). Reuse
  ≠ making a *variant* of a lesson.
- **No rollover flow.** Creating next term's offering, scheduling 40 assignments into it, and
  recomputing 40 deadlines is currently the term-specific
  `scripts/fall2026/build_fall_preflights.py`. Generalizing that is the actual work.

*(A question bank is **not** wanted — director's call. The library picker is the reuse mechanism.)*

### P3.5 — Grade audit log · **S** · *mostly built already*

*Director: yes, and instructors should be able to correct any grade.* Verification found most of
this already shipped:

- **`grade_events` audit rows are already written** on finalize and reopen
  (`faculty-grade.js:290-296`, `:302-311`).
- **Provenance is already tracked** — `grades.source` (`'instructor'` vs `'ai_suggested'`),
  `graded_by`, `graded_at` (`faculty-grade.js:257-260`), stamped only when that student's card was
  actually edited (a fixed bug, documented at `:205-221`), and surfaced as a tag at
  `grade.html:227-230`.

Remaining: cover plain saves (not just finalize/reopen), and give the director a readable view of the
trail. Small.

**On manual correction** — an instructor today cycles a 3-state toggle (`grade.html:294-298`); there
is **no numeric field.** On the current 2-point scale that toggle already spans the whole achievable
range (0 or the question's 1 point), so **nothing is actually unreachable today.** It becomes a real
gap the moment a non-preflight assignment type with a wider range exists — so tie the numeric
override to P1.1's gradebook work rather than building it now.

### P3.6 — Accessibility pass · **M**

Bundle with the gradebook, because a dense grid is where accessibility problems become severe:
keyboard navigation, focus order, screen-reader table semantics, contrast in both themes. P1.10 makes
this concrete — **drag-only is a keyboard trap**, which is why P1.10 requires the dropdown path too.

### P3.7 — Performance budget · **S** to **M**

`loadRoster` fetches every student in the database and filters client-side
(`faculty-roster.js:11`) — noted in the plan as "fine today; won't be." The gradebook is what makes
it not fine. Set a target (e.g. any faculty page interactive under 2s with 400 students across 40
lessons) before building the grid, not after.

### P3.8 — Mobile and tablet · **M**

EI logging is the forcing case, and P1.4's bulk-logging use case sharpens it: an instructor logging
six students at the end of class is standing up, not sitting at a desk. If that flow is desktop-only
it will not be used. Decide which flows are mobile-first and design those; the rest can stay desktop.

### P3.9 — RLS for scope and cross-section reads · **M**

P0.4 fixes a privacy rule in the UI. `analysis_reports` admits any staff member of the offering, so
several director-only conventions (`__all__`, the run banner's director filter) are UI-only. Decide
deliberately which should be enforced in the database. Some genuinely should stay conventions; the
point is that today it is not a decision, it is a default.

### P3.10 — Ephemeral "View as instructor" toggle · **M** · *director: yes*

A system admin or director previews a course as a lower tier. **Session-only, never persisted**, with
a visible banner naming the active view and a one-click exit.

The reasoning for keeping it ephemeral (rather than a stored access level) is recorded in §6 Q1 —
briefly: RLS grants on the *actual* role, so a persisted downgrade would be cosmetic while the API
still returns everything, and building something that looks like a safety boundary but is not one is
worse than not building it.

The account page grows a read-only **"courses I'm involved with"** panel alongside it — `account.js:70-119`
already renders most of that data.

### P3.11 — Course report generator (midterm + final) · **L** · *conditional*

*Director: needed if we ever transfer all grades in.* Merges three ideas — grade reports, progress
checkpoints, and Order of Merit — into one deliverable, because they are one screen.

`djGradebookProject`'s report is the model: columns `OM | Name | Score | Grade | GPA | [Prog Score |
Prog Grade] | <per-category totals> | Total`, sorted by score descending with rank inserted as `OM`.
Generating a report **freezes a `Checkpoint` row per student** (`prog` / `final`), and the final
report reads the prog checkpoint back so movement is visible. Below the roster it appends class
stats and a term-over-term GPA history for the same course code.

**Gated on the gradebook holding more than preflights.** Until then there is nothing to report on.

### P3.12 — Students-at-risk widget · **S** · *conditional*

*Director: yes, but not until the gradebook holds all content, not just preflights.* Possible earlier
partial: trigger on low understanding across multiple consecutive preflights — the data for that
exists today in `grades.diagnostic`, though the director is unsure it is a good signal. Worth a look
once a few lessons of real Fall data exist.

Take `djGradebookProject`'s transparency: it **displays the criterion** (`<70% or 3+ missing`) as the
widget subtitle. Showing the rule is what makes the list trusted rather than argued with.

### P3.13 — Student nudges for due work · **S** · *lower than assumed*

*Director: "they should really see all of that clearly in their dashboard."* **They already do.**
Verified: `student/dashboard.html` has four stat tiles (To do / Missed / Points / Graded), an
"Up next" section, a "Needs attention" section rendered only when non-empty, and seven distinct
states in `student-lessons.js:31-39` — including `MISSED` (red, past due with nothing submitted) and
`DRAFT` (amber, saved but not submitted).

So the dashboard requirement is met. An active nudge is a genuinely separate feature, and since
there is no SMTP and never will be, it can only be in-app — which means it only reaches a student who
already opened the dashboard that shows the same thing. **Low value; keep it parked** unless
non-submission rates say otherwise once the term is running.

### P3.14 — Random groups generator · **S** · *director: nice to have*

Shuffle a section into N groups or groups of size N. Small, self-contained, genuinely used in
`djGradebookProject`.

### P3.15 — Color palette theming · **S** · *director: very low priority*

`djGradebookProject` does seven palettes in pure CSS custom properties, zero framework, as
`body.palette-x { --color-accent: … }` overrides. PREP's `DESIGN.md` is already token-based so it is
nearly free — but it is polish. Last.

---

## 5. C — Cleanup and debt

**Cleared 2026-07-22:** `PROJECT.md`'s `question_scores` example (now `grades.question_scores` at
0/1/1, with an explicit warning not to "correct" the 0–5 diagnostics alongside it) ·
`LESSON-UNIFICATION.md` supersession banner · `COURSE-ADMIN-INVENTORY.md` §2D and its stale
port-status rows · `site/app/README.md` "Not yet ported" · `student/interactions.html` deleted.

| Item | Where | Note |
|---|---|---|
| ⚠️ **`check_doc_sources.py` is red — 11 documents flagged** | run it | **Pre-existing, not caused by the 2026-07-22 batch.** Dominated by a `CORE.md` edit earlier that day plus the skills touched by it. Deliberately *not* cleared by bulk-bumping `reviewed` dates — that is precisely the failure the mechanism exists to prevent. Clearing it properly means reading each of the 11 against its sources; it overlaps the help-doc stub expansion below, so do them together. **Verified harmless for the gradebook:** no help doc states a points value, so the `question_scores` correction did not invalidate any of them |
| `lesson_aggregate.py` misdiagnoses a cross-course slug collision as a stale offering | `supabase/admin/lesson_aggregate.py:456-459` | Following its advice would have deactivated a live phys-110 offering |
| All three `prep_app_*` roles carry `BYPASSRLS`, including the SELECT-only read role | CHANGELOG:704 | The read role should not bypass RLS |
| `main` predates the `extensions.reason` NOT NULL constraint | CHANGELOG:706-709 | Harmless today (zero extensions); resolved by P0.1 |
| Edge functions never exercised on a successful path | CHANGELOG:473-475 | Covered by P0.5 |
| Remove `scripts/training/seed_training_preflight02.py` data | script header | **Before the real roster upload** — ordering matters |
| Five help docs still carry the "Starter stub" blockquote | docs-author SKILL.md:155-160 | `ai-and-your-work.md` needs director review before term |
| `$PREP_CONFIG` neutralization (decided, not executed) | CORE.md:162-165 | One coordinated PR across every script + skill + doc |
| No spacing/size scale token — padding is hand-tuned px | DESIGN.md:487-491 | Radius, shadow, color are tokenized; spacing is not |
| Section lifecycle CRUD (create/rename/retire) | PLAN-2026-07-16-ADMIN.md:236-237 | Sections are only ever born as a side effect of roster upload |
| `js/ui.js` — real confirm/toast replacing `alert()`/`confirm()` | PLAN-2026-07-16-ADMIN.md:242-243 | Worth it once more destructive operations exist |
| Zero-point questions are a hidden, undocumented mode switch | LEGACY-AUDIT:92-100 | Load-bearing (`grade.html:207,215` hides them); make explicit in the lesson creator |
| Q1 anonymity is hard-coded by **position**, not by question property | LEGACY-AUDIT:102-108 | Attach the property to the question |
| No delete-assignment control anywhere | LEGACY-AUDIT:119-124 | "An oversight, not a decision" |
| No lesson duplicate/clone | `site/app/README.md:94` | Reuse works; making a *variant* does not. Feeds P3.4 |
| Tier D system-admin password reset — mocked, unbuilt | PLAN-2026-07-20-ACCOUNTS.md:3 | Decide whether it stays a known gap |
| 81 cadets keep fabricated `<id>@usafa.edu` addresses | CHANGELOG:411-412 | Needs a decision plus a migrate-login-emails action |
| ~~Is `faculty/interactions.html` deleted once the rollup absorbs its panels?~~ | CHANGELOG:1352-1353 | ✅ **Answered — it already was**, on 2026-07-20 (`nav.js:22`). Discovered 2026-07-22 while retiring the *student* page. Several docs still describe it as present and load-bearing (`COURSE-ADMIN-INVENTORY.md` §2E "cannot be deleted until that moves", `PLAN-2026-07-16-ADMIN.md` T2.1) — **worth a sweep**, since anything reasoning from those will reach wrong conclusions about what promotion still costs |

---

## 6. Decisions on record

*Answered by the course director 2026-07-22. Recorded here so the reasoning is not re-litigated.*

### Q1 — Can a system admin hold a *lower* role in a course? — **Ephemeral toggle only. ✔**

The need is real: a system admin who is not that course's director wants to see what an instructor
sees, and still act as an admin when needed. That is a **preview**, and it is a good feature.

Storing it as an **access level** was rejected, for three reasons:

1. **It cannot be enforced.** RLS grants on the *actual* role. A stored downgrade is cosmetic — the
   API still returns everything. Building a control that looks like a safety boundary and is not one
   is worse than not building it.
2. **Audit ambiguity.** If a person can be two things, every action needs "at what level" recorded
   alongside "by whom", and every existing row lacks it.
3. **A support trap.** A director who downgraded three weeks ago and forgot now reports a missing
   button as a bug.

→ **P3.10.** Session-only, visible banner, one-click exit. Never persisted, never called a role.

**Falsification:** if the banner gets ignored and someone reports "PREP hid my buttons", the
ephemerality is not visible enough and the feature should be pulled rather than persisted.

### Q2 — How do points and effort reconcile? — **They already do. ✔ No work needed.**

Two layers, both live:

- **Measurement stays 0–5** — `q2_effort`, `q3_understanding`, schema:1 `effort` (clamped to 2 on a
  non-meaningful reflection) and `overall_understanding`. Not retired, not changing.
- **The grade is 2 points**, reached two ways: interactive via the effort trigger (full effort 2,
  capped 1); written via `question_scores` (reflection 1 + free response 1, Q1 zero-point).

Verified against `001_core_model.sql:255,579-584`, `preflight-analyze/SKILL.md:319-320,569-570`,
`WRITTEN-SCHEMA1.md:118-121`, and both Fall builders. **This unblocks P1.1** — no normalization
layer.

*(Caveat: `PROJECT.md:91-98`'s `question_scores` example still shows the retired 5-points-per-question
shape. That block only — the 0–5 diagnostics documented elsewhere in that file are correct. See §5.)*

### Q3 — Can a student see their own EI log? — **No. ✔**

RLS: staff of the offering only. Additive to open later, breaking to close.

### Q4 — What happens to unknown flags? — **Surface them with their detail. ✔**

A container in the summary section showing unrecognized flags and what the AI writing them was
thinking. → **P1.13** (the container) and **P3.3** (the taxonomy). Never drop silently, never error.

### Q5 — Import only, or two-way? — **Import only, except Blackboard. ✔**

A direct Blackboard export/import connection would be nice but is **not expected to happen** — design
P2.1 for file exchange.

---

## 7. What I would do first

**Done 2026-07-22:** the docs batch, plus P0.9 / P0.10 / P0.11 / P0.12 — the four small frontend
fixes — and P0.7 closed as largely a non-issue. Seven roadmap items cleared without touching the
database or the cutover.

**Next: P0.1 (cutover) and P0.3 (test suites) together.** The suites are the only proof that the
schema the cutover promotes is safe, and they are still red — note this is the `supabase/admin/`
pair (`app_invariant_test.py`, `app_rls_test.py`), *not* `tests/app-schema`, which passes 339/0.
Then **P0.5's browser pass**, which now also covers the four fixes above.

**P1.1's blocker is gone** — the 2-point scale is already uniform across both modalities, so the
gradebook is now a rendering-and-performance problem rather than a grading-policy one. Fix the stale
`PROJECT.md` shape (§5) before anyone starts it.

**Start P2.1 (Blackboard) during P1.** Its risk is entirely in round-trip testing with a real file,
and that lead time cannot be compressed at term end.
