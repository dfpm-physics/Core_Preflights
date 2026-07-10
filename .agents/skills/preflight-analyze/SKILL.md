---
name: preflight-analyze
description: Physics 215 preflight assignment analysis skill for USAFA. Use when the
  user wants to analyze student submissions, generate per-section misconception reports,
  apply auto-grading, write suggested scores to Supabase, or says /preflight-analyze.
  Also triggers for: "analyze preflight", "grade submissions", "check who hasn't submitted",
  "run analysis on assignment", "preflight analyze". This skill is run by a Course Director
  or System Admin — not individual instructors. Run once for M-day sections, once for T-day.
  Optional filter argument: "M" to analyze only M-day sections, "T" to analyze only T-day sections.
---

# Physics 215 Preflight Analyzer

This skill is run by a **Course Director or System Admin** — not individual instructors. A single run covers all sections for a given day (M-day or T-day). Results are stored per-instructor and are visible to each instructor in the Report tab.

You are analyzing student submissions for a Physics 215 preflight assignment at USAFA. Your job is to:
1. Fetch all student responses from Supabase (filtered by M-day or T-day sections if requested)
2. Optionally read referenced textbook pages for grounding (RAG)
3. Analyze responses question by question for physics misconceptions
4. Write suggested scores back to Supabase (`is_finalized = false`)
5. Print a structured per-instructor report in the conversation

---

## Step 0 — Read Config

Read the config file at `~/.Codex/skills/preflight-analyze/config.json`.

```json
{
  "supabase_url": "https://YOUR-PROJECT-ID.supabase.co",
  "supabase_service_key": "...",
  "textbook_base_path": "/path/to/your/textbook/pdfs/"
}
```

If the file does not exist, stop and tell the user: "Config file not found at ~/.Codex/skills/preflight-analyze/config.json — please copy it from physics215-analyze/config.json."

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

---

## Step 3 — RAG: Read Textbook Pages (if applicable)

If `reference_pdf` is set AND `reference_pages` is set:

1. Construct the full path: `{PDF_BASE}/{reference_pdf}`
2. Parse `reference_pages` into page numbers (e.g., "45-52, 60" → pages 45–52 and 60)
3. Read those pages from the PDF using the Read tool with `pages` parameter
4. Store the extracted text as `REFERENCE_TEXT` — you will use it during analysis to ground your physics responses

If either field is null, skip this step (proceed without RAG context).

---

## Step 4 — Fetch the Roster

```
GET {SUPA_URL}/rest/v1/students?select=student_id,name,section_id&order=name.asc
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

### Grading Standard (LIBERAL)
- **Full credit** by default for any answer showing genuine engagement — even partially correct, informal, or incomplete explanations
- **Deduct only** when: (a) blank/empty, (b) completely off-topic/gibberish/nonsense with no physics reasoning, or (c) a single word with no reasoning
- **Wrong but relevant answers get `warn` (full credit + yellow flag), NOT `zero`** — if a student is clearly trying to engage with the right physics concept but reaches the wrong conclusion, they receive full credit with corrective feedback
- Every deduction MUST have a written `feedback` string that explains what was missing and could serve as instructor feedback to the student

### Feedback Rules — MANDATORY

**Feedback is required in ALL of the following cases, regardless of credit awarded:**

| Situation | Score | Status | Feedback required |
|---|---|---|---|
| Blank / empty | 0 | `zero` | "No answer provided." |
| Completely off-topic or gibberish (no physics engagement) | 0 | `zero` | Explain what was expected |
| **Wrong but relevant** — clearly engaging with the right physics topic but incorrect | q.points | `warn` | Corrective feedback (template below) |
| Correct answer, wrong or circular mechanism | q.points | `warn` | Corrective feedback (template below) |
| Vague correct answer (no mechanism, e.g. "static electricity", "something with charges") | q.points | `warn` | Corrective feedback (template below) |
| Low-confidence hedge ("I think...", "Maybe...") with no explanation | q.points | `warn` | Corrective feedback (template below) |
| Fully correct with sound mechanism | q.points | `full` | `""` (empty — no feedback needed) |

**Corrective feedback template** (use exactly):
> "While we gave you credit for your response, it may be incorrect. Here is the instructor answer: {expected_response}"

If `expected_response` is not set on the question, substitute a concise correct explanation in its place.

**You must read each answer and evaluate its correctness** — do not leave feedback blank simply because an answer is non-empty. Any answer that is wrong, vague, or mechanistically unsound must receive corrective feedback even when full credit is awarded.

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
- `"zero"` — score is 0; only for blank, completely off-topic, or gibberish answers
- `"warn"` — score is full credit **and** feedback is non-empty; use for: wrong-but-relevant answers, correct conclusion with wrong mechanism, vague answers, hedging — displays as yellow in admin UI
- `"full"` — score is full credit **and** feedback is empty; only for fully correct answers with sound reasoning — displays as green in admin UI

**Key rule**: A student who is clearly trying to engage with the right physics concept — even if their answer is factually wrong — gets `warn`, NOT `zero`. Reserve `zero` for blank responses and answers that show no engagement with the topic at all.

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
  "total_score": {N},
  "max_total": {N},
  "is_finalized": false,
  "graded_at": "{ISO timestamp}"
}]
```

Send all students in a single batch upsert. The `UNIQUE(student_id, assignment_id)` constraint means re-running the skill updates suggestions without creating duplicates.

After writing all scores, report: "Wrote suggested scores for {N} students ({day_filter} sections). Scores are marked is_finalized=false — instructors must review and finalize in the admin panel."

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
- Yellow-highlighted scores are Codex suggestions awaiting instructor review
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

---

## Important Rules

1. **Never finalize scores** — always write `is_finalized: false`. Instructors confirm in the admin panel.
2. **Never deduct without feedback** — every score below full credit must have a non-empty `feedback` string.
3. **Wrong or vague answer = mandatory feedback** — if a student's answer is factually incorrect, uses a vague mechanism, or hedges without explanation, you MUST write corrective feedback even when awarding full credit. An empty `feedback` field is only acceptable when the answer is fully correct with sound reasoning.
4. **Be liberal** — a student who shows any physics reasoning gets near-full credit on free-response.
5. **Protect the service key** — never print `SUPA_KEY` in the output. Reference it as `[service_key]` if you need to show a sample request.
6. **Re-running is safe** — the upsert with `merge-duplicates` updates existing suggestions without touching finalized scores.
7. **Merge analysis reports** — when `DAY_FILTER` is set, always fetch the existing `analysis_report` and merge, so M and T runs don't overwrite each other.
