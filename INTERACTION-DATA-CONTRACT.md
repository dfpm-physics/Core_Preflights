# Interaction Data Contract — v1 (LOCKED)

**Status:** Version 1. Frozen. Do not change the endpoint URL, the hash keys, or the
meaning of any `schema: 1` field without bumping to `schema: 2` (see §8). Additive,
optional fields are allowed within v1; everything else is a breaking change.

*Authored 2026-06-23 by Matthew Recker. Companion to `INTERACTION-PREFILL-LINK.md`.*

This is the contract between a **claude.ai lesson artifact** (the producer) and this
repository's **static receiver** (the consumer). A Claude artifact runs a Just-in-Time
Teaching (JiTT) conversation with a student, then hands the result back to the site by
opening the receiver URL with a payload in the URL hash. Lock this down and artifacts built
today keep working forever — including across the `app/` refactor going live.

---

## 1. The grading model (read this first)

**Effort is the grade.** The assignment is graded on *engagement*, not correctness.

- A student who works through the whole conversation but understands nothing → **full marks**.
- A student who refuses to engage, goes on random tangents, or dodges questions → **very low**.
- **Reading-reflection gate:** the reading reflection is a required, graded part of the
  conversation. If the student does not *meaningfully* respond to it, effort is capped (§5.2) —
  no matter how strong the rest of the conversation was.

Everything else the artifact reports — understanding levels, misconceptions, narrative
summaries — is **diagnostic only**: it tells the instructor which concepts are landing and
feeds the trend rollups, but it does **not** affect the grade. The contract marks each field
`GRADED` or `DIAGNOSTIC` so the artifact author calibrates correctly.

---

## 2. The static endpoint (permanent)

```
https://dfpm-physics.github.io/Core_Preflights/artifact-submit.html
```

This URL is **part of the contract and never changes.** `artifact-submit.html` lives at the
repository root and is **excluded from the `app/` refactor** — when the refactored site is
promoted to root, this file stays exactly where it is. Artifacts hardcode this URL; the
receiver's internals may evolve, but the URL and payload format below are frozen.

> **Legacy alias:** the original receiver `interaction-submit.html` remains at the root as a
> permanent hash-preserving redirect to `artifact-submit.html`, so any artifact deployed
> before the rename keeps working. New artifacts target `artifact-submit.html`.

Why a static page and not an API: GitHub Pages is static and cannot accept a POST. The page
receives the payload in the **URL hash**, decodes it client-side, and writes to Supabase
using the logged-in student's session. The hash (`#…`) is used instead of a query string
(`?…`) because hash fragments are never sent to servers or written to access logs.

---

## 3. Transport — URL format

The artifact navigates the browser to the receiver with a hash payload built from
`&`-joined, `key=value` pairs (parsed receiver-side with `URLSearchParams`):

```
artifact-submit.html#t=interaction&i=<slug>&r=<lz>&d=<lz>
```

| Key | Required | Contents |
|---|---|---|
| `t` | no (default `interaction`) | **Artifact type.** Reserved so this one endpoint can serve future artifact kinds. v1 defines only `interaction`; the receiver treats a missing `t` as `interaction`. |
| `i` | **yes** | The interaction **slug** — must equal an existing `interactions.id` (e.g. `lesson-02-charge`). The one manual coordination point with the director (see `INTERACTION-PREFILL-LINK.md`). |
| `r` | **yes** | The **full report**, Markdown, compressed (see codec). Always sent — the human-readable transcript is never dropped. |
| `d` | recommended | The **structured data** (§5), `JSON.stringify`'d then compressed. Optional so older artifacts that predate `d` still submit cleanly. |

**Compression codec (exact):** lz-string 1.5.0 —
`LZString.compressToEncodedURIComponent(text)` on the producer side,
`LZString.decompressFromEncodedURIComponent(value)` on the receiver. This is URL-safe; do
not additionally `encodeURIComponent` it.

**The student identity is NOT in the payload.** The receiver resolves `student_id` from the
authenticated Supabase session. An artifact must never send a student id, name, or email —
it would be ignored, and RLS rejects any write that doesn't match the logged-in student.

**Size budget:** `r` ≤ 100 KB raw (enforced by a DB `CHECK`). `d` ≤ 32 KB raw (also enforced);
keep arrays bounded (≤ 25 misconceptions, ≤ 20 objectives, ≤ 12 topics).

