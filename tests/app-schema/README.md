# `tests/app-schema/` — wiring tests for site/app → schema `app`

**This is optional developer tooling. It is NOT part of the website and NOT a build step.**

CORE.md §2 says the project has no Node dependency or build step, and that still holds: the
site is hand-authored ES modules a browser runs directly, with nothing compiled, bundled, or
transpiled. Nothing here is served, imported by the site, or required to deploy. Delete this
folder and the site is unchanged.

What Node buys us is the one thing a browser cannot give cheaply: running the **shipped
modules themselves** — `site/js/schema.js`, `student-data.js`, `auth.js` — against the
live database, as a real signed-in user, and asserting on what comes back. The alternative
was reimplementing the same logic in Python and testing the reimplementation, which proves
nothing about what ships.

## Which database: staging, and only staging

These suites run against the **staging** Supabase project and refuse everything else.

- `harness.mjs` reads the staging address and publishable key from the `PREP_STAGING` entry in
  `site/js/config.js`, then requires the address to be exactly the staging project's
  (`target.mjs`). It throws at import time otherwise, so no client is ever created for another
  address. The rule is fail-closed: it asks "is this exactly staging", never "is this production".
- `run.mjs` asserts the same again, and runs `cleanup.py` only when `STAGING_DB_URL` names staging.
- `cleanup.py` takes its connection string only from `STAGING_DB_URL` and refuses anything that
  does not name staging, before it imports a database driver. It reads no credential file.
- `test-target-guard.mjs` proves every refusal **offline** (wrong address, empty, unset, lookalike
  hosts, a child process importing the harness or launching `run.mjs` or `cleanup.py` with a
  wrong target), and scans `tests/` for any other route to the other project.
- `tests/browser-harness/` launches Chrome with the other project's host unresolvable, and logs in
  with the seeded staging director (`env.mjs`); it opens no credential file.

The test accounts are made up and are created by `scripts/staging/seed_staging.py`
(see its header). The test cadet is `3009999999`, sign-in `cadet999@prep-staging.example`.

## Running

```
cd tests/app-schema
npm ci               # once: installs @supabase/supabase-js only
# offline suites only (no network, no secrets)
node test-target-guard.mjs
# everything, with STAGING_DB_URL set in the environment (the cleanup step needs it)
node run.mjs
```

**What CI does not run.** CI has no database, so two checks in `test-db-schema.mjs` are reported
as skipped there and never as passes: the drift check (`site/js/db-schema.js` against the staging
schema) and the check that every function in schema `app` pins its search_path. They run only
when `STAGING_DB_URL` is set, as in a full `node run.mjs`. The CI job states this in its summary.

A suite that records no checks fails the run (`zero-checks.mjs`). The one exception is
`test-edge-functions.mjs`, and only when it prints the exact `[SKIPPED]` marker at the start of a line.

Set `PREP_PYTHON` to a Python that has `psycopg2` if there is no `.venv` in the clone. Without
`STAGING_DB_URL` the suites still run; only the between-run cleanup is skipped, with a warning.

Seed (or re-seed, which moves the deadlines back around today) first:
`python scripts/staging/seed_staging.py --expect-ref <staging ref> --commit`.

### Result vocabulary

`[pass]`, `[FAIL]`, `[SKIPPED] <reason>` (did not run, never counted as a pass) and
`[xfail] ... expected-fail: <tag>` (a check whose fix ships later; it turns into a failure the
moment it passes, so the marker cannot be left behind). Both come from `harness.mjs`.

`node_modules/` is gitignored.

## What it covers

| Layer | File | Proves |
|---|---|---|
| Target guard | `test-target-guard.mjs` | The suites can only reach staging (offline) |
| Pure logic | `test-schema.mjs` and the other offline suites | Deadline precedence, status derivation, lock policy, effort to points, from the real modules, no network |
| Config | `test-config.mjs` | `site/js/config.js` sets `db.schema = 'app'`, and only the published address reaches production |
| Query shape | `test-rest.mjs` | Every PostgREST projection the app ships is valid against the live schema |
| End-to-end | `test-student.mjs` | The real `student-data.js` as a signed-in cadet, through RLS, including the lock and unlock checks |
| Isolation | `test-isolation.mjs` | Anonymous gets nothing; a cadet sees only their own rows; one course's staff see nothing of another |
| Edge functions | `test-edge-functions.mjs` | The account functions' authorization and refusals, live. The two proxies are SKIPPED (not deployed to staging) |
| Paging | `test-paging.mjs` | A whole-course read returns the whole course |

`test-db-schema.mjs` compares the catalogue with staging, and checks that every `app` function pins
its search path, when `STAGING_DB_URL` is set. Without it, both checks report SKIPPED.

## The test account

Tests sign in as **`3009999999`, "Zed Testcadet"**, an invented cadet in the seeded staging
course, with the site's default password rule (last six digits of the ID). Writes made by the
end-to-end tests are confined to that cadet's own rows. `cleanup.py` removes the residue (RLS
gives nobody DELETE on submissions, so the suite cannot do it itself); `run.mjs` calls it before
and after the live suites.

## The browser shim

The site's modules assume a browser: `config.js` is a classic script that sets `window.db`,
and `auth.js` reads `location` and `localStorage`. `harness.mjs` provides just enough of
those globals for the modules to load unmodified — the point is to test the shipped file, so
nothing is stubbed that the test is trying to prove.
