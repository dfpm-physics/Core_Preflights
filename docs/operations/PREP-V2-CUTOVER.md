# PREP v2 cutover — bootstrap, migrate, promote

**Status:** **Phases 1–3 are DONE against the live database. Phase 4 has not run.**
*(Corrected 2026-07-27 — this line read "not yet executed against the live database" until then,
which stopped being true around 2026-07-21 and was the roadmap's P0.1 note that nobody had actioned.
Anyone reading it since has been told the schema does not exist yet.)*

| Phase | State |
|---|---|
| 1 — bootstrap schema and roles | **Done.** `app` exists; the three `prep_app_*` roles exist |
| 2 — invariant + RLS suites | **Done.** Both green (22/22 and 35/35, 2026-07-22) |
| 3 — migrate content and roster | **Done.** `app` holds the real Fall 2026 content and roster; the chain is applied through `015` |
| 4 — promote the front end | **NOT RUN.** This is the live cutover, and the one-way step |

**What "done" does and does not mean.** `site/app/` is a complete portal already reading and writing
`app` (`site/app/js/config.js` binds `db: { schema: 'app' }`). What has not happened is putting it
on the URLs people visit. Until Phase 4 runs, students and instructors are still pointed at the
legacy pages at `site/*.html`, which read `public`.

**Two things below are stale in a way worth knowing before you follow them:** the chain in step 2
now runs past `003` to `015`, and step 11 ("seal the owner") has been done and undone several times
since — `prep_app_owner` is unsealed whenever a migration is applied and must be re-sealed after.
Roadmap **P0.2** is the standing item to seal it for good.

*Authored 2026-07-20 by Casey (via Claude). Operational companion to
[`../decisions/PREP-V2-SCHEMA.md`](../decisions/PREP-V2-SCHEMA.md) (why a parallel schema),
[`../decisions/PREP-V2-AUTHORIZATION.md`](../decisions/PREP-V2-AUTHORIZATION.md), and
[`../architecture/PREP-V2-DATA-MODEL.md`](../architecture/PREP-V2-DATA-MODEL.md).
See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It is the ordered procedure to stand up schema `app`, migrate `public`
> into it, and promote the `site/app/` front end onto it — the operational half of the PREP v2
> decision. It is a runbook, not a help page: it names database roles, SQL run as `postgres`, and
> scripts, none of which may appear in a public help doc. Run it as a **single designated operator**
> with no other agent mutating the database (CORE.md §0). Every step is reversible until Phase 4;
> before then, rollback is dropping schema `app`, because `public` is never touched.

---

## Before you start

- **Coordination gate (CORE.md §0).** One operator. Confirm no other agent or script is mid-run.
  `git fetch` and confirm your branch has not diverged. Never force-push.
- **Credentials.** `postgres` (owner-level, Supabase SQL Editor) for the role and `auth` steps;
  `supabase/admin/config.json` for the tiered app roles the Python scripts use. Never commit either.
- **Snapshot posture.** Nothing here writes to or drops `public`. The migration script reads `public`
  through a `SELECT`-only window and is dry-run by default. The destructive step (dropping `public`)
  is explicitly **out of scope** — see the closing note.
- **Read first:** the three companion docs above, and the header comments of
  [`../../supabase/admin/app_schema_bootstrap.sql`](../../supabase/admin/app_schema_bootstrap.sql)
  and [`../../scripts/app_migration/migrate_public_to_app.py`](../../scripts/app_migration/migrate_public_to_app.py).
  The SQL files are authoritative; if a step here disagrees with them, they win and this doc is the
  bug.

---

## Phase 1 — Bootstrap the schema and roles

1. **Create the roles and schema.** In the Supabase SQL Editor as `postgres`, run
   `app_schema_bootstrap.sql`. It creates `prep_app_owner` (owns `app`, holds all DDL),
   `prep_app_dml` (data only, no DDL), and `prep_app_read`, and grants rights **on `app` only** —
   none of these roles is granted anything on `public`. Replace the three `REPLACE_ME_*` passwords
   first, and record them where `supabase/admin/config.json` expects them. Running as `postgres`
   requires `SET ROLE` membership on `prep_app_owner` for the two statements the script flags.
2. **Apply the migration chain** as `prep_app_owner`, in order, from `001_core_model.sql` through
   the highest-numbered file in `supabase/migrations/app/` — `001` → `002` → `003` was the chain
   when this was written; it now runs to `015`, and `016` is filed unapplied. This chain is numbered
   independently of `supabase/migrations/*.sql` (the `public` chain); the numbers do not correspond.
3. **Add the `auth.users` foreign keys** (bootstrap §6) as `postgres`. `students.auth_user_id` and
   `instructors.id` are declared as plain `uuid` columns because `postgres` cannot delegate
   `REFERENCES` on `auth.users` to the app owner; `postgres` creates those two constraints itself.

**Verify Phase 1** with [`../../supabase/admin/app_tier_check.py`](../../supabase/admin/app_tier_check.py):
each role connects and holds exactly the privileges it should, and no more.

## Phase 2 — Prove it before any data moves

