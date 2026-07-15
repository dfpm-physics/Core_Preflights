# Changelog

A running log of notable changes to the Core Preflights system. Each entry records
**what** changed, **who** made it, and **why**, so future maintainers (and Claude)
can understand the history without re-deriving it from code or git.

Newest entries first. Dates are `YYYY-MM-DD`.

---

## 2026-07-15 — Matthew Recker via Claude

### Added — drag-and-drop lesson composer + orphan content on the Lessons page

The faculty **Lessons** page ([`site/app/faculty/lessons.html`](site/app/faculty/lessons.html) +
[`site/app/js/faculty-lessons.js`](site/app/js/faculty-lessons.js)) now surfaces **unassigned
("orphan") content** — assignments/interactions not yet owned by any lesson — as draggable thumbnail
cards at the top (directors only, shown only when orphans exist). Drag a preflight and/or an
interaction into the two drop boxes (or click a card), then **Create lesson** opens the editor
prefilled with those references, a suggested slug/number/title, and the matching allowed mode. Uses
native HTML5 drag-and-drop (no library); `loadManager` already annotates each row's `ownedBy`, so
orphans are just the un-owned rows.

### Changed — attached existing preflights are now editable in the lesson creator

Pulling an existing/orphan assignment into a lesson (via the "Use existing" picker or the composer)
now **loads its questions into the editable builder** instead of referencing it read-only; saving
writes the revised `questions` + reference fields back onto that same assignment with a plain
`UPDATE` that preserves its title, publish state, and due dates (`getAssignment` fetches the full
editable row). This is a step toward making the lesson creator the single preflight-authoring
surface — the legacy `admin.html` Assignments authoring path is intended to be retired next (kept for
now because that page also hosts grading/roster/sections).

### Added — drag-and-drop figure uploads via Supabase Storage

Each question's figure field is now a **drop zone**: drag an image (or "choose file") and it uploads
to a new public `lesson-figures` Storage bucket, storing the returned public URL in
`figure_url` (`uploadFigure` in [`faculty-lessons.js`](site/app/js/faculty-lessons.js); ≤5 MB,
image MIME types). This is how a static GitHub Pages site accepts uploads — **GitHub cannot** receive
browser file writes, so the image goes to Supabase, not the repo. Pasting an external image URL still
works. Requires applying **`supabase/migrations/019_lesson_figures_storage.sql`** (creates the bucket
+ faculty-upload / public-read RLS) with the service role / Supabase dashboard — the scoped DB role
can't touch the `storage` schema. Until it's applied, uploads fail with a clear "bucket missing"
message and the URL field still works.

### Added — "Preview (student view)" for a lesson's questions

The lesson editor gained a **Preview (student view)** button that renders the free-response
questions exactly as a student sees them — read-only inputs by type (textarea / number / radio
options), the reading-time note, and any question figures — for either an inline-authored preflight
or a referenced existing one (`getAssignmentQuestions` fetches the latter). It never renders the AI
Interaction, per request. Fully static (no backend).

### Changed — lesson delete is now container-safe with a guarded "all contents" path

Delete (director-only) opens a 3-way dialog instead of a blind `confirm()`:
**Delete container only** (default) removes just the `lessons` row so the preflight and interaction
survive as reusable orphans (cascades only `lesson_chat_inputs` + `lesson_completions`); **Delete all
contents** also deletes the attached assignment and interaction — which CASCADEs their `responses`,
`scores`, `preflight_interaction_reports`, `interaction_analysis` — and therefore requires a
deliberate **5-second mouse hold** with a progress fill. The dialog fetches and states the exact
counts of student work that would be destroyed. New data-layer helpers `countLessonWork` and
`deleteLessonAndContents` (the plain `deleteLesson` stays container-only).

### Added — approved-RAG-file manifest + reference dropdown

New committed manifest [`textbook-pdfs/rag-manifest.txt`](textbook-pdfs/rag-manifest.txt) (seeded
from the 29 distinct live `reference_pdf` values) lists the approved textbook references. The PDFs
stay gitignored (`textbook-pdfs/**/*.pdf`); the manifest is committed so the reference **names match
across every operator's local repo**. The lesson creator's **Reference PDF** field is now a dropdown
fed by the manifest (fetched at runtime) with an **"+ Add new…"** free-text fallback. Documented the
manifest as the source of truth for valid `reference_pdf` values in
[`.ai/skills/preflight-analyze/SKILL.md`](.ai/skills/preflight-analyze/SKILL.md) §Step 3 and
[`textbook-pdfs/README.md`](textbook-pdfs/README.md).

### Changed — lesson modal: removed Objectives, added preflight reference/reading inputs

Removed the **Objectives** section and the per-question objective dropdown from the lesson editor —
nothing consumed `lessons.objectives` (the by-objective rollup is still unbuilt), and it added noise;
the DB column is left untouched (defaults to `[]`). In its place the inline "Create new" preflight
now captures the fields that actually matter for grading and students: **reference PDF** (the manifest
dropdown), **reference pages**, and a **reading link** — threaded through `saveLesson` into the
`assignments` row (`loadManager` now also selects them for edit repopulation). Interaction URL
placeholder updated to reflect that live interactions are ChatGPT Custom GPTs, not only claude.ai
artifacts.

### Changed — renamed the platform brand from **iPREP** to **PREP**

The user-facing platform brand is now **PREP** (*Pre-lesson Readiness Engagement Platform* — the
acronym drops the leading "interactive"). Going forward, **iPREP** (*interactive PREP*) is reserved
specifically for the **interactive lesson-interaction component** (the Claude-artifact lessons); the
rest of the site is **PREP**. This does **not** touch the repo, GitHub Pages path, or export
filenames, which stay `Core_Preflights`.

Replaced the `iPREP` brand token with `PREP` across 36 files (64 occurrences) — site header logos,
page `<title>`s, the `app/` portal nav wordmark + footer ([`app/js/nav.js`](site/app/js/nav.js)),
login heading/subtitle, README/docs headings, the design system ([`app/DESIGN.md`](site/app/DESIGN.md)),
the browser test sandboxes, and the contract docs (`CORE.md`, `PROJECT.md`, `AGENTS.md`, `.ai/README.md`).
Collapsed the acronym *interactive Pre-lesson Readiness Engagement Platform* → *Pre-lesson Readiness
Engagement Platform* in the 5 places it spelled out in full. Also renamed the **not-yet-executed**
config-neutralization proposal `$IPREP_CONFIG` / `~/.config/iprep/` → `$PREP_CONFIG` / `~/.config/prep/`
in `CORE.md` §3 and `AGENTS.md` for brand consistency (nothing depends on it yet).

Recorded the naming convention (PREP = platform, iPREP = interactive component) in `CORE.md` §1 and
`PROJECT.md` so future agents don't re-purge the retained `iPREP` term. Prior CHANGELOG history — the
original "rebranded the platform to **iPREP**" entry and the `$IPREP_CONFIG` decision note — is left
intact as a historical record.

### Added — combine existing preflights + interactions into lessons (faculty tool)

Extended the faculty **Lessons** tool (`site/app/faculty/lessons.html` +
`site/app/js/faculty-lessons.js`) so a lesson can be **assembled from content that already
exists**, not only authored new. Each component (Free-Response preflight, AI interaction) now has a
`None · Use existing · Create new` source toggle:

- **Use existing** — a dropdown of the course's real `assignments` / `interactions` (loaded by
  `loadManager`, annotated with which lesson already owns each so nothing is double-attached). The
  lesson *references* the chosen row by id; its content and publish state are left untouched. This
  is how the pre-built Fall preflights (`preflight-01…NN`) and standalone interactions get combined
  into lessons without duplicating them.
- **Create new** — the previous inline builder, unchanged except for the Q1/Q2 defaults below.

A lesson may carry **just a preflight, just an interaction, or both** ("1 or both"). The
`completion_policy` control (which modes students may use) enables only the modes whose component is
attached and mirrors the DB CHECK `lessons_policy_components`; you can attach both components yet
still restrict the allowed mode to one. **No schema migration** — migration `016` already lets
`preflight_id`/`interaction_id` reference any row id.

Ownership rule added: a component is lesson-owned iff its id equals the lesson id. `togglePublish`
now mirrors the lesson's published state **only onto owned (inline-created) components**, so
publishing/unpublishing a lesson can no longer flip the publish flag of a shared standalone
assignment/interaction it merely references.

*Why:* the tool was new-content-only; there was no way to populate `lessons` from the preflight
assignments and interactions that already exist. Partially un-defers LESSON-UNIFICATION §15 Phase 7
(legacy adoption) — existing content can now be referenced into lessons. Student-facing gating
(students seeing only the allowed mode / picking) remains the next phase, unbuilt.

### Changed — inline preflight now seeds Q1 reading-time + Q2 reflection

The inline preflight builder previously pinned a single reading-reflection question as Q1. It now
pins **two** questions matching the live Fall preflights (`scripts/fall2026/build_fall_preflights.py`):
**Q1** a reading-time diagnostic ("How much time did you spend reading…", 0 pts) carrying a
student-facing note that the response is visible to the instructor but the name is not shown (class
diagnostic, per the AGENTS.md Q1 privacy rule), and **Q2** the standard reading reflection (1 pt,
the meaningful-gate that must match the interaction). Both are auto-filled, editable, pinned first,
and non-removable. Only affects newly authored inline preflights; attached existing preflights keep
their own questions. Also marked the lesson **Objectives** section explicitly *optional* in its hint
(nothing consumes it until the by-objective rollup, Phase 6).

