# Work committed to a dropped enrollment is invisible to grading and is scored zero

**Status:** Verified — §6.1 and §6.2 shipped 2026-08-13; §6.3 (RLS, DDL) and §6.4 outstanding

*Found 2026-08-13 by Matthew Recker (via Claude) during the nightly lesson-cycle run for phys-110
`preflight-03`. One affected cadet was repaired by hand the same night. **Verified independently
2026-08-13** by a second operator against the live database (read-only, `prep_app_read` +
`pg_policies`); §4's open questions are now answered and §8's falsifiers all cleared. See
[`README.md`](README.md) for what a finding is and the no-PII rule that governs this file.*

> **No student identifiers appear below, deliberately.** The affected rows are found by running the
> query in §5, which stays correct as the roster changes. If you need the specific records from the
> 2026-08-13 incident, ask the course director — they are not in this repo and must not be added
> to it.

---

## 1. The defect

A cadet who changes sections can end up holding **two enrollment rows** — the old one `dropped`,
the new one `active`. PREP's roster queries filter `status = 'active'` everywhere, but its RLS
write policies do **not**. So a cadet can commit a preflight against the *dropped* enrollment,
where:

- **no analysis run will ever see it**, on either day track, because every roster query filters to
  active enrollments;
- **no instructor can see it**, because every faculty loader filters the same way;
- **the cadet cannot see it either**, because `auth.js` filters the same way;
- and `/preflight-analyze` then scores the *surviving* enrollment **zero for non-submission**,
  correctly by its own five conditions, because that enrollment genuinely has no submission
  attached.

An instructor finalizes the zero, and the cadet is permanently scored zero for work they completed
and submitted on time. Nothing anywhere reports a problem. **This is silent, and it survives every
existing check.**

## 2. The failure chain

Four independent links. Breaking any one of them prevents the outcome, which is why §6 offers four
fixes rather than one.

1. **A section change produced two rows instead of a move.** PREP has a correct in-place move that
   updates `enrollments.section_id` and keeps the row — so the submission would have followed. This
   cadet did not go through it.
2. **RLS accepted a write to the dropped enrollment.** The submission was committed **19 hours
   after** that enrollment was dropped.
3. **Grading zeroed the survivor.** Locally correct, globally wrong.
4. **Nothing detected any of it.** It surfaced only because a human read a report and asked.

## 3. Verified — with what proved it

Everything in this section was confirmed by reading the file or running the query. Re-check rather
than trust; the point of a finding is that its reader does not have to take the finder's word.

**The RLS hole** — `supabase/migrations/app/002_rls.sql`:

| Line | What it says | Why it matters |
|---|---|---|
| 115–118 | `my_enrollments()` returns `SELECT e.id FROM enrollments e WHERE e.student_id = my_student_id()` — **no status filter** | the hole |
| 121–126 | `my_offerings()`, immediately below, **does** filter `e.status = 'active'` | the asymmetry is almost certainly unintended |
| 320–321 | `submissions_student_insert … WITH CHECK (enrollment_id IN (SELECT my_enrollments()))` | a student may INSERT against a dropped enrollment |
| 322–324 | `submissions_student_update` — same predicate, `USING` and `WITH CHECK` | and may UPDATE one |
| 315–316 | `submissions_own` (SELECT) — **also** `my_enrollments()` | **do not "fix" the function itself** — see §6.3 |
| 332–334 | `sa_own` on `submission_activities` — also `my_enrollments()` | same caution |
| 335–339 | `sa_student_write` on `submission_activities` — **`FOR ALL`**, `my_enrollments()` in both `USING` and `WITH CHECK` | *added 2026-08-13 from live `pg_policies`; this row is the answer to §4c.* The same hole, over INSERT, UPDATE **and DELETE** |

**The active-only filtering, which is correct and is not the bug** — `site/js/faculty-roster.js:85`
and `:308`, `site/js/auth.js:248`, and the faculty loaders in `faculty-grade.js`,
`faculty-data.js`, `faculty-admin.js`. A dropped cadet is meant to vanish from grading and cohort
numbers. The defect is that their *work* vanishes with them while their *grade row* does not.

**The correct move path exists** — `site/js/faculty-roster.js:133` moves a student between sections
within an offering by updating the enrollment in place.

