# Course Administration — Function Inventory (from the old site)

> **Purpose.** Before building a dedicated **Course Administration** page in the new portal
> (`site/app/`), this document catalogs *every* administrative function a **course director**
> performed on the old site. It is a requirements inventory, not a design — no page has been built
> yet. Sources analyzed: `site/admin.html` (legacy monolithic admin panel, 9 tabs) and
> `site/interactions-admin.html` (legacy interactions manager). Line citations point at the legacy
> files as they exist today.
>
> Scope note: this lists **director/admin** responsibilities. Plain grading/reporting that any
> instructor does over their own sections is included only where a director has *elevated scope*
> (whole-course) or the action is director-gated.

---

## 1. Who counts as a "course director"

The two legacy pages resolve the role slightly differently — a wrinkle the new page should unify.

| Page | How director status is decided |
|---|---|
| `admin.html` | `isDirectorForCurrent()` → `true` if `instructors.is_global_admin` **OR** the `instructor_course_access` row for the *current* course has `role === 'director'`. Evaluated **per course** (a person can be director of one course, instructor of another). |
| `interactions-admin.html` | `isManager` → `true` if `is_global_admin` **OR** the (legacy) global `is_director` flag **OR** any `instructor_course_access.role === 'director'`. Not re-evaluated per current course. |

**Three tiers overall:**

- **System Admin** — `instructors.is_global_admin = true`. Treated as director of **every** course; can manage the `system_admin` role.
- **Course Director** — `instructor_course_access.role = 'director'` for a specific course. Full admin of that one course.
- **Instructor** — grades/reports only their **own assigned sections**; sees none of the admin tabs.

> **Decision needed:** the new Course Administration page should pick one canonical, per-course
> gate (`isDirectorForCurrent()` is the better model) and drop the legacy global `is_director`
> shortcut that `interactions-admin.html` still honors.

---

## 2. Director-only functions (entire features hidden from instructors)

Each of the following is gated so a plain instructor never sees it. Grouped by functional area.

### A. Assignment management  *(legacy: Assignments tab — `admin.html:279-353`)*
The course's preflight content. Full CRUD.

| Function | Action / control | Writes to | Legacy ref |
|---|---|---|---|
| Create assignment | **+ New Assignment** → editor | `assignments` (upsert) | `showNewAssignment` :1643 |
| Edit assignment | **Edit** on a card | `assignments` | `editAssignment` :1661 |
| Duplicate assignment | **Duplicate** → new unsaved clone | `assignments` | `duplicateAssignment` :1668 |
| Publish / Unpublish | **Publish** / **Unpublish** toggle | `assignments.is_published` | `togglePublish` :1902 |
| Preview (student view) | **Preview** modal (read-only) | — | `previewAssignment` :1588 |
| Save draft / Save & publish | editor footer buttons | `assignments` (all fields) | `saveAssignment` :1821 |
| Build questions | **+ Free Response / + Numerical / + Multiple Choice**, remove, set points | in-memory → `assignments.questions` (JSON) | `addQuestion` :1701 |
| **Retroactive rescore** | *(automatic)* when a question's point value changes on save | re-upserts **all** `scores` rows for that assignment | `retroactivelyUpdateScores` :1871 |

Editor fields: title, description, `due_date_m` (M-day), `due_date_t` (T-day), `reading_link`,
`reference_pdf`, `reference_pages`, `figure_url`, plus the question array.

**Port status (corrected 2026-07-16):** ⚠️ **mostly ported — not legacy-only.** Assignment authoring
lives inside the **lesson creator** (`site/app/faculty/lessons.html` + `js/faculty-lessons.js`), not a
standalone Assignments tab; a preflight is a *component* of a lesson (migration 016). The question
builder there is a **superset** of legacy: it adds figure upload to Supabase Storage, a RAG
reference-PDF picker, and two pinned role questions (reading-time diagnostic, reading reflection).
Publish/unpublish mirrors onto lesson-**owned** components only.

