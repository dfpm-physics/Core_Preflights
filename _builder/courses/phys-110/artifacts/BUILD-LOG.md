# PHYS 110 — Preflight Artifact Build Log

**Fall 2026 · General Physics I — Mechanics.** One row per lesson artifact. Appended in lesson
order, not chronological order, so the table reads as a build queue.

**What this file is for:** reviewing what was built and registering it. The `Registration slug` and
`Published` rows are the two values a prefill link is made of — the exact `#i=` / `id=` string and
the artifact's public URL. Copy them from here rather than retyping, and regenerate a link per
[`docs/operations/PREFILL-LINK.md`](../../../docs/operations/PREFILL-LINK.md). **The published URL
lives nowhere else in this repository**, it is not derivable from the source, and it is the only
pointer from a lesson back to the exact build a cadet is running.

> **EVERY ROW HERE EXCEPT LESSON 10 IS A BACKFILL, written 2026-08-19.** Lesson 10 was
> built from the kit in this repository on 2026-08-21 and is the first that was; its row
> carries the grounding, checks and decisions the rows below could not.
>
> **(Original note, still true of the other five.)** These five artifacts were built outside
> this repository and published straight to claude.ai; their `.jsx` reached the library on
> 2026-08-19 and this log was written from them at the same time. There is no build history to
> record, and none is invented below — what each row carries is what could be **sourced**.
>
> **The `Published` date is the REGISTRATION date, taken from `app.activities.created_at` in the
> live database, and it is an upper bound rather than the publication date.** An artifact is
> published on claude.ai before its lesson row can point at it, so the true date is that day or
> earlier. It is labelled this way rather than guessed because a fabricated date in this column is
> indistinguishable from a real one, and this file is the only record.
>
> **What is genuinely absent, and why it is left absent:** grounding sections, cross-checks,
> probe-topic pacing, and build-time confirmations. Nobody in this repository observed those
> builds. A plausible reconstruction would read exactly like PHYS 215's real ones.

> **These builds use a different objective convention, and it costs one thing.** They carry no
> `Reports under objective key:` lines, so `artifact_parse.py` cannot bind a probe topic to its
> objective key and every objective reports `missing_prose`. **Accept/reject still works** — the
> keys and labels parse from `OBJECTIVE_KEYS`, four per artifact — but the reviewer sees an
> objective's label without its descriptive paragraph. Future PHYS 110 builds made from the kit
> will carry the lines and will not have this gap.

> **`check_artifact.py` reports 31 passed / 1 failed on all five, and the one failure is a false
> positive.** The `[]`-balance check counts brackets across the whole file including string
> literals, and each artifact contains `const EXT_TRIGGER_MARK = "[The report above is complete";`
> — one unmatched `[` inside a quoted string. PHYS 215 and PHYS 310 carry no such constant, which
> is why the check has never fired before. *(A second failure, `INTERACTION_ID` reported as `''`,
> was a real defect in the checker and was fixed the same day: these builds wrap the declaration
> onto a second line and the pattern required it on one.)*

## Built

### Lesson 2 — 1-D Motion / Position, Velocity, Acceleration

