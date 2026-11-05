#!/usr/bin/env python3
"""Prove the review-C fixes to migrations 047 and 048 on a THROWAWAY database built through 059.

Cases (each is expected to FAIL on the files as they were before the fixes, and to pass after):

  B1  A finalized interactive grade whose release time is in the future cannot be replaced by a second report,
      by commit_work or by save_interactive_work, after a staff reopen. The server reads the grade itself.
  M1  The grades a cadet reads (my_grades) are exactly the cells the gradebook shows the cadet points for.
  M2  A cadet cannot start a submission on an item that has not opened, and cannot save or commit a report to it.
  M4  A question id used twice in one activity, where a copy carries key text, is refused when the key is filed.
  M5  A multiple-choice or numerical correct answer is filed with machine fields as well as the readable line.
  D1  The refusal for a missed deadline names the deadline, in America/Denver time.

Sessions are simulated (the `authenticated` role plus `request.jwt.claims`). Names and ids are invented; no id is
printed. Staging project only (db_target refuses anything else); one database, dropped afterwards.

Usage:  python scripts/staging/test_review_c_fixes_scratch.py --expect-ref <staging_ref>
Exit 0 only when every case passes.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scratch_lib import Scratch, Tally, uid  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_rc", args.expect_ref, before="999")
    t = Tally()
    code = 1
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        names = "course term co sec enr stu dir".split()
        F = {k: uid() for k in names}
        items = {   # name: (modality, due SQL, extra)
            "int_held": ("interactive", "now() + interval '3 days'"),
            "int_future": ("interactive", "now() + interval '30 days'"),
            "w_rel": ("written", "now() + interval '3 days'"),
            "w_hold": ("written", "now() + interval '3 days'"),
            "w_stale": ("written", "now() + interval '3 days'"),
            "w_exc": ("written", "now() + interval '3 days'"),
            "w_past": ("written", "now() - interval '1 hour'"),
        }
        for it in items:
            for p in ("asg", "act", "ao"):
                F[f"{p}_{it}"] = uid()
        cur.execute("BEGIN")
        cur.execute("INSERT INTO auth.users (id) VALUES (%s),(%s)", (F["stu"], F["dir"]))
        cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F["dir"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A')", (F["course"],))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2027-12-01')", (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true)", (F["co"], F["course"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}')", (F["sec"], F["co"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000941,'Synthetic Cadet One',%s)", (F["stu"],))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000941,%s)", (F["enr"], F["sec"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')", (F["dir"], F["co"]))
        for it, (mod, due) in items.items():
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,'Synthetic')",
                        (F[f"asg_{it}"], F["course"], f"syn-{it}"))
            content = {"questions": [{"id": "q3", "type": "free_response", "points": 1, "text": "Explain."}]} if mod == "written" \
                else {"artifact_url": "https://example.invalid/a"}
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,%s,%s,'a',%s,0)",
                        (F[f"act_{it}"], F[f"asg_{it}"], mod, f"syn-{it}-act", json.dumps(content)))
            cur.execute(f"INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published, due_at, late_allowed) "
                        f"VALUES (%s,%s,%s,%s,2,true,{due},false)",
                        (F[f"ao_{it}"], F[f"asg_{it}"], F["co"], "effort" if mod == "interactive" else "points"))
            cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role) VALUES (%s,%s,'graded')",
                        (F[f"ao_{it}"], F[f"act_{it}"]))
        cur.execute("COMMIT")
        S, DIR = F["stu"], F["dir"]

        def q(sub, sql, params=(), keep=True):
            return s.attempt(sub, sql, params, keep=keep)

        def ok(r):
            return r[0] == "ok"

        # ---------------- B1 ----------------
        print("\nB1  a held finalized grade does not hide itself from the resubmission guard")
        r = q(S, "SELECT out_is_late FROM commit_work(%s,%s,%s::jsonb,'first',5)", (F["ao_int_held"], F["act_int_held"], json.dumps({"schema": 1, "effort": 2})))
        t.chk("first report commits", ok(r), r)
        pts = lambda: one("SELECT points_earned FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr"], F["ao_int_held"]))
        t.chk("the first report (effort 2) made a finalized grade of 1", float(pts()) == 1.0 and
              one("SELECT is_finalized FROM grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr"], F["ao_int_held"])) is True)
        cur.execute("UPDATE assignment_offerings SET grades_release_at = now() + interval '5 days' WHERE id=%s", (F["ao_int_held"],))
        t.chk("held: the cadet reads no grade of it", q(S, "SELECT count(*) FROM my_grades WHERE assignment_offering_id=%s", (F["ao_int_held"],)) == ("ok", 0))
        sid = one("SELECT id FROM submissions WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr"], F["ao_int_held"]))
        r = q(DIR, "UPDATE submissions SET status='draft', chosen_activity_id=NULL, unlocked_by=%s, unlocked_at=now() WHERE id=%s", (DIR, sid))
        t.chk("a staff reopen of the submission works", ok(r), r)
        r = q(S, "SELECT out_is_late FROM commit_work(%s,%s,%s::jsonb,'second',5)", (F["ao_int_held"], F["act_int_held"], json.dumps({"schema": 1, "effort": 5})))
        t.chk("a second report through commit_work is refused while a finalized grade stands", r[0] == "error", r)
        r = q(S, "SELECT save_interactive_work(%s,%s,%s::jsonb,'second',5,true)", (sid, F["act_int_held"], json.dumps({"schema": 1, "effort": 5})))
        t.chk("a second report through save_interactive_work is refused while a finalized grade stands", r[0] == "error", r)
        t.chk("the grade is still 1 (a second report of effort 5 would make it 2)", float(pts()) == 1.0, pts())

        # ---------------- M2 ----------------
        print("\nM2  release time on the write doors")
        r = q(S, "INSERT INTO submissions (enrollment_id, assignment_offering_id, status) VALUES (%s,%s,'draft')", (F["enr"], F["ao_int_future"]), keep=False)
        t.chk("a cadet cannot start a submission on an item that has not opened", r[0] == "error", r)
        cur.execute("INSERT INTO submissions (enrollment_id, assignment_offering_id, status) VALUES (%s,%s,'draft') ON CONFLICT DO NOTHING", (F["enr"], F["ao_int_future"]))
        sid2 = one("SELECT id FROM submissions WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr"], F["ao_int_future"]))
        r = q(S, "SELECT save_interactive_work(%s,%s,%s::jsonb,'x',1,true)", (sid2, F["act_int_future"], json.dumps({"schema": 1, "effort": 5})))
        t.chk("a report cannot be saved to an item that has not opened, even with a row already there", r[0] == "error", r)
        cur.execute("DELETE FROM submissions WHERE id=%s", (sid2,))

        # ---------------- M1 ----------------
        print("\nM1  my_grades is the gradebook's visibility rule")
        cur.execute("GRANT EXECUTE ON FUNCTION gradebook_cells(uuid, text) TO authenticated")
        for it in ("w_rel", "w_hold", "w_stale", "w_exc"):
            cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source, is_finalized) "
                        "VALUES (%s,%s,2,2,'instructor',false)", (F[f"ao_{it}"], F["enr"]))
        cur.execute("UPDATE grades SET points_earned=0, source='ai_suggested', diagnostic='{\"no_submission\": true}'::jsonb, graded_at = now() - interval '2 days' "
                    "WHERE assignment_offering_id=%s", (F["ao_w_stale"],))
        cur.execute("UPDATE grades SET is_finalized = true WHERE enrollment_id=%s AND assignment_offering_id IN (%s,%s,%s,%s)",
                    (F["enr"], F["ao_w_rel"], F["ao_w_hold"], F["ao_w_stale"], F["ao_w_exc"]))
        cur.execute("UPDATE assignment_offerings SET grades_release_at = now() + interval '5 days' WHERE id=%s", (F["ao_w_hold"],))
        cur.execute("INSERT INTO grade_excusals (enrollment_id, assignment_offering_id, reason, set_by) VALUES (%s,%s,'synthetic',%s)", (F["enr"], F["ao_w_exc"], F["dir"]))
        cur.execute("INSERT INTO submissions (enrollment_id, assignment_offering_id, status) VALUES (%s,%s,'draft') RETURNING id", (F["enr"], F["ao_w_stale"]))
        sid3 = cur.fetchone()[0]
        cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content) VALUES (%s,%s,'{\"q3\":\"a real answer\"}')", (sid3, F["act_w_stale"]))
        cur.execute("SELECT assignment_offering_id::text, state FROM _cells_at(%s,'final',now()) WHERE enrollment_id=%s", (F["co"], F["enr"]))
        states = dict(cur.fetchall())
        want = {"w_rel": "released", "w_hold": "graded_unreleased", "w_stale": "submitted_ungraded", "w_exc": "excused"}
        t.chk("the fixture reaches the four states it means to", all(states.get(F[f"ao_{k}"]) == v for k, v in want.items()), {k: states.get(F[f"ao_{k}"]) for k in want})
        mine = q(S, "SELECT coalesce(string_agg(assignment_offering_id::text, ',' ORDER BY assignment_offering_id::text), '') FROM my_grades")
        book = q(S, "SELECT coalesce(string_agg(assignment_offering_id::text, ',' ORDER BY assignment_offering_id::text), '') "
                    "FROM gradebook_cells(%s) WHERE points_earned IS NOT NULL", (F["co"],))
        t.chk("the cadet's my_grades lists exactly the cells the gradebook shows points for", ok(mine) and ok(book) and mine[1] == book[1], (mine, book))
        t.chk("and a grade the gradebook withholds (held, stale zero, excused) is not in my_grades",
              ok(mine) and not any(F[f"ao_{k}"] in mine[1] for k in ("w_hold", "w_stale", "w_exc")), mine)
        t.chk("and a released grade is", ok(mine) and F["ao_w_rel"] in mine[1], mine)

        # ---------------- D1 ----------------
        print("\nD1  the missed-deadline refusal names the date")
        r = q(S, "SELECT out_is_late FROM commit_work(%s,%s,NULL,NULL,NULL)", (F["ao_w_past"], F["act_w_past"]))
        want_date = one("SELECT to_char((due_at AT TIME ZONE 'America/Denver'), 'FMMonth FMDD, YYYY') FROM assignment_offerings WHERE id=%s", (F["ao_w_past"],))
        t.chk("the refusal text names the deadline's date in Mountain time", r[0] == "error" and want_date in r[2] and "Mountain" in r[2], r)

        # ---------------- M5, M4 ----------------
        print("\nM5  multiple-choice and numerical keys keep machine fields")
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight','syn-keys','Synthetic keys')", (uid(), F["course"]))
        asg_k = one("SELECT id FROM assignments WHERE slug='syn-keys'")
        act_k = uid()
        content = {"questions": [
            {"id": "m1", "type": "multiple_choice", "points": 1, "text": "Pick.", "options": ["A. x", "B. y"], "correct_answer": "B. y"},
            {"id": "n1", "type": "numerical", "points": 1, "text": "Value?", "correct_answer": "9.8"},
            {"id": "n0", "type": "numerical", "points": 1, "text": "Zero?", "correct_answer": "0"}]}
        cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,'written','syn-keys-act','k',%s,0)",
                    (act_k, asg_k, json.dumps(content)))
        row = lambda qid: (cur.execute("SELECT k.correct_choice_ids, k.value, k.tol_pct, k.tol_abs, k.reference_text FROM question_keys k JOIN questions qu ON qu.id=k.question_id "
                                       "WHERE qu.activity_id=%s AND qu.qid=%s AND k.superseded_at IS NULL", (act_k, qid)) or cur.fetchone())
        m1, n1, n0 = row("m1"), row("n1"), row("n0")
        t.chk("the key holds no text in content", one("SELECT content::text !~ 'correct_answer' FROM activities WHERE id=%s", (act_k,)) is True)
        t.chk("multiple choice: the correct option is a machine field and the readable line is kept",
              m1 is not None and m1[0] == ["B. y"] and m1[4] == "Correct answer: B. y", m1)
        t.chk("numerical: the value is a machine field with the documented 5 percent tolerance",
              n1 is not None and n1[1] is not None and n1[2] is not None and float(n1[1]) == 9.8 and float(n1[2]) == 5, n1)
        t.chk("numerical zero carries an absolute tolerance (a percentage is useless at 0)",
              n0 is not None and n0[1] is not None and float(n0[1]) == 0 and n0[3] is not None, n0)

        print("\nM4  a repeated question id that carries key text is refused")
        act_d = uid()
        dup = {"questions": [{"id": "d", "type": "free_response", "points": 1, "text": "a", "expected_response": "FIRST"},
                             {"id": "d", "type": "free_response", "points": 1, "text": "b", "expected_response": "SECOND"}]}
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight','syn-dup','Synthetic dup')", (uid(), F["course"]))
        asg_d = one("SELECT id FROM assignments WHERE slug='syn-dup'")
        try:
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,'written','syn-dup-act','d',%s,0)",
                        (act_d, asg_d, json.dumps(dup)))
            refused = False
        except s.psycopg2.Error:
            refused = True
        t.chk("the activity write is refused", refused)

        print(f"\nSUMMARY  {t.p} passed, {t.f} failed")
        code = 0 if t.f == 0 else 1
    finally:
        if not s.close():
            code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
