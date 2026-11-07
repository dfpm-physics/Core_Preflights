# Stage E: checking an answer on the server

**Status:** built offline and on a scratch database, 2026-11-05. Not deployed. Not applied to staging or production.
Migrations `app/070` to `app/073`; the function folders `supabase/functions/check-answer/` and
`supabase/functions/remark-question/`; the shared reader `site/js/numeric-answer.js`; the student page
`site/student/homework.html` with `site/js/homework.js`. Part one is answering (070, 071). Part two is re-marking (072)
and the student page with its read of questions (073); both are described under "The second part" below.

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

## Resolved at the merge with step 2 (2026-11-05)

The section below lists what Stage E needed from step 2. After the merge: `GRADE_SOURCE` is `my_grades`; the student lesson list links an auto-checked item to `homework.html?a=<id>`; `grades_person_correction` (070) stands without the step 1 new-item trigger; writes by the answer functions and the re-mark carry a real actor in the audit log (075); a question edit does not move points in a finished term (074); the two freeze functions are no longer PUBLIC (076).

## What it depends on from Stage D (step 2)

- **E6, keys out of `content` and `content_snapshot`.** New homework keys already live only in `question_keys`. The
  guarantee "no route gives a student a key" also needs the old `activities.content` keys (preflights) hidden by E6;
  it does not affect homework items.
- **Student read of questions.** Built in part two as the function `student_homework` (073), not as a policy on
  `questions`. See "The second part".
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
- The student page and the re-mark are built in part two (below). What is still not built there: a staff screen for the
  re-mark (the function can be called, nothing in `site/faculty/` calls it yet); the link from the lesson list to the
  homework page (it arrives with the Stage D lesson list); per-student numbers.
- Result of the last scratch run (2026-11-05, 8 connections): 80 checks passed, 0 failed. Load: 150 students, 900 calls
  in 17 s, p50 146 ms, p95 168 ms, 372 on time and 528 closed, none refused for any other reason. Sixteen connections
  were refused by the shared connection limit (a connection error, not a database fault), so 8 is the default.
- Adding `check-answer` and `remark-question` to `DEPLOYABLE` in `scripts/staging/deploy_functions.py` (deliberately left
  out so neither can be deployed by accident).
- Result of the part two scratch run (2026-11-05, up to 6 connections): 112 checks passed, 0 failed (the part one script
  also still passes, 72 checks without the load test, after its rollback check was narrowed to the two functions it
  concerns, since `072` now also uses the marker). The offline suites `test-remark-function.mjs` (48 checks) and
  `test-homework.mjs` (78 checks) pass.

## The second part: re-marking and the student page

**Status:** built offline and on a scratch database, 2026-11-05. Migrations `app/072` and `app/073`. Not deployed, not
applied to staging or production, not run against the real `check-answer` function.

### Re-marking after a key correction (072, `supabase/functions/remark-question/`)

A person corrects a key (a new version; the old one is superseded). Then a director runs the re-mark for that question.

| Step | Where | Rule |
|---|---|---|
| Who | the signed-in session, and the database | a global admin, or a director of the question's course. The same right as correcting a key |
| Read | `remark_context` | the question's format, its current key and every stored attempt (id and raw answer). The key goes to the function and stops there |
| Mark | the function, with the same `numeric-answer.js` | one verdict per attempt. An answer the checker cannot read (for example one stored before a rule changed) gets no verdict, is left exactly as it was, and is counted as unreadable. A key the checker cannot read stops the run |
| Preview | `remark_apply` with commit off | writes nothing. Says how many attempts would change, how many become right and wrong, which grades would be recomputed, and lists the grades it will not touch |
| Commit | `remark_apply` with commit on | must carry the number the preview showed, or it is refused (`changed_since_preview`). Then, in one transaction: update the attempts (`is_correct`, `points_awarded`, `key_version_id`, `parsed_value`), recompute each `auto_checked` grade, write one `key_remark_runs` row |

Decisions made here:

1. **A function in two halves, not a SQL parser.** The database never reads a number. The edge function marks; the database
   checks and writes. Like `record_answer`, `remark_apply` trusts its caller for the verdicts, so both new functions are
   granted to `service_role` only. The database does check that the verdicts are about the question's **current** key, that
   every stored attempt of the question has exactly one verdict, and that none belong to another question. If a student
   answered between the read and the write, the answer is `attempts_moved` and the person runs the preview again.
2. **The preview is a person's decision point.** A commit without the preview's number, or with a different one, writes
   nothing. A commit also refuses a key a person has not checked (an AI-written key).
