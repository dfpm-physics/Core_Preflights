PREP stores course data in four layers. The top two exist so that content can outlive the semester
it was written for: a preflight is defined once and scheduled many times, rather than copied.

The diagram shows every table, grouped by layer. Blue marks the four tables that carry the spine of
the system — an assignment is defined, scheduled, worked, and graded.

<svg class="schema-fig" viewBox="0 0 900 476" role="img" aria-label="The four layers of the PREP data model and the tables in each">

  <rect class="sf-band" x="104" y="12"  width="784" height="92"/>
  <rect class="sf-band-edge" x="104" y="12"  width="784" height="92"/>
  <text class="sf-band-label" x="96" y="46"  text-anchor="end">CATALOGUE</text>
  <text class="sf-band-note"  x="96" y="60"  text-anchor="end">no semester</text>
  <text class="sf-band-note"  x="96" y="72"  text-anchor="end">reusable</text>

  <rect class="sf-band" x="104" y="116" width="784" height="140"/>
  <rect class="sf-band-edge" x="104" y="116" width="784" height="140"/>
  <text class="sf-band-label" x="96" y="176" text-anchor="end">DELIVERY</text>
  <text class="sf-band-note"  x="96" y="190" text-anchor="end">one semester</text>

  <rect class="sf-band" x="104" y="268" width="784" height="92"/>
  <rect class="sf-band-edge" x="104" y="268" width="784" height="92"/>
  <text class="sf-band-label" x="96" y="306" text-anchor="end">WORK</text>
  <text class="sf-band-note"  x="96" y="320" text-anchor="end">per student</text>

  <rect class="sf-band" x="104" y="372" width="784" height="80"/>
  <rect class="sf-band-edge" x="104" y="372" width="784" height="80"/>
  <text class="sf-band-label" x="96" y="410" text-anchor="end">ANALYSIS</text>

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

  <rect class="sf-box" x="116" y="134" width="152" height="30" rx="6"/>
  <text class="sf-t" x="192" y="153" text-anchor="middle">course_offerings</text>
  <rect class="sf-box" x="280" y="134" width="120" height="30" rx="6"/>
  <text class="sf-t" x="340" y="153" text-anchor="middle">sections</text>
  <rect class="sf-box" x="412" y="134" width="130" height="30" rx="6"/>
  <text class="sf-t" x="477" y="153" text-anchor="middle">students</text>
  <rect class="sf-box" x="554" y="134" width="140" height="30" rx="6"/>
  <text class="sf-t" x="624" y="153" text-anchor="middle">enrollments</text>
  <rect class="sf-box" x="706" y="134" width="170" height="30" rx="6"/>
  <text class="sf-t" x="791" y="153" text-anchor="middle">instructors</text>

  <rect class="sf-box-key" x="116" y="192" width="180" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="206" y="211" text-anchor="middle">assignment_offerings</text>
  <rect class="sf-box" x="308" y="192" width="176" height="30" rx="6"/>
  <text class="sf-t" x="396" y="211" text-anchor="middle">offering_activities</text>
  <rect class="sf-box" x="496" y="192" width="184" height="30" rx="6"/>
  <text class="sf-t" x="588" y="211" text-anchor="middle">assignment_due_dates</text>
  <rect class="sf-box" x="692" y="192" width="184" height="30" rx="6"/>
  <text class="sf-t" x="784" y="211" text-anchor="middle">staff_assignments</text>
  <text class="sf-cap" x="206" y="238" text-anchor="middle">scheduled into one semester</text>
  <text class="sf-cap" x="396" y="238" text-anchor="middle">graded or practice</text>

  <rect class="sf-box-key" x="116" y="286" width="150" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="191" y="305" text-anchor="middle">submissions</text>
  <rect class="sf-box" x="278" y="286" width="190" height="30" rx="6"/>
  <text class="sf-t" x="373" y="305" text-anchor="middle">submission_activities</text>
  <rect class="sf-box-key" x="480" y="286" width="130" height="30" rx="6"/>
  <text class="sf-t sf-t-key" x="545" y="305" text-anchor="middle">grades</text>
  <rect class="sf-box" x="622" y="286" width="150" height="30" rx="6"/>
  <text class="sf-t" x="697" y="305" text-anchor="middle">grade_events</text>
  <text class="sf-cap" x="191" y="332" text-anchor="middle">the choice and the lock</text>
  <text class="sf-cap" x="545" y="332" text-anchor="middle">exactly one per student</text>

  <rect class="sf-box" x="116" y="392" width="170" height="30" rx="6"/>
  <text class="sf-t" x="201" y="411" text-anchor="middle">analysis_reports</text>
  <text class="sf-cap" x="470" y="411">AI cohort summaries, scoped to an assignment, a section, or the whole course</text>

  <path class="sf-link" d="M654 60 L654 192"/>
  <polygon class="sf-arrow" points="654,198 650,190 658,190"/>
  <path class="sf-link" d="M206 222 L206 286"/>
  <polygon class="sf-arrow" points="206,292 202,284 210,284"/>
  <path class="sf-link" d="M266 301 L480 301"/>
  <polygon class="sf-arrow" points="486,301 478,297 478,305"/>
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
| `content_snapshot` | What this class actually saw, captured at term close |
| `content_snapshot_frozen_at` | When it was sealed. Once set, the snapshot cannot be edited |

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
| `analysis_reports` | Cohort summaries — readiness, misconception trends, showcase quotes |

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

## What the database will not allow

These are enforced by the database, not by the site, so they hold no matter what writes the data:

- **One grade per student per scheduled assignment.** A student who works through both a written
  preflight and an interactive lesson still receives one score.
- **A score can never exceed the points possible.** A four out of two is rejected.
- **A practice activity can never be chosen for credit.**
- **An activity from another assignment or another semester cannot be chosen.**
- **A committed choice cannot be silently changed** — an instructor unlock is required, and it
  records who performed it.
- **A frozen snapshot cannot be edited.** Correcting one requires clearing the seal first, as a
  separate deliberate step.

## Reading the data directly

Students see only their own work, and their own scores only once finalized. Instructors see the
sections they staff. Instructors with the director role see their whole course offering. System
administrators see everything. The database enforces this per row, so these limits apply to any tool
reading the data, not only to the website.

The repository's operating contract and project reference remain authoritative. If this page and
those files ever disagree, they win and this page is the bug.
