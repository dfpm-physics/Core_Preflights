# Changelog

Newest first. One entry per shipped feature, fix, schema or data change, or material doc edit.

**Format:** `## YYYY-MM-DD — <Human> via <Agent>`

State **what** changed and **why**. State what you deliberately did *not* do — a run that silently
does less than asked is worse than one that refuses. Never put a credential, a connection string, or
personal data in this file.

See `.ai/instructions/CORE.md` §5 for the full conventions.

---

## 2026-08-06 — recker via Claude Code (one review site: both courses, artifacts and grounding)

recker asked to **view the PHYS 310 artifacts and approve their objectives in the review page, and
the grounding material too**. All three of those already existed and none of them were in the same
place: `serve_artifact_review.py` defaulted to `--course phys-215` so PHYS 310's seventeen artifacts
needed a flag to be visible at all, and the corpus lived behind `serve_review.py` on a second port
with its own UI. **`scripts/review/serve_artifact_review.py` is now the single review site.**

**Every course loads, always.** `--course` picks which one the page *opens* on and which one the
print-only modes (`--dump`, `--links`, `--stale`, `--retire`, `--accept`) act on; the header carries
a switcher for the rest. The default stays `phys-215` so those print-only modes keep behaving
exactly as they did — changing it would have silently repointed five flags.

**Grounding is a second mode on the same page.** It serves `MURRAY-GROUNDING.md`'s 59 sections with
the same accept/reject/note UI, and appears only for a course that has a corpus — PHYS 310 alone.
PHYS 215 grounds in real OpenStax PDFs attached to a Claude Project by hand, so there is nothing
here to review and the tab is absent rather than empty.

**The two writeback rules are NOT merged, and that is the point of the change most worth stating.**
An artifact decision writes a sidecar and cannot reach a `.jsx`. Approving a grounding section
**writes into the corpus** — `STATUS: REVIEWED <date>`, the exact string the build gate greps —
because a sidecar of approvals would be a second source of truth the gate does not read. So the
corpus half is **imported from `serve_review.py`, not reimplemented**: that module keeps its
re-read-before-write check, its atomic replace, and its rule that rejections never touch the corpus.
Two copies of that logic would be two copies to drift, and the dangerous one is not the copy to
duplicate. Consequently grounding does **not** autosave the way artifacts do — a 1.2-second debounce
is the wrong contract for rewriting a tracked source file, so the Save button is the write, and the
header says which rule is in force.

**The two halves are joined, in both directions.** Each artifact card lists the corpus sections it
was built on with their live `REVIEWED`/`PENDING` status and a click through to each; each section
lists the artifacts resting on it. **This is the reason to merge the pages rather than link them**:
sixteen PHYS 310 artifacts were built against sections nobody has checked against the book, after
recker lifted the gate on 2026-08-05, and judging an objective's prose without knowing whether its
source is attested is judging half the thing.

