# Getting an artifact into the library without a clone

**Date:** 2026-08-19 · **Proposed by:** Claude · **Requested by:** Matthew Recker
**Status:** PROPOSED — nothing built. This document exists to be argued with before code.

---

## The reader this is for

An instructor who has just finished building a preflight artifact in a Claude session and wants
cadets to be able to use it. They are a physicist, not a developer. They have a PREP account and a
browser. They arrived asking **"I made a lesson — how do I get it into the system?"**

Today the honest answer is: clone a git repository, obtain a credential file out-of-band from the
course director, put a file in a specific gitignored directory, and run a Python command. That is
the answer this document exists to replace.

## Why the current design is the way it is, and why that stopped fitting

`scripts/artifacts/sync_artifacts.py` was written for a true statement: **one person had every
`.jsx` on one machine**, had already published them to claude.ai, and needed them moved into
Storage in bulk. A CLI over a local directory is the right tool for that job, and it did it.

Two things changed.

1. **PHYS 110 got its own artifact author**, who will build every future PHYS 110 interaction. The
   course director is not going to be a courier for somebody else's files, and should not be.
2. **The five PHYS 110 artifacts proved the cost of the gap.** They were published and registered
   but never uploaded, so for weeks nobody could review their objectives and no Gemini backup could
   be generated — which meant a rate-limited PHYS 110 cadet had nowhere to go at all. The gap was
   silent the entire time.

The failure mode is not "uploading is hard". It is that **an artifact outside the library looks
completely fine from every screen anybody looks at.** The lesson is registered, cadets can launch
it, grades land. Nothing says the source is missing.

---

## What is actually required

An instructor, signed in to PREP, gets a finished `.jsx` into `artifact-sources` and sees it in the
Artifacts page — **without a clone, a credential, Python, or the course director.**

Non-goals, stated so they are not smuggled in later:

- **Not** building the artifact. That is the course's Claude Project and `_builder/preflight-kit/`.
- **Not** publishing it to claude.ai. That is [`PUBLISH-ARTIFACT.md`](../operations/PUBLISH-ARTIFACT.md)
  and it stays a human step, because publishing is irreversible.
- **Not** registering the lesson. A director does that through the prefill link.

---

## Options

### A. Upload panel on the faculty Artifacts page — RECOMMENDED

The instructor downloads the `.jsx` from their Claude session and drops it on the Artifacts page.
The browser parses it, writes `<course>/<slug>/source.jsx` and `<course>/<slug>/build.json`, and
updates that course's `index.json`.

**Why this one.** The instructor is *already signed in*, and migration 023 already grants a
director INSERT and UPDATE on this bucket — the permission exists and is unchanged. The page
already writes to the bucket (`review-notes.json`, `index.json`), so this is a fourth write on a
path that works, not new infrastructure.

**What it costs.** The `.jsx` parser is currently Python (`artifact_parse.py`). The browser needs
the same extraction — slug, objectives, component, file name — and that is a second implementation
of a load-bearing parse. Two copies drift; today's session found the `INTERACTION_ID` regex living
in **four** places, two of which were silently wrong. Mitigation: keep the browser's job as small
as possible — extract only what `index.json` needs, and let the repo-side tool remain the one that
computes the full build record.

### B. An edge function the SKILL posts to — rejected

An artifact-builder skill POSTs the `.jsx` to a Supabase function, which parses and stores it.
Superficially the most automated option, and it is what "an endpoint that receives the jsx from the
skill" literally describes.

**Rejected because the skill has no identity.** `preflight-factory-v2` runs inside a Claude
conversation. It holds no PREP session and cannot obtain one. Every way of giving it one is worse
than the problem: a shared secret pasted into a Claude Project is a credential in an unversioned
place nobody can rotate; a per-instructor token is the credential handoff this whole document
exists to remove. The *human* is the one with an identity, and option A uses it.

*(Worth stating because it is the intuitive design and will be proposed again.)*

### C. A one-click link, like the prefill link — rejected on size

The established idiom here is that an AI hands the human a URL and the human clicks it while signed
in ([`INTERACTION-PREFILL-LINK.md`](../contracts/INTERACTION-PREFILL-LINK.md)). It would fit
perfectly except that an artifact is **120–250 KB**. Even compressed it is far past any workable
URL length. The idiom does not stretch this far.

### D. Commit the `.jsx` to git — rejected, and already rejected once

This is what the Storage bucket exists to avoid: ~8 MB of artifacts in every clone's history
forever, and it still requires a clone. `sync_artifacts.py`'s own header records the reasoning.

### E. Do nothing; simplify the CLI instead — the honest baseline

Keep the current path and make the runbook better —
[`ONBOARD-ARTIFACTS.md`](../operations/ONBOARD-ARTIFACTS.md) already exists as of today.

**This is a real option and should not be dismissed.** If exactly one more instructor ever authors
artifacts, a one-page runbook is cheaper than a feature. It is rejected only because the stated
direction is *several* instructors authoring their own interactions — at which point a credential
handoff per instructor becomes the recurring cost, and each one is a person who can write to live
Storage from a shell.

---

## The problem option A has to solve first

**`index.json` is DERIVED from `BUILD-LOG.md`, which lives in git.**

Every `sync_artifacts.py push` regenerates each course's index from the local build log and the
local `.jsx`. So a browser upload that writes `index.json` is **overwritten by the next push from
anybody's clone**, and the artifact silently drops out of the library while its `source.jsx` sits
in the bucket untouched.

This is not hypothetical. It happened on 2026-08-19 in the other direction: a published URL
registered through the site was erased by the next push, because the log did not carry it. That is
in the CHANGELOG for that date.

**The fix is a rule this repository already uses.** `review-notes.json` is seeded by the first push
and after that **the site owns it** — `push` refuses to overwrite it and `pull-reviews` brings the
site's version back into git. The same ownership split applies here:

| Object | Writer | How the other side gets it |
|---|---|---|
| `source.jsx`, `build.json` | whoever uploaded it — CLI or browser | compared by sha256; identical content is skipped |
| `index.json` | **merged, not regenerated** | `push` must preserve entries whose `source.jsx` exists in the bucket but not locally |
| `review-notes.json` | the site, after first seed | `pull-reviews` *(already true)* |

The one real change is that `push` stops treating the local tree as the whole truth for
`index.json`. An entry it did not produce must survive. Without this, option A is not merely
incomplete — it is actively unsafe, because it would appear to work and then lose work later.

---

## What this does not fix

- **Nothing detects a published-but-unuploaded artifact.** That was the actual PHYS 110 failure and
  no option above addresses it. The Artifacts page could flag a registered lesson whose slug has no
  `source.jsx`, and probably should, but that is a separate change.
- **Dialect drift.** An artifact built outside the kit can differ enough that `to_gemini.py` cannot
  port it (2026-08-19: 10 of 23 anchors missed on PHYS 110's builds). Upload does not make an
  artifact portable, and an instructor uploading a non-kit build will hit this.
- **`BUILD-LOG.md` still needs a human.** Grounding, cross-checks and the published URL are not
  derivable from the `.jsx`. Upload gets the source in; it does not write the record.

---

## Recommendation

**Option A, with the `index.json` merge rule landed first and separately.** The merge rule is
independently correct, is small, and protects the current CLI path too. Building the upload panel
on top of an index that a later push can silently clobber would ship a feature whose failure is
invisible and delayed — which is precisely the class of bug this system keeps paying for.

If only one more instructor is ever involved, take option E instead and spend nothing.
