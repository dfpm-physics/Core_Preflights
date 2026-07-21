---
name: lesson-aggregate
description: >
  Cohort/section AGGREGATION tool for a LESSON, whichever way students worked it — the interactive
  artifact, the written question set, or a mix. Reads the per-student schema:1 assessment across
  the whole cohort and writes the class-level AI synthesis the faculty rollup shows as "coming
  soon" placeholders: a readiness summary, misconception trends, and 2-3 AI-picked
  reading-reflection quotes — one scope per section PLUS a whole-course scope.
  Use when a director wants the lesson rollup's AI panels filled — i.e. "aggregate the lesson",
  "summarize the lesson rollup", "generate the readiness summary / misconception
  trends / showcase quotes for a lesson", or /lesson-aggregate. Writes to the
  app.analysis_reports table. NOT /interaction-backfill and NOT /preflight-analyze, which produce
  the per-student structured content — that must already be populated (this consumes it). Run
  AFTER the due date (when submissions are frozen) by a Course Director / System Admin on a
  machine with the scoped prep_app_dml DB role.
---

# Lesson Aggregate — cohort/section analysis for the lesson rollup

> **Scope / what this is.** This is the **cohort AGGREGATION** skill the
> [`INTERACTION-AGGREGATION.md`](../../../docs/decisions/INTERACTION-AGGREGATION.md) spec describes. It turns many
> per-student structured blobs into the **class-level free-text synthesis** the faculty lesson
> rollup can't compute from numbers alone:
> 1. **Readiness summary** — how ready the class is, where understanding is solid vs. shaky, what to cover first.
> 2. **Misconception trends** — prose under the live prevalence bars (clustering, spreading/fading, by section).
> 3. **Showcase quotes** — 2-3 of the most interesting reading-reflection comments, per section.
>
> It does **not** touch grades and does **not** recompute the numeric charts — those stay live in
> the browser. It only writes the AI layer to `app.analysis_reports`.

## It aggregates a LESSON, not an interaction (renamed 2026-07-21)

Named `/interaction-aggregate` until it only had one kind of input. A lesson can be worked two
ways and **both paths now emit the same `schema: 1` per-student assessment**, so one aggregator
serves both:

| path | who writes the assessment | where it lands |
|---|---|---|
| interactive | the Claude artifact, at submit | `submission_activities.content` |
| written | `/preflight-analyze`, at grading | `grades.diagnostic` |

`pull` normalizes both into `report_data`, so nothing downstream branches on modality. A
question-only lesson gets a full rollup; a mixed lesson's prose describes the whole cohort
instead of the half that took the artifact.

**Two clocks, two skills — this is why they are not merged.** Grading is per-student and runs
early and often, sometimes split M-day/T-day. Aggregation is per-cohort and runs once, after the
deadline, unfiltered — a readiness summary written over half a cohort is worse than none. Keep
this distinct from `/preflight-analyze` (per-student grading + assessment) and
`/interaction-backfill` (repair of interactive assessments), both of which must run first.

**Check the cohort before you write.** `pull` reports a `paths` block and warns when structured
content is missing, split by path — an interactive report without schema:1 needs
`/interaction-backfill`; a written submission without one needs `/preflight-analyze` to have run.
Aggregating over a cohort that is half-unassessed produces prose that misdescribes the class.

**Canonical specs:** [`INTERACTION-AGGREGATION.md`](../../../docs/decisions/INTERACTION-AGGREGATION.md) (the design),
[`ROLLUP-AGREEMENT.md`](../../../docs/decisions/ROLLUP-AGREEMENT.md) (the output contract — field shapes and style),
[`INTERACTION-DATA-CONTRACT.md`](../../../docs/contracts/INTERACTION-DATA-CONTRACT.md) (the inputs, schema 1).

Run by a **Course Director / System Admin** with the scoped `prep_app_dml` role
(`supabase/admin/.env`) and the project venv. Run it **after the due date**, when submissions are
frozen — the analysis is a point-in-time read of the cohort.

---

