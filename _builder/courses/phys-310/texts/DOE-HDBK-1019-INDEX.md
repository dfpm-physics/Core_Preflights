# DOE-HDBK-1019/1-93 and /2-93 — section index

**Nuclear Physics and Reactor Theory**, U.S. Department of Energy Fundamentals Handbook, January
1993, Rev. 0. Two volumes, four modules.

> **Distribution Statement A. Approved for public release; distribution is unlimited.**
> A U.S. Government work — public domain. **This is why it is the grounding source for PHYS 310:**
> it removes the copyright question rather than mitigating it, and nothing extracted from it
> constrains what a published artifact may carry.

| file | volume | modules |
|---|---|---|
| `doe_reactor_theory_v1.pdf` | 1 of 2 | NP-01 Atomic and Nuclear Physics · NP-02 Reactor Theory (Neutron Characteristics) |
| `doe_reactor_theory_v2.pdf` | 2 of 2 | NP-03 Reactor Theory (Nuclear Parameters) · NP-04 Reactor Theory (Reactor Operations) |

> **The two PDFs are gitignored — this index is committed, the files are not.** A fresh clone gets
> the index and no handbooks, so re-download them before the first grounding extraction. They are
> freely available: search for `DOE-HDBK-1019/1-93` and `DOE-HDBK-1019/2-93` (the handbooks are
> distributed through DOE's technical standards program and OSTI; the print edition carries NTIS
> Order No. DE93012221). Save them under `texts/` with the exact filenames above, because the
> profile and this index both refer to them by name.
>
> **Check what you downloaded before trusting it.** The first attempt at volume 2 here was an
> incomplete browser download that still carried a valid `%PDF-` header — it looked like a PDF and
> was missing half its bytes. Confirm the file *ends* correctly, and confirm the identity page:
>
> ```bash
> tail -c 8 texts/doe_reactor_theory_v2.pdf     # must show %%EOF
> ```
>
> Volume 1 is ~3.4 MB and its cover reads `DOE-HDBK-1019/1-93`; volume 2 is ~1.2 MB and reads
> `DOE-HDBK-1019/2-93`. **If your copy is a different revision, the page numbers below are wrong** —
> this index was built against Rev. 0, January 1993.

**Page numbers below are DOE's printed page numbers**, which restart at 1 in each module — the same
numbers you would cite. To reach them in the PDF, add the module offset in the table at the bottom.

---

## NP-01 — Atomic and Nuclear Physics  *(vol 1)*

| section | sub-topics | pp. |
|---|---|---|
| Atomic Nature of Matter | Structure of Matter · Subatomic Particles · Bohr Model · Measuring Units on the Atomic Scale · Nuclides · Isotopes · Atomic and Nuclear Radii · Nuclear Forces | 1–10 |
| Chart of the Nuclides | Chart of the Nuclides · Information for Stable Nuclides · Information for Unstable Nuclides · Neutron–Proton Ratios · Natural Abundance of Isotopes · Enriched and Depleted Uranium | 11–16 |
| Mass Defect and Binding Energy | Mass Defect · Binding Energy · Energy Levels of Atoms · Energy Levels of the Nucleus | 17–21 |
| Modes of Radioactive Decay | Stability of Nuclei · Natural Radioactivity · Nuclear Decay · Alpha Decay · Beta Decay · Electron Capture (EC, K-capture) · Gamma Emission · Internal Conversion · Isomers and Isomeric Transition · Decay Chains · Predicting Type of Decay | 22–29 |
| Radioactivity | Radioactive Decay Rates · Units of Measurement · Variation of Radioactivity Over Time · Radioactive Half-Life · Plotting Radioactive Decay · Radioactive Equilibrium · Transient Radioactive Equilibrium | 30–42 |
| Neutron Interactions | Scattering · Elastic Scattering · Inelastic Scattering · Absorption Reactions · Radiative Capture · Particle Ejection · Fission | 43–47 |
| Nuclear Fission | Fission · Liquid Drop Model of a Nucleus · Critical Energy · Fissile Material · Fissionable Material · Fertile Material · Binding Energy Per Nucleon (BE/A) | 48–55 |
| Energy Release from Fission | Calculation of Fission Energy · Estimation of Decay Energy · Distribution of Fission Energy | 56–62 |
| Interaction of Radiation with Matter | Alpha · Beta Minus · Positron · Neutron · Gamma Radiation | 63–67 |

