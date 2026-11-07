# Restore drill

A backup nobody has restored is a hope. This drill takes a `pg_dump`, restores it into a scratch
Supabase project, and writes down how long each step took and whether the row counts match.
The tool is `scripts/staging/restore_drill.py`; offline tests are `scripts/staging/test_restore_drill.py`.

## What a dump does NOT capture

This is the useful part. Restoring a dump gives back the tables and rows. It does not give back the
project around them.

| Not in the dump | Consequence | Where it comes from instead |
|---|---|---|
| Storage bucket files (`lesson-figures`, `artifact-sources`) | The `storage.objects` rows may exist, but the files do not. Artifact sources would be gone. | The `sync_artifacts.py pull` cache, and the Storage dashboard |
| Auth settings (providers, password rules, redirect URLs, JWT secret, email templates) | Sign-in behaves differently or fails | Re-enter in the dashboard |
| Edge functions and their secrets | Password resets, provisioning and online-answer checking stop working | `scripts/staging/deploy_functions.py` deploys the allow-listed functions (it refuses the two AI proxy functions by name, so those are redeployed by hand), then dashboard secrets |
| Database roles (`prep_app_owner`, `prep_app_dml`, `prep_app_read`) and their passwords | Roles are cluster-wide, so a per-database dump leaves them out; `--no-acl` drops the grants | `supabase/admin/app_schema_bootstrap.sql` on the new project, then re-apply grants |
| Ownership (`--no-owner`) | Objects belong to whoever ran the restore | Re-run the bootstrap ownership step |
| Extensions, `pg_cron` jobs, realtime publications, webhooks | Missing until recreated | Migrations and the dashboard |
| API keys, the project URL, the anon or publishable key | A restored project has new ones | `site/js/config.js` must be pointed at the new project |
| Anything in the dashboard (custom domains, network restrictions, billing tier) | Not restored | By hand |

Roughly: a dump saves the data. A rebuilt project also needs the bootstrap SQL, the migrations, the
function deploy, the secrets, the Storage files, and a config change. The drill times the first part
only; put a realistic time on the rest in the table at the end.

## What a Supabase project needs from a restore

- The `auth` schema is owned by Supabase and already exists in the new project. Do **not** restore it
  whole. The `app` tables reference `auth.users`, so the drill copies only `auth.users` and
  `auth.identities`, data only, with `--include-auth-users`. Password hashes travel with those rows.
- The `storage` schema is likewise owned by Supabase. Bucket rows are not copied by this tool.
- Use `--no-owner --no-acl`: the original owner roles do not exist on the target. The tool does this.
- The dump is `pg_dump -Fc` (custom format) restored with `pg_restore`, one schema at a time
  (default: `app`).
- `pg_dump` must be the same major version as the server, or newer. The tool refuses an older client.
- Connect with the direct or session-pooler string, not the transaction pooler (port 6543).
- Restore into an **empty** project. The tool does not drop anything.

## The rules the tool enforces

- Every URL is read by `scripts/staging/db_target.py`, the same reader the other staging tools use.
  The project it really names must equal the ref you declared for it. A URL that carries the
  declared ref anywhere but the user or host, a percent escape in the user or host, or any query key
  other than `sslmode`, is refused.
- The target must not be the production project in any form, must not be the source, and must be
  declared with `--target-is-scratch`.
- The staging project is never a target, with one exception: the staging rehearsal below, which
  restores staging into a throwaway `drill_*` database on the staging server and needs both refs to
  be staging. Real cadet data must never be restored to staging. A production dump goes only to a
  scratch project that the course director creates and deletes.
- Connection details are passed to the client tools in `PG*` environment variables. They never appear
  on a command line, in output, or in the result file. Row counts list table names and numbers only.
- The dump file is deleted after the run unless `--keep-dump` is given. A production dump holds real
  data: do not keep it.

## Needs on the machine

The PostgreSQL client tools: `pg_dump`, `pg_restore` and `psql`, at a major version at least equal to
the server's. They are not installed by anything in this repo. A human installs them. The tool says
plainly when they are missing and exits with code 3.

## Run 0: staging rehearsal on the staging server (an agent may run this)

