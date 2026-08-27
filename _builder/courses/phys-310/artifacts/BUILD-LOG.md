# PHYS 310 — Preflight Artifact Build Log

**Fall 2026 · Principles of Nuclear Science.** One row per lesson artifact built from this
repository. Appended in lesson order, not chronological order, so the table reads as a build queue.

**What this file is for:** reviewing what was built and registering it. The `Registration slug` and
`Published` rows are the two values a prefill link is made of — the exact `#i=` / `id=` string and the
artifact's public URL. Copy them from here rather than retyping, and regenerate a link per
[`docs/operations/PREFILL-LINK.md`](../../../docs/operations/PREFILL-LINK.md). **The published URL
lives nowhere else in this repository**, it is not derivable from the source, and it is the only
pointer from a lesson back to the exact build a cadet is running.

> **Created 2026-08-05, five days after this course's first artifact was published.** Its absence was
> already recorded as a defect — `serve_artifact_review.py` reports PHYS 310's publication status as
> *unknown* rather than guessing, because the slug and the URL were paired only in prose in
> `PROJECT.md`. Lesson 2's row below is a backfill from that prose.

---

## ⚠ Read this before trusting anything below

**Fifteen of the seventeen artifacts in this log rest entirely on grounding that no human has
reviewed.** That is not an oversight; it is an instruction:

> *"Assume the grounding for 310 is correct and we can fix objectives and grounding later if we need
> to."* — recker, 2026-08-05

**What that changed.** `COURSE_PROFILE.md` and `texts/MURRAY-GROUNDING.md` both carried a hard gate:
a lesson is not buildable while any Murray section it cites is `STATUS: PENDING`. Fifty-six of the
corpus's fifty-nine sections are pending. Under the gate, exactly one lesson in this course was
buildable — the one already built. recker lifted the gate for this run.

