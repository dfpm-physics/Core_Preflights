> **Starter stub**, drawn from the repository's operating contract (`.ai/instructions/CORE.md`) and
> project reference (`.ai/instructions/PROJECT.md`). Those files remain authoritative — if this page
> and they ever disagree, they win, and this page is the bug. Review before the semester opens.

Two AI workflows touch course data, and a third simply runs them in order. None can publish a grade
on its own.

## Preflight analysis

Run against one assignment and one day (M or T). It fetches the submitted responses, reads the
relevant textbook sections to ground itself, and writes back **one thing**: a **suggested score and
feedback per question**, always `is_finalized = false`, plus the hidden per-student assessment
described below.

It produces no class-level output at all. It used to also write a per-instructor misconception
report; that was retired in July 2026, because an instructor is not a unit of analysis — a single
report pooled all of an instructor's sections, so it could never be shown for one section. Anything
about the class as a whole now comes from lesson aggregation.

Running M and T separately is safe: each run only touches the students it graded.

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

Run **after a day track's deadline**. It reads the per-student assessments and produces every AI
panel on the lesson rollup: the readiness summary (including the common threads across the reading
reflection and the graded physics question), misconception trends written for whichever scope you
are viewing, a one-line teaching recommendation beneath them, and the showcase quotes.

**Sections are summarized first, then the course.** The whole-course view is written from the
section summaries rather than by re-reading everyone, which is what makes the second run cheap: on
M-day it summarizes the M sections, on T-day the T sections, and only then does it write the
course-level view covering all of them. A course-wide summary is never written over a partial
cohort — if a section has not been aggregated yet, the whole-course panel simply waits.

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

**Grading and aggregation are separate steps on purpose.** Grading is per student and happens
whenever work needs scoring. Aggregation is per section and happens after that section's deadline —
a readiness summary written over half a *section* would describe a class that does not exist.

## Running both together

There is a third workflow that simply runs the two in order for one lesson and one day: grade
everything that closed, then summarize it. It adds the checks that only make sense between the two
steps — that the deadline has actually passed, and that grading produced the assessments the
summary reads.

This is also the workflow to point a scheduler at if you want the cycle to run unattended after
each deadline. Nothing schedules itself today; setting that up is a deliberate act, and an
unattended run deliberately stops short of publishing anything to the live site.

## The line that does not move

**A human finalizes every grade.** AI output is a first pass in the grading panel and nothing
more. Suggested scores are invisible to students until an instructor reviews and finalizes them,
and an instructor can overwrite any of it.

**The traffic is one-way: a re-run never overwrites a person's work.** It skips any grade an
instructor has finalized, and any grade an instructor has edited — including one saved as a draft
and not yet published. An afternoon of adjusted scores and rewritten comments cannot be reverted by
running the analysis again.

Students who submit late under an extension are not picked up by a re-run, because the run happened
before they submitted. They are listed for their instructor to grade by hand instead; re-running a
whole assignment to catch a few late submissions is explicitly not the way.

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
