#!/usr/bin/env python3
"""Shared helpers for the scratch-database migration proofs (048 and 059 use it).

A scratch proof builds schema `app` from the repo's migration files into a throwaway database on the STAGING
server, applies one migration under test, and drops the database. The staging database itself is never touched.
Sessions are simulated with the `authenticated` role plus `request.jwt.claims`, the way the platform's token is
read. It cannot show the real REST path or a real token.

Safety: db_target.py refuses anything but the staging project; the connection string comes from the environment
and is never printed.
"""
import json
import os
import re
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402


def uid():
    return str(uuid.uuid4())


class Scratch:
    """One throwaway database, built through the migrations numbered below `before`."""

    def __init__(self, prefix, expect_ref, before, skip=("023",)):
        self.prefix, self.expect_ref, self.before, self.skip = prefix, expect_ref, before, skip
        self.url = os.environ.get("STAGING_DB_URL", "").strip()
        try:
            db_target.require_staging(self.url, expect_ref)
        except db_target.DbTargetError as exc:
            sbc.refuse(str(exc))
        import psycopg2
        self.psycopg2 = psycopg2
        self.name = f"{prefix}_{os.urandom(4).hex()}"
        self.admin = psycopg2.connect(self.url, connect_timeout=15)
        self.admin.autocommit = True
        self.acur = self.admin.cursor()
        self.acur.execute(f'CREATE DATABASE "{self.name}"')
        print(f"created  scratch database {self.name}")
        surl = db_target.with_dbname(self.url, self.name)
        db_target.require_staging(surl, expect_ref)
        self.conn = psycopg2.connect(surl, connect_timeout=15)
        self.conn.autocommit = True
        self.cur = self.conn.cursor()
        self.built_through = None

    # -- running SQL ----------------------------------------------------------------------------------------
    def run(self, label, sql, owner=False, quiet=False):
        cur = self.cur
        body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
        try:
            if owner:
                cur.execute("SET ROLE prep_app_owner;")
                cur.execute("RESET search_path;")
            cur.execute(body)
        except Exception as exc:  # noqa: BLE001
            try:
                cur.execute("ROLLBACK;")
            except Exception:  # noqa: BLE001
                pass
            if not quiet:
                print(f"FAILED   {label}: {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
            return False
        finally:
            if owner:
                try:
                    cur.execute("RESET ROLE;")
                    cur.execute("RESET search_path;")
                except Exception:  # noqa: BLE001
                    pass
        return True

    def build(self):
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = [f for f in ins.migration_files(None) if f.name[:3] not in self.skip and f.name[:3] < self.before]
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not self.run(label, text, owner):
                return False
        self.built_through = files[-1].name[:3]
        print(f"built    schema app through {self.built_through} ({len(files)} migration files)")
        self.cur.execute("SET search_path = app, public, extensions")
        return True

    def apply_file(self, name, rollback=False, quiet=False):
        path = (ins.MIGRATIONS / "rollback" / name) if rollback else next(f for f in ins.migration_files(None) if f.name == name)
        ok = self.run(name, path.read_text(encoding="utf-8"), True, quiet)
        self.cur.execute("SET search_path = app, public, extensions")
        return ok

    # -- querying ------------------------------------------------------------------------------------------
    def one(self, sql, params=()):
        self.cur.execute(sql, params)
        return self.cur.fetchone()[0]

    def claims(self, sub, **extra):
        c = {"sub": sub, "role": "authenticated"}
        c.update(extra)
        return json.dumps(c)

    def attempt(self, sub, sql, params=(), claims_extra=None, role="authenticated", keep=False):
        """Run one statement as a simulated sign-in, in a transaction that is rolled back unless keep.
        Returns ('ok', value-or-rowcount) or ('error', pgcode, first line of the message)."""
        cur = self.cur
        cur.execute("BEGIN")
        try:
            cur.execute(f"SET LOCAL ROLE {role}")
            if sub is not None:
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (self.claims(sub, **(claims_extra or {})),))
            cur.execute(sql, params)
            if cur.description:
                rows = cur.fetchall()
                res = ("ok", rows[0][0] if len(rows) == 1 and len(rows[0]) == 1 else len(rows))
            else:
                res = ("ok", cur.rowcount)
        except self.psycopg2.Error as exc:
            res = ("error", exc.pgcode, (str(exc).strip().splitlines() or [""])[0])
        cur.execute("COMMIT" if (keep and res[0] == "ok") else "ROLLBACK")
        cur.execute("RESET ROLE")
        return res

    def close(self):
        code_ok = False
        try:
            self.conn.close()
        except Exception:  # noqa: BLE001
            pass
        if sbc.drop_database(self.acur, self.name):
            print(f"dropped  scratch database {self.name}")
            code_ok = True
        else:
            print(f'WARNING  could not drop {self.name}; drop it by hand: DROP DATABASE "{self.name}";', file=sys.stderr)
        self.admin.close()
        return code_ok


class Tally:
    def __init__(self):
        self.p = self.f = 0

    def chk(self, desc, ok, detail=""):
        if ok:
            self.p += 1
            print(f"  PASS  {desc}")
        else:
            self.f += 1
            print(f"  FAIL  {desc}{(' - ' + str(detail)) if detail else ''}")
        return bool(ok)
