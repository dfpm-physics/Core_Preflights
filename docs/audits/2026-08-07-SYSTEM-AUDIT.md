# PREP / Core_Preflights — Full System Audit & Remediation Plan
**Date:** 2026-08-07 · **Method:** six parallel read-only specialist audits, cross-refereed
**Status:** nothing was changed. No database connection was made. No script was executed.

**Scope excluded:** the artifact library, actively being edited by another agent —
`site/faculty/artifacts.html`, `site/js/faculty-artifacts.js`, `scripts/artifacts/**`, `_builder/**`,
`docs/operations/PUBLISH-ARTIFACT.md`, `supabase/migrations/023_artifact_sources_storage*.sql`,
`tests/browser/test-artifacts.html`. See §9 for what still needs a pass there once it settles.

**Supporting detail:** `2026-08-07-security.md`, `2026-08-07-database.md`, `2026-08-07-frontend.md`,
`2026-08-07-onboarding.md`, `2026-08-07-python.md`, `2026-08-07-docs-tests.md` — 94 findings with
file:line locations, fixes, and live-system risk notes.

> **§10 records the course director's clarifications from the review session.** Three of them change
> how a finding should be read — including the entry point for C2 and the scope of C4. Read §10
> alongside §3.

---

## 1. Executive summary

The system is **better engineered than its size suggests**. Zero loose equality across 26k lines of
JS, one escaping helper used consistently, a real module-linker test for a project with no build step,
migration headers that document the bug they close with counts verified against live, and comments
that explain the *failure* rather than the code. The `app` schema's RLS model genuinely closes the four
findings that motivated the v2 rewrite. Credential hygiene is clean — no secret has ever been committed
in the repo's history.

The problems are not sloppiness. They are **three structural patterns**, each of which produced
findings independently in four or more of the six audits:

1. **"Copies that must agree" is the dominant failure mode.** The project *knows* this — CORE.md
   registers three such constant sets by name. But the registry is maintained by hand, and the audit
   found a seventh copy of the effort→points curve that migration 019's careful six-copy inventory
   missed, twelve hand-written copies of the roster join, five reimplementations of `connect()`, and
   thirteen copies of a console workaround. The registry cannot see code that doesn't look like code.
2. **Failures render as emptiness, not as errors.** 55 of 120 Supabase calls discard `error`; four
   pages have no entry-point guard; the aggregation worklist silently skips half of every lesson;
   textbook RAG grounding is probably off right now and the run reports success. In each case the
   system does something plausible instead of saying it failed.
3. **The documentation that would onboard someone is unreachable, and the documentation that is
   reachable is stale.** The single accurate setup runbook is referenced by nothing. The file literally
   named `SETUP.md` ends with `TRUNCATE students CASCADE` against production.

Two **Critical** security findings and one **Critical** correctness finding need attention regardless
of everything else. The good news is that the highest-severity item has a one-statement fix that needs
no schema change and no downtime.

### Severity roll-up across all six audits

| | Critical / Blocker | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Security | 2 | 4 | 5 | 6 | 17* |
| Database | 0 | 4 | 4 | 6 | 14 |
| Frontend | 1 | 4 | 4 | 7 | 16 |
| Onboarding / Ops | 3 | 7 | 8 | 3 | 21 |
| Python tooling | 3 | 1 | 5 | 5 | 15* |
| Docs & tests | 0 | 4 | 6 | 3 | 13 |
| **Total** | **9** | **24** | **32** | **30** | **94** |

*\* adjusted from the source reports: SEC counts corrected for arithmetic; PY-04 re-rated from High to
Low-Medium after the docs/tests audit verified it is currently inert (§7).*

---

## 2. Verify before you act — read-only, do these first

Several findings are **Confirmed in source but conditional on live state**, and two of them change the
whole priority order. All SQL below is safe as the `prep_app_read` tier and appears in full in
`report-database.md` §4.

| # | Question | Why it gates work | Query / check |
|---|---|---|---|
| V1 | Is `prep_app_owner` actually `NOLOGIN`? | CORE.md §0 says sealed; `PREP-V2-CUTOVER.md` says deliberately unsealed 2026-07-23 and nine CHANGELOG entries flag it never re-sealed. **Every DDL recommendation's cost depends on this.** | `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'prep_app%';` |
| V2 | Do the live policies match the committed migrations? | `PREP-V2-AUTHORIZATION.md:3` says "written, not yet applied." **Confirm before acting on SEC-01.** | `SELECT polname, polcmd, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid='app.instructors'::regclass;` + `information_schema.column_privileges` |
| V3 | Is `expected_response` populated on published Fall 2026 offerings? | SEC-03 is **High** if yes, **Low** if the builders left it empty | `SELECT slug, content->'q3' ? 'expected_response' FROM app.activities …` |
| V4 | Does any `grading_mode='effort'` offering exist? | DB-02 shows students a literal 0; latent unless one exists. **DB column default is `'effort'`.** | see `report-database.md` §4 query 3 |
| V5 | Any submission already in the DB-01 broken state? | If yes, a section's grade save is **already failing** | `WHERE s.chosen_activity_id IS NULL AND g.effort IS NOT NULL` |
| V6 | Any `grader` rows in `staff_assignments`? | Must be migrated before the CHECK can be tightened | `SELECT role, count(*) FROM app.staff_assignments GROUP BY role;` |
| V7 | Does `textbook_base_path` resolve any `rag-manifest.txt` entry? | **Grading may be running without textbook grounding right now** | filesystem check, no DB |
| V8 | Is the GitHub repo public? | Changes the reading of SEC-15 and the PII conclusion | repo settings |
| V9 | Any `submission_activities` mutated after its grade finalized? | Detects whether SEC-02 has already been exploited | see `report-database.md` §4 query 7 |

