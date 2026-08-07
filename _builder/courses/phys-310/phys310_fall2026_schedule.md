# PHYS 310 — Principles of Nuclear Science · Fall 2026 (T3)

Transcribed from `2.  PHYS 310 Schedule - Fall 2026 (28 July 2026).xlsx`, sheet `Schedule`.
The skill reads this file to look up a lesson's topic and reading. Keep the column headers exactly
as written — `Lsn`, `Topic`, `Reading`, and `PF` are the ones that are parsed.

`PF` = does this lesson get a preflight (`Y` / `N`). The source workbook uses `x` / `--`;
they are transcribed to `Y` / `N` here so the parser sees the documented values.

> **Re-transcribed 2026-08-05 from a workbook recker had updated.** The transcription had gone stale
> silently, which is the failure `docs/DOC-SOURCES.json` exists to prevent — so this file is now
> registered there against the workbook, and a future workbook edit will be flagged before it lands.
> **The old workbook was diffed against the new one rather than assumed**, which is what separates
> the first item below from the rest:
> - **Lesson 2's topic never changed. The previous transcription dropped a word.** Both workbooks —
>   the one committed at bootstrap and recker's update — read `Energy, Atoms, and Nuclei`. This file
>   said `Atoms and Nuclei` from the day it was written, and **that truncated string is what the
>   published artifact's slug was minted from.** See the callout below.
> - **Lessons 13–17 were genuinely re-ordered.** The SNL field trip moved from 13 to 17, and
>   Radiation Interactions, Bioeffects, Dose and Shielding, and Lab 2 each shifted **one lesson
>   earlier** (14→13, 15→14, 16→15, 17→16).
> - **Homework labels renumbered** — lesson 11 turns in `HW2/CS Proposal` (was HW5), lesson 27
>   `HW4/CS Check-in` (was HW5), lesson 34 `HW5` (was HW6). Lesson 7's reading is now `Handout`.
> - **The preflight-count disagreement is closed.** The Grade Breakdown sheet now reads
>   *20 assts, 3 points each* = **60 of 1000 points (6%)**, agreeing with the 20 rows marked
>   `PF = Y` here. It previously budgeted 25 for 75 points. The same edit moved quizzes 3→4, Graded
>   Reviews 2→3, and the case study 130→85 points.

> **Lesson numbers and dates are scheduling data, not build inputs.** recker expects both to move,
> and on 2026-08-05 five of them did. **Nothing an artifact bakes in depends on either**: the slug is
> minted from the **topic alone** (`phys310-<topic-slug>-<8hex>`), the header carries the topic and
> not a lesson number, and the filename follows suit. See `COURSE_PROFILE.md` → "Slug namespacing".
> **This is the design paying for itself** — a renumbering that would have stranded five PHYS 215
> artifacts costs this course nothing. **Topic text is the load-bearing string** — editing a topic
> after publish desynchronizes the slug from the registered one, so settle wording before building.

> **⚠ A transcription typo reached a published artifact's identity.** Lesson 2's topic is
> `Energy, Atoms, and Nuclei` in **both** versions of the workbook. This file said `Atoms and Nuclei`
> from the day it was written, the build read this file, and the live artifact therefore carries
> `phys310-atoms-and-nuclei-83022f32` — a slug minted from a word that was never in the source.
>
> **This is the cost of a hand transcription sitting between a source and a load-bearing string.**
> The artifact works, and its slug is still unique; what it does not do is match the schedule, and
> nothing in the build would ever have said so — `check_artifact.py` validates the slug's *shape*, not
> its *derivation*. `docs/operations/PREFILL-LINK.md:95` has meanwhile been using the correct
> `phys310-energy-atoms-and-nuclei-<8hex>` as its worked example since it was written, so the
> repository has quietly contradicted itself about this lesson's identity for five days.
>
> **Rebuilding is not a free fix** — a rebuild mints a *new* 8-hex suffix and registers as a *new
> lesson row* (contract §3.2), leaving two live artifacts for one lesson. Whether to rebuild, and
> whether to retire the old row, is recker's call. Recorded in
> [`artifacts/BUILD-LOG.md`](artifacts/BUILD-LOG.md).

## Reading columns

- **Reading** — Murray & Holbert, *Nuclear Energy* (8th ed.). **What cadets read, and — since
  2026-07-31 — what the tutor is grounded in as well.**
