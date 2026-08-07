# PHYS 215 — Preflight Artifact Build Log

**Fall 2026 · General Physics II — E&M and Optics.** One row per lesson artifact built from this
repository. Newest work appended in lesson order, not chronological order, so the table reads as a
build queue.

**What this file is for:** reviewing what was built and registering it. The `Registration slug` and
`Published` rows are the two values a prefill link is made of — the exact `#i=` / `id=` string and the
artifact's public URL. Copy them from here rather than retyping, and regenerate a link per
[`docs/operations/PREFILL-LINK.md`](../../../docs/operations/PREFILL-LINK.md). **The published URL
lives nowhere else in this repository**, it is not derivable from the source, and it is the only
pointer from a lesson back to the exact build a cadet is running.

> **All twelve were reviewed by recker and published on 2026-08-04.** `CORE.md` §6 reserves that
> approval to a human, and this is it: an agent drafted these, recker read this log, ruled on every
> lesson, and published. **Publishing is also the first time any of this JSX was parsed** —
> `check_artifact.py` is not a syntax check, and the Claude session that publishes is what actually
> parses it (`PROJECT.md` §9). Twelve clean publishes are twelve clean parses, and that is the first
> real evidence this repository's emitted JSX is valid.
>
> **What is not done is registration.** A published artifact that no lesson row points at is
> unreachable by a cadet; a lesson row whose `id` does not equal the artifact's `#i=` silently
> discards every report. Each row below carries both values, prefill links were generated from them
> on 2026-08-04, and clicking **Save** on the DFPM form is recker's.

---

## Status summary

| | lessons |
|---|---|
| **Built** | **2**, **3**, 4, 5, 7, 8, 9, 10, 13, 14, 15, 18, 19, 20, 21, 22, 24, 25, 26, 28, 29, 30, 31, 32, 33, 36, 37, 39, 41 — **twenty-nine, which is every lesson this course can build** |
| **Published** | **all twenty-nine.** Twelve on 2026-08-04; lessons 21, 22, 24, 25, 26, 28, 29 on 2026-08-05 after review; lessons 30, 31, 32, 33, 36, 37, 39, 41 the same day after review and correction; **lessons 2 and 3 the same day**, rebuilt and published. **Prefill links regenerate on demand** — `serve_artifact_review.py --links`. **Not one lesson row is registered on the DFPM site** |
| **Queued** | **nothing — the queue is empty.** Every lesson in this course is now built, done elsewhere, deferred, skipped, or sourceless. See the note below |
| **Rebuilt in this repository** | **2 and 3, on 2026-08-05.** They existed as pre-repository `.tsx` artifacts; recker added those files, then asked for them rebuilt the normal way and **the `.tsx` copies were deleted**. See the callout below for what was wrong with them |
| **Deferred — recker** | 16 (RC Circuits — new topic this semester; *"don't worry about it yet"*, 2026-08-04). It is *also* sourceless, so it appears in both rows |
| **Blocked — no grounding source** | **16** (RC Circuits) and **40** (Polarization). Neither has a source anywhere in the corpus; both are blocked on recker to supply one, not on a build. See "Lesson 40 has no source" below |
| **Skipped — lab** | 6, 11, 17, 27, 34, 38 (recker: labs deferred, use undecided) |
| **Skipped — no preflight** | 12, 23, 35 (the three Graded Reviews, `PF=N` in the schedule) |

**Two runs have finished here, and the second one is not published.** The first — lessons 21, 22,
24, 25, 26, 28, 29 — was built, reviewed and published on 2026-08-05. recker accepted every objective
but one: lesson 29's `hertz-confirmation`, rejected with the comment *"Drop it"*. **That rejection
was applied before publication** — lesson 29 runs three topics at ~3 active minutes, and the live
artifact is that version, not the four-topic build.

**The second run built the optics and modern tail — lessons 30, 31, 32, 33, 36, 37, 39 and 41 — on
2026-08-05, after recker cleared the long-standing 30–41 block. recker reviewed all eight the same
day and rejected SEVEN objectives across four of them; every one was applied, and recker then
published all eight the same day.** The rejections and what each cost are in the per-lesson sections
below; the short version is that lesson 33 lost a topic outright, lessons 32 and 33 were converted
to this course's `p`/`q`/`h`/`h'` notation, lesson 30 swapped its energy topic for the Poynting
vector, and lesson 39 lost the decay constant. **Every correction was applied BEFORE publication, so
each live artifact is the corrected version** — which matters, because a correction applied after
publication is a republish and a new lesson row, not an edit.

**So every artifact in this repository is published, and every one has been parsed — twenty-seven for
PHYS 215 and one for PHYS 310.** Publishing is the only JSX parser this project has (`PROJECT.md`
§9), so twenty-eight clean publishes are twenty-eight clean parses. **Keep this paragraph rather than
deleting it when it next goes stale, and keep the reasoning with it**: this sentence has now been
written true, gone false, and been written true again twice inside three days, because **every new
build re-creates the gap**. A fresh artifact is unparsed until it is published however green
`check_artifact.py` is, and that check is explicitly not a syntax check.

**What that leaves is registration, and it is now the only thing standing between this course and a
cadet's work reaching anything.** Every lesson is built, done elsewhere, deferred, skipped, or
sourceless, so the run does not continue — it stops. Two things wait: **a grounding source for
lessons 16 and 40**, which is recker's to supply, and **registration**. The second is the whole risk.
**Twenty-eight artifacts are live and not one lesson row is registered**, prefill links exist only
for the first twelve, and the registration and end-to-end submit check described at the bottom of
this file is what stands between twenty-eight live URLs and a cadet's work actually arriving. **That
hop fails silently** — the cadet completes the session, sees a success page, and the work reaches
nothing.

> **Lessons 2 and 3 were rebuilt in this repository on 2026-08-05, at recker's instruction.**
> This paragraph used to forbid exactly that, and the reason it gave was sound — so read what
> changed rather than assuming the old warning was wrong.
>
> **What happened.** recker added the two pre-repository artifacts as `.tsx` files, asked for as much
> as possible to be pulled out of them into this log, and then — on seeing what the inspection turned
> up — said to delete them and rebuild both the normal way. **The `.tsx` files are gone.** They were
> snapshotted and hash-verified before deletion, and the pilot's published originals are unaffected:
> they still live at their own URLs, which is where those two cadet-facing artifacts have always been.
>
> **What was actually wrong with the `.tsx` pair**, all four found by inspection before the decision:
> 1. **Suffix-less slugs** — `lesson-02-electric-charge-and-coulombs-law`, no 8-hex. They predate
>    contract §3.2 (2026-07-28), so `check_artifact.py` failed each at **31/32** on that one rule.
>    Every offering of the course would have shared one `activities` row.
> 2. **Invisible to the review page.** `serve_artifact_review.py` globs `*.jsx` (line 309), so neither
>    appeared for review and neither could get a registration prefill link.
> 3. **LF, where every artifact here is CRLF** — and `courses/** -text` means git stores that
>    verbatim rather than normalising it.
> 4. **An older model list**, `claude-sonnet-4-6` + `claude-haiku-4-5`, against `claude-sonnet-5` +
>    `claude-haiku-4-5` everywhere else. Two live families, so not stranded — but a generation behind.
>
> **The old warning's physics still holds and now applies to the NEW builds:** these two mint fresh
> 8-hex suffixes, so they register as **new lesson rows**, not replacements. **The pilot's originals
> are still live.** Whether the old rows are retired, or the old artifacts left running and these
> two shelved, is recker's call and is not a thing a build can decide.

> **TWELVE PUBLISHED ARTIFACTS DISAGREE WITH THEIR OWN PACING CONSTANT, and both lesson 2's and
> lesson 3's builds found it independently.** Recorded here, deliberately not fixed.
>
> Every artifact states its per-topic budget in **six** places that must agree. In twelve of them one
> string does not:
>
> | artifacts | `PER_TOPIC_BUDGET_MIN` | the string that disagrees |
> |---|---|---|
> | 4, 5, 7, 8, 9, 10, 14, 18, 19 | 2.0 | *"about its **3** min budget"* |
> | 13, 15, 20 | 3.0 | *"a soft budget of about **2** MINUTES"* and *"its full ~**2** min"* |
>
> Lessons 21 onward are clean, as are the new 2 and 3. **This is the defect the artifacts' own header
> comments have been warning about all along** — several say "the fifth was wrong in ten earlier
> artifacts here" — and this is the first time it has been enumerated rather than described.
>
> **Why it is not fixed here: all twelve are published.** Editing one is a republish, which mints a
> new 8-hex suffix and registers as a **new lesson row** (contract §3.2). Twelve rebuilds to correct
> one word each is a decision with a real cost on the receiver, and it is recker's, not an agent's.
>
> **What it actually costs while unfixed:** the tutor reads a PACING block that says a topic gets
> about three minutes while the constant it also reads says two. The budget is soft and advisory in
> both directions, so the likely effect is topic drift of about a minute, not a broken session.
>
> **What it costs a BUILD, which is the sharper risk:** rebasing a new artifact off one of the twelve
> inherits the bad string silently. Lesson 3's build hit exactly this — the brief named lesson 4 as
> the structural base — and rebased off lesson 2 instead after verifying the two are byte-identical
> through the machinery. **Rebase off lessons 21+ or 2/3, or grep all six strings by hand.**


---

## recker's review pass — 2026-08-04

All twelve artifacts were reviewed against this log. **Eight passed unchanged: 4, 7, 8, 9, 10, 14, 18
and 19.** Four were revised, in place. **No slug was re-minted** — none of these has been published or
registered, so there is no `activities` row to desynchronize and contract §3.2 is not in play. Each
lesson's own section below records what changed.

| lesson | recker's ruling | what was done |
|---|---|---|
| **5** | objectives 1–2 good; *"We do not discuss 3 or 4. Add in some kinematics discussion."* | dipole torque and induced dipoles replaced by two kinematics topics; extension problem C rewritten; three misconceptions replaced |
| **13** | objectives 1–3 good, drop 4 | `induced-charge-field` dropped — the dielectric polarization mechanism |
| **15** | objectives 1–3 good, drop 4 | `series-parallel-limits` dropped |
| **20** | objectives 1–3 good, drop 4 | `torque-from-moment-arms` dropped |

**Dropping a topic did not delete it from the tutor's reach.** In all four artifacts the removed
material stays fully transcribed in the grounding reference and moves into `scope_note` as
**engage-only**: the tutor answers it confidently and fully if a cadet raises it, never initiates it,
and never reports on it — it has no objective key, so it cannot reach the `d` payload or the cohort
rollup. That is how every other scoped-out block in these artifacts is handled, and it is the honest
option here, because the material is still sitting in the cadets' own assigned reading.

**Lessons 13, 15 and 20 now run 3 topics at ~3 active minutes instead of 4 at ~2.** The profile's
`session_minutes: 10` did not change and the cadet-facing header still promises "about 10 minutes",
so the per-topic budget widened to keep that true — 3 × ~3 rather than 4 × ~2. This is the same class
of internal contradiction the cross-cutting pacing fix repaired earlier the same day, so it was fixed
in the same pass rather than left to be noticed later. **Lesson 5 still runs 4 × ~2**, because it kept
four topics.

---

> **Recker's ruling on kinematics, 2026-08-04:** where a discussion needs single-particle kinematics
> that the grounding PDF does not contain, **standard mechanics knowledge is acceptable** for that
> part of the conversation. This settles the lesson 5 caveat below — the artifact already handles the
> kinematic half as Tier 2 "from your earlier coursework", which is exactly that. It does **not**
> extend to the electromagnetic content of any lesson, which stays strictly Tier 1 to the PDF.

---

## Built

### Lesson 2 — Electric Charge, Coulombic Force

| | |
|---|---|
| **File** | [`lesson_02_preflight_electric_charge_coulombic_force.jsx`](lesson_02_preflight_electric_charge_coulombic_force.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-02-electric-charge-coulombic-force-3a8e4e18` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/2058f785-477f-4455-9bec-adf4f37d88f3 |
| **Component** | `Lesson02Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax Vol. 2 §5.1 Electric Charge (pp. 170–175) + §5.2 Conductors, Insulators, and Charging by Induction (pp. 175–179) + §5.3 Coulomb's Law (pp. 179–183) |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Electric Charge, Coulomb's Law.pdf` — 14 pages, folios **170–183, unbroken** |
| **Cadets' reading** | Cengage 22.2–22.3 (different book, different numbering — never cited aloud) |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` **46 passed / 0 failed** (37 base + 9 `--forbid` guards proving nothing from lesson 4 survived the structural rebase) |
| **Status** | **PUBLISHED 2026-08-05.** Built, published the same day. **This is a NEW lesson row, not a replacement** — the pilot's pre-repository lesson 2 is still live at its own URL, and retiring it is recker's call. Not reviewed on the page; not registered; prefill link available via `serve_artifact_review.py --links` |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `charge-quantization-conservation` | Charge is quantized and conserved; charging moves electrons |
| 2 | `coulomb-inverse-square` | Coulomb's law for two charges: inverse square and sign rule |
| 3 | `conductor-insulator-mobility` | Conductor vs. insulator is electron mobility |
| 4 | `polarization-and-induction` | Polarization attracts neutrals; induction needs no contact |

**Extension problems:** A two-charge force + what tripling the separation does (approachable;
the divide-by-nine shortcut is cross-checked against the long computation) · B counting the
transferred electrons, then the force between rod and cloth (standard; the electron count is
confirmed by back-substitution) · C induction with two spheres, including what happens if you remove
the rod first (standard, fully qualitative; checked by conservation *and* by mirroring the sign for a
positive rod) · D electric vs. gravitational attraction in hydrogen (challenging; **Pass 2 takes the
ratio symbolically so `r` cancels before any arithmetic**, which both confirms the 2.3 × 10³⁹ and
proves the ratio is separation-independent). All four independently re-derived twice.

> **⚠ This lesson and lesson 3 share a source, and the split is deliberate.**
> `Vector Form of Coulomb's Law.pdf` (lesson 3) is a strict *subset* of this lesson's PDF — its five
> pages are printed pp. 179–183 and are byte-identical to pages 10–14 of this one. **Lesson 2 owns
> §5.1, §5.2, and the TWO-CHARGE case of Coulomb's law only**: magnitude, the inverse-square
> dependence, and direction from the two signs. **Superposition is lesson 3's** — Equation 5.2,
> Figure 5.16, Example 5.2's vector sum, component decomposition, and third-law pairs.
>
> That material is nonetheless **fully transcribed** in `TEXTBOOK_REFERENCE`, because removing it
> would make the reference lie about the attached PDF. `scope_note` makes it **engage-only**: the
> tutor answers it fully and confidently if a cadet raises it, never initiates it, never steers
> toward it, and never reports on it — it carries no objective key, so it cannot reach the `d`
> payload or the cohort rollup. Every extension problem is a two-charge problem on purpose, and the
> tutor is told not to improvise a multi-charge one.
>
> **The two artifacts share no objective key.** Verified across all 28 `.jsx` in this course:
> `grep -ho 'key: "[a-z0-9-]*"' courses/phys-215/artifacts/*.jsx | sort | uniq -d` prints nothing.

> **⚠ The equations in this PDF are vector paths — verified, not assumed.** No math font appears in
> any page's font list (IBMPlexSans and Mulish only), and the equation-bearing pages carry 457–2156
> Bézier `c` operators each. The text layer of printed p. 181 reads *"Our two charges and the distance
> between them are,"* → *"The magnitude of the force on the electron is"* → *"As for the direction"*:
> **three equations gone, no error, no placeholder, no gap marker.** Everything numeric in this build
> was transcribed off 140-dpi rasters; the text layer was used only for prose ordering and to
> cross-check folios.

> **⚠ The source ends mid-sentence — and it is a SEAM, not a hole.** Printed p. 183 stops inside
> Example 5.2 at the words *"at an angle of"*. So the printed angle, that Example's Significance
> paragraph, and any Check Your Understanding 5.2 are **not** in this artifact's grounding, and a
> `GAPS IN THE SOURCE` block forbids the tutor from attributing any of them to today's material.
> **Confirmed that the continuation is not lost:** page 1 of `Electric Fields, Electric Field
> Lines.pdf` (lesson 4's source) carries folio **184** and opens on *"that is, [angle] above the
> −x-axis"* — the completion of that very sentence. The two files tile the chapter with no overlap.
>
> The tutor may state the direction as a value it **derives** from the printed components
> (`F_x = −2.16e−14 N`, `F_y = +3.46e−14 N` → 58.0° above the −x axis, 122.0° from +x,
> |F| = 4.08e−14 N), said out loud as a derivation. That derivation was done from the printed
> components *before* the continuation page was opened, and the continuation then confirmed it — but
> the confirmation page is **not attached to this artifact**, which is why the instruction says
> derive-and-say-so rather than quote.

> **⚠ One real defect in the source, and a cadet who repeats it has read correctly.** Printed p. 176
> says insulators show electrostatic forces *"whereas conductors do not; any excess charge placed on
> a conductor would instantly flow away … leaving no excess charge around to create forces."*
> **Unqualified, that is false for an insulated conductor**, and the source contradicts it within
> three pages — **verified three independent ways, all inside the source**: (1) Figure 5.12's spheres
> are *"in contact with each other but insulated from the rest of the world"* and its caption ends
> *"the spheres retain net charges after the inducing rod is removed"*; (2) Figure 5.13's sphere is
> disconnected from ground before the rod is removed and is left *"with an induced negative charge"*;
> (3) Figure 5.9's caption has rubber and plastic acting as insulators *"that don't allow electric
> charge to escape outward"* from the metal inside.
>
> What the sentence is really about is Gilbert's failure to charge a metal **by rubbing** — a metal
> held in the hand is grounded through the experimenter. The missing qualifier is *"a conductor with
> a conducting path to its surroundings."* The artifact instructs the tutor to tell a cadet who
> repeats the printed claim that **they read it correctly**, then supply the qualifier and let them
> resolve it against the induction figures they also read. It is written into `TEXTBOOK_REFERENCE`
> (its own block), into probe topic 3, and as misconception 6.

> **⚠ The sign rule is one page past the cut, so it is taught as practice, not as doctrine.** The
> instruction *"do not include the negative sign of a negative charge when you substitute numbers"*
> lives in Example 5.2's Significance paragraph on p. 184 — **outside this artifact's grounding**.
> Examples 5.1 and 5.2 both *practise* it (both substitute magnitudes and settle direction
> physically), so the artifact teaches the practice and the `GAPS` block explicitly forbids
> attributing the rule to today's material.

**Other notes worth carrying forward:**
- **The sixth pacing string was wrong in the file this was rebased from.** `lesson_04` — published,
  4 topics, `PER_TOPIC_BUDGET_MIN = 2.0` — carries the offer-to-extend line as *"about its **3** min
  budget"*. It was corrected to 2 here rather than inherited, and all six strings were then grepped
  by hand and agree. **Nine published artifacts still have this mismatch: 4, 5, 7, 8, 9, 10, 14, 18,
  19** (2.0 constant, three-minute line). Lessons 13, 15, 20, 28, 29 and 33 say three on that line
  and are 3.0 artifacts, so they are consistent. Everything from lesson 21 onward is clean. Fixing
  the nine is a **republish and a new lesson row** each, so it is recker's call, not a cleanup.
- **The corroborating sequences all agree with the folio run, and are recorded as corroboration
  only.** Numbered equations 5.1 and 5.2 consecutive; Examples 5.1 and 5.2 consecutive; Figures 5.2
  through 5.17 with no gap; CYU 5.1 present (5.2 absent because of the end-cut). Folios 170–183 read
  off the rasters *and* independently off the text layer's top-of-page run.
- **Minor, not acted on:** p. 173 prints *"Charge be transferred from place to place"* — a dropped
  "can", a typo not a physics error. p. 177 glosses *dipole* as *"from a Latin phrase"*; both
  elements are Greek. Neither is cadet-visible, neither could be verified two independent ways as a
  *physics* claim, and no tutor instruction was built on either.
- **A pre-repository PHYS 215 lesson 2 artifact exists outside this repository** with a suffix-less
  slug. This is **not** that artifact and must not be registered against that row — the header
  comment in the `.jsx` says so at the slug. Register the string in the table above, exactly as
  written.

### Lesson 3 — Coulomb's Law and Superposition

| | |
|---|---|
| **File** | [`lesson_03_preflight_coulombs_law_and_superposition.jsx`](lesson_03_preflight_coulombs_law_and_superposition.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-03-coulombs-law-and-superposition-485f9923` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/472070b0-dda4-404d-a3bf-b0329c5bfa74 |
| **Component** | `Lesson03Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax Vol. 2, §5.3 "Coulomb's Law", printed pp. 179–183. Five pages, contiguous. Vector form and superposition only — the two-charge case is lesson 2's and is carried as ASSUMED |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Vector Form of Coulomb's Law.pdf` |
| **Cadets' reading** | Cengage 22.3 (different book, different numbering — never cited aloud) |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 56 passed / 0 failed (37 base + 19 `--forbid` guards proving no lesson-2 or lesson-4 slug, suffix, component name, objective key or source filename survived the rebase, and no stale three-minute pacing figure) |
| **Status** | **PUBLISHED 2026-08-05.** Rebuilt as a first-class artifact to replace the deleted pre-repository `.tsx` — which failed contract §3.2, was invisible to `serve_artifact_review.py`, and was LF — then published the same day. **This is a NEW lesson row, not a replacement**; the pilot's original is still live. Not reviewed on the page; not registered |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `force-superposition-vector-sum` | Net force is the vector sum of independent pairwise forces |
| 2 | `unit-vector-sign-bookkeeping` | Each term's direction from its own pair of signs, not one rule |
| 3 | `coulomb-component-resultant` | Resolve, add componentwise, recombine, fix the quadrant |
| 4 | `third-law-fixed-sources` | Third-law pairs force the fixed-source electrostatics idealization |

**No collision.** Checked against every key in `courses/phys-215/artifacts/*.jsx`: 110 keys total
across 30 artifacts, zero duplicates. In particular this artifact shares **no** key with lesson 2,
whose PDF strictly contains this one's.

> **⚠ The scope split with lesson 2 is the whole design of this artifact, and it is enforced in four
> places.** Lesson 3's source (printed pp. 179–183) is a strict **subset** of lesson 2's (pp. 170–183)
> — a genuine overlap, not a tiling seam like lessons 32/33. Lesson 2 owns §5.1, §5.2 and the
> **two-charge** case of Coulomb's law: Equation 5.1's magnitude, the inverse square, and the
> direction read off the two signs. Lesson 3 owns §5.3's **vector form and superposition**: Equation
> 5.2, the unit-vector bookkeeping, Figure 5.16's independence-of-contributions, Example 5.2's
> component decomposition and resultant, the Newton's-third-law complication, and the fixed-source
> idealization that defines *electrostatics*.
>
> The two-charge material is **fully transcribed** in `TEXTBOOK_REFERENCE` under a heading that reads
> `ASSUMED FROM THE PRECEDING LESSON — use it, do not re-teach or probe it`, so the tutor is exact and
> can build on it without hedging. `scope_note` then forbids re-teaching it, probing it, or reporting
> on it, and says plainly that a cadet who is shaky on it should be *helped and moved on*, not
> assessed. It carries **no objective key**, so it cannot reach the `d` payload or the cohort rollup.
> This is the mirror of the `scope_note` lesson 2 carries for superposition — deliberately, so the
> pair reads consistently from either side.

**Extension problems:** A **two sources on one line** — a positive and a negative source charge whose
forces on the test charge nonetheless point the *same* way (approachable; Pass 2 cross-checks with a
ratio `(|q₁|/|q₃|)(r₃₂/r₁₂)² = 4.167` that needs no number from Pass 1) · B **right-angle
superposition** — components, Pythagoras, and a resultant direction that must be *named against an
axis* (standard; Pass 2 checks `F₁/F₃ = (0.40/0.30)² = 1.7778` independently and brackets the angle
between `tan 60°` and `tan 61°` with no calculator) · C **symmetry first, arithmetic second** — part
(a) asks which way the force points with *no computation*, part (b) gets `kq²/(√2 a²)` (challenging;
Pass 2 re-derives it component-wise with the symmetry argument deliberately not used, and lands on
`0.70711` both ways) · D **what the third law costs** — the reaction force on a "fixed" source, why
B's answer decays if the sources are released, and the source charge's initial acceleration
(standard; Pass 2 order-of-magnitude checks `≈1e-6 N / 1e-6 kg ≈ 1 m/s²`, which is what turns "fixed
in place" from a phrase into a number). All worked answers independently re-derived twice.

**Transcribed off 150-dpi rasters:** 2 numbered equations (5.1, 5.2) plus the ε₀ and *k*ₑ displays,
5 figures (5.13–5.17), 2 worked Examples (the second cut mid-sentence), and 1 unanswered Check Your
Understanding (5.1).

**No interior hole — and the folio run was read, not inferred.** Printed folios **179, 180, 181, 182,
183**, five pages, unbroken, read off each raster individually. `PROJECT.md` §10 makes the folio
sequence the authority, so the other three sequences are recorded only as corroboration and each was
checked on its own: equations 5.1 (p. 179) and 5.2 (p. 181) consecutive; Examples 5.1 (pp. 180–181)
and 5.2 (pp. 182–183) consecutive; Figures 5.13–5.17 with no gap.

> **⚠ The equations are vector paths, and this was verified on *this* file rather than inherited.**
> No math font appears in any page's font list — `IBMPlexSans` and `Mulish` only, all five pages —
> and the pages carry **330 / 593 / 1267 / 400 / 2156** Bézier `c` operators respectively. The math
> is drawn. The text layer of printed p. 183 runs *"There are two forces:"* straight into *"We can't
> add these forces directly"*, then *"where"*, then *"and"*, then *"We find that"*, then *"at an angle
> of"* — **five equations gone**, including the entire component calculation this lesson exists to
> teach, with no error, no placeholder and no gap marker.

> **⚠ GAP: the source ends mid-sentence inside this lesson's central worked example.** Printed p. 183
> stops at the words *"at an angle of"*, partway through Example 5.2 — the multi-charge problem that
> is the whole point of the lesson. **Not in the grounding, therefore never quotable:** the printed
> value of the resultant angle, Example 5.2's Significance paragraph, and Check Your Understanding
> 5.2.
>
> **This is a SEAM, not a hole, and that was confirmed rather than assumed:** printed p. 184 is page 1
> of `Electric Fields, Electric Field Lines.pdf` (lesson 4's source) and it opens on the continuation
> of that very sentence. The two files tile the chapter with no overlap and no gap.
>
> **What the tutor may say instead.** `|F| = 4.08e-14 N` **is** printed on p. 183, so only the angle
> is missing. `F_x = -2.16e-14 N` and `F_y = +3.46e-14 N` are both printed, and from them
> `tan θ = 3.46/2.16 = 1.60`, so the resultant lies **58.0° above the −x axis**, equivalently
> **122.0° counterclockwise from +x**. The `GAPS IN THE SOURCE` block permits the tutor to state that
> **labelled out loud as a derivation from the printed components** — never as a quotation, and never
> with a section or page number. Figure 5.17 draws θ from the −x axis, which is why the derivation is
> phrased against that axis rather than +x.
>
> **A second consequence, recorded separately because it is easy to miss.** The explicit sign rule —
> *"do not include the negative sign of a negative charge when you substitute numbers; determine the
> directions physically instead"* — lives in the Significance paragraph, one page past the cut. Both
> worked examples **practise** it and the printed algebra shows them doing it. The reference tells the
> tutor to teach it as what the worked examples do, and forbids claiming today's material states it
> as a rule.

> **⚠ SOURCE DEFECT: Example 5.1's vector line has the wrong sign. Verified three independent ways.**
> The source prints `F = (8.25e-8 N) r̂` with a **plus**. It should be **minus**.
>
> 1. **The source's own definition of r.** p. 179 defines `r₁₂` as the displacement **from q₁ to q₂**,
>    and the Solution sets `q₁` = proton, `q₂` = electron. So `r̂` points from the proton **outward**
>    to the electron.
> 2. **The source's own boxed direction rule**, one page earlier: *"If the charges have different
>    signs, the force is in the **opposite** direction of r."* Proton and electron have different
>    signs, so the force is along `−r̂`.
> 3. **The source's own figure and prose.** In Figure 5.15 the label `r` sits on the segment drawn
>    from the proton outward to the electron and the red force arrow points back **inward**
>    (re-rendered at 400 dpi to be sure of the arrowhead); the prose says the force *"points radially
>    directly toward the proton"* and the Significance paragraph says it *"points in the inward
>    centripetal direction."*
>
> Only the sign is wrong — the magnitude `8.25e-8 N` and every other statement about that example are
> right. **Lesson 2's build transcribed this line verbatim without flagging it**, which is defensible:
> the `r̂` bookkeeping is this lesson's subject, not that one's. Here it is load-bearing, so the
> reference carries a `WHERE THIS SOURCE IS WRONG` block, and `scope_note` repeats the handling rule:
> **a cadet who quotes the printed line has read the book correctly and must be told so first**, then
> walked to the contradiction using the book's own three statements. It is the best available
> illustration of the lesson's central point — a magnitude formula carries no direction, so the sign
> in front of `r̂` is a separate decision.

> **⚠ NOTATION, not an error, but the place careful cadets stall.** Example 5.2's printed vector line
> is `F = (1/4πε₀)[ (q₂q₁/r₁₂²) ĵ + ( −q₂q₃/r₃₂² ) î ]`. Read as **signed** products the first term
> comes out pointing in `−y`, contradicting both the figure and the attraction the signs demand; read
> as **magnitudes** — with the directions already supplied by the `ĵ` and `−î` chosen by inspection —
> both terms are right. The component lines settle it: they substitute `4.806e-19`, `3.204e-19` and
> `8.01e-19`, all positive. The reference records this as a *notation caution* rather than a defect,
> and tells the tutor that a cadet who spots the tension has read carefully and should be told so.

> **⚠ The sixth pacing string: lesson 4 — the structural base BRIEF-0203 specified — has it wrong.**
> `lesson_04` carries *"about its **3** min budget"* on the offer-to-extend line beside a
> `PER_TOPIC_BUDGET_MIN = 2.0`. So do twelve others; **thirteen of the thirty artifacts in this
> directory currently disagree with their own constant on that one line.** This build was therefore
> rebased off **lesson 2** instead, which is byte-identical to lesson 4 through the whole machinery
> (verified: the `STYLE`…`TEXTBOOK_REFERENCE` region diffs to nothing, and `sleep()`…EOF diffs only in
> the component name and the two header titles) and had already fixed the pacing line. All six strings
> were then grepped by hand and agree at 2: the constant; the `time_budget` block; *"a soft budget of
> about 2 MINUTES"*; *"about 2 active minutes each"*; *"its full ~2 min"*; and *"about its 2 min
> budget"*. No tool checks this.

**Judgement calls, and what would reverse each:**

- **Four topics, not three.** §5.3's fourth printed learning objective is superposition itself, and
  the section supplies four separable ideas: independence, per-term direction, the component
  mechanics, and the third-law/fixed-source argument. *Reversed if* recker judges topic 4
  (`third-law-fixed-sources`) too conceptual for a preflight — it is the one with no arithmetic, and
  it is the one to drop if the session runs long. Dropping it is a rebuild and a new slug.
- **Example 5.1 is grounded but not probed.** It is a two-charge calculation and therefore lesson
  2's. It stays in the reference because the sign defect lives in it and because it is where the
  magnitude-then-direction discipline is first practised. *Reversed if* the pair should share no
  worked example at all — but then the sign defect has no home.
- **The derived angle is stated, not withheld.** BRIEF-0203 permits it as a labelled derivation and
  the components it comes from are printed. *Reversed if* recker prefers the tutor to say only that
  the printed material stops there.
- **`unit-vector-sign-bookkeeping` is a separate objective from `force-superposition-vector-sum`.**
  They could be one topic. They are split because the source splits them — the parenthetical about
  `F_i` not necessarily lying along `r̂_i` is its own paragraph — and because the diagnostic signals
  differ (adding magnitudes vs. applying one global sign rule). *Reversed if* recker wants a fourth
  topic elsewhere; merging these two is the cheapest way to free a slot.

**Not done, deliberately:** not published, no prefill link generated, no `REVIEW-NOTES.json` entry,
and `BUILD-LOG.md` itself not edited (this section was delivered as a fragment for splicing).
`check_artifact.py` is **not a syntax check** — no JSX on this machine has been parsed, and
publishing is the parser.

### Lesson 4 — Electric Fields and Superposition

| | |
|---|---|
| **File** | [`lesson_04_preflight_electric_fields_and_superposition.jsx`](lesson_04_preflight_electric_fields_and_superposition.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-04-electric-fields-and-superposition-479afcad` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/2758e374-8755-482c-af1b-fb0972dc6444 |
| **Component** | `Lesson04Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax University Physics Vol. 2, §5.4 (pp. 184–189) + §5.6 (pp. 198–201), plus the §5.5 fragment on p. 198 |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Electric Fields, Electric Field Lines.pdf` |
| **Cadets' reading** | Cengage 22.4–22.5 (different book, different numbering — never cited aloud) |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 43 passed / 0 failed |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `field-definition` | Electric field as force per unit test charge |
| 2 | `field-superposition` | Vector superposition of fields from several charges |
| 3 | `field-direction-sign` | Source sign sets field direction; test sign sets force |
| 4 | `field-lines` | Reads field-line diagrams: density, tangent, line count |

**Extension problems:** A point-charge field + force on a placed charge (approachable) · B null point
between unequal opposite charges (standard) · C 2-D superposition with symmetry cancellation
(standard) · D field-line counting + null point (challenging). Every worked answer independently
re-derived twice; B, C and D verified by back-substitution to zero residual.

**Notes worth carrying forward:**
- The equations in this PDF are **vector paths** — `pdftotext` and `pypdf` both return the prose with
  every equation silently missing. They were transcribed off 150-dpi page rasters (PyMuPDF). Assume
  the same for every OpenStax PDF in this corpus; a text-only extraction here produces a confident,
  equation-free reference and nothing warns you.
- The source pages **cut off mid-sentence** in Example 5.4's far-field limiting-case check (bottom of
  printed p. 189; pp. 190–197 are absent). Recorded as an explicit gap inside `TEXTBOOK_REFERENCE`
  with instructions for the tutor to reason it and say so, rather than quote.
- OpenStax's Figure 5.28 caption says "two identical charges" for what is plainly a **dipole**. The
  reference tells the tutor to read the physics, not the caption.

### Lesson 5 — Charged Particles in Uniform Elec. Fields

| | |
|---|---|
| **File** | [`lesson_05_preflight_charged_particles_in_uniform_elec_fields.jsx`](lesson_05_preflight_charged_particles_in_uniform_elec_fields.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-05-charged-particles-in-uniform-elec-fields-1c5bc31d` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/c8d8a66e-ce72-4c70-be32-acb8465112b2 |
| **Component** | `Lesson05Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 — §5.5 closing results (pp. 196–198, incl. Example 5.9) + §5.6's last figure (p. 202) + §5.7 Electric Dipoles in full (pp. 202–204) |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Charged Particles in Uniform Electric Fields.pdf` |
| **Cadets' reading** | Cengage 22.5 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 40 passed / 0 failed (37 base + 3 `--forbid` guards proving no dipole objective survived) |
| **Status** | **PUBLISHED 2026-08-04** — revised on recker's review the same day, then published; prefill link generated; registration pending |

**Objectives chosen** — *3 and 4 replaced on recker's ruling, 2026-08-04:*

| # | key | label |
|---|---|---|
| 1 | `uniform-field-source` | How charged planes superpose into a uniform field |
| 2 | `force-on-charge-uniform` | Constant force qE gives constant acceleration |
| 3 | `trajectory-component-separation` | Parabola: components separate and share one clock |
| 4 | `charge-to-mass-and-time-in-field` | q/m sets a; more time in the field means more deflection |

**Extension problems:** A parallel-plate field + force on an electron (approachable) · B proton
accelerated across the gap (standard, cross-checked by work-energy) · C **the same field, two
different particles** — proton vs. electron accelerations, which crosses first, the proton's arrival
speed, and whether ignoring gravity was legitimate (standard; **Pass 2 takes the ratio symbolically,
so `E` and `q` cancel before any arithmetic and the 1836 is shown to be field-independent**) · D
electron deflected crossing the plates (challenging, cross-checked via exit angle). All independently
re-derived twice; C's numbers were computed and re-checked for this revision.

> **⚠ C's part (b) is the one to look at.** From rest across the same gap the time goes like
> `1/sqrt(a)`, so the electron arrives about **43** times sooner, not 1836 — `sqrt(1836) = 42.85`. A
> cadet who answers 1836 has the physics right and has dropped the square root, which is exactly the
> failure worth catching in a preflight rather than on an exam.

> **⚠ The slug keeps the schedule's abbreviation "elec".** The topic string is taken verbatim from
> the schedule row (`Charged Particles in Uniform Elec. Fields`) because topic text is load-bearing
> for this course's slug. The cadet-facing header title spells out "Electric" — only the slug and
> filename carry the abbreviation. **If you prefer the slug spelled out, say so before publishing**;
> changing it afterward is a rebuild with a new suffix and a new lesson row.

> **⚠ This PDF does not match its filename, and recker's ruling is what resolves it.** Despite being
> called *Charged Particles in Uniform Electric Fields*, it contains **no single-particle
> kinematics** — no trajectory derivation, no deflection-between-plates worked example. What it
> actually holds is how a uniform field is *made* (disk → infinite plane → two planes) and what a
> uniform field *does to dipoles*. The original build scoped its probe topics to that and got two
> dipole topics; **recker dropped both on review and asked for kinematics instead**, which is what
> the lesson is actually for.
>
> **So topics 3 and 4 are now deliberately Tier 2**, under the kinematics ruling above. `F = qE` and
> `E = sigma/eps0` stay strictly Tier 1 from the PDF; the trajectory, the component separation, the
> `1/v²` scaling and the `q/m` argument are cited as *"from your earlier coursework"* / *"from
> Physics I"*, and the tutor is forbidden — in the topic text **and** in the `scope_note` — from
> attaching a section, figure or example number to any kinematic result, or from saying today's
> material shows a trajectory. **This is the only artifact in the corpus that probes material its
> grounding does not contain**, and it does so on an explicit instructor authorization that is
> recorded in the file itself, not inferred.
>
> **A better PDF would still be better.** The authorization removes the objection; it does not
> supply a worked deflection example. If a source covering charged-particle motion in a uniform field
> exists, this lesson is second only to lesson 20 in how much it would gain.

> **⚠ Dipoles did not vanish — they became engage-only.** §5.7 stays fully transcribed in
> `TEXTBOOK_REFERENCE` (removing it would make the reference lie about the attached PDF), and the
> `scope_note` now tells the tutor to engage fully and confidently if a cadet raises a dipole, never
> to initiate one, and never to report on it. Misconceptions 3–5 and one prerequisite bullet, all
> dipole-specific, were replaced with kinematics equivalents; the lateral connection to dielectrics
> survives but is now explicitly conditional on the cadet opening it.

### Lesson 7 — Charge Distributions, Electric Flux

| | |
|---|---|
| **File** | [`lesson_07_preflight_charge_distributions_electric_flux.jsx`](lesson_07_preflight_charge_distributions_electric_flux.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-07-charge-distributions-electric-flux-32174e58` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/46d7679b-0eab-4bbf-b054-11872c1d3d08 |
| **Component** | `Lesson07Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 §5.5 (pp. 190–197) + §6.1 Electric Flux (pp. 220–227) — both contiguous, no page gaps |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Charge Distributions, Electric Flux.pdf` |
| **Cadets' reading** | Cengage 23.1–23.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 41 passed / 0 failed |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `charge-density-integral` | Picks lambda/sigma/rho; turns the sum into an integral |
| 2 | `symmetry-integration` | Uses symmetry to cancel components before integrating |
| 3 | `limiting-cases` | Checks results by limits; falloff weakens with source size |
| 4 | `flux-dot-product` | Flux as E dot A; orientation and the outward normal |

**Extension problems:** A picking the right density (approachable) · B finite-line field + point-charge
check (standard, cross-checked by ratio) · C infinite-wire falloff vs. a point charge (standard,
cross-checked via the alternate form of Eq. 5.13) · D flux at three orientations + net flux through a
closed box (challenging, cross-checked by projected area). All re-derived twice.

**Note:** this PDF *does* match its title — §5.5 and §6.1, contiguous, no gaps. Topic 4 deliberately
ends at "net flux depends on what is enclosed" and stops there; Gauss's law is lesson 8 and the tutor
is instructed not to work it.

### Lesson 8 — Gauss's Law and Its Applications

| | |
|---|---|
| **File** | [`lesson_08_preflight_gausss_law_and_its_applications.jsx`](lesson_08_preflight_gausss_law_and_its_applications.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-08-gausss-law-and-its-applications-5f57cc30` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/fb589ede-f50b-4658-a818-56bf04836e68 |
| **Component** | `Lesson08Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 §6.2 "Explaining Gauss's Law" (pp. 228–234) + §6.3 "Applying Gauss's Law" (pp. 234–245) — contiguous, but **truncated at the end**; see the note below |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Gauss's Law and Its Applications.pdf` |
| **Cadets' reading** | Cengage 23.3–23.4 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `enclosed-charge-flux` | Flux set by enclosed charge; size and shape drop out |
| 2 | `total-field-vs-qenc` | E in the integral is total; q_enc is inside only |
| 3 | `symmetry-picks-surface` | Matches the Gaussian surface to the distribution |
| 4 | `inside-outside-qenc` | Builds q_enc(r); field inside versus outside |

**Extension problems:** A net flux for three enclosure cases + "is E zero there?" (approachable,
cross-checked via `Phi = 4·pi·k·q` rather than `q/eps0`) · B uniform nonconducting sphere, inside and
outside (standard, inside re-derived from `rho_0·r/(3·eps0)`) · C long cylindrical shell, then the
infinite-line cross-check (standard, Pass 2 reaches the same field using neither `sigma_0` nor `R`) ·
D non-uniform `rho = a·r` sphere with continuity at `R` (challenging, outside re-derived by
point-charge equivalence). All re-derived twice and verified numerically.

**Transcribed off 150-dpi rasters:** 9 numbered equations (6.4–6.12) plus ~20 unnumbered displays,
21 figures (6.13–6.33), 4 worked Examples (6.5–6.8), 4 unanswered Check Your Understanding prompts.

> **⚠ The source stops mid-derivation on its last page.** p. 245 ends *"…we can immediately determine
> the electric field at a point at height z from a uniformly charged plane in the xy-plane:"* — and
> nothing follows. The infinite-plane result `E = sigma_0/(2·eps0)` and its equation number are **not
> in the PDF**. Handled with an explicit `=== GAPS IN THE SOURCE ===` block: the tutor is told the
> source stops there, told not to claim to quote it, and instructed to **derive the last step in
> front of the cadet** from Eqs. 6.11 and 6.12, which are both present and settle it in one line
> (`A` cancels). That is Tier-1 reasoning from material the PDF holds, not reconstruction from
> memory — but it is a judgment call and it is flagged here so recker can overturn it.

**Two smaller source defects, both recorded in the reference rather than silently corrected:**
- **The PDF opens mid-example** — its first line is the "Significance" of a worked example whose
  statement lives on p. 227, i.e. inside *lesson 7's* PDF. The tutor is told not to reconstruct it.
- **Example 6.5(d)'s printed arithmetic sums three of the four interior charges** shown in Figure
  6.19. Transcribed verbatim with the discrepancy noted inline; not "fixed" to match the figure.

**Unverified:** nobody has confirmed that Cengage 23.3–23.4 covers the same span in the cadets' book.
The OpenStax sections unambiguously cover Gauss's law, so the *topic* match is solid; the chapter
mapping is inherited from the schedule and cannot be checked mechanically.

### Lesson 9 — Electric Potential Difference

| | |
|---|---|
| **File** | [`lesson_09_preflight_electric_potential_difference.jsx`](lesson_09_preflight_electric_potential_difference.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-09-electric-potential-difference-b3ba716f` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/419f85b1-66a0-42b9-8c13-6e587cc725d0 |
| **Component** | `Lesson09Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 §7.1 "Electric Potential Energy" (pp. 268–274) + §7.2 "Electric Potential and Potential Difference" (pp. 274–284) — contiguous |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Electric Potential Difference.pdf` |
| **Cadets' reading** | Cengage 24.1–24.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `potential-vs-energy` | V = U/q: potential versus potential energy |
| 2 | `field-from-voltage` | E from Delta V over d, and which way V drops |
| 3 | `charge-energy-conservation` | K + U with charge; the electron-volt |
| 4 | `potential-field-integral` | V from the integral of E; path and reference |

**Extension problems:** A battery energy vs. voltage, and the electron count (approachable, Pass 2 by
ratio factorization) · B parallel plates at 450 V — E, work in J and eV, electron speed (standard,
Pass 2 back-substitutes through `F = W/d` and scales speed by `sqrt(V)` off the source's own printed
result) · C potential around a −4.0 nC charge, the zero-difference arc (standard, Pass 2 by the
r-ratio identity) · D a 12.0 keV electron gun, breakdown margin, exit speed vs. c (challenging, Pass
2 through joules rather than the eV↔V identity). All re-derived twice; **every number printed in the
source was independently re-verified too, and all nine worked Examples reproduce exactly.**

**Transcribed off 150-dpi rasters:** 7 numbered equations (7.1–7.7) plus ~20 unnumbered displays,
16 figures (7.2–7.17), 9 worked Examples (7.1–7.9), 6 unanswered Check Your Understanding prompts.

> **⚠ Four sign/notation inconsistencies in the printed source**, all real and all recorded in a
> dedicated `SIGN AND NOTATION CAVEATS` block rather than silently normalized — probe topic 2 asks
> about signs directly, so leaving them silent was the worst option:
> 1. **`W_12` names two different forces.** p. 268 defines it as the *applied* force's work; the very
>    next displayed evaluation and Example 7.1 use the *electric* force's integrand. They differ by
>    an overall sign. Everything downstream is self-consistent with the electric-force reading, and
>    that is the one the tutor is told to use — while never saying "the work" without saying whose.
> 2. **`V_AB` is both a signed difference and a positive magnitude.** Figure 7.14's caption prints
>    `E = -ΔV/d` while the annotation *inside the same figure* prints `E = V_AB/d`. The tutor is told
>    not to let subscript order carry the physics: settle direction from "the field points toward
>    lower potential", then use magnitudes.
> 3. **Example 7.2's Strategy sentence is a copy-paste error from Example 7.1** — it claims ΔU equals
>    the kinetic energy when it is the negative of it. The example's own Significance says so
>    correctly two lines later.
> 4. **The Coulomb constant is printed two ways** — `8.99e9` in Examples 7.1/7.2/7.9, `9.0e9` in
>    Example 7.3. Both reproduce their own printed answers; the tutor is told to score neither wrong.

> **One truncation, and it costs nothing.** Printed p. 284 stops mid-sentence inside Example 7.9's
> closing commentary — *"…to obtain a numerical result. Notice"*. **Both legs of the calculation and
> the 300 V answer are complete on the page**; only the commentary is lost. Recorded in a
> `GAPS IN THE SOURCE` block that forbids claiming to quote the rest and instead has the tutor make
> the supportable observation itself (the arc leg contributed exactly zero, which follows in one line
> from the printed `rhat · phihat = 0`).

**Unverified:** as with lesson 8, nobody has confirmed Cengage 24.1–24.2 covers the same span. Here
the grounding is a *superset* of the OpenStax topic (§7.1 is included as §7.2's prerequisite), which
is the safe direction — but if the Cengage sections are *wider*, part of the cadets' reading is
ungrounded. One look at the Cengage table of contents would settle it.

### Lesson 10 — Electric Potential, Potential Energy

| | |
|---|---|
| **File** | [`lesson_10_preflight_electric_potential_potential_energy.jsx`](lesson_10_preflight_electric_potential_potential_energy.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-10-electric-potential-potential-energy-c627bfa9` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/2de12971-225a-48dc-a8b7-034a0fdd1d9d |
| **Component** | `Lesson10Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 §7.3 "Calculations of Electric Potential" (pp. 285–295) + §7.4 "Determining Field from Potential" (pp. 296–299) + §7.5 "Equipotential Surfaces and Conductors" (pp. 299–306, truncated) |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Electric Potential, Potential Energy.pdf` |
| **Cadets' reading** | Cengage 24.3–24.4, 24.6 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `point-charge-potential` | V = kq/r, and adding potentials as numbers |
| 2 | `field-from-potential` | E = -dV/ds: the field is the slope of V |
| 3 | `equipotential-surfaces` | Equipotentials: perpendicular to E, no work along |
| 4 | `conductor-equipotential` | Conductors: one potential, E = 0 inside |

**Extension problems:** A two point charges — V at the midpoint, the V = 0 point, and whether E is
zero there (it is not: 4.8e4 N/C) (approachable) · B `V(x,y,z) = 4x² − 3xy + 2yz` → the field
components, magnitude, steepest ascent, force (standard, **Pass 2 by numerical finite differences at
h = 1 mm** instead of symbolic derivatives) · C conducting sphere inside and out, then two spheres on
a wire (standard, Pass 2 via the `E = V/r` gradient identity and a charge route to the density ratio)
· D parallel plates, the 50-V equipotential ladder, then a 2.00-mm conducting slab inserted, 384 V →
288 V (challenging, Pass 2 by a piecewise 3 mm + 0 + 3 mm integral). All re-derived twice; all 13 of
the source's own printed answers reproduce exactly.

**Transcribed off 150-dpi rasters:** 10 numbered equations (7.8–7.17) plus ~20 unnumbered displays,
22 figures (7.18–7.39), 11 worked Examples (7.10–7.20), 6 unanswered Check Your Understanding
prompts.

**Zero page overlap with lesson 9** — that build ran pp. 268–284, this one starts at 285, exactly
adjacent. Better: **p. 285's opening lines complete the sentence lesson 9's PDF cut off mid-word**,
and that completion is recorded here under `WHERE THE PREVIOUS PAGES LEFT OFF`. Lesson 9's material
sits in `prerequisites`, cited as "from your earlier coursework".

> **⚠ The artifact tells the tutor the textbook is wrong in one place — verified independently
> before it shipped.** Figure 7.26 annotates the infinite-line field as `E = lambda/(2·eps0) · (1/s)`
> while the solution text on the *same page* uses `E = 2·k_e·lambda·(1/s)`. Since `2·k_e =
> 1/(2·pi·eps0)`, the correct expression is `lambda/(2·pi·eps0·s)` — **the figure has dropped the pi
> and is pi times too large.** Checked three ways: the raster was read directly (the figure plainly
> prints `2ε₀`), the two constants evaluate to `5.65e10` versus `1.798e10`, and their ratio is
> `3.1407`. The tutor is told to use the text's form, and — this is the part that matters — **to
> treat a cadet who quotes the figure as having read the book correctly and the book as being wrong,
> not as having made an error.**

**Six further source defects, recorded in a `SIGN AND NOTATION CAVEATS` block rather than silently
normalized:** Figure 7.28 is cited for a point charge but drawn and captioned for a uniformly charged
sphere (arrows grow with radius — the interior behaviour, not `1/r²`), so the tutor uses it for
direction only · Figures 7.20 and 7.21 carry byte-identical captions · Figure 7.37's caption is
garbled (*"A portion is released at the positive plate"*) and the tutor is forbidden from guessing
the intended word · the Coulomb constant appears three ways and with two values · the field component
along a displacement is `E_s` in the body text and `E₁` in Figure 7.27 · `ΔV` is again used as both
a signed difference and a magnitude, the same trap lesson 9 recorded.

> **⚠ Truncation, and one absent figure.** The last page stops mid-sentence — *"The surface charge
> density is higher at locations with a"* — and **Figure 7.40, referenced twice on that page, is not
> in the PDF.** The printed equation `sigma_1·R_1 = sigma_2·R_2` determines the missing conclusion in
> one line, so the `GAPS IN THE SOURCE` block has the tutor derive it rather than attribute it, and
> **forbids describing Figure 7.40 at all.**

> **⚠ Deliberate scope exclusion — read this before reviewing the probe topics.** The four topics
> exclude the continuous-charge-distribution material (Examples 7.13–7.16: line, ring, disk, infinite
> wire) and the far-field dipole expansion, even though both are Tier-1 today's content and are fully
> transcribed in the grounding. The reason is that the cadets' assigned Cengage sections are **24.3,
> 24.4 and 24.6 — skipping 24.5**, which the agent inferred is the continuous-distribution section
> from the standard chapter layout. **That inference was not checked against the actual Cengage table
> of contents.** The `scope_note` tells the tutor to engage fully if a cadet raises a ring, disk,
> wire or dipole moment, and simply not to initiate them. If 24.5 is something else in your edition,
> the rationale changes — the topics themselves stand on their own merits either way.

### Lesson 13 — Capacitance, Energy, and Dielectrics

| | |
|---|---|
| **File** | [`lesson_13_preflight_capacitance_energy_and_dielectrics.jsx`](lesson_13_preflight_capacitance_energy_and_dielectrics.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-13-capacitance-energy-and-dielectrics-7444aa79` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/2082df6c-c8b6-473d-b13e-ea2df97041b1 |
| **Component** | `Lesson13Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 ch. 8 "Capacitance" — §8.1 (pp. 323–332), §8.3 (339–342), §8.4 (342–345), §8.5 (345–351). **§8.2 is absent; see below** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Capacitance, Energy, and Dielectrics.pdf` |
| **Cadets' reading** | Cengage 25.1–25.2, 25.4–25.5 (**skipping 25.3**) |
| **Probe topics** | **3** · ~3 active min each · ~10 min *(was 4 × ~2 before recker's review)* |
| **Checks** | `check_artifact.py` 38 passed / 0 failed (37 base + 1 `--forbid` guard proving the dropped key is gone); 45/45 at build time |
| **Status** | **PUBLISHED 2026-08-04** — revised on recker's review the same day, then published; prefill link generated; registration pending |

**Objectives chosen** — *4 dropped on recker's ruling, 2026-08-04:*

| # | key | label |
|---|---|---|
| 1 | `capacitance-definition` | C = Q/V, but fixed by geometry alone |
| 2 | `stored-energy` | U = QV/2 = CV^2/2 = Q^2/2C; energy in the field |
| 3 | `dielectric-battery-state` | Dielectric: C = kappa*C0; the battery decides the rest |
| ~~4~~ | ~~`induced-charge-field`~~ | **dropped** — polarization, induced surface charge, `kappa = E0/E`, dielectric strength. Still in the grounding; now engage-only, and the tutor may use a sentence of it to justify an answer inside topic 3, since the mechanism is *why* topic 3's rule is true |

**Extension problems:** A air parallel-plate — C and Q at 24 V, then doubled spacing, then 48 V, with
the payoff that C never moves (approachable) · B disconnected capacitor — energy density verified
against `u·A·d = U`, then the plates pulled apart at fixed Q (standard, Pass 2 re-derives the doubled
energy as *same density, twice the volume*) · C **the battery trap worked twice** — the same κ = 4.5
slab inserted with the battery disconnected and with it connected, including induced charge in each
case (standard) · D design to the breakdown limit, air vs. Teflon, and the factor of 42 (challenging,
Pass 2 collapses to `kappa·eps0·A·E_c`, where `d` cancels). All re-derived twice; every printed
source answer re-verified.

**Transcribed off 150-dpi rasters:** 13 numbered equations (8.1–8.6, 8.9–8.15), 18 figures, 8 worked
Examples, 8 unanswered Check Your Understanding prompts, and Table 8.1.

> **⚠ A six-page hole in the middle of the source — the largest gap this corpus has produced.**
> Printed pp. **333–338 are absent: the whole of §8.2 "Capacitors in Series and in Parallel."** The
> surrounding prose gives no sign of it; it was caught from the folio sequence and confirmed three
> ways — the numbered equations jump 8.6 → 8.9, the worked Examples jump 8.3 → 8.8, and the Check
> Your Understanding prompts jump 8.4 → 8.6. `GAPS IN THE SOURCE` **forbids the tutor from stating
> any series or parallel rule or computing an equivalent capacitance**, and the `scope_note` has it
> say plainly that combining capacitors is separate material.
>
> **This is very probably deliberate rather than damage.** The one section excised is exactly the one
> the cadets' assignment skips — Cengage 25.3. The excerpt looks cut to match the reading. **That
> correspondence is an inference; nobody has checked a Cengage table of contents** (the same
> unverified inference lesson 10 rests on).

**Consequences of the hole, both handled:** a **three-panel capacitor-network figure survives with no
caption and no number** — its caption was on the missing pages. It was identified as Figure 8.14 by
cross-reference *and* by arithmetic (12 µF in series with 2 + 4 µF reproduces Example 8.8's printed
4.0 / 8.0 / 8.0 V and its 4.0 µF equivalent), and the reference describes the panels while refusing
to quote a caption that does not exist. And **Example 8.8 consumes results from the missing pages** —
its voltages are asserted, not derived — so its takeaway is scoped to "energies add", which is a
statement about energy rather than about combination rules.

> **⚠ The load-bearing defect is not the hole — it is an unstated condition, and it is probe topic 3.**
> The sentence introducing Eq. 8.12 says flatly and without qualification that a dielectric makes the
> stored energy *smaller* by κ. That is only true if the battery was disconnected; the derivation
> smuggles the condition in by substituting `Q_0` for `Q`. **The source corrects itself only in a
> Check Your Understanding seven printed pages later.** The tutor is told explicitly that a cadet who
> says "energy always drops" has read the book correctly and is not to be marked wrong.

**Eight further source defects recorded rather than normalized**, including: two incompatible
induced-charge formulas under identical symbols (`(1 − 1/κ)Q_0` for the isolated case in Example
8.11, `(κ − 1)Q_0` for the connected case in 8.12) · facing derivations using opposite sign
conventions, one of them writing the path element as `dl_p` · Teflon's dielectric strength printed as
a range in the table and as a single number in the prose, with the worked result computed from the
latter · Example 8.8 printing `130 µJ` where the exact value is `128 µJ`, so a cadet computing 128 is
right · a word missing from the printed definition of "capacitor", reported as a typo and not guessed
at · and **Figure 8.10 referenced on p. 332 and absent**, which the tutor is forbidden to describe.

**This is the first PDF in the corpus that does not truncate at the end** — p. 351 closes cleanly.
Stated in the reference explicitly so nobody goes looking for a cut that is not there.

### Lesson 14 — Current, Resistance, and Electrical Power

| | |
|---|---|
| **File** | [`lesson_14_preflight_current_resistance_and_electrical_power.jsx`](lesson_14_preflight_current_resistance_and_electrical_power.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-14-current-resistance-and-electrical-power-06497f19` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/e92aac23-6642-4f8e-89bd-61c5969de204 |
| **Component** | `Lesson14Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 ch. 9 — §9.1 (pp. 362–365), §9.3 (371–380), §9.4 (380–384), §9.5 (384–389). **§9.2 is absent; see below** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Current, Resistance, and Electrical Power.pdf` |
| **Cadets' reading** | Cengage 26.1–26.2, 26.6 (**skipping 26.3–26.5**) |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `current-as-charge-rate` | I = dQ/dt; the ampere as one coulomb per second |
| 2 | `resistance-vs-resistivity` | R = rho*L/A; object property vs material property |
| 3 | `ohms-law-empirical` | V = IR is empirical, not a law of nature |
| 4 | `power-three-forms` | P = IV = I^2*R = V^2/R; pick by what is held fixed |

**Extension problems:** A flashlight — charge, electron count, power, energy, kW·h, cost
(approachable, Pass 2 gets the charge from `Q = E/V` without ever multiplying `I × t`) · B copper
wire — area, R, J, E, V, then double the diameter, then nichrome at matched R (standard, **Pass 2 uses
the table's *conductivity* column and agrees to 0.04 %, the residual being the table's own rounding**)
· C a 60 W bulb — double V versus halve R (factor 4 vs. 2), plus cold-filament inrush (standard) ·
D a 12 m wire run — drop, `I²R`, gauge substitution by ratio, 75 °C, annual cost (challenging, **Pass
2 gets the delivered power by subtraction from the supply voltage** instead of `I²R`). All re-derived
twice; every printed source answer re-verified.

**Transcribed off 150-dpi rasters:** 11 numbered equations, 17 figures, 9 worked Examples, Table 9.1,
9 unanswered Check Your Understanding prompts.

> **⚠ A five-page hole, and neither edge cuts a sentence.** Printed pp. **366–370 are absent: §9.2
> "Model of Conduction in Metals."** Found from the folio sequence, then confirmed by **five**
> independent cross-checks all skipping in step — equations 9.3 → 9.6, Examples 9.2 → 9.4, Check Your
> Understanding 9.2 → 9.4, figures 9.5 → 9.12. **Nothing in the prose reveals it**, which is why the
> folio check is now standard practice on every build. A second, smaller gap sits at the far end:
> Table 9.2 is referenced on p. 389 and is not present, and §9.6 Superconductors is absent entirely.

**The hole costs a probe topic, and that is recorded rather than worked around.** §9.2 is where drift
velocity and the free-electron model live. **`J = n·q·v_d` survives on p. 371 with neither `n` nor
`v_d` defined on any present page** — so the tutor is forbidden from discussing carrier densities,
drift speeds, or the conduction model, and is allowed exactly one move: deriving `[n] = 1/m³` from the
printed equation in one line while saying honestly that the definition is not in its reference.
**Check Your Understanding 9.4 asks about drift velocity and leans on that equation**, which is
flagged with the only permitted route. The classic drift-velocity trap therefore got no probe topic
and no extension problem; topic 1 covers the *direction* convention instead, which is fully grounded.

> **⚠ Two arithmetic errors in the source, both in one Significance paragraph, both re-verified here
> before the claim shipped.** Example 9.10 says an incandescent bulb "would last **1.08 years** at 3
> hours a day" — 1200 h ÷ 1095 h/yr is **1.0959**, i.e. 1.10. The LED figure in the same sentence
> (45.66 yr) *is* right and uses the same 1095, which is how the slip is provable rather than
> arguable: `50000/1095 = 45.662`. And "cost savings per year is approximately **$8.50**" — the LED is
> cheaper on both energy *and* replacement, so the two add to **$9.01**; `8.76 − 0.69 + 0.44 = 8.51`
> is exactly the printed figure, so **the replacement costs were applied backwards**. The tutor is
> told the $8.76 energy figure is sound and anything past it is not.

**Nine caveats in total**, each with the self-consistent reading and an instruction to treat a cadet
quoting the other printed version as having read correctly. The most likely to snag a careful cadet:
**a signed/unsigned switch mid-derivation** — the source defines `ΔV = V_2 − V_1` as negative and
keeps every step consistent with that, then writes `P = Q·ΔV/Δt = IV`, which with the signed `ΔV` is
negative power. Also: axes swapped between two graphs (resistor plotted V-vs-I, diode I-vs-V);
Figure 9.20's `R = 3.84 Ω` is **not any single data point's ratio** but the least-squares slope of 21
deliberately noisy pairs, so a cadet computing 4.00 has not erred; and Example 9.9 prints a rounded
speed then computes with the unrounded one.

**Nothing was found wrong in any figure this time** — the colour-code bands and both printed forms of
the resistor value agree, and every printed cross-sectional area reproduces exactly from its diameter.

**Unverified inference, same class as lessons 10 and 13:** that Cengage 26.3–26.5 correspond to the
conduction model, temperature dependence, and superconductors. Here the correspondence is only
*partial* — the temperature-dependence material **is** present in the grounding — so it was scoped
**engage-only, never initiate** rather than excluded. Nothing tells a cadet their book skipped
anything.

### Lesson 15 — DC Circuit Analysis, Kirchhoff's Rules

| | |
|---|---|
| **File** | [`lesson_15_preflight_dc_circuit_analysis_kirchhoffs_rules.jsx`](lesson_15_preflight_dc_circuit_analysis_kirchhoffs_rules.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-15-dc-circuit-analysis-kirchhoffs-rules-d9d8a7a3` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/adf25d75-8155-4a8f-ace7-a0743ae4ceb7 |
| **Component** | `Lesson15Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 ch. 10 — §10.1 Electromotive Force (pp. 406–413), §10.2 Resistors in Series and Parallel (413–425), §10.3 Kirchhoff's Rules (425–436, cut mid-sentence) |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/DC Circuit Analysis, Kirchhoff's Rules.pdf` |
| **Cadets' reading** | Cengage 27.1–27.3 |
| **Probe topics** | **3** · ~3 active min each · ~10 min *(was 4 × ~2 before recker's review)* |
| **Checks** | `check_artifact.py` 38 passed / 0 failed (37 base + 1 `--forbid` guard proving the dropped key is gone); 45/45 at build time |
| **Status** | **PUBLISHED 2026-08-04** — revised on recker's review the same day, then published; prefill link generated; registration pending |

**Objectives chosen** — *4 dropped on recker's ruling, 2026-08-04:*

| # | key | label |
|---|---|---|
| 1 | `loop-rule-signs` | sum Delta_V = 0; signs come from direction of travel |
| 2 | `junction-rule-conservation` | sum I_in = sum I_out; charge conservation at a node |
| 3 | `assumed-direction-negative` | a negative current is a direction, not an error |
| ~~4~~ | ~~`series-parallel-limits`~~ | **dropped** — `R_S`, `R_P`, and multi-step reduction. Still in the grounding; now engage-only, and treated as *known ground* rather than a digression when a cadet reduces a network on the way to a Kirchhoff answer |

> **The build had already flagged this topic as the most droppable, and recker dropped it.** It was
> placed last deliberately: the most review-like topic after lesson 14, and its load-bearing
> half — *where reduction stops working* — is probed inside topic 1's motivation anyway. **That half
> survives the drop.** The `scope_note` keeps it explicitly reachable-unprompted, in a sentence or
> two inside topic 1: put an emf inside a branch and the assumption the parallel formula was derived
> under is broken, which is the entire reason Kirchhoff's rules exist. Extension problem C — the
> illegal reduction, worked wrong and then right, **8.57 A against the true 6.00 A** — is unchanged
> and still carries it as a falsifiable demonstration.

**Extension problems:** A emf 9.00 V with internal resistance into a parallel pair — terminal voltage,
branch split, power audit (approachable, **Pass 2 solves it by Kirchhoff without ever forming R_P**)
· B a four-resistor ladder, then **R₂ burns open** (standard, Pass 2 by mesh equations instead of
reduction) · C **the illegal reduction, done first and then done properly** — a 12.0 V battery sitting
inside one parallel branch (standard, Pass 2 by node-voltage plus the unused loop closing to zero) ·
D four branches between two nodes, equation counting, and a negative current (challenging, Pass 2 by
node-voltage with one unknown against mesh with four). Every number verified in Python.

**Two things make these problems carry their weight:** C's illegal reduction gives **8.57 A against
the true 6.00 A — off by 43 %**, so the lesson's motivating claim is *falsifiable* rather than
asserted; and C and D both feature a battery being **charged**, with D's `I_B = −1.00 A` producing a
terminal voltage *above* its emf.

**Transcribed off 150-dpi rasters:** 6 numbered equations (10.1–10.6), 32 figures with circuit
topology described concretely, Table 10.1, 7 worked Examples, 7 unanswered Check Your Understanding
prompts, 2 Problem-Solving Strategies.

**First source in three lessons with no missing middle block** — folios 406–436 run unbroken, and all
four cross-checks (folio, equation, Example, Check Your Understanding) agree. It is cut at both ends:
the chapter opener is absent, and p. 436 stops mid-sentence at *"For N batteries in parallel, the
terminal voltage is equal to"* — the completing equation is not present and the tutor is forbidden
from stating it as a quotation.

> **⚠ Two source defects land squarely on this lesson's core subject, and both were re-verified before
> the claim shipped.**
> 1. **Example 10.7's prose states the loop-rule signs backwards.** The page says battery `V_1` "will
>    be added" and `V_2` "will be subtracted". The equation it then writes and solves is
>    `−I·R_1 − V_1 − I·R_2 + V_2 − I·R_3 = 0`, which rearranges to `I(R_1+R_2+R_3) = V_2 − V_1` —
>    the opposite assignment, and the one the figure's polarities actually give. **The sentence is
>    wrong; the equation is right.** On a lesson whose entire difficulty is sign conventions, this is
>    the worst possible place for it, which is why it is caveat 1 and why probe topic 1 is built on it.
> 2. **Example 10.7's printed denominator disagrees with its own figure.** The substitution line reads
>    `10.0 + 30.0 + 10.0 = 50.0 Ω`, but the figure labels `R_3 = 20.0 Ω`, and the printed answer
>    `0.20 A` requires **60 Ω** — `12/50` would be `0.24 A`, and every downstream power figure agrees
>    with 60. A cadet who types the printed denominator gets 0.24 A and **is not wrong.**

**Five further caveats**, each with the self-consistent reading: a power-balance line that evaluates
to 14 W as printed and 130 W once the source's own next sentence corrects the sign (the dissipated
total is independently 27+75+12+16 = 130 W) · a junction labelled `f` in the figure and called
"Junction c" in the solution · a "simplify by dividing by 3.00" instruction that divides nothing ·
a stale cross-reference to a value no earlier example produced · and a 4th-digit rounding slip.
Two further conventions are recorded as *not* errors: what plain `V` means changes partway through
the chapter, and loop labels are point sequences rather than paths. One apparent error is
pre-emptively recorded as **correct** — the same resistor's drop is subtracted in one loop equation
and added in the other — because cadets will flag it and it deserves resolving, not dismissing.

> **This build closes the lesson 16 question: the answer is no.** This PDF stops inside §10.3's
> "Multiple Voltage Sources" subsection. **RC circuits, measuring instruments and household wiring
> are all absent** — so `DC Circuit Analysis, Kirchhoff's Rules.pdf` does *not* span the chapter, and
> **lesson 16 has no grounding source anywhere in the corpus.** It stays deferred; when it is picked
> up it needs a source from recker, not a build from model knowledge.

### Lesson 18 — Moving Charged Particle in a Magnetic Field

| | |
|---|---|
| **File** | [`lesson_18_preflight_moving_charged_particle_in_a_magnetic_field.jsx`](lesson_18_preflight_moving_charged_particle_in_a_magnetic_field.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-18-moving-charged-particle-in-a-magnetic-field-cd95f8b3` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/9585af58-e9b7-45d0-9428-eded779c6891 |
| **Component** | `Lesson18Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 ch. 11 — §11.2 "Magnetic Fields and Lines" + §11.3 "Motion of a Charged Particle in a Magnetic Field", printed pp. 466–473, contiguous |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Moving Charged Particle in a Magnetic Field.pdf` |
| **Cadets' reading** | Cengage 28.1–28.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `magnetic-force-cross-product` | F = q*v x B; magnitude, direction, and both zeros |
| 2 | `no-work-constant-speed` | force perpendicular to v; speed and KE never change |
| 3 | `radius-from-newtons-law` | q*v*B = m*v^2/r gives r = m*v/(q*B) |
| 4 | `period-independent-of-speed` | T = 2*pi*m/(q*B); no v and no r in it |

**Extension problems:** A force on a proton, then an electron, then `v` parallel to `B`, then 30°
(approachable, **Pass 2 by ratio against the source's own printed alpha-particle result** — no
constants retyped) · B electron radius, period, frequency, then double the speed (standard, Pass 2
takes the radius from momentum via `p = sqrt(2mK)` and the period from `2·pi·r/v`) · C proton versus
alpha in one field (standard, **Pass 2 is a pure dimensionless ratio in which B, 2π and every power
of ten cancel before any arithmetic**) · D a helix — components, pitch, speed after ten turns, both
angle limits (challenging, Pass 2 by a geometric route with no time in it at all). Every number
verified in Python, including all four of the source's printed answers.

**Transcribed off 150-dpi rasters:** 9 numbered equations (11.1–11.9), 7 figures with the geometry
described concretely (which way `v`, `B` and `F` point, in or out of the page, which hand rule),
2 worked Examples, 1 Check Your Understanding. Contiguous, all four cross-checks unbroken.

> **⚠ This is by far the thinnest source in the corpus — 8 pages, against 17–31 for every other
> lesson.** It is enough to ground four topics honestly, and it is contiguous, but **it truncates at
> the last arithmetic line of Example 11.2**: no Significance, no second Check Your Understanding,
> **no worked example of helical motion, and no worked example that ever puts a number into
> `r = m·v/(q·B)`.** If a longer excerpt exists, this lesson would benefit from it more than any
> other built so far.

> **⚠ The source states the right-hand rule three different ways and never acknowledges it.** The
> Problem-Solving Strategy sweeps fingers `v → B` with the **thumb giving F**; Example 11.2's
> solution uses the flat-hand version with the **thumb giving v** and the palm pushing toward F — the
> two assign the thumb to *different vectors*. A fourth phrasing omits `B` entirely. This is the
> largest trap in the material and probe topic 1 is built on it.

**Six further caveats**, each with the self-consistent reading: Example 11.2 calls the field "down"
in the Strategy and "into the page" in the Solution, which agree only because a figure caption says
the view is from the top · Example 11.1(d)'s `34°` is a **reference angle, not a direction** — both
components are negative, so the true standard-position angle is `213.7°`, and `arctan` cancelled both
signs · Figure 11.8 labels a *distance* with a *velocity* symbol where its own caption and equation
call that gap the pitch · `q` means signed charge in one equation and magnitude in three others,
never stated, so substituting `−1.6e-19` yields a negative radius · `F = qvB` appears inside a
sentence that has already fixed `θ = 90°`, and lifted out of it becomes the most common wrong formula
on this material · and a rounding slip that changes nothing.

**Checked and confirmed correct rather than flagged**, term by term at 320 dpi: every hand-geometry
figure, all four panels of the vector-decomposition figure, and the **clockwise** circulation drawn
for a negative charge in a field into the page — which looks wrong until you apply the rule's own
charge-sign reversal step, so it is recorded in the caveats as *a good catch to resolve, not dismiss*.

**Tier 2 was needed less than expected.** `F_c = m·v²/r` is printed verbatim and `T = 2·pi·r/v`
appears inside a printed derivation, so both are Tier 1 despite recker's kinematics ruling being
available. What is genuinely Tier 2 and cited as "from your earlier coursework": the cross product's
properties, `a_c = v²/r` as a standalone result, the work–energy theorem (the source asserts the
no-work conclusion in one sentence and never shows the `cos 90°` step), `K = ½mv²`, and `F = qE` for
contrast. **No electromagnetic content was reconstructed.** The single unprinted step —
`r = m·v·sin(θ)/(q·B)` for a helix — is licensed explicitly as a one-line substitution the tutor
derives in front of the cadet, and is forbidden from being presented as a numbered result.

**Judgement call worth reviewing:** helical motion is scoped to the `scope_note` and extension problem
D rather than given a probe topic. It is fully Tier 1 and the tutor engages if a cadet raises it, but
with only four slots it lost to period-independence.

> **⚠ Lesson 18's gaps are fillable, and this was only discovered afterwards.** The lesson 19 build
> found that **the first page of `Magnetic Force on Current-carrying Wires.pdf` (printed p. 474)
> carries the three things lesson 18's grounding records as absent**: the Significance of its
> beam-deflector example, the second Check Your Understanding, and **a complete worked Example of
> helical motion**. Lesson 19 transcribed them into a fenced prior-lesson block and forbids
> initiating them, so nothing is lost pedagogically — but **lesson 18 itself would be better grounded
> if rebuilt with both PDFs attached.** That is recker's call: a rebuild mints a **new** 8-hex suffix
> and therefore a **new lesson row**, per contract §3.2. Do not hand-copy the old suffix forward.

### Lesson 19 — Magnetic Force on Current-carrying Wires

| | |
|---|---|
| **File** | [`lesson_19_preflight_magnetic_force_on_current_carrying_wires.jsx`](lesson_19_preflight_magnetic_force_on_current_carrying_wires.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-19-magnetic-force-on-current-carrying-wires-4a147cca` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/c2dafd51-47b3-4b67-bcfe-1ae97f1f816a |
| **Component** | `Lesson19Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 §11.4 "Magnetic Force on a Current-Carrying Conductor", printed pp. 474–478, contiguous, cut mid-sentence at the far end |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Magnetic Force on Current-carrying Wires.pdf` |
| **Cadets' reading** | Cengage 28.3–28.4 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards) |
| **Status** | **PUBLISHED 2026-08-04** — reviewed by recker and passed unchanged; prefill link generated; registration pending |

**Objectives chosen:**

| # | key | label |
|---|---|---|
| 1 | `wire-force-from-moving-charges` | F = I*L x B; the wire force is q*v x B summed up |
| 2 | `angle-between-current-and-field` | F = I*L*B*sin(theta); theta is between I and B |
| 3 | `rhr1-force-direction-on-wire` | RHR-1 gives the force direction on a wire |
| 4 | `closed-loop-net-force-zero` | net force on any closed loop in a uniform B is zero |

**Extension problems:** A a wire at four orientations including **the angle trap** (approachable, **Pass 2
rebuilds the force from `n·A·L` carriers each feeling `e·v_d·B`, never quoting the wire formula**) ·
B a wire levitated by the magnetic force — the current for zero lead tension, then doubled (standard,
Pass 2 matches weight-per-length against `I·B` with no length anywhere) · C a wire from the origin to
a point, then the same current on a **bent** path, then closed into a triangle (standard, Pass 2 by a
rotation argument with no determinant, plus superposition) · D a semicircle integrated, then its
closing chord, then the total (challenging, **Pass 2 reaches `2IBR` from the printed closed-loop
result with no integral, no parametrisation and no limits**, and explains why `pi·R` never appears).

**Transcribed off 150-dpi rasters, figures re-rendered at 400–800 dpi:** 4 numbered equations
(11.10–11.13), 4 figures, 4 worked Examples, 2 unanswered Check Your Understanding prompts. All five
cross-checks unbroken, and the equation numbering is **continuous with lesson 18's** — 11.1–11.13
across the two lessons with no gap.

> **⚠ One caveat changes a number.** Example 11.5(b) states the field as "30 degrees from the
> +x-axis" while the wire lies along **+y**, so the angle in the sine is **60°**, not 30°. The printed
> answer `1.30 N/m` reaches it as `cos 30°`, which is the same thing — but a cadet substituting
> `sin 30°` gets `0.75 N/m`, **off by a factor of 1.73**. Same reference-angle failure class as lesson
> 18's, and probe topic 2 and extension A(c) are built on it.

**Seven further caveats:** **two different right-hand rules one page apart, never contrasted** — RHR-2
puts the thumb on the *current*, RHR-1 puts the fingers on the current and the thumb on the *force*,
and the source introduces the second one first, so a cadet putting their thumb on the current is
quoting the book · an Example that asks for "magnitude and direction" and prints only the magnitude,
with the current direction existing **nowhere but a small arrow in a figure** · one lowercase letter
doing three jobs (vector, scalar, differential) · **carriers treated as positive silently** — two sign
flips that cancel, so a cadet who objects is right about the physics · a Significance paragraph
copy-pasted from the previous Example · an angle defined one way and integrated as another, which
happens not to change the answer · and half-loop force signs whose meaning exists only in a figure's
circulation, confirmed at 700 dpi. **No source arithmetic slips found**, and every figure checked
against the equation it illustrates was self-consistent — no repeat of lesson 18's problem.

> **Scoped out, and worth knowing:** `F/l = mu_0·I_1·I_2/(2·pi·r)` and the definition of the ampere
> are **not in this source at all** — no `mu_0`, no Biot–Savart, no Ampère's law, no field-of-a-wire
> formula anywhere on these pages. Parallel-current attraction is therefore **not** built on, and the
> tutor is forbidden from asserting attract/repel as today's material.

**One judgement call to review:** the endpoint theorem — *only the straight-line vector between the
ends matters in a uniform field* — **is not printed**. The source says "integrate", and separately
states the closed-loop result. It is admitted as a **derived** result the tutor must derive in front
of the cadet with an explicit provenance statement, and extension C(d)/(e) and D(e) are built on it.
**This leans on the "printed equations determine it in one line" allowance harder than any other
lesson does.** If you read that allowance more narrowly, those problem parts are what to cut.

### Lesson 20 — Magnetic Dipoles and Torque

| | |
|---|---|
| **File** | [`lesson_20_preflight_magnetic_dipoles_and_torque.jsx`](lesson_20_preflight_magnetic_dipoles_and_torque.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-20-magnetic-dipoles-and-torque-3190fefe` |
| **Published** | 2026-08-04 — https://claude.ai/public/artifacts/66ca2767-3f0c-48f6-82b6-330d9e4de279 |
| **Component** | `Lesson20Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 **§11.5** "Force and Torque on a Current Loop", printed pp. 479–480 — **two pages, cut mid-sentence at both ends** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Torque on a Current Loop.pdf` |
| **Cadets' reading** | Cengage 28.5 |
| **Probe topics** | **3** · ~3 active min each · ~10 min *(was 4 × ~2 before recker's review)* |
| **Checks** | `check_artifact.py` 38 passed / 0 failed (37 base + 1 `--forbid` guard proving the dropped key is gone); 45/45 at build time |
| **Status** | **PUBLISHED 2026-08-04** — revised on recker's review the same day, then published; prefill link generated; registration pending |

**The filename mismatch is benign** — `Torque on a Current Loop.pdf` is the section title minus its
first two words, and the magnetic dipole moment **is** defined in these pages.

**Objectives chosen** — *4 dropped on recker's ruling, 2026-08-04:*

| # | key | label |
|---|---|---|
| 1 | `zero-net-force-nonzero-torque` | net force on a loop is zero; net torque is not |
| 2 | `dipole-moment-definition` | mu = N*I*A*n-hat; magnitude and RHR-2 direction |
| 3 | `torque-angle-from-normal` | theta is normal-to-B; max torque when plane holds B |
| ~~4~~ | ~~`torque-from-moment-arms`~~ | **dropped** — the moment arms `x·sin θ` and `(a−x)·sin θ`, their collapse to `I·A·B·sin θ`, and the disappearance of `x` that proves the pair is a couple. Still in the grounding; now engage-only, and *"where does the sin θ come from?"* is answered fully whenever a cadet asks it |

**Extension problems:** A one loop — four side forces, net force, `mu`, torque (approachable, **Pass 2
rebuilds the torque from force × moment arm twice with the axis in two different places**, never
forming the area) · B a 50-turn coil — max torque with the orientation stated *both* ways, the
half-max angle, the current reversed (standard) · C a square loop in three orientations, which way it
turns when released, and *are the forces zero when the torque is?* (standard) · D works **backwards
from a measured torque to the current**, then reshapes the loop to a square of the same perimeter
(challenging). Every number computed here and verified in Python — **the source evaluates nothing.**

**Transcribed:** 8 numbered equations (11.14–11.21), 2 figures, **0 worked Examples, 0 Check Your
Understanding prompts.** Contiguous; all four cross-checks unbroken.

> **⚠ This is the thinnest and weakest grounding in the corpus — two pages, and it stops one line
> before the section's punchline.** The last printed words are *"In terms of the magnetic dipole
> moment, the torque on a current loop due to a uniform magnetic field can be written"* — and the
> page ends. **`tau = mu x B` is not in the grounding.** It is admitted as a derived result: the
> printed `tau = -I·A·B·sin(theta) i-hat` and `mu = I·A·n-hat` give the magnitude in one substitution,
> and the build additionally confirmed by direct computation that `mu x B` reproduces the printed
> vector equation **exactly, sign and all**. The tutor derives it in front of the cadet, is forbidden
> from claiming to quote or number it, and is told to accept the vector form from a cadet whose own
> book prints it and then have them justify it from what is printed here.
>
> **This is the artifact most likely to want a better source.** Two pages, no worked examples, and the
> section's own final equation missing. If a fuller excerpt exists, this is the lesson to re-ground.

**Six caveats:** **an intermediate line of the torque derivation that no reading makes correct** —
read the force symbols as signed and the first line gives the opposite sign; read them as magnitudes
and it does not collapse at all. The printed *second* line and the final equation were independently
verified correct by taking moments about the printed point, so **only the middle line is wrong**, and
a cadet who cannot make that step come out is not erring · **a figure glyph that was nearly read as a
third dimension label** — at 900 dpi it looked like an italic `l`, which would have given the
rectangle three length labels against a text naming two; at 2000 dpi it is character-for-character the
current symbol from the neighbouring figure. It is the current · *"once the loop's surface area is
aligned with the magnetic field"* reads backwards, and only a figure caption settles that it means the
area *vector* · the source's generality claim covers **the force only** — every torque line is derived
for a rectangle and the source never says whether the result survives for a circle, so the tutor
answers "this material does not settle it" and the extension problems are scoped to rectangles ·
**`theta` is never stated in words, only shown in a figure** — which is the day's most likely wrong
answer, since a cadet measuring from the plane gets a fully inverted set with nothing in their algebra
protesting · and RHR-1 is cited by name and defined nowhere, so it is handled as Tier 2.

**Scoped out:** there is **no energy expression anywhere in this source**, so `U = -mu · B` is not used
and the tutor is forbidden from writing one or arguing the stable orientation from energy. That
question is answered instead from the minus sign in the printed torque equation, flagged as a
derivation.

> **⚠ Worth a second look after the drop — the day's biggest trap is now the most droppable topic.**
> With four topics, `torque-angle-from-normal` sat third and the mechanical moment-arm derivation was
> the one that would be cut for time. With three, it is **last**, and it is the single most common
> failure on this material: a cadet who measures θ from the loop's *plane* rather than its *normal*
> gets a completely inverted set of answers and nothing in their algebra protests. The order 1–2–3 is
> exactly what recker approved and it has not been changed — but **if a session runs short, this is
> the topic that gets squeezed, and it is the wrong one to squeeze.** Promoting it to second is a
> one-line change if you want it; say the word.

**The three magnetism PDFs abut exactly** — 466–473, 474–478, 479–480 — one continuous run with no
overlap and no gap between lessons 18, 19 and 20.

### Lesson 21 — Sources of Magnetic Fields

| | |
|---|---|
| **File** | [`lesson_21_preflight_sources_of_magnetic_fields.jsx`](lesson_21_preflight_sources_of_magnetic_fields.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-21-sources-of-magnetic-fields-85e63bf8` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/cd124eb3-de5a-43f2-b33e-99a7422fb8d8 |
| **Component** | `Lesson21Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 **ch. 12** "Sources of Magnetic Fields" — §12.1 Biot-Savart Law (printed pp. 502–504), §12.2 Thin Straight Wire (505–508), §12.3 Force between Two Parallel Currents (509–510), §12.4 Magnetic Field of a Current Loop (511–513). Twelve pages, contiguous |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Sources of Magnetic Fields.pdf` |
| **Cadets' reading** | Cengage 29.1–29.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards proving no lesson-19 objective key, slug suffix, section title or prior-material block survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `biot-savart-structure` | dB from I dl x r-hat, 1/r^2, then integrate |
| 2 | `straight-wire-field` | B = mu0*I/(2*pi*R): 1/R, circling the wire |
| 3 | `parallel-currents-force` | Wire 1 makes B; that B pushes wire 2 |
| 4 | `current-loop-field` | Loop: mu0*I/(2R) at the centre, dipole far off |

> **Four topics, and none of them is the peripheral one.** recker's 2026-08-04 review dropped a
> fourth objective in three of four lessons where it was peripheral, so the question was asked
> deliberately here and the answer is no: the source gives each of these its own printed section with
> its own printed learning objectives, and the cadets' two assigned Cengage sections cover all four
> (29.1 is Biot-Savart plus the wire and the loop; 29.2 is the force between parallel conductors, a
> whole section on topic 3 alone). Dropping any one leaves a printed section of the cadets' own
> reading with no probe against it. **If one has to go, it is 4** — the loop is the only one whose
> core result the cadet can reach from another topic, since the centre field falls out of topic 1's
> arc formula in one substitution. Pacing therefore stays at the profile default, 4 × ~2 min, and
> `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING sentence and the constants' comments
> all say 2 — checked, because that contradiction has bitten twice.

**Extension problems:** A **one law, three shapes** — a quarter arc, the full circle *reached two
independent ways*, a short straight element, and the point where an element makes exactly zero field
(approachable, **Pass 2 gets the arc as a fraction of the circle so no constant is retyped, and gets
the element by a three-factor ratio against the source's own worked example**) · B two long parallel
wires — midpoint field parallel and antiparallel, the null point, and the force (standard, **Pass 2
runs the two-step chain in both directions and lands on the same force, which is Newton's third law
arriving from an argument that never mentions it**) · C the current loop on its axis, the dipole
moment, and the far-field approximation *with its 1.50 % error predicted in advance* from
`(1 + R²/y²)^{3/2}` (standard, Pass 2 by a pure geometric ratio with no `mu0` and no current in it) ·
D three parallel wires — force, the single equilibrium position, whether it depends on the third
current, the net force on a wire that is *not* in equilibrium, and the ampere (challenging, Pass 2
sums the fields at the wire instead of the forces on it). Every number computed and independently
re-checked in Python.

**Transcribed off 150-dpi rasters, two figures and two disputed sentences re-rendered at 350–400
dpi:** 19 numbered equations (12.1–12.19) plus ~10 unnumbered displays, 11 figures, 5 worked Examples
(one of them cut), 4 unanswered Check Your Understanding prompts, and 1 Problem-Solving Strategy.

**No interior hole.** All four cross-checks agree and none skips: printed folios 502–513 across
twelve pages, equations 12.1–12.19, Examples 12.1–12.5, Check Your Understanding 12.1–12.4. This was
checked precisely because two of the first twelve sources were missing a block out of the *middle*
with nothing in the prose to show it.

> **⚠ Where this PDF stops, and the lesson 22 boundary — read this before building lesson 22.**
> These pages run **502–513** and stop after the *statement* of Example 12.5, with its figure,
> Strategy, Solution and answer on printed p. 514. **p. 514 is the first page of
> `Ampere's Law, Gauss's Law in Magnetism.pdf`**, which runs **514–524** and opens with exactly that
> example's Figure 12.13 and Strategy before starting §12.5. So the two PDFs **abut exactly — no
> overlap and no gap — and the seam falls inside a worked example.** Lesson 22 inherits the solution
> to a problem whose statement is here, the same way lesson 19 inherited lesson 18's helical example.
> Verified by opening both PDFs, not inferred from the filenames — the corpus is known to contain at
> least one file that is a byte-identical subset of another.

> **⚠ §12.4 contains seven equations and not one worked number.** Its only example is the cut one, so
> there is no printed arithmetic anywhere on these pages for the field of a current loop and nothing
> to check a tutor's number against. Extension problem C exists to supply that gap, and every figure
> in it was computed here and re-derived by a second route for that reason. This is the same class of
> thinness lessons 18 and 20 recorded, but narrower: it costs a *check*, not a topic.

> **⚠ The right-hand rule is named inconsistently, again, and this time it is worse.** p. 506 writes
> *"Using the **right-hand rule 1** from the previous chapter, dx × r̂ points out of the page"* — RHR-1
> applied to the rule that gives the **field**. Three pages later the Figure 12.9 caption assigns
> **RHR-2** to the field of a straight conductor and **RHR-1** to the **force** between conductors.
> One name, two different vectors on the thumb. In between, the grip rule is introduced only as *"a
> second form of the right-hand rule"*, unnumbered. **Verified two ways:** both sentences read
> directly off 400-dpi renderings, and the two usages are internally contradictory. Lessons 18 and 19
> each found their own version of this; this is the third, and it is the worst because **today the
> cadet needs both rules in one conversation.** The tutor is instructed never to open with a
> correction and never to argue about the number — ask which *question* is being answered, then use
> the rule — and to treat a cadet who calls the grip rule RHR-1 *or* RHR-2 as having quoted the book
> correctly, because both quotations are in it.

**Four further source defects, recorded rather than silently corrected**, each verified two ways
before it shipped:
- **Example 12.3 prints `B₂ = 3 × 10⁻⁵ T` and then uses `2.83 × 10⁻⁵ T` two lines later.** The exact
  value is 2.828 × 10⁻⁵ T. Checked by direct arithmetic and by the observation that the diagonal wire
  is √2 further away, so its field must be 4 × 10⁻⁵/√2. A cadet computing 2.8 × 10⁻⁵ is right.
- **The same example's answer is printed as `8 × 10⁻⁵ T`** where the components the source itself
  wrote give **8.49 × 10⁻⁵ T**. Checked as √(6²+6²) and by summing the three field vectors directly
  to (−6, −6) × 10⁻⁵. A cadet reporting 8.5 × 10⁻⁵ has done the arithmetic and the book has rounded.
- **"a flat coil of N loops per length" is wrong; the formula it labels is right.** `B = μ₀NI/(2R)`
  needs N to be a pure count of turns. Checked dimensionally (a per-length N gives T/m, not T) and
  physically (N concentric turns each contribute μ₀I/(2R)). "Per length" belongs to a solenoid, which
  is not on these pages at all.
- **Figure 12.5's caption names θ₁ and θ₂ as the limits of "the independent variable θ"**, and the
  derivation on the same page integrates over *x* from 0 to ∞ and never mentions either symbol again.
  Dangling labels from a version of the derivation that is not printed.

**Eight further notation caveats**, each with the self-consistent reading: `μ₀` printed with a zero
subscript in most places and an italic letter *o* in Eqs. 12.6/12.8 and twice in Example 12.3 · the
arc result needs **radians** and says so once, in a Strategy paragraph, 57× being the cost of missing
it · the 89.4° of Example 12.1 is `arctan(1 m/0.01 m)`, while the figure's geometry gives 90.6° —
**both give sin θ = 0.99995 and the printed 2.0 nT, so nothing downstream changes** · `r` and `R`
between them do four jobs across the four sections and the switch is never flagged · the loop is put
in the **xz-plane so its axis is y**, not the more usual z · Eqs. 12.18 and 12.19 are one letter apart
(`R³` vs `y³`) and mean opposite regimes, centre versus far field · `μ` is both the permeability and
the dipole moment, never remarked on · and a scalar-versus-vector switch on `μ` between Eqs. 12.16
and 12.18.

**Checked and confirmed correct rather than flagged:** Figure 12.6's drawn circulation against the
grip rule as printed (350 dpi); Figure 12.9(b)'s circulation, the direction of `B₁` at wire 2 and the
drawn `F₂`, all mutually consistent and correct for same-direction currents; **all three field
directions in Example 12.3's solution figure**, verified by cross product wire by wire for currents
into the page; Example 12.4 in full — the 3-4-5 triangle, the 1.00 × 10⁻¹⁰ N/m, the unit vector
`−0.8î + 0.6ĵ` pointing from wire 2 toward wire 1 as the Strategy's attraction requires, **and its
Significance claim that the two fields are equal and opposite at each other's locations, which is
exactly true**; the straight-wire integration 12.5 → 12.8 including the doubling step; and the
internal agreement of the arc result at θ = 2π with the independently derived Eq. 12.17.

**One deliberate judgement call, flagged for review.** The source's SI statements — that μ₀ is
`4π × 10⁻⁷` **exactly by definition** and that the ampere is **defined** by the force between wires —
are pre-2019. Since the 2019 redefinition the ampere is fixed by the elementary charge and μ₀ is
measured, agreeing to about one part in 10⁹. **No number anywhere changes.** The tutor is told to use
`4π × 10⁻⁷`, **not** to volunteer the modern definition unprompted, to agree if a cadet raises it, to
label that as reasoning beyond its reference, and to mark neither version wrong. If you would rather
it stayed silent on this entirely, that is a one-line cut.

**Unverified, same class as lessons 8, 10, 13 and 14:** that Cengage 29.1–29.2 covers this span in
the cadets' book. What supports it here more than usual: lesson 22 reads Cengage 29.3–29.5 and its
grounding PDF picks up at OpenStax §12.5 Ampère's Law, so **the seam falls in the same place in both
books** — which is the strongest circumstantial evidence any lesson in this corpus has produced. It
is still not a look at a Cengage table of contents.

### Lesson 22 — Ampère's Law, Gauss's Law in Magnetism

| | |
|---|---|
| **File** | [`lesson_22_preflight_amperes_law_gausss_law_in_magnetism.jsx`](lesson_22_preflight_amperes_law_gausss_law_in_magnetism.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-22-amperes-law-gausss-law-in-magnetism-bd81d7d5` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/d7d527d0-bc31-45d3-b42d-999a46dbfd72 |
| **Component** | `Lesson22Preflight` |
| **Built** | 2026-08-04 |
| **Grounding** | OpenStax Vol. 2 **ch. 12** — the closing half of §12.4 (printed p. 514), §12.5 Ampère's Law (514–520), §12.6 Solenoids and Toroids (520–524). Eleven pages, contiguous, **cut at both ends** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Ampere's Law, Gauss's Law in Magnetism.pdf` |
| **Cadets' reading** | Cengage 29.3–29.5 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 46 passed / 0 failed (37 base + 9 `--forbid` guards proving no lesson-21 objective key, slug suffix, component name, page range or source filename survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `enclosed-current-only` | Only current through the loop counts; shape drops out |
| 2 | `symmetry-makes-it-solvable` | Always true, only usable when symmetry pulls B out |
| 3 | `thick-wire-inside-outside` | I_enc goes as r^2/a^2: B rises, then falls as 1/r |
| 4 | `solenoid-uniform-field` | B = mu0*n*I inside, zero outside; n is per length |

> **Four topics, and the question was asked deliberately.** recker's 2026-08-04 review dropped a
> fourth objective in three of four lessons where it was peripheral, so the test applied here was:
> does dropping any one leave a printed section of the cadets' own reading with no probe against it?
> **Yes, for every one of the four.** Topic 1 is the law itself; topic 2 is the source's own
> unanswered Check Your Understanding and the first and third steps of its printed Problem-Solving
> Strategy; topic 3 is the **second half of §12.5's printed learning objective** ("either thin or
> thick"); topic 4 is the whole of Cengage 29.4. **If one has to go it is 3**, because the thick wire
> is reachable as a variation on topic 1 once a cadet has "only the enclosed current" — but it is
> also the day's most likely wrong answer, so dropping it costs the most diagnostic value. Pacing
> therefore stays at the profile default, 4 × ~2 min, and `PER_TOPIC_BUDGET_MIN`, the `time_budget`
> block, the PACING sentence and the constants' comments all say 2 — checked, and see the
> cross-cutting note below, because a fourth string had been missed everywhere.

**Extension problems:** A **the bookkeeping problem** — three wires threading a path and one outside
it, then the outside wire moved in, then the *walk* reversed, then the path deformed, and finally
*"is the field zero on the path, and does the outside wire contribute to it?"* (approachable, **Pass 2
by superposition one wire at a time so the outside wire's zero is an explicit line, and again by
ratio against the source's own 9 A example**) · B the thick wire inside, outside and **at the surface
computed two ways so the two expressions are shown to meet**, then the two radii where the field is
half its surface value, then **the same current moved onto the surface only**, where the interior
field is exactly zero (standard, Pass 2 by pure ratios against the surface value, in which no
constant is retyped — and which exposes the classic error as *a field larger inside the metal than
at its surface*) · C the solenoid — stretched, double-layered, and then **the n-versus-N error made
deliberately**, where the wrong answer is smaller by a factor that is numerically the solenoid's
length in metres and the units protest on their own (standard, **Pass 2 by ratio against the source's
own worked example, which also demonstrates that using the book's *rounded* printed value gives a
0.3 % discrepancy that is the rounding, not an error**) · D **a coaxial cable**, inside the core,
between the conductors, outside everything, then with an incomplete return current, and finally **the
toroid derived rather than quoted** (challenging, Pass 2 by four independent routes including the
source's own unenclosed-path argument). Every number computed and independently re-checked in Python.

**Transcribed off 150-dpi rasters, one figure re-rendered at 400 and 700 dpi to read its current
directions arrowhead by arrowhead:** 13 numbered equations (12.20–12.32) plus ~15 unnumbered
displays, 10 figures (12.13–12.22), 5 worked Examples (12.5–12.9, the first of them missing its
statement), 3 unanswered Check Your Understanding prompts, and 1 Problem-Solving Strategy.

**No interior hole.** All four cross-checks agree and none skips: printed folios 514–524 across
eleven pages, equations 12.20–12.32, Examples 12.5–12.9, Check Your Understanding 12.5–12.7. **All
four also run continuous with lesson 21's** — 502–513 and 514–524, equations 12.1–12.19 and
12.20–12.32, and so on — so the two PDFs abut exactly, as lesson 21's build predicted.

**Where this PDF spans and where it stops.** It covers **the tail of §12.4, all of §12.5, and §12.6
up to the last line of printed p. 524.** It is cut at *both* ends:

- **It opens mid-worked-example, exactly as lesson 21 warned.** Its first page carries Example 12.5's
  figure, Strategy, Solution and Significance; the **statement** is on p. 513, inside lesson 21's PDF.
  So `R = 0.5 m` and `I = 10 mA` appear in the substitution line **from nowhere**. Recorded in
  `GAPS IN THE SOURCE`, which forbids presenting that example as self-contained or asking a cadet to
  work from a setup they cannot see, and permits discussing the *structure* of the solution and its
  Helmholtz-coil Significance, both of which stand alone.
- **It stops mid-sentence inside the toroid derivation.** The last printed words are *"…resulting in
  a net current NI through the surface. We now find with Ampère's law,"* — and the page ends.
  **`B = mu0*N*I/(2*pi*r)` is not in the grounding.** Both ingredients are printed (Eq. 12.31 gives
  the circulation, and the enclosed current `NI` is stated one line earlier), so the tutor is licensed
  to derive it in front of the cadet, is forbidden from numbering it or claiming to quote it, and is
  forbidden from going on to how the field varies across the doughnut's cross-section. Extension D(f)
  is built on that derivation and says so.
- **§12.7 *Magnetism in Matter* is absent entirely** — no ferromagnetism, no permeability of a
  material, no atomic origin of permanent magnets.

> **⚠ THE LESSON TITLE NAMES SOMETHING THE GROUNDING ALMOST DOES NOT CONTAIN, and this is the most
> important finding of the build.** The cadets read Cengage **29.3–29.5**, and 29.5 is *Gauss's Law in
> Magnetism*. **The OpenStax pages have no such section** — no heading, no numbered equation, no
> worked example, no figure. What they have is **one printed sentence**, inside Example 12.6's
> symmetry argument: because magnetic field lines are continuous and close on themselves, *the net
> magnetic flux through any closed test surface must be zero.*
>
> That sentence is genuinely Tier-1 and it is **load-bearing** — it is what rules out a radial
> component and therefore what makes the whole first Ampère's-law example work. So the artifact does
> **not** pretend the material is absent, and does not build a probe topic on it either. It gets a
> dedicated `WHAT THIS SOURCE SAYS ABOUT GAUSS'S LAW IN MAGNETISM` block that says exactly what may
> be said (use it as the source uses it; state in plain words that field lines close on themselves
> and whatever flux enters a closed surface leaves it; confirm a cadet who raises it from their own
> book) and what may not (no closed surface integral presented as a numbered result, no magnetic
> monopoles, never initiate it). It is `scope_note`'d **engage-only** and has no objective key, so it
> cannot reach the `d` payload. **The honest alternative — probing it anyway — is the lesson 5
> situation, and that one needed an explicit instructor authorization. There is none here.**
> Topic 2 nonetheless reaches the physics: the flux argument *is* how the source kills the radial
> field, so a cadet meets the idea inside a topic that is fully grounded.

> **⚠ The right-hand-rule naming resolves here, and it resolves against lesson 21's worst page.**
> Lesson 21 recorded p. 506 calling the *field* rule "right-hand rule 1" while Fig. 12.9's caption
> three pages later assigned RHR-2 to the field and RHR-1 to the force. **These pages name exactly one
> rule by number: the Problem-Solving Strategy's step 2 says to find the field's direction "by
> right-hand rule 2." `RHR-1` does not appear anywhere in this source.** So the convention adopted for
> the tutor is **RHR-2 = the field a current makes**, which agrees with both these pages and lesson
> 21's figure caption; p. 506 is the outlier. Verified by reading step 2 off the raster directly.
>
> **Two further right-hand statements on these pages are unnumbered, and one of them swaps the
> thumb.** The Ampère sign rule puts the thumb on *the orientation of the surface you chose*, not on
> a current or a field. The solenoid rule puts the **fingers on the current and the thumb on the
> field** — the opposite assignment from gripping a straight wire. The reference gives the tutor one
> sentence to hand a cadet instead of two rules to memorise: *whichever quantity circulates gets the
> fingers.* A cadet quoting either number from either week is treated as having read correctly.

> **⚠ One real source error, verified two ways, plus an unstated condition that is the more
> interesting of the two.**
> 1. **A closed-integral symbol is printed around a quantity that is already the value of the
>    integral.** In the toroid derivation, Eq. 12.31 sets the circulation equal to `B(2·pi·r)`; two
>    lines later the source writes a loop-integral symbol *in front of* `B(2·pi·r)` and sets that to
>    zero. Checked two ways: Eq. 12.31 one line above has already performed that integral, so the
>    symbol integrates it twice; and the very next line drops the symbol and writes `B = 0`, which is
>    the correct conclusion. **A typesetting slip; the physics is right.**
> 2. **"The magnetic field is zero outside the solenoid" is stated flatly and is an idealisation —
>    and the source admits the same idealisation three pages later for the toroid**, where it says
>    honestly that the turns form a helix rather than circular loops so there is a small external
>    field. The same argument applies to a solenoid and the source never says so. Same class as lesson
>    13's dielectric-energy defect: **an unstated condition, not an arithmetic error.** A cadet who
>    objects that a real solenoid must leak some field is right, has been told so by the toroid
>    paragraph, and is to be told they are right.

**Ten further notation caveats**, each with the self-consistent reading: **the law is printed with a
plain `I` and the Problem-Solving Strategy uses `I_enc`, never reconciled** — which matters because
substituting the wire's *total* current where the *enclosed* current belongs is exactly what breaks
the thick-wire problem · the finite-solenoid angle is defined **only by a figure**, measured from the
perpendicular, so a cadet measuring from the axis gets cosines and a plausible-looking answer · `N`
versus `n`, where **the previous lesson's misprinted "N loops per length" was wrong there and "per
unit length" is finally right here** · lowercase `l` doing three jobs beside `I` and the digit `1` in
`Bl = mu0·n·l·I`, where the one thing that matters is that `l` cancels · **the solenoid's radius
appears nowhere in its field and the worked example supplies one anyway** (it exists only for the
`L >> R` check) · the axis is `y` rather than the more usual `z` · the phrase *"the current going out
of the loop"* used for *"back up through the surface"* · `r`, `R` and `a` all meaning "some radius"
across three sections · and — the one worth the most in conversation — **Ampère's law is true whether
or not it is useful, and the source only ever implies the distinction.**

**Checked and confirmed correct rather than flagged:** **all four printed numerical results reproduce
exactly** — the two-loop example's `5.77e-9 T` (both terms recomputed and differenced), `mu0·(2 A) =
2.51e-6 T·m`, `mu0·(9 A) = 1.13e-5 T·m`, and the solenoid's `n = 2.14e3 turns/m` and `1.10e-3 T`;
**Figure 12.18 in all three panels at 700 dpi**, arrowhead by arrowhead — (a)'s two wires that arc
over and pierce the surface twice give 7 A down against 7 A up, exactly the net zero the text claims,
(b)'s single enclosed wire does point downward and the other two lie outside, and (c)'s 7 + 5 − 3 = 9
is right; Figure 12.20's drawn interior field against the winding's dot-and-cross convention; the
inside and outside thick-wire expressions meeting at `r = a`; and both halves of the source's own
analogy between Ampère's law inside a thick wire and Gauss's law inside a uniform charge distribution.
**No arithmetic slip was found anywhere in this source** — the first in three lessons.

**Unverified, same class as lessons 8, 10, 13, 14 and 21:** that Cengage 29.3–29.5 covers this span
in the cadets' book. The evidence is stronger than usual for the first two sections — Ampère's law
and the solenoid map cleanly onto §12.5 and §12.6, and lesson 21's build already noted that the
chapter seam falls in the same place in both books — and it is **weaker than usual for the third**,
since 29.5 has no OpenStax counterpart in this PDF at all. That mismatch is itself circumstantial
evidence the inference about 29.3 and 29.4 is right, because the Cengage section it fails to match is
precisely the one OpenStax handles in a different chapter. It is still not a look at a Cengage table
of contents.

### Lesson 24 — Faraday's Law of Induction, Motional EMF

| | |
|---|---|
| **File** | [`lesson_24_preflight_faradays_law_of_induction_motional_emf.jsx`](lesson_24_preflight_faradays_law_of_induction_motional_emf.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-24-faradays-law-of-induction-motional-emf-8cbe647d` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/7c2ee36f-b471-4c1e-8fb8-c13e7d286825 |
| **Component** | `Lesson24Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax Vol. 2 **ch. 13** "Electromagnetic Induction" — §13.1 "Faraday's Law" (printed pp. 546–549), the closing lines of one worked example on printed p. 554, and §13.3 "Motional Emf" (printed pp. 554–561). Twelve pages, **with a four-page hole in the middle** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Faraday's Law of Induction, Motional EMF.pdf` |
| **Cadets' reading** | Cengage 30.1–30.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 47 passed / 0 failed (37 base + 10 `--forbid` guards proving no lesson-22 objective key, slug stem, slug suffix, component name, page range or source filename survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `magnetic-flux-orientation` | Flux is B dot A: size, tilt, and the chosen normal |
| 2 | `emf-from-rate-of-change` | Emf comes from dPhi/dt, never from B itself |
| 3 | `motional-emf-blv` | Moving rod: the area changes, so emf = B*l*v |
| 4 | `motional-emf-energy` | You must push; your work becomes I^2*R |

> **Four topics, and the question was asked deliberately.** The test applied since lesson 21 is
> whether dropping one leaves a printed learning objective of the cadets' own reading with no probe
> against it. **The source prints exactly four learning objectives across its two sections and each
> topic above takes exactly one of them** — flux, then Faraday's law, then the magnitude of a
> moving-wire emf, then the source's own "discuss examples that use motional emf," whose physics is
> the energy balance. The cadets' two Cengage sections split the same way: 30.1 is topics 1–2, 30.2
> is topics 3–4. **If one has to go it is 4**, reachable from topic 3 plus conservation of energy —
> but it is also the topic that makes the day mean anything. Pacing therefore stays at the profile
> default, **4 × ~2 min**, and all five pacing strings were grepped and confirmed to say 2:
> `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING opener, the probing instruction, and
> the PACING line *"about its 2 min budget"* — the one that was wrong in ten earlier artifacts.

**Extension problems:** A **one loop, three ways to change its flux** — face-on, tilted, edge-on,
then the same flux change produced once by turning the loop and once by killing the field, which give
**identical emfs**, then the N-turn double-count trap (approachable, **Pass 2 gets the tilt by
projected area and gets the two emfs equal symbolically before any arithmetic**) · B **the rod on the
rails all the way to the energy** — emf, current, retarding force, applied force, mechanical power,
electrical power shown exactly equal, then doubling the speed and then doubling the resistance
(standard, **Pass 2 reaches both powers from the single closed form `l²B²v²/R`, which contains
neither the current nor the force, and reads both scalings off it with no arithmetic**) · C **the
rotating rod** — the emf by flux and again by integrating along the rod, which end is at the higher
potential, the ω-versus-ℓ² scaling, and the current through a closing resistor (standard, **Pass 2
gets the same 1.03 V from `Blv` with `v` the rod's midpoint speed, with no calculus at all**) ·
D **a search coil** — a linear ramp, the total charge, the proof that the charge does not depend on
how fast you ramp, an exponential decay, a half-life, and finally **flipping the coil rather than
switching the field off**, which is larger by exactly 8 = 2 × 4 (challenging, **Pass 2 does parts (c)
and (e) as pure ratios against part (a), so the 1.6 and the 8 become arguments rather than
coincidences**). Every number computed and independently re-checked in Python.

**Transcribed off 150-dpi rasters, three regions re-rendered at 350–500 dpi:** 8 numbered equations
(13.1–13.8) plus ~10 unnumbered displays, 11 figures (13.2–13.6 and 13.10–13.17), 4 worked Examples
(13.1, 13.4, 13.5, 13.6) plus the tail of a fifth, and 3 unanswered Check Your Understanding prompts.

> **⚠ THE SOURCE HAS A FOUR-PAGE HOLE IN THE MIDDLE, AND IT IS THE MOST IMPORTANT FINDING OF THE
> BUILD.** Printed folios run 546, 547, 548, 549 and then jump straight to **554**. **Pages 550–553
> are absent, and what is absent is §13.2 "Lenz's Law" — lesson 25's entire topic.** This is a
> deliberate split of one chapter across two lessons, not corpus damage: **lesson 25's grounding PDF
> holds exactly printed pp. 550–553 and then pp. 562–565**, so the two files **tile printed
> pp. 546–565 between them with no overlap and no gap.** Verified by opening both PDFs.
>
> **Four cross-checks skip in step and a fifth does not, which is the part to carry forward.** Folios
> skip 550–553; Examples run 13.1 → (unnumbered tail) → 13.4, 13.5, 13.6, so 13.2 and the head of
> 13.3 are gone; Check Your Understanding runs 13.1 → 13.4, 13.5, so 13.2 and 13.3 are gone; Figures
> run 13.2–13.6 → 13.10–13.17, so 13.7–13.9 are gone. **But the numbered equations run 13.1, 13.2,
> 13.3 straight into 13.4 with no skip at all, because §13.2 carries no numbered equation.** An agent
> checking only the equation sequence would have declared this source contiguous. Recorded in a
> `GAPS IN THE SOURCE` block, item 7.

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS — READ THIS BEFORE BUILDING LESSON 25.**
> - **Printed pp. 546–549 and 554–561.** Both *outer* edges are **clean**: it begins at the §13.1
>   heading and ends after Check Your Understanding 13.5 at the foot of p. 561, and neither cut falls
>   inside a sentence. §13.4 *Induced Electric Fields* begins on p. 562 and **is in lesson 25's PDF**.
> - **The inner edge is not clean.** The resumption at p. 554 opens on the **last two lines of
>   arithmetic of Example 13.3** ("Changing Magnetic Field Inside a Solenoid"), whose statement,
>   Strategy and first solution step are on **p. 553 — inside lesson 25's PDF.** So `20` turns,
>   `2000 m⁻¹`, `1.0 cm` and `3.0 A/s` appear in a substitution line from nowhere. **This is the
>   mirror image of the lesson 21 → 22 seam:** there the *earlier* lesson held the statement and the
>   later one inherited the solution; here the *later* lesson (25) holds the statement and lesson 24
>   inherited the tail. Recorded in `GAPS IN THE SOURCE` item 2, which forbids presenting it as a
>   self-contained problem.
> - **So lesson 25's own build inherits two things from here:** it holds the *statement* of an
>   example whose answer is in lesson 24's file, and its pp. 562–565 pick up §13.4 cleanly.

> **⚠ HOW THE SIGN WAS SPLIT AGAINST LESSON 25, stated explicitly so lesson 25 does not duplicate
> it.** Faraday's law carries a minus sign whose meaning *is* Lenz's law, and Lenz's law is lesson
> 25. **This artifact probes magnitude and the rate-of-change structure only.** No objective key
> touches direction, no probe topic asks a cadet to predict which way an induced current flows, and
> the tutor never initiates it.
> - **What the source *does* print about direction, all of it usable:** the sentence after Eq. 13.2
>   that the minus sign describes the direction and that Lenz's law gives it "shortly"; the sentence
>   that the rod-on-rails emf "satisfies Lenz's law, as you can verify by inspection of the figure";
>   the word *opposes* in the jumping-ring Significance; and — the substantial one — **a fully worked
>   opposition argument inside Example 13.5(a)**, which reasons from an increasing outward flux to an
>   induced field into the page to a clockwise current **without ever naming the rule.** That
>   argument is Tier-1 on these pages and the tutor may use it as printed.
> - **Scoped engage-only:** a cadet who raises Lenz's law from their own Cengage reading is confirmed
>   and told they have read correctly, then told the rule is next lesson's business. Forbidden:
>   stating it as a named rule with its own derivation, setting direction-finding exercises, claiming
>   the reference explains the jumping ring, or initiating the topic.
> - **Lesson 25 therefore owns the whole of it** — the statement, the figures, both worked examples,
>   and the direction drilling. Nothing here pre-empts that.

> **⚠ One real source error, verified two ways, plus two wording defects.**
> 1. **The only printed appearance of μ₀ on these pages gives its units as `T·m/s`.** They are
>    **T·m/A**. Checked by reading the line off a **500-dpi** rendering (so it is not an extraction
>    artefact) and dimensionally: with T·m/A the product comes out in Wb/s = volts and reproduces the
>    printed `1.2 × 10⁻⁵ V`; with T·m/s it does not give volts at all. **The number is right and the
>    unit label is wrong.** No extension problem in this set uses μ₀, deliberately.
> 2. **Figure 13.4's caption calls an antiparallel orientation the "highest possible" flux.**
>    Antiparallel gives Φ = −BA, the most *negative* value. Verified two ways: Eq. 13.1 is a dot
>    product and cos 180° = −1; and the source's own Example 13.6 prints Φ = BA cos θ, which is
>    minimised at 180°. Read as "largest in magnitude" it is correct — and it matters more today than
>    usual, because the sign of the flux is exactly what this lesson hands to the next one.
> 3. **Example 13.5 switches the rod-length symbol from `r` to `l` inside its own Significance.** The
>    solution works throughout with a rod of radius/length `r` and reaches `Br²ω/2`; the Significance
>    then integrates from 0 to `l` and reports `½Bωl²` for the same rod. Verified two ways: the source
>    itself says "which is the same solution as before", true only if `l = r`; and the figure labels
>    the rod `r`. In that integral `r` is simultaneously the integration variable.

**Nine further notation caveats**, each with the self-consistent reading: **the minus sign is handled
five different ways on eight pages** — carried in Eqs. 13.2/13.3, dropped in 13.5/13.8 as
"magnitude", absolute-valued in Examples 13.1 and 13.5, kept and differentiated in 13.6 — none of it
wrong and none of it reconciled · **the area vector is a choice and the source says so exactly once**,
in Example 13.1's Strategy, which is the honest answer to a cadet worried about signs today ·
"the area of the quarter circle or A = r²θ/2" names the endpoint while printing the general sector,
and **radians are required and never mentioned** · `l` is a coil side, a rail separation, a rod length
and a tether length, printed as a script ell in two places and a plain `l` elsewhere, beside a capital
`I` · the source writes both `ε` and the literal word `emf` as the symbol in an equation · Example
13.1's statement gives `dB/dt = −0.040 T/s` and its substitution line uses `+0.040`, correct because
the magnitude was taken a line earlier · **`θ` does three jobs** — the angle to the normal, the rod's
angular position, and the angle in `F = IℓB sin θ` · the rotating coil's field is along `ĵ` with the
axis along `z`, the opposite lettering from the previous chapter's solenoid · and **the rail-gun
paragraph runs the mechanism backwards from the rest of the section**, attributing the armature
current to a *ramped-down field* so that it belongs in this section at all, which puts today's
induction and last lesson's `F = IL × B` in one paragraph with no separation.

**Checked and confirmed correct rather than flagged:** **all four printed numerical results reproduce
exactly** — `0.50 V` and `0.10 A` in the square-coil example, `1.2 × 10⁻⁵ V` in the orphan (recomputed
as 1.18 × 10⁻⁵), `150 μV` in the screwdriver estimate, and `7.80 × 10³ V` in the orbit example;
every algebraic step of Example 13.5, including that its two independent routes to the emf agree
identically; Figure 13.16(b)'s clockwise current against the printed flux argument, and 13.16(c)'s
`dF_m` arrow against `I dL × B` computed here; Figure 13.12's mutually consistent `v`, `I`, `F_m` and
`F_a`; and **Check Your Understanding 13.4's figure against its own text at 400 dpi** — the drawn
curved arrow does indicate the counterclockwise sense the words claim, and gravity acting at the
rod's centre of mass does produce a counterclockwise torque about the pivot. **That figure is right**,
which is worth recording because the corresponding check failed in three earlier lessons.

**Only four numbers exist on these pages, and the two best worked examples are entirely symbolic.**
There is no printed arithmetic anywhere for a rotating rod, a rotating coil, or a full energy balance.
Extension problems B, C and D exist to supply that, and every figure in them was computed here and
re-derived by a second, independent route for exactly that reason. Same class of thinness as lessons
18, 20 and 21 — here it costs *checks*, not a topic.

**Source uniqueness confirmed.** The PDF's SHA-256 was compared against every other file in the
corpus and is unique; in particular it differs from lesson 25's neighbouring
`Lenz's Law, Induced Electric Field.pdf`. This matters because the corpus contains **two** pairs of
files whose distinct names hide identical or nested content, so a distinct filename proves nothing.

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in all fifteen PHYS 215 artifacts, it is verbatim-copied text the skill says to
copy verbatim, and it is behaviourally harmless — the rule it illustrates is "never confirm wrong
physics to be agreeable." Recorded so the next agent does not think it was missed. Fixing it is a
cross-cutting change to the base, not a per-lesson edit.

**Unverified, same class as lessons 8, 10, 13, 14, 21 and 22:** that Cengage 30.1–30.2 covers this
span in the cadets' book. The evidence here is the strongest in the corpus so far: OpenStax §13.1 is
Faraday's law, §13.2 is Lenz's law, §13.3 is motional emf, and the cadets' 30.1–30.2 / 30.3–30.4 split
lands in the same place — **and the grounding PDFs were cut to match that split exactly**, which means
whoever assembled this corpus already mapped the two books. It is still not a look at a Cengage table
of contents.

### Lesson 25 — Lenz's Law, Induced Electric Field

| | |
|---|---|
| **File** | [`lesson_25_preflight_lenzs_law_induced_electric_field.jsx`](lesson_25_preflight_lenzs_law_induced_electric_field.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-25-lenzs-law-induced-electric-field-1a98a6d0` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/5e4c2081-0e06-47d5-8c9e-625760490617 |
| **Component** | `Lesson25Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax Vol. 2 **ch. 13** "Electromagnetic Induction" — §13.2 "Lenz's Law" (printed pp. 550–553) and §13.4 "Induced Electric Fields" (printed pp. 562–565). Eight pages in **two disjoint four-page blocks**; the eight pages between them are lesson 24's, not a hole |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Lenz's Law, Induced Electric Field.pdf` |
| **Cadets' reading** | Cengage 30.3–30.4 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 48 passed / 0 failed (37 base + 11 `--forbid` guards proving no lesson-24 objective key, slug stem, slug suffix, component name, filename stem, page range or source filename survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `lenz-opposes-change` | The induced effect opposes the change, not the field |
| 2 | `lenz-direction-procedure` | Applied field, rising or falling, induced field, current |
| 3 | `induced-e-nonconservative` | A changing flux makes an E field with no wire and no voltage |
| 4 | `induced-e-from-symmetry` | Symmetry turns the loop integral into E times 2 pi r |

> **Four topics, and the question was asked deliberately.** The test applied since lesson 21 is
> whether dropping one leaves a printed learning objective of the cadets' own reading with no probe
> against it. **The source prints exactly four learning objectives across its two sections and each
> topic above takes exactly one of them** — Lenz's law as a statement, then carrying out a direction
> determination, then "a changing magnetic flux creates an electric field", then "solve for the
> electric field based on a changing magnetic flux in time." The cadets' two Cengage sections split
> the same way: 30.3 is topics 1–2, 30.4 is topics 3–4. **If one has to go it is 4**, a technique
> rather than an idea — but it is also the only place a cadet learns that the induced field is not
> uniform and that it is nonzero where B is zero. Pacing therefore stays at the profile default,
> **4 × ~2 min**, and all five pacing strings were grepped and confirmed to say 2:
> `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING opener, the probing instruction, and
> the PACING line *"about its 2 min budget"* — the one that was wrong in ten earlier artifacts.

**Extension problems:** A **the same loop, four different things happening to it** — a uniform field
into the page, increasing, then held constant, then decreasing, then a half-radius loop, then a bad
rule stated out loud so the cadet has to say which case it breaks on (approachable, **Pass 2 reaches
every direction by the energy argument alone, naming no field direction and using no hand rule**) ·
B **the magnet and the ring, both ways, and then a copper pipe** — lower a north pole, hold it still,
lift it, lower a south pole, then explain the copper-pipe demonstration from those answers alone
(standard, **Pass 2 does the whole set by poles and repulsion first and converts to currents at the
end, matching Pass 1 in all three cases with the flux never mentioned**) · C **a coil in a ramped
field, and then the same field with no coil at all** — flux, emf, current with a direction, the
induced E in the wire, then the E at the same place with the wire removed, then at half the radius
(standard, **Pass 2 starts from `E = (r/2)·dB/dt` and works back to the emf, so no intermediate is
shared with Pass 1 and the factor of two becomes structural rather than arithmetic**) · D **a
solenoid, inside and outside, and one path that tells you nothing** — B inside, E at half the
solenoid radius and at twice it, where E is largest, which way it circulates, a non-encircling path
whose loop integral is zero *while the field on it is not*, and the work done on a charge carried
once round (challenging, **Pass 2 reduces (b), (c) and (d) to pure ratios against the surface value,
which exposes that (b) and (c) are equal for a structural reason, and re-derives the work from the
enclosed flux without ever computing a field**). Every number computed and independently re-checked
in Python.

**Transcribed off 150-dpi rasters, three regions re-rendered at 450–700 dpi:** 4 numbered equations
(13.9–13.12) plus ~10 unnumbered displays, 5 figures (13.7, 13.8, 13.9, 13.18, 13.19) plus the two
unnumbered figures attached to Check Your Understanding prompts, 3 worked Examples (13.2, 13.7, 13.8)
plus the head of a fourth, 1 six-step Problem-Solving Strategy, and 6 unanswered Check Your
Understanding prompts.

> **⚠ THE SOURCE IS TWO DISJOINT BLOCKS AND THE PAGES BETWEEN THEM ARE NOT MISSING — VERIFIED HERE,
> NOT INHERITED.** Printed folios run 550, 551, 552, 553 and then jump straight to **562**. Pages
> 554–561 are §13.3 *Motional Emf* — **lesson 24's material**, and they sit in lesson 24's own
> grounding PDF. The two files **tile printed pp. 546–565 with no overlap and no gap.** Both PDFs
> were rendered and read for this build rather than the tiling being taken from lesson 24's log.
>
> **All four cross-checks agree and the fifth is blind again, from the other side.** Folios skip
> 554 to 561; worked Examples run 13.2, the head of 13.3, then 13.7 and 13.8, so 13.4–13.6 are gone;
> Check Your Understanding runs 13.2, 13.3, then 13.6–13.9, so 13.4 and 13.5 are gone; Figures run
> 13.7, 13.8, 13.9, then 13.18, 13.19, so 13.10–13.17 are gone. **The numbered equations corroborate
> nothing: §13.2 carries no numbered equation at all, so the first numbered equation anywhere in
> this file is 13.9, on its fifth page, with nothing before it to compare.** Lesson 24's warning was
> that an equation-only check would have called *its* source contiguous; here the equation check
> cannot even see the seam. Recorded in the artifact's `GAPS IN THE SOURCE` block, item 7.

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS — READ THIS BEFORE BUILDING LESSON 26.**
> - **Printed pp. 550–553 and 562–565.** Both *outer* edges are **clean**: it begins at the §13.2
>   heading and ends after Check Your Understanding 13.9 at the foot of p. 565, and neither cut falls
>   inside a sentence. **§13.5 *Eddy Currents* begins on p. 566 and is not here** — that is lesson
>   26's neighbourhood, and lesson 26's source (`Generators and Motors, AC, Transformers.pdf`) was
>   confirmed by SHA-256 to be a different file from this one.
> - **The inner edge is not clean, and it is the mirror of lesson 24's.** Page 553 stops one line
>   into the Solution of Example 13.3 (*Changing Magnetic Field Inside a Solenoid*): the statement,
>   the Strategy and the first solution line are here, and the closing arithmetic and the
>   `1.2 × 10⁻⁵ V` answer are on p. 554, **inside lesson 24's PDF**. Lesson 24 inherited a
>   substitution line from nowhere; this build inherits a statement whose answer it does not have.
>   Recorded in `GAPS IN THE SOURCE` item 2, which permits using the statement and Strategy — both
>   are complete and genuinely good teaching — and forbids stating a numerical answer as something
>   the material gives.

> **⚠ HOW THE DIRECTION WORK DIVIDED AGAINST LESSON 24.** Lesson 24 probed magnitude and the
> rate-of-change structure only: no objective key there touches direction, no probe topic there asks
> which way a current flows, and its scope note says in so many words that the whole of the sign was
> left to this build. **So all four objectives here are first-class direction-and-field work and
> none re-probes lesson 24's material.** Flux, Faraday's law, motional emf and the rod's energy
> balance are `prerequisites` and `scope_note`'d as prior coursework: used freely and confidently,
> never probed, never presented as today's content. The one thing lesson 24 *did* use from these
> pages' territory — the unnamed opposition argument inside its own Example 13.5(a) — is here found
> stated as a rule, which is the intended progression rather than a duplication.

> **⚠ Two real source defects, both verified two ways, and neither is an arithmetic error.**
> 1. **The section's own magnitude recipe omits `N`, and the section's own second example needs it.**
>    §13.2 prints *"the magnitude of ε is given by ε = |dΦ_m/dt|"* with no `N` anywhere, while one of
>    its two printed learning objectives is to find the induced emf **in a coil**. Verified two ways:
>    the first worked example calls its subject "a circular coil", never states a turn count, and
>    computes ε = |dΦ_m/dt| with no `N`, which is only right for a single turn; and the second
>    example, on the facing page in the same section, ends its Strategy *"lastly, we include the
>    number of turns in the coil"* — inserting the `N` by hand because the printed recipe does not
>    carry it. **An unstated condition, not an error**, and load-bearing: a cadet who applies the
>    printed line to the 20-turn coil is off by twenty.
> 2. **Every printed number downstream of the first worked example is carried from a rounded
>    intermediate, and four of them disagree with full precision in the last digit.** The flux is
>    `1.5·π·(0.50 m)² = 1.178 Wb`, printed to two figures as `1.2 Wb` — legitimate — and `1.2` is
>    then used at every later step. Verified two ways: recomputing from 1.178 gives **5.89 V** and
>    **0.589 A** against the printed 6.0 V and 0.60 A, and **4.59 V** and **0.459 A** against the
>    printed 4.7 V and 0.47 A; and carrying the printed 1.2 Wb instead reproduces *every* printed
>    value exactly, which identifies rounding as the cause rather than an error. **A cadet who
>    reports 5.9 V or 0.59 A has done it more carefully than the page did and is told so.** The three
>    electric fields survive it — 1.87, 1.46 and 0.0126 round to the printed 1.9, 1.5 and 0.013.

**Eleven further notation caveats**, each with the self-consistent reading: **RHR-2 is named here and
is run backwards from the way it was introduced** — thumb on the induced *field*, fingers giving the
*current* — which agrees with lesson 22's resolution (RHR-2 = the field a current makes) but is a
genuinely different mental operation, and the source never flags the switch · **the Problem-Solving
Strategy uses the same unsubscripted `B` for the applied field in step 2 and the induced field in
step 4**, which is exactly where a shared symbol does damage, since the content of step 4 is that
they may point opposite ways · **"magnetic fields never do work on moving charges" is printed flatly,
one lesson after the cadets computed the work done against a magnetic retarding force** — true as
stated, load-bearing here, and guaranteed to be objected to by a good cadet, which the artifact
treats as the best thing that can happen · the boxed "summary" equation 13.12 is 13.9 and 13.10 on
one line and introduces nothing · `A` denotes the *solenoid's* cross-section in a calculation about a
larger path · `r` does three jobs and `R` a fourth · `n` and `N` appear three lines apart in one
problem, with a lowercase `d` for a *diameter* alongside · **"coil" means a single loop on one page
and a 20-turn winding on the facing page** · "viewed from above" is used for a figure drawn flat on
the page, where the better-worded "with respect to the bar magnet" appears one page earlier · the
boxed statement of Lenz's law makes the *direction* the subject that drives the current · and — the
one worth the most in conversation — **the source prints a second, independent route to every
direction answer (the near face becomes a pole that repels the approaching pole) and never says that
it is one.** The artifact uses both and lets the cadet find out they agree.

**Checked and confirmed correct rather than flagged:** **every printed numerical result reproduces**
once the source's own rounding is carried — the three emfs, the three currents and the three electric
fields — and the three electric fields reproduce from full precision as well; **Figure 13.18(b) at
700 dpi, arrowhead by arrowhead**, where the winding current is drawn clockwise as seen by the eye
(correct for the into-the-page field the ×'s show), and **both** induced-E circles are drawn
clockwise, which is what a *decreasing* into-the-page flux requires and is the same sense as the
winding current — so the figure and the printed part (c) agree; **Figure 13.7(a) and (b) at 450 dpi**,
whose current arrows are genuine mirror images and agree with both the caption and the prose;
**Figure 13.8 at 500 dpi**, where (a)'s two current arrows form one consistent circulation and (b)'s
printed `+`/`−` polarity does drive current in the original direction; **Figure 13.19's shape**
against both printed branches, including that the inside and outside expressions meet at `r = R`;
and the source's cylindrical-symmetry step, which is the same step the Ampère's-law lesson turned on.
**No arithmetic slip was found anywhere in this source** — the second such lesson in a row.

**Source uniqueness confirmed.** The PDF's SHA-256 was computed and compared against every other file
in the phys-215 corpus. It is unique; in particular it differs from lesson 24's
`Faraday's Law of Induction, Motional EMF.pdf` and from lesson 26's
`Generators and Motors, AC, Transformers.pdf`. The only duplicate pair in the corpus remains
`Displacement Current.pdf` / `Maxwell's Equations.pdf`, re-confirmed byte-identical by the same scan.

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in all sixteen PHYS 215 artifacts, it is verbatim-copied text the skill says to
copy verbatim, and it is behaviourally harmless. Recorded so the next agent does not think it was
missed; fixing it is a cross-cutting change to the base, not a per-lesson edit.

**Unverified, same class as lessons 8, 10, 13, 14, 21, 22 and 24:** that Cengage 30.3–30.4 covers this
span in the cadets' book. The evidence is the same as lesson 24's and just as strong — the OpenStax
§13.2 / §13.4 split lands exactly where the Cengage 30.3 / 30.4 split does, and **the grounding PDFs
were cut to match it**, which means whoever assembled this corpus had already mapped the two books.
It is still not a look at a Cengage table of contents.

### Lesson 26 — Generators and Motors, AC, Transformers

| | |
|---|---|
| **File** | [`lesson_26_preflight_generators_and_motors_ac_transformers.jsx`](lesson_26_preflight_generators_and_motors_ac_transformers.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-26-generators-and-motors-ac-transformers-1bbf05b9` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/72659902-7727-46f2-b28b-62d74961d1c1 |
| **Component** | `Lesson26Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics Vol. 2 — **§13.6** "Electric Generators and Back Emf" (printed pp. 570–575), **§15.1** "AC Sources" + **§15.2** "Simple AC Circuits" (printed pp. 624–630), and **§15.6** "Transformers" (printed pp. 645–648). Seventeen pages in **three disjoint blocks** across **two chapters** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Generators and Motors, AC, Transformers.pdf` (SHA-256 `9c92ae1c…`, unique in the corpus) |
| **Cadets' reading** | Cengage 30.5, 32.1–32.2, 32.8 — **the widest span in the run** |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards proving no lesson-25 objective key, slug stem, slug suffix, component name or source filename survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `generator-emf-nbaw` | Spinning coil: peak emf is N B A omega |
| 2 | `motor-back-emf` | A turning motor makes back emf; it limits the current |
| 3 | `ac-peak-vs-rms` | Peak, rms and frequency: 170 V peak is the 120 V outlet |
| 4 | `transformer-turns-and-power` | Turns set voltage, current inverts, power is conserved |

> **⚠ Four topics, and for the FIRST time in this run the constraint ran the other way — there is more
> printed material than there are slots.** Lessons 21, 22, 24 and 25 each had exactly four printed
> learning objectives and each topic took one, so "does dropping one orphan a printed objective?" was
> a usable test. **This source prints NINE learning objectives across four sections in two chapters,
> so no set of four can satisfy that test and the artifact does not claim it does.** The rule applied
> instead is **one topic per assigned Cengage section**, with 30.5's two halves taking topics 1 and 2
> because the section itself separates them. Five was considered and rejected: the cadet-facing card
> promises "about 10 minutes" and 5 × ~2 min overshoots it. All five pacing strings were grepped and
> confirmed to say 2 — `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING opener, the probing
> instruction, and the PACING line *"about its 2 min budget"*, the one that was wrong in ten earlier
> artifacts.

> **⚠ What that costs, and it is the one deliberate scope decision in the file: capacitive and
> inductive reactance are ENGAGE-ONLY.** `X_C = 1/(ωC)`, `X_L = ωL`, the quarter-cycle lead and lag,
> and phasor diagrams are all fully transcribed and all genuinely Tier-1 — the tutor engages fully and
> confidently if a cadet raises them, and never initiates them, sets exercises on them, or reports on
> them. **The reason is a book-mapping asymmetry:** the cadets are assigned Cengage 32.1–32.2, and
> OpenStax bundles the resistor, the capacitor *and* the inductor into one section (§15.2) that cannot
> be cut inside. **If Cengage 32.2 is "Resistors in an AC Circuit" — the standard layout, and the one
> consistent with 32.8 being the transformer section — then capacitors and inductors in ac circuits
> are Cengage 32.3–32.4 and were NOT assigned.** Probing them would probe unassigned material; leaving
> them engage-only costs nothing. **That is an inference about the cadets' book, not a verified fact,
> and it is recorded here so recker can overturn it in one line.** Phasors are additionally
> engage-only for a second reason: this is a text conversation with no drawing surface.

**Extension problems:** A **one generator coil and every knob on it** — peak, rms, where in the turn
the emf is zero, doubling the shaft speed, and then **the same wire rewound to half the radius and
twice the turns** (approachable, **Pass 2 collapses the peak to `2π²NBr²f` so no area or ω is ever
computed, and gets the rewind by the scaling `ε₀ ∝ r` at fixed wire length, which explains why the
answer is a factor of two rather than the four a cadet expects**) · B **the source's own generator
example, done three ways** — the true average from the flux change, the peak, their ratio, the rms,
and then all three ranked against the 120 V outlet (standard, **Pass 2 reaches the peak through the
period rather than through π/2 over dt, and reaches the average from the peak via ⟨sin⟩ = 2/π, so the
ratio is proved rather than observed**) · C **a motor running, stalled, and loaded down** — back emf,
the two-way power split, the stalled current and its **sixteen-fold** heating, a half-back-emf load,
and finally **the back emf at which mechanical output is greatest** (standard, **Pass 2 is symbolic
first: `P_m = ε_b(V−ε_b)/R`, whose sum with `P_R` collapses to `V·I` identically, so the balance is an
identity rather than arithmetic luck, and whose maximum falls at `V/2` by the parabola's symmetry with
no calculus**) · D **60 kW down a long wire, with and without transformers** — the absurd 240 V case
where only 40 V arrives, the 12 kV case, the loss factor of 2500, the turns counts, **the 250 A that
does not disappear but merely moves**, the reflected resistance two ways, and whether any of it works
on dc (challenging, **Pass 2 does the whole of (a) and (b) from the single fraction `P·R/V²`, which
gives both the loss and the voltage drop with no current computed anywhere**). Every number computed
and independently re-checked in Python.

**Transcribed off 150-dpi rasters, five regions re-rendered at 500 dpi to read the three defective
sentences character by character:** 18 numbered equations (13.13–13.18, 15.1–15.8, 15.20–15.23) plus
~15 unnumbered displays, 19 figures (13.27–13.33, 15.2–15.10, 15.20–15.22), 4 worked Examples (13.9,
13.10, 15.6, plus half of 15.1), the inline stalled-versus-running motor calculation, and 2 unanswered
Check Your Understanding prompts.

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS — every block, stated for the next build.**
> - **Printed pp. 570–575, then 624–630, then 645–648.** Seventeen pages, three blocks, two chapters.
> - **The three blocks map one-for-one onto the cadets' three assigned Cengage groups** — 30.5 is
>   §13.6, 32.1–32.2 is §15.1–§15.2, 32.8 is §15.6 — which is why the excisions look deliberate rather
>   than damaged. Same conclusion lessons 24 and 25 reached about chapter 13, still an inference.
> - **Unlike the 24/25 pair, the missing pages are in NO other artifact's file.** Absent and nowhere
>   in this run's corpus: **§13.5 Eddy Currents, printed pp. 566–569** — exactly the four pages between
>   where lesson 25's source stops (p. 565) and where this one starts (p. 570) — plus §13.7, **the
>   whole of chapter 14 on inductance**, and **printed pp. 631–644 = §15.3 RLC Series Circuits, §15.4
>   Power in an AC Circuit, §15.5 Resonance.**
> - **Edges.** p. 570 opens at a section heading; p. 575 closes after a worked example's Significance
>   with no sentence cut, though whether §13.6 itself ends there is unknowable from these pages and its
>   own Check Your Understanding is probably on p. 576. p. 624 opens at a section heading. **p. 630
>   cuts a worked example in half** — its statement asks for a resistor, a capacitor *and* an inductor
>   and only the resistor is worked; parts (b) and (c) are on p. 631. **p. 645 opens mid-§15.5 on an
>   ORPHANED Check Your Understanding about RLC resonance** whose supporting material is on no page
>   here. p. 648 closes cleanly at the end of §15.6.
> - **Lesson 28 is next and does not touch this material** — its source opens at OpenStax §16.1 and is
>   byte-identical to lesson 29's. Nothing here constrains it.

> **⚠ THE CHECK-YOUR-UNDERSTANDING SEQUENCE IS BLIND AT THE FIRST SEAM — a third sequence, and a
> third lesson in a row where one of the four says nothing.** Within each block every sequence is
> unbroken, so there is **no interior hole anywhere**: folios 570–575 / 624–630 / 645–648, equations
> 13.13–13.18 / 15.1–15.8 / 15.20–15.23, figures 13.27–13.33 / 15.2–15.10 / 15.20–15.22, Examples
> 13.9–13.10 / 15.1 / 15.6. **At the second seam all four agree** — nine equations, nine figures, four
> Examples and six Check Your Understanding prompts vanish together. **At the first seam the Check
> Your Understanding sequence sees nothing, because block 1 prints no such prompt at all**; the first
> one anywhere in the file is 15.1, on its eighth page. Lesson 24 was blinded by the equation check,
> lesson 25 by the same check from the other side, and this is a different sequence again. **Never
> require all four to agree before calling something a gap.**

> **⚠ Three real source defects, each verified two ways at 500 dpi, and NONE of them is an arithmetic
> error — every printed number in this source reproduces exactly.**
> 1. **The only generator worked example computes the PEAK emf and its Significance calls it "a
>    practical average value."** It evaluates `N·B·A·sin(90°)·(π/2)/(15.0 ms) = 131 V`. **Verified two
>    ways:** the true average over that quarter turn is `N·ΔΦ/Δt = 83.8 V`, not 131; and the number the
>    example produced is *exactly* the peak `ε₀ = N·A·B·ω` that the same section boxes two pages later,
>    with `ω = (π/2)/15.0 ms = 104.7 rad/s`. The two differ by `131.5/83.8 = 1.5708 = π/2`, which is
>    precisely the peak-to-average ratio of a quarter sine. **The arithmetic is right and the word is
>    wrong**, and it lands squarely on probe topic 1 — so extension problem B exists to repair it, and
>    the tutor is told that a cadet quoting 131 V as an average **has read the page correctly** and
>    should be asked *which quantity* they have rather than corrected. The Significance compounds it by
>    comparing 131 V to "the 120 V used in household power", which is an **rms** value — and that
>    collision is the natural bridge into topic 3.
> 2. **"The generator output of a motor is the difference between the supply voltage and the back
>    emf."** Backwards: a motor's generator output *is* the back emf. **Verified two ways:** the same
>    page's own numbers call that difference "the total voltage across the coils" (48.0 − 40.0 = 8.0 V),
>    and the worked example a page later writes `ε_i = ε_s − I·R`, i.e. the back emf is what is *left*
>    after the resistive drop. **The sentence is wrong and every equation around it is right.**
> 3. **Capacitive reactance is glossed with the inductor's sentence** — "the opposition of a capacitor
>    to a change in current", the same clause used verbatim for the inductor two pages later, where it
>    is standard and correct. **Verified two ways:** the identical wording in both places, and the very
>    next clause saying high frequency gives *low* capacitive reactance, which is the opposite of
>    opposing a change in current. A capacitor resists a change in **voltage**. Engage-only territory,
>    recorded anyway.

**Nine further notation caveats**, each with the self-consistent reading: **an italic Latin `w` printed
where `ω` belongs, on a page where `w` is also the rotating coil's width** (confirmed at 500 dpi; the
same sentence writes ω correctly twice) · a cross-reference that sends the reader to the
induced-electric-field section for a description of a power-plant generator, which is **the first block
of this very source** · the 60 Hz half-period axis label printed as `16.6` where the period is 16.667 ms
· **the fluorescent lamp flickering at 120 Hz on a 60 Hz supply, stated and never explained** (light
tracks power, power goes as `i²`, and squaring a sinusoid doubles its frequency — a cadet who asks "why
120 and not 60" has spotted a real gap) · lowercase-instantaneous versus capital-peak declared as a rule
in one chapter and then mixed in the transformer derivation, with the licence to use rms values arriving
only in the section's last sentence · the boxed Eq. 15.23 being Eq. 15.22 in capitals with nothing added
· the step-down example comparing two situations that are not the same system, correctly and on purpose
· *"the motor is turning more slowly in this case, so its power output… [is] larger"*, true as arithmetic
but hiding the real chain and false as a general rule past the halfway point in back emf · and **the
source never stating where in a rotation the emf is largest**, which its own two equations settle and
which is the day's most likely wrong answer.

**Two things the material promises or implies and never prints, both licensed as derivations rather
than quotations:** the join between the printed **170 V amplitude** and the printed **120 V outlet**
figure — the page says the connection is "explained later in the chapter" and `V_rms = V₀/√2` appears
six pages later in a different section, with the two never put in one sentence (170/√2 = 120.2,
311/√2 = 219.9) — and **that a transformer cannot work on dc**, which every line of its derivation
implies through `dΦ/dt` and which no sentence states. Both are handed to the cadet as things to
conclude, not facts to quote.

**Checked and confirmed correct rather than flagged:** **every printed numerical result reproduces
exactly** — the generator example's 131 V *as a peak*, the stalled motor's 120 A and 5.76 kW and the
running 20 A and 160 W, all eight figures of the series-wound motor example including the energy
balance in **both** parts (1.2 kW = 1.0 + 0.2 and 2.4 kW = 1.6 + 0.8), the resistor branch's 0.10 A,
and every number in the step-down transformer example including the loss ratio 2 × 10⁶ / 800 = 2500 =
50². **No arithmetic slip was found anywhere in this source** — the third such lesson in a row. The
one wrong claim on these pages is a **label**, not a sum.

**Source uniqueness confirmed.** The PDF's SHA-256 (`9c92ae1c…`) was computed and compared against
every other file in the phys-215 corpus. It is unique; in particular it differs from lessons 24's and
25's grounding files. The only duplicate pair in the corpus remains `Displacement Current.pdf` /
`Maxwell's Equations.pdf`, re-confirmed byte-identical by the same scan.

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in all seventeen PHYS 215 artifacts, it is verbatim-copied text the skill says to
copy verbatim, and it is behaviourally harmless. Recorded so the next agent does not think it was
missed; fixing it is a cross-cutting change to the base, not a per-lesson edit.

**Open questions for recker, in priority order:**
1. **Is Cengage 32.2 "Resistors in an AC Circuit" or something wider?** The whole engage-only scoping
   of reactance rests on the narrow reading. If 32.2 covers capacitors and inductors too, promoting
   reactance to a fifth topic — or swapping it for topic 3 — is a rebuild, not an edit.
2. **Is there a source anywhere for §13.5 Eddy Currents?** It is named twice in this lesson's own
   material and explained on four pages nobody in this corpus has. Same class of hole as lesson 16's.
3. **The generator example's "average" defect is the strongest teaching hook in the artifact** and it
   is also the thing most likely to make a cadet think the tutor is contradicting their book. The
   handling is: agree with what the page says, then ask which quantity they have. Worth a look.

**Unverified, same class as lessons 8, 10, 13, 14, 21, 22, 24 and 25:** that Cengage 30.5, 32.1–32.2
and 32.8 cover these spans in the cadets' book. The circumstantial evidence here is unusually strong in
one direction — **the three blocks map one-for-one onto the three assigned groups, and the excised runs
correspond to sections the assignment skips** — and unusually consequential in another, because the
32.2 reading is what decides whether reactance belongs in this lesson at all. It is still not a look at
a Cengage table of contents.

### Lesson 28 — Displacement Current

| | |
|---|---|
| **File** | [`lesson_28_preflight_displacement_current.jsx`](lesson_28_preflight_displacement_current.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-28-displacement-current-dc9f8b07` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/54ca7e7d-e232-4b91-a490-aaebeccdf331 |
| **Component** | `Lesson28Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics Vol. 2 — **§16.1** "Maxwell's Equations and Electromagnetic Waves", printed pp. 658–663. Six pages, **one contiguous block, no interior hole, clean at both edges** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Displacement Current.pdf` (SHA-256 `4fe0d5f3…31731dc4`) — **byte-identical to `Maxwell's Equations.pdf`, lesson 29's source. Re-verified for this build** |
| **Cadets' reading** | Cengage 33.1–33.2 |
| **Probe topics** | **3** · ~3 active min each · ~10 min |
| **Checks** | `check_artifact.py` 45 passed / 0 failed (37 base + 8 `--forbid` guards proving no lesson-26 objective key, slug stem, slug suffix, component name or source filename survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed by recker on 2026-08-05 and passed unchanged; prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `ampere-surface-ambiguity` | One loop, two surfaces, two different answers |
| 2 | `displacement-current-term` | Changing electric flux, not moving charge |
| 3 | `ampere-maxwell-consistency` | The repaired law agrees on every surface |

> **⚠ THREE TOPICS, AND THE SOURCE DECIDED IT RATHER THAN A PREFERENCE.** §16.1 prints **four**
> learning objectives. **This lesson owns exactly one of them** — *"Explain Maxwell's correction of
> Ampère's law by including the displacement current."* The other three (state and apply the four
> equations; the symmetry that predicts waves; Hertz's confirmation) are **lesson 29's, from the same
> six-page file**. A fourth topic here could only have been taken from those three, which is precisely
> the double-conversation the 28/29 split exists to prevent. So the day is that one printed objective
> decomposed into the three moves the source itself makes: **the contradiction, the new term, the
> repaired law.** The per-topic budget widened to ~3 min so the cadet-facing "about 10 minutes" stays
> true — the same trade recker's review made for lessons 13, 15 and 20. **All five pacing strings were
> grepped in the finished file and all five say 3.**

**Extension problems:** A **the same loop, the two surfaces, and a real number for each** — dΦ_E/dt,
the displacement current, dE/dt, then B on a 2 cm loop *between the plates* against B on a 2 cm loop
*around the wire* (approachable; **Pass 2 re-derives the gap field symbolically as `μ₀·I·r/(2π·R²)` and
then applies the RIM CHECK — set r = R and it becomes the wire formula exactly, so neither expression
can carry a stray factor**) · B **when is the displacement current biggest** — the time constant, I_d at
0, τ and 3τ, and the answer to the source's own unanswered Check Your Understanding (standard; **Pass 2
gets the t = 0 current with no derivative at all, from `Q_∞/τ = C·V₀/(R·C) = V₀/R`**) · C **why the fix
had to be exactly this** — evaluate both sides on each surface, then prove `ε₀·dΦ_E/dt = I` for *any*
charging rate from Gauss's law, then two separate reasons a constant would have failed (standard;
**Pass 2 reaches the same result by a route that never invokes Gauss's law — `Φ_E = E·A = V·C/ε₀ = Q/ε₀`
from the capacitor relations — and a third time numerically off problem A's figures**) · D **a magnetic
field with no current anywhere** — a changing uniform E in a cylinder of empty space, J_d, B inside and
outside (challenging; **Pass 2 uses the compact `B = μ₀·J_d·r/2` and then the RIM CHECK again, both
expressions agreeing to 4.17 × 10⁻⁷ T at r = R**). Every number computed and independently re-checked
in Python.

**Transcribed off 150-dpi rasters, four regions re-rendered at 400–600 dpi:** 12 numbered equations
(16.1–16.12) plus 4 unnumbered displays, 4 figures (16.2–16.5), **1 worked Example (16.1) in full**,
and 2 unanswered Check Your Understanding prompts.

> **⚠ THE WORKED-EXAMPLE CROSS-CHECK IS THE BLIND ONE THIS TIME — a fourth sequence in a fourth build.**
> Folios run **658–663** unbroken. Numbered equations run **16.1 → 16.12** unbroken. Figures run
> **16.2 → 16.5** unbroken. Check Your Understanding runs **16.1, 16.2** unbroken. **The Example
> sequence has nothing to say at all: the section prints exactly one worked Example, so there is no
> second number to compare it against.** Lesson 24 was blinded by the equation check, lesson 25 by the
> same check from the other side, lesson 26 by the Check Your Understanding check, and this is a fourth
> sequence again. **Never require all four to agree before calling something a gap.**

> **⚠ BOTH EDGES ARE CLEAN — the first source in this run of which that is true.** p. 658 opens at the
> §16.1 section heading with its printed learning objectives; p. 663 closes after the section's final
> Check Your Understanding and its closing rule. **Neither edge cuts a sentence and there is no missing
> middle.** What is absent is the chapter's own opener — the chapter title, its introduction and Figure
> 16.1 are on p. 657 — which is why the figure sequence starts at 16.2. That is a chapter-opener
> absence, not a hole, and nothing in the section depends on it. Note also that **pp. 649–657 sit
> between where lesson 26's source stops (p. 648) and where this one starts**; on the standard layout
> those are chapter 15's end-matter plus the chapter 16 opener, but that was *not* verified here and it
> is recorded as an inference.

> **⚠ Two real source defects, each verified two ways, and NEITHER is an arithmetic error.**
> 1. **Equation 16.7 subscripts a closed LINE integral with a SURFACE.** It prints
>    `∮_{S₁} B·dl = μ₀·dQ_in/dt = μ₀·I` where it must print `∮_C`. **Verified two ways:** read at
>    **600 dpi**, where the character is unambiguously `S` with subscript 1; and **the identical
>    integral appears six other times on these pages — Eqs. 16.1, 16.2, 16.4, 16.5, 16.6 and the
>    unnumbered two-case display — with the loop `C` every single time**, while `B·dl` is a line
>    element that cannot be integrated over a surface at all. **The physics is right and the decoration
>    is wrong.** This is the worst possible page for it: **the entire lesson is about the difference
>    between a loop and the surfaces it bounds**, and it lands squarely on probe topic 1. The tutor is
>    told that a cadet who says "the integral is over S₁" **has read the page correctly** and is to be
>    treated as having found the book's slip, not as having made an error — and misconception 4 names
>    it explicitly so the tutor cannot mistake one for the other. Likely origin: the very next sentence
>    discusses "the surface S₁" case and the case label appears to have migrated onto the integral sign.
> 2. **Example 16.1's Strategy sends the reader to the wrong chapter** for the RC result it uses,
>    naming *"Alternating-Current Circuits"*. **Verified two ways:** the example's own statement
>    specifies a resistor and a **battery** and its mathematics is the dc charging transient
>    `V₀(1 − e^(−t/RC))`, which no ac analysis produces; and **the pages of that very chapter that this
>    corpus holds — lesson 26's grounding, §15.1, §15.2 and §15.6 — were text-searched for this build
>    and contain ZERO occurrences of "RC circuit."** **This one has a real cost:** lesson 16 (RC
>    Circuits) is deferred precisely because **this course has no grounding source for RC circuits
>    anywhere**, so a cadet chasing that pointer would find nothing. The artifact scopes the transient
>    as Tier-2 prior coursework, forbids presenting it as today's material, and forbids sending a cadet
>    to look it up.

**Two further caveats recorded rather than normalized:** an **ambiguous clause in the symmetry
paragraph** — *"The displacement current source for the electric field, like the Faraday's law source
for the magnetic field, produces only closed loops of field lines"* — which is backwards under the
"source **of**" reading and correct under the "source **arising from**" reading, with nothing on the
page settling it. **Not claimed as an error**, transcribed exactly, and flagged because **it sits in
lesson 29's half and that build will have to decide what to do with it.** And an **unstated orientation
convention**: making S₁ and S₂ into one closed surface requires reversing one normal, which the source
does silently — harmless here because the S₁ flux is zero, so nothing downstream is wrong, but the step
is not as clean as it looks.

**Checked and confirmed correct rather than flagged: every line of algebra in this source reproduces
exactly.** Example 16.1 was re-derived independently by **both** of its own routes — the flux route
gives `I_d = ε₀·A·(V₀/d)·(1/RC)·e^(−t/RC)`, which collapses to `(V₀/R)·e^(−t/RC)` once `C = ε₀A/d` is
substituted, and the charge route gives `dQ/dt = C·V₀·(1/RC)·e^(−t/RC)` = the same thing. **They agree
exactly, which is the entire point the example is making.** No arithmetic slip was found anywhere —
**the fourth such lesson in a row.** Both defects above are labels, not sums.

**Source duplication re-confirmed.** `Displacement Current.pdf` and `Maxwell's Equations.pdf` were
re-hashed for this build: identical SHA-256 `4fe0d5f3…31731dc4`, identical 3,803,535 bytes. The claim
in the queue section below holds exactly.

#### What lesson 29 still has — the seam, stated page by page

**This is the load-bearing output of this build.** Lesson 29 is built from the *same file*, so the only
thing keeping the two artifacts from probing the same material is this record. **Everything below was
transcribed into lesson 28's grounding and scoped ENGAGE-ONLY there** — it has no objective key, so it
cannot reach lesson 28's `d` payload or the cohort rollup, and the `scope_note` forbids the tutor from
initiating any of it.

| what | where | consumed by 28? |
|---|---|---|
| §16.1 heading + 4 printed learning objectives | p. 658 | **objective 1 only** — 2, 3 and 4 are lesson 29's |
| Maxwell biography, **Figure 16.2** (his photograph) | p. 658 | shared context; decorative, no physics |
| **Eq. 16.1** Ampère's law + the surface-independence requirement | p. 658 | **YES — topic 1** |
| **Figure 16.3** capacitor, loop C, surfaces S₁ and S₂ | p. 659 | **YES — topic 1**, it *is* the argument |
| unnumbered two-case display (μ₀I vs 0) | p. 659 | **YES — topic 1** |
| **Eqs. 16.2, 16.3** + the flux definition + the "displacement current" paragraph | p. 659 | **YES — topic 2** |
| **Eq. 16.4** Ampère-Maxwell law | p. 659 | **YES — topic 3** |
| **Eqs. 16.5, 16.6**, the Gauss splice, **Eq. 16.7** | pp. 659–660 | **YES — topic 3** |
| **Example 16.1** (a) and (b), the section's *only* worked example | pp. 660–661 | **YES — topic 3**, in full |
| **Check Your Understanding 16.1** (when is the induced B greatest) | p. 663 | **YES — topic 2**, and extension B |
| **Eqs. 16.8–16.11**, the four equations as a boxed set | p. 661 | **NO — LESSON 29** |
| **Eq. 16.12** the Lorentz force law | p. 661 | **NO — LESSON 29** |
| the **MAXWELL'S EQUATIONS** box: four plain-language statements | p. 661 | **NO — LESSON 29** |
| the symmetry paragraph (+ the ambiguous clause above) | p. 662 | **NO — LESSON 29** |
| the relativity / electroweak unification paragraph | p. 662 | **NO — LESSON 29** |
| "The Mechanism of EM Wave Propagation" + **Figure 16.4** (B₀→E₀→B₁→E₁→B₂) | p. 662 | **NO — LESSON 29** |
| the history: Young 1801, Foucault, Fresnel | p. 662 | **NO — LESSON 29** |
| "Hertz's Observations", `f₀ = 1/(2π√(LC))`, `v = fλ`, the hertz | p. 663 | **NO — LESSON 29** |
| **Figure 16.5** Hertz's transmitter/receiver apparatus | p. 663 | **NO — LESSON 29** |
| **Check Your Understanding 16.2** (purely electric wave in vacuum?) | p. 663 | **NO — LESSON 29** |

**Three things the lesson 29 build needs to know before it starts:**

1. **YES, SIX PAGES CARRIES BOTH SESSIONS — but the two halves are thin in different ways, and 29's
   thinness is the awkward one.** Lesson 28's half is equation-dense (7 numbered equations, a figure
   that carries the argument, a complete worked Example). **Lesson 29's half has FIVE equations, TWO
   figures, and ZERO worked examples** — the section's only Example is consumed here. **So lesson 29's
   extension problems must be CONSTRUCTED from the equations rather than adapted from a printed one.**
   That is genuinely harder than every other build in this run and it is the single biggest risk to
   that lesson. The raw material for constructing them is there — the four laws each admit a "what does
   this one forbid" question, `f₀ = 1/(2π√(LC))` and `v = fλ` are both numerically workable, and
   Check Your Understanding 16.2 is a ready-made conceptual problem — but none of it comes pre-worked.
2. **Lesson 29 is the richer half conceptually, and the printed objectives say so: it gets three of
   the four.** Four laws each needing a plain-language statement, the symmetry argument, the
   bootstrapping propagation chain, and Hertz's experimental confirmation is comfortably four probe
   topics if that is wanted — **so lesson 29 may legitimately run this course's default 4 × ~2 min
   rather than 28's 3 × ~3.** Decide it from the material, not from parity with this file.
3. **THE SPEED OF LIGHT IS NOT IN THIS SOURCE.** `c = 1/√(ε₀μ₀)` appears nowhere on these six pages
   and the section explicitly defers the derivation to §16.2 — which is **lesson 30's** grounding
   (`Electromagnetic Waves, EM Spectrum.pdf`, opens at §16.2). Lesson 29 must treat the numerical speed
   the same way lesson 28 does: name it as coming, do not derive it, do not build a probe topic on it.
   The source's own wave content stops at *"in the next section, we show in more precise mathematical
   terms…"*.

**Unverified, same class as lessons 8, 10, 13, 14, 21, 22, 24, 25 and 26:** that Cengage 33.1–33.2
covers this span in the cadets' book. Here the circumstantial evidence is unusually good — **Cengage
33.2 appears in the Reading column of *both* lesson 28 and lesson 29**, so the course itself treats this
as one body of material taught over two days, which is exactly the shape of a single OpenStax section
split in two. It is still not a look at a Cengage table of contents.

### Lesson 29 — Maxwell's Equations

| | |
|---|---|
| **File** | [`lesson_29_preflight_maxwells_equations.jsx`](lesson_29_preflight_maxwells_equations.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-29-maxwells-equations-7a27dd4c` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/31e33675-a7eb-4902-aa1d-9466ec3d1d10 |
| **Component** | `Lesson29Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics Vol. 2 — **§16.1** "Maxwell's Equations and Electromagnetic Waves", printed pp. 658–663; **this lesson's half is pp. 661–663**. Six pages, one contiguous block, no interior hole, clean at both edges |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Maxwell's Equations.pdf` (SHA-256 `4fe0d5f3…31731dc4`) — **byte-identical to lesson 28's source. Re-hashed for this build: same 64-hex digest, same 3,803,535 bytes** |
| **Cadets' reading** | Cengage 33.2 |
| **Probe topics** | **3** · ~3 active min each · ~10 min — **built as 4 × ~2; the fourth was dropped on recker's review, 2026-08-05.** See the callout below |
| **Checks** | `check_artifact.py` **45 passed / 0 failed** after the review edit (37 base + 8 `--forbid` guards — the original 7 proving no lesson-28 objective key, slug stem, slug suffix, component name or source filename survived the rebase, plus `hertz-confirmation` proving the dropped key left nothing behind) |
| **Status** | **PUBLISHED 2026-08-05.** recker accepted three objectives and rejected the fourth (`hertz-confirmation`, comment *"Drop it"*) in `serve_artifact_review.py`; **the edit was applied before publication, so the live artifact is the three-topic, ~3-min version** — not the four-topic build this section's tables originally described. Prefill link not yet generated; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `four-laws-as-a-set` | What each of the four equations asserts |
| 2 | `symmetry-and-its-limit` | Where the two induction laws mirror, and where they do not |
| 3 | `wave-bootstrap` | Each changing field creating the other, outward |
| ~~4~~ | ~~`hertz-confirmation`~~ | ~~Making, catching and timing the waves~~ — **dropped on review 2026-08-05** |

> **BUILT AT FOUR TOPICS, SHIPPED AT THREE.** §16.1 prints **four** learning objectives and this
> lesson owns three of them (state and apply the four equations; the symmetry that predicts waves;
> Hertz's confirmation) against lesson 28's one. Those unpacked into four demonstrable topics —
> objective 2 was topic 1, objective 4 was topic 4, and **objective 3 split cleanly in two**, the
> *structural* half (what the symmetry is and where it fails) and the *dynamical* half (what the
> symmetry then does), which are genuinely different because a cadet can see that the equations
> mirror each other and still not see why that makes anything propagate. So the build ran the
> profile's own shape unmodified, `probe_topics_default: 4` at `per_topic_minutes: 2` — the only
> build in this run that could.
>
> **recker dropped topic 4 on review, 2026-08-05, comment *"Drop it"*.** Hertz's confirmation was
> the one topic a cadet could pass by narrating an experiment rather than reasoning about fields; it
> is the day's history rather than its physics. What survives is the day's argument — structure,
> then limit, then consequence. **This is not the build failing its own "no subdivision invented to
> reach four" bar**: topic 4 was a printed learning objective in its own right, and the objection is
> to what it assesses, not to whether it existed.
>
> **THE COUNT CHANGE FORCED A BUDGET CHANGE, and that is the part of this edit most likely to be
> got wrong on a later rebuild.** 3 × ~2 min delivers about six minutes against a start card that
> promises "about 10", so the per-topic budget widened to **~3 min** — the same trade recker's
> review already made for lessons 13, 15, 20 and 28, and it lands this artifact on lesson 28's exact
> shape. **SIX pacing strings state that budget, not the five every artifact's header comment
> claims**: the constant, the `time_budget` block, the PACING opener, the probing instruction, the
> PACING line "about its 3 min budget", and — the one the comment omits — the PACING line "its full
> ~3 min". All six were grepped in the finished file and all six say 3. The sixth has been present
> in every artifact in this course all along; nothing was ever wrong because of it, because until
> now no artifact changed its budget after the header comment was written.
>
> **Hertz stays in the grounding, transcribed and usable.** The pages are still there, the radio
> lateral connection is still there, misconception 6 is still there, and extension problem A still
> puts numbers on the experiment. What is gone is the objective key — so it cannot reach the `d`
> payload or the cohort rollup — and the `scope_note` now carries the same engage-but-never-probe
> instruction it already used for lesson 28's displacement current and for the speed of light. A
> cadet who raises radio meets a tutor who knows the material; the timed conversation just does not
> go looking for it.

**Nothing lesson 28 probed is re-probed.** Lesson 28's three objective keys have no counterpart here,
and the splice asserts mechanically that none of the three strings survived. The displacement current
*is* transcribed in this artifact's grounding and the tutor leans on it freely — **as prerequisite,
exactly as lesson 25 treated lesson 24's flux and Faraday work** — but it carries no objective key, so
it cannot reach the `d` payload or the cohort rollup, and the `scope_note` forbids building a question
whose real subject is the two surfaces, the capacitor argument, or what the displacement current is.
**The scope note here is the inverse of lesson 28's and the file says so explicitly**: that lesson had
to avoid material the cadets had not met; this one leans on material they now have.

**Extension problems — CONSTRUCTED, and this is the entry that most needs reading.** A **Hertz's
numbers forwards and backwards** — f₀ from L and C, then a speed from f and λ, then "does this support
the claim, and what would you blame for a factor of two" (approachable; **not a probe topic since the
2026-08-05 review** — enrichment on grounding the timed conversation no longer assesses, and the only
place in the artifact where today's physics gets a number attached, since this half of the source
contains no arithmetic at all; part (d) still exercises topic 3) · B **what the flux
through a closed surface tells you** — which law a nonzero magnetic flux violates, then Q_in from an
electric flux, then *where a classmate's wrong answer came from* (standard; topics 1–2) · C **one link
of the bootstrap with a number on it** — induced E at the rim from dB/dt, then which term forces the
next link with no current anywhere (standard; topics 3 and 2) · D **Maxwell's equations far from
everything** — reduce all four with Q_in = 0 and I = 0, sort them into the surface pair and the loop
pair, then answer the source's own unanswered Check Your Understanding in *both* directions
(challenging; topics 1–3). Spans all three surviving probe topics plus the retired fourth; one approachable, one stretching.

> **⚠ HOW THE CONSTRUCTED NUMBERS WERE VERIFIED, AND WHAT THAT VERIFICATION IS NOT.** Lesson 28
> consumed **the section's only worked Example**, so this lesson has five equations, two figures and
> **zero worked examples** — and, as it turned out, **not one numerical value of any kind in its half
> of the source beyond dates**. Every number in A, B and C is therefore this build's own invention
> with **no printed answer behind it**. Each was computed **at least two independent ways in Python**
> and both passes are written into the artifact: A gets f₀ from the printed formula and again from
> `ω₀ = 1/√(LC)`, then the speed as `f·λ` and again as `λ/T`; B gets `Q_in = ε₀Φ_E` by calculator and
> again by separating mantissa and exponent, then closes the round trip by dividing back; C gets the
> rim field from `E = (R/2)(dB/dt)` and again from flux-over-circumference computed from scratch.
> **A additionally carries a physical self-check that is stronger than either pass** — the constants
> were chosen so `LC = 1.0 × 10⁻¹⁷` exactly, and the answer *has* to land on the speed of light or the
> physics is wrong; it lands at 3.02 × 10⁸ m/s, **0.73% from c**, which an arithmetic slip anywhere
> upstream would have thrown off by orders of magnitude. **D was made deliberately conceptual so that
> the stretch problem carries no arithmetic risk at all.** That is the whole of the verification.
> **It is not a check against a source, because there is no source to check against** — lesson 21
> recorded a milder version of this as an open question and this is the loud version. If a cadet's
> careful work ever disagrees with one of these numbers, the artifact tells the tutor to take the
> cadet seriously.

**Transcribed off 150-dpi rasters, six regions re-rendered at 500–700 dpi:** the four boxed equations
(16.8–16.11) and the Lorentz force (16.12) at **600 dpi**, the MAXWELL'S EQUATIONS panel at 300, the
symmetry clause at **500**, the Gauss's-law prose at **700**, and Eq. 16.4 at 600 for comparison
against 16.11. Also 2 figures (16.4, 16.5), the history paragraph, and Check Your Understanding 16.2.

> **⚠ THE FOUR CROSS-CHECKS WERE RUN INDEPENDENTLY RATHER THAN INHERITED, AND THE WORKED-EXAMPLE
> SEQUENCE IS AGAIN THE BLIND ONE.** Folios run **658–663** unbroken — the authority. Numbered
> equations run **16.1 → 16.12** unbroken, all twelve confirmed present by regex over the text layer
> *and* by eye. Check Your Understanding runs **16.1, 16.2** unbroken. Figures run **16.2 → 16.5**
> unbroken. **The Example sequence again has nothing to say: the section prints exactly one worked
> Example, and it is lesson 28's.** This is the **fifth build in a row blinded on a sequence**, and
> the fourth *distinct* sequence to go blind (24 equations, 25 equations from the other side, 26 CYU,
> 28 and 29 Examples). **Never require all four to agree before calling something a gap.**

> **⚠ BOTH EDGES CONFIRMED CLEAN INDEPENDENTLY.** p. 658 opens at the §16.1 heading with its four
> printed learning objectives; p. 663 closes after Check Your Understanding 16.2 and its rule. Neither
> edge cuts a sentence, and there is no missing middle. Lesson 28 reported this and **it was
> re-verified here rather than taken on trust** — by re-hashing the file, re-rendering all six pages,
> and reading the first and last line of every page off the text layer. It holds exactly. The absent
> chapter opener (title, introduction, Figure 16.1, on p. 657) is why the figure sequence starts at
> 16.2; a chapter-opener absence, not a hole.

> **⚠ A REAL SOURCE ERROR, NEW TO THIS BUILD, AND IT LANDS SQUARELY ON PROBE TOPIC 1.**
> **The boxed MAXWELL'S EQUATIONS panel states Gauss's law without the 1/ε₀.** It prints: *"The
> electric flux through any closed surface is equal to the electric charge Q_in enclosed by the
> surface."* The flux equals **Q_in/ε₀**. **Verified two ways:** (1) **Equation 16.8, printed four
> lines above it inside the same panel** and read at 600 dpi, is `∮E·dA = Q_in/ε₀` — so the panel's
> prose contradicts the panel's own equation; (2) **dimensionally**, electric flux carries N·m²/C and
> charge carries C, so the two are not the same kind of quantity and cannot be "equal" whatever the
> numbers. A third observation supports the diagnosis without proving it: the parallel magnetic
> statement in the same panel (*"the magnetic field flux through any closed surface is zero"*) is
> **correct**, precisely because zero needs no constant — which is why the slip surfaces only in the
> electric one. **Lesson 28 transcribed this sentence faithfully and did not notice it was wrong**,
> which is what made it available to find here. **Why it matters more than a typo normally would:**
> topic 1 asks the cadet to state each equation in words and **this panel is the printed model
> answer**. A cadet who says "the flux equals the enclosed charge" has read the book correctly. The
> tutor is told to treat it as the book's slip, misconception 4 names it explicitly, and **extension
> problem B is built around it** so the defect does teaching work instead of just carrying a warning.

> **⚠ THE AMBIGUOUS SYMMETRY CLAUSE LESSON 28 FLAGGED FOR THIS BUILD — RULED ON: IT IS NOT AN ERROR.**
> The clause is *"The displacement current source for the electric field, like the Faraday's law
> source for the magnetic field, produces only closed loops of field lines."* Lesson 28 recorded that
> it is backwards under the "source **of**" reading, right under the "source **arising from**"
> reading, and that **nothing on the page settled it**. Re-read at 500 dpi for this build, and **the
> page does settle it, two ways.** (1) The sentences immediately before and after both state the
> opposite of the "source of" reading — the one before says the changing magnetic field induces
> `E₀`, the one after says the changing `E₀` creates `B₁` — so that reading would have the sentence
> contradicting **both of its neighbours within three lines**. (2) **Decisively: the MAXWELL'S
> EQUATIONS panel on the previous page says outright that "the electric field from a changing magnetic
> field has field lines that form closed loops, without any beginning or end"** — which is exactly
> what the clause asserts for the Faraday half, confirming that half directly and forcing the same
> reading on the displacement-current half by the sentence's own parallel structure. **So: the
> intended sense is "the source term built from the X field", the physics is correct, and the wording
> is merely poor.** Lesson 28 was right to flag it and right not to claim an error; it was **too
> pessimistic in saying nothing on the page settles it**. The artifact transcribes it exactly, states
> the intended reading, and tells the tutor that a cadet who parses it backwards has made a reasonable
> reading of an awkward sentence, **not a physics error**.

**A notation note, recorded as a note and not as a defect.** In the boxed set **all four integral
signs carry no subscript at all**, and the closed-*surface* integrals (16.8, 16.9) use the **same
single circled-integral glyph** as the closed-*loop* integrals (16.10, 16.11) — whereas Eq. 16.4 on
the previous page writes the loop `C` explicitly, and the closed-surface integral on p. 660 is drawn
as a **double** integral with a circle. So inside the panel, **`dA` versus `dl` is the only thing
distinguishing a surface integral from a loop integral.** Not wrong, but it is precisely the
distinction lesson 28 spent a whole session on, and a cadet asked to "state the four equations" can
lose it silently — so topic 1 surfaces it deliberately.

**No arithmetic error exists in this half to find, because this half contains no arithmetic.** Unlike
the previous four lessons, where "every line of algebra reproduces exactly" was a finding, here it is
vacuous: there is not a single numerical value in lesson 29's material. The one defect found is a
**dropped constant in a prose sentence**, and the ruled-on clause is a **wording** problem. Neither
is a sum.

**Confirmed absent, independently:** `c = 1/√(ε₀μ₀)` appears **nowhere** on these six pages — checked
by regex over the whole text layer as well as by reading. The source explicitly defers it (*"In the
next section, we show in more precise mathematical terms…"*), and that next section is **lesson 30's**
grounding. The artifact may say the theory predicts a definite speed that turns out to be the speed of
light, because the source says exactly that; it may not derive it, and no probe topic rests on it.
This is lesson 28's warning #3, honoured.

**Unverified, same class as lessons 8, 10, 13, 14, 21, 22, 24, 25, 26 and 28:** that Cengage 33.2
covers this span in the cadets' book. As lesson 28 noted, the circumstantial evidence here is unusually
good — **Cengage 33.2 appears in the Reading column of both lesson 28 and lesson 29**, so the course
itself treats this as one body of material taught over two days, which is exactly the shape of a single
OpenStax section split in two. It is still not a look at a Cengage table of contents.

### Lesson 30 — Electromagnetic Waves, EM Spectrum

| | |
|---|---|
| **File** | [`lesson_30_preflight_electromagnetic_waves_em_spectrum.jsx`](lesson_30_preflight_electromagnetic_waves_em_spectrum.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-30-electromagnetic-waves-em-spectrum-40677a45` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/4e1b287c-fd73-401b-b7e3-f3b9f639f79a |
| **Component** | `Lesson30Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics Vol. 2 — **§16.2** "Plane Electromagnetic Waves" (printed pp. 664–670), **§16.3** "Energy Carried by Electromagnetic Waves" (pp. 671–674), a **one-page surviving fragment of §16.4** "Momentum and Radiation Pressure" (p. 680 only), and **§16.5** "The Electromagnetic Spectrum" (pp. 680–686). Eighteen PDF pages spanning printed folios **664–686 with pp. 675–679 missing out of the middle** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Electromagnetic Waves, EM Spectrum.pdf` (SHA-256 `5616762c…8bdc896f`, 15,896,653 bytes) — **unique in the corpus**; re-hashed against all 31 phys-215 PDFs, and the only duplicate pair there remains Displacement Current / Maxwell's Equations |
| **Cadets' reading** | Cengage 33.3, 33.4, 33.7 |
| **Probe topics** | 4 · ~2 active min each · ~10 min — the profile default, unmodified |
| **Checks** | `check_artifact.py` **54 passed / 0 failed** (37 base + 17 `--forbid` guards proving no lesson-26 slug stem, slug suffix, objective key, component name or source filename survived the rebase, and no lesson-28 or lesson-29 objective key leaked in) |
| **Status** | **PUBLISHED 2026-08-05.** The review correction was applied **before** publication, so the live artifact is the corrected version, not the build this section's tables originally described. Prefill link not yet generated; registration pending. recker accepted three objectives and rejected topic 3: *"Basic Poynting Vector discussion instead that the direction of the B and E components at any point in time can tell you which way the light travels."* Applied — see the callout below |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `transverse-e-b-in-phase` | E and B: perpendicular, in phase, ratio c |
| 2 | `speed-from-two-constants` | c falls out of eps0 and mu0 alone |
| 3 | `poynting-direction-of-travel` | E cross B points where the wave is going — **replaced the original `intensity-goes-as-amplitude-squared` on recker's review, 2026-08-05** |
| 4 | `spectrum-is-one-wave` | One wave, many bands; the edges are conventions |
> **TOPIC 3 WAS REPLACED ON REVIEW, 2026-08-05.** recker rejected
> `intensity-goes-as-amplitude-squared` and asked for "Basic Poynting Vector discussion instead that
> the direction of the B and E components at any point in time can tell you which way the light
> travels."
>
> **This needed no new grounding, which is why it was a clean swap.** §16.3 prints equation 16.28,
> `S = (1/mu_0)*(E cross B)`, and the source's own Faraday/Lenz argument for why it points along the
> propagation direction rather than against it. The build had already transcribed both and had
> scoped them **engage-but-do-not-initiate** inside the old topic 3 — so the review promoted material
> the artifact was already carrying, and the two simply swapped scope. The amplitude-squared and
> even-split material is still fully grounded and is now engage-only.
>
> **The sharpest diagnostic in the new topic is the one recker's note points at**: give the cadet E
> along +y and B along +z, get +x, then reverse *both* fields half a period later and ask again. It
> is still +x, because the two minus signs multiply. A cadet who says the wave turns around has read
> the cross product as if it were a single vector. That question also pays off topic 1 — the fields
> being **in phase** is exactly what stops `E cross B` from ever changing sign.

**Four topics across three sections, and the constraint ran the way lesson 26's did.** The source
prints **ten** learning objectives across its three full sections, so the test earlier lessons in
this course applied — does dropping a topic orphan a printed objective — **cannot be satisfied by any
set of four and is not claimed**. The rule applied instead is *each section gets at least one topic
and the widest gets two*: §16.2 supplies topics 1 and 2, which the section itself separates under its
own two subheadings ("The transverse nature of electromagnetic waves" and "The speed of propagation
of electromagnetic waves"); §16.3 supplies topic 3; §16.5 supplies topic 4. §16.4 supplies nothing
because five of its pages are gone. **The casualty is production and detection** — the dipole
antenna, the radiation pattern with its zero along the antenna axis, the resonant tuner — which is
scoped **engage-only with no objective key**. It is the fourth of §16.2's four printed objectives, the
most descriptive of them, and the only one whose absence leaves no quantitative hole.

> **⚠ FIVE PRINTED PAGES ARE MISSING OUT OF THE MIDDLE, AND TWO OF THE FOUR CROSS-CHECKS DID NOT SAY
> SO.** Folio **674 is followed by folio 680**. Absent: pp. 675–679, holding almost the whole of
> §16.4 — the momentum of a wave, the energy–momentum relation, radiation pressure on absorbing and
> reflecting surfaces, at least two worked Examples including the solar sail, **every numbered
> equation of that section**, and Figures 16.13–16.16 — plus the solution to the radio-range Example
> whose statement is printed at the foot of p. 674. **No other lesson file in this course holds them:
> every phys-215 grounding PDF was scanned for a folio in that range and none has one.** A genuine
> hole, not a chapter split.
>
> **What the four sequences said.** *Folios* break — the authority, and the only one that saw it
> cleanly. *Figures* break: 16.6–16.11 printed, 16.12 referenced on p. 674 and not printed, then
> **16.17** on p. 681. *Worked Examples* break: 16.2, 16.3, 16.4, then 16.5's statement with no
> solution, then **16.8**. But **Check Your Understanding runs 16.3, 16.4, 16.5, 16.6 with no break at
> all** — four consecutive numbers with five missing pages between the second pair. And **the
> numbered-equation sequence is blind**: it runs 16.13 → 16.33 unbroken and then *stops*, because
> §16.5 numbers no equation whatever, so the last numbered equation before the hole is the last one in
> the file. **This is the sixth build in a row blinded on at least one sequence and the first where a
> sequence stayed CONTINUOUS straight across a real gap rather than merely running out.** An
> equation-and-CYU check would have called this source contiguous.
>
> **The excision looks deliberate.** Radiation pressure is not this lesson's topic — the cadets read
> Cengage 33.3, 33.4 and 33.7, which are structure, energy and the spectrum — so the cut tracks the
> assignment, the same conclusion lessons 24, 25 and 26 reached about their own sources.
>
> **It still has to be worked around, because the fragment that survives is the trap.** A Significance
> paragraph (*"If this small acceleration continued for a year, the craft would attain a speed of
> 1829 m/s, or 6600 km/h"*) and **Check Your Understanding 16.5** about a radiation-propelled
> spacecraft both survive on p. 680 and read as though their derivation were present. `GAPS IN THE
> SOURCE` item 1 and the `scope_note` **both** forbid the tutor from stating, deriving, using or
> setting any radiation-pressure or radiation-momentum result, and tell it to say plainly that light
> carrying momentum is real and that the derivation is not today's material.

> **⚠ ONE REAL ARITHMETIC ERROR, AND IT IS THE ONLY ONE IN THE FILE — Example 16.8 prints 6.02 cm
> where the answer is 6.12 cm.** The example computes the spacing of microwave-oven hot spots as
> `d = λ/2 = c/(2f)` with f = 2.45 GHz. **Verified two ways and re-rendered at 400 dpi to read the
> digit character by character:** (i) 2f = 4.90 × 10⁹ and 3.00 × 10⁸ / 4.90 × 10⁹ = **6.122 × 10⁻² m**;
> (ii) λ = c/f = 12.24 cm, half of which is **6.12 cm**. A third check identifies it as a typo rather
> than a method error: 6.02 cm would require c = 2.95 × 10⁸ m/s, which is not the c the same page
> uses; it reads as a transposition of 6.12. **The setup, the strategy and the formula are all
> correct — only the final number is off.** Caveat 1 tells the tutor a cadet reporting 6.02 cm **has
> read the page correctly and must be told so first**, and to ask them to multiply back rather than
> announcing the correction. **Extension problem C is built around it**, so the defect does teaching
> work instead of just carrying a warning.

> **⚠ A DROPPED "NOT" INVERTS A SENTENCE.** Printed verbatim on p. 685: ozone depletion produces
> regions of lower concentration *"often referred to as 'holes' although the term is entirely
> accurate."* The intended sentence is plainly *"…although the term is **not** entirely accurate"* —
> a thinning is not a hole, which is why the quotation marks are there. **Verified two ways:** the
> concessive *"although"* makes the sentence self-contradictory as printed, and the claim is
> physically false as printed. Read off the **text layer as well as the raster**, so it is not an OCR
> artifact. Trivial for the physics; recorded because a careful cadet will stop on it.

> **⚠ THE PRINTED EQUATION CROSS-REFERENCES ON pp. 667–673 ARE UNRELIABLE — at least eight point at
> the wrong equation.** Among them: the speed of light is said to be *"given by Equation 16.18"*
> (16.18 is `∂B_y/∂x = ε₀μ₀ ∂E_z/∂t`; the speed is **16.22**, printed four lines above); *"the same
> type of analysis with Equation 16.25 and Equation 16.24"* forward-references two equations printed
> on the **next** page; *"Equation 16.17 and Equation 16.18 imply 1 = ε₀μ₀c²"* (it comes from
> substituting **16.21** into **16.20**); *"the solution of E_y has the form shown in Equation 16.20"*
> (16.20 is the wave equation, the solution is **16.23**); *"From Equation 16.24, B_z must obey"*
> followed by Equation 16.24 itself (a self-reference — the source is **16.16**); Example 16.2
> *"rearrange Equation 16.23 to solve for B"* (the relation is **16.26**); *"substituting u from
> Equation 16.23"* (16.23 gives E, not u); and Example 16.3 *"obtained from Equation 16.20"* (again
> **16.26**). **Every equation itself is correct; only the pointers are wrong.** This is a
> **transcription hazard for the builder, not tutor content** — the tutor never cites an equation
> number to a cadet — but it means **no claim in this artifact was settled by following a printed
> pointer**, and a later rebuild must not either. Recorded as caveat 3.

**Every other printed number in this source reproduces exactly.** Independently recomputed here: the
evaluation of `c = 1/√(ε₀μ₀)` from the printed constants (2.9986 × 10⁸, rounded to 3.00 × 10⁸);
Example 16.2's 3.33 × 10⁻⁶ T; Example 16.3's 0.87 V/m and 2.9 × 10⁻⁹ T; Example 16.4's 5.77 N/C and
1.92 × 10⁻⁸ T; and Figure 16.19's caption claim that the torque reverses 4.90 × 10⁹ times per second
at 2.45 GHz. **Only Example 16.8 fails.**

**Six further notation caveats, none of them errors**, are recorded so a rebuild does not
re-litigate them: (4) the source calls the wave's magnetic field *"small"* twice and then proves
`u_E = u_B` — the smallness is an artifact of SI units and is the seed of misconception 2; (5) the
argument for `E_x = 0` is **two steps and only the first is Gauss's law** (Gauss's law shows E_x
cannot *vary* with x; the step to zero is a statement about what counts as part of the wave);
(6) the source writes both `ε₀μ₀` and `μ₀ε₀` in the same derivation; (7) **radio waves are defined so
that microwaves are a subset** (*"divided into many subranges, including microwaves"*) while Table
16.1 and Figure 16.17 list them as separate categories — real tension, **not an error, and it is
exactly probe topic 4's point**; (8) Figure 16.17's wavelength row is **one representative value per
band, not a band edge**; (9) the source never states that a plane wave in vacuum does not attenuate,
though it follows from Eq. 16.27 and from the light-bulb Significance; (10) the half-wave antenna
claim is about the **total** length of the two elements.

**Two gaps beyond the missing pages, both scoped rather than papered over.**

1. **The photon half of a printed learning objective is developed nowhere.** §16.3 lists as its third
   objective *"explain how the energy of an electromagnetic wave depends on its amplitude, whereas the
   energy of a photon is proportional to its frequency."* The amplitude half is developed thoroughly;
   **the photon half is never mentioned again — there is no `E = hf`, no Planck constant and no photon
   on any page.** The nearest thing is a qualitative UV sentence, itself hedged *"as examined in a
   later chapter."* The `scope_note` permits the tutor to say that shorter wavelength means a greater
   energy change in an electronic transition, and forbids writing `E = hf`, computing a photon energy,
   or explaining intensity by photon counts. **Misconception 9 exists for a cadet who brings photons
   in from elsewhere.** *This narrows the brief's suggestion that topic 4 probe photon energy: it is
   the one part of that suggestion the source cannot carry.*
2. **The magnetic energy density is cited to a chapter this course never covered.** p. 671 uses
   `u_B = B²/(2μ₀)` and attributes it to an inductance chapter. **Inductance is in no lesson file in
   this course** — lesson 26's log established that. The artifact supplies the expression as today's
   material and tells the tutor not to treat a cadet who has never seen it as underprepared.

**Also recorded as *not* a gap:** §16.1 (printed pp. 658–663) is lessons 28 and 29's grounding and
**tiles with p. 664 with no overlap and no missing page** — re-verified here by reading that PDF's
folio range rather than trusting the earlier note. And the chapter's end matter (summary, key
equations, problems) is in no lesson file in this corpus, which is normal.

**Extension problems — CONSTRUCTED, and two of the four exist because of a specific source failure.**
A **one plane wave, every quantity on it** — E₀ = 300 V/m at 10¹⁴ Hz: B₀ and its axis, λ and its band,
*what B is at an instant when E is zero*, peak and average energy density, intensity by two printed
routes, the magnetic fraction, and what doubling the amplitude does to intensity and to speed
(approachable; topics 1–4) · B **the radio-range question the source asks and never answers** — the
Example whose solution is on one of the missing pages, worked to 122 km, then re-derived as a pure
ratio (√1.5 = 1.22, so 50% more power buys 22% more range), closing on whether the wave "lost energy"
on the way up (standard; topics 3 and 1) · C **hot spots, wavelengths, and one printed number that
does not check out** — the 6.02/6.12 cm defect, reached by asking the cadet to multiply back rather
than by being told, plus a four-way frequency/wavelength ordering and two half-wave antenna lengths
(standard; topics 4 and 2) · D **sunlight, and where the magnetic half of the energy went** — E₀ and
B₀ of a 1.36 kW/m² beam, the energy density checked against I/c, the exactly-half split, and a cadet's
plausible-sounding argument that the magnetic field is negligible (challenging; topics 3 and 1).
Spans all four probe topics; one approachable, one challenging.

> **⚠ HOW THE CONSTRUCTED NUMBERS WERE VERIFIED.** Every number in all four problems is this build's
> own — the source supplies no worked example that any of them reproduces, and B's answer is
> **specifically not printed anywhere** because it is in the hole. Each was computed **at least two
> independent ways in Python** and both passes are written into the artifact: A gets the intensity
> from `½cε₀E₀²` and again from `E₀B₀/2μ₀` and a third time as `u_avg·c`, and gets B₀ back from
> `I = cB₀²/2μ₀`; B gets E₀ through the intensity and again from a single collapsed expression with no
> intensity computed, then closes the round trip by showing the intensity at 122 km equals the
> intensity at 100 km; C settles the defect by **multiplying back** rather than dividing, which needs
> no trust in either printed number; D derives everything a second time **starting from the magnetic
> side** so no electric quantity is reused, and reaches the same energy density three ways.
> **A rounding fact is written into the block rather than left to surprise someone:** the printed
> constants do not satisfy `c = 1/√(ε₀μ₀)` exactly — the square root gives 2.9986 × 10⁸ — so the three
> intensity forms agree to about one part in a thousand, not exactly. A cadet who finds a third digit
> disagreeing has found the rounding, not a mistake.
>
> **D's part (d) is deliberately a trap that catches the tutor as well as the cadet.** The cadet's
> argument is that sunlight's 3.4 μT is small beside Earth's 50 μT field, so the magnetic half must
> carry almost no energy. The obvious rhetorical reply — "Earth's field is irrelevant here" — is
> wrong: the static 50 μT field stores **9.9 × 10⁻⁴ J/m³, about 220 times** the sunlight's total
> energy density. The honest answer is that the *comparison* mixes a unit artifact with an unrelated
> static field and the *inference* contradicts `u_E = u_B`, which the source proves in one line.

**Transcribed off 140-dpi rasters of all eighteen pages**, with the Example 16.8 solution line
re-rendered at **400 dpi** to read the disputed digit. Every numbered equation 16.13–16.33, all three
surviving worked Examples in full plus the statement of the fourth, all eleven figures described, all
four Check Your Understanding prompts, Table 16.1 transcribed in full, and every band definition and
numerical range in §16.5. **The equations in this PDF are vector paths no text extractor can see** —
`pdftotext` and `pypdf` both return complete-looking prose with every equation silently absent.

**Nothing lessons 28 or 29 probed is re-probed.** Their six objective keys have no counterpart here
and the build asserts mechanically that none of the six strings survived. Maxwell's four equations,
the displacement current, and the prediction that waves exist are all used freely **as prerequisite**
and carry no objective key, so they cannot reach the `d` payload; the `scope_note` says so explicitly.

**Unverified, same class as every earlier lesson in this course:** that Cengage 33.3, 33.4 and 33.7
cover this span in the cadets' book. Not a look at a Cengage table of contents.

**One thing for recker to rule on.** `COURSE_PROFILE.md` still says *"do not build lessons 30–41 until
it is settled"*, on the ground that the optics/modern tail may be OpenStax **Vol. 3** rather than
Vol. 2. **The factual half does not bite for this lesson**: chapter 16 is **Vol. 2's last chapter**, so
lesson 30 is inside the named grounding text and the volume boundary falls *after* it. The profile's
`grounding_text` is correct as written for this build. **Lessons 31 and up are a separate question and
this build does not answer it.**

### Lesson 31 — Light, Reflection, Refraction

| | |
|---|---|
| **File** | [`lesson_31_preflight_light_reflection_refraction.jsx`](lesson_31_preflight_light_reflection_refraction.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-31-light-reflection-refraction-ec714375` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/31d69e4b-03ad-4809-9407-3534c5df03d6 |
| **Component** | `Lesson31Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **VOLUME 3** — **§1.1** "The Propagation of Light", **§1.2** "The Law of Reflection", **§1.3** "Refraction" and **§1.4** "Total Internal Reflection" (printed pp. 6–21). Sixteen pages, **one contiguous block**, one chapter |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Light, Reflection, Refraction.pdf` (SHA-256 `bc57a8b2…`, unique in the corpus) |
| **Cadets' reading** | Cengage 34.1–34.4, 34.7 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` **52 passed / 0 failed** (37 base + 15 `--forbid` guards proving no lesson-26 objective key, slug stem, slug suffix, component name, lesson number or topic string survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed the same day and accepted unchanged, all four objectives. No prefill link yet; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `index-and-light-speed` | n = c/v: the index sets the speed in matter |
| 2 | `reflection-from-the-normal` | Reflection: equal angles, measured from the normal |
| 3 | `snell-bending-sense` | Snell's law, and which way the ray bends |
| 4 | `critical-angle-tir` | Total internal reflection needs n1 greater than n2 |

> **⚠ THIS IS THE FIRST LESSON IN THE COURSE GROUNDED IN VOLUME 3, AND `COURSE_PROFILE.md` IS NOW
> WRONG FOR IT.** The profile's `grounding_text` says *OpenStax University Physics Vol. 2*, and Vol. 2
> ends at electromagnetic waves; optics is Volume 3. `reading_assignment` in this artifact says
> **Vol. 3** explicitly rather than inheriting the profile's value, and the header comment and the
> `TEXTBOOK_REFERENCE` preamble both say why, so nobody "corrects" it back to match the eighteen
> earlier artifacts. **Nothing in this build depends on the profile being fixed** — the value is read
> by no tool (`COURSE_PROFILE.md` → "Session shape is advisory") — but the profile is now factually
> wrong for every lesson from 31 up. **Owner: recker.** The factual half of the old open question is
> settled by this build: the Vol. 2 / Vol. 3 boundary really does fall before this lesson, the
> Volume 3 source exists, and it is complete.

> **⚠ Four topics, and for the first time in this run the fit is exact.** The source prints **four
> sections** and each one takes exactly one probe topic, in the printed order: §1.1 → topic 1,
> §1.2 → topic 2, §1.3 → topic 3, §1.4 → topic 4. **The older test this run has been applying — does
> dropping a topic orphan a printed learning objective — cannot be satisfied and is not claimed**,
> because those four sections carry **nine** printed objectives between them. What is claimed is that
> **no printed section goes unprobed**, which is a stronger statement than lesson 26 could make. Five
> was considered and rejected: there is no fifth section to give it to, and the cadet-facing card
> promises "about 10 minutes". **All six pacing strings were grepped and confirmed to say 2** —
> `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING opener, the probing instruction, the
> PACING line *"about its 2 min budget"* (wrong in ten earlier artifacts), and the PACING line
> *"its full ~2 min"* (the sixth, the one that gets missed).

**Extension problems:** A **one boundary, four questions, then the ray sent back** — air into crown
glass at 40°, the speed inside, the *same* 40° arriving from water instead, the reversed ray, and the
one incidence that produces no bend at all (approachable, **Pass 2 checks (a) by running the answer
back out through Snell's law rather than taking a second arcsin, and reaches (c)'s conclusion from the
ratio n₁/n₂ before any angle is computed**) · B **four critical angles and one that does not exist** —
water→air, glass→air, glass→water, then the same 45° ray inside the same slab escaping under water and
trapped in air, and finally what a calculator error *means* (standard, **Pass 2 regenerates each
critical angle by showing it produces exactly 90° on the far side, and settles (d) by the
arcsin-domain check — `sin θ₂ = 1.0748 > 1` is not a mistake, it *is* total internal reflection**) ·
C **a real optical fiber and what the cladding is actually for** — the 80.6° critical angle at a
1.480/1.460 boundary, the 9.4° acceptance half-angle about the axis, why touching bare fibers leak,
and what an air cladding would buy and cost (standard→challenging, **Pass 2 derives the acceptance
condition as an inequality rather than a number so the direction is obvious, and shows the formula
does not fail at n₁ = n₂ — it correctly reports θc = 90°, i.e. nothing is reflected**) · D **why the
diamond sparkles and the glass does not** — three critical angles, the same 30° internal ray in all
three gems, refraction at 60° into diamond, and then a **solid-angle escape ratio of 2.76** put
against the source's word "concentrated" (challenging, **Pass 2 gets the ratio from
`1 − √(1 − (1/n)²)` with no angle computed anywhere, and re-does (b) purely by the arcsin domain**).
Every number computed and independently re-checked in Python.

**Transcribed off 140-dpi rasters, two regions re-rendered at 400–500 dpi** to read the defective
sentence letter by letter and to settle the arrowheads in the refraction figure: **5 numbered
equations (1.1–1.5)** plus ~8 unnumbered displays, **18 figures (1.2–1.19)**, **the whole of Table 1.1
(21 rows across gases, liquids and solids)**, **4 worked Examples (1.1–1.4)** each complete with
Strategy / Solution / Significance, and **3 unanswered Check Your Understanding prompts (1.1–1.3)**,
all three of which are worked out in the reference so the tutor is not caught out.

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS.**
> - **Printed pp. 6–21. Sixteen pages, ONE contiguous block, no interior hole anywhere.**
> - **The folio check is unusually strong here.** In this excerpt the printed page number sits in the
>   **running head of every page, recto *and* verso** — the verso prints it at the left beside
>   "1 • The Nature of Light", the recto at the right after the section head. So folios 6…21 are read
>   **directly off all sixteen pages** with no inference and no two-consecutive-verso argument. That is
>   a better folio signal than this corpus usually affords, and it is worth knowing that the phys-215
>   Vol. 3 files behave this way.
> - **All five sequences agree.** Equations 1.1–1.5, Examples 1.1–1.4, Check Your Understanding
>   1.1–1.3, figures 1.2–1.19, folios 6–21 — every one consecutive.
> - **The one apparent break was chased down and disproved. FIGURE 1.1 IS ABSENT**, and it is not a
>   hole: 1.1 is the chapter-**opening** photograph on folio 5, together with the chapter outline and
>   introduction, and this source begins at folio 6 on the §1.1 heading. Folio 18's own prose confirms
>   the chapter opens with a photo (*"In the photo that opens this chapter…"*). Recorded because the
>   corpus rule says to treat a break in any single sequence as a hole until disproved — this is what
>   disproving one looks like.
> - **Edges.** p. 6 opens at a section heading, clean. **p. 21 does NOT close cleanly** — the file's
>   last line is cut mid-sentence inside the closing PhET blurb, at *"…disappear with total internal"*,
>   with the word *"reflection."* on folio 22. No physics is lost; recorded because an edge that cuts a
>   sentence is exactly what the corpus rule says to report.

> **⚠ THE SCOPE BOUNDARY IS REAL, IT IS NOT A HOLE, AND IT HAS A CONSEQUENCE FOR LESSON 40.** Chapter
> 1 continues with **§1.5 Dispersion, §1.6 Huygens's Principle and §1.7 Polarization**, and **none of
> the three is in this file or anywhere else in the phys-215 corpus.** That is a boundary at the end
> of the excerpt rather than a gap inside it, and the artifact handles it as one: the scope note
> forbids probing any of the three, forbids asserting what the textbook says about them, and tells the
> tutor to engage briefly from general physics and label it as reasoning beyond today. **Three
> cross-references point into that absent material** — why *n* depends on wavelength (a prism
> separating colours), why a clear diamond throws colour, and the derivation of Snell's law from
> Huygens's principle. **SEPARATELY AND MORE SERIOUSLY: LESSON 40 IS POLARIZATION AND HAS NO GROUNDING
> SOURCE ANYWHERE IN THE CORPUS.** Nothing in this build depends on it; recker is being told
> separately. Dispersion is likewise unsourced, though no lesson appears to be named for it.

> **⚠ Two real source defects, both of them WORDS rather than numbers, each verified two ways.**
> 1. **"TOTAL INTERNAL REFRACTION" IS PRINTED WHERE "REFLECTION" BELONGS**, on printed p. 18, in the
>    fiber-optics paragraph: *"most fibers have a varying refractive index to allow more light to be
>    guided along the fiber through total internal **refraction**."* **Verified two ways:** a PDF text
>    search for that exact phrase returns a hit at that rectangle and nowhere else in the file, and the
>    line re-rendered at 500 dpi reads "refraction" letter by letter. It must be *reflection* — the
>    whole section is about total internal reflection, and refraction is precisely the process by
>    which light **leaves** a fiber, so "guided … through total internal refraction" is
>    self-contradictory. **The tutor is told that a cadet who quotes it has read the page correctly**
>    and should be asked what refraction does to a ray at a boundary, not corrected.
> 2. **THE CORNER-REFLECTOR PROOF IS PROMISED AND ITS CROSS-REFERENCE IS AN UNRESOLVED PLACEHOLDER.**
>    Printed p. 12 asserts that a two-mirror corner returns a ray antiparallel *"independent of the
>    angle of incidence"* and adds *"(For proof, see **[link]** at the end of this section.)"* — the
>    literal four characters `[link]`, not a reference. **Verified two ways:** a text search for
>    `[link]` hits that page and no other in the file, and the raster shows the bracketed word set in
>    the running body face rather than as a link. **No proof appears anywhere in these sixteen pages.**
>    The tutor states the *result* confidently (the source states it as fact) but must not claim the
>    material proves it; the one-line reason — each reflection reverses one component of the direction,
>    and reversing both reverses the ray — is supplied as the tutor's own reasoning and labelled.

**Seven further caveats**, each with the self-consistent reading, all carried in the artifact:
**the mechanism for the slowdown is one clause long and must not be extended** — all the source says
is that "light interacts with atoms in a material", so a cadet's absorb-and-re-emit story must not be
confirmed · **the subscripts in the refraction figure name the MEDIUM, not the order of the ray**, so
in panel (b) θ₂ is the *incident* angle and a cadet who has memorised "θ₁ is always the incident
angle" reads that panel backwards (not an error — it is what makes the printed *"the path is exactly
reversible"* true — but it is the trap) · the Michelson uncertainty printed as `(2.99796 ± 4) × 10⁸
m/s` with **no place value attached to the 4** (it means ±4 km/s; read literally it is absurd) · air
taken as `n = 1.00` in every worked example while Table 1.1 prints 1.000293, which the source declares
as an approximation rather than committing as a slip · the table holding for **one wavelength only,
589 nm**, with the wavelength dependence pointed at a section that is not here · *"it can exit only if
it makes an angle less than 24.4°"* omitting the words **"with the normal"**, correct under the
chapter's own convention and ambiguous read cold · and **both reflection and refraction happening at
every boundary**, which the source says once in passing and which cadets consistently treat as
alternatives.

**One thing described in prose that is not in the file:** printed p. 18 discusses the
**chapter-opening photograph** of an underwater swimmer at length — the apparent upper swimmer being a
total-internal-reflection image of the lower one, the ripple that is actually on the surface, and the
top edge where rays inside the critical angle let the camera see the pool deck. **The photograph is on
folio 5 and is not in this source.** The prose is self-contained enough to use as a described scenario
and the tutor is told to use it that way and never to say *"as the photo shows"*.

**Checked and confirmed correct rather than flagged: every printed numerical result reproduces
exactly.** Independently recomputed: Example 1.1's `3.00×10⁸/1.923 = 1.56×10⁸ m/s`; Example 1.2's
`0.500/0.375 = 1.33` (and the unrounded `0.500/0.37461 = 1.335`, which rounds the same, so a cadet
carrying more digits has not erred); Example 1.3's `0.207` and `11.9°`; Example 1.4's `42.2°`; and all
three critical angles quoted **without work** in that Significance — water→air `48.6°`, diamond→air
`24.4°`, flint→crown glass `66.3°`. Even the three historical error percentages check: Roemer's
`2.0×10⁸` is 33.3% low, Fizeau's `3.15×10⁸` is 5.1% high, Foucault's `2.98×10⁸` is 0.6% low, exactly
as printed. **No arithmetic slip was found anywhere in this source** — the fourth such lesson in a
row, and both defects above are labels rather than sums.

**Source uniqueness confirmed.** The PDF's SHA-256 (`bc57a8b2…`) was computed and compared against
every other file in the phys-215 corpus. It is unique. The only duplicate pair in the corpus remains
`Displacement Current.pdf` / `Maxwell's Equations.pdf`, re-confirmed byte-identical by the same scan.

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in every PHYS 215 artifact, it is verbatim-copied text the skill says to copy
verbatim, and it is behaviourally harmless. Recorded so the next agent does not think it was missed;
fixing it is a cross-cutting change to the base, not a per-lesson edit.

**Open questions for recker, in priority order:**
1. **`COURSE_PROFILE.md`'s `grounding_text` is now wrong for a third of the course.** It says
   Vol. 2; this lesson and everything after it are Vol. 3. The fix is a choice, not a lookup — name
   both volumes, split the field, or add a per-lesson override. Recorded in `CORE.md` §8 / the profile
   already; this build is the first one that actually trips it.
2. **Lesson 40 is Polarization and there is no source for it anywhere in the corpus.** §1.7 is three
   sections past where this file stops and no other phys-215 PDF contains it. Same class of hole as
   lesson 16's. Dispersion (§1.5) and Huygens's principle (§1.6) are equally absent but no lesson
   appears to be named for either.
3. **Extension problem D part (d) reasons past the printed material on purpose** — it puts a number
   (a 2.76× escape-cone ratio) on a claim the source makes only in words ("many internal reflections
   and is concentrated before exiting"). It is labelled as the tutor's own reasoning in three places.
   Worth a look, because it is the only place in the set that leaves the page.

**Unverified, same class as lessons 8, 10, 13, 14, 21, 22, 24, 25 and 26:** that Cengage 34.1–34.4 and
34.7 cover this span in the cadets' book. The topic match is clean — four OpenStax sections covering
propagation, reflection, refraction and total internal reflection against five assigned Cengage
sections on the same four ideas — and **the gap in the Cengage numbering (34.5–34.6 skipped, 34.7
assigned) is at least consistent with the standard layout**, in which the skipped pair would be
dispersion and Huygens/polarization and 34.7 would be total internal reflection. **That is an
inference from topic, not a look at a Cengage table of contents**, and it is more speculative than
usual because it is being used to explain a *gap* rather than a run.

### Lesson 32 — Image Formation from Mirrors

| | |
|---|---|
| **File** | [`lesson_32_preflight_image_formation_from_mirrors.jsx`](lesson_32_preflight_image_formation_from_mirrors.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-32-image-formation-from-mirrors-fbd3ac8d` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/bac679f0-3cb5-4551-88de-ac410bce7dea |
| **Component** | `Lesson32Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — Ch. 2 *Geometric Optics and Image Formation*: chapter intro + §2.1 *Images Formed by Plane Mirrors* + §2.2 *Spherical Mirrors* (printed pp. 49–61). Thirteen pages, one contiguous run |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Image Formation from Mirrors.pdf` |
| **Cadets' reading** | Cengage 35.1–35.2 (different book, different numbering — never cited aloud, never mapped by number) |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` **40 passed / 0 failed** (37 base + 3 `--forbid` guards proving no lesson-26 string survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05.** The review correction was applied **before** publication, so the live artifact is the corrected version, not the build this section's tables originally described. Prefill link not yet generated; registration pending. recker accepted two objectives and rejected two on notation alone — *"We use p and q for object and image otherwise this is fine"* and *"notation again. we use p and q. h and h' for height. Otherwise fine."* **The whole artifact was converted, not just the two topics** — see the callout below |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `plane-mirror-virtual-image` | Plane mirror: a virtual image, equally far behind |
| 2 | `mirror-sign-convention` | Reading the signs of f, q and m as an image |
| 3 | `mirror-equation-magnification` | Mirror equation and magnification used together |
| 4 | `focal-point-and-paraxial` | Focal point, f = R/2, and the small-angle limit |
> **CONVERTED TO THE COURSE'S NOTATION ON REVIEW, 2026-08-05.** recker rejected two objectives on
> notation alone: *"We use p and q for object and image otherwise this is fine"* and *"notation
> again. we use p and q. h and h' for height. Otherwise fine."*
>
> **The whole artifact was converted, not only the two rejected topics** — 309 substitutions:
> `d_o`→`p` (138), `d_i`→`q` (124), `h_o`→`h` (17), `h_i`→`h'` (30). Leaving two topics in one
> alphabet and two in another would have been worse than either alphabet alone. Every bare `do` in
> the file is the English word and was untouched; the symbols appear nowhere in the JS or CSS, which
> is what made a global rename safe here and would not make it safe elsewhere.
>
> **THE PRINTED PAGES STILL SAY `d_o` AND `d_i`.** This is now the one place in the file where the
> transcription is deliberately not literal, and a `NOTATION` block was added above the caveats to
> say so. It tells the tutor the thing that actually matters in the conversation: **a cadet who
> writes `d_o` has read the book correctly** and must not be corrected — one sentence of translation,
> then back to the physics, and never a section or page number, because the grounding text is not the
> cadet's book.

**Extension problems:** A one object, three mirrors — plane, concave and convex at the same 30.0 cm,
producing the whole classification table in three calculations, plus the plane mirror recovered as the
R → ∞ limit (approachable) · B the same concave mirror with the object at 60, 10 and 20 cm — real
inverted, then virtual upright enlarged, then no image at all (standard) · C a convex security mirror,
including a **general** proof that a convex mirror with a real object can only ever give a virtual,
upright, reduced image with |d_i| < |f|, and an aperture-versus-radius check on whether the paraxial
theory is even applicable (standard, part (c) stretching) · D the keratometer done at full precision,
with a closed form R = 2·m·d_o/(m−1) derived and then tested against exact numbers (challenging).
Every worked answer obtained twice by routes sharing no intermediate: Pass 1 through the reciprocals,
Pass 2 through the rearrangements `d_i = d_o·f/(d_o − f)` and `m = f/(f − d_o)`, with ray-tracing,
sign-readback, scaling and limiting-case cross-checks named explicitly in the file.

**Source coverage and the four cross-checks:**
- **Printed folios 50–61, contiguous, no break.** PDF p1 is the chapter-opener and prints no folio
  (book p. 49 by inference). The verso footer "Access for free at openstax.org" appears exactly six
  times and alternates perfectly with the rectos — no two versos adjacent.
- Numbered equations **2.1–2.9 unbroken**; worked Examples **2.1–2.2 unbroken**; figures
  **2.1–2.12 unbroken**.
- **The Check-Your-Understanding sequence is blind here.** This source contains **zero** CYU prompts —
  confirmed by a grep of the text layer over all thirteen pages. That is a property of §2.1 and §2.2,
  not damage, but it means **three sequences carried the verification, not four.** Fourth such
  blindness in the run (24 and 25 by the equation check, 26 by the CYU check at its first seam), and
  the second time it is CYU. Never require all four to agree before calling something a gap.
- **No `GAPS IN THE SOURCE` block, because there is no gap.** What the file carries instead is an
  explicit statement that the stopping point is a **chapter seam**.

> **⚠ The grounding volume changes at this lesson, and `COURSE_PROFILE.md` has not caught up.**
> Every E&M artifact in this course is grounded in OpenStax **Vol. 2**; optics is **Vol. 3**, and this
> is the first artifact in the course to use it. `grounding_text` in the profile still reads
> "OpenStax University Physics Vol. 2". That field is read by no tool, and the profile's own
> "Open: Vol. 2 does not cover the whole course" section already flags it as recker's to settle — so
> nothing was changed there. The artifact names Vol. 3 in its header, its `reading_assignment` and its
> `TEXTBOOK_REFERENCE` source line.

> **⚠ The seam with lesson 33 is confirmed from this side.** This source's **last printed folio is
> 61**, at the clean end of §2.2. `Image Formation from Lenses.pdf` begins at printed folio 62 with
> §2.3 *Images Formed by Refraction* and runs to 75 through §2.4 *Thin Lenses*. **The two files tile
> chapter 2 with no overlap and no missing page.** This artifact is therefore scoped to mirrors and
> stops where its source stops: `scope_note` names refraction at a single surface, thin lenses, the
> thin-lens equation, the lensmaker's equation, converging/diverging lenses and multi-lens systems as
> the next lesson's, to be **engaged with briefly and honestly if a cadet raises one, never probed,
> never exercised, never reported** — because two artifacts probing the same material wastes the
> cadet's time twice and splits the cohort data.

> **⚠ PDF p1 prints the whole chapter outline, §2.1 through §2.8 — that outline is not an inventory.**
> §2.3 refraction, §2.4 thin lenses, §2.5 the eye, §2.6 the camera, §2.7 the simple magnifier and
> §2.8 microscopes and telescopes are named there and appear nowhere else in the file. The
> `TEXTBOOK_REFERENCE` and the `scope_note` both say so in as many words, because an agent or a tutor
> that reads that list as a table of holdings will confidently discuss six sections it does not have.

**Source defects found — five, each verified twice off the raster, and none of them is a wrong sum:**

1. **Figure 2.2's caption contradicts Equation 2.1 four lines below it, on the page that introduces
   signs.** The caption reads "…the object distance $d_o$ is the same as the image distance $d_i$";
   Eq 2.1 reads $d_o = -d_i$. The caption means *same magnitude*; as printed the two sentences
   conflict. **This lands squarely on probe topic 2.** The tutor is instructed to treat a cadet who
   quotes the caption as **having read it correctly**, and to ask whether they mean the size or the
   signed value — which is the fastest legitimate route into the sign convention there is.
2. **The printed sign convention has only TWO numbered rules and a cadet needs four.** The list gives
   the sign of $f$ (positive concave, negative convex) and the sign of $d_i$ (positive real, negative
   virtual) and stops. **The sign of $d_o$ and the height convention appear only in prose**, in the
   magnification subsection that follows, and are never labelled as rules — yet
   $m = h_i/h_o = -d_i/d_o$ is unusable without them. An **omission, not an error**. Probe topic 2
   supplies all four and tells the tutor not to treat a cadet who missed the prose as careless.
3. **Example 2.2 double-rounds its final answer.** $1/f = 1/12.0 - 1/0.384 = -2.5208333\ \mathrm{cm^{-1}}$,
   so $f = -0.396694$ cm and $R = 2f = -0.793388$ cm — **−0.79 cm** at two figures. The source rounds
   $f$ to −0.40 cm *first* and prints $R = -0.80$ cm. Verified two ways: from the reciprocals, and
   from the closed form $R = 2 m d_o/(m-1) = 0.768/(-0.968) = -0.79339$. A rounding artifact, not a
   method error; the tutor accepts either, and extension problem D turns it into a lesson about
   rounding once.
4. **Example 2.1(b) uses the developed arc area where the projected aperture is the physical one.**
   Insolation in W/m² is power per area *perpendicular to the beam*. The source takes
   $A = \tfrac14(2\pi R)L = 1.26$ m² — the **curved surface** of the quarter cylinder — where the
   intercepted area is the projected width $2R\sin 45° = R\sqrt2 = 1.13$ m², giving ≈1020 W rather
   than 1130 W (and ≈146 °C rather than 162 °C). Verified two ways ($R\sqrt2 = 1.131$; chord of a 90°
   arc $= 2R\sin45° = 1.131$). **A standard textbook modelling simplification in a heat-transfer
   aside, not an arithmetic slip** — the reference records it and explicitly says **do not raise it**,
   so that a cadet who spots it gets a straight answer rather than a denial.
5. **Garbled clause in Example 2.2's Significance:** "a smaller radius of curvature corresponds to a
   smaller *the* magnification". The physics is right; the wording is broken. Cosmetic.

**Every printed number in this source reproduces.** Both worked Examples were recomputed end to end —
the trough's focal length and radius, the collector area, the concentrated power, the oil mass and the
temperature rise, and every step of the keratometer calculation. The only discrepancy anywhere is
defect 3's last figure.

**Notes worth carrying forward:**
- **The equations in this PDF are vector paths.** A text-layer extraction returns complete-looking
  prose with every equation silently absent — which on a lesson whose subject *is* an equation and a
  sign convention would have produced a confident, unusable artifact. Everything was transcribed off
  150-dpi page rasters (PyMuPDF).
- **Topic 2 matches no printed learning objective and is in the set anyway.** The source prints five
  objectives — three for plane mirrors, two for spherical. Topic 1 takes all three plane-mirror
  objectives at once (they are one idea seen three ways), topic 3 takes the mirror-equation half of
  the second spherical objective, topic 4 takes the first spherical objective plus the ray-diagram
  half of the second. **The sign convention corresponds to nothing printed**, but it is where cadets
  fail, and the printed objective *"describe an image without constructing a ray diagram"* is
  unreachable without it. So the usual test this run applies — does dropping a topic orphan a printed
  objective — is satisfied here **and** one extra topic is carried on judgement.
- **Order is by failure rate, not by the source's sequence.** Topic 4 is last because f = R/2 is the
  most self-contained recall in the set. **If topic 4 is not reached, the concave/convex distinction
  survives in topic 2 as the sign of f**; what is lost is the paraxial approximation and spherical
  aberration.
- **Drawing a full ray diagram is engage-only**, for a practical reason rather than a scope one: text
  conversation, no drawing surface. The **four principal-ray rules themselves are fully in scope** —
  state them, reason with them, ask which two a cadet would pick and why. **Coma is engage-only and
  deliberately shallow** (two printed paragraphs; say what they say and stop). **Spherical aberration
  is in scope** and is part of topic 4.
- **The solar-trough Example is mostly not optics.** Only its part (a) — object at infinity, image at
  the focal point, R = 2f — is today's physics. The collector area, specific heat, mass and
  temperature rise are thermodynamics that happen to be printed on these pages; the scope note says
  not to set them.
- **Five things the source asserts but does not derive** are marked in the file as derivations the
  tutor performs rather than lines it quotes: that an object inside a concave mirror's focal point
  gives an upright enlarged virtual image (the source calls the proof "a later exercise"); that the
  mirror equation also holds for convex mirrors (also left as an exercise); that a convex mirror with
  a real object *always* gives a virtual, upright, reduced image with |d_i| < |f|; that an object at
  the focal point produces no image; and the rearrangements `d_i = d_o·f/(d_o − f)` and
  `m = f/(f − d_o)`, which the source never prints.
- **None of the four objective keys collides.** All 71 keys already in this course's artifacts were
  enumerated and compared before these four were minted.

**Open question for recker:**
- **Topic 2 is the one to look at.** It is deliberately not tied to a printed learning objective, and
  it is the one place this build spent a topic slot on judgement rather than on the source's own
  stated goals. If you would rather have the fourth slot go to ray tracing as its own topic — the four
  principal rays are cleanly probeable verbally even without a drawing surface — say so; the sign
  convention would then fold into topic 3, which is where the source itself puts it.

### Lesson 33 — Image Formation from Lenses

| | |
|---|---|
| **File** | [`lesson_33_preflight_image_formation_from_lenses.jsx`](lesson_33_preflight_image_formation_from_lenses.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-33-image-formation-from-lenses-d3ec7a43` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/e4c36b49-b88e-484f-b807-934f57b89ae9 |
| **Component** | `Lesson33Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — **§2.3** "Images Formed by Refraction" (printed pp. 62–65) and **§2.4** "Thin Lenses" (printed pp. 65–75). Fourteen pages in **one unbroken run** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Image Formation from Lenses.pdf` (SHA-256 `debf6a5c…`) |
| **Cadets' reading** | Cengage 35.3–35.4 |
| **Probe topics** | **3** · ~3 active min each · ~10 min — **built as 4 × ~2; the fourth was dropped on recker's review, 2026-08-05.** See the callout below |
| **Checks** | `check_artifact.py` 41 passed / 0 failed (37 base + 4 `--forbid` guards proving no lesson-26 slug stem, slug suffix, topic string or Vol. 2 grounding line survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05.** The review correction was applied **before** publication, so the live artifact is the corrected version, not the build this section's tables originally described. Prefill link not yet generated; registration pending. recker rejected three of the four: two on notation (*"We use p and q and h and h' otherwise fine"*) and the fourth outright (*"Drop"*). All three applied; the artifact now runs **3 topics at ~3 active min**, and all six pacing strings were moved together |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `thin-lens-ray-tracing` | Three principal rays locate the image |
| 2 | `thin-lens-equation-magnification` | Thin-lens equation with m = -q/p |
| 3 | `lens-sign-conventions` | What each sign means: real, virtual, converging |
> **BUILT AT FOUR TOPICS, CORRECTED TO THREE.** recker rejected three of the four on 2026-08-05: two
> on notation (*"We use p and q and h and h' otherwise fine"*) and `refraction-single-surface`
> outright, with one word — *"Drop"*.
>
> **The build had already named topic 4 as the one to lose and had already written down the cost**,
> which is the only reason this is a clean decision rather than a guess: *"IF ONE OF THE FOUR EVER
> HAS TO GO IT IS 4, which is why it is last — but note the cost honestly: it is a whole assigned
> section, and losing it means the cadet is never asked where the thin-lens equation comes from."*
> That is now the situation, deliberately.
>
> **IT ORPHANS THREE PRINTED LEARNING OBJECTIVES.** The source prints five — two thin-lens, three
> refraction — and topic 4 carried all three refraction ones. This is the first probe set in this
> course that does not cover every printed objective by construction, and the artifact now says so in
> its own `NOTE ON WHY THREE` rather than re-describing the set as complete. The §2.3 material stays
> fully transcribed, stays legitimate grounding, and stays the extension problem — it is simply no
> longer probed or reported.
>
> **All six pacing strings moved together**, 2 → 3 minutes, so three topics still fill the ~10 minutes
> the cadet-facing card promises. Dropping a topic without widening the budget would have quietly
> turned a ten-minute preflight into a six-minute one. Same shape as lesson 29.
| ~~4~~ | ~~`refraction-single-surface`~~ | ~~One curved interface; apparent depth~~ — **dropped on review 2026-08-05, comment *"Drop"*.** It carried all THREE of the refraction section's printed learning objectives, so this is the first probe set in this course that orphans a printed objective |

> **Four topics, and for once the count is comfortable — nothing printed is orphaned.** The source
> prints **five** learning objectives, three in §2.3 and two in §2.4. Topics 1 and 2 take the
> thin-lens pair; **topic 4 takes all three refraction objectives together**, which is legitimate
> because they are the same content described three ways — as a diagram, as an equation, and as a
> description. **Topic 3 is the addition and the deliberate one:** the sign conventions, which the
> source prints as two numbered lists and does **not** list as an objective, and which are the day's
> most common cadet failure. Five was considered and rejected — the obvious fifth is the lens maker's
> equation on its own, and it already lives inside topic 3 where its two `R` signs are the entire
> difficulty; splitting it out buys a duplicated conversation and overshoots the "about 10 minutes"
> the cadet-facing card promises. **All six pacing strings were grepped and confirmed to say 2** —
> `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING opener, the probing instruction, the
> PACING line *"about its 2 min budget"*, and the PACING line *"its full ~2 min"*. **Note there are
> six, not the five the older header comments claim**; the sixth is the one missed twice in this
> course, and this artifact's own comment now names all six.

> **⚠ Priority order puts §2.3 LAST on purpose, and the cost is stated rather than hidden.** The
> lesson is titled for lenses and the cadets' assigned reading leads with them, so if a cadet wraps
> up early the single-surface derivation is the right thing to lose. **What that costs if it happens:
> the cadet is never asked where the thin-lens equation comes from**, and a whole assigned section
> goes unprobed. It is not filler — reach it whenever there is time.

**Extension problems:** A **the projector, which is the example the book starts and does not finish**
— the source prints the statement and stops, so this is that example completed: focal length,
magnification, image height, then a longer throw (**which needs a *longer* focal length, the opposite
of what most people guess**) and finally whether a diverging lens could ever do the job at all
(approachable, **Pass 2 gets `f` from `d_o·d_i/(d_o+d_i)` without forming a reciprocal and gets `m`
from `f/(f−d_o)` without ever computing an image distance**) · B **walking the object in, one lens,
five positions** — 36.0, 24.0, 18.0, 12.0 and 6.0 cm against `f = 12.0 cm`, giving real-inverted,
same-size-at-2f, enlarged-real, **no image at all at the focal point**, and virtual-upright inside it,
plus a ray-tracing part and **"two of your five answers are related and it is not a coincidence"**
(standard, **Pass 2 does every magnification by `m = f/(f−d_o)`, a route that never touches `d_i`, and
the 12.0 cm case reappears as a zero denominator**) · C **one piece of glass, four lenses, and the
signs are the whole problem** — bi-convex, bi-concave, plano-convex flat-face-first, and the same
plano-convex lens **turned around** (challenging, **Pass 2 abandons the bracket entirely and counts
per-surface contributions of `(n−1)/R`, so it assigns no sign to any `R` and is genuinely independent;
it also cross-checks answer (b) against the source's own `R = −2f(n−1)` example, which is the same
relation run backwards**) · D **the single surface, which the book derives and never puts a number
in** — apparent depth both ways round, a hemispherical glass rod end, and both focal lengths of one
refracting surface (challenging, **Pass 2 confirms (c) and (d) *simultaneously* through the identity
`f_1/d_o + f_2/d_i = 1`, which is the single-surface equation divided by `(n_2−n_1)/R` and which uses
both answers against each other**). Every number computed and independently re-checked.

**Transcribed off 140-dpi rasters, five regions re-rendered at 400–500 dpi to read the two defective
sentences and both radius labels character by character:** 13 numbered equations (2.10–2.22) plus ~12
unnumbered displays including the entire single-surface derivation and the entire two-surfaces-in-
series derivation, 15 figures (2.13–2.27), 3 worked Examples (2.3 and 2.4 complete, 2.5 statement
only), both numbered sign-convention lists verbatim, the three ray-tracing rules, and the six-step
problem-solving strategy.

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS.**
> - **Printed pp. 62–75. Fourteen pages, one unbroken run, no interior hole anywhere.**
> - **Unusually for this corpus, BOTH sides of every spread carry a folio** — a verso prints it at the
>   left beside the chapter title, a recto at the right beside the section title. **So the folio check
>   covers all fourteen pages here rather than the usual seven**, and it settles the question on its
>   own. Worth knowing for the rest of the Vol. 3 optics tail.
> - **Edges.** p. 62 opens at the §2.3 heading, cleanly. **p. 75 does NOT close cleanly:** it ends on
>   the *statement* of Example 2.5, whose Strategy, Solution and Figure 2.28 are on p. 76 and are
>   absent. **That tail truncation is the only material missing from this source.** Extension problem
>   A is that example finished, labelled in the artifact as a derivation rather than as something the
>   book printed.
> - **§2.3 is thin rather than holed.** It prints **no worked example and no Check Your Understanding
>   at all**, so equations 2.11 and 2.13 are derived and then never exercised on a number anywhere in
>   this source. The folios are contiguous across it and it ends cleanly at its sign-convention list
>   immediately before the §2.4 heading, so nothing was cut — the section is simply short. **Extension
>   problem D exists to supply the numerical workout the source withholds.**

> **⚠ THIS FILE AND LESSON 32'S TILE ONE OPENSTAX CHAPTER — the join is a SEAM, not a hole, and this
> build's first printed folio is 62.** Lesson 32's source holds printed **pp. 49–61** (chapter
> opening, §2.1 plane mirrors, §2.2 spherical mirrors, equations 2.1–2.9, figures 2.1–2.12, Examples
> 2.1–2.2). **This one begins at p. 62. No overlap, no gap** — confirmed from this side by content as
> well as by folio: the first numbered equation here is **2.10**, the first figure **2.13**, the first
> Example **2.3**.
> **It has a runtime consequence, and the artifact handles it explicitly:** today's pages lean on the
> mirror results **three times** and the cadet cannot see any of them — p. 69 sends the reader to
> "the section on spherical mirrors", p. 71 remarks that the thin-lens result "looks suspiciously like
> the mirror equation that we derived above", and p. 72 says the magnification relation "is exactly
> the same equation as we obtained for mirrors" and cites the mirror numbering. All three are true and
> all three point at lesson 32.
> **Mirrors are therefore ENGAGE-ONLY and this is the one hard scope rule in the file:** never probed,
> never set as an exercise in the timed portion, never reported — no objective key touches a mirror
> and none can. **But the lateral connection is genuine and the tutor is told to welcome it warmly:**
> `1/d_o + 1/d_i = 1/f` has the same form as the mirror equation and `m = −d_i/d_o` is *literally* the
> same equation, and the source says both out loud. A cadet who notices has found something real.

> **⚠ THE CHECK-YOUR-UNDERSTANDING SEQUENCE IS BLIND — a fourth such blindness in this course, and the
> second in a row of that same sequence.** This source prints **not one** Check Your Understanding
> prompt on any of its fourteen pages. The other three run unbroken — folios 62–75, equations
> 2.10–2.22, figures 2.13–2.27, Examples 2.3 and 2.4 — so **only three of the four cross-checks can
> speak here at all.** Lesson 24 was blinded by the equation check, lesson 25 by the same check from
> the other side, lesson 26 by the CYU check at its first seam, and this is the CYU check again across
> an entire file. **Never require all four to agree before believing in a gap.**

> **⚠ Three real source defects, each verified two ways at 450–500 dpi, and NONE of them is an
> arithmetic error — every printed number in this source reproduces exactly.**
> 1. **`|m| > 0` where it must read `|m| > 1`, and it lands squarely on probe topic 2.** Example 2.4
>    part (b) prints: *"The positive magnification means that the image is upright… **Since |m| > 0,
>    the image is larger than the object.**"* **Verified two ways:** the other two parts of the same
>    example compare against **one** — part (a) prints *"Since |m| < 1, the image is smaller"* and part
>    (c) prints *"Since |m| = 1, the image is the same size"* — and, taken literally, **the printed
>    claim contradicts part (a) of itself**, where `|m| = 0.250 > 0` and the image is explicitly
>    smaller. The surrounding physics is entirely correct: `m = +2.00`, the image *is* upright, it *is*
>    larger, 6.0 cm is right. **Only the stated condition is wrong.** The artifact tells the tutor that
>    a cadet who says any positive magnification means a bigger image **has read the book correctly**,
>    and to hand them part (a) of the same example rather than contradict them.
> 2. **A broken cross-reference in the main derivation.** p. 70: *"we use **Equation 2.11**. In this
>    case, the object distance is d_o, the image distance is d_i′, and the radius of curvature is R_1.
>    Inserting these into **Equation 2.3** gives"* — and what it prints is Equation 2.14, which *is*
>    2.11 with those substitutions. **Verified two ways:** the same sentence names 2.11 first, so the
>    second pointer contradicts the first; and **Equation 2.3 belongs to the spherical-mirror section**
>    — lesson 32's material — so the pointer cannot be followed even in principle. Harmless to the
>    physics; it matters only to a cadet who went looking for 2.3 and could not find it, which is a
>    reasonable thing to have done.
> 3. **The printed Problem-Solving Strategy skips a step number:** it runs Step 1, 2, 3, 4, 5, **7**.
>    There is no Step 6. **Verified two ways:** read off the page raster at 450 dpi and confirmed
>    independently in the raw text extraction. **Nothing is missing from the content** — the six steps
>    present are a complete procedure, and the last one is the one that matters most today (*"Are the
>    signs correct?"*). Only the numbering is defective.
>
> **Minor typography, recorded and not worth raising with a cadet:** *"index of refractive 1.55"* for
> "index of refraction" (p. 74); *"an 3.0 cm high object"* (p. 74); a missing full stop after *"The
> radius of curvature is R_2"* (p. 71).

**Two structural facts about the sign conventions, which are the heart of this lesson.** The source
prints **two** numbered lists — a two-item one for a single refracting surface (p. 65) and a
three-item one for lenses (pp. 71–72) — and **they agree with each other**, which was checked. But
**the height rule is in neither list**: *"Images that appear upright relative to the object have
positive heights, and those that are inverted have negative heights"* appears only in running prose on
p. 69. And **there is no printed sign rule for `d_o` anywhere in this source at all** — every worked
`d_o` is positive without comment. **A cadet who memorises the printed list has three rules and needs
more than that**, so the artifact tells the tutor not to read a gap here as carelessness.

**Checked and confirmed correct rather than flagged — negative results worth recording because this
is where the source could most easily have been wrong and is not:** the `R_1`/`R_2` labels in **both**
derivation figures (2.19 and 2.24), re-rendered at 400 dpi and checked against the printed sign
convention — `R_1`'s centre of curvature is on the right and `R_2`'s on the left for the bi-convex
lens, and in 2.24 `R_1`'s arrow lands on the first surface and `R_2`'s on the second; Example 2.3's
`R_1 < 0, R_2 > 0` for a **biconcave** lens, which is correct under the printed rule and was re-derived
from scratch; the direction of Equation 2.10's ratio (giving the source's own 3/4 apparent depth); the
entire 2.14 → 2.19 derivation chain, re-done line by line; and **every printed number** — both focal
lengths of the single surface, the biconcave `R = 22 cm`, all three object distances of Example 2.4
with their magnifications and image sizes, and the −0.67 point on the diverging-lens plot. **No
arithmetic slip was found anywhere in this source.** All three defects are **words and pointers**, not
sums — the fourth such lesson in a row.

> **⚠ Example 2.3 contains a teaching opportunity that reads like an error and is not.** Its statement
> says the biconcave lens's *"focal length in air is 20 cm"* and its solution **silently inserts
> −20 cm**. That is the printed sign convention doing exactly what it is for — a biconcave lens is
> diverging, so item 2 forces `f` negative — and the example applies its own rule without narrating
> it. **It is the best available demonstration that the conventions are physics rather than
> bookkeeping**, and probe topic 3 uses it as its main diagnostic. Recorded here so nobody later
> "fixes" it as a defect.

**Three results the source prints and explicitly declines to derive**, so the artifact says the physics
confidently but does not claim a proof the cadet could have read: **Equation 2.10** (*"the derivation
of this result is left as an exercise"*), **Equation 2.19, the thin-lens equation itself** (*"this
derivation is left as an exercise"* — the source derives 2.18 in full and then **asserts** that the
left-hand side equals `1/f`), and **Equation 2.22** (*"you can show that"*).

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in every PHYS 215 artifact, it is verbatim-copied text the skill says to copy
verbatim, and it is behaviourally harmless. Fixing it is a cross-cutting change to the base, not a
per-lesson edit.

**Open questions for recker, in priority order:**
1. **The grounding is Volume 3, and `COURSE_PROFILE.md` still says Volume 2.** This artifact records
   the discrepancy in its header, its `reading_assignment` and its `TEXTBOOK_REFERENCE` rather than
   patching the profile — a profile edit is recker's, and **no tool reads the key**, so nothing in the
   build depends on it. But `CORE.md` §8's open row and the profile's own "Open: Vol. 2 does not cover
   the whole course" section are now demonstrably live rather than speculative: **this lesson's source
   is Vol. 3 chapter 2.** Worth one line in the profile.
2. **Is Cengage 35.3–35.4 "Images Formed by Refraction" and "Thin Lenses"?** The same unverified
   assumption every lesson in this course carries. The circumstantial evidence is unusually clean
   here — two OpenStax sections, two Cengage sections, in the same order, on the same two topics, and
   the lesson title names the second one. Still not a look at a Cengage table of contents.
3. **Topic 4 is last and is a whole assigned section.** If recker would rather §2.3 were guaranteed
   reached, swapping topics 3 and 4 is a rebuild, not an edit — and it would make the sign conventions
   the thing most likely to go unreached, which is the trade to weigh.

**Unverified, same class as every earlier lesson:** that Cengage 35.3–35.4 covers this span in the
cadets' book. Nothing in the grounding can settle it.

### Lesson 36 — Double-Slit Interference

| | |
|---|---|
| **File** | [`lesson_36_preflight_double_slit_interference.jsx`](lesson_36_preflight_double_slit_interference.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-36-double-slit-interference-8b6dbbb7` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/9457d241-3879-42a4-99fc-8a4482136973 |
| **Component** | `Lesson36Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — Chapter 3 "Interference": the chapter opener/introduction, **§3.1** "Young's Double-Slit Interference" and **§3.2** "Mathematics of Interference", printed **pp. 109–114**. Six pages, one contiguous block, no interior hole. **Clean at the start, TRUNCATED at the end** — see the callout below |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Double-Slit Interference.pdf` (SHA-256 `3fe90e0d…966c6df6`, 15,163,859 bytes) — **unique in the corpus**; hashed against all 31 phys-215 PDFs, no duplicate |
| **Cadets' reading** | Cengage 43.8, 43.10 |
| **Probe topics** | **4** · ~2 active min each · ~10 min — the profile default, kept. Three-at-3-min was argued and rejected; see the callout |
| **Checks** | `check_artifact.py` **42 passed / 0 failed** (37 base + 5 `--forbid` guards proving no lesson-26 slug stem, slug suffix, component name or source topic string survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed the same day and accepted unchanged, all four objectives. **Publishing parsed the JSX**, which is the only parse this project has. No prefill link yet; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `interference-wave-evidence` | Fringes are superposition: light behaves as a wave |
| 2 | `coherence-requirement` | Why one source and one wavelength: coherence |
| 3 | `path-difference-order` | `d sin theta = m lambda`, and m is the order |
| 4 | `fringe-position-scaling` | Positions go as `lambda D / d`; small d spreads them |

None of the four appears in any earlier PHYS 215 artifact. This is the course's first optics build,
so collision was never likely — it was checked anyway.

> **THE GROUNDING IS VOLUME 3, NOT THE VOL. 2 THE PROFILE NAMES, AND THIS BUILD DOES NOT CLOSE THAT
> OPEN ITEM.** `COURSE_PROFILE.md` sets `grounding_text: OpenStax University Physics Vol. 2`, and
> Vol. 2 ends at electromagnetic waves. These pages are optics and come from **Vol. 3**, whose
> chapter numbering restarts — which is why an interference chapter is numbered 3 rather than 37, and
> why a reader expecting Vol. 2 will find the section numbers nonsensical. The lessons-30–41 volume
> question is recorded in `CORE.md` §8, `PROJECT.md` §10 and the profile as **recker's to settle**;
> all this build does is record which volume the pages in hand actually came from. **The artifact's
> `reading_assignment` says Vol. 3 explicitly**, so the audit trail is right even though the profile
> is not.
>
> **SIX PAGES, CONTIGUOUS — VERIFIED, AND ONE CROSS-CHECK IS BLIND.** Printed folios run
> **109 (unnumbered chapter opener), 110, 111, 112, 113, 114** with no break. In Vol. 3 the folio
> prints **top-left on a verso** beside the chapter running head and **top-right on a recto** beside
> the section running head, and **every page carries the "Access for free at openstax.org" footer**
> — so in this volume that footer is *not* a break signal and the two-consecutive-verso-footers rule
> from earlier lessons does not apply. Corroboration: numbered equations 3.1–3.6 unbroken, figures
> 3.1–3.8 unbroken, Example 3.1 the first and only worked example. **The Check-Your-Understanding
> sequence is BLIND here — this source prints none at all**, so it can neither confirm nor deny a
> hole. That is the fourth lesson in this course where one of the four sequences sees nothing.
>
> **THE HOLE IS TERMINAL, NOT INTERIOR, AND IT CUTS A WORKED EXAMPLE IN HALF.** p. 114 stops on the
> line *"Substituting known values yields"* inside **Example 3.1**. Absent: the numeric substitution,
> the final wavelength, the whole Significance paragraph, and everything else that follows in §3.2.
> `GAPS IN THE SOURCE` names each absence, and the `scope_note` forbids presenting any of it as
> today's material. **The one thing the tutor *is* allowed to do is finish the arithmetic with a
> cadet**, because the givens (`d = 0.0100 mm`, `theta = 10.95°`, `m = 3`) and the symbolic result
> (`lambda = d sin(theta)/m`) are all printed — that is doing physics from today's material rather
> than quoting an absent page. It is forbidden from attributing the *value* to the source. For the
> record and verified two ways (Taylor series and table interpolation): `sin(10.95°) = 0.18995`,
> `lambda = 6.33e-7 m = 633 nm`, the He-Ne line. **Extension problem B deliberately finishes that
> example and then goes past it**, and its worked answer reproduces the printed 10.95° from
> `lambda`, `d` and `m` — the strongest available check that the setup is right.
>
> **THE CHAPTER OUTLINE ON THE OPENER PAGE IS A TABLE OF CONTENTS, NOT AN INVENTORY, AND IT IS THE
> TRAP ON THIS BUILD.** p. 109 prints §3.1 through §3.5 by name, including **multiple-slit
> interference, interference in thin films, and the Michelson interferometer**. None of §3.3, §3.4 or
> §3.5 is in this source. An agent or a tutor that reads the outline as an inventory will confidently
> offer material that is nowhere in the grounding. `GAPS IN THE SOURCE` item 3 and the `scope_note`
> both name all three and forbid them. **One deliberately narrow exception:** the opener's prose and
> the Figure 3.1 caption *do* state, in print, that soap-bubble colour comes from interference
> enhancing particular wavelengths at a given film thickness — that single sentence is today's
> material, and the tutor may say exactly that much and no more.
>
> **BUILT AT FOUR TOPICS × ~2 MIN, AND THE CASE FOR THREE WAS ARGUED BEFORE IT WAS REJECTED.** This
> is the **thinnest source in the corpus** — six printed pages, one of which is a chapter opener —
> and 3 × ~3 min is an established shape in this course (lessons 13, 15, 20, 28, 29). It was not
> taken, because **page count is the wrong measure here**: these six pages carry **two complete
> sections**, **four printed learning objectives**, **six numbered equations** and a worked example.
> The test the rest of this run has applied — *does dropping a topic orphan a printed learning
> objective* — **is satisfied by this four and would be violated by any three**. Topic 1 takes
> "explain the phenomenon of interference"; topic 3 takes both "define constructive and destructive
> interference for a double slit" and "determine the angles for bright and dark fringes"; topic 4
> takes "calculate the positions of bright fringes on a screen". **Topic 2 is the one that is not a
> printed objective** — it is there because §3.1 spends a full printed page establishing coherence
> and because without it the experiment does not work at all. **If one of the four ever has to go it
> is 2** — but it is also the only topic on these pages that cannot be recovered from an equation.
> **All six pacing strings say 2** and were grepped by hand in the finished file: the constant, the
> `time_budget` block, the PACING opener, the probing instruction, the PACING line "about its 2 min
> budget", and the PACING line "its full ~2 min".

**NO SOURCE DEFECT WAS FOUND, AND THAT IS A FINDING RATHER THAN AN OMISSION.** Every figure was
re-rendered at **340 dpi** and checked against the physics, and every equation was verified as
printed:

| checked | verdict |
|---|---|
| Fig 3.4 amplitudes — `X + X → 2X`, `X + (−X) → 0` | correct |
| Fig 3.5 label sequence — seven labels, Min-Max-Min-**Max**-Min-Max-Min, centre on the axis | correct; the central fringe is bright |
| Fig 3.7(b) far-field construction — right-angle mark, and `Δl` dimensioned between the two parallel wavefronts | correct; both routes give `Δl = d sin θ` |
| Fig 3.8 — `y₁` and `y₂` both bracketed from the central axis to the 1st and 2nd side maxima | correct |
| Eq 3.3 `Δl = d sin θ`; Eq 3.4/3.5; Eq 3.6 `y_m = mλD/d` | all correct as printed |
| *"the smaller d is, the larger θ must be, since sin θ = mλ/d"* | correct |

**Nothing on these six pages is wrong.** This is the **first PHYS 215 artifact in this repository
with no "the book is wrong" caveat**, and it carries none rather than manufacturing one. The only
problem with this source is that it stops early. A later build must not read the absence of a caveat
here as a sign the defect audit was skipped — the audit ran and came back clean.

**Convention worth recording, because the cadets' book may differ.** OpenStax writes the destructive
condition as **`d sin θ = (m + 1/2)λ`, with `m = 0, ±1, ±2, ±3, …`** — not as `(2m+1)λ/2`. The two
sets of values are identical. The reference records both forms and instructs the tutor to treat a
cadet who writes the other one as **correct**, not as having erred. Same for `m` running over
negative values: the `±` covers the two sides of the central maximum, and `m = 0` in the *destructive*
condition is the **first dark fringe**, not the centre — which is the off-by-one misconception 6 and
extension problem A(c) both exist to catch.

**Open questions for recker**

1. **The Vol. 2 / Vol. 3 profile mismatch is now live in a built artifact.** `grounding_text` in
   `COURSE_PROFILE.md` still says Vol. 2. Nothing mechanical reads that key, so nothing broke — but
   the profile now contradicts a build. Worth either amending the profile to name both volumes or
   recording explicitly that the tail of the course grounds in Vol. 3.
2. **`PROJECT.md` §10 and `COURSE_PROFILE.md` both say "do not build lessons 30–41 until recker
   settles the volume question."** This build was commissioned anyway and the pages were in hand and
   contiguous, so nothing was guessed — but the block is still formally open and should be closed or
   restated rather than left contradicted by nineteen-plus artifacts.
3. **Is Cengage §43.8 + §43.10 really the double-slit pair?** The two assigned section numbers are
   *non-adjacent* (43.8 and 43.10, skipping 43.9), which is unusual in this schedule. The match to
   OpenStax §3.1–§3.2 was made by **topic** and confirmed by reading, which is the only method
   available; nothing in the kit checks it, and a mismatch produces a confident artifact grounded in
   the wrong material rather than an error.
4. **The terminal truncation means the tutor cannot state how many orders exist**, cannot give an
   intensity formula, and cannot say where a dark fringe's energy goes — all three are handled as
   *derivations* with the tutor instructed to say so. If recker would rather the tutor simply decline
   those, that is a one-line `scope_note` edit and a rebuild.

### Lesson 37 — Diffraction, Resolution

| | |
|---|---|
| **File** | [`lesson_37_preflight_diffraction_resolution.jsx`](lesson_37_preflight_diffraction_resolution.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-37-diffraction-resolution-89cef48b` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/7b3bc82a-aeed-4019-9af1-7a34163aac37 |
| **Component** | `Lesson37Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — **§4.1** "Single-Slit Diffraction" (printed pp. 136–140), **§4.2** "Intensity in Single-Slit Diffraction" (printed pp. 140–144), and **§4.5** "Circular Apertures and Resolution" (printed pp. 152–157). Fifteen pages in **two blocks** with a **seven-page hole** between them |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Diffraction, Resolution.pdf` (SHA-256 `f30b0d9ca4…`, unique in the corpus) |
| **Cadets' reading** | Cengage 36.1–36.2 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` 48 passed / 0 failed (37 base + 11 `--forbid` guards proving no lesson-26 objective key, slug stem, slug suffix, component name, section number, page range or source title survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05** — reviewed the same day and accepted unchanged, all four objectives. No prefill link yet; registration pending |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `single-slit-minima` | a sin theta = m lambda locates the DARK fringes |
| 2 | `slit-width-and-spread` | Narrower slit spreads the pattern wider |
| 3 | `single-slit-intensity` | Side maxima are weak; intensity goes as sinc squared |
| 4 | `rayleigh-resolution` | Rayleigh limit 1.22 lambda over D; bigger aperture resolves more |

> **⚠ THE GROUNDING TEXT IS VOLUME 3, AND `COURSE_PROFILE.md` SAYS VOLUME 2.** The profile's
> `grounding_text` reads *OpenStax University Physics Vol. 2* and its "Open: Vol. 2 does not cover the
> whole course" section flags the optics tail as *probably* Volume 3. **It is.** This source is
> Chapter 4 "Diffraction" of Volume 3, confirmed from the running heads on all fifteen pages. The
> artifact says Vol. 3 throughout — in the file header, the `TEXTBOOK_REFERENCE` source line, and
> `reading_assignment` — and records the disagreement in each of those three places. **The profile was
> deliberately NOT edited**: seven other builds were running against it concurrently. `PROJECT.md`'s
> claim that "the Vol. 2 / Vol. 3 boundary falls between lessons 30 and 31" is consistent with this.

> **⚠ Four topics, and for the first time in several lessons the printed-objective test is satisfiable
> and satisfied.** The source prints **six** learning objectives across its three sections — two per
> section — and the four topics cover **all six with nothing orphaned**: topic 1 takes §4.1's second,
> topic 2 takes §4.1's first plus the slit-width result that closes §4.2, topic 3 takes both of §4.2's,
> topic 4 takes both of §4.5's. **Five was rejected twice over:** the cadet-facing card promises "about
> 10 minutes" and 5 × ~2 min overshoots it, *and* the obvious fifth topic would be diffraction
> gratings — which is exactly the material in the hole. **All six pacing strings were grepped and
> confirmed to say 2**, including the sixth (*"its full ~2 min"*), which the base file's own comment
> does not name.

**Extension problems:** A **one slit, and everything you can measure about it** — first minimum, its
position on the screen, the width of the central band, then halving the slit, then how many minima a
slit can produce at all (approachable, **Pass 2 gets (a)–(c) from `y₁ = Lλ/a` with no angle ever
computed, and gets (d) by pure scaling since every result goes as 1/a**) · B **the same number, twice,
meaning opposite things** — a double slit with `d = 20.0 μm` and a single slit with `a = 20.0 μm` at
the same wavelength, which give the **identical angle** for a *bright* fringe and a *dark* one
(standard, **Pass 2 shows the equality is forced rather than computed, and checks the pairing argument
by asking what a half-wavelength path difference would do**) · C **how faint are the wings, and where
exactly are they** — the first three minima, the first three side maxima from `I = I₀(sin β/β)²`, and
then the pattern `Iₘ/I₀ = 4/((2m+1)²π²)` (standard, **Pass 2 reaches that closed form from the other
direction, so (b) and (d) check each other rather than repeat each other, and confirms `a/λ = 3.64`
allows exactly three minima**) · D **four instruments, one formula** — the eye's own diffraction limit,
Hubble, Arecibo *by ratio without computing either angle*, the 920 km dish that would match Hubble at
21 cm, oil-immersion versus dry objectives, and DVD versus Blu-ray (challenging, **Pass 2 does (b) as
`2.40 m / 3.0 mm` with λ and the 1.22 cancelling identically, and re-derives the Arecibo factor of 3000
from the 920 km answer by a completely different route**). Every number computed and independently
re-checked in Python.

**Transcribed off 140-dpi rasters, three regions re-rendered at 300 dpi to read the defective lines
character by character:** 5 numbered equations (4.1–4.5) plus ~12 unnumbered displays, 16 figures
(4.2–4.10 and 4.17–4.23), 3 complete worked Examples (4.1, 4.2, 4.6) plus the severed tail of a
fourth, and 4 unanswered Check Your Understanding prompts (4.1, 4.2, 4.4, 4.5 — **all four worked here
for the tutor**).

> **⚠ WHERE THIS PDF SPANS AND WHERE IT STOPS — stated page by page for the next build.**
> - **Printed pp. 136–144, then 152–157.** Fifteen pages, two blocks, one chapter.
> - **The hole is printed pp. 145–151 — SEVEN pages.** It holds **§4.3 Double-Slit Diffraction** and
>   **§4.4 Diffraction Gratings**, entirely, except the tail of §4.4's last worked Example and its
>   Check Your Understanding, which survive orphaned on p. 152. Also gone: **Figures 4.11–4.16**
>   (including 4.16, which a *surviving* line on p. 152 refers to), **Examples 4.3 and 4.4** entirely
>   with 4.5 severed mid-solution, and **Check Your Understanding 4.3**.
> - **THIS IS A HOLE, NOT A CHAPTER SPLIT, AND THAT WAS CHECKED RATHER THAN ASSUMED.** All 31 PDFs in
>   the phys-215 corpus were hashed and their first pages inspected. The obvious candidate — lesson
>   36's `Double-Slit Interference.pdf` — is **six pages of a different chapter**, Chapter 3
>   (Interference §3.1–§3.2). **No file in this corpus contains Chapter 4 pp. 145–151.** Unlike the
>   24/25 pair, there is nothing to coordinate; the material is simply unavailable.
> - **The excision looks deliberate in content and ragged at every edge.** The two removed sections are
>   not this lesson's topic and are not on the schedule at all. But **all four edges cut a sentence**:
>   p. 136 opens mid-paragraph in the chapter introduction, **p. 144 ends mid-URL** inside an
>   INTERACTIVE box, **p. 152 opens mid-solution** of a grating worked Example on a sentence about
>   significant figures, and **p. 157 ends mid-sentence** in another INTERACTIVE box, so §4.5 does not
>   finish either. Whoever assembled this cut to a topic boundary, not a structural one.

> **⚠ THE NUMBERED-EQUATION SEQUENCE IS BLIND TO THIS HOLE — the third time the equation check has
> been the blind one, and the fourth lesson in a row where one of the four sees nothing.** Equations
> **4.1, 4.2, 4.3, 4.4** sit on pp. 138–142 and **4.5** sits on p. 153: **consecutive across seven
> missing pages**, because §4.3 and §4.4 introduce no numbered equation of their own — the grating
> equation is Chapter 3's, reused. **An equation-only contiguity check calls this source whole.** The
> other three sequences all break: folios 136–144 → 152–157; figures 4.2–4.10 → 4.17–4.23; Examples
> 4.1, 4.2 → fragment → 4.6; Check Your Understanding 4.1, 4.2 → 4.4, 4.5. **The folio sequence is
> what caught it**, exactly as `PROJECT.md` says it should be treated — as the authority, with the
> others as corroboration that any one of them can fail to provide.

> **⚠ Two real source defects and three typographical ones, each verified two ways at 300 dpi.**
> 1. **Example 4.1's Strategy says the equation is used "first to find `D`" when the quantity being
>    found is the SLIT WIDTH `a`.** Its own solution line one paragraph later reads *"Solving the
>    equation a sin θ = mλ **for a**"*, and the answer `1.56 × 10⁻⁶ m` is a slit width in a problem
>    containing no circular aperture. **`D` is not defined anywhere in §4.1** — it is introduced
>    *fifteen printed pages later* as the diameter of a circular aperture, which makes this the single
>    most confusing letter that could have been misprinted here. A cadet who carries it forward
>    arrives at §4.5 with `a` and `D` fused. **This is the defect that lands on today's material**;
>    the artifact tells the tutor to say plainly it is a typo.
> 2. **`y_V = (2.00 m)(tan 22.33°)` is printed as `0.815 m`; it is `0.8215 m`.** **Verified two ways:**
>    direct evaluation, `tan 22.33° = 0.41074`, ×2.00 m = 0.8215 m; and by the difference — the
>    companion `y_R = 2.338 m` is *correct* (2.3384), so `y_R − y_V` should be **1.517 m**, not the
>    printed **1.523 m**. The printed difference is self-consistent with the printed wrong `y_V`,
>    which is how the slip survived proofreading. **It is in the ORPHANED grating fragment**, so it is
>    out of scope anyway — recorded because a cadet who read that page and quotes 0.815 m read it
>    correctly.
> 3. **Rounding, not error, in Example 4.1(b):** the substitution shows `a = 1.56 × 10⁻⁶ m` but the
>    quoted `sin θ₁ = 0.354` and `θ₁ = 20.7°` come from the **unrounded** `1.5556 × 10⁻⁶ m`. A cadet
>    using the printed 1.56 gets 0.3526 and **20.6°** and has done nothing wrong.
> 4. **"the distances on the SECREEN"** for *screen*, p. 152.
> 5. **"without the refractive index in the NOMINATOR"** for *numerator*, p. 156. Also `I/I_o` with a
>    letter-o subscript where `I₀` is used everywhere else, and `sin(4.77)` printed as `−0.9985` where
>    the value is `−0.99812` — the final `0.044` is unaffected either way.

**Checked and confirmed correct rather than flagged:** **every other printed number in this source
reproduces exactly** — both parts of Example 4.1 (`a = 1.5556 × 10⁻⁶ m`, `θ₁ = 20.70°`), both parts of
Example 4.2 (`θ₁ = 15.96°`, `θ₂ = 33.37°`, `β = 4.774 rad = 1.5195π`, `I/I₀ = 0.0438 → 0.044`), the
phasor intensities `0.045 I₀` and `0.016 I₀` against the independent closed form `4/((2m+1)²π²)` =
0.04503 and 0.01621, both parts of Example 4.6 (`2.796 × 10⁻⁷ rad`, `0.56 ly`), and the algebraic chain
`1.22λd/D = 0.61λ/sin α = 0.61λn/NA`, which is an identity. **One arithmetic slip in the whole file,
and it is in the orphaned fragment.**

> **⚠ THE HARD CONSTRAINT IN THIS ARTIFACT: the tutor is FORBIDDEN from stating any grating or
> double-slit-diffraction result.** `GAPS IN THE SOURCE` carries an explicit prohibition list — no
> grating equation, no **"missing orders"** (an interference maximum suppressed by a diffraction
> minimum, which is precisely §4.3's content and precisely the hole), no double-slit-modulated-by-
> envelope description, no `d/a` ratio, no grating resolving power or dispersion, no working of the
> orphaned line-spacing question, and no assertion that more slits sharpen the primary maxima as a
> *result* (the only surviving statement to that effect is a qualitative sentence inside a simulation
> link box). **If a cadet raises gratings the tutor engages honestly at a general level and says it is
> reasoning beyond today's material** — a grating is many slits, more slits make fringes sharper, that
> is what makes it a spectroscopic instrument — **and does not reconstruct the book's treatment.**

> **⚠ The §4.2 → §4.5 seam is handled explicitly, because the source jumps from single-slit intensity
> straight to circular apertures.** The reference carries a dedicated block forbidding any suggestion
> that the chapter runs continuously across that jump. The honest picture, and the one the tutor is
> given: §4.1 and §4.2 are one continuous treatment of one long narrow slit; **§4.5 starts over on a
> different aperture shape**, connected by **analogy, not derivation** — the source says the circular
> pattern is "similar to" a slit's, says the result "can be shown", and changes the coefficient from 1
> to **1.22 with no explanation**. The legitimate connection, which the tutor *is* told to make, is
> that both say the same thing: a finite opening spreads a wave, the spread goes as wavelength over
> aperture size, and the shape shows up only in the number.

**Three further caveats recorded in the artifact:** **the 1.22 is asserted, never derived** — the
source writes *"It can be shown that"* and offers nothing on any page here, so the tutor may say it is
a property of the circular geometry and must label that as reasoning beyond the material · **the side
maxima are not exactly halfway between the minima**, which §4.2 states carefully (φ *slightly less
than* 3π, 5π, 7π, with the fixed-arc-length reason) and which Example 4.2 then blurs by computing at
the exact midpoint and calling it only *"very close to"* the maximum — a cadet who followed the example
and missed the caveat has read the book · **the source never says "Airy disk" and never says "sinc"**,
though it describes both things in detail; if a cadet uses either term the tutor confirms it and moves
on rather than introducing it as though the material had.

**Source uniqueness confirmed.** SHA-256 `f30b0d9ca4…` computed and compared against all 31 PDFs in the
phys-215 corpus. Unique. The only duplicate pair remains `Displacement Current.pdf` /
`Maxwell's Equations.pdf`, re-confirmed byte-identical by the same scan.

**No objective-key collision.** All 26 artifacts in `courses/phys-215/artifacts/` were scanned; none of
`single-slit-minima`, `slit-width-and-spread`, `single-slit-intensity` or `rayleigh-resolution` appears
elsewhere. In particular lesson 36's four keys (`interference-wave-evidence`, `coherence-requirement`,
`path-difference-order`, `fringe-position-scaling`) are distinct and complementary.

**Observation, not a defect, and not fixed here:** the `VERIFICATION PROTOCOL` block in the tutor
prompt still uses a **tritium/nuclear-physics** worked example, inherited from PHYS 310's structural
base. It is present in every PHYS 215 artifact, it is verbatim-copied text the skill says to copy
verbatim, and it is behaviourally harmless. Recorded so the next agent does not think it was missed.

**Open questions for recker, in priority order:**
1. **`COURSE_PROFILE.md`'s `grounding_text` says Vol. 2 and this lesson is grounded in Vol. 3.** The
   artifact says Vol. 3 and records the disagreement; the profile was left alone because seven builds
   were running against it. **It needs a one-line fix** — probably naming both volumes with the
   boundary at lesson 31 — and the fix should land in one place rather than in each optics artifact.
2. **Is the seven-page hole worth chasing?** §4.3 and §4.4 are not on this course's schedule, so
   nothing in lessons 36–37 needs them. But **lesson 38 is "LAB: Single/Double-Slit Diffraction"**, and
   §4.3 is exactly the double-slit-diffraction envelope that lab would demonstrate. If the lab's
   pre-brief expects cadets to have seen missing orders, this preflight cannot supply it and says so.
3. **The `D`-for-`a` misprint is the strongest teaching hook in the artifact and also the most likely
   to make a cadet think the tutor is contradicting their book.** The handling is: agree the page says
   `D`, say plainly it is a typo for the slit width, and name what `D` means fifteen pages later. Worth
   a look.

**Unverified, same class as every other lesson in this run:** that Cengage 36.1–36.2 covers this span
in the cadets' book. The topical match is clean — single-slit diffraction and resolution, in that order
— and the schedule's own topic string names both. It is still not a look at a Cengage table of
contents. **Note the numbering is unusually far apart here:** lesson 36's Cengage reading is 43.8/43.10
and lesson 37's is 36.1–36.2, which is a *decrease*, so the two lessons are not adjacent in the cadets'
book either. That is worth one look if anything about this lesson's scope turns out wrong.

### Lesson 39 — Intro to Nuclear

| | |
|---|---|
| **File** | [`lesson_39_preflight_intro_to_nuclear.jsx`](lesson_39_preflight_intro_to_nuclear.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-39-intro-to-nuclear-4084143d` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/3f5d73c4-5b89-4e97-b2fb-3654fabd964e |
| **Component** | `Lesson39Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — chapter 10 "Nuclear Physics": **§10.1** "Properties of Nuclei" (printed pp. 432–436), a **fragment of §10.2** "Nuclear Binding Energy" (printed p. 440 only), **§10.3** "Radioactive Decay" (printed pp. 440–444), **§10.5** "Fission" (printed pp. 454–460), **§10.6** "Nuclear Fusion" (printed pp. 460–464). **21 pages spanning printed pp. 432–464, with 12 pages missing in TWO holes** |
| **Source PDF** | `Core_Preflights/textbook-pdfs/phys-215/Intro to Nuclear.pdf` (SHA-256 `d2e10149e739…`, unique in the corpus) |
| **Cadets' reading** | Cengage 43.8, 43.10 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` **46 passed / 0 failed** (37 base + 9 `--forbid` guards proving no lesson-26 slug stem, hex suffix, component name, header title, source filename or objective key survived the rebase) |
| **Status** | **PUBLISHED 2026-08-05.** The review correction was applied **before** publication, so the live artifact is the corrected version, not the build this section's tables originally described. Prefill link not yet generated; registration pending. recker accepted three objectives and rejected topic 2: *"half life good. don't discuss lambda. talk about types of radiation."* Applied — **but the second half needed a ruling first, because §10.4 is missing from the source**; see the callout below |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `nuclide-notation` | Z, N and A: what the nuclear symbol counts |
| 2 | `halflife-and-radiation-types` | Half-lives, and what alpha, beta and gamma emit — **replaced the original `decay-law-halflife` on recker's review, 2026-08-05** |
| 3 | `binding-energy-release` | Fission and fusion both move toward iron |
| 4 | `activity-and-units` | Activity is lambda N, not the number of nuclei |
> **TOPIC 2 WAS REWRITTEN ON REVIEW, 2026-08-05**, and its two halves needed different handling.
> recker's note: *"half life good. don't discuss lambda. talk about types of radiation."*
>
> **"Don't discuss lambda" was a straight edit.** The decay constant is out of topic 2 — no
> `-dN/dt = lambda*N`, no converting between `lambda` and `T_1/2`. `N = N_0/2^n` is the only decay
> formula the topic now needs, and it is printed.
>
> **"Talk about types of radiation" had no grounding, and that had to be raised rather than
> improvised.** §10.4 is where OpenStax explains alpha, beta and gamma decay as processes, and §10.4
> is **missing from the source PDF**: the printed folios run 432–436, 440–444, 454–464, so pp.
> 445–453 are simply absent. Every one of the 31 PDFs in the corpus was scanned and none carries
> them. What survives in this source is only the *names* — a figure caption about Earth's heat and a
> beta arrow in the breeder-reactor chain. **recker ruled the same day: assume prior knowledge.** So
> the three types are handled as the cadet's own prior coursework, a category this artifact already
> had, and **nothing was reconstructed from model knowledge** — the PHYS 310 exception is scoped to
> PHYS 310.
>
> **What the source does supply is used**: the breeder chain
> `n + U-238 -> U-239 -(beta)-> Np-239 -(beta)-> Pu-239` is a printed, worked instance of beta decay
> raising Z by one while A stays put — twice in a row — which ties straight back to topic 1's nuclear
> symbol.
>
> **`lambda` is NOT gone from the artifact, deliberately.** Topic 4, `activity-and-units`, was
> **accepted** in the same review and its whole content is `A = lambda*N`. The rejection was
> per-objective, so lambda keeps exactly one home and topic 2 points at it instead of pretending it
> does not exist. **If the intent was to remove lambda from the lesson entirely, topic 4 is the one
> to say so about** — that is a one-line change and it is recker's call, not an agent's.

> **⚠ THE FIRST VOLUME 3 ARTIFACT IN THIS COURSE.** Every earlier PHYS 215 artifact grounds in
> OpenStax Vol. 2, and `COURSE_PROFILE.md` still names Vol. 2 as `grounding_text`. This source is
> self-evidently Vol. 3 chapter 10. Nothing was changed in the profile — that is recker's call — but
> the header comment and `reading_assignment` both say Vol. 3 explicitly so a later reader is not
> misled by the profile.

> **⚠ THE SCOPING WAS THE HARD PART, AND FOUR TOPICS COVER MAYBE A THIRD OF THE SOURCE.** Twenty-one
> pages, four textbook sections, **thirteen printed learning objectives** — the most in the run, more
> than lesson 26's nine. No set of four can leave every printed objective probed and the artifact does
> not claim it does. The rule applied instead: **probe the ideas every other idea in the chapter is
> built out of.** Topic 1 is the notation and the range argument for the neutron excess, which
> everything later is written in. Topic 2 is the decay law, which is §10.3's entire quantitative
> content. **Topic 3 is the single principle behind fission AND fusion** — it is what makes eleven
> pages hang together rather than being two unrelated subjects, and it is the one that connects a
> reactor to a star, which is presumably why this lesson is paired with a planetarium session. Topic 4
> is the one real conceptual trap in the decay material (activity is not "how much is left").
> **What that costs is large and is listed by name in the scope note:** radiocarbon dating, nuclear
> size, the chart of the nuclides in detail, the history, the liquid drop model, chain reactions,
> critical mass, bombs, reactors, breeder reactors, the proton-proton chain, the Sun, and
> nucleosynthesis are **all engage-only**. The scope note is emphatic that engage-only means ENGAGE —
> completely, warmly, at whatever length the cadet wants — and extension problems C and D exist so a
> cadet who wants the dating and the stellar material gets it properly in the untimed portion.
> **If a fifth is ever added it should be radiocarbon dating**, which is fully grounded here. **If one
> of the four ever has to go it is 4**, which is why it is last.
> All **six** pacing strings were grepped and confirmed to say 2 — `PER_TOPIC_BUDGET_MIN`, the
> `time_budget` block, the PACING opener, the probing instruction, *"about its 2 min budget"*, and
> *"gets its full ~2 min"*. **Note that the header comment inherited from earlier artifacts says there
> are FIVE. There are six**, and this artifact's header comment now says so.

> **⚠ THE PARENTHETICAL WAS DROPPED FROM THE TOPIC — recker should overrule this if it is wrong.**
> The schedule row reads **`Intro to Nuclear (Planetarium)`**. `(Planetarium)` is a venue note, not
> physics, so the slug, the header title, `lesson_id`, the filename and the component name all carry
> **`Intro to Nuclear`** alone. Restoring it is a **rebuild and a new slug**, not an edit, because the
> topic text feeds the stem.

**Extension problems:** A **nuclide bookkeeping and the growing neutron excess** — N and N/Z for
iron-56, silver-107, lead-206 and uranium-238, then *why* the ratio climbs (approachable, **Pass 2
checks every N by addition instead of subtraction and every ratio by multiplying back, and then
sanity-checks the four points against the source's own "Z > 15" threshold**) · B **one gram of
strontium-90 a century on** — decay constant, surviving fraction, activity, and then the same N with a
thousand-fold longer half-life (standard, **Pass 2 converts 100 y into 3.472 half-lives and evaluates
2^−3.472 = 1/11.10, which reproduces the exponential's 0.0901 using none of the same keystrokes**) ·
C **the burial cave, completed, and how far carbon dating reaches** — 80% remaining, 1.0% remaining,
and what fraction survives at the 50,000-year ceiling (standard, **Pass 2 runs every part backwards
through the half-life count and recovers the given 80% and 1.0% exactly; this problem completes the
worked example whose printed solution is on a missing page**) · D **a kilogram of fission fuel against
a kilogram of fusion fuel** — 8.20 × 10¹³ J from U-235, 3.37 × 10¹⁴ J from an equimolar D–T mixture,
and why fusion wins per kilogram despite losing 11:1 per reaction (challenging, **Pass 2 recomputes
both as MeV per atomic mass unit of fuel — 0.8509 vs 3.4990 — so every mole and every Avogadro cancels
before any arithmetic, and the ratio 4.11 comes out identically; it also independently reproduces BOTH
of the source's own printed claims, the 8.21 × 10¹³ J figure and the "only one-fourth" comparison**).
Every number computed and independently re-checked.

**Transcribed off 140-dpi rasters of all 21 pages:** 17 numbered equations (10.1–10.3, 10.7–10.20)
plus ~20 unnumbered displays and 14 nuclear reactions, 16 figures (10.2–10.5, 10.8–10.10,
10.16–10.24), 6 worked Examples (10.1, 10.4, 10.5, 10.9, 10.10, 10.11 — 10.1 and 10.6 truncated),
Table 10.1 in full, and 3 unanswered Check Your Understanding prompts (10.2, 10.5, 10.6).

> **⚠ TWO INTERIOR HOLES — THE MOST FRAGMENTED SOURCE IN THIS CORPUS, AND THE FOLIO MAP THIS BUILD
> WAS HANDED WAS WRONG BY ONE PAGE IN BOTH PLACES.** This PDF prints a page number on **every** page,
> recto and verso alike, so the folio sequence is complete and no break can hide behind an unnumbered
> verso. Read off the rasters page by page:
> ```
> PDF p  1  2  3  4  5 |  6  7  8  9 10 | 11 12 13 14 15 16 17 18 19 20 21
> folio 432 433 434 435 436 | 440 441 442 443 444 | 454 455 456 457 458 459 460 461 462 463 464
> ```
> - **HOLE 1 — printed pp. 437–439 (3 pages).** After folio 436, before folio 440.
> - **HOLE 2 — printed pp. 445–453 (9 pages).** After folio 444, before folio 454.
> - Span 432–464 is **33 printed pages; 21 present; 12 absent; 3 + 9 = 12** closes exactly.
> - **The brief this build started from put both breaks one folio EARLIER — 438–440 and 446–454.**
>   Both were wrong, and the failure mode is worth keeping: **a hole located one page off names the
>   wrong missing content**, and the wrong content is what the GAPS block would then have forbidden.
>   The rasters were re-read rather than trusted.
> - **THE NUMBERED-EQUATION SEQUENCE IS BLIND AT THE SECOND SEAM.** Examples (10.1 | 10.4–10.6 |
>   10.9–10.11), Figures (10.2–10.5 | 10.8–10.10 | 10.16–10.25) and Check Your Understanding
>   (— | 10.2 | 10.5, 10.6) all break at both seams. **Equations run 10.1–10.3, then 10.7–10.20, then
>   stop entirely, because §10.5 and §10.6 print no numbered equation at all** — so an equation-only
>   check would call pp. 444 and 454 adjacent when they are nine pages apart. **Fourth lesson in a row
>   where one of the four sequences says nothing. Never require all four to agree.**
> - **Edges.** p. 432 opens at the §10.1 heading. **p. 436 cuts a worked example's Significance in
>   half.** p. 440 opens mid-Significance of a §10.2 worked example. **p. 444 cuts a worked example
>   between its Strategy and its Solution.** p. 454 opens mid-paragraph in §10.4, one paragraph before
>   the §10.5 heading. p. 464 closes after referencing a figure on the following page.
> - **Not a chapter split.** Both holes are interior to one chapter of one volume, and **no other
>   artifact in this repository holds the missing pages** — no other PHYS 215 source is Vol. 3.

> **⚠ HOLE 1 IS THE DANGEROUS ONE AND IT LANDS ON TOPIC 3. §10.2 NUCLEAR BINDING ENERGY SURVIVES AS
> FIVE LINES.** Exactly this much is present, and there is no more: the closing two lines of a worked
> example (*"Since A = 4, the total binding energy per nucleon is BEN = 6.82 MeV/nucleon"*), its
> Significance comparing that to the hydrogen isotopes at *"only ≈ 3 MeV/nucleon"*, and Check Your
> Understanding 10.2. **Absent:** the mass defect as a defined quantity, `BE = (Δm)c²` as a statement
> about a *nucleus*, the defining formula `BEN = BE/A`, equations 10.4–10.6, Examples 10.2 and 10.3,
> and **Figure 10.7 — the binding-energy-per-nucleon curve itself, with the iron peak.**
>
> **BUT THE CURVE ARGUMENT SURVIVES, TWICE, IN PROSE, IN LATER SECTIONS — which is why topic 3 is
> buildable and why dropping it would have been the wrong call.** All three of these are printed on
> pages that are present:
> - **p. 456 (§10.5):** *"Energy changes in a nuclear fission reaction can be understood in terms of
>   the binding energy per nucleon curve. The BEN value for uranium (A = 236) is slightly lower than
>   its daughter nuclei, **which lie closer to the iron (Fe) peak**. This means that nucleons in the
>   nuclear fragments are **more tightly bound** than those in the U-235 nucleus."*
> - **p. 460 (§10.6):** *"…the oxygen nucleus is **much more tightly bound** than the carbon and
>   helium nuclei, indicating that the reaction produces a **drop in the energy of the system**."*
> - **p. 462 (§10.6):** *"**iron has the peculiar property that any fusion or fission reaction
>   involving the iron nucleus is endothermic**"* — **the peak, stated as physics rather than as a
>   graph.** This is the sentence the tutor is told to reach for whenever it would otherwise reach for
>   the figure.
>
> And **`E = (Δm)c²` with `1 u = 931.5 MeV/c²` is worked end to end twice** — a fission Q of 171.2 MeV
> on p. 458 and a fusion Q of 25.7 MeV on p. 463.
>
> **So: the ARGUMENT is grounded and the PICTURE is not.** `GAPS IN THE SOURCE` item 1 states this as
> an exhaustive list of specific prohibitions rather than a vague warning. The tutor **may not**
> describe the curve as a graph, describe its shape or where it turns over, offer to sketch it, quote
> **any** BEN value except helium-4's 6.82 and the hydrogen isotopes' ≈ 3 (**in particular not the
> familiar ~8 MeV/nucleon iron peak, which is nowhere in this source**), define the mass defect of a
> nucleus, or use `BEN = BE/A` as a formula. It **may** state everything quoted above. If a cadet
> raises the curve themselves the tutor engages, confirms the two directions of travel and the iron
> peak, and says straight that it is not putting numbers on it today.

> **⚠ Hole 2 (9 pages) is low-risk and is recorded anyway.** It takes the tail of §10.3 — including
> the **Solution** to Example 10.6, the burial-cave dating problem whose statement and Strategy are on
> the last surviving page — and effectively all of **§10.4 Medical Applications and Biological Effects
> of Nuclear Radiation**, of which only the closing paragraph and Figure 10.16 (Earth heated by
> radioactive decay) survive at the top of p. 454. **None of §10.4 is this lesson's topic.** The scope
> note forbids the tutor from putting numbers on radiation dose, dose limits, RBE, medical imaging or
> therapy, and tells it to say honestly that dose is a different quantity from activity.
> **Example 10.6 is recoverable rather than forbidden**, because both equations it needs (10.10 and
> 10.15) are on surviving pages: λ = 0.693/5730 y = 1.2094 × 10⁻⁴ y⁻¹, t = −ln(0.80)/λ = **1845 y**.
> Checked twice (1845/5730 = 0.322 half-lives, 2^−0.322 = 0.800). Extension problem C works it, and
> the tutor is told to present it as a derivation, never as a printed answer.

> **⚠ ALSO ABSENT, AND COUNTERINTUITIVELY SO: ALPHA, BETA AND GAMMA DECAY AS PROCESSES.** The source
> names all three repeatedly — in the Earth-heating figure, in the breeder-reactor chain, on the
> radiation warning symbol — and **never explains what any of them is, what happens to Z and A, or why
> they occur.** A build that skimmed the prose would assume they were covered. The scope note tells
> the tutor to give the one-sentence version, label it as beyond today's material, and not develop it.

> **⚠ Six real source defects, each verified two ways, and NONE of them is an arithmetic error —
> every printed number in this source recomputes exactly.**
> 1. **THE HEADLINE ONE, and the one that will actually come up.** p. 457: *"To produce a **controlled,
>    sustainable** chain reaction, the percentage of U-235 must be increased to about 50%."* p. 458
>    then says Fermi's first working reactor *"contained U-238 enriched with **3.6% U-235**."*
>    **Verified two ways:** the contradicting 3.6% is in the same file one page later, and the 50%
>    sentence sits under the heading **"The Atomic Bomb"** among critical mass, gun assembly and
>    Pu-239 — the missing word is *explosive*, not *controlled*. **A cadet who says power reactors
>    need 50% enrichment read that sentence.** The tutor is told to correct the physics, credit the
>    reading, and point them at the 3.6% so they can see the contradiction themselves.
> 2. **p. 458, Example 10.9.** The product mass is computed as `237.866993 u` and the very next line,
>    subtracting it, writes `237.8669933 u` — one extra digit appearing nowhere else. **The result is
>    right:** 238.050784 − 237.866993 = 0.183791 u, and 0.183791 × 931.5 = 171.2 MeV, both as printed.
>    A typesetting slip.
> 3. **p. 460, the fusion section's third printed learning objective says *fission*** where the other
>    two in the same list say fusion: *"Explain the **fission** concept in the context of **fusion**
>    bombs…"*
> 4. **p. 440:** *"Radioactive decay occurs for all nuclei with **Z > 82**, and also for some unstable
>    isotopes with **Z < 83**."* Over the integers those two inequalities cover **every** nucleus, so
>    as written the sentence says everything is radioactive. **Verified two ways:** the arithmetic of
>    the inequalities, and the chart of the nuclides on p. 434, which prints hundreds of stable cells.
>    The intent is plainly "all above Z = 82, and some below".
> 5. **p. 464:** the solar example's Significance says *"the proton-proton **decay** chain"*; every
>    other mention says *chain*, and the chain is fusion.
> 6. **p. 459, minor:** the waste paragraph calls **U-236** a product of U-235 *fission*. U-236 is the
>    **compound nucleus** formed by neutron capture — the same source's own Figure 10.19 shows exactly
>    that. Low-stakes; the tutor is told not to build a probe on it.
>
> In every case the tutor is told that **a cadet who quotes the printed version has read the book
> correctly**, to say the book has an error on that line, and never to let the cadet think they
> misread it.

**Two notation collisions in one chapter, both real trip hazards and neither flagged by the source:**
**`A` is the mass number in §10.1 and §10.5 and the ACTIVITY throughout §10.3** (with `A₀` the initial
activity) · **`N` is the neutron number in §10.1 and the NUMBER OF UNDECAYED NUCLEI throughout §10.3**
(with `N₀` the initial number). Two sections apart, same letters, no warning anywhere. The reference
records both, and the tutor is told that a cadet who writes `A = λN` and then substitutes a mass
number is doing what the book made available to them.

**Checked and confirmed correct rather than flagged — every printed numerical result reproduces:**
the copper weighted average (63.55 g/mol), the iron-56 radius (4.6 fm) and density (2.3 × 10¹⁷ kg/m³),
the strontium-90 decay constant (7.61 × 10⁻¹⁰ s⁻¹) and activity (5.10 × 10¹² decays/s), the
carbon-14 chain from 5.02 × 10²⁵ carbon nuclei through 250 Bq to 6.76 nCi, the fission
Q = 171.2 MeV, the 8.21 × 10¹³ J per kilogram of U-235, and **all three parts** of the solar
mass-loss example (0.0276 u, 25.7 MeV, 9.26 × 10³⁷ reactions/s, 4.24 × 10⁹ kg/s, 6.8 × 10²⁶ kg,
0.034%). **No arithmetic slip anywhere.** The defects in this source are words.

**Source uniqueness confirmed.** SHA-256 `d2e10149e739…`, computed and compared against all 31 PDFs in
the phys-215 corpus. Unique. The only duplicate pair remains `Displacement Current.pdf` /
`Maxwell's Equations.pdf`, re-confirmed byte-identical by the same scan.

**Observation, not a defect, and for once it is *not* harmless-but-irrelevant:** the `VERIFICATION
PROTOCOL` block in the tutor prompt uses a **tritium** worked example inherited from PHYS 310's
structural base — *"If a cadet says tritium has three protons… The reference confirms this."* In every
other PHYS 215 artifact that last clause is false, because a transformer reference confirms nothing
about tritium. **In this artifact it is true**: p. 434 prints the three hydrogen isotopes and Table
10.1 lists tritium's mass and 12.32 y half-life. The block was left verbatim, as the skill requires.

**Open questions for recker, in priority order:**
1. **Should the cadet-facing title say "Intro to Nuclear (Planetarium)"?** The parenthetical was
   dropped as a venue note. If it should be in the title the fix is a **rebuild with a new slug**, not
   an edit — the topic text feeds the stem.
2. **Is topic 3 the right third topic given that §10.2 is a fragment?** It is the topic the source
   supports least directly and the one that most obviously belongs in a lesson paired with a
   planetarium session. The alternative is promoting radiocarbon dating (fully grounded) and demoting
   the fission/fusion principle to engage-only — which would leave eleven of the source's twenty-one
   pages unprobed. **Built the way it is deliberately; overrule in one line if that is wrong.**
3. **`COURSE_PROFILE.md` says `grounding_text: OpenStax University Physics Vol. 2` and this lesson is
   Vol. 3.** Not changed here — a profile edit is cross-cutting and other agents are running. Worth a
   decision now that a Vol. 3 artifact exists.
4. **Is there a source anywhere for §10.2 and §10.4?** Twelve pages of this chapter are in no file in
   this corpus. §10.2 in particular is one figure and three equations away from making topic 3
   comfortable instead of carefully fenced.

**Unverified, same class as every earlier lesson:** that Cengage 43.8 and 43.10 cover this span in the
cadets' book. The OpenStax sections were chosen by **topic** and confirmed by reading, not by matching
a number — the two books number differently and cannot be mapped mechanically.

### Lesson 41 — Photoelectric Effect, Wave/Particle

| | |
|---|---|
| **File** | [`lesson_41_preflight_photoelectric_effect_wave_particle.jsx`](lesson_41_preflight_photoelectric_effect_wave_particle.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-41-photoelectric-effect-wave-particle-518e76f6` |
| **Published** | 2026-08-05 — https://claude.ai/public/artifacts/812c9b56-50de-4e0c-b63d-ce5d9093f48b |
| **Component** | `Lesson41Preflight` |
| **Built** | 2026-08-05 |
| **Grounding** | OpenStax University Physics **Vol. 3** — **§6.1** "Blackbody Radiation" + **§6.2** "Photoelectric Effect" (printed pp. 232–245); **§6.5** "De Broglie's Matter Waves" + **§6.6** "Wave-Particle Duality" (printed pp. 259–271); and **§7.2** "The Heisenberg Uncertainty Principle" (printed pp. 297–300). Thirty-one pages in **three blocks** across **two PDFs** and **two chapters** |
| **Source PDFs** | `Core_Preflights/textbook-pdfs/phys-215/Photoelectric Effect.pdf` (SHA-256 `2485a55d…`) **and** `Wave-Particle, Uncertainty.pdf` (SHA-256 `f5167888…`). Both unique in the corpus; the only duplicate pair remains Displacement Current / Maxwell's Equations |
| **Cadets' reading** | Cengage 34.1, 39.2, 39.4 |
| **Probe topics** | 4 · ~2 active min each · ~10 min |
| **Checks** | `check_artifact.py` **47 passed / 0 failed** (37 base + 10 `--forbid` guards proving no lesson-26 slug stem, slug suffix, component name, objective key, source filename or Volume 2 reference survived the rebase). Pure CRLF (3315/3315), 0 NUL bytes |
| **Status** | **PUBLISHED 2026-08-05** — reviewed the same day and accepted unchanged, all four objectives. Not registered, no prefill link yet |

**Objectives chosen** (baked in; changing one is a rebuild, and a rebuild mints a *new* slug):

| # | key | label |
|---|---|---|
| 1 | `classical-wave-failure` | Three facts the wave picture cannot produce |
| 2 | `photon-energy-balance` | K_max = hf - phi, and where the cut-off comes from |
| 3 | `matter-wave-lambda` | lambda = h/p, and why only small things diffract |
| 4 | `wave-particle-duality` | What duality claims, and what it does not |

> **⚠ SCOPING WAS THE HARD PART OF THIS BUILD AND IT IS WORSE HERE THAN ANYWHERE ELSE IN THE COURSE.**
> The grounding spans **five sections across two chapters** and prints **fourteen learning
> objectives** — the widest span of any lesson in PHYS 215, wider than lesson 26's nine. No set of
> four probe topics can leave every printed objective probed and **the artifact does not claim it
> does.** The rule applied instead is **the lesson's own topic text**: "Photoelectric Effect,
> Wave/Particle" names two things with equal billing, so topics 1–2 are the photoelectric effect and
> topics 3–4 are wave-particle. Within each pair the split is problem-then-resolution, which is the
> order the source itself uses. Five was considered and rejected: the cadet-facing card promises
> "about 10 minutes" and 5 × ~2 min overshoots it. **All six pacing strings were grepped and
> confirmed to say 2** — the constant, the `time_budget` block, the PACING opener, the probing
> instruction, *"about its 2 min budget"*, and *"its full ~2 min"*, the sixth one the run's header
> comments used to call five.

> **⚠ WHAT THAT COSTS: four bodies of fully-transcribed material are ENGAGE-ONLY.** Each is genuinely
> Tier-1; the tutor engages fully and confidently if a cadet raises any of them, and never initiates,
> sets exercises on, or reports on them.
> - **Blackbody radiation** (§6.1 in full — Wien, Stefan, Rayleigh–Jeans, the ultraviolet
>   catastrophe, `E_n = nhf`, Planck's radiation law, four worked Examples). Given up because **the
>   lesson is not named after it** — it is the prologue, not the subject. The one load-bearing piece,
>   that Planck introduced *h* and quantized an energy exchange, lives inside topic 2 as the thing
>   Einstein extended.
> - **The de Broglie → Bohr derivation** (`2πr_n = nλ` ⟹ `L_n = nħ`), a printed learning objective.
>   Given up **because the source for Bohr's model is missing** — the derivation points at an
>   equation on a page this course does not have, so a cadet who follows it ends up asking about
>   material the tutor is forbidden to state.
> - **Electron microscopy** (TEM/SEM/ETEM, energies, resolving powers), also a printed objective.
>   Given up as **application rather than principle** — everything conceptual in it is already inside
>   topic 3's `λ = h/p`. It is also the best lateral connection available today and will likely come
>   up on its own.
> - **The Heisenberg uncertainty principle** (`Δx Δp ≥ ħ/2`, wave packets, `ΔE Δt ≥ ħ/2`, two worked
>   Examples, transcribed from **two** separate places in the grounding). Given up as **the next
>   course's subject** — developing it needs the wave-function machinery the missing pages contain.

**Extension problems:** A **one metal plate and every knob on it** — zinc's cut-off frequency and
wavelength, 200 nm photoelectrons, then doubling the intensity, then 300 nm, then *"use a brighter
300 nm lamp"* (approachable, **Pass 2 reaches λ_c from `c/f_c` with no `hc` at all, so it confirms
`f_c` and the value of `hc` in one stroke**) · B **two metals, one graph, and h measured from
scratch** — Na and Pt cut-offs, 250 nm on both, the parallel-lines question, and then **Planck's
constant and φ determined from two stopping-potential readings alone** (standard, **Pass 2 does (d)
entirely in wavelength with no frequency computed: two readings give φ = 4.70 eV twice, and the
agreement is itself the check**; part (e) asks what you *cannot* conclude — the data cannot separate
copper at 4.70 from silver at 4.73) · C **the wavelength of everything** — a baseball, a 100 V
electron, the 10²⁴ ratio and where it comes from, what obstacle spacing each would need, and **how
slowly the baseball must move for λ = 1 Å** (standard, **Pass 2 gets the electron entirely in SI and
gets (c) by inspection from the momentum ratio before any calculator is touched**; the ball takes
~500,000 ages of the universe to cross a room) · D **one electron at a time** — a 1000 V electron
through 400 nm slits, the 48.5 µm fringe, then **the same slits with 500 nm light, where
sin θ = 1.25 and no first order exists**, then the screen after 10 / 10⁴ / 10⁷ single electrons, then
*"each electron splits in half"* (challenging, **Pass 2 gets λ by scaling off problem C — `λ ∝ 1/√K`,
so ten times the voltage is `0.1227/√10` — with every constant cancelled**) · E **a photon and an
electron matched two different ways** — same wavelength, then same energy, then **why one ratio is
the square of the other** (`642 = √412097`, because `E ∝ 1/λ` for a photon and `K ∝ 1/λ²` for a slow
electron), and finally **the defect repair** (challenging). Every number computed and independently
re-checked in Python.

**Transcribed off 150-dpi rasters of all 31 pages, three regions re-rendered at 400–500 dpi to read
the defective lines character by character:** 32 numbered equations (6.1–6.16, 6.51–6.63, 7.14–7.16)
plus ~12 unnumbered displays, 19 figures (6.2–6.10, 6.18–6.26, 7.9), **Table 6.1 of work functions
in full** (Na 2.46, Al 4.08, Pb 4.14, Zn 4.31, Fe 4.50, Cu 4.70, Ag 4.73, Pt 6.35 eV), 15 worked
Examples (6.1–6.7, 6.11–6.16, 7.5–7.6), and **11 unanswered Check Your Understanding prompts**.

> **⚠ THE GAP BETWEEN THE TWO PDFs IS THE LARGEST IN THE COURSE, IT IS REAL, AND TODAY'S MATERIAL
> CITES IT FOUR TIMES.**
> - **Printed pp. 246–258 are absent — §6.3 The Compton Effect and §6.4 Bohr's Model of the Hydrogen
>   Atom, in full.** Thirteen pages. **Verified rather than assumed:** every PDF in
>   `textbook-pdfs/phys-215/` was opened and its printed folio run read off the page footers; no file
>   anywhere covers Vol. 3 pp. 246–258. (`Gauss's Law and Its Applications.pdf` also runs 228–245 —
>   that is **not** an overlap, those are Volume 2 folios.) Gone with them: equations 6.17–6.50,
>   figures 6.11–6.17, Examples 6.8–6.10, CYU 6.8–6.9.
> - **Today's material leans on the gap in both directions.** §6.5 opens by saying Compton's formula
>   established that an EM wave can behave like a particle; it says the de Broglie relations were
>   "discussed for photons in the context of Compton's effect"; §6.6 says the electron is a particle
>   in Compton scattering; and the standing-wave derivation points at **"Equation 6.36"** for Bohr's
>   quantization condition and **"Equation 6.38"** for the Bohr radius. **None of those is on any page
>   here.** `GAPS IN THE SOURCE` records each citation and **forbids the tutor from stating the
>   Compton shift formula, the Compton wavelength, the Bohr energy-level formula, or the numerical
>   value of the hydrogen ionization limit.** What it may use: the *conclusion* that Compton showed
>   light behaving as a particle; the printed `a_0 = 0.529 Å`; and the two hydrogen-like-ion relations
>   that survive on the second file's first page, where `E_0` is described only as "the ionization
>   limit of a hydrogen atom" and **never given a value.**
> - **THE DIRECTION OF THE BOHR ARGUMENT IS EXPLICIT IN THE SOURCE AND IS EASY TO GET BACKWARDS.**
>   Bohr **postulated** quantized angular momentum; de Broglie **explained** the postulate
>   (`2πr_n = 2n·λ/2` ⟹ `p = nħ/r_n` ⟹ `L_n = nħ`); and the source offers *the fact that it can be
>   explained* as "a convincing theoretical argument for the existence of matter waves." So the
>   inference runs **de Broglie → Bohr's postulate → evidence for matter waves.** The scope note and
>   the header comment both say this in as many words.
> - **Second gap, inside file 2: printed pp. 272–296.** Chapter 6's end matter, the chapter 7 opener,
>   **§7.1 Wave Functions in full**, and the opening of §7.2. **Confirmed at the footers:** p. 271 and
>   p. 297 both carry a recto-style footer with no *"Access for free at openstax.org"* line, and two
>   consecutive rectos cannot be adjacent pages. Consequence recorded: the statistical interpretation
>   is *asserted* on these pages and never developed, so the tutor may say a particle's wave carries
>   information about **probable positions** and may not write a normalization condition, a
>   probability integral, or the Schrödinger equation.
> - **File 2 also stops mid-section at p. 300**, partway through §7.2's energy-time subsection.
> - **Edges.** p. 232 opens exactly at the §6.1 heading. p. 245 closes cleanly at the end of §6.2.
>   **p. 259 opens mid-§6.4** — on the Significance of a hydrogen-spectral-line Example — **but §6.5
>   itself begins two-thirds down that same page**, so the section the lesson actually needs is whole.
>   *(Correction to the run brief, which described file 2 as starting with §6.5 already under way and
>   put its second block at 296/297–299: the second block is **297–300**, and §6.5 starts clean.)*
>   p. 271 closes cleanly at the end of §6.6. p. 297 opens mid-§7.1 with §7.2 beginning on the same
>   page.

> **⚠ FOUR CROSS-CHECKS, AND AT THE SECOND SEAM TWO OF THEM ARE BLIND.** Within each block every
> sequence is unbroken — block A folios 232–245 / eq 6.1–6.16 / fig 6.2–6.10 / Ex 6.1–6.7 / CYU
> 6.1–6.7; block B folios 259–271 / eq 6.51–6.63 / fig 6.18–6.26 / Ex 6.11–6.16 / CYU 6.10–6.15;
> block C folios 297–300 / eq 7.14–7.16 / fig 7.9 / Ex 7.5–7.6. **Across the first seam all four
> agree**, which is what a thirteen-page excision looks like. **Across the second seam the equation
> and figure sequences see nothing at all, because a new chapter restarts the numbering at 7.x** —
> only the folio run detects it. Add this to the run's list of blind-check cases (lesson 24's
> equations, lesson 25's from the other side, lesson 26's Check-Your-Understanding). **Never require
> all four sequences to agree before believing in a gap; the folio run is the authority.**

**Source defects found — three real, each verified two ways, plus three benign inconsistencies:**

1. **⚠ THE HEADLINE ONE, and it is a genuine wrong number.** The relativistic-proton Example
   computes `λ = 1.16 fm` for a proton at 0.75*c*. Its **Significance** then rescales to an electron
   as **"(1835)0.77 fm = 1.4 pm"** — using `0.77 fm`, a number that **appears nowhere in the solution
   above it.** *Verified two ways:* (a) internally, `1835 × 1.16 fm = 2.13 pm`, not 1.4 pm; (b)
   independently, at the same speed so `βγ = 1.134` is unchanged,
   `λ_e = hc/(βγE₀) = 1.241 eV·µm / (1.134 × 0.511 MeV) = 2.14 pm`. **The correct answer is ≈2.14 pm.**
   The kinetic-energy half of the same sentence (`480.1 MeV/1835 = 261.6 keV`) is right. **Extension
   problem E part (d) exists to repair this**, and the artifact instructs the tutor that a cadet
   quoting 1.4 pm **has read their book correctly**.
2. **A wrong equation cross-reference.** The violet-light-on-calcium Example's Strategy says *"to
   obtain the maximum energy of the ejected electrons, we use Equation 6.16"* — but 6.16 is the
   **cut-off wavelength** `λ_c = hc/φ`. The relation it uses, and the right one, is 6.14,
   `K_max = hf − φ`. Arithmetic correct throughout. **Internal-only** (the tutor never quotes an
   equation number to a cadet) but recorded because this source's cross-references are not reliable.
3. **A dropped factor of two**, in the engage-only uncertainty Example. It writes the ground-state
   energy as `p̄²/m` and immediately equates that to `σ_p²/(2m)`; since `p̄ = 0`, `σ_p² = p̄²`, so the
   two differ by a factor of two. A nonrelativistic kinetic energy is `p²/(2m)`, never `p²/m`.
   Everything downstream, including `ħ²/(8mL²)` and the 0.952 eV, is right.
4. **Benign — `hc` is printed two ways:** `1240 eV·nm` in the photoelectric section and
   `1.241 eV·µm` in the matter-wave sections. Same constant to 0.08%; the book's own
   `h = 4.136×10⁻¹⁵ eV·s` implies 1240. A cadet computing with one and comparing to a book answer
   printed from the other sees a last-digit disagreement **that is not their mistake.**
5. **Benign — two printed results are truncated, not rounded:** `(2.15 Å)sin50° = 1.647` printed as
   1.64, and `1.241/(1.134×938) = 1.167 fm` printed as 1.16. The reference tells the tutor to accept
   either digit.
6. **Benign but worth knowing — `φ` carries two meanings in this source.** In the photoelectric
   material it is the **work function** (eV); in the Davisson–Germer material it is the **scattering
   angle** (degrees). The two never share a page and the source gives no warning. Recorded as a
   caveat so the tutor knows whose fault a cadet's confusion is.

**Every other printed number in both files reproduces exactly.** All of them were recomputed: both
blackbody star Examples (incl. the 4820 ratio and both `P/A` figures), both Planck-oscillator
Examples, the silver threshold (262 nm) and its sodium counterpart (504 nm), the unknown-metal work
function (6.09 eV) and cut-off (1.47×10¹⁵ Hz), the calcium Example (2.88 → 0.17 eV), all four de
Broglie Examples including the basketball (1.02×10⁻³⁴ m), the Davisson–Germer wavelength **both
ways** (1.64 Å from the angle, 1.67 Å from the momentum), the neutron-scattering energies (82.7 vs
38.8 meV), the electron double-slit angle (0.010°), the electron-microscope resolving power
(3.50×10⁻⁵ deg vs 14°), and both uncertainty Examples (5.8 cm, 8.8×10⁻³³ m, 0.952 eV). **Apart from
defect 1 there is no arithmetic error in either file.**

**Open questions for recker:**

1. **The lesson-41 slug carries "41", and this is the last lesson of the course.** Nothing downstream
   depends on it, but the number is baked into the slug, header, `lesson_id`, filename and component
   name as usual. If the Fall 2026 schedule is renumbered before publication, this artifact must be
   rebuilt (and will mint a new suffix).
2. **Is the four-topic split along the title the right call?** The alternative considered was three
   photoelectric topics plus one wave/particle — closer to the run brief's suggested shape, and
   closer to the balance of *printed* material, but it makes the wave/particle half a single
   drop-candidate topic on a lesson whose own title gives it equal billing. **Two-and-two was chosen;
   the reasoning is written into `LESSON_CONFIG`'s "NOTE ON WHY FOUR" so it can be overturned in one
   line.**
3. **The uncertainty principle appears in *two* places in the grounding** — as `Equation 6.63` at the
   end of §6.6 and as `Equation 7.15` in §7.2 — and is engage-only in both. If the department wants
   it probed, it would displace topic 4 (duality) rather than being added as a fifth.
4. **The tutor is told not to say "later in the course."** This is lesson 41; there is no later. The
   scope note instructs it to say "a later course" or "next semester" instead. Flagged because it is
   the only artifact in the run where that phrasing is wrong.

---

## Queue — the current run (opened 2026-08-04)

Seven lessons: everything still unbuilt that is not already done outside this repository, not
deferred, not a lab, not a Graded Review, and not behind the lesson 30–41 question. Each row's
grounding PDF lives in `Core_Preflights/textbook-pdfs/phys-215/`.

| Lsn | Topic | Reading (Cengage) | Grounding PDF | Status |
|----:|---|---|---|---|
| 21 | Sources of Magnetic Fields | 29.1–29.2 | `Sources of Magnetic Fields.pdf` | **built** (DRAFT) |
| 22 | Ampère's Law, Gauss's Law in Magnetism | 29.3–29.5 | `Ampere's Law, Gauss's Law in Magnetism.pdf` | **built** (DRAFT) |
| 24 | Faraday's Law of Induction, Motional EMF | 30.1–30.2 | `Faraday's Law of Induction, Motional EMF.pdf` | **built** (DRAFT) |
| 25 | Lenz's Law, Induced Electric Field | 30.3–30.4 | `Lenz's Law, Induced Electric Field.pdf` — **holds the four pages lesson 24's source is missing; see below** | **built** (DRAFT) |
| 26 | Generators and Motors, AC, Transformers | 30.5, 32.1-2, 32.8 | `Generators and Motors, AC, Transformers.pdf` — **three disjoint blocks across two chapters; see below** | **built** (DRAFT) |
| 28 | Displacement Current | 33.1–33.2 | `Displacement Current.pdf` — **byte-identical to lesson 29's; see below** | **built** (DRAFT) |
| 29 | Maxwell's Equations | 33.2 | `Maxwell's Equations.pdf` — **byte-identical to lesson 28's. Built from the seam table in lesson 28's section** | **built** (DRAFT) |

**This table is now fully built out, and the run is closed.** Nothing in this course is queued.

### Lessons 24 and 25 tile one chapter — both are now built, and the tiling held

Found during the lesson 24 build on 2026-08-05 and verified by opening both PDFs. **Re-verified
independently during the lesson 25 build the same day**, by rendering and reading both files rather
than trusting this table — the claim held exactly, in every particular. OpenStax chapter 13
*Electromagnetic Induction* is split across the two grounding files with **no overlap and no gap**:

| lesson | grounding PDF holds | sections |
|---|---|---|
| 24 | printed pp. **546–549** and **554–561** | §13.1 Faraday's Law · the tail of §13.2's last example · §13.3 Motional Emf |
| 25 | printed pp. **550–553** and **562–565** | §13.2 Lenz's Law · §13.4 Induced Electric Fields |

**Three consequences for the lesson 25 build:**

- **Lesson 25 holds the statement of an example whose answer lesson 24 already used.** The
  solenoid-and-ring Example 13.3 is cut at the 553/554 seam: 25 has the statement, Strategy and first
  solution step; 24 has the last two arithmetic lines and the Significance. Lesson 24 records it as a
  gap and forbids presenting it as self-contained. **Lesson 25 has the opposite problem** — a
  statement whose answer is on a page it does not have.
- **Lesson 24 deliberately left the whole sign to lesson 25** and probes magnitude only. No objective
  key in lesson 24 touches direction, so **nothing is duplicated by making Lenz's law the core of
  25** — that is the intended division. What lesson 24 *did* use, because it is printed on its own
  pages, is the unnamed opposition argument inside Example 13.5(a); lesson 25 will find the same
  reasoning stated as a rule.
- **Do not check for an interior hole by equation number in this chapter.** §13.2 contains no numbered
  equation, so lesson 24's four-page hole is invisible to that cross-check and visible to the other
  four. Lesson 25's own source should be checked on folios, Examples, Check Your Understanding
  prompts *and* Figures. **Done, and the equation check was blind from that side too:** lesson 25's
  first block carries no numbered equation at all, so the first one anywhere in that file is 13.9, on
  its fifth page, with nothing before it to compare. Four checks agreed; the fifth had nothing to say.

**All three consequences landed as predicted, and lesson 25 is built.** Nothing in the handoff had to
be revised.

### Lesson 26's source is three blocks across two chapters, and the pages between them are gone

Found and verified during the lesson 26 build on 2026-08-05 by rendering all seventeen pages.
`Generators and Motors, AC, Transformers.pdf` holds **printed pp. 570–575, 624–630 and 645–648** — one
block per assigned Cengage group, with no interior hole in any block.

| block | printed pages | OpenStax | cadets' Cengage |
|---|---|---|---|
| 1 | 570–575 | §13.6 Electric Generators and Back Emf | 30.5 |
| 2 | 624–630 | §15.1 AC Sources · §15.2 Simple AC Circuits | 32.1–32.2 |
| 3 | 645–648 | §15.6 Transformers | 32.8 |

**The difference from the 24/25 pair matters: nothing else in this corpus holds the excised pages.**
Absent everywhere in this run — **§13.5 Eddy Currents (pp. 566–569**, exactly the four pages between
where lesson 25 stops and lesson 26 starts**)**, §13.7, **the whole of chapter 14 on inductance**, and
**pp. 631–644 = §15.3 RLC Series Circuits, §15.4 Power in an AC Circuit, §15.5 Resonance.** The
artifact's `GAPS IN THE SOURCE` block names each one and forbids treating any of it as today's
material. Eddy currents in particular are *named twice* in the pages we do have and explained on none
of them — the same shape of hole as lesson 16, one section wide instead of one lesson wide.

**And the blind cross-check moved again.** Lesson 24's four-page hole was invisible to the equation
sequence; lesson 25's was invisible to it from the other side; **lesson 26's first seam is invisible to
the Check Your Understanding sequence, because its first block prints no such prompt at all.** Three
lessons, three different sequences blind. **Run all four and treat the folio sequence as the
authority.**

### Lessons 28 and 29 share one 6-page source — scope them by content, not by file

Found during the lesson 21 build and verified independently on 2026-08-04: `Displacement Current.pdf`
and `Maxwell's Equations.pdf` are **the same file**. Identical SHA-256, identical 3,803,535 bytes,
both 6 pages, both opening at OpenStax **§16.1 *Maxwell's Equations and Electromagnetic Waves*** and
ending on the same sentence. This is the second such pair in the corpus after
`Vector Form of Coulomb's Law.pdf`, so it is a **property of this corpus rather than a one-off** —
never infer a distinct source from a distinct filename here.

**The queue table above was wrong to imply two sources, and the chapter seam is nonetheless sound:**
§16.1 is lessons 28 and 29; `Electromagnetic Waves, EM Spectrum.pdf` picks up at §16.2 for lesson 30.
The cadets' own reading splits the same way — Cengage 33.2 appears in *both* lessons' Reading column,
so the course itself treats these as one body of material taught twice over.

**What this means for the two builds.** Six pages is thin for two ~10-minute sessions, and building
both from the whole file would produce two artifacts probing the same material. Scope them
deliberately and record the split in both rows:

- **Lesson 28** — the displacement-current term itself: what Ampère's law is missing, the capacitor
  argument that reveals it, and the Ampère-Maxwell law that results.
- **Lesson 29** — the four equations as a *set*: what each one asserts, and the wave prediction that
  falls out of them together.

**Build 28 first and have it state where it stopped**, exactly as lesson 21 did for lesson 22. If
after reading the raster the source will not carry two distinct sessions, **stop and ask recker**
rather than padding one artifact or building two that overlap — a second source is recker's to supply.

> **RESOLVED 2026-08-05 by the lesson 28 build: six pages DOES carry both sessions, and no second
> source is needed.** The six pages are printed **pp. 658–663**, the whole of §16.1, contiguous and
> clean at both edges. **The section's own four printed learning objectives fall exactly on the agreed
> seam** — objective 1 ("explain Maxwell's correction of Ampère's law by including the displacement
> current") is lesson 28's entire assignment, and objectives 2, 3 and 4 (state and apply the four
> equations; the symmetry that predicts waves; Hertz's confirmation) are lesson 29's. That is the
> source dividing itself, not a division invented to make the split work.
>
> **The page-by-page seam, and the three warnings the lesson 29 build needs, are in the
> "What lesson 29 still has" subsection of lesson 28's section above. Read that instead of re-reading
> the PDF** — everything on lesson 29's side is already transcribed in lesson 28's grounding and
> scoped engage-only there, so a fresh read risks re-deriving a split that is already recorded.
>
> **The one asymmetry worth stating here too, because it changes how lesson 29 must be built:** the
> section's **only worked Example is consumed by lesson 28**. Lesson 29 has five equations, two figures
> and **no worked example at all**, so its extension problems have to be *constructed* rather than
> adapted. That is harder than any other build in this run and it is the main risk to that lesson —
> not a shortage of material, which it does not have.
>
> **BOTH LESSONS ARE NOW BUILT, 2026-08-05, and the split held.** Lesson 29 took objectives 2, 3 and
> 4 at four topics — **recker then dropped objective 4 on review the same day, so it ships at three;
> the seam below is unaffected, because the dropped material moved from probed to engage-only rather
> than to lesson 28** — lesson 28 took objective 1 at three, and **no material is probed twice** — the
> two artifacts share no objective key and the lesson 29 splice asserts mechanically that none of
> lesson 28's three key strings survived the rebase. Lesson 29 re-verified the shared source
> independently rather than taking the seam on trust: **same SHA-256, same byte count, all six pages
> re-rendered, all four cross-checks re-run, both edges re-confirmed.** The seam table below was
> accurate in every row.
>
> **Two things the lesson 29 build found that this section did not predict.** First, the "constructed
> extension problems" risk was **worse than described**: lesson 29's half contains **no numerical
> value at all**, not merely no worked example, so nothing whatever could be adapted. Second, and more
> useful, **there is a real error in lesson 29's half that lesson 28 transcribed without noticing** —
> the boxed panel states Gauss's law without its 1/ε₀. See lesson 29's section. The ambiguous symmetry
> clause lesson 28 flagged was also **ruled on there: not an error, and the page does settle it.**

### One corpus fact worth keeping from the cancelled lesson 2 run

**`Vector Form of Coulomb's Law.pdf` is a strict subset of `Electric Charge, Coulomb's Law.pdf`** —
its five pages are byte-identical to pages 10–14 of the larger file, printed pp. 179–183, §5.3.
Verified by comparing the extracted page text character for character on 2026-08-04.

Neither lesson is being built here, so this changes nothing today. It is recorded because **it means
the corpus contains overlapping files whose names suggest distinct sources**, and the next agent to
match a topic to a PDF by name alone could ground two different lessons in the same five pages
without noticing. Check for it when a lesson's PDF looks unexpectedly short.

### The lesson 30–41 question — the factual half is now answered

`PROJECT.md` §10 blocked lessons 30–41 on this: *"the profile names OpenStax University Physics
**Vol. 2**, but the course's last twelve lessons are optics and modern physics, which appear to be
**Volume 3**. Flagged from the table of contents' apparent scope; not verified."*

**Verified on 2026-08-04 by opening the PDFs and reading their first printed section heading:**

| grounding PDF | opens at | volume |
|---|---|---|
| `Sources of Magnetic Fields.pdf` (lesson 21) | §12.1 The Biot-Savart Law | Vol. 2 |
| `Electromagnetic Waves, EM Spectrum.pdf` (lesson 30) | §16.2 Plane Electromagnetic Waves | **Vol. 2** — its last chapter |
| `Light, Reflection, Refraction.pdf` (lesson 31) | §1.1 The Propagation of Light | **Vol. 3** |
| `Photoelectric Effect.pdf` (lesson 41) | §6.1 Blackbody Radiation | **Vol. 3** |

So the guess was right in substance and off by one lesson: **the Vol. 2 / Vol. 3 boundary falls
between lessons 30 and 31**, not at 30. The important part is what it does *not* mean — **there is no
missing source.** A topic-matched PDF is present in the corpus for every one of lessons 30–41. The
profile's "Vol. 2" is therefore *incomplete*, not wrong, and the fix is to name both volumes.

**This does not unblock the builds, and an agent must not read it as doing so.** `PROJECT.md` names
recker as the owner of that decision, and answering the question an owner was given is not the same
as making the call. What is now true is that the *stated reason* for the block — no confirmed
grounding source — no longer holds, so the decision can be made on its merits.

**Still unverified, and per-build work either way:** that each optics/modern PDF covers its lesson's
whole topic, and whether these carry the same mid-document holes two of the first twelve did. Neither
is answerable from a section heading.

---

## Queue — the first run (lessons 5–20, complete)

Kept as the record of what that run covered. The `Reading` column is **Cengage** numbering and cannot
be mapped onto OpenStax mechanically — attach the OpenStax chapter that covers the *topic* and
confirm by reading it (`COURSE_PROFILE.md` → "Grounding").

| Lsn | Topic | Reading (Cengage) | Grounding PDF | Status |
|----:|---|---|---|---|
| 5 | Charged Particles in Uniform Elec. Fields | 22.5 | `Charged Particles in Uniform Electric Fields.pdf` | **built** |
| 6 | *LAB: Quantized Charge* | — | — | **skipped (lab)** |
| 7 | Charge Distributions, Electric Flux | 23.1–23.2 | `Charge Distributions, Electric Flux.pdf` | **built** |
| 8 | Gauss's Law and Its Applications | 23.3–23.4 | `Gauss's Law and Its Applications.pdf` | **built** |
| 9 | Electric Potential Difference | 24.1–24.2 | `Electric Potential Difference.pdf` | **built** |
| 10 | Electric Potential, Potential Energy | 24.3–24.4, 24.6 | `Electric Potential, Potential Energy.pdf` | **built** |
| 11 | *LAB: Mapping Electric Potential* | — | — | **skipped (lab)** |
| 12 | *GRADED REVIEW 1* | — | — | **skipped (`PF=N`)** |
| 13 | Capacitance, Energy, and Dielectrics | 25.1–2, 25.4–5 | `Capacitance, Energy, and Dielectrics.pdf` | **built** |
| 14 | Current, Resistance, and Electrical Power | 26.1–26.2, 26.6 | `Current, Resistance, and Electrical Power.pdf` | **built** |
| 15 | DC Circuit Analysis, Kirchhoff's Rules | 27.1–27.3 | `DC Circuit Analysis, Kirchhoff's Rules.pdf` | **built** |
| 16 | RC Circuits | 27.4 | **no grounding source anywhere in the corpus** — confirmed | **deferred (recker)** |
| 17 | *LAB: Building DC Circuits* | — | — | **skipped (lab)** |
| 18 | Moving Charged Particle in a Magnetic Field | 28.1–28.2 | `Moving Charged Particle in a Magnetic Field.pdf` | **built** |
| 19 | Magnetic Force on Current-carrying Wires | 28.3–28.4 | `Magnetic Force on Current-carrying Wires.pdf` | **built** |
| 20 | Magnetic Dipoles and Torque | 28.5 | `Torque on a Current Loop.pdf` (name differs from the topic — **checked, it is the right section**) | **built** |

**Lesson 16 is deferred by recker (2026-08-04):** *"16 is a new topic this semester, don't worry
about it yet."* It has no `RC Circuits.pdf` in the corpus, and it is skipped for this run rather than
built.

**The open question about it is now closed, and the answer is the unhelpful one.** The lesson 15
build read `DC Circuit Analysis, Kirchhoff's Rules.pdf` end to end: it stops inside OpenStax §10.3's
"Multiple Voltage Sources" subsection on printed p. 436, and **RC circuits, measuring instruments and
household wiring are all absent.** So that PDF does *not* span the chapter, and **lesson 16 has no
grounding source anywhere in this corpus.** When it is picked up it is **blocked on recker** for a
source rather than built from model knowledge — PHYS 310's reconstruct-and-review exception is scoped
to PHYS 310 and must not be
borrowed ([`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../../docs/decisions/PHYS310-MURRAY-GROUNDING.md)).

---

## Cross-cutting fixes applied to every artifact above

**2026-08-04 — the per-topic budget prose said 3 minutes while the number said 2.** The tutor system
prompt carried *"about 3 active minutes each"*, *"a soft budget of about 3 MINUTES"*, and *"its full
~3 min"* — three PHYS 310 values (3 topics × ~3 min) that rode into PHYS 215 through the structural
base. Meanwhile `PER_TOPIC_BUDGET_MIN = 2.0`, the runtime pacing note injected into every cadet turn
interpolates that 2.0, and `LESSON_CONFIG`'s `time_budget` says ~2. **The tutor was being told 3 and
2 in the same prompt**, and 4 topics × 3 min overshoots the ~10-minute target the same prompt states.
All twelve strings (3 per artifact × 4 artifacts) were changed to 2; PHYS 310's own artifact is
untouched, because 3 minutes is correct there. All four re-verified at 37/37.

**2026-08-04, later — the same contradiction, re-opened by the review and closed the same way.**
Dropping objective 4 from lessons 13, 15 and 20 left them at 3 topics × ~2 min = ~6 min against a
cadet-facing header that still promises "about 10 minutes" and a `time_budget` block that still
states a "~10 active minutes" core target. **A shorter session was not what recker asked for** — one
objective was dropped, not a third of the session — so the per-topic budget widened to ~3 min in
those three artifacts: `PER_TOPIC_BUDGET_MIN`, the `time_budget` block, the PACING sentence in the
tutor prompt, and the constants' own comments, all moved together so nothing tells the tutor two
numbers at once. That is the same failure mode as the fix above, which is why it was chased in the
same pass. **Lesson 5 is untouched here** — it kept four topics, so 4 × ~2 still holds.

**2026-08-04, later still — a FOURTH pacing string was missed, and it is in all thirteen earlier
artifacts. Found during the lesson 22 build; NOT fixed anywhere but lesson 22.** The fix above chased
three strings per artifact. There is a fourth, in the PACING block of the tutor prompt:

```
When a topic has had about its 3 min budget of active discussion, do NOT silently cut it off
```

`grep -c "its 3 min budget"` returns **1 in every one of the thirteen `.jsx` files** — lessons 4, 5,
7, 8, 9, 10, 13, 14, 15, 18, 19, 20 and 21. For **lessons 13, 15 and 20 it is correct**, because
recker's review moved those to 3 topics × ~3 min. For the other **ten it contradicts everything else
in the same prompt**: `PER_TOPIC_BUDGET_MIN = 2.0`, the runtime pacing note that interpolates it, the
`time_budget` block, the PACING opener (*"a soft budget of about 2 MINUTES"*) and the probing
instruction (*"about 2 active minutes each"*) all say 2, and this one line says 3 — **thirteen lines
below the opener that contradicts it.**

**Lesson 22 was built with it set to 2**, so it is internally consistent. **Nothing else was
touched** by that build, deliberately: twelve of the thirteen are *published*, and editing this
repository does not change a published artifact (`PROJECT.md` §4) — a rebuild would mint a new slug
and a new lesson row, which is not a trade worth making for one word. The practical effect on the
remaining nine is bounded: the tutor is told 2 in five places and 3 in one, and the pacing note
injected on every cadet turn says 2.

**Resolved for lesson 21 the same day; still open for the nine published ones.** The claim was
re-verified independently across all fifteen artifacts by printing the string and
`PER_TOPIC_BUDGET_MIN` side by side: it is `3` in every file except lesson 22, which makes it
**correct** in lessons 13, 15 and 20 and in PHYS 310's artifact (all `3.0`) and **wrong** in lessons
4, 5, 7, 8, 9, 10, 14, 18, 19 and 21 (all `2.0`). **Lesson 21 was fixed in place** — one line,
re-verified 37/37 — because it is an unpublished draft *this run produced*, and shipping a known
internal contradiction in an artifact built the same hour is not a scope boundary worth respecting.

**The nine published ones are recker's call, and the cost is asymmetric.** Fixing them means
republishing, which means a new artifact URL per lesson and re-registering each — for one word, in a
prompt that states the correct number five other times. **The recommendation is to leave them and fix
the base**, so it stops propagating: the string rides in from the structural base artifact, which is
how it reached fourteen files without being written fourteen times.

**Re-audited across all sixteen artifacts on 2026-08-05, after lesson 25.** The current state, from
printing the string and `PER_TOPIC_BUDGET_MIN` side by side in every file: **the four unpublished
drafts this run produced — 21, 22, 24 and 25 — all say `2` in both places and are internally
consistent**; lessons 13, 15 and 20 say `3` in both and are correct; and the nine published ones —
4, 5, 7, 8, 9, 10, 14, 18 and 19 — still say `2.0` against *"its 3 min budget"*. Nothing was touched
outside the artifact being built, deliberately: those nine are published, and editing this repository
does not change a published artifact (`PROJECT.md` §4).

**Lesson 26 joins the consistent set, 2026-08-05.** All five pacing strings were grepped in the
finished file and all five say 2 — `PER_TOPIC_BUDGET_MIN = 2.0`, the `time_budget` block, the PACING
opener, the probing instruction, and the PACING line *"about its 2 min budget"*. **Five unpublished
drafts this run produced are now internally consistent; the nine published ones are unchanged and are
still recker's call.**

**Lesson 28 joins it too, 2026-08-05, at a different number — and that is the point.** This is the
first artifact in the run built at **3 topics × ~3 min from the start** rather than widened afterwards
on review, so it is the first test of whether the five strings move together when the number is not the
inherited one. They did: all five were grepped in the finished file and all five say **3** —
`PER_TOPIC_BUDGET_MIN = 3.0`, the `time_budget` block, the PACING opener (*"a soft budget of about 3
MINUTES"*), the probing instruction (*"about 3 active minutes each"*), and the PACING line (*"about its
3 min budget"*), the one that was wrong in ten earlier artifacts. **Six unpublished drafts this run
produced are now internally consistent — 21, 22, 24, 25 and 26 at 2, and 28 at 3 — and the nine
published ones are still unchanged and still recker's call.**

**Lesson 29 closes the run, back at 2, and it moved the number in the other direction.** Lesson 28
was the first build to set the five strings to 3 from the start; lesson 29 is built on lesson 28 and
therefore had to move **all five back down to 2** together, which is the first time in this course
the pacing number has been changed *downward* during a build rather than widened afterwards on
review. The splice asserts each substitution's expected count before making it, and all five were
then grepped in the finished file: `PER_TOPIC_BUDGET_MIN = 2.0`, the `time_budget` block, the PACING
opener (*"a soft budget of about 2 MINUTES"*), the probing instruction (*"about 2 active minutes
each"*), and the PACING line (*"about its 2 min budget"*). A sixth string, *"its full ~2 min"*, moved
with them. **Seven unpublished drafts this run produced are now internally consistent — 21, 22, 24,
25, 26 and 29 at 2, and 28 at 3 — and the nine published ones are unchanged and still recker's call.**

**The count is now settled enough to state plainly: the string is correct in every artifact this run
produced and wrong in exactly nine, all of them published.** The recommendation has not changed —
leave them and fix the base — but the base is the thing that keeps propagating it, and every build in
this run has had to catch it by hand.

---

## Before a cadet is pointed at any of these

**All twelve are published, so the remaining risk is no longer whether an artifact builds — it is
whether a completed session reaches anything.** Two profile items are still unconfirmed, and both are
cheap to check and expensive to get wrong:

1. **`course_id: phys-215` must exist on the DFPM receiver.** A wrong or unregistered id fails
   **silently** — the cadet completes the session, sees a success page, and the work reaches nothing.
   There is no acknowledgement hop.
2. **`grade_weight_note` = "under 80 of 1000 course points"** is inherited from the pilot verbatim and
   reaches cadet-facing prose. Confirm it is still the Fall 2026 figure.

And the standing one: **submit one throwaway session end to end and confirm a grade was written from
`d.effort`**, not merely that a report arrived (`CORE.md` §8, `OPEN_ISSUES.md` §1). No `d` payload
from this repository has ever reached the receiver.
