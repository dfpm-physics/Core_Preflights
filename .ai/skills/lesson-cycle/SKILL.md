---
name: lesson-cycle
description: >
  End-to-end post-deadline run for ONE lesson: grade every submission, then aggregate the cohort.
  Sequences /preflight-analyze (per-student grading, feedback, effort and understanding) and
  /lesson-aggregate (per-section and whole-course readiness summary, misconception trends,
  recommendation, showcase quotes) in that order, for one day track at a time.
  Use when a director says "run the lesson cycle", "grade and aggregate <lesson>", "close out
  preflight-08", or /lesson-cycle — and as the entry point for an unattended scheduled run after a
  section's submission deadline. Run it once after the M-day deadline and again after the T-day
  deadline; the second run grades and aggregates only T sections and then completes the
  whole-course scope.
  Requires BOTH credential files (the service-role config for grading, supabase/admin/.env for the
  aggregator). Run by a Course Director or System Admin.
---

# Lesson Cycle — grade, then aggregate, one lesson at a time

This skill owns no domain logic of its own. It is **sequencing plus the checks that only make
sense between the two steps**: that the deadline has passed, that grading actually produced the
per-student assessments the aggregator consumes, and that the whole-course scope is only written
once every section exists.

```
/lesson-cycle <course> [assignment-slug] [day]
```

`/lesson-cycle phys-215` — show what is past due and ask which to run.
`/lesson-cycle phys-215 preflight-02 M` — that lesson's M-day sections, no prompt.

Named lesson or not, it is always **one** lesson per invocation. The scheduler picks it with
`worklist --latest`; a human picks it from the list. Nothing ever processes a queue.

Both sub-skills remain independently invokable. Run `/preflight-analyze` alone when you want to
grade mid-week without touching the rollup; run `/lesson-aggregate` alone to re-aggregate after a
regrade.

---

## Why this is one skill and not a merge of two

The two halves have genuinely different shapes and must not be blended:

| | `/preflight-analyze` | `/lesson-aggregate` |
|---|---|---|
| unit | one student | one section, then the course |
| writes | `grades` only | `analysis_reports` only |
| credential | service_role via PostgREST (`~/.claude/skills/preflight-analyze/config.json`) | `prep_app_dml` via psycopg2 (`supabase/admin/.env`) |
| safe to re-run | yes, idempotent per student | yes, merges per scope |

What this skill adds is the **ordering guarantee**: aggregation reads the `schema: 1` assessment
that grading writes, so running them out of order produces a cohort summary over a half-assessed
class. `pull` warns about that, but by then you have already spent the run.

---

## Step 0 — Preflight (both halves, before anything runs)

1. **Both credentials.** `~/.claude/skills/preflight-analyze/config.json` must exist (grading) and
   `supabase/admin/.env` must carry `PREP_APP_DML_ROLE`/`_PASSWORD` (aggregation). A run that has
   only the first grades and then fails at the aggregation step, leaving the lesson half-done.
   ```
   .venv/Scripts/python supabase/admin/app_tier_check.py
   ```
2. **Clean tree, current branch.** `git status --porcelain` empty and `git fetch` showing no
   divergence from `origin/main`. **Refuse to run otherwise** — see the coordination note below.
3. **Announce the scope** before writing anything: course, lesson, day track, section codes, and
   how many students are in scope.

