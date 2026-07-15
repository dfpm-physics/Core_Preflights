# AGENTS.md — Codex entry point (PREP / Core_Preflights)

Codex auto-loads this file at the repo root. It is **thin wiring**: it points Codex at the
project's authoritative, agent-neutral contract and adds a few Codex-specific notes. It does **not**
restate the full contract — read the linked files.

## Read these first (authoritative)

1. **`.ai/instructions/CORE.md`** — the central operating contract: shared-state safety, the
   coordination gate, secrets/config, git/publish, CHANGELOG conventions, and the runbook index.
   **This is authoritative. Read it fully before you act.** If anything here ever conflicts with
   CORE.md, CORE.md wins.
2. **`.ai/instructions/PROJECT.md`** — agent-neutral deep reference: architecture, hosting, the full
   data model, roles, edge functions, and the lesson-interaction contract.
3. **Skills.** At the start of a task, inspect the frontmatter of the immediate
   `.ai/skills/*/SKILL.md` files for a matching description. When a skill applies, read its complete
   `SKILL.md`, then read `SKILL-codex.md` if one exists. Addenda may adapt tools and invocation
   syntax but must not weaken the shared workflow or the safety rules.

---

## Safety floor — mirrored from CORE.md §0 (authoritative copy is CORE.md)

> This block is duplicated here so Codex always sees it inline. **Do not edit it here** — edit
> `.ai/instructions/CORE.md` §0, then update this mirror to match.

There is **one production Supabase database** (`shzvpmlnqfmzfmuxkowi`) and **one live website**
(GitHub Pages off `main`). Multiple agents write to both. Treat every mutation as visible to
everyone else, immediately.

- **Nothing an agent "remembers" privately is shared.** If a fact matters to whoever works next, it
  must live in the **repo** — CORE.md, a design doc, or `CHANGELOG.md`. Do not rely on agent memory.
- **Log every state-changing run in `CHANGELOG.md`** (schema, bulk data, roster, publishes).
- **Destructive DB ops are gated:** snapshot to JSON first, verify the snapshot matches live counts,
  then delete with an explicit `--commit` (`scripts/fall2026/export_poc_snapshot.py` → `clean_poc.py`).
- **No concurrent DDL.** Schema changes are coordinated in advance, never run by two agents at once.
  The service key is DML-only by convention; the `claude_code_recker` DB role is `BYPASSRLS` **but
  has no DDL**.

**Coordination gate — the CHANGELOG is an audit trail, not a lock.** Before any live DB mutation or
push to `main`:

1. **Designate one operator** for the change; nobody else mutates the same area until it lands.
2. **Confirm no competing agent is mid-run** (another Claude/Codex session, a script, a teammate).
3. **`git fetch` and verify your branch hasn't diverged** from `origin/main` before you start.
4. **Never run two agents in the same working tree.** Use separate clones or git worktrees.
5. **Never force-push.**

---

## Codex-specific notes

- **Loading.** Codex loads the **root** `AGENTS.md` (this file); nested `AGENTS.md` files may add
  local context but **must not weaken** CORE.md or this safety floor. A personal global
  `~/.codex/AGENTS.md` is fine. A repo `.codex/` **documentation mirror** is not (it would drift) —
  a `.codex/config.toml` for Codex *settings* is a separate, legitimate thing if ever needed.
- **Config file.** Create `~/.claude/skills/preflight-analyze/config.json` from
  `.ai/skills/preflight-analyze/config.json.template` (see CORE.md §3 — the path is Claude-branded
  but agent-neutral in practice; a neutral `$PREP_CONFIG` is decided but not yet executed).
- **Standing authorization for Codex-requested changes:** when Casey asks Codex to make changes,
  Codex should update the durable memory (CORE.md, `AGENTS.md`, or another appropriate repo doc),
  update `CHANGELOG.md`, commit, and push `main` after verification unless Casey explicitly opts out.
  Read-only exploration/questions do not trigger a commit or push. Keep unrelated changes in separate
  commits and never sweep in gitignored/local junk (`supabase/.temp/`, `.venv/`, configs).

## Codex quickstart

1. Clone the repo; confirm you're on `main`. Read `.ai/instructions/CORE.md`,
   `.ai/instructions/PROJECT.md`, and `docs/operations/SYSTEM_GUIDE.md`.
2. Create the two config files from their `.template`s (CORE.md §3). Get the service key / DB creds
   from the course director out-of-band — never from the repo.
3. Confirm the environment: Python available, no Node dependency or build step, and textbook PDFs
   present at `textbook_base_path` if you'll grade.
4. Before any DB mutation, re-read the safety floor above (and CORE.md §0). For destructive ops,
   snapshot first.
5. Do the work using the runbooks in `.ai/skills/` and the scripts in `scripts/`. Keep scripts
   idempotent + dry-run-by-default.
6. Update `CHANGELOG.md` (`via Codex`) and, if you changed how the system is operated, CORE.md.
7. For Casey-requested changes, use the standing commit-and-push authorization above unless Casey
   opts out.

---

*This file only wires Codex into the shared contract. The rules themselves live in
`.ai/instructions/CORE.md` — if it's wrong, the next agent inherits the mistake.*
