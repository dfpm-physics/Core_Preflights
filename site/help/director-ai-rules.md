> **Starter stub**, drawn from the repository's operating contract (`.ai/instructions/CORE.md`) and
> project reference (`.ai/instructions/PROJECT.md`). Those files remain authoritative — if this page
> and they ever disagree, they win, and this page is the bug. Review before the semester opens.

Two AI workflows touch course data, and a third simply runs them in order. **Neither of the two can
publish a grade on its own** — everything they write is a suggestion an instructor finalizes.

There is one AI-derived grade that *is* published without review, and it does not come from these
workflows: a **graded interactive lesson** grades itself from the effort the lesson assessed, the
moment a student submits. *How effort becomes points*, below, covers it.

## Preflight analysis

Run against one assignment and one day (M or T). It fetches the submitted responses, reads the
relevant textbook sections to ground itself, and writes back **one thing**: a **suggested score and
feedback per question**, always `is_finalized = false`, plus the hidden per-student assessment
described below.

**It also zeroes the students who submitted nothing** (added 2026-07-30). Anyone past their own
deadline with no work in and **no active extension** gets a zero — no points, understanding 0,
feedback *No submission received.* — written exactly like every other suggestion, unfinalized and
AI-sourced. Before that they had no grade row at all, which was a weaker claim than the gradebook
was already making: it counted a past-due non-submission as zero in the running total while showing
a dash in the cell, so the percentage could not be reconciled against the row it came from.

Two consequences worth knowing. **The extension case needs no special handling** — an unfinalized
AI-sourced row is what a later run overwrites, so granting an extension and letting the cadet
submit replaces the zero by itself; once you have *published* the column, reopen the grade first.
And **it changes no class-level number**: aggregation reads students who have a submission, and a
non-submitter has none, so the effort distribution and readiness prose are untouched.

It produces no class-level output at all. It used to also write a per-instructor misconception
report; that was retired in July 2026, because an instructor is not a unit of analysis — a single
report pooled all of an instructor's sections, so it could never be shown for one section. Anything
about the class as a whole now comes from assignment aggregation.

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

## Assignment aggregation

Run **after a day track's deadline**. It reads the per-student assessments and produces the AI text
on the assignment rollup: a short readiness summary, a one-line teaching recommendation under the
misconception bars, and the showcase quotes.

**The readiness summary is written per instructor**, covering every section you teach at once, with
any section that genuinely differs called out beneath it by name. Two sections of the same assignment
used to get two separate summaries written as though the other did not exist, so nothing told you
whether a gap was your whole cohort or one section. Viewing a single section shows its own numbers,
quotes and recommendation, with your summary above them.

It is deliberately **two or three sentences**. What the class can do, what it cannot, what to cover
first — the charts directly above it already carry the numbers.

**Sections are summarized first, then the course.** The whole-course view is written from the
section summaries rather than by re-reading everyone, which is what makes the second run cheap: on
M-day it summarizes the M sections, on T-day the T sections, and only then does it write the
course-level view covering all of them. A course-wide summary is never written over a partial
cohort — if a section has not been aggregated yet, the whole-course panel simply waits.

**"M-day and T-day" is about the deadlines, not the calendar.** Whether your two tracks close on
different days depends on how the course sets its due dates: Physics 215 gives each section its own
deadline, so its two runs really are a day apart, while Physics 110 mostly leaves both on the
assignment's single deadline, so both tracks close the same night and the two runs happen back to
back. Either way it is still one run per track, and the whole-course panel still appears only after
the second.

**It also reconciles misconceptions.** Both the artifact and the grading run may invent a label for
a misunderstanding that does not fit the known list, so the same misunderstanding can arrive under
two names and split into two bars. Aggregation records which invented labels mean the same thing,
and the rollup merges them from then on — the popover on a merged bar lists the other names it
absorbed.

**It covers both ways an assignment can be worked.** Students who took the interactive artifact and
students who answered the question set are summarized together, because both now produce the same
per-student assessment. Where the two genuinely differ, the rollup says so rather than blurring
them: effort is one measurement across both paths (the reading reflection is the same question
either way), while understanding is reported per objective for the artifact and as a single
free-response measure for the question set.

## How effort becomes points

Interactive lessons are graded on **effort** (0–5); a reading reflection that is not a genuine
attempt caps effort at 2, so at most partial credit however much work went in elsewhere.

**The database converts effort to points, and it does so on any grade that carries an effort
score** — 0 earns nothing, 1–2 earns **one point**, 3 or more earns **whatever the assignment is
worth**. Partial credit is a flat point, not a fraction of the lesson: a cadet who engaged a little
earns the same single point on a 3-point lesson as on a 2-point one, while full credit scales with
the assignment. (Partial credit was half the assignment until 30 July 2026. Half of 2 is 1, so
nothing changed for a 2-point preflight — the rule was rewritten when the first 3-point assignment
made "half" mean 1.5, a score no written student on the same lesson could be given.) It does *not* depend on how the
assignment is configured for the semester. That matters because an assignment can offer both paths
for credit at once, and one setting on the assignment could not describe two modalities: a written
student is graded from their question scores and an interactive student from their effort, on the
same assignment, in the same week.

**A graded interactive lesson writes that grade for itself, finalized, the moment the student
submits.** There is no review step and nothing for you to publish — effort is what the lesson
measured, and the conversion above is arithmetic rather than judgement. You can still change the
grade afterwards, and a grade you have already finalized by hand is never overwritten by it.

An interactive activity marked **practice** produces no grade at all, however much work a student
does on it.

**That also makes the first report the only report.** Because the grade is finalized on submission,
a student who runs the lesson again cannot replace it — the submit page refuses, and so does the
database behind it. If a report needs redoing, reopen the grade and the student can submit again.
This is the opposite of the retired system, where every re-submission silently overwrote the last
one, so an artifact that still tells cadets "you can always resubmit" is wrong and should be
rebuilt.

> Until 2026-07-27 this section said the conversion depended on an assignment-level *effort* or
> *points* setting, and that the analysis run applied the scale for points-mode assignments. Both
> stopped being true on 2026-07-23; the analysis run has never graded interactive work.

**Grading and aggregation are separate steps on purpose.** Grading is per student and happens
whenever work needs scoring. Aggregation is per section and happens after that section's deadline —
a readiness summary written over half a *section* would describe a class that does not exist.

## Running both together

There is a third workflow that simply runs the two in order for one assignment and one day: grade
everything that closed, then summarize it. It adds the checks that only make sense between the two
steps — that the deadline has actually passed, and that grading produced the assessments the
summary reads.

This is also the workflow to point a scheduler at if you want the cycle to run unattended after
each deadline. Nothing schedules itself today; setting that up is a deliberate act, and an
unattended run deliberately stops short of publishing anything to the live site.

## The line that does not move

**A human finalizes every grade the AI *suggests*.** Everything preflight analysis writes is a
first pass in the grading panel and nothing more: suggested scores are invisible to students until
an instructor reviews and finalizes them, and an instructor can overwrite any of it.

The one exception is deliberate and narrow, and it is worth stating rather than leaving implied: a
**graded interactive lesson** publishes its own effort grade on submission, unreviewed. What makes
that acceptable is that no judgement is being delegated — the lesson reports a 0–5 effort score and
a fixed rule turns it into points. An instructor can change it afterwards like any other grade.
Nothing else in PREP publishes a grade without a person.

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