3. **One grade calculation.** The grade step of `record_answer` moved into `_regrade_auto`; `record_answer` and
   `remark_apply` both call it. `record_answer` is replaced by `072` with the same arguments, checks and results; its
   rollback puts the `071` text back.
4. **A grade a person has taken over is listed, never changed.** Any grade whose source is not `auto_checked` is named in the
   reply (enrollment, item, source) when the re-mark would have moved its points. The count is in `key_remark_runs.grades_listed`.
5. **Safe to run twice.** An attempt already marked against the current key with the same result is not touched. A second
   run shows 0 changes and a second commit changes 0 rows. A run with 0 changes is still logged, as a run with 0 changed.
6. **Re-stamping counts as a change.** An attempt whose result stays the same but which was marked against an older key
   version is moved to the current version and counted in `attempts_changed`. Its grade is only recomputed if its points moved.
7. **`from_key_version` is the older version most attempts were marked against** (a question can have attempts from several
   versions). `to_key_version` is the current key.
8. **All or nothing.** The commit is one function call, so one transaction. A proof makes the grade write fail after the
   attempts were updated: no attempt, grade or log row changed.
9. **Locks.** One re-mark of a question at a time; then each student's item is locked the way `record_answer` locks it, so a
   student answering during a re-mark is neither lost nor double counted. A question with more than 3000 students is refused
   (`too_many`) rather than holding that many locks.

A bug the first scratch run found, kept here so it is not repeated: an answer with no verdict was first counted as a change
(its result went from false to null), and the list of grades to recompute was read after the attempts were already updated,
so it came back empty. Both are fixed and each has a check.

### The student page (073, `site/student/homework.html`, `site/js/homework.js`)

1. **The read is a function, not a policy.** `student_homework(item)` names every column it returns and rebuilds choices as
   `{id, text}`. A policy on `questions` would give a student every column of every released row, and any column added
   later; the function gives nothing that a later column adds until it is edited. `questions`, `question_keys` and
   `key_remark_runs` stay unreadable to a student session (proved).
2. **Release.** The function uses the one release rule (`_release_core`): published, and the release time has passed. An item
   that does not exist, is unpublished, or is not the student's gets the same answer (`not_found`). A question stays readable
   after the deadline so a student can review. A retired question is left out. The database already refuses a prose question
   on an auto-checked path, so none can appear.
3. **The page does not repeat the 7-day rule.** It takes its item from `loadAssignmentStatuses`, which drops what is not
   released, and then asks the function, which checks again. A test fails if `homework.js` or the page mention the release
   functions, `LOOKAHEAD`, the key tables or the checker.
