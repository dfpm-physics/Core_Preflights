# Changelog

A running log of notable changes to the Core Preflights system. Each entry records
**what** changed, **who** made it, and **why**, so future maintainers (and Claude)
can understand the history without re-deriving it from code or git.

Newest entries first. Dates are `YYYY-MM-DD`.

---

## 2026-06-23 — Matthew Recker

### Added — synthetic seed for previewing the interaction rollup

New [`supabase/seed_demo_interaction.sql`](supabase/seed_demo_interaction.sql) populates a clearly-fake
demo interaction (`demo-rollup-sandbox`, an unpublished draft) with one synthetic `schema:1` report per
real student in a course, so the faculty rollup (`summarizeReports()` in
[`app/js/faculty-interactions.js`](app/js/faculty-interactions.js)) can be previewed with realistic data
before any real artifact submissions exist. Run it in the Supabase SQL Editor (runs as `postgres`, so it
bypasses the RLS rule that otherwise only lets a student write their own report). Variety (effort 0–5,
decorrelated understanding, misconceptions from the Preflight-1 taxonomy, reading-reflection gate, honor
statuses, triage flags) is derived deterministically from `student_id`, so re-runs are stable; effort and
understanding are decorrelated on purpose to exercise the "full effort, low understanding" case. Scopes to
real students' real sections via `sections.course_id` (matching how the rollup loads data) and never touches
a real interaction or a real submission. Includes a copy/paste rollup-preview query for each UI aggregate and
a one-line cascade teardown. Conforms to `INTERACTION-DATA-CONTRACT.md` (schema 1).

### Changed — rebranded the platform to **iPREP**

Renamed the website's user-facing brand to **iPREP** (*interactive Pre-lesson Readiness Engagement
Platform*). Updated the `app/` portal nav brand + footer ([`app/js/nav.js`](app/js/nav.js)), the
login screen (now shows the full name as a tagline, [`app/login.html`](app/login.html)), every
`app/` page `<title>`, and the legacy page headers/titles (`index.html`, `admin.html`,
`review.html`, `interactions.html`, `interactions-admin.html`, `artifact-submit.html`). The
repository, GitHub Pages path, and CSV/JSON export filenames stay `Core_Preflights` on purpose —
renaming them would break deployed-artifact links (the frozen data contract), bookmarks, and
existing Blackboard grade imports. Documented the brand-vs-repo distinction at the top of
`.claude/CLAUDE.md`.

### Added — interaction summaries (numeric rollups from `report_data`)

Built the per-lesson **summary** that the data contract said the site computes without AI. The
faculty report modal ([`app/faculty/interactions.html`](app/faculty/interactions.html)) now shows a
live, section-scoped rollup over every in-scope report: effort average + points + an effort 0–5
distribution, completion, assessed-vs-self-rated understanding with the confidence gap, per-objective
understanding bars, misconception counts, reading-reflection meaningful-rate / effort-capped count /
sentiment / topic tags, and integrity + triage-flag tallies. All numbers are folded from
`report_data` (schema 1) by a new pure aggregator `summarizeReports()` + fetcher `loadInteractionData()`
in [`app/js/faculty-interactions.js`](app/js/faculty-interactions.js), coercing out-of-range/wrong-typed
LLM output defensively. Each individual report also gets a structured panel above the Markdown (effort,
understanding, objectives, misconceptions, reflection, honor, flags, and the artifact's per-student AI
narrative). Students now see their own effort/points on the interactions page
([`app/js/student-data.js`](app/js/student-data.js), [`app/student/interactions.html`](app/student/interactions.html)).
The **free-text trend prose** that genuinely needs the AI aggregation pass — the cohort narrative,
clustering of novel/free-text misconceptions, and reflection-theme synthesis — is rendered as labeled
`[placeholder]` blocks pending that pipeline. Styles added to [`app/css/styles.css`](app/css/styles.css).

### Added — generalized artifact receiver (`artifact-submit.html`)

