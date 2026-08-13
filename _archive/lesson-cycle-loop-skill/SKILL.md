---
name: lesson-cycle-loop
description: >
  NIGHTLY LOOP ARMING — arms and supervises exactly one recurring unattended grading
  loop on this machine (job 2: phys-110 and phys-310, 00:33 America/Denver). Reads
  `docs/operations/SCHEDULED-LESSON-CYCLE.md` and `references/MASTER-PROMPT.md`;
  writes a scheduler entry in session state and nothing to disk or the database.
  Use when the user wants to start, re-arm, inspect, or stop the overnight grading
  loop, or is opening a fresh session after the previous one closed. Triggers:
  "start the nightly loop", "re-arm the lesson cycle loop", "set up overnight
  grading", "the loop died", "restart the loop", "loop for lesson cycle",
  /lesson-cycle-loop. NOT for grading a lesson — one lesson, one track is
  `lesson-cycle`, which this loop delegates to and never reimplements; NOT for
  job 1 (phys-215, Linux box), which is a shell wrapper outside this repo that
  this skill must never touch. Requires both credential files, the `.venv`, and
  the textbook corpus, so it runs only on the course director's Windows box.
  Argument: none to arm, `stop` to disarm, `status` to inspect.
---

# Lesson Cycle Loop — arm one unattended nightly grading loop

This skill owns **one armed loop and its supervision**. It owns no grading logic, no aggregation
logic, and no deadline logic — all of that is `lesson-cycle`, which this loop invokes inside a
throwaway subagent. If you find yourself writing a grading rule here, it belongs there.

Why it exists: the loop is a scheduler entry held **in session state, which nothing
version-controls**. When the terminal closes, the procedure is gone. `docs/operations/SCHEDULED-LESSON-CYCLE.md`
records *that* job 2 exists and why it is shaped the way it is; this skill is the copy that can be
*executed* to bring it back.

```
/lesson-cycle-loop          arm it (or report it is already armed)
/lesson-cycle-loop status   show the entry and when it expires
/lesson-cycle-loop stop     disarm it
```

Read [`docs/operations/SCHEDULED-LESSON-CYCLE.md`](../../../docs/operations/SCHEDULED-LESSON-CYCLE.md)
§"Job 2" before arming. It carries the rationale this skill deliberately does not restate — why
00:33, why no wrapper, and where job 2 is genuinely weaker than job 1.

---

## Step 0 — Preflight: refuse rather than arm a loop that cannot run

Check all four. **Any failure stops the arming** — an armed loop that fails every night at 00:33 is
worse than no loop, because nothing is watching to notice.

1. **Right machine.** This job needs the `.venv`, both credential files, and the ~968 MB textbook
   corpus, all of which are per-machine (CORE.md §3). Verify:
   ```
   ./.venv/Scripts/python.exe supabase/admin/app_tier_check.py
   ./.venv/Scripts/python.exe scripts/grounding/check_grounding.py
   ```
   If either fails, **stop and report which one, with its output.** Remedy: run `/setup-preflight`
   for a missing grading config, or `docs/operations/MACHINE-SETUP.md` for a fresh machine. Do not
   arm a loop whose subagents will refuse gate 1 or gate 3 every night.

2. **No loop already armed.** List the scheduler's entries. **If one already covers this loop, do
   not create a second** — two entries means two masters racing on the same worklist, each spawning
   its own grading subagent for the same lesson. Report the existing entry's id and cadence and
   stop. This is the idempotency mechanism: *skip-if-present, keyed on an existing entry whose
   prompt names the nightly PREP run.*

3. **Course disjointness with job 1.** Job 1 grades **phys-215** on another box at 01:00; job 2
   grades **phys-110 and phys-310** here at 00:33. They overlap in wall-clock time, so the *only*
   thing keeping them safe is that their course sets do not intersect. **If the loop being armed
   names phys-215, or any course job 1 covers, stop and report the collision.** Two agents writing
   `grades` and `analysis_reports` for one offering with different views of the cohort is the
   failure this prevents.

4. **Session-only, and say so out loud.** The entry lives in memory, dies with the terminal, and
   auto-expires after 7 days regardless. State the expiry date when you arm it. A director who
   believes this survives a reboot will discover otherwise on a night that mattered.

## Step 1 — Arm it

Create one recurring entry, `33 0 * * *` (00:33 local), whose prompt is the master protocol in
[`references/MASTER-PROMPT.md`](references/MASTER-PROMPT.md).

**Copy that prompt through unmodified.** It is not a summary of the procedure — it *is* the
procedure, and every paragraph in it was bought by a failure described in
`SCHEDULED-LESSON-CYCLE.md` §"Gotchas this job has already paid for". Editing it down to something
that reads better is how the gates come off.

Then confirm to the user, in this order: the entry id, the cadence in plain words, the courses it
covers, the expiry date, and how to stop it.

