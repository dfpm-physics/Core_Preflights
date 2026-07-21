#!/usr/bin/env python
"""Generate site/app/js/db-schema.js — the table catalogue the System > Data browser renders from.

WHY THIS EXISTS AT ALL
  faculty/system.html is a generic table browser: it has no per-table code, so it has to be told
  what tables and columns exist. The obvious source — PostgREST's OpenAPI spec at /rest/v1/ — is
  no longer reachable from the browser: it answers a publishable key with

      401  {"message":"Secret API key required",
            "hint":"Only secret API keys can be used for this endpoint."}

  Putting a secret key in a static page is not an option, so the catalogue is generated here from
  information_schema/pg_catalog and committed as a plain ES module. The site keeps its no-build,
  no-Node deploy path (CORE.md §2) — db-schema.js is a normal source file the browser imports.

WHAT IT DOES NOT DO
  This is READ-ONLY. It connects as PREP_APP_READ_ROLE (SELECT + EXECUTE only), runs five catalogue
  queries, and writes one file in the working tree. It performs no DDL and no DML, so it is not a
  coordination event under CORE.md §0 and needs no unseal of prep_app_owner.

DRIFT
  A committed catalogue can fall behind the database. tests/app-schema/test-db-schema.mjs re-runs
  this generator with --check and fails when the committed file no longer matches live, so drift is
  caught by the test suite rather than by a confusing empty column in the UI. Re-run this script
  (without --check) after any migration in supabase/migrations/app/ and commit the result.

USAGE (from the repo root, via the project venv)
  .venv/Scripts/python scripts/app/gen_db_schema.py            # write the file
  .venv/Scripts/python scripts/app/gen_db_schema.py --check    # exit 1 if the file is stale
  .venv/Scripts/python scripts/app/gen_db_schema.py --stdout   # print, write nothing

Credentials come from supabase/admin/.env (gitignored), same keys and same parser convention as
supabase/admin/app_tier_check.py. Nothing is read from supabase/admin/config.json — that credential
belongs to the legacy `public` tooling and is untouched here.
"""
import argparse
import json
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (.venv/Scripts/python).")

REPO = Path(__file__).resolve().parents[2]
ENV_FILE = REPO / "supabase" / "admin" / ".env"
OUT_FILE = REPO / "site" / "app" / "js" / "db-schema.js"
SCHEMA = "app"

# Columns a human reads a row by, best first. Used to label foreign keys as "phys-215" rather
# than "8f3c…"; falls back to the primary key when a table has none of these.
LABEL_PREFERENCE = ("code", "slug", "title", "name", "label", "event", "kind", "scope")


def read_env(path):
    """Minimal KEY=VALUE parser — stdlib only, mirrors app_tier_check.py."""
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


def connect():
    if not ENV_FILE.is_file():
        sys.exit(f"No credentials at {ENV_FILE} — see supabase/admin/app_schema_bootstrap.sql.")
    env = read_env(ENV_FILE)
    role, password = env.get("PREP_APP_READ_ROLE"), env.get("PREP_APP_READ_PASSWORD")
    if not role or not password:
        sys.exit(f"{ENV_FILE} is missing PREP_APP_READ_ROLE / PREP_APP_READ_PASSWORD.")
    ref = env.get("PREP_PROJECT_REF", "")
    # Supabase's session pooler wants the project ref folded into the user name.
    user = f"{role}.{ref}" if ref and "." not in role else role
    return psycopg2.connect(
        host=env["PREP_DB_HOST"],
        port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        user=user,
        password=password,
        connect_timeout=20,
    )


# ── Catalogue queries ─────────────────────────────────────────────────────────────────────────
# Base tables only. Views (terms_awaiting_freeze) are deliberately excluded: PostgREST exposes
# them read-only, and a browser row-editor over a view would offer edits that cannot land.

Q_TABLES = """
SELECT c.relname,
       obj_description(c.oid, 'pg_class') AS comment,
       c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relkind = 'r'
ORDER BY c.relname;
"""

Q_COLUMNS = """
SELECT c.table_name, c.column_name, c.ordinal_position, c.data_type, c.udt_name,
       c.is_nullable, c.column_default, c.character_maximum_length,
       c.is_identity, c.is_generated,
       col_description(pc.oid, c.ordinal_position) AS comment
FROM information_schema.columns c
JOIN pg_class pc ON pc.relname = c.table_name
JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
WHERE c.table_schema = %s AND pc.relkind = 'r'
ORDER BY c.table_name, c.ordinal_position;
"""

Q_PRIMARY_KEYS = """
SELECT rel.relname,
       (SELECT array_agg(a.attname ORDER BY x.ord)
          FROM unnest(con.conkey) WITH ORDINALITY x(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = x.attnum) AS cols
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = %s AND con.contype = 'p';
"""

