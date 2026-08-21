# The Claude artifact has three failure paths that never move off a failing model, and no request timeout at all

**Status:** Open — awaiting verification

*Found 2026-08-21 by Matthew Recker (via Claude) while fixing the same defect class in the Gemini
backup builds.*

---

## Summary

All 51 published Claude artifacts, and the kit that builds new ones, handle three request failures
by giving up **without stepping down the model ladder**, and issue every request with **no deadline**.

The identical defect shape was confirmed to hang a real instructor on the Gemini side at the report
stage — a loop that produced no summary while the account sat far below every quota — and was fixed
there on 2026-08-21. Nothing has fixed it on the Claude side, and the fix does not reach there by
any existing path: `to_gemini.py` transforms the Gemini build only, and the kit predates the fix.

**What is verified is the code.** Whether these paths fire often against Anthropic's API is *not*
established — see "How you would know I am wrong".

---

## Evidence — verified

Read from the gitignored source cache. The cache is populated by
`python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit`; these excerpts
are from `_builder/courses/phys-215/artifacts/lesson_02_preflight_electric_charge_coulombic_force.jsx`,
and the pattern is present in all 51.

### 1. A 5xx never steps the model — `rawCall`

```js
if (res.status === 529 || res.status >= 500) {  // capacity / server busy → retry
  if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
  throw { kind: "capacity", status: res.status };
}
```

Three retries against the **same** model, then a typed throw the cadet sees as a Retry button.
Pressing it starts over on the model that just failed three times. Compare the 429 branch
immediately above it, which does step — added 2026-08-20, when only 429 was understood to need it.

### 2. An empty response never steps the model — `callTutor`

```js
const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
if (!text) throw { kind: "request", status: 0 };
```

**This one is above `rawCall`**, so it bypasses the ladder machinery entirely — which is exactly why
it survived a day of debugging on the Gemini side after the other paths were fixed. An HTTP 200
carrying no text is reported to the cadet as a generic request failure.

It also does not distinguish a **safety refusal** (a real answer — do not walk, explain it) from an
**empty candidate** (a broken response — walk). Anthropic's `stop_reason` is the field that
separates them.

### 3. There is no request deadline anywhere

```
$ grep -c AbortController _builder/courses/phys-215/artifacts/lesson_02_*.jsx
0
```

Zero across all 51. A request that never returns never returns; the cadet watches a spinner with
nothing behind it. The report is the largest generation of the session and therefore the most
exposed.

### 4. The kit that builds new artifacts carries none of the 2026-08-21 fixes

```
$ for m in stampSubmitted finish-bar OPENING_WELCOME LZ_ATTEMPTS spentModels AbortError clearSession 8192 scriptedDelay 2026-08-21; do
    printf '%-18s %s\n' "$m" "$(grep -c "$m" _builder/preflight-kit/skill/preflight-factory-v2/SKILL.md)"; done
```

Every count is `0`. The only date the kit skill names is `2026-08-20`, and its hash matches
`MANIFEST.sha256`, so this is the intended current state of the kit rather than a local edit.

**So this defect is not static — it is being reproduced.** Every artifact built from today onward
is born with all three paths.

---

## Evidence — inferred, not verified

**That these paths fire in practice against Anthropic's API.** The Gemini evidence is specific and
is evidence about *Google's* infrastructure:

- an instructor's usage dashboard showed `gemini-3.7-flash` returning **HTTP 200 with real input
  tokens and zero output tokens** — the empty-candidate path, path 2 above;
- and a **503 on one model while another served the same session normally**, i.e. a 5xx that was
  per-model rather than per-project, which is what makes path 1 a live loop rather than a fair
  give-up.

Neither observation transfers to Anthropic's API by argument. The Claude ladder is also only two
rungs (`claude-sonnet-5`, `claude-haiku-4-5`) against Gemini's three pools, so there is both less
to walk and less to get wrong.

