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

**That database holds two schemas, but only one of them is now reachable from the site.**

| Schema | Status | Holds |
|---|---|---|
| `app` | **Live, and the only schema any page reads.** `site/js/config.js` binds the one client to `db: { schema: 'app' }`, and every page under `site/` is served from the public URLs. | The PREP v2 model, holding the real Fall 2026 content and roster |
| `public` | **Retained, unreferenced.** Nothing served from this repo queries it. Kept as the cutover rollback and as the historical record. | The original model — `assignments` / `responses` / `scores`, `interactions`, `lessons` |

**The promotion ran on 2026-07-28** (Phase 4 of
[`docs/operations/PREP-V2-CUTOVER.md`](../../docs/operations/PREP-V2-CUTOVER.md), roadmap P0.1).
`site/app/` no longer exists: its 109 files moved up to `site/`, the four legacy pages
(`admin.html`, `interactions.html`, `interactions-admin.html`, `review.html`) were deleted, and the
two frozen contract paths stopped being forwarding stubs and became the real pages at the same URLs.
So **all new work goes in `site/`** — there is no longer a legacy tree to avoid. See
[`docs/architecture/`](../../docs/architecture/) for the v2 model and why it is shaped that way.

**Do not read `public` from a page, and do not drop it either.** It is the rollback, and dropping it
is a separate snapshot-gated destructive operation that has not been authorized
([`docs/decisions/PREP-V2-SCHEMA.md`](../../docs/decisions/PREP-V2-SCHEMA.md) §8).

*(Before 2026-07-28 this table described two live schemas behind two sets of URLs, which is what the
whole `site/app/` staging arrangement existed to manage. That arrangement is over; if you find a doc
that still describes a stub forwarding into `site/app/`, it is stale — the promotion is the thing
that ended it.)*

- **Nothing an agent "remembers" privately is shared.** Claude Code has a private per-project
  memory store outside the repo; Codex has its own session state. **Neither is visible to the
  other agent or to humans.** If a fact matters to whoever works next, it must live in the
  **repo** — this file, a design doc, or `CHANGELOG.md`. Do not rely on agent memory for
  anything durable.

  **Do not write to it at all.** *(Course director's instruction, 2026-08-09, after a session
  created one.)* An agent whose harness offers a private memory store leaves that store **empty**
  on this project, and puts the note in the repo instead. The rule is stronger than "don't rely on
  it" because a *populated* private store is worse than an empty one: it reads as though the fact
  has been recorded, so nobody writes it down where the next operator can see it, and it goes stale
  with nothing checking it — the repo has `check_doc_sources.py`, a private store has nothing.
  There is a home here for every kind of note that store would hold — an open proposal goes in
  [`docs/ROADMAP.md`](../../docs/ROADMAP.md), a setup fact in `docs/operations/`, a decision in
  `docs/decisions/`, an event in `CHANGELOG.md`. **Every `.md` lives in the repo.**
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
- **DDL on `app` is coordinated, and the seal that used to enforce it is currently OPEN.** Three
  scoped roles cover that schema — `prep_app_owner` (owns it, full DDL), `prep_app_dml` (data only),
  `prep_app_read` (SELECT only). None holds any privilege on `public`.

  The design is that `prep_app_owner` sits `NOLOGIN` between changes, so it cannot connect at all
  and a schema change requires a human to run `ALTER ROLE prep_app_owner LOGIN;` as `postgres` and
  re-seal afterwards.

  > **It has not been sealed since 2026-07-23.** Verified against `pg_roles` on 2026-08-07:
  > `rolcanlogin = true` on all four roles. The `app` model has been under continuous revision and
  > re-sealing between every change was not practical, so the unseal became the steady state.
  > Roadmap **P0.2** is the standing item to close it;
  > [`docs/operations/PREP-V2-CUTOVER.md`](../../docs/operations/PREP-V2-CUTOVER.md) has said so
  > since the cutover, and this bullet claimed the opposite until 2026-08-07.
  >
  > **This paragraph now describes what is true, not what is intended, and the difference matters
  > more than the seal did.** A rule that everyone can see is false stops being read as a rule —
  > including the parts of it that still hold. What still holds, entirely: **no agent runs DDL on
  > its own.** Schema changes go to the course director as migration SQL and are applied as a
  > coordination event under the gate below. The seal was one mechanism enforcing that; the
  > obligation outlived the mechanism, and an open seal is not permission.
  >
  > It also means DDL-bearing fixes are **cheaper than they look** — no unseal ceremony stands
  > between a reviewed migration and applying it. That is an argument for batching them, not for
  > running them ad hoc.

