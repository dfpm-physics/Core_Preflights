#!/usr/bin/env python3
"""Time a pg_dump and a restore into a SCRATCH project, and compare row counts.

Dry-run by default (checks tools, flags and environment; connects to nothing).
--commit runs the dump and the restore. Standard library only; needs the PostgreSQL client tools
(pg_dump, pg_restore, psql) on PATH or in --pg-bin.

Environment (values are never printed or written to the result file):
    DRILL_SOURCE_DB_URL   connection string of the database to dump
    DRILL_TARGET_DB_URL   connection string of the empty scratch database to restore into

The connection details travel to the client tools in PG* environment variables, not on the
command line, so they do not appear in a process listing.

Two supported runs
  1. Production-size timing (the course director's own run): the source is the live project, the
     target is an empty database in a SEPARATE scratch project. DRILL_SOURCE_DB_URL and
     DRILL_TARGET_DB_URL are both needed, and --target-is-scratch confirms the target is disposable.
  2. Staging rehearsal: source is staging, target is a throwaway database named drill_* on the
     SAME staging server (--target-db drill_x; the source URL may come from STAGING_DB_URL, and no target URL is needed). Staging holds only invented
     data. The script creates that one database, restores into it, and drops it again; it never
     drops a database it did not create.

Rules enforced here, before any connection (db_target.py reads every URL; no substring tests):
  * Each URL is parsed with the same reader the other staging tools use, and the ref it really
    names must equal the ref declared for it. A URL that names a different project than its flag
    is refused, whatever else it contains.
  * The target may never be the production project in any form, and never the source project.
  * Outside run 2, the staging project is never a restore target.
  * Run 2 needs the source ref and the target ref to both be the staging ref.
  * The pg_dump major version must be at least the server's.
See docs/operations/RESTORE-DRILL.md for what a dump does and does not capture.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

PRODUCTION_REF = db_target.PRODUCTION_REF
STAGING_REF = db_target.STAGING_REF
DRILL_DB = re.compile(r"drill_[a-z0-9_]{1,40}")
# Stand-ins for what Supabase provides in schema auth, so a dump of schema app restores on a plain
# database. The users table is filled with the source's ids so foreign keys validate.
AUTH_STUBS = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
"""
DEFAULT_SCHEMAS = ["app"]

COUNT_SQL = """
select table_schema || '.' || table_name,
       (xpath('/row/c/text()', query_to_xml(
         format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema = any (string_to_array(:'schemas', ','))
order by 1;
"""


class Refusal(Exception):
    pass


def check_refs(source_ref, target_ref, scratch, target_db=None):
    for label, r in (("source", source_ref), ("target", target_ref)):
        if not r or not re.fullmatch(r"[a-z0-9]{20}", r):
            raise Refusal(f"--{label}-ref is missing or not a 20-character project ref")
    if target_ref == PRODUCTION_REF:
        raise Refusal("refusing: the target is the production project")
    if target_db is not None:
        # Staging rehearsal: both ends must be staging, and the target is one named scratch database.
        if source_ref != STAGING_REF or target_ref != STAGING_REF:
            raise Refusal("refusing: --target-db is for the staging rehearsal; source and target "
                          "refs must both be the staging project")
        if not DRILL_DB.fullmatch(target_db):
            raise Refusal("refusing: --target-db must be named drill_ followed by lower-case letters, "
                          "digits or underscores")
        return
    if target_ref == source_ref:
        raise Refusal("refusing: the target is the source")
    if target_ref == STAGING_REF:
        raise Refusal("refusing: staging is never a restore target outside --target-db "
                      "(real data must not land there)")
    if not scratch:
        raise Refusal("refusing: pass --target-is-scratch to confirm the target is a disposable project")


def check_url_ref(label, url, ref):
    """The ref the URL really names (read by db_target) must equal the ref declared for it."""
    if not url:
        raise Refusal(f"{label} database URL environment variable is not set")
    try:
        real = db_target.parse(url).ref
    except db_target.DbTargetError as exc:
        raise Refusal(f"{exc} ({label} URL)")
    if real != ref:
        raise Refusal(f"refusing: the {label} URL names a different project than the {label} ref you declared")
    if label == "target" and real == PRODUCTION_REF:
        raise Refusal("refusing: the target URL names the production project")


