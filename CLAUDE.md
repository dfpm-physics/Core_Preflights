@.ai/instructions/CORE.md
@.ai/instructions/PROJECT.md

# CLAUDE.md — Claude Code entry point

Claude Code auto-loads this file and inlines the two imports above:

- `.ai/instructions/CORE.md` — the central, agent-neutral operating contract (authoritative).
- `.ai/instructions/PROJECT.md` — architecture and data-model deep reference.

This file is thin wiring plus Claude-specific notes; it must not duplicate or weaken CORE.md.
If anything here conflicts with CORE.md, CORE.md wins.

## Claude Code addendum

- Shared operating rules (CORE.md) and project context (PROJECT.md) come from the imports above.
  Do not restate or override them here.
- Discover reusable workflows under `.ai/skills/`. Inspect each `SKILL.md` frontmatter for
  discovery, then read the complete matching `SKILL.md` before acting.
- After loading a shared skill, also read `SKILL-claude.md` from that skill directory when it
  exists. An addendum may adapt Claude Code tools or syntax but may not weaken the shared workflow
  or repository safety rules.
- Commit and push to live `main` only when the human asks, except where CORE.md §5 grants a standing
  authorization (e.g. after a verified `preflight-analyze` run). The coordination gate in CORE.md §0
  always applies.
