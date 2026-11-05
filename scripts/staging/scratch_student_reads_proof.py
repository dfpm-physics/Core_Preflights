#!/usr/bin/env python3
"""Prove migration 060 (student reads) on a THROWAWAY database on the staging server, then drop it.

Builds schema `app` through 043 in a database of its own (as scratch_build_check.py does), seeds two invented
cadets and four items, then checks what a signed-in cadet can do BEFORE 060 and AFTER it:

  before 060   gradebook_cells and my_course_total are refused; a cadet whose enrollment is completed reads no items
  after 060    a cadet reads their own cells and total only; a held grade comes back with no score; the total equals
               the internal rule (_totals_at) for the same cadet; another cadet's cells are not returned; a cadet
               whose enrollment is completed still reads the term's items and cells; a dropped enrollment reads
               nothing; the staff-only function and the internal rule stay refused to a cadet and to anon.
  rollback     060's rollback restores the grants and the active-only rule.

SAFETY  Staging server only (db_target.py refuses anything else). Touches only the database it creates. Never
prints a credential. All names and ids are invented.

Usage:  python scripts/staging/scratch_student_reads_proof.py --expect-ref <staging_ref>
"""
import argparse
import json
import os
import re
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
from v2_gate_lib import Builder, days  # noqa: E402

REPO = HERE.parents[1]
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    passed += bool(ok)
    failed += not ok
    print(f"  [{'pass' if ok else 'FAIL'}] {name}{'' if ok or not detail else '  -- ' + str(detail)[:200]}")


def as_cadet(cur, uid):
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": uid, "role": "authenticated"}),))
    cur.execute("SET ROLE authenticated")


def as_owner(cur):
    cur.execute("RESET ROLE")
    cur.execute("SET ROLE prep_app_owner")


