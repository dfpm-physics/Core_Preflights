# Design docs and decision records

**Read the gate in [`../SKILL.md`](../SKILL.md) Step 1 before you read any further here.**
Most changes do not warrant a design doc, and writing one anyway is a real cost — not harmless thoroughness.
A doc nobody needed still has to be reviewed, indexed, superseded, and read past by everyone who searches `docs/` for the doc they did need.
This reference tells you how to write one **once the gate says you should**; it does not tell you whether to write one.

---

## 1. Placement

| folder | holds | indexed in `DOC-SOURCES.json` |
| --- | --- | --- |
| `docs/decisions/` | why this, not that — the reasoning behind a choice, at the moment it was made | no |
| `docs/contracts/` | frozen or externally consumed interfaces that something outside this code depends on | no |
| `docs/architecture/` | how the pieces fit — components, boundaries, and the flow between them | yes |
| `docs/operations/` | operating the system from outside the app — runbooks, deploys, recovery | yes |

`decisions/` and `contracts/` are deliberately absent from the staleness index, because **both are point-in-time records that get superseded rather than refreshed** — an index that nags you to update them would be pushing you toward exactly the rewrite that Section 7 prohibits.

`docs/README.md` defines the taxonomy.
**Respect it rather than inventing a fifth folder** — a one-off folder is invisible to everyone who learned the four, so the doc inside it is written and then never found again.
If your doc genuinely fits none of the four, that is a signal to raise in review, not to resolve by creating `docs/misc/`.

### Naming

Name files in `SCREAMING-KEBAB.md` — `CACHE-INVALIDATION-STRATEGY.md`, `AUTH-TOKEN-ROTATION.md`.

**Do not number them.**
Numbering is the convention in much of the ADR world, and it is the wrong trade here: cross-links in this repo are by filename, so a renumber breaks every inbound link at once and the breakage is silent — a stale relative link renders as ordinary text until somebody clicks it.
A descriptive filename also survives being moved between folders, which a sequence number does not.

---

## 2. Formatting

**Write one sentence per line, wrapped at roughly 100 characters, broken only at sentence boundaries.**
Never reflow a paragraph into fixed-width lines mid-sentence.

The reason is mechanical.
Diffs are computed per line, so a one-word change to a reflowed paragraph rewrites every line after it and the review shows a wall of changed text with the actual edit buried in it.
With one sentence per line, that same edit is a one-line diff, and a reviewer's inline comment attaches to the sentence they are objecting to instead of to a fragment of three unrelated ones.
The Go project's design proposals are written this way ([github.com/golang/proposal](https://github.com/golang/proposal)); the practice is also called semantic linefeeds.

It costs nothing at authoring time and it is the difference between a doc that can be reviewed in a pull request and one that can only be re-read.

---

## 3. The template

Copy this skeleton verbatim and fill it in.

```markdown
# <Title> — <what it decides, in six words>

**Status:** proposed

*Authored YYYY-MM-DD by <Human> (via <Agent>). Companion to [X.md](../path/X.md). See [CHANGELOG.md](../../CHANGELOG.md).*

> **What this doc is for.** One paragraph, no more: who should read this, the single question it
> settles, and whether it supersedes an earlier doc. If a reader cannot tell from this blockquote
> whether the doc is relevant to them, they will read the whole thing to find out — write it so
> they can stop here.

## 1. Problem

What is wrong today, and what it costs.
State it with no solution language — no "we need a queue", no "the fix is caching".
A reader who was in none of the discussions must be able to follow this section unaided.

## 2. Goals and non-goals

Goals are testable outcomes, not aspirations: something an observer could check and say yes or no to.
Non-goals are things that could reasonably have been goals and are deliberately out of scope here.
A non-goal is not a negated requirement — "the system shouldn't crash" is not a non-goal, it is noise.

## 3. Constraints

What is fixed and not up for debate in this document: deadlines, platforms, contracts, prior decisions.
Link to the authority for each one; do not restate it, because a restated constraint drifts from its source.

## 4. Options considered

At least two, and the second must be one somebody could have defended.
For each: what it is, in a sentence or two, and why it was rejected.
A rejected option with no stated reason is decoration — it makes the doc look thorough without informing anyone.

## 5. Decision

One sentence, active voice, beginning "We will ...".
Then state at least one downside of the option you chose and what you are accepting by choosing it.
A comparison whose winner has no costs was written to justify a decision that had already been made.

## 6. Consequences

What is true after this lands — good and bad, and what other work it forces.

## 7. Confirmation

How would we know this was wrong?
Name the signal, the threshold, and what happens when the threshold is crossed.

## 8. Open questions

What is genuinely unresolved, and who owns resolving it.
Empty because you are done is fine; empty because you dodged the hard question is worse than a long list.
```

