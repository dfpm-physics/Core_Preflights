# PHYS 310 — lab source documents

The write-up a cadet is issued and the analysis workbook they are told to open, one folder per lab.
**These are build inputs, not grounding prose.** The corpus at [`../texts/`](../texts/) is a
*reconstruction* of Murray gated by review; everything here is a primary source that came from the
course director, so where the two disagree, **these win**.

| lab | folder | lesson | built |
|---|---|---:|---|
| Lab 1 — Measurement of Half-Life | [`lab-1/`](lab-1/) | 6 | yes — rebuilt 2026-08-19 against these files |
| Lab 2 — Distance and Shielding | [`lab-2/`](lab-2/) | 16 | yes — built 2026-09-22 against these files |
| Lab 3 — Radiation Detectors and Gamma Spectra | [`lab-3/`](lab-3/) | 21 | yes — built 2026-10-02 against these files |

**All three labs are now built.** Lab 3 was listed as *blocked: no write-up, no reading* here and in
[`../artifacts/BUILD-LOG.md`](../artifacts/BUILD-LOG.md) until its write-up arrived on 2026-10-02;
dropping the document in is what unblocked it. The lesson number moved too — Lab 3 was 20 in the
workbook and is taught as **21**, because the detector lessons are being taught out of order.

All three confirm the same thing: **the lab document is a better preflight source than a textbook
section**, because it is what the cadet will actually be holding, and because it is a primary source
rather than a reconstruction.

---

## Lab 1

| file | what it is |
|---|---|
| `Lab1_Alt.pdf` | the graded write-up, 6 pages, 35 points. Added to the repo 2026-08-19 |
| `Phys310 - Lab 1 - Analysis (2024).xlsx` | the analysis workbook the write-up's §III tells cadets to open |

**Filenames are kept exactly as issued.** `Alt` is the course's marker, not ours, and a rename would
cut the only link back to the file recker handed over.

### What the lab actually does

Cs-137 decays to an excited state ¹³⁷Ba\* (t½ = 2.552 min), which the cadet separates chemically and
counts on a Geiger-Mueller tube at 860 V. **Nine counts of 30 s each, started one minute apart** —
so the counting duty cycle is half, and the nine start times are t = 0…8 min. Then a **3–5 minute
background run** with the source away. The half-life is then extracted **three separate ways**, and
comparing the three *is* the lab:

1. **Initial estimate** — two points, by hand, at the bench, with the uncertainty found by bounding
   (σ = √N on each raw count, then the largest and smallest half-lives the range allows).
2. **Manual fit** — adjust t½ and its error in the workbook until reduced chi-square approaches 1
   and the ±1σ band contains about two-thirds of the points.
3. **Automatic fit** — Excel's trendline on the semi-log plot; slope and intercept typed back in.

Seven discussion questions close it out, worth 16 of the 35 points.

### What the workbook computes — read this before grounding anything in it

Sheet **Main**; the other three are the instructions tab and two chartsheets.

| cell(s) | holds |
|---|---|
| `B9` | counting interval in minutes, shipped as `0.5` |
| `A13:A21` | the nine **start times**, 0–8 min (not midpoints) |
| `B13:B21` | raw counts — the only cadet-entered source data |
| `H7` / `H8` / `H9` | background total counts / counting time / `=H7/H8`, the background **rate** |
| `C13:C21` | net activity `=B/$B$9-$H$9` — counts to a rate, then background subtracted |
| `D13:D21` | uncertainty `=SQRT(B)/$B$9+SQRT($H$7)/$H$8` |
| `C24` | initial activity, `=C13` — **the first data point, not a fitted parameter** |
| `C25` / `C26` | half-life and its error — the two cells the manual fit adjusts |
| `E13:E21` | fitted `=$C$24*EXP(-LN(2)*A13/$C$25)` |
| `V4:V12` / `V15` / `V17` | chi-square terms `((C-E)/D)^2`, their sum, and dof `= N-2` |
| `C27` | goodness of fit `=V15/V17` — **reduced** chi-square, "closer to 1 is better" |
| `R`/`S` | the ±1σ envelope, from `C25±C26` |
| `B51` / `B52` / `B53` | slope, intercept, R² — typed in by hand off the Excel trendline |
| `C57` / `C58` | `=-B51` → λ, and `=-LN(2)/B51` → t½ |
| `D55` / `E58` | slope uncertainty `=SQRT((1-B53)/(N-2))`, propagated to t½ by `LN(2)/λ²·σ_λ` |
| `Z:AC` | a 10-second time grid so the fitted curves plot smooth. Marked do-not-touch |

**Three things in that table are load-bearing and easy to get wrong:**

**1. The uncertainty is a LINEAR SUM, not quadrature.** `D13` adds the source-rate and
background-rate uncertainties directly: `√N_src/Δt + √N_bkg/t_bkg`. The write-up agrees in spirit —
step 7 propagates by **bounding** the half-life, not by combining errors in quadrature. **Nothing in
this lab uses quadrature**, and an artifact that teaches it as "how you combine the two" contradicts
the sheet the cadet is looking at. *(The 2026-08-05 build did exactly that; see the BUILD-LOG.)*

