---
name: preflight-analyze
description: >
  Physics 215 preflight assignment analysis skill for USAFA. Use when the user wants to analyze
  student submissions, generate per-instructor misconception reports, apply auto-grading, write
  suggested scores and hidden Q2-effort/Q3-understanding diagnostics to Supabase, or says
  /preflight-analyze. Also triggers for "analyze preflight", "grade submissions", "check who hasn't
  submitted", "run analysis on assignment", or "preflight analyze". This skill is run by a Course
  Director or System Admin, not individual instructors. Optional filter argument: "M" for M-day
  sections or "T" for T-day sections.
---

# Physics 215 Preflight Analyzer

You are analyzing student submissions for a Physics 215 preflight assignment at USAFA. Your job is to:
1. Fetch all student responses from Supabase (filtered by M-day or T-day sections if requested)
2. Optionally read referenced textbook pages for grounding (RAG)
3. Analyze responses question by question for physics misconceptions
4. Generate hidden 0–5 diagnostics for Q2 effort and Q3 understanding
5. Write suggested scores back to Supabase (`is_finalized = false`)
6. Print a structured per-instructor report in the conversation

This skill is run by a **Course Director or System Admin** — not individual instructors. A single run covers all sections for a given day (M-day or T-day). Results are stored per-instructor and are visible to each instructor in the Report tab.

---

## Step 0 — Read Config

Read the config file at `~/.claude/skills/preflight-analyze/config.json`.

```json
{
  "supabase_url": "https://YOUR-PROJECT-ID.supabase.co",
  "supabase_service_key": "...",
  "textbook_base_path": "/path/to/your/textbook/pdfs/"
}
```

If the file does not exist, stop and tell the user: "Config file not found at ~/.claude/skills/preflight-analyze/config.json — copy the template from `.ai/skills/preflight-analyze/config.json.template` and complete setup first."

Store as:
- `SUPA_URL` = supabase_url
- `SUPA_KEY` = supabase_service_key (service_role key — bypasses RLS)
- `PDF_BASE` = textbook_base_path

---

## Step 1 — Parse Arguments and Identify the Assignment

The skill accepts arguments in the form: `/preflight-analyze [assignment-id] [M|T]`

Examples:
- `/preflight-analyze preflight-2` — analyze all sections for preflight-2
- `/preflight-analyze preflight-2 M` — analyze only M-day sections for preflight-2
- `/preflight-analyze preflight-2 T` — analyze only T-day sections for preflight-2
- `/preflight-analyze M` — list assignments, then analyze M-day sections for the chosen one

Parse the arguments:
- If an argument matches `M` or `T` (case-insensitive): set `DAY_FILTER = "M"` or `"T"`. Otherwise `DAY_FILTER = null` (analyze all sections).
- If the remaining argument looks like an assignment ID (e.g., `preflight-2`): set `ASSIGNMENT_ID` directly.

If no assignment ID was provided, call the Supabase REST API to list published assignments:

```
GET {SUPA_URL}/rest/v1/assignments?select=id,title,due_date_m,due_date_t,is_published&is_published=eq.true&order=due_date_m.asc
Headers:
  apikey: {SUPA_KEY}
  Authorization: Bearer {SUPA_KEY}
```

Print the list and ask the user which assignment to analyze. Wait for their answer.

If a `DAY_FILTER` was set, print: "Analyzing **{M-day / T-day} sections only** for this assignment."

---

## Step 2 — Fetch Assignment Details

```
GET {SUPA_URL}/rest/v1/assignments?select=*&id=eq.{ASSIGNMENT_ID}
Headers: apikey + Authorization as above
```

Parse response into:
- `assignment.id`, `assignment.title`, `assignment.questions` (JSON array)
- `assignment.reference_pdf` (may be null)
- `assignment.reference_pages` (may be null, e.g., "45-52, 60")

Before analyzing responses, verify migration 022 is available:
```
GET {SUPA_URL}/rest/v1/scores?select=q2_effort,q3_understanding&limit=0
Headers: apikey + Authorization as above
```
If either column is missing, stop before any write and tell the operator to apply
`supabase/migrations/022_preflight_question_diagnostics.sql` through the coordinated DDL workflow.

---

## Step 3 — RAG: Read Textbook Pages (if applicable)

