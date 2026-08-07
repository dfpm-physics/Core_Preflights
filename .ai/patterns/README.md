# `.ai/patterns/` — per-language coding references

> **Scope.** One file per language in use, holding the coding patterns an agent must follow when
> writing that language **in this repository**. Read the matching file before writing or modifying
> code in that language. These are references, consulted while coding — not runbooks, and not a
> tutorial in the language.

Where a pattern file and `.ai/instructions/CORE.md` disagree, **CORE.md wins** and the pattern file
is the bug.

## The languages

| file | covers |
|---|---|
| [`python.md`](python.md) | Python — the standard-library scripts under `scripts/`, and anything else Python this project gains |

The kit's `cpp.md` was deleted at bootstrap: this project does not write C++, and a pattern file
whose slots nobody fills keeps the slot checker red forever, which trains everyone to ignore a
failing check.

**There is deliberately no file for the JSX an artifact is made of.** Nobody hand-writes it — the
`preflight-factory-v2` skill emits it from a lesson PDF, and what governs that output is the skill
plus the frozen contracts and `THEME_REFERENCE.md` under `preflight-kit/`. A pattern file here
would govern nothing, which is exactly the speculative file the paragraph below warns against.

Add a file when the repository gains a language somebody will write more than once. **Do not add one
speculatively** — a pattern file for a language nobody writes is a file nobody reads, and it teaches
agents that this directory is decorative.

## What belongs in a pattern file

**The things an agent gets wrong in that language**, each with the failure mode that makes it a rule
rather than a preference. Optimize for the traps, not for coverage: the reader already knows the
syntax, and a file that restates the language reference buys nothing while costing the attention
that the traps needed.

| belongs | does not belong |
|---|---|
| ownership, lifetime, error handling, and the language's characteristic footguns | a tutorial in the language, or anything the reader can get from the official docs |
| the project's pinned version, build, test, lint, and format commands (as slots) | the project's architecture — that is [`../instructions/PROJECT.md`](../instructions/PROJECT.md) |
| the tool that mechanically enforces each rule | a rule with no mechanism, unless you say plainly that there is none |
| a checklist to run before committing | operating rules — safety, coordination, publishing — which are `CORE.md` |
| short examples where showing beats stating | long examples nobody will read to the end |

## Two rules that make these files worth reading

**Every rule carries its reasoning inline.** State the failure mode, not just the prohibition — an
agent that knows *why* a rule exists applies it to the case you did not anticipate, and an agent
given a bare assertion looks for the exception. This is also the only honest way to let a future
maintainer argue with a rule instead of guessing at it.

**Name the mechanism that enforces each rule, or admit there is none.** A compiler flag, a linter, a
sanitizer, a type checker, a test. **A rule with no mechanism rots** — it survives exactly as long as
the memory of the person who wrote it. Where a rule genuinely cannot be automated, say so in the
file, because "not yet automated" and "not enforceable" are different problems with different fixes.

## Project-specific values

A pattern file ships with `{{SLOTS}}` for the facts only the adopting project knows — the pinned
language version, the build and test commands, the formatter, the dependency policy.
[`project-bootstrap`](../skills/project-bootstrap/SKILL.md) fills them, and
`python scripts/bootstrap/check_slots.py` reports any left behind.

**Namespace every language-scoped slot with the language: `{{CPP_TEST_COMMAND}}`, not
`{{TEST_COMMAND}}`.** Slot substitution is global text replacement, so a bare `{{TEST_COMMAND}}` in
two pattern files gets one value in a repository that writes two languages — and the language that
loses the coin toss now documents a command that does not run its tests. The bare names belong to
project-wide facts in `CORE.md` §2; anything a second language could answer differently is
namespaced.

**A slot with no good answer gets deleted along with the sentence around it, not filled with "N/A".**
A reference full of N/A reads as unmaintained, and agents stop trusting the parts that do matter.

## Why these are not skills

A skill is a runbook with a step spine and a preflight that can refuse. A pattern file is neither —
it is read *while* doing something else, and there is no point at which it succeeds or fails. Making
these skills would give them slash commands they do not need and a shape they do not fit, and it
would dilute what "skill" means in [`../skills/`](../skills/).

They are the code counterpart of
[`../skills/docs-author/references/PROSE-STYLE.md`](../skills/docs-author/references/PROSE-STYLE.md),
which does the same job for prose.

## Maintaining these files

Register each one in [`../../docs/DOC-SOURCES.json`](../../docs/DOC-SOURCES.json) against the
sources it was written from — once the slots are filled, a pattern file encodes this project's build
and test reality, and **it goes stale the moment that reality moves.** A pattern file that names a
build command nobody runs any more is worse than none, because an agent will follow it.

When a rule here earns its place by catching a real mistake, say so in the file. The rules that
survive are the ones somebody can point at a scar for.