## Step 1 — Choose the lesson. The two paths differ here, and the difference matters.

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py worklist --course <code> [--day D] [--latest] [--json]
```

`--as-of <ts>` is a read-only **rehearsal**: it moves the clock for the "which tracks are past
due" test only, prints a banner, and writes nothing. Use it to see what a close-out will look like
before its deadline — the states worth practising on do not otherwise exist until the night they
matter. Never pass it on the automated path.

### Automated (`--latest`) — one lesson, never a sweep

Take **only the most recently due day track**, and run it only when `action` comes back `run`.
If it comes back `skip`, record a `skipped` run and stop.

**Two tracks can share one deadline**, and then "the most recently due track" names two rows
rather than one. Per-day deadlines are a per-course habit, not a rule the schema enforces:
phys-215 sets them on every offering so its M and T tracks close a day apart, while phys-110 sets
them on almost none, so both its tracks fall back to the offering default and close at the same
instant. `--latest` picks the tied track that still needs a run — so the second call after the
first track lands offers the sibling rather than re-offering the finished one. That is not the
backwards walk forbidden below: every tied row carries the deadline that just passed. It still
takes one track per invocation, so a same-instant lesson is two runs back to back.

**Do not walk backwards through the term**, however tempting an older "unanalyzed" lesson looks.
That state is usually legitimate: a student on an approved extension submits days late, and late
submissions are accepted by hand. **Both are graded manually on purpose.** A scheduler that swept
up every outstanding lesson would re-grade those cohorts unattended and overwrite exactly the human
judgement that handling them by hand was for. One lesson: the one whose deadline just passed.

### Manual (no `--latest`) — show the list and ask

Print the work list for the course and **ask which lesson to run**. It gives every past-due day
track with its deadline, sections, submission and assessment counts, and whether it has been
analyzed. Do not guess, and do not default to the newest — the reason a human is running this by
hand is often that they want an *older* one.

**Re-running an already-analyzed lesson is allowed and is frequently the point** — a late or
extension submission has just been graded by hand and the rollup should now include it. Confirm the
choice, then proceed. The re-run is safe: grading skips finalized rows and every question that
already carries an instructor's feedback, and aggregation merges per scope.

### Then, whichever path chose it: confirm that track is closed

Read the effective deadline for each section in the chosen track (`assignment_offerings.due_at`,
overridden by `assignment_due_dates`; `schema.js effectiveDue()` is the definition). `worklist`
only returns past-due tracks, so this is a re-check rather than a discovery — but the clock moves
and an override can be edited between the two calls.

**If a section in the chosen track is still open, stop** and say which one and when it closes.
Grading an open section produces suggestions against work students are still editing.

Per-student **extensions are deliberately not consulted here.** A cycle waits for the *section*
deadline, not for the last extended student — otherwise one extension would hold the whole class's
rollup hostage. Extended students are graded by hand from the Grade tab's "Extensions ready to
grade" queue afterwards, and the lesson can be re-run through the manual path once they are in.

## Step 2 — Grade (skip when there is nothing to grade)

**Only if the lesson has a written activity with at least one graded free-response question.**
A purely interactive lesson has nothing for this half to do: the artifact already wrote each
student's `schema: 1` at submit time. Say so and go to Step 3.

Run `/preflight-analyze <course> <assignment-slug> [day]` — read that SKILL.md and follow it. It
writes `grades` and nothing else. It skips a row that is `is_finalized = true`, and inside an
instructor's unpublished draft it protects each **question** that carries feedback while grading
the ones that carry none — so a cadet whose instructor commented on Q2 and left Q3 blank is graded
on Q3 rather than dropped.

**Before continuing, verify grading actually produced what the aggregator needs.** Every graded
enrollment must carry a `schema: 1` payload in `grades.diagnostic`. If the skipped-row counts are
non-zero, those students have no assessment and will be a denominator with nothing in it — decide
whether to proceed or fix them by hand first, and say which you chose. A guard-2 merge is **not**
one of those: it writes the full diagnostic, so a partially instructor-graded student now counts.

## Step 3 — Aggregate

Run `/lesson-aggregate` — read that SKILL.md and follow it — with the same day filter:

```
.venv/Scripts/python supabase/admin/lesson_aggregate.py pull \
  --lesson <assignment-slug> --day <DAY> --out <scratch>/agg.json
```

Then, per its Step 3: write this day's section scopes, and the `__all__` scope **only when
`coverage.complete` is true**. Sections aggregate first; the course scope is synthesized from
those section summaries plus `prior_scopes[]` — the other day's stored prose — never by re-reading
the first day's cohort.

Write back with `--dry-run` first, then commit, then `status --day <DAY>`.

**Process sections sequentially. Do not fan out subagents.** The pull file already carries a
self-contained scope per section; a plain loop keeps each step small and scales to a 20-section
course. Parallelism buys wall-clock time that a post-deadline run does not need.

## Step 4 — Record the run in `app.analysis_runs`

**Not `CHANGELOG.md`.** A term is ~40 lessons closed out twice each; 80+ hand-written entries would
bury the changes that file exists for, and an instructor cannot read it anyway. The audit trail for
an analysis run lives in the database beside the data it describes.

Each sub-skill writes its own row. This skill writes one more for the cycle itself, so a reader can
tell "the cycle ran and did both halves" from "someone ran grading alone".

- **Before Step 2**, insert with `status='running'`, `skill='lesson-cycle'`, `invoked_by='human'`
  or `'scheduled'`, the course/assignment offering, and `day_track`.
- **At the end**, update it: `status`, `finished_at`, a one-line `summary`, and `detail`.

`detail` keys for this skill:

```json
{ "graded": true, "graded_students": 32, "skipped_finalized": 4, "skipped_instructor": 0,
  "filled_questions": 2, "filled_rows": 1,
  "scopes_written": ["M1A", "M3A"], "all_scope": "deferred",
  "all_scope_reason": "awaiting-track",
  "sub_runs": ["<analysis_runs.id of the grading run>", "<…of the aggregation run>"] }