If `reference_pdf` is set AND `reference_pages` is set:

1. Construct the full path: `{PDF_BASE}/{reference_pdf}`
2. Parse `reference_pages` into page numbers (e.g., "45-52, 60" → pages 45–52 and 60)
3. Read those pages with the current agent's PDF-reading capability
4. Store the extracted text as `REFERENCE_TEXT` — you will use it during analysis to ground your physics responses

If either field is null, skip this step (proceed without RAG context).

> **Approved-reference manifest.** The set of valid `reference_pdf` values is the committed manifest
> `textbook-pdfs/rag-manifest.txt` (one path per line; `#` comments ignored). The PDFs themselves are
> gitignored and fetched from Teams, so the manifest is the shared contract that keeps the names
> **identical across every operator's local repo** — the faculty lesson creator populates its
> "Reference PDF" dropdown from it. If a lesson's `reference_pdf` is **not** in the manifest, treat it
> as unverified: resolve `{PDF_BASE}/{reference_pdf}` as usual, but if the file is missing, warn and
> proceed without RAG (Error Handling), and flag that the reference should be added to the manifest
> and committed so it is shared.

---

## Step 4 — Fetch the Roster

```
GET {SUPA_URL}/rest/v1/students?select=student_id,name,section_id&order=student_id.asc
Headers: apikey + Authorization
```

Build a map: `studentMap[student_id] = { name, section_id }`

**Apply day filter**: If `DAY_FILTER` is set:
- Keep only students whose `section_id` starts with `DAY_FILTER` (e.g., `M` keeps `M1A`, `M1B`, `M3C`, etc.)
- Print: "Filtering to {N} students in {M-day / T-day} sections: {list of section IDs}"

Also fetch sections with their instructors:
```
GET {SUPA_URL}/rest/v1/sections?select=id,instructor_id,instructors(name)
Headers: apikey + Authorization
```

Build: `sectionMap[section_id] = { instructor_name }`

If `DAY_FILTER` is set, keep only sections that start with `DAY_FILTER`.

---

## Step 5 — Fetch All Responses

```
GET {SUPA_URL}/rest/v1/responses?select=student_id,answers,submitted_at,updated_at&assignment_id=eq.{ASSIGNMENT_ID}
Headers: apikey + Authorization
```

Join each response with `studentMap` to get `name` and `section_id`.

**If DAY_FILTER is set**: discard responses from students not in the filtered set.

Compute:
- `submittedStudents` = set of student_ids who submitted (within the filtered set)
- `missingStudents` = all students in the filtered roster who did NOT submit

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
`question_scores`, grade totals, `analysis_report`, or the printed per-student report. A Q3 answer may
receive yellow/full credit for genuine effort while its hidden understanding diagnostic is 1 or 2.

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

### Physics 215 Misconception Taxonomy
Look for these patterns in free-response answers:

| Misconception | Description |
|---|---|
| **Vector/scalar confusion** | Treating velocity as speed, ignoring direction in force problems |
| **Newton's 3rd law errors** | Claiming action/reaction forces cancel; confusing pairs |
| **Newton's 2nd law sign errors** | Incorrect direction of net force or acceleration |
| **Free-body diagram errors** | Missing normal force, friction, or weight component |
| **Energy/work/power conflation** | Using "energy" when they mean "force" or "work"; misidentifying conservative vs non-conservative |
| **Conservation law misapplication** | Applying conservation of energy with friction; ignoring system boundaries |
| **Kinematics errors** | Mixing up displacement/distance; incorrect kinematic equation choice |
| **Unit/dimensional errors** | Using wrong units; inconsistent unit handling |
| **Charge/field confusion** | Confusing field direction with force direction; signed charge errors |
| **Induction/polarization confusion** | Conflating charging by induction vs. conduction; misidentifying which charges move |
| **Circular reasoning** | Restating the question as the answer; tautological explanations |

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

## Step 8 — Generate Per-Instructor Bulleted Summaries

Group students and responses by instructor (using `sectionMap` → `instructor_id`). For each instructor (within filtered set), generate a summary covering **all their sections combined**.

**Aggregate per instructor, never per section.** Pool every response from all of an instructor's sections into one set before computing counts and identifying misconceptions. Do not produce separate summaries, counts, or misconception lists for each section, and do not label bullets by section (e.g., no "M1A: 3 students, M1B: 2 students"). One combined summary per instructor per question is the only output.

