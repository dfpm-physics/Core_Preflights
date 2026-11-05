#!/usr/bin/env python3
"""Read and write the migration ledger (`app.migration_ledger`, created by migration 024).

The ledger records which migration files a database has received: chain, file name, a checksum,
who recorded it and when. This tool computes the checksums, compares them with a database, and
writes rows. It never runs a migration.

SAFETY
  * `files` and `sql` touch no database.
  * `status` and `record` connect only to the STAGING project, and refuse any other project,
    the production project in particular. For any other database, `sql` prints the INSERT for
    a person to run in that database's SQL editor.
  * `record` is a dry run unless --commit is given. It only inserts, and never overwrites a row.
  * Never prints a password or the connection string.

CHECKSUM
  sha256 of the file's bytes with a UTF-8 byte-order mark removed and every CRLF turned into LF,
  so the value is the same on a machine that rewrites line endings on checkout.

CHAINS
  app     supabase/migrations/app/*.sql     numbered 001, 002, ... and tracked file by file.
  public  supabase/migrations/*.sql         the original model's chain. Many of its files were
                                            never applied on purpose, so it is never recorded
                                            wholesale: name each file with --only.
  Rollback files live in a `rollback/` folder beside each chain and are never part of a chain.

COMMANDS
  files   [--chain app|public|all]
  sql     [--chain app] [--through NNN] [--only FILE ...] --method backfilled|applied [--by NAME]
  status  --expect-ref REF [--url-env STAGING_DB_URL]
  record  --expect-ref REF --method backfilled|applied [--chain app] [--through NNN]
          [--only FILE ...] [--by NAME] [--url-env STAGING_DB_URL] [--commit] [--rebaseline --reason TEXT [--rebaseline-applied]]

  --rebaseline   for rows already recorded with a different checksum, replace the checksum with the
                 file's current one. Needs --only and --reason. The old checksum and the reason are
                 appended to the row's note, and both checksums are printed, so the evidence of
                 what was recorded before is kept. A row recorded as 'applied' is refused unless
                 --rebaseline-applied is also given: it says the database ran the file as first
                 recorded, so replacing that is a stronger claim. Use it only after the staging
                 database has actually run the current text; it records that and runs nothing.

TYPICAL USE
  Not every numbered file is applied at the same step (023 is held back), so after migration 024
  has been applied, a person runs the output of:
      python scripts/staging/migration_ledger.py sql --through 022 --method backfilled
  and then, once 024 and 025 are applied, the output of:
      python scripts/staging/migration_ledger.py sql --only 024_migration_ledger.sql \
          025_pin_function_search_paths.sql --method applied
"""

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

PROD_REF = "shzvpmlnqfmzfmuxkowi"
STAGING_REF = "wkibeptktbnaddfynrwr"
REPO = Path(__file__).resolve().parents[2]
CHAIN_DIRS = {
    "app": REPO / "supabase" / "migrations" / "app",
    "public": REPO / "supabase" / "migrations",
}
LEDGER = "app.migration_ledger"
NAME_OK = re.compile(r"^[A-Za-z0-9_.-]+\.sql$")
NOTE_OK = re.compile(r"^[A-Za-z0-9 .,;:_()/-]{1,200}$")
BY_OK = re.compile(r"^[A-Za-z0-9_. @-]{1,64}$")


def fail(msg, code=2):
    print(f"REFUSED  {msg}", file=sys.stderr)
    sys.exit(code)


def checksum_bytes(data):
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def checksum(path):
    return checksum_bytes(Path(path).read_bytes())


# Files whose text was edited after a database had already run them, with the commit that holds
# the text that database ran. The edit changed how the file starts (it now sets its own search
# path); the schema it produces is the same. A backfill row for such a file records the checksum
# of the EARLIER text, with the note below, so the ledger does not claim the current text was run.
# `status` reports these rows separately from a plain match.
EARLIER_TEXT = {"009_analysis_runs.sql": "ec1d7c107b2f695804b8e6ae56a34bb9fa4548cd"}
EARLIER_NOTE = "applied earlier text, same resulting schema"
REBASELINE_NOTE = "checksum re-baselined: the file text was edited after it was first recorded"


