# PHYS 215 — General Physics II · E&M and Optics · Fall 2026

Copied on 2026-08-04 from `preflight-kit/examples/phys215_fall2026_schedule.md`, where it ships as
the pilot's reference schedule. The skill reads this file to look up a lesson's topic and reading,
and `scripts/fall2026/set_reading_descriptions.py` reads the `Reading` column into
`app.assignments.description`, where every cadet sees it. Keep the column headers exactly as
written — `Lsn`, `Topic`, `Reading`, and `PF` are the ones that are parsed.

> **⚠ The `Reading` column was NOT byte-identical to the syllabus, and four lessons were wrong.**
> This file said it was copied byte-for-byte and unmodified until 2026-08-11, when the course
> director supplied the current syllabus — `Physics_215__Fall_2026__Syllabus.pdf`, now filed beside
> this file — and a row-by-row comparison against its page-11 schedule table found four
> disagreements. **The syllabus is authoritative and this column now matches it.**
>
> | Lsn | was | is | why it mattered |
> |---:|---|---|---|
> | 3 | `22.3` | `22.3, Lab Manual` | the lab-technique reading was missing entirely |
> | 5 | `22.5` | `22.6` | repeated lesson 4's upper bound; cadets were sent to the wrong section |
> | 36 | `43.8, 43.10` | `36.1–36.2` | **lesson 39's reading**, on a double-slit lesson |
> | 37 | `36.1–36.2` | `37.1–37.3` | **lesson 36's reading** |
>
> **Lessons 36 and 37 were shifted by one row**, which is why 36 and 39 both read `43.8, 43.10` —
> a duplicate visible in this file all along, and the only one of the four a reader could have
> caught without the syllabus. The other three look entirely plausible. That is the argument for
> registering this file in `docs/DOC-SOURCES.json` against the PDF rather than trusting a copy.
>
> **The kit's `preflight-kit/examples/phys215_fall2026_schedule.md` still carries all four errors.**
> It was deliberately not corrected: the kit is never edited per course, and it is an example. Do
> not re-copy from it.

> **Two TOPIC strings also disagree with the syllabus, and were deliberately NOT changed:**
> lesson 3 is `Coulomb's Law, Lab Techniques` in the syllabus and `Coulomb's Law and Superposition`
> here; lesson 16 is `RC Circuits & Pre-Lab Activity` there and `RC Circuits` here. **Topic text is
> load-bearing for this course** — it is baked into every published artifact's slug, header, and
> component name (see below), and the live `app.assignments` titles match the strings *here*, not
> the syllabus's. Renaming either would desynchronize a published artifact from its registration
> and break the title guard in `set_reading_descriptions.py`. Changing them is the course
> director's call, and it is a republish-and-re-register, not an edit. Readings carry no such
> constraint, which is why they could simply be corrected.

`PF` = does this lesson get a preflight (`Y` / `N`). **37 of 41 lessons are marked `Y`** — only
lesson 1 and the three Graded Reviews are not.

> **Lesson numbers ARE build inputs for this course, unlike PHYS 310.** recker chose the pilot's
> `lesson-<NN>-<topic>` stem on 2026-08-04, so the number is baked into the slug, the header
> title, `LESSON_CONFIG.lesson_id`, the filename, and the component name of every published
> artifact. **Renumbering a lesson after it is published strands the number where cadets can see
> it, and nothing detects that.** Settle the numbering before building. Topic text is load-bearing
> for the same reason. See `COURSE_PROFILE.md` → "Slug rule".

## Reading column — Cengage numbering, not the grounding text's

**The `Reading` column is in the cadets' book's numbering.** `22.2–22.3` and `35.3–35.4` are
Cengage chapters. The tutor is grounded in **OpenStax University Physics**, which numbers its
chapters differently, so **these values cannot be mapped onto the grounding text mechanically** —
attach the OpenStax chapter that covers the *topic* and confirm it by reading it. Nothing checks
this, and a mismatch produces a plausible-looking artifact grounded in the wrong chapter.

**Lessons 30–41 span two OpenStax volumes, and the boundary is between lessons 30 and 31.**
Lesson 30 (EM waves) is Vol. 2's last chapter; lesson 31 onward is Vol. 3. `grounding_text` names
both — see `COURSE_PROFILE.md` → "Settled: the course spans two OpenStax volumes".
**recker cleared the block on 2026-08-05 and lessons 30, 31, 32, 33, 36, 37, 39 and 41 are built.**