**V1, V7 and V9 are the ones I would run today.** V9 in particular is cheap and answers "has this
already happened."

---

## 3. Critical and Blocker findings

### C1 · Any instructor can make themselves system admin with one API call
`SEC-01` — `supabase/migrations/app/002_rls.sql:263-264`

`instructors_update_own` restricts *which row* a user may update, never *which columns*. There are no
column-level grants anywhere in `app` and no trigger on `instructors`. `is_global_admin` lives on that
row. So:
```js
await db.from('instructors').update({ is_global_admin: true })
        .eq('id', (await db.auth.getUser()).data.user.id)
```
grants full cross-course system admin — every roster row, every grade, every EI note, plus the generic
CRUD browser at `site/faculty/system.html`. Nothing is logged, because it is a plain UPDATE.

**Fix:** `REVOKE UPDATE (is_global_admin) ON app.instructors FROM authenticated, anon;`
**This is a grant change, not schema DDL — it does not need the sealed-owner unseal, runs as
`postgres` in seconds, and is invisible to students.** Verify V2 first.

### C2 · A student can write their own grade on any interactive assignment
`SEC-02` + `SEC-04` + `DB-04` — *three audits found this independently*

`sa_student_write` is `FOR ALL` with only an enrolment-ownership predicate — no `status`, no
`is_final`, no deadline. Migration 015's `SECURITY DEFINER` trigger then reads `effort` out of
`submission_activities.content` and writes a **finalized** grade. Two REST calls set effort 5 and
commit; `ON CONFLICT … WHERE source='derived'` makes it repeatable. Auto-finalized, so no review queue
catches it. The same policy gap also means answers are editable *after* the deadline and
`report_markdown` — the audit trail that justifies auto-finalizing — is student-deletable.

**Fix:** a `BEFORE UPDATE OR DELETE` trigger on `submission_activities` refusing any change once the
parent submission is `committed`. One guard closes SEC-02, SEC-04 and DB-04 together. Migration 006
already established this exact pattern, with a written argument for why a trigger and not RLS
(`WITH CHECK` cannot see `OLD`). **Needs DDL.**

### C3 · A seventh copy of the effort→points curve, and it is the diverged one
`FE-01` — `site/student/interaction-submit.html:62-67`

Migration 019 changed partial credit from `points_possible / 2` to flat `LEAST(1, points_possible)`
and named **six copies that must agree**. All six were updated. This page holds a seventh, still using
the retired rule, and prints its result to the student: *"an effort rating of 2/5 (about **1.5** of 3
pts)"* — where the database writes **1**.

Invisible today because at 2 points both formulas give 1. The two Physics 310 lessons are 3-point.
The first graded 3-point interactive misquotes a score on the submission-confirmation screen, and the
instructor never sees what the student was told.

> **This is the audit's most instructive finding.** The database audit independently verified the six
> registered copies and found them in perfect agreement — a genuine positive. The frontend audit found
> the seventh. It survived a careful inventory for one reason: **it was inline in an HTML file, so it
> did not look like code.** That is the argument for §6 Phase 5.

**Fix:** import `pointsFromEffort` from `../js/schema.js` — the page already imports two symbols from
that module. One identifier added, one function deleted. Two-minute swap.

### C4 · The aggregation worklist will never run the T-day track of a split lesson
`OPS-07` — `supabase/admin/lesson_aggregate.py:1267-1269`

`needs_run = last_success is None and not has_analysis`. `last_success` is correctly day-scoped;
`has_analysis` counts `analysis_reports` rows for the **whole offering** — and the design stores one
row per offering with all scopes inside it. The moment the M-day run writes that row, the T track
reports `action: "skip"` forever.

**Impact:** an unattended scheduler closes out M-day and silently abandons every T cohort. `__all__` is
never written and the whole-course scope stays permanently `STALE` — which the docs teach operators to
read as "the second pass is owed," making the failure indistinguishable from normal.

