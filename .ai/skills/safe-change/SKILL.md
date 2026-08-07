---
name: safe-change
description: >
  IRREVERSIBLE-CHANGE GATE — governs exactly one hard-to-undo change: one
  deletion, migration, bulk write, publish, or rotation. Reads
  `.ai/instructions/CORE.md` §0 (the safety floor), §3 and §5, the target
  store or repo, and any existing snapshot; writes the snapshot, the run
  record, the change itself, and a `CHANGELOG.md` entry. Use when the user
  wants to remove, overwrite, ship, or revoke something others can already see.
  Triggers: "delete", "drop", "migrate", "bulk update", "backfill", "rewrite
  history", "force push", "rotate the key", "revoke", "clean up", "prune",
  "reset", "publish", "deploy", "release", /safe-change. NOT a code-review
  skill — it judges only whether the change is recoverable, never whether it is
  correct or wise; use `/code-review` for correctness. NOT `docs-author`, which
  writes the design doc arguing for the change and runs first for a one-way
  door. Run it BEFORE the mutating command — a gate afterward is a postmortem.
  Requires that recker asked for this run and is present to answer, plus a
  clean tree, an undiverged branch, and no second agent in this working tree.
  Argument: the change to be gated, stated as a target plus a verb.
---

# safe-change — establish the undo path before you make a change you cannot take back

> This skill owns *recoverability*, and nothing else. It does not decide whether a change should happen — that is a human's call, or a design doc (`docs-author`). It does not decide whether the change is correctly implemented — that is code review. It decides one thing: **if this turns out to be wrong, can you get back?** A change that is a good idea, correctly written, and unrecoverable still fails this skill.

Where this skill and `CORE.md` disagree, `CORE.md` wins.

---

## Does this skill apply?

Gated changes. Each of these mutates something you cannot restore by editing a file:

| change class | verdict |
|---|---|
| deleting or truncating data | gated — no undo command exists; the row is gone at commit, and a snapshot (Step 1) is the only path back |
| bulk-updating records | gated — the pre-image is overwritten in place, so the undo path is the snapshot or nothing |
| schema or DDL changes | gated — a dropped column takes its data with it, and "add it back" restores the shape, not the contents |
| rewriting git history or force-pushing | gated — reflogs are local and expire; every clone that already fetched the old history now disagrees with the remote |
| publishing, deploying, or releasing | gated — you can ship a newer version, but you cannot unship the one people already pulled |
| rotating or revoking a credential | gated, and specially — see the rotation note in Step 1; exposure has no undo at all |
| changing a public URL, wire format, or API contract | gated — callers you do not control are already bound to the old shape, and their breakage surfaces on their schedule |
| deleting files outside the working tree | gated — outside the tree there is no `git checkout` to undo you |
| changing permissions or access rules | gated — a widened permission may have been used before you narrow it again, so the undo restores the rule and not the consequence |
| anything touching `{{SHARED_STATE}}` | gated — by definition someone else is reading it, and their read of your half-finished write is not recoverable by you |

Ungated changes. **Running this procedure against one of these is itself a failure mode:**

| change class | verdict |
|---|---|
| an ordinary code edit on a branch | not gated — `git checkout` is the undo |
| a documentation change | not gated — same |
| adding a test | not gated — the worst case is a red build, which is information |
| a local experiment in a scratch directory | not gated — nothing outside the directory can see it |

The reason to be strict about that second table is not speed for its own sake. Amazon's framing is the useful one: Type 1 decisions are near-irreversible and deserve deliberation, Type 2 decisions are reversible and do not, and applying the heavy process to the light case produces slowness and unthoughtful risk aversion rather than safety ([2015 letter to shareholders](https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders)). **Ceremony spent on a cheap decision is ceremony unavailable for an expensive one** — an operator who has confirmed six pointless gates this week will confirm the seventh without reading it, and the seventh is the one that drops the table.

---

## One-way doors and two-way doors

The question is never "is this dangerous". Danger is a feeling and it calibrates badly — routine operations feel safe on the hundredth run, and the hundredth run is where the wrong `WHERE` clause lands. **The question is: what does undo cost?**

Three-part test, in order. Apply it before anything else:

