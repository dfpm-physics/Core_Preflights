# Preflights portal (`site/app/`)

A role-aware rewrite of the front end: one shared auth bootstrap, a top navigation bar,
light/dark mode, and a dashboard landing page tailored to **students** vs **faculty**
(instructor/director/admin). Static HTML/CSS/JS — no build step. **No database changes.**

Dashboards, navigation, theming, auth, the AI lesson interactions, and the faculty
**Grade**, **Report**, and **Roster/Sections** tools all live here natively. The remaining
director tools (assignment builder / instructor management / export) still live on the
legacy site page (`site/admin.html`) and are reached via the **Admin ↗** link until ported.

## Structure

```
app/
  index.html            Router — resolves role, forwards to the right dashboard
  login.html            Unified login (cadet ID → @usafa.edu, or instructor email)
  student/              dashboard · assignments (submit/review) · interactions
  faculty/              dashboard · grade · report · roster (+sections) · interactions
  css/styles.css        Tokenized design system + dark theme
  js/                   supabase · auth · nav · theme · util · student-data
                        faculty-data · faculty-grade · faculty-report · faculty-roster
  media/icons/          PNG icons (+ ICON-SEARCH-PROMPT.md). Missing → ic-dashboard.png → emoji.
```

### How a page boots
`<head>` loads, in order: a tiny no-flash theme snippet → `css/styles.css` → the
supabase-js CDN (classic) → `js/config.js` (classic, sets `window.db`) → the page's
`<script type="module">`. Modules are deferred, so `window.db` always exists before module
code runs. The module then: `await bootstrap({ require })` → `renderNav(ctx)` →
load + render data.

## Run locally

From the **repo root** (so the legacy pages resolve too):

```
python -m http.server 8000
```

Then open <http://localhost:8000/site/app/>. Log in as a student (cadet ID + last-6 password)
or an instructor (email + password). The session persists across reloads and navigation;
sign out from the user menu.

> **No Node dependency here.** There is no build step, bundler, transpiler, eslint, or jest for this
> project. Node/npm may exist on a given machine, but the portal is plain ES modules + CSS the browser
> runs as-is. **Verify by loading the page in a browser** (the Python server above) against Supabase —
> there is no JS lint/test/typecheck pass to run.

## Deployment layout

The repository root is the GitHub Pages publishing source. Website source lives under `site/`, so
its public URLs include `/Core_Preflights/site/`. Paths inside `site/` remain relative, and
`legacyUrl()` resolves portal links to the legacy pages beside `site/app/`.

Small compatibility pages at the repository root preserve the permanent artifact endpoint, its
legacy alias, root entry navigation, and missing-page forwarding. The complete receiver stays at
`site/artifact-submit.html`.

## Not yet ported

Assignment builder, instructor management, and export still live on the legacy `admin.html`
(reached via the **Admin ↗** nav link). Faculty section-scoping is enforced in client JS
(mirroring the existing app), not RLS — true isolation would require new DB policies, which
are out of scope here.