Still missing: **Duplicate**, and standalone (non-lesson) authoring — a pre-built assignment can only
be *attached* to a lesson to be edited. **Retroactive rescore was ported 2026-07-16** (`saveLesson` →
`retroactivelyUpdateScores`); it had been dropped, silently corrupting totals whenever a point value
changed on a graded lesson.

### B. Roster management  *(legacy: Roster tab — `admin.html:358-399`)*

| Function | Action / control | Writes to | Legacy ref |
|---|---|---|---|
| Bulk CSV roster import | drop-zone / file picker → validate (`student_id` 3000000000–3009999999, section `^[MT][135][A-D]$`) → **Upload to Database** | `sections` (upsert, to satisfy FK) then `students` (bulk upsert) | `parseCsv` :2055, `commitRoster` :2097 |
| Provision student auth accounts | **Provision N Accounts** | edge fn `provision-students` (creates Supabase Auth logins where `auth_user_id IS NULL`) | `provisionStudents` :1962 |
| Edit a student's section | **Edit Section** modal | `students.section_id` | `saveStudentSection` :2017 |
| Remove a student | **Remove** (cascade) | deletes from `scores`, `responses`, `extensions`, then `students` — permanent | `removeStudent` :2007 |
| View provisioning status | status card (counts unprovisioned) | — (read) | `loadRosterTable` :1910 |

**Port status (verified 2026-07-16):** ✅ **Fully ported** to `site/app/faculty/roster.html` +
`js/faculty-roster.js` — bulk CSV import **and** provisioning both made it across, with identical
validation (id range, `^[MT][135][A-D]$`). Provisioning is *cleaner* than legacy: it uses
`db.functions.invoke('provision-students')` rather than a raw `fetch` against a hardcoded URL.
Cascade delete matches legacy (`scores` → `responses` → `extensions` → `students`).

⚠️ One latent issue, not a port gap: `loadRoster` fetches **every student in the database** and
filters by section client-side. Legacy did the same; it will not scale.

### C. Section → instructor assignment  *(legacy: Sections tab — `admin.html:404-414`)*

| Function | Action / control | Writes to | Legacy ref |
|---|---|---|---|
| Assign instructor to a section | per-section instructor `<select>` | `sections.instructor_id` (or `null`) | `assignInstructor` :2147 |
| Refresh section grid | **↻ Refresh** | — (read `sections` + `instructors`) | `loadSections` :2119 |

> Sections are **auto-created by roster upload**; there is no manual "create section" button.
> The new page may want an explicit create/rename/retire-section control.

**Port status:** ✅ folded into the new Roster page (per README).

### D. Instructor / staff management  *(legacy: Instructors tab — `admin.html:443-486`)*

| Function | Action / control | Writes to | Legacy ref |
|---|---|---|---|
| Add instructor | **+ Add Instructor** (name, email, temp password, role: instructor / director / system_admin) | edge fn `create-instructor` (Auth user + `instructors` row + `instructor_course_access`) | `addInstructor` :2316 |
| Change instructor role | role dropdown Instructor ↔ Course Director | `instructor_course_access.role` | `changeInstructorRole` :2362 |
| Remove instructor access | **Remove** | edge fn `remove-instructor` (removes course access / clears `is_global_admin`; does **not** delete the login) | `removeInstructor` :2348 |
| List staff | roster of current-course instructors + system admins | — (read `instructor_course_access`, `instructors`) | `loadInstructorsTab` :2237 |

Guards: cannot edit/remove **yourself**; system-admin rows are non-editable except via the edge
function path.

> **⚠️ Correction (2026-07-22).** This section previously claimed *"only system admins can add/remove
> the `system_admin` role."* **That guard never existed in the legacy code.** The old
> `create-instructor` read the flag as a second global-admin marker, so **a legacy course director
> could create system admins.** Its rewrite says so in its own header: *"That is fixed here, not
> merely ported."* Both edge functions now check `is_global_admin`
> (`create-instructor/index.ts:98`, `remove-instructor/index.ts:95`).
>
> Recorded because the risk is documentary: an operator reading the old wording would conclude the
> legacy behaviour was safe and "restore" it. See
> [`LEGACY-AUDIT-2026-07-20.md`](LEGACY-AUDIT-2026-07-20.md) §1.

