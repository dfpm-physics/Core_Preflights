# Interaction Aggregation — spec (NOT YET BUILT)

**Status:** Design spec for the cohort/section **analysis aggregator** that fills the three AI
panels in the faculty lesson rollup — *AI readiness summary*, *misconception trends*, and
*AI-picked showcase quotes*. The rollup already renders these as "coming soon" placeholders and
degrades gracefully, so this layer can be built without touching the front end's data flow.

*Authored 2026-06-25 by Matthew Recker. Siblings: `INTERACTION-DATA-CONTRACT.md` (what each report
carries) and `INTERACTION-PREFILL-LINK.md`. Precedent: `/preflight-analyze` →
`assignments.analysis_report` (migration `001`).*

> **No data-contract change is required.** Every input this aggregator needs is already in
> `preflight_interaction_reports.report_data` (schema 1). This doc defines a new *output* store and
> the job that writes it — both entirely on our side.

---

## 1. The two layers (don't conflate them)

| Layer | What | Where | Status |
|---|---|---|---|
| **Per-student structured data** | One report → one `report_data` blob (effort, understanding, objectives, misconceptions, reflection, honor, flags). | Emitted by the artifact (`d=`), or reconstructed by **`/interaction-backfill`**. Stored on `preflight_interaction_reports.report_data`. | **Built.** |
| **Cohort aggregation** *(this doc)* | Many reports in one interaction × section → a class-level read: readiness narrative, misconception trends, showcase quotes. | A new **`interaction_analysis`** store, written by a new aggregator job. | **Not built.** |

The numeric rollups (effort distribution, understanding radar, per-objective histograms,
misconception **prevalence bars**, flag pills) are computed **live in the browser** from
`report_data` via `summarizeReports()` — they need **no** AI and are unaffected by this layer. This
aggregator only produces the **free-text / AI** synthesis the numbers can't give.

## 2. Goal

For each interaction (optionally narrowed to a section), produce the Just-in-Time-Teaching payoff:
a faculty member opens the rollup before class and, in one read, knows **how ready the class is and
what to address.** Concretely, three outputs:

1. **Readiness summary** — a short narrative grounded in the numbers (engagement level, where
   understanding is solid vs. shaky, what to cover first in class).
2. **Misconception trends** — which misconceptions recur, which are spreading/fading, how they
   cluster by section, and any novel ones the taxonomy missed (the AI clustering pass over
   `misconceptions[].description`/`evidence`).
3. **Showcase quotes** — a few representative/illuminating reading-reflection quotes per section,
   selected by the AI from `reading_reflection.text` (the rollup already shows a random sample;
   these replace/augment the "AI pick" rows).

**Non-goals:** it does **not** affect grades (effort is the grade, set per student); it does **not**
recompute the numeric charts (those stay live in the browser); it does **not** add fields the
artifact must send.

## 3. Inputs — all already present

The aggregator reads in-scope `preflight_interaction_reports` rows (the same rows the rollup loads).
Mapping output → source field (contract §5):

| Output | Numeric basis (no AI) | AI reads (free text) |
|---|---|---|
| Readiness summary | effort hist/avg, understanding dist, objective means, % flagged, completion | `ai_summary`, `recommended_review`, `effort_rationale` |
| Misconception trends | `misconceptions[].id`/`count`/`severity` (via `summarizeReports`) | `misconceptions[].description` / `.evidence`, `objective_key` |
| Showcase quotes | — | `reading_reflection.text` (+ `.topics`, `.sentiment`) |

