# Tutorials: guides that show a person around and walk them through real jobs

**Status:** accepted, 2026-11-10.

*Authored 2026-11-10 by Matthew Recker (via Claude). See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** Read it before adding a tutorial, changing the off-switch rule, or touching
> `site/js/tutorials.js` or `site/js/tutorials-catalog.js`. It is a point-in-time record. If the rules
> change, supersede it with a new file and link both ways.

## What a tutorial is

A tutorial is a guide drawn over the real page: a highlight on the control to use and a small card that
says what to do. There are two kinds.

| kind | starts | ends | leave button |
|---|---|---|---|
| **tour** ("Show me around") | by itself the first time (the welcome tour on a first sign-in, a page tour on the first visit to a main page), or by hand | after the last step, or when left | End tour |
| **task** ("Do it with me") | only by hand, from Help | when the real thing exists, for example the course is made | I've got it from here |

Every tutorial can be started by hand at any time from **Help, Tutorials** (also in the user menu), whatever the
off switch says. A task that needs a page the person is not on sends them there and carries on. A task is never
marked "seen", because it never starts by itself.

**I've got it from here** closes the guide. The page stays exactly as it is: nothing is undone and nothing the
person typed is cleared.

## Why the guide never clicks for the person

The engine draws a highlight that ignores the pointer, and it listens for the person's own clicks. It never
calls `preventDefault`, never clicks, and never types. The real thing is made by the real controls, under the
person's own permissions, so a tutorial cannot do anything the person could not do themselves, and the database
is never touched by it. The only thing it writes is the synced preference below.

For the same reason a destructive control is never a step (nothing that deletes, removes, resets a password, or
publishes). The grading task stops before Finalize and says so, and the assignment task ends with the assignment
saved and unpublished.

## The off switch for automatic tutorials

One synced preference, `cp.tutorials` (it follows the person to every device), holding
`{ auto, offAt, seen }` as JSON. The default is `{ auto: true, offAt: null, seen: [] }`.

- `TUTORIAL_RELEASE` (in `tutorials-catalog.js`) names the current release. Each tutorial has `since` (the release
  it arrived in) and `version`.
- An automatic tour starts when it applies to this page and role, **and** it is not already in `seen` at its
  version, **and** either `auto` is on, **or** its `since` is later than `offAt`.
- Turning tutorials off sets `auto: false` and `offAt` to the current `TUTORIAL_RELEASE`. So a tour for a feature
  newer than that moment shows once, says **New feature**, and offers the off switch again. That is how the switch
  is "overwritten when new features arrive, but can be disabled again".
- At most one automatic tour starts per page load, and none starts while a task is running.
- Finishing, ending or leaving an automatic tour marks it seen. A tour that was seen at version 1 shows again
  when its version is raised to 2.
- Account, Preferences has **Automatic tutorials** (On or Off) and **Show tours again**, which clears `seen`.

The rule is a pure function (`shouldShowAuto`, `pickAuto`, `planMount` in `tutorials.js`) and is tested offline.

## How the engine behaves

- Run state is kept in `sessionStorage` (`cp.tutorial.run`), so a guide survives a page change and a reload and
  ends with the browser tab.
- A step names its page, a CSS target, and how it moves on: `next`, a click on an element, a field being filled,
  something appearing (`until`) or disappearing (`gone`), or arriving on a page. The target is looked up fresh on
  every look, because these pages re-render whole sections. An optional step that moves on with Next and whose
  target is not on the page (a new course has no backlog and no gradebook columns) is shown after a moment without a
  highlight, with one line from its `absent` field saying why. Any other optional step is skipped after 8 seconds.
  A required one says plainly that it cannot find it, with Try again.
- A step that waits for a result (`until`) counts only something new, or something that was hidden and now shows,
  so a stale message from an earlier try is not read as the answer.
- The card is placed beside the target, then above or below, and never on top of it. On a narrow screen it docks
  to the bottom and the page is scrolled so the target stays above it. It does not bind Escape (the page's modals
  use it) and does not move focus.
- A task that a non-administrator cannot finish (creating a course is a site administrator's job) has a shorter
  path for them (`stepsNonAdmin`), so nobody reaches a dead end.
- The Help list is cumulative among staff (an administrator also sees director and instructor tutorials), but
  staff are never offered a cadet tutorial: cadet pages send a staff member back to their own dashboard, so it
  could not run. A cadet sees only cadet tutorials.

## Adding a tutorial

1. Add an entry to `TUTORIALS` in `site/js/tutorials-catalog.js`: `id`, `kind`, `tier`, `title`, `summary`,
   `since`, `version`, `steps`, and `auto: { page }` for a tour that should start by itself. Use real selectors.
   A step whose target exists only for some roles must be `optional: true`.
2. If it is a tutorial for a **new feature**, set `TUTORIAL_RELEASE` to today's date and give the entry that
   `since`. People who turned automatic tutorials off will see it once.
3. If a page changes so that a tutorial no longer fits, raise that tutorial's `version`.
4. Run `node tests/app-schema/test-tutorials.mjs`. It checks the catalog's shape and, by name, that every id, class
   and data attribute a step uses is still found in the page or a module under `site/js/`. A renamed control fails
   there, not in front of a user.
5. If you changed how tutorials behave, update `site/help/using-tutorials.md` and re-date it in
   `docs/DOC-SOURCES.json`.

## What was not done

- A tutorial has no "next step" suggestion based on what the person has already done.
- The preference is per account, not per course: turning tutorials off applies to every course.
- The browser also keeps a copy of the preference for first paint. On a shared browser a second person's first
  sign-in can inherit the previous person's copy until their own account's value arrives.
