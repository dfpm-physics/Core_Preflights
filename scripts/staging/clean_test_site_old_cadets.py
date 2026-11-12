#!/usr/bin/env python3
"""Remove the six cadets the test-site seed used BEFORE it moved to 3000001101-3000001106. STAGING ONLY.

WHY
  seed_test_site.py first used cadets 3000000801 to 3000000806, a block the roster walkthrough
  (tests/browser-harness/v2_roster_readback.py) owns and wipes. The seed now uses 3000001101 to 3000001106.
  Running the new seed does not touch the old six, so a staging database that already ran the old seed still
  holds them in the training-sandbox offering. This removes them, and nothing else.

WHAT IT REMOVES (all and only)
  * the enrollments of cadets 3000000801-3000000806 in the `training-sandbox` offering of course `prep-train`;
    deleting an enrollment cascades to that cadet's submissions, submission activities, grades and excusals there;
  * then, for each of the six that now has NO enrollment anywhere, the students row and its auth user.
    A cadet who also belongs to another offering keeps the students row and the auth user.
  Nothing else is selected for deletion: no other cadet, no item, no section, no other offering.

WHAT THE SNAPSHOT HOLDS
  Three roots are deleted: the enrollments, the students rows, and the auth.users rows. From each root the script walks
  the LIVE catalog (pg_constraint) at run time, recursively, with no hard-coded table list, and snapshots every table
  reached by a foreign key to the deleted rows:
    * ON DELETE CASCADE         rows the delete will remove (recursed into: their own children are walked too);
    * NO ACTION / RESTRICT      rows that would BLOCK the delete (not recursed). Any such row makes --commit refuse
                                (except app.students under auth.users: the script deletes those first);
    * SET NULL / SET DEFAULT    rows the delete would modify (not recursed); snapshotted so the old values survive.
  Each (table, route from a root) is one file. Not snapshotted: rows removed by a trigger rather than an FK, Storage
  objects, and anything in another database. Recursion skips a table already on the current route (cycles) and stops at
  depth 8, and --commit refuses if the cap cut any cascade node. Every auth.* file omits columns whose name looks secret
  (password, token, secret, identity_data, key, hash, otp ...). Snapshots sit under _snapshots/, which is git-ignored.

SAFETY  Staging only: the connection goes through db_target.py (refuses production and any URL it cannot fully read;
        --expect-ref must match). Dry run by default: it prints the counts and writes nothing. --commit first writes the
        snapshot above, RE-READS it from disk and compares each file's row count with a fresh live count(*), refuses on any
        mismatch or any blocking row, and only then deletes, in one transaction.

ENVIRONMENT  STAGING_DB_URL  postgres connection string for the STAGING project. Never printed.
USAGE
  python scripts/staging/clean_test_site_old_cadets.py --expect-ref <staging ref>            # plan only
  python scripts/staging/clean_test_site_old_cadets.py --expect-ref <staging ref> --commit   # snapshot, then delete
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OLD_IDS = list(range(3000000801, 3000000807))
COURSE_CODE, TERM_CODE = "prep-train", "training-sandbox"

# The enrollment root: the six cadets' enrollments in the one offering. %(ids)s, %(course)s, %(term)s are bound.
_OFFERING = """(SELECT co.id FROM app.course_offerings co JOIN app.courses c ON c.id = co.course_id
                 JOIN app.terms t ON t.id = co.term_id WHERE c.code = %(course)s AND t.code = %(term)s)"""
_ENR = f"""(SELECT e.id FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id
             WHERE e.student_id = ANY(%(ids)s) AND s.course_offering_id = {_OFFERING})"""


def fetch(cur, sql, params):
    cur.execute(sql, params)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


FK_SQL = """SELECT format('%%I.%%I', cn.nspname, cl.relname) AS child, c.confdeltype,
       array(SELECT 'c.' || quote_ident(a.attname) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o) AS cols,
       array(SELECT 'p.' || quote_ident(a.attname) FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o) AS pcols
  FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace
 WHERE c.contype = 'f' AND c.confrelid = %s::regclass ORDER BY 1, c.conname"""
MODES = {"c": "cascade", "a": "blocks", "r": "blocks", "n": "set-null", "d": "set-default"}
# Columns that look like secrets, redacted on EVERY auth.* table the walk reaches (matched by name, not by a list).
SECRET_RE = re.compile(r"(^token$|_token$|^token_|secret|password|identity_data|credential|public_key|otp|code_hash|auth_code|authorization_code|code_challenge|nonce|"
                       r"^key$|_key$|hash$)", re.I)
MAX_DEPTH = 8


def walk(cur, key, table, sql, mode, route, depth, out):
    """Append {key, table, sql, mode} for this node, then for every FK that references `table` (from the live catalog)
    one node per child table. Only cascading children are walked further."""
    out.append({"key": key, "table": table, "sql": sql, "mode": mode})
    if mode != "cascade":
        return
    if depth >= MAX_DEPTH:
        out[-1]["cut"] = True            # a cascade node whose own children were not walked
        return
    cur.execute(FK_SQL, (table,))
    for child, deltype, cols, pcols in cur.fetchall():
        if child in route:
            continue
        csql = (f"SELECT c.* FROM {child} c WHERE ({', '.join(cols)}) IN "
                f"(SELECT {', '.join(pcols)} FROM ({sql}) p)")
        walk(cur, f"{key}>{child}", child, csql, MODES.get(deltype, "blocks"), route | {child}, depth + 1, out)


def plan(cur):
    params = {"ids": OLD_IDS, "course": COURSE_CODE, "term": TERM_CODE}
    enr_sql = cur.mogrify(f"SELECT * FROM app.enrollments WHERE id IN {_ENR}", params).decode()
    cur.execute("""SELECT s.student_id, s.auth_user_id FROM app.students s
                    WHERE s.student_id = ANY(%(ids)s)
                      AND NOT EXISTS (SELECT 1 FROM app.enrollments e JOIN app.sections sec ON sec.id = e.section_id
                                       WHERE e.student_id = s.student_id
                                         AND sec.course_offering_id IS DISTINCT FROM """ + _OFFERING + ")", params)
    candidates = cur.fetchall()
    held = {r["student_id"] for r in fetch(cur, enr_sql, None)}     # only cadets this offering actually held
    drop = [d for d in candidates if d[0] in held]
    nodes = []
    walk(cur, "enrollments", "app.enrollments", enr_sql, "cascade", {"app.enrollments"}, 0, nodes)
    if drop:
        stu_sql = cur.mogrify("SELECT * FROM app.students WHERE student_id = ANY(%s)", ([d[0] for d in drop],)).decode()
        walk(cur, "students", "app.students", stu_sql, "cascade", {"app.students"}, 0, nodes)
    auth_ids = [d[1] for d in drop if d[1]]
    if auth_ids:
        au_sql = cur.mogrify("SELECT * FROM auth.users WHERE id = ANY(%s::uuid[])", ([str(a) for a in auth_ids],)).decode()
        walk(cur, "auth.users", "auth.users", au_sql, "cascade", {"auth.users"}, 0, nodes)
    for n in nodes:
        n["rows"] = fetch(cur, n["sql"], None)
    return nodes, drop


def fname(key):
    """A short readable prefix (the last table) plus a hash of the whole route, so a long route cannot exceed a path limit."""
    last = re.sub(r"[^A-Za-z0-9._-]", "_", key.split(">")[-1])[:40]
    return f"{last}-{hashlib.sha1(key.encode()).hexdigest()[:10]}.json"


def redact(table, rows):
    """Drop secret-looking columns from every auth.* table; other schemas are kept whole."""
    if not table.startswith("auth."):
        return rows
    return [{k: v for k, v in r.items() if not SECRET_RE.search(k)} for r in rows]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args(argv)
    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    ref = db_target.exit_unless_staging(url, args.expect_ref).ref
    if ref != args.expect_ref:
        sys.exit(f"REFUSED  STAGING_DB_URL names project {ref}, not {args.expect_ref}.")

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    print(f"target   staging project {ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (nothing is written; add --commit to delete)'}")
    try:
        nodes, drop = plan(cur)
        for n in nodes:
            print(f"  {n['key']:<64} {len(n['rows']):>4} row(s)  [{n['mode']}]")
        print(f"  students + auth users to drop (no other enrollment): {len(drop)} of {len(OLD_IDS)}")
        # The students rows are deleted before the auth users, so the students -> auth.users reference is not a blocker.
        blockers = [n for n in nodes if n["mode"] == "blocks" and n["rows"] and n["key"] != "auth.users>app.students"]
        if blockers:
            print(f"BLOCKED  {len(blockers)} table(s) hold rows whose foreign key would block the delete:")
            for n in blockers:
                print(f"  {n['key']}  {len(n['rows'])} row(s)")
        cut = [n for n in nodes if n.get("cut")]
        if cut:
            print(f"CUT      the walk stopped at depth {MAX_DEPTH} below {len(cut)} cascade table(s); their children are not snapshotted:")
            for n in cut:
                print(f"  {n['key']}")
        if not args.commit:
            conn.rollback()
            return 0
        if cut:
            conn.rollback()
            sys.exit("REFUSED  the walk was cut by the depth cap; nothing deleted.")
        if blockers:
            conn.rollback()
            sys.exit("REFUSED  blocking foreign keys; nothing deleted.")
        enr = next(n for n in nodes if n["key"] == "enrollments")
        if not enr["rows"] and not drop:
            conn.rollback()
            print("nothing to remove.")
            return 0

        # Lock the target rows so nothing changes between the snapshot and the delete (same transaction).
        cur.execute("SELECT 1 FROM app.enrollments WHERE id = ANY(%s::uuid[]) FOR UPDATE", ([r["id"] for r in enr["rows"]],))
        if drop:
            cur.execute("SELECT 1 FROM app.students WHERE student_id = ANY(%s) FOR UPDATE", ([d[0] for d in drop],))
        # Recompute the whole plan now that the rows are locked; refuse if it is not the plan the operator saw.
        nodes2, drop2 = plan(cur)
        shape = lambda ns, dr: ([(n["key"], len(n["rows"]), n["mode"], bool(n.get("cut"))) for n in ns], sorted(dr))  # noqa: E731
        if shape(nodes2, drop2) != shape(nodes, drop):
            conn.rollback()
            sys.exit("REFUSED  the plan changed after the rows were locked; nothing deleted. Re-run.")
        nodes = nodes2
        snap = REPO / "_snapshots" / ("test-site-old-cadets-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        snap.mkdir(parents=True, exist_ok=False)
        for n in nodes:
            (snap / fname(n["key"])).write_text(json.dumps(redact(n["table"], n["rows"]), indent=2, default=str),
                                                encoding="utf-8")
        # Re-read every file from disk and compare with a fresh live count before anything is deleted.
        for n in nodes:
            on_disk = len(json.loads((snap / fname(n["key"])).read_text(encoding="utf-8")))
            cur.execute(f"SELECT count(*) FROM ({n['sql']}) q")
            live = cur.fetchone()[0]
            if on_disk != live:
                conn.rollback()
                sys.exit(f"REFUSED  snapshot of {n['key']} holds {on_disk} row(s), live has {live}. Nothing deleted.")
        print(f"snapshot {snap}  ({len(nodes)} file(s), re-read from disk and checked against live counts)")

        enr_ids = [r["id"] for r in enr["rows"]]
        cur.execute("DELETE FROM app.enrollments WHERE id = ANY(%s::uuid[])", (enr_ids,))
        print(f"deleted  {cur.rowcount} enrollment(s) (their submissions, grades and activities cascade)")
        drop_ids = [d[0] for d in drop]
        auth_ids = [d[1] for d in drop if d[1]]
        if drop_ids:
            cur.execute("DELETE FROM app.students WHERE student_id = ANY(%s)", (drop_ids,))
            print(f"deleted  {cur.rowcount} students row(s)")
        if auth_ids:
            cur.execute("DELETE FROM auth.users WHERE id = ANY(%s::uuid[])", (auth_ids,))
            print(f"deleted  {cur.rowcount} auth user(s)")
        conn.commit()
        print("committed.")
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print(f"FAILED, rolled back. {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
        return 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
