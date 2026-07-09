# AGENTS.md — Operating Brief for AI Agents (Claude Code, Codex, …)

This repo (`Core_Preflights`, brand **iPREP**) is developed jointly by several people running
**different AI agents** against **one shared live system**. This file is the agent-neutral
contract every agent follows. It is committed to the repo so *every* agent and human sees the
same rules.

> **Single source of truth.** This file is authoritative. Claude Code's `.claude/CLAUDE.md` and
> any future `~/.codex/AGENTS.md` should defer to it, not duplicate it. If you change how the
> system is operated, edit **this file** (and `CHANGELOG.md`), not a per-agent copy.
>
> Codex loads the **root** `AGENTS.md`; nested `AGENTS.md` files may add local context but **must not
> weaken the root safety rules** here. A personal global `~/.codex/AGENTS.md` is fine. A repo `.codex/`
> **documentation mirror** is not (it would drift) — a `.codex/config.toml` for Codex *settings* is a
> separate, legitimate thing if ever needed.

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
analyzes free-response answers and writes suggested scores.

- **Repo / Pages:** `github.com/dfpm-physics/Core_Preflights` → `https://dfpm-physics.github.io/Core_Preflights/`
  (brand is *iPREP*, but repo/Pages/export names stay `Core_Preflights` — renaming breaks deployed
  artifact links, bookmarks, and Blackboard imports).
- **Supabase:** project `shzvpmlnqfmzfmuxkowi`. **Free tier pauses after ~1 week idle** — unpause in
  the dashboard at the start of each semester.
- **Local path:** the repo currently sits under `…/USAFA Classes/PREP/physics215/` inside OneDrive
  (synced + versioned; edits sync on save).

Read these repo docs before deep work: `SYSTEM_GUIDE.md`, `INTERACTION-DATA-CONTRACT.md`,
`LESSON-UNIFICATION.md`, `INTERACTION-AGGREGATION.md`, and `.claude/CLAUDE.md` (the fullest
data-model reference — agent-neutral despite the name).

---

## 2. Environment constraints (read before running anything)

- **The project has no Node dependency or build step. Do not introduce one.** (Node/npm may be
  installed on a given machine, but nothing here uses them — no bundler, transpiler, `node --check`,
  eslint, or jest.) The frontend is hand-authored ES modules + plain CSS the browser runs directly.
  **Verify UI changes in a browser:** `python -m http.server 8000` from the repo root, open
  `http://localhost:8000/app/`. Do not add a build step.
- **Tooling is Python** using only the **standard library** (`urllib`, `json`, `zoneinfo`) against
  the Supabase REST API — see `scripts/`. Heavier DB work uses `psycopg2` in a gitignored `.venv/`
  (see `supabase/admin/`).
- **Timezone:** due dates are computed as 2359 **America/Denver** the night before a lesson and
  stored as UTC (DST-aware). Reuse the `zoneinfo` helpers in `scripts/fall2026/build_fall_preflights.py`.
- **Fall 2026 lab preflights:** the six Physics 215 lab lessons (`preflight-06`, `preflight-11`,
  `preflight-17`, `preflight-27`, `preflight-34`, `preflight-38`) intentionally use lab-instruction
  wording for Q1/Q2. Regular lesson preflights keep the book/reading wording.
- **Grade/Report privacy for Q1:** zero-point reflection questions such as Q1 should not render on
  per-student Grade-tab cards. Written-preflight reports may show Q1 raw responses, but must not offer
  a "Show names" control or copy names for Q1; other questions keep the names toggle.

---

## 3. Secrets & config (never commit these)

Two gitignored config files hold credentials. Each operator (whatever agent) creates their own
from the committed `.template`:

| File | Holds | Template |
|---|---|---|
| `~/.claude/skills/preflight-analyze/config.json` | `supabase_url`, `supabase_service_key` (service_role — bypasses RLS), `textbook_base_path`, `default_course_id` | `.claude/skills/preflight-analyze/config.json.template` |
| `supabase/admin/config.json` | `claude_code_recker` DB role creds (Session pooler host) | `supabase/admin/config.json.template` |

Notes:
- The first path is Claude-branded but **agent-neutral in practice** — the Python scripts read it via
  `~/.claude/skills/preflight-analyze/config.json`. A Codex operator creates the same file. (If we want
  a neutral path/env var, that's a small script change — do it deliberately, in one PR, and update every
  script + this table.)
- `textbook_base_path` is an **absolute path into the OneDrive folder**. It is the *one* place the
  local folder name is hardcoded — if the folder is renamed, update this or `/preflight-analyze` loses
  its textbook RAG grounding. The textbook PDFs themselves are **not in the repo** (~968 MB; gitignored;
  fetched from Teams — see `textbook-pdfs/README.md`).
- **Never** put a service key, DB password, or student PII in a committed file (this one included),
  in a URL/query string, or in the CHANGELOG. The anon key in `js/config.js` is intentionally public
  (protected by RLS).

---

## 4. Operating procedures (runbooks)