4. **Run the invariant suite** —
   [`../../supabase/admin/app_invariant_test.py`](../../supabase/admin/app_invariant_test.py). It
   asserts the structural guarantees (one grade per enrollment/offering and bounded by its points, one
   submission per enrollment/offering, the gradable and lock triggers, the attributable unlock).
5. **Run the RLS suite** —
   [`../../supabase/admin/app_rls_test.py`](../../supabase/admin/app_rls_test.py). It must show the
   `anon` role reads nothing, and that a student cannot read or write another student's rows. The
   four July 2026 audit findings each have a test here; all must pass. **If any test in Phase 2
   fails, stop** — the schema is not ready and cutover does not proceed
   ([`../decisions/PREP-V2-SCHEMA.md`](../decisions/PREP-V2-SCHEMA.md) §7).

## Phase 3 — Migrate content and roster

6. **Open the migration read window** (bootstrap §8) as `postgres`. This is the one time the app
   owner may read `public`, and it is `SELECT`-only:

   ```
   GRANT USAGE ON SCHEMA public TO prep_app_owner;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO prep_app_owner;
   ```

7. **Dry-run the migration.** Run `migrate_public_to_app.py` with no flags. It prints the full plan —
   counts per table, and an explicit list of what it deliberately leaves behind (the 64 training
   responses and their scores, pre-term backup reports, orphaned analysis rows) — and writes nothing.
   Read the plan. Confirm the "deliberately not migrated" list is only test data.
8. **Verify the frozen-slug decision before committing.** The migration keeps an interaction **only if
   a lesson claims it**, which drops one duplicate `lesson-02` slug. Confirm no deployed artifact
   posts to a dropped slug — compare shipped artifact slugs against the surviving `activities.slug`
   set. If any shipped artifact targets a dropped slug, **do not commit**; revisit the migration
   (this is a frozen-contract question, per the schema decision §7).
9. **Commit the migration** — re-run with `--commit`. The whole run is one transaction and is
   idempotent; re-running after a commit changes nothing.
10. **Close the read window** as `postgres`, immediately:

    ```
    REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM prep_app_owner;
    REVOKE USAGE  ON SCHEMA public              FROM prep_app_owner;
    ```

11. **Seal the owner** (bootstrap §7): `ALTER ROLE prep_app_owner NOLOGIN;` once the build is done, so
    it cannot connect until a human deliberately re-enables it for the next schema change.

## Phase 4 — Promote the front end (the one-way step)

Everything above is reversible by dropping schema `app`. This phase changes the live site.

12. ~~**Point the front end at `app`.**~~ **Done.** `site/app/js/config.js` binds the client to
    `db: { schema: 'app' }`; every query from `site/app/` goes to the v2 model.
13. **Promote the app tree** so the real pages land on the frozen contract paths
    `site/student/interaction-submit.html` and `site/faculty/lessons.html`, overwriting the
    forwarding stubs. **The public URLs must be identical before and after** — if the promotion
    cannot preserve them exactly, abort rather than change a contract URL.

    **Use `scripts/promote_app.py`.** It is dry-run by default and refuses to run on a dirty tree, a
    non-`main` branch, divergence from `origin/main`, or a missing frozen-contract source. It plans
    **98 individual file moves** rather than moving directories, because four targets already exist
    in `site/` and `git mv` of a directory onto an existing one *nests* it — which would leave the
    stub in place and the real receiver one level too deep, a silent 404 on the URL every deployed
    artifact posts to. It asserts both frozen paths are covered before it will move anything, and it
    **does not commit or push**: pushing is the cutover, and that stays a human act (CORE.md §5).

    The blocker this step used to carry is cleared — the promotion deletes the legacy `admin.html`,
    and its replacements (Staff and Export in `site/app/faculty/admin.html`) shipped 2026-07-20.

    `site/app/*.md` — the internal design notes — route to `docs/app/` rather than into the published
    tree, and `docs/DOC-SOURCES.json` references some of the moved files and must be updated in the
    **same commit**.
14. **Push** — a push to `main` rebuilds GitHub Pages (~1–2 min) and is the live cutover.

---

## Verify the cutover

- Sign in as a student (**email address** + last-6 password — the bare-cadet-ID form was removed
  on 2026-07-21) and as an instructor; confirm dashboards, lessons, submission, and grading read
  the migrated data. A student migrated from `public` has no `students.email`, so expect to use
  their pre-existing `<cadet ID>@usafa.edu` auth address until a roster re-import backfills one.
- Confirm a launched artifact still posts to its slug and the report saves.
- Confirm the frozen URLs resolve unchanged.

## Record it

Update [`../../CHANGELOG.md`](../../CHANGELOG.md) (newest first, `## YYYY-MM-DD — <Human> via <Agent>`)
at bootstrap, at migration commit, and at promotion — three distinct state changes, each attributed.

## Out of scope — dropping `public`

`public` is the rollback and is **not** dropped at cutover. When and whether to drop it, and the
retention window, are open questions in [`../decisions/PREP-V2-SCHEMA.md`](../decisions/PREP-V2-SCHEMA.md)
§8. Dropping it is a separate, snapshot-gated destructive operation under CORE.md §0 — not part of
this runbook.
