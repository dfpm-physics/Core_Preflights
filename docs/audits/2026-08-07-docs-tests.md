# PREP — Documentation & Test-Coverage Audit
*Read-only. No DB, no test suite executed. The one exception — `scripts/docs/check_doc_sources.py` — was read in full first to confirm it is read-only.*
*Excluded: `docs/operations/PUBLISH-ARTIFACT.md`, `tests/browser/test-artifacts.html`, `_builder/**`, `scripts/artifacts/**`.*

**Counts:** Critical 0 · High 4 · Medium 6 · Low 3

---

## 1. `check_doc_sources.py` output

Confirmed read-only before running (only `git status --porcelain`, `git log -1 --format=%cI`,
`git rev-parse`; the one writing command, `status --write`, was **not** invoked).

```
$ python scripts/docs/check_doc_sources.py check
All 22 indexed documents are current with their sources.
```

**Interpretation.** A real, clean pass — but its guarantee is narrower than "these documents are
correct." Per its own docstring it compares each source file's **last commit date** against the
document's **`reviewed` date**; it never reads a document's content or verifies a single fact or link
inside it. All 22 registered documents happen to have been reviewed today or later than every listed
source's last touch, so the tool has nothing to flag. **DOC-02 and DOC-06 below are exactly the class
of error this tool is structurally unable to see.** The tool is honest about this in its header, and
correctly excludes `docs/decisions/` and `docs/contracts/` — that exclusion is by design, not a gap.

---

## 2. Stale / contradictory documentation

| Doc | Claim | Reality | Evidence | Severity |
|---|---|---|---|---|
| `docs/app/README.md` (whole `docs/app/*` tree) | `site/app/` is a live directory: "Two small stubs hold the frozen contract URLs open **while the app tree still lives under `site/app/`**"; "**at promotion** the app tree moves up" (future tense) | Promoted up to `site/` and deleted 2026-07-28. A completed past event | `docs/app/README.md:66-74`; `site/app/` absent on disk | High |
| `site/help/director-schema-reference.md:413` | `analysis_reports.kind` accepts `by_question`, `by_objective`, `readiness` — stated as current | `by_question` retired 2026-07-21; only `readiness` is written. A director-tier, public, "must stay current" doc, reviewed 2026-08-04, disagreeing with CORE.md/PROJECT.md on a live schema fact | `:413` vs `CORE.md:311`, `PROJECT.md:234` | Medium |
| `docs/architecture/STUDENT-LESSON-VIEW.md` | No supersession notice; reads "Status: **proposed** — not yet built"; cites `site/student/interactions.html` | Parent `LESSON-UNIFICATION.md` was banner-superseded 2026-07-22; this one never was, and the cited page was deleted 2026-07-28 | `:1-20` vs `LESSON-UNIFICATION.md:1-15` | Medium |
| `docs/README.md` | Taxonomy is `operations/`, `architecture/`, `contracts/`, `decisions/` | Omits `docs/app/` (8 files) and `docs/ROADMAP.md` entirely | `docs/README.md:1-9` | Low |

