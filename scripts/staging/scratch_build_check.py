#!/usr/bin/env python3
"""Build schema `app` from the repo's files into a throwaway database, fingerprint it, and drop it.

This proves the migration files rebuild a schema WITHOUT touching the staging database that other
people are using. It creates a database named scratch_ledger_<random> on the staging project's
server, builds into that, and drops only that database when it finishes, however it finishes.

WHAT IT BUILDS
  1. schema_fingerprint-compatible stand-ins for what Supabase provides and the files need:
     schema `auth` (a users table with an id column) so the two auth foreign keys can be added.
  2. supabase/admin/app_schema_bootstrap.sql, minus the CREATE ROLE and ALTER ROLE statements,
     because roles belong to the whole server and already exist. Everything else runs as written.
  3. every migration in supabase/migrations/app/ (top level only) up to --through, in order, each
     as prep_app_owner, each on the connection default search_path unless --ambient-path is given.
  4. the auth foreign keys, and the tutor_error_log grants, as install_staging.py does.
  5. the migration ledger rows for every file, when migration 024 is among them.
  The two Storage files are not run: they touch schema `storage`, which a scratch database lacks,
  and the fingerprint covers only schema `app`.

SAFETY
  * Staging project only. Refuses the production ref, and refuses unless --expect-ref matches.
  * Touches only the database it created itself. It never connects to the `postgres` database of
    the project except to create and drop the scratch one.
  * Never prints a password or the connection string.

USAGE
  python scripts/staging/scratch_build_check.py --expect-ref <staging_ref> --fingerprint-out FILE
      [--through 022] [--skip 023] [--ambient-path] [--file-from-git 009_analysis_runs.sql=<rev>]
  --ambient-path       run each file with search_path = app, public already set, the way 009 once
                       had to be run. Without it, a file that does not set its own path fails.
  --file-from-git      use a file's content as committed at <rev> instead of the working copy.
Exit code 0 on success, 1 when a file fails, 2 when it refuses.
"""

import argparse
import getpass
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import migration_ledger as ml  # noqa: E402
import schema_fingerprint as fp  # noqa: E402

AUTH_STUB = """
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
"""


def refuse(msg):
    print(f"REFUSED  {msg}", file=sys.stderr)
    sys.exit(2)


def drop_database(admin_cur, name):
    admin_cur.execute(f'ALTER DATABASE "{name}" WITH ALLOW_CONNECTIONS false')
    for _ in range(15):
        admin_cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                          "WHERE datname = %s AND pid <> pg_backend_pid()", (name,))
        time.sleep(1)
        try:
            admin_cur.execute(f'DROP DATABASE IF EXISTS "{name}"')
            return True
        except Exception:  # noqa: BLE001 — the pooler may still hold a session; retry
            continue
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--through", help="last migration number to run, e.g. 022")
    ap.add_argument("--skip", action="append", default=[], metavar="NNN",
                    help="leave this migration number out (repeatable). Not every numbered file is "
                         "applied at the same step, so --skip 023 builds the schema without it.")
    ap.add_argument("--ambient-path", action="store_true")
    ap.add_argument("--file-from-git", action="append", default=[], metavar="NAME=REV")
    ap.add_argument("--fingerprint-out", help="write the fingerprint of the scratch schema here")
    args = ap.parse_args()

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        refuse("STAGING_DB_URL is not set.")
    try:
        ref = db_target.require_staging(url, args.expect_ref).ref
    except db_target.DbTargetError as exc:
        refuse(str(exc))
    if ref != args.expect_ref:
        refuse(f"STAGING_DB_URL names project {ref}, not {args.expect_ref}.")
    if args.through and not re.fullmatch(r"\d{3}", args.through):
        refuse("--through takes a three-digit migration number.")

    overrides = {}
    for item in args.file_from_git:
        name, rev = item.split("=", 1)
        overrides[name] = subprocess.run(
            ["git", "show", f"{rev}:supabase/migrations/app/{name}"],
            cwd=ins.REPO, capture_output=True, check=True).stdout.decode("utf-8")

    import psycopg2

    name = "scratch_ledger_" + secrets.token_hex(4)
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 0
    try:
        u = urlparse(url)
        conn = psycopg2.connect(urlunparse(u._replace(path="/" + name)), connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()

        def run(label, sql, owner=False):
            body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
            try:
                if owner:
                    cur.execute("SET ROLE prep_app_owner;")
                    cur.execute("SET search_path = app, public;" if args.ambient_path else "RESET search_path;")
                cur.execute(body)
            except Exception as exc:  # noqa: BLE001
                try:
                    cur.execute("ROLLBACK;")
                except Exception:  # noqa: BLE001
                    pass
                print(f"FAILED   {label}\n         {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
                return False
            finally:
                if owner:
                    try:
                        cur.execute("RESET ROLE;")
                        cur.execute("RESET search_path;")
                    except Exception:  # noqa: BLE001
                        pass
            print(f"ok       {label}")
            return True

        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        steps = [("auth stand-in", AUTH_STUB, False), ("bootstrap (no role creation)", sql, False)]
        files = ins.migration_files(None)
        if args.through:
            files = [f for f in files if f.name[:3] <= args.through]
        files = [f for f in files if f.name[:3] not in args.skip]
        for f in files:
            text = overrides.get(f.name, f.read_text(encoding="utf-8"))
            steps.append((f.name, text, True))
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False),
                  ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                code = 1
                break
        if code == 0:
            cur.execute("SELECT to_regclass('app.migration_ledger') IS NOT NULL")
            if cur.fetchone()[0]:
                rows = [("app", f.name, ml.checksum(f)) for f in files]
                cur.execute("BEGIN")
                added = ml.record_rows(cur, rows, "applied", getpass.getuser(), "scratch build")
                cur.execute("COMMIT")
                print(f"ok       ledger: {added} row(s)")
            conn.set_session(readonly=True, autocommit=True)
            lines = []
            for kind, query in fp.QUERIES:
                cur.execute(query)
                for row in cur.fetchall():
                    lines.append(kind + " | " + " | ".join(" ".join(str(v).split()) for v in row))
            print(f"ok       fingerprint: {len(lines)} lines")
            if args.fingerprint_out:
                Path(args.fingerprint_out).write_text("\n".join(lines) + "\n", encoding="utf-8")
                print(f"ok       written to {args.fingerprint_out}")
        conn.close()
    finally:
        if drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f"WARNING  could not drop {name}; drop it by hand: DROP DATABASE \"{name}\";", file=sys.stderr)
            code = code or 1
        admin.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
