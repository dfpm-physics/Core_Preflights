# Grade rules — how PREP computes a course total

**Status:** accepted, 2026-11-04. Not yet implemented; the database function that applies these rules is
designed in the v2 data-model decision and built later.

*Authored 2026-11-04 by Matthew Recker (via Claude). Companion to [`V2-SCOPE.md`](V2-SCOPE.md). See
[`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** Read it before writing any code or SQL that adds up, rounds, ranks, or
> letter-grades a student's work. It records the rules the course director set, and why. It is a
> point-in-time record: if a rule changes, supersede this file with a new one and link both ways.

---

## 1. Problem

PREP will hold every graded item for a class, not only preflights. Students, instructors, exports and
reports must all show the same total for the same student. That needs one written set of rules before
any total is computed, and one place in the database that applies them.

## 2. Goals and non-goals

**Goals.** One rule set. Exact arithmetic. Rules an instructor can state in one sentence each.

**Non-goals.** Weighted categories. Rounding. Curving. Deciding what a Prog or Final report looks like
(that waits on the report copies the course director will supply).

## 3. The rules

| Rule | Decision | Reason |
|---|---|---|
| Method | Plain points: earned divided by possible. No weights. | One rule that every instructor can check by hand. |
| Bonus | Adds to earned only. A grade can pass 100%. | Bonus work should not shrink what other work is worth. |
| Prog contents | A yes or no flag on each assignment, set by the instructor. | The Prog set and the Final set can differ. |
| Excused | The item leaves the total. **Only the Course Director can set it.** Enforced in the database. Who set it and when are logged. | Excusing changes a student's total, so it is restricted and auditable. |
| Missing | Counts as 0. If late work arrives, its grade replaces the 0. | Missing is a state, zero is a score, and arriving work fixes the record. |
| Ungraded | Left out of the official total. Shown as a backlog on the instructor's page. | A total should not move because grading is behind; the backlog makes the gap visible. |
| Late work | **Accepted, and marked late in an obvious way.** No automatic point loss; the instructor can adjust. Last date: the last class day of the term. | Late policy is the instructor's call; the system only shows it. |
| Late toggle | Set at assignment creation. New assignments allow late work. **Current preflights stay refused,** with the toggle available on each. | Keeps today's preflight behavior unchanged. |
| Letter scale | Default: A 93, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73, C- 70, D 60, F 0. GPA: 4.0, 3.7, 3.3, 3.0, 2.7, 2.3, 2.0, 1.7, 1.0, 0.0. **The Course Director can change it.** | A default that matches the usual scale, with one named person able to change it per course. |
| Rounding | **None.** | A rounded total hides which side of a line a student is on. |
| Near-line flag | Within **0.1 below** a line. A cutoff of 90.0 flags 89.9, and does not flag 89.89. The Course Director can change the width. Staff see it; students never do. Show who would change before a line moves. | Lets an instructor look at borderline students without a student seeing a "nearly" label. |
| Rank ties | Higher raw points wins. If still tied, flag it, and the Course Director picks same rank or alphabetical for that group. | The tie-break that cannot be decided by data is decided by one person. |

### Who decides

| Setting | Who can change it |
|---|---|
| Excused | Course Director only |
| Letter scale | Course Director |
| Near-line width | Course Director |
| Rank tie handling for a group | Course Director |
| Prog flag on an assignment | The instructor |
| Point adjustment on late work | The instructor |

Nothing else is assigned to a named role by this decision.

## 4. Arithmetic

Use exact decimal math for every step: totals, percentages, comparison to a cutoff, near-line width,
and ranking. Never floating point. In the database that means `numeric`; in browser code it means an
integer or decimal-string approach, not `Number` division.

Boundary example. With a cutoff of 90.0 and a width of 0.1:

- 89.9 is flagged. It is within 0.1 below the line.
- 89.89 is not flagged. It is more than 0.1 below the line.
- 90.0 is on the line, so it earns the higher letter and is not "below" it.

Because nothing is rounded, a stored 89.89 stays 89.89 at every stage, and the flag compares exact
values.

Tests must cover the boundaries: 89.9 and 89.89 at a 90.0 line, a bonus-only item, zero points possible,
fractional scores, and ties.

## 5. Options considered

- **Weighted categories.** Rejected: every extra weight is a place for two surfaces to disagree, and
  the course director asked for plain points.
- **Rounding totals to one decimal.** Rejected: it would flag or hide students on the wrong side of a
  line and make the near-line flag meaningless.
- **Excused settable by any instructor.** Rejected: it changes a student's total, so it is gated and
  logged.

## 6. Confirmation — how we would know this was wrong

**Signal:** the course director, or a department policy, requires weighted categories or rounding at
Prog or Final; or an approved report copy disagrees with a total this rule set produces for the same
student.

**Threshold:** one confirmed disagreement on an approved report.

**Consequence:** this file is superseded by a new decision, and the single database total function is
changed in one place.
