# Real cadet identifiers and education records are committed to a public repository

**Status:** Open — awaiting verification

*Found 2026-08-13 by Matthew Recker (via Claude) while auditing `CHANGELOG.md` after a separate
finding was written. Nothing has been changed. See [`README.md`](README.md) for what a finding is
and the no-PII rule that governs this file.*

> **This document deliberately contains no cadet identifiers, no line numbers, and no quoted
> values** — see §7 for why the line numbers are withheld specifically. §5 carries the detection
> command; run it and you will have the exact list in one second.

---

## 1. The defect

`.ai/instructions/CORE.md` §3 states the rule plainly: *never* put student PII in a committed file,
"in a URL/query string, or in the CHANGELOG." The CHANGELOG is named explicitly. **The rule has been
violated repeatedly, over roughly two months, in files that are world-readable right now.**

Three things compound:

1. **The repository is public.** Not merely "served by Pages" — the repo itself. An unauthenticated
   request to `api.github.com/repos/dfpm-physics/Core_Preflights` returns 200, and
   `raw.githubusercontent.com/dfpm-physics/Core_Preflights/main/CHANGELOG.md` returns 200 with no
   credentials.
2. **What is exposed is not just identifiers.** Several records pair a cadet ID with an *education
   record* — a grade outcome, a judgment about their feedback, a missing-submission status, a
   section reassignment. That is the category the identifier alone is not.
3. **Redacting the working tree does not fix it.** The data is in git history on a public remote.
   See §6.4, which is the only part of this that is genuinely hard.

## 2. Why this went undetected

Not carelessness — a missing check. Every other durable rule in this repo has a machine behind it:
`check_doc_sources.py` for staleness, dry-run-by-default for mutations, `MANIFEST.sha256` for the
build kit, `check_grounding.py` for the corpus. **The PII rule has nothing.** It is enforced by each
operator remembering it at the moment of writing, and over ~40 CHANGELOG entries written by two
different agents across two months, that failed the way an unchecked convention always fails.

The policy is correct and needs no revision. The gap is entirely enforcement — which is why §6.2 is
the fix that matters most for the future, independent of what is decided about the past.

## 3. Verified — with what proved it

Every claim here came from a command run on 2026-08-13. Re-run them; do not take my word.