**Two lessons marked `PF=Y` still have no grounding source anywhere in the corpus and are NOT
built: lesson 16 (RC Circuits) and lesson 40 (Polarization).** Both are blocked on recker for a
source, not on a build. Do not reconstruct either from model knowledge — that exception is scoped
to PHYS 310. Lessons 34 and 38 are labs and 35 is a Graded Review, so they get no artifact here
either, which is why 41 lessons and 37 `PF=Y` rows yield fewer artifacts than either number.

| Lsn | M Day | T Day | Topic | Reading | PF | In-Class | HW | Unit |
|----:|-------|-------|-------|---------|:--:|:--------:|:--:|------|
| 1 | Thu 6 Aug | Fri 7 Aug | Course Admin / Vector Review | 3.1–3.4, 22.1 | N | CSEM | Y | Elec. Charge & Fields |
| 2 | Mon 10 Aug | Tue 11 Aug | Electric Charge, Coulombic Force | 22.2–22.3 | Y | | Y | Elec. Charge & Fields |
| 3 | Wed 12 Aug | Thu 13 Aug | Coulomb's Law and Superposition | 22.3, Lab Manual | Y | | Y | Elec. Charge & Fields |
| 4 | Fri 14 Aug | Mon 17 Aug | Electric Fields and Superposition | 22.4–22.5 | Y | | Y | Elec. Charge & Fields |
| 5 | Tue 18 Aug | Wed 19 Aug | Charged Particles in Uniform Elec. Fields | 22.6 | Y | EPQ1 | Y | Elec. Charge & Fields |
| 6 | Thu 20 Aug | Fri 21 Aug | LAB: Quantized Charge | Lab Handout | Y | LAB1 | N | Elec. Charge & Fields |
| 7 | Mon 24 Aug | Tue 25 Aug | Charge Distributions, Electric Flux | 23.1–23.2 | Y | | Y | Elec. Charge & Fields |
| 8 | Wed 26 Aug | Thu 27 Aug | Gauss's Law and Its Applications | 23.3–23.4 | Y | | Y | Elec. Charge & Fields |
| 9 | Fri 28 Aug | Mon 31 Aug | Electric Potential Difference | 24.1–24.2 | Y | | Y | Elec. Potential |
| 10 | Tue 1 Sep | Wed 2 Sep | Electric Potential, Potential Energy | 24.3–24.4, 24.6 | Y | EPQ2 | Y | Elec. Potential |
| 11 | Thu 3 Sep | Fri 4 Sep | LAB: Mapping Electric Potential | Lab Handout | Y | LAB2 | **C** | Elec. Potential |
| 12 | *9 September* | | **GRADED REVIEW 1** | | N | | N | — |
| 13 | Thu 10 Sep | Mon 14 Sep | Capacitance, Energy, and Dielectrics | 25.1–2, 25.4–5 | Y | | Y | Circuits |
| 14 | Tue 15 Sep | Wed 16 Sep | Current, Resistance, and Electrical Power | 26.1–26.2, 26.6 | Y | | Y | Circuits |
| 15 | Thu 17 Sep | Mon 21 Sep | DC Circuit Analysis, Kirchhoff's Rules | 27.1–27.3 | Y | | Y | Circuits |
| 16 | Tue 22 Sep | Wed 23 Sep | RC Circuits | 27.4 | Y | | Y | Circuits |
| 17 | Thu 24 Sep | Fri 25 Sep | LAB: Building DC Circuits | Lab Handout | Y | LAB3 | N | Circuits |
| 18 | Mon 28 Sep | Tue 29 Sep | Moving Charged Particle in a Magnetic Field | 28.1–28.2 | Y | EPQ3 | Y | Mag. Fields |
| 19 | Wed 30 Sep | Thu 1 Oct | Magnetic Force on Current-carrying Wires | 28.3–28.4 | Y | | Y | Mag. Fields |
| 20 | Fri 2 Oct | Mon 5 Oct | Magnetic Dipoles and Torque | 28.5 | Y | | Y | Mag. Fields |
| 21 | Tue 6 Oct | Wed 7 Oct | Sources of Magnetic Fields | 29.1–29.2 | Y | EPQ4 | Y | Mag. Fields |
| 22 | Thu 8 Oct | Fri 9 Oct | Ampère's Law, Gauss's Law in Magnetism | 29.3–29.5 | Y | | **C** | Mag. Fields |
| 23 | *14 October* | | **GRADED REVIEW 2** | | N | | N | — |
| 24 | Wed 15 Oct | Fri 16 Oct | Faraday's Law of Induction, Motional EMF | 30.1–30.2 | Y | | Y | Changing Fields |
| 25 | Mon 19 Oct | Tue 20 Oct | Lenz's Law, Induced Electric Field | 30.3–30.4 | Y | | Y | Changing Fields |
| 26 | Wed 21 Oct | Thu 22 Oct | Generators and Motors, AC, Transformers | 30.5, 32.1-2, 32.8 | Y | | Y | Changing Fields |
| 27 | Fri 23 Oct | Mon 26 Oct | LAB: Building an Electric Motor | Lab Handout | Y | LAB4 | N | Changing Fields |
| 28 | Tue 27 Oct | Wed 28 Oct | Displacement Current | 33.1–33.2 | Y | EPQ5 | Y | Changing Fields |
| 29 | Thu 29 Oct | Fri 30 Oct | Maxwell's Equations | 33.2 | Y | | Y | Changing Fields |
| 30 | Mon 2 Nov | Tue 3 Nov | Electromagnetic Waves, EM Spectrum | 33.3, 33.4, 33.7 | Y | CSEM | Y | Optics & Nature of Light |
| 31 | Wed 4 Nov | Thu 5 Nov | Light, Reflection, Refraction | 34.1–34.4, 34.7 | Y | EPQ6 | Y | Optics & Nature of Light |
| 32 | Fri 6 Nov | Mon 9 Nov | Image Formation from Mirrors | 35.1–35.2 | Y | | Y | Optics & Nature of Light |
| 33 | Tue 10 Nov | Wed 12 Nov | Image Formation from Lenses | 35.3–35.4 | Y | | Y | Optics & Nature of Light |
| 34 | Fri 13 Nov | Mon 16 Nov | LAB: Thin Lenses | Lab Handout | Y | LAB5 | **C** | Optics & Nature of Light |
| 35 | *17 November* | | **GRADED REVIEW 3** | | N | | N | — |
| 36 | Thu 19 Nov | Fri 20 Nov | Double-Slit Interference | 36.1–36.2 | Y | | Y | Optics & Nature of Light |
| 37 | Mon 23 Nov | Tue 24 Nov | Diffraction, Resolution | 37.1–37.3 | Y | | Y | Optics & Nature of Light |
| 38 | Tue 1 Dec | Wed 2 Dec | LAB: Single/Double-Slit Diffraction | Lab Handout | Y | LAB6 | N | Optics & Nature of Light |
| 39 | Thu 3 Dec | Fri 4 Dec | Intro to Nuclear (Planetarium) | 43.8, 43.10 | Y | | Y | Modern |
| 40 | Mon 7 Dec | Tue 8 Dec | Polarization | 37.6 | Y | EPQ7 | Y | Modern |
| 41 | Wed 9 Dec | Thu 10 Dec | Photoelectric Effect, Wave/Particle | 34.1, 39.2, 39.4 | Y | | **C** | Modern |
| — | | | **FINAL EXAM — Period TBD** | | | | | |

