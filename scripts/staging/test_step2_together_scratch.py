#!/usr/bin/env python3
"""Step 2 together: one invented course walked across the student, staff-entry and trust migrations, on ONE
throwaway database built with every migration in order (023, 024 to 043, then 044 to 048, 059, 060, 065, 066).

It stands in for plan section 8's "agree for the same cadet" as far as a scratch database can. Sessions are simulated
(the `authenticated` role plus `request.jwt.claims`), so it proves the database rules, not the browser pages and not
a real token.

THE PATH
  1  a Director enters a typed score for a cadet; it is a draft and the cadet reads nothing
  2  the Director publishes the column; the cadet's `my_grades` row, the cadet's total and the staff `course_totals`
     row are the same numbers, and the columns the export reads (`gradebook_cells`, `course_totals`) hold that value
  3  a grade held by a future release time is hidden from the cadet (no `my_grades` row, no points in the cadet's
     cells, left out of the total) and stays visible to staff
  4  a section transfer keeps the past score and the cadet's total, including a blank in a column that was closed
     in the section the cadet left
  5  a completed term stays readable: the term's items, the grade, the total
  6  a dropped enrollment reads nothing
  7  every rollback runs newest first, the schema is back where it was, and the migrations re-apply; the same
     reads then give the same answers

Names and ids are invented; no id is printed. Staging project only (db_target refuses anything else); one database,
dropped afterwards.

Usage:  python scripts/staging/test_step2_together_scratch.py --expect-ref <staging_ref>
Exit 0 only when every check passes.
"""
import argparse
import json
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import install_staging as ins  # noqa: E402
import v2_gate_lib as gl  # noqa: E402
from scratch_lib import Scratch, Tally  # noqa: E402

