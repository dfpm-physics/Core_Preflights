# PHYS 310 grounds in Murray, reconstructed from model knowledge

**Decided:** 2026-07-31 · **By:** recker · **Status:** active · **Scope:** PHYS 310 only

Supersedes the grounding half of `courses/phys-310/COURSE_PROFILE.md` → "Why a public-domain source
and not the adopted text" (2026-07-30). That section is amended in place rather than deleted,
because its copyright reasoning is still correct — it is the conclusion that changed.

## The decision

**PHYS 310 preflights are grounded in Murray & Holbert, *Nuclear Energy* (8th ed.) — the text
cadets actually read — and the grounding extraction is reconstructed from the model's own knowledge
of that book rather than from an attached PDF.**

recker has no PDF of Murray and will not obtain one. The alternative to reconstruction is not "a
better source"; it is "no Murray grounding at all."

**The reconstruction is gated by human review.** Before any artifact is built, the agent presents
the proposed `TEXTBOOK_REFERENCE` block to recker, who checks it against a physical copy. Only an
approved block is built into an artifact. **This review is mandatory for PHYS 310 and is not the
normal workflow** — every other course attaches a PDF and skips it.

**Confidence must be marked, because the risk is not uniform.** The agent splits the block:

| tier | what it covers | how recker reviews it |
|---|---|---|
| **High** | physics content — constants, formulas, conceptual relationships | skim; the agent knows these independently of Murray and cross-checks against DOE-HDBK-1019 |
| **Low** | section titles, page numbers, worked-example specifics, notation choices, edition numbering | **read against the book** — this is where a model confabulates |

A flat "check this for accuracy" wastes the reviewer's attention on the half that is reliable and
spends none of it where the errors are. The split is the point of the review, not decoration on it.

### The corpus, not per-lesson reconstruction

**The reconstructed grounding lives in one committed document —
`courses/phys-310/texts/MURRAY-GROUNDING.md` — covering every Murray section named in the schedule's
`Reading` column. Artifact builds excerpt from it. They do not reconstruct.**

This was recker's call on 2026-07-31, and it is the better shape for three reasons, one of which is
the whole reason the per-lesson alternative was dangerous:

- **It converts 20 review gates into a handful.** The per-lesson loop's stated failure mode was
  review fatigue — 20 blocks that start looking routine, and the one confabulated section number that
  gets waved through in November. Front-loading the review by chapter removes the recurring gate
  rather than asking recker to stay vigilant across a semester. **This is the reason that matters;
  the other two are conveniences.**
- **Notation stays consistent across the course.** Reconstructed lesson-by-lesson, lesson 14's block
  can quietly use different symbols or a different constant precision than lesson 3's, and no
  artifact is wrong on its own while the set is incoherent.
- **It is auditable in one place.** "What grounded lesson 7?" is answered by one file with a review
  date, not by opening a published artifact and reading its inlined block.

**Scope it to the assigned sections only.** The corpus covers what the schedule assigns — **59
sections across 14 chapters** — and not the book's ~150. That bound is load-bearing for the copyright
position below: a reconstruction of the assigned reading is a grounding source, and a reconstruction
of the whole text is a substitute for it.

**Attest per section, not per file.** All-or-nothing review re-creates the fatigue problem inside a
single sitting, where attention on section 50 is worse than on section 3. Per-section status means
**a pending section blocks only the lessons that cite it**, so the corpus never has to be finished
for work to proceed — and recker can review at whatever pace the semester allows.

**Review chapters 2–7 first.** They ground the most lessons, reconstruct most reliably, and — this is
the point — **their review is the experiment that tests this whole decision.** If the strong half
comes back with substantive physics errors, the reversal condition below has fired and the back half
should not be attempted.

## Why this and not the alternatives

**It closes a gap DOE left open.** Lesson 2's schedule row already carries
`gap: amu↔C-12, NIST supplement` — DOE-HDBK-1019 genuinely does not cover the atomic mass unit and
its carbon-12 reference, and Murray §2.6 does. The DOE index warns this will recur: the handbook is
reactor-operator training, strong on reactor physics and neutron economy, thin elsewhere. Grounding
in the adopted text makes the gap list shrink instead of grow.

