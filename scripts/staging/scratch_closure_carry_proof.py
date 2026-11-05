#!/usr/bin/env python3
"""Prove that a section transfer keeps a cadet's blank where it was (migration 066), on a THROWAWAY database.

The rule under test. A blank on a no-submission item counts 0 once a person closes the column for a section, and
leaves the total until then. A transfer updates `enrollments.section_id` in place, so before 066 a cadet moved
between a closed and an open section changed state with no event: a counted 0 became "awaiting entry" (out of the
total), or the reverse. Section 8 of the plan says a transfer keeps past grades and deadlines. 066 keeps this too.

Builds schema `app` from the repo's files into a database named scratch_carry_<random> on the staging project's
server, invents one course, and moves invented cadets between sections. Then drops the database.

  --through N   build only migration files numbered N or lower. `--through 065` is the BEFORE run: the checks that
                need 066 fail, and the script prints how many cells flipped. A plain run is the AFTER run.

PRINTS  the count of (cadet, item) cells whose state changed because of a move, before and after.
ALSO RUNS (after run only) the total vectors of tests/app-schema/v2_total_vectors.py against this database.

SAFETY  Staging project's server only (db_target.py refuses anything else). Touches only the database it created.
All data is invented. Never prints a password or the connection string.

Usage:  python scripts/staging/scratch_closure_carry_proof.py --expect-ref <staging_ref> [--through 065]
"""
import argparse
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "tests" / "app-schema"))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
import v2_gate_lib as gl  # noqa: E402

PASS = FAIL = 0
INPERSON = {"modality": "external", "delivery": "in_person", "grading": "hand_entered"}