---

## 4. `r` — the full report (kept, unchanged)

`r` carries the complete Markdown report the artifact produces (Cadet Information header,
reading reflection, integrity self-report, concept-by-concept assessment, etc.). It remains
the canonical human-readable artifact shown in the per-student report viewer, and the surface
an instructor uses to verify a grade. Stored verbatim and **sanitized only at render time**
(DOMPurify) — never executed. Name + student ID + score are **not treated as PII**, so the
report is stored and displayed as-is; no redaction is performed.

---

## 5. `d` — structured data (schema 1)

A single JSON object. Only `schema` and `effort` are required; every other field is optional
and the receiver tolerates its absence. Consumers **ignore unknown fields** (forward
compatibility) and the **website computes all numeric rollups from these fields without AI** —
the AI only ever reads the text fields (misconception `description`/`evidence`, the reflection
`text`, the narrative fields, an honor `note`), each as a separate batched trend-spotting pass.

### 5.1 Conventions

- **Scales are 0–5 integers.** Effort uses the engagement rubric in §5.2; understanding uses
  0 = not demonstrated, 1–2 = misconception/struggling, 3 = partial, 4–5 = solid.
- **`null` ≠ `0`.** `null` means "not assessed" (omit it from averages); `0` means "assessed,
  none/lowest." Unattempted objectives must be `null`, never `0`, or they drag down means.
- **Self-describing entries.** Every objective and misconception carries its own `label`
  (and misconceptions a `description`) inline, so no consumer needs the short-code dictionary
  to interpret a key. A misconception not in the known taxonomy is allowed — just label it.
- **Empty, not null, for lists.** Use `[]` when there are none.

### 5.2 Effort — `GRADED`

| Field | Type | Req | Notes |
|---|---|---|---|
| `effort` | int 0–5 | **yes** | The grade-bearing score. **Measures engagement, not correctness.** The artifact applies the reflection cap below when computing it. |
| `effort_rationale` | string | no | One line on *why* this score — lets instructors sanity-check the grade without reading the transcript. |
| `completed` | bool | no | Did the student reach the end of the intended conversation flow? Independent of effort. |
| `duration_min` | number | no | Self-reported minutes of conversation. |
| `message_count` | int | no | Number of student turns. |

**Effort rubric (engagement, correctness irrelevant):**

| Score | Behavior |
|---|---|
| 5 | Sustained, genuine engagement — worked through the whole conversation, answered the questions asked, responded to follow-ups. *Being wrong does not lower this.* |
| 4 | Solid engagement, minor lapses (a skipped sub-question, a brief tangent). |
| 3 | Partial — engaged but cut short, terse, or intermittently off-task. |
| 2 | Minimal — short, low-content answers; frequent tangents. |
| 1 | Token effort — one-word dodges, mostly evasive or off-task. |
| 0 | Refused to engage; no substantive participation. |

**Reading-reflection gate (hard cap).** The artifact must separately assess the reading
reflection. **If the student does not meaningfully respond to the reading reflection,
`effort` may not exceed 2**, regardless of engagement elsewhere. "Meaningful" is about
substance, not length — a few genuine sentences clear the bar; a skipped, one-word, copied,
or non-responsive reflection does not. Record the judgment in `reading_reflection.meaningful`
(§5.5) so the cap is auditable.

**Effort → points (auto-populated by the site).** The grade is a 0–2 point score derived from
`effort`; the artifact does not send points.

| `effort` | points |
|---|---|
| 3, 4, 5 | 2 |
| 1, 2 | 1 |
| 0 or `null` | 0 |