**Fix:** scope `has_analysis` to the day track by counting section scopes in `payload->'scopes'` whose
section meets that track. Add a regression case to `aggregate_summarize_test.py`. Expect a backlog on
first run after the fix — do a manual catch-up pass per outstanding lesson.

### C5 · `supabase/SETUP.md` walks a newcomer into `TRUNCATE students CASCADE`
`OPS-12`

A pre-v1 guide, never banner-marked, that instructs the reader to run the wrong schema files, insert
rows with columns that no longer exist, edit a directory deleted in July — and, under "Semester Reset
Checklist," truncate the live roster. `SYSTEM_GUIDE.md` got a "**Do not do that**" banner over the
equivalent statements on 2026-07-27; this file never did. It is the only file in the repo literally
named `SETUP`, so it is what a newcomer searching for setup finds first.

**Fix:** delete it. A pointer stub invites restoration.

### C6 · Onboarding is not reachable from the repo
`OPS-01` + `OPS-03`

The one accurate machine-setup document, `docs/operations/MACHINE-SETUP.md`, is referenced by
**nothing** — not CORE.md, not `AGENTS.md`/`CLAUDE.md`, not `docs/README.md`, not `DOC-SOURCES.json`.
A repo-wide grep outside CHANGELOG returns zero hits. And the credential it depends on,
`supabase/admin/.env`, has **no template and no generator**, so it cannot be constructed from the repo
at all. See §5.

### C7 · The two most-used database writers commit by default
`PY-01` + `OPS-06` — *found independently by two audits*

CORE.md §4, `AGENTS.md`, and `.ai/patterns/python.md` all state that DB-mutating scripts must be
dry-run by default and require `--commit`. Every script in `scripts/` honours it. The two an operator
actually runs — `lesson_aggregate.py write-analysis` and `interaction_reports.py write` — invert it:
`--dry-run` is the opt-in. A copy-paste that loses its trailing flag publishes AI cohort prose to the
live rollup with no review.

**Fix:** invert to `--commit`. **But do this between terms** — changing it mid-semester breaks muscle
memory and any scheduled invocation. Until then, document the carve-out explicitly.

### C8 · The Physics 110 term builder hardcodes another person's macOS home directory
`PY-02` — `scripts/fall2026/build_110_preflights.py:40-41`

`/Users/caseypellizzari/...`, no config fallback — unlike its Physics 215 sibling, which correctly
reads `textbook_base_path`. Breaks on every Windows machine including the course director's.

### C9 · Three live `scripts/` files import an undeclared third-party package
`PY-03` — both term builders and `extract_preflight_figures.py` use `from docx import Document`

`python-docx` is not stdlib, is not in `requirements.txt`, and has no decision record — violating the
stdlib-only rule stated in three places. A new operator following the documented setup gets an
`ImportError` with no indication what to install.

---

## 4. The three structural patterns

Fixing individual findings is worth doing. Fixing the pattern is what stops them recurring.

### Pattern A — Hand-maintained "copies that must agree"

| Concept | Copies | Diverged? |
|---|---|---|
| effort → points curve | **7** (6 registered) | **Yes** — the unregistered one (C3) |
| roster enrollment→student SELECT | **12** | **Yes** — 2 carry `status`, 2 don't |
| `connect()` in Python admin tooling | **5** | **Yes** — one will `KeyError` on missing defaults |
| Windows UTF-8 console workaround | **13**, in 5 styles | 3 use a form documented in-repo as buggy |
| section-scope vocabulary | **4** sentinel schemes | Yes — 3 labels for one option |
| `read_env()` | 3 | No (comments admit the copy) |
| chunk size for `.in()` URLs | 3 values (300/300/200) | Yes — only one is named |
| deadline hour · release window | 3 · 7 | **No** — both verified consistent |

The two sets CORE.md registers *by name* are the two that are correct. That is not a coincidence — the
registry works. It just cannot see inline code, and it is updated by hand. **The structural fix is to
make the copies unnecessary** (import the constant) rather than to lengthen the registry.

### Pattern B — Failures that render as emptiness

- **55 of 120** Supabase calls discard `error` (`FE-02`). supabase-js returns `{data, error}`; it does
  not throw. `data || []` turns an RLS refusal, a network drop, or the **weekly free-tier pause** into
  "you have no assignments." `util.js` has `showFatal`/`runPage` written precisely so a failed page says
  so — but `runPage` only catches *thrown* errors, so the guard and the data layer pass each other by.
- **4 of 19 pages** have no entry-point guard (`FE-03`) — including `report.html` (the largest faculty
  page) and `interaction-submit.html`, where a cadet lands holding the only copy of their report in a
  URL hash. A throw there reads as "my work vanished."
- **Aggregation skips half of every lesson** and reports `skipped`, which looks normal (`C4`).
- **Textbook RAG is probably off right now** (`OPS-21`) — three documents give three incompatible
  answers for `textbook_base_path`, the manifest expects a directory layer that doesn't exist on disk,
  and a miss prints a per-file warning while the run reports success.
