# AI workspace

This directory is the canonical, agent-neutral home for PREP AI context, reusable skills,
integration packages, and artifact examples.

- `instructions/` contains `CORE.md` (the authoritative agent-neutral operating contract) and
  `PROJECT.md` (the deep architecture/data-model reference). The root auto-loading files wire each
  agent into both.
- `skills/<skill-name>/SKILL.md` contains the canonical workflow for every AI. The directory
  and the required frontmatter `name` must match.
- A skill may include `SKILL-codex.md`, `SKILL-claude.md`, or another vendor addendum only when
  tool-specific adaptation is necessary. The shared `SKILL.md` remains authoritative.
- `integrations/` contains maintained AI-facing integration packages.
- `artifacts/` contains source examples, not deployed website files.

Agent-specific auto-loading files remain at their required locations, currently `AGENTS.md` (Codex)
and `CLAUDE.md` (Claude Code) in the repository root. They wire agents into `instructions/CORE.md`
and this directory without maintaining parallel copies of the contract or the skills. A new agent
gets its own thin root entry file pointing at `CORE.md`; it never forks the rules.