STEP2 = ["044", "045", "046", "047", "048", "059", "060", "065", "066"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_tg", args.expect_ref, before="999", skip=())
    t = Tally()
    code = 1
    try:
        if not s.build():
            return 1
        missing = [n for n in STEP2 if not any(f.name.startswith(n) for f in ins.migration_files(None))]
        if not t.chk("every step 2 migration file is present and was applied in order", not missing, missing):
            return 1
        cur, one = s.cur, s.one

        # ---- an invented course, written as the database owner ------------------------------------------------
        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("6e2d3b1f-4c8a-4d2b-8f3e-8b7c6d5e4f32"))
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        director = b.staff("director", "Dee Director")
        instr = b.staff("instr", "Ira Instructor")
        course, term = b.course("tog-101", "Together course"), b.term()
        co = b.offering(course, term, True)
        secA, secB = b.section(co, "A1", ["M"]), b.section(co, "B1", ["T"])
        b.assign(director, co, "director")
        b.assign(instr, co, "instructor", secA)
        enr1, stu1 = b.cadet(3000000911, "Ann Invented", secA)
        enr2, stu2 = b.cadet(3000000912, "Ben Invented", secA)
        hand = [{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}]
        quiz = b.item(course, co, "tog-quiz", "Together quiz", 10, kind="quiz", paths=hand, due=gl.days(-3), published=False)
        quiz2 = b.item(course, co, "tog-quiz2", "Together second quiz", 10, kind="quiz", paths=hand, due=gl.days(-3), published=False)
        held = b.item(course, co, "tog-held", "Together held", 10, kind="quiz", paths=hand, due=gl.days(-3), published=False,
                      grades_release_at=gl.days(5))
        for it in (quiz, quiz2, held):
            b.publish(it)
        b.grade(enr1, held, 7)          # finalized, but the release time is five days away
        cur.execute("COMMIT")
        Q, Q2, H = quiz["ao"], quiz2["ao"], held["ao"]

        def sess(sub, sql, params=(), keep=False):
            return s.attempt(sub, sql, params, keep=keep)

        def mine(sub, sql, params=()):
            """Rows of one query as a simulated session; ('error', ...) if it fails."""
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(sub), ))
                cur.execute(sql, params)
                rows = cur.fetchall()
            except s.psycopg2.Error as exc:
                cur.execute("ROLLBACK")
                cur.execute("RESET ROLE")
                return ("error", (str(exc).strip().splitlines() or [""])[0])
            cur.execute("ROLLBACK")
            cur.execute("RESET ROLE")
            return ("ok", rows)

        def pts(sub, ao):
            r = mine(sub, "SELECT points_earned FROM my_grades WHERE assignment_offering_id = %s", (ao,))
            return r[1][0][0] if r[0] == "ok" and r[1] else None

        def my_total(sub):
            r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM my_course_total(%s, 'final')", (co,))
            return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

        def staff_total(sub, enr):
            r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM course_totals(%s, 'final') "
                          "WHERE enrollment_id = %s", (co, enr))
            return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

        def cell(sub, enr, ao):
            r = mine(sub, "SELECT state, points_earned FROM gradebook_cells(%s, 'final') WHERE enrollment_id = %s "
                          "AND assignment_offering_id = %s", (co, enr, ao))
            return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

        print("\n=== 1. a typed score is a draft ===")
        r = sess(director, "SELECT enter_grades(%s, %s::jsonb)", (Q, json.dumps([{"enrollment_id": enr1, "points": "8.5"}])), keep=True)
        t.chk("a Director enters a typed score", r[0] == "ok", r)
        t.chk("the cadet reads no grade for the draft", pts(stu1, Q) is None)

        print("\n=== 2. publishing the column: student, staff and export read one value ===")
        r = sess(director, "SELECT publish_column(%s, NULL, false)", (Q,), keep=True)
        t.chk("the Director publishes the column", r[0] == "ok", r)
        t.chk("the cadet's my_grades row is the typed score", pts(stu1, Q) is not None and float(pts(stu1, Q)) == 8.5, pts(stu1, Q))
        mt, st = my_total(stu1), staff_total(director, enr1)
        t.chk("the cadet has a total and so does staff", mt is not None and st is not None, (mt, st))
        t.chk("the cadet's total is the staff total for that cadet (earned, possible, percent, sort key)", mt == st, (mt, st))
        sc, mc = cell(director, enr1, Q), cell(stu1, enr1, Q)
        t.chk("the cell the export reads is the same score for staff and for the cadet",
              sc is not None and mc is not None and sc == mc and float(sc[1]) == 8.5, (sc, mc))
        t.chk("the export's total column holds the same text the cadet sees", st is not None and st[3] == mt[3], (st, mt))
        t.chk("the other cadet reads nothing of it", pts(stu2, Q) is None)
        t.chk("the other cadet cannot read this cadet's total as their own", my_total(stu2) != mt or my_total(stu2) is None)

        print("\n=== 3. a held grade ===")
        t.chk("the cadet has no my_grades row for a grade held by its release time", pts(stu1, H) is None)
        hc = cell(stu1, enr1, H)
        t.chk("the cadet's cell for it carries no points", hc is None or hc[1] is None, hc)
        r = mine(stu1, "SELECT count(*) FROM grades")
        t.chk("the cadet cannot read the grades table at all", r[0] == "ok" and r[1][0][0] == 0, r)
        r = mine(instr, "SELECT points_earned FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, H))
        t.chk("staff still read the held grade", r[0] == "ok" and len(r[1]) == 1 and float(r[1][0][0]) == 7, r)
        t.chk("the held grade is left out of the cadet's total and the staff total alike", my_total(stu1) == staff_total(director, enr1) == mt, (my_total(stu1), staff_total(director, enr1), mt))

        print("\n=== 4. a section transfer keeps past values ===")
        r = sess(director, "SELECT publish_column(%s, %s, true)", (Q2, secA), keep=True)
        t.chk("the second quiz's column is closed for the first section (a blank there counts 0)", r[0] == "ok", r)
        before = (my_total(stu1), cell(stu1, enr1, Q2), pts(stu1, Q))
        t.chk("the closed blank is in the total (possible includes the second quiz)", before[0] is not None and before[0][1] == "20", before)
        cur.execute("UPDATE enrollments SET section_id = %s WHERE id = %s", (secB, enr1))
        after = (my_total(stu1), cell(stu1, enr1, Q2), pts(stu1, Q))
        t.chk("after the transfer the typed score is still there", after[2] is not None and float(after[2]) == 8.5, after[2])
        t.chk("and the total and the blank's state are unchanged", after == before, (before, after))
        t.chk("and staff still agree with the cadet", staff_total(director, enr1) == after[0], (staff_total(director, enr1), after[0]))

        print("\n=== 5. a completed term stays readable ===")
        cur.execute("UPDATE enrollments SET status = 'completed' WHERE id = %s", (enr1,))
        r = mine(stu1, "SELECT count(*) FROM assignment_offerings")
        t.chk("the term's items are still readable", r[0] == "ok" and r[1][0][0] >= 3, r)
        r = mine(stu1, "SELECT count(*) FROM my_offerings()")
        t.chk("my_offerings still answers for the term", r[0] == "ok" and r[1][0][0] == 1, r)
        t.chk("the grade is still readable", pts(stu1, Q) is not None and float(pts(stu1, Q)) == 8.5)
        t.chk("the total is unchanged", my_total(stu1) == before[0], (my_total(stu1), before[0]))

        print("\n=== 6. a dropped enrollment reads nothing ===")
        cur.execute("UPDATE enrollments SET status = 'dropped' WHERE id = %s", (enr1,))
        r = mine(stu1, "SELECT count(*) FROM assignment_offerings")
        t.chk("no items", r[0] == "ok" and r[1][0][0] == 0, r)
        t.chk("no grade", pts(stu1, Q) is None)
        cur.execute("UPDATE enrollments SET status = 'active' WHERE id = %s", (enr1,))
        answers_before = (pts(stu1, Q), my_total(stu1), pts(stu1, H), cell(stu1, enr1, Q2))

        print("\n=== 7. rollback newest first, then re-apply ===")
        names = {f.name[:3]: f.name for f in ins.migration_files(None)}
        rolled = True
        # 066's rollback refuses to drop carried closure states unless the operator has taken a snapshot and says so.
        # This run did create one (the transfer above), so it proves the refusal first, then says so.
        refused = not s.apply_file(names["066"].replace(".sql", "_ROLLBACK.sql"), rollback=True, quiet=True)
        t.chk("rollback 066 refuses to drop a carried closure state without the snapshot flag", refused)
        cur.execute("SET prep.rollback_loses_rows = '066'")
        for n in reversed(STEP2):
            ok = s.apply_file(names[n].replace(".sql", "_ROLLBACK.sql"), rollback=True)
            rolled = rolled and ok
            t.chk(f"rollback {n} runs", ok)
        if rolled:
            t.chk("my_grades is gone after the rollbacks", one("SELECT to_regclass('app.my_grades') IS NULL"))
            t.chk("the second-quiz blank and the typed score are still stored", one(
                "SELECT count(*) FROM app.grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, Q)) == 1)
            applied = True
            for n in STEP2:
                ok = s.apply_file(names[n])
                applied = applied and ok
                t.chk(f"re-apply {n} runs", ok)
            if applied:
                now = (pts(stu1, Q), pts(stu1, H))
                t.chk("after the re-apply the cadet reads the same grade and the held grade is still hidden",
                      now == (answers_before[0], answers_before[2]), (now, answers_before))
                t.chk("and the cadet's total is again the staff total (the carried blank was dropped by the rollback, as flagged)",
                      my_total(stu1) == staff_total(director, enr1) and my_total(stu1) is not None,
                      (my_total(stu1), staff_total(director, enr1)))
        code = 0 if t.f == 0 else 1
    finally:
        s.close()
    print(f"\n{t.p} passed, {t.f} failed")
    return code


if __name__ == "__main__":
    sys.exit(main())
