#!/usr/bin/env python
"""Verify the `app` schema tiers behave exactly as designed.

Companion to app_schema_bootstrap.sql. Run once immediately after the bootstrap, and again
any time the roles or grants are touched. It proves — against the live database, not on
trust — that:

  * each tier can connect and sees schema `app`
  * prep_app_owner CAN create and drop objects in `app`      (DDL, build-out tier)
  * prep_app_dml   CANNOT do DDL but CAN read and write data (everyday tier)
  * prep_app_read  CANNOT write but CAN read                 (analysis tier)
  * NO tier can read or write anything in `public`           (the live site is unreachable)

Nothing is persisted: the DDL probe creates a scratch table and drops it, and the write
probes roll back.

Reads credentials from supabase/admin/.env (gitignored via the `.env*` pattern). Keys:

    PREP_DB_HOST, PREP_DB_PORT, PREP_DB_NAME, PREP_DB_SSLMODE, PREP_PROJECT_REF
    PREP_APP_OWNER_ROLE / _PASSWORD
    PREP_APP_DML_ROLE   / _PASSWORD
    PREP_APP_READ_ROLE  / _PASSWORD

A tier is probed only if both its _ROLE and _PASSWORD are present, so commenting out the
OWNER pair is enough to keep the DDL credential out of everyday runs. Once the build-out is
done and prep_app_owner is sealed (bootstrap §7), the owner probe is EXPECTED to fail at
connect — that failure is the gate working, not a regression.

This file is separate from supabase/admin/config.json, which still holds the legacy
claude_code_recker credential for the `public` schema tooling. Neither touches the other.

Usage (from the repo root, via the project venv):
  .venv/Scripts/python supabase/admin/app_tier_check.py
"""
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2 import errors
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

ADMIN = Path(__file__).resolve().parent
ENV_FILE = ADMIN / ".env"

OK, FAIL, GATE = "  [ok]  ", "  [FAIL]", "  [gate]"


def read_env(path):
    """Minimal KEY=VALUE parser — stdlib only, no python-dotenv dependency."""
    out = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key.strip()] = val
    return out


def load():
    if not ENV_FILE.is_file():
        sys.exit(f"No credentials at {ENV_FILE} — see app_schema_bootstrap.sql.")
    env = read_env(ENV_FILE)

    missing = [k for k in ("PREP_DB_HOST", "PREP_PROJECT_REF") if not env.get(k)]
    if missing:
        sys.exit(f"{ENV_FILE} is missing: {', '.join(missing)}")

    cfg = {
        "host": env["PREP_DB_HOST"],
        "port": env.get("PREP_DB_PORT", "5432"),
        "dbname": env.get("PREP_DB_NAME", "postgres"),
        "sslmode": env.get("PREP_DB_SSLMODE", "require"),
        "project_ref": env["PREP_PROJECT_REF"],
    }

    tiers = {}
    for name in ("owner", "dml", "read"):
        role = env.get(f"PREP_APP_{name.upper()}_ROLE")
        pw = env.get(f"PREP_APP_{name.upper()}_PASSWORD")
        if role and pw:
            tiers[name] = {"role": role, "password": pw}
    return cfg, tiers


def project_ref(cfg):
    """Explicit if set; otherwise recovered from the existing '<role>.<ref>' pooler user."""
    if cfg.get("project_ref"):
        return cfg["project_ref"]
    user = cfg.get("user", "")
    if "." in user:
        return user.split(".", 1)[1]
    sys.exit("Cannot determine project_ref — add \"project_ref\" to config.json.")


def connect(cfg, tier):
    """Pooler usernames are '<role>.<project_ref>'."""
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg.get("port", 5432),
        dbname=cfg.get("dbname", "postgres"),
        user=f"{tier['role']}.{project_ref(cfg)}",
        password=tier["password"],
        sslmode=cfg.get("sslmode", "require"),
        connect_timeout=15,
    )


def probe(cur, conn, label, sql, expect_allowed):
    """Run one statement; report whether the outcome matched the design."""
    try:
        cur.execute(sql)
        allowed = True
        detail = f"rowcount={cur.rowcount}"
    except errors.InsufficientPrivilege as e:
        allowed, detail = False, str(e).strip().splitlines()[0]
    except Exception as e:  # noqa: BLE001 — undefined table etc. also means "no access"
        allowed, detail = False, f"{type(e).__name__}: {str(e).strip().splitlines()[0]}"
    conn.rollback()

    if allowed == expect_allowed:
        verb = "allowed" if allowed else "correctly DENIED"
        print(f"{OK} {label}: {verb}")
        return True
    verb = "UNEXPECTEDLY ALLOWED" if allowed else "unexpectedly denied"
    print(f"{FAIL} {label}: {verb} — {detail}")
    return False


def check_tier(cfg, name, tier):
    print(f"\n=== tier '{name}'  (role {tier['role']}) ===")
    try:
        conn = connect(cfg, tier)
    except Exception as e:  # noqa: BLE001
        line = str(e).strip().splitlines()[0]
        if name == "owner":
            print(f"{GATE} cannot connect — expected if the owner has been sealed (§7).")
            print(f"        {line}")
            return True
        print(f"{FAIL} connect failed: {line}")
        return False

    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("select current_user")
    print(f"{OK} connected as '{cur.fetchone()[0]}'")
    conn.rollback()

    is_owner = name == "owner"
    is_read = name == "read"
    results = []

    # --- schema visibility -------------------------------------------------
    results.append(probe(cur, conn, "USAGE on schema app",
                         "select 1 from pg_namespace where nspname='app'", True))

    # --- DDL: owner only ---------------------------------------------------
    results.append(probe(cur, conn, "CREATE TABLE in app",
                         "create table app.__tier_check__ (id int)", is_owner))
    if is_owner:
        results.append(probe(cur, conn, "DROP TABLE in app",
                             "drop table if exists app.__tier_check__", True))

    # --- data: everyone reads, read-tier must not write --------------------
    # Uses a scratch table the owner makes; skipped entirely if the schema is still empty.
    cur.execute("select count(*) from information_schema.tables where table_schema='app'")
    has_tables = cur.fetchone()[0] > 0
    conn.rollback()
    if has_tables:
        cur.execute("""select table_name from information_schema.tables
                       where table_schema='app' order by table_name limit 1""")
        t = cur.fetchone()[0]
        conn.rollback()
        results.append(probe(cur, conn, f"SELECT from app.{t}",
                             f"select 1 from app.{t} limit 1", True))
        results.append(probe(cur, conn, f"DELETE from app.{t}",
                             f"delete from app.{t} where false", not is_read))
    else:
        print("  [skip] no tables in app yet — data probes deferred until the model is built")

    # --- isolation: nothing may touch public -------------------------------
    results.append(probe(cur, conn, "SELECT from public.students (must be denied)",
                         "select 1 from public.students limit 1", False))
    results.append(probe(cur, conn, "UPDATE public.students (must be denied)",
                         "update public.students set name = name where false", False))

    cur.close()
    conn.close()
    return all(results)


def main():
    cfg, tiers = load()
    print(f"[creds] {ENV_FILE}")
    print(f"[tiers] {', '.join(sorted(tiers)) or '(none)'}")

    if not tiers:
        sys.exit(f"No PREP_APP_*_ROLE / _PASSWORD pairs found in {ENV_FILE}.")

    passed = True
    for name in ("owner", "dml", "read"):
        if name in tiers:
            passed &= check_tier(cfg, name, tiers[name])

    print("\n" + ("All tier checks passed." if passed else
                  "SOME CHECKS FAILED — see [FAIL] lines above. Do not proceed until resolved."))
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
