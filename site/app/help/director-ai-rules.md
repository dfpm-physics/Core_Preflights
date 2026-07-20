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

The run also writes two 0–5 integers per submission — engagement with the reading reflection, and
demonstrated understanding on the physics question. **These are not grades.** They never affect
points, feedback, status, totals, or finalization, and no student-facing page requests or renders
them. They exist to measure the instrument, not the student. Faculty-facing visualization of them
is deliberately deferred.

## Interaction aggregation

Run after an interactive lesson's due date. It reads the cohort's session reports and produces
section-level panels — readiness summary, misconception trends, showcase quotes — for the lesson
rollup. Interactive lessons are graded on **effort** (0–5); a reading reflection that is not a
genuine attempt caps effort. How effort becomes points depends on how the assignment is set up for
the semester: an assignment set to **effort** grading has the database convert it automatically,
while one set to **points** — which is how every Fall 2026 preflight is currently scheduled — has
the analysis run apply the same 0–5 scale when it writes the score. The scale is identical either
way; only who applies it differs.

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