- **The Grade panel doesn't chunk its `.in()` lists** (`DB-10`) while every other hot path does — and
  the failure mode of an over-long URL is a *truncated* filter, i.e. silently fewer students.
- **A batch grade save can fail for an entire section** with an opaque `23514` naming no student
  (`DB-01`).

### Pattern C — Documentation authority is unreachable, stale, or unverifiable

- The accurate runbook is linked from nowhere (`C6`); the dangerous one is the one named `SETUP.md` (`C5`).
- `DOC-SOURCES.json` — the mechanism CORE.md presents as the guard against stale docs — **covers no
  operational document and no domain skill** (`OPS-15`). It is the systemic cause of four separate
  High findings.
- It also compares *dates*, never content. Three documents marked "reviewed today" reference a skill
  and two files that **do not exist** (`DOC-06`).
- CORE.md §0 asserts DDL is sealed; the cutover doc says it was deliberately unsealed; nine CHANGELOG
  entries flag it never re-sealed (`DB-03`/`OPS-19`). **Downstream decisions are justified by that
  sentence** — including the choice to hardcode the deadline hour in three places.
- `supabase/admin/README.md` and `AGENT-DB-ACCESS.md` document the retired `public` model as current,
  and `MACHINE-SETUP.md` sends the operator to them (`OPS-13`).
- **Test coverage has a hole the project already documented and never closed:** the migration-006
  security assertions — student cannot self-unlock, cannot revert status to bypass the lock — have not
  been executing since 2026-07-27 (`TEST-01`). Those are the exact protections C2 concerns.

---

## 5. The headline ask — training a new machine / new user

**Direct answer: a new person on a new machine cannot currently get to a verified lesson-cycle run from
the repo alone.** Not because the system is hard, but because:

1. The accurate runbook is unreachable, and written as a first-person prompt to an AI agent by the
   course director ("I am transferring this file to you securely", "Ask me for the service key") — a
   human has no counterpart to ask.
2. One of the three credential files has **no template**, so it cannot be constructed from the repo.
3. `/setup-preflight` is stale four ways and covers **one of three** credentials — so finishing it
   *feels* like finishing setup.
4. Three documents give three incompatible answers for the textbook path, and the miss is silent.
5. **Nothing states that an AI agent is mandatory.** It is: `/lesson-aggregate` has a driver script but
   the prose is model-authored, and `/preflight-analyze` has no script at all — 837 lines of prose
   asking the model to hand-build PostgREST calls. "Training a new user" is really "training a new
   machine + agent pair," and that is nowhere written down.

### Target state — one document, one skill, one script

**1 · `docs/operations/MACHINE-SETUP.md` becomes the canonical runbook.** Rewritten in third person,
linked from CORE.md §7 and §4, `docs/README.md`, and both agent entry files; registered in
`DOC-SOURCES.json`. Gains a step 0 ("install an agent") and a plain statement of which parts are model
judgement versus deterministic code.

**2 · `.ai/skills/setup-machine/` replaces `setup-preflight`.** Walks the *whole* setup, not one file
of three. Reads MACHINE-SETUP.md rather than restating it, so the two cannot drift. Asks the human for
every secret, never guesses one, refuses to write a placeholder, never echoes a key beyond a 12-char
mask, and ends by running the doctor and printing its output verbatim.

**3 · `scripts/doctor.py` — the piece that doesn't exist and should.** Standard library only, so it
runs *before* the venv exists. Read-only. Non-zero exit on any FAIL. One line per check.

```
python scripts/doctor.py            # full environment report
python scripts/doctor.py --for-run  # the subset /lesson-cycle Step 0 needs
```

| Check | Catches |
|---|---|
| Python ≥ 3.10; `.venv` imports `psycopg2` | wrong interpreter, missing admin tier |
| `.env` present, 9 required keys non-empty | the aggregation half silently unavailable |
| `PREP_DB_HOST` is a **pooler** host | the classic IPv6 timeout, before it costs 30s |
| `~/.claude/skills/preflight-analyze/config.json` parses, 4 keys | the grading half unavailable |
| Service key ≠ anon key | a 401 halfway through a run |
| `GET /rest/v1/courses` with `Accept-Profile: app` | project paused; wrong profile header |
| **`k of N` manifest PDFs resolve** | **RAG silently off — OPS-21** |
| git on `main`, clean tree, no divergence | CORE.md §0 gate items 3 and 4 |
| no `analysis_runs status='running'` < 2h old | advisory concurrency signal — the coordination gate's first real mechanism |
| `check_doc_sources.py` exit code | a derived doc went stale |

It must **refuse** to: connect as `prep_app_owner`, write anything, print a secret, run any part of a
cycle, or "fix" what it finds. And it must work with **no credentials present**, degrading each check
to `SKIP (no credential)` — its most important audience is the person who hasn't got them yet.

