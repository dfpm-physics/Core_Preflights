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

**Which file does a given fact belong in?** The split is not stylistic and getting it wrong is how
the two start disagreeing:

| Content | Home |
|---|---|
| a rule, a prohibition, a safety procedure, the skill index | `CORE.md` |
| an entity, a shape, a service, a sharp edge, current state | `PROJECT.md` |
| what changed, when, and by whom | `CHANGELOG.md` |
| why a decision was made and what was rejected | `docs/decisions/` |
| a frozen or externally consumed wire format | `docs/contracts/` |
| how to operate the system from outside the app | `docs/operations/` |
| how a *user* accomplishes a task | `site/help/` |

The principle behind that table is the whole value of keeping these files narrow: **a fact that
lives in two files will disagree with itself within a month.** Nobody plans the divergence — someone
edits the copy in front of them, ships, and the other copy becomes a confident lie that an agent
will read and act on. If you find yourself explaining a *rule* in `PROJECT.md`, you are writing
`CORE.md` in the wrong place.

**Both files are indexed in [`docs/DOC-SOURCES.json`](../../docs/DOC-SOURCES.json).** Run
`python scripts/docs/check_doc_sources.py` before committing a change to either, and resolve what
it flags — fix the document if it is now wrong, or bump its `reviewed` date if it is still correct.
