# PREP — Project Overview

> **Multi-agent note:** Shared operating *rules* for all agents (Claude, Codex, humans) live in
> [`CORE.md`](CORE.md) — live-system safety and the coordination gate, secrets/config, git/publish,
> and CHANGELOG conventions. **CORE.md is authoritative**; this file is the agent-neutral deep
> *reference* (architecture and data model). If the two ever conflict, CORE.md wins. The root
> auto-loading files (`AGENTS.md` for Codex, `CLAUDE.md` for Claude) wire each agent into both.

**PREP** — *Pre-lesson Readiness Engagement Platform* — is the user-facing brand
of this system. A GitHub Pages + Supabase system for managing physics preflight assignments and
lesson interactions at USAFA. Replaces GradeScope for two courses: Physics 110 and Physics 215.

> The brand name is **PREP**; the repo, GitHub Pages path, and download/export filenames remain
> `Core_Preflights` (changing those would break links, the artifact data contract, and Blackboard imports).
>
> **iPREP** (*interactive PREP*) is reserved for the interactive lesson-interaction component
> (the Claude-artifact lessons — see "Lesson Interactions" below); the rest of the site is **PREP**.

## Tech Stack

- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages (no build step)
- **Backend**: Supabase (PostgreSQL + Auth + REST API)
- **Auth**: Supabase Auth for both instructors and students, email/password. A student's sign-in
  address is the **real address from the registrar export** (`app.students.email`); their first
  password is the last 6 digits of their cadet ID and they are forced to change it on first
  sign-in. **There is no password reset by email — PREP has no SMTP.** A locked-out cadet asks a
  **course director**, who restores the default from `site/faculty/admin.html` → **Students**;
  nobody can view or choose a password, because `reset-student-password` derives it and rejects a
  request carrying one. *(Cadets provisioned before 2026-07-21 still sign in with the fabricated
  `cadetID@usafa.edu` address that predates the registrar import.)*

  **Staff work the same way as of 2026-07-27.** A staff account's default is **last name + `1234`**
  (lowercase; a hyphenated or two-part surname uses the first part), derived from
  `instructors.name`. `create-instructor` sets it — the caller supplies no password — and
  `reset-staff-password` restores it from admin.html → **Staff**. Both set
  `app_metadata.must_change_password`, which `auth.js` enforces for **both roles**: every page
  redirects to that role's `account.html` until the user picks their own.
  *This reversed a standing decision.* Staff recovery was deliberately unbuilt because an
  instructor account had no derivable default, so a reset would have meant one person CHOOSING
  another's credential. The prohibition on choosing is unchanged and structural — no parameter
  exists in either function. What changed is that a default can now be derived, which is the same
  bargain cadets have always had.

  > **Corrected 2026-07-27.** This said "asks any instructor of their section, who restores the
  > default from the Roster page". Two errors: the Roster page was folded into Course Admin →
  > Students on 2026-07-23, and the page carrying the control has always been director-gated, so an
  > *instructor* has never had the button. The edge function does admit any staff member of the
  > offering — the restriction is the UI's, not the function's — which is why this read as true for
  > so long. Same claim, same correction, in `instructor-accounts.md`.
- **Analysis**: `preflight-analyze` shared AI skill (see `.ai/skills/preflight-analyze/`)

> **No Node dependency or build step in the shipped site — do not introduce one** (full rule in
> [`CORE.md`](CORE.md) §2, including how to verify changes in a browser with
> `python -m http.server 8000`). The frontend is hand-authored ES modules + plain CSS the browser
> runs directly. Node may be installed locally as *optional* developer tooling and is guaranteed on
> no machine but the course director's; see CORE.md §2 before relying on it.

## Hosting & Infrastructure

- **GitHub Pages**: `https://dfpm-physics.github.io/Core_Preflights/site/`
  - phys-215 student URL: add `?course=phys-215`; phys-110: `?course=phys-110`
- **GitHub repo**: `https://github.com/dfpm-physics/Core_Preflights.git` (org: `dfpm-physics`, branch: `main`)
- **Supabase**: project `shzvpmlnqfmzfmuxkowi` — URL `https://shzvpmlnqfmzfmuxkowi.supabase.co`
  - Free tier **pauses after 1 week of inactivity** — unpause in the Supabase dashboard at the start of each semester