That single command turns "did my setup work?" from a judgement call into an exit code, and makes
`/lesson-cycle` Step 0's current claim to check "both credentials" actually true (today it checks one).

**4 · Legacy removal.** Of ~32 non-excluded Python files: **13 live operational**, 6 per-term or
conditional, 5 the test suite, and **8 executed one-time history**. Moving those 8 into
`scripts/_history/` is the cheapest single act that makes `scripts/` legible — the live-to-dead ratio
in the directory listing is currently about 1:1 with nothing distinguishing them. Full disposition
table in `report-onboarding.md`.

**5 · Between terms: `supabase/admin/preflight_grade.py`.** The missing symmetry. `/lesson-aggregate`
has a driver that fetches, summarizes, validates and writes back, leaving only judgement to the model.
`/preflight-analyze` has none, so its skip guards, deadline precedence, zero-non-submitter rule, batch
upsert and read-back verification are all prose the model must re-derive every run. Results vary by
agent and model, and the operator cannot distinguish a correct run from a plausible-looking one.

---

## 6. Phased remediation plan

Sequenced so nothing student-facing changes without a reason, and every phase is independently
shippable. "2-minute swap" = commit, push, Pages rebuild.

### Phase 0 — Verify (today, read-only, zero risk)
Run V1, V7, V9 from §2 at minimum. V1 determines whether Phase 4 needs a ceremony or is already open;
V7 tells you whether grading has been running blind; V9 tells you whether C2 has already been used.

### Phase 1 — Ship this week · no DDL, no downtime, individually reversible

| Item | Finding | Why now |
|---|---|---|
| `REVOKE UPDATE (is_global_admin)` | **C1** | Highest-severity finding, one statement, no unseal |
| Import `pointsFromEffort` in `interaction-submit.html` | **C3** | Wrong number shown to a student |
| `runPage(ctx, init)` on the 4 unguarded pages | FE-03 | Turns forever-spinners into messages |
| `isEffortGraded()` falls back to `grade.effort != null` | DB-01 | Unblocks a whole-section grade save |
| `displayPoints()` keys on `grade.effort`, not `offering.gradingMode` | DB-02 | Student sees a real 0 today if V4 is positive |
| Drop `diagnostic` from student `GRADE_SELECT` | SEC-08 | Ships the AI's honor-concern note to the student's browser |
| Fix the `?next=` backslash open redirect | SEC-12 | One line |
| Size ceiling before decompressing the URL hash | SEC-14 | One check, prevents tab-hang griefing |
| `build_110_preflights.py` reads config for the PDF path | **C8** | Script is broken for everyone but one person |
| Delete `supabase/SETUP.md` | **C5** | It ends in `TRUNCATE students CASCADE` |
| Annotate the retired `by_question` in `director-schema-reference.md` | DOC-02 | Public help doc contradicting CORE.md |
| **Remove `public` from Supabase Exposed schemas** | DB-05 | Dashboard click, reversible; converts a silent wrong-table write into a loud 404 |

> On the last one: `public` and `app` share five central table names, and PostgREST resolves a request
> with no `Accept-Profile` header to `public`. For a *write*, the failure is not an error — it is a
> successful write to the wrong table. Grep `scripts/` for any REST call missing the profile header
> before flipping it.

### Phase 2 — Onboarding (the headline ask) · docs + one new script, no live risk
Commit the `.env` template · link and rewrite MACHINE-SETUP.md · build `scripts/doctor.py` · replace
`setup-preflight` with `setup-machine` · resolve the textbook-path contradiction and make a RAG miss
loud · widen `DOC-SOURCES.json` to cover operational docs and domain skills · fix CORE.md §4's missing
skills, "two config files"→three, and `python.md`'s stdlib overstatement · rewrite
`supabase/admin/README.md` and retire `AGENT-DB-ACCESS.md` · move the 8 one-time scripts to
`scripts/_history/` · declare or remove the `python-docx` dependency (**C9**) · rotate the CHANGELOG at
the term boundary.

### Phase 3 — Correctness hardening · needs a quiet window, not a term break

| Item | Finding | Note |
|---|---|---|
| Day-scope `has_analysis` in the worklist | **C4** | Pair with a manual catch-up over skipped T tracks |
| `must()` error wrapper — `student-data.js` first | FE-02 | Behaviour-changing. Ship the student loader alone, watch one deadline cycle. **Between day tracks, never between an M deadline and its T.** |
| Fix the test-selection bug so migration-006 security assertions run | TEST-01 | These are the protections C2 concerns |
| Offline DST test for the term builders | TEST-02 | The deadline hour moved twice this term with no test |
| `_run_start` before the work, not as an argument to `_run_finish` | OPS-10 | Makes "a row left at `running` is a crash" actually true |
| Vendor the 4 CDN scripts into `site/vendor/`, add SRI | SEC-06 | The DOMPurify sanitizing student input is itself an unpinned remote script |
| `ROSTER_SELECT` constants; convert 10 sites | FE-05 | The existing test asserts a string no page sends |
| Focus trap + `role="dialog"` inside `wireModalDismiss` | FE-08 | One function covers 27 dialogs; federal deployment, Section 508 |

