# PREP — Operations & Lesson-Cycle Onboarding Review
*Read-only. No DB connection, no script executed (not even `--dry-run` or `--help`). No repo file modified.*
*Excluded (in-flight artifact library): `scripts/artifacts/**`, `_builder/**`, `docs/operations/PUBLISH-ARTIFACT.md`, `site/js/faculty-artifacts.js`, `site/faculty/artifacts.html`.*

**Counts:** 3 Blocker · 7 High · 8 Medium · 3 Low (21 findings)

---

## Verdict

A new person on a new machine **cannot get to a verified lesson-cycle run from the repo alone**, and
the gap is not technical — it is that the one document which actually describes the job,
`docs/operations/MACHINE-SETUP.md`, is referenced by *nothing*, is written as a **prompt addressed to
an AI agent by the course director** rather than as a runbook, and depends on two credential files
hand-transferred out of band with no template. The documents a newcomer *is* pointed at —
`docs/operations/SYSTEM_GUIDE.md` (CORE.md §1 and §7) and `supabase/SETUP.md` — are v1-era: the
guide's "Admin panel" link is a page deleted 2026-07-28, and `supabase/SETUP.md` would walk a new
operator into `TRUNCATE students CASCADE` against live production. The single biggest obstacle is
**discoverability plus credential bootstrap**: everything exists, spread across one unlinked file, two
gitignored secrets, and ~1,400 lines of skill prose, while the linked entry points are stale.

Two things make this worse than a documentation problem. First, **the lesson cycle cannot be run by a
human at all** — `/preflight-analyze` has no driver script, so "training a new user" is really
"training a new *machine + agent pair*", and that is nowhere stated. Second, there is a **live logic
defect in the unattended path** (OPS-07) that would silently close out only half of every lesson.

---

## The path as it exists today

### Phase A — Access and accounts
1. **Supabase dashboard** access for `shzvpmlnqfmzfmuxkowi` — to reveal the `service_role` key and
   **unpause the project** (free tier pauses after ~1 week idle). `[documented]` MACHINE-SETUP.md §5,
   CORE.md §1 — but MACHINE-SETUP is unreferenced (OPS-01).
2. **GitHub push** to `dfpm-physics/Core_Preflights` with a working HTTPS credential helper. `[documented]`
3. **Course Director / System Admin inside PREP itself.** Both analysis skills refuse an instructor. `[documented]`
4. **Teams** access to `Files → Core_Preflights_PDFs` (~968 MB). `[documented]`
5. **Obtain the contents of `supabase/admin/.env` out of band.** No template anywhere; no script
   generates it. CORE.md §3 claims it is "generated when `app_schema_bootstrap.sql` is run", but that
   already ran against production and re-running is a DDL event behind the sealed-owner gate.
   `[undocumented — tribal knowledge]` (OPS-03) — **the hard bootstrap gate.**
6. **Install an AI agent.** `[contradictory: SYSTEM_GUIDE.md step 1 says "install an agent that can run
   the workflow"; MACHINE-SETUP.md never mentions installing one, and nothing states an agent is
   mandatory rather than convenient]` (OPS-20).

### Phase B — Repo and interpreter
7. `git clone`, confirm `main`, clean tree, no divergence. `[documented]`
8. Read `CLAUDE.md`/`AGENTS.md` → `CORE.md` → `PROJECT.md`. `[documented]` — this wiring works well.
9. `python -m venv .venv` + `pip install -r requirements.txt`. `[contradictory]` — `.ai/patterns/python.md:38`
   says "**This project is standard-library-only: do not add a dependency at all**" and its checklist
   (`:399`) says the project "has no manifest to declare one in", while `requirements.txt` pins
   `psycopg2-binary==2.9.12`. The same file's settings table (`:24`) gives the correct **two-tier**
   answer. **Resolution: two tiers — `scripts/` is stdlib-only and must run with no install step;
   `supabase/admin/` may use `psycopg2` from the gitignored `.venv/`, declared in `requirements.txt`.
   The "no dependency at all" / "no manifest" sentences are wrong** (OPS-18).
10. `PYTHONIOENCODING=utf-8` on Windows. `[documented]`
11. Node **optional**, only for `tests/app-schema/` and `tests/browser-harness/`. `[documented]` and
    well handled, including the stale-PATH gotcha.

### Phase C — The three credential files
12. **`supabase/admin/.env`** — hand-placed. Keys: `PREP_DB_{HOST,PORT,NAME,SSLMODE}`,
    `PREP_PROJECT_REF`, `PREP_APP_{OWNER,DML,READ}_{ROLE,PASSWORD}`, `PREP_TEST_FACULTY_*`. Host
    **must** be the Session pooler (`aws-<n>-<region>.pooler.supabase.com:5432`), never
    `db.<ref>.supabase.co` (IPv6-only). Used by `/lesson-aggregate`, `/interaction-backfill`,
    `app_tier_check.py`, browser harness.
13. **`supabase/admin/config.json`** — from `config.json.template`; the `claude_code_recker` role for
    schema `public`. `[dead-legacy]` — that role has rights only in `public`, which no page reads;
    `interaction_reports.py` and `lesson_aggregate.py` both explicitly refuse it (OPS-13).
14. **`~/.claude/skills/preflight-analyze/config.json`** — from
    `.ai/skills/preflight-analyze/config.json.template`. `[contradictory]` — CORE.md §7 and AGENTS.md
    both say "the **two** config files"; CORE.md §3 lists three (OPS-04).
15. Optionally `/setup-preflight`. `[contradictory/stale]` — sets `textbook_base_path` to the **parent
    of the repo**, checks `Text_Book_PDFs/215 Sections/` there, ends advertising deleted
    `…/site/admin.html`, suggests unpadded `preflight-1`, and covers only 1 of 3 credentials (OPS-05).

