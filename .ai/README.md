# AI workspace

This directory is the canonical, agent-neutral home for iPREP AI context, reusable skills,
integration packages, and artifact examples.

- `instructions/` contains shared project context and explains the transition from the current
  root auto-loading files.
- `skills/<skill-name>/SKILL.md` contains the canonical workflow for every AI. The directory
  and the required frontmatter `name` must match.
- A skill may include `SKILL-codex.md`, `SKILL-claude.md`, or another vendor addendum only when
  tool-specific adaptation is necessary. The shared `SKILL.md` remains authoritative.
- `integrations/` contains maintained AI-facing integration packages.
- `artifacts/` contains source examples, not deployed website files.

Agent-specific auto-loading files remain at their required locations, currently `AGENTS.md` and
`CLAUDE.md` in the repository root. They wire agents into this directory without maintaining
parallel copies of each skill.