Sections 1–7 are required.
Drop 3 and 8 when they would be empty — an empty section reads as an oversight — but **keep the numbering of the rest** so that a review comment on "section 5" means the same thing in every doc in the repo.

---

## 4. Status vocabulary

Exactly five values. Do not invent a sixth.

| status | means |
| --- | --- |
| `proposed` | drafted, in the comment window, not agreed |
| `accepted` | agreed, work not yet done |
| `implemented` | agreed and shipped |
| `superseded by <DOC.md>` | a later doc governs; this one stays for the reasoning |
| `abandoned` | dropped without being implemented, and without a successor |

The value is a closed set because status is read by people scanning a folder, and every synonym you add ("draft", "in progress", "done") makes the scan ambiguous — a reader has to reconstruct your intent instead of reading it.
`abandoned` and `superseded by` are not the same thing: the first means nobody is doing this, the second means somebody is doing it differently, and collapsing them loses the pointer to what replaced it.

`docs/contracts/` may additionally use `LOCKED`, because **a frozen interface has a different lifecycle from a decision** — a locked contract is not superseded by argument, it is broken by a version bump.
A reader needs to see at a glance that changing it breaks a consumer.
Everything else uses the five.

---

## 5. The content bar

A draft fails if any item is missing.
Check it against your own draft before you ask anyone to read it — every unchecked box is a round-trip you are spending someone else's attention on.

- [ ] The problem is stated before any solution, and Section 1 contains no solution language.
- [ ] At least one serious alternative is named, with its reason for rejection.
- [ ] The chosen option has a stated downside.
- [ ] Non-goals are plausible goals ruled out of scope, not negated requirements.
- [ ] The decision is nameable in one sentence and appears within the first screenful.
- [ ] At least one claim is quantified — a figure, not "significant".
- [ ] Someone who was in none of the discussions can follow it start to finish.
- [ ] Section 7 gives a falsification condition with a signal, a threshold, and a consequence.
- [ ] Status line, authorship line, and links to companion docs are present and correct.
- [ ] Length is 1–3 pages for an incremental change, up to about 10 for a large one.

### On length

The cap is not a style preference.
Past it, **you have coupled more than one decision into a single document — split it rather than trimming prose.**
Trimming produces a doc that is still about two things and is now also missing its reasoning; splitting produces two docs that can each be accepted, superseded, or abandoned on their own schedule.

