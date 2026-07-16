# Archived — artifact receiver v1 (retired 2026-07-16)

Reference copies of the **original** lesson-interaction submission endpoints, retired when the
receiver moved into the app tree. Kept for reference only. **Nothing here is live, linked, or
served** — these files answer no URL.

## Why this directory starts with `_`

GitHub Pages builds this repo with its default Jekyll pipeline (there is no `.nojekyll`, no
`_config.yml`, and no Pages workflow). Jekyll does not copy files or directories whose names
begin with `_` into the published site, so `_archive/` stays in the GitHub repo and out of the
website. **Do not rename it** to `archive/`, and if anyone ever adds a `.nojekyll` file to the
repo root, Jekyll stops running and everything here becomes publicly reachable — move it out of
the published tree first.

(Even then nothing would *break*: the retired URLs 404 regardless of what lives here, so the
clean break holds. It would only mean a dead page is reachable at an unlinked URL.)

## What these were

| File | Was | Did |
|---|---|---|
| `site/artifact-submit.html` | the real receiver | decoded the `#r=` payload, required login, upserted `preflight_interaction_reports` |
| `site/interaction-submit.html` | alias | forwarded to `site/artifact-submit.html` |
| `root/artifact-submit.html` | frozen public endpoint | forwarded to `site/artifact-submit.html` |
| `root/interaction-submit.html` | legacy alias | forwarded to `site/artifact-submit.html` |

The old public URL was
`https://dfpm-physics.github.io/Core_Preflights/artifact-submit.html`, hardcoded inside deployed
Claude artifacts. It was retired in a deliberate clean break: all live artifacts were rebuilt
against the new endpoint before Fall 2026 began, and **no legacy redirect was kept** — the old
URL now 404s.

## What replaced it

- **Receiver:** `site/app/student/interaction-submit.html` — same transport contract (v1,
  unchanged), rewritten against the app's shared auth/nav/theme modules.
- **Public endpoint:** `site/student/interaction-submit.html` — a stub that forwards into the app
  tree and is overwritten by the real page at promotion.

The transport spec (`#t=`/`#i=`/`#r=`/`#d=`) did **not** change; only the URL did. See
`docs/contracts/INTERACTION-DATA-CONTRACT.md` and the 2026-07-16 CHANGELOG entry.

## One behavior worth knowing

The v1 receiver carried its **own inline login screen** rather than using the shared login page.
That was load-bearing, not sloppiness: the report lives entirely in the URL hash, and navigating
away to log in would discard it. The replacement keeps the shared login and solves the same
problem by stashing the payload in `sessionStorage` before `auth.js` can redirect. If you ever
port this logic again, handle that case — losing it silently destroys completed student work.
