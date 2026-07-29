## Getting to the Grade page

There is no **Grade** entry in the top navigation. Grading is work that arrives rather than a place
you browse to, so the routes to it are the places that already know you have some:

- the **Needs your attention** boxes on your dashboard, which appear only when there is something in
  them. **There is one box per assignment** — *4 · Review · Preflight 3* — and selecting it opens
  the Grade page on exactly that assignment, already loaded;
- the **Grade page →** link beside those boxes, which is always there even when they are not;
- **Grade** on any assignment card on the **Assignments** page, which opens that assignment already
  loaded. This is the route to use when you want a specific lesson rather than whatever is waiting —
  the boxes above only show you assignments that currently need something;
- a student's name in the **gradebook**.

Past six assignments the boxes collapse back into one summary — *Review grades* — which opens the
Grade page with the assignment picker empty. Six named lessons is a worklist; sixteen is wallpaper.

*(Before 2026-07-27 there was one box for all of it, and it landed on an empty picker: the count
told you there was work and not where.)*

## Scope: what you can see

You grade the sections you staff, for the semester you are looking at. Staffing is recorded one of
two ways, and which one you have decides what the filter shows:

- **Assigned to specific sections** — you see those sections and no others.
- **Assigned to the whole course** (how a director is recorded) — you see *every* section in it.

**— all my sections —** means the sections you personally *teach*. For an instructor that is
everything you can see. For a director it is narrower than what you can see: your course-wide access
is not a teaching assignment, so this filter gives you the sections you were actually assigned to on
Course administration → Section coverage. Use **All sections (entire course)** for the rest.

A director assigned to no section at all is the exception — that filter would be empty, which reads
as "nothing to grade", so it falls back to the whole course.

*(Corrected 2026-07-27. This said a director "sees the full course under it", which was accurate as
a description of a bug: the filter and the All-sections option loaded exactly the same students.)*

Access is per semester. Directing a course in one term does not carry into the next.

## The 3-state toggle

Each question carries one of three states. Select a question's state to cycle through them:

| State | Color | Points | Use it when |
|---|---|---|---|
| `full` | green | full | The answer is fine. |
| `warn` | yellow | **full** | Credit earned, but the answer is wrong or vague and the feedback says so. |
| `zero` | red | none | Blank, off-topic, or no genuine attempt. |

Yellow awards full credit on purpose. Preflights grade pre-class engagement, not mastery.

## Filtering by color

Three lamps above the list — green, yellow, red — control which answers you see. A lit lamp shows
that state's answers; select it to dim the lamp and hide them. Each lamp also shows how many answers
are currently in its state.

All three start lit. Dim green and yellow to work only the red answers, or dim green alone to review
just what the AI flagged. A student drops off the list once every one of their answers is hidden.

Changing a question's state re-files it under the lamps straight away, so an answer you resolve can
disappear from the view you are working in — that is the filter keeping up, not a lost grade.

## AI-suggested scores

Scores written by the analysis run arrive **unfinalized**. They are a first pass, not a decision:
review them, change anything you disagree with, then finalize. Students see nothing until you do.

Suggested feedback is editable. If a yellow flag is wrong, clear the feedback and set it green.

A card tagged **AI suggested** has not been edited by anyone. Editing any question on that card
marks it as yours; cards you never touch keep the AI's authorship, which is what lets your director
see how much of a section has actually been reviewed.

A card tagged **Not yet graded** has no grade at all — the analysis run never scored that student.
This is not the same as a zero, and saving will not create a grade for them. To grade them, set
their questions yourself.

## Students who did the interactive lesson

Some assignments let a student choose the interactive lesson instead of the written preflight.
**Those students are not on the Grade tab at all.** A short line above the cards says how many were
left out, so the count you see and the roster still add up.

Their grade comes from **effort**, scored 0–5 from the lesson report: 0 earns no points, 1–2 earns
half, 3–5 earns full. A reading reflection that is not meaningful caps effort at 2 (so at most half
credit), regardless of engagement elsewhere.

**Unlike the written path, this grade is automatic and final.** It is written the moment the student
commits, from the report, and the student sees it immediately — there is no review step and nothing
for you to publish. That is deliberate: the effort rule above is arithmetic, not a judgement, so
holding the result back would delay a grade nobody was going to change.

They are likewise absent from your *Needs grading by hand* row. If you *do* need to change an effort
score, open the student's page from the gradebook.

*(Until 2026-07-27 these students appeared here as a read-only card marked **Interactive**. It was
accurate and it was in the way: a card you cannot mark, in the middle of a screen for marking, which
you had to identify and skip on every pass. Their grade is unchanged — only the card is gone.)*

