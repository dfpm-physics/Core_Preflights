#!/usr/bin/env python
"""Apply a numbered migration from supabase/migrations/app/ as `prep_app_owner`.

DRY RUN BY DEFAULT, per CORE.md §4: prints the statement plan and rolls back unless
--commit is passed.

The owner is normally SEALED (app_schema_bootstrap.sql §7: ALTER ROLE prep_app_owner
NOLOGIN), so this script only works inside a deliberately opened DDL window. That is the
gate working — if it cannot connect, the schema is protected and someone has to choose to
open it. Re-seal when the change has landed.

Each migration file carries its own BEGIN/COMMIT, so the connection runs in autocommit and
lets the file drive the transaction. --commit strips nothing; --dry-run wraps the file in an
outer transaction that is rolled back, which is why the file's own COMMIT is neutralised
first (a COMMIT inside an explicit outer transaction would end it early).

Usage (from the repo root, via the project venv):
  .venv/Scripts/python scripts/app_migration/apply_app_migration.py 005_extensions.sql
  .venv/Scripts/python scripts/app_migration/apply_app_migration.py 005_extensions.sql --commit
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402

MIGRATIONS = ROOT / "supabase" / "migrations" / "app"


def already_applied(cur, path):
    """Cheap idempotence guard: does the first CREATE TABLE / ALTER TABLE target exist?"""
    m = re.search(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)",
                  path.read_text(encoding="utf-8"), re.I)
    if not m:
        return None
    cur.execute("""SELECT count(*) FROM information_schema.tables
                    WHERE table_schema='app' AND table_name=%s""", (m.group(1),))
    return m.group(1) if cur.fetchone()[0] else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("migration", help="file name inside supabase/migrations/app/")
    ap.add_argument("--commit", action="store_true", help="actually apply; otherwise roll back")
    args = ap.parse_args()

    path = MIGRATIONS / args.migration
    if not path.is_file():
        sys.exit(f"No such migration: {path}")

    sql = path.read_text(encoding="utf-8")

    cfg, tiers = load()
    if "owner" not in tiers:
        sys.exit("No PREP_APP_OWNER_ROLE/_PASSWORD in supabase/admin/.env — DDL tier unavailable.")

    try:
        conn = connect(cfg, tiers["owner"])
    except Exception as e:  # noqa: BLE001
        print("Cannot connect as prep_app_owner — the DDL window is closed (bootstrap §7).")
        print("  Re-open it as postgres:  ALTER ROLE prep_app_owner LOGIN;")
        print(f"  ({str(e).strip().splitlines()[0]})")
        sys.exit(2)

    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app, public")

    existing = already_applied(cur, path)
    if existing:
        print(f"Already applied — app.{existing} exists. Nothing to do.")
        conn.rollback(); cur.close(); conn.close()
        return

    # The file drives its own transaction; strip its BEGIN/COMMIT so this script controls
    # commit-vs-rollback and a dry run genuinely rolls back.
    body = re.sub(r"^\s*BEGIN\s*;", "", sql, count=1, flags=re.I | re.M)
    body = re.sub(r"^\s*COMMIT\s*;", "", body, count=1, flags=re.I | re.M)

    print(f"{'COMMITTING' if args.commit else 'DRY RUN — will roll back'}: {args.migration}\n")
    try:
        cur.execute(body)
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"FAILED — nothing applied.\n  {e}")
        cur.close(); conn.close()
        sys.exit(1)

    # Report what the migration produced, before deciding to keep it.
    cur.execute("""SELECT table_name FROM information_schema.tables
                    WHERE table_schema='app' ORDER BY table_name""")
    tables = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='app' ORDER BY tablename, policyname")
    policies = cur.fetchall()
    print(f"  tables in app: {len(tables)}")
    print(f"  policies in app: {len(policies)}")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
    else:
        conn.rollback()
        print("\nRolled back — dry run. Re-run with --commit to apply.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
