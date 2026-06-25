#!/usr/bin/env python
"""Connectivity + permission check for the scoped `claude_code_recker` DB role.

Reads connection params from PG* environment variables (PGHOST, PGPORT, PGUSER,
PGPASSWORD, PGDATABASE, PGSSLMODE) so NO secret is ever written to disk by this script.
It verifies, without persisting any data:
  * connection + identity (current_user)
  * READ on the key course tables
  * WRITE (INSERT + UPDATE) — each rolled back, so nothing actually changes
  * DDL is DENIED (ALTER / DROP) — proving the role cannot alter the schema

Run from the project venv, e.g. (bash):
  PGHOST=... PGUSER=claude_code_recker PGPASSWORD=... PGSSLMODE=require \
    .venv/Scripts/python supabase/admin/db_check.py
"""
import json
import os
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2 import errors
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

# Gitignored credential file, kept next to this script (supabase/admin/config.json).
CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


def _find_config():
    return CONFIG_PATH if CONFIG_PATH.is_file() else None


def resolve_params():
    """PG* env vars win (used for first-run testing); otherwise read the config file."""
    if os.environ.get("PGHOST"):
        return {
            "host": os.environ.get("PGHOST"),
            "port": os.environ.get("PGPORT", "5432"),
            "dbname": os.environ.get("PGDATABASE", "postgres"),
            "user": os.environ.get("PGUSER"),
            "password": os.environ.get("PGPASSWORD"),
            "sslmode": os.environ.get("PGSSLMODE", "require"),
        }, "environment variables"
    path = _find_config()
    if path is None:
        sys.exit(f"No PG* env vars and no config.json found at {CONFIG_PATH}.")
    cfg = json.loads(path.read_text(encoding="utf-8"))
    return {
        "host": cfg["host"],
        "port": cfg.get("port", 5432),
        "dbname": cfg.get("dbname", "postgres"),
        "user": cfg["user"],
        "password": cfg["password"],
        "sslmode": cfg.get("sslmode", "require"),
    }, str(path)


def main():
    params, source = resolve_params()
    print(f"[CONFIG]  {source}")
    try:
        conn = psycopg2.connect(
            connect_timeout=int(os.environ.get("PGCONNECT_TIMEOUT", "12")),
            **params,
        )
    except Exception as e:  # noqa: BLE001
        print(f"[CONNECT] FAILED: {type(e).__name__}: {str(e).strip()}")
        print("\nIf this is a timeout / 'network is unreachable', the direct host is")
        print("IPv6-only from here — we'll need the Session pooler string instead.")
        sys.exit(1)

    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("select current_user, inet_server_addr(), version()")
    who, addr, ver = cur.fetchone()
    print(f"[CONNECT] ok as '{who}'   server_ip={addr}")
    print(f"          {ver.splitlines()[0]}")
    conn.rollback()

    print("\n-- READ --")
    for t in ("interactions", "preflight_interaction_reports", "students", "sections"):
        try:
            cur.execute(f"select count(*) from {t}")
            print(f"  read {t}: {cur.fetchone()[0]} rows  OK")
        except Exception as e:  # noqa: BLE001
            print(f"  read {t}: FAIL {type(e).__name__}: {str(e).strip()}")
        conn.rollback()

    print("\n-- WRITE (rolled back; nothing persists) --")
    try:
        cur.execute(
            "insert into interactions (id, course_id, title, is_published) "
            "values ('__cc_perm_test__', 'phys-215', 'permission test', false)"
        )
        print(f"  INSERT interactions: OK (rowcount={cur.rowcount})  -> rolled back")
    except Exception as e:  # noqa: BLE001
        print(f"  INSERT interactions: FAIL {type(e).__name__}: {str(e).strip()}")
    conn.rollback()
    try:
        cur.execute("update interactions set title = title where false")
        print(f"  UPDATE interactions: OK (rowcount={cur.rowcount})")
    except Exception as e:  # noqa: BLE001
        print(f"  UPDATE interactions: FAIL {type(e).__name__}: {str(e).strip()}")
    conn.rollback()

    print("\n-- DDL (must be DENIED) --")
    for label, sql in (
        ("ALTER TABLE add column", "alter table interactions add column __cc_perm_test int"),
        ("DROP TABLE", "drop table preflight_interaction_reports"),
    ):
        try:
            cur.execute(sql)
            print(f"  {label}: !!! UNEXPECTEDLY ALLOWED -> rolled back")
        except errors.InsufficientPrivilege as e:
            print(f"  {label}: correctly DENIED ({str(e).strip().splitlines()[0]})")
        except Exception as e:  # noqa: BLE001
            print(f"  {label}: DENIED/other ({type(e).__name__}: {str(e).strip().splitlines()[0]})")
        conn.rollback()

    cur.close()
    conn.close()
    print("\nAll checks complete.")


if __name__ == "__main__":
    main()
