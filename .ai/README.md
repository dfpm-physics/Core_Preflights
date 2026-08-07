# `.ai/` — the agent-neutral instruction set

This directory is the canonical home for PREP's AI context: the operating contract, the reusable
workflows, the per-language coding patterns, and the integration packages. **One copy of each. No
per-agent mirrors.**

## Reading order

| You are | Read |
|---|---|
| any agent, every task | [`instructions/CORE.md`](instructions/CORE.md) — the operating contract. **Authoritative** |
| any agent, before deep work | [`instructions/PROJECT.md`](instructions/PROJECT.md) — architecture, data model, sharp edges |
| about to run a named procedure | [`skills/<name>/SKILL.md`](skills/) — read it **in full** before acting |
| about to write code | [`patterns/<lang>.md`](patterns/) for that language |

**One rule governs the rest:** `CORE.md` is authoritative. If a skill, a help page, a comment, or an
agent's root entry file disagrees with it, `CORE.md` is right and the other file is a bug to fix.

## The map

```
instructions/CORE.md      the operating contract          (rules)      AUTHORITATIVE
instructions/PROJECT.md   the deep reference              (facts)
skills/<name>/SKILL.md    canonical workflows             (procedures)
patterns/<lang>.md        per-language coding patterns    (how to write code)
integrations/             external AI surface packages — currently custom-gpt/
artifacts/examples/       format examples. NOT the deliverable — see below
```

## Skills

Read the frontmatter of each `skills/*/SKILL.md` at the start of a task. When one applies, **read it
in full before acting** — a skill skimmed is a skill whose guards you did not read. A skill may
carry a `SKILL-claude.md` or `SKILL-codex.md` addendum; those may adapt tools and syntax but
**may not weaken** the shared workflow or the safety rules. The directory name and the frontmatter
`name` must match.

Domain skills — `preflight-analyze`, `lesson-aggregate`, `lesson-cycle`, `interaction-backfill`,
`setup-preflight`. Cross-cutting — `docs-author`, `safe-change`, `skill-author`,
`integration-package`. The index with one line each is CORE.md §4.

## Patterns

Read [`patterns/`](patterns/) for the language before writing or modifying code in it. Currently
only [`python.md`](patterns/python.md), which holds the traps an agent gets wrong in Python plus
this project's two-tier dependency policy — `scripts/` is standard-library only, `supabase/admin/`
may use `psycopg2` from a gitignored `.venv/`. These are references consulted while coding, not
runbooks, so they have no slash command.

**There is deliberately none for the JSX an artifact is made of** — nobody hand-writes it. The
`preflight-factory-v2` skill in [`_builder/preflight-kit/`](../_builder/) emits it, and the rules
that govern that output live there.

## Two things called "artifact"

`artifacts/examples/` holds **format examples** from the instruction kit. The project's actual
interactive deliverables — the 46 built Claude artifacts — live in the private `artifact-sources`
Storage bucket, with their build records under [`_builder/`](../_builder/). **Read the path, not
the word.** An agent asked to "work on the artifacts" that edits `.ai/artifacts/` has edited the
wrong thing.

## Agent entry files

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) sit in the repository root because those agents
require them there. They are **thin wiring**: they point at `instructions/CORE.md` and this
directory, and may add agent-specific notes. They never fork the rules. A new agent gets its own
thin root entry file pointing at `CORE.md`.

**Do not create `.claude/skills/` or `.agents/skills/` mirrors.** Anything that duplicates a
procedure will diverge from it, and the agent reading the stale copy has no way to know.
