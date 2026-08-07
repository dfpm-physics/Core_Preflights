# PHYS 310 — course working directory

Everything specific to Physics 310. The shared build system lives at
[`preflight-kit/`](../../preflight-kit/) and **is never edited per course** — it is hash-locked,
and editing it here would fork it for every course at once.

| file | what it is |
|---|---|
| [`COURSE_PROFILE.md`](COURSE_PROFILE.md) | the one file you edit — identity, vocabulary, endpoints, session shape |
| [`phys310_schedule.md`](phys310_schedule.md) | lesson table; the skill reads topics and readings from it by lesson number |
| `build/` | localizer output. **Disposable and gitignored** — regenerated, never edited |

---

## Status

**The profile is complete and localizes cleanly.** PHYS 310 · Principles of Nuclear Science ·
Fall 2026, grounded by default in Murray & Holbert, *Nuclear Energy* (8th ed.), 60 of 1000 course
points.

**The schedule is still the template's placeholder lessons.** That is the remaining blocker for a
real build — topic strings mint the slug, and a published artifact is stuck with whatever it was
built from.

Before any re-localize, confirm no sentinel values survive:

```bash
sed -n '/^```profile$/,/^```$/p' COURSE_PROFILE.md | grep -c UNSET   # must print 0
```

Scan the fenced block, not the whole file — a plain `grep` matches the instructions that mention
the sentinel and can never reach 0. `localize.py --check` does not cover it either: it previews
only the keys it substitutes, and `course_title`, `student_text`, and `grade_weight_note` are read
by the skill rather than the localizer.

**Read `COURSE_PROFILE.md`'s two grounding notes before building a lesson.** Grounding here is
per-lesson by design, and one sentence in the pilot's tutor prompt is factually wrong for this
course because our cadets read the same book the tutor is grounded in.

---

## Build

Run from the kit root — `localize.py` resolves both the profile path and `-o` relative to
`preflight-kit/`, which is what lets one shared kit serve many courses:

```bash
cd preflight-kit
python tools/verify.py                                                   # 22 checks; kit intact
python tools/localize.py ../courses/phys-310/COURSE_PROFILE.md --check    # preview substitutions
python tools/localize.py ../courses/phys-310/COURSE_PROFILE.md \
       -o ../courses/phys-310/build
```

Read the leftover scan at the end. It flags baseline strings (`Physics 215`, `OpenStax`) that
survived — some survivors are legitimate, but each deserves a look.

**`localize.py` deletes the output directory before writing it.** That is fine for `build/` and
would not be fine for anything you had edited by hand, which is why nothing here is.

Then follow [`preflight-kit/SETUP_NEW_PROJECT.md`](../../preflight-kit/SETUP_NEW_PROJECT.md)
from step 3: create the Claude Project, upload from `build/`, install the skill, paste the
project instructions, run the kickoff verification prompt, and build one throwaway lesson end to
end before Lesson 2.

---

## The two things most likely to go wrong here

**`course_id` may not exist on the receiver yet.** `phys-310` follows the pilot's naming pattern,
but nobody has confirmed the DFPM site knows it. A prefill link carrying an unknown course id
saves under nothing useful — and it is visible only if someone looks. Confirm before the first
artifact ships.

**`d`-key emission is documented but not built** (`preflight-kit/docs/OPEN_ISSUES.md` §1). In the
pilot, effort scores defaulted to null and the pipeline treated that as 0 until an instructor
finalized by hand. An `r`-only submission reaches the database and earns nothing — no grade, no
cohort rollup — while looking completely successful from the cadet's side. **This is what the
throwaway lesson is for.** Confirm a grade was actually written from `d.effort`, not merely that
the report arrived.
