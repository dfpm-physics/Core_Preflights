# The overnight AI grader

`supabase/admin/overnight_grade.py` grades the assignments whose typed answers are marked
"AI drafts overnight, a person reviews", then writes the class summaries for them, while nobody is
at a keyboard. It runs on the Linux machine, reads and writes the **staging** database only, and
asks a Gemini model through GenAI.mil to do the judging.

It writes **drafts**. Every grade it saves is `is_finalized = false`; the database refuses any
finalize that does not come from a signed-in instructor (migration 078), so this script cannot
publish a mark even by mistake.

## What it does, in order

1. **Finds work.** For each configured course it reads the same worklist the lesson cycle reads
   (`worklist_rows` in `supabase/admin/lesson_aggregate.py`), then keeps every day track whose
   deadline passed in the last 72 hours (deadline plus the site's 120-second grace plus 60 minutes),
   oldest first, at most 6 a night. This window is the one sanctioned sweep; see
   `.ai/skills/lesson-cycle/SKILL.md`.
2. **Grades each track.** One model call per cadet. Code, not the model, does the arithmetic,
   multiple-choice and numerical scoring, the zero for a cadet who submitted nothing, and every
   guard that protects a person's work (below).
3. **Writes and checks.** One transaction per track: save the drafts, read them back, and keep them
   only if they match what was meant to be written.
4. **Aggregates.** Section recommendations and quotes, one summary per instructor, misconception
   folding, and the whole-course scope only when every section is covered. It goes through the
   existing writer (`cmd_pull` and `cmd_write`), which keeps its own caps and records its own run.
5. **Records the runs** in `app.analysis_runs`: a `preflight-analyze` row and a `lesson-cycle` row
   per track (and the writer's `lesson-aggregate` row), all `invoked_by = 'scheduled'` when run
   with `--scheduled`.

## What it will not do

- Touch production. The job refuses to start if any of its files names the production project, if
  the target is not staging, or if `--expect-ref` is missing or wrong. It never reads
  `supabase/admin/.env`, and it never calls `lesson_aggregate._connect()`.
- Finalize, publish, commit or push anything.
- Overwrite a person's work. A finalized grade is never touched. An instructor's unfinalized draft
  is protected question by question: a question carrying the instructor's feedback is kept
  byte for byte, and a draft that already has a `schema: 1` assessment is skipped whole.
- Re-grade night after night. A cadet who already has a `schema: 1` assessment is not sent to the
  model again, with one exception: a zero row the job wrote for a non-submission
  (`diagnostic.no_submission`) is replaced when work later arrives. A track is chosen by what is
  still owed on it, not by whether it was aggregated before, so a late or extended submission on a
  track that already ran is graded the next night.
- Overwrite a row that changed while the model was working. The write is compare-and-set: it applies
  only if the row still has the `source` and `graded_at` read at the start. A refused write is left
  for a person and counted as `left_for_person_changed_since_read`, which makes the run exit 10.
- Grade a question that carries a figure. A text-only model cannot see the figure, so no AI cell is
  written for it and the question is listed as left for a person.
- Send a cadet's name, cadet ID or section code to the model. Each call is tagged with an opaque
  `S<n>`; aggregation reports use an opaque `R<n>` handle that is mapped back before the write.
- Call GenAI.mil for anything but the grading and aggregation calls, and for the model list. A
  redirect (any 3xx) from the API is an error and is never followed, so the key cannot be sent to
  another host.
- Trust what a cadet or an earlier run wrote. Only the lesson's own question ids are sent, each
  answer is cut at 4,000 characters with a `[truncated]` marker, and the misconception list shown to
  the model is capped at 40 entries with labels cut at 80 and descriptions at 300 characters. Any
  entry that addresses the grader or carries a link is dropped, and a model reply with one is
  rejected. The same link and citation checks run over the aggregation prose.
- Run unbounded. Besides the token cap, the whole run has a wall-clock cap (`max_run_minutes`,
  default 180). It stops cleanly between cadets, the run ends `partial`, and what was left is listed
  as owed (`time-cap`). When the API reports no token usage, the job estimates it from characters
  (about four per token) rather than counting zero.

## Defaults chosen

The course director cleared these for the first version. Change them in `config.json`.

1. GenAI.mil is cleared for this project. The endpoint, key and project values come from a secret
   file and are never printed or hardcoded. The factory refuses unless the config carries
   `"genai_mil_project_flag": "official-af-work"`.
2. Window: every eligible day track whose deadline passed in the last 72 hours, oldest first, at
   most 6 per night.
3. Models: the newest stable `flash` for per-cadet grading and the newest stable `pro` for
   aggregation, chosen from the API's model list at run time, with a fallback order and a pin
   (`model_pin_grade`, `model_pin_aggregate`, or `GENAI_MIL_MODEL`). Preview models are excluded
   unless `allow_preview` is true.
4. Grounding: text sidecars the operator places, plus optional curated digests with the equations.
   No new Python dependency.
5. Nightly token cap: 8,000,000 (`nightly_token_cap`). At the cap no new cadet is started and the
   run ends `partial`. A wall-clock cap of 180 minutes (`max_run_minutes`) works the same way. Both
   must be positive integers; zero or a negative value is refused at start.
6. Database: the DML role over `psycopg2`, reusing `lesson_aggregate.py` by import.
7. Questions with a figure are left for a person.

## Linux setup

```bash
cd ~/projects/Core_Preflights
git config core.hooksPath .githooks                  # once per clone
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir -p ~/.config/prep-overnight && chmod 700 ~/.config/prep-overnight
```

The job also refuses a config directory that is group- or world-writable, because anyone who can
write there can swap a file.

Create three files in `~/.config/prep-overnight/`, each `chmod 600` and owned by the user who runs
the job. The job refuses to start otherwise. They live outside the repository on purpose.

`config.json` (no secrets):

```json
{
  "target": "staging",
  "expect_ref": "wkibeptktbnaddfynrwr",
  "courses": ["phys-215"],
  "window_hours": 72,
  "max_tracks": 6,
  "min_age_minutes": 60,
  "grounding_root": "~/prep-grounding",
  "nightly_token_cap": 8000000,
  "max_run_minutes": 180,
  "model_pin_grade": null,
  "model_pin_aggregate": null,
  "allow_preview": false,
  "genai_mil_project_flag": "official-af-work"
}
```

`staging.env` (the staging DML tier only; the job refuses a file carrying any other tier):

```
PREP_DB_HOST=<staging pooler host>
PREP_DB_PORT=5432
PREP_DB_NAME=postgres
PREP_PROJECT_REF=wkibeptktbnaddfynrwr
PREP_APP_DML_ROLE=prep_app_dml
PREP_APP_DML_PASSWORD=<staging DML password>
```

`genai-mil.env`:

```
GENAI_MIL_API_KEY=<the key>
GENAI_MIL_BASE_URL=<the https endpoint base, ending before /chat/completions>
GENAI_MIL_MODEL=
GENAI_MIL_KEY_LOCKS_AT=<optional ISO time the key next locks>
```

The staging DML password is the `STAGING_APP_DML_PASSWORD` that `scripts/staging/install_staging.py`
generated. Copy that one value only.

Then:

```bash
.venv/bin/python supabase/admin/overnight_grade.py setup            # dry run: shows the folder tree and what is missing
.venv/bin/python supabase/admin/overnight_grade.py setup --commit   # creates the folders (mode 0750)
.venv/bin/python supabase/admin/overnight_grade.py doctor           # modes, the staging wall, a database connection; no model call
```

## Grounding documents

`setup` creates, for each course, shaped so `scripts/grounding/check_grounding.py --base
<root>/<course> --course <NNN>` works unchanged:

```
~/prep-grounding/<course>/Text_Book_PDFs/<NNN> Sections/   the PDFs, exact manifest filenames (copy from Teams)
~/prep-grounding/<course>/text/<NNN> Sections/<name>.txt   extracted text, pages separated by form feed
~/prep-grounding/<course>/digests/<name>.md                curated key results, with equations
```

It reports what is missing against `textbook-pdfs/rag-manifest.txt`. It never copies or deletes a
PDF. A course with no manifest entries (Physics 310) gets `digests/` only.

**The equation trap.** Text extracted from a textbook PDF keeps the prose and silently drops most
displayed equations, fractions and vectors. So extracted text is vocabulary and framing only. The
physics authority is the question's expected response (from the answer key) and the digest. Write a
digest for any lesson whose grading leans on a formula: a short sheet of the lesson's key results in
plain text or LaTeX, reviewed by the director. A page that looks as though it lost its math is
reported by `setup` as "equations probably missing", and the prompt tells the grader not to mark a
formula wrong because it is absent from an excerpt. A lesson with no digest still grades; the run
record says `grounding: text-only`.

Make a sidecar outside the job, for example `pdftotext -layout "Lesson.pdf" "Lesson.txt"` (a system
tool, not a dependency of the job; it separates pages with form feeds). The job reads text files
only.

## Running it

| Command | What it does |
|---|---|
| `run` | Dry run. Selects tracks and prints what would be graded, with a token estimate. No model call, no write, no run record. |
| `run --trial 3` | Real model calls for 3 cadets per track. Writes nothing; prints statuses to the console only. Spends tokens. A person asks for it. |
| `run --commit --expect-ref wkibeptktbnaddfynrwr` | Grades, writes drafts, aggregates, records the runs. |
| `run --lesson SLUG --track M` | Narrows the set; never widens past eligibility. |
| `run --regrade` | Re-sends AI-sourced, unfinalized drafts. A person only; refused with `--scheduled`. |
| `models` | Lists the models the key can use and the choice it would make. |
| `plan` | Same as a dry `run`. |

### Cron

```cron
CRON_TZ=America/Denver
0 3 * * *  /home/<user>/.local/bin/prep-overnight-grade.sh
```

The wrapper lives outside the repository (it holds a notification address that must not be
committed) and runs one command under `flock`:

```bash
#!/bin/bash
cd ~/projects/Core_Preflights || exit 1
flock -n ~/.local/state/prep-overnight/wrapper.lock \
  .venv/bin/python supabase/admin/overnight_grade.py run --scheduled --commit \
  --expect-ref wkibeptktbnaddfynrwr >> ~/.local/state/prep-overnight/cron.log 2>&1
code=$?
[ "$code" -ne 0 ] && echo "overnight grader exited $code" # notify here with your own transport
exit $code
```

It runs at 03:00 so it starts after the production lesson-cycle job (01:00, up to 45 minutes) has
finished with the same clone. It runs every night: a night with nothing due costs seconds and
records one `skipped` row. It never commits and never pushes.

A second run while one is in progress exits 75 at once and touches nothing. The lock is
`~/.local/state/prep-overnight/run.lock`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean, including "nothing was due". |
| 10 | Finished, but something is owed: a cadet could not be graded, a question with a figure was left, a stranded submission was refused, the token cap or the wall-clock cap stopped it, a write was refused because the row changed since it was read, a deadline disagreed, or a track is stuck after three failures. |
| 20 | A safety gate refused: production or non-staging target, a missing or wrong `--expect-ref`, a secret file readable by others, a forbidden flag combination. |
| 30 | Config or credential file missing or unreadable. |
| 40 | GenAI.mil unusable: key locked (the unlock address is printed, never the key), no usable model, the key refused. |
| 50 | Database error. |
| 75 | Another run holds the lock. |
| 1 | Unexpected crash. The `analysis_runs` row stays `running` on purpose. |

## How a cadet's draft is checked

Per cadet the model returns one JSON object. It is refused, and re-asked once with the specific
violation (never the cadet's text), unless it parses, finished cleanly, has exactly the questions
that were sent, and meets the state rules: green has empty feedback, red has feedback, yellow has
short tailored feedback, no feedback names or cites the grounding text (unless the cadet cited it
first), no misconception evidence is invented, no misconception id repeats, and nothing in the
reply speaks to the grader. A second failure writes no row for that cadet and the run is `partial`;
the cadet is tried again next night. Whether the reflection counts as meaningful is derived by code
from the reflection's color; a model that disagrees is counted in the run detail and not written.

## Not verified yet

These need the first live trial and are written down so nobody assumes them.

- The GenAI.mil client follows the provider's published OpenAI-style behaviour and has never made a
  call; no test makes one. `response_format` is not sent because support is unconfirmed.
- What the database stores as Q1's status for a submitted answer. The job writes `full` for an
  answered Q1 and `zero` for a blank one, both worth 0 points.
- Whether `activities.content.reference_pages` indexes the excerpt PDF or the book. The job falls
  back to the whole sidecar when a requested page does not exist.
- The per-preflight misconception table in `PROJECT.md` is not sent; the model sees the ids already
  recorded for the assignment and the generic table.

## A first live test on staging

Needs, from the operator: the three config files above with real values; a staging database that
holds an AI-drafted item past its deadline with synthetic submissions (`scripts/staging/seed_staging.py`
can be extended, or one made in the app); the GenAI.mil key unlocked and its project flag confirmed
as official work; and a few lessons' text sidecars or digests in place. Then, in order: `doctor`,
`models`, `run` (dry), `run --trial 3`, and only then `run --commit --expect-ref ...` by hand before
trusting cron. Read the drafts in the Grade page and the run record in the banner.

## Where the pieces are

- `supabase/admin/overnight_grade.py` - the command line.
- `supabase/admin/overnight/` - `config.py` (secrets and the staging wall), `llm.py` (client and model
  choice), `grounding.py`, `validate.py`, `grade_run.py` (selection, guards, grading), `aggregate_run.py`,
  `cycle.py` (one night), `store.py` (the only database code), `prompts/` (versioned prompt text).
- `supabase/admin/overnight_test.py` - offline tests (`python supabase/admin/overnight_test.py`).
- `supabase/admin/overnight_contract_test.py` - feeds a real `cmd_pull` output through the aggregator into the
  real `cmd_write` with a fake connection. Needs `psycopg2`, so run it with the repo's `.venv` Python.
