# tests/browser-harness — the P0.5 walkthrough, driven

**OPTIONAL developer tooling.** Nothing here is served, imported, or needed to deploy — the same
status as `tests/app-schema/`, and for the same reason (CORE.md §2). Delete this folder and the
site is byte-identical.

## What it is for

Eight CHANGELOG entries record the same gap: surfaces that are logic-verified and syntax-clean but
**have never been looked at** by a signed-in human. Roadmap P0.5 is the session that closes it.

This harness makes that session repeatable instead of a one-off. It drives real Chrome against a
local server pointed at the **live** Supabase project, signs in, walks a list of pages in light and
dark, and records every console error, page error, and failed request along the way.

## What it does not do

**It does not replace looking.** It catches the class of failure a human misses — a console error
on a page that renders fine, a request 404ing quietly — and it takes the screenshots. Deciding
whether the staff table's rows are the same height is still a human judgment, which is the whole
point of P0.5.

## Requirements

- Node (optional per CORE.md §2 — this whole folder is why that rule says "optional")
- Chrome or Edge installed at a standard Windows path (auto-detected; override with `--chrome`)
- Python, for the static server
- A faculty account. Creating one is **not** something the tooling can do — no role available
  here has any privilege on schema `auth`. See roadmap P0.5.

## Use

```bash
# from the repo root
python -m http.server 8000            # in one terminal

node tests/browser-harness/pass.mjs --email <addr> --password <pw>
node tests/browser-harness/pass.mjs --email <addr> --password <pw> --theme dark
node tests/browser-harness/pass.mjs --student        # the test cadet, no credentials needed
```

## Screenshots go to the scratchpad, never the repo

Faculty pages render real cadet names. AGENT-DB-ACCESS.md rule 9 — keep PII out of the repo —
applies to a PNG exactly as much as to a JSON dump, and a screenshot is the easiest way to commit
a roster by accident. The output directory defaults to the session scratchpad and the harness
refuses to write inside the repo.