**Do not run the cycle immediately on arming.** Unlike a generic interval loop, this one is tied to
a deadline that passes at a specific hour; firing it at arming time means running the worklist in
the middle of the afternoon, when either nothing is due or a track is still open. Arm it and let
00:33 come. If the user explicitly wants tonight's work done now, that is `/lesson-cycle`, not this.

## Step 2 — What the master does when it fires

The master's own token use is the entire point of this design, so it does **the cheap part only**:

1. Run `worklist --course phys-110 --latest`, then the same for phys-310. **Two subprocess calls, in
   the master's own context** — spawning an agent to make two calls costs more than the calls.
2. A line beginning `RUN:` means work exists. `SKIP:` or empty output means none. **`worklist` does
   not validate course codes** — an unknown course returns empty, which is indistinguishable from
   "nothing due". A typo in a course code therefore reads as a quiet, successful night forever.
3. If neither returns `RUN:`, say so in one line and stop. **Do not investigate, do not read files,
   do not spawn anything.** Most nights end here and must cost almost nothing.
4. If phys-110 has work, spawn **one** background subagent for it (Step 3). Wait for it. Then wait
   10 minutes and repeat for phys-310 if it returned `RUN:`.
5. Re-run the worklist for whichever courses ran, until both return `SKIP:` or empty.

**Every gate runs inside the subagent, never here.** The master must not pre-run the grounding
check, the tier check, or the REST probe "to save the subagent time" — the subagent runs them
anyway, so a helpful master pays for each one twice and inflates the context this design exists to
keep small.

## Step 3 — What the subagent is told

One subagent per course, one lesson, one day track. The prompt template is in
[`references/MASTER-PROMPT.md`](references/MASTER-PROMPT.md) §"Subagent prompt" — open it when you
reach this step. It must always carry, without exception:

- **The runbook is authoritative.** Instruct it to read `.ai/skills/lesson-cycle/SKILL.md` in full
  and follow it step by step; where the prompt and the runbook disagree, the runbook wins and the
  disagreement gets reported.
- **All four gates, run by the subagent itself**, before any write: `app_tier_check.py`, a REST
  probe against schema `app`, `check_grounding.py` exiting 0, and a live re-read of the due date
  confirming the deadline has passed.
- **The hard limits:** no commit, no push, no DDL, no writes to any private agent memory store
  (CORE.md §0 requires it stay empty here), destructive ops snapshot-first.
- **A demand that it state what it SKIPPED and why**, and surface anything a human must decide.
  Silence reads as coverage.

## Step 4 — Report, then hold

Report per course: what was graded, what was skipped, and what a human must decide. Keep it short —
the grading detail lives in `app.analysis_runs`, and the subagent's transcript is discarded on
purpose so hundreds of student answers never accumulate in the session.

Then hold until the next fire. **Re-arm before the 7-day expiry**, and immediately on any new
session, by re-running this skill.

---

## Refusals are outcomes, not failures

Four things stop a night's run. **Each is the system working.** Report which one and stop; do not
work around it.

| The loop stops when | Because | Who unblocks it |
|---|---|---|
| the tree is dirty, or behind `origin/main` | someone may be mid-task, and a checkout predating a deadline rewrite must not act on "the deadline that just passed" | a human merges or commits, then re-triggers |
| a credential gate fails | the free tier auto-paused, or a password rotated | a human, out of band |
| grounding does not resolve 58/58 | grading would run ungrounded, warn **once**, and look identical downstream | a human fixes `textbook_base_path` |
| a track's deadline has not passed | grading work students are still editing | nobody — wait for the deadline |

**Never self-heal a dirty or divergent tree.** This is a standing decision by the course director
(2026-08-10) and it has already been violated once by a subagent that fast-forwarded `origin/main`
rather than stopping. The cost — a blocked night whenever someone pushes — was accepted knowingly.

---

## Rules

1. **One armed entry, ever.** Check before arming; a second entry races the first on the same
   worklist (Step 0.2). Skip-if-present is the mechanism, not vigilance.
2. **The master runs the worklist and nothing else.** Every gate, every read, every write happens
   inside a subagent. A master that "just checks something first" pays for it twice (Step 2).
3. **Copy the master prompt verbatim.** It is the procedure, not a description of it; each
   paragraph was bought by a real failure (Step 1).
4. **Courses must stay disjoint from job 1.** phys-215 belongs to the other box. Adding a course to
   either job means checking it is absent from the other (Step 0.3).
5. **No commit, no push, no DDL, from the master or any subagent.** Enforced by instruction only —
   this job has no `--disallowedTools` layer, which is exactly why the instruction is absolute.
6. **A refusal is a correct outcome.** Report which gate and stop. Never fast-forward, stash, or
   commit to clear the way (see the table above).
7. **Session-only, and stated as such.** Announce the expiry when arming; re-arm weekly and on
   every new session (Step 0.4). Silence is not an alarm here — there is no alarm.
8. **This skill writes nothing to the database or the repo.** Every write happens inside
   `lesson-cycle` and its two sub-skills, under their guards. Composing a REST call or SQL here
   means you are in the wrong file.
