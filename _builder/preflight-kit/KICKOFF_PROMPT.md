# Kickoff Prompt — the first message of an artifact-build chat

Attach the lesson's textbook PDF(s), then paste one of these.

---

## Standard build (the 95% case)

```
Build the preflight artifact for Lesson NN.
```

That is the whole message. With the project instructions and `COURSE_PROFILE.md` in place, the
skill infers the topic from the schedule file, generates the slug and objective keys, extracts
the attached PDF, and comes back with the Step 5 preview. Anything more is usually noise.

---

## Build with a scope constraint

```
Build the preflight artifact for Lesson NN.

Scope note: [what to hold back or emphasize — e.g. "we derive Gauss's law in class, so keep the
preflight on flux as a concept and don't push them toward the derivation"].
```

The scope note lands in `LESSON_CONFIG.scope_note` and shapes what the tutor probes. Omit the
field entirely when there is no constraint.

---

## First build in a brand-new project (run this once)

```
Before we build anything: read COURSE_PROFILE.md, the two contract files, and the
preflight-factory-v2 skill. Then confirm back to me, in one short block:

- the course identity and learner term you'll use
- the submit endpoint and prefill base you'll bake in
- the slug pattern you'll generate
- anything in the skill that still reads as Physics-215-specific after applying the profile

Don't build a lesson yet.
```

This is a five-minute check that catches an unlocalized string or a stale endpoint before it
ships inside a thousand student sessions rather than after.

---

## After you publish

```
Published. Public URL: https://claude.ai/public/artifacts/…
```

You get back the one-click prefill link that opens the Lessons page with the new-lesson form
filled in. Review the slug and URL, Save, then set the objective keys on the lesson row by hand
— there is no prefill parameter for objectives.

---

## Rebuilding a published lesson

```
Rebuild Lesson NN's artifact. Keep the slug identical; [what changed].
```

A published artifact is frozen — the slug, objective keys, submit URL, and model candidates
change only by rebuilding and re-publishing. Re-using the existing slug in the prefill link
*edits* that lesson rather than erroring, which is the correct way to repoint it at the rebuild.
