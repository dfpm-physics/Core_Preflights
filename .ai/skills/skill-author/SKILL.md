---
name: skill-author
description: >
  SKILL AUTHORING — creates or revises exactly one skill directory under
  `.ai/skills/<name>/`. Reads `.ai/instructions/CORE.md` §4 (the skill index),
  the existing skill roster, and `references/SKILL-TEMPLATE.md`; writes that
  skill's `SKILL.md`, its optional `references/*.md`, its optional vendor
  addenda, the `CORE.md` §4 index row, and a `CHANGELOG.md` entry. Use when the
  user wants to add a new skill, restructure an existing one, repair a skill
  agents keep executing wrongly, or decide whether a procedure deserves to be a
  skill at all. Triggers: "write a skill for", "turn this into a skill",
  "should this be a skill?", "the X skill isn't working", "add a step to the X
  skill", /skill-author. NOT for prose documentation — a guide, a reference
  page, or an explanation routes to `docs-author`; NOT for the operating contract
  itself, which is a human's edit to `.ai/instructions/CORE.md`. A skill with no
  authority chain to cite is unanchored, so `CORE.md` must exist first. Any
  agent may run this; the only precondition is a writable `.ai/skills/` tree.
  Argument: the kebab-case skill name, or a description of the procedure to
  be evaluated.
---

# skill-author — write and revise the skills other agents execute

> This skill owns the *shape* of a skill: its frontmatter, its step spine, its guards, its reference files, its vendor addenda, and its retirement. It does not own prose documentation — that is `docs-author`. It does not own installing this kit — that is `project-bootstrap`. And it does not own the *content* of your procedure: you must already know how the work is done before you can write it down. A skill authored from guesswork is worse than no skill, because it is confidently wrong at machine speed.

Everything here cites `CORE.md` as the authority. Where this skill and `CORE.md` disagree, `CORE.md` wins.

---

## Step 0 — Preflight: refuse to write the skill

**The default answer to "should this be a skill?" is no.** Start from refusal and make the procedure argue its way in — because the failure mode of a skill library is not too few skills, it is too many, and the damage is not local. An agent that opens three skills in a row and finds each one restating what it would have done anyway learns that skills are low-value, and then it stops reading them. **One padded skill degrades the routing of every other skill in the tree.** You cannot fix that by writing the next one better.

A skill earns its existence only when all three of these hold:

1. **Repeated** — the procedure will run again, by a different agent or a later you. A one-off is not a skill; it is a task.
2. **Non-obvious failure modes** — a competent agent, given the goal and no skill, would plausibly get it wrong. Not slower. *Wrong.* If the only thing the skill adds is speed, write a script.
3. **Stable shape** — the steps were the same the last two times. If the shape is still moving, you will encode this week's accident as next year's rule.

Check the alternatives before you conclude "skill". Most candidates belong somewhere cheaper:

| the procedure … | write it as |
|---|---|
| runs once and is then done | nothing — just do the work |
| is a *fact* about this project (paths, names, versions, ownership) | a paragraph in `PROJECT.md` |
| is a one-line always-rule with no steps | a `## Rules` line in `CORE.md` |
| is deterministic, testable, and needs no judgement | a script with a real `--help` |
| is prose a human reads to understand something | route to `docs-author` |
| is repeated but any competent agent gets it right unaided | nothing — see the anti-pattern above |
| is repeated and dangerous, but shape still shifting | notes in `PROJECT.md` until it stabilizes |
| is repeated, has real failure modes, and has held its shape | **a skill** |

If it does not clear the gate, **stop and say so.** Name which of the three tests it failed and where the content should go instead — "this is a fact, not a procedure; add it to `PROJECT.md` under Deployment" is a useful refusal. "No" alone is not.

If it clears the gate, check the roster before you create anything. **`CORE.md` §4 is the roster** and the directory listing of `.ai/skills/` is the check on it; as of 2026-08-20 they hold ten: `lesson-cycle`, `preflight-analyze`, `lesson-aggregate`, `interaction-backfill`, `setup-preflight`, `docs-author`, `safe-change`, `gemini-port`, `skill-author`, and `integration-package`. Read the index rather than this sentence — it is a snapshot and the index is not. **If an existing skill already owns this unit of work, amend that skill instead of adding a sibling** — two skills competing for the same trigger phrase is a routing coin-flip, and the model will not always pick yours.

---

## Step 1 — Fix the unit of work

**Every skill acts on exactly one unit: one file, one record, one release, one dependency report, one lesson.** Name that unit in the first sentence of the description and again in the H1 gloss — because the unit is what makes the steps addable. "Verify it" is meaningless until you know whether *it* is a file or a fleet.

