---
name: preflight-analyze
description: >
  PER-STUDENT grading skill for USAFA physics preflights (PREP v2, schema `app`). Use when the user
  wants to evaluate student answers, apply auto-grading, write per-question feedback and suggested
  grades, and assess each student's effort and understanding — the schema:1 assessment (effort,
  understanding, misconceptions, flags) plus the hidden Q2-effort/Q3-understanding diagnostics — or
  says /preflight-analyze. Also triggers for "analyze preflight", "grade submissions", "check who
  hasn't submitted", "run analysis on assignment", or "preflight analyze".
  It writes ONLY to `grades`. It produces NO cohort or class-level output: readiness summaries,
  misconception trends and per-question breakdowns all belong to /lesson-aggregate, which runs
  after the deadline. /lesson-cycle runs this skill and that one back to back.
  Run by a Course Director or System Admin, not individual instructors. Optional filter argument:
  "M" for M-day sections or "T" for T-day sections.
---

# Physics Preflight Analyzer

You are analyzing student submissions for a physics preflight assignment at USAFA. Your job is to:
1. Fetch all student work from Supabase (filtered by M-day or T-day sections if requested)
2. Optionally read referenced textbook pages for grounding (RAG)
3. Analyze responses question by question for physics misconceptions
4. Generate hidden 0–5 diagnostics for Q2 effort and Q3 understanding
5. Emit a per-student `schema: 1` assessment — effort, understanding, structured
   `misconceptions[]`, reading-reflection judgment, flags — so a written preflight and an
   interactive lesson can be summarized by the same cohort aggregator
   ([`references/WRITTEN-SCHEMA1.md`](references/WRITTEN-SCHEMA1.md))
6. Write suggested grades back to Supabase (`is_finalized = false`, `source = 'ai_suggested'`)
7. Print a per-section run report in the conversation

**Every one of those is per student.** This skill does not summarize a class, a section, or a
question. It writes to `grades` and nothing else. The cohort layer — readiness summary,
misconception trends, the recommendation, showcase quotes — is `/lesson-aggregate`'s, on a
different clock: grading runs whenever work needs scoring, often split M-day/T-day, while cohort
prose is written once per section after that section's deadline. `/lesson-cycle` runs both in
order.

This skill is run by a **Course Director or System Admin** — not individual instructors. A single run covers all sections for a given day (M-day or T-day).

---

## Where the data lives (PREP v2 — read this before writing any request)

This workflow runs against schema **`app`**, not `public`. The `public` tables the older version of
this skill used no longer back the live site, so a run that writes there grades into a schema
nothing reads. The mapping:

| what you need | `public` (retired) | `app` (now) |
|---|---|---|
| the course | `courses.id = 'phys-215'` | `courses.id` uuid + `courses.code = 'phys-215'` |
| the term | — | `terms` → `course_offerings (course_id, term_id)` |
| the assignment | `assignments` (one row: questions + due dates + publish state) | `assignments` (container: slug/title/objectives) + `activities` (the questions) + `assignment_offerings` (points/due/published, per term) |
| the questions | `assignments.questions` | the **written** activity's `activities.content.questions` |
| the reference PDF | `assignments.reference_pdf` / `.reference_pages` | same keys inside that `content` object |
| a section | `sections.id = 'M1A'` | `sections.id` uuid + `sections.code`; `sections.meeting_days` (`{M}` / `{T}`) replaces sniffing the code |
| who teaches it | `sections.instructor_id` | *(no longer read by this skill — see Step 4b)* |
| a student in a course | `students.section_id` | `enrollments (student_id, section_id, status)` |
| their answers | `responses.answers` | `submissions` → `submission_activities.content` for the written activity |
| their score | `scores` | `grades` |
| the diagnostics | `scores.q2_effort` / `.q3_understanding` | `grades.diagnostic` (jsonb) |
| the class report | `assignments.analysis_report` (jsonb column) | `analysis_reports` — **written by `/lesson-aggregate`, never by this skill** |

**Everything per-student keys on `enrollment_id`, not `student_id`.** Get it from `enrollments`.
That is what stops a section change from silently re-attributing a cadet's history.

---

## Step 0 — Read Config, and set the schema headers once

Read the config file at `~/.claude/skills/preflight-analyze/config.json`.

```json
{
  "supabase_url": "https://YOUR-PROJECT-ID.supabase.co",
  "supabase_service_key": "...",
  "textbook_base_path": "/path/to/your/textbook/pdfs/",
  "default_course_id": "phys-215"
}
```

If the file does not exist, stop and tell the user: "Config file not found at ~/.claude/skills/preflight-analyze/config.json — copy the template from `.ai/skills/preflight-analyze/config.json.template` and complete setup first."

Store as:
- `SUPA_URL` = supabase_url
- `SUPA_KEY` = supabase_service_key (service_role key — bypasses RLS)
- `PDF_BASE` = textbook_base_path
- `COURSE_CODE` = the course argument, else `default_course_id` (it is a course **code**, e.g. `phys-215`)

### The schema headers — decide these once, apply to every request

PostgREST serves one schema per request and defaults to `public`. **Every** call in this skill
therefore carries a profile header. Fix these two header blocks at the start of the run and reuse
them verbatim; do not decide per call site.

