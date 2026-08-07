# COURSE_PROFILE — Physics 215

**This is the only file you edit to stand up this course.** The shared kit at `preflight-kit/`
reads from it and is never edited per course.

Values are single-line. Keep the fenced block — the parser reads only what is inside it.

> **Complete as of 2026-08-04 and localized successfully.** If you edit it, re-check before
> localizing again — `localize.py` will bake a sentinel into the tutor prompt and report success:
>
> ```bash
> sed -n '/^```profile$/,/^```$/p' courses/phys-215/COURSE_PROFILE.md | grep -c UNSET   # must print 0
> ```
>
> **Scan the fenced block, not the file.** A plain `grep UNSET` over the whole file matches this
> very instruction and can never reach 0. And `localize.py --check` is not a substitute either: it
> previews only the keys it substitutes, so a sentinel left in `course_title`, `student_text`, or
> `grade_weight_note` — which the *skill* reads at build time, not the localizer — would not
> appear in that preview.

> **This course was the localizer's baseline, and as of 2026-08-05 it is no longer exactly that.**
> Every value in `localize.py`'s `BASELINE` dict is a PHYS 215 value, so localizing this course
> used to substitute **nothing** — verified 2026-08-04: `0 active substitutions`, `0` replacements
> in all ten files, and `build/` byte-identical to the kit. **`grounding_text` now differs from the
> baseline** (it names both volumes), so exactly one key is live and `build/` is no longer
> byte-identical. Re-localize after editing this file; `build/` is not committed, so nothing in git
> tracks the drift for you.
>
> **Correct a claim this note used to make: `verify.py` check 2 does NOT read this file.** It
> localizes the kit's own `examples/COURSE_PROFILE.phys215.md` into a temp directory and checks
> *that* against `MANIFEST.sha256`. So check 2 still passes and always would — **editing this
> profile cannot affect it, and could never have.** The old wording implied this file was the one
> under test, which would have made an agent expect a red check here and read a green one as proof
> the edit was inert.
>
> **The part that still bites: the leftover scan barely protects this course.** `localize.py:268`
> only scans for a baseline string when the profile *changes* it (`if p[k] != BASELINE[k]`). One
> key now changes, so the scan looks for exactly one string — **every other value you forget to
> fill still equals the baseline, so it is not flagged, and the run looks perfect.** On a real port
> that scan is the safety net. Here the sentinel check above is the only mechanical guard, and
> reading the profile is the only real one.

```profile
# ── Identity ──────────────────────────────────────────────────────────────────
institution_short:      USAFA
institution_full:       United States Air Force Academy
department:             Department of Physics and Meteorology

# ── Learner vocabulary ────────────────────────────────────────────────────────
# Every learner-facing noun in the skill, the tutor prompt, and the report spec.
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
# NEVER surfaced to a cadet: the tutor cites no chapter or page numbers from it.
# Normal workflow — the grounding source is a real PDF, attached per lesson in the
# Claude Project. PHYS 310's reconstruct-and-review exception does NOT apply here
# and must not be borrowed; see docs/decisions/PHYS310-MURRAY-GROUNDING.md.
# Vol. 2 grounds lessons 2-30; Vol. 3 grounds 31-41. Settled 2026-08-05 — see "Grounding".
grounding_text:         OpenStax University Physics Vols. 2 and 3
grounding_text_short:   OpenStax
student_text:           Cengage (cadets read this; the tutor never cites either book)

# ── Academic integrity ────────────────────────────────────────────────────────
integrity_code_name:    USAFA Honor Code
integrity_statement:    This conversation is governed by the USAFA Honor Code. Please do this on your own — don't have someone else's responses fed in, and don't paste from solution manuals.

# ── Submission backend (see preflight-kit/docs/BACKEND_OPTIONS.md) ────────────
# Option A: reusing the DFPM receiver. These are the pilot's own values and MUST NOT
# change — a wrong endpoint fails silently, and the cadet's work goes nowhere.
submit_endpoint:        https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html
prefill_base:           https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html
schedule_file:          phys215_fall2026_schedule.md

# ── Session shape ─────────────────────────────────────────────────────────────
# Pilot as-built, kept deliberately (recker, 2026-08-04): 4 objectives at ~2 active
# min each, ~10 min total. This is the one course where the localized skill's own
# prose already matches these numbers — see "Session shape" below.
session_minutes:        10
probe_topics_default:   4
probe_topics_max:       5
per_topic_minutes:      2
artifact_version:       2026-08
grade_weight_note:      under 80 of 1000 course points

# ── Artifact naming ───────────────────────────────────────────────────────────
# Pilot stem shape, kept deliberately — but the slug is NOT what the kit shows.
# The contract's 8-hex suffix is mandatory; see "Slug rule" below.
slug_prefix:            lesson
artifact_filename:      lesson_<NN>_preflight_<topic_slug>.jsx
component_name:         Lesson<NN>Preflight
```

