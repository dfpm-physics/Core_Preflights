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

## Running

```
cd tests/app-schema
npm install          # once — installs @supabase/supabase-js only
npm test
```

`node_modules/` is gitignored.

## What it covers

| Layer | File | Proves |
|---|---|---|
| Pure logic | `test-schema.mjs` | Deadline precedence, status derivation, lock policy, effort→points — imported from the real `schema.js`, no network |
| Config | `test-config.mjs` | `site/js/config.js` actually sets `db.schema = 'app'` |
| Query shape | `test-rest.mjs` | Every PostgREST projection the app ships is valid against the live schema |
| End-to-end | `test-student.mjs` | The real `student-data.js` run as a signed-in student, through RLS |
| Isolation | `test-isolation.mjs` | The student sees only their own work, and nothing from `public` |

## The test account

Tests sign in as **`3009999999` — "ZZ Test Cadet"**, a deliberate test row at the top of the
valid cadet-ID range, using the documented default password scheme (last six digits of the
ID). No real cadet's account is touched.

> **This account is grandfathered, not typical.** It was provisioned before 2026-07-21, so its
> auth email is the old fabricated `3009999999@usafa.edu` (hardcoded in `harness.mjs`) rather
> than a real address from the registrar export. Two things follow: do not read it as an example
> of how accounts are created now, and **do not reset its password** — a reset sets the
> forced-rotation flag, after which every live suite fails at sign-in until someone completes a
> password change by hand.

Writes made by the end-to-end tests are confined to that account's own rows and are cleaned
up afterwards. If a run is interrupted, `node cleanup.mjs` removes any residue.

## The browser shim

The site's modules assume a browser: `config.js` is a classic script that sets `window.db`,
and `auth.js` reads `location` and `localStorage`. `harness.mjs` provides just enough of
those globals for the modules to load unmodified — the point is to test the shipped file, so
nothing is stubbed that the test is trying to prove.
