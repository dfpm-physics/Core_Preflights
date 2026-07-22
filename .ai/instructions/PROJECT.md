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
  sign-in. **There is no password reset by email — PREP has no SMTP.** A locked-out cadet asks any
  instructor of their section, who restores the default from the Roster page; instructors cannot
  view or choose a password. *(Cadets provisioned before 2026-07-21 still sign in with the
  fabricated `cadetID@usafa.edu` address that predates the registrar import.)*
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
| `site/index.html` | Student-facing assignment submission and grade review |
| `site/admin.html` | Instructor grading panel (Grade, Report, Assignments, Roster, Sections, Export tabs) |
| `site/interactions-admin.html` | Director/admin: add/edit/publish lesson interactions, view per-student reports |
| `site/interactions.html` | Student-facing list of published lesson interactions (Launch links) |
| `site/app/student/interaction-submit.html` | Receives a Claude artifact's compressed report and saves it per student. Reached via the frozen contract URL `site/student/interaction-submit.html` (a stub the promotion overwrites) |
| `site/app/faculty/lessons.html` | Director lesson authoring; accepts AI-generated prefill links via the frozen URL `site/faculty/lessons.html` (same stub pattern) |
| `site/js/config.js` | Supabase URL + anon key (safe to commit) |
| `site/css/styles.css` | Shared styles |
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

Three tiers, enforced in `site/admin.html` via `isDirectorForCurrent()`:

| Role | Condition | Access |
|---|---|---|
| **System Admin** | `instructors.is_global_admin = true` | Full access to all courses |
| **Course Director** | `instructor_course_access.role = 'director'` | Full access to one course (Assignments, Roster, Sections, Instructors tabs) |
| **Instructor** | `instructor_course_access.role = 'instructor'` | Grades own assigned sections only |

`isDirectorForCurrent()` returns true if `is_global_admin` OR `role = 'director'` for `currentCourse`.
"— all my sections —" filter in Grade/Report tabs shows **only sections personally assigned** to the logged-in instructor; admins/directors with no assigned sections must use "All sections" to see students.

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
every scope inside the payload:
```json
{
  "kind": "readiness",
  "scopes": {
    "{section uuid}": {
      "section_code": "M1A",
      "readiness_summary": "…",
      "misconception_trends": "…",
      "misconception_recommendation": "one teaching action, rendered as its own line",
      "selected_quotes": [{ "student_id": 3000990009, "section_id": "{section uuid}" }],
      "meta": { "n": 18, "generated_by": "lesson-aggregate@2026-07-21",
                "source_fingerprint": "…", "day": "M" }
    },
    "__all__": { "…same, but no quotes…": null }
  }
}
```
The writer **merges** — scopes it wasn't sent survive — which is what lets an M-day run and a T-day
run write the same row without colliding. Sections are aggregated first; `__all__` is synthesized
from those section scopes and is written only once every section has one. Its *numbers*, though,
are always recomputed over every live row (medians and means do not recombine from sections).

*(The retired `public` equivalent was `assignments.analysis_report`, grouped `by_instructor` with
per-question bullet summaries. `/preflight-analyze` also wrote `kind='by_question'` rows in `app`
until 2026-07-21; both are gone — an instructor is not a unit of analysis, and the per-question
material now lives inside `readiness_summary`.)*

## Edge Functions

Deployed to Supabase (`supabase/functions/`). All verify the caller's JWT and authorization level. All return HTTP 200 with `{ success: true }` or `{ error: "…" }` (avoids `FunctionsHttpError` on non-2xx).

| Function | Purpose |
|---|---|
| `create-instructor` | Creates Supabase Auth user + `instructors` row + `instructor_course_access` row; handles all three roles; rolls back on partial failure |
| `remove-instructor` | Removes course access or clears `is_global_admin`; only SAs can remove other SAs |
| `provision-students` | Bulk-creates Supabase Auth accounts for enrolled students where `auth_user_id IS NULL`; **email = the real address in `students.email`** (a student without one is skipped, not given a fabricated address), password = last 6 digits of the cadet ID, and the account is flagged `must_change_password`; runs serially; continues on individual failures; returns `{ success, count, errors, skipped_no_email }` |
| `reset-student-password` | Puts one cadet back on the default password (last 6 digits of their cadet ID) and flags them for forced rotation. **Accepts no password parameter and rejects a request carrying one** — the value is derived, so an instructor cannot choose a credential and then sign in as the student. Any staff member of the offering may call it; the target must be reachable through an enrolment in that offering |
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
2. A student opens `site/interactions.html`, clicks **Launch**, and the artifact opens on claude.ai.
3. On finish, the artifact opens
   `site/student/interaction-submit.html#i=<slug>&r=<lz-string payload>` — data rides in the
   **URL hash** (GitHub Pages is static and can't accept a POST; the hash also keeps payloads
   out of logs).
4. The receiver decompresses the report, requires student login, and upserts into
   `preflight_interaction_reports` — but only when the student clicks **Submit**.

**The artifact↔site contract:** the artifact's `#i=` slug **must match** an `interactions.id`
the director created — otherwise the foreign key rejects the write. This is the one manual
coordination point between the claude.ai artifact and this repo. The **full, frozen contract**
for what the artifact sends (permanent endpoint URL, `#t=`/`#i=`/`#r=`/`#d=` hash payload, and
the `schema: 1` structured-data spec — effort-graded, understanding diagnostic) is
`docs/contracts/INTERACTION-DATA-CONTRACT.md`. The permanent public endpoint is
`site/student/interaction-submit.html` — during the app refactor a stub that forwards into
`site/app/student/`, and after promotion the real page at the same path, so the URL never
changes. The pre-2026-07-16 endpoints (`artifact-submit.html` and `interaction-submit.html`, at
root and under `site/`) were **retired without a redirect** and now 404; source is kept in
`_archive/artifact-receiver-v1/`. Effort (0–5) auto-derives a 0–2 `score` via DB trigger
(migration `013`); a non-meaningful reading reflection caps effort at 2.

**Prefill links:** a Claude artifact can hand the director a one-click link that opens
`site/interactions-admin.html` with the New Interaction form already filled in
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
2026-07-21). It produces **every** AI panel on the rollup — readiness summary, misconception
trends, the one-line recommendation, AI-picked showcase quotes — into `app.analysis_reports`, and
it is **modality-blind**: it reads the `schema: 1` assessment from `submission_activities.content`
for artifact takers and from `grades.diagnostic` for question-set takers, so a question-only lesson
and a mixed cohort both get a full rollup. It aggregates **per section**, then synthesizes the
whole-course scope from those section scopes, so a lesson with split deadlines is closed out in two
cheap day-scoped runs. Driven by `supabase/admin/lesson_aggregate.py`
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

## Operating rules & safety → CORE.md

The non-negotiable rules that used to be restated here live once in [`CORE.md`](CORE.md), not in this
reference: 3-state scoring and `is_finalized=false` (§6), the public anon key vs. never-commit service
key (§3), the always-update-`CHANGELOG.md` requirement (§5), the no-Node/build-step rule (§2), and the
Supabase free-tier unpause (§1). This file stays the *reference*; CORE.md is the *law*.