## Key Files

| File | Purpose |
|---|---|
*The 2026-07-28 promotion moved `site/app/` up to `site/` and deleted the legacy pages. Paths below
are post-promotion; role pages sit one level deep under `student/` and `faculty/`.*

| File | Purpose |
|---|---|
| `site/index.html` | Entry point — routes to login or the signed-in user's dashboard |
| `site/student/dashboard.html` | Student home: what is due, what is done |
| `site/faculty/grade.html` | Instructor grading panel |
| `site/faculty/admin.html` | Course Admin — Students, Staff, Sections, Course, Export |
| `site/faculty/report.html` | Lesson rollup: readiness summary, recommendation, showcase quotes |
| `site/student/interaction-submit.html` | Receives a Claude artifact's compressed report and saves it per student. **Frozen contract URL** — was a forwarding stub until the promotion put the real page here, at the same URL |
| `site/faculty/lessons.html` | Director lesson authoring; accepts AI-generated prefill links. **Frozen contract URL**, same history |
| `site/js/config.js` | Supabase URL + publishable key (safe to commit); binds the one client to schema `app` |
| `site/css/styles.css` | Shared styles |
| `site/help/` | In-app help content (Markdown + `MANIFEST.json`) |
| `supabase/seed_full.sql` | Test data for local development |
| `CHANGELOG.md` | Running, attributed log of notable changes — update when shipping features or editing these docs |

## Database Tables

| Table | Purpose |
|---|---|
| `courses` | `phys-110`, `phys-215` |
| `students` | Cadet roster; `auth_user_id` links to Supabase Auth |
| `sections` | Class sections like `M1A`, `T3B`; scoped to a `course_id` |
| `instructors` | Instructor accounts; `is_global_admin` for cross-course access |
| `instructor_course_access` | Per-course roles: `instructor` or `director` |
| `assignments` | Assignment definitions with JSONB `questions`; scoped to `course_id` |
| `responses` | Student JSONB answers; unique on `(student_id, assignment_id)` |
| `scores` | Graded scores with `question_scores` JSONB and `is_finalized`; also holds hidden 0–5 Q2-effort/Q3-understanding diagnostics (migration 022) |
| `interactions` | Lesson interactions (Claude artifacts); `id` is a slug like `lesson-02-charge`; has `artifact_url`, `is_published` |
| `preflight_interaction_reports` | Student reports from interactions; Markdown blob, unique on `(student_id, interaction_id)` |

## Roles

Three tiers. The legacy gate below lived in `site/admin.html`, deleted at the 2026-07-28 promotion;
the live equivalent is `ctx.isDirectorForCurrent()` from `site/js/auth.js`, described after the table:

| Role | Condition | Access |
|---|---|---|
| **System Admin** | `instructors.is_global_admin = true` | Full access to all courses |
| **Course Director** | `instructor_course_access.role = 'director'` | Full access to one course (Assignments, Roster, Sections, Instructors tabs) |
| **Instructor** | `instructor_course_access.role = 'instructor'` | Grades own assigned sections only |

`isDirectorForCurrent()` returns true if `is_global_admin` OR `role = 'director'` for `currentCourse`.
"— all my sections —" filter in Grade/Report tabs shows **only sections personally assigned** to the logged-in instructor; admins/directors with no assigned sections must use "All sections" to see students.

In `app` the equivalent is `staff_assignments.role`, whose CHECK admits a **fourth** value,
`grader`. It is **retired as of 2026-07-27** and no UI offers it: it meant "grades only, no
authoring", but authoring is gated on *director* everywhere it is gated at all, so it was
privilege-identical to `instructor`. The constraint is unchanged (DDL on `app` is sealed) and any
existing row keeps working, labelled as retired rather than silently shown as something else.

The `app` "— all my sections —" scope is `actionableSections()` (schema.js) — sections you *teach*,
intersected with what you may see, falling back to what you may see when you teach none. That
fallback is why a pure director gets the course rather than an empty page. *(faculty-grade.js
`mySectionIds()` returned the raw visible set until 2026-07-27, which for a director is every
section of the offering — so the filter was indistinguishable from "All sections".)*

## JSONB Structures