**The import declines to auto-move an ambiguous case** — `site/js/roster-import.js:710`: a move is
treated as unambiguous **only** when the cadet holds exactly one active enrollment. A cadet holding
two is routed to an `ambiguous` bucket instead. *This is defensible behaviour that currently fails
quietly — see §6.4.*

**The grading step that writes the zero** — `/preflight-analyze` Step 4c fetches the roster as
`enrollments?…&status=eq.active`; Step 5 fetches submissions **by `enrollment_id`**; Step 9 zeroes
any enrollment meeting five conditions (active, past its own deadline, no active extension, no work
on either path, no pre-existing human grade). In the observed case all five read true.

**The grading queue is submission-driven** — `pastDueUngraded()` at
`site/js/faculty-grade.js:835-846` iterates submissions, skips drafts and finalized grades;
`site/js/faculty-tasks.js:147` renders the `to-grade` box from it. **Consequence: an affected cadet
appears in no queue at all** — there is no submission on the active enrollment to put them there.

**Scale, as of 2026-08-13**: across all 37 phys-110 Fall 2026 assignment offerings and 497
enrollments (26 non-active), exactly **one** submission sat on a non-active enrollment, and exactly
**one** cadet had that plus a zero on an active enrollment. **Isolated, not systemic — so far.**

> **Re-verified the same day across all three courses** (§4b): 1001 enrollments, 76 non-active,
> and **zero** submissions on any of them. Note the denominator — an unpaged read of `enrollments`
> returns 1000 and silently drops one row, which has already produced a wrong answer here once
> (CHANGELOG 2026-08-10). Both scripts shipped for §6.1/§6.2 page explicitly.

## 4. Was inferred — now ANSWERED (verified 2026-08-13, read-only, all courses)

*The four items below were open questions when this was written. They were settled the same day by
a second operator, against the live database rather than the migration files. The original wording
is kept beside each answer, because which of them was a guess is part of what a later reader needs.*