### Format per question

Write a **bulleted list** (newline-separated strings, no prose paragraphs). Each bullet should be a single, scannable observation. Target 4–7 bullets per question. Do NOT include `•` or `-` prefix in the stored string — the website adds list styling.

**Include bullets for:**
- Score distribution: `"X/Y students answered correctly"` or `"X/Y received full credit"`
- Each distinct misconception with approximate count and a brief description of why it is wrong
- Any blank/no-engagement responses and their count
- Vague or low-confidence correct answers (if notable)
- What strong/exemplary answers included (1 bullet)
- One instructional recommendation tied to the most common issue

**For auto-graded questions (numerical/MC)**, write 1–2 bullets only: correct rate and the most common wrong answer if any.

### Storage structure

```json
{
  "generated_at": "{ISO timestamp}",
  "day_filter": "M",
  "by_instructor": {
    "{instructor_uuid}": {
      "instructor_name": "...",
      "sections": ["M1A", "M1B"],
      "questions": {
        "q1": { "summary": "bullet one\nbullet two\nbullet three" },
        "q2": { "summary": "..." }
      }
    }
  }
}
```

Include `"day_filter": null` when no filter was applied, or `"M"` / `"T"` when filtered.

Each `summary` value is a `\n`-joined string of bullet text (one bullet per line, no leading `•` or `-`).

**IMPORTANT**: When `DAY_FILTER` is set, only update entries for instructors within the filtered day. Fetch the existing `analysis_report` first, then merge — preserve any existing instructor entries for the other day so running M and T separately produces a complete combined report.

Fetch existing report before writing:
```
GET {SUPA_URL}/rest/v1/assignments?select=analysis_report&id=eq.{ASSIGNMENT_ID}
Headers: apikey + Authorization
```

Merge: `existingReport.by_instructor = { ...existingReport.by_instructor, ...newInstructorEntries }`

Write to Supabase using PATCH:
```
PATCH {SUPA_URL}/rest/v1/assignments?id=eq.{ASSIGNMENT_ID}
Headers:
  apikey: {SUPA_KEY}
  Authorization: Bearer {SUPA_KEY}
  Content-Type: application/json
  Prefer: return=minimal

Body:
{ "analysis_report": { "generated_at": "...", "day_filter": "M", "by_instructor": { ... } } }
```

---

## Step 9 — Write Suggested Scores to Supabase

For each student who submitted (within filtered set), build a `question_scores` object:
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

Compute `total_score` = sum of all question scores.
Compute `max_total` = sum of all question max points.

Upsert to Supabase (service key bypasses RLS):
```
POST {SUPA_URL}/rest/v1/scores?on_conflict=student_id%2Cassignment_id
Headers:
  apikey: {SUPA_KEY}
  Authorization: Bearer {SUPA_KEY}
  Content-Type: application/json
  Prefer: resolution=merge-duplicates

Body: (array of score objects)
[{
  "student_id": {student_id},
  "assignment_id": "{ASSIGNMENT_ID}",
  "question_scores": { ... },
  "q2_effort": {integer 0-5 or null if q2 is absent},
  "q3_understanding": {integer 0-5 or null if q3 is absent},
  "total_score": {N},
  "max_total": {N},
  "is_finalized": false,
  "graded_at": "{ISO timestamp}"
}]
```

Send all students in a single batch upsert. The `UNIQUE(student_id, assignment_id)` constraint means re-running the skill updates suggestions without creating duplicates.

Read the written rows back for the exact submitted student ids:
```
GET {SUPA_URL}/rest/v1/scores?select=student_id,q2_effort,q3_understanding&assignment_id=eq.{ASSIGNMENT_ID}&student_id=in.({IDS})
Headers: apikey + Authorization as above
```
Require exactly one row per submitted student. Where `q2`/`q3` exists on the assignment, require an
integer in `[0,5]`; where it is absent, require `null`. Compare every returned value to the run's
in-memory diagnostic before reporting success.

After exact read-back verification, report: "Wrote suggested scores plus hidden Q2-effort and
Q3-understanding diagnostics for {N} students ({day_filter} sections). Scores are marked
is_finalized=false — instructors must review and finalize in the admin panel."