**Figures** (22): Bohr model 3 · nuclide nomenclature 5 · nuclide chart 12 · stable/unstable nuclides 13 · n–p plot 14 · Ni-60 energy levels 20 · orbital electron capture 25 · decay types vs. line of stability 28 · decay vs. half-life 33 · N-16 linear/semi-log 37 · combined decay Fe-56/Mn-54/Co-60 38 · Na-24 cumulative production 39 · Na-24 approach to equilibrium 40 · Ba-140 transient equilibrium 41 · elastic scattering 44 · inelastic scattering 45 · liquid drop fission 50 · fertile→fissile conversion 52 · **BE/A vs. mass number 53** · U-235 fission yield 57 · change in BE for typical fission 58

---

## NP-02 — Reactor Theory: Neutron Characteristics  *(vol 1)*

| section | sub-topics | pp. |
|---|---|---|
| Neutron Sources | Neutron Sources · Intrinsic Neutron Sources · Installed Neutron Sources | 1–4 |
| Nuclear Cross Sections and Neutron Flux | Introduction · Atom Density · Cross Sections · Mean Free Path · Calculation of Macroscopic Cross Section and Mean Free Path · Effects of Temperature on Cross Section · Neutron Flux · Self-Shielding | 5–17 |
| Reaction Rates | Reaction Rates · Reactor Power Calculation · Relationship Between Neutron Flux and Reactor Power | 18–22 |
| Neutron Moderation | Neutron Slowing Down and Thermalization · Macroscopic Slowing Down Power · Moderating Ratio | 23–28 |
| Prompt and Delayed Neutrons | Neutron Classification · Neutron Generation Time | 29–32 |
| Neutron Flux Spectrum | Prompt Neutron Energies · Thermal and Fast Breeder Reactor Neutron Spectra · Most Probable Neutron Velocities | 33–37 |

**Figures:** absorption cross section vs. neutron energy 9 · prompt fission neutron spectrum (U-235) 33 · thermal vs. fast breeder flux spectra 34
**Tables:** neutron production by spontaneous fission 2 · **moderating properties of materials 27** · delayed neutron precursor groups (U-235) 30

---

## NP-03 — Reactor Theory: Nuclear Parameters  *(vol 2)*

| section | sub-topics | pp. |
|---|---|---|
| Neutron Life Cycle | Infinite Multiplication Factor k∞ · Four Factor Formula · Fast Fission Factor ε · Resonance Escape Probability p · Thermal Utilization Factor f · Reproduction Factor η · Effective Multiplication Factor · Fast Non-Leakage Probability · Thermal Non-Leakage Probability · **Six Factor Formula** · Neutron Life Cycle of a Fast Reactor | 1–16 |
| Reactivity | Application of the Effective Multiplication Factor · Reactivity · Units of Reactivity · Reactivity Coefficients and Reactivity Defects | 17–22 |
| Reactivity Coefficients | Moderator Effects · Moderator Temperature Coefficient · Fuel Temperature Coefficient · Pressure Coefficient · Void Coefficient | 23–29 |
| Neutron Poisons | Fixed Burnable Poisons · Soluble Poisons · Non-Burnable Poisons | 30–33 |
| Xenon | Fission Product Poisons · Production and Removal of Xe-135 · Xe-135 Response to Reactor Shutdown · Xe-135 Oscillations · Xe-135 Response to Reactor Power Changes | 34–42 |
| Samarium and Other Fission Product Poisons | Production and Removal of Sm-149 · Sm-149 Response to Reactor Shutdown · Other Neutron Poisons | 43–47 |
| Control Rods | Selection of Control Rod Materials · Types of Control Rods · Control Rod Effectiveness · Integral and Differential Control Rod Worth · Rod Control Mechanisms | 48–57 |

**Figures:** neutron life cycle with k_eff = 1 · 11 · over/under moderation effects on k_eff 25 · fuel temperature vs. resonance absorption peaks 27 · equilibrium I-135/Xe-135 vs. flux 37 · Xe-135 reactivity after shutdown 38 · Xe-135 during power changes 40 · Sm-149 behavior in a typical LWR 46 · control rod effect on radial flux 50 · integral rod worth 51 · differential rod worth 52 · rod worth curves 53, 56
**Tables:** average number of neutrons liberated in fission 7

---

## NP-04 — Reactor Theory: Reactor Operations  *(vol 2)*

| section | sub-topics | pp. |
|---|---|---|
| Subcritical Multiplication | Subcritical Multiplication Factor · Effect of Reactivity Changes on Subcritical Multiplication · Use of 1/M Plots | 1–9 |
| Reactor Kinetics | Reactor Period · Effective Delayed Neutron Fraction · Effective Delayed Neutron Precursor Decay Constant · Prompt Criticality · Stable Period Equation · Reactor Startup Rate (SUR) · Doubling Time | 10–22 |
| Reactor Operation | Startup · Estimated Critical Position · Core Power Distribution · Power Tilt · Shutdown Margin · Operation · Temperature · Pressure · Power Level · Flow · Core Burnup · Shutdown · Decay Heat | 23–34 |