**It aligns the tutor with what the cadet has in front of them.** Under DOE grounding the tutor was
correct about physics the cadet could not go look up in the same words. Murray grounding means the
tutor's framing, notation, and emphasis match the cadet's reading, which is what a preflight is for.

**Rejected — keep DOE as the sole grounding.** Correct on copyright and materially worse on
coverage. It also spends recker's time: every lesson requires a Murray→DOE section lookup, and the
lookup fails outright wherever DOE is thin, at which point that lesson needs a third source found by
hand. The `gap:` note on lesson 2 is that cost showing up on the very first build.

**Rejected — buy or scan a PDF of Murray.** This is the option that makes the whole question go
away, and recker has ruled it out. Recorded so nobody re-proposes it as though it were unconsidered.

**Rejected — ground in nothing and let the tutor improvise.** This is what the frozen tutor prompt
exists to prevent, and it is worse than either grounded option. A tutor reconstructing physics
live, per cadet, with no reviewed reference is unbounded; a reference reconstructed once and checked
by a human is bounded and auditable.

## What this costs

**A frozen contract now says something we are deliberately not doing.**
`preflight-kit/sources/02_TUTOR_SYSTEM_PROMPT.md:75` instructs: *"do not paraphrase or reconstruct
them from memory."* The file is hash-locked; editing it forks the kit for every course
(`CORE.md` §6), so it stays as written.

**Why the conflict is tolerable, stated precisely so it can be argued with:** that instruction
binds the **tutor at runtime**, not the build. The tutor still receives an inlined
`TEXTBOOK_REFERENCE` and still may not improvise beyond it. What moved is where that block comes
from — reconstructed at build time under human review, instead of extracted from an attached PDF.
The runtime guarantee the sentence protects is intact. **If the human review is skipped, this
argument collapses and the artifact genuinely violates the contract**, which is why the review is
written into the decision above rather than left as a habit.

**A second frozen sentence becomes false.** `02_TUTOR_SYSTEM_PROMPT.md:17` tells the tutor its
reference is *"not the cadet's assigned class text — they read their own course textbook on the same
topic."* Under this decision that is wrong for PHYS 310. It is assessed as behaviorally harmless:
the instruction it actually drives — never cite section or page numbers to the cadet — remains
correct and remains wanted. But it is a false premise shipped to the model, and it re-opens the
`CORE.md` §8 row that had recorded PHYS 310 as no longer tripping this.

**The copyright question is managed rather than removed.** That is a real regression from the
2026-07-30 position and is stated plainly rather than argued away. What bounds it: the grounding
block is paraphrase, formulas, and concept structure — facts and relationships, not protected
expression — and no extended verbatim prose from Murray is reproduced. It is also never surfaced to
a cadet (`CORE.md` §6), so it does not function as a substitute for the book they are required to
buy. This is an academic-use judgment recker is entitled to make; it is not a claim that the
copyright question is absent.

**Every lesson now costs a review cycle.** Build stops until recker has read the block. On a
20-preflight semester that is 20 gates, and the failure mode is skipping them once the blocks start
looking routine — which is exactly when a confabulated section number gets through.

## What would reverse this

A PDF of Murray arriving — at which point the reconstruction stops and the review gate can go with
it, since Step 3 extracts from the attachment as designed everywhere else.

A review that catches a substantive physics error rather than a bibliographic one. Wrong page
numbers are the expected failure and are cheap. **A wrong constant, formula, or relationship in the
High-confidence tier means the model's knowledge of this text is not sound enough to ground a tutor,
and the decision should be reversed rather than patched.**

**This decision is scoped to PHYS 310 and does not generalize.** Any other course grounds in an
attached source. A second course wanting this exception is a new decision, not an extension of this
one — the argument above rests on recker owning the book, teaching from it, and reviewing every
block, and none of those transfer automatically.