### Phase D — Textbook corpus
16. `[contradictory — three incompatible answers]`:
    - `textbook-pdfs/README.md` + `MACHINE-SETUP.md §3`: files in `textbook-pdfs/phys-215/`, base path = `textbook-pdfs/`.
    - `textbook-pdfs/rag-manifest.txt` (the committed contract that populates the faculty **Reference
      PDF** dropdown): every entry is `Text_Book_PDFs/215 Sections/<name>.pdf`, "relative to
      `textbook_base_path` exactly as stored in `assignments.reference_pdf`".
    - `setup-preflight/SKILL.md §3c`: base path = the repo's **parent**.

    On this machine: flat `textbook-pdfs/phys-215/` (31 files) and `phys-110/` (30), no
    `Text_Book_PDFs/215 Sections/` layer — so under the README convention every manifest path misses
    and Step 3 falls through to "proceeding without textbook context" (OPS-21).

### Phase E — Verification
17. `app_tier_check.py` — expect `dml` read+write/DDL-denied, `read` read-only, `owner` **fails at
    connect (sealed)**, no tier touches `public`. `[contradictory]` CORE.md §0 says sealed `NOLOGIN`;
    `PREP-V2-CUTOVER.md:27-29` says "**deliberately unsealed as of 2026-07-28**" (OPS-19).
18. `db_check.py` — proves only the *legacy* `public` credential, which the lesson cycle never uses.
19. `lesson_aggregate.py worklist --course phys-215` — **the only check that exercises a real
    lesson-cycle path.**
20. `python scripts/docs/check_doc_sources.py` — read-only, stdlib + git. Covers only what is in
    `DOC-SOURCES.json`, which excludes every operational doc (OPS-15).
21. `python -m http.server 8000` → `http://localhost:8000/site/`.
22. **Nothing verifies the service-key config.** `/lesson-cycle` Step 0 says "**Both credentials**"
    then gives one command reading only `.env` (OPS-08).

### Phase F — The run
23. **Coordination gate (manual):** designate one operator; confirm nobody is mid-run; `git fetch`;
    never two agents in one tree; never force-push. **Nothing enforces any of it** (OPS-11).
24. `/lesson-cycle phys-215 [preflight-02] [M]` from the repo root. `[undocumented]` — no plain-language
    Codex equivalent is given, unlike `/preflight-analyze` in SYSTEM_GUIDE.
25. Agent executes: Step 0 preflight → Step 1 `worklist [--latest]` + deadline re-check → Step 2
    `/preflight-analyze` (hand-built PostgREST against schema `app`; a dropped `Accept-Profile: app` /
    `Content-Profile: app` silently hits `public` and is "a failed run, not a partial one") → Step 3
    `pull --lesson … --day … --out <scratch>/agg.json`, write scopes to `filled.json`,
    `write-analysis --dry-run` then commit, `status --day` → Step 4 `app.analysis_runs` row.
    `[undocumented]` — the scratchpad path is never named.
26. **Verification:** `/preflight-analyze` Step 9 specifies exact read-back comparison — as prose to
    the model, unchecked. `lesson_aggregate.py status` is a real check and recomputes fingerprints. So
    aggregation is machine-verified; grading is self-reported (OPS-09, OPS-10).
27. **CHANGELOG:** routine cycles self-record in `app.analysis_runs`, not `CHANGELOG.md` — a good
    decision, clearly documented.

---

## Obstacles

### OPS-01 — The real onboarding runbook is unreachable from anywhere
**Severity:** Blocker · **Category:** doc-gap
**Location:** `docs/operations/MACHINE-SETUP.md` (whole file); absent from CORE.md §4/§7, `AGENTS.md`, `CLAUDE.md`, `docs/README.md`, `docs/DOC-SOURCES.json`
**What:** By far the most accurate description of a working machine — three credentials, venv, PDFs,
optional Node, four verification commands, the "deliberately NOT transferred" list. A repo-wide grep
for `MACHINE-SETUP` outside `CHANGELOG.md` returns **zero hits**.
**Impact:** They follow CORE.md §7 → `SYSTEM_GUIDE.md`, configure one of three credentials, and find
out at `/lesson-cycle` Step 0 — or worse, after grading succeeds and aggregation fails, leaving the
lesson half-done.
**Confidence:** Confirmed
**Fix:** Link it from CORE.md §7 step 1 and the §4 table, `docs/README.md`, both agent entry files;
register in `DOC-SOURCES.json` with sources `{CORE.md, requirements.txt, app_tier_check.py, textbook-pdfs/README.md, .gitignore}`.
**Live-system risk:** None.

### OPS-02 — MACHINE-SETUP.md is a prompt to an agent, not a document a person can follow
**Severity:** High · **Category:** doc-gap
**Location:** `docs/operations/MACHINE-SETUP.md:1-13, 53-56, 73-74, 84-85`
**What:** Opens "You are in the `Core_Preflights` repo… Your job is to install everything the clone
does not carry"; repeatedly first-person: "I am transferring this file to you securely", "Ask me for
the service key when you get here".
**Impact:** A human has no counterpart to ask; a second agent inherits instructions addressed to a
specific absent human.
**Confidence:** Confirmed · **Fix:** Rewrite in third person as the runbook; move the agent-directed
framing into a `setup-machine` skill that reads it. · **Live-system risk:** None.