4. **What a student sees.** The item's rule in plain words ("Your best try on each question counts."), the tries per question
   and the tries left, each question with its box (a text box for a number, radio buttons, or check boxes for "all that
   apply"), a button, and a reply after every answer ("Correct. 2 tries left." / "Not correct. No tries left."). A refused
   answer (an unreadable number, a comma) shows the server's plain sentence and is not an attempt. A failed send says the
   answer was not counted. The hint under a number box does not give an example number, so it cannot match a key.
5. **The score is read back, never added.** After each answer the page reads the student's grade row and shows its points, and
   each question's points from `question_scores`. With no row it says "No answers yet", never 0. If the read fails it says so.
6. **One send at a time per question.** The box and button are locked while a send is open, so a double click or a double
   Enter sends once. A question with no tries left, or a closed item, is locked. The server decides in every case; the page
   only reflects it.
7. **After the deadline** the page is read-only with a plain sentence, unless the item allows late work.
8. **Reached by `homework.html?a=<assignment offering id>`.** No link to it exists yet. The lesson list that shows it is
   Stage D's, and entering one of these items on a new page is still held back by the step 1 publish rules, so no student can
   reach one on production today.

### What it needs after the merge with Stage D (step 2)

- **`my_grades`.** Step 2's rule is that a student module reads the `my_grades` view, never `grades`. That view is not on this
  branch. `homework.js` reads the grade from one constant, `GRADE_SOURCE` (now `'grades'`). At the merge, change that one
  line to `'my_grades'`. If step 2 removes a student's `SELECT` on `grades` first, the page shows "Could not load this
  homework" (it fails loudly) and never a wrong score. **Check that the view returns an `auto_checked` grade before the
  deadline**, because the score is shown while the item is open. Migration `039` already treats that grade as in progress and
  hands the points out through the cell function; the view must do the same.
- **The error pattern.** `site/faculty/terms.html` on step 2 has `guarded()` (one action at a time, errors shown). This page
  does the same work inside `homework.js` (a per-question busy set, every failure drawn), so nothing needs to change.
  `cellShowsGrade` in step 2's `student-data.js` belongs to the schedule and grade lists; this page does not use it. If those
  lists later show an auto-checked item's score, they should use it and never read attempts.
- **The link.** The step 2 lesson list should link an auto-checked item to `homework.html?a=<id>`.
- **Migration numbers.** `070` to `073` do not overlap step 2's `044` to `066`. `072` replaces `record_answer`, which `071`
  created; nothing in `044` to `066` touches it. Another worker editing `grades_new_items_stay_unfinalized` would still
  conflict with `070`, as noted above.

## After the two Stage E reviews (2026-11-05)

Two reviews of the second part (a security review and a correctness review) found seven major faults and a set of smaller
ones. Each was reproduced before it was fixed. Migrations `070` to `073` were edited in place, because none had been
applied anywhere; each rollback was changed to match. This section replaces anything above that says otherwise.

### Decisions

- **Numbers.** `5 e-3` is read as 0.005. `5 X 10^-3`, `5 x 10^-3`, `5 * 10^-3` and `5 x 10^3` are read as the number
  (the power of ten needs the `^`; a raised exponent such as 5 x 10 with a superscript -3 is read too). `5x10-3` and `5 x 10` are
  **refused** with a plain message, never read as 5 with a unit and never marked wrong. `5 e` and `5e-` are refused. A
  unit that starts with `e` or `E` (`eV`, `EJ`) is still a unit. `0,125` is refused as a comma problem (it used to read as
  125); `1,000` and `12,345,678` still read as thousands. Superscript units (`m/s²`) fold to `m/s^2`. One file,
  `site/js/numeric-answer.js`, byte-equal in both function folders (a test compares them).
- **A key the checker cannot read.** Refused when it is entered: a numeric key with no value, a value or tolerance over 40
  digits, a choice key that names nothing, two choices on a single-answer question, or a choice that is not offered. The
  rule is a database trigger (`question_keys_readable`), so the upload and any other route meet it. The upload page says the
  same in its own words before it writes. If one is met anyway when a student answers, `answer_context` and
  `record_answer` return `key_fault`, the function tells the student the question has a fault, **no attempt is written,
  no try is used, and nothing is marked wrong**. Superseded rows are not checked (they are history).
- **Re-mark changes only an active term.** A completed term's attempts and finalized grades are never rewritten.
  "Director" for a question now means a director of a course offering that is active (or a global admin); a director of
  only a past term is refused. The preview shows every term the question appears in, which one is applied, how many
  attempts would change in each, and lists what it refuses, with the reason. A commit **must** carry the preview's token
  (a hash of the key and the changes the preview showed). A missing token is `bad_request`; a token that no longer matches
  (the data or the key moved) is `changed_since_preview` and writes nothing. The old bare count is gone.
- **A person's correction of an auto-checked grade holds.** Trigger `grades_person_correction` (070): any write that is not
  the answer functions (they set `app.auto_check_marker`) and changes `points_earned` or `question_scores` of an
  `auto_checked` grade moves it to source `instructor`, graded by the caller, so a later answer or re-mark skips it.
  It does not read the new-page rule.
- **Attempts and grades belong to one offering.** `question_attempts_unique` is `(enrollment, assignment_offering,
  question, attempt_no)`. The limit, the used count, the best / last / first choice, the grade and the re-mark all filter by
  offering, so two offerings that share an activity no longer share tries or points.
- **A retired question or a points change.** Rule: a retired question contributes nothing, and a grade is never more than
  its offering's current points. The library's own sync already moves the offering's points; trigger
  `questions_regrade_auto` (072) now recomputes the `auto_checked` grades of that item through `_regrade_auto` in the same
  transaction (active terms only, same advisory lock as an answer). Person-set grades are left alone. So a grade of 3 on an
  offering of 2 cannot be left behind.
- **An AI-written key is checked as a separate act.** Trigger `question_keys_ai_check` (070): an AI key is inserted
  unchecked; a check is an UPDATE of `checked_by` / `checked_at` only, by a signed-in person; an INSERT that already carries a
  check, a check with no signed-in person, and a check that edits the key in the same statement are all refused.
- **The student page leaves out a question whose AI key no person checked.** `student_homework` omits it and returns
  `held_back` (a count); the page says that some questions are not open yet. The answer functions already refused it
  (`key_unchecked`). An item that is not released returns `not_found`, the same as one that does not exist, so a student
  cannot learn that a future item exists. `attempts_used` is per offering.
- **Late work in a term with no last class day** (`terms.ends_on` empty) is refused with `late_unavailable`, and the page
  tells the student that the end of the term has not been set, so a staff member can fix it. It used to fall through.

### What the merge with step 2 must keep

When step 2 drops `grades_new_items_stay_unfinalized`:

1. **Keep `grades_person_correction`.** It is what protects an instructor's correction. It is separate on purpose: it
   works with or without the 029 rule, and the scratch proof checks it with that rule switched off.
2. **Keep attempt uniqueness per offering** (`question_attempts_unique` with `assignment_offering_id`), and every query that
   counts or reads attempts must filter by offering.
3. **Keep the `app.auto_check_marker` convention** for every function that writes an `auto_checked` grade, including
   `_regrade_auto` and `questions_regrade_auto`; a write without it is treated as a person's.
4. **The `my_grades` view** still has to return an `auto_checked` grade before the deadline (see above).

### Minor findings left, with the reason

- **Attempt ceiling for choice questions** (security): a question with no limit set allows 100 tries; a limit for choice
  questions is a policy and a form field on the entry page. Left for the entry page work.
- **`ms` against `m s`, and spacing inside units** (correctness): needs a rule on what a unit string means; not changed
  rather than guessed.
- **Wording on a transport error, the score shown before a grade-release hold, and the message when an instructor-set
  grade wins** (page): wording and a product choice about what a student sees. Not changed.
- **The two-statement upload is not one transaction** (correctness): each statement is safe alone and the re-run is
  idempotent; one transaction needs a new database function. Left.
- **`sig_fig_rule` edges and a negative `-x` question**, **a rollback that freezes rows**, and **the page's own idea of "past"**
  (it follows the browser clock; the database decides): left, none changes a mark.
- **Older functions executable by PUBLIC** (security, outside Stage E): not touched here.
- **Library question edits already move a completed term's `points_possible`** through the 030 sync. The new regrade covers
  active terms only; whether past terms should be frozen against library edits is the director's decision.

## Symbolic answers (migration 085, added 2026-11-05)

A question whose answer is an expression, such as `m*v^2/2`. It is checked by working both expressions out at fixed values and
comparing the numbers. No AI is involved.

- **Where it runs.** On the server, in `check-answer`, like a numeric answer. The key (expression and variables) goes from the
  database to the function only; the student page receives the variable names and never the expression.
- **Reader.** One small written parser, `site/js/symbolic-answer.js`, copied byte for byte into `check-answer/` and
  `remark-question/` (tests fail if a copy differs). It uses no `eval`, no `Function` constructor, no dynamic import and no
  property lookup by a name the student typed. The text becomes a tree of plain objects, evaluated by a switch.
- **Limits, checked while reading and before anything is evaluated.** 200 characters, 150 tokens, 200 nodes, nesting depth 20
  (brackets, function calls, signs in a row, a tower of powers), 8 variables of 12 characters each. A name that can be split
  into variable names in more than one way is refused.
- **Grammar.** `+ - * / ^` (and `**`), round brackets, juxtaposition (`2x`, `m v`, `2(x+1)`), numbers with a decimal
  point and an exponent, the constants `pi` (or the Greek letter) and `e`, and the functions `sin cos tan asin acos atan sinh
  cosh tanh sqrt exp ln log10 abs`. `log` alone is refused (natural or base 10 is unclear). Units, vectors and equations are not
  read.
- **Refused, not marked wrong, and no attempt used.** An unknown name (the message lists the allowed variables, never the key),
  an unbalanced bracket, an equals sign, a function without brackets, a character outside the grammar, an answer too long or
  too deeply nested, two numbers side by side, and a division followed by juxtaposition (`1/2x`, `1/2m`, `1/2(m)`, `a/b c`, `1/x y`), which could
  mean two different things. **One case is read, by decision (2026-11-05):** a plain number divided by a plain number, then a
  space, then a factor, is the fraction times that factor. `1/2 m v^2` is (1/2)*m*v^2, `3/4 x` is (3/4)*x, `1/2 (m v^2)` is
  (1/2)*(m*v^2), and `1 / 2 m` reads the same way. The space is what carries the meaning: without it (`1/2x`) the input is
  still refused, and both sides of the slash must be plain numbers (`a/b c` and `1/x y` stay refused). The rule applies to an
  answer and to a key alike, and the reading shown to staff and students brackets the fraction, as `(1 / 2) * m * v^2`.
  Whitespace changes no other reading. The student's page shows the same message while typing, and shows how the answer is read.
- **Test points.** 96 candidate points, fixed by a seeded generator whose seed is a hash of the sorted variable names, so the
  same question gives the same points in any order and on any date. Magnitudes from 0.25 to 40. **Every variable is tested on
  positive values only** (physics quantities mostly are), so `sqrt(k)/sqrt(m)` matches `sqrt(k/m)`, `ln(a)-ln(b)` matches
  `ln(a/b)` and `sqrt(x^2)` matches `x`. A variable staff list under "Variables that can be negative"
  (`question_keys.signed_variables`) takes both signs from the seventh point on; marking one does not move the magnitudes. Every
  point at which the key is defined is used. An answer that is undefined at such a point (division by zero,
  an even root of a negative number, overflow) is wrong. If the key is defined at fewer than 8 points, that is a fault in the
  question: `key_fault`, nothing stored.
- **Comparison.** `|a - b| <= 1e-9 * max(|a|, |b|) + 4 * E` at each point, E being a bound on the rounding error of the two
  expressions there (every operation adds 2.3e-16 times its own result to what its operands carry). There is no absolute floor:
  an earlier version used `max(1, ...)`, which accepted 0 and any wrong multiple for a key below about 1e-9 everywhere
  (`6.63e-34*f`). A difference smaller than about one part in a billion is not seen, and that limit is stated to staff. A key
  that is 0 with no subtraction in it must be matched exactly; one that is 0 through cancellation is matched within the rounding.
- **Stated to staff on the question page.** It proves two expressions are equal at the test points, not that one is simplified;
  units and vectors are out of the first version; the answer must be defined wherever the key is.
- **Staff.** Format "Expression (symbolic)" on the question page: the expected expression, the allowed variables, a button that
  shows how the key reads, and a trial answer that shows how it would be read and marked. A key that does not read, or is defined
  almost nowhere, is refused on save.
- **Names.** A Greek letter and its Latin spelling are one name in the answer, the key and the variable list (the micro sign
  is mu); listing both is a duplicate. Look-alikes mapped before reading: real minus, superscript and subscript digits, times and
  divide signs, one-half, one-quarter, three-quarters, and a square-root sign before a bracket.
- **Rollover.** `KEY_COPY` carries `expression`, `variables` and `signed_variables`; a test reads the migrations and fails when a
  `question_keys` column is neither copied nor deliberately left out.
- **Not built.** The problem-file and CSV uploads do not carry this type (add one question at a time on the page). Per-student
  values, units and vectors. A browser walk-through of either page; the real edge function; a deployed run.


### Insert buttons, typeset reading, e and pi, and square roots (added 2026-11-06)



What a cadet and a director see changed; what is marked did not (a differential run of the reader before and after, over

6,162 inputs and nine keys with positive and signed variables, gave 0 differences in how any text reads or is marked).



- **The buttons.** Above the answer box on a symbolic question: one per variable of that question, then squared, power, square

  root, multiply, fraction, plus, minus, brackets, pi, e. A click inserts plain text at the cursor and keeps focus in the box;

  the box stays the one source of the answer, and the server receives the same text as if typed. A selection is bracketed by

  square root, brackets and fraction (the selection becomes the top). A name is given a space before it when a letter, digit or

  closing bracket stands before it, so `2` then `e` is `2 e` and never the number notation `2e3`. Buttons are type=button, have

  accessible names, and are disabled with the box when the question is locked or closed. The row is built by

  `site/js/symbolic-view.js`, which is not part of the byte-copied reader.

- **The typeset reading.** Built from the parsed tree only (`toLatex`), never from the typed text, and drawn by the vendored

  KaTeX 0.19.1 (`site/vendor/katex/`, self-hosted, `trust: false`, `throwOnError: false`), loaded on demand on the cadet

  homework page and the staff question editor and nowhere else. LaTeX is made only of fixed commands, finite numbers, and

  names rebuilt letter by letter from letters and digits. Text carrying LaTeX or HTML is refused by the reader before a tree exists.

  If KaTeX is missing or throws, the plain reading is shown with a note that nothing is lost.

- **A question's own variable wins over a constant.** A question that declares `e` or `pi` (or the Greek letter) reads that name

  as its variable: the constant is gone for that question, the variable button is shown and the constant button is hidden. This

  needed one change to the reader: the variable check used to refuse `e` and `pi` as variable names. A function name (`sin`,

  `sqrt`, ...) and `log` are still refused. Staff are told on the question page.

- **Number notation.** `1e3` is the number 1000: a digit run, `e`, and digits is read as one number before any name is looked

  at. `2e` and `2 e` are 2 times e (the constant, or the question's variable e). When a question's variable is `e`, `2e3`,

  `2e+3` and `2e-3` are still numbers (2000, 2000, 0.002); to mean "2 times e plus 3" write `2*e+3` or `2 e + 3`. `e2` is an

  unknown name, not 2e.

- **A square root of a negative number.** Undefined: never 0 and never complex. The existing rule decides the mark and is

  unchanged: a test value where the KEY is undefined says nothing; an answer that is undefined where the key is defined is

  wrong. Variables default to positive, so `sqrt(x)^2` is `x`, `sqrt(x^2)` is `x` and `x^(1/2)` is `sqrt(x)`. For a variable

  staff mark "can be negative", `sqrt(x)` is defined at about half the points; `sqrt(x)^2` is undefined at the negative ones, so

  it is not `x` and is marked wrong against a key of `x`; `sqrt(x^2)` is `abs(x)`, not `x`. An odd root such as `x^(1/3)` is

  also undefined at a negative value (it is a power, not a real cube root). **One narrow exception, added with this change:**

  a root whose argument is zero only up to rounding noise (`1 - sin(x)^2` where cos(x) is zero can come out as -1e-17) reads

  as 0 with a wide error bound, so a right answer written that way is not lost to noise. A clearly negative argument is not near

  zero. The test that proves the exception cannot be made to fail on the old reader at the fixed test points: it is a guard,

  not a repair of a mark that was ever wrong.

- **Marking is value checking, and no answer shows the key.** Unchanged. Test values are still seeded by the variable names.

- **Staff keys** use the same reader, so a key can hold `sqrt(...)`, `pi`, `e`, and show the same typeset reading in the editor

  ("Show how it is read" shows the key and the trial answer). No buttons were added to the editor.

- **Still not done:** a walk of the real function (`tests/walk/groups/i.mjs` is written and not run); the buttons on the staff

  trial box. The problem-file uploads carry this type from 2026-11-07 (see "Small items closed 2026-11-07").


### Small items closed 2026-11-07 (branch `v2-symbolic`, local; no migration, no function change)

- **Lowering Attempts per question.** The items page already asked a person before a deadline moved earlier. It now asks the same
  way when a save sets the attempt limit of an automatically checked item below what some cadets have used (or sets a first limit
  when cadets have already used more). It counts the cadets who have a question with more attempts than the new limit and says the
  highest use. Stored attempts and grades do not change; those cadets can answer no more on the questions where they are over.
  Raising the limit, clearing it, or setting one nobody has passed asks nothing. A failed read of the attempts is an error and
  nothing is saved. Code: `attemptLimitLowers`, `attemptsOverLimit`, `attemptLowerWarning` in `site/js/faculty-items.js`; the
  confirm loop in `site/faculty/items.html`. The read goes through the staff read policy on `question_attempts`.
- **Percentages show at most one decimal place.** `percentShown` (`site/js/percent-shown.js`) now defaults to one place; it was two.
  The rule is unchanged otherwise: half up, trailing zeros dropped, and a value just under a whole number is cut rather than rounded
  (89.95 and 89.999999... show as 89.9, never 90), because the letter comes from the full value. Display only: the stored text,
  `percent_key_text`, the band, the letter and the export are untouched. Every place that printed a percentage now goes through it:
  the cadet's grades, schedule and dashboard (`totalView`), the staff gradebook, the staff student page and its copy line, the
  backlog "near a line" list and the scale preview, which printed the database's text with six decimals before.
- **The problem file carries the symbolic type.** `site/js/problem-file.js` (the upload with a dry run) takes `type` = `expression`
  and three columns, `expression`, `variables` (separated by `|`, spaces or commas) and `signed_variables`, placed before
  `written_by`. It calls `variableProblem`, `signedProblem` and `previewKey` from `symbolic-answer.js`, in the order the question
  editor does, so a row is refused with the editor's sentence plus the row and column ("Row 6, column "variables": ..."). The dry
  run shows how the key is read. The key row written is the editor's (`expression`, `variables[]`, `signed_variables[]`,
  `written_by`), and an AI mark reaches it like any other key, so a person still has to check it before publication. The
  other CSV import on the same page (`planImport`, `format`/`prompt` headers) also accepts `symbolic`/`expression` rows with the
  same three columns. A formula cell is still refused when it starts with `=`, `@`, `+` or `-` (spreadsheet formula text); the
  message tells the author to write a leading minus as `0-x` or `(-x)*y`. The example file and the AI instructions carry one
  expression row.
- **`x^2^3` is `x^(2^3)`.** Powers group right to left, in the reader (`parseSymbolic`), in the reading shown to staff and
  students (`x^2^3`; `(x^2)^3` is bracketed), and in the typeset form (`x^{2^{3}}`). At x = 2 it is 256, not 64. It is tested in
  `test-symbolic-answer.mjs` and `test-symbolic-view.mjs`. The server copies are byte copies of the same reader.
- **A variable under two spellings** (`mu` and the Greek mu, `theta` and the Greek theta) is refused on save by the page and the
  reader: "The variable "..." is listed twice (a Greek letter and its Latin spelling are the same name)." The micro sign alone is
  not a variable name; the refusal says a name must start with a letter. **The database check does not fold the spellings.**
  `_key_problem` (migrations 085 and 087) compares names as written, so a key written straight to the database with both spellings
  passes, and a signed variable spelled differently from its declared variable (`mu` against the Greek mu) is accepted by the
  reader and refused by the database. Closing that is a change to `_key_problem`, which is a migration. **Not done; needs a decision.**
- **Health page: a line for a question whose key the checker cannot read. Not built.** The database's key check, `_key_problem`,
  is revoked from every role the site uses (migration 070 revokes it from `authenticated`, `service_role` and the two scoped
  roles), and no granted function reports it. A page cannot call it. A second copy of the rule in the browser would be a second
  calculation, which this system avoids. What it needs is a migration: a staff-gated function returning the questions whose
  current key fails `_key_problem`, which the health page would call, with a failed call shown as an error. **Not done; needs a
  decision.** Until then the same fault appears as `key_fault` to a cadet, and as `key_fault` in a re-mark preview.

## Stage E gate: test list

Runs now (offline or on a scratch database):

| Gate item | Test |
|---|---|
| Parser and checker | `tests/app-schema/test-numeric-answer.mjs` |
| Altered requests cannot choose a grade; reply is right or wrong only; one parser in both places; a refused answer is not an attempt | `tests/app-schema/test-check-answer-function.mjs` |
| No route gives a student the key (database grants, student session reads 0 key rows, refusals carry no key); retries cannot exceed limits (12 simultaneous); deadline, late, extension, release; rule best/last/first; person's correction wins; hand-made arguments refused; rollback and re-apply | `scripts/staging/scratch_stage_e_proof.py --expect-ref <staging ref>` |
| End-of-deadline load, database side | `scripts/staging/scratch_stage_e_proof.py ... --load 150 --threads 8` |

Part two, runs now:

| Gate item | Test |
|---|---|
| Re-mark logic: one parser in three places, the checker's verdicts, preview writes nothing, a commit needs the preview token, a second commit changes 0, only an active term changes, no key in a reply, a non-director reaches no write | `tests/app-schema/test-remark-function.mjs` (against a model of the database rules) |
| Re-mark in the database: grants, who may call, preview writes nothing, commit counts and grades, instructor grade listed and unchanged, one log row, twice, malformed or stale verdicts, all or nothing (injected failure), students answering during a re-mark, the best / last / first rule | `scripts/staging/scratch_stage_e_part2_proof.py --expect-ref <staging ref>` |
| After the reviews, in the database: a key that cannot be read is refused at entry and met as `key_fault`; an AI key is checked only by a separate act; a person's correction holds (with and without the 029 rule); two offerings sharing an activity keep separate tries and grades; retiring or re-pointing a question leaves no grade above its offering; late work with no term end is refused; a re-mark changes only an active term and refuses a missing or stale token; held-back questions; rollback of the new objects | `scripts/staging/scratch_stage_e_part2_proof.py` and `scratch_stage_e_proof.py` |
| Student read: grants, a released item, no key data in the document or on any other route, nothing before release, unpublished, not enrolled, other course, staff session, retired question; rollback and re-apply of 073 and 072 | the same script |
| Page logic: what is sent, what each reply says, the score is the grade row, closed and late, markup | `tests/app-schema/test-homework.mjs` |
| Page in a browser, against a stand-in for the function | `tests/browser/test-homework.html` on `scripts/staging/serve_local.py` (checked by hand once: right, wrong, comma refused, empty, select-all, limit reached, double click, network down, closed, late, score read failing) |

Needs staging (after the function is deployed and `070`/`071` are applied there):

1. A real student session calls `check-answer`; the response body holds only the four fields. **Done 2026-11-06** (load run, item 8: all 454 replies read, each held only those fields).
2. The same student reads `question_keys`, `question_attempts` of another student, and `grades` of another student: nothing. **Done 2026-11-07** (a student session read 0 `question_keys` rows; its `question_attempts` and `grades` held no other cadet's row, asking for another cadet's rows by id returned none, its gradebook read returned only its own cells, and a direct write of an attempt was refused). Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).
3. A request with another student's ids or forged fields returns the session student's result. **Done 2026-11-06** (load run: 28 requests carrying a forged verdict, points, attempt number, student id and enrollment id; each was stored under the session student, with the verdict from the answer itself).
4. An expired and a forged JWT are refused; a staff JWT cannot answer. **Part done 2026-11-06:** a session with a damaged signature, a string that is not a token, and a request with no credential were each refused with HTTP 401 before the function ran; the publishable key as a session and a key header alone were refused by the function as not signed in. An expired token and a staff token were not tried. **Rest done 2026-11-07:** a session kept until its stated expiry had passed (plus 45 seconds) was refused and stored nothing; an instructor session and a director session were each refused as not enrolled; a token with a changed signature, a string that is not a token and no credential were refused again. Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).
5. Deadline with a false browser clock; at the deadline second; after it with an extension. **Part done 2026-11-06:** the server clock decided. 52 answers landed in the 120 second grace and were stored; 16 sent after the grace were refused as closed; no stored answer is later than the deadline plus 120 seconds. A false browser clock and an extension were not tried. **Rest done 2026-11-07:** an answer sent at the deadline second was stored; after the grace, an answer carrying a client time two hours early (in the body and in headers) was refused as closed and stored nothing; a cadet with an extension of a day still answered after the grace, and a cadet with none was refused as closed. Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).
6. Two browser tabs answering the last attempt together. **Done 2026-11-06** (load run: 28 pairs of simultaneous answers from one cadet, two rounds each; exactly 3 stored per cadet, the rest refused as limit reached, no gaps in attempt numbers).
7. A key corrected mid-session (retry path). **Done 2026-11-07** (the same answer was marked wrong against the first key version and right against the corrected one; the first attempt kept the old key version, the second carried the new one, and the grade followed the best attempt). Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).
8. End-of-deadline load through the real function: many sessions in the last minute, measuring edge function cold start,
   latency (p95), error rate, and Supabase connection limits; then the database invariants of the scratch load test.
   **Done 2026-11-06** with `scripts/staging/load_check_answer.py`.
   150 made-up cadets signed in with real sessions (282 s; the sign-in endpoint answered 429 seven times, the first after
   38 sign-ins, and the script backed off). 442 requests from 16 threads in the last 60 seconds before the deadline, 30
   seconds after it, and around the end of the 120 second grace: HTTP 200 for all 442, error rate 0 of 442. Median 388 ms,
   p95 670 ms, p99 1026 ms, max 1788 ms; first request to the function after idle 1031 ms. Database connections 15 to 17 of
   60, at most 3 active. Invariants all held: no cadet above 3 attempts; no gaps; nothing stored after deadline plus grace;
   all 144 grades equal the best attempt recomputed; every stored attempt equals the reply the cadet got; forged fields
   changed nothing. A run of 10 cadets came first, three times. The run's rows were deleted; the table
   `grade_events`, which is append-only, kept 597 rows from the four runs (it holds ids and points, no names).
