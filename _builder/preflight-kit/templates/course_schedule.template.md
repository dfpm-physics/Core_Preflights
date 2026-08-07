# <COURSE_SHORT> — <COURSE_TITLE> · <SEMESTER>

The skill reads this file to look up a lesson's topic and reading from its number, so a build
can start with "Build the preflight artifact for Lesson 12" and nothing else. Keep the column
headers exactly as written — `Lsn`, `Topic`, `Reading`, and `PF` are the ones that are parsed.

`PF` = does this lesson get a preflight (`Y` / `N`).

| Lsn | Date | Topic | Reading | PF | In-Class | HW | Unit |
|----:|------|-------|---------|:--:|:--------:|:--:|------|
| 1 | Mon 1 Jan | Course Admin / Review | 1.1–1.4 | N | | Y | Unit One |
| 2 | Wed 3 Jan | <First real topic> | 2.1–2.3 | Y | | Y | Unit One |
| 3 | Fri 5 Jan | <Topic> | 2.4 | Y | | Y | Unit One |
| 4 | Mon 8 Jan | LAB: <Lab name> | Lab Handout | Y | LAB1 | N | Unit One |
| 5 | *Wed 10 Jan* | **GRADED REVIEW 1** | | N | | N | — |

## Conventions worth keeping

- **Topic strings are load-bearing.** The slug is minted from the lesson number and this exact
  topic text, so editing a topic after an artifact is published changes the slug the build would
  generate and desynchronizes it from the registered one. Settle topic wording before you build.
- **Keep retired or non-preflight lessons in the table**, marked `PF = N`. Renumbering to close a
  gap breaks every slug downstream of the change.
- **Two date columns** if you run staggered M-day / T-day sections; one if you don't. The parser
  does not care, but the prefill link's optional `due_m` / `due_t` parameters map to them.
- **Bold or italicize exam and review rows** so a human scanning the table doesn't build a
  preflight for one.

## Naming

Save as `<course_id>_<semester>_schedule.md` — e.g. `phys215_fall2026_schedule.md` — and record
that filename in `COURSE_PROFILE.md` under `schedule_file`.
