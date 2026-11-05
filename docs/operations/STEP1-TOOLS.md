# Step 1 tools

Read-only or dry-run-by-default tools for the day the first v2 migrations are applied to the live database.
Each takes its connection from a file named on the command line (`--env-file`, alias `--dotenv`) or from the name of
an environment variable (`--url-env`). None prints a password, a host, a name or a score. The live project is refused
unless the tool's own flag is given (`--allow-production-read`, or `--allow-production-write` for tools that change data).
Offline tests: `python scripts/staging/test_step1_tools.py`.

| Tool | What it does | Writes? |
|---|---|---|
| `scripts/staging/step1_precheck_run.py` | Runs the 19 checks in `step1_precheck.sql` beside their expected results, with OK, LOOK or NOTE, for a named `--stage`. Exits 1 on a LOOK. | No (read-only transactions) |
| `scripts/staging/step1_snapshot.py` | Writes 15 tables to a local folder as JSON lines and checks the files against counts taken in the same transaction and against live counts. Refuses a folder that git does not ignore. | Local files only |
| `scripts/staging/step1_compare.py` | Before and after: row hashes, every deadline, active extensions and the score columns of grades. Works without transaction numbers and prints what it cannot detect. | A local file (`save`) |
| `scripts/staging/step1_apply.py` | Runs migration files, rollbacks, ledger SQL or one statement through psycopg2 in place of `psql`, stops at the first failure, and records transaction numbers. Dry run unless `--commit`. | Yes, with `--commit` |
| `scripts/staging/step1_cadet_api_check.py` | Asks the public API, with no sign-in, for the queries the student pages send, each paired with a control that must fail. Shape only, not content. | No |
| `scripts/staging/step1_rehearse.py` | Drives all of the above, in order, on a throwaway database on the staging server, then drops it. | A throwaway database |
| `scripts/v2/backfill_paths.py` | Gained `--dotenv` (data-writing tier). Unchanged otherwise. | Yes, with `--commit` |

## What none of them can show

- Who changed a row, when no transaction number was recorded. The quiet window is the only evidence.
- What a signed-in cadet sees. The API check proves the shape of the answers; row level security is decided per user.
- A restore. The snapshot is a set of text files for checking and for recovering a row by hand; the restore path is the
  dump taken by the restore drill (`RESTORE-DRILL.md`).

## Transaction numbers

A migration file carries its own `COMMIT`, so it cannot report its own number. `step1_apply.py` reads `txid_current()`
before and after each file and records every number between them. On a quiet database that is the file's own
transaction; on a busy one the range also holds other sessions' numbers, which makes the comparison stricter, and the
tool says so when a range is wider than 50.
