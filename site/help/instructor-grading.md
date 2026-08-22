## Getting to the Grade page

There is no **Grade** entry in the top navigation. Grading is work that arrives rather than a place
you browse to, so the routes to it are the places that already know you have some:

- the **Needs your attention** boxes on your dashboard, which appear only when there is something in
  them. **There is one box per assignment**, showing the count and which assignment —
  *17 · Grade Assignment 03* — and selecting it opens the Grade page on exactly that assignment,
  already loaded. Hovering names the assignment in full and says what the count is;
- the **Grade page →** link beside those boxes, which is always there even when they are not;
- **Grade** on any assignment card on the **Assignments** page, which opens that assignment already
  loaded. This is the route to use when you want a specific lesson rather than whatever is waiting —
  the boxes above only show you assignments that currently need something;
- a student's name in the **gradebook**.

**One student, one assignment: grade them from their own page instead.** Every assignment row on a
cadet's page carries a **Grade** button, which opens that one submission in a dialog with
everything this page has — the 3-state toggles, feedback, reopen, and extensions. Use it when you
arrived at a cadet with a question about them; use the Grade page when you are working a section
through an assignment. They write the same grades the same way.

Past six assignments the boxes collapse back into one summary — *Grade assignments* — which opens
the Grade page with the assignment picker empty. Six named assignments is a worklist; sixteen is
wallpaper.

**A box counts everything on that assignment still waiting on you** — work you have not graded and
AI-suggested grades you have not finalized alike, since both are cleared the same way and in the
same place. There is no separate "review the AI" box: a suggestion is not a grade until you say so,
and it is counted here from the moment the deadline passes, which is the first moment finalizing it
is the right thing to do. Before the deadline nothing appears, deliberately — students can still
revise, so there is nothing to finalize yet.

*(Before 2026-07-27 there was one box for all of it, and it landed on an empty picker: the count
told you there was work and not where. A second, AI-only box existed until 2026-07-29; it counted a
subset of this one and sent you to the same page.)*

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

**Once you change one, the control shows both states**: what the answer was, an arrow, and what it
will become. Only the right-hand one is selectable, and it keeps cycling. Cycling back to where you
started collapses it to a single state again, because there is then no change to show.

Nothing is written until you save. A banner stays at the top of the page counting the changes you
have not saved yet, and leaving the page — or switching assignment or section — asks first.

## Filtering by color

Three lamps above the list — green, yellow, red — control which answers you see. A lit lamp shows
that state's answers; select it to dim the lamp and hide them. Each lamp also shows how many answers
are currently in its state.

All three start lit. Dim green and yellow to work only the red answers, or dim green alone to review
just what the AI flagged. A student drops off the list once every one of their answers is hidden.

**Re-scoring an answer does not remove it from the view.** The lamps filter on the state each
answer was in *when the page loaded*, so working through the red answers and turning one green
leaves it exactly where it was, now showing the change. The lamps re-settle on the next load —
which is the point at which the set you chose to review is genuinely out of date.

*(Until 2026-07-30 the filter tracked the live state, so resolving an answer made the card vanish
under your cursor — along with the answer you had just read and not yet saved.)*

## AI-suggested scores

Scores written by the analysis run arrive **unfinalized**. They are a first pass, not a decision:
review them, change anything you disagree with, then finalize. Students see nothing until you do.

Suggested feedback is editable. If a yellow flag is wrong, clear the feedback and set it green.

A card tagged **AI suggested** has not been edited by anyone. Editing any question on that card
marks it as yours; cards you never touch keep the AI's authorship, which is what lets your director
see how much of a section has actually been reviewed.

A card tagged **Not yet graded** has no grade at all, and saving will not create one for them. To
grade them, set their questions yourself.

**A student who submitted nothing is scored zero, not left blank.** Since 2026-07-30 the analysis
run writes a zero — no points, understanding 0, feedback *No submission received.* — for anyone
past their own deadline who handed nothing in and holds no active extension. Like every other AI
score it arrives unfinalized, so you can change it, and the student sees nothing until you publish.
Before that change those students had no row at all, so the gradebook showed a dash while already
counting them as a zero in the total — a number nobody could reconcile.

**A student holding a live extension is never zeroed**, which is what makes the extension work: if
they submit later, the next run replaces the zero with a real grade. If you have already published
the column, reopen their grade first — from this page, or from the Grade button on their own page.

## Three kinds of card

Which card a cadet gets depends on the path they are actually being graded on, not on the
assignment alone. A short line above the cards says how the roster splits, so the counts on screen
can be reconciled against the roster.

**The written card** — the question rows described above. Shown to anyone who submitted written
answers, and to everyone on a free-response-only lesson.

