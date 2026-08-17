# Student names, IDs and scores in a public repository — what may be committed

**Date:** 2026-08-17 · **Decided by:** Matthew Recker (course director) · **Executed by:** Claude
**Status:** accepted — the citation for the institutional verification is outstanding (§8)

*Companion to [`docs/findings/2026-08-13-student-pii-committed-to-public-repo.md`](../findings/2026-08-13-student-pii-committed-to-public-repo.md),
which this reclassifies. See [`CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** Read this before writing a cadet's name, ID or score into any file in
> this repository, and before acting on the 2026-08-13 finding. It settles one question: which
> student data may be committed to a world-readable repo, and what is done about what is already
> in git history. It supersedes the blanket no-student-PII rule in `CORE.md` §3 and in
> `docs/findings/README.md` **as applied to names, cadet IDs and scores** — and only those.

---

## 1. Problem

`CORE.md` §3 and `docs/findings/README.md` both stated a blanket rule: no student PII in a
committed file, naming the CHANGELOG explicitly.
Both treated a cadet's name, their ID and their score as the same category of protected data.

On 2026-08-13 an audit found the rule had been violated across roughly two months of CHANGELOG
entries and one test fixture, and wrote it up as a FERPA exposure requiring an institutional
disclosure determination.
That finding's §6.1 placed the disclosure question with the course director and stated plainly that
it was not an engineering call.

Two things followed from leaving it unresolved.
The repo carried a rule that its own operators had violated ~40 times, which is the condition
`CORE.md` §0 already names as fatal to a rule: one everybody can see is not being followed stops
being read as a rule.
And a finding sat open assigning work — history rewrite, repo-privating — that nobody was
authorized to do, so the working tree stayed unredacted while the question was pending.

## 2. Goals and non-goals

**Goals.**
A rule an operator can apply without asking anyone, at the moment of writing a CHANGELOG line.
A rule a script can check, so it is not enforced by memory alone — the root cause the finding's §2
identified.
A recorded answer for what happens to the values already in git history, so the next operator does
not re-discover this and re-open it.

**Non-goals.**
This does not decide what an *artifact* or an *export* may contain — the JSON gradebook backup and
the Blackboard CSV carry names by design and are downloaded by staff, not committed.
This does not revisit RLS, which is the actual access control on student records and is unchanged.
This does not classify instructor or staff names.

## 3. Constraints

- **`CORE.md` §0 forbids force-push**, without exception, and a history rewrite requires one.
- **GitHub Pages on a private repository requires a paid GitHub plan.**
  The org's plan was not confirmed, so making the repo private carried a risk of taking the live
  site down mid-term — the finding's §4 flagged this and it was never resolved.
- **`docs/`, `scripts/`, `supabase/` and `tests/` are already publicly readable**, verified
  2026-08-07 (`CORE.md` §2). Only `_`-prefixed paths are excluded, by default Jekyll.
- **The institutional determination is not an engineering call.** Per the finding's §6.1, whether
  student education records in a public repo require notification belongs to USAFA/DFPM.

## 4. Options considered

**(a) Keep the blanket rule and remediate the past.**
Treat name, ID and score alike as protected; redact the working tree; rewrite history or make the
repo private; notify if the institution required it.
Rejected because the premise turned out to be wrong: the institution's guidance, received and
verified by the course director, does not classify these three fields as protected here.
Remediating history against a rule stricter than the governing one would have cost a force-push
that `CORE.md` §0 forbids, invalidated every clone and fork, and destroyed the record of what was
exposed — for data that is not, in fact, restricted.

**(b) Drop the rule entirely.**
If names, IDs and scores are not PII, stop constraining them.
Rejected because "not legally protected" and "belongs in a public changelog" are different claims.
A cadet's name in an entry about their missed deadline is a durable, search-indexed, world-readable
statement about a named person that serves no operational purpose an ID would not serve.
The ID is also the better engineering choice: it is the join key, it is unambiguous where two
cadets share a surname, and it does not need re-editing when someone's name changes.

**(c) Reclassify, and keep a hygiene rule with a machine behind it.** — chosen.

## 5. Decision

We will treat a cadet's **name, cadet ID and score as not PII in this system**, per institutional
guidance received (citation to be added by Casey, who had the conversation), and enforce a narrower standing
rule instead: **a student's name never appears where an ID suffices.**

What stays barred, unchanged and for different reasons:

| Still never committed | Why |
|---|---|
| Service keys, DB passwords, connection strings, `.env` contents | Credentials. `CORE.md` §3 |
| A student's **name**, in any committed file, where the cadet ID carries the same meaning | This decision's standing rule |
| Free-text student writing — Q3 answers, showcase quotes, reflections — paired with an identity | Not covered by the determination; it is the student's own work, not a roster field |
| Internal absolute paths | Unchanged from `docs/findings/README.md` |

**Cadet IDs and scores are permitted** in the CHANGELOG, in `docs/`, in `scripts/` and in test
fixtures.
A *fixture* still gets a synthetic name, because a fixture's name is decorative — nothing is tested
by it being someone's — and a file that looks synthetic and is not survives every redaction pass
done by eye, which is exactly how `tests/app-schema/test-lesson-due.mjs` kept two real names.

**Git history is accepted as-is.**
No rewrite: `CORE.md` §0 forbids force-push and this decision removes the reason to seek an
exception.
No repo-privating: the org's plan is unconfirmed and the live site is mid-term.
This is option **(c)** of the finding's §6.4 — accept, document, move on — chosen with (a) and (b)
of that section considered and rejected above.

**What we are accepting by choosing this.**
Every value already committed stays publicly fetchable by commit SHA, permanently, and the
determination that permits this rests on guidance whose citation is not yet in the repo (§8).
If that guidance is later revised, the working tree is clean but history is not, and we will be in
exactly the position §6.4 described with two months more history on top.

## 6. Consequences

- **`CORE.md` §3** loses its blanket PII bullet and gains the name-vs-ID rule, linking here.
- **`docs/findings/README.md`** loses "No student PII. None." and gains the same standard.
  "Ship the query, not the rows" survives untouched — it was always the better argument, and it is
  about a finding staying true as the data changes, not about disclosure.
- **The 2026-08-13 finding closes**, reclassified rather than fixed, and is pruned per its own §7.
- **`scripts/checks/name_scan.py`** is the machine the finding's §6.2 asked for, narrowed to the
  rule that survived. It reads the roster live, holds it in memory, and never prints a name.
- **A name-hygiene sweep was run on 2026-08-17.** Live roster (958 `app.students` rows, 876
  enrolled-and-provisioned after the synthetic blocks are excluded) cross-referenced against every
  tracked file. Confirmed real cadet names appeared on **32 lines across 5 files**, naming **13
  individuals** — three more files and ten more people than the finding's ID-anchored search had
  found, because its sweep could not see a name written without a number beside it.
- **Two of those files are `site/js/util.js` and `site/js/faculty-admin.js`**, where a real cadet's
  name is the worked example in a code comment about surname suffixes. They were out of the sweep
  operator's scope and are still to be redacted.

## 7. Confirmation — how we would know this was wrong

**Signal:** the course director receives written institutional guidance — a revised DFPM/USAFA
privacy instruction, a FERPA determination, or a records-custodian ruling — that contradicts the
verification recorded here and classifies cadet name, ID or score as protected in this context.

**Threshold:** any such statement in writing. One is enough; this is not a matter of degree.

**Consequence:** the course director reopens
`docs/findings/2026-08-13-student-pii-committed-to-public-repo.md`, this doc's status becomes
`superseded by` its replacement, and the §6.4 history options — including the force-push exception
`CORE.md` §0 would then require — go back on the table with two months more history in scope.

**A second, cheaper signal:** `scripts/checks/name_scan.py` exits non-zero on a tree that was clean
at the previous run. That does not falsify this decision; it means the standing rule was broken,
and the operator who broke it redacts before committing.

## 8. Open questions

- **The citation for the institutional verification is not in this document.** It is recorded here
  as *per institutional guidance received (citation to be added by Casey, who had the conversation)*.
  Until the director supplies it, §5 rests on an unpublished source, and §7's falsifier cannot be
  evaluated against anything — there is nothing to compare a revision to.
  **This is the one open item that blocks the doc from being complete.** Owner: **Casey** —
  the institutional conversation was Casey's, so the citation is Casey's to supply
  (reassigned from the course director 2026-08-17).
- **Instructor and staff names are unclassified.** `tests/app-schema/test-lesson-due.mjs` used a
  cadet's name as a *staff*-name example, which is how the question surfaced. Nothing here decides
  whether an instructor's name may be committed. Owner: course director.
- **Whether the repo has ever been forked, cloned or crawler-indexed** is still unknown, as the
  finding's §4 recorded. It does not change this decision, and it would matter to the §7 reopening.
