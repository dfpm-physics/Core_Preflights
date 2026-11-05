#!/usr/bin/env python3
"""Build the `app` schema in an EMPTY staging Supabase project from the files in this repo.

WHY THIS EXISTS
  The live `app` schema was built by hand, one file at a time, over several weeks. Nothing
  proved that the files in this repo, run in order, rebuild it. This script is that proof, and
  it makes a staging database you can throw away and rebuild.

WHAT IT RUNS, IN ORDER
  1. supabase/admin/app_schema_bootstrap.sql   as `postgres`  (roles, schema, grants)
     The three REPLACE_ME_* passwords are replaced with new random values.
  2. supabase/migrations/app/NNN_*.sql         as `prep_app_owner` (SET ROLE), in number order.
     Only the top-level files of that folder run. Rollback files live in its `rollback/`
     subfolder and are never read by this script.
  3. bootstrap §6  the two auth.users foreign keys, as `postgres`.
  4. bootstrap §10 GRANT authenticated TO prep_app_owner (lets app_rls_test.py prove RLS).
  5. tutor_error_log grants, set to what production holds. This table is the one production built
     as `postgres`, so a build as prep_app_owner inherits wider default privileges.
  6. Storage buckets and policies, as `postgres`: supabase/migrations/023 and 024. These live in
     the `public` chain folder but touch only schema `storage`, and they gate on `app.*`.
     (019 is skipped: it gates on public.instructors, which does not exist here. 024 replaces it.)
  7. The migration ledger: every file that ran is recorded in app.migration_ledger (migration 024)
     through migration_ledger.py, in the same run. Skipped, with a notice, if 024 did not run.
  It does NOT seal prep_app_owner (bootstrap §7), because production is not sealed either.

SAFETY
  * Dry run by default. Nothing is written without --commit.
  * Refuses any target whose project ref is not exactly the staging ref (db_target.py reads the URL).
  * --expect-ref is a second confirmation; it cannot widen that rule.
  * Refuses if schema `app` already exists, unless --from NNN resumes a partial build.
  * Never prints a password or the connection string.

ENVIRONMENT
  STAGING_DB_URL        postgres connection string for the STAGING project (Session pooler).
  STAGING_SECRETS_FILE  optional. If set, the three generated role passwords are appended to
                        this file as STAGING_APP_{OWNER,DML,READ}_PASSWORD before anything runs,
                        so they are never lost. If not set, --commit refuses.

USAGE
  python scripts/staging/install_staging.py --expect-ref <staging_ref>            # plan only
  python scripts/staging/install_staging.py --expect-ref <staging_ref> --commit   # build
  python scripts/staging/install_staging.py --expect-ref <staging_ref> --from 007 --commit
  A --from number past the last migration runs only the steps after the migrations.

  After a successful build, one manual step remains in the Supabase dashboard:
  Project Settings > Data API > Exposed schemas > add `app`.
"""

import argparse
import os
import re
import secrets
import sys
import getpass
from pathlib import Path

PROD_REF = "shzvpmlnqfmzfmuxkowi"
REPO = Path(__file__).resolve().parents[2]
BOOTSTRAP = REPO / "supabase" / "admin" / "app_schema_bootstrap.sql"
MIGRATIONS = REPO / "supabase" / "migrations" / "app"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
STORAGE_FILES = [
    REPO / "supabase" / "migrations" / "023_artifact_sources_storage.sql",
    REPO / "supabase" / "migrations" / "024_lesson_figures_app_policies.sql",
]

AUTH_FKS = """
BEGIN;
ALTER TABLE app.students
  ADD CONSTRAINT students_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
ALTER TABLE app.instructors
  ADD CONSTRAINT instructors_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
COMMIT;
"""

RLS_TEST_GRANT = "GRANT authenticated TO prep_app_owner WITH INHERIT FALSE, SET TRUE;"

# Production's grants on this table, as read on 2026-11-04. See migration 021 for why each one exists.
TUTOR_LOG_GRANTS = """
BEGIN;
REVOKE ALL ON app.tutor_error_log FROM anon, authenticated, prep_app_dml, service_role;
GRANT SELECT ON app.tutor_error_log TO authenticated;
GRANT INSERT ON app.tutor_error_log TO service_role;
GRANT SELECT ON app.tutor_error_log TO prep_app_read;
COMMIT;
"""

PLACEHOLDERS = {
    "REPLACE_ME_OWNER": "STAGING_APP_OWNER_PASSWORD",
    "REPLACE_ME_DML": "STAGING_APP_DML_PASSWORD",
    "REPLACE_ME_READ": "STAGING_APP_READ_PASSWORD",
}


def fail(msg):
    print(f"REFUSED  {msg}", file=sys.stderr)
    sys.exit(2)


def target_ref(url):
    """The project ref named in the URL, read by the shared strict parser (None when refused)."""
    return db_target.ref_of(url)


def migration_files(start):
    # Top level only: rollback files live in MIGRATIONS / "rollback" and are never part of the chain.
    files = sorted(f for f in MIGRATIONS.glob("*.sql") if re.match(r"^\d{3}_", f.name))
    if start:
        files = [f for f in files if f.name[:3] >= start]
    return files


def has_txn(sql):
    return re.search(r"^\s*BEGIN\s*;", sql, re.I | re.M) is not None


