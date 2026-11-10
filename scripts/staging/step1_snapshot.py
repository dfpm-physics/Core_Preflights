#!/usr/bin/env python3
"""Snapshot the tables step 1 touches or depends on to a local folder, and check the files against live counts.

READ ONLY on the database. The files hold REAL DATA (names, answers, scores) if you point this at the live project, so
the folder rules are strict and are checked before a connection is opened:
  * the folder must be ignored by git (`git check-ignore`), or lie outside every git work tree. Otherwise: REFUSED.
  * the default folder is _snapshots/step1-<UTC time> in this repository, which .gitignore already covers.
  * the folder must not already hold a snapshot.
  * a folder under a path named OneDrive gets a warning: a synced folder copies real data off this machine.

WHAT IS WRITTEN   One file per table, <table>.jsonl: one line per row, the whole row as JSON (jsonb text). A
manifest.json lists, per table, the row count read, the live count taken in the SAME transaction, the byte size and the
sha256 of the file. The read is one REPEATABLE READ READ ONLY transaction, so every table shows one moment and the
counts can be exact.

WHAT IT CHECKS
  1. lines written to a file == count(*) taken in the same transaction (exact; any difference is a failure)
  2. each file is read back from disk: line count and sha256 equal the manifest (catches a short write)
  3. a fresh count(*) now, in a new transaction (information only: a cadet may have written since; a table that
     SHRANK is flagged, because nothing in step 1 deletes a row)
Exit 0 only when 1 and 2 hold for every table and nothing shrank.

WHAT THIS IS NOT   It is not a restore. It saves rows as text and has no tool to put them back; the restore path is a
pg_dump taken by the restore drill. It holds the 15 tables of the grades fingerprint, which are the ones step 1 reads,
backfills or could move; it does not hold auth.users, Storage files, roles, functions or policies. Use it to prove that
what you can see now is what you saved, and to recover a specific row by hand.

  py -3.14 scripts/staging/step1_snapshot.py --env-file <file> --allow-production-read
  py -3.14 scripts/staging/step1_snapshot.py --env-file <file> --allow-production-read --verify <folder>
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import step1_conn as conn  # noqa: E402
import grades_fingerprint as gf  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TABLES = list(gf.TABLES)


def nearest_existing(p):
    p = Path(p).resolve()
    while not p.exists():
        p = p.parent
    return p


def git_ignores(folder):
    """True when git ignores `folder`, or when it lies outside every work tree. False means: do not write there."""
    anchor = nearest_existing(folder)
    anchor = anchor if anchor.is_dir() else anchor.parent
    inside = subprocess.run(["git", "-C", str(anchor), "rev-parse", "--is-inside-work-tree"],
                            capture_output=True, text=True)
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return True
    rel_probe = Path(folder).resolve() / "probe.jsonl"
    r = subprocess.run(["git", "-C", str(anchor), "check-ignore", "-q", "--", str(rel_probe)],
                       capture_output=True, text=True)
    return r.returncode == 0


def default_folder():
    return REPO / "_snapshots" / ("step1-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))


def file_facts(path):
    h, n = hashlib.sha256(), 0
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
            n += chunk.count(b"\n")
    return n, h.hexdigest(), Path(path).stat().st_size


def live_counts(c, tables):
    cur = c.cursor()
    out = {}
    for t in tables:
        cur.execute(f"SELECT count(*) FROM app.{t}")  # noqa: S608 -- fixed table names
        out[t] = cur.fetchone()[0]
    return out


def judge(manifest, disk, fresh):
    """Pure. Returns (failures, warnings) as lists of text. No database."""
    fails, warns = [], []
    for t, m in manifest["tables"].items():
        if m["lines_written"] != m["count_in_transaction"]:
            fails.append(f"{t}: wrote {m['lines_written']} line(s), the transaction counted {m['count_in_transaction']}")
        d = disk.get(t)
        if d is None:
            fails.append(f"{t}: file missing on disk")
            continue
        if d[0] != m["lines_written"] or d[1] != m["sha256"]:
            fails.append(f"{t}: the file on disk ({d[0]} lines) does not match the manifest ({m['lines_written']})")
        if fresh is not None and t in fresh:
            if fresh[t] < m["count_in_transaction"]:
                fails.append(f"{t}: live count {fresh[t]} is BELOW the saved {m['count_in_transaction']} (rows gone)")
            elif fresh[t] > m["count_in_transaction"]:
                warns.append(f"{t}: live count {fresh[t]} is above the saved {m['count_in_transaction']} (written since)")
    return fails, warns


def take(spec, folder):
    import psycopg2  # noqa: F401
    c = spec.connect()
    c.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
    cur = c.cursor()
    cur.execute("SET TIME ZONE 'UTC'")
    manifest = {"taken_at": datetime.now(timezone.utc).isoformat(), "project": spec.ref, "tables": {}}
    folder.mkdir(parents=True, exist_ok=False)
    for t in TABLES:
        cur.execute(f"SELECT count(*) FROM app.{t}")  # noqa: S608
        in_txn = cur.fetchone()[0]
        path = folder / f"{t}.jsonl"
        n = 0
        named = c.cursor(name=f"snap_{t}")
        named.itersize = 2000
        named.execute(f"SELECT to_jsonb(m)::text FROM app.{t} m")  # noqa: S608
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            for (js,) in named:
                fh.write(js + "\n")   # jsonb text escapes newlines, so one row is always one line
                n += 1
        named.close()
        manifest["tables"][t] = {"count_in_transaction": in_txn, "lines_written": n}
    c.rollback()
    for t in TABLES:
        n, sha, size = file_facts(folder / f"{t}.jsonl")
        manifest["tables"][t].update(sha256=sha, bytes=size)
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    c.close()
    return manifest


def check_folder_rules(folder):
    if "onedrive" in str(folder.resolve()).lower():
        print("WARNING  that folder is under OneDrive: real data would sync off this machine.", file=sys.stderr)
    if not git_ignores(folder):
        sys.exit("REFUSED  that folder is not ignored by git, and lies inside a git work tree. Nothing was read.")


def report(manifest, fails, warns):
    print(f"{'table':<24}{'saved':>9}{'file lines':>12}{'bytes':>12}")
    for t, m in manifest["tables"].items():
        print(f"{t:<24}{m['count_in_transaction']:>9}{m['lines_written']:>12}{m.get('bytes', 0):>12}")
    for w in warns:
        print("NOTE     " + w)
    for f in fails:
        print("FAIL     " + f)
    print("\nRESULT   " + ("every file matches its count, and nothing shrank" if not fails else f"{len(fails)} failure(s)"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    conn.add_args(ap, tier_default="read")
    ap.add_argument("--allow-production-read", action="store_true")
    ap.add_argument("--out", help="the folder to create (default _snapshots/step1-<time> in the repository)")
    ap.add_argument("--verify", metavar="FOLDER", help="re-check an existing snapshot folder against live counts; writes nothing")
    args = ap.parse_args(argv)

    if args.verify:
        folder = Path(args.verify)
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    else:
        folder = Path(args.out) if args.out else default_folder()
        check_folder_rules(folder)
        if folder.exists() and any(folder.iterdir()):
            sys.exit("REFUSED  that folder already holds files.")
    spec = conn.resolve(args, args.allow_production_read, "--allow-production-read")
    if args.verify:
        if manifest.get("project") != spec.ref:
            sys.exit("REFUSED  the snapshot and this connection name different projects.")
    else:
        print(f"reading {conn.label(spec)} into {folder.name} (read-only, one snapshot of the database)")
        manifest = take(spec, folder)
    disk = {t: file_facts(folder / f"{t}.jsonl") for t in manifest["tables"] if (folder / f"{t}.jsonl").is_file()}
    c = spec.connect()
    c.set_session(readonly=True, autocommit=False)
    fresh = live_counts(c, list(manifest["tables"]))
    c.rollback()
    c.close()
    fails, warns = judge(manifest, disk, fresh)
    report(manifest, fails, warns)
    print(f"folder   {folder}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
