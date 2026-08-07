---
name: docs-author
description: >
  Decide whether a concept warrants written documentation, route it to the right artifact, and
  write it. Two outputs: an in-app HELP DOC (`site/help/` + `MANIFEST.json`, tier-gated,
  must stay current) and a DESIGN DOC (`docs/`, point-in-time record of a decision). Use when
  asked to "document this", "write a help page/topic", "add something to Help", "write it up",
  "write a design doc / spec / ADR", "explain this to students/instructors/directors", or
  /docs-author — and BEFORE writing any new `.md` under `site/help/` or `docs/`. Also use
  to decide the prior question: does this need a doc at all, which kind, and for whom? The gate
  can and often should answer "neither — fix the UI, or just log it in CHANGELOG.md". NOT for
  `docs/app/DESIGN.md` (that is the design *system* — tokens and components, a different file
  with its own rules), not for CORE.md/PROJECT.md (the operating contract), and not for
  CHANGELOG.md (which every shipped change updates regardless).
---

# Docs Author — route it, then write it

> **Scope.** This skill covers the two documentation surfaces a person reads on purpose:
> **help docs** (in-app, tier-gated, for people *using* PREP) and **design docs** (in-repo, for
> people *changing* PREP). It does not cover code comments, `CHANGELOG.md`, or the design system.

