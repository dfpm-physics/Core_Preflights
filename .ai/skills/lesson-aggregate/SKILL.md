---
name: lesson-aggregate
description: >
  Cohort/section AGGREGATION tool for a LESSON, whichever way students worked it — the interactive
  artifact, the written question set, or a mix. Reads the per-student schema:1 assessment plus the
  graded question answers across the cohort and writes every class-level AI panel the faculty
  rollup shows: a readiness summary (including the common threads across Q2/Q3), misconception
  trends, a one-line teaching recommendation, and 3 AI-picked reading-reflection quotes — one
  scope per section PLUS a whole-course scope, with the course scope synthesized FROM the section
  scopes. Supports day-scoped runs (--day M / --day T) so a lesson with split deadlines is
  aggregated once per day track without re-reading the first day's cohort.
  Use when a director wants the lesson rollup's AI panels filled — i.e. "aggregate the lesson",
  "summarize the lesson rollup", "generate the readiness summary / misconception
  trends / showcase quotes for a lesson", or /lesson-aggregate. Writes to the
  app.analysis_reports table. NOT /interaction-backfill and NOT /preflight-analyze, which produce
  the per-student structured content — that must already be populated (this consumes it).
  /lesson-cycle runs that grading step and this one back to back. Run AFTER the deadline (when
  submissions are frozen) by a Course Director / System Admin on a machine with the scoped
  prep_app_dml DB role.
---

# Lesson Aggregate — cohort/section analysis for the lesson rollup

> **Scope / what this is.** This is the **cohort AGGREGATION** skill the
> [`INTERACTION-AGGREGATION.md`](../../../docs/decisions/INTERACTION-AGGREGATION.md) spec describes. It turns many
> per-student structured blobs into the **class-level free-text synthesis** the faculty lesson
> rollup can't compute from numbers alone:
> 1. **Readiness summary** — how ready the class is, where understanding is solid vs. shaky, what
>    to cover first, and (written path) the common threads across the reading reflection and the
>    graded concept question.
> 2. **Misconception trends** — prose under the live prevalence bars, written for the scope the
>    viewer selected: "across the course" or "in M1A".
> 3. **Misconception recommendation** — one teaching action, rendered as its own line beneath the
>    trends prose so it is not buried in the paragraph.
> 4. **Showcase quotes** — the 3 most interesting reading-reflection comments, per section.
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

**The unit that must never be split is the SECTION, not the course.** A readiness summary written
over half a *section* describes a class that does not exist. A run scoped to one day track does
not do that: it aggregates whole sections, and carries the other day's already-written sections in
as `prior_scopes`. That is what `--day` is for, and it is how the lesson is normally worked — once
when M-day closes, once when T-day closes.

The whole-course scope is the one thing that genuinely needs every section, so `pull` computes
`coverage` and tells you whether `__all__` may be written this run. **Never write `__all__` when
`coverage.complete` is false.**

Keep this distinct from `/preflight-analyze` (per-student grading + assessment) and
`/interaction-backfill` (repair of interactive assessments), both of which must run first.
`/lesson-cycle` sequences the grading and this skill for you; run this one directly when you only
need to re-aggregate.

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
  --lesson <slug> [--day M] --out <scratch>/agg.json
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

### Reading a day-scoped pull file

With `--day`, the file has three parts instead of one:

| key | what it is | what you do with it |
|---|---|---|
| `scopes[]` (`in_day: true`) | this day's sections, with full `numbers` **and** `reports[]` | write their prose and pick their quotes |
| `prior_scopes[]` | the other day's sections: their **already-written prose**, fresh `numbers`, and **no `reports[]`** | read them as source material for `__all__`. **Do not rewrite them, and never pick quotes for them** — you do not hold their reports, so any `student_id` you supply will be rejected |
| `coverage` | `this_run`, `from_stored`, `uncovered`, `stale_prior`, `complete` | decides whether you may write `__all__` at all |

`prior_scopes[].stale: true` means that section's work changed after its prose was written — a
late submission or a regrade. Re-run **that day** before folding it into the course scope, or the
whole-course synthesis quotes a section that no longer matches its own numbers.

`coverage.uncovered` lists sections that have **never** been aggregated. While that list is
non-empty, `__all__` is not writable: `pull` sets `scopes.__all__.write` to `false` and says so.

## Step 3 — Write the analysis (per scope)

**There are three kinds of scope, and they carry different fields.** This split landed 2026-07-22;
writing the wrong field on the wrong scope is now a validation error, not a silent no-op.