Built the receiver that realizes the v1 data contract. New
[`artifact-submit.html`](artifact-submit.html) (based on the old `interaction-submit.html`)
parses the `#t=`/`#i=`/`#r=`/`#d=` hash payload: reserved type (only `interaction` in v1, others
rejected), decompresses the Markdown report and the optional structured JSON, validates `effort`
as an integer 0–5 (else null), requires student login, and upserts `report_markdown`,
`report_data`, and `effort` into `preflight_interaction_reports` (the `score` column is left to
the migration-013 trigger; never written by the client). Structured data is handled defensively —
malformed JSON is stored under `{_unparsed}` rather than dropped, and structured fields are only
written when present so an older artifact (no `#d=`) re-submitting can't wipe them. The signed-in
view and the post-submit status now show the assessed effort and the points it maps to.
[`interaction-submit.html`](interaction-submit.html) is now a hash-preserving redirect to the new
receiver, so artifacts deployed before the rename keep working. Updated the references in
`INTERACTION-PREFILL-LINK.md` and `app/README.md`.

### Added — locked v1 data contract for lesson-artifact submissions

Wrote [`INTERACTION-DATA-CONTRACT.md`](INTERACTION-DATA-CONTRACT.md): the frozen contract
between a claude.ai lesson artifact and the site's static receiver. Pins a generalized
permanent endpoint (`artifact-submit.html` at the repo root, excluded from the `app/` refactor;
legacy `interaction-submit.html` stays as a hash-preserving redirect so deployed artifacts
never break), the URL-hash transport (reserved `#t=` artifact-type defaulting to `interaction`,
`#i=` slug, `#r=` full Markdown report, optional `#d=` structured JSON, lz-string codec,
student identity resolved from session not payload), and the `schema: 1` structured payload.
Key modeling decisions baked in: **effort is the only grade-bearing field** (engagement, not
correctness — full conversation + zero understanding still earns full marks; refusal/tangents
score low), with a 0–5 engagement rubric and a **reading-reflection gate** (a non-meaningful
reflection caps effort at 2); understanding, per-objective scores, misconceptions, and AI
narrative are **diagnostic only**; misconception/objective entries are **self-describing**
(carry their own label/description) so the aggregator needs no short-code dictionary;
numeric/categorical fields are sized for the website to compute all rollups deterministically,
leaving the AI only the text fields to scan for trends. Over-captured optional fields
(`ai_summary`, `key_strengths`, `recommended_review`, per-objective `confidence`,
`reading_reflection.meaningful`) since deployed artifacts can't be retrofitted. Includes the
versioning policy (additive-only within v1, `schema: 2` for breaking changes) and size budget.

### Added — DB migration 013: interaction effort → auto score

[`supabase/migrations/013_interaction_effort_score.sql`](supabase/migrations/013_interaction_effort_score.sql)
adds `effort` (0–5) and a trigger-derived `score` (0–2) to `preflight_interaction_reports`:
effort 3–5 → 2 pts, 1–2 → 1 pt, 0/NULL → 0 pts. `score` is recomputed from `effort` on every
write, so a student can't post a score independent of effort; legacy rows stay untouched (NULL)
until re-submitted. Also adds a 32 KB `CHECK` on `report_data` and a `(interaction_id, score)`
index for rollups. Apply via the Supabase SQL editor / migration runner.

---

## 2026-06-22 — Matthew Recker

### Added — per-lesson export for the analysis aggregator

Settled the interaction-analysis data contract: the aggregator is fed the plain `report_markdown`
(no structured `report_data`/view route for now). Name + student ID + score is **not treated as
PII**, so reports are exported as-is — protection is the existing faculty auth + RLS, not content
redaction. New function in [`app/js/faculty-interactions.js`](app/js/faculty-interactions.js):

- `buildLessonCorpus(ctx, interactionId)` — concatenates every report for one lesson (directors:
  all sections; instructors: their own; RLS independently gates reads) into one Markdown document,
  one block per student labeled with name · student ID · section, ordered by section then ID.

