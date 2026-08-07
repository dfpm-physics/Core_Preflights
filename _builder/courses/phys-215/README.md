# PHYS 215 — course working directory

Everything specific to Physics 215. The shared build system lives at
[`preflight-kit/`](../../preflight-kit/) and **is never edited per course** — it is hash-locked,
and editing it here would fork it for every course at once.

| file | what it is |
|---|---|
| [`COURSE_PROFILE.md`](COURSE_PROFILE.md) | the one file you edit — identity, vocabulary, endpoints, session shape |
| [`phys215_fall2026_schedule.md`](phys215_fall2026_schedule.md) | lesson table; the skill reads topics and readings from it by lesson number |
| `build/` | localizer output. **Disposable and gitignored** — regenerated, never edited |

There is no `texts/` directory here, deliberately. PHYS 215 grounds in OpenStax, which is a real
downloadable PDF attached per lesson in the Claude Project — the kit's normal workflow. PHYS 310's
reconstructed-corpus-plus-review path is scoped to PHYS 310 and must not be borrowed.

---

## Status

**Profile and schedule complete as of 2026-08-04; localizes cleanly.** PHYS 215 · General
Physics II — E&M and Optics · Fall 2026, grounded in OpenStax University Physics, under 80 of
1000 course points. The real 41-lesson Fall 2026 schedule is in place — 37 lessons marked for a
preflight.

**No artifact has been built for this course from this repository.** The pilot's published
PHYS 215 artifacts predate this repo and are not tracked here.

### This course is the localizer's baseline — read this before trusting a clean run

Every value in `localize.py`'s `BASELINE` dict is a PHYS 215 value. So **localizing this course
substitutes nothing and `build/` comes out byte-identical to the kit.** Verified 2026-08-04:
`0 active substitutions` and `0` replacements across all ten files. That is correct, not broken —
`verify.py` check 2 asserts exactly this no-op.

**The consequence that matters: the leftover scan cannot protect this course.** It prints
`clean — no baseline institution/learner/course strings remain`, and that clean is vacuous rather
than earned. `localize.py:268` only looks for a baseline string when the profile *changes* it
(`if p[k] != BASELINE[k]`); here nothing changes, so the scan has nothing to look for. **A profile
value you forget to fill still equals the baseline, so it is not flagged and the run looks
perfect.** On every other course that scan is the safety net. Here the sentinel check below is the
only mechanical guard, and reading the profile is the only real one.

```bash
sed -n '/^```profile$/,/^```$/p' COURSE_PROFILE.md | grep -c UNSET   # must print 0
```

Scan the fenced block, not the whole file — a plain `grep` matches the instructions that mention
the sentinel and can never reach 0. `localize.py --check` does not cover it either: it previews
only the keys it substitutes, and `course_title`, `student_text`, and `grade_weight_note` are read
by the skill rather than the localizer.

---

## Build

Run from the kit root — `localize.py` resolves both the profile path and `-o` relative to
`preflight-kit/`, which is what lets one shared kit serve many courses:

```bash
cd preflight-kit
python tools/verify.py                                                    # 22 checks; kit intact
python tools/localize.py ../courses/phys-215/COURSE_PROFILE.md --check     # preview substitutions
python tools/localize.py ../courses/phys-215/COURSE_PROFILE.md \
       -o ../courses/phys-215/build
```

**`localize.py` deletes the output directory before writing it.** That is fine for `build/` and
would not be fine for anything you had edited by hand, which is why nothing here is.

Then follow [`preflight-kit/SETUP_NEW_PROJECT.md`](../../preflight-kit/SETUP_NEW_PROJECT.md)
from step 3: create the Claude Project, upload from `build/`, install the skill, paste the project
instructions, run the kickoff verification prompt, and build one throwaway lesson end to end
before any real lesson.

After a build, check the `.jsx` before publishing:

```bash
python scripts/artifacts/check_artifact.py courses/phys-215/artifacts/<file>.jsx
```

**That is not a syntax check** — there is no JSX parser on this machine, and `node --check` passes
invalid JSX silently. It checks NUL bytes, delimiter balance, the frozen contract strings, the
forbidden strings, and the per-course constants. **The Claude session you publish from is the
parser.**

---

## The four things most likely to go wrong here

**Lessons 30–41 have no confirmed grounding source.** The profile names OpenStax University
Physics **Vol. 2**, but the course's last twelve lessons are optics and modern physics, which
appear to live in **Volume 3**. Eleven of those are preflight lessons. Unresolved and owned by
recker — see `COURSE_PROFILE.md` → "Open: Vol. 2 does not cover the whole course". **Build
lessons 2–29 freely; stop at 30 until it is settled.**

**The `Reading` column will send you to the wrong chapter.** Those are Cengage numbers, and the
tutor is grounded in OpenStax, which numbers differently. Attach the chapter that covers the
topic and confirm by reading it. A mismatch does not error — it produces a confident artifact
grounded in the wrong material.

**The slug needs a suffix the skill does not mention.** `SKILL.md` still describes a deterministic
suffix-less slug; `INTERACTION-DATA-CONTRACT.md` §3.2 requires `<stem>-<8 random lowercase hex>`.
Build from the contract. `check_artifact.py` fails a suffix-less `INTERACTION_ID` — this was
missed once already, on PHYS 310's first build.

**`d`-key emission is documented but unproven** (`preflight-kit/docs/OPEN_ISSUES.md` §1). In the
pilot, effort scores defaulted to null and the pipeline treated that as 0 until an instructor
finalized by hand. An `r`-only submission reaches the database and earns nothing — no grade, no
cohort rollup — while looking completely successful from the cadet's side. **This is what the
throwaway lesson is for.** Confirm a grade was actually written from `d.effort`, not merely that
the report arrived. Note the receiver's scoring was rewritten on 2026-07-30 to score preflights
out of 3, which the frozen contract §5.2 still documents as 0–2.