### OPS-03 — `supabase/admin/.env` has no template, no generator, no documented recovery
**Severity:** Blocker · **Category:** setup-friction
**Location:** `CORE.md:269` (template column is a dash); `MACHINE-SETUP.md:53-70`; `app_tier_check.py:17-30`
**What:** Two of three credentials have committed `.template` files. The third — required by
`/lesson-aggregate` and `/interaction-backfill` — does not. `app_tier_check.py` exits "No credentials
at …/.env — see app_schema_bootstrap.sql", pointing at a bootstrap that already ran against production.
**Impact:** They cannot construct it from the repo. **Hardest blocker in the path.**
**Confidence:** Confirmed
**Fix:** Commit a template with every key name, the pooler host *shape*, port, `sslmode`, and comments
on the sealed owner pair. Add one CORE.md §3 sentence naming who holds the passwords and on what
channel. ⚠ Note `.gitignore` line 4 (`.env*`) would swallow a file named `.env.template` — verify with
`git check-ignore -v` and use a negation or a different name.
**Live-system risk:** None if it holds no values.

### OPS-04 — "Two config files" vs three
**Severity:** Medium · **Category:** doc-contradiction
**Location:** `CORE.md:415` and `AGENTS.md:70` say two; `CORE.md:265-271` lists three
**Impact:** They stop after two and cannot run the aggregation half.
**Confidence:** Confirmed · **Fix:** Say three, link OPS-01's runbook. · **Risk:** None.

### OPS-05 — `/setup-preflight` is stale four ways and covers one credential
**Severity:** High · **Category:** dead-legacy
**Location:** `.ai/skills/setup-preflight/SKILL.md:93-130` (PDF path), `:246,251-256` (`preflight-1`), `:261` (dead `site/admin.html`), `:249` ("per-instructor misconception report" — retired 2026-07-21)
**Impact:** They finish with a `textbook_base_path` pointing outside the repo at a nonexistent
directory, a bookmark to a 404, no DB credentials — **and believe setup is done.**
**Confidence:** Confirmed
**Fix:** Rewrite §3c against `textbook-pdfs/` and the manifest (after OPS-21), fix the URL to
`site/faculty/admin.html`, use `preflight-02`, delete the retired sentence, add a closing section
naming the other two files. Better: fold into one `setup-machine` skill. · **Risk:** None.

### OPS-06 — The two operational writers commit by default, against a rule stated in three places
**Severity:** High · **Category:** unsafe-operation
**Location:** `supabase/admin/lesson_aggregate.py:1751`; `supabase/admin/interaction_reports.py:316`. Rule: `CORE.md:335-337`, `AGENTS.md:77-78`, `.ai/patterns/python.md:268` and checklist line 408
**What:** CORE.md §4: "All DB-mutating scripts must be idempotent and **dry-run by default** — print
the plan and require an explicit `--commit`". Every `scripts/` file honours it; the two an operator
actually runs invert it. `write-analysis --in filled.json` with no further flags **commits to production.**
**Impact:** A copy-paste that loses its tail publishes AI cohort prose to the live rollup without
review. Recoverable but visible to instructors.
**Confidence:** Confirmed
**Fix:** (a) add `--commit`, keep `--dry-run` as a deprecated alias, make no-flag print the plan; or
(b) if inverting mid-term is riskier, add an explicit carve-out to CORE.md §4 and `python.md` §8
naming these two commands. (a) is correct long-term; (b) is the honest move during term.
**Live-system risk:** Changing the default mid-semester breaks muscle memory and any scheduled
invocation — do (a) between terms.

### OPS-07 — `worklist --latest` will never run the T-day track of a split lesson
**Severity:** Blocker (unattended operation) · **Category:** unsafe-operation
**Location:** `supabase/admin/lesson_aggregate.py:1267-1269` and `:1298`
**What:** `needs_run = last_success is None and not has_analysis`. `last_success` is correctly
day-scoped; `has_analysis` counts `analysis_reports` rows for the **whole offering** — and this design
stores **one row per offering** with every scope inside it. The moment the M-day run writes that row,
`has_analysis` = 1 for the T track, `needs_run` goes false, and `--latest` returns `action: "skip"` /
reason "analysis already stored for this lesson". `/lesson-cycle` only proceeds on `action == "run"`.
**Impact:** **Invisible.** A scheduler closes out M-day, then reports `skipped` for T-day forever.
Every T cohort goes unaggregated, `__all__` is never written, and the whole-course scope stays
permanently `STALE` — which the docs teach operators to read as "the second pass is owed",
indistinguishable from this failure.
**Confidence:** Confirmed by code reading (not executed — no DB access in this review).
**Fix:** Scope `has_analysis` to the day track — count section scopes in `payload->'scopes'` whose
section meets `d.track`. Add a regression case to `supabase/admin/aggregate_summarize_test.py`.
**Live-system risk:** After the fix `--latest` starts returning `run` for previously skipped T tracks;
the first scheduled run may hit a backlog. Do a manual pass per outstanding lesson first, or fix in a
quiet window.

### OPS-08 — `/lesson-cycle` Step 0 claims to check both credentials and checks one
**Severity:** Medium · **Category:** verification-gap
**Location:** `.ai/skills/lesson-cycle/SKILL.md:59-64`
**What:** Says "**Both credentials**… A run that has only the first grades and then fails at the
aggregation step, leaving the lesson half-done", then gives one command (`app_tier_check.py`) that
reads only `.env`.
**Confidence:** Confirmed
**Fix:** Promote the stdlib connection check already sitting in `setup-preflight/SKILL.md:176-203`
into a committed `scripts/doctor.py`, and call it from Step 0. · **Risk:** None (read-only).

