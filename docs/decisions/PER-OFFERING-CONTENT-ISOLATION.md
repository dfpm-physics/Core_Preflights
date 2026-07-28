# Per-offering content isolation — stop two terms sharing one lesson

**Status:** **done, 2026-07-28.** The browser no longer shares content between offerings (§8 steps
1–6) and the 42 rows that were already shared have been separated (step 7, run against live — §13).
`content_isolation_check.py` reports clean. **No DDL was run and none was needed**; §6 is deferred,
not resolved, and is still wanted before Fall 2027. Step 8 — five rebuilt artifacts — is the
director's and is outstanding.

*Authored 2026-07-28 by Matthew Recker (via Claude), from a faculty-beta session against the live
Fall 2026 offering. Companion to [`PREP-V2-SCHEMA.md`](PREP-V2-SCHEMA.md), whose cross-term reuse
rationale this partially reverses, and to
[`../contracts/INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md) §3.2.
See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It settles one question: **should a lesson's content be shared between
> course offerings, or copied into each one?** PREP v2 chose shared. That choice is now producing
> data-loss hazards and cross-term write exposure on a live system. This records why we are
> reversing it, what we rejected, and the exact order the work has to happen in.
>
> **Read this before touching `activities`, `assignments`, or anything in `faculty-lessons.js`.**
> A fresh operator who skips it will re-derive the sharing rationale from `PREP-V2-SCHEMA.md` §2
> and undo the fix.

---

## 1. Problem

`activities` (the content — questions, artifact URL) hangs off `assignments` (the term-free library
container), not off `assignment_offerings` (one term's run). So **two offerings that schedule the
same assignment share one content row.**

That is currently true of the live system in the sharpest possible way. On 2026-07-27,
[`scripts/fall2026/split_training_offering.py`](../../scripts/fall2026/split_training_offering.py)
created a clean phys-215 × `fall-2026` offering alongside the existing one, which was repointed to
a new `training-fall-2026` term:

| | offering id | holds |
|---|---|---|
| **Real** | `b9e6b3da-776e-4a8f-8355-e107bea63f9a` | created with **zero** sections, enrollments, submissions, grades |
| **Sandbox** | `ce946b19-…` (TRAINING SANDBOX — Fall 2026) | 81 seeded students (all `email IS NULL`), ~212 synthetic submissions |

The script copied **37 `assignment_offerings` + 42 `offering_activities` pointing at the SAME
shared activities** — deliberately, and it says so in its own header. Three consequences, all live:

**1.1 — Replacing an interaction is impossible once anyone has committed to it.**
The reported symptom, on a lesson holding 8 student reports:

```
Could not replace the interaction: submission e02130b7-…: an unlock must set
unlocked_by so it is attributable
```

Chain: deleting an `activities` row cascades `offering_activities`, which fires
`submissions_activity_in_offering` (`ON DELETE SET NULL`) to null `submissions.chosen_activity_id`.
That cascade is an `UPDATE` on `submissions`, so `submissions_lock_activity()` fires, sees a
committed choice becoming NULL with no `unlocked_by`, and refuses. The whole statement rolls back.
The trigger is correct — migration `006` hardened it after a student was shown able to self-unlock —
and the director is shown an internal trigger message naming a raw uuid.

**1.2 — Editing a lesson in one term silently rewrites the other.**
`content_snapshot` exists to prevent exactly this
([`001_core_model.sql:276-279`](../../supabase/migrations/app/001_core_model.sql#L276-L279)) but is
written only by [`scripts/app_migration/freeze_term.py`](../../scripts/app_migration/freeze_term.py),
an **end-of-term operator action**. Nothing in `site/` writes it. So it protects *past* cohorts and
does nothing for two *concurrent* offerings.

**1.3 — Sandbox staff can write real-term content.** `activities_write` (`002_rls.sql`) is scoped by
**course**, not offering:

```sql
USING (EXISTS (SELECT 1 FROM assignments a WHERE a.id = activities.assignment_id
                 AND a.course_id IN (SELECT director_courses()) ...
```

`PREP Test Faculty` — a shared credential the split deliberately kept — can be provisioned
`--role director` ([`scripts/test_faculty_account.py:38`](../../scripts/test_faculty_account.py#L38)).
A director in the sandbox is a director of *phys-215*, which grants write on every phys-215 activity,
which are the rows Fall 2026 serves. **The sandbox isolates student data; it does not isolate
content at all.**

---

## 2. Goals and non-goals

**Goals**

- A lesson's content belongs to exactly one course offering. Nothing a director does in one term can
  read, edit, or delete another term's content or student work.
- "Duplicate this lesson from another offering" produces a **brand-new assignment carrying the
  content**, connected to the original by lineage only.
- Submissions and reports resolve to an artifact and assignment unique to their offering.

**Non-goals**

- Changing the artifact↔site **wire format**. The endpoint, the `#t=`/`#i=`/`#r=`/`#d=` keys, and the
  lz-string codec are frozen (contract §2, §8) and are not touched.
- Rewriting existing slugs. Old readable slugs stay; only newly minted ones change.
- Merging `assignments` into `assignment_offerings`. The two-layer model survives; only the
  uniqueness scope and the copy semantics change.
- Preserving cross-term reuse. See §7 — this is the capability being traded away.

---

## 3. Constraints

These are hard and were each verified against the repo, not assumed:

- **`activities.slug` is `text NOT NULL UNIQUE`, globally**, and commented `FROZEN CONTRACT SURFACE`
  ([`001_core_model.sql:156-159`](../../supabase/migrations/app/001_core_model.sql#L156-L159)).
  Deployed artifacts post `#i=<slug>` and send no other context.
- **`assignments_slug_unique UNIQUE NULLS NOT DISTINCT (course_id, slug)`** — so phys-215 can hold
  only one `preflight-02`. This is what blocks a deep copy today.
- **DDL on `app` is sealed** — *as documented*. CORE.md §0 states `prep_app_owner` is `NOLOGIN` and
  that a human must `ALTER ROLE prep_app_owner LOGIN` as `postgres`, run the change alone, and
  re-seal. **Checked against the live database 2026-07-28: `pg_roles.rolcanlogin` is `true` for
  `prep_app_owner`. The seal is currently OFF.** Nothing here relied on it either way — this work
  ran as the DML tier and issued no DDL — but the discrepancy is recorded because the gate is
  asserted as closed in the operating contract and is not.
- **`writtenSlugFor(courseCode, assignmentSlug)`** returned `<course>-<slug>-written` —
  deterministic, so any copy collided on the global unique index. **Fixed 2026-07-28:** it is now
  `mintWrittenSlug()`, which appends 8 random hex ([`faculty-lessons.js`](../../site/js/faculty-lessons.js)).
  This constraint was the reason sharing was not a choice the code made but the only arrangement
  the slug permitted.
- **~~The Fall 2026 offering's emptiness is unverified.~~ Verified 2026-07-28** — see §12. It holds
  **375 enrolled cadets across 17 sections, all published, and ZERO submissions or grades.** That
  is what makes the repair safe at all: content can be swapped underneath a live schedule because
  there is no student work hanging off it. `assignment_offerings` deletes cascade to submissions,
  grades and `assignment_due_dates`, so the run captures the due dates first and restores them —
  and refuses outright if it finds any submission or grade (§13).

---

## 4. Options considered

| Option | Verdict |
|---|---|
| **Leave sharing; rely on the new refuse-guard** (§8, already written) | Rejected. It prevents the *delete*, not the *edit* (1.2) or the write exposure (1.3), and it permanently blocks a legitimate action rather than making it safe. |
| **Relax `activities.slug` to unique-per-assignment; resolve slug→activity via the student's enrollment** | Rejected. It works — `resolveActivityBySlug()` already filters by `ctx.currentOffering` at step 2, so only step 1 depends on global uniqueness — but it relaxes a constraint explicitly marked frozen and rewrites the receiver. Larger blast radius for the same outcome. |
| **Per-offering generated slugs; deep copy on duplicate** | **Chosen.** See §5. |
| **UUID the `assignments` slug too** | Rejected. Unlike `activities.slug` (machine-only), the assignment slug is the handle humans type: `/preflight-analyze phys-215 preflight-2 M`, `/lesson-cycle phys-215 preflight-02 M` ([`SKILL.md:25`](../../.ai/skills/lesson-cycle/SKILL.md#L25)), `lesson_aggregate.py --lesson preflight-08`. Addressing lessons by *number* instead would defuse this (`assignment_offerings.position`), but that column is **nullable and non-unique**, so it needs its own ambiguity path — three skill changes to avoid one line of DDL. Filed as a separate improvement, not a reason to UUID the slug. |

---

## 5. Decision

**Content is copied per offering, and the interaction slug is generated per offering.**

1. **Interactive slugs become per-offering and are never reused.** Format
   `<readable-stem>-<8 random lowercase hex>`, e.g. `lesson-02-charge-a3f9c1e2`. Generated once per
   artifact build; the identical string goes into the artifact's `#i=` and the prefill link's `id=`.
   **This keeps `activities.slug UNIQUE` true rather than relaxing it** — collisions become
   impossible instead of tolerated, so the frozen constraint, the wire format, and
   `resolveActivityBySlug()` are all untouched. Recorded as contract **§3.2**.
2. **Written slugs are generated too**, for the same collision reason. Invisible: nothing renders a
   written activity slug and nothing reconstructs it (§9).
3. **Duplicate = deep copy** — new `assignments` row + new `activities` rows carrying the content,
   with `origin_assignment_id` recording lineage so cross-term analysis stays joinable by ancestry
   rather than by shared identity.
4. **`assignments` slug uniqueness stops being course-scoped** — see the open decision in §6.

---

## 6. OPEN DECISION — unseal, or rename the sandbox

The deep copy needs two `preflight-02` rows under phys-215, which `assignments_slug_unique` forbids.
Two ways out; **this is the one thing a fresh operator must get a human answer on before proceeding.**

**Option A — drop the constraint (recommended).**

```sql
ALTER TABLE assignments DROP CONSTRAINT assignments_slug_unique;
```

One line. No new column, no backfill, no semantic shift. Safe because **nothing keys on
`assignments.slug`** (§9). Uniqueness moves to `saveLesson()` — "this offering already has a lesson
called preflight-02" — which is where the useful error message belongs anyway. Costs one
unseal/reseal coordination event. Needed for Fall 2027 regardless, which will collide with Fall 2026
exactly as the sandbox does now.

**Option B — rename the sandbox's assignments** (`preflight-02` → `preflight-02-training`). No DDL,
no unseal. The real term keeps clean slugs and the disposable training data gets ugly ones, which is
the right way round. Defers Option A rather than replacing it.

A third variant — adding `assignments.course_offering_id` and making uniqueness
`(course_offering_id, slug)` — is the most "correct" but makes `assignments` 1:1 with
`assignment_offerings` and `course_id` redundant. More change than the collision requires.

---

## 7. Consequences

- **One artifact can no longer serve two terms.** Each term's lesson needs its own artifact, rebuilt
  or re-issued with a fresh suffix. This is the capability being traded away, and it is deliberate —
  it is what put 8 student reports one confirm-click from deletion.
- **Re-adding Fall 2026's interactions is real work.** After the rebuild, the old readable slugs
  belong to the *sandbox's* activity rows, so existing artifacts cannot be re-pointed. Each
  interactive lesson Fall 2026 needs live requires a rebuilt artifact.
- Slugs get longer and less typeable; the readable stem keeps them greppable.
- `lesson_aggregate.py`'s cross-offering ambiguity ([:631-635](../../supabase/admin/lesson_aggregate.py#L631-L635))
  **resolves itself** — the activity slug becomes a valid disambiguator once offerings stop sharing rows.
- Until the backfill lands, Fall 2026 and the sandbox still share content. §1.2 and §1.3 remain live.

---

## 8. Plan, in order

*Revised 2026-07-28 after the census in §12. Steps 6–7 used to read "delete the real offering's 37
`assignment_offerings` and rebuild". **That is no longer the plan** — the offering turned out to
hold 375 enrolled cadets and zero student work, so its rows are REPOINTED at private copies
instead. Nothing cascades, publish state and deadlines survive, and the sandbox is not touched at
all. The director's decision on §11.2 was **keep the sandbox**, so steps 5–8 are live work rather
than the shortcut of retiring it.*

1. ~~Guard `replaceInteractive()` — refuse when another offering schedules the activity; unlock
   committed submissions attributably before any delete.~~ **Done.** Also fixes the identical latent
   bug in `saveLesson()` step 4.
2. ~~Contract §3.2 — the slug-generation rule for artifact producers.~~ **Done.**
3. ~~**Written slug generation** — replace the deterministic mint with a suffixed one.~~ **Done.**
   `writtenSlugFor()` → `mintWrittenSlug()`, `<course>-<slug>-written-<8 hex>`.
4. ~~**Copy-on-schedule** in `saveLesson()`.~~ **Done.** Scheduling a container another offering
   already runs inserts a new `assignments` row and new `activities` instead of attaching to the
   shared ones; the interaction is refused with an explanation rather than a unique violation. The
   page names the other term on the library card and again in the editor, before the save.
   `origin_assignment_id` is **not** part of this — it is DDL, and §6 defers all DDL to one unseal.
5. ~~**Resolve §6.**~~ **Resolved without DDL, for now.** A copy takes the clean slug when it is
   free and otherwise term-qualifies it (`preflight-02-spring-2027`) — `freeAssignmentSlug()`.
   Option A (dropping `assignments_slug_unique`) is still the right end state and is still needed
   before Fall 2027 wants a clean `preflight-02`; it is now a scheduled improvement rather than a
   blocker, to be bundled with `origin_assignment_id` in a single unseal.
6. ~~**Verify the real offering is empty.**~~ **Done — §12.** 375 enrolments, 0 submissions,
   0 grades, 0 `content_snapshot`.
7. ~~**Give the real offering private content**~~ **Done — run against live 2026-07-28**, see §13.
   `scripts/fall2026/isolate_offering_content.py --commit`.
   *The offering rows are RECREATED, not repointed.* Both were on the table and they cost the same;
   the director's call was that building fresh rows from a captured template is easier to reason
   about than updating a foreign key in place, and with no student work to strand there is nothing
   to choose between them on safety. What was **rejected** is deleting the `course_offerings` row
   itself: that cascades 17 sections, 375 enrolments and **27 staff rows**, none of which the
   content change requires, and the roster import rebuilds only the first two.
8. **Re-add interactions** — each a rebuilt artifact with a fresh §3.2 slug. Director-driven.
   Five lessons are waiting: `preflight-02`, `-03`, `-04`, `-05` (all were `practice`) and
   `preflight-07` (was `graded`; its written activity now carries the credit).
9. **Optional, independent:** address lessons by number in the skills; **demote `PREP Test Faculty`,
   which is a director on `phys-110 / fall-2026` — a REAL offering, not only the sandbox** (§12);
   retire the sandbox once faculty training is finished, which deletes the whole problem surface.

---

## 9. Facts already verified — do not re-derive

Each of these was checked against the repo during the session that produced this doc:

- **Nothing keys on `assignments.slug`.** It is read in ~15 places (`faculty-grade.js`,
  `faculty-gradebook.js`, `faculty-tasks.js`, `faculty-admin.js`, `lessons.html`), all display or
  export. The **only** `.eq('slug', …)` in the codebase is on `activities.slug`, in
  `resolveActivityBySlug()` ([`student-data.js:319`](../../site/js/student-data.js#L319)).
- **No page renders a written activity slug.** `lessons.html:371` renders the *assignment* slug —
  `libraryCard(a)` takes an assignment, not an activity.
- **Nothing reconstructs `<course>-<slug>-written` at runtime.** `lesson_aggregate.py:646` *reads*
  `act.slug` from its query. The only code that mints that string is
  `scripts/app_migration/migrate_public_to_app.py:248`, a one-time migration already run.
- **No student is enrolled in both offerings.** The split copied no sections and no enrollments, and
  all 81 sandbox students have `email IS NULL`. Slug resolution can never be ambiguous for a student.
- **`assignment_offerings.position` is nullable with no unique constraint** — the index
  `(course_offering_id, position)` is non-unique. It is a display-ordering field, not a key.
- **`resolveActivityBySlug()` already scopes step 2 to `ctx.currentOffering`.** Only its step 1
  depends on global slug uniqueness.

---

## 10. State of the working tree at handoff

> **Superseded 2026-07-28.** Everything below landed in commit `69b4eb5` except the contract edit,
> which is in the same commit as this revision. The table is kept because it records *what* step 1
> touched. For the current state see §8: steps 1–6 are done, step 7 is the script named there,
> steps 8–9 are the director's.

**Ten files modified, nothing staged, nothing committed, nothing pushed.** These are steps 1–2 above
plus an unrelated batch of roster-import corrections from the same session:

| File | Why |
|---|---|
| `site/js/faculty-lessons.js` | `unlockCommittedTo()`, `otherOfferingsUsing()`, guarded `replaceInteractive()` (signature changed — now takes `ctx` and `offeringId`) |
| `site/faculty/lessons.html` | updated call site + swap-confirm copy |
| `docs/contracts/INTERACTION-DATA-CONTRACT.md` | new §3.2 |
| `site/js/roster-import.js` | squadron optional; `Major 1` labels |
| `site/faculty/admin.html` | import copy; empty-section-map fix; **+ Add section** control |
| `site/js/faculty-roster.js` | `createSection()` wired; error-message fix |
| `tests/app-schema/test-roster-import.mjs` | +14 assertions |
| `site/help/instructor-accounts.md`, `site/help/admin-system-operations.md`, `docs/operations/SYSTEM_GUIDE.md` | corrected the "sections are created only by the import" rule |
| `CHANGELOG.md` | entry for all of the above |

**Verification status:** `test-roster-import.mjs` 120/120, `test-imports.mjs` clean, both inline page
scripts syntax-checked. **Node-only — no browser and no live-database exercise.** The + Add section
modal, the first-import preview, and the interaction-swap guard are unproven against real data.

`python scripts/docs/check_doc_sources.py` currently flags three docs; all three are updated and
carry `reviewed: 2026-07-28`, so they clear once committed. Run
`python scripts/docs/check_doc_sources.py status --write` before committing.

---

## 11. Open questions

1. ~~**§6 — unseal or rename?**~~ **Neither, yet.** The copy term-qualifies its slug when the clean
   one is taken, so no DDL is needed to ship isolation. Dropping `assignments_slug_unique` remains
   the better end state and is now bundled with question 4 into one future unseal — **needed before
   Fall 2027**, which will collide with Fall 2026 exactly as the sandbox does now.
2. ~~**Is the sandbox still needed?**~~ **Yes — decided 2026-07-28.** Faculty training continues, so
   the shortcut of retiring it is off the table and step 7 is real work. Revisit when training ends:
   retiring it then still deletes the whole problem surface, and the copies made in step 7 mean
   nothing of the real term's goes with it.
3. ~~**Does Fall 2026 have student work yet?**~~ **No — §12.** 375 enrolments, zero submissions.
   That is what made step 7 a repoint rather than a rebuild.
4. **Should `origin_assignment_id` be added now or when the DDL is unsealed?** Deferred to the same
   unseal as question 1. Until then a copy's ancestry lives in the step-7 script's committed
   mapping file and in the CHANGELOG — enough to answer "where did this come from", not enough to
   join on. It is not required for correctness, only for cross-term analysis.

---

## 12. Live-state census — 2026-07-28 (read-only, `prep_app_read`)

Run with `supabase/admin/content_isolation_check.py` and an ad-hoc read; **nothing was written.**
These numbers are what revised §8 and closed three of the four questions above.

| | phys-215 · **fall-2026 (real)** | phys-215 · **training-fall-2026** | phys-110 · fall-2026 |
|---|---|---|---|
| sections / enrolments | 17 / **375** (all with a real email, all provisioned) | 4 / 80 (**none** with an email) | 0 / 0 |
| assignment_offerings | 37, **all published** | 37, all published | 37 |
| submissions / grades | **0 / 0** | 211 / 211 | 0 / 0 |
| per-section due rows | 34 | 148 | — |
| `content_snapshot` | 0 | 0 | 0 |

- **All 37 containers and all 42 activities are shared** between the two phys-215 offerings —
  37 written + 5 interactive. phys-110 shares nothing (it has one offering).
- **211 student reports hang off shared activity rows**, every one of them the sandbox's:
  `lesson-04` 70, `lesson-02` 8, `preflight-03` 70, `preflight-02` 63.
- The real offering's 5 interactive lessons are **published to 375 cadets now**: `preflight-02/03/04/05`
  as `practice`, **`preflight-07` as the graded activity** — which is why detaching it in step 7
  has to be paired with promoting that lesson's written activity, or lesson 07 has nothing graded.
- **`PREP Test Faculty` is a director on `phys-110 / fall-2026`.** The split script's header says
  that shared credential stays scoped to the training offering; it does not. Since `activities_write`
  is scoped by COURSE, it can rewrite every phys-110 activity. §1.3 is therefore not only a sandbox
  problem, and fixing it is independent of everything else here.

---

## 13. The repair run — 2026-07-28

`scripts/fall2026/isolate_offering_content.py --commit`, as the DML tier, in one transaction.
Snapshot and lineage mapping in the gitignored `_snapshots/`:
`isolate-content-snapshot-b9e6b3da.json`, `isolate-content-mapping-b9e6b3da.json`. The mapping is
what stands in for `origin_assignment_id` until the DDL lands — old container id, new container id,
old and new activity ids, and the slug each took.

| | before | after |
|---|---|---|
| shared containers | 37 | **0** |
| shared activities | 42 | **0** |
| real offering: lessons / published | 37 / 37 | 37 / 37 |
| real offering: sections / enrolments / staff rows | 17 / 375 / 27 | 17 / 375 / 27 |
| real offering: per-section due dates | 34 | 34 |
| sandbox: lessons / submissions / grades | 37 / 211 / 211 | 37 / 211 / 211 |

**What changed, precisely.** The sandbox's 37 containers were renamed `preflight-NN` →
`preflight-NN-training`, freeing the clean slugs; 37 new containers and 37 new written activities
were created for the real term, each activity slug freshly minted; the real offering's 37
`assignment_offerings` were rebuilt against the copies, carrying points, `due_at`, `due_by_day`,
`content_snapshot`, publish state and position verbatim, with the 34 per-section due dates restored.

**What the real term lost, and must get back (step 8):** its 5 interactive activities. Four were
`practice` (`preflight-02/03/04/05`); `preflight-07`'s was `graded`, so that lesson's written
activity was promoted to `graded` — a real change to how it scores, made deliberately rather than
leaving a published lesson with nothing gradable on it. The artifacts themselves are untouched and
still resolve for the sandbox; a real-term student launching one before it is rebuilt would submit
into a slug their offering no longer schedules, which is why re-adding them is not optional.

**Addressing the sandbox by slug changed.** `/preflight-analyze phys-215 preflight-02 M` now names
the real term. The sandbox is `preflight-02-training`.

**Verified after commit, independently of the script's own in-transaction checks:**
`content_isolation_check.py` exits 0, and a read-only census confirms the table above.