**The join is parsed from `BUILD-LOG.md`'s `Grounding` line, taking only the references before the
em dash.** The commentary after it names sections deliberately *not* used ("section 12.7 is not
assigned") and carry-forwards borrowed from earlier lessons; a whole-line scan pulls those in and
shows a section as relied upon when nothing relies on it — wrong in the expensive direction. For
PHYS 310 the result is a bijection: **59 references, 59 distinct, 59 sections in the corpus, no
orphan on either side, no reference to a section that does not exist.** New `--grounding` prints
that join and exits, so it can be checked without a browser.

**Verified.** 21 anchored edits, each matched exactly once. The file compiles; the generated page's
664 KB of JavaScript **parses under `node --check`, with a negative control confirming the check can
fail** — that check is worthless on JSX (`PROJECT.md` §9) because Node auto-detects `import`/`export`
as ESM, and this page has neither, so it is genuinely parsed. An in-process end-to-end test drove
the real server: both courses in the payload, 17 + 29 artifacts, 51 + 110 objectives all with probe
prose, 59 sections, the join agreeing in both directions, the seeded `by: "published 2026-07-31"`
provenance intact, path traversal in a posted course id refused (400), grounding save refused for a
course with no corpus (400), and unknown routes 404. **The corpus-write route was tested through its
refusal**: an approval carrying a deliberately wrong `sha` ran the whole route, was reported as
stale, approved nothing, and left `MURRAY-GROUNDING.md` byte-identical.

**What this deliberately did NOT do.** **No grounding section was approved** — that is recker's
attestation against the book and never an agent's, so the corpus is unchanged and still reads 3
reviewed / 56 pending. No `.jsx` was touched. No sidecar decision was added or altered. Neither
writeback rule was weakened. `serve_review.py` was **not** deleted or deprecated — it is now the
implementation the unified page calls, so it stays, and it still runs standalone. The empty corpus
sidecar the test created was removed. `PROJECT.md` is still not registered in `docs/DOC-SOURCES.json`
despite its own maintenance note asking for it — indexing it would fire on nearly every commit, and
that is a decision to make deliberately, not a side effect of this change.

**`PROJECT.md` §10 corrected in the same commit,** two rows of it. The review-page row now describes
both modes, the join, and the split writeback. **The `courses/phys-310/artifacts/` row was already
wrong before this change and is fixed here**: it said the course holds *one* artifact and has *no*
`BUILD-LOG.md` — both untrue since 2026-08-05, and the second one is a claim about how this tool
reports publication status, so it could not be left. The objective-key count in the review-page row
is replaced with an instruction to read it from `--dump`; it had already been rewritten twice and
was wrong between every build.

---

## 2026-08-05 — recker via Claude Code (PHYS 310: build every remaining preflight)

recker asked for **every remaining PHYS 310 preflight**, against the updated schedule, with the
grounding taken on trust and **one subagent at a time, released before the next**. **All sixteen are
built.** PHYS 310 now holds seventeen artifacts — every lesson in the course that has a Murray
reading — and its build queue is empty. One entry, rewritten in place as each batch landed, rather
than six near-identical ones.

**Course-wide audit after the last build: 17 artifacts, 51 objective keys, 51 distinct, zero
collisions; 17 distinct slugs; every slug named in `BUILD-LOG.md`; every file pure LF with zero NUL;
all 17 green at 37/37.**

**ALL SIXTEEN ARE BUILT.** Lessons 3, 4, 6, 8, 9, 10, 13, 14, 15, 18, 19, 24, 25, 26, 31, 32. Each is 3 probe topics at ~3 active min per
`COURSE_PROFILE.md`, carries a contract §3.2 slug whose 8-hex suffix was **minted centrally so
uniqueness is guaranteed rather than trusted**, is pure LF with zero NUL, and passes
`check_artifact.py` 37/37 — plus `--forbid` guards proving nothing of the structural base survived
the rebase. **Every one was re-verified independently of the agent that built it.**

| lesson | slug | lines |
|---|---|---|
| 3 Binding Energy and Stability | `phys310-binding-energy-and-stability-e0ceabee` | 2097 |
| 4 Radioactivity | `phys310-radioactivity-77500fd7` | 2136 |
| 6 Lab 1: Measurement of Half-Life | `phys310-lab-1-measurement-of-half-life-1f096984` | 2115 |
| 8 Nuclear Reactions | `phys310-nuclear-reactions-d02377ad` | 2170 |
| 9 Cross Sections | `phys310-cross-sections-9308e38c` | 2179 |
| 10 Neutron Transport | `phys310-neutron-transport-4ecf35e0` | 2170 |
| 13 Radiation Interactions with Materials | `phys310-radiation-interactions-with-materials-1dd51596` | 2265 |
| 14 Bioeffects and Safety | `phys310-bioeffects-and-safety-a111da9b` | 2255 |
| 15 Dose and Shielding | `phys310-dose-and-shielding-43f26ac6` | 2206 |
| 18 Detection Methods: Gas-Filled Detectors | `phys310-detection-methods-gas-filled-detectors-edc3bbb5` | 2120 |
| 19 Detection Methods: Scintillation, Semiconductor, and Dosimetry | `phys310-detection-methods-scintillation-semiconductor-and-dosimetry-f5e95d35` | 2206 |
| 24 Fission: Neutron Multiplication | `phys310-fission-neutron-multiplication-2a606ef1` | 2277 |
| 25 Fission: Criticality | `phys310-fission-criticality-b2dbd1a4` | 2401 |
| 26 Fusion | `phys310-fusion-6bfea3e2` | 2155 |
| 31 Nuclear Reactors: Basics, Components, Types, Accidents | `phys310-nuclear-reactors-basics-components-types-accidents-be837c38` | 2295 |
| 32 Fuel Cycle: Isotope Separation, Waste | `phys310-fuel-cycle-isotope-separation-waste-9277e5a0` | 2386 |

**The most important finding is about a corpus section, not an artifact.** §3.5 — the sole grounding
for lesson 6 — **may not be a real Murray section, and the corpus admits it about itself**: its Flags
block calls it *"the entry most likely to be misfiled, since it is inferred largely from the lesson
being Lab 1"* and *"the weakest entry in Chapters 2–5."* **That is a circularity.** The schedule
assigns reading 3.5 to a lab, so the reconstruction produced a §3.5 about labs. **Nothing in the
physics prose signals it** — the bullets are crisp, quantitative and correct-sounding, so anyone who
skips the Flags block reads an inference as an extraction. Verified by reading the corpus directly,
not taken from the build's report. **This is the first section recker should open.**

**A second structural finding: the corpus puts §3.1's best probe in the one lesson that may not use
it.** §3.1's own Flags name the predictive link *neutron-rich → β⁻, proton-rich → β⁺/EC, very heavy
→ α* as "the section's real content and the best probe in it" — but §3.1 grounds lesson 3, and decay
modes belong to lesson 4. The boundary was honoured both ways: lesson 3 carries the link marked *for
your correctness only, not for probing* and stops at *why* a nuclide is unstable, and lesson 4's
topic 1 has the cadet **build** that link rather than recall it. **Lesson 3 is therefore probing its
section's second-best material by design**, which is recker's call to revisit, not a build's.

**Chapter 4 produced the run's two hardest findings, and both are corpus defects rather than build
problems.** **§4.1 defines the Q-value and supplies no nuclide masses at all** — not for a single one
of the reactions the lesson names — so the lesson's headline calculation is ungrounded for every
example it uses; light-nuclide masses were borrowed from §2.6/§2.7 to make one case computable and
the tutor is told to refuse rather than quote any other. And **§4.1 and §4.4 contradict each other
about the deuteron**: §4.1 says the threshold exceeds |Q|, §4.4 gives the deuteron photonuclear
threshold as exactly |Q|. Both are defensible — the §4.1 rule assumes a massive projectile — but the
corpus never says so, so a tutor reading both has an unresolvable contradiction. **That one should be
fixed upstream, not just handled locally.**

**A seam between two lessons was caught by verification rather than by reading.** Lesson 9's build
reported that λ = 1/Σ appears only in §4.5 and not in §4.7 — a grep of §4.7 for *mean free path*,
*1/Σ* and *lambda* confirmed it returns nothing, **and §4.7's own prose gives no hint that anything
is missing**. Lesson 10 was therefore told to read §4.5 as well and carry it forward tagged. A build
that trusted its assigned section alone would have shipped a transport lesson with no mean free path
in it.

**THE COURSE NEVER GIVES A CADET A SINGLE ATTENUATION COEFFICIENT.** Lesson 13 found that §5.3 states
`I = I₀e^(−μx)` and `HVL = ln2/μ` and supplies no numerical μ, μ/ρ or half-value layer for any
material. Lesson 15 was asked explicitly whether §11.3 closes that gap one chapter later. **It does
not** — §11.3 adds the tenth-value layer and the buildup factor and still names no value —
**and a grep of all 1 800 corpus lines confirms it: five hits for half-value / HVL / TVL / attenuation
coefficient / μ-ρ / cm⁻¹, and not one of them is a number.** So lesson 13's workaround was not a local
gap; it is the corpus's permanent state, and lesson 15 is built around it with **the half-value layer
as the unit** and every centimetre figure stipulated out loud. **The same hole exists for the
dose-rate constant Γ**, which §11.2 says is "tabulated per nuclide" against a table that does not
exist. §11.3's own Flags name the question that decides whether this is repairable: *whether Murray
tabulates B and μ, or treats them qualitatively, is unverified.*

**Two lessons disagree about a unit, and neither is wrong on its own.** §10.1 calls the roentgen
"historical, air-specific, and superseded"; §11.2's single usable number is quoted in R/h. **The
course's only computable dose rate is expressed in the unit the previous lesson retires.**

**A risk coefficient does not exist anywhere in the corpus.** Lesson 14 has LNT, the full set of dose
limits, and the entire natural-background budget — and **no number linking dose to a probability of
harm.** The hole is invisible, because the surrounding text is dense with decimal places, and **the
most natural cadet question in that lesson is numerically unanswerable.** The artifact carries an
explicit instruction that inventing a number there would be the worst available failure.

**A stale lesson number was found in the corpus and fixed.** §5.6's Flags prose still read *"the
schedule pairs it with Ch. 10 for Lesson 15"* — residue of this morning's renumber, which re-pointed
the `STATUS:` trailers and left Flags prose alone. **Rewritten to name the topic rather than the
number**, which is the only form that survives the next renumber. Status counts untouched: 56
pending, 3 reviewed.

**A build caught a defect in the schedule this same run had just written.** Its Grounding column said
*no DOE cross-check* for chapter 12 while all three of that chapter's corpus sections claim DOE covers
them. **The column had been filled by inference — the same failure mode that produced this course's
one published defect.** The whole column is now **quoted from the corpus's own `Cross-check` lines**
across every lesson, and it now records reduced or absent confidence wherever the corpus records it.
That surfaced something the inferred version had hidden: **lesson 32's six sections carry `None` on
every one**, making it the weakest-grounded lesson in the course.

**Chapter 12 produced a defect of a shape not seen before: the corpus disagrees with itself
numerically and does not notice.** §12.5 argues gas-versus-semiconductor resolution from carrier
statistics and predicts about √10. The only two resolution figures quoted at a common energy — NaI
~70 keV and HPGe ~2 keV at 1.33 MeV — differ by about **35×**, ten times what the argument predicts.
The root cause is a hole: **no light-yield or carriers-per-MeV figure for any scintillator exists
anywhere in the corpus**, so a scintillator cannot be placed in the argument at all. **It reads as
complete because both halves are individually confident.** The artifact teaches the argument's form,
treats the 35× as measured, and is instructed to confirm rather than explain away a cadet who spots
the gap.

**A confidence flag and a subject flag are not the same thing, and chapter 12 has one of each.**
§12.5's MODERATE flag does not show in its content at all — it is the most quantitatively specific
section of the four. §12.8's LOW flag is not really about confidence: **the corpus says outright that
what §12.8 contains is a guess**, inferred from the lesson title, with two named alternatives. That
is why lesson 19 grounds §12.8 in full and probes it not at all — **probing an objective on material
the cadets may not have read is a failure that looks like success.**

**The corpus's own chapter-level flag warned that chapters 6 and 16 overlap and the split was
uncertain. It was settled from §16.1's own wording rather than by preference** — *"k_eff and the
six-factor formula **from §6.5**, now as the working tool"* — so lesson 24 owns k and the neutron
accounting, and lesson 25 owns reactivity as an operating variable, subcritical multiplication and
1/M, kinetics, and control. **Two items were handed forward explicitly rather than declined**, and
lesson 25 read lesson 24's artifact before scoping so the handoff was real. This is the second time in
the run that an explicit signposted handoff let the second lesson take an idea confidently instead of
declining it.

**The fission energy table does not close, three ways — recomputed here, not taken on report.**
Components sum to **207 MeV**; the stated total is ~200; the stated recoverable is 193 while
table-minus-antineutrinos is 195. Each figure is individually standard; together they are
inconsistent, and **nothing was silently fixed** — the artifact grounds the table verbatim, forbids
the tutor from adjusting an entry or telling a cadet the book is wrong, and records a cadet who spots
it as having read well.

**A zero cross-check turned out to be a third kind of flag, and the content corroborates itself.**
Fusion has the weakest cross-check in chapters 2–16 — §7.2 has literally none. But both Flags blocks
are about *packaging* (section boundaries, which notation Murray prints), not about a physics claim.
**And the four reaction branches were checked here against two-body momentum conservation: every one
distributes its Q-value in inverse proportion to product mass, three matching the printed digits and
the fourth off by exactly what mass numbers rather than actual masses give.** A confabulation does not
satisfy two-body kinematics four times independently. Set against that, the live hazard in §7.2 is
**the Lawson criterion given in two unit systems in adjacent clauses** with no statement of which
Murray prints — mixing them produces nonsense that reads as fluent, and the artifact forbids
conversion outright.

**Thinness is the running theme, and it is invisible from the prose.** §3.1 has no worked example, no
equation and no number except the ≈1.6 ratio. §3.3 has nothing numerical but the Curie definition.
§3.5, §4.5 and §4.7 have no numbers at all — **§4.7 has no constant, no magnitude, no worked
example and no figure, so nothing in it can be computed from itself**, and it still reads as the
densest section in the run. It also uses the diffusion coefficient `D` three times without ever
defining or valuing it, which makes the diffusion length uncomputable in a section that sells L as
what *"sets how thick a shield must be."*

So **most of the arithmetic in these artifacts is constructed from the corpus's relations rather
than reproduced from its worked values**, and there is no corpus arithmetic to check it against —
only each build's own double-derivation, re-run independently. Every such value is marked as derived
in the file it appears in. `BUILD-LOG.md` records this per lesson.

**A false assertion inherited from the structural base was corrected in the nine drafts where it was
actually false, and left alone in the eight where it was not.** The base's verification protocol
illustrates *never confirm a wrong physics claim to be agreeable* with a cadet claiming tritium has
three protons, and closes with **"The reference confirms this."** That is **true in the base** — §2.5
covers tritium by name — and false in an artifact whose reference has no tritium in it, where it
instructs the tutor to trust a source that does not contain the claim. **Who was affected was
established by audit, and the assumption would have been wrong in both directions**: four builds had
already adapted the example to their own lesson, three more kept it and *do* carry tritium in their
reference, and the published base is correct. Only nine needed the fix, and it is minimal — the
reasoning is definitional, so no reference has to carry it. **All seventeen re-checked at 37/37
afterwards.**

**Two `CORE.md` §8 rows closed and two opened.** The preflight-count disagreement is settled by the
new workbook. **The row saying "§2 is inferred, not observed — revise after the first artifact is
built" had its premise expire**: 46 artifacts exist now, §2's substance held up, and what it does not
yet record is what the builds actually taught. Opened: the lifted grounding gate with 56 sections
still unreviewed, and PHYS 310 lessons 1, 16 and 20 — `PF = Y` with no reading assigned and therefore
unbuildable without recker.

**Deliberately not done.** **Nothing published, nothing registered, no corpus section marked
reviewed.** No artifact was rebuilt, and **lesson 2 was left alone** despite its slug not matching the
schedule. **Lessons 1, 16 and 20 were not built** — all three are `PF = Y` with no reading assigned,
and inventing one is not covered by the reconstruction exception. **No lesson was split**, though
lessons 13, 31 and 32 each carry five or six sections against three topics; where a split would fall
is recorded per lesson in `BUILD-LOG.md`, because `COURSE_PROFILE.md` makes that recker's decision
rather than a build step.

---

## 2026-08-05 — recker via Claude Code (PHYS 310: re-transcribe the schedule, lift the grounding gate, open the build run)

recker asked for **every remaining PHYS 310 preflight** to be built, against the updated schedule,
with the grounding taken on trust: *"Assume the grounding for 310 is correct and we can fix
objectives and grounding later if we need to."* This entry is the preparation; the builds follow.

**A hand transcription corrupted a published artifact's identity, and this is how it was found.**
recker's workbook edit was diffed against the previously committed workbook rather than assumed to be
the source of every difference — and lesson 2's topic turned out not to have changed at all.
**Both** workbooks read `Energy, Atoms, and Nuclei`; `phys310_fall2026_schedule.md` has said
`Atoms and Nuclei` since the day it was written, the build read the transcription, and the live
artifact carries `phys310-atoms-and-nuclei-83022f32` — a slug minted from a word that was never in
the source. **Nothing in the toolchain could have caught it:** `check_artifact.py` validates the
slug's *shape*, never its *derivation*, and the workbook was not registered in `DOC-SOURCES.json`, so
the staleness checker reported all eleven indexed documents current while this one disagreed with its
own source. Meanwhile `docs/operations/PREFILL-LINK.md:95` had been using the *correct*
`phys310-energy-atoms-and-nuclei-<8hex>` as its worked example the whole time, so the repository has
quietly contradicted itself about this lesson's identity for five days. **Not fixed** — a rebuild
mints a new suffix and registers as a *new lesson row* (contract §3.2), so it is recker's call.

**`courses/phys-310/phys310_fall2026_schedule.md` is registered in `docs/DOC-SOURCES.json`** against
the workbook, which closes the gap that let the above happen silently. Twelve indexed documents now.

**What genuinely moved in the workbook.** **Lessons 13–17 were re-ordered** — the SNL field trip went
from 13 to 17, and Radiation Interactions, Bioeffects, Dose and Shielding and Lab 2 each shifted one
lesson earlier. **This cost nothing**, and that is the point: PHYS 310 mints its slug, filename,
header and component name from the topic alone, precisely because recker said the numbering would
move. It moved. **The same renumbering in PHYS 215 would have stranded five published artifacts in
five places each.** Also: lesson 7's reading is now `Handout`, and the homework labels renumbered
(11 → HW2, 27 → HW4, 34 → HW5).

**The preflight-count disagreement is closed** — a `CORE.md` §8 open item since bootstrap. The Grade
Breakdown sheet now reads *20 assts, 3 points each* = **60 of 1000**, agreeing with the twenty rows
marked `PF = Y`. It previously budgeted 25 for 75 points. `grade_weight_note` in the profile is
corrected 75 → 60.

**The `STATUS: PENDING` build gate is lifted, and the status lines were deliberately NOT flipped.**
Fifty-six of the corpus's fifty-nine sections are unreviewed; under the gate exactly one lesson was
buildable. recker lifted it. **Flipping the status lines to REVIEWED would have made the `grep` come
out clean at the cost of destroying the only record of which physics a human has actually read
against the book** — trading the signal for the appearance of the signal. So the corpus still reports
three reviewed and fifty-six pending, which is true, and the lift is recorded as what it is:
permission to build on a reconstruction, not an attestation that the reconstruction is right. The
review is still owed, and is now owed against concrete drafts instead of an empty directory.

**Lessons 18 and 19 print the same topic in the workbook**, which in this course would have collided
on the slug, the filename **and** the component name at once — silently, because the second build
overwrites the first file. They are disambiguated by reading: `Detection Methods: Gas-Filled
Detectors` (§12.1–12.3) and `Detection Methods: Scintillation, Semiconductor, and Dosimetry`
(§12.4–12.6, §12.8). Both strings are load-bearing and now settled.

**`courses/phys-310/artifacts/BUILD-LOG.md` created**, five days after this course's first artifact
was published — its absence was already recorded as the reason `serve_artifact_review.py` reports
PHYS 310's publication status as *unknown*. Lesson 2 is backfilled from the prose in `PROJECT.md`
that was the only place its slug and URL appeared together, and re-verified (still 2021 lines, still
37/37).

**Seventeen lessons in this course can hold a preflight, not twenty.** Lessons **1** (the reading is
the syllabus), **16** (Lab 2) and **20** (Lab 3) are marked `PF = Y` and assign no reading at all, so
no corpus entry exists and none can be built. **Deliberately not invented** — the
reconstruct-from-model-knowledge exception covers Murray sections the schedule *assigns*, and making
up a reading it does not assign is a different act with no decision behind it. All three are blocked
on recker.

**Deliberately not done.** **Nothing was published or registered.** **Lesson 2 was not rebuilt.**
**No corpus section was marked reviewed.** No artifact was built in this commit — the sixteen builds
are separate work and land separately.

---

## 2026-08-05 — recker (review lessons 2 and 3 on the review page)

recker's own working-tree edit, committed here unchanged and attributed to him rather than folded
into an agent's commit. **All eight objectives across the two rebuilt artifacts are accepted**, and
none carries a `by` field — which is the distinction that field exists for. A seeded note reads
`by: "published <date>"` and records approval *inferred* from the fact of publication; a note with no
`by` records somebody actually reading the prose on the page. These eight are the latter.

**Every artifact in the repository now carries a review decision made on the page or seeded from a
publication, and lessons 2 and 3 are no longer the exception** — they were published on 2026-08-05
without a review-page pass, which the previous entry recorded as outstanding. It no longer is.

**Two `sha` values moved in the same edit**, for `speed-from-two-constants` (lesson 30) and
`focal-point-and-paraxial` (lesson 32). Those are the two stale ACCEPTANCES: applying a neighbouring
rejection moved their prose, so the note is advice about text that has changed. Re-confirming them is
what clears the staleness — **retiring them would discard recker's approval**, which is the one thing
the acceptance records.

---

## 2026-08-05 — recker via Claude Code (publish lessons 2 and 3; stop the parse claim from needing an edit)

recker published the two rebuilt artifacts and supplied the URLs. **All thirty artifacts in this
repository are now published**, and PHYS 215 holds twenty-nine of them.

| lesson | slug | published |
|---|---|---|
| 2 | `lesson-02-electric-charge-coulombic-force-3a8e4e18` | `2058f785-477f-4455-9bec-adf4f37d88f3` |
| 3 | `lesson-03-coulombs-law-and-superposition-485f9923` | `472070b0-dda4-404d-a3bf-b0329c5bfa74` |

**`--links` now emits 29**, up from 27, and both new slugs resolve against their own URL. The rows
were written in the shape `published_urls()` parses — immediately after the backticked slug row —
because a row placed anywhere else leaves the artifact silently reported as a draft.

**These are NEW lesson rows and do not replace anything.** Both mint fresh 8-hex suffixes per
contract §3.2, so the pilot's pre-repository lesson 2 and 3 artifacts are still live at their own
URLs and would both run unless recker retires them. That choice is recorded as recker's in
`BUILD-LOG.md` and `PROJECT.md`; it is not a thing a build or an agent decides.

**The parse claim has been rewritten to state the rule instead of the count, and the count must not
go back.** That sentence changed truth value **five times in three days** — true, false when eight
new builds landed, true when they were published, false when lessons 2 and 3 were rebuilt, true
again now. It was rewritten every time and was wrong in between every time, which is a documentation
smell rather than an unlucky week: **a sentence that has to be edited on every build and every
publish will be stale most of the time, because nobody edits it at the moment it goes false.** What
replaces it is the invariant — *an artifact is unparsed until it is published; publishing is the only
JSX parser this project has; `check_artifact.py` is explicitly not a syntax check* — which is true
regardless of what was built this hour. The current state is noted as an aside rather than as the
claim.

**A stale row was caught in the same pass.** `BUILD-LOG.md`'s status summary still read
*"**Published** | **all nineteen**"*, describing the world before the eight optics/modern
publications earlier the same day. It now reads twenty-nine and names each publication wave.

**Deliberately not done.** **Nothing was registered** — that is recker's click on the DFPM faculty
page, and no lesson row is saved for any artifact in either course. **The end-to-end `d.effort` check
is still unrun**, and it now sits under all thirty artifacts; a wrong endpoint or an unregistered
`course_id` fails silently, with the cadet seeing a success page and the work reaching nothing.
**The pilot's old lesson 2 and 3 artifacts were not retired.** **The twelve pacing-string mismatches
were not fixed** — still recorded, still a republish each. **Lessons 16 and 40 remain unbuilt** for
want of a grounding source. **Lessons 2 and 3 have not been reviewed on the review page**; they were
published without that step, so no `REVIEW-NOTES.json` entry exists for either.

---

## 2026-08-05 — recker via Claude Code (delete the two .tsx artifacts; rebuild lessons 2 and 3)

recker added the pilot's pre-repository lessons 2 and 3 as `.tsx` files and asked for as much as
possible to be pulled out of them into `BUILD-LOG.md`. **Inspection found four problems, and on
seeing them recker said to delete both and rebuild the normal way.** Done: the `.tsx` are gone and
two first-class `.jsx` artifacts replace them, each **37/37**.

**What was wrong with the `.tsx` pair.** All four were found before the decision, none was assumed:
1. **Suffix-less slugs** — `lesson-02-electric-charge-and-coulombs-law`. They predate contract §3.2
   (2026-07-28), so `check_artifact.py` failed each at **31/32** on exactly that rule. Every offering
   of the course would have shared one `activities` row.
2. **Invisible to the review page.** `serve_artifact_review.py` globs `*.jsx` (line 309), so neither
   could be reviewed on the page and neither could get a registration prefill link.
3. **LF, where every artifact here is CRLF**, and `courses/** -text` stores that verbatim.
4. **A generation-old model list** — `claude-sonnet-4-6` + `claude-haiku-4-5` against
   `claude-sonnet-5` + `claude-haiku-4-5` everywhere else. Two live families, so not stranded.

They were **snapshotted and hash-verified before deletion**, which mattered more than usual: both
were *untracked*, so git held no copy and a plain delete would have been unrecoverable. **The
pilot's published originals are untouched** and still serving at their own URLs.

**The two rebuilds.** `lesson-02-electric-charge-coulombic-force-3a8e4e18` (2424 lines) and
`lesson-03-coulombs-law-and-superposition-485f9923` (2257 lines). Both 4 topics × 2.0 min, contract
§3.2 slugs, uniformly CRLF, zero NUL, **37/37** each, and each re-verified independently of the agent
that built it. **110 objective keys across 29 artifacts, zero collisions.** Built one agent at a
time, lesson 3 only after lesson 2's scope was fixed.

**The pair overlaps, and that was the hard part.** Lesson 3's source (pp. 179–183) is a strict
**subset** of lesson 2's (pp. 170–183) — they share the whole of §5.3. So the split was made
explicit on both sides: **lesson 2 owns §5.1, §5.2 and the TWO-CHARGE case**; **lesson 3 owns the
vector form and SUPERPOSITION**. Each artifact carries a `scope_note` naming the other's territory as
grounded-but-never-probed, so a cadet raising it gets a correct answer and no session probes the same
material twice. Lesson 3 additionally transcribes the two-charge material under *"ASSUMED FROM THE
PRECEDING LESSON — use it, do not re-teach or probe it"*, and gives it no objective key, so it cannot
reach `d` or the rollup even by accident.

**The truncation at p. 183 is a seam, not a hole** — established by lesson 2's build and confirmed by
lesson 3's. Both sources stop mid-sentence at "at an angle of", inside Example 5.2. The continuation
is page 1 of `Electric Fields, Electric Field Lines.pdf`, printed folio 184, so the files tile with
no overlap. Consequence for lesson 3, whose central worked example this is: the printed angle, that
Example's Significance paragraph and any CYU 5.2 are **not quotable**. `|F| = 4.08e-14 N` *is*
printed; the angle (58.0° above −x) is **derived** from the printed components, and the tutor must
say out loud that it is deriving.

**A real sign error in the source, found by lesson 3 and verified three ways.** Example 5.1 prints
`F = (8.25e-8 N) r̂` where the sign must be negative — verified against the book's own `r₁₂`
definition, its own boxed opposite-direction rule, and Figure 5.15 re-rendered at 400 dpi, where the
force arrow points inward while `r` labels the outward segment. The tutor treats a cadet quoting the
printed version as having **read correctly**, then walks them to the contradiction using the book's
own three statements. **Lesson 2 transcribed the same line unflagged**, which is defensible — unit-
vector bookkeeping is lesson 3's subject, not lesson 2's — but it is recorded here so the asymmetry
is a decision on the record rather than an oversight.

**TWELVE PUBLISHED ARTIFACTS DISAGREE WITH THEIR OWN PACING CONSTANT.** Both builds found this
independently and neither inherited it. Lessons **4, 5, 7, 8, 9, 10, 14, 18, 19** are
`PER_TOPIC_BUDGET_MIN = 2.0` but say *"about its **3** min budget"*; lessons **13, 15, 20** are `3.0`
but say *"about **2** MINUTES"* and *"its full ~**2** min"*. The artifacts' own headers have described
this for weeks — *"the fifth was wrong in ten earlier artifacts here"* — without anyone enumerating
it. **Recorded in `BUILD-LOG.md` and added to `PROJECT.md` §9; deliberately NOT fixed.** All twelve
are published, so each fix is a republish minting a new suffix and registering a *new lesson row*,
and twelve new rows to correct one word each is recker's call. **The sharper cost is to builds, not
sessions**: rebasing a new artifact off one of the twelve inherits the bad string silently. Lesson
3's build hit exactly that — its brief named lesson 4 as the base — and rebased off lesson 2 instead
after verifying the two are byte-identical through the machinery.

**Deliberately not done.** **Nothing published** — lessons 2 and 3 are drafts and their JSX has never
been parsed, so `PROJECT.md`'s parse claim goes false for the **fourth** time in three days; it is
left as a standing warning about the pattern rather than rewritten again. **The twelve pacing strings
were not touched.** **The pilot's live lesson 2 and 3 artifacts were not retired** — the rebuilds mint
fresh suffixes and register as *new* lesson rows, so both sets would run unless recker retires the
old ones, and choosing is not a thing a build can decide. **No prefill links were generated** for the
two, because they have no published URL yet.

---

## 2026-08-05 — recker via Claude Code (record the eight publications; every artifact is now live)

recker published all eight corrected drafts — PHYS 215 lessons 30, 31, 32, 33, 36, 37, 39 and 41 —
and supplied the URLs. **All twenty-eight artifacts in this repository are now published.** Recorded
here: the eight URLs, the eight status rows, and the three claims across two files that this made
false.

**Every correction landed before publication, which is the difference between an edit and a new
lesson row.** The seven rejections were applied hours earlier, so each live artifact is the corrected
version — lesson 30 is the Poynting-vector build, lessons 32 and 33 are in `p`/`q`/`h`/`h'`, lesson
33 is three topics at ~3 min, lesson 39 has no decay constant in topic 2. Had any of them shipped
first, the fix would have been a republish minting a *new* 8-hex slug and registering as a *new*
lesson row (contract §3.2), not an update.

**The URL rows were written in the exact shape `published_urls()` parses** — the `| **Published** |`
row immediately after the backticked slug row, in the same table. That is not cosmetic: the parser
tracks the most recent slug it has seen and attributes the next URL line to it, so a row placed
anywhere else leaves the artifact reported as a **draft** with no error. Verified by regenerating the
links: **`--links` now emits 27**, up from 12, and every new URL resolves against its own slug.

**`PROJECT.md`'s parse claim has now changed truth value three times in three days, and it is kept
with its reasoning rather than flattened to a conclusion.** True on 2026-08-04; false the moment
eight new drafts landed; true again now. **Do not simplify that sentence to "everything is parsed"** —
the durable half is *why*: publishing is the only JSX parser this project has, so a fresh artifact is
unparsed until it is published, however green `check_artifact.py` is, and that check is explicitly
not a syntax check. The same sentence in `BUILD-LOG.md`'s header was corrected for the same reason
and now carries the same warning.

**What this leaves is registration, and it is now the only thing left.** Prefill links exist for all
27 PHYS 215 artifacts and are regenerated on demand from `INTERACTION_ID` + `BUILD-LOG.md` rather
than transcribed, so there is no copy to drift. **PHYS 310 still has none, because it has no
`BUILD-LOG.md`** and its slug and URL are paired only in `PROJECT.md` prose, URL first — which no
proximity scan can read without guessing. **Not one lesson row is saved on the DFPM site for either
course**, and that save is recker's click. Twenty-eight live URLs, zero reachable through the course
site.

**Deliberately not done.** **Nothing was registered** — that is recker's action on the DFPM faculty
page, and an agent doing it would be widening its own authorization. **The end-to-end `d.effort`
check is still unrun**, and it is now the single unverified hop sitting under all twenty-eight
artifacts: a wrong endpoint or an unregistered `course_id` fails **silently**, with the cadet seeing
a success page. **No artifact was re-verified after publication** — publication is outside this
repository and nothing here can observe it; the URLs are recorded as recker supplied them.
**Lessons 16 and 40 remain unbuilt** for want of a grounding source. **Two accepted review notes are
still `--stale`** (lesson 30 `speed-from-two-constants`, lesson 32 `focal-point-and-paraxial`) and
were again left alone — retiring a stale acceptance discards recker's approval rather than recording
that it was applied.

---

## 2026-08-05 — recker via Claude Code (apply recker's review of the eight optics/modern drafts)

recker: *"The rest of the artifacts have been reviewed. Make corrections."* **Seven objectives were
rejected across four of the eight drafts. All seven are applied, all seven notes are retired, and
every corrected artifact is green at `check_artifact.py` 37/37.** Nothing was published — all eight
are still drafts, and their JSX has still never been parsed.

**Lesson 30 — the energy topic became the Poynting vector.** recker rejected
`intensity-goes-as-amplitude-squared`: *"Basic Poynting Vector discussion instead that the direction
of the B and E components at any point in time can tell you which way the light travels."*
**This needed no new grounding, which is why it was a clean swap** — §16.3 prints equation 16.28,
`S = (1/mu_0)*(E cross B)`, and the source's own Faraday/Lenz argument for its direction, and the
build had already transcribed both while scoping them *engage-but-do-not-initiate*. The two swapped
scope. New key `poynting-direction-of-travel`; the amplitude-squared material stays grounded and
becomes engage-only. **The topic's sharpest question is the one recker's note points at**: E along
+y, B along +z gives +x — then reverse *both* fields and it is **still** +x, because the two minus
signs multiply. It also pays off topic 1, since the fields being *in phase* is exactly what stops
`E cross B` from ever changing sign.

**Lessons 32 and 33 — converted to the course's notation, whole-file.** Two rejections on each, all
four on notation alone: *"We use p and q for object and image"*, *"h and h' for height"*.
**309 substitutions in lesson 32 and 217 in lesson 33**: `d_o`→`p`, `d_i`→`q`, `h_o`→`h`, `h_i`→`h'`.
Converting only the rejected topics would have left two topics in one alphabet and two in another,
which is worse than either. Verified safe first: the symbols appear nowhere in the JS or CSS, and
**every bare `do` in both files is the English word**. One label was written `m = -di/do` without
underscores and was handled separately, because the global rename could not reach it.

**A `NOTATION` block was added to both, and it is not decoration.** The printed pages still say
`d_o` and `d_i`; the transcription now says `p` and `q`. That is the only place in either file where
the transcription is deliberately not literal, and the block says so — then tells the tutor the part
that matters in the conversation: **a cadet who writes `d_o` has read the book correctly** and must
not be corrected. One sentence of translation, then back to the physics, and never a section or page
number, because the grounding text is not the cadet's book.

**Lesson 33 also lost a topic, and it orphans three printed objectives.** recker's note on
`refraction-single-surface` was one word — *"Drop"*. **The build had already named that topic as the
one to lose if one had to go, and had already written down the cost**: it is a whole assigned
section, and losing it means the cadet is never asked where the thin-lens equation comes from. The
source prints five learning objectives — two thin-lens, three refraction — and the dropped topic
carried **all three refraction ones**. So this is the first probe set in this course that does not
cover every printed objective, and the artifact now says that in its own `NOTE ON WHY THREE` instead
of re-describing the set as complete. The §2.3 material stays transcribed, stays grounding, stays the
extension problem; it is simply no longer probed. **All six pacing strings moved 2 → 3 minutes
together** so three topics still fill the ~10 minutes the card promises — dropping a topic without
widening the budget would have quietly turned a ten-minute preflight into a six-minute one. Same
shape as lesson 29.

**Lesson 39 — half the note was a straight edit and half needed a ruling.** recker: *"half life good.
don't discuss lambda. talk about types of radiation."* The decay constant left topic 2 without
incident; `N = N_0/2^n` is the only decay formula it now needs. **"Types of radiation" had no
grounding**, and that was raised rather than improvised: §10.4 is where OpenStax explains alpha, beta
and gamma decay as processes, and **§10.4 is missing from the source PDF** — the printed folios run
432–436, 440–444, 454–464, so pp. 445–453 are absent, and **all 31 corpus PDFs were scanned and none
carries them**. What survives in the source is only the *names*, in a figure caption and a
breeder-reactor chain. **recker ruled the same day: assume prior knowledge.** The three types are now
handled as the cadet's own prior coursework — a category the artifact already had — and **nothing was
reconstructed from model knowledge**, since the PHYS 310 exception is scoped to PHYS 310. What the
source *does* supply is used: the printed chain `n + U-238 -> U-239 -(beta)-> Np-239 -(beta)-> Pu-239`
shows beta decay raising Z while A stays put, twice, which ties back to topic 1's nuclear symbol.
New key `halflife-and-radiation-types`.

**`lambda` was deliberately NOT removed from lesson 39 as a whole.** Topic 4, `activity-and-units`,
was **accepted** in the same review and its entire content is `A = lambda*N`. The rejection was
per-objective, so lambda keeps exactly one home and topic 2 now points at it rather than pretending
it does not exist. **If the intent was to remove lambda from the lesson entirely, topic 4 is the one
to say so about** — that is a one-line change and it is recker's call.

**Course-wide verification after the edits: 102 objective keys across 27 PHYS 215 artifacts, zero
collisions** (down from 103 — one key was dropped, not renamed). Every artifact's
`PROBE_TOPIC_COUNT`, key count and "Reports under objective key" count agree, and lesson 33 now sits
with the other three-topic artifacts (13, 15, 20, 28, 29) at 3.0 min.

**Two accepted notes are now `--stale`, and they were left alone on purpose.** Lesson 30's
`speed-from-two-constants` and lesson 32's `focal-point-and-paraxial` both moved because a
*neighbouring* rejection was applied — a cross-reference to "topic 3" in one, the notation in the
other. Neither was rejected. **Retiring a stale acceptance is not the same operation as retiring an
applied rejection**: it would discard recker's approval, which is the only record that the prose was
ever actually read. They are flagged for re-confirmation instead.

**`BUILD-LOG.md`'s header had gone stale in the same way `PROJECT.md`'s had**, and is corrected here
too. It still said *"every artifact in this repository is now published ... every one of them has
been parsed"* and described lessons 30–41 as blocked. Both were true when written and neither
survived the eight new builds. **That is the second file in two days to carry that exact sentence
past its expiry**, so the corrected version keeps the reasoning rather than just the conclusion:
every new build re-creates the gap.

**Deliberately not done.** **Nothing published, nothing registered** — the eight remain drafts and
publishing is still the only JSX parser this project has, so the corrections themselves are unparsed.
**Lesson 39's radiation-types topic was not built from model knowledge** while the source question
was open; it was built only after recker ruled. **Lessons 16 and 40 remain unbuilt** for want of a
source. **The `--stale` acceptances were not retired.** **`build/` was not re-localized** — nothing
in this run touched the profile or the kit.

---

## 2026-08-05 — recker via Claude Code (lesson 41, and PROJECT.md stops claiming everything is parsed)

**Lesson 41 — Photoelectric Effect, Wave/Particle — completes the run.** Slug
`lesson-41-photoelectric-effect-wave-particle-518e76f6`, 3315 lines, pure CRLF, `check_artifact.py`
**37/37**, verified independently of the agent that built it. **Across all 27 PHYS 215 artifacts
there are now 103 objective keys and zero collisions.**

**It is the widest scope in the course and the artifact says so rather than pretending otherwise:**
five sections across two chapters, **fourteen printed learning objectives**, against four probe
topics. No set of four can leave every printed objective probed. Scoping authority was the lesson's
own topic text — "Photoelectric Effect, Wave/Particle" names two things with equal billing, so the
split is two and two, with the reasoning written into `LESSON_CONFIG` so recker can overturn it in
one line. Blackbody radiation, the de Broglie→Bohr derivation, electron microscopy and the
uncertainty principle are all fully transcribed and **engage-only**.

**Its source is three blocks with two holes, and one hole is cited by the surviving text four
times.** Printed pp. 232–245, 259–271, 297–300. Missing: **pp. 246–258 (§6.3 Compton, §6.4 Bohr) —
absent from the entire corpus**, confirmed by reading folio runs off every PDF — and pp. 272–296.
Because today's material leans on the gap, the reference forbids stating the Compton shift formula,
the Compton wavelength, the Bohr energy-level formula and the hydrogen ionization value.

**A real wrong number, found and repaired.** The relativistic-proton Example computes λ = 1.16 fm,
then its Significance rescales to an electron as "(1835)0.77 fm = 1.4 pm" — **0.77 fm appears nowhere
in the solution.** The correct value is **≈2.14 pm**, checked two independent ways
(1835 × 1.16 fm, and hc/(βγE₀) directly). An extension problem repairs it, and the tutor treats a
cadet quoting 1.4 pm as having read the book correctly. Also recorded: a wrong equation
cross-reference, a dropped factor of 2, and **`φ` meaning work function in one section and scattering
angle in another with no warning.**

**`PROJECT.md` corrected, and one of its claims had become actively false.** It said *"Every artifact
here has now been parsed, and that is no longer a claim about a subset."* **Eight artifacts had just
been built and none of them has ever been parsed** — publishing is the only JSX parser this project
has, and none of the eight is published. That sentence is exactly the failure the file warns about in
its own maintenance note: a confident error a reader acts on instead of checking. It now says the gap
re-opened on 2026-08-05, and keeps the reasoning, because **every new build re-creates it.**

Also updated there: the count (**28 artifacts exist, 20 are published, 8 are drafts**), the phys-215
do-not-build guard, and the old "lessons 30–41 have no confirmed grounding source" row, which is
replaced by the narrower and now-verified fact — **lessons 16 and 40 have no source anywhere in the
corpus**, both `PF=Y`, both blocked on recker to supply one rather than deferred or skipped.

**Deliberately not done.** **Nothing published, nothing registered** — all eight remain drafts whose
JSX has never been parsed. **`build/` was still not re-localized** despite `grounding_text` now
being a live substitution; it is not committed, so nothing in git tracks the drift, and it wants a
run before the next build. **Lesson 41's "(Planetarium)"-style judgement calls were left as built** —
lesson 39 dropped that parenthetical from its slug and title, and reversing it is a rebuild with a
new slug, not an edit, so it is recker's call before publication rather than after.

---

## 2026-08-05 — recker via Claude Code (build the optics/modern tail; lessons 30-39)

recker: *"work on the remaining artifacts (remember no need to do 1-3)."* That cleared the
**lesson 30–41 block** `PROJECT.md` had reserved to recker since 2026-08-04. The factual half had
already been answered; this is the go-ahead.

**Seven artifacts built: lessons 30, 31, 32, 33, 36, 37 and 39.** Each is 4 probe topics at
`PER_TOPIC_BUDGET_MIN = 2.0` — the profile default — with all **six** pacing strings agreeing, a
freshly minted 8-hex slug per contract §3.2, pure CRLF, no NUL bytes, and `check_artifact.py`
**37/37**. Every one was re-verified by the orchestrator independently of the agent that built it.
**Lesson 41 is not in this commit**; it was still being written when this landed.

**Nine lessons remained, not twelve.** 34 and 38 are labs and 35 is a Graded Review. Of the nine,
eight are buildable and **lesson 40 (Polarization) is not — it has no grounding source anywhere in
the corpus.** OpenStax puts optical polarization at Vol. 3 §1.7 and `Light, Reflection,
Refraction.pdf` stops at §1.4. Verified by scanning **every** PDF in the corpus: the only `polariz`
hits are *dielectric* polarization in the capacitance chapter and *charge* polarization in
electrostatics — different physics, same word. **This is lesson 16's situation exactly**, and it is
recorded as blocked-on-a-source rather than built from model knowledge, because PHYS 310's
reconstruct-and-review exception is scoped to PHYS 310.

**The volume question is closed and both volumes are now named.** The Vol. 2 / Vol. 3 boundary falls
**between lessons 30 and 31** — lesson 30 is Vol. 2's last chapter, lesson 31 opens Vol. 3.
`grounding_text` now reads `Vols. 2 and 3`. **That makes it the first key on this course that
differs from `localize.py`'s `BASELINE`**, so localization is no longer a no-op and `build/` is no
longer byte-identical to the kit. `build/` is not committed, so nothing in git tracks that drift.

**A claim in `COURSE_PROFILE.md` was wrong and is corrected.** It said `verify.py` check 2 asserts
this course's localization is a no-op. **Check 2 reads the *kit's* bundled
`examples/COURSE_PROFILE.phys215.md`, not this file** — so editing this profile cannot affect it and
never could. The old wording would have made an agent expect a red check here and read a green one as
proof its edit was inert.

**The orchestrator's folio survey was wrong wherever there was a hole, and the builds caught it.**
Verso folios were *inferred* from their neighbours instead of read; in these Vol. 3 files the folio
prints in the running head of **every** page and was there to be read. Lesson 30's hole is pp.
675–679 (not 676–680), lesson 37's is pp. 145–151 (not ~146–152), lesson 39's are pp. 437–439 and
445–453 (each off by one), and lesson 32 starts at folio 50 (the chapter opener prints none). As
lesson 39's build put it: **a hole located one page off names the wrong missing content, and the
wrong content is what the GAPS block would have forbidden.**

**Two of the four cross-check sequences reported "contiguous" across real holes.** On lesson 30,
Check-Your-Understanding runs 16.3→16.6 **unbroken straight across five missing pages** and the
equation sequence is blind; on lesson 37, equations 4.1–4.4 then 4.5 are **consecutive across seven
missing pages**, because the excised sections number no equations of their own. The folio sequence
caught both. This is direct evidence for the rule already in `PROJECT.md` §10 — **treat a break in
any single sequence as a hole, and never require agreement across all four.** Each hole was also
confirmed to be a genuine gap rather than a chapter split, by hashing and folio-scanning all 31
corpus PDFs.

**§10.2's near-total loss was handled by separating the argument from the picture.** Lesson 39's
source keeps only five lines of the binding-energy section — the curve figure, the mass defect,
`BE = (Δm)c²` and `BEN = BE/A` are all in the hole — but the curve *argument* survives restated in
prose in two later sections that did not get cut, including "any fusion or fission reaction involving
the iron nucleus is endothermic". So the artifact grounds the argument on those sentences and forbids
the picture: no describing the curve as a graph, no shape, no sketching, and **specifically no citing
the familiar ~8 MeV/nucleon peak** — only the 6.82 and ≈3 MeV/nucleon values that actually survive.

**Source defects found and recorded, each verified two ways before shipping.** A real arithmetic
error in lesson 30 (microwave hot-spot spacing printed 6.02 cm; it is 6.12 cm) and a dropped "not"
that inverts an ozone sentence; lesson 33's `|m| > 0` where it must be `|m| > 1`, landing directly on
its magnification objective; lesson 32's Figure 2.2 caption contradicting Equation 2.1 four lines
below it; lesson 31's "total internal *refraction*"; lesson 37's Example 4.1 Strategy naming `D`
where the quantity is the slit width `a`; and lesson 39's "controlled, sustainable" chain reaction
needing ~50% U-235 one page before Fermi's reactor runs on 3.6%. **In every case the tutor treats a
cadet who quotes the printed version as having read the book correctly.** Lesson 36 found none and
says so explicitly, so the silence is not read later as a skipped audit.

**Two scope findings that narrowed what could honestly be probed.** Lesson 30: §16.3 lists photon
energy as a printed learning objective and then **never mentions a photon again** — no `E = h*f`, no
Planck constant, nowhere in 18 pages — so the artifact forbids it and adds a misconception for a
cadet who imports it. Lessons 32 and 33 independently found that **the printed sign conventions are
incomplete in both sections** (no printed rule for `d_o`; the height rule in prose only), which makes
the magnification formula unusable as printed; both tutors are told not to read that gap as cadet
carelessness.

**Lessons 32 and 33 tile one chapter and the seam held**, confirmed from both sides: 32 ends at
printed folio 61, 33 begins at 62, no overlap and no gap. Mirrors are engage-only in 33 and lenses
are engage-only in 32, so **no material is probed twice** and the two share no objective key.
**Across all 26 artifacts in this course there are now 99 objective keys and zero collisions** — the
failure that would fragment the cohort rollup with nothing reporting an error.

**Deliberately not done.** **Nothing was published and nothing was registered** — publication is
recker's act under `CORE.md` §6, and these seven are drafts whose JSX **has never been parsed**,
since publishing is the only parser this project has. **Lesson 40 was not built** and **lesson 16
remains unbuilt**, both for want of a source. **`build/` was not re-localized** in this commit even
though `grounding_text` changed, because the build agents were reading the localized skill while it
ran and `localize.py` wipes that directory. **`PROJECT.md` still carries the old 30–41 blocker row
and the old artifact counts**; it is updated in the follow-up commit alongside lesson 41.

---

## 2026-08-05 — recker via Claude Code (rebuild the review page; put the registration links in it)

recker: *"create a better website and have these links show up somewhere there. I said simple
website, but I still want it to look nice."*

**The registration links now live in the page rather than in a chat message.** Every artifact's
DFPM prefill link is generated from values already parsed here, shown in a Registration card with
Copy and Open, and printable without a browser via the new `--links`. The reason to put them here
rather than hand them over each time: **the two values a link is made of — the slug and the
published URL — are parsed by this tool already and live nowhere else together**, so anywhere else
is a transcription step, and transcription is the one failure this link cannot survive.

**`id` is read out of the artifact and never re-derived.** Contract §3.2 ends every slug in 8
random hex minted once per build, so there is nothing to re-derive it from; an `id` that does not
equal the artifact's `#i=` makes the receiver discard every cadet report **with no error anywhere**
— the cadet finishes, sees a success page, and the work reaches nothing. The card prints the link's
`id` and the artifact's `INTERACTION_ID` side by side for exactly that reason, and says why.

**Spaces are encoded `%20`, not `+`.** `urlencode`'s default and `URLSearchParams.toString()` both
emit `+`, which only decodes back to a space under form-urlencoded rules — a receiver using
`decodeURIComponent` would render every lesson title with literal plus signs. `%20` is correct under
both and is what the contract's own worked example shows. Worth recording because the contract's
build snippet recommends `URLSearchParams` and therefore recommends the `+`.

**The page was rebuilt rather than restyled.** A **sidebar index** of all nineteen artifacts with
status dots replaces the cramped `<select>` jump menu — it lists **every** artifact whatever the
filter is, because the filter governs where `next` goes and hiding the lesson you just accepted
while you are still looking at it is worse than showing one the filter excludes. Also: a proper
header with the course mark and live counts, cards with real hierarchy and shadow, accept/reject
rendered as a coloured edge rather than a full-bleed wash, focus rings, and a sticky translucent
footer. Collapses to one column under 1000px.

**Copy has a fallback and says which path it took.** `navigator.clipboard` needs a secure context —
127.0.0.1 is one, a forwarded port may not be — and a Copy button that silently does nothing is
worse than no button. On failure it selects the link and tells you to press Ctrl+C.

**Where a link cannot be built honestly, the card says so and why.** PHYS 310 gets no link: its
published URL is not machine-findable (no `BUILD-LOG.md`), and that URL is the one value in the link
that cannot be derived from the artifact source. The card states that rather than rendering a blank.

**Verification.** `python -m py_compile` clean; the page's JavaScript extracted and passed
`node --check` (valid here — the caveat about `node --check` is JSX-specific, and this is plain JS);
the server driven over HTTP with all nineteen links confirmed present in the served HTML; sidebar
titles checked in node against the real data, all nineteen clean, including the three whose titles
contain commas; `--links` exercised for both courses. **A no-op `/save` round-trip left
`REVIEW-NOTES.json` byte-identical**, which is the regression that mattered — the writer was
refactored in the previous entry and this run touches the page that calls it. All three gate checks
green.

**Deliberately not done.** **No lesson row was registered and no link was opened** — those are
recker's clicks on an external site. **No artifact was edited.** **No dark mode**: the tool is a
local review surface, and a second colour scheme is a second thing to keep correct for no stated
need. **`policy=interaction` is hardcoded**, since no profile key carries it and both courses'
preflights are artifact-only; the page displays the value so a course that ever offers a written
alternative (`choice`) is a visible correction rather than a silent wrong default.

---

## 2026-08-05 — recker via Claude Code (record the seven publications; every artifact is now live)

recker published the seven reviewed PHYS 215 drafts and supplied their URLs — lessons 21, 22, 24,
25, 26, 28 and 29. **This entry records that; it did not perform it.** Publishing is recker's act
(`CORE.md` §6, `safe-change`), and no agent published anything.

**Every artifact in this repository is now published — twenty of twenty.** PHYS 215 holds nineteen
(twelve on 2026-08-04, seven on 2026-08-05) and PHYS 310 holds one (2026-07-31).

**The consequence worth stating plainly: every `.jsx` here has now been parsed.** Publishing is the
only JSX parser this project has — `check_artifact.py` is explicitly not a syntax check, and
`node --check` silently passes invalid JSX (`PROJECT.md` §9). Until today, seven artifacts had never
been through any parser. **That gap is now closed, and closed completely rather than for a subset.**
The reasoning is kept alongside the conclusion in `PROJECT.md`, because the next build re-creates the
gap: a fresh artifact is unparsed until it is published, however green the checks are.

**Lesson 29 was published as the three-topic version.** recker's rejection of `hertz-confirmation`
was applied earlier the same day, so what is live at its URL runs 3 probe topics at ~3 active min,
not the 4 at ~2 it was built as. `BUILD-LOG.md`'s lesson 29 section now says so on the Status row,
because that section's tables were written for the four-topic build and a reader arriving at them
cold would otherwise take them for a description of the live artifact.

**Recorded, in `courses/phys-215/artifacts/BUILD-LOG.md`:** each of the seven `Published` rows now
carries its date and URL, each `Status` row moves from DRAFT to PUBLISHED, the status-summary table
reports all nineteen published, and the run-status prose is rewritten. **The seven `Published` and
six of the seven `Status` rows are byte-identical strings**, so they were targeted by line number —
and every target asserts the content it is about to overwrite, because a line-number edit that does
not check what it is replacing is how lesson 24's URL lands under lesson 25.

**`PROJECT.md`:** the artifact count, the parse claim, the registration paragraph and the unproven-hop
paragraph all updated. The review-tool row now distinguishes the **thirteen seeded** decisions
(`by: "published <date>"`, inferred from publication) from the **seven judged on the page** by recker
on 2026-08-05 — those seven are the only acceptances in either sidecar that record somebody actually
reading the prose, which is precisely what the `by` field exists to keep separable.

**What this changes about the risk, and it is the whole point of the entry.** Building is finished.
**Twenty artifacts are live and not one lesson row is registered on the DFPM site**; prefill links
have not even been generated for the seven published today. So the single unverified hop — does a
submission reach the receiver and get graded from `d.effort` — now sits under every artifact this
project has, with nothing else competing for attention. **That hop fails silently**: the cadet
completes the session, sees a success page, and the work reaches nothing. Submit one throwaway
session end to end before any cadet is pointed at any of these URLs.

**Deliberately not done.** **No prefill links generated and no lesson row registered** — both are
recker's clicks on an external site, not an agent's. **No artifact was edited**; this run touched
only records. **`REVIEW-NOTES.json` was not re-seeded**: recker's seven acceptances are real
judgments already in the file and seeding them as inferred-from-publication would have destroyed the
distinction the `by` field exists to preserve. **The 30–41 go-ahead is still open**, and remains the
only build decision outstanding.

---

## 2026-08-05 — recker via Claude Code (apply the review notes: drop lesson 29's Hertz topic)

recker: *"Ok, I made my comments. Address them and update the required jsx."*

**recker reviewed the seven PHYS 215 drafts and rejected exactly one objective.** Everything in
lessons 21, 22, 24, 25, 26 and 28 was accepted with no comment, as were three of lesson 29's four.
The rejection is lesson 29's `hertz-confirmation` — *"Making, catching and timing the waves"* — with
the comment **"Drop it"**. That is the whole of the review, and it is the whole of what this run
applied.

**`courses/phys-215/artifacts/lesson_29_preflight_maxwells_equations.jsx` — 18 edits, one decision.**
The probe topic and its objective key are gone, so the idea can no longer reach the `d` payload or
the cohort rollup. `PROBE_TOPIC_COUNT` 4 → 3 and `OBJECTIVE_KEYS` down to three. **The count change
forced a budget change**: 3 × ~2 min delivers about six minutes against a start card promising
"about 10", so `PER_TOPIC_BUDGET_MIN` widened 2.0 → 3.0 — the same trade recker's review made for
lessons 13, 15, 20 and 28, and it lands this artifact on lesson 28's exact shape. **Six strings state
that budget, not the five every artifact's header comment claims**; the sixth is the PACING line
"its full ~N min", four lines below the fifth, and it has been present in every artifact in this
course all along. All six were changed and grepped. The `time_budget` block, the `probe_topics`
header, the reading-assignment objective list, the two header comment blocks and the "why N topics"
note were all rewritten to match rather than left asserting four.

**Hertz was dropped from the probe set, not from the artifact, and that was a judgment worth
stating.** The rejection is on an *objective* — what the timed conversation assesses. The grounding
pages stay transcribed, the radio lateral connection stays, misconception 6 stays, and extension
problem A still puts numbers on the experiment; problem A's calibration was re-anchored off the
topic that no longer exists. The `scope_note` gained an explicit **engage-but-never-probe**
instruction, which is the idiom the file already used for lesson 28's displacement current and for
the speed of light. The reasoning: radio and "does it really travel at *c*" are the two lateral
connections cadets actually raise, and a tutor stripped of the pages would meet them empty-handed.
**If recker meant strip Hertz entirely, that is a second edit and a smaller one — say so.**

**`scripts/review/serve_artifact_review.py` — added `--retire <slug>:<key>`.** `PROJECT.md` §10
warned that *"a note whose objective is already fixed still reads as outstanding until it is
removed"*, and until now the only way to remove one was hand-editing the JSON — the kind of step
that gets skipped. `--retire` is dry-run by default and **refuses any note whose objective is still
in the artifact with unchanged prose**, because such a note cannot have been applied. It is
deliberately **per-note rather than a sweep of everything `--stale` flags**: a GONE key means
applied, but a changed `sha` only means the prose moved, and a rebuild for an unrelated reason
changes it too — a blanket sweep would silently discard notes nobody acted on. The payload writer
was factored out (`write_notes`) so `save_notes` and `retire` cannot drift on the sidecar header.

**Verification — and the honest limits of it.** `check_artifact.py` on lesson 29: **45 passed, 0
failed**, running the original 7 `--forbid` guards plus `hertz-confirmation` to prove the dropped key
left nothing behind. **That is not a syntax check** (`PROJECT.md` §9) — this artifact is a draft and
**has never been through a parser**, because publishing is the only parser this repository has. The
review page reparses lesson 29 as 3 topics × 3.0 min with three keys, and **the three surviving
objectives' shas are byte-identical to what recker accepted**, so those acceptances are not stale.
`--stale` now reports every note matching its artifact. The merge/atomic/empty-record behaviour of
the writer was unit-tested against a temp copy of the sidecar; the real file was untouched by that
test. All three gate checks green. Every file edited in **byte mode** with a uniform-CRLF assertion
(`PROJECT.md` §9), and `git diff --stat` read before staging: 205 changed lines on a 2,650-line
artifact, not a line-ending rewrite.

**Deliberately not done.** **Nothing was published** — all seven drafts remain unpublished and
`CORE.md` §6 reserves that for recker. **No slug was re-minted**: lesson 29 is unpublished and
unregistered, so this is an edit rather than a rebuild, and minting a fresh 8-hex suffix would have
been gratuitous churn. **The other six drafts were not touched** — they carry no comments. **The
grounding, figures and equation transcription were not re-verified**; this run changed what is
probed, not what the artifact knows. **Misconception 6 was kept** rather than deleted, marked as
unprobed background. **The end-to-end submit check is still unrun**, and it still sits under all
thirteen published artifacts.

---

## 2026-08-05 — recker via Claude Code (seed the already-approved artifacts; show only what is left)

recker: *"I already accepted most of these directly in Claude Code and they should be marked as
accepted, especially if published. I just want to see things I haven't reviewed yet."*

**Seeded every published artifact as accepted, and made the review page default to showing only
what has no decision yet.** Two changes to `serve_artifact_review.py`, plus the two sidecars they
produced.

**`--accept-published` and `--accept <slug>…`, dry-run by default per `python.md` §8.** Both record
an approval that already happened rather than making one — `CORE.md` §6 reserves approval for
recker, and publication is the evidence: publishing is a human act that follows review, and the
twelve PHYS 215 artifacts were reviewed and published on 2026-08-04. Re-reading them in this page
would be asking recker to redo finished work.

**The seeded record is deliberately distinguishable from a click.** Each objective carries
`by: "published <date>"`, the page shows an *Already accepted — recorded from publication, not
judged on this page* banner, and **touching an objective drops the `by`**, because from that point
the decision is a real one. A click is a judgment about the prose; a seed is an inference from the
artifact having gone live. Conflating them would corrupt exactly the signal this file exists to
carry. Seeding also **skips any objective that already has a decision or a comment** — a real
review always beats an inference — which makes re-running it idempotent.

**Seeded: 13 artifacts, 48 objectives.** Twelve PHYS 215 (45 objectives) from `BUILD-LOG.md`
publish rows, and PHYS 310's *Atoms and Nuclei* (3) named explicitly with
`--as "published 2026-07-31"`. That course has **no `BUILD-LOG.md`**, so `--accept-published` found
nothing there and said so, pointing at `--accept` instead — it does not scrape the date out of
`PROJECT.md` prose, where the URL precedes the slug and any proximity match would be a guess. The
publish date came from `CHANGELOG.md` and is recorded as the provenance rather than dropped.

**The page now opens on the first artifact with no decision and filters to those by default** — a
`to review` / `all` toggle, prev/next and the jump list confined to the filtered set, and a
*Nothing left to review* screen when the queue empties. The current artifact stays reachable after
you decide it, rather than vanishing mid-click.

**Net effect: the review queue is the seven PHYS 215 drafts — 21, 22, 24, 25, 26, 28, 29** — and
PHYS 310 opens straight to the done screen.

**Verification: executed, not assumed.** The dry run listed exactly the twelve published slugs and
45 objectives before anything was written; re-running after the commit reports all 45 left alone,
so it is idempotent. An unknown slug exits 1. The page's JavaScript was extracted and passed
`node --check` (plain JS — the `PROJECT.md` §9 caveat about `node --check` silently accepting JSX
does not apply), then its data and filter logic were **run in node against the real embedded
state**: 19 artifacts, 12 accepted, 7 untouched, opens on lesson 21, `to review` shows exactly
21/22/24/25/26/28/29, provenance present on lesson 4 and absent on 21; PHYS 310 shows 1 accepted, 0
to review, done screen true. `git diff --stat -- courses/` confirms **no artifact byte changed**.
Three gate checks pass.

**Deliberately not done.** Nothing was approved by the agent — every seeded entry is a record of
recker's own prior approval, sourced from publication and labelled as such. **No draft was seeded**:
the seven unreviewed artifacts were left untouched even though recker said "most", because "most" is
not a list and publication is the only evidence in the repository. If any of those seven were in
fact already accepted, say which and they take one click each. No artifact was edited, published, or
marked ready. No note has been applied.

---

## 2026-08-05 — recker via Claude Code (artifact parameter review page)

**Added `scripts/review/serve_artifact_review.py`** — a loopback review page that serves one
artifact's parameters at a time and records recker's verdict. Asked for directly: a way to view the
parameters one at a time, accept all objectives, accept some and reject others, or leave comments,
with the comments stored so an agent can work through them later.

**What it shows per artifact:** the slug, `lesson_id`, grounding source, probe-topic count,
per-topic budget, model candidates, and component/file/version — then every objective key with its
label and the full probe-topic prose from `LESSON_CONFIG`. Accept / Reject per objective, an
**Accept all objectives** button, a comment box on each objective, and a separate comment slot for
each of the seven parameters. Prev / next, a jump list showing each artifact's verdict, and `j`/`k`
or arrow keys to move. It autosaves ~1.2 s after a change and on navigation, so clicking Next
cannot lose a note.

**It is read-only on the `.jsx`.** That is the deliberate difference from its sibling
`serve_review.py`, which writes STATUS lines into the corpus it serves. Decisions land in a new
sidecar, `courses/<id>/artifacts/REVIEW-NOTES.json`, written atomically and **merged** rather than
replaced, so a second tab or a rerun cannot drop earlier notes. Two reasons for not editing in
place: rewriting a probe topic is prose work with no field to flip, and **twelve of these artifacts
are published** — an accepted rejection costs a republish, which mints a new 8-hex slug and
registers as a *new lesson row* per contract §3.2. The page prints that cost as a banner on every
published artifact instead of letting a click imply it is free.

Every note carries the `sha` of the prose it was written against, and `--stale` lists notes whose
artifact has since been rebuilt — a note about text that no longer exists reads as current, which
is worse than no note. `--dump` parses and prints without serving.

**A parse bug found and fixed during verification, worth recording because it was silent.** The
probe-topic regex ran over the whole file, and `  1. ` also starts numbered lists inside
`TEXTBOOK_REFERENCE` and `common_misconceptions`. Topic 1 therefore began at the *first* such list
and swallowed everything down to the first `Reports under objective key:` line — yielding the right
key with the wrong prose: 4609 words on lesson 28 beside three ~380-word neighbours, and 11451 on
lesson 13. Nothing errored. Fixed by scoping the scan to the `probe_topics` region, and `--dump`
now flags any topic more than 4× its artifact's median length, because this class of bug parses
cleanly and can only be caught by proportion.

**Two documentation facts corrected in the same change.** `PROJECT.md` §10 described PHYS 310's
artifact as *unpublished* — it was published on 2026-07-31, as its own §10 prose four paragraphs
down and `CHANGELOG.md` both say. The row was written before the publish and never updated. Also
noted there: PHYS 310 has **no `BUILD-LOG.md`**, which is the only machine-findable pairing of a
slug with a published URL, so the new tool reports that course's publication status as *unknown*
rather than as *draft* — the error in the cheap direction. `.ai/patterns/python.md` and
`PROJECT.md` both said "five stdlib scripts"; there are now six.

**Verification: the parse and save paths were executed, not just read.** All 20 artifacts across
both courses parse — 75 objectives, no unmatched key, probe topics 82–533 words. The server was
started and driven over HTTP: page renders (214 KB, objectives and the published banner present),
a save writes the sidecar, a second save for a different artifact **merges** rather than clobbers,
clearing an artifact's decisions removes its entry, whitespace-only comments are dropped, and
`--stale` detects a mismatched `sha` and exits 1. The unknown-course path exits 1 and lists the
courses that exist. `git status` and `git diff --stat -- courses/` confirm **no artifact byte
changed**. The three gate checks pass. There is no test suite and no linter (`CORE.md` §2), so
that execution plus reading the diff is all the verification this got.

**Deliberately not done.** No artifact was edited, published, or marked ready — nothing in the
review flow can do any of those, by construction. No `REVIEW-NOTES.json` is committed; the test
sidecar written during verification was removed, and the first real one appears when recker saves.
No `docs/operations/` runbook was added — the durable facts went in `PROJECT.md` §10 and here,
rather than inventing a document nobody asked for. Publication status is read only from
`BUILD-LOG.md`; PHYS 310's URL was **not** scraped out of `PROJECT.md` prose, where the URL
precedes the slug and any proximity match would be a guess. And no note has been applied — working
through them is a separate request.

---

## 2026-08-05 — recker via Claude Code (second PHYS 215 run — closing entry)

**The seven-lesson run is complete: 21, 22, 24, 25, 26, 28, 29 are built, and the PHYS 215 queue is
empty.** Each lesson's own CHANGELOG entry and `BUILD-LOG.md` section record its slug, objectives,
source findings and defects. This entry closes the run and corrects the repository-level counts.

**Corrected `PROJECT.md` §10, which had gone stale mid-run.** It said seventeen artifacts exist and
named four drafts; the true figures are **twenty artifacts, thirteen published, seven drafts**. Added
that every remaining unbuilt PHYS 215 lesson is unbuilt for a recorded reason rather than for want of
a run.

**Verified independently rather than accepted from the build reports.** All seven artifacts re-checked
in one sweep: `check_artifact.py` **37/37 on every one**, zero NUL bytes in each, all five pacing
strings internally consistent per artifact (six at ~2 min, lesson 28 at ~3), every `INTERACTION_ID`
carrying the required `lesson-<NN>-` stem and a contract §3.2 8-hex suffix, and all three gate checks
green. One apparent pacing mismatch in lesson 28 was chased and is not one — the `2` is inside a
comment stating what the *profile* default is, explaining why that lesson chose three topics.

**The four-way source cross-check earned its keep five times.** Every build in this run hit at least
one sequence that stayed continuous across a real gap, and it was a **different** sequence each time:
lesson 24's numbered equations, lesson 25's equations from the opposite side, lesson 26's Check Your
Understanding, lessons 28 and 29's worked Examples. **No single-sequence check would have caught them
all**, which is why `PROJECT.md` §9's rule was corrected mid-run from "all four skipping in step" to
"the folio sequence is the authority and any single break is a hole until disproved".

**Deliberately NOT done.** Nothing was published, nothing registered, and **no artifact was marked
ready for students** — all seven are DRAFTS awaiting recker's review (`CORE.md` §6). Lessons 30–41
were not built; the block stands and is recker's to lift. Lesson 16 was not built and still has no
source anywhere in the corpus. The `"its 3 min budget"` contradiction in the nine published artifacts
was left unfixed by design — fixing it means republishing and re-registering nine lessons for one
word — and the recommendation recorded is to fix the structural base instead. The stale tritium
example in the `VERIFICATION PROTOCOL` block of every artifact was likewise recorded and left. The
Supabase registration check from the previous run is still unrun: no credential exists on this
machine.

**What is still unproven is unchanged by this run and now sits under twenty artifacts.** No lesson row
is registered for either course, no cadet has taken a session, and **no `d` payload has ever reached
the receiver**. Submit one throwaway session end to end and confirm a grade was written from
`d.effort` before any cadet is pointed at any URL.

**Verification:** the three gate checks, `check_artifact.py` on all seven, and reading the diffs. **No
JSX in this repository has been parsed** — publishing is the parser, and these seven have not been
published.

---

## 2026-08-05 — recker via Claude Code

**Built the PHYS 215 lesson 29 preflight — *Maxwell's Equations* — the seventh and last of the current
run, which is now complete.** New file
`courses/phys-215/artifacts/lesson_29_preflight_maxwells_equations.jsx`, slug
`lesson-29-maxwells-equations-7a27dd4c` (8-hex suffix minted once, contract §3.2), component
`Lesson29Preflight`, **four probe topics at ~2 active minutes each**. Structural base is the lesson 28
artifact; every lesson-specific constant was replaced and nothing else was touched.

**This lesson is the second half of a source lesson 28 already half-consumed.** The grounding PDF was
re-hashed for this build and is **byte-identical to lesson 28's** (SHA-256 `4fe0d5f3…31731dc4`,
3,803,535 bytes), so the split recorded in `BUILD-LOG.md` is the only thing keeping the two artifacts
from probing the same pages. **Nothing lesson 28 probed is re-probed:** the two artifacts share no
objective key, and the splice asserts mechanically that none of lesson 28's three key strings, its slug
stem, its slug suffix, its component name or its source filename survived the rebase. Lesson 28's
displacement-current material *is* transcribed here and the tutor leans on it — **as prerequisite,
exactly as lesson 25 leaned on lesson 24's flux and Faraday work** — but it carries no objective key, so
it cannot reach the `d` payload, and the `scope_note` forbids building a question on it. The seam was
**re-verified independently rather than taken on trust**: same hash, all six pages re-rendered, all four
cross-checks re-run, both edges re-confirmed. Every row of lesson 28's seam table was accurate.

