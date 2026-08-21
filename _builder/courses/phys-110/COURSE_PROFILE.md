# PHYS 110 — Course Profile

**Created 2026-08-19.** Until this file existed, `phys110_fall2026_schedule.md` stated in its own
header that *"PHYS 110 IS NOT A BUILDER COURSE"* and that the absence of this file was what made
that true. That note has been updated in the same change; if you are reading a copy that still
says otherwise, this file wins.

**Why it exists now.** PHYS 110's five interactive lessons were built outside this repository and
published straight to claude.ai, so their `.jsx` is in no library and they can have no Gemini
backup — a cadet throttled on one has nowhere to go. The course now has an artifact author of its
own who will build every future PHYS 110 interaction, so the course needs to be a first-class
builder course rather than a schedule source.

**Verify before a build** — every value below must be real:

> ```
> sed -n '/^```profile$/,/^```$/p' courses/phys-110/COURSE_PROFILE.md | grep -c UNSET   # must print 0
> ```

**UNSET is deliberate, not an oversight.** The four values `sync_artifacts.py` needs to put an
artifact in the library — `course_id`, `course_title`, `prefill_base`, `submit_endpoint` — are
filled in and sourced. Everything still marked `UNSET` is a **teaching** decision belonging to
this course's director and artifact author: which text grounds the tutor, how long a session runs,
how many objectives it probes. Guessing them would produce a profile that looks complete and
quietly bakes somebody else's pedagogy into every PHYS 110 artifact. **Uploading existing
artifacts to the library works with them unset; building a new one does not.**

## Sources

| Value | Where it came from |
|---|---|
| `course_name`, `course_id` | `app.courses.code` (live database) |
| `course_title` | `phys110_fall2026_schedule.md` line 1, itself transcribed from TABLE 1, page 10 of `Physics_110_Fall_2026_Syllabus (4Aug2026)_8639.pdf` |
| `submit_endpoint`, `prefill_base`, `backup_base` | Copied verbatim from `phys-215/COURSE_PROFILE.md`. These are frozen contract URLs (CORE.md §6) and are the same for every course — a wrong one fails silently and the cadet's work goes nowhere |
| `schedule_file` | The file already beside this one |
| everything `UNSET` | Nobody has decided yet. See above |

```profile
# ── Identity ──────────────────────────────────────────────────────────────────
institution_short:      USAFA
institution_full:       United States Air Force Academy
department:             Department of Physics and Meteorology

# ── Learner vocabulary ────────────────────────────────────────────────────────
learner_singular:       cadet
learner_plural:         cadets

# ── Course ────────────────────────────────────────────────────────────────────
course_name:            Physics 110
course_short:           PHYS 110
course_id:              phys-110
course_title:           General Physics I — Mechanics
semester:               Fall 2026
discipline:             physics
discipline_adjective:   physical

# ── Grounding text ────────────────────────────────────────────────────────────
# NEVER surfaced to a cadet: the tutor cites no chapter or page numbers from it.
# The schedule's Reading column is Cengage SECTION numbering, not pages — see
# phys110_fall2026_schedule.md. Which book grounds the TUTOR is a separate
# decision from which book the cadets read.
#
# DECIDED 2026-08-21 by the course director. OpenStax Vol. 1 is the course-wide
# default and matches the 28 grounding PDFs already staged in
# textbook-pdfs/phys-110/.
#
# THE SIX LAB LESSONS (7, 10, 19, 23, 32, 38) ARE DIFFERENT. Their syllabus
# Reading is "Lab Handout", not a book section, so a lab preflight grounds on
# that lesson's lab handout PLUS the lab manual, with any relevant OpenStax
# section as supporting material. There is no per-lesson grounding field in this
# profile, so that is supplied per build — attach the handout and manual, and say
# so in the build log. Grounding a lab preflight on OpenStax alone would probe a
# reading the cadets were never assigned.
grounding_text:         OpenStax University Physics Volume 1
grounding_text_short:   OpenStax
student_text:           Cengage (cadets read this; the tutor never cites either book)

# ── Academic integrity ────────────────────────────────────────────────────────
integrity_code_name:    USAFA Honor Code
integrity_statement:    This conversation is governed by the USAFA Honor Code. Please do this on your own — don't have someone else's responses fed in, and don't paste from solution manuals.

# ── Submission backend ────────────────────────────────────────────────────────
# Frozen contract URLs (CORE.md §6). Identical for every course; a wrong endpoint
# fails silently and the cadet's work goes nowhere.
submit_endpoint:        https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html
prefill_base:           https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html
backup_base:            https://dfpm-physics.github.io/Core_Preflights/site/student/backup.html
schedule_file:          phys110_fall2026_schedule.md

# ── Session shape ─────────────────────────────────────────────────────────────
# This course's own decision. PHYS 215 runs 4 objectives at ~2 active minutes each
# for ~10 minutes total; copying those numbers here would be assuming rather than
# deciding, and they are baked into every artifact built from this profile.
session_minutes:        10
probe_topics_default:   4
probe_topics_max:       5
per_topic_minutes:      2
artifact_version:       2026-08
grade_weight_note:      under 80 of 1000 course points

# ── Artifact naming ───────────────────────────────────────────────────────────
# Matches the slugs the five existing PHYS 110 artifacts already carry, e.g.
# lesson-08-intro-to-newtons-laws-9667eba1. The 8-hex suffix is mandatory and is
# minted per build (contract §3.2) — never typed, never carried forward by hand.
slug_prefix:            lesson
artifact_filename:      lesson_<NN>_preflight_<topic_slug>.jsx
component_name:         Lesson<NN>Preflight
```
