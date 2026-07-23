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

**That database now holds two schemas. Know which one you are touching.**

| Schema | Status | Holds |
|---|---|---|
| `public` | **Live.** Serves every page in `site/`. Authoritative for anything student-facing today. | The original model — `assignments` / `responses` / `scores`, `interactions`, `lessons` |
| `app` | **Built, tested, not yet wired to any page.** | The PREP v2 redesign, holding the real Fall 2026 content and roster |

`app` is not dead code and `public` is not obsolete. The app refactor in `site/app/` will cut over
to `app`; until it does, a change to student-visible behaviour belongs in `public`. See
[`docs/architecture/`](../../docs/architecture/) for the v2 model and why it is shaped that way.

- **Nothing an agent "remembers" privately is shared.** Claude Code has a private per-project
  memory store outside the repo; Codex has its own session state. **Neither is visible to the
  other agent or to humans.** If a fact matters to whoever works next, it must live in the
  **repo** — this file, a design doc, or `CHANGELOG.md`. Do not rely on agent memory for
  anything durable.
- **Log every state-changing run in `CHANGELOG.md`** (schema, bulk data, roster, publishes) —
  **except routine analysis runs**, which record themselves in `app.analysis_runs` instead. A term
  is ~40 lessons closed out twice each; 80+ hand-written entries would bury what that file is read
  for, and an instructor cannot read it anyway. `/preflight-analyze`, `/lesson-aggregate` and
  `/lesson-cycle` each write a row covering who ran it (human or scheduled), when, what it touched
  and what it skipped. A schema change, bulk correction or one-off repair still belongs here.
- **Destructive DB ops are gated:** snapshot to JSON first, verify the snapshot matches live
  counts, then delete with an explicit `--commit`. See `scripts/fall2026/` for the reference
  pattern (`export_poc_snapshot.py` → `clean_poc.py`).
- **No concurrent DDL.** Schema changes (new tables/columns/policies) are coordinated in advance,
  never run by two agents at once. The service key is DML-only by convention; the `claude_code_recker`
  DB role is explicitly `BYPASSRLS` **but has no DDL**.
- **DDL on `app` is sealed shut.** Three scoped roles cover that schema — `prep_app_owner` (owns it,
  full DDL), `prep_app_dml` (data only), `prep_app_read` (SELECT only). None holds any privilege on
  `public`. After build-out the owner was set `NOLOGIN`, so it **cannot connect at all**; a schema
  change requires a human to run `ALTER ROLE prep_app_owner LOGIN;` as `postgres`, and to re-seal
  afterwards. Treat an unseal as a coordination event under the gate below.

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

- **The shipped site has no Node dependency and no build step. Do not introduce one.** The frontend
  is hand-authored ES modules + plain CSS the browser runs directly — nothing compiled, bundled, or
  transpiled, and no `package.json` anywhere under `site/`.
- **Node may be available locally. Never assume it is.** It is installed on the course director's
  machine (`C:\Program Files\nodejs`, v24.18.0 as of 2026-07-21) and is **not guaranteed on any
  other machine** — a teammate's clone, a fresh container, or CI may have none. Treat it as
  *optional developer tooling*, exactly the way `tests/app-schema/` already does: useful for running
  the shipped modules under test, a `node --check` syntax pass, or driving a headless browser to
  verify UI that would otherwise go unverified. Three rules keep it optional:
  - **Nothing on the deploy path may require it.** Delete every Node artifact and the site must be
    unchanged.
  - **A Node-only check is never the sole verification of a change.** If it is all you ran, say so
    in `CHANGELOG.md` — the next operator may have no Node and needs to know what is still unproven.
  - **Confine `package.json` and `node_modules/` to the tool's own folder**, gitignored, as
    `tests/app-schema/` does. No root-level manifest.

  *Gotcha:* an agent session that started **before** Node was installed inherits a stale `PATH` and
  reports `node: not found` even though it is present. Check `C:\Program Files\nodejs\node.exe`
  directly before concluding it is absent, or restart the session.