---

## Grounding

**Cadets read Cengage; the tutor is grounded in OpenStax.** The two books differ, which is the
kit's normal and expected arrangement — and it means the sentence in the localized tutor prompt
asserting the grounding reference is *not* the cadet's class text is **true for this course**.
(It is false for PHYS 310, which is why `CORE.md` §8 carries a row about it. Nothing to do here.)

**This course uses the normal workflow: attach the PDF.** OpenStax is openly licensed and freely
downloadable, so Step 3 of the skill extracts from an attached chapter PDF exactly as designed.
**Do not borrow PHYS 310's reconstruct-from-model-knowledge path.** That exception exists because
Murray has no PDF and will not get one, it is gated by a per-section human review, and
[`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../docs/decisions/PHYS310-MURRAY-GROUNDING.md)
scopes it to PHYS 310 explicitly. There is no `texts/` corpus here and there should not be one.

### The `Reading` column is in the cadets' numbering, not the grounding text's

**This is the trap most likely to waste an hour on the first build.** The schedule's `Reading`
column carries chapter numbers like `22.2–22.3` and `35.3–35.4`. Those are the **Cengage**
numbers — the book cadets hold. OpenStax University Physics numbers its E&M chapters entirely
differently (Gauss's Law is its own chapter, not a section of the charge chapter, and so on).

**So you cannot map the `Reading` column onto the grounding text mechanically.** Whoever builds a
lesson attaches the OpenStax chapter that covers *the topic*, and confirms it covers it by
reading it — not by matching a number. Nothing in the kit checks this, and a mismatch does not
error: it produces a tutor grounded in the wrong chapter, which reads as a plausible artifact.

### Settled: the course spans two OpenStax volumes, and both are named

**Closed 2026-08-05.** recker cleared the lesson 30–41 block; the factual half had already been
answered on 2026-08-04 by opening the PDFs and reading their first printed section heading.

**The Vol. 2 / Vol. 3 boundary falls between lessons 30 and 31**, not at 30 as first guessed:
lesson 30 (EM waves) is §16.2–§16.5, **Vol. 2's last chapter**; lesson 31 (light, reflection,
refraction) opens at §1.1, **Vol. 3's first**. So `grounding_text` now names both volumes, and a
build states the volume its own lesson actually grounds in.

**No source is missing for a lesson that is being built.** A topic-matched PDF is present for
lessons 30, 31, 32, 33, 36, 37, 39 and 41. Two exceptions, both recker's to supply and neither a
reason to guess:

- **Lesson 40 (Polarization) has no grounding source anywhere in the corpus.** OpenStax puts
  optical polarization at Vol. 3 §1.7, and `Light, Reflection, Refraction.pdf` stops at §1.4.
  Verified 2026-08-05 by scanning **every** PDF in the corpus for it: the only `polariz` hits are
  *dielectric* polarization in the capacitance chapter and *charge* polarization in the
  electrostatics chapters — different physics, same word. This is lesson 16's situation exactly.
- **Lesson 16 (RC Circuits)** remains sourceless and deferred, as before.

**Do not build either from model knowledge.** PHYS 310's reconstruct-and-review exception is
scoped to PHYS 310 by [`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../docs/decisions/PHYS310-MURRAY-GROUNDING.md)
and must not be borrowed.

**Several of the optics/modern sources have holes in the middle**, as two of the first twelve did.
Each is recorded in the built artifact's `GAPS IN THE SOURCE` block and in
`artifacts/BUILD-LOG.md`. Check the printed folio run on every build — it is the authority, and any
single other sequence can stay continuous across a real gap.

## Slug rule — pilot stem, mandatory contract suffix

Recker chose the pilot's readable stem on 2026-08-04, so new lesson rows sort alongside the
PHYS 215 artifacts already published. **But the kit's slug rule is out of date, and the skill is
the copy people read.** `contracts/INTERACTION-DATA-CONTRACT.md` §3.2 (2026-07-28) requires the
`#i=` slug to be globally unique per course offering, built as `<readable-stem>-<8 random
lowercase hex>` and minted **once per artifact build**. The rule for this course is therefore:

```
lesson-<NN>-<topic-slug>-<8 random lowercase hex>
```

topic lowercased, apostrophes deleted, every run of non-alphanumeric characters collapsed to a
single hyphen, leading/trailing hyphens trimmed, then the suffix appended.
`Gauss's Law and Its Applications` at lesson 8 → `lesson-08-gausss-law-and-its-applications-7c1e40b9`.
Minted by the skill, never requested from the instructor, and written once into both the artifact
and the prefill link so the two cannot drift.

> **The skill does not know this rule.** `skill/preflight-factory-v2/SKILL.md` still says
> "Generation rule (deterministic, so re-running yields the same slug)" and shows no suffix — its
> inline copy predates §3.2. The kit is hash-locked, so it cannot be corrected here. **Build the
> slug from the contract, not from the skill**, exactly as the skill's own Step 1 instructs.
> `scripts/artifacts/check_artifact.py` fails a suffix-less `INTERACTION_ID`, because a rule that
> lives only in the file nobody re-reads is a rule that gets missed — **it was missed once
> already, on PHYS 310's first build.**

**The already-published pilot artifacts have no suffix at all**, since they predate §3.2. Exact
parity with them was never available. Do not hand-copy an old slug forward to get it; slug reuse
across offerings is the precise failure §3.2 exists to prevent.

**Three consequences of keeping the lesson number, stated plainly because they are the cost of
the choice:**

- **A rebuild mints a new suffix, so it registers as a NEW lesson row.** It does not update the
  old one. This is the contract's intent, not a bug to work around — but it means re-registering
  via the prefill link every time.
- **Renumbering the schedule strands the number, and it is visible to cadets.** The lesson number
  is baked into the slug, the header title, `LESSON_CONFIG.lesson_id`, the filename, and the
  component name. Move "Gauss's Law" from lesson 8 to lesson 9 and the published artifact still
  says 8, everywhere a cadet can see. Nothing detects this. PHYS 310 dropped the number for
  exactly this reason; this course accepts the risk in exchange for continuity with the pilot.
  **Settle the numbering before building, not after.**
- **Topic text is load-bearing too**, on top of the number. Both feed the stem.

**Cross-course collision is not a concern here.** `OPEN_ISSUES.md` §6 flags bare `lesson-NN-topic`
slugs as collidable between two courses sharing a receiver, which is what drove PHYS 310 to add a
`phys310` prefix. The §3.2 suffix already makes every slug globally unique, and PHYS 310's slugs
carry no lesson number anyway, so the two courses cannot collide by either route.

## Session shape — the one course where the skill's prose already agrees

`session_minutes`, `probe_topics_default`, `probe_topics_max`, `per_topic_minutes`, `slug_prefix`,
`artifact_filename`, and `component_name` are **read by no tool.** `localize.py` substitutes only
identity, vocabulary, and endpoint values; `SKILL.md` never looks them up by name. They are
instructions to whoever builds the lesson.

**For this course that costs nothing**, because the values are the pilot's: the localized skill
already says "default 4, hard cap 5" and "~2 active min" throughout, and those are correct here.
A build needs no deliberate override — the one and only course where that is true. In the emitted
artifact: `PROBE_TOPIC_COUNT = 4`, exactly 4 entries in `OBJECTIVE_KEYS`, and
`PER_TOPIC_BUDGET_MIN = 2.0`.

**Do not read that convenience as a reason to leave the profile unread on the next course.**

## What must not change here

**`submit_endpoint` and `prefill_base`** are frozen by `contracts/INTERACTION-DATA-CONTRACT.md` §2
for this deployment. They are correct as written. A wrong endpoint fails **silently** — the cadet
has the full conversation, clicks Submit, sees a page, and the work reaches nothing.

**`course_id: phys-215`** is the pilot's own id, so unlike PHYS 310's it is the one value here we
have positive reason to believe the receiver already knows. Confirm it anyway before the first
artifact ships from this repository.

**The `cadet*` code identifiers** (`cadetId`, `setCadetId`, `cadet-id`, `--cadet-bg`,
`--cadet-border`, `cadet_id`) stay literal in every build. `localize.py` masks them before
substitution and restores them after. They are internal, never rendered, and renaming them is a
diff with no upside.

**`grade_weight_note`** is inherited from the pilot verbatim and reaches cadet-facing prose.
Confirm "under 80 of 1000 course points" is still the Fall 2026 figure before the first build.
