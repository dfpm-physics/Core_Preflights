# COURSE_PROFILE — Chemistry 201 (illustrative port: new institution, new discipline, new backend)

This example exists to show what actually changes when the kit leaves USAFA physics. Three
things move at once here: the learner noun, the grounding text, and the backend. Nothing else
about the architecture changes — that is the point of the kit.

```profile
# ── Identity ──────────────────────────────────────────────────────────────────
institution_short:      State U
institution_full:       State University
department:             Department of Chemistry

# ── Learner vocabulary ────────────────────────────────────────────────────────
learner_singular:       student
learner_plural:         students

# ── Course ────────────────────────────────────────────────────────────────────
course_name:            Chemistry 201
course_short:           CHEM 201
course_id:              chem-201
course_title:           General Chemistry II
semester:               Spring 2027
discipline:             chemistry
discipline_adjective:   chemical

# ── Grounding text ────────────────────────────────────────────────────────────
grounding_text:         OpenStax Chemistry 2e
grounding_text_short:   OpenStax
student_text:           Chang, Chemistry 14e (students read this; the tutor never cites either book)

# ── Academic integrity ────────────────────────────────────────────────────────
integrity_code_name:    State University Academic Integrity Policy
integrity_statement:    This conversation is covered by the university's academic integrity policy. Please do this on your own — don't have someone else's responses fed in, and don't paste from solution manuals.

# ── Submission backend (see docs/BACKEND_OPTIONS.md) ──────────────────────────
submit_endpoint:        https://stateu-chem.github.io/preflights/site/student/interaction-submit.html
prefill_base:           https://stateu-chem.github.io/preflights/site/faculty/lessons.html
backup_base:            https://stateu-chem.github.io/preflights/site/student/backup.html
schedule_file:          chem201_spring2027_schedule.md

# ── Session shape ─────────────────────────────────────────────────────────────
session_minutes:        10
probe_topics_default:   4
probe_topics_max:       5
per_topic_minutes:      2
artifact_version:       2027-01
grade_weight_note:      2% of the course grade

# ── Artifact naming ───────────────────────────────────────────────────────────
slug_prefix:            lesson
artifact_filename:      lesson_<NN>_preflight_<topic_slug>.jsx
component_name:         Lesson<NN>Preflight
```

## What this port has to solve that a same-department port does not

1. **A receiver.** The endpoints above are fictional until someone deploys them. Until then
   every artifact built against this profile loses student work silently. `docs/BACKEND_OPTIONS.md`
   specifies exactly what the receiver must do; there is no way to skip this and still grade.
2. **Discipline verification.** The skill's two-pass arithmetic check assumes numeric answers.
   Stoichiometry and equilibrium keep that intact; a mechanism question needs the substitute
   verification pass described in `docs/ADAPTING_TO_A_NEW_DISCIPLINE.md`.
3. **Integrity language.** The Honor Code text is USAFA-specific and legally particular. It is
   replaced wholesale by `integrity_statement`, not paraphrased from the original.