"Design Docs at Google" makes the same argument from the reader's side: a design doc has to be short enough that it actually gets read.
A document that has grown past roughly twenty pages is a sign that it is trying to solve too large a problem at once ([industrialempathy.com/posts/design-docs-at-google](https://industrialempathy.com/posts/design-docs-at-google/)).
Nygard's original ADR post pushes harder in the same direction, prescribing a record of one or two pages, on the grounds that large documents do not get kept up to date ([cognitect.com/blog/2011/11/15/documenting-architecture-decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
Both point at the same failure: length is not thoroughness, it is a bet that someone will read to the end.

### Banned words

Do not use these in a design doc:

> *a number of · several · various · relatively · significant · substantial · usually · probably · clearly · most · many · up to · vast*

**Give the figure or delete the claim.**
Each of these words converts an unmeasured impression into something that reads like a finding, and a reviewer cannot disagree with "significant latency" — there is nothing there to disagree with.
"Clearly" and "probably" are worse than vague: they ask the reader to accept a conclusion in place of the evidence for it.
If you do not have the number, write that you do not have it and say what would produce it.

### Rarely include code

A design doc should rarely contain code or pseudo-code, **except where you are describing a novel algorithm** and the algorithm is the decision.

Copy-pasted interface and schema definitions get out of date fast — the code changes, the doc does not, and the doc is now actively misleading to the next reader who trusts it.
Point at the module, the migration, or the contract file instead.
A path is always current; a paste is current once.

### RFC 2119 keywords

MUST, SHOULD, and MAY carry normative force **only in ALL CAPS** — RFC 8174 exists precisely to say that lowercase "must" in a specification is ordinary English and not a requirement ([rfc-editor.org/rfc/rfc8174](https://www.rfc-editor.org/rfc/rfc8174)).

Use them sparingly.
RFC 2119 itself limits these imperatives to cases where they are actually required for interoperation or to prevent behavior that could cause harm ([rfc-editor.org/rfc/rfc2119](https://www.rfc-editor.org/rfc/rfc2119)).
Scope them to `docs/contracts/`, where an implementer on the other side of the interface needs to know which clauses they can violate and which they cannot.
**A design doc uses plain English** — sprinkling MUST through a decision record inflates preferences into requirements, and the reader loses the ability to tell which clauses were ever binding.

---

## 6. The falsification condition

Section 7 is the section most likely to be filled with something that sounds like an answer.
It is checkable only when it carries all three parts of the triad:

| part | question it answers |
| --- | --- |
| signal | which specific, already-observable thing do we watch |
| threshold | what value or duration counts as failure |
| consequence | what we do when the threshold is crossed, and who does it |

Worked example:

> If p95 latency on the affected endpoint has not fallen below 400 ms within two weeks of full
> rollout, the platform owner reverts to the previous adapter and reopens this decision.

Signal, threshold, consequence, and an owner — a person reading this in a month can check it without asking the author what they meant.

The vague version of the same sentence:

> If this doesn't improve performance, we'll revisit.

There is no signal (performance measured how?), no threshold (improved by how much, by when?), and no consequence (revisit is not an action, and nobody owns it).
**A condition nobody can evaluate is not a confirmation section — it is a sentence that occupies the space where one would go**, and it will still be sitting there unevaluated when the decision quietly turns out to have been wrong.

Prefer a signal you already collect.
A falsification condition that depends on instrumentation nobody has built is a plan to never check.

---

## 7. Lifecycle

**A design doc is a point-in-time record, not a living specification.**
This is the rule that keeps `docs/` trustworthy, and it is the exact opposite of the rule for help docs — help docs are refreshed to match reality, decision records are not.

Before the work ships, update the doc freely.
It is a proposal; it should absorb everything review turns up.

After it ships, **do not rewrite it to match what was built.**
Add a dated amendment section at the end, or write a successor doc.
The doc's value is the reasoning that was available at the time, and a doc edited to match the outcome no longer records a decision — it records a rationalization, and it destroys the one thing it was for.
Current-state truth lives in `PROJECT.md`, in the contracts, and in the code; those are the places to look when you want to know what the system does today.

### Superseding

When a later decision replaces an earlier one:

1. Set the old doc's status to `superseded by <NEW.md>`.
2. Have the new doc name what it supersedes, in the "What this doc is for" blockquote.
3. **Link both directions** — old to new and new to old.
4. Record the supersession in `CHANGELOG.md`.

One-directional chains rot silently: a reader arriving at the old doc from a search result has no way to learn it was replaced, and will act on reasoning that was overturned a year ago.
Both directions cost one line each.

**Do not delete the old doc.**
The rejected reasoning is the asset — without it, the same option gets re-proposed, re-argued, and re-rejected by people who have no record that the argument already happened.

Never leave a stale doc ambiguous.
Either mark it superseded with a pointer to its replacement, or delete it outright if there is genuinely nothing to preserve.
A doc that is silently wrong is worse than no doc, because it carries the authority of `docs/`.

Record a doc in `CHANGELOG.md` when it lands, and again when its status changes — a status change is the event most likely to be missed by everyone who read the doc when it was new.

### Reversibility

Weigh how hard the decision is to undo, and say so in the doc.
Amazon's framing of one-way versus two-way doors is the useful one: a reversible decision should be made quickly by the people closest to it, while an irreversible one warrants the slower process ([2016 letter to shareholders](https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders)).
A doc that does not say which kind it is invites the wrong amount of process — heavyweight review on a change you could revert in an afternoon, or a fast wave-through on a data migration you cannot.

### Provenance note

The "never edit an accepted decision record" norm is a **community convention layered on Nygard's original post, not something that post states.**
Nygard proposes short, version-controlled records with a status field; the immutability discipline grew up around the practice afterward, and is codified in later templates such as MADR ([adr.github.io](https://adr.github.io/)).

It is adopted here deliberately, and the reason is specific to this repo: **when several agents write to one repository, an edited decision is indistinguishable from a decision that was never made.**
There is no shared memory of the discussion to contradict the file, no colleague who remembers arguing the other side.
The file is the whole record, so the file has to be append-only in spirit.

---

## 8. Review

**Do not land a design doc nobody has read.**
A doc with zero comments has not been reviewed — it has been ignored, and merging it converts an unexamined draft into repository authority that later readers will treat as settled.
If a review window closes with no comments, that is a result to chase down, not a pass.

Run a comment window of 3–5 business days, with the deadline stated in the doc or the review request.
An open-ended window is one nobody starts, because there is never a day on which it is due.

Reviewers answer in one of two forms:

| answer | means |
| --- | --- |
| yes | proceed |
| not yet, if… | proceed once the named condition is addressed |

**Never a bare "no."**
Stating the condition once lets the author fix it and proceed without a second round-trip; withholding it converts a single exchange into a negotiation over what the objection actually was.
If a reviewer genuinely believes no version of this should proceed, that is a "not yet, if…" whose condition is that the problem statement changes — which is still a condition, and still says what would move them.

Name one accountable decision-maker before the window opens — `{{DECISION_OWNER}}` for this project unless the doc names someone else.
Review gathers input; it does not decide by counting votes, and a doc with three opinions and no owner stalls at exactly the point where it should be landing.
After the call is made, disagree and commit: relitigating a decided doc in the implementation pull request spends the review a second time and gets a worse answer, because the reasoning is no longer assembled in one place.

The point of review is not to catch every flaw.
It is to catch flaws while changing course is still cheap — an objection raised against a draft costs a paragraph, and the same objection raised against shipped code costs a migration.

---

## 9. A note for agents specifically

If you are an agent authoring a design doc:

**Attribute honestly.**
Put the human in the authorship line and yourself in `(via <Agent>)`.
A reader deciding how much to trust a claim needs to know how it was produced, and an unattributed agent draft reads as a human's considered judgment.

**Do not invent a rejected alternative to satisfy the content bar.**
Section 4 exists to record options that were genuinely weighed.
A fabricated straw option passes the checklist and actively misinforms — the next reader concludes that path was explored and closed, and will not explore it.
If only one option was considered, write that, and say why the others were not reached.

**Do not mark a doc `accepted`.**
Acceptance is a human act.
Draft at `proposed`, complete the content bar, and hand it to review.

That last point is the load-bearing one: **an agent may draft a decision, and never make one.**
Everything else in this reference is about producing a doc worth reviewing; this is about not skipping the review.