```
READ_HEADERS  (GET)
  apikey: {SUPA_KEY}
  Authorization: Bearer {SUPA_KEY}
  Accept-Profile: app

WRITE_HEADERS  (POST / PATCH / PUT / DELETE)
  apikey: {SUPA_KEY}
  Authorization: Bearer {SUPA_KEY}
  Content-Type: application/json
  Content-Profile: app
```

A request that omits its profile header silently hits `public` and is a failed run, not a partial
one. If any response looks like the old shape (a `questions` column on `assignments`, a
`section_id` on `students`), you are in the wrong schema — stop and fix the headers.

---

## Step 1 — Parse Arguments and Resolve the Offering

The skill accepts arguments in the form: `/preflight-analyze [course] [assignment-slug] [M|T]`

Examples:
- `/preflight-analyze phys-215 preflight-02` — analyze all sections for preflight-02
- `/preflight-analyze phys-215 preflight-02 M` — analyze only M-day sections
- `/preflight-analyze M` — list assignments, then analyze M-day sections for the chosen one

Parse the arguments:
- If an argument matches `M` or `T` (case-insensitive): set `DAY_FILTER = "M"` or `"T"`. Otherwise `DAY_FILTER = null` (analyze all sections).
- If an argument looks like a course code (`phys-215`, `phys-110`): set `COURSE_CODE`.
- If the remaining argument looks like an assignment slug (e.g. `preflight-02`): set `ASSIGNMENT_SLUG`.

> **Slugs are no longer prefixed.** `app.assignments` is `UNIQUE (course_id, slug)`, so the
> `phys-110-preflight-NN` namespacing that dodged the July 2026 global-PK collision is gone —
> both courses use plain `preflight-NN`. Always pair a slug with its course.

### 1a. Resolve the course offering (the term anchor)

```
GET {SUPA_URL}/rest/v1/course_offerings?select=id,is_active,course_id,term_id,courses!inner(id,code,title),terms!inner(id,code,label)&courses.code=eq.{COURSE_CODE}&is_active=is.true
Headers: READ_HEADERS
```

Expect exactly one row → `COURSE_OFFERING_ID`, `TERM_LABEL`, `COURSE_TITLE`. If zero, the course
code is wrong or the term is not activated; if more than one, two terms are active at once — stop
and ask which term to analyze rather than guessing.

### 1b. Find the assignment offering

If no assignment slug was provided, list what is published:

```
GET {SUPA_URL}/rest/v1/assignment_offerings?select=id,points_possible,grading_mode,due_at,is_published,position,assignments!inner(id,slug,title)&course_offering_id=eq.{COURSE_OFFERING_ID}&is_published=is.true&order=position.asc
Headers: READ_HEADERS
```

Print the list (slug, title, due date) and ask the user which to analyze. Wait for their answer.

With a slug in hand:

```
GET {SUPA_URL}/rest/v1/assignment_offerings?select=id,points_possible,grading_mode,assignments!inner(id,slug,title)&assignments.slug=eq.{ASSIGNMENT_SLUG}&course_offering_id=eq.{COURSE_OFFERING_ID}
Headers: READ_HEADERS
```

Set `OFFERING_ID` (`assignment_offerings.id`) — **this is the key every write in this run uses.**

If a `DAY_FILTER` was set, print: "Analyzing **{M-day / T-day} sections only** for this assignment."

---

## Step 2 — Fetch Offering Details and the Written Activity

```
GET {SUPA_URL}/rest/v1/assignment_offerings?select=id,points_possible,grading_mode,switch_policy,opens_at,due_at,is_published,position,course_offering_id,assignments!inner(id,slug,title,description,objectives,kind_id,course_id),offering_activities(grading_role,available_after,is_visible,position,activities(id,slug,modality,title,content)),assignment_due_dates(section_id,due_at)&id=eq.{OFFERING_ID}
Headers: READ_HEADERS
```

This is the same projection the site uses (`OFFERING_SELECT` in `site/js/schema.js`) — keep it
that way so the skill and the UI can never disagree about what an assignment is.

From the embedded `offering_activities`, take the entry whose `activities.modality = 'written'`:

- `WRITTEN_ACTIVITY_ID` = `activities.id` — you need it to pick the right `submission_activities` row
- `QUESTIONS` = `activities.content.questions` (the array the old `assignments.questions` held)
- `REFERENCE_PDF` = `activities.content.reference_pdf` (may be null)
- `REFERENCE_PAGES` = `activities.content.reference_pages` (may be null, e.g. `"45-52, 60"`)
- `POINTS_POSSIBLE` = the offering's `points_possible` (**not** a per-question sum you invent)

An offering may also carry an **interactive** activity (`modality = 'interactive'`). This skill
grades the written path only. If the interactive activity is `grading_role = 'graded'`, say so in
the report — students who chose it are graded by `/lesson-aggregate`'s sibling backfill, not
here, and must not be counted as missing.

### Preflight checks — do these before any analysis

1. **Points agree.** `sum(q.points for q in QUESTIONS)` must equal `POINTS_POSSIBLE`. `grades` has
   `CHECK (points_earned <= points_possible)`, so a mismatch means every write will either be
   rejected or silently under-report. If they differ, stop and report both numbers — a director
   fixes the offering, you do not paper over it.