### OPS-09 — `/preflight-analyze` has no driver; the deterministic half is prose
**Severity:** High · **Category:** verification-gap
**Location:** `.ai/skills/preflight-analyze/SKILL.md` (837 lines); no corresponding script anywhere
**What:** `/lesson-aggregate` has `lesson_aggregate.py` doing fetch, numeric summarization, validation
and write-back, leaving only judgement to the model. `/preflight-analyze` has nothing: the agent
hand-builds every call, must remember the profile headers on **every** request, and must implement the
two skip guards, the effective-deadline precedence, the zero-non-submitter rule, the batch upsert and
the read-back comparison by following prose. The zero-non-submitter rule additionally exists as tested
Python in `scripts/fall2026/zero_non_submitters.py`, so the same rule has two implementations to keep in step.
**Impact:** Results vary with agent, model and context window; the operator cannot distinguish a
correct run from a plausible-looking one except by reading the transcript.
**Confidence:** Confirmed
**Fix:** Extract `supabase/admin/preflight_grade.py` mirroring `lesson_aggregate.py`:
`pull --course --lesson [--day] --out` (offering, questions, roster, submissions, existing grades,
skip guards pre-applied, zero-candidates pre-computed) → model emits
`{enrollment_id, question_scores, diagnostic}` → `write-grades --in … [--dry-run]` (validates the
3-state shape, points ceiling, `0<=q2_effort<=5`, absence of `text`/`honor` keys; upserts; reads back;
records `analysis_runs`). SKILL.md then shrinks to the grading judgement.
**Live-system risk:** Substantial to build mid-semester — a between-terms project. Note the guards it
would encode are already the ones the skill relies on the model to apply every run.

### OPS-10 — The cycle's audit row is honor-system, and a crashed aggregation leaves no row
**Severity:** Medium · **Category:** verification-gap
**Location:** `.ai/skills/lesson-cycle/SKILL.md:149-178`; `lesson_aggregate.py:945-960` vs `:1601-1613`
**What:** (1) The cycle-level `analysis_runs` row is written by the *agent* via hand-built REST — a
crash before Step 4 leaves no trace the cycle was attempted. (2) `_run_start`'s docstring says it is
"written BEFORE the work… a run that dies mid-way is the case an audit trail exists for", but
`cmd_write` calls it at line 1605 *as an argument to* `_run_finish`, after the `analysis_reports`
upsert has executed. So the documented "a row left at `running` is a crashed run" property does not
hold for `lesson-aggregate` either.
**Confidence:** Confirmed
**Fix:** Call `_run_start` before the `pending` loop, keep the id, `_run_finish` after. Expose
`run-open` / `run-close` subcommands so `/lesson-cycle` records its own row through code.
**Live-system risk:** Low — `analysis_runs` is append-only audit data.

### OPS-11 — The coordination gate is entirely honor-system
**Severity:** Medium · **Category:** unsafe-operation
**Location:** `CORE.md:76-89`; `.ai/skills/lesson-cycle/SKILL.md:228-242`
**What:** "Designate one operator" / "confirm no competing agent is mid-run" have no mechanism. The
skill is admirably honest ("a *mitigation*, not a substitute"), but the risk is two agents writing
`grades` and `analysis_reports` for one offering with different views of the cohort.
**Confidence:** Confirmed
**Fix:** A cheap advisory signal already exists: `analysis_runs` rows with `status='running'` for the
same `assignment_offering_id`. Have the doctor query for one and warn/refuse if a run has been
`running` under ~2h. Advisory, not a lock — but it converts "ask around" into a check.
**Live-system risk:** Low; a false positive from an abandoned row is exactly the signal that row exists to give.

### OPS-12 — `supabase/SETUP.md` would walk a newcomer into destructive SQL on production
**Severity:** Blocker (safety) · **Category:** dead-legacy
**Location:** `supabase/SETUP.md` (whole file); specifically `:99-101` and `:106-116`
**What:** Pre-v1 guide. Tells the reader to run `schema.sql`/`rls.sql` (not the current chain),
`INSERT INTO instructors (id, name, is_director)` (column does not exist),
`INSERT INTO sections (id, instructor_id) VALUES ('M1A', …)` (sections are uuid-keyed and
offering-scoped), edit `physics215/js/config.js` (gone since the 2026-07-15 reorg), and — under
"Semester Reset Checklist" — **`TRUNCATE students CASCADE;`**. `SYSTEM_GUIDE.md` carries a 2026-07-27
"**Do not do that**" banner over the equivalent statements; this file never got one.
`CHANGELOG.md:7115` records the staleness on 2026-07-15 and it was never fixed.
**Impact:** A newcomer searching "setup" finds this first (it is the only file literally named SETUP).
Its last section destroys the live roster.
**Confidence:** Confirmed
**Fix:** **Delete it.** A pointer stub invites restoration; if one is kept, it should say only where
bootstrap, machine setup and term-start actually live.
**Live-system risk:** None from the edit; high from leaving it.

### OPS-13 — `supabase/admin/README.md` and `AGENT-DB-ACCESS.md` document the retired `public` model as current
**Severity:** High · **Category:** dead-legacy
**Location:** `supabase/admin/README.md:25-29, 71-78`; `supabase/admin/AGENT-DB-ACCESS.md` (whole file, esp. §3-§6, §11)
**What:** Both present `claude_code_recker` as *the* way an agent reaches the database, speaking
exclusively of schema `public`, `preflight_interaction_reports`, `report_data`, and the migration-013
0–2 score trigger. All retired. `interaction_reports.py` was rewritten against `app` and its skill
says "**Do not** pass the legacy `supabase/admin/config.json` credential — that role only ever had
rights in `public`", directly contradicting README's "Using it" section. README is also where
`MACHINE-SETUP.md §2b` sends the operator for "the full setup runbook".
**Confidence:** Confirmed
**Fix:** Rewrite README around the `.env` tiers with `config.json` demoted to a labelled legacy
section. Retire `AGENT-DB-ACCESS.md` or rewrite it against `prep_app_dml` — its §5 operating rules are
genuinely good and worth keeping; they just name the wrong role and trigger. · **Risk:** None.