def attempt(cur, sql, args=()):
    """Run a statement; return (rows, None) or (None, first error line). """
    try:                                  # autocommit connection: a failed statement leaves no aborted transaction
        cur.execute(sql, args)
        return (cur.fetchall() if cur.description else []), None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc).strip().splitlines()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sbc.refuse("STAGING_DB_URL is not set.")
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_stureads_" + secrets.token_hex(4)
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 0
    try:
        u = urlparse(url)
        conn = psycopg2.connect(urlunparse(u._replace(path="/" + name)), connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()

        def run(label, sql, owner=True):
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
                print(f"FAILED   {label}: {str(exc).strip().splitlines()[0]}")
                return False
            finally:
                try:
                    cur.execute("RESET ROLE;")
                except Exception:  # noqa: BLE001
                    pass
            print(f"ok       {label}")
            return True

        boot = ins.BOOTSTRAP.read_text(encoding="utf-8")
        boot = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", boot, flags=re.S | re.M)
        boot = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", boot, flags=re.M)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", boot, False)]
        mig = ins.migration_files(None)
        for f in mig:
            n = f.name[:3]
            if n <= "043":
                steps.append((f.name, f.read_text(encoding="utf-8"), True))
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1

        # ---- fixture: invented, built as the owner ---------------------------------------------
        import uuid
        ns = uuid.UUID("00000000-0000-0000-0000-0000000d0d0d")
        for who in ("alpha", "beta"):       # the connection user owns schema auth; the owner role cannot touch it
            cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (str(uuid.uuid5(ns, f"user:{who}")),))
        cur.execute("SET ROLE prep_app_owner")
        cur.execute("BEGIN")
        b = Builder(cur, ns=ns)
        course = b.course("proof-101", "Proof Course")
        term = b.term("proof-term", "Proof Term", "2026-08-01", "2027-12-31")
        co = b.offering(course, term, True)
        sec = b.section(co, "P1", ["M"])
        ids = {}
        for who, cid in (("alpha", 3000000001), ("beta", 3000000002)):
            enr, _ = b.cadet(cid, f"Proof {who.title()}", sec, with_auth=False)
            uid = b.id("user", who)
            cur.execute("UPDATE students SET auth_user_id = %s WHERE student_id = %s", (uid, cid))
            ids[who] = {"enr": enr, "uid": uid}
        past = days(-5)
        a = b.item(course, co, "proof-a", "Proof item A", 10, due=past)
        held = b.item(course, co, "proof-b", "Proof item B", 10, due=past, grades_release_at=days(30))
        miss = b.item(course, co, "proof-c", "Proof item C", 10, due=past)
        for it in (a, held, miss):
            b.publish(it)
        for who in ("alpha", "beta"):
            for it, pts in ((a, 8), (held, 9)):
                sub = b.work(ids[who]["enr"], it, "committed", past)
                b.grade(ids[who]["enr"], it, pts, submission=sub)
        cur.execute("COMMIT")
        al, be = ids["alpha"], ids["beta"]
        CELLS = "SELECT assignment_offering_id, state, points_earned FROM app.gradebook_cells(%s, 'final')"
        TOTAL = "SELECT earned_text, possible_text, percent_text FROM app.my_course_total(%s, 'final')"
        ITEMS = "SELECT count(*) FROM app.assignment_offerings"

        print("\n== before 060")
        as_cadet(cur, al["uid"])
        _, e = attempt(cur, CELLS, (co,))
        check("a cadet is refused gradebook_cells", e and "permission denied" in e, e)
        _, e = attempt(cur, TOTAL, (co,))
        check("a cadet is refused my_course_total", e and "permission denied" in e, e)
        rows, _ = attempt(cur, ITEMS)
        check("an active cadet reads the 3 items", rows and rows[0][0] == 3, rows)
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'completed' WHERE id = %s", (al["enr"],))
        as_cadet(cur, al["uid"])
        rows, _ = attempt(cur, ITEMS)
        check("a cadet whose enrollment is completed reads 0 items (the E23 fault)", rows and rows[0][0] == 0, rows)
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'active' WHERE id = %s", (al["enr"],))

        print("\n== apply 060")
        text = (REPO / "supabase/migrations/app/060_student_reads.sql").read_text(encoding="utf-8")
        if not run("060_student_reads.sql", text, True):
            return 1

        print("\n== after 060")
        as_cadet(cur, al["uid"])
        cells, e = attempt(cur, CELLS, (co,))
        by = {c[0]: c for c in (cells or [])}
        check("a cadet reads their own cells", cells is not None and len(cells) == 3, e or len(cells or []))
        st = {k: v[1] for k, v in by.items()}
        check("released item: state released, score 8", st.get(a["ao"]) == "released" and float(by[a["ao"]][2]) == 8.0, by.get(a["ao"]))
        check("held grade: waiting, and NO score reaches the cadet", st.get(held["ao"]) == "submitted_ungraded" and by[held["ao"]][2] is None, by.get(held["ao"]))
        check("past-due item with nothing in: counted as missing", st.get(miss["ao"]) == "missing", st.get(miss["ao"]))
        tot, e = attempt(cur, TOTAL, (co,))
        check("the total is 8 of 20 (released + missing; the held grade is out)", tot and (tot[0][0], tot[0][1]) == ("8", "20"), tot or e)
        as_owner(cur)
        cur.execute("RESET ROLE")
        cur.execute("SET ROLE prep_app_read")
        cur.execute("SELECT earned_text, possible_text, percent_text FROM app._totals_at(%s, 'final', now()) WHERE enrollment_id = %s", (co, al["enr"]))
        internal = cur.fetchall()
        check("the cadet's total equals the internal rule for the same cadet", tot and internal and tuple(internal[0]) == tuple(tot[0]), (internal, tot))
        as_cadet(cur, be["uid"])
        cells_b, _ = attempt(cur, "SELECT DISTINCT enrollment_id FROM app.gradebook_cells(%s, 'final')", (co,))
        check("another cadet is returned only their own enrollment", cells_b and [r[0] for r in cells_b] == [be["enr"]], cells_b)
        _, e = attempt(cur, "SELECT * FROM app.course_totals(%s, 'final')", (co,))
        check("the staff-only totals stay refused to a cadet", e and "permission denied" in e, e)
        _, e = attempt(cur, "SELECT * FROM app._totals_at(%s, 'final', now())", (co,))
        check("the internal rule stays refused to a cadet", e and "permission denied" in e, e)
        cur.execute("RESET ROLE")
        for fn in ("gradebook_cells(uuid,text)", "my_course_total(uuid,text)"):
            cur.execute("SELECT has_function_privilege('anon', %s, 'EXECUTE')", ("app." + fn,))
            check(f"anon is not granted {fn}", cur.fetchone()[0] is False)

        print("\n== completed and dropped enrollments (E23)")
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'completed' WHERE id = %s", (al["enr"],))
        as_cadet(cur, al["uid"])
        rows, _ = attempt(cur, ITEMS)
        check("a completed enrollment still reads the term's items", rows and rows[0][0] == 3, rows)
        cells, _ = attempt(cur, CELLS, (co,))
        check("and still reads its cells", cells is not None and len(cells) == 3, cells)
        tot2, _ = attempt(cur, TOTAL, (co,))
        check("and its total, unchanged", tot2 and tuple(tot2[0][:2]) == ("8", "20"), tot2)
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'dropped' WHERE id = %s", (al["enr"],))
        as_cadet(cur, al["uid"])
        rows, _ = attempt(cur, ITEMS)
        check("a dropped enrollment reads no items", rows and rows[0][0] == 0, rows)
        tot3, _ = attempt(cur, TOTAL, (co,))
        check("and has no total", tot3 == [], tot3)

        print("\n== rollback")
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'completed' WHERE id = %s", (al["enr"],))
        rb = (REPO / "supabase/migrations/app/rollback/060_student_reads_ROLLBACK.sql").read_text(encoding="utf-8")
        if not run("060 rollback", rb, True):
            return 1
        as_cadet(cur, al["uid"])
        _, e = attempt(cur, CELLS, (co,))
        check("after rollback the cadet is refused again", e and "permission denied" in e, e)
        rows, _ = attempt(cur, ITEMS)
        check("and a completed enrollment reads 0 items again", rows and rows[0][0] == 0, rows)
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'active' WHERE id = %s", (al["enr"],))
        as_cadet(cur, al["uid"])
        rows, _ = attempt(cur, "SELECT count(*) FROM app.my_offerings()")
        check("my_offerings() answers for an active enrollment after rollback", rows and rows[0][0] == 1, rows)
        as_owner(cur)
        cur.execute("UPDATE app.enrollments SET status = 'completed' WHERE id = %s", (al["enr"],))
        as_cadet(cur, al["uid"])
        rows, _ = attempt(cur, "SELECT count(*) FROM app.my_offerings()")
        check("my_offerings() is active-only again after rollback (completed answers nothing)", rows and rows[0][0] == 0, rows)
        as_owner(cur)
        cur.execute("SELECT pg_get_functiondef('app.my_offerings()'::regprocedure)")
        defn = cur.fetchone()[0]
        check("my_offerings() is the 002 definition again", "'active'" in defn and "'completed'" not in defn, defn[-120:])

        print("\n== rollback order: 065 rolled back first, then 060 (and 060 alone while 065 is applied)")
        PRIV = "SELECT has_function_privilege('authenticated', %s, 'EXECUTE')"
        # stand-in for 065: the idempotent grant plus a function whose presence marks it as applied
        if not run("060 again", text, True):
            return 1
        cur.execute("RESET ROLE")
        cur.execute("SET ROLE prep_app_owner")
        cur.execute("GRANT EXECUTE ON FUNCTION app.gradebook_cells(uuid, text) TO authenticated")
        cur.execute("CREATE FUNCTION app.publish_column(uuid, uuid, boolean) RETURNS void LANGUAGE sql AS 'SELECT'")
        if not run("060 rollback while 065 is still applied", rb, True):
            return 1
        cur.execute("RESET ROLE")
        cur.execute(PRIV, ("app.gradebook_cells(uuid,text)",))
        check("out of order: the staff pages keep gradebook_cells", cur.fetchone()[0] is True)
        cur.execute(PRIV, ("app.my_course_total(uuid,text)",))
        check("out of order: my_course_total is still taken back", cur.fetchone()[0] is False)
        # 065 rolled back first: its rollback drops the functions and does not revoke the grant; then 060 runs
        cur.execute("SET ROLE prep_app_owner")
        cur.execute("DROP FUNCTION app.publish_column(uuid, uuid, boolean)")
        if not run("060 again", text, True):
            return 1
        if not run("060 rollback after 065 was rolled back", rb, True):
            return 1
        cur.execute("RESET ROLE")
        cur.execute(PRIV, ("app.gradebook_cells(uuid,text)",))
        check("newest first: gradebook_cells is revoked by the 060 rollback", cur.fetchone()[0] is False)
        cur.execute(PRIV, ("app.my_course_total(uuid,text)",))
        check("newest first: my_course_total is revoked", cur.fetchone()[0] is False)
        conn.close()
        code = 1 if failed else 0
    finally:
        if sbc.drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f'WARNING  could not drop {name}; drop it by hand: DROP DATABASE "{name}";', file=sys.stderr)
            code = code or 1
        admin.close()
    print(f"\n{passed} passed, {failed} failed")
    return code


if __name__ == "__main__":
    sys.exit(main())