2. **The grades shape is reachable.**
   ```
   GET {SUPA_URL}/rest/v1/grades?select=diagnostic,question_scores,effort&limit=0
   Headers: READ_HEADERS
   ```
   HTTP 200 confirms the columns exist in `app`. A 400 means the projection or the profile header
   is wrong; a 404 means you are pointed at `public`. Stop before writing anything.
3. **Grading mode.** These offerings are `grading_mode = 'points'`, so you write `points_earned`
   directly. If you find `grading_mode = 'effort'`, stop: a DB trigger derives points from
   `grades.effort` and would overwrite anything you put in `points_earned`. Written preflights are
   not effort-graded today; an offering that says otherwise is a configuration change nobody told
   you about.

---

## Step 3 — RAG: Read Textbook Pages (if applicable)

If `REFERENCE_PDF` is set AND `REFERENCE_PAGES` is set:

1. Construct the full path: `{PDF_BASE}/{REFERENCE_PDF}`
2. Parse `REFERENCE_PAGES` into page numbers (e.g., "45-52, 60" → pages 45–52 and 60)
3. Read those pages with the current agent's PDF-reading capability
4. Store the extracted text as `REFERENCE_TEXT` — you will use it during analysis to ground your physics responses

If either field is null, skip this step (proceed without RAG context).

> **Approved-reference manifest.** The set of valid `reference_pdf` values is the committed manifest
> `textbook-pdfs/rag-manifest.txt` (one path per line; `#` comments ignored). The PDFs themselves are
> gitignored and fetched from Teams, so the manifest is the shared contract that keeps the names
> **identical across every operator's local repo** — the faculty lesson creator populates its
> "Reference PDF" dropdown from it. If an activity's `reference_pdf` is **not** in the manifest, treat it
> as unverified: resolve `{PDF_BASE}/{REFERENCE_PDF}` as usual, but if the file is missing, warn and
> proceed without RAG (Error Handling), and flag that the reference should be added to the manifest
> and committed so it is shared.

---

## Step 4 — Fetch the Roster (sections → staff → enrollments)

### 4a. Sections, and the day filter

```
GET {SUPA_URL}/rest/v1/sections?select=id,code,meeting_days,period,course_offering_id&course_offering_id=eq.{COURSE_OFFERING_ID}&order=code.asc
Headers: READ_HEADERS
```

**Apply the day filter on `meeting_days`, not on the section code.** Keep sections whose
`meeting_days` array contains `DAY_FILTER` (e.g. `["M"]` matches `M`). The old rule — "section id
starts with M" — was a string-sniffing workaround for a schema that had nowhere to put the meeting
pattern. It is now data, so use it; a course with a `W`/`F` pattern will work without a code change.

Build `sectionMap[section_id] = { code, meeting_days }` and `SECTION_IDS` = the filtered ids.
Print: "Filtering to {N} sections in {M-day / T-day}: {codes}".

### 4b. (removed 2026-07-21) — instructors are no longer looked up

This step fetched `staff_assignments` for one reason: to group the old per-instructor summaries in
the retired Step 8. Nothing in this skill groups by instructor any more — grading is per student,
and the cohort rollup is per **section** and belongs to `/lesson-aggregate`. Skip straight to 4c.

### 4c. The enrolled students

```
GET {SUPA_URL}/rest/v1/enrollments?select=id,student_id,section_id,status,students!inner(student_id,name)&section_id=in.({SECTION_IDS})&status=eq.active&order=student_id.asc
Headers: READ_HEADERS
```

Build `enrollmentMap[enrollment_id] = { student_id, name, section_id }` and the reverse
`byStudent[student_id] = enrollment_id`. Only `status = 'active'` enrollments count; a dropped cadet
is not "missing".

---

## Step 5 — Fetch All Submitted Work

```
GET {SUPA_URL}/rest/v1/submissions?select=id,enrollment_id,chosen_activity_id,status,committed_at,updated_at,submission_activities(activity_id,content,report_markdown,updated_at)&assignment_offering_id=eq.{OFFERING_ID}&enrollment_id=in.({ENROLLMENT_IDS})
Headers: READ_HEADERS
```

For each submission, find the embedded `submission_activities` entry whose
`activity_id = WRITTEN_ACTIVITY_ID`. Its `content` **is** the answers object — the same
`{ "q1": "…", "q2": "…" }` shape `responses.answers` used to hold.

Compute:
- `submittedEnrollments` = enrollments with a written activity row whose `content` has at least one non-empty answer
- `missingEnrollments` = filtered roster enrollments with no such row

> **Draft vs. committed is new, and it matters.** `public` treated "a `responses` row exists" as
> submitted, so an autosave counted as a submission. `app` makes committing explicit
> (`submissions.status`). **Grade any student whose written content is non-empty** — someone who
> wrote real answers and never pressed Submit should not be silently zeroed — but count
> `status = 'draft'` separately and list those cadets in the report so the instructor can decide.
> Do not treat a draft as missing.
>
> If a cadet's `chosen_activity_id` is the **interactive** activity, they took the other path.
> List them under "took the interactive path", not under missing.

---

## Step 6 — Auto-Grade Numerical and Multiple Choice

For each response (within filtered set), for each question:

**Multiple choice** (`type: "multiple_choice"`):
- If `answers[q.id]` matches `q.correct_answer` (case-insensitive, trim whitespace): score = q.points
- Otherwise: score = 0, feedback = `"Incorrect. Correct answer: ${q.correct_answer}"`

**Numerical** (`type: "numerical"`):
- Parse answer as float. If blank or non-numeric: score = 0, feedback = "No numerical answer provided."
- Check: `|student_answer - correct_answer| / correct_answer <= tolerance` (default ±5%)
- Within tolerance: score = q.points
- Outside tolerance: score = 0, feedback = `"Answer ${student_answer} is outside the ±5% accepted range (expected ≈ ${correct_answer})."`

Store auto-graded results in a per-student score object. These do NOT need instructor review unless score = 0.

---

## Step 7 — Analyze Free-Response Questions

For each free-response question (`type: "free_response"`), collect all student answers (within filtered set).

Read `references/QUESTION-DIAGNOSTICS.md` in full. For every submitted student, independently assign:
- `q2_effort`: integer 0–5 using the per-answer engagement rubric; correctness is irrelevant.
- `q3_understanding`: integer 0–5 using the demonstrated-physics-understanding rubric.

These are diagnostics, not grade points. Do not put either value into student feedback,
`question_scores`, `points_earned`, the analysis report, or the printed per-student report. They go
in one place only: `grades.diagnostic`. A Q3 answer may receive yellow/full credit for genuine
effort while its hidden understanding diagnostic is 1 or 2.

### Q1 — the reading-time question is data, not an answer to grade

Q1 is *"How much time did you spend reading the book in preparation for this lesson?"*, worth **0
points**, with names hidden from instructors. It is not graded and has no right answer — but it is
the one question that says whether the class did the reading, and until now nothing read it.

**Parse each answer to whole minutes → `diagnostic.reading_minutes`** ("About half an hour." → 30;
"An hour and a quarter" → 75; a range takes its midpoint). Omit the key when the answer states no
duration — absent means "not stated", `0` would mean "read for zero minutes". Full rules and the
worked table: [`references/WRITTEN-SCHEMA1.md`](references/WRITTEN-SCHEMA1.md) §`reading_minutes`.

Do not grade Q1, do not write feedback on it, and do not include individual reading times in the
printed report or the per-instructor bullets. It is reported only as a class distribution.

**Identifying Q1 and Q2.** Prefer `role: "reading_time"` / `role: "reading_reflection"` on the
question object. As of 2026-07-21 **no live activity carries a role** — the Fall builder predates
the convention — so fall back to the prompt text, which is verbatim-identical across all 74. Fall
back to position (`q1`, `q2`) last, and say in the run report which signal you used.

### Grading Decision — THREE STATES ONLY

For each free-response answer, assign exactly one of:

| State | Status | Score | When to use |
|---|---|---|---|
| 🟢 Green | `full` | q.points | Answer is correct, or essentially correct with only minor wording/phrasing issues |
| 🟡 Yellow | `warn` | q.points | Answer is on-topic and shows genuine effort, but has flawed or incomplete reasoning — student attempted the right physics even if the explanation is wrong |
| 🔴 Red | `zero` | 0 | Blank, completely off-topic, gibberish, or clearly not a good-faith attempt (e.g., "I don't know", "N/A", a random unrelated sentence, a single word) |

**Default rule: if a student wrote something relevant to the question, it is at minimum yellow.**

The bar for red is HIGH. Only award zero when the response is:
- Completely blank or whitespace-only
- Explicitly "I don't know" / "didn't do the reading" / "N/A"
- Entirely off-topic or gibberish with no connection to the question
- A single isolated word with no reasoning whatsoever

**Never give zero for imperfect physics.** A student who names the wrong force, reverses a sign, misidentifies which charges move, or describes the mechanism incorrectly but is clearly reasoning about the right phenomenon gets yellow (full credit + feedback), not red (zero). Hedging language ("I think...", "maybe...") does NOT make an answer red — if there's a genuine attempt underneath the hedge, it's at least yellow.

### Feedback Rules

- **Green** (`full`): `feedback = ""` — empty string, no message needed.

- **Yellow** (`warn`): Write a **tailored 2–3 sentence corrective response** specific to what *this student* actually wrote. Do NOT use a generic template — every yellow answer should get a response that could only have been written for that particular answer.

  Follow this process for each yellow answer:
  1. **Read the student's answer carefully.** Identify the specific flaw: wrong mechanism, reversed direction, missing concept, circular reasoning, etc.
  2. **Acknowledge anything correct** in the answer (if present) in one short clause — e.g., "You're right that the charges redistribute…"
  3. **Name and correct the specific error** using the question's `expected_response` field (if set) and `REFERENCE_TEXT` (if loaded) as your physics source of truth — but rephrase it to address the student's actual mistake, not just restate the model answer.
  4. If `REFERENCE_TEXT` is available, anchor the correction in the textbook language where possible (e.g., "As the text notes on p. 47…" or simply by using the same terminology the book uses).

  **Format guide:**
  - Open by naming what the student got right or what they were attempting, if applicable.
  - State the specific error concisely.
  - Close with the correct 1–2 sentence explanation drawn from `expected_response` / `REFERENCE_TEXT`.
  - Tone: instructional and supportive. Never punitive.
  - Do NOT copy `expected_response` verbatim — synthesize a targeted correction.
  - Length: 2–3 sentences max. Concise beats comprehensive.

  Example (for a student who wrote "the charges repel because the rod has the same charge as the conductor"):
  > "You're on the right track that charge is involved — but the key is that the conductor starts neutral, not charged. When the rod approaches, free electrons in the conductor redistribute toward or away from the rod, creating an induced dipole. Because the attracting face is closer than the repelling face, the net force is attractive, not repulsive."

