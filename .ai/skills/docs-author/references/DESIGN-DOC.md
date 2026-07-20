# Design docs — template, content bar, lifecycle

Companion to [`../SKILL.md`](../SKILL.md). Read the gate in SKILL.md Step 1 first — most changes do
not warrant a design doc, and writing one anyway is a real cost, not harmless thoroughness.

## Where it goes

`docs/README.md` defines the taxonomy; respect it rather than inventing a fifth folder.

| Folder | Holds | Example |
|---|---|---|
| `docs/decisions/` | A design agreement or implementation spec — "why this, not that" | `INTERACTION-AGGREGATION.md` |
| `docs/contracts/` | A frozen or externally consumed interface | `INTERACTION-DATA-CONTRACT.md` |
| `docs/architecture/` | How the platform or data model fits together | `LESSON-UNIFICATION.md` |
| `docs/operations/` | How a director or admin operates the system | `SYSTEM_GUIDE.md` |

Names are `SCREAMING-KEBAB.md`, not numbered. Keep it that way — the existing cross-links are by
filename, and renumbering would break them.

**One sentence per line.** Wrap at ~100 characters, break at sentence boundaries. Go's proposal repo
uses this so review comments land on the right line and diffs stay readable; it costs nothing and
makes a doc reviewable in a PR.

---

## Template

```markdown
# <Title> — <what it decides, in six words>

**Status:** proposed | accepted | implemented | superseded by <DOC.md> | abandoned

*Authored YYYY-MM-DD by <Human> (via <Agent>). Companion to [`X.md`](../path/X.md).
See [`CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** One paragraph: who should read it, and what question it settles.
> If it changes an existing contract or supersedes another doc, say so here.

---

## 1. Problem

What is wrong today, stated with no solution language. A reader who was in none of the
discussions must be able to follow this section.

## 2. Goals and non-goals

**Goals** — testable outcomes, not aspirations. How will we know this worked?

**Non-goals** — things that could reasonably have been goals but are deliberately out of scope.
Not negated requirements: "the system shouldn't crash" is not a non-goal.

## 3. Constraints

What is fixed and not up for debate here — the frozen artifact↔site contract, `schema: 1`,
RLS, no build step, the free-tier Supabase pause, live student data. Link, don't restate.

## 4. Options considered

At least two. For each: what it is, and **why it was rejected**. A rejected option with no
stated reason is decoration.

## 5. Decision

Named in one sentence, in active voice: "We will …". State at least one **downside** of the
chosen option — a comparison whose winner has no costs was written to justify a decision
already made.

## 6. Consequences

What is true after this lands — good and bad. Migrations required, docs invalidated, work
newly blocked or unblocked.

## 7. Confirmation

**How would we know this was wrong?** Name the signal, the threshold, and what happens then.
A check to run, a metric to watch, a condition that triggers rollback.

## 8. Open questions

What is genuinely undecided. Empty because you dodged it is worse than empty because you're done.
```

Sections 1–7 are required. Drop 3 and 8 when they would be empty; keep the numbering of the rest.

**Status vocabulary — use exactly these five.** `proposed` · `accepted` · `implemented` ·
`superseded by <DOC.md>` · `abandoned`. The existing docs already use `proposed`, `LOCKED`
(contracts), and `NOT YET BUILT`; contracts may keep `LOCKED`, everything else uses this list.

---

## Content bar

A draft fails if any of these is missing:

- [ ] Problem stated before any solution, with no solution language in the problem section
- [ ] At least one serious alternative named **with its reason for rejection**
- [ ] The chosen option has at least one stated downside
- [ ] Non-goals are plausible goals, not negated requirements
- [ ] The decision is nameable in one sentence and appears in the first screenful
- [ ] At least one quantified claim — a count, a size, a duration — rather than "significant"
- [ ] Comprehensible to someone who was in none of the discussions
- [ ] A falsification condition: signal, threshold, consequence
- [ ] Status line, authorship line, and links to companion docs
- [ ] Length: 1–3 pages for an incremental change, up to ~10 for a large one

**On length.** Past that, you have coupled several decisions into one document — split it rather
than trimming prose. Google's cap is 10–20 pages for a large project *"short enough to actually be
read by busy people"*; an ADR is one page because *"large documents are never kept up to date"*
(Nygard). This repo's existing design docs run 200–550 lines, which is the right neighborhood.

**Banned in a design doc:** *a number of, several, various, relatively, significant, substantial,
usually, probably, clearly, most, many, up to, vast.* Give the figure or delete the claim.

**Rarely include code.** Google: design docs *"should rarely contain code, or pseudo-code except in
situations where novel algorithms are described"*, and copy-pasted interface or schema definitions
*"quickly get out of date."* Point at the migration or the module; don't restate it.

**RFC 2119 keywords (MUST / SHOULD / MAY) carry normative force only in ALL CAPS**
([RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.txt)) and must be used *sparingly* — only where
required for interoperation or to prevent harm ([RFC 2119 §6](https://www.rfc-editor.org/rfc/rfc2119.txt)).
In this repo that means `docs/contracts/` — the artifact↔site wire format qualifies. A design doc
or a help doc does not; use plain English there.

---

## Lifecycle

**A design doc is a point-in-time record, not a living specification.** This is the rule that keeps
`docs/` trustworthy, and it is the opposite of the rule for help docs.

- **Before the work ships:** update the doc freely as the design changes.
- **After it ships:** do not rewrite it to match what was built. Add an amendment section with a
  date, or write a successor. Google's own docs drift into *"the US constitution with a bunch of
  amendments rather than one consistent piece of documentation"* — and that is accepted, because the
  doc's value is the **reasoning**, not the current-state truth. Current-state truth lives in
  `PROJECT.md`, the contracts, and the code.
- **Superseding:** set the old doc's status to `superseded by <NEW.md>` and have the new doc name
  what it supersedes. **Link both directions** — one-directional chains rot silently. Do not delete
  the old doc; *"it's still relevant to know that it was the decision, but is no longer the decision"*
  (Nygard).
- **Never leave a stale doc ambiguous.** Either mark it superseded with a pointer, or delete it.
- **Record it in `CHANGELOG.md`** when the doc lands and again when its status changes.

> Note on provenance: the "never edit an accepted decision record" norm is a **community
> convention** layered on Nygard's original post, not something that post states. It is adopted here
> deliberately, because with several agents writing to one repo an edited decision is
> indistinguishable from a decision that was never made.

## Review

- **Do not land a design doc nobody has read.** A doc with zero comments has not been reviewed.
- **Comment window: 3–5 business days**, with a stated deadline. Late comments are lower priority.
- **Reviewers answer "yes" or "not yet, if…" — never a bare "no."** Stating the condition once lets
  the author proceed without a second round-trip.
- **Name one accountable decision-maker.** After the call, disagree and commit.
- The point of review is not to catch every flaw. It is to catch them *while changing course is
  still cheap*.