| `section_id` value | Scope | Carries |
|---|---|---|
| a section uuid, or its code (`"M1A"`) | one section | `misconception_recommendation`, `selected_quotes` |
| `"instr:<instructor_uuid>"` | one instructor, across every section they teach | `readiness_summary`, `section_notes[]` |
| `"__all__"` | the whole course | `readiness_summary`, `misconception_recommendation` |

Produce a JSON array with one entry per **in-day** section scope, one per **instructor** who
teaches an in-day section, plus `__all__` when `coverage.complete` is true. Optionally carry `day`
(and, on `__all__`, `coverage`) so the stored scope records which run wrote it.

The instructors and their sections are in the pull file's `instructors[]` block:
`{instructor_id, instructor_name, section_ids, section_codes, section_ids_in_day}`. Write an
instructor scope only when `section_ids_in_day` is non-empty — an instructor whose sections all
belong to the other day track is that run's business, and the writer merges the two.

**Do not send an entry for a `prior_scopes[]` section.** Those are already written; re-sending
them costs a rewrite you did not intend and, if you invent quotes for them, fails validation.

**Why the readiness summary is per instructor, not per section.** Two sections of one lesson taught
by one person used to get two isolated paragraphs, each written as though the other did not exist —
so nothing said whether a gap was that instructor's cohort or that one section. One summary across
their sections, with departures named per section, answers that in less space. A single-section
view borrows its instructor's summary and keeps its own numbers, quotes and recommendation.