def conn_env(url):
    u = urlsplit(url)
    e = {"PGHOST": u.hostname or "", "PGPORT": str(u.port or 5432),
         "PGUSER": unquote(u.username or ""), "PGPASSWORD": unquote(u.password or ""),
         "PGDATABASE": (u.path or "/postgres").lstrip("/") or "postgres", "PGSSLMODE": "require"}
    if not e["PGHOST"] or not e["PGUSER"]:
        raise Refusal("a database URL is missing its host or user")
    return e


def find_tools(pg_bin, which=shutil.which):
    found, missing = {}, []
    for t in ("pg_dump", "pg_restore", "psql"):
        p = None
        if pg_bin:
            for cand in (Path(pg_bin) / t, Path(pg_bin) / (t + ".exe")):
                if cand.is_file():
                    p = str(cand)
                    break
        else:
            p = which(t)
        if p:
            found[t] = p
        else:
            missing.append(t)
    return found, missing


def major(version_text):
    m = re.search(r"(\d+)(?:\.\d+)?", version_text or "")
    return int(m.group(1)) if m else None


def real_runner(cmd, env):
    p = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def psql_scalar(run, psql, env, sql):
    rc, so, se = run([psql, "-X", "-At", "-c", sql], env)
    if rc != 0:
        raise RuntimeError("psql failed: " + se.strip()[:200])
    return so.strip()


def table_counts(run, psql, env, schemas):
    rc, so, se = run([psql, "-X", "-At", "-F", "|", "-v", "schemas=" + ",".join(schemas), "-c", COUNT_SQL.replace(":'schemas'", "'" + ",".join(schemas) + "'")], env)
    if rc != 0:
        raise RuntimeError("row count query failed: " + se.strip()[:200])
    out = {}
    for line in so.splitlines():
        if "|" in line:
            k, v = line.rsplit("|", 1)
            out[k] = int(v)
    return out