**The interactive card** — shown to a cadet whose grade comes from the lesson report. It carries no
questions, because there are none to mark: the whole grade is one number. It shows the effort the
lesson measured and links to the full report.

**The no-submission card** — shown to a cadet who has committed to nothing. On a lesson where the
interactive path is required, that is most of the roster until the deadline nears, and it is not an
error.

*(Until 2026-08-21 there were only written cards. A cadet on an interaction-required lesson who had
not yet submitted got a full set of written questions stamped red **No credit** — for questions
that carry no credit for them, before their deadline had even passed. On the first such lesson that
was about 157 of 169 cadets. Before that, from 2026-07-27, interactive takers were dropped from the
page entirely, which replaced the wrong card with no card and no way to adjust the grade.)*

## Grading the interactive and no-submission cards

Their grade comes from **effort**, scored 0–5 from the lesson report: 0 earns no points, 1–2 earns
**one point**, 3–5 earns **whatever the assignment is worth**. Full credit scales with the
assignment; partial credit is the same single point on a 2-point preflight and on a 3-point one. A
reading reflection that is not meaningful caps effort at 2 — so at that one point — regardless of
engagement elsewhere.

**That grade is automatic.** It is written the moment the student commits, from the report, and the
student sees it immediately — no review step, nothing for you to publish. The effort rule is
arithmetic rather than judgement, so holding it back would delay a grade nobody was going to change.
Interactive takers are likewise absent from your *Needs grading by hand* row.

**You can still override it.** Both cards carry a points control that cycles **0 → 1 → full
credit**, and the note box beneath it is shown to the cadet. Overriding replaces the automatic score
with yours and marks the grade as instructor-authored, so a later re-submission cannot overwrite it.
What the lesson *measured* is left alone: the effort figure the charts and the rollup read is
unchanged by a points decision, because a grading judgement should not silently move a measurement.

**The no-submission card can be graded too**, and awarding credit is the case it exists for — a
cadet whose upload failed, or whose submission was lost, can be given full credit without inventing
a written submission for them. A card nobody has touched shows **— not graded** and writes nothing:
opening a lesson and clicking Save does not create grades for cadets you never looked at.

**Withholding credit needs a reason.** The note is the only feedback these cards can carry, since
there are no per-question comments on them, and a cadet dropped to 0 with no note is told nothing.

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

**Publishing full credit also settles the effort question.** The AI caps a student's effort rating
at 2 when it judges their reading reflection wasn't a real attempt — but on a written preflight
that cap costs nothing, because points come from the questions and yellow is still full credit. So
a student could sit under a **Reflection capped** flag on the Report tab while holding every point
the assignment was worth. When you finalize with full credit on every question that carries points,
that contradiction is resolved in the student's favour: an effort below 3 is raised to 3, and the
flag clears. It never lowers an effort, never goes above 3, and never touches a student who lost
points somewhere. The AI's original reading is kept on the record — this notes that you overrode
its consequence, not that it never happened.

**That includes an effort of 0**, which matters when you are correcting a zero rather than
confirming a low score. The AI also writes 0 for every student it found no work from once the
deadline passed — so a 0 can mean "nothing was handed in" *or* "nothing reached us", and those
look identical on the record. If a submission went missing and you award the points back, publishing
that full credit now lifts the effort with it, instead of leaving the student in the low-effort band
on the strength of work the site had already lost. *(Zeros were excluded until 10 August 2026, on
the reasoning that full credit cannot retroactively assert participation. That is a fair reading of
a zero the student earned, and the wrong reading of one the system caused.)*

Understanding ratings are **not** raised, and neither is the **Needs follow-up** flag cleared. Full
credit on a preflight is a statement about engagement — yellow is full credit precisely because the
answer can be wrong — so it settles effort and nothing else.

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
student commits, so there is nothing *owed*. Their card is still on the Grade tab if you want to
override the score (see above); the queue lists work waiting on a human, not work you may revisit.

Each card says what state the work is in — *no grade yet*, *AI suggested, unreviewed*, or *draft
saved* — so you can tell what you are walking into before you select it.

## Extensions

A per-student extension overrides the deadline for that student on that assignment, and takes
precedence over everything else.

Granting one **requires a reason**. Your course director sees every extension in the course on
**Course administration → Extensions**, grouped by who granted it and with a count — the reason is
what makes that count a conversation rather than a number. *(That report was its own page and its
own navigation entry until 2026-07-30.)*

