# Shared AI instructions

Two agent-neutral files, one authority chain:

- **`CORE.md`** — the central operating contract: shared-state safety, the coordination gate,
  secrets/config, git/publish, CHANGELOG conventions, and the runbook index. **Authoritative.** If
  anything anywhere conflicts with it, CORE.md wins.
- **`PROJECT.md`** — the deep *reference*: architecture, hosting, the full data model, roles, edge
  functions, and the lesson-interaction contract. Holds the facts CORE.md links to instead of
  restating.

The root auto-loading entry files wire each agent into both: `CLAUDE.md` imports `CORE.md` +
`PROJECT.md`; `AGENTS.md` points Codex at them (and inlines CORE.md §0 as a safety floor, since Codex
has no `@import`). Those entry files are thin wiring plus agent-specific notes — they must not restate
or weaken CORE.md.
