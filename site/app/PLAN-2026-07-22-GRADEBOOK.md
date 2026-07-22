# PLAN — P1.1 Gradebook · P1.2 Student detail · P1.4 EI logging

*Authored 2026-07-22 by Casey (via Claude). Scopes three roadmap items that are one feature in
practice: a grid, the page you reach by clicking a name in it, and the thing you do on that page.*

> Companion to [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md) P1.1 / P1.2 / P1.4.
> Build order is **P1.4 schema → P1.1 → P1.2 → P1.4 UI**, for one reason: the DDL needs
> `prep_app_owner` unsealed, and that door is open now. Everything else is frontend-only and can be
> done against a sealed database.

---

## 0. Why these three together

They share one data spine and one navigation path:

```
gradebook.html  ──click a name──▶  student.html?e=<enrolment>  ──"Log EI"──▶  ei_sessions
   (P1.1)                              (P1.2)                                    (P1.4)
```

Building them separately would mean building the same loader three times. The roadmap already says
so — P1.1 "Depends on: P1.2 (name click target)".

**One scale question, already answered.** Both modalities land on the same `grades.points_earned`
against the same `points_possible` (ROADMAP Q2). No normalization layer. The 0–5 diagnostics
(`q2_effort`, `q3_understanding`, schema:1 `effort` / `overall_understanding`) stay a **separate
layer** used by the student page and never summed into a total.

---

## 1. P1.4 (schema) — `app.ei_sessions`

New migration `supabase/migrations/app/011_ei_sessions.sql`.