### Phase 4 — One coordinated DDL window · batch everything, then re-seal
Do **not** open separate windows. Under one unseal (or the already-open one, per V1):

- Freeze-after-commit trigger on `submission_activities` — closes **C2**, SEC-04, DB-04 in one guard
- `staff_write` must check `section_id` belongs to `course_offering_id` (SEC-07)
- Narrow `instructors_read` off `USING (true)` (SEC-05 / DB-13) — also blunts the guessable staff password
- Drop `grader` from the `staff_assignments.role` CHECK (DB-07), after V6
- Scope `ge_staff_insert` to the section and constrain `actor` (SEC-10)
- Guard trigger against hard-deleting a student who has grades (DB-08)
- **Then re-seal, and correct CORE.md §0 to state what is actually true.**

Ship a grace window on any deadline enforcement (e.g. `due + 1 hour`) — a timezone or clock-skew bug
here locks students out of their own work.

`SEC-03` (the answer key in a student-readable column) belongs in this phase conceptually but is a
larger change — DDL plus a data migration plus edits to `preflight-analyze` and `lesson_aggregate.py`.
Run V3 first; if `expected_response` is empty in production this drops to Low and can wait.

### Phase 5 — Between terms · the structural work

1. **Extract the pure render functions out of `admin.html`, `report.html`, `lessons.html`** (FE-04).
   **9,293 of 22,238 hand-written JS lines — 42% — live inside HTML files**, unreachable by the 28-file
   test suite, un-importable, and re-downloaded on every navigation. `admin.html` alone is 1,908 inline
   lines against a 463-line module. This is the root cause of C3, the duplicated modals, and the four
   scope vocabularies. It needs **no build step**: move the function, add `export`, add the import. The
   project already made this exact argument to itself in `hold-button.js`'s header.
2. Invert `--dry-run` → `--commit` on the two admin writers (**C7**).
3. Build `preflight_grade.py` (§5 item 5).
4. Delete the ~80 dead CSS rules, then split `styles.css` / `faculty.css` — students currently download
   ~42 KB of render-blocking faculty-only CSS (FE-09, FE-10).
5. Python consolidation: `db_common.py`, `scripts/_supabase_rest.py`, `ensure_utf8_console()`,
   `_preflight_builder_common.py` — removes ~300 duplicated lines and resolves PY-05 through PY-09.

---

## 7. Where the audits disagreed, and how it resolved

Running six independent perspectives produced three genuine cross-checks worth recording:

1. **The effort curve — the audits corrected each other.** The database audit verified all six
   registered copies agree and listed it as a *positive finding*. The frontend audit found a seventh,
   unregistered, diverged. **Both are right**; the frontend result is the more complete one, and the
   combination is what makes C3 a confident Critical rather than a guess.
2. **`aggregate_summarize_test.py`'s hardcoded path.** The Python audit rated it High ("breaks under any
   other invocation style"); the docs/tests audit rated it Low after verifying via `run.mjs`'s actual
   invocation that Python's default `sys.path` fallback still resolves it. **Resolved as Low-Medium** —
   the more specific verification wins; it is misleading dead code, not a live break.
3. **Critical counts.** The database audit reported zero Criticals; security reported two. Not a
   conflict — the security audit examined table-level *grants*, which is where C1 lives, and the
   database audit scoped to schema, constraints and query shape. The gap is exactly why the two lenses
   were separated.

**Corroboration worth trusting:** C2 was found independently by the security audit (SEC-02/SEC-04) and
the database audit (DB-04) from different starting points. C7 was found independently by the Python
and operations audits. Those two carry the highest confidence in this report.

**Standing caveat:** every finding is static analysis against committed source. `PREP-V2-AUTHORIZATION.md`
itself says the policies were "written, not yet applied," and there is **no migration ledger anywhere
in the repo** — the only record of what has actually executed is prose across 8,263 CHANGELOG lines.
Confirm V1/V2 before acting on anything in Phase 4.

---

## 8. What is genuinely good and must not regress

A remediation plan that breaks these would be a net loss.

- **RLS actually backstops the client gates.** `site/faculty/system.html` offers generic CRUD over
  every table, gated in the browser only by a boolean — and that is *fine*, because every write goes
  through the anon-key client and RLS applies unchanged. The page's own comment says "the
  `is_global_admin` check below is a UX boundary." It is correct.
- **Anon gets nothing.** Not one policy in the entire `app` chain grants `anon` anything.
- **Students cannot reach each other's data.** Every per-student table was traced. `grades_own_finalized`
  correctly carries *both* the owner predicate and `is_finalized`, so a draft AI grade is invisible until published.
