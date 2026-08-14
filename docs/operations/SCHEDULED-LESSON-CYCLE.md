# Running the lesson cycle on a schedule

**The repo schedules nothing, on purpose.** `.ai/skills/lesson-cycle/SKILL.md` §"Running unattended"
documents the invocation and leaves the scheduler to the operator. This page records the ones that
exist, so the arrangement is discoverable from the repo rather than living in one operator's head
or in an agent's private memory (CORE.md §0 forbids the latter).

**There are two, on two machines, covering disjoint courses:**

| Job | Machine | Courses | Fires |
|---|---|---|---|
| [phys-215 wrapper](#job-1--phys-215-linux-box) | Linux box, `~/projects/Core_Preflights` | phys-215 | 01:00 nightly |
| [phys-110 / phys-310 session loop](#job-2--phys-110--phys-310-windows-box) | Windows box, `d:\01 -- AI Projects\Core_Preflights` | phys-110, phys-310 | 00:33 nightly |

**The disjointness is the safety property, not the schedules.** They overlap in wall-clock time —
job 2 can still be grading when job 1 starts — and that is only safe because no offering is in
scope for both. CORE.md §0: two agents writing `grades` and `analysis_reports` for one offering
with different views of the cohort is the failure the coordination gate exists to prevent. **If a
course is ever added to one, check it is not in the other.**

---

# Job 1 — phys-215, Linux box

*Machine: the Linux box, `~/projects/Core_Preflights`. Set up 2026-08-10. Course: phys-215 only.*

## What runs

| | |
|---|---|
| **Trigger** | user cron, `0 1 * * *` — 01:00 every night, America/Denver |
| **Wrapper** | `~/.local/bin/prep-lesson-cycle.sh` — **outside the repo** (see below) |
| **Logs** | `~/.local/state/prep/lesson-cycle-YYYY-MM-DD.log`, 30-day retention |
| **Notification** | ntfy.sh; the topic is in the wrapper (**do not commit it** — see below) |
| **Writes** | whatever the two sub-skills write. The wrapper itself writes nothing to the DB |
| **Commits / pushes** | **neither, ever** |

## Why 01:00

Preflight deadlines are `23:59:59` America/Denver (CORE.md §2 — the hour is course policy and has
moved before). 01:00 is **61 minutes** after the deadline: late enough that the deadline has
certainly passed, early enough that a human is unlikely to be working the same offering, which is
the mitigation the coordination gate asks for.

## Why every night, not Mon–Fri

SKILL.md: *"One trigger per night is enough — it fires, finds nothing due, records `skipped`, and
exits."* Deadlines currently land Sunday through Thursday nights, so Mon–Fri would cover today's
calendar — but the academy calendar shifts, and a schedule that only *just* covers the deadlines
drops a lesson silently when one moves. A no-op run costs seconds and leaves an `analysis_runs` row
saying it declined.

## Why the cron entry names only the course

```
/home/casey/.local/bin/prep-lesson-cycle.sh     # runs: lesson-cycle, phys-215
```

No lesson slug, no `--day`. Step 1's `worklist --latest` derives **both** the lesson and the M/T day
track from the database. A slug baked into the schedule would re-run one lesson every night forever
— SKILL.md names this as the obvious way to get it wrong.

M-vs-T needs no calendar lookup: `worklist` reads the effective per-section deadlines, so the two
tracks of one lesson close out on consecutive nights by themselves.

## Why the wrapper lives outside the repo

`/lesson-cycle` Step 0 refuses to run on a dirty tree. A script committed under the repo would be
fine, but one *dropped* there untracked leaves `git status --porcelain` non-empty and kills the job
every night. Keeping it in `~/.local/bin/` makes that impossible, and keeps the gitignored ntfy
topic out of a publicly served directory.

## The invocation gotcha

**`claude -p "/lesson-cycle phys-215"` does not work, despite being the form SKILL.md shows.**

Skills live at `.ai/skills/<name>/SKILL.md` as agent-neutral runbooks, and CORE.md §4 forbids
creating a `.claude/skills/` mirror. With no mirror there is no registered slash command, so
`claude -p` answers `Unknown command: /lesson-cycle` in about 40 ms, with `num_turns: 0` — **and
exits 0**. Observed 2026-08-10 during setup of this job.

The wrapper therefore invokes by path — *"Read `.ai/skills/lesson-cycle/SKILL.md` in full and
execute that runbook end to end for course phys-215"* — which is what `CLAUDE.md` instructs an agent
to do anyway.

**It also checks `num_turns` and refuses when the agent took none.** Without that check the job
reports success and notifies OK every night while grading nothing, which is worse than a crash: the
alarm never fires.

## The gates

Each refuses loudly, notifies, and grades nothing. The first three check that credentials **work**,
not that files exist — a file-existence check proves someone edited a file, then fails at minute 20
with the cohort half-graded.

| # | Gate | Catches |
|---|---|---|
| 1 | `supabase/admin/app_tier_check.py` | dead or rotated DB passwords; `public` leaking into scope |
| 2 | REST probe on `/rest/v1/courses` with `Accept-Profile: app` | revoked service key; the free tier auto-pausing the project (CORE.md §1) |
| 3 | `scripts/grounding/check_grounding.py` | **the silent one** — grading runs ungrounded, warns once, and nothing downstream looks different |
| 4 | clean tree | someone's uncommitted edits |
| 5 | `git fetch`, refuse if ahead of `origin/main` | unpushed human work `--ff-only` cannot resolve |
| 6 | `git pull --ff-only` | runs tonight's `main`, not the clone's |
| 7 | `num_turns > 0`, `is_error` false | the no-op described above |

After the run it re-checks for commits and a dirty tree, and says so in the notification — either
would refuse the job at gate 4 or 5 the following night.

**Both jobs gained an eighth check on 2026-08-13, and neither wrapper changed.** It lives in the
skill — `/lesson-cycle` Step 0.3 runs `scripts/checks/orphaned_submissions.py` and stops on exit 1
— so every path that reaches the skill inherits it, including job 2's subagent and any manual run.
It catches a cadet whose submitted work is attached to an enrollment they have since left: the
roster query cannot see the work, and the grading half would otherwise write a **non-submission
zero for an assignment they completed on time**, indistinguishable afterwards from a real zero.
Read-only, stdlib, a couple of seconds. Diagnosis:
[`docs/findings/2026-08-13-orphaned-submission-on-dropped-enrollment.md`](../findings/2026-08-13-orphaned-submission-on-dropped-enrollment.md).
*Listing it in neither table above is deliberate — these tables are the **wrapper** gates, and a
skill-level check that both jobs get for free is exactly the kind of thing that rots when it is
copied into two places.*

## It commits nothing and pushes nothing

SKILL.md says not to push, and to commit the CHANGELOG record. **CORE.md §0 overrides the second
half**: routine analysis runs are explicitly exempt from the CHANGELOG because they record
themselves in `app.analysis_runs`. CORE.md wins by its own precedence rule. A commit would also
leave the branch ahead of `origin/main` and refuse the job at gate 5 the next night.

Both `git commit` and `git push` are denied at the tool layer (`--disallowedTools`), so this is
mechanical rather than a request to the model. The run uses `--permission-mode bypassPermissions`
rather than an allowlist because in `-p` mode an unpermitted call is *denied, not prompted* — a
missed allowlist pattern would quietly produce a half-graded lesson.

## The alarm is silence

Notification is sent from an EXIT trap, so refusals, crashes and the 45-minute timeout all report.
**A night with no notification means cron never fired or the box was asleep** — that is the only
failure the job cannot report on its own.

**ntfy delivers only to a subscribed client.** It is not email and not SMS. The wrapper publishes to
a topic; that reaches a phone only if the ntfy app is subscribed to the topic, or a browser has the
topic page open. Publishing succeeds either way — `curl` returns 200, the log records nothing wrong
— so **a job publishing to a topic nobody is subscribed to is indistinguishable from a working
one**, and the rule above is what hides it: silence is also what a good night looks like. Confirmed
the hard way on 2026-08-10, when a test publish reached the server and no phone. On a new device
subscribe *before* testing; subscribing does not backfill and ntfy.sh buffers 12 hours, so past runs
never appear.

**Do not commit the ntfy topic.** CORE.md §2 records that GitHub Pages already serves `docs/`
publicly, and an ntfy topic is a bearer credential in both directions: anyone who reads it can also
post to it. It stays in the wrapper, outside the repo.

## Operating it

```bash
crontab -l                                   # confirm the entry
tail -f ~/.local/state/prep/lesson-cycle-$(date +%F).log
~/.local/bin/prep-lesson-cycle.sh            # run it by hand; same gates, same notification
crontab -r                                   # disable entirely
```

Before letting it run unwatched against a lesson that matters, run it by hand once and read the
`analysis_runs` row it wrote.

**Never point a second scheduled agent at this working tree.** CORE.md §0: two agents writing
`grades` and `analysis_reports` for one offering with different views of the cohort is the failure
the coordination gate exists to prevent. An unattended job cannot designate an operator or confirm
nobody else is mid-run; the reserved small-hours slot is a mitigation, not a substitute.

---

# Job 2 — phys-110 / phys-310, Windows box

*Machine: the course director's Windows box, `d:\01 -- AI Projects\Core_Preflights`. Set up
2026-08-07; first run that graded anything, 2026-08-10. Courses: phys-110 and phys-310 only.*

## What runs

| | |
|---|---|
| **Trigger** | a `CronCreate` job **inside a live Claude Code session**, `33 0 * * *` — 00:33 America/Denver |
| **Wrapper** | none. There is no script; the schedule fires a prompt into the session |
| **Logs** | none on disk. The record is the session transcript and the `app.analysis_runs` rows |
| **Notification** | none. The operator reads the session |
| **Writes** | whatever the two sub-skills write. The scheduler itself writes nothing to the DB |
| **Commits / pushes** | **neither, ever** |

## How it differs from job 1, and where it is weaker

Job 1 is a hardened shell wrapper driving `claude -p`. Job 2 is a scheduled prompt inside an
interactive session that fans out to subagents. **Read these before trusting it the way you trust
job 1:**

- **It dies when the session dies, and expires after 7 days regardless.** `CronCreate` jobs are
  session-only — nothing is written to disk — and recurring ones auto-expire after 7 days. Job 1
  survives a reboot; **job 2 does not survive closing the terminal.** It must be re-armed roughly
  weekly, by hand.
- **Silence is not an alarm here — there is no alarm.** Job 1 notifies from an EXIT trap, so
  refusals and crashes report themselves. Job 2 reports into the session and nowhere else. If the
  session is gone, nothing fires and nothing says so.
- **`git commit` / `git push` are forbidden by instruction, not by tooling.** Job 1 denies both at
  the tool layer with `--disallowedTools`. Job 2 relies on the prompt telling each subagent not to.
  That has held, but it is a weaker guarantee.
- **It cannot run on the Linux box, and job 1 cannot run here.** Grading needs the service-role
  config, `supabase/admin/.env`, the `.venv`, and the ~968 MB textbook corpus that
  `textbook_base_path` points at (CORE.md §3). Those live per-machine.

## Shape of a night

The scheduled prompt does the cheap part itself and delegates the expensive part, so a night with
no work costs two subprocess calls and no agent:

1. Run `worklist --course phys-110 --latest --json` and the same for phys-310. **Not in a
   subagent** — it is two commands, and spawning an agent to make them costs more than they do.
2. If neither returns `"action": "run"`, stop. Most nights end here.
3. If phys-110 has work, spawn **one** `general-purpose` subagent to execute
   `.ai/skills/lesson-cycle/SKILL.md` for phys-110, synchronously.
4. If that subagent actually graded, wait 10 minutes, then repeat for phys-310.

Subagents are used so the grading transcript — hundreds of student answers — is discarded when the
agent ends instead of accumulating in the session.

## The gates

Same intent as job 1's, and for the same reason: each checks that a credential **works**, not that
a file exists. All four run inside the subagent, before anything is written.

| # | Gate | Catches |
|---|---|---|
| 1 | `supabase/admin/app_tier_check.py` | dead or rotated DB passwords |
| 2 | REST probe on `/rest/v1/courses` with `Accept-Profile: app` | revoked service key; the free tier auto-pausing the project |
| 3 | `scripts/grounding/check_grounding.py` | **the silent one** — grading runs ungrounded, warns once, and nothing downstream looks different |
| 4 | clean tree, and `git fetch` showing neither behind nor ahead of `origin/main` | someone's uncommitted edits; a stale clone |

**Gate 3 was missing until 2026-08-10** and was added after reading job 1's table. The 2026-08-10
run happened to check grounding on its own initiative; that was the subagent being careful, not the
instructions being right.

Job 2 also inherits the skill-level orphaned-submission check described under job 1's table — it
runs inside `/lesson-cycle` Step 0.3, so the subagent gets it without this prompt naming it.

## Being behind `origin/main` is a human call

Job 1 resolves this itself at gate 6 with `git pull --ff-only`. **Job 2 deliberately does not.**
The director decided on 2026-08-10, after the first real run refused: commit `e93be5c` had rewritten
every phys-110 T-day deadline ~15 hours earlier, and a run whose whole premise is *"act on the
deadline that just passed"* should not proceed from a checkout that predates a mass deadline rewrite
for that course. The subagent reports and stops; a human merges and re-triggers.

The cost is a blocked night whenever someone pushes. That was accepted knowingly.

## Gotchas this job has already paid for

- **`pull` rejects a bare slug.** `--lesson preflight-02` fails — both phys-110 and phys-215 have
  one live this term. Use `--lesson phys-110-preflight-02-written`.
- **`worklist`'s `submissions` count is offering-wide, not track-scoped.** It reported 267 for
  preflight-02 day M; the M track actually held 163, the other 104 being T-track. Do not quote it
  as the size of the track being run.
- **phys-110's M and T tracks are no longer tied.** They used to close at the same instant because
  `due_by_day` was empty on almost every offering; `e93be5c` (2026-08-09) gave each preflight its
  own T-day deadline, so they are now typically 24h apart. Read the live dates — do not assume
  either shape.
- **Zeroing non-submitters is correct, and it broke the student dashboard once.** The first
  at-scale run zeroed 42 non-submitters, which with job 1's 34 produced 41 grade rows carrying a
  finalized zero and no submission — a shape `student-lessons.js` could not render, locking 34
  cadets out of PREP entirely. Fixed in `d7bb539`; the zeros were correct and were kept. Expect
  future runs to zero more, and do not withhold them.

## Operating it

There is no CLI. From the session that owns it: `CronList` to confirm the entry, `CronDelete <id>`
to disable, and re-arm with `CronCreate` after the 7-day expiry or a session restart.

**If this job is re-armed, re-read the prompt against this page first** — the prompt is the only
copy of the instructions, and it lives in session state that nothing version-controls.
