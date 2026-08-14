# Portability Overlay — read this before `SKILL.md`

`SKILL.md` in this folder is the validated Physics 215 skill, and it was not rewritten for
portability on purpose: it is ~145 KB of hard-won, field-tested specification, and a mass
find-and-replace across it would corrupt code identifiers and produce awkward prose in exchange
for nothing a config layer cannot do. This file is that config layer.

> **Two corrections to what that paragraph used to claim.** It said "**byte-identical**" and
> "133 KB", and both have expired.
> - **The size is not a fixed number.** 133 KB was the 2026-07-30 snapshot; rev 4 took it to
>   ~145 KB. Do not treat any figure here as a checksum — `MANIFEST.sha256` is the checksum, and
>   `tools/verify.py` is what reads it. This sentence is about *why the file was not rewritten*,
>   and that argument gets stronger as the file grows, not weaker.
> - **The kit copy now LEADS the Claude Project copy.** "Byte-identical" described a one-way
>   copy out of the live Physics 215 project. Rev 4 (the backup-version button) was authored
>   **here first**, so until a human re-uploads this file into each course's Claude Project, the
>   project builds artifacts from the older rev 3 and will not emit the button. Nothing checks
>   this — project knowledge is uploaded by hand and unversioned. Treat the repo as the source of
>   truth and the upload as a required, unautomated deployment step.

**If the kit was localized with `tools/localize.py`, this overlay is already applied** — the
values below are baked into `SKILL.md` and you can skip to Step 1 of the skill. This file matters
only for the drop-in path, where the verbatim skill and a `COURSE_PROFILE.md` are uploaded
side by side.

---

## Step 0: Read `COURSE_PROFILE.md` first

Before Step 1 of `SKILL.md`, read `COURSE_PROFILE.md` from the project. Every value in its
`profile` block overrides the corresponding Physics 215 value in the skill. Where they conflict,
**the profile wins for identity and endpoints; the skill wins for architecture.**

## The substitution table

Apply these while reading `SKILL.md` and the source files. They are prose substitutions — they
change what the generated artifact *says*, never what it *does*.

| Skill says | Use instead | Where it shows up |
|---|---|---|
| `USAFA` / `United States Air Force Academy` | `institution_short` / `institution_full` | Tutor system prompt, start screen |
| `cadet` / `cadets` (prose) | `learner_singular` / `learner_plural` | Everywhere learner-facing |
| `USAFA Honor Code` and its quoted paragraph | `integrity_code_name` + `integrity_statement` | Start-screen callout, tutor opening, closing integrity question |
| `Physics 215` / `phys-215` | `course_name` / `course_id` | Header eyebrow, prefill `course` param |
| `Fall 2026` | `semester` | Header eyebrow |
| `physics` (as the subject) | `discipline` | Tutor role line, "state the physics directly" |
| `OpenStax University Physics Vol. 2` | `grounding_text` | Extraction and grounding language |
| the submit endpoint | `submit_endpoint` | `SUBMIT_ENDPOINT` constant |
| the prefill base | `prefill_base` | Hand-off link construction |
| the backup router base | `backup_base` | `BACKUP_ENDPOINT` constant |
| `2026-08` | `artifact_version` | `ARTIFACT_VERSION` constant |

> **`backup_base` is the one row `tools/localize.py` does not yet automate, and leaving it to the
> localizer is worse than forgetting it.** The localizer's rule table (`BASELINE` in
> `tools/localize.py`) knows `submit_endpoint` and `prefill_base`, and matching those whole URLs
> first is exactly what stops the later `physics` → `<discipline>` rule from firing *inside* them.
> `BACKUP_ENDPOINT` has no such guard, so a localized fork does not merely keep the Physics 215
> value — it produces a **mangled** one. The pilot's GitHub Pages host happens to contain the
> discipline word, and with no whole-URL rule to claim those characters first, the discipline rule
> rewrites them inside the hostname and yields a URL that resolves to nothing. `verify.py` will not
> catch it: the leftover scan watches the institution, learner, course and grounding tokens, not
> endpoints. *(Reproduce it in ten seconds: localize with `examples/COURSE_PROFILE.chem201-example.md`
> and grep the output's `SKILL.md` for `backup.html`.)*
> So on either path — drop-in or localized — **set `BACKUP_ENDPOINT` by hand and read it back out
> of the generated artifact.**
>
> Two more things about this row. It is **not** a link to a backup lesson; it is a router that
> takes the artifact's own `INTERACTION_ID` and decides what to open (skill Step 6, Common Mistake
> 35). And a course reusing the existing PREP receiver keeps the value **exactly as-is**, the same
> way it keeps `submit_endpoint` — the router lives beside the receiver and serves whatever course
> the slug belongs to. A course standing up its own backend needs its own router, or no button:
> `backup_base` pointing at a page that does not exist is worse than a red light with no button
> under it. Add the key to `COURSE_PROFILE.md` alongside `submit_endpoint` and `prefill_base`.

## What does NOT get substituted, ever

These are internal identifiers. They are never rendered to a learner, and renaming them breaks
CSS-to-JSX bindings for no benefit:

```
cadetId      setCadetId      cadet-id      --cadet-bg      --cadet-border
```

Leave them literal in every course, in every language. If a future reader finds `cadetId` in a
chemistry artifact and is confused, that is a comment's job, not a rename's.

## What the profile cannot change

Four things are architecture, not configuration. If a port needs one of them changed, that is a
fork of the kit and it needs its own review — do not improvise it inside a lesson build:

1. **The wire format.** Hash keys `t` / `i` / `r` / `d`, the LZ-String codec, and the
   `schema: 1` field list are frozen by `contracts/INTERACTION-DATA-CONTRACT.md` §8. Deployed
   artifacts cannot be revised, so over-capture now rather than retrofitting later.
2. **`d` is required.** An `r`-only submission reaches the database and earns nothing —
   no grade, no cohort rollup, no diagnostics (contract §3.1). This is not a policy you can
   relax per course.
3. **Slug determinism.** `lesson-<NN>-<topic-slug>`, generated by the skill, never requested
   from the instructor, never improvised. The prefill link passes the same variable so the two
   cannot drift.
4. **The preview gate.** Step 5's compact instructor preview before any code is written is the
   only quality gate in the pipeline. Removing it to save a turn is how bad probe topics reach
   a thousand students.

## Adaptation flags to raise at preview time

When the profile's `discipline` is outside math and the physical sciences, three parts of the
skill need a substitute rather than a translation. Say so in the preview rather than silently
improvising — see `docs/ADAPTING_TO_A_NEW_DISCIPLINE.md`:

- **Two-pass arithmetic verification** (Step 4, extension problems) assumes a numeric answer.
- **KaTeX math rendering** is harmless but idle in a course with no equations.
- **Probe topics as "whether the learner can …"** still holds, but the misconception catalogue
  for a humanities course is about interpretation and evidence, not sign errors and units.