def earlier_checksum(name):
    """Checksum of the earlier text of a file in EARLIER_TEXT, from git. None when git cannot say."""
    import subprocess
    try:
        out = subprocess.run(["git", "show", f"{EARLIER_TEXT[name]}:supabase/migrations/app/{name}"],
                             cwd=REPO, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return checksum_bytes(out)


def chain_files(chain):
    """Top-level .sql files of a chain, in order. Subfolders (rollback/) are not included."""
    return sorted(CHAIN_DIRS[chain].glob("*.sql"), key=lambda p: p.name)


def number(name):
    m = re.match(r"^(\d{3})_", name)
    return m.group(1) if m else None


def select_rows(chain, through=None, only=None, method=None):
    """Return [(chain, filename, checksum)] for the files a command was asked about.

    With method 'backfilled', a file listed in EARLIER_TEXT is given the checksum of the text the
    database actually ran, not of the text in the working copy.
    """
    files = {p.name: p for p in chain_files(chain)}
    if only:
        picked = []
        for name in only:
            if name not in files:
                fail(f"{name} is not a top-level file of the {chain} chain.")
            picked.append(files[name])
    else:
        if chain == "public":
            fail("the public chain is recorded file by file: name each file with --only.")
        picked = [p for p in files.values() if number(p.name)]
        if through:
            picked = [p for p in picked if number(p.name) <= through]
    rows = []
    for p in sorted(picked, key=lambda p: p.name):
        h = checksum(p)
        if method == "backfilled" and chain == "app" and p.name in EARLIER_TEXT:
            h = earlier_checksum(p.name) or fail(f"cannot read the earlier text of {p.name} from git; "
                                                  "run this from a clone that has that commit.")
        rows.append((chain, p.name, h))
    return rows


def lit(value):
    return "'" + value.replace("'", "''") + "'"


def default_by():
    return os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"


def check_by(by):
    if not BY_OK.match(by):
        fail("--by may hold only letters, digits, space and . _ @ - (64 characters at most).")
    return by


def row_note(chain, filename, method, note):
    return EARLIER_NOTE if (method == "backfilled" and chain == "app" and filename in EARLIER_TEXT) else note


def insert_sql(rows, method, by, note):
    values = ",\n".join(
        f"  ({lit(c)}, {lit(f)}, {lit(h)}, {lit(method)}, {lit(by)}, {lit(row_note(c, f, method, note))})"
        for c, f, h in rows
    )
    return (
        f"INSERT INTO {LEDGER} (chain, filename, checksum, method, applied_by, note)\nVALUES\n"
        f"{values}\nON CONFLICT (chain, filename) DO NOTHING;"
    )


def default_note(method):
    return ("recorded after the file was already applied" if method == "backfilled"
            else "applied and recorded together")


def connect_staging(args):
    url = os.environ.get(args.url_env, "").strip()
    if not url:
        fail(f"environment variable {args.url_env} is not set.")
    try:
        ref = db_target.require_staging(url, args.expect_ref).ref
    except db_target.DbTargetError as exc:
        fail(f"{exc} This tool connects to staging only; use the `sql` command for other databases.")
    if ref != args.expect_ref:
        fail(f"{args.url_env} names project {ref}, not {args.expect_ref}.")
    import psycopg2  # imported late so --help and refusals work without it

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = True
    return conn


def ledger_rows(cur):
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (LEDGER,))
    if not cur.fetchone()[0]:
        return None
    cur.execute(f"SELECT chain, filename, checksum, method, coalesce(note, '') FROM {LEDGER}")
    return {(c, f): (h, m, n) for c, f, h, m, n in cur.fetchall()}