A new **Export for analysis ⬇** button in the lesson-report modal
([`app/faculty/interactions.html`](app/faculty/interactions.html)) downloads
`<interaction-id>-reports.md` for handoff to the aggregator.

(An earlier name-redacting `redactReport()` step was built and then removed once the PII
determination made it unnecessary — keeping the export simple.)

### Added — clickable interaction completion with a per-student report viewer

On the faculty interactions page ([`app/faculty/interactions.html`](app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](app/js/faculty-interactions.js)), the completion percentage and
each per-section progress chip are now **clickable** (keyboard-accessible too) and open a redesigned
**lesson report** modal:

- A **course-wide summary** banner — placeholder text for now; the misconception/understanding
  summary will populate it once the interaction-analysis pipeline lands (plan item D).
- A **section scope** selector ("All sections" or one section) with live completion stats.
- A **completion list**: every student in scope with a ✓ Complete / Not yet badge, and a
  **View report** button next to each completed student that renders their saved report inline
  (sanitized with DOMPurify, as before).

The data layer now returns `doneStudentIds` per interaction (the set of students who submitted a
report), replacing the old dropdown-driven viewer that could only page through students one at a
time. Implements item C of the day's plan; the report viewing/completion half is fully functional
now, while the aggregate-summary body stays stubbed pending D. A small `.clickable` affordance was
added to [`app/css/styles.css`](app/css/styles.css).

### Changed — faculty dashboard roll-up is now interactions-only, split by ownership

Reworked the faculty dashboard ([`app/faculty/dashboard.html`](app/faculty/dashboard.html) +
[`app/js/faculty-data.js`](app/js/faculty-data.js)) toward the interactions-first test:

- The section roll-up no longer shows preflight assignment progress. Each section card now lists
  **per-published-interaction completion** (`done/total` per lesson) instead. Preflight grading is
  unchanged and still lives on the Grade/Report tabs.
- The roll-up is split into **"Your sections"** (sections you personally teach) and, for
  directors/admins only, a second **"All other sections"** group. Instructors see only the first.
- The stat tiles dropped the assignment-centric "submissions to grade" / "avg submitted" in favor
  of **lessons published** and **avg interaction completion**.
- `loadFacultyDashboard` stopped querying `assignments`/`responses`/`scores` (and the now-unused
  per-assignment helper was removed), returning `mySections` / `otherSections` / per-interaction
  breakdowns instead. Implements items A + B of the day's plan.

### Added — work plan for the next portal iteration

Wrote [`app/PLAN-2026-06-22.md`](app/PLAN-2026-06-22.md): a dependency-ordered plan to push the
faculty portal toward a lesson-interactions-first experience. Covers (A/B) splitting the section
roll-up into "your sections" vs. "all other sections" and stripping preflight data from it in
favor of interactions only, (C) a clickable interaction completion list with per-student report
viewing, (D) a course-level interaction overview in Quick Actions, and (E) a native admin page
with a new `reset-password` edge function (instructors reset their own students; directors reset
all students/instructors and move section assignments). Records current state, blockers (notably
the not-yet-built interaction-analysis aggregation and the missing password-reset function), and a
recommended A→B→C→D→E priority order.

---

## 2026-06-12 — Matthew Recker

### Fixed — footer pinned to the bottom on short pages

The attribution footer floated up under short content. Made `<body>` a flex column with
`main { flex: 1 0 auto }` (a standard sticky-footer layout), so the content area grows to
fill the viewport and the footer sits at the bottom — while still flowing below tall content.

### Added — native in-app interaction manager

Ported the interaction CRUD off the legacy `interactions-admin.html` into the portal:
[`app/faculty/interactions.html`](app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](app/js/faculty-interactions.js) now do add / edit /
publish / unpublish / delete, per-section completion, and the per-student report viewer —
all inside the app shell (nav, theme, course switcher). Directors manage (incl. drafts);
instructors get a read-only published view scoped to their sections. It also honors the
prefill query params, so the Claude artifact link can target the app page directly. The
faculty dashboard "Manage interactions" quick-action now points here instead of opening the
legacy page in a new tab. (The prefill doc's base URL was updated to the app manager, with a
note on the `/app/` → root path change after promotion.)