**The builder came home on 2026-08-07, and it did NOT bring its contract with it.** `_builder/`
was a separate repository (`ranador/Socratic-Artifact-Builder`) whose own CORE.md opened *"This
project has no shared state — no production database, no live site,"* and granted a standing
authorization to commit and push freely once three checks passed. **Neither survives the merge.**
Every rule in this file now governs builder work too: the coordination gate below, the CHANGELOG
requirement, and push-only-when-asked. An artifact build touches no database, but it lands in a
repository where `main` is live, so the difference that mattered has gone.
Reasoning: [`docs/decisions/BUILDER-MERGE.md`](../../docs/decisions/BUILDER-MERGE.md).

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
  `http://localhost:8000/site/`. Do not add a build step.
- **GitHub Pages serves this repository with default Jekyll, which excludes `_`-prefixed paths.
  That exclusion is the access control on `_archive/` and `_builder/`, and it is one empty file
  away from being switched off.** Verified 2026-08-07:
  `…/docs/contracts/INTERACTION-PREFILL-LINK.md` serves the real document;
  `…/_archive/artifact-receiver-v1/` returns 404. So `docs/`, `scripts/`, `supabase/` and
  `tests/` are **already publicly readable** — that is the existing state, and nothing secret may
  go in them. **Never add a `.nojekyll` file (or a `_config.yml` that re-includes underscore
  paths) without moving `_archive/` and `_builder/` first.** Doing so would publish every
  `BUILD-LOG.md`, the 132 KB tutor system prompt, the misconception taxonomies and the worked
  extension problems, instantly and with nothing reporting it.
- **Artifact `.jsx` source does not live in the repo.** The 46 built artifacts (~8 MB) live in the
  private Supabase Storage bucket `artifact-sources`; `_builder/courses/*/artifacts/*.jsx` is a
  **gitignored local cache** populated by `python scripts/artifacts/sync_artifacts.py pull`. The
  source is not secret — claude.ai shows an artifact's formatted code behind a Code button — so
  the reason is history size, not confidentiality. The **build records** are a different matter and
  are why the bucket is private.
- **`.gitattributes` marks `_builder/preflight-kit/**` and `_builder/courses/**` as `-text`, and
  removing either line breaks things invisibly.** `core.autocrlf` is on for this machine; it has
  already twice corrupted this payload in the source repository — a fresh clone failed 6 of 7
  `MANIFEST.sha256` hashes, and separately `localize.py`'s ` ```profile ` fence regex stopped
  matching because CRLF put `\r` before the `\n`. **The working tree looked correct through both.**
  After any change to how these are stored, clone to a temp directory and run
  `python _builder/preflight-kit/tools/verify.py` **there**.