A non-meaningful reflection (effort ≤ 2) therefore earns at most 1 point — i.e. the reflection
is required for full credit. The site stores this in `preflight_interaction_reports.score`
(derived by a DB trigger on every write, so it can't be set independently of `effort`).

### 5.3 Understanding — `DIAGNOSTIC` (not graded)

| Field | Type | Req | Notes |
|---|---|---|---|
| `overall_understanding` | int 0–5 \| null | no | Holistic read across the lesson. |
| `self_rated_understanding` | int 0–5 \| null | no | The student's *own* confidence. The gap vs. assessed understanding is a useful cohort signal. |
| `objectives` | array | no | Per learning objective: `{ key, label, understanding, confidence? }`. `key` should match the objective keys defined on the `interactions` row; `label` is included so the AI aggregator never needs a lookup. `understanding` and `confidence` are 0–5 or `null`. |

### 5.4 Misconceptions — `DIAGNOSTIC`, self-describing

`misconceptions`: array of objects. Website counts them by `id`; the AI clustering pass reads
`description`/`evidence` to spot patterns and fold novel ones into known buckets.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | string | yes | Stable-ish key (e.g. `forces-cancel`). May be a new key the artifact coins for a misconception not in the taxonomy. |
| `label` | string | yes | Human-readable name — **required so no dictionary lookup is needed.** |
| `description` | string | yes | One sentence stating the wrong belief. (AI input) |
| `objective_key` | string | no | Which objective this undermines. |
| `severity` | `"major"` \| `"minor"` | no | |
| `evidence` | string | no | Short quote/paraphrase from the conversation. (AI input) |

### 5.5 Reading reflection — `DIAGNOSTIC` text (+ grade gate)

`reading_reflection`: object. The verbatim reflection also lives inside `r`; this field is the
**clean, canonical input for the separate reflection-trend process** so it never has to parse
Markdown. `meaningful` additionally feeds the effort cap in §5.2.

| Field | Type | Req | Notes |
|---|---|---|---|
| `text` | string | no | Verbatim reflection. (AI input) |
| `meaningful` | bool | no | The artifact's judgment of whether the reflection met the substance bar. When `false`, effort is capped at 2 (§5.2). |
| `engagement` | int 0–5 \| null | no | How substantive the reflection was. |
| `topics` | string[] | no | Short topic tags for numeric rollup (e.g. `["conductors","chemistry-connection"]`). |
| `sentiment` | `"positive"`\|`"neutral"`\|`"negative"`\|`"mixed"` | no | |

### 5.6 Academic integrity

`honor`: object.

| Field | Type | Req | Notes |
|---|---|---|---|
| `status` | `"none"`\|`"disclosed"`\|`"concern"`\|null | no | `none` = declared no improper help; `disclosed` = disclosed outside/AI help; `concern` = artifact flags a possible issue; `null` = not asked. |
| `note` | string \| null | no | Free text; only meaningful when `status` is `disclosed`/`concern`. (AI input when present) |

### 5.7 AI narrative — `DIAGNOSTIC` text

Short model-written prose for quick instructor scanning and the trend passes.

| Field | Type | Req | Notes |
|---|---|---|---|
| `ai_summary` | string | no | 1–2 sentence summary of the whole session — drives the report-list scan view without opening the full transcript. |
| `key_strengths` | string | no | What the student did well (positive call-outs). |
| `recommended_review` | string | no | What the student should revisit. |

### 5.8 Triage flags

`flags`: object. Powers per-student call-outs in the report list with no AI pass.

| Field | Type | Req | Notes |
|---|---|---|---|
| `needs_follow_up` | bool | no | Surface this student for instructor attention. |
| `notable` | bool | no | Worth highlighting (either direction). |
| `note` | string | no | One-line reason for the flag. |

### 5.9 Meta

| Field | Type | Req | Notes |
|---|---|---|---|
| `schema` | int | **yes** | Contract version. `1` for this document. |
| `producer` | string | no | Artifact id + version (e.g. `lesson-02-charge@2026-06`) — invaluable for debugging a cohort-wide anomaly later. |

---

## 6. Complete example

```json
{
  "schema": 1,
  "producer": "lesson-02-charge@2026-06",

  "effort": 5,
  "effort_rationale": "Engaged throughout, answered every prompt, asked two follow-ups, gave a substantive reflection.",
  "completed": true,
  "duration_min": 9,
  "message_count": 14,

  "overall_understanding": 3,
  "self_rated_understanding": 4,
  "objectives": [
    { "key": "coulomb-magnitude",  "label": "Coulomb's law — magnitude & inverse-square", "understanding": 2, "confidence": 3 },
    { "key": "conductor-insulator", "label": "Conductors vs. insulators (free electrons)",  "understanding": 4, "confidence": 4 }
  ],

  "misconceptions": [
    { "id": "forces-cancel",
      "label": "Forces cancel on the conductor",
      "description": "Believes the attractive and repulsive forces on the conductor sum to zero.",
      "objective_key": "coulomb-magnitude",
      "severity": "major",
      "evidence": "\"the pushes and pulls would even out\"" }
  ],

  "reading_reflection": {
    "text": "I found it interesting that whether a material conducts is related to how free its electrons are. I'm into chemistry, so that was a cool connection.",
    "meaningful": true,
    "engagement": 5,
    "topics": ["conductors", "chemistry-connection"],
    "sentiment": "positive"
  },

  "honor": { "status": "none", "note": null },

  "ai_summary": "Fully engaged, substantive reflection; solid on materials but holds a force-superposition misconception.",
  "key_strengths": "Strong intuition connecting conductivity to electron mobility.",
  "recommended_review": "Vector addition of Coulomb forces — why opposing forces don't cancel.",

  "flags": { "needs_follow_up": true, "notable": true,
             "note": "Full effort; revisit force superposition." }
}
```

This student earns **full effort credit** (effort 5 → 2 points): engaged, completed, answered
everything, and gave a meaningful reflection — despite a major misconception, exactly the
intended grading behavior.

---

## 7. Receiver behavior (what the site guarantees)

1. Parse the hash; read `t` (default `interaction`), require `i` and `r`. Decompress `r`/`d`
   with lz-string.
2. Verify `i` matches an `interactions.id` (FK). Require a logged-in student session; resolve
   `student_id` from it (never from the payload).
3. If `d` is present: decompress + `JSON.parse`. If `schema` is unknown or the JSON is
   malformed, **store it raw in `report_data` anyway** and continue — never block the
   submission on structured-data problems. Write `report_data` and copy `d.effort` into the
   `effort` column.
4. Upsert into `preflight_interaction_reports` (`student_id`, `interaction_id`,
   `report_markdown`, `report_data`, `effort`, `payload_bytes`), unique on
   `(student_id, interaction_id)` — **re-submitting overwrites** the previous row. The `score`
   column (0–2) is derived from `effort` by a DB trigger on every write, so it can't be set
   independently of effort.
5. Render the report sanitized (DOMPurify), never executed.

The website's rollup layer treats `d` defensively: it coerces/ignores out-of-range or
wrong-typed values (the data is LLM-produced and will occasionally be imperfect) and averages
over non-null values only. Final grades remain **instructor-finalized** — the artifact's
`effort` is the auto score the instructor confirms, and `r` is the transcript they verify it
against.

---

## 8. Versioning & stability policy

- **Frozen forever:** the endpoint URL, the hash keys (`t`/`i`/`r`/`d`), the lz-string codec,
  and the meaning of every `schema: 1` field.
- **Allowed within v1 (additive only):** new *optional* fields. Consumers ignore unknown
  fields, so a newer artifact and an older receiver (or vice-versa) coexist. Note an additive
  field only reaches reports from artifacts built *after* it's added — you cannot backfill
  deployed artifacts.
- **Breaking changes** (renaming a field, changing a field's meaning or type, removing one,
  or repurposing the grade rule) require `schema: 2` and a new revision of this document. The
  receiver keeps a `schema: 1` path so old artifacts never break.
- **Therefore: over-capture now.** Because deployed artifacts can't be revised, include any
  field you *might* want, even if the website ignores it at first. Adding a field is free;
  retrofitting it into already-published artifacts is impossible.

---

## 9. Design notes & recommendations

- **The URL is as un-revisable as the schema** — it's hardcoded in every deployed artifact.
  Treat `artifact-submit.html` as frozen; keep `interaction-submit.html` as a redirect alias
  for anything already deployed.
- **Reserved `t=` key** lets this single endpoint serve future artifact types (a different
  lesson format, a survey, a lab) without minting a new URL or breaking old artifacts.
- **Effort integrity.** Because `effort` *is* the grade and the payload is student-controllable
  in principle, two safeguards: (a) `r` keeps the transcript for instructor verification, and
  (b) `score` is trigger-derived from `effort` server-side, so a student can't post a score
  independent of effort. Effort tampering itself is possible but auditable against `r`.
- **Define objectives on the `interactions` row** (a small `objectives` JSONB: `[{key,label}]`)
  so objective keys are consistent across students and the website knows the full set even for
  objectives no student reached. Inline `label`s mean the system still works if you skip this.
- **Don't trust artifact timestamps for ordering** — use the server's `created_at`.
  `duration_min` is fine as a self-reported metric.
- **Reflection lives in two places by design:** verbatim in `r` (human view) and in
  `reading_reflection.text` (clean machine input). The artifact should put the same text in
  both; the trend process reads only the structured field.
