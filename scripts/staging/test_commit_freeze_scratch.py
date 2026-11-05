#!/usr/bin/env python3
"""Prove migration 048 (commit as one server operation, frozen after commit, server time, late marking, no re-fire,
two tabs, held-lesson opening time) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 047 in a database of its own, loads a
small invented fixture, then:

  BEFORE   048 is not applied. Each GAP attempt (a direct write a cadet should not be able to make) is run and must be
           SERVED here; that shows the tests can fail. Counts are printed.
  APPLY    048.
  AFTER    The same attempts must be REFUSED, and the legitimate path (commit_work and the reads and saves around it)
           must pass: on time, inside the 120 second grace, outside it, with an extension, late where late work is
           allowed, after the term's last day, an item that has not opened, a repeated request, two tabs at once, an
           interrupted commit, a staff reopen and a second commit, a practice report, another cadet.
  ROLLBACK 048's rollback; the old direct path works again and the tables are what they were.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims`. What this cannot show: the real REST path,
the pages, or a real token. The false-browser-clock case is shown at the database: the server never reads a client
time, so the case that mattered (the client writes the time itself) is the direct write, which is refused.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names and ids are
invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_commit_freeze_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE serves at least one gap and every later step passes.
"""
import argparse
import json
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scratch_lib import Scratch, Tally, uid  # noqa: E402
import db_target  # noqa: E402

MIGRATION = "048_commit_freeze_and_receipt.sql"
ROLLBACK = "048_commit_freeze_and_receipt_ROLLBACK.sql"

