# Interaction Data Contract — v1 (LOCKED)

**Status:** Version 1. Frozen. Do not change the endpoint URL, the hash keys, or the
meaning of any `schema: 1` field without bumping to `schema: 2` (see §8). Additive,
optional fields are allowed within v1; everything else is a breaking change.

*Authored 2026-06-23 by Matthew Recker. Companion to `INTERACTION-PREFILL-LINK.md`.*

*v1 clarification — 2026-06-25 (Matthew Recker): sharpened `honor.status` to judge the **appropriateness**
of help (not mere disclosure) and `flags.notable` to mean **exemplary** work. No endpoint, hash-key, type,
or wire-format change — `schema` stays `1`. See §5.6, §5.8, §9.*

*v1 clarification — 2026-07-28 (Matthew Recker via Claude): **`d` is now REQUIRED of producers.** It was
written as "recommended" when nothing downstream depended on it; three things now do, and a report without
it is not gradable (§3, §7). Also: §7 rewritten against the `app` receiver that went live at the promotion —
it described the retired `preflight_interaction_reports` path, including a "re-submitting overwrites" rule
that is **no longer true**. Endpoint, hash keys, codec, and every `schema: 1` field meaning are unchanged;
`schema` stays `1`. **Nothing in a deployed artifact breaks** — the receiver still accepts a `d`-less
report, it just cannot grade it.*

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
https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html
```

This URL is **part of the contract and does not change.** Artifacts hardcode it; the receiver's
source location and internals may evolve, but the public URL and payload format below are frozen.

Note the path is `student` — **singular**. It matches the app tree exactly, and that is the whole
point. Until 2026-07-28 `site/student/interaction-submit.html` was a stub forwarding into
`site/app/student/interaction-submit.html`; the promotion moved the app tree up so the real page
landed on exactly this path, overwriting the stub. **That happened, and nothing needed editing** —
the URL is byte-identical before and after, which is what this paragraph was insurance for. A
one-character drift here (`students/`) would have broken the endpoint at precisely the moment it
was supposed to keep working.

> **Re-verified after the promotion, 2026-07-28.** Three things were checked rather than assumed,
> because the cost of any one of them being wrong is a student doing the work and losing it:
> the real receiver is on disk at `site/student/interaction-submit.html` (not a stub, not
> `site/app/`); the URL above matches it character for character; and the reference artifact
> (`.ai/artifacts/examples/lesson02_artifact.jsx`) builds its submit URL from that same string.
> They agree. **The endpoint needs no change and must not be given one.**

> **No legacy redirect.** The original endpoints — root `artifact-submit.html` and
> `interaction-submit.html`, plus their `site/` counterparts — were **retired, not aliased**, in a
> deliberate clean break on 2026-07-16 (all live artifacts were rebuilt against this URL before
> Fall 2026). Those URLs now 404. Source is kept for reference in
> `_archive/artifact-receiver-v1/`. **Any artifact still pointing at the old URL silently loses
> the student's report** — it is not redirected. If you are reviving an old artifact, update its
> submit URL first.

Why a static page and not an API: GitHub Pages is static and cannot accept a POST. The page
receives the payload in the **URL hash**, decodes it client-side, and writes to Supabase
using the logged-in student's session. The hash (`#…`) is used instead of a query string
(`?…`) because hash fragments are never sent to servers or written to access logs.

---

## 3. Transport — URL format

The artifact navigates the browser to the receiver with a hash payload built from
`&`-joined, `key=value` pairs (parsed receiver-side with `URLSearchParams`):

```
site/student/interaction-submit.html#t=interaction&i=<slug>&r=<lz>&d=<lz>
```

| Key | Required | Contents |
|---|---|---|
| `t` | no (default `interaction`) | **Artifact type.** Reserved so this one endpoint can serve future artifact kinds. v1 defines only `interaction`; the receiver treats a missing `t` as `interaction`. |
| `i` | **yes** | The interaction **slug** — must equal an existing `activities.slug`. **Generated fresh per offering; see §3.2.** The one manual coordination point with the director (see `INTERACTION-PREFILL-LINK.md`). |
| `r` | **yes** | The **full report**, Markdown, compressed (see codec). Always sent — the human-readable transcript is never dropped. |
| `d` | **yes** | The **structured data** (§5), `JSON.stringify`'d then compressed. See below — this was "recommended" until 2026-07-28. |
| `v` | no | **Transport marker.** Added 2026-08-20; additive under §8, so this is still v1. Names the build that produced the report, for artifacts this repository generates and can therefore update — today only `v=gemini`, written by `scripts/artifacts/to_gemini.py`. A published claude.ai artifact sends nothing, and **that absence is the point**: it is what makes a backup submission separable afterwards without touching the four frozen keys or the artifacts already deployed. The receiver sanitises it to a short slug (the hash is student-controllable) and stores it as `submission_activities.content.transport`, merged over the `d` object and never in place of a null. |