**Ground the prose in the precomputed `numbers`; do not recompute them.** Cite the figures already
in the file (e.g. "8/14 showed force-superposition", "avg effort 3.4/5") so the narrative agrees
with the live bars. Markdown-light (it's rendered with the existing sanitizer).

**Every prose field is short now, and the caps are enforced by the writer:**

| Field | Cap | Shape |
|---|---|---|
| `readiness_summary` | **1200** | 2–3 sentences |
| `section_notes[].note` | **400** each, ≤ 12 notes | one sentence |
| `misconception_recommendation` | **1200** | one imperative sentence, single paragraph |

The old 8000-char allowance produced multi-paragraph panels that read as machine-written and buried
the one instruction a reader needed. Length is the main tell; brevity is the fix, and it is enforced
rather than requested.

### readiness_summary — INSTRUCTOR scopes and `__all__` only · **HARD CAP 1200 chars**

**Two to three sentences. Not a paragraph, not bullets, not an essay.** The writer rejects anything
over 1200 characters, and that ceiling is a backstop, not a target — aim for well under it.

What a faculty member opening the rollup before class actually needs: **what the class can do, what
it can't, and what to cover first.** Nothing else. The numbers are already on the page in charts
directly above this text; your job is the read, not the recitation.

**Write like a colleague leaving a note, not like an AI writing a summary.** Specific bans, because
these are the tells:

- No `Overall,` / `In summary,` / `It's worth noting that` / `Notably,` openers.
- No three-item parallel lists ("engagement was strong, understanding was mixed, and flags were
  low"). Pick the one that matters.
- No restating the question back ("This section's readiness for the lesson on polarizers…").
- No hedging stacks ("appears to suggest that some students may possibly…"). Say it or don't.
- Do not narrate what you are about to say. Say it.
- Name the physics. "Shaky on superposition" beats "gaps in conceptual understanding."

Lean on the weakest objectives, the self-vs-assessed gap, and `numbers.reading` where it exists.
Mention a flag count (reflection-capped, honor, needs-follow-up) only when it is actionable.

**Falsification:** if a reader could not act differently on Monday having read it, it is too vague;
if they must read twice to find the instruction, it is too long.

**For `__all__`, synthesize from PROSE, cite from `numbers`.** Write it from the section summaries
you just wrote plus every `prior_scopes[].readiness_summary` — on a day-scoped run you have not
read the other day's reports, so any claim about those students must come from their stored prose,
never from your own reading. Every figure you quote comes from `scopes.__all__.numbers`, which is
computed over the whole cohort. **Never add section numbers together to get a course number:**
counts would sum, but medians and means do not, and the browser recomputes those same figures from
raw rows for its All-sections bars.

**Use `numbers.reading` where it exists** — the class's self-reported time on the reading (Q1),
as a **median** and five buckets. It is often the most actionable number on the page: a median
that collapses, or a bimodal split where half the class is under 15 minutes, changes what is worth
covering in class more than any single objective score does. Cite the median and the shape ("half
the section under 20 minutes"), never an individual's time — Q1 is anonymous to instructors by
design. Correlate it with effort or understanding only if the data actually shows a relationship;
do not assert the obvious story if the numbers are flat. `not_stated` counts students who answered
Q1 without naming a duration; only written-path students can appear there, since the interactive
path never asks the question.

#### Common threads across the graded questions — WRITTEN PATH ONLY

**Skip this entire subsection when the pull file's `questions` block is empty**, and skip it for
any scope whose `numbers.paths.written_n` is 0. An interactive-only cohort has no question set,
and nothing here applies to it.

This is the material `/preflight-analyze` used to write as a separate per-instructor "By question"
panel. That panel is gone: Q1 has its own reading-time panel on the page, and Q2/Q3 belong in the
prose that reads them. Fold them into the readiness summary instead.

- **Q2 (the reading reflection)** — what students actually engaged with. `reflection.text` on each
  report row, plus `numbers.reflection` for the meaningful/capped counts. Name the recurring
  threads ("Coulomb's inverse-square law, charging by friction, conservation of charge"), not a
  list of individual answers.
- **The graded concept question(s)** — each report row's `responses[]` carries the verbatim
  `answer` with the `status` it earned, and the top-level `questions` block carries the prompt and
  its `expected_response`. Use the expected response as the physics source of truth: describe the
  gap between it and what the cohort wrote, not merely what the cohort got wrong.
- **Cite `numbers.questions[qid]`** for the outcome split — `full` / `warn` / `zero` / `ungraded`.
  Write "23/32 earned full credit on Q3" from that block; do not count report rows by hand, which
  goes wrong above about twenty students and puts a number in the prose that agrees with nothing.
- **`status` is not understanding.** A `warn` answer earned full credit and was still flagged as
  wrong or vague, and a student can sit on `free_response_understanding: 1` with a `warn`. That
  gap is often the finding. Never present either as the other.

Close with the one thing worth doing about it in class — that is the "what to cover first" the
panel is read for.

### section_notes — INSTRUCTOR scopes only

Where one of that instructor's sections **departs** from the summary above. A list of
`{section_id, note}`, at most one per section, each ≤ 400 chars, rendered under the summary with the
section code in bold.

**Only write a note when there is a real difference worth acting on** — a misconception concentrated
in one section, a markedly weaker objective, a reading-time collapse in one cohort and not the
other. An instructor whose sections look alike gets **no notes at all**, and that is the correct and
common outcome. A note per section restating the summary is noise, and it is exactly what the
per-section summaries used to produce.

Omit the field, or send `[]`, when nothing departs. `section_id` accepts a uuid or a code.

### ~~misconception_trends~~ — RETIRED 2026-07-22. Do not write it.

The prevalence bars now carry each misconception's own `description` and a couple of verbatim
student `evidence` quotes, surfaced in a popover — so the reader can see what a misconception *is*
and what students actually wrote, which is what this paragraph existed to tell them. Restating the
bars in prose beside the bars added nothing and cost a full AI panel.

**The clustering work did not go away — it became data.** See `misconception_aliases` below.

The field is still accepted by the writer so a replayed file does not fail, and historical rows keep
it. Nothing renders it. Do not spend tokens on it.

### misconception_aliases — offering-level, sent ONCE per run

**This is where the clustering you used to describe in prose now goes.**

`/preflight-analyze` and the artifact both may coin a misconception id when nothing in the taxonomy
fits (contract §5.4). Both counting sites key on the id, so a coined variant becomes its own bar and
the same misunderstanding shows up two or three times at a third of its real prevalence. You were
already told to "fold novel ones into known buckets" — but there was nowhere to put the fold, so it
was written as English and thrown away, and the bars it sat under never changed.

Send a flat map of **variant id → canonical id** on any one item in the array (it is offering-level,
not per scope; the writer merges it across runs):

```json
"misconception_aliases": { "adds-magnitudes": "scalar-sum", "forces-cancel-out": "forces-cancel" }
```

Rules:

- **Read `numbers.misconceptions[]`**, which now carries each id's `label`, `description`, `examples`
  (verbatim student evidence) and `count`. That is enough to tell a genuine duplicate from two
  different errors that sound alike.
- **Fold onto a taxonomy id where one exists** (`.ai/instructions/PROJECT.md` § Known Misconception
  Patterns, then the generic table in `/preflight-analyze`'s SKILL.md). Folding a taxonomy id onto a
  coined one is backwards.
- **Only fold what is genuinely the same misunderstanding.** Two errors that co-occur are not one
  error. When unsure, leave them apart — a split bar is recoverable, a wrong merge hides a finding.
- Casing and whitespace are already normalized on both sides; you never need an alias for
  `Scalar-Sum` → `scalar-sum`.
- Never map an id to itself or to an empty string. Both are dropped.

### misconception_glossary — offering-level, optional

`{ "<canonical-id>": {"label": "…", "description": "…"} }`. Only needed for an id whose producers
left `description` empty — the browser prefers the per-student description and falls back to this.
One clear sentence explaining what the student believes that is wrong. Skip ids that already explain
themselves.

**Do not fold a path-specific misconception into a general one.** Both paths emit
`misconceptions[]` against the same taxonomy, so they aggregate together — but one that appears
only among question-set takers, or only in artifact transcripts, may reflect what each path
*surfaces* rather than what students believe. Check the `path` on the report rows before merging.
The written path's entries come from `/preflight-analyze`'s reading of the answers; the interactive
path's from the transcript, which sees reasoning the written answers never show. If the split looks
real, say so in the recommendation rather than hiding it behind an alias.

### misconception_recommendation — section scopes and `__all__` (one line)

**One imperative sentence.** ≤ 1200 chars, **a single paragraph with no blank lines** (the writer
rejects them — it renders as one line beneath the bars). Now that the trends paragraph is gone,
this is the *only* prose in the Misconceptions panel, so it carries the whole "so what do I do
Monday?" load.

Write the action, not the analysis. **"Re-derive the two-charge superposition on the board before
the lab"** — not "Students would benefit from additional practice with superposition concepts."
Name the physics and name the move. Nothing above it will explain it for you.

Applies to **every** lesson type, interactive included — it is a teaching action, not a question
artifact. It is also the one field allowed on `__all__`, where quotes are forbidden: a
whole-course "what to cover" is exactly where it matters.

### selected_quotes — per-section scopes ONLY (exactly 3 each)
Pick the **3 most interesting reading-reflection comments** for that section, as
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
- **Diverse** — don't pick 3 that all say the same thing.

**Emit exactly 3** where the section has 3 qualifying reflections. The rollup renders these
alongside a **fixed 5-card random sample** (not a remainder — see `report.html` `responsesSection`),
so emitting fewer shrinks the showcase without widening anything else. Fewer than 3 is correct only
when the section genuinely has fewer qualifying reflections; never pad with a weak pick to reach 3.
- **Nothing that singles a student out negatively** or exposes sensitive personal detail.

**The `__all__` (whole-course) scope carries NO quotes** — set `selected_quotes: []`. Quotes are a
per-section teaching tool shown only on a single-section view; the "All sections" view shows the
two prose panels only. (The writer rejects quotes on the `__all__` scope, and rejects any
per-section quote whose student isn't actually in that section — so an instructor can never be
shown a cross-section quote.)

**Never pick quotes for a `prior_scopes[]` section.** A day-scoped pull gives you their prose but
not their `reports[]`, so you have no student to name and the writer will reject whatever you
guess. Their quotes were chosen on the run that wrote them and are still stored.

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
quote membership, enforces "no quotes on `__all__`", and caps
`misconception_recommendation` to one short paragraph. `--dry-run` first, then commit.

`--day` on `write-analysis` is **audit provenance only** — it records which day track the run
covered. Your input file still decides which scopes are written; the flag never filters anything.
Pass `--invoked-by scheduled` when a scheduler started the run rather than a person.

**The writer records the run in `app.analysis_runs`** — one row per offering written. A
`--dry-run` records nothing, because it did not happen. Do **not** also write a `CHANGELOG.md`
entry for a routine aggregation; reserve that file for schema changes and one-off repairs.

**`summary` on that row is UI copy, not a log line.** `site/js/run-banner.js` renders it verbatim
in a strip under the nav on every faculty page, and `status` picks the colour. The writer composes
it accordingly — plain sentences, counts rather than scope keys. The exact keys stay in `detail`
(`scope_keys` holds them literally; `scopes_written` holds section codes and instructor *names*),
because `instr:<uuid>` resolves to nothing a director can read. It printed the key list until
2026-08-11, which is how sixteen identifiers reached a phone-width banner.

**`status` turns on whether anyone must act, not on whether `__all__` landed.** Yellow is only
affordable while it means "something is owed that nobody is already delivering", so a deferral the
next scheduled run clears by itself is **not** a warning. The writer recomputes coverage *after*
the merge — from live rows, never trusted from the input file — and records the outcome in
`detail.all_scope_reason`:

| `all_scope_reason` | Meaning | `status` |
|---|---|---|
| *(absent)* | `__all__` was written this run | `success` |
| `awaiting-track` | Every unaggregated section meets on a day this run did not cover. The two-run cycle, working. | `success` |
| `sections-missing` | A section of a covered day still has no scope — or has empty `meeting_days`, so no day-scoped run will ever reach it | `partial` |
| `stale-prior` | Every section is covered, but a stored scope predates a change to that section's work (Step 5) | `partial` |
| `withheld` | Everything is covered and current, and `__all__` was still not sent | `partial` |

`detail.coverage` carries `complete`, `uncovered[]` and `stale[]` as section codes, so the reason
can be checked rather than taken on trust. Until 2026-08-11 every first-track run recorded
`partial`, which raised a yellow warning for a healthy state on roughly half of all nightly runs —
the alarm fatigue the banner exists to prevent.

## Step 5 — Verify

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py status --lesson <slug> [--day M]
```
Lists the scopes just written with the day that wrote them, `n`, quote count, whether a
recommendation is present, and a `STALE` flag (stored vs. recomputed fingerprint). Spot-check one
section's prose against a couple of that section's reports.

**`__all__` showing STALE between the two day-scoped runs is expected** — its fingerprint covers
every live row, so the second day's submissions move it. That is the signal the second pass is
still owed, and it is the only automated one. Section scopes should be blank; a section that shows
STALE right after its own run means its work changed while you were writing.

> **The faculty rollup DOES display this (since 2026-07-21).** `site/faculty/report.html`
> renders the readiness summary, the misconception-trend prose, and the per-section showcase
> quotes; `loadAnalysis()` in `site/js/faculty-rollup.js` selects the scope. `status` remains
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
**Done 2026-07-21:** `/preflight-analyze`'s per-instructor `by_question` rows are retired. That
skill is now purely per-student, this one owns every cohort output, and the per-question material
lives inside `readiness_summary`. Rows written before the retirement survive in the database and
are ignored by `loadAnalysis()`.

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
  merges, so an M-run and a T-run never collide on them. Pass `--day` so the second run does not
  re-read the first day's cohort — it arrives as `prior_scopes` instead. The whole-course scope is
  written **only** on a run where `coverage.complete` is true, i.e. once every section has been
  aggregated; before that `pull` marks it `write: false` and you omit it. Its numbers are always
  recomputed over every live row, never summed from sections.

**Health check.** `status` recomputes each scope's fingerprint from the current rows and flags
`STALE` when they've changed since the analysis was written — a good post-cron assertion, and the
signal to re-run a scope whose work was resubmitted after aggregation. Between two day-scoped runs
`__all__` is *expected* to read STALE; that is the second pass being owed, not a fault.

---

## Rules

1. **Grades are off-limits.** This skill writes **only** `analysis_reports`. Never write
   `grades.effort`, `grades.points_earned`, or `submission_activities.content` — those belong to
   `/interaction-backfill` and the receiver.
2. **Fidelity over invention.** Derive prose and quotes from what the reports actually say. Ground
   figures in the precomputed `numbers`; don't fabricate misconceptions, trends, or quotes.
3. **Numbers stay consistent with the UI.** Cite the `numbers` block verbatim; don't recompute,
   so the prose always agrees with the live bars.
4. **Never synthesize `__all__` numbers by adding up sections.** Cite `scopes.__all__.numbers`.
   Counts would sum; medians and means do not, and the browser recomputes them from raw rows.
5. **Never write `__all__` when `coverage.complete` is false**, and **never quote — or rewrite — a
   section you did not pull this run.**
6. **Per-section quotes from that section only; `__all__` gets none.** Enforced by the writer, but
   produce them correctly so it never trips.
7. **Mark provenance.** The writer stamps `meta.generated_by = "lesson-aggregate@<date>"`; pass
   `day` so the scope records which run wrote it.
8. **Merge, never replace wholesale.** Send only the scopes you actually rewrote; the writer keeps
   the others. Do not hand-assemble a payload and PATCH it directly.
9. **Keep student-identifying scratch files out of the repo** — reflection text, graded answers and
   names go to the **scratchpad**, never under the repo tree.
10. **No DDL — ever.** If `analysis_reports` is missing, hand the migration to the director.
