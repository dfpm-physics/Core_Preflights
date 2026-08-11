# PHYS 110 — General Physics I · Mechanics · Fall 2026

Transcribed 2026-08-11 from **TABLE 1, "PHYS 110 Fall 2026 Course Schedule", page 10 of
`Physics_110_Fall_2026_Syllabus (4Aug2026)_8639.pdf`** — the syllabus the cadets are issued.
`scripts/fall2026/set_reading_descriptions.py` reads this file to look up a lesson's assigned
reading. Keep the column headers exactly as written — `Lsn`, `Topic`, `Reading` and `PF` are the
ones that are parsed, **by name**, off the header row.

`PF` = does this lesson get a preflight (the syllabus's `Pre-Flt` column, `Y`/`N`). **37 of 41
lessons are `Y`** — only lesson 1 and the three Graded Reviews (13, 24, 36) are not, which is
exactly the 37 assignments phys-110 has in `app.assignments`.

> **PHYS 110 IS NOT A BUILDER COURSE, and this file does not make it one.** It sits under
> `_builder/courses/` only so that all three courses' schedules live in one place with one parser.
> There is **no `COURSE_PROFILE.md` here**, so `tools/localize.py` cannot bake a kit for phys-110
> and no artifact can be built for it — see `_builder/courses/phys-215/COURSE_PROFILE.md` for what
> a real builder course carries. This is a **schedule source only**.

## The Reading column — Cengage numbering, and it is SECTIONS, not pages

**The `Reading` column is the section numbering of the book cadets hold** (`2.1-2.6`, `10.1-10.3`),
transcribed verbatim including the syllabus's own inconsistent separators — lesson 11 joins two
ranges with a comma, lesson 25 with a semicolon, lesson 26 with a slash.

**Do not confuse it with `activities.content.reference_pages`.** Those (`98-125`, `170-179`) are
**page** numbers in **OpenStax**, a different book, carried per assignment for RAG grounding and
never assigned to a cadet. Both are reading-shaped; only this column is the reading.

The six lab lessons (7, 10, 19, 23, 32, 38) read `Lab Handout` and lesson 6 reads `Lab Manual` —
that difference is the syllabus's and is preserved.

## Verification — the dates, not the readings, are what proves the transcription

Every one of the 37 preflight lessons' **M-day and T-day meeting dates below matches
`SCHEDULES["phys-110"]` in `scripts/fall2026/set_due_dates.py`** exactly, and that table was itself
verified against `site/data/academic-calendar.json` (the USAFA academic calendar feed, an
independent source). A dropped row or a shifted column would move a date and break that agreement,
so the match is what makes this transcription trustworthy — the reading values have no such
independent check and are the reason this file is registered in `docs/DOC-SOURCES.json` against the
syllabus PDF.

Lesson numbers here are the syllabus's own and **do not equal the academy's M/T day numbers**,
because phys-110's Graded Reviews (13, 24, 36) do not sit on the academy grid. That is expected;
phys-215's do sit on it and its numbers match exactly. Neither is the error.

| Lsn | M Day | T Day | Topic | Reading | PF | In-Class | HW | Block |
|----:|-------|-------|-------|---------|:--:|----------|:--:|-------|
| 1 | Thu, Aug 6 | Fri, Aug 7 | Course Admin / Physics and Measurement | 1.1-1.6, Appdx B | N | Baseline Quiz; DP 1 | Y | Kinematics |
| 2 | Mon, Aug 10 | Tue, Aug 11 | 1-D Motion / Position Velocity Acceleration | 2.1-2.6 | Y | | Y | Kinematics |
| 3 | Wed, Aug 12 | Thu, Aug 13 | Constant Acceleration and Freefall | 2.7-2.8 | Y | | Y | Kinematics |
| 4 | Fri, Aug 14 | Mon, Aug 17 | Vectors and Coordinate Systems | 3.1-3.4 | Y | | Y | Kinematics |
| 5 | Tue, Aug 18 | Wed, Aug 19 | 2-D Motion / Projectile Motion | 4.1-4.3 | Y | | Y | Kinematics |
| 6 | Thu, Aug 20 | Fri, Aug 21 | Laboratory Fundamentals | Lab Manual | Y | EPQ 1; DP 2 | N | Kinematics |
| 7 | Mon, Aug 24 | Tue, Aug 25 | LAB 1: Projectile Motion | Lab Handout | Y | LAB 1 | N | Kinematics |
| 8 | Wed, Aug 26 | Thu, Aug 27 | Intro to Newton's Laws | 5.1-5.7 | Y | | Y | Newton's Laws |
| 9 | Fri, Aug 28 | Mon, Aug 31 | Application of Newton's Laws / Friction | 5.6-5.8 | Y | | Y | Newton's Laws |
| 10 | Tue, Sept 1 | Wed, Sept 2 | LAB 2: Newton's Laws | Lab Handout | Y | LAB 2 | N | Newton's Laws |
| 11 | Thu, Sept 3 | Fri, Sept 4 | Newton's Laws with Circular Motion | 6.1-6.2, 4.4-4.5 | Y | EPQ 2; DP 3 | Y | Newton's Laws |
| 12 | Tue, Sept 8 | Wed, Sept 9 | Application of Newton's Laws | 5.1-6.3 | Y | | C | Newton's Laws |
| 13 | *Mon, Sept 14* | | **Graded Review 1** | | N | GR 1 | N | — |
| 14 | Tue, Sept 15 | Wed, Sept 16 | Energy of a System / Work | 7.1-7.3, 8.1 | Y | | Y | Energy |
| 15 | Thu, Sept 17 | Mon, Sept 21 | Varying Forces / Kinetic Energy | 7.4-7.5 | Y | | Y | Energy |
| 16 | Tue, Sept 22 | Wed, Sept 23 | Potential Energy / Nonconservative Forces | 7.6-7.9 | Y | | Y | Energy |
| 17 | Thu, Sept 24 | Fri, Sept 25 | Conservation of Energy | 8.1-8.2 | Y | DP 4 | Y | Energy |
| 18 | Mon, Sept 28 | Tue, Sept 29 | Changes in Mechanical Energy / Power | 8.3-8.5 | Y | EPQ 3 | Y | Energy |
| 19 | Wed, Sept 30 | Thu, Oct 1 | LAB 3: Conservation of Energy | Lab Handout | Y | LAB 3 | N | Energy |
| 20 | Fri, Oct 2 | Mon, Oct 5 | Linear Momentum & 1-D Collisions | 9.1-9.4 | Y | | Y | Momentum |
| 21 | Tue, Oct 6 | Wed, Oct 7 | 2-D Collisions | 9.5 | Y | DP 5 | Y | Momentum |
| 22 | Thu, Oct 8 | Fri, Oct 9 | Center of Mass / Systems of Particles | 9.6-9.7 | Y | EPQ 4 | Y | Momentum |
| 23 | Tue, Oct 13 | Wed, Oct 14 | LAB 4: Conservation of Momentum | Lab Handout | Y | Lab 4 | C | Momentum |
| 24 | *Thu, Oct 15* | | **Graded Review 2** | | N | GR 2 | N | — |
| 25 | Mon, Oct 19 | Tue, Oct 20 | Angular Position Velocity Acceleration | 10.1-10.3; 4.4-4.5 | Y | | Y | Rotating Objects |
| 26 | Wed, Oct 21 | Thu, Oct 22 | Vector Product / Torque / Moment of Inertia | 10.4-10.5 / 11.1 | Y | | Y | Rotating Objects |
| 27 | Fri, Oct 23 | Mon, Oct 26 | Moment of Inertia Applications | 10.5 | Y | DP 6 | Y | Rotating Objects |
| 28 | Tue, Oct 27 | Wed, Oct 28 | Rotational Kinetic Energy / Rolling Motion | 10.7, 10.9 | Y | | Y | Rotating Objects |
| 29 | Thu, Oct 29 | Fri, Oct 30 | Angular Momentum | 11.2-11.3 | Y | | Y | Rotating Objects |
| 30 | Mon, Nov 2 | Tue, Nov 3 | Conservation of Angular Momentum | 11.4 | Y | EPQ 5 | Y | Rotating Objects |
| 31 | Wed, Nov 4 | Thu, Nov 5 | Rotational Motion Applications | 11.4 | Y | DP 7 | Y | Rotating Objects |
| 32 | Fri, Nov 6 | Mon, Nov 9 | LAB 5: Angular Momentum | Lab Handout | Y | Lab 5 | N | Rotating Objects |
| 33 | Tue, Nov 10 | Thu, Nov 12 | Universal Gravitation | 13.1-13.3 | Y | Baseline Quiz | Y | Gravity |
| 34 | Fri, Nov 13 | Mon, Nov 16 | Gravitational Potential Energy / Kepler's Laws | 13.4-13.5 | Y | | Y | Gravity |
| 35 | Tue, Nov 17 | Wed, Nov 18 | Planetary and Satellite Motion | 13.6 | Y | | C | Gravity |
| 36 | *Thu, Nov 19* | | **Graded Review 3** | | N | GR 3 | N | — |
| 37 | Mon, Nov 23 | Tue, Nov 24 | Simple Harmonic Motion & Pendulums | 15.1-15.2, 15.5 | Y | | Y | Oscillatory Motion |
| 38 | Tue, Dec 1 | Wed, Dec 2 | Lab 6: Simple Harmonic Motion | Lab Handout | Y | LAB 6 | N | Oscillatory Motion |
| 39 | Thu, Dec 3 | Fri, Dec 4 | Energy of SHO & Damped Oscillations | 15.3, 15.6 | Y | | Y | Oscillatory Motion |
| 40 | Mon, Dec 7 | Tue, Dec 8 | Wave Fundamentals & Wave Equation | 16.1-16.3 | Y | EPQ 6 | Y | Oscillatory Motion |
| 41 | Wed, Dec 9 | Thu, Dec 10 | Superposition, Standing Waves, & Applications | 17.1-17.2 | Y | | C | Oscillatory Motion |

## Conventions

- `HW` — `Y` yes, `N` no, `C` the syllabus's third value, carried through as written.
- `In-Class` — `DP n` is a Discovery Project (a hands-on in-class exercise), `EPQ n` an in-class
  problem quiz, `GR n` a Graded Review, `LAB n` the lab itself.
- The three Graded Reviews have **no T-day meeting** and no preflight, so their rows carry no
  reading and the parser skips them. Lesson 1 has a reading but `PF = N`; phys-110 has no
  `preflight-01` assignment, so nothing consumes it.
- **Two lessons share a reading and it is not a transcription error:** lessons 30 and 31 both read
  `11.4` in the syllabus (*Conservation of Angular Momentum* and *Rotational Motion Applications*).
  Lesson 12 (`5.1-6.3`) and lesson 17 (`8.1-8.2`) likewise re-cover ground from earlier lessons by
  design — both are consolidation lessons.