**Four probe topics — this course's profile default, and the first build in the run able to use both
profile values unmodified.** This lesson owns **three** of the section's four printed learning
objectives against lesson 28's one. Objective 2 is topic 1, objective 4 is topic 4, and objective 3
splits cleanly into a structural half (what the symmetry is and where it fails) and a dynamical half
(what the symmetry then does) — genuinely different, since a cadet can see the equations mirror each
other and still not see why anything propagates. **None of the four is a subdivision invented to reach
four**, which was the bar lesson 28's handoff set. Because lesson 28 ran at `PER_TOPIC_BUDGET_MIN =
3.0`, **all five pacing strings had to move back down to 2 together** — the first downward move of that
number in this course, where every earlier change widened it on review. All five were grepped in the
finished file and all five say 2.

**Grounding: OpenStax University Physics Vol. 2 — §16.1, printed pp. 658–663; this lesson's half is
pp. 661–663.** All four cross-checks re-run independently: folios **658–663** unbroken (the authority),
numbered equations **16.1–16.12** unbroken, Check Your Understanding **16.1–16.2** unbroken, figures
**16.2–16.5** unbroken. **The worked-Example check is blind again — the section prints exactly one
Example and it is lesson 28's — making this the fifth build running blinded on a sequence and the
fourth distinct sequence to go blind.** Both edges clean, no interior hole.

**A real source error found, new to this build, and it lands squarely on probe topic 1.** **The boxed
MAXWELL'S EQUATIONS panel states Gauss's law without its 1/ε₀** — *"The electric flux through any
closed surface is equal to the electric charge Q_in enclosed by the surface."* The flux equals
**Q_in/ε₀**. **Verified two ways:** Equation 16.8, printed four lines above it *inside the same panel*
and read at 600 dpi, is `∮E·dA = Q_in/ε₀`, so the panel's prose contradicts its own equation; and
dimensionally, flux carries N·m²/C while charge carries C, so they cannot be equal whatever the
numbers. **Lesson 28 transcribed this sentence faithfully without noticing it was wrong**, which is why
it was still there to find. It matters more than a typo because topic 1 asks the cadet to state each
equation in words and **this panel is the printed model answer** — so the artifact treats a cadet who
repeats it as having read the book *correctly*, names it in a misconception, and **builds extension
problem B around it** so the defect teaches instead of merely warning.

**The ambiguous symmetry clause lesson 28 flagged for this build is ruled on: it is not an error.**
Lesson 28 recorded that *"The displacement current source for the electric field, like the Faraday's
law source for the magnetic field, produces only closed loops of field lines"* is backwards under the
"source **of**" reading, right under the "source **arising from**" reading, and that nothing on the page
settled it. Re-read at 500 dpi, **the page does settle it, two ways**: the sentences on either side both
state the opposite of the "source of" reading, so it would contradict both neighbours within three
lines; and **decisively, the panel on the previous page says outright that "the electric field from a
changing magnetic field has field lines that form closed loops, without any beginning or end"** —
exactly the clause's claim for the Faraday half, which forces the same reading on the other half by the
sentence's own parallel structure. So the physics is right and the wording is poor. Lesson 28 was right
to flag it and right not to call it an error, and **too pessimistic in saying nothing settles it**.

**Verification — and this is the whole of it, including the part that has no source behind it.**
`check_artifact.py` reports **44 passed / 0 failed** (37 base plus 7 `--forbid` guards), and the file
was read. **That is all the verification this artifact got. It is not a syntax check** — there is no
JSX parser on this machine and publishing is what parses it (`PROJECT.md` §9). **Additionally, and
separately: the extension problems' numbers have no printed source to check against.** Lesson 28
consumed the section's only worked Example, and lesson 29's half turned out to contain **no numerical
value of any kind** — so every number in problems A, B and C is this build's own construction. Each was
computed **at least two independent ways in Python** with both passes written into the artifact;
problem A additionally carries a physical self-check (its constants were chosen so the answer must land
on the speed of light, and it does, to 0.73%); and problem D was made deliberately conceptual so the
stretch problem carries no arithmetic risk. **That is the entirety of their verification — it is not a
check against a source, because there is no source to check against.** Lesson 21 recorded a milder
version of this as an open question; this is the loud version, and it is in `BUILD-LOG.md` too. All
three gate checks pass.

**What was deliberately NOT done.** No other lesson was built, and **the queue is now empty** — the
status summary says so rather than carrying a stale target line. **No other artifact was modified**:
the `"its 3 min budget"` string in the nine published artifacts and the stale tritium example in the
`VERIFICATION PROTOCOL` block are both already recorded and were left alone; the defect found in this
source was written to the build log, not fixed anywhere else. **The artifact was not published and not
marked ready for students — it is a DRAFT until recker approves it** (`CORE.md` §6), as are the other
six drafts from this run. Nothing under `preflight-kit/` or `.claude/skills/` was touched, no contract
was edited, and no build step or dependency was introduced. The Cengage 33.2 mapping remains unverified
against a Cengage table of contents, as in every earlier lesson. Lessons 30–41 remain blocked on
recker, and lesson 16 remains deferred.

## 2026-08-05 — recker via Claude Code

**Built the PHYS 215 lesson 28 preflight — *Displacement Current* — the sixth of the current
seven-lesson run.** New file `courses/phys-215/artifacts/lesson_28_preflight_displacement_current.jsx`,
slug `lesson-28-displacement-current-dc9f8b07` (8-hex suffix minted once, contract §3.2), component
`Lesson28Preflight`, **three probe topics at ~3 active minutes each**. Structural base is the lesson 26
artifact; every lesson-specific constant was replaced and nothing else was touched.

**The constraint that made this build different: lessons 28 and 29 share ONE six-page source.**
`Displacement Current.pdf` and `Maxwell's Equations.pdf` are byte-identical — re-verified here by
SHA-256 (`4fe0d5f3…31731dc4`, 3,803,535 bytes) — so the two lessons had to be scoped by content rather
than by file. **The question the run put to this build was whether six pages can carry two ~10-minute
sessions at all, with "no, recker must supply a second source" an acceptable answer. The answer is
yes,** and the evidence is that the section's own four printed learning objectives fall exactly on the
seam that was agreed in advance: objective 1 (Maxwell's correction of Ampère's law) is lesson 28's
entire assignment, and objectives 2–4 (the four equations as a set, the E–B symmetry, Hertz) are lesson
29's. **A page-by-page seam table naming every equation, figure and example consumed versus left is in
BUILD-LOG.md; lesson 29 should be built from that record rather than from a fresh read of the PDF.**

