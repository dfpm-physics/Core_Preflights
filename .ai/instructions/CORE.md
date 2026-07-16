# CORE.md — Central Operating Contract for AI Agents (PREP / Core_Preflights)

This repo (`Core_Preflights`, brand **PREP**) is developed jointly by several people running
**different AI agents** (Claude Code, Codex, …) against **one shared live system**. This file is the
**single, agent-neutral source of truth** for how the system is operated. Every agent and human
follows the same rules here.

> **How agents reach this file.** Each agent has its own auto-loaded entry file at the repo root —
> `AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code). Those files are **thin wiring**: they point to
> (or import) this contract and may add *agent-specific* notes, but **must not restate or weaken**
> anything here. If you change how the system is operated, edit **this file** (and `CHANGELOG.md`),
> never a per-agent copy. If a per-agent file ever conflicts with this one, **CORE.md wins**.

> **Where things live.**
> - **CORE.md** (this file) — operating *rules*: safety, coordination, secrets, git/publish,
>   CHANGELOG, and the runbook index. Authoritative.
> - `.ai/instructions/PROJECT.md` — agent-neutral *deep reference*: architecture, hosting, full data
>   model, roles, edge functions, and the lesson-interaction contract. CORE links here instead of
>   duplicating facts.
> - `.ai/skills/<name>/SKILL.md` — the canonical, agent-neutral workflows (one copy, no per-agent
>   mirrors). When a skill applies, read its full `SKILL.md`, then read `SKILL-codex.md`,
>   `SKILL-claude.md`, or the matching vendor addendum if one exists. Addenda may adapt tools and
>   invocation syntax but must not weaken the shared workflow or the safety rules below.

---

## 0. The one thing that will bite you: shared state

There is **one production Supabase database** (`shzvpmlnqfmzfmuxkowi`) and **one live website**
(GitHub Pages off `main`). Multiple agents write to both. Treat every mutation as visible to
everyone else, immediately.

- **Nothing an agent "remembers" privately is shared.** Claude Code has a private per-project
  memory store outside the repo; Codex has its own session state. **Neither is visible to the
  other agent or to humans.** If a fact matters to whoever works next, it must live in the
  **repo** — this file, a design doc, or `CHANGELOG.md`. Do not rely on agent memory for
  anything durable.
- **Log every state-changing run in `CHANGELOG.md`** (schema, bulk data, roster, publishes).
- **Destructive DB ops are gated:** snapshot to JSON first, verify the snapshot matches live
  counts, then delete with an explicit `--commit`. See `scripts/fall2026/` for the reference
  pattern (`export_poc_snapshot.py` → `clean_poc.py`).
- **No concurrent DDL.** Schema changes (new tables/columns/policies) are coordinated in advance,
  never run by two agents at once. The service key is DML-only by convention; the `claude_code_recker`
  DB role is explicitly `BYPASSRLS` **but has no DDL**.

**Coordination gate — the CHANGELOG is an audit trail, not a lock.** Before any live DB mutation or
push to `main`:

1. **Designate one operator** for the change; nobody else mutates the same area until it lands.
2. **Confirm no competing agent is mid-run** (another Claude/Codex session, a script, a teammate).
3. **`git fetch` and verify your branch hasn't diverged** from `origin/main` before you start.
4. **Never run two agents in the same working tree.** For concurrent work use separate clones or
   git worktrees so edits and `git` state don't collide.
5. **Never force-push.**

---

## 1. What the system is

Static **HTML/CSS/JS** frontend on **GitHub Pages** + **Supabase** (Postgres + Auth + REST).
Replaces GradeScope for **Physics 110** and **Physics 215** at USAFA: students submit preflight
assignments and complete lesson interactions; instructors grade in an admin panel; an AI agent
analyzes free-response answers and writes suggested scores. The platform brand is *PREP*
(*Pre-lesson Readiness Engagement Platform*); *iPREP* (*interactive PREP*) now refers specifically
to the interactive lesson-interaction component, not the site as a whole. The repo, GitHub Pages
path, and export filenames stay `Core_Preflights` — renaming breaks deployed artifact links,
bookmarks, and Blackboard imports.

- **Repo / Pages:** `github.com/dfpm-physics/Core_Preflights` → `https://dfpm-physics.github.io/Core_Preflights/site/`
- **Supabase:** project `shzvpmlnqfmzfmuxkowi`. **Free tier pauses after ~1 week idle** — unpause in
  the dashboard at the start of each semester.
- **Local path:** the repo currently sits inside OneDrive (synced + versioned; edits sync on save).

