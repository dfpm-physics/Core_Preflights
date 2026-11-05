# tests/browser-harness — the P0.5 walkthrough, driven

**OPTIONAL developer tooling.** Nothing here is served, imported, or needed to deploy — the same
status as `tests/app-schema/`, and for the same reason (CORE.md §2). Delete this folder and the
site is byte-identical.

## What it is for

Eight CHANGELOG entries record the same gap: surfaces that are logic-verified and syntax-clean but
**have never been looked at** by a signed-in human. Roadmap P0.5 is the session that closes it.

This harness makes that session repeatable instead of a one-off. It drives real Chrome against a
local server that can reach the **staging** Supabase project and not production, signs in, walks a list of pages in light and
dark, and records every console error, page error, and failed request along the way.

## What it does not do

**It does not replace looking.** It catches the class of failure a human misses — a console error
on a page that renders fine, a request 404ing quietly — and it takes the screenshots. Deciding
whether the staff table's rows are the same height is still a human judgment, which is the whole
point of P0.5.

## Requirements

- Node (optional per CORE.md §2 — this whole folder is why that rule says "optional")
- Chrome or Edge installed at a standard Windows path (auto-detected; override with `--chrome`)
- Python, for the local server (`scripts/staging/serve_local.py`)
- A seeded staging database: `scripts/staging/seed_staging.py` creates the director and cadet
  logins these scripts use (its header lists them). Run it first, and again to move deadlines back
  around today.

## Logins: seeded staging accounts, no credential file

`env.mjs` supplies the seeded staging director (an invented person) by default, so no credential
file is opened and the normal invocation carries **no secret**. A different staging login can be
given through the environment (`PREP_TEST_FACULTY_EMAIL` / `_PASSWORD` / `_UID`), and `--email` /
`--password` still override for a one-off. Chrome is launched with the production API host
unresolvable, so a page that carries its own copy of that address cannot reach it.

## Use

```bash
# from the repo root
python scripts/staging/serve_local.py   # in one terminal (not http.server)

# default staging login from env.mjs — nothing secret on the line
node tests/browser-harness/pass.mjs
node tests/browser-harness/pass.mjs --theme dark
node tests/browser-harness/pass.mjs --lesson <assignment-offering-uuid>   # also walk the rollup

node tests/browser-harness/pass.mjs --student        # the test cadet instead of faculty

# the targeted P0.5 assertions, one run per tier. Flipping the account's tier with
# test_faculty_account.py acts on the project in supabase/admin/.env (production), not on staging,
# so do not use it for these runs; seed the tier you need on staging instead.
node tests/browser-harness/checks.mjs --tier director --lesson <uuid>

# the Assignments page and its editor, signed in — read-only, never saves (see its header)
node tests/browser-harness/lesson-editor.mjs
```

Two scripts here need **no server and no account**, because they inline the module under test into
a synthetic page. Run them from anywhere:

```bash
node tests/browser-harness/hold.mjs     # hold-to-confirm, driven by a real mouse
node tests/browser-harness/modal.mjs    # dialog dismissal: a drag that starts inside never closes
```

Each exists because its bug was invisible to every offline suite and was reported by the director
rather than caught here — the file headers say which bug, and which single assertion was ever
false.

## Screenshots go to the scratchpad, never the repo

Faculty pages render real cadet names. AGENT-DB-ACCESS.md rule 9 — keep PII out of the repo —
applies to a PNG exactly as much as to a JSON dump, and a screenshot is the easiest way to commit
a roster by accident. The output directory defaults to the session scratchpad and the harness
refuses to write inside the repo.
