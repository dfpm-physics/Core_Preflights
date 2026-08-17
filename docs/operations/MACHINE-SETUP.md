# Setup task: bring this clone to full working parity

> **Only need to close out a lesson?** Read
> [`ONBOARD-AGGREGATION.md`](ONBOARD-AGGREGATION.md) instead — the capability-scoped path, about
> ten minutes and no 968 MB download for an interactive lesson. This document is **full
> development parity**, which is more than a close-out operator needs.
>
> Either way, start by asking the machine what it already has:
> ```
> python scripts/onboarding/prep_doctor.py
> ```
> Read-only, stdlib-only, and it runs **before** the venv exists. It reports per capability with
> the specific blocker and fix for each, so the steps below can be done in any order and re-checked
> as you go.

You are in the `Core_Preflights` repo (PREP). The repo is already cloned and current here. Your job
is to install everything the clone does **not** carry, so this machine can do every task the other
development desktop can — run the lesson cycle, drive the admin DB tooling, run the optional Node
test harnesses, and publish.

Read `CLAUDE.md` → `.ai/instructions/CORE.md` → `.ai/instructions/PROJECT.md` before acting.
**Do not commit or push during setup. Do not run a live analysis until I say so.**

Work top to bottom. Stop and ask me whenever a step needs a secret — I supply those, you never
guess or invent one.

---

## 0. Confirm the starting point

```
git fetch && git status --porcelain && git log --oneline -1
```

Clean tree, no divergence from `origin/main`. If either fails, stop and tell me.

---

## 1. Python — the primary tooling

All repo tooling is Python. Scripts under `scripts/` are stdlib-only against the Supabase REST API;
`supabase/admin/` uses `psycopg2` from a project-local venv.

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Reference machine: Python 3.14.0, psycopg2 2.9.12. Never install these globally, never copy a
`.venv` between machines. On Windows set `PYTHONIOENCODING=utf-8` before any script that prints
report text — reports carry emoji and cp1252 stdout crashes on them.

> **Every command line in this document is written for Windows, because the reference machine is.**
> On macOS or Linux the interpreter is **`.venv/bin/python`**, not `.venv\Scripts\python`, and paths
> take forward slashes — so `.venv/bin/python supabase/admin/app_tier_check.py`. The
> `PYTHONIOENCODING` line above is Windows-only; a POSIX shell is already UTF-8. Nothing else
> differs: the same venv, the same three credential files at the same paths, the same checks.
> Operators do run this project from both, so translate rather than assuming a command is broken.

---

## 2. Credentials — three gitignored files

These are the whole reason a clone isn't enough. Different tools use different credentials on
different transports; that separation is deliberate, so don't consolidate them.

| File | Credential | Used by |
|---|---|---|
| `supabase/admin/.env` | the `prep_app_*` roles for schema `app` + the test faculty login | `/lesson-aggregate`, `app_tier_check.py`, the browser harness |
| `supabase/admin/config.json` | the `claude_code_recker` role for schema `public` | `/interaction-backfill`, `db_check.py`, `interaction_reports.py` |
| `~/.claude/skills/preflight-analyze/config.json` | Supabase `service_role` key (REST) | `/preflight-analyze` |

### 2a. `supabase/admin/.env`

I am transferring this file to you securely. Put it at `supabase/admin/.env` — it is gitignored by
the `.env*` pattern. Confirm these keys are present and report any that are missing:

```
PREP_DB_HOST  PREP_DB_PORT  PREP_DB_NAME  PREP_DB_SSLMODE  PREP_PROJECT_REF
PREP_APP_OWNER_ROLE / _PASSWORD      <- sealed tier, see below
PREP_APP_DML_ROLE   / _PASSWORD      <- everyday tier
PREP_APP_READ_ROLE  / _PASSWORD      <- analysis tier
PREP_TEST_FACULTY_EMAIL / _PASSWORD / _UID
```

**About the owner pair.** `prep_app_owner` is the only role with DDL on schema `app`. The design
is that it sits sealed `NOLOGIN` between schema changes (CORE.md §0), so holding the credential
does not confer DDL.

> **It is NOT sealed right now, and has not been since 2026-07-23.** Verified against `pg_roles`
> on 2026-08-07: `rolcanlogin = true`. The `app` model has been under continuous revision and
> re-sealing between every change was not practical. So `app_tier_check.py` **connects** as owner
> and reports DDL succeeding — on a sealed database that same result would be a serious finding,
> and here it is just the current state. Do not "fix" it, and do not read the seal language in
> CORE.md §0 as a description of today.
>
> What has *not* changed: **you still do not run DDL on your own.** Schema changes go to the
> course director as migration SQL and are applied as a coordinated event (CORE.md §0). The seal
> was one mechanism enforcing that rule; the rule outlived the mechanism.

### 2b. `supabase/admin/config.json`

I am transferring this too. Template and full setup runbook: `supabase/admin/README.md`. Shape is
host / port / dbname / user / password / sslmode. The `host` must be the **Session pooler** host
(`aws-<n>-<region>.pooler.supabase.com`, port 5432) — the direct `db.<ref>.supabase.co` host is
IPv6-only and will not resolve. The pooler username format is `<role>.<project-ref>`.

