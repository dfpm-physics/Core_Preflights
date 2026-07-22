PREP stores course data in four layers. The top two exist so that content can outlive the semester
it was written for: a preflight is defined once and scheduled many times, rather than copied.

The diagram shows every table, grouped by layer. Blue marks the four tables that carry the spine of
the system — an assignment is defined, scheduled, worked, and graded.

<svg class="schema-fig" viewBox="0 0 900 480" role="img" aria-label="The four layers of the PREP data model and the tables in each">

  <rect class="sf-band" x="104" y="12"  width="784" height="92"/>
  <rect class="sf-band-edge" x="104" y="12"  width="784" height="92"/>
  <text class="sf-band-label" x="96" y="46"  text-anchor="end">CATALOGUE</text>
  <text class="sf-band-note"  x="96" y="60"  text-anchor="end">no semester</text>
  <text class="sf-band-note"  x="96" y="72"  text-anchor="end">reusable</text>

  <rect class="sf-band" x="104" y="116" width="784" height="160"/>
  <rect class="sf-band-edge" x="104" y="116" width="784" height="160"/>
  <text class="sf-band-label" x="96" y="190" text-anchor="end">DELIVERY</text>
  <text class="sf-band-note"  x="96" y="204" text-anchor="end">one semester</text>

  <rect class="sf-band" x="104" y="288" width="784" height="92"/>
  <rect class="sf-band-edge" x="104" y="288" width="784" height="92"/>
  <text class="sf-band-label" x="96" y="326" text-anchor="end">WORK</text>
  <text class="sf-band-note"  x="96" y="340" text-anchor="end">per student</text>

  <rect class="sf-band" x="104" y="392" width="784" height="76"/>
  <rect class="sf-band-edge" x="104" y="392" width="784" height="76"/>
  <text class="sf-band-label" x="96" y="428" text-anchor="end">ANALYSIS</text>

  <rect class="sf-box" x="116" y="30" width="140" height="30" rx="6"/>
  <text class="sf-t" x="186" y="49" text-anchor="middle">courses</text>
  <rect class="sf-box" x="268" y="30" width="140" height="30" rx="6"/>
  <text class="sf-t" x="338" y="49" text-anchor="middle">terms</text>
  <rect class="sf-box" x="420" y="30" width="152" height="30" rx="6"/>
  <text class="sf-t" x="496" y="49" text-anchor="middle">assignment_kinds</text>
  <rect class="sf-box-key" x="584" y="30" width="140" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="654" y="49" text-anchor="middle">assignments</text>
  <rect class="sf-box" x="736" y="30" width="140" height="30" rx="6"/>
  <text class="sf-t" x="806" y="49" text-anchor="middle">activities</text>
  <text class="sf-cap" x="806" y="76" text-anchor="middle">what is inside</text>
  <text class="sf-cap" x="654" y="76" text-anchor="middle">the container</text>

  <rect class="sf-box" x="114" y="132" width="178" height="30" rx="6"/>
  <text class="sf-t" x="203" y="151" text-anchor="middle">course_offerings</text>
  <rect class="sf-box" x="308" y="132" width="178" height="30" rx="6"/>
  <text class="sf-t" x="397" y="151" text-anchor="middle">sections</text>
  <rect class="sf-box" x="502" y="132" width="178" height="30" rx="6"/>
  <text class="sf-t" x="591" y="151" text-anchor="middle">students</text>
  <rect class="sf-box" x="696" y="132" width="178" height="30" rx="6"/>
  <text class="sf-t" x="785" y="151" text-anchor="middle">enrollments</text>

  <rect class="sf-box" x="114" y="176" width="178" height="30" rx="6"/>
  <text class="sf-t" x="203" y="195" text-anchor="middle">instructors</text>
  <rect class="sf-box" x="308" y="176" width="178" height="30" rx="6"/>
  <text class="sf-t" x="397" y="195" text-anchor="middle">staff_assignments</text>
  <rect class="sf-box-key" x="502" y="176" width="178" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="591" y="195" text-anchor="middle">assignment_offerings</text>
  <rect class="sf-box" x="696" y="176" width="178" height="30" rx="6"/>
  <text class="sf-t" x="785" y="195" text-anchor="middle">offering_activities</text>

  <rect class="sf-box" x="114" y="220" width="178" height="30" rx="6"/>
  <text class="sf-t" x="203" y="239" text-anchor="middle">assignment_due_dates</text>
  <rect class="sf-box" x="308" y="220" width="178" height="30" rx="6"/>
  <text class="sf-t" x="397" y="239" text-anchor="middle">extensions</text>
  <text class="sf-cap" x="502" y="239">deadline: extension, then section, then the offering</text>
  <text class="sf-cap" x="591" y="266" text-anchor="middle">scheduled into one semester</text>
  <text class="sf-cap" x="785" y="266" text-anchor="middle">graded or practice</text>

  <rect class="sf-box-key" x="114" y="306" width="178" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="203" y="325" text-anchor="middle">submissions</text>
  <rect class="sf-box" x="308" y="306" width="178" height="30" rx="6"/>
  <text class="sf-t" x="397" y="325" text-anchor="middle">submission_activities</text>
  <rect class="sf-box-key" x="502" y="306" width="178" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="591" y="325" text-anchor="middle">grades</text>
  <rect class="sf-box" x="696" y="306" width="178" height="30" rx="6"/>
  <text class="sf-t" x="785" y="325" text-anchor="middle">grade_events</text>
  <text class="sf-cap" x="203" y="352" text-anchor="middle">the choice and the lock</text>
  <text class="sf-cap" x="591" y="352" text-anchor="middle">exactly one per student</text>

  <rect class="sf-box" x="114" y="410" width="178" height="30" rx="6"/>
  <text class="sf-t" x="203" y="429" text-anchor="middle">analysis_reports</text>
  <text class="sf-cap" x="308" y="429">AI cohort summaries, scoped to an assignment, a section, or the whole course</text>

  <path class="sf-link" d="M654 60 L654 118 L591 118 L591 170"/>
  <polygon class="sf-arrow" points="591,176 587,168 595,168"/>
  <path class="sf-link" d="M591 206 L591 300"/>
  <polygon class="sf-arrow" points="591,306 587,298 595,298"/>
  <path class="sf-link" d="M292 321 L496 321"/>
  <polygon class="sf-arrow" points="502,321 494,317 494,325"/>