**Grounding: OpenStax University Physics Vol. 2 — §16.1, printed pp. 658–663. Six pages, one
contiguous block, no interior hole, and clean at both edges — the first source in this run of which
that is true.** Folios 658–663, numbered equations 16.1–16.12, figures 16.2–16.5 and Check Your
Understanding 16.1–16.2 all run unbroken. **The blind cross-check moved for a fourth time and to a
fourth sequence: the worked-Example check has nothing to say here, because the section prints exactly
one Example.** Absent is the chapter opener (p. 657, including Figure 16.1), which is why the figure
sequence starts at 16.2 — a chapter-opener absence, not a hole.

**Two real source defects found, each verified two ways, and neither is an arithmetic error.**
(1) **Equation 16.7 subscripts a closed *line* integral with a *surface*** — it prints `∮_{S₁} B·dl`
where every other statement of the same integral on these pages prints `∮_C`. Verified by reading it at
600 dpi and by the six other occurrences that all use `C`; `B·dl` cannot be integrated over a surface
at all. **This lands squarely on probe topic 1, whose entire subject is the difference between a loop
and the surfaces it bounds**, so the artifact names it in a misconception and tells the tutor a cadet
quoting it has read the page *correctly*. (2) **Example 16.1's Strategy attributes its RC result to the
"Alternating-Current Circuits" chapter**; it is a dc battery transient. Verified by the example's own
statement and by text-searching the pages of that chapter this corpus actually holds (lesson 26's
grounding), which contain zero occurrences of "RC circuit". This one has a real cost — **this course
has no grounding source for RC circuits anywhere**, which is why lesson 16 is deferred — so the
artifact scopes the transient as Tier-2 prior coursework and forbids sending a cadet to look it up.
**Every line of algebra in this source reproduces exactly:** Example 16.1 was re-derived independently
by both of its own routes and they agree. No arithmetic slip anywhere — the fourth such lesson running.

**Three topics, not this course's default four, and the source decided it.** This lesson owns one of
the section's four printed objectives; a fourth topic could only have been taken from lesson 29's
three, which is precisely the duplicate-conversation the split exists to prevent. **The per-topic
budget widened to ~3 min so the cadet-facing "about 10 minutes" stays true** — the same trade recker's
review made for lessons 13, 15 and 20. **All five pacing strings were grepped in the finished file and
all five say 3.** This is the first artifact in the run built at a non-inherited budget from the start
rather than widened afterwards, so it is the first real test that the five strings move together.

**Verification — and this is the whole of it.** `check_artifact.py` reports **45 passed / 0 failed**
(37 base plus 8 `--forbid` guards proving no lesson-26 objective key, slug stem, slug suffix
`1bbf05b9`, component name or source filename survived the rebase), and the file was read. **That is
all the verification this artifact got. It is not a syntax check** — there is no JSX parser on this
machine and publishing is what parses it (`PROJECT.md` §9). All three gate checks pass.

**What was deliberately NOT done.** No other lesson was built — 29 remains queued. **No other artifact
was modified**: the `"its 3 min budget"` string in the nine published artifacts and the stale
tritium example in the `VERIFICATION PROTOCOL` block are both already recorded and were left alone;
defects found were written to the build log, not fixed in other files. **The artifact was not published
and not marked ready for students — it is a DRAFT until recker approves it** (`CORE.md` §6). Nothing
under `preflight-kit/` or `.claude/skills/` was touched, no contract was edited, and no build step or
dependency was introduced. The Cengage 33.1–33.2 mapping remains unverified against a Cengage table of
contents, as in every earlier lesson.

## 2026-08-05 — recker via Claude Code

**Built the PHYS 215 lesson 26 preflight — *Generators and Motors, AC, Transformers* — the fifth of
the current seven-lesson run.** New file
`courses/phys-215/artifacts/lesson_26_preflight_generators_and_motors_ac_transformers.jsx`, slug
`lesson-26-generators-and-motors-ac-transformers-1bbf05b9`, component `Lesson26Preflight`, four probe
topics at ~2 active minutes each. Structural base is the lesson 25 artifact; every lesson-specific
constant was replaced and nothing else was touched.

**Grounding: OpenStax University Physics Vol. 2 — §13.6 (printed pp. 570–575), §15.1 plus §15.2
(printed pp. 624–630), and §15.6 (printed pp. 645–648). Seventeen pages in three disjoint blocks
across two chapters — the widest span in the run, and the three blocks map one-for-one onto the three
Cengage groups the cadets were assigned.** No interior hole in any block: folios, numbered equations,
figures and worked Examples all run unbroken within each. **Unlike lessons 24 and 25, the excised
pages are in no other artifact's file** — §13.5 eddy currents (pp. 566–569), §13.7, all of chapter 14
on inductance, and pp. 631–644 (RLC circuits, ac power, resonance) are absent from this run's corpus
entirely, and the artifact's `GAPS IN THE SOURCE` block forbids treating any of it as today's
material. **The blind cross-check moved for a third time:** lesson 24 was blinded by the equation
sequence, lesson 25 by the same one from the other side, and here the *Check Your Understanding*
sequence sees nothing at the first seam, because the first block prints no such prompt at all.

**Three real source defects found, each verified two ways at 500 dpi, and none is an arithmetic
error.** (1) The only generator worked example computes the **peak** emf and its Significance calls it
"a practical average value" — the true average over that quarter turn is 83.8 V against the printed
131 V, and the printed number is exactly the peak `N·A·B·ω` the same section boxes two pages later,
the two differing by π/2 = 1.5708, the peak-to-average ratio of a quarter sine. This lands squarely on
probe topic 1, so extension problem B exists to repair it. (2) "The generator output of a motor is the
difference between the supply voltage and the back emf" is backwards — the same page's own numbers
call that difference "the total voltage across the coils", and the worked example a page later writes
the back emf as what is *left* after the resistive drop. (3) Capacitive reactance is glossed with the
inductor's sentence ("opposition to a change in current"), contradicted by the next clause on the same
page. In every case the tutor is told to treat a cadet quoting the printed version as having read
correctly. **Every printed number in this source reproduces exactly** — all of them were recomputed;
no arithmetic slip was found anywhere, the third such lesson in a row.

**Four topics, and for the first time in this run the constraint ran the other way — more printed
material than slots.** This source prints **nine** learning objectives across four sections, so the
test the run has been applying (does dropping a topic orphan a printed objective?) cannot be satisfied
by any set of four and is not claimed. The rule applied instead is **one topic per assigned Cengage
section**. Five topics were considered and rejected because the cadet-facing card promises "about 10
minutes". **The cost is that capacitive and inductive reactance are scoped engage-only with no
objective key** — fully transcribed, engaged with confidently if a cadet raises them, never initiated
or reported on — because OpenStax bundles the resistor, capacitor and inductor into one section while
the cadets were assigned Cengage 32.1–32.2, which on the standard chapter layout is ac sources plus
resistors only. **That is an inference about the cadets' book, not a verified fact**, and it is the
first of three open questions recorded for recker in the build log.

**Verification, stated plainly because silence reads as "tested": the only verification this artifact
got was `check_artifact.py` (45 passed / 0 failed — 37 base plus 8 `--forbid` guards proving no
lesson-25 objective key, slug stem, slug suffix, component name or source filename survived the
rebase) plus reading the file.** No JSX on this machine has ever been parsed (`PROJECT.md` §9);
publishing is the parser. The four extension problems' numbers were computed and independently
re-derived in Python, and every printed number in the source was recomputed there too — but no cadet,
and no human, has run the interaction.

**All five pacing strings were grepped and confirmed to say 2** — `PER_TOPIC_BUDGET_MIN`, the
`time_budget` block, the PACING opener, the probing instruction, and the PACING line *"about its 2 min
budget"*, the one that was wrong in ten earlier artifacts.

**What was deliberately NOT done.** No other lesson was built — 28 and 29 remain queued. **No other
artifact was modified**, so the `"its 3 min budget"` string still contradicts `PER_TOPIC_BUDGET_MIN`
in the nine published files and the stale tritium example still sits in every artifact's
`VERIFICATION PROTOCOL` block; both are recorded, both remain recker's call, and both are
cross-cutting changes to the structural base rather than per-lesson edits. Nothing under
`preflight-kit/` or `.claude/skills/` was touched, no contract was edited, no dependency or build step
was introduced, and **the artifact is a DRAFT — it has not been reviewed, approved for students, or
published** (`CORE.md` §6). `COURSE_PROFILE.md` and `PROJECT.md` were not edited: nothing this build
learned changes a fact either of them states.

`courses/phys-215/artifacts/BUILD-LOG.md` gains a lesson 26 section with the objectives, the slug, the
full page-block map, the three defects, the nine notation caveats and three open questions for recker;
lesson 26 moves from queued to built in both the status summary and the current-run queue table; and a
new subsection records the three-block structure and the third blind cross-check for whoever builds
next.

---

## 2026-08-05 — recker via Claude Code

**Built the PHYS 215 lesson 25 preflight — *Lenz's Law, Induced Electric Field* — the fourth of the
current seven-lesson run.** New file
`courses/phys-215/artifacts/lesson_25_preflight_lenzs_law_induced_electric_field.jsx`, slug
`lesson-25-lenzs-law-induced-electric-field-1a98a6d0`, component `Lesson25Preflight`, four probe
topics at ~2 active minutes each. Structural base is the lesson 24 artifact; every lesson-specific
constant was replaced and nothing else was touched.

**Grounding: OpenStax University Physics Vol. 2 ch. 13, §13.2 (printed pp. 550–553) and §13.4
(printed pp. 562–565) — two disjoint four-page blocks, and the eight pages between them are lesson
24's, not a hole.** Both PDFs were rendered and read for this build rather than the tiling being
taken from lesson 24's build log; the claim held exactly. **All four cross-checks agree** — folios,
worked Examples, Check Your Understanding prompts and Figures all skip pages 554 through 561 in step
— **and the numbered-equation check is blind again, from the other side:** §13.2 carries no numbered
equation at all, so the first numbered equation anywhere in this source is 13.9, on its fifth page,
with nothing before it to compare. That is `PROJECT.md` §10's corrected rule earning its keep twice
in two days.

**Two real source defects found, each verified two ways, and neither is an arithmetic error.** (1)
§13.2's own magnitude recipe prints ε = |dΦ_m/dt| with no `N` while one of its two printed learning
objectives is the emf *in a coil*, and its own second example inserts the `N` by hand — an unstated
condition, and a cadet who follows the printed line onto the 20-turn coil is off by twenty. (2) Every
printed number downstream of the first worked example is carried from a rounded intermediate (flux
1.178 Wb printed as 1.2 Wb), so full precision gives 5.9 V and 0.59 A where the page prints 6.0 V and
0.60 A; carrying the printed 1.2 Wb reproduces every printed value exactly, which is what identifies
rounding rather than error as the cause. The artifact tells the tutor to treat a cadet quoting either
printed version as having read correctly.

**The direction work divided cleanly against lesson 24, as that build intended.** Lesson 24 probed
magnitude and rate of change only and left the whole of the sign here, so all four objectives are
first-class direction-and-field work and none re-probes flux, Faraday's law, motional emf or the
rod's energy balance — those are `prerequisites` and scoped as prior coursework. RHR-2 is named
explicitly on these pages and is used consistently with lesson 22's resolution, though run backwards
(thumb on the induced field, fingers giving the current); that is recorded rather than smoothed over.

Also updated: `courses/phys-215/artifacts/BUILD-LOG.md` (full lesson 25 section; lesson 25 moved from
queued to built in both the status summary and the current-run queue; the 24/25 tiling note marked
independently re-verified; the cross-cutting pacing note re-audited across all sixteen artifacts) and
`.ai/instructions/PROJECT.md` §10, whose artifact counts had gone stale over the lessons 22 and 24
builds and which my change made more wrong — it now says seventeen artifacts exist, thirteen are
published, and the four drafts have never been through a parser.

**Verification, stated plainly because silence reads as "tested": the only verification this artifact
got was `python scripts/artifacts/check_artifact.py` (48 passed / 0 failed — 37 base checks plus 11
`--forbid` guards proving no lesson-24 objective key, slug stem, slug suffix `8cbe647d`, component
name, filename stem, page range or source filename survived the rebase) plus reading the file.** That
is **not** a syntax check — there is no JSX parser on this machine and `node --check` passes invalid
JSX silently (`PROJECT.md` §9). **The Claude session that publishes is the parser, and this artifact
has not been through one.** All five pacing strings were grepped and confirmed to say 2, and every
extension-problem number was computed and independently re-derived in Python by a second route.

**What was deliberately NOT done:** no other artifact was modified — in particular the nine published
artifacts whose *"its 3 min budget"* line still contradicts their own `PER_TOPIC_BUDGET_MIN = 2.0`
were left alone (re-audited and recorded, not touched: editing this repository does not change a
published artifact, and a rebuild would mint a new slug and a new lesson row). The known stale
tritium example in every artifact's `VERIFICATION PROTOCOL` block was left alone; it is a
cross-cutting change to the structural base, not a per-lesson edit. Nothing under `preflight-kit/` or
`.claude/skills/` was touched. **The artifact is a DRAFT: it has not been reviewed by recker, has not
been published, and is not marked ready for students** (`CORE.md` §6). Lessons 26, 28 and 29 remain
queued and were not started.

---

## 2026-08-05 — recker via Claude Code

**Corrected the PDF hole-detection rule in `PROJECT.md` §10. It was stated in a form that would have
licensed dismissing a real four-page gap.** The row said a hole *"shows up as all four skipping in
step, and nothing else finds it"* — folios, numbered equations, worked Examples, Check Your
Understanding. The lesson 24 build disproved the conjunction: its source jumps printed pp. 550–553
and folios, Examples, CYU and Figures all skip together, **but the numbered equations run 13.1 → 13.4
unbroken, because the excised section contains no numbered equation.** An equation-only check calls
that source contiguous.

The rule now reads: **the folio sequence is the authority, the others are corroboration, and a break
in any single sequence is a hole until disproved.** Requiring all four to agree is the failure mode,
not the test. Also added the distinction the same build surfaced — **a gap may be a chapter split
rather than a hole.** Those four pages are not missing from the corpus; they are in lesson 25's PDF,
and the two files tile printed pp. 546–565 with no overlap. That is a seam for the next build to
coordinate against, not content to warn the tutor about, and the two calls for different responses.

**Bumped `reviewed` to 2026-08-05 for `.ai/patterns/python.md` and
`.ai/skills/project-bootstrap/SKILL.md`.** Both were flagged by `check_doc_sources.py` on the
PROJECT.md edit and both were re-read against it rather than date-bumped on faith: the edit changes a
source-inspection procedure and touches neither the Python dependency policy nor the `docs/`
taxonomy. python.md in particular already records `pymupdf` correctly — installed on this machine,
and explicitly *not* a permitted dependency for anything under `scripts/`.

**Deliberately NOT done:** no artifact was built or changed in this commit. The nine published
artifacts carrying the wrong fourth pacing string are still unfixed and still recker's call. The
stale tritium example in the `VERIFICATION PROTOCOL` block of all fifteen artifacts is recorded and
unfixed — it belongs in the structural base, not in one lesson. Lessons 26, 28 and 29 are still
queued; 30–41 remain blocked.

**Verification:** the three gate checks, and reading each flagged document against the change. No
artifact check applies — no artifact changed.

---

## 2026-08-05 — recker via Claude Code (twenty-fourth run)

**Built the PHYS 215 lesson 24 preflight — *Faraday's Law of Induction, Motional EMF*.** Third of the
seven-lesson second run. `courses/phys-215/artifacts/lesson_24_preflight_faradays_law_of_induction_motional_emf.jsx`,
slug `lesson-24-faradays-law-of-induction-motional-emf-8cbe647d`, component `Lesson24Preflight`,
**4 probe topics × ~2 active min**. It is a **DRAFT**: an agent built it, `CORE.md` §6 reserves
student-readiness to a human, and recker has not reviewed it. **It is not published and must not be
treated as ready.**

**Grounding: OpenStax Vol. 2 ch. 13, printed pp. 546–549 and 554–561** — §13.1 *Faraday's Law*, the
closing lines of one worked example, and §13.3 *Motional Emf*. Twelve pages of the real PDF,
rasterised at 150 dpi with PyMuPDF and read as images, because the equations in this corpus are vector
paths that every text extractor silently drops (`PROJECT.md` §9). Three regions were re-rendered at
350–500 dpi to settle specific questions.

**The source has a four-page hole in the middle, and it is deliberate.** Printed folios run 546–549
and then jump to 554: **pp. 550–553 are absent, and what is absent is §13.2 *Lenz's Law*, which is
lesson 25's topic.** Verified as a deliberate chapter split rather than corpus damage by opening
lesson 25's grounding PDF, which holds exactly pp. 550–553 and then 562–565 — **the two files tile
printed pp. 546–565 with no overlap and no gap.** Four cross-checks skip in step (folios, worked
Examples, Check Your Understanding prompts, Figures) and **a fifth does not: the numbered equations
run 13.1 → 13.4 unbroken, because §13.2 carries no numbered equation.** An agent checking only the
equation sequence would have called this source contiguous. Both outer edges are clean; the
resumption at p. 554 opens mid-worked-example, the mirror image of the lesson 21 → 22 seam.

**The sign was split against lesson 25 deliberately, and the split is recorded so 25 does not
duplicate it.** Faraday's minus sign *is* Lenz's law, so this artifact **probes magnitude and the
rate-of-change structure only** — no objective key touches direction and no probe asks a cadet to
predict which way a current flows. Lenz's law is scoped **engage-only and generously**: the source
prints a fully worked opposition argument inside Example 13.5(a) without ever naming the rule, and
the tutor may use it as printed, confirm a cadet who raises the rule from their own Cengage reading,
and then hand it forward.

**One real source error, verified two ways:** the only printed appearance of μ₀ gives its units as
`T·m/s` where they are `T·m/A` — read off a 500-dpi rendering, and settled dimensionally (T·m/A gives
volts and reproduces the printed `1.2 × 10⁻⁵ V`; T·m/s does not give volts). The number is right and
the label is wrong. Two further wording defects: Figure 13.4's caption calls an antiparallel
orientation the "highest possible" flux when it is the most negative, and Example 13.5 switches the
rod-length symbol from `r` to `l` inside its own Significance. Nine further notation caveats recorded.
**All four printed numerical results reproduce exactly.**

