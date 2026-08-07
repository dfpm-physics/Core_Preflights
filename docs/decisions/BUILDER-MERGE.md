# Merging Socratic-Artifact-Builder into PREP

**Date:** 2026-08-07 · **Decided by:** Matthew Recker · **Executed by:** Claude
**Status:** in progress — Storage step gated on a human applying migration 023

---

## The problem

PREP consumes Claude artifacts. A separate private repository, `ranador/Socratic-Artifact-Builder`,
produced them. They were two halves of one loop in two repositories, and the split was costing
real things:

- **The kit was extracted from PREP in the first place.** `preflight-kit/PROVENANCE.md` records the
  snapshot: 2026-07-30, "extracted from the Physics 215 / Fall 2026 iPREP project at USAFA". Two of
  the seven hash-locked files are copies of PREP's own `docs/contracts/`. They have already
  drifted — the data contract by one line, the prefill contract by 35 — and PREP's copies are the
  newer ones.
- **46 published artifacts had their slugs and live URLs in exactly one place**: two `BUILD-LOG.md`
  files in a repository PREP could not read. Zero are registered, and an unregistered lesson
  swallows a cadet's work silently.
- **Review needed a clone, a checkout and a terminal.** Approving an objective ran through a
  loopback Python server.
- **Registration needed a slug transcribed by hand between two repositories.** That failure has
  already happened once: `phys310-atoms-and-nuclei-83022f32` was minted from a topic string a hand
  transcription had dropped a word from, and nothing in either toolchain could have caught it.

## What was decided

| Decision | Reasoning |
|---|---|
| **The `.jsx` goes to Supabase Storage, not git** | 46 artifacts ≈ 8 MB. Committing puts that in every clone's history permanently. The source is not secret — claude.ai shows an artifact's formatted code behind a Code button — so the reason is size and history, not confidentiality |
| **Private bucket, read-gated on `app.is_staff()`, write-gated on director** | The `.jsx` is public by other means; the **build record is not**. It carries grounding section and page numbers (CORE.md §6 — never surfaced to a cadet), the tutor system prompt, misconception taxonomies and worked extension problems |
| **`_builder/`, not `builder/`** | GitHub Pages runs default Jekyll here (no `.nojekyll`), which excludes `_`-prefixed paths. **Verified 2026-08-07:** `…/docs/contracts/INTERACTION-PREFILL-LINK.md` serves the real document, `…/_archive/…` returns 404. A public `builder/` would have defeated the private bucket in one step |
| **Storage, not a table** | A table means DDL on `app`, which is sealed — `prep_app_owner` is `NOLOGIN` and unsealing is a coordination event (CORE.md §0). Buckets and policies live in schema `storage`, applied by the service role, exactly like migration 019. **No row in `app` or `public` is written by any of this** |
| **Single import commit, not a subtree merge** | A subtree merge replays every past commit, so the 8 MB of `.jsx` would enter PREP's history permanently — precisely what "no jsx in the repo" rules out. Prose history is preserved verbatim as `_builder/CHANGELOG.md` |
| **One review writer: the site** | `site/faculty/artifacts.html` writes `review-notes.json` to Storage; `sync_artifacts.py pull-reviews` mirrors it into `_builder/courses/<id>/artifacts/REVIEW-NOTES.json`, which stays committed so approvals keep diffing. `serve_artifact_review.py` drops to read-only for artifacts. Two writers on one JSON is the drift both repositories' contracts warn about |
| **`project-bootstrap` and `check_slots.py` stay behind** | They install the agent-instruction scaffold into a *new* project. PREP is bootstrapped; they belong in the container's `.ai/` seed |

## What was rejected

**Gutting the kit's `contracts/` directory.** The plan called for deleting the kit's two contract
copies and pointing it at `docs/contracts/`, on the grounds that one repository should not hold two
copies of a frozen contract. Implementation showed the premise was wrong in a way that mattered:
those files are not merely referenced in prose. `tools/localize.py` localizes them, `tools/verify.py`
has a check dedicated to them (*"line endings preserved in contracts"* — one ships with CRLF on
purpose), `MANIFEST.sha256` hashes both, and `SETUP_NEW_PROJECT.md` and
`ADAPTING_TO_A_NEW_DISCIPLINE.md` describe handing the kit to another department. Removing them
would fork a portable, hash-locked payload for every future deployment in order to fix a
documentation problem.

**What was done instead:** the kit keeps its copies as the frozen snapshots they are, and the
duplication is made *mechanically visible* rather than invisible — both are registered in
`docs/DOC-SOURCES.json` against `docs/contracts/*`, so `check_doc_sources.py` flags them whenever
PREP's authoritative copy moves. That converts silent drift into an alarm, using the mechanism this
repository already has for exactly this. **The existing drift is recorded, not silently inherited:**

| Kit copy | Differs from `docs/contracts/` by | Which is right |
|---|---|---|
| `INTERACTION-DATA-CONTRACT.md` | 1 line — `mintWrittenSlug()` vs `writtenSlugFor()`, and a note about the 2026-07-28 suffix change | PREP's |
| `INTERACTION-PREFILL-LINK.md` | 35 lines — PREP's describes the destination chooser (course/term, new-vs-existing) that landed 2026-07-28; the kit's describes the pre-chooser behaviour | PREP's |

Re-syncing them is a `schema: 2` event under `PROVENANCE.md` and affects every deployed artifact
everywhere, so it is deliberately **not** part of this import.

## What this does not do

- **Does not register any lesson row.** All 46 artifacts remain unregistered; the new page builds
  the prefill link and a director still clicks Save.
- **Does not rebuild or republish any artifact**, including the twelve carrying the known
  pacing-string disagreement. Each fix mints a new 8-hex slug and registers as a *new* lesson row.
- **Does not unseal `prep_app_owner`** or add any table, column, policy or function to `app`.
- **Does not resolve the two PHYS 215 lessons with no grounding source** (16 RC Circuits,
  40 Polarization), or the 56 PHYS 310 corpus sections still `STATUS: PENDING`.

## Reversal

Four independent levers, and the answer key that proves they worked:

| | Undoes | Command |
|---|---|---|
| L1 | Storage objects | `sync_artifacts.py pull-reviews --commit`, then `purge --commit` — deletes only paths in the upload manifest, never a prefix sweep |
| L2 | the bucket | `supabase/migrations/023_artifact_sources_storage_ROLLBACK.sql`, service role, SQL Editor |
| L3 | the commits | `git revert` — never `reset --hard`, and never a force-push (CORE.md §0) |
| L4 | local deletions | restore from `_snapshots/builder-import-2026-08-07/sources/` |

```
python scripts/artifacts/restore_point.py verify --full-reversal
```
compares live git, Storage and file state against what was recorded before any of this ran.
