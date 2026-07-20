# Help-doc style — the checkable rules

Companion to [`../SKILL.md`](../SKILL.md). Every rule here is checkable against a draft. Sources are
named so a future maintainer can argue with the rule instead of guessing at it.

Two audiences, both of whom arrive mid-task from a deep link (`help.html?doc=<id>`) rather than
reading front to back: **cadets** (Physics 110 / 215, submitting work under a deadline) and
**faculty** (grading between classes). Neither is reading for pleasure and neither will finish.

---

## 1. The reading reality this is all downstream of

- **79% of users scan; 16% read word-by-word** ([Morkes & Nielsen 1997](https://www.nngroup.com/articles/how-users-read-on-the-web/)).
- Users read **~20–28% of the words** on an average visit; 50% of content is read only on pages of
  **111 words or fewer** ([Nielsen 2008](https://www.nngroup.com/articles/how-little-do-users-read/),
  n=45,237 page views).
- Scanning follows an **F-pattern** — *"The first two paragraphs must state the most important
  information"*, and the third word on a line is read far less than the first two
  ([Nielsen 2006](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)).
- Users avoid reading **even when reading would be faster** — the *paradox of the active user*
  ([Carroll & Rosson 1987](https://research.cs.vt.edu/ns/cs5724papers/4.mental.mental.carroll.paradox.pdf)):
  *"Learners at every level of experience try to avoid reading."*
- Weak information scent → immediate abandonment. Low-literacy readers in particular *"assumed the
  first reference they came across would answer their query and found it hard to recover if that was
  not the information they needed"* (Kodagoda et al. 2010).

**What follows:** front-load everything. Put the answer in the first screenful. Make headings
literal. Keep the essential payload near 100 words and let detail follow for the few who continue.

---

## 2. Structure

- **Answer in the first two paragraphs.** No preamble, no "This page describes…", no restating the
  title. The manifest `title` and `summary` already render above your content — do not repeat them.
- **Start at `##`.** Sentence case. No terminal period or colon. Unique headings — they are
  in-page anchors and jump targets.
- **Headings must be descriptive and removable** — the content should still make sense with the
  headings deleted (GOV.UK). Front-load the distinguishing word. Ban `Introduction`, `Overview`,
  `Notes`, `Miscellaneous`.
- **Every topic is self-contained.** No "as we saw above", "in the previous section", "continued
  from" — readers arrive by deep link with no prior page (Mark Baker, *Every Page Is Page One*).
- **Expand acronyms on the page where they appear**, not once per doc set (Spyridakis 2000) —
  arrival is per-page. PREP, iPREP, JiTT, RLS, SA all qualify. Bold both forms on first use:
  **Pre-lesson Readiness Engagement Platform** (**PREP**).
- **Manifest `summary`:** ≤160 characters, contains a verb, does **not** restate the title and does
  **not** open "A guide to…" / "This page describes…". It is the only thing most readers see.
- **Split at length.** More short topics beat one long one for both findability and retention
  (Dee-Lucas 1995). A topic that needs two honest titles is two topics.

## 3. Procedures

- **Numbered list** when order matters; bullets when it doesn't; a **single step is a bullet**, not
  a list of one.
- **One action per step.** Combine only within one UI location: "Select **Grade > All sections**."
- **Every step starts with an imperative verb**, optionally after a locating phrase: "On the
  **Grade** tab, select…"
- **Order inside a step: location → goal → action → result.**
  - ✅ "To reopen a submission, on the **Grade** tab, select **Unfinalize**. The score returns to draft."
  - ❌ "Select **Unfinalize** on the Grade tab if you want to reopen a submission."
  - Condition first lets a reader skip an instruction that doesn't apply to them
    ([Google, clause order](https://developers.google.com/style/clause-order)).
- **Mark optional steps `Optional:`**, not `(Optional)`.
- **Prerequisites go in a labelled section before step 1**, never inline mid-procedure. Bulleted,
  plural heading even for one item, **non-imperative** — prerequisites are *conditions*, steps are
  *actions*. Omit the obvious.
- **End with verification** — an observable state, not "You're done."
  - ✅ "The student's row turns green and shows **Finalized**."
  - This is a required element in both Red Hat's modular-docs schema and IEC/IEEE 82079-1.
- **Fit the steps on one screen** (Microsoft's actual wording; the widely-quoted "seven steps" is a
  secondary paraphrase). Warn at 7, hard cap 10, then split into two tasks.
- **No table inside a numbered procedure** ([Google](https://developers.google.com/style/tables)).

## 4. Referring to the interface

- **Bold** UI labels, matching the on-screen text exactly — minus any trailing `:` or `…`.
- **Never use a UI label as an English verb or noun.** ❌ "**Finalize** the score" → ✅ "Select
  **Finalize**."
- **Omit the element type** (button, checkbox, dialog) unless it adds clarity.
- **Input-neutral verbs only** — *select, open, close, go to, enter, clear, choose, turn on*. No
  *click*, *tap*, *press*, *swipe*. Cadets read these on phones and laptops both, and *click* is
  wrong on one of them.
- **No positional language** — ❌ "the panel on the left", "the icon above". Layout changes and
  screen readers don't have a left.
- **Prepositions:** *in* dialogs, fields, lists, menus, panes; *on* pages, tabs, toolbars.
- **Roles ≠ permissions.** A user *has* a role; a role *contains* permissions. Write "instructors
  with the director role", never "director permissions". This repo's tier system makes the
  distinction load-bearing.

## 5. Sentences and words

- **Active voice, present tense, second person.** ❌ "Scores will be finalized by your instructor" →
  ✅ "Your instructor finalizes your score." Passive costs words and reading time (Rose 1981) and
  readers translate it back to active anyway to understand it (Flower, Hayes & Swarts 1983).
- **Average 15–20 words per sentence; split anything over 25.** Max 5 sentences per paragraph.
- **One idea per sentence.** A sentence carrying "or" plus embedded alternatives usually wants to be
  a list.
- **Pronoun discipline:** if more than five words separate a noun from its pronoun, repeat the noun.
  ❌ "The AI writes a suggested score and flags the answer. **This** is not final." → ✅ "**That
  suggested score** is not final."
- **Banned — condescension.** *simply, just, easy, easily, obviously, of course, quickly, please.*
  These assert something about the reader's experience the writer cannot verify; when the claim is
  false, the reader concludes the failure is theirs. Especially corrosive to a cadet who is stuck
  the night before a deadline.
- **Banned — vagueness.** *a number of, several, various, relatively, significant, substantial,
  usually, probably, clearly, very, really, quite, totally, actually, completely.* Replace with the
  number or delete.
- **Flag and cut:** "there is/are", "in order to", "is able to", "at this point in time", a
  droppable "you can".
- **Negative contractions** ("can't", "don't") are harder to read than the expanded form (GOV.UK);
  positive ones ("you'll") are fine.
- **Define jargon on first use or link to a definition.** PREP-specific terms that always need it:
  *preflight*, *interaction*, *effort*, *finalize*, *warn/yellow*, *M-day / T-day*, *section*, *tier*.
- **Plain language is not condescension.** Experts prefer it too — they have the most to read.

## 6. Notices and warnings

- **Required content never lives in a callout.** Google bars notices for prerequisites and necessary
  steps; Microsoft's own guidance says *"readers tend to skip over them."* Give required content a
  heading.
- **A warning precedes the step it applies to.** After the step, it is read after the damage.
- **One or two notices per page, maximum, and never two adjacent** — they lose distinctiveness.
- **Severity:**

  | Condition | Use |
  |---|---|
  | Irreversible — permanent data loss, a grade released to students, a credential exposed | **Warning** |
  | Recoverable but risky, or depends on a non-obvious precondition | **Caution** |
  | Required for success but not hazardous | **not a callout** — put it in the step |
  | Useful aside, skippable | Note |

- A warning states the **hazard, the consequence, and how to avoid it** — in that order.

## 7. Tables and lists

- **Table** only when each item carries **three or more** related pieces of data. One column → make
  it a list. A pair of related values → a description list.
- **Introduce every table and list with a complete sentence** ending in a colon.
- **Parallel structure** across grammar, category, capitalization, and punctuation. The first item
  sets a pattern readers expect to hold.
- **Link text is descriptive and front-loaded** — "Go to accounts" measurably outperforms "Accounts",
  especially for older readers (Chadwick-Dias et al. 2003). Never "click here" or "more". Put links
  at the end of a sentence, not mid-clause.

## 8. Draft checklist

Run this before adding the manifest entry.

- [ ] Exactly one Diátaxis mode; the title honestly describes the whole document
- [ ] Answer present in the first two paragraphs; no preamble
- [ ] No YAML front matter; starts at `##`; no raw HTML
- [ ] Manifest entry added — stable `id`, correct `tier`, `summary` ≤160 chars with a verb
- [ ] Contains no credential, PII, internal path, or answer key — it is public at every tier
- [ ] Steps: imperative, one action each, location before action, ends in a verification
- [ ] Fits one screen, or is split
- [ ] No required content inside a callout; warnings precede their steps
- [ ] Banned words absent; sentences under 25 words; paragraphs under 5 sentences
- [ ] Acronyms expanded on this page; PREP jargon defined or linked
- [ ] Input-neutral verbs; no positional language; roles not conflated with permissions
- [ ] Self-contained — no reference to a previous or next page
- [ ] Renders and appears under the right tier at `localhost:8000`
- [ ] `CHANGELOG.md` updated
