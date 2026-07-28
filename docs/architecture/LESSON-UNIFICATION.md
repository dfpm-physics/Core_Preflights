# Lesson Unification — joining preflight assignments and lesson interactions

> **⚠️ SUPERSEDED — read [`PREP-V2-DATA-MODEL.md`](PREP-V2-DATA-MODEL.md) instead.**
>
> The lesson-unification model described here was **replaced** by the PREP v2 redesign in schema
> `app`, which reaches the same goal — one lesson carrying a written and/or interactive path,
> graded on one scale, rolled up in one report — through a different structure
> (`assignments` → `activities` → `assignment_offerings`). See also
> [`../decisions/PREP-V2-SCHEMA.md`](../decisions/PREP-V2-SCHEMA.md).
>
> **`supabase/migrations/021_lesson_finalize_and_extensions.sql` implements this doc and is
> deliberately never applied** (CORE.md §5). Do not apply it, and do not treat the open phases
> below as pending work — they describe a path not taken. This file is kept as a point-in-time
> record of the reasoning, several parts of which (the research design in §1, the modality
> comparison) carried forward into v2 unchanged.

*Design doc. Authored 2026-06-25 by Matthew Recker (via Claude). Status: **superseded**
2026-07-22 by the PREP v2 `app` schema — was "proposed, not yet built". Companion to
[`INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md),
[`INTERACTION-AGGREGATION.md`](../decisions/INTERACTION-AGGREGATION.md), and
[`CHANGELOG.md`](../../CHANGELOG.md).*

This is the plan for merging the two parallel worlds — **preflight assignments**
(`assignments` → `responses` → `scores`) and **lesson interactions**
(`interactions` → `preflight_interaction_reports`) — under a single **lesson** that can carry
one or both, decide which is required, grade both on the same 2-point effort scale, and roll both
up into one report. It is intentionally cautious: the artifact↔site contract stays **frozen**, and
every existing standalone assignment and interaction keeps working untouched.

---

## 1. Why — the research design

We believe the interactive (Claude artifact) path teaches better than the traditional written
preflight, but if students were simply offered a choice up front, most would never try the new
style. So the semester is sequenced to **force exposure to each, then open it up**:

1. **Preflight phase** — a run of lessons where *every* student does the written preflight.
2. **Interaction phase** — an equal run where *every* student does the interaction.
3. **Choice phase** — the rest of the semester, where each lesson offers both and the student picks.

This yields two research signals without any per-student randomization:

- **Performance by modality** — compare a student's *understanding* (0–5, diagnostic) on
  preflight-phase lessons vs. interaction-phase lessons.
- **Revealed preference** — in the choice phase, which path each student picks (and whether the
  students who pick interactions are the ones who did better on them).

Because the track is a property of the *lesson* (it applies to all students), we do **not** need a
per-student "assigned vs. actual" table. The phase sequence *is* the assignment.

---

## 2. Decisions taken (from planning Q&A, 2026-06-25)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Track is set per lesson**, applies to all students: `preflight` / `interaction` / `choice`. | New `lessons.completion_policy` enum. No per-student track table. |
| D2 | **A lesson may have one component or both.** `choice` requires both built; a required-single lesson need only build that one ("no sense setting up a type they aren't allowed to use"). | CHECK ties `completion_policy` to which component ids are present. |
| D3 | **A lesson is worth 2 points, effort-gated, on either path.** Correctness/understanding become **diagnostic**. | Preflight grading shifts from per-question correctness to effort — a genuine-but-wrong attempt still earns full credit, exactly like interactions today. |
| D4 | **First *finalized* path wins; the other can't overwrite the grade.** | `lesson_completions` row is created at finalization (Submit); `UNIQUE(student, lesson)` + a **path-lock** trigger enforce it. |
| D5 | **Purpose is research**, not just flexibility. | Keep both underlying submissions when a student does both; export path + effort + understanding per student per lesson. |
| D6 | **Assignment-only lessons roll up by question; interaction-only and choice lessons roll up by objective.** Choice merges both paths on a shared objective taxonomy. | `lessons.objectives` declares canonical keys; preflight questions map to them. |
| D7 | **Lessons have M-day and T-day due dates** (both components), since most instructors teach one day and sections are M/T. | `lessons.due_date_m` / `due_date_t`; the effective deadline for a student is chosen by their section's day. |
| D8 | **The *final* submission hard-stops at the due date — but launch + view never close.** No path can be finalized after the (section-day) deadline; students can always relaunch the artifact (study mode) and always view their own report. | Receiver/RLS gate *finalizing* writes, not reads or launch links. See §6. |
| D9 | **Save vs. Submit; both editable until an explicit Submit (the lock).** The **interaction writes nothing to the DB until Submit** — re-running the artifact just reloads the landing page with a fresh report; only Submit persists it, in one already-final write. The **preflight autosaves a DB draft** the student can revise; un-submitted preflight drafts **auto-promote to final** at the due date. | `responses.is_final` (preflight draft/final); interaction reports are written final-only. `lesson_completions.finalized_by` = `student`\|`auto`. **No tie is possible** — interactions never leave a draft. |

---

## 3. Current state (one-paragraph recap)

Today the two systems share *concepts* but nothing structural. Preflights are graded per-question
on correctness (`scores.question_scores`) and rolled up **by question** per instructor
(`assignments.analysis_report`, written by `/preflight-analyze`). Interactions are graded on
**effort 0–5 → points 0–2** (DB trigger, migration 013) and carry a rich per-student structured
assessment in `preflight_interaction_reports.report_data` (the frozen `schema: 1` blob: effort,
understanding, objectives, misconceptions, reading reflection, honor, flags), rolled up **by
objective** per section + whole-course (`interaction_analysis`, written by `/interaction-aggregate`).
There is **no `lesson` concept and no link** between an assignment and an interaction. The interaction
side is the more evolved data model — and it is the shape we extend the preflight to match.

---

## 4. The model

Two new tables. Everything else is additive wiring.

```
                         ┌──────────────────────────┐
                         │          lessons          │   one row per lesson (slug)
                         │  preflight_id ─┐  ┌─ interaction_id
                         │  completion_policy: preflight│interaction│choice
                         │  objectives[]  due dates  pts=2
                         └────────┬───────┘  └────────┬─┘
              (optional FK)       │                   │      (optional FK)
                    ┌─────────────▼──┐         ┌──────▼───────────┐
                    │  assignments   │         │  interactions    │   ← unchanged tables
                    │ responses/scores│        │ preflight_..reports│
                    └───────┬────────┘         └─────────┬────────┘
                            │   produces effort/understanding/report_data
                            └──────────────┬─────────────┘
                                           ▼
                         ┌──────────────────────────────────┐
                         │        lesson_completions         │  one row per (student, lesson)
                         │  path (preflight│interaction) LOCK │  ← the unified 2-pt grade
                         │  effort 0–5 → points 0–2  understanding 0–5
                         │  report_data (schema:1 snapshot)  │  ← single source for merged rollup
                         └──────────────────────────────────┘
```

- **`lessons`** — the grouping + policy + shared objectives + due dates. Links to at most one
  preflight and at most one interaction.
- **`lesson_completions`** — the **linchpin**. One grade per student per lesson, regardless of path.
  It is the unified credit record (the 2 points), the path-lock, the join for the merged rollup, and
  the research export.

The existing `assignments`, `responses`, `scores`, `interactions`,
`preflight_interaction_reports`, and `interaction_analysis` tables are **not modified** (a couple
get optional new columns — see §10). A standalone assignment/interaction with no owning lesson keeps
behaving exactly as today.

---

## 5. Completion policy & component rules

`lessons.completion_policy ∈ { 'preflight', 'interaction', 'choice' }`:

- `preflight` — the written preflight is the graded path. Only `preflight_id` need be set.
- `interaction` — the artifact is the graded path. Only `interaction_id` need be set.
- `choice` — **both** components must be built; the student picks; the first **Submit** locks the grade.

A CHECK keeps policy and components consistent:

```sql
CHECK (
  (completion_policy = 'preflight'   AND preflight_id   IS NOT NULL) OR
  (completion_policy = 'interaction' AND interaction_id IS NOT NULL) OR
  (completion_policy = 'choice'      AND preflight_id IS NOT NULL AND interaction_id IS NOT NULL)
)
```

(Under a single-path policy the *other* component may still be attached as optional practice; only
the named path grades. Most required-phase lessons will just build the one.)

---

## 6. Unified credit & the path-lock (the critical rule)

> **⚠ Amended 2026-07-16 — the lock model below is superseded. D4 and D9 no longer describe the
> system.** The rules as built (migration `021_lesson_finalize_and_extensions.sql`):
>
> | Was (D4/D9) | Is (2026-07-16) |
> |---|---|
> | First *finalized* path wins; Submit is the lock, symmetric across both paths | **The interaction is the only lock.** The written preflight stays **editable until the deadline** — its Submit marks the lesson complete but closes nothing |
> | Path immutable once set | **Directional:** `preflight → interaction` is allowed (the student's one-way switch; submitting the report *is* the switch). `interaction → preflight` is blocked |
> | *(unspecified)* | Choosing the interaction **supersedes** the written answers: the `responses` row is kept (D5/§13 did-both detection survives) but frozen and locked out of grading. Supersession is **derived** — non-grading iff a completion row has `path='interaction'` — so it cannot drift |
> | *(unspecified)* | **An instructor's extension overrides everything**, including the interaction lock. It only re-opens the door: the existing completion is never deleted, so a grant can never *lower* a grade |
> | Auto-promote is the `/preflight-analyze` due-date sweep | Unchanged — **plus** a DB-level lazy promotion for the window before the sweep runs (a late write finalizes the pre-deadline draft and discards the late edit) |
>
> Everything else in this section still holds: 2 points from effort, one completion row per
> (student, lesson) via `UNIQUE`, and the frozen artifact contract untouched. The student-facing
> consequences are specified in [`STUDENT-LESSON-VIEW.md`](STUDENT-LESSON-VIEW.md).

A lesson is worth **2 points**, derived from **effort** exactly as interactions are today
(effort 3–5 → 2, 1–2 → 1, 0/NULL → 0; migration 013). `lesson_completions` carries the grade.

**The lock (D4):** *"once a grade is defined by one path, the other type can't overwrite it."*

- The **path is committed at finalization (Submit)**, not at first save or at grading time. The
  `lesson_completions` row is created the moment a student finalizes one path; from then on the lesson
  is graded on that path.
- `UNIQUE (student_id, lesson_id)` guarantees one grade row, so the second path to finalize is simply
  rejected — it can't create a second row. A `BEFORE UPDATE` path-lock trigger also blocks ever
  switching an existing row's path.
- A student who does **both** in a choice lesson (e.g. Submits the interaction, then later submits a
  preflight): the first finalize wins; the second is refused *for grade*. Any underlying work that was
  persisted stays as research data.

### Submission lifecycle — Save vs. Submit (D7, D8, D9)

Both paths share one symmetric lifecycle: **work is saved as an editable draft; clicking Submit
finalizes it; finalization is the lock.** This removes the earlier asymmetry (one path one-shot, the
other editable) — fairness was the goal.

- **Editable until Submit — but persisted differently per path.** The **preflight autosaves a draft
  row** (`responses`, `is_final=false`) so a student can revise written work across sittings. The
  **interaction persists nothing until Submit**: each artifact run just loads the receiver
  with the report in the URL hash; re-running gives a fresh landing page, and nothing reaches the DB
  until the student clicks Submit. Both are freely re-doable before Submit; only the storage differs.
- **Submit (final) is the commit and the lock.** Submit finalizes one path: it creates the
  `lesson_completions` row (`finalized_by='student'`), and `UNIQUE(student, lesson)` + the path-lock
  trigger mean the other path can no longer be finalized. The interaction Submit is one-shot — it's
  the single write to `preflight_interaction_reports`, insert-once.
- **Effective deadline is per section day.** A student's cutoff is `due_date_m` for M-day sections,
  else `due_date_t` (the section's first letter). **Nothing can be finalized after the deadline**, and
  drafts can't be created or changed after it (a post-due study-mode run saves nothing).
- **Auto-promote at the due date — preflight drafts only.** Because the interaction never leaves a
  draft, the only thing to promote is a preflight whose draft was saved but not Submitted: the
  `/preflight-analyze` due-date run finalizes those by default (`finalized_by='auto'`), so a student
  who did the written work but forgot to click Submit isn't penalized. **There is no tie** — an
  un-submitted interaction left no row, so nothing can compete with a preflight draft at promotion.
  - *Trade-off:* an interaction the student ran but never Submitted leaves **no trace** and can't be
    auto-promoted (they'd get zero). The deliberate cost of "nothing in the DB until Submit" — so the
    landing page must make **Submit** prominent and explicit. Flagged in §17.
- **Launch + view never close.** The interaction ships a **study mode** (students ask questions and
  get probed on topics), so the artifact stays launchable after the deadline and students always read
  their own finalized report. Only *finalizing* writes are gated — reads and launch links are not.

> **Frozen-contract note:** the artifact has no concept of Submit — it just posts a report into the
> URL hash. So the receiver loads with the report **in memory** and **writes nothing** until
> the student clicks **Submit**; that click is the single, already-final DB write. Re-running the
> artifact just reloads the page with a fresh report. The artifact itself is unchanged, so the contract
> stays frozen.

---

## 7. How `lesson_completions` gets populated

**A `lesson_completions` row is created only at finalization**, by a DB trigger — so the **frozen
artifact receiver is never touched** (§9). The two paths finalize differently because they persist
differently (§6):

1. **Interaction final** — the Submit click is the *only* write to `preflight_interaction_reports`
   (insert-once; every row there is already final). An `AFTER INSERT` trigger creates the
   `lesson_completions` row with `path='interaction'`, copying `effort` + the `report_data` snapshot —
   **unless** the other path is already final (lock). Score derives via the shared effort→points
   trigger. There is no interaction draft row.

2. **Preflight final** — the preflight autosaves a draft in `responses`; finalizing flips its
   `is_final=true`. An `AFTER UPDATE` trigger then creates the `lesson_completions` row with
   `path='preflight'` (effort `NULL`, pending the skill) — unless locked. Then `/preflight-analyze`
   writes `effort`, `understanding`, and the `report_data` snapshot onto that row (alongside its usual
   per-question `scores.question_scores`). The skill's due-date run also performs the auto-promote:
   flip `is_final` on any preflight draft it's about to grade.

Anything not owned by a lesson creates no completion row — the backward-compatible path for legacy
standalone content.

---

## 8. Unified per-student assessment (the key to merging)

For choice lessons to roll up as one, **both paths must emit the same shape**: the frozen
`schema: 1` `report_data` (see [`INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md) §5) —
effort, `overall_understanding` (0–5), `objectives[]` (per-objective understanding), `reading_reflection`,
`misconceptions[]`, `flags`. The interaction already produces this. We make the preflight produce it
too (§10).