The operating manual for this role is `supabase/admin/AGENT-DB-ACCESS.md` — read it before any
write through it.

### 2c. `~/.claude/skills/preflight-analyze/config.json`

**This one does not exist on the other machine either, so there is nothing to copy — you create it
here.** Template: `.ai/skills/preflight-analyze/config.json.template`.

| Key | Value |
|---|---|
| `supabase_url` | `https://shzvpmlnqfmzfmuxkowi.supabase.co` |
| `supabase_service_key` | ask me — Supabase dashboard → Project Settings → API → reveal `service_role` |
| `textbook_base_path` | **absolute path on THIS machine to a folder CONTAINING `Text_Book_PDFs/`** — see §3, and note this is *not* the clone's `textbook-pdfs/` |
| `default_course_id` | `phys-215` |

Ask me for the service key when you get here. `/setup-preflight` walks this interactively if you
prefer. The file lives outside the repo and stays there — never echo the key back, never write it
into anything under the repo tree, never into a URL or the CHANGELOG.

---

## 3. Textbook PDFs (~968 MB, gitignored)

RAG grounding for grading. Source: Teams → Files → `Core_Preflights_PDFs`. Destination:

```
textbook-pdfs/phys-215/
textbook-pdfs/phys-110/
```

Filenames must match `textbook-pdfs/rag-manifest.txt` exactly — that committed manifest is the
contract that keeps names identical across clones, and the faculty lesson editor populates its
"Reference PDF" dropdown from it.

**Then set `textbook_base_path` to something else, and verify it.** The manifest entries — and
the `reference_pdf` strings on 111 live activities — all begin `Text_Book_PDFs/<NNN> Sections/`,
which is *not* the folder layout above. The grader resolves `textbook_base_path` + manifest
entry, so the base must be a directory containing a `Text_Book_PDFs/` tree with `110 Sections`
and `215 Sections` inside it. `textbook-pdfs/README.md` gives the two supported ways to satisfy
that (put the PDFs in that shape, or link to the repo folders) with copy-paste commands.

```
python scripts/grounding/check_grounding.py
```

Read-only, exits non-zero on any miss, prints `k of N` per course. **Run it and report the
numbers** — this is the one setup step whose failure is completely invisible afterwards, because
`/preflight-analyze` warns once and then grades the entire cohort without textbook context.
Reference machine as of 2026-08-07: **58 of 58**, 30 under 215 and 28 under 110.

*Before 2026-08-07 this section said the reference machine held "31 files under phys-215 and 0
under phys-110, so phys-110 grading there already runs without RAG." The files were present; the
manifest simply did not list any of them, so nothing could reference them.*

---

## 4. Node — optional developer tooling only

CORE.md §2: the shipped site has no Node dependency and no build step, and nothing on the deploy
path may require one. Node exists purely for two test harnesses. Reference machine runs v24.18.0.
If Node is not installed here, everything except §4 still works — tell me and move on.

```
cd tests/app-schema      && npm install     # @supabase/supabase-js — runs the shipped modules against live DB
cd tests/browser-harness && npm install     # puppeteer-core — drives real Chrome
```

Both `node_modules/` are gitignored and must stay inside their own folder. **No root-level
`package.json`, ever.**

The browser harness additionally needs Chrome or Edge at a standard Windows path (auto-detected;
`--chrome` overrides) and reads the `PREP_TEST_FACULTY_*` values from the `.env`, so no secret ever
appears on a command line. Its README is `tests/browser-harness/README.md`.

A caveat you must honor when reporting results: a Node-only check is **never** the sole verification
of a change. If it is all you ran, say so explicitly in the CHANGELOG entry.

---

## 5. Access I need to have granted you (not files — accounts)

- **Supabase dashboard** for project `shzvpmlnqfmzfmuxkowi` — to read the service key and to
  **unpause the project**, which the free tier does after ~1 week idle.
- **GitHub push** to `dfpm-physics/Core_Preflights` over HTTPS, with a working credential helper.
  `main` is live: pushing rebuilds GitHub Pages in 1–2 minutes.
- **Course Director / System Admin** in PREP itself — both analysis skills require it.
- **Teams** access for the PDF folder.

---

## 6. Verify — run all of these and report each result

```
python scripts\onboarding\prep_doctor.py
.venv\Scripts\python supabase\admin\app_tier_check.py
.venv\Scripts\python supabase\admin\db_check.py
.venv\Scripts\python supabase\admin\lesson_aggregate.py worklist --course phys-215
.venv\Scripts\python supabase\admin\worklist_dayscope_test.py
python scripts\docs\check_doc_sources.py
python scripts\grounding\check_grounding.py
```

Expected:

- **`app_tier_check.py`** — `prep_app_dml` connects, reads and writes in `app`, **DDL denied**;
  `prep_app_read` reads but cannot write; and **no tier can touch `public`**. `prep_app_owner`
  **currently connects and can do DDL** — see §2a. The design is that it fails at connect; that
  is not today's state and a successful owner probe is not a fault to report.