Staging holds only invented data, so this is safe to run. The tool creates one database named
`drill_*` on the staging server, puts stand-ins for the parts of schema `auth` that the dump needs
(a users table filled with the source's ids, and `uid()`, `role()`, `jwt()`), restores schema `app`
into it, compares row counts, and drops that database. It never drops a database it did not create.
The source URL is taken from `STAGING_DB_URL` when `DRILL_SOURCE_DB_URL` is unset. Do not pass
`--include-auth-users` here: the stand-in table has only an id column.

```
py -3 scripts/staging/restore_drill.py --source-ref <staging ref> --target-ref <staging ref> --target-db drill_x --pg-bin "<folder with pg_dump>"
py -3 scripts/staging/restore_drill.py --source-ref <staging ref> --target-ref <staging ref> --target-db drill_x --pg-bin "<folder with pg_dump>" --commit
```

## Run 1: staging to a scratch project (an agent may run this)

1. Create an empty scratch project in the dashboard. Note its ref.
2. Set the two variables, then run the dry run. The variables hold connection strings: do not paste
   them anywhere else.
3. Dry run, then `--commit`:

```
py -3 scripts/staging/restore_drill.py --source-ref <staging ref> --target-ref <scratch ref> --target-is-scratch --include-auth-users --pg-bin "<folder with pg_dump>"
py -3 scripts/staging/restore_drill.py --source-ref <staging ref> --target-ref <scratch ref> --target-is-scratch --include-auth-users --pg-bin "<folder with pg_dump>" --commit
```

4. Delete the scratch project when the numbers are recorded.

## Run 2: production to a scratch project (Matthew runs this in PowerShell 5.1)

Production holds real cadet data. Use a brand-new scratch project and delete it afterwards.

```
$env:DRILL_SOURCE_DB_URL = Read-Host "Production connection string"
$env:DRILL_TARGET_DB_URL = Read-Host "Scratch connection string"
py -3 scripts/staging/restore_drill.py --source-ref shzvpmlnqfmzfmuxkowi --target-ref <scratch ref> --target-is-scratch --include-auth-users --pg-bin "C:\Program Files\PostgreSQL\17\bin"
py -3 scripts/staging/restore_drill.py --source-ref shzvpmlnqfmzfmuxkowi --target-ref <scratch ref> --target-is-scratch --include-auth-users --pg-bin "C:\Program Files\PostgreSQL\17\bin" --commit
Remove-Item Env:DRILL_SOURCE_DB_URL, Env:DRILL_TARGET_DB_URL
```

Then delete the scratch project in the dashboard and copy `restore-drill-result.json` numbers (not
the file itself, if it is outside the repo) into the table below. The result file holds table names
and counts, no credentials. Do not commit it.

## Results

**Read the first column for what it is.** Run 0 timed a dump of a small invented dataset (117 rows
in 28 tables, about 195 KB) over the staging pooler. It shows that the tool, the client versions and
the restore path work end to end. It says nothing about how long a production-size dump and restore
take. That run (Run 2) is still owed, by the course director, into a scratch project.

| Field | Run 0 (staging rehearsal) | Run 1 (staging to scratch project) | Run 2 (production) |
|---|---|---|---|
| Date | 2026-11-04 | | |
| Run by | an agent, for the course director | | |
| pg_dump version | 17.11 | | |
| Source server version | 17.6 | | |
| Target server version | 17.6 (same server, scratch database) | | |
| Dump size (bytes) | 195337 | | |
| Dump seconds | 7.01 (an earlier attempt: 11.38) | | |
| Restore seconds | 23.27 | | |
| Tables compared | 28 | | |
| Mismatched tables | 0 | | |
| pg_restore error lines | 0 | | |
| Estimated time to rebuild the rest (functions, secrets, Storage, config) | not measured | | |
| Scratch project deleted | n/a: the `drill_*` database was dropped by the tool; none remain | | |

Notes on Run 0. Dump and restore were run from a Windows machine over the internet, so the times
are dominated by round trips to the pooler, not by data volume; do not extrapolate them. The first
attempt used `--include-auth-users`, which fails against the stand-in users table (the real
`auth.users` has more columns); that option is for a real scratch project. The second attempt, without
it, is the one recorded above.

## Production backup dashboard checklist

Record these on the production project's backup page. Do not paste any key or password here.

- [ ] Plan tier: ______
- [ ] Daily backups on? Retention in days: ______
- [ ] Point-in-time recovery enabled? Window: ______
- [ ] Date and time of the newest backup: ______
- [ ] Who holds owner or admin access to the organization and project (names): ______
- [ ] Is there a second person who can start a restore? ______
- [ ] Does a backup include Storage files? (Expected: no.) ______
- [ ] Is billing current, so the project will not be paused? ______
