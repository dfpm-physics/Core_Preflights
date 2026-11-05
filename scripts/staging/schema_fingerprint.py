#!/usr/bin/env python3
"""Print a stable, diffable description of schema `app` — read-only.

Run it against production and against staging, then diff the two outputs. A difference means
the repo's migration files do not rebuild what production really holds.

It reads only the system catalog: tables and columns, constraints, indexes, RLS flags,
policies, functions, triggers, views, and table grants. It reads no rows of data, writes
nothing, and never prints a password.

CONNECTION (pick one)
  --url-env NAME     read a full connection string from environment variable NAME
                     (for staging: --url-env STAGING_DB_URL)
  --dotenv PATH      read PREP_DB_HOST/PORT/NAME/SSLMODE, PREP_PROJECT_REF and the
                     PREP_APP_READ_* role from a dotenv file (for production:
                     --dotenv supabase/admin/.env). Uses the read-only tier.

PRODUCTION IS REFUSED BY DEFAULT
  When the connection names the production project, the tool stops unless --allow-production-read
  is given. That flag is for the course director's own run from the live clone, using the
  read-only tier; an agent working in a development clone does not pass it. A connection string
  this tool cannot read a project from is also refused.

USAGE
  python scripts/staging/schema_fingerprint.py --dotenv supabase/admin/.env > prod.txt
  python scripts/staging/schema_fingerprint.py --url-env STAGING_DB_URL     > staging.txt
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

QUERIES = [
    ("table", """
        SELECT c.relname, c.relkind::text, c.relrowsecurity::text, c.relforcerowsecurity::text,
               pg_get_userbyid(c.relowner)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND c.relkind IN ('r','v','m','p')
         ORDER BY 1"""),
    ("column", """
        SELECT table_name, column_name, data_type, is_nullable, coalesce(column_default, '')
          FROM information_schema.columns WHERE table_schema = 'app'
         ORDER BY 1, 2"""),
    ("constraint", """
        SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid)
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
         WHERE n.nspname = 'app'
         ORDER BY 1, 2"""),
    ("index", """
        SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'app'
         ORDER BY 1, 2"""),
    ("policy", """
        SELECT tablename, policyname, cmd, array_to_string(roles, ','), permissive,
               coalesce(qual, ''), coalesce(with_check, '')
          FROM pg_policies WHERE schemaname = 'app'
         ORDER BY 1, 2"""),
    ("function", """
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               md5(pg_get_functiondef(p.oid)), p.prosecdef::text, pg_get_userbyid(p.proowner)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.prokind IN ('f','p')
         ORDER BY 1"""),
    ("trigger", """
        SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND NOT t.tgisinternal
         ORDER BY 1, 2"""),
    ("view", """
        SELECT viewname, md5(definition) FROM pg_views WHERE schemaname = 'app' ORDER BY 1"""),
    # Grants come from the raw ACLs, not information_schema.role_table_grants: that view shows
    # only grants involving the CURRENT role, so a read-only login sees its own and nothing else.
    ("grant", """
        SELECT c.relname,
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
               LATERAL aclexplode(c.relacl) a
         WHERE n.nspname = 'app' AND c.relkind IN ('r','v','m','p')
         GROUP BY 1, 2 ORDER BY 1, 2"""),
    ("column_grant", """
        SELECT c.relname, att.attname,
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
          FROM pg_attribute att
          JOIN pg_class c ON c.oid = att.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace,
               LATERAL aclexplode(att.attacl) a
         WHERE n.nspname = 'app' AND att.attacl IS NOT NULL AND att.attnum > 0
         GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"""),
    ("schema_grant", """
        SELECT n.nspname,
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
          FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
         WHERE n.nspname = 'app'
         GROUP BY 1, 2 ORDER BY 1, 2"""),
]


def read_dotenv(path):
    values = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def connection_ref(args):
    """The project the connection reaches, read the same way every staging tool reads it."""
    if args.url_env:
        try:
            return db_target.parse(os.environ.get(args.url_env, "").strip()).ref
        except db_target.DbTargetError as exc:
            sys.exit(str(exc))
    env = read_dotenv(args.dotenv)
    ref = env.get("PREP_PROJECT_REF", "").strip().lower()
    if not ref:
        sys.exit("REFUSED  the dotenv file names no PREP_PROJECT_REF.")
    # The host is what the connection really reaches: if it names production, the ref counts as
    # production whatever the other key says.
    if db_target.PRODUCTION_REF in env.get("PREP_DB_HOST", "").strip().lower():
        return db_target.PRODUCTION_REF
    return ref


def connect(args):
    import psycopg2

    if args.url_env:
        url = os.environ.get(args.url_env, "").strip()
        if not url:
            sys.exit(f"environment variable {args.url_env} is not set")
        return psycopg2.connect(url, connect_timeout=15)
    env = read_dotenv(args.dotenv)
    role = env["PREP_APP_READ_ROLE"]
    return psycopg2.connect(
        host=env["PREP_DB_HOST"],
        port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        user=f"{role}.{env['PREP_PROJECT_REF']}",
        password=env["PREP_APP_READ_PASSWORD"],
        connect_timeout=15,
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url-env")
    src.add_argument("--dotenv")
    ap.add_argument("--allow-production-read", action="store_true",
                    help="permit a read-only fingerprint of the production project (course director's own run)")
    args = ap.parse_args()

    ref = connection_ref(args)
    if ref == db_target.PRODUCTION_REF and not args.allow_production_read:
        sys.exit("REFUSED  that connection names the production project. Pass --allow-production-read "
                 "only for the course director's own read-only run.")

    conn = connect(args)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    for kind, sql in QUERIES:
        cur.execute(sql)
        for row in cur.fetchall():
            print(kind + " | " + " | ".join(" ".join(str(v).split()) for v in row))
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