---

## Finding a section in the PDF

DOE page numbers restart per module, so a PDF page needs the module's offset.

| module | PDF page = DOE page + | status |
|---|---|---|
| NP-01 (vol 1) | **24** | measured 2026-07-30: v1 PDF 25 = NP-01 page 1 |
| NP-02 (vol 1) | **104** | measured 2026-07-30: v1 PDF 111 = NP-02 page 7 |
| NP-03 (vol 2) | *not yet measured* | vol 2 PDF 13 = NP-03 page i |
| NP-04 (vol 2) | *not yet measured* | vol 2 PDF 83 = NP-04 title page; PDF 85 = NP-04 page i |

> **Both measured offsets came in different from the inferred ones**, which is why the warning
> below is not boilerplate. NP-02 was recorded as 106, inferred from a roman-numeral anchor; the
> real value is 104. An extraction run on the inferred number lands two pages late and looks
> plausible the whole way. **Measure against an arabic-numbered body page, not front matter** —
> roman and arabic numbering restart independently within a module.

**Verified anchors** — these were read directly, not computed:

| PDF page | is |
|---|---|
| v1 p13 | NP-01 TOC, page i |
| v1 p16 | NP-01 list of figures, page iv |
| v1 p23 | NP-01 objectives, page xi |
| **v1 p25** | **NP-01 page 1** — "Atomic Nature of Matter" opening |
| v1 p95 | NP-02 TOC, page i |
| v1 p104 | NP-02 objectives, page x |
| v1 p109 | NP-02 page 5 — "Nuclear Cross Sections and Neutron Flux" objectives |
| **v1 p111** | **NP-02 page 7** — atom-density worked example |
| v2 p13 | NP-03 TOC, page i |
| v2 p83 | NP-04 title page |
| v2 p85 | NP-04 TOC, page i |

### Searching the text layer

`pdftotext` is installed on this machine, and a whole-volume text dump is far faster than paging
through images when the question is "does DOE cover X at all":

```bash
pdftotext -layout texts/doe_reactor_theory_v1.pdf /tmp/doe_v1.txt
grep -n -i "atomic mass unit" /tmp/doe_v1.txt
```

Dump to a scratch directory, never into `texts/` — a derived text file next to the PDFs is one
`git add .` away from committing what the `.gitignore` exists to keep out.

---

## Known grounding gaps

Recorded as they are found, so the next build does not re-discover them. See "Where DOE genuinely
does not cover a Murray topic" below.

| topic | what DOE does | needed instead |
|---|---|---|
| **the amu defined against carbon-12** | NP-01 p. 4 gives `1 amu = 1.66 × 10⁻²⁴ g` and then says *"The reason for this particular value for the atomic mass unit will be discussed in a later chapter."* **It never is** — searching both volumes finds exactly one mention of carbon-12, and it is an unrelated decay product. The definition is in the *Chemistry* Fundamentals Handbook, which is a different DOE publication we do not hold | a short supplement from NIST (also a U.S. Government work, also public domain) giving `1 u ≡ 1/12` the mass of a neutral C-12 atom, and the bridge it creates: `1 amu × N_A = 1 g/mol`, which is why the periodic table's number serves as both amu-per-atom and grams-per-mole. Used in the *Energy, Atoms, and Nuclei* build |

**Probe one page before extracting a range.** Front matter length varies by module — NP-02 alone
runs to page xii — so an offset carried over from another module lands in the wrong place, and a
grounding extraction that silently starts three pages late is exactly the kind of gap that becomes
a tutor hallucination in front of cadets.

---

## How this gets used

recker supplies the Murray & Holbert sections for a lesson; the corresponding DOE sections are
looked up here and those pages become that lesson's grounding extraction.

**Record the DOE section in the schedule's `Reading` column**, not just the Murray one — the whole
point of grounding in a public-domain source is lost if nobody can tell six months later which text
actually grounded lesson 7.

**Where DOE genuinely does not cover a Murray topic, say so rather than stretching a nearby
section.** DOE-HDBK-1019 is reactor-operator training: it is strong on reactor physics, neutron
economy, poisons, and kinetics, and it is *not* a general nuclear-science survey. Expect real gaps
around topics like radiation detection and instrumentation, medical and industrial isotope
applications, fusion, nuclear astrophysics, and detailed weapons-adjacent history — none of which
this handbook set is trying to teach. A lesson landing in a gap needs its own grounding source, and
that decision belongs in the schedule row where the next person will see it.
