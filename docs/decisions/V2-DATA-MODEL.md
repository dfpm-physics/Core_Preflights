# PREP v2 data model — one course holds every kind of work

**Status:** accepted by the course director, 2026-11-04, after two adversarial reviews. All six decisions
and the three marked defaults stand as written, with the note under decision 2. Migrations are written and
proven on staging first. Nothing here has run on production.

*Authored 2026-11-04 for the course director (via Claude). Built on [`V2-SCOPE.md`](V2-SCOPE.md) and
[`GRADE-RULES.md`](GRADE-RULES.md), which are closed and are not reopened here. Extends
[`PREP-V2-SCHEMA.md`](PREP-V2-SCHEMA.md) and [`PREP-V2-AUTHORIZATION.md`](PREP-V2-AUTHORIZATION.md).*

> **What this doc is for.** It settles the table, column and function shapes for step 1, so instructors
> enter work once and later features use the same fields. It also shows why the current site keeps
> working on the migrated database, and how to prove that. Read it before writing any `app` migration
> numbered `026` or higher.

---

## 0. In one minute

**What you are approving.** Fourteen add-only migrations (`026` to `039`), one backfill that writes one
table, and small guards in old staff pages and three scripts. Fall grades do not move. Students see no change
before 21 Dec.

**What was decided.** The six questions below. The course director accepted each recommendation on
2026-11-04, and the design uses them. **Note on decision 2, in the course director's words: "There will only
be one course but there might be multiple sections of the course."** So one active offering of a course holds
all of its sections, and the design must never assume one section per offering.

**What is already proven, on staging.** The deadline rule matches the shipped site on every row tried. The
boundary arithmetic comes out right. The bonus check, the one-active-offering rule, the path triggers and the fingerprint's
tests behave as written, in trial SQL that was rolled back. Live suites run on staging.

**What is not proven.** Nobody has run this on a copy of production. Section 25 says what stands in for that.

**One later ruling.** A past-due draft that holds a score counts as work received, not as missing (section 7). It waits for review and stays out of the total until a person acts. The course director confirmed this on 2026-11-04. It lives in one place, the `draft_score` expression of `039`.

### Decisions for the course director

| # | Question | Recommendation and default | Why, in one line |
|---|---|---|---|
| 1 | In-person and Gradescope work has no submission. When does a blank become **Missing**? | **An instructor closes the column for a section.** Before that, a blank is awaiting entry and leaves the total. After it, a blank counts 0, **unless the cadet holds an active extension that has not passed: then it waits until that date.** A revoked or expired extension changes nothing. Nothing closes by itself: approving a Prog or Final lists every open column. **Changed 2026-11-05 (course director): publishing a no-submission column for a section also closes it for that section, in the same transaction; that is the one exception. Reopening on unpublish is limited to what the publish closed (section 24, migration 067).** | A date alone would zero every blank the moment an exam ends, before anyone enters scores. **Reason for the change: a class view needs a fair comparison, and a cadet with 10 of 10 on one item and nine published items still blank must not show 100%; submitted work already gives 10 of 100, and in-person and Gradescope blanks stayed out of the total until a person closed the column.** |
| 2 | What may be active on the live database before step 2? | **One active offering per course, enforced. Spring stays inactive, with no rosters, until after 21 Dec.** Stage C proves roster import on staging only. If a training offering is a second active row for its course, it goes inactive before `028`. **Cost of that:** it cannot publish new lessons until step 2, and it cannot be active again beside another offering of its course. Its existing lessons stay. | A Spring enrollment changes a cadet's course list, and three tools stop on two active offerings of one course. |
| 3 | Scores have two decimals. Keep that? | **Keep it. Entry refuses a third decimal, and an import with one is refused whole, before anything changes.** Alternative: widen at step 2. | The column rounds silently, and widening means rewriting `grades` during Fall. |
| 4 | Which attempt counts, and when does online work join the total? | **Best attempt. The entry page asks for a limit and offers 5. Each answer gets right or wrong at once, and the item shows its score so far. The item joins the total at that student's deadline.** | A total that moves with every answer would swing wildly while a student works. |
| 5 | What counts in the running total, and what does a student see? | **Only released scores and Missing count. A released-later score is shown to staff as a count beside the total, with no second total. Students see points and percent, with no letter until a report is approved.** | Student and instructor totals must agree, and a mid-term letter reads as a promise. |
| 6 | A cadet changes section. Which deadline applies to work already scheduled? | **The new section's, unless that date has already passed and the old section's is later. Then the old date stands, recorded as a logged extension.** Starts at step 2. | A cadet should never be late for a deadline they never had. |

### Read-only checks on production, before 13 Nov

The course director runs one read-only script, from the live clone, over the read role. It changes nothing and prints only counts and codes. It is kept with the private review notes. Agents do not read production, so these answers can only come from this run.

| Check | What the answer settles |
|---|---|
| A. Postgres version | The deadline function's date test needs 16 or later (section 8). |
| B. Possible points on grades against the item | Rows to resolve before the one total rule (section 9). |
| C. Finalized grades with no points | How many read as ungraded in the new total (section 7). |
| D. Courses with more than one active offering | **Decides how `028` is written, and decision 2.** |
| E. Unpublished items with submissions | Whether the job guard could hide work (section 22.2). |
| F. Path types in use | Whether the backfill can run (section 19). |
| G. Stored day deadlines not in full timestamp form | Whether the deadline proof can match the site (section 8). |
| H. Two enrollments in one offering | The size of that exception list (section 14). |
| I. Published items on inactive offerings | What the publishing rule will meet (section 1). |
| J. Active enrollments on inactive offerings | What students' course lists hold today (section 22.1). |

Marked defaults, each noted where it shapes the design:

- **[D1] Cengage and WebAssign end before Spring 2027.** Keys and attempts therefore land in step 1, and
  homework does not depend on any import path.
- **[D2] All students get the same numbers.** Keys carry a `variant_key` that is empty today, so per-student
  values can be added later with no change to the key table.
- **[D3] A system admin counts as a Director** for excused, scale, width and ties, because
  `director_offerings()` already includes one. `GRADE-RULES.md` says "only the Course Director", so this is a
  flagged reading of that rule. Say so if it should be narrower.

---

## 1. The shape, and what lands when

**The whole data model lands at step 1. Students can reach none of it until step 2.**

| | Step 1, about 1 Dec | Step 2, after 21 Dec and before 6 Jan |
|---|---|---|
| **Schema** | New tables and new columns, with defaults that reproduce today. Functions exist and are tested, with staff-page functions granted and student functions not. | One reviewed batch of access and integrity work (section 24). |
| **Data** | Backfill of path columns. New items, all unpublished. Spring offerings, all inactive. | Fall goes inactive and Spring goes active, in one transaction. Spring rosters. New items publish. Fall enrollments complete. |
| **Pages** | New staff pages. Small guards in four old staff pages and three scripts (section 22). No student page changes. | Student schedule and grades. Old pages read the one deadline rule and the one total rule. Guards come out. |

**Six database rules hold the step 1 line. The first five are removed at step 2.**

*Migration `079_drop_step1_rules.sql` (2026-11-05, branch `v2-step2-rollin`, not applied anywhere) removes the first five; the list below is the state before it.*

| Rule | What it refuses |
|---|---|
| `assignment_offerings_new_stay_unpublished` | Publishing an item entered on a new page. |
| `assignment_offerings_publish_needs_active` | A change to `is_published = true` on an offering whose course offering is inactive. Rows already published are not touched. This catches old tools, which do not set the marker. |
| `grades_new_items_stay_unfinalized` | A finalized grade on an item entered on a new page. So new items carry no released grades before step 2. |
| `assignment_offerings_marker_one_way` | Clearing `entered_on_new_page` once it is set. Without this, one update would turn the other rules off for that item. |
| `assignment_offerings_new_paths_stay_unpublished`, with `offering_activities_new_paths_stay_unpublished` | Publishing an item that has a path only a new page produces (`online_questions`, `in_person`, `elsewhere`), and adding such a path to a published item. They work from the path, so an item entered by an old tool is held too. A seed or trial that must publish such an item switches the trigger off inside its own transaction. |
| `course_offerings_one_active` | A second active offering of one course. **This one stays.** |

Three rules run through everything below.

- **Add, do not replace.** Every new column has a default or a fill trigger, so writers that have never heard
  of it still succeed. Frozen URLs and the artifact wire format do not change.
- **No code branches on kind.** Kind is a label and a report group. Code branches on delivery and grading.
  Today kind is read only at `site/js/schema.js:255` and written only at `site/js/faculty-lessons.js:647`, and
  neither takes a decision on it.
- **One calculation.** One deadline rule and one total rule, both in the database.

---

## 2. Kind

**Decision: seed all seven in the existing table. Kind carries no behaviour.**

| Table | Change |
|---|---|
| `assignment_kinds` | Seed `homework`, `case_study`, `group_project`, `quiz`, `exam`, `lab` beside `preflight`. Add `report_code text`, used as the report column heading and group. Add `default_delivery text`, `default_grading text`, used only to prefill the entry form. |

Storing the prefill as data means the entry page does not need a map from kind to behaviour, which would be a
branch on kind by another name.

**RLS.** Unchanged: everyone signed in reads, admins write.

**Current site.** A new row in a lookup table is inert. Every existing assignment keeps `preflight`. **Proof:**
the current-site pass in section 25, with one item of each kind present.

---

## 3. Delivery and grading

**Decision: both live on the path, not on the item.** A preflight with a written path and a tutor path has two
deliveries and two grading methods under one grade, so an item-level column could not hold it.

| Table | Column | Values |
|---|---|---|
| `offering_activities` | `delivery text` | `online_questions`, `typed_response`, `interactive_tutor`, `in_person`, `elsewhere` |
| | `grading text` | `auto_checked`, `human_graded`, `effort`, `hand_entered`, `imported` |
| | `warn_earns_full boolean` | Whether a yellow mark earns full credit |
| `activities` | `modality` check gains `questions` and `external` | `written` and `interactive` keep their meaning |

**Allowed combinations:**

| Modality | Delivery | Grading |
|---|---|---|
| `questions` | `online_questions` | `auto_checked`, or `human_graded` when the page holds prose |
| `written` | `typed_response` | `human_graded` |
| `interactive` | `interactive_tutor` | `effort` |
| `external` | `in_person` or `elsewhere` | `hand_entered` or `imported` |

Delivery and grading are checked by a constraint. Modality against delivery crosses two tables, so the trigger
below checks it.

`warn_earns_full` may be true only with `human_graded` or, from migration 077, `ai_drafted` (typed response; the overnight job drafts the mark, a person finalizes it, and 078 holds that line in the database). **New items write false, so homework does not inherit
"warn still earns full credit".** Backfilled preflights write true. At step 2 the one line that applies the
rule, `site/js/faculty-grade.js:250`, reads this column instead of assuming it.

**Every item has at least one path.** An in-person exam has one `activities` row, modality `external`, with no
questions in its content. That keeps one join for every item, and `UNIQUE(assignment_id, modality)` stays as it
is. The path gets its own generated slug that nothing outside PREP ever sees.

**The columns are nullable at step 1, with a fill trigger: `BEFORE INSERT OR UPDATE OF delivery, grading, activity_id`.** Old
writers (the lesson editor, the term builders) know nothing of these columns. The trigger is pinned
`SECURITY DEFINER`, because it reads `activities`.

- When `delivery` is null it fills from the modality: `written` gives `typed_response`, `human_graded`, `warn_earns_full` true;
  `interactive` gives `interactive_tutor`, `effort`, false.
- **Any other modality with a null `delivery` raises an error.** Only a new page writes those, and it must say
  what it means.
- It validates the combination in the table above, on every write.
- It refuses a path beside an `auto_checked` path, in either order (section 12).
- Step 2 adds `NOT NULL` after the backfill.

**`grading_mode` lives on the offering, and defaults to `effort` with no check.** `displayPoints` at
`site/js/schema.js:980` reads it, so an item left on the default would show a typed-in score as 0. So a second trigger,
`offering_activities_sync_grading_mode`, runs `AFTER INSERT OR DELETE OR UPDATE OF grading_role, grading`, pinned
`SECURITY DEFINER`. It acts only on an item with `entered_on_new_page`: `effort` if every graded path is `effort`, `points` if
any is not, and no change if none is graded. The column default does not change, so old writers behave as they do today. At
step 2 the marker check comes off, and that migration first lists any item whose stored `grading_mode` disagrees with the rule,
for a person to settle.

**Trial, rolled back.** Tutor path only gives `effort`. Adding a written path gives `points`. Moving it to practice, with no other
change, gives `effort`. Back to graded gives `points`. Deleting it gives `effort`. Deleting the whole item cascades through the
trigger with no error.

**RLS.** The existing `offering_activities` policies cover the new columns. Nothing in them is sensitive.

**Current site.** Old pages find paths with `find(modality === 'written')` and `find(modality === 'interactive')`
(`site/js/schema.js:274-275`, `site/js/faculty-health.js:325-326`, `site/js/faculty-grade.js:952`), so an unknown
modality is simply not found. `questionsOf` returns an empty list when content has none (`site/js/schema.js:441`).
A single graded path of any other modality reads as policy `preflight` (`site/js/schema.js:300`). Student pages
never receive an unpublished item, and the only staff page that acts on the label is the old editor
(`site/js/faculty-lessons.js:296`), which section 22 guards. **Proof:** section 25.

---

## 4. Parts versus alternatives

**Decision: alternatives stay what they are today, and required parts are separate items.**

| Need | Model |
|---|---|
| **Alternatives**, do one of these | Two or more graded `offering_activities` rows on one offering. Unchanged. |
| **Required parts**, do all of these | Separate `assignment_offerings`, each with its own column, points, deadline and grade. Joined for display by `part_sets`. |

| New | Shape |
|---|---|
| `part_sets` | `id`, `course_offering_id`, `title`, `position` |
| `assignment_offerings.part_set_id` | Nullable. Composite foreign key, so a part cannot join a set in another term. |

**Why not parts inside one grade.** `grades` is unique on enrollment and offering. Parts inside one row would need
a second aggregator, and a second place where a total is computed. A lab's prelab online and its report in
Gradescope also have different deliveries, dates and instructors. A report that wants one "Labs" column sums by
kind, in the total rule's own rows.

