# Findings — defects handed off for verification and repair

A **finding** is one defect, written down so that *somebody who was not there* can verify it
independently and then fix it. It is a work order with a lifecycle, not a record.

This directory exists because a defect discovered mid-run has nowhere good to land. The
`CHANGELOG.md` is for what *changed*; `ROADMAP.md` is for what we *intend*; `docs/decisions/` is for
what we *chose* and why. None of them is the right home for "here is something broken, here is the
evidence, here is how to prove it for yourself, go fix it" — especially when the fixer is a
different operator or a different AI, arriving with no context.

---

## When to write one

All four must hold. Otherwise it belongs somewhere cheaper.

1. **A real defect**, observed — not a suspicion, not a code smell.
2. **The fixer is not the finder.** If you are about to fix it yourself in the same session, just
   fix it and log the change. A finding's whole purpose is the handoff.
3. **Verification is non-trivial.** If "look at line 40" settles it, put that in the ticket or the
   commit message.
4. **It survives the session.** The evidence would otherwise be lost when a transcript is discarded.

Where else things go:

| The reader's question | Goes to |
|---|---|
| "Here is a defect — prove it and fix it" | **`docs/findings/`** ← this directory |
| "What state was the system in on date X, and what was wrong?" | `docs/audits/` — a review, not a work order |
| "What are we planning to do?" | `docs/ROADMAP.md` |
| "Why did we build it this way, and what did we reject?" | `docs/decisions/` |
| "What changed, when, and who did it?" | `CHANGELOG.md` — always, for every shipped change |

The nearest neighbour is `docs/audits/`, and the line is **who acts next**. An audit describes a
system to a reader. A finding assigns work to a successor and is closed when that work lands.

---

## The rules

**No student PII. None.** Everything under `docs/` is served publicly by GitHub Pages (CORE.md §2 —
only `_`-prefixed paths are excluded, and that exclusion is one `.nojekyll` away from being
switched off). That means **no names, no student IDs, no enrollment or submission UUIDs, and no
combination of section plus circumstance that would re-identify a cadet in a small section** —
FERPA covers indirect identifiers, and PREP's sections are ~20 people.

This is not a limitation on findings; it is what makes them good. **Ship the query, not the rows.**
A finding that names three affected students is stale the moment a fourth appears, while a finding
that carries the detection query stays true and lets its reader confirm the count for themselves.
When specific records genuinely must be handed over, pass them out of band and say so in the doc.

The same rule bars credentials, connection strings, and internal absolute paths.

**Separate what you verified from what you inferred.** A finding is read by someone deciding
whether to trust it. Mark every claim as one or the other, and say which command or file:line
produced it. An inference presented as a finding is how a wrong premise gets fixed into the repo.

**Say how you would know you were wrong.** State the condition that would falsify the diagnosis —
the same rule design docs carry (`docs-author` Rule 8), and for the same reason: it is the field
most often skipped and the one that saves the most time.

**Do not register findings in `docs/DOC-SOURCES.json`.** They are point-in-time and get *closed*,
not refreshed — the same reasoning that keeps `docs/decisions/`, `docs/contracts/` and
`docs/audits/` out of the index. A staleness flag on a closed work order is permanent noise.

---

## Convention

- **File name:** `YYYY-MM-DD-<kebab-slug>.md`, dated the day the defect was *found*.
- **Status line**, immediately under the H1, kept current — this is the one part of a finding that
  is edited after it lands:
  `**Status:** Open — awaiting verification` → `Verified — awaiting fix` → `Fixed in <commit>` →
  `Rejected — <why>`.
- **Authorship line**, italic: `*Found YYYY-MM-DD by <Human> (via <Agent>) during <what>.*`
- A closed finding **stays**. Do not delete it; the reasoning is the value, and a directory that
  loses its history teaches readers not to trust it.
