# One shared kit, one directory per course

**Decided:** 2026-07-30 · **By:** recker · **Status:** active

## The decision

This repository is the master project for many courses. `preflight-kit/` holds exactly one copy of
the build system, unmodified. Every course gets `courses/<course-id>/` holding its
`COURSE_PROFILE.md`, its schedule, and its disposable `build/`.

```
preflight-kit/            shared, hash-locked, never edited per course
courses/phys-310/         profile · schedule · build/ (gitignored)
courses/<next>/           same shape
```

Builds run from the kit root and direct output into the course directory:

```bash
python tools/localize.py ../courses/phys-310/COURSE_PROFILE.md -o ../courses/phys-310/build
```

## Why this and not the alternatives

**The kit is hash-locked.** `MANIFEST.sha256` covers seven files and `tools/verify.py` checks them.
That mechanism only means something if there is one copy to check. It is also the thing that makes
the alternatives bad.

**Rejected — a full kit copy per course.** The obvious layout, and it silently destroys the
guarantee. Seven hash-locked files times N courses is N chances for one to drift, and `verify.py`
run in one course's copy says nothing about the others. Worse, it is *comfortable*: fixing a build
problem by editing that course's copy of the skill feels local and correct, and the next course
inherits nothing. Within a semester the copies disagree and no mechanism reports it.

**Rejected — a branch per course.** Same divergence, plus the merges. The kit is not the thing that
varies between courses; the profile is. Modelling per-course variation as a branch means every kit
fix needs N merges, and a course that skips one is silently behind.

**Rejected — one profile at the kit root, swapped between builds.** What the kit ships by default
and correct for a single course. With many, the checked-in profile is whichever course was built
last, and `git log` becomes the only record of what a given build actually used.

**The deciding property:** `localize.py` resolves both the profile path and `-o` relative to the
kit root, so per-course output was already supported — it needed a directory convention, not a code
change. Verified before adopting: a relative `-o` pointing outside the kit writes 27 files to the
right place with a clean leftover scan.

## What this costs

**Nothing enforces the convention.** No check fails if someone drops a profile at the kit root or
edits the kit for one course. The guard is `verify.py` noticing a hash change, which catches the
damaging case but only when someone runs it. Run it before each build — the course READMEs say so.

**A kit upgrade is still manual.** v1.1 means re-verifying and re-localizing every course. That is
work, but it is work proportional to the number of courses rather than to the number of divergences,
which is the trade being bought.

## What would reverse this

A course needing a genuinely different build system — a different discipline whose skill diverges
past what `PORTABILITY_OVERLAY.md` can express. That is a fork with its own review, not a second
copy quietly added under `courses/`. `preflight-kit/docs/ADAPTING_TO_A_NEW_DISCIPLINE.md` is the
thing to read first, and it argues the divergence is usually smaller than it looks.
