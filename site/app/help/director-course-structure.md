PREP keeps **what a piece of work is** separate from **when you give it**. A preflight you write
once is a permanent library entry; scheduling it into Fall 2026 creates a second, separate record
that carries the due dates and points. Next semester you schedule the same library entry again
instead of copying it.

That separation is why a preflight can run for years, why two courses can both have a
`preflight-02` without colliding, and why last semester's grades stay attached to last semester.

## The four things you work with

Every piece of course content sits at one of four levels:

| Level | What it is | Example |
|---|---|---|
| Course | The subject, independent of any semester | Physics 215 |
| Course offering | One semester's run of that course | Physics 215, Fall 2026 |
| Assignment | A container for one piece of work, reusable | Preflight 02 — Electric Charge |
| Activity | A way to do that work | The written questions; the interactive lesson |

An **assignment** is a container. It holds no due date and no points. The **assignment offering**
is the container scheduled into one semester, and that is where the deadline, the points, and the
publish state live.

## What goes inside an assignment

An assignment holds one or more activities. A preflight normally holds two:

- a **written** activity — the free-response questions
- an **interactive** activity — the Claude lesson students launch, part of **iPREP**
  (**interactive Pre-lesson Readiness Engagement Platform**)

Both are optional. An assignment with one written activity is an ordinary written preflight.

## Graded and practice activities

Each semester you decide, per activity, whether it carries credit:

- **Graded** — this activity can earn the points.
- **Practice** — students can work through it, and it never earns points.

Those two settings cover every arrangement you need:

| What you want | How to set it |
|---|---|
| Students choose their path | Mark both activities **graded** |
| Everyone does the questions; the lesson is available too | Written **graded**, interactive **practice** |
| Everyone does the interactive lesson | Interactive **graded**, written **practice** |
| One way only | Include one activity, **graded** |

The third arrangement is worth setting up even when you intend everyone to use the interactive
lesson. Keeping the questions present as practice means that if the lesson has a problem
mid-semester, you switch the two settings and the whole class moves to the questions. Students who
already earned a grade keep it.

Changing these settings affects one semester. The library entry stays as it is, so other semesters
are unaffected.

## Why a student can only be graded once

A student earns exactly one grade per assignment offering, whichever activity they used. The
database enforces this, so a student who works through both a written preflight and an interactive
lesson still receives one score, capped at the points you set.

When a student commits to an activity, that choice locks. If someone commits to the wrong one, an
instructor with the director role can unlock it. Every unlock records who performed it.

## Reusing work next semester

To run an assignment again, schedule the same assignment into the new course offering. Set new due
dates and points there. The questions, objectives, and slug stay as they are.

Interactive lessons work the same way, with one difference in practice. When you rebuild a lesson
for a new semester, update the artifact link on the existing activity rather than creating a new
one. The link changes; the name students and the system use stays the same, so nothing breaks.

**Warning:** Rebuilding an artifact replaces the previous version permanently. Freeze the previous
semester before you rebuild, or the record of what that class worked through is lost.

## Sections and due dates

Sections belong to a course offering, so section codes repeat safely across semesters and courses.
Two courses can both have an M1A.

An assignment offering carries one default deadline, and each section can override it. That is how
M-day and T-day sections get different due dates. A section with no override uses the default.

## Who can change what

Access follows the semester, not the course. Someone who directs Physics 215 in Fall 2026 does not
automatically direct it in Spring 2027.

- Instructors grade the sections they are assigned to and see those students.
- Instructors with the director role manage the whole course offering — content, roster, sections,
  and staff.
- System administrators have that access across every course.

Students see only their own work, and only their own scores once an instructor finalizes them.

## Freezing a semester

At the end of a semester, freeze it. Freezing captures what each class worked through — the
questions as worded, the activity settings, the points, and the deadlines — and makes that record
permanent.

Freeze before you rebuild any interactive lesson for the following semester. Once frozen, the
record cannot be changed by ordinary editing, so later revisions cannot rewrite history.

## The names behind these terms

If you are reading data directly or briefing an AI agent, these are the underlying names:

| What this page calls it | Stored as |
|---|---|
| Course offering | `course_offerings` |
| Assignment (the container) | `assignments` |
| Activity | `activities` |
| Assignment offering | `assignment_offerings` |
| Graded or practice setting | `offering_activities` |
| A student's place in a section | `enrollments` |
| A student's work | `submissions` |
| A student's score | `grades` |

The repository's operating contract and project reference remain authoritative. If this page and
those files ever disagree, they win and this page is the bug.
