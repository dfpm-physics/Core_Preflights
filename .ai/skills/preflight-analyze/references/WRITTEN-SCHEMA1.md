# Emitting `schema: 1` for a written preflight

Read this together with [`QUESTION-DIAGNOSTICS.md`](QUESTION-DIAGNOSTICS.md) whenever
`/preflight-analyze` grades a submitted written preflight. That file defines the two per-question
diagnostics; this one defines the **per-student structured assessment** that makes a written
preflight and an interactive lesson commensurable.

## Why this exists

An interactive lesson produces a `schema: 1` payload per student — the artifact writes it at
submit time (`docs/contracts/INTERACTION-DATA-CONTRACT.md`). A written preflight never had an
equivalent producer, so every cohort summary that folds `schema: 1` described only the students
who took the artifact. This skill is that producer for the written path.

**You already do this analysis.** Step 7 reads every free-response answer and classifies it
against the misconception taxonomy. The work here is to emit that finding as *structure* rather
than only as English, so it survives into the rollup and into the cohort aggregation.
`LESSON-UNIFICATION.md` §11 calls this "the work that makes the preflight and the interaction
commensurable."

Since 2026-07-21 this is the **only** channel out of the skill for a misconception — the
per-instructor prose summary that used to carry them (Step 8) is retired. A finding you do not
record here reaches nobody.

## Where it goes

One object on the enrollment's `app.grades` row, at `diagnostic`, in the **same batch upsert** as
the suggested grade (Step 9). The column comment already names this shape:

> *The frozen schema:1 payload — overall_understanding, objectives[], misconceptions[],
> reading_reflection, flags. NEVER contributes to points.*

`diagnostic` is `jsonb NOT NULL DEFAULT '{}'` with **no size CHECK** — unlike
`submission_activities.content`, nothing will reject an oversized payload, so keep it lean (see
"What NOT to emit").

**This is purely additive.** `q2_effort` and `q3_understanding` stay exactly where they are and
keep their existing rubrics — they are per-question measures and are *not* renames of the fields
below. Nothing is removed, no migration is needed, and none of it can reach `points_earned`,
`question_scores`, `status`, feedback, or finalization.

## The shape

```json
{
  "q2_effort": 4,
  "q3_understanding": 2,

  "schema": 1,
  "source": "preflight-analyze",
  "effort": 4,
  "overall_understanding": 2,
  "objectives": [
    { "key": "coulomb-vector", "label": "Vector form of Coulomb's law", "understanding": 2 }
  ],
  "misconceptions": [
    { "id": "scalar-sum", "label": "Scalar sum of forces",
      "description": "Adds force magnitudes without accounting for direction.",
      "severity": "major", "evidence": "\"I added 3N and 5N to get 8N\"" }
  ],
  "reading_reflection": { "meaningful": true, "engagement": 4 },
  "reading_minutes": 45,
  "flags": { "needs_follow_up": false, "notable": false }
}
```

### `reading_minutes` — DIAGNOSTIC, the whole point of Q1

Q1 of every preflight is the reading-time question — *"How much time did you spend reading the
book in preparation for this lesson?"* — worth **0 points**, with the student's name hidden from
instructors because it is a class-level diagnostic, not an assessment of the individual.

It has never been rolled up. The answers sit in the database as prose and nobody sees the
distribution, which is the one number that says whether the class did the reading at all. Parse
each answer to **whole minutes** and put it here.

Answers are natural language, and you are the only thing in the pipeline that can read them:

| Answer | `reading_minutes` |
|---|---|
| `"15 minutes."` | `15` |
| `"About half an hour."` | `30` |
| `"An hour and a quarter — this one was dense."` | `75` |
| `"Maybe 20 minutes, I skimmed it."` | `20` |
| `"1.5 hrs"` | `90` |
| `"a couple hours"` | `120` |

Rules:

- **A range takes its midpoint.** `"20-30 minutes"` → `25`.
- **Round to the nearest whole minute.** The column is an integer.
- **Omit the key when the answer states no duration** — blank, `"n/a"`, `"I read it"`, or a
  reflection that never mentions time. Absent means "not stated", which is the truth; `0` means
  "said they read for zero minutes", which is a different and much stronger claim.
- **Never infer from effort or from the reflection's quality.** A thorough reflection is not
  evidence of a long read, and this number must stay independent of the ones it will be
  correlated against.
- **Do not cap or sanity-check an outlier.** `"3 hours"` is `180`. The rollup uses a median and
  buckets precisely so one outlier cannot distort the class picture; silently clamping would
  destroy a real signal (a student who genuinely struggled for three hours is worth seeing).

This is written-path only. The interactive contract's `duration_min` is **self-reported minutes of
conversation with the artifact** (§5.1) — a different quantity entirely. Do not write to it, and
do not treat the two as comparable.

### `effort` — GRADED, and not the same number as `q2_effort`

Engagement across the **whole attempt**, 0–5, then capped at 2 when the reading reflection is not
meaningful — the same rule and the same rubric the artifact applies
(`INTERACTION-DATA-CONTRACT.md` §5.2). Correctness is irrelevant: a wrong-but-engaged preflight
earns full effort.

`q2_effort` scores the reading-reflection answer *alone*. On a three-question preflight the two
usually land close, but they are different measurements and both are kept. Derive `effort` from
genuine attempt across every question — the skill already classifies blank/gibberish/one-word
answers as `zero`, which is the raw material — and apply the meaningful-gate last.

> **Do not write `grades.effort`.** These offerings are `grading_mode='points'` and Step 2's
> preflight check refuses anything else. Effort belongs in this payload only; writing the column
> on a points-graded offering is harmless today but misleading, and would be actively wrong if
> the offering were ever switched to effort grading.

