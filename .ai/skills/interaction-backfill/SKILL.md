---
name: interaction-backfill
description: >
  One-off / occasional REPAIR tool. Backfills the schema-1 structured assessment onto interactive
  lesson work that has a human-readable report_markdown but is missing the numeric/structured data
  the faculty rollup needs. Use when interaction reports were submitted without the `d=` structured
  payload — i.e. "backfill interaction data", "the interaction rollup is empty / shows no effort or
  understanding for an old lesson", "fill in report_data for the interactions", or
  /interaction-backfill. Reads each report's Markdown and derives effort, understanding, objectives,
  misconceptions, reading reflection, integrity, and triage flags per INTERACTION-DATA-CONTRACT.md,
  then writes them to app.submission_activities.content and the enrolment's app.grades row. NOT the
  cohort-aggregation skill (readiness summaries / misconception trends across a class) — that is
  /lesson-aggregate. Run by a Course Director / System Admin on a machine with the scoped
  prep_app_dml DB role.
---

# Interaction Backfill — per-report structured-data repair

> **Scope / naming.** This is a **mostly one-off repair tool**, not a routine workflow. It exists
> because some interaction reports arrived as Markdown only (artifacts that predate, or omitted, the
> `d=` structured payload), so they show in completion counts but contribute nothing to the rollup.
> The **cohort AGGREGATION** skill — class-level readiness summaries, misconception clustering,
> showcase quotes — is **`/lesson-aggregate`**, a separate skill. Keep the two distinct.