The default answer to "should I write a doc?" is **no**. Documentation that restates the screen
trains readers to ignore all documentation ([NN/g](https://www.nngroup.com/articles/help-and-documentation/):
pushing obvious instructions taught users to dismiss help entirely), and a doc that goes stale is
worse than one that never existed (Write the Docs: *"Consider incorrect documentation to be worse
than missing documentation"*). Write only what earns its maintenance cost.

**Work in this order. Do not skip Step 0 or Step 1.**

---

## Step 0 — Name the reader and the question they arrived with

Before writing anything, answer two questions in one sentence each:

1. **Who is the reader?** Not "instructors" or "students" — a specific person in a specific
   situation. "A director standing in front of a cadet who cannot sign in." "An instructor
   opening the Grade tab at 2200 the night before class."
2. **What question did they arrive with?** In their words, not yours. Nobody arrives asking
   "how does the offering/activity split work"; they arrive asking "why can't my cadet see
   this preflight".

**If you cannot name both, stop — you are not ready to route.** Routing is entirely a function
of those two facts, and a document written without them becomes a description of the
implementation, which is the failure mode that produces docs nobody reads. Ask the human.

Then confirm the repo can receive a document: `docs/architecture/`, `docs/contracts/`,
`docs/decisions/` and `docs/operations/` exist, `docs/DOC-SOURCES.json` parses
(`python scripts/docs/check_doc_sources.py validate`), and `CHANGELOG.md` exists. A document
dropped into a tree with no taxonomy lands wherever the author guessed, and guessed locations
are how `docs/` becomes a folder of unsorted files nobody greps.

---

## Step 1 — Route: what artifact, if any?

Ask what question the reader has. That determines the artifact — not who asked, and not how
interesting the work was.

| The reader's question | Artifact |
|---|---|
| "How do I do X in PREP?" · "Why did the system do this to my grade?" | **Help doc** — `site/help/` |
| "Why did we build it this way, and what did we reject?" | **Design doc** — `docs/decisions/` |
| "What is the wire format, and what may never change?" | **Contract** — `docs/contracts/` |
| "How do the pieces fit together?" | **Architecture** — `docs/architecture/` |
| "How do I operate the system from outside the app?" (SQL, migrations, scripts, deploys) | **Runbook** — `docs/operations/` |
| "What state was the system in on date X, and what was wrong with it?" | **Audit** — `docs/audits/` |
| "What changed, when, and who did it?" | **`CHANGELOG.md` only** — always, for every shipped change |
| "How must an AI agent behave here?" | **`CORE.md`** — the operating contract, not a doc |

Two of these overlap and need a hard line:

- **Help doc vs. `docs/operations/`.** A help doc covers **what you do inside the app UI**. A runbook
  covers **what you do outside it** — Supabase SQL, migrations, `scripts/`, `supabase/admin/`,
  deploys. The reason is not taste: help docs are **public static assets** (Step 2), so an
  operational procedure that references credentials, hostnames, or internal paths *cannot* be a
  help doc at any tier.
- **Design doc vs. help doc.** A design doc is a **point-in-time record** — it captures reasoning,
  is archived after the work lands, and is superseded rather than rewritten. This is why ADRs are
  immutable by convention and carry a status
  ([Nygard, *Documenting Architecture Decisions*](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)),
  and it is why `docs/decisions/`, `docs/contracts/` and `docs/audits/` are deliberately absent from
  `docs/DOC-SOURCES.json` — a staleness flag on a historical record is permanent noise, and a
  checker that always complains is a checker everybody learns to ignore. A help doc has the
  opposite contract: it must be current, and staleness is a bug. **If you are tempted to write one
  document that does both, you have two documents** — the moment the design changes, one half must
  be rewritten and the other half must not, and no single file can obey both rules.

### The design-doc gate

**REQUIRE a design doc if ANY of these is true:**
- The decision is a **one-way door** — the frozen artifact↔site contract URLs, the `schema: 1` wire
  format, `assignments`/`responses`/`scores` shape, an RLS policy, an assignment-id namespace, or
  any migration of live student data.
- **Two or more operators** (human or agent) must align on it before it is safe to build.
- It touches **security, privacy, or FERPA surface** — student PII, roles and access, what an
  instructor may see across sections.
- It is **novel** — no in-house precedent to copy.

**CONSIDER one** if you answer yes to 3 or more of [Google's five questions](https://www.industrialempathy.com/posts/design-docs-at-google/):
unsure of the right design? · would senior review help? · is it contentious? · are cross-cutting
concerns easy to forget here? · would a future maintainer need this to understand a legacy system?

**SKIP it — write the code instead — if ALL of these hold:**
- **You cannot name a serious alternative you rejected.** This is the sharpest single test. Google:
  a doc that says *"this is how we are going to implement it"* without trade-offs *"would probably
  have been a better idea to write the actual program right away."*
- Reverting costs less than writing the doc.
- One operator, one area.
- Behavior-preserving (a refactor, a rename, a style fix).

Applying heavyweight process to reversible decisions is itself a failure mode, not caution — it
produces *"slowness, unthoughtful risk aversion, failure to experiment"*
([AWS on one-way vs. two-way doors](https://aws.amazon.com/executive-insights/content/how-amazon-defines-and-operationalizes-a-day-1-culture/)).

### The help-doc gate

Write a help doc only if **all four** hold:

1. **A real person hit this.** Justify new topics with evidence — a question actually asked, a
   support pattern, an observed failure — not with a wish to be complete.
2. **The content is not already on screen.** If the topic's entire payload is "the button labelled X
   does Y", that is a UI bug. Fix the label.
3. **The fix isn't a product change.** If the doc exists to warn users away from a trap the UI
   permits, escalate to adding a confirm, an undo, or a disabled state first. Instructions are the
   *last and weakest* tier of risk reduction (ISO 12100), not a free choice.
4. **It can be public.** See Step 2 — every help doc is world-readable regardless of tier.

Then classify it with the [Diátaxis](https://diataxis.fr/compass/) compass — two questions, one answer:

| If the content… | …and the reader is… | …it is a… |
|---|---|---|
| informs **action** | **learning** (at study) | tutorial |
| informs **action** | **working** (at task) | **how-to** ← most PREP help docs |
| informs **cognition** | **working** | reference |
| informs **cognition** | **learning** | explanation |

**One mode per document.** Blurring them is *"at the heart of a vast number of problems in
documentation."* A how-to that stops to explain *why* has become two documents wearing one title —
link out instead. `ai-and-your-work.md` is legitimately an **explanation**; `student-getting-started.md`
is a **how-to**. Do not let either drift into the other.

Finally, set the **tier** — the *lowest* role that should see it: `student` → `instructor` →
`director` → `admin`, cumulative. Tier is per-course for directors (`ctx.isDirectorForCurrent()`),
so a director in one course loses director topics when they switch to a course where they only
instruct. Write director-tier content so that losing it is not a safety problem.

---

## Step 2 — Write a help doc

**Read [`references/HELP-STYLE.md`](references/HELP-STYLE.md) before drafting.** It carries the
checkable rules; this section carries only what will break the page if you get it wrong.

### Mechanics that are not negotiable

The authoring contract is [`site/help/README.md`](../../../site/help/README.md); the renderer is
[`site/js/help.js`](../../../site/js/help.js).

- **No YAML front matter.** The repo has no `.nojekyll`, so Jekyll converts any file with front
  matter to HTML and the Help page's fetch 404s. This is the single most common way to break a help doc.
- **Start at `##`.** The manifest `title` renders as the `<h1>`.
- **No raw HTML.** Content goes through `marked` → `DOMPurify`; tags are stripped.
- **Link to other topics as `[Title](help.html?doc=<id>)`** — relative links resolve against
  `site/{student,faculty}/`, not the help folder.
- **File name:** `<audience>-<topic>.md`. **Manifest entry:** `id` (stable kebab-case — it is the
  deep link, changing it breaks saved URLs), `tier`, `title`, `summary`, `file`. Order within the
  manifest is display order inside the tier group.

### The security rule

**Tier gating is presentation, not access control.** These are static files on GitHub Pages: anyone
who guesses a filename reads any of them, signed in or not. This is exactly
[CWE-425 (forced browsing)](https://cwe.mitre.org/data/definitions/425.html) and
[CWE-656 (security through obscurity)](https://cwe.mitre.org/data/definitions/656.html) — the tier
decides what the page *lists*, nothing more.

**Never in a help doc, at any tier:** a service key or any credential · a DB connection string,
internal hostname, or absolute local path · student PII, including indirect identifiers that could
re-identify someone in a small section (FERPA covers indirect identifiers) · answer keys · exact
descriptions of a security control or how to bypass one. Content that must genuinely be restricted
belongs behind Supabase RLS.

### Three of the eight docs are still stubs

`admin-system-operations.md`, `ai-and-your-work.md` and `director-ai-rules.md` open with a `>`
blockquote saying so; the other five have been expanded. That marker is fine as a temporary flag,
but **it is not a pattern to copy for real content**: required information must never live in a
callout. Google bars notices for prerequisites and necessary steps; Microsoft says outright that
readers skip boxes. When you expand a stub, delete the blockquote and give the content a real
heading — and update the count here, which said "the five existing docs" and "every current help
doc" until 2026-07-27, by which point both were false.

---

## Step 3 — Write a design doc

**Read [`references/DESIGN-DOC.md`](references/DESIGN-DOC.md)** for the template, the content
checklist, and the lifecycle rules.

House conventions, from the four docs already in `docs/`: an H1 title, a bold **Status:** line, an
italic authorship line (`*Authored YYYY-MM-DD by <Human> (via <Agent>). Companion to …*`), links to
sibling docs, then numbered sections. Match that — a new doc that looks unlike its neighbors reads
as an orphan.

---

## Step 4 — Verify

1. **Render it.** No build step (CORE.md §2):
   ```
   python -m http.server 8000
   ```
   Open `http://localhost:8000/site/student/help.html` and `.../faculty/help.html`. Confirm the
   topic appears under the expected tier, opens, and renders — a doc that 404s locally will 404 live.
2. **Validate the manifest parses** — a trailing comma silently breaks the entire Help page, not
   just the new topic.
3. **Re-read it as the lowest-tier reader who can see it.** If a student-tier doc assumes faculty
   vocabulary, it fails.
4. **Register it in [`docs/DOC-SOURCES.json`](../../../docs/DOC-SOURCES.json)** — required for any
   document that must stay current (help docs, `docs/operations/`, skills). List the authoritative
   sources you actually wrote it from, set `reviewed` to today, and confirm it resolves:
   ```
   python scripts/docs/check_doc_sources.py list
   ```
   An unregistered help doc will silently rot the first time `CORE.md` or a skill moves. **Do not
   register a `docs/decisions/` or `docs/contracts/` doc** — those are point-in-time and superseded,
   not refreshed.
5. **Refresh the reader-facing staleness snapshot and commit it with your change:**
   ```
   python scripts/docs/check_doc_sources.py status --write
   ```
   The Help page shows a "may be out of date" banner on flagged topics, but a browser cannot run
   `git` — so the verdict comes from `site/help/DOC-STATUS.json`, computed on your machine and
   committed. **A stale snapshot is a silent all-clear, which is worse than no banner**: it tells
   readers a page was checked when it was not. It is generated from committed history only, so your
   working tree does not affect what readers see, and `check` prints a reminder when the published
   file and the live verdict disagree.
6. **Update `CHANGELOG.md`** — newest first, `## YYYY-MM-DD — <Human> via <Agent>`, what and why.
7. Push only when asked (CORE.md §5). `main` is live; a push rebuilds the production site.

---

## Rules

1. **Route before writing.** A well-written doc in the wrong artifact is still wrong. "Neither —
   log it in `CHANGELOG.md`" is a legitimate and common outcome.
2. **Help docs must be current; design docs must not be rewritten.** Update a help doc the moment
   the behavior changes. Supersede a design doc with a new one and link both directions — do not
   edit a landed decision into agreement with the present.
3. **Every help doc is public.** No credential, no PII, no answer key, at any tier. If the content
   cannot be public, it is not a help doc.
4. **One Diátaxis mode per help doc.** If it needs two honest titles, it is two documents.
5. **Required content never lives in a callout.** Give it a heading.
6. **A warning precedes the step it applies to**, never follows it.
7. **Name a rejected alternative or skip the design doc.** If there was no trade-off, there was no
   decision worth recording.
8. **Say how you would know you were wrong.** Every design doc states a falsification condition —
   the signal, threshold, and what happens then. Three independent traditions converge on this
   (MADR's *Confirmation*, rollback triggers, *"top three reasons this will not succeed"*), and it
   is the field most often skipped.
9. **Never invent authority.** These docs summarize `CORE.md` and `PROJECT.md`; those stay
   authoritative. If a help doc and the contract disagree, the help doc is the bug — say so in-page,
   as `director-ai-rules.md` already does.
10. **No front matter on a help doc, ever.** Jekyll will eat it.
11. **Register every must-stay-current doc in `docs/DOC-SOURCES.json`**, and when you change a
    source, run `python scripts/docs/check_doc_sources.py` and resolve what it flags. A rule with no
    mechanism is how documentation rots.
12. **Update `CHANGELOG.md`** for any doc you add or materially change.