## Where the data lives (PREP v2 — schema `app`)

| what you are reading / writing | `public` (retired) | `app` (now) |
|---|---|---|
| the lesson | `interactions` (own table) | an `assignment_offering` — its `activities` may be interactive, written, or both; `activities.slug` is the old `interactions.id` verbatim |
| which term it runs in | — | `offering_activities` → `assignment_offerings` → `course_offerings` |
| the per-student data (interactive) | `preflight_interaction_reports.report_data` | `submission_activities.content`, via `submissions` |
| the per-student data (written) | — | `grades.diagnostic` where `schema = 1`, written by `/preflight-analyze` |
| the written reflection TEXT | — | the student's answer in `submission_activities.content`, at the question marked `role: "reading_reflection"` — deliberately **not** copied into `grades.diagnostic` |
| effort / points | `…​.effort` / `…​.score` | `grades.effort` / `grades.points_earned` |
| the section | `students.section_id` (`'M1A'`) | `enrollments` → `sections.id` (uuid) + `sections.code` |
| the output | `interaction_analysis` (one row per section) | `analysis_reports` (one row per offering — see below) |

### Why the per-section rows became one row with scopes inside it

`interaction_analysis` was keyed `(interaction_id, section_id)` — one row per section plus an
`'__all__'` sentinel row. `analysis_reports` is keyed
`UNIQUE NULLS NOT DISTINCT (scope, scope_id, audience_id, kind)`, and that key **carries no lesson**:
storing a section rollup as `scope='section', scope_id=<section uuid>` would make the same section
collide across every lesson of the term.

So a lesson's cohort analysis is **one row**:

| column | value |
|---|---|
| `scope` | `assignment_offering` |
| `scope_id` | the offering that schedules the interactive activity |
| `audience_id` | `NULL` (whole-course; this skill writes no per-instructor rows) |
| `kind` | `readiness` — the panel set this skill owns (`ROLLUP-AGREEMENT.md` §6) |
| `payload.scopes` | keyed by **section uuid**, plus the `"__all__"` key for the whole course |

Per-scope independence is preserved by **merging**: `write-analysis` reads the existing payload and
updates only the scopes in your input file, leaving the rest untouched. So an M-day run and a T-day
run still never collide — the property the old per-section rows gave for free.

---

## Prerequisites

1. **The `app` schema is live** and `analysis_reports` exists (migration
   `supabase/migrations/app/001_core_model.sql`). The AI operator has **no DDL rights** — if a
   command errors with `relation "analysis_reports" does not exist`, hand the migration to the
   director; do not try to create it.
2. **Structured content is populated.** This skill aggregates `submission_activities.content`. If a
   lesson's rows are missing it, run **`/interaction-backfill`** first (`pull` warns and prints the
   missing count). Missing rows skew counts and are excluded from means.

## Step 0 — Preflight

```
.venv/Scripts/python supabase/admin/app_tier_check.py
```
Confirms the `app` tiers connect, read, and that `dml`/`read` are denied DDL. If it can't connect,
the credential (`supabase/admin/.env`) is missing or the direct host was used instead of the
**Session pooler** — see `supabase/admin/app_schema_bootstrap.sql`. (The `owner` tier failing to
connect is expected once sealed.)

## Step 1 — Pick the lesson & confirm data is ready

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Pick the lesson to aggregate. If an interactive activity's `missing` count is > 0, run
`/interaction-backfill` for it first. `stats` covers the interactive path only — for the written
path, `pull` (Step 2) reports what is missing and the fix is a `/preflight-analyze` run.

## Step 2 — Pull the cohort

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py pull \
  --lesson <slug> --out <scratch>/agg.json
