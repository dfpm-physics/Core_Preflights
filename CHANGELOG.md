# Changelog

A running log of notable changes to the Core Preflights system. Each entry records
**what** changed, **who** made it, and **why**, so future maintainers (and Claude)
can understand the history without re-deriving it from code or git.

Newest entries first. Dates are `YYYY-MM-DD`.

---

## 2026-08-07 (sixth) — Matthew Recker via Claude

### Audit Phase 0 verified against the live database, then Waves 0–1 of the remediation

The director asked for the audit's verification queries to be run and the Critical findings planned.
All nine ran read-only as `prep_app_read` inside a `READ ONLY` transaction, plus an unauthenticated
REST probe, a filesystem check, and the GitHub API. **Nothing was written to the database.** Then
Waves 0 and 1 of the resulting plan — everything that needs no DDL and no downtime.

**What verification changed.** Three findings shrank, three grew, and one appeared that six static
audits could not see:

- **`prep_app_owner` is NOT sealed** (`rolcanlogin = true`, all four roles, since 2026-07-23).
  CORE.md §0 asserted the opposite; `PREP-V2-CUTOVER.md` had it right all along. Corrected in §0,
  in `MACHINE-SETUP.md`, and in the director-facing help topic — all three now say the seal is open
  and that **the coordination rule does not depend on it**. A rule everyone can see is false stops
  being read as a rule, including the parts that still hold.
- **The legacy `public` schema is exposed to PostgREST with `USING (true)` policies.** With only the
  publishable key from `site/js/config.js` — in a repo confirmed **public** — and no login at all:
  73 rows of `public.students` (cadet ID, name, section) and 64 of `public.responses`. Verified by
  row count only; no data was fetched. `app` is correctly gated: 0 rows for anon on every table.
  **This is a dashboard toggle for the director** (Settings → API → Exposed schemas), verified safe:
  no shipped JS, no edge function, and no script reads `public` over REST.
- **Answer keys are readable by enrolled students.** `expected_response` on q3 is the model physics
  answer, present on 80 assignments, and `activities_student_read` returns the whole `content` JSONB
  over REST. The UI never renders it; PostgREST does. Needs DDL — deferred to Wave 2 with a design
  note, because RLS cannot filter columns and the key is inside a JSONB column.
- **Not exploited, and latent where it looked worse:** zero `submission_activities` mutated after a
  grade finalized (SEC-02 unused), zero `grading_mode='effort'` offerings, zero rows in the DB-01
  broken state, zero `grader` rows, and all 78 effort grades agree with migration 019's curve.

**Wave 0.** Deleted `supabase/SETUP.md`, a pre-v1 guide whose "Semester Reset Checklist" said
`TRUNCATE students CASCADE;` and which is the only file in the repo named `SETUP`.
*`site/js/faculty-report.js` was also deleted and then restored* — its own header and four documents
say it is deliberately dormant pending the rollup merge, one of them in the words "Don't delete it as
dead code." The audit's "dead module" reading was mechanically true and wrong about intent.

**Wave 1.**

- **A seventh copy of the effort→points curve, and the diverged one, is gone.**
  `site/student/interaction-submit.html` still paid the `possible / 2` partial credit that migration
  019 retired on 2026-07-30. It now imports `pointsFromEffort` from `schema.js`. Verified: effort 2
  on a 3-point offering now prints **1**, matching the trigger, where it printed 1.5. phys-310 has
  three published 3-point offerings, two with zero submissions — the next interactive submitter
  would have been shown a score the gradebook does not hold.
- **The Reference PDF dropdown has been broken on the live site since the 2026-07-28 promotion.**
  `lessons.html` fetched the manifest with one `../` too many, left from when the page lived at
  `site/app/faculty/`. On Pages that resolves above the site root and 404s; **locally the extra `../`
  clamps at the server root and works**, which is why no local check ever caught it. Both exits were
  silent, so the dropdown just looked empty. Fixed, both exits now warn, and confirmed in real Chrome
  loading 58 entries.
- **`rag-manifest.txt` regenerated from the live database** — it listed 29 entries, all Physics 215,
  while the live DB used 57, so **every one of the 28 Physics 110 references was missing** and a
  phys-110 author was offered nothing. One entry was two filenames joined by `" + "` and matched no
  file, which is why `preflight-41` grades ungrounded. Now 58 entries, all 58 resolving. *The
  concatenated string is still stored on `preflight-41` and `preflight-41-training` and needs a
  separate dry-run-gated data fix — not done here.*
- **`textbook_base_path` was documented wrongly in the place most people read.** `PROJECT.md` said
  `{repo_root}/textbook-pdfs/{course_id}/`, which resolves **0 of 58** manifest entries;
  `setup-preflight` and `SYSTEM_GUIDE.md` were always correct. New `scripts/grounding/check_grounding.py`
  (stdlib, read-only, exits non-zero) makes it checkable instead of assumed, and is now referenced
  from CORE.md §7, `PROJECT.md`, `SYSTEM_GUIDE.md`, `MACHINE-SETUP.md`, the grading skill, and
  `textbook-pdfs/README.md` with both supported layouts. Reference machine: **58 of 58**.
- **Two undeclared dependencies, one of which no static audit could have found.** The three Fall
  term builders import `python-docx`, which is not stdlib. Fixing the hardcoded
  `/Users/caseypellizzari/…` path in `build_110_preflights.py` made it runnable on Windows for the
  first time — and it failed on `zoneinfo` instead: **stdlib, but it ships no data**, reads the OS tz
  database, and Windows has none. Both now pinned in `requirements.txt`, with the reasoning and the
  generalisable lesson in `docs/decisions/SCRIPTS-DOCX-DEPENDENCY.md`; the two policy statements that
  claimed `scripts/` is uniformly stdlib now name the carve-outs. Both builders also gained a clear
  "source DOCX not found" message in place of a raw traceback.
- **`supabase/admin/.env` finally has a template.** It never had one because `.gitignore`'s `.env*`
  swallowed it, so the file could not be constructed from the repo at all — narrow negations
  (`!*.env.template`) fix that, verified not to un-ignore any real `.env`.
- **`MACHINE-SETUP.md` is reachable.** It is the one accurate machine-setup runbook and a repo-wide
  grep outside the CHANGELOG returned zero references to it. CORE.md §7 now opens by pointing at it.

**Verification.** Read-only DB queries (nothing written); both edited pages extracted and
`node --check`ed, then booted in real Chrome with zero non-auth console errors; `pointsFromEffort`
imported and its outputs compared against the installed trigger definition; the manifest path proved
against the live Pages URL (old → 404, new → 200); both term builders run to their new guard;
`check_grounding.py` run against both the correct and the previously-documented base path;
`check_doc_sources.py` green. No database mutation, no DDL, no schema change.

**Still open from §3 of the audit** — all Wave 2, all needing DDL: privilege escalation via
`instructors.is_global_admin` (C1), students writing their own grade (C2), the answer-key exposure
above, and the day-scoped aggregation worklist (C4). Plus one dashboard toggle only the director can
make, and the `preflight-41` reference string.

---

## 2026-08-07 (fifth) — Matthew Recker via Claude

### A full system audit, recorded under `docs/audits/`

The course director asked for a holistic review of the whole platform — inconsistencies,
inefficiencies, bad programming, bad security — plus a plan to address them without breaking a system
that is live with students. Six read-only specialist reviews ran in parallel (security, database,
frontend, onboarding/operations, Python tooling, docs/tests), each with the in-flight artifact library
carved out of scope, then were cross-refereed into one plan.

**Nothing was changed by the audit.** No repository file was modified, no database connection was
made, and no script was executed — several of them contact live Supabase at import time, so they were
read rather than run. This entry records the knowledge; the fixes are not yet made.

**94 findings** — 9 Critical/Blocker, 24 High, 32 Medium, 30 Low. The three that need attention
regardless of everything else:

- **Any instructor can make themselves system admin with one API call.** `instructors_update_own`
  restricts *which row* may be updated, never *which columns*, and there are no column-level grants
  anywhere in `app`. `is_global_admin` sits on that row. The fix is one
  `REVOKE UPDATE (is_global_admin)` — a grant change, not schema DDL.
- **A student can write their own grade on any interactive assignment.** Not through the artifact —
  through direct PostgREST calls with their own session, which `sa_student_write` (`FOR ALL`, no
  status/deadline predicate) permits. Migration 015's trigger then derives a *finalized* grade from
  the value they wrote. Found independently by the security and database reviews.
- **A seventh copy of the effort→points curve, in `site/student/interaction-submit.html`, still uses
  the rule migration 019 retired** — and prints its result to the student. Invisible at 2 points where
  both formulas give 1; wrong on the 3-point Physics 310 offerings.

That last one is why the audit was run as six perspectives rather than one. The database review
verified all **six registered** copies of the curve agree and recorded it as a positive finding. The
frontend review found the seventh. Both were right. It had survived migration 019's careful inventory
because it was inline in an HTML file, so it did not look like code — which is also the argument for
the largest structural finding: **42% of hand-written JavaScript (9,293 of 22,238 lines) lives inside
HTML files**, unreachable by the 28-file test suite.

**On the director's actual question — training a new machine or user:** today they cannot get from a
fresh clone to a verified lesson-cycle run using the repository alone. `docs/operations/MACHINE-SETUP.md`
is the one accurate runbook and is referenced by nothing; `supabase/admin/.env` has no template so it
cannot be constructed at all; `/setup-preflight` covers one credential of three; and `supabase/SETUP.md`
— the only file literally named SETUP — ends with `TRUNCATE students CASCADE` against production. The
proposed target state is one document, one skill, and one new stdlib-only `scripts/doctor.py` that
turns "did my setup work?" into an exit code and works with no credentials present.

The plan is phased so nothing student-facing moves without a reason: twelve no-DDL swaps first, then
the onboarding work (documentation plus the doctor, no live risk), then correctness hardening in a
quiet window, then **one** coordinated DDL batch rather than six windows, then the structural work
between terms.

**§10 of the master report records the director's clarifications from the review session** — including
that `prep_app_owner` is deliberately unsealed (so `CORE.md` §0 is wrong and load-bearing, and the DDL
batch needs coordination rather than a ceremony), that the aggregation *merge* works and only the
`worklist --latest` *selection* is broken, and the decision to remove `service_role` from the grading
path in favour of the `prep_app_dml` tier that `lesson_aggregate.py` already uses.

Also in this commit: `docs/README.md` gained the three subdirectories it had been omitting
(`audits/`, `app/`, `ROADMAP.md`) — finding DOC-03, fixed in passing because it is the index a reader
would use to find the audit.

Audits are point-in-time records. Like `docs/decisions/` and `docs/contracts/` they are superseded by
the next one, never refreshed in place, and are deliberately **not** registered in
`docs/DOC-SOURCES.json`.

---

## 2026-08-07 (fourth) — Matthew Recker via Claude

### The Artifacts page never loaded: a backtick in a comment, inside a template literal

Reported by the course director as "artifact site is just looping the busy circle and not loading".
It was live — `01650c2` was already on `origin/main`, so the page had been broken on GitHub Pages
for as long as it had existed there. Reproduced in a real browser with a real session, where the
console held exactly one line:

```
UNCAUGHT: SyntaxError: Unexpected identifier 'emph'
```

The cause was an explanatory comment added in the previous entry, written the way this repository
writes about code — with backticks around the identifiers — and placed in an HTML comment *inside a
template literal*:

```js
main.innerHTML = `
  <!-- ... and the block needs `emph` — that is the shape the shared style expects ... -->
```

**A backtick inside a template literal ends it.** Everything after it parsed as expression garbage,
the module failed to parse, and a module that fails to parse never executes a single statement — so
`main` was never touched and the page kept the loading spinner that ships in its static HTML.
Nothing timed out and nothing reported anything, because no code ran to do either.

Both comments in that page moved out of the markup and into `//` comments beside the function.
That is the correct home regardless: prose about code and code that builds markup do not share a
quoting scheme, and a comment inside a template literal ships to the DOM on every render.

### Why nothing caught it, and what now does

**This is the second time.** The 2026-07-25 entry records the identical defect — "a backtick inside
a template literal in `admin.html`" — caught then by a hand-run `node --check` on the extracted
module. That habit shows up in fourteen entries of this file. It is a habit, not a gate, and this
time it was skipped, so the page went to production.

The gap is specific and was total: a `.js` module gets parsed for free the moment
`test-imports.mjs` imports it, but an **inline `<script type="module">` was parsed by nothing** —
not that suite, not `node --check` (which refuses a `.html` file outright), not any unit test. On
most faculty pages that block *is* the page. Its failure mode is the worst available: HTTP 200, a
page that looks like it is loading, and one line in a console nobody has open.

- **`tests/app-schema/test-imports.mjs` gained a parse gate**, running before the two checks that
  were already there — deliberately first, because both are regex over text and a file that does
  not parse still matches regexes perfectly well. (Confirmed: with the defect reintroduced, both
  still reported `[pass]`.) It extracts every `.js` and every inline module in `site/` — 55 sources
  — pads each with the newlines its extract dropped so the reported line number is the line number
  in the real file, and runs `node --check` on it as `.mjs` in a subprocess. The extension forces
  the module parse goal; the subprocess means nothing executes, which matters because several of
  these files touch `document` at import time and others install browser globals the rest of the
  suite depends on. Verified both ways: with the defect back it reports
  `site/faculty/artifacts.html:384 (inline module #1) — SyntaxError: Unexpected identifier 'emph'`,
  and exits non-zero.
- **`tests/browser-harness/pass.mjs` now walks `artifacts.html`**, which it had never been added to
  when the page shipped. Its selector is `.al-list`, not `.page-head` — the whole page is one
  inline module reading a private Storage bucket, so "it painted a heading" would prove almost
  nothing, while the list cannot appear unless the module parsed, the session carried, and the
  bucket policy admitted the account.

### The detail header was using `.lesson-head` without the container it is built for

Reported after the fix above, from a screenshot: the topics badge sat under the title at the left
instead of beside it at the right, and the tinted panel overhung the page on both sides. Two causes,
and the previous entry's `.den` fix had addressed neither — it made the badge render correctly as a
badge, in the wrong place.

- **`.lesson-head` is a block, not a flex row.** The flex row is `.lh-top`, and this page was not
  using it, so no amount of styling could put the badge beside the title — it stacked underneath.
  The header now uses the same `.lh-top` / `.lh-sub` structure report.html uses, with `.grow` on
  the title and flag bar.
- **Its `margin: -24px -24px 24px` is an edge-bleed measured against a 24px-padded container.**
  report.html — the only other user — wraps it in `.report-rollup`, which is exactly that. Here it
  sat straight in `.page-wide`, whose padding is 20px, so the tint overhung the page by 4px on each
  side and pulled its top edge up over the back button. A new `.al-headcard` makes it a standalone
  card instead: no bleed, closed radius, a full border where `.lesson-head` has only
  `border-bottom`.

Verified with twelve geometry assertions in real Chrome against the live stylesheet: the card is
inside the page box on both edges, below the back button, left-aligned with the columns under it;
the badge is on the title's line, to its right, pushed to the header edge. None of this is visible
to a syntax check or a unit test — the page renders either way, only the boxes are wrong.

### Download the .jsx from the Artifacts page

Asked for directly: *"I can fetch the jsx but I need to be able to download it so I can send it to
claude.ai to generate the public artifact."* That is step 2 of
[`PUBLISH-ARTIFACT.md`](docs/operations/PUBLISH-ARTIFACT.md), and the `.jsx` is gitignored, so a
director whose machine never ran `sync_artifacts.py pull` had no copy to attach and no way to get
one from the site.

The Source card now offers **Download .jsx** beside **Read it here** (renamed from "Load the JSX",
which described the mechanism rather than what it gets you). It fetches once and both buttons share
the bytes. The filename comes from the build record and is never re-derived — the slug inside the
file is the artifact's identity (contract §3.2), and this page exists partly to stop that being
retyped. Served as `text/plain`, not `text/jsx`: no browser knows the latter, and an unknown type is
what makes Chrome ask "keep or discard?" on an ordinary download. `PUBLISH-ARTIFACT.md` §1 now
points at it for the no-local-copy case.

`triggerDownload` moved from `faculty-admin.js` to `util.js` to make that possible. Nothing about
Blob-to-download is about course administration, and importing the admin data layer from the
Artifacts page would have coupled two unrelated pages. Its two existing callers are both in
`admin.html` (gradebook CSV, JSON backup) and now import it from `util.js` directly.

**Verification.** The page loads in real Chrome against a real session: 29 rows, no console errors,
no spinner. The detail view passes all twelve header-and-download assertions, including a real
download landing on disk — `phys310_preflight_binding_energy_and_stability.jsx`, 122,847 bytes, the
whole artifact rather than an error page. Full faculty walk 9/9 clean including the new entry.
`run.mjs` 449 passed / 4 failed — the same four pre-existing `test-nav.mjs` "Test views" failures,
unrelated, plus `test-isolation` still throwing at the test cadet's sign-in (both confirmed
pre-existing earlier today). The six list-view layout assertions from the previous entry still pass.
Line endings checked against an untouched sibling — both LF, no rewrite.

**Not fixed, and visible in the same screenshot:** the "Built from" panel renders its values as
literal Markdown — `Murray corpus **§2.7** Binding Energy` with the asterisks showing, and backticks
around `STATUS: PENDING`. The text comes verbatim from `BUILD-LOG.md`, which is Markdown, and the
page escapes it as plain text. There is no inline-Markdown helper anywhere in `site/js/`, so this
wants a small shared one rather than a fourth private regex; left for a decision rather than
invented here.

---

## 2026-08-07 (third) — Matthew Recker via Claude

### `sync_artifacts.py push` could only ever create, never update

Reported by the course director as "all jsx files show as not loaded", with two layout oddities on
the Artifacts page. The reported symptom was the one thing that turned out to be fine: **all 46
sources were already in Storage and download correctly** — verified by signing in as the test
faculty account and pulling one (HTTP 200, 115 KB). "not loaded" was the Source card's initial
label sitting beside its own *Load the JSX* button, i.e. an idle state phrased as a fault. It now
reads "fetched on demand", which is what it means and why: a `.jsx` runs 100–250 KB, so the card
fetches on click rather than on page load.

Underneath it, though, `push` was broken in two ways that between them made every run report
`48 upload(s) FAILED` and look like a permissions problem:

- **`storage_put` could not replace an object.** It POSTed and retried as PUT `if code == 409` —
  but Storage does not answer a duplicate with HTTP 409. It answers **HTTP 400** carrying
  `{"statusCode":"409","error":"Duplicate","code":"KeyAlreadyExists"}` in the *body*, so the retry
  never fired. Every object that already existed failed permanently, which means **updating a
  published artifact's source has never worked** since the import landed. Now a single POST with
  `x-upsert: true`, which also removes the two-call race the retry had.
- **Every `build.json` and `index.json` carried a fresh `generated_at`**, so its sha256 could never
  match and all 48 records reported as `changed` on every run — on a tool whose stated contract is
  "idempotent, skipped when it already matches". Nothing read the field; the manifest's
  `written_at` already records when a push happened. Removed.

`status` disagreed with `push` for a third reason: it printed `len(objects)` under the words "would
be pushed", i.e. the entire payload whether or not any of it differed — "95 object(s) would be
pushed" against a bucket that was byte-identical. Both commands now share one `classify()`, and a
clean tree reports `0 would be pushed (0 new, 0 changed, 95 already identical)`.

**Settled against live Storage:** 48 objects uploaded (the build records, once, to drop the
timestamp), then re-verified — `push` and `status` now both report zero pending. The 46 sources were
never touched, and review sidecars are still never overwritten by a push.

### Two Artifacts-page layout bugs, both box-model

- **The slug was welded to the title** in the lesson list —
  "Energy, Atoms, and Nuclei<code>phys310-atoms-and-nuclei-83022f32</code>" on one line. `.al-ttl`
  and `.al-slug` were inline spans, so the `margin-top` and the ellipsis rules on the slug did
  nothing. Both are block boxes now, in a `.al-cell` with `min-width: 0` so the ellipsis can
  actually engage inside a `minmax(0, 1fr)` grid column.
- **The topic count was orphaned onto its own line** above its own words. `.den` was a *sibling* of
  `.num` on a `flex-direction: column` block; the shared style expects it **nested inside** `.num`
  with `emph` on the block (`.comp-block.emph .num .den`, and report.html's completion badge).
  `tests/browser/test-artifacts.html` — the design fixture — already had it right, so the shipped
  page had drifted from its own reference.

Verified in real Chrome against the shipped stylesheet: six geometry assertions (slug below the
title and left-aligned with it; count and words sharing a line, den to the right and smaller).
Neither bug is visible to a syntax check or to any unit suite — the markup parses and the page
renders; only the boxes are wrong — which is why the check had to be geometric.

### Publishing now says to push

`docs/operations/PUBLISH-ARTIFACT.md` gained a step 5: run `sync_artifacts.py push --commit` before
closing a publish session. The `.jsx` is gitignored, so an artifact that only exists in one working
copy has a Source card that can never open on any other machine. Both bugs above are recorded there
too, so their symptoms read as a regression rather than as normal.

Files: `scripts/artifacts/sync_artifacts.py`, `site/faculty/artifacts.html`,
`docs/operations/PUBLISH-ARTIFACT.md`. The four pre-existing `test-nav.mjs` failures are unchanged
and unrelated.

---

## 2026-08-07 (second) — Matthew Recker via Claude

### Publishing full credit clears a reading-reflection cap it had already overruled

Found by the course director while reading the Physics 310 Lesson 01 rollup: a cadet was flagged
**Reflection capped** and simultaneously held **3 of 3 points**. Both were correct, which is the
problem.

The reading-reflection gate is a **ceiling** — `/preflight-analyze` applies `effort = min(effort, 2)`
when the reflection is not a genuine attempt. On the **interactive** path that costs real points: the
trigger chain turns effort into points, so 2 pays one point instead of the assignment's full value.
On the **written** path it costs nothing at all, because points come from `question_scores`, where a
`warn` is full credit by deliberate design (`preflight-analyze` SKILL.md rule 5). Same student
behaviour, same shared question, two different grades depending only on which path they picked — and
a rollup pill asserting a penalty the gradebook never applied.

**Finalize & publish now settles it.** When an instructor publishes full credit on every question
carrying points, `diagnostic.effort` of **1 or 2 is raised to 3**. Deliberately narrow:

- **1 as well as 2**, because the gate is a ceiling and not a fixed value — thin answers everywhere
  *plus* a failed reflection lands on 1, and one act of publishing confirms both. **0 is left
  alone**: no substantive participation anywhere is not something full credit can retroactively
  assert.
- **Never lowers, never exceeds 3** — an instructor confirming full credit says "at least enough",
  not "exemplary".
- **On finalize, not on a draft save.** Publishing is the deliberate, student-visible act; a draft
  save is not a decision.
- **The AI's reading survives.** `reading_reflection.meaningful` is untouched and
  `effort_override {from, to, by, at, rule}` records who overrode its consequence. Nothing rewrites
  the judgement, so "how often do faculty and the AI disagree on this gate" stays answerable.

**The pill had to move too, and this is the part that was actually broken.** All three render sites
keyed on `reading_reflection.meaningful`, never on effort — so raising the effort alone would have
changed nothing on screen while silently moving the cohort effort mean. The predicate now reads the
resolved effort, which is what its own label ("effort was capped at 2") always claimed:
`report.html`'s flag pill and per-student tag, and `faculty-rollup.js`'s `reflection.capped` count,
which was `assessed - meaningful` and therefore kept reporting a cap a human had lifted.

Applied as targeted updates **after** the upsert rather than as a `diagnostic` key on every row: a
PostgREST bulk upsert requires identical keys across the array, so folding it into `gradeRows()`
would have meant rewriting `diagnostic` for every student in scope and racing any concurrent
`/preflight-analyze` write. Best-effort — failing to raise an effort must never cost the grades that
were just published.

Files: `site/js/faculty-grade.js` (`confirmEffortRows`, exported for test; `diagnostic` carried on
`gradeMap`), `site/js/faculty-rollup.js`, `site/faculty/report.html`,
`site/help/instructor-grading.md`. **19 new tests** — 13 in `tests/app-schema/test-grade.mjs`
pinning each boundary, 6 in `test-rollup.mjs` pinning the count. Verified additionally by replaying
the real live row that prompted this.

**Verification is Node-only (CORE.md §2).** The full offline suite passes and the logic was replayed
against the live diagnostic, but the actual click-path — Finalize & publish writing the amended
`diagnostic`, and the pill clearing on the rollup — has **not** been exercised in a browser. Four
pre-existing `test-nav.mjs` failures ("Test views" dropdown) are unrelated and present on a clean
tree.

*Not fixed here, and it is the larger question:* the meaningful-gate still only bites on the
interactive path. Two students writing the same throwaway reflection are graded two points apart on
a 3-point lesson purely by modality. Closing that means either giving the written path a real gate —
which breaks "yellow always earns full credit" — or accepting it is interactive-only and saying so.
That is course policy, and it is the director's call.

---

## 2026-08-07 — Matthew Recker via Claude

### The artifact builder comes into PREP; artifact sources go to Supabase Storage

PREP consumes Claude artifacts and a separate private repository —
`ranador/Socratic-Artifact-Builder` — produced them. That split was costing real things. The
`preflight-kit` was **extracted from this project** on 2026-07-30, so two of its seven hash-locked
files are copies of PREP's own `docs/contracts/`, and they had already drifted. **46 published
artifacts** had their slugs and live URLs recorded only in two `BUILD-LOG.md` files this repo could
not read. Reviewing an objective needed a clone and a terminal, and registering one meant
transcribing a slug between two repositories — a failure that has already corrupted one published
artifact's identity.

**The `.jsx` does not enter git.** 46 artifacts come to ~8 MB; committing them would put that in
every clone's history permanently. They live in a new **private** Storage bucket,
`artifact-sources`, added by migration `023` (applied 2026-08-07, with a `_ROLLBACK.sql` in the same
commit). `_builder/courses/*/artifacts/*.jsx` is gitignored and is a local cache that
`scripts/artifacts/sync_artifacts.py pull` populates. The source is not secret — claude.ai shows an
artifact's code behind a Code button — so the reason is history size. **The build records are a
different matter**, and are why the bucket is private: they carry grounding page numbers (CORE.md §6
— never surfaced to a cadet), the tutor system prompt, misconception taxonomies and worked extension
problems.

**The tree is `_builder/`, and the underscore is access control rather than style.** GitHub Pages
serves this repo with default Jekyll, which excludes `_`-prefixed paths. Verified live:
`…/docs/contracts/INTERACTION-PREFILL-LINK.md` serves the real document, `…/_archive/…` returns 404.
So `docs/`, `scripts/`, `supabase/` and `tests/` are **already public** — and a top-level `builder/`
would have published every build log and the 132 KB tutor prompt to the open web. CORE.md §2 now
records that adding a `.nojekyll` would switch that off for `_archive/` too.

**New: `site/faculty/artifacts.html`** — browse every built artifact and what went into it, review
its objectives with accept/reject and notes, and register it by pasting the published URL. Linked
from the **user menu**, not the nav bar: nav.js already argues that the bar cannot keep paying for
another entry, and this is a reference surface rather than a place teaching happens. Read is gated
on `app.is_staff()`, writing a review on being a director — both by storage policy, not by the UI.

**The instruction layers were merged rather than chosen between.** `check_doc_sources.py` now runs
the builder's engine with PREP's `status --write` ported onto it; the merged index went 12 → 22
entries, two of which register the kit's frozen contract copies against `docs/contracts/` so their
drift becomes an alarm instead of a silence. `safe-change`, `skill-author` and `integration-package`
joined the skill tree; `project-bootstrap` and `check_slots.py` deliberately did not, because they
install the scaffold into a *new* project.

**Five defects were found by verification, not by review:**

- **`storage.buckets` has RLS on with zero policies**, so a PRIVATE bucket's row is invisible and
  every download fails as `NoSuchBucket`. Making a bucket private is not a one-line change from the
  migration-019 pattern. Note the error is ambiguous — **a wrong request path produces it too**, and
  chasing the wrong one cost a round trip here.
- **Listing a non-existent bucket returns `200 []`, not a 404**, so "list it and see" reports a
  missing bucket as an empty one. `sync_artifacts.py` now probes `GET /bucket/<id>` explicitly.
- **`loadReviews` caught every error and returned the empty shape**, so a failed read became
  `revision: 0`, the save's confirmation compared against that, and a write that had *landed* was
  reported to the reviewer as lost.
- **Storage stamps uploads with `max-age=3600`**, so the two objects this page writes could be
  served an hour stale. They are fetched through a signed URL with `cache: no-store`.
- **`docs/DOC-SOURCES.json` had an entry using `why` where the schema says `note`** — its rationale
  had been silently ignored by the old, lenient checker.

**Corrected a stale record inherited from the builder:** its docs said no artifact was registered.
In fact **phys-215 is 29/29 registered and phys-310 is 1/17**. The library page surfaced that on
first load.

**Reversal.** Four independent levers, all drilled dry-run before anything was deleted:
`sync_artifacts.py purge` (deletes only the 97 paths in its own upload manifest, never a prefix
sweep), `023_..._ROLLBACK.sql`, `git revert`, and the physical copies in
`_snapshots/builder-import-2026-08-07/`. `scripts/artifacts/restore_point.py verify` compares live
git, Storage and file hashes against the state recorded before any of this ran.

**`_inbox/` is deleted.** Every file in it was verified present in at least two other places first.
The Socratic-Artifact-Builder working tree is **untouched** and should be archived, not deleted.

**Verification actually run:** the kit's 22 checks from a fresh clone (the only thing that catches
line-ending corruption); `check_artifact.py` 46/46; a byte-identical Storage round trip against the
snapshot; anon refused on both object routes while a director reads, writes and deletes;
`DOC-STATUS.json` regenerating with only its date/commit stamp changed; and a signed-in browser pass
over dashboard, assignments, gradebook and artifacts with no page errors and no sideways overflow at
1440 or 420. **Not verified:** the read-only path for a non-director staff account, because no such
test account exists — the storage policy is written and was not exercised from a browser.

---

## 2026-08-06 (second) — Casey via Claude

### A roster import's course/term mismatch is now a decision, not a verdict

The Fall 2026 Physics 215 registrar export arrived as two blocks: 311 rows numbered `215`, then a
trailing 57 numbered **`215S`**. `rowMatchesCourse()` compared catalog numbers for exact equality,
so all 57 cadets were reported "215S — not this course" and dropped, with no way to take them short
of editing the export by hand. **The filter was right to notice and wrong to decide.**

**What replaced it.** Subject, Course Number and Term are now compared **independently**, and each
disagreement becomes a **flag on the offending VALUE** (`course_number=215s`) rather than a verdict
on the row. The preview lists the distinct claims with row counts and a tick box each; ticking one
and pressing **Re-check with the ticked rows included** re-parses the same file with that approval.

- **An approval is per claim, spent per row.** Approving `215S` admits every row whose *only*
  disagreement is that. A row that also names `Spring 2027` stays out and says so — which is the
  property that makes a blanket "import anyway" button unnecessary, and unsafe to add.
- **An override lets a row be considered, not admitted.** It is re-parsed, not patched, so an
  included row faces the identical cadet-ID, email, section and duplicate checks. The 215S row with
  no email address moves from "not this course" to "missing email", which is the useful answer.
- **Silence is not disagreement, in either direction.** A blank cell, a missing column, an offering
  with no term, or a term string that cannot be parsed (`1271`) produces **no flag** rather than a
  false one. Every file that imported cleanly before still does. A term gate that cried wolf on
  correct files would train the operator to tick without reading, defeating the mechanism.
- **Departures stay honest.** An excluded row still does not shield its cadet from the removal
  proposal — a cadet in the export only under another course is not in this one. Approving the
  claim is what changes that, and it changes it the honest way: the row is staged, so it protects
  like any other.
- **Overrides are recorded.** `roster_imports.notes` gains a sentence naming what was approved and
  how many cadets came in that way. The export is not kept, so it is the only later evidence.
- **Two dead ends closed:** a file where *every* row is flagged used to parse to zero rows and hit
  an error box whose only button was Close — precisely the file the control exists for; and a
  re-parse now carries the operator's conflict resolutions and un-ticked departures forward instead
  of discarding decisions already made further down the page.

`class_nbr` and `course_title` are deliberately not gated: a class number differs per section by
design, and a course title restates subject + number under a second name. Nothing in the gated
columns is stored about a cadet — `commitRoster()` writes name, email, squadron, sex, majors and
advisor — which is what makes overriding them safe at all.

**Touched:** `site/js/roster-import.js` (`IDENTITY_FIELDS`, `identityFlags()`, `termKey()`,
`parseRosterFile({termCode, approved})` → `identityGroups`/`overridden`; `rowMatchesCourse()` kept
as the yes/no over the flags), `site/faculty/admin.html` (the override card, carry-forward,
audit note), `site/js/faculty-roster.js` (`meta.overrides` → notes),
`tests/app-schema/test-roster-import.mjs` (+31 assertions), `site/help/instructor-accounts.md`
(new "When the file says another course or term"), `SYSTEM_GUIDE.md`, `DOC-SOURCES.json`.

**Verification note (CORE.md §2):** proven by the Node suite — `node test-roster-import.mjs`, 156
assertions, 0 failures — plus `node --check` on both modules and on admin.html's extracted module
script. **The new preview card itself was not exercised in a browser this session**; the parse layer
under it is covered, the rendering and the two re-parse buttons are not.

## 2026-08-06 — Casey via Claude

### Both courses now use a 2359 preflight deadline (215 moved back from 1759)

Physics 215's directors had set the preflight deadline to **1759** on 2026-07-29; it is now **2359**
(`23:59:59` America/Denver), matching Physics 110. Both courses wanted the same "right before
midnight" deadline, so the two have converged and the per-course override is gone. This reverses the
2026-07-29 decision by design, at the course director's request.

**Live DB retimed** — the fall-2026 Physics 215 offering moved 1759 → 2359 across all three storage
locations (629 `assignment_due_dates` section rows, 37 `assignment_offerings.due_at`, 74
`due_by_day` jsonb entries). The Physics 215 **training** offering was deliberately left at 1759.
While in there, Physics 110 was normalized to a single instant: 36 `assignment_offerings.due_at`
rows sat at `23:59:00` (from the builder's `23, 59`) against `23:59:59` everywhere else, so a section
falling back to the offering deadline got `:00`; all now `23:59:59`. Read-back verified: 110 and 215
fall-2026 uniformly `23:59:59`, training untouched.

- **Retime tooling:** the change was run through a stdlib-REST equivalent of
  `scripts/fall2026/set_due_time.py` (same three-location, DST-aware, keep-local-date logic),
  because the `prep_app_*` DB credentials the canonical psycopg2 script needs were not on the
  operating machine. Dry-run-first, idempotent, read-back-verified. **Not committed** — the canonical
  script remains the tool of record; this was a stopgap for a credential-less machine.
- **Code kept in step so the DB change does not revert** (the deadline hour is hardcoded in the three
  places CORE.md §2 enumerates): `DUE_TIME_BY_COURSE` in `site/faculty/lessons.html` is now `{}` (both
  courses take the `23:59` fallback); `DUE_TIME` in `build_fall_preflights.py` is `(23, 59, 59)`; the
  110 builder's `due_utc` writes `23, 59, 59` (not `23, 59`) so a rebuild keeps the normalized instant.
- **Docs updated:** CORE.md §2 (the policy narrative), `SYSTEM_GUIDE.md`, and the student and
  instructor help pages that quoted "1759 for Physics 215"; `DOC-SOURCES.json` note + reviewed dates.

**Verification note:** the DB retime is verified by REST read-back. The `lessons.html` default is a
JS constant change not exercised in a browser this session; it only affects the time box for a *new*
assignment, since an existing deadline reloads its saved value.

## 2026-08-04 — Matthew Recker via Claude

### An interaction-only lesson offered the free response it had just taken away

Reported from the sandbox: the test student could see the written preflight as an option on a lesson
the director had set to **Interaction only**. Three of the four role combinations rendered correctly;
this one had no branch anywhere on the student side.

**The offering was never wrong.** `roleFor()` writes interaction-only as *interactive graded,
written practice*, and `shapeOffering()` derives `isChoice` correctly from it (one graded activity →
not a choice). The student lesson page simply asked a different question
(`site/student/lessons.html`):

```js
const isChoice = l.interactiveGraded;   // true for a CHOICE and for INTERACTION-ONLY alike
```

That predicate cannot separate "both paths count" from "only the interactive counts", so the lesson
rendered as a free choice: heading *"Choose how to complete this assignment"*, the claim that
*"Both are worth the same 2 points"*, and a live **Start writing** button for a path worth nothing.

**Four surfaces, one root cause.** Fixing the derivation fixed all of them:

- **The lesson page** offered the written path on an interaction-only lesson.
- **My written preflights** (`site/student/assignments.html`) filtered on `a.written` — the
  *presence* of a written activity, not whether it can score — so the same lesson appeared as an
  ordinary item with a full question set and a live Submit button.
- **The lesson list and the dashboard** labelled it *"3 questions"*. Both `modeLabel()` functions
  were written against a three-way `completion_policy`, but the loader only ever supplied
  `'choice'` or `'preflight'`, so the `'interaction'` arm had always been dead code.
- **A committed choice came unstuck.** The written card was hidden on `STATE.COMPLETE`, which an
  interactive commit does not reach: migration 015 finalizes the grade on commit, so `resolveState`
  returns `GRADED` first. The guard therefore fired only when the interaction *failed* to grade
  (no `#d=` payload) and not when it succeeded — a student who had submitted their report was shown
  their written answers again under an **Edit your answers** button.

**Nothing was ever miscredited.** `submissions_check_gradable` and `submissions_lock_activity` held
the line in every case. That was the other half of the problem: the refusals reached the student as
raw PostgreSQL, e.g. *"submission 7f3a… is locked to interactive by switch_policy=lock_on_commit"*,
after they had written and submitted three answers.

**What changed.** `policyOf()` moved from `faculty-lessons.js` to `schema.js` (re-exported, so the
editor is untouched) because the label the director writes and the label the student pages read back
must be one function. Two new derivations live beside it: `isGradedPath()` and
`writtenPathCounts()`, which owns the whole "may the questions be offered at all" rule — the pages
now read a field instead of re-deriving it, the same reason `interactiveAvailable` is computed in
the loader. `commitSubmission()` gained the preconditions `submitInteractionReport()` always had, so
a refusal is a sentence rather than a trigger exception; it also writes `is_final` *after* the
commit lands instead of before, which previously left the flag set on a commit that was rejected.

**The two practice arrangements are deliberately asymmetric**, now stated in
`director-course-structure.md`: a practice *interactive* stays visible beside the graded questions
(somewhere to go after submitting, costing nothing), while practice *questions* are hidden while the
interactive is the graded path. A visible question set that cannot score reads as work, and anyone
who did it would be turned away at the point of submitting. They reappear the moment a director
flips the two settings, which is what keeps the documented mid-term fallback safe.

**Verification — read this before trusting it.** Node-only, and *not* a substitute for looking
(CORE.md §2). 148 assertions in `tests/app-schema/test-schema.mjs` pass, 15 of them new and aimed at
this bug (all four role combinations through `policyOf`, and every state of `writtenPathCounts`
including the two that regressed). `test-imports.mjs` resolves all 375 named imports across `site/`,
and both edited inline module scripts pass `node --check`.

**Not verified: the rendering itself, in a browser, signed in.** The live suites cannot run — the
test cadet `3009999999` in `tests/app-schema/harness.mjs` now fails sign-in with *Invalid login
credentials*, which is the failure mode that file's own README warns about after a password reset.
Until that account is restored, `test-student.mjs`, `test-rest.mjs`, `test-isolation.mjs` and the
`browser-harness` walkthrough are all unrunnable by anyone. Worth fixing on its own account.

### Preflights unlock 7 days before they are due, because working ahead defeats the instrument

The director's problem: a cadet could work fifteen preflights in an afternoon and then arrive at
each of those lessons having forgotten the topic. A preflight is only worth asking for if it is
done in the run-up to the lesson that discusses it, so publishing the whole term at once quietly
broke the thing the assignment exists to do.

**Publishing an assignment no longer means students can see it.** A published offering now appears
**7 days before that student's own deadline** and stays visible from then on.

The rule collapses to one predicate — *hide anything whose deadline is more than 7 days away* —
which is why the director's original phrasing ("due within 7 days plus completed") did not need a
second clause: overdue, submitted and graded work is not in the future, so it stays visible for
free. That includes the case the phrasing did not cover — a missed assignment nobody submitted,
which the cadet still needs in order to find their zero and their feedback.

**One filter, at the one choke point.** `loadAssignmentStatuses` (`site/js/student-data.js`) is the
single loader the dashboard, the lesson list, the written-preflight list and the artifact receiver
all project over. Filtering there rather than in four renderers is not tidiness: a renderer that
was forgotten is how a cadet ends up with a working deep link to a lesson three weeks out.

Details that are load-bearing rather than incidental:

- **Measured from the scheduled deadline, never an extended one.** `effectiveDue` is called a
  second time with the extension deliberately omitted. Measuring from the extension would mean
  that granting a cadet more time pushes the assignment out of the window and takes it off their
  page — the exact opposite of what an extension is for.
- **Work already started is never withdrawn.** A row with a submission or a grade is exempt.
  Otherwise a director pushing a deadline back a fortnight would retract a submitted assignment
  and its released grade with no explanation.
- **Release instants are floored to the start of their day**, and the browser harness is what
  caught this. Deadlines are 2359, so plain subtraction opened a lesson at 2359 seven days
  earlier — absent for the whole of the day it was supposed to appear, delivering six days against
  a note promising seven. `releaseAt` and the editor's `daysBeforeDue` both floor.
- **An undated assignment is always visible.** It has no window to be outside of, and hiding it
  would hide it for the whole term.

**The dormant `opens_at` column is now load-bearing.** It has existed since `001_core_model.sql`,
`shapeOffering` has always read it, and `isOpen()` was computed on every student item and read by
**nothing**. It is now the per-lesson override, in both directions — release a review packet three
weeks early, or hold one back longer than the default. NULL is the *default answer*, not a missing
one: it selects the rolling window, which is what lets M-day and T-day sections unlock on different
days from a single setting and lets a moved deadline move the release with it.

**A "Students can see it" control** in the assignment editor writes it: the standard rolling
option, presets for 3 and 14 days and "as soon as it's published", and a specific date. The presets
are shortcuts that *resolve into the date box* rather than stored modes, because a `timestamptz`
cannot hold "N days before" and there is nowhere to put a relative offset (DDL on `app` is sealed —
CORE.md §0). Showing the instant each preset resolved to is the honest version of that, and it is
what makes the real difference legible: the standard option follows a deadline edited later, a
fixed date does not. Relative presets count back from the **earliest** per-day deadline, matching
`defaultDueFrom()` — counting from the latest would give M-day sections less run-up than the
control promises them. A preset chosen before any due date is set refuses and says why, rather than
inventing a date off today's clock.

**Students are told, not left to guess.** Lessons are numbered, so a list that stops at 11 with no
explanation reads as an outage and produces an instructor email. Every student surface now carries
the count and the rule, and the start-of-term case — nothing scheduled versus nothing *open* yet —
says which one it is instead of "No assignments yet". The dashboard no longer says "All caught up.
Nice work." to a cadet whose next four preflights simply have not opened.

**The artifact receiver gets a third hard stop.** `interaction-submit.html` loads with
`includeLocked` and refuses an unreleased submission. This is the one stop unreachable from inside
the site, which is exactly why it is needed: the artifact lives on claude.ai and its URL is
shareable, so a cadet handed next month's link by a classmate arrives having never seen the lesson
listed — and an interactive grade is auto-final, with no instructor review to catch it. Without
`includeLocked` the item resolved to `null`, which reads as "no deadline, no grade" and waved the
submission through.

**What this is not.** It is a UI rule, not a security boundary — the same standing as
`isActivityAvailable`. `ao_read_student` still returns every published offering, so the REST API
will hand a determined cadet a future preflight. Closing that means adding the predicate to the RLS
policy, which is DDL on `app` and needs the §0 unseal; it is written up as the follow-up rather
than done quietly. The rule targets pacing of ordinary use, which is the actual problem.

One side effect worth naming: the dashboard's points denominator is now "out of what has been
released to you" rather than "out of the whole term". 4/6 in week two says something a cadet can
act on; 4/82 does not.

**Verification.** 401 checks pass in `tests/app-schema` (up from 380 — 21 new, covering the
window, the boundary, the flooring, the override in both directions, and an unparseable `opens_at`
falling back rather than swallowing the default). A new `tests/browser-harness/release-window.mjs`
drives real Chrome: every edited page parses and loads clean, and the editor's release control is
exercised against its own lifted markup — 24 checks, and it is what found the 2359 defect. **Not
verified signed-in**: `supabase/admin/.env` on this machine carries no `PREP_TEST_FACULTY_*`, so
the director walkthrough of the new control and a cadet's view of a partly-released term have not
been looked at by a human (CORE.md §2 — a Node-only check is never the sole verification).

Files: `site/js/schema.js` (the rule, `LOOKAHEAD_DAYS`, `releaseAt`/`isReleased`/`releaseNote`),
`site/js/student-data.js`, `site/js/student-lessons.js`, `site/js/faculty-lessons.js`
(`openAtFrom`, the `opens_at` write), `site/faculty/lessons.html`, `site/student/lessons.html`,
`site/student/dashboard.html`, `site/student/assignments.html`,
`site/student/interaction-submit.html`, `.ai/instructions/CORE.md` §2, three help docs +
`docs/DOC-SOURCES.json`. No migration: the column already existed. No DDL, no build step.

---

## 2026-08-01 (third) — Matthew Recker via Claude

### Six calendar formats, not two, and a switcher between them

The director asked to see the calendar in genuinely different shapes rather than restyled ones.
The sandbox now offers **six formats over one set of data**, and the point of the switcher is that
the choice is a judgment nobody can make from a description — each format makes one question cheap
and the others expensive:

| | answers | costs |
|---|---|---|
| **Month** | what does this week look like | truncates titles to ~11 characters |
| **Term** | what is the shape of the whole term | denser, still truncating |
| **Timeline** | how far apart are a lesson's two deadlines | needs horizontal room |
| **Agenda** | what is coming, in full | one date at a time, no shape |
| **Pulse** | how is the term going | no text at all |
| **Ledger** | which weeks will pull the two tracks apart | no sense of calendar time |

**Timeline** is the one the data argued for. Two lanes on a single real-time axis, with each
lesson's M mark joined to its T mark by an SVG **diagonal whose slope is the gap** — near-vertical
for a one-day turnaround, a long lean for four days, and the nine wider-than-a-day pairs drawn
heavier. A flat rule between the lanes said only "these are related", which the lanes already said.

**Agenda** exists because every grid here truncates; it is the format that never does, and the
suite asserts that (`scrollWidth <= clientWidth` on every title). **Pulse** is the
contribution-graph shape — 147 squares, weekday down and week across, hue for track and fill for
submission. Its ramp is stretched over **50–100%**, not 0–100%, because submission on a graded
preflight never lands in the bottom half and a raw scale rendered every square identical; the
tooltip always reports the true figure. **Ledger** puts both dates on one row with the **spread**
as a sortable column, which is the fastest way to find the weeks where a director has to think
about the two halves of the cohort separately.

**A real bug, found by adding formats.** Lesson 1's M-day preflight is due the evening **before**
the first class — 5 Aug, a date outside the term by the academy's own dates — and three of the six
formats silently dropped it: the agenda began its walk at the term start, the pulse treated the day
as out of range, and the timeline gave it a negative offset and pushed it off the left edge. The
month and term grids happened to include it because their week padding reached back that far, which
is why nothing had caught it. All six now start from `FIRST_DRAWN`. The rail also stopped labelling
that date "Outside the term" over the top of a live deadline.

Two smaller fixes: re-centring now fires only on a **format change**, not on every render — clicking
a timeline mark was dragging the view out from under the click that caused it; and `aria-selected`
has exactly one writer (`render()`), so the tabs cannot disagree with the viewport.

**Verified:** a second browser suite, **62 assertions**, covering every format — each renders,
names itself, offers selectable dates, shows the month pager only where paging means anything, and
drives the one shared rail; plus format-specific substance: the timeline's 41 connectors reproduce
the real `{1:32, 2:1, 3:6, 4:2}` gap spread in their horizontal runs and are diagonals rather than
rules; the agenda truncates nothing and lists all 82 deadlines; the pulse partitions exactly the
evenings the agenda lists (a cross-format consistency check — a square is a *day*, not a deadline);
the ledger's spread column reports the real gaps and sorts widest-first. No format overflows at
430px. The original 46-assertion suite and `tests/app-schema` (**380 passed, 0 failed**) are
unchanged and green.

**Still Node-only verification** (CORE.md §2) — nobody has opened these signed in.

---

## 2026-08-01 (second) — Matthew Recker via Claude

### The academy calendar is ground truth, and it is now in the repo

The course-calendar mockup shipped this morning generated its own M/T day sequence — weekdays
alternating, minus a hand-typed holiday list. The director supplied the real thing: the published
**USAFA Academic Calendar** feed. Every part of the guess turns out to be wrong, and the errors are
not cosmetic.

**`scripts/calendar/build_academic_calendar.py` → `site/data/academic-calendar.json`.** Stdlib
Python, dry-run by default, `--commit` to write, idempotent (re-running against the live feed
reports "already current"). It parses the .ics — RFC 5545 line unfolding and all — and emits four
terms: fall-2025, spring-2026, fall-2026, spring-2027.

**The calendar names each teaching day `M<n>` / `T<n>` — the track AND the lesson number.** So
`preflight-14` maps to the day the academy calls `M14`, and nothing has to count. That single fact
is why this is a lookup rather than a derivation.

**Why it cannot be derived, in the numbers.** Real Fall 2026 runs **6 Aug – 10 Dec** with **41**
lesson slots — the mockup had guessed 12 Aug – 11 Dec and 40. The gap between a lesson's M-day and
its T-day is 1 day 32 times, 2 days once, **3 days six times and 4 days twice**. The weekday spread
is uneven (18 Tuesdays, 15 Fridays). And Fall 2025 has **no M7 at all**, because that day was
cancelled — the feed says so in as many words ("M7 Canceled - USAFA Down Day"), and the extractor
records it rather than silently renumbering. Any rule reproducing that is a rule somebody has to
maintain against a calendar published elsewhere.

That variable gap is also the calendar view's whole argument. A lesson's two deadlines being
*sometimes adjacent and sometimes most of a week apart* is precisely what an ordered list cannot
say — and the synthetic version, having a fixed rhythm, was quietly making the argument look
smaller than it is.

**SOC days are flagged**, as the director asked. "SSoC" in local speech appears in the feed as
`Modified SOC - …`, usually "Afternoon Sections Start 1 Hour Early"; Fall 2026 has seven, including
a one-off for a change of command. The variants are kept verbatim rather than normalised, because
they differ in *how* modified (one Spring day moves only P5 and P6, by 90 minutes). **It changes
when class MEETS and never moves a preflight deadline**, which is set the evening before — so it is
a flag on the day and never a mark on a deadline. The file also carries days off, breaks, finals,
study day and grades-due, classified coarsely; training series (BCT, Silver Training Weekend, the
summer periods) are kept but marked `other`, because what is worth drawing is the view's decision,
not the extractor's.

**The mockup now reads the file** instead of inventing anything, which also means it exercises the
wiring a real page would use: a static JSON under `site/`, fetched with no build step. It is under
`site/` for a concrete reason — the source is an Outlook publish URL on another origin, so a browser
fetching it directly is refused by CORS, and there is no server to proxy through.

**Recorded in `CORE.md` §2**, because this is exactly the class of fact that must not live only in
an agent's memory: where the ground truth is, how to regenerate it, and the numbers above as the
reason not to reconstruct it. `SYSTEM_GUIDE.md`'s "Step 2 — Update the due dates" gained the same
pointer, where it was a real gap: that step tells a director to put a date on every lesson and never
said where the dates come from.

**One bug found and fixed by the new data.** A single-day milestone falling inside a multi-day break
was suppressed entirely — Final Grades Due (21 Dec) sits inside Winter Break (17 Dec – 3 Jan), and
since a spanning note only writes its label on its first day, the 21st rendered blank. A note that
*starts* on a date now outranks one merely passing through. The synthetic holiday list had no
overlapping events, so nothing could have surfaced this before.

**Verified:** the browser suite grew to **46 assertions**, the load-bearing one being that all **82**
Fall 2026 teaching days match `academic-calendar.json` date for date on both track and SOC flag,
with nothing badged as a teaching day the file does not list. Plus: all 7 SOC days flagged and no
others; term bounds, finals and grades-due highlighted while days off stay quiet; a date carrying
two notes shows the specific one (11 Sep is both "Commandant's Training Day" and "No Classes"); a
teaching day with no preflight still badged (215 declares 40 lessons against 41 slots, so slot 41 is
that case); no console or page errors; no horizontal overflow at 430px. `tests/app-schema` **380
passed, 0 failed**. Nine derived documents were re-read against the CORE.md change and review-bumped;
`SYSTEM_GUIDE.md` was edited rather than bumped.

**Still Node-only verification** (CORE.md §2) — the sandbox has not been opened by a signed-in human.

---

## 2026-08-01 — Matthew Recker via Claude

### A course calendar, as a mockup — and the test views reachable from the app

Two things, both about seeing. Nothing shipped to students, no schema change, no data touched.

**`tests/browser/test-calendar.html` — the term as a calendar rather than an ordered list.**
`faculty/lessons.html` lists a term's offerings in order, which says what comes next but cannot say
*when*. The specific thing it cannot show is the one this exists for: **a lesson has two deadlines,
not one.** M-day and T-day sections meet on different dates and each track's preflight is due the
evening before *its own* class, so on a list those two dates are a detail inside a row and on a
calendar they are two marks days apart. Every deadline here is drawn per track, and the day track
is the only thing colour is spent on — modality (`✎` written · `⚛` interactive · `⇄` choice) is a
glyph, so the two never compete.

Month view and a whole-term view, a rail that opens the selected day, and the cases that are easy
to forget existed: **per-section overrides drawn on their own dates** (an `assignment_due_dates`
row is the cancelled-class case, and those cadets really do have a different date), the unpublished
tail **dashed** because a director authoring a term should see its shape, holidays that shift the
whole M/T pattern after them, term milestones, and completion on what is already past. Switching
course in the sandbox strip moves the deadline hour — **215 is 1759, 110 is 2359** (CORE.md §2),
which is the sort of policy that is invisible on a list and obvious on a calendar.

The header comment maps every mark to the field that would feed it, so this is reviewable as a
design proposal rather than a picture. Two deliberate omissions are recorded there: `app.extensions`
is per *student*, so a course calendar drawing them would show one cadet's date to a section; and
the M/T day sequence is **derived from the deadlines**, not from a new academic-day table —
`due_by_day` × `sections.meeting_days` already implies it, and inventing a table is not a mockup's
call. Synthetic and clock-independent (a pinned "today" of 2026-10-06, so the page opens mid-term
with real past and future rather than whatever the machine's date makes of it).

**"Test views" in the user dropdown, for global admins.** `tests/index.html` had no route from the
app — you had to know the URL. It sits beside **System** under the same `is_global_admin` gate, and
it is the **first entry in either nav list whose href leaves the app** (`../../tests/index.html`,
which resolves identically locally and on Pages), so it opens in a new tab and is labelled `↗`.
It is not on the bar for the same reason System is not: the bar states where the work of running a
course happens, and these are sandboxes touching no live data. The sandboxes keep their own director
gate (`tests/browser/guard.js`) — the dropdown entry is discoverability, not the boundary.

`ic-beaker.png` is registered in `ICONS.md` as **⬜ needed**; until the art lands the entry shows the
standard fallback, which is the documented way round.

**Verified in real Chrome** (puppeteer, `tests/browser-harness` deps), since a calendar that parses
is not a calendar that is right: 33 assertions on the sandbox — every visible deadline lands the
evening before its own lesson's class (the one exception being an override, which is what an
override *is*), all four term milestones present and highlighted while holidays stay quiet, class
days with no lesson still badged, both views, both themes, both courses, the track and unpublished
filters, no console/page errors of the page's own, and no horizontal overflow at 430px. Nine more
render the **live** `nav.js` with a stubbed ctx: an admin gets the entry with `target=_blank` and
`rel=noopener`, a director and a student do not, and the href is resolved from `site/faculty/` and
then actually fetched (200, the tests landing page). `tests/app-schema` is **380 passed, 0 failed** —
`test-nav.mjs` gained the dropdown's new shape plus a check that an out-of-app href resolves to a
real file, which the existing "points at a page that exists" check could not do. *(The two suites
that need the live test-student account still throw on invalid credentials, unchanged and unrelated.)*
`check_doc_sources.py` flagged `instructor-grading.md` because `nav.js` is one of its sources; no
route to the Grade page moved, so its `reviewed` date is bumped, not its text.

**Node-only verification** for the browser half, per CORE.md §2 — the sandbox has not been opened by
a signed-in human, and the dropdown entry has not been clicked on the live site.

---

## 2026-07-30 (fifth) — Matthew Recker via Claude

### Partial credit on the effort curve is one point, not half the assignment

Migration **`app/019_effort_partial_credit_flat.sql` APPLIED** to live `app` as `prep_app_owner`
(already unsealed by the director from the 014 change; **it is still unsealed — re-seal with
`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres`**). No other DDL ran.

The curve has said "half credit" since migration 013, when there was nothing to scale: every
interaction was worth 2 points and half of 2 is 1. `app` made a lesson's value per-offering data
and carried the rule forward as `points_possible / 2` — the same number at 2 points, and a
different *kind* of number anywhere else. **Physics 310 is the first course worth anything else.**
Its two lessons are 3 points, so a partially-engaged interactive taker scored **1.50** — a value no
written taker on the same lesson can produce (0 + 1 + 2 give integer totals only), so a Choice
assignment would have held two incompatible grids in one gradebook column.

```
effort 0     -> 0
effort 1-2   -> LEAST(1, points_possible)      <- was round(points_possible / 2, 2)
effort 3-5   -> points_possible
```

**Full credit scales with the assignment; partial credit is a flat acknowledgement that the student
engaged.** The `LEAST` is not decoration: the Points box accepts any value (`min="0" step="0.1"`),
and on a sub-1-point assignment a bare `1` would pay *full* credit for partial effort, or breach
`grades_within_bounds` and reject the write outright. Verified live at 0.5 points — it clamps.

**Nothing stored moved.** 213 grade rows exist; 78 carry an effort and every one is on a
`points_possible = 2.00` offering, where old and new agree exactly. Captured before and after: rows
disagreeing with the live trigger, **0 → 0**. The only offerings worth anything else are the two
phys-310 lessons, and neither has a graded interactive activity yet. No backfill, nothing to
reconcile.

**Six copies of this curve must agree**, and all six moved in this commit — the trigger is
authoritative (it overwrites `points_earned` on write) and the other five only render it, so a
divergence shows a student one score while the gradebook stores another:
`grades_points_from_effort()` · `pointsFromEffort()` (schema.js) · `pointsForEffort()`
(faculty-rollup.js) · `points_from_effort()` (interaction_reports.py) · `_points_for_effort()`
(lesson_aggregate.py). `grade_interactive.py` imports the fourth rather than adding a seventh.

**Verified:** end-to-end against the live trigger inside a rolled-back transaction, driving every
effort 0–5 at `points_possible` 3.00 / 2.00 / 1.00 / 0.50 and reading `points_earned` back —
`grade_interactive_test.py` 55/55, `autograde_interactive_test.py` 13/13, `test-schema.mjs` 112/112,
and the full `tests/app-schema` suite green. *(One pre-existing failure in
`aggregate_summarize_test.py` — "a cross-TERM match may be a stale offering, and says so" —
reproduces without these changes and is untouched.)*

**Two tests were agreeing with both rules, therefore testing neither.**
`autograde_interactive_test.py` asserted `points_earned == points_possible / 2` against a 2-point
fixture, and would have stayed green through this change; it now asserts through the shared curve.
`grade_interactive_test.py`'s only scaling check was "effort 2 on a 10-point assignment -> 5", the
one case the new rule deliberately changes. Both suites now pin 3-point, 10-point, 1-point and
half-point assignments explicitly.

### Docs

`CORE.md` §6 carried `0–5 → 0/1/2`, which was the *whole* rule only while every assignment was worth
2. It now states the curve, names the six copies, and flags that
`docs/contracts/INTERACTION-DATA-CONTRACT.md` §5.2 still describes the retired `public` 0–2 score —
frozen record, not a live description. Same correction in `interaction-backfill/SKILL.md`,
`PREP-V2-DATA-MODEL.md`, and superseding notes on the two ROADMAP tables that recorded the curve as
built (both said "matches the policy exactly at `points_possible = 2`", which was the caveat coming
due). Three help pages said "earns half": `director-ai-rules.md`, `director-schema-reference.md`,
`instructor-grading.md`. Migration 019 registered in `DOC-SOURCES.json`; the ten documents it flags
were re-read and their `reviewed` dates bumped.

---

## 2026-07-30 (fourth) — Matthew Recker via Claude

Two follow-ups from the director on the entry below, both of which say the same thing about it:
**the fix was right and the sweep was incomplete.** Frontend only; no DDL, no live data written.

### The modal fix reached sixteen of twenty dialogs, not "all thirteen"

*"The modal disappears still. If I click and start to highlight and drag past the edge of the modal
when I let go the modal goes away."*

The entry below counted thirteen dialogs. There are **twenty**, and four still had the naive
`e.target === backdrop` check — including **the lesson editor**, which is the dialog the director
was in and the one where the loss is a whole authored question set. The other three were the
Assignments preview, its destination chooser, and the System page's confirmation.

All twenty now go through `wireModalDismiss()`, and three things changed in the helper itself:

- **Both ends are recorded literally** (`mousedown` *and* `mouseup`), where before only the start
  was. `click` fires on the common ancestor, so a gesture with *either* end inside the dialog
  arrives with the backdrop as its target; tracking only the start left the mirror-image gesture —
  press on the backdrop, release inside — reading as a dismissal.
- **Escape answers one dialog, the top one.** Every wired backdrop listens on `document`, so with
  two open a single keypress reached both handlers and closed the stack. `topmostOpenModal()` ranks
  the open backdrops by z-index (document order breaking the tie) and only that one closes. This
  became reachable *because* of this change: the preview opens over the editor.
- **The lesson editor asks before discarding.** It now tracks whether anything in the form was
  touched and confirms on any dismissal that would throw work away — the same guard the per-student
  grading modal already had, on the dialog that holds the most work of anything on the site.

**Two tests, because "I fixed it" was wrong once already.**
`tests/browser-harness/modal.mjs` drives the real `wireModalDismiss` with a real mouse in Edge — 10
checks, including the exact reported gesture (select text in a textarea, release far outside).
Verified it *fails* under the old rule before keeping it: 4 of the 10 go red.
`tests/app-schema/test-modals.mjs` enumerates every `.modal-backdrop` in `site/` and fails if one
does not reach the shared helper — which is the check that would have caught this the first time,
since a missed dialog is not a broken dialog and nothing else can see it.

### An assignment with no AI Interaction advertised one

*"Lesson 01 for 310 shows AI interaction green on assignment view, but there is no AI
interaction."* Two causes, both introduced by making the URL optional in the entry below.

**The editor was creating interactions nobody asked for.** A new lesson defaulted to
`interactive.include = true`. That was harmless only while the URL was mandatory — the save
*refused* until the director dealt with the interaction, so one could not be created by accident.
Once the URL became optional that stop was gone, and because both activity sections open
**collapsed** and the interaction slug auto-mirrors the assignment id, authoring a written-only
lesson silently attached an empty interactive activity the director never saw. A new assignment now
starts **written-only**; including the interaction is one click on an always-visible control, and it
expands the section.

**The card called an empty activity a working one.** The badge was `!!l.interactive` — the activity
row exists — so it showed a green ✓ beside a disabled *Launch interaction* button, which reads as
the button being broken rather than the lesson being unfinished. Three states now: absent, amber
**AI Interaction · no URL**, green.

**The student side had the same hole**, and worse: `window.open(artifact_url || '#')` opened a
second copy of the page in a new tab. An interaction with no usable URL is now never *available* —
the card greys with *Available once your instructor adds the lesson link* — and the launcher
refuses outright as a backstop.

One predicate decides all of it: `isArtifactLaunchable()` in schema.js, `http(s)` specifically, so
it is also what keeps a `javascript:` URL out of an `href`. 9 checks in `test-schema.mjs`.

**To clear the one already created:** open Lesson 01 in the editor, set **AI Interaction** to *Not
this term*, and save. That detaches the empty activity and the badge goes with it.

### The editor has now actually been opened

Every defect in this entry and the one below was reported by the director, not caught here, and the
common thread is that the logic was unit-tested and the **page had never been walked**.
`tests/browser-harness/lesson-editor.mjs` signs in as the test faculty account and does it: 22
checks over the real Assignments page and the real editor — that no card shows a green AI
Interaction it cannot launch, that a new assignment opens written-only with both pinned questions
distinct, that a drag-select ending on the backdrop keeps the form, that Escape on a dirty form
asks first, and that the URL label flips between optional and required with the mode. **Read-only:
it opens the editor and cancels; it never saves, publishes or deletes**, because the account is a
live director on the live database.

It found one thing on the first run — in itself, not in the site. An interaction-only lesson labels
its *mode* "AI Interaction" too, so matching the badge by its words picked the mode badge, which
carries no state class and passed every assertion vacuously. Matched on the ✓/—/⚠ prefix now, with
a check that the count of badges equals the count of cards.

Not covered by it: no assignment visible to the test account is in the amber state, so that badge
is proven by `test-schema.mjs` and by reading, not by observation.

---

## 2026-07-30 (third) — Matthew Recker via Claude

Four defects found by the director while standing up **Physics 310** — the first course authored
in this system from nothing, which is why they surfaced together. Frontend only; no DDL, no live
data written.

### Modals threw away work when a text selection ended outside them

Select text in a modal, drag past its edge, release: `mouseup` lands on the backdrop, the browser
fires `click` on the nearest common ancestor — the backdrop — and the dialog closed. Every one of
the **thirteen** dialogs in PREP did this, and highlighting a sentence of feedback to replace it is
the most ordinary thing to do in the grading modal, so it fired constantly and always mid-edit.

`wireModalDismiss()` (util.js) now requires **both ends of the gesture** to be on the backdrop: a
dismissal is a click that starts *and* finishes on the overlay, and anything that starts inside the
dialog is part of working in it however far the mouse then travels. All thirteen call sites use it;
`[data-close]` and Escape still close unconditionally, and the per-student grading modal routes it
through its unsaved-changes confirm.

### The interaction URL was required even when nothing could open the interaction

*"It required me to enter an interactive url even if I chose free response only… I may want it
later in the term."* Correct, and the workaround — setting the interaction to **Not this term** —
is a different decision with a different meaning.

The URL is now required only when the allowed mode is **Choice** or **AI Interaction**, i.e. when a
student can actually reach it. Under **Free-Response** the interaction is attached as practice and
nothing offers it, so it may sit URL-less until the artifact exists; the field says which case it
is in, and the Assignments card already renders a URL-less interaction as a disabled Launch with
the reason.

### The reading reflection was being authored as the reading-time question

*"The reading reflection does not appear to be showing up properly. It's showing up in Q1 even
though Q1 is supposed to be a question about time spent reading."* Reproduced exactly, and the
cause is one line of ordering.

On a **new** lesson `ensureDefaultQuestions()` created the reflection first, `nextQid()` gave it
`q1`, and the reading-time lookup then matched that same question through its positional fallback
(`PINNED_FALLBACK.reading_time === 'q1'`) and **overwrote its role**. One question, reflection
text, reading-time role. Existing lessons were unaffected — they already had three questions — so
this only ever bit somebody authoring from scratch, which until Physics 310 nobody had done.

**The repair is not the ordering, it is the resolution rule.** Both roles now resolve against the
list *as it is*, by **signal strength across both roles rather than role by role**: every declared
role first, then every prompt-text match, then positions for whatever is still unresolved, with one
question able to answer for only one role. Resolving one role completely before starting the other
is what let a *weak* signal for the first claim a question a *strong* signal for the second was
about to match.

### Flagging the two special questions, and toggling them off

*"We need a way to flag a reading time question (which has special rules) and a reading reflection
question and then everything else is treated as a free response. I would like the ability to toggle
these two on or off… if I toggle one or both off then I think our rollup will get confused because
we did things by question number."*

Both toggles are in the editor above the question list, both default on. Turning one off **never
destroys authored text**: the standard prompt is removed outright, a rewritten one keeps its words
and becomes an ordinary question, and the notice says which happened.

**The director's prediction about the rollup was right, and it needed three changes to stop it:**

- **Once a question list declares any role, roles are the whole answer.** The prompt-text and
  positional lookups are a bridge for content authored before roles existed (0 of 74 live written
  activities carried one on 2026-07-21). Applied to content that *has* roles they invent the
  question the director just removed — with reading-time off, the reflection sits at `q1` and `q1`
  is reading-time's positional fallback, so the rollup would have drawn a reading-time panel out of
  reflection prose. Implemented in **both** engines: `pinnedQuestion()` (schema.js) and
  `_pinned_question_id()` (lesson_aggregate.py), which must agree or the aggregator's prose cites
  students the browser's panel never shows.
- **Ordinary questions are stamped `role: 'free_response'`.** Without this, a lesson with *both*
  pinned questions off carries no role at all, reads as legacy content, and gets guessed at — on
  the one lesson that has most clearly said no to both.
- **The positional lookup refuses a question whose own prompt says it is the other role.** The
  two resolvers answer one role per call and cannot see the conflict the editor's can, so they
  check the other needle instead.

The role rules moved out of `lessons.html` into `faculty-lessons.js` (`resolvePinnedQuestions`,
`pinnedPresence`, `adoptPinnedRoles`, `stampRoles`, `roleRank`) — the bug lived in logic no test
could import, and the extraction immediately paid: **the first run of the new tests failed**, on
the legacy path, which the original fix had not covered.

### Hold-to-delete never worked, and now has a browser test

*"The hold down for 5 seconds to delete an assignment doesn't work."* Reproduced in Edge: holding
perfectly still completes correctly, and moving the cursor **one pixel off the button** fires
`mouseleave` and silently cancels. Over five seconds on a ~130px target, drifting off it is what a
hand does — so the control was unusable in practice while being provably correct in principle.

Rewritten on `setPointerCapture` in **`site/js/hold-button.js`**: once the gesture starts the
button owns the pointer until release, so where the cursor wanders is not a decision the control
has to make. Cancellation is now exactly release, OS pointer-cancel, and Escape. The label counts
down, because a bar that fills is ambiguous when the hold can silently restart.

**`tests/browser-harness/hold.mjs`** drives it with a real mouse — 7 checks, the load-bearing one
being *hold while drifting well off the button and still complete*, which is the only one that was
ever false. It inlines the real module rather than a copy, so it exercises the shipped code. This
is the class of bug nothing else in the repo can see: it parsed, logged no error, rendered fine,
and every unit suite stayed green.

### Verification

`tests/app-schema` all green (test-rollup **221**, test-lesson-due **48**, and the rest unchanged
at 0 failed); `hold.mjs` 7/7 in Edge; `aggregate_summarize_test.py` green apart from **one
pre-existing failure** (`a cross-TERM match may be a stale offering` — a message-wording assertion,
verified identical without these changes). Every edited page's inline module passes `node --check`.

**Not verified:** the lesson editor's new toggles have not been walked in a browser — the pure
logic under them is covered by the 14 new checks in `test-lesson-due.mjs`, but the wiring, the
notice and the URL hint have only been read.

---

## 2026-07-30 (second) — Matthew Recker via Claude

Eight director requests, worked as one batch. Frontend only except the last, which changes what
`/preflight-analyze` writes. **No DDL, no live data touched by this change** — the zero-grade
backfill script is written and tested but has not been run.

### The nav bar gives up two entries, and both land somewhere specific

**System moved into the user dropdown**, beside Account and Help, still gated on
`is_global_admin`. The bar states where the work of running a *course* happens; `system.html`
administers the things courses are made **of** — offerings, terms, people, raw tables — and is the
one destination the course picker beside it does not apply to. Feedback stays on the bar despite
carrying the same gate, because it is the opposite kind of thing: a queue that accumulates work.
The dropdown's contents are now `USER_MENU_LINKS` + `userMenuLinks(ctx)`, exported and pure for the
same reason `FACULTY_LINKS` is — who sees which destination has been quietly wrong before.

**Extensions became the third tab of Course Admin** — Students · Staff · Extensions · Export. It
was its own page and its own nav entry from 2026-07-22, on the argument that a recurring review
should not be buried in an administrative page. That argument was about being *found*, and a tab on
the page a director already opens for staffing is found. The panel moved verbatim; the data layer
(`courseExtensions`, `revokeExtension`, `reinstateExtension`) did not move at all and still lives
beside the grant path in `faculty-grade.js`.

`faculty/extensions.html` is now a **redirect** into `admin.html?tab=extensions`, not a deletion —
it was a linked destination for eight days and is the kind of URL a director bookmarks. (The two
roster pages of 2026-07-23 were deleted outright; those had been reachable for hours.) `?tab=` is
read once at load and is what makes the redirect possible.

`test-nav.mjs` asserts both moves, and pairs each "not on the bar" check with one that it still has
a home — asserting only the absence would pass just as well if the destination had been dropped.

### Assignments and the rollup

**A Rollup button on every assignment card** (`lessons.html`), beside Grade. The lesson rollup was
reachable only from the dashboard's carousel, which shows one assignment at a time — so getting to
last week's readiness summary meant paging a carousel backwards to find a lesson you were already
looking at on this list. Disabled with a reason on a draft: nobody can submit to an unpublished
assignment, so the page would render honestly as an empty rollup, which reads as a broken report.

**Fixed while building it:** `faculty-tasks.js`'s "Run rollups" box linked
`report.html?i=<assignment slug>`. `?i=` is the assignment **offering id** — `report.html` resolves
it against `loadManager()`'s keys and silently `location.replace`s to the dashboard on a miss — so
that box was a button that bounced you back to the page you clicked it on.

### The rollup's response panel became two

**"Student responses" is now "Student Reading Reflections"**, and a second panel, **"Student Free
Responses"**, sits beside it. The old heading claimed everything a student wrote and delivered one
question's worth: it only ever showed Q2 reflections, so an instructor looking for what the class
said about the actual physics found a panel that appeared to be it and was not.

- The free-response panel carries **no AI picks**, by construction rather than by finding none.
  `analysis.selected_quotes` resolves through the reflection text and will until the aggregator
  learns to pick from a second field — **the lesson cycle is deliberately untouched by this
  change**. Every card there is a random sample and the sub-heading says so.
- It renders **only when the cohort produced free responses**, so an interactive-only assignment
  gets no empty panel.
- **The Q3 prompt and its figure are printed above it**, capped at 200px tall. The reflection panel
  gets no prompt block: that question is the same fixed sentence all term, where the free-response
  question is different every lesson and is genuinely unrecallable three days later. The figure is
  capped because several preflight figures are near-full-width diagrams that would push every
  student response below the fold.

New in `schema.js`: **`freeResponseQuestion(activity)`**, which finds Q3 by *elimination* — the two
pinned questions have fixed prompts to match on, this one is the lesson's own physics and has no
needle. 12 checks in `test-rollup.mjs`, including the six lab preflights whose Q1/Q2 wording makes
the pinned pair fall back to position.

### Several instructors at once

The Add staff modal took one existing person per pass, which meant re-choosing the role on every
pass — and that is how one of five colleagues quietly becomes a director. The picker is now
multi-select and shown **open** rather than hidden behind a search (two dozen colleagues is a list
you read; typing filters it). `addExistingStaffMany()` writes the batch in **one upsert**, not a
loop: N round trips can half-succeed, leaving "3 of 5 added" and no way to retry only the two.
Deduplicated, because Postgres rejects an upsert whose rows collide on the conflict target.

### Grading: a change you can see before you save it

Three connected repairs to `grade.html`, all from the same beta complaint.

**Re-scoring an answer no longer makes it vanish.** The status lamps filtered on the *live* status,
so turning a red into a green while "no credit" was the only lit lamp removed the card you were
reading — taking with it the evidence for a decision you had not yet saved. `buildGradeData()` now
records **`original`**, the status at load, and the filter (and the lamp counts) run off that. It
re-settles on the next load, which is when the reader's chosen set is genuinely stale.

**The chip became a pair.** Once an edit moves it, the control renders `was → will be`: the
original greyed and inert, an arrow, and the pending value, which stays clickable and keeps
cycling. Cycling back to the original collapses it to one chip.

**A sticky banner counts unsaved changes**, because the two buttons that write are at the bottom of
a twenty-card page. It names the count, links to both actions, and is joined by a `beforeunload`
guard and a confirm on any picker or queue click that would discard the work.

The 3-state control moved into **`site/js/grade-controls.js`** — because student.html grades now
too, and a course policy (full/warn/zero, yellow means full credit flagged) maintained in two
copies becomes two policies by the end of term. Every **write** still goes through
`faculty-grade.js`, so however many screens grow controls there is one place a grade is written
from.

### Grade one submission without leaving the cadet

`faculty/student.html` grows a **Grade** button per assignment row, opening a modal with everything
the Grade page has for one student: the 3-state toggles with the same pending-change pair, feedback
boxes, Reopen, and grant/edit/remove extension. Same writes, same guards — including the
interactive-taker exclusion, which on this page matters for the same reason it does on the other
one (a save built from an empty model would write zeros over an effort grade).

It exists *as well as* the Grade page, not instead of it. That page is a production line — one
assignment, a whole section. This one is the only screen that asks "what is going on with THIS
cadet", and the thing you most often want to do having found an answer here is fix the grade you
are looking at.

### Non-submitters get a real zero, not a blank

**Director's rule:** "Blank at time of submission without an extension should result in a 0 for
score and a 0 for understanding. Granting an extension should allow this to be overwritten when
resubmitted."

**The diagnosis is that the gradebook was right and the data was missing.** `/preflight-analyze`
wrote a `grades` row only for students who submitted and merely *listed* the missing ones in its
run report — so a non-submitter had **no grade row at all**, which is a different claim from
"scored zero" and the wrong one. Their total was already being built as though the zero existed
(`totalsFor` counts a past-due non-submission as 0 out of full), but no number anywhere said so.
Compounding it, the gradebook only prints a hard `0` once at least one **finalized** grade exists
in that section for that column (`gradedScopes`), and every row the AI writes is
`is_finalized=false` — so the dashes survived grading and did not resolve until a human published.

**The skill now writes the zero** (SKILL.md § "Then: the students who submitted nothing get a
zero"): five conditions, all required — active enrollment, past its **own** effective deadline
(extension → per-section → per-day → offering), **no active extension**, no written content and no
interactive commit, and not already carrying a finalized or instructor-sourced grade. A draft with
real content is *not* zeroed; that student is graded on what they wrote, which Step 5 already said.

Written `is_finalized=false, source='ai_suggested'` — the same as every other row, and that is
precisely what makes the extension case work with no special handling: a later run overwrites it.
`diagnostic.no_submission: true` marks it, because an all-zero diagnostic is otherwise
indistinguishable from a submission of gibberish, which scores identically and means the opposite.
Documented in `WRITTEN-SCHEMA1.md`.

**No cohort number changes.** `/lesson-aggregate` and the rollup read students who have a
submission carrying work on a graded activity; a non-submitter has no submission row, so they stay
absent from the effort distribution, the understanding means and the readiness prose. The zero
moves the gradebook cell, the cadet's total and their per-student page — where it was already being
counted. Do not "fix" the aggregator to include these rows.

**`scripts/fall2026/zero_non_submitters.py`** backfills assignments graded before the rule, so the
existing term does not need a full AI re-run to repair. Stdlib + REST, idempotent (a row it wrote
is recognised as its own), dry-run by default. `zero_non_submitters_test.py` pins the deadline
precedence and the payload at **40 offline checks** — no database, no credentials — because
`effective_due()` is a re-implementation of `schema.js`'s and the two must agree, and dropping the
migration-017 per-day fold would zero a whole day track early.

### Verification, and what is NOT verified

`tests/app-schema` is green — every suite 0 failed, the three touched here at **test-nav 42 checks,
test-rollup 208, test-grade 46**. `zero_non_submitters_test.py` 40/40. Every edited page's inline
module passes `node --check`.

**Not verified:** none of this has been walked in a browser, and the zero-grade script has never
run against the database — this machine has no `~/.claude/skills/preflight-analyze/config.json`, so
even its dry run is unexercised. Its pure logic is what the 40 checks cover. Also note
`tests/app-schema`'s two live suites (`test-student`, `test-isolation`) abort at the test cadet's
sign-in with `Invalid login credentials`, before reaching any assertion; that is an environment
issue predating this change, not a regression from it.

---

## 2026-07-30 — Matthew Recker via Claude

### Physics 310 exists, offered Fall 2026, with Matthew Recker as its director

**Live data change to schema `app`** — three rows, no DDL, written as `prep_app_dml`:

| Table | Row | id |
|---|---|---|
| `courses` | `phys-310` · "Physics 310" · department NULL | `189b0483-5383-45ff-9aa7-04eb670ecdd1` |
| `course_offerings` | phys-310 / `fall-2026` · `is_active=true` | `5d8d5b43-9b84-40ce-a288-71a4880518f1` |
| `staff_assignments` | Matthew Recker · offering-wide (`section_id` NULL) · `director` | `5947d6ab-cf66-48f6-add4-d7a40c35736f` |

`department` is left NULL to match `phys-110` and `phys-215`, which both carry NULL — a third
course was not the moment to start populating a column the other two do not use.

**The course has no sections, no roster, and no assignments yet**, which is the expected state: those
are the roster-import and lesson-authoring workflows, and this change only gets phys-310 to where
those tools can see it. Verified that they can — RLS `visible_offerings()` keys off
`staff_assignments`, so the offering-wide row is what makes the offering visible, and it would work
even if the director were not also a global admin. `director_courses()` grants authoring on the
same basis.

**Two frontend spots hardcode course codes; only one of them matters, and it is not urgent.**
`COURSE_TITLE_FALLBACK` in [`site/js/util.js`](site/js/util.js#L176) is a *fallback* — the real
title comes from `courses.title`, which is set, so phys-310 needs no entry. But
`DUE_TIME_BY_COURSE` in [`site/faculty/lessons.html`](site/faculty/lessons.html#L671) names only
phys-215 (`17:59`), so **phys-310 will default new deadlines to `FALLBACK_DUE_TIME` = `23:59`**.
That is the phys-110 policy, inherited by accident rather than chosen. If Physics 310 wants a
different hour it is one line there, per CORE.md §2 — and note that map is now two of the five
entries that CORE.md says would earn a real column.

### New: `scripts/app/create_course_offering.py`

The three inserts above depend on each other in order, and the half-built states are bad ones — a
catalogue row with no offering renders nowhere, and an offering with no director locks everyone out
of its own admin page. So it is a script rather than three ad-hoc INSERTs against a database several
agents share. Idempotent (matches on each natural key first; a re-run reports `[=]` and changes
nothing) and dry-run by default per CORE.md §4. Pure DML, so it never needs `prep_app_owner`
unsealed. It deliberately does **not** create sections, enrollments, or assignments — those already
have tools, and a second path to them would drift.

---

## 2026-07-29 (fifth) — Matthew Recker via Claude

### The navbar says what PREP is: the wordmark is now PREP/iPREP Portal

**"PREP" alone told you the name and never what it was.** That was the complaint, and the bar had
no answer to it — the expansion existed only in the anchor's `title` tooltip, which nobody hovers.

Thirteen treatments were mocked up first in a standalone page,
[`tests/browser/test-navbar.html`](tests/browser/test-navbar.html) (linked from the new
`tests/index.html`), rendered as a system admin because seven links is the crowded case. The one
chosen is **PREP/iPREP Portal**: both marks in one wordmark, `Portal` set lighter behind them, and
the acronyms spelled out in the footer, which is now the one place either name is actually
*defined* — `PREP — Pre-lesson Readiness Engagement Platform · iPREP — interactive PREP, the lesson
interactions`.

**PREP and iPREP are the same colour and weight, deliberately.** An earlier pass tinted the `i`
with the accent colour; it read as two products sharing a bar, and it spent the accent — which
everywhere else on that bar means *this nav item is active* — on the brand. The slash carries a
hair of margin rather than a full space so the mark stays the single token it is spoken as. The
`i` must never be italicised: at that size it loses its dot, which is all that keeps it from
reading as a stray stroke.

This does **not** rename the platform. CORE.md §1 and PROJECT.md still reserve *iPREP* for the
interactive lesson-interaction component; the bar now names both, which is what they describe.
A variant that renamed everything to iPREP was mocked up and rejected for exactly that reason.

### The wordmark is 112px wider, and that turned into a responsive fix

Adopting it cost more than the brand markup, and the extra was all layout. Measured on a real
signed-in page at fifteen widths against both a 5-link instructor bar and a simulated 7-link system
admin bar:

- **`min-width: 0` removed from `.nav-left` — this was the real bug.** `1fr` is `minmax(auto, 1fr)`,
  so the track grows to its content and pushes the centre track along; a zeroed minimum let that
  nowrap item overflow its track instead and slide *underneath* the centred links. **This was
  already broken before any of this work** — the shipped bar overlapped its own controls at 400px,
  375px and 360px, and overlapped the links between 861px and 1000px. Removing one declaration
  fixed all of it.
- **The mark sheds in two stages** as the bar narrows, in order of how load-bearing each piece is:
  `Portal` goes below 1180px, `/iPREP` below 1000px, leaving exactly the short mark that shipped
  before today. The footer still defines both names at every width, which is what makes shedding
  them safe.
- **The nav links squeeze** in the same band, and **collapse into the burger at 920px** rather than
  860px — measured, a system admin's seven links stop fitting at 892px even squeezed and even with
  the short mark, so the old point left a ~30px band that overflowed.

**Verified 375px → 1600px, light and dark, both link counts, no console or page errors.** Below
375px the bar still overflows horizontally; the shipped bar overlapped its controls at those widths
too, so this is not a regression, and 375px is the narrowest phone in use. **Known residual:** a
course title much longer than "Physics 215" plus seven links can still overflow just above 920px —
the course button does not truncate above 560px, which is pre-existing.

*Not changed:* the sign-in and password-reset pages still show `PREP` as their hero with the
expansion already spelled out beneath it, and page `<title>`s still read `… · PREP`. The short form
is correct in both places and neither was part of the ask.

*Doc-source check:* `instructor-grading.md` and `director-schema-reference.md` were flagged by
`scripts/docs/check_doc_sources.py` because `nav.js` and `styles.css` are sources for them. Both
re-read and still correct — the grading doc's claim that there is no **Grade** entry in the top
navigation is untouched (`FACULTY_LINKS` did not change), and the schema reference depends on the
`.sf-*` diagram classes, which did not change.

---

## 2026-07-29 (fourth) — Matthew Recker via Claude

### One grading box per assignment, and it says "Grade Assignment 03"

**Two boxes were competing for one errand.** `to-grade` (📝) counted submissions past their own
deadline and not finalized; `ai-unfinalized` (🤖) counted AI-suggested grades not finalized. The
second is a **subset of the first** — `/preflight-analyze` runs *after* the deadline, so every
student an AI suggestion sits on is already past due and already counted. In a live term the two
boxes named the same lesson, linked to the same page, wanted the same action, and differed only in
which subset each had counted.

That is invisible today, which is why it lasted: the term has not started, nothing is past due, so
only the 🤖 box ever appears. It would have shown up as a duplicate the first week of class.

So `ai-unfinalized` is **removed**, and `to-grade` is the one box. What it was for is recorded where
it was deleted rather than in a commit nobody will read: an AI suggestion is not a grade until a
human says so, and that queue existed so suggestions could not sit unreviewed and invisible. They
still cannot — `to-grade` counts them from the moment the deadline passes. **The one state no longer
surfaced** is suggestions written *before* a deadline, from an early analyze run. That is deliberate:
students can still revise until the deadline, so finalizing early is wrong and a box urging it was
urging a mistake.

**The label is now `17 · Grade Assignment 03`** — count, imperative, and which one.

- **"Grade"**, not "Review AI", because the verb should survive the arrival of a second assignment
  type. "Review AI" baked in the one grading path this queue happens to have today.
- **"Assignment 03", not "Lesson 03"** — and yes, that is the opposite of the entry below, on
  purpose. The spotlight says *Lesson* because it only ever shows preflights and its eyebrow says so
  unconditionally. This queue carries whatever needs grading, and the day a course schedules homework
  or a quiz it will carry that too; "Lesson" would quietly become a lie about what you are opening.
  Course director's call, and the reasoning is in the code beside both.
- The **number** still comes from `lessonNumber()`, the same helper the spotlight uses, so the two
  agree about which thing they mean. A title it cannot read a number out of falls back to the title
  rather than printing "Assignment null" — the box's whole job is to say *which*.
- The full title survives as the **tooltip**, which is where it stopped being truncated.

**Verified** by running the shipped `perLesson()` and `assignmentLabel()` against real rows — the
sandbox has no past-due work, so the live dashboard cannot exercise this path today and saying "I
checked it in the browser" would have been false. Per-lesson boxes, the over-six summary collapse
(*Grade assignments*), and the edge cases: `homework-4` → Assignment 04 (the future case the change
is for), an unnumbered title falls back to itself. The registry's own 22-character action rule still
passes, and the suite is 351/351. In the browser the panel correctly shows **Nothing outstanding**
with the Grade-page link intact — that link surviving the empty state is the thing a test guards,
because the nav has no Grade entry.

### The spotlight header was giving half its width to an empty spacer

The title kept wrapping and dragging its status pills onto a second line. Measured rather than
guessed: in a 1090px header the controls needed 333px, the title block got **488px**, and **228px
sat empty beside it**. `.grow` is `flex: 1` and the title block is `flex: 1 1 260px`, so the two
*split* the free space equally — the spacer grew just as eagerly as the title it was starving.

Zeroing the spacer inside this header (`.spot-shell .card-head > .grow { flex: 0 0 0 }`) hands that
228px back: the title block goes to **715px**, and since it still grows it pushes the controls right
on its own, so the spacer had nothing left to do anyway. Scoped to this header rather than changed
on `.grow`, which a dozen other layouts rely on.

**Verified by walking all 37 lessons** at 1440px and again at 1280px and asserting that no header
wraps — 0 at both. The longest title in the course, *Lesson 05 — Charged Particles in Uniform
Electric Fields*, now sits on one line with both pills and every control.

---

## 2026-07-29 (later still) — Matthew Recker via Claude

### The faculty dashboard calls a lesson a lesson

The spotlight, the stat tiles, the section strips and the matrix now say **Lesson 02** and **L02**
where they said *Assignment 02* and *A02*. Two reasons from the course director, and the first is
the substantive one:

- **The number IS a lesson number.** `short` comes from `lessonNumber()`, which reads it out of
  `preflight-08` or `Lesson 08 Preflight`. Calling it an assignment number named it after the
  container it happened to arrive in rather than after the thing it identifies.
- **Nothing is lost by dropping the word,** because the eyebrow directly above already says
  **PREFLIGHT** — and that is the word worth spending, since it says what the work *is*. The
  "Past assignment" eyebrow and the two `earlier/current assignment` due-chip fallbacks were the
  only states that did not say it, so they say it now too.

**This reverses the reasoning in the entry below**, which kept the *Assignment NN* prefix on the
grounds that the rest of the page used it. That argument was about consistency and it still holds —
the answer just went the other way, so the identifier moved everywhere at once: spotlight title,
stat tile label and sub, strip cell labels and tooltips, the strip and matrix eyebrows, the matrix
column headers, and the `Effort·L02` / `Flags·L02` footer columns. Verified in a browser by reading
every one of those back and then asserting that no `Assignment NN` or `ANN` survives anywhere in the
rendered page — which is how the two footer columns were caught, since nothing else had pointed at
them.

`titleTopic()` still strips the title's own copy of the number: *"Lesson 02 — Lesson 02 Preflight —
Electric Charge…"* would have been worse than what was there before this morning, not better.

**A known limit, recorded rather than solved:** this page assumes every offering it renders is a
preflight, and the eyebrow states that unconditionally. That is true of both courses today —
neither schedules anything else — but if one ever does, the eyebrow starts lying before these labels
do. The fix belongs where `MODEL.lessons` is built (filter to preflights, or derive the eyebrow from
the assignment kind), not in the labels; noted in the module header so whoever adds a second
assignment kind finds it.

---

## 2026-07-29 (later) — Matthew Recker via Claude

### The deadline hour is course policy now, and Physics 215's is 1759

Earlier today's entry flagged five Physics 215 assignments sitting at **17:59** instead of 2359 and
left them alone. The course directors' answer inverts it: **1759 is the policy for Physics 215**, so
the other 32 were the outliers. **Physics 110 keeps 2359** — a different course with a different
director, and nobody asked for one answer across both.

**So the flat constant had to become a per-course one.** It was hardcoded as 2359 in three places,
and changing only the data would have been undone the first time anyone created an assignment:

- `DUE_TIME_BY_COURSE` in `site/faculty/lessons.html` — what a NEW assignment's time box defaults
  to, and what a bare-date prefill link resolves to. An **existing** deadline is reloaded from
  `due_by_day` and keeps whatever it was saved with, so this default never rewrites anything; the
  box is right there to change before Save. `endOfDay()` is untouched — the frozen prefill contract
  (`due_m=`/`due_t=`) still means "the course's deadline hour", which is what it always meant.
- `DUE_TIME` in `scripts/fall2026/build_fall_preflights.py` (phys-215 → 1759).
  `build_110_preflights.py` is a different course and stays at 2359.
- `scripts/fall2026/set_due_time.py` — new, for a term that is already built.

It is a hardcoded map rather than a setting because there is nowhere to put a setting: no table
under `app` carries per-course configuration, and adding a column is DDL, which is sealed. One line
is honest about that where a fake settings layer would not be. CORE.md §2 now says so, and names all
three places, because they must move together.

**A deadline lives in three columns and all three had to move.**
`assignment_due_dates.due_at` is what is enforced; `assignment_offerings.due_at` is the fallback for
a section with no row; and `assignment_offerings.due_by_day` (jsonb) is what the lesson editor
reloads into its date and time boxes — leave that one behind and the next director to open the
lesson sees 23:59 and writes it straight back on save. The retimer keeps each deadline's **local
date** and sets only its wall-clock time, doing the zone arithmetic in Postgres so DST is handled by
one authority: this term spans the November change, and a fixed UTC offset would have moved every
November and December deadline by an hour.

**Run 2026-07-29 against live**, both phys-215 offerings: **672 per-section rows, 64 offering
fallbacks, 71 `due_by_day` maps**. Read-back inside the transaction confirms 777 per-section rows
and 74 fallbacks at 17:59:59 local with **0** jsonb entries off target; the script rolls back rather
than commit if any survive. A second run reports zero changes. Verified afterwards in a real
browser: an existing lesson reloads `17:59` into both time boxes and a new assignment defaults to
`17:59`.

**The training sandbox was retimed too**, deliberately. It is phys-215, and leaving it at 2359 would
mean `port_sandbox_due_dates.py` dragging the real term back to 2359 on any future run. Its 211
submissions are unaffected in substance — lateness is computed at render time (`schema.js`
`lateness()`), not stored, and no grade column records it — but some training submissions will now
render with a late badge that did not show before. The live term had **0 submissions and 0 grades**,
so nothing there is re-decided.

### The dashboard spotlight stops saying the lesson number twice

The title read **"Assignment 02 — Lesson 02 Preflight — Electric Charge, Coulombic Force"**: the
number twice, "preflight" twice, and a third time in the eyebrow above it — with the topic, the only
part that says what the lesson is about, arriving third and getting the least room. Both courses
title their work `Lesson NN Preflight — <topic>`, and the dashboard adds its own identifier on top.

`titleTopic(title, num)` (new, in `schema.js` beside `lessonNumber`) strips the leading clause, so
the card now reads **"Assignment 02 — Electric Charge, Coulombic Force"**. The prefix is what stays,
not the title's copy of it: "Assignment 02" is what the rest of the page calls this thing — the
section strip's `A02` cells, the due-out boxes, the rollup link — so dropping that instead would
make the spotlight the odd one out.

**It strips only when it is certain**, because a title it mangles is a lesson nobody can identify:
the title must open with `Lesson <n>`, the clause must end in a dash, and `<n>` must be this
assignment's own number. Checked against the real titles of both courses and the awkward cases —
`Lesson 02 Preflight — 1-D Motion` and `Lesson 07 Preflight — LAB 1: Projectile Motion` keep their
topics whole; `Lesson 12 review — see Lesson 02`, a title with no lesson prefix, an empty title and
a null one are all returned untouched. The `A02` column tooltip still shows the full stored title,
which is where it is genuinely useful.

---

## 2026-07-29 — Matthew Recker via Claude

### Changing your password no longer locks you out of PREP

**The bug:** a user under forced rotation picked a new password, PREP said "✓ Password updated", and
then every page bounced them straight back to the account page. It stayed that way until the access
token aged out an hour later — "relaunching the site" appeared to fix it because enough time had
passed, not because reloading did anything.

**Why.** Reproduced in a real browser against the live project with the test faculty account
(reset itself to the derived default via `reset-staff-password`, signed back in on it, rotated), then
narrowed with a second probe. `admin.updateUserById({ password })` **destroys the session that made
the call**: afterwards `refreshSession()` returns `refresh_token_not_found` (400) and `/auth/v1/user`
returns `session_not_found` (403). What it does *not* do is remove the access token the browser is
already holding — that JWT stays syntactically valid for the rest of its hour, and PostgREST keeps
honouring it, so the page renders normally while `getSession()` goes on serving the user object
minted at sign-in, `must_change_password: true` and all. `account.js` was calling `refreshSession()`
precisely to pick up the cleared flag; it could never have worked, because there was no longer a
refresh token to spend, and its error was discarded.

**The fix, in two halves:**

- `changePassword()` now signs back in with the password it just set (`site/js/account.js`). That is
  the only way to get a live session after an admin password write, and it is what makes the card's
  "You stay signed in here" true rather than aspirational. If the re-sign-in fails, the page says the
  change landed and sends the user to log in, instead of leaving them on a token that will 403.
- `bootstrap()` no longer trusts the cached copy of the flag (`site/js/auth.js`). A *set* flag now
  costs one `getUser()` round trip to ask the server whether it is still set — cleared means carry
  on, an error means the session is dead and the user is signed out and sent to `login.html?err=stale`
  (a new, explanatory message rather than a bare bounce). Only already-flagged sessions pay for the
  round trip, which is a handful of sign-ins a term, and it self-heals anyone currently stuck.

**Verified:** the reproduction script fails against the old code (trapped on `account.html?rotate=1`
through a redirect, a hand navigation, and a fresh tab) and passes against the new one (`app_metadata`
reads `false`, a new token is minted, the dashboard loads and stays loaded). Real Chrome, live
Supabase.

### "↩ Today" moves onto the status tag, and the rollup link stops wrapping

**Open full rollup →** was being pushed onto a second line of the spotlight header. The always-
rendered-but-disabled **↩ Today** button (2026-07-27) was part of it — that revision fixed a control
that jumped sideways by making it hold header width permanently, which trades a rare reflow for a
constant one — but removing it was not enough on its own.

The real cause is how `.card-head` wraps: flex assigns items to lines by their *hypothetical* size, so
the title block, whose natural width is the whole assignment title on one line, claimed the row and
the link was the item pushed off. `.spot-shell .card-head > :first-child` now gets `flex: 1 1 260px;
min-width: 0`, which makes the **title** the thing that reflows — it already wraps to two lines
gracefully, and the controls do not.

The way back to the current preflight is now a second pill beside the status tag —
"UPCOMING ↩ TODAY" — drawn only when there is somewhere to go. It sits next to the words that
motivate it, it cannot push anything in the button row around because it is inline in the title, and
appearing/disappearing is free. Changed: `site/js/faculty-dashboard.js`, `site/css/styles.css`.

### The Assignments page splits its action row by read vs. write

Each assignment card's buttons are now two groups: **Grade · Preview · Launch interaction ↗** on the
left, every one of which *reads* the assignment and is available to every instructor; then a spacer;
then **Edit · Publish · Remove** on the right, which *change* it and stay director-only. Previously
the two kinds were one undifferentiated strip that simply got shorter for an instructor, so nothing on
the card said which buttons were the dangerous ones — the split says it by position, for both roles,
without a label.

**Grade** is new and leads, because it is the errand that brings faculty to this page most often. It
deep-links the grading panel to that exact assignment (`grade.html?a=<assignment offering>`, the
parameter `populate()` already reads and the same link the dashboard's due-out boxes use) instead of
leaving someone to re-find the lesson in a picker. Changed: `site/faculty/lessons.html`.

**Verified in a real browser** (headless Chrome, live data, signed in as faculty): the action row
renders `Grade | Preview | Launch interaction ↗ | Edit | Unpublish | Remove` with the manage group
right-aligned; the spotlight header keeps the rollup link on the title's line; the ↩ Today pill is
absent on the current preflight, present elsewhere, and returns to it when clicked.

### Physics 215 Fall 2026 got its per-section due dates back — 595 rows

**Every T-day section in the live course was being held to the M-day deadline.** A deadline is per
section (`app.assignment_due_dates`), because M-day and T-day sections answer the same preflight the
night before their own class; `assignment_offerings.due_at` is only the fallback for a section with no
row. The live offering was built by `split_training_offering.py` (2026-07-27) and rebuilt by
`isolate_offering_content.py` (2026-07-28), and its per-section rows did not survive: they cascade off
`assignment_offering_id`, and at the moment they would have been copied the offering's 17 sections
were not yet there to copy them onto. Only `preflight-02` and `preflight-03` had been restored by
hand. The other 35 fell back to a single date carrying the **M** value — so 9 sections and 185 cadets
faced a deadline one to four days before their own lesson (`preflight-13`: M Sep 9, T Sep 13).

`scripts/fall2026/port_sandbox_due_dates.py` restores them from the training sandbox, which never lost
its rows. The two offerings share no sections (4 vs 17), so the port cannot go section-to-section: it
collapses the sandbox's rows to one date **per meeting day** and applies the M date to every M section
and the T date to every T section — the same rule `dueRowsFor()` in `site/js/faculty-lessons.js`
applies when a director edits a lesson, so the result is what the UI would have written. It refuses if
two sandbox sections meeting on the same day disagree, never invents a date for an uncovered day,
never deletes, and does not touch `assignment_offerings.due_at` (live and sandbox already agree on it
for all 37 — the fallback was never the wrong value, it was the wrong *granularity*).

**Run 2026-07-29 against live** after `git fetch` (no divergence) and confirming no competing operator:
595 rows written, 34 already correct, 0 mismatched on read-back inside the transaction. Independently
re-verified afterwards from the read tier: 629 rows present (37 × 17), zero disagreements with the
sandbox on any assignment or day, and a re-run reports "nothing to write". Preconditions checked, not
assumed — the live offering held **0 submissions and 0 grades**, which is what makes moving a deadline
safe; the script refuses without `--even-with-work` otherwise.

**Flagged, not changed:** `preflight-02`, `-03`, `-04`, `-05` and `-07` are due at **17:59** local, not
2359 — `23:59:59Z` stored where 2359 America/Denver was meant, six hours early. Those are the
sandbox's own values, and copying them faithfully is what was asked for; moving a published deadline
is the course director's call. The script reports every non-2359 deadline it copies.

---

## 2026-07-28 — Matthew Recker via Claude

### Faculty can launch an assignment's AI Interaction from the Assignments page

Every assignment card that carries an interactive activity now shows **Launch interaction ↗** beside
**Preview**, opening the artifact in a new tab.

**It is the interactive twin of Preview, and it sits outside the director gate for the same reason.**
An artifact is a claude.ai / ChatGPT page this site cannot render — `preview-modal` says so in as
many words — so *opening it* is the only preview it has. Until now there was none: the URL was
stored on the interactive activity and visible only inside the editor's Interaction URL field, which
means an instructor about to teach off a lesson had no way to run it, and a director had to enter an
edit session and cancel out of it to read one. Reading a lesson is not an edit, which is exactly the
argument that put Preview on every card.

**Four states, deliberately distinguished:**

- No interactive activity → **no control at all.** A permanently-disabled button on the majority of
  cards is noise, and the badge row already says whether an assignment has an AI Interaction.
- A stored `http(s)` URL → a real `<a target="_blank" rel="noopener">`, so middle-click and
  copy-link work the way they do for the rollup links elsewhere.
- An interaction with no URL stored → disabled, saying so. Only reachable on rows predating the
  editor's URL requirement (`saveLesson()` has refused an empty one since it was written).
- A stored URL that is not `http(s)` → disabled, saying so. This is also what keeps a `javascript:`
  value out of an `href`: the field is free text, and while only a director can type into it, an
  inert refusal costs one regex.

Changed: `site/faculty/lessons.html` only — `card()` gained the control and the module imports
`artifactUrlOf` from the shipped `schema.js` rather than reaching into `content` by hand. No data
model, no query, no CSS: `a.btn` is already a supported shape (`styles.css:664`, `display:inline-flex`
and `text-decoration:none`), used by the dashboard's rollup link and the student lesson cards.

**Verified:** the real `card()` source was sliced out of the shipped file and rendered against all
four states plus a quote-injection URL, as both director and instructor — the launch control appears
only where intended, the `javascript:` case produces no `href`, a quoted URL stays escaped inside the
attribute, Preview survives in every case, and the manage buttons stay director-only. Also
`test-imports` (339 named imports resolve, which is what proves the new `artifactUrlOf` import),
`test-lesson-isolation` 27/27, `test-lesson-due` 34/34, and `node --check` on the extracted inline
module. **Node-only — not exercised in a browser**, so the visual placement of the button in the
card's action row is unproven.

### The library picker is gone from the Assignments page

The strip of draggable cards headed "Schedule an assignment from the library" — the last surviving
piece of the old *orphan* model, where a lesson was assembled by dragging a loose preflight and a
loose interaction into two boxes.

**It had started lying.** It listed every assignment of the course not scheduled in the current
term, described as unscheduled material available to pick. After the content-isolation work earlier
today, each term owns its own containers — so the strip filled up with the *other* term's
assignments, presented as orphans. They are not orphans; they belong to a different run of the
course. The director reported it, and the reading is right: the list was showing other sections'
assignments as if they were spare parts.

**Removing it rather than filtering it**, because the workflow it served is over. Assignments are
authored for the term they are in — the editor, or `scripts/fall2026/` for a whole 40-lesson term —
which is what per-offering content isolation already made true underneath. Cross-term reuse was the
picker's only remaining purpose, and this morning's work converted that from *sharing* to *copying*
precisely because sharing was unsafe; today's conclusion is that the copy is better made where the
term is built.

Removed: the compose region and its drag-and-drop, `modelFromLibrary()`, the copy notice and card
badge added earlier today (they lived only on this path), `getLibraryAssignment()`, the `library`
list and both queries behind it in `loadManager()`, and the `.lb-compose` / `.lb-drop*` /
`.lb-slot-*` CSS. `.lb-orphan` itself stays — the prefill destination chooser still renders lesson
cards with it.

**Kept deliberately: `saveLesson()` still refuses to share a container across offerings.** No UI
path can reach that branch now, and it stays anyway — it is the data-layer guarantee, not a feature
of the removed screen, and `test-lesson-isolation.mjs` still holds it to it.

**Two consequences worth knowing.** There is no longer any UI route to schedule an existing
assignment into a term, by design. And "Remove from this term" now leaves an assignment nothing will
ever schedule again — the modal says so instead of offering the old "can be scheduled again", and
"Delete library copy too" is the button that clears it. `assignments.is_archived` also lost its only
reader; the schema reference says so rather than implying it still hides things.

**Verification:** `test-lesson-isolation.mjs` 27/27, `test-lesson-due.mjs` 34/34, `test-imports.mjs`
clean (338 named imports, no identifier used without being imported), both files syntax-checked.
**Node-only — the page has not been opened in a browser.**

---

## 2026-07-28 — Matthew Recker via Claude

### DATA: the live Fall 2026 offering was given its own content

`scripts/fall2026/isolate_offering_content.py --commit`, as the DML tier, one transaction,
snapshot + lineage mapping written to the gitignored `_snapshots/` first. This is the repair half of
the entry below, which fixed the code. Full record: decision doc §13.

**Before:** all 37 phys-215 containers and all 42 activities shared between the real Fall 2026
offering and the training sandbox. **After:** zero shared, confirmed by
`content_isolation_check.py` (exit 0) and by an independent read-only census.

- The sandbox's containers are now `preflight-NN-training`, freeing the clean slugs for the real
  term — so `/preflight-analyze phys-215 preflight-02 M` addresses **Fall 2026**, and the sandbox
  needs `preflight-02-training`.
- 37 new containers + 37 new written activities for the real term, each activity slug freshly
  minted. Its 37 `assignment_offerings` were rebuilt against them carrying points, `due_at`,
  `due_by_day`, publish state and position verbatim, with all 34 per-section due dates restored.
- **Untouched:** 17 sections, 375 enrolments, 27 staff rows, and the entire sandbox — its 211
  submissions, 211 grades and 78 student reports still hang off the activities they were made
  against. Deleting and recreating the `course_offerings` row was considered and rejected: it
  cascades all of the above to accomplish the same content change.

**Outstanding, and the director's:** the real term lost its 5 interactive activities, because an
artifact posts to one `#i=` slug and those slugs belong to the term already using them.
`preflight-02/03/04/05` were `practice`; **`preflight-07`'s was `graded`, so its written questions
were promoted to `graded`** — a deliberate change to how that lesson scores, rather than leaving a
published lesson with nothing gradable on it. Each needs a rebuilt artifact with a fresh contract
§3.2 slug.

**Also found, unrelated and unfixed:** `pg_roles.rolcanlogin` is `true` for `prep_app_owner`.
CORE.md §0 states that role was set `NOLOGIN` after build-out and that a schema change requires a
human to unseal it. **The DDL seal is currently off.** Nothing in this work needed it — every write
above was DML — but the contract asserts a gate that is not in force. Separately, `PREP Test Faculty`
is a director on `phys-110 / fall-2026`, a real offering, which `split_training_offering.py`'s
header says it is not.

---

## 2026-07-28 — Matthew Recker via Claude

### Two terms stop sharing one copy of a lesson

The follow-through on the lesson that could not be re-pointed (entry below). That guard stopped the
*delete*; this stops the *sharing* that made a delete reach into another term at all. Design record,
including everything rejected: [`docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md`](docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md).

**The defect.** `activities` (the content) hangs off `assignments` (the term-free container), so two
offerings that schedule the same assignment shared one content row. Live, that meant: editing Fall
2026's questions silently rewrote the training sandbox's; replacing an interaction was a cross-term
delete of student reports; and `activities_write` — scoped by **course**, not by offering — let a
director of either term write both. A census run this morning (read-only) found **all 37 phys-215
containers and all 42 activities shared between the real Fall 2026 offering and the sandbox, with
211 student reports hanging off shared rows.**

**Why it was not simply a bug in the copy logic.** `mintWrittenSlug()` was `writtenSlugFor()` and
returned `<course>-<slug>-written`, deterministically, while `activities.slug` is globally UNIQUE.
A second copy of `preflight-02` could not be inserted at all. Sharing was not a choice the code
made; it was the only arrangement the slug permitted. So the mint now appends 8 random hex — the
same rule the interactive slug took in contract §3.2 — and copying becomes expressible.

**What changed in the site** (`site/js/faculty-lessons.js`, `site/faculty/lessons.html`):

- **Scheduling a container another offering already runs now COPIES it.** New `assignments` row,
  new `activities` carrying the content, the offering scheduled against the copy. Editing a lesson
  already scheduled here still never copies — its submissions point at the activity ids it has.
  Re-attaching a container nobody else runs still never copies, which is the documented
  unschedule-then-reschedule path.
- **The interaction does not come with the copy.** Its slug is the frozen `#i=` surface and belongs
  to the term whose deployed artifact posts to it, so the copy needs a *rebuilt* artifact with a
  fresh id. Refused with that sentence instead of a unique-violation.
- **The copy's own slug** takes the clean one when free, else term-qualifies it
  (`preflight-02-spring-2027`). This is what lets isolation ship with **no DDL** — dropping
  `assignments_slug_unique` is still the better end state and is deferred to the next unseal,
  bundled with `origin_assignment_id` (decision doc §6, §11).
- **The director is told before the save, not after.** A library card whose container runs elsewhere
  says so, and the editor explains that this term gets its own copy and why the interaction was
  dropped.

**A help doc that had become a lie.** `director-course-structure.md` told directors "next semester
you schedule the same library entry again **instead of copying it**" — the exact behaviour just
reversed, on the page directors read to understand the model. Rewritten, along with the reuse
section, which now says an interactive lesson cannot be copied and needs a rebuilt artifact. The
staleness index did not catch it (`site/js/faculty-lessons.js` was not a source of that doc, because
sharing-vs-copying used to look like a schema fact); `faculty-lessons.js` and the decision doc are
now registered as sources so the next change to this rule flags the page.

**New:** [`supabase/admin/content_isolation_check.py`](supabase/admin/content_isolation_check.py) —
read-only, exits non-zero when any activity or container is scheduled in more than one offering.
It runs as the `read` tier, which is not subject to RLS, so it sees the sharing the browser cannot:
`ao_read_staff` hides offerings the caller does not staff, so copy-on-schedule silently does not
trigger for a term run by somebody else. That limit is real, documented at both call sites, and this
script is how it gets caught.

**Not yet done.** The 42 already-shared rows are still shared — repairing them is a separate
snapshot-gated operator run (decision doc §8 step 7), because it repoints a *published* offering
with 375 enrolled cadets. Separately, the census found `PREP Test Faculty` is a director on
`phys-110 / fall-2026` — a real offering, not just the sandbox, contrary to what the split script's
header claims.

**Verification:** `test-lesson-isolation.mjs` (new, 27 assertions, offline, asserting the writes
`saveLesson()` issues rather than a proxy for them) 27/27; `test-lesson-due.mjs` 34/34;
`test-imports.mjs` clean; both files syntax-checked. `content_isolation_check.py` run live and
reporting the 42 shared rows as expected. **Node-only — no browser exercise.** The library card,
the editor notice, and the copy path itself are unproven against a real click.

---

## 2026-07-28 — Matthew Recker via Claude

### Roster import corrections, the section-creation deadlock, and a lesson you could not re-point

Four defects the director hit in one sitting on the faculty beta. The first two are the import
being stricter than the data model; the third is a closed loop between two screens; the fourth
made a real lesson uneditable and reported it as a database trigger.

**1 — A cadet with no squadron is imported.** `roster-import.js` required `Cadet Squadron` both as
a column and per row, and skipped any cadet whose cell was blank. `students.squadron` is a nullable
text column carrying "advisory context for instructors" and no authorization meaning
(`008_student_identity.sql`), so the check cost a real cadet's name, address and section to protect
a field nothing reads. Dropped from `REQUIRED_FIELDS` and from the row loop together — they are the
same rule at two scales, so an export that never carried the column imports too. A blank cell is
stored as `NULL` rather than `''`, which is what keeps `reconcile()` from reading "the file said
nothing" as "clear the squadron we hold". The preview counts how many came in without one.

**2 — There is no "Majors" column.** The export carries **Major 1**, **Major 2** and **Major 3**,
any of which may be absent. The parser always mapped all three correctly; the *labels* did not.
`COMPARED_FIELDS` showed `major_1` as "Major" on the returning-cadet diff table, and the Students
tab's copy said "Majors" — both naming a column a director cannot find in the spreadsheet they are
being asked to check. Labels and copy now use the registrar's own names.

**3 — A new course could not be given its first section.** Section coverage said sections "are
created by a roster import on the Students tab"; the import refused any file naming a section that
did not exist. The loop had no entrance, and the reason it survived is that the import's escape
hatch was disabled in exactly the case it existed for: `previewImport()` passed
`knownSections: null` when the offering had no sections, which turns the unknown-section check
**off**. Every row then parsed clean against a section that does not exist, `unknownSections` came
back empty so "Create these sections and re-check" never rendered, and `commitRoster()` refused the
whole import with "Create them first, then re-run" — pointing at a screen that pointed back.

Both halves are open now. The map is always passed, empty included, so the create-and-re-check
offer appears on the **first** import and gets its own wording for that case. And
`createSection()` — exported from `faculty-roster.js` with zero callers since P1.10 — is wired to
a **+ Add section** control on the Section coverage card, which derives meeting days and period
from the code as you type and lets you correct them before saving. Two routes for two jobs: the
import creates a term's worth from the file, the button creates the one that turns up in week
three. Both now re-resolve `ctx`'s section scope, so a new section is visible to Grade and Report
without a reload.

**4 — Replacing a lesson's interaction failed the moment a student had committed to it.**
Reported as *"Could not replace the interaction: submission e02130b7…: an unlock must set
unlocked_by so it is attributable"* on a lesson holding 8 reports.

`submissions_activity_in_offering` is `ON DELETE SET NULL`, so deleting an activity makes Postgres
null out `submissions.chosen_activity_id` by itself — and every caller was written against that.
But that cascade is an `UPDATE` on `submissions`, which fires `submissions_lock_activity()`. The
trigger sees a committed choice becoming NULL with no `unlocked_by`, and refuses. The statement
rolls back. The trigger is right — migration 006 hardened it deliberately after a student was shown
to be able to unlock themselves — and DDL on `app` is sealed, so the fix is on the client: these
operations **are** unlocks and were simply never being performed as such.
`unlockCommittedTo()` now releases the affected students first, attributed to the caller (which
migration 006 requires), setting `status` back to `draft` the way `unlockSubmission()` does. Wired
into `replaceInteractive()` *and* into `saveLesson()` step 4, which had the identical latent bug
whenever a modality change detached an activity somebody had committed to.

`replaceInteractive()` also now **refuses** when another offering schedules the same activity.
An `activities` row hangs off the shared library assignment, not off one term, so the delete
reached every term that scheduled it — the swap dialog even warned that reports would be deleted
"in every term the artifact ran", which is not something to warn about and proceed with. This
mirrors `deleteLessonAndContents()`, which has refused for that reason all along. Where RLS hides
the other offering the guard cannot see it, so the trigger's refusal is caught and translated
instead of forwarded — nothing is written either way.

Docs: `instructor-accounts.md`, `admin-system-operations.md` and `SYSTEM_GUIDE.md` all stated the
"sections are created by the import, and there is no other way" rule; all three corrected, with the
deadlock recorded rather than quietly dropped. `tests/app-schema/test-roster-import.mjs` gains
coverage for optional squadron at both scales and for the empty-vs-null section map (120 assertions,
all passing). Verified with Node only — the browser paths (the + Add section modal, the first-import
preview, the interaction swap) have **not** been exercised against the live database.

### A prefill link now asks which course and term before anything else

**And it was answering that question wrong.** An AI-generated authoring link carries a course
*code* (`course=phys-215`), which cannot name a term, so `resolveOffering()` picked an offering
silently. The destination chooser then offered "add to an existing assignment" from `vm.lessons` —
**which is always the offering currently on screen, not the one the link resolved to.** A
`course=phys-110` link opened while looking at Physics 215 therefore listed Physics 215's
assignments as places to attach a Physics 110 artifact. Nothing warned, and an artifact attached to
the wrong course's lesson looks exactly like one attached correctly.

The chooser now opens with a **course & term picker**, above the new-vs-existing choice:

- It lists only offerings the person may **author** in — director or global admin. Authoring is
  director-gated everywhere it is gated at all, so an offering they merely teach was never a legal
  destination and is not offered as one.
- Changing it **moves the page's scope** (`ctx.setCurrentOffering` + `load()`) rather than just
  recording a preference, which is what keeps the assignment list underneath it honest. The chooser
  reopens from the top afterwards: an assignment picked before the switch names a lesson in a
  course we are no longer in.
- The link's own course is applied the same way **before** the chooser opens, so the two can never
  disagree at first paint.
- A code naming a course this director does not run now **says so** ("not a course you run — pick
  the right destination") instead of falling through to whatever was on screen.
- `renderDestLessons()` names the course and term on the list itself. It is the one thing on screen
  that is silently offering-specific.

`switchOffering()` also repaints the nav, because the nav's own handler does that inline — so a
switch driven from anywhere else left the course name beside the wordmark naming the course we just
left, directly above the new course's assignments.

Also: `init()` now **returns** its promise chain, so `runPage()`'s catch actually covers the prefill
path. It was fire-and-forget, and that path now does real work whose failure would otherwise show
as a page stuck on its spinner.

`INTERACTION-PREFILL-LINK.md` "What the director experiences" updated — it still described the
form opening directly, which stopped being true when the destination chooser landed. **The link
format is untouched and stays frozen**; only what the page does with it changed.

*Verification:* `resolveOffering()` and `authorableOfferings()` exercised offline against synthetic
contexts (term-in-view preference, unknown code reporting `matched:false`, director-only filtering,
global-admin passthrough) — 8 checks, all passing. Full suite unchanged at 340/0. **The chooser
itself is not browser-verified.**

### Seven post-cutover corrections and fixes

First pass over the promoted site. Four of these are things the system *said* that were not true —
which is the more expensive kind of defect here, because a director acts on them.

**1. The submit page told students the opposite of what happens.** After saving an interaction
report it said *"Re-submitting will overwrite it."* That was true of the retired `public` receiver
and has been false since migration 015: a graded interactive submission finalizes its own grade on
commit, and both the page and `submitInteractionReport()` then refuse a second report. The first
report is the only report. It now says so — before submitting as well as after, since the point of
knowing is to know beforehand — and correctly distinguishes **practice**, which grades nothing and
therefore *does* replace on a re-run. Same correction in `INTERACTION-DATA-CONTRACT.md` §7,
`PROJECT.md`, `SYSTEM_GUIDE.md`, `director-ai-rules.md`, and `student-getting-started.md`.

**2. A roster import now removes cadets who are no longer on the roster.** The registrar's export
*is* the roster, but the import was purely additive, so a cadet who dropped in week two stayed
enrolled forever — on the roster page, in every cohort denominator, and rendered as a missing cell
on every lesson after they left. The preview now lists everyone enrolled but absent from the file,
ticked, un-tickable one at a time, and confirms by name before writing.

Three decisions worth keeping:

- **Scope is the whole offering.** The first cut restricted departures to sections the file itself
  covered, hedging against a partial export proposing to empty a section it never mentioned. The
  director's rule is that this cannot arise — *only directors import, and they import a whole
  course at a time* — so the hedge bought nothing and cost the case most worth catching: a section
  the export dropped entirely would never have been reconciled. Two guards remain and are not the
  scope rule in disguise: **a file that matched no rows proposes nothing** (that is the signature
  of the wrong file, and the operator gets the parse errors instead), and **a cadet named on a row
  that was skipped for a data problem is never a departure** — a malformed email is something to
  fix, not evidence somebody left. An `other-course` skip deliberately protects nobody.
- **Dropped, never deleted.** The director's rule again: *a student is never deleted, because they
  may be in another course.* `status='dropped'` is the whole answer rather than a compromise:
  *every* other reader in the app already filters `status = 'active'` — grading, gradebook,
  dashboard, rollup, EI, tasks — so a dropped cadet is out of the course in every sense a person
  means, while their record and work survive a stale export. `loadRoster()` was the one reader that
  ignored `status`, which is why `dropped` looked like a status that did nothing; it splits now,
  and removed cadets sit in a drawer under the roster with a **Re-enroll** button.
- **It undoes itself.** A cadet named in a later export is reactivated automatically
  (`returning()`), because the enrollment upsert is `ignoreDuplicates` and would otherwise find
  their dropped row, change nothing, and leave them outside the course permanently.

**Also changed: the per-student Remove button no longer deletes, and `removeEnrollment()` is
gone.** It cascaded away every submission and grade for the offering, irreversibly, from a button
beside a search box — defensible as the only removal on the page, and not for a moment after a file
upload could do the same to twenty people. Both paths now drop. Purging a row outright is an
operator-tier script action (the `tests/app-schema/cleanup.py` pattern), taken deliberately.

**3. Preview on every assignment card.** Seeing what a lesson asks required Edit → Preview →
Cancel — a write-shaped path to a read-only answer, and director-only besides. The card button sits
outside the director gate. Both entry points are relabelled **free response** (the modal said
"questions", which read as though it might include the interaction; it cannot — that is a claude.ai
artifact), and the editor's heading now says its preview includes unsaved edits, since the two
sources differ.

**4. Gradebook: a missing cell becomes an explicit `0` once the column is graded.** Director's
call, and a real distinction: before grading, `—` says "nothing arrived" and is still provisional —
late work may yet be accepted. After grading it is settled, and what the student has is not an
absence but a zero. The old display said `—` forever, so the grid never showed the number the total
was already built from (MISSING has always counted zero-out-of-full). **Display only** —
`gradedScopes()` feeds `cellState()` and never reaches `totalsFor()`, pinned by a test, because a
percentage that moved when an instructor finished grading rather than when work arrived would be
worse than the thing being fixed. Scoped per *section*, so an M-day section finished on Tuesday
does not zero out the T-day section a day before its work is due, and keyed on a **finalized**
grade, because announcing a classmate's zero off an unconfirmed AI draft reports a decision nobody
made.

The ungraded-submission indicator was a middle dot in `--muted`, which at 0.84em in a grid of
0/1/2 was indistinguishable from an empty cell — so the one state representing the *instructor's*
backlog was the least visible thing on the page. It is now a **✓ in gold**, the colour that already
means "still needs you" on this grid. The dash keeps red only for the settled zero; the provisional
one is muted, since a wall of red on an ungraded column reads as a class in trouble rather than an
instructor with work to do.

Three follow-ups from the director's first look, same day:

- **The zero is colour-coded as understanding 0.** It was the one uncoloured cell in an otherwise
  coloured column, reading as "no data" when it is the most definite data on the row — a
  non-submission demonstrated *nothing*, which is literally 0 on the understanding scale
  (contract §5.1) rather than the `null` that means "not assessed". Filled in `buildMatrix` and
  only where nothing else supplied a value. **Effort deliberately stays null**: no effort was
  measured, which is not the same claim as zero effort.
- **`0` dropped from the legend.** A number in a gradebook explains itself. What needs a legend is
  everything that is *not* a number — the dash, the tick, the draft marker, the clock, the blank.
- **Legend keys were never actually coloured.** They carry the cell classes, but the cell colours
  are scoped `.gb .gb-*` and the legend is a *sibling* of the table, so every key rendered in the
  same grey — a legend whose swatches do not match what they label. Given `.gb-legend` rules of
  their own rather than un-scoping the cell rules, which would leak `.gb-missing` into any page
  reusing the name. Pre-existing; found while removing the `0`.

**Why no dashes are visible yet, since it will be asked again:** every published Fall 2026 offering
is due in August. A cell with no submission *before* its deadline is `PENDING`, not `MISSING` — it
renders blank, because absence means nothing until the deadline passes, and counting it would put
every cadet at 0% on day one. The dash and the zero both become reachable at the first deadline
(`preflight-02`, 10 Aug). Verified read-only against the live database.

**5. The JSON backup's PII warning was wrong twice.** It said *"Contains student PII and every
free-response answer"*. `buildBackup()` reads `assignment_offerings`, `enrollments`, `submissions`
and `grades` and never touches `submission_activities` — so there is **no student writing in the
file at all** — and name + cadet ID + score are explicitly not treated as PII in this system
(`faculty-rollup.js:882`, contract §4). Calling it a disclosure made the one export a director
should be able to take routinely look like a liability. It now says what the file is: a gradebook.

**6. Saving a feedback item no longer jumps the page to the top.** Two causes. `load()` replaced
the list with a one-line spinner, which collapses the document and makes the browser clamp
scrollTop *before* the refetch returns — restoring afterwards cannot help, so a post-save refresh
is now quiet. And every status click re-rendered; `render()` preserves and re-applies `scrollY`
around the innerHTML swap. The roster import's departure checkboxes were written the same way for
the same reason — they update the commit button rather than re-rendering a hundred-row table under
the person reading it.

**7. The artifact contract, opened.** Two things were wrong and one needed confirming.

- **`d` is now REQUIRED of producers** (contract §3.1). It was "recommended", written when nothing
  depended on it; three things now do. Without `d` the receiver stores a null `content`, migration
  015's trigger has no `effort` and writes **no grade**, and `/lesson-aggregate` sees the student
  contribute nothing to the cohort — a report that lands and earns zero. **The reference artifact
  built its submit URL from `t`, `i` and `r` only**, which is exactly why every Fall 2026
  interactive submission needed `/interaction-backfill`: the artifact had already assessed all of
  it and simply never sent the machine-readable copy, so it was reconstructed afterwards by an AI
  re-reading prose written for humans. Fixed at the source — the report format now mandates a
  trailing fenced `json` block, and the artifact extracts it into `d`, strips it from `r`, and
  hides it from the cadet. A malformed block degrades to an `r`-only submission rather than costing
  anyone their work. The **receiver still accepts** a `d`-less report and always will: "required"
  binds the producer, not the receiver, so no deployed artifact breaks.
- **§7 described a receiver that has not existed for months** — `preflight_interaction_reports`, a
  `report_data` column, a `score` trigger — including the "re-submitting overwrites" rule from
  item 1. Rewritten against the live `app` receiver. The wire format it documents is unchanged.
- **The endpoint is correct post-promotion, verified rather than assumed** (§2). The real receiver
  is on disk at `site/student/interaction-submit.html`, the contract URL matches it character for
  character, and the reference artifact builds from that same string. All three agree; nothing
  needs changing and nothing may be changed.
- Added **§10, a producer checklist** — the nine things to check before a lesson artifact goes to
  students, because the failure mode for most of them is silent.

**Verification.** `tests/app-schema/run.mjs`: **339 passed, 0 failed**, including new coverage for
`departures()`/`returning()` (the scope rule, the empty-file case, already-dropped rows, string-vs-
number cadet ids) and `gradedScopes()`/`cellState()` (per-section scoping, finalized-only, and that
the totals are byte-identical either way). The two live suites that touch a signed-in student
(`test-student`, `test-isolation`) fail at sign-in with *Invalid login credentials* — **confirmed
pre-existing** by re-running them against a stashed tree; the test cadet's account needs attention,
unrelated to this work. Every inline `<script type="module">` on the five edited pages was parsed
with `node --check` (this caught one real defect: a backtick inside a template literal in
`admin.html`). **Not verified in a browser** — CORE.md §2 asks that this be said plainly, and the
UI changes (roster departure table, gradebook cells, card preview, feedback scroll) want a pass at
`python -m http.server 8000` before anyone relies on them.

**`site/help/DOC-STATUS.json` needs regenerating after this commit** —
`check_doc_sources.py status --write` records a commit hash, so running it against a dirty tree
would ship a snapshot claiming everything is stale.

### PREP v2 cutover, Phase 4: `site/app/` promoted to `site/`

**The redesign is now the site.** `site/app/` no longer exists — its 109 files moved up to `site/`,
and the four legacy pages that read schema `public` were deleted. Every URL a student or instructor
visits now serves the v2 portal against schema `app`. This is Phase 4 of
`docs/operations/PREP-V2-CUTOVER.md` and roadmap **P0.1**, the last open item from the redesign.

Run with `scripts/promote_app.py --commit` as a single designated operator, on a clean tree in sync
with `origin/main` (CORE.md §0). **No database state was touched** — this is a file move plus the
path fixes it forces. Schema `public` is untouched and remains the rollback; dropping it is a
separate, unauthorized, snapshot-gated operation (PREP-V2-SCHEMA.md §8).

**The frozen contract URLs came through byte-identical, which was the whole point.** Both
`site/student/interaction-submit.html` and `site/faculty/lessons.html` were forwarding stubs; the
promotion replaced each with the real page **at the same URL**. Verified by SHA-256 before and
after: the file now at each path hashes identically to the page that was at `site/app/…`. Every
deployed Claude artifact keeps posting to a URL that still works, with nothing rebuilt.

**Deleted:** `site/admin.html`, `site/interactions-admin.html`, `site/interactions.html`,
`site/review.html` (the last a credential-free grade viewer the legacy audit called "a re-enable
away from a FERPA problem"). **Relocated out of the published tree:** the eight internal design
notes at `site/app/*.md` → `docs/app/`, so a file named `LEGACY-AUDIT` no longer sits beside the
student login page.

### Two bugs in `promote_app.py`, both found by running it

Fixed and committed separately (`8963547`) before the real run, because the script refuses to run on
a dirty tree:

- **ENOENT on the first overwrite.** The move loop created each destination's parent directory and
  *then* `git rm`'d the incumbent. When the incumbent was the only tracked file in that directory,
  `git rm` removed the directory too — undoing the mkdir — and `git mv` failed. `site/css/styles.css`
  was exactly that case, so the run aborted on the first of its five overwrites with the file already
  removed. The mkdir now happens after the `git rm`.
- **The empty-shell cleanup never fired.** It tested `site/app/` itself for emptiness, which is never
  true while its subdirectories survive (git tracks files, not directories). It now walks bottom-up,
  and refuses to remove anything if a real file survived — which would mean the plan missed something.

### What the runbook did not anticipate: everything outside `site/` that hardcodes a path into it

This was the bulk of the work, and the general lesson is that **the script moves files and nothing
else knows they moved**. All fixed in this commit:

- `docs/DOC-SOURCES.json` — 31 source paths. The one *prose* mention of `site/app/`, inside a note
  describing what that note used to say, was deliberately left alone.
- `scripts/docs/check_doc_sources.py` — wrote its generated verdict to a hardcoded
  `site/app/help/DOC-STATUS.json`.
- `scripts/app/gen_db_schema.py` — generated into a hardcoded `site/app/js/db-schema.js`. Left
  unfixed this would have read as live-schema drift: the test fails with "does not exist — run the
  generator", which is not what a stale generated file usually means.
- **Three** Node test harnesses, not the one the checklist names: `tests/app-schema/` (76 refs),
  `tests/browser-harness/` (21), and `tests/browser/` (38). The last matters most — those are
  `<script src>` and `import` paths inside HTML sandboxes, so they would have broken silently in a
  browser rather than loudly in a runner.
- `tests/app-schema/test-config.mjs` asserted that the *legacy* config stayed on `public`. That
  invariant is precisely what this cutover ends, so the test now asserts the new one: exactly one
  config, targeting `app`, with no legacy page and no second config left alive.

### `legacyUrl()` removed rather than repointed

`site/js/util.js` exported a helper that built relative links to `admin.html` /
`interactions-admin.html`, adjusting depth for whether the caller sat under `/site/app/<role>/` or
`/site/<role>/`. It had **zero live callers** throughout (legacy audit §5, roadmap P0.1), and every
link it could return became a 404 the moment those pages were deleted. There is nothing left for it
to point at, so it is gone rather than half-fixed.

The two *runtime* path helpers needed no change at all, which is worth recording: `APP_ROOT` in
`auth.js` and `ICON_BASE` in `util.js` both detect depth with `/(student|faculty)/…$` rather than
matching a literal path, so they resolve identically before and after. That was designed in, and it
held.

### Verification

- **`tests/app-schema`: 321 passed, 0 failed.** One suite, `test-isolation.mjs`, **did not run** —
  see below.
- **HTTP smoke test** against `python -m http.server`: every promoted page, stylesheet, module, help
  manifest and icon returns 200; all four deleted legacy pages and `site/app/js/config.js` return
  404. Every `href`/`src`/`import` on ten representative pages was followed — zero broken references.
- **`check_doc_sources.py`** flagged 7 documents on the first pass. Every trigger was a source file
  that had *moved* or had a comment edited, with no behavioural change, and no help doc cites a URL
  that moved (the only `app/` string in help content is `supabase/migrations/app/*.sql`, a database
  path). Their `reviewed` dates are bumped to 2026-07-28 on that basis. `PREP-V2-CUTOVER.md` was
  substantially rewritten and re-dated as a real review.
- **Committing the move flagged four more**, this time because `CORE.md` and `PROJECT.md` had
  genuinely changed — and one of them was **wrong, not merely stale**:
  `site/help/admin-system-operations.md` told admins the two frozen URLs "are currently stubs
  forwarding into the app and become the real pages at promotion". That is a world-readable page
  describing the system in the present tense, and the promotion had just falsified it. **Fixed**,
  not bumped. The other three (`ai-and-your-work`, `director-ai-rules`, `director-course-structure`)
  make no claim about tree layout or URLs and were correct as written.

**Not verified, and unrelated to this change: `test-isolation.mjs` could not sign in as the test
cadet** (`3009999999@usafa.edu`), failing with `Invalid login credentials`. That suite carries the
RLS isolation checks — anon reads nothing, a student sees only their own rows. It **passed on the
pre-promotion baseline run earlier the same day** and the credential broke between the two runs. It
is not caused by the promotion: the harness hardcodes its own URL and publishable key
(`harness.mjs:18-19`) and never loads any file this commit moved, and RLS is a property of the
database, which this commit does not touch. The likely cause is that account's live password state
(it was already flagged `must_change_password` at baseline, which is why `test-student.mjs`'s
bootstrap check failed there). **Restoring that account's default is a live-auth mutation and was
deliberately not done here** — it needs the coordination gate, and the database is currently
unsealed for other work.

### Docs

`CORE.md` §0 rewritten: the two-live-schemas-behind-two-URL-sets model is gone, replaced by one
reachable schema (`app`) and one retained-but-unreferenced rollback (`public`). `PROJECT.md`'s Key
Files table rebuilt around the promoted paths (the old one listed four pages that no longer exist).
`PREP-V2-CUTOVER.md` is now a record rather than a plan, and carries the list above so the next
tree move starts from it. Roadmap **P0.1 closed**. The two frozen contracts were corrected by hand
after a blanket path rewrite corrupted them into nonsense — one had come out reading "a stub
forwarding into itself", the other "don't target" the very path that *is* the contract.

**Not done, deliberately:** `prep_app_owner` is left **unsealed** at the course director's request,
who is still making schema tweaks. Roadmap **P0.2** (seal it for good) stays open.

---

## 2026-07-28 — Matthew Recker via Claude (feedback: mark an accepted item done, and get it off the list)

**Migration `app/018_feedback_completed.sql` added; see "Applying it" below for its status.**

### The problem

013 gave every comment a **decision**. It gave nobody a way to say the decision had been **acted
on**, so an accepted item stayed in the triage list forever, indistinguishable from one agreed to
five minutes ago. With the feedback box on every page that list only grows, and a list that only
grows is one nobody opens — the failure 013 was written to prevent, one step further along.

### Why a column and not a fifth status

013's header refuses a `'done'` **status**, and that refusal still holds: status is the triage
**decision**, and completion is an **outcome**. A fifth status would also have broken two things
013 built:

- `feedback_roadmap_ref_accepted_ck` (`roadmap_ref IS NULL OR status = 'accepted'`) would reject a
  completed row carrying a roadmap ref — i.e. exactly the rows most likely to be done.
- The roadmap skill's work list keys on `status = 'accepted'`, so completing an item would silently
  drop it out of a query that has nothing to do with completion.

As a separate axis neither happens, and every existing constraint, index and query is untouched.

**The roadmap work list is deliberately unchanged.** `status = 'accepted' AND roadmap_ref IS NULL`
still means "agreed to, not yet written down" — completion is **not** subtracted from it, because
`docs/ROADMAP.md` §8 records what *landed*, so a shipped item still wants a line there. Stated in
the migration header, in `pendingRoadmap()`, and pinned by a test, because it is the thing most
likely to be "fixed" by mistake.

### What changed

- **`supabase/migrations/app/018_feedback_completed.sql`** — `feedback.completed_at` +
  `completed_by` (FK to `instructors`, `ON DELETE SET NULL`), plus two CHECKs: only an accepted item
  may be complete, and attribution cannot exist without a completion. No new index — the admin view
  reads the whole table in one select and splits it in the browser, so an index would serve no query.
- **`site/app/js/faculty-feedback.js`** — the two DB axes are flattened into one five-way display
  **bucket** (`new` · `accepted` · `completed` · `declined` · `duplicate`) via `bucketOf()`. New
  `BUCKETS`, `isCompleted()`, `isClosed()`, `splitByClosure()`. `filterRows()`'s `status` key is now
  `bucket`. `resolutionPatch()` takes the row's existing stamps back in so an unrelated edit cannot
  re-date "done on" into "last touched", and clears the completion when the acceptance is withdrawn
  — same write, so the CHECK cannot reject it.
- **`site/app/faculty/feedback.html`** — the matrix gains a **Done** column (so *Accepted* now means
  "agreed and still to build" and the columns still sum to the total), with a rule dividing the open
  columns from the finished ones. The list splits: open items stay on the page, finished ones
  collapse into a **Resolved** drawer at the bottom, which opens itself rather than leaving a blank
  screen when a filter matches only finished items. Cards get a **Done** toggle, disabled until the
  item is accepted.
- **`site/app/css/styles.css`** — `.fb-donebtn`, `.fb-done-chip`, `.fb-drawer*`, the `completed`
  bucket colours, and the open/closed divider. The divider is a sibling selector on the *first*
  closed column, so reordering `BUCKETS` moves the line rather than stranding it.
- **`site/app/help/director-schema-reference.md`** — the two new fields, and a paragraph on
  decision-vs-outcome. Its `DOC-SOURCES.json` entry was also missing migrations **016 and 017**,
  which had landed without ever flagging the page; all three are now listed.

### Verified

`tests/app-schema/test-feedback-admin.mjs` extended to 75 checks, all passing — the new ones cover
bucketing, the open/closed split, the roadmap-list invariant, and the four ways the completion stamp
can be written wrong. Full suite: 330 passed, 1 failed — `test-student.mjs` "bootstrap returned a
context", which is a test-cadet sign-in failure unrelated to this work (it imports only `auth.js`
and `student-data.js`, neither touched here). The page's inline module passes `node --check`.
Post-apply: `gen_db_schema.py --check` clean, `check_doc_sources.py` reports all 12 indexed
documents current.

**Looked at, signed in, against live data** — the course director walked the page in the browser
the same day and confirmed it. That closes the gap the eight prior entries carry, for this surface
only. Worth noting how it was closed: the browser harness could **not** do it, because
`PREP Test Faculty` is not `is_global_admin` and the page is admin-gated, so the automated route
would have meant granting a test account cross-course reach on the live database. A human with an
admin account was the cheaper and safer path, and remains so for every admin-gated surface.

### Applying it

**Applied to live `app` the same day**, by the course director, through the DDL window 014/015 left
open — the agent session was blocked from running the apply itself. `site/app/js/db-schema.js` was
regenerated in the same pass and `gen_db_schema.py --check` reports the committed catalogue matches
live across all 26 tables.

**⚠ `prep_app_owner` is STILL unsealed** — as it has been since 014. Re-seal it as `postgres` when
nothing else needs the window:

```
ALTER ROLE prep_app_owner NOLOGIN;
```

---

## 2026-07-27 — Matthew Recker via Claude (the lesson rollup was dead: `ReferenceError: ctx is not defined`)

**The assignment rollup showed "Computing course-wide summary…" and never resolved.** So did the
per-student Markdown report viewer (a spinner) and the AI corpus builder. One line caused all three.

### What broke

`activitiesOf()` in `faculty-rollup.js` grew a call to `offeringSections(ctx)` — but it takes no
`ctx` parameter and has none in scope. Every other use of `ctx` in that module is inside a function
that receives it. A free variable in an ES module is strict mode, so this is a **ReferenceError on
every call**, not a silent `undefined`.

It reached three exported reads, all of which funnel through it:

| Export | Surface that died |
|---|---|
| `loadInteractionData` | the rollup's numbers — completion, effort, understanding, misconceptions |
| `loadReport` | the per-student Markdown report modal |
| `buildLessonCorpus` | the AI corpus builder |

Introduced by `418fbbe` (per-day deadlines, migration 017) earlier the same day — **not** by the
faculty-beta commit that landed after it, which touched no rollup file. Verified by `git blame`,
by `git log -S`, and by reproducing the throw against the live database before changing anything.

### Why nobody could tell which change did it

`report.html` awaited both loads with **no rejection handler**. A throw left `reportRows` at `null`,
`renderAggregate()` took its early return, and the panel printed its "computing" placeholder
indefinitely. A crash was therefore indistinguishable from a slow query, and the only evidence was
a console error nobody had reason to open.

That is the more important half of this fix. Both loads now `.catch()`, and a rejection renders as
an error naming the message — a wrong answer that announces itself beats a right-looking one that
never arrives. A failed load is also now distinct from an empty one: "no submissions yet" is a fact
about the cohort, "the query failed" is a fault to report.

### The fix

`ctx` is threaded through `activitiesOf` → `interactiveActivityOf` → the three exports, matching the
convention `loadManager(ctx)` and `buildLessonCorpus(ctx, …)` already follow. Not a module-level
global: the dependency belongs in the signatures that have it. `report.html`'s two call sites pass
`ctx`.

**Verified live**, signed in against production: `loadInteractionData` returns **71 rows** for
`preflight-02` — 63 written, 8 interactive — summarizing to avg effort 4.35 and understanding 3.96.
Before the fix the same call threw.

### Regression test

`test-rollup.mjs` gains an entry-point block asserting the three exports **resolve rather than
throw**. It is not a test of what they return — the stub client returns nothing useful — it tests
exactly the property that was lost. Confirmed to fail with `ReferenceError: ctx is not defined` when
the fix is reverted, and to pass with it. Two further checks pin the rejection handler and the error
state in `report.html`, so the *invisibility* cannot come back either. The suite's stub client was
widened to the methods these paths use.

### Also: the dashboard's "↩ Today" button no longer shifts the layout

It was rendered only when you were off the current preflight, and sits immediately before
**Open full rollup →** in a flex row — so arrowing to another assignment made that link jump
sideways under the cursor. It is now always present and **disabled** on the current preflight, which
is the convention the two nav arrows in that same header already use at the ends of the list. No
reserved-width slot, which would have gone stale the moment the label changed.

### Unrelated pre-existing failure, left alone

`supabase/admin/aggregate_summarize_test.py` fails one assertion —
*"a cross-TERM match may be a stale offering, and says so"*. Commit `57fdae3` added an
`elif len(terms) > 1` branch whose wording is *"If one of these terms is **genuinely** over,
deactivating…"*, so the literal substring `"is over, deactivate"` the test greps for is no longer
present. The advice is intact; only the assertion's literal is stale. Confirmed present without the
changes in this entry, and **not fixed here** — it is another session's in-flight work and CORE.md §0
is explicit about two agents editing one area. Fix is one word, in either the test or the message.

---

## 2026-07-27 — Matthew Recker via Claude (`lesson_aggregate.py --term`; lessons 03 and 04 closed out in the training sandbox)

**Code change plus four analysis runs.** The runs themselves are recorded in `app.analysis_runs`,
not here (CORE.md §5); this entry is for the code change and the gap that forced it.

### `--term` on `pull` / `write-analysis` / `status`

**The 2026-07-27 offering split made `lesson_aggregate.py` unable to name the lesson it was asked
to aggregate.** `_lesson_meta()` refuses to guess when a slug matches more than one *active*
offering, and correctly told the operator to disambiguate with the course-scoped activity slug.
But phys-215's training sandbox and its real Fall 2026 offering **point at the same shared
activities**, so `phys-215-preflight-03-written` matches both and the suggested remedy resolves to
the same tie. The only escape the message then offered was `is_active = false` on a
`course_offering` — i.e. taking the live course offline in order to aggregate the training one.

`--term <terms.code>` is the disambiguator that actually works here. Additive: omitted, every
existing invocation resolves exactly as before, including the refusal. The ambiguity message now
detects the one-course/two-terms case and names `--term` instead of sending the reader in a circle.
Wired through all three subcommands that resolve a lesson — including `cmd_status`, which builds
its own query and would otherwise have accepted the flag and silently ignored it.

Regression-checked: an unambiguous slug still resolves with no `--term`, the three-way
`preflight-03` ambiguity still refuses, `worklist` is untouched, and an unmatched `--term` fails
with a message that names the flag.

### The four runs (training sandbox only)

`/lesson-cycle` for `preflight-03` and `preflight-04`, M then T, over the synthetic work seeded
earlier today. 14 analysis scopes per lesson, no stale flags. The pair is worth noting because the
two lessons exercise **opposite halves of the pipeline**, which is the whole reason the sandbox
holds both:

- **`preflight-03`** — written graded. 70 answers graded across two runs, each writing
  `question_scores` plus the `schema:1` assessment into `grades.diagnostic`, read back and compared
  field by field. Misconceptions resolved against PROJECT.md's Preflight-3 table
  (`scalar-sum`, `ambiguous-direction`); one new id coined — **`equal-charge-equal-force`**, for
  students who reach the right answer by assuming equal charges give equal forces regardless of
  separation. Dominant finding: 29 of 70 earned full credit on an answer that never states the
  forces must oppose.
- **`preflight-04`** — interactive graded. **Grading was correctly skipped both runs**: the written
  activity is `practice`, so migration `015`'s trigger had already written all 70 finalized
  `derived` grades at commit. Aggregation alone, exactly the case `lesson-cycle` Step 2 describes.

**Both runs were FORCED past the deadline check** — these lessons are due 2026-08-12/17 and today
is 2026-07-27 — and each `analysis_runs` row says so in its summary, following the precedent set by
the 2026-07-22 `preflight-02` run on the same sandbox.

**Grading ran on `prep_app_dml`, not the service key.** `~/.claude/skills/preflight-analyze/config.json`
does not exist on this machine, and `/preflight-analyze` Step 0 says to stop when it is missing. The
rows written are identical and the credential is narrower (DML on `app`, nothing in `public`); every
affected `analysis_runs.detail` records the substitution. **The config is still the documented path
— set it up before the real term.**

---

## 2026-07-27 — Matthew Recker via Claude (faculty beta feedback — fifteen changes across grading, the assignment editor, and course administration)

A faculty beta produced a list of small, concrete complaints. They are grouped below by the screen
they were made about. Nothing here is a schema change: `app` DDL is sealed (CORE.md §0), and two
retirements (`review_signoffs`, the `grader` role) are therefore **UI withdrawals** — the table and
the CHECK constraint are untouched and existing rows keep working.

**Not yet deployed:** `supabase functions deploy create-instructor reset-staff-password`. The two
edge functions are written and committed; until they are deployed, adding staff still demands a
password (and rejects the request without one) and the staff reset button returns a 404. Everything
else is static site code and is live on push.

**Verification is Node-only, and CORE.md §2 says to say so.** What ran: the full `tests/app-schema`
suite (one pre-existing live-DB failure, `bootstrap returned a context`, unrelated and present on
`main` before this), a `node --check` pass over every changed module and every page's module script,
plus two throwaway static passes — every `getElementById('literal')` resolves to markup that exists,
and every `NS.member` on a changed page resolves to a real export. **No browser walkthrough was
done.** So the logic is verified and the *rendering* is not: the new add-student and add-staff
modals, the date+time pair in the assignment editor, the Grade page with its sign-off bar and
interactive cards removed, and the per-lesson due-out boxes have never been looked at. Someone with
a faculty login should open each before the next teaching day.

### Grade page

- **Interactive takers are no longer listed.** They were rendered as a read-only card marked
  *Interactive*, explaining that their effort grade came from the lesson report. Accurate, and in
  the way: a card that cannot be graded, in the middle of a screen for grading, for a student
  migration 015 already finalized on commit. Faculty were re-identifying and skipping the same four
  cards on every pass. They are filtered out in `loadView()` — at the source, so `render`, save,
  finalize and the finalize-scope message cannot disagree about who is in scope — and a one-line
  note says how many were left out, so the count still reconciles with the roster. A *draft* (no
  choice committed) still appears; that student may yet take the written path.
- **"— all my sections —" now means the sections you teach.** `mySectionIds()` returned
  `ctx.sectionIds`, which is correct for an instructor and wrong for a director: their
  offering-wide staff row makes `staff_sections()` every section, so the filter loaded the entire
  course — byte-identical to the "All sections (entire course)" option beside it. It is
  `actionableSections()` now, the same predicate the dashboard's due-out row and the grading queue
  already used. A director who teaches nothing still falls back to the whole course, because an
  empty page reads as "nothing to grade".
- **"Mark section reviewed" is gone, with `review_signoffs`.** It assumed an instructor reviews and
  a *director* publishes. There is no second person — `grades_staff_write` has always admitted any
  staff member of the sections loaded, so Finalize & publish releases your own sections and nothing
  else. The attestation was a note to oneself one click from the button that actually releases
  grades. The button, its modal, the pill bar and four functions are removed; the table and its
  rows are intact and documented as retired.

### Dashboard

- **One due-out box per assignment, deep-linked.** "9 · Review grades" was three lessons' work in
  one number, linking to a Grade page that took no assignment parameter — so it landed on an empty
  picker and the reader re-derived which three. A task source may now return an array; `to-grade`
  and `ai-unfinalized` emit one entry per lesson (`4 · Review · Preflight 3`) linking to
  `grade.html?a=<offering>`, which the page consumes on first load. Past **six** lessons they
  collapse back to one summary box — six named lessons is a worklist, sixteen is wallpaper.
- `pastDueUngraded()` now excludes interactive takers, so the number on the box matches what the
  page it links to actually shows.

### Assignment editor

- **The Grading dropdown is withdrawn.** *Points (per question)* / *Effort (0–5 → points)*
  described a mechanism that stopped being real in migration 014: `grades_points_from_effort()`
  keys on whether the grade ROW carries an effort, not on the column, which is exactly what lets
  one offering grade an interactive taker by effort and a written taker by points simultaneously.
  The control could read *Effort* over a points-graded assignment and change nothing. Offerings are
  written `grading_mode: 'points'` explicitly — the column is `NOT NULL DEFAULT 'effort'`, so
  omitting it from an INSERT would have created effort-mode rows.
- **Q2 (the reading reflection) has a Points box.** It has always been worth 1 and always will be
  by default; the value was simply invisible and unreachable, so a director wanting a 2-point
  reflection had no way to say so or to discover what the number was.
- **Deadlines carry a time.** A date + time pair per meeting day, the time defaulting to 23:59. Two
  boxes rather than one `datetime-local` because that control cannot express "default to 11:59 pm
  for the date selected" — it yields empty or midnight, so the common case would mean typing 23:59
  on every row.

  **This fixed a live bug nobody had reported.** `endOfDay()` returned the naive string
  `'2026-08-24T23:59:59'`, and Postgres resolves a `timestamptz` literal with no offset against the
  session zone — UTC on Supabase. Every deadline set in this editor was therefore enforced at 16:59
  Denver, and the cadets who lost the evening had no way to see why. It now converts through a real
  `Date` (local → UTC), with `toEditorDue()` as its inverse for loading. Fall 2026 is unaffected:
  those deadlines came from `build_fall_preflights.py`, which does the `zoneinfo` conversion CORE.md
  §2 requires. A bare date still means 2359, so every stored deadline and the frozen `due_m=`/`due_t=`
  prefill contract keep meaning what they meant.

### Course administration — students

- **+ Add student**, for the cadet who transfers in during week three. Search first: an existing
  cadet is *enrolled*, not edited — silently rewriting a name the operator never compared is what
  the import's review step exists to prevent.
- **Adding an existing cadet merges; it does not duplicate.** `students` is keyed on the cadet ID
  and `enrollments` attaches them to a section, so one person taking both courses is one record
  with two enrolments. This was already true of `commitRoster()`; it is now stated on the screen
  and in the help doc, because this is where somebody will wonder. It holds even for a cadet the
  search cannot see (RLS exposes students only through sections you staff) — their cadet ID still
  merges onto the record that exists.
- **Accounts provision themselves.** Both the import and the individual add call
  `provision-students` afterwards. It is idempotent (`auth_user_id IS NULL` only), so this is cheap
  and safe. The manual button stays, because a cadet with no email address is deliberately
  *skipped* and that needs a visible retry. Provisioning on *first login* — the other half of the
  question — is not possible: signing in IS the account, so a cadet without one cannot reach a page
  to trigger anything.

### Course administration — staff

- **The Sections column lists only what is assigned**, and is headed *Teaches*. It printed "All
  sections" for anyone holding an offering-wide row — every director, and everyone "+ Add staff"
  had ever created — while the coverage grid twenty pixels below showed the same people on one
  section each. They were answering different questions (what may I *see* vs what do I *grade*);
  only the second belongs in that column. The per-person "Sections" tick-box modal is removed with
  it: the grid has done that job since P1.10, and two controls writing one fact is how they
  disagree.
- **The `grader` role is retired.** "Grades only, no authoring" — but authoring is gated on
  *director* everywhere it is gated at all, so it granted exactly what `instructor` grants. A third
  option that changes nothing is a question the director has to answer every time. Existing rows
  render as *Grader (retired)* rather than being relabelled, because a control that misreports the
  row it sits on is how P0.15 happened.
- **Add staff can add somebody who already has a login.** The modal only ever created accounts, so
  adding a colleague from the other course meant a second identity — and grades, extensions and
  unlocks are attributed to `instructors.id`, so their history would split with no way to rejoin
  it. One `staff_assignments` row; `staff_write` already admits exactly the caller who may do it.
- **No more typed temporary password.** The field was pre-filled with the literal `prep-temp-2026`:
  one shared credential across every account anybody accepted the default for, with nothing forcing
  a change. `create-instructor` now derives **last name + `1234`** and sets
  `must_change_password`; `reset-staff-password` (new) restores the same default.

  **This reverses a standing decision, and only its premise changed.** Staff recovery was
  deliberately unbuilt on the grounds that an instructor account had no derivable default, so a
  reset would mean one person *choosing* another's credential — and whoever knows a colleague's
  password is indistinguishable, at the database level, from that colleague, including for grade
  finalization. That argument is about *choosing*, and it still holds: no password parameter exists
  in either function, and one arriving at the reset endpoint is refused rather than ignored. What
  changed is that a default can now be *derived* from a name the director is already looking at,
  which is the same bargain cadets have always had. The other half is what makes it safe at all:
  the account is flagged, so the shared-knowledge default survives exactly one sign-in. Neither
  half works alone.

  `reset-staff-password` is deliberately narrower than the student equivalent: **directors and
  system admins only**, where the cadet reset admits any staff member. The cadet is locked out
  today and standing in front of whoever teaches them; a colleague is not, and the account being
  reset can publish grades. A director cannot reset a system admin, mirroring `remove-instructor`.
- **Forced rotation now covers faculty.** `auth.js` already redirected both roles — what was
  missing is that nothing ever *set* the flag on a staff account. Both functions set it, and the
  account page's copy is role-aware.

### Tests and docs

- `tests/app-schema/test-lesson-due.mjs` (new, 34 checks) — the deadline round trip through a real
  timezone, back-compatibility of bare dates, and the staff password rule. Its last block reads the
  two edge functions as text and asserts they still derive the password identically: three copies
  exist because a Deno function and a browser module share no import path, and a drift between them
  is an account nobody can sign into.
- `test-tasks.mjs` — array-returning sources, id uniqueness, zero-entry dropping, deep links.
- `test-grade.mjs` — `mySectionIds()` for a director who teaches some, all, and no sections.
- Six indexed documents re-checked and corrected against these changes: `instructor-grading.md`,
  `instructor-accounts.md`, `admin-system-operations.md`, `director-schema-reference.md`,
  `SYSTEM_GUIDE.md`, `student-getting-started.md`. Two carry explicit correction notes where the
  old text was *accurate about a bug* — the Grade page's section scope, and staff having no
  derivable default.

## 2026-07-27 — Matthew Recker via Claude (training sandbox seeded with fake student work for lessons 03 and 04)

**Live DML on `app`, training sandbox only.** 140 synthetic submissions written into the
phys-215 × `training-fall-2026` offering (`ce946b19-…`) so instructors have something to practise
grading on. New script `scripts/training/seed_training_lessons_03_04.py` — dry-run by default,
`--commit` to write, `--clean` to remove (snapshots first).

This is the `app`-schema successor to `scripts/training/seed_training_preflight02.py`, which seeds
the retired `public` model and is left alone.

### Why these two lessons, and why the data differs between them

The two lessons are wired to **opposite graded paths** in this offering, which is what makes the
pair worth seeding — between them they exercise both halves of the pipeline:

| lesson | graded path | practice path | seeded work | how it gets a grade |
|---|---|---|---|---|
| `preflight-03` | **written** | interactive | q1/q2/q3 free-response answers | `/preflight-analyze` |
| `preflight-04` | **interactive** | written | short artifact reports (`report_markdown` + `schema:1`) | migration `015` trigger, on commit |

70 submissions each, out of a roster of 80. **2–3 non-submitters per section**, chosen per lesson
so the same cadets are not missing from both. `ZZ Test Cadet` is deliberately left without a
submission in both, counting toward M1A's quota, so the browser-walkthrough account stays free for
a live end-to-end submit.

### Two things the script gets right that are easy to get wrong

- **Write order.** `grade_interactive_on_commit()` reads `submission_activities.content` at the
  moment a submission flips to `committed`. So each student is written the way the browser writes
  them (`student-data.js`): insert the submission as a **draft**, insert the work, *then* commit.
  Committing first fires the trigger against a missing report and leaves the cadet silently
  ungraded.
- **The offering guard.** The clean Fall 2026 phys-215 offering shares the course, so the script
  refuses to run against any offering whose term label does not contain `TRAINING`. A mistyped id
  cannot seed fake work into the real term.

Verified after commit: preflight-03 → 70 committed submissions, **0** grade rows (correct — it
waits for grading); preflight-04 → 70 committed submissions and **70** auto-graded rows, all
`source='derived'`, `is_finalized=true`, with effort→points landing exactly on the contract's
table (effort 2 → 1 pt ×3, effort 3/4/5 → 2 pts ×67). No submission is late against its section's
per-day deadline.

**The data is fake and says so.** Every `schema:1` payload carries
`source_provenance.generated_by = "seed-training-lessons-03-04@2026-07-27"`, and each report's
Markdown ends with a line stating it is synthetic.

---

## 2026-07-27 — Matthew Recker via Claude (per-day deadlines; phys-215 split into a training sandbox and a clean Fall 2026 offering)

**Live DDL + live DML on `app`.** Migration `017` applied, and the phys-215 offering split in two.

### The bug this starts from

A section created **after** the lessons were scheduled had no deadline of its own. Per-section
deadlines live in `assignment_due_dates`, and those rows are written **only** when a director saves
that lesson in the editor — so a new section fell through to `assignment_offerings.due_at`, which on
every Fall 2026 row is the **M-day** date. **A newly imported T-day section was therefore silently
one day early on all 37 lessons**, with no error and nothing to notice.

It was about to matter: `createSections()` — the path a **roster import** uses — wrote
`meeting_days: []`, and an empty meeting pattern is invisible to the whole deadline system. The
editor then renders one plain date box and states *"Sections in this term declare no meeting days,
so one deadline applies to everyone"*, reporting the broken state as a normal configuration. So the
next roster upload into a fresh offering would have produced exactly this.

Two things the director's framing corrected, and they were right both times: **moving a student
between sections was never affected** (the lookup is keyed on their *current* section), and
materializing the rows buys **no** historical accuracy, because lateness is computed live at read
time (`schema.js` `submissionLateness`). The rows are a cache that can go stale.

### What changed

- **Migration `app/017_due_by_day.sql` (applied).** `assignment_offerings.due_by_day jsonb` stores
  the per-meeting-day schedule — `{"M": …, "T": …}`, keyed by the letters in `sections.meeting_days`,
  **not** hardcoded to M/T, so a course meeting W/F needs no change. Backfilled from the rows that
  exist: 37 offerings filled, 37 left `{}` (phys-110, which has no sections to derive from).
  A CHECK pins it to a JSON object.
- **New precedence, `schema.js`:** extension > explicit per-section row > **per-day schedule** >
  offering default. `resolveDueBySection()` folds level 3 in **at load time**, which is what let all
  six `effectiveDue()` call sites stay untouched instead of each growing a `meeting_days` argument.
  `effectiveDue` reports the new source as `'day'`. Wired into all 8 shaping sites; `ctx.sectionsById`
  already carried `meeting_days` for students and faculty alike, so this costs **no extra query**.
- **`assignment_due_dates` is now an OVERRIDE, not the normal path** — which is what it should
  always have been: the deliberate cancelled-class exception (ROADMAP P3.17's one legitimate case).
- **`createSections()` derives `meeting_days` and `period` from the section code** — `M1A` → `['M']`,
  period 1. **A default, not a rule**, and the distinction is the whole point: `isMDay()` and
  `dueDateForSection()` were deleted from `util.js` precisely because they sniffed the code at *read*
  time. This writes a visible, editable value once and never consults the code again. An
  unrecognised letter yields `[]` rather than an invented day. Moved to `roster-import.js` so it is
  testable without a browser shim.
- **The editor persists `due_by_day` on save**, dropping the `_all` placeholder key the UI invents
  when no section declares a meeting day — storing it would create a key no section can match.

### The offering split

`scripts/fall2026/split_training_offering.py` (dry-run by default, `--commit` to write, snapshots
first). The 81 students in phys-215 are **seeded, not real** — names like `Amara Larsen`, and
`email IS NULL` on every row, so none of them could even be provisioned an account.

- New term `training-fall-2026`, labelled **TRAINING SANDBOX — Fall 2026**, dates copied from
  `fall-2026`. The **existing** offering was repointed at it: one `UPDATE`, and nothing moved —
  sections, enrollments, submissions, grades and analysis runs all hang off the offering id.
- **Why a term and not a flag:** `course_offerings` has no name column and is
  `UNIQUE (course_id, term_id)`, so two phys-215 offerings cannot share `fall-2026` and there is
  nothing on the offering to rename. The **term label** is what the UI shows (`nav.js` groups the
  course switcher by it). `is_active` was not an option — `auth.js` selects it and never filters on
  it, so it hides nothing. **That column is decorative today; treat it as such until it is wired.**
- New clean phys-215 × `fall-2026` offering `b9e6b3da-776e-4a8f-8355-e107bea63f9a`: 37
  `assignment_offerings` (with `due_at` **and** `due_by_day`) + 42 `offering_activities` pointing at
  the **same shared activities**, and 8 offering-wide staff rows. Verified in-transaction to hold
  **zero** sections, enrollments, submissions and grades before committing.
- **No sections were created, on the director's instruction** — the roster import makes them. That
  is only safe *because* of the two changes above; before them every imported T-day section would
  have been a day early. The ordering was deliberate.
- `PREP Test Faculty` stays **training-only** and is being kept, not deleted — so ROADMAP **P0.2 is
  now the seal alone**. Adding it to the real offering is one click in Staff if wanted.

### Verification

`tests/app-schema` **371 passed / 1 failed** — up from 347, and the single failure is the
pre-existing unrelated one (`found an offering with two graded activities`, ROADMAP §5). 24 new
checks: the derived T-day deadline, the explicit row still winning, extension still outranking a
derived date, a malformed `due_by_day`, non-mutation, and **the counterfactual that without
`due_by_day` the same section lands on the M-day date** — the bug itself, pinned. `gen_db_schema.py
--check` green after regenerating.

**Docs corrected, not merely re-dated.** `SYSTEM_GUIDE.md`'s "Starting a New Semester" told the
reader to run `TRUNCATE TABLE scores; TRUNCATE TABLE responses; DELETE FROM students;` — written
for legacy `public`, where a term and the course were the same rows. In `app` that destroys live
data to accomplish nothing, and it is the opposite of how the rollover just happened. Rewritten
around "a term is a row". Also `instructor-grading.md` (the three-step deadline), plus
`instructor-accounts.md` and `admin-system-operations.md` (imported sections get a meeting day, and
when to correct it).

**⚠ `prep_app_owner` is STILL unsealed** — 017 was applied through the door 014/015 left open.
`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres` remains outstanding (P0.2, human-only).

---

## 2026-07-27 — Matthew Recker via Claude (migration `app/016` applied — comment spelling)

**DDL applied to live `app`.** `supabase/migrations/app/016_comment_spelling.sql`, run as
`prep_app_owner` at the director's instruction. Four `COMMENT ON TABLE` statements —
`ei_sessions`, `enrollments`, `grades`, `submissions` — now spell **enrollment**. No columns, no
policies, no data, no behaviour.

This closes the 2026-07-23 sweep properly. That sweep corrected four copies of this text inside
`site/app/js/db-schema.js` — a generated file — instead of the source, which is why
`gen_db_schema.py --check` went red and stayed red. The file was regenerated on 2026-07-27 (back to
`enrolment`, matching live); this makes the correction real at the source so the next regeneration
keeps it.

**No unseal was required, and that is worth stating plainly:** `prep_app_owner` was **already
`LOGIN`** — unsealed for migrations 014/015 on 2026-07-23 and never re-sealed, as five prior
CHANGELOG entries flagged. Verified by connecting before running anything. The migration's own
header claims the role is `NOLOGIN` and that it is waiting for a window; that header was stale.
**The role is still unsealed. Re-sealing remains outstanding and is human-only** —
`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres`, folded into roadmap P0.2.

Verification, in order: read the four comments before (all `enrolment`) → apply → read back (all
`enrollment`) → `gen_db_schema.py --check` **red**, correctly, since the generated file was now
stale → regenerate → **green**. The regenerated diff is exactly 4 lines, all comment strings.
`tests/app-schema` 347/1.

**⚠️ That one failure is pre-existing, unrelated, and worse than a red check looks.**
`test-student.mjs` reports `found an offering with two graded activities` — its `else` branch,
meaning it could not find a fixture rather than that something is broken. It is independent of this
change (the file imports only `harness.mjs`; nothing in its path reads `db-schema.js`), and the data
is not the problem: **34 published offerings carry two graded activities**, verified live. The
selection path is. What that `if` gates is the security half of the file — a student cannot unlock
their own commit, cannot attribute an unlock to an instructor who did not perform it, cannot reopen
a commit by reverting `status` — the two bypasses migration 006 closed. **Those assertions are
currently running nowhere.** Filed in ROADMAP §5.

*Worth keeping:* a migration file's own header is a claim about the world, written once and never
re-read. This one said the door was locked; the door had been open for four days. Check the state
before trusting the note that describes it — the same failure mode as the stale roadmap entry
corrected earlier today.

---

## 2026-07-27 — Matthew Recker via Claude (sixth-batch UI verified on the live site; P0.2 unblocked)

**Documentation only. No code, no schema, no data.**

The director walked the 2026-07-23 batch on the deployed site and reports it works. That retires the
verification debt `ROADMAP.md` §7 had been carrying in two places — the "one thing still owed, and
it is now owed twice" paragraph, and the ⚠️ gap note on the P1.1/P1.2/P1.4 entry. Both named the
same two surfaces, and both are confirmed: the Course Admin coverage grid's **drag-and-drop** and
the merged **Students tab** (now the only route to a roster import).

**The consequence that matters is an ordering one.** Both notes required
`tests/browser-harness/pass.mjs` to run **before P0.2 deletes the test faculty account**, because
re-minting that account needs a human in the Supabase dashboard — the thing that made P0.5 take
three attempts. That constraint is dropped. P0.2 can now run whenever P0.1 is done, and the P0 path
is: apply migration `016` while `prep_app_owner` is still unsealed → run the cutover → seal and
delete the account.

**One item deliberately does not close.** The Grade queue has still never been seen against
genuinely **late work**, because nothing in the term is late yet (the active preflight is due
Aug 9). Recorded as a data blocker, not a looking blocker — no walkthrough can fix it and it
re-checks itself in week one. Same for EI bulk logging, which has no real data either.

*Worth keeping:* the roadmap assumed this verification had to arrive as a harness run, and it did
not. `tests/browser-harness/` exists to catch what a human misses — a console error on a page that
renders fine, a request 404ing quietly — which is a **narrower** claim than "a person used this and
it worked", not a stronger one. Walking the deployed site is also the better environment, since
`site/app/` has been live against schema `app` since 2026-07-21. When a doc names a specific tool as
the way to close a gap, check what the gap actually is before treating the tool as the only key.

---

## 2026-07-27 — Matthew Recker via Claude (P0.15 staff roles verified — no repair was needed)

**Read-only against live `app`. Nothing was written.**

The director confirmed the intended roles for the two records P0.15 flagged as corrupted:
`Kimberly de La Harpe` → **instructor** in phys-215, `TJ Hardy` → **director**. Live already
matches both, so no change was applied.

- **Kim** holds 3 `staff_assignments` rows — offering-wide, T1A, T3A — **all `instructor`**, so
  `director_offerings()` does not return her.
- **TJ** holds 3 rows — offering-wide, M1A, M3A — **all `director`**.
- Neither is `is_global_admin`; neither holds any row in phys-110.

Somebody re-selected both roles in Staff after the 2026-07-23 fix landed, which was the remedy the
roadmap proposed. The fixed `setRole()` updates every row a person holds and then guarantees the
offering-wide one, which is why the result is uniform rather than half-repaired.

**Swept the whole database for the corruption signature — no staff member holds more than one
distinct role within a single course.** The query is recorded on P0.15 and is worth re-running after
any bulk staffing change.

*Worth keeping:* the roadmap asserted a live-data defect for four days after it had been repaired. A
recorded data defect is a claim about the *present*, unlike the rest of that file, and it goes stale
silently — the repair happens in a UI that does not know the roadmap exists. Verify before acting on
one, which is the only reason this entry is not a privilege change made on stale information.

---

## 2026-07-27 — Matthew Recker via Claude (cleanup batch: the extensions bug, the doc-sources red, P1.12 descoped)

Roadmap §5 cleanup. **No live data touched, no DDL applied, no schema change.** One migration file
is added and deliberately left unapplied.

### Fixed — the dashboard ignored extensions, and could not have been tested

`faculty-data.js` called `effectiveDue(offering, sectionId, **null**)` with the extension argument
hardcoded, so a cadet holding an active extension read as `overdue` on the faculty dashboard, in the
outstanding-tasks panel, and in the due-out row — for work that was not late. `faculty-grade.js` and
`faculty-gradebook.js` both did it correctly; this was the one caller that did not, and
`faculty-gradebook.js`'s own header cited the bug as its reason for not reusing this loader.

The loader now fetches `extensions` in the same chunked pass as submissions and grades — three
columns, filtered `revoked_at IS NULL`, because a revoked extension is not an extension and
filtering is the caller's job.

**The repair that matters is the extraction, not the argument.** The rule lived inside an async
loader that needed a faculty session, so no test could reach it — which is why it survived being
found *twice*, months apart, and fixed neither time. It is now a pure exported
`buildLessonRows()`, and `tests/app-schema/test-dashboard-rows.mjs` pins it with 12 checks
including the counterfactuals that would otherwise pass vacuously: an extension whose own date has
expired, one belonging to a different offering, one belonging to a different student, and the
baseline `overdue` without which the other three prove nothing.

`faculty-gradebook.js`'s header comment is corrected: the two loaders still stay separate, but on
payload size (it pulls every report blob and every `question_scores` for the whole roster), not on
correctness.

### Fixed — a generated file had been hand-edited, and the check that catches that was red

`site/app/js/db-schema.js` reads **"GENERATED FILE. Do not edit by hand."** The 2026-07-23
`enrolment` → `enrollment` sweep edited four strings inside it. Those four are copies of Postgres
`COMMENT ON` text, so the sweep corrected the copy and left the original — and
`gen_db_schema.py --check` correctly reported the file as stale from that day on. It was the single
failing check in `tests/app-schema` (358/1); the suite is now green.

Regenerated, so the file matches live again and reads `enrolment`. The real correction is filed as
**`supabase/migrations/app/016_comment_spelling.sql` and is NOT applied**: `COMMENT ON` is DDL,
`app` is sealed (CORE.md §0), and four comment strings do not justify unsealing `prep_app_owner`.
Fold it into the next window that opens for another reason, then regenerate and commit the result.

*Generalize:* a spelling sweep that matches on a word will hit generated files, and a generated file
is the one place where being right about the text is being wrong about the source.

### Fixed — `check_doc_sources.py` cleared by reading all seven, and the sources were wronger than the docs

Five of the seven flagged documents were wrong and were **rewritten**; two (`help/README.md`,
`.ai/skills/docs-author/SKILL.md`) were current and had their `reviewed` date bumped. Reading them
against their sources found the sources at fault more often than the documents:

- **`CORE.md` said schema `app` was "built, tested, not yet wired to any page."** Every page under
  `site/app/` has read it since 2026-07-21 (`config.js` binds `db: { schema: 'app' }`). The row now
  says both schemas are live and the distinction is which URLs reach them. This one error is also
  why **`PREP-V2-CUTOVER.md`** still announced itself as "not yet executed against the live
  database" when Phases 1–3 are done — a runbook telling its reader the schema does not exist yet.
- **`PROJECT.md` listed `misconception_trends` as a live output.** It was retired 2026-07-22 and
  nothing writes or renders it. Worse, its `analysis_reports` example put `readiness_summary` on a
  *section* scope, which the writer now **rejects as a validation error** — the summary is written
  per *instructor*, across every section they teach, and there is a third scope kind the example did
  not have.
- **`PROJECT.md` said a locked-out cadet asks "any instructor of their section, who restores the
  default from the Roster page."** The Roster page was folded into Course Admin → Students on
  2026-07-23, and the page carrying that control has *always* been director-gated, so an instructor
  has never had the button. (`instructor-accounts.md` was corrected on 2026-07-23; PROJECT.md was
  not, and `student-getting-started.md` still told cadets their instructor could do it.)

Correcting the two sources cascaded to four more help docs, which were read as well rather than left
for the next person:

- **`ai-and-your-work.md` (student-facing) promised "nothing reaches you until a person has looked
  at it."** Migration 015 made a graded interactive lesson grade itself, finalized and visible, with
  no review — so the page most likely to be quoted back at us was wrong about the one thing it
  exists to promise. The identical claim was caught in `instructor-grading.md` on 2026-07-23 and the
  student page was missed, which is the pattern worth noticing: a policy change gets chased through
  the staff docs and stops there.
- **`director-ai-rules.md`** stated "A human finalizes every grade" as a bright line, and described
  effort→points as depending on an assignment-level `points`/`effort` setting with the analysis run
  applying the scale. Migrations 014 and 015 made all three false. The exception is now stated
  explicitly rather than left implied, with the reason it is acceptable (no judgement is delegated —
  a 0–5 effort score and a fixed rule).
- **`director-schema-reference.md` told a director that moving an assignment to `grading_mode =
  'effort'` was "a teaching decision rather than a settings change."** That is the exact change
  roadmap P0.14 identifies as silently rewriting every *written* taker on the assignment to **0
  points**. It now says do not touch the column and why. **This doc could never have been flagged:
  its source list stopped at migration `013`, and the semantics changed in `014`.** `014` and `015`
  are now indexed against it — a stale index entry is a check that reports all-clear on a document
  nobody is watching.
- **`student-getting-started.md`** — password reset routed to the wrong person; corrected, and
  phrased so a cadet still asks their instructor first.

Also fixed while in there:

- **`SYSTEM_GUIDE.md`** told anyone deploying from scratch to deploy **two** edge functions. There
  are five; the missing three are account provisioning and both password paths, so the failure would
  surface as cadets unable to sign in. It also described aggregation as one run over the whole
  class — it is per day track, like grading.
- **`admin-system-operations.md`** described migrations as one numbered directory (there are two
  independent chains, and the v2 one needs a human to unseal a role), and listed "section creation"
  as a start-of-semester step. Sections have no create/rename/retire control anywhere:
  `createSection()` is exported from `faculty-roster.js` with **zero callers**, and sections are
  really created as a side effect of the roster import.
- **`docs-author/SKILL.md`** said "the five existing docs are stubs" and "every current help doc"
  carries the marker — there are 8 served docs and 3 stubs. Its verification steps also never
  mentioned `check_doc_sources.py status --write`, so a new doc could be registered while leaving
  the reader-facing staleness banner asserting a review that did not happen.

**`site/app/help/DOC-STATUS.json` still needs regenerating after this lands** — it is built from
committed history, so it cannot be refreshed before the commit exists. Run
`python scripts/docs/check_doc_sources.py status --write` and commit the result.

### Changed — P1.12's whole-section extension half is descoped, not deferred

At the director's call: a section-wide event is a **due-date change**, not 18 per-student
exceptions to a date that is no longer the real date; a single section receiving a genuine blanket
extension is not an expected event; and the rollup's select-all already reaches everyone in a
section who has a reason to want one. Moved to **P3.17** as parked-with-a-falsification-condition,
and P1.12 moves to §8 completed. **P1 is now empty.**

*The item read as one feature with two halves and was two features with one name.* The tell was
that the second half had no natural home — it kept being described as belonging to a page that does
not grant anything.

### Verification

`tests/app-schema/run.mjs` green — **359 offline checks plus every isolated suite**, up from 358
with 1 failing. `node --check` on both changed modules; both JSON indexes re-parsed; the six edited
help docs linted for front matter (the Jekyll trap) and raw HTML.

**Not verified in a browser.** Per CORE.md §2 that is stated rather than glossed: the help-doc
changes are content and the code change has a targeted suite, but nothing here has been seen
rendered by a signed-in user. That debt is now owed for three batches — see the roadmap §7 note
about running `tests/browser-harness/pass.mjs` **before** P0.2 deletes the test faculty account.

---

## 2026-07-23 — Matthew Recker via Claude (roster folds into Course Admin · `enrolment` → `enrollment`)

Two corrections to the batch below, both the director's call.

### Changed — Roster and Enrollment are one tab of Course Admin

The entry below split them into two standalone pages. **Both are deleted.** Everything they held is
now `site/app/faculty/admin.html` → the **Students** tab, beside Staff and Export: the roster table
with a search box, the registrar import and its reconciliation, account provisioning, section
placement, and the password reset.

The split's reasoning was not wrong — a destructive bulk import should not head the page you open to
check a squadron number, which is why the roster table is first here and the import sits in a
collapsed panel below it. What it got wrong was the **cost**: two more nav entries for one job. The
nav bar is the scarcer resource, and Course Admin was already where a director went to manage the
offering. A roster is one more thing about the offering.

Nav loses both entries. `admin.html` is the only one, and stays director-gated.
`test-nav.mjs` now asserts the bar's shape and that **every href resolves to a file that exists** —
the failure mode of any page merge. `faculty-student.js`'s back-link allowlist follows the move.

> **⚠️ A claim in the help docs turns out to have been wrong all along, and it is corrected rather
> than carried.** `instructor-accounts.md` said *"any instructor assigned to the course can [reset a
> cadet's password], not just the course director"*. The edge function really does admit any staff
> member of the offering — but **no page has ever offered them the button**, because the only page
> carrying it has always been director-gated. Nothing regressed today; the doc was describing an
> intention. If lockouts start costing a day, the fix is a read-only Students tab for instructors,
> not a password field.

### Changed — `enrolment` → `enrollment` everywhere it is not a frozen record

American spelling, as asked. British spelling had leaked into ~50 files' comments, prose, and local
variable names while the database column has been `enrollment_id` all along — so the code disagreed
with the schema it was reading. Normalized across `site/`, `tests/`, `scripts/`, `supabase/admin/`,
`supabase/functions/`, `.ai/`, and the live `docs/` (ROADMAP, architecture, operations).

**Deliberately not touched, so the remaining hits are not mistaken for misses:**

- `docs/decisions/` and `docs/contracts/` — point-in-time records and frozen interfaces, superseded
  rather than refreshed (CORE.md §5).
- `supabase/migrations/**` — an applied chain. The file on disk should match what was executed,
  comments included.
- Historical `CHANGELOG.md` entries — this is the audit trail; today's entries are written correctly
  and the older ones stay as they were said.

Verified: `node --check` over every shipped module, all 21 inline page modules, `py_compile` over
every tracked Python file, and the full offline `tests/app-schema` suite green.

---

## 2026-07-23 — Matthew Recker via Claude (roadmap P1.8 · P1.9 · P1.10 · P1.11 · P1.14)

Five roadmap items, frontend only. **No DDL, no migration, no live data touched.** Verified by the
`tests/app-schema` suites (all offline suites green; ~90 new assertions across
`test-grade.mjs`, `test-schema.mjs`, `test-tasks.mjs`, `test-ei.mjs`, `test-nav.mjs`) plus a
`node --check` pass over every changed module and every changed page's inline module.
**Not seen in a browser** — see the caveat at the end.

### Changed — the Grade tab: a queue replaces the "Late only" filter (P1.14)

The **"Submitted late" filter is removed** (it shipped 2026-07-22 as P0.12; the director asked for it
back the next day). It answers the wrong question — an instructor does not want a section narrowed
down to its late work, they want the short list of what needs a human. The amber late **chip** on the
grade card stays; it is context while grading and was never what was objected to.

In its place, an **open strip of cards above the grading view**, one per student per assignment
(`site/app/faculty/grade.html`, `.gq-*` in `styles.css`). It replaced two collapsed `<details>`
worklists that counted at *assignment* granularity — "3 outstanding on preflight-02" is a number, not
a name. New `buildGradingQueue()` (pure) + `gradingQueue()` in `js/faculty-grade.js`; the superseded
`extensionsToGrade()` is deleted, `pastDueUngraded()` stays (the dashboard still uses it).

Four rules, each pinned by a test:

- **Interactive takers never appear** — migration 015 grades them on commit, so there is nothing to
  do, and a queue listing phantom work stops being opened.
- **An undecided submitter does** — nothing chosen yet means they may still take the written path.
- **Late beats extension-expired** when both hold; a blown-through extension is more usefully late.
- **Scoped to the sections you teach** (below).

**Clicking a card opens that student's answers**, switching the assignment picker and widening the
section picker first when the reader had narrowed to a section the student is not in — otherwise the
card it means to reveal is simply not in the DOM.

### Changed — Grade left the nav bar (P1.14, director's request)

Grading is not a place you browse to, it is work that arrives. `grade.html` is unchanged and still
reachable — from the dashboard's due-out boxes, the queue, the gradebook, and by URL. **The due-out
row therefore carries a standing `Grade page →` link in both states, including the empty one**: the
boxes render nothing when nothing is outstanding, so without it the day an instructor is caught up
would be the day the page has no route to it. `test-nav.mjs` pins the absence; `test-tasks.mjs` pins
the link.

### Fixed — the dashboard's due-out row was counting the whole course as "yours"

Found while building P1.8, and **this is the entry worth reading twice.** A director's
`staff_assignments` row carries `section_id IS NULL`, which `app.staff_sections()` expands to *every*
section of the offering — so `ctx.sectionIds` for a director is the whole course, and "9 · Review
grades" under a heading reading **Needs your attention** was counting nine other instructors'
ungraded submissions.

New `actionableSections()` in `js/schema.js`: taught ∩ visible, **falling back to visible** so a
director who teaches no section gets the course-wide list rather than a permanently empty panel. The
row now states which scope it is showing. `taughtSectionIds()` moved from `js/faculty-rollup.js` to
`js/schema.js` (re-exported, so `report.html` and `gradebook.html` are untouched) — three surfaces
need it now and none should pull 56 KB of aggregation maths into the browser to ask about `ctx`.

### Added — extra-instruction panel on the faculty dashboard (P1.8)

`renderEiPanel()` in `js/faculty-ei.js`, pure, rendered against the `summarizeEi()` P1.4 already
shipped — a render, not a second query. **Sittings is the headline, not the row count**: a batch of
six cadets after class is one session, and reporting forty sessions for a week that held nine is how
a dashboard stops being believed. The row count survives as "cadets seen". **Nothing logged renders
nothing at all**, matching the due-out row's rule.

Deliberately *not* registered as a `SOURCES` entry, which the roadmap suggested: that registry's
shape is a count plus an imperative, and EI is neither outstanding nor actionable — it would have
printed "12 · Extra instruction" under *Needs your attention*, which is false.

### Changed — Enrollment is its own page; Roster is open to instructors (P1.9)

New **`site/app/faculty/enrollment.html`** (director-gated): registrar import and reconciliation,
account provisioning, and section placement grouped by section. A re-mount, not a rewrite —
`js/roster-import.js` was already pure and DOM-free and none of its logic changed.

**`roster.html` is now visible to any staff member of the offering.** It was director-only *because*
it also held a destructive bulk import; what remains is a lookup table with a search box, scoped to
`ctx.sectionIds`. The student password reset stayed — `reset-student-password` derives the default
from the cadet ID and rejects a chosen one, so it reveals nothing an instructor was not already
looking at. `loadRoster()` gained an optional section scope for this.

Roster's **"Sections" tab is gone** rather than moved — it was the assign-an-instructor UI that P1.10
replaces. `loadSections()` and `assignInstructor()` are deleted with it. Worth recording:
`assignInstructor()` deleted every `role='instructor'` row for the section before inserting, so a
section could hold exactly **one** instructor. Nobody stated that rule, co-teaching is ordinary, and
the replacement does not reproduce it.

### Changed — Section Coverage assigns staff, by drag or by dropdown (P1.10)

On Course Admin's coverage grid (`site/app/faculty/admin.html`), where "who covers M1A" was already
being asked — previously answerable only by opening six people's modals in turn. Drag a name chip
onto a tile, **or** pick from the tile's own dropdown. **Both ship, and that is not optional:**
drag-only is a keyboard trap and unusable on the tablet an instructor is actually holding. Native
HTML5 drag events, matching `lessons.html` — not SortableJS, per CORE.md §2.

New `addStaffSection()` / `removeStaffSection()` in `js/faculty-admin.js` write one (person, section)
pair, because that is what dropping a name means; `setStaffSections()` replaces the whole set, which
is right for the modal and would be silent data loss here. Both **carry the person's existing role
rather than choosing one** — P0.15 was exactly the bug where a person's rows disagreed, and
`director_offerings()` grants the privilege on a director role in *any* row.

**The modal copy about directors is rewritten.** It read *"Leave everything unticked to give them all
sections… That is how a director is recorded"* — every clause true, the whole thing misleading: it
describes the data encoding as if it were the role, and implies a director does not teach. Directors
teach sections; the two are independent and holding both is normal.

### Fixed — "+6 offering-wide" (P1.11) · ⚠️ and what it turned out to mean

Stated **once above the grid, with names**, instead of as an identical constant on every tile (it
never referenced the section it was rendered under, and could not).

**The number is very nearly the whole staff list**, which the roadmap did not know:
`create-instructor` inserts `section_id: null` by default and `setRole()` guarantees that row exists,
so essentially every staff member added through the UI holds offering-wide coverage — and
`staff_sections()` expands it to every section.

> **⚠️ A permissions question for the course director, filed on roadmap P3.9 and deliberately not
> acted on.** As configured today an ordinary instructor can read every section's submissions and
> grades, not just their own. Section-scoped rows are doing real work, but it is **UI scoping**
> (`taughtSectionIds()`, "my sections", the due-out row, the new queue), **not access control**.
> Either that is intended and should be written down, or the default row should stop being
> offering-wide for a plain instructor — a one-line change in the edge function plus a backfill.
> That is a privilege decision, so it is yours, not an agent's.

### Not verified

**None of this has been seen rendered by a signed-in faculty user** — a clean syntax pass and ~90 new
assertions are not that claim, and this batch is unusually visual. Run
`tests/browser-harness/pass.mjs` before P0.2 deletes the test faculty account. Specifically
unexercised: the coverage grid's drag-and-drop, the Grade queue against genuinely late work (nothing
in the term is late yet — the same blocker P0.5 hit), and Roster rendered as a plain instructor,
which is a role boundary that changed.

`docs/ROADMAP.md` also had **two `## 8. Completed` sections**; they are merged, and the five items
above plus P0.14/P0.15/P0.16 moved out of the priority bands into it.

---

## 2026-07-23 — Matthew Recker via Claude (assignment editor: collapsible activity sections)

The two activity sections in the assignment editor (Free-Response Preflight, AI Interaction) made
the form long. Each now **starts collapsed** when the editor opens; a chevron in the section header
expands one when needed, and choosing **Include** expands that section (you just decided to fill it
in). UI state only — never saved, and unchanged from what *Include / Not this term* means
(`site/app/faculty/lessons.html`).

---

## 2026-07-23 — Matthew Recker via Claude (student two-box view for required-written · gradebook drops the effort bar)

### Changed — student assignment view: one layout for both-loaded assignments

An assignment that loads **both** a written and an interactive activity now always shows the
side-by-side "Choose how to complete" two-box layout while it is still open, not only when it is a
graded choice (`site/app/student/lessons.html`). When the interactive is a graded choice, both boxes
are live and the student picks. When the **written is required** (interactive is practice), the same
layout renders with the interactive box **greyed and disabled** — "Available after you submit your
written responses" — and the heading reads *Complete the written preflight*. Once they submit, the
interactive opens as practice through the existing study card. This is the view the director asked
for (their screenshots): the choice layout, with the interactive locked until submission.

### Changed — gradebook cell: number = effort, colour = understanding, no more bar

The gradebook cell drew an **effort bar** under the score and tinted by **understanding**. But the
score (0/1/2) already *is* the effort — the bar re-encoded it — so the bar is gone
(`site/app/faculty/gradebook.html`). One indicator each now: the number carries effort, the cell
colour carries understanding (unchanged 0–5 ramp), effort stays in the hover tooltip. Legend updated.
Interactive grades tint correctly now that they carry `diagnostic` (previous entry).

An interactive grade recorded only effort, so the gradebook — which tints a cell by
**understanding** — had nothing to colour and interactive cells showed no background. The report's
schema:1 payload already holds `overall_understanding`; it just never reached the grade.

- **Migration 015 trigger updated (re-applied):** `grade_interactive_on_commit` now writes the
  report's schema:1 content into `grades.diagnostic`, the same shape `/preflight-analyze` writes for
  a written taker. So the gradebook and per-student page read an interactive taker's understanding
  (and misconceptions) the same way they read a written one's, without either page fetching
  `submission_activities`. The rollup still reads the artifact's copy on the submission — the same
  two-producer arrangement the written path already uses. `autograde_interactive_test.py` asserts it
  (13/13 live).
- **`grade_interactive.py`** (the backfill) writes the identical `diagnostic`, so the script and the
  trigger stay byte-identical. `grade_interactive_test.py` 49/49. Both suites' rollback proofs and
  live fixtures were updated to account for the eight real interactive grades now in production
  (baseline-compare instead of expecting zero; reset a fixture that is now committed+graded).
- **Backfilled** the eight existing `lesson-02` derived grades' `diagnostic` from their reports
  (understanding 1–5; Tatum has none, correctly), so they tint too.

### Changed — an interactive report can't be submitted late or over a finished grade

The artifact offers the student a "for a grade" choice and hands them an import link, so the receiver
(`interaction-submit.html`) must decide whether that link may actually produce a grade. Two hard
stops added, using the student's own resolved status (`loadAssignmentStatuses`, which already honours
the section deadline and any extension) — enforced *before* submit because an interactive grade is
auto-final and has no instructor review to catch a late or duplicate hand-in:

- **Past due** → the report can be read but not submitted for credit. (A student with an extension
  still open is not past due, because the deadline is the effective one.)
- **Already graded** (a finalized grade exists) → no new report can overwrite it; the first submitted
  report is the one that counts. Also enforced in the data layer (`submitInteractionReport` in
  `student-data.js`), because the receiver is a public URL and the UI check alone is skippable.

Practice is unchanged (it records the report, never grades — a softer, existing case). *Past-due
enforcement is UI + status-derived today; a DB-level deadline guard on commit is a hardening
follow-up.*

### Known limitation — a graded interactive choice is sticky (accepted 2026-07-23)

Once a student's interactive submission is **committed and graded**, reverting the assignment's
configuration (e.g. student-choice back to free-response-only) does **not** vacate those grades or
un-commit the submissions. The grade already exists and, like any committed choice under
`switch_policy`, it stands. This is a deliberate limitation, not a bug: automatically deleting graded
work as a side effect of a config toggle is more dangerous than leaving it. To undo one, an
instructor reopens/removes the grade by hand. (Surfaced when `preflight-02` was flipped to
student-choice, the eight test interactives graded, then flipped back — the grades remained.)

---

## 2026-07-23 — Matthew Recker via Claude (rollup counts graded-path only · backfill grades existing interactive drafts)

### Fixed — the rollup no longer counts practice work as "complete"

`loadInteractionData` (`faculty-rollup.js`) included any submission with interactive **or** written
work, regardless of whether that activity was the graded path. So on `preflight-02` the eight seeded
**practice** interactive drafts — no written responses, which is the required path there — showed as
*complete* in the cohort rollup. Now a piece of work counts toward the rollup only when its activity
is `grading_role='graded'` this term **or** the student committed it for credit; a practice run is
not the assignment. Written-graded takers are unaffected (verified: `preflight-02`'s 64 written
submissions still count).

### Added — `supabase/admin/commit_interactive_drafts.py`

When a director flips an interactive activity to graded (e.g. converts an assignment to
student-choice), interactive work already sitting there as **uncommitted practice drafts** does not
auto-grade — the migration-015 trigger fires on *commit*, and those drafts never committed. This
backfill commits such drafts (graded interactive · usable effort · not committed to another activity
· no human grade already), which fires the trigger to grade them. Dry-run by default; scoped by
offering/activity/course. It writes no grade itself — it commits, and lets the same trigger a live
submit would.

### Data — graded the eight `lesson-02` test interactives

After the director converted `preflight-02` to student-choice (both activities `graded`), ran the
backfill: committed and auto-graded the eight seeded interactive submissions through the live 015
trigger — Arden Bishop, Avery Rivas, Kai Sterling, Rowan Whitfield, Sage Marsh at **2/2** (effort
4–5), Jordan Calloway, Remy Ashby, Tatum Vaughn at **1/2** (effort 1–2). These are the fixtures for
testing both-modality aggregation; each is `source='derived'`, finalized.

*Note: making this reactive-on-config-change **automatic** (a trigger on `offering_activities` that
commits + grades existing interactive work the moment an activity is set graded) is a possible
follow-up. It was left as an explicit backfill for now — auto-committing a student's submission as a
side effect of a config toggle is a bigger decision, especially where a student did more than one
activity.*

---

## 2026-07-23 — Matthew Recker via Claude (auto-final interactive grading · student nav gating · role-demotion fix)

An autonomous batch (director away, `/loop`). Three areas; all code + tests shipped, one migration
written but not yet applied (the harness blocked the live-DDL apply — see below).

### Grading — an interactive submission grades itself, auto-final

Follows the director's decision that an interactive grade should appear on its own, immediately,
finalized, **only when the interactive path is a graded (allowed) mode**.

- **`supabase/migrations/app/015_interactive_autograde.sql` — APPLIED 2026-07-23.** A
  `SECURITY DEFINER` trigger (`grade_interactive_on_commit`): when a submission commits to a
  **graded** interactive activity, it copies the report effort (re-applying the §5.2 reading-
  reflection cap server-side) onto a **finalized, derived** grade — student-visible at once, no
  review step. Practice commits produce no grade (and `submissions_check_gradable` already blocks
  committing a practice activity a layer up). A finalized instructor/imported grade is never
  overwritten (a prior *derived* one is, so re-submits work). RLS-safe: `grades` has RLS enabled but
  not forced, so the owning definer writes past the student's policy; scoped to the firing
  submission's own enrolment. Applied on the director's return; `autograde_interactive_test.py`
  passes 12/12 live. **One bug was caught by that test and fixed before use:** the "no usable
  effort" guard used `<>` where SQL three-valued logic let an absent effort fall through and create
  a NULL-effort grade — corrected to `IS DISTINCT FROM` and re-applied (the trigger is a pure
  `CREATE OR REPLACE` function with no dependents yet).
- **`grade_interactive.py` + its 49-check suite re-aligned to auto-final** (`source='derived'`,
  `is_finalized=true`). The script is now a **backfill** tool that writes the identical row the
  trigger writes; until 015 is applied it is the interim way an interactive submission gets a grade.
- **`autograde_interactive_test.py`** (new) — verifies the trigger live in rolled-back transactions
  (graded→grade, practice→none, cap→2, instructor grade protected, no-effort→none). Reports and
  exits cleanly with "015 not applied" until the migration lands.

### Student portal — navigation and availability

- **Routing bug fixed.** Clicking *Written preflight* linked to `assignments.html?a=<activity id>`,
  but that page resolves `?a=` against the **offering** id — the mismatch fell through to the full
  "My written preflights" list. Now links by offering id (`lessons.html` `writtenHref`), so it opens
  the actual written input, including when an assignment is written-only.
- **Interactive availability respected.** The interactive card is launchable only when its
  `available_after` gate is met (`submit` / `due`, or always once past the deadline). Before then it
  renders **greyed and disabled** with the reason ("Available after you submit your written
  responses") instead of a live Launch button on a practice activity that isn't open yet. Reuses the
  existing tested `isActivityAvailable()`; `student-lessons.js` now carries the availability + gate
  reason onto each row.
- **Launch warning gated.** The "submitting the interactive makes your written answers stop counting"
  confirm now fires only when the interactive path is **graded** — on a practice activity it was
  simply false.

### Staff — role demotion now takes ("once a director, always a director" fixed)

- **`faculty-admin.js` `setRole()`** upserted only the offering-wide `staff_assignments` row, but a
  director holds section-scoped rows too, all `role='director'`, and `director_offerings()` grants
  the privilege on a director role in **any** row. So choosing Instructor never removed the director
  privilege. `setRole()` now updates the role on **every** row the person holds in the offering, then
  guarantees the offering-wide row. Verified live (rolled back): old logic left a mixed state and the
  person stayed a director; new logic demotes cleanly and promote-back works. Director stays a
  per-offering privilege; `is_global_admin` (system admin) is untouched.
- **Two live records are already corrupted by the old bug** and were left for the director to
  resolve, not auto-repaired (the intended role is a privilege decision, not a guess):
  `Kimberly de La Harpe` and `TJ Hardy` each hold an offering-wide `instructor` row with section rows
  still `director`, so they currently read and act as directors. Re-selecting their role in Staff
  cleans it up under the fixed `setRole`.

### Docs

- `site/app/help/student-getting-started.md` — distinguishes written grades (reviewed by a person)
  from interactive grades (auto-final on effort), and notes practice interactive availability.
- ROADMAP: **P0.16** (auto-final + nav), **P0.15** (role demotion). Verification note that 015's
  live apply is pending.

---

## 2026-07-23 — Matthew Recker via Claude (P0.14 — the interactive grade writer, built + migration applied)

### Schema — migration `app/014_effort_grades_per_row.sql` APPLIED

Applied to live `app` as `prep_app_owner` (unsealed by the director for this change). It re-keys
`grades_points_from_effort()` on the grade **row** (`NEW.effort IS NOT NULL`) instead of the
offering's `grading_mode`, and adds the `grades_one_grading_mechanism` CHECK
(`effort IS NULL OR question_scores = '{}'`). Before/after captured: the function stopped
referencing `grading_mode`, the constraint now exists, and all 64 existing grade rows satisfied it
(every one has `effort IS NULL`). Verified live in rolled-back transactions afterward — a
`grading_mode='points'` offering now derives points from effort (0→0, 2→1, 5→2), an effort-NULL row
keeps its own `points_earned`, and an `effort` + non-empty `question_scores` row is rejected by the
CHECK. The full `grade_interactive_test.py` (49) and app-schema (339) suites pass against the
migrated database.

**⚠ Owner needs re-sealing (human-only, CORE.md §0):** `prep_app_owner` is currently `LOGIN`.
`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres` closes it again — folds into P0.2.

### Added — carry an interactive submission's effort up to its grade

The gap diagnosed earlier today (entry below) is closed end to end.

- **`supabase/admin/grade_interactive.py`** — the writer the interactive path never had. For a
  committed, `graded`, chosen interactive submission it reads `effort` from
  `submission_activities.content`, re-applies the contract §5.2 reflection cap as a server-side
  guard (never trusting the student-controllable payload), and upserts one `grades` row —
  `is_finalized=false`, `source='ai_suggested'`, so it lands in the dashboard's "AI grades awaiting
  review" queue exactly as `/preflight-analyze`'s written grades do. `status` surveys and names why
  each row is or is not gradable; `run` is dry-run by default, `--commit` writes. It reuses the one
  shared effort curve (`points_from_effort`, imported from `interaction_reports.py`, not a fourth
  copy) and is correct **both before and after** the migration below — pre-migration the old trigger
  returns early on `grading_mode='points'` so the script's own `points_earned` stands; post-migration
  the trigger recomputes the identical value.
- **`supabase/admin/grade_interactive_test.py`** — 49 checks: the curve, the cap and its
  malformed-payload edge cases (a string/float/bool `effort` is refused, not coerced into a grade),
  the gradable/skip/needs-backfill classification, **and** a live end-to-end write — promote a
  fixture to `graded`, commit it, run the script's own SELECT and INSERT, assert the grade, prove
  the rollback left nothing. All 49 pass; production untouched (verified: 0 grades carry an effort).
- **Grade tab no longer risks zeroing an interactive taker.** `faculty-grade.js` gained
  `isEffortGraded()` and `buildGradeData()` now takes `submissionMap`; a student who committed to
  the interactive activity is **excluded from the editable question model** and `grade.html` shows
  them a read-only "graded on effort N/5" card instead. Without this, their blank written answers
  defaulted to `zero`, and because they hold a prior grade row `gradeRows()` rule 2 would not skip
  them — one Save would overwrite their effort grade with 0. `tests/app-schema/test-grade.mjs` (14
  checks, registered in `run.mjs`) pins the exclusion and includes the counterfactual proving the
  bug was real. Full app-schema suite green.

Migration `supabase/migrations/app/014_effort_grades_per_row.sql` (**applied** — see the schema
section above) is what makes a **choice** offering (`preflight-03`/`-04` already are) grade a written
taker by `question_scores` and an interactive taker by effort on the *same* offering. It also
dissolves the zeroing hazard flagged earlier: the `grading_mode='effort'`-on-a-choice-offering trap
stops existing once the trigger ignores `grading_mode`.

**Known verification limit (CORE.md §2):** the new interactive Grade-tab card is logic- and
syntax-verified but has **not** been seen in a browser — no committed interactive submission exists
in the term yet (the only interactive work is `preflight-02` practice). Walk it during P0.5, or
against a seeded fixture, once a real `graded` interactive submission lands.

### Investigated — the gradebook is not incomplete, it is about to be wrong

The director reported that students who submitted an **interactive** assignment get no grade and no
mark in the gradebook matrix, and that their per-student page shows no points. Confirmed against
live `app`; the observation is exact. **Read-only investigation — no code, schema or data changed.**

**There is no writer for `grades.effort` anywhere in the app-schema stack.** Three components each
decline to write it for a defensible local reason, and nobody owns the gap: the receiver refuses by
design (a student cannot write a grade — `grades_staff_write`), the Grade tab builds rows only from
`questionsOf(offering.written)`, and `/preflight-analyze` grades written work by design. Two further
layers would each independently defeat a fix to the first: every one of the 74 offerings is
`grading_mode='points'`, so the effort trigger returns early and derives nothing; and `grading_mode`
lives on the **offering** while `preflight-03` and `preflight-04` already offer *both* modalities as
`graded` — one column cannot serve two.

What the director actually saw: the only interactive work in the database is 8 seeded reports on
`lesson-02-…`, whose activity is `grading_role='practice'` on `preflight-02`. Submitting practice
work records it without committing (correct), so all 8 sit `status='draft'` with no grade, and
`cellState()` returns `PENDING` — **which renders as nothing**. On 2026-08-10 those cells flip to
`MISSING` and count as zero out of 2 against cadets who did the work; `preflight-03` (Aug 12) then
commits real students into a permanently `UNGRADED` state that drags the percentage identically.
That clock is why this is P0 rather than "the gradebook is incomplete."

The "demonstration data" on the student page is not a rendering bug — it is what is stored. The 8
fixtures carry names inside the Markdown (`DEMONSTRATION`, `Chen`, `Brooks`, …) that do not match
the roster students they are attached to. **Expected**: the director confirms those reports were run
by faculty on the legacy system, archived, and re-attached to random roster students to exercise the
pipeline. Recorded so the discrepancy is not investigated a second time.

### Corrected same day — the grading policy was never the open question

The director confirmed the intended rule: an interactive assignment is **automatically** graded from
effort — `0 → 0` · `1–2 → 1` · `3+ → 2` — with effort capped at 2 when the reading reflection is not
meaningful. **Both halves are already implemented and match the policy exactly**: the curve in
`grades_points_from_effort()` (`001_core_model.sql:568-586`) at `points_possible = 2`, and the cap in
contract §5.2, applied by the artifact and re-clamped server-side as a guard
(`interaction_reports.py:223-231`).

So P0.14 was re-scoped from "decide who grades interactive work" to what it actually is: **connect a
rule that already exists to a column nothing populates.** One decision remains — how a *mixed*
offering grades two modalities under one `grading_mode` column.

**And one hazard was found while re-scoping, which is the reason this correction is worth a
CHANGELOG entry of its own.** Setting `grading_mode='effort'` on `preflight-03`/`-04` looks like the
one-line fix and is a data-loss bug: the trigger is `BEFORE INSERT OR UPDATE` and assigns
`points_earned` unconditionally once the mode matches, with `NULL` effort mapping to `0`. Both those
offerings carry written **and** interactive activities as `graded`, so every written taker — scored
2/2 through `question_scores`, `effort` correctly NULL — would be silently rewritten to 0 points on
the next save. The safe order is **writer first, configuration second**: a writer without the mode
change is inert; the mode change without a writer is the zeroing bug.

### Changed — `docs/ROADMAP.md`

- **Added P0.14**, with the diagnosis, the confirmed policy and where each half of it is already
  built, the remaining mixed-offering decision (move `grading_mode` to `offering_activities`, or key
  the trigger on `NEW.effort IS NOT NULL` instead of the offering), the zeroing hazard above, and an
  explicit warning **not** to "fix" it by flipping `preflight-02` to `graded` — which would convert
  8 blank cells into 8 permanently ungraded ones.
- **Corrected P1.14**, which instructed the future grading queue to hide interactive submissions
  because they "are auto-graded." The rule is right and should be built as written; it is simply not
  true yet, so P0.14 must land first or the queue will hide exactly the students who are silently
  ungraded. It was inherited already-true from the legacy `public` receiver (migration `013`), which
  is what kept P0.14 invisible.
- **Amended decision Q2.** Its arithmetic is right and P1.1 was correctly unblocked by it; what it
  got wrong was reading "the trigger derives the points" as "the path is wired." Verifying that a
  mechanism exists is not verifying that anything invokes it.

Also carries a `docs/ROADMAP.md` addition by a concurrent Claude session: **P3.16**
(`/feedback-triage`, rolling accepted feedback into the roadmap), unrelated to the above.

---

## 2026-07-23 — Matthew Recker via Claude (say "assignment", not "lesson"; five UI corrections)

### Changed — the UI now uses the schema's noun

Schema `app` calls the container an **assignment** (`assignments` → `assignment_offerings`); the
portal still called it a *lesson* everywhere a human could read it. Renamed across faculty and
student copy: the nav entry (**Lessons → Assignments**), page titles and headings, the spotlight card
(*Assignment 02 — …*), the matrix and section-card column codes (`L02` → `A02`), the authoring modal
(*Assignment id (slug)*, *Assignment #*, *Save assignment*), every validation and confirmation
string, and the three in-app help topics that name the page.

**What deliberately did NOT change:**

- **File paths.** `site/faculty/lessons.html` and `site/student/interaction-submit.html` are frozen
  contract URLs (CORE.md §6) targeted by deployed artifacts and prefill links. The label moved; the
  path cannot. Same for `student/lessons.html`, and for identifiers, CSS classes and skill names
  (`/lesson-aggregate`, `/lesson-cycle`, the `lesson-figures` bucket).
- **"Interactive lesson."** That is the *modality* — the Claude artifact, branded iPREP
  (*interactive Pre-lesson Readiness Engagement Platform*) — not the container. An assignment is
  completed *via* the interactive lesson or the written preflight, and the two nouns now say which
  is which instead of both being "lesson".
- **Q1's wording.** "…in preparation for this lesson?" is the question text built from the source
  DOCX (`build_fall_preflights.py`) and means the class period. Changing it would break the match.
- **The class period generally** — "before you teach the lesson", "2359 the night before the
  lesson" are still lessons and still read that way.

`student/assignments.html` was retitled **Written preflights**. It is the written-preflight surface
reached from an assignment, and once the assignment LIST became "Assignments" the two pages had the
same name.

### Changed — the course switcher moved onto the brand

The course name printed beside the wordmark on every page *is* the switcher now: a button with a
dropdown (`nav.js` → `brandCourseHTML`). The label and the control that changes it were previously at
opposite ends of the nav bar.

Two copies of that control were removed as a consequence: the picker inside the user menu, and the
dashboard's own inline segmented switcher (P1.7). The dashboard version is **documented in place**
rather than merely deleted — `faculty-dashboard.js` carries a block explaining what it was, why it
existed, and why the answer belonged in the nav. `courseMenuHTML()` became `courseOptionsHTML()`
(rows only, no menu wrapper); `test-nav.mjs` follows.

On a phone the plain course *label* still hides, but the *switcher* does not — it is now the only way
to change course, so it truncates instead of disappearing.

### Changed — "Needs your attention" is a row of chips, under the spotlight

Each box was a ~420px card holding an emoji, a large number and a full sentence that repeated the
number; four of them filled the page width to say four short things. A box is now **count +
imperative** — `64 · Review AI grades` — sized to its own words, with the sentence kept as the
tooltip. Each source in the registry gained an `action` field; a source without one falls back to its
text, and a test holds `action` to 22 characters because the row is sized by its words.

It also **moved below the active-preflight spotlight**. It loads a beat after everything else and its
height depends on how much is outstanding, so at the top of the page it put the KPI tiles and the
spotlight at a different vertical position on every visit — and moved them again once the queries
landed.

### Changed — the rollup's other-sections toggle is a lamp inside the scope group

`show all 4` / `hide others` was a text link sitting *beside* the scope tabs: a second control in a
second visual language, whose number was the total rather than the count being revealed, and which
read as though it selected a scope. It does not — it changes which tabs exist. It is now a small
lamp at the head of the same segmented group, left of **Course rollup**: grey when off, green when
on, and deliberately not taking the group's "selected" chrome so only one tab ever reads as current.

### Changed — free response is always axis A

The written path's free-response understanding used to be re-sorted into the weakest-first order with
the interactive objectives, so the one measure that is *not* a resolved learning objective moved seat
between lessons and between sections — axis A on Monday, axis D on Tuesday. It now leads the list
unconditionally (`summarizeReports` unshifts it), making it axis A on the radar and the top row of
**Understanding by objective**; everything after it is still weakest first. The panel's eyebrow says
so.

### Verified

`tests/app-schema/run.mjs` — 339 checks, 0 failures (includes the live-REST and RLS suites; the
standalone `test-student.mjs` needs the runner's reset step or it inherits its own leftover rows).
Browser walkthrough via `tests/browser-harness/pass.mjs`: 9/9 faculty and 5/5 student pages clean, no
console errors, no failed requests. The rollup, the brand dropdown and the lamp were additionally
driven in a real signed-in browser in both themes — dropdown opens and switches, the lamp toggles the
tab list 3 → 6, and the objective rows read `A Free response`, then B–E weakest first.
`check_doc_sources.py` run; `instructor-grading.md` corrected (the rollup tab is **Course rollup**,
not "All sections", and the lamp is now documented) and five help entries re-reviewed.

**Worth knowing for the next walkthrough:** `pass.mjs` screenshots `student/lessons.html` while it is
still on its spinner and reports it clean, because that page's wait selector is `main`, which always
exists. Driven directly it renders all 37 rows with no errors — the harness is measuring the wrong
thing there, not the page failing.

---

## 2026-07-23 — Matthew Recker via Claude (feedback resolution matrix, site admins only)

### Added — every comment now reaches a decision, and accepted ones get a destination

The other half of the feedback box. 012 gave people somewhere to put a comment; nothing gave anyone
somewhere to answer one, and a suggestion box that is never visibly acted on stops being used by
about week three. `site/app/faculty/feedback.html` (new, admin-only nav entry) is a **page × decision
matrix**: a cross-tab of where comments came from against what was decided, whose cells filter the
list beneath it, then one card per comment carrying the decision controls.

**Migration `013_feedback_resolution.sql` — applied.** Adds `status`
(`new`/`accepted`/`declined`/`duplicate`, default `new` so the widget's INSERT keeps knowing nothing
about any of this), `resolution_note`, `roadmap_ref`, `resolved_by`/`resolved_at`, `updated_at`, plus
an admin-only UPDATE policy and a partial index on the pending work list.

**The handoff contract for the roadmap skill — which is deliberately NOT built yet.** Accepted
feedback is meant to be rolled into `docs/ROADMAP.md` by a skill, and that skill needs an unambiguous
work list. It is exactly:

```sql
SELECT * FROM app.feedback WHERE status = 'accepted' AND roadmap_ref IS NULL;
```

There is deliberately **no `roadmapped` status**: a status would have to be kept in step with the
roadmap by hand, whereas `roadmap_ref IS NULL` cannot drift from the thing it describes. Stamping the
ref is what removes a row from the list, a CHECK confines a ref to accepted rows so a declined item
can never enter it, and `resolutionPatch` writes NULL rather than `''` for a blank — an empty string
would look right in the UI while silently failing `IS NULL` and stranding the item forever. That last
one has its own test.

**Two deliberate narrowings.** Resolution is **site admins only** (`is_admin()`), not directors —
feedback routinely names a colleague's screen as confusing, and letting every director resolve a
comment about somebody else's page invites the argument the box exists to avoid. And there is **no
DELETE policy for anyone, including admins**: the strongest reason someone would want a comment
erased is the worst reason to permit it, so saying no is `declined` with a note that stays on the
record. Both are pinned by RLS persona checks.

*Only free responses need resolving, and that needs no filter:* `message` is NOT NULL with a
non-blank CHECK while the reaction is optional, so a bare-reaction row cannot exist — every row
already is a comment. The sentiment renders beside the text as context, never as the subject.

*Verified:* `test-feedback-admin.mjs` **44/0** (matrix cross-tab and its sort order, the pending work
list including the empty-string trap, filtering, and every constraint mirrored into a sentence) ·
`app_rls_test.py` **56/0** with six new feedback checks (student and non-admin instructor both denied
resolution, admin allowed, ref-on-declined refused, delete refused for everyone) · full
`tests/app-schema` **339/0**, exit 0 · and **signed in as a site admin in both themes**: nav entry
present, matrix rendered, a cell click filtered 6 → 2, and a real accept + roadmap ref round-tripped
to the database with attribution stamped. Test rows removed and the account's admin flag restored
afterwards.

## 2026-07-23 — Matthew Recker via Claude (feedback box: sentiment + comment)

Reworked the feedback controls, same day: the six-category single-select had heavy overlap (a
"feature request" is an "add") and forcing one exclusive pick was more friction than signal. Now the
panel is an **optional Like / Dislike reaction** (fills green / red when chosen, deselectable) plus a
**comment box whose prompt invites what to add, remove, or request** — richer input for less effort,
and a clean like-vs-dislike ratio to poll.

**No migration.** `category` already accepts `like`/`dislike`/`other`; the UI now only sends those
three, and `feedbackRow` defaults an un-reacted comment to `other` and coerces any stray value, so
the NOT NULL + CHECK column always gets something valid. The fuller `feature`/`add`/`remove` values
stay valid for a future control. `validateFeedback` now requires only the comment (sentiment is
optional). *Verified:* `test-feedback.mjs` **27/0** (category-default and coercion cases added), full
suite exit 0, and re-checked end to end signed in — a Like + comment stored `category='like'`, test
row cleaned up, panel screenshotted.

## 2026-07-23 — Matthew Recker via Claude (in-app feedback box)

The app is going to instructors to test, so it needed a way to hear back. A floating **Feedback**
box now rides the chrome onto every signed-in page; a submission records who said it and the page
they were on, into a new `app.feedback` table meant to be polled to steer future work.

### Schema — `012_feedback.sql`, **applied** to `app`

One immutable row per submission: `submitted_by` (auth uid), `submitter_name`/`role` (readable
hints), `page` + `page_title`, `category` (CHECK `like`/`dislike`/`feature`/`add`/`remove`/`other`),
`message` (non-blank, ≤4000), `user_agent`, `created_at`. No `updated_at` and no UPDATE/DELETE
policy — a submission is an utterance, write-once through the API; a correction is a new row.

**RLS is the whole security model:**

- **INSERT is self-only** — `WITH CHECK (submitted_by = current_uid())`, so a caller cannot file
  feedback as someone else. The UI supplies the uid but the database re-checks it against the JWT.
- **SELECT is `is_admin()` only.** Feedback is steering data, and it can name pages and people in
  ways a cohort peer should not browse, so it is invisible to everyone but a global admin. Opening
  it to directors later is additive; starting open would be the breaking direction. This is why the
  `notes`-like candour is safe to collect.

No FK to `auth.users` (the app owner cannot reference schema `auth`, per 010's reasoning) and no
`GRANT`s (default privileges + the two policies are the whole story, per 008's convention). Indexed
for the poll: `created_at DESC`, and by `page` and `category`.

### Widget — `js/feedback.js`, mounted from `nav.js`

A launcher pill bottom-right opens a small panel: the six category chips, a message box, and Send.
It names the page you're on ("About: Dashboard") and, on success, collapses to a thank-you.

- **Mounted from `renderNav`**, un-awaited and idempotent, exactly like the run banners — so it
  appears on every faculty and student page without touching each one, and a re-render never stacks
  a second copy.
- **`supabase.js` is imported lazily** inside submit, never at module scope — `nav.js` is on every
  page (and in the offline nav test), and a static client import would be the exact dependency
  `run-banner.js` documents avoiding.
- **The pure parts are separated and tested** — `validateFeedback` mirrors the migration CHECKs so
  the person gets a sentence rather than a Postgres error, and `feedbackRow` builds the row from
  injected page/agent values so it is unit-testable.

### Verification

`012` dry-run clean then applied; table verified (10 columns, RLS on, both policies). `db-schema.js`
regenerated (26 tables). New coverage: `app_invariant_test.py` **41/41** (was 33 — category/message/
role CHECKs, write-once shape), `app_rls_test.py` **51/51** (was 45 — **a non-admin can neither read
feedback nor file it as another user; a global admin can read it**), `test-feedback.mjs` **23/0**,
full `tests/app-schema` exit 0. **End-to-end signed in against the live DB:** the box mounted on the
dashboard, a marked submission landed in `app.feedback` with the right uid/page/category, and the
test row was deleted. Panel screenshotted open in both themes.

## 2026-07-23 — Matthew Recker via Claude (test-faculty creds → the untracked env)

### Changed — the P0.5 test login lives in `supabase/admin/.env`, not in source or on the line

The disposable faculty account's email, password and UID now sit in the gitignored
`supabase/admin/.env` as `PREP_TEST_FACULTY_EMAIL` / `_PASSWORD` / `_UID`, beside the DB role
credentials the same file already holds. One source of truth for the three consumers:

- `scripts/test_faculty_account.py` reads the UID from there (was a hardcoded default). Absent, it
  exits with instructions rather than operating on nothing.
- `tests/browser-harness/{pass,checks}.mjs` fall back to the env via a new `env.mjs`, so the
  walkthrough runs with **no secret on the command line** — verified: `checks.mjs --tier director`
  passed 13/13 with credentials supplied only by the env.

**Why this matters beyond tidiness:** the auth user is recreated by hand in the Supabase dashboard
whenever it is rebuilt, and that mints a **new UID every time** — which is exactly why the account
was recreated three times on 2026-07-22. Putting the UID in the one file that is *meant* to change
makes a rebuild a one-line edit instead of a source change in three places, and keeps the password
out of shell history and scratch files. `.env` is covered by the `.env*` gitignore rule; confirmed
it stays untracked. CORE.md §3's secrets table updated to say the file now holds this too.

---

## 2026-07-23 — Matthew Recker via Claude (gradebook colour layer)

*Director follow-up to the fifth batch: "I want to see some colours on the gradebook like my other
gradebook — effort level and understanding level for each assignment as well as points — and the
rollup colours are probably good to reuse."*

Each graded cell now carries two more signals, both on the **rollup's own 0–5 ramp** (`--s1`…`--s5`,
red→green), chosen from three mockups the director picked between:

- **Cell tint = understanding.** A low-understanding cell reads red even at full points — which
  surfaces the exact "full credit but didn't get it" case the 3-state `warn` was built for, at grid
  scale.
- **Bottom bar = effort.** Width *and* colour both encode 0–5, so it does not rely on colour alone.

**Everything degrades.** A cell tints only if understanding is known, draws a bar only if effort is
known, and a graded cell with neither — a future assignment type that tracks differently — falls
straight back to a plain number. That was the director's explicit forward-looking requirement and it
is the default, not a special case.

- **The colour maths is the rollup's, reproduced not guessed.** `zoneIndex()` in
  `faculty-gradebook.js` is `report.html`'s `zoneVar` split so the arithmetic is testable; the page
  supplies the `--s{n}`. A parity test pins the boundaries (0 and 1 → red, 5 → green) so the two
  surfaces cannot drift.
- **`GB_GRADE_SELECT` now fetches `diagnostic`** — the one narrowing from the first cut that this
  makes wrong, since the written path's effort/understanding live there. Still bounded (one small
  payload per grade, not the report blobs `SUBMISSION_SELECT` drags in).
- **Signals come from the grade alone.** Interactive effort from `grades.effort`; written
  effort/understanding from `grades.diagnostic` (`q2_effort`/`q3_understanding`, or a schema:1
  payload's `overall_understanding`). The artifact's *claimed* effort is out of reach here (it needs
  the submission blob), which is correct — every graded cell is covered without it.
- **The per-student page speaks the same language** — its effort/understanding dials now carry a
  left rail in the same ramp colour, so a level reads the same on the grid and on the drill-down.
- **Tint survives row-hover** by blending into the hover surface rather than being overpainted —
  hover is exactly when a grader is reading that row's colours.

**Adjusted on the director's eye (two passes):** the first cut was too faint and the cells too
large, so the grid tightened — columns 4.6rem → 3.4rem, row padding roughly halved, name column
190px → 144px — and the tint went from a transparent wash to the **solid ramp colour** (the same
five the legend swatch shows, no `color-mix`), with the number set near-black so it stays legible
across red→green in both themes. The effort bar became a **band pinned to the cell's bottom edge,
a full-width black line dividing it from the understanding region**, still well shorter than the
cell; its fill length and colour both encode effort on a neutral track so it reads even when effort
and understanding land on the same colour. CSS + one markup change; verified **signed in against
real Fall data** (21 students, both themes, no console errors) and re-screenshotted synthetically to
see the full ramp the live cohort doesn't span.

*Verified:* `test-gradebook.mjs` **96/0** (23 new — `zoneIndex` boundaries, `cellSignals` across both
paths and the degradation cases, and that `buildMatrix` attaches signals to the cell) · full
`tests/app-schema` exit 0 · both pages boot clean in light and dark · **and the colour itself was
rendered** — the shipped `styles.css` against a synthetic grid, screenshotted in both themes, `color-mix`
confirmed working and the tints legible on dark. Still not seen with real Fall data behind a faculty
login (same gap as the parent batch).

## 2026-07-22 — Matthew Recker via Claude (fifth batch — P1.1, P1.2, P1.4)

Three roadmap items that are one feature in practice: a grid, the page you reach by clicking a name
in it, and the thing you do on that page. Scoped in
[`site/app/PLAN-2026-07-22-GRADEBOOK.md`](site/app/PLAN-2026-07-22-GRADEBOOK.md).

### Schema — `011_ei_sessions.sql`, **applied** to `app`

Extra-instruction logging (P1.4). Keyed on `enrollment_id` — which makes the RLS predicate
byte-identical to the reviewed one already on `extensions` and `grades`, the practical reason for
the choice as much as the modelling one.

**Four decisions recorded in the migration header, because each is the kind that reads as an
oversight later:**

- **No unique constraint.** EI is repeatable; the same cadet may come twice in a week. `extensions`
  keeps one only because PostgREST upsert needs a conflict target (007:49-56), and these are plain
  inserts. A unique key here would silently swallow the second visit.
- **`batch_id`.** Six cadets after one class are one event. Without a shared id, fixing a mistyped
  duration is six edits and "how many sessions did I hold" has no answer. NULL for a single log, so
  `batch_id IS NOT NULL` keeps meaning "this was a group sitting".
- **No self-attribution trigger**, unlike `review_signoffs`. A director logging on behalf of the
  colleague who ran the session is a real case, and an EI row confers nothing and costs the student
  nothing. Revisit if EI attendance ever feeds a grade.
- **No student read policy at all** — director's decision, ROADMAP §6 Q3. This is the `extensions`
  block *minus* `extensions_own`, and the absence **is** the enforcement. It matters because `notes`
  holds an instructor's candid read of a cadet.

No `GRANT`s, following the convention `008_student_identity.sql:147-149` states: default privileges
already cover a table the owner creates. 009 and 010 drifted from that; 009's `GRANT SELECT` is
actively misleading, since it reads as a read-only restriction while INSERT/UPDATE/DELETE were
already granted — the table is protected by the missing write policy, not by the grant.

### P1.1 — Gradebook · `faculty/gradebook.html` + `js/faculty-gradebook.js`

Sticky student column, sticky header row, shortcode column headers (`preflight-02` → `PF02`), a
totals column, and bulk EI logging. Ungated in the nav, like Grade — an instructor sees their own
sections and RLS enforces it.

- **Five cell states, and only one renders blank.** graded · draft (AI suggestion, unconfirmed) ·
  ungraded (work arrived) · missing (past due, nothing) · pending (not due). A blank that could mean
  either "not due" or "never handed in" is the defect that makes a gradebook untrustworthy.
- **A lesson counts toward the percentage only once its deadline has passed.** Without that rule
  every cadet reads 0% on day one because 39 lessons they cannot yet have done are already counted
  against them. Missing counts zero-out-of-full; pending is not in the sum at all.
- **Zero is its own band.** Missing work and failing work are different facts and must not share a
  colour. The six bands bind to the `--d0…--d5` data-viz ramp, deliberately **not** the
  full/warn/zero triad — that palette is a contract with `question_scores[].status`
  (DESIGN.md:237-243) and a 65% total must not read as a flagged answer.
- **Deliberately narrow selects.** Not `OFFERING_SELECT` (which pulls every question of every
  lesson), not `GRADE_SELECT` (`question_scores`/`diagnostic`), not `SUBMISSION_SELECT` (every
  report blob). P3.7 asks for a performance budget before the grid is built rather than after.
- **Extensions are honoured.** `faculty-data.js:148` hardcodes `null` for the extension argument to
  `effectiveDue`, so its status calls a student overdue who holds an active one. On a dashboard tile
  that is a rounding error; on a gradebook it is a red cell against a cadet who did nothing wrong.
  This follows `faculty-grade.js` instead.

### P1.2 — Per-student detail · `faculty/student.html` + `js/faculty-student.js`

Reached by clicking a name in the gradebook or the roster; no nav entry, like `report.html`. Keyed
on the enrolment, which is what every policy keys on. Stat tiles, per-lesson table, the student's
actual work, misconceptions folded across the term, EI history, and an advising note.

- **The two layers sit side by side here and nowhere else.** Points are the grade; the 0–5 effort
  and understanding columns are diagnostics, styled quieter and never added to the total. The
  gradebook deals only in points because a grid cell cannot explain itself; this page can.
- **Misconceptions folded across the term** — the one view in PREP that answers "is this student
  repeatedly wrong about the *same* thing". Uses the rollup's own `canonMisconceptionId()`, so
  `scalar-sum` / `Scalar-Sum` / `scalar sum` fold here exactly as they do on the cohort view.
- **The advising note** (djGradebookProject's Comment Card): grade, section comparison, missing work
  *named with due dates*, understanding average, recurring sticking points, EI count, plus a
  free-text box and Copy. Plain text on purpose — it is going into an email, and what the instructor
  sees before copying is exactly what they get.
- **`backTarget()` allowlists.** `document.referrer` is attacker-controllable, so a back link built
  from it unvalidated is an open redirect. It returns a bare relative filename from a six-entry
  list, never the referrer itself.
- **Q1 stays hidden**, matching `grade.html:207,215` and CORE.md §2 — and filtered by the points
  *property*, not by position, which is the defect LEGACY-AUDIT:102-108 flags.
- **The class comparison loads after first paint** and is dropped silently if it fails. It is a much
  wider read than the rest of the page, and the page is useful without it.

### P1.4 — EI logging, single and bulk · `js/faculty-ei.js`

Both paths in one pass, per the roadmap: a design where bulk is a bolt-on "will be abandoned by week
three", because the common event is several cadets at once, most days.

- **Single** — on the student page, prefilled with today, the current local time floored to 5
  minutes, and 30 minutes. Editable, and editable again afterwards.
- **Bulk** — on the gradebook, a mode that turns the name column into checkboxes. Pick a
  time once, tick who was there, log. One `batch_id`.
- **Writes are sequential and failures are per student**, copied from the P1.12 extension batch:
  "logged 4 of 6, failed: Smith, Jones" is actionable; one rejected promise is not.
- **Times store UTC, render local.** Both conversions are pure functions with a round-trip test —
  a session logged an hour off still looks fine, which is why it needs a test rather than a review.
- **Editing does not re-attribute.** An edit corrects the record of a session; it does not silently
  change who held it.

### Verification

| Layer | Result |
|---|---|
| `tests/app-schema` full run | **exit 0**, 0 failures — 339 in-process + 190/82/73/56/28/22/19/12 spawned |
| `app_invariant_test.py` | **33/33** (was 22 — 11 new for `ei_sessions`) |
| `app_rls_test.py` | **45/45** (was 35 — 10 new, incl. *a student cannot read their own EI log*) |
| `app_tier_check.py` | all tiers pass |
| Browser boot check | 10/10 — both new pages plus three existing, light and dark, no console errors |

New suites: `test-gradebook.mjs` **73/0**, `test-ei.mjs` **82/0**, `test-student-detail.mjs`
**56/0**. Two existing guards fired and were correct: `test-db-schema.mjs`'s table count (24 → 25)
and `system-prefs.js`'s curated-column list, which now covers `ei_sessions` — with `notes`
deliberately excluded from the generic table browser.

**Not yet verified, and it is the real gap:** neither page has been seen rendered by a signed-in
faculty user. The boot check proves every module parses, evaluates and redirects cleanly in both
themes, but it cannot prove the grid *looks* right, and no assertion here has run against real
Fall 2026 data. There is also **no EI data and no late work in the term yet** (the active preflight
is due Aug 9), so bulk logging and the late chip are exercised by fixtures and the logic harness
only. This needs a `tests/browser-harness/pass.mjs` run with the test faculty credentials — the same
gap P0.5 closed for the previous batch, and it should be closed the same way before P0.2 deletes
that account.

## 2026-07-22 — Matthew Recker via Claude (fourth batch — P1.3, P1.5, P1.6/P1.15, P1.7)

### Schema — `010_user_preferences.sql`, **applied** to `app`

Preferences that follow the person instead of the browser (roadmap P1.3). `user_id` PK, one jsonb
`prefs`, `updated_at`; RLS **self-only on all four verbs**, no staff read policy and no global-admin
short-circuit — an instructor has no business knowing which theme a cadet uses. Constraints: `prefs`
must be a JSON object, capped at 16 KB so a client bug cannot turn it into a data store.

Applied during the DDL window that was already open. `prep_app_owner` **is still unsealed** — see
roadmap P0.2, which now also owns removing the test faculty account.

**Two boundaries this ran into, both worth remembering:**

- **`auth.uid()` is unusable in an `app` policy.** The app tier has no privileges on schema `auth`
  — not even USAGE — so the policy fails at CREATE time with `permission denied for schema auth`.
  `002_rls.sql` already solved this with `app.current_uid()`, which reads the same `sub` claim from
  the JWT GUC. Use it.
- **No FK to `auth.users`.** `prep_app_owner` cannot be delegated REFERENCES there (that FK on
  `instructors`/`students` was added by `postgres` directly). Not worth reopening for this table:
  the RLS predicate already guarantees `user_id` is a real signing-in user.

### Added — `prefs.js`, and a theme bug it exposed

localStorage stays the **read** path (the anti-FOUC snippet in every `<head>` needs a synchronous
theme at first paint); the row is the **durability** path. `hydrate()` runs inside `bootstrap()`
before anything reads a preference, because `sortAndPick()` reads `cp.currentOffering` while
choosing the current offering.

**"Match my system" has never worked.** `setTheme('system')` stored the literal string `'system'`,
and the `<head>` snippet does `localStorage.getItem('cp.theme') || <OS>` — so `'system'` was neither
null nor `'dark'`, and the option silently meant "always light". Absence is now the encoding, which
is what that snippet always expected. Fixed as a side effect of routing theme writes through
`prefs.js`.

**`prefs.js` imports `supabase.js` lazily**, and must keep doing so. A static import gave `theme.js`
— and therefore `nav.js`, and therefore every page's chrome — a hard dependency on a live client
just to read a cached theme. Two existing suites caught it in the same run. Same pattern
`run-banner.js` documents for the same reason.

**Not synced, deliberately:** the nav-open key, run-banner dismissals, and the System > Data column
picker. The test is whether a setting describes the *person* or the *device*.

### Added — the due-out panel (`faculty-tasks.js`), P1.6 and P1.15 as one thing

A registry, not four hard-coded queries: `SOURCES` holds `{id, severity, icon, director, load()}`
and the sixth source is an entry rather than a rewrite. Five shipped — work past due and
unfinalized · AI-suggested grades awaiting review · lessons past due with no readiness rollup ·
sections with nobody assigned · failed or stalled scheduled runs.

- **Zero renders nothing.** Most of these are empty most of the term; a row of permanent `0`s is
  how a panel teaches people to stop reading it.
- **A source that throws is dropped, not fatal** — this sits at the top of the dashboard.
- **Loads after first paint.** Five round trips should not make every dashboard load as slow as the
  slowest source. Guarded by a mount generation, not an identity check: `ctx` is the *same object*
  across a course switch, so `CTX === ctx` cannot distinguish a stale response and a slow phys-110
  load would have painted its boxes over phys-215.
- Two sources are director-only **as a UI convention** — RLS admits any staff member of the
  offering to `analysis_reports` and `analysis_runs`, exactly like the run banner. A test pins the
  list so the convention cannot quietly lapse.

### Changed — rollup objective charts, and the dashboard's two scope controls

- **P1.5:** understanding-by-objective now defaults to an **integer histogram** reusing
  `effortChart()`'s markup and ramp exactly. The effort chart directly above it is an integer
  histogram of the *same* 0–5 measure; drawing the two in different visual languages invites the
  reader to assume they are different kinds of quantity. The KDE curve is kept, fully working, and
  selectable from Account → Preferences.
- **P1.7:** an inline **course switcher** on the dashboard (segmented up to four, `<select>` beyond),
  and the section control **can finally pick a section** — it was all-vs-mine only, so "how did M3A
  do?" had no answer on that page.

### Added — `tests/browser-harness/`, and `scripts/test_faculty_account.py`

Optional dev tooling, gitignored deps, nothing on the deploy path (CORE.md §2). The harness drives
real Chrome through a local server against the live project, walks a page list in light or dark, and
reports console errors, uncaught exceptions and failed requests per page. Screenshots go to the
**session scratchpad and the harness refuses to write inside the repo** — faculty pages render real
cadet names, and a PNG is the easiest way to commit a roster by accident.

`scripts/test_faculty_account.py` creates, re-tiers and removes the P0.5 test account's `app` rows
(dry-run by default). The create and the teardown live in one file on purpose: a teardown that
exists only as a sentence in a roadmap does not happen.

### P0.5 — done. The walkthrough ran, as all three tiers, in both themes

A course director created and confirmed `prep.test.faculty@usafa.edu` in the dashboard (it took
three attempts — see below); `scripts/test_faculty_account.py` wrote its staffing and flipped tiers
between passes. Results: **11/11 pages clean in light and again in dark**, and **13/13 director ·
11/11 instructor · 13/13 global admin** on the targeted assertions.

Seven items' worth of never-looked-at UI is now looked at — P0.6, P0.8, P0.9, P0.10, P0.11, P0.13,
and this batch's P1.5/P1.6/P1.7. Everything the promotion touches has been seen, which was the last
thing standing between P0.1 "prepared" and "run it".

**`checks.mjs` asserts, rather than screenshots.** Most of what P0.5 verifies is something being
*absent for the right role* — the KDE tuner for an instructor, director-only task sources, a name
that must not be in the DOM — and absence is exactly what a screenshot review misses, because a
missing panel looks like a page that never had one.

**Two things the pass could not reach**, recorded rather than glossed:

- **The late chip (P0.12) has nothing late to render.** The active preflight is due Aug 9; today is
  Jul 22. The logic harness covers 16 cases including the extension boundary, but the rendering is
  unexercised until real work arrives late. Re-check in week one, alongside P1.14.
- **`provision-students` and `reset-student-password` on a successful path.** Both mutate real cadet
  accounts and there is no throwaway cohort. Their *gating* verified clean — all five edge functions
  correctly refuse a caller whose JWT does not already resolve to director/admin — but the happy
  path needs a disposable *student*, which a disposable instructor cannot substitute for.

**Two findings that are not bugs.** The rollup showed character-identical student quotes: not a
sampler fault (`sampleN` splices without replacement, and there are no duplicate submission rows) —
**16 distinct answers are shared by up to 4 students** because the seeded training data draws from a
small template pool. And a `--role` re-tier was deleting *every* staff row, which unstaffed the test
account from phys-110, made the course switcher correctly vanish, and read as a P1.7 bug for several
minutes; the delete is now scoped to the offering being re-tiered.

**One harness bug, caught by looking.** `pass.mjs` only treated a bounce to *login* as a redirect,
so when `report.html` sent an unresolvable lesson id to the dashboard it reported a clean pass — and
the screenshot filed under "rollup" was the dashboard. It now flags landing on any path other than
the one requested. A harness that reports a false pass is worse than no harness.

### Why P0.5 was blocked first, and the boundary that caused it

Attempted, on the assumption that an unsealed database was enough to mint a faculty login. **It is
not.** All three `prep_app_*` roles read `app` fine and every one of them is `permission denied for
schema auth`; `claude_code_recker` likewise. Public signup mints a user but the project has
`mailer_autoconfirm=false` and PREP has no SMTP, so it lands unconfirmed. All five edge functions
correctly require a caller JWT that already resolves to director/admin, so none bootstraps the first
account. `~/.claude/skills/preflight-analyze/config.json` is absent on this machine, so the Admin
API is unreachable too — which also means **`/preflight-analyze` cannot run here**.

Creating the account in the dashboard took **three attempts** — the first two would not authenticate
with a correctly copy-pasted password, most likely because duplicate unconfirmed users existed on
the same address (one of them from the signup probe above). Delete the strays; P0.2 records the ids.

**And the teardown is one step, not three — the opposite of what this file first claimed.**
`app.instructors.id` references `auth.users(id)` **ON DELETE CASCADE** (verified against
`pg_constraint`), and `staff_assignments` cascades from `instructors`, so deleting the account in
the dashboard takes the app rows with it. Established the hard way: `--remove` found nothing to
delete because the dashboard had already done it. Note the asymmetry — `app.students.auth_user_id`
is **NO ACTION**, so deleting a cadet's auth user fails rather than tidying up. Do not reason from
one to the other.

### Changed — `ROADMAP.md` is now open work first, archive last

*Director's request, mid-session.* The priority bands (§1–§4) hold **open items only**; finished
ones move to a new **§8 Completed**, grouped by the band they came from. P0 went from thirteen
entries to the three that are actually left, which is the point — the file is read to find what is
outstanding, and ten resolved items above three live ones buries the answer.

Moved, never deleted: most of those entries record a *decision* (why a request turned out to be
wrong, why something was built a particular way), and that is what stops a settled question being
re-opened. Numbers never change, so a reference to P0.9 still finds P0.9. A **partly** done item
stays in its band — P1.12 still has a whole-section grant outstanding. The convention is written
into the file's header so the next person maintains it rather than re-piling the top.

### Verified

`tests/app-schema` **339/0**, plus the isolated suites: rollup 190/0 · system-prefs 12/0 ·
run-banner 22/0 · **prefs 28/0 (new)** · **tasks 19/0 (new)**. `test-db-schema` table count bumped
23 → 24 and `db-schema.js` regenerated. Test-cadet cleanup extended to `user_preferences`.

**P1.3 is verified in a real browser**, not only under Node: a signed-in page load wrote
`cp.currentOffering` to the row, and all five student pages came back clean. **P1.5, P1.6 and P1.7
are logic-verified but have not been looked at** — they need a faculty session, so they are folded
into P0.5 alongside the four fixes already waiting there.

Both `supabase/admin/` DB suites re-run against the live database after the migration —
**22/22 invariant, 35/35 RLS** — since a new table with new policies is exactly the kind of change
that can shift a policy count out from under them. It did not.

### Docs — one real correction, and a source list that had been silently short

`check_doc_sources.py` flagged `director-schema-reference.md`, and it was **genuinely wrong**: the
page opens "the diagram shows every table" and migration `010` had just added one. Fixed properly
rather than by bumping a date — the intro now says which tables sit outside the four layers and why,
and there are new sections for `user_preferences` and for `analysis_runs`.

**`analysis_runs` was undocumented for two days and the check never said so**, because that doc's
`sources` list stopped at migration `006`. Migrations `007`–`010` are now registered, with a note in
`DOC-SOURCES.json` saying to add each new one — a stale-detector that is not watching the file it
should be watching reports green for the wrong reason, which is worse than reporting red.

The other flagged documents were **deliberately not touched.** They are the pre-existing backlog
recorded in roadmap §5, flagged by the third batch's `CORE.md`/`PROJECT.md` edits, and clearing them
means reading each against its sources — precisely the work the mechanism exists to force. The two
that my changes newly touched (`instructor-accounts.md`, `student-getting-started.md`) were read:
neither says anything about preferences or theme, so neither was made wrong by this batch.

---

## 2026-07-22 — Casey via Claude (third batch)

### Added — the Help centre warns readers off topics that are due for review

`check_doc_sources.py` has been red for a while (7 documents, 5 of them help topics), and the
backlog is not going to clear today. Until it does, the people reading those pages had no way to
know — a help doc that has drifted looks exactly like one that has not. The warning is the interim
answer: it does not fix the docs, it stops them being read as if they were verified.

- **Chip on the index card** and a **warning above the content**, on any topic whose sources moved
  after its `reviewed` date.
- **Two voices, by tier.** Staff are shown which source files changed, because they are the people
  who can act on it. Students are told the page may be out of date, to trust the screen over the
  page, and to ask an instructor — a path like `.ai/instructions/CORE.md` on a cadet's page reads
  as a malfunction, not a caveat. The tier check that keeps them apart is one comparison, and it is
  tested.
- Neither wording claims the page **is** wrong. The check compares dates, not content; all it
  establishes is that nobody has re-confirmed the page since the system moved under it.

**How it works, and the part to be careful about.** A browser cannot run `git`, so the verdict
cannot be computed live. `check_doc_sources.py status --write` generates
`site/app/help/DOC-STATUS.json` and the Help page reads that. Being a snapshot, it can go stale
itself — so it stamps the date and commit it was generated at, the banner shows the reader *when
the check ran* rather than implying it is live, and `check` now prints a reminder when the
published file disagrees with the live verdict. It is generated from **committed history only**:
an early version honoured the working tree and flagged a topic purely because `styles.css` was open
on the machine that ran it, which would have been non-deterministic between operators and about a
change no reader could see yet.

A missing or malformed status file renders the Help centre exactly as before, with no warning
anywhere. Help is what a locked-out or confused person reaches for; it failing closed because a
developer tool did not run would be a worse bug than the staleness it reports.

*Verified:* new `tests/app-schema/test-help-status.mjs`, **22/0**, covering the chip/banner counts
per viewer tier, the staff-vs-student split (including that no internal source path reaches a
student page), and four degradation paths — absent file, corrupt JSON, unexpected `stale` shape,
null entry. Registered in `run.mjs`; full suite exit 0 (339/0 + 190/0 + 22/0 + 12/0). **Not yet
seen in a browser** — folded into P0.5.

*Not done, deliberately:* nothing was triaged and no `reviewed` date was bumped. More changes are
expected today, so a bump now would attest to a review that did not happen and would be invalidated
within hours. The 5 flagged help topics stay flagged, which is the accurate state.

---

## 2026-07-22 — Casey via Claude (second batch)

### Fixed — `lesson_aggregate.py` told the operator to deactivate a live course offering

`_lesson_meta()` refuses to guess when a slug matches more than one active offering, which is right.
Its message was not: it said *"deactivate the stale course_offering before aggregating"*
unconditionally, and named only the **term** codes. But the case that actually occurs is
`preflight-02`, which is an assignment slug in **both phys-110 and phys-215 in the same term, both
live** — confirmed against the database 2026-07-22. Nothing is stale, and an operator following the
instruction would have taken a live course offline.

The message now distinguishes the two situations, because the remedy is opposite in each:

- **Same term, different courses** — lists each course with the course-scoped activity slug to re-run
  with (`--lesson phys-215-preflight-02-written`), states that both are live, and says explicitly
  *do not deactivate either one*.
- **Different terms** — keeps the deactivation advice, since a finished term left active genuinely is
  the likely cause, and names the courses and terms so the human can tell which.

### Fixed — `status` could not see a written-only lesson, including in its unfiltered listing

Recorded on the roadmap as "`status --lesson` cannot report a question-only lesson". It is worse than
that. `cmd_status` **inner-joined** `activities` on `modality = 'interactive'`, so an offering with no
interactive activity was dropped from the results entirely — not merely unfilterable, but absent from
the plain `status` listing too.

`migrate_public_to_app.py` gives every assignment a `written` activity and an `interactive` one only
where a claimed artifact existed, so **most of a term is written-only**. `status --day <DAY>` is the
verify step after every write-back in `/lesson-cycle`, and it was answering *"No analysis_reports rows
yet"* for lessons that had aggregated correctly. A false negative on the check that exists to catch a
failed write is worse than having no check.

Identity is now the **assignment** (the lesson), which always exists; the `--lesson` filter accepts
either the assignment or an activity slug, matching `_lesson_meta`'s documented contract. Activities
are resolved by **offering id** rather than by slug — the row already names its offering, and going
back through slug resolution would have let a slug shared by two courses abort the whole listing via
the ambiguity guard above. The lesson column is course-qualified only when the listing spans more
than one course.

*Verified:* `aggregate_summarize_test.py` ALL PASS, with a new block covering both branches of the
ambiguity message (including that it never emits a literal `None`, and that the cross-course branch
omits the deactivation advice entirely). The `status` change is **exercised only by syntax and
review** — reproducing it needs a live DB connection, so a signed-in run against a written-only
lesson is still owed.

### Added — unrecognized AI flags are surfaced instead of dropped (roadmap P1.13)

`flags` is a field in the frozen `schema: 1` contract but its **values are not enumerated**, so the
artifact and `/preflight-analyze` both coin keys freely. Every surface enumerated a hard-coded
whitelist — the pill bar's five keys, the rollup's two booleans — and the student panel read exactly
one free-text key, `flags.note`. Any other key either producer emitted was **silently dropped
everywhere**. Per the director's Q4 decision: never drop, never error, show what the AI was thinking.

- **`residualFlags()`** (`faculty-rollup.js`) returns a student's unrecognized flags as `[key, detail]`
  pairs. A `false`/null/empty value is a flag the producer explicitly **cleared**, not one it raised,
  and is dropped — otherwise every student carrying `{suspected_ai: false}` would surface as flagged
  and the container would be noise rather than signal.
- **The student summary panel** gains an "Other flags" row rendering `key — detail` verbatim,
  deliberately **unstyled** (no colour class, key shown as raw code): presenting an unrecognized flag
  in the vocabulary of the recognized ones would assert a meaning PREP has not agreed to.
- **A neutral pill** in the flag bar, described by the keys actually coined rather than by a fixed
  meaning. This goes slightly beyond the roadmap's wording ("uncounted and unstyled"), on the grounds
  that a container reachable only by opening students at random would make the taxonomy work (P3.3)
  no more observable than dropping the flags outright. It is counted **per student**, matching the
  modal it opens, and kept out of the two recognized tallies.

`summarizeReports()` now returns `flags.other` (per key, commonest first) and `flags.otherStudents`
(per student).

*Verified:* `tests/app-schema/test-rollup.mjs` **190/0** (30 new, covering value coercion, cleared
flags, untrusted non-object payloads, and the per-key vs per-student split), full `tests/app-schema`
run exit 0 (339/0 + 190/0 + 12/0). `report.html`'s inline module syntax-checked by extraction.
**Not yet seen in a browser** — folded into P0.5.

*Deliberately not changed:* `lesson_aggregate.py`'s Python `summarize()` still tallies only the two
recognized booleans. Teaching the aggregator to write about flags whose meaning is undefined belongs
with the taxonomy (P3.3), not ahead of it.

---

## 2026-07-22 — Casey via Claude

### Added — grant extensions directly from the rollup's "Did not submit" list

The list of who has not submitted was already on the page; making the reader carry those names to
another page to act on them is what made the legacy version inert. Now:

- a quiet per-row **Extend**, appearing on hover — twenty rows of loud buttons would read as twenty
  things demanding attention rather than one list with an action on each;
- **checkboxes with select-all** and `Extend selected (N)` for a batch.

Both open one modal defaulting to a week out at **2359 local** — the shape every deadline in this
system takes (CORE.md §2). It calls the Grade tab's own `setExtension()` rather than composing a
second upsert, so the two surfaces cannot drift on what an extension is, and re-granting **amends
rather than duplicating** (the `(enrolment, offering)` UNIQUE key). One reason covers a batch:
`reason` is NOT NULL and non-blank-checked since `007`, and a group extended together shares its
cause. Writes are sequential, so a partial failure is reportable per student rather than collapsing
into one rejected promise.

A student with no enrolment row cannot be extended here; that row's checkbox and button are disabled
with the reason in the tooltip rather than silently doing nothing.

### Changed — the "show all sections" toggle is no longer a button

Reported as still too prominent. It had `.tbtn` chrome, which put it in the same visual class as the
segmented control it sits beside — so an escape hatch used a few times a term competed with the
control used constantly. It is now plain underlined muted text ("show all 4" / "hide others"), closer
to a footnote, gaining colour only once it is on.

### Changed — a director's rollup now opens on their own sections; the rest is an opt-in

Reported with a screenshot: a director who teaches **one** of four sections opened the rollup to
four section tabs, three of them other people's cohorts. `vm.sections` is every section a director
may *see*, and the scope control had been showing all of it.

Sections the viewer does not teach are now **hidden behind a director-only toggle, off by default**
(`+ 3 other sections`). A director's day-to-day view of a lesson matches an instructor's, with the
wider view one deliberate click away. Instructors never see the toggle — their `vm.sections` already
contains only their own.

Deliberately **not persisted**: a director should land on their own sections every time rather than
inherit a wider view they switched on weeks ago and forgot. Two edge cases carry rules of their own —
a director with only an offering-wide staff row teaches nothing here, so hiding "their" sections
would strand them on an empty list and they get everything instead; and turning the toggle off while
viewing a section it hides falls back to their default rather than leaving the control and the
content disagreeing.

### Fixed — a combined summary did not say so on a single-section view

The screenshot showed **M1A** selected under a summary opening *"Both sections have the concept…"*
with nothing indicating it covered two. The "Combining M1A + M3A" line added earlier was suppressed
by a `!oneSec` guard — on exactly the view that most needs it. A reader on one section tab has no
other way to tell the prose is broader than their selection.

It now renders whenever the summary spans more than one section, with wording that adapts: *"This
summary covers **M1A** + **M3A** · 36 students · the charts below show M1A only"* on a single
section, *"Combining …"* on My sections.

### Fixed — "My sections" was invisible to global admins, and the scope order/defaults were wrong

Reported from the rollup: no **My sections** option. **The cause was not being a director** — it was
being a *global admin*. `resolveFacultyOfferings()` short-circuits for `is_global_admin` and never
loaded `ctx.staff`, on the reasoning that an admin implicitly staffs everything and has "staff rows
it will never have". But authority and *teaching assignment* are different questions, and a global
admin very often teaches: the course director holds the flag **and** a section-scoped staff row. With
`ctx.staff` empty, `taughtSectionIds()` returned nothing and the scope disappeared for exactly the
people most likely to want it. The rows are now loaded for that question alone; nothing derives
permission from them.

**Scope list reordered and re-defaulted**, per the director:

| | Shown | Default |
|---|---|---|
| **Course rollup** | always, and listed first | **never**, while you teach anything |
| **My sections** | only when you teach **more than one** | when you teach more than one |
| a single section | always | when you teach exactly one |

Reaching other sections is deliberate rather than where you land — a director wants that insight but
is primarily reading their own sections on this page. **My sections** is hidden at exactly one
section because it would duplicate that section's own tab.

**"All sections" is renamed "Course rollup."** It is the course-level synthesis, not a union of the
section tabs beside it, and the old label read as the latter.

**A combined summary now names the sections it covers** — "Combining **M1A** + **M3A** · 36
students" — read from the stored `section_codes`, never from the prose. An instructor needs to verify
no section of theirs was omitted, and that check has to be deterministic; an AI sentence saying "both
sections" is not evidence. Rendered as chrome, so it costs the 1200-char summary no words.

Doing that exposed a latent instance of the failure `panels()` documents in its own comment:
`section_codes` was written by the aggregator and **absent from the reader's whitelist**, so it was
stored and displayable nowhere. Added.

**No skill changed, so no re-aggregation was needed** — all four fixes are display-only and the data
they read (`section_codes`, `section_notes`) was already written by the 2026-07-22 run. Re-running
`/lesson-cycle` would have produced byte-identical output.

*Verified:* 9 new tests pinning the option list and default across four staffing shapes (teaches
two-of-four, exactly one, none, all) — `test-rollup.mjs` **169 passed, 0 failed**; full
`tests/app-schema` run exit 0; `app_invariant_test.py` 22/22; `app_rls_test.py` 35/35. **Not seen in
a browser.**

---

## 2026-07-22 — Casey via Claude

### Fixed — both `app` schema test suites were dead; they now pass (P0.3)

They died in fixture setup, so **neither had guarded anything since the migrations that broke them.**
Now **22/22 invariant checks and 35/35 RLS enforcement checks.**

- **`app_invariant_test.py`** inserted a random uuid into `instructors`, which carries an FK to
  `auth.users` created by `postgres` directly (the app owner cannot be delegated `REFERENCES` on
  `auth.users` — PREP-V2-CUTOVER Phase 1 step 3). `prep_app_dml` cannot create an auth user to
  satisfy it. It now borrows an existing instructor's id: nothing is written to that account, the id
  serves only as `unlocked_by` attribution, and the fixture rolls back.
- **`app_rls_test.py`** omitted `reason` on three `extensions` inserts, NOT NULL since `007`. The
  crash was the visible half. **The dangerous half was silent:** two of those inserts are *expected
  to be denied*, so they were rejected by the constraint before RLS was consulted and reported
  "correctly denied" while proving nothing about the policy. A crash is loud; a false pass is not.
  Added a check that a blank reason is refused.

### Added — the three legacy surfaces promotion would have deleted (P0.6)

- **"Did not submit" panel** on the rollup. Did not exist in `site/app/` at all. Sorted by section
  then name, **copyable** as tab-separated text for a spreadsheet, and linking to the Grade page
  where an extension is granted — the audit's recommendation was to rebuild it *actionable*, since
  the legacy version was inert HTML. Renders only when someone is missing.
- **"Flagged only"** one-click triage on the Grade tab, driving the existing lamps rather than
  becoming a competing third state.
- **Copy-for-slides** was already rebuilt as the rollup's quote panel — **but had inherited the exact
  flaw the audit warned about.** Of the legacy version: *"anonymity is cosmetic: names are in the DOM
  at `display:none`… If this is rebuilt, do not render names that are not meant to be shown."* The
  new panel had reproduced it — `data-name` on every card plus a `hidden` attribution div — so a
  panel whose whole purpose is being **projected in a classroom** kept every student's name one
  devtools inspection, Ctrl+F, select-all or screen-reader pass away. Names are now not rendered at
  all unless the toggle is on; toggling re-renders (preserving the selection) instead of unhiding.

### Added — `scripts/promote_app.py`, the cutover's one-way step (P0.1) — NOT RUN

Dry-run by default. Refuses on a dirty tree, a non-`main` branch, divergence from `origin/main`, or
a missing frozen-contract source. **It moves the tree and does not commit or push** — pushing *is*
the cutover (CORE.md §5) and stays a human act.

Writing it surfaced three things that a hand-run `git mv` would have got wrong:

- **It must move file-by-file.** Four targets already exist in `site/` (`css/styles.css`,
  `js/config.js`, and both frozen contract stubs). `git mv` of a directory onto an existing directory
  **nests** it — `site/app/student` → `site/student/student` — which would leave the stub in place
  and the real receiver one level too deep. That is a **silent 404 on the URL every deployed artifact
  posts to**, and unrecoverable without rebuilding every artifact by hand. The script plans 98
  individual moves and asserts both frozen paths are covered before it will run.
- **`site/app/*.md` must not be promoted.** Seven internal design notes are already world-readable at
  `site/app/*.md`; promoting them puts a file named `LEGACY-AUDIT` beside the student login page.
  They route to `docs/app/` instead. `help/*.md` and `media/icons/ICONS.md` stay, since the app
  serves them. **`docs/DOC-SOURCES.json` references some of the moved files and must be updated in
  the same commit.**
- **The move is otherwise safe.** Relative paths inside the tree survive because it moves as a unit;
  `legacyUrl()` — the one helper pointing at the deleted pages — has **zero live callers**.

### Verification for everything above

`tests/app-schema` full run **exit 0** · `app_invariant_test.py` **22/22** · `app_rls_test.py`
**35/35** · `aggregate_summarize_test.py` ALL PASS · `node --check` clean.

**`test-imports.mjs` caught a genuine bug in the new Did-not-submit panel** — it called `lastFirst()`
in `report.html` without importing it, which would have thrown at runtime on every rollup. That suite
exists for exactly this and earned its place.

**Not seen in a browser.** No faculty login is available to this harness (CORE.md §2). The
did-not-submit panel, the flagged-only toggle and the names re-render are all visual and unverified.

---

## 2026-07-22 — Casey via Claude

### Fixed — four bugs in the rollup rework, every one found by actually running it

The rollup changes below shipped with green unit tests and **still had four defects**, all of which
needed a live database to surface. Recorded because the pattern matters: the new scope type touched
code paths no fixture covered.

- **`_instructors()` selected `i.email`, which does not exist.** `app.instructors` is
  `id, name, is_global_admin` only — the sign-in address lives on `auth.users`, which this role
  cannot read. Hard crash on the first `pull`.
- **`_instructors()` was called with `offering_id` where it needed `course_offering_id`.**
  `staff_assignments` is keyed to the course offering (who staffs the term); `offering_id` is one
  assignment's run of a lesson. It returned an empty block silently, which would have cost **every
  instructor scope** with no error at all.
- **"Has this section been aggregated?" tested for fields section scopes no longer carry.** The
  check looked for `readiness_summary` or `misconception_trends`; the summary moved to the
  instructor scope and trends was retired, so a freshly-written section scope read as
  never-aggregated. Symptom: the T-day run refused to write `__all__` because the M sections it had
  just written looked untouched. Now also accepts `misconception_recommendation`.
- **`status` reported every instructor scope as `n=0 STALE`.** It matched scope keys against
  `section_id`, which an `instr:` key never equals. It now resolves an instructor scope to the
  sections it names, shows `Name [M1A, M3A]`, and reports the field that scope is actually
  responsible for (summary for instructor/`__all__`, recommendation for a section) instead of `-`.

**Also observed, pre-existing, not fixed:** `status --lesson` inner-joins `modality = 'interactive'`,
so it only accepts the *interactive* activity slug and a question-only lesson can never be reported
at all. Logged in `docs/ROADMAP.md`.

### Ran — `/lesson-cycle` on phys-215 preflight-02 (forced; synthetic training data)

Director-authorised exercise of the rework. **Forced: the 2026-08-10 deadline has not passed**, and
the run is against the seeded training cohort, not real cadets.

**Grading (Step 2) was correctly a no-op, twice over.** All 64 committed submissions already carry a
`schema:1` diagnostic; the 8 remaining are `status='draft'`, never committed, and must not be
graded. Independently, `~/.claude/skills/preflight-analyze/config.json` does not exist on this
machine, so `/preflight-analyze` could not have run via PostgREST regardless.

**Aggregation ran both day tracks** and wrote 8 scopes: four sections, three **instructor** scopes
(Casey Pellizzari over M1A+M3A, Tyler Jones over T1A, Matthew Recker over T3A), and `__all__`.
Recorded in `app.analysis_runs` as `lesson-cycle` / `partial` with the forcing and the skip both
stated in `detail`.

**Two things the run demonstrated that the tests could not:**

- **The new prose is roughly a fifth the length.** Casey's instructor summary is 387 characters
  against a 1200 cap; the stored T-day prose it sits beside — written under the old 8000-char
  allowance — runs to multiple bolded paragraphs. The contrast is visible in the same payload.
- **The misconception fragmentation is real but was not duplication.** Eight distinct ids appeared
  across 72 students, most with count 1. On inspection **seven are genuinely different
  misconceptions and were deliberately left unmerged** — merging them to make the list tidy is
  exactly the failure the skill warns against. One alias was written:
  `neutral-no-force` → `neutral=no-force`, folding a coined id onto the existing taxonomy entry in
  `PROJECT.md`. Easily reversed by deleting that map entry.

**The finding itself** (recorded here only because it is the first real output): across all four
sections 42 of 64 graded answers earned full credit, and nearly every flagged one fails identically —
it says charge was transferred and conserved **without naming the electron**. Reading time is not the
lever; T1A read longest and finished below M1A, which read least. And the points hide it: a flagged
answer keeps full credit, so T3A's grade book reads near-perfect against nine flagged answers of
sixteen.

### Changed — the lesson rollup: scoping, self-explaining misconceptions, and a durable misconception bucket

Requested ahead of the v2 cutover. Several changes sharing one payload contract, so they land
together. **Additive to `analysis_reports.payload` (jsonb) — no migration, no DDL.**

**Where misconceptions come from, and why they were fragmenting.** They are identified
**per student at analysis time** — `/preflight-analyze` for written, the artifact for interactive —
never at aggregation. Nothing validated the ids: no table, no enum, no CHECK, no code path. The
taxonomy in `PROJECT.md` covers **3 lessons out of ~74** and reaches the model only via `CLAUDE.md`
auto-inlining, so under any harness that ignores `@`-imports it is silently absent. Both producers
are explicitly licensed to coin new ids, and both counting sites keyed on the **exact string** — so
`scalar-sum`, `Scalar-Sum` and `scalar sum` rendered as three bars of one misconception. (Reading-
reflection topics had been `.trim().toLowerCase()`-ed since day one, one block away; ids never were.)

Worse, `/lesson-aggregate` **was** told to "fold novel ones into known buckets" — but the payload had
nowhere to record a fold. The mapping was computed, written as English, and thrown away; the bars it
sat under never reflected it, and the work was redone from scratch every run.

Four fixes:

- **Canonicalization at both counting sites** — `canonMisconceptionId()` in `faculty-rollup.js`,
  mirrored in `lesson_aggregate.py`. If those two ever drift, the prose cites a prevalence the panel
  beside it does not show, so a JS↔Python parity block now guards them together.
- **`/preflight-analyze` matches before it coins** — a four-step order whose first step is *query the
  ids already recorded against this assignment, across every offering and term*. That bucket is
  self-maintaining and is the answer to "can it match an existing misconception before inventing
  one". Matching is semantic, not textual; coining more than two or three per lesson is called out
  as a signal to re-check.
- **The fold is persisted** — new offering-level `misconception_aliases` (variant → canonical) and
  `misconception_glossary`, merged across day-scoped runs like scopes are, applied by the browser at
  render time. Deliberately not applied in the Python summarizer: those are the run's own inputs, and
  folding them would hide from the model the variants it is being asked to reconcile.
- **`description` and `evidence` survive to the cohort view.** Both producers emitted them, the
  aggregator consumed them, and both counting sites dropped them right before the bars — which is
  exactly why a bar could read `Scalar sum of forces — 57%` and tell a reader nothing.

**Every misconception bar now explains itself.** Hover or click for a popover with the description,
up to two verbatim unattributed student quotes, any coined ids that folded onto it, and the canonical
id. The row is a real `<button>` with `aria-expanded` — hover alone is unreachable by keyboard and
unusable on a tablet — and Escape closes it.

**The readiness summary is now written per INSTRUCTOR**, across every section they teach, with
per-section departures as structured `section_notes[]` (rendered with the section code bold, not
model-authored markdown). Two sections of one lesson taught by one person previously got two
isolated paragraphs, each written as though the other did not exist, so nothing said whether a gap
was that instructor's cohort or that one section. A single-section view borrows its instructor's
summary and keeps its own numbers, quotes and recommendation.

**Scope selector reworked.** New **"My sections"** — the sections you personally teach, combined —
is the **default for everyone**; opening a rollup on the whole course meant most readers' first view
averaged over cohorts they do not teach. `taughtSectionIds()` counts section-scoped staff rows only:
a director's offering-wide row (`section_id` NULL) grants sight of every section but is not a
teaching assignment. Teach none → falls back to All sections; teach all → the option is hidden
rather than duplicating All sections.

**"Show all N" on student responses** — swaps the 5-card random sample for the whole pool, AI picks
still pinned on top. Reading every reflection previously meant opening students one at a time.

**Retired: `misconception_trends`.** Not written, not rendered. It restated the bars in prose, and
now that each bar carries its own description and evidence it had nothing left to add — while still
costing an AI panel and a "coming soon" placeholder under fully-populated bars. Still accepted by the
writer so a replayed file does not fail; historical rows keep it.

**Prose caps are now enforced by the writer, not requested in prose.** `readiness_summary` 8000 →
**1200** (2–3 sentences), `section_notes[].note` 400, `misconception_recommendation` unchanged at
1200 but now the *only* prose in its panel. The skill additionally bans the specific tells — no
`Overall,` / `It's worth noting` openers, no three-item parallel lists, no restating the question
back, no hedging stacks, "name the physics" over "gaps in conceptual understanding".

**An instructor viewing All sections is now told when the numbers are narrower than the summary.**
`meta.n` (true course-wide count) is compared to the rows actually summarized; a mismatch renders an
explicit line. Whole-course prose previously sat silently above a partial cohort. This supersedes the
roadmap's P0.4 recommendation — the course director chose to keep All sections visible to everyone,
which is theirs to decide; what changed is that it is no longer the default and no longer silent.

**Verification.** `test-rollup.mjs` **160 passed, 0 failed** (30 new: canonicalization, alias folds,
glossary backfill, instructor scopes, `taughtSectionIds`) · `aggregate_summarize_test.py` **ALL
PASS** including the new parity block · full `tests/app-schema` run **exit 0** (339 in-process,
subprocess suites green) · `node --check` clean on every edited module.

**Two real bugs were caught by the parity tests, not by review:** the variant list compared only
lowercase while the id also collapses whitespace, so `scalar sum` was reported as a "variant" of the
id it normalizes to — in both languages. Fixed to compare fully-normalized forms, so only a genuine
alias fold is listed.

**Not seen in a browser** — no faculty login is available to this harness (CORE.md §2). The popover,
the new scope control, the section notes and the show-all toggle are all visual and unverified;
ROADMAP P0.5 enumerates what to look at.

### Added — `docs/ROADMAP.md`, and the first seven items closed out of it

**New living roadmap** consolidating a repo-wide sweep for outstanding work with the course
director's feature requests, banded P0–P3 against the **2026-08-10 term open**. Unlike
`docs/decisions/`, it is refreshed rather than superseded. It records five decisions on the record
(§6) and thirteen proposed additions awaiting a call (§7).

**Two verification findings reshaped it before any code was written:**

- **The gradebook's blocking question was already answered by the schema.** Points and effort do not
  need reconciling: `assignment_offerings.points_possible` defaults to **2**, both Fall builders
  write Q1 `0` / Q2 `1` / Q3 `1`, and the effort trigger yields `≥3 → 2`, `1–2 → 1`. Full effort is
  2 points; effort capped at 2 by a non-meaningful reflection is 1. Both modalities already land in
  `points_earned` against the same ceiling, so no normalization layer is needed.
- **Late submissions were visible but indistinguishable.** `committed_at` was fetched and shaped all
  along, and compared to a deadline in exactly zero places in the faculty UI.

### Fixed — a late submission is now visible on the grade card

New `submissionLateness()` and `lateBy()` in `js/schema.js`, beside `effectiveDue()` — which answers
a *different* question (is the deadline behind us **now**, which is what the backlog queues ask)
rather than *did this arrive late*. An amber `⏰ N days late` chip sits next to the extension chip
on the grade card, plus a **Late only** filter that ANDs with the status lamps and hides itself
entirely when nothing is late.

**Extensions are honoured** — a student granted until Friday who submitted Thursday is not badged.
That is the case the feature turns on. Amber rather than red is deliberate: arriving late is a fact
the grader should see, not a verdict, and late work is routinely accepted by hand on purpose.

*Verified:* 16/16 in a dedicated logic harness (on-time · 4-days-late · inside-extension ·
past-extension · M/T section override both directions · draft · no-deadline · 30s clock-skew grace ·
unparseable timestamp · label boundaries · an `effectiveDue` regression guard).

### Fixed — staff table rows were ragged, and only for other people

Your own row rendered a `.score-badge` (~20px) while every other row carried a `<select>` inheriting
the global form rule at ~40px, with no `td select` override anywhere — so the one row you always
look at was the odd one out, and `width: 100%` stretched the Role column. Your row now renders **the
same select, disabled**: same box, no special case, and it states "you cannot change your own role"
in the place the role is changed. New `.staff-tbl` CSS gives every role cell a `min-height` so the
text-only *implicit* global-admin rows match too. Handler scoped to `:not([disabled])`.

### Changed — student responses are now 3 AI picks **+ 5** random, not 5 total

`responsesSection()` capped the panel at ~5 cards via `Math.max(0, 5 - ai.length)`, so every AI pick
displaced a random one — a well-analysed section showed the *least* unfiltered student writing.
The random sample is now a fixed 5 independent of the AI count. `/lesson-aggregate`'s
`selected_quotes` moves from "2-3 each" to **exactly 3**, updated in all four places it was stated,
with a note that emitting fewer now shrinks the showcase and that padding to 3 with a weak pick is
wrong.

### Changed — the KDE tuner is behind `?kde=1`

`mountKdeTuner()` was mounted for every director on every rollup, where a floating panel of
unexplained sliders reads as product rather than dev tool. Now requires `?kde=1` **and** director
role. Code untouched — it is the only thing that regenerates the KDE const line. A query param
rather than a stored preference, so nobody can switch it on, forget, and file it as a bug later.

### Fixed — five stale documents, one of which would have misled the gradebook build

- **`PROJECT.md`** documented `scores.question_scores` with each question at `max: 5` — the retired
  15-point shape on the retired `public` table. Corrected to `grades.question_scores` at 0/1/1, with
  the offering ceiling and the zero-point-question rule stated, **and an explicit warning not to
  "correct" the 0–5 effort/understanding diagnostics alongside it.** Those are a different layer and
  are current. Getting this wrong in either direction breaks the gradebook.
- **`LESSON-UNIFICATION.md`** got the supersession banner owed since 2026-07-21, naming
  `PREP-V2-DATA-MODEL.md` as its replacement and warning that its open phases describe a path not
  taken — migration `021` implements it and is deliberately never applied.
- **`COURSE-ADMIN-INVENTORY.md`** §2D claimed *"only system admins can add/remove the `system_admin`
  role."* **That guard never existed** — legacy `create-instructor` read the flag as a second
  global-admin marker, so a course director could create system admins. Corrected with the reason,
  since the risk is documentary: an operator reading it would conclude the legacy behaviour was safe
  and restore it. Staff management and Export marked ported (both shipped 2026-07-20); the
  extensions note now points at `app/007` instead of the never-applied `021`.
- **`site/app/README.md`** still said two director features blocked promotion. Both shipped.
- **`tests/browser/test-admin.html`** rendered "Send reset email" with no supersession marker, unlike
  its sibling `test-account.html` which deliberately archives the same flow behind one. Given the
  matching banner; its "Password operations" card relabelled `Planned` → `Superseded`.

**Deleted:** `site/app/student/interactions.html`, orphaned since the nav rework — nothing links to
it and its `active: 'interactions'` key no longer exists. `loadInteractionStatuses` was **kept**:
still exercised by `tests/app-schema/test-student.mjs`.

**Discovered while doing it:** `faculty/interactions.html` was already deleted on 2026-07-20, but
several docs still describe it as present and load-bearing ("cannot be deleted until that moves").
Anything reasoning from those will reach wrong conclusions about what promotion still costs. Logged
in the roadmap.

### Not done, deliberately — the email-reset cleanup was mostly a bad idea

Investigating "remove all reference to email reset" found the references are almost all **denials**
of it, which is documentation, not debt:

- **`site/app/reset.html` kept.** It is not a reset flow; it is the page telling a locked-out person
  there is no email reset and who to ask. The login page linked there for a year, so bookmarks still
  point at it, and a 404 is the worst possible answer at the moment someone is locked out.
- **Its `DOC-SOURCES.json` entry kept** — a correct dependency, not a stale one.
- **Help-doc mentions kept** — every one is a denial, correctly phrased.
- **`tests/browser/test-account.html` kept** — already banner-marked as a deliberate design record.

Exactly one artifact still presented the removed feature as available (`test-admin.html`, above),
and only that one changed.

**`check_doc_sources.py` is red — 11 documents — and was left that way.** The flags are dominated by
a `CORE.md` edit earlier the same day, not by this batch. They were **not** cleared by bulk-bumping
`reviewed` dates, which is exactly the failure the mechanism exists to prevent. Confirmed harmless
for the gradebook work: no help doc states a points value, so the `question_scores` correction did
not invalidate any of them.

**Verification for everything above:** `node --check` clean on all three edited inline HTML modules
and five JS modules; the 16-case lateness harness; and the full `tests/app-schema` suite green at
**339 passed, 0 failed** against the live database. **None of the four visual changes has been seen
in a browser** — no faculty login is available to this harness (CORE.md §2: a Node-only check is
never the sole verification). The specific things to look at are enumerated in ROADMAP P0.5.

---

## 2026-07-22 — Casey via Claude

### Fixed — lesson editor showed 5 questions instead of 3 (and would have saved 5)

**Frontend only (`site/app/faculty/lessons.html`). No database or lesson-content change — the stored
data was always correct.** Reported from the Lessons tab: editing any lesson, and its **Preview**,
showed **5 questions** where every lesson has 3.

**Root cause.** `ensureDefaultQuestions()` decided whether the two pinned questions (Q1 reading-time,
Q2 reading-reflection) already existed by checking **`q.role`** only. The Fall builder
(`build_fall_preflights.py`) created every question **without a `role`** — verified live: 222/222
questions carry no role. So the check always failed and the editor **injected a second reading-time
and a second reflection question** on top of the real q1/q2, yielding 5 with those two duplicated.
The displayed "Q3" and "Q4" were the injected duplicates, which is why deleting them *looked* right —
but the stored data was never wrong, and there is no q4/q5 to delete.

**Also a latent data-corruption bug, caught before it bit.** On **Save**, `model.questions` (5) is
written to `activities.content.questions`, so one edit-and-save would have permanently corrupted a
lesson to 5. All 74 lessons were still clean at 3, so nothing had been saved through the buggy path.

**Fix.** `ensureDefaultQuestions()` now finds an existing pinned question by **role → prompt text →
position (q1/q2)** — the same resolution `schema.js` `pinnedQuestion()` and the analysis skills
already use — and **stamps the role onto the existing question** instead of adding a duplicate. A
brand-new lesson still gets its two defaults created; a subsequent save now writes a clean,
role-tagged 3-question lesson (additive — `role` is what every other consumer already expects).

**Verification.** A logic harness over the exact edited code passes 10/10: existing lesson stays 3
with roles stamped and the JiTT question untouched; new lesson creates exactly 2 defaults; idempotent
on repeat calls; lab-worded lesson resolves Q2 by position; already-tagged lesson unchanged. `node
--check` on the file's inline module: syntax OK. **Confirmed in the browser by the course director**
— the editor and its Preview now show 3 questions. (The automated harness cannot log in as faculty,
so this final rendered check was human; the deterministic logic and the data were confirmed here.)

---

## 2026-07-21 — Matthew Recker via Claude

### Added — `worklist`: how a run picks its lesson, and why the two paths differ

`/lesson-cycle` took a lesson slug and did nothing else, which is fine typed by hand and useless
to a scheduler — the slug changes every lesson, so a Task Scheduler entry would re-run the same
one nightly forever. New `lesson_aggregate.py worklist --course <code> [--day D] [--latest]
[--json]` answers "what is past due here and has it been analyzed", per **day track**, since a
lesson's M and T sections close on different days.

**The automated path is deliberately short-sighted.** `--latest` reports only the most recently
due track and whether to run it. It never walks backwards, and the reason is the extension case:
a student on an approved extension submits days late, and late submissions are accepted by hand —
**both are graded manually on purpose.** An older lesson can therefore look "unanalyzed" for
entirely legitimate reasons, and a scheduler that swept up everything outstanding would re-grade
those cohorts unattended and overwrite exactly the human judgement that handling them by hand was
for. One lesson: the one whose deadline just passed.

**The manual path shows the list and asks.** Every past-due track with its deadline, sections,
submission and assessment counts, and analysis state. It does not default to the newest — a human
running this by hand usually wants an *older* one, having just graded a late submission. Re-running
an analyzed lesson is explicitly supported and safe: grading skips finalized and instructor-edited
rows, aggregation merges per scope.

Extensions are **not** consulted when deciding whether a track is closed. A cycle waits for the
section deadline, not the last extended student — otherwise one extension holds the whole class's
rollup hostage.

"Never analyzed" requires **both** no successful run *and* no stored analysis: `analysis_runs` is
newer than the analyses themselves, so a lesson aggregated before the audit trail existed has a
real rollup and no run row, and calling that unanalyzed would invite a pointless re-run.

Verified against live data — the query returns one row per lesson per day track with M closing a
day before T, section grouping, and the submission/assessment/analysis counts correct for
preflight-02. It currently reports nothing past due for either course, which is right: Fall 2026
opens 2026-08-10.

### Added — `app.analysis_runs` audit trail + a director-facing run-status banner

**Migration `009_analysis_runs.sql` — APPLIED to the live database on 2026-07-22.** One row per
analysis run, whoever started it: skill, `invoked_by` (`human`/`scheduled`), actor, scope, status,
timings, a one-line summary, per-skill counts in `detail` (jsonb), and `error`. `db-schema.js`
regenerated (23 tables).

**Why not `CHANGELOG.md`.** CORE.md §0 asked for a file entry per state-changing run. A term is
~40 lessons closed out twice each — 80+ hand-written entries that would bury what this file is
read for, in a medium no instructor can read. CORE.md §0 now carves routine analysis runs out;
schema changes, bulk corrections and one-off repairs still belong here.

**The row is written before the work, not after.** A run that dies mid-way is the case an audit
trail exists for, and a row written only on success loses exactly that one. A row still at
`status='running'` is a crashed or abandoned run and reads as such. There is deliberately **no
write policy** — only the service tiers write, and they bypass RLS; an audit trail a signed-in
instructor can append to is not one.

**New `site/app/js/run-banner.js`**, mounted from `renderNav()` so it appears on every faculty
page. Shows the latest **scheduled** run per offering: success (24h window), a warning for a
partial pass, an error for a failure or for a run still `running` two hours after it started.
Dismissals persist in `localStorage`, bounded to the newest 200 ids.

- **Directors see every course they direct, not just the one they are viewing** — a phys-110
  failure must not hide because they are looking at phys-215. `ctx.courses` already carries one
  entry per staffed offering with a `role`, and a global admin gets `role:'director'` on all of
  them, so filtering on that expresses both rules at once. RLS does **not** enforce this:
  `analysis_runs_read_staff` admits any staff member, so director-only is a UI convention here,
  like the `__all__` rule on the rollup.
- **"Until corrected" needs no clearing step.** Only the latest run per offering is read, so a
  failed Monday stops showing the moment Tuesday succeeds.
- **`skipped` shows nothing.** It is a correct outcome (deadline not passed, nothing to grade);
  surfacing it would train directors to ignore the strip.

**One dependency mistake caught by the suite:** importing `supabase.js` at run-banner's module
scope gave `nav.js` — which every page renders — a hard dependency on a live client just to draw
the chrome, breaking `test-nav` and `test-legacy-actions`. The client is now imported lazily
inside the query. Those two suites were right to assert it.

`tests/app-schema/test-run-banner.mjs` (12 assertions) covers the decision rules — the old-failure
case that must keep showing, the stale-`running` case, and `skipped` staying silent. Full suite
green: 127 + 12 + Python + 339.

**Still unverified in a browser** (CORE.md §2) — no faculty login available to this harness, so
the strip's placement and dismissal have not been seen rendered.

### Changed — grading and aggregation split cleanly; new `/lesson-cycle` runs both

**Asked for:** one skill that grades a lesson and then aggregates it, runnable by hand or from a
scheduler — with the load moved so `/preflight-analyze` does no aggregation at all, and
`/lesson-aggregate` owns the class *and* per-section rollups including the question-level analysis.

**`/preflight-analyze` is now purely per-student.** Its Step 8 — a per-instructor, per-question
summary written to `analysis_reports` (`kind='by_question'`, `audience_id` = the instructor) — is
deleted, along with the `staff_assignments` lookup (Step 4b) that existed only to group it and the
per-instructor layout of its printed report (Step 10, now per section). Two reasons it had to go:

- **An instructor is not a unit of analysis.** One live row pooled Casey Pellizzari's M1A *and*
  M3A — "median 30 min across **32 submissions**", "**31/32** received full credit" — so it could
  never be shown on a section view, and there was no per-section decomposition stored to split.
- **`audience_id` bought nothing.** `ar_read` (`002_rls.sql:374`) is an OR chain whose
  `scope='assignment_offering'` clause already grants every such row to any staff member of the
  offering. It widens access; it never narrows it. The rollup rendering all three instructors'
  blocks was that assumption failing in production, and a comment in `faculty-rollup.js` asserting
  the opposite has been corrected.

**`/lesson-aggregate` absorbed the question-level material and learned to run per day track.**
`pull` gained `--day`, which scopes *which sections get a full pass*; the rest arrive as
`prior_scopes` — their stored prose plus fresh numbers, no `reports[]` — so the second run
synthesizes the whole-course scope from section summaries instead of re-reading the first day's
cohort. That was the explicit ask, and the saving is real but it is **model context, not database
work**: `_load_reports` is one query over the offering either way.

**Two correctness decisions worth knowing:**

1. **`__all__` numbers are always recomputed over every live row, never recombined from sections.**
   Counts and histograms would sum exactly, but `reading.median` is unrecoverable from stored
   medians and every mean is `round(…, 2)`, so recombining rounded section means drifts
   invisibly — and `understanding.gap` doubles it. The browser recomputes the same figures from raw
   rows for its All-sections bars, so drift is prose disagreeing with the bar beside it.
2. **`__all__` is not written at all while coverage is incomplete.** A whole-course prose covering
   half the course with numbers covering all of it disagrees with itself, and the UI cannot tell:
   `aiGenNote()` flags staleness only when `meta.n !== scopeN`, which here would be *equal*, so it
   would render as fresh and authoritative. `pull` reports `coverage.complete` and sets
   `scopes.__all__.write`. Between the two runs `status` shows `__all__` STALE — that is the signal
   the second pass is owed, and it is the only automated one.

**New in the pull file:** a `questions` block (the graded concept questions with prompt and
`expected_response`, identified by *excluding* the two pinned questions — 0 of 74 live activities
carry a `role`, so a role lookup would be dead code), per-report `responses[]` carrying the
verbatim graded answer with its 3-state status, and `numbers.questions` tallies so "23/32 earned
full credit" is a cited figure rather than a hand-count. `question_scores.feedback` is deliberately
**not** carried — it is prose written for one student, and letting it in is how individual feedback
gets laundered into cohort text.

**New field `misconception_recommendation`** (ROLLUP-AGREEMENT §7): one teaching action, ≤1200
chars, single paragraph, rendered as its own line under the trends prose. Its own cap on purpose —
reusing the 8000-char limit invites a second essay in a slot the UI renders as one line. Allowed on
`__all__`, unlike quotes.

**Rollup UI.** The By-question block and its `.bq-*` styles are deleted; `BY_QUESTION_KEY` and the
by_question routing are gone from `loadAnalysis()` (retired rows still in the database are now
skipped, so they cannot overwrite a real cohort scope). The trends heading is scope-aware —
"Trends across the course" vs "Trends in M1A". **The reading-time panel now renders whenever Q1 was
asked**, not only when someone named a duration: it is Q1's only home now, and a cohort that all
answered without stating a number previously showed nothing at all, which read as "nobody was
asked" rather than "nobody said".

**New skill [`.ai/skills/lesson-cycle/SKILL.md`](.ai/skills/lesson-cycle/SKILL.md).** Sequences the
two, adds the checks that only make sense between them (deadline passed; grading actually produced
the `schema: 1` assessments aggregation consumes; `__all__` only once every section exists), and
skips the grading half entirely for a lesson with no graded free-response question. Both sub-skills
remain independently invokable.

**Unattended operation is documented, not built.** No wrapper script and no scheduler artifact —
the repo has neither today, and CORE.md §2 keeps tooling to stdlib Python. The skill documents the
`claude -p "/lesson-cycle …"` invocation and Task Scheduler setup. **Two things it deliberately
does not do:** it does not pretend to satisfy CORE.md §0's coordination gate (an unattended job
cannot designate an operator; the clean-tree and divergence refusals are a *mitigation*, and the
skill says so), and **it does not push.** CORE.md §5's standing authorization names
`/preflight-analyze` and covers that skill's run record only. Widening it to cover a skill that
also writes cohort analysis is the director's call, not this skill's assumption.

**Live DB change:** the 3 orphaned `kind='by_question'` rows (Casey Pellizzari, Tyler Jones,
Matthew Recker; offering `eb5fc51c`) were snapshotted to JSON, verified against live counts, then
deleted with an explicit `--commit`. `analysis_reports` went 4 rows → 1. No DDL, no migration; the
payload is `jsonb`.

**Verification.** Full suite green — 127 JS rollup assertions, 339 schema/live, and the Python
engine, which **is now wired into `tests/app-schema/run.mjs`** (it was referenced in two comments
and run by nothing). New Python cases cover `_meets`, `_answer`'s two stored shapes and truncation,
the per-question tallies, the empty-vs-zeros gate an interactive cohort depends on, and
`_graded_response_questions` **against the lab-lesson wording** — that last one matters because a
lab's Q1 says "reading the lab instructions" and its Q2 is the same reflection, so if either pinned
needle ever stops matching, every reading reflection silently lands in the concept-question
analysis. Live: `pull --day M` and `--day T` both verified against phys-215 preflight-02 (`q3`
resolved by exclusion, `prior_scopes` carrying the other day's stored prose, `coverage.complete`
true), and `write-analysis --dry-run` confirmed to accept a well-formed scope and reject both a
multi-paragraph recommendation and quotes on `__all__`.

**Not verified: the browser.** The rollup needs a faculty login this harness lacks, so the deleted
By-question block, the scope-aware heading, the recommendation line and the always-on reading panel
are unproven visually (CORE.md §2). That is the one gap between "tests pass" and "it looks right".

**Also picked up, not mine:** migration `008_student_identity.sql` landed mid-session and added
`roster_imports` to live `app` without its follow-ups. `db-schema.js` has been regenerated (22
tables), the table-count assertion bumped 21 → 22, and a curated column list added in
`system-prefs.js`. Combined with the restored interactive runs recorded below, the phys-215
preflight-02 cohort is now genuinely mixed (8 interactive + 64 written) — **the stored analysis
from this morning's run describes a cohort that no longer exists and should be regenerated with
`/lesson-cycle`.**

### Data — restored the archived Lesson 02 faculty interactive runs into schema `app`

**Live `app` database write (data only, no DDL). The Lesson 02 rollup is now a mixed cohort.**

Schema `app` held 64 *written* preflight-02 submissions and **zero interactive ones**, so
`/lesson-aggregate` could only ever describe one modality for that lesson. The interactive
activity was wired correctly — it just had no work behind it.

The missing work existed: in June 2026 faculty worked the Lesson 02 Claude artifact end-to-end
*as if they were students*, producing 8 real schema-1 reports. Those were exported to the POC
archive and then wiped by the Fall 2026 database reset. As of this change,
`public.preflight_interaction_reports` is empty (0 rows) and the only surviving copies were
[`scripts/fall2026/poc-archive/reports_lesson-02-electric-charge-and-coulombs-law.json`](scripts/fall2026/poc-archive/reports_lesson-02-electric-charge-and-coulombs-law.json)
(8 rows, full `report_data`) and the 6-row `preflight_interaction_reports_backup_20260623`
table (markdown only, no structured data).

**New script** [`scripts/app_migration/seed_faculty_interactive_lesson02.py`](scripts/app_migration/seed_faculty_interactive_lesson02.py)
— dry-run by default, idempotent, single transaction, runs as `prep_app_dml`. Applied with
`--commit` after a clean dry run.

What it wrote to the phys-215 / fall-2026 `preflight-02` offering:

| Rows | Table |
|---|---|
| 8 | `app.students` — new synthetic cadets `3000980000`–`3000980007` |
| 8 | `app.enrollments` — two per section across M1A, M3A, T1A, T3A |
| 8 | `app.submissions` — `status='draft'`, `chosen_activity_id` NULL |
| 8 | `app.submission_activities` — interactive activity, `is_final=true` |
| 0 | `app.grades` — deliberate |

**Report content is byte-for-byte unmodified** — the effort scores, misconception findings,
objective ratings and reading reflections are the faculty runs' own. **Only the student identity
is synthetic**, because the original cadet IDs (`3000100001`–`3000100020`) were deleted from
`students` in both schemas by the reset and `app.enrollments` requires a live student. Every row
carries `content.source_provenance` recording the archive path, the original cadet ID, the
original interaction slug and a `restored_by` tag, so the re-identification is auditable and
reversible.

Three judgment calls worth knowing:

- **The slug changed on purpose.** The archive is filed under
  `lesson-02-electric-charge-**and**-coulombs-law`; the activity that survived into `app` is
  `lesson-02-electric-charge-coulombs-law` (no "and"), because `migrate_public_to_app.py` dropped
  the "-and-" variant as claimed by no lesson. The reports are attached to the surviving
  activity — the one the Fall 2026 artifact will post to. Original slug kept in provenance.
- **Submissions are left `draft` with no `chosen_activity_id`.** The interactive activity is
  `grading_role='practice'` on this offering, and the `submissions_gradable` trigger refuses a
  `chosen_activity_id` that is not `graded`. This is exactly what `site/app/js/student-data.js`
  writes for a practice activity, so the rows match production. `/lesson-aggregate` does not
  filter on status.
- **No `grades` rows.** The activity is practice and these students did no written work, so a
  grade row would misrepresent them. The aggregator falls back to `content.effort`, which the
  archived reports carry.

**Verified** by independent read-back (all 8 rows, content and provenance intact) and by running
`lesson_aggregate.py pull`: `8 interactive, 64 written (mixed cohort)`, `missing_report_data: 0`,
and every one of the four sections reports `mixed: True` at 2 interactive / 16 written.

*Unrelated pre-existing snag surfaced while verifying:* `lesson_aggregate.py pull --lesson
preflight-02` fails with "scheduled in more than one active offering" because phys-110 and
phys-215 both have an assignment slugged `preflight-02` after de-prefixing, and the resolver
matches on assignment slug without scoping by course. The globally-unique activity slug works.
Not fixed here.

### Changed — real email identity, registrar roster import, and the end of email password reset

**Frontend + two new edge functions + one migration file. Nothing applied to the live database
yet; nothing deployed.** See "What is NOT done" at the end — this entry describes code that has
landed in the repo, not a system that has cut over.

**The root fact this fixes.** A cadet's sign-in address was *fabricated*. `provision-students`
minted `<cadet_id>@usafa.edu` because the roster CSV carried only `student_id, name, section` and
there was nothing else to use. That string is not a mailbox. Every password-recovery path in the
app was therefore built on an address that cannot receive mail — the reset-by-emailed-code flow in
`site/app/reset.html` was complete, tested, and structurally incapable of recovering a single
account. The registrar export we already receive carries a real `Email` column, so the address
stops being invented, and the recovery model changes to match what the system can actually do.

**Roster import now reads the registrar export.**
[`site/app/js/roster-import.js`](site/app/js/roster-import.js) is new and pure — parsing,
validation, and conflict reconciliation, no network, no DOM — with 60+ cases in
[`tests/app-schema/test-roster-import.mjs`](tests/app-schema/test-roster-import.mjs).
- **Real RFC-4180 field parsing.** `Cadet Name` arrives as `Doe, Jane M.`, so the old
  `split(',')` shifted every column after it and mis-assigned data silently. This was a
  correctness bug waiting to happen the first time the new format was used, not a nicety.
- **Header aliasing** on a normalised key, so `Cadet EMPLID` / `cadet_emplid` / `Cadet Emplid`
  all match, and the legacy three-column files still import.
- **Course filtering.** The export spans every course the registrar's query returned; rows for
  other subjects are excluded by `Subject` + `Course Number` against the offering's course code,
  and every excluded row is *shown with its reason* rather than dropped quietly.
- **Name normalisation.** Registrar order is `Last, First`; `students.name` is stored `First Last`
  because `lastFirst()` flips it for display everywhere. Storing it verbatim would have visibly
  broken sorting on every roster, grade, and report page.
- **Captured columns:** email, squadron, sex, majors 1–3, advisor. Minors, GPAs, sport, and the
  rest are read past and not stored.

**Duplicate students get a per-row review UI.** A returning cadet is a *conflict*, not an error.
The import previews old-vs-new values field by field and the operator chooses **Keep existing**
(enrol them, change nothing) or **Use the file** per student, with bulk controls. Default is
**Keep existing** — the only resolution that cannot destroy data, because a stale export would
otherwise silently revert a correction somebody made by hand. Note the option that was
*requested but is not buildable*: "create a new separate account" for the same cadet. `student_id`
is the primary key of `app.students`, so one cadet ID is one row by construction; offering it
would have meant a surrogate-key restructure touching enrollments, submissions, grades, and every
RLS helper. Confirmed with Matthew before dropping it.

**Password model, replacing three flows with two.**
| | Before | Now |
|---|---|---|
| Change your own | Account page | Account page, via `set-own-password` |
| Forgot it (student) | Emailed 6-digit code (never delivered) | Ask any instructor of your section → reset to default |
| Forgot it (staff) | "Send reset" button (never delivered) | System admin, in the Supabase dashboard |

- **`reset-student-password`** (new edge function) takes **no password parameter and cannot be
  given one** — it *rejects* a request carrying `password` rather than ignoring it. The value is
  derived from the cadet ID. That is the entire argument for letting an instructor hold this
  power: the default is on the roster in front of them, so the reset reveals nothing they did not
  already know, and they cannot choose a credential and then sign in as the student. Scoped to
  staff of the offering, and the target must be reached through an enrolment in it.
- **`set-own-password`** (new edge function) exists because the forced-rotation flag moved to
  `app_metadata`. **This closes a real hole:** the flag previously lived in `user_metadata`, which
  the user's own anon session can write — a cadet could clear it from a browser console and keep
  the shared-knowledge default forever, which is the exact state the flag exists to end.
  `app_metadata` is service-role-only, which in turn means a browser can no longer clear the flag
  after a legitimate password change, hence the function. Both halves had to land together.
  It also re-verifies the current password server-side (`updateUser` does not), skipping that
  check only under forced rotation, where the user may genuinely not know the password an
  instructor just set.
- **`provision-students`** now uses the stored address and **skips** a cadet who has none rather
  than fabricating one — falling back would recreate the unreachable-mailbox problem one account
  at a time. New accounts are flagged for forced rotation.
- **Login is email-only.** The bare-cadet-ID convenience existed *because* the address was the
  cadet ID; with real addresses there is nothing to derive. Pre-2026-07-21 cadets still sign in
  with their old fabricated address, typed in full.
- **`site/app/reset.html` is now an explainer, not a 404.** Anyone reaching that URL is by
  definition locked out; the old login page linked there for a year and bookmarks remember. It
  names who to ask.

**Migration `app/008_student_identity.sql`** adds the seven identity columns (all nullable — 64
Fall 2026 students already exist without them, and `email` must stay nullable permanently since a
cadet can be enrolled and graded before anyone has their address), a partial unique index on
`lower(email)`, a shape CHECK, and `app.roster_imports` — an audit row per upload, because roster
uploads are frequent live mutations performed in a browser by people not running an agent, which
`CHANGELOG.md` structurally cannot record.

**`students.email` is deliberately NOT authoritative for sign-in; `auth.users.email` is.** They
agree for accounts provisioned after this and disagree for the 64 that predate it. Nothing here
rewrites an existing auth user: a roster upload is routine, performed on a file the uploader has
not necessarily proofread, and must never change how 64 people log in as a side effect. Migrating
those addresses is a separate, deliberate operator action that does not exist yet.

**Also fixed along the way:** `doRemove()` in the roster page referenced an undefined `sid` and
threw before its confirm, so **Remove was dead**; the upload card claimed "sections are created
automatically" when the code had started rejecting unknown sections, so a **first import into an
empty offering failed every row** — there is now an inline "create these sections and re-check"
offer.

**Migration `app/008` was APPLIED to the live database on 2026-07-21** (see the applied-migration
note below). The rest of this entry is repo code that is still undeployed.

**Verification — read this before trusting the above.** Node-only, and per CORE.md §2 that means
parts of this are unproven:
- 60+ new unit tests pass (parsing, aliasing, name flipping, course filtering, in-file duplicate
  detection, reconciliation, tab-separated input). The whole offline suite passes.
- `node --check` clean on every changed module and every changed page's inline module script.
- `test-imports.mjs`: all 236 named imports across `site/app/` resolve; no identifier used
  without import.
- **NOT verified:** nothing has been exercised in a browser, against the live database, or with a
  real registrar file. The two new edge functions have never run — they are not deployed. The
  migration has not been applied.

**What is NOT done, and what the next operator must do:**
1. ~~Apply `app/008_student_identity.sql`.~~ **Done — see below.**
2. ~~Deploy the two new edge functions and redeploy `provision-students`.~~ **Done — see below.**
3. **Verify in a browser** — import a real registrar export into a scratch offering, walk the
   conflict UI, reset a test cadet, confirm the forced rotation redirects and then releases.
4. **Decide about the 81 existing cadets.** They keep fabricated sign-in addresses until someone
   builds the explicit migrate-login-emails action. `site/app/help/` should not promise otherwise.
5. **Staff password recovery is a known gap** — deliberately not filled with a button that hands
   out working credentials for an account that finalizes grades. Tier D in
   `PLAN-2026-07-20-ACCOUNTS.md` is still unbuilt.

### Applied — migration `app/008_student_identity.sql` to the live database

**Live DDL on schema `app`.** Run by Matthew Recker (via Claude) against
`shzvpmlnqfmzfmuxkowi` as `prep_app_owner`, which Matthew had unsealed beforehand.

**Coordination (CORE.md §0):** `pg_stat_activity` showed no other agent or operator session —
only Supabase infrastructure roles (`supabase_admin`, `authenticator`, `pgbouncer`), with zero
active queries. Applied with `statement_timeout=120s` and `lock_timeout=15s` so a stuck lock would
fail fast rather than block a live database. The file carries its own `BEGIN`/`COMMIT` and was
executed verbatim — the repo and the database cannot disagree about what ran.

**What landed:** the seven identity columns on `app.students` (all nullable), the partial unique
index `students_email_lower_idx` on `lower(email)`, the `students_email_shape` CHECK, and
`app.roster_imports` with RLS enabled and both policies.

**Verified after the fact, not assumed.** Constraints were probed by *attempting violations* in
rolled-back transactions rather than by reading the catalog: a malformed address is rejected, a
well-formed one accepted, a case-variant duplicate (`dup@` vs `DUP@`) is blocked, and all 81
existing NULL-email rows coexist under the partial index. Row counts unchanged — students 81,
enrollments 81, grades 64, submissions 72 — no student gained an email, `roster_imports` is empty.
`NOTIFY pgrst, 'reload schema'` was sent and confirmed live by a negative control: the new columns
resolve over REST while a bogus column still 400s. **Anon sees nothing** on `roster_imports`,
`students`, or `grades`.

**`prep_app_owner` is still unsealed** — re-sealing needs `ALTER ROLE prep_app_owner NOLOGIN;` as
`postgres`, which that role cannot do to itself. A human must close the gate.

**Two pre-existing test failures found while verifying, neither caused by this migration** — both
mean their suite currently guards nothing and should be fixed:
- `supabase/admin/app_invariant_test.py` dies in fixture setup inserting a random uuid into
  `instructors`, which has carried `instructors_id_fkey → auth.users(id)` since the post-bootstrap
  step in `app_schema_bootstrap.sql` §6. The fixture needs a real auth user.
- `supabase/admin/app_rls_test.py` gets 21 passes then dies inserting an `extensions` row with no
  `reason` — migration `007` made that column NOT NULL and the test was never updated.

`app_tier_check.py` passes fully: owner/dml/read privilege boundaries intact, and all three tiers
still correctly denied on schema `public`.

### Deployed — three edge functions to the live project

`supabase functions deploy` (CLI 2.109.1 via `npx`) against `shzvpmlnqfmzfmuxkowi`:

| Function | Version | |
|---|---|---|
| `set-own-password` | v1 | new |
| `reset-student-password` | v1 | new |
| `provision-students` | v6 | redeploy — real email + `must_change_password` |

All three report `status: ACTIVE`, `verify_jwt: true`. Smoke-tested live against the deployed
endpoints rather than assumed from a successful upload:
- **`reset-student-password` refuses a `password` parameter** — the security property the whole
  design rests on, confirmed working in production, not just in the source.
- Unauthenticated calls to both new functions are rejected at the gateway.
- Argument validation fires (`course_offering_id is required`; the 8-character minimum).
- `provision-students` still returns the pre-v2 migration hint for a legacy `course_id` caller.

**Still unverified:** no function has been exercised on a *successful* path — no password has
actually been reset or changed, because that needs a signed-in session and a real cadet. The
browser walkthrough in item 3 above is what would close that.

*Note for the next operator:* the Supabase CLI is not on `PATH` in a plain shell and `npx` fails
with `'"node"' is not recognized` until Node is added — the stale-`PATH` gotcha in CORE.md §2.
`export PATH="/c/Program Files/nodejs:$PATH"` first. Nothing on the site's deploy path depends on
this; it is developer tooling only.

---

## 2026-07-21 — Casey via Claude

### Ran — `/preflight-analyze` for phys-215 `preflight-02` on schema `app` (Fall 2026)

**Live database write to schema `app` (grades + analysis_reports). No repo/site code change.**
First run of the rewritten, `app`-targeted skill against this offering — the earlier grades on it
predated the `schema:1` per-student assessment, and this run adds it.

**What was written** (all `source=ai_suggested`, `is_finalized=false` — instructors still finalize):
- **64 grades** upserted on `enrollment_id` for the written activity of offering
  `eb5fc51c…` ("Lesson 02 Preflight — Electric Charge, Coulombic Force"). 73 enrolled, 64 submitted
  (all committed), 9 missing. No grade was clobbered — all 64 prior rows were unfinalized AI
  suggestions, so the never-clobber guard (finalized / `source=instructor`) skipped none.
- **Grade distribution:** Q3 42 full / 20 warn (full credit) / 2 zero (blank); Q2 56 full / 8 warn.
  Yellow carries full credit throughout (liberal posture).
- **Hidden diagnostics + the new `schema:1` payload** in `grades.diagnostic`: `q3_understanding`
  {5:42, 4:2, 3:12, 2:1, 1:5, 0:2}; whole-attempt `effort` {5:49, 4:4, 3:3, 2:8} (the 8 twos are
  dismissive reading reflections, capped by the meaningful-gate); `reading_minutes` parsed from Q1
  for all 64; structured `misconceptions[]` — `protons-move` ×2, `charge-created` ×3.
- **3 `analysis_reports`** (`kind=by_question`, one per instructor `audience_id`): Casey Pellizzari
  (M1A, M3A; n=32), Tyler Jones (T1A; n=16), Matthew Recker (T3A; n=16).

**Grounding:** OpenStax Vol. 2 §5.1–5.2 (pp. 170–177) read for RAG; Q3 key is electron transfer
glass→silk with charge conserved. **Verification:** exact read-back of all 64 grades matched the
written payload (0 mismatches); diagnostics in range, effort cap honored, no `text`/`honor` keys.

---

## 2026-07-21 — Matthew Recker via Claude

### Fixed — showcase quotes were unresolvable on the written path

**Frontend only. No migration, no DB write.** With the panel bug below fixed, the AI-picked quotes
still rendered nothing on a question-set cohort — and so did the *random* reflection sample, i.e.
the entire Student Responses panel, with no error.

`reflOf()` in [`site/app/faculty/report.html`](site/app/faculty/report.html) resolves quote text
from `report_data.reading_reflection.text`. On the written path `report_data` is
`grades.diagnostic`, and `WRITTEN-SCHEMA1.md` **deliberately** omits the text there — it would
duplicate an answer `submission_activities.content` already stores. So the written payload carries
the judgment (`{engagement, meaningful}`) and no text, while the artifact's carries both. The AI
picked real students; none of them could be resolved to a quote.

The bridge in `loadInteractionData()` now lifts the answer at the reading-reflection question and
merges it into `reading_reflection.text`, restoring "one shape, two producers" at the point the
shapes are already unified — no consumer has to know where the text lived, and nothing new is
stored. Both the submission content and the question definitions were already loaded, so this adds
no query.

**New `pinnedQuestion()` in `site/app/js/schema.js`**, a port of `_pinned_question_id` from
`lesson_aggregate.py` — role, then prompt text, then position. It is a port and not a shortcut
because the aggregator quotes reflections the browser also renders: if the two resolvers disagreed,
the prose would cite students the panel never shows. Both suites now assert the same fixtures. The
text fallback is load-bearing today — **0 of 74** live written activities carry a `role`, and the
live `phys-215-preflight-02-written` resolves to `q2` by text, confirmed against the database.

**Verified on real rows, not fixtures:** three live students' stored answers + diagnostics replayed
through the resolver and the bridge expression go from `text=MISSING` to a quotable reflection.
`tests/app-schema/test-rollup.mjs` 119 → 128 assertions; full suite 257 + 128 green.
**Still unverified in a browser** — the rollup needs a faculty login this harness does not have, so
the render path past `currentAnalysis()` and `buildResponses()` remains unproven (CORE.md §2).

### Fixed — the rollup read `payload.by_section`; the writer has always written `payload.scopes`

**Every AI panel `/lesson-aggregate` produces was invisible.** `loadAnalysis()` in
[`site/app/js/faculty-rollup.js`](site/app/js/faculty-rollup.js) looked for `payload.by_section`, a
key **no producer has ever emitted**. `lesson_aggregate.py` writes `payload.scopes`, keyed by
section uuid plus `__all__` (its own SKILL.md documents this under "Why the per-section rows became
one row with scopes inside it"). With `by_section` absent, every real row fell through to the
single-scope branch, which reads the panels off the payload's **top level** — where they do not
exist. `readiness_summary`, `misconception_trends` and `selected_quotes` all resolved to `null`, so
the rollup rendered its "coming soon" placeholders on every scope of every lesson.

The reader now prefers `scopes` and still accepts `by_section`, and a whole-course entry supplied
inside the map is never clobbered by the top-level fallback.

**Why 108 assertions didn't catch it:** the suite's `cohortRow` fixture used `kind: 'cohort'` with
the panels at the top level — a shape nothing writes. The test encoded the reader's assumption
rather than the writer's output, so both agreed with each other and neither agreed with the
database. `tests/app-schema/test-rollup.mjs` now asserts against the real writer shape (a
`kind='readiness'` row with `payload.scopes`), including per-section panels, whole-course panels,
quote payloads, `meta.n`, coexistence with `by_question` rows, and the legacy `by_section` path.
108 → 119 assertions; full suite 257 + 119 green.

**Verified against live data, not only the fixture:** the four stored `analysis_reports` rows for
offering `eb5fc51c` were dumped and replayed through the real `loadAnalysis()`, which now resolves
all five scopes (M1A/M3A/T1A/T3A + `__all__`) with their prose, 3 quotes per section, 0 on
`__all__`, and correct `meta.n`. **Not yet confirmed in a browser** — this was a Node-only check
(CORE.md §2), so the rendering path in `report.html` past `currentAnalysis()` is still unproven.

### Operations — first `/lesson-aggregate` run over a written-only cohort (phys-215 preflight-02)

**Live DB write to `app.analysis_reports` — one row, offering `eb5fc51c` (phys-215 / fall-2026 /
preflight-02), `kind='readiness'`, 5 scopes (M1A, M3A, T1A, T3A, `__all__`).** No grades, no
submissions, and no schema touched. Verified with `status`: 5 scopes, n=16/16/16/16/64, 3 quotes
per section, 0 on `__all__`, no `STALE` flag.

**This is the first run that proves the unified rollup end-to-end.** The cohort is
`0 interactive, 64 written` — every misconception, reading-time figure, and understanding score in
the analysis came from `grades.diagnostic` via the new `writtenReport()` bridge. Before the
same-day change above, this lesson would have aggregated to nothing: no student took the artifact.
Cohort totals: effort 4.47/5, understanding 4.08/5, reading median 35m (all 64 stated, none under
15m), `charge-created` ×3 (5%), `protons-move` ×2 (3%), 8 reflection-capped, 15 needs-follow-up.

**The cohort is the seeded instructor-training fixture, not real student work** — ids
`3000990000`–`3000990071` from [`scripts/training/seed_training_preflight02.py`](scripts/training/seed_training_preflight02.py),
which is explicitly disposable (`--clean --commit`). Every scope's prose says so in its first line.
`preflight-02` is currently the only assignment in the system with any submissions at all. **When
the real Fall 2026 roster lands, the fixture is deleted and this analysis must be regenerated** —
`status` will flag all five scopes `STALE` on its own once the underlying rows change, which is the
designed signal to re-run.

**Two things found on the way, neither fixed here:**

1. **`pull`'s multi-offering error misdiagnoses a cross-course slug collision.**
   `--lesson preflight-02` aborts with *"scheduled in more than one active offering (fall-2026) —
   deactivate the stale course_offering before aggregating."* Nothing is stale: `preflight-02` is an
   assignment slug shared by **phys-110 and phys-215**, both legitimately active in fall-2026
   ([`lesson_aggregate.py:456-459`](supabase/admin/lesson_aggregate.py#L456-L459) reports the term
   set, which is identical, rather than the course). Following the advice would have deactivated a
   live phys-110 offering. The activity slugs *are* course-prefixed, so
   `--lesson phys-215-preflight-02-written` resolves cleanly — that is the workaround used here. The
   fix is for the message to name the courses and suggest the activity slug when the terms match.
2. **`prep_app_owner` is still unsealed.** `app_tier_check.py` shows it connecting with CREATE/DROP
   in `app`; CORE.md §0 requires it `NOLOGIN` between schema changes, and the migration-007 entry
   below already flagged the re-seal as outstanding. Still needs `ALTER ROLE prep_app_owner NOLOGIN;`
   as `postgres`.

Read-only steps (`app_tier_check`, `interaction_reports stats`, `pull`, `status`) plus the two-stage
`write-analysis --dry-run` → commit. Student-identifying scratch files (reflection text, ids) stayed
in the session scratchpad, never under the repo tree, per the skill's rule 7.

### Added — extension governance, grading worklists, and a review attestation

**Migration `supabase/migrations/app/007_extension_governance_and_review.sql` — APPLIED to the
live database on 2026-07-21.** Adds three columns and two constraints to `app.extensions`, one
new table (`app.review_signoffs`), and two trigger functions. `site/app/js/db-schema.js` was
regenerated afterwards, as the System > Data entry below requires.

**Asked for:** a way for course directors to see every extension granted in a course and who
approved it, with the explicit intent that the remedy is a conversation with the instructor
rather than a revocation.

**Three bugs found while scoping it, all in the Grade view's save path. Fix these first or the
feature cannot work:**

1. **`source` was destroyed by the first save.** `gradeRows()` hardcoded `source:'instructor'`,
   `graded_by:<caller>`, `graded_at:<now>` for *every* row in the loaded scope. One click of
   *Save draft* therefore relabelled every AI suggestion in the section as instructor-authored,
   including cards nobody had scrolled to — erasing the only column that could answer "has a
   human looked at this?". A row is now marked `instructor` only when that student's card was
   actually edited; otherwise the prior `source`/`graded_by`/`graded_at` ride through unchanged.
   **Caught before it did damage:** all 64 live grades were still `ai_suggested` and unfinalized,
   so no provenance was lost. After a real grading run this would have been unrecoverable.
2. **Finalize invented grades.** `buildGradeData()` defaults a submitted-but-ungraded student to
   `full`, and every row in scope was written — so *Finalize & publish* handed full credit to
   every student the AI never scored, course-wide for a director who had selected "All sections".
   A student with no existing grade **and** no edit is now skipped entirely, the card says
   "Not yet graded", and the confirm prompt states the row count and the affected sections.
3. **`preflight-analyze` would clobber an instructor's draft.** The skill guarded
   `is_finalized = true` but not `is_finalized = false, source = 'instructor'` — an unpublished
   afternoon of human grading looked identical to an AI suggestion on a re-run. Guard added
   (`.ai/skills/preflight-analyze/SKILL.md`). It depends on fix 1 and says so.

**Extensions (migration 007).**

- `reason` is now **NOT NULL** with a non-blank CHECK, and the grant dialog captures it. It was
  nullable and the UI never sent it, so every row would have been blank — a per-instructor count
  with no reasons cannot start the conversation the report exists to start. Safe to tighten
  because the table held zero rows.
- **Revocation is soft, director-only, and refused once the work is in.** Soft, because a hard
  `DELETE` hides the event from the person whose behaviour the report is meant to surface. 
  Director-only, enforced in the trigger rather than the UI, so an instructor cannot quietly
  withdraw their own grant to keep it off the report. Refused after a committed submission
  because withdrawing a deadline retroactively converts a good-faith on-time submission into a
  late one — and the same guard covers `DELETE`, or the rule would hold for only one verb.
- `granted_by` was recorded since 005 and displayed nowhere; it is now the report's main axis.

**New page `site/app/faculty/extensions.html`** (director-gated, in the nav). Per-instructor
counts ranked descending so an outlier surfaces itself, then a grouped table with cadet, section,
assignment, original vs extended deadline, reason, and revoke/reinstate. **No DDL was needed for
the read side:** a director's `staff_assignments` row carries `section_id IS NULL`, so
`app.staff_sections()` already returns every section of the offering.

**Two worklists on the Grade tab.** *Extensions ready to grade* (this assignment) and *Past due
and not finalized* (**across all assignments** — a backlog visible one assignment at a time is
not a backlog). These are the mechanism that stops late work being lost: `preflight-analyze` runs
once, after the section deadline, so a student on an extension submits into silence unless
something remembers them. Nothing auto-grades; per the decision taken, those few are graded by
hand, and the skill now says not to re-run a whole assignment to catch them.

**Review sign-off (`app.review_signoffs`).** "I have read the proposed grades and comments for
this section and made my changes" — deliberately **not** `is_finalized`, which publishes to
students. Conflating them cost both directions: an instructor could not finish reviewing without
releasing, and a director could not tell a reviewed section from an unreviewed one until grades
were already out. One row per (offering, section); a trigger refuses an attestation attributed to
anyone but the caller, mirroring migration 006's unlock rule. **Staleness is derived, not stored:**
`grades_touch` maintains `grades.updated_at`, so a sign-off stops holding exactly when a grade
moves under it, and the pill reads "reviewed, then changed".

**Verification.** 257/257 in `tests/app-schema/` (was 244 before; +13, and the hardcoded base-table
count moved 20 → 21). Migration 007 was exercised against the live schema inside a rolled-back
transaction first — 13 checks covering both CHECKs, both refusal paths of the withdrawal guard,
and the sign-off uniqueness — then applied and re-verified. `test-imports.mjs` linked every new
import and the new page's inline module.

**Not verified, and needing a human:**

- **The director-only revoke branch has never executed.** An operator connection has
  `current_uid() = NULL` and is bypassed by design, and the browser harness has only a test
  *student* account — no faculty login — so the `uid IS NOT NULL` + non-director path is
  reasoned-about, not proven. Exercise it with a real instructor login before relying on it.
- **No visual browser check.** Per CORE.md §2 this was Node-only: syntax, linking, and schema.
  Nothing rendered a page. The new page, the two queues, the sign-off bar and the extension
  dialog all need `python -m http.server 8000` and a look.
- **`prep_app_owner` is still LOGIN-enabled and must be re-sealed** —
  `ALTER ROLE prep_app_owner NOLOGIN;` **as `postgres`**. It was *already* unsealed when this
  work started, contradicting CORE.md §0's claim that it "cannot connect at all"; the documented
  gate has not been in force for some time. Neither `prep_app_owner` nor `claude_code_recker`
  holds `CREATEROLE`, so no agent can re-seal it — verified by attempting it
  ("permission denied to alter role"). Secondary: all three `prep_app_*` roles carry `BYPASSRLS`,
  which is worth a second look for one described as "SELECT only".
- **Not pushed.** `main` is live and the deployed site predates the `reason` NOT NULL constraint,
  so granting an extension on the *currently published* page would fail until this ships. The
  window is harmless today — zero extensions exist and the term has not started — but it should
  not be left open.

### Added — System > Data: a generic table browser over schema `app`

**Frontend + one read-only script. No migration, no DDL, no live DB write from the feature
itself** — the generator only reads `information_schema`, and every write the page performs is an
ordinary authenticated PostgREST call subject to the same RLS as any other page.

Fills the slot `nav.js:51` has been reserving since the app refactor began (`{ key: 'system',
adminOnly: true }` pointing at a `system.html` that did not exist) and that `faculty-admin.js:5-6`
names as the home of the global tier. It also delivers what `nav.js:42-44` originally scoped that
destination for: creating an offering and appointing its director is now editing
`course_offerings` and `staff_assignments`, reached generically rather than through bespoke forms.

**New files**

- `site/app/faculty/system.html` — the browser. Table picker, sortable/paged row list, text search,
  row editor, delete. Gated on `is_global_admin` (not `isDirectorForCurrent()`, which a director
  also satisfies). No per-table code whatsoever.
- `site/app/js/system-admin.js` — the data layer: list, insert, update, delete, bulk FK-label
  resolution, value coercion, and the cascade preview.
- `site/app/js/system-prefs.js` — what the view *shows*: curated default columns per table, the
  default-hidden table set, the snake_case → Title Case humanizer, and localStorage persistence.
  Pure (imports only `db-schema.js`), so it is unit-tested without a browser or a database.
- `site/app/js/db-schema.js` — **generated**. The catalogue for all 20 `app` tables: 147 columns,
  33 foreign keys with their delete rules, the 10 CHECK-derived value sets, and per-table RLS
  policy coverage.
- `scripts/app/gen_db_schema.py` — regenerates the above. Read-only, connects as
  `prep_app_read`, stdlib + psycopg2 via the project `.venv`. `--check` mode exits non-zero on drift.
- `tests/app-schema/test-db-schema.mjs`, `tests/app-schema/test-system-prefs.mjs` — 29 + 26
  checks; both registered in `run.mjs`.

**What the view shows is an authoring decision, not "everything".** The first cut rendered every
column of every table and was unreadable — a 36-character uuid, two audit timestamps and a JSON
blob crowding out the code and title a human actually navigates by. This follows Django's
`ModelAdmin.list_display` instead: `CURATED_COLUMNS` names the columns worth scanning for all 21
tables, six low-level tables (junctions, the append-only audit log, the service-written report
store, a three-row lookup) are hidden from the sidebar by default, and two gear buttons — one on
the table list, one on the row list — change either, persisted per browser under `cp.system.*`.
Hiding is presentational only: **the row editor always shows every column**, and nothing about
visibility affects what is read, written, or permitted.

Tables and columns render as Title Case with underscores as spaces (`assignment_offerings` →
"Assignment Offerings"), the way Django derives a `verbose_name`. A trailing `_id` is dropped only
for a real foreign key, because that cell renders the target's label — so `course_offering_id`
reads "Course Offering", while `students.student_id` keeps its suffix as "Student ID", being a
cadet number rather than a hidden key. The raw identifier is never discarded: it stays in a title
attribute, beside every picker entry, and in each editor field hint, because it is the name that
appears in a migration or an error message.

A table added by a future migration is not left raw — `defaultColumns()` falls back to a rule
(keep the label, foreign keys, enums, booleans and short scalars; drop audit timestamps, JSON,
long text and a bare uuid key) so it arrives readable before anyone curates it.

**Fixed — invisible table headers.** The sort controls were `.btn.btn-ghost` inside `<th>`, which
`styles.css:742` styles white-on-blue; the buttons painted their own surface and dark text, so the
header row rendered as a band of empty boxes. They are now unstyled buttons that inherit the
header's colour and font. Cells also elide rather than wrap — uuids to eight characters, JSON to a
fragment, timestamps through `fmtDateTime` — with the full value in a title attribute.

**Why the catalogue is generated rather than introspected at runtime.** The obvious source is
PostgREST's OpenAPI spec at `/rest/v1/`, but it now refuses publishable keys —
`401 {"message":"Secret API key required"}` — and a static page must never carry a secret key. So
the catalogue is generated and committed as a plain ES module. The no-build, no-Node deploy path
(CORE.md §2) is unchanged: `db-schema.js` is a normal source file the browser imports.
**Re-run the generator after any migration in `supabase/migrations/app/` and commit the result;**
the new test fails when it drifts.

**Why this adds no authority.** Every call goes through the ordinary anon-key client as the
signed-in administrator, so a system admin can do exactly what `002_rls.sql`'s `is_admin()` already
permits — no service key, no edge function, no RLS bypass. Four tables are readable but not fully
writable *by anyone* through the API, and the page states each reason up front instead of letting
it surface as an opaque refusal at save time: `submission_activities` (students own their work),
`submissions` (staff may unlock only, per the migration-006 trigger), `grade_events` (append-only
audit), `analysis_reports` (written by the service tier).

**Deletion is gated on a cascade preview.** The FK graph is deep and mostly `ON DELETE CASCADE` —
`courses → course_offerings → sections → enrollments → submissions → submission_activities`, with
`grades → grade_events` hanging off enrolments — so removing one `courses` row would take a term of
student work with it. The page walks that graph first, counts what would go per table, and requires
the row's label typed exactly before it will delete. `ON DELETE RESTRICT` referrers block the
delete outright and are listed.

**Verification — read this before trusting it.** Full `tests/app-schema` suite: 257 passed, 0
failed, including the live drift check and the 55 new checks. All modules pass `node --check`;
import integrity confirms every named import across `site/app/` resolves; the page and its whole
module graph were confirmed to serve over `python -m http.server`. `test-system-prefs.mjs` guards
the one real drift risk the curated lists introduce — a migration renaming a column would
otherwise make it silently vanish from the view, since unknown names are filtered out rather than
rendered as dead headers.

**The interactive UI was verified only from a screenshot** — the header-rendering fix above came
from one. Everything else remains unexercised in a browser: the row editor, both gear modals, the
cascade-preview modal, and every write path, because the page requires an `is_global_admin` login
the agent does not hold. Per CORE.md §2 that is stated here rather than left for the next operator
to discover: **a system admin should click through it on a low-consequence table before relying on
it, and should test one delete against a throwaway row.**

## 2026-07-21 — Matthew Recker via Claude

### Added — the reading-time question (Q1) is finally rolled up

Every preflight's Q1 asks *"How much time did you spend reading the book in preparation for this
lesson?"* — 0 points, names hidden from instructors because it is a class diagnostic, not an
assessment of the individual. **It has never been aggregated.** 64 written submissions carry an
answer; the distribution has been sitting in the database unread since the term began.

`/preflight-analyze` now parses each answer to whole minutes into `diagnostic.reading_minutes`. It
has to be the parser — the answers are prose (*"About half an hour."*, *"An hour and a quarter —
this one was dense."*, *"Maybe 20 minutes, I skimmed it."*) and nothing else in the pipeline reads
them. The key is **omitted** when an answer names no duration: absent means "not stated", `0`
would claim the student read for zero minutes.

Reported as a **median and five buckets, never a mean.** Self-reported durations have a long tail;
one student who genuinely struggled for three hours would drag a mean somewhere no student sits.
The buckets exist to show a *bimodal* class — half reading properly, half skimming — which is the
shape that actually changes what a director covers in class, and which a single number hides. The
outlier is deliberately not clamped: a three-hour read is a real signal.

`not_stated` counts only written-path students. An artifact taker is never asked Q1, so counting
them as having withheld a duration would manufacture a refusal out of an unasked question. (Caught
by a test, not by inspection — the first implementation got it wrong.)

Rendered in the lesson rollup as its own panel, deliberately styled unlike the 0–5 effort chart so
the uneven minute buckets are not read as a shared scale. `/lesson-aggregate` is told to cite the
median and the shape in `readiness_summary`, never an individual time.

### Fixed — the pinned-question lookup matched nothing on every live lesson

A read of the live database found **0 of 74 written activities carrying any question `role`**.
`faculty/lessons.html` writes `role: "reading_time"` / `"reading_reflection"` on newly authored
lessons, but `scripts/fall2026/build_fall_preflights.py` — which built everything in the current
term — emits `{id, type, text, points}` with no role at all.

So `_reflection_question_id()`, added hours earlier in this same batch, returned `None` for every
lesson in the term: written showcase quotes would have silently never worked, and the reading-time
lookup would have failed the same way. Found by probing the live schema before building on it
rather than after.

Now resolves by `role` → prompt **text** → position, and reports which signal it used. The text is
verbatim-identical across all 74 rows, so the fallback is anchored to something a director does not
hand-edit; position (`q1`/`q2`) is last and weakest because position is the first thing an edit
changes. **The permanent fix is to backfill `role` onto the 74 live rows** — that is a DML change
and a coordination event under CORE.md §0, so it is proposed here, not done. When it lands the
fallbacks stop firing on their own.

### Changed — one per-student shape, one cohort aggregator, across both modalities

**Docs, skills and tooling. No migration, no schema change, no live DB write** — nothing here has
been *run* against the database yet; the next `/preflight-analyze` run is what starts emitting the
new payload.

The asymmetry this closes: an interactive lesson gets a per-student `schema: 1` assessment for
free (the artifact writes it at submit), while the written path never had an equivalent producer.
So every cohort summary that folds `schema: 1` described only artifact takers.
`LESSON-UNIFICATION.md` §11 named this exact gap — *"the work that makes the preflight and the
interaction commensurable"* — and specified the fix; it was never built because the doc predates
the `app` redesign and was written against `lesson_completions`.

**1. `/preflight-analyze` now emits `schema: 1` into `grades.diagnostic`.** New reference
`references/WRITTEN-SCHEMA1.md` defines the payload: `effort` (engagement across the whole
attempt, gated by the reflection's meaningful-flag), `overall_understanding`, `objectives[]`,
`misconceptions[]` against the taxonomy, `reading_reflection`, `flags`. The column comment already
described this shape — `app` was built for both paths to fill it; only one ever did.

It already did the analysis. Step 7 reads every answer and classifies it against the misconception
taxonomy; Step 8 flattened the findings into prose. This emits the *structure* alongside, so the
numbers survive into the rollup instead of being lost to English. The generic taxonomy table gained
stable kebab-case ids for exactly this reason — prose cannot be counted, and two students with the
same misconception must carry the same id or they never aggregate.

**Purely additive.** `q2_effort` / `q3_understanding` keep their rubrics and are *not* renames:
`diagnostic.effort` measures the whole attempt, `q2_effort` measures the reflection answer alone.
Both are kept; `effortSignal()` prefers the commensurable one and falls back. Four keys are
deliberately NOT emitted — `reading_reflection.text` (already stored as the student's answer;
copying it would duplicate student prose into a second table), `honor` (unknowable without a
transcript — an absent key reads as "not assessed", `"none"` would falsely read as "assessed and
clean"), `self_rated_understanding`, and the conversation metadata.

**`objectives` is normally `[]` today, and that is correct output, not a gap.** Nothing populates
`activities.content.questions[].objective_key` — zero mentions in the skill, nothing in
`scripts/fall2026/`, and `lessons.html:1011` hardcodes `objectives: []`. Inventing a breakdown
would put fabricated axes on the faculty radar. When a director authors the keys, the array fills
and the radar gains real axes with no code change.

**2. The rollup reads it** (`faculty-rollup.js`). The bridge is small and load-bearing: an
interactive student's assessment rides on their *submission*, a written student's on their
*grade*. Both are now surfaced as `report_data`, so `summarizeReports` folds one shape.
Without this the emission would be written and read by nothing — the same failure as the
`by_question` breakdown fixed earlier today. Consequence: misconception bars, flag tallies and the
reflection gate now work for written cohorts. Understanding attribution was re-keyed to the
student's *path* rather than to which field supplied the number — otherwise a written student with
`overall_understanding` would file under "interactive" and overstate artifact coverage.

**3. `/interaction-aggregate` → `/lesson-aggregate`, and it is modality-blind.**
`ROLLUP-AGREEMENT.md` §12 flagged the rename as wanted-but-cosmetic; it is now substantive. The
tool (`supabase/admin/lesson_aggregate.py`) is keyed on the **offering**, not on an interactive
activity — a question-only lesson has no artifact slug to name — and `--lesson` accepts either an
assignment or an activity slug (old flags kept as aliases). `_load_reports` pulls both modalities
and normalizes them; `summarize` gained the same `paths` provenance, merged effort distribution and
`__free_response__` objective the browser computes, because the prose is required to cite the same
figures the bars show. Written reflection text is lifted from the student's stored answer at the
question marked `role: "reading_reflection"`, so showcase quotes work on both paths.

**4. Cohort prose ownership moved to `/lesson-aggregate` for every lesson type.** This closes the
`misconception_trends` / `readiness_summary` gap noted earlier today rather than patching the
by-question writer. `ROLLUP-AGREEMENT.md` §6 gave preflight-only lessons' cohort prose to
`/preflight-analyze` because nothing could then read the written path; that table now carries a
dated supersession note (the doc is a point-in-time record, so it is annotated, not rewritten).

**Why the two skills were not merged** — the question that started this. They run on different
clocks. Grading is per-student and runs early and often, frequently split M-day/T-day; aggregation
is per-cohort and must run once, after the deadline, unfiltered. A merged skill would either make
grading wait for the deadline, or emit a "readiness summary" describing half a class that the
second day's run then silently replaces. `LESSON-UNIFICATION.md` §12 had already decided against a
monolith on maintainability grounds; the cadence argument is the harder one.

**Docs corrected, not just bumped.** `CORE.md` §6 and `PROJECT.md` still described diagnostics
living in `scores.q2_effort` — the *retired* `public` schema — which this change made actively
misleading. Both now document `grades.diagnostic` and the two-producer model.
`site/app/help/director-ai-rules.md` and `docs/operations/SYSTEM_GUIDE.md` described aggregation as
interactive-only and the diagnostics as two integers; both were wrong as written and are fixed —
a help doc that contradicts the system is a bug (CORE.md §5). The other seven documents
`check_doc_sources.py` flagged were read and are unaffected; their `reviewed` dates were already
current, so nothing was bumped to silence the check.

**Verified:** `supabase/admin/aggregate_summarize_test.py` is new — 45 assertions over the Python
`summarize()` and the pinned-question resolver, asserting the same cases as the JS suite so the two
engines cannot drift (they must agree, or the aggregator's prose contradicts the browser's bars).
`tests/app-schema/test-rollup.mjs` grew to 108 assertions, including the schema:1 recognition,
effort precedence, the reading-time rollup, and the payoff cases (misconceptions counted for a
written cohort, no phantom radar axis from an empty `objectives`). Full suite green (244 + 108 +
45). The reading-time panel was rendered against the shipped stylesheet in both themes. The live
database was **read** (SELECT-only role) to establish the `role`-marker and Q1-answer facts above;
nothing was written to it, and no
`/preflight-analyze` or `/lesson-aggregate` run has yet produced or consumed the new payload** —
the SQL in `lesson_aggregate.py` is compile-checked and its pure logic is unit-tested, but the two
new queries are unproven against live data.

### Changed — faculty summaries now describe BOTH ways a lesson can be worked

**Frontend + tests only (`site/app/`, `tests/`). No migration, no schema change, no DB write.**
The dashboard and the lesson rollup summarized only the interactive path. A student who worked
the question set contributed nothing to any number: they have no schema:1 report, and
`grades.effort` is NULL on that path (written offerings are `grading_mode='points'`, and
`/preflight-analyze` refuses to run against an effort-graded one because the trigger would
overwrite `points_earned`). Their effort lives in `grades.diagnostic.q2_effort` and their
understanding in `.q3_understanding`, and nothing read either.

The visible consequence was worse than a missing panel: on a mixed lesson the effort mean, the
histogram and the section averages silently described only the artifact takers while the
completion ring counted everyone, so two numbers side by side were measuring different cohorts.
A question-only lesson had no rollup at all — `faculty-rollup.js` filtered the lesson list to
offerings with an interactive activity.

**Effort is now one distribution across both modalities.** Q2 of a written preflight *is* the
reading reflection the artifact scores, and `QUESTION-DIAGNOSTICS.md` grades it by adapting the
same engagement rubric (`INTERACTION-DATA-CONTRACT.md` §5.2). They are one population on one
scale, not two that happen to share a range. `schema.js` gained `effortSignal()` — grade →
written diagnostic → the artifact's claimed effort, in that precedence, with the claim last
because a student's own artifact writes it — and `writtenSignals()`, which unpacks the q2/q3
pair and returns nulls on an interactive grade whose `diagnostic` holds the schema:1 payload
instead. Every consumer resolves effort through one definition now.

**Understanding could not be merged the same way, and is not.** The interactive path resolves
understanding per objective; the written path produces one number for one free-response
question. So it appears as a single synthetic objective, `Free response`, in the weakest-first
breakdown — same 0–5 KDE, same ordering, competing for attention on equal terms, tagged
`questions` so nobody reads it as an authored objective. On a mixed cohort it also becomes an
extra radar axis, which is legitimate because it is the same 0–5 measure. (Teasing real
objectives out of the free-response answer is the future version; it replaces this one row with
several and nothing else has to change.) The headline understanding average folds in
`q3_understanding` where a student has no interactive score, and reports the split as
`understanding.from` so the UI never implies the two are the same instrument.

**A written-only cohort cannot have a radar, and now says so.** One free-response score is one
axis; a radar needs three to enclose an area. `summarizeReports` decides availability and
returns a *reason* (`no-data` / `written-only` / `too-few-objectives`), and the rollup renders
an explanation in the chart's place. A blank panel there reads as a broken chart and gets
reported as a bug. Misconception trends get the same treatment on the dashboard: a question set
produces none, which is not the same as none being found.

Completion counting was fixed alongside it — "done" is now a `submission_activities` row for
*either* activity, so the ring and the numbers under it describe the same people.

### Fixed — `by_question` analysis rows silently overwrote the cohort AI panels

Found while checking a claim in the change above. **Two skills write `analysis_reports` and
`kind` is what separates them** (`docs/decisions/ROLLUP-AGREEMENT.md` §6): `/preflight-analyze`
writes one `kind='by_question'` row **per instructor** carrying the written preflight's
per-question analysis, and `/interaction-aggregate` writes the cohort section panels.
`loadAnalysis()` ignored `kind` entirely. A `by_question` payload has neither `by_section` nor
`section_id`, so every one of them fell through to `out['__all__']` — each instructor's row
overwriting the last with four nulls, and clobbering a genuine cohort row if one existed.

Latent until now only because written-only lessons had no rollup to load it from; the change
above made it reachable. Rows are now routed by `kind` (falling back to `breakdown.axis` so a
row written before the column was set still lands correctly), and a row that carries *both* a
breakdown and cohort panels — which §6 says a conforming `/preflight-analyze` run should — is
recorded in both places instead of being consumed by one branch.

### Added — the written preflight's per-question analysis is now rendered

It was being written to the database and displayed nowhere: nothing in `site/app/` read
`payload.breakdown` at all. The lesson rollup now shows those bullets under **By question**,
grouped per instructor, styled deliberately unlike the counted misconception bars above them
because they carry approximate counts inside the sentence rather than a measured share.

**This corrects a wrong claim in the first entry above.** `/preflight-analyze` *does* look for
misconceptions on the written path — it is one of that skill's headline jobs, against the
taxonomy in `PROJECT.md`, and Step 8 requires a bullet per distinct misconception with a count.
What it does *not* produce is the structured per-student `misconceptions[]` the artifact sends,
so those findings cannot feed the counted bar chart. The dashboard tile said "misconceptions are
surfaced from the interactive transcript", which reads as *none were found* — a clean bill of
health nobody earned. It now says there are no **counted** misconceptions and links to the
rollup where the written findings actually are.

**Known gap, not fixed here:** ROLLUP-AGREEMENT §6 says `/preflight-analyze` must also write
`readiness_summary`, `misconception_trends` and `selected_quotes`, but the payload in its
`SKILL.md` Step 8 omits all three. Until that skill is updated, a written lesson's "Trends across
the class" panel stays on the coming-soon placeholder even though the analysis exists. The
reader code already handles the conforming shape, so only the skill needs to change.

**Verified:** `tests/app-schema/test-rollup.mjs` is new — 73 assertions over `writtenSignals`,
`effortSignal`, `summarizeReports` and `loadAnalysis`, covering the merged effort distribution,
the free-response objective, the understanding split, each radar-unavailable reason, and the
`by_question` routing above (that suite fails against the pre-fix `loadAnalysis`). Full suite
green (215 + 73). The faculty dashboard was driven headlessly (Playwright, via the sandbox,
which imports the real render module) in both the mixed and written-only cases, and the new
rollup panels were rendered against the shipped stylesheet in light and dark. **The lesson
rollup page itself was not exercised against live data** — it needs a director login — so
`report.html`'s wiring of `s.radar`, `o.source` and the new By-question section is proven by
unit test, a parse check, and markup rendering, not end to end.

### Changed — Grade tab filters by status lamps instead of an "Only flagged" checkbox

**Frontend only (`site/app/`). No migration, no schema change, no DB write.** The Grade tab
toolbar now carries a three-lamp traffic light — green (full credit), yellow (flagged for
review), red (no credit). A lit lamp shows that status's answers and glows in its own colour;
clicking dims the lamp and hides those answers. All three start lit, so the default view is
unchanged from before.

**Replaces the "Only flagged" checkbox rather than joining it.** That checkbox was exactly the
state "green off, yellow and red lit", so keeping both would have left two filters writing
`row.style.display` on the same elements and fighting each other. The lamps are a strict
superset: red-only isolates the no-credit answers, yellow-only works the AI-flagged review
queue, green-only spot-checks what was auto-passed.

Filtering stays pure DOM work against `.grade-q[data-status]` — no refetch — and runs after
every render *and* every credit-chip toggle, so cycling a chip re-files the answer under the
lamps immediately. `data-status` is the hook because it is the only attribute present on both
the finalized and editable branches of the renderer; the `.credit-toggle[data-qid]` attributes
exist only on unfinalized rows and would have silently skipped every finalized student.

**Colour is never the only signal.** Each lamp shows a live count of answers in that state and
carries `aria-pressed` plus an `aria-label` naming the status and the count, so the filter reads
in greyscale and to a screen reader. Lit/unlit is also distinguished by glow and opacity, not
hue alone. New `--lamp-off-*` and `--lamp-glow-*` tokens are defined in both themes; the lit
colours reuse the existing `--alert-ok/warn/error` trio rather than introducing new ones.

Files: `site/app/faculty/grade.html`, `site/app/css/styles.css`. `site/app/help/instructor-grading.md`
gains a "Filtering by color" section — it is the instructor-facing Grade tab page, and it documented
the section filter and the 3-state colours but would have omitted the new control.

**Verification — appearance and filter logic confirmed; live-page wiring not.** This machine had no
browser automation at the time (no `chromium-cli`, no Playwright) and the real page sits behind
faculty auth, so the agent could not open it. Instead the human confirmed a throwaway harness that
loaded the **real** `styles.css` and ran a **verbatim copy** of `applyFilters`/`wireLamps` against
synthetic cards: lit/unlit/glow in both themes, show-hide, the live counts, the all-dark empty state,
and a credit-chip cycle re-filing an answer under the lamps. That proves the CSS and the filter
algorithm.

It does **not** prove the integration inside `grade.html` — that `wireLamps()` is reached from
`init()`, that `render()` calls `applyFilters()`, or the behaviour against real data and finalized
students. Those paths are still unexercised. Static checks that did run: HTML tag balance, CSS brace
balance, every custom property used by a lamp rule defined in *both* light and dark themes, no
dangling references to the removed `flag-filter`/`applyFlagFilter`, and lamp set == status set. Node
became available later the same day (see below), so a headless pass over the real page is now
possible and has not been run.

### Docs — corrected the environment rule: Node *may* be available, guaranteed on no other machine

**Documentation only. No code, no schema, no data.** Node is now installed on the course director's
machine (`C:\Program Files\nodejs`, v24.18.0). CORE.md §2 claimed "nothing here uses them — no
bundler, transpiler, `node --check`, eslint, or jest", which was **already stale** before this:
`tests/app-schema/` has been an optional Node harness running the shipped modules against the live
database since 2026-07-18. The rule now separates the two things that were conflated:

- **The shipped site** still has no Node dependency and no build step, and must not gain one. That
  part is unchanged and remains non-negotiable.
- **Node is optional developer tooling** that may or may not exist on a given machine, and is
  **guaranteed on none but the course director's.** Three constraints keep it optional: nothing on
  the deploy path may require it; a Node-only check is never a change's sole verification (and must
  be declared in this file if it was, because the next operator may have no Node); and
  `package.json`/`node_modules/` stay confined to the tool's own gitignored folder.

Also recorded a gotcha that cost time today: an agent session started **before** Node was installed
inherits a stale `PATH` and reports `node: not found` even though it is present — check
`C:\Program Files\nodejs\node.exe` directly, or restart the session.

Files: `.ai/instructions/CORE.md` (§2, §7), `.ai/instructions/PROJECT.md`, `AGENTS.md` (quickstart),
`site/app/README.md`, `site/app/help/admin-system-operations.md`. Per CORE.md §5 the CORE/PROJECT
edit flagged ten derived documents; each was re-read against its sources and its `reviewed` date
bumped in `docs/DOC-SOURCES.json`. `site/app/help/README.md` was **not** flagged and was left at its
old date rather than bumped, since bumping it would attest to a review that did not happen.

## 2026-07-20 — Matthew Recker via Claude

### Added — account page, password flows, and the native course-administration page

**Frontend + docs. No migration, no schema change, no new edge function.** Builds the mocked designs
in `tests/browser/test-account.html` and `tests/browser/test-admin.html` against schema `app`, closing
the `KNOWN GAP` note left in `js/nav.js` (Export and staff management lived only on legacy
`site/admin.html`, which reads `public`, and were unreachable from the portal).

**Accounts.** New `js/account.js` plus twin shells `student/account.html` and `faculty/account.html`
(the `help.html` pattern — a role-neutral page needs a copy in each role directory because nav links
are bare filenames, so the logic lives in the module). Shows identity, changes the password, and
surfaces the two preferences that already existed only as side effects (`cp.theme`,
`cp.currentOffering`). New signed-out `reset.html` implements forgot-password as a **six-digit emailed
code**, linked from `login.html`.

**Why a code rather than a magic link:** cadets read mail on a phone and act on a lab desktop, and a
link only authenticates the device that opened it. Requires the Supabase recovery template to use
`{{ .Token }}` — *not yet configured*, see below.

**Why change-password verifies the current one:** Supabase's `updateUser()` trusts the session and
does not check the existing password, so an unattended unlocked browser would be enough to take an
account over. `changePassword()` re-authenticates first.

**Course administration.** New `faculty/admin.html` + `js/faculty-admin.js`, director-gated, with
Staff and Export tabs. Staff reads `staff_assignments` (which replaced both
`instructor_course_access` *and* `sections.instructor_id`, so adding staff and assigning a section are
now one action), supports the three `app` roles — director / instructor / grader — and reuses the
already-ported `create-instructor` / `remove-instructor` edge functions. Export isolates the
gradebook behind `gradeMatrix()` so the lesson-unification move off per-question scoring changes one
function rather than the CSV writer.

Three legacy export defects are fixed rather than ported: the JSON backup is now director-gated and
scoped to one offering (legacy was unscoped by both role and course, and ordered by a `due_date`
column that no longer exists), and an unfinalized grade exports **blank rather than zero** — a zero
posts to Blackboard as a real score.

**Nav.** Restored the `admin` entry pointing at the native page (`directorOnly`), added a `system`
entry gated on `is_global_admin`, and added **Account** to the user dropdown. The admin/system split
is a permission boundary, not tidiness: creating an offering means appointing its director, which a
director must not be able to do for themselves.

**Auth.** `bootstrap()` now honours `user_metadata.must_change_password`, redirecting to the account
page until the user picks their own password. Inert until the `set-password` edge function exists.
Stored on the auth user rather than in a table because `app` DDL is sealed — this needs no migration.

**Verified:** the existing `tests/app-schema` harness still passes 215/215; every PostgREST projection
the new modules ship was checked against the live schema; all 110 module imports across `site/app`
resolve. **Not yet verified in a browser against a signed-in director** — see below.

**Known gaps, deliberately:** the Supabase recovery email template still sends a link, not a code, so
`reset.html` will not work until that is switched. Director-triggered reset calls Supabase's public
recovery endpoint directly, so it works today but is neither attributed nor rate-limited. The
system-admin tier (`faculty/system.html` — offerings, courses, terms, people) is mocked but not built.
Design: `site/app/PLAN-2026-07-20-ACCOUNTS.md`.

### Added — legacy audit of admin capability not carried forward

`site/app/LEGACY-AUDIT-2026-07-20.md`. A line-by-line re-read of the legacy pages found that
`COURSE-ADMIN-INVENTORY.md` — which claims to catalog *every* director function — misses several, and
that its §2D claim ("only system admins can add/remove the `system_admin` role") **describes a guard
that never existed**: legacy passed the role dropdown straight through with no check, so any course
director could mint or strip a system admin. Already fixed in the `app` edge functions; recorded so
nobody restores the legacy behaviour on the doc's authority.

Also documents three working features promotion would delete (the Report tab's copy-for-slides
workflow, the "Did Not Submit" table, the Grade tab's flagged-only filter), four undocumented
authoring behaviours (notably that `points = 0` silently makes a question ungradeable), and
`site/review.html` — a credential-free student grade viewer the inventory never analyzed, now dead
under migration 021's policies, recommended for deletion rather than porting.

## 2026-07-20 — Casey via Claude

### Added — PREP v2 design record and cutover runbook

**Docs only. No frontend, database, migration, or build-step change.** Uses the `docs-author` skill
(added earlier today) to close the gap it names: the entire PREP v2 build — the parallel `app` schema
and the migration path — had zero discoverable design record in `docs/`, with all reasoning living in
SQL comments, `site/app/README.md`, and two point-in-time `PLAN-*.md` files.

**Why.** The v2 schema is a one-way door (a new schema replacing `public`, with an eventual cutover of
what becomes live student data), aligned across two operators, and it rewrites the authorization
surface a July 2026 audit found porous. The `docs-author` design-doc gate requires a record for
exactly those conditions, and none existed. These docs capture the *reasoning* — why a parallel schema
over an in-place migration, why two RLS predicates over 62 bespoke policies — so the next operator
inherits the decision rather than re-deriving it from DDL.

**What was added:**
- **[`docs/decisions/PREP-V2-SCHEMA.md`](docs/decisions/PREP-V2-SCHEMA.md)** — the load-bearing
  decision: build `app` alongside `public`, prove it, migrate, cut over; `public` stays untouched as
  the rollback. Names the rejected in-place-migration and RLS-only options and its own downsides.
- **[`docs/decisions/PREP-V2-AUTHORIZATION.md`](docs/decisions/PREP-V2-AUTHORIZATION.md)** — the
  two-predicate RLS model over the enrolment/staffing graph, why it reads the JWT through
  `app.current_uid()` rather than `auth.uid()`, and how each of the four audit findings maps to a
  policy. Security/FERPA-relevant; written for a reviewer.
- **[`docs/architecture/PREP-V2-DATA-MODEL.md`](docs/architecture/PREP-V2-DATA-MODEL.md)** — the
  container / offering / activity shape and the four layers, as a map into `app/001_core_model.sql`
  rather than a restatement of it.
- **[`docs/operations/PREP-V2-CUTOVER.md`](docs/operations/PREP-V2-CUTOVER.md)** — the ordered
  bootstrap → prove → migrate → promote runbook, with the reversible/one-way line drawn at front-end
  promotion. Registered in `DOC-SOURCES.json` as a must-stay-current operations doc.

**Also:** de-stubbed and style-corrected the two help docs the refactor makes current now —
`student-getting-started.md` (student tier) and `instructor-grading.md` (instructor tier): removed the
"starter stub" callouts and fixed input-neutral-verb violations per `HELP-STYLE.md`. Director-tool
help is deliberately **not** written yet — instructor management, export, and the by-question report
are still mid-port, and a help doc must be current or it is a bug.

Decision docs and the architecture doc are intentionally **not** indexed in `DOC-SOURCES.json` —
`docs/decisions/` and `docs/contracts/` are point-in-time records, and architecture docs follow the
same precedent (`LESSON-UNIFICATION.md` is not indexed either). Only the cutover runbook is tracked
for staleness. Migrations remain **written but not applied**; no live database or site change here.

---

## 2026-07-20 — Matthew via Claude

### Added — preflight-02 training data migrated into `app` so Grade can be reviewed

> ⚠ **TEST DATA IN A PRODUCTION SCHEMA.** 64 fabricated submissions now sit in `app` on
> phys-215 `preflight-02`. **Remove them before real students submit:**
> `.venv/Scripts/python scripts/app_migration/migrate_training_responses.py --undo --commit`

**Live data change.** `app` had 0 submissions and 0 grades, so the Grade view rendered a correct
but empty page and nobody could tell whether the rewire worked. `migrate_public_to_app.py` had
deliberately left the 64 `seed_training_preflight02.py` rows behind in `public` as test data;
this brings them across for review purposes only.

New: **`scripts/app_migration/migrate_training_responses.py`** — dry-run by default, idempotent,
and `--undo` removes exactly what it created. It uses **two connections** rather than opening the
migration read window (bootstrap §8): the legacy `claude_code_recker` credential reads `public`
(on a `set_session(readonly=True)` connection, so it cannot write there even by mistake) and the
app tier writes `app`. That avoids a postgres-level grant, and one more thing to remember to close.

Mapping: `responses.answers` → `submission_activities.content` on the **written** activity, with
`submissions.status='committed'`; `scores` → `grades` with `question_scores` unchanged,
`source='ai_suggested'`, `is_finalized=false`, and the hidden `q2_effort`/`q3_understanding`
diagnostics into `grades.diagnostic` (which never affects points — CORE.md §6). `points_earned` is
clamped to the **offering's** `points_possible`, since the offering is authoritative about what the
assignment is worth this term and a CHECK enforces the bound.

**Verified through RLS, per persona:** all seven instructors now see 73 enrolments, 64 answers and
64 unfinalized suggested grades across 4 sections; the test cadet still sees 0 submissions and 0
grades, because an unfinalized grade is invisible to the student it belongs to. Sample cards render
real answers with `full`/`warn` states and their diagnostics.

**Also confirmed:** the faculty accounts were already wired correctly — every instructor resolved to
the right offering, sections and roster before this change. The empty Grade view was missing data,
not missing permissions. **phys-110 is left as-is** by request: 37 assignment offerings but no
sections, roster or staff, so the two global admins can switch into an empty course.

### Removed — the interactions page and the legacy Admin link; nav reduced to four destinations

**Frontend only. No database change.** Follows the part-2 rewire below. **Not yet pushed.**

**`site/app/faculty/interactions.html` is deleted.** Its authoring half was already unbuildable
(a standalone interaction cannot exist — `activities.assignment_id` is NOT NULL, publish is
per-offering, role is per-term), and rather than keep the monitoring remnant on life support,
Matthew chose to drop it and design a dedicated viewer later if one is wanted.

Its data layer **survives under a truthful name**: `faculty-interactions.js` → **`faculty-rollup.js`**.
The rename is the point — `faculty/report.html` (the lesson rollup) and the faculty dashboard both
depend on it, so this was never "the interactions module". Function names and arities are unchanged,
so both consumers were untouched. `report.html` now falls back to the dashboard where it used to
fall back to the deleted page, and the dashboard's "Open full rollup →" remains its entry point.

**The Admin link is removed from the faculty nav.** It opened the legacy `site/admin.html`, which
reads schema `public`. Now that the portal writes to `app`, that page shows stale data and any edit
made there never reaches students — so linking to it from the portal was actively misleading.

> **Known gap, stated plainly:** Export (Blackboard CSV / JSON backup) and instructor management
> live only on `admin.html` and have no portal equivalent. Removing the link does not lose a
> *working* capability — both read and write `public`, so both were already producing wrong
> results for the new model — but they do need rebuilding against `app` before they are next
> needed. Instructor management is the nearer deadline; the `create-instructor` edge function is
> already migrated and only wants a UI.

**Added but not mounted: `mountLegacyActions()`** — a director-only floating "Legacy Actions"
panel (collapsible, remembers its state, escapes its inputs, refuses to render for an instructor).
It was built for the two entries above; both were then removed, so mounting it would ship an empty
box. The component and its 13 tests stay, and `faculty/lessons.html` carries a comment showing the
one line that re-enables it when a retiring surface next needs a home.

### Changed — schema rewire part 2: lesson builder, AI workflows, and a course-view switcher

**Frontend, skills, and operator scripts. No migration, no database change.** Completes the
`public` → `app` move begun in "Schema rewire part 1". **Not yet pushed.**

#### Added — course-view switcher (user menu)

Faculty and multi-course students can now change which course/term they are looking at. It lives
in the **user dropdown, not the nav bar**: the nav bar is for destinations, while which course you
are viewing is context — and that menu already names you, your role and your course. The control
now sits beside the thing it describes.

It replaces the `.course-switch` pill row, which the term axis made untenable — a flat row cannot
express one course offered across several semesters. The picker groups by term (headings appear
only when more than one term is in play), marks the current row for assistive tech, and caps its
height so a system admin with many offerings cannot push *Sign out* off-screen.

Two calls worth recording: **students get it too** when they hold more than one enrolment (the
data supports it identically, and it grants no access — the list is only what RLS already
resolved); and **a global admin is labelled "Admin", not "Director"**, because auth.js marks every
offering `director` for an admin, which would read as false on each row.

`courseMenuHTML()` is exported as a pure function so it is testable without a DOM — 23 checks
covering grouping, selection, escaping and the admin case.

#### Changed — lesson builder rebuilt on assignments + offerings

A lesson IS an assignment offering, so authoring is now: pick or create the container →
attach its activities → schedule it into the term → set which activity carries credit. What a
director will notice:

- **Cross-pairing is gone.** An arbitrary preflight can no longer be stapled to an arbitrary
  interaction; both are activities of one container.
- **Removing a lesson is now destructive** — `submissions` and `grades` cascade from the offering.
  The delete modal states the counts first.
- **Publish no longer mirrors.** One flag on the offering covers both modalities.
- **Swapping an artifact slug deletes its reports** rather than orphaning them. The modal says so
  and steers toward keeping the slug and changing only the URL — which is the intended workflow.

The **prefill contract needs no URL change**: `site/faculty/lessons.html` and every parameter name
survive. `course=phys-215` is now resolved from a code to the current term's offering, and
`due_m`/`due_t` become per-section rows keyed off `sections.meeting_days` — both invisible to link
authors.

#### Changed — interactions admin reduced to monitoring

Its authoring half was **unbuildable, not merely stale**: `activities.assignment_id` is NOT NULL so
a standalone interaction cannot exist; publish is `assignment_offerings.is_published` covering the
whole assignment; graded-vs-practice is `offering_activities`. Every control edited something the
assignment or offering owns — i.e. the lesson builder. `docs/contracts/INTERACTION-PREFILL-LINK.md`
had *already* retired this page as a prefill base.

Create/edit/publish/delete are removed, with a comment explaining why they cannot return. What
remains is genuinely useful and homeless: completion per lesson × section, the per-student report
viewer, and cohort AI panels (now from `analysis_reports`). **Pending decision:** whether the page
is deleted once the lesson rollup absorbs those three panels.

#### Changed — AI workflows moved to `app`

`preflight-analyze` writes `grades` (upsert on `enrollment_id, assignment_offering_id`,
`source='ai_suggested'`, `is_finalized=false`, hidden diagnostics into `grades.diagnostic`) and
`analysis_reports` (`kind='by_question'`, one row per instructor via `audience_id` — which removes
the old fetch-and-merge step, so M and T runs now touch different rows). `interaction-aggregate`
and `interaction-backfill` follow the same path. Operator scripts moved off the
`claude_code_recker` credential (which only ever had rights in `public`) to the `prep_app_dml`
tier, with `SET search_path = app` in one place so no query can reach `public`.

**Two safety gaps closed on the way:** the backfill's grade upsert now carries
`WHERE NOT is_finalized`, and the skill filters finalized grades before its batch upsert. The old
`scores` upsert would have silently reverted a finalized score.

**One structural change forced by a constraint:** `analysis_reports` is
`UNIQUE (scope, scope_id, audience_id, kind)` and that key carries no lesson, so per-section rows
would have collided across every lesson in the term. A lesson's analysis is now one
offering-scoped row whose `payload` is keyed by section, merged on write to preserve the M/T split.

#### Fixed — three latent defects found while verifying

- **`assignments.objectives` is `{}` on all 74 rows** where the column is declared as an array.
  `x || []` passed it through because `{}` is truthy, so anything calling `.map()` would throw.
  `shapeOffering` now coerces. The data itself is still wrong and should be normalised to `[]`.
- **`faculty-report.js` is unmigrated dead code.** Nothing imports it — which is why the app works
  and why the import checker cannot see it. It carries a prominent warning header now rather than
  waiting to break whoever wires it up. (It is kept on purpose: it is the query layer for the
  by-question report, to be merged into the lesson rollup.)
- **`faculty/report.html` rendered section uuids** where a human expects `M1A`. Labels now show
  the code; the uuid remains the value everywhere it is compared.

#### Fixed — two documents that were wrong, not merely stale

- **`.ai/skills/setup-preflight/SKILL.md`** — its connection test omitted `Accept-Profile: app`, so
  it validated against `public` and **would have reported success even if `app` were unreachable**.
  A setup wizard that cannot fail is worse than none.
- **`site/app/help/director-ai-rules.md`** — said the database converts effort to points. True only
  on `grading_mode='effort'`; every Fall 2026 preflight is scheduled as `points`, where the
  analysis run applies the same curve. Corrected to say which applies when.

**Verification:** 202 Node checks (including 23 new switcher checks), 169 named imports resolving,
34 RLS persona checks, and `py_compile` on both operator scripts — all passing. Every PostgREST
projection written by either workstream was validated against the live schema before use.

**Still unverified:** faculty Grade, Roster and the rebuilt lesson builder have not been exercised
in a browser — no instructor login was available.

### Deployed — the three edge functions, to the live project

**Live state change.** `provision-students`, `create-instructor` and `remove-instructor` deployed to
`shzvpmlnqfmzfmuxkowi` via `npx supabase@latest functions deploy` (the CLI has no winget package;
`npx` is the supported route). `verify_jwt: true` is preserved on all three, matching their previous
deployment. Until this ran, the deployed versions still wrote `public` — provisioning student logins
would have written `public.students.auth_user_id`, left `app` unchanged, and **left students unable
to sign in**.

Verified against the live endpoints rather than assumed: each rejects the old `course_id` field with
its own migration message, and `course_offering_id` passes validation through to the authentication
check. Both halves of the new code path are therefore confirmed live.

**Found while deploying — three MORE deployed functions, and two of them now serve stale data.**
The project has six functions, not three. `gpt-create-lesson-link`, `gpt-lesson-input` and
`gpt-list-lessons` back the Custom GPT integration; their source is tracked, but under
`.ai/integrations/custom-gpt/`, not `supabase/functions/`, which is why they were invisible to this
work. All three are public (`verify_jwt: false`). `gpt-lesson-input` and `gpt-list-lessons` query
`public.lessons` and `public.lesson_chat_inputs` — the first no longer exists in `app` and the
second is now stale, so the Custom GPT lists lessons that no longer match what students see.
`gpt-create-lesson-link` only builds a prefill URL, and that contract is unchanged, so it is
unaffected. **Not fixed here:** the integration has its own OpenAPI spec and contracts, and
migrating it is its own piece of work.

### Changed — wired `site/app/` to schema `app` (PREP v2); two live migrations; one security fix

**Frontend, edge functions, two applied migrations, and a new test harness.** The `app` schema
was already built and populated; this connects the portal to it. **Not yet pushed.** The legacy
pages (`site/admin.html`, `site/index.html`) are untouched and still read `public`.

**Why now.** `supabase/migrations/app/001–004` built and migrated the v2 model, but every query
in `site/app/` still pointed at `public`. The two models were fully divergent — the portal was
reading a schema that is no longer where the work happens.

**The client moved, once.** `site/app/js/config.js` now creates its client with
`db: { schema: 'app' }`, so every `db.from(...)` in the tree resolves against `app` with no call
site naming a schema. `site/js/config.js` (the legacy pages) deliberately stays on `public`; a
test asserts both halves of that split, because changing either silently breaks the other.

**What the port actually required** — this was not a rename:

| `public` | `app` |
|---|---|
| `courses.id` `'phys-215'` | `courses.id` uuid + `courses.code` |
| `instructor_course_access` | `staff_assignments` (term-scoped, optionally per-section) |
| `instructors.is_director` | **gone** — authority lives only in `staff_assignments.role` |
| `students.section_id` | `enrollments` (a student may hold several) |
| `assignments` (+questions, due dates, published) | `assignments` + `activities` + `assignment_offerings` + `offering_activities` + `assignment_due_dates` |
| `interactions` (own table) | `activities` with `modality='interactive'` |
| `responses` | `submissions` + `submission_activities` |
| `scores` | `grades` (keyed on the enrolment) |
| `lessons`, `lesson_completions` | **gone** — a lesson IS an assignment offering |
| `due_date_m` / `due_date_t` | `assignment_due_dates` per section |

**The unit of scope is now the course OFFERING, not the course.** `auth.js` resolves which
offerings a caller can act in and mirrors `app.staff_sections()` exactly, so the UI scopes to the
same rows RLS returns — scope wider and the page shows unexplained blanks, narrower and it hides
work an instructor is meant to grade. The nav course-switcher keys on the offering.

**New: `js/schema.js`** holds every SELECT projection and all the derived rules (deadline
precedence, status, lock policy, effort→points) in one place, because computing them per page is
how the old frontend drifted. `student-lessons.js` became a projection over `student-data.js`
rather than a second query layer, for the same reason.

**Two behavioural changes worth knowing:**
- **A student can no longer write an input to their own grade.** In `public`, the interaction
  receiver's own upsert carried `effort` and a trigger turned it into a score. `grades_staff_write`
  correctly forbids that, so effort now travels inside the stored `schema:1` payload on
  `submission_activities` and becomes a grade only when staff or the analysis workflow reads it.
- **Committing is explicit.** `public` treated "a `responses` row exists" as submitted, so an
  autosaved draft counted. Hence the new `in-progress` state. Written answers stay editable until
  the deadline (STUDENT-LESSON-VIEW §4); committing fixes *which path* is graded, not the text.

**The frozen artifact↔site contract is unchanged.** `interaction-submit.html#i=<slug>` still
receives the same payload; the slug is now `activities.slug` (globally unique for exactly this
reason) and everything else is resolved from it. No deployed artifact needs rebuilding.

### Added — migration `005_extensions.sql` (applied)

`public.extensions` was empty and deliberately not migrated, but the Grade view offers extensions
and the student's deadline must honour them. Keyed on `enrollment_id` like every other
per-student table, so moving a cadet between sections cannot carry a Fall 2026 extension into
Spring 2027. Three RLS policies; deadline precedence is extension > per-section > offering.

### Fixed — migration `006_submission_lock_hardening.sql` (applied) — students could defeat the activity lock

**Found by `tests/app-schema/test-student.mjs`, reproduced against the live schema as a genuinely
signed-in student.** `001_core_model.sql` lists "the chosen activity cannot silently change" as a
structurally-enforced invariant, and `director-schema-reference.md` repeats it to directors as a
database guarantee. **It did not hold.** Two independent bypasses:

1. **Self-unlock by attribution.** `submissions_lock_activity()` refused an unlock with no
   `unlocked_by`, but never checked the caller was staff *or* the person named. With
   `submissions_student_update` allowing a student to write any column of their own row, and
   `instructors_read` being `USING (true)`, a student could list instructors, pick one, clear
   their own committed choice, and switch modality — with the audit trail naming an instructor
   who did nothing.
2. **Status revert.** The lock only engaged when `OLD.status = 'committed'`. Setting status back
   to `'draft'` was permitted, after which the choice was free. This needed no instructor id.

Both are closed in the trigger (RLS decides which *rows* a caller may touch; a `WITH CHECK`
cannot see `OLD`, so it is the wrong place for legal column transitions). A `current_uid() IS
NULL` bypass is retained for direct/operator connections, which already hold BYPASSRLS; a browser
user can never reach it, since an auth-issued JWT always carries `sub`.

**Why it mattered beyond tidiness:** `switch_policy` serves the research design. A student who
works the written preflight, reads the questions, then switches to the interactive lesson
contaminates the revealed-preference signal the study exists to collect.

### Fixed — `supabase/admin/app_rls_test.py` had been silently unrunnable

Bootstrap §6 added FKs from `app.students.auth_user_id` / `app.instructors.id` into `auth.users`.
The suite invented uuids for its personas, so it began failing at fixture build with a
`ForeignKeyViolation` and had not run since. Personas now borrow real ids (the app tier cannot
mint `auth.users` rows), every assertion is scoped to the fixture so the personas' genuine access
elsewhere is not counted, and the "teacher" is chosen as someone who directs nothing — otherwise
`director_offerings()` is global and every negative assertion is vacuous. Extended to cover
migration 005 and 006. **34 checks, all passing.**

### Fixed — `tests/browser/guard.js` locked every design sandbox

It selected `instructors.is_director` (dropped in v2), so PostgREST returned 400 and `instr` came
back null — and the fallback was *gated on `instr`*, so it never ran. A director was denied by a
query that failed before it could say yes. Now selects `id, is_global_admin`, falls back to
`staff_assignments` un-gated. Verified per persona: 5 directors + 2 admins pass, an
instructor-only account and a student are correctly denied.

### Added — `tests/app-schema/`: an optional Node harness (180 checks)

**Not a build step, and the site still has no Node dependency** (CORE.md §2) — nothing here is
served, imported, or needed to deploy. What Node buys is running the *shipped* modules against
the live database as a real signed-in user, instead of reimplementing the logic in Python and
testing the reimplementation. Five suites: pure domain rules, config targeting, PostgREST
projections (imported from `schema.js` so they cannot drift from what ships, with a negative
control), the end-to-end student path through RLS, and isolation (anon sees nothing; the
app-pinned client cannot reach `public`). Plus `test-imports.mjs`, a static linker for a project
that has no linker — it caught real breakage from renamed exports.

Tests sign in as **`3009999999` "ZZ Test Cadet"**, a deliberate test row; no real cadet account is
touched. `cleanup.py` handles teardown because RLS grants `DELETE` on `submissions` to nobody —
the suite genuinely cannot clean up after itself, which is the policy working as intended.

### Changed — edge functions moved to `app`

All three take `course_offering_id` instead of `course_id` and return a message naming the
migration when sent the old field. `create-instructor` and `remove-instructor` also **stop
treating `is_director` as a second global-admin flag** — under the old code a course director
could create and remove *system admins*.

**Verification:** 180 Node checks, 34 RLS persona checks, and the tier check all pass; the
database is left with zero test rows. **Not verified end-to-end: the faculty Grade and Roster
pages** — call sites are updated and imports resolve, but no instructor login was available to
exercise them in a browser.

**Deferred by agreement:** the lesson builder (`faculty/lessons.html`, `faculty-lessons.js`) and
interactions admin (`faculty/interactions.html`, `faculty-interactions.js`) are still on `public`
and are re-architectures rather than ports — a lesson is now an assignment offering.

### Added — `docs-author` skill: route a concept to the right doc, or to none

**Docs and skill only. No frontend, database, migration, or build-step change.** Not yet pushed.

**Why.** The Help centre shipped earlier today with five stub docs and an authoring contract
(`site/app/help/README.md`) covering the *mechanics* of adding a topic — file plus manifest entry —
but nothing about what belongs in one, who it is written for, or whether a given idea deserves a
document at all. The same gap existed on the `docs/` side: four design docs had converged on a house
format (title, **Status:** line, authorship line, numbered sections) that was never written down, so
each new doc re-derived it. Both gaps invite the same failure — documenting everything, which trains
readers to ignore documentation and leaves stale pages that are worse than missing ones.

**What was added:**
- **[`.ai/skills/docs-author/SKILL.md`](.ai/skills/docs-author/SKILL.md)** — a four-step workflow.
  Step 1 is a **routing gate** that decides between a help doc, a design doc, a contract, an
  architecture doc, a runbook, a `CHANGELOG.md` entry alone, or **nothing**. It is built to be able
  to answer *no*: the design-doc gate skips the doc when no rejected alternative can be named, and
  the help-doc gate escalates to a UI fix when the content would only warn users away from a trap
  the interface permits.
- **[`references/HELP-STYLE.md`](.ai/skills/docs-author/references/HELP-STYLE.md)** — checkable
  style rules for help docs plus a pre-flight checklist, grounded in the reading research (users
  scan rather than read; ~20% of words; F-pattern; arrival mid-task via `help.html?doc=`).
- **[`references/DESIGN-DOC.md`](.ai/skills/docs-author/references/DESIGN-DOC.md)** — a template
  matching the format `docs/` already uses, a content bar, and the lifecycle rules.
- **[`.ai/instructions/CORE.md`](.ai/instructions/CORE.md)** — `docs-author` added to the §4 runbook
  table so it is discoverable through the contract rather than by browsing `.ai/skills/`.

**Two rules worth calling out, because they are opposites and both are deliberate:**
- **Help docs must stay current; design docs must not be rewritten.** A help doc that disagrees with
  the app is a bug. A design doc is a point-in-time record of reasoning — it is superseded by a new
  doc with links in both directions, never edited into agreement with what shipped. Current-state
  truth lives in `PROJECT.md`, the contracts, and the code.
- **Required content never lives in a callout.** The five starter help docs each open with a `>`
  blockquote stub marker; that is fine as a temporary flag, but readers skip boxes, so the skill
  forbids the pattern for real content and tells authors to delete the marker when expanding a stub.

**Security framing made explicit.** `site/app/help/README.md` already warned that tier gating
controls what the Help page *lists*, not who can fetch a URL. The skill names that as CWE-425
(forced browsing) and CWE-656 (security through obscurity), and turns it into an authoring rule with
an enumerated never-list: no credential, connection string, internal path, answer key, or student
PII — including indirect identifiers that could re-identify a cadet in a small section — at any tier.
This is also the line that separates an admin-tier help doc from `docs/operations/`: help docs cover
what happens inside the app UI, runbooks cover SQL, migrations, scripts, and deploys.

**Verify:** nothing to render — these files are not served. `docs-author` is read by an agent before
it writes documentation. No help doc was created in this change, by request.

### Added — document/source dependency index and a staleness check

**Docs, index, and one read-only script. No database, migration, frontend, or build-step change.**
Not yet pushed.

**Why.** Several documents are *derived* — the help topics and `SYSTEM_GUIDE.md` restate what
`CORE.md`, `PROJECT.md`, the skills, and the frontend modules define, and `director-ai-rules.md`
says so on its own page. Nothing connected them, so editing a source left the derived documents
silently wrong. Users read help topics as authoritative; a stale one is worse than none.

**What was added:**
- **[`docs/DOC-SOURCES.json`](docs/DOC-SOURCES.json)** — the index. Eight entries, each naming a
  document that must stay current, the sources it was written from, and a `reviewed` date. Following
  Google's freshness-date convention, `reviewed` is an **attestation** ("someone checked this against
  its sources"), not an edit date — fixing a typo does not advance it.
- **[`scripts/docs/check_doc_sources.py`](scripts/docs/check_doc_sources.py)** — read-only checker
  (stdlib + `git`, no dependencies, writes nothing). `check` flags documents whose sources moved and
  exits non-zero; `list` prints the index; `--json` for both. It also **validates that every path in
  the index still exists**, so a rename that isn't reflected there fails loudly instead of silently
  un-tracking a document.
- **[`.ai/instructions/CORE.md`](.ai/instructions/CORE.md) §5** — the rule: before committing a
  change to `CORE.md`, `PROJECT.md`, a skill, a contract, or an indexed frontend module, run the
  checker and resolve what it flags. Registering a new document is part of creating it.
- **[`.ai/skills/docs-author/SKILL.md`](.ai/skills/docs-author/SKILL.md)** — registration added as
  verification step 4 and rule 11.

**Design note — what is deliberately *not* indexed.** `docs/decisions/` and `docs/contracts/` are
excluded. Those are point-in-time records and frozen interfaces: they are superseded by new
documents, never refreshed in place, so a staleness flag on them would be pure noise. This is the
same current-vs-archival split the `docs-author` skill draws.

**It catches uncommitted edits**, not just committed ones — so it fires before a change lands rather
than after. Verified against this session's own work: the in-progress `CORE.md` edit correctly
flagged all seven dependent documents.

**Known limit, stated in the script:** comparison is by date, so a source edited later on the same
day a document was reviewed is not flagged. The uncommitted-change path covers the case that
matters in practice.


### Changed — documented box-alignment rule; fixed the two boxes that broke it

**Frontend + docs only. No database change, no migration, no build step.** Not yet pushed.

**Why.** Content inside boxed UI (drop targets, option pickers) was inconsistently aligned and
`DESIGN.md` had no rule to settle it — three boxes centered (`.dropzone`, `.lb-figdrop`,
`.empty-state`) and three left-aligned (`.lb-drop`, `.dest-box`, `.choice-card`), with nothing
saying which was correct. The gap meant every new page re-litigated the question.

**What.**

- **`site/app/DESIGN.md`** — new **Alignment inside boxes** subsection under §Layout. The rule:
  left-align by default; center only when the box is empty and the prompt *is* the content. The
  test is the content, not the component, so a box flips as its content does. Two corollaries —
  don't center just because a box is small or dashed, and a lone icon needs a home rather than
  floating above a title.
- **`site/app/css/styles.css`** — `.lb-drop` (lesson-builder preflight/interaction drop targets)
  now centers its label + slot while empty via `.lb-drop:has(.lb-drop-slot.empty)`, matching
  `.dropzone` and `.lb-figdrop`; it reverts to left-aligned once filled with a real title.
  This was the one box actually inconsistent with the new rule.
- **`site/app/student/lessons.html`** — the lesson choice cards keep their left alignment (they
  carry title + body, so left is correct), but the orphaned `.choice-ic` glyph that floated on its
  own line now sits in a tinted rounded-square chip on the title row, following the `.stat-tile`
  icon-chip pattern and matching the §5 sketch in `docs/architecture/STUDENT-LESSON-VIEW.md`
  (`✎  Written preflight` on one line). **Both** chips deliberately use the same neutral
  `--mc-sel-bg` tint — an accent color on one path would be the styled default that
  `STUDENT-LESSON-VIEW.md` §2/§5 forbids, since it would bias the modality preference the
  choice screen exists to measure.

**Note.** `:has()` is used for the empty-drop-target rule; it is baseline in all current browsers
and degrades to the previous left-aligned rendering if unsupported.

---

## 2026-07-20 — Matthew via Claude

### Added — in-app Help centre with tiered, file-backed documentation

**Frontend only. No database change, no migration, no build step.** Not yet pushed.

**Why.** There was nowhere in the app to explain how it works, and — the prompting request — nowhere
to make the AI's rules and behavior visible to the people whose work it touches. Faculty and students
had to be told these things out of band, or read the repo.

**What was added:**
- **A `Help` item in the user dropdown** ([`site/app/js/nav.js`](site/app/js/nav.js)), above a new
  separator that sets it off from Sign out. It is in the dropdown rather than the main nav because
  the nav bar is reserved for places work happens; Help is a reference surface.
- **[`site/app/help/`](site/app/help/)** — where help content lives. Markdown files plus
  `MANIFEST.json`. **Adding a topic is a file and a manifest entry, no code change.** The authoring
  contract, including the tier table and the deploy caveat, is
  [`site/app/help/README.md`](site/app/help/README.md).
- **Cumulative role tiers** — `student` → `instructor` → `director` → `admin`. A doc's `tier` is the
  lowest role that may see it; each tier sees its own docs and every tier below. Director status is
  resolved with `ctx.isDirectorForCurrent()`, so it is **per-course**: a director in Phys 215 who is
  an instructor in Phys 110 sees director topics only while 215 is selected, and the page re-renders
  on a course switch.
- **[`site/app/js/help.js`](site/app/js/help.js)** + `student/help.html` and `faculty/help.html` —
  index grouped by tier, doc reader, deep links (`help.html?doc=<id>`), Back/Forward via
  `history.pushState`. Markdown renders through `marked` → `DOMPurify`, matching every other
  markdown surface on the site.
- Five starter docs, **all marked as stubs to be expanded**: two student-tier (getting started; how
  AI is used on your work), one instructor (grading and the 3-state toggle), one director (AI rules
  and behavior — the analysis workflows, that suggested scores are never final, that the hidden 0–5
  diagnostics are not grades), one admin (system operations). The director and admin docs summarize
  `CORE.md` and `PROJECT.md` and say so in-page; **those files stay authoritative.**

**Known limit, deliberate:** these are static files on GitHub Pages, so **the tier gate controls what
the page lists, not who can fetch a URL.** Anyone who guesses a filename can read any of them, signed
in or not. No secret, credential, PII, or answer key may go in `site/app/help/`. Content that must
actually be restricted belongs behind RLS.

**Verify before pushing:** `python -m http.server 8000`, then
`http://localhost:8000/site/app/faculty/help.html`. Assets were confirmed to serve and the manifest
to parse; the rendered pages need a signed-in browser check, which was not possible here.

### Added — `app` schema + three tiered agent roles (PREP v2 groundwork)

**Applied to the live project** (`shzvpmlnqfmzfmuxkowi`) via
[`supabase/admin/app_schema_bootstrap.sql`](supabase/admin/app_schema_bootstrap.sql), run as
`postgres` in the SQL Editor. **Other agents: schema `app` and roles `prep_app_*` now exist.**

**Why.** A schema audit found the data model conflates content with delivery (a preflight *is* its
Fall-2026 due date, so it cannot be reused next term), has no `terms` concept, allows a student only
one section ever, and spreads a single lesson's grade across three tables. The redesign separates
catalogue / delivery / work — see the proposal linked from this entry's discussion. The rebuild
happens in a **new schema in the same project**, not a new project, so the 73 provisioned student
logins and 7 instructor accounts in `auth.users` keep working unchanged.

**What was created — additive only; `public` is untouched** (verified after: still 16 tables, 62
policies, identical to the pre-run introspection):
- Schema `app`, owned by `prep_app_owner`. Currently empty.
- Three login roles, all `BYPASSRLS`, none with rights on `public`:
  `prep_app_owner` (owns `app` → full DDL, build-out only), `prep_app_dml` (data, no DDL — the
  everyday agent role), `prep_app_read` (SELECT only).
- Default privileges on `app` so future tables auto-grant to the agent tiers **and** to
  `anon` / `authenticated` / `service_role`, with RLS still gating every row as it does in `public`.

**Two PostgreSQL/Supabase constraints found by pre-flight checks, both documented in the script:**
- *PG16+ role membership.* `createrole_self_grant` defaults to `''`, so a `CREATEROLE` role gets only
  `ADMIN` on roles it creates, not `SET`. `CREATE SCHEMA ... AUTHORIZATION` then fails with
  `42501: must be able to SET ROLE`. Fixed by `SET LOCAL createrole_self_grant = 'set, inherit'`
  (§0). First run hit this and rolled back cleanly.
- *`auth` schema is not ours.* `postgres` holds USAGE on `auth` and REFERENCES on `auth.users`
  **without grant option**, so neither can be delegated to `prep_app_owner`. No `auth` grants are
  attempted (§5); the two FKs into `auth.users` must be added by `postgres` after the tables exist
  (§6). The app tier never needs to read `auth.users` — the uuid is stored locally and provisioning
  runs through the existing edge function as `service_role`.

**Verification.** [`supabase/admin/app_tier_check.py`](supabase/admin/app_tier_check.py) proves
against the live DB that each tier connects, that only the owner can do DDL, and that **no tier can
read or write anything in `public`**. All checks pass. Credentials live in the gitignored
`supabase/admin/.env`; the committed SQL keeps `REPLACE_ME_*` placeholders.

### Added — PREP v2 core model in `app` (18 tables)

Applied via [`supabase/migrations/app/001_core_model.sql`](supabase/migrations/app/001_core_model.sql)
as `prep_app_owner`. Numbered separately from `supabase/migrations/*.sql`, which remains the chain
for `public`. Result: 18 tables, 77 constraints, 48 indexes, 10 triggers.

**Scope (decided with Matthew).** Preflights only. The homework/quiz/exam layer —
`grading_categories` with weights, `external_systems`, `external_links`, `import_batches` — is
deliberately **not** built. `activity_kinds` **is** included as a lookup table seeded with one row,
so adding a type later is an INSERT rather than a migration; that was a judgment call within the
"preflights only" scope and is easy to drop.

**The shape, in Matthew's framing:** an **assignment is a container**; **activities** are the
possibilities inside it. Naming follows that directly rather than my first draft, which had called
the container `activities` and buried the contents in `activity_components`.

- *catalogue* (term-free, reusable): `courses`, `terms`, `assignment_kinds`, `assignments`
  (the container), `activities` (its contents — written question set, interactive artifact)
- *delivery* (term-scoped): `course_offerings`, `sections`, `students`, `enrollments`,
  `instructors`, `staff_assignments`, `assignment_offerings`, `offering_activities`,
  `assignment_due_dates`
- *work* (per enrolment): `submissions`, `submission_activities`, `grades`, `grade_events`
- *analysis*: `analysis_reports`, replacing both `assignments.analysis_report` and
  `interaction_analysis`

**Grading policy lives on the OFFERING, not the activity** — `offering_activities` carries
`grading_role` (`graded` | `practice`) and `available_after` per term. This was driven by a
requirement raised during the build: the written questions should stay present-but-ungraded behind a
forced interactive, **so that if the interactive implementation fails mid-term the whole cohort can
be moved onto the questions**. That flip is two UPDATEs on `offering_activities`; the library
assignment is never touched, and grades already earned are undisturbed. It also means Fall 2026 can
grade the interactive while Spring 2027 grades the written, from one library definition.

Consequently there is **no `selection_policy` column** — "single vs choice" is *derived*: one
graded activity this term means required, two or more means the student chooses. Nothing to drift.

**Decisions worth recording:**
- `grades` is a **separate table** from `submissions`, with `submission_id` nullable — so an exam
  scored in Gradescope can carry a grade with no submission in this system.
- `switch_policy` lives on `assignment_offerings` as **data**, not compiled into a trigger, because
  the research design's phase sequence deliberately changes what students may do.
- An instructor unlock **requires `unlocked_by`**; the trigger refuses an unattributed unlock.
- The gradable-activity trigger fires **only when the choice actually changes**, so a mid-term flip
  cannot retroactively invalidate submissions students already committed.
- A composite FK guarantees a chosen activity belongs to the offering it is being chosen in.
- Modality is a property of an activity, not a top-level entity — this is what removes the
  parallel assignment/interaction worlds and the `lesson_completions` reconciliation layer.
  `assignments` now plays the role `lessons` did, as the primary noun rather than a patch.
- `activities.slug` is the frozen-contract surface; existing `interactions.id` values migrate here
  verbatim so deployed artifacts keep resolving.
- **Open:** the name `assignment_offerings` (mirrors `course_offerings`) is not settled.

**Verified, not asserted.** [`app_invariant_test.py`](supabase/admin/app_invariant_test.py) builds a
throwaway fixture, exercises the guarantees, and rolls back — all **22 checks pass**, including:
a second grade for the same (enrolment, offering) is refused; `points_earned > points_possible` is
refused (the "4 out of 2" bug, now structurally impossible); the effort→points curve matches
migration 013 scaled to `points_possible`; a practice activity can never be chosen for credit; an
activity from another offering cannot be chosen; the lock behaves per `switch_policy`; and the full
mid-term flip scenario — a graded interactive swapped to practice — leaves existing grades intact
while redirecting new students to the questions.
Structural checks confirm **zero foreign keys from `app` into `public`** (bootstrap §9 invariant) and
`public` still at exactly 16 tables.

### Added — RLS for `app` (50 policies), and the four `public` audit holes closed

Applied via [`supabase/migrations/app/002_rls.sql`](supabase/migrations/app/002_rls.sql).
**50 policies across 19 tables**, versus 62 in `public`, and nearly all of them are one of two
shapes: *"does the caller own the enrolment this row hangs from"* (student rows) or *"does the
caller staff the section that enrolment belongs to"* (staff rows), plus a director escalation.
That regularity is the enrolment model paying off — `public` had no single join path from a row
back to its owner, which is part of why its policies drifted wrong.

**The July 2026 audit findings, addressed structurally:**

| `public` today | `app` |
|---|---|
| roster world-readable (`students: SELECT true`, role `public`) | a student sees only themselves; staff see only students they teach |
| anyone may insert/overwrite any student's answers before the due date | writes require owning the enrolment; **no policy grants `anon` anything at all** |
| every finalized score readable by everyone (`is_finalized = true`, no owner check) | own grade only, and only once finalized |
| `directors_delete_students`: `authenticated`, `USING (true)` | only a director of an offering that student is enrolled in |

**No `auth.uid()`.** The app tier holds no privileges on schema `auth` (§5), so
`app.current_uid()` reads the same JWT claim through `current_setting()`, which lives in
`pg_catalog`. Behaviourally identical, and it drops a dependency on Supabase internals. Helpers are
`SECURITY DEFINER` + `STABLE` so a policy on `students` can call a helper that reads `students`
without recursing.

**Enforcement is proven, not assumed.** Structural checks alone were not enough: every agent tier
carries `BYPASSRLS` by necessity, so none of them can test whether policies actually bite. Bootstrap
§10 adds `GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE`, letting the owner drop
*down* into a role with no `BYPASSRLS`.
[`app_rls_test.py`](supabase/admin/app_rls_test.py) then runs four personas — two students, a
section instructor, a director — against a fixture and rolls back. **All 23 checks pass**, including
every row of the table above.

### Added — term calendar columns, and `public` content + roster migrated into `app`

`003_term_calendar.sql` adds `finals_start`, `finals_end`, `grades_due_on` to `terms` (all
nullable, with an ordering CHECK). USAFA tracks more than start/end: instruction ends before the
term does, and grades are due after finals. Fall 2026 is now recorded in full — instruction
2026-08-06 → 12-10, finals 12-12 → 12-16, grades due 12-21.

[`scripts/app_migration/migrate_public_to_app.py`](scripts/app_migration/migrate_public_to_app.py)
— dry-run by default per CORE.md, idempotent, one transaction. Run dry, reviewed, then `--commit`.

| Migrated | |
|---|---|
| 1 term, 2 courses, 2 course offerings | both phys-110 and phys-215 run in Fall 2026 |
| 4 sections, 73 students, 73 enrolments | `M1A` → `meeting_days {M}, period 1`; the day/period regex is gone |
| 7 instructors, 10 staff assignments | 6 offering-wide from `instructor_course_access` + 4 section-scoped from `sections.instructor_id` |
| 74 assignments → 74 containers + 74 written activities + 74 offerings | |
| 3 interactions → 3 interactive activities | attached to their lesson's container |
| 148 per-section due dates | M sections take `due_date_m`, T sections `due_date_t` |
| 14 lessons | **dissolved** — a lesson *was* the container, so it becomes one |

**Deliberately left behind, all of it test data** (originals untouched in `public`): 64 responses
and 64 unfinalized scores on `preflight-02` (from `scripts/training/seed_training_preflight02.py`,
never real student work); 6 June backup interaction reports; 2 `interaction_analysis` rows scoped to
section `M5A`, which does not exist; the single training-run `analysis_report`.

**Decisions encoded, each documented in the script header:**
- **An interaction migrates iff a lesson claims it.** That one rule resolves the duplicate lesson-02
  slug as Matthew chose: `lesson-02-electric-charge-coulombs-law` comes across;
  `lesson-02-electric-charge-and-coulombs-law` (published, orphaned, holding the analysis and backup
  rows) does not. ⚠ **The activity slug is the frozen contract surface — confirm a deployed artifact
  posts to the short slug before students launch it**, or submissions will be FK-rejected.
- **Slugs de-prefixed.** `phys-110-preflight-02` → `preflight-02`; `app` scopes slug by course, so
  the July 2026 collision namespace is no longer needed and cannot recur.
- **`grading_mode` = `points`, not `effort`.** Preserves today's per-question scoring.
  LESSON-UNIFICATION D3 proposes effort-gating both paths, but that is a pedagogical decision and a
  migration is the wrong place to make it silently. One UPDATE per offering to switch.
- **Graded-vs-practice derived from the old `completion_policy`:** lesson-02 (`preflight`) →
  written graded with the interactive present as practice; lessons 03/04 (`choice`) → both graded.

**Verified by read-back.** All counts reconcile. `public` is byte-for-byte unchanged on every
metric (74/73/64/64/14/4 rows, 62 policies, 16 tables). Zero foreign keys from `app` into `public`.
Both suites re-run green against the schema now holding real data: 22 invariant checks, 23 RLS
enforcement checks.

### Added — snapshot-at-term-close, so an artifact can be rebuilt without erasing history

`004_content_snapshot.sql` plus
[`scripts/app_migration/freeze_term.py`](scripts/app_migration/freeze_term.py) (dry-run by default).

**The problem it solves.** An interactive activity is a slug plus an artifact URL. Rebuilding the
artifact for a later term means overwriting that URL in place — which keeps **one stable slug per
lesson forever**, so slugs never proliferate and the frozen `#i=<slug>` contract needs no change.
The cost is that "what did Fall 2026 actually run?" becomes unanswerable. Freezing captures it first.

Considered and rejected: allowing multiple generations of an activity per container (dropping
`activities_one_per_modality`). It would have supported A/B-testing two artifact variants and made
stale bookmarked artifacts fail safe, but it forces new slugs every rebuild — reintroducing exactly
the slug-proliferation problem this avoids. Deferred, not foreclosed: `offering_activities` already
selects which activities are live, so dropping the constraint later remains a one-line change.

**Freezing happens at term close, not at publish** — publish can toggle more than once, and the end
of term is when the record should harden. `terms.grades_due_on` is the trigger date;
the `terms_awaiting_freeze` view lists what is overdue. Once `content_snapshot_frozen_at` is set, a
trigger refuses any change to the snapshot; a deliberate correction must clear the stamp in its own
statement first. Verified: first freeze succeeds, overwrite blocked, re-freeze without force
refused, forced re-freeze succeeds.

### Added — help doc: Course and assignment structure (director tier)

[`site/app/help/director-course-structure.md`](site/app/help/director-course-structure.md), written
against the `docs-author` skill. Reference mode, tier `director` (cumulative to admin): the four
levels (course → course offering → assignment → activity), the graded/practice settings and the four
arrangements they produce, the one-grade guarantee and the activity lock, how reuse works across
semesters, and why to freeze before rebuilding an artifact.

**Deliberately omits all RLS policy detail.** Help docs are static files on GitHub Pages and are
world-readable at every tier, so access-control internals cannot appear in one. Role behaviour is
described functionally instead. Registered in `docs/DOC-SOURCES.json`; manifest validated; renders
at `localhost:8000` under the director tier.

⚠ **The doc describes the `app` schema, which the UI does not use yet.** It is accurate about the
database and premature about the product. If other directors should not see it before `site/app/`
cuts over, remove the `course-structure` entry from `site/app/help/MANIFEST.json` and restore it at
cutover — the file itself can stay.

### Changed — CORE.md now describes both schemas, both migration chains, and the sealed DDL tier

An agent auto-loading CORE.md previously saw a system with one schema and one migration chain. Four
edits: §0 gains a table distinguishing `public` (live, serves every page) from `app` (built, tested,
not yet wired) and states which is authoritative for what; §0 also records the three `prep_app_*`
roles and that the owner is `NOLOGIN`, so DDL on `app` requires a deliberate unseal; §3 adds
`supabase/admin/.env` to the secrets table; §5 documents the two independent migration chains **and
that `021_lesson_finalize_and_extensions.sql` must not be applied** — it looks like a pending
migration and applying it would be wrong.

### Closed out — migration window revoked, auth FKs added, DDL tier sealed

Run in the SQL Editor as `postgres`. The two FKs into `auth.users` now exist on `app.students` and
`app.instructors`, matching what `public` carries. `prep_app_owner` is `NOLOGIN`; `app_tier_check.py`
reports it as `[gate]` rather than a failure, which is the script behaving as designed. No app-tier
role can read `public` any more.

### Added — help doc: Data model reference (director tier), with an inline schema diagram

[`site/app/help/director-schema-reference.md`](site/app/help/director-schema-reference.md) plus a
scoped `.sf-*` block in `site/app/css/styles.css`. Every table and field across the four layers,
what the database enforces, and an inline SVG of the layer stack.

**The diagram is SVG inside Markdown, which the docs-author skill nominally forbids.** Matthew
waived that for this document. It is safe here: `help.js` calls `DOMPurify.sanitize()` with default
config, whose allowlist covers SVG elements and `class` — so the figure survives while scripts and
event handlers would not. It carries no `<style>`, no `style=""`, and no `<script>`; all colour comes
from the theme tokens, so it follows light and dark with one copy. **The skill's claim that "tags are
stripped" is imprecise and should be corrected when that skill is next revised.**

**Verified rather than asserted:** a checker parsed the document and cross-checked it against
`information_schema` on the live database — 52 documented fields all exist, and all 19 base tables
are documented. The first run of that checker caught a real gap (`analysis_reports` had no section)
and also produced a false positive from a regex that ran past section boundaries; the checker was
fixed before the result was trusted. Registered in `docs/DOC-SOURCES.json`; manifest validated;
renders at `localhost:8000`.

⚠ **The SVG has not been checked in a browser.** It is well-formed XML and uses only
DOMPurify-permitted constructs, but no one has looked at it rendered. If DOMPurify does strip it, the
Markdown tables below carry the whole payload and the page stays complete.

### Fixed — the two director help docs contradicted each other on who may unlock a submission

Review of both pages against the live schema found one error, one stale figure, and one gap — all
three traceable to the same cause: four topics were explained independently in both documents, with
no link between them, so improving one silently diverged from the other.

- **Error.** `director-course-structure.md` said an unlock required "an instructor with the director
  role." The policy is `submissions_staff_update`, scoped to staff of the *section*, which includes
  plain instructors. The narrow claim would have sent instructors escalating to a director while a
  student waited. Corrected, and the reference now owns the statement.
- **Stale figure.** `extensions` had been added to the schema and to the reference's table listing
  but not to the SVG, which claims to show every table. The delivery band was re-laid out from two
  rows to three; a geometry check confirms all 20 boxes sit inside their bands with no overlap.
- **Gap.** The structure doc described deadlines as offering-default plus section-override, missing
  extensions entirely — the layer behind the most common question a director gets about dates. It
  now documents the three-level precedence.

**Deduplicated so it stops recurring.** `director-schema-reference.md` now owns the enforced-rules
list and the exact accepted values; `director-course-structure.md` covers the shape of the model and
links out twice rather than restating. Verified afterwards that the one-grade rule, graded/practice,
and the enforced-rules list each appear in exactly one of the two.

**Filled the reference's remaining gaps:** the four `switch_policy` values and what each does; what
`grading_mode` changes for a student, and that all 74 Fall 2026 offerings are `points` /
`lock_on_commit`; what happens to work when a student drops or changes section (a second enrolment,
never an edit — which is why a mid-semester move cannot re-attribute past grades); what
`grade_events` is for; and `terms_awaiting_freeze` as the check for when a semester is due to be
sealed.

**No UI procedures, by decision.** Both pages describe the model and deliberately say nothing about
where to click, because `site/app/` does not read the `app` schema yet. Instructions get added at
cutover.

Re-verified: 20 of 20 tables documented, 52 fields checked against `information_schema`, SVG
well-formed, both pages render at `localhost:8000`.

**Still to do.** Point `site/app/` at the `app` schema and rewire, then add the UI procedures to both
help docs. Write the architecture doc for the v2 model and add a supersession banner to
`LESSON-UNIFICATION.md` pointing at it. Confirm a deployed lesson-02 artifact posts to the short slug
before students launch it.

---

## 2026-07-20 — Casey via Claude

### Fixed — assignment-id collision that overwrote 34 phys-215 preflights; namespaced phys-110

**Incident.** `assignments.id` is a single globally-unique PK (not scoped by course). The phys-110
build earlier today (entry below) upserted ids `preflight-02`…`preflight-41` with `on_conflict=id`
and `course_id='phys-110'`, which **overwrote the identically-id'd phys-215 rows** — flipping 34 of
37 phys-215 preflights to phys-110 content. Only `preflight-13/24/36` survived (the ids the 110 build
skipped as 110 GRs). Fallout: the 64 fake training responses + prior scores on `preflight-02` were
left pointing at a phys-110 kinematics question, and 15 phys-215 `lessons.preflight_id` FKs resolved
to phys-110 rows. No real student data was affected (only `preflight-02` had any responses/scores).

**Fix (pure DML, no DDL).** phys-215 keeps the bare `preflight-NN` ids (so its 15 lessons FKs + 64
responses/scores realign automatically); **phys-110 is re-namespaced to `phys-110-preflight-NN`** so
the two courses' id spaces are disjoint and neither build can clobber the other. Composite-key
`(course_id, id)` was considered and rejected as a DDL-blocked, multi-table migration for a cosmetic
gain. Steps, all verified by read-back:
- [`build_110_preflights.py`](scripts/fall2026/build_110_preflights.py): row id now
  `phys-110-preflight-NN` (course-prefixed; documented convention for any future course).
- [`build_fall_preflights.py`](scripts/fall2026/build_fall_preflights.py) re-run `--commit` (HTTP 200)
  to restore all 37 phys-215 `preflight-NN` rows. Also made its docx path resolve from the config
  `textbook_base_path` (portable when the repo isn't nested inside the PREP OneDrive folder).
- [`clean_stale_phys110_ids.py`](scripts/fall2026/clean_stale_phys110_ids.py) (new, snapshot +
  dry-run by default) deleted the 3 orphaned phys-110 rows left under `preflight-12/23/35`.
- Repopulated phys-110 (HTTP 201). Invariants: phys-215=37 (all `preflight-NN`), phys-110=37 (all
  `phys-110-preflight-NN`), no id shared across courses, all phys-215 lessons FKs resolve to phys-215.

### Changed — re-ran /preflight-analyze on phys-215 `preflight-02` with the new 0–5 diagnostics

Re-graded the 64 lesson-2 training submissions per the updated
[`preflight-analyze` skill](.ai/skills/preflight-analyze/SKILL.md) so they carry the hidden 0–5
`q2_effort`/`q3_understanding` diagnostics (migration 022) the earlier run predated. 3-state credit
stays liberal (q3: 42 full / 20 warn / 2 zero — only blanks scored zero) while the hidden
`q3_understanding` spreads 0–5, flagging misconception answers (protons move, friction creates charge,
etc.) as 1–2 **despite** earning full credit. Diagnostics stay out of `question_scores`, feedback, and
totals; `is_finalized=false`; per-instructor `analysis_report` regenerated for the live section→
instructor map (Casey: M1A/M3A; Tyler Jones: T1A; Matthew Recker: T3A). Read-back verified 64/64 rows,
all diagnostics integers in [0,5].

### Added — 37 Physics 110 Fall 2026 written preflight assignments

> Superseded in part by the id-collision fix above: the ids created here were `preflight-NN` and are
> now `phys-110-preflight-NN`.

Physics 110 previously had no preflight assignments in the DB. Added
[`scripts/fall2026/build_110_preflights.py`](scripts/fall2026/build_110_preflights.py)
(adapted from the 215 `build_fall_preflights.py`) and **ran `--commit` against the live DB
(HTTP 201), verified by full read-back**: 37 `assignments` rows (`course_id='phys-110'`,
`is_published=true`), one per lesson for lessons 2–41 excluding Lesson 1 and the three GRs
(13, 24, 36), per the syllabus rule "every lesson has a preflight except Lesson 1 and GRs."

Each row mirrors the 215 three-question structure (2 pts total): Q1 reading-time reflection
(0 pts), Q2 confusing/interesting reflection (1 pt), Q3 the lesson's JiTT or Journal
conceptual question (1 pt) with a grader `expected_response`. Q1/Q2 use the exact live 215
wording; the 7 lab lessons (6, 7, 10, 19, 23, 32, 38) use the lab-instruction wording variant.
Sources: `Physics110_Preflight_Questions_v2.docx` (questions + RAG lines + grader hints) and
the Fall 2026 syllabus **Table 2** (M/T preflight due dates, stored as 2359 America/Denver →
UTC, DST-aware). `reading_link` is null on every row. RAG `reference_pdf`/`reference_pages`
point into `Text_Book_PDFs/110 Sections/` (apostrophes/dashes normalized to match the
on-disk filenames; all 30 non-lab PDF paths verified to resolve); labs carry null RAG.
No embedded figures exist in the docx, so no figure assets were added. The builder is
idempotent (upsert on `id`) and dry-run by default per CORE.md §4.

## 2026-07-16 — Casey via Codex

### Added — hidden Q2-effort and Q3-understanding diagnostics for written preflights

Added migration [`022_preflight_question_diagnostics.sql`](supabase/migrations/022_preflight_question_diagnostics.sql)
with nullable, range-checked `scores.q2_effort` and `scores.q3_understanding` columns. **Applied to
the live DB by Casey and verified by Codex** with a zero-row REST schema probe selecting both columns
(HTTP 200, empty result). Migration 021 remains drafted/not applied; 022 has no dependency on it and
was applied independently while the larger lesson-finalization migration remains deferred.

Extended the canonical [`preflight-analyze` skill](.ai/skills/preflight-analyze/SKILL.md) to score
Q2 engagement and Q3 demonstrated physics understanding from 0–5 for every submitted student, write
both values in the existing score upsert, and verify them by exact read-back. The detailed reusable
rubrics live in `references/QUESTION-DIAGNOSTICS.md`. Blank Q2/Q3 answers within a submission score 0;
students with no submission receive no score row. These values are diagnostics only: they never
change points, three-state status, feedback, totals, or finalization, and student pages do not request
or render the new columns. Direct retrieval under the existing score RLS remains possible by design;
faculty-facing retrieval is deferred.

## 2026-07-16 — Matthew Recker via Claude

### Found — the `responses` / `extensions` RLS predates student auth and is wide open

**Not yet fixed on the live DB** — the repair ships with migration 021 below, which is drafted but
**not applied**. Read `supabase/rls.sql` §RESPONSES: its own header says *"No auth JWT on student
side — application enforces student_id ownership."* That was true until migration 004 gave students
real Supabase Auth accounts; the policies were never revisited. As they stand:

| Policy | Allows |
|---|---|
| `responses: anon reads` — `USING (TRUE)` | Anyone with the **public** anon key reads every cadet's answers, unauthenticated |
| `responses: anyone inserts` | Anyone inserts a response for **any** `student_id`; no deadline check (it exists only on UPDATE) |
| `responses: anon updates own` | Deadline checked against legacy `assignments.due_date`, **ignoring `extensions`** |
| `extensions: manage_extensions` — `FOR ALL TO authenticated USING (true)` | Students **are** `authenticated` — a cadet can grant themselves an extension to any date |
| `lc: student inserts own` (migration 016) | A cadet can insert their own `lesson_completions` with `effort=5` → `points=2` and lock it in |

**Consequence worth knowing now: extensions do not work today.** The UPDATE policy refuses any edit
past `assignments.due_date` regardless of any grant, and autosave creates the row on the first
keystroke — so for practically every student, a granted extension silently does nothing. The UI
shows the assignment as open, then every save fails.

Verified against the committed `rls.sql`; no later migration touches these policies. **Confirm
against the live DB before acting.**

### Added — migration 021: finalize lifecycle, extension-aware due cutoff, RLS repair (drafted, NOT applied)

Phase 2 of [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md), continuing from 016.
[`supabase/migrations/021_lesson_finalize_and_extensions.sql`](supabase/migrations/021_lesson_finalize_and_extensions.sql):
`responses.is_final`; the two mint triggers that create a `lesson_completions` row when either path
finalizes (leaving the frozen artifact receiver untouched); a server-side, extension-aware due
cutoff; lazy promotion; `extensions.lesson_id`; and the RLS repair above.

**The lock model changed** — D4/D9 of the parent doc are superseded (see its §6 amendment). The
interaction is now the only lock; the written preflight stays editable until the deadline;
`preflight → interaction` is a one-way switch; an instructor's extension overrides everything.
Choosing the interaction **supersedes** the written answers rather than deleting them — the
`responses` row survives so D5/§13 did-both detection keeps working, and supersession is *derived*
(non-grading iff a completion has `path='interaction'`) so it can't drift.

Three corrections to the doc's spec, folded in: the preflight trigger must fire on **INSERT or
UPDATE** (§7 says UPDATE only — but the client upserts, so a first-time submit would silently mint
nothing); the mint must gate on `completion_policy` (§5 allows a component attached as optional
practice, which must not grade); and the guard must permit writes that don't touch `answers`, or
the `/preflight-analyze` sweep aborts the first time it meets a student who switched paths.

**Before applying:** provision student accounts and confirm `students.auth_user_id` has no NULLs
(all 73 are NULL today — the new RLS ties every student read/write to it, so a partial provisioning
failure becomes a silent lockout); and check `count(*) FROM responses` for the `is_final` backfill
(the old model can't distinguish an abandoned autosave from a deliberate submit). **Untested** —
needs a browser pass. DDL on the shared live DB → CORE.md §0.

### Changed — student pages: Submit means something, and switching paths is warned

[`student/assignments.html`](site/app/student/assignments.html): Submit now sets `is_final` (it was
byte-identical to autosave, so it did nothing); autosave detects a server-side lazy promotion and
re-renders rather than reporting a save that didn't happen; a submitted-but-editable state.
[`student/interaction-submit.html`](site/app/student/interaction-submit.html): counts the student's
saved written answers on load and warns twice — a banner and a confirm — that submitting the report
locks those answers out of grading. Both are inert until 021 is applied.

### Added — student lesson view: cadets now navigate by lesson, not by modality

Phase 5 steps 1–4 of [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md), built to
the design below. **Inert until migration 021 is applied** — without `lesson_completions` rows every
lesson resolves to "not started".

- **[`js/student-lessons.js`](site/app/js/student-lessons.js)** (new) — the lesson data layer and the
  7-state machine, batched, no N+1. `state` is computed **once, here**, so the list and the dashboard
  cannot disagree (the pattern `student-data.js` already used for assignments).
- **[`student/lessons.html`](site/app/student/lessons.html)** (new) — lesson list + detail, the choice
  modal, and the launch warning. `assignments.html` is **kept** as the written-preflight surface,
  reached from a lesson instead of the nav, so orphan assignments still resolve and nothing built
  there is thrown away.
- **[`student/dashboard.html`](site/app/student/dashboard.html)** — lesson-centric. The standalone
  "Lesson interactions" section is gone; it was the double-count made visible.
- **[`js/nav.js`](site/app/js/nav.js)** — student nav is now `Dashboard · Lessons`.

**Why:** the student side still rendered `assignments` and `interactions` as two parallel lists with
two separate to-do counts, so a `choice` lesson — one piece of work, two ways to do it — appeared as
**two mandatory assignments**, with nothing on screen saying they were alternatives or that doing one
closed the other.

**Two deliberate calls, both about not biasing the experiment.** The choice modal styles *neither*
option as primary, and status dots stay modality-neutral (a `.tag` says which path was taken) — a
default or a colour-coded dot would put a thumb on the scale of the revealed-preference signal the
phase sequence exists to measure. And the dashboard's grade tile now shows **points earned, not an
average percentage**: a lesson is 2 points of *effort* (D3), so a correctness percentage would tell
cadets they're graded on getting it right.

**Verified** in headless Chrome against the local server: both pages parse, the full import graph
resolves, `bootstrap()` runs and redirects an unauthenticated visitor to login, and a temporary
harness confirmed the export contract plus that every state maps to a dot class the stylesheet
defines. **Not verified:** anything requiring a login — no student accounts are provisioned yet.

### Added — `STUDENT-LESSON-VIEW.md`, the Phase 5 design

[`docs/architecture/STUDENT-LESSON-VIEW.md`](docs/architecture/STUDENT-LESSON-VIEW.md) — the first
doc specifying what a cadet actually sees. An 8-state machine, the choice modal, the three
escalating switch warnings, per-state study-mode copy, and a dashboard rework. Composition only —
no new CSS. **Why it was needed:** the student side still renders assignments and interactions as
two parallel lists with two to-do counts, so a `choice` lesson looks like two mandatory
assignments. Also resolves a tension in the original framing — *"only the first submission is
graded"* holds only after the interaction path is taken or after the deadline; before then, a
report **replaces** a written submission.

### Added — `ZZ Test Cadet` (3009999999) smoke-test roster row

Added one student row to exercise the student view: `student_id 3009999999`, section `M1A`
(phys-215), `auth_user_id` NULL pending provisioning. The ID sits at the **top of the**
`students_student_id_check` **range** (3000000000–3009999999), well clear of the current roster
block (3000990000–3000990071), so it is easy to spot and delete. Its last 6 digits (`999999`) are
its default password, per the provisioning convention.

**Why this ID shape:** a `99…`/`X…` prefix was requested to mark the row as non-real, but the
database forbids it — `student_id` is a `bigint` with a CHECK pinning it to 3000000000–3009999999.
Marking test rows by ID prefix would require a migration; the `ZZ` name prefix does that job instead.

**Note for whoever provisions next:** student logins do not exist yet — all 73 rows have
`auth_user_id IS NULL`, so *every* cadet login currently fails with "Incorrect ID/email or
password". Roster tab → **Provision Accounts** creates them (`email_confirm: true`).

### Changed — retired the artifact-submit endpoint; contract URLs now survive the app promotion

**Breaking, deliberate, and done in the gap before Fall 2026.** The submission endpoint moved and
the old one was **retired without a redirect**. This was safe only because there were three live
artifacts and three weeks; all were rebuilt against the new URL. Do not attempt this mid-semester —
a stale artifact now fails *silently* (the student finishes the lesson, clicks Submit, and the
report is discarded).

**New contract URLs** (both frozen — see `docs/contracts/`):

| Purpose | URL |
|---|---|
| Student report submission | `…/Core_Preflights/site/student/interaction-submit.html` |
| AI-generated lesson prefill links | `…/Core_Preflights/site/faculty/lessons.html` |

**Why these paths.** Each is a stub that forwards into `site/app/…` today. At promotion the app
tree moves up and the real page lands on *exactly* that path, overwriting the stub — so the
forwarding deletes itself and **no URL changes at go-live**. The stub paths therefore mirror the
app's own `student/` / `faculty/` naming exactly; `students/` (plural) would break the endpoint at
the moment it is supposed to keep working. Don't rename or move them.

**Receiver rewritten** as `site/app/student/interaction-submit.html`, now a normal portal page:
shared `auth.js` / `nav.js` / `theme.js`, the app stylesheet, and `.md-render` for the report. The
old page hardcoded light-mode colors (`#f5f8ff`, `#cbd5e1`) and shipped its own login screen, so it
never matched the site and broke in dark mode. The transport contract (`#t=`/`#i=`/`#r=`/`#d=`,
`schema: 1`) is **unchanged** — only the URL and the chrome moved.

**One non-obvious fix.** The old page's private login screen was load-bearing: the report lives
entirely in the URL hash, and `auth.js` redirects to login with `pathname + search` only — no hash.
Naively adopting the shared login would have destroyed every report from a signed-out student (the
common case, arriving from claude.ai). The new page stashes the payload in `sessionStorage` before
any module can navigate, then restores it on return. Verified in headless Chrome: with a real
LZString payload, the stub forwards → `bootstrap` redirects to `login.html` → the payload survives
and still decodes (`effort: 4`, markdown intact).

**Retired** (now 404): `artifact-submit.html` and `interaction-submit.html`, at both the repo root
and under `site/`. Source kept for reference in `_archive/artifact-receiver-v1/` — that directory
starts with `_` so Jekyll (GitHub Pages' default build, which this repo uses) leaves it out of the
published site while it stays in the repo. Root now holds only `index.html` and `404.html`, which
Pages requires.

### Fixed — three documentation defects found while tracing the endpoints

- **`PROJECT.md` named the wrong receiver.** The Key Files table still pointed at
  `interaction-submit.html` — stale since the `artifact-submit.html` rename, and the July reorg
  copied the error forward with a `site/` prefix. It contradicted the prose in the same file.
- **`INTERACTION-PREFILL-LINK.md` documented an `obj` parameter that does not exist.**
  `lessons.html` reads exactly 14 query keys and `obj` is not among them, so an artifact sending
  lesson objectives had them silently dropped. Removed from the contract; objectives are set by
  hand after Save. (Wiring `obj` through is a reasonable follow-up — not done here.)
- **The prefill doc described two competing bases.** Consolidated onto `lessons.html` (the sole
  target now that all artifacts are rebuilt); the `interactions-admin.html` and
  `app/faculty/interactions.html` bases are retired from the contract.

The paused **Custom GPT** integration under `.ai/integrations/custom-gpt/` was left untouched: it
is archived pending possible future work, its migrations (`017`/`018`) are parked outside the live
sequence, and its `lessons.html#lp=` links predate this change. **Reconcile its URLs before
reviving it** — and note its contract claims `lessons.html` "restores the payload across login",
which the page has never implemented.

---

## 2026-07-15 — Matthew Recker via Claude

### Changed — interactions get M/T due dates; lesson syncs one deadline across components

**Migration `020_interaction_mt_due_dates.sql`** replaces the single `interactions.due_date`
(migration 015) with `due_date_m` / `due_date_t` (backfilled from the old value, then dropped) so an
interaction carries the same M-day/T-day shape as assignments and lessons. **Applied to the live DB.**

The lesson creator now **reconciles due dates when combining sources**: if only one attached
component has dates, the lesson adopts them; if **both** do, a small dialog asks which set to use;
opening an already-combined lesson that still lacks dates runs the same resolution. On save, the
chosen dates are **synced onto every component** — the lesson, its preflight assignment
(`due_date_m/t` + the legacy NOT-NULL `due_date`), and its interaction (`due_date_m/t`) — so they
always share one deadline. Updated all `interactions.due_date` readers/writers to M/T: the faculty
dashboard spotlight ([`faculty-data.js`](site/app/js/faculty-data.js), a minimal swap to
`due_date_m || due_date_t`) and the standalone interactions tool
([`faculty-interactions.js`](site/app/js/faculty-interactions.js) +
[`interactions.html`](site/app/faculty/interactions.html), whose single date field now sets both M
and T until that tool is retired in favour of the lesson creator).

### Changed — design sandboxes (`tests/browser/`) are director-gated + load via `index.html`

Added `tests/browser/guard.js`, a client-side gate included by every sandbox page: anonymous users
are redirected to the app login, signed-in non-directors get an "access denied" message, and the
page is hidden until the check passes (no content flash). Renamed the sandbox menu to
`index.html` (so the directory loads without typing a filename); `test.html` now redirects to it.

### Added — drag-and-drop lesson composer + orphan content on the Lessons page

The faculty **Lessons** page ([`site/app/faculty/lessons.html`](site/app/faculty/lessons.html) +
[`site/app/js/faculty-lessons.js`](site/app/js/faculty-lessons.js)) now surfaces **unassigned
("orphan") content** — assignments/interactions not yet owned by any lesson — as draggable thumbnail
cards at the top (directors only, shown only when orphans exist). Drag a preflight and/or an
interaction into the two drop boxes (or click a card), then **Create lesson** opens the editor
prefilled with those references, a suggested slug/number/title, and the matching allowed mode. Uses
native HTML5 drag-and-drop (no library); `loadManager` already annotates each row's `ownedBy`, so
orphans are just the un-owned rows.

### Changed — lesson-creator polish (figures, interaction editing, RAG labels)

Follow-up refinements to the lesson creator:
- **Figures:** the drop zone was restyled (clear empty/hover/drag/uploading states, larger preview)
  and gained a **remove (×)** control over an uploaded image; the URL field is now the "or paste a
  link" fallback.
- **Editable interaction:** attaching an existing interaction now loads its title / URL / description
  into editable fields and writes edits back to that same interaction on save (its id — the artifact
  `#i=` slug — stays fixed), matching the editable-preflight behavior. `getInteraction` added.
- **RAG dropdown labels:** the Reference-PDF dropdown now shows just the base filename (no directory,
  no `.pdf`) while still storing the full path the grader resolves.

### Changed — attached existing preflights are now editable in the lesson creator

Pulling an existing/orphan assignment into a lesson (via the "Use existing" picker or the composer)
now **loads its questions into the editable builder** instead of referencing it read-only; saving
writes the revised `questions` + reference fields back onto that same assignment with a plain
`UPDATE` that preserves its title, publish state, and due dates (`getAssignment` fetches the full
editable row). This is a step toward making the lesson creator the single preflight-authoring
surface — the legacy `admin.html` Assignments authoring path is intended to be retired next (kept for
now because that page also hosts grading/roster/sections).

### Added — drag-and-drop figure uploads via Supabase Storage

Each question's figure field is now a **drop zone**: drag an image (or "choose file") and it uploads
to a new public `lesson-figures` Storage bucket, storing the returned public URL in
`figure_url` (`uploadFigure` in [`faculty-lessons.js`](site/app/js/faculty-lessons.js); ≤5 MB,
image MIME types). This is how a static GitHub Pages site accepts uploads — **GitHub cannot** receive
browser file writes, so the image goes to Supabase, not the repo. Pasting an external image URL still
works. Requires applying **`supabase/migrations/019_lesson_figures_storage.sql`** (creates the bucket
+ faculty-upload / public-read RLS) with the service role / Supabase dashboard — the scoped DB role
can't touch the `storage` schema. Until it's applied, uploads fail with a clear "bucket missing"
message and the URL field still works.

### Added — "Preview (student view)" for a lesson's questions

The lesson editor gained a **Preview (student view)** button that renders the free-response
questions exactly as a student sees them — read-only inputs by type (textarea / number / radio
options), the reading-time note, and any question figures — for either an inline-authored preflight
or a referenced existing one (`getAssignmentQuestions` fetches the latter). It never renders the AI
Interaction, per request. Fully static (no backend).

### Changed — lesson delete is now container-safe with a guarded "all contents" path

Delete (director-only) opens a 3-way dialog instead of a blind `confirm()`:
**Delete container only** (default) removes just the `lessons` row so the preflight and interaction
survive as reusable orphans (cascades only `lesson_chat_inputs` + `lesson_completions`); **Delete all
contents** also deletes the attached assignment and interaction — which CASCADEs their `responses`,
`scores`, `preflight_interaction_reports`, `interaction_analysis` — and therefore requires a
deliberate **5-second mouse hold** with a progress fill. The dialog fetches and states the exact
counts of student work that would be destroyed. New data-layer helpers `countLessonWork` and
`deleteLessonAndContents` (the plain `deleteLesson` stays container-only).

### Added — approved-RAG-file manifest + reference dropdown

New committed manifest [`textbook-pdfs/rag-manifest.txt`](textbook-pdfs/rag-manifest.txt) (seeded
from the 29 distinct live `reference_pdf` values) lists the approved textbook references. The PDFs
stay gitignored (`textbook-pdfs/**/*.pdf`); the manifest is committed so the reference **names match
across every operator's local repo**. The lesson creator's **Reference PDF** field is now a dropdown
fed by the manifest (fetched at runtime) with an **"+ Add new…"** free-text fallback. Documented the
manifest as the source of truth for valid `reference_pdf` values in
[`.ai/skills/preflight-analyze/SKILL.md`](.ai/skills/preflight-analyze/SKILL.md) §Step 3 and
[`textbook-pdfs/README.md`](textbook-pdfs/README.md).

### Changed — lesson modal: removed Objectives, added preflight reference/reading inputs

Removed the **Objectives** section and the per-question objective dropdown from the lesson editor —
nothing consumed `lessons.objectives` (the by-objective rollup is still unbuilt), and it added noise;
the DB column is left untouched (defaults to `[]`). In its place the inline "Create new" preflight
now captures the fields that actually matter for grading and students: **reference PDF** (the manifest
dropdown), **reference pages**, and a **reading link** — threaded through `saveLesson` into the
`assignments` row (`loadManager` now also selects them for edit repopulation). Interaction URL
placeholder updated to reflect that live interactions are ChatGPT Custom GPTs, not only claude.ai
artifacts.

### Changed — renamed the platform brand from **iPREP** to **PREP**

The user-facing platform brand is now **PREP** (*Pre-lesson Readiness Engagement Platform* — the
acronym drops the leading "interactive"). Going forward, **iPREP** (*interactive PREP*) is reserved
specifically for the **interactive lesson-interaction component** (the Claude-artifact lessons); the
rest of the site is **PREP**. This does **not** touch the repo, GitHub Pages path, or export
filenames, which stay `Core_Preflights`.

Replaced the `iPREP` brand token with `PREP` across 36 files (64 occurrences) — site header logos,
page `<title>`s, the `app/` portal nav wordmark + footer ([`app/js/nav.js`](site/app/js/nav.js)),
login heading/subtitle, README/docs headings, the design system ([`app/DESIGN.md`](site/app/DESIGN.md)),
the browser test sandboxes, and the contract docs (`CORE.md`, `PROJECT.md`, `AGENTS.md`, `.ai/README.md`).
Collapsed the acronym *interactive Pre-lesson Readiness Engagement Platform* → *Pre-lesson Readiness
Engagement Platform* in the 5 places it spelled out in full. Also renamed the **not-yet-executed**
config-neutralization proposal `$IPREP_CONFIG` / `~/.config/iprep/` → `$PREP_CONFIG` / `~/.config/prep/`
in `CORE.md` §3 and `AGENTS.md` for brand consistency (nothing depends on it yet).

Recorded the naming convention (PREP = platform, iPREP = interactive component) in `CORE.md` §1 and
`PROJECT.md` so future agents don't re-purge the retained `iPREP` term. Prior CHANGELOG history — the
original "rebranded the platform to **iPREP**" entry and the `$IPREP_CONFIG` decision note — is left
intact as a historical record.

### Added — combine existing preflights + interactions into lessons (faculty tool)

Extended the faculty **Lessons** tool (`site/app/faculty/lessons.html` +
`site/app/js/faculty-lessons.js`) so a lesson can be **assembled from content that already
exists**, not only authored new. Each component (Free-Response preflight, AI interaction) now has a
`None · Use existing · Create new` source toggle:

- **Use existing** — a dropdown of the course's real `assignments` / `interactions` (loaded by
  `loadManager`, annotated with which lesson already owns each so nothing is double-attached). The
  lesson *references* the chosen row by id; its content and publish state are left untouched. This
  is how the pre-built Fall preflights (`preflight-01…NN`) and standalone interactions get combined
  into lessons without duplicating them.
- **Create new** — the previous inline builder, unchanged except for the Q1/Q2 defaults below.

A lesson may carry **just a preflight, just an interaction, or both** ("1 or both"). The
`completion_policy` control (which modes students may use) enables only the modes whose component is
attached and mirrors the DB CHECK `lessons_policy_components`; you can attach both components yet
still restrict the allowed mode to one. **No schema migration** — migration `016` already lets
`preflight_id`/`interaction_id` reference any row id.

Ownership rule added: a component is lesson-owned iff its id equals the lesson id. `togglePublish`
now mirrors the lesson's published state **only onto owned (inline-created) components**, so
publishing/unpublishing a lesson can no longer flip the publish flag of a shared standalone
assignment/interaction it merely references.

*Why:* the tool was new-content-only; there was no way to populate `lessons` from the preflight
assignments and interactions that already exist. Partially un-defers LESSON-UNIFICATION §15 Phase 7
(legacy adoption) — existing content can now be referenced into lessons. Student-facing gating
(students seeing only the allowed mode / picking) remains the next phase, unbuilt.

### Changed — inline preflight now seeds Q1 reading-time + Q2 reflection

The inline preflight builder previously pinned a single reading-reflection question as Q1. It now
pins **two** questions matching the live Fall preflights (`scripts/fall2026/build_fall_preflights.py`):
**Q1** a reading-time diagnostic ("How much time did you spend reading…", 0 pts) carrying a
student-facing note that the response is visible to the instructor but the name is not shown (class
diagnostic, per the AGENTS.md Q1 privacy rule), and **Q2** the standard reading reflection (1 pt,
the meaningful-gate that must match the interaction). Both are auto-filled, editable, pinned first,
and non-removable. Only affects newly authored inline preflights; attached existing preflights keep
their own questions. Also marked the lesson **Objectives** section explicitly *optional* in its hint
(nothing consumes it until the by-objective rollup, Phase 6).

## 2026-07-15 — Matthew Recker via Claude

### Changed — extracted a central agent-neutral contract (`CORE.md`); made the root files thin wiring

Completed the consolidation that the `.ai/` reorg had deferred. The authoritative operating rules
that lived in root `AGENTS.md` — which is really Codex's auto-load file — now live in a single
agent-neutral `.ai/instructions/CORE.md` (safety, coordination gate, secrets/config, git/publish,
CHANGELOG conventions, runbook index). The two root entry files are now thin wiring that must not
restate or weaken it:

- **`AGENTS.md` (Codex):** points to `CORE.md` + `PROJECT.md` as authoritative, then inlines a
  labeled mirror of CORE.md §0 (shared-state safety + coordination gate) as a belt-and-suspenders
  floor, since Codex has no `@import` and only the pointer would otherwise carry the safety rules.
  Keeps Codex-only items (the `.codex/` note, the Codex-requested-change standing authorization, the
  Codex quickstart).
- **`CLAUDE.md` (Claude Code):** now `@`-imports `CORE.md` + `PROJECT.md` (was importing `AGENTS.md`),
  plus the Claude-only addendum.

Sorting rule established: **CORE.md holds what's true for every agent; each root entry file holds the
wiring plus only-that-agent items.** Deduped `CORE.md` against `PROJECT.md` — the data-model catalog,
JSONB shapes, roles, and edge functions stay canonical in `PROJECT.md` and CORE links to them;
`PROJECT.md`'s triplicated "no Node/build step" note and its wholesale-duplicated "Important Notes"
section were collapsed to cross-links into CORE. Repointed `PROJECT.md`'s multi-agent note and both
`.ai` READMEs (dropped the "consolidation deferred — don't create a core file" note) at the new
layout. No behavior, schema, or site change — documentation/instruction wiring only.

## 2026-07-15 — Matthew Recker via Claude

### Fixed — post-reorg Claude-facing cleanup for the `.ai/` skill tree

Follow-up to the `.ai/` reorganization below. Fixed a stale reference in `supabase/SETUP.md` Step 7
that pointed at `~/.claude/skills/physics215-analyze/config.json` (dead skill name) with an outdated
JSON schema; it now matches the current `preflight-analyze` path and
`.ai/skills/preflight-analyze/config.json.template` (adds `default_course_id`, `sb_secret_`
placeholder) and the heading is agent-neutral. Added `.ai/skills/setup-preflight/SKILL-claude.md`
so the setup wizard has a Claude Code addendum matching the existing `SKILL-codex.md` (use the Bash
tool cross-platform, never echo the service key, no Node tooling).

Decided but not yet executed: neutralize the `~/.claude/skills/preflight-analyze/config.json` runtime
path to a neutral `$IPREP_CONFIG` (or `~/.config/iprep/config.json`) with fallback to the existing
path, across all scripts/skills/docs — deferred to its own coordinated PR per AGENTS.md §3. Note also
that `supabase/SETUP.md` still contains other pre-reorg paths (e.g. `physics215/js/config.js`) not
touched here.

## 2026-07-15 — Casey Pellizzari via Codex

### Changed — reorganized the repository around `site/`, `.ai/`, and `docs/`

Moved all deployed website source into `site/` while keeping GitHub Pages on the repository root.
Root `index.html` now forwards to `/site/`; root `404.html` recovers old page routes; and the root
`artifact-submit.html` plus `interaction-submit.html` compatibility endpoints preserve query strings
and URL hashes before forwarding to the full receiver under `site/`. Relative site paths remain
unchanged inside the moved tree. Updated the Fall figure builder and extractor for `site/img/`.

Created one agent-neutral AI tree under `.ai/`: shared project context lives in `instructions/`, and
all four canonical workflows now live in `skills/<name>/SKILL.md` with optional vendor addenda.
Removed the duplicated `.agents/skills/` discovery pointers and `.claude/skills/` runbooks. Added root
`CLAUDE.md` as Claude Code's auto-loaded import/bootstrap while root `AGENTS.md` remains the shared
operating authority pending a later instruction-content consolidation.

Moved system documentation into categorized `docs/` folders, the Custom GPT transfer package into
`.ai/integrations/custom-gpt/`, the artifact example into `.ai/artifacts/examples/`, and browser
sandboxes into `tests/browser/`. Updated active source paths, repository links, local-server guidance,
and public `/site/` URLs. This was a filesystem/deployment-source reorganization only: no Supabase
schema or live database data changed.

## 2026-07-15 — Casey Pellizzari via Codex

### Fixed — restored the shared operating brief and removed agent runbook drift

Restored the authoritative root `AGENTS.md` after merge commit `26591e3` resolved two independently
added versions of that file as an empty deletion. The collaborator branch had added Codex discovery
skills under `.agents/skills/`, but their duplicated preflight runbook still prescribed a
Codex-specific config path and generic yellow feedback that conflicted with the current canonical
grading rules.

Kept all four Codex skill entry points, converted them to thin pointers to the canonical
`.claude/skills/` runbooks, and removed the redundant `.agents` config template. This preserves
native Codex discovery while ensuring Claude and Codex use the same tailored-feedback,
per-instructor aggregation, credential, database-safety, and verification rules.

## 2026-07-09 — Casey Pellizzari via Codex

### Fixed — corrected Physics 215 v12 source lesson list

Regenerated `Physics215_Preflight_Questions_v12.docx` after Casey clarified that lesson 3, not
lessons 2 and 6, was part of the modified Q3 set. The corrected v12 now pulls live
webpage/Supabase Q3 wording for lessons 3, 9, 19, 24, 26, 28, and 30. Verification confirmed
lessons 2 and 6 remain unchanged from v11 and still match the live Q3 wording.

### Changed — generated Physics 215 preflight source DOCX v12

Generated `Physics215_Preflight_Questions_v12.docx` beside v11 in the OneDrive `Preflights/`
folder by pulling current live webpage/Supabase Q3 wording into the Word source document. After the
lesson-list correction above, v12 matches live Q3 wording for lessons 3, 9, 19, 24, 26, 28, and
30. The Fall preflight builder and figure extractor now read v12 so future rebuilds preserve the
webpage wording.

### Fixed — restored missing Fall 2026 preflight question figures

Extracted the embedded JiTT figures from `Physics215_Preflight_Questions_v11.docx` into
`img/assignments/` and updated the Fall preflight builder to attach deterministic public
`figure_url` values to Q3. The affected assignments are `preflight-03`, `preflight-04`,
`preflight-24`, and `preflight-28` (the displacement-current capacitor figure Casey noticed).
Added `scripts/fall2026/extract_preflight_figures.py` so future DOCX refreshes can regenerate the
assets. Patched the live Supabase `assignments.questions` JSON for those four rows and read-back
verified each stored Q3 figure URL.

### Changed — Grade and Report views keep zero-point Q1 private

Updated the written-preflight grading/report UI so zero-point questions such as Q1 no longer appear
on each student's Grade-tab card; instructors now review only the scored questions there. In the
Report tab, Q1 raw responses still appear for class-level review, but the **Show names** control is
removed for Q1 and copy logic keeps those responses anonymous. Other questions keep the
Show names toggle. Updated the webpage help text, `SYSTEM_GUIDE.md`, and `AGENTS.md` to preserve
the privacy rule across future agent work.

### Changed — lab preflights now ask about lab instructions

Updated the Fall 2026 Physics 215 preflight builder and the live Supabase `assignments` rows for
the six lab lessons (`preflight-06`, `preflight-11`, `preflight-17`, `preflight-27`, `preflight-34`,
`preflight-38`) so Q1 asks how much time students spent reading the lab instructions and Q2 asks
what they found confusing or interesting about the lab instructions. Regular lesson preflights keep
the original book/reading wording. The live DB patch read-back verified all six lab rows and sampled
regular preflights to confirm they were unchanged.

### Changed — clarified Course Director preflight-analysis instructions

Updated the webpage System Guide in `admin.html` and the fuller `SYSTEM_GUIDE.md` so Course
Directors know how to initiate grading with either Claude Code or Codex. The guide now describes
the coordination checklist, the current `/preflight-analyze preflight-02 M|T` command shape, the
Codex plain-language equivalent, the local `~/.claude/skills/preflight-analyze/config.json` path,
and the distinction between unfinalized AI suggestions and human finalization in the Grade tab.
Also refreshed related instructor/director/admin help text, removed Claude-only wording from the
web guide, corrected the stale Node wording in `app/README.md`, and aligned the setup/training
runbooks with the current config and command conventions.

### Changed — Codex-requested changes now carry standing publish authorization

Recorded Casey's standing instruction in `AGENTS.md`: when Casey asks Codex to make changes, Codex
should update durable memory, update `CHANGELOG.md`, commit, and push `main` after verification
unless Casey explicitly opts out. Read-only exploration/questions still do not trigger a commit or push.

### Changed — clarified instructor summaries and student account provisioning

Updated the System Guide and faculty roster wording to make two operating details explicit:
`preflight-analyze` Class Summary & Misconceptions are aggregated per instructor across all of that
instructor's sections, and provisioned student accounts use `studentID@usafa.edu` with the default
password set to the last 6 digits of the student's ID number.

## 2026-07-08 — Casey Pellizzari via Codex

### Changed — successful preflight-analysis runs now publish their audit record

Added standing authorization to `AGENTS.md`: after a successful live `preflight-analyze` run and
exact read-back verification, the agent updates the CHANGELOG, commits the run record, and pushes
`main` unless the human explicitly opts out. The shared-state coordination gate still applies.

### Data — reran `preflight-02` with tailored feedback and specific summaries

Re-ran all four training sections after pulling the consolidated `preflight-analyze` runbook.
Replaced the 64 unfinalized suggestions and the per-instructor `analysis_report`, then read-back
verified every stored score and report field. All 20 Q3 `warn` responses now have distinct,
2-sentence corrections tied to the student's actual reasoning; the instructor summaries now name
each misconception type with a count and representative quote. The grading distribution remains
42 `full`, 20 `warn`, and 2 blank `zero`; no grades were finalized or published.

### Data — graded the `preflight-02` training submissions

Ran the shared `preflight-analyze` procedure against all four Physics 215 training sections after
grounding the review in the assigned textbook pages. Wrote and read-back verified **64 suggested
score rows**, all with `is_finalized=false`, plus the per-instructor `assignments.analysis_report`.
Of 72 rostered training students, 64 submitted and 8 were missing. Q3 produced 42 `full`, 20 `warn`
(full credit with corrective feedback), and 2 `zero` blank responses; Q1 and Q2 received full credit
under the liberal engagement rubric. No grades were finalized or published to students.

### Fixed — Codex quickstart environment wording

Corrected the `AGENTS.md` quickstart so it no longer says Node is absent. It now matches the
authoritative environment rule: the project has no Node dependency or build step, even when Node
is installed on an operator's machine.

---

## 2026-07-08 — Casey Pellizzari via Claude

### Changed — `preflight-analyze` summaries are explicitly per-instructor, never per-section

Clarified the runbook so the stored `analysis_report` summary and misconception counts pool all of an
instructor's sections into one combined set (they already keyed by instructor, but the skill description
still said "per-section" and Step 8 didn't forbid section-level breakouts). Fixed the description wording
and added an explicit "aggregate per instructor, never per section" rule to Step 8.

### Fixed — resolved `preflight-analyze` SKILL.md drift between agents

The committed repo runbook (`.claude/skills/preflight-analyze/SKILL.md`) had drifted behind the copy
Claude runs from `~/.claude/skills/`. The repo version — the only one Codex can read — still
*prescribed* a single generic corrective-feedback template and thinner grading guidance, which is why
the Codex `preflight-02` run pasted the same feedback string onto all 20 `warn` answers instead of
tailoring each. Consolidated both copies to one canonical file: the newer three-state grading rubric
with **per-student tailored corrective feedback** (generic template now explicitly banned), while
preserving the repo-only "Course Director/System Admin" role note and "per-instructor report" wording.
Both copies are now byte-identical. Durable fix (symlink repo↔global, or repo-as-source-of-truth) is a
follow-up.

### Added — shared multi-agent operating guide (`AGENTS.md`)

Development is now done jointly by different people running **different AI agents** (Claude Code today,
**Codex being introduced**) against **one shared live Supabase DB and one live GitHub Pages site**. The
real risk is drift and uncoordinated changes to that shared state, so we added a single agent-neutral
source of truth.

- **New root [`AGENTS.md`](AGENTS.md)** — authoritative operating rules for every agent and human:
  shared-state hazards, a **coordination gate** (one operator; no competing run; `git fetch`/verify no
  divergence; separate worktrees for concurrent work; never force-push), environment, secrets/config
  locations, runbooks (skills are readable procedures), git/publish/CHANGELOG rules, data-model quick
  reference, and a Codex quickstart.
- **[`.claude/CLAUDE.md`](.ai/instructions/PROJECT.md)** now defers to `AGENTS.md` for shared rules (pointer at
  top) and keeps its Claude-specific deep context.
- **Corrected a stale environment claim** in both files: the old "no Node, cannot be installed" was
  wrong (Node/npm are present). Reframed to the accurate rule — *the project has no Node dependency or
  build step; don't introduce one; verify the frontend in a browser.*

Decisions (reviewed with **Codex**): keep `CHANGELOG.md` as the shared history; skills' `SKILL.md` stay
readable runbooks any agent can follow; **no `.codex/` documentation mirror** (a `.codex/config.toml`
for settings is fine later if needed); config-path generalization and the broader private-memory→repo
migration are **deferred** (the high-stakes memory is already captured in `AGENTS.md`).

---

## 2026-07-07 — Casey Pellizzari via Claude

### Changed — Physics 215 reset from proof-of-concept to Fall 2026

Cleared the phys-215 proof-of-concept data and stood up the real Fall 2026 preflights. Scripts
live in `scripts/fall2026/`.

- **Snapshotted the POC first** (`export_poc_snapshot.py`) — a full, restorable JSON archive in
  `scripts/fall2026/poc-archive/`: all 4 interactions, every interaction report (the 8 hand-crafted
  lesson-02 + 2 lesson-03 reports + 206 synthetic demo rows), the 206 fake students / 10 sections,
  and the 3 test preflights' responses/scores. `MANIFEST.json` records counts + timestamp.
- **Created 37 Fall preflights** (`build_fall_preflights.py`) as written `assignments`
  (`preflight-02`…`preflight-41`, `course_id='phys-215'`, published). Scope = the 31 regular PF=Y
  lessons + the 6 labs; excludes Lesson 1 and the 3 GRs. Each mirrors the original 3-question
  structure (reading-time 0.1 + confusing/interesting 0.9 + JiTT concept w/ `expected_response`
  1.0 = 2 pts). Questions parsed from `Preflights/Physics215_Preflight_Questions_v11.docx`; M/T due
  dates computed as 2359 America/Denver the night before each lesson from the Fall 2026 syllabus
  (DST-aware); RAG refs point at `Text_Book_PDFs/215 Sections/`. Idempotent (upsert on `id`).
- **Cleaned the POC** (`clean_poc.py`, gated on the snapshot matching live counts) — deleted the fake
  students/sections/submissions, the 3 test preflights, and the `demo-rollup-sandbox` interaction.
  **Kept** the `lesson-02/03/04` artifacts (reusable Fall content) and all real accounts.

**Deferred (with Matthew Recker):** a durable multi-term/semester model. The frozen artifact contract
is safe under it (additive columns only; artifacts key by stable slug), and `term_id` belongs in the
`lessons` layer + roster; the one invasive piece is making `sections.id` per-term (global PK, CHECK
`^[MT][135][A-D]$`). Not started — revisit after Fall is live. Real Fall roster load is the next step.

### Added — student preview for assignments (`admin.html`)

Each assignment card in the **Assignments** tab now has a **Preview** button
([`admin.html`](site/admin.html), `previewAssignment`) that renders the assignment in a modal exactly as a
student sees it — figure, title, due dates, description, and every question (MC / numerical / free-response)
with read-only, disabled inputs. Lets directors eyeball the final student-facing form before publishing.
Reading links are intentionally left **blank** on all Fall preflights: the per-lesson OpenStax PDFs are
RAG-only grading references (`reference_pdf`/`reference_pages`), not student reading assignments, so the
student view shows no reading link.

### Changed — preflight point split is now 0 / 1 / 1 (still 2 pts)

All 37 Fall preflights: Q1 (reading time) → **0 pts**, Q2 (confusing/interesting) → **1 pt**,
Q3 (JiTT concept) → **1 pt**. Total unchanged at 2. Applied to the live `assignments` rows and to
the generator [`scripts/fall2026/build_fall_preflights.py`](scripts/fall2026/build_fall_preflights.py)
so re-runs stay consistent.

### Added — instructor-training dataset for preflight-02

[`scripts/training/seed_training_preflight02.py`](scripts/training/seed_training_preflight02.py) seeds a
small, disposable training roster so instructors can practice the admin + grading workflow before the real
Fall roster loads: 4 sections (M1A/T1A = Casey, M3A/T3A = Tyler Jones), ~72 fake students in the dedicated
id block `3000990000–3000990071`, and 64 `preflight-02` submissions (8 intentionally missing) with a
realistic Q3 spread (correct / vague-but-credited / misconception). Raw submissions only — no scores.
Idempotent; `--clean --commit` removes exactly this data. **Delete when the real roster is uploaded.**

### Note — folder rename + config path

The working folder was renamed `Physics_215_Fall_2026` → `PREP`. The only path that hardcodes it is the
skill config `~/.claude/skills/preflight-analyze/config.json` (`textbook_base_path`, gitignored) — updated
to `…/USAFA Classes/PREP/`. If the folder is renamed again, that line must be updated or `/preflight-analyze`
loses its textbook RAG grounding.

---

## 2026-06-26 — Matthew Recker

### Fixed — theme toggle icon now reflects the current theme, not the destination

The light/dark toggle ([`app/js/theme.js`](site/app/js/theme.js), `updateToggleButtons`) showed the icon of the
theme it would switch *to* (sun while in dark mode, moon while in light) — Matthew read this backwards and
expected the icon to indicate the *current* state. Flipped the icon mapping so it now shows the **active**
theme (moon in dark mode, sun in light). The `aria-label`/`title` are unchanged — they still describe the
action the click performs ("Switch to light/dark mode"), which is the convention for a toggle button.

### Changed — per-objective understanding histogram now uses an adaptive KDE (`lrFine5`)

The lesson rollup's "Objective understanding" chart ([`app/faculty/report.html`](site/app/faculty/report.html),
`lrFine5`) previously drew its 25-cell curve by **linearly interpolating** between the 6 integer
score-bins. That smeared a single data point into a lopsided triangle spanning ±1 score and lit up
more columns than there were distinct scores — Matthew noticed both a phantom spread on a 1-point
objective and "more raised columns than there should be."

Replaced the interpolation with an **adaptive (variable-bandwidth) kernel density estimate** —
Abramson's square-root law: each occupied bin contributes one unit-area Gaussian per student,
centered on its integer score, with bandwidth `h ∝ 1/√(count)`. Sparse bins (1–2 students) render
a soft, *symmetric* bump (honest uncertainty); well-populated bins stay tall and sharp; area per
student is conserved. Tuned to `H0 = 0.49, HMIN = 0.30, HMAX = 0.45` (visual only). **Purely a
rendering change** — input is still the integer histogram from `summarizeReports`, so no
data-contract, skill, or `int05` changes, and the AI keeps emitting integer 0–5 understanding
scores (no false precision).

Also added a **director-only floating "Histogram smoothing · KDE" tuner** on the report page:
three live sliders (`H0/HMIN/HMAX`) that re-render the objective histograms instantly and a "Copy"
button for the resulting const line. Gated via `ctx.isDirectorForCurrent()` (directors + global
admins only; hidden from instructors). The `KDE` object holds the live defaults, so baking in a new
value is a one-line edit. Self-contained for easy later removal.

### Added — faculty lesson generation tool + migration 016 (`lessons` foundation)

Built **Phase 1 + Phase 4** of [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md): the schema that
groups a written preflight and a Claude interaction under one **lesson**, and the faculty tool that
authors them.

- **Migration [`supabase/migrations/016_lessons.sql`](supabase/migrations/016_lessons.sql)** —
  purely additive (mirrors 012/014). Creates `lessons` (slug, course, `completion_policy`
  ∈ {preflight, interaction, choice}, shared `objectives[]`, M/T due dates, `preflight_id →
  assignments`, `interaction_id → interactions`, the policy↔components CHECK) and
  `lesson_completions` (the unified 2-point grade, `UNIQUE(student, lesson)`). Includes the
  grade trigger (`lc_score_from_effort`, points-from-effort, reusing the migration-013 curve) and
  the path-lock trigger (`lc_lock_path`, path immutable once set), plus RLS that mirrors
  `interactions` (lessons) and `preflight_interaction_reports` (completions). **Deliberately defers**
  the row-*creating* finalize triggers and the D8/D9 due-cutoff/Submit guards to Phase 2.
- **[`app/faculty/lessons.html`](site/app/faculty/lessons.html)** + **[`app/js/faculty-lessons.js`](site/app/js/faculty-lessons.js)**
  — a new director-gated **Lessons** page (added to `FACULTY_LINKS` in
  [`app/js/nav.js`](site/app/js/nav.js)). One screen lists lessons and, in the New/Edit modal, **authors
  both component types inline**: a completion-policy segmented control that shows/requires the right
  components, a shared objectives editor, a ported preflight question builder (free-response /
  numerical / multiple-choice, each mapped to an objective and one marked the
  `role:"reading_reflection"` question), and the interaction fields (slug that must match the
  artifact's `#i=`, URL, title, description). Save orchestrates the writes — upsert the underlying
  `assignments` and/or `interactions` rows, then the `lessons` row that points at them; publish
  cascades to the components; delete removes only the lesson grouping (component rows and student
  work are kept). Client validation mirrors the DB policy↔components CHECK and the
  exactly-one-reading-reflection rule. New `.lb-*` builder classes added to
  [`app/css/styles.css`](site/app/css/styles.css) (tokens only, both themes).

*Why:* the lesson model was approved (`LESSON-UNIFICATION.md`, decisions D1–D9) but had no table and
no authoring surface; this lands the foundation and the director-facing creation tool so real lessons
can be built. **Scope:** authoring only — the student lesson view, the Save/Submit lifecycle, the
completion-creating triggers, the `/preflight-analyze` `report_data` extension, and the merged rollup
remain Phases 2/5/6 follow-ups. Verify in a browser against Supabase (no Node), per the project workflow.

### Refined — lesson tool: reflection auto-seed, clearer labels, artifact prefill, alignment fix

Follow-up polish to the lesson creation modal from Matthew's review:

- **Reading reflection is now a fixed, auto-filled Q1.** Selecting a free-response component seeds the
  pinned first question with the standard prompt *"What did you find interesting or difficult in the
  reading?"* (editable, not removable) plus AI guidance telling the grader to judge whether the
  reflection is *meaningful* — "need not be long, just meaningful" — which is the effort gate. Replaces
  the old "mark one question as the reading reflection" checkbox, so every lesson's reflection is
  identical across both paths by construction (`LESSON-UNIFICATION.md` §11).
- **Relabeled the two modalities as the director thinks of them:** the completion-policy control now
  reads **Free-Response** vs **AI Interaction** vs **Choice** (both are "preflights"); section headers
  and card badges match. DB enum (`preflight|interaction|choice`) is unchanged — purely presentational.
- **Lesson id ↔ interaction id default to the same slug** (auto-mirrored while the director hasn't typed
  an interaction id, still editable) — one slug to coordinate with the artifact's `#i=` instead of two.
- **Artifact prefill link.** `app/faculty/lessons.html` now accepts a query string
  (`?new=1&id=&course=&title=&desc=&policy=&url=&obj=key:Label|…&pub=`) so a Claude artifact can hand the
  director a one-click link that opens the New-Lesson form prefilled (interaction + objectives + meta),
  mirroring the existing interaction-manager prefill — documented in
  [`INTERACTION-PREFILL-LINK.md`](docs/contracts/INTERACTION-PREFILL-LINK.md).
- **Form alignment fix:** a `.field` with helper text sat taller than its neighbours and the default
  `.row` centring nudged its input up; editor rows now top-align so inputs line up regardless of hints
  (`#lesson-modal .row { align-items: flex-start }`).

## 2026-06-25 — Matthew Recker

### Added — design doc: rollup agreement (one faculty rollup across both modalities)

Authored [`ROLLUP-AGREEMENT.md`](docs/decisions/ROLLUP-AGREEMENT.md) — the **output contract** for the faculty lesson
rollup, the companion to the per-student *input* contract (`INTERACTION-DATA-CONTRACT.md`). Fixes the
canonical panel set, the shape/length/style of every AI-written field, and which skill owns which field
for which lesson type, so `/preflight-analyze` and `/interaction-aggregate` produce **one** rollup, not
two dialects. Core rule: one rollup, one style, with the **breakdown axis — by objective
(interaction/choice) vs. by question (preflight-only) — as the single permitted divergence**. Documents
the two layers (live numbers via `summarizeReports` vs. the stored AI prose layer), the section +
`'__all__'` scope model, field limits (mirroring `interaction_analysis`), grounding/style rules, and a
proposed convergence of today's two stores (`interaction_analysis` + `assignments.analysis_report`)
into one `lesson_analysis` table. *Why:* a single reference so edits to one skill stay consistent with
the other — the doc to open before touching either rollup skill or the UI.

### Added — faculty lesson rollup now reads the cohort AI analysis (interaction_analysis)

Wired the AI panels in [`app/faculty/report.html`](site/app/faculty/report.html) to the
`interaction_analysis` table (migration 014) the `/interaction-aggregate` skill now populates,
replacing the "coming soon" placeholders with real content where a row exists. New
`loadAnalysis(interactionId)` in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)
pulls every scope row for the lesson in one query (RLS scopes the result); the rollup picks the
row for the current scope — the `__all__` whole-course row for "All sections", else the section's
row. Three panels light up: **AI readiness summary** and **Misconceptions → trends across the
class** render the stored Markdown-light prose (sanitized at render via `.ai-prose`), each with a
"AI generated <date>" note and a quiet "may be out of date" hint when the scope's report count has
moved since (`meta.n`). The **Student responses** panel is now single-section only: it prepends the
aggregator's per-section "AI pick" showcase quotes (`selected_quotes`, resolved to live reflection
text + name from the already-loaded `report_data` + roster) ahead of the random sample; the
"All sections" view shows no quote panel. Everything degrades gracefully — no row (incl. an
instructor's "All sections", which RLS never lets read `__all__`) → today's placeholders + random
sample. *Why:* the aggregator and its store now exist and the table is populated (18 rows across
the demo sandbox + lesson-02/03), so the rollup should show the synthesis instead of stubs — the
deferred "UI wiring" task the skill and `INTERACTION-AGGREGATION.md` §7 call out.

### Operations — first cohort aggregation run (+ backfill) across all interactions with submissions

Ran the new `/interaction-aggregate` skill for the first time over every interaction that has reports,
writing the per-section and whole-course (`__all__`) AI panels — readiness summary, misconception trends,
and showcase quotes — into the `interaction_analysis` table (migration 014): **demo-rollup-sandbox**
(10 sections + course, 206 reports), **lesson-02** (M1A, M5A, course), and **lesson-03** (M1A, M5A, course).
First reconstructed the two reports that were missing structured `report_data` via `/interaction-backfill`
(both Noel Garcia — lesson-02 and lesson-03; the lesson-03 effort clamped to 2 / score 1 for a
non-meaningful reflection, with the disclosed Copilot use recorded as `honor: disclosed`). All 18 analysis
rows verify non-`STALE`. *Why:* populate the rollup's AI layer for the demo sandbox and the two live
lessons so the panels are no longer placeholder-only. lesson-04 has no submissions and was skipped.

### Documented — interaction-aggregate scaling / scheduled-job guidance

Added a "Running at scale / as a scheduled job" section to
[`.claude/skills/interaction-aggregate/SKILL.md`](.ai/skills/interaction-aggregate/SKILL.md): the skill
is slated to run as a **midnight cron** after a lesson's due date, scoped to one course and **one day track
at a time** (M-run or T-run, never both). Guidance: process sections **sequentially, one scope per step —
do not fan out subagents** (the `pull` output is per-section, so a loop bounds context and scales to 20+
sections; parallelism only buys wall-clock speed a cron doesn't need); the `__all__` row is recomputed over
live rows, so on split M/T due dates the earlier run's `__all__` is day-only until the later run overwrites
it with the full course (same point-in-time merge as `assignments.analysis_report`); and `status`'s `STALE`
flag is the post-cron health check. *Why:* the manual fan-in flow I used for the 206-report demo is the
wrong default for the unattended cron — captured the lesson where it lives.

### Fixed — lesson rollup radar chart clipped with more than 3 objectives

The "Objective understanding" radar on [`app/faculty/report.html`](site/app/faculty/report.html) used a fixed
SVG `viewBox` (`0 30 300 190`) that had been tuned for a 3-point triangle (wide and short). Once a lesson
had 4+ assessed objectives the polygon filled out symmetrically and the bottom/side axis labels fell
outside that box and were cropped. `radarSVG` now computes the `viewBox` (and `width`/`height`) from the
actual extent of the label ring plus a small glyph margin, so the chart fits any objective count. Same fix
mirrored into the [`test/test-summary.html`](tests/browser/test-summary.html) preview fixture. *Why:* lessons can
define any number of objectives; the chart must size to the data, not a hard-coded count.

### Added — design doc: unify preflight assignments and lesson interactions under a "lesson"

Authored [`LESSON-UNIFICATION.md`](docs/architecture/LESSON-UNIFICATION.md) — the **proposed** (not yet built) plan to
join the two parallel worlds (`assignments`/`responses`/`scores` and
`interactions`/`preflight_interaction_reports`) under a single **lesson** that can carry a preflight,
an interaction, or both. Captures the planning decisions: track set per lesson
(`preflight`/`interaction`/`choice`) to force exposure to each modality then open choice for research;
lesson worth 2 points effort-gated on either path (correctness/understanding become diagnostic); a new
`lesson_completions` table as the unified grade record with a **first-committed-path-wins lock**; both
paths emit the frozen `schema: 1` `report_data` keyed to a shared per-lesson objective taxonomy so
choice lessons roll up by objective with a modality breakdown (assignment-only stays by-question). The
artifact↔site data contract stays **frozen** (completion rows created by DB trigger on report write).
Includes a migration-016 schema sketch, a `/preflight-analyze` extension to emit effort + understanding,
a phased build plan, and six open questions. *Why:* this is a large, easy-to-get-wrong join; the doc is
the careful plan before any code.

### Changed — lesson rollup moved to its own Report page; Grade/Report dropped from the nav

The lesson rollup that was a modal on [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
is now the body of [`app/faculty/report.html`](site/app/faculty/report.html) (replacing the old
per-assignment submission report). The rollup is unchanged otherwise — same live, AI-free numeric
aggregation via `summarizeReports`, same header completion badge + flag pills + section-scope control,
and the same drill-in cascade (flag pill → flagged-students modal → student summary modal → full
Markdown report modal), which moved to the Report page with it.

- **Reached by link only**, never the nav: the page reads the lesson key from the URL
  (`report.html?i=<slug>`, optional `&section=` to preselect a section scope) and **redirects to
  Interactions** if no key is present. The Interactions completion controls (the %, the per-section
  bars, and *View completion*) now navigate to the Report page instead of opening the modal, and the
  dashboard spotlight's **Open full rollup →** points there for the lesson in view.
- **Grade and Report removed from the faculty top nav** ([`app/js/nav.js`](site/app/js/nav.js)). Grade is
  still reachable from the Roster page; Report is reached only via the links above.
- A `.report-rollup` wrapper in [`app/css/styles.css`](site/app/css/styles.css) reproduces the modal's
  24px padding so the tinted `.lesson-head`'s negative-margin bleed still reaches the edge as a page
  body. The old `app/js/faculty-report.js` data layer is now unused (left in place).

*Why:* the rollup is the report faculty actually want, and giving it a stable URL makes it linkable
from the cards and the dashboard; removing the two redundant nav items declutters the bar.

### Fixed — dashboard (and every page) no longer changes width with its content

Added `width: 100%` to `.page` and `.page-wide` ([`app/css/styles.css`](site/app/css/styles.css)). Root
cause: `<body>` is a flex column, so the `margin: 0 auto` on the content container was an *auto
cross-axis margin* — which makes a flex item **shrink-wrap to its content** instead of filling the
row. The content area's width therefore tracked each view's content: the dashboard rendered narrower
on a lesson with no submissions and wider on one with data (measured 963px → 1180px across states).
`width: 100%` fills the row, `max-width` caps it, and the auto margins still center it, so the width
is now constant regardless of content. Verified by rendering both states in headless Chrome and
measuring `.page-wide` (1180px in both). Also kept `overflow-y: scroll` (+ `scrollbar-gutter: stable`)
on `html` so the vertical scrollbar is always reserved — that removes the residual few-pixel
re-centering when a short view (no scrollbar) and a tall view (scrollbar) alternate. The layout still
reflows at the responsive breakpoints when the window itself narrows.

### Changed — faculty dashboard rebuilt as the Just-in-Time-Teaching landing page

Rolled the [`INBOX/dashboard-redesign.html`](INBOX/) exploration into the real app and wired it to
live Supabase data, replacing the old per-assignment progress-bar roll-up
([`app/faculty/dashboard.html`](site/app/faculty/dashboard.html)). The new dashboard answers the actual
JiTT question — *what do I need to know before my next class?* — with:

- **KPI tiles** tied to the lesson in view: preflight completion %, avg effort (graded), students
  flagged for follow-up, avg understanding (diagnostic). They re-aggregate as you navigate lessons
  or change scope.
- **Active-lesson spotlight** — a completion ring, the 0–5 effort histogram (class mean), the top
  misconceptions surfacing, and a flagged-students callout, for one lesson at a time (defaults to
  the next-due preflight). Lesson navigation via proximity "wings" (pointer) / an inline stepper
  (touch) plus a **↩ Today** shortcut, with past / today / upcoming framing.
- **Your section(s)** cards — headline stats + an *understanding-by-lesson* strip — for the sections
  the logged-in user personally teaches.
- **All-sections matrix** (director-only, collapsed by default) — a section × lesson **heatmap**
  with a Completion ↔ Avg-effort toggle and per-section effort/flags columns; the user's own
  sections sort to the top. Columns stop at the active lesson so not-yet-due lessons don't read as
  "behind."

Role is **real** (from `ctx`, not a preview toggle): instructors get their own sections scoped, no
scope toggle, and no matrix; directors/admins get both. New view module
[`app/js/faculty-dashboard.js`](site/app/js/faculty-dashboard.js) (render + wiring + live aggregation) and
a richer loader `loadFacultyDashboard` in [`app/js/faculty-data.js`](site/app/js/faculty-data.js): one
fetch of every published lesson's per-student rows, grouped by (lesson, section), aggregated live
with the **same `summarizeReports()`** engine the interactions rollup uses — so the two views always
agree. The page itself is now thin (bootstrap → nav → theme → `mountDashboard`).

Collision calls (per Matthew): reused the app's existing `.seg` segmented control and `.stat-tile`
tiles; the new pieces (spotlight, ring, misconception list, your-section cards, matrix, nav wings)
were added to [`app/css/styles.css`](site/app/css/styles.css) with tokens only. Dropped the old "Quick
actions" card (the top nav already links those pages).

### Added — `interactions.due_date` (drives the dashboard's "active" lesson)

Migration [`015_interaction_due_date.sql`](supabase/migrations/015_interaction_due_date.sql) — one
**nullable** `due_date timestamptz` on `interactions` (additive; director runs it). The dashboard
picks the **active/"today"** lesson as the next one due (earliest `due_date ≥ now`), framing earlier
ones as *past* and later ones as *upcoming*; with no due dates set it falls back to newest by
`created_at`. Wired a **Due date** field into the app interaction manager
([`app/faculty/interactions.html`](site/app/faculty/interactions.html) modal + a `due` prefill param +
card display) and `saveInteraction` ([`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)).
**Apply migration 015 before deploying** (the manager + dashboard now select `due_date`). Single
course-wide date, not the M/T split assignments use — the spotlight is one lesson for the whole
director view; an M/T split could be added later without a breaking change.

### Changed — one effort-chart style (the labeled histogram), shared by rollup + dashboard

Per Matthew's call, unified on the redesign's effort histogram (submission count above each 0–5 bar,
6-step distribution ramp `--d0…--d5`) as the single style and back-ported it to the interactions
lesson rollup. Updated the shared `.eff-*` block in [`app/css/styles.css`](site/app/css/styles.css) and
`effortChart()` in [`app/faculty/interactions.html`](site/app/faculty/interactions.html) (was the s-ramp
with no counts).

### Added — faculty-dashboard design sandbox

[`test/test-faculty-dashboard.html`](tests/browser/test-faculty-dashboard.html) — like the student sandbox but
it drives the **live render module** (`app/js/faculty-dashboard.js`) with a synthetic model via its
render-only `renderModel` entry, so it tracks both the stylesheet *and* the render logic. Toggles for
role / active lesson / theme; linked from the [`test/`](tests/browser/test.html) hub. Verified in headless
Chrome across director, instructor, light, and matrix-open states.

### Changed — design sandboxes moved into `test/` + new student-dashboard sandbox

Moved the standalone preview pages out of the repo root into a dedicated [`test/`](tests/browser/) directory
(`git mv`, history preserved): [`test/test.html`](tests/browser/test.html) (hub),
[`test/test-summary.html`](tests/browser/test-summary.html), and
[`test/test-progressbar.html`](tests/browser/test-progressbar.html). Added
[`test/test-student-dashboard.html`](tests/browser/test-student-dashboard.html) — a synthetic-data preview of
the **student** landing page rendered on the **live** design system (links `app/css/styles.css`,
mirrors the real top nav). Unlike the other sandboxes it intentionally reuses the production
stylesheet so it tracks the real app. It previews the proposed dashboard direction: a single
deadline-sorted **Up next** feed merging preflights *and* interactions (the live loader doesn't yet
surface `interactions.due_date`), a **"Review before class"** formative panel built from a completed
interaction's `report_data` (effort/points, per-objective strength meters, `recommended_review`), and
recent grades. The `../test-summary.html` link in [`app/DESIGN.md`](site/app/DESIGN.md) was repointed to
`../test/`. Why: keep the repo root clean and group the no-DB design previews; give the student
dashboard a sign-off surface like the faculty rollup already has.

### Added — `interaction-aggregate` skill (builds the cohort analysis the spec designed)

Built the cohort aggregator the `INTERACTION-AGGREGATION.md` spec called for — the
interaction-path analog of `/preflight-analyze`. It reads the per-student `report_data` across an
interaction and writes the class-level AI synthesis the faculty rollup shows as "coming soon"
placeholders: a **readiness summary**, **misconception trends**, and **2-3 AI-picked
reading-reflection quotes**, as **one rollup per section plus a whole-course rollup**. Files are
created but **not yet run** (run after the due date, when submissions are frozen).

- **Table** — [`supabase/migrations/014_interaction_analysis.sql`](supabase/migrations/014_interaction_analysis.sql)
  (director runs it; Claude has no DDL). One row per `(interaction_id, section_id)` where
  `section_id` is a real section or the `'__all__'` whole-course sentinel; columns
  `readiness_summary` / `misconception_trends` / `selected_quotes` (`[{student_id, section_id}]`) /
  `meta` / `generated_at`. Read-RLS mirrors `preflight_interaction_reports` (directors → all incl.
  `'__all__'`; instructors → own sections only); writes only via the BYPASSRLS `claude_code_recker`
  role (no write policy, no role-specific GRANT — default privileges cover it). CHECKs bound the
  prose and enforce **no quotes on the `'__all__'` row**.
- **Helper** — [`supabase/admin/interaction_aggregate.py`](supabase/admin/interaction_aggregate.py)
  (`pull` / `write-analysis` / `status`). `pull` groups reports per section + `'__all__'`, emitting
  a **precomputed numeric summary** (a focused Python port of the UI's `summarizeReports`, so the
  prose cites the same figures the bars show) plus the per-report free-text fields the model reads;
  no names, no `report_markdown`. `write-analysis` re-derives `meta.n` + a `source_fingerprint`
  from live rows, validates section ids and that every quote's student is actually in that section,
  enforces the no-`'__all__'`-quotes rule, and upserts (`--dry-run` first). `status` flags staleness.
- **Skill** — [`.claude/skills/interaction-aggregate/SKILL.md`](.ai/skills/interaction-aggregate/SKILL.md):
  preflight → pick lesson (nudge to `/interaction-backfill` if `report_data` is missing) → `pull` →
  write the three panels per scope (quote-selection criteria + "ground in the numbers" rule;
  whole-course row is prose-only) → `write-analysis` → verify via `status`. Read-only on grades.
- **Decisions settled** (from the spec's open list): per-section **and** whole-course rollups
  (`'__all__'` sentinel); dedicated table over JSONB; quotes stored as ids (reports are frozen at
  run time, so they resolve to stable text); manual regeneration; **quotes only on single-section
  views** (the "All sections" view shows prose only), which also keeps each instructor's quote pool
  scoped to their own sections. **UI wiring is a deferred follow-up** — the skill writes the data;
  the rollup still shows placeholders until `app/faculty/interactions.html` is wired to read the
  table (rules for that captured in the skill's "Deferred — UI wiring" section).

### Added — `INTERACTION-AGGREGATION.md` spec for the cohort analysis aggregator

Wrote the design spec for the not-yet-built **cohort aggregator** that fills the rollup's three AI panels
(readiness summary, misconception trends, AI-picked showcase quotes), to disentangle it from the
per-student `/interaction-backfill` repair tool. [`INTERACTION-AGGREGATION.md`](docs/decisions/INTERACTION-AGGREGATION.md)
covers the goal, inputs (all already in `report_data` — **no data-contract change**), the output shape, a
proposed `interaction_analysis` table (draft migration `014`, read-RLS mirroring the reports, written by the
scoped `claude_code_recker` role), the run steps (reuse `summarizeReports` for the numbers + batched
text-only AI passes), how the rollup consumes it with graceful degradation, and seven open design decisions
to settle before building. Also pointed the CLAUDE.md "Deferred" note at the spec. Documentation only.

### Added — `interaction-backfill` skill + scoped DB role for direct database access

Stood up direct, least-privilege database access for Claude Code and used it to backfill the
schema-1 `report_data` on interaction reports that only had `report_markdown` — those lessons
were showing completion counts but an empty faculty rollup (no effort/understanding/misconceptions).

- **Scoped DB role** — [`supabase/admin/claude_code_role.sql`](supabase/admin/claude_code_role.sql)
  creates `claude_code_recker`: SELECT/INSERT/UPDATE/DELETE on `public`, BYPASSRLS, **no DDL** (owns
  nothing, so ALTER/DROP/TRUNCATE are refused by Postgres itself). Strictly additive — it does not
  touch the `service_role` key, the anon key, or any existing RLS policy, so `/preflight-analyze` is
  unaffected. Reached over the **Session pooler** (the direct host is IPv6-only here) from a project
  venv (`.venv/`, gitignored) via `psycopg2` ([`requirements.txt`](requirements.txt)); the credential
  lives in a gitignored `supabase/admin/config.json` (next to the role SQL + scripts, not owned by any skill).
- **`db_check.py`** — connectivity + permission self-test (read OK, write OK, DDL DENIED).
- **`interaction-backfill` skill** (named for the one-off repair it is, leaving `interaction-analyze` free
  for the future cohort aggregator) — [`.claude/skills/interaction-backfill/SKILL.md`](.ai/skills/interaction-backfill/SKILL.md)
  + [`supabase/admin/interaction_reports.py`](supabase/admin/interaction_reports.py) (`stats` /
  `list-missing` / `write`). Reads each report's Markdown and reconstructs a faithful schema-1
  `report_data` per [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md): effort (with the
  reading-reflection cap), understanding, consistent per-lesson objective keys, misconceptions with
  evidence, reflection, honor (judged by appropriateness), and triage flags. Marks provenance with
  `producer: "backfill-from-report@<date>"`. The writer sets `effort` + `report_data` (the
  migration-013 trigger derives `score`), fills only NULL rows unless `--force`, re-clamps effort for
  non-meaningful reflections, and enforces the 32 KB blob cap.
- **Backfilled the 8 existing reports** that lacked structured data (7 in lesson-02 charge/Coulomb,
  1 in lesson-03 vector form). Lesson-02 now rolls up to avg effort 3.43, 11/14 points, 2
  reflection-capped, 1 honor disclosure.
- **Docs:** operator runbook [`supabase/admin/README.md`](supabase/admin/README.md), a committed
  `config.json.template`, and an agent operating guide
  [`supabase/admin/AGENT-DB-ACCESS.md`](supabase/admin/AGENT-DB-ACCESS.md) — how Claude iterations
  connect/operate, the rules, and how the access was established.

### Changed — integrity/notable flag semantics sharpened (rollup + data contract)

Refined what the lesson rollup's flag pills mean and clarified [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md)
to match — a **v1 clarification** (no endpoint/hash/type/wire-format change; `schema` stays `1`, applied
because only one artifact exists and is easy to update):

- **`honor.status` now judges *appropriateness*, not disclosure.** Appropriate collaboration (talking with a
  classmate beforehand, allowed resources) is `none` and unflagged. `disclosed` now means **inappropriate**
  help/resources (another AI actively helping, disallowed materials) and surfaces as **“Inappropriate
  resources.”** `concern` is a conversation-level integrity problem — manipulating/harassing the AI to inflate
  the report or game the effort grade. (§5.6, with a dated clarification note.)
- **`flags.notable` now means exemplary work** (strongest understanding or a notable extension), not “either
  direction.” (§5.8; the §6 example was updated for consistency.)
- Added a §9 note that artifacts should always populate `flags` / `honor` / `reading_reflection.meaningful`,
  and that the site can derive `needs_follow_up`/`notable` from effort + understanding but never `honor`.
- Aligned the flag pill labels/descriptions in [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
  to the new wording (“Disclosed help” → “Inappropriate resources”; notable → exemplary).

---

## 2026-06-24 — Matthew Recker

### Changed — portal theme reskinned to GitHub Primer + a self-hosted display font

Promoted the [`test-summary.html`](tests/browser/test-summary.html) sandbox's new look into the live `app/` portal.
The palette in [`app/css/styles.css`](site/app/css/styles.css) moved off Air Force navy/gold to a
**GitHub-Primer** system — `--blue`/`--blue-lt` are now both `#0969da` (light) / `#4493f8` (dark),
surfaces/borders/text and all four alert families adopt Primer values, and **USAFA gold is retained only
as a restrained accent** (feedback rail). Both `:root` and `[data-theme="dark"]` were rewritten; a new
`--text-soft` ink tone was added. Hero titles now use a **self-hosted Oswald** condensed display face —
two woff2 subsets decoded into [`app/media/fonts/`](site/app/media/fonts/) and wired via `@font-face` + the
new `--font-display` token (applied to `.page-head h1`, the nav brand, the login title, and the lesson
rollup title; body/UI stay on the system stack, so there's no build step and no third-party network call).
Every `app/` page inherits this through the shared stylesheet. [`app/DESIGN.md`](site/app/DESIGN.md) was updated
to document the new palette, the display face, and the v3 rollup components.

### Changed — faculty lesson-summary rollup rebuilt to match the sandbox (live data)

Rebuilt the lesson report rollup in [`app/faculty/interactions.html`](site/app/faculty/interactions.html) to the
sandbox design, wired to real `report_data` via `summarizeReports` (no AI). New layout: a **tinted full-bleed
header** (Oswald title + a stacked **“Submitted N/total” completion badge** + clickable **flag pills** + an
**adaptive scope control** — a segmented control for few sections, a dropdown for many); **bordered effort +
radar tiles** (vertical effort bar chart; an **interactive radar** whose vertices show the objective + mean on
hover); an **AI readiness summary** placeholder (replacing a bare effort summary — the effort chart already
conveys the number); a **Misconceptions** panel with **real per-misconception prevalence bars** (share of
submitted students, computed from `report_data`) above an AI trend-narrative placeholder; a **weakest-first,
one-per-row** understanding-by-objective breakdown; and a new **Student Responses** panel that surfaces real
reading-reflection quotes (names hidden by default, shuffle, copy-for-slides). Flag pills now drill down in
**stacked modals**: pill → student names list → one student's structured summary → full Markdown report. The
headline overall-understanding gauge was dropped (the radar conveys it). Everything numeric is live; the AI
narrative panels (readiness, misconception trends) and the aggregator-selected showcase quotes stay inert
until the analysis-output store exists — **no data-contract change is required** for any of it.

### Added — `app/DESIGN.md` design-system spec for the portal refactor

Authored [`app/DESIGN.md`](site/app/DESIGN.md), a tokenized design-language document for the `app/` portal,
following the DESIGN.md format (Google Stitch / getdesign.md): YAML front matter capturing the live
tokens from [`app/css/styles.css`](site/app/css/styles.css) — the two-palette light/dark color roles, the
em-based type scale, spacing/radius/elevation, and component compositions — followed by prose sections
(Overview, Colors, Typography, Layout, Elevation, Components, Responsive Behavior, Known Gaps) that
explain the *intent* behind each rule. Purpose: let a human or agent extend the UI on-brand without
re-deriving the system, and codify the governing rule that pages are authored with tokens only (never a
hardcoded surface/status color). Documentation only — no code or DB changes.

### Added — `test-summary.html` rollup sandbox (synthetic data, no DB) + `test.html` is now a hub

To iterate on the lesson-rollup design without a database, the old `test.html` progress-bar playground was
renamed to [`test-progressbar.html`](tests/browser/test-progressbar.html) and [`test.html`](tests/browser/test.html) is now a small hub
that links to the sandboxes. New [`test-summary.html`](tests/browser/test-summary.html) is a fully standalone preview
(palette copied in, 24 synthetic cadets across 3 sections, no DB and no CDN) of the next rollup iteration:

- **Overall-understanding gauge removed** — the radar already conveys it.
- **Effort distribution + radar share row 2**, sized to equal height (a 2×2 grid whose row tracks stretch);
  **below the effort chart** is an AI-aggregator **summary placeholder (TBD)** sized to match the radar's
  objective key beneath it.
- **Effort bars colored by points earned**: 0 = red (0 pts), 1 & 2 = the same amber (1 pt), 3/4/5 = three
  distinct greens (2 pts). Class average drawn as a labeled line.
- **Radar axes labeled A, B, C…** (always legible) with a **lettered objective key** listed beneath it.
- **Understanding by objective is one objective per row**, full width, as a **5-column** fine histogram
  labeled 1–5 (score 0 is the leftmost sub-cell of column 1; the axis ends at 5, not 6, so the colors align).
- **Flags now drill down in stacked modals**: click a flag → a **list of student names + sections** (no
  summaries) → click a name → that student's **summary** modal → **View full report** → the full Markdown
  report. (Replaces the long scrolling list of all summaries.)

These changes live only in the sandbox for now; porting to [`app/faculty/interactions.html`](site/app/faculty/interactions.html)
comes after design sign-off. The demo seed already carries the third objective needed for the radar.

## 2026-06-23 — Matthew Recker

### Changed — restructured the interaction rollup into three rows + flag-driven student drill-down

Reworked the faculty lesson rollup ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) into a
fixed top-to-bottom layout and removed the all-students list:

- **Row 1 — Overall understanding** (all topics) as the headline gauge. The value tag is now a neutral
  high-contrast pill (legible on any zone color — the old white-on-yellow was unreadable).
- **Row 2 — Effort distribution** with the class **average drawn in** as a labeled reference line, sharing the
  row with a **radar** giving a quick read of understanding across every objective (needs ≥3 objectives —
  a spider needs ≥3 axes).
- **Row 3 — Understanding by objective** as a **two-column** grid of fine-cell (5×5-style) histograms. Headers
  reserve a fixed two-line height (and clamp to two lines), so a long title that wraps never pushes its chart
  below a short-titled neighbor — every chart on the row stays aligned. An odd final tile is centered on its
  own row but capped to a single column's width (never wider than the others).
- A **Section dropdown** at the top of the summary rescopes every plot (all sections / one section); **Export
  for analysis** moved to its own bottom row beneath the summary.

The roster list is gone. **Flag chips now open a modal** of just the matching students; each shows the
(well-liked) structured summary panel plus a **View full report ↗** button that opens that student's full
Markdown report in a further stacked modal — no inline AI report by default. New `.lr-*`/`.fm-*` styles and a
`lrEffort()` mean-line builder added; inline list/report code removed.

`supabase/seed_demo_interaction.sql` gained a **third objective** (`induced-charge`) so the synthetic demo
exercises the radar (and the odd-tile centering in row 3). Re-run the seed to refresh existing demo data.

### Docs — recorded that Node is unavailable (and uninstallable) on the dev machine

Noted in `.claude/CLAUDE.md` (Tech Stack + Important Notes) and [`app/README.md`](site/app/README.md) that this
machine has **no Node and cannot install it** — there is no `node`/`npm`/`npx`, `node --check`, eslint, or
jest, and no build step. The frontend is hand-authored ES modules + plain CSS the browser runs directly, so
changes are verified by **opening the pages in a browser** (`python -m http.server 8000` from the repo root),
never with a JS linter/test runner/typecheck. This is a hard environment constraint, not a preference.

### Changed — redesigned the interaction rollup (gauges, histograms, radar, clickable flags)

Rebuilt the faculty lesson-rollup ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) to be
far less busy and to surface the **spread**, not just the average — a class mean of 2.5 can be "everyone
mediocre" or "half aced it, half lost," and those need different responses. The new rollup is:

- **Two headline gauges** — Effort (graded) and Understanding (diagnostic) — as 5-zone connected-blocks
  bars (red→green, each zone = one point, lit to the value) with a readable value tag above the fill.
- **Effort distribution** — a compact 0–5 histogram.
- **Understanding by objective** — a **class-profile radar** (mean vs. a 3.5 target; shown only with ≥3
  objectives) plus a **fine-cell histogram** per objective (each score region split into thin same-color
  cells) showing each objective's distribution.
- **Clickable flag chips** — *Needs follow-up / Notable / Disclosed help / Integrity concern / Reflection
  capped* — clicking one filters the student list to just those reports (toggle off or "Show all" to clear).

Removed for clarity: points-awarded, self-rated understanding (we never collect it — it only appeared
because the demo seed invents it), confidence gap, the separate "completed flow" tile (the
submissions/`28/33 · 85%` line already shows completion), the misconception pills, and the `[placeholder]`
AI-narrative boxes. `summarizeReports()` ([`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js))
now also returns a 0–5 distribution for overall understanding and per objective; new ramp tokens + `.lr-*`
component styles live in [`app/css/styles.css`](site/app/css/styles.css). Styles were prototyped in `test.html`.

### Added — synthetic seed for previewing the interaction rollup

New [`supabase/seed_demo_interaction.sql`](supabase/seed_demo_interaction.sql) populates a clearly-fake
demo interaction (`demo-rollup-sandbox`, an unpublished draft) with one synthetic `schema:1` report per
real student in a course, so the faculty rollup (`summarizeReports()` in
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)) can be previewed with realistic data
before any real artifact submissions exist. Run it in the Supabase SQL Editor (runs as `postgres`, so it
bypasses the RLS rule that otherwise only lets a student write their own report). Variety (effort 0–5,
decorrelated understanding, misconceptions from the Preflight-1 taxonomy, reading-reflection gate, honor
statuses, triage flags) is derived deterministically from `student_id`, so re-runs are stable; effort and
understanding are decorrelated on purpose to exercise the "full effort, low understanding" case. Scopes to
real students' real sections via `sections.course_id` (matching how the rollup loads data) and never touches
a real interaction or a real submission. Includes a copy/paste rollup-preview query for each UI aggregate and
a one-line cascade teardown. Conforms to `INTERACTION-DATA-CONTRACT.md` (schema 1).

### Changed — rebranded the platform to **iPREP**

Renamed the website's user-facing brand to **iPREP** (*interactive Pre-lesson Readiness Engagement
Platform*). Updated the `app/` portal nav brand + footer ([`app/js/nav.js`](site/app/js/nav.js)), the
login screen (now shows the full name as a tagline, [`app/login.html`](site/app/login.html)), every
`app/` page `<title>`, and the legacy page headers/titles (`index.html`, `admin.html`,
`review.html`, `interactions.html`, `interactions-admin.html`, `artifact-submit.html`). The
repository, GitHub Pages path, and CSV/JSON export filenames stay `Core_Preflights` on purpose —
renaming them would break deployed-artifact links (the frozen data contract), bookmarks, and
existing Blackboard grade imports. Documented the brand-vs-repo distinction at the top of
`.claude/CLAUDE.md`.

### Added — interaction summaries (numeric rollups from `report_data`)

Built the per-lesson **summary** that the data contract said the site computes without AI. The
faculty report modal ([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) now shows a
live, section-scoped rollup over every in-scope report: effort average + points + an effort 0–5
distribution, completion, assessed-vs-self-rated understanding with the confidence gap, per-objective
understanding bars, misconception counts, reading-reflection meaningful-rate / effort-capped count /
sentiment / topic tags, and integrity + triage-flag tallies. All numbers are folded from
`report_data` (schema 1) by a new pure aggregator `summarizeReports()` + fetcher `loadInteractionData()`
in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js), coercing out-of-range/wrong-typed
LLM output defensively. Each individual report also gets a structured panel above the Markdown (effort,
understanding, objectives, misconceptions, reflection, honor, flags, and the artifact's per-student AI
narrative). Students now see their own effort/points on the interactions page
([`app/js/student-data.js`](site/app/js/student-data.js), [`app/student/interactions.html`](site/app/student/interactions.html)).
The **free-text trend prose** that genuinely needs the AI aggregation pass — the cohort narrative,
clustering of novel/free-text misconceptions, and reflection-theme synthesis — is rendered as labeled
`[placeholder]` blocks pending that pipeline. Styles added to [`app/css/styles.css`](site/app/css/styles.css).

### Added — generalized artifact receiver (`artifact-submit.html`)

Built the receiver that realizes the v1 data contract. New
[`artifact-submit.html`](artifact-submit.html) (based on the old `interaction-submit.html`)
parses the `#t=`/`#i=`/`#r=`/`#d=` hash payload: reserved type (only `interaction` in v1, others
rejected), decompresses the Markdown report and the optional structured JSON, validates `effort`
as an integer 0–5 (else null), requires student login, and upserts `report_markdown`,
`report_data`, and `effort` into `preflight_interaction_reports` (the `score` column is left to
the migration-013 trigger; never written by the client). Structured data is handled defensively —
malformed JSON is stored under `{_unparsed}` rather than dropped, and structured fields are only
written when present so an older artifact (no `#d=`) re-submitting can't wipe them. The signed-in
view and the post-submit status now show the assessed effort and the points it maps to.
[`interaction-submit.html`](interaction-submit.html) is now a hash-preserving redirect to the new
receiver, so artifacts deployed before the rename keep working. Updated the references in
`INTERACTION-PREFILL-LINK.md` and `app/README.md`.

### Added — locked v1 data contract for lesson-artifact submissions

Wrote [`INTERACTION-DATA-CONTRACT.md`](docs/contracts/INTERACTION-DATA-CONTRACT.md): the frozen contract
between a claude.ai lesson artifact and the site's static receiver. Pins a generalized
permanent endpoint (`artifact-submit.html` at the repo root, excluded from the `app/` refactor;
legacy `interaction-submit.html` stays as a hash-preserving redirect so deployed artifacts
never break), the URL-hash transport (reserved `#t=` artifact-type defaulting to `interaction`,
`#i=` slug, `#r=` full Markdown report, optional `#d=` structured JSON, lz-string codec,
student identity resolved from session not payload), and the `schema: 1` structured payload.
Key modeling decisions baked in: **effort is the only grade-bearing field** (engagement, not
correctness — full conversation + zero understanding still earns full marks; refusal/tangents
score low), with a 0–5 engagement rubric and a **reading-reflection gate** (a non-meaningful
reflection caps effort at 2); understanding, per-objective scores, misconceptions, and AI
narrative are **diagnostic only**; misconception/objective entries are **self-describing**
(carry their own label/description) so the aggregator needs no short-code dictionary;
numeric/categorical fields are sized for the website to compute all rollups deterministically,
leaving the AI only the text fields to scan for trends. Over-captured optional fields
(`ai_summary`, `key_strengths`, `recommended_review`, per-objective `confidence`,
`reading_reflection.meaningful`) since deployed artifacts can't be retrofitted. Includes the
versioning policy (additive-only within v1, `schema: 2` for breaking changes) and size budget.

### Added — DB migration 013: interaction effort → auto score

[`supabase/migrations/013_interaction_effort_score.sql`](supabase/migrations/013_interaction_effort_score.sql)
adds `effort` (0–5) and a trigger-derived `score` (0–2) to `preflight_interaction_reports`:
effort 3–5 → 2 pts, 1–2 → 1 pt, 0/NULL → 0 pts. `score` is recomputed from `effort` on every
write, so a student can't post a score independent of effort; legacy rows stay untouched (NULL)
until re-submitted. Also adds a 32 KB `CHECK` on `report_data` and a `(interaction_id, score)`
index for rollups. Apply via the Supabase SQL editor / migration runner.

---

## 2026-06-22 — Matthew Recker

### Added — per-lesson export for the analysis aggregator

Settled the interaction-analysis data contract: the aggregator is fed the plain `report_markdown`
(no structured `report_data`/view route for now). Name + student ID + score is **not treated as
PII**, so reports are exported as-is — protection is the existing faculty auth + RLS, not content
redaction. New function in [`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js):

- `buildLessonCorpus(ctx, interactionId)` — concatenates every report for one lesson (directors:
  all sections; instructors: their own; RLS independently gates reads) into one Markdown document,
  one block per student labeled with name · student ID · section, ordered by section then ID.

A new **Export for analysis ⬇** button in the lesson-report modal
([`app/faculty/interactions.html`](site/app/faculty/interactions.html)) downloads
`<interaction-id>-reports.md` for handoff to the aggregator.

(An earlier name-redacting `redactReport()` step was built and then removed once the PII
determination made it unnecessary — keeping the export simple.)

### Added — clickable interaction completion with a per-student report viewer

On the faculty interactions page ([`app/faculty/interactions.html`](site/app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js)), the completion percentage and
each per-section progress chip are now **clickable** (keyboard-accessible too) and open a redesigned
**lesson report** modal:

- A **course-wide summary** banner — placeholder text for now; the misconception/understanding
  summary will populate it once the interaction-analysis pipeline lands (plan item D).
- A **section scope** selector ("All sections" or one section) with live completion stats.
- A **completion list**: every student in scope with a ✓ Complete / Not yet badge, and a
  **View report** button next to each completed student that renders their saved report inline
  (sanitized with DOMPurify, as before).

The data layer now returns `doneStudentIds` per interaction (the set of students who submitted a
report), replacing the old dropdown-driven viewer that could only page through students one at a
time. Implements item C of the day's plan; the report viewing/completion half is fully functional
now, while the aggregate-summary body stays stubbed pending D. A small `.clickable` affordance was
added to [`app/css/styles.css`](site/app/css/styles.css).

### Changed — faculty dashboard roll-up is now interactions-only, split by ownership

Reworked the faculty dashboard ([`app/faculty/dashboard.html`](site/app/faculty/dashboard.html) +
[`app/js/faculty-data.js`](site/app/js/faculty-data.js)) toward the interactions-first test:

- The section roll-up no longer shows preflight assignment progress. Each section card now lists
  **per-published-interaction completion** (`done/total` per lesson) instead. Preflight grading is
  unchanged and still lives on the Grade/Report tabs.
- The roll-up is split into **"Your sections"** (sections you personally teach) and, for
  directors/admins only, a second **"All other sections"** group. Instructors see only the first.
- The stat tiles dropped the assignment-centric "submissions to grade" / "avg submitted" in favor
  of **lessons published** and **avg interaction completion**.
- `loadFacultyDashboard` stopped querying `assignments`/`responses`/`scores` (and the now-unused
  per-assignment helper was removed), returning `mySections` / `otherSections` / per-interaction
  breakdowns instead. Implements items A + B of the day's plan.

### Added — work plan for the next portal iteration

Wrote [`app/PLAN-2026-06-22.md`](site/app/PLAN-2026-06-22.md): a dependency-ordered plan to push the
faculty portal toward a lesson-interactions-first experience. Covers (A/B) splitting the section
roll-up into "your sections" vs. "all other sections" and stripping preflight data from it in
favor of interactions only, (C) a clickable interaction completion list with per-student report
viewing, (D) a course-level interaction overview in Quick Actions, and (E) a native admin page
with a new `reset-password` edge function (instructors reset their own students; directors reset
all students/instructors and move section assignments). Records current state, blockers (notably
the not-yet-built interaction-analysis aggregation and the missing password-reset function), and a
recommended A→B→C→D→E priority order.

---

## 2026-06-12 — Matthew Recker

### Fixed — footer pinned to the bottom on short pages

The attribution footer floated up under short content. Made `<body>` a flex column with
`main { flex: 1 0 auto }` (a standard sticky-footer layout), so the content area grows to
fill the viewport and the footer sits at the bottom — while still flowing below tall content.

### Added — native in-app interaction manager

Ported the interaction CRUD off the legacy `interactions-admin.html` into the portal:
[`app/faculty/interactions.html`](site/app/faculty/interactions.html) +
[`app/js/faculty-interactions.js`](site/app/js/faculty-interactions.js) now do add / edit /
publish / unpublish / delete, per-section completion, and the per-student report viewer —
all inside the app shell (nav, theme, course switcher). Directors manage (incl. drafts);
instructors get a read-only published view scoped to their sections. It also honors the
prefill query params, so the Claude artifact link can target the app page directly. The
faculty dashboard "Manage interactions" quick-action now points here instead of opening the
legacy page in a new tab. (The prefill doc's base URL was updated to the app manager, with a
note on the `/app/` → root path change after promotion.)

### Changed — nav links centered & text-only

The top-nav links are now horizontally centered in the bar (3-zone `1fr auto 1fr` grid:
brand hard-left, links centered, controls hard-right) and **no longer carry icons** — plain
text labels, per preference. The brand logo, theme toggle (sun/moon), course switcher, and
user avatar keep their icons. Freed icons (`ic-assignments`, `ic-analytics`, `ic-settings`)
are marked available in `ICONS.md`.

### Added — prefill links for the interaction manager

`interactions-admin.html` now reads a query string and auto-opens the **New interaction**
modal prefilled (`new=1&id=&course=&title=&desc=&url=&pub=`), so a Claude artifact can hand
the director a one-click link that lands on the manager with everything filled in — they
just review and Save. Director-gated (instructors see a notice), values are only prefilled
(never auto-written), and the query is stripped from the URL after opening so a refresh
won't re-trigger. Full spec + a copy-paste builder for the artifact skill is in
[`INTERACTION-PREFILL-LINK.md`](docs/contracts/INTERACTION-PREFILL-LINK.md), including the load-bearing rule
that the link's `id` slug must match the artifact's `#i=<slug>` report callback.
**Re-using an existing slug** opens the listing in *Update — review & save* mode and patches
it (no duplicate-id error); omitted params keep their current values — so regenerating an
artifact and re-sending the link cleanly refreshes the existing interaction. Both the app
manager and the legacy page honor this (the legacy page now awaits its row load first so the
existing slug is detected reliably).

### Changed — full-bleed navbar

The nav bar's contents now span the full viewport width (brand pinned hard left, theme
toggle + user menu hard right) instead of being constrained to the centered page-content
width. Page content below stays centered.

### Changed — all 35 icons wired in; navbar logo/controls refined

Matthew added the real Flaticon PNGs, so the portal now uses the whole set (previously
~15 of 35 were referenced; sun/moon and others were dead). Wired the remainder into natural
homes: **sun/moon** → theme toggle (`theme.js`), **menu** → mobile burger, **user** → the
account dropdown header, **course** → the course switcher, **success/warning/error/info** →
`.alert-*` glyphs (CSS `background-image`, resolved relative to the stylesheet so it works at
any page depth), **submissions/grades/class/completion** → faculty dashboard, **due-soon/
done/progress/rocket** → student dashboard, and the physics set **atom/bolt/wave/magnet** →
a decorative motif under the login card. Inventory tracked in
[`app/media/icons/ICONS.md`](site/app/media/icons/ICONS.md) (name · description · search terms ·
status · where-used) — the source of truth for adding/retiring icons. The old AI
search-prompt file was removed.

Navbar tweaks per request: **bigger, box-less brand logo** pinned left; **box-less** theme
toggle and user chip pinned right (backgrounds/borders removed, subtle hover only).

### Added — Flaticon attribution footer

The portal icons are all from **Freepik on Flaticon**, whose free license requires a visible
credit. Added a shared site footer (rendered by `renderNav` → `renderFooter` in
[`app/js/nav.js`](site/app/js/nav.js), styled in [`app/css/styles.css`](site/app/css/styles.css)) that
appears on every page displaying the icons, linking to
<https://www.flaticon.com/authors/freepik>. Login/router pages use only emoji, so they carry
no footer.

### Changed — cleaner, modern portal navbar

Restyled the `app/` top navigation after Featurebase's clean aesthetic: a light,
**translucent + blurred** sticky bar with a hairline bottom border (no heavy colored bar
or drop shadow), muted medium-weight links that darken into a soft pill on hover/active, a
subtle bordered brand mark, gradient-avatar user chip, and rounded controls. Added
`--nav-*` theme tokens with a dark-translucent variant so it reads well in both modes.
Pure CSS in [`app/css/styles.css`](site/app/css/styles.css) — no markup changes.

### Added — Roster & Sections ported into the `app/` portal

Director tooling now lives natively in the portal. New [`app/faculty/roster.html`](site/app/faculty/roster.html)
+ [`app/js/faculty-roster.js`](site/app/js/faculty-roster.js) combine the legacy Roster and
Sections tabs into one page with **Students / Sections** sub-tabs:

- **Students:** drag-&-drop CSV upload (validates `student_id` 3000xxxxxx + `[MT][135][A-D]`
  section codes, creates sections before students), a 10-row preview, per-student
  **edit-section** and **remove** (cascades scores/responses/extensions), and account
  **provisioning** via `db.functions.invoke('provision-students')` (cleaner than the legacy
  raw `fetch`, and avoids needing `SUPABASE_URL` in module scope).
- **Sections:** instructor-assignment grid that saves instantly.

Director-gated: the **Roster** nav link and the page body only appear for
directors/global-admins (`nav.js` now supports `directorOnly` links). The faculty dashboard
quick-action and nav point at the new internal page.

Still legacy (next): Assignments builder, Instructor management, Export.

## 2026-06-11 — Matthew Recker

### Added — Grade & Report ported into the `app/` portal

Second refactor pass: the two daily-use faculty tools now live natively in the portal
shell (top nav, theme, course switcher), no longer requiring the legacy `admin.html`.

- [`app/faculty/grade.html`](site/app/faculty/grade.html) + [`app/js/faculty-grade.js`](site/app/js/faculty-grade.js)
  — the full grading workflow: assignment + section pickers, the 3-state credit toggle
  (full → warn → zero), per-question feedback, "only flagged" filter, per-student totals,
  save-draft / finalize-&-publish, reopen, and grant/edit/remove extensions. Same
  `scores.question_scores` shape, `is_finalized` semantics, and `extensions` writes as the
  legacy tab — a faithful port, restyled with theme tokens and delegated events.
- [`app/faculty/report.html`](site/app/faculty/report.html) + [`app/js/faculty-report.js`](site/app/js/faculty-report.js)
  — submission summary, "did not submit" list, and per-question cards showing the
  `analysis_report` class summaries (from `/preflight-analyze`) plus raw responses with
  show-names, random-10 sampling, and copy-to-clipboard.
- Faculty **nav** now exposes Grade and Report directly; a single **Admin ↗** link covers
  the still-legacy director tools. Dashboard quick-actions point Grade/Report at the new
  internal pages.

Still legacy (next passes): Assignments builder, Roster, Sections, Instructors, Export.

### Added — `app/` role-based portal (foundation pass)

A coherent, role-aware rewrite of the front end living in a new [`app/`](site/app/) subfolder,
built to be promoted to the repo root later. **No database or RLS changes.** This first
("foundation") pass ships the shell, theming, navigation, both dashboards, and the
interaction views; the heavy grading / roster / sections / assignment-builder / export
tools stay on the legacy pages and are reached via out-links until ported in a later pass.

**Why:** the legacy pages each re-implemented their own login card, session check, and
`esc()` helper, had no shared module, no dashboard landing, and a single light-only theme.
The portal unifies all of that behind one auth bootstrap and a top nav with light/dark mode.

**Shared shell ([`app/js/`](site/app/js/)):**
- `config.js` — copy of the root client (sets `window.db`); kept identical so paths don't
  change after promotion. `supabase.js` re-exports it as an ES module.
- `auth.js` — one `bootstrap({ require })` every page calls: restores the persisted session
  (survives reload + navigation), redirects unauthenticated users to login with a `?next`
  round-trip, resolves role by **table membership** (instructors vs students), resolves the
  faculty course list + persisted current course (ports `admin.html`'s `initAdmin`
  fallbacks) or the student's course (derived from their section), and enforces the page's
  required role.
- `nav.js` — shared top navigation: role links, faculty **course switcher**, theme toggle,
  user menu, mobile menu. `theme.js` — `data-theme` dark mode (localStorage +
  `prefers-color-scheme`, no-flash head snippet). `util.js` — `esc()`, due-date/section
  logic, an emoji-fallback `iconHTML()`, and `legacyUrl()` (resolves root-level legacy
  links correctly both at `/app/` and after promotion).
- `student-data.js` / `faculty-data.js` — batched, no-N+1 dashboard queries over existing
  tables only.

**Pages:** [`app/login.html`](site/app/login.html) (unified cadet-ID-or-email login),
[`app/index.html`](site/app/index.html) (role router), student
[dashboard](site/app/student/dashboard.html) / [assignments](site/app/student/assignments.html)
(ported submit+review engine) / [interactions](site/app/student/interactions.html), and faculty
[dashboard](site/app/faculty/dashboard.html) (per-section submission/grading roll-up) /
[interactions](site/app/faculty/interactions.html) (completion roll-up + per-student report viewer).

**Design system:** [`app/css/styles.css`](site/app/css/styles.css) is the legacy sheet with its
~14 hardcoded surface/alert colors tokenized into CSS variables plus a `[data-theme="dark"]`
set, extended with top-nav, stat-tile, and roll-up components.

**Icons:** [`app/media/icons/ICONS.md`](site/app/media/icons/ICONS.md) documents the
cohesive icon set; the UI references those filenames and falls back to emoji when needed. See
[`app/README.md`](site/app/README.md) for the structure and go-live steps.

### Added — Lesson Interactions feature

A new path alongside the existing assignments system: students work through a Claude
**artifact** (an interactive lesson hosted on claude.ai), and the artifact sends a
compressed Markdown report back to the site to be saved per student. Directors create
and manage these lessons; an AI skill will later summarize trends by section.

**Database — migration [`012_preflight_interaction_reports.sql`](supabase/migrations/012_preflight_interaction_reports.sql)** (purely additive; touches no existing table):
- `interactions` — one row per lesson. `id` is a stable slug (e.g. `lesson-02-charge`)
  the artifact embeds in its submit link. Holds `course_id`, `title`, `description`,
  `artifact_url`, `is_published`.
- `preflight_interaction_reports` — one row per student per interaction
  (`UNIQUE(student_id, interaction_id)`). Stores the report as an inert Markdown blob
  (`report_markdown`, capped at 100 KB), plus an optional `report_data` JSONB for future
  structured fields. Course/section are **not** stored — derived by joining to the student.
- View `interaction_reports_by_section` — joins reports to the student's section for the
  analysis skill.
- RLS: students may only write rows bound to their own `auth_user_id`; directors/admins
  read all; instructors read their own sections.

**New pages:**
- [`interactions-admin.html`](site/interactions-admin.html) — director/admin page to add/edit
  (modal), publish, delete lessons, and view submissions. Submissions are picked by
  section → student dropdown (scales to ~1000 students; fetches one report at a time) and
  rendered as sanitized Markdown.
- [`interactions.html`](site/interactions.html) — student-facing list of published lessons with
  **Launch** links to the artifacts.
- [`interaction-submit.html`](interaction-submit.html) — receives the artifact's
  `#i=<slug>&r=<lz-string payload>` URL, requires student login, and upserts the report.

**Why these choices:**
- *Separate tables, not reusing `assignments`* — interactions may eventually replace
  assignments, but the existing tables are working in production and were left untouched.
- *Report stored as a blob, sanitized only on render (DOMPurify)* — DB data is never
  executed; XSS is a render-time concern. The `#r=` payload is user-controllable, so it's
  treated as untrusted everywhere it's displayed.
- *Data passed via URL hash, not POST* — GitHub Pages is static and can't process a POST;
  the hash also keeps payloads out of server logs/referrers.
- *RLS is the real gate* — `students.auth_user_id = auth.uid()` makes a spoofed
  `student_id` impossible to write, regardless of client code.

**Deferred (not yet built):** a home for the analysis skill's *output* (per-section trend
summaries). Options: a sibling `interaction_section_summaries` table, or mirror the
existing `assignments.analysis_report` JSONB pattern.