# name: (course offering key, modality, due as SQL, late_allowed)
ITEMS = {
    "on": ("a", "written", "now() + interval '1 day'", False),
    "past": ("a", "written", "now() - interval '1 hour'", False),
    "grace_in": ("a", "written", "now() - interval '110 seconds'", False),
    "grace_out": ("a", "written", "now() - interval '130 seconds'", False),
    "late": ("a", "written", "now() - interval '1 hour'", True),
    "ext": ("a", "written", "now() - interval '1 hour'", False),
    "closed": ("c", "written", "now() - interval '1 hour'", True),
    "future": ("a", "written", "now() + interval '30 days'", False),
    "int_on": ("a", "interactive", "now() + interval '2 days'", False),
    "int_forge": ("a", "interactive", "now() + interval '2 days'", False),
    "int_past": ("a", "interactive", "now() - interval '1 hour'", False),
    "race": ("a", "written", "now() + interval '1 day'", False),
    "dup": ("a", "written", "now() + interval '1 day'", False),
    "intr": ("a", "written", "now() + interval '1 day'", False),
    "reopen": ("a", "written", "now() + interval '1 day'", False),
    "tabs": ("a", "written", "now() + interval '1 day'", False),
    "g1": ("a", "written", "now() - interval '1 hour'", False),      # forged commit time, past due
    "g2": ("a", "written", "now() + interval '1 day'", False),       # re-fire / moved commit time
    "g3": ("a", "written", "now() + interval '1 day'", False),       # edit and delete after commit
    "g7": ("a", "written", "now() + interval '1 day'", False),       # insert already committed
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_cf", args.expect_ref, before="048")
    code = 1
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        F = {k: uid() for k in ("course_a", "course_c", "term", "term_old", "co_a", "co_c", "sec_a", "sec_c", "sec_a2",
                                "dir", "stu1", "stu2", "enr1", "enr1c", "enr2")}
        for it in ITEMS:
            for p in ("asg", "act", "ao"):
                F[f"{p}_{it}"] = uid()
        cur.execute("BEGIN")
        for k in ("dir", "stu1", "stu2"):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (F[k],))
        cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F["dir"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A'),(%s,'syn-c','Synthetic C')", (F["course_a"], F["course_c"]))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2027-12-01'),"
                    "(%s,'syn-old','Synthetic old','2026-01-01', current_date - 1)", (F["term"], F["term_old"]))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true),(%s,%s,%s,true)",
                    (F["co_a"], F["course_a"], F["term"], F["co_c"], F["course_c"], F["term_old"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}'),(%s,%s,'SC','{M}'),(%s,%s,'SA2','{M}')",
                    (F["sec_a"], F["co_a"], F["sec_c"], F["co_c"], F["sec_a2"], F["co_a"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000931,'Synthetic Cadet One',%s),(3000000932,'Synthetic Cadet Two',%s)",
                    (F["stu1"], F["stu2"]))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000931,%s),(%s,3000000931,%s),(%s,3000000932,%s)",
                    (F["enr1"], F["sec_a"], F["enr1c"], F["sec_c"], F["enr2"], F["sec_c"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director'),(%s,%s,NULL,'director')",
                    (F["dir"], F["co_a"], F["dir"], F["co_c"]))
        for it, (co, mod, due, late) in ITEMS.items():
            course = F["course_" + co]
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,'Synthetic')",
                        (F[f"asg_{it}"], course, f"syn-{it}"))
            content = {"questions": [{"id": "q2", "type": "free_response", "points": 1, "text": "Reflect?"},
                                     {"id": "q3", "type": "free_response", "points": 1, "text": "Explain."}]} if mod == "written" \
                else {"artifact_url": "https://example.invalid/a"}
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,%s,%s,'a',%s,0)",
                        (F[f"act_{it}"], F[f"asg_{it}"], mod, f"syn-{it}-act", json.dumps(content)))
            cur.execute(f"INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published, due_at, late_allowed) "
                        f"VALUES (%s,%s,%s,'points',2,true,{due},%s)",
                        (F[f"ao_{it}"], F[f"asg_{it}"], F["co_" + co], late))
            cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role) VALUES (%s,%s,'graded')",
                        (F[f"ao_{it}"], F[f"act_{it}"]))
        # the interactive items grade by effort, so their grading mode is effort
        cur.execute("UPDATE assignment_offerings SET grading_mode = 'effort' WHERE id IN (%s,%s,%s)", (F["ao_int_on"], F["ao_int_forge"], F["ao_int_past"]))
        cur.execute("INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by) VALUES (%s,%s, now() + interval '2 hours', 'synthetic', NULL)",
                    (F["enr1"], F["ao_ext"]))
        cur.execute("COMMIT")
        print(f"fixture  two courses (one term already over), a director, two cadets, {len(ITEMS)} items (on time, past, inside and outside "
              "the 120 s grace, late-allowed, extended, closed term, not yet open, interactive, race, reopen ...) - all invented")

        S1, S2, DIR = F["stu1"], F["stu2"], F["dir"]

        def q(sub, sql, params=(), keep=True):
            """Run one statement as a simulated session. Returns ('ok', rows) or ('error', pgcode, first line)."""
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(sub),))
                cur.execute(sql, params)
                rows = cur.fetchall() if cur.description else cur.rowcount
                res = ("ok", rows)
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, (str(exc).strip().splitlines() or [""])[0])
            cur.execute("COMMIT" if (keep and res[0] == "ok") else "ROLLBACK")
            cur.execute("RESET ROLE")
            return res

        def ok(r):
            return r[0] == "ok"

        def save_ans(item, who=S1, enr=None, c=None):
            """The cadet saves answers the way the page did before (a draft row + an answer row)."""
            e = enr or F["enr1"]
            cur.execute("INSERT INTO submissions (enrollment_id, assignment_offering_id, status) VALUES (%s,%s,'draft') ON CONFLICT DO NOTHING", (e, F[f"ao_{item}"]))
            cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content) SELECT id, %s, %s FROM submissions WHERE enrollment_id=%s AND assignment_offering_id=%s "
                        "ON CONFLICT (submission_id, activity_id) DO UPDATE SET content = EXCLUDED.content",
                        (F[f"act_{item}"], json.dumps(c or {"q2": "my reflection", "q3": "my answer"}), e, F[f"ao_{item}"]))

        def sub(item, enr=None):
            cur.execute("SELECT id, status, committed_at, chosen_activity_id FROM submissions WHERE enrollment_id=%s AND assignment_offering_id=%s",
                        (enr or F["enr1"], F[f"ao_{item}"]))
            return cur.fetchone()

        def commit_work(item, who=S1, content=None, md=None):
            return q(who, "SELECT * FROM commit_work(%s,%s,%s::jsonb,%s,NULL)",
                     (F[f"ao_{item}"], F[f"act_{item}"], json.dumps(content) if content is not None else None, md))

        def counts():
            return {"submissions": one("SELECT count(*) FROM submissions"),
                    "committed": one("SELECT count(*) FROM submissions WHERE status='committed'"),
                    "answer rows": one("SELECT count(*) FROM submission_activities"),
                    "final answer rows": one("SELECT count(*) FROM submission_activities WHERE is_final"),
                    "grades": one("SELECT count(*) FROM grades"),
                    "receipts": one("SELECT count(*) FROM submission_receipts")}

        # ---------------------------------------------------------------------------------------------------
        # GAPS: direct writes a cadet should not be able to make. Each is prepared fresh, then attempted.
        # Returns True when the bad thing HAPPENED (served).
        # ---------------------------------------------------------------------------------------------------
        def gap_forged_time_past_due():
            save_ans("g1")
            forged = "now() - interval '3 hours'"
            r = q(S1, f"UPDATE submissions SET status='committed', committed_at={forged}, chosen_activity_id=%s WHERE enrollment_id=%s AND assignment_offering_id=%s",
                  (F["act_g1"], F["enr1"], F["ao_g1"]))
            sb = sub("g1")
            return ok(r) and sb[1] == "committed"

        def gap_forged_time_clock_back():
            """A false browser clock: the client writes a time 20 days back on a past-due item."""
            save_ans("int_past")  # a draft row exists
            r = q(S1, "UPDATE submissions SET status='committed', committed_at = now() - interval '20 days', chosen_activity_id=%s WHERE enrollment_id=%s AND assignment_offering_id=%s",
                  (F["act_int_past"], F["enr1"], F["ao_int_past"]))
            return ok(r) and sub("int_past")[1] == "committed"

        def gap_insert_committed():
            r = q(S1, "INSERT INTO submissions (enrollment_id, assignment_offering_id, status, committed_at, chosen_activity_id) VALUES (%s,%s,'committed', now() - interval '5 days', %s)",
                  (F["enr1"], F["ao_g7"], F["act_g7"]))
            return ok(r)

        def gap_move_commit_time():
            save_ans("g2")
            q(S1, "UPDATE submissions SET status='committed', committed_at=now(), chosen_activity_id=%s WHERE enrollment_id=%s AND assignment_offering_id=%s",
              (F["act_g2"], F["enr1"], F["ao_g2"]))
            if sub("g2")[1] != "committed":
                # the direct commit was refused; commit the legitimate way so the later attempts have something to hit
                commit_work("g2")
                if sub("g2")[1] != "committed":
                    return False
            t0 = sub("g2")[2]
            time.sleep(0.05)
            q(S1, "UPDATE submissions SET committed_at = now() + interval '1 hour' WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr1"], F["ao_g2"]))
            return sub("g2")[2] != t0

        def gap_edit_after_commit():
            r = q(S1, "UPDATE submission_activities SET content = '{\"q3\":\"changed after commit\"}'::jsonb WHERE activity_id=%s", (F["act_g2"],))
            return ok(r) and one("SELECT count(*) FROM submission_activities WHERE activity_id=%s AND content::text LIKE '%%changed after commit%%'", (F["act_g2"],)) > 0

        def gap_delete_after_commit():
            r = q(S1, "DELETE FROM submission_activities WHERE activity_id=%s", (F["act_g2"],))
            return ok(r) and one("SELECT count(*) FROM submission_activities WHERE activity_id=%s", (F["act_g2"],)) == 0

        def gap_forged_grade():
            """E1: write a report with effort 5 and commit directly."""
            cur.execute("INSERT INTO submissions (enrollment_id, assignment_offering_id, status) VALUES (%s,%s,'draft') ON CONFLICT DO NOTHING", (F["enr1"], F["ao_int_forge"]))
            cur.execute("SELECT id FROM submissions WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr1"], F["ao_int_forge"]))
            sid = cur.fetchone()[0]
            q(S1, "SELECT save_interactive_work(%s,%s,%s::jsonb,'forged',6,true)", (sid, F["act_int_forge"], json.dumps({"schema": 1, "effort": 5, "reading_reflection": {"meaningful": True}})))
            q(S1, "UPDATE submissions SET status='committed', committed_at=now(), chosen_activity_id=%s WHERE id=%s", (F["act_int_forge"], sid))
            return one("SELECT count(*) FROM grades WHERE assignment_offering_id=%s AND is_finalized AND source='derived' AND effort=5", (F["ao_int_forge"],)) > 0

        def gap_refire():
            """The grade is re-derived when an already-committed row is updated again."""
            cur.execute("SELECT updated_at FROM grades WHERE assignment_offering_id=%s", (F["ao_int_forge"],))
            row = cur.fetchone()
            if not row:
                return False            # no grade was minted, so there is nothing to re-fire
            t0 = row[0]
            time.sleep(0.05)
            cur.execute("UPDATE submissions SET status='committed' WHERE enrollment_id=%s AND assignment_offering_id=%s", (F["enr1"], F["ao_int_forge"]))
            cur.execute("SELECT updated_at FROM grades WHERE assignment_offering_id=%s", (F["ao_int_forge"],))
            return cur.fetchone()[0] != t0

        GAPS = [("a past-due commit with a time the client wrote", gap_forged_time_past_due),
                ("a past-due commit under a clock set back 20 days", gap_forged_time_clock_back),
                ("a submission inserted already committed with a chosen time", gap_insert_committed),
                ("the commit time moved after commit", gap_move_commit_time),
                ("answers edited after commit", gap_edit_after_commit),
                ("answers deleted after commit", gap_delete_after_commit),
                ("a report with effort 5 written and committed directly (grade minted)", gap_forged_grade),
                ("a grade re-derived by re-sending the commit (re-fire)", gap_refire)]

        def run_gaps(label):
            print(f"\n{label}   {counts()}")
            served = 0
            for name, fn in GAPS:
                hit = fn()
                served += hit
                print(f"  {'SERVED ' if hit else 'refused'}  {name}")
            return served

        t = Tally()
        # the gap attempts leave rows behind; the BEFORE run is the only one that needs a clean slate, and they are
        # prepared on items used by no other case. The legitimate path below uses different items.
        b_served = run_gaps("BEFORE (048 not applied)")
        t.chk("BEFORE: the gap is served (the tests can fail)", b_served >= 6, f"served {b_served} of {len(GAPS)}")
        t.chk("BEFORE: commit_work does not exist yet", commit_work("on")[0] == "error")
        before_state = counts()

        # reset the rows the gaps made, as the owner, so the AFTER run starts from the same slate
        cur.execute("DELETE FROM submissions"); cur.execute("DELETE FROM grades")

        if not s.apply_file(MIGRATION):
            return 1
        print(f"\napplied  {MIGRATION}")

        a_served = run_gaps("AFTER (048 applied)")
        t.chk("AFTER: every gap attempt is refused", a_served == 0, f"served {a_served}")
        cur.execute("DELETE FROM submissions"); cur.execute("DELETE FROM grades"); cur.execute("DELETE FROM submission_receipts")

        print("\nTHE SUBMIT PATH   " + str(counts()))
        # -- on time ------------------------------------------------------------------------------------------
        save_ans("on")
        r = commit_work("on")
        row = r[1][0] if ok(r) else None
        t.chk("on time: commit_work returns a receipt, not late, not a repeat", ok(r) and row[3] is False and row[5] is False and row[1] is not None, r)
        sb = sub("on")
        t.chk("on time: committed, chosen set, time stamped by the server (within 5 s of now)",
              sb[1] == "committed" and sb[3] == F["act_on"] and one("SELECT abs(extract(epoch FROM (now() - %s::timestamptz))) < 5", (sb[2],)))
        t.chk("on time: the answer row is final and the receipt hash is 64 hex characters",
              one("SELECT is_final FROM submission_activities WHERE activity_id=%s", (F["act_on"],)) is True and len(row[4] or "") == 64)
        # -- repeated request ---------------------------------------------------------------------------------
        r2 = commit_work("on")
        t.chk("a second request changes nothing and returns the first receipt",
              ok(r2) and r2[1][0][5] is True and r2[1][0][1] == row[1] and r2[1][0][2] == row[2]
              and one("SELECT count(*) FROM submission_receipts WHERE submission_id=%s", (sb[0],)) == 1)
        # -- the grace ----------------------------------------------------------------------------------------
        cur.execute("UPDATE assignment_offerings SET due_at = now() - interval '100 seconds' WHERE id = %s", (F["ao_grace_in"],))
        save_ans("grace_in"); r = commit_work("grace_in")
        t.chk("100 seconds late is inside the 120 second grace: on time", ok(r) and r[1][0][3] is False, r)
        cur.execute("UPDATE assignment_offerings SET due_at = now() - interval '140 seconds' WHERE id = %s", (F["ao_grace_out"],))
        save_ans("grace_out"); r = commit_work("grace_out")
        t.chk("140 seconds late is outside it: refused when late work is not allowed", r[0] == "error" and r[1] == "P0001", r)
        t.chk("a refusal leaves no committed row", sub("grace_out")[1] == "draft")
        # -- past due, late not allowed ----------------------------------------------------------------------
        save_ans("past"); r = commit_work("past")
        t.chk("past due, late work not allowed: refused with a sentence", r[0] == "error" and "deadline" in (r[2] or ""), r)
        t.chk("the saved answers are untouched by the refusal",
              one("SELECT content::text FROM submission_activities WHERE activity_id=%s", (F["act_past"],)) .find("my answer") > 0)
        # -- late allowed -------------------------------------------------------------------------------------
        save_ans("late"); r = commit_work("late")
        t.chk("past due on a late-allowed item: committed and marked late", ok(r) and r[1][0][3] is True, r)
        t.chk("the receipt carries the late mark", one("SELECT is_late FROM submission_receipts WHERE activity_id=%s", (F["act_late"],)) is True)
        # -- extension ----------------------------------------------------------------------------------------
        save_ans("ext"); r = commit_work("ext")
        t.chk("an extension moves the deadline: committed, not late", ok(r) and r[1][0][3] is False, r)
        # -- term over ---------------------------------------------------------------------------------------
        save_ans("closed", enr=F["enr1c"]); r = commit_work("closed")
        t.chk("after the term's last class day, even late-allowed work is refused", r[0] == "error" and "last class day" in (r[2] or ""), r)
        # -- not yet open ------------------------------------------------------------------------------------
        r = commit_work("future")
        t.chk("an item that has not opened cannot be submitted", r[0] == "error" and "not opened" in (r[2] or ""), r)
        # -- another cadet ----------------------------------------------------------------------------------
        r = commit_work("on", who=S2)
        t.chk("another cadet (not in this course) cannot submit it", r[0] == "error" and r[1] == "42501", r)
        t.chk("another cadet reads none of cadet one's rows", q(S2, "SELECT count(*) FROM submissions WHERE enrollment_id=%s", (F["enr1"],))[1][0][0] == 0)
        # -- a false browser clock ----------------------------------------------------------------------------
        t.chk("no client time is accepted: commit_work has no time argument",
              not any(w in n for n in one("SELECT proargnames FROM pg_proc WHERE proname='commit_work'") if n.startswith("p_") for w in ("time", "_at", "clock")))

        # -- the interactive path -----------------------------------------------------------------------------
        rep = {"schema": 1, "effort": 4, "reading_reflection": {"meaningful": True}}
        r = commit_work("int_on", content=rep, md="synthetic report text")
        g = one("SELECT count(*) FROM grades WHERE assignment_offering_id=%s AND is_finalized AND source='derived' AND effort=4", (F["ao_int_on"],))
        t.chk("interactive: commit_work stores the report, commits and the auto-grade runs once", ok(r) and g == 1, r)
        cur.execute("SELECT updated_at FROM grades WHERE assignment_offering_id=%s", (F["ao_int_on"],)); gt0 = cur.fetchone()[0]
        time.sleep(0.05)
        commit_work("int_on", content={"schema": 1, "effort": 5}, md="second try")
        cur.execute("SELECT updated_at, effort FROM grades WHERE assignment_offering_id=%s", (F["ao_int_on"],)); g1 = cur.fetchone()
        t.chk("interactive: a second commit with a better report changes neither the report nor the grade (no re-fire)",
              g1[0] == gt0 and g1[1] == 4 and one("SELECT report_markdown FROM submission_activities WHERE activity_id=%s", (F["act_int_on"],)) == "synthetic report text")
        cur.execute("SELECT id FROM submissions WHERE assignment_offering_id=%s", (F["ao_int_on"],)); isid = cur.fetchone()[0]
        r = q(S1, "SELECT save_interactive_work(%s,%s,'{\"schema\":1,\"effort\":5}'::jsonb,'x',1,true)", (isid, F["act_int_on"]))
        t.chk("interactive: the report cannot be replaced after it carries credit", r[0] == "error", r)
        r = commit_work("int_past", content=rep, md="late report")
        t.chk("interactive past due, late work not allowed: refused", r[0] == "error", r)

        # -- two tabs -------------------------------------------------------------------------------------------
        save_ans("tabs", c={"q2": "", "q3": ""})
        cur.execute("SELECT id FROM submissions WHERE assignment_offering_id=%s", (F["ao_tabs"],)); tsid = cur.fetchone()[0]
        q(S1, "SELECT save_written_answers(%s,%s,%s::jsonb)", (tsid, F["act_tabs"], json.dumps({"q2": "from tab A"})))
        q(S1, "SELECT save_written_answers(%s,%s,%s::jsonb)", (tsid, F["act_tabs"], json.dumps({"q3": "from tab B"})))
        c = one("SELECT content FROM submission_activities WHERE activity_id=%s", (F["act_tabs"],))
        t.chk("two tabs: each tab's own change is kept", c.get("q2") == "from tab A" and c.get("q3") == "from tab B", c)
        r = commit_work("tabs")
        r = q(S1, "SELECT save_written_answers(%s,%s,%s::jsonb)", (tsid, F["act_tabs"], json.dumps({"q3": "late edit"})))
        t.chk("a save after commit is refused", r[0] == "error", r)

        # -- two requests at the same moment ---------------------------------------------------------------------
        save_ans("race")
        url = db_target.with_dbname(s.url, s.name)
        results = {}

        def other():
            c2 = s.psycopg2.connect(url, connect_timeout=15); c2.autocommit = True
            k = c2.cursor(); k.execute("SET search_path = app, public, extensions")
            k.execute("BEGIN"); k.execute("SET LOCAL ROLE authenticated"); k.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(S1),))
            try:
                k.execute("SELECT * FROM commit_work(%s,%s,NULL,NULL,NULL)", (F["ao_race"], F["act_race"])); results["b"] = k.fetchall()[0]; k.execute("COMMIT")
            except Exception as exc:  # noqa: BLE001
                results["b"] = ("error", str(exc)); k.execute("ROLLBACK")
            c2.close()
        cur.execute("BEGIN"); cur.execute("SET LOCAL ROLE authenticated"); cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(S1),))
        cur.execute("SELECT * FROM commit_work(%s,%s,NULL,NULL,NULL)", (F["ao_race"], F["act_race"])); a_row = cur.fetchall()[0]
        th = threading.Thread(target=other); th.start(); time.sleep(1.0)
        waiting = th.is_alive()
        cur.execute("COMMIT"); cur.execute("RESET ROLE"); th.join(15)
        b_row = results.get("b")
        t.chk("two requests at once: the second waits for the first, then returns the same receipt",
              waiting and a_row[5] is False and b_row and b_row[0] != "error" and b_row[5] is True and b_row[1] == a_row[1], (waiting, a_row, b_row))
        t.chk("two requests at once: one submission, one receipt",
              one("SELECT count(*) FROM submissions WHERE assignment_offering_id=%s", (F["ao_race"],)) == 1
              and one("SELECT count(*) FROM submission_receipts r JOIN submissions s ON s.id=r.submission_id WHERE s.assignment_offering_id=%s", (F["ao_race"],)) == 1)

        # -- an interrupted commit -------------------------------------------------------------------------------
        save_ans("intr")
        cur.execute("BEGIN"); cur.execute("SET LOCAL ROLE authenticated"); cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(S1),))
        cur.execute("SELECT * FROM commit_work(%s,%s,NULL,NULL,NULL)", (F["ao_intr"], F["act_intr"])); cur.fetchall()
        cur.execute("ROLLBACK"); cur.execute("RESET ROLE")        # the connection dies before the transaction ends
        t.chk("an interrupted commit leaves nothing half-done (still a draft, no receipt, answer not final)",
              sub("intr")[1] == "draft"
              and one("SELECT count(*) FROM submission_receipts r JOIN submissions s ON s.id=r.submission_id WHERE s.assignment_offering_id=%s", (F["ao_intr"],)) == 0
              and one("SELECT is_final FROM submission_activities WHERE activity_id=%s", (F["act_intr"],)) is False)
        r = commit_work("intr")
        t.chk("and the work can then be submitted normally", ok(r) and sub("intr")[1] == "committed")

        # -- direct writes after commit -------------------------------------------------------------------------
        r = q(S1, "UPDATE submission_activities SET content='{\"q3\":\"x\"}'::jsonb WHERE activity_id=%s", (F["act_on"],))
        t.chk("after commit (and after grading time) a direct edit of the answers is refused", r[0] == "error", r)
        r = q(S1, "DELETE FROM submission_activities WHERE activity_id=%s", (F["act_on"],))
        t.chk("after commit a direct delete of the answers is refused", r[0] == "error", r)
        r = q(S1, "UPDATE submissions SET committed_at = now() + interval '1 day' WHERE id=%s", (sb[0],))
        t.chk("after commit the commit time cannot be moved", r[0] == "error", r)
        r = q(S1, "UPDATE submissions SET status='draft' WHERE id=%s", (sb[0],))
        t.chk("a cadet cannot reopen a committed submission (006 still holds)", r[0] == "error", r)

        # -- staff reopen then commit again ---------------------------------------------------------------------
        save_ans("reopen"); commit_work("reopen")
        rid = sub("reopen")[0]
        r = q(DIR, "UPDATE submissions SET status='draft', chosen_activity_id=NULL, unlocked_by=%s, unlocked_at=now() WHERE id=%s", (DIR, rid))
        t.chk("a director can still reopen a committed submission", ok(r) and sub("reopen")[1] == "draft", r)
        r = q(S1, "UPDATE submission_activities SET content='{\"q3\":\"corrected\"}'::jsonb WHERE activity_id=%s", (F["act_reopen"],))
        t.chk("after a reopen the cadet can edit again", ok(r), r)
        r = commit_work("reopen")
        t.chk("and commit again, with a new receipt", ok(r) and r[1][0][5] is False
              and one("SELECT count(*) FROM submission_receipts WHERE submission_id=%s", (rid,)) == 2, r)

        # -- the lesson-opening lookup ---------------------------------------------------------------------------
        r = q(S1, "SELECT my_lesson_opens_at(%s)", ("syn-future-act",))
        t.chk("a held-back lesson reports when it opens (a date in the next 30 days)",
              ok(r) and r[1][0][0] is not None and one("SELECT %s::timestamptz < now() + interval '25 days' AND %s::timestamptz > now()", (r[1][0][0], r[1][0][0])), r)
        r = q(S1, "SELECT my_lesson_opens_at(%s)", ("syn-on-act",))
        t.chk("a lesson that is already open reports nothing", ok(r) and r[1][0][0] is None, r)
        r = q(S2, "SELECT my_lesson_opens_at(%s)", ("syn-future-act",))
        t.chk("a cadet outside the course learns nothing about it", ok(r) and r[1][0][0] is None, r)

        # -- no side effects on a staff read -------------------------------------------------------------------------
        t.chk("the director still reads the submissions and receipts of the course",
              q(DIR, "SELECT count(*) FROM submissions")[1][0][0] > 0 and q(DIR, "SELECT count(*) FROM submission_receipts")[1][0][0] > 0)
        after_state = counts()
        print(f"\nCOUNTS   before the gap attempts {before_state}\n         after the submit path    {after_state}")

        # -- rollback -------------------------------------------------------------------------------------------------
        if not s.apply_file(ROLLBACK, rollback=True):
            return 1
        print(f"\nrolled back {MIGRATION}")
        t.chk("ROLLBACK: commit_work and the guards are gone",
              one("SELECT count(*) FROM pg_proc WHERE proname IN ('commit_work','save_written_answers','my_lesson_opens_at','submissions_commit_guard','submission_activities_freeze')") == 0
              and one("SELECT count(*) FROM pg_trigger WHERE tgname IN ('submissions_commit_guard','submission_activities_freeze','submissions_autograde_interactive_ins')") == 0)
        t.chk("ROLLBACK: the 015 trigger is back and no row was changed (receipts kept)",
              one("SELECT count(*) FROM pg_trigger WHERE tgname='submissions_autograde_interactive'") == 1 and counts() == after_state)
        cur.execute("DELETE FROM submissions"); cur.execute("DELETE FROM grades")
        again = run_gaps("AFTER ROLLBACK")
        t.chk("ROLLBACK: the old direct path works again", again >= 6, f"served {again}")

        print(f"\nSUMMARY  {t.p} passed, {t.f} failed; BEFORE served {b_served} of {len(GAPS)} gap attempts, AFTER served {a_served}")
        code = 0 if (t.f == 0 and b_served > 0) else 1
    finally:
        if not s.close():
            code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