**What that did not change.** The gate existed because this course's grounding is **reconstructed
from model knowledge** rather than extracted from a PDF — a standing exception recorded in
[`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../../docs/decisions/PHYS310-MURRAY-GROUNDING.md)
and scoped to PHYS 310 alone. Lifting the gate granted **permission to build on the reconstruction.
It did not make the reconstruction right.** The status lines were deliberately left at `PENDING`, so
the corpus still reports honestly which sections a human has read against the physical book: three.

**So the review is still owed, and it is owed against these fifteen drafts.** Every row below carries
a `Grounding` line naming the exact corpus sections it rests on. When recker reviews a section and
finds it wrong, the artifact built from it does **not** update itself — and correcting one after
publication is a republish and a *new lesson row* under contract §3.2, not an edit. **The cheapest
moment to catch a reconstruction error is before any of these is published.**

> **Lesson 6 (Lab 1) is the exception, and it is worth reading as a demonstration rather than an
> escape.** On 2026-08-19 recker put the cadet's actual lab write-up and analysis workbook into the
> repository, and that lesson was rebuilt against them. It is the only artifact in this course whose
> Tier-1 grounding is a primary document. **What the comparison showed is the argument for the other
> fifteen reviews:** the corpus's §3.5 entry, which flagged itself as the weakest in chapters 2–5,
> was thematically close and specifically wrong — two of three probe topics rested on material that
> appears nowhere in the lab, and most of what the cadet is graded on was missing. **The corpus's
> self-flagging worked. Nothing else caught it, and nothing else would have.**

---

## Status summary

| | lessons |
|---|---|
| **Built** | **all seventeen.** 2 (published 2026-07-31), plus **3, 4, 6, 8, 9, 10, 13, 14, 15, 18, 19, 24, 25, 26, 31, 32 — all sixteen built 2026-08-05**, one subagent at a time. **Lesson 6 (Lab 1) was REBUILT 2026-08-19** against the real lab documents |
| **Queued** | **nothing. The queue is empty** — every PHYS 310 lesson that has a Murray reading now has an artifact |
| **Blocked — no reading assigned** | **1** (Admin Overview — the reading is the syllabus), **16** (Lab 2), **20** (Lab 3). All three are `PF = Y` in the schedule, so none is a deliberate skip. Blocked on recker to say what they should cover, or to mark them `PF = N` |
| **Not a preflight** | 5, 7, 11, 12, 17, 21, 22, 23, 27, 28, 29, 30, 33–41 — lectures, field trips, Graded Reviews, case-study days, the final |
| **Published** | **4 of 17.** Lessons 2, 3, 4 and **6 (Lab 1, published 2026-08-19)**. The first three were REPUBLISHED on 2026-08-14 carrying the backup-version button, and their `artifact_url` repointed the same day. *(This row said "1 of 17, lesson 2 only" until 2026-08-14: lessons 3 and 4 had been published and registered in the database, and nothing updated this log. `index.json` is DERIVED from this file, so the staleness propagated into Storage on the next push.)* |
| **Registered on the DFPM site** | **7 of 17** — lessons 1, 2, 3, 4, 6 and, as of 2026-08-26, **8 and 9**. *(This row said "none. Not one lesson row exists for this course, and `course_id: phys-310` has never been confirmed to exist on the receiver at all" until 2026-08-26. Both halves were wrong by then: the course offering `5d8d5b43-9b84-40ce-a288-71a4880518f1` exists, carries one section `T3A`, and lessons 1—6 were already registered and published. Nothing updated this row when they were.)* |

**Seventeen lessons in this course can hold a preflight**, not twenty. The schedule marks twenty
`PF = Y`; three of those assign no reading and have no corpus entry.

---

## Two things about this course's identifiers that will bite a reader from PHYS 215

**1. There is no lesson number in a PHYS 310 slug, filename, or component name.** The slug is
`phys310-<topic-slug>-<8hex>`, minted from the topic **alone**. That is a recorded decision
(`COURSE_PROFILE.md` → "Slug namespacing"), made because this schedule's numbering was expected to
move — and on 2026-08-05 it did, when lessons 13–17 were re-ordered and five lessons changed number.
**Not one artifact was affected.** The same renumbering in PHYS 215 would have stranded five
published artifacts in five places each.

**2. The bill for that arrives as a uniqueness requirement on the topic string.** The workbook gives
lessons 18 and 19 the *identical* topic `Detection Methods`, which would have collided on the slug,
the filename, and the component name simultaneously — silently, since the second build simply
overwrites the first file. The schedule now disambiguates them by reading (§12.1–12.3 gas-filled;
§12.4–12.6 + §12.8 scintillation, semiconductor, dosimetry). **Both strings are settled and
load-bearing.**

---

## ⚠ Lesson 2's slug was minted from a transcription typo

The live artifact is `phys310-atoms-and-nuclei-83022f32`. **The lesson's topic has always been
`Energy, Atoms, and Nuclei`** — in the workbook committed at bootstrap *and* in recker's 2026-08-05
update. The hand transcription in `phys310_fall2026_schedule.md` dropped the first word, the build
read the transcription, and the slug inherited the omission.

**Nothing could have caught this.** `check_artifact.py` validates the slug's *shape* — stem plus
eight hex — and has no way to check its *derivation*. The workbook was never registered in
`docs/DOC-SOURCES.json`, so the staleness checker reported every indexed document current while this
one disagreed with its own source. Both gaps are now closed: the schedule is registered, and the
re-transcription was diffed against the previous workbook rather than assumed.

**The artifact is not broken.** Its slug is well-formed and unique, it submits correctly, and a cadet
sees a topic title, never a slug. What it is, is *unmatched to the schedule* — and
`docs/operations/PREFILL-LINK.md:95` has been using the correct
`phys310-energy-atoms-and-nuclei-<8hex>` as its worked example since it was written, so the
repository has contradicted itself about this lesson's identity for five days.

**Rebuilding costs a lesson row.** A rebuild mints a new 8-hex suffix and registers as a *new* lesson
row (contract §3.2), leaving two live artifacts for one lesson unless the old one is retired.
**recker's call**, and there is no deadline on it — the artifact is not registered yet either.

---

## Built

### Lesson 2 — Energy, Atoms, and Nuclei

| | |
|---|---|
| **File** | [`phys310_preflight_atoms_and_nuclei.jsx`](phys310_preflight_atoms_and_nuclei.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-atoms-and-nuclei-83022f32` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/8fad66d7-7dc6-4da1-a045-01faf9849042 |
| **Component** | `Phys310AtomsAndNucleiPreflight` |
| **Built** | 2026-07-31 |
| **Grounding** | Murray corpus **§2.1** Atomic Theory, **§2.5** Nuclear Structure, **§2.6** Sizes and Masses of Nuclei — **the only three sections in the corpus that are `STATUS: REVIEWED`**, attested by recker on 2026-07-31 against the physical book |
| **Cross-check** | DOE-HDBK-1019 NP-01 pp. 1–16. Corroborates Z, atom density, Avogadro. **Gap: amu ↔ C-12 is not covered by DOE** — Murray §2.6 carries it alone |
| **Cadets' reading** | Murray & Holbert 2.1, 2.5, 2.6 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 37 passed / 0 failed |
| **Status** | **PUBLISHED 2026-07-31.** The first artifact this repository ever produced, and therefore the first JSX it ever had parsed. Not registered. **Slug does not match the schedule topic** — see the callout above |

> **This row is a backfill.** It was reconstructed on 2026-08-05 from prose in `PROJECT.md` §10,
> which was the only place the slug and the published URL appeared together. The three build-time
> confirmations recorded there — 2021 lines, `INTERACTION_ID` identical to the source, clean final
> brace — are re-verified: the file is still 2021 lines and still passes 37/37.

### Lesson 3 — Binding Energy and Stability

| | |
|---|---|
| **File** | [`phys310_preflight_binding_energy_and_stability.jsx`](phys310_preflight_binding_energy_and_stability.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-binding-energy-and-stability-e0ceabee` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/75919001-7f8e-4734-8d1f-bf6edef4b1ab |
| **Component** | `Phys310BindingEnergyAndStabilityPreflight` |
| **Built** | 2026-08-05 · 2097 lines |
| **Grounding** | Murray corpus **§2.7** Binding Energy, **§3.1** Nuclear Stability — **both `STATUS: PENDING`**. Mass constants carried from §2.6 (reviewed) and tagged as carried |
| **Cross-check** | DOE NP-01 covers mass defect and the B/A curve; not consulted directly (the PDFs are gitignored) |
| **Cadets' reading** | Murray & Holbert 2.7, 3.1 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 40 passed / 0 failed (37 base + 3 `--forbid` guards proving no lesson-2 slug, suffix or title survived the rebase). Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `mass-defect-binding-energy` | Relates the mass defect to binding energy |
| 2 | `binding-per-nucleon-curve` | Reads the B/A curve and its energy consequences |
| 3 | `line-of-stability` | Explains what makes a nuclide stable or unstable |

**Extension problems:** A deuteron Δm = 0.002388 u → B = 2.224 MeV, B/A = 1.11, plus *why a hydrogen
atom appears in a nuclear formula* (approachable) · B helium-4 → 28.30 MeV, B/A = 7.07, ≈80 % of the
peak on four nucleons (approachable) · C two-deuteron fusion ≈ 23.8 MeV against U-238 fission
≈ 286 MeV, and why **both** signs come out positive (challenging) · D the line of stability at Z = 8
and Z = 92, N/Z = 146/92 = 1.59 against the ≈1.6 rule (standard) · E four stable odd-odd nuclides out
of ~260, pairing, and the magic numbers (approachable). A and B reproduce the corpus's own quoted
values, which is the method check.

> **⚠ These two sections are thinner than they read, and that is the finding worth keeping.**
> Together they are ~40 corpus lines against the ~90 that fed lesson 2, and the shortfall is *worked
> material*: **§3.1 contains no worked example, no equation, and no number at all** except the ≈1.6
> ratio and the magic-number list. Every calculation in this artifact therefore traces back to §2.7's
> two mass defects — there is no third nuclide anywhere in the grounding, which is why extension
> problems A and B reuse the deuteron and helium-4 instead of introducing a fresh case. **A section
> that reads confidently and says little will look sufficient to everyone downstream**, which is
> exactly why it is recorded here.

> **⚠ The corpus names its own best probe, and this lesson is forbidden to use it.** §3.1 states that
> the predictive link *neutron-rich → β⁻, proton-rich → β⁺/EC, very heavy → α* is "the section's real
> content and the best probe in it." **Lesson 4 owns decay modes**, so the boundary was honoured: the
> link sits in `TEXTBOOK_REFERENCE` marked *FOR YOUR CORRECTNESS ONLY, NOT FOR PROBING*, and topic 3
> stops at *why* a nuclide is unstable rather than *how* it decays. **If §3.1 really is best probed
> through that link, this lesson is deliberately probing the section's second-best material** — which
> is recker's call to make, not a build's.

**Three smaller findings, recorded rather than resolved.** §2.7's own Flags admit it does not know
whether the B/A peak is Fe-56 or Ni-62 — the artifact accepts either from a cadet and never corrects
one, because the physics is the peak *region* A ≈ 56–60. §2.7 gives both "peaks at ~8.8 MeV/nucleon"
and "most nuclides sit in a ~7–9 MeV band"; both are true and a cadet reading the second can easily
take 9 for the peak, so the two are stated separately and 9 is never allowed to stand in for 8.8.
And **the corpus never actually defines binding energy as the energy needed to separate the
nucleus** — it says only that the missing mass *is* the binding energy. That operational reading was
supplied, and it is the one place in this build where the text was read *into* rather than *out of*.

**Three values are derived rather than quoted, and say so in the file:** M(He-4) = 4.002603 u
back-computed from §2.7's own Δm, the ~23.8 MeV fusion estimate, and the ~286 MeV fission estimate.
**The fission number is labelled an upper bound** with an instruction never to present it as a real
fission energy — the corpus carries no fission-fragment binding energies, and 286 MeV is what you get
by assuming both fragments land exactly on the peak.

### Lesson 4 — Radioactivity

| | |
|---|---|
| **File** | [`phys310_preflight_radioactivity.jsx`](phys310_preflight_radioactivity.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-radioactivity-77500fd7` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/fed3e1c7-fa03-4e50-ad96-c5e0885c5678 |
| **Component** | `Phys310RadioactivityPreflight` |
| **Built** | 2026-08-05 · 2136 lines |
| **Grounding** | Murray corpus **§3.2** Modes of Radioactive Decay, **§3.3** The Radioactive Decay Law, **§3.4** Decay Chains and Natural Radioactivity — **all three `STATUS: PENDING`**. Plus a labelled carry-forward block from §3.1 and §2.5 (see below) |
| **Cross-check** | DOE NP-01 covers decay modes and the decay law; not consulted directly |
| **Cadets' reading** | Murray & Holbert 3.2–3.4 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 41 passed / 0 failed (37 base + 4 `--forbid` guards). Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `decay-modes-and-balance` | Predicts decay mode from instability; balances A and Z |
| 2 | `decay-law-and-activity` | Uses the decay law; half-life is a rate, not a lifetime |
| 3 | `chains-equilibrium-series` | Reasons about decay chains and the natural series |

**Extension problems:** A λ, atoms left after three half-lives, activity in Bq and Ci (approachable) ·
B track A and Z through α, β⁻, β⁻ and show `A mod 4` never moves (approachable) · C derive *8 alphas
and 6 betas* for U-238 → Pb-206 **from the endpoints alone**, then say what that argument cannot tell
you — the order (standard) · D same atom count at t½ = 30 y against 8.0 d, activities differing
1369×, which is just the inverse half-life ratio (challenging) · E why the 4n+1 series is extinct:
329 Np-237 half-lives fit inside one U-235 half-life, surviving fraction ~10⁻⁹⁹ (challenging).

> **This lesson picks up the probe lesson 3 was forbidden.** §3.1 names the predictive link
> *neutron-rich → β⁻, proton-rich → β⁺/EC, very heavy → α* as its own best probe, but decay modes
> belong here — so topic 1 has the cadet **build** that link rather than recall it, and lesson 3 stops
> at stability. The seam is real and structural, not a reading error: **the corpus puts §3.1's best
> probe in the one lesson that may not use it.**

> **⚠ The carry-forward block is the thing to check first if this artifact is ever wrong.**
> `TEXTBOOK_REFERENCE` contains a block tagged *CARRIED FORWARD FROM EARLIER LESSONS* holding three
> facts from §3.1 (nuclides decay toward the line, neutron excess ≈1.6 at uranium, nothing stable
> above Z = 83) plus the A/Z particle labels from §2.5. **Without them topic 1 is not derivable at
> all**, and the alternative was inventing them. Every item traces to the corpus. **Two values do
> not** — uranium Z = 92 and lead Z = 82 are periodic-table lookups, flagged as prerequisites in the
> file, and lead's is load-bearing for extension problem C.

> **⚠ §3.3 is the only assigned section in this course so far with no number in it at all** beyond
> the Curie definition — no worked example, no values. **Every number in extension problems A and D
> is a scenario constructed from the formulas, not a Murray worked value.** If §3.3 in the real book
> carries worked examples, this artifact does not reflect them, and nothing in the corpus would
> reveal that.

**Three more corpus findings.** §3.4 argues from *the age of the Earth* and never prints a number for
it — the argument is closeable from the four printed half-lives alone, which is how topic 3 and
problem E are built, but a build that took the corpus at face value would have needed Earth's age
from model knowledge. §3.2's account of why β⁺ and EC compete is **a single threshold number
(1.022 MeV) with no reasoning attached**; it reads authoritatively and cannot be probed past, so it
is carried as a fact with no probe on it. And **spontaneous fission is missing from §3.2's mode
list** — conspicuous in a nuclear-science course, and exactly where a cadet is likely to raise it, so
the tutor is instructed to confirm it is real and defer rather than develop it.

**What the one-topic-per-section mapping cost, chosen on merit rather than symmetry.** Gamma emission,
isomeric transitions, internal conversion and Tc-99m get no budget of their own — gamma survives as
topic 1's closing reach question (it changes neither Z nor A, so it cannot be a route to stability),
the rest are grounded and unprobed. Mean life τ = 1.443 t½ is in the corpus, in the reference and in
problem A, and is probed nowhere. Transient equilibrium is subordinated to secular. **The rejected
alternative** was merging §3.2 and §3.4 into one "what turns into what" topic and giving the decay law
two — rejected because §3.4's *why three natural series and not four* is the corpus's strongest probe
and does not survive being folded into bookkeeping.

**Extension problem B poses a decay *sequence* the corpus does not attest.** The corpus names the
U-238 series and its endpoint but not its steps, so the problem is framed as bookkeeping and carries
a tutor note forbidding it from being presented as a claim about which decays happen in what order.

### Lesson 6 — Lab 1: Measurement of Half-Life

> **REBUILT 2026-08-19, and it is the only artifact in this course grounded in a primary source.**
> recker added the cadet's actual Lab 1 write-up and the analysis workbook to the repository that
> day; both now live in [`../labs/lab-1/`](../labs/lab-1/) and are described in
> [`../labs/README.md`](../labs/README.md). The 2026-08-05 build below the fold was grounded in
> corpus §3.5 alone — **the entry the corpus flags as its own weakest in chapters 2–5** — and
> against the real documents that section turned out to be *thematically close and specifically
> wrong*. **This entry describes the rebuild.** The old build's slug was
> `phys310-lab-1-measurement-of-half-life-1f096984`; it was never published and never registered, so
> nothing points at it.

| | |
|---|---|
| **File** | [`phys310_preflight_lab_1_measurement_of_half_life.jsx`](phys310_preflight_lab_1_measurement_of_half_life.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-lab-1-measurement-of-half-life-11c49dbc` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/5f54b81d-31ec-4e78-9014-cb68e1f2d940 |
| **Component** | `Phys310Lab1MeasurementOfHalfLifePreflight` |
| **Built** | 2026-08-05 · **rebuilt 2026-08-19** · 2327 lines |
| **Grounding** | **PRIMARY:** `labs/lab-1/Lab1_Alt.pdf` (the graded write-up, 6 pp., 35 pts) and `labs/lab-1/Phys310 - Lab 1 - Analysis (2024).xlsx` (cell formulas read directly). **SECONDARY, tagged `[CORPUS]` in the reference:** §3.5 for σ=√N and background, §10.4 + §11.1 for ALARA, §3.3/§3.4 carried forward as the decay law |
| **Cross-check** | none needed for the primary material — it *is* the source. DOE NP-01 covers counting statistics; not consulted |
| **Cadets' reading** | their own Lab 1 write-up, plus Murray & Holbert 3.5 per the schedule |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 37 passed / 0 failed. LF throughout, 0 NUL. Diff against the pre-rebuild file is confined to the header comment, `INTERACTION_ID`, `OBJECTIVE_KEYS`, and the three content blocks — the component logic was not touched |
| **Backup build** | `site/gemini/phys-310/phys310-lab-1-measurement-of-half-life-11c49dbc.html`, built 2026-08-19, rendered 7/7 in headless Chrome |
| **Status** | **PUBLISHED 2026-08-19.** Objectives not yet reviewed. Registration on the DFPM site not confirmed — publishing is not registering, and until a lesson row carries this slug no cadet can reach it |

| # | key | label |
|---|---|---|
| 1 | `semilog-linearization-and-fit` | Linearizes the decay law; reads λ, t½ **and A₀** off a semi-log fit |
| 2 | `counting-statistics-and-background` | σ=√N on raw data only, background subtraction, and what the fit quality means |
| 3 | `alara-time-distance-shielding` | Applies ALARA — time, distance, shielding — to their own bench work |

**Extension problems, all built on the cadet's own lab:** A the two-point estimate and its
uncertainty **by bounding**, 2500 and 289 counts eight minutes apart → 2.57 min, range 2.48–2.67,
consistent with the accepted 2.552 (approachable — this is literally steps 6 and 7 of their
procedure) · B what background costs and *where*, 1700 ± 65 cts/min at t=0 against 100 ± 25 late,
3.8 % → 25 % (standard) · C reading the trendline both ways: slope → t½ = 2.552 min, **intercept
8.5172 → A₀ = 5000 cts/min**, and why the linear and exponential trendlines are one fit in two
coordinate systems (approachable) · D tuning the fit without fooling yourself — reduced χ² of 3.4
against 0.05, and why two-thirds of nine points is 6 (challenging) · E **ALARA at your own bench**,
3.0 µSv at 10 cm against 0.33 µSv at 30 cm, and which control this lab cannot use (standard).

> **⚠ WHAT THE REAL LAB DOCUMENTS OVERTURNED — the finding worth keeping from this rebuild.**
> The corpus's §3.5 entry warned about itself in exactly the right way, and it was right to. Two of
> the 2026-08-05 build's three probe topics rested on material that **appears nowhere in this lab**:
>
> - **Dead time** was a full objective (`bent-curve-background-deadtime`), with an extension problem
>   built on diagnosing a bent semi-log curve. The write-up and the workbook never mention it. It is
>   a detector property and belongs to lesson 18/19.
> - **The long-half-life ratio method, λ = A/N**, was half of topic 1, with a radium-226 extension
>   problem behind it. This lab measures a **2.552-minute** half-life by watching it decay; the
>   ratio method is the technique you use when you *cannot* do that.
>
> And it **omitted** most of what the cadet is actually graded on: reduced chi-square, error-bar
> sizing, linear regression, R², the intercept's meaning, and the comparison of three independent
> half-life estimates. **Sixteen of the thirty-five points are discussion questions**, and the old
> build addressed roughly one of them.
>
> **What survived:** σ = √N, the 1/√N scaling, and background-must-be-measured-not-looked-up. That
> half of §3.5 was correct, and it is retained tagged `[CORPUS]`.

> **⚠ THE SPREADSHEET DOES NOT USE QUADRATURE, AND THE OLD BUILD TAUGHT THAT IT DID.** The workbook
> computes each point's uncertainty as a **linear sum**:
> `σ = √(raw counts)/interval + √(background counts)/background time`.
> The write-up's own propagation step (7) is a **bounding** argument — σ on each of two raw counts,
> then the largest and smallest half-lives the range allows. **Neither document uses quadrature
> anywhere.** The 2026-08-05 build's extension problem B was built on it (*"in quadrature is 36, not
> 22"*), which would have had a cadet arguing with the sheet in front of them. The rebuilt reference
> states the linear form, forbids teaching quadrature as this lab's rule, and tells the tutor to
> acknowledge quadrature as legitimate prior coursework if a cadet raises it — **without correcting
> the lab to match the textbook**.

> **⚠ ALARA IS AHEAD OF THE READING, on instruction, and the artifact says so to the tutor.**
> recker asked on 2026-08-19 for one objective to be ALARA basics. It maps cleanly onto discussion
> question 6 (*the 3 main methods for decreasing exposure, and which we used in this lab*), and the
> cadet is about to handle a source — but **radiation protection is lesson 14 and lesson 15
> material, and this is lesson 6.** The corpus supplies the physics (§10.4 ALARA-below-the-limits,
> §11.1 time/distance/shielding), so it is grounded rather than invented. What the build does about
> the ordering is explicit in the scope note: **treat topic 3 as a build, not a recall check** — do
> not ask what they read, do not imply it was assigned, and do not penalise a cadet in the report
> for not knowing the term. Most can produce time/distance/shielding from intuition with one prompt.
> Dose units, limits, biological effect and attenuation are fenced off.
>
> **The sharp half of that topic is not the list.** It is that this lab uses time and distance and
> **cannot use shielding at all** — anything between the source and the tube attenuates exactly the
> 662 keV gammas being counted, so shielding the source would destroy the measurement. A cadet who
> reaches that has learned the three controls are not a checklist. Second reach: a 2.552-minute
> half-life makes the source **its own time control**, which is also why the procedure says to start
> counting immediately — the safety argument and the measurement argument point opposite ways on the
> clock.

**The tutor may now refer to the cadet's documents by name, and that is a deliberate narrowing of a
standing rule.** Everywhere else in this course the tutor never cites the grounding text, because a
cadet told *"§3.5 says"* goes and looks it up instead of thinking. **That rule is unchanged for the
textbook** and the reference repeats it. But the write-up and the spreadsheet are the cadet's own
working documents for the period they are walking into, and a preflight that cannot say *"your
write-up asks you to…"* is worse at its job for no gain. The distinction is stated in the reference
so it cannot be read as drift.

**Three numbers in the extension problems are constructed, and each says so in the file.** Problem
A's counts, problem B's counts and problem E's 90 µSv/h at 10 cm are scenario values — the lab
documents contain **no measured data at all**, since the tables are blanks a cadet fills in. Problem
C's slope was chosen to land on 2.552 minutes exactly and the file tells the tutor to say so if it
comes up, because real data will not. **Problem E's dose rate is the one to watch**: it is the only
place in this artifact where a physically-typed value was invented, it is fenced with an explicit
do-not-present-as-real instruction, and this course has no dose grounding until lesson 15.

**One thing the write-up settles that the corpus could not.** The sample is Ba-137m separated
chemically from its Cs-137 parent, so it is a **single** exponential — which is precisely why the
semi-log plot is straight and why the separation is worth a lateral connection. The old build,
lacking this, listed "a contaminant or a chain" as an abstract cause of curvature. It is now the
concrete reason a step in the procedure exists.

### Lesson 8 — Nuclear Reactions

| | |
|---|---|
| **File** | [`phys310_preflight_nuclear_reactions.jsx`](phys310_preflight_nuclear_reactions.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-nuclear-reactions-d02377ad` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/7b158bd2-0f69-49fb-b2d6-643f61a0b240 |
| **Component** | `Phys310NuclearReactionsPreflight` |
| **Built** | 2026-08-05 · 2170 lines |
| **Grounding** | Murray corpus **§4.1** Q-Value, **§4.2** Elastic Scattering and Slowing-Down, **§4.3** Capture and Absorption, **§4.4** Charged-Particle and Photon-Induced — **all four `STATUS: PENDING`**. Six nuclide masses carried from §2.6/§2.7 and labelled as carried |
| **Cross-check** | DOE NP-02 covers Q-values, scattering and capture; **explicitly thin on §4.4** per the corpus's own note |
| **Cadets' reading** | Murray & Holbert 4.1–4.4 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **§4.4 is grounded and deliberately unprobed** |
| **Checks** | `check_artifact.py` 37/37 on the 2026-08-26 rebuild, plus forbid-scans for the base lesson's slug, suffix, constants and objective keys. Gemini build rendered in real Chrome, `tests/browser-harness/gemini-build.mjs` 7/7 |
| **Status** | **REVIEWED 2026-08-26** — objectives 1 and 2 accepted, objective 3 REJECTED and rebuilt (below). Published build on claude.ai is 2026-08-20 and therefore **STALE**: it still runs the old objective 3. **Registered 2026-08-26** as `lesson-08`, due Thu 27 Aug 0930 MDT. Cadets reach it through the **Gemini build**, which is current |
| **Gemini build** | `site/gemini/phys-310/phys310-nuclear-reactions-d02377ad.html` — ported 2026-08-26 from the rebuilt source, same slug. This is the default door, so it is the build cadets actually get |

| # | key | label |
|---|---|---|
| 1 | `q-value-and-threshold` | Balances a reaction; reads the Q-value sign and threshold |
| 2 | `elastic-scattering-moderation` | Explains why light nuclei slow neutrons and heavy ones do not |
| 3 | `reaction-rate-ingredients` | Reasons out what sets how often a reaction happens |

#### Objective 3 replaced, 2026-08-26 — capture/activation/breeding → reaction rates

**recker's review decision, recorded in `REVIEW-NOTES.json`:** objective 3
`capture-activation-breeding` **rejected**, comment *"Replace with reaction rates"*. Objectives 1
and 2 accepted unchanged.

**The instruction crosses a lesson boundary, which is why the replacement is a BRIDGE and not a
transplant.** Reaction rate is `R = Σφ`, and it lives in corpus **§4.5** — the reading for
**lesson 9, Mon 31 Aug**. A cadet sitting this preflight on 27 Aug has read 4.1—4.4 and nothing
else. Grading them on σ, the barn and Σ would be grading work they were never assigned. Confirmed
with recker before the edit; he chose the bridge depth and chose to let capture/breeding go rather
than add a fourth topic.

**What topic 3 now does.** The cadet is asked what they would need to know to predict how many
reactions happen per second in a real block of material, and reasons out three ingredients from
material they *have* read: how many target nuclei are in the way (number density, from lesson 2),
how many neutrons are arriving, and how likely one neutron meeting one nucleus is to react. The
third is the load-bearing one, and it carries two corrections — that `Q > 0` does not mean it
happens, and that the likelihood is **not** the physical size of the nucleus. The lever for the
second is a comparison the cadet can check in their own reading: **boron-10 is a small nucleus and
an outstanding absorber**, which is why §4.3 singles it out for control rods.

**The vocabulary is spoken exactly once, at the end.** After the reasoning has arrived — and only
then — the tutor names σ, the barn, Σ = Nσ and R = Σφ in one breath, says they are next lesson's
business, and stops. No values, no 1/v law, no resonances, no mean free path, no worked rate.
`TEXTBOOK_REFERENCE` carries a §4.5 block **labelled CARRIED**, exactly the way the nuclide masses
are, with three rules on it: name never teach, nothing beyond the names, and **never grade on the
vocabulary**. A cadet who built all three ingredients and had never heard the word "barn" has the
objective completely.

**What moved with it.** Header comment (the four-into-three note now covers §4.3 as well, plus the
directed-change record) · `OBJECTIVE_KEYS` · the §4.3 "how likely" bullet, which was a hard
do-not-say boundary and is now the topic's on-ramp · a new carried §4.5 reference block · probe
topic 3, rewritten in full · misconception 3 (`Q > 0 means it happens`), reframed from boundary to
on-ramp · misconception 6, replaced with "a bigger nucleus is a bigger target" — the old
capture-changes-the-element error stays flagged inside the reference, where the chain is written
out · prerequisites, which now name number density · `scope_note`, where capture/activation/breeding
became a GROUNDED-BUT-NOT-PROBED block and the cross-section boundary was rewritten as the topic-3
handover line.

**Checks:** `check_artifact.py` 37/37, LF preserved, 0 NUL, `INTERACTION_ID` byte-identical.
138,479 → 146,584 bytes. **The slug did NOT change and must not** — this is a patched republish
into the same offering, not a rebuild for a new one, so `activities.slug` stays
`phys310-nuclear-reactions-d02377ad` and the lesson keeps one row.

> **⚠ The claude.ai build is stale, and recker decided on 2026-08-26 NOT to republish it. That is
> a decision, not an outstanding task — do not "fix" it.** *"Can I make the gemini version and not
> post the claude version? Those aren't working on free accounts right now."* Free-tier Claude is
> timing cadets out, which is the same reason the site reversed its default on 2026-08-21. So the
> 2026-08-20 URL keeps serving the OLD objective 3 forever, and no cadet ever opens it.
>
> **Verified in the code, not assumed.** `site/student/lessons.html` renders exactly ONE launch
> button: Gemini where `backupHref` is set, Claude only where it is null. This lesson has a Gemini
> build, so the Claude branch is unreachable for it. Nothing cadet-facing anywhere under
> `site/student/` links to claude.ai, and the four claude.ai strings inside the Gemini build are
> comments. The porter strips `BACKUP_ENDPOINT`, the backup button and the mid-lesson handoff
> anchor, so the build has no path back either.
>
> **THE TRAP, AND IT IS THE ONLY REAL RISK HERE: do NOT null `activities.content.artifact_url`.**
> It is tempting — the Claude build is stale and unused, so the field looks like dead weight. But
> `backupHref` is gated on `interactiveAvailable`, which is gated on `isArtifactLaunchable()`, which
> is nothing but `/^https?:\/\//i.test(artifact_url)` (`site/js/schema.js:516`). It never fetches
> the URL and cannot tell stale from current. Clear it and `backupHref` goes null, the Gemini button
> disappears, the Claude branch is taken with no URL to open, and **the lesson becomes unreachable**
> — with the row still looking perfectly healthy. The stale URL is load-bearing precisely because
> nothing reads it.
>
> If this lesson is ever rebuilt for a LATER OFFERING, that is a different case: contract §3.2 mints
> a new slug, a new lesson row, and a fresh publish, and none of the above applies.

**Extension problems:** A balance B-10(n,α)?, Be-9(α,n)? and the full breeding chain, sorting
reactions from decays (approachable) · B minimum retained-energy fraction for deuterium (0.111) and
oxygen (0.7785), **after verifying the method reproduces the reading's own 0.716 and 0.983**, then
light vs heavy water and what the numbers *cannot* decide (approachable) · C collisions to thermalize
2.0 MeV → 0.025 eV: ~18 in hydrogen, ~115 in carbon, and why the count is start-point independent
(standard) · D the one Q-value this corpus can actually compute — γ + H-2 → H-1 + n, Q = −2.224 MeV,
equal to the binding energy *and* to the quoted photonuclear threshold (standard) · E hypothetical
Q = −1.000 MeV giving E_th = 1.084 MeV on C-12 against 1.004 MeV on U-238, and why the excess scales
as 1/m_X (challenging).

> **⚠⚠ §4.1 defines the Q-value and supplies no masses. None.** Not for B-10(n,α)Li-7, not for
> Be-9(α,n)C-12, not for N-14(α,p)O-17, not for any step of the breeding chain — and no other corpus
> entry carries them either. **The lesson's headline calculation is ungrounded for every reaction the
> lesson actually names.** Handled by borrowing the light-nuclide masses from §2.6/§2.7 (which makes
> the deuteron case computable), telling the tutor plainly that it has no others and must refuse
> rather than quote one, and building exactly one real Q-value problem. **A section that defines Q
> and supplies no masses reads as complete and is not.**

> **⚠ §4.1 and §4.4 contradict each other about the deuteron, and this one is a real defect.** §4.1
> states flatly that the threshold *exceeds* |Q|; §4.4 gives the deuteron photonuclear threshold as
> 2.224 MeV — *exactly* |Q|. Both are defensible: the §4.1 rule is written for a massive projectile
> and the photon recoil correction is negligible. **The corpus never says so**, so a tutor reading
> both has an apparent contradiction and no way to resolve it. The artifact carries an explicit
> range-of-validity note in both the reference and problem D (*do not apply E_th ≈ |Q|(1+m_a/m_X) to a
> photon; do not invent a recoil correction*) and instructs the tutor to **praise a cadet who spots
> it rather than resolve it**. **This should be fixed upstream in the corpus, not only papered over
> here.**

> **⚠ §4.3 cannot be taught without crossing into lesson 9, because the source itself crosses.** The
> corpus's §4.3 says B-10(n,α)Li-7 has a "large thermal **cross section**" — the term lesson 9 owns.
> It is paraphrased throughout as "a large thermal absorber", and σ, Σ, barns, the 1/v law,
> resonances, mean free path and reaction rate are all forbidden by name in the scope note. **The
> boundary holds, and it is the tightest one in this artifact.**

**§4.4 is grounded and deliberately unprobed — the four-into-three call.** Three reasons, in order of
weight: it is **the corpus's own least-confident entry in the chapter** (self-flagged as possibly
covering something else entirely, with little DOE cross-check), so it is the wrong place to spend the
topic slot most at risk; its content is one big idea — the Coulomb-barrier asymmetry — plus two
pieces of history, and the idea lands as a one-line contrast inside topic 3 without needing three
Socratic minutes; and §4.1–4.3 are load-bearing downstream in a way Rutherford's transmutation is
not. The scope note tells the tutor to pursue it warmly if a cadet raises it, **which they may well,
since it is the reading's most quotable sentence.**

> **This lesson does not need splitting, but it is the closest call in the run so far.** If recker
> wants the Coulomb-barrier asymmetry probed, **the split is §4.1–4.2 / §4.3–4.4, not a fourth
> topic** — that boundary falls between *what a reaction is and how neutrons lose energy* and *what
> absorption produces and why neutrons are the projectile of choice*, and both halves stand as
> three-topic lessons. Not split here; `COURSE_PROFILE.md` makes splitting a decision, not a build
> step.

**Two smaller corpus notes.** §4.2's ξ ≈ 1.0 for hydrogen is really 0.999 and the corpus flags it —
harmless, but the collision counts inherit it. And §4.2 gives **no neutron birth energy**, so "about
twenty collisions in hydrogen" is derived from the corpus formula with a 2 MeV premise supplied by
the build, not a number the corpus states; it is robust across the fast range (ln ratio 17.5–19.8),
but it is not Murray's.

**One machinery string was changed, against the copy-unchanged rule, and it is recorded here rather
than hidden.** The TIERED GROUNDING block's illustration reads *A cadet told "section 2.6 says"…*;
2.6 is not a section of this lesson, so it was changed to 4.2. **Lessons 4 and 6 still carry the
base's `2.6` verbatim.** Left inconsistent on purpose — matching the published, parsed base is worth
more than cosmetic alignment across drafts, and the string is an example of what *not* to do rather
than content.

### Lesson 9 — Cross Sections

| | |
|---|---|
| **File** | [`phys310_preflight_cross_sections.jsx`](phys310_preflight_cross_sections.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-cross-sections-9308e38c` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/1dd0221d-2f8b-4088-bbea-ca5fd55044c6 |
| **Component** | `Phys310CrossSectionsPreflight` |
| **Built** | 2026-08-05 · 2179 lines |
| **Grounding** | Murray corpus **§4.5** Cross Sections, **§4.6** Energy Dependence — **both `STATUS: PENDING`**. Six values carried forward from earlier sections, each tagged `[carried forward]` |
| **Cross-check** | DOE NP-02 covers microscopic/macroscopic σ and the 1/v law; not consulted directly |
| **Cadets' reading** | Murray & Holbert 4.5–4.6 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 37/37 (re-run 2026-08-26, unchanged source), LF, 0 NUL. Gemini build rendered in real Chrome, `tests/browser-harness/gemini-build.mjs` 7/7 |
| **Status** | **REVIEWED 2026-08-26 — NO CHANGES.** recker reviewed and had nothing to change, so the `.jsx` is untouched and the claude.ai build published 2026-08-20 is still the current source. **Registered 2026-08-26** as `lesson-09`, due Sun 30 Aug 1959 MDT |
| **Gemini build** | `site/gemini/phys-310/phys310-cross-sections-9308e38c.html` — ported 2026-08-26, same slug. This is the default door, so it is the build cadets actually get |

| # | key | label |
|---|---|---|
| 1 | `sigma-area-not-size` | Reads a cross section as a probability, not a nuclear size |
| 2 | `macroscopic-sigma-per-path` | Builds Σ = Nσ and reads it per unit path length |
| 3 | `energy-dependence-1-over-v` | Explains the 1/v law and resonances as energy dependence |

> **This lesson is now the far side of a handover, and objectives 1 and 2 are where a cadet lands.**
> Lesson 8's third topic was rebuilt on 2026-08-26 to have the cadet REASON OUT the three things a
> reaction rate depends on, then name sigma, the barn, Sigma = N*sigma and R = Sigma*phi in one
> breath as this lesson's business and stop. So a cadet arriving here has met the words once,
> attached to reasoning they did themselves, and has been told nothing else — no values, no 1/v,
> no resonances, no mean free path. **Nothing in this artifact was changed for that**, and nothing
> needed to be: `sigma-area-not-size` and `macroscopic-sigma-per-path` are exactly the two ideas
> lesson 8 hands over, and meeting them twice — once as a name, once as the lesson — is the point
> of a bridge rather than a duplication. Objective 3 is entirely lesson 9's own.
>
> If lesson 8's topic 3 is ever reverted or reworded, **read this row before assuming this lesson
> still opens on unfamiliar ground.**

**Extension problems:** A 3840 b → cm² → implied radius against B-10's real radius, then U-238's
*geometric* area in barns (standard) · B 585 b against 2.7 b for the two uranium nuclei whose
geometric areas differ by under 1 %, and what that comparison does **not** establish (standard) ·
C Σ_s and Σ_a for hydrogen in water, the ratio, and when N does *not* cancel (standard) · D 1/v in
numbers — 4× energy halves σ, 100× divides it by ten — then the mechanism in one sentence
(approachable arithmetic, challenging final part) · E Σ from U-235 fission against U-238 capture in
natural uranium metal: **0.72 % of the atoms carrying 61 % of the total** (challenging). Independently
re-checked in Python.

> **⚠ More than half of §4.5's content belongs to the next lesson, and the corpus admits it.** Six
> physics bullets; three of them — **λ = 1/Σ**, **R = Σφ**, and beam attenuation — sit at or past the
> §4.7 boundary. The Flags block says outright that it does not know "whether flux and reaction rate
> are defined here or with transport in §4.7". Both are carried in `TEXTBOOK_REFERENCE` and named in
> `scope_note` as grounded-but-not-probed.
>
> **The seam risk runs the other way and it was verified, not assumed: `R = Σφ` appears in BOTH §4.5
> and §4.7, but `λ = 1/Σ` appears ONLY in §4.5.** A grep of §4.7 for *mean free path*, *1/Σ* and
> *lambda* returns nothing. **A lesson-10 build that excerpts §4.7 alone gets no mean free path at
> all** — and its Physics block gives no hint that one is missing.

> **⚠ §4.5 asserts this lesson's central claim and supplies no evidence for it.** It says σ "is a
> probability wearing the units of area — it is not the physical size of the nucleus", and stops.
> **§4.5 contains no numbers whatsoever.** Every magnitude used to *demonstrate* the claim — hydrogen
> 20 b vs 0.33 b, U-235 585 b vs U-238 2.7 b, B-10 3840 b — comes from §4.6. Both sections are
> assigned here so the excerpt is legitimate, but **§4.5 alone cannot support this lesson's priority
> objective**, and a reviewer opening §4.5 in isolation finds a confident definition list that would
> not survive a cadet asking *how do you know?*

> **⚠ An unresolved upstream flag was moved into a shipped artifact — the only time in this run.**
> §4.6's Flags say its magnitudes are *standard tabulated values, not necessarily Murray's printed
> digits*, and to check what Murray prints "since cadets will use his." That could not be resolved
> without the book, so it is carried into the artifact as a second provenance paragraph instructing
> the tutor **never to contradict a cadet's book over a last digit**. Recorded here because a flag
> that leaves the corpus stops being visible to whoever reviews the corpus.

**Two smaller findings.** *Thermal* is not one number in this corpus — §4.2 says 0.025 eV / ~2200 m/s,
§4.6's Flags say 0.0253 eV; a 1.2 % difference, physically irrelevant and worth knowing. And **the
resonance explanation is grounded only by a cross-reference out of the lesson**: §4.6 explains
resonances entirely by "the compound nucleus has a matching state", and the compound nucleus is §4.1,
which belongs to lesson 8. Handled as a prerequisite rather than restated, but the assigned sections
do not by themselves explain why a resonance sits where it does.

**Also noted:** §4.5's additivity rule is written `Σ_a = Σ_c + Σ_f`, naming fission fifteen lessons
early; kept verbatim with fission bounded in `scope_note`. Doppler broadening has no confirmed home
per §4.6's Flags — grounded in full, engage-if-raised, walled off from reactivity and control rods.

### Lesson 10 — Neutron Transport

| | |
|---|---|
| **File** | [`phys310_preflight_neutron_transport.jsx`](phys310_preflight_neutron_transport.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-neutron-transport-4ecf35e0` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/3959b60d-3f58-4e81-b146-4a81ed495694 |
| **Component** | `Phys310NeutronTransportPreflight` |
| **Built** | 2026-08-05 · 2170 lines |
| **Grounding** | Murray corpus **§4.7** Neutron Flux, Current, and Transport — `STATUS: PENDING`. **λ = 1/Σ carried forward from §4.5**, plus Σ = Nσ, atom density (§2.1), five thermal σ magnitudes (§4.6) and the 0.025 eV / 2200 m/s reference (§4.2) — every one tagged as carried |
| **Cross-check** | DOE NP-02 covers flux, reaction rate and mean free path; not consulted directly |
| **Cadets' reading** | Murray & Holbert 4.7 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 43 passed / 0 failed (37 base + 6 `--forbid` scans covering **both** the structural base and lesson 9's slug). Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `flux-scalar-path-swept` | Reads flux as path length swept, not as a flow |
| 2 | `reaction-rate-and-mean-free-path` | Uses Σφ as a rate and 1/Σ as a distance |
| 3 | `flux-versus-current-and-leakage` | Separates flux from current; reads leakage as a surface effect |

**Extension problems:** A n = 1.0×10⁸/cm³ at 2200 m/s → φ = 2.2×10¹³, then whether the answer changes
if all the neutrons go one way — **no** — and what does (approachable) · B *free of what?* — λ_s ≈
0.75 cm against λ_a ≈ 45 cm in water, a factor of 61, closing on the point that "**the** mean free
path" is an unfinished sentence (standard) · C R_a ≈ 4.85×10¹¹ and R_s ≈ 2.94×10¹³ per cm³ per s,
then a question the flux **cannot** answer — net crossings of a plane (standard) · D two opposed
10¹³ beams: flux 2.0×10¹³, net current zero, R = 4.0×10¹¹, and reversing one changes *only* the
current (standard) · E S/V = 3/R, 0.60 against 0.060 cm⁻¹ at R = 5 and 50 cm, plus a 10 cm cube
against an equal-volume sphere, ~19 % apart — **and it stops before criticality** (challenging).

> **⚠⚠ §4.7 contains no numbers at all. Not one.** No constant, no magnitude, no worked example, no
> figure — definitional from end to end, and **nothing in it can be computed from itself.** This is
> worse than lesson 9's §4.5 finding, because §4.5 at least had §4.6 assigned alongside it; here
> there is no companion section. Every number in this artifact is carried forward and tagged, and the
> reference opens with a second provenance paragraph saying so.

> **⚠ The diffusion coefficient `D` is used three times and never defined or valued.** It appears in
> Fick's law, in the diffusion equation, and inside L = √(D/Σ_a) — and the corpus never says what it
> is, how it relates to Σ_s, or what magnitude it takes for any material. **So the diffusion length L
> is uncomputable too**, in a section whose selling point for L is that it *"sets how thick a shield
> must be."* A cadet who asks *so how thick?* hits a wall. The gaps are named explicitly in
> `KEY CONSTANTS` and the tutor is told to reason about the shape of the answer rather than invent a
> figure. **The current J has the same defect one level down**: defined only by contrast, computable
> only through Fick's law, and Fick's law needs the D nobody has.

> **⚠ The section's most quotable consequence is unsupported inside it.** *"Leakage is a surface
> effect and absorption a volume effect, so small systems leak proportionally more"* is stated, then
> used to motivate critical size in Ch. 16 — with **no surface-to-volume ratio, no shape, and no
> scaling anywhere.** Extension problem E supplies S/V = 3/R, which is arithmetic rather than
> imported physics, but the gap is the corpus's.

**§4.7 is the densest section per line in the run and reads as complete.** Seven substantial ideas —
flux, current, isotropy, reaction rate, Fick's law, the diffusion PDE, the diffusion length, leakage
geometry — in about twenty lines, one bullet each. **It is genuinely sufficient for a conceptual
ten-minute preflight and would not survive any quantitative demand**, which is precisely why it is
flagged: a reviewer skimming it will read it as sufficient.

**Three topics fit without padding, and a fourth was rejected on merit.** The diffusion equation and
diffusion length would stand as a topic if the profile allowed four — but it would be the weakest,
because a ten-minute pre-class conversation cannot probe a PDE it cannot solve and has no
coefficients for. It is grounded, placed inside topic 3, and walled in the scope note as *place it,
do not develop it*.

**§4.7's own Flags carry an open question that touches nothing here:** whether Murray names `L` or
`L²`. There is no numerical L in the artifact and the distinction is invisible to a cadet, so it is
carried as a tutor-only note rather than silently resolved.

**The `"section 2.6 says"` illustration string is now a known inconsistency across this course.**
Lesson 8 changed its copy to `4.2`; lessons 4, 6, 9 and 10 keep the base's `2.6` verbatim. **Left
inconsistent deliberately** — matching the published, parsed base is worth more than cosmetic
alignment across drafts, and the string is an example of what *not* to do rather than content.
Recorded so it stays visible rather than becoming folklore.

### Lesson 13 — Radiation Interactions with Materials

| | |
|---|---|
| **File** | [`phys310_preflight_radiation_interactions_with_materials.jsx`](phys310_preflight_radiation_interactions_with_materials.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-radiation-interactions-with-materials-1dd51596` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/cefd54d7-e429-4972-85ac-4646eab622c9 |
| **Component** | `Phys310RadiationInteractionsWithMaterialsPreflight` |
| **Built** | 2026-08-05 · 2265 lines — **the longest artifact in this course** |
| **Grounding** | Murray corpus **§5.1–§5.5** — **all five `STATUS: PENDING`**. Two values tagged as carried: the 0.511 MeV electron rest energy and the 0.025 eV / 2200 m/s thermal reference |
| **Cross-check** | DOE NP-01/02 cover range and gamma attenuation; **the corpus itself calls the cross-check thin for §5.5** |
| **Cadets' reading** | Murray & Holbert 5.1–5.5 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **§5.5 is grounded and almost entirely unprobed** |
| **Checks** | `check_artifact.py` 46 passed / 0 failed (37 base + 9 `--forbid` scans covering the base's slug, suffix, title, component and **all three of its objective keys**, plus lesson 10's slug). Re-verified independently: 37/37, LF, 0 NUL, and the lesson-14 boundary confirmed by grep — the only mentions of *gray*, *sievert*, *rem* or *quality factor* are inside one prohibition block |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `range-versus-attenuation` | Separates a definite range from exponential attenuation |
| 2 | `gamma-mechanisms-and-shielding` | Picks the dominant photon mechanism; reads μ and the half-value layer |
| 3 | `neutron-inversion-and-aftermath` | Explains why neutron shielding inverts, and what it leaves behind |

**Extension problems:** A ion pairs from a 5 MeV alpha (~1.5×10⁵, ~3.7×10⁴/cm) against a 1 MeV beta
(~2.9×10⁴, ~290/cm) — **the 125× ratio is exactly 5 × 25 and is imported from nothing**
(approachable) · B μ and HVL from a single measurement: 25 % through 2.0 cm → μ = 0.69 cm⁻¹,
HVL = 1.00 cm, 6.6 cm for 1 %, **no thickness for zero**, and the 1 % is uncollided-only (standard) ·
C which mechanism dominates in three cases, and why 0.8 MeV can never pair-produce at any intensity
(approachable) · D two shields chosen wrong — lead on betas (bremsstrahlung), lead on neutrons (the
inversion) (standard) · E a neutron shield in three layers, why the order is forced, the forgotten
capture gammas, and activation plus displacement damage after a year (challenging).

> **⚠⚠ The attenuation law is given and not one attenuation coefficient is.** §5.3 states
> `I = I₀e^(−μx)` and `HVL = ln2/μ` and supplies **no numerical μ, μ/ρ, or half-value layer for any
> material** — not lead, not water, not concrete. Same defect shape as lesson 10's missing `D`, and
> worse in one respect: **the missing quantity is the one a cadet will ask for by name**, in a lesson
> whose whole subject is shielding. Extension problem B has to *stipulate* its coefficient through a
> measurement because there is nothing to look up.

> **⚠ The lesson has almost no numbers at all.** Beyond 34 eV per ion pair and two range anchors
> (5 MeV alpha ≈ 4 cm of air; 1 MeV beta ≈ a few mm of Al), there is **no range formula, no
> stopping-power value, no LET figure, no dpa number, no DBTT shift**.

> **⚠ §5.3's regime boundaries cannot settle the case they most invite.** Compton is said to dominate
> "about 0.1–10 MeV" and pair production to "grow with energy and Z²" — which cannot decide which
> wins for a 6 MeV photon in lead, a completely natural question. Extension problem C says so out
> loud rather than resolving it, **but a reader skimming §5.3 will not notice the gap.**

**Five sections into three topics — what was dropped.** Probed: the range/attenuation dichotomy
(§5.1 + the range half of §5.2), the three gamma mechanisms with μ and HVL (§5.3, using §5.2's
bremsstrahlung rule as counterpoint), and the neutron inversion (§5.4) with §5.5's fast-versus-thermal
damage split. **Grounded in full and unprobed: linear energy transfer, and all of §5.5 but that one
split** — displacement cascades and dpa, embrittlement and the DBTT rise, swelling, creep, hardening,
helium at grain boundaries, Wigner energy and Windscale, radiolysis. **§5.5 was the section to give
up** because it is the only one of the five whose cross-check the corpus itself calls thin, and
because §5.1–5.4 form one connected argument while §5.5 is a different subject.

> **This lesson is the widest overflow in the course and was NOT split.** If recker wants it split,
> **the seam is §5.1–5.3 / §5.4–5.5** — charged particles and photons on one side, neutrons and
> materials on the other. Both halves stand cleanly as three-topic lessons and the seam falls where
> the corpus's own subject changes. `COURSE_PROFILE.md` makes that recker's decision, not a build
> step.

**Two forward references land in lesson 14's territory inside these sections** — §5.2 ends on LET as
"the bridge to Ch. 10's biological effectiveness", §5.4 says neutrons "carry large quality factors in
Ch. 10". LET is grounded as a *physics* quantity and both biological halves are walled off; verified
by grep that no dose unit or quality factor appears anywhere except in the prohibition itself.

**§5.4's moderation content overlaps lesson 8, and the corpus drew the line itself:** §5.4 states the
two-step shielding *strategy* with no slowing-down physics, because that derivation lives in §4.2. So
the strategy and the energy classification are this lesson's, and the mechanism stays lesson 8's.

**Not a defect, worth recording:** the half-life ↔ half-value-layer correspondence — same exponential,
`ln 2` in the same place, distance standing in for time — is the strongest lateral hook in the lesson
and **the corpus never mentions it.** It is drawn in the artifact from the prerequisite lesson.

### Lesson 14 — Bioeffects and Safety

| | |
|---|---|
| **File** | [`phys310_preflight_bioeffects_and_safety.jsx`](phys310_preflight_bioeffects_and_safety.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-bioeffects-and-safety-a111da9b` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/a2fb5ebc-af78-490d-8726-861095c9122a |
| **Component** | `Phys310BioeffectsAndSafetyPreflight` |
| **Built** | 2026-08-05 · 2255 lines |
| **Grounding** | Murray corpus **§5.6**, **§10.1**, **§10.2**, **§10.4** — **all four `STATUS: PENDING`**. §10.3 is not assigned and is not in the reference |
| **Cross-check** | DOE covers bioeffects only lightly; the corpus flags **reduced confidence on organization** for §5.6 |
| **Cadets' reading** | Murray & Holbert 5.6, 10.1–10.2, 10.4 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `dose-quantities-and-weighting` | Separates activity, absorbed dose and equivalent dose; applies w_R |
| 2 | `deterministic-versus-stochastic` | Tells a threshold tissue reaction from no-threshold stochastic risk |
| 3 | `limits-alara-and-background` | Reads a dose limit against background; explains ALARA and LNT |

**Extension problems:** A the same 20 mGy delivered by gammas and by alphas → 20 mSv against
400 mSv (approachable) · B the public limit as a share of background — 1/3.1 ≈ 32 %, 1/6.2 ≈ 16 % —
then *what is the limit actually doing?* (standard) · C 50 and 20 mSv/y read as years of average
exposure (≈8.1 and ≈3.2); a worker at 12 mSv is compliant **and that is not the end of the question**
(approachable arithmetic, challenging concept) · D background parts summing to 3.13, radon ≈ 74 %,
altitude ≈ one doubling of the cosmic term, and *how precise that is allowed to be* (standard) ·
E burn against cancer told apart by dose-response, and which category the limits protect against —
**provable from the numbers alone, no arithmetic** (challenging).

**Topic 3's priority comparison is the one that carries the lesson:** the public limit (1 mSv/y) is
*smaller than natural background* (3.1 mSv/y), so **a limit cannot be a threshold.** ALARA follows as
the principle below the limit — compliance is a floor — and LNT is handled as an **evidence**
question, never a political one.

> **⚠⚠ There is no risk coefficient anywhere in the corpus.** It supplies LNT, a full set of limits,
> and the entire background budget — and **not one number linking dose to a probability of harm**. No
> %/Sv, no lifetime-risk figure, no cancers per person-sievert. **The hole is invisible**, because the
> surrounding text is dense with decimal places and reads as complete, and **the single most natural
> cadet question in this lesson is numerically unanswerable.** It is the artifact's second PROVENANCE
> note, with an explicit instruction that inventing a number here would be the worst available
> failure.

> **⚠ §10.2 contradicts its own arithmetic.** It states radon as 2.3 of 3.1 mSv and calls that "about
> two-thirds". **2.3/3.1 is 74.2 %** — checked. The artifact tells the tutor the cadet's arithmetic is
> the better number and forbids defending the printed fraction.

> **⚠ Almost none of the numbers are attributed to Murray.** The corpus flags the limits as US NRC,
> the background figures as NCRP/UNSCEAR, and the acute landmarks as "standard ranges" — and warns
> that ICRP weighting factors have changed between publications. **So `w_R = 20` for alphas and 5–20
> for neutrons may not be the set Murray prints, and cadets will use his.**

**Two more corpus findings.** §10.1 gives `w_R` values and **no `w_T` values**, so effective dose can
be stated and never worked — and the corpus does not flag this as a gap. And there is a **dangling
cross-reference**: §10.1 justifies the alpha weighting via "LET clustering from §5.2", while §5.2's
own Flags say *"whether LET is defined here or in the bioeffects chapter"* — the corpus cites a
section that is unsure it contains the thing being cited.

**§10.2 is the thinnest section in the lesson while looking the densest** — a table of averages with
essentially no mechanism, no reason radon concentrates indoors beyond "traces to the U-238 chain", no
account of why cosmic dose scales with altitude, and no uncertainty on any figure. It is probed only
as a **ruler** for topic 3, and the tutor is told not to drill the table.

**The ALARA boundary went to this lesson, on evidence rather than by assumption.** §11.1 — lesson
15's — covers time, distance, shielding and contamination control and **never mentions ALARA**; §10.4
owns it outright as "the operating principle *below* the limits". So ALARA-as-principle is here and
the three controls, dose-rate calculation and shield design go to lesson 15. The `scope_note` warns
that **ALARA itself is what invites the crossing** ("so how do you actually reduce a dose?").

> **A stale lesson number was found in the corpus and fixed.** §5.6's Flags prose still read
> *"the schedule pairs it with Ch. 10 for Lesson 15"* — residue of the 2026-08-05 renumber, which
> re-pointed the `STATUS:` trailers and left Flags prose alone. **Rewritten to name the topic rather
> than the number**, which is the only form that survives the next renumber. §5.6's `STATUS:` count
> is untouched: still 56 pending, 3 reviewed.

**Nothing was dropped from the reference — only from probing.** Grounded and unprobed, named in
`scope_note`: effective dose `E = Σ w_T·H_T` and tissue weighting, exposure and the roentgen,
collective dose in person-sieverts, the per-procedure medical figures, the full background breakdown
as a recall target, and the radiosensitivity ordering plus acute whole-body landmarks — the last
available inside topic 2, explicitly not its priority, and fenced by the tone rules.

**Human-harm handling:** every example is generic (*a worker*, *a cadet*); no real person, no real
incident victim, no invented-but-realistic patient. **Effort is the grade** — a cadet who is wrong
about radiation risk is not penalized and the tutor does not moralize. Topic 3's LNT thread is
deliberately about *evidence and study design* rather than about a risk number, **because the risk
number is the thing the corpus does not have.**

### Lesson 15 — Dose and Shielding

| | |
|---|---|
| **File** | [`phys310_preflight_dose_and_shielding.jsx`](phys310_preflight_dose_and_shielding.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-dose-and-shielding-43f26ac6` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/520b7329-83bd-448a-8092-05aa616b345a |
| **Component** | `Phys310DoseAndShieldingPreflight` |
| **Built** | 2026-08-05 · 2206 lines |
| **Grounding** | Murray corpus **§11.1** Time, Distance, and Shielding, **§11.2** Dose-Rate Calculations, **§11.3** Shielding Calculations and Buildup — **all three `STATUS: PENDING`** |
| **Cross-check** | DOE covers attenuation, HVL and shielding materials; **buildup more lightly**, per §11.3's own note |
| **Cadets' reading** | Murray & Holbert 11.1–11.3 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 39 passed / 0 failed (37 base + 2 `--forbid`). Re-verified independently: 37/37, LF, 0 NUL, **and both effective-half-life answers recomputed** — 9.98 d and 7.27 d, both correct |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `three-controls-and-inverse-square` | Ranks time, distance and shielding; knows where 1/r² fails |
| 2 | `shield-arithmetic-and-buildup` | Sizes a shield in half-value layers and corrects it with buildup |
| 3 | `internal-dose-and-effective-half-life` | Explains why an intake defeats all three controls |

**Extension problems:** A distance against shielding for the same factor of 16 — 4.0 m back, or 4
HVLs (approachable) · B **the payoff problem** — a factor-of-1000 shield is 10 HVLs, cross-checked by
TVLs, and then B = 5 turns it into a factor of **205**, needing ~2.3 HVLs more (challenging) · C the
6 R/h rule of thumb: 2.0 Ci at 1.5 MeV → 18 R/h at 1 ft, 0.18 at 10 ft, 100 min ≡ 1 min (standard) ·
D effective half-life — tritium's 12.3 y with a 10 d biological half-life gives **9.98 d**, then 8 d
with 80 d gives 7.27 d (standard) · E one job solved three ways by a single control each —
2.5 min / 1.73 m / 3.58 HVLs, and 4.58 once B = 2 (challenging synthesis).

> **⚠⚠⚠ THE COURSE NEVER GIVES A CADET A SINGLE ATTENUATION COEFFICIENT. Asked explicitly, checked
> across all 1 800 corpus lines, answered NO.** The question put to this build was whether §11.3
> closes the gap lesson 13 found in §5.3. **It does not.** §11.3 genuinely *adds* — TVL = ln10/μ ≈
> 3.32 HVL, HVLs stacking multiplicatively, three giving 1/8, and buildup `D = D₀·B·e^(−μx)` with
> B = 2–10+ — but it supplies **no μ, no μ/ρ, and no half-value layer for lead, water, concrete or
> anything else.** Independently confirmed by grep: five hits across the corpus for
> *half-value / HVL / TVL / attenuation coefficient / μ-ρ / cm⁻¹*, and **not one of them is a number.**
>
> **So lesson 13's workaround was not a local gap to be closed one chapter later — it is the corpus's
> permanent state.** This artifact is built around it: **the half-value layer *is* the unit**, every
> centimetre figure is stipulated in its own problem statement, and the tutor is instructed to say
> out loud that it is stipulating.

> **⚠ The same hole exists for Γ, and its shape is worse.** §11.2 gives `Ḋ = Γ·A/r²` and says Γ is
> "tabulated per nuclide" — **there is no table.** The corpus's only numerical dose-rate anchor is the
> rule of thumb ≈ **6 R/h per curie at one foot per MeV**. So **this course can compute a dose rate
> and cannot compute a shield thickness**, which is why topics 1 and 3 carry real numbers and every
> number in topic 2 is a ratio.

> **⚠ Lessons 14 and 15 disagree about the roentgen.** §10.1 (lesson 14) calls it "historical,
> air-specific, and superseded"; §11.2's one usable number is quoted in **R/h**. **The course's only
> computable dose rate is expressed in the unit the previous lesson retires.** Flagged inside the
> reference rather than silently converted, but recker should know the two sections disagree in tone
> about the same unit.

> **§11.3's own Flags name the question that decides all of the above:** *"whether Murray tabulates B
> or treats it qualitatively is unverified."* **If Murray does tabulate B and μ, the corpus is missing
> a table rather than the book being silent** — which makes this repairable rather than permanent.
> **Put it near the top of the review list.**

**Two more corpus limits.** §11.2 gives **exactly one biological half-life** — tritium, ~10 days. It
says ⁹⁰Sr "follows calcium to bone and stays" and ¹³¹I "goes to the thyroid" with no T_bio for either,
so a *comparative* effective-half-life example cannot be built from the corpus at all; problem D uses
tritium plus a stated hypothetical. And **tritium's own physical half-life is not in these
sections** — 12.3 y lives in §7.1, which belongs to lesson 26, a *later* lesson — so it is given as
data in the problem statement rather than recalled by the tutor.

**§11.1 is the thinnest of the three and that is fine here**, which is worth stating because it is the
exception to this run's pattern: inverse-square geometry needs no tabulated constant, so a section
that is purely conceptual is genuinely complete. It still has the shape to watch for — competent
prose reading as sufficient — but in this one case the reading is correct.

**The ALARA handoff was scripted rather than merely forbidden.** A cadet reaching for the word is
**the right instinct arriving one lesson early**, not an error, and the tutor is told to say so:
*"right, and that is the principle; today is the technique. So which of the three would you reach for
first?"*

### Lesson 18 — Detection Methods: Gas-Filled Detectors

| | |
|---|---|
| **File** | [`phys310_preflight_detection_methods_gas_filled_detectors.jsx`](phys310_preflight_detection_methods_gas_filled_detectors.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-detection-methods-gas-filled-detectors-edc3bbb5` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/c38f7901-169c-4aaa-8481-b97ea100307e |
| **Component** | `Phys310DetectionMethodsGasFilledDetectorsPreflight` |
| **Built** | 2026-08-05 · 2120 lines |
| **Grounding** | Murray corpus **§12.1** Principles of Gas-Filled Detectors, **§12.2** Ionization Chambers and Proportional Counters, **§12.3** Geiger–Müller Counters — **all three `STATUS: PENDING`** |
| **Cross-check** | DOE NP-04 covers the regions, ion chambers, proportional counters, and GM operation/quenching/dead time — **corroboration available for all three** |
| **Cadets' reading** | Murray & Holbert 12.1–12.3 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 41 passed / 0 failed (37 base + 4 `--forbid`). Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `ionization-signal-voltage-regions` | Ionization as the only signal; how applied voltage sets the operating region |
| 2 | `chamber-vs-proportional` | What gas multiplication buys and what it costs |
| 3 | `geiger-uniform-pulse-saturation` | One pulse size, no energy information, and the saturation hazard |

**Extension problems:** A 2.0 MeV deposited → ion pairs, then the same event in a chamber, a
proportional counter and a G-M tube — deliberately about what happens to the pairs *after* they are
made, so it does not repeat lesson 13's problem (approachable) · B dead time at 100 / 1000 / 5000
counts·s⁻¹ with τ ≈ 100 µs, where the missed fraction turns out to be exactly `n_obs·τ` (standard) ·
C three jobs, three instruments, and what disqualifies the other two each time — no arithmetic, and
the reasoning must run both directions (challenging) · D read the curve backwards: five behaviours →
five regions, plus which region you would never operate in on purpose (standard) · E alpha (5.5 MeV)
against beta (1.0 MeV) pulse-height ratio in a proportional counter, where **the 34 eV and the gain
both cancel** and the ratio is exactly 5.5 — against 1 in a G-M tube (challenging).

**Every problem is framed as *energy deposited in the gas*, not particle energy** — a 1 MeV beta does
not stop in a gas volume, and the corpus gives no range data to say so.

> **⚠⚠ The mechanism of gas multiplication is completely absent.** The corpus names six regions and
> their behaviours and says proportional gain grows with voltage — it **never says what an avalanche
> is, what starts one, or what the tube's geometry has to do with it.** So the single most natural
> cadet question in the lesson — *why does more voltage make more ion pairs?* — has no grounding at
> all. Handled with an explicit `NOT IN THIS REFERENCE, AND YOU MUST NOT ASSERT IT AS FACT` block and
> instructions to reason out loud with a confidence label. **Worth checking whether the gap is in the
> reconstruction or in Murray.**

> **⚠ A voltage-regions lesson with no voltages.** The corpus's own organizing device is an axis
> whose units never once appear — **not even an order of magnitude for where any region sits.** The
> tutor cannot ground a single number on the axis the entire lesson is built around.

> **⚠ Four numbers total across three sections** — 34 eV/ion pair, 10²–10⁴ gain, ~100 µs dead time,
> and the dead-time correction — and the corpus's own Flags hedge three of them as typical-not-
> universal or air-only. That is why the reference sits near the *bottom* of the skill's word target
> and why all five extension problems run on the same three constants. **The sections read
> confidently and say little.**

**The dead-time boundary went to this lesson, and the corpus pointed one way unambiguously.** §12.3
carries dead time in full — ≈100 µs, the undercounting, and `n_true = n_obs/(1 − n_obs·τ)` — while
lesson 6's §3.5 has it only qualitatively and **does not carry the formula at all**. More decisively,
**lesson 6's own artifact hands the mechanism forward**: its scope note says dead time appears there
"only as a behaviour to plan around, never as a mechanism to explain", and its lateral connections
name the mechanism as a later lesson. So the mechanism and the G-M-specific magnitude are probed
here; counting statistics and background subtraction stay lesson 6's. The correction formula exists
only in this grounding, so it is used — but framed as *what fraction does this tube miss at this
rate*, never as correcting a decay curve.

> **This build caught a defect in the schedule I had just written.** Its Grounding column said
> **"no DOE cross-check"** for chapter 12 while all three corpus sections claim DOE covers them.
> **The column had been filled by inference** — the same failure mode that produced this course's one
> published defect, the lesson 2 slug. **The whole column is now quoted from the corpus's own
> `Cross-check` lines instead**, across every lesson, and it now records reduced or absent confidence
> where the corpus records it. Lesson 32 turns out to have **`None` on all six of its sections.**

**Two smaller notes.** All three sections self-flag their boundaries as inferred, and §12.1's Flags
go further — *"Murray may treat the regions in one section rather than three"* — so the three-section
split the reference reproduces may not exist in the printed book; harmless to a cadet, but
`reading_assignment` is the least verified line in the file. And §12.2 asserts the ion chamber has
"no dead-time problem at high rates" one bullet after saying it runs in current mode integrating many
events, **and never connects them** — so a cadet asking *why* gets a first-principles answer with a
confidence label rather than a grounded one.

### Lesson 19 — Detection Methods: Scintillation, Semiconductor, and Dosimetry

| | |
|---|---|
| **File** | [`phys310_preflight_detection_methods_scintillation_semiconductor_and_dosimetry.jsx`](phys310_preflight_detection_methods_scintillation_semiconductor_and_dosimetry.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-detection-methods-scintillation-semiconductor-and-dosimetry-f5e95d35` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/26f8a389-0509-4dc0-9c09-b7a4c7801895 |
| **Component** | `Phys310DetectionMethodsScintillationSemiconductorAndDosimetryPreflight` |
| **Built** | 2026-08-05 · 2206 lines |
| **Grounding** | Murray corpus **§12.4** Scintillation, **§12.5** Semiconductor, **§12.6** Neutron Detection, **§12.8** Personnel Dosimetry — **all four `STATUS: PENDING`**. §12.7 is not assigned and is not in the reference |
| **Cross-check** | DOE covers scintillators/PMTs and BF₃/³He/fission chambers well; **semiconductors more briefly (moderate)**; **low confidence on §12.8** |
| **Cadets' reading** | Murray & Holbert 12.4–12.6, 12.8 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **§12.8 is grounded and deliberately unprobed** |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL, **all five extension-problem figures recomputed** — √(34/3) = 3.3665, 160/2.79 = 57.35, and NaI's two resolution quotes are mutually consistent (6.95 % at 662 keV, 5.26 % at 1330 keV) |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `scintillation-chain-and-spectrum` | Traces the conversion chain and reads a gamma spectrum's structure |
| 2 | `resolution-from-carrier-statistics` | Derives energy resolution from carrier count — **the cross-family comparison** |
| 3 | `neutron-converter-and-discrimination` | Explains why a neutral particle needs a charged-particle converter |

**Extension problems:** A carriers and fluctuations — 2.94×10⁴ ion pairs against 3.33×10⁵ e–h pairs,
0.58 % against 0.17 %, ratio 3.37, **and the gamma energy cancels** because the ratio is √(34/3)
whatever it was (standard) · B 0.662 MeV against 1.33 MeV into the same NaI: which spectrum is richer
and why it is a **threshold** at 1.022 MeV rather than a matter of degree — no arithmetic, by design
(approachable) · C two gammas 20 keV apart, merged by NaI's 70 keV and separated tenfold by HPGe's
2 keV, then what the better answer costs and when you take the worse one (standard) · D rank three
converters by pulse size, then **use the reference against itself** — ³He is the higher-efficiency
choice *and* has the smallest Q, which disproves Q-means-efficiency (challenging) · E a fission
chamber's 160 MeV / 2.79 MeV ≈ 57×, and why that factor is what lets the instrument work in-core
(approachable).

**The handoff from lesson 18 was made real rather than assumed.** Lesson 18 was forbidden to compare
energy resolution across detector families and told to leave it here; that artifact was **read**
before this one was scoped, and its scope note's promise is answered by name. This artifact's scope
note states explicitly that reaching back into the previous lesson's numbers is **not** a scope
violation — otherwise a cautious tutor would decline the lesson's strongest idea.

> **⚠⚠ The corpus's one quantitative argument and its one quantitative comparison disagree by a
> factor of ten, and the corpus does not notice.** §12.5's √10 carrier argument is stated for **gas
> vs. semiconductor**. The only two resolution figures quoted at a common energy are NaI ~70 keV and
> HPGe ~2 keV at 1.33 MeV — a factor of **~35**, roughly ten times what √10 predicts.
>
> **The root cause is a hole: there is no light-yield or carriers-per-MeV figure for any scintillator
> anywhere in the corpus**, so a scintillator's place in the carrier argument cannot be computed at
> all. **It reads as complete because both halves are individually confident.** The artifact carries
> an explicit *A TENSION INSIDE THIS REFERENCE THAT YOU MUST NOT PAPER OVER* block, teaches the
> *form* of the argument, treats the 35× as measured, and instructs the tutor to **confirm** a cadet
> who spots it rather than explain it away.

> **⚠ §12.4 names five spectral features and gives the energy of none of them.** No Compton-edge
> formula, no backscatter position, no escape-peak offsets. **The section that is about reading a
> spectrum cannot put a number on any feature in one.** Guarded in the reference and again inside
> topic 1: if a cadet reasons toward a position, the tutor labels it reasoning, not reading.

> **⚠ The two confidence flags behave in opposite ways, and that is the lesson worth keeping.** The
> **MODERATE** flag on §12.5 **does not show in the content at all** — §12.5 is the most
> quantitatively specific of the four (3 eV, 2 keV at 1.33 MeV, 70 keV, the √10 argument, the LN₂
> cost) and reads as the *most* confident. The **LOW** flag on §12.8 shows, and it is worse than a
> confidence flag — **it is a subject flag**: the corpus states outright that *what §12.8 contains is
> a guess*, inferred from the lesson title, with counting statistics and neutron activation analysis
> named as plausible alternatives, and all its content "standard radiation-protection practice rather
> than recalled Murray text."

**§12.8 is grounded and unprobed, and the deciding factor was that its *subject* is unverified.**
Probing an objective on material the cadets may not have read **is a failure that looks like
success**; grounding it and never raising it unprompted fails safely. §12.6's converter idea is also
the stronger physics — it closes the loop with lesson 18's §12.1 and with topic 1, making *you never
detect the radiation, you detect the charged thing it makes* the lesson's spine, named there as its
third appearance in two lessons. **§12.8 is in the reference in full**, with an ENGAGE-fully lateral
connection so a cadet who did read it gets a real conversation, and a narrower second provenance note
telling the tutor to **believe the cadet over the reference** if they describe the last section
differently. The topic string names Dosimetry, and that mismatch is handled rather than ignored.

**One internal corroboration that holds, and is used.** NaI's two quoted resolutions are mutually
consistent — 7 % of 662 keV ≈ 46 keV, and 70 keV at 1330 keV ≈ 5.3 % — a percentage resolution
improving with energy, which is exactly what more carriers per event should do. Recomputed here:
6.95 % and 5.26 %. It is in the reference as a usable check.

**Course-wide audit run at this point:** 36 objective keys across 12 artifacts, **36 distinct, zero
collisions.**

### Lesson 24 — Fission: Neutron Multiplication

| | |
|---|---|
| **File** | [`phys310_preflight_fission_neutron_multiplication.jsx`](phys310_preflight_fission_neutron_multiplication.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-fission-neutron-multiplication-2a606ef1` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/6747e8d1-1ba9-4dd8-946d-d52fd1c3d48d |
| **Component** | `Phys310FissionNeutronMultiplicationPreflight` |
| **Built** | 2026-08-05 · 2277 lines — **the longest artifact in this course** |
| **Grounding** | Murray corpus **§6.1–§6.5** — **all five `STATUS: PENDING`**. Plus a labelled `CARRIED IN FROM EARLIER LESSONS` block of six items, every one traced to corpus sections earlier lessons already own |
| **Cross-check** | DOE NP-01/02/03 cover the fission process, yield curve, energy breakdown, delayed neutrons and the four/six-factor formulas in depth |
| **Cadets' reading** | Murray & Holbert 6.1–6.5 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **§6.2 and §6.3 grounded in full, not probed** |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `fission-threshold-and-fissile` | Explains fissile vs. fissionable as an energy inequality, not a speed |
| 2 | `neutron-yield-prompt-and-delayed` | Uses ν as a budget; explains why delayed neutrons make a reactor controllable |
| 3 | `multiplication-factor-and-accounting` | Reads k as a generation ratio; knows what critical does and does not mean |

**Extension problems:** A what a thermal neutron actually brings — 0.025 eV against a 6.2 MeV barrier
is 4×10⁻⁹, and U-238's ~1 MeV is 4×10⁷ thermal (approachable arithmetic, challenging idea) ·
B fissions per second and grams per day in a 3000 MW core — 9.3×10¹⁹/s, 3.0 kg/day by the round
figure against 3.14 kg the long way, **and part (d) reconciles the 4.5 % gap as the rounding inside
"1 g ≈ 1 MW·day"** (the true value is 1.045 g) (standard) · C a hundred neutrons and the budget behind
k = 1 — 41.15 fission, 23.85 captured in fuel, then the same numbers rebuild the six-factor formula to
**exactly 1.000** (challenging) · D a reactor with no delayed neutrons — k = 1.001 doubles in 693.5
generations, **0.07 s prompt-only against 69 s with delayed**, with its own caveat that the ratio is
the point (challenging) · E where the 200 MeV goes and what a scrammed reactor still makes — and that
the 7.2 % delayed-but-recoverable **is** the 7 % decay heat, not a coincidence (standard arithmetic,
challenging interpretation).

### The Chapter 6 / Chapter 16 boundary — drawn deliberately, on quoted evidence

The corpus flags twice that content legitimately belongs to both chapters and that the split is
uncertain. The boundary was decided from §16.1's own wording, not by preference:

- *"**k_eff** and the six-factor formula **from §6.5**, now as the working tool"* — attributing the
  introduction to §6.5 and reserving application for §16.1.
- *"Reactivity ρ = (k−1)/k **in its practical units**"* — §6.5 states ρ and names the units in
  passing; §16.1's distinguishing contribution is developing them operationally.
- §16.1's genuinely exclusive content is **subcritical multiplication M = 1/(1−k) and the 1/M plot**,
  which the corpus calls its best probe. **Neither appears anywhere in Chapter 6.**

**So lesson 24 owns k** — the generation ratio, sub/critical/supercritical, what critical does *not*
mean, and the four/six-factor decomposition including leakage as a surface effect. **Lesson 25 owns**
reactivity as an operating variable, subcritical multiplication and 1/M, critical mass/size/geometry,
kinetics and period, reactivity coefficients, and control.

**Two items sit on the line and were handed forward explicitly rather than declined.** `ρ = (k−1)/k`
is in §6.5, so it is grounded here — the tutor may define it in one sentence if a cadet reaches, and
may not build a topic on it. **The dollar scale and "prompt critical" are in §6.4, not §16.1**, and
§6.4's own flag admits uncertainty about which chapter introduces the vocabulary; it is grounded here
as *the consequence of β* and the scale itself is handed forward. The handoff is written in the
header comment, the scope note **and** here, so lesson 25 can take these confidently instead of
declining them.

> **⚠⚠ The energy-partition table does not close, three different ways — confirmed by recomputing it
> here.** The components sum to **207 MeV** (168+5+7+8+7+12); the stated total is **~200**; the stated
> recoverable is **193** while table-minus-antineutrinos is **195**. Each figure is individually a
> standard reference value; together they are inconsistent. **Nothing was silently fixed.** The table
> is grounded verbatim under an explicit *ONE ARITHMETIC TENSION YOU MUST NOT PAPER OVER* note: quote
> round figures as round figures, never adjust an entry, never tell a cadet the book is wrong, and
> **record it as good reading if a cadet spots it.** Extension problem E has the cadet sum the column
> deliberately. **This is the item most worth checking against the printed book.**

> **⚠ The four- and six-factor formulas are grounded as names only** — the corpus gives **no numerical
> value** for η, ε, p, f, P_FNL or P_TNL anywhere. Topic 3 therefore probes *what each factor counts*
> and *which can exceed one*, never a calculation, and the reference tells the tutor outright that it
> has no values and must say so rather than invent one.

> **⚠ One inference in this artifact is the build's, not the corpus's** — that η and ε can exceed 1
> while p, f and the two non-leakage terms cannot. It follows from the corpus's own labels
> ("probability", "utilization") plus its statement that ν > 1 is what makes a chain possible, **but
> it is not written down there**, and it is used as topic 3's stall question. Worth a look during
> review.

**§6.1 does not contain the number its own central argument needs.** Critical-energy-versus-excitation
only lands against the thermal neutron's ~0.025 eV, which lives in §4.2. A labelled
`CARRIED IN FROM EARLIER LESSONS` block holds six such items — 0.025 eV (§4.2), U-235 fission ≈585 b
and U-238 capture ≈2.7 b (§4.6), epithermal resonances (§4.6), elastic-scattering moderation (§4.2),
the B/A curve (§2.7), leakage-surface-vs-volume (§4.7). **Every one traces to this corpus; none came
from model knowledge.**

**§6.2 and §6.3 are grounded in full and unprobed.** They describe what fission *leaves behind*
rather than how it sustains itself, and both have a real downstream home — decay heat and Fukushima
in §21.1/§21.2 (lesson 31, which names decay-heat removal as a safety function), Xe-135 and Sm-149 in
§16.5 (lesson 25). **§6.3 reads like it wants its own lesson**: decay heat, four named nuclides, the
xenon transient and burnable poisons is more material than §6.1 and §6.5 carry combined, inside a
lesson titled *Neutron Multiplication*.

**Three smaller notes.** §6.2's two headline numbers agree only to ~4.5 % — 3.1×10¹⁰ fissions/s/W
through Avogadro gives **1.045 g** per MW·day, not 1 g — so problem B reconciles it rather than
leaving it for a cadet to trip over. **§6.1's own flag says the critical-energy figures should be
checked**, and ~6.2 MeV critical / ~6.5 MeV binding is the pair the priority topic and problem A both
rest on. And **§6.3's open flag is live for lesson 31**, not for this one: *whether decay heat and
xenon sit here or with reactor operations in Ch. 18* — lesson 31 may find this material already spent
or may find it missing.

**Nothing in §6.4 or §6.5 was thin.** Both are among the densest, most confident entries in the
corpus, and §6.4's delayed-neutron paragraph is the best-written passage in it.

> **This build replaced the inherited `tritium has three protons` example, and it was right to.** The
> base artifact's verification-protocol illustration ends *"The reference confirms this."* — **false
> in every artifact whose reference does not carry tritium, which is all of them but the base**, and
> it instructs the tutor to trust a source that does not contain the claim. This lesson substituted an
> example its own reference actually supports. **The other drafts were swept separately** — see
> *Cross-cutting fixes* at the end of this log.

### Lesson 25 — Fission: Criticality

| | |
|---|---|
| **File** | [`phys310_preflight_fission_criticality.jsx`](phys310_preflight_fission_criticality.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-fission-criticality-b2dbd1a4` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/32a402ad-97f3-471a-90e1-6882ea31ebd0 |
| **Component** | `Phys310FissionCriticalityPreflight` |
| **Built** | 2026-08-05 · 2401 lines — **the longest artifact in this course** |
| **Grounding** | Murray corpus **§16.1–§16.5** — **all five `STATUS: PENDING`** |
| **Cross-check** | DOE NP-02/03/04 cover k, reactivity, generation time and prompt criticality in depth |
| **Cadets' reading** | Murray & Holbert 16.1–16.5 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **§16.2 and §16.5 grounded in full, not probed** |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL, and the decades-per-minute coefficient recomputed — 60/ln10 = **26.058**, matching the artifact's 26.06 |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `reactivity-and-subcritical-multiplication` | Uses reactivity as an operating variable; reads 1/M as a prediction |
| 2 | `reactor-period-and-two-timescales` | Separates the prompt jump from the delayed ramp; knows what one dollar is |
| 3 | `reactivity-coefficients-and-feedback` | Explains self-regulation by coefficient sign, not by control rods |

**Extension problems:** A reactivity in four units at k = 1.0020, the distance to prompt critical, and
what k *is* prompt critical — **the whole operating range lives in the fourth decimal place**
(approachable) · B the 1/M plot: four subcritical count rates → normalized inverse → linear
extrapolation to criticality **two rod steps ahead** (challenging) · C period 80 s and 10 s — doubling
time, decades, and *deriving* decades-per-minute = 26.06/T (standard) · D critical size from
B_g² = B_m²: R = πL/√(k∞−1), the R³ scaling, the reflector factor, and the two-container surprise
(challenging) · E shutdown margin with the highest-worth rod stuck out, where at +6000 pcm excess the
criterion **fails outright** — which is why chemical shim exists (challenging).

**There is deliberately no numerical problem on topic 3, and the artifact says why:** the corpus
grounds every coefficient's sign and mechanism and **not one magnitude**, so a tidy pcm-per-degree
would have to be invented.

**The handoff from lesson 24 was taken, not assumed** — that artifact was read before this one was
scoped, and ρ, the dollar scale and prompt critical are treated as new work here exactly as lesson
24's scope note promised.

> **⚠ §16.4 has no magnitudes at all.** Five coefficients named with signs and mechanisms and **not
> one number** — no pcm/°C, no pcm per percent void, no boron worth. **The single thinnest spot in
> this lesson, and it reads confidently enough to look complete.** The reference carries an explicit
> *what you do not have* list.

> **⚠ The Chernobyl attribution gets stronger each time the corpus states it.** §16.3 calls it "the
> boundary Chernobyl crossed"; §16.4 calls the positive void coefficient "the direct cause"; §21.2
> calls it "a design failure, not merely an operating one" and adds the positive scram effect.
> **A build reading only §16.4 would state a single-cause explanation that §21.2 immediately
> complicates.** This artifact is confined to the physics of the sign and signposts the accident
> forward to lesson 31 by name.

> **⚠ One sentence in §16.2 is worth reading word for word against the printed book:** *"there is a
> minimum size below which criticality is impossible at any enrichment."* It survives scrutiny — as
> k∞ rises, B_m² approaches a finite ceiling, so the critical radius has a positive floor — but **a
> small change in wording makes it false**, and it is stated more universally than anything else in
> the section.

**Two smaller findings.** §16.2's bare-sphere geometric buckling is given as (π/R)² **with no
extrapolation distance** — the idealized form, where a real bare-sphere criticality uses the
extrapolated radius; harmless pedagogically, worth a line at review. And **the dollar scale is
grounded in three separate sections** (§6.4, §16.1, §16.3), so ownership had to be decided by hand
rather than read off.

**Doppler broadening still has no confirmed home** — §4.6's Flags ask whether it belongs there or
with reactor kinetics, and it then appears in **both** §4.6 and §16.4. §16.4's version is fuller, so
it is grounded here as feedback with the resonance mechanism carried in.

**§16.2 and §16.5 are grounded in full and unprobed.** §16.2 because the corpus itself calls it the
transport lesson's surface-versus-volume argument "cashed out", and that argument was already probed
in lesson 10; §16.5 because the hardware belongs to lesson 31 and its poisons were grounded in lesson
24. Both keep an extension problem and a lateral connection.

**§16.3 and §16.5 are the two strongest entries of the five**, and §16.5 is unusually concrete for
this corpus — named absorbers, the reason a BWR cannot use chemical shim, and the stuck-rod criterion.

### Lesson 26 — Fusion

| | |
|---|---|
| **File** | [`phys310_preflight_fusion.jsx`](phys310_preflight_fusion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-fusion-6bfea3e2` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/816445d2-f838-460d-98f8-7ef18a48041d |
| **Component** | `Phys310FusionPreflight` |
| **Built** | 2026-08-05 · 2155 lines |
| **Grounding** | Murray corpus **§7.1** Fusion Reactions, **§7.2** Conditions for Fusion and Confinement — **both `STATUS: PENDING`** |
| **Cross-check** | **The weakest in chapters 2–16.** DOE covers fusion "only in passing" for §7.1 and **§7.2 has none at all** — the first section in this run with literally zero corroboration |
| **Cadets' reading** | Murray & Holbert 7.1–7.2 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 44 passed / 0 failed (37 base + 7 `--forbid`). Re-verified independently: 37/37, LF, 0 NUL, **and the four-branch momentum corroboration recomputed here** (below) |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `coulomb-barrier-and-temperature` | Explains why fusion needs a temperature and fission does not |
| 2 | `confinement-and-lawson-product` | Says what confinement confines; reads the density-time trade |
| 3 | `dt-bargain-charged-and-neutral` | Explains the D-T choice and the opposite fates of its two products |

**Charge is the deliberate through-line across all three topics.**

**Extension problems:** A energy per nucleon — 17.6/5 = 3.52 against fission's 0.85, a factor of 4.1 —
then how a fission *event* can be larger while fission *fuel* is weaker (approachable) · B **why
exactly 80 %** — predict the D-T split from momentum conservation alone, then run it on all three
other branches (challenging) · C invert Lawson: τ = 1 s ⇒ n > 10¹⁴ cm⁻³, τ = 1 ns ⇒ n > 10²³ cm⁻³,
**nine orders traded one for one** (standard) · D the tritium loop — balance Li-6 + n → He-4 + H-3 and
show the ledger closes one-for-one and therefore has **zero margin** (challenging) · E what
"~10 keV, i.e. ~10⁸ K" actually claims: derive the implied 10⁻⁴ eV/K and read the tilde honestly
(standard).

### Which kind of flag is a zero cross-check? A third kind — and the content is corroborated from the inside

Earlier builds found a MODERATE flag that showed **not at all** (§12.5) and a LOW flag that was really
a flag about the section's **subject** (§12.8). This is neither. Both fusion Flags blocks are about
**packaging** — *"section boundary between 7.1 and 7.2"*, *"forms and units vary between texts, so
check which form Murray gives"*. **Neither flags a physics claim.** So §7.2's zero corroboration means
DOE cannot tell you how Murray *organised* it, not that the content is unsupported.

**And the content corroborates itself, which was verified here rather than taken on report.** Every
one of the four reaction branches distributes its Q-value in inverse proportion to product mass —
what two-body momentum conservation from rest requires:

| branch | predicted | printed | error |
|---|---|---|---|
| D+T → ⁴He + n | 3.520 / 14.080 | 3.5 / 14.1 | 0.6 % / 0.1 % |
| D+D → ³He + n | 0.818 / 2.453 | 0.82 / 2.45 | 0.3 % / 0.1 % |
| D+D → T + p | 1.008 / 3.022 | 1.01 / 3.02 | 0.3 % / 0.1 % |
| D+³He → ⁴He + p | 3.660 / 14.640 | 3.6 / 14.7 | 1.7 % / 0.4 % |

Three rows agree to the printed digits; the fourth is off by exactly what you get from mass numbers
rather than actual masses. Each branch's products also sum to its own Q. **A confabulation does not
satisfy two-body kinematics four times independently.** There is a cross-chapter check too:
0.85 MeV/nucleon × 236 nucleons = **200.6 MeV**, recovering chapter 6's fission energy. Extension
problem B has the cadet verify the momentum result, so the check now lives in the artifact rather than
only in a report.

> **⚠⚠ The Lawson criterion is given in TWO UNIT SYSTEMS IN ADJACENT CLAUSES, and the corpus does not
> say which one Murray prints.** Classic `nτ > 10¹⁴ s/cm³` (cgs) beside triple product
> `nTτ ~ 10²¹ keV·s/m³` (SI). **Mixing or converting them in front of a cadet produces nonsense that
> reads as fluent.** Mitigated with an explicit *A UNIT WARNING THE CORPUS ITSELF RAISES* block
> forbidding conversion or combination, and problem C stays in one system throughout. **This is the
> single item in this lesson most worth recker's review.**

> **⚠ Two symbol collisions live inside the corpus and neither is flagged there** — the same failure
> shape the corpus *did* catch in Ch. 2 with `N`. **`Q` is the reaction Q-value in MeV (§7.1) and the
> dimensionless fusion gain (§7.2)**, so a cadet saying *"Q is 17.6 so we're far past breakeven"* is
> making a predictable, natural error. And **`n` is the number density in the Lawson criterion and the
> neutron symbol in every reaction equation** — sometimes one line apart. Both are built in as
> misconceptions with diagnostic signals.

> **⚠ Thinness matters more here than anywhere else in the course, because fusion is the one topic a
> cadet will have read about in the news.** The corpus supplies **no cross section in barns** (only
> the bare ratio "~10×"), no required temperature for anything but D-T, no He-3 source, **no statement
> about deuterium supply at all** — seawater deuterium is simply not in §7.1 — no first-wall material,
> no breeding ratio, no Boltzmann constant, no derivation of Lawson, and **no machine, experiment,
> date or achieved gain**: no ITER, no JET, no NIF. **A cadet asking about NIF's 2022 result meets a
> tutor with nothing.** Handled with a `WHAT YOU DO NOT HAVE, AND MUST NOT INVENT` block enumerating
> all of it. Minor companion: *"hotter than the solar core"* is asserted with no solar-core
> temperature given, so *how much hotter?* is unanswerable.

**The Coulomb barrier was checked and taken.** Lesson 8 grounded §4.4 but deliberately did not probe
it, so the barrier arrived here largely unprobed; §7.2 states it as *"the whole problem"*, **stronger
grounding than §4.4 had**, so topic 1 owns it.

**No internal contradictions found.** §7.1's *"the neutron cannot be magnetically confined"* and
§7.2's *"the alpha is charged and is confined"* are consistent, and taken together are the best idea
in the lesson. **A fourth topic was declined rather than squeezed**: stellar fusion (p-p, CNO) and
aneutronic D+³He are grounded and routed to lateral connections.

### Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

| | |
|---|---|
| **File** | [`phys310_preflight_nuclear_reactors_basics_components_types_accidents.jsx`](phys310_preflight_nuclear_reactors_basics_components_types_accidents.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-nuclear-reactors-basics-components-types-accidents-be837c38` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/1d90b211-8b8e-4acc-93fd-c994b0491d37 |
| **Component** | `Phys310NuclearReactorsBasicsComponentsTypesAccidentsPreflight` |
| **Built** | 2026-08-05 · 2295 lines |
| **Grounding** | Murray corpus **§18.1, §18.2, §18.4, §18.5, §21.1, §21.2** — **all six `STATUS: PENDING`**. §18.3 is not assigned and nothing from it is present |
| **Cross-check** | **Half of it does not exist.** §18.1 moderate, §18.2 good, §18.4 reduced, and **§18.5, §21.1, §21.2 have `None`** |
| **Cadets' reading** | Murray & Holbert 18.1–18.2, 18.4–18.5, 21.1–21.2 |
| **Probe topics** | 3 · ~3 active min each · ~10 min — **six sections, the widest overflow in the course** |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL, **and every extension figure recomputed** — Carnot 49.7 % / 74.2 %, 0.05³ = 1.25×10⁻⁴ against a 0.01 common-cause term (80×), decay heat 210 / 30 / 3 MW, boil-off 93 kg/s |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `defense-in-depth-barriers` | Names the four barriers; audits each accident by which one failed |
| 2 | `pwr-bwr-one-choice` | Traces every PWR/BWR difference to boiling or not boiling in-core |
| 3 | `decay-heat-and-common-cause` | Explains why shutdown is not safe, and why redundancy is not enough |

**Extension problems:** A the Carnot ceiling — 330 °C steam against a 30 °C sink gives 49.7 %, a real
plant reaching ⅔ of it, an HTGR at 900 °C giving 74.2 %, and part (d) noting the PWR/BWR pressure
choice barely moves it **because pressure is not in the formula** (standard) · B decay heat after a
clean scram — 3000 MWt → 210 / 30 / 3 MW, boil-off 93 / 13 / 1.3 kg/s (approachable) · C redundancy
against common cause — 0.05³ = 1.25×10⁻⁴ swamped 80× by a 0.01 common-cause term, so **two more
identical diesels buy a 1.2 % improvement** (challenging) · D a barrier audit across all three
accidents, where each of the three safety functions fails **exactly once** (standard) · E cooling with
no power at all, reusing the transport lesson's surface-to-volume argument **with the opposite sign**
(challenging).

### Six Flags blocks read, and not one of them disputes a fact

This lesson was built specifically to answer what a confidence flag means here, after earlier builds
found three different answers. **The result is a fourth kind, plus a new category of unknown:**

| section | flag | what it actually is |
|---|---|---|
| §18.1 | MODERATE | **packaging — plus a known unknown** (below) |
| §18.2 | GOOD | packaging only, and it **affirmatively vouches** for the numbers: *"Pressures and the efficiency figure are standard"* |
| §18.4 | REDUCED | packaging only — *"reduced"* describes **DOE's coverage**, not the content's reliability |
| §18.5 | None | **the SUBJECT kind**, explicitly: a ⚠ header saying *"What §18.5 actually covers is a guess"* with three alternatives offered |
| §21.1 | None | packaging, plus one scope question (whether Murray does PRA quantitatively) |
| §21.2 | None | packaging — **plus the one genuine content caveat in the six** |

> **⚠⚠ Nobody knows what this lesson is missing.** §18.1's Flags say *"the schedule skips 18.3, so
> there is a section here we do not cover and cannot identify"* — and §18.4 flags the same hole
> **independently**. Confirmed by grep. This is not low confidence in what is present; **it is an
> admission that the shape of the gap is unknown.** New in this run, and it belongs near the top of
> the review list.

> **⚠ §21.2 carries the one genuine content caveat found in this lesson, and it is a fourth flag
> kind:** *"Casualty figures are the mainstream consensus and **are contested at the margins**."* Real
> and actionable. The reference turns it into a rule the tutor must obey — **give the figures as
> consensus, never defend a precise number.**

**The chapter-level flag is the clearest statement of the whole run's pattern**, and it is worth
quoting: *"The accident narratives are well-documented history and I am confident in them; Murray's
section split and which accidents he treats at length are inferred."* **Confidence in content,
explicitly separated from confidence in packaging.**

**The missing cross-check is partly supplied from inside, and the interlock is not weak.** §21.1 names
exactly **three** safety functions; §21.2 gives exactly **three** accidents; **each accident fails a
different one, with no leftovers and no double-counting** — and §18.1's four-barrier list, written in
a *different chapter*, is precisely the frame those three narratives each audit against. **Two
independently written lists interlocking with no remainder is not something a reconstruction produces
by accident** — the same shape as fusion's four momentum-conserving branches.

> **⚠ There is no numerical safety value anywhere in these six sections** — no core damage frequency,
> no failure probability, no plant rating, no dose. **The mechanisms are grounded; nearly all the
> magnitudes are not**, and the artifact says so in three places. §18.5 is the weakest block in the
> set: four bullets of taxonomy, no mechanism, one number (300 MWe) — and it is the one whose subject
> is admitted to be a guess. Grounded, not probed.

**The decay-heat question lesson 24 left open is now settled: the answer is yes.** §21.1 lists
*remove decay heat* as one of the three safety functions, §21.2 makes losing it the mechanism of
Fukushima, and §18.5 names passive decay-heat removal. So it is this lesson's **as a safety function**
and it is probed. **Its magnitudes are not** — the 7 / 1 / 0.1 % figures live in §6.3, outside these
six sections, so they sit in `prerequisites` as Tier-2 earlier coursework with an explicit instruction
not to attribute them to today's material. **Flagged**: that is the honest reading of *excerpt, do not
extend*, but it means the tutor's most quotable number about decay heat is formally prior coursework.

**Six sections into three topics — grounded and unprobed:** the reactor-type zoo (CANDU, Magnox/AGR,
HTGR/TRISO, RBMK, LMFBR); the advanced-reactor and SMR programme; thermal efficiency and the Carnot
ceiling; PRA and INES. Each is named in the scope note with a stated reason and reachable through a
lateral connection or an extension problem.

> **If recker wants a split, it falls at the chapter boundary** — §18.x as reactor systems, §21.x as
> safety and accidents — **with the four-barrier list restated in both halves**, since it is the one
> item both chapters need. That split would let the reactor-type zoo become a topic in its own right,
> which is the largest thing currently grounded and unprobed.

**Accident handling.** No individual is named or invented anywhere — no operator, no victim, no
illustrative person. The material is treated as engineering and physics; the tutor takes no position
for or against nuclear power and is told not to. **Effort is the grade**: a cadet wrong about an
accident is corrected on the fact and penalized for nothing. **Lesson 25's Chernobyl handoff is taken
by name**, with the void coefficient's sign repaired in a sentence rather than rebuilt.

**No PWR or BWR core temperature was supplied, and the tutor is told not to** — the corpus gives none,
and the misconception most worth attacking (pressure versus temperature) is exactly where inventing
one would be tempting.

### Lesson 32 — Fuel Cycle: Isotope Separation, Waste

| | |
|---|---|
| **File** | [`phys310_preflight_fuel_cycle_isotope_separation_waste.jsx`](phys310_preflight_fuel_cycle_isotope_separation_waste.jsx) |
| **Registration slug** (`#i=` / `id=`) | `phys310-fuel-cycle-isotope-separation-waste-9277e5a0` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/c2f853e9-b4a4-4811-b130-6f0fec6345ad |
| **Component** | `Phys310FuelCycleIsotopeSeparationWastePreflight` |
| **Built** | 2026-08-05 · 2386 lines |
| **Grounding** | Murray corpus **§15.1–§15.4, §23.1, §23.5** — **all six `STATUS: PENDING`**. §23.2–23.4 are not assigned and nothing from them is present |
| **Cross-check** | **`None` on all six. The weakest-grounded lesson in the course, and it is not close** — no other lesson has zero corroboration on every section |
| **Cadets' reading** | Murray & Holbert 15.1–15.4, 23.1, 23.5 |
| **Probe topics** | 3 · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 37/37. Re-verified independently: 37/37, LF, 0 NUL, **and the whole internal-corroboration chain recomputed** (below) |
| **Status** | **DRAFT** — not reviewed, not published, not registered |

| # | key | label |
|---|---|---|
| 1 | `mass-difference-and-cascade` | Traces chemical identity to a 0.85 % mass gap to a 1 400-stage cascade |
| 2 | `centrifuge-and-the-same-cascade` | Explains difference-vs-ratio, and why one cascade serves both ends |
| 3 | `waste-volume-hazard-timescale` | Inverts volume against hazard; separates the two waste timescales |

**Extension problems:** A confirm 349/352 from ¹⁹F, compute √(352/349), show the 0.43 % gain is
**half** the 0.85 % mass gap, then the hypothetical second fluorine isotope that would scramble the
signal (challenging) · B one centrifuge stage replacing ~22–61 diffusion stages, so 1 400 → 23–63 —
**reproducing "tens vs thousands" from two statements made in different sections** (challenging) ·
C feed-to-product mass balance: 11.2 kg ore per kg product at 0.30 % tails against 9.2 at 0.20 %,
~18 % less ore — **and the SWU cost side cannot be computed** (standard) · D 300 y is ten half-lives
of the 30-y fission products, 0.1 % left at 300 y and 1 ppm at 600 y, **so the 300 is the 30 in
disguise** (approachable) · E spent fuel's ~1 % beating ore's 0.72 %, and the four percentages summing
to 100 **or 101** depending which end you take (standard).

### THE STRONGEST INTERNAL CORROBORATION IN THE RUN — recomputed here, not taken on report

Zero external cross-check, and yet the numbers cohere in ways a confabulation does not produce:

| check | result |
|---|---|
| ¹⁹F monoisotopic → 6 × 19 = **114**; 235 + 114 = **349**; 238 + 114 = **352** | three separately stated facts, one sum |
| **√(352/349) = 1.004289** | the printed 1.0043 is right to five figures |
| its **0.4289 %** against half the **0.8523 %** mass difference stated in a *different section* — 0.4261 % | agrees to two decimals, exactly as √(1+x) ≈ 1 + x/2 requires |
| 300 y / 30 y = **ten half-lives** → 0.098 % left; 600 y → **9.5×10⁻⁷** | matches the printed "0.1 %" and "1 ppm" |
| feed per kg product at 0.30 % / 0.20 % tails | **11.2 and 9.2** — exact |

**And the stage counts reproduce from parameters the corpus never combines.** Feeding the standard
ideal-cascade relation *nothing but numbers these sections state* returns ~1 400 stages against the
printed *"on the order of 1 400"*, several thousand for weapons-grade against *"several thousand"*,
and 23–64 for the centrifuge's printed 1.1–1.3 against *"tens of stages."* **Three stage-count claims,
derived from five separately stated parameters, through a relation the corpus never writes down.**
Chapters 15 and 23 also cohere on the uranium: §23.1's ~1 % U-235 in spent fuel sits above §15.1's
0.72 % natural, **which is the premise of §23.1's own reprocessing argument.**

### A fifth kind of flag, and a clean answer on the other four

**All six flag the section boundary or number — kind (3), packaging** — and the chapter-level flag
says it in words: *"The physics is standard and solid; Murray's section organization and choice of
examples are genuinely uncertain."* Beyond packaging there are exactly four content caveats, all
about **precision or currency rather than correctness**. **No section here is the subject kind** —
nothing flags its own subject as a guess, unlike §18.5.

> **A fifth kind, new to the run: a flag that RAISES confidence.** §15.1's *"Enrichment thresholds
> are regulatory definitions, not Murray-specific"* says the numbers are **externally fixed and
> independently checkable**, and merely disclaims attribution. Worth adding to the taxonomy: not
> every flag is a warning.

> **⚠ The one real defect: §15.2's "0.43 % enrichment per stage" reads additively** — and read that
> way it contradicts the same section's 1 400 stages **by a factor of ~140** (0.72 + N × 0.43 reaches
> 5 % in ten stages). The two cohere only multiplicatively. **The corpus was not fixed**; this is the
> artifact's flagship misconception, topic 1's ladder is built to surface it, and the reference warns
> the tutor explicitly.

> **⚠ SWU is the biggest hole, and the answer to the question this build was asked is negative.** The
> corpus names the unit and says what it measures, and gives **no value function, no formula, no
> figure, no worked example** — so there is nothing there to corroborate. **A negative result,
> reported as one rather than dressed up.** Also absent: separation factors or energy figures for the
> aerodynamic and laser methods, any activity in Ci/Bq, waste volumes, repository depth beyond
> "several hundred metres", canister lifetime, and **a half-life for any actinide anywhere in the six
> sections.**

**One minor internal tension**, turned into extension E rather than hidden: §23.1's composition sums
to **100 at the low end of its own 3–4 % band and 101 at the high end** — covered by the corpus's own
burnup flag. Related looseness: §23.1 lists plutonium separately from "minor actinides" while §23.5
attributes the long timescale to "the minor actinides"; **the reference does not settle whether Pu is
in or out**, and the tutor is told not to draw a line it cannot support.

**The ideal-cascade relation that verified three of the corpus's numbers was deliberately kept OUT of
the artifact.** It is not in the corpus, so it is not grounding — and the tutor is told plainly that
no cascade equation exists in its reference and that it must reason aloud rather than produce one.

**Proliferation handling: physics and policy-neutral.** The point made is that the *same* cascade
serves both ends, which is why capability rather than product is safeguarded. **No weapons-design
content of any kind** — there is none in the corpus and none was added.

---

## Queue — the current run (opened 2026-08-05)

**Sixteen lessons, built one at a time.** Each build reads the canonical skill, excerpts its lesson's
sections from `texts/MURRAY-GROUNDING.md` into `TEXTBOOK_REFERENCE`, applies this course's profile
(3 probe topics at ~3 active min, no lesson number in any identifier), mints a fresh 8-hex slug per
contract §3.2, and must pass `check_artifact.py` before it is recorded here.

| Lsn | Topic | Murray sections | corpus status at build |
|---:|---|---|---|
| 3 | Binding Energy and Stability | 2.7, 3.1 | 2 pending |
| 4 | Radioactivity | 3.2, 3.3, 3.4 | 3 pending |
| 6 | Lab 1 | 3.5 | 1 pending |
| 8 | Nuclear Reactions | 4.1, 4.2, 4.3, 4.4 | 4 pending |
| 9 | Cross Sections | 4.5, 4.6 | 2 pending |
| 10 | Neutron Transport | 4.7 | 1 pending |
| 13 | Radiation Interactions with Materials | 5.1–5.5 | 5 pending |
| 14 | Bioeffects and Safety | 5.6, 10.1, 10.2, 10.4 | 4 pending |
| 15 | Dose and Shielding | 11.1, 11.2, 11.3 | 3 pending |
| 18 | Detection Methods: Gas-Filled Detectors | 12.1, 12.2, 12.3 | 3 pending |
| 19 | Detection Methods: Scintillation, Semiconductor, and Dosimetry | 12.4, 12.5, 12.6, 12.8 | 4 pending |
| 24 | Fission: Neutron Multiplication | 6.1–6.5 | 5 pending |
| 25 | Fission: Criticality | 16.1–16.5 | 5 pending |
| 26 | Fusion | 7.1, 7.2 | 2 pending |
| 31 | Nuclear Reactors: Basics, Components, Types, Accidents | 18.1, 18.2, 18.4, 18.5, 21.1, 21.2 | 6 pending |
| 32 | Fuel Cycle: Isotope Separation, Waste | 15.1–15.4, 23.1, 23.5 | 6 pending |

**Reconstruction confidence is not flat across this list**, and the corpus says so itself. Chapters
2–7 are formula-dense core nuclear physics and reconstruct strongly. Chapters 10–12 are solid on the
physics, less certain on Murray's organization. **Chapters 15, 18, 21 and 23 are the weakest** —
applied, descriptive material where the book's particular framing matters and DOE-HDBK-1019 offers
**no cross-check at all**. That is lessons **31 and 32**.

> **The queue closed the same day it opened. All sixteen are built** — see the entries above.

---

## What a confidence flag turned out to mean — five kinds, found the hard way

The corpus attaches a `Cross-check` line and a `Flags` block to every section. **This run set out to
build sixteen lessons and ended up learning to read those flags**, because they behave in five
distinct ways and nothing in the flag itself tells you which you are holding.

| kind | example | what it means |
|---|---|---|
| **1 — invisible** | §12.5, *moderate* | **Does not show in the content at all.** §12.5 is the most quantitatively specific section in its chapter and reads as the *most* confident |
| **2 — subject** | §12.8 and §18.5, *low* / *none* | **Not about confidence: the corpus says what the section CONTAINS is a guess**, and offers alternative subjects. Both were grounded in full and probed not at all — probing material cadets may not have read is a failure that looks like success |
| **3 — packaging** | all of §§7.1–7.2, 15.x, 18.x, 21.x | **Section boundaries and notation, never a physics claim.** *"The physics is standard and solid; Murray's section organization and choice of examples are genuinely uncertain"* |
| **4 — genuine content caveat** | §21.2 | *"Casualty figures are the mainstream consensus and **are contested at the margins**."* Real, actionable, and turned into a rule the tutor obeys |
| **5 — raises confidence** | §15.1 | *"Enrichment thresholds are regulatory definitions, not Murray-specific."* **Says the numbers are externally fixed and independently checkable**, and merely disclaims attribution. **Not every flag is a warning** |

**And a zero cross-check is not the same as unsupported.** Twice in this run a section with *no* DOE
corroboration turned out to be arithmetically self-consistent in a way a reconstruction does not
achieve by accident, and each was **recomputed here rather than taken on a build's word**:

- **Fusion (§7.1):** all four reaction branches distribute their Q-value in inverse proportion to
  product mass — two-body momentum conservation — three matching the printed digits and the fourth
  off by exactly what mass numbers rather than actual masses give.
- **Fuel cycle (§15.x, §23.x), the strongest in the run:** ¹⁹F monoisotopic → 349/352; √(352/349) =
  1.004289 against a printed 1.0043; **its 0.4289 % is half the 0.8523 % mass gap stated in a
  different section**; 300 y is exactly ten half-lives of the 30 y nuclides; the feed ratios come out
  11.2 and 9.2 exactly. **Three stage-count claims reproduce from five separately-stated parameters
  through a relation the corpus never writes down.**
- **Reactor safety (§18.1, §21.1, §21.2):** three safety functions, three accidents, **each failing a
  different one with no leftovers**, audited against a four-barrier list written in another chapter.

**A negative result was reported as one, too.** Lesson 32 was asked to look for corroboration in
separative work and found none available — the corpus names SWU and gives no value function, formula,
figure or example. That is recorded as a negative rather than dressed up.

---

## Cross-cutting fixes applied to the artifacts above

**One false assertion was inherited from the structural base and has been corrected in the nine
drafts where it was actually false.** The base's VERIFICATION PROTOCOL illustrates *never confirm a
wrong physics claim to be agreeable* with a cadet claiming tritium has three protons, and closes the
reasoning with **"The reference confirms this."**

**In the base that is true** — §2.5 covers tritium by name. In an artifact whose reference has no
tritium in it, the sentence **instructs the tutor to trust a source that does not contain the
claim.**

**Who was affected was established by audit, not assumption** — and the assumption would have been
wrong in both directions:

| | count | action |
|---|---|---|
| the **published base** — tritium is in its reference | 1 | **untouched** |
| drafts that **adapted the example to their own lesson** (β⁻ and Z, U-238 capture, thermal-neutron energy, subcritical multiplication) | 4 | **untouched** — a lesson-appropriate example is strictly better than a generic one |
| drafts that kept the example and **do** carry tritium in their reference | 3 | **untouched** — the claim is true there |
| drafts that kept the example with **no tritium anywhere in their reference** | **9** | **fixed** |

The fix is minimal and true everywhere: the reasoning given is **definitional** — tritium is
hydrogen, so Z = 1 by definition of the element — and needs no reference at all. Nothing else in the
illustration changed; the diffs are two lines each, and **all seventeen artifacts re-checked at
37/37 afterwards**.

**The `"section 2.6 says"` illustration string is left deliberately inconsistent** — lesson 8 changed
its copy to `4.2`, the rest keep the base's. It is an example of what *not* to do rather than
content, and matching the published, parsed base is worth more than cosmetic alignment across drafts.
Recorded so it stays visible rather than becoming folklore.

---

## Before a cadet is pointed at any of these

1. **The review is still owed.** Fifty-six corpus sections are `STATUS: PENDING` and every artifact
   above rests on them. The lift was permission to build, not an attestation. **Start with §3.5** —
   the corpus calls it its own weakest entry and it may not be a real Murray section — then §18.5 and
   §12.8, whose *subjects* are admitted guesses, then §15.2's additive/multiplicative defect and
   §6.2's energy table that does not close.
2. **Nothing here is published.** Publishing is the only JSX parser this project has, and
   `check_artifact.py` is explicitly not a syntax check however green it is.
3. **Nothing in this course is registered**, and `course_id: phys-310` has never been confirmed to
   exist on the receiver at all. A wrong endpoint or unknown course id fails **silently**.
4. **Lesson 2's slug does not match the schedule** — see the callout near the top.
