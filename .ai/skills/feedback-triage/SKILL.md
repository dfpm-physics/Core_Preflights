---
name: feedback-triage
description: >
  FEEDBACK TRIAGE — works through the tester feedback queue (app.feedback on STAGING)
  one item at a time. Reads `new` and `accepted` rows with
  `scripts/staging/feedback_triage.py`; writes code on branch `v2-test-fixes`, a
  `CHANGELOG.md` entry, the public test site, and the row's status, triage, note and
  ref. Use when the user wants the tester feedback processed, or on the six-hourly
  unattended run. Triggers: "triage the feedback", "work the feedback queue", "process
  tester feedback", "fix what testers reported", /feedback-triage. NOT for reading
  feedback only to summarize it (run `list`), NOT for deciding a significant item (the
  course director accepts or declines it in the app), NOT for publishing the live site
  or touching production, and NOT for lesson analysis (`lesson-cycle`). Run after
  migration 089 is applied on staging; refuses without it. Any agent may run it; it needs
  the staging secrets file, git, and the persistent test-site clone. Argument: none.
---

# feedback-triage — turn one tester comment into a shipped fix or a plan for the director

> Unit of work: **one feedback row**. The run handles several rows, one at a time, each ending in a
> status change written back. Everything happens on **staging** and branch `v2-test-fixes`.

Lifecycle (migration 089): `new` -> `applied` (agent, simple) or `proposed` (agent, significant, the
note is the plan). The director moves `proposed` to `accepted` (with instructions) or `declined`. The
agent moves `accepted` to `applied`. The director closes out (`completed_at`). The agent writes only
status, triage, note, ref and time, through `feedback_triage.py`.

The launcher line, used by every command below (`$PY` is the repo venv's `python.exe`):

```
py -3.14 "C:/00 -- AI Hub/_shared/with_secrets.py" iprep-staging -- "C:\00 -- AI Hub\projects\iprep\.venv\Scripts\python.exe" scripts/staging/feedback_triage.py <list|mark ...>
```

## Step 0 — Preflight: refuse to start

Stop and report if any of these fail:

1. The target is staging. The tool refuses any other project itself; never pass a production URL.
2. `list --status new` prints "migration 089 not applied". Report that; the director applies it.
3. You are about to work on `main` or `v2`. Never. Work only on `v2-test-fixes`.
4. `git fetch origin` fails, or `origin/v2-test-fixes` is missing.
5. Another agent is mid-run in the worktree (CORE.md §0). One operator at a time.

## Step 1 — Make the worktree and find the work

Never switch the branch of the main clone. Make a new worktree off the fetched branch:

```
git fetch origin
git worktree add "<repo>/.claude/worktrees/feedback-<YYYYMMDD-HHMM>" -b feedback-<YYYYMMDD-HHMM> origin/v2-test-fixes
```

Work there. When pushing, push that HEAD to the shared branch: `git push origin HEAD:v2-test-fixes`
(a plain fast-forward; if rejected, `git fetch` and rebase once, then push; never force).

Then run `list --status new` and `list --status accepted`. If both are empty, print one line
("feedback-triage: no new or accepted items") and stop. Do nothing else.

## Step 2 — Triage each `new` item

**SIMPLE** only when all hold:
- wording, typo, label, help-text, CSS, spacing or color; or a small fix in ONE page or module
  (about 30 changed lines or fewer);
- no database, migration, edge function, auth, permission or RLS change;
- no grading or deadline logic, and no removal of a feature;
- the relevant offline tests pass.

Anything else, and anything unclear, is **SIGNIFICANT**. Doubt means significant.

An item that asks for nothing (praise, a like): do not invent a transition. Mark it `proposed` with
the note `No change needed; close or decline`, so the director decides.

## Step 3 — SIMPLE: fix, verify, ship, record

1. Make the fix in the worktree. Stay inside the item; no drive-by edits.
2. Run the offline tests that cover the files touched (CORE.md §2: a Node-only check is never the
   sole verification; say so in the CHANGELOG if it was).
3. Add a `CHANGELOG.md` entry, newest first: `## YYYY-MM-DD — <Human> via <Agent>`, naming the
   feedback id, what changed, and what you did not do.
4. `git add <explicit paths>` then commit. Never `git add -A`. The commit message ends with the
   agent's attribution line.
5. `git push origin HEAD:v2-test-fixes`. Never force.
6. Publish the test site from the persistent clone `%LOCALAPPDATA%\prep-test-site\iPREP-staging`
   (clone `dfpm-physics/iPREP-staging` there if missing; it lives OUTSIDE this repo):
   `python scripts/staging/publish_test_site.py --repo "$env:LOCALAPPDATA\prep-test-site\iPREP-staging" --commit`
   Read `docs/operations/TEST-SITE.md` if it refuses.
7. Record: `mark <id> --to applied --triage simple --note "<what changed, files>" --ref <short sha> --commit`.
   Run it first without `--commit` if unsure; the dry run prints the plan and rolls back.

## Step 4 — SIGNIFICANT: plan only

Write the plan as the note: what, which files, risk, rough size. Then
`mark <id> --to proposed --triage significant --note "<plan>" --commit`. Do no work.

## Step 5 — Approved items

For each row from `list --status accepted`: read `director_instructions` FIRST and follow them. Do
the work (delegate anything large to subagents with a full spec), then the same Step 3 commit, push,
publish. Finish with `mark <id> --to applied --ref <sha> --note "<what was done>" --triage <existing triage> --commit`.
If the instructions conflict with CORE.md or the rules here, stop and report; write nothing.

## Step 6 — Verify and report

Re-run `list --status all` and confirm each row you touched shows the status you wrote and no row
you did not touch changed. Report once, to stdout: counts per action, row ids, short shas. A failure
says what stopped and the state it left. A routine run writes no other log.

## What this skill never does

- Never touches a `declined` or `duplicate` row, or any row in a state this skill does not list.
- Never edits `director_instructions`, `decided_by`, `decided_at`, `completed_at`, or closes an item out.
- Never works on a `proposed` item until the director has moved it to `accepted`.
- Never runs against production, never pushes `main` or `v2`, never force-pushes.
- Never runs DDL or applies a migration; schema needs go to the director as SQL.
- Never prints `submitter_name` or `submitted_by`, and never puts a student name in a commit, a
  CHANGELOG entry or a note.
- Never fixes a significant item "while it is there".
- Never uses `git add -A`, and never switches the main clone's branch.
