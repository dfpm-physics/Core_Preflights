#!/usr/bin/env python3
"""Prove migration 045 (forced password change enforced by the database) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 044 in a database of its own,
loads a small invented fixture (one offering, a director, a student), then runs one battery twice:

  BEFORE   045 is not applied. Every case that expects a flagged session to be refused is expected to FAIL
           here, which shows the tests can fail.
  AFTER    045 is applied. Every case must pass.

Sessions are simulated the way the 044 test does it: the `authenticated` role plus `request.jwt.claims`
holding the claims the platform would put in a token. Claims used: unflagged; app_metadata flag true;
app_metadata flag false; user_metadata flag true only (the database must NOT act on that copy, which the
user can write).

What this cannot show: that a real token carries app_metadata (it does; the site reads it from the same
place), and the edge function and site pages. Those need a real session on staging.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names and
ids are invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_forced_rotation_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE shows at least one flagged read served and AFTER passes every case.
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

MIGRATION = "045_forced_password_change.sql"


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
    name = "scratch_e4_" + os.urandom(4).hex()
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

        # ---- build through 044 -------------------------------------------------------------------------
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023" and f.name[:3] < "045"]
        mig = next(f for f in ins.migration_files(None) if f.name == MIGRATION)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")

        # ---- fixture ----------------------------------------------------------------------------------------
        F = {k: uid() for k in ("course", "term", "co", "sec", "enr", "asg", "ao", "dir", "stu_auth")}
        cur.execute("SET search_path = app, public, extensions")
        cur.execute("BEGIN")
        for u in (F["dir"], F["stu_auth"]):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (u,))
        cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F["dir"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A')", (F["course"],))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2026-12-01')",
                    (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true)",
                    (F["co"], F["course"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}')",
                    (F["sec"], F["co"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000901, 'Synthetic Cadet', %s)",
                    (F["stu_auth"],))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000901,%s)", (F["enr"], F["sec"]))
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight','item-a','Synthetic item')",
                    (F["asg"], F["course"]))
        cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published) "
                    "VALUES (%s,%s,%s,'points',2,true)", (F["ao"], F["asg"], F["co"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')",
                    (F["dir"], F["co"]))
        cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) "
                    "VALUES (%s,%s,1,2,'instructor')", (F["ao"], F["enr"]))
        cur.execute("COMMIT")
        print("fixture  one offering, one director, one student, one grade (all invented)")

        def claims(sub, flag):
            c = {"sub": sub, "role": "authenticated"}
            if flag == "app_true":
                c["app_metadata"] = {"must_change_password": True}
            elif flag == "app_false":
                c["app_metadata"] = {"must_change_password": False}
            elif flag == "user_true":
                c["user_metadata"] = {"must_change_password": True}
            return json.dumps(c)

        def attempt(sub, flag, sql, params=()):
            """Run sql as a simulated signed-in session in a transaction that is rolled back.
            Returns ('ok', first value or rowcount) or ('error', sqlstate)."""
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
            C = []  # (name, who, flag, sql, params, expected)   expected: int count, 'error', or 'null'
            reads = [
                ("items", "SELECT count(*) FROM assignment_offerings"),
                ("enrollments", "SELECT count(*) FROM enrollments"),
                ("grades", "SELECT count(*) FROM grades"),
                ("courses", "SELECT count(*) FROM courses"),
                ("terms", "SELECT count(*) FROM terms"),
                ("sections", "SELECT count(*) FROM sections"),
            ]
            # unflagged controls: the same reads still work, so a refusal below is the flag and nothing else
            for n, q in reads:
                if n != "grades":   # a student sees a grade only once it is released; not the point here
                    C.append((f"control, student unflagged reads {n}", F["stu_auth"], None, q, (), "pos"))
                C.append((f"control, director unflagged reads {n}", F["dir"], None, q, (), "pos"))
                C.append((f"control, director with flag=false reads {n}", F["dir"], "app_false", q, (), "pos"))
                C.append((f"user_metadata flag only: director still reads {n} (the database ignores that copy)", F["dir"], "user_true", q, (), "pos"))
            # flagged sessions
            for n, q in reads:
                if n != "grades":
                    C.append((f"FLAGGED student reads {n}: none", F["stu_auth"], "app_true", q, (), 0))
                C.append((f"FLAGGED director reads {n}: none", F["dir"], "app_true", q, (), 0))
            C.append(("FLAGGED student still reads own roster row", F["stu_auth"], "app_true",
                      "SELECT count(*) FROM students", (), 1))
            C.append(("FLAGGED director still reads own staff row and no other",
                      F["dir"], "app_true", "SELECT count(*) FROM instructors", (), 1))
            C.append(("control: unflagged student reads own roster row", F["stu_auth"], None,
                      "SELECT count(*) FROM students", (), 1))
            C.append(("FLAGGED sessions: current_uid() is NULL", F["dir"], "app_true", "SELECT app.current_uid() IS NULL", (), True))
            C.append(("control: unflagged current_uid() is the user", F["dir"], None, "SELECT app.current_uid() IS NOT NULL", (), True))
            C.append(("FLAGGED director is not staff", F["dir"], "app_true", "SELECT app.is_staff()", (), False))
            C.append(("control: unflagged director is staff", F["dir"], None, "SELECT app.is_staff()", (), True))
            C.append(("FLAGGED student has no student id", F["stu_auth"], "app_true", "SELECT app.my_student_id() IS NULL", (), True))
            # writes
            C.append(("FLAGGED director cannot add a section", F["dir"], "app_true",
                      "INSERT INTO sections (course_offering_id, code, meeting_days) VALUES (%s,'SX','{M}')", (F["co"],), "error"))
            C.append(("control: unflagged director adds a section", F["dir"], None,
                      "INSERT INTO sections (course_offering_id, code, meeting_days) VALUES (%s,'SX','{M}')", (F["co"],), 1))
            C.append(("FLAGGED director updates no grade", F["dir"], "app_true",
                      "UPDATE grades SET points_earned = 2 WHERE assignment_offering_id = %s", (F["ao"],), 0))
            C.append(("control: unflagged director updates the grade", F["dir"], None,
                      "UPDATE grades SET points_earned = 2 WHERE assignment_offering_id = %s", (F["ao"],), 1))
            C.append(("FLAGGED student cannot save a preference", F["stu_auth"], "app_true",
                      "INSERT INTO user_preferences (user_id) VALUES (%s)", (F["stu_auth"],), "error"))
            C.append(("FLAGGED director cannot rewrite own staff row", F["dir"], "app_true",
                      "UPDATE instructors SET name = 'Synthetic Staff 2' WHERE id = %s", (F["dir"],), 0))
            C.append(("FLAGGED director cannot call the offering-flag function", F["dir"], "app_true",
                      "SELECT app.set_prog_flag(%s, true)", (F["ao"],), "error"))
            return C

        def run_battery(label):
            passed = failed = served = 0
            print(f"\n{label}")
            for n, who, flag, sql, params, expect in cases():
                state, val = attempt(who, flag, sql, params)
                if expect == "error":
                    ok = state == "error"
                    detail = f"{state}" + (f" ({val})" if state == "error" else " (accepted)")
                elif expect == "pos":
                    ok = state == "ok" and isinstance(val, int) and val > 0
                    detail = f"{state}, {val}"
                else:
                    ok = state == "ok" and val == expect
                    detail = f"{state}, {val}"
                if not ok and n.startswith("FLAGGED"):
                    served += 1
                passed += ok
                failed += (not ok)
                print(f"  {'PASS' if ok else 'FAIL'}  {n}: {detail}")
            print(f"  -> {passed} passed, {failed} failed, {served} flagged case(s) served")
            return passed, failed, served

        def structure(label):
            cur.execute("""SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'app' AND c.relkind IN ('r','p') AND c.relrowsecurity
                              AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                                               AND p.polname = 'forced_rotation_block')""")
            missing = [r[0] for r in cur.fetchall()]
            cur.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'app' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity""")
            no_rls = cur.fetchone()[0]
            ok = not missing and no_rls == 0
            print(f"  {'PASS' if ok else 'FAIL'}  {label}: {len(missing)} RLS table(s) lack the restrictive policy"
                  f"{(' (' + ', '.join(missing[:6]) + ')') if missing else ''}; {no_rls} table(s) without row security")
            return ok

        b_pass, b_fail, b_served = run_battery("BEFORE 045 (flagged cases are expected to fail here, which shows the tests can fail)")
        b_struct = structure("every RLS table carries the block")

        if not run(mig.name, mig.read_text(encoding="utf-8"), True):
            return 1
        cur.execute("SET search_path = app, public, extensions")
        a_pass, a_fail, a_served = run_battery("AFTER 045 (every case must pass)")
        a_struct = structure("every RLS table carries the block")

        print("\nSUMMARY")
        print(f"  BEFORE: {b_pass} passed, {b_fail} failed, {b_served} flagged case(s) served; structure ok: {b_struct}")
        print(f"  AFTER : {a_pass} passed, {a_fail} failed, {a_served} flagged case(s) served; structure ok: {a_struct}")
        code = 0 if (a_fail == 0 and a_struct and b_served > 0 and not b_struct) else 1
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