- **XSS discipline is consistent and complete.** Every Markdown path is
  `DOMPurify.sanitize(marked.parse(...))`, in that order, without exception. Every interpolation of
  DB-sourced text goes through one `esc()`. **No unescaped sink was found.**
- **Secrets have never been committed.** `git log --all --diff-filter=A` over the entire history shows
  only `*.template` files under those names. No JWT-shaped string in any tracked file. All tracked
  student data is synthetic.
- **Migration headers are load-bearing documentation** — each opens with the bug it closes, what changes
  for existing data *with counts verified against live before writing*, and a read-only VERIFY block.
  019 proves a zero-row change rather than asserting it. Migration 006 reproduced two real bypasses as
  a signed-in student before fixing them.
- **`test-imports.mjs` is a linker for a project with no linker** — it walks every module *and every
  inline page module*, extracts, parses, and resolves named imports against real exports. Highest-value
  test in the repo; extend it before adding any other kind.
- **`db-schema.js` is generated from live introspection with a drift test**, which let this audit confirm
  live schema state without connecting to the database.
- **`student-data.js` enforces the release window in exactly one place** and documents why four renderers
  must not each do it. This is the model the faculty side should copy.
- **`zero_non_submitters.py` + its offline test** is the standard the other scripts should be held to.
- **Comments explain the failure, not the code** — with the reported symptom, the mechanism, and the
  date. This is the single reason a 26k-line codebase with no build step is legible, and why roughly a
  dozen apparent smells could be ruled out as deliberate.

---

## 9. Deferred — the artifact library

Excluded by instruction while another agent works on it. Three things need a pass once it settles:

1. **Migration `023` introduces Supabase Storage**, which has its own bucket policies entirely outside
   the RLS model audited here. Nothing in this report covers them.
2. **`_builder/courses/*/artifacts/*.jsx` is gitignored while `BUILD-LOG.md` and `REVIEW-NOTES.json`
   beside it are tracked** — worth confirming those carry no student text.
3. **Four files were touched by both the artifact work and this audit's scope** — `site/js/nav.js`,
   `site/js/util.js`, `site/js/faculty-admin.js`, `site/faculty/admin.html`. Findings against them
   (notably FE-04's `admin.html` inline count) should be re-confirmed against the settled tree rather
   than treated as final.

---

## 10. Addendum — course director's clarifications (2026-08-07, same session)

Recorded because three of these change how a finding should be read, and two answer questions the
audit could only raise. Attributed to Matthew Recker in review of the six reports.

### 10.1 · C2's entry point is direct PostgREST, not the artifact data stream

The audit described the exploit through the `#d=` hash payload. **That is the low-skill path, not the
attack surface.** The real entry point is a student's own authenticated session calling PostgREST
directly — from the devtools console on any signed-in PREP page, where the shared client is already
`window.db`:

```js
await db.from('submission_activities')
        .update({ content: { effort: 5, reading_reflection: { meaningful: true } } })
        .eq('id', myRowId)
await db.from('submissions')
        .update({ status: 'committed', chosen_activity_id: interactiveActivityId })
        .eq('id', mySubmissionId)
```

No artifact, no URL, no hash. Three consequences:

- **`interaction-submit.html`'s guards are not a boundary.** Its refusal of a second report once a
  grade is finalized is application-level; bypassing the page bypasses the check.
- **Migration 015's server-side cap does not help.** It correctly re-derives the reading-reflection
  *cap* from a student-controlled value — and says so in its header — but never re-derives `effort`
  itself, which is what becomes the score.
- **It is repeatable**, because `ON CONFLICT … WHERE source = 'derived'` deliberately allows a
  re-submit to replace a derived grade.

**What still holds:** RLS correctly prevents reaching another student's row (every per-student table
was traced), and `source='instructor'` grades cannot be overwritten. Blast radius is the student's own
grade on interactive assignments.

**This is why the fix must be a database trigger, not a page change.**

### 10.2 · C4 — the merge works; only the *selection* is broken

The director recalled testing that M-day aggregates, T-day aggregates the next day, and the
whole-course scope then updates. **That recollection is correct, and it does not contradict C4** —
they are two different pieces of machinery:

| Path | Component | State |
|---|---|---|
| Explicit lesson + `--day T` | `write-analysis` merge logic | ✅ **Works.** Scopes merge; `__all__` written once every section has one. Both audits called this well built. |
| `worklist --latest` decides what to run | the discovery layer | ❌ **Broken.** `has_analysis` counts rows offering-wide while the design stores one row per offering. |

**Anyone invoking the cycle with an explicit lesson and day has never hit this.** It bites the
unattended/scheduled path — exactly the path a new operator or scheduler would use.

**Still open:** which route `/lesson-cycle` Step 1 takes when *not* handed an explicit lesson. This is
a code-reading finding; nobody executed it.

### 10.3 · V1 answered — `prep_app_owner` is deliberately unsealed

Confirmed by the director: it has stayed open because schema edits are ongoing. Consequences:

- **Phase 4 needs coordination, not a ceremony.** The DDL batch can proceed without an unseal step.
- **CORE.md §0 is factually wrong and load-bearing.** It justifies hardcoding the deadline hour in
  three places *because* DDL is sealed, and agents plan around that sentence. The correct fix is to
  state "deliberately unsealed while the schema settles" — **not** to re-seal.
- **The safety property it claims does not exist.** Nothing structurally prevents two agents running
  concurrent DDL. The cheapest real mechanism is the advisory one already available: `analysis_runs`
  rows stuck at `status='running'`.

### 10.4 · Grounding documents — the standardization problem, stated properly

Each operator has independently placed the grounding corpus in their own local clone, in their own
layout. **Both grading and the artifact builder need the same documents, and they should resolve to
the same place.** The corpus is too large for GitHub (~968 MB, correctly gitignored), so what is
needed is a *truth location* to fetch from plus a *standardized local directory*.

**Already solved — the naming contract.** `textbook-pdfs/rag-manifest.txt` is committed and
`assignments.reference_pdf` stores the per-assignment path in the database. Both consumers already
agree on what a document is *called*.

**Missing — three things:** where the root lives (three docs give three incompatible answers, none
matching the on-disk layout); a truth location a script can verify against; and a shared resolver both
consumers import.

**Ruled out: Supabase Storage.** The free tier caps at 1 GB — the corpus alone would sit at the edge
before artifact sources, plus egress on every grading run.

| Option | Shape | Verdict |
|---|---|---|
| **A — canonical local root, manifest-verified** | Truth stays in Teams/OneDrive. `scripts/grounding/sync_grounding.py` (stdlib, read-only by default) reads the manifest, reports `k of N resolved`, verifies checksums. One config key `grounding_root`, one shared resolver, checked by the doctor. | **Do this now.** Hours of work, no new infrastructure, immediately fixes the silent RAG miss (OPS-21). |
| **B — fetch-on-demand per lesson** | Same manifest; pull only the PDFs a lesson references. Local footprint drops from 968 MB to a working set. | **Later.** Strictly better, but needs stable per-file URLs established first. |

**Open dependency:** `_builder/` was excluded from this audit, so the artifact builder's current
grounding resolution is unexamined. `_builder/courses/phys-310/texts/MURRAY-GROUNDING.md` suggests it
has its own grounding concept. **Read that side before designing the shared resolver.**

### 10.5 · The service key should be removed from the grading path

**Grading does not need `service_role`.** It needs SELECT on submissions/activities and UPSERT on
grades. `service_role` bypasses RLS on every table *and* carries the Auth admin API — create users,
delete users, set passwords.

The exposure compounds: that key lives in `~/.claude/skills/preflight-analyze/config.json` on **every
operator's laptop**, so each machine onboarded is another copy of the most powerful credential in the
project — directly against the goal of easy onboarding.

**The better pattern already exists and grading simply did not adopt it.** `lesson_aggregate.py` uses
`prep_app_dml` — DML-only, no DDL, no auth access. And this converges with OPS-09: the proposed
`preflight_grade.py` driver would naturally live in the `supabase/admin/` tier beside its sibling.
**Building the driver and removing the service key are one piece of work, not two.**

**Verify first:** whether `prep_app_dml` bypasses RLS. It must, to read every student's submissions.
`claude_code_recker` is explicitly `BYPASSRLS`; the `prep_app_*` tier was not confirmed.
`app_tier_check.py` answers this.

### 10.6 · Consolidating the database write paths

Four mechanisms, three credentials, two protocols:

| # | Path | Credential | Used by | Verdict |
|---|---|---|---|---|
| 1 | Browser → PostgREST | anon key + user JWT, **RLS-gated** | the site | **Correct — keep.** RLS genuinely is the gate. |
| 2 | Edge functions → supabase-js | `service_role` | account management | **Correct — keep.** Genuinely needs Auth admin. |
| 3 | `scripts/` → PostgREST via `urllib` | **`service_role`** | term builders, grading | **Consolidation target.** |
| 4 | `supabase/admin/` → Postgres via `psycopg2` | `prep_app_dml` | aggregation, backfill | **Consolidation target.** |

The 3/4 split is historical, not principled. Direct Postgres wins on merit: real transactions
(PostgREST cannot do multi-statement rollback, so a partial write stays partial), least privilege, and
it is already where the most complex tool lives.

The tension is the stdlib-only rule — psycopg2 implies a venv. **But that boundary is already breached
in `scripts/` by an undeclared `python-docx` import in both term builders (C9)**, so it is not holding
regardless. Worth deciding deliberately rather than letting it erode.

**If REST must stay for the stdlib tier:** mint a scoped JWT signed with the project JWT secret
carrying `role: prep_app_dml`. PostgREST honors the role claim, giving REST access at the DML tier
with no service key anywhere — allowing `service_role` to be retired from every path except the edge
functions.