**a. How the two rows arose — answered, and it was NOT a one-off.**
*Was: "the new enrollment was created three days before the old one was dropped … inference from
two timestamps, nothing more."* It is in the repo, not in the timestamps: the roster importer
**used to drop-and-add**, and [`CHANGELOG.md`](../../CHANGELOG.md) 2026-08-10 records **40 cadets
holding two active enrollments** in one course across that weekend (25 pairs in phys-215, 17 in
phys-110). The header comment on [`site/js/roster-import.js`](../../site/js/roster-import.js#L695-L720)
describes the same thing and names the damage exactly: *"Dropping the old row and inserting a new
one would strand a term of work on an inactive enrollment."*

**The generator was systemic and is already fixed** — `sectionMoves()` shipped 2026-08-10 and
relocates the enrollment in place, so the cadet's work travels with them. That **inverts §6.4's
ranking**: it is now the *lowest*-leverage of the four, not the highest, because the path that
produced this at scale is closed. What remains there is defense against hand-written scripts and
REST inserts, which is real but is not the fire.

**b. phys-215 and phys-310 — answered: clean, and so is phys-110.**
*Was: "the scale query covered phys-110 only."* Across **all three courses**: 76 non-active
enrollments (26 phys-110 / 49 phys-215 / 1 phys-310) and **zero submissions of any status sitting
on any of them**. The §5 query returns zero rows everywhere. The 2026-08-13 repair cleared the only
case that existed. **Blast radius today is zero** — which is what makes this the right moment to
fix the mechanism rather than chase rows.

**c. `submission_activities` — answered: yes, and it is wider than `submissions`.**
*Was: "only its SELECT policy (`sa_own`) was read. Check before designing the migration."*
`sa_student_write` is `FOR ALL` — INSERT, UPDATE **and DELETE** — carrying `my_enrollments()` in
both `USING` and `WITH CHECK`. **The migration in §6.3 must repoint three policies, not two.**

**d. Client stale state — answered as far as it needs to be.**
*Was: "not investigated."* The client is already correct by design:
[`auth.js:248`](../../site/js/auth.js#L248) builds `ctx.enrollments` active-only at page load, and
every student write resolves `myEnrollmentIds(ctx)[0]`. So a write to a dropped enrollment 19 hours
after the drop means a **session or page open across the drop**, holding a `ctx` built before it.
Nothing to fix client-side; it confirms RLS is the missing backstop rather than a redundant one.
**But it changes what §6.3 must ship with — see the note at the end of §6.3.**

## 5. Detection query — run this first

Ship the query, not the rows. Adapt the course filter; this is the shape.

```sql
-- Submissions stranded on a non-active enrollment, where the same student holds an
-- active enrollment in the same offering that was scored zero.
SELECT s.id            AS submission_id,
       s.committed_at,
       e_old.status    AS stranded_enrollment_status,
       e_old.dropped_at,
       g.points_earned, g.is_finalized, g.diagnostic->>'no_submission' AS flagged_no_submission
  FROM app.submissions s
  JOIN app.enrollments e_old ON e_old.id = s.enrollment_id
  JOIN app.enrollments e_new ON e_new.student_id = e_old.student_id
                            AND e_new.status = 'active'
                            AND e_new.id <> e_old.id
  JOIN app.sections sec_new  ON sec_new.id = e_new.section_id
  JOIN app.assignment_offerings ao ON ao.id = s.assignment_offering_id
                                  AND ao.course_offering_id = sec_new.course_offering_id
  LEFT JOIN app.grades g ON g.enrollment_id = e_new.id
                        AND g.assignment_offering_id = ao.id
 WHERE e_old.status <> 'active'
   AND s.status = 'committed';
```

**Two limits, stated so nobody reads a zero as an all-clear:** it only finds transfers recorded as
a surviving non-active enrollment row — a **hard-deleted** old row leaves nothing to join — and it
only matches moves **within one course offering**, so a cross-*course* move is invisible to it.

> **Shipped 2026-08-13 as [`scripts/checks/orphaned_submissions.py`](../../scripts/checks/orphaned_submissions.py),
> and it asks a WIDER question than the query above.** The script drops the join to a surviving
> enrollment entirely and looks for *any* submission whose enrollment is not `active`, classifying
> afterwards by what the stranding costs (`ZEROED` → `zeroed-unfinalized` → `will-be-zeroed` →
> `graded-elsewhere` → `inert`). That closes the second limit — a cross-course move is found — and
> makes the first one the only remaining blind spot. Prefer the script; the SQL above is kept
> because it is what a reader can paste into a SQL editor without credentials.

## 6. Proposed fixes, cheapest first

Ranked by leverage ÷ cost. **1 and 2 need no DDL and can ship independently.**

> **Status 2026-08-13: 6.1 and 6.2 are SHIPPED. 6.3 and 6.4 are not.** The ranking below was
> written before §4 was answered; **§6.4 has since moved from first to last** among the remaining
> work, because the drop-and-add path that produced this at scale was already closed on 2026-08-10.

### 6.1 A detection script — do this one regardless of the others · ✅ **DONE 2026-08-13**

Wrap §5 as `scripts/checks/orphaned_submissions.py`: stdlib only, read-only, non-zero exit on a
hit, and wire it into the nightly `lesson-cycle` as a gate. It catches the outcome **however it
arises**, including the two cases §5 cannot cover once they are handled, and it needs no
authorization to build.

*Shipped wider than specified — see the note in §5 — plus `--course`, `--json` for the gate, and a
`[warn]` tier for cadets holding two active enrollments (the precursor state). Gated at
[`lesson-cycle`](../../.ai/skills/lesson-cycle/SKILL.md) Step 0.3. Covered by
`scripts/checks/orphaned_submissions_test.py`, which reconstructs this incident from fixtures and
asserts the gate **fails** on it — a detector whose failing path is never exercised is an
assumption, and against the live database this one now correctly returns zero findings forever.*

### 6.2 A sixth condition in `/preflight-analyze` Step 9 · ✅ **DONE 2026-08-13**

Before writing a non-submission zero, check the student has **no committed submission on any
enrollment for this offering** — not just the active one. If one exists, **refuse and flag** rather
than zero. No DDL. This stops the damaging write at the one point that already holds every fact
needed to decide, and it protects against paths nobody has thought of yet.

*Shipped in **two** places, which this section did not anticipate:
[`preflight-analyze`](../../.ai/skills/preflight-analyze/SKILL.md) Step 9 (the live path) **and**
[`scripts/fall2026/zero_non_submitters.py`](../../scripts/fall2026/zero_non_submitters.py), which
implements the same five conditions independently for assignments graded before the rule existed.
Both now carry a header saying change one, change both. The condition also refuses on a stranded
**draft**, not just a committed submission — §8 names a stranded draft as a signal to re-diagnose,
which cannot happen if the run has already zeroed it. Counted as `stranded_skipped` in
`analysis_runs.detail`, and any value above 0 closes the run `partial`.*

*Two defects were found in `zero_non_submitters.py` while adding the condition, and both are
fixed: it carried **no `Accept-Profile: app` header**, so every query 404'd with PGRST205 and the
script could not run at all; and its `get()` did not page, so any query crossing PostgREST's
1000-row cap would silently truncate — in a script that searches for the ABSENCE of work, a
truncated page reads as "they handed in nothing" and writes a zero.*

### 6.3 Close the RLS hole — the root cause, and the one with a trap in it

**Do not add `status = 'active'` to `my_enrollments()`.** That function also backs the *read*
policies `submissions_own` (315) and `sa_own` (332), so filtering it globally would **hide a
dropped cadet's own past work from them** — a new bug, quieter than this one.

The correct shape is a new `my_active_enrollments()` used by **the write policies only**, leaving
every SELECT policy untouched. §4c settles which policies those are — **three, and the third is
the one to be careful with**:

| Policy | Command | Change |
|---|---|---|
| `submissions_student_insert` | INSERT | → `my_active_enrollments()` |
| `submissions_student_update` | UPDATE | → `my_active_enrollments()`, both `USING` and `WITH CHECK` |
| `sa_student_write` | **`FOR ALL`** | → `my_active_enrollments()`. **Recommend replacing the `FOR ALL` with explicit INSERT/UPDATE/DELETE policies** rather than narrowing it in place: `FOR ALL` also covers SELECT, so today a dropped cadet's reads survive only because permissive policies OR together and `sa_own` still uses `my_enrollments()`. That is correct and completely invisible — the next reader who drops `sa_own` as "redundant" breaks reads with nothing failing until a dropped cadet opens their own history. |
| `submissions_own`, `sa_own` | SELECT | **untouched.** This is the trap above. |

Next migration number in the `app` chain is **`020`** (the chain runs 001–019; `023` in
`supabase/migrations/` is the *`public`* chain and is unrelated).

**Ship it with a client-side companion, or it trades a silent failure for a louder one.** §4d
establishes the entry path is a session open across the drop. Post-fix, that cadet's submit is
**refused by the database** instead of silently stranded — the right outcome only if the page tells
them their enrollment changed and to reload, without discarding what they typed. A cryptic failure
on a submit button loses the work outright, which is worse than the defect for that one cadet.
Check what `site/student/` does with a 403 from `submissions` before this lands.

**Add a regression test.** [`supabase/admin/app_rls_test.py`](../../supabase/admin/app_rls_test.py)
already has the persona harness (it `SET ROLE`s to `authenticated` with a simulated JWT, so the
policies genuinely apply, and rolls everything back). The assertion is two-sided and both halves
matter: a persona holding a dropped enrollment **can still read** their own past work there, and
**cannot write** to it.

**This is DDL on `app`.** It goes to the course director as reviewed migration SQL in
`supabase/migrations/app/`, with a `_ROLLBACK.sql` beside it, and is applied as a coordination
event under CORE.md §0. **No agent applies it alone**, and the open seal is not permission.

### 6.4 Stop the two-row state from arising — **§4a answered; this dropped to last**

*This section assumed the two-row state might be a live registrar-import pattern. It was — and it
was fixed on 2026-08-10, before this defect was found. Both candidates are now defense in depth.*

- **The `ambiguous` bucket is already surfaced** — [`site/faculty/admin.html:781-793`](../../site/faculty/admin.html#L781-L793)
  renders it during the import preview and points the operator at
  `repair_duplicate_enrollments.py`. So the original wording, "rather than a silent skip", is
  wrong. What is true is that it is **transient**: it lives in the page's in-memory `staged` object
  and is gone on completion or reload, so an operator who clicks past it has no way back to the
  list. Making it a persistent dashboard task is a small, no-DDL improvement — **not** the missing
  surface this section implied.
- A **partial unique index** preventing two active enrollments for one student in one offering.
  **Verified 2026-08-13: zero violations exist today in any course**, so it would apply cleanly
  with no data cleanup — and it *would* have prevented this case, because the two rows overlapped
  as both-active for three days before the old one was dropped. It still forecloses any legitimate
  reason to hold two, which nobody has identified. **The course director's decision, 2026-08-13:
  include it**, in the same batch as §6.3 — the DDL ceremony is per-batch, so a second event later
  costs more than the index does.

## 7. What is authorized, and what is not

*Updated 2026-08-13. The first bullet no longer holds and is kept struck through, because "nothing
has been implemented" is exactly the kind of line that gets read months later and believed.*

- ~~**Nothing in §6 has been implemented.** The course director asked explicitly for the write-up
  only, and will start a repair operator separately.~~ → **6.1 and 6.2 shipped 2026-08-13**, at the
  director's instruction, after the verification pass in §4. **6.3 and 6.4 remain untouched.**
- **6.1 and 6.2 are ordinary changes** — build, test, and put them up for review like any other.
- **6.3 and the index in 6.4 are DDL** and require the director. Deliver SQL and a rollback; do not
  apply. **The director has decided the index is in scope** for that batch (§6.4).
- **The already-repaired cadet is done.** Do not revisit that record.
- **Do not "fix" other affected rows by re-running grading.** See §8 — the obvious sequence makes
  it worse.

## 8. How you would know this diagnosis is wrong

Concrete falsifiers. Any one of these means stop and re-diagnose rather than proceeding to §6.

**All four were tested on 2026-08-13 and none fired.** They are kept as written — a falsifier that
is deleted once it passes cannot be re-run by the next reader, and §6.3 has not been applied yet.

- ~~**`my_enrollments()` turns out to be status-filtered in the live database.**~~ **Checked
  against `pg_proc` / `pg_policies`, 2026-08-13: it is NOT filtered.** The live function is
  byte-identical to `002_rls.sql:115-118`, and `my_offerings()` beside it *does* filter — the
  asymmetry is real and applied, not just intended. The reasoning stands for whoever writes the
  migration: the file is the intended state, not necessarily the applied one, `app` has been under
  continuous revision, and its seal has been open since 2026-07-23 (CORE.md §0). **Re-read the live
  policy immediately before writing the migration** — this was verified on the day the finding was
  filed, not on the day §6.3 ships.
- ~~**The §5 query returns rows whose stranded submission is a `draft`.**~~ Zero rows of any status
  in any course. The severity distinction still matters, so the shipped detector classifies by it
  rather than collapsing everything into one bucket.
- ~~**The affected cadet's active enrollment predates the dropped one being dropped by minutes
  rather than days.**~~ Three days, and §4a establishes the mechanism from the repo rather than
  from the gap: the importer used to drop-and-add, at a scale of 40 cadets in one weekend.
- ~~**The count from §5 rises sharply on a re-run.**~~ It went to **zero and stayed there** —
  0 stranded submissions across all three courses on the re-run. §6.2 shipped anyway, because a
  count of zero is a statement about today and the mechanism was untouched.

**One falsifier remains live, and it is the one that would matter most.** If
`scripts/checks/orphaned_submissions.py` starts returning `will-be-zeroed` findings on a course
whose roster has not been re-imported, then something other than drop-and-add is creating the
two-row state, §4a is wrong, and §6.4 needs re-deciding before §6.3 is worth applying.

**A trap worth naming, because it is the sequence a careful operator would reach for:**
unfinalizing an affected zero and re-running `/preflight-analyze` **re-zeroes it**, because the
submission is still attached to the dropped enrollment. The submission must be repointed *first*.
Left alone, `/preflight-analyze` skips the row entirely (guard 1 protects finalized grades) — so
the wrong order is strictly worse than doing nothing.

## 9. House rules the repair operator must follow

Not optional, and not restated in full here — read the sources.

- **`.ai/instructions/CORE.md` is authoritative**, especially §0 (shared live database, the
  coordination gate, no unilateral DDL, snapshot-first destructive ops) and §5 (CHANGELOG, push
  only when asked).
- **Read `.ai/skills/safe-change/SKILL.md` before any hard-to-undo change**, including a bulk
  update.
- **Every DB-mutating script is idempotent and dry-run by default**, requiring an explicit
  `--commit`.
- **Student text and identifiers stay out of the repo** — scratchpad only. This file's own no-PII
  rule applies to anything you add here.
- **Update this file's Status line** as it moves, and log the fix in `CHANGELOG.md`.
