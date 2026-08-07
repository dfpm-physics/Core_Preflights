# Murray & Holbert — reconstructed grounding corpus (PHYS 310)

**Source:** Murray & Holbert, *Nuclear Energy: An Introduction to Concepts, Systems, and
Applications of Nuclear Processes*, 8th ed. — the text PHYS 310 cadets read.

**What this is.** The grounding reference for every PHYS 310 preflight, covering the Murray sections
named in [`../phys310_fall2026_schedule.md`](../phys310_fall2026_schedule.md). It is **reconstructed
from model knowledge**, not extracted from a PDF — there is no PDF of Murray and there will not be
one. Reasoning, alternatives, and costs:
[`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../../docs/decisions/PHYS310-MURRAY-GROUNDING.md).

**Never surfaced to a cadet.** The tutor grounds its correctness here and cites nothing — no section
numbers, no page numbers, no "the reading says." Section headings below are internal tags.

---

## The review gate

> ### ⚠ LIFTED by recker on 2026-08-05 — read this before acting on the rule below
>
> *"Assume the grounding for 310 is correct and we can fix objectives and grounding later if we need
> to."* Every remaining PHYS 310 preflight was built that day against **unreviewed** sections of this
> file.
>
> **The status lines below were deliberately NOT flipped to REVIEWED.** Fifty-six of fifty-nine are
> still `STATUS: PENDING`, and they are telling the truth: **the lift granted permission to build, not
> an attestation that the physics is right.** Flipping them would have made the `grep` come out clean
> at the cost of destroying the only record of which sections a human has actually read against the
> book — trading the signal for the appearance of the signal.
>
> **The review is still owed.** What changed is that it is now owed against sixteen concrete drafts
> instead of against an empty directory, and every one of them is enumerated in
> [`../artifacts/BUILD-LOG.md`](../artifacts/BUILD-LOG.md). **Reviewing a section still means editing
> it here and flipping its own status line** — the artifacts built from it do not update themselves,
> and correcting one after publication is a republish and a new lesson row (contract §3.2).

**A lesson is not buildable while any of its sections is `STATUS: PENDING`.** *(The rule as written
before the lift above. Kept verbatim rather than rewritten, because it is the rule that returns the
moment this build run is over.)*

recker reviews section by section against a physical copy. When a section is approved, its status
line changes to `STATUS: REVIEWED <date>`. If a lesson is requested and one of its sections is still
pending, **the agent stops and asks for that review first** — it does not build, and it does not
substitute its own judgment for the review.

```bash
F=courses/phys-310/texts/MURRAY-GROUNDING.md
grep -c '^\*\*STATUS: PENDING\*\*' "$F"    # how many are left
grep -n  '^\*\*STATUS: PENDING\*\*' "$F"   # which ones
grep -c  '^## §' "$F"                      # total sections; the two must sum with REVIEWED
```

**Anchor the pattern to the start of the line.** A bare `grep -c "STATUS: PENDING"` also matches this
section's own prose and the example commands above, overcounting by four — a checker that is wrong
about its own file is worse than no checker.

The two tokens are `STATUS: REVIEWED` and `STATUS: PENDING`, chosen so **neither is a substring of
the other**. `grep REVIEWED` matches both and would silently report every pending section as done.

## Coverage

**59 sections · 14 chapters · 17 preflight lessons.** Reviewed counts as of the last edit:

| chapters | lessons | sections | reconstruction confidence |
|---|---|---:|---|
| **2, 3, 4, 5** | 2, 3, 4, 6, 8, 9, 10, 13, 14 | 22 | **strong** — formula-dense core physics, full DOE cross-check |
| **6, 7, 16** | 24, 25, 26 | 12 | **strong** on 6 and 16 (DOE covers reactor physics well); **reduced** on 7 (no DOE) |
| **10, 11, 12** | 14, 15, 18, 19 | 13 | **good** on physics, **less certain** on Murray's organization |
| **15, 18, 21, 23** | 31, 32 | 12 | **weakest** — applied and descriptive; **no DOE cross-check at all** for 15, 21, 23 |

**Review chapters 2–7 first.** They ground the most lessons, reconstruct most reliably, and their
review will tell you whether this approach is sound before you spend attention on the back half.

## How to review a section

Each entry is split by confidence, because the risk is not uniform:

- **Physics** — constants, formulas, relationships, definitions. Known independently of Murray and
  cross-checked against DOE-HDBK-1019 where it covers the topic. **Skim this.**
- **Flags** — section titles, page numbers, worked-example specifics, notation choices, and section
  *boundaries*. **Read this against the book.** This is where a model confabulates.

**A note on section boundaries, stated once and true throughout.** The schedule assigns *ranges*
(`4.1–4.4`), and the individual section splits below are inferred from the range plus the lesson
topic — not recalled. Content may sit one section either side of where it is filed. **The physics
for the range is what grounds the tutor**, so a misfiled subsection is cosmetic; a wrong constant is
not. Review accordingly.

**Confidence is not flat across this book.** Chapters 2–7 are formula-dense core nuclear physics and
reconstruct strongly. Chapters 10–12 are solid on physics, less certain on organization. **Chapters
15, 18, 21, and 23 are the weakest** — applied and descriptive material where Murray's particular
framing matters and DOE offers little or no cross-check. Those entries say so individually.

---

# Chapter 2 — Atoms and Nuclei

## §2.1 — Atomic Theory

**STATUS: REVIEWED 2026-07-31** · Lesson 2 — Energy, Atoms, and Nuclei

**Physics.**
- Matter is built from atoms that keep their elemental identity through ordinary physical and
  chemical change, so weights add when elements combine.
- **Atomic number Z** = protons in the nucleus = electrons in a neutral atom. Z fixes chemical
  identity; the periodic table is ordered by it.
- **Atomic weight** (abundance-weighted average over an element's natural isotopes) vs. **atomic
  mass** (one specific isotope). Used constantly downstream; a reliable cadet stumbling point.
- From abundances: `M = Σ γᵢMᵢ`, γᵢ = fractional atom abundance. Natural uranium — ²³⁸U 99.27%,
  ²³⁵U 0.72%, ²³⁴U 0.0055% → **M = 238.03**.
- **Avogadro's number** N_A = 6.022×10²³ /mol. One mole = M grams = N_A entities.
- **Atom density, the section's payoff formula:**
  ```
  N = ρN_A / M        [atoms/cm³]     ρ in g/cm³, M in g/mol
  ```
- Compounds use molecular weight → molecules/cm³, then stoichiometry per element.
  - U metal: ρ = 19.05, M = 238.03 → **N = 4.82×10²² atoms/cm³**
  - Water: ρ = 1.00, M = 18.02 → **3.34×10²² molecules/cm³** → N_H = 6.68×10²², N_O = 3.34×10²²

**Flags.** Section title "Atomic Theory"; p. 15. Whether the uranium and water density examples are
Murray's own is a guess — the physics is right regardless.

**Cross-check.** DOE NP-01 corroborates Z, atom density, and Avogadro's number.

---

## §2.5 — Nuclear Structure

**STATUS: REVIEWED 2026-07-31** · Lesson 2 — Energy, Atoms, and Nuclei

**Physics.**
- **Nucleons** = protons + neutrons. **Mass number A** = Z + N. **Neutron number** N = A − Z.
- Notation `ᴬ_Z X` — A superscript, Z subscript (²³⁵₉₂U). Shorthand U-235 or ²³⁵U.
- **Isotopes** — same Z, different N: identical chemistry, different nuclear behavior. *This is the
  section's central idea and the one that has to land.*
  - Hydrogen is the anchor: protium ¹H, deuterium ²H (D), tritium ³H (T).
- Free neutron ¹₀n; electron/beta ⁰₋₁e — the symbols used in reaction equations from Ch. 3 onward.
- Nuclide families: **isotopes** same Z · **isotones** same N · **isobars** same A.

**Flags.** Section title "Nuclear Structure"; p. 23. The Manhattan Project code-number aside
("25" = U-235, "49" = Pu-239, from the last digit of Z and of A) is a real historical convention;
whether Murray tells it here is unverified.

**Cross-check.** DOE NP-01 corroborates all definitions and the notation.

---

## §2.6 — Sizes and Masses of Nuclei

**STATUS: REVIEWED 2026-07-31** · Lesson 2 — Energy, Atoms, and Nuclei

**Physics.**
- Nuclear radius ~10⁻¹³ cm vs. atomic radius ~10⁻⁸ cm — **10⁵ in radius, 10¹⁵ in volume**. Nearly
  all the mass in ~10⁻¹⁵ of the volume; nuclear density ≈ 2×10¹⁴ g/cm³.
- **Empirical radius:** `R = 1.25×10⁻¹³ A^(1/3) cm` (= 1.25 A^(1/3) fm). **The coefficient is 1.25
  in this book — confirmed by recker 2026-07-31.** ²³⁸U → ~7.7×10⁻¹³ cm, under 10⁻¹² cm.
  - *The A^(1/3) dependence is why nuclear density is roughly the same for every nuclide — that is
    the conceptual point behind the formula, and it probes well.*
- **Mass scale:** carbon-12 ≡ exactly 12 u; **1 u = 1.6605×10⁻²⁴ g**.
  - proton 1.007276 u · neutron 1.008665 u · electron 0.000549 u · neutral ¹H atom 1.007825 u
- **Mass–energy:** E = mc² → **1 u = 931.494 MeV**.
  - proton 938.272 MeV · neutron 939.565 MeV · electron 0.511 MeV
- Sets up §2.7 binding energy, which follows immediately.

**Flags.** Section title "Sizes and Masses of Nuclei"; p. 24. Radius rule credited to Krane —
plausible, unverified.

**Cross-check.** DOE NP-01 corroborates the scale contrast and the mass–energy conversion.
**DOE does not cover the amu / C-12 definition** — this section is the only source for it, and it is
the `gap: amu↔C-12` the schedule row used to carry.

---

## §2.7 — Binding Energy

**STATUS: PENDING** · Lesson 3 — Binding Energy and Stability

**Physics.**
- **Mass defect:** a nucleus weighs less than its constituent nucleons. The missing mass is the
  binding energy.
  ```
  Δm = Z·m(¹H) + N·m_n − M_atom          (atomic masses; electrons cancel)
  B  = Δm × 931.494 MeV/u
  ```
- **Binding energy per nucleon B/A is the curve that explains the whole course.**
  - Rises steeply for light nuclei, **peaks near A ≈ 56–60 at ~8.8 MeV/nucleon** (Fe-56, Ni-62),
    declines slowly to **~7.6 MeV/nucleon at ²³⁸U**.
  - **Both fusion (light nuclei) and fission (heavy nuclei) release energy by moving toward the
    peak.** This single idea is worth more probing time than any calculation in the section.
- Worked values:
  - Deuteron ²H: Δm = 1.007825 + 1.008665 − 2.014102 = 0.002388 u → **B = 2.224 MeV** (B/A = 1.11)
  - ⁴He: Δm = 0.030377 u → **B = 28.30 MeV**, B/A = 7.07 — anomalously tightly bound for its mass,
    which is why alpha particles exist as a decay mode at all.
- Most nuclides sit in a narrow B/A band of ~7–9 MeV. **The flatness is the point** — it is why
  A^(1/3) density arguments work and why nuclear energy scales are ~10⁶ times chemical ones.

**Flags.** Section title "Binding Energy"; whether the deuteron and helium examples are Murray's.
Whether Murray plots B/A here or defers the curve to Ch. 6 (Fission). Whether the peak is quoted at
Fe-56 or Ni-62 — texts differ, and cadets repeat whichever they were given.

**Cross-check.** DOE NP-01 covers mass defect and binding energy per nucleon; strong corroboration.

---

# Chapter 3 — Radioactivity

## §3.1 — Nuclear Stability

**STATUS: PENDING** · Lesson 3 — Binding Energy and Stability

**Physics.**
- Roughly 250–270 nuclides are stable; thousands more are not.
- **The chart of the nuclides (N vs. Z) and the line of stability.** Light nuclides cluster on
  N ≈ Z; heavier ones need **neutron excess (N > Z)** to dilute proton–proton Coulomb repulsion.
  By uranium the ratio is ≈ 1.6.
- **Nuclides off the line decay toward it**, and *which way they are off predicts the decay mode* —
  neutron-rich → β⁻; proton-rich → β⁺ or electron capture; very heavy → α. This predictive link is
  the section's real content and the best probe in it.
- **No stable nuclide exists above Z = 83 (bismuth).** Everything heavier is radioactive.
- Pairing: **even-Z/even-N nuclides are the most stable**, odd-odd the least — only four stable
  odd-odd nuclides exist.
- **Magic numbers 2, 8, 20, 28, 50, 82, 126** — closed nuclear shells, unusually stable, analogous
  to noble-gas electron shells.

**Flags.** Section title; whether §3.1 is stability or the opening of radioactivity generally. The
1.6 neutron-to-proton ratio at uranium is approximate. Whether Murray introduces magic numbers here
or in a later shell-model discussion.

**Cross-check.** DOE NP-01 covers the chart of the nuclides and stability trends well.

---

## §3.2 — Modes of Radioactive Decay

**STATUS: PENDING** · Lesson 4 — Radioactivity

**Physics.**
- **Alpha (α):** emits ⁴₂He. `Z → Z−2`, `A → A−4`. Heavy nuclides. **Discrete energies, 4–9 MeV.**
- **Beta-minus (β⁻):** `n → p + e⁻ + ν̄`. `Z → Z+1`, A unchanged. **Continuous energy spectrum** —
  the antineutrino carries away a share, which is *why* the spectrum is continuous and is the
  historically important observation.
- **Beta-plus (β⁺):** `p → n + e⁺ + ν`. `Z → Z−1`, A unchanged. Positron annihilates → two 0.511 MeV
  photons back-to-back.
- **Electron capture (EC):** `p + e⁻ → n + ν`. `Z → Z−1`, A unchanged. Competes with β⁺ and wins
  when the decay energy is under 1.022 MeV. Detected by the daughter's characteristic X-rays.
- **Gamma (γ):** excited nucleus → lower state. **Z and A both unchanged** — it follows another
  decay rather than standing alone.
- **Isomeric transition / metastable states** (Tc-99m), and **internal conversion**, where the
  energy ejects an orbital electron instead of emitting a photon.
- Every decay equation balances A and Z on both sides — the mechanical check cadets should own.

**Flags.** Section numbering across 3.2–3.4 is inferred; Murray may split decay modes and the decay
law differently. Whether internal conversion and isomers appear here or later.

**Cross-check.** DOE NP-01 covers all modes and the balancing rules; strong corroboration.

---

## §3.3 — The Radioactive Decay Law

**STATUS: PENDING** · Lesson 4 — Radioactivity

**Physics.**
- Decay is a **statistical, per-nucleus, memoryless process**: each nucleus has a fixed probability
  λ per unit time, independent of age and of environment. *The independence from temperature,
  pressure, and chemical state is the fact cadets find least intuitive and is worth probing.*
  ```
  dN/dt = −λN        N(t) = N₀ e^(−λt)
  A = λN             A(t) = A₀ e^(−λt)        (activity)
  t½ = ln2/λ = 0.693/λ
  τ  = 1/λ = t½/ln2 = 1.443 t½                (mean life)
  ```
- **Fraction remaining after n half-lives = (1/2)ⁿ** — scale-free, and the form to reason with when
  no calculator is available.
- **Units:** becquerel (Bq) = 1 decay/s. Curie (Ci) = **3.7×10¹⁰ Bq**, originally the activity of
  1 g of radium-226.
- **Specific activity** = activity per unit mass; inversely proportional to t½, so short-lived
  nuclides are intensely active and long-lived ones are not. This is why "long half-life" and
  "dangerous" are not synonyms — a distinction worth making explicitly.

**Flags.** Section title and boundary with §3.2. Whether Murray uses `λ` or `k` for the constant.
Whether the curie is defined here or in the Ch. 11 dose material.

**Cross-check.** DOE NP-01 covers the decay law, half-life, and activity units thoroughly.

---

## §3.4 — Decay Chains and Natural Radioactivity

**STATUS: PENDING** · Lesson 4 — Radioactivity

**Physics.**
- A daughter that is itself radioactive gives a **chain**: parent → daughter → … → stable end.
  The daughter's population is fed by decay and drained by its own.
- **Secular equilibrium** — when the parent is far longer-lived (t½ᵖ ≫ t½ᵈ), the daughter's activity
  rises to **equal the parent's** and then tracks it. This is the case that matters practically.
- **Transient equilibrium** — parent only moderately longer-lived; daughter activity exceeds the
  parent's by a fixed ratio and then decays with the parent's half-life.
- **Three natural series**, each named by A mod 4, each ending in a lead isotope:
  - ²³⁸U (4n+2) → **²⁰⁶Pb**, t½ = 4.47×10⁹ y
  - ²³⁵U (4n+3) → **²⁰⁷Pb**, t½ = 7.04×10⁸ y
  - ²³²Th (4n) → **²⁰⁸Pb**, t½ = 1.40×10¹⁰ y
  - The **4n+1 (neptunium) series is extinct in nature** — its longest-lived member, ²³⁷Np at
    2.14×10⁶ y, is far shorter than Earth's age. *Why three and not four is a genuinely good probe.*
- **Radon-222** is the ²³⁸U-chain member of practical consequence: a noble gas, so it escapes rock
  and accumulates indoors, and it is the dominant natural dose contributor for most people.

**Flags.** Section title and whether the natural series sit here or in a later environmental
chapter. Half-life values are standard reference values, not Murray-specific.

**Cross-check.** DOE NP-01 covers decay chains and equilibrium; the radon and natural-series
material is thinner there.

---

## §3.5 — Measurement of Half-Life

**STATUS: PENDING** · Lesson 6 — Lab 1

**Physics.**
- **Short half-lives — direct decay curve.** Count activity vs. time, plot **ln A against t**; the
  slope is **−λ**. The semi-log straightening is the whole method: an exponential becomes a line,
  and a *non*-straight line means a contaminant, a chain, or a dead-time problem rather than a bad
  measurement.
- **Long half-lives — the ratio method.** The decay curve is flat on any practical timescale, so
  measure activity `A` and number of atoms `N` separately (mass and atomic weight give N) and use
  **λ = A/N**.
- **Counting statistics.** Radioactive counting is Poisson: **σ = √N** for N counts, so the relative
  uncertainty is **1/√N**. Quadrupling the count time halves the error. *This is the most
  transferable idea in the section and the one cadets carry into every later lab.*
- **Background** must be measured separately and subtracted; its own counting error propagates.
- **Dead time** — the detector is blind briefly after each event, so observed rate underestimates
  true rate, and the error grows with rate.

**Flags.** Section title and whether Murray covers measurement technique here at all — this is the
entry most likely to be misfiled, since it is inferred largely from the lesson being *Lab 1*.
**Flagged as the weakest entry in Chapters 2–5.**

**Cross-check.** DOE NP-01 covers counting statistics and dead time in its detector material.

---

# Chapter 4 — Nuclear Processes and Reactions

## §4.1 — Nuclear Reactions and the Q-Value

**STATUS: PENDING** · Lesson 8 — Nuclear Reactions

**Physics.**
- Notation: `a + X → Y + b`, compressed as **X(a,b)Y**. Example: ¹⁰B(n,α)⁷Li.
- **Conserved in every reaction:** nucleon number A, charge Z, energy, momentum. Balancing A and Z
  is the mechanical skill; conserving *momentum* is the one cadets drop.
- **Q-value:**
  ```
  Q = [Σm_initial − Σm_final] × 931.494 MeV/u
  ```
  **Q > 0 exothermic** (energy released, no threshold). **Q < 0 endothermic** (energy required).
- **Threshold exceeds |Q|**, because momentum must be conserved and the products cannot be left at
  rest: `E_th ≈ |Q|·(1 + m_a/m_X)`. *A cadet who says the threshold equals |Q| has missed the only
  subtle point in the section.*
- **Compound nucleus model:** `a + X → C* → Y + b`. The intermediate forgets how it was formed, so
  the same compound nucleus reached by different routes decays the same way.

**Flags.** Section boundaries across 4.1–4.4 are inferred. Whether the compound-nucleus model
appears here or with cross sections.

**Cross-check.** DOE NP-01 covers reaction notation, Q-values, and conservation rules.

---

## §4.2 — Elastic Scattering and Neutron Slowing-Down

**STATUS: PENDING** · Lesson 8 — Nuclear Reactions

**Physics.**
- **Elastic scattering** conserves kinetic energy; the neutron transfers energy to a recoiling
  nucleus. This is how fast neutrons become thermal, so it is the section reactor physics is built on.
- **Minimum energy after one head-on collision** with a nucleus of mass number A:
  ```
  E'/E |min = ((A−1)/(A+1))²
  ```
  - **Hydrogen (A=1) → 0**: a neutron can lose *all* its energy in a single collision. This is why
    hydrogenous materials are the best moderators and the cleanest probe in the section.
  - Carbon (A=12) → 0.716 minimum; uranium (A=238) → 0.983 — heavy nuclei barely slow a neutron.
- **Average logarithmic energy decrement ξ** — the mean of ln(E/E′) per collision, independent of
  energy, so the number of collisions to thermalize is `ln(E₀/E_th)/ξ`. ξ ≈ 1.0 for H, ≈ 0.158 for C.
- **Inelastic scattering** leaves the nucleus excited and a gamma is emitted. It has a **threshold**
  and matters only for fast neutrons on heavy nuclei.
- Thermal energy reference: **0.025 eV at room temperature** (~2200 m/s neutron speed).

**Flags.** Section boundary; whether ξ and collision counts appear here or in the reactor chapters.
ξ ≈ 1.0 for hydrogen is exact-ish (0.999) but often quoted as 1.

**Cross-check.** DOE NP-02 covers scattering, ξ, and moderation thoroughly — strong corroboration.

---

## §4.3 — Neutron Capture and Absorption Reactions

**STATUS: PENDING** · Lesson 8 — Nuclear Reactions

**Physics.**
- **Radiative capture (n,γ)** is the most common absorption: the nucleus swallows the neutron and
  emits a gamma, leaving A+1 of the same element — often radioactive. This is **activation**, and it
  is why reactor structures become radioactive.
- **Charged-particle emission:** (n,p), (n,α). Practically important cases:
  - **¹⁰B(n,α)⁷Li** — large thermal cross section, used for control rods, shielding, and detectors.
  - **⁶Li(n,α)³H** — tritium production.
- **(n,2n)** — a fast-neutron threshold reaction that multiplies neutrons without fission.
- **Breeding:** `²³⁸U(n,γ)²³⁹U → β⁻ → ²³⁹Np → β⁻ → ²³⁹Pu`. The fertile-to-fissile conversion the
  whole fuel-cycle discussion later depends on; the analogous ²³²Th → ²³³U chain runs the same way.

**Flags.** Section boundary. Whether breeding is introduced here or deferred to the fuel-cycle
chapters — it is load-bearing in both places.

**Cross-check.** DOE NP-01/NP-02 cover capture, activation, and the plutonium breeding chain.

---

## §4.4 — Charged-Particle and Photon-Induced Reactions

**STATUS: PENDING** · Lesson 8 — Nuclear Reactions

**Physics.**
- **Charged projectiles must overcome the Coulomb barrier**, so proton- and alpha-induced reactions
  need MeV-scale energies while neutrons need none. *This asymmetry — neutrons enter freely, charged
  particles must be pushed — explains why neutrons drive reactor physics.*
- Historically important: **¹⁴N(α,p)¹⁷O**, Rutherford's first artificial transmutation;
  **⁹Be(α,n)¹²C**, Chadwick's discovery of the neutron and still a lab neutron source.
- **Photonuclear (γ,n)** — a photon above the separation energy ejects a neutron. The deuteron
  threshold is **2.224 MeV**, exactly the binding energy from §2.7, which makes the two sections
  worth connecting in conversation.
- Accelerator-driven reactions produce medical isotopes and drive activation analysis.

**Flags.** **This is the least certain entry in Chapter 4** — §4.4 may instead cover reaction cross
sections, fission as a reaction type, or the compound nucleus. The physics is standard for the
range; its filing is a guess.

**Cross-check.** DOE covers little of this; treat as reduced-confidence.

---

## §4.5 — Cross Sections

**STATUS: PENDING** · Lesson 9 — Cross Sections

**Physics.**
- **Microscopic cross section σ** — the effective target area one nucleus presents for one reaction.
  Unit: **barn = 10⁻²⁴ cm²**, chosen because it is roughly a heavy nucleus's geometric area.
  *σ is a probability wearing the units of area — it is not the physical size of the nucleus, and
  cadets who miss this misread every number in the chapter.*
- **Macroscopic cross section Σ = Nσ** [cm⁻¹], with N the atom density from §2.1. Σ is a probability
  **per unit path length**, and this is where §2.1's formula finally pays off.
- **Mean free path λ = 1/Σ** — the average distance between interactions.
- **Attenuation of an uncollided beam:** `I(x) = I₀ e^(−Σx)`. Same exponential form as decay, in
  space rather than time.
- **Reaction rate:** `R = Σφ` per unit volume, with φ the neutron flux.
- Cross sections **add by reaction type** (Σ_a = Σ_c + Σ_f) and **by nuclide** (mixtures sum by atom
  density) — the rule that makes multi-material problems tractable.

**Flags.** Section boundary with §4.6. Whether flux and reaction rate are defined here or with
transport in §4.7.

**Cross-check.** DOE NP-02 covers cross sections, Σ, mean free path, and reaction rate in depth.

---

## §4.6 — Energy Dependence of Cross Sections

**STATUS: PENDING** · Lesson 9 — Cross Sections

**Physics.**
- **The 1/v region.** At low energy, absorption cross sections vary as **1/v** — slow neutrons spend
  longer near a nucleus, so capture is likelier. This is why thermalizing neutrons raises fission
  probability, and it is the single most useful idea in the section.
- **Resonances.** At intermediate (epithermal) energies, σ spikes by orders of magnitude at discrete
  energies where the compound nucleus has a matching state. **²³⁸U's capture resonances in the
  eV–keV range are why resonance escape matters in a thermal reactor.**
- **Fast region.** Above the resonances, cross sections are small and smooth — a few barns.
- Magnitudes worth having: **²³⁵U thermal fission ≈ 585 b**; **²³⁸U thermal capture ≈ 2.7 b**;
  **¹⁰B(n,α) ≈ 3840 b**; hydrogen scattering ≈ 20 b, absorption ≈ 0.33 b.
- **Doppler broadening** — heating the fuel widens ²³⁸U's resonances, increasing capture. This is a
  *prompt negative* feedback and the physical basis of reactor self-regulation, so it recurs in
  Chapters 16 and 18.

**Flags.** Section boundary. Cross-section values are standard reference values at 0.0253 eV, not
Murray-specific — **check Murray's quoted numbers, since cadets will use his.** Whether Doppler
broadening appears here or with reactor kinetics.

**Cross-check.** DOE NP-02 covers 1/v, resonances, and Doppler broadening well.

---

## §4.7 — Neutron Flux, Current, and Transport

**STATUS: PENDING** · Lesson 10 — Neutron Transport

**Physics.**
- **Flux φ = nv** [neutrons/cm²·s] — density times speed. **A scalar: it counts path length swept
  per unit volume per unit time, regardless of direction.** It is *not* a flow.
- **Current J** is the net directional flow — a vector. *Flux and current being different things is
  the conceptual core of this section and the one cadets reliably conflate.* A perfectly isotropic
  field has large flux and **zero** net current.
- **Reaction rate R = Σφ**, which is why flux is the quantity worth computing at all.
- **Fick's law / diffusion approximation:** `J = −D∇φ` — net flow runs down the flux gradient.
  Valid where absorption is weak relative to scattering and far from boundaries and sources.
- **Diffusion equation** in steady state: `D∇²φ − Σ_aφ + S = 0`.
- **Diffusion length L = √(D/Σ_a)** — the characteristic distance a thermal neutron wanders before
  absorption; sets how far leakage reaches into a reactor and how thick a shield must be.
- **Leakage is a surface effect and absorption a volume effect**, so small systems leak
  proportionally more — the geometric argument that makes critical size a real constraint in Ch. 16.

**Flags.** Section boundary and depth — whether Murray develops the diffusion equation here or only
gestures at transport before Ch. 16. Whether `L` or `L²` is the defined quantity.

**Cross-check.** DOE NP-02 covers flux, current, diffusion, and leakage thoroughly.

---

# Chapter 5 — Radiation and Materials

## §5.1 — Types of Radiation and How They Interact

**STATUS: PENDING** · Lesson 13 — Radiation Interactions with Materials

**Physics.**
- The organizing split: **charged particles** (α, β, protons, fission fragments) interact
  continuously via the Coulomb force with *every* electron they pass; **neutral radiation**
  (γ, neutrons) interacts only in discrete, probabilistic events.
- **That difference produces the two distinct behaviors the rest of the chapter explains:** charged
  particles have a **definite range** and stop; neutral radiation is **attenuated exponentially**
  and never has a range, only a half-thickness. *This is the single most important idea in Ch. 5.*
- **Ionization vs. excitation** — an interaction either ejects an electron or promotes one. Roughly
  **34 eV of energy deposited per ion pair in air**, which is what makes detectors quantitative.
- **Directly vs. indirectly ionizing**: neutrons and gammas do their damage through the charged
  secondaries they set in motion, not directly.

**Flags.** Section title and whether §5.1 is an overview or begins charged-particle stopping
immediately. The 34 eV/ion-pair value is standard for air.

**Cross-check.** DOE NP-01 covers the interaction taxonomy.

---

## §5.2 — Charged-Particle Interactions and Range

**STATUS: PENDING** · Lesson 13 — Radiation Interactions with Materials

**Physics.**
- **Stopping power −dE/dx** rises as the particle slows (roughly as 1/E), so **energy deposition
  peaks near the end of the track — the Bragg peak.** This is exactly why proton and heavy-ion
  therapy works, and it is the best real-world hook in the chapter.
- **Range** is well-defined and short: a 5 MeV alpha travels ~4 cm in air and **is stopped by paper
  or the dead layer of skin**. Betas are longer-ranged — a few mm of aluminum or ~1 m of air for
  1 MeV — and follow tortuous paths because they scatter off particles of equal mass.
- **Stopping scales as z²/v²** — heavier charge and slower speed mean more stopping. Alphas are far
  more densely ionizing than betas of the same energy.
- **Bremsstrahlung** — decelerating betas radiate X-rays, with yield rising with **Z of the
  absorber**. *Hence the counterintuitive shielding rule: shield betas with low-Z material (plastic,
  aluminum), never lead, or you convert a stoppable beta problem into a penetrating photon problem.*
- **Linear energy transfer (LET)** — energy deposited per unit path — is the bridge to Ch. 10's
  biological effectiveness: high-LET alphas do far more damage per unit energy.

**Flags.** Section boundaries across 5.2–5.5 are inferred. Range figures are standard values.
Whether LET is defined here or in the bioeffects chapter.

**Cross-check.** DOE NP-01 covers stopping, range, and bremsstrahlung.

---

## §5.3 — Gamma-Ray Interactions

**STATUS: PENDING** · Lesson 13 — Radiation Interactions with Materials

**Physics.**
- **Three mechanisms, each dominating a different regime** — the section's organizing fact:
  - **Photoelectric** — photon fully absorbed, electron ejected. Dominates at **low energy and high
    Z** (roughly Z⁴–Z⁵/E³). **This is why lead shields gammas.**
  - **Compton scattering** — photon scatters off an electron, losing part of its energy and changing
    direction. Dominates at **intermediate energy (~0.1–10 MeV)**, and depends on electron density,
    so nearly on Z linearly.
  - **Pair production** — photon converts to e⁺e⁻ near a nucleus. **Threshold 1.022 MeV** (twice the
    electron rest mass); grows with energy and Z².
- **Attenuation:** `I(x) = I₀e^(−μx)`, with **μ = linear attenuation coefficient**; mass attenuation
  μ/ρ is the tabulated form. **Half-value layer = ln2/μ.**
- **Attenuation is not absorption.** The exponential describes *uncollided* photons; scattered ones
  still arrive, which is what **buildup factors** in Ch. 11 correct for. *A cadet who shields using
  e^(−μx) alone underestimates the dose, and that is the error worth surfacing here.*

**Flags.** Section boundary; whether all three mechanisms are one section or split. Whether buildup
is introduced here or deferred to Ch. 11.

**Cross-check.** DOE NP-01 covers all three mechanisms and attenuation well.

---

## §5.4 — Neutron Interactions with Matter

**STATUS: PENDING** · Lesson 13 — Radiation Interactions with Materials

**Physics.**
- Neutrons are uncharged, so they **ignore electrons entirely and interact only with nuclei** —
  which is why they are **penetrating in dense high-Z material that stops gammas** and are stopped
  by hydrogen-rich material that gammas pass through. *The shielding inversion versus gammas is the
  section's payoff and a genuinely surprising result for cadets.*
- Energy regimes: **fast (> ~0.1 MeV)**, **epithermal/resonance**, **thermal (≈ 0.025 eV)**.
- **Shielding neutrons is a two-step job:** moderate them with hydrogenous material (water,
  polyethylene, concrete), then absorb the thermalized neutrons with boron or cadmium — and then
  **shield the capture gammas the absorption produces**, which is the step people forget.
- Recoil protons from fast-neutron scattering deposit the dose in tissue; neutrons are high-LET and
  carry large quality factors in Ch. 10.
- **Activation** — neutron shielding and structures become radioactive, unlike gamma shielding.

**Flags.** Section boundary. Whether activation is covered here or in the safety chapters.

**Cross-check.** DOE NP-01/NP-02 cover neutron interactions and moderation thoroughly.

---

## §5.5 — Radiation Effects on Materials

**STATUS: PENDING** · Lesson 13 — Radiation Interactions with Materials

**Physics.**
- **Displacement damage** — a fast neutron knocks an atom off its lattice site, which knocks others
  loose in a cascade. Measured in **displacements per atom (dpa)**.
- Consequences in reactor structures: **embrittlement** (steel loses ductility, raising the
  ductile–brittle transition temperature — the life-limiting concern for a pressure vessel),
  **swelling**, **creep**, and **hardening**.
- **Gas production** — (n,α) reactions generate helium that collects at grain boundaries and
  embrittles further; a major limit for fusion first-wall materials.
- **Wigner energy** — stored energy in irradiated graphite, released suddenly if annealed
  improperly. The cause of the 1957 Windscale fire, so it connects forward to Ch. 21.
- **Radiolysis** — radiation splits water into H₂ and O₂ and other reactive species, driving
  corrosion and creating a hydrogen hazard.
- Damage depends on **fast** fluence specifically; thermal neutrons cause activation but little
  displacement.

**Flags.** Section title and boundary. Whether Wigner energy and radiolysis are Murray's examples.

**Cross-check.** DOE covers little materials science; **reduced confidence.**

---

## §5.6 — Biological Effects of Radiation

**STATUS: PENDING** · Lesson 14 — Bioeffects and Safety

**Physics.**
- **Mechanism:** ionization breaks chemical bonds. DNA is the critical target, damaged **directly**
  by ionization in the molecule or **indirectly** by free radicals from radiolysis of cell water —
  and the indirect path dominates, which is why the body being mostly water matters.
- **Double-strand breaks** are the hard-to-repair lesion; single-strand breaks usually repair
  correctly. **High-LET radiation clusters its damage**, which is why alphas are more biologically
  effective per unit energy than gammas.
- **Two categories of effect, and the distinction governs all of radiation protection:**
  - **Deterministic (tissue reactions)** — a **threshold** exists; below it nothing happens, above it
    severity scales with dose. Burns, cataracts, acute radiation syndrome.
  - **Stochastic** — **probability** rises with dose, severity does not; assumed to have **no
    threshold**. Cancer and heritable effects.
- **Cell radiosensitivity** rises with mitotic rate — bone marrow, GI lining, and gonads first;
  nerve and muscle last.
- **Acute whole-body dose landmarks:** ~1 Sv onset of acute radiation syndrome; **LD50/60 ≈ 3.5–4.5
  Sv untreated**; > 8 Sv rarely survivable.

**Flags.** Section number — this is filed as 5.6 because the schedule pairs it with Ch. 10 for
Bioeffects and Safety, but it may be the closing section of Ch. 5 or an opening one elsewhere. LD50
figures are standard ranges.
*(Said by topic, not by number: this entry read "Lesson 15" until 2026-08-05, when the schedule
renumbered and the STATUS trailers were re-pointed while this prose was not. Naming the topic is
what stops it happening again — the topic is the stable string in this course.)*

**Cross-check.** DOE covers bioeffects only lightly; **reduced confidence on organization, high on
the physics.**

---

# Chapter 6 — Fission

## §6.1 — The Fission Process

**STATUS: PENDING** · Lesson 24 — Fission: Neutron Multiplication

**Physics.**
- A neutron is absorbed, the compound nucleus is left excited, and it **deforms**. Once deformation
  is large enough that **Coulomb repulsion beats the nuclear surface tension**, it splits. The
  **liquid-drop model** is the picture Murray uses.
- **Critical energy vs. excitation energy is what separates fissile from fissionable**, and it is
  the section's central idea:
  - **Fissile — ²³⁵U, ²³³U, ²³⁹Pu — fission with *thermal* neutrons.** They have **odd N**, so
    adding a neutron produces an even-even pairing bonus; the binding energy alone (~6.5 MeV)
    exceeds the critical energy (~6.2 MeV) with **no kinetic energy required**.
  - **Fissionable-only — ²³⁸U, ²³²Th — need fast neutrons** above roughly **1 MeV**, because they
    have even N and gain no pairing bonus, leaving them short of the barrier.
  - **Fertile — ²³⁸U, ²³²Th — breed into fissile ²³⁹Pu and ²³³U by capture** (§4.3).
- **The split is asymmetric.** The fission-product mass distribution is **double-humped**, peaking
  near **A ≈ 95 and A ≈ 137**; a symmetric split is roughly 600× less likely at thermal energies.
  *Why asymmetric is an open, honest "not fully explained by the liquid-drop model" answer — shell
  effects — and makes a good probe precisely because it has no tidy resolution.*

**Flags.** Section boundaries across 6.1–6.5 are inferred. Critical-energy figures (~6.2/6.5 MeV)
are standard but check Murray's numbers. Whether the mass-yield curve is here or in §6.3.

**Cross-check.** DOE NP-01/NP-02 cover the fission process, fissile vs. fertile, and the yield curve.

---

## §6.2 — Energy Release in Fission

**STATUS: PENDING** · Lesson 24 — Fission: Neutron Multiplication

**Physics.**
- **≈ 200 MeV per fission**, versus a few eV for a chemical reaction — a factor of ~10⁸ per event
  and ~10⁶–10⁷ per unit mass. Roughly **0.85 MeV per nucleon**, consistent with the B/A curve
  from §2.7.
- **The breakdown matters for reactor design**, because not all of it is recoverable and not all
  appears immediately:

  | component | ≈ MeV | when |
  |---|---:|---|
  | kinetic energy of fission fragments | 168 | prompt, deposited within microns |
  | prompt neutrons | 5 | prompt |
  | prompt gammas | 7 | prompt |
  | fission-product beta decay | 8 | **delayed** |
  | fission-product gammas | 7 | **delayed** |
  | antineutrinos | 12 | **escapes — never recoverable** |

- **Recoverable ≈ 193 MeV**; ~200 MeV is the usual working figure.
- **≈ 3.1×10¹⁰ fissions per second per watt.** Fissioning **1 g of ²³⁵U ≈ 1 MW·day** of thermal
  energy — the number that makes fuel-cycle arithmetic tractable in Ch. 15.
- Because ~168 MeV lands as fragment kinetic energy stopped within microns, **essentially all fission
  heat is deposited inside the fuel pellet**, which is why fuel centerline temperature drives the
  design.

**Flags.** Section boundary. Energy-partition values are standard reference figures; **check
Murray's table since cadets will quote his numbers.**

**Cross-check.** DOE NP-02 covers the energy breakdown and the MW·day figure.

---

## §6.3 — Fission Products and Decay Heat

**STATUS: PENDING** · Lesson 24 — Fission: Neutron Multiplication

**Physics.**
- Fragments inherit uranium's **high N/Z ratio**, which is far too neutron-rich for mid-mass
  nuclides, so they **beta-decay in chains** toward stability — typically 3–4 steps.
- **Decay heat is the operational consequence and the most important idea in the section.**
  Immediately after shutdown a reactor still produces **≈ 7% of full power**, falling to ~1% at an
  hour and ~0.1% at a week. **A shut-down reactor still needs cooling** — the direct cause of the
  Fukushima Daiichi accident and the reason Ch. 21 exists.
- Fission products that matter individually:
  - **¹³¹I** (t½ 8 d) — concentrates in the thyroid; the reason for KI prophylaxis.
  - **¹³⁷Cs** (30 y) and **⁹⁰Sr** (29 y) — dominate long-term contamination; Sr follows calcium
    into bone.
  - **¹³⁵Xe** — a **neutron poison** with a thermal absorption cross section of **≈ 2.6×10⁶ barns**,
    the largest of any nuclide. It builds up after shutdown as ¹³⁵I decays into it, producing the
    **xenon transient / "iodine pit"** that can prevent restart for many hours.
  - **¹⁴⁹Sm** — a stable poison that saturates and stays.
- **Burnable poisons and control margin** exist largely to manage these.

**Flags.** Section boundary; whether decay heat and xenon are here or with reactor operations in
Ch. 18. Half-lives and the xenon cross section are standard reference values.

**Cross-check.** DOE NP-03 covers xenon and samarium poisoning in depth — strong corroboration.

---

## §6.4 — Neutrons from Fission

**STATUS: PENDING** · Lesson 24 — Fission: Neutron Multiplication

**Physics.**
- **ν ≈ 2.43 neutrons per thermal fission of ²³⁵U** (≈ 2.9 for ²³⁹Pu). More than one is what makes a
  chain reaction possible at all; the margin above one is what pays for leakage and parasitic capture.
- **Prompt neutrons — over 99%** — emitted within ~10⁻¹⁴ s. Average energy **≈ 2 MeV** (Watt
  spectrum), most probable ~0.7 MeV. **They are born fast and must be moderated** to exploit the
  large thermal fission cross section, which is the entire reason for §4.2's moderator physics.
- **Delayed neutrons — ≈ 0.65% for ²³⁵U (β ≈ 0.0065)** — emitted seconds to a minute later by
  **fission-product precursors** (⁸⁷Br, ¹³⁷I), grouped into ~6 half-life groups spanning 0.2–56 s.
- ***Delayed neutrons are the reason reactors are controllable, and this is the single most
  important fact in Chapter 6.*** They stretch the mean neutron generation time from ~10⁻⁴ s to
  ~0.1 s — a factor of ~1000 — turning power changes from unmanageably fast into something a control
  rod and a human operator can follow.
- **Hence "prompt critical."** Reactivity above β (defined as **$1.00** on the dollar scale) makes
  the reactor critical on prompt neutrons alone and the delayed-neutron safety margin vanishes.
  **Operation is always kept well below $1.** Note ²³⁹Pu's smaller β (≈ 0.002) gives a
  plutonium-rich core a narrower margin.

**Flags.** Section boundary. ν, β, and the delay-group structure are standard values. Whether the
dollar/prompt-critical vocabulary is introduced here or in Ch. 16/18.

**Cross-check.** DOE NP-02/NP-04 cover delayed neutrons, generation time, and prompt criticality
thoroughly — strong corroboration.

---

## §6.5 — The Chain Reaction and Multiplication

**STATUS: PENDING** · Lesson 24 — Fission: Neutron Multiplication

**Physics.**
- **Multiplication factor k** = neutrons in one generation ÷ neutrons in the previous generation.
  - **k < 1 subcritical** (dies out) · **k = 1 critical** (steady) · **k > 1 supercritical** (grows)
  - *Critical means constant power, not "dangerous" and not "maximum power" — a reactor at 5% power
    and at 100% power is equally critical. This misreading is nearly universal and is the highest-
    value correction in the chapter.*
- **Reactivity** `ρ = (k−1)/k` — the working control variable, expressed in %Δk/k, pcm, or dollars
  (ρ/β).
- **Four-factor formula for an infinite medium:** `k∞ = η ε p f`
  - **η** neutrons produced per neutron absorbed in fuel · **ε** fast fission factor ·
    **p** resonance escape probability · **f** thermal utilization
- **Six-factor formula for a real, finite reactor:** `k_eff = k∞ · P_FNL · P_TNL`, adding fast and
  thermal **non-leakage** probabilities. **Leakage is a surface effect and absorption a volume
  effect**, so a system can be subcritical purely by being small — which sets up critical mass and
  geometry in Ch. 16.
- **p and f pull in opposite directions with moderation**, so there is an optimum
  moderator-to-fuel ratio; being **under-moderated is deliberate**, because it gives a negative
  moderator temperature coefficient and therefore self-regulation.

**Flags.** Section boundary; whether the four-factor formula is here or opens Ch. 16, given that
Lesson 25 covers 16.1–16.5 as "Criticality." Some content may legitimately live in both.

**Cross-check.** DOE NP-02/NP-03 cover k, reactivity, and the four- and six-factor formulas in depth.

---

# Chapter 7 — Fusion

## §7.1 — Fusion Reactions

**STATUS: PENDING** · Lesson 26 — Fusion

**Physics.**
- Light nuclei fuse and **climb the B/A curve from §2.7 toward the iron peak** — the same curve that
  explains fission, read from the other end. Worth making that connection explicitly.
- **The candidate reactions, in order of practical difficulty:**
  ```
  D + T   → ⁴He (3.5 MeV) + n (14.1 MeV)      Q = 17.6 MeV     ← easiest by far
  D + D   → ³He (0.82)    + n (2.45)          Q = 3.27 MeV     ~50%
  D + D   → T   (1.01)    + p (3.02)          Q = 4.03 MeV     ~50%
  D + ³He → ⁴He (3.6)     + p (14.7)          Q = 18.3 MeV     aneutronic
  ```
- **D–T wins** on cross section (peaking at ~10× the D–D value) and on the lowest required
  temperature, which is why every major program pursues it.
- **But 80% of D–T's energy leaves as a 14.1 MeV neutron** — uncharged, so it cannot be magnetically
  confined, and it both activates and damages the first wall (§5.5). *That the easiest reaction is
  also the one with the worst engineering consequence is the honest tension in fusion.*
- **Tritium does not occur naturally** (t½ 12.3 y) and must be **bred in a lithium blanket**:
  `⁶Li(n,α)³H` — using the very neutron the reaction produced.
- **Per unit mass, fusion beats fission** — D–T releases ~3.5 MeV/nucleon against fission's ~0.85.
- **Stellar fusion:** the **p–p chain** in the Sun and the **CNO cycle** in heavier stars; both net
  four protons into ⁴He. Stellar rates are far slower than any terrestrial scheme could tolerate.

**Flags.** Section boundary between 7.1 and 7.2. Q-values are exact standard values.

**Cross-check.** DOE covers fusion only in passing; **reduced confidence on Murray's organization.**

---

## §7.2 — Conditions for Fusion and Confinement

**STATUS: PENDING** · Lesson 26 — Fusion

**Physics.**
- **The Coulomb barrier is the whole problem.** Both nuclei are positive and must reach ~fm
  separation. Even with quantum tunneling, useful rates need **~10 keV, i.e. ~10⁸ K** — hotter than
  the solar core, which compensates with enormous density and time.
- At those temperatures matter is a **plasma** — fully ionized, and therefore steerable by magnetic
  fields, which is what makes confinement conceivable at all.
- **Three confinement strategies:**
  - **Gravitational** — stars. Unavailable to us.
  - **Magnetic (MCF)** — tokamak, stellarator. Low density, long time (seconds).
  - **Inertial (ICF)** — laser or ion-beam compression. Enormous density, nanoseconds.
- **Lawson criterion** — the trade between density and confinement time: for D–T, roughly
  **nτ > 10¹⁴ s/cm³**. The modern form is the **triple product nTτ**, with ignition near
  **~10²¹ keV·s/m³**. *That MCF and ICF sit at opposite extremes of n and τ while satisfying the same
  product is the elegant point of the section.*
- **Ignition** — alpha particles (the 3.5 MeV ⁴He, which *is* charged and *is* confined) deposit
  enough energy to sustain the burn without external heating. **Q = fusion power / input power**;
  **Q = 1 is scientific breakeven**, ignition is Q → ∞.
- **Bremsstrahlung radiation** from the plasma is the dominant loss and rises with Z², which is why
  even trace high-Z wall impurities can quench a plasma.

**Flags.** Section boundary and depth. Lawson figures are standard; forms and units vary between
texts, so **check which form Murray gives.**

**Cross-check.** DOE does not cover fusion; **no cross-check available.**

---

# Chapter 10 — Radiation Protection

## §10.1 — Dose Quantities and Units

**STATUS: PENDING** · Lesson 14 — Bioeffects and Safety

**Physics.**
- **Three distinct quantities that cadets routinely collapse into "radiation," and separating them
  is the section's entire job:**

  | quantity | measures | SI unit | old unit |
  |---|---|---|---|
  | **Activity** | decays per second — a property of the *source* | becquerel (Bq) | curie, 3.7×10¹⁰ Bq |
  | **Absorbed dose D** | energy deposited per mass — physics only | **gray (Gy) = 1 J/kg** | rad = 0.01 Gy |
  | **Equivalent dose H** | absorbed dose weighted by radiation type | **sievert (Sv)** | rem = 0.01 Sv |
  | **Effective dose E** | equivalent dose weighted by organ sensitivity | sievert (Sv) | rem |

- **`H = D × w_R`** — radiation weighting factors: **photons and betas 1, protons ~2, alphas 20,
  neutrons 5–20 depending on energy** (peaking near 1 MeV). *The same joule per kilogram from alphas
  does twenty times the biological harm, because of LET clustering from §5.2.*
- **`E = Σ_T w_T · H_T`** — tissue weighting factors sum to 1 across the body, converting a partial
  irradiation into the whole-body equivalent that carries the same stochastic risk.
- **Exposure (roentgen)** — ionization produced in air. Historical, air-specific, and superseded;
  it survives on older instrument scales.
- **Unit discipline is a real hazard here**: rem/Sv differ by 100, and mixing them is the classic
  error in every dose calculation.

**Flags.** Section number and title. Weighting factors have changed between ICRP publications —
**check which set Murray uses**, since cadets will use his.

**Cross-check.** DOE NP-01 covers dose units; the ICRP weighting-factor detail is thinner there.

---

## §10.2 — Sources of Radiation Exposure

**STATUS: PENDING** · Lesson 14 — Bioeffects and Safety

**Physics.**
- **US average ≈ 6.2 mSv/y**, split roughly half natural, half medical.
- **Natural ≈ 3.1 mSv/y:**
  - **Radon and its progeny ≈ 2.3 mSv — about two-thirds of all natural dose** and the single
    largest contributor for most people. Traces back to the ²³⁸U chain in §3.4.
  - Cosmic ≈ 0.33 · terrestrial ≈ 0.21 · internal (⁴⁰K, ¹⁴C) ≈ 0.29
- **Medical ≈ 3.0 mSv/y**, dominated by CT. Chest X-ray ~0.1 mSv; head CT ~2 mSv; abdominal CT
  ~10 mSv.
- Minor: consumer products, fallout, industrial — together well under 0.1 mSv/y. **Nuclear power's
  contribution to public dose is a fraction of a µSv/y**, and setting that against radon is the
  comparison that reframes the whole risk conversation.
- **Cosmic dose roughly doubles per ~2 km of altitude.** *USAFA sits near 2,100 m, so cadets already
  receive noticeably more cosmic dose than at sea level — the most local hook available in this
  chapter.* Air crew are among the most-exposed occupational groups.

**Flags.** Section number. Dose figures are NCRP/UNSCEAR averages, not Murray-specific — **check his
numbers and their vintage**, as the medical share rose sharply in the 2000s.

**Cross-check.** DOE covers background sources only lightly; **reduced confidence.**

---

## §10.4 — Protection Standards and ALARA

**STATUS: PENDING** · Lesson 14 — Bioeffects and Safety

**Physics.**
- **Limits are set for stochastic risk, so they are administrative choices informed by physics —
  not thresholds below which nothing happens.** Getting that distinction right is the point.
  - **Occupational: 50 mSv/y** (US NRC) · ICRP recommends **20 mSv/y averaged over 5 years**
  - **Public: 1 mSv/y** above background
  - **Declared pregnant worker: 5 mSv** over the gestation period
  - Separate, higher limits for **lens of the eye, skin, and extremities**, which are deterministic
    concerns
- **ALARA — As Low As Reasonably Achievable** — the operating principle *below* the limits.
  **Compliance is a floor, not a goal**, and the "reasonably" explicitly admits cost and social
  factors rather than pretending they are absent.
- **LNT — the linear no-threshold model** — assumes stochastic risk is proportional to dose with no
  safe threshold. It is a **conservative regulatory assumption**, not a settled result: the
  epidemiology is solid above ~100 mSv and cannot resolve risk below it. *Saying plainly that the
  data run out is more honest and more interesting than presenting LNT as established fact, and it
  is where a genuine Socratic conversation lives in this chapter.*
- **Collective dose (person-Sv)** is useful for optimization and is widely criticized when applied
  to vast populations at trivial individual doses.

**Flags.** Section number **10.4 specifically** — the schedule skips 10.3, which suggests a section
we are not covering, but the split is unverified. Regulatory limits are US NRC values; **check
Murray's and their vintage.**

**Cross-check.** DOE covers ALARA and limits; the ICRP/LNT policy discussion is thinner.

---

# Chapter 11 — Dose Calculation and Shielding

## §11.1 — Time, Distance, and Shielding

**STATUS: PENDING** · Lesson 15 — Dose and Shielding

**Physics.**
- The **three controls**, in order of how cheaply they buy protection:
  - **Time** — dose is linear in exposure time. Halve the time, halve the dose. Practiced by
    rehearsing a maintenance task on a mockup before entering the field.
  - **Distance** — **inverse square** for a point source: `Ḋ ∝ 1/r²`. **Doubling distance quarters
    the dose**, which makes distance the cheapest and most powerful control available, and the
    reason remote handling tools exist.
  - **Shielding** — exponential in thickness, and the most expensive of the three.
- **The inverse-square law holds only for a point source in a vacuum.** It fails for line and plane
  sources (a pipe, a contaminated floor), where the falloff is 1/r or nearly flat, and it fails
  where scatter or attenuation matters. *Applying 1/r² to an extended source is the standard error,
  and it errs optimistically.*
- Practical corollary: **contamination control is a fourth control** in disguise — removing the
  source removes all three problems.

**Flags.** Section boundaries across 11.1–11.3 are inferred.

**Cross-check.** DOE covers time/distance/shielding; strong corroboration.

---

## §11.2 — Dose-Rate Calculations

**STATUS: PENDING** · Lesson 15 — Dose and Shielding

**Physics.**
- **Point source, uncollided flux:** `φ = S / (4πr²)` [particles/cm²·s].
- **Gamma dose rate** from a point source uses the nuclide's **specific gamma-ray constant Γ**:
  `Ḋ = Γ·A / r²`. Γ is tabulated per nuclide, which folds photon yield and energy into one number.
  - A useful rule of thumb: **≈ 6 R/h per curie at 1 foot per MeV** of gamma energy.
- **Internal dose** behaves differently and is the harder half:
  - **Committed dose** — the total delivered over the years following an intake, assigned to the
    year of intake.
  - **Effective half-life** combines physical decay and biological clearance:
    ```
    1/T_eff = 1/T_phys + 1/T_bio
    ```
    **T_eff is always shorter than either**, so a long-lived nuclide the body clears quickly can be
    far less hazardous than its physical half-life suggests. *This is where §3.3's "long half-life ≠
    dangerous" finally has teeth.*
  - **Route of intake and chemistry dominate**: ⁹⁰Sr follows calcium to bone and stays; ¹³¹I goes to
    the thyroid; tritium distributes in body water and clears in ~10 days.

**Flags.** Section boundary. Γ values and the 6 R/h rule of thumb are standard; **check Murray's
form and units** — this area mixes SI and traditional units freely.

**Cross-check.** DOE covers internal dose and effective half-life.

---

## §11.3 — Shielding Calculations and Buildup

**STATUS: PENDING** · Lesson 15 — Dose and Shielding

**Physics.**
- **Uncollided attenuation:** `I = I₀ e^(−μx)`, with **half-value layer HVL = ln2/μ** and
  **tenth-value layer TVL = ln10/μ ≈ 3.32 × HVL**. HVLs stack multiplicatively — three HVLs give 1/8.
- **The buildup factor is the point of the section:**
  ```
  D = D₀ · B · e^(−μx)
  ```
  **B accounts for scattered photons that reach the detector after changing direction.** For thick
  shields B can be **2–10 or more**. *Using e^(−μx) alone underestimates the dose — and it errs on
  the unsafe side, which is exactly why this correction is taught rather than left as a refinement.*
  B grows with thickness (in mean free paths) and falls with atomic number.
- **Material choice follows the physics of Ch. 5, and the two requirements conflict:**
  - **Gammas → high-Z, high-density**: lead, depleted uranium, steel (photoelectric ∝ Z⁴–Z⁵).
  - **Neutrons → hydrogenous**: water, polyethylene, concrete — moderate first, then absorb with
    boron or cadmium (§5.4).
  - **A lead shield is nearly transparent to fast neutrons; a water shield is poor against gammas.**
    Mixed fields need **layered or composite shields**, and **concrete is the practical compromise**
    because it carries hydrogen, oxygen, and heavy aggregate at once.
  - **Remember the capture gammas**: absorbing thermal neutrons in boron or hydrogen *creates* new
    gammas the shield must then stop — the step most often forgotten.

**Flags.** Section boundary. Buildup-factor magnitudes are standard; whether Murray tabulates B or
treats it qualitatively is unverified.

**Cross-check.** DOE covers attenuation, HVL, and shielding materials; buildup is treated more
lightly.

---

# Chapter 12 — Radiation Detection

## §12.1 — Principles of Gas-Filled Detectors

**STATUS: PENDING** · Lesson 18 — Detection Methods: Gas-Filled Detectors

**Physics.**
- **Everything in this chapter rests on one idea: radiation is detected only through the ionization
  it produces**, directly or via secondaries (§5.1). Nothing detects a photon or a neutron itself.
- In a gas, **≈ 34 eV of deposited energy produces one ion pair** (the W-value), so the collected
  charge is proportional to energy deposited — the basis of every quantitative measurement.
- **The six voltage regions of a gas-filled detector are the organizing structure of §§12.1–12.3:**

  | region | behavior | used as |
  |---|---|---|
  | recombination | ions recombine before collection | — |
  | **ionization chamber** | all pairs collected, **no multiplication** | dose-rate meters |
  | **proportional** | avalanche, **gain ∝ applied voltage**, pulse ∝ energy | spectroscopy, neutrons |
  | limited proportional | space charge distorts proportionality | — |
  | **Geiger–Müller** | full avalanche, **pulse independent of energy** | survey meters |
  | continuous discharge | self-sustaining; **damages the tube** | — |

- *That one device spans "measures energy precisely" to "cannot measure energy at all" purely by
  changing the voltage is the most satisfying idea in the chapter.*

**Flags.** Section boundaries across 12.1–12.3 are inferred; Murray may treat the regions in one
section rather than three. W ≈ 34 eV is for air; it varies by fill gas.

**Cross-check.** DOE NP-04 (or the detector volume) covers gas-filled detector regions well.

---

## §12.2 — Ionization Chambers and Proportional Counters

**STATUS: PENDING** · Lesson 18 — Detection Methods: Gas-Filled Detectors

**Physics.**
- **Ionization chamber** — no gas multiplication, so the signal is small and needs sensitive
  electronics. Usually run in **current mode**, integrating many events.
  - **Extremely stable, no dead-time problem at high rates, and its reading is proportional to
    energy deposited — so it measures *dose rate* honestly.** The instrument of choice in a strong
    field, where a GM tube would be saturating.
- **Proportional counter** — gas multiplication of **10²–10⁴**, with pulse height still proportional
  to the initial ionization.
  - **Can distinguish alpha from beta by pulse height** in the same detector, which a GM tube cannot
    do at all.
  - **BF₃ and ³He tubes are proportional counters** used as the standard thermal-neutron detectors
    (§12.6), where the large Q of the converter reaction puts neutron pulses well above the gamma
    background.
  - Needs a stable high-voltage supply, since gain depends steeply on voltage.

**Flags.** Section boundary and whether these are one section or two. Gas-multiplication ranges are
standard.

**Cross-check.** DOE covers ion chambers and proportional counters.

---

## §12.3 — Geiger–Müller Counters

**STATUS: PENDING** · Lesson 18 — Detection Methods: Gas-Filled Detectors

**Physics.**
- At high voltage a single ion pair triggers an **avalanche that propagates along the whole anode**.
  The result: **every pulse is the same size regardless of the energy or type of the initiating
  radiation.**
- **Consequences, and the trade is the section's point:**
  - **Large, uniform pulse → cheap, rugged, simple electronics, no amplifier.** The classic survey
    meter and the sound everyone recognizes.
  - **No energy information whatsoever.** A GM tube counts events; it cannot identify a nuclide or
    measure dose properly, and converting counts to dose requires assuming an energy spectrum.
- **A quench gas** (halogen or organic) stops the avalanche; without it the tube discharges
  continuously and destroys itself.
- **Dead time ≈ 100 µs** — long, so the tube **undercounts at high rates**, and the correction
  `n_true = n_obs/(1 − n_obs·τ)` grows quickly.
- ***The genuine hazard worth stating: in a very intense field a GM tube can saturate and read low —
  or read near zero — while the operator believes the area is safe.*** This is why ion chambers are
  used for high-range survey, and it is the most consequential single fact in Chapter 12.

**Flags.** Section boundary. Dead-time value is typical, not universal.

**Cross-check.** DOE covers GM operation, quenching, and dead time.

---

## §12.4 — Scintillation Detectors

**STATUS: PENDING** · Lesson 19 — Detection Methods: Scintillation, Semiconductor, and Dosimetry

**Physics.**
- Radiation excites the scintillator, which **emits visible light**; a **photomultiplier tube**
  converts that to photoelectrons and multiplies them ~10⁶ into a measurable pulse. **Pulse height
  remains proportional to deposited energy**, so scintillators do spectroscopy.
- **Material determines the application:**
  - **NaI(Tl)** — high Z (iodine) and high density give **good gamma efficiency**; the workhorse of
    field gamma spectroscopy. Resolution **≈ 7% at 662 keV**. Hygroscopic, so it must be sealed.
  - **Organic / plastic** — fast (ns), low Z, poor gamma efficiency; good for **beta and fast
    neutrons**, and for timing and large-area coverage.
  - **ZnS(Ag)** — alpha counting, in thin layers only.
- **A gamma spectrum has recognizable structure**, and reading it is the practical skill:
  **photopeak** (full energy), **Compton continuum with its edge**, **backscatter peak**, and for
  E > 1.022 MeV the **single- and double-escape peaks** from pair production (§5.3). *Every feature
  maps directly to one of Ch. 5's three interaction mechanisms, which makes this the best
  integrative probe available in the course.*

**Flags.** Section boundary across 12.4–12.6. Resolution figures are typical values.

**Cross-check.** DOE covers scintillation detectors and PMTs.

---

## §12.5 — Semiconductor Detectors

**STATUS: PENDING** · Lesson 19 — Detection Methods: Scintillation, Semiconductor, and Dosimetry

**Physics.**
- A reverse-biased semiconductor diode is a **solid-state ionization chamber**: radiation creates
  **electron–hole pairs** in the depletion region and the field collects them.
- **The decisive number is ≈ 3 eV per electron–hole pair, versus ≈ 34 eV per ion pair in gas.**
  About **ten times more charge carriers per unit energy**, so the Poisson counting statistics
  (§3.5, σ = √N) are ~√10 better — and **energy resolution improves by roughly the same factor.**
  *This is the cleanest example in the course of a statistical argument driving an engineering
  choice.*
- **HPGe (high-purity germanium)** — resolution **≈ 2 keV at 1.33 MeV**, against NaI's ~70 keV. Good
  enough to **identify individual nuclides by peak position** in a complex mixture, which is what
  makes it the standard for safeguards, forensics, and environmental assay.
  - **Cost: it must be cooled to liquid-nitrogen temperature** or thermal noise swamps the signal —
    the reason NaI survives despite far worse resolution.
- **Silicon** detectors for charged particles and alpha spectroscopy; **CZT** offers moderate
  resolution at room temperature.

**Flags.** Section boundary. Resolution and pair-creation energies are standard values.

**Cross-check.** DOE covers semiconductor detectors more briefly; **moderate confidence.**

---

## §12.6 — Neutron Detection

**STATUS: PENDING** · Lesson 19 — Detection Methods: Scintillation, Semiconductor, and Dosimetry

**Physics.**
- **Neutrons produce no ionization directly**, so every neutron detector is really a **charged-
  particle detector plus a converter reaction** — the unifying idea of the section.
- **Thermal-neutron converters**, chosen for large cross section and large Q:
  - **¹⁰B(n,α)⁷Li** — Q = 2.79 MeV; **BF₃ proportional counters**, and boron-lined chambers.
  - **³He(n,p)³H** — Q = 0.76 MeV; higher efficiency, but supply-constrained and expensive.
  - **⁶Li(n,α)³H** — Q = 4.78 MeV; lithium-glass scintillators.
  - **Fission chambers** — a ²³⁵U lining; fission fragments deposit ~160 MeV, giving an enormous
    pulse. Used **in-core**, where they survive conditions nothing else does.
- **Fast neutrons must be moderated first** (§4.2) — hence the **Bonner sphere**, a converter inside
  polyethylene of varying thickness, which is also how neutron *spectra* are unfolded.
- **Gamma discrimination is the practical problem**, since neutron fields are always accompanied by
  gammas. Solved by **pulse height** (the converter's MeV-scale Q dwarfs gamma events) or by
  **pulse-shape discrimination** in organic scintillators.

**Flags.** Section boundary. Q-values are exact; the ³He supply issue is real but may be too recent
for the edition.

**Cross-check.** DOE covers BF₃, ³He, and fission chambers well.

---

## §12.8 — Personnel Dosimetry

**STATUS: PENDING** · Lesson 19 — Detection Methods: Scintillation, Semiconductor, and Dosimetry

> **⚠ Lowest-confidence entry in Chapters 10–12.** The schedule jumps 12.6 → 12.8, so 12.7 is a
> section we do not cover — but **what §12.8 actually contains is a genuine guess**, inferred from
> the lesson topic and standard curriculum order. Personnel dosimetry is the most likely candidate;
> counting statistics and neutron activation analysis are plausible alternatives. **Verify the
> subject before verifying the content.**

**Physics.**
- Personnel dosimeters differ from survey instruments in purpose: they **integrate dose over weeks
  and are read out later**, rather than reporting a rate now.
- **Passive, integrating:**
  - **TLD (thermoluminescent)** — LiF or CaF₂ traps electrons; heating releases light proportional
    to accumulated dose. Reusable, tissue-equivalent, but **reading it erases it** — there is no
    second chance at a disputed result.
  - **OSL (optically stimulated luminescence)** — Al₂O₃, read with laser light. **Re-readable**,
    which is why it has largely displaced TLD.
  - **Film badge** — largely historical; gives a permanent visual record and can indicate radiation
    type by filter pattern.
- **Active, direct-reading:** electronic personal dosimeters give **real-time dose and rate with
  alarms**, which passive dosimeters cannot; pocket ion chambers are the older form.
- **The operational point: passive dosimeters are the legal record, active ones protect you during
  the job.** They serve different purposes and are worn together.

**Flags.** **The section subject itself is unverified — see the warning above.** All content here is
standard radiation-protection practice rather than recalled Murray text.

**Cross-check.** DOE covers TLD and pocket dosimeters; **low confidence on Murray's treatment.**

---

# Chapter 16 — Neutron Chain Reactions and Criticality

> **Chapter-level flag.** Chapter 6 covers fission and multiplication (Lesson 24) and Chapter 16
> covers criticality (Lesson 25), so **some content legitimately belongs to both** and the split
> between them is inferred. If Murray places the four-factor formula in one and not the other,
> move it rather than duplicating it.

## §16.1 — Criticality and Reactivity

**STATUS: PENDING** · Lesson 25 — Fission: Criticality

**Physics.**
- **k_eff** and the six-factor formula from §6.5, now as the working tool.
- **Reactivity `ρ = (k−1)/k`** in its practical units: **%Δk/k**, **pcm** (10⁻⁵ Δk/k), and
  **dollars** (`ρ/β`, so **$1.00 = prompt critical**).
- **Subcritical multiplication:** with a source present, the steady count rate is
  ```
  M = 1/(1 − k)
  ```
  so a subcritical assembly still sustains a neutron population — **"subcritical" does not mean
  "no neutrons."**
- **The 1/M plot is the operational payoff and the best probe in the section.** Plotting **inverse
  count rate against control-rod withdrawal (or fuel loading) extrapolates linearly to zero exactly
  at criticality**, so an operator can *predict* the critical point from safely subcritical
  measurements rather than discovering it by arriving there. This is the standard startup and
  fuel-loading procedure everywhere.

**Flags.** Section boundaries across 16.1–16.5 are inferred, and the overlap with §6.5 is real.
Whether Murray uses pcm or %Δk/k as primary.

**Cross-check.** DOE NP-03/NP-04 cover reactivity units, subcritical multiplication, and 1/M plots.

---

## §16.2 — Critical Mass, Size, and Geometry

**STATUS: PENDING** · Lesson 25 — Fission: Criticality

**Physics.**
- **Production and absorption scale with volume; leakage scales with surface area.** So a small
  assembly leaks proportionally more, and **there is a minimum size below which criticality is
  impossible at any enrichment.** This is §4.7's leakage argument cashed out.
- **A sphere has the smallest surface-to-volume ratio, so it has the smallest critical mass** of any
  shape — which is why criticality-safety rules restrict geometry, not just quantity.
- **Buckling** connects geometry to materials:
  - **Geometric buckling B_g²** depends only on shape and size — for a bare sphere, `(π/R)²`.
  - **Material buckling B_m²** depends only on composition — `(k∞ − 1)/L²`.
  - **Critical exactly when `B_g² = B_m²`** — the cleanest statement of criticality in the course.
- Bare-sphere critical masses, as magnitudes: **²³⁵U ≈ 52 kg**, **²³⁹Pu ≈ 10 kg**. **A good neutron
  reflector roughly halves these**, which is why reflection is a controlled parameter in
  criticality safety.
- **The criticality-safety controls** — mass, geometry, moderation, reflection, concentration, and
  **interaction between nearby units**. *The last one is the one that surprises people: two
  separately safe containers can be critical when placed side by side.*

**Flags.** Section boundary. Critical-mass figures are standard reference values, not Murray-
specific. Whether buckling is developed here or in a diffusion-theory section.

**Cross-check.** DOE NP-03 covers buckling, critical size, and leakage.

---

## §16.3 — Reactor Kinetics and Period

**STATUS: PENDING** · Lesson 25 — Fission: Criticality

**Physics.**
- **Point kinetics** treats the whole core as one lumped population plus delayed-neutron precursor
  groups.
- **Reactor period T** — the time for power to change by a factor of **e**:
  ```
  P(t) = P₀ e^(t/T)
  ```
  Short period = fast change. Operating procedures impose a **minimum period** (equivalently a
  maximum startup rate in decades/minute), and a period trip is a standard protection.
- **Delayed neutrons dominate the period** for ρ < β (§6.4). Mean generation time rises from
  ~10⁻⁴ s to ~0.1 s, so **a small reactivity insertion gives a period of seconds to minutes rather
  than milliseconds** — the difference between a controllable machine and one that is not.
- **Prompt jump** — a step reactivity insertion causes an immediate small power jump (prompt
  neutrons responding instantly) followed by a slow exponential ramp on the delayed-neutron
  timescale. *Recognizing the two timescales in one transient is the section's key skill.*
- **Above ρ = β ($1.00) the reactor is prompt critical**: the delayed neutrons are no longer needed
  and the period collapses toward the prompt generation time. **This is the boundary Chernobyl
  crossed**, which connects directly to §21.2.

**Flags.** Section boundary. Whether Murray derives point kinetics or states results. Whether the
inhour equation appears.

**Cross-check.** DOE NP-04 covers reactor period, startup rate, and prompt criticality thoroughly.

---

## §16.4 — Reactivity Coefficients and Feedback

**STATUS: PENDING** · Lesson 25 — Fission: Criticality

**Physics.**
- **A reactivity coefficient is the change in ρ per unit change in some parameter.** Negative
  coefficients make a reactor **self-regulating**: a power rise creates reactivity that reduces
  power. *This — not the control rods — is what actually holds a reactor stable, and it is the most
  important safety idea in the course.*
- **Fuel temperature (Doppler) coefficient — always negative, and uniquely valuable because it is
  prompt.** Hotter fuel broadens ²³⁸U's capture resonances (§4.6), capturing more neutrons. It acts
  **instantly with the fuel temperature**, before heat even reaches the coolant, so it opposes a
  power excursion faster than any engineered system could.
- **Moderator temperature coefficient** — negative in an **under-moderated** design, which is why
  LWRs are deliberately built under-moderated (§6.5).
- **Void coefficient** — the effect of steam voids:
  - **Negative in LWRs**, where water *is* the moderator, so losing it stops the chain reaction.
  - **Positive in the RBMK**, where **graphite** moderates and water mainly *absorbs* — so boiling
    removes an absorber and **adds** reactivity. **This design feature is the direct cause of
    Chernobyl**, and the contrast is the sharpest illustration in the book of why coefficient signs
    are a safety property rather than a technicality.
- **Power coefficient** is the sum of all of them and must be negative for stable operation.

**Flags.** Section boundary; whether the RBMK contrast is made here or held for Ch. 21.

**Cross-check.** DOE NP-03/NP-04 cover temperature, void, and power coefficients in depth.

---

## §16.5 — Control and Poisons

**STATUS: PENDING** · Lesson 25 — Fission: Criticality

**Physics.**
- **A fresh core must hold far more reactivity than criticality requires**, because fuel depletes
  and fission-product poisons build in over an 18–24 month cycle. **All that excess must be held
  down from day one**, and how you hold it down is the design problem.
- **Control rods** — strong thermal absorbers: **B₄C**, **Ag–In–Cd**, hafnium. Fast-acting, used for
  power maneuvering, shutdown, and **SCRAM** (rapid full insertion, gravity-driven in a PWR).
  Because they are local, they distort the flux shape.
- **Chemical shim** — **boric acid dissolved in PWR coolant**, adjusted slowly over the cycle. It is
  spatially uniform, so it holds down excess reactivity **without distorting power shape**, which
  rods cannot do. BWRs cannot use it (boiling would concentrate it) and use flow control instead.
- **Burnable poisons** — gadolinium or boron in or on the fuel, designed so that the poison **burns
  out at roughly the rate the fuel depletes**, flattening the reactivity curve across the cycle.
- **Fission-product poisons** from §6.3 — **¹³⁵Xe** with its ~2.6×10⁶ barn cross section and the
  post-shutdown **xenon transient**, plus **¹⁴⁹Sm** which saturates and stays.
- **Shutdown margin** — the requirement that the reactor stay subcritical with the **single
  highest-worth rod stuck fully out**. A single-failure criterion, and a good probe for why "it
  shuts down" is not the same as "it is safe."

**Flags.** Section boundary. Whether xenon is covered here or in §6.3 — likely both.

**Cross-check.** DOE NP-03 covers control rods, chemical shim, burnable poisons, and xenon well.

---

# Chapter 15 — Isotope Separation and Enrichment

> **Chapter-level flag.** Confidence drops here. The physics is standard and solid; **Murray's
> section organization and choice of examples are genuinely uncertain**, and DOE-HDBK-1019 does not
> cover the fuel cycle at all, so **there is no cross-check for any entry in Chapters 15, 21, or 23.**

## §15.1 — Principles of Isotope Separation

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- **The defining difficulty: ²³⁵U and ²³⁸U are chemically identical.** No chemical process separates
  them, so every method must exploit the **mass difference alone** — and that difference is tiny.
- **UF₆ is the working compound** because it is the only convenient volatile uranium compound, and
  because **fluorine is monoisotopic** (¹⁹F only), so all mass difference comes from the uranium.
  It sublimes near **56 °C**. Molecular masses **349 vs. 352 — a 0.85% difference**, which is what
  every separation technology has to work with.
- **Enrichment levels and why the thresholds exist:**
  - **Natural 0.72%** · **LEU 3–5%** for LWR fuel · **research/HALEU up to 20%**
  - **> 20% is HEU by definition** — the line at which material is considered weapons-usable
  - **~90% is weapons-grade**
- **Cascades:** one stage barely enriches, so stages are connected in series, with **enriched
  product flowing up and depleted material back down**. Feed splits into **product** and **tails**;
  the **tails assay** (typically 0.2–0.3%) is an economic choice, trading uranium ore against
  separative work.
- **SWU (separative work unit)** measures the separation effort independent of technology — the
  currency of the enrichment market.

**Flags.** Section boundaries across 15.1–15.4 are inferred. Enrichment thresholds are regulatory
definitions, not Murray-specific.

**Cross-check.** **None — DOE does not cover the fuel cycle.**

---

## §15.2 — Gaseous Diffusion

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- Based on **Graham's law**: at a given temperature molecules share average kinetic energy, so
  lighter ones move faster and **effuse through a porous barrier more often**, with rate ∝ 1/√M.
- **The ideal single-stage separation factor is tiny:**
  ```
  α = √(352/349) = 1.0043
  ```
  **0.43% enrichment per stage** — so producing LEU takes **on the order of 1,400 stages**, and
  weapons-grade takes several thousand.
- Consequences that define the technology: **enormous plants** and **enormous electricity demand**
  — the Oak Ridge K-25 building was among the largest in the world, and the US gaseous-diffusion
  plants at Paducah and Portsmouth consumed a measurable fraction of national electricity.
- **Now obsolete** — displaced entirely by centrifuges, with the last US plant closed in 2013.
  *That the historically dominant technology was abandoned for using ~50× too much energy is worth
  drawing out.*

**Flags.** Section boundary. The stage count is standard, but **check Murray's figure.** Plant
closure dates may postdate the edition.

**Cross-check.** **None.**

---

## §15.3 — Gas Centrifuge

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- A rapidly spinning rotor creates an enormous effective gravitational field; **the heavier ²³⁸UF₆
  concentrates toward the wall and the lighter ²³⁵UF₆ toward the axis.** A countercurrent axial flow
  (the **Zippe design**) multiplies the effect along the rotor's length.
- **Separation depends on the mass *difference*, not the mass ratio** — which is why centrifuges
  achieve **per-stage factors of ~1.1–1.3**, far better than diffusion's 1.0043, and need only
  **tens of stages** rather than thousands.
- **Roughly 50× less energy per SWU than gaseous diffusion**, which is why it displaced it entirely.
- ***The proliferation consequence is the point of the section:*** centrifuge cascades are
  **compact, modular, and low-power**, so they are far harder to detect than a diffusion plant —
  and adding stages to an existing cascade moves from reactor-grade to weapons-grade **without any
  new technology.** This is the central technical fact behind modern enrichment safeguards.

**Flags.** Section boundary; whether Murray treats the proliferation angle here or in a safeguards
chapter. Separation factors are typical ranges.

**Cross-check.** **None.**

---

## §15.4 — Other Methods and Enrichment Economics

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- **Electromagnetic (calutron)** — a mass spectrometer scaled up. Used at **Y-12 for the Hiroshima
  uranium**; hopelessly inefficient, but it needs no exotic materials, which is why **Iraq revived
  it in the 1980s** and why it remains a proliferation concern despite being obsolete.
- **Aerodynamic** — Becker nozzle and the South African Helikon vortex process. Simple, very
  energy-hungry.
- **Laser (AVLIS, MLIS, SILEX)** — tuned lasers selectively ionize or dissociate ²³⁵U-bearing
  molecules, exploiting the **isotope shift** in atomic spectra. **Potentially very high single-stage
  selectivity**, which is precisely why it is a safeguards concern; repeatedly pursued and
  repeatedly abandoned on engineering grounds.
- **Economics:** enrichment and uranium ore are **substitutes**. A lower tails assay extracts more
  ²³⁵U from the same ore but costs more SWU, so the **optimum tails assay tracks the uranium price**
  — when ore is expensive, operators strip the tails harder.
- **The nonproliferation problem stated plainly:** the same cascade that makes 5% fuel makes 90%
  weapons material. **Only the number of stages and the operating time differ, not the technology**
  — which is why enrichment capability, rather than any particular product, is what gets safeguarded.

**Flags.** Section boundary and **whether §15.4 is "other methods," economics, or both** — this
entry is a composite and may span more than one section.

**Cross-check.** **None.**

---

# Chapter 18 — Nuclear Reactor Systems

## §18.1 — Reactor Components and Concepts

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

**Physics.**
- **The functional pieces, each traceable to earlier physics:**
  - **Fuel** — **UO₂ pellets** (high melting point ~2800 °C, chemically stable) stacked in
    **Zircaloy cladding** (low neutron absorption, corrosion resistant) to form rods, bundled into
    assemblies.
  - **Moderator** — slows neutrons to thermal (§4.2). Light water, heavy water, or graphite.
  - **Coolant** — removes heat; in an LWR the same water does both jobs, which is what makes the
    void coefficient negative (§16.4).
  - **Control** — rods and soluble poison (§16.5). **Reflector** — returns leaked neutrons, reducing
    critical mass (§16.2). **Pressure vessel**, **biological shield**, **containment**.
- **Defense in depth — the successive physical barriers between fission products and the public:**
  **fuel matrix → cladding → reactor coolant system boundary → containment.** *Tracking which
  barriers failed is how each accident in §21.2 is best analyzed, so this list is worth holding
  onto.*
- **Thermal efficiency ~33%** for an LWR, limited by the Carnot ceiling at ~330 °C steam — **lower
  than a modern fossil plant**, because water-cooled reactors cannot run as hot. This is the driver
  behind high-temperature designs in §18.4.

**Flags.** Section boundaries across 18.1–18.5 are inferred, and **the schedule skips 18.3**, so
there is a section here we do not cover and cannot identify.

**Cross-check.** DOE NP-04 covers components and defense in depth; **moderate confidence.**

---

## §18.2 — Light Water Reactors: PWR and BWR

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

**Physics.**
- **Both are light-water moderated and cooled, so both need enriched fuel** (light water absorbs
  neutrons) and **both have a negative void coefficient.** Together they are the large majority of
  the world's power reactors.
- **PWR — pressurized water reactor**
  - **~15.5 MPa, so the coolant does not boil** in the core. Hot water goes to **steam generators**
    where a **separate secondary loop** boils.
  - **Two loops means the turbine is not radioactive** — a major maintenance advantage.
  - Uses **boric acid chemical shim** (§16.5); control rods enter **from the top** and drop in on
    SCRAM.
- **BWR — boiling water reactor**
  - **~7 MPa; water boils directly in the core** and steam goes straight to the turbine —
    **a direct cycle with no steam generators.** Simpler and lower pressure.
  - **The turbine is mildly radioactive** (¹⁶N), requiring shielding and access control.
  - **Control rods enter from the bottom** (the top is full of steam separators), so insertion is
    hydraulic rather than gravity-assisted. Power is also maneuvered by **recirculation flow**:
    more flow sweeps out voids, adding reactivity.
- *The PWR/BWR contrast is the best available case study in engineering trade-offs — neither is
  simply better, and every difference traces to the single choice of whether to boil in the core.*

**Flags.** Section boundary. Pressures and the efficiency figure are standard.

**Cross-check.** DOE NP-04 covers PWR and BWR designs; **good confidence on the physics.**

---

## §18.4 — Other Reactor Types

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

**Physics.**
- **CANDU / PHWR** — **heavy water** moderator absorbs so few neutrons that **natural uranium fuel
  works, with no enrichment at all.** Horizontal pressure tubes allow **on-line refueling**. Costs:
  expensive D₂O, a large core, and a **positive void coefficient**. *That avoiding enrichment is
  itself a proliferation concern — on-line refueling makes diverting fuel easier — is the interesting
  tension.*
- **Gas-cooled** — **Magnox** and **AGR** (CO₂, graphite, UK); **HTGR** with **TRISO** particle fuel
  and helium coolant, reaching **~750–950 °C outlet** for far better efficiency and process-heat
  applications. TRISO's coated-particle containment is a **fuel-level** barrier.
- **RBMK** — **graphite moderated, light water cooled.** Because the graphite does the moderating,
  water acts mainly as an **absorber**, giving a **positive void coefficient** (§16.4). No Western-
  style containment. **This is the Chernobyl design**, and its failure is architectural rather than
  operational.
- **Fast breeder (LMFBR)** — **no moderator at all**, so neutrons stay fast; **liquid sodium**
  coolant (excellent heat transfer, low neutron absorption, but burns in air and reacts violently
  with water). **Breeding ratio > 1** converts ²³⁸U to ²³⁹Pu faster than fuel is consumed,
  multiplying usable uranium resources by ~60×.

**Flags.** Section boundary, and **whether §18.3 (skipped by the schedule) contains some of this.**
Temperatures and breeding ratios are standard.

**Cross-check.** DOE covers reactor types lightly; **reduced confidence.**

---

## §18.5 — Advanced Reactors and Small Modular Reactors

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

> **⚠ Low-confidence entry.** **What §18.5 actually covers is a guess.** Advanced/SMR designs is the
> most likely candidate given the lesson topic; reactor operations, power conversion, or naval
> propulsion are plausible alternatives. **Verify the subject before verifying the content**, and
> note that an edition predating ~2020 may treat SMRs only briefly or not at all.

**Physics.**
- **Generation III+** — evolutionary LWRs (AP1000, EPR) emphasizing **passive safety**: cooling
  driven by gravity, natural circulation, and stored energy rather than by pumps and AC power.
  *The design response to Fukushima's station blackout (§21.2) is precisely this.*
- **SMRs** — under ~300 MWe, **factory-built and shipped**, trading economy of scale for economy of
  **series production**. A smaller core has a higher surface-to-volume ratio, which makes **passive
  decay-heat removal** genuinely feasible — the same geometry argument as §16.2, used for cooling
  instead of criticality.
- **Generation IV concepts** — molten salt (liquid fuel, atmospheric pressure, online reprocessing),
  sodium and lead fast reactors, very-high-temperature gas, supercritical water.
- **The common themes:** passive safety, higher outlet temperature for efficiency and process heat,
  and **closing the fuel cycle** to reduce the waste burden of §23.

**Flags.** **Section subject unverified — see the warning above.** All content is standard advanced-
reactor material rather than recalled Murray text.

**Cross-check.** **None.**

---

# Chapter 21 — Reactor Safety and Accidents

> **Chapter-level flag.** **No DOE cross-check exists for this chapter.** The accident narratives are
> well-documented history and I am confident in them; **Murray's section split and which accidents
> he treats at length are inferred from the lesson topic.**

## §21.1 — Reactor Safety Principles

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

**Physics.**
- **Defense in depth** — the successive barriers of §18.1, plus layered *strategies*: prevent the
  accident, detect and control it, mitigate consequences, and plan emergency response. **No single
  barrier is trusted.**
- **Redundancy, diversity, independence, and separation.** Redundancy alone is insufficient because
  **common-cause failure** defeats identical components simultaneously — which is exactly what a
  tsunami did to Fukushima's identical backup generators. *Diversity, not duplication, is the
  defense against common cause, and this distinction is the most useful idea in the section.*
- **The single-failure criterion** — safety functions must work with any one component failed,
  which is where §16.5's stuck-rod shutdown margin comes from.
- **Active vs. passive safety.** Active systems need power, signals, and operator or logic action;
  **passive systems rely on gravity, natural circulation, stored pressure, and material properties**
  and cannot be defeated by station blackout.
- **The safety functions are three, and everything else serves them:** control reactivity, **remove
  decay heat** (§6.3 — a shut-down reactor still needs cooling), and confine radioactivity.
- **PRA / probabilistic risk assessment** quantifies **core damage frequency** and identifies which
  sequences dominate — often the unglamorous ones like loss of offsite power, not the large pipe
  break the plant was designed around.
- **INES** — the 0–7 international event scale (Chernobyl and Fukushima both 7, TMI 5).

**Flags.** Section boundary between 21.1 and 21.2. Whether Murray covers PRA quantitatively.

**Cross-check.** **None.**

---

## §21.2 — Major Accidents

**STATUS: PENDING** · Lesson 31 — Nuclear Reactors: Basics, Components, Types, Accidents

**Physics.**
- **Three Mile Island (1979, INES 5) — an instrumentation and human-factors failure.**
  A stuck-open relief valve drained coolant while the control room indicated the valve had closed
  and pressurizer level read *high*, so operators **throttled back emergency injection** — the
  correct response to what the instruments showed and the opposite of what was needed. Roughly half
  the core melted. **Containment held; offsite dose was negligible.** *The physics worked and the
  human–machine interface failed, which is why TMI reshaped operator training and control-room
  design more than it changed reactor physics.*
- **Chernobyl (1986, INES 7) — a design failure, not merely an operating one.**
  An RBMK at low power during a test, outside its operating envelope, with a **positive void
  coefficient** (§16.4) and a **positive scram effect** — the control rods' graphite followers
  *added* reactivity in the first seconds of insertion. Power excursion to **prompt critical**
  (§16.3), steam explosion, and a graphite fire that lofted material for ten days. **No Western-style
  containment.** 28 acute radiation deaths; thousands of thyroid cancers from ¹³¹I in milk (§6.3),
  largely preventable with iodine prophylaxis and milk controls.
- **Fukushima Daiichi (2011, INES 7) — decay heat and common-cause failure.**
  The reactors **scrammed successfully** on the earthquake. The tsunami then flooded the emergency
  diesels and switchgear — **a common-cause failure of redundant-but-identical equipment** —
  producing **station blackout** and loss of **decay-heat removal** (§6.3). Fuel overheated;
  **zirconium cladding reacted with steam above ~1200 °C to generate hydrogen** (§18.1), which
  exploded and breached secondary containment. **No acute radiation deaths**, but the evacuation
  itself caused substantial mortality among vulnerable evacuees. *Weighing radiation risk against
  evacuation risk is a genuinely hard question and an excellent Socratic probe.*
- **The through-line worth drawing:** each accident failed a **different** barrier and a different
  safety function — instrumentation, reactor physics, and decay-heat removal respectively — which is
  the argument for defense in depth stated as history rather than as principle.

**Flags.** Section boundary; whether Murray treats all three at length and whether Fukushima appears
at all in this edition. Casualty figures are the mainstream consensus and are contested at the margins.

**Cross-check.** **None.**

---

# Chapter 23 — Radioactive Waste

> **Chapter-level flag.** **No DOE cross-check.** The schedule assigns only **23.1 and 23.5**, so
> three intervening sections are uncovered and the numbering is unverified.

## §23.1 — Waste Classification and Sources

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- **The US classification, which is by origin and regulation rather than purely by hazard:**
  - **HLW (high-level)** — spent fuel and reprocessing raffinate. **Tiny volume, nearly all the
    radioactivity.**
  - **TRU (transuranic)** — Z > 92 contaminated material above 100 nCi/g, mostly from weapons work;
    disposed at WIPP.
  - **LLW (low-level)**, **Classes A/B/C** by concentration — **huge volume, small activity**:
    contaminated clothing, tools, resins, decommissioning rubble.
  - **Uranium mill tailings** — enormous volume, low activity, long-lived; the largest waste stream
    by mass and the easiest to overlook.
- **Spent LWR fuel composition** after ~4–5 years, which drives everything downstream:
  **≈ 95% ²³⁸U · ≈ 1% ²³⁵U · ≈ 1% plutonium · ≈ 3–4% fission products and minor actinides.**
  *Most of "waste" is unburned uranium — the fact that motivates reprocessing and makes the
  once-through cycle a policy choice rather than a technical necessity.*
- **Volume and hazard are inversely related, and this is the section's central point:** HLW is
  ~1% of volume and >95% of activity. **Fission products (§6.3) dominate the first ~300 years**
  (¹³⁷Cs, ⁹⁰Sr, both ~30 y); **minor actinides dominate after that**, which is why the timescale
  argument in §23.5 turns on the actinides.

**Flags.** Section number and whether Murray uses the US regulatory taxonomy or the IAEA one.
Composition percentages depend on burnup.

**Cross-check.** **None.**

---

## §23.5 — Disposal and Geological Repositories

**STATUS: PENDING** · Lesson 32 — Fuel Cycle: Isotope Separation, Waste

**Physics.**
- **Deep geological disposal is the international consensus** — several hundred metres down, in
  stable rock, relying on a **multi-barrier system** in which no single barrier is trusted (the same
  logic as §21.1):
  **waste form** (borosilicate glass, or the spent-fuel ceramic itself) → **corrosion-resistant
  canister** (copper or steel) → **buffer/backfill** (bentonite clay, which swells to seal and
  retards water) → **host rock** (granite, clay, salt) → **depth and geologic stability**.
- **The timescale is the hard part.** Spent fuel's radiotoxicity falls to that of the original
  uranium ore in **~100,000–200,000 years**, driven by the minor actinides. **Partitioning and
  transmutation** could cut that to ~1,000 years by burning the actinides in fast reactors — which is
  why §18.4's fast reactors and this chapter are the same conversation.
- **Current status is the honest, uncomfortable part:** **Finland's Onkalo is the first repository to
  reach operation**; Sweden has licensed Forsmark; **Yucca Mountain was defunded in 2010 and the US
  has no repository**, leaving spent fuel in **pools and dry casks at reactor sites** — interim
  storage that has lasted decades.
- ***The genuinely interesting question, and the one worth probing:*** the technical barriers are
  well understood while the **social and institutional** ones — consent, siting, and communicating
  hazard across geological time — are not. **Nuclear waste is close to a solved physics problem and
  an unsolved political one**, and saying so plainly is more honest than either the "too dangerous
  to manage" or the "already solved" framing.

**Flags.** Section number and scope. **Repository status changes** — Onkalo's operational date and
US policy may have moved since the edition. Timescale figures vary by source and assumption.

**Cross-check.** **None.**