### OPS-14 — `SYSTEM_GUIDE.md`, named as required reading, is half-superseded and has no lesson-cycle setup
**Severity:** High · **Category:** doc-gap
**Location:** `docs/operations/SYSTEM_GUIDE.md:4`, `:26-57`, `:173-215`, `:219-316`
**What:** Two sections carry proper ⚠ SUPERSEDED banners. Three did not: the header's **Admin panel**
link is `site/admin.html` (deleted 2026-07-28); "Adding an Instructor" still says "fill in a temporary
password" (the edge function now *rejects* a supplied password) despite a correcting note above it;
the whole "Lesson Interactions" section routes the director to `interactions-admin.html`, also
deleted. Most relevant: the analysis section sets up only `/preflight-analyze`, describes
`/lesson-aggregate` in prose, and gives **no setup, no command and no credential** for it.
`/lesson-cycle` is never mentioned.
**Impact:** The only linked operating guide teaches half the cycle and links to two 404s — and
`site/help/admin-system-operations.md` defers to it, propagating the staleness into in-app help.
**Confidence:** Confirmed
**Fix:** Fix the header link; banner or delete the two stale step lists; add a "Running the lesson
cycle" section naming `/lesson-cycle`, the `.env` credential and the four verification commands. It
*is* indexed in `DOC-SOURCES.json` (reviewed 2026-08-07) — but its sources are roster/account modules
only, which is why the interaction and analysis staleness never flagged. Add
`.ai/skills/lesson-cycle/SKILL.md` and the `site/faculty/` page paths to its source list. · **Risk:** None.

### OPS-15 — Every operational document is outside the staleness safety net
**Severity:** Medium · **Category:** doc-gap
**Location:** `docs/DOC-SOURCES.json` (22 entries)
**What:** Covers 8 help topics, 2 operations docs, 4 cross-cutting skills, 2 patterns files and 4
`_builder` references. It does **not** cover `MACHINE-SETUP.md`, `supabase/SETUP.md`,
`supabase/admin/README.md`, `AGENT-DB-ACCESS.md`, or any of the five domain skills. Those skills *are*
listed as **sources** for help docs, so changing one flags the help page but never the skill.
**Impact:** The mechanism CORE.md §5 presents as the guard against stale documentation **structurally
cannot see the documents a new user depends on.** This is the systemic cause of OPS-05, OPS-12, OPS-13 and OPS-14.
**Confidence:** Confirmed
**Fix:** Add entries for the four operational docs and five domain skills. Natural sources: per skill,
`CORE.md` + `PROJECT.md` + the script it drives; for `MACHINE-SETUP.md`, `requirements.txt` +
`app_tier_check.py` + `textbook-pdfs/README.md` + `.gitignore`.
**Live-system risk:** None. Expect the first run after adding to be red — that is the point.

### OPS-16 — CORE.md §4's skill index is missing three of nine skills
**Severity:** Low · **Category:** doc-contradiction
**Location:** `CORE.md:308-317` (6 rows); `.ai/skills/` has 9; `.ai/README.md:38-41` names all 9
**What:** `safe-change`, `skill-author`, `integration-package` (added 2026-08-07) are absent.
**Impact:** An agent discovering skills from §4 — as both entry files instruct — will not know
`safe-change` exists, which is precisely the skill governing the irreversible operations a nervous
newcomer attempts.
**Confidence:** Confirmed · **Fix:** Add three rows. · **Risk:** None.

### OPS-17 — Skill commands hardcode the Windows venv path
**Severity:** Low · **Category:** setup-friction
**Location:** `lesson-cycle/SKILL.md:63,73,134`; `lesson-aggregate/SKILL.md:135,146,154,449-450,471`; `interaction-backfill/SKILL.md:70,84,92,154-155`
**What:** Every command is `.venv/Scripts/python`. `requirements.txt` and `supabase/admin/README.md`
give the POSIX form; the skills never do.
**Impact:** A teammate on macOS fails on the first command of Step 0.
**Confidence:** Confirmed · **Fix:** One sentence per skill. · **Risk:** None.

### OPS-18 — "Standard-library-only" is stated absolutely and is false
**Severity:** Medium · **Category:** doc-contradiction
**Location:** `.ai/patterns/python.md:38` and `:399` vs `:23-24` and `requirements.txt`
**What:** The same file states both the correct two-tier rule and its overstatement — and the
overstatement is the one in bold and in the commit checklist, which also claims the project "has no manifest".
**Impact:** An agent following the checklist would refuse to pin a dependency for `supabase/admin/`,
or conclude the repo is inconsistent and pick either answer.
**Confidence:** Confirmed
**Fix:** Rewrite `:38` and the checklist line to scope the rule to `scripts/` and name
`requirements.txt` as the admin-tier manifest. Add the same one-liner to CORE.md §2. · **Risk:** None.

### OPS-19 — Is `prep_app_owner` sealed? Two documents disagree, and the verify step depends on it
**Severity:** Medium · **Category:** doc-contradiction
**Location:** `CORE.md:66-72` vs `docs/operations/PREP-V2-CUTOVER.md:27-29`
**What:** CORE.md: sealed `NOLOGIN`, "cannot connect at all". Cutover doc: "**deliberately unsealed as
of 2026-07-28** while the course director is still making schema tweaks". `MACHINE-SETUP.md §6` and
`app_tier_check.py:141-143` both treat "owner cannot connect" as the correct outcome.
**Impact:** The one check proving the DDL gate is closed becomes uninterpretable on the run where it
matters most — the first one.
**Confidence:** Needs-verification (requires connecting as the owner tier, not done here).
**Fix:** Establish the state, record it in exactly one place (CORE.md §0), have the cutover doc link
rather than assert. Better: have `app_tier_check.py` print an explicit `owner: SEALED` /
`owner: UNSEALED — a DDL window is open` line rather than a connect failure the reader must interpret.
**Live-system risk:** None from documenting; re-sealing is a §0 coordination event (roadmap P0.2).

