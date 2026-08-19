# PREP Roadmap

**Status:** living document — reviewed 2026-07-22, revised same day with the course director's
decisions and a verification pass against the code. Unlike `docs/decisions/`, this file is
**refreshed, not superseded**. Update it as items land; do not fork a second copy.

> **Ordering convention (2026-07-22):** the priority bands (§1–§4) hold **open work only**.
> Finished items move to **[§8 Completed](#8-completed)**, grouped by the band they came from.
> They are moved, never deleted — most of them record a *decision*, and that is what stops a
> settled question being re-opened. Item numbers never change, so a reference to P0.9 still finds
> P0.9 wherever it lives. An item that is *partly* done stays in its band, because it still has
> work in it.

*Authored 2026-07-22 by Casey (via Claude). Consolidates the outstanding-work sweep of the repo
with the course director's feature requests and decisions. Companion to
[`operations/PREP-V2-CUTOVER.md`](operations/PREP-V2-CUTOVER.md),
[`../docs/app/LEGACY-AUDIT-2026-07-20.md`](app/LEGACY-AUDIT-2026-07-20.md), and
[`../CHANGELOG.md`](../CHANGELOG.md).*

> **Nothing in this file is authorization to build.** Items are scoped and ordered, not approved.
> Every item still passes through the CORE.md §0 coordination gate before it touches the live system.

---

## 0. The constraint that orders everything

**Fall 2026 opens 2026-08-10.** That is ~19 days from this writing. The roadmap is organized around
one question — *what must be true on the first day a cadet signs in* — and everything else falls
behind it.

A useful test for any item below: **if this is missing on day one, does a cadet or an instructor hit
a wall?** Grading, rollups, and rosters answer yes. The gradebook, EI logging, and Blackboard export
answer no — they are needed within weeks, not on day one.

**Priority bands:**

| Band | Meaning |
|---|---|
| **P0** | Ship-blocking for 2026-08-10 |
| **P1** | First weeks of term — needed while teaching, not at open |
| **P2** | Before end of term — grades must leave the system |
| **P3** | Between terms — new capability, needs design time |
| **C** | Cleanup / debt — no deadline, but it compounds |

**Size:** S ≈ hours · M ≈ a day · L ≈ several days · XL ≈ needs its own design doc first.

---

## 1. P0 — Ship-blocking for 2026-08-10

### P0.1 — Complete the v2 cutover (Phase 4) · ✅ **DONE 2026-07-28**

`site/app/` is gone: 109 files moved up to `site/`, the four legacy pages were deleted, and both
frozen contract URLs were verified byte-identical before and after. Record:
[`docs/operations/PREP-V2-CUTOVER.md`](operations/PREP-V2-CUTOVER.md).

**What the preparation got right, and what it missed.** The three findings below all held. What no
one had checked was everything *outside* `site/` that hardcoded a path *into* it — and that turned
out to be the bulk of the work: the doc index, two generator scripts, and **three** separate Node
test harnesses (`tests/app-schema/`, `tests/browser-harness/`, `tests/browser/`), the last of which
holds `<script src>` paths in HTML sandboxes that would have broken silently in a browser rather
than loudly in a runner. `promote_app.py` itself also had two latent bugs that only fire on a real
run; both are fixed. The general lesson: *the script moves files, and nothing else knows they moved.*

**Three things the preparation established that were not obvious:**

- **The move is safe.** Relative paths inside the tree survive, because the whole tree moves together
  and keeps its internal shape (`../css/styles.css` resolves correctly before and after).
  `legacyUrl()` — the one helper that pointed at the pages being deleted — has **zero live callers**;
  `nav.js` says so in a comment. The only references into `site/app/` from outside are the two
  forwarding stubs, which are exactly what gets overwritten.
- **It must move file-by-file, not directory-by-directory.** Four targets already exist in `site/`
  (`css/styles.css`, `js/config.js`, and both frozen stubs). `git mv` of a directory onto an existing
  directory **nests** it — `site/app/student` → `site/student/student` — which would leave the stub
  in place and the real receiver one level too deep: a silent 404 on the URL every deployed artifact
  posts to. The script plans 98 individual file moves and asserts both frozen paths are covered
  before it will run.
- **`site/app/*.md` should not be promoted to `site/`.** Seven internal design notes (the plans, the
  legacy audit, the admin inventory) are already world-readable at `site/app/*.md`; promoting them
  would put a file named `LEGACY-AUDIT` beside the student login page. They route to `docs/app/`
  instead — same repo, out of the published tree. `help/*.md` and `media/icons/ICONS.md` correctly
  stay, since the app serves them. **`docs/DOC-SOURCES.json` references some of the moved files and
  must be updated in the same commit.**

<details><summary>Original scoping</summary>

Phases 1–3 are effectively done (the `app` chain 007–009 is applied, `site/app/` reads `app`), but
the runbook was never refreshed and Phase 4 has not run. Remaining: promote the app tree onto the
frozen contract URLs, delete the legacy root pages, push.

- **Blocker:** the promotion deletes `site/admin.html`. Its replacements exist
  (`site/app/faculty/admin.html` Staff + Export tabs, shipped 2026-07-20), so this is no longer
  gated — but §5 of the legacy audit lists four surfaces that vanish undecided (see P0.6).
- **Hard rule:** `site/student/interaction-submit.html` and `site/faculty/lessons.html` must resolve
  identically before and after. If promotion cannot preserve them exactly, abort.
- **Also:** refresh `PREP-V2-CUTOVER.md:3`, the three `PREP-V2-*` doc status headers, and
  `CORE.md:38` — all still claim `app` is unwired.

</details>

### P0.2 — Seal `prep_app_owner`, and remove the test faculty account · **S**

`ALTER ROLE prep_app_owner NOLOGIN;` as `postgres`. Flagged three separate times in CHANGELOG and
never closed. **Human-only** — no agent role holds `CREATEROLE`. Do this *after* P0.1, since the
cutover may still need DDL.

**Sealing is also the moment the P0.5 test faculty account goes away.** Both are "close the door
behind you" steps and neither should outlive the verification pass.

**It is one step, not three.** Delete `prep.test.faculty@usafa.edu` in the Supabase dashboard
(Authentication → Users) and the app rows go with it: `app.instructors.id` references
`auth.users(id)` **ON DELETE CASCADE**, and `staff_assignments` cascades from `instructors` in
turn. Verified against `pg_constraint` on 2026-07-22, after an earlier version of this entry
claimed the opposite.

Then confirm nothing was orphaned — it is a safe no-op if the cascade did its job:

```
.venv/Scripts/python scripts/test_faculty_account.py --status
.venv/Scripts/python scripts/test_faculty_account.py --remove --commit   # only if --status found rows
```

*(Do not generalise the cascade: `app.students.auth_user_id` is **NO ACTION**. Deleting a cadet's
auth user fails rather than tidying up.)*

**Also delete the two dead auth users from the 2026-07-22 attempts** —
`befe1026-2034-4cbc-908d-911eb319cd03` (unconfirmed, from the signup probe) and
`bb18a447-a52a-41e4-abeb-0797777060d4`, if either still exists. Their app rows are already gone.
Worth doing sooner than the seal: **duplicate unconfirmed users on the same address are the most
likely reason the second account would not authenticate with a correctly copy-pasted password.**

## 2. P1 — First weeks of term

*Emptied 2026-07-27 — the last entry, P1.12's whole-section half, was **descoped by the director**
rather than built ([P3.17](#p317--whole-section-extension-grant--s--parked-not-planned) has the
reasoning; the shipped half is in [§8](#p112--bulk--whole-section-extensions---done-2026-07-22--remainder-descoped-2026-07-27)).
Reopened 2026-08-09 with P1.16.*

### P1.16 — A committed driver for the written grading path · **M** · *proposed 2026-08-09, undecided*

**The two halves of `/lesson-cycle` are tooled very unevenly**, and that asymmetry is the largest
variable cost in a nightly run:

| Half | Driver |
|---|---|
| Cohort aggregation | `supabase/admin/lesson_aggregate.py` — 109 KB; `pull` / `worklist` / `write-analysis` / `status` |
| Interactive grading | `supabase/admin/grade_interactive.py` — 18 KB |
| **Written grading** | **nothing committed** — `.ai/skills/preflight-analyze/` ships a SKILL and references, and no code |

So the written path's fetch → grade → upsert layer is **re-derived from prose on every run**. That
is where the risk sits, not just the time: a forgotten `Accept-Profile: app` header writes to the
retired `public` schema, and a forgotten finalized-grade guard overwrites a human's decision. Both
are one-line omissions that the aggregation and interactive drivers cannot make, because they were
written down once and reviewed.

**Build:** `supabase/admin/grade_written.py`, mirroring the existing two — `pull` /
`write-grades` (carrying the never-clobber-a-finalized-grade guard) / `status`. Stdlib-only and
dry-run by default, per CORE.md §2 and §4. Nothing about the **grading judgment** moves into code:
the three-state rule and the tailored `warn` feedback stay in `SKILL.md`, which is the half an agent
should be doing. Only the I/O is mechanized.

**Verify** by replaying the 2026-08-08 `preflight-03-training` M run and confirming it reproduces
those 36 grade rows exactly.

**What it does and does not buy.** Measured 2026-08-09: aggregation is near-flat with roster size
(12 scopes in the sandbox against 14 for a live phys-215 M night), while tailored `warn` feedback is
genuinely linear — roughly 72 individual corrections at 179 students and 115 at 285. **A driver
does not touch the linear half**, so do not expect it to make a large night short; it removes the
re-derivation and the two silent-failure modes. Nightly load is one course on one track (~200
students, worst case 285 on phys-110's T track): across 78 deadline slots only one has two courses
due, and it is phys-110 + phys-310 — not the two large courses.

**Why P1 and not C.** It is not debt; it is a missing third of the cycle's tooling, and the term is
running. **It is a proposal, not a decision** — raised when the director asked why a run was slow,
and not yet accepted or declined.

### P1.17 — Deadline enforcement, the database half · **S** (SQL) + the DDL ceremony · *directed 2026-08-17*

The client half shipped 2026-08-17 (see CHANGELOG): `commitSubmission()` and
`submitInteractionReport()` refuse a commit past the effective deadline + 120 seconds
(`GRACE_MS`, `site/js/schema.js`), re-fetched fresh at submit time. **Until a trigger enforces the
same rule server-side, this is a UI rule on the release-window pattern** — the REST API still
accepts a late write from anyone not going through those two functions, including a stale client
that predates the deploy.

Build: a trigger on `app.submissions` refusing `status → 'committed'` past the effective deadline
+ 120s, mirroring `effectiveDue()` precedence — extension (`revoked_at IS NULL`) →
`assignment_due_dates` row → `due_by_day` × the enrollment's section `meeting_days` → `due_at` —
with the grace as a literal named in the migration header as a copy of `GRACE_MS`. Instructors
keep their reopen path (the trigger gates the student transition, not staff writes). **Rides the
next coordinated DDL batch** (with the 2026-08-13 finding's §6.3 RLS repointing and §6.4 index),
per CORE.md §0: SQL + `_ROLLBACK.sql` to the director, applied as one event, `app_rls_test.py`
assertions both sides of the boundary.

### P1.18 — Push the rebuilt PHYS 310 Lab 1 into the artifact library · **S** · *handoff opened 2026-08-18*

**What is left is one upload, and it has a prerequisite that is easy to miss.**

> ### ⚠ BLOCKING: the rebuilt `.jsx` does NOT travel with the commit
>
> `_builder/courses/*/artifacts/*.jsx` is **gitignored** — it is a cache whose transport is the
> Storage bucket, not git. So a machine that pulls this commit gets the new `BUILD-LOG.md` entry
> (slug `…-11c49dbc`) and its own **stale** Lab 1 `.jsx` (slug `…-1f096984`).
>
> **Running `push` in that state fails silently and looks fine.** `build_payload` globs the local
> `.jsx` files and reads the slug out of each one, then looks that slug up in `BUILD-LOG.md`. The
> stale artifact's slug is no longer in the log, so the lookup returns `{}` and the library gets an
> index row with **no title, no grounding line, no published URL** — and the old build's content
> under the old slug. Nothing errors.
>
> **And CORE.md §1's claim that the repo "sits inside OneDrive" is stale for at least one machine:**
> the build machine's tree is NOT under %OneDrive% -- it sits directly off the C: root, outside
> any synced folder. Do not assume the file syncs by itself. Verified 2026-08-18.
>
> **So before pushing, make sure the pushing machine has the rebuilt file.** Check it:
> ```bash
> grep -c 11c49dbc _builder/courses/phys-310/artifacts/phys310_preflight_lab_1_measurement_of_half_life.jsx
> ```
> `1` means you have the rebuild; `0` (or a `-1f096984` hit) means you have the stale one and must
> copy the file across first.

**The simpler fix is probably to move the credential, not the file.** The rebuilt artifact and the
whole repo state already sit together on the build machine; what is missing there is one config
file. Dropping the service key into `~/.claude/skills/preflight-analyze/config.json` there — or
adding the `--as-staff` flag below — makes this a single command with nothing to transport and no
chance of pushing a stale artifact. The director asked for this to be picked up on the other
machine — the one that holds the DB credentials and did the original Storage import.

**What is ready** (all uncommitted as of 2026-08-18, see that date's CHANGELOG entry):

| | |
|---|---|
| `_builder/courses/phys-310/labs/` | **untracked** — the Lab 1 write-up and analysis workbook, plus a `README.md` transcribing what the workbook computes |
| `_builder/courses/phys-310/artifacts/phys310_preflight_lab_1_measurement_of_half_life.jsx` | rebuilt, 2327 lines, new slug `phys310-lab-1-measurement-of-half-life-11c49dbc`. **Gitignored** — it is a local cache, so it exists ONLY in this working tree until it is pushed |
| `_builder/courses/phys-310/artifacts/BUILD-LOG.md` | modified — the Lab 1 entry and the status summary |
| `docs/DOC-SOURCES.json` · `CHANGELOG.md` | modified |

**The one command:**

```bash
python scripts/artifacts/sync_artifacts.py push            # dry run: expect 3 changed, rest unchanged
python scripts/artifacts/sync_artifacts.py push --commit
```

**Expect exactly three objects to move** — `phys-310/<new slug>/source.jsx`,
`phys-310/<new slug>/build.json`, and `phys-310/index.json`. Everything else compares equal by
sha256 and is skipped.

**Two safety properties were verified on 2026-08-18 before the handoff, so they do not need
re-deriving:**

- **The review sidecars are not at risk.** `push` only ever *seeds* `<course>/review-notes.json`
  and refuses to overwrite one that already exists remotely — the site owns them after the first
  push. The director intends to mark objectives in the library, and doing so before or after this
  push is equally safe.
- **No published URL is dropped.** `index.json` is regenerated from `BUILD-LOG.md`, so a URL the
  site's Register panel wrote into Storage but nobody recorded in the log would be lost. Checked
  with the tool's own parser: phys-215 **29/29** present, phys-310 **3/3**. The only slug delta is
  the Lab 1 rename itself.

**Afterwards:** the old `phys-310/phys310-lab-1-measurement-of-half-life-1f096984/` object folder
stays in Storage as an orphan. It will **not** appear in the library — `index.json` is built from
the local `.jsx` files and there is only one Lab 1 — so it is dead bytes rather than a duplicate
row. Clear it with `purge` at some convenient point, not urgently. When the director has finished
marking objectives, `sync_artifacts.py pull-reviews --commit` brings those decisions back into git.

---

#### Why this could not be done here, which is the part worth keeping

**`sync_artifacts.py` reads a service-role key from `~/.claude/skills/preflight-analyze/config.json`
and nothing else** (`CONFIG_PATH`, and `_cfg()` has no environment override). That directory is
**empty on the OneDrive machine**, and that is not a setup gap — it reflects the move to scoped
access. What this machine holds is `supabase/admin/.env` (the three `prep_app_*` pooler roles and
the `PREP_TEST_FACULTY` staff login) and `supabase/admin/config.json` (`claude_code_recker`). None
of them can write a Storage object: they are Postgres roles, and object bytes do not go in over SQL.

**The route that works is a staff session, and it has been used before.** The 2026-08-14 push —
the backup-button republish — ran that way, by swapping the tool's single request function and
letting the rest of its logic run unchanged, which preserved the index derivation, the sha256 skip,
and the review-sidecar refusal. A staff session is also *less* privileged than the documented path:
it obeys migration 023's RLS instead of bypassing it, and `artifact-sources` admits a director of
any offering for writes.

**Attempting it on 2026-08-18 was denied by the agent harness's permission classifier** — reading
a password out of `.env` and POSTing it to `/auth/v1/token` is indistinguishable from credential
exfiltration from the outside, and the block is reasonable. It was not routed around. If the other
machine has the service key, none of this applies and the plain command above is enough.

**Follow-on worth doing, and this is the real lesson: the swap has now been needed twice.** A
committed `--as-staff` flag on `sync_artifacts.py`, minting a session from the `.env` login the way
the rest of the tooling already reads that file, would turn a per-incident monkeypatch into the
documented path. It would also let **CORE.md §3 stop pointing at a credential that is not on the
machine** — that table still lists `supabase_service_key` as the way in, which is what sent this
session down the wrong road to begin with. Small, and it removes a re-derivation from every future
artifact push.

**A machine fact that was not written down anywhere, and cost a wrong assumption to discover.**
The artifact library — the Storage import and every push since — was done from the DB-credentialed
machine, not this one. The director assumed otherwise. Both machines have the full repo, so nothing
in the tree distinguishes them; the difference is entirely in which credential files exist locally.
Worth folding into [`docs/operations/MACHINE-SETUP.md`](operations/MACHINE-SETUP.md) as a "which
machine can do what" note when someone next touches that file.

---

## 3. P2 — Before end of term

### P2.1 — Blackboard grade export · **L**

*Requested.* Grades must leave the system at term end, and there is no LMS export today —
`djGradebookProject` has none either (its exports are human-readable Excel), so **there is no
in-house precedent to copy.** This is novel work.

The director has offered to supply real Blackboard files. **Take them early.** The entire risk here
is column-header format and student-key matching, and both are answerable in an hour with a real
file and unanswerable without one.

Design notes:
- Match on the registrar student id, not name or email.
- Blackboard column headers encode the column id; a hand-built header will be rejected on upload.
- **Test with a throwaway Blackboard course before the real one.** A rejected or misaligned grade
  upload at term end is the highest-consequence failure on this roadmap.

Start this in P1 time even though it is due in P2 — the lead time is in the round-trip testing, not
the code. A direct API connection (rather than file exchange) is desirable but **not expected to
happen** (director, Q5); design for files.

### P2.2 — Full JSON backup, done properly · **M**

*Requested — and the existing one is real but incomplete.* `buildBackup()`
(`faculty-admin.js:242-272`) is correctly course-scoped and director-gated, and exports offerings,
enrollments, submissions, and grades. It **omits**:

- **`analysis_reports`** — every readiness summary, trend, recommendation, and quote selection. This
  is the most expensive data in the system to regenerate and the most important thing to back up.
- **`sections`** — `enrollments[].section_id` exports as a bare uuid with no code anywhere in the
  file, so section identity is unrecoverable from the backup alone.
- **`submission_activities`** — the interactive artifact rows.
- **`staff_assignments`** — who ran the offering.

Add those four. Then **verify a restore**, because a backup that has never been restored is a
hypothesis, not a backup.

### P2.3 — Data retention and archival policy · **S** (decision) · *director: TBD, add it*

How long do submissions live · who may read a prior term · when is `public` finally dropped (still
open in `PREP-V2-SCHEMA.md` §8) · what happens to a graduated cadet's record. FERPA-adjacent, and a
decision rather than a build. Route to `docs/decisions/` when answered.

### P2.4 — Confirm the course and term when an interaction report is submitted · **M** · *director: requested 2026-07-27*

*Director's framing: "it shouldn't be tied to the student being in only one offering or the right
semester — it should be tied to the submission having the right offering."* That is the correct
target, and most of it is already true. What is missing is the **confirmation**, not the link.

**A term column on `submissions` is NOT the fix, and would be a regression.** The link already
exists and is already enforced:

- `submissions.assignment_offering_id` → `assignment_offerings.course_offering_id` →
  `course_offerings (course_id, term_id)` (`001_core_model.sql:250-253, 333-345`). Course and term
  are one `JOIN` away and cannot be wrong.
- `submissions_unique UNIQUE (enrollment_id, assignment_offering_id)` and the matching constraint on
  `grades` (`:345`, `:407`) mean a student's work in Fall 2026 and their work in a sandbox or a
  retake are separate rows by construction.
- `submissions_activity_in_offering` (`:348-350`) is a **composite** FK into
  `offering_activities (assignment_offering_id, activity_id)` — a student cannot commit to an
  activity that is not offered in *that* offering. Structural, not conventional.

Adding `term_id` beside `assignment_offering_id` would create a second source of truth for one fact,
free to disagree with the first. That is the shape of the P0.15 bug (a role stored in two places,
one of them stale), and it would also require unsealing `prep_app_owner` — a coordination event
(CORE.md §0) — to buy nothing.

**The actual gap is that the offering is INFERRED from session state.** The artifact posts a bare
slug (`interaction-submit.html#i=<slug>`, a frozen contract that sends no course, term or student),
and `resolveActivityBySlug()` (`student-data.js:315-330`) resolves it with
`.eq('course_offering_id', ctx.currentOffering)` — whichever course the student's session happens to
be on. For a cadet in one offering that is always right, and it is deliberately not left to RLS
(the function says so). But it is silent: nothing tells the student, or records, *which* run of the
lesson they just submitted to.

**Build:**

1. **Resolve to a set, not to one.** Return every published offering of that activity the student is
   enrolled in, instead of filtering to `ctx.currentOffering` up front.
2. **Confirm before the write.** One offering → name the course and term on the confirmation card
   ("Physics 215 · Fall 2026") so the student sees the binding they are agreeing to. More than one →
   they pick, and Submit stays disabled until they do. Zero → the existing "nothing scheduled for
   you" state, unchanged.
3. **Record the choice** on the submission that is created, which is already where it belongs.
4. **Fix the same root cause in the tooling.** `interaction_reports.py::_locate()` matches
   `act.slug = %s AND e.student_id = %s` and takes `fetchone()` with no offering scope, so it would
   write `report_data` to an arbitrary one of a student's submissions. Verified 2026-07-27:
   **0 students are affected today**, because nobody yet holds two submissions for one activity.
   Give it the offering/term filter the other tools now have. `grade_interactive.py` is sound by
   contrast (it sweeps rows, each carrying its own `assignment_offering_id`) but has no `--term`, so
   a run currently reaches into the training sandbox as well — worth the same flag.

**No DDL. No change to the frozen artifact contract** — the artifact keeps posting a bare slug; all
of this happens on the receiving page, which is exactly where the student is present to answer.

**Why P2 and not later.** Nothing is broken today. It breaks the first time one student holds two
enrolments that share an activity, and there are three ways in: a Spring 2027 offering standing up
while Fall 2026 is still `is_active`, a cadet repeating the course, or a real cadet added to the
training sandbox for a demo. The first of those is planned *before* end of term. Measured
2026-07-27: **3 active offerings, 37 assignment slugs live in more than one of them, 34 slugs
present in two courses** — the ambiguity is already the normal case, and only the per-student half
is still clean. Related: [P3.4](#p34--term-rollover--l--director-yes).

---

## 4. P3 — Between terms

### P3.1 — Course creation by instructors · **L**

*Requested.* Two halves:

1. **Any instructor can create a course and becomes its director.** Mechanically small; the
   governance question is whether an offering minted by anyone is acceptable. Recommendation: allow
   it, scoped so the creator gets `director` on **that offering only**, and system admins retain
   visibility across all.
2. **A create flow from the dashboard.** `djGradebookProject`'s pattern is directly portable: a grid
   of course cards where **the last card is a dashed-border "＋ Add New Course"**, the selected course
   carries a badge, and inactive courses collapse into a separate low-opacity section.

Two behaviors from its `Course.save()` worth stealing: **derive the code and semester from raw
inputs** rather than asking for them, and **auto-provision defaults on create** so a new course is
never left unconfigured.

Depends on `003_term_calendar.sql` semantics — a new course needs a term, sections, and a director
staff assignment created atomically.

### P3.2 — One import pipeline, several adapters · **XL** · *needs a design doc*

*Requested as three items — Gradescope, Teams, "other sources". Propose treating them as one.*
**Import-only** (director, Q5).

`djGradebookProject` has four importers (roster, Teams, Gradescope, WebAssign) sharing **one flow**,
and that flow is the most reusable architecture in that project:

> **parse → preview (with an explicit unmatched-students list) → confirm → commit**

with format auto-detection by column sniffing, and the staged import abandoned on navigation away.
Its Gradescope adapter matches on `SID`; its Teams adapter matches on email and maps a `Tag` column
onto an assignment category.

Three things worth copying exactly:
- **The unmatched-students list is the whole point of the preview.** Every import fails the same
  way — a handful of students do not match — and surfacing that before commit is what makes it safe.
- **Due-date-aware semantics:** its WebAssign importer only marks an assignment graded once its due
  date has passed, and only converts "not submitted" sentinels to zeros after the due date. Without
  that rule, importing mid-term tanks every average.
- **Name-pattern inference** — `"Preflight 7 - Vectors"` → `PF07`, type `Preflight`.

Two things **not** to copy: pickling staged imports into the session, and building preview HTML by
string concatenation server-side.

PREP's roster importer already has the right bones — `roster-import.js` is pure, DOM-free, and
unit-tested. Generalize it into an adapter interface rather than writing three more importers.

### P3.3 — Artifact flag taxonomy · **M**

*Requested.* A canonical enumerated list of flags the artifact should apply, made available to the
artifact-factory skill in the Claude project. **Do P1.13 first** — the unknown-flag container makes
this work observable.

`flags` is already a field in the frozen `schema: 1` contract
(`docs/contracts/INTERACTION-DATA-CONTRACT.md`), but the **values are not enumerated** — so the
artifact invents them and `/lesson-aggregate` cannot aggregate across lessons.

**The real problem is synchronization.** The artifact-factory skill lives in a Claude project,
outside this repo. A taxonomy maintained in two places will drift, and the drift is silent — the
artifact keeps emitting flags nobody reads.

Recommendation: **the repo file is the source of truth**, the Claude project references it by URL
(the raw GitHub Pages path is stable), and the file states its own version. Adding a flag is
additive and never removes one, because deployed artifacts outlive the taxonomy that made them.
Per the director's Q4 decision, the aggregator **surfaces** unknown flags rather than erroring or
dropping them.

### P3.4 — Term rollover · **L** · *director: yes*

Fall 2026 will end and Spring 2027 will want the same lessons with a new roster and new deadlines.

**Verified — cross-term reuse already works, and is automatic.** The three-layer model does it:
`assignments` is the term-agnostic container (`001_core_model.sql:130-133`), `activities` holds
content (`:139-155`), and `assignment_offerings` is one term's run (`:272-275`). Scheduling the same
assignment into a new course offering reuses the same activities. The library picker at
`lessons.html:337-349` is the UI, and it correctly offers only assignments not already scheduled
this term. Past cohorts are protected by `content_snapshot`, frozen at publish (`:265`, `:276-279`).

**So the director is right that reuse is handled.** Two real gaps remain:

- **No duplicate/clone.** Confirmed absent from `site/app/`, and already a known gap
  (`docs/app/README.md:94`, `PLAN-2026-07-16-ADMIN.md:45`, legacy had `duplicateAssignment`). Reuse
  ≠ making a *variant* of a lesson.
- **No rollover flow.** Creating next term's offering, scheduling 40 assignments into it, and
  recomputing 40 deadlines is currently the term-specific
  `scripts/fall2026/build_fall_preflights.py`. Generalizing that is the actual work.

*(A question bank is **not** wanted — director's call. The library picker is the reuse mechanism.)*

### P3.5 — Grade audit log · **S** · *mostly built already*

*Director: yes, and instructors should be able to correct any grade.* Verification found most of
this already shipped:

- **`grade_events` audit rows are already written** on finalize and reopen
  (`faculty-grade.js:290-296`, `:302-311`).
- **Provenance is already tracked** — `grades.source` (`'instructor'` vs `'ai_suggested'`),
  `graded_by`, `graded_at` (`faculty-grade.js:257-260`), stamped only when that student's card was
  actually edited (a fixed bug, documented at `:205-221`), and surfaced as a tag at
  `grade.html:227-230`.

Remaining: cover plain saves (not just finalize/reopen), and give the director a readable view of the
trail. Small.

**On manual correction** — an instructor today cycles a 3-state toggle (`grade.html:294-298`); there
is **no numeric field.** On the current 2-point scale that toggle already spans the whole achievable
range (0 or the question's 1 point), so **nothing is actually unreachable today.** It becomes a real
gap the moment a non-preflight assignment type with a wider range exists — so tie the numeric
override to P1.1's gradebook work rather than building it now.

### P3.6 — Accessibility pass · **M**

Bundle with the gradebook, because a dense grid is where accessibility problems become severe:
keyboard navigation, focus order, screen-reader table semantics, contrast in both themes.

P1.10 shipped 2026-07-23 with **both** a drag target and a per-tile dropdown, for exactly this
reason — drag-only is a keyboard trap. That is a floor, not a pass: the dropdown is reachable and
labelled, but the coverage grid has not been walked with a screen reader, and the Grade queue's cards
(P1.14) are `<button>`s in a scrolling strip whose focus order nobody has checked.

### P3.7 — Performance budget · **S** to **M**

`loadRoster` fetches every student in the database and filters client-side
(`faculty-roster.js:11`) — noted in the plan as "fine today; won't be." The gradebook is what makes
it not fine. Set a target (e.g. any faculty page interactive under 2s with 400 students across 40
lessons) before building the grid, not after.

### P3.8 — Mobile and tablet · **M**

EI logging is the forcing case, and P1.4's bulk-logging use case sharpens it: an instructor logging
six students at the end of class is standing up, not sitting at a desk. If that flow is desktop-only
it will not be used. Decide which flows are mobile-first and design those; the rest can stay desktop.

### P3.9 — RLS for scope and cross-section reads · **M**

P0.4 fixes a privacy rule in the UI. `analysis_reports` admits any staff member of the offering, so
several director-only conventions (`__all__`, the run banner's director filter) are UI-only. Decide
deliberately which should be enforced in the database. Some genuinely should stay conventions; the
point is that today it is not a decision, it is a default.

**⚠️ Added 2026-07-23, found while building P1.11 — this is now the sharpest instance of the same
problem, and it wants the director's decision.** Nearly every staff member holds an **offering-wide**
`staff_assignments` row (`section_id IS NULL`): `create-instructor` inserts one by default and
`setRole()` guarantees it exists. `app.staff_sections()` expands that to *every* section of the
offering — so as configured today an ordinary instructor can read every section's submissions and
grades, not just their own. Section-scoped rows are still doing real work, but it is **UI scoping**
(`taughtSectionIds()`, "my sections", and now the due-out row and the Grade queue), not access
control. Either that is intended and should be written down, or the default row should stop being
offering-wide for a plain instructor — which is a one-line change in the edge function plus a
backfill, and is a **privilege change, so it is the director's call, not an agent's.**

### P3.10 — Ephemeral "View as instructor" toggle · **M** · *director: yes*

A system admin or director previews a course as a lower tier. **Session-only, never persisted**, with
a visible banner naming the active view and a one-click exit.

The reasoning for keeping it ephemeral (rather than a stored access level) is recorded in §6 Q1 —
briefly: RLS grants on the *actual* role, so a persisted downgrade would be cosmetic while the API
still returns everything, and building something that looks like a safety boundary but is not one is
worse than not building it.

The account page grows a read-only **"courses I'm involved with"** panel alongside it — `account.js:70-119`
already renders most of that data.

### P3.11 — Course report generator (midterm + final) · **L** · *conditional*

*Director: needed if we ever transfer all grades in.* Merges three ideas — grade reports, progress
checkpoints, and Order of Merit — into one deliverable, because they are one screen.

`djGradebookProject`'s report is the model: columns `OM | Name | Score | Grade | GPA | [Prog Score |
Prog Grade] | <per-category totals> | Total`, sorted by score descending with rank inserted as `OM`.
Generating a report **freezes a `Checkpoint` row per student** (`prog` / `final`), and the final
report reads the prog checkpoint back so movement is visible. Below the roster it appends class
stats and a term-over-term GPA history for the same course code.

**Gated on the gradebook holding more than preflights.** Until then there is nothing to report on.

### P3.12 — Students-at-risk widget · **S** · *conditional*

*Director: yes, but not until the gradebook holds all content, not just preflights.* Possible earlier
partial: trigger on low understanding across multiple consecutive preflights — the data for that
exists today in `grades.diagnostic`, though the director is unsure it is a good signal. Worth a look
once a few lessons of real Fall data exist.

Take `djGradebookProject`'s transparency: it **displays the criterion** (`<70% or 3+ missing`) as the
widget subtitle. Showing the rule is what makes the list trusted rather than argued with.

### P3.13 — Student nudges for due work · **S** · *lower than assumed*

*Director: "they should really see all of that clearly in their dashboard."* **They already do.**
Verified: `student/dashboard.html` has four stat tiles (To do / Missed / Points / Graded), an
"Up next" section, a "Needs attention" section rendered only when non-empty, and seven distinct
states in `student-lessons.js:31-39` — including `MISSED` (red, past due with nothing submitted) and
`DRAFT` (amber, saved but not submitted).

So the dashboard requirement is met. An active nudge is a genuinely separate feature, and since
there is no SMTP and never will be, it can only be in-app — which means it only reaches a student who
already opened the dashboard that shows the same thing. **Low value; keep it parked** unless
non-submission rates say otherwise once the term is running.

### P3.14 — Random groups generator · **S** · *director: nice to have*

Shuffle a section into N groups or groups of size N. Small, self-contained, genuinely used in
`djGradebookProject`.

### P3.15 — Color palette theming · **S** · *director: very low priority*

`djGradebookProject` does seven palettes in pure CSS custom properties, zero framework, as
`body.palette-x { --color-accent: … }` overrides. PREP's `DESIGN.md` is already token-based so it is
nearly free — but it is polish. Last.

### P3.16 — `/feedback-triage`: roll accepted feedback into this file · **M** · *requested 2026-07-23*

*Director's request, deliberately deferred when the resolution matrix was built the same day.* The
collecting and the deciding both shipped 2026-07-23 — the in-app feedback box (migration `012`) and
the site-admin **resolution matrix** at `site/faculty/feedback.html` (migration `013`). What is
missing is the last hop: an accepted comment still has to be written into this file by hand.

**The input contract already exists and is enforced, so this skill starts from a fixed point:**

```sql
SELECT * FROM app.feedback WHERE status = 'accepted' AND roadmap_ref IS NULL;
```

That is the whole work list — "agreed to, not yet written down". Stamping `feedback.roadmap_ref`
with the id this file gives the item (`P3.17`, …) is what removes a row from it, permanently. Three
properties of that contract were built specifically so a skill could rely on them, and none should
be renegotiated:

- **There is no `roadmapped` status.** A status would have to be kept in step with this file by
  hand; `roadmap_ref IS NULL` cannot drift from the thing it describes.
- **A CHECK confines `roadmap_ref` to accepted rows**, so a declined comment can never appear in the
  work list however the column is written.
- **A blank ref is stored as NULL, never `''`** — an empty string looks correct in the UI while
  silently failing `IS NULL`, which would strand the item forever. There is a test pinning it.

**What the skill has to decide, and why it is not trivial.** Reading the rows is the easy half. The
judgment is *placement*: several accepted comments are usually one roadmap item, a comment often
restates an item that already exists (the honest outcome is then `duplicate`, not a new entry), and
the band matters — feedback arrives as "this is annoying", not as "this is P2". Expect the skill to
propose, and a human to approve, rather than to write straight into this file.

**Do not let it write unattended.** This file is the planning record for a live system; a skill that
appends to it on a schedule will eventually invent an item nobody agreed to. Same posture as
`/lesson-cycle`'s: the skill drafts, the human lands it. Writing the `roadmap_ref` back is the one
step that *should* be automatic, because it is bookkeeping, and forgetting it means the item is
proposed twice.

**Falsification:** if the first month's accepted comments turn out to be mostly one-liners that map
one-to-one onto existing items, this is a `sed` script wearing a skill's clothes and should be
dropped in favour of doing it by hand in the matrix.

Depends on: nothing further — the data and the matrix are live. See `.ai/skills/docs-author/` before
adding it, and `CORE.md` §4 for where a runbook lives.

### P3.17 — Whole-section extension grant · **S** · *parked, not planned*

*Was the open half of [P1.12](#p112--bulk--whole-section-extensions---done-2026-07-22--remainder-descoped-2026-07-27).
Moved out of P1 on 2026-07-27 by the director, who does not think it is needed.*

The idea was a grant that covers an entire section without going through the not-submitted list —
extending everyone after a cancelled class, including students who already handed in. **Three
reasons it is not P1 work, and possibly not work at all:**

- **The event it exists for is a section-wide one, and a section-wide event is a due-date change.**
  If a class is cancelled, the deadline moved; editing `assignment_due_dates` for that section says
  so directly and reads correctly to every student, rather than manufacturing 18 per-student
  exceptions to a date that is no longer the real date. Extensions are the per-student mechanism
  and the per-section override already exists beside them (`effectiveDue()` precedence: extension →
  section → offering).
- **A single section receiving a genuine blanket extension is not an expected event** (director).
- **The rollup already reaches a whole section anyway.** Select-all on the "Did not submit" panel
  covers every student who has a reason to want one; the only people it misses are those who
  already submitted, who by definition do not need more time.

**Falsification — what would bring this back:** a term in which somebody actually reaches for it
and finds the due-date edit wrong for their case. The likeliest such case is a section-wide
extension that must be *auditable as an exception* — `extensions` carries a NOT NULL `reason` and
grant/revocation provenance, and editing a due date carries none of that. If a chain-of-custody
question ever lands on a moved deadline, this becomes real; until then it is a second way to do
something there is already a right way to do.

If it is ever built, `faculty/extensions.html` is the home — that page is still **read + revoke
only**, and a page that can revoke in bulk but not grant is the asymmetry that would make the case.

### P3.18 — Agent swimlanes: bounded roles instead of one general agent · **XL** · *director's proposal 2026-08-14, undecided*

*Director's proposal, raised as "I suspect there is a lot of crossed wires due to the wide range of
instructions in this project." Recorded here in full — plan, rewards and risks — because the first
increment is cheap and the last one is not, and the difference is the whole decision.*

**The proposal as raised:** define lanes an agent stays in — **web** (site features and bugs),
**database**, **artifact builder**, **grader**, and a **researcher** that works an issue list — plus
a **mastermind** as the default entry point that identifies which lanes a task needs, dispatches
them sequentially or concurrently (asking first, if concurrent), and combines the results. A human
who already knows what they need may invoke a lane directly.

**The diagnosis is right; the mechanism is worth restating.** Always-loaded context is ~1,050 lines
(`CORE.md` 533 + `PROJECT.md` 496 + wiring), which is heavy but survivable. The sharper problem is
that CORE.md is a **hazard list whose hazards are unevenly relevant**: a grading run does not need
the CRLF/`.gitattributes` trap, the Jekyll underscore rule or the builder's sharp-edges table, but
it does need §0 shared state, §3 secrets and §5 CHANGELOG. There is a real core-vs-lane split
available.

**The reframe that makes it worth building: a lane is a capability boundary, not a prompt.**
Instruction overload is a soft problem addressed with better prose. A verifier lane defined with no
Edit/Write tool is *structurally* incapable of the failure it exists to avoid. That is the part
prose cannot buy, and it falls out as a permission matrix:

| Lane | Live DB | Repo writes |
|---|---|---|
| Grader | writes `grades` (standing authorization, CORE.md §5) | CHANGELOG + run record |
| Database | **no autonomous DDL** — emits migration SQL for the director (CORE.md §0) | migrations + docs |
| Web | read-only | `site/` |
| Artifact | none | `_builder/` |
| Verifier | read-only | a finding's status line |

**Three of the five lanes already exist. Do not rebuild them.**

| Lane | Already is | Remaining work |
|---|---|---|
| Grader | [`lesson-cycle`](../.ai/skills/lesson-cycle/SKILL.md) → [`preflight-analyze`](../.ai/skills/preflight-analyze/SKILL.md) (1,110 lines) → [`lesson-aggregate`](../.ai/skills/lesson-aggregate/SKILL.md) | a dispatch entry |
| Artifact | `_builder/preflight-kit/skill/preflight-factory-v2/SKILL.md` (2,432 lines) + [`gemini-port`](../.ai/skills/gemini-port/SKILL.md) | a dispatch entry |
| Researcher | [`docs/findings/`](findings/README.md) — the lifecycle, the fixer-is-not-the-finder rule, the PII rules and the falsifiability requirement are all already written and enforced | name it **verify-finding**, not "researcher", so its deliverable is a status transition rather than an essay |
| **Web** | **nothing** | the real gap |
| **Database** | **nothing** | the real gap |

**Rewards.** A bounded brief on a bounded blast radius; tool restrictions that make a read-only lane
provably read-only; the option of worktree-isolated concurrency for genuinely independent work; and
a lane roster that tells a *human* where a task belongs, which is most of the value even if no agent
ever routes anything.

**Risks, in the order they will actually bite.**

- **Every recorded disaster in this repo is cross-lane, and specialization hides that.** The
  effort→points curve has **six copies that must agree** — one DB trigger and five display-side, so
  a web lane that fixes the display desyncs the gradebook. The deadline hour lives in **three places
  that must move together**, one of them a frontend file. `LOOKAHEAD_DAYS = 7` has copies in JS and
  in three help docs. The `due_by_day` incident was database + grading + a frontend constant + a
  human decision, in one event. **Mitigation:** a short set of cross-cutting invariants restated in
  *every* lane file. The duplication is correct; the alternative is a specialist confidently editing
  one copy of an invariant it cannot see.
- **Concurrency collides with CORE.md §0 rule 4** — *"never run two agents in the same working
  tree"* — and subagents share the working directory by default. So concurrent lanes must be
  read-only *or* worktree-isolated, and any live mutation still designates one operator. The
  director's instinct to require approval before running concurrently is right and should be made
  stricter than requested.
- **N lane files is more instruction, not less**, unless each lane file is a *complete* brief. The
  design rule that keeps this honest: **an agent should read CORE.md §0/§3/§5 plus one lane file,
  and nothing else, and still do the job.** A lane that cannot meet that is drawn wrong.
- **Handoff is lossy.** A subagent returns a report, not its reasoning, and this repo is unusually
  invested in recording *why*. Lanes must write to the repo — findings, CHANGELOG, decision docs —
  not merely back to a caller.

**Skills or agents — the fork, and how to take it without breaking a rule.** CORE.md §4 forbids
`.claude/skills/` and `.agents/skills/` mirrors, and the shared skills are correspondingly
agent-neutral; note they are read on demand by convention rather than surfaced by any harness's
skill listing. Claude Code subagents, however, need `.claude/agents/*.md` frontmatter (model, tool
restrictions, worktree isolation), which is inherently vendor-specific. **Resolve it the way the
repo already resolves it for instructions:** the lane brief lives once, agent-neutral, under `.ai/`;
`.claude/agents/*.md` is thin wiring that names the brief and supplies only the frontmatter — the
same relationship [`CLAUDE.md`](../CLAUDE.md) has to [`CORE.md`](../.ai/instructions/CORE.md). That
buys capability boundaries without a content mirror.

**Do not split CORE.md to feed the lanes — not initially.** Its power is that it is one file
everyone reads; splitting it can produce exactly the drift it exists to prevent. Lane files should
*point into* CORE sections and add lane-specific material. Revisit only if the diet turns out to be
the binding constraint.

**Build the mastermind last, and possibly not at all.** A router must know enough about every lane
to route, so it either carries a summary of everything — rebuilding the overload at the top — or
routes badly; and it adds a hop to every task, including one-line fixes. The proposal already
contains its own cheaper alternative: *a human may invoke a lane directly*. **With well-named lanes
the director is a better router than a model**, at zero overhead. Build the mastermind only if
dispatch proves to be the friction, which is a question the lanes themselves will answer.

**Sequence.** (1) **web** and **database** lanes — the two that do not exist and where the incidents
cluster; each is **M** and independently useful. (2) **verify-finding**, against the existing
`docs/findings/` lifecycle — **S**. (3) dispatch entries pointing at the grader and artifact skills
— **S**. (4) mastermind, **L**, conditional on (1)–(3) proving the need. Author each through
[`skill-author`](../.ai/skills/skill-author/SKILL.md), which is already the gate for whether a
procedure warrants a skill — the proposal should pass its own repo's test rather than route around
it.

**Falsification — a cheap diagnostic to run before any of it.** Classify the last ~20 CHANGELOG
entries and the open findings by whether a lane would have **prevented** the mistake or **caused**
it. This repo is documented well enough that the answer is retrievable. If most of them are
cross-lane — and the `due_by_day`, six-copies and `LOOKAHEAD_DAYS` cases suggest they are — then
crossed wires is a symptom of *shared invariants*, not of role confusion, and the money goes into
an invariant registry instead of a lane roster. If the classification instead shows repeated
lane-local errors (a grading run breaking site markup, a web change touching a migration), the
lanes are the right instrument and the first two should be built at once.

Depends on: nothing. It touches no live data and no schema. **It is a proposal, not a decision.**

---

## 5. C — Cleanup and debt

**Cleared 2026-07-22:** `PROJECT.md`'s `question_scores` example (now `grades.question_scores` at
0/1/1, with an explicit warning not to "correct" the 0–5 diagnostics alongside it) ·
`LESSON-UNIFICATION.md` supersession banner · `COURSE-ADMIN-INVENTORY.md` §2D and its stale
port-status rows · `docs/app/README.md` "Not yet ported" · `student/interactions.html` deleted.

| Item | Where | Note |
|---|---|---|
| ~~⚠️ **`check_doc_sources.py` is red — 7 documents flagged**~~ | run it | ✅ **CLEARED 2026-07-27 by reading all 7, not by bumping dates.** Five were wrong and were **fixed**; two (`help/README.md`, `docs-author/SKILL.md`) were current and were bumped. **The exercise was worth more than the red check suggested — the sources were wronger than the documents.** `CORE.md` still said schema `app` was "not yet wired to any page" when every page under `site/app/` has read it since 2026-07-21, which is also why `PREP-V2-CUTOVER.md` still announced itself as never executed. `PROJECT.md` still listed `misconception_trends` as a live output — retired 2026-07-22 — and still described the readiness summary as per *section* when it is per *instructor*, in an example whose shape the writer would now **reject as a validation error**. Both were corrected, which cascaded to four more help docs; those were read too. Full account in the CHANGELOG. **Three findings worth keeping separately:** (1) migration 015's auto-final interactive grade contradicted the *student-facing* promise "nothing reaches you until a person has looked at it" — the same claim was caught in `instructor-grading.md` on 2026-07-23 and the student page was missed; (2) `director-schema-reference.md` told a director that switching `grading_mode` to `effort` was "a teaching decision", which is the exact change P0.14 identifies as zeroing every written taker — and it could never have been flagged, because its source list **stopped at migration `013`** and the semantics changed in `014`; (3) `SYSTEM_GUIDE.md` told anyone deploying from scratch to deploy **two** edge functions when there are five, so both password paths and account provisioning would silently be missing |
| ~~`lesson_aggregate.py` misdiagnoses a cross-course slug collision as a stale offering~~ | `supabase/admin/lesson_aggregate.py` `_ambiguous_slug_message` | ✅ **FIXED 2026-07-22.** The message now splits the two cases: same-term/different-course lists each course with its course-scoped activity slug and says *do not deactivate either one*; different-term keeps the deactivation advice, which is correct only there. Covered by `aggregate_summarize_test.py` |
| ~~`status --lesson` cannot report a question-only lesson~~ | `supabase/admin/lesson_aggregate.py` `cmd_status` | ✅ **FIXED 2026-07-22 — and it was worse than recorded.** The join was *inner*, so written-only offerings were absent from the **unfiltered** listing too, not merely unfilterable. Since most of a term is written-only, `/lesson-cycle`'s verify step was reporting "No analysis_reports rows yet" for lessons that had aggregated fine. Now keyed on the assignment, with activities resolved by offering id so a shared slug cannot abort the listing. **Not yet run against the live DB** — needs a connection |
| ~~⚠️ **The dashboard ignores extensions when computing status**~~ | `faculty-data.js` `buildLessonRows` | ✅ **FIXED 2026-07-27.** It called `effectiveDue(offering, sectionId, **null**)` — the extension argument hardcoded — so a student holding an active extension showed as `overdue` on the dashboard, in the outstanding-tasks panel and in the due-out row. The loader now fetches `extensions` (filtered `revoked_at IS NULL`, three columns) alongside submissions and grades in the same chunked pass. **The row-building was extracted into a pure exported `buildLessonRows()`, which is the actual repair**: the rule was unreachable to a test because it lived inside an async loader needing a faculty session, which is why it survived being found *twice*, months apart, without ever being caught. `test-dashboard-rows.mjs` pins it at 12 checks, counterfactuals included (an expired extension, one belonging to another offering, one belonging to another student). `faculty-gradebook.js`'s header cited this bug as its reason for not reusing the dashboard loader; that comment is now corrected to the reason that actually remains, which is payload size |
| ~~⚠️ **A generated file was hand-edited, and the check that exists to catch that went red**~~ | `site/js/db-schema.js` | ✅ **RESOLVED 2026-07-27** — *and it is the single failing check in `tests/app-schema`, not a pre-existing mystery.* The 2026-07-23 `enrolment` → `enrollment` sweep edited four strings inside `db-schema.js`, whose header reads **"GENERATED FILE. Do not edit by hand."** Those four are copies of Postgres `COMMENT ON` text, so the sweep corrected the copy and left the original — and `gen_db_schema.py --check` correctly reported the file as stale from that day on. Regenerated (it now matches live and reads `enrolment` again), with the real correction filed as **`supabase/migrations/app/016_comment_spelling.sql`, written and deliberately NOT applied**: `COMMENT ON` is DDL and `app` is sealed (CORE.md §0). Four comment strings do not justify unsealing; fold it into the next window that opens for another reason. **Worth generalizing:** a sweep that matches on a word will hit generated files, and a generated file is the one place where being right about the text is being wrong about the source |
| ⚠️ **The migration-006 submission-lock assertions have stopped running, and the suite reports it as one failed check** | `tests/app-schema/test-student.mjs:155,215` | Found 2026-07-27 while applying migration 016. `test-student.mjs:155` needs an offering the **test cadet's dashboard** shows as `isChoice` with both a written and an interactive activity; it finds none and fails with `found an offering with two graded activities`. **The data is not the problem — 34 published offerings carry two graded activities** (`preflight-02` … `-41`, verified live), so this is the test's own selection path, not the term's content. **It matters more than one red check looks:** everything gated behind that `if` is the *security* half of the file — that a student cannot unlock their own committed submission, cannot attribute an unlock to an instructor who did not perform it, and cannot reopen a commit by reverting `status` to draft. Those are the two bypasses migration 006 closed, and they are currently **asserted nowhere**. The `else` branch failing loudly rather than skipping is the design working; it is why this was visible at all. Fix the selection, do not delete the branch |
| Scope control is now copied in **three** places | `report.html` `renderScope()` · `faculty-dashboard.js` `scopeControl()` · `gradebook.html` | `faculty-dashboard.js:230-241` said extraction becomes worth arguing for at the third caller. It has arrived. Deliberately **not** done in the P1.1 pass: refactoring two shipped, browser-verified surfaces in the same change that adds a third is how you break all three at once. Extract into a shared module as its own change, with the existing suites green before and after |
| All three `prep_app_*` roles carry `BYPASSRLS`, including the SELECT-only read role | CHANGELOG:704 | The read role should not bypass RLS |
| `main` predates the `extensions.reason` NOT NULL constraint | CHANGELOG:706-709 | Harmless today (zero extensions); resolved by P0.1 |
| Edge functions never exercised on a successful path | CHANGELOG:473-475 | Covered by P0.5 |
| Remove `scripts/training/seed_training_preflight02.py` data | script header | **Before the real roster upload** — ordering matters. Sharper than recorded: the seed draws from a small template pool, so **16 distinct answers are shared by up to 4 students each**. The rollup's showcase panel therefore renders visibly duplicate quotes (seen during P0.5), which reads as a sampler bug and is not one |
| **Three** help docs still carry the "Starter stub" blockquote | `admin-system-operations.md` · `ai-and-your-work.md` · `director-ai-rules.md` | Was recorded as five, and the skill said "every current help doc" — both wrong as of 2026-07-27 (there are 8 served docs; 5 have been expanded). Corrected in `docs-author/SKILL.md`. All three had real errors fixed in them on 2026-07-27, so the remaining work is **expansion and the director's review of the wording**, not correction. `ai-and-your-work.md` is the one that matters — it is the student-facing promise about AI, and it is now the only page that tells a cadet a graded interactive lesson scores itself with no human in the loop |
| `$PREP_CONFIG` neutralization (decided, not executed) | CORE.md:162-165 | One coordinated PR across every script + skill + doc |
| phys-310 has no `SCHEDULES` entry in `set_due_dates.py` | `scripts/fall2026/set_due_dates.py` | Found 2026-08-17: its 4 offerings have populated `due_by_day` but **no automated syllabus cross-check exists for them** — the detector that caught both 2026-08-09 incidents cannot see this course. Adding the course is one dict entry once its schedule source is in hand, never a fork of the file |
| ~~The test cadet (3009999999) cannot sign in~~ | `tests/app-schema/harness.mjs` · `tests/browser-harness/pass.mjs` | ✅ **RESOLVED 2026-08-17, same day — and the guess was wrong.** Not a stale rotation: the director had signed in with the last-6 default and been forced to pick 8+ characters (Supabase minimum), so the account's real password is the **last EIGHT digits of the id**. Both hardcoded copies now carry it and name each other. The live suites and the student browser pass ran the same day — first time since the rotation |
| ~~A live student session sees sections of offerings they are NOT enrolled in~~ | `tests/app-schema/test-isolation.mjs` | ✅ **DIAGNOSED 2026-08-17, same day — NOT an RLS problem, and the real finding is worse.** `sections_read` is working exactly as designed (a student sees every section of each offering they are actively enrolled in, which per-day deadline resolution requires): 21 = the training sandbox's 4 + **live phys-215 fall-2026's 17 — because the ZZ Test Cadet has held an ACTIVE enrollment in live section M3A since 2026-08-05.** Zero submissions and zero grades sit on it, but the cadet has been **excluded from three closed lessons' grading by an unidentified mechanism** — 18/18 real M3A cadets graded or zeroed each night, the test cadet never, and no `analysis_runs.detail` key records a test-account skip. An exclusion nobody wrote down is one forgotten judgment call away from a synthetic cadet in the live gradebook and cohort denominators. **Decision owed (director): drop the live M3A enrollment** — recommended; it has nothing attached and the sandbox exists for exactly this — or bless it in writing and re-derive `test-isolation.mjs`'s bound. The hardcoded `<= 4` was a working canary and should stay hardcoded |
| No spacing/size scale token — padding is hand-tuned px | DESIGN.md:487-491 | Radius, shadow, color are tokenized; spacing is not |
| Section lifecycle CRUD (create/rename/retire) | PLAN-2026-07-16-ADMIN.md:236-237 · `faculty-roster.js:325` | Sections are only ever born as a side effect of roster upload. **Half-built, found 2026-07-27:** `createSection()` is exported and has **zero callers** — the working path is `createSections()` (plural), which the import calls with the codes the file referenced. So the function exists and no screen reaches it. `admin-system-operations.md` listed "section creation" as a start-of-semester step until 2026-07-27; it is now documented as a consequence of the import, which is what it actually is |
| No AI-picked quotes on the **Student Free Responses** panel | `faculty/report.html` `buildFreeResponses()` | Added 2026-07-30 with the panel, and deliberately: `analysis.selected_quotes` resolves through the reading reflection, and the director's instruction was explicitly "for now, we won't touch the lesson cycle". So every card there is a random sample and the sub-heading says so. Making it real means `/lesson-aggregate` selecting from a **second** field, which is a change to a skill, to the `analysis_reports` payload shape, and to the resolver — not to this page. **Falsification:** if instructors start reading the free-response panel aloud in class and complain that the sampler keeps missing the good ones, it has earned the aggregator change |
| `freeResponseQuestion()` returns the FIRST candidate on a lesson that declares several | `site/js/schema.js` | Fall 2026 has exactly one everywhere (74/74 written activities resolve to `q3`), so this is currently unobservable. A lesson with two JiTT questions would show one prompt above a panel holding answers to both — which is worse than showing neither, because it is confidently wrong. A panel per question is the fix; do it when a second question exists, not before |
| `js/ui.js` — real confirm/toast replacing `alert()`/`confirm()` | PLAN-2026-07-16-ADMIN.md:242-243 | Worth it once more destructive operations exist. **Sharper as of 2026-07-30:** grading now raises a native `confirm()` on discarding unsaved work — picker change, queue click, closing the per-student modal — plus a `beforeunload`. That is three or four new prompts in the flow an instructor uses most, and native dialogs cannot say which changes are about to be lost. The unsaved-changes banner does that work; the confirms are the crude half |
| Zero-point questions are a hidden, undocumented mode switch | LEGACY-AUDIT:92-100 | Load-bearing (`grade.html:207,215` hides them); make explicit in the lesson creator |
| Q1 anonymity is hard-coded by **position**, not by question property | LEGACY-AUDIT:102-108 | Attach the property to the question |
| No delete-assignment control anywhere | LEGACY-AUDIT:119-124 | "An oversight, not a decision" |
| No lesson duplicate/clone | `docs/app/README.md:94` | Reuse works; making a *variant* does not. Feeds P3.4 |
| Tier D system-admin password reset — mocked, unbuilt | PLAN-2026-07-20-ACCOUNTS.md:3 | Decide whether it stays a known gap |
| 81 cadets keep fabricated `<id>@usafa.edu` addresses | CHANGELOG:411-412 | Needs a decision plus a migrate-login-emails action |
| ~~Is `faculty/interactions.html` deleted once the rollup absorbs its panels?~~ | CHANGELOG:1352-1353 | ✅ **Answered — it already was**, on 2026-07-20 (`nav.js:22`). Discovered 2026-07-22 while retiring the *student* page. Several docs still describe it as present and load-bearing (`COURSE-ADMIN-INVENTORY.md` §2E "cannot be deleted until that moves", `PLAN-2026-07-16-ADMIN.md` T2.1) — **worth a sweep**, since anything reasoning from those will reach wrong conclusions about what promotion still costs |

---

## 6. Decisions on record

*Answered by the course director 2026-07-22. Recorded here so the reasoning is not re-litigated.*

### Q1 — Can a system admin hold a *lower* role in a course? — **Ephemeral toggle only. ✔**

The need is real: a system admin who is not that course's director wants to see what an instructor
sees, and still act as an admin when needed. That is a **preview**, and it is a good feature.

Storing it as an **access level** was rejected, for three reasons:

1. **It cannot be enforced.** RLS grants on the *actual* role. A stored downgrade is cosmetic — the
   API still returns everything. Building a control that looks like a safety boundary and is not one
   is worse than not building it.
2. **Audit ambiguity.** If a person can be two things, every action needs "at what level" recorded
   alongside "by whom", and every existing row lacks it.
3. **A support trap.** A director who downgraded three weeks ago and forgot now reports a missing
   button as a bug.

→ **P3.10.** Session-only, visible banner, one-click exit. Never persisted, never called a role.

**Falsification:** if the banner gets ignored and someone reports "PREP hid my buttons", the
ephemerality is not visible enough and the feature should be pulled rather than persisted.

### Q2 — How do points and effort reconcile? — **The arithmetic does. ✔ The interactive path does not — see P0.14.**

Two layers, both live:

- **Measurement stays 0–5** — `q2_effort`, `q3_understanding`, schema:1 `effort` (clamped to 2 on a
  non-meaningful reflection) and `overall_understanding`. Not retired, not changing.
- **The grade is 2 points**, reached two ways: interactive via the effort trigger (full effort 2,
  capped 1); written via `question_scores` (reflection 1 + free response 1, Q1 zero-point).

Verified against `001_core_model.sql:255,579-584`, `preflight-analyze/SKILL.md:319-320,569-570`,
`WRITTEN-SCHEMA1.md:118-121`, and both Fall builders. **This unblocks P1.1** — no normalization
layer.

⚠️ **Amended 2026-07-23.** The reconciliation above is correct, the gradebook's arithmetic stands,
and the **policy is confirmed by the director** (`0 → 0` · `1–2 → 1` · `3+ → 2`, effort capped at 2
without a meaningful reading reflection) — the trigger implements exactly that. What this answer got
wrong was reading "the trigger derives the points" as "the interactive path is wired". It is not:
**nothing writes `grades.effort`**, no offering is `grading_mode='effort'`, and the column the mode
lives on cannot express an offering where *both* modalities are graded — which `preflight-03` and
`preflight-04` already are. Full diagnosis and the one decision left: **P0.14**. The lesson worth
keeping is narrower than the original claim: *verifying that a mechanism exists is not verifying
that anything invokes it.*

*(Caveat: `PROJECT.md:91-98`'s `question_scores` example still shows the retired 5-points-per-question
shape. That block only — the 0–5 diagnostics documented elsewhere in that file are correct. See §5.)*

### Q3 — Can a student see their own EI log? — **No. ✔**

RLS: staff of the offering only. Additive to open later, breaking to close.

### Q4 — What happens to unknown flags? — **Surface them with their detail. ✔**

A container in the summary section showing unrecognized flags and what the AI writing them was
thinking. → **P1.13** (the container) and **P3.3** (the taxonomy). Never drop silently, never error.

### Q5 — Import only, or two-way? — **Import only, except Blackboard. ✔**

A direct Blackboard export/import connection would be nice but is **not expected to happen** — design
P2.1 for file exchange.

---

## 7. What I would do first

**Done 2026-07-22:** the docs batch, plus P0.9 / P0.10 / P0.11 / P0.12 — the four small frontend
fixes — and P0.7 closed as largely a non-issue. Seven roadmap items cleared without touching the
database or the cutover.

**Also 2026-07-22 (second batch):** the two `lesson_aggregate.py` cleanup items and **P1.13**. Both
cleanup items sat in `/lesson-cycle`, which runs from day one — one of them printed an instruction
that would have taken a live course offering down, and the other silently hid most of a term from the
verify step. Both were **S** and neither needed the database. Note the pattern: each was *worse than
the roadmap recorded* once read against the code, so treat a §5 row as a lead, not a spec.

**Also 2026-07-22 (fourth batch):** **P1.3 · P1.5 · P1.6 (with P1.15) · P1.7** — preferences that
follow the person, the objective histogram, the due-out panel, and the dashboard's two scope
controls. P1.3 needed the DDL window that was already open, so it landed while the seal was off;
the other three are frontend only. A `tests/browser-harness/` was built alongside them and is what
makes P0.5 a repeatable session rather than a one-off.

**P0.5 is done** — the walkthrough ran as all three role tiers in light and dark, 11/11 pages clean
each time, plus 13/11/13 targeted assertions. Seven items' worth of never-looked-at UI is now
looked at. Two things it could not reach are recorded in the entry: the late chip has nothing late
to render (re-check in week one, with P1.14), and the two student-account edge functions need a
disposable *cadet*, not a disposable instructor.

**Two P0 items remain, and they are the same job.**

**P0.1 (cutover) and P0.3 (test suites) go together.** The suites are the only proof that the schema
the cutover promotes is safe — note this is the `supabase/admin/` pair (`app_invariant_test.py`,
`app_rls_test.py`, both green at 22/22 and 35/35), *not* `tests/app-schema`, which passes 339/0.
Everything the promotion touches has now been seen in a browser, which was the last thing standing
between "prepared" and "run it".

**Then P0.2 closes two doors, not one:** seal `prep_app_owner` *and* delete the test faculty
account. Deleting the auth user is enough — `instructors` cascades from `auth.users` — but do the
stray unconfirmed users at the same time.

**Also 2026-07-22 (fifth batch): P1.1 · P1.2 · P1.4 — the gradebook, the per-student page, and EI
logging.** Built together because they are one feature: a grid, the page you reach by clicking a
name in it, and the thing you do there. Building them separately would have meant writing the same
loader three times.

Three things that pass forward:

- **The scale question really was already answered.** Both modalities land on `points_earned`
  against the same `points_possible`, so no normalization layer was written and none is needed.
- **A grid needs a due-date-aware denominator.** Counting a not-yet-due lesson against a cadet makes
  every student read 0% in week one. This is the same rule P3.2 flags on the WebAssign importer, and
  it is the single most load-bearing decision in the gradebook.
- **Reading the code found a bug the roadmap did not know about** — `faculty-data.js:148` ignores
  extensions when computing dashboard status. Filed in §5. That is now the *third* batch in a row
  where a §5 row or an adjacent file turned out worse than recorded once read against the code;
  treat a roadmap entry as a lead, not a spec.

**Also 2026-07-23 (sixth batch): P1.8 · P1.9 · P1.10 · P1.11 · P1.14** — the EI panel, the roster
folded into Course Admin, drag-and-drop section coverage, the offering-wide count, and the Grade
queue that replaces the late filter. Frontend only; no DDL, no live data touched. **P1 is now
empty** — its last entry, P1.12's whole-section half, was descoped on 2026-07-27 rather than built
(P3.17).

Five things pass forward, and two of them are the kind of finding a roadmap entry cannot contain:

- **"What you can see" is not "what you owe", and the difference was already shipped wrong.** A
  director's staff row is offering-wide, so `ctx.sectionIds` is the whole course — and the due-out
  row was counting the whole course under a heading reading *Needs your attention*. `schema.js`
  `actionableSections()` is the fix and is now the scope rule for anything that presents itself as a
  personal worklist. Watch for the next surface that reaches for `ctx.sectionIds` out of habit.
- **Which raises a real permissions question nobody has decided.** Nearly *everyone* holds an
  offering-wide row, because that is what `create-instructor` writes by default — so section rows are
  scoping the UI, not access. Filed on **P3.9**; it needs the director, not an agent.
- **Removing a control is not the same as removing its route.** Dropping Grade from the nav was
  right, but the boxes that justify it render nothing when there is nothing outstanding. The empty
  state had to grow a link, and the test that pins it is the one worth keeping.
- **A queue that lists work nobody has to do is a queue nobody opens.** The interactive-taker
  exclusion is the only rule in the new queue that depends on *another* part of the system being
  true (migration 015). It is asserted narrowly and pinned by a counterfactual test, on the pattern
  P0.14 established.
- **The nav bar is the scarce resource, and P1.9 spent two entries before anyone noticed.** The
  first build of it was two pages — defensible on its own terms, and corrected within hours because
  the cost showed up somewhere the item never mentioned. When an item says "move X out of Y", ask
  where it *lands* before asking how to split it. A test now asserts the bar's shape, including that
  every href resolves to a file that exists.

~~**The one thing still owed, and it is now owed twice**~~ ✅ **CLOSED 2026-07-27 — walked on the
live site by the director.** Both surfaces the entry named as unverified work: the coverage grid's
**drag-and-drop** and the merged **Students tab**. The harness run is therefore no longer owed, and
**the ordering constraint it imposed on P0.2 is dropped** — deleting the test faculty account no
longer blocks anything.

**One item does not close, and it is a data blocker rather than a looking blocker:** the Grade
queue has never been seen against **genuinely late work**, because nothing in the term is late yet.
No amount of walking fixes that; it re-checks itself in week one. Same blocker P0.5 hit.

*Worth keeping:* the entry assumed the verification had to arrive as a harness run, and it did not.
`tests/browser-harness/` catches the class of failure a human misses — a console error on a page
that renders fine, a request 404ing quietly — which is a **narrower** claim than "a person used
this and it worked", not a stronger one. Walking the deployed site is also the better environment,
since `site/app/` is live against schema `app` already. Ask what a check is *for* before treating
it as the only way to satisfy the thing it was written to satisfy.

**Start P2.1 (Blackboard) during P1.** Its risk is entirely in round-trip testing with a real file,
and that lead time cannot be compressed at term end.

---

## 8. Completed

*Everything here is done. It is kept in full rather than deleted because most of these entries
record a **decision** — why something was built the way it was, or why a request turned out to be
wrong — and that is the part which stops the same question being re-opened in three weeks. Items
keep their original numbers, so a reference to P0.9 still finds P0.9.*

### P0 — was ship-blocking for 2026-08-10

#### P0.16 — Interactive grades itself on commit; student nav gating · ✅ **DONE 2026-07-23 (015 applied)**

*Director follow-up to P0.14: the interactive grade should appear on its own — no run — and be
auto-final, but only when the interactive path is an ALLOWED (graded) mode; and the student-facing
choice/navigation had several defects.*

**Grading — auto-final, reactive (frontend + tooling shipped; trigger written, apply BLOCKED):**

- Migration `app/015_interactive_autograde.sql` — a `SECURITY DEFINER` trigger
  (`grade_interactive_on_commit`) that, when a submission commits to a **graded** interactive
  activity, copies the report effort (with the §5.2 cap re-applied) onto a **finalized, derived**
  grade — student-visible immediately, no review step, matching the legacy `public` behaviour the
  director wanted. Practice commits get **no** grade. A finalized instructor/imported grade is never
  clobbered ("auto-grade as long as there wasn't a response already graded"). **APPLIED 2026-07-23**
  on the director's return; `autograde_interactive_test.py` passes 12/12 live. A "no usable effort"
  guard bug (`<>` vs `IS DISTINCT FROM`, which let an absent effort create a NULL-effort grade) was
  caught by that test and fixed before use.
- `grade_interactive.py` + its 49-check suite re-aligned to the auto-final policy (`source='derived'`,
  `is_finalized=true`); the script is now a **backfill** tool writing the identical row the trigger
  writes. Until 015 is applied, a committed interactive submission still produces no grade on its own
  — the script is the interim path.

**Student navigation (shipped, no DDL):**

- **Routing bug fixed** — clicking *Written preflight* linked to `assignments.html?a=<activity id>`,
  which that page resolves against `offeringId`; the mismatch dumped the student on the full list.
  Now links by offering id, so it opens the actual written input — including the written-only case.
- **Interactive availability is now respected** — the interactive card is launchable only when its
  `available_after` gate is met (`submit`/`due`, or always past the deadline); before then it shows
  **greyed and disabled** with the reason ("Available after you submit your written responses"),
  instead of a live Launch button on a practice activity the assignment says isn't open yet.
- **The launch warning ("your written answers stop counting") only fires when the interactive path
  is graded** — on a practice activity it was simply false.

#### P0.15 — "Once a director, always a director" — role demotion never took · ✅ **FIXED 2026-07-23**

*Director report: you cannot set a faculty member back to instructor in a course once they've been a
director. Director is meant to be a per-course privilege; system admin is the global one.*

**Root cause, confirmed against live `app`:** the model is right — director lives in
`staff_assignments` per offering, sysadmin in `instructors.is_global_admin` — but a director holds
**several** `staff_assignments` rows (offering-wide + one per section), all `role='director'`, and
`setRole()` (`faculty-admin.js`) upserted only the offering-wide row. The section-scoped rows kept
reading `director`, and `director_offerings()` (002_rls.sql) grants the privilege on a director role
in **any** row — so the person stayed a director no matter how many times you chose Instructor.

**Fix:** `setRole()` now updates the role on **every** row the person holds in the offering, then
guarantees the offering-wide row — so a demotion actually clears every director row. Verified live
(rolled back): the old logic left a mixed director/instructor state and `director_offerings()` still
returned the person; the new logic demotes cleanly and promote-back still works.

~~**⚠ Two live records are already corrupted by the old bug and need the director's call:**~~
✅ **RESOLVED — verified clean 2026-07-27, and no write was needed.** The director's intent was
`Kimberly de La Harpe` → **instructor** in phys-215, `TJ Hardy` → **director**. Live `app` already
matches: Kim holds 3 rows (offering-wide + T1A + T3A), **all `instructor`**, so
`director_offerings()` does not return her; TJ holds 3 rows (offering-wide + M1A + M3A), **all
`director`**. Neither is `is_global_admin`, and neither holds any row in phys-110.

Somebody re-selected both roles in Staff after the fix landed, which is exactly the remedy this
entry proposed — the fixed `setRole()` updates every row the person holds and then guarantees the
offering-wide one, which is why the result is uniform rather than half-repaired.

**A whole-database sweep for the corruption signature found none** — no staff member holds more than
one distinct role within a single course. That query is the cheap way to re-check this, and worth
re-running after any bulk staffing change:

```sql
SELECT i.name, c.code, count(DISTINCT sa.role)
  FROM app.staff_assignments sa
  JOIN app.instructors i ON i.id = sa.instructor_id
  JOIN app.course_offerings co ON co.id = sa.course_offering_id
  JOIN app.courses c ON c.id = co.course_id
 GROUP BY i.id, i.name, c.code HAVING count(DISTINCT sa.role) > 1;
```

*Worth keeping:* the roadmap asserted a live-data defect for four days after it had been repaired.
A recorded data defect is a **claim about the present**, unlike the rest of this file, and it goes
stale silently — the repair happens in a UI that does not know the roadmap exists. Verify before
acting on one.

#### P0.14 — The interactive path produces no grade · ✅ **DONE 2026-07-23 (migration applied)**

*Director's observation: interactive submitters get no grade and no mark in the gradebook matrix,
and their student page shows no points.* **Confirmed against live `app` the same day — the
observation is exact, and the roadmap had been asserting the opposite.**

**Shipped 2026-07-23 (frontend + tooling, no DDL yet):**

- **`supabase/admin/grade_interactive.py`** — the missing writer. Reads a committed, `graded`,
  chosen interactive submission's `effort` from `submission_activities.content`, re-applies the
  §5.2 reflection cap as a server-side guard, and upserts one `grades` row (`is_finalized=false`,
  `source='ai_suggested'`, so it lands in the dashboard review queue). `status` / `run --commit`,
  dry-run by default. Correct **before and after** the migration: pre-migration the old trigger
  returns early on `grading_mode='points'` so the script's own `points_earned` stands;
  post-migration the trigger recomputes the identical value. Uses the one shared effort curve
  (`points_from_effort`, imported not copied). 49-check suite `grade_interactive_test.py` — pure
  logic **plus** a live end-to-end write inside a rolled-back transaction.
- **Grade tab now excludes interactive takers** (`faculty-grade.js` `isEffortGraded()` +
  `buildGradeData()` gained a `submissionMap` arg; `grade.html` renders a read-only "graded on
  effort N/5" card for them). This closes the zeroing bug directly: without it, an interactive
  taker's blank written answers defaulted to `zero` and — because they hold a prior grade row —
  a single Save would have overwritten their effort grade with 0. `test-grade.mjs` (14 checks)
  pins it, counterfactual included.

**Applied 2026-07-23 as `prep_app_owner`:** migration
`supabase/migrations/app/014_effort_grades_per_row.sql` re-keys the effort trigger on the grade
**row** (`NEW.effort IS NOT NULL`) instead of the offering's `grading_mode`, and adds a
`grades_one_grading_mechanism` CHECK (`effort IS NULL OR question_scores = '{}'`) so the
written/effort split is enforced by the database rather than by prose. This is what lets a
**choice** offering grade a written taker by `question_scores` and an interactive taker by effort
*on the same offering* — the case `preflight-03`/`-04` already present. All 64 existing rows
satisfied the CHECK; verified live afterward (a points-mode offering now derives points from
effort, an effort-NULL row is left alone, and an effort+`question_scores` row is rejected).

**⚠ Re-seal the owner (CORE.md §0, human-only).** `prep_app_owner` was unsealed to apply this and
should go back to `NOLOGIN` — `ALTER ROLE prep_app_owner NOLOGIN;` as `postgres`. Folds into P0.2,
which already seals it once and for all before term.

**Verification gap to close during P0.5:** the new interactive Grade-tab card has **not** been seen
in a browser, because no committed interactive submission exists in the term yet (the only
interactive work is `preflight-02` practice). Logic-verified and syntax-clean; walk it once a real
`graded` interactive submission lands, or against a seeded fixture.

**Remaining decision (narrowed, not eliminated):** the migration takes option 2 below (trigger keys
on the row). Option 1 (move `grading_mode` to `offering_activities`) remains the "honest schema"
alternative if the row-keyed trigger ever proves too implicit; it is more DDL for the same
behaviour and was not chosen. Recorded so the choice reads as deliberate.

**There is no writer for `grades.effort` anywhere in the app-schema stack.** Three separate places
each decline to write it, all for defensible local reasons, and nobody owns the gap between them:

| Component | What it does | Why |
|---|---|---|
| `student/interaction-submit.html:54-57` | records the report, writes **no** grade | correct — a student cannot; `grades_staff_write` would refuse |
| `faculty-grade.js:223,235` | builds rows from `questionsOf(offering.written)` only | the Grade tab has no effort control at all |
| `/preflight-analyze` | grades free-response answers | its blast radius is written work by design |

So an interactive submission that *does* commit lands in `UNGRADED` and stays there.

**Two more layers are also missing, and each would independently defeat a fix to the first.**

- **`grading_mode` is `'points'` on all 74 offerings.** `grades_points_from_effort()`
  (`001_core_model.sql:568-586`) returns early unless the mode is `'effort'`, so writing
  `grades.effort` today derives no points. The trigger is fine; nothing is configured to reach it.
- **`grading_mode` sits on the *offering*, but `preflight-03` and `preflight-04` offer *both*
  modalities as `graded`.** One column cannot serve two modalities on one offering, and that is the
  decision this item actually turns on — see the correction to Q2 below, which assumed one modality
  per offering and is why the conflict was never noticed.

**What the director saw, precisely.** The only interactive work in the database is 8 reports on
`lesson-02-electric-charge-coulombs-law` (seeded 2026-07-21). That activity is `grading_role =
'practice'` on `preflight-02`, so `submitInteractionReport()` (`student-data.js:364-368`) records
the work and returns **without committing** — which is right, practice is not the graded path. All
8 submissions are therefore `status='draft'` with `chosen_activity_id IS NULL` and no grade row.
`cellState()` (`faculty-gradebook.js:200-231`) sees neither a grade nor a committed submission, the
Aug 10 deadline has not passed, so the cell is `PENDING` — **and `PENDING` renders as nothing.**

**This gets worse on its own, without anyone touching it.** On 2026-08-10 those same cells flip
`PENDING → MISSING`: a cadet who completed the lesson reads as never having handed anything in, and
`totalsFor()` counts them zero out of 2. Then `preflight-03` (Aug 12) and `preflight-04` (Aug 14)
arrive with their interactive activity marked `graded`, where a student *does* commit — and lands in
`UNGRADED` permanently, which drags their percentage identically. **That is the P0 clock**, and it
is why this is not "the gradebook is incomplete" but "the gradebook is about to be wrong."

**The name mismatch inside the fixtures is expected and is not a defect** (director, 2026-07-23):
those reports were produced by faculty on the legacy system, archived, and re-attached to random
roster students to exercise the pipeline. The student page rendered them faithfully. Noted only so
the discrepancy is not investigated a second time. *(Those 8 students also have no written work on
`preflight-02`, which is why nothing else filled the row.)*

**The grading policy is settled and was never the open question** (director, 2026-07-23): an
interactive assignment is **automatically** graded from effort — `0 → 0` · `1–2 → 1` · `3+ → 2` —
with effort **capped at 2** when the student gives no meaningful reading reflection. That is
implemented and correct on both halves:

| Rule | Where it lives | State |
|---|---|---|
| effort → points, `≥3 → possible` · `≥1 → possible/2` · `else 0` | `grades_points_from_effort()`, `001_core_model.sql:568-586` | built, matches the policy exactly at `points_possible = 2` |

> **Superseded 2026-07-30 (migration `app/019`).** "matches the policy exactly at
> `points_possible = 2`" was the whole caveat, and it came due: Physics 310 is 3 points, where
> `possible/2` pays **1.5**. The partial-credit branch is now `LEAST(1, possible)` — a flat point —
> so the policy the director stated (`0 → 0` · `1–2 → 1` · `3+ → full`) now holds at every
> assignment value rather than at one. Full credit still scales. No stored grade moved.
| reflection cap, effort ≤ 2 when `reading_reflection.meaningful = false` | contract §5.2 — applied by the artifact, re-clamped server-side as a guard (`interaction_reports.py:223-231`) | built, and deliberately belt-and-braces |

**So this item is not "decide a grading rule". It is "connect a rule that already exists to a column
nothing populates."** Scope: a writer that copies the payload's `effort` into `grades.effort` (with
the §5.2 cap re-applied as a guard, never trusting the student-controllable payload), plus the
configuration that lets the trigger fire.

**⚠ The obvious configuration change would zero every written taker. Do not make it first.**
Setting `grading_mode='effort'` on `preflight-03`/`-04` looks like the one-line fix and is a
data-loss bug: the trigger is `BEFORE INSERT OR UPDATE` and assigns `points_earned`
**unconditionally** once the mode matches, and `NULL` effort maps to `0`. Every *written* taker on
that offering — graded 2/2 through `question_scores`, with `effort` correctly NULL
(`WRITTEN-SCHEMA1.md:118-121`) — would be silently rewritten to **0 points** on the next save.
`preflight-03` and `preflight-04` carry *both* modalities as `graded`, so this is not hypothetical.

**How a *mixed* offering grades two modalities under one `grading_mode` column** was the last open
question. Two ways were on the table: move `grading_mode` to `offering_activities` (honest schema,
more DDL), or make the trigger key on the grade **row** (`NEW.effort IS NOT NULL`) instead of the
offering (one `CREATE OR REPLACE FUNCTION`, lets one offering serve both). **Migration 014 takes the
row-keyed option** — see the status block at the top of this item. The `NULL effort → 0` semantics
it changes were confirmed vacuous: a non-submitter has no grade row at all. The safe order was, and
the shipped order is, **writer first, configuration second** — the writer alone is inert, whereas a
mode change with no writer is the zeroing bug above.

**Do not "fix" this by flipping `preflight-02`'s interactive activity to `graded`.** It is practice
on purpose, and doing so would commit 8 students to a path that still has no grade writer — turning
8 blank cells into 8 permanently ungraded ones.

**Falsification:** if no cadet ever chooses the interactive path on a `graded` offering this term,
this is a P1 that never fired, and the fixture rows on `preflight-02` are cosmetic. The way to know
early is to watch `submissions.chosen_activity_id` on `preflight-03` in the days after Aug 12.

---

#### P0.3 — Revive the two dead DB test suites · ✅ **DONE 2026-07-22 (uncommitted)**

Both died in fixture setup and therefore guarded nothing. Both now pass — **22/22 invariant checks,
35/35 RLS enforcement checks.**

- **`app_invariant_test.py`** — the fixture inserted a random uuid into `instructors`, which carries
  an FK to `auth.users` that `postgres` added directly (the app owner cannot be delegated
  `REFERENCES` on `auth.users`). `prep_app_dml` cannot create an auth user to satisfy it. Now
  **borrows an existing instructor's id** — nothing is written to that account, the id is used only
  as `unlocked_by` attribution, and the whole fixture is rolled back.
- **`app_rls_test.py`** — three `extensions` inserts lacked `reason`, NOT NULL since `007`. The
  crash was the visible half; **the dangerous half was silent.** Two of those inserts are
  *expected to be denied*, so they were being rejected by the constraint before RLS was ever
  consulted and reported "correctly denied" while testing nothing about the policy. A crash is
  loud; a false pass is not. Also added a check that a blank reason is refused.

#### P0.4 — Instructors can read the `__all__` whole-course scope · ✅ **RESOLVED 2026-07-22 — by a different decision**

The original recommendation was to stop an instructor's "All sections" from reading `__all__`. **The
course director decided otherwise: All Sections stays visible to everyone**, and is simply no longer
the default. That is their call to make — the whole-course read is useful context, and the panel was
never a privacy boundary in the sense the sweep implied (RLS grants `analysis_reports` to any staff
member of the offering regardless).

What actually shipped removes the *harm* without removing the *view*:

- **"My sections" is the new default scope for everyone**, so nobody's first view is a cohort they
  do not teach. That alone resolves the practical complaint.
- **The readiness summary moved to instructor scope**, so what an instructor reads by default is
  written about their own sections.
- **When "All sections" is selected and the viewer cannot load the whole roster, the panel says so**
  — `meta.n` (the true course-wide count) is compared to the rows actually summarized, and a mismatch
  renders an explicit line. Previously whole-course prose sat silently above partial numbers.

Still true, and still worth a deliberate decision: none of this is enforced in the database. See P3.9.

#### P0.6 — The four surfaces promotion deletes · ✅ **DONE 2026-07-22 (uncommitted)**

| Surface | Outcome |
|---|---|
| Report tab copy-for-slides | **Already rebuilt** as the rollup's `.sr-*` panel — but it had **inherited the exact flaw the audit warned about** (below). Fixed. |
| "Did Not Submit (N)" table | **Built** — did not exist in `site/app/` at all. Now a rollup panel, sorted by section then name, **copyable** (tab-separated for a spreadsheet), and linking to the Grade page where an extension is granted. Renders only when someone is missing. |
| "Show flagged only" toggle on Grade | **Built** — one-click, driving the existing lamps (`full` off, `warn`+`zero` on) rather than becoming a competing third state. |
| `site/review.html` | **Deleted by the promotion script** (`scripts/promote_app.py` `LEGACY`), per the audit: a re-enable away from a FERPA problem. |

**The copy-for-slides privacy flaw, carried forward and now fixed.** The audit said of the legacy
version: *"anonymity is cosmetic: names are in the DOM at `display:none`… If this is rebuilt, do not
render names that are not meant to be shown."* The rollup panel had reproduced exactly that —
`data-name` on every card plus a `hidden` attribution div — so a panel whose entire purpose is being
**projected in a classroom** kept every student's name one devtools inspection, Ctrl+F, select-all or
screen-reader pass away. Names are now not rendered at all unless the toggle is on; switching it
re-renders (preserving the selection) rather than unhiding.

#### P0.7 — Remove every email-reset reference · ✅ **RESOLVED 2026-07-22 — mostly a non-issue**

*Requested. On inspection this item was largely wrong, and acting on it as written would have made
the system worse. Recorded in full so it is not "fixed" again later.*

**What the sweep called a problem, and what it actually is:**

| Flagged | Verdict |
|---|---|
| `site/reset.html` — "orphaned, delete it" | **KEPT.** It is not an email-reset flow; it is the page that tells a locked-out person there *is* no email reset and who to ask instead. Its own header explains why it outlived the flow: the login page linked there for a year, so bookmarks and history still point at it, and a 404 is the worst possible answer at the moment someone is locked out. Deleting it would remove the one thing that redirects them correctly. |
| `DOC-SOURCES.json` listing `reset.html` as a source | **KEPT.** A correct dependency — `student-getting-started.md` was written from that page. Not a stale entry. |
| Help docs mentioning reset | **KEPT.** Every mention is a *denial* ("PREP cannot email you a reset link", "there is no reset link to send"). They are the tombstones, correctly phrased. |
| `tests/browser/test-account.html` | **KEPT.** Already carries a "Superseded 2026-07-21" banner and a comment reading *"Kept as the design record of the emailed-code flow, NOT as a picture of the system."* Deliberate archive. |
| `tests/browser/test-admin.html` | **FIXED** — the one real defect. It rendered "Send reset email" with **no** supersession marker, unlike its sibling. Given the same banner, and its "Password operations" card relabelled `Planned` → `Superseded` (the email tier was removed; the system-admin tier was never built). |

**The general lesson, worth keeping:** a reference to a removed feature is not automatically debt.
A *denial* of it is documentation. Only an artifact that still presents the removed feature as
available needed changing, and exactly one did.

Left alone deliberately: the tombstone comments in `account.js:7-26` and `faculty-admin.js:139-158`,
which explain *why* there is no email recovery — the thing a future operator will otherwise try to
re-add.

#### P0.8 — AI prose is far too long · ✅ **DONE 2026-07-22**

*Requested.* Length was the main tell. Resolved harder than scoped — one of the three panels was
deleted rather than shortened.

| Panel | Was | Now |
|---|---|---|
| `readiness_summary` | ≤ 8000 chars, multi-paragraph | **≤ 1200, 2–3 sentences**, enforced by the writer |
| `misconception_trends` | ≤ 8000 chars, paragraphs | **Retired.** Not written, not rendered |
| `misconception_recommendation` | ran long despite "one line" | **One imperative sentence**, ≤ 1200, single-paragraph check |
| `section_notes[].note` *(new)* | — | ≤ 400 each, ≤ 12 |

**Trends went away rather than shrinking** because the bars beneath it now carry each
misconception's own description and student evidence (P0.13) — so the paragraph restating them had
nothing left to say, while still costing an AI panel and a "coming soon" placeholder under
fully-populated bars.

**Caps are enforced in `lesson_aggregate.py`, not requested in prose** — an instruction to "be
brief" is not a constraint. The skill also now bans the specific tells: no `Overall,` /
`It's worth noting` openers, no three-item parallel lists, no restating the question back, no
hedging stacks, and "name the physics" over "gaps in conceptual understanding".

**Falsification (unchanged, and still owed):** show a director three rollups without saying which
are new. If they cannot pick the rewritten ones, the caps were not the problem.

#### P0.9 — Student responses: 3 AI picks + 5 random · ✅ **DONE 2026-07-22**

*Requested.* The panel capped itself at ~5 cards **total** via `randN = Math.max(0, 5 - ai.length)`,
so every AI pick displaced a random one — meaning a well-analysed section showed the *least*
unfiltered student writing. Inverted: the random sample is now a fixed 5, independent of the AI
count, bounded only by the pool. The panel is 8 cards where the section has the material.

- `report.html` `responsesSection()` — `RANDOM_N = 5`, `randN = Math.min(RANDOM_N, pool.length)`.
  The eyebrow note and Shuffle control follow the real count.
- `.ai/skills/lesson-aggregate/SKILL.md` — `selected_quotes` changed from "2-3 each" to **exactly
  3**, in all four places it was stated, with an explicit note that emitting fewer now shrinks the
  showcase without widening anything else, and that padding to 3 with a weak pick is wrong.

**Unchanged by design:** quotes render on single-section scope only; `__all__` carries none.

#### P0.10 — Hide the histogram smoothing tuner, keep the code · ✅ **DONE 2026-07-22**

*Requested.* `mountKdeTuner()` was mounted for **every** director on **every** rollup, where a
floating panel of unexplained sliders reads as part of the product rather than the dev tool it is.

Now reached by **`?kde=1` only**, still director-gated on top of that. Code untouched and fully
working — it is the only thing that regenerates the KDE const line. To retune:
`report.html?i=<slug>&kde=1`.

Deliberately a query param rather than an account preference: it leaves no persisted state, so a
director cannot switch it on, forget, and file the panel as a bug three weeks later.

#### P0.11 — Staff table row heights · ✅ **DONE 2026-07-22**

*Requested, and confirmed as diagnosed.* Your own row rendered a `.score-badge` (~20px); every other
row carried a `<select>` inheriting the global form rule `padding: 10px 14px` at `0.95em` (~40px)
plus `width: 100%`. No `td select` override existed. Result: the one row you always look at was the
odd one out, and the Role column stretched.

Both halves fixed:

- **`admin.html`** — your own row now renders the **same `<select>`, disabled**, instead of a badge.
  Same box, no special case, and it states "you cannot change your own role" in the place the role
  is changed. The change handler is scoped `[data-role-for]:not([disabled])`.
- **`styles.css`** — new `.staff-tbl` block: `vertical-align: middle`, a `.role-cell` flex box with
  `min-height: 30px` so the text-only *implicit* rows still occupy a select-sized cell, and a
  compact in-table select (`width: auto; min-width: 128px; padding: 5px 8px`) following the existing
  `.sec-assign select` house pattern.

#### P0.12 — A late submission is invisible on the grade card · ✅ **DONE 2026-07-22** · *filter withdrawn 2026-07-23*

> **The "Late only" filter added here was withdrawn on 2026-07-23**, at the director's request the
> day after it shipped. It answered the wrong question: an instructor does not want to filter a
> section down to late work, they want a standing queue of the few submissions needing attention.
> **P1.14** replaced it, and the `.late-toggle` control and its CSS are gone. The late **chip** on
> the card stayed, as predicted — it is context while grading, and is not what was objected to.
>
> Recorded as a shape worth noticing rather than a mistake: the filter was a correct implementation
> of a stated request, and it took seeing it to establish that the request was for the wrong control.
> One day between shipping and withdrawing is a cheap way to find that out.


**Shipped:** a new `submissionLateness()` + `lateBy()` pair in `schema.js` (beside `effectiveDue`,
which answers a different question — clock-vs-deadline, not commit-vs-deadline), an amber `⏰ N days
late` chip on the grade card beside the extension chip, and a **Late only** filter that ANDs with
the status lamps and hides itself entirely when nothing is late.

**Extensions are honoured** — a student granted until Friday who submitted Thursday is not badged.
That is the case the whole feature turns on, and it is covered by the harness below.

Amber, not red: arriving late is a fact the grader should see, not a verdict. Whether it costs
credit stays the instructor's call, and late work is routinely accepted by hand on purpose.

*Verified:* 16/16 in a dedicated logic harness (on-time · 4-days-late · inside-extension ·
past-extension · M/T section override both ways · draft · no-deadline · 30s clock-skew grace ·
unparseable timestamp · label boundaries · `effectiveDue` regression guard), plus the full
`tests/app-schema` suite green at 339/0. **Not yet seen in a browser** — folded into P0.5.

<details><summary>Original diagnosis (kept for context)</summary>

*The director asked "don't these show up in the Grade tab?" — they do, but you cannot tell which
ones are late.*

- `loadGradingData()` (`faculty-grade.js:93-103`) filters only by offering and enrollment. **Nothing
  compares against `due_at`.**
- The grade card (`grade.html:263-270`) renders name, section, finalized tag, provenance tag,
  extension chip, total — **no lateness indicator.**
- `committed_at` *is* fetched and shaped as `committedAt` (`schema.js:33-36`, `:154`) but is consumed
  in exactly one place repo-wide (`student-lessons.js:107`). **It is never compared to a deadline
  anywhere in the faculty UI.**
- There is no late filter and no late sort — the only filters are the three full/warn/zero lamps
  (`grade.html:336-368`), sorted alphabetically (`faculty-grade.js:86`).

The data is already loaded, so this is a badge and a filter, not a query change. Compare
`committedAt` against `effectiveDue()` — which already exists at `faculty-grade.js:552` and correctly
accounts for extensions — and render a chip beside the extension chip.

**In P0 because it affects grading from the first lesson**, it is small, and getting it wrong means
an instructor silently gives full credit to work that arrived four days late.

*(Note: the assignment-level `pastDueUngraded()` queue at `faculty-grade.js:506-571` already counts
these correctly. The gap is purely per-submission visibility once you open the assignment.)*

</details>

#### P0.13 — Rollup rework: scopes, self-explaining misconceptions, misconception bucketing · ✅ **DONE 2026-07-22**

*Requested mid-stream, ahead of the P0.1 cutover. Groups several changes that share one payload
contract.*

**Display**
- **"My sections" scope, default for everyone** — the sections you personally teach, combined.
  `taughtSectionIds()` reads section-scoped staff rows only; a director's offering-wide row grants
  sight of every section but is not a teaching assignment, so it does not count. Teach none → falls
  back to All sections; teach all → the option is hidden as a duplicate.
- **All sections** stays available to everyone, no longer the default (see P0.4).
- **A single section shows its own numbers, quotes and recommendation, but its instructor's summary.**
- **Every misconception bar explains itself** — hover or click for a popover carrying the
  misconception's description, up to two verbatim (unattributed) student quotes, any coined ids that
  folded onto it, and the canonical id. Keyboard- and touch-reachable: the row is a real `<button>`
  with `aria-expanded`, Escape closes.
- **"Show all N" toggle** on student responses — swaps the 5-card random sample for the entire pool,
  AI picks still pinned on top. Reading every reflection previously meant opening students one at a
  time.

**Skill / data**
- **The readiness summary is written per instructor**, across every section they teach, with
  per-section departures as structured `section_notes[]` rendered with the section code in bold.
  Two sections taught by one person used to get two isolated paragraphs that could not be compared.
- **Misconception ids are canonicalized** at both counting sites — `canonMisconceptionId()` in JS and
  the mirrored `re.sub` in `lesson_aggregate.py`. `scalar-sum`, `Scalar-Sum` and `scalar sum` were
  three separate bars; reading-reflection topics had been trimmed and lowercased since day one while
  ids never were.
- **The clustering is finally persisted.** `/lesson-aggregate` was told to "fold novel ones into
  known buckets" but had nowhere to put the fold, so it was written as prose and discarded — the bars
  it sat under never changed and the work was redone every run. New offering-level
  `misconception_aliases` (variant → canonical) and `misconception_glossary` maps, merged across
  day-scoped runs, applied by the browser at render time.
- **`/preflight-analyze` matches before it coins.** A four-step resolution order, the first step
  being *query the ids already recorded against this assignment across every offering and term* —
  a self-maintaining bucket that grows as lessons are analyzed. Nothing validates a misconception
  id anywhere in the system, and the taxonomy covers 3 lessons of ~74, so the pressure to invent was
  constant and unchecked.
- **`description` and `evidence` survive to the cohort view.** Both producers emitted them, the
  aggregator received them, and both counting sites dropped them — which is why a bar could show
  `57%` and nothing about what the misconception was.

*Verified:* `test-rollup.mjs` 160/0 (30 new, covering canonicalization, alias folds, glossary
backfill, instructor scopes, and `taughtSectionIds`) · `aggregate_summarize_test.py` ALL PASS with a
new JS↔Python parity block · full `tests/app-schema` run exit 0. **Two real bugs were caught by
those parity tests**, not by review: the variant list compared only lowercase while the id also
collapses whitespace, so `scalar sum` was reported as a "variant" of the id it normalizes to.

**Not yet seen in a browser** — folded into P0.5.

---

#### P0.5 — Verification pass in a browser · ✅ **DONE 2026-07-22** — *two items deferred, see below*

**Run, as all three role tiers, in light and dark.** A course director created and confirmed
`prep.test.faculty@usafa.edu` in the Supabase dashboard; `scripts/test_faculty_account.py` wrote its
staffing and flipped it between tiers between passes.

- **11/11 pages clean** in light and again in dark — no console errors, no uncaught exceptions, no
  failed requests. Pages: dashboard · rollup · rollup with `?kde=1` · grade · roster · lessons ·
  admin · extensions · account · system · help.
- **`checks.mjs` — 13/13 director · 11/11 instructor · 13/13 global admin.** Assertions rather than
  screenshots, because most of what this pass verifies is something being *absent for the right
  role*, and absence is exactly what a screenshot review misses.

**Confirmed working:** the KDE tuner is absent from a plain rollup, present with `?kde=1` as a
director, absent with `?kde=1` as an instructor (P0.10) · student responses render 3 AI + 5 random
with Shuffle intact (P0.9) · names are **not in the DOM** while the toggle is off (P0.6) · the staff
table's own row is a disabled select, and a global admin gets the implicit variant (P0.11) · the
"Did not submit" panel, misconception popovers and short AI prose (P0.6, P0.8, P0.13) · and this
batch's P1.5 histogram, P1.6 due-out panel and P1.7 switchers.

**Two things this pass could not verify, and why:**

- **The late chip and its filter (P0.12).** *Nothing is late.* The active preflight is due Aug 9 and
  today is Jul 22, so there is no late submission and no expired extension anywhere in the term
  yet. The logic harness covers 16 cases including the extension boundary; the *rendering* is
  unexercised until real work arrives late. Re-check in the first week of term — it is also exactly
  when P1.14 lands.
- **`provision-students` and `reset-student-password` on a successful path.** Both mutate real cadet
  accounts, and there is no throwaway cohort to point them at. Their *gating* verified clean (all
  five edge functions correctly refuse a caller whose JWT does not already resolve to
  director/admin), but the happy path stays unproven. It needs a disposable student, not a
  disposable instructor.

**Two findings that are not bugs, recorded so they are not re-investigated:**

- **The rollup shows duplicate student responses.** Two cards were character-identical. Not a
  sampler bug — `sampleN` splices without replacement, and there are no duplicate submission or
  activity rows. **16 distinct answers are shared by up to 4 students each**, because the seeded
  training data draws from a small template pool. It is a good argument for clearing that data
  before the real roster lands (§5).
- **`--role` used to unstaff the account from other courses.** A re-tier deleted *every* staff row,
  dropped the test account to one offering, and made the course switcher correctly disappear — which
  read as a P1.7 bug for several minutes. The delete is now scoped to the offering being re-tiered.

<details><summary>Why this was blocked, and the boundary that caused it — worth not re-learning</summary>

Attempted first on the assumption that an unsealed database was enough to mint a faculty login.
**It is not:**

- All three `prep_app_*` roles connect and read `app` fine — but **every one of them is
  `permission denied for schema auth`**. Schema `app` and schema `auth` are separate boundaries, and
  unsealing the first grants nothing on the second. `claude_code_recker` is likewise denied.
- The public signup endpoint **does** mint a user (`disable_signup=false`), but the project has
  `mailer_autoconfirm=false` and **PREP has no SMTP** — so the account is created unconfirmed and
  sign-in returns `email_not_confirmed`.
- All five edge functions correctly require a caller JWT that already resolves to director/admin, so
  none bootstraps the first account.
- `~/.claude/skills/preflight-analyze/config.json` — the one place the `service_role` key lives — is
  **absent on this machine**, so the Admin API is unreachable and **`/preflight-analyze` cannot run
  here either**.

So the account had to be created by a human in the dashboard. It took three attempts: the first two
would not authenticate with a correctly copy-pasted password, most likely because duplicate
unconfirmed users existed on the same address (see P0.2 — delete the strays).

</details>

<details><summary>Original scoping</summary>

Eight CHANGELOG entries record the same gap: **no faculty login is available to the automated
harness**, so roster import, the review page, Grade/Roster, the rollup, and both new edge functions
have never been exercised against the live database by a signed-in human.

This is one session, not eight — a director walkthrough in light and dark mode as all three role
tiers. Everything else in P0 should land first so the pass covers the shipped state.

**Added 2026-07-22** — the four frontend fixes shipped that day are logic-verified and syntax-clean
but **have not been looked at**, and each is a visual change that only an eye can confirm:

- **Staff table** (P0.11) — rows equal height; your own row a disabled select; Role column no longer
  stretched. Check as a director *and* as a global admin, whose row renders the third variant
  (`implicit — no staff row`).
- **Late chip + Late-only filter** (P0.12) — needs a genuinely late submission and one covered by an
  extension, to confirm the second is *not* badged. Confirm the toggle is invisible when nothing is
  late.
- **Student responses** (P0.9) — 3 AI + 5 random = 8 cards, and the Shuffle control still reshuffles
  only the random 5.
- **KDE tuner** (P0.10) — absent from a plain rollup, present with `?kde=1` as a director, absent
  with `?kde=1` as an instructor.

</details>

---

### P1 — first weeks of term

#### P1.12 — Bulk / whole-section extensions · ✅ **DONE 2026-07-22** — remainder descoped 2026-07-27

*Bulk granting exists, on the rollup — where the list of who needs one already was. The
whole-section half is **not being built**; it moved to [P3.17](#p317--whole-section-extension-grant--s--parked-not-planned)
with the director's reasoning, which is that a section-wide event is a due-date change and the
select-all on the rollup already reaches a whole section.*

**Shipped 2026-07-22:** the "Did not submit" panel grants extensions inline, per row (a quiet
`Extend` that appears on hover) and in bulk (checkboxes, select-all, `Extend selected (N)`), through
a modal defaulting to a week out at 2359 local. It calls the Grade tab's own `setExtension()` rather
than composing a second upsert, so the two surfaces cannot drift on what an extension is, and
re-granting amends rather than duplicating (the `(enrollment, offering)` UNIQUE key).

One reason covers a batch — `reason` is NOT NULL and non-blank-checked
(`007_extension_governance_and_review.sql:79-82`), and a group extended together shares the cause
that prompted it. Writes are sequential so a partial failure is reportable per student rather than
collapsing into one rejected promise.

**Worth keeping from the descoping:** the item read as one feature with two halves, and it was two
features with one name. Granting to *people who missed a deadline* and moving a deadline *for a
class that did not happen* are different events with different audit consequences, and merging them
under "extensions" is what made the second half look like remaining work rather than a design
question. The tell was that the second half had no natural home — it kept being described as
belonging to a page that does not grant anything.

#### P1.14 — Grade tab: a "needs grading by hand" queue, replacing the late filter · ✅ **DONE 2026-07-23**

*And the Grade tab left the nav bar, at the director's request in the same breath.*

**The filter is gone; the chip stayed.** "Submitted late" (shipped as P0.12 the day before) answered
the wrong question — an instructor does not want a section narrowed down to its late work, they want
the short list of what needs attention. The late chip on the grade card is untouched: it is context
while grading a specific student and was never what was objected to.

**In its place, one open strip of cards above the grading view**, shaped like the lesson builder's
orphan row. `buildGradingQueue()` (pure, 21 assertions in `test-grade.mjs`) + `gradingQueue()` in
`faculty-grade.js`. Each card is one student on one assignment, cross-assignment and per-student —
which is what the two `<details>` worklists it replaced could not be. They counted at *assignment*
granularity behind a closed summary, and "3 outstanding on preflight-02" tells you a number, not a
name.

Four rules are load-bearing:

- **Interactive takers never appear.** Migration 015 grades them on commit, so there is nothing for a
  human to do, and a queue listing work that does not exist stops being opened. This is the one rule
  that is a claim about *another* part of the system, so it is asserted narrowly (chosen activity ≠
  the written one) and pinned by a test.
- **An undecided submitter still appears** — nothing chosen yet means they may still land on the
  written path.
- **Late beats extension-expired** when both are true. A blown-through extension is more usefully
  named as late.
- **Scoped to the sections you TEACH**, not the ones you may see — see the entry below.

**Grade left the nav bar.** Grading is not a place you browse to, it is work that arrives: the
dashboard's due-out boxes link straight to it and the queue names the students waiting. A permanent
nav entry beside them asked "go and check whether you owe anything", which is the question those
boxes answer unasked. `grade.html` is unchanged and still reachable — from the boxes, from the queue,
from the gradebook, by URL. **The due-out row therefore carries a standing `Grade page →` link in
BOTH states, including the empty one**, or the day an instructor has nothing outstanding would be the
day the page has no route to it at all. `test-nav.mjs` pins the absence; `test-tasks.mjs` pins the
link.

<details><summary>Original scoping</summary>

**Remove the "Submitted late" filter** (shipped in P0.12, same day). It answers the wrong question:
an instructor does not want to *filter a whole section down to* late work, they want a short standing
list of the handful of submissions that need attention. The filter makes you go looking; a queue
comes to you.

*Assumption to confirm:* the **late chip on the grade card stays** — it is context you want while
grading a specific student, and it is not what was objected to. Only the filter control goes.

**Add a queue at the top of the page, shaped like the lesson builder's orphan view**
(`faculty/lessons.html` `.lb-orphans` / `.lb-orphan`). It holds late submissions not yet finalized,
and students whose **extension has expired** with work still ungraded. **Scoped to your own sections
only.** Clicking a student opens their responses to grade right there; an interactive submission is
auto-graded and must not appear at all; a written one opens Q2 and Q3 with the 3-state control and
the feedback boxes, then **Finalize** (Q1 is zero-point and stays hidden).

*(The auto-graded rule was originally written as already-true, inherited from the legacy `public`
receiver where migration `013` wrote the effort. That is what made P0.14 invisible for a month.
P0.14 and P0.16 landed first, so it is true now.)*

</details>

#### P1.8 — EI stats on the dashboard · ✅ **DONE 2026-07-23** — *and the due-out row's scope was wrong*

**The panel**: `renderEiPanel()` in `faculty-ei.js` (pure, string in / string out) against the
`summarizeEi()` that P1.4 already shipped — so it is a render, not a second query, exactly as the
scoping predicted. Two big numbers and the last five sittings, mounted below Your Sections because it
records what you have *done* rather than what is waiting on you.

**Sittings is the headline, and that is the point.** A batch of six cadets after class is ONE
session. Counting rows would tell a director they held forty sessions in a week they held nine, and
an inflated number is how a dashboard stops being read. The row count survives as "cadets seen",
where it means something. Nothing logged renders nothing at all — most instructors have no EI in week
one, and a permanent `0` teaches people to skip that region of the page.

**Built as its own panel rather than a `SOURCES` entry**, which the original scoping suggested. The
registry's shape is `{ count, action, text, link }` — a count and an imperative — and EI is neither
outstanding nor actionable. Registering it would have printed "12 · Extra instruction" in a row headed
*Needs your attention*, which is false. The registry's **rule** was taken (zero renders nothing); its
container was not.

**The finding this turned up, which was not in the item:** the due-out row itself was scoped to
`ctx.sectionIds`. A director's staff row carries `section_id NULL`, which `staff_sections()` expands
to *every* section of the offering — so "9 · Review grades" under a heading reading **Needs YOUR
attention** was counting nine other instructors' ungraded submissions. Now scoped through a new
`actionableSections()` in `schema.js`: taught ∩ visible, **falling back to visible** so a director who
teaches nothing gets the course-wide list rather than a permanently empty panel. The row says which
scope it is showing, because a panel that silently shows a subset is worse than one that shows
everything. Both halves are pinned in `test-schema.mjs` and `test-tasks.mjs`.

`taughtSectionIds()` moved from `faculty-rollup.js` to `schema.js` for this (re-exported, so
`report.html` and `gradebook.html` are untouched) — three surfaces now need it and none of them should
pull 56 KB of aggregation maths into the browser to ask a question about `ctx`.

#### P1.9 — Roster and enrollment, as one tab of Course Admin · ✅ **DONE 2026-07-23** — *corrected the same day*

**Where it landed: `faculty/admin.html` → the Students tab**, beside Staff and Export. It holds the
roster table with a search box, the registrar import and its reconciliation, account provisioning,
and section placement. Both standalone pages are deleted. A re-mount, not a rewrite:
`roster-import.js` was already pure and DOM-free, and none of the import logic changed.

**The first attempt built it as two separate pages** (`roster.html` for lookups, open to
instructors; `enrollment.html` for everything that changes who is enrolled, director-gated) and the
director corrected it within hours. The reasoning for splitting was not wrong — a destructive bulk
import genuinely should not head the page you open to check a squadron number — but the cost was
**two more nav entries for one job**, and the nav bar is the scarcer resource. Course Admin was
already where a director went to manage the offering; the roster is one more thing about the
offering.

**What the correction gave up, recorded so it is a decision and not a slip:** an instructor has no
roster lookup, because Course Admin is director-gated. That is the state PREP was in before this
item, so nothing regressed — but a claim in `instructor-accounts.md` did turn out to have been
wrong all along. It said *"any instructor assigned to the course can [reset a password], not just
the course director"*, and `reset-student-password` really does admit any staff member. **No page
has ever offered them the button**, because the only page carrying it was always director-only. The
doc is corrected. If lockouts start costing a day, the fix is a read-only Students tab for
instructors, not a password field.

**Roster's "Sections" tab went away** rather than moving — it was the assign-an-instructor UI that
P1.10 replaces. `loadSections()` and `assignInstructor()` are deleted with it. Worth recording:
`assignInstructor()` deleted every `role='instructor'` row for the section before inserting, so a
section could hold exactly one instructor. Nobody ever stated that rule, two people co-teaching is
ordinary, and the replacement does not reproduce it.

**Also 2026-07-23: `enrolment` → `enrollment` throughout.** British spelling had leaked into ~50
files' comments, prose and local variable names while the database column was `enrollment_id` all
along. Normalized across `site/`, `tests/`, `scripts/`, `supabase/admin/`, `supabase/functions/`,
`.ai/` and the live `docs/`. **Deliberately not touched:** `docs/decisions/` and `docs/contracts/`
(point-in-time records, CORE.md §5), `supabase/migrations/**` (an applied chain — the file on disk
should match what was executed, comments included), and historical `CHANGELOG.md` entries.

#### P1.10 — Section assignment: drag-and-drop, in Course Admin · ✅ **DONE 2026-07-23**

All three complaints, answered separately:

1. **Wrong place** — assignment now happens on the Section Coverage grid, where "who covers M1A" was
   already being asked. Previously it was only answerable by opening six people's modals in turn.
2. **Tick boxes were the wrong control** — drag a name chip onto a tile, *or* pick from the tile's own
   dropdown. **Both ship, and that is not optional**: drag-only is a keyboard trap and unusable on the
   tablet an instructor is actually holding. Native HTML5 drag events, matching `lessons.html`'s
   orphan cards — not SortableJS, because CORE.md §2 forbids a runtime dependency.
3. **The director copy was wrong** — it described the *data encoding* (an offering-wide row carries
   `section_id NULL`) as though it were the role, and in doing so implied a director does not teach.
   Rewritten in both places to say the two are independent and that holding both is normal.

New `addStaffSection()` / `removeStaffSection()` in `faculty-admin.js` write ONE (person, section)
pair, because that is what dropping a name means; `setStaffSections()` replaces the whole set, which
is right for the modal and would have been a silent data-loss bug here. Both **carry the person's
existing role rather than choosing one** — P0.15 was exactly the bug where a person's rows disagreed,
and `director_offerings()` grants the privilege on a director role in *any* row.

#### P1.11 — "+6 offering-wide" · ✅ **DONE 2026-07-23 — and it was worse than recorded**

Stated once above the grid, with names, since the people were already loaded.

The item said it was the same number on every tile. It is: `wide` never referenced the section it was
rendered under, and could not, because an offering-wide row covers everything. **What the item did not
know is that the number is very nearly the whole staff list.** `create-instructor` inserts
`section_id: null` by default and `setRole()` guarantees that row exists, so essentially every staff
member added through the UI holds offering-wide coverage — and `staff_sections()` expands it to every
section. The banner therefore reads "N of M hold offering-wide coverage", names them, and says plainly
what it grants.

**Filed as a consequence, not fixed here:** if everyone is offering-wide, section-scoped rows are
doing no work in RLS — they scope the *UI* (`taughtSectionIds`, and now the queues), not access.
Whether that is intended is a permissions decision for the director, and it belongs with **P3.9**.

#### P1.1 — Gradebook view · ✅ **DONE 2026-07-22**

`faculty/gradebook.html` + `js/faculty-gradebook.js`. Sticky student column, sticky header row,
shortcode headers (`preflight-02` → `PF02`), totals column, and the bulk-EI entry point. Ungated in
the nav, like Grade — an instructor sees their own sections and RLS is what enforces it.

**The scale question really was already answered.** Both modalities land on `grades.points_earned`
against the same `points_possible`, so totals sum directly and no normalization layer was written.

**Four decisions worth not re-litigating:**

- **Five cell states, and only one renders blank.** graded · draft (AI suggestion, unconfirmed) ·
  ungraded (work arrived) · missing (past due, nothing) · pending (not due). A blank that could mean
  either "not due" or "never handed in" is the defect that makes a gradebook untrustworthy.
- **A lesson counts toward the percentage only once its deadline has passed.** This is the
  due-date-aware rule P3.2 flags on the WebAssign importer, and it matters more here: without it
  every cadet reads 0% on day one because 39 lessons they cannot yet have done are counted against
  them. Missing counts zero-out-of-full; pending is not in the sum at all; a term with nothing due
  yet yields `pct === null`, not `0`.
- **Zero is its own band, and the bands are NOT the status triad.** `--d0…--d5` (the data-viz ramp),
  not green/amber/red — that palette is a contract with `question_scores[].status`
  (DESIGN.md:237-243) and a 65% total must not read as a flagged answer.
- **Narrow selects, not the shared ones.** `OFFERING_SELECT` pulls every question of every lesson;
  `GRADE_SELECT` pulls `question_scores` and `diagnostic`; `SUBMISSION_SELECT` pulls every report
  blob. A grid renders none of it. This is P3.7's performance budget applied before the grid rather
  than after — though note P3.7 itself is **not** closed: `loadRoster` still fetches every student.

⚠️ **A bug found while building, and left in place deliberately:** `faculty-data.js:148` passes
`null` as the extension argument to `effectiveDue`, so the *dashboard's* status can call a student
overdue who holds an active extension. The gradebook does not copy it. Fixing the dashboard is a
separate, testable change and is filed in §5.

**Colour layer added 2026-07-23** (director follow-up): each graded cell tints by understanding and
carries an effort bar, both on the rollup's `--s1`…`--s5` ramp, both optional so a future assignment
type that tracks neither degrades to a plain number. `zoneIndex()` reproduces `report.html`'s
`zoneVar` with a parity test so the grid and the rollup colour a 0–5 value identically. This is the
one place the "no `diagnostic`" narrowing was wrong — the written path's effort/understanding live
there — so `GB_GRADE_SELECT` now fetches it. The per-student dials carry the same ramp colour.

*Verified:* `test-gradebook.mjs` **96/0** · full suite exit 0 · boots clean in light and dark · the
colour itself rendered against the shipped CSS and screenshotted in both themes. **Not seen rendered
by a signed-in user with real data** — see the note under P1.4.

#### P1.2 — Per-student detail page · ✅ **DONE 2026-07-22**

`faculty/student.html?e=<enrollment>` + `js/faculty-student.js`. Reached from the gradebook or the
roster; no nav entry, like `report.html`. Keyed on the **enrollment**, because that is what every RLS
policy keys on — a cadet id would have to be resolved to one before anything could be read anyway.

- **This is where the two layers sit side by side, and the only place they should.** Points are the
  grade; the 0–5 effort and understanding columns are diagnostics, styled quieter and never summed.
  The grid deals only in points because a cell cannot explain itself; this page can.
- **Misconceptions folded across the term** — the one view in PREP that answers *is this student
  repeatedly wrong about the same thing?* Uses the rollup's own `canonMisconceptionId()`, so the
  two pages cannot disagree about what is one bucket.
- **The advising note**, taken wholesale from `djGradebookProject`: grade, section comparison,
  missing work **named with due dates**, understanding average, recurring sticking points, EI count,
  free text, Copy. Plain text on purpose — it is going into an email.
- **`backTarget()` allowlists rather than same-origin-checks.** `document.referrer` is
  attacker-controllable; it returns a bare relative filename from a six-entry list, never the
  referrer itself.
- **Q1 stays hidden**, filtered by the points *property* rather than by position — which is exactly
  the defect LEGACY-AUDIT:102-108 flags as still open elsewhere.

**On the FERPA requirement:** the entry asked for section-scoping in RLS rather than the UI. That
was **verified, not added** — `students`, `enrollments`, `grades`, `submissions`,
`submission_activities` and `ei_sessions` all already gate on `staff_sections()`, and
`app_rls_test.py` pins it per persona. "Not found" and "not yours" deliberately return the same
message, since telling an instructor a cadet exists but belongs to someone else is itself a
disclosure.

*Verified:* `test-student-detail.mjs` **56/0** · full suite exit 0 · boots clean in light and dark.

#### P1.4 — EI logging, single and bulk · ✅ **DONE 2026-07-22**

Migration `011_ei_sessions.sql` (**applied**) + `js/faculty-ei.js` + a modal on each of the two new
pages. Both paths shipped in one pass, per this item's own instruction that a bulk-as-bolt-on design
"will be abandoned by week three".

**Schema decisions, each recorded in the migration header because each reads as an oversight
later:** keyed on `enrollment_id` (makes the RLS predicate byte-identical to the reviewed one on
`extensions`) · **no unique constraint**, because EI is repeatable and a unique key would silently
swallow the second visit · **`batch_id`**, so one sitting is one correctable unit and "how many
sessions did I hold" has an answer · **no self-attribution trigger**, unlike `review_signoffs`,
because a director logging for the colleague who ran it is a real case and an EI row confers
nothing · **no student read policy at all**, per §6 Q3 — the absence *is* the enforcement, and it
matters because `notes` holds an instructor's candid read of a cadet.

- **Writes are sequential, failures per student.** "Logged 4 of 6, failed: Smith, Jones" is
  actionable; one rejected promise is not. Copied from the P1.12 extension batch.
- **UTC stored, local rendered**, with both conversions pure and round-trip tested — a session
  logged an hour off still looks fine, which is why it needs a test rather than a review.
- **Editing does not re-attribute.** An edit corrects the record; it does not change who held it.

*Verified:* `app_invariant_test.py` **33/33** (11 new) · `app_rls_test.py` **45/45** (10 new,
including *a student cannot read their own EI log*) · `test-ei.mjs` **82/0**.

> ⚠️ ~~**The one real gap across all three.**~~ **Partly closed 2026-07-27** — the director walked
> these pages on the live site and they work, which retires the "never seen rendered by a signed-in
> faculty user" half for good. A harness run is no longer wanted and **no longer gates P0.2's
> deletion of the test faculty account.**
>
> **What remains is a data gap, not a looking gap:** there is still **no EI data and no late work in
> the term** (the active preflight is due Aug 9), so bulk logging and the late chip are exercised by
> fixtures only. That cannot be walked into existence — re-check in week one.

<details><summary>Original scoping — P1.1, P1.2, P1.4</summary>

**P1.1 — Gradebook view · L · *unblocked — the scale question is already answered by the data***

*Requested.* Still the largest item here, but **materially smaller than first scoped.** The
open question that was going to block it turned out to be already resolved in the schema:

**Both modalities already land on the same 2-point grade — by two different mechanisms.** Keep the
two layers straight; conflating them is how this gets built wrong:

- **Measurement is 0–5 and is very much live.** `q2_effort` and `q3_understanding` are 0–5 integers
  in `grades.diagnostic` (`preflight-analyze/SKILL.md:319-320`); the schema:1 payload carries
  `effort` 0–5 (clamped to 2 when the reading reflection is not meaningful) and
  `overall_understanding` 0–5 (`SKILL.md:569-570`). The interactive artifact emits effort on the same
  0–5 scale.
- **The grade is 2 points**, reached two ways:

| Modality | `grading_mode` | How points are set | Result |
|---|---|---|---|
| Interactive lesson | `effort` | DB trigger `001_core_model.sql:579-584`: `effort ≥3 → possible` · `≥1 → possible/2` · `else 0` | Full effort **2**; capped effort (clamped to 2) **1** |
<!-- Amended twice since: migration 014 keys the trigger on the grade ROW rather than `grading_mode`,
     and migration 019 (2026-07-30) makes the partial branch `LEAST(1, possible)` instead of
     `possible/2`. Both leave this row's *numbers* correct, because the analysis assumed a 2-point
     assignment and at 2 points every version of the curve agrees. -->

| Written preflight | `points` | `question_scores` — Q1 `points: 0`, Q2 reflection `1`, Q3 free response `1` (`build_fall_preflights.py:216,235-236`; identical in `build_110_preflights.py:219,236-237`) | Reflection **1** + free response **1** = **2** |

On the written path `effort` is **diagnostic only and must not be written to `grades.effort`** —
those offerings are `grading_mode='points'` and the trigger would seize `points_earned`
(`WRITTEN-SCHEMA1.md:118-121`).

Offering ceiling for both: `points_possible numeric(6,2) NOT NULL DEFAULT 2`
(`001_core_model.sql:255`).

**So no normalization layer is needed.** Both paths write `grades.points_earned` against the same
`points_possible`, so the gradebook sums them directly and is correct by construction. The 0–5
scales stay available underneath for the per-student view (P1.2) and the rollup histograms (P1.5).

⚠️ **`PROJECT.md:91-98` will mislead whoever builds this** — it shows `scores.question_scores` with
q1/q2/q3 each `"max": 5`, i.e. 15 points per preflight. **Only that per-question points shape is
retired** (both Fall builders now write 0/1/1); the 0–5 effort and understanding scales documented
elsewhere in the same file are current. Fix the example block, leave the diagnostics section alone
(see §5).

Design notes, with `djGradebookProject` mined for what is worth taking:

- **Shortcodes as column headers** (`PF01`, `HW03`) keep columns ~5rem wide. Derive a short form from
  the lesson slug.
- **Percentage → semantic class**, six bands, one function driving all color everywhere
  (`helpers.py:286` + `style.css:779-808`). The key idea worth stealing: **zero is its own band**
  (missing work) distinct from merely failing. PREP's 3-state (`full`/`warn`/`zero`) already covers
  per-question color; the band scale is for the *totals* columns.
- **`is_bonus`** (numerator only) and **`include_prog`** — two booleans that avoid needing a weighting
  engine at all. PREP has no weighting today, and these two flags may be sufficient forever.
- Its own grid is the **weakest** part of that project — no sticky columns, no virtualization,
  DataTables pagination. Do not copy it.

PREP should do better on two points: **sticky student-name column + sticky header row** (essential
past ~8 lessons), and a **bounded fetch** — `loadRoster` already fetches every student in the
database and filters client-side (`faculty-roster.js:11`), which a gradebook makes untenable.

Depends on: P1.2 (name click target), P1.3 (settings persistence, for column prefs).

**P1.2 — Per-student detail page · L**

*Requested.* Reached by clicking a name in the gradebook. Shows completion, effort levels,
understanding levels, free-response answers, interactive reports, and whatever assignment types come
later.

`djGradebookProject`'s `student_view.html` is a strong template — three stat cards (identity /
performance / class comparison), performance-by-category bars, missing-work table, all-assignments
table. Two ideas there are worth taking wholesale:

- **The Comment Card** — an auto-assembled advising blurb (grade, per-category breakdown, missing
  work with due dates, EI attendance and dates, plus a free-text box) with a **Copy to Clipboard**
  button. Instructors paste it into an email or an advising system. This is exactly the "copy for
  slides" muscle the Report tab already has (P0.6), pointed at one student.
- **`back_url` from the referrer** — "Done" returns you wherever you came from, so the page works
  equally as a gradebook drill-down and a roster drill-down.

**FERPA note:** this page concentrates everything about one cadet on one screen. Instructor access
must be section-scoped in **RLS**, not just in the UI.

**P1.4 — EI (Extra Instruction) logging, single and bulk · M**

*Requested.* On the student detail page, a button opens a modal prefilled with **today's date, the
current local time, and a 30-minute duration**, editable before confirming.

**Bulk logging is core to this item, not an add-on.** The director's actual use case is the ~20
minutes at the end of every class when students hang around to ask questions — so the common event
is *several students at once, most days*, not a scheduled one-on-one. A design that only logs one
student at a time will be abandoned by week three. Build the roster-multi-select path in the same
pass: pick a date/time/duration once, tick the students who were there, log.

`djGradebookProject`'s `EIVisit` model is deliberately minimal — `date_time`, `notes`, FKs — and its
interaction pattern is the good part: **log-now-with-one-click, correct-later-in-a-modal**, with
row-click opening the edit modal.

Proposed shape — `app.ei_sessions`: enrollment (or student + offering), staff id, `started_at`,
`duration_minutes`, `notes`, `created_at`. **RLS: staff of the offering only — students cannot read
their own** (director's decision; additive to open later, breaking to close).

Timezone: reuse the `zoneinfo` America/Denver handling from
`scripts/fall2026/build_fall_preflights.py`. Store UTC, render local.

</details>

#### P1.3 — Persist user and account settings · ✅ **DONE 2026-07-22**

Built as scoped. `app.user_preferences` (migration `010`, **applied**) — `user_id` PK, one jsonb
`prefs`, RLS self-only on all four verbs. `site/js/prefs.js` is the write-through cache:
localStorage stays the read path, the row is the durability path, `hydrate()` runs inside
`bootstrap()` before anything reads a preference.

**Three things worth knowing that the scoping did not anticipate:**

- **"Match my system" was broken, and this is what surfaced it.** `setTheme('system')` stored the
  literal string `'system'`, which the anti-FOUC snippet read as *neither* null *nor* `'dark'` —
  so it painted light. Choosing "Match my system" has meant "always light" for as long as the
  control has existed. Absence is now the encoding, which is what the snippet always expected.
- **The policies cannot call `auth.uid()`.** The app tier has no privileges on schema `auth` at
  all, so a policy written that way fails at CREATE time. `002_rls.sql` already solved it with
  `app.current_uid()`, reading the same JWT claim. Same boundary as P0.5's blocker, from the
  other direction.
- **`prefs.js` must import `supabase.js` lazily.** A static import gave `theme.js` — and therefore
  `nav.js`, and therefore every page's chrome — a hard dependency on a live client just to read a
  cached theme. Two existing suites caught it immediately. Same pattern `run-banner.js` documents.

**Not synced, deliberately:** the nav-open key, run-banner dismissals, and the System > Data column
picker. The test is whether a setting describes the *person* or the *device*; a sidebar width does
not follow you to another machine.

*Verified:* `test-prefs.mjs` 28/0 — including a live round-trip and the RLS re-key attack the
UPDATE policy's WITH CHECK exists to stop — plus full `tests/app-schema` 339/0. **Also verified in
a real browser:** a signed-in page load wrote `cp.currentOffering` to the row.

#### P1.5 — Understanding-by-objective as an integer histogram · ✅ **DONE 2026-07-22**

Built as scoped, on top of P1.3. `objIntChart()` reuses `effortChart()`'s exact markup, ramp and
metrics — that is the requirement, not a coincidence, so anything that changes there must change
here. `objChart()` dispatches on `cp.rollup.understanding`; the account page carries the control.

**The default is the histogram and the curve is the opt-in** (`'curve'`), which is what "default
off" meant. The argument for flipping it: the effort chart directly above is an integer histogram
of the *same* 0–5 measure, and drawing the two in different visual languages invites a reader to
assume they are different kinds of quantity. They are not — both are counts of students per score.

The KDE curve is kept and fully working. It genuinely reads better for a large cohort where the
integer bars go spiky, and the `?kde=1` tuner (P0.10) still tunes it.

*Verified:* `node --check`, full suite 339/0. **Not yet seen in a browser** — folded into P0.5.

#### P1.6 — Dashboard: outstanding tasks panel · ✅ **DONE 2026-07-22** — *and it is also P1.15*

Built as the registry P1.6 describes, rendered in the shape P1.15 asked for, because P1.15 says to.
Treating them as two items would have produced two panels answering one question.

`site/js/faculty-tasks.js` — `SOURCES` is an array of `{id, severity, icon, director, load()}`,
and adding the sixth is an entry, not a rewrite. All five scoped sources shipped: work past due and
unfinalized · AI-suggested grades awaiting review · lessons past due with no readiness rollup ·
sections with nobody assigned · failed or stalled scheduled runs.

**Decisions that are load-bearing:**

- **A source returning zero renders nothing.** Most of these are empty most of the term, and a row
  of permanent `0`s is how a panel teaches people to stop reading it.
- **A source that throws is dropped, not fatal.** This sits at the top of the dashboard; one dead
  query must not cost the page.
- **The panel loads after first paint**, not into it. Five extra round trips should not make every
  dashboard load as slow as the slowest source.
- **Two sources are director-only as a UI convention** — `analysis_reports` and `analysis_runs`
  admit any staff member of the offering under RLS, exactly like the run banner. Enforced here or
  not at all, which is why there is a test pinning the list.

*Verified:* `test-tasks.mjs` 19/0 — registry invariants, failure isolation, the zero rule, director
gating, and escaping — plus full suite 339/0. The individual `load()` queries need a signed-in
director and are **deliberately** left to P0.5 rather than mocked into a false green.

#### P1.7 — Dashboard course switcher · ✅ **DONE 2026-07-22**

Both halves, as scoped. `courseSwitcher()` sits under the page head — a `.seg` group up to four
courses, a `<select>` beyond — driving `ctx.setCurrentOffering()` and then re-mounting, since
sections, lessons and tasks are all course-scoped.

**And the section control now picks a section.** It was two buttons, all-vs-mine, so "how did M3A
do?" — the most ordinary question a director asks — had no answer on this page. Now `all` · `mine`
· every section, with the same segmented-to-dropdown threshold. `mine` is hidden when it is not a
real subset (teach every section, or none) rather than rendering an option that duplicates `all`.

The rollup's `renderScope()` was **copied in shape, not lifted**: it lives inside `report.html`'s
page script and is bound to its scope variables. Extracting it into a shared module is worth doing
when a third caller appears, not for the second.

*Verified:* full suite 339/0. **Not yet seen in a browser** — folded into P0.5.

#### P1.15 — Dashboard: due-out boxes · ✅ **DONE 2026-07-22 — shipped as P1.6**

*Built in the same pass and from the same registry, per this item's own instruction. See P1.6 for
what shipped. Every box named in the table below exists; "zero disappears rather than sitting there
reading 0" is implemented and tested.*

<details><summary>Original scoping</summary>

A row of boxes at the top of the faculty dashboard, one per **type** of outstanding work, each with
a count. Clicking one goes to the page that clears it. Not one box per item — one per kind.

Likely types, all of which already have a data source:

| Box | Source | Goes to |
|---|---|---|
| Late / expired-extension work to grade | `pastDueUngraded()` — *and `extensionsToGrade()`, which P1.14 replaced with `buildGradingQueue()` on 2026-07-23* | Grade (P1.14's queue) |
| AI-suggested grades not finalized | `grades.is_finalized = false` | Grade |
| Lessons past due, not yet aggregated | `lesson_aggregate.py worklist` | the rollup |
| Sections with no staff assigned | Section Coverage | Course Admin |
| A failed or stuck analysis run | `analysis_runs` | already the run banner |

This is the concrete form of P1.6's "outstanding tasks panel" — build it as the registry P1.6
describes (`{severity, text, link, count}`) so a new type is a registration, not a rewrite. **Zero is
the common state for most of these most of the term**, so a box at zero should disappear rather than
sit there reading `0`.

</details>

#### P1.13 — Container for unrecognized flags · ✅ **DONE 2026-07-22**

*Director's Q4 decision: surface unknown flags in the summary so an instructor can see what the AI
writing them was thinking.* Gap confirmed as scoped — the pill bar's 5-key whitelist, the rollup's
two booleans, and a single hard-coded `flags.note` read in the student panel.

- **`residualFlags()`** in `faculty-rollup.js` returns `[key, detail]` pairs for anything outside the
  recognized set (`needs_follow_up`, `notable`, `note`). A `false`/null/empty value is a flag the
  producer **cleared**, not raised, and is dropped — otherwise `{suspected_ai: false}` on every
  student would read as a cohort-wide flag.
- **"Other flags"** row in the student panel, rendered verbatim and **unstyled** — presenting an
  unrecognized flag in the vocabulary of the recognized ones would assert a meaning PREP has not
  agreed to.
- **A neutral pill**, named by the keys actually coined. *This exceeds the original wording
  ("uncounted and unstyled")* — a container reachable only by opening students at random would make
  the taxonomy work no more observable than dropping the flags. Counted per student to match the
  modal it opens; kept out of the recognized tallies.
- `summarizeReports()` now returns `flags.other` and `flags.otherStudents`.

*Verified:* `test-rollup.mjs` **190/0** (30 new) · full `tests/app-schema` exit 0. **Not yet seen in
a browser** — folded into P0.5.

Still the **cheap half of P3.3**, and the taxonomy work is now observable before the taxonomy exists.
Deliberately left: `lesson_aggregate.py`'s Python `summarize()` still tallies only the two recognized
booleans — teaching the aggregator to write prose about flags whose meaning is undefined belongs with
P3.3, not ahead of it.