def check(desc, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [pass] {desc}")
    else:
        FAIL += 1
        print(f"  [FAIL] {desc} {detail}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--through", default="999")
    args = ap.parse_args()
    url = os.environ.get("STAGING_DB_URL", "").strip()
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_carry_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    admin.cursor().execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)
        conn = psycopg2.connect(surl, connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()

        def run(label, sql, owner=False):
            body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
            try:
                if owner:
                    cur.execute("SET ROLE prep_app_owner;")
                    cur.execute("RESET search_path;")
                cur.execute(body)
            except Exception as exc:  # noqa: BLE001
                try:
                    cur.execute("ROLLBACK;")
                except Exception:  # noqa: BLE001
                    pass
                print(f"FAILED   {label}: {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
                return False
            finally:
                if owner:
                    cur.execute("RESET ROLE;")
                    cur.execute("RESET search_path;")
            return True

        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023" and f.name[:3] <= args.through]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")
        has066 = any(f.name[:3] == "066" for f in files)

        # ---- invented course: three sections of one offering, two no-submission items ---------------------------
        cur.execute("BEGIN")
        b = gl.Builder(cur, None)
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        director = b.staff("director", "Dee Director")
        course, term = b.course("carry-101", "Carry course"), b.term()
        co = b.offering(course, term, True)
        sa, sb, sc = (b.section(co, c, ["M"]) for c in ("A1", "B1", "C1"))
        b.assign(director, co, "director")
        past = gl.days(-5)
        q = b.item(course, co, "carry-q", "Carry quiz", 10, kind="quiz", paths=[INPERSON], due=gl.iso(past), published=False)
        r = b.item(course, co, "carry-r", "Carry lab", 20, kind="homework", paths=[INPERSON], due=gl.iso(past), published=False)
        b.publish(q)
        b.publish(r)
        n = iter(range(3000000700, 3000000800))
        closed_side = [b.cadet(next(n), f"Closed Cadet {i}", sa, with_auth=False)[0] for i in range(3)]
        open_side = [b.cadet(next(n), f"Open Cadet {i}", sb, with_auth=False)[0] for i in range(3)]
        solo = b.cadet(next(n), "Solo Cadet", sa, with_auth=False)[0]
        b.close_column(q, sa, director)             # the quiz column is closed in A1 only; the lab column in nobody's
        cur.execute("COMMIT")
        Q, R = q["ao"], r["ao"]

        def cell(enr, ao):
            cur.execute("""SELECT state, counted_possible, no_work_received FROM app._cells_at(%s, 'final', now())
                            WHERE enrollment_id = %s AND assignment_offering_id = %s""", (co, enr, ao))
            return cur.fetchone()

        def snapshot():
            cur.execute("""SELECT enrollment_id, assignment_offering_id, state, counted_possible
                             FROM app._cells_at(%s, 'final', now())""", (co,))
            return {(str(e), str(a)): (s, float(p)) for e, a, s, p in cur.fetchall()}

        def move(enrs, section):
            for e in enrs:
                cur.execute("UPDATE app.enrollments SET section_id = %s WHERE id = %s", (section, e))

        def flips(before, after):
            return sum(1 for k in before if before[k] != after[k])

        print("\n=== the starting point ===")
        check("a blank in the closed section counts 0 (missing)", cell(closed_side[0], Q)[0] == "missing", str(cell(closed_side[0], Q)))
        check("the same blank in the open section waits (no work received)", cell(open_side[0], Q)[0] == "submitted_ungraded" and cell(open_side[0], Q)[2] is True, str(cell(open_side[0], Q)))
        check("the lab, closed nowhere, waits in both sections", cell(closed_side[0], R)[0] == "submitted_ungraded" and cell(open_side[0], R)[0] == "submitted_ungraded")

        print("\n=== six cadets swap sections: the count of cells that change on the move ===")
        before = snapshot()
        move(closed_side, sb)
        move(open_side, sa)
        after = snapshot()
        n_flip = flips(before, after)
        print(f"  cells whose state changed because of the move: {n_flip}  (of {len(before)})")
        check("no cell changes state because of a move", n_flip == 0, f"{n_flip} cells changed")
        check("a cadet who moved from the closed section still counts 0", cell(closed_side[0], Q)[0] == "missing", str(cell(closed_side[0], Q)))
        check("a cadet who moved from the open section still waits", cell(open_side[0], Q)[0] == "submitted_ungraded", str(cell(open_side[0], Q)))

        print("\n=== a chain of moves, and a move back ===")
        move([closed_side[1]], sc)
        check("a second move (to a section where nothing is closed) keeps the 0", cell(closed_side[1], Q)[0] == "missing", str(cell(closed_side[1], Q)))
        move([closed_side[1]], sa)
        check("moving into the closed section it left changes nothing", cell(closed_side[1], Q)[0] == "missing")
        move([solo], sb)
        move([solo], sa)
        check("a cadet who moves out and back is where they began", cell(solo, Q)[0] == "missing")
        if has066:
            cur.execute("SELECT count(*) FROM app.closure_carry WHERE enrollment_id = %s", (solo,))
            check("a move out and back leaves no stored carry", cur.fetchone()[0] == 0)

        print("\n=== a person's act in the new section governs ===")
        # closed_side[2] was carried closed into B1 (open). Closing the column in B1, then reopening it, is the
        # new section's own decision and must apply to the carried cadet like every other cadet there.
        check("before any act in B1 the carried cadet still counts 0", cell(closed_side[2], Q)[0] == "missing")
        cur.execute("INSERT INTO app.column_closures (assignment_offering_id, section_id, closed_by) VALUES (%s, %s, %s)", (Q, sb, director))
        check("B1 closes the column: still 0", cell(closed_side[2], Q)[0] == "missing")
        cur.execute("UPDATE app.column_closures SET reopened_at = now() WHERE assignment_offering_id = %s AND section_id = %s AND reopened_at IS NULL", (Q, sb))
        check("B1 reopens it: the carried cadet waits like the rest of B1", cell(closed_side[2], Q)[0] == "submitted_ungraded", str(cell(closed_side[2], Q)))

        print("\n=== a score is never touched ===")
        cur.execute("SET search_path = app, public, extensions")      # the builder's SET LOCAL ended with its transaction
        b.grade(open_side[1], q, 7)
        s0 = cell(open_side[1], Q)
        move([open_side[1]], sc)
        check("a released score stays released after a move", s0[0] == "released" and cell(open_side[1], Q)[0] == "released", str((s0, cell(open_side[1], Q))))

        print("\n=== the total follows the cells ===")
        cur.execute("""SELECT possible FROM app._totals_at(%s, 'final', now()) WHERE enrollment_id = %s""", (co, closed_side[1]))
        check("a moved cadet's possible still includes the closed quiz", float(cur.fetchone()[0]) == 10.0)

        if has066:
            cur.execute("SELECT relrowsecurity FROM pg_class WHERE oid = 'app.closure_carry'::regclass")
            check("closure_carry has row level security on", cur.fetchone()[0] is True)
            cur.execute("SELECT has_table_privilege('authenticated', 'app.closure_carry', 'SELECT'), has_table_privilege('anon', 'app.closure_carry', 'SELECT')")
            check("no browser role can read or write closure_carry", cur.fetchone() == (False, False))

            print("\n=== the total vectors, against this database ===")
            import v2_total_vectors as tv
            tv.Builder.auth_user = lambda self, uid, email, pw=None: self.cur.execute(
                "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
            vconn = psycopg2.connect(surl, connect_timeout=15)
            try:
                tv.vectors(vconn)
                tv.rules(vconn)
            finally:
                vconn.rollback()
                vconn.close()
            check(f"the total vectors all pass ({tv.passed} passed)", tv.failed == 0 and tv.passed > 100, f"{tv.failed} failed")
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
        admin.cursor().execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        print(f"dropped  scratch database {name}")
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
