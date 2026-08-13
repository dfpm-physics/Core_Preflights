# `lesson-cycle-loop` — drafted 2026-08-12, archived unshipped the same day

**This is not a live skill. Do not follow it.** It is not in `.ai/skills/`, it has no row in
`CORE.md` §4, it has no entry in `docs/DOC-SOURCES.json`, and there is no launcher for it. Nothing
discovers it and nothing checks it for staleness — so treat every fact in it as true only as of
2026-08-12.

## What it was for

Job 2 — the Windows box's 00:33 phys-110 / phys-310 run — is armed by a prompt held in **session
state, which nothing version-controls**.
[`docs/operations/SCHEDULED-LESSON-CYCLE.md`](../../docs/operations/SCHEDULED-LESSON-CYCLE.md)
§"Operating it" closes by saying exactly that: *"the prompt is the only copy of the instructions."*
Closing the terminal destroys the procedure. Every re-arm is a reconstruction, and every
reconstruction can silently drop a gate — which is how the grounding gate went missing until
2026-08-10.

That problem is **still open**. Archiving this draft did not solve it; `SCHEDULED-LESSON-CYCLE.md`
remains the only written record, and it documents the job rather than being executable.

## Reviving it — four steps, and a partial revival is worse than none

1. Move this directory to `.ai/skills/lesson-cycle-loop/` (dropping this README).
2. Add the index row to `CORE.md` §4. **A skill absent from §4 is a skill agents will not find.**
3. Add the `docs/DOC-SOURCES.json` entry, so the verbatim prompt in `references/MASTER-PROMPT.md`
   is checked for drift. Its gates name scripts, commits, and constraints owned elsewhere; a
   drifted prompt still runs, still reports success, and grades a cohort with a gate quietly gone.
4. Recreate the launcher **outside the repo**, at `~/.claude/skills/lesson-cycle-loop/SKILL.md`,
   holding a pointer and nothing else — **never** a `.claude/skills/` mirror inside the repo.
   `CORE.md` §4 forbids that and `DOC-SOURCES.json` already records the ruling.

Then **cold-run it**, which was never done: hand it to a fresh agent against a real night and read
the transcript for where it improvised. Every improvisation is a gap in the skill.

## Before trusting anything in here, re-verify

The draft encodes constants that move. At minimum re-check that the courses are still phys-110 and
phys-310 and still disjoint from job 1's phys-215 (**the only thing making the two jobs safe to
overlap in wall-clock time**), that the deadline behaviour described for `e93be5c` still holds, and
that `worklist`'s `RUN:` / `SKIP:` output contract is unchanged.