**Shared objective taxonomy.** `lessons.objectives` holds the canonical `[{key, label}]` for the
lesson. Both sides key to it:

- the interaction artifact emits `objectives[].key` from this list (already its convention), and
- `/preflight-analyze` maps each preflight question to an objective key and reports per-objective
  understanding under the same keys.

Then a choice-lesson rollup aggregates `understanding` by objective across both paths, with a
modality breakdown ("on *force superposition*: interaction takers 3.4/5, preflight takers 2.6/5").

**Where the snapshot lives.** `lesson_completions.report_data` is the **single merge source** for the
combined rollup — populated for the interaction path by the copy trigger (§7.1) and for the preflight
path by `/preflight-analyze` (§7.2). The interaction's own `preflight_interaction_reports.report_data`
stays the system of record for interaction-only views; `lesson_completions.report_data` is the
unified read surface so the rollup never has to UNION two differently-shaped tables.

---

## 9. Frozen contract preserved

No change to [`INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md): the artifact still posts
to `site/student/interaction-submit.html#t=interaction&i=<slug>&r=…&d=…`, and `<slug>` is still an `interactions.id`.
The lesson *points at* that interaction by id; the completion row is created by a **DB trigger** on
`preflight_interaction_reports`, so the receiver page and every deployed artifact are unaffected.
This is the safest possible integration point — the part we most need not to break.

The Submit-only + due-cutoff rules (D8/D9) are **receiver-side policy**, not contract changes: the
artifact still *sends* the exact same `#t/#i/#r/#d` payload. The receiver just **loads** it and writes
nothing until the student clicks **Submit**; that write is accepted only before the section-day
deadline and only while no final exists on either path (insert-once). Because the artifact is
unchanged, study mode (relaunch after due) keeps working; a post-due or post-final submit simply isn't
saved. So the frozen-contract guarantee holds.

---

## 10. Schema sketch (migration 016 + skill changes)

House style: idempotent, `IF NOT EXISTS`, `DO $$` for constraints, table-prefixed trigger functions,
run in the Supabase SQL Editor. Numbers continue from **015** (next is **016**).

```sql
-- 016_lessons.sql  (purely additive: two new tables + triggers + RLS)

CREATE TABLE IF NOT EXISTS lessons (
  id               TEXT PRIMARY KEY,                       -- slug, e.g. 'lesson-02-charge'
  course_id        TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  lesson_number    INT,                                    -- ordering / phase grouping
  preflight_id     TEXT REFERENCES assignments(id)   ON DELETE SET NULL,
  interaction_id   TEXT REFERENCES interactions(id)  ON DELETE SET NULL,
  completion_policy TEXT NOT NULL DEFAULT 'choice'
                     CHECK (completion_policy IN ('preflight','interaction','choice')),
  objectives       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{key,label}] shared taxonomy
  points           SMALLINT NOT NULL DEFAULT 2,
  due_date_m       TIMESTAMPTZ,                            -- M-day sections (effective deadline
  due_date_t       TIMESTAMPTZ,                            --   picked by the student's section day)
  is_published     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lessons_policy_components CHECK (
    (completion_policy = 'preflight'   AND preflight_id   IS NOT NULL) OR
    (completion_policy = 'interaction' AND interaction_id IS NOT NULL) OR
    (completion_policy = 'choice'      AND preflight_id IS NOT NULL AND interaction_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS lesson_completions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     TEXT  NOT NULL REFERENCES lessons(id)        ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  path          TEXT  NOT NULL CHECK (path IN ('preflight','interaction')),
  effort        SMALLINT CHECK (effort IS NULL OR effort BETWEEN 0 AND 5),
  points        SMALLINT CHECK (points IS NULL OR points BETWEEN 0 AND 2),  -- trigger-derived
  understanding SMALLINT CHECK (understanding IS NULL OR understanding BETWEEN 0 AND 5),
  report_data   JSONB,                                       -- schema:1 snapshot (<=32 KB)
  finalized_by  TEXT CHECK (finalized_by IN ('student','auto')),  -- how the submission was committed (D9)
  is_finalized  BOOLEAN NOT NULL DEFAULT FALSE,               -- instructor grade-finalize (cf. scores)
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, lesson_id)                             -- one grade per student per lesson
);

-- points := f(effort), reusing the interaction grade curve (migration 013)
CREATE OR REPLACE FUNCTION lc_score_from_effort() RETURNS TRIGGER AS $$
BEGIN
  NEW.points := CASE WHEN NEW.effort >= 3 THEN 2
                     WHEN NEW.effort >= 1 THEN 1
                     ELSE 0 END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- path is immutable once set (the lock): block any path switch on update
CREATE OR REPLACE FUNCTION lc_lock_path() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.path <> OLD.path THEN
    RAISE EXCEPTION 'lesson_completions.path is locked (% -> %) for student % lesson %',
      OLD.path, NEW.path, OLD.student_id, OLD.lesson_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- + completion-creating triggers (first-finalized-path-wins), per §7:
--     · responses: AFTER UPDATE, when is_final flips true (preflight finalize)
--     · preflight_interaction_reports: AFTER INSERT (interaction Submit is insert-once, already final)
-- + receiver/RLS guards (D8/D9): the interaction Submit writes only before the student's section-day
--   deadline (due_date_m for M-day sections, else due_date_t) and only while no final exists;
--   preflight finalize is likewise blocked after the deadline. Reads + launch links are NOT gated.
```

**Small additive columns elsewhere** (not rewrites):

- `assignments.questions[].objective_key` — map each question to a `lessons.objectives` key
  (JSONB convention, no migration needed).
- `assignments.questions[].role = "reading_reflection"` — mark which question is the reading
  reflection so the skill can apply the meaningful-gate (JSONB convention).
- `responses.is_final` BOOLEAN DEFAULT FALSE — the preflight draft/final flag (D9); the
  completion-creating trigger fires when it flips true. `preflight_interaction_reports` needs **no**
  such flag: every row is written by Submit and is already final, so its completion trigger is `AFTER
  INSERT`. Legacy standalone responses just stay drafts forever with no owning lesson, so nothing
  happens.

**RLS** mirrors the existing pattern: students read/write only their own `lesson_completions`
(via `students.auth_user_id = auth.uid()`); instructors read their sections; directors/admins read
all. `lessons` reads like `interactions` (public sees published; managers write). Writers for the
grade columns are the triggers + the scoped `claude_code_recker` role used by the skill.

---

## 11. `/preflight-analyze` extension

Keep everything it does today (per-question `scores.question_scores` + by-question
`analysis_report`). **Add**: for any assignment that is a lesson's `preflight_id`, also emit a
`schema: 1` `report_data` per student and write `effort`, `understanding`, and `report_data` onto the
student's `lesson_completions` row (path `preflight`):

- **effort (graded, engagement not correctness)** — derived from genuine attempt across questions
  (the skill already classifies blank/gibberish/one-word as `zero`), gated by the reading-reflection
  question's `meaningful` flag (≤2 if not meaningful), mapped to 0–5. A wrong-but-engaged preflight
  earns full effort, matching the contract.
- **understanding (diagnostic, 0–5)** — from correctness + reasoning quality, reported overall and
  per objective using the question→objective map.
- **reading_reflection, misconceptions, flags** — same fields as the contract, derived from the
  responses; misconceptions reuse the per-course taxonomy already in `CLAUDE.md`.

This is the work that makes the preflight and the interaction *commensurable*.

> **Roadmap requirement (confirmed):** every lesson's preflight and interaction use the **identical
> reading-reflection question**. Mark it on the preflight side with `role:"reading_reflection"` on the
> question object (label is free; the marker is what matters). Because the *same* prompt appears in
> both modalities, the `reading_reflection` field is directly comparable across paths and the
> effort meaningful-gate is applied the same way regardless of which path a student took. The lesson
> creation tool (Phase 4) must make this question mandatory in both components.

---

## 12. Rollup logic

| Lesson policy | Rollup | Source |
|---|---|---|
| `preflight` (only) | **By question** (today's `analysis_report` per instructor) | `scores` + `assignments.analysis_report` |
| `interaction` (only) | **By objective**, per section + whole-course (today's behavior) | `interaction_analysis` over `preflight_interaction_reports.report_data` |
| `choice` | **By objective, merged across both paths**, with a per-objective *modality breakdown* + a path-split count ("18 chose interaction, 7 preflight") | `lesson_completions.report_data` (single merge surface, §8) |

**Two skills, split by rollup type — not one monolith** (per Matthew's maintainability preference).
The per-student *extraction* already lives in separate skills (`/preflight-analyze` derives the
preflight `report_data`; the artifact / `/interaction-backfill` supply the interaction's), so changing
one never touches the other. For the *cohort* layer, `/preflight-analyze` owns the **by-question**
rollup (preflight-only lessons) and `/interaction-aggregate` owns the **by-objective** rollup, reading
the unified `lesson_completions.report_data` so it serves interaction-only **and** choice lessons. A
choice lesson has both submission types, so its merge can't be routed by type — it needs that one
objective-aggregator. (Renaming it `/lesson-aggregate` would be more accurate, but is cosmetic and can
wait.) The numeric bars stay computed live in the browser as today; only the AI prose layer is stored.

The exact panel set, the shape + length + style of every AI-written field, and which skill owns which
field for which lesson type are the **output contract** in [`ROLLUP-AGREEMENT.md`](../decisions/ROLLUP-AGREEMENT.md)
— the doc to read before editing either skill or the rollup UI. Its core rule: one rollup, one style,
with the breakdown axis (objective vs. question) as the *only* permitted divergence by lesson type.

---

## 13. Research data & export

Everything needed is in `lesson_completions` joined to `lessons` and `students`:

- **Performance by modality** — `understanding` grouped by the lesson's phase/policy and by `path`.
- **Revealed preference** — in choice lessons, the distribution of `path` (overall and per student).
- **Did-both detection** — presence of both a `responses` row and a
  `preflight_interaction_reports` row for the same (student, lesson) even though only one scored.

A CSV/JSON export (one row per student per lesson: course, lesson, phase, policy, path, effort,
points, understanding, did_both, completed_at) feeds external analysis. This lives in the export tab
or a small admin script using the scoped DB role.

---

## 14. UI changes (phased — see §15)

- **Faculty — lesson creation tool** (the biggest new surface). One screen to: create the lesson,
  build/attach the preflight (questions; assignment authoring still lives on legacy `admin.html`
  today, so this either embeds or links it), set/attach the interaction (artifact URL — reuses the
  prefill-link flow), choose `completion_policy`, define `objectives`, and set due dates. Likely
  extends `site/faculty/interactions.html` or a new `site/faculty/lessons.html`.
- **Faculty — rollup** — `site/faculty/report.html` gains the merged by-objective view with the
  modality breakdown for choice lessons; by-question view for preflight-only.
- **Student — lesson view** — a lesson-centric list/detail showing the required path or the choice,
  the lock state ("graded via interaction — preflight no longer counts"), and the single 2-point
  grade. Can reuse the existing assignment-detail and interaction-launch components beneath a lesson
  wrapper.

---

## 15. Phased implementation plan

Each phase is independently shippable and leaves the system working.

0. **Confirm this doc** + resolve §16 open questions. *(no code)* — **done.**
1. **Schema** — migration 016: `lessons` + `lesson_completions` + the grade/lock/finalize triggers +
   the draft `is_final` flags + RLS. Additive, reversible, nothing else changes. Verify in browser
   against Supabase per the no-Node workflow. — **✅ built 2026-06-26** (`supabase/migrations/016_lessons.sql`),
   scoped to the additive tables + the grade(`lc_score_from_effort`)/lock(`lc_lock_path`) triggers + RLS;
   the row-*creating* finalize triggers and the `responses.is_final` draft flag are deferred to Phase 2.
2. **Finalize triggers + guards** — create the `lesson_completions` row when a `responses` /
   `preflight_interaction_reports` draft is marked final; add the receiver/RLS draft-write +
   section-day due-cutoff guards (D8/D9). Contract untouched. — **⏳ drafted 2026-07-16,
   NOT APPLIED** (`supabase/migrations/021_lesson_finalize_and_extensions.sql`). Adds
   `responses.is_final`, both mint triggers, the extension-aware cutoff + lazy promotion, the
   directional path lock (§6 amendment), `extensions.lesson_id`, and an **RLS repair** — the
   `responses`/`extensions` policies predate student auth (migration 004) and are wide open; see
   the migration header. Paired client changes are in `student/assignments.html` +
   `student/interaction-submit.html`. **Before applying:** provision student accounts and confirm
   no NULL `students.auth_user_id`, and check `count(*) FROM responses` for the `is_final`
   backfill. Untested — needs a browser pass.
3. **`/preflight-analyze` extension** — emit `report_data` + write the preflight `lesson_completions`
   row; add the question→objective and reading-reflection-role conventions; perform the due-date
   auto-promote of leftover drafts.
4. **Faculty lesson creation tool** — author lessons, attach/build both components, set policy +
   objectives + due dates. — **✅ built 2026-06-26** (`site/faculty/lessons.html` + `site/js/faculty-lessons.js`,
   director-gated **Lessons** nav entry). Originally new-content-only. **Updated 2026-07-15:** each
   component now has a `None · Use existing · Create new` source toggle, so a lesson can **reference an
   existing** assignment/interaction (see Phase 7) or be authored inline; a lesson may carry one or both
   components, and the policy control enables only the modes whose component is attached. The inline
   preflight builder pins **Q1** (reading-time diagnostic, 0 pts, names hidden from students) and **Q2**
   (`role:"reading_reflection"`, the meaningful-gate), matching the live Fall preflights; the per-question
   objective map is unchanged.
5. **Student lesson view + Save/Submit** — draft autosave, explicit Submit, required/choice
   display, post-due lock UX, unified 2-pt grade. — **📐 designed 2026-07-16:
   [`STUDENT-LESSON-VIEW.md`](STUDENT-LESSON-VIEW.md)** (8-state machine, choice modal, the three
   switch warnings, study-mode copy per state, dashboard rework). Not built. Blocked on Phase 2
   being applied — without `lesson_completions` rows every lesson renders as "not started".
6. **Unified rollup + research export** — merged by-objective rollup for choice; extend
   `/interaction-aggregate`; ship the export.
7. **Partially un-deferred 2026-07-15** — the faculty Lessons tool can now **reference existing**
   standalone assignments/interactions into a lesson (a `None · Use existing · Create new` source
   toggle per component; the lesson points at the chosen row by id and never mutates its content or
   publish state). A component is lesson-owned iff its id equals the lesson id, and publish mirroring
   only touches owned components. This lets `lessons` be populated from the pre-built Fall preflights
   and standalone interactions without duplicating them. What remains dropped: any *bulk/automatic*
   retrofit — lessons are still formed only by explicit director action, one at a time.

---

## 16. Open questions

### Resolved (2026-06-25)

- **Due dates → M/T split** (D7). Every lesson carries `due_date_m` + `due_date_t`; a student's
  effective deadline is picked by their section day. *Caveat:* a few instructors teach both M and T —
  the dashboard's single active-lesson spotlight may read ambiguously for them (see §17).
- **Lifecycle → editable until an explicit Submit; nothing in the DB for interactions until Submit**
  (D9). The preflight autosaves a draft; the interaction persists only on Submit (re-running just
  reloads the landing page). **No tie is possible.** Auto-promote applies to preflight drafts only.
- **Hard post-due cutoff on finalizing, launch/view always open** (D8). Un-submitted *preflight* drafts
  **auto-promote** at the due date (`finalized_by='auto'`); a never-Submitted interaction leaves
  nothing to promote (see §17).
- **Reading reflection → identical question in both modalities**, marked `role:"reading_reflection"`;
  enforced by the lesson creation tool. Documented as a roadmap requirement in §11.
- **Effort from a written preflight → engagement-based** (genuine attempt, reflection-gated), not
  correctness (D3).
- **Aggregator → two skills, split by rollup type** (§12). Extraction already lives in separate skills;
  `/preflight-analyze` owns the by-question rollup, `/interaction-aggregate` owns the by-objective
  rollup over the unified `lesson_completions` (serving interaction-only *and* choice). Modular, and the
  choice merge still has one clean owner.
- **Legacy adoption → new content only** (confirmed). Existing standalone content is not retrofitted
  (Phase 7 dropped); it keeps working untouched.

### Still open

Nothing blocks Phase 1. The remaining items are build-time details, not architecture: the exact RLS
predicates for `lesson_completions`, whether to rename `/interaction-aggregate` → `/lesson-aggregate`,
and the M-and-T-instructor dashboard presentation (§17).

---

## 17. Risks & non-goals

- **Grading-philosophy shift for preflights** (D3) is the change most visible to students — surface it
  clearly in the student lesson view and in any syllabus language.
- **Two write-paths into one grade row** (§7) is the trickiest code; the path-lock + first-*finalize*
  creation (interaction `AFTER INSERT`, preflight `AFTER UPDATE`), plus the preflight auto-promote,
  must be covered by seed-data tests before any real lesson uses `choice`.
- **A never-Submitted interaction is lost** (D9): since nothing persists until Submit, a student who
  runs the artifact but never clicks Submit gets no row and can't be auto-promoted. Mitigation: a
  prominent, explicit **Submit** call-to-action on the receiver, and a "not yet submitted"
  state surfaced in the student lesson view.
- **Section-day deadline + study mode** (D8) adds branching: the cutoff is per-student (M vs. T), and
  the artifact must stay launchable while its submit is refused post-due. Get the "reject the write,
  allow the read/launch" split right, or study mode breaks or late grades leak in.
- **M-and-T instructors on the dashboard** — the active-lesson spotlight assumes one day; an instructor
  teaching both M and T sections may see an ambiguous "today" (one lesson can be past for M but
  upcoming for T). Decide whether to split their view by day or pick the nearer deadline. *(UI, not a
  data problem — flagged for Phase 1 dashboard work.)*
- **Non-goal:** changing the frozen data contract, the artifact, or the submission
  endpoint (`site/student/interaction-submit.html` since 2026-07-16). **Non-goal:** removing standalone assignments/interactions — they remain valid.
- **Free-tier pause** and **no-Node** constraints are unchanged; verify everything in a browser
  against Supabase.
