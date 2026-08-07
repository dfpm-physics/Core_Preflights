# Adapting to a New Discipline

Most of this system is not about physics. The Socratic pacing, the effort-over-correctness
grading, the anti-hallucination architecture, the report schema, and the submission pipeline are
discipline-neutral and port unchanged. Four things do not.

---

## 1. Verification of worked answers

**Physics version:** two-pass arithmetic verification on every extension problem, shown
explicitly in the worked solution. Wrong answers propagate to every student, so the check is
non-negotiable.

**What ports directly:** anything with a checkable numeric answer — chemistry, engineering,
economics, statistics, quantitative biology. Keep the two-pass rule verbatim.

**What needs a substitute:** disciplines where the "answer" is an argument. Replace arithmetic
verification with a **source-and-claim pass**: every factual assertion in a model answer must be
traceable to the grounding text, and every interpretive claim must be marked as interpretation
rather than fact. Show that pass in the preview the same way the arithmetic pass is shown. The
principle survives the translation — *nothing goes to a thousand students unverified* — even
though the mechanics change.

**Law, medicine, and anything with liability:** add a third pass for currency. A confidently
stated rule that was superseded is worse than an arithmetic slip, and the grounding text may be
older than the student thinks.

---

## 2. The misconception catalogue

`03_LESSON_CONFIG_SPEC.md` asks for 4–6 common misconceptions per lesson. In physics these are
famously stable and well-documented (force implies motion, current is used up, heat is a
substance) — decades of physics-education research make them easy to name.

Outside physics you often have no such literature. Two workable substitutes:

- **Mine your own grading.** The errors you correct every semester on the same assignment *are*
  the catalogue. Two semesters of graded work beats any published list.
- **Ask for prior-conception clashes, not errors.** In history or economics the productive frame
  is "what does a reasonable person assume before instruction that the reading complicates" —
  which is what a misconception is anyway.

Do not leave the field thin or generic. It is what steers the tutor toward the probes that
actually diagnose, and a vague catalogue produces a vague session.

---

## 3. Probe topics in a non-cumulative subject

Physics is strongly cumulative, so `prerequisites` and `lateral_connections` carry real weight —
a student who cannot superpose vectors will fail at fields regardless of the day's reading.

In a subject where lessons are more parallel than stacked, `prerequisites` shrinks toward
vocabulary and method, and `lateral_connections` grows in value — the connection across cases,
periods, or texts is often the whole intellectual payload. Rebalance deliberately rather than
leaving `prerequisites` padded with things that are not actually prerequisite.

The 3–5 probe topic range and the 4 default hold everywhere. They come from the time budget, not
from the subject.

---

## 4. Math rendering and the grounding extraction

**KaTeX** stays in the artifact regardless. It costs nothing when unused and its absence is
painful to retrofit.

**Extraction is where a port most often goes wrong.** The skill rasterizes PDF pages at build
time because image-rendered equations and figures are otherwise silently lost from a text
extract. The same failure mode has different faces by discipline:

| Discipline | What a text-only extract silently loses |
|---|---|
| Physics, engineering | Equations, vector diagrams, free-body figures |
| Chemistry | Structures, mechanism arrows, phase diagrams |
| Biology | Pathway figures, labeled anatomy, micrographs |
| Economics | Curve diagrams — the entire argument of a graph |
| History, literature | Maps, tables, image plates, and *the primary-source excerpt itself* |

**Rasterize and read the pages in every discipline.** Then run the completeness self-check
against the probe topics before building. A thin extract leaves holes the tutor fills by
hallucinating, and the student cannot tell the difference.

---

## What must not be relaxed on a port

Say these out loud during the first build in a new discipline, because they are exactly what a
well-meaning adaptation erodes:

- **Effort is the grade.** A student who engages fully and understands nothing gets full marks.
  Every discipline's instinct is to re-introduce correctness. Don't.
- **The reading-reflection gate.** A student who does not meaningfully answer the opening
  reflection is capped, no matter how strong the rest was.
- **No citations to the learner.** The grounding text is not their book. This holds in every
  subject and is the rule most often broken by accident.
- **The tutor never confirms wrong content to be agreeable.** Calibrated confidence, reasoned
  from first principles, in every discipline.
- **One question at a time.** Stacked questions wreck the pacing model everywhere.
