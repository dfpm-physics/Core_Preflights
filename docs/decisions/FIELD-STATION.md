# Field Station: a redesign tried and set aside

**Status:** rejected for now, 2026-11-12. Kept for reference.

*Authored 2026-11-12 by Matthew Recker (via Claude). See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** Read it before you start a large visual redesign of PREP. It says that one
> was already tried, where the work is, and what it was. It is a point-in-time record.

## What it was

"Field Station" was a design experiment from early November 2026. It dressed the real PREP pages in a
new look: an ivory page, a pale stone left rail, a sage selected item with a brass marker, dark red
actions, and serif titles. It also tried small line-drawn physics sketches as calm empty states.

It was an overlay. It changed no file under `site/`, used the same `site/js/` modules, and read only
the staging database. It needed no migration.

## The decision

The course director, 2026-11-12:

> "I like it as a path we considered and rejected for now, it might be worth looking at in the future
> if anyone decides to attempt a large redesign. So I don't want to lose it but also do not want t
> pursue it anymore"

So the work is kept and not continued. No part of it is in `v2` or `main`.

## Where it is

Branch **`v2-field-station`**, commit `e7c2f79`, folder `_field-station/`. It holds the overlay site,
its local server (`serve.py`, staging only), 53 screenshots of every main page in light and dark, a
list of the pictures it still wanted (`GRAPHICS-NEEDED.md`), and its tools. Its `README.md` says how
to run it. The branch starts from `v2` as of 2026-11-07, so the pages it dresses have moved on since.

**Do not merge that branch.** Look at it, run it, or copy ideas out of it.