## Legend / notes

- **PF** — Preflight assigned (Y/N).
- **In-Class** — scheduled in-class activity: `CSEM` (concept survey), `EPQ#` (in-class problem quiz), `LAB#` (graded lab).
- **HW** — homework assigned. `Y`/`N`, or **C** (shown in **red** in the original — appears on Lsn 11, 22, 34, 41, each immediately before a graded review or the final).
- **Shaded rows** in the original (Lsn 12, 23, 35) are the three Graded Reviews; their single centered date is placed in the *M Day* column here since markdown can't span cells.
- **Unit** reproduces the right-side rail grouping. Two boundaries are my best read of the image and worth a glance: whether **Capacitance (Lsn 13)** belongs to *Elec. Potential* vs. *Circuits*, and where **Optics** hands off to **Modern** in the Lsn 38–40 tail (Polarization sits under Modern here).

## Conventions worth keeping

- **Lesson numbers and topic strings are both load-bearing.** Both feed the slug stem, so editing
  either after an artifact is published desynchronizes it from the registered row. This is the
  cost of keeping the pilot's naming; PHYS 310 made the opposite trade.
- **Keep non-preflight lessons in the table**, marked `PF = N`, so a reader can tell a deliberate
  skip from an oversight.
- **Bold or italicize review and exam rows** so a human scanning the table doesn't build a
  preflight for one. Lessons 12, 23, and 35 are already marked.
- **Record the OpenStax chapter you actually grounded a lesson in**, in the build notes or a
  `Grounding` column added when you start using one. `Cengage 23.3–23.4 → OpenStax Vol. 2 ch. 6`
  is answerable six months later; a bare `23.3–23.4` is not, with two books in play and two
  different numbering schemes.
