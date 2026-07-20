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
  student/              dashboard · assignments (submit/review) · interactions · help
  faculty/              dashboard · grade · report · roster (+sections) · interactions · help
  help/                 Help content: Markdown docs + MANIFEST.json (see help/README.md)
  css/styles.css        Tokenized design system + dark theme
  js/                   supabase · auth · nav · theme · util · student-data · help
                        faculty-data · faculty-grade · faculty-report · faculty-roster
  media/icons/          PNG icons (+ ICON-SEARCH-PROMPT.md). Missing → ic-dashboard.png → emoji.
```

Help is reached from the **user dropdown**, not the nav bar. Topics are tiered
(`student` → `instructor` → `director` → `admin`, cumulative) and each tier sees everything below
it; the gate is presentation only, since the files are public static assets. To add a topic, drop a
`.md` in `help/` and add a manifest entry — no code change. See [`help/README.md`](help/README.md).

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

Two small stubs hold the frozen contract URLs open while the app tree still lives under
`site/app/`: `site/student/interaction-submit.html` (artifact report submissions) and
`site/faculty/lessons.html` (AI-generated prefill links). Each forwards into `site/app/`,
preserving the query and hash where the payloads ride.

They are **self-eliminating**: at promotion the app tree moves up and the real pages land on
exactly those paths, overwriting the stubs. So the public URLs are identical before and after
go-live and need no edit — which is the whole reason the stub paths mirror the app's own
`student/` and `faculty/` naming. Don't "tidy" them into `students/`/`faculties/` or move them.

At the repository root, only `index.html` (entry navigation) and `404.html` (missing-page
forwarding) remain — GitHub Pages publishes from the root, so those two cannot move.

## Not yet ported

*Verified 2026-07-16. Full detail: [`COURSE-ADMIN-INVENTORY.md`](COURSE-ADMIN-INVENTORY.md) ·
build plan: [`PLAN-2026-07-16-ADMIN.md`](PLAN-2026-07-16-ADMIN.md).*

Two director features still live only on the legacy `admin.html` (reached via the **Admin ↗** nav
link), and **promotion deletes that page** — so both must be built natively before the app tree moves
up, or the course loses them:

- **Instructor / staff management** — add, change role, remove. Zero code in `site/app/`; the
  `create-instructor` / `remove-instructor` edge functions already exist and are unchanged.
- **Export** — Blackboard grades CSV and the full JSON backup.

**The assignment builder *did* mostly port** — into the **lesson creator**
([`faculty/lessons.html`](faculty/lessons.html)), where a preflight is a component of a lesson rather
than a standalone item. Missing there: **duplicate**, and standalone (non-lesson) authoring.

**`js/faculty-report.js` is intentionally dormant** — it is the ported query layer for the legacy
by-question Report tab, which will be **merged into the lesson rollup summary** rather than shipped as
its own page. Nothing imports it yet. **Don't delete it as dead code.**

Faculty section-scoping is enforced in client JS (mirroring the existing app), not RLS — true
isolation would require new DB policies. Migration 021 begins that repair, but is **not yet applied**.
