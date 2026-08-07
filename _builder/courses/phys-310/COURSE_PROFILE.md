# COURSE_PROFILE — Physics 310

**This is the only file you edit to stand up this course.** The shared kit at `preflight-kit/`
reads from it and is never edited per course.

Values are single-line. Keep the fenced block — the parser reads only what is inside it.

> **Complete as of 2026-07-30 and localized successfully.** If you edit it, re-check before
> localizing again — `localize.py` will bake a sentinel into the tutor prompt and report success:
>
> ```bash
> sed -n '/^```profile$/,/^```$/p' courses/phys-310/COURSE_PROFILE.md | grep -c UNSET   # must print 0
> ```
>
> **Scan the fenced block, not the file.** A plain `grep UNSET` over the whole file matches this
> very instruction and can never reach 0 — a check that cannot pass is a check people learn to
> ignore. And `localize.py --check` is not a substitute either: it previews only the keys it
> substitutes, so a sentinel left in `course_title`, `student_text`, or `grade_weight_note` —
> which the *skill* reads at build time, not the localizer — would not appear in that preview.

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
course_name:            Physics 310
course_short:           PHYS 310
course_id:              phys-310
course_title:           Principles of Nuclear Science
semester:               Fall 2026
discipline:             physics
discipline_adjective:   physical

# ── Grounding text ────────────────────────────────────────────────────────────
# CHANGED 2026-07-31: grounding moved from DOE-HDBK-1019 to Murray — the adopted text —
# reconstructed from model knowledge and gated by recker's review. Scoped to PHYS 310.
# See docs/decisions/PHYS310-MURRAY-GROUNDING.md and "Grounding" below.
# NEVER surfaced to a cadet: the tutor cites no section or page numbers, same as before.
# DOE-HDBK-1019 remains in texts/ as a CROSS-CHECK, not the grounding.
grounding_text:         Murray & Holbert, Nuclear Energy (8th ed.)
grounding_text_short:   Murray & Holbert
student_text:           Murray & Holbert, Nuclear Energy (8th ed.) — the same book the tutor is grounded in; the tutor still never cites it

# ── Academic integrity ────────────────────────────────────────────────────────
integrity_code_name:    USAFA Honor Code
integrity_statement:    This conversation is governed by the USAFA Honor Code. Please do this on your own — don't have someone else's responses fed in, and don't paste from solution manuals.

# ── Submission backend (see preflight-kit/docs/BACKEND_OPTIONS.md) ────────────
# Option A: reusing the DFPM receiver. These are byte-identical to the PHYS 215 pilot
# and MUST NOT change — a wrong endpoint fails silently, and the cadet's work goes nowhere.
submit_endpoint:        https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html
prefill_base:           https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html
schedule_file:          phys310_fall2026_schedule.md

# ── Session shape ─────────────────────────────────────────────────────────────
# Set by recker on 2026-07-30, replacing the pilot's 4 x 2 min: 3 objectives per
# lesson at ~3 active min each, landing on the same ~10-minute total.
# NOTE: nothing reads these keys mechanically — see "Session shape is advisory" below.
session_minutes:        10
probe_topics_default:   3
probe_topics_max:       3
per_topic_minutes:      3
artifact_version:       2026-08
grade_weight_note:      60 of 1000 course points