- **Grounding** — the entry in [`texts/MURRAY-GROUNDING.md`](texts/MURRAY-GROUNDING.md), plus the
  DOE-HDBK-1019 **cross-check** where one exists. **Never surfaced to a cadet.** The Murray corpus
  entry always exists for a `PF = Y` lesson with a reading.

> **The cross-check half of this column is quoted from the corpus's own `Cross-check` lines, not
> inferred.** It was inferred in the first draft of this re-transcription, and lesson 18's build
> caught the result contradicting the corpus outright — the column said *no DOE cross-check* for
> chapter 12 while all three of its sections claim DOE covers them. **Inference is what produced this
> course's one published-artifact defect** (the lesson 2 slug), so the column is now sourced.
> **Where the corpus records reduced or absent confidence, this column says so** — that is the half
> worth reading before a review.

> **The `STATUS: PENDING` build gate was lifted by recker on 2026-08-05** for the build of every
> remaining lesson: *"Assume the grounding for 310 is correct and we can fix objectives and grounding
> later if we need to."* **The sections are still unreviewed** — the lift is permission to build on
> them, not an attestation that they are right. Fifty-six of the fifty-nine corpus sections remain
> `STATUS: PENDING`, every artifact built under the lift is marked as such in
> [`artifacts/BUILD-LOG.md`](artifacts/BUILD-LOG.md), and **the review is still owed** before any of
> them is trusted. See [`COURSE_PROFILE.md`](COURSE_PROFILE.md) → "Grounding" and
> [`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../docs/decisions/PHYS310-MURRAY-GROUNDING.md).

| Lsn | Date | Topic | Reading (Murray) | Grounding (DOE) | PF | Turn In | Graded |
|----:|------|-------|------------------|-----------------|:--:|---------|--------|
| 1 | Fri 07 Aug | Admin Overview | Syllabus | n/a | Y | | |
| 2 | Tue 11 Aug | Energy, Atoms, and Nuclei | 2.1, 2.5, 2.6 | Murray corpus §2.1/2.5/2.6 · DOE cross-check NP-01 pp. 1–16 (amu↔C-12 not covered) | Y | | |
| 3 | Thu 13 Aug | Binding Energy and Stability | 2.7, 3.1 | Murray corpus §2.7/3.1 · DOE NP-01 covers mass defect and BE/A (**strong**) and the chart of the nuclides well | Y | | |
| 4 | Mon 17 Aug | Radioactivity | 3.2–3.4 | Murray corpus §3.2/3.3/3.4 · DOE NP-01 covers all decay modes and balancing rules (**strong**), the decay law thoroughly, and chains/equilibrium | Y | | |
| 5 | Wed 19 Aug | *Lecture: Intro to Weapons Complex (LLNL)* | — | n/a | N | | |
| 6 | Fri 21 Aug | Lab 1 | 3.5 | Murray corpus §3.5 · DOE NP-01 covers counting statistics and dead time **in its detector material** — not as half-life measurement. **§3.5 is the corpus's own weakest entry in chs. 2–5** | Y | HW 1 | |
| 7 | Tue 25 Aug | *Lecture: Stockpile Stewardship (LANL)* | Handout | n/a | N | Lab 1 | |
| 8 | Thu 27 Aug | Nuclear Reactions | 4.1–4.4 | Murray corpus §4.1–4.4 · DOE NP-01/02 cover notation, Q-values, scattering and ξ (**strong**), capture and breeding — but **little of §4.4; reduced confidence there** | Y | | Quiz 1 |
| 9 | Mon 31 Aug | Cross Sections | 4.5–4.6 | Murray corpus §4.5/4.6 · DOE NP-02 covers σ, Σ, mean free path and reaction rate in depth, and 1/v, resonances and Doppler broadening well | Y | | |
| 10 | Wed 02 Sep | Neutron Transport | 4.7 | Murray corpus §4.7 (+ **λ = 1/Σ carried from §4.5, which is where it lives**) · DOE NP-02 covers flux, current, diffusion and leakage thoroughly | Y | | |
| 11 | Fri 04 Sep | *Comp Day Field Trip* | — | n/a | N | HW2/CS Proposal | |
| 12 | Wed 09 Sep | **GRADED REVIEW 1** | — | n/a | N | | GR1 |
| 13 | Mon 14 Sep | Radiation Interactions with Materials | 5.1–5.5 | Murray corpus §5.1–5.5 · DOE NP-01/02 cover the taxonomy, stopping and range, all three gamma mechanisms and neutron interactions — but **little materials science; reduced confidence on §5.5** | Y | | |
| 14 | Wed 16 Sep | Bioeffects and Safety | 5.6, 10.1–10.2, 10.4 | Murray corpus §5.6/10.1/10.2/10.4 · DOE NP-01 covers dose units; **thin on background sources and on the ICRP/LNT policy discussion** | Y | | |
| 15 | Mon 21 Sep | Dose and Shielding | 11.1–11.3 | Murray corpus §11.1–11.3 · DOE covers time/distance/shielding (**strong**), internal dose, attenuation and HVL; **buildup treated more lightly** | Y | | |
| 16 | Wed 23 Sep | Lab 2 | — | **none — no reading assigned** | Y | | |
| 17 | Fri 25 Sep | *Field Trip (SNL)* | — | n/a | N | | |
| 18 | Tue 29 Sep | Detection Methods: Gas-Filled Detectors | 12.1–12.3 | Murray corpus §12.1/12.2/12.3 · DOE NP-04 covers the detector regions, ion chambers, proportional counters, and GM operation/quenching/dead time — **corroboration available for all three** | Y | Lab 2/HW3 | Quiz 2 · *last preflight grade before Prog* |
| 19 | Thu 01 Oct | Detection Methods: Scintillation, Semiconductor, and Dosimetry | 12.4–12.6, 12.8 | Murray corpus §12.4/12.5/12.6/12.8 · DOE covers scintillators and PMTs, BF₃/³He/fission chambers well; **semiconductors more briefly (moderate)**, and **low confidence on §12.8** | Y | | |
| 20 | Mon 05 Oct | Lab 3 | — | **none — no reading assigned** | Y | HW4 | |
| 21 | Wed 07 Oct | **GRADED REVIEW 2** | — | n/a | N | Lab 3 | GR2 |
| 22 | Fri 09 Oct | *Lecture: Detection of Weapons Testing (DTRA)* | — | n/a | N | | |
| 23 | Wed 14 Oct | *Lecture: Detection and Assessment (SNL)* | — | n/a | N | | |
| 24 | Fri 16 Oct | Fission: Neutron Multiplication | 6.1–6.5 | Murray corpus §6.1–6.5 · DOE NP-01/02/03 cover the fission process, the yield curve, the energy breakdown, delayed neutrons and the four/six-factor formulas in depth; **xenon and samarium poisoning corroborate strongly** | Y | | |
| 25 | Tue 20 Oct | Fission: Criticality | 16.1–16.5 | Murray corpus §16.1–16.5 · DOE NP-02/03/04 cover k, reactivity, generation time and prompt criticality in depth. **Ch. 6 and Ch. 16 overlap by the corpus's own admission** — see its chapter-level flag | Y | | |
| 26 | Thu 22 Oct | Fusion | 7.1–7.2 | Murray corpus §7.1/7.2 · DOE covers fusion **only in passing** for §7.1 and **not at all** for §7.2 — reduced confidence on organization, no cross-check on confinement | Y | | |
| 27 | Mon 26 Oct | *Case Study Work Day* | — | n/a | N | HW4/CS Check-in | Quiz 3 |
| 28 | Wed 28 Oct | *Lecture: Intro to Weapons Engineering (LLNL)* | — | n/a | N | | |
| 29 | Fri 30 Oct | *Lecture: Dr. Yeaw* | — | n/a | N | | |
| 30 | Tue 03 Nov | **GRADED REVIEW 3** | — | n/a | N | | GR3 |
| 31 | Thu 05 Nov | Nuclear Reactors: Basics, Components, Types, Accidents | 18.1–18.2, 18.4–18.5, 21.1–21.2 | Murray corpus §18.1/18.2/18.4/18.5/21.1/21.2 · DOE NP-04 covers components and defence in depth (**moderate**) and PWR/BWR physics (**good**); reactor types only lightly; **and nothing at all for §18.5, §21.1 or §21.2** | Y | | |
| 32 | Mon 09 Nov | Fuel Cycle: Isotope Separation, Waste | 15.1–15.4, 23.1, 23.5 | Murray corpus §15.1–15.4/23.1/23.5 · **no DOE cross-check for any of the six** — the corpus records `None` on every one. The weakest-grounded lesson in the course | Y | | |
| 33 | Thu 12 Nov | *Work day for Group Projects* | — | n/a | N | | |
| 34 | Mon 16 Nov | *Reactor Town Hall* | — | n/a | N | HW5 | |
| 35 | Wed 18 Nov | *Field Trip: TRIGA Reactor, Denver* | — | n/a | N | | |
| 36 | Fri 20 Nov | *Guest Lecture: NIF (LLNL)* | — | n/a | N | | |
| 37 | Tue 24 Nov | *Lecture: Nuclear Policy — Dr. Smith, INSS* | — | n/a | N | | |
| 38 | Wed 02 Dec | *Case Study Presentations* | — | n/a | N | Team Reflections | Quiz 4 |
| 39 | Fri 04 Dec | *Case Study Presentations* | — | n/a | N | | |
| 40 | Tue 08 Dec | *Case Study Presentations* | — | n/a | N | | |
| 41 | Thu 10 Dec | *Case Study Presentations* | — | n/a | N | | |
| — | — | **FINAL EXAM** | — | n/a | N | | Final |

**20 lessons are marked `PF = Y`, and the Grade Breakdown sheet now budgets exactly 20** at 3 points
each — 60 of 1000, 6% of the course. **The disagreement recorded here since bootstrap is closed**;
the workbook previously budgeted 25.

### The three `PF = Y` lessons that cannot be built

**Seventeen of the twenty have a Murray reading and a corpus entry. Three do not**, and no artifact
can be built for them from this repository:

| Lsn | Topic | why not |
|---:|---|---|
| 1 | Admin Overview | the reading is the **syllabus**. There is no Murray section, no corpus entry, and nothing physical to be Socratic about. A preflight here would be an administrative acknowledgement, which is not what this system builds |
| 16 | Lab 2 | `Reading` is `--`. Lab 1 is buildable *because* it carries §3.5; these two carry nothing |
| 20 | Lab 3 | same |

**Do not reconstruct a source for any of the three.** The reconstruct-from-model-knowledge exception
is scoped to *Murray sections the schedule actually assigns*
([`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../docs/decisions/PHYS310-MURRAY-GROUNDING.md));
inventing a reading that the schedule does not assign is a different act with no decision behind it.
All three are **blocked on recker** to say what the preflight should cover, or to mark them `PF = N`.