**The repo is public and the files are reachable anonymously:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.github.com/repos/dfpm-physics/Core_Preflights
curl -s -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/dfpm-physics/Core_Preflights/main/CHANGELOG.md
# both returned 200, unauthenticated
```

All three affected paths also return **200 over GitHub Pages** (`HEAD`, no auth). They are not
`_`-prefixed, so the Jekyll exclusion that protects `_archive/` and `_builder/` does not apply — as
CORE.md §2 already says of `docs/`, `scripts/`, `supabase/` and `tests/`.

**Scope, by file** — counts only, values withheld:

| File | What is in it |
|---|---|
| `CHANGELOG.md` | **27 distinct real cadet IDs** across 15 lines. **4 of those lines pair a full legal name with an ID.** Several attach an education record: grade outcomes, per-question feedback judgments, non-submission status, section reassignments. Also quotes instructor feedback text alongside an ID |
| `tests/app-schema/test-lesson-due.mjs` | **2 full names with their real IDs**, in fixture data. See below — this is the worst of the three |
| `docs/operations/SYSTEM_GUIDE.md` | **Not PII.** One CSV-format example with a sequential placeholder ID and a generic name. Listed so nobody "fixes" it |

**The test fixture is the sharpest edge.** Its two rows sit among fixture data and read as invented
names. They are not: one of the two IDs also appears in `CHANGELOG.md` as a real section-swap case,
which is how the fixture was identified as live roster data at all. **A file that looks synthetic
and is not will survive every redaction pass that works by eye.**

**What is NOT the problem, and must not be redacted:**

| Block | Where | Why it is fine |
|---|---|---|
| `30001000xx` | `scripts/fall2026/poc-archive/*`, `scripts/test-data/phys215-test-roster.csv`, `supabase/seed_full.sql` | The retired POC roster — fabricated names (`Alex Carter`, `Jordan Blake`, …), deleted from the DB. ~1,900 of the ~2,255 raw matches in the repo are this block |
| `3000980000`+, `3000990000`–`3000990071` | `scripts/training/` | Synthetic training-sandbox cadets |
| `3008888888`, `3009999999` | `tests/` | Deliberate test accounts |

A naive `\b3\d{9}\b` sweep returns ~2,255 hits across 40 files and is **almost entirely false
positives**. Use the anchored pattern in §5.

## 4. Inferred, NOT verified — resolve these before acting

- **The real-ID band is derived, not authoritative.** `30001[2-4]\d{4}` was inferred from observed
  real cases. The schema CHECK admits `3000000000`–`3009999999`, so a cadet outside that band would
  be missed entirely. **Treat 27 as a floor, not a total.** Confirm the band against
  `SELECT min(student_id), max(student_id) FROM app.students WHERE auth_user_id IS NOT NULL`.
- **Names appearing WITHOUT an ID were not swept for.** The entire search was ID-anchored. A
  CHANGELOG entry naming a cadet in prose with no number attached is invisible to it. §5's second
  command is the fix and it needs a live roster read.
- **Free-text student answers were not swept for.** Showcase quotes and Q3 responses are the obvious
  risk. Instructor feedback *is* confirmed present alongside IDs; student-authored text is unchecked.
- **Whether the repo has always been public**, and whether anything has forked, cloned, or been
  indexed by a crawler or a code-search product. This bears directly on §6.4 and on §6.1.
- **Whether Pages can survive the repo going private.** Serving Pages from a private repo requires a
  paid GitHub plan. If this org is on free, §6.4(a) takes the live site down and is not an option.
  **Check the org's plan before proposing it.**

## 5. Detection — ship the query, not the rows

```bash
# 1. Real-range cadet IDs in tracked files. Excludes the synthetic blocks in §3.
git grep -n -E '\b30001[2-4][0-9]{4}\b' -- . ':!textbook-pdfs'

# 2. Same, across all of git history (this is the number that matters for §6.4)
git log --all -p -- CHANGELOG.md tests/ docs/ scripts/ supabase/ \
  | grep -c -E '^\+.*\b30001[2-4][0-9]{4}\b'
```

**Names need a roster cross-reference, not a regex.** Pull `name` from `app.students` for enrolled
cadets into a scratch file *outside the repo*, then match each against the tracked tree. Do not
commit that list, and do not paste results into this document.

## 6. Options, and who owns each

Ordered by what must be decided first — **not** by cost. §6.1 gates the rest.

### 6.1 The disclosure question — the course director's, and not an engineering call

Whether a public-repo exposure of student education records requires notification is an
**institutional determination** (USAFA / DFPM privacy officer or equivalent), not one an operator or
an AI makes by reading FERPA. It is placed first because it may constrain everything below: a
history rewrite destroys the evidence of what was exposed and for how long, which an institution may
need. **Do not rewrite history before this is answered.**

This document takes no position on whether notification is owed. It establishes the facts needed to
decide.

### 6.2 A detection script — do this one regardless of every other decision

`scripts/checks/pii_scan.py`: stdlib only, read-only, the §5 patterns plus an optional roster
cross-reference, non-zero exit on a hit. Wire it in two places — the nightly `lesson-cycle`, and a
pre-commit path so a *new* violation is caught before it lands rather than two months later.

This is the fix for the actual root cause (§2), it needs no authorization, it is independent of the
disclosure question, and **it is the only item here that prevents recurrence.** If the repair
operator ships one thing, ship this.

### 6.3 Redact the working tree

Remove names outright; replace IDs with a non-reversible stable token if a record needs to remain
traceable at all. Rewrite the affected CHANGELOG prose to describe the *situation* without the
*subject* — the entries were written to record what changed, and every one of them survives the
removal of the identifier intact.

The test fixture gets synthetic names and IDs from the `30001000xx` block, and a comment saying
where its data must come from.

**State plainly what this does and does not do:** it removes the data from `main`, from the Pages
site, and from anyone reading the repo casually. **It leaves every value in git history**, publicly
fetchable by commit SHA. Shipping 6.3 alone is a partial fix and must be logged as one — recording
it as "PII removed" would be false.

### 6.4 History — the hard part, and the director's decision

Three routes, none of them an agent's to choose:

- **(a) Make the repo private.** Removes anonymous access to history in one action. **May break the
  live site** — see §4. Verify the org's plan first.
- **(b) Rewrite history** (`git filter-repo`) and force-push. Genuinely removes the values from the
  remote, but: **CORE.md §0 says never force-push**, so this needs an explicit, recorded exception
  from the director; every clone, worktree and fork is invalidated and every collaborator must
  re-clone; old commit SHAs may remain fetchable through GitHub's cache and via any fork until
  GitHub is asked to purge them; and it destroys the record of what was exposed (see §6.1).
- **(c) Accept, document, and move on.** A legitimate outcome if §6.1 concludes no notification is
  owed and the risk is judged low. If chosen, **write it down as a decision** in `docs/decisions/`
  with the reasoning — an accepted risk that is not recorded is indistinguishable from one nobody
  noticed, and the next operator will re-discover this and re-panic.

### 6.5 Close the loop in CORE.md

CORE.md §3's rule needs no change, but it should gain a pointer to the check from §6.2 — the pattern
this repo already uses everywhere else, where a stated rule names the machine that enforces it.

## 7. Why this document withholds line numbers

A finding is published on the same public Pages as the data it describes, so enumerating "file X,
line N holds a cadet's full name" would be a map to the exposure, sitting beside the exposure.

Against that: the data is already discoverable by anyone who runs one `grep`, so a finding does not
meaningfully raise the risk, and **the alternative — not writing it down — is how it stays unfixed
for another two months.** That is the trade this document makes deliberately.

So: counts and filenames, because the fixer needs scope; the detection command, because it stays
correct as the files change; **no values, no line numbers.** The README's "ship the query, not the
rows" rule, applied to a case where the rows are the whole subject.

**When this is closed, prune it.** A finding normally stays forever (README). This one should keep
its §1–§2 reasoning and its §6.2 outcome, and lose the scope table — once fixed, the counts describe
only what is in history, and there is no reason to leave a signpost pointing there.

## 8. How you would know this diagnosis is wrong

- **The 200s came from a cached or authenticated path.** Re-run §3 from a network with no GitHub
  session — a phone on cellular is sufficient. If the repo is private, the severity drops sharply
  and §6.4 mostly evaporates.
- **The IDs are not real cadets.** Sample five against
  `SELECT student_id, auth_user_id IS NOT NULL AS provisioned FROM app.students WHERE student_id IN (…)`.
  If they carry no auth account and no registrar email, they are sandbox rows and this finding is
  largely void. *(One of them was confirmed real by an independent route — a live section-swap
  repair on 2026-08-13 — so expect this falsifier to fail. Run it anyway.)*
- **The count rises far above 27 once §4's open sweeps are run.** Then the redaction in §6.3 is not
  a careful edit of fifteen lines but a bulk operation, and it needs the `safe-change` runbook and a
  different plan.
- **`git log -S` finds the values in files that no longer exist.** Then the working-tree redaction in
  §6.3 addresses even less of the problem than §6.3 already admits, and §6.4 moves up in priority.

## 9. House rules the repair operator must follow

- **`.ai/instructions/CORE.md` is authoritative** — §0 (coordination gate, no unilateral DDL,
  snapshot-first, **never force-push**), §3 (this rule), §5 (CHANGELOG, push only when asked).
- **Read `.ai/skills/safe-change/SKILL.md`** before any redaction pass or history operation. A
  history rewrite is the most irreversible operation in this repo.
- **Nothing here is authorized.** The course director asked for the write-up only.
- **Do not paste findings into this file, into `CHANGELOG.md`, or into any commit message.** The
  scratchpad, or out-of-band to the director. It would be a poor outcome for the remediation of a
  PII leak to be the thing that leaks the PII.
