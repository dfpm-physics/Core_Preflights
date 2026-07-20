---
name: interaction-aggregate
description: >
  Cohort/section AGGREGATION tool for lesson interactions. Reads the per-student structured
  data across an interactive activity and writes the class-level AI synthesis the faculty
  rollup shows as "coming soon" placeholders: a readiness summary, misconception trends, and
  2-3 AI-picked reading-reflection quotes — one scope per section PLUS a whole-course scope.
  Use when a director wants the lesson rollup's AI panels filled — i.e. "aggregate the
  interaction", "summarize the lesson rollup", "generate the readiness summary / misconception
  trends / showcase quotes for a lesson", or /interaction-aggregate. Writes to the
  app.analysis_reports table. NOT /interaction-backfill, which fills per-student structured
  content — that must already be populated (this consumes it). Run AFTER the due date (when
  submissions are frozen) by a Course Director / System Admin on a machine with the scoped
  prep_app_dml DB role.
---

# Interaction Aggregate — cohort/section analysis for the lesson rollup

> **Scope / what this is.** This is the **cohort AGGREGATION** skill the
> [`INTERACTION-AGGREGATION.md`](../../../docs/decisions/INTERACTION-AGGREGATION.md) spec describes. It turns many
> per-student structured blobs into the **class-level free-text synthesis** the faculty lesson
> rollup can't compute from numbers alone:
> 1. **Readiness summary** — how ready the class is, where understanding is solid vs. shaky, what to cover first.
> 2. **Misconception trends** — prose under the live prevalence bars (clustering, spreading/fading, by section).
> 3. **Showcase quotes** — 2-3 of the most interesting reading-reflection comments, per section.
>
> It does **not** touch grades and does **not** recompute the numeric charts — those stay live in
> the browser. It only writes the AI layer to `app.analysis_reports`. Keep it distinct from
> `/interaction-backfill` (per-student structured-data repair, which must run first).

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
| the lesson | `interactions` (own table) | `activities` where `modality = 'interactive'`; `activities.slug` is the old `interactions.id` verbatim |
| which term it runs in | — | `offering_activities` → `assignment_offerings` → `course_offerings` |
| the per-student data | `preflight_interaction_reports.report_data` | `submission_activities.content`, via `submissions` |
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

## Step 1 — Pick the activity & confirm data is ready

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Pick the interactive activity slug to aggregate. If its `missing` count is > 0, run
`/interaction-backfill` for it first.

## Step 2 — Pull the cohort

```
.venv/Scripts/python supabase/admin/interaction_aggregate.py pull \
  --activity <slug> --out <scratch>/agg.json
```
Writes one JSON file with a scope per section **plus** a whole-course `__all__` scope. Each scope
carries a **precomputed `numbers` summary** (effort/understanding/objective/misconception/
reflection/flag aggregates — the same figures the UI bars show, now scaled by the offering's
`points_possible` rather than a hardcoded 0–2) and, for per-section scopes, a `reports` array of
the free-text fields (reflection text, misconception descriptions/evidence, objectives,
narratives). The `__all__` scope is **numbers only**. **Read that file.** Use the **session
scratchpad** for it — it contains reflection text and must not land in the repo.

`pull` refuses to guess if the activity is scheduled in more than one *active* offering (i.e. it is
being re-run in a new term while the old one is still active) — deactivate the stale
`course_offering` first.

(`--interaction` is still accepted as an alias for `--activity`.)

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

### misconception_trends — every scope
Cluster the free-text `misconceptions[].description`/`evidence`: which recur, fold novel/variant
ones into known buckets (taxonomy ids in `.ai/instructions/PROJECT.md` / the contract), note section concentration and
which look like genuine class-wide gaps vs. one-off slips. This prose sits **under** the live
prevalence bars — don't restate the bars, add the *why/pattern*. For `__all__`, note cross-section
spread (a misconception in every section vs. isolated to one).

### selected_quotes — per-section scopes ONLY (2-3 each)
Pick the **2-3 most interesting reading-reflection comments** for that section, as
`[{student_id, section_id}]` (the rollup resolves the verbatim text + name live). Selection
criteria:
- **Meaningful** (`reflection.meaningful` not false) and genuinely engaged with the reading.
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
.venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json
```
The writer merges your scopes into the offering's `analysis_reports` row (analysis is
regeneratable; scopes you didn't send are preserved), **re-derives each scope's `meta.n` +
`meta.source_fingerprint` from the live rows** (so they can't drift), stamps
`meta.generated_by = "interaction-aggregate@<date>"`, resolves section codes to ids, validates
quote membership, and enforces "no quotes on `__all__`". `--dry-run` first, then commit.

## Step 5 — Verify

```
.venv/Scripts/python supabase/admin/interaction_aggregate.py status --activity <slug>
```
Lists the scopes just written with `n`, quote count, and a `STALE` flag (stored vs. recomputed
fingerprint — should be blank right after a run). Spot-check one section's prose against a couple
of that section's reports.

> **The faculty rollup does NOT display this yet.** `site/app/js/faculty-data.js` already *loads*
> the rows (`loadAnalysisReports()` filters `scope='assignment_offering'` on the offering id), but
> nothing renders them yet — that wiring is a **separate, deferred task** (see below). `status` is
> the verification surface for now.

---

## Deferred — UI wiring (not part of this skill)

When the rollup is wired to consume `analysis_reports` (additive, graceful-degradation —
no row → today's placeholders), honor these rules so the teaching UX stays right:

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
5. **Mark provenance.** The writer stamps `meta.generated_by = "interaction-aggregate@<date>"`.
6. **Merge, never replace wholesale.** Send only the scopes you actually rewrote; the writer keeps
   the others. Do not hand-assemble a payload and PATCH it directly.
7. **Keep student-identifying scratch files out of the repo** — reflection text and names go to the
   **scratchpad**, never under the repo tree.
8. **No DDL — ever.** If `analysis_reports` is missing, hand the migration to the director.
