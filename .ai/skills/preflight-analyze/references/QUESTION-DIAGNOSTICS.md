# Written-preflight question diagnostics

Read this file whenever `/preflight-analyze` scores a submitted written preflight. Produce exactly
two integer diagnostics. Store only the numbers; do not add them to feedback, `question_scores`,
`points_earned`, `points_possible`, the analysis report, or the printed per-student report.

Both values live in **one place**: the `diagnostic` jsonb on the enrolment's `app.grades` row
(`{"q2_effort": N, "q3_understanding": N}`). The old `scores.q2_effort` / `scores.q3_understanding`
columns belonged to the retired `public` schema.

## Q2 effort (`grades.diagnostic.q2_effort`)

Measure engagement with the reading-reflection answer, not correctness. Adapt the engagement rubric
from `docs/contracts/INTERACTION-DATA-CONTRACT.md` §5.2 to this single written response.

| Score | Evidence in the Q2 answer |
|---|---|
| 5 | Sustained, genuine engagement: specific and thorough discussion of what was confusing or interesting, with substantive explanation or connection. |
| 4 | Solid engagement with relevant specifics; only a minor lapse in development, clarity, or completeness. |
| 3 | Partial engagement: responsive and relevant but terse, vague, underdeveloped, or incomplete. |
| 2 | Minimal engagement: short, low-content, weakly responsive, or mostly tangential. |
| 1 | Token effort: a one-word dodge, nearly content-free answer, or mostly evasive/off-task response. |
| 0 | Blank, refusal, gibberish, entirely off-topic, or no substantive participation. |

Do not lower Q2 effort because the student's reflection contains incorrect physics. Score how
substantively the student engaged with the prompt.

## Q3 understanding (`grades.diagnostic.q3_understanding`)

Measure demonstrated physics understanding against `expected_response` and the configured textbook
reference. Correctness and reasoning both matter.

| Score | Evidence in the Q3 answer |
|---|---|
| 5 | Accurate, complete, and well-reasoned; addresses the central mechanism and all material parts with no substantive error. |
| 4 | Substantially correct and shows solid understanding; only a minor omission, imprecision, or reasoning gap. |
| 3 | Partial understanding: contains an important correct idea but is incomplete, weakly justified, or mixed with a limited conceptual error. |
| 2 | Struggling: a substantial misconception or mostly incorrect explanation, but some relevant correct idea or meaningful physics reasoning is present. |
| 1 | Minimal evidence of understanding: relevant terminology or a guess, but no coherent correct reasoning and major misconceptions dominate. |
| 0 | Blank, refusal, gibberish, entirely off-topic, or no assessable physics understanding. |

Keep this diagnostic independent of the three-state effort grade. A genuine but wrong Q3 answer can
remain yellow/full-credit while receiving understanding 1 or 2. A concise but fully correct answer
may receive understanding 4 or 5 even if its prose is brief.

## Missing data and storage

- Score blank Q2 or Q3 answers inside an existing submission as `0`.
- Do not create a `grades` row or diagnostic values for a student with no submitted work.
- If the assignment does not define `q2` or `q3`, **omit that key** from `diagnostic` and warn the
  operator; do not invent a value. (`diagnostic` is `NOT NULL DEFAULT '{}'`, so an absent key is the
  natural "not assessed" — there is no column to null out any more.)
- Write the diagnostics in the same `grades` batch upsert as the suggested grade, keyed on
  `enrollment_id` — never `student_id` alone.
- Read back `enrollment_id` and `diagnostic` for the run's exact enrolment ids; require one row per
  graded enrolment and integer values in `[0,5]` wherever the question exists.
- Never let a diagnostic reach `points_earned`. `grades` has `CHECK (points_earned <= points_possible)`
  and these numbers are on a different scale entirely — a leak would be both wrong and rejected.
