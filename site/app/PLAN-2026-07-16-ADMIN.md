# Course administration — port plan (2026-07-16)

Author: Matthew Recker (via Claude). Companion to [`COURSE-ADMIN-INVENTORY.md`](COURSE-ADMIN-INVENTORY.md)
(the requirements catalog) and [`PLAN-2026-06-22.md`](PLAN-2026-06-22.md) (whose item **E** first
proposed a native admin page). This plan supersedes item E's sequencing.

**Driving deadline:** Fall 2026 semester start (~mid-August) — roughly four weeks out.

---

## 0. Scope & guardrails

**Decided 2026-07-16:**

- **Everything built here lives under `site/app/`.** This is a refactor; the legacy site is frozen.
- **Do not touch `site/admin.html`, `site/interactions-admin.html`, `site/index.html`,** or anything
  else under `site/` outside `app/`. Legacy code is **read-only reference** — port the logic, don't
  edit the source.
- **The app's nav link to legacy admin is removed** ([`js/nav.js:25`](js/nav.js#L25)) once the native
  page exists. `site/admin.html` itself stays on disk and reachable by direct URL as a fallback until
  **promotion**, when the app tree moves up and the legacy pages are deleted with the rest of
  `site/*.html`. That is already the plan — not an open decision.
- **Promotion is therefore a hard gate: anything still legacy-only when it lands is *lost*.** This is
  what makes Tier 1 (staff management + export) mandatory rather than merely nice — see §7.