# ── Artifact naming ───────────────────────────────────────────────────────────
# No lesson number anywhere — see "Slug namespacing" below.
slug_prefix:            phys310
artifact_filename:      phys310_preflight_<topic_slug>.jsx
component_name:         Phys310<TopicPascal>Preflight
```

---

## Grounding

> **Changed 2026-07-31.** This course now grounds in **Murray**, reconstructed from model knowledge
> and gated by recker's review. Full reasoning, alternatives, and costs:
> [`docs/decisions/PHYS310-MURRAY-GROUNDING.md`](../../docs/decisions/PHYS310-MURRAY-GROUNDING.md).
> **The exception is scoped to PHYS 310.** Every other course attaches a source; a second course
> wanting this is a new decision, not an extension of this one.

**Cadets read, and the tutor is grounded in,** Murray & Holbert, *Nuclear Energy: An Introduction to
Concepts, Systems, and Applications of Nuclear Processes*, 8th ed. **There is no PDF of Murray in
this repository and there will not be one** — recker owns a physical copy and no scan.

**DOE-HDBK-1019** stays in the repository as a **cross-check, not the grounding.** Where it covers a
topic, agreement between it and the reconstructed Murray content raises confidence; disagreement is
a flag to surface to recker rather than resolve silently. Section index:
[`texts/DOE-HDBK-1019-INDEX.md`](texts/DOE-HDBK-1019-INDEX.md). **The two PDFs are gitignored and
are not on disk in a fresh clone** — re-download before relying on the cross-check.

### The workflow — one corpus, reviewed per section, excerpted per lesson

The reconstructed grounding lives in **[`texts/MURRAY-GROUNDING.md`](texts/MURRAY-GROUNDING.md)** —
**59 sections across 14 chapters**, covering every Murray section named in the schedule's `Reading`
column. It was built in full on 2026-07-31; **§2.1, §2.5, and §2.6 are reviewed and the other 56 are
not.**

**Reviewing the corpus** (recker, at whatever pace suits — batching by chapter is easiest):

1. Read a section's **Flags** block against the physical book; skim its **Physics** block.
2. Correct anything wrong, then change that section's status line to `STATUS: REVIEWED <date>`.

**Building an artifact** (per lesson):

> ### ⚠ The gate in step 3 was LIFTED by recker on 2026-08-05
>
> *"Assume the grounding for 310 is correct and we can fix objectives and grounding later if we need
> to."* Every remaining lesson was built that day against **unreviewed** corpus sections.
>
> **What the lift is:** permission to build. **What it is not:** an attestation. Fifty-six of the
> fifty-nine sections are still `STATUS: PENDING`, and the status lines were deliberately **not**
> flipped to REVIEWED — flipping them would destroy the only record of which physics a human has
> actually checked, in exchange for making a `grep` look tidy.
>
> **So the review is still owed, and it is now owed against published-shaped drafts rather than
> against nothing.** Every artifact built under the lift is marked in
> [`artifacts/BUILD-LOG.md`](artifacts/BUILD-LOG.md), so the set is enumerable rather than
> remembered. **`CORE.md` §6 is untouched by this**: an artifact is still a draft until recker
> approves it, and the lift moved the gate earlier in the pipeline, not away.
>
> **Do not read the lift as precedent.** It is one owner's call about one course whose grounding was
> already a recorded exception. A second course wanting it is a new decision.

3. **Check every section the lesson's `Reading` column names.** Under the pre-2026-08-05 gate, a
   `STATUS: PENDING` section meant **stop and ask recker to review it** — do not build, and do not
   substitute agent judgment for the review. **That gate is lifted (above); record what was pending
   rather than stopping on it.**
4. Step 3 of the skill **excerpts the lesson's sections from the corpus** into `TEXTBOOK_REFERENCE`.
   It does not reconstruct, re-derive, or supplement them.

```bash
grep -n '^\*\*STATUS: PENDING\*\*' courses/phys-310/texts/MURRAY-GROUNDING.md
```

**The gate is not the normal workflow and is not optional.** Everywhere else, Step 3 of the skill
extracts from an attached PDF and no human reads the extraction. The review is the entire reason the
reconstruction is acceptable at all — skip it and the artifact genuinely violates the frozen tutor
prompt's "do not paraphrase or reconstruct them from memory" rule (see the ADR's *What this costs*).

**A pending section blocks its own lessons and nothing else.** That is the point of attesting per
section rather than per file: the corpus does not have to be finished for lesson 2 to be buildable.

**The corpus covers the assigned sections, not the book** — 59, not the ~150 Murray contains. That
bound is what keeps this a grounding source rather than a substitute for the text cadets are
required to buy.

**The block is split by confidence, because the risk is not uniform:**

| tier | covers | how to review it |
|---|---|---|
| **High** | constants, formulas, conceptual relationships, definitions | **skim** — known independently of Murray and cross-checkable against DOE |
| **Low** | section titles, page numbers, which worked examples appear, notation choices, whether 8th-ed. numbering matches | **read against the book** — this is where a model confabulates |

A flat "check this for accuracy" spends recker's attention on the reliable half and none on the
unreliable half. **An unsplit block is a defective block; send it back.**

### What this changed, kept honestly

**The copyright question is now managed rather than removed.** The 2026-07-30 position — Murray is
commercial and copyrighted; DOE is a Government work — is still true. What bounds the exposure: the
block is paraphrase, formulas, and concept structure rather than protected expression; **no extended
verbatim prose from Murray is reproduced**; and it is never surfaced to a cadet (`CORE.md` §6), so it
does not substitute for the book they are required to buy.

**PHYS 310 trips the tutor-prompt weakness again**, and it is visible in the build rather than
theoretical. `localize.py` bakes the course's `grounding_text` into the skill, so
`build/skill/preflight-factory-v2/SKILL.md:271` now reads:

> **Grounding reference, NOT the cadet's class text — never cite it to the cadet.** The Murray &
> Holbert pages are a parallel reference the tutor uses to keep itself correct; they are **not** the
> text the cadet was assigned for class.

The second sentence is flatly false for this course. `02_TUTOR_SYSTEM_PROMPT.md:17` carries the same
premise without naming a book, which is why `localize.py` cannot reach it.

**Assessed as behaviorally harmless, and the distinction is worth holding onto: the false part is
the justification, not the rule.** The operative instruction — never cite section or page numbers to
the cadet — stays correct and stays wanted, because a cadet who is told "§2.6 says" learns to go
look it up instead of thinking. Leave it in force. The `CORE.md` §8 row is updated accordingly; it
had recorded PHYS 310 as no longer tripping this.

Conventions that survive the change, both about answering "what grounded lesson 7?" six months from now:

- **Record the Murray sections in the schedule's `Reading` column, and keep the `Grounding` column**
  for the DOE cross-check where one was done. `Murray 2.1, 2.5, 2.6 → DOE NP-01 pp. 1–16 (partial)`
  is answerable later; a bare `2.1, 2.5, 2.6` is not.
- **Where DOE does not cover a Murray topic, the cross-check is simply unavailable — say so.** Under
  DOE grounding this was a content gap needing a third source; now it is only a reduced-confidence
  flag on the review. Lesson 2's `gap: amu↔C-12` is the example: Murray §2.6 covers it, DOE does not.
- **A lesson whose cross-check is unavailable is not a lesser lesson.** Do not skip the preflight
  because DOE is thin there — that is precisely where cadets arrive least prepared. Review the block
  more carefully instead.

## Slug namespacing — two decisions, recorded

The kit's rule is `lesson-<NN>-<topic-slug>`. This course changes both halves of it, for two
separate reasons. Both are recorded here rather than improvised at build time, because
`skill/preflight-factory-v2/PORTABILITY_OVERLAY.md` lists slug generation among the four things a
profile "cannot change" — what that guard actually protects is that the slug is **deterministic and
skill-generated, never requested from the instructor and never invented per build**. Both decisions
below preserve that property exactly; they change only which strings feed the function.

**Decision 1 (recker, 2026-07-30): prefix the slug with the course short code.**
`OPEN_ISSUES.md` §6 and `BACKEND_OPTIONS.md` Option A both flag it: slugs are namespaced by lesson
number and topic, which is sufficient *within* one course and not guaranteed *across* two sharing a
receiver. `lesson-01-introduction` in PHYS 215 and in PHYS 310 is a real collision, and it resolves
silently to whichever the receiver finds first. `slug_prefix` is therefore `phys310`, and this
course cannot collide with the pilot no matter what the topics are.

**Decision 2 (recker, 2026-07-30): drop the lesson number entirely — slug from the topic alone.**
The Fall 2026 schedule's dates and lesson numbers are expected to move; its topics and readings are
not. Under the kit's rule, moving "Energy, Atoms, and Nuclei" from lesson 2 to lesson 4 changes the
slug a rebuild would mint, silently desynchronizing it from the value registered on the Lessons
page — the exact failure `CORE.md` §8 warns about, arriving through the calendar rather than through
an edit. Numbering the artifact after something known to be unstable buys nothing and costs that.

**Decision 3 is not ours — it is the contract's, and it overrides the two above where they
conflict.** `contracts/INTERACTION-DATA-CONTRACT.md` §3.2 (added 2026-07-28) requires the `#i=`
slug to be **globally unique per course offering**, built as `<readable-stem>-<8 random lowercase
hex>` and minted **once per artifact build**. Without the suffix, every term that runs a lesson
shares one globally-`UNIQUE` `activities` row, and a director deleting a rebuilt Fall 2026 lesson is
one confirm away from destroying another term's reports.