## Saving and publishing

Two actions:

| Action | What it does | Who sees it |
|---|---|---|
| **Save draft** | Stores your scores and feedback, unpublished. | Only staff. |
| **Finalize & publish** | Releases scores and feedback. | **Students, immediately.** |

Publishing tells you how many grades it will write and which sections they span — check that line
if you have the section filter set wide, because "All sections" means the whole course.

**You publish your own sections.** You do not need a director to release grades; Finalize & publish
writes exactly the students currently loaded, which is the sections you staff.

> A third button, **Mark section reviewed**, sat here until 2026-07-27. It recorded that you had
> been through the AI's proposals, for a director who was going to publish afterwards. There is no
> second person in that sequence — you publish — so it was a note to yourself sitting one click from
> the button that actually releases the grades. It is gone; nothing you did with it is lost, and
> nothing now depends on it.

## Needs grading by hand

A row of cards sits above the grading view — one card per student who is waiting on you, across
*every* assignment in the course rather than just the one on screen. It is hidden entirely when
there is nothing in it.

**Select a card and that student's answers open**, switching the assignment for you and widening the
section filter if they are not in the section you had selected.

Two things put somebody there:

- **Late** — they submitted after their own deadline, and nothing is published yet.
- **Extension over** — their extension has now passed and their work is in.

Both mean the same thing in practice: the analysis run happened *before* they submitted, so nobody
has proposed grades for them. **Grade these by hand.** Do not re-run the analysis for a whole
assignment to catch a few late submissions.

A student still *inside* a live extension is not here — they arrive when their own deadline passes.
Neither is anybody who took the interactive lesson: those are graded automatically the moment the
student commits, so there is nothing for you to do (see above).

Each card says what state the work is in — *no grade yet*, *AI suggested, unreviewed*, or *draft
saved* — so you can tell what you are walking into before you select it.

## Extensions

A per-student extension overrides the deadline for that student on that assignment, and takes
precedence over everything else.

Granting one **requires a reason**. Your course director sees every extension in the course on
their own page, grouped by who granted it and with a count — the reason is what makes that count a
conversation rather than a number.

**Remove** erases an extension, and is meant for a genuine mistake such as granting it to the wrong
cadet. It stops working once the student has submitted under it: withdrawing a deadline after the
work is in would only turn an on-time submission into a late one. If you need to pull an extension
back rather than correct an error, that is your director's call — they revoke it, which keeps it on
the record with their reason attached.

Otherwise each section's deadline falls the night before that section meets, at the hour your
course director has set — **1759 for Physics 215, 2359 for Physics 110** — and is resolved in three
steps. The assignment carries a deadline **for each meeting day** — an M-day date and a T-day date
— and a section takes the one matching the days it meets. A section may also be given its own
explicit deadline on the assignment, which overrides the day's; that is the exception, for
something like a cancelled class. If neither applies, the assignment's default deadline is used.

Meeting days are stored on the section, so a section added part-way through the term gets the right
deadline for every assignment as soon as it exists — nothing has to be re-saved. They are *stored*
rather than read off the section's name each time, which is what lets a course meeting on any other
pattern work at all.

## The Report tab

The report summarizes how an assignment went — how ready the class is, which misconceptions showed up,
one recommended thing to cover, and a few reading-reflection quotes worth reading aloud. It is
intended as a five-minute read before you teach the lesson.

**It opens on "My sections"** — your own sections combined. "Course rollup" covers the whole course
and is still there if you want the wider picture; when you pick it, the charts show only the
students you have access to, and the page says so if that is fewer than the summary describes.
Picking a single section shows that section's own numbers, quotes and recommendation.

**Directors: the small lamp to the left of the tabs adds the sections you do not teach.** It is off
by default and is not remembered, so every visit starts on your own sections; switch it on and the
other sections appear as tabs beside yours.

**The readiness summary covers all the sections you teach at once**, with any section that genuinely
differs named beneath it — so you can see whether something is your whole cohort or just one class.

**Select a misconception to see what it means.** Each bar opens a panel with a plain-language
description of the misunderstanding and a couple of things students actually wrote, unattributed. A
label and a percentage on their own rarely tell you what went wrong.

**Show all** on the responses panel switches from the sample to every reflection in the section,
with the AI's picks still at the top — useful when you are looking for a particular student rather
than something to read aloud.

It appears once the assignment has been graded *and* aggregated, which happens after the deadline for
that section — so a section whose deadline has not passed yet will still show placeholders.
