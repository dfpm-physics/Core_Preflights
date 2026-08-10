# Running the lesson cycle on a schedule

**The repo schedules nothing, on purpose.** `.ai/skills/lesson-cycle/SKILL.md` §"Running unattended"
documents the invocation and leaves the scheduler to the operator. This page records the one that
exists, so the arrangement is discoverable from the repo rather than living in one operator's head
or in an agent's private memory (CORE.md §0 forbids the latter).

*Machine: the Linux box, `~/projects/Core_Preflights`. Set up 2026-08-10. Course: phys-215 only.*

---

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
