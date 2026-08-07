# skill-author — Codex addendum

> Tool notes only. The workflow lives in `SKILL.md`.

- **Discovery starts at the root `AGENTS.md`.** Codex reads that file and follows it to `.ai/instructions/CORE.md` §4 for the skill roster — so a new skill is not reachable until its §4 index row exists (Step 7), regardless of the file being on disk. Add the row in the same change as the skill; a skill that only the author knows about is a skill only the author will run.

- **Nested `AGENTS.md` files may add local context; they may never weaken `CORE.md`.** A directory-level `AGENTS.md` can say which build command applies in that subtree — it cannot relax a guard, drop a precondition, or override a prohibition from `CORE.md` or from a `SKILL.md`. Nested files are read closer to the work and therefore feel more current, which is exactly why the restriction has to be explicit.

- **Do not create a per-agent copy of a skill.** `.ai/skills/<name>/SKILL.md` is the single agent-neutral copy (`CORE.md` §4); this addendum exists so no fork is needed. Two copies drift, and the drift surfaces as an agent executing a retired step long after it was tombstoned.

- **Match the shell to the platform, and say which one the skill assumes.** Codex runs against POSIX shells and Windows shells alike, so a verification command in Step 5 that silently assumes `/dev/null`, `&&`, or single-quoting will fail — or worse, appear to pass — on the other. Name the shell alongside any command a skill embeds.

- **Sandbox and approval settings are environment facts, not skill content.** If a step needs network or write access beyond the current sandbox, Step 0 must refuse and name the requirement — never widen permissions to make a step succeed.

This addendum adapts tools only. Where it and `SKILL.md` or `CORE.md` disagree, they win.