```

`filled_questions` / `filled_rows` come straight from the grading run — individual questions that
carried no feedback from anybody, graded inside an instructor's draft without touching the
questions they had graded (`preflight-analyze` Step 9, guard 2). Copy them through even when zero.
Those students now reach the aggregation half too, because a guard-2 merge writes the full
`schema: 1` diagnostic; before 2026-08-11 they were dropped whole and contributed nothing to the
cohort.

Status: `success` when both halves completed; `partial` when it ran but left something owed that
**nobody is already on their way to delivering**; `skipped` when it correctly declined — deadline
not passed, or no graded free-response question to grade; `failed` with `error` set when it
stopped on an error. **A run that dies without updating its row leaves `status='running'`, which is
the point** — that is how an abandoned overnight run becomes visible.

**A deferred `__all__` is not by itself `partial`.** Deferring it to the second day track is the
two-run cycle working as designed, and reporting that as `partial` put a yellow banner in front of
every director on roughly half of all nightly runs. Copy the aggregation sub-run's verdict: take
`all_scope_reason` from the `lesson-aggregate` row and use `success` for `awaiting-track`,
`partial` for `sections-missing`, `stale-prior` or `withheld`. That vocabulary, and what each
reason means, is in `.ai/skills/lesson-aggregate/SKILL.md` Step 4.

**`summary` is read by a person, on a phone.** `site/js/run-banner.js` prints it verbatim under the
nav on every faculty page. Write plain sentences; keep uuids and `instr:<uuid>` scope keys in
`detail`, where the aggregation writer also puts them.

Still write a `CHANGELOG.md` entry when a run does something a *future maintainer* needs to know
about — a schema change, a bulk correction, a one-off repair. Routine grade-and-aggregate cycles
are not that.

---

## The two-run cycle

A lesson with split deadlines is closed out in two passes, and the second is cheap:

| run | grades | aggregates | `__all__` |
|---|---|---|---|
| after M-day closes | M sections | M sections | **not written** — `coverage.complete` is false |
| after T-day closes | T sections | T sections, reading M's stored prose as `prior_scopes` | written, covering the whole course |

The M-day prose is never rewritten by the T-day run. Between the two runs `status` reports
`__all__` as `STALE`; that is the signal the second pass is owed, not a fault.

A lesson whose sections all meet on one day reaches `coverage.complete` on the first run and writes
`__all__` then.

---

## Running unattended

**Nothing in this repo schedules anything, and this skill does not add a scheduler.** A skill is a
Markdown runbook that needs an agent to execute it, so the unattended path is an agent invocation
that some external scheduler fires. Wire it yourself:

```
claude -p "/lesson-cycle phys-215"
```

**No lesson slug.** The scheduled entry names only the course; Step 1's `worklist --latest` picks
the lesson. A slug baked into a Task Scheduler action would re-run the same lesson every night
forever, which is the obvious way to get this wrong.

One trigger per night is enough — it fires, finds nothing due, records `skipped`, and exits.
Timed for the small hours, so the job never contends with a human mid-session. Keep the working
directory at the repo root so the relative paths in both sub-skills resolve.

Two things a scheduled run must do that an interactive one gets for free:

- **Refuse rather than improvise.** Step 0's dirty-tree and divergence checks, and Step 1's
  deadline check, are what stop an unattended job from grading work in progress or committing on
  top of someone else's uncommitted edits. A cron run that cannot satisfy them must exit non-zero
  with a reason, not carry on.
- **Leave a record.** The `analysis_runs` row from Step 4 is the only trace an unattended run
  leaves. Write it even when the run decided to do nothing — `status='skipped'` with a `summary`
  saying why it declined is a useful entry, and a missing row is indistinguishable from a job that
  never fired.

### The coordination gate, honestly

CORE.md §0 requires a human to designate one operator and confirm no competing agent is mid-run.
**An unattended job cannot do either.** What Step 0 provides — clean tree, no divergence, a
reserved time slot nobody else works in — is a *mitigation*, not a substitute. Two consequences
follow, and they are not negotiable:

- **Never schedule this against a repo another agent is actively working in.** The failure mode is
  not a merge conflict; it is two agents writing `grades` and `analysis_reports` for the same
  offering with different views of the cohort.
- **Do not push from an unattended run.** CORE.md §5's standing authorization names
  `/preflight-analyze` and covers *that skill's* run record. It does not extend to this one, which
  also writes cohort analysis. Commit the CHANGELOG record; leave the push to a human who has
  looked at it. If the director wants the standing authorization widened, that is an edit to
  CORE.md §5 and a decision for them, not an assumption for this skill.

---

## Rules

1. **Order is the point.** Grade, then aggregate. Never the reverse, and never aggregate a lesson
   whose grading you skipped because it "looked done" — check `grades.diagnostic` for `schema: 1`.
2. **One day track per run.** Mixing them re-reads a cohort you already summarized and rewrites
   prose you already accepted.
3. **Never write `__all__` on an incomplete cycle.** `pull` tells you with `coverage.complete`.
4. **This skill writes nothing directly.** Every database write happens inside one of the two
   sub-skills, under their own rules and their own guards. If you find yourself composing a REST
   call or a SQL statement here, stop — it belongs in one of them.
5. **Student text stays in the scratchpad.** The pull file carries reflections and graded answers.
   It never lands under the repo tree.
6. **Report what was skipped, and what was filled.** Finalized grades, fully instructor-graded
   students, questions filled inside an instructor's draft, sections still open, `__all__`
   deferred — a run that silently does less than asked is worse than one that refuses, and one
   that silently does *more* is worse again.