**If the cadet already has a published grade, granting a future extension re-opens it**, and you
are told so when it happens. This is not an extra step you can skip: a published grade outranks
the deadline on every screen a cadet sees, so an extension granted over the top of one used to
move a date nothing looked at — the extension showed up on your page and on the director's
report, and the cadet stayed locked out. Re-opening also **hides their score until you finalize
again**, so finish the grading you re-opened.

Two cases deliberately leave a published grade alone, because neither can mean *let them work*:
a **back-dated** extension, which forgives lateness that has already happened rather than giving
anybody time; and a cadet who has **already submitted**, where the work is in and the extension
is usually clearing a late flag. If you do want a cadet to redo work they turned in, use
**Reopen** — throwing out a graded submission should be a decision you make on purpose.

**Remove** erases an extension, and is meant for a genuine mistake such as granting it to the wrong
cadet. It stops working once the student has submitted under it: withdrawing a deadline after the
work is in would only turn an on-time submission into a late one. If you need to pull an extension
back rather than correct an error, that is your director's call — they revoke it, which keeps it on
the record with their reason attached.

Otherwise each section's deadline falls the night before that section meets, at the hour your
course director has set — **2359 for both Physics 215 and Physics 110** — and is resolved in three
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
one recommended thing to cover, and a few student responses worth reading aloud. It is
intended as a five-minute read before you teach the lesson.

**Reach it with Rollup** on any assignment card on the Assignments page, or from your dashboard's
carousel. The button is disabled on a draft assignment: nobody can have submitted to one, so there
is nothing to summarize.

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

### Clearing a flag that does not apply

The pills along the top count students the AI flagged. Click one to list them, then a name to see
that student's summary. **Two of those flags you can overrule from there:**

| Flag | Control | Reason |
|---|---|---|
| **Inappropriate resources** / **Integrity concern** | **Not an issue** | Required |
| **Needs follow-up** | **Not an issue** | Optional |

The AI is applying a rule it was given, and it does not know your class. A cadet flagged for
inappropriate resources may simply have run the preflight twice because she wanted to understand it
better — which is a good thing, and not what the flag is for. You are the one who knows that, so
the pill has to be clearable. Otherwise the first flag that is wrong about somebody teaches everyone
to ignore the rest.

Clearing one **removes that student from the pill's count**, so the cohort numbers reflect your
judgement rather than the AI's first pass. It changes nothing about their grade, their points, or
their understanding rating.

**A reason is required for an integrity flag**, for the same reason one is required to grant an
extension: this is the kind of decision someone will want the story behind, months later and
possibly from someone else's account. The follow-up flag is a nudge rather than a finding, so its
reason is optional.

**Nothing is erased and nothing is final.** The AI's original reading stays on the record — the
panel shows what the flag was and who cleared it — and **Restore** puts it back. Every clear and
every restore is logged against the grade.

Two flags are deliberately *not* clearable here. **Notable** is a compliment, and **Reflection
capped** already clears itself when you publish full credit (above) — giving it a second, manual
switch would mean two different things could set the same pill.

One limit: the decision is recorded on the student's grade, so a student whose work has not been
graded yet has nowhere to put it. The panel says so instead of offering a button that would fail.

**There are two response panels, and they answer different questions.** *Student Reading
Reflections* is what the class made of the reading — this is the one the AI picks showcase quotes
from, marked **AI pick** and pinned at the top. *Student Free Responses* is what they wrote for the
lesson's own physics question, with **the question and any figure printed above it** so you can see
what they were answering. That second panel has no AI picks — nothing has argued for one — so it is
a straight random sample, and it is absent entirely on an assignment with no written half.

**Show all** on either panel switches from the sample to every response in the section, with any AI
picks still at the top — useful when you are looking for a particular student rather than something
to read aloud. Both hide names by default and both let you select responses and copy them for
slides.

**Select all shown** ticks every response currently on screen, and turns into **Clear selection**
once they all are. It follows what is displayed, not what exists: in the sampled view that is the
handful of cards in front of you, so reach for **Show all** first if you want the whole section.
Switching to Show all, or shuffling the sample, starts the selection over — turning names on does
not, so you can select first and decide about attribution afterwards.

**Both panels fill as soon as students submit** — you do not have to wait for grading to read what
the class wrote. What grading adds is the AI's reading of it: the **AI pick** quotes at the top of
the reflections panel, and the flags and ratings elsewhere on this page. One consequence worth
knowing — a reflection the AI later judges was not a real attempt drops out of the panel, so the
count can fall slightly once grading lands. That is the filter doing its job, not responses going
missing.

The AI panels above them — the readiness summary, the recommendation and the misconception bars —
appear once the assignment has been graded *and* aggregated, which happens after the deadline for
that section, so a section whose deadline has not passed yet will still show placeholders.