## 2026-07-15 — Matthew Recker via Claude

### Changed — extracted a central agent-neutral contract (`CORE.md`); made the root files thin wiring

Completed the consolidation that the `.ai/` reorg had deferred. The authoritative operating rules
that lived in root `AGENTS.md` — which is really Codex's auto-load file — now live in a single
agent-neutral `.ai/instructions/CORE.md` (safety, coordination gate, secrets/config, git/publish,
CHANGELOG conventions, runbook index). The two root entry files are now thin wiring that must not
restate or weaken it:

- **`AGENTS.md` (Codex):** points to `CORE.md` + `PROJECT.md` as authoritative, then inlines a
  labeled mirror of CORE.md §0 (shared-state safety + coordination gate) as a belt-and-suspenders
  floor, since Codex has no `@import` and only the pointer would otherwise carry the safety rules.
  Keeps Codex-only items (the `.codex/` note, the Codex-requested-change standing authorization, the
  Codex quickstart).
- **`CLAUDE.md` (Claude Code):** now `@`-imports `CORE.md` + `PROJECT.md` (was importing `AGENTS.md`),
  plus the Claude-only addendum.

Sorting rule established: **CORE.md holds what's true for every agent; each root entry file holds the
wiring plus only-that-agent items.** Deduped `CORE.md` against `PROJECT.md` — the data-model catalog,
JSONB shapes, roles, and edge functions stay canonical in `PROJECT.md` and CORE links to them;
`PROJECT.md`'s triplicated "no Node/build step" note and its wholesale-duplicated "Important Notes"
section were collapsed to cross-links into CORE. Repointed `PROJECT.md`'s multi-agent note and both
`.ai` READMEs (dropped the "consolidation deferred — don't create a core file" note) at the new
layout. No behavior, schema, or site change — documentation/instruction wiring only.

## 2026-07-15 — Matthew Recker via Claude

### Fixed — post-reorg Claude-facing cleanup for the `.ai/` skill tree

Follow-up to the `.ai/` reorganization below. Fixed a stale reference in `supabase/SETUP.md` Step 7
that pointed at `~/.claude/skills/physics215-analyze/config.json` (dead skill name) with an outdated
JSON schema; it now matches the current `preflight-analyze` path and
`.ai/skills/preflight-analyze/config.json.template` (adds `default_course_id`, `sb_secret_`
placeholder) and the heading is agent-neutral. Added `.ai/skills/setup-preflight/SKILL-claude.md`
so the setup wizard has a Claude Code addendum matching the existing `SKILL-codex.md` (use the Bash
tool cross-platform, never echo the service key, no Node tooling).

Decided but not yet executed: neutralize the `~/.claude/skills/preflight-analyze/config.json` runtime
path to a neutral `$IPREP_CONFIG` (or `~/.config/iprep/config.json`) with fallback to the existing
path, across all scripts/skills/docs — deferred to its own coordinated PR per AGENTS.md §3. Note also
that `supabase/SETUP.md` still contains other pre-reorg paths (e.g. `physics215/js/config.js`) not
touched here.

## 2026-07-15 — Casey Pellizzari via Codex

### Changed — reorganized the repository around `site/`, `.ai/`, and `docs/`

Moved all deployed website source into `site/` while keeping GitHub Pages on the repository root.
Root `index.html` now forwards to `/site/`; root `404.html` recovers old page routes; and the root
`artifact-submit.html` plus `interaction-submit.html` compatibility endpoints preserve query strings
and URL hashes before forwarding to the full receiver under `site/`. Relative site paths remain
unchanged inside the moved tree. Updated the Fall figure builder and extractor for `site/img/`.

Created one agent-neutral AI tree under `.ai/`: shared project context lives in `instructions/`, and
all four canonical workflows now live in `skills/<name>/SKILL.md` with optional vendor addenda.
Removed the duplicated `.agents/skills/` discovery pointers and `.claude/skills/` runbooks. Added root
`CLAUDE.md` as Claude Code's auto-loaded import/bootstrap while root `AGENTS.md` remains the shared
operating authority pending a later instruction-content consolidation.

Moved system documentation into categorized `docs/` folders, the Custom GPT transfer package into
`.ai/integrations/custom-gpt/`, the artifact example into `.ai/artifacts/examples/`, and browser
sandboxes into `tests/browser/`. Updated active source paths, repository links, local-server guidance,
and public `/site/` URLs. This was a filesystem/deployment-source reorganization only: no Supabase
schema or live database data changed.

## 2026-07-15 — Casey Pellizzari via Codex

### Fixed — restored the shared operating brief and removed agent runbook drift

Restored the authoritative root `AGENTS.md` after merge commit `26591e3` resolved two independently
added versions of that file as an empty deletion. The collaborator branch had added Codex discovery
skills under `.agents/skills/`, but their duplicated preflight runbook still prescribed a
Codex-specific config path and generic yellow feedback that conflicted with the current canonical
grading rules.

Kept all four Codex skill entry points, converted them to thin pointers to the canonical
`.claude/skills/` runbooks, and removed the redundant `.agents` config template. This preserves
native Codex discovery while ensuring Claude and Codex use the same tailored-feedback,
per-instructor aggregation, credential, database-safety, and verification rules.

## 2026-07-09 — Casey Pellizzari via Codex

### Fixed — corrected Physics 215 v12 source lesson list

Regenerated `Physics215_Preflight_Questions_v12.docx` after Casey clarified that lesson 3, not
lessons 2 and 6, was part of the modified Q3 set. The corrected v12 now pulls live
webpage/Supabase Q3 wording for lessons 3, 9, 19, 24, 26, 28, and 30. Verification confirmed
lessons 2 and 6 remain unchanged from v11 and still match the live Q3 wording.

### Changed — generated Physics 215 preflight source DOCX v12

Generated `Physics215_Preflight_Questions_v12.docx` beside v11 in the OneDrive `Preflights/`
folder by pulling current live webpage/Supabase Q3 wording into the Word source document. After the
lesson-list correction above, v12 matches live Q3 wording for lessons 3, 9, 19, 24, 26, 28, and
30. The Fall preflight builder and figure extractor now read v12 so future rebuilds preserve the
webpage wording.

### Fixed — restored missing Fall 2026 preflight question figures

Extracted the embedded JiTT figures from `Physics215_Preflight_Questions_v11.docx` into
`img/assignments/` and updated the Fall preflight builder to attach deterministic public
`figure_url` values to Q3. The affected assignments are `preflight-03`, `preflight-04`,
`preflight-24`, and `preflight-28` (the displacement-current capacitor figure Casey noticed).
Added `scripts/fall2026/extract_preflight_figures.py` so future DOCX refreshes can regenerate the
assets. Patched the live Supabase `assignments.questions` JSON for those four rows and read-back
verified each stored Q3 figure URL.

### Changed — Grade and Report views keep zero-point Q1 private

Updated the written-preflight grading/report UI so zero-point questions such as Q1 no longer appear
on each student's Grade-tab card; instructors now review only the scored questions there. In the
Report tab, Q1 raw responses still appear for class-level review, but the **Show names** control is
removed for Q1 and copy logic keeps those responses anonymous. Other questions keep the
Show names toggle. Updated the webpage help text, `SYSTEM_GUIDE.md`, and `AGENTS.md` to preserve
the privacy rule across future agent work.

### Changed — lab preflights now ask about lab instructions

Updated the Fall 2026 Physics 215 preflight builder and the live Supabase `assignments` rows for
the six lab lessons (`preflight-06`, `preflight-11`, `preflight-17`, `preflight-27`, `preflight-34`,
`preflight-38`) so Q1 asks how much time students spent reading the lab instructions and Q2 asks
what they found confusing or interesting about the lab instructions. Regular lesson preflights keep
the original book/reading wording. The live DB patch read-back verified all six lab rows and sampled
regular preflights to confirm they were unchanged.

### Changed — clarified Course Director preflight-analysis instructions

Updated the webpage System Guide in `admin.html` and the fuller `SYSTEM_GUIDE.md` so Course
Directors know how to initiate grading with either Claude Code or Codex. The guide now describes
the coordination checklist, the current `/preflight-analyze preflight-02 M|T` command shape, the
Codex plain-language equivalent, the local `~/.claude/skills/preflight-analyze/config.json` path,
and the distinction between unfinalized AI suggestions and human finalization in the Grade tab.
Also refreshed related instructor/director/admin help text, removed Claude-only wording from the
web guide, corrected the stale Node wording in `app/README.md`, and aligned the setup/training
runbooks with the current config and command conventions.

### Changed — Codex-requested changes now carry standing publish authorization

Recorded Casey's standing instruction in `AGENTS.md`: when Casey asks Codex to make changes, Codex
should update durable memory, update `CHANGELOG.md`, commit, and push `main` after verification
unless Casey explicitly opts out. Read-only exploration/questions still do not trigger a commit or push.

### Changed — clarified instructor summaries and student account provisioning