# confdeltype drives the cascade preview: 'c' CASCADE, 'n' SET NULL, 'r' RESTRICT,
# 'a' NO ACTION, 'd' SET DEFAULT.
Q_FOREIGN_KEYS = """
SELECT con.conname, src.relname AS table_name,
       (SELECT array_agg(a.attname ORDER BY x.ord)
          FROM unnest(con.conkey) WITH ORDINALITY x(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = x.attnum) AS cols,
       tgt.relname AS ref_table,
       (SELECT array_agg(a.attname ORDER BY x.ord)
          FROM unnest(con.confkey) WITH ORDINALITY x(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = x.attnum) AS ref_cols,
       con.confdeltype
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace n ON n.oid = src.relnamespace
JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
WHERE n.nspname = %s AND tn.nspname = %s AND con.contype = 'f'
ORDER BY src.relname, con.conname;
"""

Q_CHECKS = """
SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = %s AND con.contype = 'c'
ORDER BY rel.relname, con.conname;
"""

# Which commands have ANY policy at all. A table with no write policy can never be written
# through PostgREST by anyone, which the UI states up front instead of failing at save time.
Q_POLICIES = """
SELECT tablename, cmd, policyname
FROM pg_policies
WHERE schemaname = %s
ORDER BY tablename, cmd;
"""


def parse_check_values(defn, columns):
    """Pull the allowed value set out of a CHECK.

    The app schema uses no Postgres enums — every closed set is text + CHECK (001_core_model.sql
    comments say so deliberately, so adding a kind is an INSERT not a migration). The shapes that
    appear in practice are:

        CHECK ((status = ANY (ARRAY['draft'::text, 'committed'::text])))
        CHECK ((modality = ANY (ARRAY['written'::text, 'interactive'::text])))

    Returns (column_name, [values]) or (None, None) when the constraint is a range/comparison
    check rather than a value set — those stay unparsed on purpose; the DB remains the enforcer
    and the UI surfaces the violation message if a write breaks one.
    """
    if "= ANY (ARRAY[" not in defn:
        return None, None
    head, _, tail = defn.partition("= ANY (ARRAY[")
    col = head.strip().lstrip("(").strip().rstrip(")").strip()
    col = col.split()[-1].strip("()")
    if col not in columns:
        return None, None
    body = tail.split("]")[0]
    values = []
    for chunk in body.split(","):
        chunk = chunk.strip()
        if chunk.startswith("'"):
            end = chunk.find("'", 1)
            if end > 0:
                values.append(chunk[1:end])
    return (col, values) if values else (None, None)


def build(conn):
    cur = conn.cursor()

    cur.execute(Q_TABLES, (SCHEMA,))
    tables = {name: {"name": name, "comment": comment, "rls": rls, "columns": []}
              for name, comment, rls in cur.fetchall()}

    cur.execute(Q_PRIMARY_KEYS, (SCHEMA,))
    pks = {name: list(cols or []) for name, cols in cur.fetchall()}

    cur.execute(Q_COLUMNS, (SCHEMA,))
    for (tbl, col, pos, dtype, udt, nullable, default, maxlen,
         identity, generated, comment) in cur.fetchall():
        if tbl not in tables:
            continue
        tables[tbl]["columns"].append({
            "name": col,
            "type": udt if dtype == "USER-DEFINED" else dtype,
            "udt": udt,
            "nullable": nullable == "YES",
            "default": default,
            "maxLength": maxlen,
            # Identity/generated/defaulted columns are omitted from the insert form: the database
            # fills them, and offering an empty uuid box invites a bad write.
            "generated": identity == "YES" or generated != "NEVER",
            "comment": comment,
        })

    cur.execute(Q_FOREIGN_KEYS, (SCHEMA, SCHEMA))
    fks = {}
    for conname, tbl, cols, ref_tbl, ref_cols, deltype in cur.fetchall():
        fks.setdefault(tbl, []).append({
            "name": conname,
            "columns": list(cols or []),
            "refTable": ref_tbl,
            "refColumns": list(ref_cols or []),
            "onDelete": {"c": "cascade", "n": "set null", "r": "restrict",
                         "a": "no action", "d": "set default"}.get(deltype, "no action"),
        })

    cur.execute(Q_CHECKS, (SCHEMA,))
    enums = {}
    for tbl, conname, defn in cur.fetchall():
        if tbl not in tables:
            continue
        names = {c["name"] for c in tables[tbl]["columns"]}
        col, values = parse_check_values(defn, names)
        if col:
            enums.setdefault(tbl, {})[col] = values

    cur.execute(Q_POLICIES, (SCHEMA,))
    policies = {}
    for tbl, cmd, _ in cur.fetchall():
        policies.setdefault(tbl, set()).add((cmd or "ALL").upper())

    out = {}
    for name, meta in sorted(tables.items()):
        cols = meta["columns"]
        colnames = [c["name"] for c in cols]
        pk = pks.get(name, [])
        label = next((c for c in LABEL_PREFERENCE if c in colnames), pk[0] if pk else None)
        cmds = policies.get(name, set())
        writable = bool(cmds & {"ALL", "INSERT", "UPDATE", "DELETE"})
        for c in cols:
            c["pk"] = c["name"] in pk
        out[name] = {
            "name": name,
            "comment": meta["comment"],
            "rls": meta["rls"],
            "primaryKey": pk,
            "labelColumn": label,
            "columns": cols,
            "foreignKeys": fks.get(name, []),
            "enums": enums.get(name, {}),
            # Structural only: "some policy exists for this command". It cannot know whether the
            # policy's predicate admits THIS caller, so the UI still handles a runtime RLS refusal.
            "policyCommands": sorted(cmds),
            "writable": writable,
        }
    return out


