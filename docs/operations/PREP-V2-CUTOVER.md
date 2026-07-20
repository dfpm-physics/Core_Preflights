# PREP v2 cutover — bootstrap, migrate, promote

**Status:** procedure — not yet executed against the live database

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
2. **Apply the migration chain** as `prep_app_owner`, in order:
   `001_core_model.sql` → `002_rls.sql` → `003_term_calendar.sql`. This chain is numbered
   independently of `supabase/migrations/*.sql` (the `public` chain); the numbers do not correspond.
3. **Add the `auth.users` foreign keys** (bootstrap §6) as `postgres`. `students.auth_user_id` and
   `instructors.id` are declared as plain `uuid` columns because `postgres` cannot delegate
   `REFERENCES` on `auth.users` to the app owner; `postgres` creates those two constraints itself.

**Verify Phase 1** with [`../../supabase/admin/app_tier_check.py`](../../supabase/admin/app_tier_check.py):
each role connects and holds exactly the privileges it should, and no more.

## Phase 2 — Prove it before any data moves

4. **Run the invariant suite** —
   [`../../supabase/admin/app_invariant_test.py`](../../supabase/admin/app_invariant_test.py). It
   asserts the structural guarantees (one grade per enrolment/offering and bounded by its points, one
   submission per enrolment/offering, the gradable and lock triggers, the attributable unlock).
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

12. **Point the front end at `app`.** The `site/app/` portal becomes the schema's client. Confirm it
    reads and writes `app`, not `public`.
13. **Promote the app tree** so the real pages land on the frozen contract paths
    `site/student/interaction-submit.html` and `site/faculty/lessons.html`, overwriting the
    forwarding stubs. **The public URLs must be identical before and after** — if the promotion
    cannot preserve them exactly, abort rather than change a contract URL. The promotion deletes the
    legacy `admin.html`, so the two still-legacy-only director tools (instructor management, export)
    must be native in `site/app/` first, or the course loses them.
14. **Push** — a push to `main` rebuilds GitHub Pages (~1–2 min) and is the live cutover.

---

## Verify the cutover

- Sign in as a student (cadet ID + last-6 password) and as an instructor; confirm dashboards,
  lessons, submission, and grading read the migrated data.
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
