# skill-author — Claude Code addendum

> Tool notes only. The workflow lives in `SKILL.md`.

- **Discovery is frontmatter-driven.** A skill in this tree is found by reading `.ai/skills/<name>/SKILL.md` and matching its `description` against the request — so the Step 2 recipe is not a style preference, it is the retrieval index. A skill whose `name` does not equal its directory is unreachable no matter how well the body is written.

- **Do not mirror this tree into `.claude/skills/`.** Claude Code has its own native skills mechanism; `.ai/skills/` is deliberately separate and agent-neutral so one procedure has exactly one copy (`CORE.md` §4). A mirror is a fork that drifts silently — the two files disagree, and the agent obeys whichever it read last. If a skill must also be exposed natively, reference the `.ai/skills/` file from there; never copy its contents.

- **Use Read, Edit, Write, Grep, and Glob — not shell equivalents.** `cat`, `sed`, `grep`, and `find` through Bash bypass the permission surface and the file-state tracking that make Step 4's read-back verification meaningful. Shell is for running checks and commands, not for reading or editing files.

- **Match the shell to the platform.** On Windows use PowerShell syntax (`$env:VAR`, `Test-Path`, `Select-Object -First N`, `;` and `if ($?)` rather than `&&`); the Bash tool there is Git Bash and takes POSIX syntax — the two are not interchangeable, and a `NUL`-vs-`/dev/null` mistake fails loudly while a quoting mistake fails silently. Verification commands written into a skill must specify which shell they assume.

- **Run the Step 7 cold check in a subagent.** A fresh subagent with no context from the authoring session is the only honest test of whether the steps stand alone — you cannot un-know what you just wrote.

This addendum adapts tools only. Where it and `SKILL.md` or `CORE.md` disagree, they win.