def run_sql(cur, label, sql, as_owner=False):
    """Run one file. Wrap it in a transaction when it does not carry its own."""
    body = sql if has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
    if as_owner:
        # Every migration sets its own search_path (009 did not until 2026-11-04). The session
        # is left on the connection default on purpose, so a file that forgets fails here.
        cur.execute("SET ROLE prep_app_owner;")
    try:
        cur.execute(body)
    except Exception as exc:  # noqa: BLE001 — report and stop at the first failure
        try:
            cur.execute("ROLLBACK;")
        except Exception:  # noqa: BLE001
            pass
        print(f"FAILED   {label}")
        print(f"         {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
        return False
    finally:
        if as_owner:
            try:
                cur.execute("RESET ROLE;")
            except Exception:  # noqa: BLE001
                pass
    print(f"ok       {label}")
    return True


def record_ledger(cur, files, start):
    """Record the files this run applied in app.migration_ledger, if migration 024 created it."""
    import migration_ledger as ml

    cur.execute("SELECT to_regclass('app.migration_ledger') IS NOT NULL;")
    if not cur.fetchone()[0]:
        print("skip     migration ledger: app.migration_ledger does not exist (migration 024 not applied)")
        return
    rows = [("app", f.name, ml.checksum(f)) for f in files]
    rows += [("public", f.name, ml.checksum(f)) for f in STORAGE_FILES]
    by = getpass.getuser()
    cur.execute("BEGIN;")
    try:
        added = ml.record_rows(cur, rows, "applied", by, "recorded by install_staging.py")
        cur.execute("COMMIT;")
    except Exception:  # noqa: BLE001
        cur.execute("ROLLBACK;")
        raise
    print(f"ok       migration ledger: {added} row(s) recorded")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True, help="the staging project ref you expect")
    ap.add_argument("--from", dest="start", help="resume at this migration number, e.g. 007")
    ap.add_argument("--commit", action="store_true", help="actually write")
    args = ap.parse_args()

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        fail("STAGING_DB_URL is not set.")
    try:
        ref = db_target.require_staging(url, args.expect_ref).ref
    except db_target.DbTargetError as exc:
        fail(str(exc))
    if ref != args.expect_ref:
        fail(f"STAGING_DB_URL names project {ref}, not {args.expect_ref}.")
    if args.start and not re.fullmatch(r"\d{3}", args.start):
        fail("--from takes a three-digit migration number, e.g. 007.")

    files = migration_files(args.start)
    if not files and not args.start:
        fail("no migration files to run.")

    print(f"target   staging project {ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (add --commit to write)'}")
    print("plan:")
    if not args.start:
        print(f"  1. {BOOTSTRAP.relative_to(REPO).as_posix()}  (as postgres, new random role passwords)")
    for f in files:
        print(f"  -  {f.relative_to(REPO).as_posix()}  (as prep_app_owner)")
    print("  -  auth.users foreign keys (bootstrap §6, as postgres)")
    print("  -  GRANT authenticated TO prep_app_owner (bootstrap §10)")
    print("  -  tutor_error_log grants, matching production")
    for f in STORAGE_FILES:
        print(f"  -  {f.relative_to(REPO).as_posix()}  (as postgres)")

    import psycopg2  # imported late so --help and refusals work without it

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT current_user, version();")
    who, version = cur.fetchone()
    cur.execute("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app');")
    app_exists = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'prep_app_%';")
    roles = cur.fetchone()[0]
    print(f"connected as {who}; {version.split(',')[0]}")
    print(f"state    schema app exists: {app_exists}; prep_app_* roles: {roles}")

    if not args.start and (app_exists or roles):
        fail("staging is not empty. Use --from NNN to resume, or rebuild the staging project.")
    if args.start and not (app_exists and roles == 3):
        fail("--from needs the bootstrap to have run already (schema app and 3 roles).")

    if not args.commit:
        print("dry run complete. Nothing written.")
        return 0

    if not args.start:
        out = os.environ.get("STAGING_SECRETS_FILE", "").strip()
        if not out:
            fail("STAGING_SECRETS_FILE is not set, so the new role passwords would be lost.")
        sql = BOOTSTRAP.read_text(encoding="utf-8")
        new = {}
        for placeholder, key in PLACEHOLDERS.items():
            if sql.count(f"'{placeholder}'") != 1:
                fail(f"bootstrap does not contain '{placeholder}' exactly once.")
            new[key] = secrets.token_urlsafe(32)
            sql = sql.replace(f"'{placeholder}'", f"'{new[key]}'")
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("\n# written by scripts/staging/install_staging.py\n")
            fh.write(f"STAGING_PROJECT_REF={ref}\n")
            for key, value in new.items():
                fh.write(f"{key}={value}\n")
        print("ok       role passwords saved to STAGING_SECRETS_FILE (values not shown)")
        if not run_sql(cur, BOOTSTRAP.name, sql):
            return 1

    for f in files:
        if not run_sql(cur, f.name, f.read_text(encoding="utf-8"), as_owner=True):
            print(f"stopped. Fix the cause, then resume with --from {f.name[:3]}")
            return 1

    cur.execute(
        "SELECT count(*) FROM pg_constraint WHERE conname IN "
        "('students_auth_user_id_fkey', 'instructors_id_fkey');"
    )
    if cur.fetchone()[0] == 0:
        if not run_sql(cur, "auth.users foreign keys (bootstrap §6)", AUTH_FKS):
            return 1
    else:
        print("skip     auth.users foreign keys already exist")
    if not run_sql(cur, "GRANT authenticated TO prep_app_owner (bootstrap §10)", RLS_TEST_GRANT):
        return 1
    if not run_sql(cur, "tutor_error_log grants, matching production", TUTOR_LOG_GRANTS):
        return 1
    for f in STORAGE_FILES:
        if not run_sql(cur, f.name, f.read_text(encoding="utf-8")):
            return 1

    record_ledger(cur, files, args.start)

    print("done.  Manual step left: Dashboard > Project Settings > Data API > Exposed schemas > add `app`.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