- **Red** (`zero`): `feedback = "No answer provided."` (if blank) or a brief note on what was expected (if off-topic/gibberish).

### Physics Misconception Taxonomy
Look for these patterns in free-response answers. **The `id` column is not decoration** — it is
what goes in `misconceptions[].id` (Step 9), and it is what the rollup counts. Two students with
the same misconception must carry the same id or they will not aggregate.

| id | Misconception | Description |
|---|---|---|
| `vector-scalar` | Vector/scalar confusion | Treating velocity as speed, ignoring direction in force problems |
| `newton-3rd` | Newton's 3rd law errors | Claiming action/reaction forces cancel; confusing pairs |
| `newton-2nd-sign` | Newton's 2nd law sign errors | Incorrect direction of net force or acceleration |
| `free-body` | Free-body diagram errors | Missing normal force, friction, or weight component |
| `energy-work-power` | Energy/work/power conflation | Using "energy" when they mean "force" or "work"; misidentifying conservative vs non-conservative |
| `conservation-misapplied` | Conservation law misapplication | Applying conservation of energy with friction; ignoring system boundaries |
| `kinematics` | Kinematics errors | Mixing up displacement/distance; incorrect kinematic equation choice |
| `units` | Unit/dimensional errors | Using wrong units; inconsistent unit handling |
| `charge-field` | Charge/field confusion | Confusing field direction with force direction; signed charge errors |
| `induction-polarization` | Induction/polarization confusion | Conflating charging by induction vs. conduction; misidentifying which charges move |
| `circular-reasoning` | Circular reasoning | Restating the question as the answer; tautological explanations |

#### Match before you coin — the misconception bucket

**Nothing validates a misconception id.** No table, no enum, no CHECK constraint, no code path.
Every counting site keys on the exact string, so an id you invent that means the same thing as one
already in use becomes its own bar at a fraction of the real prevalence, and the finding is split
in two. The taxonomy covers three lessons out of ~74, so for most lessons the tables above will not
have your answer and the pressure to coin is constant.

**Resolve in this order, and only reach the next step when the previous one genuinely does not fit:**

1. **The bucket already in use for THIS assignment.** Before emitting anything, fetch the ids
   already recorded against this assignment — across every offering and term, not just this one:

   ```
   GET {SUPA_URL}/rest/v1/grades?select=diagnostic&assignment_offering_id=in.(<every offering of this assignment>)
   ```

   Collect `diagnostic.misconceptions[].id` plus each entry's `label`/`description`. That set is the
   bucket. It is self-maintaining — it grows as lessons are analyzed — and it is the single most
   effective thing you can do to keep a lesson's bars stable across runs and across terms.
   *(On the interactive path the same ids also live in `submission_activities.content`; include them
   when the lesson has an artifact.)*
2. **The per-preflight table** in `.ai/instructions/PROJECT.md` § "Known Misconception Patterns"
   (`scalar-sum`, `forces-cancel`, `wavelength-confusion`, `shielding`, …). More precise than the
   generic ids, and it carries the exact correction to give the student.
3. **The generic table above.**
4. **Coin a new kebab-case id** — lowercase, hyphen-separated, no spaces. Give it a `label` and a
   `description` good enough that `/lesson-aggregate` can later fold it into a bucket or promote it.

**Matching is semantic, not textual.** "Adds the magnitudes without direction" and "treats forces as
scalars" are one misconception with two phrasings; reuse the existing id. Two errors that merely
co-occur are not one error — do not collapse them to keep the list short.

**Normalization is automatic, so do not rely on it.** Both counting sites lowercase, trim, and
convert whitespace to hyphens, so `Scalar-Sum` and `scalar sum` already fold onto `scalar-sum`. That
protects against typos, not against synonyms — it will never merge `adds-magnitudes` with
`scalar-sum`. Only step 1 does that.

**If you coin more than two or three new ids for one lesson, stop and re-check step 1.** That is
almost always a sign you are re-describing misconceptions the bucket already holds, and it is the
failure mode this section exists to prevent.

If `REFERENCE_TEXT` was loaded in Step 3, cross-reference student answers against the textbook content to identify factual errors more accurately.

### Per-Question Analysis Output Structure
For each free-response question, produce:
```
### Q{N}: {question_text} ({points} pts)

**Misconceptions Identified:**
- {Misconception type}: {description of how it appeared} — ~{count} students
  Example: "{quote from student answer}"

**Answer Characteristics (correct responses):**
- {Key physics concepts that correct answers included}

**Grading Summary:**
- {N} / {total submitted} received full credit
- {N} received partial/zero credit with deductions
```

---

## Step 8 — Record the run in `app.analysis_runs`

