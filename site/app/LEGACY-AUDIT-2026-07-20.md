# Legacy audit — capability not carried forward (2026-07-20)

**Status:** Findings only. Nothing here is scheduled; every item is a decision to make.

*Authored 2026-07-20 by Matthew Recker (via Claude). Extends
[`COURSE-ADMIN-INVENTORY.md`](COURSE-ADMIN-INVENTORY.md), which cataloged the legacy admin surface but
missed the items below. Sequencing lives in [`PLAN-2026-07-16-ADMIN.md`](PLAN-2026-07-16-ADMIN.md).
The one area already taken forward is [`PLAN-2026-07-20-ACCOUNTS.md`](PLAN-2026-07-20-ACCOUNTS.md).*

---

## Why this exists

`COURSE-ADMIN-INVENTORY.md` claims to catalog *"every* administrative function a course director
performed on the old site." A line-by-line re-read of the legacy pages found that it does not — and
that one of its security claims describes a guard that was never in the code. **Promotion deletes
`site/*.html`.** Anything below that is not decided before then is not deferred; it is gone.

Sources re-read: `site/admin.html` (2564 lines), `site/interactions-admin.html` (549),
`site/interactions.html` (84), `site/index.html` (607), `site/review.html` (342, **never analyzed by
the inventory**), `_archive/artifact-receiver-v1/`.

Each item below carries a **recommendation** so the discussion starts somewhere, not a decision.

---

## 1. Correction: a guard the inventory describes does not exist

`COURSE-ADMIN-INVENTORY.md` §2D states: *"only system admins can add/remove the `system_admin`
role."* **In legacy this was false in both directions.**

- `admin.html:2316-2334` — `addInstructor()` passes the role straight from the dropdown to
  `create-instructor` with no `is_global_admin` check, and the dropdown (`:463-468`) offers **System
  Admin** unconditionally. Any course director could mint a system admin.
- `admin.html:2307` — the Remove button's only gate is `isSelf`, so it renders on system-admin rows.
  Any director could strip a system admin.

The `create-instructor` rewrite says so in its own header: *"the old code read it as a second
global-admin flag, which meant a legacy course director could create SYSTEM ADMINS. That is fixed
here, not merely ported."*

**Already fixed** in schema `app` — both edge functions now check `is_global_admin`
(`create-instructor/index.ts:98`, `remove-instructor/index.ts:95`).

> **Recommendation: correct §2D of the inventory.** No code change needed. The risk is documentary —
> a future operator reading §2D concludes the legacy behaviour was safe and "restores" it.

---

## 2. Working features that promotion would delete

Each of these exists, works, and is in neither the inventory nor any port plan.

### 2.1 The Report tab's copy-for-slides workflow
Three controls that together form a real teaching routine — pull anonymised student answers into
class slides:

| Control | Behaviour | Ref |
|---|---|---|
| **Show names** | Per-question attribution toggle, off by default | `admin.html:1422-1426`, `toggleAttribution` :1489 |
| **🎲 Random 10** | Appears only when a question has >10 answers; samples ten | :1427-1429, `toggleSample` :1484 |
| **Copy** | Copies the question + answers to the clipboard, honouring **both** the sample and the names toggle | :1430, `copyQuestion` :1498-1520 |

Note the anonymity is cosmetic: names are in the DOM at `display:none` (`:1466`), so "hidden" is
defeatable with devtools. If this is rebuilt, do not render names that are not meant to be shown.

> **Recommendation: rebuild, folded into the lesson rollup.** `PLAN-2026-07-16-ADMIN.md` §0 already
> says the by-question Report merges into the rollup summary; the rollup's `.sr-*` quote-picker panel
> is the same idea built properly. This is the strongest candidate on the page for that merge, and it
> should be scoped as part of it rather than as a standalone port.

### 2.2 "Did Not Submit (N)" table
Name, section, and ID of every non-submitter, rendered only when the count is non-zero
(`admin.html:1364-1372`). Inert HTML — no sort, no export, no click-through.

> **Recommendation: rebuild, and make it actionable.** The list exists to drive follow-up; it should
> at minimum be copyable, and plausibly should link to granting an extension.

### 2.3 "Show flagged only" toggle (Grade tab)
Collapses the grading view to `warn`/`zero` rows only, hiding any student card left with nothing
(`admin.html:241-245`, `applyFlagFilter` :1152). This is the triage mechanism for AI-suggested
grades — the thing that makes reviewing a whole section tractable.

> **Recommendation: rebuild.** `faculty/grade.html` is otherwise fully ported; this is a small
> addition to a page that already exists, and without it the 3-state grading model is much less
> useful at scale.

---

## 3. Authoring behaviour that is load-bearing and undocumented

### 3.1 Zero-point questions are a hidden mode switch
Setting a question's points to `0` removes it from the grading card entirely
(`isZeroPointQuestion`, `admin.html:773-775`, applied at `:1066`). This is *how* Q1 reading-reflection
questions are made ungradeable. **Nothing in the editor says so** — an author discovers it by
accident or not at all.

> **Recommendation: make it explicit in the lesson creator.** `app` already models this properly
> (`offering_activities.grading_role`), so the fix is to surface the concept as a labelled choice
> — "graded / reflection only" — rather than as a magic zero.

