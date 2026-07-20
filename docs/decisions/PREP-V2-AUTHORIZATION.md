# PREP v2 authorization — two predicates over an ownership graph

**Status:** accepted — policies written in `app/002_rls.sql`, not yet applied to the live database

*Authored 2026-07-20 by Casey (via Claude), recording decisions made by Matthew Recker in the PREP v2
build ([`../../supabase/migrations/app/002_rls.sql`](../../supabase/migrations/app/002_rls.sql)).
Companion to [`PREP-V2-SCHEMA.md`](PREP-V2-SCHEMA.md) and
[`../architecture/PREP-V2-DATA-MODEL.md`](../architecture/PREP-V2-DATA-MODEL.md).
See [`../../CHANGELOG.md`](../../CHANGELOG.md).*

> **What this doc is for.** It records why the `app` schema replaces 62 hand-written `public`
> policies with a uniform two-predicate model, why the policies read the JWT through
> `app.current_uid()` instead of `auth.uid()`, and why the helper functions are `SECURITY DEFINER`.
> This is a security- and FERPA-relevant decision and wants a reviewer who checks it against the
> audit findings. It does not restate the data model — see the companion architecture doc.

---

## 1. Problem

The July 2026 audit of `public` found four exploitable holes, all reachable with nothing more than
the public anon key:

- the **roster is world-readable** — any client can read every student row;
- **every finalized score is world-readable** — the grades policy checked `is_finalized = true` with
  no owner predicate at all;
- **any signed-in account can delete any student**; and
- **one student can insert or overwrite another student's answers.**

These are not four unrelated mistakes. `public` has no single join path from a row back to the person
who owns it, so each table grew its own bespoke policy, and 62 policies are too many to keep correct.
Once real cadet work exists, three of the four findings are direct FERPA exposures.

## 2. Goals and non-goals

**Goals.**

- Close all four audit findings, each with a test in
  [`../../supabase/admin/app_rls_test.py`](../../supabase/admin/app_rls_test.py).
- Reduce authorization to a small number of predicate shapes a reviewer can hold in their head.
- Grant the anonymous role nothing.

**Non-goals.**

- **Application-layer permission checks.** RLS is the gate; the front end mirrors it for UX, not for
  security. This doc does not govern the client.
- **Field-level redaction.** Row visibility is the unit; hiding columns within a visible row is out
  of scope.

## 3. Constraints

- **The app tier holds no privileges on schema `auth`.** `postgres` cannot delegate `USAGE` on
  `auth` to `prep_app_owner` (bootstrap §5), so a policy created by the app owner cannot call
  `auth.uid()`.
- **`prep_app_owner` holds `BYPASSRLS`.** It owns the schema and the helper functions; this is what
  lets a `SECURITY DEFINER` helper read a table that itself has a policy without recursing.
- The frozen contract, the shared database, and no build step, all per
  [`PREP-V2-SCHEMA.md`](PREP-V2-SCHEMA.md) §3.

## 4. Options considered

**Option A — Carry the `public` pattern forward: `auth.uid()` and one bespoke policy per table.**
*Rejected on two independent grounds.* The app tier cannot reference `auth.uid()` at all (§3), and
the per-table bespoke approach is precisely what produced 62 policies and four holes. Reproducing it
on a new schema would inherit the failure mode along with the shape.

**Option B — Push authorization into the application and leave RLS permissive.** *Rejected.* The
anon key ships in the browser; a permissive database trusts every client. The audit holes are what a
permissive database looks like. Authorization has to live where the data lives.

**Option C — A uniform two-predicate model over the ownership graph, read through a JWT helper.**
*Chosen.*

## 5. Decision

**We will express nearly every policy as one of two predicates over the enrolment/staffing graph,
plus a director/admin escalation, and read the caller's identity through `app.current_uid()`.**

- **Student rows** answer *"does the caller own the enrolment this row hangs from?"* — `submissions`,
  `submission_activities`, and a student's own `grades` (finalized only) all resolve to
  `enrollment_id IN (SELECT my_enrollments())`.
- **Staff rows** answer *"does the caller staff the section that enrolment belongs to?"* — the same
  tables, read side, resolve to `section_id IN (SELECT staff_sections())`.
- **Escalation** is `is_admin()` (the `instructors.is_global_admin` flag) and the director helpers
  (`director_offerings()`, `director_courses()`), which gate writes to the catalogue, the roster, and
  staffing.
- **Anon gets nothing.** Not one policy grants the `anon` role anything; every student-facing page
  authenticates first, which alone closes the world-readable findings.
- **Identity comes from `app.current_uid()`** — a `STABLE SECURITY DEFINER` function that reads the
  same JWT `sub` claim `auth.uid()` reads, through `current_setting()` in `pg_catalog`, with no
  dependency on schema `auth`.

The helper functions (`my_student_id()`, `is_staff()`, `staff_sections()`, `my_enrollments()`, and
the rest) are `SECURITY DEFINER`, owned by the `BYPASSRLS` app owner, each `STABLE` and pinning
`search_path`.

**This decision has real costs.** `SECURITY DEFINER` functions run with the owner's privileges, so a
`search_path` mistake or an over-broad helper is a privilege-escalation bug, not a visibility bug —
these functions are the sharpest edge in the schema and every one pins its `search_path`. Correctness
now depends on the enrolment graph being right: a wrong or missing enrolment row is not a data glitch
but an authorization fact, granting or denying access. And re-reading the JWT claim directly instead
of through `auth.uid()` means an upstream change to how Supabase populates the claim would not be
caught by the `auth` schema — it is caught only by the RLS tests.

## 6. Consequences

- Adding a table means choosing which of the two predicates owns its rows, not writing a new bespoke
  policy from scratch.
- The four audit findings each map to a specific policy: `students_read_own` / `students_read_staff`
  replace world-read; `students_write` gated on `director_offerings()` replaces world-delete;
  `grades_own_finalized` adds the owner predicate the old grades policy lacked;
  `submissions_student_insert` / `submissions_student_update` scope writes to `my_enrollments()`.
- `analysis_reports` is written by the analysis skills through the DML tier / `service_role`, not by
  browser clients; its read policy fans out by scope (instructor panel, section, offering, course).
- The one staff `UPDATE` path on `submissions` exists for a single purpose — the attributable
  instructor unlock — and is scoped to `staff_sections()`.

## 7. Confirmation

**How we would know this was wrong.**

- **The anon probe reads anything.** `app_rls_test.py` authenticates as `anon` and asserts every table
  returns zero rows. A non-empty result falsifies the "anon gets nothing" claim and blocks cutover.
- **A cross-student read or write succeeds.** The suite acts as student A against student B's
  submissions, answers, and finalized grade; each must be denied. Any success means the ownership
  predicate is not actually gating that table.
- **A helper recurses or leaks.** If enabling RLS makes a helper recurse, or a `search_path` is
  unpinned, the policy either errors or reads the wrong rows — caught by the tier check
  (`app_tier_check.py`) and the RLS suite before any real data exists.

If any of these fail, the schema is not cut over — `public` remains live (see
[`PREP-V2-SCHEMA.md`](PREP-V2-SCHEMA.md) §7).

## 8. Open questions

- **Extensions gating.** The `public` model left due-date extensions writable by any grader.
  v2 folds per-section deadlines into `assignment_due_dates` under director-gated writes, but whether
  a non-director grader may ever set a single-student override is still open.
- **Whether `current_uid()` should be re-based on `auth.uid()` if the app tier is ever granted `auth`
  usage** — a simplification available only if the §3 constraint is lifted.