**Verification — this is the whole of it, stated plainly because silence reads as "tested".** The
artifact was checked with `python scripts/artifacts/check_artifact.py`, **47 passed / 0 failed** (37
base checks plus **10 `--forbid` guards** proving no lesson-22 objective key, slug stem, slug suffix,
component name, page range or source filename survived the rebase), and it was read. **That is all.**
`check_artifact.py` is **not a syntax check** — there is no JSX parser on this machine and publishing
is what parses the file (`PROJECT.md` §9). No cadet has run a session, and the `d`-payload submit hop
remains unproven for every artifact in this repository. Every extension-problem number was computed
and independently re-derived in Python, and the five pacing strings were grepped and confirmed to all
say 2 — including the *"about its 2 min budget"* line that was wrong in ten earlier artifacts.

**What was deliberately NOT done:**

- **Nothing was published or registered.** The artifact is a draft; publication is recker's, gated by
  [`safe-change`](.ai/skills/safe-change/SKILL.md).
- **No other artifact was touched.** The `VERIFICATION PROTOCOL` block in the tutor prompt still
  carries a tritium/nuclear-physics example inherited from PHYS 310's structural base, present in all
  fifteen PHYS 215 artifacts. It is verbatim-copied text, behaviourally harmless, and recorded in the
  build log rather than fixed — a fix belongs in the base, not in one lesson.
- **Lesson 25 was not built**, and neither was any other queued lesson. Only 24.
- **No build step, dependency, or tooling was added**, and nothing under `preflight-kit/` or
  `.claude/skills/` was edited.
- **The three unanswered Check Your Understanding prompts were answered in the grounding reference
  and marked as computed here**, never as quotations from the source.

Files: the new `.jsx`; `courses/phys-215/artifacts/BUILD-LOG.md` (lesson 24 section, status summary,
current-run queue, and a new subsection recording how lessons 24 and 25 tile the chapter); this file.

---

## 2026-08-04 — recker via Claude Code (twenty-third run)

**Built the PHYS 215 lesson 22 preflight — *Ampère's Law, Gauss's Law in Magnetism*.** Second of the
seven-lesson second run. `courses/phys-215/artifacts/lesson_22_preflight_amperes_law_gausss_law_in_magnetism.jsx`,
slug `lesson-22-amperes-law-gausss-law-in-magnetism-bd81d7d5`, component `Lesson22Preflight`,
**4 probe topics × ~2 active min**. It is a **DRAFT**: an agent built it, `CORE.md` §6 reserves
student-readiness to a human, and recker has not reviewed it. **It is not published and must not be
treated as ready.**

**Grounding: OpenStax Vol. 2 ch. 12, printed pp. 514–524** — the closing half of §12.4 (one page),
§12.5 *Ampère's Law*, and §12.6 *Solenoids and Toroids*. Eleven pages of the real PDF, rasterised at
150 dpi with PyMuPDF and read as images, because the equations in this corpus are vector paths that
every text extractor silently drops (`PROJECT.md` §9). Figure 12.18 was re-rendered at 400 and
700 dpi to read its current directions arrowhead by arrowhead. **No interior hole:** printed folios
514–524, equations 12.20–12.32, Examples 12.5–12.9 and Check Your Understanding 12.5–12.7 all run
unbroken, and all four are continuous with lesson 21's, so the two PDFs abut exactly as that build
predicted. **All four printed numerical results reproduce exactly** — no arithmetic slip anywhere in
this source, the first such in three lessons.

**What the source does not contain, and what the artifact does about it:**

- **Gauss's law in magnetism is in the lesson's title and is almost absent from the grounding.** The
  cadets read Cengage 29.3–29.5 and 29.5 is that topic; **the OpenStax pages have no section on it** —
  one printed sentence inside a symmetry argument, saying that field lines close on themselves so the
  net flux through any closed surface is zero. That sentence is Tier-1 and load-bearing (it is what
  rules out a radial field), so the artifact carries a dedicated block stating exactly what may and
  may not be said, scopes it **engage-only**, and gives it **no objective key** — a probe topic on
  one sentence would be the lesson 5 situation, and that needed an explicit instructor authorization
  that does not exist here.
- **The PDF opens mid-worked-example**, on Example 12.5's Strategy and Solution whose *statement* is
  in lesson 21's PDF, so two of its numbers appear from nowhere; and **it stops mid-sentence** inside
  the toroid derivation, so `B = mu0*N*I/(2*pi*r)` is not printed. Both are in `GAPS IN THE SOURCE`,
  which forbids treating the example as self-contained and licenses deriving the toroid result in
  front of the cadet from the two printed ingredients while saying that is what it is doing. §12.7
  *Magnetism in Matter* is absent entirely.
- **The right-hand-rule naming resolves.** These pages name exactly one rule by number — step 2 of
  the Problem-Solving Strategy says the *field* comes from **right-hand rule 2** — and `RHR-1` does
  not appear anywhere in this source. That agrees with lesson 21's figure caption and makes p. 506's
  "right-hand rule 1" the outlier, so **RHR-2 = the field a current makes** is the convention adopted.
  A cadet quoting either number from either week is treated as having read correctly.
- **One real typesetting error and one unstated condition**, both verified two ways: a closed-integral
  symbol printed around a quantity the equation one line above already defined as the value of that
  integral; and "the field is zero outside the solenoid" stated flatly while the source itself admits
  three pages later, for the toroid, that a helical winding leaks a little field.

**Verification — this is all it got, and saying so is the point.** `check_artifact.py` **46 passed /
0 failed** (37 base + **9 `--forbid` guards** proving no lesson-21 objective key, slug suffix,
component name, page range or source filename survived the rebase), plus reading the file. **That is
not a syntax check and must not be read as one** — there is no JSX parser on this machine and
publishing is the parser (`PROJECT.md` §9). No test suite was run because none exists. The physics was
checked separately: every source number and every extension-problem number was computed and
independently re-derived by a second route in Python.

