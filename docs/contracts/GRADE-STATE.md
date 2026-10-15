# Grade state: who wrote a grade, and whether a human has confirmed it

**Status:** contract. Point-in-time record of `app.grades` state semantics as of 2026-10-15.
Deliberately not indexed in `docs/DOC-SOURCES.json` (see that file's `_comment`).

A row in `app.grades` carries two independent facts: what the score is, and how far it has
travelled through review. The second is not a status column — it is encoded across three
fields that move together. Reading any one of them alone gives the wrong answer, and this
document exists because that mistake has been made.

## The lifecycle

| Stage | `source` | `is_finalized` | `graded_by` |
|---|---|---|---|
| AI writes a suggestion (`preflight-analyze`) | `ai_suggested` | `false` | `NULL` |
| A human confirms it in the admin panel | `ai_suggested` | `true` | the confirming instructor's id |
| The interactive (iPREP) path scores deterministically | *(unset)* | `true` | `NULL` |

`is_finalized` defaults to `false` at the schema level, so a `true` is always something that
was set deliberately. The nightly cycle never sets it: `/lesson-cycle` writes unfinalized
suggestions and records `skipped_finalized` in its `analysis_runs.detail` for rows it left
alone, because instructors confirm in the admin panel.

**`is_finalized=true` together with a non-null `graded_by` is the signature of human review.**
It is the strongest positive evidence in the table that a person looked at a grade. It is not
evidence of the opposite, and it is not the automation overstepping.

The third row is the exception worth remembering: the interactive path produces finalized
grades with **no** `graded_by`, because nobody confirmed them individually — the artifact
scored them deterministically. So `graded_by IS NULL` does not imply unreviewed either.

## Reading the timestamps

`created_at`, `graded_at` and `updated_at` separate the automation from the human.

- A row written by a run has `created_at` and `updated_at` equal to the second, and a
  `graded_at` a few seconds earlier (the grading pass, not the write).
- A human confirmation shows up as `updated_at` moving **after** `created_at` while
  `graded_at` stays put. A bulk "finalize section" lands dozens of rows inside one second.

Compare `updated_at` against the wrapper's own `finished rc=` line in
`~/.local/state/prep/lesson-cycle-<date>.log`. Anything after that timestamp is not the run.

## The counting trap

**Do not measure review state by grouping on the date a grade was written.** Finalization
accrues for as long as instructors keep working, so an older lesson always looks more
finalized than a recent one — not because anything differed about the run, but because it has
had more days of review. Grouping "finalized as of now" by write-date produces a clean
downward trend that looks like a regression and is an artifact of age.

On 2026-10-15 this produced a false alarm: `preflight-17` (written 09-25) showed 194 of 195
finalized against `preflight-24`'s 33 of 146 written minutes earlier, read as a shrinking bug
affecting ~1,100 grades. There was no bug. The older cohort had three weeks of review and the
newer one had three minutes.

To ask what a *run* did, constrain to rows it created and ignore later edits:

```sql
SELECT g.is_finalized, count(*)
  FROM app.grades g
 WHERE g.created_at = (SELECT max(created_at) FROM app.grades
                        WHERE assignment_offering_id = :offering)
   AND g.updated_at <= g.created_at + interval '2 seconds'
 GROUP BY 1;
```

To ask what *humans* have confirmed since, invert the `updated_at` predicate.

## Worked example — 2026-10-15, phys-215 `preflight-24` M

The recovery run wrote 146 grades at `05:53:37` and the wrapper exited at `05:56:01`. All 146
were created identically and unfinalized. Thirty-three rows — every cadet in M1C and M3C, and
only those — then showed `updated_at` of `05:56:50`–`05:56:51`: thirty-three rows in about one
second, forty-nine seconds after the automation had already terminated. The sections' director
had bulk-confirmed their own two sections. Thirty-one carried that director's id in
`graded_by`; the two that did not were no-submission zeros, which the bulk action finalizes
without stamping a grader.

Working as designed, start to finish.