**Duplicated numbers — all verified consistent.** The 7-day release window, the 2359 deadline hour,
the 2-point written total, and the effort→points curve were checked across `schema.js`, all three
named help docs, `instructor-grading.md`, `director-ai-rules.md`, `PREP-V2-DATA-MODEL.md` and
`ROADMAP.md`. **All agree.** ROADMAP's one older `3+ → 2` mention is explicitly annotated "Superseded
2026-07-30 (migration app/019)" inline — the right way to handle a duplicated fact.
*(Note: the frontend audit separately found a 7th, unregistered copy of the effort curve in
`site/student/interaction-submit.html` that does NOT agree — outside this audit's doc-only scope.)*

---

## 3. Broken path references

Scanned every `.md` under `docs/`, `site/help/`, `.ai/`, plus root `AGENTS.md`/`CLAUDE.md`/`README.md`,
then manually verified candidates (excluding prose slashes like `try/except`, `origin/main`, migration
shorthand `app/019`). **Confirmed genuinely broken:**

- **`docs/operations/PREFILL-LINK.md:123`** — `../../preflight-kit/contracts/INTERACTION-PREFILL-LINK.md`
  is missing `_builder/`; real path is `_builder/preflight-kit/contracts/INTERACTION-PREFILL-LINK.md`.
  The `DOC-SOURCES.json` entry has the correct path; only the in-prose hyperlink is wrong.
- **`.ai/skills/project-bootstrap/SKILL.md`** — referenced by `.ai/patterns/README.md:61`,
  `.ai/patterns/python.md:9`, and twice by `.ai/skills/skill-author/SKILL.md:15,55`. **Does not exist**
  — `.ai/skills/` holds nine skills, none named `project-bootstrap`.
- **`scripts/bootstrap/check_slots.py`** — referenced by `.ai/patterns/README.md:62`. Does not exist.
- **`.ai/skills/docs-author/references/PROSE-STYLE.md`** — referenced by both pattern files. Only
  `HELP-STYLE.md` and `DESIGN-DOC.md` exist there.
- *Lower-priority / expected-historical* (inside dated `docs/app/PLAN-*.md` and `docs/decisions/`
  snapshots, consistent with those docs' own framing): `site/admin.html`,
  `site/interactions-admin.html`, `site/review.html`, `faculty/roster.html`,
  `supabase/functions/reset-password`, and several `site/app/...` references.

---

## 4. Documentation map

| Layer | What it's for | Kept current? |
|---|---|---|
| `CLAUDE.md` / `AGENTS.md` (root) | Thin per-agent wiring into CORE.md | Yes |
| `.ai/instructions/CORE.md` | Operating contract | Yes — actively edited alongside system changes |
| `.ai/instructions/PROJECT.md` | Deep reference | Yes, but **not itself registered** in DOC-SOURCES.json despite being a *source* for nearly everything else |
| `.ai/skills/*/SKILL.md` | Canonical runbooks | Mostly; `skill-author` + `.ai/patterns/*` reference a never-built `project-bootstrap` skill (DOC-06) |
| `docs/operations/` | Outside-the-app procedures | Registered + reviewed; one broken link (DOC-05) |
| `docs/architecture/` | Current model | `PREP-V2-DATA-MODEL.md` current; `LESSON-UNIFICATION.md` correctly superseded; `STUDENT-LESSON-VIEW.md` an unmarked orphan (DOC-04) |
| `docs/decisions/`, `docs/contracts/` | Point-in-time, frozen | Deliberately not required current — verified none misreported as current elsewhere |
| `docs/app/` | Working notebook for the (now-gone) `site/app/` build | **No** — describes a directory that no longer exists (DOC-01), unmarked |
| `docs/ROADMAP.md` | Living work tracker | Yes, unusually well |
| `site/help/` | Public, tier-gated help | Best-governed layer overall; one live drift (DOC-02) |
| `CHANGELOG.md` | Audit trail | See §5 |

**Where authority is duplicated and could diverge, ranked:**
1. **`analysis_reports.kind` valid values** — CORE.md/PROJECT.md say only `readiness`;
   `director-schema-reference.md` still lists a retired value (DOC-02). **The one live, unmanaged divergence found.**
2. `ROLLUP-AGREEMENT.md` vs `PROJECT.md` vs `lesson-aggregate/SKILL.md` payload shape — three
   descriptions, but *managed* (the decisions doc self-annotates "Superseded… the same day"; the two
   current copies agree). Lower risk.
3. Effort curve / 7-day / 2359 numbers — duplicated by design across 5-8 places, all enumerated
   somewhere, all currently consistent. **The right way to duplicate a fact.**
4. `docs/app/PLAN-*.md` describing finished work — none carry a "done, see CHANGELOG" marker.

---

## 5. CHANGELOG assessment + proposed rotation

**Size:** 587,394 bytes · 8,263 lines · **82 dated headers** · 2026-06-11 → 2026-08-07 — entirely
**pre-launch build-out** (Fall term starts 2026-08-10).

**Convention compliance:**
- Newest-first: intact.
- `## YYYY-MM-DD — <Human> via <Agent>`: 74/82 match exactly; the 8 that don't are the 7 earliest
  entries (2026-06-11–06-26, predating the convention) plus one differently-worded ordinal.
- Routine analysis runs belong in `app.analysis_runs`, not here: exactly 3 "Ran —" style entries, all
  dated 2026-07-21/22 — the same days migration 009 went live. **Zero since. Policy is being honored.**
- PII/credentials: targeted search found only synthetic/test cadet IDs (documented as fake by the
  suites themselves) and staff names tied to their own operational actions. No real-student PII or
  credential material found *(targeted, not exhaustive)*.

**The real problem is verbosity, not violation** — ~7 KB of narrative per calendar date, in a file
CORE.md itself says an instructor cannot read.

**Proposed rotation** (split at the term boundary already present in the content):
```
CHANGELOG.md                                 <- fresh, starts 2026-08-10 (Fall term), newest-first
docs/changelog/README.md                     <- index: one line per volume (range, size, scope)
docs/changelog/CHANGELOG-2026-buildout.md    <- git mv of current file, 2026-06-11 -- 2026-08-09
```
- `git mv` to preserve blame. New root file opens with a two-line pointer to the archive.
- Future trigger: next term boundary (~4 months) **or** ~150 KB / 1,500 lines, whichever first; name
  by term (`CHANGELOG-2026-fall.md`).
- Do **not** register archives in `DOC-SOURCES.json` — treat them like `docs/decisions/`.

---

## 6. Test coverage matrix

| Behavior | Risk if broken | Tested? | Where | Needs Node? | Touches live DB? |
|---|---|---|---|---|---|
| Grading math (3-state, 2-point total) | High | Yes | `test-grade.mjs` | Yes | Yes |
| Effort→points curve (migration 019) | High | Yes, 3 layers | `test-schema.mjs`; `grade_interactive_test.py`; `autograde_interactive_test.py`/`app_invariant_test.py` | Node + Python | Python layers yes, always rolled back |
| 7-day release window | Medium | Partial | `test-schema.mjs` §releaseAt/isReleased; `release-window.mjs` (browser) | Yes (+Chrome) | No |
| RLS-scope of the release-window gap (known UI-only rule) | Medium | **No** | — | — | — |
| **Due-date/DST generation (Python builders)** | **High** | **No** | *(only reading side tested)* | — | — |
| Due-date reading (client `effectiveDue`) | High | Yes | `test-schema.mjs`, `test-lesson-due.mjs` | Yes | No |
| Roster import parsing/reconcile | Medium | Yes, extensive | `test-roster-import.mjs` (16 sections) | Yes | No |
| **Roster live provisioning (edge function)** | **High** | **No** | — | — | — |
| **Interaction-submit receiver page** | **High** | **No direct test** | *(only post-commit trigger)* | — | — |
| **Submission lock / choice anti-bypass (migration 006)** | **Security-critical** | **Written, not executing** | `test-student.mjs:150-216` | Yes | Yes |
| RLS policy correctness per role | High | Yes, costly | `app_rls_test.py` | Python | Yes, rolled back, **needs owner unseal** |
| Basic schema isolation | Medium | Yes | `test-isolation.mjs` | Yes | Yes |
| Feedback constraints | Low-Med | Yes, 2 layers | `test-feedback*.mjs`; `app_invariant_test.py` | Both | Both |
| EI sessions | Low-Med | Yes, 2 layers | `test-ei.mjs`; `app_invariant_test.py` | Both | Both |
| Module import/export integrity | Medium | Yes | `test-imports.mjs` | Yes | No |
| Help staleness banner | Low | Yes | `test-help-status.mjs` | Yes | No |
| Nav per role | Low-Med | Yes | `test-nav.mjs` | Yes | No |

---

## 7. Highest-risk untested paths *(ranked — this list drives the refactor safety net)*

1. **Submission-lock / choice anti-bypass assertions silently not running** (`test-student.mjs:150-216`)
   — `docs/ROADMAP.md` itself documents this since 2026-07-27; source unchanged, no fix reported since.
2. **DST-aware due-date generation** — zero coverage of the *writing* side despite CORE.md flagging it
   as historically fragile (the deadline hour changed twice this term).
3. **Interaction-submit receiver page** — no end-to-end test of the frozen artifact↔site contract;
   only the post-commit trigger is tested.
4. **RLS policy tests gated behind a rare unseal ceremony** — well-built but likely run infrequently;
   regressions between unseals go undetected.
5. **Roster provisioning's live write path** — parsing is well tested offline, but the actual
   account-creation edge function has no test, despite being exactly the day-one-of-term failure
   ROADMAP's P0 band organizes around.

---

## 8. Findings

### DOC-01 — `docs/app/` describes a directory tree that no longer exists
**Severity:** High · **Category:** stale-doc · **Location:** `docs/app/README.md:14-27,66-77` (whole tree)
**What/Reality:** Future-tense promotion language for an event completed 2026-07-28. No superseded
banner anywhere in `docs/app/`, unlike `LESSON-UNIFICATION.md`.
**Why it matters:** A developer or agent orienting via `docs/README.md` → `docs/app/README.md` builds
a wrong mental model of where the frontend lives.
**Confidence:** Confirmed · **Fix:** Superseded banner pointing at PROJECT.md's Key Files table and
CORE.md §0. · **Live-system risk:** Low.

### DOC-02 — Help doc lists a retired `analysis_reports.kind` value as current
**Severity:** Medium · **Category:** contradiction · **Location:** `site/help/director-schema-reference.md:413`
**Why it matters:** Director-tier, public, "must stay current" doc contradicting the operating contract
on a live schema fact.
**Confidence:** Confirmed · **Fix:** Annotate as retired, matching the `grader`-retirement pattern two
rows below **in the same file**. · **Live-system risk:** Low.

### DOC-03 — `docs/README.md` omits two real subdirectories · **Low** · `docs/README.md:1-9`
**Fix:** Add `docs/app/` and `docs/ROADMAP.md`.

### DOC-04 — Orphaned design doc, unmarked, references deleted pages
**Severity:** Medium · **Location:** `docs/architecture/STUDENT-LESSON-VIEW.md:1-29`
**Fix:** Add the same banner its parent doc has. · **Live-system risk:** Low.

### DOC-05 — Broken link in a reviewed-today operations runbook
**Severity:** Medium · **Category:** broken-reference · **Location:** `docs/operations/PREFILL-LINK.md:123`
**What/Reality:** The doc calls the target "authoritative over this page" — yet the link 404s.
**Fix:** Add the missing `_builder/` segment.

### DOC-06 — Three documents reference a skill and reference file that don't exist
**Severity:** High · **Category:** broken-reference
**Location:** `.ai/patterns/README.md:61,62,82`; `.ai/patterns/python.md:9`; `.ai/skills/skill-author/SKILL.md:15,55`
**What/Reality:** All reference `project-bootstrap` skill, `scripts/bootstrap/check_slots.py`, and
`docs-author/references/PROSE-STYLE.md` — **none exist**. All three docs "reviewed" 2026-08-07 per
DOC-SOURCES.json, **demonstrating the checker's date-only blind spot.**
**Why it matters:** An agent following `skill-author`'s own "check the roster first" instruction would
look for a nonexistent skill.
**Confidence:** Confirmed · **Fix:** Build the missing pieces or remove all references. · **Risk:** Low.

### TEST-01 — Migration-006 security assertions written but not executing
**Severity:** High · **Category:** test-gap
**Location:** `tests/app-schema/test-student.mjs:150-216`; documented at `docs/ROADMAP.md:549`
**What/Reality:** A test-selection bug since 2026-07-27 means the security assertions (student can't
self-unlock a committed choice; can't revert status to bypass the lock) **never run**. ROADMAP says
they are "asserted nowhere." Source unchanged, no fix reported since.
**Confidence:** Confirmed the gap (code + the project's own admission); could not verify live pass/fail
without running the suite (forbidden).
**Fix:** Fix the selection predicate per ROADMAP's own instruction.
**Live-system risk:** The gap *is* the risk — an exploit would go undetected. *(Directly relevant: the
security audit's SEC-02/SEC-04 and the database audit's DB-04 all concern this exact lock.)*

### TEST-02 — No automated test for DST-aware due-date generation
**Severity:** High · **Category:** test-gap
**Location:** `scripts/fall2026/build_fall_preflights.py`, `build_110_preflights.py`, `set_due_time.py`
**What/Reality:** CORE.md flags this area as fragile; only the read-side re-implementation is tested
(`zero_non_submitters_test.py`), never the zoneinfo/DST generation itself.
**Fix:** Offline Python test against `academic-calendar.json` covering DST-transition weeks and the
documented 4-day M/T gap outliers. · **Live-system risk:** Low to add.

### TEST-03 — Interaction-submit receiver page has no end-to-end test
**Severity:** Medium · **Location:** `site/student/interaction-submit.html`
**Fix:** A browser-harness script lifting real page functions by name, matching `release-window.mjs`'s pattern.

### TEST-04 — RLS policy tests exist but require a rare, coordinated unseal
**Severity:** Medium · **Location:** `supabase/admin/app_rls_test.py`
**Fix:** Schedule it explicitly whenever RLS migrations change.

### TEST-05 — Hardcoded foreign machine path in a test script
**Severity:** Low · **Location:** `supabase/admin/aggregate_summarize_test.py:11`
**What/Reality:** Currently harmless — Python's default `sys.path` fallback still resolves the import
(confirmed via `run.mjs`'s invocation pattern) — but misleading dead code.
**⚠ The Python audit rated this High (PY-04).** This audit's verification is the more specific one;
**Low-Medium** is the resolved rating.
**Fix:** `Path(__file__).resolve().parent`, like its siblings. · **Risk:** None.

### TEST-06 — Four test surfaces exist, not three, and the fourth is undocumented
**Severity:** Medium · **Category:** test-gap / duplication · **Location:** `supabase/admin/*_test.py` (5 files)
**What/Reality:** Beyond the three named harnesses there is a fourth family of direct-Postgres Python
tests — well built, but unmentioned by `AGENT-DB-ACCESS.md` or `tests/index.html` except one narrow invocation.
**Fix:** Name all four surfaces and their prerequisites in one place (`tests/README.md`).

---

## Positive findings

- **`docs/ROADMAP.md` visibly self-corrects in near real time** (struck-through resolved items, dated
  "Superseded" callouts) — a good model for the rest of `docs/`.
- **`DOC-SOURCES.json` + `check_doc_sources.py` is honest about its own limits** and currently clean (22/22).
- **CHANGELOG.md has stopped accumulating routine-run entries** since `app.analysis_runs` went live,
  and no PII or credentials were found in a targeted sweep.
- **The effort curve and release-window numbers are consistent everywhere checked** *within docs*,
  including one place that correctly annotates a preserved historical value as superseded.
- **`tests/app-schema/run.mjs`** is a thoughtfully organized single entry point with inline rationale
  for process isolation.
- **The Python DB-level tests always roll back**, unlike the Node E2E suite, which needs a manual
  `cleanup.py --commit` and says so plainly.
- **`docs-author/SKILL.md`'s help-doc gate is evidently followed**, not just written — only 3 of 8 help
  docs remain honest stubs.
- **`tests/index.html` honestly distinguishes design mockups from automated suites** — no false
  impression found where one was expected.