The domain procedures are written as Claude "skills" under `.claude/skills/`, but each is just a
Markdown runbook — **any agent can read the `SKILL.md` and follow it step by step**, even without
Claude's skill runner. Treat them as the shared procedure library:

| Runbook (`.claude/skills/<name>/SKILL.md`) | What it does |
|---|---|
| `preflight-analyze` | Fetch responses for an assignment, grade free-response (3-state full/warn/zero, liberal), read reference PDFs for RAG, write suggested `scores` (`is_finalized=false`) + per-instructor `analysis_report` aggregated across all sections assigned to each instructor. |
| `interaction-aggregate` | Cohort AI panels (readiness summary, misconception trends, showcase quotes) → `interaction_analysis`. Run after due date. |
| `interaction-backfill` | Repair reports missing `report_data` by reconstructing schema-1 from `report_markdown`. |
| `setup-preflight` | First-time machine setup — writes the config file above. |

One-off/maintenance scripts live in `scripts/` (e.g. `scripts/fall2026/` Fall build+clean,
`scripts/training/` disposable training data). All DB-mutating scripts **must be idempotent and
dry-run by default** — print the plan and require an explicit `--commit` to write. Prefer extending
these over ad-hoc queries.

**If you (Codex) need a capability that only exists as a Claude skill:** read its `SKILL.md`, follow
the steps, and — if it's now a shared operation — consider promoting the procedure into `scripts/` or a
`docs/runbooks/` file so it's tool-agnostic. Don't silently reimplement it differently.

---

## 5. Git, publishing, and the CHANGELOG

- **`main` is live.** Pushing to `main` triggers a GitHub Pages rebuild (~1–2 min) that changes the
  production site. Editing a local file does **not** affect the site until committed *and* pushed.
- **Standing authorization for Codex-requested changes:** when Casey asks Codex to make changes,
  Codex should update the durable memory (`AGENTS.md` or another appropriate repo doc), update
  `CHANGELOG.md`, commit, and push `main` after verification unless Casey explicitly opts out.
  Read-only exploration/questions do not trigger a commit or push. Keep unrelated changes in separate
  commits and never sweep in gitignored/local junk (`supabase/.temp/`, `.venv/`, configs).
- **Standing authorization for live preflight analysis:** after a successful `preflight-analyze`
  run and exact read-back verification, update `CHANGELOG.md`, commit the run record, and push
  `main` unless the human explicitly opts out. The coordination gate in §0 still applies.
- **Always update `CHANGELOG.md`** for any shipped feature, fix, schema/data change, or doc edit.
  Newest first. Attribute to the requesting human **and the agent**:
  `## YYYY-MM-DD — <Human> via <Agent>` (e.g. `via Claude`, `via Codex`). State **what** and **why**.
- **Migrations:** SQL in `supabase/migrations/`, numbered. Adding a migration file ≠ applying it —
  coordinate application (see §0, no concurrent DDL) and record it in the CHANGELOG.

---

## 6. Data-model quick reference

Core tables: `courses`, `students` (`auth_user_id` → Supabase Auth; `student_id` CHECK
`3000000000–3009999999`), `sections` (id `^[MT][135][A-D]$`, `course_id`), `instructors`,
`instructor_course_access` (`director`/`instructor`), `assignments` (JSONB `questions`,
`analysis_report`), `responses` (`UNIQUE(student_id, assignment_id)`), `scores`
(`question_scores` JSONB, `is_finalized`), `extensions`, `interactions` (Claude artifacts, slug id),
`preflight_interaction_reports` (`report_markdown` + `report_data` + `effort` + trigger `score`),
`interaction_analysis`, `lessons` + `lesson_completions`.

- **Grading is 3-state:** `full` (green), `warn` (yellow = full credit but flagged wrong/vague),
  `zero` (red). Suggested scores are always `is_finalized=false`; the human finalizes in the admin UI.
- **Interaction grade = effort** (0–5 → 0/1/2 via DB trigger); a non-meaningful reading reflection
  caps effort at 2. Full transport spec (frozen v1): `INTERACTION-DATA-CONTRACT.md`.
- **The artifact↔site contract is frozen:** artifacts post by stable slug to `artifact-submit.html`.
  Any multi-term work must be additive (new columns) and must not change that wire format.

---

## 7. Codex quickstart

1. Clone the repo; confirm you're on `main`. Read this file, `.claude/CLAUDE.md`, and `SYSTEM_GUIDE.md`.
2. Create the two config files from their `.template`s (§3). Get the service key / DB creds from the
   course director out-of-band — never from the repo.
3. Confirm the environment: Python available, no Node dependency or build step, and textbook PDFs
   present at `textbook_base_path` if you'll grade.
4. Before any DB mutation, re-read §0. For destructive ops, snapshot first.
5. Do the work using the runbooks in §4 and the scripts in `scripts/`. Keep scripts idempotent + dry-run-by-default.
6. Update `CHANGELOG.md` (`via Codex`) and, if you changed how the system is operated, this file.
7. Commit only when asked; remember a push to `main` publishes live.

---

*Keep this file current. It is the handshake between agents — if it's wrong, the next agent inherits the mistake.*