### Changed — nav links centered & text-only

The top-nav links are now horizontally centered in the bar (3-zone `1fr auto 1fr` grid:
brand hard-left, links centered, controls hard-right) and **no longer carry icons** — plain
text labels, per preference. The brand logo, theme toggle (sun/moon), course switcher, and
user avatar keep their icons. Freed icons (`ic-assignments`, `ic-analytics`, `ic-settings`)
are marked available in `ICONS.md`.

### Added — prefill links for the interaction manager

`interactions-admin.html` now reads a query string and auto-opens the **New interaction**
modal prefilled (`new=1&id=&course=&title=&desc=&url=&pub=`), so a Claude artifact can hand
the director a one-click link that lands on the manager with everything filled in — they
just review and Save. Director-gated (instructors see a notice), values are only prefilled
(never auto-written), and the query is stripped from the URL after opening so a refresh
won't re-trigger. Full spec + a copy-paste builder for the artifact skill is in
[`INTERACTION-PREFILL-LINK.md`](INTERACTION-PREFILL-LINK.md), including the load-bearing rule
that the link's `id` slug must match the artifact's `#i=<slug>` report callback.
**Re-using an existing slug** opens the listing in *Update — review & save* mode and patches
it (no duplicate-id error); omitted params keep their current values — so regenerating an
artifact and re-sending the link cleanly refreshes the existing interaction. Both the app
manager and the legacy page honor this (the legacy page now awaits its row load first so the
existing slug is detected reliably).

### Changed — full-bleed navbar

The nav bar's contents now span the full viewport width (brand pinned hard left, theme
toggle + user menu hard right) instead of being constrained to the centered page-content
width. Page content below stays centered.

### Changed — all 35 icons wired in; navbar logo/controls refined

Matthew added the real Flaticon PNGs, so the portal now uses the whole set (previously
~15 of 35 were referenced; sun/moon and others were dead). Wired the remainder into natural
homes: **sun/moon** → theme toggle (`theme.js`), **menu** → mobile burger, **user** → the
account dropdown header, **course** → the course switcher, **success/warning/error/info** →
`.alert-*` glyphs (CSS `background-image`, resolved relative to the stylesheet so it works at
any page depth), **submissions/grades/class/completion** → faculty dashboard, **due-soon/
done/progress/rocket** → student dashboard, and the physics set **atom/bolt/wave/magnet** →
a decorative motif under the login card. Inventory tracked in
[`app/media/icons/ICONS.md`](app/media/icons/ICONS.md) (name · description · search terms ·
status · where-used) — the source of truth for adding/retiring icons. The old AI
search-prompt file was removed.

Navbar tweaks per request: **bigger, box-less brand logo** pinned left; **box-less** theme
toggle and user chip pinned right (backgrounds/borders removed, subtle hover only).

### Added — Flaticon attribution footer

The portal icons are all from **Freepik on Flaticon**, whose free license requires a visible
credit. Added a shared site footer (rendered by `renderNav` → `renderFooter` in
[`app/js/nav.js`](app/js/nav.js), styled in [`app/css/styles.css`](app/css/styles.css)) that
appears on every page displaying the icons, linking to
<https://www.flaticon.com/authors/freepik>. Login/router pages use only emoji, so they carry
no footer.

### Changed — cleaner, modern portal navbar

Restyled the `app/` top navigation after Featurebase's clean aesthetic: a light,
**translucent + blurred** sticky bar with a hairline bottom border (no heavy colored bar
or drop shadow), muted medium-weight links that darken into a soft pill on hover/active, a
subtle bordered brand mark, gradient-avatar user chip, and rounded controls. Added
`--nav-*` theme tokens with a dark-translucent variant so it reads well in both modes.
Pure CSS in [`app/css/styles.css`](app/css/styles.css) — no markup changes.

### Added — Roster & Sections ported into the `app/` portal

