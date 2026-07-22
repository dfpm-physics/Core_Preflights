# PREP Roadmap

**Status:** living document — reviewed 2026-07-22. Unlike `docs/decisions/`, this file is
**refreshed, not superseded**. Update it as items land; do not fork a second copy.

*Authored 2026-07-22 by Casey (via Claude). Consolidates the outstanding-work sweep of the repo
with the course director's feature requests. Companion to
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

### P0.4 — Instructors can read the `__all__` whole-course scope · **S** · *privacy*

`currentAnalysis()` in `faculty/report.html:172-175` maps scope `'all'` → the `'__all__'` AI row for
any viewer. An instructor selecting "All sections" therefore reads the whole-course synthesis, which
the skill contract says is director-only. RLS does **not** enforce this — `analysis_reports` admits
any staff member, so this is a UI rule with nothing behind it.

Fix the UI rule now; consider whether it should be an RLS policy (see P3.9).

### P0.5 — Verification pass in a browser · **M**

Eight CHANGELOG entries record the same gap: **no faculty login is available to the automated
harness**, so roster import, the review page, Grade/Roster, the rollup, and both new edge functions
have never been exercised against the live database by a signed-in human.

This is one session, not eight — a director walkthrough in light and dark mode as all three role
tiers. Everything else in P0 should land first so the pass covers the shipped state.

### P0.6 — Decide the four surfaces promotion deletes · **S** (decision) + **M** (rebuild)

From [`LEGACY-AUDIT-2026-07-20.md`](../site/app/LEGACY-AUDIT-2026-07-20.md): *"Anything not decided
before then is not deferred; it is gone."*

| Surface | Recommendation |
|---|---|
| Report tab copy-for-slides (Show names / copy / anonymise) | Rebuild — folds into the rollup |
| "Did Not Submit (N)" table | Rebuild, and make it actionable (see P1.6) |
| "Show flagged only" toggle on Grade | Rebuild — small |
| `site/review.html` (credential-free grade viewer) | **Delete.** A re-enable away from a FERPA problem |

### P0.7 — Remove every email-reset reference · **S**

*Requested.* Email reset was removed 2026-07-21 but traces remain and actively mislead:

- `site/app/reset.html` — orphaned explainer page, nothing links to it. **Delete.**
- `docs/DOC-SOURCES.json:31` — still lists `reset.html` as a doc source.
- `tests/browser/test-admin.html` and `test-account.html` — still render a "Send reset email" button
  and a six-digit-code modal. These fixtures no longer match the app, so they test a world that
  does not exist.
- Help docs: `instructor-accounts.md`, `student-getting-started.md`, `admin-system-operations.md`.
- `docs/operations/SYSTEM_GUIDE.md`, `supabase/SETUP.md`, `site/app/README.md:18`.

Leave the tombstone comments in `account.js:7-26` and `faculty-admin.js:139-158` — they explain *why*
there is no email recovery, which is the thing a future operator will otherwise try to re-add.

### P0.8 — AI prose is far too long · **M** · *skill work, no schema change*

*Requested.* The rollup reads as machine-written to anyone fluent in AI text patterns, and length is
the main tell. Three panels, all produced by `.ai/skills/lesson-aggregate/SKILL.md`:

| Panel | Now | Target |
|---|---|---|
| `readiness_summary` | Multi-paragraph | **2–3 sentences.** What the class can do, what it can't, nothing else |
| `misconception_trends` | Paragraphs | **2–3 sentences**, naming the specific misconception |
| `misconception_recommendation` | Runs long despite "one line" in the contract | **One imperative sentence.** Enforce a hard character cap in the skill |

This is a prompt-and-cap change in the skill, not a data-model change — the payload shape is
unchanged, so old rows keep rendering. **Write explicit banned patterns** into the skill: no
"it's worth noting", no "Overall,", no three-item parallel lists, no restating the question back.
Cap by characters, not by instruction — an instruction to "be brief" is not a constraint.

**Falsification:** show a director three rollups without telling them which are new. If they cannot
pick the rewritten ones, or still describe them as "AI-sounding", the caps were not the problem.

