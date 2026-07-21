> **Starter stub**, drawn from the repository's operating contract (`.ai/instructions/CORE.md`) and
> project reference (`.ai/instructions/PROJECT.md`). Those files remain authoritative — if this page
> and they ever disagree, they win, and this page is the bug. Review before the semester opens.

Two AI workflows touch course data. Both are run deliberately by a person; neither runs on a
schedule, and neither can publish a grade on its own.

## Preflight analysis

Run against one assignment and one day (M or T). It fetches the submitted responses, reads the
relevant textbook sections to ground itself, and writes back:

- a **suggested score and feedback per question**, always `is_finalized = false`
- a **per-instructor misconception report**, aggregated across the sections assigned to each
  instructor, which is what the Report tab renders

Running M and T separately is safe — each run replaces only its own instructors' entries and leaves
the other day's intact.

### The grading rules it follows

Three states only — `full` (green), `warn` (yellow), `zero` (red) — and **yellow carries full
credit**. Yellow is a flag on an answer that was wrong or vague, paired with feedback that corrects
it. The posture is deliberately liberal: preflights measure pre-class engagement, not mastery.

### Hidden diagnostics

The run also writes a per-student assessment that sits beside the grade and never becomes one:
two 0–5 integers — engagement with the reading reflection, and demonstrated understanding on the
physics question — plus an overall effort and understanding read, the misconceptions the answers
showed, and follow-up flags. **None of it is a grade.** It never affects points, feedback, status,
totals, or finalization, and no student-facing page requests or renders any of it. It exists to
measure the instrument, not the student, and to let a written preflight be summarized the same way
an interactive lesson is. Per-student values are never displayed individually.

## Lesson aggregation

Run **after a lesson's due date**, once, across the whole cohort. It reads the per-student
assessments and produces section-level panels — readiness summary, misconception trends, showcase
quotes — for the lesson rollup.

**It covers both ways a lesson can be worked.** Students who took the interactive artifact and
students who answered the question set are summarized together, because both now produce the same
per-student assessment. Where the two genuinely differ, the rollup says so rather than blurring
them: effort is one measurement across both paths (the reading reflection is the same question
either way), while understanding is reported per objective for the artifact and as a single
free-response measure for the question set.

Interactive lessons are graded on **effort** (0–5); a reading reflection that is not a genuine
attempt caps effort. How effort becomes points depends on how the assignment is set up for the
semester: an assignment set to **effort** grading has the database convert it automatically, while
one set to **points** — which is how every Fall 2026 preflight is currently scheduled — has the
analysis run apply the same 0–5 scale when it writes the score. The scale is identical either way;
only who applies it differs.

**Grading and aggregation are separate runs on purpose.** Grading happens whenever work needs
scoring, often M-day and T-day separately. Aggregation happens once, after the deadline, over the
whole class — a readiness summary written over half a cohort would describe a class that does not
exist.

## The line that does not move

**A human finalizes every grade.** AI output is a first pass in the grading panel and nothing
more. Suggested scores are invisible to students until an instructor reviews and finalizes them,
and an instructor can overwrite any of it.

## When AI writes to the live system

There is one production database and one live site, shared by everyone. Agents operating on it
follow the contract in `.ai/instructions/CORE.md`:

- one designated operator per change; no two agents mutating the same area at once
- every state-changing run recorded in `CHANGELOG.md`, attributed to the human and the agent
- destructive operations snapshot to JSON first, verify the snapshot, and require an explicit
  commit flag — dry-run is the default
- schema changes are coordinated in advance and never run concurrently

Anything an agent "remembers" privately is not shared and does not count. If a fact matters to
whoever works next, it lives in the repository.