</svg>

Read the dashed arrows as the life of one piece of work: an **assignment** is scheduled as an
**assignment offering**, a student's **submission** records what they did, and a **grade** records
what it was worth.

## Why the top two layers are separate

The catalogue holds no dates and no points. That is the entire trick. Because a preflight carries no
deadline, the same one can be scheduled in Fall 2026 and again in Spring 2027 without being copied,
and both semesters stay joinable for comparison. Everything that changes semester to semester —
deadlines, points, who teaches, who is enrolled, which activity carries credit — lives in delivery.

The practical consequence: editing a question in the catalogue changes it everywhere it has not yet
been frozen. Editing a due date changes one semester.

## Catalogue

Reusable definitions, independent of any semester:

| Table | Holds |
|---|---|
| `courses` | The subject — code (`phys-215`), title, department |
| `terms` | Fall 2026 — instruction dates, finals window, and when grades are due |
| `assignment_kinds` | The list of work types. `preflight` today; homework and exams are added as rows, not code |
| `assignments` | **The container.** One piece of work: kind, slug, title, objectives |
| `activities` | **What is inside it.** A written question set, an interactive lesson, or both |

### assignments

| Field | Holds |
|---|---|
| `course_id` | Owning course. Empty means shared across courses |
| `kind_id` | `preflight`, and later homework, quiz, exam |
| `slug` | Short name, unique per course — `preflight-02`. Two courses may both use it |
| `title`, `description` | What faculty and students see |
| `objectives` | The shared list of learning objectives both activities report against |
| `is_archived` | Retired from the library without deleting history |

An assignment carries **no due date, no points, and no grading policy**. Those are all per-semester.

### activities

| Field | Holds |
|---|---|
| `assignment_id` | The container this belongs to |
| `modality` | `written` or `interactive` |
| `slug` | The permanent public name. **The interactive lesson posts its report to this** |
| `title` | Label shown to students |
| `content` | The questions, or the artifact link. Shape depends on modality |
| `position` | Display order |

For a written activity, `content` holds the question list — each with its text, type, points, the
objective it maps to, and the expected response used for grading. For an interactive activity it
holds the artifact link.

**Rebuilding an interactive lesson means updating that link, not creating a second activity.** The
slug stays as it is, so already-deployed lessons keep working and slugs never proliferate.

## Delivery

One semester's run, and the people in it:

| Table | Holds |
|---|---|
| `course_offerings` | A course in a term — "Physics 215, Fall 2026" |
| `sections` | Section code, meeting days, period. Unique per offering, so `M1A` may repeat |
| `students` | Cadet ID, name, and the link to their sign-in account |
| `enrollments` | A student's place in one section. A student may hold several |
| `instructors` | Faculty accounts and the system-administrator flag |
| `staff_assignments` | Who works on which offering or section, and in what role |
| `assignment_offerings` | An assignment scheduled into one semester |
| `offering_activities` | Which activities are live this semester, and which carries credit |
| `assignment_due_dates` | Per-section deadline overrides |
| `extensions` | Per-student deadline overrides, attached to their enrolment |
| `review_signoffs` | One instructor attestation per section per assignment: "I have reviewed this" |

