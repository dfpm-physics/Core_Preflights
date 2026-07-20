# PREP v2 schema — a parallel `app` schema, then cut over

**Status:** accepted — migrations written, not yet applied to the live database

*Authored 2026-07-20 by Casey (via Claude), recording decisions made by Matthew Recker in the
PREP v2 build (migrations `supabase/migrations/app/001`–`003`, `scripts/app_migration/`).
Companion to [`PREP-V2-AUTHORIZATION.md`](PREP-V2-AUTHORIZATION.md),
[`../architecture/PREP-V2-DATA-MODEL.md`](../architecture/PREP-V2-DATA-MODEL.md), and the cutover
runbook [`../operations/PREP-V2-CUTOVER.md`](../operations/PREP-V2-CUTOVER.md).
See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It settles one question: why PREP v2 is built as a **new Postgres
> schema `app` alongside the live `public` schema, migrated and then cut over**, rather than by
> altering `public` in place. Read it before touching the `app` migration chain or the migration
> script, and before proposing that the two schemas be merged. The data-model *shape* and the RLS
> model each have their own companion doc; this one is only about the build-and-cutover strategy.

---

## 1. Problem

The `public` schema grew one feature at a time and, by July 2026, carried structural faults that
application code could no longer paper over.

- **Identifiers collide across courses.** `assignments.id` is a single global text primary key.
  When the Physics 110 builder wrote `preflight-02`, it overwrote Physics 215's `preflight-02` —
  34 assignments were flipped to the wrong course in one run, and the recovery forced a
  `phys-110-` id prefix as a workaround.
- **There is no concept of a term.** Nothing distinguishes Fall 2026 from Spring 2027, so a
  student who changes section has their whole history silently re-attributed, and last term's
  content cannot be reused without editing this term's live rows.
- **A grade has no single home.** Points are spread across `scores`, the `score` on
  `preflight_interaction_reports`, and `points` on `lesson_completions`, and nothing anywhere
  relates points earned to points possible. A retroactive rescore has already corrupted totals once.
- **Two parallel worlds, reconciled by a third.** Written `assignments` and `interactions` are
  separate top-level tables, joined after the fact by a `lessons` table and a `lesson_completions`
  layer that exists only to reconcile them.
- **The row-level security is porous.** `public` carries 62 hand-written policies; the July 2026
  audit found the roster world-readable, every finalized score readable by anyone holding the anon
  key, any signed-in account able to delete any student, and no policy preventing one student from
  overwriting another's answers. The holes exist partly because the schema offers no single join
  path from a row back to the person who owns it. The RLS rewrite that fixes this is the subject of
  [`PREP-V2-AUTHORIZATION.md`](PREP-V2-AUTHORIZATION.md).

These are not bugs to be patched individually. Four of them share one root cause — the absence of
an enrolment that ties a person to a section to a term — and fixing that root cause means changing
almost every table's shape at once.

## 2. Goals and non-goals

**Goals** — each is checkable against the shipped migrations.

- Give every piece of student work one owner reachable by a single join path (enrolment → section →
  offering), so authorization becomes two predicates rather than 62 bespoke policies.
- Make identifiers course-scoped and term-aware, so the July 2026 collision cannot recur and last
  term's content is reusable without touching this term's rows.
- Give a grade exactly one row, bounded by the offering's possible points, with an append-only audit.
- Build and prove the new schema **without touching `public`**, so the live site keeps running and a
  failed build costs nothing.

**Non-goals.**

- **The homework / quiz / exam layer.** Grading categories with weights, external gradebook links,
  and import batches are deliberately not built. `assignment_kinds` is a lookup table so adding a
  kind later is an `INSERT`, not a migration.
- **Changing the artifact↔site wire format.** The activity slug and the `schema: 1` report payload
  are frozen; v2 carries them across unchanged (§3).
- **Moving written preflights to effort grading.** They stay point-graded on migration;
  [`../architecture/LESSON-UNIFICATION.md`](../architecture/LESSON-UNIFICATION.md) D3 proposes
  effort-gating both paths, but that is a pedagogical decision and a migration is the wrong place to
  make it silently.

## 3. Constraints

Fixed, and not reopened here — see [`../../.ai/instructions/CORE.md`](../../.ai/instructions/CORE.md).

- **The frozen artifact↔site contract.** Deployed Claude artifacts post to
  `interaction-submit.html#i=<slug>`; the slug is now `activities.slug` and every shipped value
  migrates verbatim. See [`../contracts/INTERACTION-DATA-CONTRACT.md`](../contracts/INTERACTION-DATA-CONTRACT.md).
- **One production database, shared by several agents.** No concurrent DDL; the coordination gate in
  CORE.md §0 governs every mutation.
