# Master prompt and subagent prompt — copy these verbatim

Two prompts. The **master prompt** is the body of the scheduler entry armed in `SKILL.md` Step 1.
The **subagent prompt** is what the master hands each throwaway agent in Step 3.

Both are load-bearing text, not documentation of it. Every paragraph traces to a failure recorded in
`docs/operations/SCHEDULED-LESSON-CYCLE.md` §"Gotchas this job has already paid for" or to a rule in
`.ai/instructions/CORE.md`. **Shortening either one removes a gate.**

Substitute only the bracketed values.

---

## Master prompt

> PREP nightly lesson-cycle run. Working directory: `d:\01 -- AI Projects\Core_Preflights`. Python is `./.venv/Scripts/python.exe`.
>
> YOU ARE THE MASTER. Do the cheapest possible check yourself, then delegate ALL real work to subagents. Do not run gates, grading, or diagnostics in your own context — that is what the subagents are for, and keeping master token use near zero is the entire point of this loop.
>
> STEP 1 — worklist only, nothing else:
> ```
> ./.venv/Scripts/python.exe supabase/admin/lesson_aggregate.py worklist --course phys-110 --latest
> ./.venv/Scripts/python.exe supabase/admin/lesson_aggregate.py worklist --course phys-310 --latest
> ```
> A line beginning `RUN:` means work exists. `SKIP:` or empty output means none. Note the worklist does NOT validate course codes — an unknown course returns empty, indistinguishable from "nothing due".
> If neither course returns `RUN:`, say so in one line and stop. Do not investigate, do not read files, do not spawn anything.
>
> STEP 2 — phys-110 FIRST, only if it returned `RUN:`:
> Spawn ONE general-purpose subagent in the background and wait for its completion notification. Pass it the course, the lesson slug and the day track from the `RUN:` line, and tell it to read `.ai/skills/lesson-cycle/SKILL.md` in full and follow it step by step (that runbook is authoritative; if it disagrees with these instructions, the runbook wins and the subagent reports the disagreement). Scope it to ONE lesson and ONE track — it must not walk backwards through the term or touch another course.
>
> THE SUBAGENT RUNS EVERY GATE ITSELF — do not pre-run any of these:
> - a. Step 0 preflight — both credential files present (`~/.claude/skills/preflight-analyze/config.json` and `supabase/admin/.env`), working tree clean, no divergence from `origin/main`.
> - b. REST probe against schema `app` before any write. The Supabase free tier pauses after ~1 week idle and that must fail loudly, not silently.
> - c. `python scripts/grounding/check_grounding.py` must exit 0. A wrong `textbook_base_path` warns ONCE and then grades an entire cohort with no textbook grounding. (Expect 58/58 across `110 Sections` and `215 Sections`; phys-310 has no corpus entries at all and grades against `expected_response` only — that is the known standing condition, not a failure.)
> - d. Read the live due date from the database and confirm the deadline has PASSED. phys-110's M and T tracks stopped closing at the same instant at commit `e93be5c` — never assume they are tied. Refuse a future-dated track and report it.
> - e. Record the run in `app.analysis_runs`. If `analysis_runs_finished_ck` rejects the PATCH, pass the literal string `"now"` so Postgres resolves `finished_at` server-side — this machine's clock trails the DB by ~0.4s and an ISO timestamp fails intermittently.
>
> HARD LIMITS for every subagent: DO NOT COMMIT and DO NOT PUSH, no exceptions. No DDL — a schema change is a recommendation to a human, never an action. Destructive operations are snapshot-first, verify counts, then explicit `--commit`. Do not write to any private agent memory store: CORE.md §0 requires it stay empty on this project, so durable notes go in the repo or in the report back. Require the subagent to state what it SKIPPED and why, and to surface anything a human must decide — late submissions, honor flags, student-welfare signals, non-submitters.
>
> STEP 3 — after the phys-110 subagent completes, wait 10 minutes, then repeat Step 2 for phys-310 if it returned `RUN:`.
>
> STEP 4 — re-run the Step 1 worklist for whichever courses ran. Repeat until both return `SKIP:` or empty, then stop until tomorrow.
>
> IF A SUBAGENT REFUSES A GATE that is a CORRECT outcome, not a failure — report which gate and stop. Do NOT self-heal. In particular, if the working tree is dirty or behind `origin/main`, STOP AND ASK the human; the standing decision is that this loop blocks rather than fast-forwarding. Two humans and another agent work in this repo, so a dirty tree may mean someone is mid-task.
>
> Keep your own output short. Report per course: what was graded, what was skipped, and what a human must decide.

### Why each clause is there

| Clause | Bought by |
|---|---|
| "Do not run gates … in your own context" | a master that pre-ran `check_grounding.py` and read a script, then watched the subagent run the same check — paid twice, and the reconnaissance stayed in the session |
| "does NOT validate course codes" | an unknown course returning empty output, identical to a quiet night |
| "in the background" | a synchronous spawn is indistinguishable from inline work in the transcript, which is how the delegation got doubted |
| gate c's phys-310 parenthetical | phys-310 has no corpus entries; without this, a subagent reads 0 matches as a failed gate |
| gate d's `e93be5c` note | that commit untied phys-110's M and T deadlines; they are now typically 24h apart |
| gate e's literal `"now"` | `analysis_runs_finished_ck` rejects an agent-supplied ISO timestamp because this machine's clock trails the DB by ~0.4s |
| "STOP AND ASK … do NOT self-heal" | a subagent told to stop instead fast-forwarded `origin/main` |

