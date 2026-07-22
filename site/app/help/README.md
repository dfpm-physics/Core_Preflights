# Help content — how to add a document

Everything the in-app **Help** page shows lives in this directory. Adding a topic is two steps:
drop a Markdown file here, add one entry to `MANIFEST.json`. No code change, no deploy step
beyond the normal commit-and-push to `main`.

This file is *not* served to users — it is not listed in `MANIFEST.json`, so the Help page never
shows it.

## 1. Write the Markdown file

Name it `<audience>-<topic>.md` (e.g. `instructor-extensions.md`). Plain CommonMark; it is rendered
with `marked` and sanitized with `DOMPurify` before it reaches the page, so raw HTML and scripts are
stripped. Start at `##` — the page prints the manifest `title` as the `<h1>` above your content.

Relative links resolve against the *page* (`site/app/student/help.html`), not this folder. Link to
another help topic with a query link — `[Grading](help.html?doc=grading)` — and to anything else
with a full path from the site root or an absolute URL.

## 2. Add it to `MANIFEST.json`

```json
{
  "id": "extensions",
  "tier": "instructor",
  "title": "Granting extensions",
  "summary": "One line shown on the Help index card.",
  "file": "instructor-extensions.md"
}
```

- **`id`** — stable, kebab-case, unique. It is the deep link (`help.html?doc=extensions`), so
  changing it breaks any link anyone saved.
- **`tier`** — the *lowest* role that may see the document. Tiers are cumulative in this order:

  | `tier` | Shown to |
  |---|---|
  | `student` | everyone |
  | `instructor` | instructors, directors, system admins |
  | `director` | directors and system admins |
  | `admin` | system admins only |

  A course director of Phys 215 who is only an instructor in Phys 110 sees director docs while
  Phys 215 is the selected course and loses them on switching — the tier follows
  `ctx.isDirectorForCurrent()`, which is per-course by design.
- **`file`** — the filename in this directory. The Help page only ever fetches paths that appear
  here; the `?doc=` parameter selects an `id`, never a path, so a crafted URL cannot reach outside
  this folder.

Order within the file is the display order inside each tier group.

## 3. Register it in `docs/DOC-SOURCES.json`

A help doc that disagrees with the system is a bug (`CORE.md` §5), so every topic here is indexed
against the authoritative sources it was written from, plus a `reviewed` date attesting somebody
checked it against them. Registering a new topic is part of creating it — see
`.ai/skills/docs-author/`.

### The "may be out of date" banner

When one of a topic's sources changes after its `reviewed` date, the Help page **tells the reader**:
a chip on the index card and a warning above the content. Staff are shown which source files moved;
students are told to trust the screen and ask an instructor, because a path like
`.ai/instructions/CORE.md` on a cadet's page reads as a malfunction rather than a caveat.

**This is driven by a generated file and does not update itself.** A browser cannot run `git`, so
`site/app/help/DOC-STATUS.json` carries the verdict, computed on someone's machine and committed:

```
python scripts/docs/check_doc_sources.py status --write
```

Run it whenever you run the check, and commit the result alongside whatever made it change — a
stale status file is a silent all-clear, which is worse than no banner. It is generated from
committed history only, so your working tree does not affect what readers see. `check` prints a
reminder when the published file and the live verdict disagree.

Two ways to clear a banner, and only one of them is honest: **re-read the topic against the
sources that changed**, then either fix it or bump its `reviewed` date. Bumping the date without
reading is attesting to a review that did not happen, and it is the one failure this whole
mechanism exists to prevent.

If the file is missing or malformed the Help page renders exactly as it did before, with no
warning anywhere — help must never fail closed because a developer tool did not run.

## Tier gating is presentation, not security

These files are static assets on GitHub Pages. **Anyone who knows or guesses the URL can read any
of them, signed in or not** — the tier only decides what the Help page *lists*. Nothing here may
contain a service key, a database credential, student PII, or answer keys. Content that genuinely
must be restricted belongs behind Supabase RLS, not here.

## Verifying a change

No build step (see `CORE.md` §2). From the repo root:

```
python -m http.server 8000
```

then open `http://localhost:8000/site/app/student/help.html` and
`http://localhost:8000/site/app/faculty/help.html`.

One deploy caveat worth knowing: the repo has no `.nojekyll`, so GitHub Pages runs these through
Jekyll. Markdown files **without YAML front matter are copied verbatim** and served at their `.md`
URL, which is what the Help page fetches — so do not add front matter to a help doc, or Jekyll will
convert it to HTML and the fetch will 404. If a doc ever 404s on the live site but works locally,
that is the cause; adding a root `.nojekyll` is the fix (coordinate it — it also starts publishing
`_archive/`).
