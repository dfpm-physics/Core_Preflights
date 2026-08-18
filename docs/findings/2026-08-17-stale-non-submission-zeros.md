# A non-submission zero is never revisited when the work arrives, and cohort analytics count it as real

**Status:** Open — partly superseded within hours of being written; see the update below

*Found 2026-08-17 by Matthew Recker (via Claude) while closing out phys-110 `preflight-04`. Nothing
was fixed; the M-day re-aggregation described in §7 is the only action taken. See
[`README.md`](README.md) for what a finding is and the name rule that governs this file.*

> **No cadet identifiers appear below**, and section codes are omitted wherever a single student
> would be identifiable in a ~20-person section. §5 carries the detection query, which stays correct
> as the term moves. The specific records are available from the course director, out of band.

> **UPDATE 2026-08-17, same day.** Commit `acb61d0` **closed the submission path** while this
> was being written, so §1's "accepts a submission forever" and §6.1 are now historical — read
> §3 and §6.1 for what changed. **The core defect is untouched:** `acb61d0` does not modify
> `lesson_aggregate.py`, so §6.2 — the aggregator counting absence-zeros as
> comprehension-zeros — stands exactly as written, and the eight rows already carrying stale
> zeros still carry them.

---

## 1. The defect

**PREP accepts a submission forever, but only ever grades the roster once — at the deadline.**
Nothing reconciles the two. A cadet who submits after the nightly run keeps the zero it wrote,
and that zero then propagates into the cohort rollups as though it were an earned zero.

This is distinct from
[`2026-08-13-orphaned-submission-on-dropped-enrollment.md`](2026-08-13-orphaned-submission-on-dropped-enrollment.md),
and the fix for that one does not help here. There the work was *invisible* — attached to a dropped
enrollment. Here the work is attached correctly and is plainly visible; it simply **did not exist
yet** when grading ran. `/preflight-analyze` Step 9 condition 6 was added to refuse the orphan zero,
and it is working as intended — it cannot refuse this one, because at the moment of writing there
genuinely was no submission.

## 2. The failure chain

Four links. **Link 1 is deliberate design and should not be changed** — see §6.

1. **There is no close.** Submission stays open indefinitely after the deadline.
2. **Grading runs once**, at the deadline, and writes a `no_submission` zero for anyone absent.
3. **Nothing re-examines that zero** when the work later arrives. The cadet appears in the
   instructor's to-grade queue (their grade is unfinalized, and the queue iterates submissions), so
   an attentive instructor catches it — but an instructor clearing the column finalizes a zero over
   real work, and nothing warns them.
4. **The cohort aggregator counts it as a genuine zero**, silently depressing section and
   course-level effort and understanding means.

Link 4 is the one nobody had noticed, and it is the reason this is a finding rather than a ticket.

## 3. Verified — with what proved it

**There is no deadline enforcement anywhere in the stack.** Three independent checks:

| Layer | What it does | Where |
|---|---|---|
| Client commit path | ~~no date comparison at all~~ **CLOSED by `acb61d0`, 2026-08-17.** Both commit paths now re-fetch the deadline at submit time and refuse past due + `GRACE_MS` (120 s) | `site/js/student-data.js:348-383` |
| RLS | `002_rls.sql` mentions `due` five times, all of them policies **on the `assignment_due_dates` table itself**. No policy on `submissions` consults a deadline. **Still true after `acb61d0`**, whose own message says the DB trigger "is NOT here — it needs DDL and rides the next migration batch (ROADMAP P1.17)" — so the new rule is a UI rule, not a security boundary | `supabase/migrations/app/002_rls.sql` |
| Release window | `isReleased()` returns `at == null \|\| at <= now` — **a floor, not a window.** Once an assignment opens it never closes | `site/js/schema.js:691-694` |

**The system measures lateness rather than preventing it.** `submissionLateness()` and `lateBy()`
(`site/js/schema.js:588-605`) exist to render "4 days late", honour extensions, and — per their own
comment — stop a grader from *"silently giving both full credit"*. **Late submission is a supported
state, not an escape.**

**The aggregator ignores the flag that marks these rows.** `grep -c no_submission
supabase/admin/lesson_aggregate.py` returns **0**. The flag is written by `/preflight-analyze`
(`SKILL.md:886`, spec at `references/WRITTEN-SCHEMA1.md:186`) and *is* consumed elsewhere —
`scripts/checks/orphaned_submissions.py:201` and `scripts/fall2026/raise_confirmed_effort.py:275`.
**The one component that computes cohort means is the one that does not read it.**