A lesson **interaction** report ideally carries a structured `report_data` blob (the contract's `d`)
that powers every numeric rollup in the faculty UI. Reports missing it have the Markdown but no
structured data. This skill reads that Markdown and reconstructs a faithful **schema-1** `report_data`
for each, then writes it back (which also sets the enrolment's `effort` and points).

**Canonical spec:** [`INTERACTION-DATA-CONTRACT.md`](../../../docs/contracts/INTERACTION-DATA-CONTRACT.md) (schema 1).
Read §1–§5 of the contract before grading.

Run by a **Course Director / System Admin** — needs the scoped `prep_app_dml` DB role
(`supabase/admin/.env`) and the project venv.

---

## Where the data lives (PREP v2 — schema `app`)

The `public` tables this skill used are gone from the workflow. `supabase/admin/interaction_reports.py`
has been rewritten against `app`; the mapping it implements:

| what you are repairing | `public` (retired) | `app` (now) |
|---|---|---|
| the lesson | `interactions` (own table) | `activities` where `modality = 'interactive'` |
| its slug | `interactions.id` | `activities.slug` — **the same string, verbatim**; still the frozen artifact contract surface (`interaction-submit.html#i=<slug>`) |
| the report row | `preflight_interaction_reports` | `submission_activities`, reached through `submissions` |
| the structured data | `…​.report_data` | `submission_activities.content` |
| the Markdown | `…​.report_markdown` | `submission_activities.report_markdown` |
| the grade | `…​.effort` / `…​.score` | `grades.effort` / `grades.points_earned` |
| the student in a section | `students.section_id` | `enrollments (student_id, section_id)` |

Everything per-student keys on **`enrollment_id`**, not `student_id`.

> **The one behavioural change: effort no longer implies points by itself.** In `public` a trigger
> turned `preflight_interaction_reports.effort` into a 0–2 score unconditionally. In `app` the
> equivalent trigger fires **only** when the offering is `grading_mode = 'effort'`, and every
> migrated Fall-2026 offering is `grading_mode = 'points'`. So the writer computes `points_earned`
> itself, from the same migration-013 curve scaled to the offering's `points_possible`
> (3–5 → full, 1–2 → half, 0/absent → zero). On an effort-mode offering the trigger recomputes the
> identical value, so the result is the same either way — the rule did not change, only who applies it.

---

## Step 0 — Preflight

1. Verify DB access (connects as the `app` tiers, reads, and reports DDL as denied for `dml`/`read`):
   ```
   .venv/Scripts/python supabase/admin/app_tier_check.py
   ```
   If it can't connect, the credential file `supabase/admin/.env` is missing or the direct host was
   used instead of the **Session pooler** — see `supabase/admin/app_schema_bootstrap.sql`.
   (The `owner` tier failing to connect is expected once it has been sealed — that is the gate
   working, not a regression.)
2. All helper commands below use the project venv python and `supabase/admin/interaction_reports.py`,
   which reads `supabase/admin/.env` and selects schema `app` automatically. Do not pass the legacy
   `supabase/admin/config.json` credential — that role only ever had rights in `public`.

## Step 1 — See what's missing

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Lists every interactive activity with `total / data / missing`. Backfill one activity at a time so
objective keys stay consistent within it (Step 3).

## Step 2 — Pull the reports needing data

```
.venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
  --activity <slug> --out <scratch>/batch.json
```
Writes a JSON array of `{student_id, activity_slug, activity_title, course_code, name, section,
report_markdown}` for every row with no structured content. Read that file. Use the **session
scratchpad** for `batch.json` / the filled output — they contain student names and must not land in
the repo.

(`--interaction` is still accepted as an alias for `--activity`, so an old command line keeps working.)

## Step 3 — Analyze each report → schema-1 `report_data`

For each report, read `report_markdown` and produce one `report_data` object. **First, for the
activity as a whole, fix a consistent set of objective `{key,label}` pairs** (from the lesson title
+ the concepts the reports discuss) and reuse those exact keys across every report in that activity,
so the rollup groups cleanly. (E.g. lesson-02 charge/Coulomb: `coulombs-law`,
`force-direction-newtons-third`, `charge-properties`, `conductors-insulators-induction`.)

Emit every field in contract §5. Conventions: **0–5 integers**, `null` = "not assessed" (never `0`),
`[]` for empty lists, every objective/misconception self-describing (inline `label`). Set
`"schema": 1` and `"producer": "backfill-from-report@YYYY-MM-DD"` so these rows are auditable as
reconstructed (not artifact-emitted).

### effort — GRADED (only grade-bearing field)
Engagement, **not correctness**. Use the §5.2 rubric (5 sustained → 0 refused), reading duration,
turn count, and the tutor's narrative.
**Reading-reflection gate (hard cap):** if the cadet didn't *meaningfully* respond to the reading
reflection, `effort` may not exceed **2**. Judge substance, not length — a few genuine sentences pass;
"n/a", one word, copied, or non-responsive fails. Record it in `reading_reflection.meaningful`; the
writer re-clamps effort to ≤2 if `meaningful` is false, so the two must agree. Always include
`effort_rationale`.

### understanding & objectives — DIAGNOSTIC
`overall_understanding`; `self_rated_understanding` only if stated. `objectives`: one entry per fixed
key — map the report's concept table to 0–5 (`Understood`→4–5, `Partial`→3, `misconception`→1–2, not
reached→`null`). `confidence` only if evident.

### misconceptions — DIAGNOSTIC, self-describing
`{id, label, description, objective_key?, severity?, evidence?}`. Prefer taxonomy ids from `.ai/instructions/PROJECT.md` /
the contract; coin a clear id+label otherwise. Short quote/paraphrase in `evidence`. `[]` if none.

### reading_reflection — DIAGNOSTIC (+ gate)
`{text (verbatim), meaningful (bool), engagement (0–5|null), topics (string[]), sentiment}`.

### honor — judge APPROPRIATENESS, not disclosure (§5.6)
- `none` — no improper help, **incl. appropriate collaboration** (peer talk *beforehand*, permitted refs).
- `disclosed` — **inappropriate** help/resources: another AI assisting, a solutions key, disallowed
  materials, or working a peer through it *during* the session ("Inappropriate resources").
- `concern` — integrity problem in the conversation itself (manipulating the AI, pasted content).
- `null` — not addressed. Put the reason in `note` for `disclosed`/`concern`.

### narrative + flags
`ai_summary`, `key_strengths`, `recommended_review`. `flags`: `needs_follow_up` (low effort/weak
understanding, or an honor disclosure worth a look), `notable` (**exemplary only**), `note`.
Map the readiness flag: 🔴 → low understanding + `needs_follow_up`; 🟡 → `needs_follow_up`; 🟢 →
neither (consider `notable` only if genuinely exemplary).

Write results as a JSON array of `{student_id, activity_slug, report_data}` to a scratch file.

## Step 4 — Write back

```
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json
```
The writer sets `submission_activities.content` **and** upserts the enrolment's `app.grades` row
(`effort` + `points_earned` from the effort curve, `source='ai_suggested'`, `is_finalized=false`).
It fills **only** rows with `content IS NULL` unless `--force`, re-clamps effort for non-meaningful
reflections, and rejects any blob over 32 KB. Re-running is safe (filled rows are skipped).

**A finalized grade is never overwritten.** If an instructor has already finalized that
(enrolment, offering), the content is still repaired but the grade is left alone, and the line
reads `GRADE KEPT (finalized)`. Check for those before assuming a run rewrote everything.

## Step 5 — Verify

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats     # missing should be 0
```
Then open the faculty Interactions page → that lesson → the rollup should show effort, understanding,
misconceptions, reflection quotes, and flags. Spot-check one student against their full report.

---

## Rules
1. **Effort = engagement, never correctness.**
2. **Honor by appropriateness.** Peer talk beforehand = `none`; concurrent help / disallowed
   resources = `disclosed`.
3. **Fidelity over invention.** Derive from what the report says; unreached concept → `null`, not `0`;
   don't fabricate misconceptions or quotes.
4. **Consistent objective keys within an activity.**
5. **Mark provenance** — `producer: "backfill-from-report@<date>"`.
6. **Never alter schema or other data.** Only `submission_activities.content` and the enrolment's
   `grades` row (`effort`, `points_earned`) are written. Never write `question_scores`, never set
   `is_finalized`, and never touch another activity's work.
7. **Never revert a finalized grade** — the writer's `ON CONFLICT … WHERE NOT is_finalized` guard
   enforces this; don't work around it with `--force` (which only affects the content).
8. **Keep student-identifying scratch files out of the repo** (use the scratchpad).