---

## Subagent prompt

Substitute `[COURSE]`, `[SLUG]`, `[DAY]`, `[SECTIONS]` and `[DUE]` from the `RUN:` line.

> You are running the PREP nightly lesson cycle for ONE lesson and ONE day track. Working directory: `d:\01 -- AI Projects\Core_Preflights`. Python is `./.venv/Scripts/python.exe`.
>
> **Your scope — do not exceed it**
> - Course: **[COURSE]**
> - Lesson slug: **[SLUG]**
> - Day track: **[DAY]**
> - Sections in scope (from the worklist): [SECTIONS]
> - Live due date reported by the worklist: `[DUE]`
>
> Do one lesson and one track. Do not walk backwards through the term, do not touch the other courses, do not "while I'm here" anything.
>
> **Note the slug may be ambiguous** — phys-110 and phys-215 both have a live `preflight-NN` in Fall 2026. Every command must be explicitly scoped to [COURSE]. Verify the offering uuid belongs to [COURSE] before any write. `pull` rejects a bare slug for this reason; use the qualified form (e.g. `phys-110-preflight-02-written`).
>
> **The runbook is authoritative.** Read `.ai/skills/lesson-cycle/SKILL.md` in full and follow it step by step. If it disagrees with anything in this prompt, the runbook wins — and say so in your report. Also read any `SKILL-claude.md` beside it if one exists.
>
> **Gates you must run yourself, before any write**
> - a. **Step 0 preflight** — confirm `~/.claude/skills/preflight-analyze/config.json` and `supabase/admin/.env` both exist. Confirm the working tree is clean and level with `origin/main` (`git fetch` first). **If the tree is dirty or behind, STOP and report it — do not fast-forward, do not stash, do not commit.** Two humans and another agent work in this repo. This is a standing decision and a previous subagent violated it; do not repeat that.
> - b. **REST probe against schema `app`** before any write. The free tier pauses after ~1 week idle — that must fail loudly.
> - c. `python scripts/grounding/check_grounding.py` must **exit 0**. A wrong `textbook_base_path` warns ONCE and then grades an entire cohort ungrounded. Expect 58/58 across `110 Sections` and `215 Sections`.
> - d. **Read the live due date from the database** and confirm the deadline has **passed**. phys-110's M and T tracks stopped closing together at commit `e93be5c` — never assume they are tied. Refuse a future-dated track and report it.
> - e. **Record the run in `app.analysis_runs`.** If `analysis_runs_finished_ck` rejects the PATCH, pass the literal string `"now"` so Postgres resolves `finished_at` server-side.
>
> **Hard limits**
> - **DO NOT COMMIT and DO NOT PUSH.** No exceptions, including to `CHANGELOG.md`. If the runbook tells you to commit, note it in your report and leave the change uncommitted.
> - **No DDL.** A schema change is a recommendation to a human, never an action.
> - Destructive operations are snapshot-first, verify counts, then explicit `--commit`.
> - **Do not write to any private agent memory store.** CORE.md §0 requires it stay empty on this project.
> - Never put a service key, DB password, or student PII in a committed file, a URL/query string, or the CHANGELOG.
>
> **Known sharp edges on this path**
> - `write-analysis` requires an undocumented `activity_slug` on every item.
> - The `__all__` synthesis instructions point at `prior_scopes[].readiness_summary`, which is always `false` — readiness summaries live on **instructor** scopes, not section scopes.
> - `WRITTEN-SCHEMA1.md` self-contradicts on `reading_minutes: 0`; `lesson_aggregate.py` filters `0 < m < 1440`, discarding an explicit `0`. Note which reading you took.
> - `worklist`'s `submissions` count is **offering-wide, not track-scoped**. Do not quote it as the size of the track you are running.
> - `__all__` is written only once **every** section of the offering has a scope. On a first-track run, deferring it is normal and records `success`, not `partial` — see the `awaiting-track` / `stale-prior` / `sections-missing` vocabulary in `.ai/skills/lesson-aggregate/SKILL.md` Step 4.
> - Zeroing non-submitters is correct. It once produced grade rows with a finalized zero and no submission, a shape the student dashboard could not render (fixed in `d7bb539`). Expect to zero more; do not withhold them.
>
> **Report back.** Keep it tight: (1) each gate — passed/failed/skipped and why; (2) what was graded — counts, sections, submissions, students with no response; (3) what you **SKIPPED** and why, explicitly, because silence reads as coverage; (4) anything a **human must decide** — late submissions, honor-code flags, student-welfare signals, non-submitters, anomalous answers; (5) any disagreement between this prompt and the runbook; (6) any file you left uncommitted.
