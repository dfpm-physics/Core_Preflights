# Field Station (design experiment)

An overlay that dresses the real PREP pages in the "Field Station" look: ivory canvas, pale stone left
rail, sage selected item with a brass marker, oxblood actions, serif titles. Nothing under `site/` or
any other existing file is changed. Delete this folder and the experiment is gone.

It uses the same `site/js/` modules and the same staging database. There is no migration.

## Run it

From the repository root, in PowerShell 5.1 (no `&&`; use `;`):

    python _field-station/serve.py --port 8045

Open `http://localhost:8045/site/`. The server reuses `scripts/staging/serve_local.py` (staging only,
production refused, bound to 127.0.0.1). `--check` reads the files and reports whether any still name
production, without serving.

A request under `/site/` is answered from `_field-station/site/` first, then from `site/`. The server
adds one stylesheet and one module script to each portal page. `site/js/nav.js` is overlaid; the real
one is reachable to it as `js/nav-base.js`. `site/student/dashboard.html` is replaced by an overlay page.

Preview the lesson sketch on any assignment: add `?fs-sketch=dipole` to the student dashboard URL.

## Undo

    Remove-Item -Recurse -Force _field-station

Nothing else needs reverting. `git status` shows only `_field-station/` as new.

## What is in it

- `serve.py`, `site/fs/field-station.css` and `.js`, `site/js/nav.js`, `site/js/fs-student-dashboard.js`,
  `site/student/dashboard.html`.
- `site/fs/icons/`, `site/fs/graphics/`: copied from the design package; only what is used.
- `site/fs/sketch-map.json` and `site/fs/sketches/`: which topics get the field sketch. It matches the assignment TITLE
  only, and every pattern names electric charge, field or force. `python _field-station/tools/test_sketch_map.py` checks
  right and wrong titles (a magnetic or gravitational field-lines title must not match).
- `tools/make_field_sketch.py` and `tools/test_make_field_sketch.py`: draws the field of two opposite
  charges by integrating the true field; the test checks every arrow against the field.
  `python _field-station/tools/test_make_field_sketch.py`
- `tools/contrast.py`: prints the WCAG ratios for the palette pairs.
- `tools/node/shoot.mjs`: the screenshot and audit driver (see below). `GRAPHICS-NEEDED.md`: art still wanted.
- `screens/`: the proof screenshots.

## Proof driver (optional developer tooling)

Needs Node and Edge. Launching Edge from a child process fails on this machine, so start it by hand:

    Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--remote-debugging-port=9333","--user-data-dir=C:\fsprofile","--headless=new"

Then, in `_field-station/tools/node` (first time: `npm install`), run for example:

    node shoot.mjs --who cadet101 --pages dashboard,lessons --modes light,dark,phone --audit

Logins come from the staging seed file's own rule and are never printed. Theme is set on the page, not
in storage, so no preference row is written. It refuses anything but localhost and blocks production.

## Behaviour worth knowing

- The two frozen contract pages (`faculty/lessons.html`, `student/interaction-submit.html`) get the theme only: no table
  wrapping and no emoji swap.
- An emoji with no matching icon is left as the page wrote it. Warning, error and success glyphs get warning, error and
  success icons.
- The server answers a path containing a NUL byte or a backslash with 400, collapses `//`, and matches the no-injection
  folders without regard to case.
- The context bar names sections only for staff who teach them. A director or staff member teaching none sees the role.
- On the student dashboard a lesson with two ways to do it always opens the page that shows both.

## Shared modules overlaid (for a later merge)

Only two. Everything else is the real `site/` file, served unchanged.

- `site/js/nav.js`: wraps the real `renderNav` (kept reachable as `js/nav-base.js`), adds the rail, context bar, help link.
- `site/student/dashboard.html` with `site/js/fs-student-dashboard.js`: the rebuilt student dashboard.

Emoji headings (faculty pages, empty states, the Feedback button) are NOT fixed by overlaying the modules that write
them. `site/fs/field-station.js` swaps the leading emoji for the package icon after the page renders, and the words
stay live text. Each one it covers, and where the emoji is written in the real source:
`faculty-tasks.js` (Needs your attention), `faculty-dashboard.js` (Your section), `faculty-ei.js` (Extra instruction),
`grade.html` (Needs grading by hand), `feedback.js` (Feedback button), and the empty-state pictures in `items.html`,
`questions.html`, `scale.html`, `terms.html`, `gradebook.html`, `lessons.html`, `feedback.html`, `help.js`.
A real merge would change those source lines to `iconHTML(name)` and drop the swap.

## Not done

- Not added to CI, and not wired into the shipped site.
- Page-authored status glyphs (check marks, warning marks, arrows inside sentences) remain; only headings, empty-state
  pictures and the Feedback button were swapped.
- The login crest emoji remains.
- Screens for admin, system, terms and health may include another worker's "ZZ proof" course.
- Phone gradebook: below 700px the Total column scrolls with its row instead of sticking.