```
`--lesson` takes the **assignment slug** (`preflight-08` — the lesson) or an **activity slug**
(`lesson-08-potential` — the frozen artifact key). Prefer the assignment slug: it names the
lesson rather than one of its halves, and a question-only lesson has no artifact slug at all.
(`--activity` and `--interaction` remain as aliases.)

Writes one JSON file with a scope per section **plus** a whole-course `__all__` scope. Each scope
carries a **precomputed `numbers` summary** (effort/understanding/objective/misconception/
reflection/flag aggregates — the same figures the UI bars show, now scaled by the offering's
`points_possible` rather than a hardcoded 0–2) and, for per-section scopes, a `reports` array of
the free-text fields (reflection text, misconception descriptions/evidence, objectives,
narratives). The `__all__` scope is **numbers only**. **Read that file.** Use the **session
scratchpad** for it — it contains reflection text and must not land in the repo.

`pull` refuses to guess if the lesson is scheduled in more than one *active* offering (i.e. it is
being re-run in a new term while the old one is still active) — deactivate the stale
`course_offering` first.

### Read the cohort shape before writing a word

The file's top level carries `modalities` (what the lesson offers) and `paths` (how the cohort
actually worked it: `interactive_n`, `written_n`, `mixed`). Every scope's `numbers.paths` repeats
it per section, and each report row carries its own `path`.

**This changes what the prose may claim.** Effort is one distribution across both paths (Q2 of a
written preflight is the same reading reflection the artifact scores, on the same rubric), so an
effort mean describes everyone. Understanding is *not* one measurement:
`numbers.understanding.from` splits it, and `objectives` marks each item `source:
"interactive"` or `"written"` — the written path contributes a single `__free_response__` item
rather than a per-objective breakdown, because one free-response question does not decompose.
Say "the question-set cohort" or "the artifact cohort" when a finding is specific to one; never
imply an objective breakdown exists for students who never had one.

Heed `pull`'s warnings before continuing: missing structured content is reported **split by path**
because the remedy differs (`/interaction-backfill` vs. a `/preflight-analyze` run), and a lesson
whose written activity has no `role: "reading_reflection"` question cannot supply written quotes.

## Step 3 — Write the analysis (per scope)

Produce a JSON array of `{activity_slug, section_id, readiness_summary, misconception_trends,
selected_quotes}` — one entry per scope in the pull file (each section + `__all__`).

`section_id` accepts the **section uuid** or its **code** (`"M1A"`), or the string `"__all__"`.

**Ground the prose in the precomputed `numbers`; do not recompute them.** Cite the figures already
in the file (e.g. "8/14 showed force-superposition", "avg effort 3.4/5") so the narrative agrees
with the live bars. Keep each prose field to a short paragraph or a few bullets, Markdown-light
(it's rendered with the existing sanitizer). Each ≤ 8000 chars.

### readiness_summary — every scope
A short read for a faculty member opening the rollup before class: overall engagement, where
understanding is solid vs. shaky (lean on the weakest objectives + the self-vs-assessed gap),
notable flags (reflection-capped, honor, needs-follow-up counts), and **what to cover first in
class**. For `__all__`, synthesize across sections (note if one section lags) using the per-section
reports you already read.

**Use `numbers.reading` where it exists** — the class's self-reported time on the reading (Q1),
as a **median** and five buckets. It is often the most actionable number on the page: a median
that collapses, or a bimodal split where half the class is under 15 minutes, changes what is worth
covering in class more than any single objective score does. Cite the median and the shape ("half
the section under 20 minutes"), never an individual's time — Q1 is anonymous to instructors by
design. Correlate it with effort or understanding only if the data actually shows a relationship;
do not assert the obvious story if the numbers are flat. `not_stated` counts students who answered
Q1 without naming a duration; only written-path students can appear there, since the interactive
path never asks the question.

### misconception_trends — every scope
Cluster the free-text `misconceptions[].description`/`evidence`: which recur, fold novel/variant
ones into known buckets (taxonomy ids in `.ai/instructions/PROJECT.md` / the contract), note section concentration and
which look like genuine class-wide gaps vs. one-off slips. This prose sits **under** the live
prevalence bars — don't restate the bars, add the *why/pattern*. For `__all__`, note cross-section
spread (a misconception in every section vs. isolated to one).

**On a mixed cohort, say whether a misconception is path-specific.** Both paths now emit
`misconceptions[]` against the same taxonomy, so they aggregate together — but a misconception
that appears only among question-set takers, or only in artifact transcripts, is a finding in
itself (it may reflect what each path surfaces rather than what students believe). Check the
`path` on the report rows before claiming a pattern is class-wide. The written path's entries
come from `/preflight-analyze`'s reading of the answers; the interactive path's from the
transcript, which sees reasoning the written answers never show.

### selected_quotes — per-section scopes ONLY (2-3 each)
Pick the **2-3 most interesting reading-reflection comments** for that section, as
`[{student_id, section_id}]` (the rollup resolves the verbatim text + name live). Selection
criteria:
- **Meaningful** (`reflection.meaningful` not false) and genuinely engaged with the reading.
- **Either path is eligible.** The reading reflection is the *same question* in both modalities
  (LESSON-UNIFICATION.md §11), which is exactly what makes the quotes comparable. An interactive
  student's text arrives in the schema:1 payload; a written student's is lifted from their stored
  answer. Both appear as `reflection.text` — do not favour one path, and if a section is mixed,
  prefer a set that is not all from one path.
- **Representative of a common theme** OR **genuinely illuminating** — a real connection across
  topics, a sharp question, a vivid articulation an instructor could read aloud to spark discussion.
- **Diverse** — don't pick 2-3 that all say the same thing.
- **Nothing that singles a student out negatively** or exposes sensitive personal detail.

**The `__all__` (whole-course) scope carries NO quotes** — set `selected_quotes: []`. Quotes are a
per-section teaching tool shown only on a single-section view; the "All sections" view shows the
two prose panels only. (The writer rejects quotes on the `__all__` scope, and rejects any
per-section quote whose student isn't actually in that section — so an instructor can never be
shown a cross-section quote.)

Write the array to a scratch file (e.g. `<scratch>/filled.json`).

## Step 4 — Write back

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/lesson_aggregate.py write-analysis --in <scratch>/filled.json
```
The writer merges your scopes into the offering's `analysis_reports` row (analysis is
regeneratable; scopes you didn't send are preserved), **re-derives each scope's `meta.n` +
`meta.source_fingerprint` from the live rows** (so they can't drift), stamps
`meta.generated_by = "lesson-aggregate@<date>"`, resolves section codes to ids, validates
quote membership, and enforces "no quotes on `__all__`". `--dry-run` first, then commit.

## Step 5 — Verify

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py status --activity <slug>
```
Lists the scopes just written with `n`, quote count, and a `STALE` flag (stored vs. recomputed
fingerprint — should be blank right after a run). Spot-check one section's prose against a couple
of that section's reports.

> **The faculty rollup DOES display this (since 2026-07-21).** `site/app/faculty/report.html`
> renders the readiness summary, the misconception-trend prose, and the per-section showcase
> quotes; `loadAnalysis()` in `site/app/js/faculty-rollup.js` selects the scope. `status` remains
> the fastest verification surface, but it is no longer the only one.
>
> **It was silently broken until then, and the failure mode is worth knowing.** `loadAnalysis()`
> read `payload.by_section`; this script writes `payload.scopes`. Nothing errored — every panel
> just resolved to `null` and the page fell back to its "coming soon" placeholders, so a
> successful run with a clean `status` still displayed nothing. If a panel is empty after a run,
> check that producer and consumer agree on the payload key before re-running anything.

---

## Deferred — the rest of the UI wiring

Most of this landed 2026-07-21. **What is still NOT implemented:**

- **An instructor's "All sections" must never read the `__all__` scope** — it should be the live
  union of *their own* sections' scopes. `currentAnalysis()` in `report.html` currently returns
  `__all__` for any viewer whose scope is "all", so an instructor sees the whole-course synthesis.
  This is a UI rule, not a database one (see the RLS caveat below), so nothing else enforces it.
- **`/preflight-analyze`'s `by_question` breakdown is still keyed per instructor**
  (`audience_id` = the instructor, `payload.sections` naming their sections), and the rollup
  renders every block it receives with an "instructor · sections" header, ignoring the section
  selector. **Decided 2026-07-21, not yet built:** that skill should mirror this one —
  `audience_id = NULL` and a `payload.scopes` map keyed by section uuid plus `__all__`, each scope
  carrying its own `items{q1…}` — so one payload convention serves both producers and the rollup
  can show a course-level view and a per-section view with no instructor axis at all. It requires
  a `/preflight-analyze` contract change **and** a re-run over the offering: today's bullets are
  computed per instructor over all of their sections at once (e.g. one row covering M1A **and**
  M3A), so there is no per-section decomposition stored to split.

The rules below still govern anything further:

- **Readiness summary / misconception trends:** load this offering's row and pick the scope. For a
  director's "All sections" view, use `payload.scopes["__all__"]`; for a single section, that
  section's uuid key. For an **instructor**, "All sections" is the live union of *their* sections'
  scopes — **never read the `__all__` scope** for them.
- **Quotes — single-section scope only.** Render the AI-picked quotes **only** on a single-section
  view (feed `selected_quotes` into `responsesSection`'s reserved `ai:[]` slot, resolving text +
  name from the already-loaded content + roster). The "All sections" view shows **no quote panel**.
- **RLS caveat worth knowing.** `analysis_reports` RLS lets any staff member of the offering read
  every `scope='assignment_offering'` row, so the "instructors never see `__all__`" rule is a UI
  convention here, not a database boundary. Enforce it in the renderer.

---

## Running at scale / as a scheduled job

This skill is intended to run **unattended as a midnight cron** after a lesson's due date, scoped to
one course and **one day track at a time** (an M-day run *or* a T-day run — never both), so it never
contends with interactive use. Two design rules follow:

- **Process sections sequentially, one scope per step — do NOT fan out subagents.** The `pull` output
  already carries a self-contained scope per section, so a plain loop (read one scope → write its two
  prose fields + quotes → next) keeps each step's context small and **scales to any section count**
  (some courses have 20+ sections). Parallel subagents only buy wall-clock speed, which a midnight cron
  doesn't need — they cost more and bump the concurrency cap.
- **Day-split runs and the `__all__` scope.** Per-section scopes are independent and the writer
  merges, so an M-run and a T-run never collide on them. The whole-course `__all__` scope, though, is
  recomputed over **whatever work exists at run time** (the writer re-derives `n` +
  `source_fingerprint` from the live rows). If M and T have separate due dates, the earlier run's
  `__all__` describes only that day until the later run overwrites it with the full course. The later
  (final) run leaves `__all__` correct.

**Health check.** `status` recomputes each scope's fingerprint from the current rows and flags
`STALE` when they've changed since the analysis was written — a good post-cron assertion, and the
signal to re-run a scope whose work was resubmitted after aggregation.

---

## Rules

1. **Grades are off-limits.** This skill writes **only** `analysis_reports`. Never write
   `grades.effort`, `grades.points_earned`, or `submission_activities.content` — those belong to
   `/interaction-backfill` and the receiver.
2. **Fidelity over invention.** Derive prose and quotes from what the reports actually say. Ground
   figures in the precomputed `numbers`; don't fabricate misconceptions, trends, or quotes.
3. **Numbers stay consistent with the UI.** Cite the `numbers` block verbatim; don't recompute,
   so the prose always agrees with the live bars.
4. **Per-section quotes from that section only; `__all__` gets none.** Enforced by the writer, but
   produce them correctly so it never trips.
5. **Mark provenance.** The writer stamps `meta.generated_by = "lesson-aggregate@<date>"`.
6. **Merge, never replace wholesale.** Send only the scopes you actually rewrote; the writer keeps
   the others. Do not hand-assemble a payload and PATCH it directly.
7. **Keep student-identifying scratch files out of the repo** — reflection text and names go to the
   **scratchpad**, never under the repo tree.
8. **No DDL — ever.** If `analysis_reports` is missing, hand the migration to the director.