So the rule for this course is:

```
phys310-<topic-slug>-<8 random lowercase hex>
```

topic lowercased, apostrophes deleted, every run of non-alphanumeric characters collapsed to a
single hyphen, leading/trailing hyphens trimmed, then the suffix appended. `Atoms and Nuclei` →
`phys310-atoms-and-nuclei-83022f32`. Still minted by the skill, never requested from the instructor,
and still written once into both the artifact and the prefill link so the two cannot drift.

**The suffix costs the determinism the two decisions above were written around, and that trade is
the contract's to make, not ours.** A rebuild mints a new suffix and therefore a **new lesson row** —
it does not update the old one, and it must be re-registered. Do not hand-copy a previous suffix
forward to avoid re-registering; slug reuse across offerings is the precise failure §3.2 exists to
prevent. What the `PORTABILITY_OVERLAY.md` determinism guard actually protects — skill-generated,
never requested from the instructor, never diverging from the prefill link — is untouched.

> **The skill does not know this rule.** `skill/preflight-factory-v2/SKILL.md` still says
> "Generation rule (deterministic, so re-running yields the same slug)" and shows no suffix — its
> inline copy predates §3.2. The kit is hash-locked, so it cannot be corrected here. **Build the slug
> from the contract, not from the skill**, exactly as the skill's own Step 1 instructs: *"Read the
> two contract files even though this skill reproduces their essentials inline… they have changed
> under it before."* `scripts/artifacts/check_artifact.py` now fails a suffix-less
> `INTERACTION_ID`, because a rule that only exists in the file nobody re-reads is a rule that gets
> missed — it was missed once already, on this course's first build.