### OPS-20 — Nothing states plainly that an AI agent is mandatory
**Severity:** Medium · **Category:** doc-gap
**Location:** all `.ai/skills/*/SKILL.md`; `SYSTEM_GUIDE.md:227-229`
**What:** The decisive answer is **no, a human cannot run a lesson cycle without an agent**, and it
needs saying because half the cycle *looks* scriptable. `lesson_aggregate.py`'s `pull` only produces
inputs and `write-analysis` only validates outputs — the readiness summary, recommendation and quote
selection are model-authored. `/preflight-analyze` has no script at all.
**Impact:** A director expecting to be trained on a tool discovers they are being trained on an
agent-operating procedure, and MACHINE-SETUP.md never tells them to install one.
**Confidence:** Confirmed
**Fix:** One paragraph at the top of the runbook: what the machine needs, what the *agent* needs, and
which parts are model judgement versus deterministic code. Add "install Claude Code or Codex" as step 0.
**Risk:** None.

### OPS-21 — Three incompatible answers for `textbook_base_path`; RAG is probably silently off
**Severity:** High · **Category:** doc-contradiction
**Location:** `textbook-pdfs/README.md:7-40` + `MACHINE-SETUP.md:100-116` vs `textbook-pdfs/rag-manifest.txt:13+` vs `.ai/skills/setup-preflight/SKILL.md:93-115`
**What:** `/preflight-analyze` Step 3 resolves `{PDF_BASE}/{REFERENCE_PDF}` where `REFERENCE_PDF`
comes from `activities.content.reference_pdf`, and the manifest is the committed contract for those
strings. Its entries all begin `Text_Book_PDFs/215 Sections/`. On this machine the files are flat
under `textbook-pdfs/phys-215/` (31) and `phys-110/` (30).
**Impact:** They follow the README, grading runs, Step 3 says "PDF not found… proceeding without
textbook context", and the run **reports success**. Yellow feedback loses its textbook grounding — the
thing the 968 MB corpus exists for — and nothing downstream can tell.
**Confidence:** Likely (the three-way documentary disagreement and the on-disk layout are confirmed;
which string `reference_pdf` actually holds needs a DB read, not performed here).
**Fix:** Pick one layout. The manifest is hardest to change (committed contract, values stored
per-assignment), so the cheapest correct fix is to make `textbook-pdfs/` contain
`Text_Book_PDFs/215 Sections/` and update README, MACHINE-SETUP and `setup-preflight` to match. Then
make the miss **loud**: `/preflight-analyze` should print "RAG: k of N referenced PDFs resolved" in
its run-report header, not only as a per-file warning.
**Live-system risk:** None to the database; moving local files is per-machine.

---

## Legacy inventory

### Documents

| path | purpose | still needed? | evidence | disposition |
|---|---|---|---|---|
| `docs/operations/MACHINE-SETUP.md` | Full machine-parity setup | **Yes — the best doc here** | Only file listing all 3 credentials + verification | **keep**, rewrite third-person, link everywhere |
| `docs/operations/SYSTEM_GUIDE.md` | Director operating guide | Yes, but half-stale | 2 sections banner-superseded, 3 not; no lesson-cycle content | **keep + repair** |
| `supabase/SETUP.md` | v1 Supabase bootstrap | **No** | `physics215/js/config.js`, `is_director`, `TRUNCATE students CASCADE` | **delete** |
| `supabase/admin/README.md` | `claude_code_recker` setup | Partly | Sends the operator to a `public`-only role the skills refuse | **merge** into MACHINE-SETUP; legacy stub |
| `supabase/admin/AGENT-DB-ACCESS.md` | Agent DB operating manual | Rules yes, facts no | `preflight_interaction_reports`, migration-013 trigger | **archive** provenance; port §5 rules to the `.env` tiers |
| `docs/operations/PREP-V2-CUTOVER.md` | Cutover record | Yes, as history | Self-labelled "a record, not a plan" | **keep**; resolve the seal contradiction |
| `docs/architecture/LESSON-UNIFICATION.md` | v2 design | Yes, as history | Still says `/interaction-aggregate`, `interaction_analysis` | **keep** + one-line banner |
| `docs/decisions/*`, `docs/contracts/*` | Point-in-time records | Yes | Deliberately excluded from DOC-SOURCES.json | **keep** — the exclusion is correct |
| `docs/app/*` (7 plan/inventory files) | v2 build plans | Historical | All reference `site/app/`, which no longer exists | **archive** under `docs/app/archive/` with a banner |

### Skills

| path | purpose | still needed? | evidence | disposition |
|---|---|---|---|---|
| `lesson-cycle/` | The entry point | **Yes** | Correct, current, honest about limits | **keep** |
| `preflight-analyze/` | Per-student grading | **Yes** | Current w.r.t. every retirement checked | **keep**; extract a driver (OPS-09) |
| `lesson-aggregate/` | Cohort rollup | **Yes** | Current; retirements correctly marked | **keep** |
| `interaction-backfill/` | Repair missing `report_data` | **Yes, but rarely** | Contract §3.1 now *requires* `d=`; but PROJECT.md records that **every** Fall 2026 interactive submission needed this skill | **keep as insurance**; relabel frontmatter "historical repair, not a cycle step" |
| `setup-preflight/` | Config wizard | Superseded in shape | Stale 4 ways; 1 of 3 credentials | **merge** into `setup-machine` |
| `preflight-analyze/SKILL-claude.md` (5 lines) | "use PDF reading"; "the slash spelling is a convenience" | Marginal | Both true of any Claude session | **merge** the PDF sentence into SKILL.md Step 3; delete |
| `preflight-analyze/SKILL-codex.md` (6 lines) | PDF skill; safe HTTP; no key in output | Marginal | "Never expose the key" is already SKILL.md Rule 7 | **merge and delete** |
| `setup-preflight/SKILL-{claude,codex}.md` | 12 / 6 lines | **No — they contradict each other** | claude: "examples are Bash… **do not translate to PowerShell**"; codex: "On Windows, use **PowerShell-native** checks rather than Bash-only examples" | **delete both**; state once in SKILL.md |
| `safe-change/`, `skill-author/`, `integration-package/` | Cross-cutting meta-skills | Yes (new 2026-08-07) | Not in CORE.md §4 | **keep**; add to the index |