### Which deadline applies

Three sources, highest first: a student's **extension**, then their section's entry in
**assignment_due_dates**, then the offering's own `due_at`. A section with no entry of its own
falls back to the offering; an assignment with no `due_at` and no section entry has no deadline.

A **revoked** extension does not count as an extension — the row survives revocation so it still
appears on the director's extensions report, but the deadline reverts to the section's.

### extensions

| Field | Holds |
|---|---|
| `extended_due_at` | The replacement deadline. Not an offset — it replaces the computed one outright |
| `reason` | Why it was granted. **Required**, and shown to the director alongside a per-instructor count |
| `granted_by` | The instructor who granted it |
| `revoked_at` / `revoked_by` / `revoked_reason` | Set together when a director revokes it, or all empty |

### review_signoffs

Records that an instructor has read the proposed grades and comments for one section of one
assignment and made their changes. **This is not the same as finalizing** — finalizing publishes
to students, a sign-off publishes nothing. One row per section per assignment.

A sign-off is not stored as still-valid or expired; it is compared against the grades themselves.
If any grade in that section changed after the attestation, the site reports it as *reviewed, then
changed*, so a stored marker can never disagree with the grades it claims to cover.

### assignment_offerings

| Field | Holds |
|---|---|
| `course_offering_id` | Which semester of which course |
| `assignment_id` | Which library assignment is being run |
| `points_possible` | What it is worth this semester |
| `grading_mode` | `points` scores each question; `effort` converts a 0–5 effort rating to points |
| `switch_policy` | Whether a student may change activity after committing |
| `due_at` | Default deadline, overridden per section |
| `is_published` | Whether students can see it |
| `content_snapshot` | What this class was given, captured at term close |
| `content_snapshot_frozen_at` | When it was sealed. Once set, the snapshot cannot be edited |

#### grading_mode

`points` scores each question and adds them up — how written preflights have always worked.
`effort` takes a 0–5 engagement rating and converts it to points: 3 or above earns full marks, 1 or
2 earns half, 0 or nothing earns none. Correctness still gets recorded, as a diagnostic that carries
no credit.

Every Fall 2026 offering is `points`. Moving an assignment to `effort` changes what a score means to
a student, so it is a teaching decision rather than a settings change.

#### switch_policy

What happens when a student has committed to one activity and wants the other:

| Value | Effect |
|---|---|
| `lock_on_commit` | The choice is fixed once committed. Only a staff unlock reopens it |
| `free_until_commit` | Same as above — committing is the moment that fixes it |
| `one_way_to_interactive` | A student may move from the written activity to the interactive one, never back |
| `lock_on_start` | The choice is fixed as soon as they begin |

Every Fall 2026 offering is `lock_on_commit`. The setting is per offering, so a semester can run one
rule while another runs a different one — which is what makes the phased comparison possible without
a code change.

### offering_activities

This small table is the operational lever. It decides, for one semester only, which activities
students may work and which one counts:

| Field | Holds |
|---|---|
| `assignment_offering_id` | Which scheduled assignment |
| `activity_id` | Which activity |
| `grading_role` | `graded` — can earn the points. `practice` — never earns points |
| `available_after` | `always`, `submit` (unlocks once they commit), or `due` (study mode) |
| `is_visible` | Hide an activity without removing it |

Marking two activities `graded` gives students a choice. Marking one `graded` and one `practice`
makes one required and keeps the other available. Swapping those two values moves the whole class
from one modality to the other, and students who already earned a grade keep it.

### enrollments and staff_assignments

Both attach people to a **semester**, not to a course in general. Someone who directs Physics 215 in
Fall 2026 does not automatically direct it in Spring 2027. A student who changes section keeps their
old grades attached to the old section, because grades hang off the enrolment.

`staff_assignments` with no section covers the whole offering — that is how a director is recorded.
With a section, it covers that section only.

#### When a student drops or changes section

An enrolment carries a `status` of `active`, `dropped`, or `completed`, and a `dropped_at` date.
Because every submission and grade hangs off the enrolment rather than off the student, marking one
`dropped` leaves that work exactly where it was, attached to the section it was done in.

Moving a student to a different section means a second enrolment, not an edit to the first. Their
earlier work stays with the earlier section, which is what makes a mid-semester move safe and what
keeps a past semester's section rosters reconstructable. A student may hold several enrolments at
once — across sections, courses, or semesters.