**Found and deliberately not fixed: a fourth pacing string, wrong in ten of the thirteen earlier
artifacts.** `grep -c "its 3 min budget"` returns 1 in *every* PHYS 215 `.jsx` — correct for lessons
13, 15 and 20 (3 topics × ~3 min after recker's review) and **contradicting five other statements in
the same prompt** for the other ten. The earlier cross-cutting fix caught three strings per artifact
and missed this one. **Lesson 22 was built with it set to 2. Nothing else was touched** — twelve of
the thirteen are published, and editing this repository does not change a published artifact. Lesson
21 is an unpublished draft and could be fixed for free; it was left alone because this run's scope
was lesson 22. Recorded in `BUILD-LOG.md` under "Cross-cutting fixes" for recker to rule on.

**Deliberately not done:** no other lesson was built (21 is already a draft; 24, 25, 26, 28 and 29
remain queued); nothing was published or registered; no artifact was marked ready for students; no
frozen contract, nothing under `preflight-kit/`, and no `.claude/skills/` stub was edited; no build
step or dependency was introduced; the artifact was **not** parsed, because nothing here can parse it.
**One judgement call to flag:** the slug transliterates *Ampère* to `ampere` rather than collapsing
the accented letter to a hyphen, since contract §3.2 permits `a-z0-9-` only. The reasoning is in the
file's own slug comment; the corpus already spells the source PDF's filename that way.

Files: `courses/phys-215/artifacts/lesson_22_preflight_amperes_law_gausss_law_in_magnetism.jsx` (new),
`courses/phys-215/artifacts/BUILD-LOG.md` (lesson 22 section, status summary, queue row, and the
cross-cutting pacing note).

---

## 2026-08-04 — recker via Claude Code (twenty-second run)

**Built the PHYS 215 lesson 21 preflight — *Sources of Magnetic Fields*.** First of the seven-lesson
second run. `courses/phys-215/artifacts/lesson_21_preflight_sources_of_magnetic_fields.jsx`, slug
`lesson-21-sources-of-magnetic-fields-85e63bf8`, component `Lesson21Preflight`, **4 probe topics ×
~2 active min**. It is a **DRAFT**: an agent built it, `CORE.md` §6 reserves student-readiness to a
human, and recker has not reviewed it. **It is not published and must not be treated as ready.**

**Grounding: OpenStax Vol. 2 ch. 12, printed pp. 502–513 — §12.1 Biot-Savart, §12.2 the thin
straight wire, §12.3 the force between two parallel currents, §12.4 the current loop.** Twelve pages
of the real PDF, rasterised at 150 dpi and read as images because the equations in this corpus are
vector paths that every text extractor drops silently (`PROJECT.md` §9). Nineteen numbered equations,
eleven figures, five worked Examples and four unanswered Check Your Understanding prompts
transcribed off the rasters; two figures and two disputed sentences re-rendered at 350–400 dpi.

**No interior hole — checked four ways and all four agree:** folios 502–513 across twelve pages,
equations 12.1–12.19, Examples 12.1–12.5, Check Your Understanding 12.1–12.4, none skipping. That
check was run precisely because two of the first twelve sources were missing a block out of the
*middle* with nothing in the prose to reveal it.

**The lesson 22 boundary is now established, and it falls inside a worked example.** This PDF stops
after the *statement* of Example 12.5 on p. 513; `Ampere's Law, Gauss's Law in Magnetism.pdf` opens
on p. 514 with that same example's figure and Strategy and runs to p. 524. **The two abut exactly —
no overlap, no gap.** Verified by opening both PDFs rather than inferred from their filenames,
because the corpus is known to contain at least one file that is a byte-identical subset of another.

**Four source defects recorded rather than silently corrected, each verified two ways**, plus eight
notation caveats. The structural one is the **third and worst instance of the right-hand-rule
inconsistency this corpus has produced**: p. 506 calls the rule that gives the *field* "right-hand
rule 1", and three pages later a figure caption assigns RHR-2 to the field and RHR-1 to the *force*.
Today the cadet needs both rules in one conversation, so the tutor is instructed to ask which
*question* is being answered rather than argue about the number, and to treat a cadet who quotes
either naming as having read the book correctly. Also: a field printed as `3 × 10⁻⁵ T` and used as
`2.83 × 10⁻⁵ T` two lines later; a final answer printed as `8 × 10⁻⁵ T` where the source's own
components give `8.49 × 10⁻⁵ T`; "a flat coil of N loops **per length**", where N is a pure count of
turns; and a figure captioning two angles the derivation never uses.

**Verification — this is all the artifact got, and saying so is the point.**
`check_artifact.py` reported **45 passed / 0 failed** (37 base + 8 `--forbid` guards proving no
lesson-19 objective key, slug suffix, section title or prior-material block survived the rebase onto
lesson 19's structure), and the file was read. **That is not a syntax check and must not be read as
one** — there is no JSX parser on this machine and publishing is the parser (`PROJECT.md` §9), so
this artifact has **never been parsed**. Every number in the four extension problems and every claim
that the source is wrong was computed and re-derived a second way in Python; the source's own printed
answers were re-verified too.

**Recorded:** a full lesson 21 section in `courses/phys-215/artifacts/BUILD-LOG.md` (objectives,
probe topics, slug, source findings, open questions, the lesson 22 boundary), lesson 21 moved from
**queued** to **built** in both the status summary and the current-run queue table, and two stale
sentences in `PROJECT.md` §10 corrected — it asserted "thirteen artifacts exist and all thirteen are
published", which a fourteenth unpublished draft makes false in the direction that matters.

**Deliberately NOT done.** No other lesson was built — 22, 24, 25, 26, 28 and 29 remain queued.
Nothing under `preflight-kit/` or `.claude/skills/` was touched, and no contract was edited. **The
artifact was not published, not registered, and not marked ready for students** — all three are
recker's. Four topics were kept rather than three: the question was asked deliberately, because
recker's review dropped a peripheral fourth objective in three of four lessons, and the answer here
is that each of the four is its own printed section with its own printed learning objectives inside
the cadets' two assigned Cengage sections. Pacing therefore stays at the profile default and all four
places that state it agree on ~2 min. No `texts/` corpus was added and nothing was reconstructed from
model knowledge — PHYS 310's exception stays scoped to PHYS 310.

---

## 2026-08-04 — recker via Claude Code (twenty-first run)

**Opened a second PHYS 215 build run and wrote its queue into `BUILD-LOG.md`.** Doc-only; no artifact
was built or changed in this commit.

**The queue is seven lessons — 21, 22, 24, 25, 26, 28, 29** — derived from the schedule rather than
assumed: of 41 lessons, 37 are `PF=Y`; twelve are built and published; 2 and 3 are already done
outside this repository; 16 is deferred; 6/11/17/27/34/38 are labs; 12/23/35 are Graded Reviews; and
30–41 stay blocked. The queue lives in the repository rather than in a session, because `CORE.md` §0
means an uncommitted queue is one the next session cannot find.

**Answered the factual half of the lesson 30–41 grounding question, and deliberately did not act on
it.** `PROJECT.md` §10 blocked those twelve on an unverified suspicion that they need OpenStax Vol. 3
while the profile names Vol. 2. Opening the PDFs and reading their first printed section headings
confirms it: lesson 30's source is §16.2, Vol. 2's last chapter, while lesson 31's is §1.1 and lesson
41's is §6.1 — both Vol. 3. **The boundary is between lessons 30 and 31, not at 30, and no source is
missing** — a topic-matched PDF exists for all twelve. So the profile's "Vol. 2" is incomplete rather
than wrong. **The block stands.** `PROJECT.md` names recker as the owner of that decision, and
answering the question is not making the call; what changed is only that the stated reason for the
block no longer holds.

**Recorded that `Vector Form of Coulomb's Law.pdf` is a byte-identical subset of `Electric Charge,
Coulomb's Law.pdf`** (its five pages equal pages 10–14 of the larger file, printed pp. 179–183,
§5.3). Neither lesson is being built, so this is inert today. It is kept because the corpus contains
overlapping files whose names suggest distinct sources, and a future agent matching topic to PDF by
name could ground two lessons in the same five pages without noticing.

**A lesson 2 build was started and cancelled mid-run.** recker stopped it on learning lessons 2 and 3
already exist. The agent had written `lesson_02_preflight_electric_charge_coulombic_force.jsx` and
part of a build-log section; **both were snapshotted to the session scratchpad first, then removed,
and nothing from that run was committed.** The build log now carries an explicit warning against
rebuilding either lesson — a rebuild is not a harmless duplicate, because contract §3.2 mints a fresh
8-hex suffix, so it would register as a *new* lesson row rather than replacing the live one and
cadets would face two.

**Deliberately NOT done:** no artifact built, none published, none registered; lessons 30–41 not
built; lesson 16 not built and still has no source in the corpus; the profile's grounding line still
says Vol. 2 and was not edited, because naming both volumes presumes the decision recker owns. The
Supabase registration check from the previous run is still unrun — no credential exists on this
machine.

**Verification:** the three gate checks, plus reading the diff. `git diff --stat` was read before
staging to confirm the CRLF-preserving edit did not rewrite the file (76 insertions, 9 deletions, 0
bare LFs). No artifact check applies — no artifact changed.

---

## 2026-08-04 — recker via Claude Code (twentieth run)

**Generated the twelve DFPM prefill links, and recorded the published artifact URLs.** recker
published all twelve PHYS 215 artifacts from Claude sessions and handed over the public URLs; this
run turned each into a registration link and wrote the URLs into the repository.

**The links.** One per lesson — 4, 5, 7, 8, 9, 10, 13, 14, 15, 18, 19, 20 — built per
`preflight-kit/contracts/INTERACTION-PREFILL-LINK.md` and `docs/operations/PREFILL-LINK.md`:
base `.../site/faculty/lessons.html`, `new=1`, `course=phys-215`, `policy=interaction`, `pub=0`
(draft — recker publishes from the site), `num=<lesson>`, and `title` lifted from the artifact's own
cadet-facing header so the site row and the on-screen header cannot disagree.

**Every `id` was read out of the source file, never re-derived.** That is the single failure the
runbook exists to prevent: `INTERACTION-DATA-CONTRACT.md` §3.2 mints an 8-hex suffix once per build
and nothing can regenerate it, so a re-slugified `id` produces a plausible link whose reports the
receiver silently discards. The generator (scratchpad, not committed — it is a one-shot over values
now recorded in `BUILD-LOG.md`) reads `const INTERACTION_ID` from each `.jsx`, then refuses to emit a
link unless the id matches `[a-z0-9-]+-[0-9a-f]{8}` **and** begins `lesson-<NN>-`, which is this
course's required form and PHYS 310's forbidden one. All twelve were also cross-checked against the
slugs already recorded in `BUILD-LOG.md`; all matched.

**Recorded in `courses/phys-215/artifacts/BUILD-LOG.md`:** a `Published` row on every lesson table
carrying the date and the public URL, and every `Status` row moved from DRAFT to
`PUBLISHED 2026-08-04 … registration pending`. **The published URL exists nowhere else** — it is not
derivable from the source and is the only pointer from a lesson back to the exact build a cadet runs,
so leaving it in a chat transcript would have lost it (`CORE.md` §0). The file's banner was rewritten:
it claimed none of these had been published and that no JSX in this repository had ever been parsed,
and both are now false.

**`PROJECT.md` §10 updated in the same commit**, per its own rule. Thirteen artifacts now exist and
**all thirteen are published**, so every artifact here has been parsed — publishing is the parser
(§9), and twelve clean publishes are twelve clean parses. That retires the standing worry that this
repository emits JSX nobody has ever checked.

**Deliberately NOT done:**
- **Nothing was registered.** Saving a lesson row on the DFPM site is recker's click; the links only
  prefill a form and write nothing on their own.
- **No artifact was edited, rebuilt, or re-published.** The twelve published builds are exactly the
  reviewed ones, and their slugs are unchanged — an edit now would desynchronize a live artifact from
  the row about to point at it.
- **`policy=interaction` is an assumption, flagged to recker, not a verified fact.** It asserts these
  are artifact-only lessons with no written free-response half. `choice` is the alternative and the
  form shows the value before Save.
- **`course_id: phys-215` is still unconfirmed on the receiver**, and so is `grade_weight_note`. Both
  remain open in `CORE.md` §8 and in the build log's own pre-ship list.
- **No `d` payload has still ever reached the receiver.** Publishing thirteen artifacts did not test
  the submit hop; it just put thirteen artifacts on top of it.

**Verification:** the twelve links were generated mechanically and their ids re-verified against
`grep -n INTERACTION_ID` over the artifact directory. `BUILD-LOG.md` was edited byte-mode
(`.gitattributes` marks `courses/** -text`) and `git diff --stat` read before staging — 47 insertions
/ 23 deletions across one file, proportional to twelve added rows and twelve changed ones, so no
line-ending rewrite. The three gate checks were run. **Nothing was parsed, run, or submitted by this
repository; the publishing recker did in Claude sessions is the only execution any of this JSX has
had.**

## 2026-08-04 — recker via Claude Code (nineteenth run)

**Applied recker's review of the twelve PHYS 215 artifacts.** He read
`courses/phys-215/artifacts/BUILD-LOG.md` and ruled per lesson. **Eight passed unchanged — 4, 7, 8,
9, 10, 14, 18, 19.** Four were revised in place:

- **Lesson 5** — *"objective 1 and 2 are good. We do not discuss 3 or 4. Add in some kinematics
  discussion."* The two dipole topics (`dipole-torque`, `induced-dipole`) were replaced by
  `trajectory-component-separation` and `charge-to-mass-and-time-in-field`.
- **Lessons 13, 15 and 20** — objectives 1–3 good, drop 4. `induced-charge-field`,
  `series-parallel-limits` and `torque-from-moment-arms` respectively.

**No slug was re-minted, and that is deliberate.** Contract §3.2 makes a rebuild a *new* `activities`
row, but none of these has been published or registered, so there is no row to desynchronize and no
cadet-visible identity to preserve. The four `INTERACTION_ID`s are byte-identical to what
`BUILD-LOG.md` already lists, so **the registration slugs in that log are still correct** and nothing
recker copied out of it has gone stale.

**Dropped material was not deleted — it was demoted to engage-only.** In all four artifacts the
removed content stays fully transcribed in `TEXTBOOK_REFERENCE` (deleting it would make the grounding
reference lie about the attached PDF) and moves into `scope_note`: the tutor engages fully and
confidently if a cadet raises it, never initiates it, and **never reports on it — it has no objective
key, so it cannot reach the `d` payload or the cohort rollup.** That is how every other scoped-out
block in these artifacts is already handled, and it is the honest option, because the material is
still in the cadets' own assigned reading.

**Lesson 5 is now the only artifact in the corpus that probes material its grounding does not
contain.** The PDF has no single-particle kinematics at all — that mismatch was flagged at build time
and is why the original build produced dipole topics. Topics 3 and 4 therefore run on recker's
standing kinematics ruling: `F = qE` and `E = sigma/eps0` stay strictly Tier 1 from the PDF, while the
trajectory, the component separation, the `1/v²` scaling and the `q/m` argument are cited as *"from
your earlier coursework"*. **The topic text and the `scope_note` both forbid** attaching a section,
figure or example number to a kinematic result, or saying today's material shows a trajectory. The
authorization is recorded in the file itself rather than inferred.

**Extension problem C was rewritten** (it was the dipole-torque problem): a proton and an electron
released from rest in the same field. Every number computed and verified here — `a_e/a_p = 1836.2`
which is exactly `m_p/m_e`; the electron crosses **43** times sooner, not 1836, because
`sqrt(1836) = 42.85`; the proton reaches `1.9573e5 m/s` by kinematics **and** by work-energy without
passing through the acceleration; and `a_p/g = 1.95e11`. Pass 2 takes the ratio symbolically, so `E`
and `q` cancel before any arithmetic.

**A pacing contradiction was closed in the same pass.** Three topics at ~2 min is ~6 minutes against a
header that still promises "about 10 minutes", and recker dropped one objective, not a third of the
session — so lessons 13, 15 and 20 moved to ~3 min per topic. `PER_TOPIC_BUDGET_MIN`, the
`time_budget` block, the PACING sentence in the tutor prompt and the constants' comments all moved
together, so the tutor is never told two numbers at once. Same failure mode as the earlier
cross-cutting fix this day, which is why it was chased immediately. **Lesson 5 was left at 4 × ~2**,
because it kept four topics.

**Verification.** Lesson 5 at 40/40 under `check_artifact.py` (37 base + 3 `--forbid` guards proving
no dipole objective key survived); lessons 13, 15 and 20 at 38/38 each (37 base + 1 guard on the
dropped key). Delimiter balance holds in all four, which is what makes the block deletions
trustworthy. Both edit scripts ran **byte-mode and dry-run first**, and `git diff --stat` was read
before staging — 231 insertions against 206 deletions across four files, proportional to the change
rather than the whole-file rewrite a text-mode read produces here (`PROJECT.md` §9).

**Deliberately not done:** **nothing was published or registered** — all twelve remain drafts, and
publishing is gated on recker asking for that specific run. **No JSX was parsed**, because nothing on
this machine can parse it; `check_artifact.py` is not a syntax check and publishing is what actually
compiles these. **No probe order was changed** — recker approved 1–3 as they stand, so lesson 20's
`torque-angle-from-normal` is now last despite being the day's most common failure; that is flagged in
the log rather than silently corrected. **Lesson 16 was not touched** and still has no grounding
source. And **`course_id: phys-215` is still unconfirmed on the receiver**, which fails silently.

## 2026-08-04 — recker via Claude Code (eighteenth run)

**Built PHYS 215 lessons 19 and 20 — the run's target of "through lesson 20" is met.**
`lesson-19-magnetic-force-on-current-carrying-wires-4a147cca` and
`lesson-20-magnetic-dipoles-and-torque-3190fefe`, both green at 45/45 under `check_artifact.py`.
Grounded in OpenStax Vol. 2 §11.4 (printed pp. 474–478) and §11.5 (pp. 479–480). **Built by two
subagents running in parallel** — the first time this run overlapped two builds; each was told the
other existed and to write only its own file. Verification, the objective-key and slug review, the
log and the commits stayed on this side.

**Twelve artifacts now exist for PHYS 215: lessons 4, 5, 7, 8, 9, 10, 13, 14, 15, 18, 19, 20.** Labs
6, 11 and 17 and Graded Review 12 have no preflight; lesson 16 is deferred and has no source.

**Lesson 20's grounding is the weakest in the corpus and that is worth saying plainly.** Two printed
pages, **zero worked examples**, zero Check Your Understanding prompts, and it stops mid-sentence one
line before the section's own punchline — `tau = mu x B` **is not in it.** The equation is admitted as
a derived result: the printed torque and dipole-moment equations give the magnitude in one
substitution, and the build additionally confirmed by direct computation that `mu x B` reproduces the
printed vector equation exactly, sign and all. The tutor derives it in front of the cadet and is
forbidden from claiming to quote it. **If a fuller excerpt of that section exists, this is the lesson
to re-ground first.**

**Lesson 18's recorded gaps turn out to be fillable, discovered only afterwards.** The first page of
lesson 19's PDF carries the three things lesson 18's grounding records as absent — the Significance of
its beam-deflector example, its second Check Your Understanding, and **a complete worked example of
helical motion.** Lesson 19 transcribed them into a fenced prior-lesson block and forbids initiating
them, so nothing is lost pedagogically, but lesson 18 would be better grounded if rebuilt with both
PDFs attached. **That is recker's call, because a rebuild mints a new suffix and therefore a new
lesson row** (contract §3.2). Recorded in `BUILD-LOG.md`.

**The three magnetism PDFs abut exactly** — 466–473, 474–478, 479–480, one continuous run with no
overlap and no gap.

Notable source defects, both re-verified: lesson 19's Example 11.5(b) states the field as "30 degrees
from the +x-axis" for a wire along +y, so the angle in the sine is **60°** — the printed answer
reaches it as `cos 30°`, but a cadet substituting `sin 30°` is off by a factor of 1.73, and probe
topic 2 is built on it. Lesson 20 has **an intermediate derivation line that no reading makes
correct**; the printed line before it and the final equation were independently confirmed right by
taking moments, so only the middle line is wrong and a cadet who cannot make it come out is not
erring. Lesson 20 also had a figure glyph that looked like a third length label at 900 dpi and
resolved at 2000 dpi as the current symbol — a fabricated dimension avoided by re-rendering.

**Brought `PROJECT.md` §10 back into agreement with reality**, in a follow-up commit rather than the
same one — the artifact commit had already landed, and leaving the reference wrong for even a session
is exactly the rot §10's own note warns about. Its PHYS 215 row still said *"No artifact has been
built for it from this repository."* It now records the twelve, points at `BUILD-LOG.md` as the place
the per-lesson findings live, and carries two new rows earned across this run: **the grounding PDFs
have holes that nothing in their prose reveals** (with the four-way folio/equation/Example/CYU
cross-check that is the only thing which finds them), and **the sources contain real errors the
artifacts deliberately record** (with the rule that a cadet quoting a wrong printed version has read
the book correctly). `check_doc_sources.py` flagged `python.md` and `project-bootstrap/SKILL.md` as
downstream of the change; both were re-read and are unaffected — the edit touches neither the
dependency policy nor the docs taxonomy.

**Not done:** nothing published, registered, or marked ready for students; all twelve remain drafts
and no JSX has been parsed. Lesson 19's endpoint theorem and lesson 20's `tau = mu x B` both lean on
the "printed equations determine it in one line" allowance harder than earlier lessons did — both are
flagged in `BUILD-LOG.md` with the specific parts to cut if that reading is too generous. The Cengage
mapping is unverified for every lesson. `course_id: phys-215` is still unconfirmed on the receiver and
`grade_weight_note` still reaches cadet-facing prose unchecked.

---

## 2026-08-04 — recker via Claude Code (seventeenth run)

**Built PHYS 215 lesson 18 — Moving Charged Particle in a Magnetic Field**, slug
`lesson-18-moving-charged-particle-in-a-magnetic-field-cd95f8b3`. Green at 45/45 under
`check_artifact.py`. Grounded in OpenStax Vol. 2 §11.2–§11.3 (printed pp. 466–473, contiguous);
9 numbered equations, 7 figures with the geometry described concretely, 2 worked Examples transcribed
off 150-dpi rasters. Built by a subagent; verification, the objective-key and slug review, the log
and the commit stayed on this side.

**This is by far the thinnest source in the corpus — 8 pages against 17–31 for every other lesson.**
It grounds four topics honestly and it is contiguous, but it truncates at the last arithmetic line of
its second worked Example: no helical worked example, and **no worked example that ever puts a number
into `r = m*v/(q*B)`**. Recorded in `BUILD-LOG.md`; if a longer excerpt exists this lesson would
benefit from it more than any other built so far.

**The source states the right-hand rule three different ways and never acknowledges it** — one
version puts the thumb on the force, another puts the thumb on the velocity, and a third omits the
field entirely. Probe topic 1 is built on that. Six further caveats recorded, the sharpest being a
printed `34°` that is a **reference angle rather than a direction** (both components are negative, so
the true standard-position angle is `213.7°` — `arctan` cancelled both signs), and `q` meaning signed
charge in one equation and magnitude in three others, so a cadet substituting `−1.6e-19` gets a
negative radius.

**One apparent error was checked and recorded as correct**, because cadets will flag it: a negative
charge drawn circulating clockwise in a field into the page looks wrong until the rule's own
charge-sign reversal step is applied. The tutor is told to resolve it, not dismiss it.

**Recker's kinematics ruling was available and barely needed.** `F_c = m*v^2/r` is printed verbatim
and `T = 2*pi*r/v` appears inside a printed derivation, so both are Tier 1. Tier 2 covers only the
cross product's properties, the work–energy theorem, `K = ½mv²` and `F = qE` for contrast. No
electromagnetic content was reconstructed.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed. Helical
motion was scoped to the extension problems rather than given a probe topic — a judgement call
flagged for recker. `grade_weight_note` still reaches cadet-facing prose unconfirmed.

---

## 2026-08-04 — recker via Claude Code (sixteenth run)

**Built PHYS 215 lesson 15 — DC Circuit Analysis, Kirchhoff's Rules**, slug
`lesson-15-dc-circuit-analysis-kirchhoffs-rules-d9d8a7a3`. Green at 45/45 under `check_artifact.py`.
Grounded in OpenStax Vol. 2 chapter 10 §§10.1–10.3 (printed pp. 406–436); 6 numbered equations, 32
figures with circuit topology described concretely, 7 worked Examples and Table 10.1 transcribed off
150-dpi rasters. Built by a subagent; verification, the objective-key and slug review, the log and
the commit stayed on this side.

**Closed the lesson 16 question, and the answer is the unhelpful one.** `DC Circuit Analysis,
Kirchhoff's Rules.pdf` stops inside §10.3's "Multiple Voltage Sources" subsection — **RC circuits,
measuring instruments and household wiring are all absent.** It does not span the chapter, so
**lesson 16 has no grounding source anywhere in this corpus** and stays blocked on recker for one
rather than buildable from model knowledge. Recorded in `BUILD-LOG.md`.

**Two source defects land squarely on this lesson's core subject, and both were re-verified before
the claim shipped.** Example 10.7's prose says battery `V_1` "will be added" and `V_2` "will be
subtracted", while the equation it writes and solves rearranges to `I(R_1+R_2+R_3) = V_2 − V_1` — the
opposite assignment, and the one the figure's polarities give. The sentence is wrong; the equation is
right. On a lesson whose entire difficulty is sign conventions that is the worst possible place for
it, so probe topic 1 is built on it. Separately the same example's substitution line reads
`10.0 + 30.0 + 10.0 = 50.0` while its figure labels the third resistor `20.0` and its printed answer
`0.20 A` requires 60 — `12/50` is `0.24 A`, and every downstream power figure agrees with 60. A cadet
who types the printed denominator is not wrong.

Five further caveats recorded rather than normalized, including a power-balance line that evaluates
to 14 W as printed and 130 W once the source's own next sentence corrects the sign — independently
confirmed, since the dissipated total is `27+75+12+16 = 130 W`. One apparent error is recorded as
**correct**: the same resistor's drop is subtracted in one loop equation and added in the other, which
cadets will flag and which deserves resolving rather than dismissing.

**First source in three lessons with no missing middle block** — all four cross-checks run unbroken.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed. The Cengage
mapping remains unverified. The probe-topic priority puts series/parallel last despite it being ~40 %
of the reading — a judgement call, flagged in `BUILD-LOG.md` for recker to overturn.

---

## 2026-08-04 — recker via Claude Code (fifteenth run)

**Built PHYS 215 lesson 14 — Current, Resistance, and Electrical Power**, slug
`lesson-14-current-resistance-and-electrical-power-06497f19`. Green at 45/45 under
`check_artifact.py`. Grounded in OpenStax Vol. 2 chapter 9; 11 numbered equations, 17 figures, 9
worked Examples and Table 9.1 transcribed off 150-dpi rasters. Built by a subagent; verification, the
objective-key and slug review, the log and the commit stayed on this side.

**A second source with a hole in the middle, and this one hides better.** Printed pp. 366–370 —
§9.2 "Model of Conduction in Metals" — are absent, and **neither edge cuts a sentence**, so nothing
in the prose reveals it. Found from the folio sequence and confirmed by five independent cross-checks
skipping in step: equations 9.3 → 9.6, Examples 9.2 → 9.4, Check Your Understanding 9.2 → 9.4,
figures 9.5 → 9.12. **The folio check is now standard practice on every build** — after lesson 13 it
was a suspicion; after this one it is the only thing that catches this class of gap.

**The hole costs a probe topic and that is recorded rather than worked around.** `J = n*q*v_d`
survives on p. 371 with neither `n` nor `v_d` defined on any present page, so the tutor is forbidden
from discussing carrier densities, drift speeds or the conduction model, and is allowed exactly one
move: deriving the units of `n` from the printed equation while saying honestly that the definition is
not in its reference. The classic drift-velocity trap got no probe topic as a result.

**Two arithmetic errors in the source, both re-verified here before the claim shipped.** Example
9.10's Significance says an incandescent bulb "would last 1.08 years at 3 hours a day" — `1200/1095`
is `1.0959`. The slip is provable rather than arguable because the LED figure in the same sentence
(45.66 yr) uses the same divisor and is right: `50000/1095 = 45.662`. And its "$8.50 per year" savings
should be `$9.01`; `8.76 − 0.69 + 0.44 = 8.51` reproduces the printed figure exactly, so the
replacement costs were applied backwards. Nine caveats in total, including a signed/unsigned switch
mid-derivation that yields negative power if read literally, and a figure whose stated resistance is
the least-squares slope of deliberately noisy data rather than any single point's ratio — so a cadet
computing the endpoint value has not erred.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed. The Cengage
mapping remains unverified everywhere; here it is only *partially* consistent with the hole, so the
temperature-dependence material was scoped engage-only rather than excluded. `grade_weight_note`
("under 80 of 1000 course points") still reaches cadet-facing prose unconfirmed — it is inherited from
the pilot and `COURSE_PROFILE.md` asks for it to be checked before the first build.

---

## 2026-08-04 — recker via Claude Code (fourteenth run)

**Built PHYS 215 lesson 13 — Capacitance, Energy, and Dielectrics**, slug
`lesson-13-capacitance-energy-and-dielectrics-7444aa79`. Green at 45/45 under `check_artifact.py` on
the first run. Grounded in OpenStax Vol. 2 chapter 8; 13 numbered equations, 18 figures, 8 worked
Examples and Table 8.1 transcribed off 150-dpi rasters. Built by a subagent; verification, the
objective-key and slug review, the log and the commit stayed on this side. Lessons 11 and 12 are a
lab and a graded review, so lesson 10 was the structural base.

**The source has a six-page hole in the middle — the largest gap this corpus has produced.** Printed
pp. 333–338, the whole of §8.2 "Capacitors in Series and in Parallel", are absent, and the
surrounding prose gives no sign of it. Caught from the folio sequence and confirmed three ways: the
numbered equations jump 8.6 → 8.9, the worked Examples jump 8.3 → 8.8, the Check Your Understanding
prompts jump 8.4 → 8.6. The tutor is forbidden from stating any series or parallel rule or computing
an equivalent capacitance. **It is very probably deliberate rather than damage** — the excised
section is exactly the one the cadets' assignment skips (Cengage 25.3), so the excerpt looks cut to
match the reading. That correspondence is an inference and is recorded as one.

Two consequences of the hole, both handled: a three-panel network figure survives with **no caption
and no number** (its caption was on the missing pages) and was identified as Figure 8.14 by
cross-reference *and* by arithmetic, with the reference describing the panels while refusing to quote
a caption that does not exist; and Example 8.8 consumes results from the missing pages, so its
takeaway is scoped to "energies add" rather than to any combination rule.

**The defect that actually shapes a probe topic is an unstated condition.** The sentence introducing
Eq. 8.12 says without qualification that a dielectric makes the stored energy smaller by κ — true
only if the battery was disconnected, a condition the derivation smuggles in by substituting `Q_0`
for `Q`, and which the source corrects only in a Check Your Understanding seven printed pages later.
Probe topic 3 is built on it, and the tutor is told a cadet who says "energy always drops" read the
book correctly. Eight further defects are recorded rather than normalized, including two incompatible
induced-charge formulas printed under identical symbols.

**First PDF in this corpus that does not truncate at the end.** Stated explicitly in the reference so
nobody goes looking for a cut that is not there.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed. The Cengage
mapping remains unverified for every lesson built so far. Verification was `check_artifact.py`, the
three gate checks, and reading the affected regions.

---

## 2026-08-04 — recker via Claude Code (thirteenth run)

**Built PHYS 215 lesson 10 — Electric Potential, Potential Energy**, slug
`lesson-10-electric-potential-potential-energy-c627bfa9`. Green at 45/45 under `check_artifact.py`.
Grounded in OpenStax Vol. 2 §7.3–§7.5 (printed pp. 285–306); 10 numbered equations, 22 figures and
11 worked Examples transcribed off 150-dpi rasters. Built by a subagent; verification, the
objective-key and slug review, the log and the commit stayed on this side.

**Zero page overlap with lesson 9** — that build ran pp. 268–284 and this one starts at 285, exactly
adjacent. p. 285's opening lines complete the sentence lesson 9's PDF cut off mid-word, and the
completion is recorded here so the two artifacts join cleanly instead of both trailing off.

**This artifact tells the tutor the textbook is wrong in one place, and that claim was verified
independently before it shipped.** Figure 7.26 annotates the infinite-line field as
`lambda/(2*eps0) * (1/s)` while the solution text on the same page uses `2*k_e*lambda*(1/s)`. Since
`2*k_e = 1/(2*pi*eps0)`, the figure has dropped the pi and is pi times too large. Checked three ways
before accepting it: the raster read directly (the figure prints `2ε₀`), the two constants evaluated
(`5.65e10` vs `1.798e10`), and their ratio (`3.1407`). The tutor is told to use the text's form and
**to treat a cadet who quotes the figure as having read the book correctly rather than as having
erred** — which is the whole reason the caveat is worth carrying.

Six further source defects are recorded rather than normalized: a figure cited for a point charge but
drawn for a uniformly charged sphere, two figures sharing one caption, a garbled caption the tutor is
forbidden to guess at, the Coulomb constant written three ways with two values, one symbol named two
ways, and `ΔV` used as both signed difference and magnitude again. The last page truncates
mid-sentence and **Figure 7.40, referenced twice there, is absent** — the tutor derives the missing
conclusion from the printed `sigma_1*R_1 = sigma_2*R_2` and is forbidden from describing the figure.

**Deliberate scope exclusion, flagged because it rests on an unverified inference.** The probe topics
exclude the continuous-distribution examples and the dipole expansion — both Tier-1 today's content,
both fully transcribed in the grounding — because the cadets' assigned Cengage sections skip 24.5,
which the agent inferred is the continuous-distribution section from the standard chapter layout.
That was not checked against the actual Cengage table of contents. The tutor engages fully if a cadet
raises the material and simply does not initiate it.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed. The Cengage
mapping remains unverified for lessons 8, 9 and 10 alike. Verification was `check_artifact.py`, the
three gate checks, an independent re-read of the Figure 7.26 raster, and reading the affected regions.

---

## 2026-08-04 — recker via Claude Code (twelfth run)

**Built PHYS 215 lesson 9 — Electric Potential Difference**, slug
`lesson-09-electric-potential-difference-b3ba716f`. Green at 45/45 under `check_artifact.py`.
Grounded in OpenStax Vol. 2 §7.1 (pp. 268–274) and §7.2 (pp. 274–284), contiguous; 7 numbered
equations, 16 figures and 9 worked Examples transcribed off 150-dpi rasters. Built by a subagent;
verification, the objective-key and slug review, the log and the commit stayed on this side.

**The source's sign conventions contradict themselves in four places, and that is now written down
rather than smoothed over.** `W_12` is defined as the applied force's work on p. 268 and then
evaluated as the electric force's work on the next page; `V_AB` is a signed difference in the
derivation and a positive accelerating magnitude in the figures — Figure 7.14's caption prints
`E = -ΔV/d` while the annotation inside the same figure prints `E = V_AB/d`; Example 7.2's Strategy
sentence is a copy-paste error from Example 7.1; and the Coulomb constant appears as both `8.99e9`
and `9.0e9`. Probe topic 2 asks about signs directly, so a `SIGN AND NOTATION CAVEATS` block tells
the tutor which reading is self-consistent, and tells it to settle field direction from "the field
points toward lower potential" rather than from subscript order. The 8th-page truncation here is
harmless — it cuts commentary, not the result — and is recorded as such.

**Every number the source prints was re-verified, not just our own.** All nine worked Examples
reproduce exactly.

**Not done:** nothing published, registered, or marked ready for students. No JSX parsed —
`check_artifact.py` is not a syntax check. Cengage 24.1–24.2 was not verified against the OpenStax
span; the grounding is a superset of the topic, which is the safe direction, but a *wider* Cengage
section would leave part of the cadets' reading ungrounded. Verification for this run was
`check_artifact.py`, the three gate checks, and reading the affected regions.

---

## 2026-08-04 — recker via Claude Code (eleventh run)

**Built PHYS 215 lesson 8 — Gauss's Law and Its Applications**, slug
`lesson-08-gausss-law-and-its-applications-5f57cc30`. Green under `check_artifact.py` (45/45: 37 base
checks plus 8 `--forbid` guards against lesson 7 strings and against the *example* suffix printed in
`COURSE_PROFILE.md`, which is documentation and not a slug). Grounded in OpenStax Vol. 2 §6.2
(pp. 228–234) and §6.3 (pp. 234–245), contiguous; 9 numbered equations, 21 figures and 4 worked
Examples transcribed off 150-dpi rasters.

**First lesson built by a subagent**, per recker's suggestion at the end of the tenth run. The agent
did the rasterizing, transcription, authoring and splice in its own context and returned a summary;
verification, the objective-key and slug review, the log and the commit stayed on this side. It was
told explicitly not to run any writing git command, not to touch this file or `BUILD-LOG.md`, and not
to reconstruct grounding from its own physics knowledge.

**The source truncates mid-derivation and that is now handled explicitly.** p. 245 ends one algebraic
step short of the infinite-plane result, which is simply absent from the PDF. Rather than quote an
equation nobody can see, the reference carries a `GAPS IN THE SOURCE` block telling the tutor the
material stops there and instructing it to derive the last step in front of the cadet from Eqs. 6.11
and 6.12, both of which are printed. Two smaller source defects — the PDF opening mid-example, and
Example 6.5(d) summing three of the four charges its own figure shows — are recorded in the reference
rather than silently corrected.

**Fixed a pacing contradiction across all four PHYS 215 artifacts.** The tutor system prompt said
"about 3 active minutes each" (and twice more in the PACING section) while `PER_TOPIC_BUDGET_MIN` is
`2.0`, the injected per-turn pacing note interpolates 2.0, and `time_budget` says ~2 — three PHYS 310
values (3 topics × ~3 min) inherited through the structural base. The tutor was being told 3 and 2 in
the same prompt, and 4 × 3 min overshoots the ~10-minute target that prompt also states. Twelve
strings changed to 2 by an idempotent dry-run-by-default script; all four artifacts re-verified at
37/37. **PHYS 310's artifact was deliberately left alone** — 3 minutes is correct for that course.

**Recorded a new sharp edge, found while making that fix.** The substitution script read the files
with `open(p, encoding="utf-8")` — **text mode**, where universal newlines converts every `\r\n` to
`\n` before the code sees it — and wrote them back as LF. The three-line edit landed as
`6327 insertions(+), 6327 deletions(-)`: every line of every file, with the real change invisible
inside it. `.gitattributes` marks `courses/** -text`, so git stored the damage verbatim instead of
normalizing it away. Caught by reading `git diff --stat` before staging, reverted by one
`b.replace(b"\r\n",b"\n").replace(b"\n",b"\r\n")` pass, and the diff is now the nine lines it should
be. Written up in `PROJECT.md` §9 and in `.ai/patterns/python.md` §8, because the next agent to bulk-
edit a file here will hit it too.

**Lesson 16 (RC Circuits) is deferred, not blocked** — recker: "a new topic this semester, don't
worry about it yet." Recorded in `BUILD-LOG.md` along with recker's ruling that where a discussion
needs single-particle kinematics the grounding PDF does not contain, standard mechanics knowledge is
acceptable for that part. That settles the lesson 5 caveat; it does **not** loosen Tier 1 for any
electromagnetic content.

**Not done:** nothing was published, registered, or marked ready for students — every artifact
remains a draft. No JSX has been parsed; `check_artifact.py` is not a syntax check. Cengage 23.3–23.4
was not verified against the OpenStax span, because the two books cannot be mapped by number.
Verification for this run was `check_artifact.py`, the three gate checks, and reading the affected
regions of the file — there are no tests.

---

## 2026-08-04 — recker via Claude Code (tenth run)

**Built PHYS 215 lesson 7 — Charge Distributions, Electric Flux**, slug
`lesson-07-charge-distributions-electric-flux-32174e58`. Green under `check_artifact.py` (41/41).
Unlike lesson 5, this PDF matches its title: OpenStax §5.5 (pp. 190–197) and §6.1 (pp. 220–227),
both contiguous with no page gaps.

Topic 4 stops deliberately at "net flux depends on what is enclosed" and does not work Gauss's law,
which is lesson 8; the tutor is told to confirm the cadet is looking the right way and leave it.

**Paused here at recker's request** so the session can be compacted. Lessons 8–20 remain queued.
From lesson 8 the build shifts to one subagent per lesson — recker's suggestion, and a good one: the
agent absorbs the page-raster reading and drafting in its own context and returns a summary, while
`check_artifact.py`, the objective keys, and the commit stay on this side, because "done, 41/41" from
an agent is exactly what would hide a silently equation-free reference.

## 2026-08-04 — recker via Claude Code (ninth run)

**Built PHYS 215 lesson 5 — Charged Particles in Uniform Elec. Fields**, slug
`lesson-05-charged-particles-in-uniform-elec-fields-1c5bc31d`. Green under `check_artifact.py`
(40/40). Started the standing run recker asked for: build every preflight through lesson 20, skipping
labs (6, 11, 17) and Graded Review 1 (12, `PF=N`), logging each to `artifacts/BUILD-LOG.md`.

**Recorded a grounding mismatch rather than papering over it.** The PDF named *Charged Particles in
Uniform Electric Fields* contains **no single-particle kinematics** — it holds §5.5's disk/plane
results, §5.6's last figure, and §5.7 Electric Dipoles. Probe topics were scoped to what the source
actually grounds; the kinematic half of topic 2 is handled as Tier 2 prior coursework, with the tutor
explicitly forbidden from presenting trajectory results as today's material. Flagged prominently in
the build log for recker: **if lesson 5 was meant to be primarily kinematics, it needs a different
PDF.**

## 2026-08-04 — recker via Claude Code (eighth run)

**Built PHYS 215's first artifact from this repository: Lesson 4 — Electric Fields and
Superposition**, slug `lesson-04-electric-fields-and-superposition-479afcad`. Green under
`check_artifact.py` (43/43), including `--forbid` proof that no PHYS 310 grounding survived the
copy-and-reground. Added `courses/phys-215/artifacts/` with the artifact and a `BUILD-LOG.md` that
records the objective keys, the file, the registration slug, and the queue through lesson 20.

**Grounded in the real OpenStax PDF**, not model knowledge: Vol. 2 §5.4 (pp. 184–189) and §5.6
(pp. 198–201) from `Core_Preflights/textbook-pdfs/phys-215/`, a corpus outside this repository that
recker pointed at mid-run. PHYS 310's reconstruct-and-review exception was **not** borrowed; it stays
scoped to PHYS 310.

**A new sharp edge, recorded in `PROJECT.md` §9: the equations in these OpenStax PDFs are vector
paths.** `pdftotext` and `pypdf` both return complete-looking prose with every equation silently
absent — no error, no gap marker. They were transcribed off 150-dpi rasters. This machine had no
rasterizer, so **PyMuPDF was installed with `pip install pymupdf`** (recker chose this over poppler
when asked). Nothing in the repository depends on it — `scripts/` remains standard-library only, per
`CORE.md` §2.

**Not done, deliberately:** nothing published, nothing registered, no prefill link generated. The
artifact is a **draft** — `CORE.md` §6 reserves "ready for students" to recker. Its JSX has never
been parsed; `check_artifact.py` is explicitly not a syntax check, and publishing is what parses it.
`course_id: phys-215` is still unconfirmed on the receiver, and no `d` payload from this repository
has ever reached it.

## 2026-08-04 — recker via Claude Code (seventh run)

**Stood up PHYS 215 as the repository's second course.** `courses/phys-215/` now holds a complete
profile, the pilot's real 41-lesson Fall 2026 schedule (37 marked for a preflight), and a README.
No artifact was built and nothing was published — this is setup only.

**Four decisions recker made, recorded because none is recoverable from the files alone:**

| decision | chosen | over |
|---|---|---|
| slug shape | `lesson-<NN>-<topic>-<8hex>` — the pilot's stem | PHYS 310's `phys310-<topic>-<8hex>` |
| session shape | 4 topics × ~2 min (pilot as-built) | PHYS 310's 3 × 3 |
| grounding | OpenStax, PDF attached per lesson — the kit's normal path | Cengage, which would need PHYS 310's reconstruct-and-review exception |
| scope | full course dir, localized, checks run, committed | files only |

The contract's 8-hex suffix (`INTERACTION-DATA-CONTRACT.md` §3.2) is **mandatory regardless** and
is not one of these choices. Keeping the lesson number makes it load-bearing for this course:
renumbering after publish strands it in the slug, header, `lesson_id`, filename, and component
name, visibly to cadets, with nothing detecting it. PHYS 310 made the opposite trade; **neither is
a bug to "fix" into the other.**

**Localized to `courses/phys-215/build/` — and it is a genuine no-op, which is worth stating
plainly rather than reporting as work done.** PHYS 215 *is* `localize.py`'s `BASELINE`, so the run
reports `0 active substitutions`, `0` replacements across all ten files, and `build/` comes out
byte-identical to the kit (spot-checked on six files). `verify.py` check 2 asserts exactly this.

**The consequence is a hole in the safety net, now documented in three places.** The leftover scan
prints `clean`, and that clean is *vacuous*: `localize.py:268` only scans for a baseline string the
profile actually changes, and this profile changes none — so **an unfilled value still equals the
baseline, is never flagged, and the run looks perfect.** I had initially written the opposite (that
the scan would be noisy with false positives) into the profile and README; reading the source
showed it is not noisy but blind, and both files were corrected before commit.

**Fixed a documentation bug this change created.** `docs/operations/PREFILL-LINK.md` is a PHYS 310
runbook, and its slug section told the operator that a `lesson-NN-` slug is "a regression someone
restored." That is right for PHYS 310 and **actively wrong for PHYS 215** — an operator following
it would have "fixed" a correct slug into a broken one, and the failure mode is the silent one
where cadets submit into nothing. Added a scoping banner with a per-course value table and
rewrote the slug paragraph to branch by course. Registered `courses/phys-215/COURSE_PROFILE.md` as
a second source for that page in `DOC-SOURCES.json`, so a slug-rule change in *either* profile now
flags it.

**Verification.** All three gate checks green. `verify.py` 22/22 with the kit intact. The profile's
fenced-block sentinel scan prints 0. `build/` confirmed gitignored. **No JSX was written or parsed
and no artifact check was run** — there is no artifact for this course yet.

**Deliberately not done:**

- **No artifact built, published, or registered.** Publishing is gated (`CORE.md` §6) and was not
  asked for.
- **No `texts/` corpus.** PHYS 215 grounds in an attachable PDF; PHYS 310's reconstruct-and-review
  path stays scoped to PHYS 310, per its own ADR.
- **`grade_weight_note` inherited from the pilot verbatim** ("under 80 of 1000 course points") and
  **not confirmed** against Fall 2026. It reaches cadet-facing prose. Flagged in the profile.
- **`course_id: phys-215` not confirmed on the receiver.** It is the pilot's own id, so unlike
  PHYS 310's there is positive reason to expect it exists — but nobody checked.
- **CORE.md left untouched.** The new open items are *facts*, so they went to `PROJECT.md` §10 per
  that file's own routing table, not to `CORE.md` §8.

**One unresolved item found while transcribing, owned by recker and blocking part of the course:**
the profile names **OpenStax University Physics Vol. 2** as grounding, but the schedule's last
twelve lessons are optics and modern physics, which appear to live in **Volume 3** — eleven of them
preflight lessons. That is flagged from the volume's apparent scope and **has not been verified
against the actual OpenStax table of contents.** Lessons 2–29 are unaffected and buildable;
**lessons 30–41 should not be built until it is settled.** Related and separate: the schedule's
`Reading` column is in *Cengage* numbering while the tutor grounds in *OpenStax*, so those chapter
refs cannot be mapped across mechanically — a mismatch does not error, it produces a confident
artifact grounded in the wrong chapter.

**Rebased onto two upstream commits found by the pre-push fetch, and fixed a drift they left
behind.** `origin/main` had moved by two commits (the local review server) while this work was in
progress. **`CORE.md` §0's "fetch before you push" caught it — the second time in two days**, which
is worth noting since this is a private repo with one operator, exactly the setup where that rule
feels unnecessary. Rebased rather than merged; the only conflict was both sessions adding a
`CHANGELOG.md` entry at the top, resolved newest-first with the house `---` separator restored
(my original insert had omitted it).

The drift: `scripts/review/serve_review.py` is a **fifth** standard-library script, and three
documents still said there were four — `CORE.md` §2, `.ai/patterns/python.md`, and `PROJECT.md`
§10 — while `.ai/patterns/README.md` said "the three checks". **I had already attested python.md
as current earlier in this same run**, which is precisely the failure the attestation mechanism
exists to catch and which a rebase can quietly reintroduce. All four now read count-free
(`the standard-library Python scripts under scripts/`) so the claim cannot rot on the sixth
script. Not a PHYS 215 change and recorded as out of scope — but a false statement in the
authoritative contract is a bug regardless of who introduced it (`CORE.md` §5).

Editing `CORE.md` flagged six downstream documents. Each was checked against what actually
changed — the script count — and none of the six depends on it, so their `reviewed` dates were
bumped rather than their text edited. `.ai/patterns/README.md` was the one exception: it was
genuinely wrong for the same reason and was fixed, then attested.

---

## 2026-08-03 — recker via Claude Code

Re-pointed the review server at the Murray corpus, after finding this session had diverged.

**What happened.** This session was working from a clone that predated six commits — the whole
move from DOE grounding to the Murray corpus, the lesson rename, the slug suffix, and the
publish. It built a review server against `TEXTBOOK_REFERENCE` inside
`phys310_preflight_energy_atoms_and_nuclei.jsx`, a file recker had already deleted. The push was
rejected, which is the only reason the divergence surfaced. **`CORE.md` §0's "fetch before you
push" caught this exactly as written** — and the earlier entry at the bottom of this file, which
describes reviewing DOE grounding, is left standing as the record of what was actually built
before the rebase rather than quietly rewritten.

**What was wrong with the first version, beyond the stale path.** It wrote approvals to a sidecar
JSON. The corpus already gates builds on `**STATUS: PENDING**` lines, so that would have been a
second source of truth — recker approves in the tool, the gate keeps reading the file, and the
build stays blocked with no indication why. Approvals now write `**STATUS: REVIEWED <date>**`
into the corpus itself, which is the string the gate greps for.

**The writeback obeys four rules, each a way this could destroy work.** Only the STATUS line is
ever rewritten — verified against the committed corpus: one line changed, line count identical,
every other byte preserved. The file is re-read immediately before every write and an approval is
**refused** if the section text changed since the page rendered it (another session edits this
corpus). Writes are atomic. Rejections never touch the corpus at all — a rejected section stays
`PENDING`, which is already the right state for "not approved", and the note goes to
`murray-grounding-review-notes.json` for the rewrite.

**Scale.** 59 sections, 56 pending, ~14,600 words. That gate blocks every lesson after Atoms and
Nuclei, so this is the critical path for the term, not a nicety.

**What was deliberately NOT done.** No section approved, rejected, or rewritten — the tool was
exercised against a scratch copy and the corpus restored to its committed bytes before commit
(`git status` clean apart from the script). No change to the published artifact, the slug, or the
gate's semantics. The DOE material stays as the cross-check the corpus already cites; it was not
deleted or resurrected.

---

## 2026-07-31 — recker via Claude Code (sixth run)

**The first artifact is published.** Added the publish runbook and built the prefill link.

**Published by recker**, at
`https://claude.ai/public/artifacts/e2f07bf2-ef86-44d7-90fc-ff95207d2e32`, slug
`phys310-atoms-and-nuclei-83022f32`. All three verbatim-reproduction confirmations matched the
source: 2021 lines, identical `INTERACTION_ID`, single closing brace with a trailing newline and
nothing after it. **This is the first time any JSX in this project has been parsed** — the publishing
session is the only parser it meets (`PROJECT.md` §9).

**New: [`docs/operations/PUBLISH-ARTIFACT.md`](docs/operations/PUBLISH-ARTIFACT.md).** Runbook plus
the verbatim-reproduction prompt, registered in `DOC-SOURCES.json` against the data contract, the
skill, and `check_artifact.py`. It exists because the prompt is not optional scaffolding — a
publishing session's default behaviour is to be helpful, and helpful here means truncating a content
constant or re-slugifying. Both failures are invisible: the artifact still runs.

**The sharpest line in it, and the reason it is step 2's first sentence:** attaching a finished
`.jsx` to the course's Claude Project looks to `preflight-factory-v2` like an *input*. Without an
explicit instruction not to run the skill, the session may regenerate the artifact from scratch —
plausible, differently worded, and **with a different slug**. The published artifact would then be a
lesson nobody registered.

**Prefill link built** per `INTERACTION-PREFILL-LINK.md`: `policy=interaction` (artifact is the only
path for this lesson), `num=2`, `pub=0` (draft). The `id` was read out of the artifact
programmatically and asserted equal to `INTERACTION_ID` rather than retyped — the one failure mode
that rejects every cadet report with no error anywhere.

**State change recorded in `PROJECT.md` §10.** "Nothing has been built or published yet" is no longer
true. What replaced it names what publishing did *not* prove: no lesson row exists, no cadet has
taken a session, **no `d` payload has ever reached the receiver**, and `course_id: phys-310` is still
unconfirmed. The risk moved from "will it build" to "does the submit hop work" — and that half fails
silently.

**What was NOT done.** No lesson registered — the prefill link is handed over, and only recker can
save it. **No end-to-end submission tested**, so the auto-grade path is still inherited-and-unproven
(`CORE.md` §8). No corpus section reviewed; 56 still pending. The published artifact cannot now be
corrected by editing this repository — only by republishing, which mints a new slug and a new lesson
row.

---

## 2026-07-31 — recker via Claude Code (fifth run)

Fixed a contract violation in the slug. Recorded a deletion the previous run made silently.

**The slug was missing its per-offering suffix.** recker asked whether the artifact's slug carried a
UUID. It did not, and it should have: `INTERACTION-DATA-CONTRACT.md` §3.2 (added 2026-07-28) requires
`<readable-stem>-<8 random lowercase hex>`, minted once per build. `INTERACTION_ID` is now
`phys310-atoms-and-nuclei-83022f32`.

**Why it was missed, which matters more than the fix.** The skill's inline slug rule predates §3.2
and still reads *"Generation rule (deterministic, so re-running yields the same slug)"* with no
suffix. The build followed the skill. The skill's own Step 1 says not to: *"Read the two contract
files even though this skill reproduces their essentials inline… they have changed under it before.
If anything differs, build against the contract and flag the drift."* That read was skipped. **Only
the contract knows this rule** — not the skill, not the profile, not `PREFILL-LINK.md`, none of which
mentioned it before this run.

**Why the suffix exists:** `activities.slug` is globally `UNIQUE`, so a suffix-less slug makes every
term that runs a lesson share one row. A director deleting a rebuilt Fall 2026 lesson would have been
one confirm from destroying another term's reports.

**The trade, recorded because it inverts this course's naming policy:** the slug is now deliberately
**not** reproducible. A rebuild mints a new suffix and registers as a **new lesson row** rather than
updating the old one. Never hand-copy a suffix forward to avoid that — reuse is the failure §3.2
exists to prevent. `PORTABILITY_OVERLAY.md`'s determinism guard is unaffected: what it protects is
that the slug is skill-generated, never requested from the instructor, and never diverging from the
prefill link. All three still hold.

**Made mechanical.** `check_artifact.py` now fails an `INTERACTION_ID` that is not
`<stem>-<8 hex>`. A rule that lives only in the file nobody re-reads is a rule that gets missed, and
this one already was. `COURSE_PROFILE.md` and `PREFILL-LINK.md` now carry it too, and `CORE.md` §8
has a new row: the kit is hash-locked, so **every other deployment still reads the wrong rule from
the skill.** Owed upstream.

**A deletion the fourth run made without saying so.** recker deleted the superseded DOE artifact in
the IDE mid-task. That run's `git add -A` staged it and committed it under a message asserting the
file was *"still present"* — a commit that both performed and denied a deletion, and pushed it. The
deletion was intended (recker confirmed); **the silence was the defect.** Recorded as a sharp edge in
`PROJECT.md` §9: the working tree is shared, `git add -A` cannot tell whose changes are whose, and a
`-A` whose output you did not read is a commit message you cannot vouch for. The file is recoverable
at `e1a5f81`.

**What was NOT done.** Nothing published. No corpus section edited or reviewed. The JSX still has
never been parsed. The kit was not edited — it is hash-locked, and the skill's stale slug rule stays
wrong there by design.

---

## 2026-07-31 — recker via Claude Code (fourth run)

Replaced topic 3's derivation with recker's, which removed an un-attested claim from the grounding.

**Why this run happened.** recker opened the artifact and asked whether DOE content had survived.
It had not — but re-reading the grounding block to answer found something worse: **the third run had
put physics into `TEXTBOOK_REFERENCE` that no reviewed corpus section contains.** The bullet led with
"the nuclear force is short-range and saturating, so a nucleon binds only to its immediate
neighbors... like molecules in a liquid drop." Corpus §2.6 says only that the A^(1/3) dependence *is
why* density is roughly constant. It gives the rule-to-density direction and no mechanism. Standard
physics is not the bar here — **attested is** — and the claim was written after the gate had already
been checked, which is exactly how a gate gets walked past.

**recker's derivation, which is better and needs no attestation at all.** Start from what density
means, `rho = M/V`. Put in `M = A` nucleon masses and `V = (4/3)(pi)R^3`. Solve for `R`:

```
R = [3(1.6605 x 10^-24 g) / (4(pi)rho)]^(1/3) * A^(1/3)
```

`A^(1/3)` falls out on its own, and **the payoff is what is left in front of it** — a bracket built
from constants and `rho`, which is a fixed coefficient only if `rho` is fixed. The book printing
`R = (1.25 x 10^-13 cm) A^(1/3)` with one number in front *is* the assumption that every nucleus has
the same density. The cadet's job is to find that assumption sitting inside the formula, not to
justify it.

**This is pure algebra on values recker already reviewed** — `1 u = 1.6605 x 10^-24 g` and
`rho ~ 2 x 10^14 g/cm^3` are both in corpus §2.6. So the attestation problem does not get managed,
it **disappears**: nothing un-reviewed is asserted any more. Corpus §2.6 was deliberately NOT edited
— it is a reviewed section, and editing one silently invalidates its attestation (`PROJECT.md` §10).

**The mechanism is now parked, in three places, by name.** The reference, the probe topic, and a
lateral connection each instruct the tutor not to raise the nuclear force, saturation, or the
liquid-drop picture, and to answer a cadet who asks with "right question, comes later." The lateral
connection is labelled as the one in this lesson that is deliberately parked rather than engaged, so
a tutor reading the Tier-3 "engage, never redirect" rule does not treat the instruction as a mistake.

**Two numerical checks now close the loop, both runnable from values in the artifact.** With
`rho = 2 x 10^14`, the derived coefficient is `1.256 x 10^-13` against the book's `1.25 x 10^-13`.
And feeding back the `2.03 x 10^14` that extension problem E computes gives `1.2499 x 10^-13` —
the book's value to three figures. The coefficient and the density are one fact written two ways.
Scaffold ladder, misconception 4, prerequisites, and problem E's framing were all re-cut to match.

**Also fixed, unrelated:** the reference described neutral hydrogen-1 as "a proton plus an electron,
plus a small binding term." Wrong twice — binding *reduces* mass, and at six decimals it is invisible
anyway (`1.007276 + 0.000549 = 1.007825` exactly; the electron's ~13.6 eV is ~10^-8 u). Corrected to
say so with the actual scale.

**What was NOT done.** Nothing published. No corpus section edited, reviewed, or added to. The JSX
still has never been parsed. The superseded artifact is still present and still must not be published.

---

## 2026-07-31 — recker via Claude Code (third run)

Built the first Murray-grounded artifact: **Atoms and Nuclei**. Added a mechanical artifact checker.

**What.** `courses/phys-310/artifacts/phys310_preflight_atoms_and_nuclei.jsx` — 1963 lines, slug
`phys310-atoms-and-nuclei`, component `Phys310AtomsAndNucleiPreflight`. Grounded in Murray §2.1,
§2.5, §2.6, **excerpted from the corpus rather than reconstructed**, per `COURSE_PROFILE.md` →
"Building an artifact" step 4. The review gate was checked before building and passed: all three
sections read `STATUS: REVIEWED 2026-07-31`.

**How it was built, and why that matters for review.** It is a splice of the superseded
DOE-grounded build, not a fresh emission. The theme, component logic, submission path, report
format, and both system prompts carry over **byte-for-byte**; only the three content constants, the
slug, the title, the component name, and two sentences in the tutor prompts changed. `diff` confirms
eleven hunks and no stray edits. The point is that the infrastructure needs no re-review — it is
unchanged from a build that was already assembled against the frozen contracts.

**Two false sentences removed from the tutor prompts.** Both asserted the tutor's reference is "not
the cadet's assigned class text" — true under DOE grounding, **false since the 2026-07-31 regrounding
in Murray**, which is the adopted text. The no-citation rule is kept and restated on its real
justification: a cadet told "section 2.6 says" goes and looks it up instead of thinking. **This does
not close the `CORE.md` §8 row** — that tracks the same falsehood in the hash-locked upstream source
(`02_TUTOR_SYSTEM_PROMPT.md:17`) and in the localized skill, neither of which this touches. It only
means the falsehood is not baked into *this* artifact.

**Probe topic 3 was changed at recker's direction after the Step 5 preview**, from stating the
radius rule to probing whether a cadet can *reason their way to* the A^(1/3) dependence — short-range
saturating force → constant packing density → V ∝ A → R ∝ A^(1/3). Either direction of the argument
counts. A five-rung scaffold ladder is written into `LESSON_CONFIG` so the tutor teases it out
instead of handing it over, and extension problem E is now framed as the numerical confirmation.
A matching misconception was added ("the cube root is just a curve fit").

**Extension problems re-derived against Murray's constants**, twice each, both passes shown. Two
now land exactly on values in the reference — problem B gives 939.565 MeV, the tabled neutron rest
energy, and problem E gives ≈2.03×10¹⁴ g/cm³ against the tabled ≈2×10¹⁴. Under DOE's rounded
931.5 MeV neither agreement was available.

**New: `scripts/artifacts/check_artifact.py`** (read-only, stdlib, non-zero on failure). Checks NUL
bytes, delimiter balance, the frozen contract strings, the forbidden strings, and the per-course
constants `COURSE_PROFILE.md` mandates but no tool reads. The new artifact passes 41/41; run against
the superseded build it fails exactly the 7 leftover-source checks, which is the negative control
that shows the checks are not vacuous. Documented in `CORE.md` §4 as explicitly **not** a fourth gate
check — it applies to a build, not to every commit.

**A checker bug, caught and worth recording.** The first run reported six failures — `100vh`,
`scrollIntoView`, `x-api-key` and friends — all of them inside comments *warning against* those very
strings. Same shape as the anchored-grep trap in the corpus, and the same shape as why
`check_slots.py` exists instead of `grep -rn "{{"`: **a well-documented file fails a naive scan for
the things it documents.** The committed script strips comments before scanning and says why.

**What was NOT done.**

- **Nothing was published.** Publishing is a `safe-change` operation requiring recker to ask for that
  specific run, and it is the irreversible step (`CORE.md` §6).
- **The JSX was never parsed.** No parser exists on this machine and adding one is forbidden by
  `CORE.md` §2. 41 green checks are not a parse — the publishing session is the parser.
- **The superseded artifact was not deleted.** Deletion is `safe-change`; nobody asked.
- **No prefill link was built.** It needs the public URL, which does not exist until recker
  publishes. Procedure: `docs/operations/PREFILL-LINK.md`.
- **`course_id: phys-310` is still unconfirmed on the receiver** (`CORE.md` §8). Unchanged by this
  run, and still the thing that makes a first shipment fail silently.
- **No section of the corpus was verified against the book.** 56 remain `STATUS: PENDING`.
- **The localized `build/` tree was not regenerated** — the profile did not change, so it would be a
  no-op diff.

---

## 2026-07-31 — recker via Claude Code (second run)

Built the Murray grounding corpus — all 59 sections — and renamed lesson 2.

**What.** `courses/phys-310/texts/MURRAY-GROUNDING.md`: every Murray section the schedule assigns,
**59 sections across 14 chapters serving 17 preflight lessons**, reconstructed from model knowledge.
Each entry carries a **Physics** block (skim) and a **Flags** block (read against the book), plus its
DOE cross-check status. **§2.1, §2.5, §2.6 are `STATUS: REVIEWED` — approved by recker 2026-07-31.
The other 56 are `STATUS: PENDING`.** recker confirmed the radius-rule coefficient is **1.25** in
this book.

**The gate, now mechanical.** A lesson is not buildable while any section it cites is pending.
Status tokens are `STATUS: REVIEWED` / `STATUS: PENDING` — deliberately not substrings of each other,
because `grep REVIEWED` matches both and would report every pending section as done. **The grep must
also be anchored** (`'^\*\*STATUS: PENDING\*\*'`): the unanchored form matches the document's own
explanatory prose and overcounts by four. Caught by cross-checking the token count against the
section count, which is why both commands are documented together.

**Lesson 2 renamed** `Energy, Atoms, and Nuclei` → **`Atoms and Nuclei`**. recker's call: the title
was stale, and the assigned sections (2.1, 2.5, 2.6) carry no energy content beyond §2.6's
mass–energy conversion. **This changes the slug**, since PHYS 310 mints it from topic text alone —
`phys310-energy-atoms-and-nuclei` → `phys310-atoms-and-nuclei`. Safe only because nothing is
published or registered; after publication this would desynchronize the slug from the receiver.

**Confidence is not flat, and the file says so per entry.** Chapters 2–7 are formula-dense and
fully DOE-cross-checkable. Chapters 15, 18, 21, 23 are applied and descriptive, **have no DOE
cross-check at all**, and three entries (§12.8, §18.5, and the §15.4 composite) carry explicit
warnings that **the section's subject itself is a guess**, not just its content.

**What this run deliberately did NOT do.**
- **Did not build any artifact.** 56 sections are unreviewed; lesson 2's three are not, so lesson 2
  is buildable on request.
- **Did not delete the superseded artifact** `phys310_preflight_energy_atoms_and_nuclei.jsx`. It is
  stale twice over — DOE-grounded and carrying the old slug — but deletion is a `safe-change`
  operation and recker has not asked for it. **It must not be published as-is.**
- **Did not touch the theme.** recker chose the standard palette; per-course theming remains
  unsupported and unbuilt.
- **Did not verify any section against the book.** That is the review, and it is recker's.

## 2026-07-31 — recker via Claude Code

Moved PHYS 310's grounding to Murray, reconstructed from model knowledge under human review. Added
a prefill-link runbook. Set up a local `.venv`.

**What.** recker has no PDF of Murray & Holbert and will not get one, so the 2026-07-30 decision to
ground PHYS 310 in DOE-HDBK-1019 was trading coverage for a copyright position. Grounding is now the
adopted text, reconstructed by the agent and **gated by recker's review against a physical copy**.
The reconstruction lives in one corpus document per course rather than being redone per lesson;
artifact builds excerpt from it. Reasoning, alternatives, and costs:
`docs/decisions/PHYS310-MURRAY-GROUNDING.md`. Profile keys `grounding_text`,
`grounding_text_short`, and `student_text` updated; re-localized and re-verified.

**Why the review gate is written into the contract rather than left as a habit.** The frozen tutor
prompt says "do not paraphrase or reconstruct them from memory." The argument that this is still
compliant rests entirely on the reconstruction being human-checked at build time — the tutor still
gets an inlined reference and still may not improvise. **Skip the review and that argument
collapses**, which is why `PROJECT.md` §10 now names it as the thing not to do.

**A frozen sentence is now false and stays.** `02_TUTOR_SYSTEM_PROMPT.md:17` and the localized
`build/skill/…/SKILL.md:271` assert the grounding reference is not the cadet's class text. For this
course it is. The file is hash-locked, so it stays as written; `CORE.md` §8 flipped from "PHYS 310
no longer trips this" to "trips this again," and the row is now load-bearing rather than cosmetic.
Assessed as behaviorally harmless — the false part is the justification, not the rule, and the rule
(never cite section or page numbers to a cadet) is still wanted.

**Also.** `docs/operations/PREFILL-LINK.md` — the procedure for turning a published artifact into a
registered lesson, written around the slug-match guard, since a mismatched slug loses cadet work
silently. Registered in `DOC-SOURCES.json`. Created `.venv/` (Python 3.14.0, **zero packages** —
this project is standard-library-only and has no manifest) plus a `python3.exe` shim inside it,
because the global `python3` resolves outside the venv.

**Verification.** All three checks pass; `verify.py` passes all 22 checks and the kit is intact;
`localize.py` runs clean with no leftover baseline strings and no unfilled sentinels. The nine
staleness attestations were bumped after confirming both contract edits were confined to single
table rows in `CORE.md` §8 and `PROJECT.md` §10 — sections none of those documents describe.

**What this run deliberately did NOT do.**
- **Did not build the corpus or rebuild the lesson 2 artifact.** The lesson 2 grounding block is
  presented to recker for review first; that gate is the whole decision.
- **Did not download the DOE PDFs.** Still gitignored and absent from a fresh clone, so the
  cross-check is unavailable until someone re-downloads them.
- **Did not edit anything hash-locked.** The two false sentences in the frozen tutor prompt stay.
- **Did not confirm `course_id: phys-310` on the receiver.** Still open, still `CORE.md` §8.
- **Did not run this through `safe-change`.** Two single-row edits to `CORE.md`/`PROJECT.md` under
  version control are not the deletions, migrations, or publishes that gate covers. Flagged here
  rather than assumed.

## 2026-07-30 — recker via Claude Code

Added a local review server for an artifact's grounding text.

**What.** `scripts/review/serve_review.py` — standard library only, binds to `127.0.0.1`. It
parses a `String.raw` block out of a generated `.jsx`, splits it on its ALL-CAPS section headers,
and serves one page where the subject-matter expert approves or rejects each section with a note.
Decisions land in `courses/<id>/artifacts/grounding-review.json`. Run:
`python scripts/review/serve_review.py`.

**Why.** The grounding text is the only part of a preflight the agent *writes* rather than
transcribes, and it is the tutor's sole source of physics at runtime — there is no PDF attached to
a published artifact. It is also the part recker is the qualified reviewer for and the agent is
not. 16 sections, 3,377 words, each carrying the DOE page range it came from.

**Three properties that are the point, not decoration.**

1. **The page re-parses the artifact on every request.** It never renders its own snapshot. A
   review tool that caches will eventually show text the artifact does not contain, and an
   approval collected against that is worse than no approval.
2. **Every decision is bound to a SHA-256 of the text as reviewed.** When a rejected section is
   rewritten its hash changes and the page marks it `changed — re-review`, while untouched
   sections keep their approval. Without this one rewrite silently invalidates nothing.
3. **A save merges; it never drops a note.** An empty note in a later save does not erase an
   earlier one (`CORE.md` §6, never overwrite human work).

**Found the pipe-encoding edge again, in the new script, one hour after documenting it.** A `→` in
a `print` inside the POST handler raised `UnicodeEncodeError` on a cp1252 console, which killed
the connection mid-save — the browser reported a network failure for a save that had already
written to disk. Section titles contain em-dashes and reviewer notes can contain anything, so
avoiding non-ASCII was not a fix. All output now goes through a `say()` helper that encodes via
stdout's own codec with `errors="replace"`; the worst case is a mangled glyph, never a dropped
request. Re-tested end to end with `PYTHONIOENCODING=cp1252` forced. That this recurred so quickly
is the argument for `PROJECT.md` §9's entry being a *rule* rather than an anecdote.

**What was deliberately NOT done.** No dependency, no build step, no `package.json` — `CORE.md` §2
holds. Not bound to `0.0.0.0`: one operator, one machine, nothing here wants a network. Scoped to
`TEXTBOOK_REFERENCE`, which is what recker asked to review; `--block` will point it at
`LESSON_CONFIG` or `EXTENSION_PROBLEMS` unchanged, but those were not reviewed here. **No section
has been rewritten** — the server is running and no decisions have been recorded yet.

---

## 2026-07-30 — recker via Claude Code

Closed the grading open item; sharpened the one it makes riskier.

**What.** recker changed the DFPM receiver's scoring so preflights score out of 3 (1 point for a
meaningful reading reflection, 2 for discussion effort). Removed the `grade_weight_note`-vs-receiver
row from `CORE.md` §8 — the profile's `75 of 1000` is now both correct and achievable.

**Why the neighbouring row got stronger rather than deleted too.** The receiver's grade trigger is
the thing `d.effort` feeds, and it has just been rewritten. `OPEN_ISSUES.md` §1 already flagged that
`d`-key emission is unproven end to end; a freshly changed mapping on the far side makes that check
**more** load-bearing, not less. Nothing changed in the artifact — it still emits `effort` 0–5 and
`reading_reflection.meaningful`, which is all the contract ever asked it for.

**A contract is now stale, and it is not ours to fix.**
`contracts/INTERACTION-DATA-CONTRACT.md` §5.2 documents the old `effort → 0–2 points` mapping. That
is wrong for this receiver as of today. It is a **frozen contract** — `CORE.md` §6 forbids editing
one to match local reality, and under §8 a changed grade rule is a `schema: 2` event. Recorded in
the §8 row so the next reader does not trust §5.2's table; correcting it is DFPM's call.

**What was deliberately NOT done.** The artifact was not rebuilt or re-scored, no contract file was
edited, and the 3-point mapping was not verified — that happens on the throwaway lesson, against the
live receiver, and has not been run.

---

## 2026-07-30 — recker via Claude Code

Fixed `verify.py`'s pipe encoding — the kit's own verifier had been crashing on an intact kit.

**What.** Added `PYTHONIOENCODING=utf-8` to the child environment in
`preflight-kit/tools/verify.py`'s `localize()` helper. All 22 checks now pass, exit 0.

**Why.** Found while confirming the kit was still intact after the artifact build. `verify.py` was
dying at check 3 with `TypeError: argument of type 'NoneType' is not a container` — a message that
names neither encoding nor `localize.py`. Reproduced identically on the parent commit, so it was
**pre-existing, not introduced by that build**.

The root cause is that **both ends of a pipe must agree on a codec, and the previous fix pinned
only one.** `localize.py` prints `·` and `—`; when its stdout is a *pipe* rather than a console,
Python encodes them with the locale encoding — `0xb7` and `0x97`, not valid UTF-8. The earlier
patch had pinned `encoding="utf-8"` on the *parent's* decode, which fixed the original em-dash
mangling and, in doing so, converted a silently-wrong substring test into a hard crash: the
parent's reader thread raised `UnicodeDecodeError`, `proc.stdout` was left as `None`, and the
`in stdout` test blew up. Half a handshake was worse than none.

`tools/` is authored rather than hash-locked (`PROVENANCE.md`), so this is a legitimate local fix
and does not disturb the hash-verified payload — but it does mean `verify.py` now differs from
upstream v1.0 in **two** places, both owed upstream. `CORE.md` §8's upstream-debt row is updated
from three fixes to four.

**Corrected a claim rather than leaving it.** `PROJECT.md` §10 recorded "all 22 `verify.py` checks
pass"; on this machine that had stopped being true. Both `PROJECT.md` §9's sharp edge and §10's
status row now describe the two-sided fix, since the one-sided version reads as complete and is not.

**What was deliberately NOT done.** No change to `localize.py` itself — making it emit ASCII would
be the other way to close this, but it is the hash-locked kit's authored tooling shared by every
course, and the caller is the side that knows it is reading a pipe. No upstream patch submitted;
that is recker's call per `PROVENANCE.md`.

---

## 2026-07-30 — recker via Claude Code

Built the first real PHYS 310 preflight artifact: *Energy, Atoms, and Nuclei*. **Not published.**

**What.** Transcribed the real Fall 2026 schedule from recker's workbook into
`courses/phys-310/phys310_fall2026_schedule.md` (41 lessons plus the final; 20 marked `PF`), and
emitted `courses/phys-310/artifacts/phys310_preflight_energy_atoms_and_nuclei.jsx` through the
`preflight-factory-v2` skill — Steps 1–6, with the Step 5 preview approved by recker before any
code was written. Grounding is DOE-HDBK-1019 NP-01 pp. 1–16 and NP-02 pp. 6–7, plus a marked
supplement for the amu/carbon-12 definition (below).

**Two decisions recorded in `COURSE_PROFILE.md`, both recker's.**

1. **No lesson numbers anywhere in a build.** The schedule's dates and lesson numbers are expected
   to move; its topics and readings are not. Under the kit's `lesson-<NN>-<topic>` rule, moving a
   topic between lessons silently changes the slug a rebuild would mint and desynchronizes it from
   the registered one — the failure `CORE.md` §8 warns about, arriving through the calendar instead
   of through an edit. This course therefore mints `phys310-<topic-slug>` from the topic alone, and
   the number is gone from the header, `lesson_id`, filename, and component name too — otherwise a
   renumber just moves the wrong number somewhere a cadet can see it. `PORTABILITY_OVERLAY.md`
   lists slug generation among the four things a profile cannot change; what that guard protects is
   that the slug stays **deterministic and skill-generated, never improvised**, and both properties
   survive. It is a recorded decision, not a build-time improvisation.
2. **Session shape: 3 probe topics at ~3 active min each** (~10 min total), replacing the pilot's
   4 × 2.

**Three problems found and fixed, none of them the task asked for.**

- **`grade_weight_note` was wrong** — the profile said 60 of 1000; the workbook's Grade Breakdown
  sheet says preflights are **75 of 1000**. Corrected. But see the open item below: the receiver
  cannot actually produce a 3-point score.
- **Two DOE page offsets in the index were wrong.** Both had been *inferred* from roman-numeral
  front-matter anchors rather than measured. NP-02 was recorded as +106; the real value is +104,
  and NP-01 is +24. An extraction run on an inferred offset lands two pages late and reads as
  plausible the whole way through. Both are now measured against arabic-numbered body pages, with
  the anchors recorded.
- **DOE never defines the amu against carbon-12** — precisely the thing recker named as a probe
  topic. NP-01 p. 4 gives the value and says "the reason … will be discussed in a later chapter,"
  and then never does; a `pdftotext` sweep of both volumes finds one mention of carbon-12, an
  unrelated decay product. Supplied from NIST (also a U.S. Government work, so the public-domain
  policy holds) as a clearly marked `[SUPPLEMENT]` block, and logged in the index's new
  "Known grounding gaps" table.

**Verification — read this before trusting the artifact.** The three checks in `CORE.md` §4 pass.
Mechanically verified on the `.jsx`: template-literal delimiters cannot terminate early (no stray
backtick or `${` in any of the four content constants), brace/paren/bracket and JSX-fragment
balance, every frozen contract string present, every retired endpoint absent, no auth header in
code, no `100vh`/`100dvh`/`scrollIntoView`, and the per-course constants correct.

**The JSX itself has never been parsed, and `node --check` cannot do it.** It reports **exit 0** on
the artifact — not because the file is valid, but because Node auto-detects any file containing
`import`/`export` as ESM and does not reject JSX on that path; a two-line JSX file with no `import`
correctly fails, and adding one `import` makes the same JSX pass. Verified against both control
cases. No JSX parser exists on this machine (`tsc`, `esbuild`, `babel` all absent) and installing
one is a build step `CORE.md` §2 forbids, so **the Claude session recker publishes from is the
parser.** Recorded in `PROJECT.md` §9 so the next agent does not repeat the false pass.

Also recorded there: a generated artifact must carry `\u0000` as `RichText`'s math placeholder as
the two-character **escape**, never the literal NUL character. Written as a raw byte the file runs
identically but git reports "Binary files differ" instead of a diff and `grep` skips it entirely.
This build emitted 6 raw NULs and they were replaced; the same slip then recurred while writing the
sharp-edge entry itself, which is the argument for the mechanical check now written down beside it.

**Model candidates.** `claude-sonnet-5` primary, `claude-haiku-4-5` fallback — two live families,
both non-dated, per `CORE.md` §6. The skill's rev-2 example (`claude-sonnet-4-6`) is a generation
behind; the skill itself says to confirm the aliases resolve for the tiers cadets use. Cadets run
this on their own claude.ai accounts, so **tier availability, not raw capability, picked the
primary** — `claude-opus-5` is the stronger tutor but is likelier to be unavailable on a free
account, and `rawCall` only falls back on a 404.

**What was deliberately NOT done.**

- **Nothing was published, and no prefill link was built.** Publishing is the irreversible step and
  is gated by `safe-change`; the artifact's public URL cannot be known before recker publishes, and
  fabricating one is the documented failure mode. The artifact is a draft until recker approves it
  (`CORE.md` §6).
- **The 3-point grading split recker asked for was not implemented, because it cannot be.** The
  artifact sends `effort` 0–5, never points; the receiver derives a **0–2** score in a DB trigger,
  and the data contract §8 classifies changing that mapping as "repurposing the grade rule" — a
  `schema: 2` event affecting every deployed artifact on that receiver, PHYS 215's included. The
  semantics recker described (reflection required for full credit) are already what the contract
  implements, compressed onto 0–2. recker said they would handle the conversion on the backend;
  the mismatch is on the `CORE.md` §8 list so it is settled before the first artifact ships.
- **The source workbook was left where it is** rather than renamed or restructured; the Markdown
  schedule is derived from it and says so.
- **`courses/*/build/` was not used for the artifact** — `localize.py` deletes that tree on every
  run. It lives in `courses/phys-310/artifacts/`.
- **No Murray & Holbert content was added to the repository.** It is commercial and copyrighted;
  the probe topics were written from recker's description of the assigned sections, with DOE as
  the tutor's factual grounding. That split — cadets read one book, the tutor is grounded in
  another — is a standing design property, not a gap.

---

## 2026-07-30 — recker via Claude Code

Moved PHYS 310 grounding to the public-domain DOE handbooks.

**What.** Added `courses/phys-310/texts/` holding DOE-HDBK-1019/1-93 and /2-93, *Nuclear Physics
and Reactor Theory*, plus `DOE-HDBK-1019-INDEX.md` — a full section index of all four modules with
page ranges, figure and table locations, and verified PDF-page anchors. Changed `grounding_text` to
DOE-HDBK-1019; `student_text` stays Murray & Holbert. Re-localized: exit 0, leftover scan clean,
zero `OpenStax` strings remaining in any deliverable.

**Why.** Murray & Holbert is commercial and copyrighted. The DOE handbooks are U.S. Government
works carrying Distribution Statement A — public domain. Grounding in them removes the copyright
question rather than managing it: no verbatim-passage limit to police, no figure-reproduction line,
no cumulative-coverage argument across a semester, and no dependence on how tightly a published
artifact's URL is gated.

**A second problem fixed as a side effect.** The tutor prompt asserts its grounding reference is
*not* the cadet's assigned text. Grounding in Murray would have made that false — and unfixable by
`localize.py`, since the sentence names no book. Grounding in DOE restores the separation the
prompt describes. **The upstream weakness is unchanged** and stays on the `CORE.md` §8 list; PHYS
310 simply no longer trips it.

**Checked, not assumed.** Volume 2's first download was an incomplete Chrome `.crdownload`, caught
by checking that each PDF ends with `%%EOF` rather than trusting the filename; recker re-downloaded
it. Both volumes verified complete. PDF-page offsets are recorded as *measured anchors* rather than
arithmetic, because module front matter varies in length — NP-02 alone runs to page xii — and an
offset carried between modules starts an extraction in the wrong place, which becomes a tutor
hallucination rather than an error.

**Known limitation, stated in the index.** DOE-HDBK-1019 is reactor-operator training: strong on
reactor physics, neutron economy, poisons, and kinetics; not a general nuclear-science survey.
Expect real gaps around detection and instrumentation, isotope applications, fusion, and nuclear
astrophysics. Lessons landing in a gap need their own grounding source, recorded in the schedule row.

---

## 2026-07-30 — recker via Claude Code

Completed the PHYS 310 profile and localized it.

**What.** PHYS 310 · Principles of Nuclear Science · Fall 2026, grounded by default in Murray &
Holbert, *Nuclear Energy* (8th ed.), 60 of 1000 course points. Renamed the schedule to
`phys310_fall2026_schedule.md` per the kit's convention. Ran `localize.py` into
`courses/phys-310/build/`: exit 0, leftover scan clean, identity verified in the output.

**Case-by-case grounding needed no workaround.** The syllabus has no single open text, but the
skill's Step 3 already builds `TEXTBOOK_REFERENCE` from whatever pages are attached per lesson, as
a structured summary rather than a verbatim transcript. `grounding_text` names the default only.
Recorded the convention that the schedule's `Reading` column must name the *source*, not just a
page range, once more than one book is in play.

**Found: the tutor prompt ships a sentence that is false for this course.** It states the grounding
reference is not the cadet's assigned text — true for the pilot (OpenStax vs. Cengage), false here,
where cadets read the same Murray & Holbert the tutor is grounded in. The sentence carries no book
name, so the localizer cannot reach it: `02_TUTOR_SYSTEM_PROMPT.md` localizes to **0
substitutions** and is byte-identical to source, which I verified by hashing both. The behavioral
rule is still correct; only its stated reason breaks, and a false premise in a system prompt is not
inert. **Not fixed here** — the file is hash-locked, so rewording is recker's call and belongs
upstream. Recorded in `CORE.md` §8 and in the profile.

**Fixed a check I had written badly.** The documented sentinel check was `grep -c '<<<UNSET'` over
the whole profile, which matches the instruction line stating it and can therefore never print 0 —
a check that cannot pass is one people learn to ignore. Now scans the fenced block only, which is
also all `localize.py` reads. Noted why `localize.py --check` is not a substitute: it previews only
substituted keys, so a sentinel in `course_title`, `student_text`, or `grade_weight_note` would not
appear in it.

**Not done.** The schedule still holds the template's placeholder lessons — **the only thing
blocking a real build.** Session-shape values are still the pilot's; recker said they would be
adjusted but not which. `course_id: phys-310` remains unconfirmed against the receiver.

---

## 2026-07-30 — recker via Claude Code

Made this a multi-course master project; scaffolded PHYS 310.

**What.** Added `courses/<course-id>/` as the per-course layout, with `courses/phys-310/` holding a
`COURSE_PROFILE.md`, a schedule skeleton, and a README. `preflight-kit/` stays as one shared,
unmodified copy. Filled `PROJECT.md` §2, §4, §7, §9, §10 and `CORE.md` §6 — the design package
landing was the stated trigger for those, and they were stubs until now. Reasoning for the layout
is in `docs/decisions/MULTI-COURSE-LAYOUT.md`.

**Why.** recker asked for the repository to serve many courses, starting with Physics 310. The kit
is hash-locked, which only means something if there is one copy to check — so per-course variation
goes in a profile, not in a copy of the kit.

**Verified rather than assumed.** `localize.py` resolves both the profile path and `-o` relative to
the kit root, so a relative `-o` pointing outside the kit works: tested with the pilot's own profile,
27 files written to the right place, leftover scan clean, exit 0. An earlier run of that same test
reported exit 255, which was a truncated PowerShell pipe rather than a real failure — re-run without
the truncation before believing it.

**The line-ending bug bit a second time, one directory over.** A fresh clone could not parse
`courses/phys-310/COURSE_PROFILE.md`: `localize.py` finds the block with the regex
```` ```profile\n ````, and a CRLF checkout puts `\r` before the `\n`. Extended `.gitattributes`
to `courses/** -text`. Caught only by cloning and running the real build command — the working
tree was correct throughout, both times. **Any future tree holding a parsed or hash-checked file
needs the same treatment**, and the way to know is a clone, not a local run.

**Decisions recorded, both recker's.** Backend Option A: reusing the DFPM receiver, so the endpoints
stay byte-identical to the pilot and only `course_id` changes. Slug namespacing: `slug_prefix` is
`phys310-lesson`, so PHYS 310 cannot collide with the pilot's bare `lesson-NN-<topic>` slugs
(`OPEN_ISSUES.md` §6). PHYS 215's published slugs are deliberately left alone.

**Not done — PHYS 310 is not yet buildable, on purpose.** The profile carries `<<<UNSET: …>>>` for
five values only recker can supply (course title, semester, grounding text, student text, grade
weight), and the schedule still holds the template's placeholder lessons. **I did not invent them:**
a guessed grounding text grounds the tutor in the wrong book, and a guessed topic string mints a
slug a published artifact is then stuck with. `localize.py` was deliberately not run against this
profile — it would bake the sentinels in and report success. Session-shape values are still the
pilot's; recker said they would be adjusted but not which. `course_id: phys-310` is unconfirmed
against the receiver's course list.

---

## 2026-07-30 — recker via Claude Code

Added `preflight-kit` v1.0 and fixed two Windows packaging bugs.

**What.** Unpacked the boxed kit into `preflight-kit/`; all seven hash-locked files match
`MANIFEST.sha256`. Fixed `tools/verify.py`, which failed check 3 on an intact kit: it captured
`localize.py`'s output with `text=True`, decoding as cp1252 on Windows and mangling the em-dash in
`clean — no baseline` so the substring test never matched. Pinned `encoding="utf-8"`.

**The one that mattered more.** `core.autocrlf=true` rewrote line endings on checkout, so a fresh
clone of this repository shipped a **corrupted** kit — 6 of 7 hashes failed and `localize.py` could
not find the ```` ```profile ```` block at all. The local working tree looked correct the entire
time; the bug was only visible by cloning to a temp directory and running `verify.py` there. Fixed
with `.gitattributes` marking `preflight-kit/** -text`, plus re-storing
`INTERACTION-PREFILL-LINK.md`, whose deliberate CRLF endings git had normalized to LF. Re-verified
from a fresh clone of the GitHub remote: all 22 checks pass.

**Why the fixes are legitimate.** `tools/` is authored rather than hash-locked (`PROVENANCE.md`), so
neither change disturbs the frozen payload — `verify.py` confirms that.

**Not done.** Both fixes are local. `PROVENANCE.md` says a port owes upstream what it discovers, and
these would hit any Windows user of kit v1.0 — that write-up is outstanding.

---

## 2026-07-30 — recker via Claude Code

Granted a standing authorization to commit and push.

**What.** `CORE.md` §5 now carries one standing authorization: any agent, any skill, may commit and
push to `main` without asking each time, provided the three checks in §4 pass and the commit carries
a `CHANGELOG.md` entry. Updated the `AGENTS.md` quickstart and `CORE.md` §7 to match, and corrected
the `safe-change` Step 0 precondition, which had asserted that this project has no standing
authorizations.

**Why.** recker asked for it. The repository is private, has one operator, and has no deployed
surface, so a pushed commit is cheap and recoverable — while an uncommitted one is invisible to the
next session, which §0's agent-memory rule makes a real cost rather than a theoretical one.

**Scope, stated because a broad grant invites a broad reading.** It covers committing and pushing.
It does not touch the gates that already existed: force-push remains banned (§0), and deleting,
rewriting history, or publishing an artifact still requires recker to ask for that specific run via
`safe-change`. An agent may not reason from "I may push" to "therefore I may also publish."

---

## 2026-07-30 — recker via Claude Code

Installed the agent-neutral AI instruction system from `_ai-instruction-kit`.

**What.** Added `.ai/` (the operating contract, the deep reference, and the five skills), the root
entry files `CLAUDE.md` and `AGENTS.md`, the `docs/` taxonomy with its `DOC-SOURCES.json` staleness
index, and the three read-only checks under `scripts/`. Filled every project slot, wrote `CORE.md`
§1, §2, and §6, and seeded `PROJECT.md`.

**Why.** This project is being recreated in a repository after being designed in a Claude chat
session, and it will be worked on by more than one agent. The kit exists so those agents follow the
same written rules instead of each accumulating its own — and so that what the next session needs to
know lives in the repository rather than in a private agent memory that nobody else can read.

**Pruned, because this project cannot hit them.** Recorded here so a future operator knows these
were decisions rather than omissions:

- `CORE.md` §0's coordination gate — the designate-an-operator step, the confirm-no-competing-agent
  step, and the no-concurrent-structural-changes rule. `{{SHARED_STATE}}` is **none**: no production
  database, no live site, no published package, one operator. Kept: agent memory is not shared, the
  CHANGELOG rule, `safe-change` for destructive operations, never two agents in one working tree,
  `git fetch` before pushing, and never force-push. §0 was retitled "Safety floor" to match.
- `CORE.md` §5's standing-authorizations list — there are none; every commit and push is asked for.
- `.ai/patterns/cpp.md` — deleted entirely, along with its `DOC-SOURCES.json` entry. This project
  does not write C++, and a pattern file with unfilled slots keeps the slot checker red forever,
  which trains everyone to ignore a failing check.
- `PROJECT.md`'s worked examples — the fictional "Orderly" service that illustrated each section.
  The guidance on what each section must contain was kept; the invented facts were not, because a
  reference file whose bulk is another project's data is a file agents learn to skim.

**Changed, not just filled.** `.ai/patterns/python.md` names a formatter, linter, type checker, and
test framework in about a dozen rules. **None of them are installed here**, so rather than leaving
those clauses asserting a mechanism nobody runs, the settings table now states plainly that each is
absent and a banner says every such clause currently means "enforced by review alone". The
dependency policy is recorded as **standard library only** — the `scripts/` checks must run with no
`pip install`.

**Not done — the open items, each with its owner.** These are also in `CORE.md` §8, which is where
they get closed:

- **The implementation language, architecture, and data model are undecided**, because the design
  package from the Claude chat session has not arrived. `PROJECT.md` §2 and §3 are honest stubs
  naming recker and that trigger — they were deliberately not filled by inference, since there is no
  code to infer from. Owner: recker, when the package lands.
- **No tests, and therefore no test gate in `CORE.md` §2.** There is no application code to test.
  §2 says so explicitly rather than staying silent about it.
- **No `.ai/patterns/` file for TypeScript or JavaScript**, which is the likely language for artifact
  source. The kit ships only `cpp.md` and `python.md`, so this is a real gap rather than a pruning.
- **`CORE.md` §2 is inferred, not observed.** It was written from one session in an empty
  repository. Revise it after the first real task — that is when you learn what an agent actually
  gets wrong here.
- **The cold-start check has not been run.** Verification so far is the three machine checks. The
  half that matters — opening a fresh agent session and asking it a question the contract should
  answer — is a human step and is still outstanding. **This is the one item bootstrap cannot close
  by itself.**