- **No build step** on the front end, and the **free-tier Supabase pause** after a week idle.
- **Live student data.** In practice the current `public` rows are test data only — Fall 2026 has
  not started — which is what makes the cutover window unusually forgiving, but the strategy must
  still hold once real work exists.

## 4. Options considered

**Option A — Alter `public` in place.** Rename and re-type the primary keys, add the enrolment and
term tables, backfill, then drop and rewrite all 62 policies, on the live schema.
*Rejected.* It rebuilds nearly every key, foreign key, and policy on a database that multiple agents
and the live site read and write concurrently. The coordination gate forbids concurrent DDL, so the
whole change would have to land as one gated, no-rollback event with the site down. There is no way
to prove the new policies and invariants before that event — the test suite would run against the
same rows it is mutating — and a mistake is discovered in production with no untouched copy to fall
back to.

**Option B — Keep `public`, fix only the RLS holes.** Leave the shape; rewrite the policies.
*Rejected.* It cannot address four of the five faults in §1, and the RLS holes themselves exist
*because* there is no owner join path. Patching policies onto a schema that cannot express ownership
reproduces the bespoke-per-table pattern that rotted in the first place.

**Option C — Build a new schema `app` alongside `public`, migrate, then cut over.** *Chosen.*

## 5. Decision

**We will build PREP v2 as a new schema `app` in the same database, prove it in isolation, migrate
content and roster into it, and cut the front end over in one switch — leaving `public` untouched as
the rollback.**

The build is gated by three database roles created in
[`../../supabase/admin/app_schema_bootstrap.sql`](../../supabase/admin/app_schema_bootstrap.sql):
`prep_app_owner` (owns `app`, holds all DDL, and is sealed `NOLOGIN` once the build lands),
`prep_app_dml` (data only, no DDL), and `prep_app_read`. The schema carries **no foreign key into
`public`**, so the two are independent and `public` can be dropped later without dangling references.
Proof comes before cutover: `app_invariant_test.py`, `app_rls_test.py`, and `app_tier_check.py` run
against the built schema, and the migration script
([`../../scripts/app_migration/migrate_public_to_app.py`](../../scripts/app_migration/migrate_public_to_app.py))
is dry-run by default and reads `public` through a `SELECT`-only window that is opened and closed
around the run.

**This decision has real costs.** Two schemas coexist for the whole transition, which is duplicated
surface to keep straight. Cutover is a discrete event that must be sequenced correctly (the runbook
exists for exactly that reason). Every frozen slug has to be carried across by hand-verified rule
rather than by the database enforcing continuity — if a deployed artifact posts to a slug the
migration drops, the break is silent until a student launches it.

## 6. Consequences

- The `app` migration chain is numbered **separately** from `supabase/migrations/*.sql`; a number in
  one chain has nothing to do with the same number in the other.
- The RLS rewrite ([`PREP-V2-AUTHORIZATION.md`](PREP-V2-AUTHORIZATION.md)) and the data-model shape
  ([`../architecture/PREP-V2-DATA-MODEL.md`](../architecture/PREP-V2-DATA-MODEL.md)) are now
  documentable independently, because the schema expresses ownership directly.
- Test data in `public` is deliberately left behind at migration — 64 training responses and their
  scores, pre-term backup reports, and orphaned analysis rows. The originals stay in `public`.
- The front-end `site/app/` portal, already built as a role-aware rewrite, becomes the schema's only
  client at cutover; the legacy `admin.html` is deleted by the promotion.
- Until cutover, `public` remains the live system and every rule in CORE.md still applies to it.

## 7. Confirmation

**How we would know this was wrong.**

- **Invariants or RLS fail.** If `app_invariant_test.py` or `app_rls_test.py` cannot pass against the
  built schema — in particular if the four named audit findings are not each closed by a test — the
  schema is not ready and cutover does not proceed.
- **A frozen slug does not survive.** The migration drops interactions no lesson claims, including one
  duplicate `lesson-02` slug. If any deployed artifact posts to a dropped slug, the frozen-contract
  assumption is false and the migration must be revisited **before students launch** — checked by
  comparing shipped artifact slugs against the surviving `activities.slug` set.
- **Cutover cannot preserve the contract URLs.** If the promotion cannot land the real pages on the
  exact stub paths (`site/student/interaction-submit.html`, `site/faculty/lessons.html`), abort the
  cutover rather than change a contract URL.

Rollback at any point before the front end is flipped is free: `public` is untouched, so reverting is
deleting schema `app`.

## 8. Open questions

- **When to drop `public`.** Not at cutover — it is the rollback. The retention window and the drop
  trigger are undecided.
- **Whether written preflights move to effort grading** (see §2 non-goals) — deferred to a separate
  pedagogical decision, one `UPDATE` per offering when made.
