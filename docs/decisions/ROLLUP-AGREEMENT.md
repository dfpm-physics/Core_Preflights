# Rollup Agreement — one faculty rollup across preflights and interactions

*Design doc. Authored 2026-06-25 by Matthew Recker (via Claude). Status: **proposed** — partially
built (interaction side exists; preflight side + convergence pending). Companion to
[`INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md) (per-student **input**),
[`INTERACTION-AGGREGATION.md`](INTERACTION-AGGREGATION.md) (interaction aggregator mechanics), and
[`LESSON-UNIFICATION.md`](../architecture/LESSON-UNIFICATION.md) (the lesson model). See [`CHANGELOG.md`](../../CHANGELOG.md).*

**What this doc is for.** This is the **output contract** for the faculty lesson rollup: the fixed set
of panels an instructor sees, the shape + length + style of every AI-written field, and which skill
owns which field for which lesson type. **Read this before editing `/preflight-analyze`,
`/interaction-aggregate`, or the rollup UI** — its purpose is that a change to one skill stays
consistent with the other so the instructor keeps seeing *one* rollup, not two dialects.

Where `INTERACTION-DATA-CONTRACT.md` is the *input* (what one student's report contains),
this is the *output* (what the class-level rollup contains).

---

## 1. The principle: one rollup, one style, one allowed divergence

Every lesson — preflight-only, interaction-only, or choice — renders **the same rollup, in the same
order, in the same visual + text style.** A student's per-student assessment is the same
`schema: 1` shape regardless of path (see `LESSON-UNIFICATION.md` §8), so the rollup built on top of
it is the same too.

**The single permitted divergence is the breakdown axis:**

- **By objective** — interaction-only and choice lessons (objectives are the shared taxonomy).
- **By question** — preflight-only lessons (no shared objective taxonomy; questions are the unit).

Same component, same headers, same numeric ramp, same per-item summary style — only the grouping key
differs. Nothing else about the rollup changes by lesson type.

---

## 2. Two layers: live numbers vs. AI prose

The rollup is always two layers, and **the skills only write the second one:**

1. **Live numbers (browser, no AI).** Effort distribution, understanding gauge/ramp, per-item
   (objective/question) histograms, misconception prevalence bars, completion %, flag tallies — all
   computed in the page by `summarizeReports()` over the unified per-student data
   (`lesson_completions.report_data`; `preflight_interaction_reports.report_data` for interaction-only
   today). These are never written by a skill and never go stale.
2. **AI prose (written by a skill, stored).** The readiness summary, the misconception *trends*
   narrative, optional per-item summaries, and the showcase-quote picks. This is the only layer this
   agreement governs.

**Grounding rule:** every prose field must agree with the live numbers — cite the same counts
`summarizeReports()` produces (e.g. "8/14 show force-superposition"). Never invent a number; never
contradict a bar.

---

## 3. Audience & scope

One scope model for all lesson types (the interaction model wins; the old by-instructor assignment
report is retired in favor of it):

- **Per section** — one rollup record per real `sections.id` (e.g. `M1A`).
- **Whole course** — one `'__all__'` sentinel record (director/admin only).
- **Instructor view** = the live union of *their own* sections' records; they never read `'__all__'`.
- **Showcase quotes appear on single-section views only** — never on `'__all__'` (a per-section
  teaching tool). Enforced by DB CHECK on the store.

This mirrors `interaction_analysis` (migration 014) and the RLS already there.

---

## 4. Anatomy of the rollup (canonical panels, in order)

| # | Panel | Numeric (live) | AI prose | Owner skill |
|---|---|---|---|---|
| 1 | **Header** — title, completion %, scope control, flag pills | ✅ | — | — |
| 2 | **Headline gauges** — Effort (graded, 0–5→pts) · Understanding (diagnostic, 0–5) | ✅ | — | — |
| 3 | **Readiness summary** — short "what to cover first" narrative | grounds in #2,#4 | **`readiness_summary`** | per type (§6) |
| 4 | **Effort distribution** — 0–5 labeled histogram | ✅ | — | — |
| 5 | **Breakdown** — *by objective* or *by question* (the one divergence) | ✅ per item | optional **`breakdown[].summary`** | per type (§6) |
| 6 | **Misconceptions** — live prevalence bars + trend narrative | ✅ bars | **`misconception_trends`** (sits under the bars) | per type (§6) |
| 7 | **Reading-reflection showcase** — 2–3 picked quotes (single-section only) | — | **`selected_quotes`** = `[{student_id, section_id}]` | per type (§6) |
| 8 | **Flags** — clickable chips → flagged students → per-student drill-in | ✅ tallies | optional **`flags_note`** | per type (§6) |

Reading reflection exists in **both** modalities (identical question per
`LESSON-UNIFICATION.md` §11), so panel 7 is available for every lesson type — not interaction-only.

---

## 5. The one divergence, in detail — breakdown axis

Panel 5 is a list of **items**, each with a live mini-chart + an optional AI `summary`
(the `\n`-joined bullet style, no leading bullet char — see §8):

- **Interaction-only / choice → `axis: "objective"`.** Items are `lessons.objectives` keys; the
  mini-chart is per-objective understanding (mean vs. target / fine histogram). Per-item `summary` is
  optional (the readiness summary already covers weak objectives).
- **Preflight-only → `axis: "question"`.** Items are the assignment's question ids; per-item `summary`
  is the per-question narrative `/preflight-analyze` already produces today (score distribution, top
  misconception, blanks, what strong answers had, one recommendation).

Same renderer, same card style, same bullet format — the axis label and grouping key are the only
difference an instructor perceives.

---

## 6. Producers & ownership (the agreement that keeps it consistent)

Two skills, split by rollup type (per `LESSON-UNIFICATION.md` §12). **Each skill, for the lesson types
it owns, must emit the same prose fields in the same shapes** so the union reads as one rollup.

> **Superseded 2026-07-21 — ownership moved; the field shapes below still stand.** This table
> split cohort prose across two skills because, when it was written, nothing could read the
> written path's per-student assessment. `/preflight-analyze` now emits `schema: 1` into
> `grades.diagnostic` (its `references/WRITTEN-SCHEMA1.md`), so `/lesson-aggregate` — the renamed
> `/interaction-aggregate` — reads **both** modalities and owns `readiness_summary`,
> `misconception_trends` and `selected_quotes` for **every** lesson type. `/preflight-analyze`
> keeps only the `kind='by_question'` breakdown. The driver is cadence: grading runs early and
> often, sometimes split M/T; cohort prose must be written once, after the deadline, over a whole
> cohort. Everything else in this document — the panel set, field shapes, style, grounding rule —
> is unchanged. See `CHANGELOG.md` 2026-07-21.

> **Superseded again, later the same day — the `by_question` breakdown is retired outright, and
> `/preflight-analyze` now writes no cohort output at all.** The note above left it owning
> `kind='by_question'` rows. Those were keyed **per instructor** (`audience_id`), which is not a
> unit of analysis: one row covered an instructor's M1A *and* M3A pooled, so it could never be
> shown on a section view and could not be split, there being no per-section decomposition stored.
> `audience_id` also bought nothing — RLS `ar_read` is an OR chain whose `scope='assignment_offering'`
> clause already grants every such row to any staff member of the offering, so it widens access and
> never narrows it.
>
> **`/preflight-analyze` is now purely per-student** (evaluate answers, write feedback, assess
> effort and understanding). **`/lesson-aggregate` owns every cohort output**, including the
> per-question material, which it folds into `readiness_summary` rather than storing as its own
> panel — Q1 already has the reading-time panel, and Q2/Q3 belong in the prose that reads them. It
> aggregates **by section first, then synthesizes the course scope from those section scopes**, so
> a second day-scoped run does not re-read the first day's cohort. New field
> `misconception_recommendation` (§7). A third skill, `/lesson-cycle`, sequences the two.
> See `CHANGELOG.md` 2026-07-21.

| Lesson type | Breakdown axis | Owner skill | Fields it must write |
|---|---|---|---|
| **preflight-only** | question | `/preflight-analyze` | `readiness_summary`, `breakdown(axis=question)`, `misconception_trends`, `selected_quotes`, `flags_note?` |
| **interaction-only** | objective | `/interaction-aggregate` | `readiness_summary`, `breakdown(axis=objective)?`, `misconception_trends`, `selected_quotes`, `flags_note?` |
| **choice** | objective (merged, with modality breakdown) | `/interaction-aggregate` over unified `lesson_completions` | same as interaction-only, plus a path-split count + per-objective modality contrast in `readiness_summary` |

If you add a panel or change a field's meaning, change it **here first**, then update *both* skills and
the UI so they stay in lockstep.

---

## 7. Field shapes & limits (the binding contract)

All prose is **Markdown-light** (no headings; inline emphasis OK). Bounds match the existing
`interaction_analysis` rails so the convergence is a superset, not a breaking change:

| Field | Type | Limit | Notes |
|---|---|---|---|
| `readiness_summary` | TEXT | ≤ 8000 chars | Engagement level, solid vs. shaky understanding (name weakest items), what to cover first. For `'__all__'`, synthesize across sections. |
| `misconception_trends` | TEXT | ≤ 8000 chars | Sits *under* the live bars — add the *why/pattern/spread*, don't restate counts. Fold novel ones into known buckets. Scoped prose: the panel is headed "across the course" or "in <section>" by the viewer's selection, so write for the scope you were given. |
| `misconception_recommendation` | TEXT | **≤ 1200 chars, single paragraph** | *Added 2026-07-21.* One teaching action, rendered as its own line under the trends prose. Its own cap on purpose — reusing the 8000 limit invites a second essay in a slot the UI renders as one line. **No blank lines**; the writer rejects them rather than normalising. Allowed on `'__all__'` (unlike quotes) — a whole-course "what to cover Monday" is exactly where it matters. Applies to every lesson type, interactive included: it is a teaching action, not a question artifact. |
| `breakdown` | JSONB | per-item `summary` is a `\n`-joined bullet string | `{ "axis": "objective"\|"question", "items": { "<key>": { "summary": "bullet\nbullet" } } }`. 4–7 bullets, **no leading `•`/`-`** (UI adds list styling). **Retired 2026-07-21 for `axis=question`** — no producer writes it and the UI block is deleted; the per-question material now lives inside `readiness_summary`. The shape is kept here because rows written before that date survive in the database. |
| `selected_quotes` | JSONB | ≤ 4096 bytes; `[]` on `'__all__'` | `[{student_id, section_id}]` — ids only, **never verbatim text or names** (resolve live from `report_data` + roster so edits stay fresh). 2–3 per section. |
| `flags_note` | TEXT | ≤ 2000 chars | Optional one-liner context for the flag chips. |
| `meta` | JSONB | — | `{ n, generated_by: "<skill>@<date>", source_fingerprint }`; fingerprint recomputed server-side on write (staleness check). |

Effort is the only graded signal; understanding/misconceptions/reflection are diagnostic — the rollup
must never present understanding or correctness as a grade (mirrors the data contract).

---

## 8. Style rules (so the two skills sound like one)

- **Ground every claim in the live numbers** (§2). Prose that disagrees with a bar is a bug.
- **Bullets:** per-item summaries are `\n`-joined, one idea per line, no leading bullet glyph; the UI
  styles the list. (Matches today's `assignments.analysis_report.questions[].summary`.)
- **No PII in stored prose**; quotes are ids, names resolve live. Never single a student out negatively
  in a quote pick.
- **Audience is the instructor before class** — actionable, brief, "what to do Monday," not a report
  card. Lead with what's shaky and what to cover first.
- **Diagnostic, never punitive** — describe understanding gaps, don't grade them.
- **Graceful degradation:** no stored record → the UI shows live numbers + neutral placeholders (no
  error). A stale record (fingerprint mismatch) → show it with a quiet "may be out of date" note.

---

## 9. Storage — current and target

**Today (two stores, two shapes):**

- `interaction_analysis` (migration 014) — keyed `(interaction_id, section_id)`; holds
  `readiness_summary`, `misconception_trends`, `selected_quotes`, `meta`. The structural seed for this
  agreement.
- `assignments.analysis_report` (migration 001) — keyed by assignment, grouped **by instructor**, with
  per-question `summary` bullets. Different shape, different scope.

**Target (one store, conformant to §4–§7):** a single `lesson_analysis` table keyed
`(lesson_id, section_id)` [+ `'__all__'`] holding all panels for any lesson type:

```sql
-- proposed (migration 0xx, part of the LESSON-UNIFICATION build):
create table lesson_analysis (
  lesson_id            text not null references lessons(id) on delete cascade,
  section_id           text not null,                 -- sections.id or '__all__'
  readiness_summary    text,                          -- ≤ 8000
  misconception_trends text,                          -- ≤ 8000
  breakdown            jsonb not null default '{}'::jsonb,  -- {axis, items:{key:{summary}}}
  selected_quotes      jsonb not null default '[]'::jsonb,  -- [{student_id, section_id}]; [] on '__all__'
  flags_note           text,
  meta                 jsonb not null default '{}'::jsonb,
  generated_at         timestamptz not null default now(),
  primary key (lesson_id, section_id)
  -- + the same CHECKs/RLS as interaction_analysis (migration 014)
);
```

This **generalizes** `interaction_analysis` (adds `breakdown` + `axis` + `flags_note`) and **subsumes**
`analysis_report`'s per-question summaries (as `breakdown.items` with `axis: "question"`). Until that
migration lands, the agreement still binds: `/interaction-aggregate` keeps writing
`interaction_analysis` and `/preflight-analyze` keeps writing `analysis_report`, but **both conform to
the field shapes + style in §7–§8** so the convergence is a lift-and-shift, not a rewrite.

---

## 10. Open decisions

1. **Convergence timing** — fold both stores into `lesson_analysis` as part of the
   `LESSON-UNIFICATION.md` build, or after? *Recommend: define the shape now (this doc), migrate during
   Phase 6 (unified rollup) so the UI flips once.*
2. **Per-item objective summaries** — make `breakdown[].summary` for objectives required or leave
   optional (readiness already covers weak objectives)? *Recommend optional to start.*
3. **`flags_note`** — worth storing, or keep flags purely live? *Recommend optional; live tallies are
   enough for v1.*

---

## 11. Change policy

Additive only, like the data contract: new optional panels/fields are fine; renaming a field, changing
its meaning, or changing the breakdown-axis rule is a breaking change. **Any change here must update
both skills and the UI in the same pass**, and land a `CHANGELOG.md` entry. This doc is the single
source of truth for what the faculty rollup contains.