### Lessons 18 and 19 print the same topic — the names here are disambiguated

The workbook gives both the bare topic `Detection Methods`. **This course mints its slug, filename,
and component name from the topic alone**, so two lessons sharing a topic string would collide on all
three at once — and the collision is silent, because the second build simply overwrites the first
file. The names in the table above are therefore **split by what each lesson actually reads**
(§12.1–12.3 gas-filled; §12.4–12.6 and §12.8 scintillation, semiconductor, neutron, dosimetry).

**These strings are load-bearing and are now settled.** Changing either after its artifact is
published desynchronizes the slug. If recker prefers different wording, it costs nothing *before*
publication and a new lesson row *after*.

## Videos

The workbook carries a `Videos` column with YouTube links, mostly clustered against lessons 1–11.
They are cadet-facing prep material, not grounding, and the skill does not read them — so they are
deliberately not transcribed here. They stay in the workbook.

## Conventions worth keeping

- **Topic strings are load-bearing; lesson numbers are not.** The slug is minted from the topic text
  alone, so editing a topic after an artifact is published desynchronizes the slug from the
  registered one. Renumbering a lesson is free — **and on 2026-08-05 that stopped being theoretical**,
  when five lessons were renumbered and no artifact was affected.
- **Keep retired or non-preflight lessons in the table**, marked `PF = N`, so a reader can tell a
  deliberate skip from an oversight.
- **Bold or italicize exam, review, lecture, and field-trip rows** so a human scanning the table
  doesn't build a preflight for one.
- **Fill the `Grounding` column when you build that lesson**, not before. Recording `Murray 4.2–4.5
  → DOE NP-01 pp. 22–29` is answerable six months later; a bare `4.2–4.5` is not, with two books in
  play.