Every analysis run is auditable, whether a human typed it or a scheduler fired it. This is the only
place a completed run is recorded — do **not** write a `CHANGELOG.md` entry for a routine grading
run (reserve that for schema changes, bulk corrections and one-off repairs).

**Insert this BEFORE the grade write in Step 9**, so a run that dies part-way still leaves a trace:

```
POST {SUPA_URL}/rest/v1/analysis_runs
Headers: WRITE_HEADERS + Prefer: return=representation
Body: { "skill": "preflight-analyze", "invoked_by": "human", "status": "running",
        "course_offering_id": "{COURSE_OFFERING_ID}",
        "assignment_offering_id": "{OFFERING_ID}", "day_track": "{DAY_FILTER or null}" }
```

Keep the returned `id`. **Update it once Step 9 has read back clean:**

```
PATCH {SUPA_URL}/rest/v1/analysis_runs?id=eq.{RUN_ID}
Headers: WRITE_HEADERS + Prefer: return=minimal
Body: { "status": "success", "finished_at": "{ISO}",
        "summary": "Graded 32 of 36 in M1A, M3A; skipped 4 finalized.",
        "detail": { "students_in_scope": 36, "graded": 32, "missing": 0,
                    "skipped_finalized": 4, "skipped_instructor": 0,
                    "sections": ["M1A", "M3A"] } }
```

- `invoked_by` is `"scheduled"` when this ran under `/lesson-cycle` from a scheduler, `"human"`
  otherwise. `actor` is the requesting instructor's `instructors.id` when you know it, else null.
- `status`: `success` when every in-scope student was graded or deliberately skipped; `partial`
  when you completed but did less than asked; `skipped` when there was nothing to do; `failed`
  with `error` set (the message, not a stack trace) when you stopped.
- **Leaving the row at `running` is the correct outcome of a crash.** Do not tidy it up on a later
  run — that is the signal an operator needs.

## The old Step 8 is RETIRED (2026-07-21). This skill writes no cohort output.

> **It used to write a per-instructor, per-question breakdown to `analysis_reports`
> (`kind='by_question'`, `audience_id` = the instructor). That is gone.** The axis was wrong:
> an instructor is not a unit of analysis, so a single row pooled their M1A *and* M3A and could
> never be shown on a section view — and `audience_id` bought no privacy either, because
> `analysis_reports` RLS already grants every `scope='assignment_offering'` row to any staff
> member of the offering.
>
> **`/lesson-aggregate` now owns every cohort output**, by section and for the whole course, and
> folds the per-question material into its `readiness_summary`. It reads the graded answers and
> `grades.question_scores` directly, so nothing is lost by this skill not summarizing them.
>
> **What that means for you:** finish at Step 9. Do not write to `analysis_reports` at all. The
> misconceptions you identify in Step 7 still matter — they leave through
> `misconceptions[]` in the `schema: 1` payload (Step 9), which is what the rollup counts and what
> the aggregator clusters. Rows written before the retirement survive in the database and are
> ignored by the rollup.
>
> Ordering is unchanged and still matters: this skill runs first, `/lesson-aggregate` second.
> `/lesson-cycle` sequences both.
---

## Step 9 — Write Suggested Grades to Supabase

For each student who submitted (within filtered set), build a `question_scores` object — **the
3-state shape is unchanged**:

```json
{
  "q1": { "score": 8, "max": 10, "feedback": "Good explanation but missed direction component.", "status": "warn" },
  "q2": { "score": 5, "max": 5,  "feedback": "",                                                "status": "full" },
  "q3": { "score": 0, "max": 5,  "feedback": "Incorrect. Correct answer: C",                   "status": "zero" }
}
```

**`status` rules:**
- `"zero"` — score is 0 (no credit)
- `"warn"` — score is full credit **and** feedback is non-empty (answer is wrong or vague; flagged for instructor review; displays as yellow in admin UI)
- `"full"` — score is full credit **and** feedback is empty (answer is correct; displays as green in admin UI)

Always include `status` — the admin UI relies on it to show the three-state color toggle.

Compute `points_earned` = sum of all question scores. It must be ≤ `POINTS_POSSIBLE`
(a DB CHECK enforces this); Step 2's points check is what makes that true.

### First: never clobber a human's work

```
GET {SUPA_URL}/rest/v1/grades?select=enrollment_id,is_finalized,source&assignment_offering_id=eq.{OFFERING_ID}&enrollment_id=in.({ENROLLMENT_IDS})
Headers: READ_HEADERS
```

**Drop two groups from the payload, and report both counts as skipped:**

1. **`is_finalized = true`** — a finalized grade is an instructor's published decision; a re-run
   must not silently revert it. (The pre-`app` skill had no such guard and would have overwritten
   a finalized score.)
2. **`source = 'instructor'`** (even when `is_finalized = false`) — this is an instructor's saved
   but unpublished draft. It is the case that actually bites on a re-run: an instructor spends an
   afternoon adjusting scores and comments, saves without publishing, and a re-run scoped to
   "everyone who submitted" silently reverts all of it to a fresh AI suggestion.