**The lesson number leaves the artifact everywhere, not just the slug** — otherwise a renumber
merely moves the lie somewhere the cadet can see it. That means the header title, the
`LESSON_CONFIG.lesson_id`, the filename, and the component name all carry the topic instead. The
lesson number stays where it is genuinely true and cheap to fix: the schedule table and the prefill
link's optional `num` parameter, both of which live outside the published artifact.

Two consequences to know:

- **Topic text is now the only load-bearing string.** Editing a topic after publish still
  desynchronizes the slug. Settle wording before building — that guard did not go away, it just has
  one input instead of two.
- **PHYS 215's slugs are unchanged.** This is a per-course choice; the pilot's already-published
  artifacts keep their bare `lesson-NN-topic` slugs. Do not "fix" PHYS 215 to match — its slugs are
  baked into published artifacts, and changing one is a rebuild and a re-publish.

## Session shape is advisory — nothing enforces it

`session_minutes`, `probe_topics_default`, `probe_topics_max`, `per_topic_minutes`, `slug_prefix`,
`artifact_filename`, and `component_name` are **read by no tool.** `localize.py` substitutes only
identity, vocabulary, and endpoint values; it has no rule for any of these, and `SKILL.md` never
looks them up by name. They are instructions to whoever builds the lesson — a human or an agent —
and the localized skill still says "default 4, hard cap 5" and "~2 active min" throughout.

**So a build has to apply them deliberately.** For this course that means, in the emitted artifact:

| profile key | where it has to land |
|---|---|
| `probe_topics_default` / `_max` = 3 | `PROBE_TOPIC_COUNT`, and exactly 3 entries in `OBJECTIVE_KEYS` |
| `per_topic_minutes` = 3 | `PER_TOPIC_BUDGET_MIN = 3.0`, and the PACING block's prose in the system prompt |
| `slug_prefix`, `artifact_filename`, `component_name` | `INTERACTION_ID`, the `.jsx` filename, the exported component |

**Where the skill's prose and this profile disagree, this profile wins** — it is the per-course
layer, and the kit is hash-locked precisely so that per-course variation lives here instead. The
3-topic cap narrows the kit's 3–5 range; it does not exceed it, so it is a policy choice rather than
a fork. A lesson that genuinely cannot be covered in 3 topics gets **split into two preflights**
(the skill's own remedy for the analogous >5 case), not a quiet fourth topic.

## What must not change here

**`submit_endpoint` and `prefill_base`** are frozen by `contracts/INTERACTION-DATA-CONTRACT.md` §2
for this deployment. They are correct as written. A wrong endpoint fails **silently** — the cadet
has the full conversation, clicks Submit, sees a page, and the work reaches nothing.

**`course_id`** must match a course id the receiver already knows. `phys-310` follows the pilot's
pattern, **but nobody has confirmed the receiver has it.** Confirm the course id exists in the
site's course list before the first artifact ships; a prefill link with an unknown course id saves
under nothing useful.

**The `cadet*` code identifiers** (`cadetId`, `setCadetId`, `cadet-id`, `--cadet-bg`,
`--cadet-border`, `cadet_id`) stay literal in every build. `localize.py` masks them before
substitution and restores them after. They are internal, never rendered, and renaming them is a
diff with no upside.

## Two lessons print the same topic — resolved 2026-08-05

The Fall 2026 workbook gives lessons 18 and 19 the identical topic string `Detection Methods`.
Because this course mints the slug, the filename, **and** the component name from the topic alone,
that string collides on all three at once — and it collides **silently**, since the second build
writes over the first artifact's file rather than erroring.

The schedule now disambiguates them by what each lesson actually reads:

| Lsn | Reading | topic string, settled |
|---:|---|---|
| 18 | 12.1–12.3 | `Detection Methods: Gas-Filled Detectors` |
| 19 | 12.4–12.6, 12.8 | `Detection Methods: Scintillation, Semiconductor, and Dosimetry` |

**This is a naming decision, not a physics one**, and it is recorded here because topic text is this
course's one load-bearing string. It costs nothing to change before publication and a new lesson row
afterwards.

**The general form is worth keeping**: a course that drops the lesson number from its identifiers
buys immunity from renumbering and pays for it with a uniqueness requirement on the topic. Both
halves of that trade showed up on the same day — the renumbering of lessons 13–17 cost this course
nothing, and this collision is the bill.
