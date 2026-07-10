---
name: interaction-backfill
description: >
  One-off / occasional REPAIR tool. Backfills the schema-1 structured assessment (report_data)
  onto lesson-interaction reports that have a human-readable report_markdown but are missing the
  numeric/structured data the faculty rollup needs. Use when interaction reports were submitted
  without the `d=` structured payload — i.e. "backfill interaction data", "the interaction rollup
  is empty / shows no effort or understanding for an old lesson", "fill in report_data for the
  interactions", or /interaction-backfill. Reads each report's Markdown and derives effort,
  understanding, objectives, misconceptions, reading reflection, integrity, and triage flags per
  INTERACTION-DATA-CONTRACT.md, then writes them back to Supabase. NOT the cohort-aggregation skill
  (readiness summaries / misconception trends across a class) — that is a separate, future skill.
  Run by a Course Director / System Admin on a machine with the scoped claude_code_recker DB role.
---

# Interaction Backfill — per-report structured-data repair

> **Scope / naming.** This is a **mostly one-off repair tool**, not a routine workflow. It exists
> because some interaction reports arrived as Markdown only (artifacts that predate, or omitted, the
> `d=` structured payload), so they show in completion counts but contribute nothing to the rollup.
> The **cohort AGGREGATION** skill — class-level readiness summaries, misconception clustering,
> showcase quotes written to `interactions.analysis_report` — is a **separate, future** skill and is
> deliberately *not* this one. Keep the two distinct.

A lesson **interaction** report ideally carries a structured `report_data` blob (the contract's `d`)
that powers every numeric rollup in the faculty UI. Reports missing it have the Markdown but no
structured data. This skill reads that Markdown and reconstructs a faithful **schema-1** `report_data`
for each, then writes it back (which also populates `effort`; the DB trigger derives `score`).

**Canonical spec:** [`INTERACTION-DATA-CONTRACT.md`](../../../INTERACTION-DATA-CONTRACT.md) (schema 1).
**Canonical *shape* to emit:** the `report_data` object built in
[`supabase/seed_demo_interaction.sql`](../../../supabase/seed_demo_interaction.sql). Read §1–§5 of the
contract before grading.

Run by a **Course Director / System Admin** — needs the scoped `claude_code_recker` DB role and the
project venv. **How the access works + the operating rules:**
[`supabase/admin/AGENT-DB-ACCESS.md`](../../../supabase/admin/AGENT-DB-ACCESS.md).

---

## Step 0 — Preflight

1. Verify DB access (connects as `claude_code_recker`, reads, and reports DDL as DENIED):
   ```
   .venv/Scripts/python supabase/admin/db_check.py
   ```
   If it can't connect, the credential (`supabase/admin/config.json`) is missing or the direct host
   was used instead of the **Session pooler** — see `supabase/admin/AGENT-DB-ACCESS.md`.
2. All helper commands below use the project venv python and `supabase/admin/interaction_reports.py`,
   which reads `supabase/admin/config.json` automatically.

## Step 1 — See what's missing

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Lists every interaction with `total / data / missing`. Ignore `demo-rollup-sandbox` (synthetic).
Backfill one real interaction at a time so objective keys stay consistent within it (Step 3).

## Step 2 — Pull the reports needing data

```
.venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
  --interaction <slug> --out <scratch>/batch.json
```
Writes a JSON array of `{student_id, interaction_id, interaction_title, course_id, name, section,
report_markdown}` for every report with no `report_data`. Read that file. Use the **session
scratchpad** for `batch.json` / the filled output — they contain student names and must not land in
the repo.

## Step 3 — Analyze each report → schema-1 `report_data`

For each report, read `report_markdown` and produce one `report_data` object. **First, for the
interaction as a whole, fix a consistent set of objective `{key,label}` pairs** (from the lesson title
+ the concepts the reports discuss) and reuse those exact keys across every report in that interaction,
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
`{id, label, description, objective_key?, severity?, evidence?}`. Prefer taxonomy ids from AGENTS.md /
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

Write results as a JSON array of `{student_id, interaction_id, report_data}` to a scratch file.

## Step 4 — Write back

```
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json
```
The writer sets `report_data` + `effort` (trigger derives `score`), fills **only** rows with
`report_data IS NULL` unless `--force`, re-clamps effort for non-meaningful reflections, and rejects
any blob over 32 KB. Re-running is safe (filled rows are skipped).

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
4. **Consistent objective keys within an interaction.**
5. **Mark provenance** — `producer: "backfill-from-report@<date>"`.
6. **Never alter schema or other data.** Only `report_data` + `effort` are written; the trigger sets
   `score` (never set it directly). See `supabase/admin/AGENT-DB-ACCESS.md` for the full ruleset.
7. **Keep student-identifying scratch files out of the repo** (use the scratchpad).
