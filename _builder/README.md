# `_builder/` — where PREP's interactive artifacts are made

PREP *consumes* Claude artifacts; this tree *produces* them. It arrived on 2026-08-07 from a
separate repository, `ranador/Socratic-Artifact-Builder`, which is now archived. Reasoning and the
full import record: [`docs/decisions/BUILDER-MERGE.md`](../docs/decisions/BUILDER-MERGE.md).

## Why the underscore

**GitHub Pages serves this repository with default Jekyll processing, which excludes paths
beginning with `_`.** That is not a style choice, it is the access control on everything below.
Verified on 2026-08-07:

```
…/docs/contracts/INTERACTION-PREFILL-LINK.md   → serves the real document
…/_archive/artifact-receiver-v1/               → 404
```

So `docs/`, `scripts/` and `supabase/` are already publicly readable, and a top-level `builder/`
would have published every `BUILD-LOG.md`, the 132 KB tutor system prompt, the misconception
taxonomies and the worked extension problems to the open web. **Never add a `.nojekyll` file
without moving `_archive/` and `_builder/` first** — one empty file would expose both trees
instantly, and nothing would report it.

## The map

```
preflight-kit/            the shared build system — HASH-LOCKED, never edited per course
courses/phys-215/         profile · schedule · artifacts/BUILD-LOG.md · artifacts/REVIEW-NOTES.json
courses/phys-310/         the same, plus texts/MURRAY-GROUNDING.md (a reconstructed corpus)
courses/*/artifacts/*.jsx GITIGNORED — the sources live in Supabase Storage (see below)
courses/*/build/          GITIGNORED — localizer output, wiped and rewritten on every run
CHANGELOG.md              the builder's own history, 2026-07-30 to 2026-08-06
```

**The one structural rule: one copy of the kit, one directory per course.** `MANIFEST.sha256`
covers seven files and `tools/verify.py` is what notices a change. Editing the kit to suit one
course forks it for every course at once. All per-course variation lives in
`courses/<id>/COURSE_PROFILE.md`.

## The `.jsx` is not here, and that is deliberate

46 published artifacts come to ~8 MB. They live in the private Supabase Storage bucket
`artifact-sources`, read-gated on staff (`supabase/migrations/023_artifact_sources_storage.sql`).
To get a working local tree:

```bash
python scripts/artifacts/sync_artifacts.py status
python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit
```

The source itself is not secret — claude.ai shows an artifact's formatted code behind a Code
button, so anyone who can open the artifact can already read it. **The build record is a different
matter**: it carries grounding section and page numbers (CORE.md §6 — never surfaced to a cadet),
the tutor prompt, and worked extension problems. That is why the bucket is private and why this
tree is `_`-prefixed.

## Tools

| Command | Does |
|---|---|
| `python _builder/preflight-kit/tools/verify.py` | 22 checks that the kit is intact. **Run it from a fresh clone**, not just here — the bug it exists for is invisible in a working tree |
| `python _builder/preflight-kit/tools/localize.py <profile> -o <dir>` | bake one course's profile into a build-ready copy of the kit |
| `python scripts/artifacts/check_artifact.py <file.jsx>` | what is checkable without a JSX parser. **Not a syntax check** — see below |
| `python scripts/artifacts/sync_artifacts.py …` | move sources between here and Storage; `purge` is the reversal lever |
| `python scripts/review/serve_artifact_review.py` | the local read-only review page: `--dump`, `--links`, `--stale`, `--grounding` |
| `python scripts/review/serve_review.py` | review the phys-310 grounding corpus. **This one writes** `STATUS: REVIEWED` into the corpus |

## Three things that will catch you

- **Publishing is the only JSX parser this project has.** `node --check` reports exit 0 on an
  invalid `.jsx` — Node auto-detects any file containing `import`/`export` as ESM and does not
  reject JSX on that path. A green `check_artifact.py` is not a parse either; it checks NUL bytes,
  delimiter balance, contract strings and per-course constants. A fresh artifact is unparsed until
  it is published.
- **A rebuild mints a NEW slug and therefore a NEW lesson row.** Contract §3.2 ends every slug in
  8 random hex minted once per build, so applying a review note to a *published* artifact is a
  republish and a re-registration — never an in-place edit.
- **Reviewing happens on the site now, not here.** `site/faculty/artifacts.html` writes
  `review-notes.json` to Storage; `sync_artifacts.py pull-reviews` mirrors it back into
  `courses/<id>/artifacts/REVIEW-NOTES.json`, which stays committed. `serve_artifact_review.py` is
  **read-only for artifacts** — two writers on one file is how that record would start disagreeing
  with itself. Its corpus half still writes, because that is a different file.

## What did not come across

`project-bootstrap` and `check_slots.py` installed the agent-instruction scaffold into a *new*
project. PREP is already bootstrapped, so they belong in the container's `.ai/` seed at
`d:\01 -- AI Projects\.ai\`, not here.