**Port status: ✅ ported 2026-07-20** — `faculty/admin.html` **Staff** tab
(`js/faculty-admin.js`). Supersedes the earlier "❌ still legacy-only".

### E. Lesson-interaction management  *(legacy: `interactions-admin.html`)*
Catalog of Claude-artifact lessons (iPREP).

| Function | Action / control | Writes to | Legacy ref |
|---|---|---|---|
| Create interaction | **+ New interaction** → modal (slug/`id`, course, title, description, `artifact_url`, published) | `interactions` (insert) | `saveInteraction` :418 |
| Edit interaction | **Edit** (slug locked — it's the PK referenced by reports) | `interactions` (update; not `id`) | `saveInteraction` :414 |
| Publish / Unpublish | **Publish** / **Unpublish** | `interactions.is_published` | `togglePublish` :433 |
| Delete interaction | **Delete** (cascades to all `preflight_interaction_reports`) | deletes `interactions` | `removeInteraction` :441 |
| Accept prefill link | `?new=1&id=&course=&title=&desc=&url=&pub=` → routes to New vs. Update, review, save manually | `interactions` (on Save) | `prefillFromQuery` :355 |
| Restrict to managed courses | Course dropdown lists only `manageableCourses` | — | :321, :375 |

**Port status (clarified 2026-07-16):** ✅ ported, and **the canonical owner is already decided in
code** — `js/faculty-interactions.js` says outright that the standalone tool "is being retired in
favour of the lesson creator", and the frozen prefill contract URL (`site/faculty/lessons.html`)
resolves to the lesson creator. So:

- **`faculty/lessons.html` is canonical for authoring.**
- **`faculty/interactions.html` is still the only page with completion tracking** and the only route
  into the per-lesson rollup (`report.html?i=`). It therefore **cannot be deleted until that moves.**

Prefill handling was **removed from `interactions.html` on 2026-07-16**: it guessed New-vs-Update from
slug existence, which is destructive either way (duplicate-PK failure, or silently overwriting another
listing). The lesson creator asks explicitly instead. Remaining overlap to resolve: both pages write
`interactions` rows, and `interactions.html` toggles publish unconditionally while `lessons.html`
mirrors publish only onto components it owns — so a shared interaction can desync from its lesson.

---

## 3. Director-*elevated* functions inside shared tabs
Same button an instructor sees, but the director gets whole-course scope.

| Area | Instructor scope | Director scope | Legacy ref |
|---|---|---|---|
| **Grade** | own `mySections` only | adds **"All sections (entire course)"** option + full section list | `initGradeTab` :977 |
| **Report** | own `mySections` only | adds **"All sections (entire course)"** report scope | `initReportTab` :1276 |
| **Export → Grades CSV** (Blackboard) | own sections' finalized scores | ALL course sections/students | `exportBlackboard` :2162 |

**Port status of this section (added 2026-07-16):**

- **Grade** ✅ fully ported (`faculty/grade.html` + `js/faculty-grade.js`) including the director
  "All sections" scope, finalize, reopen, and extensions. It was **unreachable** until 2026-07-16 —
  nav had no Grade entry and the only link sat inside Roster's *non-director* branch, on a page nav
  hid from instructors. A `grade` nav entry now exists for all faculty.
- **Report** ❌ **not ported.** ⚠️ Do not be misled by `site/app/faculty/report.html` — that is the
  *interaction/lesson rollup* (keyed `?i=<slug>`), **not** this by-question report. The real port is
  `js/faculty-report.js`, which **nothing imports**. It is **intentionally dormant**: the by-question
  view will be merged into the lesson rollup summary rather than shipped standalone. **Do not delete
  it** — it is the query layer that merge will reuse.
- **Export** ✅ **ported 2026-07-20** (was "❌ not ported") — `faculty/admin.html` **Export** tab,
  `buildBackup()` / CSV in `js/faculty-admin.js`. It is director-gated and course-scoped, which fixes
  the three legacy defects listed under "Still open" below.

---

## 4. Shared / cross-cutting actions (not director-gated, but the admin page should surface them)
Present to anyone reaching the relevant tab today; flagged here because a Course Admin page is the
natural owner and some are sensitive.

- **Finalize & publish grades** to students / **Reopen** a finalized student — `scores.is_finalized`
  (`finalizeGrades` :1234, `reopenStudent` :1246).
- **Grant / edit / remove due-date extensions** per student — `extensions` table
  (`saveExtension` :2469, `removeExtension` :2490). ⚠️ *Not* director-gated today.
- **Full JSON backup** — **Download Full Backup (JSON)** reads the **entire** `students`,
  `assignments`, `responses`, `scores` tables unscoped (`downloadBackup` :2195). ⚠️ Pulls the whole
  dataset regardless of role; strong candidate to restrict to director/admin.
- **View interaction submissions** — per-section → per-student rendered report (`openSubmissions`
  :452). Instructors see only their sections (RLS); no cohort rollup/export on the legacy page.

---

## 5. Consolidated director-responsibility checklist
Every distinct thing a course director had to be able to do on the old site:

**Content**
1. Create / edit / duplicate / preview assignments and their questions.
2. Publish & unpublish assignments (control student visibility).
3. Set due dates (M-day and T-day), reading links, reference PDFs/pages, figures.
4. (Accept that) changing question points retroactively rescores every student.
5. Create / edit / publish / unpublish / delete lesson interactions (+ accept prefill links).

**People**
6. Bulk-import the student roster from CSV (validated).
7. Provision student Supabase Auth accounts in bulk.
8. Edit a student's section; remove a student (cascade).
9. Assign / reassign instructors to sections.
10. Add instructors; change instructor ↔ director role; remove instructor access.

**Whole-course operations**
11. Grade and report across **all** sections (not just own).
12. Finalize/publish grades to students and reopen individual students.
13. Grant / edit / remove due-date extensions.
14. Export grades (Blackboard CSV) for the whole course.
15. Download a full JSON backup of the dataset.
16. View lesson-interaction submissions across the course.

**Not on the old site (operational, listed for completeness)** — unpausing the Supabase project each
semester and applying migrations are ops tasks done outside the web UI (see `CORE.md`); note them so
they aren't mistaken for missing page features.

---

## 6. Open questions for the new page

*Status updated 2026-07-16. The build plan these feed is
[`PLAN-2026-07-16-ADMIN.md`](PLAN-2026-07-16-ADMIN.md).*

**Resolved:**

- ✅ **Director gate unified.** `site/app/` already uses the per-course `ctx.isDirectorForCurrent()`
  model exclusively (`js/auth.js`); `interactions-admin.html`'s legacy global `is_director` shortcut
  was never carried over. Build on it; don't reintroduce the shortcut. *(One narrow fallback in
  `auth.js` still reads `is_director` — only when an instructor has no `instructor_course_access`
  rows and the role is derived from sections taught.)*
- ✅ **CSV import + provisioning confirmed ported** (see §2B).
- ✅ **Interaction authoring ownership decided:** the lesson creator is canonical; `interactions.html`
  keeps completion tracking until that moves (see §2E).

**Still open:**

- **Extensions gating** — still open to any grader. ⚠️ *Corrected 2026-07-22:* this previously said
  to align with migration 021's RLS. **021 is deliberately never applied** (CORE.md §5) — it
  implements the superseded lesson-unification model. The live governance is
  `migrations/app/007_extension_governance_and_review.sql`; align with that.
- ~~**Full JSON backup**~~ — ✅ **resolved 2026-07-20** by the native Export tab, which is
  director-gated, course-scoped, and does not touch the dropped `due_date` column. *(Known
  remaining gap, tracked in `docs/ROADMAP.md` P2.2: it omits `analysis_reports`, `sections`,
  `submission_activities`, and `staff_assignments`.)*
- **Section create/rename/retire** — sections still only ever appear as a side effect of roster upload.
- **Course-level settings** (course create/rename, term/semester config) — no home in either generation.
- **`system_admin` badge color** — legacy used a hardcoded purple with no token in `DESIGN.md`.