Full architecture, hosting details, roles, and the data model are in `.ai/instructions/PROJECT.md`.
Read these repo docs before deep work: `docs/operations/SYSTEM_GUIDE.md`,
`docs/contracts/INTERACTION-DATA-CONTRACT.md`, `docs/architecture/LESSON-UNIFICATION.md`,
`docs/decisions/INTERACTION-AGGREGATION.md`, and `.ai/instructions/PROJECT.md`.

---

## 2. Environment constraints (read before running anything)

- **The project has no Node dependency or build step. Do not introduce one.** (Node/npm may be
  installed on a given machine, but nothing here uses them — no bundler, transpiler, `node --check`,
  eslint, or jest.) The frontend is hand-authored ES modules + plain CSS the browser runs directly.
  **Verify UI changes in a browser:** `python -m http.server 8000` from the repo root, open
  `http://localhost:8000/site/` and `http://localhost:8000/site/app/`. Do not add a build step.
- **Tooling is Python** using only the **standard library** (`urllib`, `json`, `zoneinfo`) against
  the Supabase REST API — see `scripts/`. Heavier DB work uses `psycopg2` in a gitignored `.venv/`
  (see `supabase/admin/`).
- **Timezone:** due dates are computed as 2359 **America/Denver** the night before a lesson and
  stored as UTC (DST-aware). Reuse the `zoneinfo` helpers in `scripts/fall2026/build_fall_preflights.py`.
- **Current Physics 215 preflight source DOCX:** `../Preflights/Physics215_Preflight_Questions_v12.docx`.
  v12 was generated from v11 after pulling live webpage/Supabase Q3 wording for lessons 3, 9,
  19, 24, 26, 28, and 30. Lessons 2 and 6 remain unchanged from v11 and matched the live Q3
  wording when the lesson-list correction was verified.
- **Fall 2026 lab preflights:** the six Physics 215 lab lessons (`preflight-06`, `preflight-11`,
  `preflight-17`, `preflight-27`, `preflight-34`, `preflight-38`) intentionally use lab-instruction
  wording for Q1/Q2. Regular lesson preflights keep the book/reading wording.
- **Fall 2026 preflight figures:** the source DOCX contains embedded JiTT figures for
  `preflight-03`, `preflight-04`, `preflight-24`, and `preflight-28`. Assets live in
  `site/img/assignments/preflight-XX-q3.png`; regenerate them with
  `scripts/fall2026/extract_preflight_figures.py`. The Fall builder attaches the matching public
  GitHub Pages URL to Q3 as `figure_url`.
- **Grade/Report privacy for Q1:** zero-point reflection questions such as Q1 should not render on
  per-student Grade-tab cards. Written-preflight reports may show Q1 raw responses, but must not offer
  a "Show names" control or copy names for Q1; other questions keep the names toggle.

---

## 3. Secrets & config (never commit these)

Two gitignored config files hold credentials. Each operator (whatever agent) creates their own
from the committed `.template`:

| File | Holds | Template |
|---|---|---|
| `~/.claude/skills/preflight-analyze/config.json` | `supabase_url`, `supabase_service_key` (service_role — bypasses RLS), `textbook_base_path`, `default_course_id` | `.ai/skills/preflight-analyze/config.json.template` |
| `supabase/admin/config.json` | `claude_code_recker` DB role creds (Session pooler host) | `supabase/admin/config.json.template` |

Notes:
- The first path is **Claude-branded but agent-neutral in practice** — the Python scripts read it via
  `~/.claude/skills/preflight-analyze/config.json`, and a Codex operator creates the same file.
  **Decided (not yet executed):** neutralize this to a `$PREP_CONFIG` env var (or
  `~/.config/prep/config.json`) with fallback to the existing path, in one coordinated PR that
  updates every script + skill + doc + this table. Until that lands, the `~/.claude/...` path is
  authoritative.
- `textbook_base_path` is an **absolute path into the OneDrive folder**. It is the *one* place the
  local folder name is hardcoded — if the folder is renamed, update this or `preflight-analyze` loses
  its textbook RAG grounding. The textbook PDFs themselves are **not in the repo** (~968 MB; gitignored;
  fetched from Teams — see `textbook-pdfs/README.md`).
- **Never** put a service key, DB password, or student PII in a committed file (this one included),
  in a URL/query string, or in the CHANGELOG. The anon key in `site/js/config.js` is intentionally public
  (protected by RLS).

---

## 4. Operating procedures (runbooks)

The canonical domain procedures are agent-neutral Markdown runbooks under `.ai/skills/`.
**Every agent reads the same `SKILL.md` and follows it step by step.** The root auto-loading files
(`AGENTS.md`, `CLAUDE.md`) direct each supported agent to this one skill tree; do not recreate
`.agents/skills/` or `.claude/skills/` mirrors.

