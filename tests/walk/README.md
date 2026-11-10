# tests/walk: the clickthrough walk

**Optional developer tooling.** Nothing here is served or needed to deploy (CORE.md section 2). Delete this folder and the site is
unchanged. `node_modules/` is git-ignored, and the folder has its own `package.json`.

## What it does

It drives a real headless Chrome or Edge against the local site (`scripts/staging/serve_local.py`, which reaches the staging project
and not production), signs in as the seeded staging people, clicks the real pages, and checks two things for every step: what the
page shows, and what the database then holds. Each check has a name and ends as pass, fail or blocked. A check that needs an
earlier step which failed is reported as blocked, never as a pass.

| Group | Walks |
|---|---|
| A | Director, Assignments: new assignment opens for setup; Instructor-graded questions, tutor and Both cards saved and re-read from the database; a question; publish; the Report link |
| B | Cadets: the chooser, the Questions path to a submit, the tutor card (the new window is recorded and refused), the dashboard's question count |
| C | Grade assignments: list, typed scores, WebAssign / Teams / Gradescope file drops, a wrong file, publish the column, My grades, gradebook |
| D | AI drafts: a draft inserted through the data role (no AI call), shown as waiting, reviewed, finalized; a dropped cadet's draft is not counted |
| E | Reports: the bar entry, the picker, one report, an instructor's scope, the course switch |
| F | Meeting days: a course on W and F, one on the default, Add section, a section holding another day, the roster preview line |
| G | Roles: an instructor gets no Assignments writes; the other course's director reaches nothing here |
| J | The 2026-11-09 review pass: the older address kept, the dashboard Backlog and Recent reports, the gradebook heading, the info control, an instructor read-only Assignments, and a cadet in two courses on All classes |
| K | The chooser by kind (2026-11-09): four cards for a preflight, three for the others with Auto-graded questions grayed unless homework, each card saving its pair, an older saved setting kept as it was, and a tutor setup file dropped on the tutor card |
| T | Tutorials (2026-11-10): the welcome tour starts once on a first sign-in and does not return; the off switch, and a newer tour showing once with New feature; the Account switch and reset; a cadet's own tour; Help lists them first; "Start an assignment" as a cadet; "Create a new course" as the site admin ends with a real course (zz-walk) and "I've got it from here" leaves the form as it was; "Add an assignment" as a director ends saved and unpublished; a director opening "Create a new course" is told who does it. Resets each login's tutorial preference before and after |
| I | Expression answers: the insert buttons, the typeset reading (a rendered KaTeX element) for the cadet and in the question editor, a question whose own variable is `e`, and one marking through the deployed `check-answer` (I5 needs the new function) |

## Safety

- It refuses to start unless the base address is `http://localhost`, `http://127.0.0.1` or `http://[::1]` with a port.
- Every request to the production project is stopped by the walk, by a browser resolver rule, and by the local server's content
  policy. The last check of every run fails the run if any request to production was attempted. `--self-test` proves the guard
  without touching any data.
- The database helper (`db.py`) refuses any connection string that does not name the staging project.
- Passwords are never written down. The people are read from the header tables of `scripts/staging/seed_staging.py` at run time,
  and each password follows the rule that file states, computed in memory. `WALK_PASSWORD_<NAME>` (for example
  `WALK_PASSWORD_DIRECTOR`) overrides one login. The walk never changes a password and prints none.
- Everything it creates is named `ZZ walk ...` (courses `zz-walk-...`, invented cadet IDs 3009990001 to 3009990099), is synthetic,
  and is removed at the end. Do not run it while someone else is hand-testing the same staging project, and never run
  `seed_staging.py` or the live suites of `tests/app-schema` as part of it.

## Run

Needs Node, a Chrome or Edge install (or `CHROME_PATH`), a Python with `psycopg2` for the database helper (`PREP_PYTHON`), and the
staging connection string in `STAGING_DB_URL`. The server must already be running from the tree under test.

```powershell
cd tests/walk
npm install                              # puppeteer-core only
$env:PREP_PYTHON = "<path to python.exe with psycopg2>"
# STAGING_DB_URL must be in the environment of this process
node walk.mjs --self-test                # the guard only
node walk.mjs --base http://localhost:8043            # everything
node walk.mjs --only C,D --keep          # some groups; --keep leaves the ZZ walk rows for a look
node walk.mjs --cleanup-only             # remove leftovers of an interrupted run
node walk.mjs --report out.json          # also write the results and the faults found
```

The exit code is 0 only when every check passed.

## What it cannot do

A real claude.ai tutor session, the AI grading run itself, sign-in with a password a person chose, and judging whether a screen
looks right. It reads text and structure, not pixels.