**RLS.** `part_sets`: staff of the offering read; directors write. **Current site:** a new nullable column that no
page selects. `OFFERING_SELECT` names its columns (`site/js/schema.js:24-30`).

---

## 5. Offering policy

**Decision: new columns on `assignment_offerings`. Defaults reproduce today, and the new entry page sets each one
explicitly.**

| Column | Type and default | Meaning |
|---|---|---|
| `late_allowed` | `boolean NOT NULL DEFAULT false` | **The default keeps current preflights refusing late work.** The new entry page starts this checked, as `GRADE-RULES.md` says. |
| `is_bonus` | `boolean NOT NULL DEFAULT false` | Adds to earned only. |
| `allow_over_max` | `boolean NOT NULL DEFAULT false` | An ordinary item, such as an exam with an extra-credit question, may score above its maximum. |
| `prog_included` | `boolean NOT NULL DEFAULT false` | Counts at Prog. An instructor sets it. |
| `grades_release_at` | `timestamptz NULL` | Null means a grade shows when it is finalized. |
| `attempt_limit` | `smallint NULL CHECK (>= 1)` | Per question, auto-checked paths only. Null means no limit. |
| `attempt_rule` | `text NOT NULL DEFAULT 'best'` | `best`, `last`, `first`. See decision 4. |
| `is_group_work` | `boolean NOT NULL DEFAULT false` | Section 18. |
| `part_set_id` | `uuid NULL` | Section 4. |
| `entered_on_new_page` | `boolean NOT NULL DEFAULT false` | Says which page owns a row. Section 22. Temporary: removed at step 2. |

**Release time for content is the existing `opens_at`.** Null selects the rolling seven days. `app.release_at`
applies the same rule, floored to the start of the day in America/Denver.

**The last late date is the existing `terms.ends_on`,** which is the last class day. `app.late_close_at` returns the
end of that day in America/Denver. The commit function and the Stage E answer function refuse work after it, and
cells return `late_closed` so pages stop offering it.

**Course offerings.** `is_active` changes its default to `false`, and `course_offerings_one_active` is a partial unique
index on `course_id WHERE is_active`. `scripts/app/create_course_offering.py:169-170` writes `true` today, and takes
an explicit flag instead. Two test files rely on the old default (section 24). **`is_active` steers tools, not people:** it decides what jobs and the Health page look at. It
does not hide a course from anyone (section 22.1).

**Also added:** `assignments.origin_assignment_id` (nullable, lineage for rollover, as
[`PER-OFFERING-CONTENT-ISOLATION.md`](PER-OFFERING-CONTENT-ISOLATION.md) planned). Rollover still makes new assignment
and activity rows, with new slugs.

**Courses with no M and T days.** Nothing here needs them. A section with `meeting_days = '{}'` and an offering with
`due_by_day = '{}'` take `due_at`. **No lesson number is required:** `position` may stay null for a new item, and new
pages order by date. `CORE.md` §2 treats an empty `due_by_day` as a defect for courses with two tracks. That stays
true for them, and its detection query needs scoping to multi-track courses when step 2 ships.

**Prog flag write path.** `ao_write` is director-gated, and the instructor sets this flag. So
`app.set_prog_flag(p_assignment_offering, p_value)` is a pinned `SECURITY DEFINER` function that checks the caller
teaches or directs that offering, sets that one column, and logs it. **It is offering-wide by design:** an instructor of one section changes the flag for every section of the offering, because the flag belongs to the item.

**Current site.** Adding a column with a constant default rewrites no row and fires no trigger. Old writers name their
columns (`site/js/faculty-lessons.js:759-767`), so an upsert leaves the new ones alone. **Proof:** the fingerprint in
section 20 covers every legacy column of `assignment_offerings`.

---

## 6. Bonus scores

**Decision: a flag on the grade row widens the existing check, under the same constraint name, and only a trigger can
set that flag.**

| Object | Change |
|---|---|
| `grades.over_max_allowed` | `boolean NOT NULL DEFAULT false` |
| `grades_within_bounds` | Same name. `points_earned IS NULL OR (points_earned >= 0 AND (points_earned <= points_possible OR over_max_allowed))` |
| `grades_over_max_guard` | `BEFORE INSERT OR UPDATE`, firing only `WHEN (NEW.points_earned > NEW.points_possible OR NEW.over_max_allowed)`. Pinned `SECURITY DEFINER`, so it can read the offering whoever is writing. Sets the flag from `is_bonus OR allow_over_max`, with a missing row treated as false. Ignores what the client sent. |
| `grades_source_check` | Gains `auto_checked`. |
| `grades_new_items_stay_unfinalized` | `BEFORE INSERT OR UPDATE`, firing only `WHEN (NEW.is_finalized)`. Pinned `SECURITY DEFINER`, so it can read the offering whoever is writing. Refuses when the item has `entered_on_new_page`, with a missing row treated as not flagged. Removed at step 2. |

**Why it stays safe for old writers.**

- An old writer never sends the column, so it gets false, and the check behaves exactly as today.
- An over-maximum score on an ordinary item raises the same error under the same name.
- `faculty-grade.js:456` clamps to the maximum, so old pages never hit the new branch.
- The trigger costs nothing on a normal write, because its `WHEN` clause is false.
- Adding the column touches no row, so `grades.updated_at`, which is the staleness clock for review signoffs, does not
  move.
- **Locks.** The check swap scans `grades` under a lock, and `CREATE TABLE ... REFERENCES` briefly locks the table it points at,
  such as `enrollments` and `assignment_offerings`. That is brief at this size, and the rehearsal times it. **Every step 1 file**
  starts with `SET LOCAL lock_timeout = '5s'`, so a blocked apply fails cleanly and can be retried, rather than queueing cadets
  behind it.

Turning `is_bonus` or `allow_over_max` off is refused while a grade on that offering sits above its maximum.

**Bonus and possible points.** A bonus item keeps a listed `points_possible` to show the student. The total rule adds 0
to possible for it. `assignment_offerings_points_positive` already permits a possible of 0.

**Trial, 2026-11-04, on staging, in a transaction rolled back:** at the maximum passes with the flag false. Above it on an
ordinary item fails under the name `grades_within_bounds`, with or without a client-sent flag. Above it on a bonus item
passes, and the trigger sets the flag. Finalizing on a flagged item is refused, and on any other item passes, as does an
unfinalized write on a flagged item. `tests/app-schema` gains these as vectors, beside the existing check at
`test-grade-effort-write.mjs:117`.

---

## 7. Grade states

**Decision: the state is computed, never stored, in one database function. Zero is a score. Missing is a state.** Checked
in this order, first match wins:

| # | State | Condition | In the total |
|---|---|---|---|
| 1 | `excused` | An active excusal exists, whatever else exists. | Leaves it |
| 2 | `released` | A finalized grade with points, and `grades_release_at` passed or null. **Two exceptions:** an auto-checked grade until `is_past` goes to row 6, and a stored 0 that carries the no-submission marker (`diagnostic.no_submission`), has work behind it, and is either the AI's row or was saved before the work, goes to row 4 (the `isStaleZero` question). | Counts its points |
| 3 | `graded_unreleased` | A finalized grade with points, held by a future `grades_release_at`. | Leaves it (decision 5) |
| 4 | `submitted_ungraded` | Any of: committed with no usable grade; a score not yet finalized, when work was committed or the path takes no submission (`has_draft_score`); the stored 0 above (`is_late`); a no-submission path with `is_past`, column still open (`no_work_received`); a past-due draft that holds a real score (`has_draft_score`; a blank draft with only the AI's suggested 0 does not count). | Leaves it, shown as backlog |
| 5 | `missing` | `is_past`, nothing committed. For a no-submission path, a closed column makes it `missing` on any date, unless the cadet holds an active extension that has not passed (then it waits, row 7), and an open column keeps it in row 4 once past due. | Counts 0 |
| 6 | `in_progress` | A draft, or attempts, until `is_past`. An auto-checked item shows its score so far. A bonus item with a draft or attempts is `in_progress` until past due, then `not_due`. | Leaves it |
| 7 | `not_due` | Anything else. | Leaves it |

Details that decide edge cases:

- **One clock.** Every deadline test in this table is `is_past` from section 8, which is the deadline plus the 120-second grace.
  So work counts as on time, and an auto-checked item stays out of the total, for exactly the same instant.
- **The flags are part of the cell.** The backlog view splits "work to grade", "draft scores to publish" and "scores to enter"
  on them, so an open in-person column is never mistaken for work received.
- **Work behind a zero.** The stale-zero test asks the site's question: a chosen activity other than the written one counts as work, otherwise any non-blank written answer does, submitted or not; the work time is the commit time when committed, else the submission's last update. A committed blank is not work, so a published AI no-submission 0 on it is a real zero and counts, as in today's gradebook. A draft with real answers under a published marked 0 is stale. Proven against the site's own `planPublish` on every case of a grid (`tests/app-schema/v2_stale_zero_proof.py`), with two planted controls.
- **A past-due draft is `missing`, unless it holds a score.** It was never committed. A draft that carries a score for the instructor to publish is backlog (row 4), the reading noted in section 0.
- **A suggested 0 on a cadet with no work is `missing`, not backlog.** Nothing was committed, and that is the fact that matters.
- **A finalized grade with null points is ungraded.** It cannot count.
- **Late work replaces a 0, derived or stored.** A committed late item moves to `submitted_ungraded`, so its 0 leaves the
  total until it is graded. Then the grade counts, and the cell returns `is_late`. The stored 0 rule asks the same question
  as `isStaleZero` (`site/js/faculty-grade.js:1278`), now in one place. Step 2 also stops writing system zeros on offerings
  with `late_allowed`, because the database derives Missing. An instructor's 0 after the commit stands.
- **A bonus item with no work never becomes `missing`.** It stays `not_due`, which pages read as "No score".
- **Students see `graded_unreleased` as `submitted_ungraded`.** The score stays hidden until release.
- **An unusable deadline.** `source = 'none'` on a path that has a stored value sets `deadline_invalid`, and it goes on the
  exception list (section 8). It also fires for a stored day value that no meeting day of the section reaches, when there is no `due_at` to fall back on.

**In-person closing.** `column_closures(id, assignment_offering_id, section_id, closed_by, closed_at, reopened_by, reopened_at)`,
one open row per offering and section by partial unique index. "Publish whole column" writes it. Per section, because the
sections of one course finish at different times. **RLS:** staff of that section.

**Current site.** Nothing reads these states at step 1. `deriveStatus` (`site/js/schema.js:1006`) stays until the step 2 pages
replace it.

---

## 8. One deadline rule

**Decision: one rule in the database, with the same order and tie-breaks the site uses today.**

| Function | Returns |
|---|---|
| `app.scheduled_deadline(p_assignment_offering, p_section)` | `due_at`, `source` |
| `app.effective_deadline(p_enrollment, p_assignment_offering)` | `due_at`, `source`, `is_past` |
| `app.deadline_rows(p_course_offering)` | Internal. The same body, set-based, for the total rule. |

**The rule, in order. `source` uses the site's own names.**

| Order | Source | When |
|---|---|---|
| 1 | `extension` | An active row in `extensions`, meaning `revoked_at` is null |
| 2 | `section` | A row in `assignment_due_dates` |
| 3 | `day` | `due_by_day`: the first entry of `meeting_days`, **in array order**, that has a non-empty value |
| 4 | `offering` | `due_at` |
| 5 | `none` | None of them, or a value that is not a valid date |

`is_past` is `now() - due_at > interval '120 seconds'`. This is the fifth copy of the grace period, and it is added to the list
of copies at `site/js/schema.js:715`.

Three details have to match the code exactly, and each is a vector:

- Tier 3 needs `nullif(due_by_day ->> day, '')`. A JSON null or an empty string falls to the next day.
- An unparsable tier 3 value gives `none`. It does not fall through to `due_at`, because `site/js/schema.js:766` does not. The test
  is a date-shape match (`^\d{4}-\d{2}-\d{2}`) and then `pg_input_is_valid`, because that function alone accepts `now`, `today` and
  `infinity`, and JavaScript rejects all three. It needs Postgres 16. Staging is 17.6. A date and time with no zone is flagged unusable, because the site reads it in the browser's zone and the database in UTC. The shape test is the whole string: a date, or a date and time with `Z` or an offset. `038` begins with a check that refuses to run below Postgres 16, so a wrong production version fails with a sentence rather than an obscure error. Confirm production anyway.
- Comparison is at millisecond precision, because that is all JavaScript holds. Stored deadlines are whole seconds. Functions also
  pin `timezone = 'UTC'`, so a date-only value means what JavaScript takes it to mean. A stored value like `2027-1-1`, which JavaScript
  accepts and the shape test does not, fails the proof script. None is expected.

**Section moves (decision 6).** `enrollments.section_id` updates in place (`site/js/faculty-roster.js:137`), so rule tier 2 and 3 follow the
cadet's current section. Left alone, a T-day cadet moved to M on 11 Nov would be late for a 10 Nov deadline they never had.

- `enrollments_section_move` runs `AFTER UPDATE OF section_id`, from the first step 2 migration.
- For each item in the course offering: if the new section's scheduled deadline has already passed, and the old section's is later, and
  there is no active extension, it writes an extension at the old section's date. Reason: "Section move: deadline kept". `granted_by`: the
  mover.
- `extensions_unique` allows one row per enrollment and item. If a revoked row exists, the trigger overwrites it: the new date, the
  revocation fields cleared together as `extensions_revocation_complete` requires, and the old date, reason and revocation reason
  copied into the new reason. This does not restore what was revoked. It records a different fact: the date the old section had.
  Trialled, rolled back.
- An active extension stands, whatever its date, because a person set it.
- Otherwise the new section's date applies: a future date, or a later one.
- This changes nothing in the rule itself. It stays four sources.

**Shape.** `STABLE`. `SET search_path = app, pg_temp`. Names qualified. Grants per section 17. `scheduled_deadline` and `effective_deadline` are
`SECURITY DEFINER`, because pages call them directly: each returns a row only for the caller's own enrollment, or a section the caller may
see. `deadline_rows` runs with no caller check, so it is internal and has no web-facing grant.

**Proof that it equals what the site computes.** A script runs the candidate query and the shipped `site/js/schema.js` (`resolveDueBySection`,
`effectiveDue`) over named vectors and every offering and section row in the database, then compares instant and source.

**Measured 2026-11-04 on staging, read-only: 26 rows, 26 equal, 0 different.**

| Vector | Result, both sides |
|---|---|
| No days, offering date only | `offering` |
| M section, T section | `day`, each its own date |
| M W F with dates on W and F | `day`, the W date |
| Array order `{F,W}`, F date later than W | `day`, the F date. Array order, not date order. |
| Day key JSON null, day key empty | `day`, next day's date |
| Explicit row beats day | `section` |
| Extension beats explicit | `extension` |
| Section's day not in the map | `offering` |
| No dates at all | `none` |
| No `due_at`, day present | `day` |
| Microseconds in `due_at` | `offering`, equal at milliseconds |
| 13 real offering and section rows | All equal |

Also measured, separately: `now`, `today`, `infinity`, `garbage` and `2027-13-45` are refused by the shape test and rejected by JavaScript.

**Still to prove:** real extension rows, once the seed has them (section 25); the unparsable vector through the function once it exists; and the
same script on production, run by the course director over `prep_app_read`. Because a Node-only check may never be the sole proof, the vectors also
carry fixed expected values, so a machine without Node still checks the SQL side.

**Current site.** Nothing calls it at step 1. Step 2 moves the pages over, and the same step moves the job worklist off its own query.

---

## 9. One total rule

**Decision: internal functions compute cells and totals. Three thin functions serve people. Pages never add, divide, compare, or rank.**

| Function | Who | Returns |
|---|---|---|
| `app._cells_at(p_course_offering, p_scope, p_now)` | Internal | One row per enrollment and published item: state, its flags, points, possible, `is_late` |
| `app._totals_at(p_course_offering, p_scope, p_now)` | Internal | One row per enrollment, for the whole offering. See below. Checkpoints and the shadow compare read this. |
| `app.gradebook_cells(p_course_offering, p_scope)` | Staff and students | Cells for sections the caller may see, or the caller's own. For students, points are null unless released or an auto-checked score so far. |
| `app.course_totals(p_course_offering, p_scope)` | Staff | `_totals_at` at the current time, filtered to sections the caller may see |
| `app.my_course_total(p_course_offering, p_scope)` | The student | `earned_text`, `possible_text`, `percent_text`, `percent_key_text` only |

**`_totals_at` returns:** `earned_text`, `possible_text`, `percent_text`, `percent_key_text`, letter, GPA, `near_line_letter`, rank, `tie_group`, and counts of
missing, ungraded, unreleased, excused.

`p_scope` is `final` (every published item) or `prog` (items with `prog_included`). Enrollments counted are `active` and `completed`, never `dropped`. A caller
cannot supply a clock: `p_now` stays internal, because a chosen time would read a release-gated grade early.

**Why the people-facing functions are `SECURITY DEFINER`.** Under invoker rights, a student's call could not see what a staff call sees, so state and totals
could differ. The definer function computes one answer, then filters what comes back.

**The rule.**

- `earned` = sum of `grades.points_earned` over `released` cells. `missing` adds 0.
- `possible` = sum of `assignment_offerings.points_possible` over `released` and `missing` cells, adding 0 for a bonus item.
- Everything else leaves both sums.

**An item with no graded path** (none at all, or practice only) that is published and past due counts as 0 of its points for a cadet with no grade. That is what the shipped gradebook does today, and the cadet cannot commit to it, so the exception list is where a director finds and fixes it. This is the shipped behaviour, kept on purpose.

The denominator reads the offering, not the copy in `grades.points_possible`, so one number has one source. The fingerprint script also reports any row where
the two differ, as a list to resolve before step 2.

**Exact math. `numeric` only, with no division before a comparison.**

| Question | How |
|---|---|
| At or above a line? | `earned * 100 >= cutoff * possible` |
| Near a line? | `(cutoff - width) * possible <= earned * 100` and `earned * 100 < cutoff * possible`. Scale validation keeps the width below the smallest gap, so only the next line up can apply. |
| Letter | The first line, highest cutoff first, that passes. The scale must end at 0, so a line always passes. |
| Possible is 0 | Percent, letter and rank are null. Never divide. If earned is above 0, it is listed as an exception. |
| Showing percent | `percent_text` is **display only**: exact if it ends within 6 decimals, tested by multiplying back. Otherwise cut to 6, with a trailing `…`. |
| Exporting percent | `percent_key_text`: plain digits, 22 decimals, cut and never rounded. Exports also carry `earned_text` and `possible_text`. |

**Rank and ties, defined.**

| Item | Rule |
|---|---|
| Sort key | `percent_key` descending, then raw `earned` descending. `percent_key` is cut, never rounded, by exact integer division: `div(earned*100*10^22, possible) * 1e-22`. |
| Scope | The whole course offering, for that `p_scope`. An instructor's filtered view keeps the course-wide rank. |
| `tie_group` | The pair (`percent_key`, `earned`), as text. Equal pair, same group, flagged. |
| Rank style | Standard competition: 1, 2, 2, 4. A group of two takes the same rank by default. |
| Alphabetical | If the Director picks it, the group takes consecutive ranks by last name, then first name, then cadet ID. Ranks after the group do not change. |
| Where a choice lives | On a checkpoint run only (section 14). The live staff page always shows same rank and the flag. A new run carries a choice forward when that `tie_group` and its members are unchanged. |
| No percent | No rank. |

**Why a truncated rank key is safe.** Two different fractions with denominators up to 10^8 hundredths differ by at least 10^-14 percent, and the key holds 22 decimals.
Measured on staging: 1/3 and 2/6 give equal keys; 33333333/99999999 and 33333334/100000000 give different keys.

**Why text, not numbers, comes back.** PostgREST sends `numeric` as a JSON number, which the browser parses as a float. Returning text means a page displays the exact value
and has nothing to do arithmetic on.

**How everyone reads it, from step 2.**

| Surface | Reads |
|---|---|
| Student "My grades" | `my_course_total`, `gradebook_cells` |
| Staff gradebook, backlog | `course_totals`, `gradebook_cells`. Replaces `totalsFor` in `faculty-gradebook.js`. |
| Course Admin export, gradebook export | `course_totals` |
| Blackboard export, reports | Approved checkpoint rows (section 14), written from `_totals_at` |

**The current site at step 1 reads none of this, so no total moves.** Before step 2, a shadow compare lists the new total beside the old one for every student. Each
difference must trace to a known cause: ungraded work and drafts now leave the total, and copies of possible points now agree. This list is reviewed before any page moves,
because a Fall total shown after step 2 can differ from what the old page showed.

**Do not copy from the comparison gradebook.** It is a spec for the shape of reports, not for arithmetic. This design differs on purpose: no rounding step before the letter; the
lookup always finds a line; possible comes from items, not from which rows exist; blank is not automatically 0; excused exists; checkpoints are never overwritten; computed values
are tested.

---

## 10. Excused

**Decision: a separate table, so a grade save cannot touch it. Every change is logged. The requirement is that only a Director can set it, proved by an instructor session being
refused.**

| Table | Columns |
|---|---|
| `grade_excusals` | `id`, `enrollment_id`, `assignment_offering_id`, `reason` (required, not blank), `set_by`, `set_at`, `revoked_at`, `revoked_by`, `revoked_reason`. One unrevoked row per enrollment and offering, by partial unique index. |
| `grade_excusal_events` | Append-only: `excusal_id`, `enrollment_id`, `assignment_offering_id`, `action`, `actor`, `at`, `reason`. Plain columns with no foreign keys, so the log outlives what it describes. Written only by a pinned `SECURITY DEFINER` trigger, because direct writes to this table are revoked from everyone who can cause one. |

**What the design requires.**

- **Write:** insert and update only where the offering's course offering is in `director_offerings()`. **[D3]** applies.
- **Read:** staff read their sections. A student has no direct read, and sees the state through `gradebook_cells`, not the reason.
- **Trigger:** sets `set_by` to the real caller and `set_at` to `now()`, whatever the client sent. Refuses an enrollment from another course offering.
- **No direct delete.** Removal is a logged revoke. The delete trigger refuses unless `pg_trigger_depth() >= 2`, which means a cascade from removing the lesson or enrollment. The log
  then records that. Trialled in a rolled-back transaction: a direct delete is refused, and a parent's cascade passes.
- **Other roles.** `prep_app_dml` and `service_role` bypass RLS, so their write grants on both tables are revoked by name, as `024` does. `prep_app_dml` and `service_role` cannot set excused.
  A repair runs as the owner, under the coordination gate, and must name its actor or the trigger refuses.

The grade row is not touched, so an excusal does not disturb the score, and revoking it restores the previous state.

**Current site.** A new table no page reads. The control ships at step 2. **Proof:** a real instructor session is refused on staging, per the acceptance tests, rather than the operator role.

---

## 11. Letter scale

**Decision: per course offering, versioned, and validated by a database check.**

| Object | Shape |
|---|---|
| `letter_scales` | `id`, `course_offering_id`, `version`, `lines jsonb`, `near_line_width numeric NOT NULL DEFAULT 0.1`, `created_by`, `created_at`, `retired_at`. One unretired row per offering, by partial unique index on `retired_at IS NULL`. |
| `lines` | `[{ "letter": "A", "cutoff": 93, "gpa": 4.0 }, …]` |
| `app.letter_scale_is_valid(lines, width)` | `IMMUTABLE`, used in a `CHECK`. Not empty. Cutoffs strictly descending. Last cutoff exactly 0. Letters unique. GPA not increasing. Width at least 0, and below the smallest gap between cutoffs. |
| `app.default_letter_scale()` | The scale from `GRADE-RULES.md` |
| `app.current_letter_scale(p_course_offering)` | The unretired row, else the default. **So an offering needs no row until a Director changes something.** |
| `app.scale_change_preview(p_course_offering, p_lines, p_width)` | Who would change letter or flag, before a line moves. Saves nothing. |

Editing makes a new version and retires the old one, and checkpoints keep a copy of the scale they used. JSON numbers in `jsonb` are exact `numeric`; measured on staging, `89.90` reads back equal to
`89.9`.

**RLS.** Staff of the offering read. Directors write. Students have no direct read. **Current site:** new table, not read.

---

## 12. Questions and keys

**Decision: stable question IDs in one table. Keys in a separate, staff-only, versioned table. New keys never go in `activities.content`.**

| `questions` | |
|---|---|
| `id` | Primary key, for foreign keys |
| `activity_id`, `qid` | `qid` is the stable ID, never reused. `UNIQUE (activity_id, qid)`. It is the key in `grades.question_scores`. |
| `position`, `prompt_md`, `figure_url`, `unit_hint`, `is_retired` | A retired question stays, so old attempts still resolve. |
| `format` | `multiple_choice`, `multiple_select`, `numeric`, `prose` |
| `choices jsonb` | `[{ "id", "text" }]`. Which is correct is not stored here. |
| `points numeric(6,2)` | See "Who owns the points". |

| `question_keys` | |
|---|---|
| `id`, `question_id`, `variant_key` (default `''`), `version` | `UNIQUE (question_id, variant_key, version)`. **[D2]** One current row per question and variant, by partial unique index on `superseded_at IS NULL`. |
| `correct_choice_ids text[]`, `select_rule` | Multiple choice and select. `select_rule` defaults to `all_or_nothing`, which also avoids fractional points. |
| `value numeric`, `tol_abs numeric`, `tol_pct numeric` | Numeric. Correct if within either tolerance, boundary inclusive. A correct value of 0 must have `tol_abs`, because a percentage is useless there. |
| `sig_figs smallint`, `sig_fig_mode` | `ignore`, `warn`, `require` |
| `unit text`, `unit_aliases text[]`, `unit_mode` | `ignore`, `warn`, `require` |
| `reference_text` | Guidance for a human on a prose question. |
| `written_by`, `checked_by`, `checked_at`, `created_by`, `created_at`, `superseded_at` | `written_by` is `human` or `ai`. Publishing is refused while an AI-written key has no `checked_by`. **The database sets `created_by`, `checked_by` and `checked_at` from the signed-in caller and the clock, whatever the client sends. `written_by` and `created_by` cannot change after insert.** |

**Prose is never marked right or wrong by machine.** A trigger refuses machine fields on a prose question, and refuses a prose question on an `auto_checked` path. In a `human_graded` online path,
machine formats are marked as suggestions and prose waits for a person.

**Who owns the points.**

| Path | Owner | Rule |
|---|---|---|
| `auto_checked` | **The questions.** | A trigger on `questions` sets `assignment_offerings.points_possible` to the sum of unretired `questions.points`, on every insert, edit, retire and delete. Publishing checks the two agree, and refuses otherwise. Once published, a direct write that disagrees is refused. |
| `human_graded` online | The offering. | The publish check reports a mismatch with the question sum, as `preflight-analyze` does today. |

**Creating an item cannot deadlock on this.** An offering exists before its questions, so nothing is checked while it is unpublished. **An offering with an `auto_checked` path has only that path,** because points have one owner: the fill trigger refuses the second path in either order, and the publish check repeats it. Alternatives remain for typed and tutor work.

**Trial, rolled back.** Offering made at 0, then two questions: possible becomes 5. A direct write while unpublished passes. Publishing at the wrong sum is refused; at the right sum it passes. A direct write after publishing is refused. A question edit after publishing moves the sum.

A points edit on an `auto_checked` path re-scores only grades with `source = 'auto_checked'`, through the marking function. Grades with any other source, including an instructor's correction, stay as they are and
are listed for that instructor. Editing points never writes to a hand-entered grade.

**Correcting a key.** A corrected key is a new version, and the old one gets `superseded_at`. `app.remark_question` then re-marks every attempt on that question against the new version, updating the attempt's
result fields and `key_version_id`, and recomputes `auto_checked` grades. One row in `key_remark_runs` records who, when, from and to which version, and how many changed. Instructor-corrected grades are listed, not
changed. Ships with Stage E.

**Per-student values later [D2].** Add `question_variants(question_id, variant_key, params jsonb)` and `student_question_variant(enrollment_id, question_id, variant_key)`. The key table does not change. Attempts
already record which key version they were marked against.

**RLS.**

| Table | Policy |
|---|---|
| `questions` | Staff of the offering read. Directors write. Student read comes with the student pages, for a published item past its release time. |
| `question_keys` | Staff of the offering read. Directors write. All grants revoked from `anon`. **No student policy, ever.** Only the marking function reads keys for a student. |

**Snapshots.** The term freeze copies `activities.content`. Keys are not there, so they never enter a snapshot. Their history is the version column. The freeze also copies question text, without keys, once students
read from `questions`.

**Preflights.** They keep `content.questions`, with their existing `q1`, `q2`, `q3` IDs as `qid`, so grades do not change. In the finished design, reference answers for prose will live in `question_keys.reference_text`, and `lessons.html`,
`lesson_aggregate.py`, the `preflight-analyze` skill and the term builders will read them from there.

**Number formats (Stage E).** One parser turns `1E3`, `1.0e3`, `1000` and `1,000` into `numeric`, and keeps the raw text so significant figures can be counted. The comma rule is settled there, not here.

**Current site.** New tables, unread. **Proof:** a test on staging signs in as a student and reads `question_keys`, expecting nothing. It stays in the suite forever.

---

## 13. Attempts

**Decision: every answer is a row, written only by a server function. The grade is recomputed from those rows.**

| `question_attempts` | |
|---|---|
| Keys | `enrollment_id`, `assignment_offering_id`, `question_id`, `attempt_no`. `UNIQUE (enrollment_id, question_id, attempt_no)` also stops a double submit. |
| Answer | `answer jsonb` (the raw text), `parsed_value numeric` |
| Result | `is_correct boolean`, `points_awarded numeric(6,2)`, `key_version_id` |
| Time | `answered_at DEFAULT now()`, `is_late` |

| `submission_receipts` | For typed and tutor work |
|---|---|
| Columns | `submission_id`, `activity_id`, `content_sha256`, `committed_at` (set by the database), `is_late`, `actor` |

**Which attempt counts:** `assignment_offerings.attempt_rule`, applied per question (decision 4).

**What the function writes.** `grades.question_scores` and `points_earned`, with `source = 'auto_checked'` and **`is_finalized = true`**, recomputed on every answer. **The total reads `grades` and never attempts,** so there
is only one path into the total.

**How instant feedback and the total fit together (decision 4).** The function returns right or wrong for that answer at once. The item shows its score so far, from the same grade row. Row 2 of the state table in section 7 keeps the item out of the total until
`is_past` for that student, so it joins once.

**A person's later correction wins.** It sets `source = 'instructor'`, and the function stops recomputing that grade. Later attempts are still stored.

**RLS.** Students read their own attempts through the student pages. Staff read their sections. **No client writes at all:** the only writer is the Stage E function, which is pinned `SECURITY DEFINER`. Write grants are revoked by
name from `authenticated`, `service_role` and `prep_app_dml`, because the last two bypass RLS. It checks the deadline with `effective_deadline`, checks the limit, stores the attempt, and returns right or wrong only.

**Current site.** New tables, empty until Stage E.

---

## 14. Checkpoints

**Decision: one frozen row per student and period. Every run is kept. Nothing is ever overwritten.**

| Table | Columns |
|---|---|
| `grade_checkpoint_runs` | `id`, `course_offering_id`, `period` (`prog` or `final`), `run_no`, `status` (`draft`, `approved`, `superseded`), `scale_snapshot jsonb`, `rule_version`, `as_of`, `source_fingerprint`, `exceptions jsonb`, `created_by`, `created_at`, `approved_by`, `approved_at`, `revises_run_id`. `UNIQUE (course_offering_id, period, run_no)`. One approved run per offering and period. |
| `grade_checkpoint_rows` | `run_id`, `enrollment_id`, `student_id`, `section_id`, `earned`, `possible`, `percent_text`, `percent_key`, `letter`, `gpa`, `rank`, `tie_group`, `near_line_letter`, and counts of missing, ungraded, **unreleased**, excused. `UNIQUE (run_id, enrollment_id)`. |
| `checkpoint_tie_choices` | `run_id`, `tie_group`, `choice` (`same_rank`, `alphabetical`), `chosen_by`, `chosen_at`. Starts on a draft run. |

**Frozen means all of it, once approved.**

| Object | After approval |
|---|---|
| Run header | Refuses every change, except `status` from `approved` to `superseded`. `scale_snapshot`, `as_of`, `exceptions`, `rule_version` and `source_fingerprint` cannot move. |
| Rows | Trigger refuses insert, update and delete. |
| Tie choices | Same. |

**Exceptions are listed before approval, and approving means they were seen:** ungraded work, **unreleased grades**, **every open in-person column** (decision 1), near-line students, tied groups, bonus-only totals, unusable deadlines, a cadet with two counted enrollments in one offering, and a cadet whose dropped enrollment in that offering holds credit or a committed submission that their active enrollment lacks. A dropped enrollment holding nothing, or only a 0, is not an exception, because a section move can leave one behind. `approved_by` and `approved_at` are that record, over the frozen `exceptions` list. No separate acknowledgement is stored, because approval refuses unless the list shown is still the list.

**What `source_fingerprint` covers: every input to `_totals_at`.**

| Inputs | |
|---|---|
| Grades and work | `grades`, commit times on `submissions` |
| States | `column_closures`, `grade_excusals`, `extensions` |
| Items | `prog_included`, `is_bonus`, `is_published`, `points_possible`, `grades_release_at`, all deadline fields, `assignment_due_dates` |
| People | Enrollment status and section, `meeting_days` |
| Scale | Lines and width in force, and tie choices on the run |

**Approval does three things, in one transaction, and refuses on the first failure.**

1. Recomputes the fingerprint. Any input change refuses, even one that moves no total.
2. Recomputes `_totals_at` at `now()`, and compares every row. This is what catches the clock: a deadline or a release time that passed after the preview moves a count or a sum, with no input changed.
3. Sets `as_of` to `now()`, so the frozen record is true at the instant it was approved.

A refusal asks for a new preview. For example: preview at 16:00, column closed at 16:30, 3 cadets become missing. Approval at 16:45 refuses, on the fingerprint.

**Revising.** A new run with `revises_run_id` set. On approval the old one becomes `superseded`. A Final with no Prog simply has no Prog run.

**RLS.** Staff of the offering read the run header and tie choices. Row policy: an instructor reads only the rows of their own sections, and a Director reads all. Directors approve, through a Stage F function. Students have no direct read. **Current site:** new tables, empty until Stage F.

---

## 15. Report data

**Decision: nullable fields, added now. Everything here is marked: confirm against the report copies when they arrive. Staff-only values go in a staff-only table.**

| Where | Purpose |
|---|---|
| `courses.subject`, `courses.course_number text` | Report headings. |
| `terms.report_code text` | Term as the report prints it, such as `20261`. |
| `students.class_year smallint` | Cadet year on approval sheets. Filled by a later roster import. |
| `course_offering_settings.incoming_gpa numeric(4,3)` | Incoming GPA, entered by a Director. |
| `course_grade_history` | `course_id`, `term_report_code`, `prog_gpa`, `final_gpa`, `prog_avg`, `final_avg`, `source`. Entered by hand for prior terms. Later terms fill from approved checkpoints. The comparison report prints two prior terms. |

**RLS.** `course_offering_settings` and `course_grade_history`: staff of that course read, Directors write, no student policy. **Current site:** nullable columns no page selects, and unread tables. Rows in `students` are not touched at step 1.

---

## 16. Blackboard

**Decision: a per-course choice, stored in the staff-only settings table.**

| `course_offering_settings` | Meaning |
|---|---|
| `course_offering_id` | Primary key. A row is optional. |
| `blackboard_export boolean NOT NULL DEFAULT false` | Whether this course uses the export. |
| `bb_prog_column text`, `bb_final_column text` | Column names to match. Nullable. |

The Blackboard export works the way the existing preflight fill does: the staff member uploads Blackboard's own export and gets the same file back with numbers in columns that already exist. Cadets are matched by cadet ID only (a file with no ID column is refused); an item column by its exact title, a preflight by the PF token and lesson number; the Prog and Final columns by the names saved here, a column of the same name plus "letter" taking the letter. A header is never written, a column nothing was written to is left out, a blank is a blank and never a zero, an excused item is a blank, and a missing item is 0 as the total counts it. Percent and letter are the `course_totals` text for the matching scope, the percent cut at the database digits and never rounded. Today it reads the live total; reading an approved checkpoint is the Prog and Final stage. The existing per-preflight fill stays as it is, and its behaviour for preflight columns is unchanged.

---

## 17. Rules that apply to every new object

**Functions.**

- `search_path` pinned to `app, pg_temp`, and every name qualified, as `025`'s assertion requires.
- **Grants are by name.** The schema's default ACL grants `EXECUTE` on a new function to `anon`, `authenticated`, `service_role`, `prep_app_dml` and `prep_app_read` (measured on staging). So every migration runs `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read`, and then grants only what the table below says.
- Trigger functions need no grant.

| Function group | Step 1 grant | Step 2 grant |
|---|---|---|
| `set_prog_flag`, `current_letter_scale`, `default_letter_scale`, `scale_change_preview` | `authenticated`. Each checks its caller, or is pure. | Same |
| `letter_scale_is_valid` | `authenticated`, `service_role`, `prep_app_dml`. It is pure, and a `CHECK` runs as the writer, so a writer without it fails with a permission error. | Same |
| `_cells_at`, `_totals_at`, `deadline_rows` | `prep_app_read` only, for the proof scripts. That role already reads every table. | Same |
| `scheduled_deadline`, `effective_deadline`, `gradebook_cells`, `course_totals`, `my_course_total`, `release_at` | None | `authenticated` |

**Tables.**

- RLS on, with explicit policies.
- New tables inherit default grants to `anon`, `authenticated`, `service_role` and `prep_app_dml`. Every new table revokes all from `anon`.
- Append-only and function-written tables revoke writes by name from `authenticated`, `service_role` and `prep_app_dml`.

**Types.** `numeric`, never float. `timestamptz` for times.

**Existing view.** `terms_awaiting_freeze` gets `security_invoker = true` in `035`, so it follows the read rules of the tables under it. `freeze_term.py` runs as an operator and keeps working.

**Each migration** has a rollback file under `supabase/migrations/app/rollback/` and a row in the migration ledger.

**`ON DELETE`, for every new foreign key.** Existing `unscheduleLesson` and `deleteLessonAndContents` (`site/js/faculty-lessons.js:971`, `:993-995`) must keep working, and roster removal sets a status rather than deleting (`site/js/faculty-roster.js:316`).

| Foreign key | `ON DELETE` | Why |
|---|---|---|
| `assignments.origin_assignment_id` | `SET NULL` | Deleting a source lesson must still work. |
| `assignment_offerings.part_set_id` | `SET NULL (part_set_id)` | Keeps the composite key's other column. |
| `part_sets`, `letter_scales`, `course_offering_settings`, `student_groups` to `course_offerings` | `CASCADE` | Same lifetime. |
| `column_closures` to item and section | `CASCADE` | Same lifetime. |
| `questions.activity_id`, `question_keys.question_id` | `CASCADE` | Same lifetime as the content. |
| `question_attempts` to enrollment and item | `CASCADE` | As `grades` does. `countLessonWork` must count attempts, so a person sees what goes. |
| `question_attempts` to question and key version | `RESTRICT` | Retire, do not delete. The lesson delete removes the item first, so attempts are already gone. |
| `submission_receipts.submission_id` | `CASCADE` | Same lifetime. |
| `submission_receipts.activity_id` | `SET NULL` | The artifact swap deletes the old activity (`site/js/faculty-lessons.js:1075`), and the default would block that and lesson delete. The hash and the commit time stay. |
| `key_remark_runs.question_id` | `CASCADE` | Same lifetime as the question. |
| `course_grade_history.course_id` | `CASCADE` | Same lifetime as the course. |
| `grade_excusals` to enrollment and item | `CASCADE` | The delete trigger permits a cascade, and the log has no foreign key (section 10). |
| `grade_checkpoint_runs.course_offering_id`, `revises_run_id`, `grade_checkpoint_rows.run_id`, `checkpoint_tie_choices.run_id` | `RESTRICT` | A course with an approved record cannot vanish. |
| `grade_checkpoint_rows.enrollment_id`, `student_id`, `section_id` | No foreign key | A frozen record. A cascade or `SET NULL` would collide with the freeze. |
| `student_group_members`, `student_group_snapshots`, `student_group_grades` to group, enrollment or item | `CASCADE` | Same lifetime. |
| `grades.student_group_id` | `SET NULL` | The grade outlives the group. |
| Who-columns on log and frozen tables | No foreign key | Removing an instructor must not touch a record. |
| Who-columns elsewhere | `SET NULL` | As `001` does. |

---

## 18. Groups — model now, build later

| Table | Columns |
|---|---|
| `student_groups` | `id`, `course_offering_id`, `name` |
| `student_group_members` | `group_id`, `enrollment_id`, `joined_at`, `left_at` |
| `student_group_snapshots` | `group_id`, `assignment_offering_id`, `enrollment_id`, `captured_at`, `captured_by`, `reason`. Who was in the group when that work was handed in. |
| `student_group_grades` | `group_id`, `assignment_offering_id`, `points`, `entered_by`, `entered_at` |
| `grades.student_group_id` | Nullable. |
| `grades.student_group_adjusted` | `boolean NOT NULL DEFAULT false`. |

**Each member still gets a normal `grades` row,** written from the group's score. So the total rule needs no group logic, and joining or leaving later does not rewrite past work.

**One member's adjustment leaves the others unchanged, and survives.**

| | |
|---|---|
| The one way to spread a score | `app.apply_group_score`, a pinned `SECURITY DEFINER` function. **It is not granted to anyone until step 2.** It needs `is_group_work` on the item, sets a transaction-local marker, and skips adjusted rows and finalized grades already released (outcome `skipped_released`), listing them for the instructor. A Director can name a row to overwrite, which clears its flag. Each spread writes a `student_group_snapshots` row (reason `score spread`) of who was in the group. |
| Who sets the flag | `grades_group_adjusted`, a pinned `BEFORE UPDATE` trigger. On a change to the score of a row with `student_group_id`, it sets `student_group_adjusted`, unless the marker is on. A client cannot send its way around that by naming the column: a direct write to `student_group_id` or `student_group_adjusted` from `authenticated`, `anon`, `service_role` or `prep_app_dml` is refused, on insert and on update. |

**Trial, rolled back.** A write with the marker on leaves the flag false. A write without it sets the flag true.

**RLS.** Staff read. Directors write. Empty at step 1, except on the staging seed.

---

## 19. Backfill

**Decision: one script, `scripts/v2/backfill_paths.py`. Dry-run by default. `--commit` to write. Idempotent. Safe to re-run, including after new items exist.**

| Today's rows become | How |
|---|---|
| **Kind preflight** | Nothing to write. The script asserts it, **on rows in scope**. |
| **Delivery and grading from modality** | `UPDATE offering_activities` where `delivery IS NULL`: `written` gives `typed_response`, `human_graded`, `warn_earns_full = true`; `interactive` gives `interactive_tutor`, `effort`, false. |
| **Late refused** | Nothing to write. The column default is false. The script asserts it, **on rows in scope**. |

**In scope means `delivery IS NULL`, for all three checks.** New items, the gate seed and anything the fill trigger has filled are not in scope, so they cannot trip it on a second run. An unknown modality in scope stops the run before any write.

**Why this cannot move a grade.**

- It writes one table, `offering_activities`, which has no `updated_at`.
- Two triggers from `027` fire on those rows, and neither writes elsewhere. The fill trigger only validates, because the script
  sets `delivery`. The `grading_mode` trigger reads the item, finds no `entered_on_new_page`, and returns.
- It writes nothing to `grades`, `submissions` or `assignment_offerings`, so no touch trigger fires and no review signoff goes stale.

**Output.** Counts by course, term, modality and grading role, then the planned writes. A second `--commit` writes 0 rows. A dry-run after a commit reports 0 rows.

**It uses the DML tier,** so it needs no new credential and cannot run DDL.

---

## 20. Fingerprint proof

**Decision: one read-only script, `scripts/staging/grades_fingerprint.py`, comparing every row before and after. Its printed output is safe to paste.** It prints table names, counts and row IDs, and never a name, score or answer. This is separate from `schema_fingerprint.py`, which compares structure.

**Fall is live while this runs.** A cadet's commit writes a grade (`015`), and so does an instructor or a nightly job. So "nothing changed" cannot be the test. The test is **"nothing changed that did not leave a mark."**

**What it hashes.** For every row, `md5(to_jsonb(row) - <columns the migrations add>)`, keyed by primary key, plus a row count per table. Whole rows mean no column is forgotten, and no `NULL` can blank a concatenation. The script holds the list of added columns, and fails if a removed key is not on the list.

**The same text every time.** A `timestamptz` renders in the session's time zone, so one row hashes differently under two zones (measured). The script runs `SET TIME ZONE 'UTC'`, refuses any other zone, and stores the setting in its file. It reads all tables in one `REPEATABLE READ READ ONLY` transaction, so they share one snapshot.

| Tables | |
|---|---|
| Grades and work | `grades`, `submissions`, `submission_activities` |
| Who is where | `enrollments`, `sections`, `students` |
| Items | `assignment_offerings`, `offering_activities`, `activities`, `assignments` |
| Dates | `assignment_due_dates`, `extensions` |
| Above them | `course_offerings`, `courses`, `terms` |

**Which writes are ours.** Each migration and the backfill record `txid_current()` to a file. `xmin` on a row names the transaction that last wrote it. That splits ours from everyone else's exactly, without guessing from a time window.

**The rule that makes this work.** No migration or backfill writes an existing row inside a savepoint or a `DO` block with `EXCEPTION`. Measured: a write inside either carries a different id, and would look like someone else's.

**Modes.** `--save <file>` writes every row's hash and `updated_at` to a file outside the repo. `--diff <file> --xids <file>` classifies each row:

| Finding | Class |
|---|---|
| Same hash | Fine |
| Changed, and `xmin` is a recorded migration or backfill id | **Defect.** Our own work moved a row. |
| Changed, and `updated_at` is unchanged, on a table with a touch trigger | **Defect.** Something wrote around the trigger. All 13 tables with `updated_at` have one (measured). |
| Any other change | **Explained.** Listed by ID and table, to check against who was working. Includes a transaction that began before the save. |
| New row | Listed |
| Row gone | **Defect,** unless a person can name the delete. No migration deletes. |

**Pass:** zero defects. A cadet committing during the window is **Explained** and does not stop anything. The diff exits non-zero only on a defect.

**Measured 2026-11-04 on staging, rolled back:** a top-level write's `xmin` equals `txid_current()`. An earlier offering-level version of the grades query, run twice, gave identical hashes. The per-row script is still to be built, and the gate tests it both ways (section 25).

The same script on production is run by the course director over `prep_app_read`.

**A second, computed proof, because equal rows do not prove equal pages.** The deadline script (section 8) runs before and after too, and the current-site pass (section 25) reads the migrated database through the real pages.

---

## 21. Test vectors for the total rule

Default scale, width 0.1, unless a row says otherwise. All run in `numeric`. **M** marks arithmetic measured on staging on 2026-11-04 through read-only `SELECT`, using the exact expressions in section 9. The rest are the suite to write with `039`.

**Column limit.** One stored score or item holds at most 9999.99 (`numeric(6,2)`, migration `001`). A possible total of 10000 or more is therefore a sum over items, so vectors 2, 4, 5 and 43 run as sums of items of at most 9999.99 (vectors 2, 4 and 5 as two 5000-point items). Vector 43's values are the arithmetic measured above; through stored rows it runs as 3333.33/9999.99 against 3333.34/9999.99, which keep the same result.

| # | Setup | Earned / possible | Percent | Letter | Near-line or note |
|---|---|---|---|---|---|
| 1 M | 89.9 at a 90.0 line | 899 / 1000 | 89.9 | B+ | **A-** |
| 2 M | 89.89 at a 90.0 line | 8989 / 10000 | 89.89 | B+ | none |
| 3 M | On the line | 900 / 1000 | 90 | **A-** | none |
| 4 M | Just inside the width | 8990.01 / 10000 | 89.9001 | B+ | A- |
| 5 M | Just outside the width | 8989.99 / 10000 | 89.8999 | B+ | none |
| 6 M | Repeating decimal, custom scale with a 66.67 line | 2 / 3 | 66.666666… | below that line | flagged |
| 7 M | Scores whose float sum goes wrong | 0.10 + 0.20 / 0.30 | 100 | A | none |
| 8 M | Normal work plus bonus | 100 + 5 / 100 | 105 | A | none |
| 9 | Bonus does not change possible | 90 + 5 / 100 | 95 | A | none |
| 10 M | **Bonus-only item** | 5 / 0 | null | null | Listed as exception |
| 11 M | **Zero possible**, nothing earned | 0 / 0 | null | null | No error |
| 12 | **Excused** with a 0 on the row | 45 / 50 | 90 | A- | |
| 13 | **Excused** with a 50 on the row | 45 / 50 | 90 | A- | The score is ignored, not lost. |
| 14 | **Missing** 50-point item | 45 / 100 | 45 | F | State `missing`. |
| 15 | Entered **zero** on it | 45 / 100 | 45 | F | Same number, state `released`. Zero is a score. |
| 16 | **Ungraded** 50-point item, work committed | 45 / 50 | 90 | A- | Backlog, work to grade |
| 17 | Finalized, **held** by a future release time | 45 / 50 | 90 | A- | `graded_unreleased`, unreleased count 1 |
| 18 | **AI suggestion, not finalized,** work committed | 45 / 50 | 90 | A- | `submitted_ungraded`, `has_draft_score` |
| 19 | AI-suggested 0, no work, past due | 45 / 100 | 45 | F | `missing`, not backlog |
| 20 | Case 14, late work committed | 45 / 50 | 90 | A- | Ungraded, marked late |
| 21 | Case 20, graded 40 | 85 / 100 | 85 | B | Marked late, the 0 is gone |
| 22 | **Stored finalized 0 with the no-submission marker,** commit newer than `graded_at` | 45 / 50 | 90 | A- | `submitted_ungraded`, late |
| 22b | Case 22 without the marker | 45 / 100 | 45 | F | `released`. An ordinary 0 stands. |
| 22c | AI-suggested 0 with the marker, committed work with an answer | item leaves total | | | `submitted_ungraded` |
| 22e | Published AI 0 with the marker on a committed blank | 45 / 100 | 45 | F | `released`. A real zero. |
| 22f | Published AI 0 with the marker over a draft holding real answers | item leaves total | | | `submitted_ungraded` |
| 22d | Marker, work committed, but `graded_at` or the commit time is null | item leaves total | | | `submitted_ungraded` (the order cannot be proved, so it asks) |
| 23 | Case 22, instructor re-enters 0 after the commit | 45 / 100 | 45 | F | `released`. The instructor's 0 stands. |
| 24 | Past-due draft, no score | counts as 14 | | | `missing` |
| 24c | Past-due blank draft carrying only the AI's suggested 0 | counts as 14 | | | `missing` |
| 24b | Past-due draft holding a score | item leaves total | | | `submitted_ungraded`, `has_draft_score` |
| 25 | In-person blank, column open | item leaves total | | | `submitted_ungraded`, `no_work_received` |
| 26 | Same blank, column closed | counts as 14 | | | `missing` |
| 26c | Same blank, column closed, deadline not yet passed | counts as 14 | | | `missing` (any date) |
| 26d | Same blank, column open, past due | item leaves total | | | `submitted_ungraded`, `no_work_received` |
| 26h | Closed column, blank, active extension not yet passed | item leaves total | | | `not_due`, source `extension` |
| 26i | Closed column, blank, revoked extension | counts as 14 | | | `missing` |
| 26j | Closed column, blank, extension expired | counts as 14 | | | `missing` |
| 26k | Deadline plus 119.999 s, 120.000 s, 120.001 s | | | | on time, on time, past (the site agrees) |
| 26l | Day value with no zone, a named zone, `BC`, a trailing space, `now` | item leaves total | | | `source = 'none'`, `deadline_invalid` |
| 26e | Bonus item with a draft, not yet past due | item leaves total | | | `in_progress` |
| 26f | Percent key of 125 / 201 | | 62.18 | | key `62.1890547263681592039800`, cut at 22 places |
| 26g | Commit time null on a late-allowed item | | | | `is_late` false, no error |
| 27 | Auto-checked, 6 of 10 so far, 60 seconds after the deadline | item leaves total | | | `in_progress`, shows 6. Grace applies. |
| 28 | Same, `is_past` true | 6 added to earned, 10 to possible | | | `released` |
| 29 | Fractional scores | 1.25 / 2 | 62.5 | D | none |
| 30 | **Prog** set differs from Final set | Each scope sums only its items | | | |
| 31 | Revoked excusal | Back to the state underneath | | | Log has both events |
| 32 | Dropped enrollment | Not in totals or ranks | | | |
| 33 | Bad stored day value on a typed item | Item leaves total | | | `source = 'none'`, `deadline_invalid`, on the exception list |

**Section moves.** M deadline 10 Nov, T deadline 12 Nov.

| # | Move | Result |
|---|---|---|
| 34 | T to M on 11 Nov, not submitted | Extension at 12 Nov, "Section move: deadline kept". Not `missing` until after 12 Nov. |
| 35 | T to M on 13 Nov, not submitted | Extension at 12 Nov. `missing`, on the deadline they had. |
| 36 | T to M on 15 Nov, committed on 11 Nov | Extension at 12 Nov. Not marked late. |
| 37 | M to T on 11 Nov | No row. Deadline 12 Nov. |
| 38 | T to M on 1 Nov | No row. Deadline 10 Nov, their new track. |
| 39 | Same as 34, active extension already there | No new row. The extension stands. |
| 40 | Same as 34, a revoked row exists | Row overwritten at 12 Nov, active, with the old date and reasons in the new reason. |

**Ties.**

| # | Students | Percent | Result |
|---|---|---|---|
| 41 | P 180/200, Q 90/100 | 90 and 90 | P ranks first, on higher raw points. No flag. |
| 42 M | R 1/3, S 2/6 | Equal key | Compared on raw points, not a float artifact |
| 43 M | T 33333333/99999999, U 33333334/100000000 | Different keys | Not a tie |
| 44 | V 90/100, W 90/100, next student lower | 90 and 90 | Same `tie_group`, flagged. Ranks 1, 1, 3. Alphabetical gives 1, 2, 3. |

**Agreement test.** For one student, `my_course_total`, `course_totals`, the export and the checkpoint row all return the same earned, possible and percent strings. Letter and rank also match between staff surfaces, except rank in a group with a recorded alphabetical choice: the live page always shows same rank (section 9), and only the checkpoint applies the choice.

---

## 22. Check before step 1

### 22.1 Do current pages break on a new kind or a new term?

**They do not crash, going by the code, but four old staff surfaces show unpublished items, and two defaults need rules.**

Most pages filter to published work, so new items are invisible to them: gradebook (`faculty-gradebook.js:441`), export (`faculty-admin.js:360`), student data (`student-data.js:76`, `:524`), tasks (`faculty-tasks.js:207`), dashboard data (`faculty-data.js:199`), student page (`faculty-student.js:67`), and publish planning (`faculty-grade.js:921`, `:1111`, `:1627`).

| Surface | What happens | Evidence | Guard at step 1 |
|---|---|---|---|
| **Lesson editor** | Save would overwrite a new item's kind with `preflight` and remove any path it does not recognize. Remove, Delete and artifact swap would also act on it. | `faculty-lessons.js:647`; `:802`; `:971`, `:993`; `:1075` | **Refuse all of these** when `entered_on_new_page`, before any write, and link to the new page. The listing at `:282` shows the item with that link. |
| **Grade picker** | Lists unpublished items for everyone. It does not filter. | `faculty-grade.js:32-46` | Leave out `entered_on_new_page`. |
| **Report list** | Directors see unpublished items. | `faculty-rollup.js:110` | Leave out `entered_on_new_page`. |
| **Health page** | Reads all items of active offerings, published or not. A new item with no day map would raise the empty-schedule check. Its calendar axis comes from the first active offering returned. | `faculty-health.js:171`, `:165`, `:200` | Leave out `entered_on_new_page`. Spring is inactive, so `:200` cannot pick the wrong term. |
| **Publish toggle** | Would try to publish. | `faculty-lessons.js:912` | None needed. The database rules refuse it, and the page shows the error. |
| **New offering by old tools** | Inserts `is_active = true`. | `scripts/app/create_course_offering.py:169-170` | Takes an explicit flag. `course_offerings_one_active` refuses a second active row anyway. |
| **Old editor, new Spring offering** | Could publish a lesson there. | `faculty-lessons.js:774` | `assignment_offerings_publish_needs_active` refuses it. |
| **Backup download** | Reads every item of the current offering, including new ones. | `faculty-admin.js:428` | None. A backup should hold them. |
| **Student home course** | `is_active` hides nothing: `my_offerings` (`002_rls.sql:121-126`) and `auth.js:248` read enrollment status only. An active Spring enrollment adds a course, sorted newest first. A stored choice wins while it stays valid, so one cadet might land on Spring and another on Fall. | `auth.js:272`, `:278-279` | **Rule, not code: no active Spring enrollments before step 2** (decision 2). `v2` does not edit student pages. |
| **Staff home course** | Same sort. A staff member on a Spring offering with no saved choice lands on Spring. | `auth.js:272` | Accepted. Tell staff. The course picker still works, and a saved choice wins. |
| **Blackboard fill** | Matches only names with a preflight token, so new items do not match. | `blackboard-fill.js:166`, `:179` | None. |

Pages with a new term and no items render empty. Each gets a browser check in section 25, because the code reading says so but no test has shown it.

**What these guards are.** They stop mistakes on old pages. They are not access control, and a tab left open across the deploy has none until it reloads. New items cannot exist before the deploy, so that gap is small. What must hold regardless of the page is held by the four database rules in section 1.

**How the guard avoids branching on kind.** `entered_on_new_page` says which page owns a row, not what the work is. A preflight entered on the new page behaves the same as a homework entered there.

**What happens to the guards at step 2.** In one merge, the Grade picker, Report and Health exclusions come out, because those pages now handle every delivery. The editor's refusal stops reading the marker and reads the path instead: it edits only `typed_response` and `interactive_tutor` paths, and it keeps the stored kind. After that merge is live, one migration drops `entered_on_new_page` and the three temporary rules in section 1. Until then a published new item could not be picked on the Grade page.

### 22.2 Do `lesson-aggregate`, `preflight-analyze` and the two nightly jobs ignore new kinds and Spring items?

**Spring: yes, while Spring is inactive. New kinds: not by themselves. Three script guards are needed at step 1, and more at step 2.**

| Tool | Behaviour | Evidence | Guard |
|---|---|---|---|
| **Job worklist** `--latest` | **No publish, kind or delivery filter.** It takes the newest past-due deadline. A new item due at or after a preflight **masks it**: the job reports "no submissions recorded", and the preflight is never offered again. Silent. | `lesson_aggregate.py:1427`, `:1503`, `:1352`, `:1544` | **Step 1, required.** Add `ao.is_published` and a graded path with delivery `typed_response` or `interactive_tutor`. Branches on delivery. **If any row of an active offering has a null `delivery`, the worklist exits non-zero and says so,** rather than printing "Nothing past due". |
| `register_lesson.py` | Finds the offering by course and `is_active`, so a Spring artifact would land on Fall, silently. | `scripts/fall2026/register_lesson.py:1032` | **Step 1, required.** `--term` is required, and the lookup is by course and term, active or not. It registers drafts only, so nothing publishes. |
| Worklist, new term | Inactive offerings are excluded. | `lesson_aggregate.py:1427` | `course_offerings_one_active` and the inactive default. |
| Worklist, no M and T days | A section with no meeting days yields no track, so it is never listed. | `lesson_aggregate.py:1495-1501` | **Step 2,** if such a course runs tutor or typed work through the jobs. Give it a single track. |
| Worklist, its own deadline query | Its day lookup treats a JSON-null value differently from the site. | `lesson_aggregate.py:1448` | **Step 2.** Call `app.scheduled_deadline`, so there is one deadline rule. |
| `lesson_aggregate` by slug | Two active rows with one slug stop with a clear message. | `lesson_aggregate.py:657`, `:673` | The same index. **Step 1:** `_lesson_meta` drops its `co.is_active` test when `--term` is named, so an inactive training offering's lessons can still be found. |
| `preflight-analyze` | Stops if two terms are active. Its list shows published work. It grades only the written path, and stops on effort mode or a points mismatch. | `.ai/skills/preflight-analyze/SKILL.md:142`, `:150`, `:205` | **Step 2.** A published case study passes those checks, so the skill's list must require a `human_graded` path with `warn_earns_full`. |
| `zero_non_submitters.py` | Exits with two active offerings. Reads published items, with no delivery filter. After step 2 a past-due in-person item would look like nobody submitted. | `zero_non_submitters.py:235`, `:248` | **Step 2.** Filter to paths with `typed_response` or `interactive_tutor`, and skip offerings with `late_allowed`. |
| `planPublish` | Writes zeros for cadets with no grade. Same risk at step 2. | `faculty-grade.js:1111`, `:1335` | **Step 2.** Same filter. |
| `faculty-tasks` | At step 2 a new item would raise a "no readiness report" task. | `faculty-tasks.js:204-207` | **Step 2.** Same filter. |

### 22.3 Order, and how to back out

**Going forward:** migrations, then backfill, then **check the new columns through PostgREST** (`select=entered_on_new_page&limit=1` after `NOTIFY pgrst, 'reload schema'`), then merge. The guards name new columns. `gradeAssignmentList` (`faculty-grade.js:33`) goes silently empty if its query fails, so merging first would look like an empty page rather than an error.

**Backing out: revert `main` first, then roll back the schema.** The same page fails the same way if a column disappears under it.

**A rollback that would lose real rows refuses.** Rollbacks of `027`, `028` and `030` to `037` start with a check. If the tables hold real rows it stops with a message and changes nothing. After a snapshot, checked against live counts, the operator runs `SET prep.rollback_loses_rows = '<file number>'` (for example `'037'`) in that session, before the file's `BEGIN`, and runs the file again. The value is that file's own number, so a flag set for one file never unlocks another. With the flag, `027` also deletes the activities whose modality the old check cannot hold, and stops with its own message if a committed submission chose one. `026` and `029` refuse on their own terms, and `038` and `039` lose nothing.

| Rollback of | Clean until |
|---|---|
| `030` to `039` | Their tables hold real rows. They are empty, or nearly, for weeks. |
| `026` | An item uses a new kind. |
| `027` | The first new item. The modality check cannot narrow with `questions` or `external` rows present, and dropping the columns loses path data. **After that, roll forward.** |
| `028` | An item has `entered_on_new_page`, or anyone relies on the policy columns. |
| `029` | The first grade above its maximum. None can exist before step 2. |

---

## 23. Dates for the cron operator

Both jobs are described in [`../operations/SCHEDULED-LESSON-CYCLE.md`](../operations/SCHEDULED-LESSON-CYCLE.md). Job 1 runs at 01:00 Denver on weekdays and pulls `main` itself. Job 2 runs at 00:33 nightly in a live session, expires after seven days, and stops when it is behind `origin/main` until a person merges.

| Date | What happens | What the operator does |
|---|---|---|
| By **24 Nov** | Go or no-go. | Told the date of the apply. |
| About **1 Dec** (Tue), **proposed 09:00 to 11:00 Denver** | Migrations and backfill on production. Worklist guard merged to `main`. | A daytime window is clear of both jobs and of every 2359 deadline. No job or teammate writes during it (coordination gate). Cadets keep working, and the fingerprint allows for that (section 20). **Same day:** merge `origin/main` into job 2's clone, or it stops. Job 1 picks the guard up itself. Next morning, confirm each job chose a Fall lesson. |
| **1 to 10 Dec** | Fall continues. Guards live. | Nothing new. Spring stays inactive. |
| **8 and 9 Dec** at 2359 | Last possible preflight deadlines, for lessons M41 (9 Dec) and T41 (10 Dec). | Jobs run on 9 and 10 Dec. They then go quiet. |
| **21 Dec** | Fall finals due. | Do not re-run Fall closeouts without asking after this. |
| **After 21 Dec, before 5 Jan** | Step 2. Fall inactive and Spring active, **in one transaction: Fall off first, then Spring on, as two statements.** | Told the time. **Before the flip, pause both jobs.** After it, re-check Fall lessons no longer list. Job guards for step 2 merged. |
| **By 5 Jan** (Tue), evening | Jobs live for Spring. | Re-arm job 2. Re-run the Friday and Saturday deadline check from that document, filtered to published preflights. If new courses were added, keep the two jobs' course lists disjoint. |
| **5 and 6 Jan** at 2359 | First possible Spring preflight deadlines, for lessons M1 (6 Jan) and T1 (7 Jan). | First real run: 6 Jan. Confirm it chose the expected lesson. |

**Order inside step 2, for what cadets see.**

1. Past-term reading ships (Stage D feature 7).
2. Spring enrollments load.
3. Fall enrollments move to `completed`, as a gated bulk update. `is_active` plays no part here: a cadet's course list comes from enrollment status. While Fall enrollments stay active, a cadet whose stored choice is Fall keeps landing on Fall on 6 Jan.

---

## 24. Migrations, in order

Next number in the `app` chain is `026`. Each applies as `prep_app_owner` under the coordination gate, and records its transaction id (section 20).

**Each file below names the earlier migrations it needs,** and `scratch_build_check.py` proves the chain in the order each database will receive it.

**Before `028`:** the precheck confirms at most one active offering per course. If a course has two, the course director settles it first (decision 2), and `028` refuses with a clear message otherwise.

**Step 1:**

| File | Purpose |
|---|---|
| `026_assignment_kinds_seed.sql` | Seed the six new kinds. Add `report_code` and the prefill columns. |
| `027_path_delivery_grading.sql` | Widen the modality check. Add `delivery`, `grading`, `warn_earns_full`, the allowed-pairs check, and the fill trigger. |
| `028_offering_policy.sql` | Policy columns, `entered_on_new_page`, the two publishing rules, `is_active` default and the one-active index, `part_sets`, `origin_assignment_id`, `set_prog_flag`. |
| `029_grades_over_max.sql` | `over_max_allowed`, the widened `grades_within_bounds`, the guard trigger, `grades_new_items_stay_unfinalized`, the `auto_checked` source. |
| `030_questions_and_keys.sql` | `questions`, `question_keys`, their policies, their checks, the points owner trigger. |
| `031_attempts_and_receipts.sql` | `question_attempts`, `submission_receipts`, `key_remark_runs`. |
| `032_letter_scales.sql` | `letter_scales`, validation, default, current-scale and preview functions. |
| `033_grade_excusals.sql` | `grade_excusals`, `grade_excusal_events`, the Director requirement, the who-and-when trigger. |
| `034_column_closures.sql` | `column_closures`. |
| `035_report_and_blackboard.sql` | Report columns, `course_offering_settings`, `course_grade_history`, the `terms_awaiting_freeze` change. |
| `036_groups.sql` | The four group tables, `grades.student_group_id`, `grades.student_group_adjusted`, `is_group_work`. |
| `037_checkpoints.sql` | The three checkpoint tables and the freeze triggers. |
| `038_deadline_functions.sql` | `scheduled_deadline`, `effective_deadline`, `deadline_rows`, `late_close_at`, `release_at`. |
| `039_total_functions.sql` | `_cells_at`, `_totals_at`, `gradebook_cells`, `course_totals`, `my_course_total`. |
| `040_question_policy_helpers.sql` | Added 2026-11-05, after the list above was approved. Four boolean helpers (`activity_is_directed`, `activity_is_staff_visible`, `question_is_directed`, `question_is_staff_visible`) and the four policies on `questions` and `question_keys` rewritten to call them, same rule. A key edit as a director took 13 to 27 s because the nested policies were planned together; it now takes about 50 ms. Applied to staging only. Rollback restores the `030` policies. |
| `041_set_helpers_and_atomic_saves.sql` | Added 2026-11-05. Replaces the four boolean helpers of `040` with four set-returning helpers (`directed_activity_ids`, `staff_visible_activity_ids`, `directed_question_ids`, `staff_visible_question_ids`) read as `IN (SELECT ...)`, so the database evaluates each once per statement instead of once per row (the rule is unchanged; an unfiltered read of about 1,850 questions went from 1.3 to 4.5 s down to under 0.15 s). Adds `save_letter_scale` and `save_question`, which make a scale save and a question-and-key save a single step that is refused if the row changed since the page read it. Adds a trigger that stamps `letter_scales.created_by` from the sign-in. A precondition block and a verify query check table ownership, row security and the owner role. Applied to staging only. Rollback restores the `040` helpers and policies. |
| `042_save_function_validation.sql` | Added 2026-11-05. Replaces the bodies of `save_question` and `save_letter_scale` (same signatures, still security invoker, grants and comments kept) so the database refuses what the pages refuse instead of rounding or blanking it: choices or correct choices that are not a list, points with more than two decimals or outside 0 to 9999.99, a scale cutoff or width with more than three decimals, a GPA with more than two, a letter longer than eight characters or with a space at its end, more than thirty lines, a line carrying any key but letter, cutoff and gpa. Unknown keys in the question fields and the key object are ignored, as before. Applied to staging only. Rollback restores the `041` bodies. |
| `043_offering_admin_guard.sql` | Added 2026-11-05. A trigger on `course_offerings`: for the API roles, a change to `is_active`, a row created active, and any delete are refused unless the caller is a global admin. The policy `offerings_write` is unchanged, so a director still reads, creates an inactive offering of their own course and edits every other column. Server-side roles (the term builders, the admin scripts, the edge functions) pass untouched. Applied to staging only. Rollback drops the trigger and its function. |
| `044_same_offering_checks.sql` | Added 2026-11-05, on branch `v2-step2`. Eleven triggers, for every role, on insert and on an update of the checked columns: a staff assignment's section must belong to its course offering; a due date's section, and a grade's, submission's, extension's, attempt's and group snapshot's enrollment, must belong to the same offering as the item; a group on a snapshot or a group grade must belong to the item's offering; an item's assignment must belong to the offering's course or to no course (a shared library assignment passes); an item's activity path must be an activity of the item's own assignment. A refusal is SQLSTATE 23514. Policies are unchanged, and rows that already disagree are counted in a warning and left alone. Not applied to staging or production; proved on a throwaway database. Rollback drops the triggers and the six check functions. |
| `045_forced_password_change.sql` | Added 2026-11-05, on branch `v2-step2`. While a session's token carries `app_metadata.must_change_password`, every table of the schema answers as empty and read-only-nothing except the caller's own roster row, and `current_uid()` returns NULL, so every helper and every function built on them sees no signed-in user. One restrictive policy on every table, plus `session_uid()` and `session_must_change_password()`. `user_metadata` is never read. A table added later needs the same policy; the scratch test fails when one lacks it. Unflagged sessions are unchanged. Not applied to staging or production; proved on a throwaway database with simulated claims. Rollback removes the policies and restores `current_uid()`. |
| `046_diagnostic_and_staff_reads.sql` | Added 2026-11-05, on branch `v2-step2`. A cadet no longer reads `grades.diagnostic`: cadets read their own finalized grades through a new view, `my_grades`, which carries every grade column except `diagnostic` plus `instructor_note` (the one key of it a cadet is shown), and the row policy that let a cadet read the table is dropped. The staff list is readable by staff and by each user for their own row only. `assignments` and `activities` are readable by staff of the courses the assignment belongs to, by anyone on staff for the shared library (no course), and by a global admin for all; `staff_courses()` is the new helper. **Why the column stays on `grades`:** staff and cadets sign in with the same database role, so a column privilege cannot tell them apart, and a row policy cannot hide one column. Moving the column to a staff-only table would change every writer (both analysis skills, the commit trigger, the total functions, the repair scripts) and five staff pages, and needs a backfill of every row. A view for cadets changes only the two cadet reads in `student-data.js`. The view runs with its owner's rights and is a security-barrier view; a grade column added later is staff-only until the view is rebuilt. **Not covered:** `submission_activities.content` still holds an assessment for an interactive activity and a cadet reads their own row; that is migration 047. Not applied to staging or production; proved on a throwaway database with simulated claims. Rollback restores the old policies and drops the view and the helper. Needs the site files from this branch deployed at the same time as the migration. |
| `047_release_gated_content.sql` | Added 2026-11-05, on branch `v2-step2`. Answer keys (`expected_response`, `correct_answer`, `answer_key`, `solution`) move out of `activities.content` and the snapshot copy into the staff-only key table; the exact before-state is kept in `content_key_archive` for the rollback, and a trigger keeps keys out afterwards. A cadet reads an activity's content only after the item has opened for their section (`release_at`) or when they already have a submission or grade on it; `my_released_assignment_offerings()` and `my_released_activity_ids()` are the helpers, and they answer for active and completed enrolments. `my_grades` lists only the cells the gradebook shows the cadet points for, decided in one function, `my_visible_grade_cells()`. A cadet cannot start a submission on an item that has not opened. A report for an effort-graded item is refused while a finalized grade stands, read by the server from `grades`. The move refuses a repeated question id that carries key text; a multiple-choice or numerical correct answer is filed with machine fields as well as the readable line (a multiple-choice question made by the move gets choices built from the file's options, and a correct answer that is none of them is filed as the readable line on a prose question, so the choice rule of `070` is never offended). A cadet no longer selects an interactive `submission_activities` row: `my_work` shows state and `save_interactive_work()` saves the report. Calendar fields of a future item stay readable. The moving step counts before and after and raises on a mismatch. Not applied to staging or production; proved on a throwaway database. Rollback restores content exactly and refuses if a key it made has been edited since. |
| `048_commit_freeze_and_receipt.sql` | Added 2026-11-05, on branch `v2-step2`. Submitting is one database function, `commit_work()`, that reads the server clock, applies the deadline rule (extension, the 120 second grace, the assignment's late setting, the term's last day), marks the answers final, commits and writes the receipt in one transaction; a repeated request or a second tab waits on the row and gets the first receipt. A committed submission is frozen to the API roles: it cannot be inserted already committed, its commit time and chosen activity cannot change, and its answer rows cannot be inserted, edited or deleted; staff reopen as before. A late commit that the assignment allows is stored marked late. A refusal for a missed deadline names the deadline in Mountain time. `commit_work` and `save_interactive_work` refuse an item that has not opened and a second report while a finalized grade of an effort-graded item stands. The auto-grade trigger no longer fires on every touch of a committed row. `save_written_answers()` merges a patch into stored answers atomically, and `my_lesson_opens_at()` tells a cadet when a held-back lesson opens. Rollback restores the earlier path. Limit, stated plainly: the tutor runs on claude.ai, so the site receives a report and cannot prove the effort in it was real. This closes the commit-time and freeze gaps only. |
| `049_grade_audit.sql` | Added 2026-11-05, on branch `v2-step2`. A trigger on `grades` writes the audit row (created, rescored, finalized, reopened, edited, flag override changed, removed) with the actor read from the signed-in session; `graded_by` is pinned to the signed-in staff member when a staff session sets it; the API roles can no longer write `grade_events`. A new append-only table, `credential_events`, records password resets (requested, done) from the two reset functions with the caller they verified. Excused changes were already logged by 033 and are unchanged. The pages stop writing `grade_events`. Not applied to staging or production; proved on a throwaway database. After review the file was edited in place (nothing was applied anywhere): events no longer cascade away with their grade and carry the enrolment and course offering; the audit covers `over_max_allowed`, `enrollment_id` and `graded_at`; a trigger refuses UPDATE, DELETE and TRUNCATE on `grade_events` and `credential_events` for every role (see 24.2); a write to an existing row keeps its grader. Rollback drops the triggers and the new table, restores the old policies, and returns the grants on `grade_events` to exactly what they were (no TRUNCATE, nothing wider). Put the previous reset functions back before running it. |
| `051_error_log_intake.sql` | Added 2026-11-05, on branch `v2-step2`. The tutor error log takes rows from a public endpoint that cannot require a sign-in, so its limits sit in the database: a row for a lesson that is not registered is not stored, and at most 120 rows per lesson and 600 overall are stored in a minute (the rest are dropped without an error). The identity columns are what the sender typed and nothing may rely on them. Known limit: the caps protect storage and do not promise completeness, because the endpoint has no sender identity; in a minute when a cap is reached the log is incomplete and nothing reports it. No retention job exists. The API roles hold no write on the table. The function adds a slug-shape check (not deployed here). Not applied to staging or production; proved on a throwaway database. Rollback drops the trigger and function. |
| `059_key_version_guard.sql` | Added 2026-11-05, on branch `v2-step2`. A replaced answer-key version can no longer be changed or deleted through the API roles; a cascade from deleting a question or lesson still removes it, and the server-side roles are unaffected. Closes review item A M2. Not covered: an in-place edit of the current key. |
| `060_student_reads.sql` | Added 2026-11-05 for the student schedule and grade list (step 2). Grants `gradebook_cells` and `my_course_total` to `authenticated` (each returns a cadet only their own rows), and widens `my_offerings()` from `active` to `active` and `completed` enrollments so a past term stays readable (E23). Not applied to staging or production; proven on a scratch database by `scripts/staging/scratch_student_reads_proof.py` (22 checks). Rollback restores the grants and the active-only rule. |
| `065_entry_and_publish_functions.sql` | Added 2026-11-05, step 2 (revised after review). `enter_grades` writes a batch of draft scores for one item, all or nothing, and returns how many it saved and how many replaced a published score. It refuses a stale version, a non-number, NaN or infinity, a third decimal, a negative, a score above 9999.99 or above the item's points (a bonus item excepted), a repeated cadet, a cadet outside the caller's sections, and a published grade unless confirmed. `publish_preview` (read-only) counts what a publish would do. `publish_column` refuses an item that is not published or not hand-entered, finalizes only instructor-typed and imported drafts (never AI suggestions, which stay drafts and are counted), and closes the column only when asked and when the item takes no submission. `unpublish_column` takes finalized scores back to drafts and can reopen the column. All are security invoker. Adds a CHECK that no stored score is NaN. Grants the four functions, `gradebook_cells` and `course_totals` to `authenticated`; the `gradebook_cells` grant is idempotent and shared with `060`. Proved on a scratch database only (`scripts/staging/scratch_entry_proof.py`, 75 checks). Rollback drops the four functions and the NaN check and revokes only `course_totals`; it leaves `gradebook_cells` granted because `060` owns that grant. |
| `066_transfer_keeps_blank_state.sql` | Added 2026-11-05, step 2. A section transfer keeps a cadet's blank where it was. A blank on a no-submission item counts 0 once a person closes the column for a section and leaves the total until then; a transfer is an in-place update of `enrollments.section_id`, so a cadet moved between a closed and an open section changed between a counted 0 and a left-out blank with no event (review A, M8). Adds `closure_carry` (enrollment, item, the state the cadet had, the section they left): one row only where a transferred cadet's state differs from the section they are in now. `enrollments_closure_carry` (AFTER UPDATE OF section_id) writes or clears it, starting from the state the cadet had, so a second move carries it on and a move back clears it; a move to another offering clears it. `column_closures_release_carry` removes the carry rows of a section's cadets for an item when a person closes or reopens that column there, so from then on they follow the section. Replaces `_cells_at` with one changed expression (`closed`); same signature and columns. No score, deadline or extension is touched, and nothing is backfilled. The table has row level security on and no browser privilege. Proved on a scratch database only (`scripts/staging/scratch_closure_carry_proof.py`: 6 of 14 cells changed state on a swap of six cadets before, 0 after; the 105 total vectors and `scratch_entry_proof.py` hold). Rollback restores the `039` text of `_cells_at` and drops the table, refusing while it holds rows. |
| `067_publish_closes_column.sql` | Added 2026-11-05, step 2 (change to decision 1). `publish_column` now also closes a no-submission column for the sections it publishes, in the same transaction; each blank becomes Missing and counts 0, except a cadet whose active extension has not passed, who waits. `publish_preview` lists the cadets who would drop to 0 (`blank_cadets`, `blank_count`), those who keep waiting (`waiting_count`), and returns a `fingerprint` of everything the publish acts on (drafts with their versions, sections to close, both lists). `publish_column(uuid, uuid, boolean, text)` replaces the three-argument form: it refuses a publish that would zero a blank without the fingerprint, and any publish whose fingerprint no longer matches (the column changed after the preview). The third argument is ignored; the result gains `zeroed`, the number of cells that actually became Missing. Design of the undo: `column_closures.closed_by_publish`, set by the closure trigger from a transaction-local setting that only `publish_column` sets, never from the sent row, and immutable after insert. `unpublish_column` reopens only closures with the marker and reports `kept_closed`; a column closed by hand, or before this file, stays closed. Staff and student totals are unchanged code: both read `_cells_at`. Proved on a scratch database (`test_step2_together_scratch.py` section 8: the ten-item case reads 10 of 100, 10 percent, for `course_totals`, `my_course_total` and the cells the export reads). Numbered 067, not 052, because it replaces functions made by 065 and the chain applies in number order. Rollback restores the 065 and 034 function text and drops the column; the marker is lost. |
| `068_grades_touch_on_change.sql` | Added 2026-11-05, step 2. `grades.updated_at`, the version the grade page checks, moves only when the row actually changes. Before, an update that wrote the same values back (an analysis re-run, an auto-grade pass) moved it, and the page refused an instructor's save for a write that changed no grade. Replaces the grades touch trigger function only. Proved in `test_step2_together_scratch.py` section 9. Rollback restores the shared touch function. |
| `070_answer_internals.sql` | Added 2026-11-05 (Stage E). `_release_core` (the release rule of `038`, no caller check); `release_at` replaced to call it; `grades_new_items_stay_unfinalized` replaced to allow the answer function's own write through a transaction-local marker. Not applied anywhere. Rollback restores the `038` and `029` bodies. |
| `071_answer_marking.sql` | Added 2026-11-05 (Stage E). `_answer_gate`, `answer_context` and `record_answer`: deadline, attempt limit, key version, lock, attempt row and the `auto_checked` grade, all in the database. Execute granted to `service_role` only. Design and open items: `docs/decisions/V2-STAGE-E-ANSWERS.md`. Not applied anywhere. Rollback drops the three functions. |
| `072_remark_question.sql` | Added 2026-11-05 (Stage E). `_regrade_auto` (the one `auto_checked` grade calculation, moved out of `record_answer`, which now calls it), `_may_correct_key`, `_remark_calc`, `remark_context` and `remark_apply`: re-marking every stored attempt of one question against its current key. A dry run writes nothing; a commit must carry the dry run's count, updates attempts and `auto_checked` grades in one transaction, lists any other grade without changing it, and logs one `key_remark_runs` row. Execute granted to `service_role` only. Not applied anywhere. Rollback restores the `071` text of `record_answer` and drops the five functions. |
| `073_student_homework.sql` | Added 2026-11-05 (Stage E). `student_homework(assignment_offering)`: the signed-in student's read of an auto-checked item's questions (prompt, figure, format, choices as `{id, text}`, points, own attempt count), only once it is published and released. Names every column it returns; no key data. Execute granted to `authenticated`. Not applied anywhere. Rollback drops the function. |
| `074_past_terms_keep_points.sql` | Added 2026-11-05, at the merge of step 2 and Stage E. A question edit no longer moves `points_possible` on an offering whose term has ended (`_term_is_over`: the term's end date is before today in Denver). `sync_auto_checked_points` (030) and `questions_regrade_auto` (072) both skip such an offering, so a finished term keeps the maximum it was graded out of and no grade of it is recomputed. A current or coming term syncs as before. A path added later to an offering of an ended term is not synced. Proved in `test_step2_together_scratch.py` section 11 (fails before this file). Rollback restores the 030 and 072 texts. |
| `075_answer_audit_actor.sql` | Added 2026-11-05, at the merge. The audit row for a grade written by `record_answer` or by a re-mark names the person behind it: the cadet whose sign-in id the edge function verified, or the staff member who ran the re-mark. Two transaction-local settings (`app.audit_actor`, `app.audit_via`) are set around the grade step and honoured by `grades_audit` only while the answer-marking marker is on for that statement; `detail.via` reads `answer` or `remark`. Replaces `grades_audit` (049), `record_answer` and `remark_apply` (072), otherwise unchanged. Proved in section 10 of the same test. Rollback restores the 049 and 072 texts. |
| `076_revoke_public_freeze.sql` | Added 2026-11-05, at the merge. Of the 15 ordinary functions in `app` still executable by everyone, 13 are the row-security helpers every policy calls and are kept; the two term freeze functions (`freeze_assignment_offering`, `freeze_term`), which no page calls, are revoked from PUBLIC, anon, authenticated, service_role and prep_app_read and granted to `prep_app_dml`. Section 12 of the same test lists what stays. Rollback grants them to PUBLIC again. |
| `077_ai_drafted_grading.sql` | Added 2026-11-05, on branch `v2-step2-rollin` (roll-in of the older assignment editor). A ninth allowed pair, `typed_response` with `ai_drafted`: the overnight job writes a suggested mark and a person reviews and finalizes it. The delivery-and-grading check gains the pair; `warn_earns_full` is allowed with `human_graded` or `ai_drafted`. The fill trigger is unchanged, so an older writer still gets `typed_response` + `human_graded`; the activity modality stays `written`, so the tools that find a lesson by modality keep working. Not applied anywhere; proved on a throwaway database (`scripts/staging/test_ai_drafted_scratch.py`). Rollback refuses while any path uses `ai_drafted`. |
| `078_ai_drafts_need_a_person.sql` | Added 2026-11-05, same branch. `grades_ai_drafts_need_a_person`: a finalized grade on an offering that has an `ai_drafted` path is refused unless the session names a staff member (`audit_actor()`), so the service key, the data role and a cadet session cannot finalize it whatever a script says. An update that changes nothing audited on an already finalized row passes. It does not read `source`, because the grade page keeps `ai_suggested` when a person accepts an untouched draft. Apply before 079. Rollback drops the trigger and function. |
| `079_drop_step1_rules.sql` | Added 2026-11-05, same branch. Removes the five step 1 rules (six triggers): `assignment_offerings_new_stay_unpublished`, `assignment_offerings_publish_needs_active`, `grades_new_items_stay_unfinalized`, `assignment_offerings_marker_one_way`, and `assignment_offerings_new_paths_stay_unpublished` with `offering_activities_new_paths_stay_unpublished`. Section 1 lists them, and the drop of `assignment_offerings_publish_needs_active` stands as listed there. The newer items page no longer carries wording for that rule's message; the older editor's helper stays, because the older page still calls it. After it an item made on a newer page publishes and can hold a finalized grade, except that 078 still requires a staff session on an `ai_drafted` item. Drops no column and changes no row. Apply order: 077, 078, 079. Rollback restores the six triggers as 028, 029 and 070 left them. |

Migrations `048` and `059`, with rollbacks, not applied anywhere; proved on throwaway databases (`scripts/staging/test_commit_freeze_scratch.py`: 44 passed, 0 failed, 8 of 8 gap attempts served before and 0 after; `test_key_version_guard_scratch.py`: 11 passed, 0 failed, 5 of 5 before and 0 after).

- **Choices, and why.** The server decides time: no client value is accepted, so a changed device clock does nothing. The grace stays 120 seconds and the late rule is the assignment's `late_allowed`. An unreadable deadline commits as on time, because a missing schedule must not refuse a cadet. Practice reports are not committed and stay saveable. The receipt hash covers content plus markdown. The lesson-opening lookup lives in 048 because the receiver page needs it with it. Keys in the lesson editor are sent only when edited, so a save never blanks a key; a new lesson or copy keeps the keys shown. The 059 guard is limited to old versions and API roles so `save_question` and the 047 filing still work.
- **Known limits.** A cadet can still send any report through `commit_work`; only the first committed report counts. Work committed before 048 has no receipt. The tutor runs on claude.ai, so effort cannot be proved from here.

### 24.1 Saving a grade from an old page (design, added 2026-11-05)

The Grade page builds the rows it saves from what it read when it loaded, then upserts them. A colleague who published
or changed a grade in between had it returned to this page's draft.

- **The version is `grades.updated_at`.** Every change to a grade moves it (`grades_touch`), so the value the page read is
  the version it is editing. No new column and no migration: the number 050 is not used.
- **The rule.** Before a save writes, the page reads the current `updated_at` of every grade it is about to write. A row is
  stale if the version differs, if the grade it held is gone, if it held none and one now exists, or if it held a grade
  with no version. If any row is stale the whole save is refused and nothing is written, and the message tells the
  instructor to reload and make the changes again. Refusing everything is deliberate: a save that writes some rows and not
  others leaves a screen nobody can read.
- **What it does not cover.** The check is a read followed by a write, so two saves inside the same few milliseconds are
  not stopped; closing that needs the check inside one statement (a database function that compares the version in its own
  `WHERE`), which is a later change. The publish-all flip of other people's drafts (`applyPublishPlan`) is not version
  checked; it is limited to rows still unpublished. The check is made by the page, not the database, so it protects against
  a stale page and not against a client that skips it.
- **Rescoring (E8).** A change to a question's value rewrites only grades that hold a score for a changed question. A grade
  with no per-question scores (hand-entered, typed, effort) is not sent at all, and a failed read or write is an error the
  page shows.
- **Checked reads (E9).** `site/js/checked-read.js` is the one way a loader reads a result: an error throws, naming what
  could not be read. The grading page, the grade export and the backup use it, so a failed read shows a message and no file.

After `039`:

- Regenerate `site/js/db-schema.js` with `scripts/app/gen_db_schema.py`.
- Update the table count pinned at `tests/app-schema/test-db-schema.mjs:35`, from 27 to 46 (19 new tables).
- `tests/app-schema/test-system-prefs.mjs:63` reports any table not curated. Add each new table to `CURATED_COLUMNS` (`site/js/system-prefs.js:94`), or to `DEFAULT_HIDDEN_TABLES` (`:161`). Keys and logs go in the hidden set.
- Extend `scripts/staging/step1_precheck.sql` with the new read-only checks.
- Set `is_active` explicitly where tests relied on the old default: `supabase/admin/app_rls_test.py:178`, whose item publishes at `:210`, and `supabase/admin/app_invariant_test.py:83`, which never publishes but should not lean on a default either.

**Step 2, numbered when written. One reviewed batch** brings access, integrity and audit rules to the finished design, and is reviewed as a whole. It also:

- Keeps the deadline a cadet had when their section moves (decision 6).
- Makes path columns `NOT NULL`, and removes the temporary rules and the marker (section 22.1).
- Grants the student functions (section 17), and `apply_group_score` (section 18).
- Makes the commit time a server-set value, so that no total, late mark or stale-zero test depends on a time the cadet wrote. A cadet must not be able to change what a cell counts by writing the commit time themselves, and a commit after the deadline on a `late_allowed = false` item must not count.

**Slip plan.** All of `030` to `037` are empty tables. If time runs short, `026` to `029` are what instructors' entry needs, and `038` and `039` are what the gate tests. None of the others carries risk to Fall.

---

### 24.2 The audit log: what it guarantees, and what a table owner can still do (added 2026-11-05)

`grade_events` and `credential_events` are append-only for every role, including the server-side roles the edge
functions and scripts use. A trigger refuses UPDATE, DELETE and TRUNCATE on both. The API roles hold no write grant on
them at all, and the actor of a grade event is read from the signed-in session, never from the request.

- **History outlives its grade.** Deleting a grade keeps its events. No foreign key joins an event to its grade or to
  its actor (a deleted staff member would otherwise have rewritten the rows that name them). Each event carries the
  enrolment and the course offering it concerns; a 'removed' event also holds the grade id, the enrolment, the offering and the
  old points. Staff who may see the cadet's section read the events, and staff of the offering read a 'removed' event.
- **What is audited on a grade:** points, points possible, finalized state, source, effort, per-question scores, grader,
  `over_max_allowed`, `enrollment_id` and `graded_at`, and a reviewer's flag overrides. A change of enrolment is logged as
  'moved'. A write that changes none of these leaves no row.
- **The grader.** A staff session cannot choose who is recorded as the grader. A new row is pinned to the signed-in
  staff member; a write to an existing row keeps the grader that row already had, so finalizing a colleague's untouched
  draft leaves the colleague as the grader and the audit row names who finalized.
- **What a table owner can still do.** The owner of the schema can disable or drop the triggers, change the table, or
  rewrite its rows, and so can the database superuser. A migration run by the owner is the one intended exception. The log
  is not proof against the database owner, and it does not claim to be: it removes the ability of browsers, the
  server-side roles and the scripts to rewrite it, and it makes any such change to the owner's tooling a visible schema
  change. A server-side process that holds the service key can still APPEND a row of its own (the lifecycle script
  does); it cannot change or remove one.
- **Reset functions.** A password reset is refused when its 'requested' row cannot be written, so deploy 049 before the two
  functions, and put the previous functions back before rolling 049 back. The completion row is written after the reset;
  if that second write fails the function log says so and the reset stands.
- **The test helper that deleted events** (`tests/app-schema/cleanup.py`) no longer does; test events stay.

## 25. Gate seed, and the current-site pass

**Seed:** `scripts/staging/seed_v2_gate.py`. Staging only, through `db_target.py`. Made-up data. Re-runnable. It builds **two courses, because the step 1 rules stop one course from doing both jobs.** A flagged item cannot publish or finalize, so it can never reach the total rule.

**Course 1, the entry course.** Every item unpublished and `entered_on_new_page`, on an inactive offering. It proves that real shapes fit the model and stay invisible.

| Kind | Delivery / grading | Exercises |
|---|---|---|
| `homework` | `online_questions` / `auto_checked` | Multiple choice, multiple select, numeric with tolerance, significant figures and units. A key at version 2. A correct value of 0. |
| `preflight` | `typed_response` / `human_graded`, plus `interactive_tutor` / `effort` as alternatives | `warn_earns_full` true. Late refused. |
| `case_study` | `typed_response` / `human_graded` | `warn_earns_full` false, on the same delivery as the preflight |
| `group_project` | `elsewhere` / `imported` | `is_group_work`, a group, members, a snapshot |
| `quiz` | `elsewhere` / `imported` | A Gradescope-shaped import as draft scores, a `prog_included` difference |
| `exam` | `in_person` / `hand_entered` | `allow_over_max`, a future date |
| `lab` | Two parts in one `part_sets` row: `online_questions` and `elsewhere` | Required parts, and different deadlines |
| A bonus item | Any | `is_bonus`, possible 0 |

Sections: one with `meeting_days = '{}'`, one with `{W,F}`. No lesson numbers anywhere.

**Course 2, the vector course.** Built by the owner role, on an active staging offering of its own course, with its own made-up cadets. Items are published, and `entered_on_new_page` is false, so the step 1 rules do not apply. **Every state in section 7 and every vector in section 21 runs here:** released, held, excused, closed and open columns, scores above the maximum, the adjusted group member, tied pairs and near-line students. **Released and held grades are proven only here at step 1,** not through the Stage C pages, because those pages cannot finalize. The pages prove them at step 2.

**The cadet in the "sees nothing new" session is in neither course.**

**The Fall-shaped seed also gets richer,** because the proof is only as strong as what it covers. Added to `seed_staging.py`: interactive commits producing effort grades through the real trigger; extensions, active and revoked; an AI-suggested unfinalized grade; a stored 0 with a later commit; enough cadets across two tracks for the deadline proof to mean something.

**The gate passes when all of these are true:**

1. `scratch_build_check.py` builds the chain through `039`, in the order each database will receive it. Each build passes everything below.
2. `025`'s function assertion and `scripts/staging/test_trigger_search_path.py` pass with the new functions.
3. Offline suites pass, and live suites pass against staging, with the seed present.
4. **Browser walkthrough with the seed present:** dashboard, Grade, Gradebook, Report, Health, Course Admin and its exports, Lessons, Student view, and a student session that sees nothing new.
5. Old-shape writes still work through the old pages: save a lesson, save a grade, commit a submission, publish.
6. Backfill dry, commit, commit again (0 rows). Fingerprint: zero defects. Two controls: a row changed by an ordinary session during the run must show **Explained**, and a row changed inside a recorded transaction must show **Defect**.
7. Deadline script: 0 differences, now including extensions. Total vectors and states: all pass, on the vector course.
8. A real student session, calling each new function and reading each new table, gets no course data at step 1. It may read lookups such as `assignment_kinds`, and call pure functions such as `default_letter_scale`.

**What stands in for a copy of production.** A restored dump on a scratch project would be the stronger test, and is wanted as an extra. The full-size drill is deferred, so it is not a dependency. Until it runs, three things carry the load: the enriched seed, a read-only precheck on production before `026`, and the production fingerprint itself on the day. **The remaining risk:** a production row shape that neither seed nor precheck imagined would first show on the day. Rollback of `026` to `029` is clean at that moment (section 22.3), and the lock timeout keeps a failed apply harmless.

---

## 26. Options considered

- **Delivery and grading on the item.** Rejected: a preflight with two paths has two of each.
- **Parts as rows inside one grade.** Rejected: a second aggregator, and a second place a total is computed.
- **Dropping `grades_within_bounds` for a trigger.** Rejected: the current site and tests know that name and that error.
- **A separate grade table for new work.** Rejected: two sources for one total.
- **Keys beside the questions in `activities.content`.** Rejected: keys get their own staff-only table, so one rule covers them.
- **A view for the total.** Rejected: a view cannot take a scope cleanly or authorize per caller, and invoker rights would give different answers to different callers.
- **Dividing with a very large scale, then comparing.** Rejected for lines: cross-multiplication has no truncation to reason about. The truncated key is used only for ordering, where the bound above makes it safe.
- **Storing the state.** Rejected: it goes stale at every deadline, and needs a job to refresh it.
- **A per-enrollment "deadline section" column for moves.** Rejected: it adds a fifth source to the one rule, and every old deadline reader would ignore it. An extension is already honoured everywhere.
- **Auto-closing open columns at term end.** Rejected: it would silently zero anything not yet entered. The approval exception list makes the gap visible instead.

---

## 27. Confirmation — how we would know this was wrong

**Signal:** a Fall grade, deadline or page changes after the step 1 migrations. A student total and an instructor total disagree. An approved report copy disagrees with a total or needs a field this model cannot hold. Staff cannot enter a real course on the Stage C pages without a script.

**Threshold:** one confirmed case of any of these. The fingerprint or deadline diff showing a defect also counts.

**Consequence:** for step 1, revert `main`, roll back per section 22.3, and use the fallback in [`V2-SCOPE.md`](V2-SCOPE.md) section 3. Otherwise, correct the one function or table, record it in the changelog, and supersede the affected part of this file.