**Observed magnitude, phys-110 `preflight-04` M, 2026-08-17:** 8 cadets across 4 of 9 sections held
an unfinalized `0.00` on a committed submission carrying real reflection *and* free-response text.
In the worst-affected section, 4 of 24 rows were zeros; its effort mean read **3.58** against
**4.30** recorded for the same section on 2026-08-14, before the late work arrived. **The rollup got
worse as more students did the work.**

**It recurs.** Same shape on `preflight-03` (2026-08-13, ~7 cadets) and `preflight-04` M
(2026-08-14, 8 cadets). Three lessons, three occurrences, in one week.

**A zero-valued `schema: 1` is a real payload, not an absence.** These rows carry `effort: 0`,
`overall_understanding: 0`, empty `objectives[]` and `misconceptions[]`. With no `no_submission`
check, the aggregator folds them in as data.

**One of the eight carried no `no_submission` flag at all.** Same all-zero diagnostic, flag absent.
**A repair keyed on that flag would silently miss it** — which is why §5 keys on `effort = 0`.

## 4. Inferred, NOT verified — resolve before acting

- **Why one row lacked the flag.** Unknown. It could be an earlier grading run predating the flag,
  a hand edit, or a distinct path. **Establish this before trusting any flag-keyed remediation.**
- **A cadet committed against an already-finalized grade.** In one section, an instructor finalized
  full credit on 08-14 and a commit landed on 08-15. Whether the written path is *supposed* to
  permit that is unresolved — `PROJECT.md` documents a no-overwrite rule, but for the **interactive**
  path (migration 015), and it is about reports, not commits. **Do not assume the rule covers this.**
- **Scope beyond phys-110.** Only phys-110 was examined. phys-215 and phys-310 are unchecked, and
  phys-310's ~12-cadet sections would be proportionally far more distorted by a single zero.
- **Whether instructors are finalizing these zeros in practice.** If they routinely catch them, the
  grade harm is small and only link 4 matters. If not, cadets are being permanently zeroed for
  completed work. **This determines the whole severity of the finding and nobody has measured it.**

## 5. Detection — key on `effort`, not on the flag

```sql
-- Grades scored zero-for-absence where the work arrived afterwards.
-- Keyed on diagnostic.effort = 0, NOT on no_submission: one observed row lacked the flag.
SELECT c.code AS course, a.slug, sec.code AS section,
       g.updated_at   AS graded_at,
       s.committed_at,
       s.committed_at - g.updated_at AS arrived_after,
       g.is_finalized,
       g.diagnostic->>'no_submission' AS flagged
  FROM app.grades g
  JOIN app.enrollments e  ON e.id = g.enrollment_id
  JOIN app.sections sec   ON sec.id = e.section_id
  JOIN app.course_offerings co ON co.id = sec.course_offering_id
  JOIN app.courses c      ON c.id = co.course_id
  JOIN app.submissions s  ON s.enrollment_id = e.id
                         AND s.assignment_offering_id = g.assignment_offering_id
  JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
  JOIN app.assignments a  ON a.id = ao.assignment_id
 WHERE s.status = 'committed'
   AND s.committed_at > g.updated_at
   AND COALESCE((g.diagnostic->>'effort')::int, -1) = 0
 ORDER BY g.is_finalized DESC, c.code, a.slug, sec.code;
```

**Sort finalized first — those are the ones already past saving by a re-run**, and they are the
population that needs a human decision rather than a script.

## 6. Proposed fixes

### 6.1 Closing the submission path — argued against here, shipped anyway the same day

**This section originally said "do NOT close submissions at the deadline."** It was overtaken by
`acb61d0` within hours, and the shipped answer is better than the one argued for here. Recorded
rather than deleted, because the reasoning is the part worth keeping.

The argument against closing was that late work is still worth having, that `submissionLateness()`
exists precisely to support it, and that extensions cover the legitimate cases. What it missed is
the case `acb61d0` names: **a tab left open across the deadline could commit while a fresh page
load correctly showed MISSED** — not a considered choice to accept late work, just two views of
the same rule disagreeing.

The shipped design keeps both properties: a **120-second grace** (`GRACE_MS`, `schema.js`) inside
`effectiveDue()`'s `isPast`, applied to every deadline source and to both zeroing copies (Step 9
and `zero_non_submitters.py`), with the due date itself never moving and the saved draft never
touched. Near-misses stay gradable; the open-tab loophole closes.