**2. `C24` is the first data point.** The manual fit is anchored, not floated — only t½ moves. The
regression fit in Block 4 *does* float its intercept (`D52 = EXP(B52)`), which is one real reason the
manual and automatic half-lives differ, and discussion question 1 asks the cadet to account for the
spread.

**3. The background is counted longer on purpose** — the instructions tab says so outright, and
`H9`'s uncertainty falls as `1/√(total background counts)`. This is the lab's one live instance of
"buy precision with time", and discussion question 7 is where the cadet has to say it.

### Where it disagrees with the corpus

The corpus entry for **§3.5** ([`../texts/MURRAY-GROUNDING.md`](../texts/MURRAY-GROUNDING.md))
flags *itself* as the weakest in chapters 2–5, because its existence was inferred from this lesson
being a lab. Against the real write-up, that entry is **thematically close and specifically wrong**:
it leads with dead time and the long-half-life ratio method (`λ = A/N`), **neither of which appears
anywhere in this lab**, and it omits chi-square, error bars, linear regression and R², which are most
of what the cadet is graded on. Its σ = √N and background-subtraction bullets are right and are the
half worth keeping.

**Do not resolve that by editing the corpus.** §3.5 is still `STATUS: PENDING` and only recker can
review it against the printed book. What changed is that Lab 1 no longer *needs* it.

---

## Lab 2

| file | what it is |
|---|---|
| `Lab2_Alt.pdf` | the graded write-up, 35 points. Added to the repo 2026-09-22 |
| `Physics 310 - Lab 2 - Analysis (2024).xlsx` | the analysis workbook the write-up's §I.E and §II.E tell cadets to fill in |

**Filenames are kept exactly as issued**, for the reason Lab 1's section gives. `Lab2_Alt.pdf` is
built from `Lab2_Alt.tex` in the instructor-slides tree; the LaTeX source was read directly rather
than extracting text from the PDF, so every equation is exact rather than reconstructed.

### What the lab actually does

**Two independent experiments on one Cs-137 source**, and the write-up says in its opening paragraph
that this source is different from Lab 1's: it holds **both** the Cs-137 *and* the Ba-137m it decays
into. Reasoning from that (the write-up does not spell it out): the 30-year parent keeps replacing
the 2.552-minute daughter, so **the gamma output is steady for the whole period** — which is what
lets counts taken minutes apart be compared with no decay correction. In Lab 1 the fall-off *was* the
measurement; here it would be a contaminant.

Both parts use a GM tube at 860 V, **30-second counts**, and one **2-minute background** count.

**Part 1 — Shielding.** Source on the tray at 5 cm (fifth slot), then four different thicknesses of
lead in the slot directly below the detector. Five discussion questions, 16 points.

**Part 2 — Distance.** Tube flat beside a metre stick, source facing it, four distances between 10
and 100 cm. Three discussion questions, 10 points.

### What the workbook computes — read this before grounding anything in it

Sheet **Main**; the other sheet is the instructions tab, plus four chartsheets.

| cell(s) | holds |
|---|---|
| `C4` | detector window area `=PI()*(3/2)^2` = 7.07 cm² |
| `C5` | detector efficiency, shipped as `0.1` and marked *(estimated)* |
| `C7` / `C8` | shield density (ships 11.34 g/cm³) and mass attenuation coefficient — **typed in by the cadet from their equation sheet** |
| `C9` | Part 1 distance, expected 5 cm |
| `C13`/`D13`/`E13` | background counts / time / rate |
| `B17:B20` | **ρx, the density thickness in g/cm², off the box the lead blocks are kept in** |
| `F17:F20` | net rate `= raw rate − background rate` |
| `G17:G20` | flux `= net rate / window area`; `I` is its natural log |
| `H17:H20` | uncertainty `=SQRT(counts + bkg_counts×(Δt/t_bkg))/Δt` |
| `H34`/`H35` | semi-log slope and R², **typed in off the Excel trendline** |
| `H36` | slope uncertainty `=|slope|·SQRT((1/R⁴−1)/(N−2))` |
| `B43:B46` etc. | Part 2 distances, with `ln(r)` and `ln(flux)` for the log-log plot |

**Three things in that table are load-bearing and easy to get wrong:**

**1. The x-axis is ρx, not x.** Because `μx = (μ/ρ)(ρx)`, the semi-log slope is **the MASS
attenuation coefficient directly** — the tabulated quantity, with no division by density. An
artifact that teaches "the slope is μ" sends the cadet to compare the wrong number against their
table.

**2. The uncertainty is ONE square root over both count totals**, with the background scaled to the
source's counting time — *not* Lab 1's linear sum of two separate roots. The two labs' sheets
genuinely differ here. Teach the sheet the cadet is looking at.

**3. `H36` squares an R² that is already squared.** The cell computes `SQRT((1/H35^2 − 1)/(N−2))`
with `H35` holding R², so it is effectively `1/R⁴`. Noted, not corrected — this file describes the
workbook as issued, and changing a cadet's sheet is the course director's call, not ours.

### Where it meets the corpus