Updated the System Guide and faculty roster wording to make two operating details explicit:
`preflight-analyze` Class Summary & Misconceptions are aggregated per instructor across all of that
instructor's sections, and provisioned student accounts use `studentID@usafa.edu` with the default
password set to the last 6 digits of the student's ID number.

## 2026-07-08 — Casey Pellizzari via Codex

### Changed — successful preflight-analysis runs now publish their audit record

Added standing authorization to `AGENTS.md`: after a successful live `preflight-analyze` run and
exact read-back verification, the agent updates the CHANGELOG, commits the run record, and pushes
`main` unless the human explicitly opts out. The shared-state coordination gate still applies.

### Data — reran `preflight-02` with tailored feedback and specific summaries

Re-ran all four training sections after pulling the consolidated `preflight-analyze` runbook.
Replaced the 64 unfinalized suggestions and the per-instructor `analysis_report`, then read-back
verified every stored score and report field. All 20 Q3 `warn` responses now have distinct,
2-sentence corrections tied to the student's actual reasoning; the instructor summaries now name
each misconception type with a count and representative quote. The grading distribution remains
42 `full`, 20 `warn`, and 2 blank `zero`; no grades were finalized or published.

### Data — graded the `preflight-02` training submissions

Ran the shared `preflight-analyze` procedure against all four Physics 215 training sections after
grounding the review in the assigned textbook pages. Wrote and read-back verified **64 suggested
score rows**, all with `is_finalized=false`, plus the per-instructor `assignments.analysis_report`.
Of 72 rostered training students, 64 submitted and 8 were missing. Q3 produced 42 `full`, 20 `warn`
(full credit with corrective feedback), and 2 `zero` blank responses; Q1 and Q2 received full credit
under the liberal engagement rubric. No grades were finalized or published to students.

### Fixed — Codex quickstart environment wording

Corrected the `AGENTS.md` quickstart so it no longer says Node is absent. It now matches the
authoritative environment rule: the project has no Node dependency or build step, even when Node
is installed on an operator's machine.

---

## 2026-07-08 — Casey Pellizzari via Claude

### Changed — `preflight-analyze` summaries are explicitly per-instructor, never per-section

Clarified the runbook so the stored `analysis_report` summary and misconception counts pool all of an
instructor's sections into one combined set (they already keyed by instructor, but the skill description
still said "per-section" and Step 8 didn't forbid section-level breakouts). Fixed the description wording
and added an explicit "aggregate per instructor, never per section" rule to Step 8.

### Fixed — resolved `preflight-analyze` SKILL.md drift between agents

The committed repo runbook (`.claude/skills/preflight-analyze/SKILL.md`) had drifted behind the copy
Claude runs from `~/.claude/skills/`. The repo version — the only one Codex can read — still
*prescribed* a single generic corrective-feedback template and thinner grading guidance, which is why
the Codex `preflight-02` run pasted the same feedback string onto all 20 `warn` answers instead of
tailoring each. Consolidated both copies to one canonical file: the newer three-state grading rubric
with **per-student tailored corrective feedback** (generic template now explicitly banned), while
preserving the repo-only "Course Director/System Admin" role note and "per-instructor report" wording.
Both copies are now byte-identical. Durable fix (symlink repo↔global, or repo-as-source-of-truth) is a
follow-up.

### Added — shared multi-agent operating guide (`AGENTS.md`)

Development is now done jointly by different people running **different AI agents** (Claude Code today,
**Codex being introduced**) against **one shared live Supabase DB and one live GitHub Pages site**. The
real risk is drift and uncoordinated changes to that shared state, so we added a single agent-neutral
source of truth.

- **New root [`AGENTS.md`](AGENTS.md)** — authoritative operating rules for every agent and human:
  shared-state hazards, a **coordination gate** (one operator; no competing run; `git fetch`/verify no
  divergence; separate worktrees for concurrent work; never force-push), environment, secrets/config
  locations, runbooks (skills are readable procedures), git/publish/CHANGELOG rules, data-model quick
  reference, and a Codex quickstart.
- **[`.claude/CLAUDE.md`](.ai/instructions/PROJECT.md)** now defers to `AGENTS.md` for shared rules (pointer at
  top) and keeps its Claude-specific deep context.
- **Corrected a stale environment claim** in both files: the old "no Node, cannot be installed" was
  wrong (Node/npm are present). Reframed to the accurate rule — *the project has no Node dependency or
  build step; don't introduce one; verify the frontend in a browser.*

Decisions (reviewed with **Codex**): keep `CHANGELOG.md` as the shared history; skills' `SKILL.md` stay
readable runbooks any agent can follow; **no `.codex/` documentation mirror** (a `.codex/config.toml`
for settings is fine later if needed); config-path generalization and the broader private-memory→repo
migration are **deferred** (the high-stakes memory is already captured in `AGENTS.md`).

---

## 2026-07-07 — Casey Pellizzari via Claude

### Changed — Physics 215 reset from proof-of-concept to Fall 2026

Cleared the phys-215 proof-of-concept data and stood up the real Fall 2026 preflights. Scripts
live in `scripts/fall2026/`.

- **Snapshotted the POC first** (`export_poc_snapshot.py`) — a full, restorable JSON archive in
  `scripts/fall2026/poc-archive/`: all 4 interactions, every interaction report (the 8 hand-crafted
  lesson-02 + 2 lesson-03 reports + 206 synthetic demo rows), the 206 fake students / 10 sections,
  and the 3 test preflights' responses/scores. `MANIFEST.json` records counts + timestamp.
- **Created 37 Fall preflights** (`build_fall_preflights.py`) as written `assignments`
  (`preflight-02`…`preflight-41`, `course_id='phys-215'`, published). Scope = the 31 regular PF=Y
  lessons + the 6 labs; excludes Lesson 1 and the 3 GRs. Each mirrors the original 3-question
  structure (reading-time 0.1 + confusing/interesting 0.9 + JiTT concept w/ `expected_response`
  1.0 = 2 pts). Questions parsed from `Preflights/Physics215_Preflight_Questions_v11.docx`; M/T due
  dates computed as 2359 America/Denver the night before each lesson from the Fall 2026 syllabus
  (DST-aware); RAG refs point at `Text_Book_PDFs/215 Sections/`. Idempotent (upsert on `id`).
- **Cleaned the POC** (`clean_poc.py`, gated on the snapshot matching live counts) — deleted the fake
  students/sections/submissions, the 3 test preflights, and the `demo-rollup-sandbox` interaction.
  **Kept** the `lesson-02/03/04` artifacts (reusable Fall content) and all real accounts.

**Deferred (with Matthew Recker):** a durable multi-term/semester model. The frozen artifact contract
is safe under it (additive columns only; artifacts key by stable slug), and `term_id` belongs in the
`lessons` layer + roster; the one invasive piece is making `sections.id` per-term (global PK, CHECK
`^[MT][135][A-D]$`). Not started — revisit after Fall is live. Real Fall roster load is the next step.

### Added — student preview for assignments (`admin.html`)

Each assignment card in the **Assignments** tab now has a **Preview** button
([`admin.html`](site/admin.html), `previewAssignment`) that renders the assignment in a modal exactly as a
student sees it — figure, title, due dates, description, and every question (MC / numerical / free-response)
with read-only, disabled inputs. Lets directors eyeball the final student-facing form before publishing.
Reading links are intentionally left **blank** on all Fall preflights: the per-lesson OpenStax PDFs are
RAG-only grading references (`reference_pdf`/`reference_pages`), not student reading assignments, so the
student view shows no reading link.

### Changed — preflight point split is now 0 / 1 / 1 (still 2 pts)

All 37 Fall preflights: Q1 (reading time) → **0 pts**, Q2 (confusing/interesting) → **1 pt**,
Q3 (JiTT concept) → **1 pt**. Total unchanged at 2. Applied to the live `assignments` rows and to
the generator [`scripts/fall2026/build_fall_preflights.py`](scripts/fall2026/build_fall_preflights.py)
so re-runs stay consistent.

### Added — instructor-training dataset for preflight-02

[`scripts/training/seed_training_preflight02.py`](scripts/training/seed_training_preflight02.py) seeds a
small, disposable training roster so instructors can practice the admin + grading workflow before the real
Fall roster loads: 4 sections (M1A/T1A = Casey, M3A/T3A = Tyler Jones), ~72 fake students in the dedicated
id block `3000990000–3000990071`, and 64 `preflight-02` submissions (8 intentionally missing) with a
realistic Q3 spread (correct / vague-but-credited / misconception). Raw submissions only — no scores.
Idempotent; `--clean --commit` removes exactly this data. **Delete when the real roster is uploaded.**

### Note — folder rename + config path

The working folder was renamed `Physics_215_Fall_2026` → `PREP`. The only path that hardcodes it is the
skill config `~/.claude/skills/preflight-analyze/config.json` (`textbook_base_path`, gitignored) — updated
to `…/USAFA Classes/PREP/`. If the folder is renamed again, that line must be updated or `/preflight-analyze`
loses its textbook RAG grounding.

---

## 2026-06-26 — Matthew Recker

### Fixed — theme toggle icon now reflects the current theme, not the destination