def record_rows(cur, rows, method, by, note):
    """Insert rows as the schema owner. Returns how many were new. The caller owns the transaction."""
    cur.execute("SET LOCAL ROLE prep_app_owner")
    cur.execute(
        f"SELECT count(*) FROM {LEDGER}"
    )
    before = cur.fetchone()[0]
    cur.execute(insert_sql(rows, method, by, note))
    cur.execute(f"SELECT count(*) FROM {LEDGER}")
    return cur.fetchone()[0] - before


def cmd_files(args):
    chains = ["app", "public"] if args.chain == "all" else [args.chain]
    for chain in chains:
        for p in chain_files(chain):
            print(f"{chain:6} {p.name:60} {checksum(p)}")
    return 0


def cmd_sql(args):
    method, by = args.method, check_by(args.by or default_by())
    rows = select_rows(args.chain, args.through, args.only, method)
    if not rows:
        fail("no files selected.")
    print("-- Generated by scripts/staging/migration_ledger.py. Run as prep_app_owner.")
    print(f"-- Requires migration 024 (table {LEDGER}). {len(rows)} file(s), method {method}.")
    print("-- Safe to run twice: an existing row is left alone.")
    print("BEGIN;")
    print(insert_sql(rows, method, by, default_note(method)))
    print(f"SELECT chain, count(*) AS recorded FROM {LEDGER} GROUP BY chain ORDER BY chain;")
    print("COMMIT;")
    return 0


def cmd_status(args):
    conn = connect_staging(args)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    print(f"target   staging project {STAGING_REF}")
    rows = ledger_rows(cur)
    if rows is None:
        print(f"ledger   not installed ({LEDGER} does not exist). Apply migration 024 first.")
        return 1
    problems = 0
    earlier = 0
    app_files = {p.name: checksum(p) for p in chain_files("app") if number(p.name)}
    print(f"ledger   {len(rows)} row(s)")
    print("\napp chain")
    for name, h in app_files.items():
        got = rows.get(("app", name))
        if got is None:
            state = "NOT RECORDED"
            problems += 1
        elif got[0] != h and name in EARLIER_TEXT and got[1] == "backfilled" and got[2] == EARLIER_NOTE \
                and got[0] == earlier_checksum(name):
            state = "EARLIER TEXT (backfilled: applied earlier text, same resulting schema)"
            earlier += 1
        elif got[0] != h:
            state = f"CHECKSUM DIFFERS (recorded as {got[1]})"
            problems += 1
        else:
            state = f"ok ({got[1]})"
        print(f"  {name:55} {state}")
    for (chain, name), (h, m, _n) in sorted(rows.items()):
        if chain == "app" and name not in app_files:
            print(f"  {name:55} IN LEDGER, NO FILE IN THE REPO")
            problems += 1
    pub = {p.name: checksum(p) for p in chain_files("public")}
    print("\npublic chain (recorded file by file; only recorded rows are checked)")
    for (chain, name), (h, m, _n) in sorted(rows.items()):
        if chain != "public":
            continue
        if name not in pub:
            state = "IN LEDGER, NO FILE IN THE REPO"
            problems += 1
        elif pub[name] != h:
            state = f"CHECKSUM DIFFERS (recorded as {m})"
            problems += 1
        else:
            state = f"ok ({m})"
        print(f"  {name:55} {state}")
    tail = f" ({earlier} of them recorded against earlier text)" if earlier else ""
    print(f"\n{'all recorded files match' + tail if not problems else str(problems) + ' difference(s)'}")
    return 1 if problems else 0