- **The by-question Report tab is out of scope.** It will eventually merge with the lesson rollup
  summary. Leave [`js/faculty-report.js`](js/faculty-report.js) in place — it is the query layer that
  merge will reuse. Do **not** delete it, and do **not** build a page for it now. (Document it as
  intentionally dormant so the next agent doesn't "clean up" a load-bearing module.)
- **Password operations are deferred** (see Tier 3). They need a new edge function under
  `supabase/functions/`, which is outside this plan's file boundary.

**Still governed by [`CORE.md`](../../.ai/instructions/CORE.md):** the §0 coordination gate before any
live DB mutation, and the §5 requirement to log shipped work in `CHANGELOG.md` (which sits outside
`site/app/` — it is an operating requirement, not part of the frozen legacy site).

---

## 1. Corrected baseline — what is actually ported

`COURSE-ADMIN-INVENTORY.md` is a sound requirements catalog, but **its port-status claims are stale in
three places** and pointed this effort at the wrong work. Verified state as of 2026-07-16:

| Area | Inventory says | **Actually** |
|---|---|---|
| Assignment CRUD | ❌ legacy-only (`:58`) | ⚠️ **~80% ported** inside the lesson creator ([`js/faculty-lessons.js`](js/faculty-lessons.js)); builder is a *superset* of legacy (figure upload, RAG PDFs, pinned reading-time + reflection questions). **Missing: duplicate, retroactive rescore, standalone (non-lesson) authoring.** |
| Roster (CSV + provisioning) | "confirm it made it across" (`:180`) | ✅ **Fully ported**, provisioning cleaner than legacy ([`js/faculty-roster.js`](js/faculty-roster.js)) |
| Sections | ✅ folded into Roster | ✅ assign-instructor ported; **lifecycle (create/rename/retire) absent in both generations** |
| Grade + extensions | (elevated scope) | ✅ **Fully ported** incl. director "All sections", finalize, reopen, extensions — **but the page is unreachable** (see T0.2) |
| Report tab | implies shipped (`:122`) | ❌ **Not ported.** `faculty/report.html` is the *interaction* rollup, not this. [`js/faculty-report.js`](js/faculty-report.js) is the real port and **nothing imports it.** Out of scope by decision. |
| Interactions / lessons | "reconcile which is canonical" (`:112`) | ✅ both ported; **code already declares lessons canonical** ([`js/faculty-interactions.js:74`](js/faculty-interactions.js#L74)) |
| **Instructor / staff mgmt** | ❌ legacy-only | ❌ **Confirmed — zero code.** Nothing in `site/app/` calls `create-instructor` or `remove-instructor`. |
| **Export** (Blackboard CSV, JSON backup) | ❌ legacy-only | ❌ **Confirmed — zero code.** |
| Course settings | "consider" (`:182`) | ❌ Nonexistent in both generations |

**Net: the real gap is two features — staff management and export — plus three live defects.** That is
a much smaller build than the inventory implies.

One thing the inventory got exactly right and the app already honors: the **canonical director gate is
the per-course `isDirectorForCurrent()` model** ([`js/auth.js:148`](js/auth.js#L148)), exposed as
`ctx.isDirectorForCurrent()`. Legacy `interactions-admin.html`'s global `is_director` shortcut was
**not** carried over. Open question #1 in the inventory is therefore already resolved — build on
`ctx.isDirectorForCurrent()` and don't reintroduce the shortcut.

---

## 2. Architecture — where admin functions live

**Do not rebuild the 9-tab monolith.** The app's existing model is *task-oriented pages that own a
domain*, and it works: Roster owns people-in-the-course, Lessons owns content, Grade owns scoring.
The port should preserve that, not collapse it.

**The new `faculty/admin.html` owns only what has no home today** — the course itself and the people
who *run* it:

```
faculty/admin.html          ← NEW. Director-gated. Subtabs:
    Staff       add / change role / remove instructors      (Tier 1)
    Export      Blackboard grades CSV · full JSON backup    (Tier 1)
    Course      settings · section lifecycle                (Tier 2)
js/faculty-admin.js         ← NEW. Query layer, mirroring js/faculty-roster.js style.
```

Boundary rule: **Roster = the students *in* the course. Admin = the course, and its staff.**

This also matches the decision already taken in [`PLAN-2026-06-22.md`](PLAN-2026-06-22.md) item E, and
nav already carries an `admin` key — retargeting it is a one-line change that preserves the existing
mental model.

### The contract a new page must follow

Non-negotiable, derived from every existing page:

```js
// <head>: no-flash theme snippet → css/styles.css → supabase-js CDN (classic)
//         → js/config.js (classic, sets window.db) → this module
const ctx = await bootstrap({ require: 'faculty' });   // js/auth.js
if (!ctx) { /* a redirect fired — do nothing */ } else {
  renderNav(ctx, { active: 'admin', onCourseChange: () => render() });
  render();
}
```

- **Never construct a second Supabase client** — import `db` from [`js/supabase.js`](js/supabase.js);
  session persistence depends on the single instance.
- **Tokens only.** Per [`DESIGN.md`](DESIGN.md), "a raw hex in a page is a bug." Legacy's instructor
  table is full of hardcoded hex (`rgba(168,85,247,0.15)`, `#d8b4fe`, `#f87171`) — **re-author with
  tokens, don't copy.** See the design note in T1.2.
- **There is no shared toast/modal/confirm module.** Follow the established pattern: a static
  `.modal-backdrop` div toggled with `classList`, plus a status `<span>` mutated inline
  ([`roster.html:189`](faculty/roster.html#L189), [`grade.html:246`](faculty/grade.html#L246)).
  A shared UI module is a Tier 2 candidate, not a prerequisite.

---

## 3. Tier 0 — correctness & reachability *(do first; days, not weeks)*

These are live defects. Each is small, self-contained, and independent of everything below.

### T0.1 🔴 Retroactive rescore was dropped — silent score corruption
[`js/faculty-lessons.js:114`](js/faculty-lessons.js#L114) `saveLesson()` writes `questions` to
`assignments` with **no equivalent of legacy's `retroactivelyUpdateScores`** (`admin.html:1871-1900`).

**Failure:** a director edits Q3 from 1pt → 2pt on an already-graded lesson. `assignments.questions`
says 2; every existing `scores.question_scores.q3` still says `{score:1, max:1}`, and `max_total` is
stale. Students see wrong totals and the Blackboard export (T1.3) ships wrong grades. Legacy also
*told* the user ("Updated N existing score records"); the app is silent.

**Build:** port the algorithm into `js/faculty-lessons.js`. It must fetch the existing assignment's
questions before writing to detect a point change, preserve `status` (zero stays 0; full/warn become
the new point value), recompute `total_score` + `max_total`, and surface the affected-row count in the
save status line.

> Under lesson unification **D3**, per-question correctness scoring eventually goes away — but that is
> Phase 3+ and unapplied. The bug is live *now* and the fix is ~30 lines. Do it.

### T0.2 🔴 Directors cannot reach the Grade page
`FACULTY_LINKS` ([`js/nav.js:20-26`](js/nav.js#L20-L26)) has **no `grade` entry**. The comment at
`nav.js:17` says Grade "is reached from Roster" — but the only link to `grade.html` in the entire app
sits at [`roster.html:64`](faculty/roster.html#L64), *inside the `if (!ctx.isDirectorForCurrent())`
branch*, on a page nav marks `directorOnly`. So instructors can't reach the page that holds the link,
and directors get the page but not the link. **Nobody has an in-app path to Grade.**

**Build:** add a `grade` entry to `FACULTY_LINKS` (**not** `directorOnly` — instructors grade their own
sections). Fix the stale `nav.js:17-19` comment. Note `grade.html:71` already passes `active: 'grade'`,
a key that currently matches nothing.

### T0.3 ⚠️ Nav gating hides a view that was built for instructors
[`js/nav.js:23`](js/nav.js#L23) marks Lessons `directorOnly`, but
[`js/faculty-lessons.js:52`](js/faculty-lessons.js#L52) scopes instructors to published lessons and
[`lessons.html:285`](faculty/lessons.html#L285) renders a whole instructor read-only view — which is
therefore **unreachable dead UI**.

**Build:** drop `directorOnly` from the lessons entry; verify the page's internal gate
([`lessons.html:233`](faculty/lessons.html#L233)) covers every authoring control.

### T0.4 ⚠️ Destructive prefill guess on the retired authoring path
[`js/faculty-interactions.js:239`](js/faculty-interactions.js#L239) silently guesses New-vs-Update from
slug existence. `lessons.html:1147` deliberately *stops and asks* (`openDestChooser`) because guessing
"is destructive either way."

**Build:** **remove** prefill handling from `interactions.html`. Safe today — the frozen contract URL
(`site/faculty/lessons.html`) targets the lesson creator, so no live artifact prefills the interactions
page. This is a delete, not a build; full authoring retirement is T2.1.

### T0.5 Documentation drift
Both files are in scope (`site/app/`):
- `COURSE-ADMIN-INVENTORY.md` — correct the three stale port-status rows per §1; mark open question #1
  resolved.
- [`README.md`](README.md) `:8-10` + `:69-75` — "Not yet ported" claims Report shipped and omits that
  assignment authoring largely did.
- Add a note that `js/faculty-report.js` is **intentionally dormant** pending the rollup merge.

---

## 4. Tier 1 — the native admin page *(the actual gap)*

### T1.1 Shell + nav retarget
New `faculty/admin.html` + `js/faculty-admin.js`. Retarget [`js/nav.js:25`](js/nav.js#L25) from
`legacyUrl('admin.html')` (external, `target="_blank"`) to `admin.html`, and add `directorOnly: true`.

> Today the Admin link is shown to **all faculty** — an instructor is sent to a legacy page they can't
> mostly use. Director-gating it is a fix, not just a port. **Caveat:** when password ops land (Tier 3),
> instructors need scoped access, so this gate will have to open again — leave the page's internal
> gating granular enough to allow that without a rewrite.

### T1.2 Staff subtab
Port from legacy `admin.html:2237-2388`, re-authored against the design system.

| Function | Implementation |
|---|---|
| List staff | Parallel fetch: `instructor_course_access` (eq current course), `instructors` where `is_global_admin`, and all `instructors` for a name map. **Query separately, not as a join** — legacy's comment notes a join silently null-returns if the joined table's RLS blocks the read. Dedupe: system admins first, then course rows excluding them. |
| Add instructor | `db.functions.invoke('create-instructor', { body: { name, email, password, course_id, role } })` |
| Change role | Direct `db.from('instructor_course_access').update({ role }).eq(...)` — no edge function |
| Remove access | `db.functions.invoke('remove-instructor', { body: { instructor_id, course_id: role === 'system_admin' ? null : currentCourse } })` |

**Guards to carry over (all three are real):** you cannot edit or remove **yourself**; `system_admin`
rows are not role-editable via the dropdown; only system admins may grant or remove `system_admin`.

**No backend work** — both edge functions exist and are unchanged.

**Design note:** legacy's role badges use hardcoded hex, including a **purple** for `system_admin` that
has no token in `DESIGN.md`. Reuse the existing status families (blue = director, muted = instructor)
and only add a `:root` + `[data-theme="dark"]` token pair if system admin genuinely needs a third
color. Do not port the hex.

### T1.3 Export subtab
Port from legacy `admin.html:2154-2211` — **fixing two latent bugs rather than copying them.**

**Blackboard grades CSV.** Director → all course sections; instructor → own sections only (legacy
`initExportTab` scope note is worth keeping). Reads `scores` where `is_finalized = true`.

**Full JSON backup.** ⚠️ Legacy has three problems the port must fix:
1. It is **unscoped by role** — any grader pulls the entire dataset. **Director-gate it.** (This
   resolves inventory open question #2 for backup; extensions gating remains open — see T2.3.)
2. It is **unscoped by course** — scope to `ctx.currentCourse`.
3. It orders `assignments` by **`due_date`, a column that no longer exists** (it is `due_date_m` /
   `due_date_t`) and `responses` by `submitted_at`. **Verify both against live schema before porting**
   — a bad `.order()` fails the query.

**Forward-compatibility (important):** isolate the grade source behind a single function — e.g.
`gradeMatrix(ctx) → { students, columns, cell(studentId, columnId) }` — so lesson-unification Phases
3/5/6 can swap `scores.total_score` for `lesson_completions` **without touching the CSV writer**.
Building the export inline against `scores` guarantees a rewrite.

---

## 5. Tier 2 — consolidation *(after semester start is fine)*

- **T2.1 Retire `interactions.html` authoring.** Code already declares lessons canonical
  ([`faculty-interactions.js:74`](js/faculty-interactions.js#L74)). **Blocker: `interactions.html` is
  the only page with completion tracking and the only route into `report.html`** — that must move
  somewhere first, or the page cannot be retired. Also fixes a real conflict: both pages write
  `interactions` rows, and `interactions.html:218` toggles publish unconditionally while
  `lessons.html` only mirrors publish onto components it *owns* — so a shared interaction can desync
  from its lesson.
- **T2.2 Section lifecycle** — create / rename / retire. Sections are currently only ever born as a
  side effect of `commitRoster`. Inventory open question #3.
- **T2.3 Extensions gating decision** — still open to any grader, in both generations. Inventory open
  question #2. Note migration 021 adds real RLS here; align rather than duplicate.
- **T2.4 Course settings** — create/rename course, term config. Nonexistent today; `courses` is
  read-only in the app.
- **T2.5 Shared UI module** (`js/ui.js`) — a real confirm dialog + toast to replace `alert()` /
  `confirm()`. Worth it once the admin page adds more destructive operations.
- **T2.6 `loadRoster` unbounded fetch** ([`faculty-roster.js:11`](js/faculty-roster.js#L11)) fetches
  every student in the DB and filters client-side. Fine today; won't be.

---

## 6. Tier 3 — deferred

- **Password operations** (`PLAN-2026-06-22` item E): a `reset-password` edge function with
  `email_link` and `temp_password` modes, plus a "Forgot password?" link on `login.html`. **Blocked by
  this plan's file boundary** — needs `supabase/functions/`. Schedule when that opens. Mitigation
  today: provisioning sets passwords to last-6-of-ID, so there is a working fallback. Verify
  `@usafa.edu` mail deliverability before relying on email self-service for cadets.
- **Report ↔ rollup merge** — the by-question `analysis_report` view folds into the lesson rollup
  summary. Keep `js/faculty-report.js` dormant until then.

---

## 7. Sequencing against Fall 2026

Legacy `admin.html` still works by direct URL, so it is the fallback until promotion — which means
nothing here blocks the *semester*. But **Tier 1 blocks *promotion***: the moment the app tree moves
up, legacy is deleted, and any function that hasn't been ported is gone. Staff management and export
are the two that qualify.

Ordering is therefore driven by **risk before the semester** and **completeness before promotion**:

1. **Tier 0 (T0.1 first).** The rescore bug corrupts scores the moment a director edits a point value —
   which is exactly what happens while prepping a semester. Ship this before anyone touches lesson
   content. T0.2 (Grade unreachable) is the next most embarrassing.
2. **Tier 1.** The real port. No new backend, both edge functions exist, so it is bounded UI work.
3. **Tier 2 / Tier 3.** After the semester is underway.

**Verification** (per `CORE.md` §2 — there is no lint/test/typecheck for this project): run
`python -m http.server 8000` from the **repo root**, open `http://localhost:8000/site/app/`, and
exercise each change against Supabase in the browser, **in both light and dark mode**. Test as all
three tiers — instructor, course director, system admin — since every item here is role-gated.

---

## 8. Risks & open items

- **Tier 1 must land before promotion.** Promotion deletes the legacy pages, so staff management and
  export have to exist natively by then or the course simply loses them. This is the one hard
  dependency in the plan.
- **Lesson unification collides with export.** Migration 021 (Phase 2) is **written but not applied**,
  and Phases 3/5/6 move grading from per-question correctness to per-lesson effort on
  `lesson_completions`. Export built inline against `scores` is throwaway — hence the `gradeMatrix()`
  isolation in T1.3.
- **Migration 021 is not this plan's to apply.** Its own header warns `is_final` defaults FALSE, which
  is only correct while `responses` is empty. Applying it is a separate, coordinated action under
  `CORE.md` §0 — and `SELECT count(*) FROM responses;` must be checked first.
- **Client-side scoping is not security.** Every gate in `site/app/` is presentational; RLS is
  permissive ([`faculty-data.js:2-4`](js/faculty-data.js#L2-L4)). Migration 021 begins repairing this.
  Anything security-sensitive (i.e. Tier 3 password ops) **must** enforce server-side regardless.
- **Design decision needed:** whether `system_admin` earns its own color token (T1.2).