**On the addenda generally:** four of six vendor addendum files carry no instruction not already in the
shared SKILL.md, and one pair actively contradicts itself on shell choice. The `SKILL-<agent>.md`
*mechanism* is sound for genuine tool differences; these instances are ceremony.

### Scripts (~32 Python files, excluding `scripts/artifacts/**`)

| path | still needed? | disposition |
|---|---|---|
| `supabase/admin/lesson_aggregate.py` | **Yes — core** (1,786 lines; drives two skills) | **keep**; fix OPS-06/07/10 |
| `supabase/admin/app_tier_check.py` | **Yes — core** (Step 0 of three skills) | **keep**; add explicit seal-state line |
| `supabase/admin/interaction_reports.py` | Yes | **keep** |
| `supabase/admin/db_check.py` | Legacy (`public` role only) | **keep** while `public` is the rollback; label legacy |
| `supabase/admin/*_test.py` (5 files) | **Yes** — the de-facto Python test suite | **keep**; add an OPS-07 regression |
| `supabase/admin/{grade_interactive,commit_interactive_drafts,content_isolation_check}.py` | Yes | **keep** |
| `scripts/docs/check_doc_sources.py` | **Yes** | **keep**; widen its index |
| `scripts/calendar/build_academic_calendar.py` | **Yes** — the one fact not derivable from the DB | **keep** |
| `scripts/app/create_course_offering.py`, `gen_db_schema.py` | **Yes** | **keep** |
| `scripts/fall2026/{build_fall_preflights,build_110_preflights,set_due_time}.py` | **Yes** | **keep** |
| `scripts/fall2026/zero_non_submitters{,_test}.py` | Diminishing | **keep to term end, then archive**; keep `_test.py` |
| `scripts/fall2026/{export_poc_snapshot,clean_poc}.py` | Historical, but **the reference pattern** cited by CORE.md §0 | **keep the pair as the worked example**; **archive** the 12 `poc-archive/*.json` data files |
| `scripts/fall2026/{clean_stale_phys110_ids,port_sandbox_due_dates,isolate_offering_content,split_training_offering}.py` | **No** — one-time July 2026 repairs | **archive** to `scripts/_history/` |
| `scripts/fall2026/extract_preflight_figures.py` | Conditionally | **keep** — idempotent, re-runnable |
| `scripts/app_migration/apply_app_migration.py` | **Yes** — the only sanctioned DDL path | **keep** |
| `scripts/app_migration/freeze_term.py` | **Yes** | **keep** |
| `scripts/app_migration/{migrate_public_to_app,migrate_training_responses,seed_faculty_interactive_lesson02}.py` | **No** | **archive** |
| `scripts/promote_app.py` | **No** — self-refuses on the missing tree | **archive** |
| `scripts/training/seed_training_lessons_03_04.py` | Yes, seasonally | **keep** |
| `scripts/training/seed_training_preflight02.py` | **No** — seeds legacy `public` | **archive** |
| `scripts/test_faculty_account.py` | Yes until P0.2 | **keep** |
| `scripts/review/serve_review.py`, `serve_artifact_review.py` | `[DEFERRED-ARTIFACTS]` | not assessed |
| `scripts/test-data/seed-test-data.js` | **No** — predates `app`; the sole `scripts/` Node dependency | **archive** |

**Summary:** of ~32 non-excluded Python files, **13 are live operational tooling**, **6 per-term or
conditional**, **5 the test suite**, and **8 are executed one-time history** that belong in
`scripts/_history/`. Moving them is the cheapest single act that makes `scripts/` legible: the
live-to-dead ratio in the directory listing is currently about 1:1 and nothing in the tree
distinguishes them.

---

## Proposed target state

**One document, one skill, one script.** Everything a new operator needs reachable from a single named
entry point, and every claim that document makes checkable by a command it names.

**1. `docs/operations/MACHINE-SETUP.md` becomes the canonical runbook** — third person, linked from
CORE.md §7 step 1, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, and registered in `DOC-SOURCES.json`.
Gains a step 0 ("install an agent") and a plain statement of what the agent does versus what code
does. Loses the first-person session framing.

**2. `.ai/skills/setup-machine/` replaces `setup-preflight`** — walks the *whole* setup, not one file
of three. It should: read `MACHINE-SETUP.md` rather than restating it (so the two cannot drift);
create all three credential files from templates, asking the human for every secret and **never
guessing one**; refuse to proceed past a missing secret rather than writing a placeholder; never echo
a key (mask to 12 chars); and end by running the doctor and printing its output verbatim.

**3. `scripts/doctor.py` — a preflight-doctor.** Standard library only (so it runs before the venv
exists), read-only, non-zero exit on any FAIL, one line per check.

```
python scripts/doctor.py            # full environment report
python scripts/doctor.py --for-run  # the subset /lesson-cycle Step 0 needs, quiet on success
```