### 3.1 Send both. `r` alone is not a submission that works.

**A report with `r` and no `d` reaches the database and earns nothing.** That is not a policy
decision; it is what the pipeline does, and it is worth spelling out because "optional" invited
exactly the artifact that omits it:

1. **No grade.** The receiver stores `d` as `submission_activities.content`, and the auto-grade
   trigger (`015_interactive_autograde.sql`) reads `content->'effort'` to write the grade. Absent
   `d`, `content` is null, the trigger returns without writing, and the student's committed
   submission sits ungraded until a human opens the transcript and scores it by hand.
2. **No cohort rollup.** `/lesson-aggregate` folds the `schema: 1` assessment from
   `submission_activities.content` for artifact takers. Without it the student contributes nothing
   to the readiness summary, the misconception bars, or the class numbers — they are invisible in
   the analysis while being visibly present on the roster, which is the worst of both.
3. **No diagnostics anywhere.** Understanding, misconceptions, flags, the reflection judgment: all
   of it lives in `d`. `r` carries the same material as prose a human can read, and nothing can
   read prose at cohort scale without an AI pass nobody has budgeted.

The repair path exists (`/interaction-backfill` reconstructs `schema: 1` from `report_markdown`)
and is **not** a substitute: it is an AI re-reading of a report the artifact had already assessed,
run after the fact, against a document written for humans. **Every Fall 2026 interactive submission
before this date got its structured data that way**, because the reference artifact
(`.ai/artifacts/examples/lesson02_artifact.jsx`) built its submit URL from `t`, `i` and `r` only —
the omission this section exists to prevent from recurring.

The receiver still **accepts** a report with no `d`, and that is not changing: an artifact deployed
before this clarification must not start failing, and a payload problem must never cost a student
their work (§7). "Required" here binds the producer, not the receiver.

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

### 3.2 The `i` slug is generated per offering, and never reused (added 2026-07-28)

**Rule for whoever builds the artifact:**

> The `#i=` slug must be **globally unique and used in exactly one course offering**. Build it as
> `<readable-stem>-<8 random lowercase hex>`, e.g. `lesson-02-charge-a3f9c1e2`. Characters `a-z`,
> `0-9`, `-` only. Generate the suffix **once per artifact build** and write that identical string
> into both the artifact's `#i=` and the prefill link's `id=`. **Never reuse a slug from a previous
> term** — a lesson rebuilt for a new offering gets a new suffix.

**Why.** `activities.slug` is globally `UNIQUE`, and until now the same readable slug
(`lesson-02-charge`) was reused across terms — so one `activities` row was shared by every offering
that ran the lesson. Every student report from every term hung off that one row, which made
replacing a rebuilt artifact a cross-term delete: the director editing Fall 2026 was one confirm
away from destroying the sandbox's reports too, and the lock trigger's refusal was the only thing
stopping it. A per-offering slug makes each term's lesson its own row, so nothing a director does
in one term can reach another.

**The trade this accepts:** one artifact can no longer serve two terms. Rebuild it, or ask the chat
that produced it to re-issue with a fresh suffix.

**The written modality needs nothing here.** Its `activities.slug` is minted by the site
(`mintWrittenSlug()`), is never typed by a human, and nothing external references it — so it took
the same random suffix on 2026-07-28 with no coordination and no contract implications.

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

`honor`: object. **Judge the *appropriateness* of any help, not the mere fact that help was disclosed.**
Collaboration USAFA permits — e.g. talking through ideas with a classmate *before* starting, or using
allowed references — is encouraged and is **not** an integrity issue: record it as `none`. Only escalate
genuinely inappropriate assistance.