**Two units means two skills.** This is the single most common design error in skill authoring, and it is not a style problem — it is a correctness problem. A skill that both *generates a release note* and *publishes the release* has two failure surfaces, two rollback stories, and two different sets of preconditions, so its Step 0 cannot refuse coherently and its verify step cannot assert coherently. Split it. The publishing skill can name the generating skill as a prerequisite in its description (part 6 of the recipe, Step 2).

Test yourself with the plural: if the honest summary of the skill needs "and" between two verbs with different objects, you have two skills.

> **Worked example.** "Audit dependencies and open PRs for the outdated ones" — two units (one report, N pull requests). Split into `dep-audit` (unit: one audit report) and a separate upgrade skill (unit: one dependency upgrade). `dep-audit` names the upgrade skill as the usual next step; the upgrade skill names the audit report as its precondition. Each can now refuse cleanly.

---

## Step 2 — Write the frontmatter

The frontmatter has **exactly two fields**: `name` and `description`. Nothing else. Extra keys are silently ignored by loaders and become false documentation for the next author.

**`name` MUST equal the directory name**, kebab-case — because discovery walks directories and matches the field, and a mismatch produces a skill that exists on disk and is unreachable in practice. This is the cheapest bug in the system to prevent and one of the most annoying to diagnose.

**`description` is read by the model for routing, not by a human for a UI label.** Internalize that and the style follows: literal trigger phrases beat elegant summary, and an explicit negative boundary beats a graceful one. You are writing a classifier prompt. Write it like an engineer, not a copywriter.

Use the eight parts, in this order:

| # | part | why it exists |
|---|---|---|
| 1 | CAPS category noun phrase naming the unit | first tokens do the heaviest routing work |
| 2 | what it reads / what it writes | lets the model predict blast radius before invoking |
| 3 | "Use when the user wants …" | maps intent, not vocabulary |
| 4 | literal trigger phrases in quotes + slash command | catches the words users actually type |
| 5 | NEGATIVE boundary naming confusable siblings | stops the coin-flip between neighbouring skills |
| 6 | sequencing note, if any | prevents running step two of a two-skill chain first |
| 7 | who runs it and preconditions | lets the model refuse before it opens the file |
| 8 | arguments, last | least routing value, so it goes where it costs least |

Use a folded scalar (`description: >`), 8–16 lines. Under eight lines you have almost certainly dropped the negative boundary; over sixteen you are writing the skill body in the wrong place.

A full worked example for an invented, generic skill:

```yaml
---
name: dep-audit
description: >
  DEPENDENCY AUDIT — produces exactly one audit report covering the project's
  declared third-party dependencies. Reads the lockfile, the manifest, and
  `.ai/instructions/PROJECT.md` for the pinning policy; writes
  `docs/audits/deps-<date>.md` and a `CHANGELOG.md` entry. Use when the user
  wants to know what is outdated, what has a published advisory, or what is
  pinned against policy before a release. Triggers: "audit our dependencies",
  "what packages are out of date", "check for vulnerable deps", "pre-release
  dependency check", /dep-audit. NOT for performing upgrades — editing the
  manifest and opening PRs is `dep-upgrade`; NOT for license review, which is
  `license-report`. Run this before `dep-upgrade`, because the upgrade skill
  refuses without a report newer than the lockfile. Any agent may run it; it
  requires a committed lockfile and network access to the advisory database.
  Argument: optional ecosystem filter (for example `npm`, `pip`) — default is
  every ecosystem the manifest declares.
---
```

Read that back against the table before you move on. Every part is present, part 5 names two real siblings rather than gesturing at "other skills", and part 7 states a precondition the Step 0 refusal can actually check.

---

## Step 3 — Lay the step spine

A skill is a numbered spine of `## Step N — Imperative Phrase` headings. The default arc, and you should have a reason to deviate:

**Step 0 — Preflight** → read → derive → dry-run → write → verify.

**Step 0 always exists and it must be able to refuse.** The reason is asymmetry: an agent that starts a write-shaped procedure with a missing precondition does not stop at the missing piece — it improvises around it, and improvisation inside a half-finished write is exactly the state that is hardest to unwind. **A skill without a refusal path is a skill that always proceeds, which means its guards are decorative.**

A good refusal has two halves and is useless with either missing:

1. **Name the missing precondition precisely.** Not "config is invalid" — "`.ai/instructions/PROJECT.md` has no `## Deployment` section".
2. **Give the exact remedy, copy-pasteable.** A command, a file path plus the literal text to add, or the name of the skill that produces the missing artifact.