### P0.9 — Student responses: 3 AI picks + 5 random · **S**

*Requested.* Currently `buildResponses()` (`report.html:481-507`) shows AI picks plus a random
sample with no fixed counts. Set it to exactly 3 AI-selected + 5 additional random, drawn from the
pool excluding the 3 already shown. The aggregator already emits 2–3 quotes per section
(`SKILL.md:309`) — bump it to exactly 3.

**Note:** quotes render on single-section scope only; `__all__` carries none by design.

### P0.10 — Hide the histogram smoothing tuner, keep the code · **S**

*Requested.* `mountKdeTuner()` (`report.html:391-432`) is a director-only floating dev tool. Gate it
behind a flag rather than deleting it — it is self-contained and is the only way to retune the KDE
constants. A `?kde=1` query param or a hidden account preference both work; prefer the query param
so it leaves no persisted state.

### P0.11 — Staff table row heights · **S**

*Requested, and confirmed.* `admin.html:94-104`: the current user's row renders the role as a
`.score-badge` span (~20px), everyone else gets a `<select>` that inherits the global form rule
`padding: 10px 14px` at `font-size: 0.95em` (~40px). There is no `td select` override in
`styles.css`. The select also inherits `width: 100%`, stretching the Role column.

Fix: add a compact in-table select variant (the pattern already exists at `styles.css:1050` for
`.sec-assign select`) and set an explicit row height so badge rows and select rows match. Consider
rendering the current user's row as a disabled select rather than a badge — same box, no special
case, and it reads as "you cannot change your own role" instead of looking like a different kind of
row.

---

## 2. P1 — First weeks of term

### P1.1 — Gradebook view · **XL** · *needs a design doc*

*Requested.* The largest single item on this roadmap and the one most worth designing before
building.

**The hard problem is not the grid, it is that PREP has two grading modes.** Written offerings are
`grading_mode='points'` (points from `question_scores`); interactive lessons are effort-graded 0–5
→ 0–2 by DB trigger. A single points column has to reconcile those, and the answer is a policy
decision, not a rendering decision. **Decide this first** — everything downstream depends on it.

