# Stage E: checking an answer on the server

**Status:** built offline and on a scratch database, 2026-11-05. Not deployed. Not applied to staging or production.
Migrations `app/070` and `app/071`; the function folder `supabase/functions/check-answer/`; the shared reader
`site/js/numeric-answer.js`.

## What it does

A student's answer goes to one function. The function checks who they are, asks the database whether they may answer
now, marks the answer in code against the key, and tells the database to store the attempt. The browser gets right or
wrong, the attempt number and the attempts left. It never gets the key.

| Step | Where | Rule |
|---|---|---|
| Who | the signed-in session | never a field of the request |
| May they answer | database, `answer_context` and again in `record_answer` | enrolled (active), published, released, question on an auto-checked path and not retired, deadline (extension, section, day, offering; 120 s grace), late work only if the item allows it and the term's last class day has not ended, attempts left, a current key a person has checked |
| Is it right | the function, with `numeric-answer.js` | no AI. Percentage or absolute tolerance, either one, edge inclusive, exact decimal arithmetic |
| Store | database, `record_answer` | one lock per student and item, attempt number serial, grade recomputed from stored attempts by the item's attempt rule, source `auto_checked`, finalized |

## Decisions made here

1. **The comma is a thousands separator, in strict shape only** (`1,000`, `12,345.6`). Every other comma (`1,5`, `1,50`,
   `1000,5`) is refused with a plain message and costs no attempt. Why: the course writes keys with a decimal point;
   `1,5` is how other countries write a decimal, and guessing either way gives a wrong mark. `1,000` is one thousand,
   never one.
2. **A refused answer is not an attempt.** Unreadable, ambiguous, or not on the choice list.
3. **Trailing zeros with no decimal point are ambiguous** (`1000` may be 1 to 4 figures). A required significant-figure
   count passes if it falls in that range. `warn` modes never change the mark; only `require` does.
4. **One checker, two copies of one file.** A deployed function can only carry files from its own folder, so
   `site/js/numeric-answer.js` is copied byte for byte into `supabase/functions/check-answer/`. A test fails if they
   differ (line endings aside) and runs the same vectors through both. Edit the site copy, then copy it over.
5. **Verdict is supplied by the function, so the answer functions are granted to `service_role` only.** The database
   checks the verdict is about the current key version. A caller with the service key can still write any verdict; that
   key must stay server-side.
6. **No attempt limit set means a ceiling of 100**, so an answer cannot be hunted for without end. The entry page
   should keep offering a limit (5).
7. **Open questions.** (a) Whether Cengage and WebAssign are still used in Spring 2027 is unknown as far as is known, and at
   least one version of a similar class will not use it in the Spring; this build does not depend on either answer.
   (b) Decided by the course director, 2026-11-05: each student gets the same numbers by default. Instructors may later
   choose different numbers per student (`question_keys.variant_key` leaves room). That part is not built.
8. **The website has no connection to AI for writing problems** (course director, 2026-11-05). An instructor makes a
   problem in one of three ways: types a single set of numbers on the website; prepares a CSV or Excel file of number sets
   with answers, by hand; or asks their own AI model to write that file, using instructions the system provides, then
   uploads it. Normal code checks the answer in every case.

## What it depends on from Stage D (step 2)

- **E6, keys out of `content` and `content_snapshot`.** New homework keys already live only in `question_keys`. The
  guarantee "no route gives a student a key" also needs the old `activities.content` keys (preflights) hidden by E6;
  it does not affect homework items.
- **Student read of questions.** The student page needs question text and choices (no key columns exist on `questions`)
  released at the release time, in RLS or a function. Not built here.
- **`grades_new_items_stay_unfinalized`.** Step 1 refuses a finalized grade on a new-page item. `070` adds a narrow
  exception for the answer function (a transaction-local marker). When step 2 removes that trigger, the exception goes
  with it. Another worker editing the same function in 044 to 059 will conflict.
- **`release_at`.** `070` replaces it so it calls the new `_release_core` (same result). Step 2 grants it.
- **Total.** `039` already treats an `auto_checked` grade before the deadline as `in_progress`, and reads attempts only
  for that state, never for points.
- **Audit trigger on `grades` (E12).** Writes by the answer function will be logged like any other.

## Not built