Director tooling now lives natively in the portal. New [`app/faculty/roster.html`](app/faculty/roster.html)
+ [`app/js/faculty-roster.js`](app/js/faculty-roster.js) combine the legacy Roster and
Sections tabs into one page with **Students / Sections** sub-tabs:

- **Students:** drag-&-drop CSV upload (validates `student_id` 3000xxxxxx + `[MT][135][A-D]`
  section codes, creates sections before students), a 10-row preview, per-student
  **edit-section** and **remove** (cascades scores/responses/extensions), and account
  **provisioning** via `db.functions.invoke('provision-students')` (cleaner than the legacy
  raw `fetch`, and avoids needing `SUPABASE_URL` in module scope).
- **Sections:** instructor-assignment grid that saves instantly.

Director-gated: the **Roster** nav link and the page body only appear for
directors/global-admins (`nav.js` now supports `directorOnly` links). The faculty dashboard
quick-action and nav point at the new internal page.

Still legacy (next): Assignments builder, Instructor management, Export.

## 2026-06-11 — Matthew Recker

### Added — Grade & Report ported into the `app/` portal

Second refactor pass: the two daily-use faculty tools now live natively in the portal
shell (top nav, theme, course switcher), no longer requiring the legacy `admin.html`.

- [`app/faculty/grade.html`](app/faculty/grade.html) + [`app/js/faculty-grade.js`](app/js/faculty-grade.js)
  — the full grading workflow: assignment + section pickers, the 3-state credit toggle
  (full → warn → zero), per-question feedback, "only flagged" filter, per-student totals,
  save-draft / finalize-&-publish, reopen, and grant/edit/remove extensions. Same
  `scores.question_scores` shape, `is_finalized` semantics, and `extensions` writes as the
  legacy tab — a faithful port, restyled with theme tokens and delegated events.
- [`app/faculty/report.html`](app/faculty/report.html) + [`app/js/faculty-report.js`](app/js/faculty-report.js)
  — submission summary, "did not submit" list, and per-question cards showing the
  `analysis_report` class summaries (from `/preflight-analyze`) plus raw responses with
  show-names, random-10 sampling, and copy-to-clipboard.
- Faculty **nav** now exposes Grade and Report directly; a single **Admin ↗** link covers
  the still-legacy director tools. Dashboard quick-actions point Grade/Report at the new
  internal pages.

Still legacy (next passes): Assignments builder, Roster, Sections, Instructors, Export.

### Added — `app/` role-based portal (foundation pass)

A coherent, role-aware rewrite of the front end living in a new [`app/`](app/) subfolder,
built to be promoted to the repo root later. **No database or RLS changes.** This first
("foundation") pass ships the shell, theming, navigation, both dashboards, and the
interaction views; the heavy grading / roster / sections / assignment-builder / export
tools stay on the legacy pages and are reached via out-links until ported in a later pass.

**Why:** the legacy pages each re-implemented their own login card, session check, and
`esc()` helper, had no shared module, no dashboard landing, and a single light-only theme.
The portal unifies all of that behind one auth bootstrap and a top nav with light/dark mode.

**Shared shell ([`app/js/`](app/js/)):**
- `config.js` — copy of the root client (sets `window.db`); kept identical so paths don't
  change after promotion. `supabase.js` re-exports it as an ES module.
- `auth.js` — one `bootstrap({ require })` every page calls: restores the persisted session
  (survives reload + navigation), redirects unauthenticated users to login with a `?next`
  round-trip, resolves role by **table membership** (instructors vs students), resolves the
  faculty course list + persisted current course (ports `admin.html`'s `initAdmin`
  fallbacks) or the student's course (derived from their section), and enforces the page's
  required role.
- `nav.js` — shared top navigation: role links, faculty **course switcher**, theme toggle,
  user menu, mobile menu. `theme.js` — `data-theme` dark mode (localStorage +
  `prefers-color-scheme`, no-flash head snippet). `util.js` — `esc()`, due-date/section
  logic, an emoji-fallback `iconHTML()`, and `legacyUrl()` (resolves root-level legacy
  links correctly both at `/app/` and after promotion).
