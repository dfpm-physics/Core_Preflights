# iPREP — Project Overview

> **Multi-agent note:** Shared operating *rules* for all agents (Claude, Codex, humans) live in
> [`CORE.md`](CORE.md) — live-system safety and the coordination gate, secrets/config, git/publish,
> and CHANGELOG conventions. **CORE.md is authoritative**; this file is the agent-neutral deep
> *reference* (architecture and data model). If the two ever conflict, CORE.md wins. The root
> auto-loading files (`AGENTS.md` for Codex, `CLAUDE.md` for Claude) wire each agent into both.

**iPREP** — *interactive Pre-lesson Readiness Engagement Platform* — is the user-facing brand
of this system. A GitHub Pages + Supabase system for managing physics preflight assignments and
lesson interactions at USAFA. Replaces GradeScope for two courses: Physics 110 and Physics 215.

> The brand name is **iPREP**; the repo, GitHub Pages path, and download/export filenames remain
> `Core_Preflights` (changing those would break links, the artifact data contract, and Blackboard imports).

## Tech Stack

- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages (no build step)
- **Backend**: Supabase (PostgreSQL + Auth + REST API)
- **Auth**: Supabase Auth for both instructors (email/password) and students (cadetID@usafa.edu / last-6-digits default password)
- **Analysis**: `preflight-analyze` shared AI skill (see `.ai/skills/preflight-analyze/`)

> **No Node dependency or build step — do not introduce one** (full rule in [`CORE.md`](CORE.md) §2,
> including how to verify changes in a browser with `python -m http.server 8000`). The frontend is
> hand-authored ES modules + plain CSS the browser runs directly.

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
| `site/interaction-submit.html` | Receives a Claude artifact's compressed report and saves it per student |
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
| `scores` | Graded scores with `question_scores` JSONB and `is_finalized` flag |
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

**`scores.question_scores`** — written by `/preflight-analyze`, read by Grade tab:
```json
{
  "q1": { "score": 5, "max": 5, "feedback": "",                          "status": "full" },
  "q2": { "score": 5, "max": 5, "feedback": "While we gave you credit…", "status": "warn" },
  "q3": { "score": 0, "max": 5, "feedback": "No answer provided.",        "status": "zero" }
}
```
`status` drives the 3-state color toggle: `"full"` = green, `"warn"` = yellow (full credit but flagged), `"zero"` = red.

**`assignments.analysis_report`** — written by `/preflight-analyze`, read by Report tab:
```json
{
  "generated_at": "ISO timestamp",
  "day_filter": "M",
  "by_instructor": {
    "{instructor_uuid}": {
      "instructor_name": "…",
      "sections": ["M1A", "M1B"],
      "questions": { "q1": { "summary": "bullet one\nbullet two\nbullet three" } }
    }
  }
}
```
`summary` is a `\n`-joined string of bullet text — one bullet per line, no leading `•` or `-`. The Report tab adds list styling. Running M and T separately merges cleanly — each run PATCHes only its own instructor entries and preserves the other day's entries.

## Edge Functions

Deployed to Supabase (`supabase/functions/`). All verify the caller's JWT and authorization level. All return HTTP 200 with `{ success: true }` or `{ error: "…" }` (avoids `FunctionsHttpError` on non-2xx).

| Function | Purpose |
|---|---|
| `create-instructor` | Creates Supabase Auth user + `instructors` row + `instructor_course_access` row; handles all three roles; rolls back on partial failure |
| `remove-instructor` | Removes course access or clears `is_global_admin`; only SAs can remove other SAs |
| `provision-students` | Bulk-creates Supabase Auth accounts for all students in a course where `auth_user_id IS NULL`; email = `studentId@usafa.edu`, password = last 6 digits of ID; runs serially; continues on individual failures; returns `{ success, count, errors }` |

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
1. A director adds an interaction in `site/interactions-admin.html` — gives it a slug
   (`lesson-02-charge`), title, course, and `artifact_url`, then publishes it.
2. A student opens `site/interactions.html`, clicks **Launch**, and the artifact opens on claude.ai.
3. On finish, the artifact opens
   `artifact-submit.html#i=<slug>&r=<lz-string payload>` — data rides in the **URL hash**
   (GitHub Pages is static and can't accept a POST; the hash also keeps payloads out of logs).
4. `site/artifact-submit.html` decompresses the report, requires student login, and upserts
   into `preflight_interaction_reports`.

**The artifact↔site contract:** the artifact's `#i=` slug **must match** an `interactions.id`
the director created — otherwise the foreign key rejects the write. This is the one manual
coordination point between the claude.ai artifact and this repo. The **full, frozen contract**
for what the artifact sends (permanent endpoint URL, `#t=`/`#i=`/`#r=`/`#d=` hash payload, and
the `schema: 1` structured-data spec — effort-graded, understanding diagnostic) is
`docs/contracts/INTERACTION-DATA-CONTRACT.md`. The permanent public endpoint is root `artifact-submit.html`, which preserves query/hash data while forwarding to
`site/artifact-submit.html`; root `interaction-submit.html` remains the legacy alias
so deployed artifacts never need revising. Effort (0–5) auto-derives a 0–2 `score` via DB
trigger (migration `013`); a non-meaningful reading reflection caps effort at 2.

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

**Deferred (now spec'd, not built):** the **cohort aggregator** that produces the rollup's AI panels
(per-section readiness summaries, misconception trends, AI-picked showcase quotes) and where its
*output* is stored — designed in `docs/decisions/INTERACTION-AGGREGATION.md` (proposes a new `interaction_analysis`
table; mirrors the `assignments.analysis_report` pattern). All inputs are already in `report_data`, so
no data-contract change is needed. Distinct from `/interaction-backfill`, which only fills per-student
`report_data`.

## preflight-analyze Skill

Analyzes student submissions for a given assignment, writes suggested scores to Supabase, and generates per-instructor misconception reports.

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
