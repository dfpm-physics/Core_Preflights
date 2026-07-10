---
name: interaction-aggregate
description: >
  Cohort/section AGGREGATION tool for lesson interactions. Reads the per-student structured
  data (report_data) across an interaction and writes the class-level AI synthesis the faculty
  rollup shows as "coming soon" placeholders: a readiness summary, misconception trends, and
  2-3 AI-picked reading-reflection quotes — one rollup per section PLUS a whole-course rollup.
  Use when a director wants the lesson rollup's AI panels filled — i.e. "aggregate the
  interaction", "summarize the lesson rollup", "generate the readiness summary / misconception
  trends / showcase quotes for a lesson", or /interaction-aggregate. Writes to the
  interaction_analysis table (migration 014). NOT /interaction-backfill, which fills per-student
  report_data — that must already be populated (this consumes it). Run AFTER the due date (when
  submissions are frozen) by a Course Director / System Admin on a machine with the scoped
  claude_code_recker DB role.
---

# Interaction Aggregate — cohort/section analysis for the lesson rollup

> **Scope / what this is.** This is the **cohort AGGREGATION** skill the
> [`INTERACTION-AGGREGATION.md`](../../../INTERACTION-AGGREGATION.md) spec describes and that
> `/interaction-backfill` calls "a separate, future skill." It turns many per-student
> `report_data` blobs into the **class-level free-text synthesis** the faculty lesson rollup
> can't compute from numbers alone:
> 1. **Readiness summary** — how ready the class is, where understanding is solid vs. shaky, what to cover first.
> 2. **Misconception trends** — prose under the live prevalence bars (clustering, spreading/fading, by section).
> 3. **Showcase quotes** — 2-3 of the most interesting reading-reflection comments, per section.
>
> It does **not** touch grades and does **not** recompute the numeric charts — those stay live in
> the browser. It only writes the AI layer to `interaction_analysis`. Keep it distinct from
> `/interaction-backfill` (per-student `report_data` repair, which must run first).

**Canonical specs:** [`INTERACTION-AGGREGATION.md`](../../../INTERACTION-AGGREGATION.md) (the design),
[`INTERACTION-DATA-CONTRACT.md`](../../../INTERACTION-DATA-CONTRACT.md) (the inputs, schema 1).
**DB access + operating rules:** [`supabase/admin/AGENT-DB-ACCESS.md`](../../../supabase/admin/AGENT-DB-ACCESS.md).

Run by a **Course Director / System Admin** with the scoped `claude_code_recker` role and the
project venv. Run it **after the due date**, when submissions are frozen — the analysis is a
point-in-time read of the cohort.

---

## Prerequisites

1. **Migration `014_interaction_analysis.sql` is applied.** It creates the `interaction_analysis`
   table this skill writes. You (Codex) have **no DDL rights** — if `pull`/`status` errors with
   `relation "interaction_analysis" does not exist`, hand the migration to the director to run in
   the Supabase SQL Editor, then continue.
2. **`report_data` is populated.** This skill aggregates the structured per-student data. If a
   lesson's reports are missing it, run **`/interaction-backfill`** first (`pull` warns and prints
   the missing count). Missing rows skew counts and are excluded from means.

## Step 0 — Preflight

```
.venv/Scripts/python supabase/admin/db_check.py
```
Confirms it connects as `claude_code_recker`, reads, and reports DDL as DENIED. If it can't
connect, the credential (`supabase/admin/config.json`) is missing or the direct host was used
instead of the **Session pooler** — see `supabase/admin/AGENT-DB-ACCESS.md`.

## Step 1 — Pick the interaction & confirm data is ready

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Pick the real interaction slug to aggregate (ignore `demo-rollup-sandbox`). If its `missing`
count is > 0, run `/interaction-backfill` for it first.

## Step 2 — Pull the cohort

```
.venv/Scripts/python supabase/admin/interaction_aggregate.py pull \
  --interaction <slug> --out <scratch>/agg.json
```
Writes one JSON file with a scope per section **plus** a whole-course `__all__` scope. Each scope
carries a **precomputed `numbers` summary** (effort/understanding/objective/misconception/
reflection/flag aggregates — the same figures the UI bars show) and, for per-section scopes, a
`reports` array of the free-text fields (reflection text, misconception descriptions/evidence,
objectives, narratives). The `__all__` scope is **numbers only**. **Read that file.** Use the
**session scratchpad** for it — it contains reflection text and must not land in the repo.

## Step 3 — Write the analysis (per scope)

Produce a JSON array of `{interaction_id, section_id, readiness_summary, misconception_trends,
selected_quotes}` — one entry per scope in the pull file (each section + `__all__`).

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
ones into known buckets (taxonomy ids in AGENTS.md / the contract), note section concentration and
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