def cmd_record(args):
    method, by = args.method, check_by(args.by or default_by())
    rows = select_rows(args.chain, args.through, args.only, method)
    if not rows:
        fail("no files selected.")
    conn = connect_staging(args)
    cur = conn.cursor()
    existing = ledger_rows(cur)
    if existing is None:
        fail(f"{LEDGER} does not exist. Apply migration 024 first.")
    new = [r for r in rows if (r[0], r[1]) not in existing]
    same = [r for r in rows if existing.get((r[0], r[1]), (None,))[0] == r[2]]
    differ = [r for r in rows if (r[0], r[1]) in existing and existing[(r[0], r[1])][0] != r[2]]
    if args.rebaseline:
        if not args.only:
            fail("--rebaseline needs --only, naming the files whose recorded checksum should be replaced.")
        if not (args.reason or "").strip():
            fail("--rebaseline needs --reason, saying why the recorded checksum is being replaced.")
        if not NOTE_OK.match(args.reason.strip()):
            fail("--reason may hold only letters, digits, space and . , ; : _ - ( ) / (200 characters at most).")
        applied = [f"{c}/{f}" for c, f, h in differ if existing[(c, f)][1] == "applied"]
        if applied and not args.rebaseline_applied:
            fail("refusing to re-baseline row(s) recorded as 'applied': " + ", ".join(applied)
                 + ". Pass --rebaseline-applied as well if the database really ran the current text.")
    print(f"target   staging project {STAGING_REF}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (add --commit to write)'}")
    print(f"method   {method}   by {by}")
    print(f"plan     {len(new)} new, {len(same)} already recorded and matching, "
          f"{len(differ)} recorded with a different checksum (left alone)")
    for c, f, h in new:
        print(f"  + {c}/{f}  {h[:12]}")
    for c, f, h in differ:
        print(f"  ! {c}/{f}  recorded {existing[(c, f)][0][:12]}, file now {h[:12]}")
    if not args.commit:
        print("dry run complete. Nothing written.")
        return 1 if differ else 0
    if args.rebaseline and differ:
        conn.autocommit = False
        try:
            cur.execute("SET LOCAL ROLE prep_app_owner")
            for c, f, h in differ:
                old_h, _m, old_note = existing[(c, f)]
                note = (f"{old_note} | " if old_note else "") + (
                    f"{REBASELINE_NOTE}; previous checksum {old_h}; reason: {args.reason.strip()}")
                print(f"  re-baseline {c}/{f}: {old_h} -> {h}")
                cur.execute(f"UPDATE {LEDGER} SET checksum = %s, note = %s WHERE chain = %s AND filename = %s",
                            (h, note, c, f))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        print(f"ok       {len(differ)} row(s) re-baselined")
        differ = []
    if new:
        conn.autocommit = False
        try:
            added = record_rows(cur, new, method, by, default_note(method))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        print(f"ok       {added} row(s) written")
    else:
        print("nothing to write.")
    return 1 if differ else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, chain_default="app", db=False, writing=False):
        p.add_argument("--chain", choices=["app", "public"] if writing else ["app", "public", "all"],
                       default=chain_default)
        if db:
            p.add_argument("--expect-ref", required=True, help="the project ref you expect to reach")
            p.add_argument("--url-env", default="STAGING_DB_URL")

    p = sub.add_parser("files")
    p.add_argument("--chain", choices=["app", "public", "all"], default="all")
    p.set_defaults(fn=cmd_files)

    p = sub.add_parser("sql")
    common(p, writing=True)
    p.add_argument("--through", help="highest migration number to include, e.g. 022")
    p.add_argument("--only", nargs="+", help="file names to include")
    p.add_argument("--method", required=True, choices=["applied", "backfilled"])
    p.add_argument("--by")
    p.set_defaults(fn=cmd_sql)

    p = sub.add_parser("status")
    p.add_argument("--expect-ref", required=True)
    p.add_argument("--url-env", default="STAGING_DB_URL")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("record")
    common(p, db=True, writing=True)
    p.add_argument("--through")
    p.add_argument("--only", nargs="+")
    p.add_argument("--method", required=True, choices=["applied", "backfilled"])
    p.add_argument("--by")
    p.add_argument("--commit", action="store_true")
    p.add_argument("--rebaseline", action="store_true")
    p.add_argument("--reason")
    p.add_argument("--rebaseline-applied", action="store_true")
    p.set_defaults(fn=cmd_record)

    args = ap.parse_args()
    if getattr(args, "through", None) and not re.fullmatch(r"\d{3}", args.through):
        fail("--through takes a three-digit migration number, e.g. 022.")
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