1. **Can it be undone by a command?** A revert, a re-deploy of the previous artifact, a flag flipped back. This is a two-way door. Proceed with ordinary care; you do not need the rest of this skill.
2. **Can it be undone from a snapshot?** The old state exists somewhere outside the thing being changed, and you can prove it. One-way door with a mitigation. **This skill exists for exactly this case.**
3. **Can it only be undone by rebuilding from a source that still exists?** A re-import, a re-derivation, a regeneration from an upstream that has not itself moved. Slowest and weakest — the rebuild reproduces the state, not the history, and anything that happened between build and rebuild is lost.

**A change with no answer to any of the three is not gated — it is refused.** Do not proceed and do not improve the odds. Say plainly that no undo path exists, name which of the three could be created and how, and stop. Google's SRE practice puts the same weight on this: the ability to roll back is a property you build before the change, not a heroic act you improvise during the incident ([Google SRE Book, *Release Engineering*](https://sre.google/sre-book/release-engineering/)).

---

## Step 0 — Establish the blast radius before you touch anything

Write down four facts, in the transcript, before any mutating command is composed:

1. **What will change** — the exact table, path glob, endpoint, ref, or key. Not the feature it belongs to. The thing the write lands on.
2. **How many of it** — an **exact count from a read-only query**, run now, against the real target. Not an estimate, not the number from the last run, not the number the user said.
3. **Who can see it** — which humans, services, caches, or clones read this state today.
4. **What depends on it downstream** — foreign keys, consumers of the wire format, jobs that poll it, a public URL someone bookmarked.

**An agent that cannot state the count must not proceed.** "Some rows", "a handful of files", "the stale ones" — these are not blast radii. **A change whose scope you cannot measure is a change whose damage you cannot measure either**, which means Step 5 has nothing to verify against and Step 1 has no way to know whether the snapshot covered the right set. The count is not paperwork. It is the control value for every check that follows.

Then confirm the four preconditions from `CORE.md` §0 and §5:

| check | if it fails |
|---|---|
| recker asked for **this** run and is present to answer a question about it | stop — the standing authorization in `CORE.md` §5 covers **commit and push only**. It does not reach a delete, a history rewrite, or a publish, and an irreversible change nobody asked for is not gated, it is unauthorized |
| no second agent is working in this tree, and no script or job is mid-run against the same target | stop — report what is running and wait for it to close |
| the branch is not diverged from `origin/main` | stop — report the divergence; reconciling it *during* a destructive run is how two half-changes merge |
| the working tree is clean | stop — report the dirty paths; uncommitted work is state with no snapshot |

> **This project has one operator and no shared state**, so `CORE.md` §0's designate-an-operator
> step was pruned at bootstrap. The first row above is what survives of it, and it is not a
> formality: **the guard was never "which of several people owns this" — it was "is a human
> attending this run at all".** That question has teeth in a solo project exactly as it does in a
> crowded one.

---

## Step 1 — Prove the undo path exists

Take the strongest available option. Do not settle downward silently — if you drop from (1) to (3), say so, because the operator's willingness to approve usually depends on which one you are relying on.

**Preference 1 — a reversible operation.** Prefer the shape that undoes by command over the shape that undoes by restore. Soft-delete instead of delete. A new version alongside the old instead of an in-place overwrite. An additive migration now and the drop in a later change, once nothing reads the column. **The cheapest undo path is the one you designed in, not the one you recovered to.**

**Preference 2 — a snapshot.** Three requirements, and all three are load-bearing:

- **Take it before the change.** Obvious, routinely skipped under time pressure, and unrecoverable when skipped.
- **Write it outside the thing being changed.** A snapshot in the same table, the same bucket prefix, or the same branch you are about to rewrite shares a failure mode with its subject. Use `{{SNAPSHOT_COMMAND}}`, landing in `{{SNAPSHOT_DIR}}`.
- **Verify it against live counts.** Re-read the snapshot and compare its row or file count, and its scope, to the Step 0 count. **An unverified snapshot is not a backup — it is a file.**

> **The failure story.** The snapshot that was empty, or covered the wrong scope, or captured a filtered subset because the export inherited a `LIMIT`, is discovered at exactly one moment: the moment it is needed. There is no earlier signal. That is why verification is a step and not a virtue — nothing else in the process will ever test it.

**Preference 3 — a rebuild source.** Name the source, confirm it still exists and has not itself moved, and state plainly what a rebuild would *not* recover: edits made since, generated ids, timestamps, anything human-authored downstream.