**Two things it does NOT fix, and they are why the rest of §6 stands:**

- **It is a UI rule, not a boundary.** No RLS policy consults a deadline, by the commit's own
  admission, so REST can still write a late commit until P1.17 lands the trigger.
- **Extensions still deliver work after the zeroing run, legitimately.** The population this
  finding is about keeps growing, just more slowly — and every row already in it is unchanged.

### 6.2 Teach the aggregator the flag — smallest change, clearest win

Exclude `no_submission` rows (or, more robustly, all-zero diagnostics) from the effort and
understanding means, and report them as a separate count. A cadet who handed in nothing is not
evidence about how well the cohort understood the reading; they are evidence about how many people
did it. **These are two different numbers and the rollup currently averages them together.**

No DDL, no grade writes, and it fixes the analytics independently of whether the grades are ever
repaired.

### 6.3 A sweep for stale zeros, wired into the nightly cycle

Wrap §5 as `scripts/checks/stale_zeros.py` — stdlib, read-only, non-zero exit on a hit — and run it
alongside `orphaned_submissions.py`, which your repair operator has already built and which is the
right pattern to copy. It catches the condition however it arises, including on tracks nobody is
re-running.

### 6.4 Re-grade before finalizing, as an operational rule

A `--day M` `/preflight-analyze` re-run regrades these rows correctly and cheaply. **Order matters:
it must happen before an instructor finalizes the column**, because a finalized grade is protected
by guard 1 and the re-run will skip it. `scripts/fall2026/raise_confirmed_effort.py` handles the
already-finalized-at-full-credit population, but it **requires `is_finalized`** and so does not
cover the unfinalized rows here.

### 6.5 Warn in the grading UI

Surface "submitted after grading" on a row whose `committed_at` post-dates its grade, so an
instructor clearing the queue cannot finalize a zero over real work without seeing it. This is the
only fix that helps when nobody runs anything.

## 7. What was done, and what is authorized

- **On 2026-08-17 the phys-110 `preflight-04` M-day aggregation was re-run** to refresh five stale
  section scopes, and `__all__` was written (n=436). **No grades were touched** — the course
  director explicitly directed that no re-grade take place.
- **That decision rested on a premise this finding disproves.** The stated reasoning was that a few
  unanalyzed students would be *excluded* and therefore harmless. They are not excluded; they are
  **counted as zeros** (§3). The direction of the error is the opposite of what was assumed:
  excluding them would have been harmless, and including them is not.
- **§6.1 was implemented by someone else the same day** (`acb61d0`), closing the submission path.
  **Nothing else in §6 has been implemented**, and 6.2 — the aggregator — is untouched by it.
- 6.2, 6.3 and 6.5 are ordinary changes. **None of §6 requires DDL.**
- The already-written rollups for `preflight-03` and `preflight-04` carry the depressed numbers.
  Whether to re-run and overwrite prose a director may already have read is **a human decision.**

## 8. How you would know this diagnosis is wrong

- **§5 returns nothing on a re-run.** Then the population was a one-week artifact, not a standing
  condition, and only 6.5 is worth building.
- **The aggregator turns out to filter zeros somewhere else** — a `WHERE` clause in the pull query
  rather than an explicit `no_submission` check. **`grep` proved the flag is unread; it did not
  prove the rows are unfiltered.** Read the pull SQL before writing 6.2, and confirm against a
  section whose mean is known to have moved.
- **Instructors are already catching these reliably.** Measure it: how many rows from §5 ended up
  finalized at a non-zero score without any script running. If most, this is an analytics bug only.
- **The observed mean shift has another cause.** The 4.30 → 3.58 comparison is across two runs with
  different cohort sizes; confirm by recomputing the mean with the zero rows dropped and checking it
  returns to ~4.3.

## 9. House rules the repair operator must follow

- **`.ai/instructions/CORE.md` is authoritative** — §0 (coordination gate, no unilateral DDL,
  snapshot-first, never force-push), §3 (no PII in committed files), §5 (CHANGELOG, push only when
  asked).
- **Read `.ai/skills/safe-change/SKILL.md`** before any bulk grade repair.
- **Every DB-mutating script is idempotent and dry-run by default**, requiring an explicit `--commit`.
- **Re-grade before anyone finalizes** (§6.4). The wrong order is not recoverable by a re-run.
- **Student text and identifiers stay out of the repo** — scratchpad only.
- **Update this file's Status line** as it moves, and log the fix in `CHANGELOG.md`.