- **Tooling is Python**, **standard library by default** (`urllib`, `json`, `zoneinfo`) against the
  Supabase REST API — see `scripts/`. Heavier DB work uses `psycopg2` in a gitignored `.venv/` (see
  `supabase/admin/`). **Three named exceptions exist, all in the two Fall term builders**
  (`scripts/fall2026/build_fall_preflights.py`, `build_110_preflights.py`, and
  `extract_preflight_figures.py`): they need `python-docx` to read the source preflight DOCX, and
  **`tzdata` to make `zoneinfo` work at all on Windows** — `zoneinfo` is stdlib but ships no data,
  reads the OS tz database, and Windows has none, so `ZoneInfo("America/Denver")` raises on a stock
  Windows machine. Both are pinned in `requirements.txt`; reasoning in
  [`docs/decisions/SCRIPTS-DOCX-DEPENDENCY.md`](../../docs/decisions/SCRIPTS-DOCX-DEPENDENCY.md).
  **Everything else under `scripts/` — including everything the lesson cycle runs — is still
  stdlib-only and must stay that way.** A fourth exception needs its own decision record, not an
  import line.
- **Timezone:** due dates are computed the night before a lesson in **America/Denver** and stored
  as UTC (DST-aware). Reuse the `zoneinfo` helpers in `scripts/fall2026/build_fall_preflights.py`.
- **The deadline HOUR is course policy, not a system constant.** *(History: a flat "2359" until
  2026-07-29, when Physics 215's directors set it to 1759; moved back to 2359 on 2026-08-06 — both
  courses now want the same "right before midnight" deadline.)* **Both Physics 215 and Physics 110
  are 2359** (`23:59:59` America/Denver — the whole seconds field is `:59`, not `:00`, so every
  deadline is one instant). The hour is still a per-course decision and could diverge again; there
  is nowhere to store a per-course setting — no table under `app` carries course configuration and
  DDL is sealed (§0) — so the policy is hardcoded in **three places that must move together**:
  - `DUE_TIME_BY_COURSE` in `site/faculty/lessons.html` — what a NEW assignment's time box
    defaults to, and what a bare-date prefill link resolves to. It is now **empty** (both courses
    take the `23:59` fallback); a course wanting a different hour adds a line. An EXISTING deadline
    is reloaded from `due_by_day` and keeps whatever it was saved with, so this default never rewrites.
  - `DUE_TIME = (23, 59, 59)` in `scripts/fall2026/build_fall_preflights.py` (phys-215) and the
    `23, 59, 59` in `build_110_preflights.py` (phys-110) — what a term build writes.
  - `scripts/fall2026/set_due_time.py` — the retimer for a course that has already been built. It
    rewrites all three storage locations (`assignment_due_dates.due_at`,
    `assignment_offerings.due_at`, `assignment_offerings.due_by_day`) and is idempotent. *(The
    2026-08-06 move was run through a REST equivalent of this script because the `prep_app_*` DB
    creds were not on the operating machine; same three-location, DST-aware, keep-local-date logic.)*

  If a course ever wants a different answer, add a line. If that map reaches four or five, it has
  earned a column and the unseal is worth asking for.