| Runbook (`.ai/skills/<name>/SKILL.md`) | What it does |
|---|---|
| `preflight-analyze` | Fetch responses for an assignment, grade free-response (3-state full/warn/zero, liberal), read reference PDFs for RAG, write suggested `scores` (`is_finalized=false`) + per-instructor `analysis_report` aggregated across all sections assigned to each instructor. |
| `interaction-aggregate` | Cohort AI panels (readiness summary, misconception trends, showcase quotes) → `interaction_analysis`. Run after due date. |
| `interaction-backfill` | Repair reports missing `report_data` by reconstructing schema-1 from `report_markdown`. |
| `setup-preflight` | First-time machine setup — writes the config file above. |

One-off/maintenance scripts live in `scripts/` (e.g. `scripts/fall2026/` Fall build+clean,
`scripts/training/` disposable training data). All DB-mutating scripts **must be idempotent and
dry-run by default** — print the plan and require an explicit `--commit` to write. Prefer extending
these over ad-hoc queries.

If a workflow needs agent-specific tooling, add a narrowly scoped `SKILL-<agent>.md` beside the
canonical `SKILL.md`. Keep grading rules, database safeguards, and domain logic in `SKILL.md` so
agents cannot drift.

---

## 5. Git, publishing, and the CHANGELOG

- **`main` is live.** Pushing to `main` triggers a GitHub Pages rebuild (~1–2 min) that changes the
  production site. Editing a local file does **not** affect the site until committed *and* pushed.
- **Standing authorization for live preflight analysis:** after a successful `preflight-analyze`
  run and exact read-back verification, update `CHANGELOG.md`, commit the run record, and push
  `main` unless the human explicitly opts out. The coordination gate in §0 still applies.
- **Always update `CHANGELOG.md`** for any shipped feature, fix, schema/data change, or doc edit.
  Newest first. Attribute to the requesting human **and the agent**:
  `## YYYY-MM-DD — <Human> via <Agent>` (e.g. `via Claude`, `via Codex`). State **what** and **why**.
- **Migrations:** SQL in `supabase/migrations/`, numbered. Adding a migration file ≠ applying it —
  coordinate application (see §0, no concurrent DDL) and record it in the CHANGELOG.

> Agent-specific standing authorizations (e.g. commit-and-push defaults for a particular operator)
> live in that agent's root entry file, not here.

---

## 6. Data-model rules (catalog lives in PROJECT.md)

The full table catalog, JSONB shapes, roles, and edge functions are in
`.ai/instructions/PROJECT.md`. The **rules** that govern writes are:

- **Grading is 3-state:** `full` (green), `warn` (yellow = full credit but flagged wrong/vague),
  `zero` (red). Suggested scores are always `is_finalized=false`; the human finalizes in the admin UI.
- **Interaction grade = effort** (0–5 → 0/1/2 via DB trigger); a non-meaningful reading reflection
  caps effort at 2. Full transport spec (frozen v1): `docs/contracts/INTERACTION-DATA-CONTRACT.md`.
- **The artifact↔site contract is frozen:** artifacts post by stable slug to
  `site/student/interaction-submit.html`, and AI-generated prefill links target
  `site/faculty/lessons.html`. Both paths are stubs forwarding into `site/app/` today and become
  the real pages at promotion, so **neither URL changes at go-live and neither may be moved**.
  Any multi-term work must be additive (new columns) and must not change that wire format.
  Changing a contract URL means rebuilding every deployed artifact by hand — only ever done
  between semesters (last: 2026-07-16), never mid-term.

---

## 7. New-agent quickstart

1. Clone the repo; confirm you're on `main`. Read this file (`.ai/instructions/CORE.md`),
   `.ai/instructions/PROJECT.md`, and `docs/operations/SYSTEM_GUIDE.md`.
2. Create the two config files from their `.template`s (§3). Get the service key / DB creds from the
   course director out-of-band — never from the repo.
3. Confirm the environment: Python available, no Node dependency or build step, and textbook PDFs
   present at `textbook_base_path` if you'll grade.
4. Before any DB mutation, re-read §0. For destructive ops, snapshot first.
5. Do the work using the runbooks in §4 and the scripts in `scripts/`. Keep scripts idempotent +
   dry-run-by-default.
6. Update `CHANGELOG.md` (`via <Agent>`) and, if you changed how the system is operated, this file.
7. Follow any agent-specific standing authorizations in your root entry file (`AGENTS.md` /
   `CLAUDE.md`) — otherwise commit and push only when the human asks.

---

*Keep this file current. It is the handshake between agents — if it's wrong, the next agent inherits
the mistake.*
