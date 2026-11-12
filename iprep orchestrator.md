**Status line:** Idle. First task done 2026-11-12 (this file written). Waiting for the next task.

# iPREP orchestrator

State file for `Orchestrator: iPREP`, a standing Claude session the course director runs on his own machine.
Tracked on `v2`. Read this first after a cleared chat. Other people working in this repository can ignore it.

## Role

- Project orchestrator for this repository's clone on that machine.
- The folder stays on branch `v2`. Never switch branches here. Live `main` work happens in the other clone.
- Changes files in this project only. Reads the hub, read-only. Never reads another project's folder:
  to learn how another project does something, send a `question` message to that project's orchestrator.
- Hands reading and bulk edits to subagents (`scout`, `worker`, `skeptic`). An editing subagent works in its own git worktree.
- Commits only when the operator's own words ask for it. "Commit" means commit and push `v2` only.
- Takes `task` messages from `Orchestrator: Hub` and from the operator.
- Rulebook: the hub's orchestrator design, section 5.

## Standing direction from the operator

Matthew Recker, 2026-11-12:

> "I'd like an orchestrator for each project that receives direction from the main orchestrator and runs specific tasks for the project."

## Current task

None. Last done: 2026-11-12, from `Orchestrator: Hub`, quoting the operator ("…Then commit and push."):
commit this file on `v2` with a CHANGELOG entry, and push `v2`.

## Waiting on

Nothing.

## Last task closed

2026-11-12, from `Orchestrator: Hub`: write this file, report state, then go idle. Done. Nothing committed.

## Project state at 2026-11-12

- `v2` is at `9f7d4ae` (Field Station note, on top of `ecfb6b1` tutorials). It is level with `origin/v2`.
- Next dates (`docs/ROADMAP.md` V2.6): data model design written 13 Nov; migrations on staging 20 Nov;
  go or no-go 24 Nov; staff pages on staging 27 Nov; step 1 about 1 Dec 2026.
- V2.2 (auto-graded numeric homework) must work by 6 Jan 2027. It has no fallback.

## Open questions and loose ends

- 13 agent worktrees sit under `.claude/worktrees/`. Every branch in them is already in `v2`.
  Two hold uncommitted files: `agent-a12b5d2f4d6b1cffa` (14 files, branch `v2-step1-tools`)
  and `agent-a9c4ce08d8da1f6cb` (1 file, branch `v2-field-station`). Checked 2026-11-12:
  - `agent-a12b5d2f4d6b1cffa`: an older, uncommitted copy of the step 1 tools. Every line it adds is already in `v2`,
    and `v2` has newer versions. Only a `reviewed` date in `docs/DOC-SOURCES.json` differs. Nothing to keep.
  - `agent-a9c4ce08d8da1f6cb`: `_field-station/`, a design experiment (a new look laid over the real pages), never
    committed and in no other place. 146 own files (overlay site, `serve.py`, 53 screenshots, notes) plus 32 MB of
    `node_modules`. The only copy.
    Operator, 2026-11-12: "I like it as a path we considered and rejected for now, it might be worth looking at in
    the future if anyone decides to attempt a large redesign. So I don't want to lose it but also do not want t
    pursue it anymore". Then: "Commit to its branch". Done 2026-11-12: committed on `v2-field-station`
    (`e7c2f79`) and pushed; `docs/decisions/FIELD-STATION.md` and a CHANGELOG entry on `v2` (`9f7d4ae`), pushed.
    The worktree is now clean and can be removed without loss. Never merge that branch.
- From the CHANGELOG, still open: the Feedback button and footer still paint late; Stage E item 4's
  expired-token case was skipped; the production-size restore drill is still owed.