- **Verify UI changes in a browser:** `python -m http.server 8000` from the repo root, open
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
| `supabase/admin/.env` | The three `prep_app_*` role credentials for schema `app` (same pooler host), plus the temporary `PREP_TEST_FACULTY_*` login for the P0.5 browser walkthrough | — generated when `app_schema_bootstrap.sql` is run |

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
| `lesson-cycle` | **The normal entry point.** Runs `preflight-analyze` then `lesson-aggregate` for one lesson and one day track, after that day's deadline. Adds the checks that only make sense between them (deadline passed, grading produced the assessments aggregation consumes, whole-course scope written only once every section exists). Also the entry point for an unattended scheduled run — the repo schedules nothing itself; see its SKILL.md. |
| `preflight-analyze` | **Per-student, and nothing else.** Fetch responses for an assignment, grade free-response (3-state full/warn/zero, liberal), read reference PDFs for RAG, write suggested `grades` (`is_finalized=false`) + the per-student `schema: 1` assessment into `grades.diagnostic`. Writes **no** cohort output — its per-instructor `by_question` rows were retired 2026-07-21. Run whenever work needs grading; may be run per day filter (M/T). |
| `lesson-aggregate` | **Per-cohort, and owns all of it.** Every AI panel for one lesson — readiness summary (including the common threads across the graded questions), misconception trends, the one-line recommendation, showcase quotes → `analysis_reports`. Modality-blind: folds the `schema: 1` assessment from *both* paths (the artifact's, on the submission; `preflight-analyze`'s, on the grade). Aggregates **by section first**, then synthesizes the whole-course scope from those section scopes. Run **after each day track's deadline** with `--day`. Renamed from `interaction-aggregate` 2026-07-21. |
| `interaction-backfill` | Repair reports missing `report_data` by reconstructing schema-1 from `report_markdown`. Interactive path only — the written path's equivalent is a `preflight-analyze` re-run. |
| `setup-preflight` | First-time machine setup — writes the config file above. |
| `docs-author` | Decide whether a concept warrants documentation and which kind, then write it — in-app help docs (`site/app/help/`) or design docs (`docs/`). Read before adding any `.md` to either. |

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
- **Derived documents are indexed — when you change a source, check them.**
  [`docs/DOC-SOURCES.json`](../../docs/DOC-SOURCES.json) maps every document that **must stay
  current** — the in-app help topics, `docs/operations/`, the authoring contract, this repo's
  skills — to the authoritative sources it was written from. Before committing a change to **this
  file**, `PROJECT.md`, a skill, a contract, or any frontend module named in that index, run:
  ```
  python scripts/docs/check_doc_sources.py
  ```
  It is read-only (stdlib + `git`), exits non-zero when something is flagged, and catches
  uncommitted edits — so it fires *before* the change lands, not after. For each flagged document:
  fix it if it is now wrong, or bump its `reviewed` date if it is still correct. **A help doc that
  contradicts the system is a bug** — students and instructors read those pages as authoritative,
  and a stale one is worse than none. Registering a new document in the index is part of creating
  it; see `.ai/skills/docs-author/`.
  *Not indexed on purpose:* `docs/decisions/` and `docs/contracts/`. Those are point-in-time records
  and frozen interfaces — they are superseded, never refreshed.
- **Always update `CHANGELOG.md`** for any shipped feature, fix, schema/data change, or doc edit.
  Newest first. Attribute to the requesting human **and the agent**:
  `## YYYY-MM-DD — <Human> via <Agent>` (e.g. `via Claude`, `via Codex`). State **what** and **why**.
- **Migrations — two separate chains, one per schema.** `supabase/migrations/*.sql` is the chain for
  `public`; `supabase/migrations/app/*.sql` is the chain for `app`. They are numbered independently
  and must not be interleaved. Adding a migration file ≠ applying it — coordinate application
  (see §0, no concurrent DDL) and record it in the CHANGELOG. Applying anything in the `app` chain
  additionally requires unsealing `prep_app_owner` first.
- **`021_lesson_finalize_and_extensions.sql` is deliberately unapplied. Do not apply it.** It looks
  like a pending migration; it is not. It implements the lesson-unification model that the `app`
  redesign replaced. Applying it would add columns and triggers to `public` that nothing wants.

> Agent-specific standing authorizations (e.g. commit-and-push defaults for a particular operator)
> live in that agent's root entry file, not here.

---

## 6. Data-model rules (catalog lives in PROJECT.md)

The full table catalog, JSONB shapes, roles, and edge functions are in
`.ai/instructions/PROJECT.md`. The **rules** that govern writes are:

- **Grading is 3-state:** `full` (green), `warn` (yellow = full credit but flagged wrong/vague),
  `zero` (red). Suggested scores are always `is_finalized=false`; the human finalizes in the admin UI.
- **Written-preflight diagnostics are not grades:** `/preflight-analyze` writes them into
  `app.grades.diagnostic` (jsonb) — the 0–5 `q2_effort` / `q3_understanding` pair, plus a
  `schema: 1` per-student assessment (overall effort + understanding, `misconceptions[]`,
  reading-reflection judgment, flags) in the same shape the artifact emits. Nothing in that column
  ever affects points, feedback, status, totals, or finalization, and no student page requests or
  renders any of it. The `effort` inside `diagnostic` is **not** `grades.effort`: written
  offerings are `grading_mode='points'`, where points come from `question_scores`.
  *(The retired `public` equivalent was `scores.q2_effort` / `.q3_understanding`, migration 022.)*
- **One per-student shape, two producers.** The artifact writes `schema: 1` to
  `submission_activities.content`; `/preflight-analyze` writes it to `grades.diagnostic`. That is
  what lets `/lesson-aggregate` summarize a cohort without caring how each student worked the
  lesson. Per-student extraction and cohort synthesis stay **separate skills on separate clocks** —
  grading runs early and often (often split M/T), aggregation runs once after the deadline.
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
3. Confirm the environment: Python available; the shipped site needs no Node and no build step, and
   Node itself may or may not be installed on your machine (§2); textbook PDFs present at
   `textbook_base_path` if you'll grade.
4. Before any DB mutation, re-read §0. For destructive ops, snapshot first.
5. Do the work using the runbooks in §4 and the scripts in `scripts/`. Keep scripts idempotent +
   dry-run-by-default.
6. Update `CHANGELOG.md` (`via <Agent>`) and, if you changed how the system is operated, this file.
7. Follow any agent-specific standing authorizations in your root entry file (`AGENTS.md` /
   `CLAUDE.md`) — otherwise commit and push only when the human asks.

---

*Keep this file current. It is the handshake between agents — if it's wrong, the next agent inherits
the mistake.*