**The `__all__` (whole-course) row carries NO quotes** — set `selected_quotes: []`. Quotes are a
per-section teaching tool shown only on a single-section view; the "All sections" view shows the
two prose panels only. (The writer and a DB CHECK both reject quotes on the `__all__` row, and
reject any per-section quote whose student isn't actually in that section — so an instructor can
never be shown a cross-section quote.)

Write the array to a scratch file (e.g. `<scratch>/filled.json`).

## Step 4 — Write back

```
.venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json
```
The writer upserts one `interaction_analysis` row per scope (overwriting any prior run — analysis
is regeneratable), **re-derives `meta.n` + `meta.source_fingerprint` from the live rows** (so they
can't drift), stamps `meta.generated_by = "interaction-aggregate@<date>"`, validates section ids
and quote membership, and enforces "no quotes on `__all__`". `--dry-run` first, then commit.

## Step 5 — Verify

```
.venv/Scripts/python supabase/admin/interaction_aggregate.py status --interaction <slug>
```
Lists the rows just written with `n`, quote count, and a `STALE` flag (stored vs. recomputed
fingerprint — should be blank right after a run). Spot-check one section's prose against a couple
of that section's reports.

> **The faculty rollup does NOT display this yet.** Wiring `app/faculty/interactions.html` to read
> `interaction_analysis` is a **separate, deferred task** (see below) — so don't expect the rollup
> panels to change after this run. `status` is the verification surface for now.

---

## Deferred — UI wiring (not part of this skill)

When the rollup is wired to consume `interaction_analysis` (additive, graceful-degradation —
no row → today's placeholders), honor these rules so the teaching UX stays right:

- **Readiness summary / misconception trends:** load the chosen scope's row and replace the two
  `aiPlaceholder()` blocks. For a director's "All sections" view, use the `__all__` row; for a
  single section, that section's row. For an **instructor**, "All sections" is the live union of
  *their* per-section rows — **never read the `__all__` row** for them.
- **Quotes — single-section scope only.** Render the AI-picked quotes **only** on a single-section
  view (feed `selected_quotes` into `responsesSection`'s reserved `ai:[]` slot, resolving text +
  name from the already-loaded `report_data` + roster). The "All sections" view shows **no quote
  panel**. Because each instructor only reads their own per-section rows, their quote pool is
  naturally scoped to their sections — they can never highlight a cross-section quote.

---

## Running at scale / as a scheduled job

This skill is intended to run **unattended as a midnight cron** after a lesson's due date, scoped to
one course and **one day track at a time** (an M-day run *or* a T-day run — never both), so it never
contends with interactive use. Two design rules follow:

- **Process sections sequentially, one scope per step — do NOT fan out subagents.** The `pull` output
  already carries a self-contained scope per section, so a plain loop (read one scope → write its two
  prose fields + quotes → next) keeps each step's context small and **scales to any section count**
  (some courses have 20+ sections). Parallel subagents only buy wall-clock speed, which a midnight cron
  doesn't need — they cost more and bump the concurrency cap. Reserve fan-out for an *interactive*
  "do it now" pass over a large backlog (e.g. seeding the demo sandbox's 206 reports), not the cron.
- **Day-split runs and the `__all__` row.** Per-section rows are independent, so an M-run and a T-run
  never collide on them. The whole-course `__all__` row, though, is recomputed over **whatever reports
  exist at run time** (the writer re-derives `n` + `source_fingerprint` from the live rows). If M and T
  have separate due dates, the earlier run's `__all__` describes only that day until the later run
  overwrites it with the full course — the same point-in-time merge `assignments.analysis_report` uses.
  The later (final) run leaves `__all__` correct.

**Health check.** `status` recomputes each scope's fingerprint from the current reports and flags
`STALE` when they've changed since the analysis was written — a good post-cron assertion, and the
signal to re-run a scope whose reports were resubmitted after aggregation.

---

## Rules

1. **Grades are off-limits.** This skill writes **only** `interaction_analysis`. Never write
   `effort`, `score`, or `report_data` — those belong to `/interaction-backfill` and the receiver.
2. **Fidelity over invention.** Derive prose and quotes from what the reports actually say. Ground
   figures in the precomputed `numbers`; don't fabricate misconceptions, trends, or quotes.
3. **Numbers stay consistent with the UI.** Cite the `numbers` block verbatim; don't recompute,
   so the prose always agrees with the live bars.
4. **Per-section quotes from that section only; `__all__` gets none.** Enforced by the writer + DB,
   but produce them correctly so it never trips.
5. **Mark provenance.** The writer stamps `meta.generated_by = "interaction-aggregate@<date>"`.
6. **Keep student-identifying scratch files out of the repo** — reflection text and names go to the
   **scratchpad**, never under the repo tree.
7. **No DDL — ever.** If `interaction_analysis` is missing, hand migration `014` to the director;
   don't try to create it. See `supabase/admin/AGENT-DB-ACCESS.md` for the full ruleset.