- Problem file upload (decision 8) is built, offline and on a scratch database; not applied to staging or production, and
  not clicked through on a real item (staging holds no new-page item with questions, and staging is frozen). What exists:
  one format and one reader, `site/js/problem-file.js` (CSV, UTF-8, one row per question; types number, choice, select;
  columns in `COLUMNS`); the upload panel on `site/faculty/questions.html` (dry run, then a preview with each question, its
  key and the range of answers accepted, then one click to save); the instructions an instructor copies into their own AI
  model (`aiInstructions()`, shown in the panel); a review panel where a person ticks each AI-written key.
  Rules kept: any cell that reads as formula text, a comma in a number, a unit in a number cell, or an empty key refuses the
  whole file and every bad row is listed with its row and column; numbers are read by `numeric-answer.js`, and each number
  key is typed back through the real checker before it is accepted. A key from a file marked `ai` is stored
  `written_by = 'ai'` and the item cannot be published until a person records a check; the database fills in who. No new
  migration was needed: the rules from migration 030 already enforce it. Proof: `tests/app-schema/test-problem-file.mjs`
  (offline) and `scripts/staging/scratch_problem_file_proof.py` (scratch database).
  Choices made here: (1) Excel is not read. The repository has no `.xlsx` reader, and adding a library is a build-step
  decision; a workbook is recognised and the person is told to save a CSV. (2) A `variant` column exists and must be empty
  today, so a file written now stays valid when different numbers per student are built (several rows with one
  `question_id` and different `variant` values). Keys are written with `variant_key = ''`. (3) The older `Import from CSV`
  button is left in place beside the new one; it has its own column names and writes only human-written keys. (4) A number
  key with no tolerance is accepted with a warning, since exact match is a legitimate key. (5) A comma in a number cell is
  refused even in the thousands shape (1,000), because a file is plain data; the student answer box still reads 1,000.
  Still not built: reading `.xlsx`; per-student numbers; a key-check step that records which numbers the person saw.
- The student page: question display, the answer box, the response for each answer, score so far read from the grade row.
  It needs the student read of questions above, the deployed function, and the 7-day release rule.
- `remark_question`: re-marking stored attempts after a key correction. The raw answers are stored, so it can re-run the
  shared checker in a staff-called function and update `is_correct`, `points_awarded`, `key_version_id` and the grade, and
  log one `key_remark_runs` row. Instructor-corrected grades are listed, not changed.
- Result of the last scratch run (2026-11-05, 8 connections): 80 checks passed, 0 failed. Load: 150 students, 900 calls
  in 17 s, p50 146 ms, p95 168 ms, 372 on time and 528 closed, none refused for any other reason. Sixteen connections
  were refused by the shared connection limit (a connection error, not a database fault), so 8 is the default.
- Adding `check-answer` to `DEPLOYABLE` in `scripts/staging/deploy_functions.py` (deliberately left out so it cannot be
  deployed by accident).

## Stage E gate: test list

Runs now (offline or on a scratch database):

| Gate item | Test |
|---|---|
| Parser and checker | `tests/app-schema/test-numeric-answer.mjs` |
| Altered requests cannot choose a grade; reply is right or wrong only; one parser in both places; a refused answer is not an attempt | `tests/app-schema/test-check-answer-function.mjs` |
| No route gives a student the key (database grants, student session reads 0 key rows, refusals carry no key); retries cannot exceed limits (12 simultaneous); deadline, late, extension, release; rule best/last/first; person's correction wins; hand-made arguments refused; rollback and re-apply | `scripts/staging/scratch_stage_e_proof.py --expect-ref <staging ref>` |
| End-of-deadline load, database side | `scripts/staging/scratch_stage_e_proof.py ... --load 150 --threads 8` |

Needs staging (after the function is deployed and `070`/`071` are applied there):

1. A real student session calls `check-answer`; the response body holds only the four fields.
2. The same student reads `question_keys`, `question_attempts` of another student, and `grades` of another student: nothing.
3. A request with another student's ids or forged fields returns the session student's result.
4. An expired and a forged JWT are refused; a staff JWT cannot answer.
5. Deadline with a false browser clock; at the deadline second; after it with an extension.
6. Two browser tabs answering the last attempt together.
7. A key corrected mid-session (retry path).
8. End-of-deadline load through the real function: many sessions in the last minute, measuring edge function cold start,
   latency (p95), error rate, and Supabase connection limits; then the database invariants of the scratch load test.
9. Function logs hold no key, answer text beyond what is intended, or token.
10. The total (student, instructor, export) agrees for an auto-checked grade before and after the deadline.