**No cadet or instructor has reported a Claude-side report hang.** Absence of reports is weak
evidence either way here: the failure looks like "the AI is being slow", which is the thing free-tier
Claude was *already* being blamed for, and it is the reason cadets were moved onto Gemini in the
first place.

---

## Why it is worth fixing anyway

The guard costs nothing when it never fires, and the failure it prevents is a cadet losing a
completed session. Path 3 in particular is unbounded: paths 1 and 2 end in a wrong message, a
missing deadline ends in nothing at all.

The ordering that follows from that: **3, then 1, then 2.**

---

## How to verify independently

1. Pull the sources: `python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit`
2. Confirm the three paths across all courses and both dialects:
   ```
   grep -c AbortController _builder/courses/*/artifacts/*.jsx | grep -v ':0$'      # expect: nothing
   grep -A3 'status === 529' _builder/courses/phys-215/artifacts/lesson_02_*.jsx   # expect: no stepModel
   grep -n 'if (!text) throw' _builder/courses/*/artifacts/*.jsx                   # expect: 51 hits
   ```
   **Read and write bytes if you touch these files.** A Python text-mode read applies universal
   newlines and has already turned a 12-string substitution into 6,327 insertions and 6,327
   deletions here, with the real changes invisible inside it (PROJECT.md, sharp edges).
3. Read the fixed shape on the Gemini side for comparison — `scripts/artifacts/to_gemini.py`, the
   three `spentModels[activeModelRef.current] = true` sites — and the reasoning in
   [`../operations/TUTOR-BEHAVIOR-PARITY.md`](../operations/TUTOR-BEHAVIOR-PARITY.md) §3 and §5.

---

## How you would know I am wrong

- **Anthropic's API does not return HTTP 200 with an empty content array.** Then path 2 is
  unreachable and only paths 1 and 3 remain. Establish this from Anthropic's documentation or from
  a real failure, not by inference from Google's behaviour.
- **A 5xx from the Messages API is never per-model.** Then path 1's retry-then-give-up is the
  correct response and only the missing deadline is a defect.
- **claude.ai imposes its own request deadline on an artifact's `fetch`.** Then path 3 is already
  handled by the host and adding one changes only the error message. This is the claim most likely
  to be true and least likely to be documented — check it before building anything.

Any one of these narrows the finding rather than closing it.

---

## What fixing it costs

Not small, and the cost is the reason this is a finding rather than a change:

- **The kit** (`_builder/preflight-kit/skill/preflight-factory-v2/SKILL.md`) is hash-locked. A
  change means editing it and re-hashing `MANIFEST.sha256`, then re-verifying with
  `python _builder/preflight-kit/tools/verify.py` **in a fresh clone** — `core.autocrlf` has
  corrupted that payload twice, and the working tree looked correct through both.
- **The 51 published sources** need a `patch_artifacts.py` step, and then a **human republishing
  each artifact by hand on claude.ai** and updating each lesson's `activities.artifact_url`.
  claude.ai serves what was published; there is no in-place edit.
- **The slug must not change.** `activities.slug` is globally `UNIQUE` and every student report
  hangs off that row. Contract §3.2's "never reuse a slug" governs a **new offering**, not a patch
  into the same one — republishing a fix keeps the slug, and `patch_artifacts.py` asserts
  byte-equality of the slug line before it writes.
- **After changing any shared anchor, run `to_gemini.py` over all three dialects before
  committing.** The porter matches the Claude source by exact byte anchors and will refuse — but
  the refusal surfaces days later, in the next port, in a file the patch author never opened.

---

## Related

- [`../operations/TUTOR-BEHAVIOR-PARITY.md`](../operations/TUTOR-BEHAVIOR-PARITY.md) — the full
  three-surface table this finding is §3 of, and the rest of the carry-forward backlog.
- `CHANGELOG.md`, 2026-08-21 (seventh) — the Gemini-side fix, and two further defects that are open
  on **all three** surfaces: a report wrapped in code fences blanks itself, and `isReportMsg` is a
  bare substring test a tutor can latch by merely mentioning the heading.
