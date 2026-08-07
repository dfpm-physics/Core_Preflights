# Provenance and Re-syncing

**Kit version:** 1.0
**Snapshot taken:** 2026-07-30
**Extracted from:** the Physics 215 / Fall 2026 iPREP project at USAFA — `preflight-factory-v2`
(v2.0 rev 3) plus the project's contract and source files.

---

## What is a snapshot and what is authored

**Verbatim, hash-locked** (`MANIFEST.sha256` — seven files):

| File | Source |
|---|---|
| `skill/preflight-factory-v2/SKILL.md` | the installed `preflight-factory-v2` skill |
| `contracts/INTERACTION-DATA-CONTRACT.md` | project, v1 LOCKED |
| `contracts/INTERACTION-PREFILL-LINK.md` | project, contract |
| `sources/02_TUTOR_SYSTEM_PROMPT.md` | project |
| `sources/03_LESSON_CONFIG_SPEC.md` | project |
| `sources/04_OUTPUT_REPORT_SPEC.md` | project |
| `sources/THEME_REFERENCE.md` | project |

**Authored for the kit** — everything else: the profile layer, the localizer, the verifier, the
setup and instruction documents, and the four docs under `docs/`.

**Deliberately excluded:** `00_README.md` and `DESIGN.md` (project- and portal-specific, replaced
by this kit's README and by whatever design system the new deployment uses), and `01` / `05` /
`06`, which are the retired `.md + .pdf` bundle workflow. That track cannot emit the `d` payload,
so it cannot produce a gradable submission — it is not carried forward, and a port should not
revive it.

---

## Re-syncing after the live project changes

The kit is a snapshot, not a live mirror. When the source project changes, decide which kind of
change it is:

**A skill or source revision** (new pacing behavior, a sharpened prompt, a theme change):

```bash
cp <project>/02_TUTOR_SYSTEM_PROMPT.md sources/
# …and any others that moved
sha256sum skill/preflight-factory-v2/SKILL.md contracts/*.md sources/*.md   # regenerate the tail
#   of MANIFEST.sha256, keeping the comment header
python3 tools/verify.py
```

Then check the localizer's `BASELINE` dictionary still describes reality. If a source file starts
using a new institution- or course-specific string, add it to `BASELINE` and to `build_rules`, or
the next port will silently ship a USAFA string inside a chemistry artifact.

**A contract revision** is a different animal. The contracts are frozen at `schema: 1`, and a
change to the endpoint, hash keys, codec, or any field meaning is a `schema: 2` event affecting
every deployed artifact everywhere. Re-syncing the file is the smallest part of that; read §8 of
the data contract first.

---

## What a downstream deployment owes upstream

If a port discovers something the pilot got wrong — an ambiguity in the report spec, a failure
mode in the receiver, a probe-topic pattern that consistently misfires — that belongs back in the
source project, not just in the fork. The specs accumulate rationale precisely so the same
mistake isn't paid for twice.