---

## Step 10 — Print the Full Report

Print one report block per instructor (all their sections combined), then a combined summary. Use this format:

```
═══════════════════════════════════════════════════
# Physics 215 Preflight Analysis — {Assignment Title}
Generated: {date}
{DAY_FILTER ? "Scope: M-Day sections only" | "Scope: T-Day sections only" : "Scope: All sections"}
═══════════════════════════════════════════════════

## Instructor: {instructor_name} — Sections: {M1A, M1B, ...}

### Submission Summary
| Metric | Value |
|--------|-------|
| Students in sections | {N} |
| Submitted | {N} |
| Missing | {N} |
| Average score (auto-graded) | {X.X} / {max} |

### Missing Students
| Name | Section | Student ID |
|------|---------|-----------|
| ... | ... | ... |

(If none: "All students submitted.")

### Per-Question Analysis
{output from Step 7 for each free-response question}
{brief note for auto-graded questions: "Q{N}: Multiple choice — auto-graded. {X}/{total} correct."}

### Raw Responses
#### Q{N}: {question_text}
| Student | Section | Score | Answer |
|---------|---------|-------|--------|
| {name}  | {section} | {score}/{max} | {first 120 chars of answer...} |
```

After all instructors, print:
```
═══════════════════════════════════════════════════
## Combined Summary{DAY_FILTER ? " — M-Day" | " — T-Day" : ""}

| Instructor | Sections | Submitted | Missing | Avg Score |
|-----------|---------|-----------|---------|-----------|
| ...       | ...     | ...       | ...     | ...       |

**Next steps:**
- Instructors can review and adjust suggested scores in the Admin panel (Grade tab)
- Yellow-highlighted scores are AI suggestions awaiting instructor review
- Click "Finalize & Publish Grades" to make scores visible to students
- To analyze the other day's sections, run: /preflight-analyze {ASSIGNMENT_ID} {OTHER_DAY}
═══════════════════════════════════════════════════
```

---

## Error Handling

- **Supabase API error**: Print the status code and error message. If 401/403, remind user the service_role key is required (not the anon key).
- **No responses found**: Print "No submissions found for assignment '{id}'. Has the assignment been published and submitted by students?"
- **PDF not found**: Warn "Reference PDF not found at {path} — proceeding without textbook context." Continue without RAG.
- **Partial config**: If any required config key is missing, list which keys are missing and stop.
- **Empty filtered set**: If `DAY_FILTER` is set but no students match, print "No {M-day / T-day} students found in the roster."
- **Diagnostic schema missing**: Stop before writing anything and direct the operator to migration 022.
- **Diagnostic read-back mismatch**: Treat the run as failed; report the mismatched student ids and do not claim success.

---

## Important Rules

1. **Never finalize scores** — always write `is_finalized: false`. Instructors confirm in the admin panel.
2. **Never deduct without feedback** — every score of zero must have a non-empty `feedback` string explaining why.
3. **Three states, simple rule** — Green = correct. Yellow = genuine on-topic attempt with flawed reasoning (full credit + tailored corrective feedback). Red = blank, off-topic, or not a good-faith attempt (zero credit). When in doubt between yellow and red, choose yellow.
4. **Yellow gets full credit** — `warn` status always has `score = q.points`. Never assign partial credit on free-response; it's either full points (green or yellow) or zero (red).
5. **Yellow feedback must be tailored** — never use the same feedback string for two different students' yellow answers on the same question. Each `warn` feedback must name the specific flaw in that student's response and correct it using `expected_response` and/or `REFERENCE_TEXT`. A generic "the reasoning may be incorrect" paste is not acceptable.
6. **Protect the service key** — never print `SUPA_KEY` in the output. Reference it as `[service_key]` if you need to show a sample request.
7. **Re-running is safe** — the upsert with `merge-duplicates` updates existing suggestions without touching finalized scores.
8. **Merge analysis reports** — when `DAY_FILTER` is set, always fetch the existing `analysis_report` and merge, so M and T runs don't overwrite each other.
9. **Diagnostics never affect grades** — `q2_effort` and `q3_understanding` are 0–5 research/teaching diagnostics only. Never use them in `question_scores`, `total_score`, `max_total`, status, feedback, or finalization, and never render or print individual values.