**Credential rotation is different, and worth naming separately.** You cannot un-expose a secret. If a key has leaked, it is compromised for as long as it is valid, and rotation does not reach backward. **The undo path for a credential is revocation plus an audit of everything the old credential could reach** — every service that accepted it, every store it could read, every action it could take, checked for use you did not authorize. Rotating without the audit closes the door and leaves whatever came through it inside. See `CORE.md` §3 for where secrets live and what may reference them.

---

## Step 2 — Dry-run, and make the dry-run trustworthy

**Every mutating script is dry-run by default and requires an explicit `--commit` to write.** The flag is the gate. A script that writes when invoked with no arguments will eventually be invoked with no arguments — by a shell history recall, by a copy-paste that lost its tail, by an agent reconstructing a command it saw once.

Then the sharper rule, the one that is actually skipped: **a dry-run that does not exercise the same code path as the commit is theatre.** The dry-run must build the exact same payload the commit would write, and print it. If it computes the plan one way and the commit executes it another — a different query, a different filter, a hand-written summary of intent rather than the real object — **it proves nothing about what will happen.** It only proves that a description of the change is printable.

Read the output. Then check it, in this order:

1. **Does the count match Step 0?** If not, **stop.**
2. **Does the sample content look like what you meant to write?** Not "does it look reasonable" — does it match the intent you stated.
3. **Is the skip count explained?** Every record not being touched should be excluded for a reason you can name (Step 3).

**If the numbers disagree, do not reconcile them by adjusting the expectation.** That is the single most common way a gated change goes wrong: the dry-run says 4,812 and you wrote down 4,700, and the path of least resistance is to decide the estimate was loose. It might have been. It might also be that your filter is missing a clause and 112 rows belonging to someone else are inside the blast radius. **The disagreement is data. Find the cause before you find the reassurance.**

---

## Step 3 — Make it idempotent, or make it refuse to run twice

**Re-running is the normal case, not the exception.** An interrupted run is resumed far more often than it is rolled back — the connection drops, the token expires, the operator's laptop sleeps — and the resumed run starts by re-covering ground the first run already touched. Design for that, because it is what will happen.

Name the mechanism. **Never write "be careful".**

| mechanism | use when |
|---|---|
| unique key on the target record | the store can enforce it for you |
| skip-if-present filter on a stable identifier | you can test existence cheaply before writing |
| conditional guard at the write layer (`WHERE status = 'pending'`) | the write itself can express the precondition |
| recorded run id, checked at start | the operation is not naturally idempotent and must refuse a second pass |

If none of these is available, the change must **refuse to run twice** rather than silently double-apply — a hard failure on the second invocation is a correct outcome and a duplicated write is not.

**Never overwrite human work.** Whatever marks a record as human-authored, reviewed, finalized, or locked is **filtered out before the write**, not checked afterward. And the count of what was skipped is **reported, not silently dropped** — a run that quietly declined to touch 340 records has told you something important about your filter, and swallowing that number throws away the only evidence. Skipped counts belong in the dry-run output (Step 2), in the run record (Step 4), and in the CHANGELOG entry (Step 6).

---

## Step 4 — Execute, narrowly

**Smallest scope that accomplishes the goal.** If the task is one tenant, the query names one tenant. If it is one directory, the glob does not end at the parent. A command that would also work on a wider scope is a command that will eventually be run on the wider scope.

**One unit at a time, where the unit is meaningful** — one record, one file, one migration step. Not one arbitrary chunk of a thousand.

**Do not fan out parallel workers against shared mutable state.** Parallelism buys wall-clock time, which a careful change does not need, and it charges for that time in a currency you cannot afford: **it turns one recoverable failure into several interleaved ones.** Serial failure leaves a prefix — everything before position N succeeded, everything after did not, and the resume point is a single number. Parallel failure leaves a set you must reconstruct by inspection, at the exact moment you are least equipped to inspect anything.

**Record the run.** Open a record in `{{RUN_LOG}}` with status `running` **before** the first write; close it with a final status and the counts after the last one. The ordering is the whole point — a record written after success only ever describes successes.

**A run that dies without closing its record leaves `running`, and that is correct.** That is not a bug to be cleaned up. It is how an abandoned run becomes visible, and it is the only signal that distinguishes "this finished" from "this stopped somewhere in the middle and nobody noticed". **Do not tidy up a stale `running` record on a later run.** Report it. A later run that sweeps stale records is a later run that erases the evidence of the earlier failure, and it will do so at machine speed across every incident you have.

