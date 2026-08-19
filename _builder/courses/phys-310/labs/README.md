# PHYS 310 — lab source documents

The write-up a cadet is issued and the analysis workbook they are told to open, one folder per lab.
**These are build inputs, not grounding prose.** The corpus at [`../texts/`](../texts/) is a
*reconstruction* of Murray gated by review; everything here is a primary source that came from the
course director, so where the two disagree, **these win**.

| lab | folder | lesson | built |
|---|---|---:|---|
| Lab 1 — Measurement of Half-Life | [`lab-1/`](lab-1/) | 6 | yes — rebuilt 2026-08-19 against these files |
| Lab 2 | — | 16 | blocked: no write-up, no reading |
| Lab 3 | — | 20 | blocked: no write-up, no reading |

Lab 2 and Lab 3 are `PF = Y` in the schedule and carry **no** assigned reading, which is why
[`../artifacts/BUILD-LOG.md`](../artifacts/BUILD-LOG.md) lists them as blocked rather than skipped.
Dropping their write-ups here is what unblocks them, and Lab 1 is now the worked precedent for how:
**the lab document is a better preflight source than a textbook section**, because it is what the
cadet will actually be holding.

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