| Field | Type | Req | Notes |
|---|---|---|---|
| `status` | `"none"`\|`"disclosed"`\|`"concern"`\|null | no | See the value definitions below. |
| `note` | string \| null | no | Free text; only meaningful when `status` is `disclosed`/`concern`. (AI input when present) |

**`status` values:**

| Value | Meaning | Surfaced to faculty as |
|---|---|---|
| `none` | No improper help — **including appropriate collaboration** (peer discussion beforehand, permitted resources). The default; not flagged. | — |
| `disclosed` | The student used or revealed **inappropriate help or resources**: another AI assistant open and helping, a solutions key, or other disallowed materials. | "Inappropriate resources" |
| `concern` | A suspected **integrity problem in the conversation itself**: the student tried to manipulate or harass the AI into inflating the report or gaming the effort grade, or pasted content not their own. | "Integrity concern" |
| `null` | Integrity was not asked about. | — |

> **v1 clarification (2026-06-25).** Earlier wording defined `disclosed` as neutral "disclosed outside/AI
> help." It now specifically means *inappropriate* help/resources, and appropriate collaboration is `none`.
> This sharpens guidance on *when* to use each existing value — the enum, types, and wire format are
> unchanged, so it remains `schema: 1`.

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
| `needs_follow_up` | bool | no | Surface this student for instructor attention (low effort or weak understanding). |
| `notable` | bool | no | **Exemplary** work worth showcasing — the strongest understanding or a notable extension beyond the objectives. (Positive standouts only; use `needs_follow_up` for the other direction.) |
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

  "flags": { "needs_follow_up": true, "notable": false,
             "note": "Full effort; revisit force superposition." }
}
```

This student earns **full effort credit** (effort 5 → 2 points): engaged, completed, answered
everything, and gave a meaningful reflection — despite a major misconception, exactly the
intended grading behavior.

---

## 7. Receiver behavior (what the site guarantees)

> **Rewritten 2026-07-28.** This section described the retired `public` receiver — the
> `preflight_interaction_reports` table, a `report_data` column, and a `score` trigger — none of
> which the live page has used since the `app` receiver replaced it. The **wire format it
> documents is unchanged**; where the bytes land, and what happens next, are not. The old text
> also stated "re-submitting overwrites", which is now false in the case that matters (step 6).

1. Parse the hash; read `t` (default `interaction`), require `i` and `r`. Decompress `r`/`d`
   with lz-string. The payload is stashed in `sessionStorage` *before* any module runs, so a
   sign-in round trip cannot discard a finished lesson.
2. Resolve `i` — an `activities.slug`, globally unique for exactly this reason — to the activity
   and to the offering scheduled for **this** student. Require a logged-in student session and
   take `student_id` from it, never from the payload.
3. If `d` is present: decompress + `JSON.parse`. If the JSON is malformed, **store it raw** under
   `{ "_unparsed": "…" }` and continue — a payload problem must never cost a student their work.
   An unknown `schema` is stored as-is for the same reason.
4. **Nothing is written until the student clicks Submit.** The page renders the report first; the
   artifact has no concept of submission.
5. On Submit, upsert `submission_activities` (`submission_id`, `activity_id`, `report_markdown`,
   `content` = the `d` object, `payload_bytes`), then commit the submission by setting
   `chosen_activity_id`. `content` is where `d` lands, and it is what the auto-grade trigger and
   `/lesson-aggregate` both read (§3.1).
6. **The grade is written server-side, immediately, and is final.** A committed submission whose
   chosen activity is interactive and `grading_role='graded'` fires
   `grade_interactive_on_commit()` (migration 015), which copies `effort` onto a finalized
   `grades` row — re-applying the §5.2 reflection cap itself, because the effort rode in a hash
   the student controls. A `practice` path records the report and grades nothing.
7. **Re-submitting does NOT overwrite, on the path that counts.** Because step 6 finalizes the
   grade, both the page and the data layer refuse a second report for that offering: the first
   submitted report is the one that stands, and only an instructor reopening the grade changes
   that. A `practice` submission has no finalized grade, so re-running it does replace the stored
   report. (Under the retired receiver every re-submission overwrote; artifacts that tell students
   "you can always resubmit" are wrong and should stop.)
8. Render the report sanitized (DOMPurify), never executed.

The website's rollup layer treats `d` defensively: it coerces/ignores out-of-range or
wrong-typed values (the data is LLM-produced and will occasionally be imperfect) and averages
over non-null values only. An interactive grade is **auto-final rather than instructor-confirmed**
— effort *is* the grade and there is nothing for a human to decide — but it is not unauditable:
`source='derived'` marks how it was written, `r` is the transcript, and an instructor can reopen
it from the Grade tab if a report looks tampered.

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

- **The URL is as un-revisable as the schema** — it's hardcoded in every deployed artifact, and a
  wrong one fails *silently* (the student does the work, then loses it). Treat
  `site/student/interaction-submit.html` as frozen. It survives the app promotion by construction
  (§2), so there is no reason to move it again.
  - The one escape hatch is the one used on 2026-07-16: rebuild **every** live artifact against a
    new URL during a gap between semesters, then retire the old one. That only worked because
    there were three artifacts and three weeks. It is not available mid-semester, and it scales
    with the number of deployed artifacts — assume you get to do it approximately never.
- **Reserved `t=` key** lets this single endpoint serve future artifact types (a different
  lesson format, a survey, a lab) without minting a new URL or breaking old artifacts.
- **Effort integrity.** Because `effort` *is* the grade and the payload is student-controllable
  in principle, three safeguards: (a) `r` keeps the transcript for instructor verification,
  (b) points are trigger-derived from `effort` server-side, so a student can't post a score
  independent of effort, and (c) the §5.2 reflection cap is re-applied in the database, not
  trusted from the payload. Effort tampering itself is possible but auditable against `r`.
- **Always populate the triage signals.** They drive the faculty rollup's flag pills with no AI pass, but
  they're optional — a report only shows a flag if the artifact set it. Emit `flags.needs_follow_up` /
  `flags.notable` (§5.8), `honor.status` (judged by the appropriateness rule in §5.6), and
  `reading_reflection.meaningful` (§5.5) on every report. The website can fall back to deriving
  `needs_follow_up`/`notable` from effort + understanding, but `honor` and reflection `meaningful` are the
  artifact's call alone — there is no numeric proxy for them.
- **Define objectives on the `interactions` row** (a small `objectives` JSONB: `[{key,label}]`)
  so objective keys are consistent across students and the website knows the full set even for
  objectives no student reached. Inline `label`s mean the system still works if you skip this.
- **Don't trust artifact timestamps for ordering** — use the server's `created_at`.
  `duration_min` is fine as a self-reported metric.
- **Reflection lives in two places by design:** verbatim in `r` (human view) and in
  `reading_reflection.text` (clean machine input). The artifact should put the same text in
  both; the trend process reads only the structured field.

---

## 10. Producer checklist

*Added 2026-07-28. Everything here is stated somewhere above; this is the list to run down before a
lesson artifact goes to students, because the failure mode for most of it is silent.*

The worked reference is [`.ai/artifacts/examples/lesson02_artifact.jsx`](../../.ai/artifacts/examples/lesson02_artifact.jsx),
which sends both keys and hides the payload block from the cadet. Build from it rather than from
memory.

1. **Submit URL is exactly the §2 string.** Copy it; do not retype it. A wrong URL fails silently —
   the cadet does the work, then loses it.
2. **`i=` is the lesson's `activities.slug`**, the same string the director created. A slug that
   does not exist cannot be resolved to an assignment and the report cannot be saved.
3. **Send `d`, every time (§3.1).** The single most common defect, and the one that produced a
   whole term of ungradable submissions. `r` alone earns the cadet nothing.
4. **The payload is not shown to the cadet.** Strip the block from the Markdown before rendering it
   *and* before compressing it into `r`; it should exist only in `d`.
5. **`effort` is engagement, not correctness (§5.2)**, and the reflection cap is applied by the
   artifact as well as by the server. If the two disagree the server wins, which means the cadet
   sees a grade the artifact did not predict.
6. **`null` for not-assessed, `0` for assessed-and-lowest (§5.1).** Writing `0` for a topic never
   reached fabricates data and drags the class average.
7. **`honor.status`, `flags.*`, `reading_reflection.meaningful` on every report (§9).** No numeric
   proxy exists for the first and last; nothing can recover them afterwards.
8. **Tell the cadet the truth about resubmission.** On a graded lesson the first submitted report
   is the only one — the grade is finalized on commit (§7 step 7). An artifact that says "you can
   always resubmit" is wrong.
9. **Over-capture (§8).** A deployed artifact cannot be revised. A field you might want is free
   now and impossible later.