> **Why `source` can now be trusted for this.** Until 2026-07-21 the Grade view hardcoded
> `source:'instructor'` on every row it wrote, so a single click of *Save draft* relabelled every
> AI suggestion in the section — the column could not distinguish a reviewed grade from an
> untouched one, and this guard would have skipped the whole section. `gradeRows()` in
> `site/js/faculty-grade.js` now marks a row `instructor` only when that student's card was
> actually edited, and preserves the prior `source` otherwise. **This guard depends on that fix;
> do not apply it to a deployment that predates it.**

A student on an approved extension submits *after* this run, so they will not be in it at all. They
are not lost: the Grade tab's "Extensions ready to grade" queue lists exactly those cadets once
their own deadline passes, and they are graded by hand. Do not re-run the whole assignment to pick
up a handful of late submissions — that is the scenario guard 2 exists for.

### Then upsert

```
POST {SUPA_URL}/rest/v1/grades?on_conflict=enrollment_id%2Cassignment_offering_id
Headers: WRITE_HEADERS + Prefer: resolution=merge-duplicates,return=minimal

Body: (array of grade objects)
[{
  "enrollment_id": "{enrollment uuid}",
  "assignment_offering_id": "{OFFERING_ID}",
  "submission_id": "{submission uuid, or null}",
  "points_earned": {N},
  "points_possible": {POINTS_POSSIBLE},
  "question_scores": { … },
  "diagnostic": {
    "q2_effort": {integer 0-5, or omit if q2 is absent},
    "q3_understanding": {integer 0-5, or omit if q3 is absent},

    "schema": 1,
    "source": "preflight-analyze",
    "effort": {integer 0-5, capped at 2 when the reflection is not meaningful},
    "overall_understanding": {integer 0-5, or omit},
    "objectives": [ {"key": "…", "label": "…", "understanding": {0-5}} ],
    "misconceptions": [ {"id": "…", "label": "…", "description": "…",
                         "severity": "major|minor", "evidence": "…"} ],
    "reading_reflection": {"meaningful": {bool}, "engagement": {integer 0-5}},
    "reading_minutes": {whole minutes parsed from Q1, or OMIT if the answer states no duration},
    "flags": {"needs_follow_up": {bool}, "notable": {bool}}
  },
  "source": "ai_suggested",
  "is_finalized": false,
  "graded_at": "{ISO timestamp}"
}]
```

**The `schema: 1` half of `diagnostic` is the per-student structured assessment** — the written
path's equivalent of what the artifact emits, and what lets one cohort aggregator serve both
modalities. Read
[`references/WRITTEN-SCHEMA1.md`](references/WRITTEN-SCHEMA1.md) before emitting it: it defines
every field, why `effort` is not `q2_effort`, why `objectives` is normally `[]` today, and the
four keys you must NOT emit (`reading_reflection.text`, `honor`,
`self_rated_understanding`, and the conversation metadata). It is purely additive — `q2_effort`
and `q3_understanding` keep their existing rubrics and must survive the write unchanged.

Send all students in a single batch upsert. `UNIQUE (enrollment_id, assignment_offering_id)` means
re-running updates suggestions without creating duplicates. Leave `graded_by` unset — this skill is
not a person, and the column names the instructor who finalized.

### Read back and verify exactly

```
GET {SUPA_URL}/rest/v1/grades?select=enrollment_id,points_earned,points_possible,question_scores,diagnostic,source,is_finalized&assignment_offering_id=eq.{OFFERING_ID}&enrollment_id=in.({ENROLLMENT_IDS})
Headers: READ_HEADERS
```

Require exactly one row per graded enrollment, with `source = "ai_suggested"` and
`is_finalized = false`. Where `q2`/`q3` exists on the assignment, require an integer in `[0,5]` at
`diagnostic.q2_effort` / `diagnostic.q3_understanding`; where absent, require the key to be absent.
Then run the `schema: 1` checks in
[`references/WRITTEN-SCHEMA1.md`](references/WRITTEN-SCHEMA1.md) §Verification — including that no
`text` or `honor` key reached the payload, and that `q2_effort`/`q3_understanding` came back
unchanged. Compare every returned value to the run's in-memory diagnostic before reporting
success.

After exact read-back verification, report: "Wrote suggested grades plus the schema:1 per-student
assessment (effort, understanding, {K} misconceptions across the cohort, flags) and the hidden
Q2-effort / Q3-understanding diagnostics for {N} students ({day_filter} sections); skipped {M}
already-finalized. Grades are marked is_finalized=false — instructors must review and finalize in
the admin panel."

State the objectives situation explicitly in that report — "objectives: [] (no `objective_key`
authored on this assignment's questions)" or the count emitted. A reader must not have to guess
whether an empty breakdown means "not authored" or "the analysis failed".

---

## Step 10 — Print the run report

Grouped **by section**, not by instructor. The instructor axis went with Step 8; a section is what
a person actually teaches into, and it is the axis the rollup uses.

```
═══════════════════════════════════════════════════
# {Course} Preflight Analysis — {Assignment Title}
Generated: {date}   Term: {TERM_LABEL}
{DAY_FILTER ? "Scope: M-Day sections only" | "Scope: T-Day sections only" : "Scope: All sections"}
═══════════════════════════════════════════════════

## Section {CODE}

| Metric | Value |
|--------|-------|
| Students in section | {N} |
| Submitted (committed) | {N} |
| Submitted (still draft) | {N} |
| Took the interactive path | {N} |
| Missing | {N} |
| Skipped — finalized | {N} |
| Skipped — instructor-edited draft | {N} |
| Average score | {X.X} / {POINTS_POSSIBLE} |

### Missing Students
| Name | Section | Student ID |
|------|---------|-----------|

(If none: "All students submitted.")
```