9. Function logs hold no key, answer text beyond what is intended, or token. **Not done 2026-11-06:** the management logs endpoint answered that no log table exists for the staging project, so the logs could not be read. Replies and headers were read instead (item 8). **Tried again 2026-11-07, still open:** the access token was tried against the management API logs route in both forms (`logs.all` answered HTTP 410 for `function_logs` and `function_edge_logs`; `logs` answered that neither table exists). No other route is open to that token, so this stays open. The Supabase dashboard's log view is the other route and is a person's to read.
10. The total (student, instructor, export) agrees for an auto-checked grade before and after the deadline. **Done 2026-11-07** (for two cadets the student's `my_course_total`, the instructor's `course_totals` row and the director's `course_totals` row, which is what the export reads, carried the same earned, possible and percent text, before the deadline and after the grace; the script also checks that `faculty-export.js` reads only `course_totals`). Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).

Part two, needs staging (after `072`, `073`, `check-answer` and `remark-question` are deployed there):

11. The real `homework.html`, signed in as a seeded student, on an item with questions: the questions show, an answer is
    checked by the real function, the reply and the score match, a reload shows the same tries and score. **Not done.**
12. A student session calls `student_homework` for an unreleased item and an item of another course: nothing comes back.
13. A staff session that is not a director calls `remark-question`: refused. A director previews, then commits with the
    preview's number; a wrong number is refused; the same commit again changes 0. **Done 2026-11-07** (an instructor and a student were refused a preview; the director's preview wrote nothing and said two attempts would change; a commit with a made-up number and an instructor's commit with the director's number were refused and wrote nothing; the commit with the preview's number changed those two attempts and their grades; the same commit again changed nothing). Script: `scripts/staging/prove_stage_e_open_items.py` (staging only, made-up data deleted at the end).
14. A re-mark while a second tab answers.