class ScratchDb:
    """Creates and drops the one throwaway database of the staging rehearsal. psycopg2, imported late."""

    def __init__(self, url, name):
        self.url, self.name, self.created = url, name, False

    def create(self):
        import psycopg2
        self.conn = psycopg2.connect(self.url, connect_timeout=15)
        self.conn.autocommit = True
        cur = self.conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (self.name,))
        if cur.fetchone():
            raise Refusal(f"refusing: database {self.name} already exists; this script drops only what it created")
        cur.execute(f'CREATE DATABASE "{self.name}"')
        self.created = True

    def source_user_ids(self):
        """Ids in the source's auth.users, to fill the stand-in table. Read-only."""
        import psycopg2
        conn = psycopg2.connect(self.url, connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT to_regclass('auth.users') IS NOT NULL")
        ids = []
        if cur.fetchone()[0]:
            cur.execute("SELECT id::text FROM auth.users")
            ids = [r[0] for r in cur.fetchall()]
        conn.close()
        return ids

    def drop(self):
        """Drops only the database this object created. Returns True when nothing is left behind."""
        if not self.created:
            return True
        from scratch_build_check import drop_database
        ok = drop_database(self.conn.cursor(), self.name)
        self.conn.close()
        return ok


def main(argv=None, environ=None, runner=real_runner, which=shutil.which, out=print, scratch_db=ScratchDb):
    environ = os.environ if environ is None else environ
    ap = argparse.ArgumentParser(description="Dump and restore timing drill (dry run by default)")
    ap.add_argument("--source-ref", required=True)
    ap.add_argument("--target-ref", required=True)
    ap.add_argument("--target-is-scratch", action="store_true")
    ap.add_argument("--target-db", help="staging rehearsal: restore into this throwaway drill_* database "
                                         "on the staging server (created and dropped by this script)")
    ap.add_argument("--pg-bin", help="folder holding pg_dump, pg_restore and psql")
    ap.add_argument("--schemas", default=",".join(DEFAULT_SCHEMAS), help="comma list to dump with data")
    ap.add_argument("--include-auth-users", action="store_true",
                    help="also copy auth.users and auth.identities (data only); app rows reference them")
    ap.add_argument("--result", default="restore-drill-result.json")
    ap.add_argument("--work-dir")
    ap.add_argument("--keep-dump", action="store_true", help="keep the dump file (it may hold real data)")
    ap.add_argument("--commit", action="store_true", help="run the dump and restore")
    a = ap.parse_args(argv)

    try:
        check_refs(a.source_ref, a.target_ref, a.target_is_scratch, a.target_db)
        src_url = environ.get("DRILL_SOURCE_DB_URL", "") or (
            environ.get("STAGING_DB_URL", "") if a.target_db else "")
        check_url_ref("source", src_url, a.source_ref)
        if a.target_db:
            tgt_url = db_target.with_dbname(src_url, a.target_db)
        else:
            tgt_url = environ.get("DRILL_TARGET_DB_URL", "")
        check_url_ref("target", tgt_url, a.target_ref)
        src_env, tgt_env = conn_env(src_url), conn_env(tgt_url)
    except (Refusal, db_target.DbTargetError) as e:
        out(f"REFUSED: {str(e).removeprefix('REFUSED: ')}")
        return 2

    tools, missing = find_tools(a.pg_bin, which)
    if missing:
        out("MISSING TOOLS: " + ", ".join(missing) + ". Install the PostgreSQL client tools "
            "(a human must approve and run the install) or pass --pg-bin <folder>. Nothing was run.")
        return 3

    schemas = [s for s in a.schemas.split(",") if s]
    if not all(re.fullmatch(r"[a-z_][a-z0-9_]*", s) for s in schemas):
        out("REFUSED: schema names must be plain lowercase identifiers")
        return 2
    where = f"scratch database {a.target_db} on the same server," if a.target_db else "scratch target"
    out(f"Source ref {a.source_ref} -> {where} {a.target_ref}. Schemas with data: {schemas}"
        f"{' + auth.users, auth.identities' if a.include_auth_users else ''}.")
    out(f"Mode: {'COMMIT' if a.commit else 'dry run (nothing connected, nothing written)'}")
    if not a.commit:
        out("Dry run complete. Re-run with --commit to dump and restore.")
        return 0

    base_env = {k: v for k, v in environ.items() if not k.startswith("PG")}
    senv, tenv = dict(base_env, **src_env), dict(base_env, **tgt_env)
    result = {"started_utc": datetime.now(timezone.utc).isoformat(), "source_ref": a.source_ref,
              "target_ref": a.target_ref, "schemas": schemas, "include_auth_users": a.include_auth_users}
    work = Path(a.work_dir or tempfile.mkdtemp(prefix="restore-drill-"))
    work.mkdir(parents=True, exist_ok=True)
    dump = work / "drill.dump"
    rc_final = 0
    scratch = None
    try:
        if a.target_db:
            scratch = scratch_db(src_url, a.target_db)
            scratch.create()
            result["scratch_database"] = a.target_db
            psql_scalar(runner, tools["psql"], tenv, AUTH_STUBS)
            ids = scratch.source_user_ids()
            for i in range(0, len(ids), 400):
                chunk = ",".join(ids[i:i + 400])
                psql_scalar(runner, tools["psql"], tenv,
                            f"INSERT INTO auth.users (id) SELECT unnest(string_to_array('{chunk}', ','))::uuid")
            result["stand_in_auth_users"] = len(ids)
        rc, so, _ = runner([tools["pg_dump"], "--version"], base_env)
        result["pg_dump_version"] = so.strip()
        srv_num = psql_scalar(runner, tools["psql"], senv, "show server_version_num")
        result["source_server_version_num"] = srv_num
        srv_major = int(srv_num) // 10000
        cli_major = major(result["pg_dump_version"].split(")")[-1] if ")" in so else so)
        if cli_major is None or cli_major < srv_major:
            out(f"REFUSED: pg_dump major {cli_major} is older than the server's {srv_major}. Install a newer client.")
            return 2
        result["target_server_version_num"] = psql_scalar(runner, tools["psql"], tenv, "show server_version_num")

        sch_args = [f"--schema={s}" for s in schemas]
        t0 = time.monotonic()
        rc, _, se = runner([tools["pg_dump"], "-Fc", "--no-owner", "--no-acl", *sch_args, "-f", str(dump)], senv)
        result["dump_seconds"] = round(time.monotonic() - t0, 2)
        if rc != 0:
            raise RuntimeError("pg_dump failed: " + se.strip()[:300])
        result["dump_bytes"] = dump.stat().st_size
        auth_dump = None
        if a.include_auth_users:
            auth_dump = work / "drill-auth.dump"
            t0 = time.monotonic()
            rc, _, se = runner([tools["pg_dump"], "-Fc", "--no-owner", "--no-acl", "--data-only",
                                "--table=auth.users", "--table=auth.identities", "-f", str(auth_dump)], senv)
            result["dump_seconds"] = round(result["dump_seconds"] + time.monotonic() - t0, 2)
            if rc != 0:
                raise RuntimeError("auth pg_dump failed: " + se.strip()[:300])
            result["dump_bytes"] += auth_dump.stat().st_size

        t0 = time.monotonic()
        if auth_dump:  # auth rows first: app rows reference them
            rc, _, se = runner([tools["pg_restore"], "--no-owner", "--no-acl", "--data-only",
                                "-d", tenv["PGDATABASE"], str(auth_dump)], tenv)
            if rc != 0:
                raise RuntimeError("auth restore failed: " + se.strip()[:300])
        rc, _, se = runner([tools["pg_restore"], "--no-owner", "--no-acl", "-d", tenv["PGDATABASE"], str(dump)], tenv)
        result["restore_seconds"] = round(time.monotonic() - t0, 2)
        result["restore_exit_code"] = rc
        result["restore_stderr_lines"] = len(se.strip().splitlines()) if se.strip() else 0
        if rc != 0:
            rc_final = 1
            out("pg_restore reported errors; see restore_stderr_lines and review them by hand.")

        count_schemas = schemas + (["auth"] if a.include_auth_users else [])
        sc = table_counts(runner, tools["psql"], senv, count_schemas)
        tc = table_counts(runner, tools["psql"], tenv, count_schemas)
        if a.include_auth_users:
            keep = {"auth.users", "auth.identities"}
            sc = {k: v for k, v in sc.items() if not k.startswith("auth.") or k in keep}
            tc = {k: v for k, v in tc.items() if not k.startswith("auth.") or k in keep}
        result["row_counts"] = {k: {"source": sc.get(k), "target": tc.get(k)} for k in sorted(set(sc) | set(tc))}
        bad = [k for k, v in result["row_counts"].items() if v["source"] != v["target"]]
        result["mismatched_tables"] = bad
        if bad:
            rc_final = 1
        out(f"dump {result['dump_seconds']}s ({result['dump_bytes']} bytes), restore {result['restore_seconds']}s, "
            f"{len(result['row_counts'])} tables compared, {len(bad)} mismatched.")
    except Exception as e:  # noqa: BLE001 — recorded, then the finally block cleans up
        result["error"] = f"{type(e).__name__}: {e}"
        out(f"FAILED: {type(e).__name__}: {e}")
        rc_final = 1
    finally:
        if scratch is not None:
            try:
                result["scratch_dropped"] = bool(scratch.drop())
            except Exception as exc:  # noqa: BLE001
                result["scratch_dropped"] = False
                out(f"WARNING: could not drop {a.target_db}: {type(exc).__name__}")
            if not result["scratch_dropped"]:
                out(f"WARNING: drop database {a.target_db} by hand.")
                rc_final = rc_final or 1
        if not a.keep_dump:
            for f in (dump, work / "drill-auth.dump"):
                try:
                    f.unlink()
                except OSError:
                    pass
        result["dump_kept"] = bool(a.keep_dump)
        Path(a.result).write_text(json.dumps(result, indent=2), encoding="utf-8")
        out(f"Result written to {a.result}")
    return rc_final


if __name__ == "__main__":
    sys.exit(main())