Worth mining from [`djGradebookProject`](file:///C:/01%20--%20AI%20Projects/djGradebookProject):

- **Shortcodes as column headers** (`PF01`, `HW03`) — keeps columns ~5rem. PREP has lesson slugs
  already; derive a short form.
- **Percentage → semantic class**, six bands, one function driving all color everywhere
  (`helpers.py:286` + `style.css:779-808`). The key idea: **zero is its own band** (`critical`,
  missing work) distinct from merely failing (`danger`). PREP's existing 3-state
  (`full`/`warn`/`zero`) covers per-question color; the band scale is for the *totals* columns.
- **`is_bonus`** (counts toward numerator, not denominator) and **`include_prog`** — two booleans
  that avoid needing a weighting engine at all. PREP has no weighting today; adding these two flags
  is far cheaper than adding weights, and may be sufficient.
- Its own grid is the **weakest** part of that project — no sticky columns, no virtualization,
  DataTables pagination. Do not copy it.

PREP should do better on two points: **sticky student-name column + sticky header row** (essential
past ~8 lessons), and a **bounded fetch** — `loadRoster` already fetches every student in the
database and filters client-side (`faculty-roster.js:11`), which a gradebook will make untenable.

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

### P1.4 — EI (Extra Instruction) logging · **M**

*Requested.* On the student detail page, a button opens a modal prefilled with **today's date, the
current local time, and a 30-minute duration**, editable before confirming.

`djGradebookProject`'s `EIVisit` model is deliberately minimal — `date_time`, `notes`, and FKs — and
its interaction pattern is the good part: **log-now-with-one-click, correct-later-in-a-modal**, with
row-click opening the edit modal.

Proposed shape — `app.ei_sessions`: enrolment (or student + offering), staff id, `started_at`,
`duration_minutes`, `notes`, `created_at`. RLS: staff of the offering write and read; **whether the
student can read their own is an open question** (see §4).

Timezone: reuse the `zoneinfo` America/Denver handling from
`scripts/fall2026/build_fall_preflights.py`. Store UTC, render local.

### P1.5 — Understanding-by-objective as an integer histogram · **M**

*Requested.* Replace the current per-objective rows (`report.html:639-653`) with an integer
histogram matching the effort histogram (`effortChart`, `report.html:601`), **with an account
preference to switch back to the current style. Default off for everyone.**

Both are computed locally in `faculty-rollup.js` from `report_data` — no AI text, no schema change,
so this is presentation only. **Depends on P1.3** (nowhere to store the toggle otherwise).

### P1.6 — Dashboard: outstanding tasks panel · **M**

*Requested.* A per-user task list. The user notes none of these tasks exist yet — so the deliverable
is **the surface and its plumbing**, with sources registered as they appear.

Likely first sources, all of which already exist as data:
- Lessons past due with ungraded submissions (`lesson_aggregate.py worklist` already answers this)
- Grades suggested by AI but not finalized (`is_finalized=false`)
- Sections with no staff assigned (Section Coverage already computes this)
- A failed or stuck analysis run (`analysis_runs`, already surfaced by the run banner)

Design it as a registry — each source contributes `{severity, text, link, count}` — so adding a
source later is not a rewrite. Take the **empty state** seriously: `djGradebookProject` gives every
dashboard widget a cheerful one ("All caught up!"), and a task panel that is blank half the term
needs one.

### P1.7 — Dashboard course switcher · **S**

*Requested.* The dashboard delegates course switching to the global nav
(`dashboard.html:29`); the user wants inline buttons like the rollup's section switcher.

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

*Answering the direct question:* it is the count of staff in this offering who hold a
`staff_assignments` row with `section_id IS NULL` — i.e. director-shaped, covering everything —
excluding global admins, who hold no staff row at all.

**It is the same number on every tile.** `admin.html:155` computes `wide` without ever referencing
the section it is being rendered under, so a director scanning the grid sees an identical "+6"
repeated on every card and learns nothing section-specific from it.

Fix in the P1.10 rework: either name the people (they are already loaded), or state it once above
the grid as "6 staff cover all sections", or drop it. A per-offering constant rendered per-section
is noise.

---

## 3. P2 — Before end of term

### P2.1 — Blackboard grade export · **L**

*Requested.* Grades must leave the system at term end, and there is no LMS export today —
`djGradebookProject` has none either (its exports are human-readable Excel), so **there is no
in-house precedent to copy.** This is novel work.

The user has offered to supply real Blackboard files. **Take them early.** The entire risk here is
column-header format and student-key matching, and both are answerable in an hour with a real file
and unanswerable without one.

Design notes:
- Match on the registrar student id, not name or email.
- Blackboard column headers encode the column id; a hand-built header will be rejected on upload.
- **Test with a throwaway Blackboard course before the real one.** A rejected or misaligned grade
  upload at term end is the highest-consequence failure on this roadmap.

Start this in P1 time even though it is due in P2 — the lead time is in the round-trip testing, not
the code.

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

### P2.3 — Progress-grade checkpoints · **M** · *proposed, not requested*

`djGradebookProject` freezes a `Checkpoint` row per student at report time (`prog` and `final`), and
its final report prints prog alongside final so you can see movement. Given USAFA prog grades, PREP
will want the same. Flagged here so it is considered before term end rather than reconstructed
after.

---

## 4. P3 — Between terms

### P3.1 — Course creation by instructors · **L**

*Requested.* Two halves:

1. **Any instructor can create a course and becomes its director.** Mechanically small; the
   governance question is whether an offering minted by anyone is acceptable. Recommendation: allow
   it, scoped so the creator gets `director` on **that offering only**, and system admins retain
   visibility across all. This is how `djGradebookProject` behaves and it has not caused problems
   there — though that project is single-user.
2. **A create flow from the dashboard.** `djGradebookProject`'s pattern is good and directly
   portable: a grid of course cards where **the last card is a dashed-border "＋ Add New Course"**,
   the selected course carries a badge, and inactive courses collapse into a separate low-opacity
   section.

Two behaviors from its `Course.save()` worth stealing: **derive the code and semester from raw
inputs** rather than asking for them, and **auto-provision defaults on create** (it creates a
default grading scale and selects it, then flashes a warning that defaults were applied) so a new
course is never left unconfigured.

Depends on `003_term_calendar.sql` semantics — a new course needs a term, sections, and a director
staff assignment created atomically.

### P3.2 — One import pipeline, several adapters · **XL** · *needs a design doc*

*Requested as three separate items — Gradescope, Teams, "other sources". Propose treating them as
one.*

`djGradebookProject` has four importers (roster, Teams, Gradescope, WebAssign) sharing **one flow**,
and that flow is the most reusable architecture in that project:

> **parse → preview (with an explicit unmatched-students list) → confirm → commit**

with format auto-detection by column sniffing, and the staged import abandoned on navigation away.
Its Gradescope adapter matches on `SID`; its Teams adapter matches on email and maps a `Tag` column
onto an assignment category.

Three things there are worth copying exactly:
- **The unmatched-students list is the whole point of the preview.** Every import fails the same
  way — a handful of students do not match — and surfacing that before commit is what makes the
  feature safe.
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
artifact-factory skill in the Claude project.

`flags` is already a field in the frozen `schema: 1` contract
(`docs/contracts/INTERACTION-DATA-CONTRACT.md`), but the **values are not enumerated** — so the
artifact invents them and `/lesson-aggregate` cannot reliably aggregate across lessons.

**The real problem is synchronization.** The artifact-factory skill lives in a Claude project,
outside this repo. A taxonomy maintained in two places will drift, and the drift is silent — the
artifact keeps emitting flags nobody reads.

Recommendation: **the repo file is the source of truth**, the Claude project references it by URL
(the raw GitHub Pages path is stable), and the file states its own version. Adding a flag is
additive and never removes one, because deployed artifacts outlive the taxonomy that made them.

Note this also **expands what `/lesson-aggregate` can report** — a stable flag vocabulary is what
would let trends be counted rather than described.

### P3.4 — Term rollover / course copy · **L** · *proposed, not requested*

Fall 2026 will end, and Spring 2027 will want the same 40 lessons with a new roster and new
deadlines. Today that is `scripts/fall2026/build_fall_preflights.py` — a term-specific script.
Copying an offering (lessons and questions, not submissions or grades) with recomputed deadlines is
the general form, and it is far easier to design now, with one term of structure to look at, than
under time pressure in December.

### P3.5 — Grade-change audit log · **M** · *proposed*

`analysis_runs` records who ran an analysis. Nothing records who changed a **score**. With AI
suggesting grades and humans finalizing them, "who set this and when" is a question that will be
asked, and it cannot be answered retroactively.

### P3.6 — Accessibility pass · **M** · *proposed*

Bundle with the gradebook, because a dense grid is where accessibility problems become severe:
keyboard navigation, focus order, screen-reader table semantics, and contrast in both themes. The
drag-and-drop in P1.10 makes this concrete — **drag-only is a keyboard trap**, which is why P1.10
requires the dropdown path as well.

### P3.7 — Performance budget · **S** to **M** · *proposed*

`loadRoster` fetches every student in the database and filters client-side
(`faculty-roster.js:11`) — noted in the plan as "fine today; won't be." The gradebook is what makes
it not fine. Set a target (e.g. any faculty page interactive in under 2s with 400 students across
40 lessons) before building the grid, not after.

### P3.8 — Mobile and tablet · **M** · *proposed*

EI logging is the forcing case: an instructor logs a session while standing in their office, on a
phone. If that flow is desktop-only, it will not be used. It does not require the whole app to be
responsive — decide which flows are mobile-first and design those.

### P3.9 — RLS for scope and cross-section reads · **M** · *proposed*

P0.4 fixes a privacy rule in the UI. `analysis_reports` admits any staff member of the offering, so
several director-only conventions (`__all__`, the run banner's director filter) are UI-only.
Decide deliberately which of those should be enforced in the database. Some genuinely should stay
conventions; the point is that today it is not a decision, it is a default.

---

## 5. C — Cleanup and debt

| Item | Where | Note |
|---|---|---|
| `lesson_aggregate.py` misdiagnoses a cross-course slug collision as a stale offering | `supabase/admin/lesson_aggregate.py:456-459` | Following its advice would have deactivated a live phys-110 offering |
| All three `prep_app_*` roles carry `BYPASSRLS`, including the SELECT-only read role | CHANGELOG:704 | "Worth a second look" — the read role should not bypass RLS |
| `main` predates the `extensions.reason` NOT NULL constraint | CHANGELOG:706-709 | Harmless today (zero extensions); resolved by P0.1 |
| Edge functions never exercised on a successful path | CHANGELOG:473-475 | Covered by P0.5 |
| `LESSON-UNIFICATION.md` never got its owed supersession banner | CHANGELOG:2019-2020 | Doc still reads as a live plan |
| Stale port-status rows in `COURSE-ADMIN-INVENTORY.md`, `site/app/README.md` | PLAN-2026-07-16-ADMIN.md:165-170 | Several claim work that shipped |
| `COURSE-ADMIN-INVENTORY.md` §2D describes a system-admin guard that never existed | LEGACY-AUDIT:45-48 | Risk: a future operator "restores" unsafe behavior |
| Remove `scripts/training/seed_training_preflight02.py` data | script header | **Before the real roster upload** — ordering matters |
| Five help docs still carry the "Starter stub" blockquote | docs-author SKILL.md:155-160 | Three still marked; `ai-and-your-work.md` needs director review before term |
| `$PREP_CONFIG` neutralization (decided, not executed) | CORE.md:162-165 | One coordinated PR across every script + skill + doc |
| No spacing/size scale token — padding is hand-tuned px | DESIGN.md:487-491 | Radius, shadow, color are tokenized; spacing is not |
| Section lifecycle CRUD (create/rename/retire) | PLAN-2026-07-16-ADMIN.md:236-237 | Sections are only ever born as a side effect of roster upload |
| `js/ui.js` — real confirm/toast replacing `alert()`/`confirm()` | PLAN-2026-07-16-ADMIN.md:242-243 | Worth it once more destructive operations exist |
| Zero-point questions are a hidden, undocumented mode switch | LEGACY-AUDIT:92-100 | Load-bearing; make explicit in the lesson creator |
| Q1 anonymity is hard-coded by **position**, not by question property | LEGACY-AUDIT:102-108 | Attach the property to the question |
| No delete-assignment control anywhere | LEGACY-AUDIT:119-124 | "An oversight, not a decision" |
| Tier D system-admin password reset — mocked, unbuilt | PLAN-2026-07-20-ACCOUNTS.md:3 | Known gap; decide whether it stays one |
| 81 cadets keep fabricated `<id>@usafa.edu` addresses | CHANGELOG:411-412 | Needs a decision plus a migrate-login-emails action |
| `student/interactions.html` still present, no longer linked | STUDENT-LESSON-VIEW.md:264 | Retire |
| Pending: is `faculty/interactions.html` deleted once the rollup absorbs its panels? | CHANGELOG:1352-1353 | Decision |

---

## 6. Open questions for the course director

These block or reshape items above. Each needs an answer, not a build.

### Q1 — Should a system admin be able to hold a *lower* role in a course?

*The director's own question: "or is this a dumb idea that will make access too convoluted?"*

**Not dumb — but the framing is dangerous, and splitting it in two resolves it.**

The underlying need is real: a system admin who is not that course's director wants to see what an
instructor sees, and still act as an admin when needed. That is a **preview**, and it is a good
feature.

The problem is storing it as an **access level**. A persisted downgrade creates three failures:

1. **It cannot be enforced.** RLS grants on the *actual* role. A stored downgrade is cosmetic —
   the API still returns everything. Building a control that looks like a safety boundary and is not
   one is worse than not building it.
2. **Audit ambiguity.** If a person can be two things, every action needs "at what level" recorded
   alongside "by whom", and every existing row lacks it.
3. **A support trap.** A director who downgraded three weeks ago and forgot now reports a missing
   button as a bug.

**Recommendation:** build it as an **ephemeral "View as instructor" toggle** — session-only, never
persisted, with a visible banner naming the active view and a one-click exit. Not a stored setting,
not a role, and never described as one. The account page grows a *courses I'm involved with* panel
(read-only, which the account page already partly renders at `account.js:70-119`) plus that toggle.

**Falsification:** if the banner gets dismissed or ignored and someone reports "PREP hid my
buttons", the ephemerality is not visible enough and the feature should be pulled rather than
persisted.

### Q2 — How do points and effort reconcile into one gradebook column? (blocks P1.1)

Written offerings are points-based; interactive lessons are effort 0–2. Options: normalize both to
percent; keep two column groups with separate totals; or weight them. **This is a grading-policy
decision, not a technical one, and the gradebook cannot be designed without it.**

### Q3 — Can a student see their own EI log? (blocks P1.4 RLS)

Instructor-only is the simpler and more private default. Student-visible makes it a record they can
check. **Recommend instructor-only to start** — it is additive to open it later and breaking to
close it.

### Q4 — Should the taxonomy in P3.3 be versioned, and what happens to a deployed artifact using a retired flag?

Deployed artifacts outlive the taxonomy. Recommend: additive-only, never remove, and the aggregator
ignores unknown flags rather than erroring.

### Q5 — Do "connections to other sources" (P3.2) mean *import only*, or two-way sync?

Import-only is a weekend per adapter. Two-way sync is a different project with conflict resolution
at its center. **Assumed import-only** throughout this roadmap.

---

## 7. Proposed additions — director's call

Not requested; offered for inclusion or rejection. Ordered by how strongly I would argue for them.

| # | Proposal | Why | Est. |
|---|---|---|---|
| 1 | **Students-at-risk widget** with the rule shown on screen | `djGradebookProject` displays its criterion (`<70% or 3+ missing`) as the subtitle. Transparency about the threshold is what makes the list trusted rather than argued with | S |
| 2 | **Late / extension handling surface** | Extensions and late submissions are graded by hand *on purpose* (that is why `worklist --latest` refuses to look backwards) — but there is **no faculty UI** for lesson-scoped extensions. The one deliberate manual workflow in the system is the one with no screen | M |
| 3 | **Term rollover** (P3.4, restated) | The single largest predictable pain point, and cheapest to design now | L |
| 4 | **Print / PDF advising view** | The Comment Card covers copy-paste; a printable one-pager covers the meeting where a laptop is closed | S |
| 5 | **Bulk EI logging** | A review session with six cadets is one event, not six modals | S |
| 6 | **Grade-change audit log** (P3.5, restated) | Unanswerable retroactively — the data has to be captured from the start | M |
| 7 | **In-app notifications** | There is no SMTP and there will not be, so any nudge (ungraded work, failed run, missing submission) must be in-app. The run banner is already this pattern with one source | M |
| 8 | **Question bank / lesson reuse** | Lessons are built by a term-specific script today. Reuse across terms is P3.4's other half | M |
| 9 | **Data retention & archival policy** | FERPA. How long do submissions live, who can read a prior term, and when is `public` finally dropped (still an open question in `PREP-V2-SCHEMA.md` §8) | S (decision) |
| 10 | **Live grading-scale tuner** | `djGradebookProject`'s best screen: threshold inputs beside a plot with every student as a point, so you drag the B+ line and watch who moves. Only worth it if PREP ever adopts letter grades | M |
| 11 | **Order of Merit (class rank) column** | Standard at USAFA; trivial once the gradebook totals exist | S |
| 12 | **Random groups generator** | Small, self-contained, genuinely used in that project | S |
| 13 | **Seven-palette theming** | `djGradebookProject` does this in pure CSS custom properties with zero framework. PREP's `DESIGN.md` is already token-based, so it is nearly free — but it is polish, and it is last for a reason | S |

---

## 8. What I would do first

If the next working session picks up one thing: **P0.1 (cutover) and P0.3 (test suites) together.**
The suites are the only proof that the schema the cutover promotes is safe, and they are currently
red. Everything else in P0 is small and can be batched into a single pass afterward, ending with
P0.5's browser verification so it covers the shipped state rather than an intermediate one.

The gradebook (P1.1) is the biggest item here and the one most likely to go wrong if started early.
It needs **Q2 answered** before a line of it is written.