**Keyed on `enrollment_id`**, not `(student_id, offering)`. Two reasons: every per-student table in
the model already does (`005_extensions.sql:14-20` gives the argument — a record belongs to a
student's place in a section in a term), and it makes the RLS predicate **byte-identical** to the
one `extensions` and `grades` already use, which is the difference between a reviewed policy and a
new one.

```sql
CREATE TABLE ei_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    uuid NOT NULL REFERENCES enrollments(id)  ON DELETE CASCADE,
  instructor_id    uuid          REFERENCES instructors(id)  ON DELETE SET NULL,
  started_at       timestamptz NOT NULL,
  duration_minutes smallint NOT NULL DEFAULT 30,
  notes            text,
  batch_id         uuid,          -- groups one bulk log; NULL for a single
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

**No unique constraint.** EI is inherently repeatable — the same student may attend twice in a week.
(`007:49-56` records why `extensions` kept one: PostgREST upsert needs it to infer a conflict target.
That reasoning does not transfer; these are plain inserts.)

**`batch_id` is what makes bulk correctable.** The director's use case is ~20 minutes after class
with several students at once. Logging that as six unrelated rows means six edits to fix a wrong
duration. One `batch_id` makes it one.

**RLS: staff of the section only, read and write. No student policy at all** — director's Q3
decision, "additive to open later, breaking to close". This is the `extensions` block *minus*
`extensions_own`.

**No self-attribution trigger.** `review_signoffs` has one (`007:208-228`); this deliberately does
not. A director logging on behalf of a colleague who ran the session is a real case, and an EI row
carries no consequence for the student, so forgery risk does not justify blocking it. Recorded here
so the omission reads as a decision.

**Not granting anything.** `app_schema_bootstrap.sql` §4 default privileges already cover a table
created by the owner (`008_student_identity.sql:147-149` states the convention). 009 and 010 drifted
from it with redundant `GRANT`s; this follows 008.

---

## 2. P1.1 — Gradebook

`site/app/faculty/gradebook.html` + `site/app/js/faculty-gradebook.js`. Nav entry, ungated
(instructors see their own sections, exactly like Grade).

**Loader is bounded and narrow.** Not `loadRoster` — ROADMAP P3.7 flags that it fetches every
student in the database and filters client-side, and the gradebook is what makes that untenable.
Four queries, all scoped to `ctx.sectionIds` or chunked over enrolment ids:

| Query | Select | Why narrow |
|---|---|---|
| enrollments | `id, student_id, section_id, students!inner(student_id, name)` | rows |
| assignment_offerings | `OFFERING_SELECT`, published, this course offering | columns |
| grades | `enrollment_id, assignment_offering_id, points_earned, points_possible, effort, is_finalized, source` | **not** `GRADE_SELECT` — `question_scores` and `diagnostic` are per-student payloads no cell renders |
| submissions | `id, enrollment_id, assignment_offering_id, status, committed_at` | **not** `SUBMISSION_SELECT` — that drags in every `submission_activities` blob |
| extensions | `enrollment_id, assignment_offering_id, extended_due_at`, `revoked_at IS NULL` | needed or a student with an extension reads as missing |

That last row is the bug `faculty-data.js:148` already has — it passes `null` for the extension
argument to `effectiveDue`, so its status can call a student overdue who is not. Do not copy it;
copy `faculty-grade.js`, which does it correctly.

**Cell states**, and the rule that a blank must mean something:

| State | When | Renders |
|---|---|---|
| `graded` | grade row, finalized | points |
| `draft` | grade row, `is_finalized = false` | points + AI/draft marker |
| `ungraded` | submission committed, no grade | `·` |
| `missing` | deadline passed, nothing committed | `—` in the zero band |
| `pending` | deadline not yet passed | blank |

**Zero is its own band** — the one idea worth taking from `djGradebookProject` (`helpers.py:286`).
Missing work and failing work are different facts and must not share a colour.

**Bands use the `--d0…--d5` data-viz ramp, not the status triad.** `full`/`warn`/`zero` green-amber-red
is a contract with `question_scores[].status` (DESIGN.md:237-243, :451-453) and must not be
repurposed for a percentage scale. `--d0…--d5` is a 6-step ramp that exists for exactly this.

**Sticky name column + sticky header row.** Essential past ~8 lessons, per the roadmap. Three
z-index layers: header `2`, name column `1`, the top-left corner cell `3`.

**Shortcodes as headers.** `preflight-02` → `PF02`, derived from the slug, keeping columns ~5rem.
Pure function, unit-tested, with the full title on `title=` and in the `<th>`'s `aria-label`.

**Not building:** weighting, `is_bonus`, `include_prog`, a numeric override field. PREP has no
weighting today and the roadmap parks the numeric field with P3.5. Do not copy
`djGradebookProject`'s grid itself — no sticky columns, no virtualization, DataTables pagination.

---

## 3. P1.2 — Student detail

`site/app/faculty/student.html?e=<enrolment uuid>`. **No nav entry** — a drill-down, like
`report.html`.

Keyed on the enrolment, not the cadet id, because that is what scopes it to one section in one term
and what every RLS policy already keys on. A cadet id would have to be resolved to an enrolment
before anything could be read anyway.

Sections, in order:

1. **Three stat cards** — identity (name, cadet id, section, squadron, email, auth state) ·
   performance (points, %, band, counts graded/missing) · class comparison (their % against section
   and course medians).
2. **Per-lesson table** — lesson, due, status, points, effort 0–5, understanding 0–5, late chip.
   Reuses `submissionLateness()`/`lateBy()` from P0.12 rather than recomputing.
3. **Work** — free-response answers and interactive reports, collapsed per lesson.
4. **Misconceptions across the term** — folded from `grades.diagnostic` schema:1
   `misconceptions[]`, canonicalized with the existing `canonMisconceptionId()`. This is the one
   view in PREP that answers "is this student repeatedly wrong about the same thing?"
5. **EI panel** — sessions list + Log EI (P1.4).
6. **Comment card** — auto-assembled advising blurb + free-text box + **Copy**. The
   `djGradebookProject` idea worth taking wholesale; it is the Report tab's copy-for-slides muscle
   pointed at one student.

**`back_url` from the referrer**, so Done returns you to the gradebook or the roster depending on
where you came from. Validated against a same-origin allowlist — a referrer is attacker-controllable
and must never become an open redirect.

**FERPA.** The page concentrates everything about one cadet on one screen, so the plan verifies —
not assumes — that `students`, `grades`, `submissions` and `submission_activities` are all
section-scoped in **RLS**, and adds an `app_rls_test.py` persona check for the exact read this page
performs. The roadmap requires this be enforced in the database, not the UI.

**Q1 stays hidden.** Zero-point questions are scored but never rendered (CORE.md §2, `grade.html:207,215`).
The written-work section filters on `points === 0`, matching the Grade tab.

---

## 4. P1.4 (UI) — single and bulk

**Both paths ship in the same pass.** The roadmap is explicit that a design which only logs one
student at a time "will be abandoned by week three", because the common event is several students
at once, most days.

- **Single** — a button on the student page opens a modal prefilled with today's date, the current
  local time rounded down to 5 minutes, and 30 minutes' duration. All editable.
- **Bulk** — on the gradebook, a "Log EI" mode turns the name column into checkboxes; pick a
  date/time/duration once, tick who was there, log. One `batch_id`, one `notes`.

**Times are stored UTC and rendered local.** The modal's `datetime-local` input is local wall-clock;
convert on write, convert back on read. No `zoneinfo` equivalent exists in the browser and none is
needed — the machine's own zone is America/Denver in the only place this runs.

**Writes are sequential, not one bulk insert.** Copied from the P1.12 extension batch: a partial
failure is reportable per student rather than collapsing into one rejected promise.

---

## 5. Verification — what "vetted" means here

Nothing in this plan is considered done on a syntax check.

| Layer | Command | Covers |
|---|---|---|
| Pure logic | `cd tests/app-schema && npm test` | shortcodes, bands, cell states, matrix assembly, comment-card assembly, EI row building, local↔UTC |
| Schema invariants | `.venv/Scripts/python supabase/admin/app_invariant_test.py` | `ei_sessions` constraints, cascade, defaults |
| RLS enforcement | `.venv/Scripts/python supabase/admin/app_rls_test.py` | staff read/write scoped to section · **student denied** · the student-detail read path |
| Browser | `node tests/browser-harness/pass.mjs` + `checks.mjs` | both new pages clean in light and dark, as director and instructor |

The RLS student-denied check is the one that matters most: Q3 decided students cannot read their own
EI log, and that is a decision only the database can keep.

**Known limits, to be stated in the CHANGELOG rather than papered over:** there is no real EI data
and no late work in the term yet (today is 2026-07-22; the active preflight is due Aug 9), so the
bulk-log flow and the late chip on the per-lesson table are exercised by seeded fixtures and the
logic harness, not by production data.
