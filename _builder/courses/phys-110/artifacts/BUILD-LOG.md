# PHYS 110 — Preflight Artifact Build Log

**Fall 2026 · General Physics I — Mechanics.** One row per lesson artifact. Appended in lesson
order, not chronological order, so the table reads as a build queue.

**What this file is for:** reviewing what was built and registering it. The `Registration slug` and
`Published` rows are the two values a prefill link is made of — the exact `#i=` / `id=` string and
the artifact's public URL. Copy them from here rather than retyping, and regenerate a link per
[`docs/operations/PREFILL-LINK.md`](../../../docs/operations/PREFILL-LINK.md). **The published URL
lives nowhere else in this repository**, it is not derivable from the source, and it is the only
pointer from a lesson back to the exact build a cadet is running.

> **EVERY ROW HERE IS A BACKFILL, written 2026-08-19.** These five artifacts were built outside
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