| | |
|---|---|
| **File** | [`lesson_02_preflight_1d_motion.jsx`](lesson_02_preflight_1d_motion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-02-1-d-motion-position-velocity-and-acceleration-b17964f2` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/a894f7d4-d4ec-4142-9e6f-efa138a12998 |
| **Built** | unknown — built outside this repository |
| **Grounding** | not recorded; see the callout above |
| **Probe topics** | 4 objectives, prose not bound to keys (see callout) |
| **Checks** | `check_artifact.py` 31 passed / 1 failed — the failure is the `[]` false positive described above |
| **Status** | **PUBLISHED and REGISTERED**, carrying credit as `practice` in Fall 2026. Source added to the library 2026-08-19; the date above is the registration date, an upper bound on publication |

### Lesson 7 — LAB 1: Projectile Motion

| | |
|---|---|
| **File** | [`lesson_07_preflight_lab1_projectile.jsx`](lesson_07_preflight_lab1_projectile.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-07-lab-1-projectile-motion-7e1c4080` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/effc3685-afa0-4518-b009-67afab91ac3a |
| **Built** | unknown — built outside this repository |
| **Grounding** | not recorded; see the callout above |
| **Probe topics** | 4 objectives, prose not bound to keys (see callout) |
| **Checks** | `check_artifact.py` 31 passed / 1 failed — the failure is the `[]` false positive described above |
| **Status** | **PUBLISHED and REGISTERED**, carrying credit as `graded` in Fall 2026. Source added to the library 2026-08-19; the date above is the registration date, an upper bound on publication |

### Lesson 8 — Intro to Newton's Laws

| | |
|---|---|
| **File** | [`lesson_08_preflight_newtons_laws.jsx`](lesson_08_preflight_newtons_laws.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-08-intro-to-newtons-laws-9667eba1` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/fff82ba5-622d-4a9b-b574-8bc8b6b6d22d |
| **Built** | unknown — built outside this repository |
| **Grounding** | not recorded; see the callout above |
| **Probe topics** | 4 objectives, prose not bound to keys (see callout) |
| **Checks** | `check_artifact.py` 31 passed / 1 failed — the failure is the `[]` false positive described above |
| **Status** | **PUBLISHED and REGISTERED**, carrying credit as `graded` in Fall 2026. Source added to the library 2026-08-19; the date above is the registration date, an upper bound on publication |

### Lesson 9 — Application of Newton's Laws / Friction

| | |
|---|---|
| **File** | [`lesson_09_preflight_applications_newtons_laws.jsx`](lesson_09_preflight_applications_newtons_laws.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-09-application-of-newtons-laws-6a66195f` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/43b0c10b-ab00-4faf-8ea9-f56b1f01de03 |
| **Built** | unknown — built outside this repository |
| **Grounding** | not recorded; see the callout above |
| **Probe topics** | 4 objectives, prose not bound to keys (see callout) |
| **Checks** | `check_artifact.py` 31 passed / 1 failed — the failure is the `[]` false positive described above |
| **Status** | **PUBLISHED and REGISTERED**, carrying credit as `graded` in Fall 2026. Source added to the library 2026-08-19; the date above is the registration date, an upper bound on publication |

### Lesson 10 — LAB 2: Newton's Laws

| | |
|---|---|
| **File** | [`lesson_10_preflight_lab2_newtons_laws.jsx`](lesson_10_preflight_lab2_newtons_laws.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-10-lab-2-newtons-laws-b9d4356a` |
| **Published** | 2026-08-21 — https://claude.ai/public/artifacts/c5ec5c2c-2242-4adf-b632-26df838e8de8 — published by the course director from a Claude session, URL pasted back rather than derived |
| **Built** | 2026-08-21, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-07-lab-1-projectile-motion-7e1c4080`; only the header, `INTERACTION_ID`, `OBJECTIVE_KEYS`, `TEXTBOOK_REFERENCE`, `LESSON_CONFIG`, `EXTENSION_PROBLEMS`, one wrong-claim example and two UI titles differ. Spliced in **bytes**, LF preserved (2274 lines) |
| **Grounding** | PHYS 110 Fall 2026 Lab 2 Instructions, *Determining the Coefficient of Friction*, 01 Aug 2026, all 3 pp. incl. rubric; USAFA Core Physics Laboratory Manual Fall 2026, §§II–VI and the §IX worked propagation example (read pp. 1–11); OpenStax Univ. Physics Vol. 1 friction treatment as supporting material. Historical value for the experiment: µk = 0.46 ± 0.02 |
| **Probe topics** | 4 — `isolating-friction`, `constant-accel-model`, `linearization-slope`, `uncertainty-meaning`. Prose bound to keys (unlike the five backfilled rows) |
| **Extensions** | 4 (A–D), each arithmetic pass verified twice in-source. A/B/C share one apparatus (m₁ = 0.250 kg, 30.0°, m₂ = 0.500 kg) and converge on µk ≈ 0.46 by two independent routes — timing and graph slope |
| **Checks** | `check_artifact.py` **31 passed / 1 failed**. The failure is the known `[]` false positive from `EXT_TRIGGER_MARK`; verified identical (delta = +1) on the untouched template, so nothing was introduced. `localize.py` leftover scan clean; `verify.py` 22/22 on the kit |
| **Scope decisions** | CONCEPTUAL, carried forward from LAB 1: the tutor never asks a cadet to type out or manipulate a derivation — that is worth 3.5 rubric points in the written report. Uncertainty is the **standard deviation of the mean** (what the supplied Excel template computes); a cadet raising maximum deviation is *not* confused, since the manual teaches it and says PHYS 110 often uses it. Static-friction bonus is engage-only. Cadets take this **before** the experiment, so probe preparation, never results |
| **Deviation from the approved preview** | Probe topics 1–2 were approved in a derivation-framed form and were **rewritten conceptually** to match LAB 1's recorded instructor decision. Flagged to the director at hand-off; reverting to the derivation framing is a rebuild |
| **Status** | **PUBLISHED 2026-08-21.** Registered on the existing `preflight-10` lesson as its second activity via prefill (`id=preflight-10`, `iid=lesson-10-lab-2-newtons-laws-b9d4356a`), alongside `phys-110-preflight-10-written`, `policy=choice`. Lesson 10 had no interactive activity before this build, so the slug is fresh |

### Lesson 11 — Newton's Laws with Circular Motion

| | |
|---|---|
| **File** | [`lesson_11_preflight_circular_motion.jsx`](lesson_11_preflight_circular_motion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-11-circular-motion-centripetal-force-11e3a6a5` |
| **Published** | 2026-08-20 — https://claude.ai/public/artifacts/6ffa9e0b-f862-4c62-835b-68741fd68762 |
| **Built** | unknown — built outside this repository |
| **Grounding** | not recorded; see the callout above |
| **Probe topics** | 4 objectives, prose not bound to keys (see callout) |
| **Checks** | `check_artifact.py` 31 passed / 1 failed — the failure is the `[]` false positive described above |
| **Status** | **PUBLISHED and REGISTERED**, carrying credit as `graded` in Fall 2026. Source added to the library 2026-08-19; the date above is the registration date, an upper bound on publication |

### Lesson 12 — Application of Newton's Laws

| | |
|---|---|
| **File** | [`lesson_12_preflight_application_of_newtons_laws.jsx`](lesson_12_preflight_application_of_newtons_laws.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-12-application-of-newtons-laws-a97b17f8` |
| **Published** | 2026-08-22 — https://claude.ai/public/artifacts/9d71953d-0b91-4791-8cce-03cacff940a0 — URL verified by rendering the page and reading its title |
| **Built** | 2026-08-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-10-lab-2-newtons-laws-b9d4356a` (2301 lines, spliced in bytes, LF preserved) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 ch. 5 §§5.1–5.7 (pp. 194–241, incl. the chapter review summary) and ch. 6 §§6.1–6.3 (pp. 253–277). Read as page images across four targeted passes of the 90-page extract — the largest grounding read of any phys-110 artifact so far |
| **Probe topics** | 4 — `free-body-diagrams`, `net-force-vectors`, `multiple-objects`, `circular-acceleration`. **Mapped to the SYLLABUS learning objectives**, not invented: Obj 1-5, Obj 1-6, Obj 1-9, and Obj 1-7/1-8 respectively. Obj 1-1 (problem-solving strategy) runs through all four rather than being probed alone |
| **Extensions** | 4 (A–D), shaped like GR 1 questions. A is deliberately arithmetic-free (what belongs on a book's free-body diagram, third-law partners, and why the pair does not cancel). C and D reproduce the textbook's own worked values — 39.2 N and 1125 N / µ = 0.128. Every arithmetic pass verified twice in-source |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`; bracket delta +1, identical to the template |
| **Scope decisions** | CONSOLIDATION lesson, and written as one: it is the last lesson of the Newton's Laws block and sits immediately before **Graded Review 1**, which assesses syllabus Block 1. Nothing in it is new material; the tutor probes whether a cadet can still ASSEMBLE the block — pick a system, draw the diagram, write the equations — rather than whether they have met the ideas. The scope note steers away from energy, which begins next lesson. CONCEPTUAL per this course's standing decision |
| **Status** | **PUBLISHED 2026-08-22.** Registered on the existing `preflight-12` lesson as its second activity beside `phys-110-preflight-12-written`, `policy=choice` |

### Lesson 14 — Energy of a System / Work

| | |
|---|---|
| **File** | [`lesson_14_preflight_energy_of_a_system_work.jsx`](lesson_14_preflight_energy_of_a_system_work.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-14-energy-of-a-system-work-23ff79ca` |
| **Published** | 2026-08-22 — https://claude.ai/public/artifacts/95c0678e-bf20-4511-a833-9f8ff37288be — published by the course director; URL pasted back and then VERIFIED by rendering the page and reading its title, rather than trusting list order |
| **Built** | 2026-08-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-10-lab-2-newtons-laws-b9d4356a`; only the header, `INTERACTION_ID`, `OBJECTIVE_KEYS`, the three authored blocks, one wrong-claim example and two UI titles differ. Spliced in **bytes**, LF preserved (2225 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §7.1 (Work), pp. 312–319, with §2.4 (Products of Vectors), pp. 72–81, as the dot-product prerequisite. Read as page images: §7.1's equations are vector paths that every text extractor drops silently |
| **Probe topics** | 4 — `work-as-dot-product`, `work-sign`, `path-dependence`, `spring-work-quadratic`. Prose bound to keys |
| **Extensions** | 4 (A–D). A and D are single-substitution; B and C are the deliberate contrast — the same round trip costs 4.3 kJ against friction and exactly nothing against gravity. Every arithmetic pass verified twice in-source |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`; bracket delta is +1, identical to the template, so nothing was introduced |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision: the tutor never asks a cadet to type out or manipulate a derivation. Cadets take this **before** the lesson, so probe preparation, never results |
| **Status** | **PUBLISHED 2026-08-22.** Registered on the existing `preflight-14` lesson as its second activity beside `phys-110-preflight-14-written`, `policy=choice` |

### Lesson 15 — Varying Forces / Kinetic Energy

| | |
|---|---|
| **File** | [`lesson_15_preflight_varying_forces_kinetic_energy.jsx`](lesson_15_preflight_varying_forces_kinetic_energy.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-15-varying-forces-kinetic-energy-2e4badd6` |
| **Published** | 2026-08-22 — https://claude.ai/public/artifacts/ce277175-f460-4a3d-9dbc-42a05aa63b5f — published by the course director; URL pasted back and then VERIFIED by rendering the page and reading its title, rather than trusting list order |
| **Built** | 2026-08-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-10-lab-2-newtons-laws-b9d4356a`; only the header, `INTERACTION_ID`, `OBJECTIVE_KEYS`, the three authored blocks, one wrong-claim example and two UI titles differ. Spliced in **bytes**, LF preserved (2196 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§7.2–7.3, pp. 320–327 |
| **Probe topics** | 4 — `kinetic-energy-scaling`, `net-work-delta-k`, `normal-force-no-work`, `frame-dependence`. Prose bound to keys |
| **Extensions** | 4 (A–D). B asks for the general loop condition 5R/2 and then a specific case, so the cadet can check 37.5 cm < 45 cm against getting a real positive speed. Every arithmetic pass verified twice in-source |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`; bracket delta is +1, identical to the template, so nothing was introduced |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision: the tutor never asks a cadet to type out or manipulate a derivation. Cadets take this **before** the lesson, so probe preparation, never results |
| **Status** | **PUBLISHED 2026-08-22.** Registered on the existing `preflight-15` lesson as its second activity beside `phys-110-preflight-15-written`, `policy=choice` |

### Lesson 16 — Potential Energy / Nonconservative Forces

| | |
|---|---|
| **File** | [`lesson_16_preflight_potential_energy_nonconservative.jsx`](lesson_16_preflight_potential_energy_nonconservative.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-16-potential-energy-nonconservative-forces-52c7ef64` |
| **Published** | 2026-08-22 — https://claude.ai/public/artifacts/95d34901-0ea1-4da5-b01f-eda551cf4b32 — published by the course director; URL pasted back and then VERIFIED by rendering the page and reading its title, rather than trusting list order |
| **Built** | 2026-08-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-10-lab-2-newtons-laws-b9d4356a`; only the header, `INTERACTION_ID`, `OBJECTIVE_KEYS`, the three authored blocks, one wrong-claim example and two UI titles differ. Spliced in **bytes**, LF preserved (2251 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§8.1, 8.2 and 8.4, pp. 341–362 |
| **Probe topics** | 4 — `reference-point-arbitrary`, `system-not-object`, `conservative-test`, `reading-u-curve`. Prose bound to keys |
| **Extensions** | 4 (A–D). B asks for a prediction first because nearly everyone answers mg/k when the released-from-rest maximum stretch is 2mg/k. Every arithmetic pass verified twice in-source |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`; bracket delta is +1, identical to the template, so nothing was introduced |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision: the tutor never asks a cadet to type out or manipulate a derivation. Cadets take this **before** the lesson, so probe preparation, never results |
| **Status** | **PUBLISHED 2026-08-22.** Registered on the existing `preflight-16` lesson as its second activity beside `phys-110-preflight-16-written`, `policy=choice` |

### Lesson 17 — Conservation of Energy

| | |
|---|---|
| **File** | [`lesson_17_preflight_conservation_of_energy.jsx`](lesson_17_preflight_conservation_of_energy.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-17-conservation-of-energy-0fb9fc37` |
| **Published** | 2026-08-22 — https://claude.ai/public/artifacts/92136677-242d-4d59-ac58-9b9ca312ba03 — published by the course director; URL pasted back and then VERIFIED by rendering the page and reading its title, rather than trusting list order |
| **Built** | 2026-08-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Architecture inherited byte-for-byte from `lesson-10-lab-2-newtons-laws-b9d4356a`; only the header, `INTERACTION_ID`, `OBJECTIVE_KEYS`, the three authored blocks, one wrong-claim example and two UI titles differ. Spliced in **bytes**, LF preserved (2167 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §8.3, pp. 353–358 |
| **Probe topics** | 4 — `when-energy-conserved`, `system-and-reference`, `why-energy-method`, `energy-accounting`. Prose bound to keys |
| **Extensions** | 4 (A–D). B is the payoff: half the pendulum's speed is exactly a quarter of the height, which makes the v² dependence visible rather than asserted. Every arithmetic pass verified twice in-source |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`; bracket delta is +1, identical to the template, so nothing was introduced |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision: the tutor never asks a cadet to type out or manipulate a derivation. Cadets take this **before** the lesson, so probe preparation, never results |
| **Status** | **PUBLISHED 2026-08-22.** Registered on the existing `preflight-17` lesson as its second activity beside `phys-110-preflight-17-written`, `policy=choice` |

### Lesson 19 — LAB 3: Conservation of Energy

| | |
|---|---|
| **File** | [`lesson_19_preflight_lab3_conservation_of_energy.jsx`](lesson_19_preflight_lab3_conservation_of_energy.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-19-lab-3-conservation-of-energy-290e6de1` |
| **Published** | 2026-09-22 — https://claude.ai/public/artifacts/34dfff65-bb63-49d1-afab-0f09c0e648f5 — published by the course director |
| **Built** | 2026-09-22, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Note** | **Section added 2026-09-23, after the fact.** Lesson 19 was built and published without a section here, so the next `sync_artifacts.py push` would have catalogued it with no published URL. This section records only what is sourced (the file, its slug, the URL recorded on 2026-09-22); the build's detail is in `CHANGELOG.md` under 2026-09-22. Its study-mode prompt lacks the EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections the kit specifies — lessons 20–23 restore them; lesson 19 has not been patched |
| **Status** | **PUBLISHED 2026-09-22.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-19` lesson |

### Lesson 20 — Linear Momentum & 1-D Collisions

| | |
|---|---|
| **File** | [`lesson_20_preflight_linear_momentum_collisions.jsx`](lesson_20_preflight_linear_momentum_collisions.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-20-linear-momentum-1-d-collisions-e64195e3` |
| **Published** | 2026-09-23 — https://claude.ai/public/artifacts/1f883bde-e02c-4bf3-8e64-836260ecb884 — published by the course director; URL pasted back and then VERIFIED by loading the page and reading its title, rather than trusting list order |
| **Built** | 2026-09-23, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-19-lab-3-conservation-of-energy-290e6de1` (the first source carrying the 2026-08-21 fix set, `TUTOR-BEHAVIOR-PARITY.md` §5) by asserted once-only substitutions; only the header, `INTERACTION_ID`, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. The study-mode prompt carries the EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections the kit specifies — lesson 19 dropped them — restored from `lesson-14-energy-of-a-system-work-23ff79ca`. Spliced in **bytes**, LF preserved (2504 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 ch. 9 §§9.1–9.4, pp. 380–411, read as page images; all thirteen worked examples reproduced. The cadets' Cengage §§9.1–9.4 cover the same four topics. Example 9.13's page labels the car's speed `v_T,i`; it is the car's, 27.5 m/s |
| **Probe topics** | 4 — `momentum-vector`, `impulse-momentum`, `closed-system-conservation`, `collision-types-energy`. Prose bound to keys |
| **Extensions** | 4 (A–D): stopping versus bouncing (impulse is a change in momentum), a perfectly inelastic collision, an elastic collision with unequal masses, an explosion from rest. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3. Gemini build ported the same day and rendered to its start screen from a local static server |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. **REBUILT.** A first build dated 2026-09-18 was never published or registered and was replaced wholesale: invented worked examples in place of the reading's, a header copied from the Newton's Laws block, and an extension teaching that the Earth's momentum does not change. Slug stem corrected from `1d` to `1-d` per the generation rule, suffix `e64195e3` kept; that build's Gemini page (`lesson-20-linear-momentum-1d-collisions-e64195e3.html`) was removed from `site/gemini/` and `backup-builds.json` the same day |
| **Status** | **PUBLISHED 2026-09-23.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-20` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 21 — 2-D Collisions

| | |
|---|---|
| **File** | [`lesson_21_preflight_2d_collisions.jsx`](lesson_21_preflight_2d_collisions.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-21-2-d-collisions-bbf388ba` |
| **Published** | 2026-09-23 — https://claude.ai/public/artifacts/1707781c-669b-4d86-b5b3-c83a56d8002f — published by the course director; URL pasted back and then VERIFIED by loading the page and reading its title, rather than trusting list order |
| **Built** | 2026-09-23, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-19-lab-3-conservation-of-energy-290e6de1` (the first source carrying the 2026-08-21 fix set, `TUTOR-BEHAVIOR-PARITY.md` §5) by asserted once-only substitutions; only the header, `INTERACTION_ID`, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. The study-mode prompt carries the EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections the kit specifies — lesson 19 dropped them — restored from `lesson-14-energy-of-a-system-work-23ff79ca`. Spliced in **bytes**, LF preserved (2349 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 ch. 9 §9.5, pp. 412–419, read as page images. The lesson PDF ends mid-Example 9.15; the rest was read from p. 419 of the next section's PDF (v₃ = 106 m/s at 6.49°, 183.5°). Example 9.14's 59° is north of east — 31° east of north — whatever the page's label says |
| **Probe topics** | 3 — `component-conservation`, `vector-momentum-addition`, `closed-system-2d`. Prose bound to keys |
| **Extensions** | 4 (A–D): two vehicles meeting at right angles, an explosion from rest, a glancing collision of equal pucks, working backwards as an investigator would. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3. Gemini build ported the same day and rendered to its start screen from a local static server |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. **Three** probe topics, not four: §9.5 carries one idea — conserve momentum in each direction separately — and the skill's rule is 3 for a genuinely narrow lesson |
| **Status** | **PUBLISHED 2026-09-23.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-21` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 22 — Center of Mass / Systems of Particles

| | |
|---|---|
| **File** | [`lesson_22_preflight_center_of_mass_systems_of_particles.jsx`](lesson_22_preflight_center_of_mass_systems_of_particles.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-22-center-of-mass-systems-of-particles-b554fa74` |
| **Published** | 2026-09-23 — https://claude.ai/public/artifacts/7b37a4a5-0c58-4f1d-9267-e07368f60696 — published by the course director; URL pasted back and then VERIFIED by loading the page and reading its title, rather than trusting list order |
| **Built** | 2026-09-23, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-19-lab-3-conservation-of-energy-290e6de1` (the first source carrying the 2026-08-21 fix set, `TUTOR-BEHAVIOR-PARITY.md` §5) by asserted once-only substitutions; only the header, `INTERACTION_ID`, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. The study-mode prompt carries the EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections the kit specifies — lesson 19 dropped them — restored from `lesson-14-energy-of-a-system-work-23ff79ca`. Spliced in **bytes**, LF preserved (2405 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 ch. 9 §9.6, pp. 419–433, read as page images. The syllabus's "9.6–9.7" is Cengage numbering (Center of Mass; Systems of Many Particles), and both map wholly onto OpenStax §9.6, so the absence of rocket propulsion is correct. The PDF ends mid-sentence on p. 433; the grounding says so rather than reconstructing it |
| **Probe topics** | 4 — `cm-weighted-average`, `internal-forces-cancel`, `cm-follows-external-force`, `cm-velocity-constant`. Prose bound to keys |
| **Extensions** | 4 (A–D): two masses on a line, three masses with a center of mass where nothing is, two skaters pushing apart, a shell that explodes at the top. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3. Gemini build ported the same day and rendered to its start screen from a local static server |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision — which matters more than usual here, because the reading derives F_ext = M a_CM through a page of summations |
| **Status** | **PUBLISHED 2026-09-23.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-22` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 23 — LAB 4: Conservation of Momentum

| | |
|---|---|
| **File** | [`lesson_23_preflight_lab4_conservation_of_momentum.jsx`](lesson_23_preflight_lab4_conservation_of_momentum.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-23-lab-4-conservation-of-momentum-8004558e` |
| **Published** | 2026-09-23 — https://claude.ai/public/artifacts/216e1e26-15e9-46e5-8b08-00d68b7652e8 — published by the course director; URL pasted back and then VERIFIED by loading the page and reading its title, rather than trusting list order |
| **Built** | 2026-09-23, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-19-lab-3-conservation-of-energy-290e6de1` (the first source carrying the 2026-08-21 fix set, `TUTOR-BEHAVIOR-PARITY.md` §5) by asserted once-only substitutions; only the header, `INTERACTION_ID`, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. The study-mode prompt carries the EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections the kit specifies — lesson 19 dropped them — restored from `lesson-14-energy-of-a-system-work-23ff79ca`. Spliced in **bytes**, LF preserved (2401 lines) |
| **Grounding** | PHYS 110 Fall 2026 Lab 4 Instructions ("Conservation Laws During Collisions", 1 Aug 2026, 3 pp. including the rubric) as PRIMARY; OpenStax Univ. Physics Vol. 1 §§9.3–9.4 (the lesson 20 reading) as supplemental theory. Both read as page images |
| **Probe topics** | 4 — `lab4-closed-system`, `lab4-kinetic-energy-change`, `lab4-equal-mass-assumption`, `lab4-measurement-uncertainty`. Prose bound to keys |
| **Extensions** | 4 (A–D): one elastic trial and why kinetic energy is the touchier result, the ideal magnet collision, what if the masses are not quite equal, reporting a result and judging agreement. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3. Gemini build ported the same day and rendered to its start screen from a local static server |
| **Scope decisions** | LAB preflight, decisions carried forward from LABs 1–3: CONCEPTUAL (the report's Theory section is where derivation belongs); the reported uncertainty is the STANDARD DEVIATION OF THE MEAN, which the supplied Excel template computes; cadets take it BEFORE running the experiment, so probe preparation, never results. This lab has no bonus |
| **Status** | **PUBLISHED 2026-09-23.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-23` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 25 — Angular Position, Velocity, Acceleration

| | |
|---|---|
| **File** | [`lesson_25_preflight_angular_position_velocity_acceleration.jsx`](lesson_25_preflight_angular_position_velocity_acceleration.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-25-angular-position-velocity-acceleration-1c2027d2` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/197c967f-ff25-48d6-b31b-5f2cd3c82738 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2399 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 ch. 10 §§10.1–10.3, pp. 452–468, read as page images. The syllabus's "4.4–4.5" (Cengage: uniform circular motion; tangential and radial acceleration) maps onto §10.3's centripetal and tangential acceleration. The PDF ends mid-Example 10.7; its conclusion was read from p. 469 of lesson 26's PDF |
| **Probe topics** | 4 — `angular-variables`, `tangential-speed-radius`, `rotational-kinematics`, `centripetal-tangential-accel`. Prose bound to keys |
| **Extensions** | 4 (A–D): The merry-go-round; A ceiling fan starts up; Braking a wheel by the turn; Total acceleration of a rotor tip. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-25` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 26 — Vector Product / Torque / Moment of Inertia

| | |
|---|---|
| **File** | [`lesson_26_preflight_vector_product_torque_moment_of_inertia.jsx`](lesson_26_preflight_vector_product_torque_moment_of_inertia.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-26-vector-product-torque-moment-of-inertia-82254ba0` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/a4f86ae8-dba6-49a6-9211-9700267a438b — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2426 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §2.4 (the vector-product half, pp. 72–83), §10.4 (pp. 469–476) and §10.6 (pp. 485–489), read as page images. The boomerang example and Check Your Understanding 10.6 are cut off in this PDF; both were finished from pp. 477 and 490 of lesson 27's PDF |
| **Probe topics** | 4 — `cross-product-direction`, `torque-lever-arm`, `net-torque-sign`, `moment-of-inertia-distribution`. Prose bound to keys |
| **Extensions** | 4 (A–D): The wrench; Balancing a seesaw; Same rod, different axis; Who wins at the door?. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-26` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 27 — Moment of Inertia Applications

| | |
|---|---|
| **File** | [`lesson_27_preflight_moment_of_inertia_applications.jsx`](lesson_27_preflight_moment_of_inertia_applications.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-27-moment-of-inertia-applications-aa890e2b` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/294e05fb-92df-4ff2-b3d6-94a8b4a08387 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2359 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §10.5 (pp. 477–484) and §10.7 (pp. 490–493), read as page images. The PDF ends after Check Your Understanding 10.7, and the grounding stops there |
| **Probe topics** | 4 — `inertia-axis-dependence`, `parallel-axis-compound`, `rotational-second-law`, `rotational-energy-conservation`. Prose bound to keys |
| **Extensions** | 4 (A–D): The barbell, two ways; Spinning up a merry-go-round; Opening a heavy door; A falling meter stick. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-27` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 28 — Rotational Kinetic Energy / Rolling Motion

| | |
|---|---|
| **File** | [`lesson_28_preflight_rotational_kinetic_energy_rolling_motion.jsx`](lesson_28_preflight_rotational_kinetic_energy_rolling_motion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-28-rotational-kinetic-energy-rolling-motion-a86aff98` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/e205b1b9-038a-4c70-a84e-c19da07907ab — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2358 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §10.4 (pp. 469–476, the pages lesson 26 used) and §11.1 (pp. 516–522), read as page images. The Curiosity rover example is cut off on p. 522; its conclusion (9.63 m/s) was read from p. 523 of lesson 29's PDF |
| **Probe topics** | 4 — `rotational-kinetic-energy`, `rolling-without-slipping`, `rolling-friction-role`, `rolling-energy-shape`. Prose bound to keys |
| **Extensions** | 4 (A–D): How much of a bowling ball's energy is spin?; The race down the ramp; A sphere on a 30-degree slope; A bicycle wheel meets two hills. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-28` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 29 — Angular Momentum

| | |
|---|---|
| **File** | [`lesson_29_preflight_angular_momentum.jsx`](lesson_29_preflight_angular_momentum.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-29-angular-momentum-c706f9c3` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/c93ef00a-e9d4-4e0b-866c-5fb2fc4bc469 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2336 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §11.2, pp. 523–530, read as page images. The robot-arm example's solution and Check Your Understanding 11.3 were read from p. 531 of lesson 30's PDF |
| **Probe topics** | 4 — `particle-angular-momentum`, `torque-changes-l`, `system-angular-momentum`, `rigid-body-l-i-omega`. Prose bound to keys |
| **Extensions** | 4 (A–D): A car driving past; A ball on a string; Braking a grinding wheel; A dropped ball has angular momentum. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-29` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 30 — Conservation of Angular Momentum

| | |
|---|---|
| **File** | [`lesson_30_preflight_conservation_of_angular_momentum.jsx`](lesson_30_preflight_conservation_of_angular_momentum.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-30-conservation-of-angular-momentum-6886a2ac` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/0990ac82-24e6-4df1-b808-3c4b45094034 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2310 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §11.3, pp. 531–536, read as page images. The bullet-and-disk example's solution was read from p. 537 of lesson 31's PDF |
| **Probe topics** | 4 — `conservation-condition`, `i-omega-tradeoff`, `rotational-ke-changes`, `angular-collisions`. Prose bound to keys |
| **Extensions** | 4 (A–D): The skater's arms; Stepping onto a merry-go-round; Making a pulsar; How many somersaults?. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-30` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 31 — Rotational Motion Applications

| | |
|---|---|
| **File** | [`lesson_31_preflight_rotational_motion_applications.jsx`](lesson_31_preflight_rotational_motion_applications.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-31-rotational-motion-applications-0bf0f930` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/2e0bd3b9-ab71-45cf-b994-373dbd909f75 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2346 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§11.3–11.4, pp. 531–541, read as page images. The syllabus's "11.4" is the same Cengage section as lesson 30's; this lesson applies conservation and adds the gyroscope |
| **Probe topics** | 4 — `internal-torque-exchange`, `angular-momentum-collisions`, `precession-torque`, `spin-axis-stability`. Prose bound to keys |
| **Extensions** | 4 (A–D): A helicopter without a tail rotor; A bullet into a door; A precessing gyroscope; Engaging a clutch. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-31` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 32 — LAB 5: Angular Momentum

| | |
|---|---|
| **File** | [`lesson_32_preflight_lab5_angular_momentum.jsx`](lesson_32_preflight_lab5_angular_momentum.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-32-lab-5-angular-momentum-6a7348fb` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/ae12566e-0824-4043-8cd5-00a16d884012 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2418 lines) |
| **Grounding** | PHYS 110 Fall 2026 Lab 5 Instructions ("Conservation of Angular Momentum", 1 Aug 2026, 4 pp. including the rubric) as PRIMARY, read as page images; the Core Physics Laboratory Manual (uncertainty, standard deviation of the mean, linearizing data) as supporting text; OpenStax Univ. Physics Vol. 1 §§11.2–11.3 (the lessons 29–31 reading) as theory. Its bullet-in-a-disk example is the same physics as the lab |
| **Probe topics** | 4 — `lab5-conserved-quantity`, `lab5-moment-of-inertia-model`, `lab5-omega-from-timing`, `lab5-linearization-uncertainty`. Prose bound to keys |
| **Extensions** | 4 (A–D): Building the moment of inertia; One trial, from the ball to the photogate; Where did the kinetic energy go?; Reporting and comparing a result. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | LAB preflight, decisions carried forward from LABs 1–4: CONCEPTUAL (the report's Theory section is where derivation belongs); the reported uncertainty is the STANDARD DEVIATION OF THE MEAN, which the supplied Excel template computes; cadets take it BEFORE running the experiment, so probe preparation, never results. This lab has no bonus |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-32` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 33 — Universal Gravitation

| | |
|---|---|
| **File** | [`lesson_33_preflight_universal_gravitation.jsx`](lesson_33_preflight_universal_gravitation.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-33-universal-gravitation-d247e5a7` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/72410b66-1522-4caf-8d78-c765f6452d04 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2381 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§13.1–13.2, pp. 599–611, read as page images. The PDF ends mid-paragraph in the shell-planet discussion, which continues on p. 612 of lesson 34's PDF. Example 13.1's printed substitution has a typo (10⁻⁹ where 10⁻⁸ is meant); the grounding records it |
| **Probe topics** | 4 — `inverse-square-law`, `g-from-gravitation`, `gravity-at-altitude`, `field-and-apparent-weight`. Prose bound to keys |
| **Extensions** | 4 (A–D): Two people attract; Newton's Moon test; Where is gravity half as strong?; Weighing Mars. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-33` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 34 — Gravitational Potential Energy / Kepler's Laws

| | |
|---|---|
| **File** | [`lesson_34_preflight_gravitational_potential_energy_keplers_laws.jsx`](lesson_34_preflight_gravitational_potential_energy_keplers_laws.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-34-gravitational-potential-energy-keplers-laws-acf1fb16` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/0a3d2a33-e51c-44c7-83e3-1f530f06b324 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2395 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §13.3 (pp. 612–616) and §13.5 (pp. 624–629), read as page images; §13.4 is lesson 35's. The PDF ends with the strategy of the Halley's comet example. Example 13.8's printed substitution has a typo (3.0 × 10³ m/s where 30 km/s is meant); the grounding records it |
| **Probe topics** | 4 — `gravitational-pe`, `escape-velocity`, `bound-orbits-conics`, `kepler-second-third`. Prose bound to keys |
| **Extensions** | 4 (A–D): How good is m g h?; Escaping the Moon; A comet's speeds; A Hohmann trip to Mars. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-34` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 35 — Planetary and Satellite Motion

| | |
|---|---|
| **File** | [`lesson_35_preflight_planetary_and_satellite_motion.jsx`](lesson_35_preflight_planetary_and_satellite_motion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-35-planetary-and-satellite-motion-a265e53d` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/9453f63d-9e5d-4746-81a2-eea7b0d3f6cf — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2347 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §13.4, pp. 617–623, read as page images. The Soyuz orbital-energy example is cut off on p. 623; its conclusion was read from p. 624, at the start of lesson 34's §13.5 excerpt |
| **Probe topics** | 4 — `circular-orbit-speed`, `orbital-period`, `orbit-as-free-fall`, `orbital-energy`. Prose bound to keys |
| **Extensions** | 4 (A–D): Where geosynchronous satellites live; Twice as far from the center; Weighing Jupiter; Raising an orbit. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-35` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 37 — Simple Harmonic Motion & Pendulums

| | |
|---|---|
| **File** | [`lesson_37_preflight_simple_harmonic_motion_pendulums.jsx`](lesson_37_preflight_simple_harmonic_motion_pendulums.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-37-simple-harmonic-motion-pendulums-693379e0` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/daacd085-25e6-4d74-ab97-d87215095e89 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2384 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §15.1 (pp. 710–717) and §15.4 (pp. 728–733), read as page images. The PDF skips pp. 718–727 (energy in SHM, lesson 39's material) and ends with the torsional pendulum's period |
| **Probe topics** | 4 — `shm-restoring-force`, `period-independent-of-amplitude`, `simple-pendulum-period`, `shm-kinematics`. Prose bound to keys |
| **Extensions** | 4 (A–D): A block on a spring; What changes the period?; Measuring g with a pendulum; A vertical spring, two ways. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-37` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 38 — Lab 6: Simple Harmonic Motion

| | |
|---|---|
| **File** | [`lesson_38_preflight_lab6_simple_harmonic_motion.jsx`](lesson_38_preflight_lab6_simple_harmonic_motion.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-38-lab-6-simple-harmonic-motion-fe47ae72` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/7ada6e2e-a55c-478f-84cd-ab0cd77f2188 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2362 lines) |
| **Grounding** | PHYS 110 Fall 2026 Lab 6 Instructions ("Simple Harmonic Motion - Pendulums", 1 Aug 2026, 3 pp. including the rubric) as PRIMARY, read as page images; the Core Physics Laboratory Manual (uncertainty, standard deviation of the mean, linearizing data; its worked linearization example is this pendulum) as supporting text; OpenStax Univ. Physics Vol. 1 §15.4 (the simple pendulum) and §13.2 (g and Earth's rotation) as theory |
| **Probe topics** | 4 — `lab6-small-angle-pendulum`, `lab6-variables-and-timing`, `lab6-linearize-t-squared`, `lab6-theory-comparison`. Prose bound to keys |
| **Extensions** | 4 (A–D): Theoretical g at USAFA; One length, six periods; Reading the slope; Two small effects: rotation and a wide swing. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | LAB preflight, decisions carried forward from LABs 1–5: CONCEPTUAL (the report's Theory section is where derivation belongs); the reported uncertainty is the STANDARD DEVIATION OF THE MEAN, which the supplied Excel template computes; cadets take it BEFORE running the experiment, so probe preparation, never results. This lab has no bonus |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-38` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 39 — Energy of SHO & Damped Oscillations

| | |
|---|---|
| **File** | [`lesson_39_preflight_energy_of_sho_damped_oscillations.jsx`](lesson_39_preflight_energy_of_sho_damped_oscillations.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-39-energy-of-sho-damped-oscillations-e6890552` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/bf44752e-a476-4b24-bf49-491b4707ef38 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2402 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §15.2 (pp. 718–725) and §15.5 (pp. 734–737), read as page images from two section PDFs the course director added on 2026-10-12 ("Energy in SHM", "Damped Oscillations"). Fragments of neighbouring sections at the edges of each PDF are noted, not probed |
| **Probe topics** | 4 — `shm-energy-exchange`, `energy-amplitude-squared`, `stable-equilibrium-well`, `damped-oscillations`. Prose bound to keys |
| **Extensions** | 4 (A–D): Energy bookkeeping on a spring; Where are the energies equal?; Doubling the amplitude; A lightly damped oscillator. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. The artifact's header comment says the written `preflight-39` row still points its reference PDF at "Simple Harmonic Oscillation.pdf". That was true when it was built and was repaired the same day (CHANGELOG 2026-10-12); the comment is history, not a live instruction |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-39` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 40 — Wave Fundamentals & Wave Equation

| | |
|---|---|
| **File** | [`lesson_40_preflight_wave_fundamentals_wave_equation.jsx`](lesson_40_preflight_wave_fundamentals_wave_equation.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-40-wave-fundamentals-wave-equation-cae68395` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/9f2e9b87-bf2a-42e0-94e0-a2b150d63e5c — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2392 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§16.1–16.3, pp. 752–768, read as page images. The PDF ends mid-way through the guitar-string example (part b); the grounding says so rather than reconstructing the rest |
| **Probe topics** | 4 — `wave-transfers-energy`, `wave-speed-wavelength-frequency`, `speed-set-by-medium`, `wave-function-medium-motion`. Prose bound to keys |
| **Extensions** | 4 (A–D): A wave down a rope; Reading a wave function; Tightening a string; Same rope, two frequencies. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-40` lesson (prefill link, **Existing assignment**, `policy=choice`) |

### Lesson 41 — Superposition, Standing Waves, & Applications

| | |
|---|---|
| **File** | [`lesson_41_preflight_superposition_standing_waves_applications.jsx`](lesson_41_preflight_superposition_standing_waves_applications.jsx) |
| **Registration slug** (`#i=` / `id=`) | `lesson-41-superposition-standing-waves-applications-0549e3ca` |
| **Published** | 2026-10-12 — https://claude.ai/public/artifacts/20dcb1f1-4a06-4764-80fb-df076235bc46 — published by the course director; URL pasted back and then VERIFIED by fetching the published source and comparing it byte-for-byte with this file, rather than trusting list order |
| **Built** | 2026-10-12, by Bryan Egner via Claude Code, from `preflight-kit` localized against `phys-110/COURSE_PROFILE.md` |
| **Template** | Built on `lesson-22-center-of-mass-systems-of-particles-b554fa74` (itself built on lesson 19, the first source carrying the 2026-08-21 fix set, with the study-mode EQUATIONS, VERIFICATION PROTOCOL and CONFIDENCE LABELING sections restored) by asserted once-only substitutions; only the header, `INTERACTION_ID`, the generated date, `PROBE_TOPIC_COUNT`, `OBJECTIVE_KEYS`, the three authored blocks, the graded-prompt opening and its examples, and two UI titles differ. Spliced in **bytes**, LF preserved (2405 lines) |
| **Grounding** | OpenStax Univ. Physics Vol. 1 §§16.5–16.6, pp. 774–790, read as page images from a section PDF the course director added on 2026-10-12 ("Interference of Waves and Standing Waves"). The syllabus's "17.1–17.2" is Cengage numbering. The PDF covers both sections to their ends |
| **Probe topics** | 4 — `superposition-interference`, `boundary-reflection`, `standing-wave-nodes`, `normal-modes-resonance`. Prose bound to keys |
| **Extensions** | 4 (A–D): Adding two waves with a phase shift; A string on a vibrator; Playing a guitar string; Finding the nodes. Worked answers are tutor-reference only |
| **Checks** | `check_artifact.py` **31 passed / 1 failed** — the known `[]` false positive from `EXT_TRIGGER_MARK`. Parsed clean by the site's vendored Babel (`site/vendor/babel.min.js`); `BACKUP_ENDPOINT` count 3 |
| **Scope decisions** | CONCEPTUAL, per this course's standing decision. The artifact's header comment says the written `preflight-41` row still points its reference PDF at "Wave Motion.pdf". That was true when it was built and was repaired the same day (CHANGELOG 2026-10-12); the comment is history, not a live instruction |
| **Status** | **PUBLISHED 2026-10-12.** NOT YET REGISTERED — no `app.activities` row carries this slug, so no cadet can reach it through the course site until a director attaches it to the existing `preflight-41` lesson (prefill link, **Existing assignment**, `policy=choice`) |