### 3.2 Q1 anonymity is hard-coded by position
`isAnonymousReportQuestion()` (`admin.html:777-779`) forces names hidden when
`idx === 0 || q.id === 'q1'`. CORE.md §2 states the *policy*; no document lists it as a control, and
nothing enforces it if a reflection question is not first.

> **Recommendation: attach the property to the question, not to its index.** A reflection question
> moved to position 2 silently loses its privacy protection today.

### 3.3 Assignment IDs are title-derived, with no visible ID field
`saveAssignment` slugifies the title into the primary key (`admin.html:1828-1829`) and upserts on it
(`:1847`). A *new* assignment whose title slugifies onto an existing one **silently overwrites that
assignment**. The Help tab claims an ID is requested; it is not.

> **Recommendation: no action for `app`.** The v2 model uses uuid PKs with a separate `slug`, so the
> collision class is gone. Recorded because the failure mode explains any legacy data that looks
> mysteriously overwritten.

### 3.4 There is no delete-assignment control
Create, duplicate, publish, unpublish — never delete, anywhere in the file.

> **Recommendation: decide deliberately.** Retire/archive is probably right rather than delete, given
> grades hang off the offering. But the absence today is an oversight, not a decision.

---

## 4. Capability with no UI at all

### 4.1 `/preflight-analyze` is invisible to the application
The runbook writes `scores` and `assignments.analysis_report`; the Report tab renders the result
(`admin.html:1340, 1378-1393`). But **nothing in the app can trigger it, show whether it has run, or
say when.** A director's most consequential recurring action happens in a terminal, and the only
in-app trace is a placeholder reading *"No summary yet — run /preflight-analyze …"*.

The inventory's §5 note covers Supabase unpausing and migrations as out-of-app ops tasks. This is
different in kind: it produces student-visible grades.

> **Recommendation: discuss a status surface, not a trigger.** Running the analysis needs a service
> key and textbook PDFs, so it cannot move into the browser. But "last analysed: <when>, by <whom>,
> N scores written" is data the app could show today, and it would make the pipeline legible to the
> people depending on it.

---

## 5. Legacy defects worth recording before the source is deleted

None of these need porting — they need *not* porting. Recorded so nobody reintroduces them by
copying legacy logic.

| # | Defect | Ref |
|---|---|---|
| 5.1 | **Export CSV can leak the whole database.** `if (exportSectionIds.length)` *skips* the `.in()` filter when an instructor has no assigned sections, rather than returning nothing — so the query returns every student in every course, subject only to RLS | `admin.html:2170` |
| 5.2 | **"Save Progress" un-publishes finalized grades.** It hard-codes `is_finalized: false` for every student in scope. Finalize masks this by re-finalizing immediately; a bare Save does not | `admin.html:1223` |
| 5.3 | **Retroactive rescore preserves `is_finalized`**, so already-published grades change under students with no re-finalization, no confirmation, and no notice | `admin.html:1894` |
| 5.4 | **`assignInstructor` checks nothing.** The Supabase error is not destructured, no feedback is shown, the grid is not reloaded, and `mySections` is not refreshed — assign yourself a section and it does not appear in Grade until a reload | `admin.html:2147-2149` |
| 5.5 | **The Sections tab instructor dropdown is not course-scoped** — it lists every instructor in the system, including the other course's staff | `admin.html:2125` |
| 5.6 | **Login is a user-enumeration oracle.** On failure `index.html` runs a second query to distinguish "ID not found" from "incorrect password", and restates the default-password rule to an anonymous caller | `index.html:197-212` |

`PLAN-2026-07-16-ADMIN.md` T1.3 already flags the JSON backup's unscoped role/course and its
`due_date` ordering; those are not repeated here.

---

## 6. `site/review.html` — the file the inventory never read

Not an admin page, which is why it was missed: it is a **student grade viewer**
(`<title>PREP — My Submissions</title>`). It warrants a decision anyway.

- **No authentication of any kind.** Identity is "type a 10-digit ID starting with 3000"
  (`review.html:111`) — no password, no session, no `db.auth` call in the file. Under the pre-021 anon
  policies this disclosed any student's scores and instructor feedback to anyone who guessed an ID.
- **Now functionally dead.** Migration 021 replaced the anon `responses` policies with `TO
  authenticated` ones keyed on `auth.uid()`, so the queries return zero rows and the page falls
  through to its empty state.
- **Orphaned.** Nothing links to it. Its only two commits moved and rebranded it.

> **Recommendation: delete it rather than port it.** Its function is served properly by
> `site/app/student/` behind real auth. Leaving a credential-free grade viewer in the tree — even a
> dead one — is a re-enable away from a FERPA problem.

---

## 7. Discoverability note

`site/admin.html` and `site/interactions-admin.html` have **no inbound links from anywhere in the
shipped site**. The entire instructor console is reachable only by typing the URL. Auth still gates
both, so this is obscurity layered on a real check rather than a hole — but it means any inventory
derived from the link graph will miss them, which is plausibly how §2D above went unverified for so
long.

`interactions-admin.html` additionally honours an undocumented query-string authoring API
(`?new=1&id=&course=&title=&desc=&url=&pub=`, `:355-389`). The inventory *does* capture this one, and
`PLAN-2026-07-16-ADMIN.md` T0.4 already removed the equivalent from the app.
