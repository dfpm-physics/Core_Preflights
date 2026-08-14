# COURSE_PROFILE — Physics 215 (reference: the pilot course, as built)

**This is the only file you edit to stand up a new course.** Everything else in the kit reads
from it. Fill in every value in the block below, keep the key names exactly as written, then
either (a) run `tools/localize.py` to bake the values into a course-specific copy of the skill
and sources, or (b) upload this file as-is alongside the verbatim kit and let the
`PORTABILITY_OVERLAY.md` substitute at build time. See `README.md` for which path to take.

Values are single-line. Keep the fenced block — the parser reads only what is inside it.

```profile
# ── Identity ──────────────────────────────────────────────────────────────────
institution_short:      USAFA
institution_full:       United States Air Force Academy
department:             Department of Physics and Meteorology

# ── Learner vocabulary ────────────────────────────────────────────────────────
# Every learner-facing noun in the skill, the tutor prompt, and the report spec.
# Use the word your students are actually called. "student" is the safe default.
learner_singular:       cadet
learner_plural:         cadets

# ── Course ────────────────────────────────────────────────────────────────────
course_name:            Physics 215
course_short:           PHYS 215
course_id:              phys-215
course_title:           General Physics II — E&M and Optics
semester:               Fall 2026
discipline:             physics
discipline_adjective:   physical

# ── Grounding text ────────────────────────────────────────────────────────────
# The instructor-side reference the tutor is grounded in. NEVER surfaced to learners.
# If students read a different book, that is fine and expected — say so here.
grounding_text:         OpenStax University Physics Vol. 2
grounding_text_short:   OpenStax
student_text:           Cengage (students read this; the tutor never cites either book)

# ── Academic integrity ────────────────────────────────────────────────────────
integrity_code_name:    USAFA Honor Code
integrity_statement:    This conversation is governed by the USAFA Honor Code. Please do this on your own — don't have someone else's responses fed in, and don't paste from solution manuals.

# ── Submission backend (see docs/BACKEND_OPTIONS.md) ──────────────────────────
# Reusing the existing receiver? Leave these exactly as-is and only change course_id.
# Standing up your own? Both must be real, reachable URLs before you build anything.
submit_endpoint:        https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html
prefill_base:           https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html
backup_base:            https://dfpm-physics.github.io/Core_Preflights/site/student/backup.html
schedule_file:          phys215_fall2026_schedule.md

# ── Session shape ─────────────────────────────────────────────────────────────
session_minutes:        10
probe_topics_default:   4
probe_topics_max:       5
per_topic_minutes:      2
artifact_version:       2026-08
grade_weight_note:      under 80 of 1000 course points

# ── Artifact naming ───────────────────────────────────────────────────────────
slug_prefix:            lesson
artifact_filename:      lesson_<NN>_preflight_<topic_slug>.jsx
component_name:         Lesson<NN>Preflight
```

---

## Notes on the fields that bite

**`course_id`** must match the course id your receiver already knows. It is the one value that
differs between two courses sharing a backend, and a wrong one means the prefill link registers
the lesson under the wrong course — visible, but only if someone looks.

**`submit_endpoint`** is frozen by `contracts/INTERACTION-DATA-CONTRACT.md` §2 for the existing
deployment. Change it *only* if you have stood up your own receiver. A wrong endpoint fails
**silently**: the student does the full session and the report goes nowhere.

**`learner_singular`** is substituted in prose only. The code identifiers `cadetId`,
`setCadetId`, `cadet-id`, `--cadet-bg`, and `--cadet-border` stay literal in every build — they
are internal, never rendered, and renaming them is a diff with no upside and real breakage risk.

**`grounding_text`** is invisible scaffolding. It grounds the tutor's correctness and nothing
else. Section and page numbers from it are internal-only and must never reach a learner — this
is rule 6 in the skill's Common Mistakes and it survives every port.

**`discipline`** drives more than a noun swap in a non-quantitative course. Read
`docs/ADAPTING_TO_A_NEW_DISCIPLINE.md` before building for anything outside math/science.