def render(catalog):
    tables = json.dumps(catalog, indent=2, sort_keys=False, ensure_ascii=False)
    tables = "\n".join("  " + line if line.strip() else line for line in tables.splitlines()).strip()
    return f"""// db-schema.js — GENERATED FILE. Do not edit by hand.
//
// The table catalogue for schema `app`, rendered by faculty/system.html (System > Data). It is
// generated because PostgREST's OpenAPI endpoint now refuses publishable keys ("Secret API key
// required"), so a static page cannot introspect the database at runtime and a static page must
// never carry a secret key.
//
// Regenerate after any migration in supabase/migrations/app/ and commit the result:
//   .venv/Scripts/python scripts/app/gen_db_schema.py
//
// tests/app-schema/test-db-schema.mjs fails when this file drifts from live.
//
// Source: scripts/app/gen_db_schema.py · schema `app` · {len(catalog)} tables
// Shape per table: {{ name, comment, rls, primaryKey[], labelColumn, columns[], foreignKeys[],
//                    enums{{col:[values]}}, policyCommands[], writable }}
//
// `writable` and `policyCommands` are STRUCTURAL — they report that a policy exists for a command,
// not that it admits the current caller. Callers must still handle a runtime RLS refusal.

export const DB_SCHEMA = {tables};

/** Table names in a stable, human-sensible order for the picker. */
export const TABLE_NAMES = Object.keys(DB_SCHEMA);

/** Column metadata for one table, or undefined. */
export function tableMeta(name) {{
  return DB_SCHEMA[name];
}}

/** Tables whose foreign keys point AT `name`, with the delete rule that would apply. */
export function referrers(name) {{
  const out = [];
  for (const [tbl, meta] of Object.entries(DB_SCHEMA)) {{
    for (const fk of meta.foreignKeys) {{
      if (fk.refTable === name) out.push({{ table: tbl, fk }});
    }}
  }}
  return out;
}}
"""


def main():
    ap = argparse.ArgumentParser(description="Generate site/app/js/db-schema.js from schema `app`.")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed file differs from live (writes nothing)")
    ap.add_argument("--stdout", action="store_true", help="print the module, write nothing")
    args = ap.parse_args()

    conn = connect()
    try:
        catalog = build(conn)
    finally:
        conn.close()

    text = render(catalog)

    if args.stdout:
        sys.stdout.write(text)
        return 0

    if args.check:
        if not OUT_FILE.is_file():
            print(f"[STALE] {OUT_FILE.relative_to(REPO)} does not exist — run the generator.")
            return 1
        current = OUT_FILE.read_text(encoding="utf-8")
        if current != text:
            print(f"[STALE] {OUT_FILE.relative_to(REPO)} differs from live schema `app`.")
            print("        Re-run: .venv/Scripts/python scripts/app/gen_db_schema.py")
            return 1
        print(f"[ok] {OUT_FILE.relative_to(REPO)} matches live schema `app` "
              f"({len(catalog)} tables).")
        return 0

    OUT_FILE.write_text(text, encoding="utf-8")
    cols = sum(len(t["columns"]) for t in catalog.values())
    fkc = sum(len(t["foreignKeys"]) for t in catalog.values())
    print(f"[ok] wrote {OUT_FILE.relative_to(REPO)}")
    print(f"     {len(catalog)} tables · {cols} columns · {fkc} foreign keys")
    ro = [n for n, t in catalog.items() if not t["writable"]]
    if ro:
        print(f"     no write policy at all: {', '.join(ro)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
