# Setting Up a New Course — checklist

Target: a working project that can build its first artifact in about an hour, most of which is
filling in the profile and deciding the backend question.

---

## Before you start

Decide the backend. `docs/BACKEND_OPTIONS.md` has the full treatment; the short version:

- **Same department deployment?** Change `course_id` and nothing else. Minutes.
- **New institution or database?** You need a receiver first. Days. Do not build artifacts until
  it exists and you have submitted one test session end to end.

Everything below assumes that question is answered.

---

## 0. Verify the kit unpacked intact

```bash
python3 tools/verify.py
```

Twenty-two checks in about two seconds: the seven verbatim files match their hashes, the
localizer is a true no-op under the pilot's own profile, a full port leaves no baseline strings
and no doubled substitutions, code identifiers survive, contract line endings are preserved, and
two runs agree. A hash mismatch means a file changed in transit or someone edited a frozen
contract — resolve that before going further.

## 1. Fill in the profile

Copy `COURSE_PROFILE.template.md` to `COURSE_PROFILE.md` and complete every value in the
`profile` block. Use `examples/COURSE_PROFILE.phys215.md` (a same-institution reference) or
`examples/COURSE_PROFILE.chem201-example.md` (a full port) as a model.

The values that most often get set wrong: `course_id` must match what your receiver knows;
`submit_endpoint` must be real; `learner_singular` should be the word your students are actually
called.

## 2. Localize (recommended) or go drop-in

**Path A — localize.** Bakes the profile into course-specific copies:

```bash
python3 tools/localize.py COURSE_PROFILE.md --check   # preview the substitutions
python3 tools/localize.py COURSE_PROFILE.md           # write ./build
```

Read the leftover scan at the end. It flags baseline strings (`USAFA`, `cadet`, `Physics 215`,
`OpenStax`) that survived. Some survivors are legitimate — revision history, archived rationale —
but each one deserves a look. Upload from `build/`.

**Path B — drop-in.** Upload the kit verbatim plus your `COURSE_PROFILE.md`, and let
`skill/preflight-factory-v2/PORTABILITY_OVERLAY.md` substitute at build time. Nothing to run, and
the skill stays byte-identical to the validated original — but every build spends context
re-reading the overlay, and there is more room for a value to be missed. Prefer Path A unless you
have a reason to keep the skill unmodified.

## 3. Create the Claude Project

Upload to project knowledge:

- `COURSE_PROFILE.md`
- `contracts/INTERACTION-DATA-CONTRACT.md`
- `contracts/INTERACTION-PREFILL-LINK.md`
- `sources/02_TUTOR_SYSTEM_PROMPT.md`
- `sources/03_LESSON_CONFIG_SPEC.md`
- `sources/04_OUTPUT_REPORT_SPEC.md`
- `sources/THEME_REFERENCE.md`
- your schedule file (from `templates/course_schedule.template.md`)
- `docs/OPEN_ISSUES.md` — so builds inherit the known flags rather than rediscovering them

Skip `docs/LESSONS_LEARNED.md` and `docs/ADAPTING_TO_A_NEW_DISCIPLINE.md` in project knowledge
unless you're porting outside physics — they're for you, and they cost context on every build.

## 4. Install the skill

Upload `skill/preflight-factory-v2/` (both `SKILL.md` and, on Path B, `PORTABILITY_OVERLAY.md`)
as a skill. Confirm it appears in the available-skills list before the first build.

## 5. Set project instructions

Paste `PROJECT_INSTRUCTIONS.md`, editing the bracketed values. This is what makes "Build the
preflight artifact for Lesson 12" a complete request.

## 6. Verify before you build anything real

Open a chat and paste the "first build in a brand-new project" prompt from `KICKOFF_PROMPT.md`.
It asks Claude to read the profile and contracts and report back the identity, endpoints, and
slug pattern it would use — without building. Five minutes, and it catches an unlocalized string
or stale endpoint before it ships inside a thousand sessions.

## 7. Build one throwaway lesson end to end

Not a real lesson. Build it, publish it, register it with the prefill link, take the session
yourself as a student, submit, and then confirm three things:

- the report arrived and is readable
- a grade was written from `d.effort` — **this is the one most likely to fail** (see
  `docs/OPEN_ISSUES.md` §1)
- the lesson appears correctly under the right course

Only now build Lesson 2.

---

## Per-lesson loop, once you're running

1. Attach the lesson PDF(s). Say `Build the preflight artifact for Lesson NN.`
2. Review the Step 5 preview — probe topics, objective keys, extension problems. Approve or edit.
3. Receive the `.jsx`. Publish it (Share → Publish).
4. Paste the public URL back. Receive the one-click prefill link.
5. Open it, review the slug and URL, Save. Set the objective keys on the lesson row by hand.

Roughly fifteen minutes per lesson once the PDF is in hand, most of it in step 2 — which is where
the time belongs.
