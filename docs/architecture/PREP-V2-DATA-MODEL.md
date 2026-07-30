# PREP v2 data model — containers, offerings, activities

**Status:** implemented in `app/001_core_model.sql`; live only after cutover

*Authored 2026-07-20 by Casey (via Claude). Companion to the decision record
[`../decisions/PREP-V2-SCHEMA.md`](../decisions/PREP-V2-SCHEMA.md), the authorization model
[`../decisions/PREP-V2-AUTHORIZATION.md`](../decisions/PREP-V2-AUTHORIZATION.md), and the older
[`LESSON-UNIFICATION.md`](LESSON-UNIFICATION.md), whose reconciliation problem this schema removes.
See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It explains how the `app` schema fits together — the four layers and the
> one central idea an assignment is a *container* and activities are what is *inside* it — so a reader
> can navigate [`../../supabase/migrations/app/001_core_model.sql`](../../supabase/migrations/app/001_core_model.sql)
> without reverse-engineering it. The migration is authoritative for exact columns, constraints, and
> triggers; this doc is the map, not the territory, and does not restate the DDL.
>
> **Audience.** This is the developer/agent-facing map — for someone *changing* the schema. The
> director-facing account of the same model, for someone *using* PREP, is the tier-gated help pair
> `site/help/director-course-structure.md` (the concepts) and `director-schema-reference.md` (the
> table-by-table reference with a diagram). Those deliberately omit the invariants, the frozen
> surfaces, and the RLS reasoning that this doc and its companion decision records carry.

---

## 1. The central shape

An **assignment is a container.** It is a reusable, term-free definition — a kind, a title, shared
objectives — and it carries no grading policy at all. What lives inside it are **activities**: the
possibilities offered to a student, each with a `modality` of `written` (a question set) or
`interactive` (a Claude artifact). An activity is pure content; whether it is graded is not stored on
it.

Scheduling a container into one term produces an **assignment offering**. The offering carries the
per-term decisions — due dates, points, publish state, the locking policy — and it is what submissions
and grades point at, so a Fall 2026 grade stays attached to Fall 2026. **Offering activities** then
say which of the container's activities are live this term, which one carries credit
(`grading_role` of `graded` or `practice`), and when each opens.

The consequence worth internalizing: **"single vs. choice" is derived, not declared.** One `graded`
offering activity this term means the assignment is required; two or more means the student chooses.
There is no `selection_policy` column to drift out of sync. And flipping the whole cohort from the
interactive to the written path — the "the artifact broke, kick everyone to the questions" case — is
two `UPDATE`s on `offering_activities`; the library definition is never touched and grades already
earned are not disturbed.

**Why grading policy sits on the offering, not the activity:** whether the questions or the artifact
carries credit is a per-term delivery decision, not a property of the content. This is what lets Fall
2026 grade the interactive while Spring 2027 grades the written, from one library assignment, with no
forking.

## 2. The four layers

The tables group into four layers, catalogue down to analysis. Names below are exact; see the
migration for columns.

**Layer 1 — catalogue (term-free, reusable).** `courses`, `terms`, `assignment_kinds` (a lookup, so a
new kind is an `INSERT`), `assignments` (the container), `activities` (the content).

**Layer 2 — delivery (term-scoped).** `course_offerings` ("Physics 215, Fall 2026" — the anchor
everything term-scoped hangs from), `sections`, `students`, `enrollments`, `instructors`,
`staff_assignments`, `assignment_offerings`, `offering_activities`, `assignment_due_dates`.

**Layer 3 — work and grades (per enrollment).** `submissions` (one per enrollment per offering — the
choice, the lock, and the attempt's identity live together here), `submission_activities` (the actual
work, one row per activity engaged with, *including* practice ones), `grades`, `grade_events` (an
append-only audit).

**Layer 4 — analysis.** `analysis_reports`, one table replacing both `assignments.analysis_report` (a
JSONB column) and `interaction_analysis` (a table) — two differently-shaped stores for the same idea.

## 3. What this removes

The shape is chosen to delete whole categories of prior fault, not to add features.

- **The parallel worlds.** `public` kept written `assignments` and `interactions` as separate
  top-level tables and reconciled them with `lessons` + `lesson_completions`. Here modality is a
  property of an activity, so the parallel worlds and the reconciliation layer both disappear —
  `assignments` is the primary noun, not a bolted-on join.
- **The scattered grade.** A grade was spread across `scores`, `preflight_interaction_reports.score`,
  and `lesson_completions.points`, with nothing relating earned points to possible points. `grades`
  is exactly one row per (enrollment, offering), bounded by the offering's value, with the history in
  `grade_events`.
- **The re-attribution bug.** Because all student work hangs off the **enrollment**, not the student,
  moving someone between sections no longer silently rewrites their history.
- **The global-PK collision.** Slugs are unique *per course* (`UNIQUE (course_id, slug)`), so the
  July 2026 `preflight-02` collision cannot recur and the `phys-110-` id prefix workaround is dropped
  at migration.

## 4. Invariants enforced by the database

These are enforced structurally and covered by
[`../../supabase/admin/app_invariant_test.py`](../../supabase/admin/app_invariant_test.py) — they are
tested, not assumed. The point of listing them here is that they are load-bearing: application code
may rely on them holding.

- Exactly one grade per (enrollment, offering); a grade can never exceed the offering's points.
- Exactly one submission per (enrollment, offering).
- A chosen activity must be one actually offered in that offering (composite foreign key), and must be
  `graded` at the moment it is chosen (trigger).
- The chosen activity cannot silently change — the lock is driven by the offering's `switch_policy`
  as data, not compiled into a trigger body, so changing the rule is an `UPDATE`, not a migration.
- An instructor unlock must name who performed it, so unlocks are always attributable.
- A grade row that carries a 0–5 effort score derives its points by trigger: 3–5 → the offering's
  `points_possible`, 1–2 → one point, 0 or null → zero. **Full credit scales with the assignment;
  partial credit is flat.** *(Two amendments to what this line said originally: migration 014 moved
  the gate from the offering's `grading_mode` to the row, and migration 019 replaced the
  migration-013 "half" with a flat point — the same value at 2 points, which is why the difference
  went unnoticed until a 3-point assignment existed.)*
- There is **no foreign key from `app` into `public`**, so the two schemas are independent.

## 5. Frozen surfaces inside the model

Two fields are contract surfaces, not free columns, and must not be renamed once shipped:

- **`activities.slug`** is the frozen artifact target — deployed artifacts post to
  `interaction-submit.html#i=<slug>`, and existing `interactions.id` values migrate here verbatim.
  See [`../contracts/INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md).
- **`grades.diagnostic`** holds the frozen `schema: 1` payload (overall understanding, objectives,
  misconceptions, reading reflection, flags) and **never** contributes to points, exactly as the
  hidden diagnostics rule requires today.

`grades.question_scores` carries the per-question 3-state detail (`full` / `warn` / `zero`) forward
unchanged from `public`.