### `overall_understanding` — DIAGNOSTIC

Holistic understanding across the preflight, 0–5. Distinct from `q3_understanding`, which scores
the one free-response question. On a preflight whose only physics question *is* q3 these coincide;
emit both anyway rather than reasoning about when they diverge.

### `objectives[]` — emit ONLY when the questions declare them

`{ key, label, understanding }` per objective, understanding 0–5.

Build it from `objective_key` on the written activity's question objects
(`activities.content.questions[].objective_key`). Group the student's answers by that key and
score understanding per group.

**As of 2026-07-21 nothing populates `objective_key`, so this array is normally `[]`.** That is
the correct output, not a gap to paper over: an objective breakdown invented without an authored
taxonomy would put fabricated axes on the faculty radar. Emit `[]` and say so in the run report.
When a course director authors the keys, this array fills in and the radar gains real axes with
no code change.

### `misconceptions[]` — the structure behind Step 8's prose

Same shape as the contract (§5.4): `{ id, label, description, severity?, evidence?,
objective_key? }`.

- **Match before you coin.** Full four-step resolution order in `SKILL.md` § "Match before you coin
  — the misconception bucket": the ids already recorded against this assignment (query them), then
  the per-preflight tables in `.ai/instructions/PROJECT.md`, then the generic table, and only then a
  new id. Nothing validates these ids, and every counting site keys on the exact string — a synonym
  you invent splits one finding into two bars at half the real prevalence.
- Coin a new kebab-case id only for something genuinely absent, lowercase and hyphen-separated, and
  give it a `label` and `description` good enough that `/lesson-aggregate` can fold or promote it.
- One entry per **distinct** misconception the student showed — not one per question, and never a
  duplicate id within a student.
- **`description` and `evidence` are now rendered, not just stored.** Both surface in the rollup's
  misconception popover — the description explains what the misconception *is*, and up to two
  students' `evidence` quotes show what it looks like in their own words, unattributed. Until
  2026-07-22 both were dropped before the cohort bars, so a bar showed a label and a percentage and
  nothing else. Write them for a faculty reader who has thirty seconds before class: one clear
  sentence for the description, one clause of real student wording for the evidence.

These entries are what the rollup counts into its prevalence bars and what `/lesson-aggregate`
reconciles into canonical buckets. They are the finding's only route out of this skill.

### `reading_reflection` — the judgment, NOT the text

`{ meaningful, engagement }`. `meaningful` is the substance judgment that gates `effort` above;
`engagement` is the 0–5 read, which for a written preflight is the same number as `q2_effort`.

**Omit `text`.** The contract carries it for the interactive path because the artifact's payload
is the only record of the conversation. A written reflection is already stored verbatim in
`submission_activities.content` — copying it here would duplicate student prose into a second
table for no gain, and quote selection reads the response directly.

### `flags` — triage

`{ needs_follow_up, notable }`, both booleans.

- `needs_follow_up`: low effort or weak understanding — a student worth checking in with.
  Anchor it, don't freehand it: effort ≤ 2 **or** `overall_understanding` ≤ 1.
- `notable`: exemplary — the strongest understanding, or a genuine extension beyond what the
  question asked. Rare by construction; most cohorts have a handful.

### `no_submission` — written-path only, and only when true

`true` on a row written for a student who handed **nothing** in by their own deadline and held no
active extension (SKILL.md § "Then: the students who submitted nothing get a zero"). **Omit it
entirely otherwise** — an absent key means "they submitted", and `false` would be a third state
nobody needs.

It exists because an all-zero diagnostic is otherwise ambiguous. A student who submits a page of
gibberish scores `effort 0`, `overall_understanding 0`, `q2_effort 0`, `q3_understanding 0` — byte
for byte what a non-submitter's row carries — and the two call for opposite conversations. The
distinction is recoverable from the absence of a `submissions` row, but only by someone who knows
to go and look; on the row itself there was nothing to see.

Nothing reads it today. It is provenance for a human opening the record, and for whatever asks
"why is this zero" next term.

### `honor`

**Omit it.** The artifact can observe disclosed assistance because it holds the conversation. A
written preflight gives you an answer with no provenance, so any status you emit would be a guess.
An absent key reads as "not assessed", which is the truth; `"none"` would read as "assessed and
clean", which you cannot know.

## What NOT to emit

- **`text` on the reflection**, `r`, transcripts, or any verbatim answer — already stored.
- **`honor`** — see above.
- **`self_rated_understanding`** — a written preflight never asks the student to rate themselves.
- **`duration_min` / `message_count` / `completed`** — engagement metadata from a conversation
  that did not happen. Absent keys keep those cohort panels honestly empty rather than reporting
  a fabricated zero.

## Verification (extends Step 9's read-back)

Read back `diagnostic` for the run's exact enrollment ids and require, per graded enrollment:

- `schema == 1` and `source == "preflight-analyze"`.
- `effort` an integer in `[0,5]`; where the reflection was judged not meaningful, `effort <= 2`.
- `overall_understanding` an integer in `[0,5]` or absent.
- `objectives` an array; every entry has a non-empty `key` and an `understanding` in `[0,5]`.
- `misconceptions` an array; every entry has non-empty `id`, `label` and `description`, and no
  duplicate `id` within one student.
- `reading_minutes`, where present, a positive integer. Absent wherever the answer stated no
  duration — and **never `0` as a stand-in for "not stated"**.
- `flags.needs_follow_up` and `flags.notable` both boolean.
- `q2_effort` / `q3_understanding` still present and unchanged wherever the question exists —
  this addition must not disturb them.
- **No `text` key anywhere in the payload**, and no `honor` key.

Compare every returned value against the run's in-memory payload before reporting success. A
mismatch is a failed run, not a partial one.