- **`check_grounding.py`** — `58 of 58`. Anything less means grading will silently run without
  textbook context; fix it before your first run rather than after.
- **`db_check.py`** — connects as `claude_code_recker`, reads real rows, `ALTER`/`DROP` come back
  **DENIED**.
- **`prep_doctor.py`** — every capability `OK`. It is the summary the rest of this list details;
  a `BLOCKED` line names the file or command that fixes it.
- **`worklist`** — returns the course's past-due day tracks. Early in a term the honest answer is
  often `Nothing past due`, which is a pass. To see it populated without waiting for a deadline,
  add `--as-of 2026-08-10T06:30Z` — a read-only rehearsal that moves the clock for that one
  predicate and prints a banner saying so.
- **`worklist_dayscope_test.py`** — 19 checks, all pass. It guards the rule that "already
  analyzed" is asked **per day track**: one `analysis_reports` row holds every track's scopes, so
  counting the row made a lesson's second track report `skip` forever and never get aggregated.
- **`check_doc_sources.py`** — read-only; exits non-zero when a derived doc is stale. On a fresh
  clean clone it should pass.

Then the UI, which needs no build step:

```
python -m http.server 8000     # open http://localhost:8000/site/
```

And if you installed Node:

```
cd tests/app-schema && npm test
node tests/browser-harness/hold.mjs      # needs no server and no account
```

**If a connection fails**, the overwhelmingly common cause is the direct `db.<ref>.supabase.co`
host instead of the Session pooler host. Check `PREP_DB_HOST` and `config.json`'s `host` first.

Report back: which credential files are in place (contents never shown), Python and psycopg2
versions, whether Node is present and which harnesses installed, PDF counts per course, and the
output of each verification above.

---

## 7. Deliberately NOT transferred — do not go looking for these

- `.venv/`, `node_modules/` — rebuilt above, never copied.
- `_snapshots/` — local pre-mutation safety dumps; regenerated on demand, carry live structure.
- `supabase/.temp/` — machine-specific Supabase CLI state. The CLI itself is **not installed** on
  the reference machine; if a task needs it, tell me rather than assuming it is here.
- `site/js/config.local.js` — absent on the reference machine.
- `../Preflights/Physics215_Preflight_Questions_v12.docx` — CORE.md §2 names this path as the
  Physics 215 preflight source, but **it does not exist at that path on the reference machine
  either**. If a task needs the source DOCX, ask me for it; do not conclude the repo is broken.

---

## 8. Standing rules — these are not setup steps, they are permanent

- **One production database, one live site, several agents and machines.** Before any live DB
  mutation or push to `main`: confirm with me that no other agent or machine is mid-run on the same
  area, `git fetch` and check for divergence, and treat every write as immediately visible to
  everyone. CORE.md §0 is authoritative and overrides anything you infer.
- **Never run two agents in the same working tree. Never force-push.**
- **Destructive DB ops are snapshot-gated**: export to JSON, verify counts against live, then
  `--commit`. Every DB-mutating script must be idempotent and dry-run by default.
- **No DDL.** Schema changes go to me as migration SQL. Two migration chains exist and must not be
  interleaved: `supabase/migrations/` for `public`, `supabase/migrations/app/` for `app`.
  `021_lesson_finalize_and_extensions.sql` is deliberately unapplied — do not apply it.
- **A student's NAME, and any student-written text, stay in the session scratchpad** — never under
  the repo tree, never in the CHANGELOG. **Cadet IDs and scores are permitted** and are the right
  way to identify a record: see
  [`docs/decisions/STUDENT-DATA-CLASSIFICATION.md`](../decisions/STUDENT-DATA-CLASSIFICATION.md)
  and CORE.md §3. `python scripts/checks/name_scan.py` is the check.
- **`CHANGELOG.md`** gets an entry for any shipped feature, fix, schema/data change, or doc edit —
  `## YYYY-MM-DD — <Human> via <Agent>`. Routine grade-and-aggregate runs are the exception: they
  record themselves in `app.analysis_runs` instead.
- **Before committing** a change to CORE.md, PROJECT.md, a skill, a contract, or an indexed frontend
  module, run `python scripts/docs/check_doc_sources.py` and resolve what it flags.

---

## 9. When setup is confirmed

Don't start a run on your own. Wait for me to name the course, lesson, and day track. Read the full
`SKILL.md` before first use of any of these:

```
/lesson-cycle phys-215 <assignment-slug> M      # the normal entry point: grade, then aggregate
/preflight-analyze phys-215 <slug> M            # per-student grading alone
/lesson-aggregate                               # cohort rollup alone, after a regrade
/interaction-backfill                           # repair interactive reports missing structured data
/docs-author                                    # before adding any .md to site/help/ or docs/
```

Skills live in `.ai/skills/<name>/SKILL.md` — the shared, agent-neutral runbooks. Read the matching
`SKILL-claude.md` beside one when it exists. Do not create `.claude/skills/` mirrors.