Reuse `summarizeReports()` (or a server-side port of it) for all counts so the narrative agrees with
the bars the UI already shows. The AI passes are **batched, text-only** trend-spotting runs, exactly
as the contract §5 intro anticipates ("the AI only ever reads the text fields… each as a separate
batched pass").

> **Consistency caveat.** Misconception trends aggregate by `id`. They only group cleanly if reports
> reuse stable ids (the CLAUDE.md taxonomy / a per-interaction list). The AI clustering pass folds
> novel/variant ones together by `description`. (See the open decision on a misconception taxonomy on
> the `interactions` row — §8.)

## 4. Output shape

One logical record per interaction × scope. Proposed object (stored per §5):

```json
{
  "interaction_id": "lesson-02-charge",
  "section_id": "M1A",                       // or the whole-course sentinel (see §8)
  "readiness_summary": "Most of M1A engaged fully and reached attraction, but the *why* is shaky…",
  "misconception_trends": "force-superposition is the dominant gap (8/14), concentrated in…",
  "selected_quotes": [
    { "student_id": 100123, "section_id": "M1A" },
    { "student_id": 100130, "section_id": "M1A" }
  ],
  "meta": {
    "n": 14,                                 // reports the synthesis was built from
    "generated_by": "interaction-aggregate@2026-06-25",
    "source_fingerprint": "…"                // hash of the input rows → staleness check (§8)
  },
  "generated_at": "2026-06-25T14:00:00Z"
}
```

Notes:
- **Quotes store `student_id` + `section_id`, not the verbatim text or name.** The text lives in
  `report_data.reading_reflection.text`; the name comes from the roster join the rollup already does.
  This avoids duplicating PII-ish content and keeps the showcase consistent if a report is edited.
  (Alternative: store the verbatim text for stability if a student later re-submits — see §8.)
- `readiness_summary` / `misconception_trends` are Markdown-light prose (rendered with the existing
  sanitizer). Keep each to a short paragraph or a few bullets.

## 5. Storage

**Recommended: a dedicated `interaction_analysis` table** (cleaner than overloading a JSONB column;
per-section rows; straightforward RLS). Draft migration `014`:

```sql
-- 014_interaction_analysis.sql
create table public.interaction_analysis (
  interaction_id text not null references public.interactions(id) on delete cascade,
  section_id     text not null,            -- a real sections.id, or the whole-course sentinel (§8)
  readiness_summary    text,
  misconception_trends text,
  selected_quotes jsonb not null default '[]'::jsonb,   -- [{student_id, section_id}]
  meta            jsonb not null default '{}'::jsonb,
  generated_at    timestamptz not null default now(),
  primary key (interaction_id, section_id)
);
alter table public.interaction_analysis enable row level security;
-- READ mirrors preflight_interaction_reports: directors/admins of the course read all rows for
-- their course; instructors read only their own sections. WRITE is done by the scoped
-- claude_code_recker role (BYPASSRLS), never the browser — so no INSERT/UPDATE policy is needed.
```

The browser reads it with the anon key under those RLS policies (same gate as the reports). The
aggregator writes it with the scoped `claude_code_recker` DB role (the same least-privilege path the
`/interaction-backfill` skill already uses — `supabase/admin/claude_code_role.sql`).

**Alternative: `interactions.analysis_report` JSONB** keyed by section, mirroring
`assignments.analysis_report` (migration `001`, documented in CLAUDE.md). Less DDL, but mixes a
large mutable blob into the `interactions` row and needs an UPDATE RLS policy. Prefer the table.

## 6. The run (steps)

Operationally this mirrors `/interaction-backfill` and `/preflight-analyze` — a Course Director / SA
runs it from the project venv with the scoped DB role.

1. **Scope.** Pick an interaction; default to all its sections (one synthesis per section + an
   optional whole-course one).
2. **Pull** in-scope reports' `report_data` (and roster name/section) for that interaction.
3. **Numbers.** Run `summarizeReports()` (or its server port) per section → effort/understanding/
   objective/misconception/flag aggregates. These ground the prose; they are *not* re-rendered.
4. **AI passes** (batched, text-only), per section:
   - *Readiness* — summarize engagement + understanding + top gaps into "what to cover in class."
   - *Misconception trends* — cluster `description`/`evidence`, fold novel ones into known buckets,
     note section concentration and spread.
   - *Quote selection* — pick a few representative/illuminating `reading_reflection.text` entries.
5. **Write** one `interaction_analysis` row per scope (set `meta.source_fingerprint` for staleness).
6. **Verify** — open the rollup for that lesson; the three panels now render real content.

## 7. How the rollup consumes it

The consumer already exists in `app/faculty/interactions.html` (`renderAggregate` → `aggregateHTML`);
wiring is additive:

| Panel (current placeholder) | Builder today | Reads when available |
|---|---|---|
| **AI readiness summary** | `aiPlaceholder()` | `interaction_analysis.readiness_summary` |
| **Misconceptions** | `mcBars()` (live bars) **+** `aiPlaceholder()` (trend prose) | bars stay live; trend prose ← `misconception_trends` |
| **Student responses** | `responsesSection()` (random sample) | "AI pick" rows ← `selected_quotes` (resolve text/name from `report_data` + roster) |

Load the `interaction_analysis` row for the chosen scope alongside the existing
`loadInteractionData()` call; pass it into `aggregateHTML`. **Graceful degradation is the contract:**
no row → today's behavior (placeholders + random quotes). A row present but stale (fingerprint
mismatch) → show it with a quiet "may be out of date" note.

## 8. Open design decisions (decide before building)

1. **Scope unit — per-section, whole-course, or both?** *Recommend both:* per-section rows (match the
   instructor mental model and the `analysis_report` `by_instructor` precedent) **plus** one
   whole-course row for the rollup's "All sections" scope. Needs a sentinel `section_id` (e.g.
   `'__all__'`) or a nullable `section_id` with a partial unique index. Pick one.
2. **Storage — table vs. `interactions.analysis_report` JSONB.** Recommend the table (§5).
3. **Quotes — store ids or verbatim text?** Ids (recommended: no duplication, always fresh) vs.
   verbatim (stable if the student re-submits, but can go out of sync). 
4. **Misconception panel split.** Keep the live prevalence **bars** (numeric, no AI) as the primary
   view and the AI **trend prose** as a secondary block under it? (Current build already does this.)
   Or also offer a topics word-cloud from `reading_reflection.topics`?
5. **Staleness / regeneration.** Reports can change (re-submit, backfill). Use
   `meta.source_fingerprint` (hash of input rows) to flag a stale analysis; decide whether
   regeneration is manual (rerun the skill) or nudged in the UI.
6. **Who runs it / how it's packaged.** A *new* skill (e.g. `/interaction-aggregate`) vs. a second
   mode on `/interaction-backfill`. Recommend a separate skill — backfill is per-student repair,
   aggregation is cohort synthesis; the `interaction-backfill` description already calls the
   aggregator "a separate, future skill."
7. **Misconception id consistency.** Optionally pin a misconception **taxonomy** on the `interactions`
   row (`[{id,label}]`, parallel to the objectives recommendation in contract §9) so ids aggregate
   cleanly without leaning on the AI clustering pass. Additive; no contract break.

## 9. Relationship to existing pieces

- **Inputs:** `INTERACTION-DATA-CONTRACT.md` §5 (no changes needed).
- **Per-student data:** `/interaction-backfill` must have populated `report_data` first (else there's
  nothing to aggregate).
- **Numbers:** reuse `summarizeReports()` (`app/js/faculty-interactions.js`) — single source of truth
  so prose and bars agree.
- **Precedent:** `/preflight-analyze` → `assignments.analysis_report` (the assignment-path analog);
  this is the interaction-path version, with its own store.
- **Access path:** the scoped `claude_code_recker` role + project venv already used by
  `/interaction-backfill`.