**`grades.question_scores`** — written by `/preflight-analyze`, read by Grade tab:
```json
{
  "q1": { "score": 0, "max": 0, "feedback": "",                          "status": "full" },
  "q2": { "score": 1, "max": 1, "feedback": "While we gave you credit…", "status": "warn" },
  "q3": { "score": 0, "max": 1, "feedback": "No answer provided.",        "status": "zero" }
}
```
`status` drives the 3-state color toggle: `"full"` = green, `"warn"` = yellow (full credit but flagged), `"zero"` = red.

**A written preflight is worth 2 points, not 15.** `max` is copied from the question's own
`points` (`faculty-grade.js:239`), and both Fall 2026 builders write **Q1 `0` · Q2 `1` · Q3 `1`**
(`build_fall_preflights.py:216,235-236`; `build_110_preflights.py:219,236-237`) — Q1 is the
zero-point reading-time reflection, Q2 the reading reflection, Q3 the JiTT free response. The
offering caps the total independently: `app.assignment_offerings.points_possible` defaults to `2`
and `faculty-grade.js:245-248` clamps the sum to it.

Zero-point questions are **scored but never rendered** — `grade.html:207,215` filters them out of
the grading UI while `faculty-grade.js:235-243` still writes them into `question_scores`. See
CORE.md §2 on Q1 privacy.

> **Do not confuse this 2-point *grade* with the 0–5 *diagnostics* below.** They are different
> layers and both are current. The retired shape — each question worth `max: 5`, on the legacy
> `public.scores` table — is gone; the 0–5 effort and understanding scales are not.

**`grades.diagnostic`** (jsonb) — everything `/preflight-analyze` learns about a student that is
**not** a grade. Two layers, both hidden from students:

- `q2_effort` / `q3_understanding` — 0–5 integers scoring two specific questions. Q2 measures
  engagement with the reading reflection; Q3 measures demonstrated physics understanding on the
  free-response question. Blank answers inside a submission score 0; students with no response
  have no grade row.