The light/dark toggle ([`app/js/theme.js`](site/app/js/theme.js), `updateToggleButtons`) showed the icon of the
theme it would switch *to* (sun while in dark mode, moon while in light) — Matthew read this backwards and
expected the icon to indicate the *current* state. Flipped the icon mapping so it now shows the **active**
theme (moon in dark mode, sun in light). The `aria-label`/`title` are unchanged — they still describe the
action the click performs ("Switch to light/dark mode"), which is the convention for a toggle button.

### Changed — per-objective understanding histogram now uses an adaptive KDE (`lrFine5`)

The lesson rollup's "Objective understanding" chart ([`app/faculty/report.html`](site/app/faculty/report.html),
`lrFine5`) previously drew its 25-cell curve by **linearly interpolating** between the 6 integer
score-bins. That smeared a single data point into a lopsided triangle spanning ±1 score and lit up
more columns than there were distinct scores — Matthew noticed both a phantom spread on a 1-point
objective and "more raised columns than there should be."

Replaced the interpolation with an **adaptive (variable-bandwidth) kernel density estimate** —
Abramson's square-root law: each occupied bin contributes one unit-area Gaussian per student,
centered on its integer score, with bandwidth `h ∝ 1/√(count)`. Sparse bins (1–2 students) render
a soft, *symmetric* bump (honest uncertainty); well-populated bins stay tall and sharp; area per
student is conserved. Tuned to `H0 = 0.49, HMIN = 0.30, HMAX = 0.45` (visual only). **Purely a
rendering change** — input is still the integer histogram from `summarizeReports`, so no
data-contract, skill, or `int05` changes, and the AI keeps emitting integer 0–5 understanding
scores (no false precision).

Also added a **director-only floating "Histogram smoothing · KDE" tuner** on the report page:
three live sliders (`H0/HMIN/HMAX`) that re-render the objective histograms instantly and a "Copy"
button for the resulting const line. Gated via `ctx.isDirectorForCurrent()` (directors + global
admins only; hidden from instructors). The `KDE` object holds the live defaults, so baking in a new
value is a one-line edit. Self-contained for easy later removal.

### Added — faculty lesson generation tool + migration 016 (`lessons` foundation)

Built **Phase 1 + Phase 4** of [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md): the schema that
groups a written preflight and a Claude interaction under one **lesson**, and the faculty tool that
authors them.

- **Migration [`supabase/migrations/016_lessons.sql`](supabase/migrations/016_lessons.sql)** —
  purely additive (mirrors 012/014). Creates `lessons` (slug, course, `completion_policy`
  ∈ {preflight, interaction, choice}, shared `objectives[]`, M/T due dates, `preflight_id →
  assignments`, `interaction_id → interactions`, the policy↔components CHECK) and
  `lesson_completions` (the unified 2-point grade, `UNIQUE(student, lesson)`). Includes the
  grade trigger (`lc_score_from_effort`, points-from-effort, reusing the migration-013 curve) and
  the path-lock trigger (`lc_lock_path`, path immutable once set), plus RLS that mirrors
  `interactions` (lessons) and `preflight_interaction_reports` (completions). **Deliberately defers**
  the row-*creating* finalize triggers and the D8/D9 due-cutoff/Submit guards to Phase 2.
