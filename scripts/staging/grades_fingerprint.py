#!/usr/bin/env python3
"""Row-by-row proof that a change left the grades and the work around them alone.

This is the GRADES fingerprint. It is not schema_fingerprint.py, which describes structure and
reads no rows, and it is not fingerprint_diff.py, which compares two of those.

WHAT IT HASHES
  For every row of 15 tables, md5 of the whole row as JSON minus the columns the v2 migrations add,
  keyed by primary key, plus a row count per table. Whole rows mean no column is forgotten and no
  NULL can blank a concatenation. The session runs SET TIME ZONE 'UTC' and refuses any other zone
  (a timestamptz renders in the session zone, so one row hashes two ways under two zones). All
  tables are read in ONE REPEATABLE READ READ ONLY transaction, so they share one snapshot.

WHAT IT PRINTS   Table names, counts and row keys. Never a name, a score or an answer. A row key is
                 a primary key (a uuid, or a cadet id for students).

MODES
  --save FILE                 write every row's hash, updated_at and column list to FILE. FILE must be
                              outside the repository.
  --diff FILE [--xids FILE]   compare the live database to a saved FILE and classify each row. --xids
                              is a text file of transaction ids (one per line) that this change recorded.
  --controls                  STAGING ONLY, WRITES. Proves the diff can tell the classes apart: it saves,
                              changes one row in an ordinary session (must show Explained), changes
                              another inside a recorded transaction (must show Defect), then diffs.
                              Exits 0 only when both behave.

CLASSES
  same hash                                                   fine
  changed, xmin is a recorded transaction id                  DEFECT   our own work moved a row
  changed, updated_at unchanged, table has a touch trigger    DEFECT   something wrote around the trigger
  any other change                                            EXPLAINED  listed, to check against who was working
  new row                                                     listed
  row gone                                                    DEFECT   unless a person can name the delete
  a column that was added and is not on ADDED, or one removed DEFECT   the list of added columns is part of the proof
The diff exits non-zero only on a DEFECT. A cadet committing during the window is Explained.

CONNECTION   --url-env NAME (staging: STAGING_DB_URL) or --dotenv PATH (the read-only tier, for the
             course director's run). The live project is refused unless --allow-production-read.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
import schema_fingerprint as sf  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

TABLES = ["grades", "submissions", "submission_activities", "enrollments", "sections", "students",
          "assignment_offerings", "offering_activities", "activities", "assignments",
          "assignment_due_dates", "extensions", "course_offerings", "courses", "terms"]

# Columns the step 1 migrations add to these tables. They are left out of every hash, so a migration
# or the backfill that fills them cannot look like a change to a row.
ADDED = {
    "assignment_offerings": ["late_allowed", "is_bonus", "allow_over_max", "prog_included", "grades_release_at",
                             "attempt_limit", "attempt_rule", "part_set_id", "entered_on_new_page", "is_group_work"],
    "offering_activities": ["delivery", "grading", "warn_earns_full"],
    "assignments": ["origin_assignment_id"],
    "courses": ["subject", "course_number"],
    "terms": ["report_code"],
    "students": ["class_year"],
    "grades": ["over_max_allowed", "student_group_id", "student_group_adjusted"],
}


class Defect(Exception):
    pass


def pk_columns(cur, table):
    cur.execute("""SELECT a.attname FROM pg_index i
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                    WHERE i.indrelid = %s::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)""",
                (f"app.{table}",))
    return [r[0] for r in cur.fetchall()]


def columns(cur, table):
    cur.execute("""SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'app' AND table_name = %s ORDER BY 1""", (table,))
    return [r[0] for r in cur.fetchall()]


def has_touch(cur, table):
    cur.execute("""SELECT count(*) FROM pg_trigger t
                    WHERE t.tgrelid = %s::regclass AND NOT t.tgisinternal
                      AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16 AND (t.tgtype & 1) = 1""",
                (f"app.{table}",))
    return cur.fetchone()[0] > 0


def snapshot(conn):
    """Read every table once, in one repeatable-read read-only transaction."""
    conn.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
    cur = conn.cursor()
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute("SHOW TimeZone")
    if cur.fetchone()[0] != "UTC":
        raise SystemExit("REFUSED  the session time zone is not UTC.")
    snap = {"tz": "UTC", "taken_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    for table in TABLES:
        cols = columns(cur, table)
        pks = pk_columns(cur, table)
        if not pks:
            raise SystemExit(f"table {table} has no primary key")
        keyexpr = "concat_ws('|', " + ", ".join(f'm."{c}"::text' for c in pks) + ")"
        upd = 'm."updated_at"::text' if "updated_at" in cols else "NULL"
        cur.execute(f"""SELECT {keyexpr}, md5((to_jsonb(m) - %s::text[])::text), m.xmin::text, {upd}
                          FROM app.{table} m ORDER BY 1""",  # noqa: S608 -- fixed table names
                    (ADDED.get(table, []),))
        rows = {k: [h, x, u] for k, h, x, u in cur.fetchall()}
        snap["tables"][table] = {"cols": cols, "touch": has_touch(cur, table), "rows": rows}
    conn.rollback()
    return snap


def classify(old, new, xids):
    """Return (defects, explained, new_rows, counts). Each list holds (table, key, why)."""
    defects, explained, added = [], [], []
    counts = {}
    for table in TABLES:
        o, n = old["tables"][table], new["tables"][table]
        gained = sorted(set(n["cols"]) - set(o["cols"]))
        lost = sorted(set(o["cols"]) - set(n["cols"]))
        unknown = [c for c in gained if c not in ADDED.get(table, [])]
        if unknown:
            defects.append((table, "-", "column added that is not on the list of added columns: " + ", ".join(unknown)))
        if lost:
            defects.append((table, "-", "column removed: " + ", ".join(lost)))
        changed = 0
        for key, (h, x, u) in n["rows"].items():
            if key not in o["rows"]:
                added.append((table, key, "new row"))
                continue
            oh, _ox, ou = o["rows"][key]
            if oh == h:
                continue
            changed += 1
            xid = int(x) if x.isdigit() else None
            if xid is not None and xid in xids:
                defects.append((table, key, "changed by a recorded transaction"))
            elif n["touch"] and u is not None and u == ou:
                defects.append((table, key, "changed with updated_at unchanged on a table with a touch trigger"))
            else:
                explained.append((table, key, "changed by another session"))
        gone = [k for k in o["rows"] if k not in n["rows"]]
        for k in gone:
            defects.append((table, k, "row gone"))
        counts[table] = (len(o["rows"]), len(n["rows"]), changed, len(gone))
    return defects, explained, added, counts


def read_xids(path):
    ids = set()
    if path:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line.isdigit():
                ids.add(int(line) % (1 << 32))   # xmin is a 32-bit xid; txid_current() carries an epoch
    return ids


def report(defects, explained, added, counts):
    print(f"{'table':<24}{'before':>8}{'after':>8}{'changed':>9}{'gone':>6}")
    for t, (b, a, c, g) in counts.items():
        print(f"{t:<24}{b:>8}{a:>8}{c:>9}{g:>6}")
    for label, items in (("DEFECT", defects), ("EXPLAINED", explained), ("NEW", added)):
        for t, k, why in items[:50]:
            print(f"{label:<10}{t}  {k}  {why}")
        if len(items) > 50:
            print(f"{label:<10}... and {len(items) - 50} more")
    print(f"\ndefects {len(defects)}, explained {len(explained)}, new rows {len(added)}")


def connect(args):
    ref = sf.connection_ref(args)
    if ref == db_target.PRODUCTION_REF and not args.allow_production_read:
        sys.exit("REFUSED  that connection names the live project. Pass --allow-production-read "
                 "only for the course director's own read-only run.")
    return sf.connect(args), ref


def outside_repo(path):
    p = Path(path).resolve()
    if REPO == p or REPO in p.parents:
        sys.exit("REFUSED  the snapshot file must be outside the repository.")
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url-env")
    src.add_argument("--dotenv")
    ap.add_argument("--allow-production-read", action="store_true")
    m = ap.add_mutually_exclusive_group(required=True)
    m.add_argument("--save")
    m.add_argument("--diff")
    m.add_argument("--controls", action="store_true")
    ap.add_argument("--xids")
    args = ap.parse_args(argv)

    if args.controls:
        if not args.url_env:
            sys.exit("--controls needs --url-env (staging only)")
        return run_controls(os.environ.get(args.url_env, "").strip())

    conn, ref = connect(args)
    snap = snapshot(conn)
    conn.close()
    snap["project"] = ref
    if args.save:
        path = outside_repo(args.save)
        path.write_text(json.dumps(snap), encoding="utf-8")
        total = sum(len(t["rows"]) for t in snap["tables"].values())
        print(f"saved {total} row hashes across {len(TABLES)} tables, time zone UTC, project {ref}")
        for t in TABLES:
            print(f"  {t:<24}{len(snap['tables'][t]['rows'])}")
        return 0
    old = json.loads(Path(args.diff).read_text(encoding="utf-8"))
    if old.get("tz") != "UTC":
        sys.exit("REFUSED  the saved file was not taken in UTC.")
    if old.get("project") != ref:
        sys.exit("REFUSED  the saved file and this connection name different projects.")
    defects, explained, added, counts = classify(old, snap, read_xids(args.xids))
    report(defects, explained, added, counts)
    return 1 if defects else 0


def undo_control(url, key):
    """Put a control's marker back out of the row. The row must really change for a control to see it: the grade touch
    trigger (migration 068) leaves updated_at alone when an update writes the same values back."""
    import psycopg2
    c = psycopg2.connect(url, connect_timeout=15)
    cur = c.cursor()
    cur.execute("UPDATE app.grades SET diagnostic = diagnostic - 'fp_control' WHERE id = %s", (key,))
    c.commit()
    c.close()


def run_controls(url):
    """Two controls, each proved on its own snapshot so neither can hide the other."""
    import psycopg2
    db_target.require_staging(url)

    def snap():
        c = psycopg2.connect(url, connect_timeout=15)
        s = snapshot(c)
        c.close()
        return s

    def one(table):
        c = psycopg2.connect(url, connect_timeout=15)
        cur = c.cursor()
        cur.execute(f"SELECT {'id' if table != 'enrollments' else 'id'}::text FROM app.{table} ORDER BY 1 LIMIT 1")  # noqa: S608
        k = cur.fetchone()[0]
        c.close()
        return k

    ok = True
    # Control A: an ordinary session changes a row of a table that has a touch trigger.
    key = one("grades")
    before = snap()
    c = psycopg2.connect(url, connect_timeout=15)
    cur = c.cursor()
    cur.execute("UPDATE app.grades SET diagnostic = diagnostic || '{\"fp_control\": 1}'::jsonb WHERE id = %s", (key,))
    c.commit()
    c.close()
    d, e, _n, _c = classify(before, snap(), set())
    undo_control(url, key)
    a_ok = [(t, k) for t, k, _ in e] == [("grades", key)] and not d
    if not a_ok:
        print(f"  control A saw {len(d)} defect(s) and {len(e)} explained: {[(t, why) for t, _k, why in (d + e)][:6]}")
    print(f"control A  ordinary session changes one grades row: {'Explained, no defect' if a_ok else 'FAILED'}")
    ok &= a_ok

    # Control B: the same kind of change inside a recorded transaction.
    before = snap()
    c = psycopg2.connect(url, connect_timeout=15)
    cur = c.cursor()
    cur.execute("UPDATE app.grades SET diagnostic = diagnostic || '{\"fp_control\": 1}'::jsonb WHERE id = %s", (key,))
    cur.execute("SELECT txid_current()")
    xid = cur.fetchone()[0]
    c.commit()
    c.close()
    d, e, _n, _c = classify(before, snap(), {xid % (1 << 32)})
    undo_control(url, key)
    b_ok = [(t, k) for t, k, _ in d] == [("grades", key)] and not e
    if not b_ok:
        print(f"  control B saw {len(d)} defect(s) and {len(e)} explained: {[(t, why) for t, _k, why in (d + e)][:6]}")
    print(f"control B  recorded transaction changes one grades row: {'Defect' if b_ok else 'FAILED'}")
    ok &= b_ok

    # Control C: a change that leaves updated_at alone on a table with a touch trigger. A bulk repair that
    # switches triggers off would do this. The change is made and then undone, with a snapshot between.
    before = snap()
    c = psycopg2.connect(url, connect_timeout=15)
    cur = c.cursor()
    try:
        cur.execute("SET session_replication_role = replica")
        cur.execute("UPDATE app.grades SET diagnostic = diagnostic || '{\"fp_control\": 1}'::jsonb WHERE id = %s", (key,))
        c.commit()
    except Exception as exc:  # noqa: BLE001
        c.rollback()
        c.close()
        print(f"control C  not run: {type(exc).__name__}")
        return 1
    d, e, _n, _c = classify(before, snap(), set())
    cur.execute("SET session_replication_role = replica")
    cur.execute("UPDATE app.grades SET diagnostic = diagnostic - 'fp_control' WHERE id = %s", (key,))
    c.commit()
    c.close()
    c_ok = [(t, k) for t, k, _ in d] == [("grades", key)]
    print(f"control C  update that skips the touch trigger: {'Defect' if c_ok else 'FAILED'}")
    ok &= c_ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