Then one combined block:

```
═══════════════════════════════════════════════════
## Combined{DAY_FILTER ? " — M-Day" | " — T-Day" : ""}

| Section | Submitted | Missing | Skipped | Avg Score |
|---------|-----------|---------|---------|-----------|

**Next steps:**
- Instructors review and adjust suggested grades in the Grade tab; yellow scores are AI suggestions
- "Finalize & Publish Grades" makes them visible to students
- Cohort prose is NOT written by this skill — run /lesson-aggregate (or /lesson-cycle, which runs
  both) once this day's deadline has passed
- To grade the other day's sections: /preflight-analyze {COURSE_CODE} {ASSIGNMENT_SLUG} {OTHER_DAY}
═══════════════════════════════════════════════════
```

**Do not dump raw responses into the report.** The old format printed every student's answer
inline; that is a large wall of student prose in a transcript that gets pasted around, and the
Grade tab already shows each answer beside its score.
---

## Error Handling

- **Supabase API error**: Print the status code and error message. If 401/403, remind user the service_role key is required (not the anon key).
- **Wrong schema**: a 404 on a table that exists, or a response carrying `public`-era columns, means a profile header was dropped. Stop; do not retry blindly.
- **No offering found**: Print "No published assignment '{slug}' in {COURSE_CODE} for the active term. Has it been created and published for this offering?"
- **No submissions found**: Print "No work found for '{slug}'. Has the offering been published and worked by students?"
- **PDF not found**: Warn "Reference PDF not found at {path} — proceeding without textbook context." Continue without RAG.
- **Partial config**: If any required config key is missing, list which keys are missing and stop.
- **Empty filtered set**: If `DAY_FILTER` is set but no sections match, print "No {M-day / T-day} sections found in this offering."
- **Points mismatch**: question points ≠ `points_possible` — stop before writing and report both.
- **`grading_mode = 'effort'`**: stop; a trigger owns `points_earned` on that offering.
- **Diagnostic read-back mismatch**: Treat the run as failed; report the mismatched enrollment ids and do not claim success.

---

## Important Rules

1. **Never finalize grades** — always write `is_finalized: false` and `source: "ai_suggested"`. Instructors confirm in the admin panel.
2. **Never overwrite a finalized grade** — filter them out before the upsert (Step 9) and report the count.
3. **Never deduct without feedback** — every score of zero must have a non-empty `feedback` string explaining why.
4. **Three states, simple rule** — Green = correct. Yellow = genuine on-topic attempt with flawed reasoning (full credit + tailored corrective feedback). Red = blank, off-topic, or not a good-faith attempt (zero credit). When in doubt between yellow and red, choose yellow.
5. **Yellow gets full credit** — `warn` status always has `score = q.points`. Never assign partial credit on free-response; it's either full points (green or yellow) or zero (red).
6. **Yellow feedback must be tailored** — never use the same feedback string for two different students' yellow answers on the same question. Each `warn` feedback must name the specific flaw in that student's response and correct it using `expected_response` and/or `REFERENCE_TEXT`. A generic "the reasoning may be incorrect" paste is not acceptable.
7. **Protect the service key** — never print `SUPA_KEY` in the output. Reference it as `[service_key]` if you need to show a sample request.
8. **Every request names its schema** — `Accept-Profile: app` on reads, `Content-Profile: app` on writes, decided once in Step 0.
9. **Key on `enrollment_id`** — never write a grade or read work by `student_id` alone; the enrollment is what carries the section and the term.
10. **Diagnostics never affect grades** — everything in `grades.diagnostic` (`q2_effort`, `q3_understanding`, and the whole `schema: 1` payload including its `effort`) is diagnostic only. Never use any of it in `question_scores`, `points_earned`, `points_possible`, status, feedback, finalization, or the analysis report, and never render or print individual per-student values. The `effort` inside `diagnostic` is **not** `grades.effort` and must not be written to that column: these offerings are `grading_mode='points'` (Step 2), where points come from `question_scores`.
11. **Emit structure, not prose** — every misconception you identify in Step 7 must leave this skill as an entry in `misconceptions[]` in Step 9's `schema: 1` payload, against a taxonomy id. That structured list is the *only* way a finding reaches anyone: the rollup counts it into the prevalence bars, and `/lesson-aggregate` clusters it into the cohort trends. A misconception you only describe in the run report is a misconception nobody downstream can see. See [`references/WRITTEN-SCHEMA1.md`](references/WRITTEN-SCHEMA1.md).
12. **Write no cohort output.** Never write `analysis_reports` — not readiness prose, not trends, not a per-question breakdown. That table belongs to `/lesson-aggregate`, which runs after the deadline over a whole section. This skill's blast radius is `grades`, and nothing else.
12. **Never invent an objective breakdown** — emit `objectives: []` unless the questions carry `objective_key`. Fabricated objectives become axes on the faculty radar.
