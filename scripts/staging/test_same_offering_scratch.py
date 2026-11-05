#!/usr/bin/env python3
"""Prove migration 044 (same-offering checks) on a THROWAWAY database on the staging server.

The staging database is not touched. This builds schema `app` through migration 043 in a database of its own,
loads a small invented fixture (two course offerings, one section and one cadet pair in each), then runs the
same battery twice:

  BEFORE   the migration is not applied. Every case that expects a refusal is expected to FAIL here (the row
           is accepted); this shows the tests can fail.
  AFTER    044 is applied (and one old mismatched row is left in place first, to show it is counted and not
           touched). Every case must pass: invalid pairs are refused with SQLSTATE 23514, valid pairs go in.

Cases are of two kinds. "privileged" cases write as the connecting role, which ignores row security, so they
test the rule itself. "signed-in" cases run as the `authenticated` role with a director's sign-in claims and
test the real path: a director of offering A tries to attach a section of offering B to a staff row, then
reads B's grades.

SAFETY  Staging project only (db_target.py refuses anything else, the live project included). It creates one
database, works only in it, and drops it afterwards, whatever happened. Names and ids are invented; no id is
printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_same_offering_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE shows at least one accepted bad row and AFTER passes every case.
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

MIGRATION = "044_same_offering_checks.sql"


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
    name = "scratch_e3_" + os.urandom(4).hex()
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

        # ---- build through 043 (023 is applied separately, and plays no part here) ----------------------
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023" and f.name[:3] < "044"]
        mig = next(f for f in ins.migration_files(None) if f.name == MIGRATION)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")

        # ---- fixture: two offerings, A and B, committed -----------------------------------------------------
        F = {k: uid() for k in ("course_a", "course_b", "term", "co_a", "co_b", "sec_a", "sec_b",
                                "enr_a", "enr_b", "enr_b2", "asg_a", "asg_b", "ao_a", "ao_b",
                                "act_a", "q_a", "grp_a", "grp_b", "dir_a", "z", "dir_b",
                                "asg_shared", "act_b", "act_shared")}
        cur.execute("SET search_path = app, public, extensions")
        cur.execute("BEGIN")
        for u in (F["dir_a"], F["z"], F["dir_b"]):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (u,))
            cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (u,))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A'), (%s,'syn-b','Synthetic B')",
                    (F["course_a"], F["course_b"]))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2026-12-01')",
                    (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true),(%s,%s,%s,true)",
                    (F["co_a"], F["course_a"], F["term"], F["co_b"], F["course_b"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}'),(%s,%s,'SB','{M}')",
                    (F["sec_a"], F["co_a"], F["sec_b"], F["co_b"]))
        for i, (e, s) in enumerate(((F["enr_a"], F["sec_a"]), (F["enr_b"], F["sec_b"]), (F["enr_b2"], F["sec_b"]))):
            cur.execute("INSERT INTO students (student_id, name) VALUES (%s, 'Synthetic Cadet')", (3000000901 + i,))
            cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,%s,%s)", (e, 3000000901 + i, s))
        for a, c, s in ((F["asg_a"], F["course_a"], "item-a"), (F["asg_b"], F["course_b"], "item-b")):
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,'Synthetic item')", (a, c, s))
        cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible) "
                    "VALUES (%s,%s,%s,'points',2),(%s,%s,%s,'points',2)",
                    (F["ao_a"], F["asg_a"], F["co_a"], F["ao_b"], F["asg_b"], F["co_b"]))
        cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) "
                    "VALUES (%s,%s,'written','act-a','Synthetic activity','{}',0)", (F["act_a"], F["asg_a"]))
        cur.execute("INSERT INTO questions (id, activity_id, qid, format, points) VALUES (%s,%s,'q1','prose',1)",
                    (F["q_a"], F["act_a"]))
        # a library item shared by every course (course_id NULL), and one activity of B's item and of the shared item
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,NULL,'preflight','item-shared','Synthetic shared item')",
                    (F["asg_shared"],))
        cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) "
                    "VALUES (%s,%s,'written','act-b','Synthetic activity B','{}',0),(%s,%s,'written','act-shared','Synthetic shared activity','{}',0)",
                    (F["act_b"], F["asg_b"], F["act_shared"], F["asg_shared"]))
        cur.execute("INSERT INTO student_groups (id, course_offering_id, name) VALUES (%s,%s,'G-A'),(%s,%s,'G-B')",
                    (F["grp_a"], F["co_a"], F["grp_b"], F["co_b"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')",
                    (F["dir_a"], F["co_a"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')",
                    (F["dir_b"], F["co_b"]))
        # one legitimate grade in B, which the director of A must never be able to read
        cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) "
                    "VALUES (%s,%s,1,2,'instructor')", (F["ao_b"], F["enr_b"]))
        cur.execute("COMMIT")
        print("fixture  two offerings, one section and cadet pair each, one grade in B (all invented)")

        # ---- the battery ------------------------------------------------------------------------------------
        def attempt(sql, params=(), as_director=None, then=None):
            """Run sql in a savepoint, roll it back, return ('accepted'|'refused', sqlstate, extra)."""
            cur.execute("BEGIN")
            cur.execute("SAVEPOINT c")
            try:
                if as_director:
                    cur.execute("SET LOCAL ROLE authenticated")
                    cur.execute("SELECT set_config('request.jwt.claims', %s, true)",
                                (json.dumps({"sub": as_director, "role": "authenticated"}),))
                cur.execute(sql, params)
                extra = None
                if then:
                    cur.execute(then)
                    extra = cur.fetchone()[0]
                res = ("accepted", None, extra)
            except psycopg2.Error as exc:
                res = ("refused", exc.pgcode, None)
            cur.execute("ROLLBACK")
            return res

        def cases():
            C = []  # (name, expect_refusal, sql, params, as_director, then)
            bad = [
                ("staff row names a section of another offering (privileged)",
                 "INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,%s,'instructor')",
                 (F["z"], F["co_a"], F["sec_b"])),
                ("staff row moved to a section of another offering (privileged)",
                 "UPDATE staff_assignments SET section_id = %s WHERE instructor_id = %s",
                 (F["sec_b"], F["dir_a"])),
                ("due date: section of B on an item of A",
                 "INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at) VALUES (%s,%s,now())",
                 (F["ao_a"], F["sec_b"])),
                ("grade: enrollment of B on an item of A",
                 "INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) VALUES (%s,%s,0,2,'instructor')",
                 (F["ao_a"], F["enr_b"])),
                ("submission: enrollment of B on an item of A",
                 "INSERT INTO submissions (assignment_offering_id, enrollment_id, status) VALUES (%s,%s,'draft')",
                 (F["ao_a"], F["enr_b"])),
                ("extension: enrollment of B on an item of A",
                 "INSERT INTO extensions (assignment_offering_id, enrollment_id, extended_due_at, reason) VALUES (%s,%s,now(),$$synthetic$$)",
                 (F["ao_a"], F["enr_b"])),
                ("attempt: enrollment of B on an item of A",
                 "INSERT INTO question_attempts (assignment_offering_id, enrollment_id, question_id, attempt_no, answer) VALUES (%s,%s,%s,1,'{}')",
                 (F["ao_a"], F["enr_b"], F["q_a"])),
                ("group snapshot: group of B on an item of A",
                 "INSERT INTO student_group_snapshots (group_id, assignment_offering_id, enrollment_id) VALUES (%s,%s,%s)",
                 (F["grp_b"], F["ao_a"], F["enr_a"])),
                ("group snapshot: enrollment of B on an item of A",
                 "INSERT INTO student_group_snapshots (group_id, assignment_offering_id, enrollment_id) VALUES (%s,%s,%s)",
                 (F["grp_a"], F["ao_a"], F["enr_b"])),
                ("group grade: group of B on an item of A",
                 "INSERT INTO student_group_grades (group_id, assignment_offering_id, points) VALUES (%s,%s,1)",
                 (F["grp_b"], F["ao_a"])),
                ("item: an assignment of course B scheduled into offering A",
                 "INSERT INTO assignment_offerings (assignment_id, course_offering_id) VALUES (%s,%s)",
                 (F["asg_b"], F["co_a"])),
                ("item: an existing item of A re-pointed at an assignment of course B",
                 "UPDATE assignment_offerings SET assignment_id = %s WHERE id = %s",
                 (F["asg_b"], F["ao_a"])),
                ("path: an activity of B's assignment attached to A's item",
                 "INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)",
                 (F["ao_a"], F["act_b"])),
                ("path: an activity of the shared item attached to A's item (a different assignment)",
                 "INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)",
                 (F["ao_a"], F["act_shared"])),
            ]
            for item in bad:
                if item:
                    C.append((item[0], True, item[1], item[2], None, None))
            ok = [
                ("staff row, own section", "INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,%s,'instructor')",
                 (F["z"], F["co_a"], F["sec_a"])),
                ("staff row, whole offering", "INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'instructor')",
                 (F["z"], F["co_a"])),
                ("due date, same offering", "INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at) VALUES (%s,%s,now())",
                 (F["ao_a"], F["sec_a"])),
                ("grade, same offering", "INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) VALUES (%s,%s,0,2,'instructor')",
                 (F["ao_a"], F["enr_a"])),
                ("grade points change (checked columns untouched)", "UPDATE grades SET points_earned = 2 WHERE assignment_offering_id = %s", (F["ao_b"],)),
                ("submission, same offering", "INSERT INTO submissions (assignment_offering_id, enrollment_id, status) VALUES (%s,%s,'draft')",
                 (F["ao_a"], F["enr_a"])),
                ("extension, same offering", "INSERT INTO extensions (assignment_offering_id, enrollment_id, extended_due_at, reason) VALUES (%s,%s,now(),$$synthetic$$)",
                 (F["ao_a"], F["enr_a"])),
                ("attempt, same offering", "INSERT INTO question_attempts (assignment_offering_id, enrollment_id, question_id, attempt_no, answer) VALUES (%s,%s,%s,1,'{}')",
                 (F["ao_a"], F["enr_a"], F["q_a"])),
                ("group snapshot, same offering", "INSERT INTO student_group_snapshots (group_id, assignment_offering_id, enrollment_id) VALUES (%s,%s,%s)",
                 (F["grp_a"], F["ao_a"], F["enr_a"])),
                ("group grade, same offering", "INSERT INTO student_group_grades (group_id, assignment_offering_id, points) VALUES (%s,%s,1)",
                 (F["grp_a"], F["ao_a"])),
                ("item: a shared library assignment (no course) scheduled into either offering",
                 "INSERT INTO assignment_offerings (assignment_id, course_offering_id) VALUES (%s,%s)",
                 (F["asg_shared"], F["co_a"])),
                ("path: an activity of the item's own assignment",
                 "INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)",
                 (F["ao_a"], F["act_a"])),
                ("item: points change (checked columns untouched)",
                 "UPDATE assignment_offerings SET points_possible = 3 WHERE id = %s", (F["ao_a"],)),
            ]
            for n, s, p in ok:
                C.append((n, False, s, p, None, None))
            # signed in as the director of A, through row security
            read_b = ("SELECT count(*) FROM grades g JOIN enrollments e ON e.id = g.enrollment_id "
                      f"WHERE e.section_id = '{F['sec_b']}'")
            C.append(("signed-in director of A: staff row naming a section of B is refused, and B grades stay unreadable",
                      True, "INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,%s,'instructor')",
                      (F["dir_a"], F["co_a"], F["sec_b"]), F["dir_a"], read_b))
            C.append(("signed-in director of A: own staff row moved onto a section of B is refused",
                      True, "UPDATE staff_assignments SET section_id = %s WHERE instructor_id = %s AND course_offering_id = %s",
                      (F["sec_b"], F["dir_a"], F["co_a"]), F["dir_a"], None))
            C.append(("signed-in director of A: attaching an activity of B's assignment to A's item is refused",
                      True, "INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)",
                      (F["ao_a"], F["act_b"]), F["dir_a"], None))
            C.append(("signed-in director of A: scheduling an assignment of course B into offering A is refused",
                      True, "INSERT INTO assignment_offerings (assignment_id, course_offering_id) VALUES (%s,%s)",
                      (F["asg_b"], F["co_a"]), F["dir_a"], None))
            C.append(("control: signed-in director of A reads no grade of B",
                      "count0", "SELECT 1", (), F["dir_a"], read_b))
            C.append(("control: signed-in director of A may name a section of A",
                      False, "INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,%s,'instructor')",
                      (F["z"], F["co_a"], F["sec_a"]), F["dir_a"], None))
            return C

        def run_battery(label):
            holes, passed, failed = 0, 0, 0
            print(f"\n{label}")
            for n, expect, sql, params, who, then in cases():
                state, sqlstate, extra = attempt(sql, params, who, then)
                if expect == "count0":
                    ok = (extra == 0)
                    detail = f"director of A sees {extra} row(s) of B"
                elif expect:
                    # a refusal for the right reason is 23514; a row-security refusal (42501) is a different guard
                    ok = state == "refused" and sqlstate == "23514"
                    detail = f"{state}" + (f" ({sqlstate})" if sqlstate else "")
                    if state == "accepted":
                        holes += 1
                        if extra is not None:
                            detail += f"; afterwards director of A sees {extra} row(s) of B"
                            ok = False
                    elif extra is None and who and state == "refused" and sqlstate != "23514":
                        detail += " (not the same-offering rule)"
                else:
                    ok = state == "accepted"
                    detail = f"{state}" + (f" ({sqlstate})" if sqlstate else "")
                passed += ok
                failed += (not ok)
                print(f"  {'PASS' if ok else 'FAIL'}  {n}: {detail}")
            print(f"  -> {passed} passed, {failed} failed, {holes} bad row(s) accepted")
            return passed, failed, holes

        b_pass, b_fail, b_holes = run_battery("BEFORE 044 (refusal cases are expected to fail here, which shows the tests can fail)")

        # one old mismatched row, committed, to show 044 counts it and leaves it alone
        cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) "
                    "VALUES (%s,%s,0,2,'instructor')", (F["ao_a"], F["enr_b2"]))
        conn.notices.clear()
        if not run(mig.name, mig.read_text(encoding="utf-8"), True):
            return 1
        cur.execute("SET search_path = app, public, extensions")
        for note in conn.notices:
            if "044" in note:
                print("\nnotice   " + note.strip())
        a_pass, a_fail, a_holes = run_battery("AFTER 044 (every case must pass)")

        cur.execute("UPDATE grades SET points_earned = 1 WHERE assignment_offering_id = %s AND enrollment_id = %s",
                    (F["ao_a"], F["enr_b2"]))
        old_ok = cur.rowcount == 1
        print(f"\nold mismatched row still updatable on unchecked columns: {old_ok}")

        print("\nSUMMARY")
        print(f"  BEFORE: {b_pass} passed, {b_fail} failed, {b_holes} bad row(s) accepted")
        print(f"  AFTER : {a_pass} passed, {a_fail} failed, {a_holes} bad row(s) accepted")
        code = 0 if (a_fail == 0 and a_holes == 0 and b_holes > 0 and old_ok) else 1
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
