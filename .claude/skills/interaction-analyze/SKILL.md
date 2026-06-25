---
name: interaction-analyze
description: >
  Backfill and repair the structured assessment (schema-1 report_data) on lesson-interaction
  reports. Use when interaction reports have a human-readable report_markdown but are missing
  the numeric/structured data the faculty rollup needs — i.e. "backfill interaction data",
  "the interaction rollup is empty / shows no effort or understanding", "analyze interaction
  reports", "fill in report_data for the interactions", or /interaction-analyze. Reads each
  report's Markdown and derives effort, understanding, objectives, misconceptions, reading
  reflection, integrity, and triage flags per INTERACTION-DATA-CONTRACT.md, then writes them
  back to Supabase. Run by a Course Director / System Admin on a machine with the scoped
  claude_code_recker DB role configured.
---

# Interaction Analyzer — structured-data backfill

A lesson **interaction** report arrives as Markdown (`report_markdown`) plus, ideally, a
structured `report_data` blob (the contract's `d`) that powers every numeric rollup in the
faculty UI. Some reports — submitted by artifacts that predate the `d=` payload, or that never
sent it — have the Markdown but **no `report_data`**, so they show up in completion counts but
contribute nothing to effort/understanding/misconception/flag rollups.

This skill reads those reports' Markdown and reconstructs a faithful **schema-1** `report_data`
for each, then writes it back (which also populates `effort`; the DB trigger derives `score`).

**The canonical spec is [`INTERACTION-DATA-CONTRACT.md`](../../../INTERACTION-DATA-CONTRACT.md) (schema 1).
The canonical *shape* to emit is the `report_data` object built in
[`supabase/seed_demo_interaction.sql`](../../../supabase/seed_demo_interaction.sql).** Read §1–§5 of
the contract before grading; this skill assumes that grading model.

This is run by a **Course Director / System Admin** — it needs the scoped `claude_code_recker`
DB role (see `supabase/admin/claude_code_role.sql`) and the project venv.

---

## Step 0 — Preflight

1. Confirm the venv + DB role exist: run the connectivity/permission self-test.
   ```
   .venv/Scripts/python supabase/admin/db_check.py
   ```
   It should connect as `claude_code_recker`, read rows, and report DDL as DENIED. If it
   fails to connect, the config (`.claude/skills/interaction-analyze/config.json`) is missing
   or the direct host was used instead of the **Session pooler** — fix that first.
2. All helper commands below use the project venv python and
   `supabase/admin/interaction_reports.py`.

## Step 1 — See what's missing

```
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```
Lists every interaction with `total / data / missing`. Ignore `demo-rollup-sandbox` (synthetic).
Decide scope: usually backfill one real interaction at a time so you can keep objective keys
consistent within it (Step 3).

## Step 2 — Pull the reports needing data

```
.venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
  --interaction <slug> --out <scratch>/batch.json
```
Writes a JSON array of `{student_id, interaction_id, interaction_title, course_id, name,
section, report_markdown}` for every report with no `report_data`. Read that file.
Use the session scratchpad dir for `batch.json` / the filled output — they contain student
names and should not land in the repo.

## Step 3 — Analyze each report → schema-1 `report_data`

For each report, read `report_markdown` and produce one `report_data` object. **First, for the
interaction as a whole, fix a consistent set of objective `{key,label}` pairs** (derived from
the lesson title + the concepts the reports discuss) and reuse those exact keys across every
report in that interaction, so the rollup groups cleanly. (E.g. lesson-02 charge/Coulomb:
`coulombs-law`, `force-direction-newtons-third`, `charge-properties`,
`conductors-insulators-induction`.)

Emit every field defined in contract §5. Conventions: **0–5 integers**, `null` = "not assessed"
(never `0`), `[]` for empty lists, every objective/misconception self-describing (inline
`label`). Set `"schema": 1` and `"producer": "backfill-from-report@YYYY-MM-DD"` so these rows
are auditable as reconstructed (not artifact-emitted).

### effort — GRADED (the only grade-bearing field)
Engagement, **not correctness** (a fully-wrong but fully-engaged cadet = 5). Read duration,
turn count, the tutor's notes, and the readiness narrative for engagement signals. Use the §5.2
rubric (5 sustained → 0 refused).
**Reading-reflection gate (hard cap):** if the cadet did not *meaningfully* respond to the
reading reflection, `effort` may not exceed **2**, regardless of other engagement. Judge
substance, not length — a few genuine sentences pass; "n/a", one word, copied, or non-responsive
fails. Record the judgment in `reading_reflection.meaningful`; the writer re-clamps effort to ≤2
if `meaningful` is false, so the two must agree.
Always include `effort_rationale` (one line).

### understanding & objectives — DIAGNOSTIC
`overall_understanding` (holistic), `self_rated_understanding` if the report states it (else
omit/null). `objectives`: one entry per fixed objective key — map the report's concept-by-concept
assessment to 0–5 (`Understood`→4–5, `Partial`→3, `misconception/struggling`→1–2, not reached→
`null`). Include `confidence` only if evident, else omit.

### misconceptions — DIAGNOSTIC, self-describing
One object per misconception the report surfaces: `{id, label, description, objective_key?,
severity?, evidence?}`. Prefer ids from the taxonomy in CLAUDE.md / the contract examples (e.g.
`forces-cancel`, `scalar-sum`, `same-charge-near-face`); coin a clear id+label for anything new.
Put a short quote/paraphrase from the report in `evidence`. `[]` if none.

### reading_reflection — DIAGNOSTIC (+ the gate)
`{text (verbatim), meaningful (bool), engagement (0–5|null), topics (string[]), sentiment}`.

### honor — judge APPROPRIATENESS, not disclosure (§5.6, 2026-06-25 clarification)
- `none` — no improper help, **including appropriate collaboration** (talking with a peer
  *beforehand*, permitted references). Default; not flagged.
- `disclosed` — **inappropriate** help/resources: another AI assisting, a solutions key,
  disallowed materials, or working a peer through the assignment *during* it. Surfaces as
  "Inappropriate resources."
- `concern` — an integrity problem *in the conversation itself*: manipulating/harassing the AI
  to inflate the report or game effort, or pasted content not their own.
- `null` — integrity not addressed.
Put the reason in `note` when status is `disclosed`/`concern`. (Example: "used my equation sheet
and worked alongside a friend at the same time" → `disclosed`, because the help was concurrent,
not beforehand.)

### narrative + flags
`ai_summary` (1–2 sentences), `key_strengths`, `recommended_review`. `flags`:
`needs_follow_up` (low effort or weak understanding, or an honor disclosure worth a look),
`notable` (**exemplary** only — strongest understanding or a real extension; NOT the low end),
`note` (one line). Map the report's readiness flag: 🔴 → low understanding + `needs_follow_up`;
🟡 → `needs_follow_up`; 🟢 → neither (consider `notable` only if genuinely exemplary).

Write the results as a JSON array of `{student_id, interaction_id, report_data}` to a scratch
file (the same scratchpad dir).

## Step 4 — Write back

Dry-run first, then commit:
```
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratch>/filled.json
```
The writer sets `report_data` + `effort` (trigger derives `score`), fills **only** rows whose
`report_data IS NULL` unless `--force`, re-clamps effort for non-meaningful reflections, and
rejects any blob over 32 KB. Re-running is safe (already-filled rows are skipped).

## Step 5 — Verify

```
.claude/.../interaction_reports.py stats        # missing count for the interaction should be 0
```
Then open the faculty Interactions page → that lesson → the rollup should now show effort,
understanding, misconceptions, reflection quotes, and flags. Spot-check one student against
their full report.

---

## Rules
1. **Effort = engagement, never correctness.** Wrong-but-engaged is still high effort.
2. **Honor by appropriateness.** Peer talk beforehand = `none`; concurrent help / disallowed
   resources = `disclosed`. Don't over-flag, don't under-flag.
3. **Fidelity over invention.** Derive from what the report actually says. If a concept wasn't
   reached, the objective is `null`, not `0`. Don't fabricate misconceptions or quotes.
4. **Consistent objective keys within an interaction**, so the rollup aggregates correctly.
5. **Mark provenance** — `producer: "backfill-from-report@<date>"`.
6. **Never alter schema or other data.** The role can't run DDL; only `report_data` + `effort`
   are written. `score` is the trigger's job; never set it directly.
7. **Keep student-identifying scratch files out of the repo** (use the scratchpad dir).