---

## Step 5 — Verify by reading back

**Re-read what you wrote, from the target, with the same projection** — not from memory of what you intended to write, and not from the return value of the write call. The write call reports what the client sent. Verification is about what the store now holds.

**Assert presence and absence both:**

- the records you meant to write are there, with the values you meant;
- the records you meant to skip are **not** touched — same values as before, and the skip count matches Step 3.

Presence-only verification passes happily on a run that wrote the right 4,812 rows *and* clobbered 112 it should never have seen. The absence assertion is the only check that catches an over-broad filter, and an over-broad filter is the most common way a correct-looking script does damage.

Then a **human spot-check of one real case, end to end.** Pick an actual record, follow it through to wherever a person or a downstream system would see it, and look at it. **Machine count plus human sample; never one alone** — the count cannot tell you the values are garbage, and the sample cannot tell you the run covered its scope.

**If verification fails, stop and report both numbers** — what you expected and what you found, with the query that produced each. **Do not re-run to "fix" it.** A second run against a state you no longer understand is precisely how a recoverable problem becomes an unrecoverable one: the first run's damage is bounded and described by the run record, and the second run's damage is neither. Restore from the snapshot (Step 1) or hand the state to a human. Those are the two options.

---

## Step 6 — Record it

Add the `CHANGELOG.md` entry per `CORE.md` §5, in the same change. It carries four things:

- **what** changed — the target, the operation, the scope.
- **why** — the reason, in one sentence, so a future reader can evaluate the decision and not just the diff.
- **the counts** — intended, written, skipped. The numbers from Steps 0, 2, and 5.
- **what you deliberately did not do** — the part everyone omits.

**State what you skipped.** Explicitly, by count and by reason. **A run that silently does less than asked is worse than one that refuses**, because a refusal is visible and a shortfall is not: the operator believes the job is done, the remaining work is invisible until something downstream breaks, and by then nobody connects the breakage to a run that reported success. If you gated on 4,812 records and wrote 4,700 because 112 were human-authored and filtered by Step 3, the entry says so.

Where the change was to a contract — `CORE.md`, `PROJECT.md`, a wire format, a public URL — the CHANGELOG entry is the minimum, not the whole obligation. Every agent in the repo is acting on the current text, so name the sections that moved.

Push only when asked (`CORE.md` §5).

---

## Abort conditions

Stop and report. The word is **stop**, and it always comes with what to report — an abort that leaves the operator without the facts costs a round-trip and teaches them to route around the gate.

| condition | report |
|---|---|
| counts disagree between Step 0 and the dry-run | both numbers, and the two queries that produced them |
| the snapshot cannot be verified, or is empty | the snapshot path, its count, the live count, and that no undo path currently exists |
| a Step 0 precondition (`CORE.md` §0, §5) cannot be satisfied | which of the four checks failed, and its exact state |
| the request is ambiguous about scope | both candidate scopes, with the count for each |
| no undo path exists under any of the three tests | which of the three could be created, and the command that would create it |
| a competing agent or process is active | what it is, what it is touching, and when it started |
| the credential in hand has more privilege than the task needs | what the task needs, what the credential grants, and the narrower credential to use instead |

**Ambiguity is an abort, not a guess.** When a request could mean two scopes — "clean up the old records", "delete the test data" — **the cost of asking is one message and the cost of guessing is the larger scope.** That asymmetry does not improve with confidence. An agent that guesses correctly nine times in a row has produced one silent over-broad delete and nine reasons nobody was watching for it.

The narrower-credential row is not a courtesy. If the task reads one table and the credential can drop the schema, then a bug in your filter has the schema inside its blast radius — the Step 0 radius you wrote down was never the real one.

---

## A note on unattended runs

Step 0 requires that a human asked for this run and is present to answer, and that no competing run is active. **An unattended job can satisfy neither.** An absent human cannot be asked, and a scheduled job cannot observe an agent that started after it was scheduled. This is a structural gap, not an implementation detail to be tightened later.

What a preflight provides — a clean tree, no divergence, a reserved time slot, a lock file — is a **mitigation, not a substitute.** It narrows the window in which a collision can occur; it does not close it, and it cannot supply the human judgement Step 0 is asking for.

Two consequences:

1. **Never schedule a gated change against a repo or a store another agent is working in.** The preflight will look clean at 03:00 and say nothing about the agent that started at 03:01.
2. **An agent may not widen its own authorization.** If a standing authorization covers deploys and the job now wants to run a migration, that is not an inference the skill gets to make. **It is an edit to `CORE.md` §5 by a human.** An agent that reasons its way from "I am allowed to do X" to "therefore I am allowed to do the adjacent X′" has replaced the authorization mechanism with its own judgement about what the authorizer would have said — and the whole point of writing authorizations down is that nobody has to guess that.

---

## Rules

1. **This skill gates recoverability, not merit.** Whether the change is a good idea is a human's call or a design doc (`docs-author`); whether it is correctly written is code review. Enforcement: if your objection is "this seems unwise", say so and hand it back — do not express it as a failed gate, because a gate that fires on taste stops being trusted on safety.

2. **Apply it only to one-way doors.** The gated and ungated tables are the boundary (Does this skill apply?). Enforcement: running the full procedure against a branch edit is a failure mode, not diligence — ceremony spent on cheap decisions is ceremony unavailable for expensive ones.

3. **No undo path means refused, not gated.** Run the three-part test — command, snapshot, rebuild source — and if none answers, stop and name which one could be created (One-way doors and two-way doors). A change you cannot reverse and cannot restore is not made carefully; it is made once.

4. **An exact count, or you do not proceed.** The blast radius is a read-only query run now against the real target, not an estimate and not last run's number (Step 0). **"Some rows" is not a blast radius** — and a scope you cannot measure is damage you cannot measure.

5. **All four preconditions are checked before the first mutating command is composed.** A human asked for this run and is present, no competing run, no divergence, clean tree (Step 0, `CORE.md` §0 and §5). Enforcement: all four, every time; a precondition discovered mid-write is a half-finished state nobody planned.

6. **An unverified snapshot is not a backup — and rotation undoes nothing.** Take the snapshot before the change, write it outside the thing being changed, and check its count and scope against live, because nothing else in the process ever tests it: the next test is the restore, and by then it is too late. Credentials are the exception that proves the rule — you cannot un-expose a secret, so the undo path is revocation **plus an audit of everything the old credential could reach** (Step 1, `CORE.md` §3). Rotating without the audit closes the door on whatever is already inside.

7. **Dry-run by default, `--commit` to write, same code path both ways — and never reconcile a disagreement by adjusting the expectation.** The flag is the gate, and **a dry-run that computes the plan differently from how the commit executes it is theatre** (Step 2). When the dry-run and Step 0 disagree, the cause is either a loose estimate or a filter reaching further than you think, and you cannot tell which by preferring the comfortable answer. Enforcement: the dry-run builds and prints the exact payload the commit would write; a count mismatch stops the run.

8. **Idempotency needs a named mechanism, and human work is filtered before the write.** A unique key, a skip-if-present filter, a conditional guard, a recorded run id — pick one and name it; then exclude whatever marks a record as human-authored and **report the skip count rather than dropping it** (Step 3). Re-running is the normal case, not the exception.

9. **Serial, narrow, and recorded — open the run record before the first write.** Smallest scope, one meaningful unit at a time, no parallel workers against shared mutable state (Step 4). **A stale `running` record is correct and must not be tidied up** — it is how an abandoned run becomes visible, and sweeping it erases the only evidence.

10. **Verify by reading back, asserting presence and absence, then stop on failure.** Machine count plus one human spot-check end to end; if they disagree, **report both numbers and do not re-run** (Step 5). A second run against an unknown state is how a recoverable problem becomes an unrecoverable one.

11. **Record what you skipped, not just what you did.** The CHANGELOG entry carries what, why, the counts, and the work you deliberately left undone (Step 6, `CORE.md` §5). **A run that silently does less than asked is worse than one that refuses** — a refusal is visible, a shortfall surfaces months later as an unexplained gap.

12. **Ambiguity is an abort, and an agent never widens its own authorization.** Two possible scopes means stop and report both with counts (Abort conditions); a standing authorization that needs to cover more is a human's edit to `CORE.md` §5, never an inference by the skill (A note on unattended runs).

---

**References:** [Amazon 2015 letter to shareholders](https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders) for the one-way / two-way door framing that decides whether this skill applies at all; [Google SRE Book — *Release Engineering*](https://sre.google/sre-book/release-engineering/) for rollback as a property built before the change rather than improvised during the incident; [RFC 2119 / RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) for the force of MUST and SHOULD where a guard needs them.
