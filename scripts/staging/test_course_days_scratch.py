#!/usr/bin/env python3
"""Prove migration 086 (the days a course meets) on a THROWAWAY database. The staging database itself is not touched.

Builds schema `app` through 079 in a database of its own, loads invented rows, then:

  BEFORE      courses has no meeting_days column; a course and a section holding W exist. A schema fingerprint is taken.
  APPLY 086   the column exists; the course that was already there reads M and T; a course made without naming the days
              reads M and T; a list of W and F is accepted; an empty list, a letter outside M T W R F, a null, a sixth
              entry are each refused; a section may hold W under an M and T course (the list is not enforced on
              sections); a second term's offering of the same course reads the same days (a term copy shares the course);
              a site administrator can change the list and a director cannot; the fingerprint now differs.
  ROLLBACK    refuses while a course holds its own list (and changes nothing); passes once every course is back on the
              default; the fingerprint is IDENTICAL to the one taken before; the section holding W is untouched.
  RE-APPLY    the fingerprint is IDENTICAL to the one taken after the first apply; the existing course reads M and T.
  FLAGGED     with the loss flag set the rollback passes over a course that holds its own list, and the fingerprint
              matches the original again; 086 is then re-applied so the database ends on the migration.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims`. This cannot show the real REST path.
SAFETY  Staging server only (db_target.py refuses anything else). One database, dropped afterwards. Invented names; no id
is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_course_days_scratch.py --expect-ref <staging_ref>
Exit 0 only when every check passed.
"""
import argparse
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import v2_gate_lib as gl  # noqa: E402
import schema_fingerprint as fpr  # noqa: E402
from scratch_lib import Scratch, Tally  # noqa: E402

