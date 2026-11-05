#!/usr/bin/env python3
"""Step 2 together: one invented course walked across the student, staff-entry and trust migrations, on ONE
throwaway database built with every migration in order (023, 024 to 043, then 044 to 049, 051, 059, 060, 065, 066, 067, 068, and Stage E's 070 to 073 with the merge's 074 to 076).

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
  8  publishing a no-submission column closes it (067): the ten-item case reads 10 of 100 for staff, the cadet and the
     export; the preview lists the cadets and its fingerprint covers them; an extension that has not passed waits;
     unpublish reopens only what a publish closed
  9  a grade's version (updated_at) moves only when the grade changes (068)
 10  an auto-checked numeric item through the real answer functions: my_grades returns the grade before the deadline,
     the audit names a real actor for an answer and for a re-mark, a Director corrects the key and re-marks, and the
     cadet's total, the staff total and the export's cells agree before and after the deadline; a hand correction
     of an auto-checked grade holds once the step 1 new-page rule is switched off
 11  editing a shared question moves the current term's points and leaves a finished term's (074)
 12  the only functions left executable by everyone are the row-security helpers (076)
  7  every rollback runs newest first, the schema is back where it was, and the migrations re-apply; the same
     reads then give the same answers

Names and ids are invented; no id is printed. Staging project only (db_target refuses anything else); one database,
dropped afterwards.

Usage:  python scripts/staging/test_step2_together_scratch.py --expect-ref <staging_ref> [--before 067]
        --before 067 builds only through 066, to show that section 8 fails on the behaviour before 067;
        --before 074 builds through 073, to show that sections 10 (audit), 11 and 12 fail before the merge's own migrations.
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

STEP2_ALL = ["044", "045", "046", "047", "048", "049", "051", "059", "060", "065", "066", "067", "068",
             "070", "071", "072", "073", "074", "075", "076"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--before", default="999")
    args = ap.parse_args()
    STEP2 = [n for n in STEP2_ALL if n < args.before]
    s = Scratch("scratch_tg", args.expect_ref, before=args.before, skip=())
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

        def pub(item, sec=None):
            """Publish a column the way the page does: read the preview, send its fingerprint (none before 067)."""
            pv = mine(director, "SELECT publish_preview(%s, %s)", (item, sec))
            fp = pv[1][0][0].get("fingerprint") if pv[0] == "ok" else None
            if fp:
                return sess(director, "SELECT publish_column(%s, %s, %s, %s)", (item, sec, False, fp), keep=True)
            return sess(director, "SELECT publish_column(%s, %s, true)", (item, sec), keep=True)

        print("\n=== 1. a typed score is a draft ===")
        r = sess(director, "SELECT enter_grades(%s, %s::jsonb)", (Q, json.dumps([{"enrollment_id": enr1, "points": "8.5"}])), keep=True)
        t.chk("a Director enters a typed score", r[0] == "ok", r)
        t.chk("the cadet reads no grade for the draft", pts(stu1, Q) is None)

        print("\n=== 2. publishing the column: student, staff and export read one value ===")
        r = pub(Q)
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

        t.chk("the typed score and its publishing each left an audit row naming the Director (049)",
              one("SELECT count(*) FROM grade_events WHERE actor = %s AND event IN ('created', 'finalized')", (director,)) >= 2)

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
        r = pub(Q2, secA)
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

        print("\n=== 8. publishing a no-submission column closes it (067) ===")
        try:
            cur.execute("BEGIN")
            course2 = b.course("tog-102", "Ten item course")
            co2 = b.offering(course2, term, True)
            secP, secQ = b.section(co2, "P1", ["M"]), b.section(co2, "Q1", ["T"])
            b.assign(director, co2, "director")
            enrA, stuA = b.cadet(3000000921, "Cal Invented", secP)
            enrB, stuB = b.cadet(3000000922, "Dot Invented", secP)
            enrC, stuC = b.cadet(3000000923, "Eli Invented", secQ)
            ten = [b.item(course2, co2, f"tog-ten-{i}", f"Ten item {i}", 10, kind="quiz", paths=hand,
                          due=gl.days(-3), published=False) for i in range(10)]
            for it in ten:
                b.publish(it)
            cur.execute("COMMIT")
            AO = [it["ao"] for it in ten]
            sA, sB, sC = str(enrA), str(enrB), str(enrC)

            def pv(i, sec=secP):
                r = mine(director, "SELECT publish_preview(%s, %s)", (AO[i], sec))
                return r[1][0][0] if r[0] == "ok" else {}

            def total2(sub, enr=None):
                if enr is not None:
                    r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM course_totals(%s, 'final') "
                                  "WHERE enrollment_id = %s", (co2, enr))
                else:
                    r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM my_course_total(%s, 'final')", (co2,))
                return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

            def missing(i):
                r = mine(director, "SELECT enrollment_id FROM gradebook_cells(%s, 'final') WHERE assignment_offering_id = %s "
                                   "AND state = 'missing'", (co2, AO[i]))
                return {str(x[0]) for x in r[1]} if r[0] == "ok" else None

            def state_of(sub, enr, i):
                r = mine(sub, "SELECT state FROM gradebook_cells(%s, 'final') WHERE enrollment_id = %s AND assignment_offering_id = %s",
                         (co2, enr, AO[i]))
                return r[1][0][0] if r[0] == "ok" and r[1] else None

            def num(x):
                return float(x) if x is not None else None

            # the setup: cadet A has 10 of 10 on the first item; cadet B has an extension on the third; the last
            # column was closed by hand before anyone published it
            r = sess(director, "SELECT enter_grades(%s, %s::jsonb)", (AO[0], json.dumps([{"enrollment_id": sA, "points": "10"}])), keep=True)
            t.chk("a Director enters 10 of 10 for the first cadet on the first item", r[0] == "ok", r)
            cur.execute("INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, granted_by, reason) "
                        "VALUES (%s, %s, now() + interval '5 days', %s, 'made-up reason')", (enrB, AO[2], director))
            b.close_column(ten[9], secP, director)

            p0 = pv(0)
            t.chk("the preview of the first column lists the one blank cadet first, with the number",
                  p0.get("blank_count") == 1 and [x["enrollment_id"] for x in p0.get("blank_cadets", [])] == [sB], p0)
            r = pub(AO[0], secP)
            t.chk("publishing the first column closes it and zeroes that blank", r[0] == "ok" and r[1].get("closed") == 1
                  and r[1].get("zeroed") == 1, r)
            tA = total2(director, enrA)
            t.chk("after the first column only, the cadet reads 10 of 20 (the hand-closed last column already counts 0)",
                  tA is not None and num(tA[0]) == 10 and num(tA[1]) == 20, tA)

            # a change after the preview asks for a new preview
            fp1 = pv(1).get("fingerprint")
            t.chk("the preview of the second column lists both blank cadets", pv(1).get("blank_count") == 2, pv(1))
            sess(director, "SELECT enter_grades(%s, %s::jsonb)", (AO[1], json.dumps([{"enrollment_id": sB, "points": "3"}])), keep=True)
            r = sess(director, "SELECT publish_column(%s, %s, false, %s)", (AO[1], secP, fp1), keep=True)
            t.chk("a publish with the old fingerprint is refused after a score changed", r[0] == "error" and r[1] == "40001", r)
            r = sess(director, "SELECT publish_column(%s, %s, true)", (AO[1], secP), keep=True)
            t.chk("a publish that would zero a blank is refused without a fingerprint", r[0] == "error" and "preview" in str(r[2]), r)
            t.chk("neither refusal published or closed anything", pv(1).get("publish_closed_sections") == 0 and missing(1) == set(), missing(1))
            before = missing(1)
            plist = {x["enrollment_id"] for x in pv(1).get("blank_cadets", [])}
            r = pub(AO[1], secP)
            t.chk("with a fresh preview the publish goes through, and the list was the cadets that changed",
                  r[0] == "ok" and plist == {sA} and (missing(1) - before) == plist and r[1].get("zeroed") == 1, (r, plist))

            # an extension that has not passed waits
            p2 = pv(2)
            t.chk("the third column lists the first cadet as blank and the extended cadet as waiting",
                  p2.get("blank_count") == 1 and p2.get("waiting_count") == 1
                  and [x["enrollment_id"] for x in p2.get("blank_cadets", [])] == [sA], p2)
            r = pub(AO[2], secP)
            t.chk("publishing it zeroes only the cadet with no extension", r[0] == "ok" and r[1].get("zeroed") == 1, r)
            t.chk("the extended cadet's cell has not become Missing", state_of(director, enrB, 2) != "missing", state_of(director, enrB, 2))
            cur.execute("UPDATE extensions SET extended_due_at = now() - interval '1 hour' WHERE enrollment_id = %s AND assignment_offering_id = %s",
                        (enrB, AO[2]))
            t.chk("once the extension has passed the cell counts 0", state_of(director, enrB, 2) == "missing", state_of(director, enrB, 2))

            # the rest of the columns, each preview matching what changed
            all_match = True
            for i in range(3, 9):
                before = missing(i)
                plist = {x["enrollment_id"] for x in pv(i).get("blank_cadets", [])}
                r = pub(AO[i], secP)
                ok = r[0] == "ok" and before is not None and (missing(i) - before) == plist and r[1].get("zeroed") == len(plist) == 2
                all_match = all_match and ok
            t.chk("columns 4 to 9: each preview named exactly the cadets that became Missing", all_match)
            p9 = pv(9)
            t.chk("the column closed by hand lists nobody and a publish adds no closure", p9.get("blank_count") == 0, p9)
            r = pub(AO[9], secP)
            t.chk("publishing it closes nothing new", r[0] == "ok" and r[1].get("closed") == 0 and r[1].get("zeroed") == 0, r)

            # the ten-item case: one rule for staff, the cadet and the export's columns
            tA, mA = total2(director, enrA), total2(stuA)
            t.chk("10 of 100, or 10 percent, for staff (course_totals)",
                  tA is not None and num(tA[0]) == 10 and num(tA[1]) == 100 and num(tA[2]) == 10, tA)
            t.chk("the cadet's own total is the same four values", mA == tA, (mA, tA))
            rows_staff = mine(director, "SELECT assignment_offering_id, state, points_earned FROM gradebook_cells(%s, 'final') "
                                        "WHERE enrollment_id = %s ORDER BY 1", (co2, enrA))
            rows_cadet = mine(stuA, "SELECT assignment_offering_id, state, points_earned FROM gradebook_cells(%s, 'final') "
                                    "WHERE enrollment_id = %s ORDER BY 1", (co2, enrA))
            states = sorted(x[1] for x in rows_staff[1]) if rows_staff[0] == "ok" else []
            t.chk("the cells the export reads agree for staff and cadet: one released and nine Missing",
                  rows_staff == rows_cadet and states == ["missing"] * 9 + ["released"], states)
            t.chk("another section's cadet is untouched: no closure there, no Missing cell, nothing counts",
                  one("SELECT count(*) FROM column_closures WHERE section_id = %s", (secQ,)) == 0
                  and state_of(director, enrC, 3) != "missing" and (total2(director, enrC) or (None, "0"))[1] in ("0", None),
                  (state_of(director, enrC, 3), total2(director, enrC)))

            # what a publish closed is recorded, and unpublish reopens only that
            marks = one("SELECT count(*) FROM column_closures WHERE section_id = %s AND closed_by_publish AND reopened_at IS NULL", (secP,))
            hand_n = one("SELECT count(*) FROM column_closures WHERE section_id = %s AND NOT closed_by_publish AND reopened_at IS NULL", (secP,))
            t.chk("nine closures are marked as made by a publish and the hand closure is not", marks == 9 and hand_n == 1, (marks, hand_n))
            r = sess(director, "SELECT unpublish_column(%s, %s, true)", (AO[3], secP), keep=True)
            t.chk("unpublishing a column a publish closed reopens it", r[0] == "ok" and r[1].get("reopened") == 1, r)
            t.chk("the cadet's blank on it leaves the total (90 possible)", num((total2(director, enrA) or (0, 0))[1]) == 90, total2(director, enrA))
            r = sess(director, "SELECT unpublish_column(%s, %s, true)", (AO[9], secP), keep=True)
            t.chk("unpublishing the hand-closed column reopens nothing and says it stays closed",
                  r[0] == "ok" and r[1].get("reopened") == 0 and r[1].get("kept_closed") == 1, r)
            t.chk("its blanks still count 0", state_of(director, enrA, 9) == "missing", state_of(director, enrA, 9))
            r = sess(director, "INSERT INTO column_closures (assignment_offering_id, section_id, closed_by_publish) VALUES (%s, %s, true)",
                     (AO[3], secP), keep=True)
            t.chk("a closure written by hand while sending the marker is stored unmarked",
                  r[0] == "ok" and one("SELECT closed_by_publish FROM column_closures WHERE assignment_offering_id = %s AND section_id = %s "
                                       "AND reopened_at IS NULL", (AO[3], secP)) is False, r)
            r = sess(director, "SELECT unpublish_column(%s, %s, true)", (AO[3], secP), keep=True)
            t.chk("and unpublish leaves that one closed", r[0] == "ok" and r[1].get("reopened") == 0 and r[1].get("kept_closed") == 1, r)
            r = sess(director, "UPDATE column_closures SET closed_by_publish = true WHERE assignment_offering_id = %s AND reopened_at IS NULL", (AO[9],))
            t.chk("the marker cannot be changed afterwards", r[0] == "error", r)
        except Exception as exc:  # noqa: BLE001
            t.chk("section 8 ran to the end", False, repr(exc))
            cur.execute("ROLLBACK")

        print("\n=== 9. a grade's version moves only on a real change (068) ===")
        gq = (enr1, Q)
        ver0 = one("SELECT updated_at::text FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", gq)
        cur.execute("UPDATE grades SET points_earned = points_earned WHERE enrollment_id = %s AND assignment_offering_id = %s", gq)
        ver1 = one("SELECT updated_at::text FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", gq)
        t.chk("a write that changes nothing leaves the version alone", ver1 == ver0, (ver0, ver1))
        cur.execute("UPDATE grades SET question_scores = jsonb_build_object('q9', 1) WHERE enrollment_id = %s AND assignment_offering_id = %s", gq)
        ver2 = one("SELECT updated_at::text FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", gq)
        t.chk("a real change moves it", ver2 != ver1, (ver1, ver2))

        # ================================================================================================
        # Stage E meets step 2. One auto-checked numeric item, answered through the real database path (the answer
        # functions the edge functions call), corrected and re-marked by staff, and read back by the student, by staff
        # and by the export (the cells and totals the export columns come from).
        # ================================================================================================
        print("\n=== 10. an auto-checked item: answers, a key correction and a re-mark (070 to 075) ===")
        try:
            from scratch_stage_e_part2_proof import verdict as _verdict
            from scratch_stage_e_proof import J as _J, call as _call
            cur.execute("BEGIN")
            term_c = b.term("tog-cur", "Together current term", starts="2026-01-01", ends="2099-12-31")
            course3 = b.course("tog-103", "Homework course")
            co3 = b.offering(course3, term_c, True)
            secH = b.section(co3, "H1", ["M"])
            dir3 = b.staff("dir3", "Hal Director")
            b.assign(dir3, co3, "director")
            enrA3, stuA3 = b.cadet(3000000931, "Fay Invented", secH)
            enrB3, stuB3 = b.cadet(3000000932, "Gus Invented", secH)
            Qp = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
            hw = b.item(course3, co3, "tog-hw", "Together homework", 0, kind="homework", paths=[Qp], due=gl.days(2),
                        published=False, entered_on_new_page=True, attempt_limit=8, attempt_rule="best")
            hw["q"] = {"q1": b.question(hw, "q1", "numeric", 2, key=[{"value": 9.8, "tol_pct": 2}], n=0, prompt="How fast?"),
                       "q2": b.question(hw, "q2", "numeric", 1, key=[{"value": 0, "tol_abs": 0.01}], n=1)}
            # step 1 keeps two rules that refuse to publish what only a new page produces; the proof turns both off
            # for this one statement, inside its own transaction (the Stage E proofs do the same)
            for trg in ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"):
                cur.execute(f"ALTER TABLE assignment_offerings DISABLE TRIGGER {trg}")
            cur.execute("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (hw["ao"],))
            for trg in ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"):
                cur.execute(f"ALTER TABLE assignment_offerings ENABLE TRIGGER {trg}")
            cur.execute("COMMIT")
            HW, Q1, Q2 = hw["ao"], hw["q"]["q1"], hw["q"]["q2"]
            sA3, sB3 = str(enrA3), str(enrB3)

            def answer(stu, qn, raw):
                c = _call(cur, "service_role", "answer_context", stu, HW, hw["q"][qn])
                if c.get("status") != "ok":
                    return c
                ok, parsed = _verdict("numeric", {"raw": raw}, c["key"], [])
                return _call(cur, "service_role", "record_answer", stu, HW, hw["q"][qn], _J({"raw": raw}), parsed, bool(ok), c["key_version_id"])

            def tot3(sub, enr=None):
                if enr is not None:
                    r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM course_totals(%s, 'final') "
                                  "WHERE enrollment_id = %s", (co3, enr))
                else:
                    r = mine(sub, "SELECT earned_text, possible_text, percent_text, percent_key_text FROM my_course_total(%s, 'final')", (co3,))
                return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

            def cell3(sub, enr):
                r = mine(sub, "SELECT state, points_earned FROM gradebook_cells(%s, 'final') WHERE enrollment_id = %s "
                              "AND assignment_offering_id = %s", (co3, enr, HW))
                return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

            def view3(sub):
                r = mine(sub, "SELECT points_earned, source, is_finalized FROM my_grades WHERE assignment_offering_id = %s", (HW,))
                return tuple(r[1][0]) if r[0] == "ok" and r[1] else None

            def f(x):
                return float(x) if x is not None else None

            def np_rules(on):
                """Step 1 refuses a change to a published item that a new page made (a due date, its points). The step 2
                release removes those rules; the proof switches them off for the statements that need it, as the Stage E
                proofs do."""
                for trg in ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"):
                    cur.execute(f"ALTER TABLE assignment_offerings {'ENABLE' if on else 'DISABLE'} TRIGGER {trg}")

            def agree(label, stu, enr):
                """The cadet's total, the staff total for that cadet and the cell the export reads are one answer."""
                mt3, st3 = tot3(stu), tot3(dir3, enr)
                t.chk(f"{label}: the cadet's total is the staff total for that cadet", mt3 is not None and mt3 == st3, (mt3, st3))
                sc3, mc3 = cell3(dir3, enr), cell3(stu, enr)
                t.chk(f"{label}: the cell the export reads is the same for staff and for the cadet", sc3 is not None and sc3 == mc3, (sc3, mc3))
                return mt3, sc3

            r = [answer(stuA3, "q1", "9.8"), answer(stuA3, "q2", "0"), answer(stuB3, "q1", "9.0"), answer(stuB3, "q2", "5")]
            t.chk("four answers go through the answer functions and are stored", all(x.get("status") == "ok" for x in r), r)
            t.chk("the grade is source auto_checked, finalized, and the sum of the best tries (A has 3 of 3, B has 0)",
                  one("SELECT points_earned FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s AND source = 'auto_checked' AND is_finalized", (enrA3, HW)) == 3
                  and one("SELECT points_earned FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s AND source = 'auto_checked'", (enrB3, HW)) == 0)

            # -- before the deadline: my_grades must return the auto-checked grade (Stage E reads it from there) ---
            vA, vB = view3(stuA3), view3(stuB3)
            t.chk("my_grades returns the auto-checked grade before the deadline (3, auto_checked, finalized)",
                  vA is not None and f(vA[0]) == 3 and vA[1] == "auto_checked" and vA[2] is True, vA)
            t.chk("and the other cadet's grade of 0", vB is not None and f(vB[0]) == 0 and vB[1] == "auto_checked", vB)
            r = mine(stuA3, "SELECT enrollment_id FROM my_grades WHERE assignment_offering_id = %s", (HW,))
            t.chk("a cadet sees only their own grade row in my_grades", r[0] == "ok" and [str(x[0]) for x in r[1]] == [sA3], r)
            r = mine(stuA3, "SELECT diagnostic FROM my_grades")
            t.chk("my_grades has no diagnostic column", r[0] == "error", r)
            r = mine(stuA3, "SELECT count(*) FILTER (WHERE enrollment_id = %s), count(*) FILTER (WHERE enrollment_id <> %s) FROM question_attempts", (enrA3, enrA3))
            t.chk("a cadet reads only their own stored attempts (two) and never another cadet's", r[0] == "ok" and r[1][0] == (2, 0), r)
            r = mine(stuA3, "SELECT count(*) FROM question_keys")
            t.chk("a cadet reads no answer key", r[0] == "error" or r[1][0][0] == 0, r)
            mt3, sc3 = agree("before the deadline", stuA3, enrA3)
            t.chk("before the deadline the item is in progress and shows its points so far, and stays out of the total",
                  sc3 is not None and sc3[0] == "in_progress" and f(sc3[1]) == 3 and mt3 is not None and f(mt3[0]) == 0 and f(mt3[1]) == 0, (sc3, mt3))
            agree("before the deadline, other cadet", stuB3, enrB3)

            # -- the audit of an answer: a real actor ---------------------------------------------------------------
            def events(enr):
                cur.execute("SELECT event, actor::text, detail ->> 'via' FROM grade_events WHERE enrollment_id = %s "
                            "AND course_offering_id = %s ORDER BY occurred_at, id", (enr, co3))
                return cur.fetchall()
            evA = events(enrA3)
            t.chk("an answer's grade write is logged (created, then rescored)", [e[0] for e in evA][:2] == ["created", "rescored"], evA)
            t.chk("with the student's own sign-in id as the actor, written 'answer'", evA and all(e[1] == stuA3 and e[2] == "answer" for e in evA), evA)
            t.chk("no automatic write is logged without an actor", one("SELECT count(*) FROM grade_events WHERE course_offering_id = %s AND actor IS NULL", (co3,)) == 0)
            t.chk("the actor settings are cleared after the write", one("SELECT coalesce(current_setting('app.audit_actor', true), '')") == "")

            # -- a person's correction guard ------------------------------------------------------------------------
            r = sess(dir3, "UPDATE grades SET points_earned = 2 WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW), keep=True)
            t.chk("a staff correction of a finalized grade on a new-page item is still refused while the step 1 rule stands",
                  r[0] == "error" and "grades_new_items_stay_unfinalized" in str(r[2]), r)

            # -- a staff member corrects the key, then re-marks ---------------------------------------------------------
            upd = one("SELECT updated_at FROM questions WHERE id = %s", (Q1,))
            r = sess(dir3, "SELECT key_version FROM save_question(%s, %s, %s::jsonb, true, %s::jsonb, 1)",
                     (Q1, upd, json.dumps({"prompt_md": "How fast?", "points": 2, "choices": None, "unit_hint": None}),
                      json.dumps({"value": 9.0, "tol_pct": 2})), keep=True)
            t.chk("a Director corrects the key of the first question (9.0, 2 percent)", r[0] == "ok" and r[1] == 2, r)
            rc = _call(cur, "service_role", "remark_context", dir3, Q1)
            t.chk("the re-mark asks for the key and the stored attempts", rc.get("status") == "ok" and len(rc.get("attempts", [])) == 2, str(rc)[:120])
            vs = []
            for a in rc["attempts"]:
                ok, parsed = _verdict("numeric", a["answer"], rc["key"], [])
                vs.append({"id": a["id"], "is_correct": ok, "parsed": parsed})
            pv = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), False, None)
            t.chk("the preview writes nothing and says two attempts and two grades move",
                  pv.get("status") == "ok" and pv.get("attempts_changed") == 2 and pv.get("grades_to_recompute") == 2
                  and f(view3(stuA3)[0]) == 3, str(pv)[:160])
            res = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), True, pv.get("preview_token"))
            t.chk("the commit applies it", res.get("status") == "ok" and res.get("attempts_changed") == 2, str(res)[:160])
            vA, vB = view3(stuA3), view3(stuB3)
            t.chk("the cadets read the re-marked grades from my_grades (A 3 to 1, B 0 to 2)",
                  vA is not None and f(vA[0]) == 1 and vB is not None and f(vB[0]) == 2, (vA, vB))
            mt3, sc3 = agree("after the re-mark, before the deadline", stuA3, enrA3)
            t.chk("the cell shows the new points", sc3 is not None and sc3[0] == "in_progress" and f(sc3[1]) == 1, sc3)
            agree("after the re-mark, before the deadline, other cadet", stuB3, enrB3)
            evA = events(enrA3)
            t.chk("the re-mark's grade change is logged with the Director as the actor, written 'remark'",
                  evA and evA[-1][0] == "rescored" and evA[-1][1] == dir3 and evA[-1][2] == "remark", evA)
            t.chk("and every event of both cadets names an actor", one("SELECT count(*) FROM grade_events WHERE course_offering_id = %s AND actor IS NULL", (co3,)) == 0)
            t.chk("one re-mark run is logged, by the same Director",
                  one("SELECT count(*) FROM key_remark_runs WHERE question_id = %s AND run_by = %s", (Q1, dir3)) == 1)

            # -- after the deadline the item counts, and every reader agrees --------------------------------------------
            np_rules(False)
            cur.execute("UPDATE assignment_offerings SET due_at = now() - interval '1 day' WHERE id = %s", (HW,))
            np_rules(True)
            mtA, scA = agree("after the deadline", stuA3, enrA3)
            mtB, scB = agree("after the deadline, other cadet", stuB3, enrB3)
            t.chk("after the deadline the cells are released and the totals count the item (A 1 of 3, B 2 of 3)",
                  scA and scA[0] == "released" and mtA and f(mtA[0]) == 1 and f(mtA[1]) == 3
                  and scB and scB[0] == "released" and mtB and f(mtB[0]) == 2 and f(mtB[1]) == 3, (scA, mtA, scB, mtB))
            t.chk("the percent the export holds is the percent the cadet sees",
                  mtA is not None and mtA[3].startswith("33.3333") and mtA[3] == tot3(dir3, enrA3)[3], mtA)
            # a second correction after the deadline: the same readers still agree
            upd = one("SELECT updated_at FROM questions WHERE id = %s", (Q1,))
            r = sess(dir3, "SELECT key_version FROM save_question(%s, %s, %s::jsonb, true, %s::jsonb, 2)",
                     (Q1, upd, json.dumps({"prompt_md": "How fast?", "points": 2, "choices": None, "unit_hint": None}),
                      json.dumps({"value": 9.8, "tol_pct": 2})), keep=True)
            rc = _call(cur, "service_role", "remark_context", dir3, Q1)
            vs = []
            for a in rc["attempts"]:
                ok, parsed = _verdict("numeric", a["answer"], rc["key"], [])
                vs.append({"id": a["id"], "is_correct": ok, "parsed": parsed})
            pv = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), False, None)
            res = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), True, pv.get("preview_token"))
            t.chk("a correction back to 9.8 re-marks after the deadline too", r[0] == "ok" and res.get("status") == "ok", (r, str(res)[:100]))
            mtA, scA = agree("after the deadline and a second re-mark", stuA3, enrA3)
            mtB, scB = agree("after the deadline and a second re-mark, other cadet", stuB3, enrB3)
            t.chk("A is back to 3 of 3 and B to 0 of 3 for the cadet, staff and the export cells",
                  mtA and f(mtA[0]) == 3 and f(mtA[1]) == 3 and mtB and f(mtB[0]) == 0 and f(mtB[1]) == 3
                  and f(scA[1]) == 3 and f(scB[1]) == 0, (mtA, mtB, scA, scB))
            # put the deadline back so the later steps see an open item
            np_rules(False)
            cur.execute("UPDATE assignment_offerings SET due_at = %s WHERE id = %s", (gl.days(2), HW))
            np_rules(True)

            # -- the guard when the step 1 rule is gone ---------------------------------------------------------------
            print("  (the step 1 new-page rule is switched off below, as the step 2 release that removes it would)")
            cur.execute("ALTER TABLE grades DISABLE TRIGGER grades_new_items_stay_unfinalized")
            try:
                r = sess(dir3, "UPDATE grades SET points_earned = 2.5 WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW), keep=True)
                t.chk("a Director corrects a cadet's auto-checked grade by hand", r[0] == "ok" and r[1] == 1, r)
                cur.execute("SELECT points_earned, source, graded_by::text FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW))
                g = cur.fetchone()
                t.chk("the grade moves out of auto_checked to instructor, graded by that Director, at the points typed",
                      g and f(g[0]) == 2.5 and g[1] == "instructor" and g[2] == dir3, g)
                evB = events(enrB3)
                t.chk("and the correction is logged with the Director as the actor", evB and evB[-1][1] == dir3, evB)
                n_att = one("SELECT count(*) FROM question_attempts WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW))
                r = answer(stuB3, "q2", "0")
                cur.execute("SELECT points_earned, source FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW))
                g = cur.fetchone()
                t.chk("the cadet's next answer is stored, and does not overwrite the correction",
                      r.get("status") == "ok" and one("SELECT count(*) FROM question_attempts WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW)) == n_att + 1
                      and f(g[0]) == 2.5 and g[1] == "instructor", (r, g))
                upd = one("SELECT updated_at FROM questions WHERE id = %s", (Q1,))
                sess(dir3, "SELECT key_version FROM save_question(%s, %s, %s::jsonb, true, %s::jsonb, 3)",
                     (Q1, upd, json.dumps({"prompt_md": "How fast?", "points": 2, "choices": None, "unit_hint": None}),
                      json.dumps({"value": 9.0, "tol_pct": 2})), keep=True)
                rc = _call(cur, "service_role", "remark_context", dir3, Q1)
                vs = []
                for a in rc["attempts"]:
                    ok, parsed = _verdict("numeric", a["answer"], rc["key"], [])
                    vs.append({"id": a["id"], "is_correct": ok, "parsed": parsed})
                pv = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), False, None)
                res = _call(cur, "service_role", "remark_apply", dir3, Q1, rc["key_version_id"], _J(vs), True, pv.get("preview_token"))
                cur.execute("SELECT points_earned, source FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enrB3, HW))
                g = cur.fetchone()
                t.chk("a re-mark lists the corrected grade and leaves it as the Director set it",
                      res.get("status") == "ok" and res.get("grades_listed", 0) >= 1 and f(g[0]) == 2.5 and g[1] == "instructor", (str(res)[:120], g))
                agree("with a hand correction standing", stuB3, enrB3)
            finally:
                cur.execute("ALTER TABLE grades ENABLE TRIGGER grades_new_items_stay_unfinalized")
        except Exception as exc:  # noqa: BLE001
            import traceback; traceback.print_exc(limit=-4)
            t.chk("section 10 ran to the end", False, repr(exc))
            cur.execute("ROLLBACK")

        print("\n=== 11. a finished term keeps its points when a shared question is edited (074) ===")
        try:
            cur.execute("BEGIN")
            t_old = b.term("tog-old", "Together finished term", starts="2025-01-01", ends="2025-06-01")
            co_old = b.offering(course3, t_old, False)
            ao_old = b.id("ao", "tog-hw-old")
            cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, due_at, due_by_day, grading_mode, "
                        "points_possible, is_published, entered_on_new_page) VALUES (%s, %s, %s, %s, '{}'::jsonb, 'points', 3, false, true)",
                        (ao_old, hw["assignment"], co_old, gl.days(-300)))
            cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, available_after, is_visible, "
                        "position, delivery, grading) VALUES (%s, %s, 'graded', 'always', true, 0, 'online_questions', 'auto_checked')",
                        (ao_old, hw["activities"][0]))
            cur.execute("COMMIT")
            t.chk("the finished term's copy starts at 3 points, like the current one",
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (ao_old,)) == 3
                  and one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (HW,)) == 3)
            upd = one("SELECT updated_at FROM questions WHERE id = %s", (Q2,))
            np_rules(False)      # step 1 refuses a points change on a published new-page item; step 2 removes that rule
            r = sess(dir3, "SELECT key_version FROM save_question(%s, %s, %s::jsonb, false, NULL, NULL)",
                     (Q2, upd, json.dumps({"prompt_md": "Made-up question.", "points": 4, "choices": None, "unit_hint": None})), keep=True)
            t.chk("a Director edits a shared question's points (1 to 4)", r[0] == "ok", r)
            t.chk("the current term's item follows the questions (3 to 6)",
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (HW,)) == 6,
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (HW,)))
            t.chk("the finished term's item keeps the points it was graded out of (still 3)",
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (ao_old,)) == 3,
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (ao_old,)))
            t.chk("no grade of the current term is above what its item offers",
                  one("SELECT count(*) FROM grades g JOIN assignment_offerings a ON a.id = g.assignment_offering_id "
                      "WHERE g.assignment_offering_id = %s AND g.points_earned > a.points_possible", (HW,)) == 0)
            cur.execute("UPDATE questions SET points = 1 WHERE id = %s", (Q2,))
            np_rules(True)
            t.chk("putting it back restores the current term and still leaves the finished one",
                  one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (HW,)) == 3
                  and one("SELECT points_possible FROM assignment_offerings WHERE id = %s", (ao_old,)) == 3)
        except Exception as exc:  # noqa: BLE001
            import traceback; traceback.print_exc(limit=-4)
            t.chk("section 11 ran to the end", False, repr(exc))
            cur.execute("ROLLBACK")

        print("\n=== 12. functions executable by everyone: only what a policy needs (076) ===")
        try:
            cur.execute("""SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'app' AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype
                              AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0)
                            ORDER BY 1""")
            pub = [r_[0] for r_ in cur.fetchall()]
            helpers = ["current_uid", "director_courses", "director_offerings", "is_admin", "is_staff", "my_assignment_offerings",
                       "my_enrollments", "my_offerings", "my_student_id", "session_must_change_password", "session_uid",
                       "staff_offerings", "staff_sections"]
            t.chk("the only ordinary functions left executable by everyone are the row-security helpers", pub == helpers,
                  sorted(set(pub) ^ set(helpers)))
            t.chk("a signed-in user and anon cannot run the term freeze functions",
                  not one("SELECT has_function_privilege('authenticated', 'app.freeze_term(text, boolean)', 'EXECUTE')")
                  and not one("SELECT has_function_privilege('anon', 'app.freeze_assignment_offering(uuid, boolean)', 'EXECUTE')"))
            t.chk("the data tier that runs the freeze tool still can",
                  one("SELECT has_function_privilege('prep_app_dml', 'app.freeze_term(text, boolean)', 'EXECUTE')")
                  and one("SELECT has_function_privilege('prep_app_dml', 'app.freeze_assignment_offering(uuid, boolean)', 'EXECUTE')"))
            t.chk("every student-page call is still granted: gradebook_cells, my_course_total, student_homework, my_work state",
                  all(one(f"SELECT has_function_privilege('authenticated', '{sig}', 'EXECUTE')") for sig in
                      ("app.gradebook_cells(uuid, text)", "app.my_course_total(uuid, text)", "app.student_homework(uuid)",
                       "app.my_visible_grade_cells()")))
            t.chk("no answer or re-mark function is callable by a signed-in user or anon",
                  not any(one(f"SELECT has_function_privilege('{ro}', '{sig}', 'EXECUTE')") for ro in ("authenticated", "anon") for sig in
                          ("app.record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid)", "app.answer_context(uuid, uuid, uuid)",
                           "app.remark_apply(uuid, uuid, uuid, jsonb, boolean, text)", "app.remark_context(uuid, uuid)")))
        except Exception as exc:  # noqa: BLE001
            import traceback; traceback.print_exc(limit=-4)
            t.chk("section 12 ran to the end", False, repr(exc))
            cur.execute("ROLLBACK")

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
                if "070" in STEP2 and "view3" in locals():
                    t.chk("after the re-apply the homework grade is again read from my_grades and the cadet, staff and export cells agree",
                          view3(stuA3) is not None and tot3(stuA3) == tot3(dir3, enrA3) and cell3(stuA3, enrA3) == cell3(dir3, enrA3),
                          (view3(stuA3), tot3(stuA3), tot3(dir3, enrA3)))
        code = 0 if t.f == 0 else 1
    finally:
        s.close()
    print(f"\n{t.p} passed, {t.f} failed")
    return code


if __name__ == "__main__":
    sys.exit(main())
