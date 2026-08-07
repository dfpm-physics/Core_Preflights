# iPREP Preflight Kit — portable JiTT artifact factory

Everything needed to stand up the preflight system for a new course: the validated build skill,
the frozen wire contracts, the verbatim source files the skill copies from, a config layer that
makes all of it course-agnostic, and the reasoning behind the parts that look arbitrary.

Extracted from the Physics 215 / Fall 2026 pilot at USAFA. The architecture is course- and
discipline-neutral; the identity is not, which is what `COURSE_PROFILE.md` is for.

---

## What this system does

An instructor uploads a lesson's textbook pages. The skill produces a self-contained React
artifact that runs a ~10-minute Socratic conversation with each student before class, grounded in
the reading, and submits a structured report back to the course site. Aggregated across the
class, those reports drive Just-in-Time Teaching adjustments before the lesson.

Three design commitments make it work, and all three survive porting:

- **Effort is the grade.** Engagement, not correctness. A student who works through the whole
  conversation and understands nothing earns full marks. Everything diagnostic stays diagnostic.
- **The artifact is the only submission path.** It emits both a human-readable report (`r`) and a
  structured assessment (`d`). Without `d` there is no grade and no cohort rollup.
- **Grounding is inlined and invisible.** The textbook is extracted into the artifact at build
  time; the student never sees a citation to it, because they read a different book.

---

## Layout

```
COURSE_PROFILE.template.md    the one file you edit — course identity, vocabulary, endpoints
SETUP_NEW_PROJECT.md          the checklist. start here.
PROJECT_INSTRUCTIONS.md       paste into the new project's custom instructions
KICKOFF_PROMPT.md             what to type to start a build

skill/preflight-factory-v2/
  SKILL.md                    the validated build skill, byte-identical to the pilot
  PORTABILITY_OVERLAY.md      Step 0: how the profile overrides it (drop-in path only)

contracts/                    FROZEN. wire format and prefill parameters. these win over
                              everything, including the skill.
sources/                      the files the skill copies verbatim: tutor prompt, lesson-config
                              spec, report spec, theme reference
templates/                    course schedule template (the skill reads topics from it)
examples/                     a filled reference profile, a full-port profile, a real schedule
tools/localize.py             bakes a profile into course-specific copies of the above
tools/verify.py               proves the payload is intact and the localizer is safe
MANIFEST.sha256               hashes of the seven verbatim files
PROVENANCE.md                 what's a snapshot vs. authored, and how to re-sync
docs/
  BACKEND_OPTIONS.md          reuse the receiver, build one, or run without — decide first
  ADAPTING_TO_A_NEW_DISCIPLINE.md   what changes outside physics (four things; not the architecture)
  OPEN_ISSUES.md              inherited flags. read before the first build.
  LESSONS_LEARNED.md          why the rules are the rules
```

---

## The fast path

```bash
python3 tools/verify.py                                # 22 checks, ~2 seconds
cp COURSE_PROFILE.template.md COURSE_PROFILE.md
$EDITOR COURSE_PROFILE.md                              # fill in every value
python3 tools/localize.py COURSE_PROFILE.md --check    # preview substitutions
python3 tools/localize.py COURSE_PROFILE.md            # writes ./build
```

Then create the project, upload from `build/`, install the skill, paste the project
instructions, and run the verification prompt before building anything real.
`SETUP_NEW_PROJECT.md` walks all of it.

---

## Three things to know before you start

**Decide the backend first.** A new course in the same department deployment needs one changed
value. A new institution needs a receiver built before any artifact ships, because a wrong
endpoint fails *silently* — the student does the full session and the work goes nowhere.
`docs/BACKEND_OPTIONS.md`.

**A published artifact is frozen.** Slug, objective keys, submit URL, and model candidates are
baked in at publish time. Changing one is a rebuild and a re-publish.

**The preview gate is the quality system.** One compact preview before any code is written. It's
the only place a bad probe topic gets caught before it reaches a thousand students. Don't let a
build skip it.

---

## What the profile can't change

Configuration handles identity, vocabulary, integrity language, grounding text, and endpoints.
Four things are architecture, and changing one is a fork that needs its own review: the wire
format (frozen, §8 of the contract), the requirement that `d` be emitted, slug determinism, and
the preview gate. `PORTABILITY_OVERLAY.md` says why for each.