> **Refusal, done right:**
> "Stopping. `dep-audit` requires a committed lockfile; `package-lock.json` is untracked. Run `git add package-lock.json && git commit -m 'chore: commit lockfile'`, then re-run `/dep-audit`."
>
> **Refusal, done wrong:** "I can't run this because the preconditions aren't met." That tells the user a fact they cannot act on, which costs a round-trip and teaches them the skill is flaky.

The middle steps carry the real work. Keep them honest:

- **read** — gather every input before deciding anything. An agent that reads and writes in alternation cannot dry-run, because half the writes have already landed by the time it can show you a plan.
- **derive** — do the judgement in the open. Whatever the skill computes (a diff, a set of targets, a proposed name) should be *stated* before it is *used*, so a human reviewing the transcript can catch a wrong premise early rather than a wrong output late.
- **dry-run** — see Step 4.
- **write** — the smallest possible set of mutations, each one attributable to something the derive step named.
- **verify** — see Step 4.

Steps are numbered so that guards can back-reference them (`(Step 4)`), and so that a bug report can say "it skipped Step 3" instead of "it did the wrong thing". Keep step titles imperative and short: `## Step 4 — Write the guards`, not `## Step 4 — On the subject of guards and their various forms`.

---

## Step 4 — Write the guards

Guards are the part a competent agent would not have invented, which means **guards are the actual payload of most skills.** Everything else is scaffolding around them.

**Preconditions.** Every precondition belongs in Step 0 as a check with a refusal, not in the prose as an assumption — because an assumption stated in paragraph four is read after the writes in step three have already happened.

**Dry-run before commit, for anything that writes.** The dry-run must print what *will* change — paths, counts, and a sample of the actual content — and then stop for confirmation. **A dry-run that only prints "3 files will be updated" is not a dry-run**, because the number was never the risky part; the content was. For destructive or irreversible operations, hand off to `safe-change` rather than reimplementing its gate here — one gate, maintained once.

**Idempotency, with a named mechanism.** Running the skill twice must not produce two of anything. Name the mechanism explicitly in the step:

| mechanism | use when |
|---|---|
| unique key on the record | the target store can enforce it |
| skip-if-present filter on a stable identifier | you can cheaply test existence first |
| content hash compared before write | the write is expensive or noisy |
| upsert keyed on a natural identifier | re-running should refresh, not duplicate |

**Never write "be careful" or "avoid duplicates".** That is not a guard — it is a wish. The next agent cannot execute a wish, and the wish is what you will find in the postmortem.

**Never clobber human work.** If a target file or field already has content the skill did not author, **stop** and report the path, the conflicting content, and the change you wanted to make. Merging silently is the worst option available: it destroys the human's edit *and* hides that it happened. Where you need to distinguish machine-written regions, mark them at write time (a sentinel comment, a dedicated section heading) — you cannot detect authorship retroactively.

**Read-back verification asserts presence AND absence.** After writing, re-read the artifact from disk (not from memory of what you intended) and assert both that the intended content is there *and* that what should be gone is gone. Presence-only checks pass happily on a file that has the new section plus the stale one it was meant to replace — a class of bug that survives every green check you have.

**Abort conditions, and the vocabulary for them.** The word is **"stop"**, and it is always paired with what to report. `stop` on its own leaves the agent holding a half-finished state with no instruction on how to explain it. Write "stop and report X" every time.

**Ambiguity is an abort, not a guess.** If two files match, if the target name is unclear, if the input could mean two things — stop, report both candidates, and ask. An agent that guesses correctly nine times out of ten has produced one silent wrong write and nine reasons nobody was watching for it.

---

## Step 5 — Write the reference files

**The `SKILL.md` is the procedure. A reference holds the schema, template, or taxonomy that would drown the steps.** That is the whole rule of thumb, and it is a load-bearing distinction: an agent executing the skill reads the steps top to bottom every time, but opens a reference only when a step sends it there. Content in the wrong place is either always-cost or never-read.

Split into `references/*.md` when the content is:

| content | goes to |
|---|---|
| a field-by-field schema or config format | `references/` |
| a copy-pasteable template or skeleton | `references/` |
| a taxonomy, enum, or long lookup table | `references/` |
| a worked example longer than the step that uses it | `references/` |
| the order of operations | stays in `SKILL.md` |
| a guard, precondition, or abort condition | stays in `SKILL.md` — always |

**Never move a guard into a reference.** A guard that must be opened to be obeyed will be skipped by the agent in a hurry, which is precisely the agent the guard exists for.

Every reference must be linked from the step that needs it, by relative path, with a sentence saying when to open it — an unlinked reference is dead weight that still costs review attention. Reference files are content, not procedure: no step spine, no frontmatter.