| # | Check | How | Failure means |
|---|---|---|---|
| 1 | Python ≥ 3.10, report exact version | `sys.version_info` | a `scripts/` file may use syntax you lack |
| 2 | `.venv` exists and imports `psycopg2` | subprocess `-c "import psycopg2"` | admin tooling unavailable |
| 3 | `supabase/admin/.env` present, 9 required keys non-empty | reuse `app_tier_check.read_env` | aggregation half cannot run |
| 4 | `PREP_DB_HOST` is a **pooler** host | `"pooler.supabase.com" in host` | the classic IPv6 failure, caught before it costs a timeout |
| 5 | `~/.claude/skills/preflight-analyze/config.json` parses, 4 keys | `json.loads` | grading half cannot run |
| 6 | Service key is not the anon key | compare to `site/js/config.js`; warn if equal or < 100 chars | a 401 mid-run |
| 7 | Supabase reachable **and schema `app` visible** | `GET /rest/v1/courses?select=code&limit=1` with `Accept-Profile: app` | project paused, or wrong profile header |
| 8 | Project not paused | same call; 5xx/timeout distinguishes | the seasonal free-tier pause |
| 9 | `textbook_base_path` resolves ≥1 manifest entry | read `rag-manifest.txt`, `os.path.exists` | **RAG silently off** (OPS-21) — report `k of N resolved` |
| 10 | Git: on `main`, clean tree, no divergence | `git status --porcelain`, `git rev-list --count` | CORE.md §0 gate items 3 and 4 |
| 11 | No `analysis_runs status='running'` newer than ~2h for this course | REST read | advisory concurrency signal (OPS-11) |
| 12 | `check_doc_sources.py` exit code | subprocess | a derived doc is stale |

**What it must refuse to do:** connect as `prep_app_owner`; write anything; print any secret beyond a
12-character mask; run any part of a lesson cycle; or "fix" anything it finds. **It must work with no
credentials present**, degrading each unavailable check to `SKIP (no credential)` — its most important
audience is the person who has not got them yet.

`/lesson-cycle` Step 0 then becomes `python scripts/doctor.py --for-run` plus `app_tier_check.py`, and
the "both credentials" claim becomes true.

**4. `supabase/admin/preflight_grade.py`** — the missing half of the symmetry (OPS-09). Between terms, not now.

**5. Housekeeping that costs nothing:** delete `supabase/SETUP.md`; move the 8 executed one-time
scripts to `scripts/_history/`; add three rows to CORE.md §4; add the four operational docs and five
domain skills to `DOC-SOURCES.json`; fix the "two config files" count in two places; add the
POSIX/Windows venv sentence to three skills.

**Constraints respected:** no build step and nothing touching `site/`; Windows-primary with the POSIX
form merely noted; `doctor.py` is stdlib and *probes* for `psycopg2` rather than importing it, so it
runs before the venv exists; every change except OPS-06 and OPS-07 is documentation or file movement,
OPS-06 is deferred to a term break, and OPS-07 should be paired with a manual catch-up over any
skipped T track. Because `doctor.py` is a script and not a skill, Claude, Codex and a human all run
the same thing and get the same output — the property the `SKILL-<agent>.md` addenda were reaching for
and mostly failing to deliver.

---

## Positive findings

1. **The two-layer instruction architecture works.** Thin wiring (`CLAUDE.md`/`AGENTS.md`) → one
   authoritative contract (`CORE.md`) → deep reference (`PROJECT.md`) → procedures (`.ai/skills/`),
   with "CORE.md wins" restated in every file. The explicit ban on `.claude/skills/` mirrors is exactly
   right and is why there is only one copy of each procedure to go stale.
2. **Retirements are handled with unusual discipline.** Every one checked — `by_question`,
   `misconception_trends`, the `grader` role, `/interaction-aggregate`→`/lesson-aggregate`,
   `site/app/`, `site/interactions.html` — is marked at the point of use with a date, a reason and a
   replacement, *and* the writer still accepts the retired field so a replayed file does not fail.
   `lesson_aggregate.py:1519-1521` is the model.
3. **The docs correct themselves in place, visibly.** "**Corrected 2026-07-27.** This said X. Two
   errors: …" and ⚠ SUPERSEDED banners over retired procedures rather than deletions. That pattern is
   why the *contract* documents are trustworthy even though the *operational* ones are not.
4. **`lesson_aggregate.py` is genuinely well-built.** Server-side re-derivation of `n` and
   `source_fingerprint` so model metadata cannot drift; quote-membership validation; refusal of quotes
   on `__all__` and `section_notes` off an instructor scope; merge-not-replace so M and T runs cannot
   collide; enforced prose caps with rejection rather than silent reflow; `status` recomputing
   fingerprints so `STALE` is a real signal. `--day` / `prior_scopes` / `coverage.complete` is a
   correct and economical answer to split deadlines.
5. **The `analysis_runs` decision is right** — routing routine cycles to a DB audit table instead of
   `CHANGELOG.md`, with the reason stated, and "a row left at `running` is the point" as design (it
   just needs OPS-10 to hold).
6. **`/preflight-analyze`'s safety guards are the right ones and their reasons are recorded** — never
   overwrite `is_finalized=true`; never overwrite `source='instructor'` even unfinalized, with the
   explicit note that the second guard depends on a 2026-07-21 `faculty-grade.js` fix and "do not apply
   it to a deployment that predates it".
7. **`DOC-SOURCES.json` + `check_doc_sources.py` is a good mechanism** — read-only, stdlib, git-based,
   fires before the change lands, and `reviewed` is explicitly an attestation not an edit date. It only
   needs a wider index.
8. **The lesson-cycle skill is honest about what it cannot guarantee** — "The coordination gate,
   honestly" states that an unattended job cannot satisfy CORE.md §0, then draws two non-negotiable
   consequences. Documentation that names its own limits is worth more than documentation that is
   merely correct.
9. **`.ai/patterns/python.md` §8 and §12** are the best-written guidance in the repo and target exactly
   the failure modes that matter here.
10. **Secrets hygiene is sound.** All three credential files verified gitignored
    (`git check-ignore -v`); the anon key is deliberately public and labelled; `reset-*-password` edge
    functions *refuse* a supplied password; every skill carries a "never print the key" rule.