- **An EMPTY `due_by_day` is not "no schedule yet" — it silently puts every section on the M-day
  deadline.** *(Added 2026-08-09, after it did exactly that to 285 cadets.)* Precedence is
  `extension > assignment_due_dates > due_by_day > due_at`, and `{}` means *"`due_at` applies to
  everyone"* — a documented default, not a gap. So a T-day section inherits the M-day date and is
  due **one to four days early**, four whenever the T meeting follows a weekend.
  - **Only the lesson editor writes the per-day map.** `site/faculty/lessons.html` populates
    `due_by_day` *and* materializes the per-section `assignment_due_dates` rows on save
    (`dueByDayRow` / `dueDateRows` in `site/js/faculty-lessons.js`). An offering created any other
    way — a term builder, a REST insert, a hand-written script — gets neither, and looks correct
    because `due_at` is right.
  - **It is invisible to a spot check.** Every M-day date reads correctly, because `due_at` *is*
    the M date (`defaultDueFrom` stores the earliest per-day value). Phys-110 Fall 2026 ran this
    way across 36 of 37 offerings; the one that was fine, `preflight-02`, was the one someone had
    opened in the editor. Check `due_by_day`, never `due_at`, when asking whether a term is
    scheduled.
  - **Detection**, for any course with more than one meeting day — the count should be zero:
    ```
    SELECT count(*) FROM app.assignment_offerings
     WHERE course_offering_id = '<uuid>' AND (due_by_day IS NULL OR due_by_day = '{}'::jsonb);
    ```
  - **Repair:** `scripts/fall2026/set_due_dates.py --course <code>` (DML tier, dry-run by default,
    idempotent) writes all three locations from that course's syllabus schedule table. Adding a
    course is a new entry in its `SCHEDULES` dict and nothing else — **never a fork of the file.**
    *(It was `set_110_due_dates.py` until 2026-08-09, when phys-215 needed it and the schedule
    became data instead of the script's identity.)*
  - **An empty map is not the only way a term goes wrong, and the other way is louder.** *(Added
    2026-08-09.)* Phys-215 Fall 2026 had a populated map and all 629 per-section rows, and **five
    offerings were still exactly one day late on both tracks** — `preflight-02`, `03`, `04`, `05`,
    `07`, with the other 32 correct, which is the signature of hand editing rather than a build.
    One day late is not cosmetic: an M-day preflight due the night before the **T**-day meeting is
    due *after its own M-day lesson has been taught*, so the cohort answers it having already sat
    the class and the instructor teaches with no readiness data. **Check dates against the
    syllabus, not just `due_by_day` for emptiness.**
  - **A repair that moves a deadline EARLIER is a different decision from one that moves it later,
    and only a human makes it.** The phys-110 fix only ever added time; the phys-215 fix took a day
    away from 138 cadets who had not yet submitted, on ~13 hours' notice. `set_due_dates.py`
    reports every earlier-moving deadline on its own line and will not let one pass unremarked;
    `--only <slugs>` restricts the write while still reporting the rest. Count what is in flight
    (`submissions`, `grades`) before committing, and put the decision to the course director.
  - **Verify a transcribed schedule against `site/data/academic-calendar.json` before writing it.**
    The academy calendar is an independent source that names each teaching day `M<n>`/`T<n>`, so a
    dropped or misread row shows up as a mismatch instead of as a wrong deadline. Check that every
    meeting date is a real teaching day **of the declared track** — that catches a whole-column
    shift, which comparing lesson numbers does not. Whether a course's lesson numbers equal the
    academy's day numbers depends on where its Graded Reviews fall: phys-215's do sit on the grid
    and its numbers match exactly, phys-110's do not and its lessons 13/24/36 disagree. Neither is
    the error; assuming either one is.
- **Publishing an assignment is not releasing it.** *(Added 2026-08-04.)* A published offering
  appears to a student only in the **7 days before that student's own deadline**
  (`LOOKAHEAD_DAYS` in `site/js/schema.js`, with `releaseAt`/`isReleased`), so a cadet cannot work
  fifteen preflights in an afternoon and reach each of those lessons having forgotten the reading.
  The filter is applied once, in `loadAssignmentStatuses` (`site/js/student-data.js`) — the one
  loader every student surface projects over — and **never** in a renderer.
  - The window is measured from the **scheduled** deadline, deliberately not the extended one:
    measuring from an extension would let granting a cadet more time remove the assignment from
    their list. Work with a submission or a grade is never withdrawn, whatever the dates say.
  - `assignment_offerings.opens_at` **overrides it per lesson**, in both directions, and the
    "Students can see it" control in `site/faculty/lessons.html` writes it. **NULL is the default
    answer, not a missing one** — it selects the rolling window. Relative presets there resolve to
    a fixed instant at save time because a `timestamptz` cannot hold "N days before" and DDL is
    sealed (§0); a fixed date therefore does **not** follow a due date edited afterwards.
  - Release instants are **floored to the start of their day**. Deadlines are 2359, so plain
    subtraction opens a lesson at 2359 — invisible all through the day it should appear, which
    delivers six days against a rule that promises seven. Both `releaseAt` and the editor's
    `daysBeforeDue` floor; they must stay in step.
  - **It is a UI rule, not a security boundary.** `ao_read_student` still returns every published
    offering, so the REST API will hand a determined cadet a future preflight. Closing that means
    adding the predicate to the RLS policy — DDL on `app`, which needs the §0 unseal. The rule
    targets pacing of ordinary use, which is the actual problem.
  - The number **7 has copies that must agree**: `LOOKAHEAD_DAYS`, the editor's standard-option
    label and its `daysBeforeDue(base, 7)` calls, and three help docs
    (`student-getting-started.md`, `director-course-structure.md`,
    `director-schema-reference.md`) — all registered in `docs/DOC-SOURCES.json`, so changing the
    constant re-flags them.
- **Which dates are M-days and which are T-days is NOT in the database and is NOT derivable.**
  *(Recorded 2026-08-01.)* `due_by_day` says "the M deadline is this timestamp" and
  `sections.meeting_days` says "this section meets on M"; neither says which calendar day is an
  M-day, because at USAFA that belongs to the academy calendar, not to a course. **The ground truth
  is the published USAFA Academic Calendar**, mirrored into the repo as
  [`site/data/academic-calendar.json`](../../site/data/academic-calendar.json) and regenerated by
  `python scripts/calendar/build_academic_calendar.py --commit` (stdlib, dry-run by default; the
  feed URL is in its header). It covers four terms and names each teaching day `M<n>` / `T<n>` —
  the track **and** the lesson number, so `preflight-14` maps to the day the academy calls `M14`.

  **Do not reconstruct the sequence.** The obvious guess — weekdays alternating M/T minus holidays
  — is wrong in every direction: real Fall 2026 runs 6 Aug – 10 Dec with **41** lesson slots, the
  gap between a lesson's M-day and its T-day is 1 day 32 times but 3 days six times and **4 days
  twice**, the weekday spread is uneven, and Fall 2025 has no M7 at all because that day was
  cancelled. The file also carries the **modified-SOC** days (locally "SSoC"), on which afternoon
  sections start an hour early — that moves when class *meets* and never moves a preflight
  deadline, which is set the evening before. It is a static JSON under `site/` because the source
  is an Outlook publish URL on another origin: a browser fetching it directly is refused by CORS,
  and the shipped site has no build step and no server to proxy through.
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
- **`PREP_TEST_FACULTY_*` is a WRITE credential, not an AUDIT one, and the difference is invisible.**
  *(Added 2026-08-14, after it produced a confident, wrong, published conclusion.)* That account is
  a director of exactly **two** course offerings — phys-110 Fall 2026 and the phys-215 **TRAINING
  SANDBOX** — and **cannot see phys-215 Fall 2026 at all.** It is an ordinary staff session, so RLS
  applies to every read. Counting through it returned **74** assignment offerings where there are
  **115**, and **6** offerings carrying an interactive activity where there are **39** — the live
  term filtered out silently, with the sandbox copy still visible to make the answer look right.

  Using it to *write* is good practice and deliberately safer than the service role: it can do
  nothing a director could not do from the browser. Using it to answer **"how many are there"** is
  unsound, because RLS answers *"what may you see"* and never tells you which question it answered.
  A `count(*)` that is silently a `count(*) WHERE visible_to_me` is indistinguishable from a fact.

  **Any claim about totals, coverage, or absence comes from `prep_app_read` over the pooler** (or
  the service role) — see `supabase/admin/.env` and the pattern in
  `scripts/artifacts/sync_artifacts.py`. Remember the pooler username is `<role>.<project_ref>`.
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
- **Never** put a service key, DB password, or connection string in a committed file (this one
  included), in a URL/query string, or in the CHANGELOG. The anon key in `site/js/config.js` is
  intentionally public (protected by RLS).
- **Never write a student's NAME where the cadet ID would carry the same meaning** — in a committed
  file, a URL/query string, or the CHANGELOG. **Cadet IDs and scores are permitted.** *(Determined
  2026-08-17: name + cadet ID + score are **not** treated as PII in this system, per institutional
  guidance received — citation to be added by Casey, who had the conversation. This reversed a blanket no-PII
  rule that stood here until that date. Reasoning, what it supersedes, and the accept-as-is ruling
  on git history: [`docs/decisions/STUDENT-DATA-CLASSIFICATION.md`](../../docs/decisions/STUDENT-DATA-CLASSIFICATION.md).)*
  The ID is also the better engineering choice — it is the join key, it is unambiguous when two
  cadets share a surname, and it does not go stale when a name changes. **Test and example fixtures
  take synthetic names**, because a file that looks synthetic and is not survives every redaction
  pass done by eye. Still barred outright: **free-text student writing paired with an identity** —
  Q3 answers, showcase quotes, reflections — which the determination does not cover.
  The machine behind this rule is `python scripts/checks/name_scan.py` (read-only, non-zero exit on
  a hit, reads the roster live and never prints a name).

**Two Storage buckets, and they are gated differently on purpose:**

| Bucket | Public? | Holds | Read | Write |
|---|---|---|---|---|
| `lesson-figures` | **yes** | question/lesson images, referenced by `questions[].figure_url` | anyone | any authenticated instructor |
| `artifact-sources` | **no** | every built artifact's `.jsx`, its parsed build record, the per-course index, and the review sidecar the Artifacts page writes | `app.is_staff()` | a director of any offering, or a global admin |

Migration `023_artifact_sources_storage.sql`, applied 2026-08-07, with a `_ROLLBACK.sql` beside it.
**A private bucket needs a policy on `storage.buckets` as well as on `storage.objects`** — that
table has RLS on with no policies, so the bucket row is otherwise invisible and reads fail as
`NoSuchBucket`. Note that error is ambiguous: **a wrong request path produces it too**, and the
correct object route is `/storage/v1/object/<bucket>/<path>`, bucket segment included.

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
| `lesson-aggregate` | **Per-cohort, and owns all of it.** Every AI panel for one lesson — readiness summary (including the common threads across the graded questions), the one-line recommendation, showcase quotes → `analysis_reports`. Modality-blind: folds the `schema: 1` assessment from *both* paths (the artifact's, on the submission; `preflight-analyze`'s, on the grade). Writes **three scope kinds** — section (recommendation + quotes), `instr:<uuid>` (the readiness summary, across every section that instructor teaches), and `__all__` (written only once every section has a scope). Run **after each day track's deadline** with `--day`. Renamed from `interaction-aggregate` 2026-07-21. *(`misconception_trends` was retired 2026-07-22 and listed here in error until 2026-07-27 — do not write it.)* |
| `interaction-backfill` | Repair reports missing `report_data` by reconstructing schema-1 from `report_markdown`. Interactive path only — the written path's equivalent is a `preflight-analyze` re-run. |
| `setup-preflight` | First-time machine setup — writes the config file above. |
| `docs-author` | Decide whether a concept warrants documentation and which kind, then write it — in-app help docs (`site/help/`) or design docs (`docs/`). Read before adding any `.md` to either. |
| `safe-change` | **The gated procedure for any change that is hard to undo** — deletes, bulk updates, migrations, publishes, credential rotation, history rewrites. Arrived with the builder 2026-08-07; PREP's equivalent was prose in §0 with no runbook behind it. Read it before the operation, not after. |
| `gemini-port` | Port one **published** Claude artifact to its Gemini-API backup build under `site/gemini/`, for cadets whose free Claude account is answering 429. Transport only — same slug, same grounding, same submit contract; `scripts/artifacts/to_gemini.py` refuses rather than warns. Verified in a real browser, because that page is the only JSX parser a backup build gets. |
| `skill-author` | Decide whether a procedure warrants a skill, then write or revise it. Read before adding any `SKILL.md`. |
| `integration-package` | Build, verify, archive or resume a package for an external AI surface that calls into this system — i.e. `.ai/integrations/custom-gpt/`. |

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
- **Interaction grade = effort** — a DB trigger converts it: `0 → 0`, `1–2 → one point`,
  `3–5 → the offering's points_possible`. **Full credit scales with the assignment; partial credit
  does not.** A non-meaningful reading reflection caps effort at 2, i.e. at that one point.
  *(Changed 2026-07-30, migration `app/019`. Partial was `points_possible / 2` from migration 013
  onward, which is the same 1 at 2 points — the only value that existed — and 1.5 once Physics 310
  shipped a 3-point assignment. Nothing stored moved; all 78 effort grades are on 2-point
  offerings.)* The curve has **six copies that must agree** — the trigger plus five display-side
  ones, listed in the migration header — because the trigger owns `points_earned` and the others
  only render it, so a divergence shows a student one score while the gradebook holds another.
  Full transport spec (frozen v1): `docs/contracts/INTERACTION-DATA-CONTRACT.md`, whose §5.2 still
  states the retired `public` 0–2 curve; it is a frozen record, not a live description.
- **The artifact↔site contract is frozen:** artifacts post by stable slug to
  `site/student/interaction-submit.html`, and AI-generated prefill links target
  `site/faculty/lessons.html`. Both were forwarding stubs until the 2026-07-28 promotion replaced
  them with the real pages **at the identical URLs**, which is what the stubs existed to guarantee.
  Neither URL changed at go-live and **neither may be moved**.
  Any multi-term work must be additive (new columns) and must not change that wire format.
  Changing a contract URL means rebuilding every deployed artifact by hand — only ever done
  between semesters (last: 2026-07-16), never mid-term.

---

## 7. New-agent quickstart

> **Setting up a NEW MACHINE? Follow
> [`docs/operations/MACHINE-SETUP.md`](../../docs/operations/MACHINE-SETUP.md) instead of this
> list.** It is the step-by-step runbook — venv, all three credential files, the PDF corpus, the
> optional Node harnesses, the accounts a human must grant you, and a verification block that
> proves each one. This section is the orientation summary; that file is the procedure.
> *(It was reachable from nothing at all until 2026-08-07 — no link from here, from `AGENTS.md`,
> from `CLAUDE.md`, or from `docs/README.md` — which is why setup kept getting re-derived.)*

1. Clone the repo; confirm you're on `main`. Read this file (`.ai/instructions/CORE.md`),
   `.ai/instructions/PROJECT.md`, and `docs/operations/SYSTEM_GUIDE.md`.
2. Create the config files from their `.template`s (§3) — `supabase/admin/.env.template`,
   `supabase/admin/config.json.template`, and
   `.ai/skills/preflight-analyze/config.json.template`. Get the service key / DB creds from the
   course director out-of-band — never from the repo.
3. Confirm the environment: Python available; the shipped site needs no Node and no build step, and
   Node itself may or may not be installed on your machine (§2). If you will grade, verify the
   textbook corpus actually resolves — `python scripts/grounding/check_grounding.py`, which is
   read-only and exits non-zero on a miss. **Do not just check that PDFs exist.**
   `textbook_base_path` must point at a directory *containing* `Text_Book_PDFs/`, not at the
   clone's `textbook-pdfs/`, and a wrong value grades the whole cohort without grounding while
   warning only once.
4. Before any DB mutation, re-read §0. For destructive ops, snapshot first.
5. Do the work using the runbooks in §4 and the scripts in `scripts/`. Keep scripts idempotent +
   dry-run-by-default.
6. Update `CHANGELOG.md` (`via <Agent>`) and, if you changed how the system is operated, this file.
7. Follow any agent-specific standing authorizations in your root entry file (`AGENTS.md` /
   `CLAUDE.md`) — otherwise commit and push only when the human asks.

---

*Keep this file current. It is the handshake between agents — if it's wrong, the next agent inherits
the mistake.*
