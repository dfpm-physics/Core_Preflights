#!/usr/bin/env python3
"""Prove migration 046 (diagnostic hidden from cadets; staff list and library reads narrowed) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 045 in a database of its own,
loads a small invented fixture (two courses and offerings, a director in each, an instructor in one, a global
admin, two cadets, a shared library item), then runs one battery twice:

  BEFORE   046 is not applied. Every case that expects something to be hidden is expected to FAIL here, which
           shows the tests can fail. Counts are printed for each case.
  AFTER    046 is applied. Every case must pass.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims` holding the claims the platform
would put in a token (unflagged, or with app_metadata.must_change_password = true).

What this cannot show: the real REST path (PostgREST, a real token), and the site pages. Those need a real
session on staging after the migration is applied there.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names and
ids are invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_diagnostic_reads_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE shows at least one leak served and AFTER passes every case.
"""
import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402

MIGRATION = "046_diagnostic_and_staff_reads.sql"


def uid():
    return str(uuid.uuid4())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    url = os.environ.get("STAGING_DB_URL", "").strip()
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_e15_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 1
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
                    try:
                        cur.execute("RESET ROLE;")
                        cur.execute("RESET search_path;")
                    except Exception:  # noqa: BLE001
                        pass
            return True

        # ---- build through 045 -------------------------------------------------------------------------
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023" and f.name[:3] < "046"]
        mig = next(f for f in ins.migration_files(None) if f.name == MIGRATION)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")

        # ---- fixture ----------------------------------------------------------------------------------------
        F = {k: uid() for k in ("course_a", "course_b", "term", "co_a", "co_b", "sec_a", "sec_b", "enr_a", "enr_a2",
                                "asg_a", "asg_a2", "asg_b", "asg_sh", "act_a", "act_b", "act_sh", "ao_a", "ao_a2",
                                "dir_a", "ins_a", "dir_b", "adm", "stu_a", "stu_a2", "g_a", "g_a2", "g_a3")}
        cur.execute("SET search_path = app, public, extensions")
        cur.execute("BEGIN")
        for k in ("dir_a", "ins_a", "dir_b", "adm", "stu_a", "stu_a2"):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (F[k],))
        for k in ("dir_a", "ins_a", "dir_b"):
            cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F[k],))
        cur.execute("INSERT INTO instructors (id, name, is_global_admin) VALUES (%s, 'Synthetic Admin', true)", (F["adm"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A'), (%s,'syn-b','Synthetic B')",
                    (F["course_a"], F["course_b"]))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2026-12-01')",
                    (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true),(%s,%s,%s,true)",
                    (F["co_a"], F["course_a"], F["term"], F["co_b"], F["course_b"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}'),(%s,%s,'SB','{M}')",
                    (F["sec_a"], F["co_a"], F["sec_b"], F["co_b"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000901,'Synthetic Cadet One',%s),(3000000902,'Synthetic Cadet Two',%s)",
                    (F["stu_a"], F["stu_a2"]))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000901,%s),(%s,3000000902,%s)",
                    (F["enr_a"], F["sec_a"], F["enr_a2"], F["sec_a"]))
        for a, c, s in ((F["asg_a"], F["course_a"], "item-a"), (F["asg_b"], F["course_b"], "item-b"), (F["asg_sh"], None, "item-sh"), (F["asg_a2"], F["course_a"], "item-a2")):
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,'Synthetic item')", (a, c, s))
        for k, a, s in (("act_a", "asg_a", "act-a"), ("act_b", "asg_b", "act-b"), ("act_sh", "asg_sh", "act-sh")):
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) "
                        "VALUES (%s,%s,'written',%s,'Synthetic activity','{}',0)", (F[k], F[a], s))
        cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published) "
                    "VALUES (%s,%s,%s,'points',2,true)", (F["ao_a"], F["asg_a"], F["co_a"]))
        cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published) "
                    "VALUES (%s,%s,%s,'points',2,false)", (F["ao_a2"], F["asg_a2"], F["co_a"]))
        cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)", (F["ao_a"], F["act_a"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES "
                    "(%s,%s,NULL,'director'),(%s,%s,%s,'instructor'),(%s,%s,NULL,'director')",
                    (F["dir_a"], F["co_a"], F["ins_a"], F["co_a"], F["sec_a"], F["dir_b"], F["co_b"]))
        # cadet one's grade, with a diagnostic and an instructor note; cadet two's grade, same shape
        diag = json.dumps({"schema": 1, "q2_effort": 3, "misconceptions": [{"id": "synthetic-probe"}],
                           "instructor_note": {"text": "synthetic note"}})
        for g, e in (("g_a", "enr_a"), ("g_a2", "enr_a2")):
            cur.execute("INSERT INTO grades (id, assignment_offering_id, enrollment_id, points_earned, points_possible, source, diagnostic) "
                        "VALUES (%s,%s,%s,1,2,'instructor',%s)", (F[g], F["ao_a"], F[e], diag))
        cur.execute("INSERT INTO grades (id, assignment_offering_id, enrollment_id, points_earned, points_possible, source, diagnostic) "
                    "VALUES (%s,%s,%s,1,2,'instructor',%s)", (F["g_a3"], F["ao_a2"], F["enr_a"], diag))
        cur.execute("UPDATE grades SET is_finalized = true WHERE id IN (%s,%s)", (F["g_a"], F["g_a2"]))
        cur.execute("COMMIT")
        cur.execute("SELECT count(*) FROM grades WHERE is_finalized")
        if cur.fetchone()[0] != 2:
            print("FAILED   fixture: grades did not stay finalized")
            return 1
        print("fixture  two courses, a director each, an instructor, an admin, two cadets with finalized grades (all invented)")

        def claims(sub, flag):
            c = {"sub": sub, "role": "authenticated"}
            if flag:
                c["app_metadata"] = {"must_change_password": True}
            return json.dumps(c)

        def attempt(sub, flag, sql, params=()):
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims(sub, flag),))
                cur.execute(sql, params)
                if cur.description:
                    rows = cur.fetchall()
                    res = ("ok", rows[0][0] if len(rows) == 1 and len(rows[0]) == 1 else len(rows))
                else:
                    res = ("ok", cur.rowcount)
            except psycopg2.Error as exc:
                res = ("error", exc.pgcode)
            cur.execute("ROLLBACK")
            return res

        def cases():
            C = []  # (name, leak?, who, flag, sql, params, expect)   expect: int | 'error' | 'rows>0'
            S, S2, DA, IA, DB, AD = F["stu_a"], F["stu_a2"], F["dir_a"], F["ins_a"], F["dir_b"], F["adm"]
            # ---- E15: the diagnostic ----
            C.append(("E15 cadet reads own diagnostic from the grades table: 0 rows", True, S, False,
                      "SELECT count(*) FROM grades WHERE diagnostic <> '{}'::jsonb", (), 0))
            C.append(("E15 cadet 'select *' from the grades table returns no row", True, S, False,
                      "SELECT count(*) FROM grades", (), 0))
            C.append(("E15 cadet reads own grade through my_grades: 1 row", False, S, False,
                      "SELECT count(*) FROM my_grades", (), 1))
            C.append(("E15 cadet's my_grades has no diagnostic column", True, S, False,
                      "SELECT diagnostic FROM my_grades", (), "error"))
            C.append(("E15 cadet still reads points and the instructor note", False, S, False,
                      "SELECT (points_earned = 1 AND instructor_note ->> 'text' = 'synthetic note') FROM my_grades", (), True))
            C.append(("E15 cadet one never sees cadet two's grade", False, S, False,
                      "SELECT count(*) FROM my_grades WHERE id = %s", (F["g_a2"],), 0))
            C.append(("E15 my_grades hides a grade that is not finalized (and the table gives a cadet nothing)", False, S, False,
                      "SELECT count(*) FROM my_grades WHERE id = %s", (F["g_a3"],), 0))
            C.append(("E15 a filter on the diagnostic cannot probe through the view", True, S, False,
                      "SELECT count(*) FROM my_grades WHERE (to_jsonb(my_grades) ->> 'diagnostic') IS NOT NULL", (), 0))
            C.append(("E15 flagged cadet reads nothing through my_grades", False, S, True,
                      "SELECT count(*) FROM my_grades", (), 0))
            C.append(("E15 anonymous-style session (no user) reads nothing through my_grades", False, str(uuid.uuid4()), False,
                      "SELECT count(*) FROM my_grades", (), 0))
            # ---- staff keep the diagnostic ----
            C.append(("control: director of A reads the diagnostic of all three grades", False, DA, False,
                      "SELECT count(*) FROM grades WHERE diagnostic ? 'q2_effort'", (), 3))
            C.append(("control: instructor of the section reads the diagnostic", False, IA, False,
                      "SELECT count(*) FROM grades WHERE diagnostic ? 'q2_effort'", (), 3))
            C.append(("control: director of B reads no grade of A", False, DB, False,
                      "SELECT count(*) FROM grades", (), 0))
            C.append(("control: director of A updates a diagnostic", False, DA, False,
                      "UPDATE grades SET diagnostic = diagnostic || '{\"x\":1}'::jsonb WHERE id = %s", (F["g_a"],), 1))
            # ---- E16: the staff list ----
            C.append(("E16 cadet lists staff: none", True, S, False, "SELECT count(*) FROM instructors", (), 0))
            C.append(("E16 cadet cannot see who is a global admin", True, S, False,
                      "SELECT count(*) FROM instructors WHERE is_global_admin", (), 0))
            C.append(("control: director lists staff (4)", False, DA, False, "SELECT count(*) FROM instructors", (), 4))
            C.append(("control: instructor lists staff (4)", False, IA, False, "SELECT count(*) FROM instructors", (), 4))
            C.append(("control: flagged director still reads own staff row only", False, DA, True,
                      "SELECT count(*) FROM instructors", (), 1))
            # ---- E16: the library ----
            C.append(("E16 director of A reads no activity of course B", True, DA, False,
                      "SELECT count(*) FROM activities WHERE id = %s", (F["act_b"],), 0))
            C.append(("E16 director of A reads no assignment of course B", True, DA, False,
                      "SELECT count(*) FROM assignments WHERE id = %s", (F["asg_b"],), 0))
            C.append(("control: director of A reads its own and the shared activity (2)", False, DA, False,
                      "SELECT count(*) FROM activities", (), 2))
            C.append(("control: director of A reads its own and the shared assignment (3)", False, DA, False,
                      "SELECT count(*) FROM assignments", (), 3))
            C.append(("control: instructor of A reads its own and the shared activity (2)", False, IA, False,
                      "SELECT count(*) FROM activities", (), 2))
            C.append(("control: director of B reads its own and the shared activity (2)", False, DB, False,
                      "SELECT count(*) FROM activities", (), 2))
            C.append(("control: global admin reads all three activities", False, AD, False,
                      "SELECT count(*) FROM activities", (), 3))
            C.append(("control: global admin reads all four assignments", False, AD, False,
                      "SELECT count(*) FROM assignments", (), 4))
            C.append(("control: cadet still reads the activity scheduled for them (1)", False, S, False,
                      "SELECT count(*) FROM activities", (), 1))
            C.append(("control: cadet still reads the assignment scheduled for them (1)", False, S, False,
                      "SELECT count(*) FROM assignments", (), 1))
            return C

        def run_battery(label):
            passed = failed = leaks = 0
            print(f"\n{label}")
            for n, leak, who, flag, sql, params, expect in cases():
                state, val = attempt(who, flag, sql, params)
                if expect == "error":
                    ok = state == "error"
                    detail = state + (f" ({val})" if state == "error" else " (accepted)")
                else:
                    ok = state == "ok" and val == expect
                    detail = f"{state}, {val}" if state == "ok" else f"{state} ({val})"
                    if state == "ok":
                        detail = f"saw {val}, expected {expect}" if not isinstance(val, bool) else f"{val}"
                if not ok and leak:
                    leaks += 1
                passed += ok
                failed += (not ok)
                print(f"  {'PASS' if ok else 'FAIL'}  {n}: {detail}")
            print(f"  -> {passed} passed, {failed} failed, {leaks} leak case(s) served")
            return passed, failed, leaks

        def view_shape():
            cur.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'app' AND c.relname = 'my_grades' AND c.relkind = 'v'""")
            if cur.fetchone()[0] != 1:
                print("  FAIL  my_grades exists")
                return False
            cur.execute("""SELECT array_agg(attname ORDER BY attname) FROM pg_attribute
                            WHERE attrelid = 'app.grades'::regclass AND attnum > 0 AND NOT attisdropped""")
            t = set(cur.fetchone()[0])
            cur.execute("""SELECT array_agg(attname ORDER BY attname) FROM pg_attribute
                            WHERE attrelid = 'app.my_grades'::regclass AND attnum > 0 AND NOT attisdropped""")
            v = set(cur.fetchone()[0])
            ok = (t - v) == {"diagnostic"} and (v - t) == {"instructor_note"}
            print(f"  {'PASS' if ok else 'FAIL'}  my_grades has every grades column except diagnostic, plus instructor_note "
                  f"(missing {sorted(t - v)}, extra {sorted(v - t)})")
            cur.execute("""SELECT has_table_privilege('anon','app.my_grades','SELECT'),
                                  has_table_privilege('authenticated','app.my_grades','SELECT')""")
            anon, auth = cur.fetchone()
            ok2 = (not anon) and auth
            print(f"  {'PASS' if ok2 else 'FAIL'}  my_grades: anon has no access, authenticated can select")
            return ok and ok2

        b_pass, b_fail, b_leaks = run_battery("BEFORE 046 (leak cases are expected to fail here, which shows the tests can fail)")

        if not run(mig.name, mig.read_text(encoding="utf-8"), True):
            return 1
        cur.execute("SET search_path = app, public, extensions")
        a_pass, a_fail, a_leaks = run_battery("AFTER 046 (every case must pass)")
        shape = view_shape()

        # the writers the analysis skills use are the connecting role and the app roles: prove they are unchanged
        cur.execute("SELECT count(*) FROM grades WHERE diagnostic ? 'q2_effort'")
        writers_ok = cur.fetchone()[0] == 3
        cur.execute("SET ROLE prep_app_dml")
        try:
            cur.execute("UPDATE grades SET diagnostic = diagnostic || '{\"y\":1}'::jsonb WHERE id = %s", (F["g_a"],))
            dml_ok = cur.rowcount == 1
            cur.execute("SELECT count(*) FROM grades WHERE diagnostic ? 'y'")
            dml_ok = dml_ok and cur.fetchone()[0] == 1
        except psycopg2.Error as exc:
            print(f"  [info] prep_app_dml: {exc.pgcode}")
            dml_ok = False
        cur.execute("RESET ROLE")
        print(f"  {'PASS' if writers_ok and dml_ok else 'FAIL'}  the table owner and prep_app_dml still write and read grades.diagnostic")

        print("\nSUMMARY")
        print(f"  BEFORE: {b_pass} passed, {b_fail} failed, {b_leaks} leak case(s) served")
        print(f"  AFTER : {a_pass} passed, {a_fail} failed, {a_leaks} leak case(s) served; view shape ok: {shape}; writers ok: {writers_ok and dml_ok}")
        code = 0 if (a_fail == 0 and shape and writers_ok and dml_ok and b_leaks > 0) else 1
        conn.close()
    finally:
        if sbc.drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f'WARNING  could not drop {name}; drop it by hand: DROP DATABASE "{name}";', file=sys.stderr)
            code = code or 1
        admin.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