M86, R86 = "086_course_meeting_days.sql", "086_course_meeting_days_ROLLBACK.sql"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_cd", args.expect_ref, before="086", skip=())
    t = Tally()
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one

        def fingerprint():
            c = s.conn.cursor()
            lines = []
            for kind, sql in fpr.QUERIES:
                c.execute(sql)
                for row in c.fetchall():
                    lines.append(kind + " | " + " | ".join(" ".join(str(v).split()) for v in row))
            c.close()
            return lines

        def has_column():
            return one("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'courses' AND column_name = 'meeting_days'") == 1

        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("5b2f0c7e-91d4-4a6b-8c1e-3a7d2e9f1086"))
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        admin = b.staff("admin", "Ada Admin", admin=True)
        director = b.staff("director", "Dee Director")
        course = b.course("days-101", "Days course")
        term1, term2 = b.term(), b.term("spring-2027", "Spring 2027", "2027-01-06", "2027-05-14")
        co1 = b.offering(course, term1, True)
        b.assign(director, co1, "director")
        sec_w = b.section(co1, "W1A", ["W"])
        cur.execute("COMMIT")

        def sql_try(sql, params=()):
            cur.execute("BEGIN")
            try:
                cur.execute(sql, params)
                res = ("ok", cur.rowcount)
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, (str(exc).strip().splitlines() or [""])[0])
            cur.execute("ROLLBACK")
            return res

        def sql_do(sql, params=()):
            cur.execute("BEGIN")
            cur.execute(sql, params)
            cur.execute("COMMIT")

        def days(code):
            return one("SELECT meeting_days FROM courses WHERE code = %s", (code,))

        def refused(res, ck=None):
            return res[0] == "error" and (ck is None or ck in res[2])

        # ============================ BEFORE =============================
        print("\n=== BEFORE 086 ===")
        f0 = fingerprint()
        t.chk("there is no meeting_days column on courses", not has_column())
        t.chk("a section may already hold W", one("SELECT meeting_days FROM sections WHERE id = %s", (sec_w,)) == ["W"])

        # ============================ APPLY ==============================
        print("\n=== APPLY 086 ===")
        t.chk("086 applies", s.apply_file(M86))
        f1 = fingerprint()
        t.chk("the column exists", has_column())
        t.chk("the fingerprint now differs from before", f1 != f0)
        added = sorted(set(f1) - set(f0))
        t.chk("the only additions are the column and its check", len(added) == 2 and any("meeting_days" in x for x in added) and any("courses_meeting_days_ck" in x for x in added), added)
        t.chk("nothing was removed", not (set(f0) - set(f1)))
        t.chk("the course that was already there reads M and T", days("days-101") == ["M", "T"], days("days-101"))
        r = sql_try("INSERT INTO courses (code, title) VALUES ('days-102', 'No days named')")
        t.chk("a course made without naming the days is accepted", r == ("ok", 1), r)
        sql_do("INSERT INTO courses (code, title) VALUES ('days-102', 'No days named')")
        t.chk("...and reads M and T", days("days-102") == ["M", "T"], days("days-102"))
        r = sql_try("INSERT INTO courses (code, title, meeting_days) VALUES ('days-103', 'W and F', ARRAY['W','F'])")
        t.chk("a list of W and F is accepted", r == ("ok", 1), r)
        r = sql_try("INSERT INTO courses (code, title, meeting_days) VALUES ('days-104', 'All five', ARRAY['M','T','W','R','F'])")
        t.chk("all five days are accepted", r == ("ok", 1), r)
        for label, val in (("an empty list", "'{}'::text[]"), ("a letter outside M T W R F", "ARRAY['M','S']"),
                           ("a lowercase letter", "ARRAY['m']"), ("a null entry", "ARRAY['M',NULL]"),
                           ("six entries", "ARRAY['M','T','W','R','F','M']")):
            r = sql_try(f"INSERT INTO courses (code, title, meeting_days) VALUES ('days-bad', 'x', {val})")
            t.chk(f"{label} is refused by the check", refused(r, "courses_meeting_days_ck"), r)
        r = sql_try("INSERT INTO courses (code, title, meeting_days) VALUES ('days-bad', 'x', NULL)")
        t.chk("a null list is refused", refused(r, "meeting_days"), r)
        r = sql_try("UPDATE sections SET meeting_days = ARRAY['W','F'] WHERE id = %s", (sec_w,))
        t.chk("a section may hold a day the course does not list (W under M and T)", r == ("ok", 1), r)
        co2 = None
        cur.execute("BEGIN")
        b2 = gl.Builder(cur, uuid.UUID("5b2f0c7e-91d4-4a6b-8c1e-3a7d2e9f1086"))
        co2 = b2.offering(course, term2, False)
        cur.execute("COMMIT")
        t.chk("a second term's offering of the same course reads the same days (a term copy shares the course)",
              one("SELECT c.meeting_days FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = %s", (co2,)) == ["M", "T"])
        r = s.attempt(admin, "UPDATE courses SET meeting_days = ARRAY['W','F'] WHERE code = 'days-101'", keep=True)
        t.chk("a site administrator can change the list", r == ("ok", 1) and days("days-101") == ["W", "F"], r)
        r = s.attempt(director, "UPDATE courses SET meeting_days = ARRAY['M'] WHERE code = 'days-101'", keep=True)
        t.chk("a director cannot (no row is changed)", r == ("ok", 0) and days("days-101") == ["W", "F"], r)
        t.chk("the second term's offering follows the change", one("SELECT c.meeting_days FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = %s", (co2,)) == ["W", "F"])
        f_changed = fingerprint()
        t.chk("changing a value does not change the structure", f_changed == f1)

        # ============================ ROLLBACK ===========================
        print("\n=== ROLLBACK 086 ===")
        t.chk("the rollback refuses while a course holds its own list", not s.apply_file(R86, rollback=True, quiet=True))
        t.chk("...and changed nothing", has_column() and fingerprint() == f1)
        sql_do("UPDATE courses SET meeting_days = ARRAY['M','T']")
        t.chk("the rollback passes once every course is back on M and T", s.apply_file(R86, rollback=True))
        t.chk("the column is gone", not has_column())
        t.chk("the fingerprint is identical to the one taken before", fingerprint() == f0)
        t.chk("the section holding W is untouched", one("SELECT meeting_days FROM sections WHERE id = %s", (sec_w,)) == ["W"])

        # ============================ RE-APPLY ===========================
        print("\n=== RE-APPLY 086 ===")
        t.chk("086 re-applies", s.apply_file(M86))
        t.chk("the fingerprint is identical to the first apply", fingerprint() == f1)
        t.chk("the course that was there reads M and T again", days("days-101") == ["M", "T"], days("days-101"))

        # ============================ FLAGGED ============================
        print("\n=== ROLLBACK WITH THE LOSS FLAG ===")
        sql_do("UPDATE courses SET meeting_days = ARRAY['W','F'] WHERE code = 'days-101'")
        cur.execute("SET prep.rollback_loses_rows = '086'")
        ok = s.apply_file(R86, rollback=True)
        cur.execute("RESET prep.rollback_loses_rows")
        t.chk("with the flag set the rollback passes over a course that holds its own list", ok)
        t.chk("...and the fingerprint matches the original", fingerprint() == f0)
        t.chk("086 applies once more, leaving the database on the migration", s.apply_file(M86))
        t.chk("...and the fingerprint matches the first apply", fingerprint() == f1)
    finally:
        s.close()
    print(f"\n{t.p} passed, {t.f} failed")
    return 0 if t.f == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