- `student-data.js` / `faculty-data.js` — batched, no-N+1 dashboard queries over existing
  tables only.

**Pages:** [`app/login.html`](app/login.html) (unified cadet-ID-or-email login),
[`app/index.html`](app/index.html) (role router), student
[dashboard](app/student/dashboard.html) / [assignments](app/student/assignments.html)
(ported submit+review engine) / [interactions](app/student/interactions.html), and faculty
[dashboard](app/faculty/dashboard.html) (per-section submission/grading roll-up) /
[interactions](app/faculty/interactions.html) (completion roll-up + per-student report viewer).

**Design system:** [`app/css/styles.css`](app/css/styles.css) is the legacy sheet with its
~14 hardcoded surface/alert colors tokenized into CSS variables plus a `[data-theme="dark"]`
set, extended with top-nav, stat-tile, and roll-up components.

**Icons:** [`app/media/icons/ICON-SEARCH-PROMPT.md`](app/media/icons/ICON-SEARCH-PROMPT.md)
is a ready-to-run prompt to source ~35 cohesive **Lineal Color** icons; the UI references
their filenames and falls back to emoji until they're dropped in. See
[`app/README.md`](app/README.md) for the structure and go-live steps.

### Added — Lesson Interactions feature

A new path alongside the existing assignments system: students work through a Claude
**artifact** (an interactive lesson hosted on claude.ai), and the artifact sends a
compressed Markdown report back to the site to be saved per student. Directors create
and manage these lessons; an AI skill will later summarize trends by section.

**Database — migration [`012_preflight_interaction_reports.sql`](supabase/migrations/012_preflight_interaction_reports.sql)** (purely additive; touches no existing table):
- `interactions` — one row per lesson. `id` is a stable slug (e.g. `lesson-02-charge`)
  the artifact embeds in its submit link. Holds `course_id`, `title`, `description`,
  `artifact_url`, `is_published`.
- `preflight_interaction_reports` — one row per student per interaction
  (`UNIQUE(student_id, interaction_id)`). Stores the report as an inert Markdown blob
  (`report_markdown`, capped at 100 KB), plus an optional `report_data` JSONB for future
  structured fields. Course/section are **not** stored — derived by joining to the student.
- View `interaction_reports_by_section` — joins reports to the student's section for the
  analysis skill.
- RLS: students may only write rows bound to their own `auth_user_id`; directors/admins
  read all; instructors read their own sections.

**New pages:**
- [`interactions-admin.html`](interactions-admin.html) — director/admin page to add/edit
  (modal), publish, delete lessons, and view submissions. Submissions are picked by
  section → student dropdown (scales to ~1000 students; fetches one report at a time) and
  rendered as sanitized Markdown.
- [`interactions.html`](interactions.html) — student-facing list of published lessons with
  **Launch** links to the artifacts.
- [`interaction-submit.html`](interaction-submit.html) — receives the artifact's
  `#i=<slug>&r=<lz-string payload>` URL, requires student login, and upserts the report.

**Why these choices:**
- *Separate tables, not reusing `assignments`* — interactions may eventually replace
  assignments, but the existing tables are working in production and were left untouched.
- *Report stored as a blob, sanitized only on render (DOMPurify)* — DB data is never
  executed; XSS is a render-time concern. The `#r=` payload is user-controllable, so it's
  treated as untrusted everywhere it's displayed.
- *Data passed via URL hash, not POST* — GitHub Pages is static and can't process a POST;
  the hash also keeps payloads out of server logs/referrers.
- *RLS is the real gate* — `students.auth_user_id = auth.uid()` makes a spoofed
  `student_id` impossible to write, regardless of client code.

**Deferred (not yet built):** a home for the analysis skill's *output* (per-section trend
summaries). Options: a sibling `interaction_section_summaries` table, or mirror the
existing `assignments.analysis_report` JSONB pattern.