- a `schema: 1` payload — the **per-student assessment**, in the same shape the Claude artifact
  emits for an interactive lesson: `effort` (engagement across the whole attempt, capped at 2 when
  the reflection is not meaningful), `overall_understanding`, `objectives[]`, `misconceptions[]`
  against the taxonomy below, `reading_reflection` (the judgment, not the text — that stays in the
  student's answer), and `flags`. Spec:
  `.ai/skills/preflight-analyze/references/WRITTEN-SCHEMA1.md`.

This is what makes a written preflight and an interactive lesson **commensurable**: one cohort
aggregator (`/lesson-aggregate`) reads `submission_activities.content` for artifact takers and
`grades.diagnostic` for question-set takers, folds one shape, and summarizes the whole class.

None of it contributes to grade points, feedback, status, or finalization, and student pages omit
it from their explicit Supabase selects and rendering. Note that `diagnostic.effort` is **not**
`grades.effort` — written offerings are `grading_mode='points'`, so their points come from
`question_scores` and the effort column stays NULL.

*(The retired `public` equivalent was the `scores.q2_effort` / `scores.q3_understanding` columns
added by migration 022. There was no structured-assessment equivalent.)*

**`app.analysis_reports.payload`** — written by `/lesson-aggregate` only, read by the lesson rollup.
One row per offering (`scope='assignment_offering'`, `audience_id=NULL`, `kind='readiness'`), with
every scope inside the payload.

**Three kinds of scope, carrying different fields.** This split landed 2026-07-22 and writing the
wrong field on the wrong scope is a validation error, not a silent no-op
(`.ai/skills/lesson-aggregate/SKILL.md` §"Step 3" is authoritative):

| Key | Scope | Carries |
|---|---|---|
| a section uuid | one section | `misconception_recommendation`, `selected_quotes` |
| `"instr:<instructor uuid>"` | one instructor, across every section they teach | `readiness_summary`, `section_notes[]` |
| `"__all__"` | the whole course | `readiness_summary`, `misconception_recommendation` |

```json
{
  "kind": "readiness",
  "scopes": {
    "{section uuid}": {
      "section_code": "M1A",
      "misconception_recommendation": "one teaching action, rendered as its own line",
      "selected_quotes": [{ "student_id": 3000990009, "section_id": "{section uuid}" }],
      "meta": { "n": 18, "generated_by": "lesson-aggregate@2026-07-22",
                "source_fingerprint": "…", "day": "M" }
    },
    "instr:{instructor uuid}": {
      "readiness_summary": "…",
      "section_notes": [{ "section_id": "{section uuid}", "note": "…" }]
    },
    "__all__": { "readiness_summary": "…", "misconception_recommendation": "…" }
  }
}
```

**The readiness summary is per INSTRUCTOR, not per section** — two sections taught by one person
used to get two isolated paragraphs, neither of which could say whether a gap was the cohort's or
that one section's. A single-section view borrows its instructor's summary and keeps its own
numbers, quotes and recommendation.

The writer **merges** — scopes it wasn't sent survive — which is what lets an M-day run and a T-day
run write the same row without colliding. `__all__` is written only once every section has a scope.
Its *numbers*, though, are always recomputed over every live row (medians and means do not
recombine from sections).

> **`misconception_trends` is RETIRED (2026-07-22) — do not write it.** The prevalence bars now
> carry each misconception's own `description` and verbatim student `evidence` in a popover, which
> is what the paragraph existed to say; restating the bars beside the bars cost a full AI panel and
> added nothing. The clustering it used to describe became data (`misconception_aliases`). The
> field is still *accepted* by the writer so a replayed file does not fail, and historical rows keep
> it, but nothing renders it. *(This reference listed it as a current output until 2026-07-27.)*

*(The retired `public` equivalent was `assignments.analysis_report`, grouped `by_instructor` with
per-question bullet summaries. `/preflight-analyze` also wrote `kind='by_question'` rows in `app`
until 2026-07-21; both are gone — the per-question material now lives inside `readiness_summary`.
Note this is not a return to `by_instructor`: the instructor scope carries prose about a cohort the
instructor can act on, where the retired shape made the instructor the unit of *analysis*.)*

## Edge Functions

Deployed to Supabase (`supabase/functions/`). All verify the caller's JWT and authorization level. All return HTTP 200 with `{ success: true }` or `{ error: "…" }` (avoids `FunctionsHttpError` on non-2xx).

| Function | Purpose |
|---|---|
| `create-instructor` | Creates Supabase Auth user + `instructors` row + `staff_assignments` row; rolls back on partial failure. **Derives** the password (last name + `1234`, surname cut at the first hyphen/space) and sets `must_change_password` — the caller sends none, and one is accepted only from a global admin (the unbuilt tier D). Roles are `director`/`instructor`/`system_admin`; **`grader` is refused** as of 2026-07-27 |
| `remove-instructor` | Removes course access or clears `is_global_admin`; only SAs can remove other SAs |
| `reset-staff-password` | Puts one staff member back on that derived default and flags them for forced rotation. **Accepts no password parameter and rejects a request carrying one**, exactly like the student equivalent. Narrower authorization, though: **directors and system admins only** (not any staff member), and a director may not reset a system admin |
| `provision-students` | Bulk-creates Supabase Auth accounts for enrolled students where `auth_user_id IS NULL`; **email = the real address in `students.email`** (a student without one is skipped, not given a fabricated address), password = last 6 digits of the cadet ID, and the account is flagged `must_change_password`; runs serially; continues on individual failures; returns `{ success, count, errors, skipped_no_email }` |
| `reset-student-password` | Puts one cadet back on the default password (last 6 digits of their cadet ID) and flags them for forced rotation. **Accepts no password parameter and rejects a request carrying one** — the value is derived, so an instructor cannot choose a credential and then sign in as the student. Any staff member of the offering may call it; the target must be reachable through an enrollment in that offering |
| `set-own-password` | Change your own password. Exists because the forced-rotation flag lives in `app_metadata`, which a browser session cannot write — a direct `auth.updateUser()` would leave a rotated user flagged forever. Re-verifies the current password server-side (`updateUser` does not), skipping that check only under forced rotation |

## Section Naming Convention

`[M|T][1|3|5][A-D]` — M = M-day, T = T-day; number = period; letter = section within period.
M-day sections use `due_date_m` on assignments; T-day sections use `due_date_t`.

## Lesson Interactions (Claude Artifacts)

*Added 2026-06-11 by Matthew Recker — see `CHANGELOG.md`.*

A second path alongside assignments. A **lesson interaction** is a Claude artifact (an
interactive lesson hosted on claude.ai). Students launch it, work through it, and the
artifact sends a compressed Markdown **report** back to the site to be saved per student.
An AI skill will later summarize trends by section.

**Flow:**
1. A director adds a lesson in `site/faculty/lessons.html` — gives it a slug
   (`lesson-02-charge`), title, course, and `artifact_url`, then publishes it. (Claude can hand
   the director a prefilled one-click link — see `docs/contracts/INTERACTION-PREFILL-LINK.md`.)
2. A student opens `site/student/lessons.html`, clicks **Launch**, and the artifact opens on
   claude.ai. *(This was `site/interactions.html` until the 2026-07-28 promotion deleted it —
   students now navigate by assignment, not by modality.)*
3. On finish, the artifact opens
   `site/student/interaction-submit.html#t=interaction&i=<slug>&r=<lz report>&d=<lz json>` — data
   rides in the **URL hash** (GitHub Pages is static and can't accept a POST; the hash also keeps
   payloads out of logs). **Both `r` and `d` are required of the artifact.** `d` was written as
   "recommended" until 2026-07-28 and the reference artifact never sent it, which is why every
   Fall 2026 interactive submission needed `/interaction-backfill` to reconstruct its structured
   data after the fact. Without `d` there is no `effort`, so the auto-grade trigger writes no grade
   and the student contributes nothing to the cohort rollup — see contract §3.1.
4. The receiver decompresses the report, requires student login, and — only when the student
   clicks **Submit** — writes `submission_activities` (`report_markdown` = `r`, `content` = `d`)
   and commits the submission, which auto-grades it (migration 015).

**The artifact↔site contract:** the artifact's `#i=` slug **must match** an `interactions.id`
the director created — otherwise the foreign key rejects the write. This is the one manual
coordination point between the claude.ai artifact and this repo. The **full, frozen contract**
for what the artifact sends (permanent endpoint URL, `#t=`/`#i=`/`#r=`/`#d=` hash payload, and
the `schema: 1` structured-data spec — effort-graded, understanding diagnostic) is
`docs/contracts/INTERACTION-DATA-CONTRACT.md`. The permanent public endpoint is
`site/student/interaction-submit.html` — a stub forwarding into `site/app/student/` during the app
refactor, and since the 2026-07-28 promotion the real page at that same path, so the URL never
changed. The pre-2026-07-16 endpoints (`artifact-submit.html` and `interaction-submit.html`, at
root and under `site/`) were **retired without a redirect** and now 404; source is kept in
`_archive/artifact-receiver-v1/`. Effort (0–5) derives the points via the `app` trigger chain
(migration `014` turns effort into points, `015` creates the finalized grade the moment an
interactive submission commits); a non-meaningful reading reflection caps effort at 2, re-applied
server-side because the value rides in a hash the student controls. *(The `public` equivalent was
migration `013`'s 0–2 `score` trigger.)*

**Re-submitting does not overwrite, on the graded path.** Migration 015 finalizes the grade on
commit, and both the receiver page and the data layer refuse a second report once a finalized grade
exists — the first submitted report is the one that counts, and only an instructor reopening the
grade changes that. A `practice` path grades nothing, so re-running it *does* replace the stored
report. The retired `public` receiver overwrote in every case, which is where the old
"re-submitting will overwrite it" wording came from; it was removed from the submit page and from
contract §7 on 2026-07-28.

**Prefill links:** a Claude artifact can hand the director a one-click link that opens
`site/faculty/lessons.html` with the New Interaction form already filled in
(`?new=1&id=&course=&title=&desc=&url=&pub=`); the director reviews and clicks Save. The
link's `id` must equal the artifact's `#i=` slug. Full spec + builder: `docs/contracts/INTERACTION-PREFILL-LINK.md`.

**Security model:**
- `report_markdown` is stored as an **inert blob** (≤100 KB) and is **sanitized with
  DOMPurify only at render time** — never executed. The `#r=` payload is user-controllable,
  so treat it as untrusted anywhere it's displayed (admin viewer, submit preview).
- **RLS is the real gate:** a student can only write a row where
  `students.auth_user_id = auth.uid()`, so a spoofed `student_id` is rejected by the DB.
  Directors/admins read all reports; instructors read their own sections.

**The cohort aggregator is `/lesson-aggregate`** (renamed from `/interaction-aggregate`
2026-07-21). It produces **every** AI panel on the rollup — the readiness summary (per instructor),
the one-line teaching recommendation, AI-picked showcase quotes — into `app.analysis_reports`, and
it is **modality-blind**: it reads the `schema: 1` assessment from `submission_activities.content`
for artifact takers and from `grades.diagnostic` for question-set takers, so a question-only lesson
and a mixed cohort both get a full rollup. It writes **three kinds of scope** (section, instructor,
`__all__` — see the payload above), and `__all__` is written only once every section has one, so a
lesson with split deadlines is closed out in two cheap day-scoped runs. Driven by
`supabase/admin/lesson_aggregate.py`
(`pull --day` → `write-analysis` → `status`). Original design:
`docs/decisions/INTERACTION-AGGREGATION.md` (written against the retired `interaction_analysis`
table); output contract: `docs/decisions/ROLLUP-AGREEMENT.md`. Distinct from
`/interaction-backfill`, which only repairs per-student `report_data` on the interactive path.

**`/lesson-cycle` is the normal way to run both.** It sequences `/preflight-analyze` then
`/lesson-aggregate` for one lesson and one day track after that day's deadline, and is the entry
point for an unattended scheduled run. Nothing in the repo schedules anything — the skill documents
the `claude -p` invocation and leaves the scheduler to the operator.

## preflight-analyze Skill

Analyzes student submissions for a given assignment and writes, **per student**: suggested scores
and feedback, the hidden Q2-effort / Q3-understanding diagnostics, and the `schema: 1` assessment
described under `grades.diagnostic` above. Its blast radius is `grades` and nothing else.

It writes **no** cohort output. Until 2026-07-21 it also produced a per-instructor by-question
breakdown; that is retired — an instructor is not a unit of analysis, and the material now lives
inside `/lesson-aggregate`'s readiness summary. The two run on different clocks: grading happens
whenever work needs scoring, often split M/T, while cohort prose is written once per section after
that section's deadline.

**First time on a new machine? Run the setup wizard:**
```
/setup-preflight
```
This walks you through entering your Supabase credentials, writes your local config file,
and verifies the connection. Takes about 2 minutes.

**Manual setup** (if you prefer):
1. `cp .ai/skills/preflight-analyze/config.json.template ~/.claude/skills/preflight-analyze/config.json`
2. Fill in `supabase_url`, `supabase_service_key` (service_role key from Supabase dashboard → Project Settings → API), `textbook_base_path`, `default_course_id`
3. Set `textbook_base_path` to `{repo_root}/textbook-pdfs/{course_id}/` (see below)
4. The `config.json` is gitignored — never commit it

**Textbook PDFs** (`textbook-pdfs/` — gitignored, ~968 MB):
PDFs are NOT in the repo. Download from Teams → Files → `Core_Preflights_PDFs` and place in:
```
textbook-pdfs/
  phys-215/    ← Physics 215 lesson PDFs
  phys-110/    ← Physics 110 lesson PDFs
```
See `textbook-pdfs/README.md` for full instructions.

**Usage**: `/preflight-analyze [course_id] [assignment_id] [M|T]`

Example: `/preflight-analyze phys-215 preflight-2 M`

## Known Misconception Patterns (for /preflight-analyze)

Use these when writing tailored yellow (`warn`) feedback. Each pattern includes the specific correction to give the student.

### Preflight-1 — Electrostatics (charged insulator near neutral conductor)
*Reference: OpenStax Vol. 2 §5.2, Figures 5.10–5.11*

| Error | What the student says | Correct it by saying |
|---|---|---|
| `repel/wrong-direction` | Conductor is repelled, or electrons move *away* from insulator | Near face gets opposite charge (electrons toward + insulator) → net attraction |
| `same-charge-near-face` | Near face acquires same charge as insulator | Free electrons in conductor move *toward* + insulator → near face is negative |
| `shielding` | "Conductor shields the field" explains the force | Interior is shielded; external force on the conductor still exists via polarization |
| `neutral=no-force` | "Neutral → no force" (misapplied Coulomb's law) | Coulomb's law is for fixed point charges; conductor polarizes → charges redistribute |
| `forces-cancel` | Attractive and repulsive forces on conductor cancel | They don't cancel: near face is closer → net attraction wins |
| `attract-incomplete` | Correctly says "attract" but gives only the near-face argument | Add: far face simultaneously acquires like charge; near face wins by distance |

### Preflight-2 — Polarizers (two linear polarizers in sequence)
*Reference: OpenStax Vol. 3 §1.7, Malus's Law I = I₀cos²θ*

| Error | What the student says | Correct it by saying |
|---|---|---|
| `wavelength-confusion` | Polarizers filter colors/wavelengths | Polarizers filter oscillation orientation, not wavelength; introduce Malus's Law |
| `reflection-losses` | Light is reflected at each polarizer | Polarizers selectively *absorb* the perpendicular component; not reflection |
| `each-halves` | Each polarizer halves intensity (fixed fraction, angle-independent) | First polarizer halves unpolarized light; second depends on angle: I = I₀cos²θ |
| `correct-missing-malus` | Correct mechanism but no formula | Add I = I₀cos²θ; intensity depends on cos² of angle between polarizer axes |
| `vague-absorption` | "Light is absorbed" with no angle dependence | Correct mechanism, but the angle between axes is the key variable |

### Preflight-3 — Three-charge superposition (Coulomb force on middle charge)
*Reference: OpenStax Vol. 2 §5.3, Example 5.2*

| Error | What the student says | Correct it by saying |
|---|---|---|
| `scalar-sum` | Adds force magnitudes without directions | Forces are vectors — must specify direction (sign) for each, then sum algebraically |
| `ambiguous-direction` | Mentions two forces but doesn't say which direction each acts | Force from left charge points right (+x), force from right charge points left (−x); net = algebraic sum |
| *(upgrade to green)* | Explicitly says "as vectors" or "vector sum" AND gives direction reasoning | Promote to `full` credit with empty feedback |

## The artifact builder (`_builder/`)

*Merged in 2026-08-07 from `ranador/Socratic-Artifact-Builder`, now archived. Decision record:
[`docs/decisions/BUILDER-MERGE.md`](../../docs/decisions/BUILDER-MERGE.md).*

PREP consumes Claude artifacts; `_builder/` is where they are made. It is a **build-input store,
not a runtime** — nothing in it serves traffic. It holds the material a Claude session reads in
order to emit a React artifact, plus one script that specializes that material per course.

| Component | Owns |
|---|---|
| `_builder/preflight-kit/` | the shared build system — the `preflight-factory-v2` skill, the frozen contract snapshots, the verbatim sources, `THEME_REFERENCE.md`. **Hash-locked** by `MANIFEST.sha256`, seven files, checked by `tools/verify.py` (22 checks) |
| `_builder/courses/<id>/COURSE_PROFILE.md` | one course's identity, vocabulary, endpoints, session shape, slug namespace. **The only file edited per course** |
| `_builder/preflight-kit/tools/localize.py` | bakes a profile into `courses/<id>/build/` (gitignored, wiped each run) |
| a Claude Project, per course | builds artifacts; holds the localized kit in project knowledge. **Uploaded by hand and unversioned** — nothing checks that project knowledge matches this repo |
| a published artifact | one lesson's ~10-minute cadet conversation; emits `r` and `d` to `site/student/interaction-submit.html` |

**A lesson flows:** attach the lesson PDF in the course's Claude Project → the skill reads the
schedule for that lesson's topic → emits a preview for approval → emits a `.jsx` → a human
publishes it from a Claude session → a director registers it via the prefill link → cadets take
the session → the artifact submits `r` and `d` as a URL hash.

**Current holdings: 46 artifacts, 30 published, 0 registered.** phys-215 has 29 (all published);
phys-310 has 17 (one published). *Published is not registered, and the gap is silent* — until a
lesson row exists with the matching slug, the artifact is a live URL no cadet can reach through
the course site.

**Where things are:**
- `.jsx` source → the private `artifact-sources` Storage bucket (CORE.md §3). Not in git.
- `BUILD-LOG.md`, `REVIEW-NOTES.json`, profiles, schedules, `MURRAY-GROUNDING.md` → in git, under
  `_builder/`, which Pages does not serve.
- `_builder/CHANGELOG.md` → the builder's own history, 2026-07-30 to 2026-08-06.

**Three rules that govern writes here:**
- **The kit is never edited per course.** A per-course edit forks it for every course at once.
  All variation goes in a profile. The one exception already taken: `tools/` is authored rather
  than hash-locked, so a genuine bug fix there is legitimate and gets a CHANGELOG entry.
- **Publishing is the irreversible step.** Slug, objective keys, submit URL and model candidates
  are baked in at publish time. A rebuild mints a **new 8-hex slug** (contract §3.2) and therefore
  registers as a **new lesson row** — applying a review note to a published artifact is a
  republish and a re-registration, never an in-place edit.
- **Effort is the grade, not correctness.** A cadet who works through the whole conversation and
  understands nothing earns full marks. Everything diagnostic stays diagnostic.

### Sharp edges the builder already paid for

| The trap | What happens | How to avoid it |
|---|---|---|
| **`node --check` silently passes JSX** | It reports **exit 0** on an invalid `.jsx` — Node auto-detects any file containing `import`/`export` as ESM and does not reject JSX on that path. A two-line JSX file with no `import` correctly fails; add one `import` and the same JSX passes | Do not use it. **Publishing is the only JSX parser this project has.** `check_artifact.py` is explicitly *not* a syntax check, however green — it checks NUL bytes, delimiter balance, contract strings and per-course constants |
| **A Python text-mode read silently converts CRLF to LF**, so a three-line edit lands as a whole-file rewrite | `open(p, encoding="utf-8").read()` applies universal newlines. A 12-string substitution across three artifacts produced **6,327 insertions and 6,327 deletions** — every line of every file, with the three real changes invisible inside it. Nothing errors | **Read and write bytes** for any file you did not create. Then **read `git diff --stat` before staging**: an edit whose diff is the size of the file is a line-ending rewrite until proven otherwise |
| **OpenStax lesson-PDF equations are vector paths, and every text extractor drops them silently** | `pdftotext -layout` and `pypdf` both return complete-*looking* prose with every equation simply absent — "We can rewrite this as", blank, "5.3". No error, no placeholder. Confirmed: the page carries **1,083 Bézier operators** and no math font | **Rasterize and read the pages.** `pymupdf`: `pg.get_pixmap(dpi=150).save(...)`, then read the PNGs. An agent that trusts the text layer writes a confident, equation-free grounding for a lesson that is *about* an equation |
| **A hand transcription between a source and a load-bearing string corrupted a published artifact's identity** | phys-310's schedule was hand-transcribed and dropped one word from lesson 2's topic. The published slug is `phys310-atoms-and-nuclei-83022f32`, minted from a word that was never in the source. `check_artifact.py` validates a slug's *shape*, never its *derivation* | Register every transcription against its source in `docs/DOC-SOURCES.json`. **Never type a slug** — read it out of the artifact |
| **Twelve published artifacts disagree with their own pacing constant** | Each artifact states its per-topic budget in **six** places that must agree; in twelve of them one disagrees. The runtime effect is small; **the build risk is not** — a new artifact rebased off one of the twelve inherits the wrong string with nothing detecting it | **Rebase off lessons 21+ or 2/3, never off 4–20.** Do not fix the twelve without asking: all are published, so twelve fixes are twelve new lesson rows |
| **`git add -A` commits the human's edits under the agent's message** | A deletion made in the IDE while an agent was mid-task got staged and committed under a message asserting the file was still present | **Read `git status` before staging and account for every line.** Stage explicit paths |
| **A confidence flag on the phys-310 corpus can mean five different things** | Across sixteen builds: invisible, a flag on the *subject*, packaging only, a genuine content caveat, and one that *raises* confidence | **Read the Flags block, never the confidence word.** A zero cross-check is not the same as unsupported — check for internal corroboration first |

---

## Operating rules & safety → CORE.md

The non-negotiable rules that used to be restated here live once in [`CORE.md`](CORE.md), not in this
reference: 3-state scoring and `is_finalized=false` (§6), the public anon key vs. never-commit service
key (§3), the always-update-`CHANGELOG.md` requirement (§5), the no-Node/build-step rule (§2), and the
Supabase free-tier unpause (§1). This file stays the *reference*; CORE.md is the *law*.