All 73 Fall 2026 enrolments are `active`.

## Work

What each student did, and what it was worth:

| Table | Holds |
|---|---|
| `submissions` | One row per student per scheduled assignment. The chosen activity and the lock |
| `submission_activities` | The actual work, one row per activity they engaged with |
| `grades` | One row per student per scheduled assignment. The score |
| `grade_events` | An append-only log of grade changes and who made them |

### submissions

| Field | Holds |
|---|---|
| `enrollment_id` | Which student, in which section, in which semester |
| `assignment_offering_id` | Which scheduled assignment |
| `chosen_activity_id` | The activity that counts for credit |
| `status` | `draft`, `committed`, or `superseded` |
| `committed_at` | When they finished |
| `unlocked_by`, `unlocked_at` | Who released a committed choice, and when |

An unlock must record who performed it. The database refuses an anonymous one.

### grades

| Field | Holds |
|---|---|
| `enrollment_id`, `assignment_offering_id` | Who, and for what |
| `submission_id` | The work behind it. Empty for a score imported from elsewhere |
| `points_earned`, `points_possible` | The score, and the maximum |
| `effort` | 0–5 rating, used when the assignment is graded on effort |
| `question_scores` | Per-question score, status, and feedback |
| `diagnostic` | Understanding, misconceptions, and flags. **Never affects points** |
| `source` | `instructor`, `ai_suggested`, `derived`, or `imported` |
| `is_finalized` | Whether the student can see it |
| `graded_by`, `graded_at` | Who finalized it |

## Analysis

One table holds everything the AI workflows produce for faculty:

| Table | Holds |
|---|---|
| `analysis_reports` | Cohort summaries — readiness (per instructor), teaching recommendations, showcase quotes, and the misconception-label reconciliation |

### analysis_reports

| Field | Holds |
|---|---|
| `scope` | What the report covers: `assignment_offering`, `section`, or `course_offering` |
| `scope_id` | Which one |
| `audience_id` | The instructor it was written for. Empty means whole-course |
| `kind` | `by_question`, `by_objective`, or `readiness` |
| `payload` | The generated content |
| `generated_at` | When the run produced it |

Reports are written by the analysis workflows, never by the website. Nothing here affects a grade.

## Two records that answer questions after the fact

### grade_events

Every change to a grade appends a row here — created, rescored, finalized, reopened, unlocked —
with who did it and when. Nothing updates or deletes these rows.

It exists because a retroactive rescore once corrupted totals silently in the previous system. When
a score is disputed, or a total looks wrong, this is where the history is. Staff can read the events
for grades in the sections they staff.

### Knowing when a semester is due to be frozen

`terms_awaiting_freeze` lists every term that still has unfrozen offerings, with how many are done,
how many remain, and whether the grades deadline has already passed. A term disappears from the list
once all of its offerings are sealed.

Freezing is what makes an interactive lesson safe to rebuild, so this is the check to run before
starting work on the following semester.

## What the database will not allow

These are enforced by the database, not by the site, so they hold no matter what writes the data:

- **One grade per student per scheduled assignment.** A student who works through both a written
  preflight and an interactive lesson still receives one score.
- **A score can never exceed the points possible.** A four out of two is rejected.
- **A practice activity can never be chosen for credit.**
- **An activity from another assignment or another semester cannot be chosen.**
- **A committed choice cannot be silently changed** — only a staff member can release it, and only
  in their own name. A student cannot unlock their own work, nor reopen it by reverting its status,
  and an unlock cannot be attributed to a colleague who did not perform it.
- **A frozen snapshot cannot be edited.** Correcting one requires clearing the seal first, as a
  separate deliberate step.
- **An extension must say why it was granted.** A blank or missing reason is rejected.
- **An extension cannot be withdrawn once the student has submitted under it** — neither by
  revoking it nor by deleting it. Withdrawing a deadline after the work is in would only turn an
  on-time submission into a late one.
- **Only a course director may revoke an extension.** An instructor may delete one they granted in
  error, but cannot revoke — otherwise the person whose totals the report tracks could remove
  entries from it.
- **A review sign-off cannot be attributed to someone else.** It is recorded in the name of
  whoever performs it, for the same reason an unlock is.

## Reading the data directly

Students see only their own work, and their own scores only once finalized. Instructors see the
sections they staff. Instructors with the director role see their whole course offering. System
administrators see everything. The database enforces this per row, so these limits apply to any tool
reading the data, not only to the website.

The repository's operating contract and project reference remain authoritative. If this page and
those files ever disagree, they win and this page is the bug.