- **[`app/faculty/lessons.html`](site/app/faculty/lessons.html)** + **[`app/js/faculty-lessons.js`](site/app/js/faculty-lessons.js)**
  — a new director-gated **Lessons** page (added to `FACULTY_LINKS` in
  [`app/js/nav.js`](site/app/js/nav.js)). One screen lists lessons and, in the New/Edit modal, **authors
  both component types inline**: a completion-policy segmented control that shows/requires the right
  components, a shared objectives editor, a ported preflight question builder (free-response /
  numerical / multiple-choice, each mapped to an objective and one marked the
  `role:"reading_reflection"` question), and the interaction fields (slug that must match the
  artifact's `#i=`, URL, title, description). Save orchestrates the writes — upsert the underlying
  `assignments` and/or `interactions` rows, then the `lessons` row that points at them; publish
  cascades to the components; delete removes only the lesson grouping (component rows and student
  work are kept). Client validation mirrors the DB policy↔components CHECK and the
  exactly-one-reading-reflection rule. New `.lb-*` builder classes added to
  [`app/css/styles.css`](site/app/css/styles.css) (tokens only, both themes).

*Why:* the lesson model was approved (`LESSON-UNIFICATION.md`, decisions D1–D9) but had no table and
no authoring surface; this lands the foundation and the director-facing creation tool so real lessons
can be built. **Scope:** authoring only — the student lesson view, the Save/Submit lifecycle, the
completion-creating triggers, the `/preflight-analyze` `report_data` extension, and the merged rollup
remain Phases 2/5/6 follow-ups. Verify in a browser against Supabase (no Node), per the project workflow.

### Refined — lesson tool: reflection auto-seed, clearer labels, artifact prefill, alignment fix

Follow-up polish to the lesson creation modal from Matthew's review:

- **Reading reflection is now a fixed, auto-filled Q1.** Selecting a free-response component seeds the
  pinned first question with the standard prompt *"What did you find interesting or difficult in the
  reading?"* (editable, not removable) plus AI guidance telling the grader to judge whether the
  reflection is *meaningful* — "need not be long, just meaningful" — which is the effort gate. Replaces
  the old "mark one question as the reading reflection" checkbox, so every lesson's reflection is
  identical across both paths by construction (`LESSON-UNIFICATION.md` §11).
- **Relabeled the two modalities as the director thinks of them:** the completion-policy control now
  reads **Free-Response** vs **AI Interaction** vs **Choice** (both are "preflights"); section headers
  and card badges match. DB enum (`preflight|interaction|choice`) is unchanged — purely presentational.
- **Lesson id ↔ interaction id default to the same slug** (auto-mirrored while the director hasn't typed
  an interaction id, still editable) — one slug to coordinate with the artifact's `#i=` instead of two.
- **Artifact prefill link.** `app/faculty/lessons.html` now accepts a query string
  (`?new=1&id=&course=&title=&desc=&policy=&url=&obj=key:Label|…&pub=`) so a Claude artifact can hand the
  director a one-click link that opens the New-Lesson form prefilled (interaction + objectives + meta),
  mirroring the existing interaction-manager prefill — documented in
  [`INTERACTION-PREFILL-LINK.md`](docs/contracts/INTERACTION-PREFILL-LINK.md).
- **Form alignment fix:** a `.field` with helper text sat taller than its neighbours and the default
  `.row` centring nudged its input up; editor rows now top-align so inputs line up regardless of hints
  (`#lesson-modal .row { align-items: flex-start }`).

## 2026-06-25 — Matthew Recker

### Added — design doc: rollup agreement (one faculty rollup across both modalities)

Authored [`ROLLUP-AGREEMENT.md`](docs/decisions/ROLLUP-AGREEMENT.md) — the **output contract** for the faculty lesson
rollup, the companion to the per-student *input* contract (`INTERACTION-DATA-CONTRACT.md`). Fixes the
canonical panel set, the shape/length/style of every AI-written field, and which skill owns which field
for which lesson type, so `/preflight-analyze` and `/interaction-aggregate` produce **one** rollup, not
two dialects. Core rule: one rollup, one style, with the **breakdown axis — by objective
(interaction/choice) vs. by question (preflight-only) — as the single permitted divergence**. Documents
the two layers (live numbers via `summarizeReports` vs. the stored AI prose layer), the section +
`'__all__'` scope model, field limits (mirroring `interaction_analysis`), grounding/style rules, and a
proposed convergence of today's two stores (`interaction_analysis` + `assignments.analysis_report`)
into one `lesson_analysis` table. *Why:* a single reference so edits to one skill stay consistent with
the other — the doc to open before touching either rollup skill or the UI.

### Added — faculty lesson rollup now reads the cohort AI analysis (interaction_analysis)

Wired the AI panels in [`app/faculty/report.html`](site/app/faculty/report.html) to the
`interaction_analysis` table (migration 014) the `/interaction-aggregate` skill now populates,
replacing the "coming soon" placeholders with real content where a row exists. New
`loadAnalysis(interactionId)` in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)
pulls every scope row for the lesson in one query (RLS scopes the result); the rollup picks the
row for the current scope — the `__all__` whole-course row for "All sections", else the section's
row. Three panels light up: **AI readiness summary** and **Misconceptions → trends across the
class** render the stored Markdown-light prose (sanitized at render via `.ai-prose`), each with a
"AI generated <date>" note and a quiet "may be out of date" hint when the scope's report count has
moved since (`meta.n`). The **Student responses** panel is now single-section only: it prepends the
aggregator's per-section "AI pick" showcase quotes (`selected_quotes`, resolved to live reflection
text + name from the already-loaded `report_data` + roster) ahead of the random sample; the
"All sections" view shows no quote panel. Everything degrades gracefully — no row (incl. an
instructor's "All sections", which RLS never lets read `__all__`) → today's placeholders + random
sample. *Why:* the aggregator and its store now exist and the table is populated (18 rows across
the demo sandbox + lesson-02/03), so the rollup should show the synthesis instead of stubs — the
deferred "UI wiring" task the skill and `INTERACTION-AGGREGATION.md` §7 call out.

### Operations — first cohort aggregation run (+ backfill) across all interactions with submissions

Ran the new `/interaction-aggregate` skill for the first time over every interaction that has reports,
writing the per-section and whole-course (`__all__`) AI panels — readiness summary, misconception trends,
and showcase quotes — into the `interaction_analysis` table (migration 014): **demo-rollup-sandbox**
(10 sections + course, 206 reports), **lesson-02** (M1A, M5A, course), and **lesson-03** (M1A, M5A, course).
First reconstructed the two reports that were missing structured `report_data` via `/interaction-backfill`
(both Noel Garcia — lesson-02 and lesson-03; the lesson-03 effort clamped to 2 / score 1 for a
non-meaningful reflection, with the disclosed Copilot use recorded as `honor: disclosed`). All 18 analysis
rows verify non-`STALE`. *Why:* populate the rollup's AI layer for the demo sandbox and the two live
lessons so the panels are no longer placeholder-only. lesson-04 has no submissions and was skipped.

### Documented — interaction-aggregate scaling / scheduled-job guidance

Added a "Running at scale / as a scheduled job" section to
[`.claude/skills/interaction-aggregate/SKILL.md`](.ai/skills/interaction-aggregate/SKILL.md): the skill
is slated to run as a **midnight cron** after a lesson's due date, scoped to one course and **one day track
at a time** (M-run or T-run, never both). Guidance: process sections **sequentially, one scope per step —
do not fan out subagents** (the `pull` output is per-section, so a loop bounds context and scales to 20+
sections; parallelism only buys wall-clock speed a cron doesn't need); the `__all__` row is recomputed over
live rows, so on split M/T due dates the earlier run's `__all__` is day-only until the later run overwrites
it with the full course (same point-in-time merge as `assignments.analysis_report`); and `status`'s `STALE`
flag is the post-cron health check. *Why:* the manual fan-in flow I used for the 206-report demo is the
wrong default for the unattended cron — captured the lesson where it lives.

### Fixed — lesson rollup radar chart clipped with more than 3 objectives

The "Objective understanding" radar on [`app/faculty/report.html`](site/app/faculty/report.html) used a fixed
SVG `viewBox` (`0 30 300 190`) that had been tuned for a 3-point triangle (wide and short). Once a lesson
had 4+ assessed objectives the polygon filled out symmetrically and the bottom/side axis labels fell
outside that box and were cropped. `radarSVG` now computes the `viewBox` (and `width`/`height`) from the
actual extent of the label ring plus a small glyph margin, so the chart fits any objective count. Same fix
mirrored into the [`test/test-summary.html`](tests/browser/test-summary.html) preview fixture. *Why:* lessons can
define any number of objectives; the chart must size to the data, not a hard-coded count.

### Added — design doc: unify preflight assignments and lesson interactions under a "lesson"

Authored [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md) — the **proposed** (not yet built) plan to
join the two parallel worlds (`assignments`/`responses`/`scores` and
`interactions`/`preflight_interaction_reports`) under a single **lesson** that can carry a preflight,
an interaction, or both. Captures the planning decisions: track set per lesson
(`preflight`/`interaction`/`choice`) to force exposure to each modality then open choice for research;
lesson worth 2 points effort-gated on either path (correctness/understanding become diagnostic); a new
`lesson_completions` table as the unified grade record with a **first-committed-path-wins lock**; both
paths emit the frozen `schema: 1` `report_data` keyed to a shared per-lesson objective taxonomy so
choice lessons roll up by objective with a modality breakdown (assignment-only stays by-question). The
artifact↔site data contract stays **frozen** (completion rows created by DB trigger on report write).
Includes a migration-016 schema sketch, a `/preflight-analyze` extension to emit effort + understanding,
a phased build plan, and six open questions. *Why:* this is a large, easy-to-get-wrong join; the doc is
the careful plan before any code.

### Changed — lesson rollup moved to its own Report page; Grade/Report dropped from the nav

The lesson rollup that was a modal on [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
is now the body of [`app/faculty/report.html`](site/app/faculty/report.html) (replacing the old
per-assignment submission report). The rollup is unchanged otherwise — same live, AI-free numeric
aggregation via `summarizeReports`, same header completion badge + flag pills + section-scope control,
and the same drill-in cascade (flag pill → flagged-students modal → student summary modal → full
Markdown report modal), which moved to the Report page with it.

- **Reached by link only**, never the nav: the page reads the lesson key from the URL
  (`report.html?i=<slug>`, optional `&section=` to preselect a section scope) and **redirects to
  Interactions** if no key is present. The Interactions completion controls (the %, the per-section
  bars, and *View completion*) now navigate to the Report page instead of opening the modal, and the
  dashboard spotlight's **Open full rollup →** points there for the lesson in view.
- **Grade and Report removed from the faculty top nav** ([`app/js/nav.js`](site/app/js/nav.js)). Grade is
  still reachable from the Roster page; Report is reached only via the links above.
- A `.report-rollup` wrapper in [`app/css/styles.css`](site/app/css/styles.css) reproduces the modal's
  24px padding so the tinted `.lesson-head`'s negative-margin bleed still reaches the edge as a page
  body. The old `app/js/faculty-report.js` data layer is now unused (left in place).

*Why:* the rollup is the report faculty actually want, and giving it a stable URL makes it linkable
from the cards and the dashboard; removing the two redundant nav items declutters the bar.

### Fixed — dashboard (and every page) no longer changes width with its content

Added `width: 100%` to `.page` and `.page-wide` ([`app/css/styles.css`](site/app/css/styles.css)). Root
cause: `<body>` is a flex column, so the `margin: 0 auto` on the content container was an *auto
cross-axis margin* — which makes a flex item **shrink-wrap to its content** instead of filling the
row. The content area's width therefore tracked each view's content: the dashboard rendered narrower
on a lesson with no submissions and wider on one with data (measured 963px → 1180px across states).
`width: 100%` fills the row, `max-width` caps it, and the auto margins still center it, so the width
is now constant regardless of content. Verified by rendering both states in headless Chrome and
measuring `.page-wide` (1180px in both). Also kept `overflow-y: scroll` (+ `scrollbar-gutter: stable`)
on `html` so the vertical scrollbar is always reserved — that removes the residual few-pixel
re-centering when a short view (no scrollbar) and a tall view (scrollbar) alternate. The layout still
reflows at the responsive breakpoints when the window itself narrows.

### Changed — faculty dashboard rebuilt as the Just-in-Time-Teaching landing page

Rolled the [`INBOX/dashboard-redesign.html`](INBOX/) exploration into the real app and wired it to
live Supabase data, replacing the old per-assignment progress-bar roll-up
([`app/faculty/dashboard.html`](site/app/faculty/dashboard.html)). The new dashboard answers the actual
JiTT question — *what do I need to know before my next class?* — with:

- **KPI tiles** tied to the lesson in view: preflight completion %, avg effort (graded), students
  flagged for follow-up, avg understanding (diagnostic). They re-aggregate as you navigate lessons
  or change scope.
- **Active-lesson spotlight** — a completion ring, the 0–5 effort histogram (class mean), the top
  misconceptions surfacing, and a flagged-students callout, for one lesson at a time (defaults to
  the next-due preflight). Lesson navigation via proximity "wings" (pointer) / an inline stepper
  (touch) plus a **↩ Today** shortcut, with past / today / upcoming framing.
- **Your section(s)** cards — headline stats + an *understanding-by-lesson* strip — for the sections
  the logged-in user personally teaches.
- **All-sections matrix** (director-only, collapsed by default) — a section × lesson **heatmap**
  with a Completion ↔ Avg-effort toggle and per-section effort/flags columns; the user's own
  sections sort to the top. Columns stop at the active lesson so not-yet-due lessons don't read as
  "behind."

Role is **real** (from `ctx`, not a preview toggle): instructors get their own sections scoped, no
scope toggle, and no matrix; directors/admins get both. New view module
[`app/js/faculty-dashboard.js`](site/app/js/faculty-dashboard.js) (render + wiring + live aggregation) and
a richer loader `loadFacultyDashboard` in [`app/js/faculty-data.js`](site/app/js/faculty-data.js): one
fetch of every published lesson's per-student rows, grouped by (lesson, section), aggregated live
with the **same `summarizeReports()`** engine the interactions rollup uses — so the two views always
agree. The page itself is now thin (bootstrap → nav → theme → `mountDashboard`).

Collision calls (per Matthew): reused the app's existing `.seg` segmented control and `.stat-tile`
tiles; the new pieces (spotlight, ring, misconception list, your-section cards, matrix, nav wings)
were added to [`app/css/styles.css`](site/app/css/styles.css) with tokens only. Dropped the old "Quick
actions" card (the top nav already links those pages).

### Added — `interactions.due_date` (drives the dashboard's "active" lesson)

Migration [`015_interaction_due_date.sql`](supabase/migrations/015_interaction_due_date.sql) — one
**nullable** `due_date timestamptz` on `interactions` (additive; director runs it). The dashboard
picks the **active/"today"** lesson as the next one due (earliest `due_date ≥ now`), framing earlier
ones as *past* and later ones as *upcoming*; with no due dates set it falls back to newest by
`created_at`. Wired a **Due date** field into the app interaction manager
([`app/faculty/interactions.html`](site/app/faculty/interactions.html) modal + a `due` prefill param +
card display) and `saveInteraction` ([`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)).
**Apply migration 015 before deploying** (the manager + dashboard now select `due_date`). Single
course-wide date, not the M/T split assignments use — the spotlight is one lesson for the whole
director view; an M/T split could be added later without a breaking change.

### Changed — one effort-chart style (the labeled histogram), shared by rollup + dashboard

Per Matthew's call, unified on the redesign's effort histogram (submission count above each 0–5 bar,
6-step distribution ramp `--d0…--d5`) as the single style and back-ported it to the interactions
lesson rollup. Updated the shared `.eff-*` block in [`app/css/styles.css`](site/app/css/styles.css) and
`effortChart()` in [`app/faculty/interactions.html`](site/app/faculty/interactions.html) (was the s-ramp
with no counts).

### Added — faculty-dashboard design sandbox

[`test/test-faculty-dashboard.html`](tests/browser/test-faculty-dashboard.html) — like the student sandbox but
it drives the **live render module** (`app/js/faculty-dashboard.js`) with a synthetic model via its
render-only `renderModel` entry, so it tracks both the stylesheet *and* the render logic. Toggles for
role / active lesson / theme; linked from the [`test/`](tests/browser/test.html) hub. Verified in headless
Chrome across director, instructor, light, and matrix-open states.

### Changed — design sandboxes moved into `test/` + new student-dashboard sandbox

Moved the standalone preview pages out of the repo root into a dedicated [`test/`](tests/browser/) directory
(`git mv`, history preserved): [`test/test.html`](tests/browser/test.html) (hub),
[`test/test-summary.html`](tests/browser/test-summary.html), and
[`test/test-progressbar.html`](tests/browser/test-progressbar.html). Added
[`test/test-student-dashboard.html`](tests/browser/test-student-dashboard.html) — a synthetic-data preview of
the **student** landing page rendered on the **live** design system (links `app/css/styles.css`,
mirrors the real top nav). Unlike the other sandboxes it intentionally reuses the production
stylesheet so it tracks the real app. It previews the proposed dashboard direction: a single
deadline-sorted **Up next** feed merging preflights *and* interactions (the live loader doesn't yet
surface `interactions.due_date`), a **"Review before class"** formative panel built from a completed
interaction's `report_data` (effort/points, per-objective strength meters, `recommended_review`), and
recent grades. The `../test-summary.html` link in [`app/DESIGN.md`](site/app/DESIGN.md) was repointed to
`../test/`. Why: keep the repo root clean and group the no-DB design previews; give the student
dashboard a sign-off surface like the faculty rollup already has.

### Added — `interaction-aggregate` skill (builds the cohort analysis the spec designed)

Built the cohort aggregator the `INTERACTION-AGGREGATION.md` spec called for — the
interaction-path analog of `/preflight-analyze`. It reads the per-student `report_data` across an
interaction and writes the class-level AI synthesis the faculty rollup shows as "coming soon"
placeholders: a **readiness summary**, **misconception trends**, and **2-3 AI-picked
reading-reflection quotes**, as **one rollup per section plus a whole-course rollup**. Files are
created but **not yet run** (run after the due date, when submissions are frozen).

- **Table** — [`supabase/migrations/014_interaction_analysis.sql`](supabase/migrations/014_interaction_analysis.sql)
  (director runs it; Claude has no DDL). One row per `(interaction_id, section_id)` where
  `section_id` is a real section or the `'__all__'` whole-course sentinel; columns
  `readiness_summary` / `misconception_trends` / `selected_quotes` (`[{student_id, section_id}]`) /
  `meta` / `generated_at`. Read-RLS mirrors `preflight_interaction_reports` (directors → all incl.
  `'__all__'`; instructors → own sections only); writes only via the BYPASSRLS `claude_code_recker`
  role (no write policy, no role-specific GRANT — default privileges cover it). CHECKs bound the
  prose and enforce **no quotes on the `'__all__'` row**.
- **Helper** — [`supabase/admin/interaction_aggregate.py`](supabase/admin/interaction_aggregate.py)
  (`pull` / `write-analysis` / `status`). `pull` groups reports per section + `'__all__'`, emitting
  a **precomputed numeric summary** (a focused Python port of the UI's `summarizeReports`, so the
  prose cites the same figures the bars show) plus the per-report free-text fields the model reads;
  no names, no `report_markdown`. `write-analysis` re-derives `meta.n` + a `source_fingerprint`
  from live rows, validates section ids and that every quote's student is actually in that section,
  enforces the no-`'__all__'`-quotes rule, and upserts (`--dry-run` first). `status` flags staleness.
- **Skill** — [`.claude/skills/interaction-aggregate/SKILL.md`](.ai/skills/interaction-aggregate/SKILL.md):
  preflight → pick lesson (nudge to `/interaction-backfill` if `report_data` is missing) → `pull` →
  write the three panels per scope (quote-selection criteria + "ground in the numbers" rule;
  whole-course row is prose-only) → `write-analysis` → verify via `status`. Read-only on grades.
- **Decisions settled** (from the spec's open list): per-section **and** whole-course rollups
  (`'__all__'` sentinel); dedicated table over JSONB; quotes stored as ids (reports are frozen at
  run time, so they resolve to stable text); manual regeneration; **quotes only on single-section
  views** (the "All sections" view shows prose only), which also keeps each instructor's quote pool
  scoped to their own sections. **UI wiring is a deferred follow-up** — the skill writes the data;
  the rollup still shows placeholders until `app/faculty/interactions.html` is wired to read the
  table (rules for that captured in the skill's "Deferred — UI wiring" section).

### Added — `INTERACTION-AGGREGATION.md` spec for the cohort analysis aggregator

Wrote the design spec for the not-yet-built **cohort aggregator** that fills the rollup's three AI panels
(readiness summary, misconception trends, AI-picked showcase quotes), to disentangle it from the
per-student `/interaction-backfill` repair tool. [`INTERACTION-AGGREGATION.md`](docs/decisions/INTERACTION-AGGREGATION.md)
covers the goal, inputs (all already in `report_data` — **no data-contract change**), the output shape, a
proposed `interaction_analysis` table (draft migration `014`, read-RLS mirroring the reports, written by the
scoped `claude_code_recker` role), the run steps (reuse `summarizeReports` for the numbers + batched
text-only AI passes), how the rollup consumes it with graceful degradation, and seven open design decisions
to settle before building. Also pointed the CLAUDE.md "Deferred" note at the spec. Documentation only.

### Added — `interaction-backfill` skill + scoped DB role for direct database access

Stood up direct, least-privilege database access for Claude Code and used it to backfill the
schema-1 `report_data` on interaction reports that only had `report_markdown` — those lessons
were showing completion counts but an empty faculty rollup (no effort/understanding/misconceptions).

- **Scoped DB role** — [`supabase/admin/claude_code_role.sql`](supabase/admin/claude_code_role.sql)
  creates `claude_code_recker`: SELECT/INSERT/UPDATE/DELETE on `public`, BYPASSRLS, **no DDL** (owns
  nothing, so ALTER/DROP/TRUNCATE are refused by Postgres itself). Strictly additive — it does not
  touch the `service_role` key, the anon key, or any existing RLS policy, so `/preflight-analyze` is
  unaffected. Reached over the **Session pooler** (the direct host is IPv6-only here) from a project
  venv (`.venv/`, gitignored) via `psycopg2` ([`requirements.txt`](requirements.txt)); the credential
  lives in a gitignored `supabase/admin/config.json` (next to the role SQL + scripts, not owned by any skill).
- **`db_check.py`** — connectivity + permission self-test (read OK, write OK, DDL DENIED).
- **`interaction-backfill` skill** (named for the one-off repair it is, leaving `interaction-analyze` free
  for the future cohort aggregator) — [`.claude/skills/interaction-backfill/SKILL.md`](.ai/skills/interaction-backfill/SKILL.md)
  + [`supabase/admin/interaction_reports.py`](supabase/admin/interaction_reports.py) (`stats` /
  `list-missing` / `write`). Reads each report's Markdown and reconstructs a faithful schema-1
  `report_data` per [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md): effort (with the
  reading-reflection cap), understanding, consistent per-lesson objective keys, misconceptions with
  evidence, reflection, honor (judged by appropriateness), and triage flags. Marks provenance with
  `producer: "backfill-from-report@<date>"`. The writer sets `effort` + `report_data` (the
  migration-013 trigger derives `score`), fills only NULL rows unless `--force`, re-clamps effort for
  non-meaningful reflections, and enforces the 32 KB blob cap.
- **Backfilled the 8 existing reports** that lacked structured data (7 in lesson-02 charge/Coulomb,
  1 in lesson-03 vector form). Lesson-02 now rolls up to avg effort 3.43, 11/14 points, 2
  reflection-capped, 1 honor disclosure.
- **Docs:** operator runbook [`supabase/admin/README.md`](supabase/admin/README.md), a committed
  `config.json.template`, and an agent operating guide
  [`supabase/admin/AGENT-DB-ACCESS.md`](supabase/admin/AGENT-DB-ACCESS.md) — how Claude iterations
  connect/operate, the rules, and how the access was established.

### Changed — integrity/notable flag semantics sharpened (rollup + data contract)

Refined what the lesson rollup's flag pills mean and clarified [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md)
to match — a **v1 clarification** (no endpoint/hash/type/wire-format change; `schema` stays `1`, applied
because only one artifact exists and is easy to update):

- **`honor.status` now judges *appropriateness*, not disclosure.** Appropriate collaboration (talking with a
  classmate beforehand, allowed resources) is `none` and unflagged. `disclosed` now means **inappropriate**
  help/resources (another AI actively helping, disallowed materials) and surfaces as **“Inappropriate
  resources.”** `concern` is a conversation-level integrity problem — manipulating/harassing the AI to inflate
  the report or game the effort grade. (§5.6, with a dated clarification note.)
- **`flags.notable` now means exemplary work** (strongest understanding or a notable extension), not “either
  direction.” (§5.8; the §6 example was updated for consistency.)
- Added a §9 note that artifacts should always populate `flags` / `honor` / `reading_reflection.meaningful`,
  and that the site can derive `needs_follow_up`/`notable` from effort + understanding but never `honor`.
- Aligned the flag pill labels/descriptions in [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
  to the new wording (“Disclosed help” → “Inappropriate resources”; notable → exemplary).

---

## 2026-06-24 — Matthew Recker

### Changed — portal theme reskinned to GitHub Primer + a self-hosted display font

Promoted the [`test-summary.html`](tests/browser/test-summary.html) sandbox's new look into the live `app/` portal.
The palette in [`app/css/styles.css`](site/app/css/styles.css) moved off Air Force navy/gold to a
**GitHub-Primer** system — `--blue`/`--blue-lt` are now both `#0969da` (light) / `#4493f8` (dark),
surfaces/borders/text and all four alert families adopt Primer values, and **USAFA gold is retained only
as a restrained accent** (feedback rail). Both `:root` and `[data-theme="dark"]` were rewritten; a new
`--text-soft` ink tone was added. Hero titles now use a **self-hosted Oswald** condensed display face —
two woff2 subsets decoded into [`app/media/fonts/`](site/app/media/fonts/) and wired via `@font-face` + the
new `--font-display` token (applied to `.page-head h1`, the nav brand, the login title, and the lesson
rollup title; body/UI stay on the system stack, so there's no build step and no third-party network call).
Every `app/` page inherits this through the shared stylesheet. [`app/DESIGN.md`](site/app/DESIGN.md) was updated
to document the new palette, the display face, and the v3 rollup components.

### Changed — faculty lesson-summary rollup rebuilt to match the sandbox (live data)

Rebuilt the lesson report rollup in [`app/faculty/interactions.html`](site/app/faculty/interactions.html) to the
sandbox design, wired to real `report_data` via `summarizeReports` (no AI). New layout: a **tinted full-bleed
header** (Oswald title + a stacked **“Submitted N/total” completion badge** + clickable **flag pills** + an
**adaptive scope control** — a segmented control for few sections, a dropdown for many); **bordered effort +
radar tiles** (vertical effort bar chart; an **interactive radar** whose vertices show the objective + mean on
hover); an **AI readiness summary** placeholder (replacing a bare effort summary — the effort chart already
conveys the number); a **Misconceptions** panel with **real per-misconception prevalence bars** (share of
submitted students, computed from `report_data`) above an AI trend-narrative placeholder; a **weakest-first,
one-per-row** understanding-by-objective breakdown; and a new **Student Responses** panel that surfaces real
reading-reflection quotes (names hidden by default, shuffle, copy-for-slides). Flag pills now drill down in
**stacked modals**: pill → student names list → one student's structured summary → full Markdown report. The
headline overall-understanding gauge was dropped (the radar conveys it). Everything numeric is live; the AI
narrative panels (readiness, misconception trends) and the aggregator-selected showcase quotes stay inert
until the analysis-output store exists — **no data-contract change is required** for any of it.

### Added — `app/DESIGN.md` design-system spec for the portal refactor

Authored [`app/DESIGN.md`](site/app/DESIGN.md), a tokenized design-language document for the `app/` portal,
following the DESIGN.md format (Google Stitch / getdesign.md): YAML front matter capturing the live
tokens from [`app/css/styles.css`](site/app/css/styles.css) — the two-palette light/dark color roles, the
em-based type scale, spacing/radius/elevation, and component compositions — followed by prose sections
(Overview, Colors, Typography, Layout, Elevation, Components, Responsive Behavior, Known Gaps) that
explain the *intent* behind each rule. Purpose: let a human or agent extend the UI on-brand without
re-deriving the system, and codify the governing rule that pages are authored with tokens only (never a
hardcoded surface/status color). Documentation only — no code or DB changes.

### Added — `test-summary.html` rollup sandbox (synthetic data, no DB) + `test.html` is now a hub

To iterate on the lesson-rollup design without a database, the old `test.html` progress-bar playground was
renamed to [`test-progressbar.html`](tests/browser/test-progressbar.html) and [`test.html`](tests/browser/test.html) is now a small hub
that links to the sandboxes. New [`test-summary.html`](tests/browser/test-summary.html) is a fully standalone preview
(palette copied in, 24 synthetic cadets across 3 sections, no DB and no CDN) of the next rollup iteration:

- **Overall-understanding gauge removed** — the radar already conveys it.
- **Effort distribution + radar share row 2**, sized to equal height (a 2×2 grid whose row tracks stretch);
  **below the effort chart** is an AI-aggregator **summary placeholder (TBD)** sized to match the radar's
  objective key beneath it.
- **Effort bars colored by points earned**: 0 = red (0 pts), 1 & 2 = the same amber (1 pt), 3/4/5 = three
  distinct greens (2 pts). Class average drawn as a labeled line.
- **Radar axes labeled A, B, C…** (always legible) with a **lettered objective key** listed beneath it.
- **Understanding by objective is one objective per row**, full width, as a **5-column** fine histogram
  labeled 1–5 (score 0 is the leftmost sub-cell of column 1; the axis ends at 5, not 6, so the colors align).
- **Flags now drill down in stacked modals**: click a flag → a **list of student names + sections** (no
  summaries) → click a name → that student's **summary** modal → **View full report** → the full Markdown
  report. (Replaces the long scrolling list of all summaries.)

These changes live only in the sandbox for now; porting to [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
comes after design sign-off. The demo seed already carries the third objective needed for the radar.

## 2026-06-23 — Matthew Recker

### Changed — restructured the interaction rollup into three rows + flag-driven student drill-down

Reworked the faculty lesson rollup ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) into a
fixed top-to-bottom layout and removed the all-students list:

- **Row 1 — Overall understanding** (all topics) as the headline gauge. The value tag is now a neutral
  high-contrast pill (legible on any zone color — the old white-on-yellow was unreadable).
- **Row 2 — Effort distribution** with the class **average drawn in** as a labeled reference line, sharing the
  row with a **radar** giving a quick read of understanding across every objective (needs ≥3 objectives —
  a spider needs ≥3 axes).
- **Row 3 — Understanding by objective** as a **two-column** grid of fine-cell (5×5-style) histograms. Headers
  reserve a fixed two-line height (and clamp to two lines), so a long title that wraps never pushes its chart
  below a short-titled neighbor — every chart on the row stays aligned. An odd final tile is centered on its
  own row but capped to a single column's width (never wider than the others).
- A **Section dropdown** at the top of the summary rescopes every plot (all sections / one section); **Export
  for analysis** moved to its own bottom row beneath the summary.

The roster list is gone. **Flag chips now open a modal** of just the matching students; each shows the
(well-liked) structured summary panel plus a **View full report ↗** button that opens that student's full
Markdown report in a further stacked modal — no inline AI report by default. New `.lr-*`/`.fm-*` styles and a
`lrEffort()` mean-line builder added; inline list/report code removed.

`supabase/seed_demo_interaction.sql` gained a **third objective** (`induced-charge`) so the synthetic demo
exercises the radar (and the odd-tile centering in row 3). Re-run the seed to refresh existing demo data.

### Docs — recorded that Node is unavailable (and uninstallable) on the dev machine

Noted in `.claude/CLAUDE.md` (Tech Stack + Important Notes) and [`app/README.md`](site/app/README.md) that this
machine has **no Node and cannot install it** — there is no `node`/`npm`/`npx`, `node --check`, eslint, or
jest, and no build step. The frontend is hand-authored ES modules + plain CSS the browser runs directly, so
changes are verified by **opening the pages in a browser** (`python -m http.server 8000` from the repo root),
never with a JS linter/test runner/typecheck. This is a hard environment constraint, not a preference.

### Changed — redesigned the interaction rollup (gauges, histograms, radar, clickable flags)

Rebuilt the faculty lesson-rollup ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) to be
far less busy and to surface the **spread**, not just the average — a class mean of 2.5 can be "everyone
mediocre" or "half aced it, half lost," and those need different responses. The new rollup is:

- **Two headline gauges** — Effort (graded) and Understanding (diagnostic) — as 5-zone connected-blocks
  bars (red→green, each zone = one point, lit to the value) with a readable value tag above the fill.
- **Effort distribution** — a compact 0–5 histogram.
- **Understanding by objective** — a **class-profile radar** (mean vs. a 3.5 target; shown only with ≥3
  objectives) plus a **fine-cell histogram** per objective (each score region split into thin same-color
  cells) showing each objective's distribution.
- **Clickable flag chips** — *Needs follow-up / Notable / Disclosed help / Integrity concern / Reflection
  capped* — clicking one filters the student list to just those reports (toggle off or "Show all" to clear).

Removed for clarity: points-awarded, self-rated understanding (we never collect it — it only appeared
because the demo seed invents it), confidence gap, the separate "completed flow" tile (the
submissions/`28/33 · 85%` line already shows completion), the misconception pills, and the `[placeholder]`
AI-narrative boxes. `summarizeReports()` ([`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js))
now also returns a 0–5 distribution for overall understanding and per objective; new ramp tokens + `.lr-*`
component styles live in [`app/css/styles.css`](site/app/css/styles.css). Styles were prototyped in `test.html`.

### Added — synthetic seed for previewing the interaction rollup

New [`supabase/seed_demo_interaction.sql`](supabase/seed_demo_interaction.sql) populates a clearly-fake
demo interaction (`demo-rollup-sandbox`, an unpublished draft) with one synthetic `schema:1` report per
real student in a course, so the faculty rollup (`summarizeReports()` in
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)) can be previewed with realistic data
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
Platform*). Updated the `app/` portal nav brand + footer ([`app/js/nav.js`](site/app/js/nav.js)), the
login screen (now shows the full name as a tagline, [`app/login.html`](site/app/login.html)), every
`app/` page `<title>`, and the legacy page headers/titles (`index.html`, `admin.html`,
`review.html`, `interactions.html`, `interactions-admin.html`, `artifact-submit.html`). The
repository, GitHub Pages path, and CSV/JSON export filenames stay `Core_Preflights` on purpose —
renaming them would break deployed-artifact links (the frozen data contract), bookmarks, and
existing Blackboard grade imports. Documented the brand-vs-repo distinction at the top of
`.claude/CLAUDE.md`.

### Added — interaction summaries (numeric rollups from `report_data`)

Built the per-lesson **summary** that the data contract said the site computes without AI. The
faculty report modal ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) now shows a
live, section-scoped rollup over every in-scope report: effort average + points + an effort 0–5
distribution, completion, assessed-vs-self-rated understanding with the confidence gap, per-objective
understanding bars, misconception counts, reading-reflection meaningful-rate / effort-capped count /
sentiment / topic tags, and integrity + triage-flag tallies. All numbers are folded from
`report_data` (schema 1) by a new pure aggregator `summarizeReports()` + fetcher `loadInteractionData()`
in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js), coercing out-of-range/wrong-typed
LLM output defensively. Each individual report also gets a structured panel above the Markdown (effort,
understanding, objectives, misconceptions, reflection, honor, flags, and the artifact's per-student AI
narrative). Students now see their own effort/points on the interactions page
([`app/js/student-data.js`](site/app/js/student-data.js), [`app/student/interactions.html`](site/app/student/interactions.html)).
The **free-text trend prose** that genuinely needs the AI aggregation pass — the cohort narrative,
clustering of novel/free-text misconceptions, and reflection-theme synthesis — is rendered as labeled
`[placeholder]` blocks pending that pipeline. Styles added to [`app/css/styles.css`](site/app/css/styles.css).

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

Wrote [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md): the frozen contract
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
redaction. New function in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js):

- `buildLessonCorpus(ctx, interactionId)` — concatenates every report for one lesson (directors:
  all sections; instructors: their own; RLS independently gates reads) into one Markdown document,
  one block per student labeled with name · student ID · section, ordered by section then ID.

A new **Export for analysis ⬇** button in the lesson-report modal
([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) downloads
`<interaction-id>-reports.md` for handoff to the aggregator.

(An earlier name-redacting `redactReport()` step was built and then removed once the PII
determination made it unnecessary — keeping the export simple.)

### Added — clickable interaction completion with a per-student report viewer

On the faculty interactions page ([`app/faculty/interactions.html`](site/app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)), the completion percentage and
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
added to [`app/css/styles.css`](site/app/css/styles.css).

### Changed — faculty dashboard roll-up is now interactions-only, split by ownership

Reworked the faculty dashboard ([`app/faculty/dashboard.html`](site/app/faculty/dashboard.html) +
[`app/js/faculty-data.js`](site/app/js/faculty-data.js)) toward the interactions-first test:

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

Wrote [`app/PLAN-2026-06-22.md`](site/app/PLAN-2026-06-22.md): a dependency-ordered plan to push the
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
[`app/faculty/interactions.html`](site/app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js) now do add / edit /
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
[`INTERACTION-PREFILL-LINK.md`](docs/contracts/INTERACTION-PREFILL-LINK.md), including the load-bearing rule
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
[`app/media/icons/ICONS.md`](site/app/media/icons/ICONS.md) (name · description · search terms ·
status · where-used) — the source of truth for adding/retiring icons. The old AI
search-prompt file was removed.

Navbar tweaks per request: **bigger, box-less brand logo** pinned left; **box-less** theme
toggle and user chip pinned right (backgrounds/borders removed, subtle hover only).

### Added — Flaticon attribution footer

The portal icons are all from **Freepik on Flaticon**, whose free license requires a visible
credit. Added a shared site footer (rendered by `renderNav` → `renderFooter` in
[`app/js/nav.js`](site/app/js/nav.js), styled in [`app/css/styles.css`](site/app/css/styles.css)) that
appears on every page displaying the icons, linking to
<https://www.flaticon.com/authors/freepik>. Login/router pages use only emoji, so they carry
no footer.

### Changed — cleaner, modern portal navbar

Restyled the `app/` top navigation after Featurebase's clean aesthetic: a light,
**translucent + blurred** sticky bar with a hairline bottom border (no heavy colored bar
or drop shadow), muted medium-weight links that darken into a soft pill on hover/active, a
subtle bordered brand mark, gradient-avatar user chip, and rounded controls. Added
`--nav-*` theme tokens with a dark-translucent variant so it reads well in both modes.
Pure CSS in [`app/css/styles.css`](site/app/css/styles.css) — no markup changes.

### Added — Roster & Sections ported into the `app/` portal

Director tooling now lives natively in the portal. New [`app/faculty/roster.html`](site/app/faculty/roster.html)
+ [`app/js/faculty-roster.js`](site/app/js/faculty-roster.js) combine the legacy Roster and
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

- [`app/faculty/grade.html`](site/app/faculty/grade.html) + [`app/js/faculty-grade.js`](site/app/js/faculty-grade.js)
  — the full grading workflow: assignment + section pickers, the 3-state credit toggle
  (full → warn → zero), per-question feedback, "only flagged" filter, per-student totals,
  save-draft / finalize-&-publish, reopen, and grant/edit/remove extensions. Same
  `scores.question_scores` shape, `is_finalized` semantics, and `extensions` writes as the
  legacy tab — a faithful port, restyled with theme tokens and delegated events.
- [`app/faculty/report.html`](site/app/faculty/report.html) + [`app/js/faculty-report.js`](site/app/js/faculty-report.js)
  — submission summary, "did not submit" list, and per-question cards showing the
  `analysis_report` class summaries (from `/preflight-analyze`) plus raw responses with
  show-names, random-10 sampling, and copy-to-clipboard.
- Faculty **nav** now exposes Grade and Report directly; a single **Admin ↗** link covers
  the still-legacy director tools. Dashboard quick-actions point Grade/Report at the new
  internal pages.

Still legacy (next passes): Assignments builder, Roster, Sections, Instructors, Export.

### Added — `app/` role-based portal (foundation pass)

A coherent, role-aware rewrite of the front end living in a new [`app/`](site/app/) subfolder,
built to be promoted to the repo root later. **No database or RLS changes.** This first
("foundation") pass ships the shell, theming, navigation, both dashboards, and the
interaction views; the heavy grading / roster / sections / assignment-builder / export
tools stay on the legacy pages and are reached via out-links until ported in a later pass.

**Why:** the legacy pages each re-implemented their own login card, session check, and
`esc()` helper, had no shared module, no dashboard landing, and a single light-only theme.
The portal unifies all of that behind one auth bootstrap and a top nav with light/dark mode.

**Shared shell ([`app/js/`](site/app/js/)):**
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

**Pages:** [`app/login.html`](site/app/login.html) (unified cadet-ID-or-email login),
[`app/index.html`](site/app/index.html) (role router), student
[dashboard](site/app/student/dashboard.html) / [assignments](site/app/student/assignments.html)
(ported submit+review engine) / [interactions](site/app/student/interactions.html), and faculty
[dashboard](site/app/faculty/dashboard.html) (per-section submission/grading roll-up) /
[interactions](site/app/faculty/interactions.html) (completion roll-up + per-student report viewer).

**Design system:** [`app/css/styles.css`](site/app/css/styles.css) is the legacy sheet with its
~14 hardcoded surface/alert colors tokenized into CSS variables plus a `[data-theme="dark"]`
set, extended with top-nav, stat-tile, and roll-up components.

**Icons:** [`app/media/icons/ICONS.md`](site/app/media/icons/ICONS.md) documents the
cohesive icon set; the UI references those filenames and falls back to emoji when needed. See
[`app/README.md`](site/app/README.md) for the structure and go-live steps.

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
- [`interactions-admin.html`](site/interactions-admin.html) — director/admin page to add/edit
  (modal), publish, delete lessons, and view submissions. Submissions are picked by
  section → student dropdown (scales to ~1000 students; fetches one report at a time) and
  rendered as sanitized Markdown.
- [`interactions.html`](site/interactions.html) — student-facing list of published lessons with
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
