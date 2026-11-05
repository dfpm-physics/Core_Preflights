# PREP v2 scope — decisions that are closed, and the dates

**Status:** accepted, 2026-11-04. Decisions below are closed. Reopen one only by writing a new decision
that supersedes this file.

*Authored 2026-11-04 by Matthew Recker (via Claude). Companion to [`GRADE-RULES.md`](GRADE-RULES.md).
Roadmap detail is in [`../ROADMAP.md`](../ROADMAP.md) section 9. See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It stops settled questions from being reopened by each new operator. It
> records the scope, the dates, and the two-step cutover. It does not describe the data model; that is a
> separate design document.

---

## 1. The goal

All coursework for a class lives in PREP: homework, preflights, case studies, group projects, quizzes,
exams, and labs. Students answer online questions and get instant right or wrong feedback, and see the
full term schedule and all their grades and feedback. For in-person work, and for work submitted
through Gradescope or Teams, PREP holds the grade. Instructors see a gradebook and produce Prog and
Final reports.

## 2. Dates

| Date | What must be true |
|---|---|
| About 1 Dec 2026, **step 1** | Instructors can create courses and enter all seven work types on the real database. Students see no change. |
| 10 Dec 2026 | Fall classes end. |
| 21 Dec 2026 | Fall final grades due. No student-facing change before this. |
| After 21 Dec, before 6 Jan, **step 2** | Student schedule and grade list live. In-person entry and grade import live. Live-site changes ship in the step 2 batch. |
| 6 Jan 2027 | Spring term starts. |
| 6 Jan, or the first homework due date at the latest | Online homework works. |
| 8 Mar 2027 | Prog grades due. The Prog report works. |
| 24 May 2027 | Final grades due. The Final report works. |

Online homework has no fallback: the commercial homework services in use are going away, so PREP must
cover numeric homework from the first due date.

## 3. The two-step cutover

1. **Step 1 (about 1 Dec).** Add, do not replace. Every database change leaves the current site
   working, and this is proved by running the current site against the migrated staging database.
   Students see nothing new. Items entered in step 1 stay unpublished until step 2.
2. **Step 2 (after 21 Dec, before 6 Jan).** Student-facing pages, the grade list, imports, and the
   reviewed batch of changes go live together.

Step 1 is the same database, so a fallback exists: if the data model is not proven on staging at the
24 November check, instructors keep entering Fall-style work in the current version, list other work in
a spreadsheet, and import it once the staff pages are ready.

## 4. Closed decisions

| Topic | Decision |
|---|---|
| Live site | Live-site changes ship in the step 2 batch. |
| Cutover | Two steps, as above. |
| Database | Upgrade production in place. No second production database and no data copy. Staging is for building and testing only. |
| Authority | Grade storage is cleared with the registrar. The course director has no specific name or document to cite. See the 2026-11-04 note in [`STUDENT-DATA-CLASSIFICATION.md`](STUDENT-DATA-CLASSIFICATION.md). |
| Hosting | The primary database is on a paid Supabase tier. What that tier provides for backups is unverified until checked in the dashboard. |
| File submission | On hold. Students use Gradescope or Teams. PREP holds the grade. |
| Rewrite | None. Keep static pages, Supabase, and no build step. |
| Blackboard | Each course chooses. An export exists, and it sends one overall grade per cadet at Prog and at Final. |
| Exams | PREP holds the grade column, not the exam. No online exam engine or proctoring. |
| Gradescope | Stays for quizzes, exams, and labs. Results are imported into PREP. |
| Homework | The current commercial homework services are going away. PREP replaces them for numeric homework. |
| Gradebook home | **PREP, on Supabase.** The separate Django gradebook project is a specification and a comparison, not a part of the system. The roadmap's open question on this (V2.3) is closed by this decision. |
| Pilot | None. All courses move in Spring. Preflights keep their current path, and the separate gradebook project runs alongside PREP until the 8 March Prog so the two can be compared. |
| Grade rules | See [`GRADE-RULES.md`](GRADE-RULES.md). |

## 5. Rules for the build

- Add, do not replace, until step 2.
- No code branches on the kind of work; code branches on how it is delivered and how it is graded.
- Student pages on `v2` are not edited until step 1 ships; that work goes on a separate branch.
- Frozen URLs and slugs stay frozen: `site/student/interaction-submit.html`, `site/faculty/lessons.html`,
  and the artifact wire format.
- New work stays unpublished until step 2.
- One calculation: students, staff, exports and reports all read one database rule.

## 6. Options considered

- **A second production database for v2.** Rejected: it needs a data copy and a second cutover, and the
  existing database already holds the Fall term.
- **A rewrite with a build step.** Rejected: the no-build, static-page design is a standing constraint.
- **Adopting the Django gradebook as the home.** Rejected: two systems of record would disagree; it is
  kept as a spec and a comparison.

## 7. Confirmation — how we would know this was wrong

**Signal:** the 24 November staging check fails, or the course director says step 1 should slip.

**Threshold:** the data model is not proven on staging by that date.

**Consequence:** use the fallback in section 3, and record the slip in the changelog.
