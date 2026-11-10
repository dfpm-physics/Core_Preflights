#!/usr/bin/env python3
"""Apply step 1 files, ledger SQL and one-off statements without psql, and record transaction numbers.

WHY   The runbook drives psql in loops. psql is not installed on the machine that rehearses this, and a psql
session records no transaction number. This runs the same files through psycopg2, stops at the first failure
(like -v ON_ERROR_STOP=1), and appends the transaction numbers it used to a file the grade comparison reads.

DRY RUN BY DEFAULT   Without --commit nothing is executed: it checks the connection and the role, lists each file with
its size and checksum, and says what it would run. --commit runs them, in the order given, and stops at the first failure.
The live project additionally needs --allow-production-write and an --expect-ref that matches.

COMMANDS
  apply NAME...       run migration files from <root>/supabase/migrations/app. NAME is a number (026), a stem
                      (026_assignment_kinds_seed) or a file name. Each file carries its own BEGIN and COMMIT.
  rollback NAME...    the same for <root>/supabase/migrations/app/rollback (NAME 043 finds 043_*_ROLLBACK.sql). Order is
                      the order given; roll back newest first. --unlock NNN runs SET prep.rollback_loses_rows = 'NNN'
                      in the same session first, as the runbook's -c/-f pair does; it applies to the file whose number
                      is NNN only and is refused for any other file in the list.
  sql --file F        run a SQL file (for example the ledger SQL that migration_ledger.py prints).
  sql --command TEXT  run one statement (the training UPDATE, NOTIFY pgrst).

TRANSACTION NUMBERS   A file that carries its own COMMIT cannot report its own number, so the tool reads
txid_current() just before and just after the file in the same session and records every number from the first to the
last. That range holds the file's own transaction and any it opened (a subtransaction's number lies inside it). On a
quiet database nothing else falls in it; on a busy one the range also holds other sessions' numbers, which makes the
comparison stricter (a row changed by a cadet inside the range reads as DEFECT instead of Explained). The tool prints
the width of each range; more than 50 numbers for one file means someone else was writing. --xid-file appends them.

CONNECTION   --env-file PATH (alias --dotenv) with --tier owner for migrations (default), or --url-env NAME for a
scratch database. --set-role NAME runs SET ROLE after connecting (a scratch database connected as a superuser).

  py -3.14 scripts/staging/step1_apply.py apply 024 025 --env-file <file> --expect-ref <ref> --allow-production-write
  py -3.14 scripts/staging/step1_apply.py apply 024 025 --env-file <file> --expect-ref <ref> --allow-production-write --commit --xid-file C:\\prep-step1\\xids.txt
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import step1_conn as conn  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
WIDE = 50


def find_file(folder, name, rollback):
    """The one file in `folder` that NAME means, or exit."""
    stem = name[:-4] if name.lower().endswith(".sql") else name
    if re.fullmatch(r"\d{3}", stem):
        pattern = f"{stem}_*_ROLLBACK.sql" if rollback else f"{stem}_*.sql"
    else:
        pattern = f"{stem}_ROLLBACK.sql" if rollback and not stem.endswith("_ROLLBACK") else f"{stem}.sql"
    hits = sorted(p for p in folder.glob(pattern) if (("ROLLBACK" in p.name) == rollback))
    if len(hits) != 1:
        sys.exit(f"REFUSED  {name!r} matches {len(hits)} file(s) in {folder}; it must match exactly one.")
    return hits[0]


def checksum(path):
    text = path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def check_unlock(files, unlock):
    """The unlock number must name exactly the file it is meant for."""
    if unlock is None:
        return
    nums = [f.name[:3] for f in files]
    if unlock not in nums:
        sys.exit(f"REFUSED  --unlock {unlock} does not match any file in the list ({', '.join(nums)}).")
    if len(files) != 1:
        sys.exit("REFUSED  --unlock applies to one file at a time. Run the others without it.")


def run_one(c, label, sql, pre=None):
    """Run text on an autocommit connection. Returns (ok, first_xid, last_xid, message)."""
    cur = c.cursor()
    cur.execute("SELECT txid_current()")
    x0 = cur.fetchone()[0]
    try:
        if pre:
            cur.execute(pre)
        cur.execute(sql)
    except Exception as exc:  # noqa: BLE001
        try:
            cur.execute("ROLLBACK")
        except Exception:  # noqa: BLE001
            pass
        return False, x0, x0, f"{type(exc).__name__}: {str(exc).strip().splitlines()[0]}"
    cur.execute("SELECT txid_current()")
    x1 = cur.fetchone()[0]
    return True, x0, x1, ""


def record(path, label, x0, x1):
    width = x1 - x0 + 1
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"# {label}\n")
        for x in range(x0, x1 + 1):
            fh.write(f"{x}\n")
    return width


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("apply", "rollback", "sql"):
        p = sub.add_parser(name)
        conn.add_args(p, tier_default="owner")
        p.add_argument("--expect-ref", required=True)
        p.add_argument("--allow-production-write", action="store_true")
        p.add_argument("--commit", action="store_true")
        p.add_argument("--xid-file")
        p.add_argument("--set-role")
        p.add_argument("--root", default=str(REPO), help="repository root holding supabase/migrations (default: this one)")
        if name == "sql":
            g = p.add_mutually_exclusive_group(required=True)
            g.add_argument("--file")
            g.add_argument("--command")
        else:
            p.add_argument("names", nargs="+")
            if name == "rollback":
                p.add_argument("--unlock", metavar="NNN")
    args = ap.parse_args(argv)

    spec = conn.resolve(args, args.allow_production_write, "--allow-production-write")
    conn.check_expect_ref(spec, args.expect_ref)

    # what will run: (label, sql text, pre statement)
    plan = []
    if args.cmd in ("apply", "rollback"):
        base = Path(args.root) / "supabase" / "migrations" / "app"
        folder = base / "rollback" if args.cmd == "rollback" else base
        if not folder.is_dir():
            sys.exit(f"REFUSED  {folder} is not a folder.")
        files = [find_file(folder, n, args.cmd == "rollback") for n in args.names]
        if len(set(files)) != len(files):
            sys.exit("REFUSED  the same file is named twice.")
        unlock = getattr(args, "unlock", None)
        check_unlock(files, unlock)
        for f in files:
            pre = f"SET prep.rollback_loses_rows = '{unlock}'" if unlock else None
            plan.append((f.name, f.read_bytes().decode("utf-8-sig"), pre, checksum(f)))
    else:
        if args.file:
            text = Path(args.file).read_bytes().decode("utf-8-sig")
            plan.append((Path(args.file).name, text, None, checksum(Path(args.file))))
        else:
            plan.append(("command", args.command, None, hashlib.sha256(args.command.encode()).hexdigest()[:12]))

    c = spec.connect()
    c.autocommit = True
    cur = c.cursor()
    if args.set_role:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", args.set_role):
            sys.exit("REFUSED  --set-role must be a plain role name.")
        cur.execute(f"SET ROLE {args.set_role}")
    cur.execute("SELECT current_user, session_user")
    cu, su = cur.fetchone()
    print(f"target   {conn.label(spec)}; running as {cu} (login {su})")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (nothing is executed)'}")
    for label, text, pre, ck in plan:
        print(f"  {'will run' if not args.commit else 'queued  '} {label}  ({len(text)} chars, checksum {ck})")
    if not args.commit:
        print("dry run  nothing executed. Add --commit to run.")
        c.close()
        return 0

    for label, text, pre, _ck in plan:
        ok, x0, x1, msg = run_one(c, label, text, pre)
        if not ok:
            print(f"STOP     {label} failed: {msg}")
            print("         Nothing after it was run. Do not repair by improvising; see the runbook rollback table.")
            c.close()
            return 1
        note = ""
        if args.xid_file:
            width = record(args.xid_file, label, x0, x1)
            note = f"; {width} transaction number(s) recorded" + (" -- WIDE: another session was writing" if width > WIDE else "")
        print(f"ok       {label}{note}")
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
