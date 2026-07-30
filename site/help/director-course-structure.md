PREP keeps **what a piece of work is** separate from **when you give it**. The questions are one
record; the semester's run of them — due dates, points, publish state — is a second record pointing
at the first. Each semester holds **its own copy** of the questions.

That separation is why two courses can both have a `preflight-02` without colliding, why editing a
question changes only the semester you are in, and why last semester's grades stay attached to last
semester.

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

**A new assignment starts with the written questions only.** The AI Interaction is added
deliberately — set it to *Include* in the editor and the section opens for you to fill in. It is
not there by default because an interaction you never opened would otherwise be attached, and the
Assignments page would then advertise one that does not exist.

The interactive activity **only needs a URL when students can reach it** — that is, when the
allowed mode is *Choice* or *AI Interaction*. Under *Free-Response* you can attach the interaction
now and add its address later in the semester, once the lesson exists.

While it has no address, the assignment card shows it in amber — *AI Interaction · no URL* — rather
than as a working component, and **Launch interaction** stays disabled. Students see the same
thing: the interactive box is greyed with *Available once your instructor adds the lesson link*.
Nothing anywhere offers a button that goes nowhere.

## The two questions with special handling

Most questions in a written activity are ordinary free responses. Two are not, and each can be
switched on or off per assignment:

| Question | What makes it special |
|---|---|
| **Reading time** | Worth 0 points. Answers are shown to instructors **without names**, so it reads as a class picture rather than as a record about a cadet. It is what the rollup's reading-time panel is built from. |
| **Reading reflection** | The question the AI judges for *meaningfulness*, which is what caps effort when an attempt is not genuine. Its answers are the quotes the rollup offers you to read aloud. If the assignment also has an interactive lesson, this question must match the one the lesson asks — that is what makes the two paths comparable. |

**Everything else is an ordinary question**, scored on its own points.

Switching either off is a real choice, not a hidden one: without the reading-time question the
rollup has no reading-time panel, and without the reflection nothing gates effort and there are no
reflection quotes. The editor says so under the toggles.

**These are identified by a flag on the question, not by being first and second.** That distinction
matters for exactly one reason: it is what lets you drop one of them. When they were identified by
position, removing the reading-time question left the reflection sitting in first place, and
anything looking for "the reading-time question" would have found the reflection and reported its
prose as a reading duration. An older assignment authored before the flags existed is recognised by
its wording and flagged the first time you open it.

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

Changing these settings affects one semester. So does editing the questions themselves — each
semester holds its own copy, so other semesters are unaffected either way.

## A graded interactive lesson grades itself

Marking an interactive activity **graded** has a consequence worth deciding on deliberately: a
student who finishes it is graded the moment they submit, from the effort the lesson assessed, and
that grade is final and visible to them immediately. Nobody reviews it first, because effort is
what the lesson measures and there is nothing left to judge. You can still change the grade
afterwards, and a grade you have finalized by hand is never overwritten.

Marking it **practice** produces no grade at all, however much work the student does.

Written activities are the opposite: the AI suggests a score, and it stays invisible to the student
until an instructor finalizes it.

## Why a student can only be graded once

A student earns exactly one grade per assignment offering, whichever activity they used. A student
who works through both a written preflight and an interactive lesson still receives one score,
capped at the points you set for that semester.

When a student commits to an activity, that choice locks. Any staff member assigned to that
student's section can release it — an instructor does not need to escalate to a director. Every
unlock records who performed it, and the database refuses an anonymous one.

The full list of rules the database enforces, and what happens when each is tested, is in
[Data model reference](help.html?doc=schema-reference).

## Running the same work next semester

**Assignments belong to the semester they were created in.** The Assignments page builds this
semester's assignments and nothing else — there is no picker offering last semester's, because
picking one would be ambiguous about whose questions you were then editing.

A new semester's schedule is built one of two ways: authored in the editor with **+ New
assignment**, or built in bulk by the course-build script (`scripts/fall2026/`), which is how a
40-lesson term is normally set up. Either way the new semester ends up with its own questions, and
editing them changes nothing anywhere else.

That isolation is the point. Until July 2026 two semesters shared one set of questions, so
correcting a typo in one rewrote the other, and deleting a lesson from one deleted the other's
student work with it.

**An interactive lesson always needs rebuilding for a new semester.** A published artifact sends
its results back under one id, that id belongs to one semester, and nothing can change that once
cadets have the link. Ask the chat that produced the lesson to re-issue it — it will generate a new
id — then add it to the new semester's assignment.

**Warning:** Replacing an interactive lesson's id deletes the reports already submitted under the
old one. Freeze the previous semester before you rebuild, or the record of what that class worked
through is lost. Changing only the artifact *link*, keeping the id, never loses anything.

## Sections and due dates

Sections belong to a course offering, so section codes repeat safely across semesters and courses.
Two courses can both have an M1A.

A student's deadline comes from the first of these that exists:

1. An **extension** granted to that student
2. Their **section's** deadline for that assignment
3. The assignment's **default** deadline for the semester

That is how M-day and T-day sections get different due dates, and how one student can be given more
time without moving anyone else's deadline.

## When a student changes section

Moving a student adds a second enrollment rather than editing the first. Their earlier work stays
attached to the section they did it in, so a mid-semester move never re-attributes past grades and a
previous roster stays reconstructable.

A student may hold several enrollments at once — across sections, courses, or semesters.

## Who can change what

Access follows the semester, not the course. Someone who directs Physics 215 in Fall 2026 does not
automatically direct it in Spring 2027.

- Instructors grade the sections they are assigned to and see those students.
- Instructors with the director role manage the whole course offering — content, roster, sections,
  and staff.
- System administrators have that access across every course.

Students see only their own work, and a score only once it is final — which an instructor does for
written work, and which a graded interactive lesson does for itself on submission.

## Freezing a semester

At the end of a semester, freeze it. Freezing captures what each class worked through — the
questions as worded, the activity settings, the points, and the deadlines — and makes that record
permanent.

Freeze before you rebuild any interactive lesson for the following semester. Once frozen, the
record cannot be changed by ordinary editing, so later revisions cannot rewrite history.

## Where to find more

[Data model reference](help.html?doc=schema-reference) covers every table and field, the exact
values each setting accepts, and the complete list of rules the database enforces. It is the place
to look when you need a precise answer rather than the shape of the thing.

The repository's operating contract and project reference remain authoritative. If this page and
those files ever disagree, they win and this page is the bug.