Nowhere directly, and it does not need to. Lab 2 has **no assigned reading** and the corpus has no
section for it. What the corpus supplies is all *carried forward*: §5.2 for charged-particle range
(why the tube sees gammas and not betas), §5.3 for attenuation and why lead, and §11.1/§11.3 for
time-distance-shielding and the half-value layer. None of it is re-probed.

**The one number the course cannot supply is the one the lab asks for.** Part 1 discussion question 2
tells the cadet to look up the accepted μ/ρ for their shielding material. No lesson in this course
provides one (see the Lesson 15 entry in [`../artifacts/BUILD-LOG.md`](../artifacts/BUILD-LOG.md)),
and here that is correct rather than a gap: finding it is the graded task.

---

## Lab 3

| file | what it is |
|---|---|
| `Lab3_Alt.pdf` | the graded write-up, 35 points. Added to the repo 2026-10-02 |
| `Lab3_Alt.tex` | **the LaTeX source of that PDF, kept here on purpose** |

**Filenames are kept exactly as issued**, for the reason Lab 1's section gives.

**The `.tex` is in this folder and the other two labs' is not, and that is deliberate.** Both earlier
labs were grounded by reading the LaTeX rather than extracting text from the PDF — because an
OpenStax-style text layer drops equations silently (PROJECT.md's sharp-edge table) — but neither
kept the source, so nobody can check that reading afterwards. Lab 3's two equations are the whole of
its arithmetic, so the source is here and the claim is verifiable.

**There is NO analysis workbook for Lab 3**, unlike Labs 1 and 2. Every number is computed by hand
from one equation. That is why the arithmetic in this lab carries more weight than in a lab where a
spreadsheet does it, and it is why the preflight's first probe topic is the calibration.

### What the lab actually does

**Two detectors, two different jobs, and that split *is* the lab.** First a **pancake probe** (a
Geiger-Müller detector) to survey the closed containers around the classroom and *find* a source —
at least four dose-rate readings, whether or not the source turns up sooner — then the instructor
opens the box. Then a **FLIR Identifinder** (a NaI(Tl) scintillation detector, read out through a
spectrum web app on the local network) to *identify* it, and then five unknown spectra to identify
from their signatures.

The pancake probe cannot tell you what the source is, and the Identifinder is not what you want to
walk a room with. A cadet who can say why is ready for this lab.

**Points:** calibration 6 · survey 3 · five spectra 10 · four discussion questions 5 + 5 + 3 + 3 = 35.

### The two equations — read this before grounding anything in it

**1. Channel-to-energy calibration**, exactly as the write-up prints it:

```
Energy = (E_1 - E_2) / (C_1 - C_2) * channel
```

**What is missing from that is load-bearing: there is no intercept.** The line is forced *through the
origin*, which is legitimate only because the lab's own calibration table supplies `0 keV` at
`channel 0` as one of its two points. With that anchor the whole calibration collapses to one ratio,
`662 / 220 = 3.009 keV per channel`. An artifact that quietly adds an intercept is teaching something
other than what the cadet is graded against; one that calls the equation wrong is worse.

**2. The Compton edge**, given in discussion question 2:

```
E_compton = 2 E^2 / (m_e c^2 + 2 E)        m_e c^2 = 511 keV
```

**The lab asks for the Compton edge twice, by two different routes, and never says that is the
point.** Step 1 gets it from channel 160 through the calibration line (≈ 481 keV); discussion
question 2 gets it from the gamma energy through physics (≈ 478 keV for 662 keV). **Those two
answers agreeing is a check on the calibration itself.** It is the best thing in the lab and it is
unmarked.

### The Cs-137 fingerprint, as the write-up tabulates it

| feature | energy |
|---|---|
| gamma decay peak | 662 keV (channel 220) |
| Compton edge | *not given — the cadet computes it* (channel 160) |
| backscatter | 184 keV |
| X-ray peak | 32 keV |

**The write-up tabulates the backscatter and X-ray peaks and explains neither.** The preflight may
say where they sit; it may not explain where they come from as though it read it somewhere.

### The one thing the course cannot supply

**The isotope equation sheet.** The 10-point task is identifying five unknown spectra against a
sheet of signatures that is not in this repository, for candidates Na-24, K-40, Co-60, Mo-99, I-131,
Xe-135, Cs-137 and Am-241. Nothing here carries gamma energies for those, and the preflight is
instructed never to invent one — a fabricated fingerprint would send a cadet into a graded task
wrong. **The single exception is Co-60, and only because the lab reveals it**: discussion question 1
gives two peaks at channels 390 and 442, which calibrate to ≈ 1174 keV and ≈ 1330 keV.

### Where it meets the corpus

Nowhere directly, and it does not need to. Lab 3 has **no assigned reading** and the corpus has no
section for it. What the course supplies is all carried forward from the two detector lessons either
side of it — §12.1–12.3 for the gas-filled family and the Geiger-Müller tube's uniform pulse,
§12.4–12.5 for the scintillation chain and solid-state resolution. **This lab is their practical
exercise**, and the first time a GM tube is the *wrong* instrument for part of the task.
