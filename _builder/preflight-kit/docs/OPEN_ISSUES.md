# Open Issues — inherited by every port

These are unresolved as of the Physics 215 Fall 2026 build. They travel with the kit because a
new deployment inherits all of them, and discovering them in week three is worse than reading
them now. Status is honest, not aspirational.

---

## 1. `d`-key emission — documented, not built

**State:** artifacts emit `r` (the Markdown report) reliably. The structured `d` payload is
specified end to end in the contract and in the skill's Rev 3, and the artifact wiring to emit
it is written — but effort scores in the pilot builds default to null, which the pipeline treats
as 0 until an instructor finalizes manually.

**Consequence for a port:** budget for manual finalization in the first semester, or verify `d`
emission end to end on a throwaway lesson before the first real one. Test by submitting a
session yourself and confirming a grade was written from `d.effort`.

**Why it matters more than it sounds:** an `r`-only submission reaches the database and earns
nothing — no grade, no cohort rollup, no diagnostics. It looks successful from the student's
side. This is the failure mode most likely to bite a new deployment.

---

## 2. Stale URLs in the skill's companion files

`preflight-factory-v2/SKILL.md` and `THEME_REFERENCE.md` still reference retired endpoints
(`artifact-submit.html`, `interactions-admin.html`) in places. Artifacts are built against the
locked contract, so the *output* is correct — but the skill text disagrees with itself in spots
and a careful reader will notice.

**Canonical values** (contract wins, always):
- submit: `…/site/student/interaction-submit.html`
- prefill: `…/site/faculty/lessons.html`

The retired URLs 404 — they were a deliberate clean break, not aliased. An artifact pointing at
one loses the student's report silently.

**For a port:** `tools/localize.py` rewrites the endpoints from your profile, which incidentally
cleans most of this up. Re-read the output before shipping anyway.

---

## 3. Pacing-model inconsistency between two specs

The interaction spec describes a global ~10-minute cap. The authoring spec describes independent
per-topic budgets with no global hard stop. **These disagree**, and v2.0 of the skill settled it
in favor of per-topic budgets — no global guillotine, no "we're behind" pressure carried between
topics.

Build to the per-topic model. The reconciliation edit to the older spec has not been made.

---

## 4. Aggregation engine — designed, unbuilt

The instructor-facing half of the JiTT loop. Intended shape: hybrid deterministic Python for
exact statistics and verbatim quotes, plus an LLM pass for clustering and paraphrasing common
question themes, processing JSONL batches of roughly a thousand reports per lesson.

**Open decisions:** output format (markdown only vs. an interactive viewer artifact),
quote-selection strategy, JSONL file structure.

**For a port:** without this, you have collection but not synthesis. A reader can still open
individual reports; nobody can read a thousand of them before class, which was the entire point.
Plan for it or plan to sample.

---

## 5. Cross-model behavior parity — unexplored

The artifact runs on Claude via the Anthropic API. Whether an equivalent GPT-track artifact
produces comparable pedagogy and comparable reports has not been tested. Relevant if your
institution mandates a different provider.

---

## 6. Slug collisions across courses sharing a backend

Slugs are deterministic and namespaced by lesson number and topic — sufficient within one
course, not guaranteed across two. `lesson-01-introduction` in two courses on one receiver is a
real collision. See `docs/BACKEND_OPTIONS.md` Option A.

---

## 7. A published artifact is frozen

Not a bug, but the constraint most likely to surprise. The slug, objective keys, submit URL, and
model candidate list are baked in at publish time. Changing any of them is a rebuild and a
re-publish, not an edit.

This is why the kit unpins the model — a dated snapshot that gets retired strands a published
artifact with no graceful path. Keep at least two live model families in `MODEL_CANDIDATES`. If
every candidate 404s, the artifact dead-ends politely and the only fix is re-publishing.