This skill ships one: [`references/SKILL-TEMPLATE.md`](references/SKILL-TEMPLATE.md) — the copy-pasteable skeleton for a new `SKILL.md`. **Start every new skill by copying it**, because the parts most often omitted (the negative boundary, the refusal path, the absence assertion) are exactly the parts already present in the skeleton.

---

## Step 6 — Decide whether a vendor addendum is needed

**Default: no addendum.** The agent-neutral `SKILL.md` is the one copy of the workflow (`CORE.md` §4), and an addendum is a second file that can drift from it. Add one only when a tool or platform *genuinely* differs in a way that changes what the agent types — a different shell, a different file-discovery mechanism, a native feature that must be explicitly not used.

| may appear in an addendum | never appears in an addendum |
|---|---|
| tool-name mapping (this agent's edit tool, its search tool) | any step of the workflow, restated |
| shell and path syntax for this platform | a guard, relaxed, qualified, or "simplified" |
| a native mechanism to prefer or avoid, and why | new preconditions the neutral skill does not have |
| where this agent discovers the skill from | domain content of any kind |

**An addendum that restates the workflow is a fork with a friendly name.** It will be edited independently, it will disagree with `SKILL.md`, and the disagreement will surface as an agent doing the old thing long after the procedure changed. Keep addenda to three to five bullets. If yours is longer, you are restating.

The template — four lines plus bullets:

```markdown
# {{SKILL_NAME}} — {{AGENT_NAME}} addendum

> Tool notes only. The workflow lives in `SKILL.md`.

- {{TOOL_OR_PLATFORM_NOTE}}

This addendum adapts tools only. Where it and `SKILL.md` or `CORE.md` disagree, they win.
```

**Every addendum ends with that supremacy clause**, verbatim in intent — because the file's whole hazard is being read *after* `SKILL.md` and therefore feeling like the more recent instruction. The clause is what makes the reading order irrelevant.

---

## Step 7 — Verify the skill

A skill you have only read is unverified. Verification here is the same two-part shape the skill itself must contain: a machine check and a human spot-check, and **neither one alone is sufficient** — the machine cannot tell you the steps are unfollowable, and a human read cannot reliably catch a `name` typo.

**Machine checks** (all must pass). *(Corrected 2026-08-20: this block used to call `scripts/skills/sync_claude_skills.py` and `scripts/bootstrap/check_slots.py`. **Neither script exists in this repository**, and the first of them generated `.claude/skills/` stubs, which `CORE.md` §4 forbids — every agent reads the one agent-neutral tree at `.ai/skills/`, and there is no slash-command mirror to keep in step. Until a real checker is written, these are shell one-liners and the burden is on you.)*

```bash
d=.ai/skills/<name>

# name equals directory name -- a mismatch is a skill that exists on disk and cannot be reached
grep -m1 '^name:' "$d/SKILL.md"

# no unfilled {{SLOT}} left in the skill body (references/*TEMPLATE.md keep theirs by design)
grep -n '{{[A-Z_]*}}' "$d/SKILL.md"

# every referenced file exists
grep -on 'references/[A-Za-z0-9._-]*' "$d/SKILL.md"
```

**Do not create a `.claude/skills/` or `.agents/skills/` mirror** (`CORE.md` §4). A vendor
addendum beside the canonical `SKILL.md` is the supported way to say something agent-specific
(Step 6); a second copy of the tree is a fork that drifts.

**Human spot-check — the cold run.** Hand the skill to a fresh agent (a subagent with no context from this session) and have it execute the skill against a real case, not a hypothetical. Then read the transcript for one thing: **where did it improvise?** Every improvisation is a gap in the skill — a decision the agent had to make that you did not write down. It does not matter that it improvised correctly; the next run has different odds. Close each gap and run cold again.

**Check routing explicitly.** Say the phrase a real user would say — out loud, in their words, not yours — and confirm the description would select this skill over its neighbours. If the phrase you invent is one only the skill's author would use, you have tested nothing. Then say a phrase that should route to a *sibling* and confirm the negative boundary (Step 2, part 5) sends it there.

**Register and log.** If the skill depends on content that must stay current — an external API shape, a vendor doc, a schema you do not own — add it to `docs/DOC-SOURCES.json` so drift is detectable rather than discovered. Then log the addition in `CHANGELOG.md` and add the index row in `CORE.md` §4, per `CORE.md` §5. **A skill absent from the §4 index is a skill agents will not find** — the index is how the roster is discovered, not a courtesy listing.

---

## Maintaining an existing skill

**Amend, don't fork.** When the procedure changes, edit the skill in place. Do not create `foo-v2`, `foo-new`, or `foo-improved` — two files claiming the same unit of work is the routing coin-flip from Step 0, now with the added cruelty that both files look authoritative. If the change is large enough that amendment feels impossible, that is usually Step 1 telling you the skill had two units all along: split it, and tombstone the original.

**Retire by tombstone, never by silent deletion.** An agent or a human who remembers the old step will go looking for it, and a file that simply vanished teaches them nothing except that the tree is unreliable. Leave the heading, struck through, with the date and the destination:

```markdown
## ~~Step 5 — Push the staging tag~~  *(retired 2026-03-14)*

Moved to `safe-change` — tag pushes are irreversible and need its confirmation
gate, so keeping a second copy here meant two gates to maintain and one to
forget. Use `/safe-change` with the tag as the target.
```

Tombstone a whole skill the same way: keep `SKILL.md`, replace the body with a struck-through H1, the retirement date, and where the behaviour went. Remove its row from `CORE.md` §4 in the same change so routing stops pointing at it — **a tombstone that is still listed as live is worse than either state alone.**

Tombstones are not permanent. Delete them once the CHANGELOG entry is older than anyone's working memory of the old procedure — in practice, one release cycle.

---

## Rules

1. **Refusal is the default verdict.** A procedure must clear all three gates — repeated, non-obvious failure modes, stable shape — before it becomes a skill (Step 0). Enforcement: state which gate failed and name the cheaper home for the content. A refusal without a destination just gets overridden.

2. **One unit of work per skill.** Name it in the first sentence of the description and in the H1 gloss (Step 1). If the honest summary needs "and" between two verbs with different objects, split it — a two-unit skill cannot refuse or verify coherently.

3. **Frontmatter is the routing index, not a label.** `name` equals the directory name in kebab-case — a mismatch produces a skill that exists on disk and cannot be reached — and `description` carries all eight parts in order, 8–16 folded lines, with literal trigger phrases and a negative boundary naming real sibling skills (Step 2). Elegance that costs a trigger phrase is a bug. Enforcement: the `grep -m1 '^name:'` check in Step 7, before commit.

4. **Step 0 can refuse, and the refusal is actionable.** Name the missing precondition exactly and give a copy-pasteable remedy (Step 3). A skill whose Step 0 cannot stop the run has decorative guards, because everything downstream proceeds regardless.

5. **Dry-run before commit, showing content and not just counts.** Anything that writes must show paths, counts, and sample content, then stop for confirmation (Step 4). Hand irreversible operations to `safe-change` rather than rebuilding its gate.

6. **Idempotency needs a named mechanism.** A unique key, a skip-if-present filter, a content hash, an upsert — state which one (Step 4). **"Be careful" is a wish, not a guard**, and the next agent cannot execute a wish.

7. **Stop rather than guess or clobber.** Content the skill did not author is a hard abort, reported with the path, the conflict, and the intended change — silent merges destroy the human's edit and hide that it happened. Ambiguity is the same abort: two candidates, an unclear target, or an input with two readings means stop, report both, ask (Step 4). Nine correct guesses buy one silent wrong write and no one watching for it.

8. **Verification asserts presence and absence, from disk.** Re-read the artifact and check both that the new content landed and that the superseded content is gone (Step 4). Presence-only checks pass on a file holding both versions.

9. **Guards stay in `SKILL.md`; schemas, templates, and taxonomies go to `references/`.** Every reference is linked from the step that needs it, with a sentence on when to open it (Step 5). A guard behind a link is a guard the hurried agent skips.

10. **Vendor addenda adapt tools only and end with the supremacy clause.** Three to five bullets, no restated workflow, no relaxed guard, no per-agent mirror of the skill tree (Step 6, `CORE.md` §4). An addendum that restates the workflow is a fork that will drift and win by being read last.

11. **A skill is unverified until a cold agent runs it and you have read where it improvised.** Machine checks plus the cold run, then register in `docs/DOC-SOURCES.json` if it can go stale, log in `CHANGELOG.md`, and add the `CORE.md` §4 index row (Step 7, `CORE.md` §5).

12. **Amend, don't fork; retire by tombstone.** Edit in place; when behaviour moves, leave a struck-through heading with the date and destination, and drop the §4 row in the same change (Maintaining an existing skill). Silent deletion teaches readers the tree cannot be trusted.

---

**References:** [Anthropic — Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) for the frontmatter-and-directory convention this tree follows; [Diátaxis](https://diataxis.fr/) for the procedure-versus-explanation split that separates this skill from `docs-author`; [RFC 2119 / RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) for the force of MUST and SHOULD where a skill needs them.
