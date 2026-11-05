#!/usr/bin/env python3
"""Prove migration 047 (keys out of content, release time in row-level security, interactive work rows) on a
THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 046 in a database of its own, loads
a small invented fixture, then:

  BEFORE   047 is not applied. Every case that expects something to be withheld is expected to FAIL here, which
           shows the tests can fail. Counts are printed.
  APPLY    047, with its counts check inside (it raises on a mismatch).
  AFTER    Every case must pass. State checks on the moved data (an existing key kept, a frozen stamp kept).
  ROLLBACK 047's rollback; the content, the snapshot and the key and question tables must equal what they were.
  AGAIN    047 is applied a second time, then edited through the new trigger, then the rollback must REFUSE because a
           key it made was edited since.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims` holding the claims the platform would put
in a token. What this cannot show: the real REST path (PostgREST, a real token) and the site pages. Those need a real
session after the migration is applied somewhere real.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names and ids
are invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_release_gated_content_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE serves at least one leak and every later step passes.
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

MIGRATION = "047_release_gated_content.sql"
ROLLBACK = "047_release_gated_content_ROLLBACK.sql"
KEYRE = "(expected_response|correct_answer|answer_key|solution)"


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
    name = "scratch_e6_" + os.urandom(4).hex()
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

        def run(label, sql, owner=False, quiet=False):
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
                if not quiet:
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

        # ---- build through 046 -------------------------------------------------------------------------
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023" and f.name[:3] < "047"]
        mig = next(f for f in ins.migration_files(None) if f.name == MIGRATION)
        rb = (ins.MIGRATIONS / "rollback" / ROLLBACK)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")

        # ---- fixture ----------------------------------------------------------------------------------------
        names = ("course_a course_b term co_a co_b sec_a sec_b enr1 enr2 enr3 enr4 stu1 stu2 stu3 stu4 dir_a "
                 "enr_x").split()
        F = {k: uid() for k in names}
        items = ["rel", "fut", "wip", "gr", "open_exp", "hold", "undated", "unpub", "floor_open", "floor_closed", "b_rel"]
        for it in items:
            for p in ("asg", "act", "ao"):
                F[f"{p}_{it}"] = uid()
        F["act_int"] = uid()
        F["sub1"], F["sub2"] = uid(), uid()
        F["sa_w1"], F["sa_i1"], F["sa_w2"] = uid(), uid(), uid()
        F["q_rel_q2"], F["q_rel_q3"] = uid(), uid()
        F["k_rel_q2"], F["k_rel_q3"] = uid(), uid()

        DENVER_TODAY = "date_trunc('day', now() AT TIME ZONE 'America/Denver')"
        due = {
            "rel": "now() + interval '3 days'",
            "fut": "now() + interval '30 days'",
            "wip": "now() + interval '30 days'",
            "gr": "now() + interval '30 days'",
            "open_exp": "now() + interval '30 days'",
            "hold": "now() + interval '3 days'",
            "undated": "NULL",
            "unpub": "now() + interval '3 days'",
            # 23:59 Denver, seven days on: raw subtraction lands later today, the floor is the start of today
            "floor_open": f"(({DENVER_TODAY} + interval '7 days 23 hours 59 minutes') AT TIME ZONE 'America/Denver')",
            "floor_closed": f"(({DENVER_TODAY} + interval '8 days 23 hours 59 minutes') AT TIME ZONE 'America/Denver')",
            "b_rel": "now() + interval '3 days'",
        }
        opens = {"open_exp": "now() - interval '1 day'", "hold": "now() + interval '2 days'"}
        questions = [
            {"id": "q1", "role": "reading_time", "type": "free_response", "points": 0, "text": "Time spent?"},
            {"id": "q2", "role": "reading_reflection", "type": "free_response", "points": 1, "text": "Reflect?",
             "expected_response": "SYN-GUIDE reflection guidance"},
            {"id": "q3", "role": "free_response", "type": "free_response", "points": 1, "text": "Explain it.",
             "expected_response": "SYN-GUIDE concept guidance"},
        ]
        mc = {"id": "q4", "type": "multiple_choice", "points": 1, "text": "Pick.", "options": ["A. x", "B. y"],
              "correct_answer": "SYN-CORRECT B. y", "expected_response": ""}

        cur.execute("SET search_path = app, public, extensions")
        cur.execute("BEGIN")
        for k in ("dir_a", "stu1", "stu2", "stu3", "stu4"):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (F[k],))
        cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F["dir_a"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A'), (%s,'syn-b','Synthetic B')",
                    (F["course_a"], F["course_b"]))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2027-12-01')",
                    (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true),(%s,%s,%s,true)",
                    (F["co_a"], F["course_a"], F["term"], F["co_b"], F["course_b"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}'),(%s,%s,'SB','{M}')",
                    (F["sec_a"], F["co_a"], F["sec_b"], F["co_b"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000911,'Synthetic Cadet One',%s),"
                    "(3000000912,'Synthetic Cadet Two',%s),(3000000913,'Synthetic Cadet Three',%s),(3000000914,'Synthetic Cadet Four',%s)",
                    (F["stu1"], F["stu2"], F["stu3"], F["stu4"]))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000911,%s),(%s,3000000912,%s),(%s,3000000913,%s)",
                    (F["enr1"], F["sec_a"], F["enr2"], F["sec_a"], F["enr3"], F["sec_b"]))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id, status) VALUES (%s,3000000914,%s,'completed')", (F["enr4"], F["sec_a"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')",
                    (F["dir_a"], F["co_a"]))
        for it in items:
            course = F["course_b"] if it == "b_rel" else F["course_a"]
            co = F["co_b"] if it == "b_rel" else F["co_a"]
            qs = list(questions) + ([mc] if it == "rel" else [])
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,%s)",
                        (F[f"asg_{it}"], course, f"syn-{it}", f"Synthetic item {it}"))
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) "
                        "VALUES (%s,%s,'written',%s,'Synthetic written',%s,0)",
                        (F[f"act_{it}"], F[f"asg_{it}"], f"syn-{it}-written", json.dumps({"questions": qs, "reference_pdf": None})))
            cur.execute(f"INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, "
                        f"is_published, due_at, opens_at) VALUES (%s,%s,%s,'points',2,%s,{due[it]},{opens.get(it, 'NULL')})",
                        (F[f"ao_{it}"], F[f"asg_{it}"], co, it != "unpub"))
            cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)",
                        (F[f"ao_{it}"], F[f"act_{it}"]))
        # an interactive activity on the released item
        cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) "
                    "VALUES (%s,%s,'interactive','syn-rel-artifact','Synthetic artifact',%s,1)",
                    (F["act_int"], F["asg_rel"], json.dumps({"artifact_url": "https://example.invalid/a"})))
        cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)", (F["ao_rel"], F["act_int"]))
        # a frozen snapshot that carries a key
        cur.execute("UPDATE assignment_offerings SET content_snapshot = %s, content_snapshot_frozen_at = timestamptz '2026-09-01 12:00:00+00' WHERE id = %s",
                    (json.dumps({"schema": 1, "activities": [{"slug": "x", "content": {"questions": [
                        {"id": "q3", "expected_response": "SYN-GUIDE snapshot copy"}]}}]}), F["ao_rel"]))
        # keys that already exist: q3 holds the same text as the content (kept as is), q2 holds different text (kept, counted)
        for qid, qk, kk, text in (("q2", "q_rel_q2", "k_rel_q2", "SYN-DIFFERENT existing key"),
                                  ("q3", "q_rel_q3", "k_rel_q3", "SYN-GUIDE concept guidance")):
            cur.execute("INSERT INTO questions (id, activity_id, qid, position, prompt_md, format, points) VALUES (%s,%s,%s,1,'p','prose',1)",
                        (F[qk], F["act_rel"], qid))
            cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text) VALUES (%s,%s,1,%s)", (F[kk], F[qk], text))
        # work
        cur.execute("INSERT INTO submissions (id, enrollment_id, assignment_offering_id, status) VALUES (%s,%s,%s,'draft'),(%s,%s,%s,'draft')",
                    (F["sub1"], F["enr1"], F["ao_rel"], F["sub2"], F["enr2"], F["ao_wip"]))
        cur.execute("INSERT INTO submission_activities (id, submission_id, activity_id, content, is_final) VALUES (%s,%s,%s,%s,false)",
                    (F["sa_w1"], F["sub1"], F["act_rel"], json.dumps({"q2": "my reflection", "q3": "my answer"})))
        cur.execute("INSERT INTO submission_activities (id, submission_id, activity_id, content, report_markdown, is_final) VALUES (%s,%s,%s,%s,'SYN report text',true)",
                    (F["sa_i1"], F["sub1"], F["act_int"], json.dumps({"schema": 1, "effort": 4, "honor": {"status": "concern"}})))
        cur.execute("INSERT INTO submission_activities (id, submission_id, activity_id, content, is_final) VALUES (%s,%s,%s,%s,false)",
                    (F["sa_w2"], F["sub2"], F["act_wip"], json.dumps({"q3": "wip"})))
        cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source) VALUES (%s,%s,0,2,'instructor')",
                    (F["ao_gr"], F["enr2"]))
        # cadet one: a finalized grade on a held item (release time in the future) and on a released one
        cur.execute("UPDATE assignment_offerings SET grades_release_at = now() + interval '5 days' WHERE id = %s", (F["ao_rel"],))
        cur.execute("INSERT INTO grades (assignment_offering_id, enrollment_id, points_earned, points_possible, source, is_finalized) "
                    "VALUES (%s,%s,1,2,'instructor',false),(%s,%s,2,2,'instructor',false)", (F["ao_rel"], F["enr1"], F["ao_open_exp"], F["enr1"]))
        cur.execute("UPDATE grades SET is_finalized = true WHERE enrollment_id = %s", (F["enr1"],))
        cur.execute("COMMIT")
        print("fixture  two courses, a director, three cadets, 11 items (past, future, work in progress, grade only, explicit open "
              "times, undated, unpublished, two at the day-floor boundary), one frozen snapshot with a key, two existing keys (all invented)")

        def one(sql, params=()):
            cur.execute(sql, params)
            return cur.fetchone()[0]

        def counts():
            return {
                "activities with key fields": one("SELECT count(*) FROM activities WHERE content::text ~ %s", (KEYRE,)),
                "snapshots with key fields": one("SELECT count(*) FROM assignment_offerings WHERE content_snapshot::text ~ %s", (KEYRE,)),
                "question rows": one("SELECT count(*) FROM questions"),
                "key rows": one("SELECT count(*) FROM question_keys"),
            }

        def snapshot_state():
            """Everything the rollback must restore, as one comparable value."""
            return (
                one("SELECT md5(string_agg(id::text || content::text, '|' ORDER BY id)) FROM activities"),
                one("SELECT md5(string_agg(id::text || coalesce(content_snapshot::text,'~') || coalesce(content_snapshot_frozen_at::text,'~'), '|' ORDER BY id)) FROM assignment_offerings"),
                one("SELECT count(*) FROM questions"),
                one("SELECT md5(string_agg(id::text || coalesce(reference_text,'~') || version || coalesce(superseded_at::text,'~'), '|' ORDER BY id)) FROM question_keys"),
            )

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

        S1, S2, S3, DIR = F["stu1"], F["stu2"], F["stu3"], F["dir_a"]

        def act_count(it):
            return ("SELECT count(*) FROM activities WHERE id = %s", (F[f"act_{it}"],))

        def cases():
            C = []   # (name, leak?, who, flag, sql, params, expect)
            def add(n, leak, who, sql, params=(), expect=0, flag=False):
                C.append((n, leak, who, flag, sql, params, expect))
            # ---- release time ----
            add("E6 cadet cannot read the questions of an item due in 30 days (row)", True, S1, *act_count("fut"), 0)
            add("E6 cadet downloads no question of that item", True, S1,
                "SELECT coalesce(sum(jsonb_array_length(content -> 'questions')), 0) FROM activities WHERE id = %s", (F["act_fut"],), 0)
            add("E6 an item whose explicit open time is in the future stays closed, though its default would be open", True, S1, *act_count("hold"), 0)
            add("E6 an item due in 8 days (23:59) is closed until the start of tomorrow", True, S1, *act_count("floor_closed"), 0)
            add("E6 an item of another course is not readable", True, S1, "SELECT count(*) FROM activities WHERE id = %s", (F["act_b_rel"],), 0)
            add("E6 a cadet not in this class reads nothing of it", True, S3, *act_count("rel"), 0)
            add("E6 cadet two has no work on the future item and reads none of it", True, S2, *act_count("fut"), 0)
            add("control: an item due in 3 days is open", False, S1, *act_count("rel"), 1)
            add("control: an explicit open time in the past opens a far-off item", False, S1, *act_count("open_exp"), 1)
            add("control: an undated item with no open time is open (as on the site)", False, S1, *act_count("undated"), 1)
            add("control: the day floor: due in 7 days at 23:59 is open from the start of today", False, S1, *act_count("floor_open"), 1)
            add("control: an unpublished item is invisible", False, S1, *act_count("unpub"), 0)
            add("control: work in progress is never withdrawn (submission on a far-off item)", False, S2, *act_count("wip"), 1)
            add("control: a grade on a far-off item keeps it visible", False, S2, *act_count("gr"), 1)
            add("control: a flagged session reads nothing", False, S1, *act_count("rel"), 0, True)
            # ---- completed enrolment (a past term stays readable) and held grades ----
            add("control: a cadet whose enrolment is completed still reads a released item", False, F["stu4"], *act_count("rel"), 1)
            add("E6 a cadet whose enrolment is completed still gets no item that has not opened", True, F["stu4"], *act_count("fut"), 0)
            add("E15 a finalized grade held by a future release time is not readable through my_grades", True, S1,
                "SELECT count(*) FROM my_grades WHERE assignment_offering_id = %s", (F["ao_rel"],), 0)
            add("control: a finalized grade with no release time is readable through my_grades", False, S1,
                "SELECT count(*) FROM my_grades WHERE assignment_offering_id = %s", (F["ao_open_exp"],), 1)
            # ---- calendar stays readable ----
            add("control: a future item's due date stays readable", False, S1,
                "SELECT count(*) FROM assignment_offerings WHERE id = %s AND due_at IS NOT NULL", (F["ao_fut"],), 1)
            add("control: a future item's title stays readable", False, S1,
                "SELECT count(*) FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id WHERE ao.id = %s AND a.title IS NOT NULL",
                (F["ao_fut"],), 1)
            add("control: a future item's schedule row stays readable", False, S1,
                "SELECT count(*) FROM offering_activities WHERE assignment_offering_id = %s", (F["ao_fut"],), 1)
            # ---- keys ----
            add("E6 a released item's content carries no answer guidance or key", True, S1,
                "SELECT count(*) FROM activities WHERE id = %s AND content::text ~ %s", (F["act_rel"], KEYRE), 0)
            add("E6 the snapshot of a released item carries no key", True, S1,
                "SELECT count(*) FROM assignment_offerings WHERE id = %s AND content_snapshot::text ~ %s", (F["ao_rel"], KEYRE), 0)
            add("E6 no key field anywhere the cadet can select an activity", True, S2,
                "SELECT count(*) FROM activities WHERE content::text ~ %s", (KEYRE,), 0)
            add("control: the cadet still reads the question text of a released item", False, S1,
                "SELECT jsonb_array_length(content -> 'questions') FROM activities WHERE id = %s", (F["act_rel"],), 4)
            add("control: a cadet reads no answer key row", False, S1, "SELECT count(*) FROM question_keys", (), 0)
            add("control: a cadet reads no question row", False, S1, "SELECT count(*) FROM questions", (), 0)
            add("control: the director still reads a future item's activity", False, DIR, *act_count("fut"), 1)
            add("control: the director reads the keys", False, DIR, "SELECT count(*) > 0 FROM question_keys", (), True)
            # ---- E15: interactive work ----
            add("E15 cadet cannot read the stored assessment of an interactive activity", True, S1,
                "SELECT count(*) FROM submission_activities WHERE activity_id = %s", (F["act_int"],), 0)
            add("E15 no assessment text in any row the cadet can select", True, S1,
                "SELECT count(*) FROM submission_activities WHERE content::text ~ 'honor' OR report_markdown IS NOT NULL", (), 0)
            add("E15 cadet cannot edit the stored assessment in place", True, S1,
                "UPDATE submission_activities SET content = '{}'::jsonb WHERE activity_id = %s", (F["act_int"],), 0)
            add("control: cadet still reads their written answers", False, S1,
                "SELECT count(*) FROM submission_activities WHERE activity_id = %s AND content ? 'q3'", (F["act_rel"],), 1)
            add("control: cadet still saves written answers (upsert)", False, S1,
                "INSERT INTO submission_activities (submission_id, activity_id, content) VALUES (%s,%s,'{\"q3\":\"new\"}') "
                "ON CONFLICT (submission_id, activity_id) DO UPDATE SET content = EXCLUDED.content", (F["sub1"], F["act_rel"]), 1)
            add("control: my_work lists the cadet's two rows", False, S1, "SELECT count(*) FROM my_work", (), 2)
            add("control: my_work has no content column", False, S1, "SELECT content FROM my_work", (), "error")
            add("control: my_work has no report column", False, S1, "SELECT report_markdown FROM my_work", (), "error")
            add("control: cadet two does not see cadet one's work in my_work", False, S2,
                "SELECT count(*) FROM my_work WHERE activity_id = %s", (F["act_int"],), 0)
            add("B1 save_interactive_work refuses a report while a finalized grade of the item stands (held or not)", False, S1,
                "SELECT save_interactive_work(%s, %s, '{\"schema\":1,\"effort\":3}'::jsonb, 'again', 5, true) IS NOT NULL",
                (F["sub1"], F["act_int"]), "error")
            add("control: save_interactive_work refuses another cadet's submission", False, S2,
                "SELECT save_interactive_work(%s, %s, '{}'::jsonb, 'x', 1, true)", (F["sub1"], F["act_int"]), "error")
            add("control: save_interactive_work refuses a written activity", False, S1,
                "SELECT save_interactive_work(%s, %s, '{}'::jsonb, 'x', 1, true)", (F["sub1"], F["act_rel"]), "error")
            add("control: the cadet's own table insert of an interactive row is refused", False, S2,
                "INSERT INTO submission_activities (submission_id, activity_id, content) VALUES (%s,%s,'{}')", (F["sub2"], F["act_int"]), "error")
            add("control: staff still read an interactive assessment", False, DIR,
                "SELECT count(*) FROM submission_activities WHERE content ? 'honor'", (), 1)
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
                    detail = f"saw {val}, expected {expect}" if state == "ok" else f"{state} ({val})"
                if not ok and leak:
                    leaks += 1
                passed += ok
                failed += (not ok)
                print(f"  {'PASS' if ok else 'FAIL'}  {n}: {detail}")
            print(f"  -> {passed} passed, {failed} failed, {leaks} leak case(s) served")
            return passed, failed, leaks

        def show(label, d):
            print(f"  {label}: " + ", ".join(f"{k} {v}" for k, v in d.items()))

        # ---- BEFORE -----------------------------------------------------------------------------------------
        before_counts = counts()
        before_state = snapshot_state()
        print("\nCOUNTS BEFORE")
        show("stored", before_counts)
        b_pass, b_fail, b_leaks = run_battery("BEFORE 047 (leak cases are expected to fail here, which shows the tests can fail)")

        # ---- a repeated question id that carries key text: the move must refuse, and change nothing ---------
        poison_asg, poison_act = uid(), uid()
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight','syn-dup','Synthetic dup')", (poison_asg, F["course_a"]))
        cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,'written','syn-dup-written','d',%s,0)",
                    (poison_act, poison_asg, json.dumps({"questions": [
                        {"id": "d", "type": "free_response", "points": 1, "text": "a", "expected_response": "FIRST"},
                        {"id": "d", "type": "free_response", "points": 1, "text": "b", "expected_response": "SECOND"}]})))
        with_poison = snapshot_state()
        refused_dup = not run(mig.name + " (repeated id)", mig.read_text(encoding="utf-8"), True, quiet=True)
        cur.execute("SET search_path = app, public, extensions")
        dup_left_alone = snapshot_state() == with_poison and one("SELECT count(*) FROM pg_class WHERE relname = 'content_key_archive' AND relnamespace = 'app'::regnamespace") == 0
        cur.execute("DELETE FROM activities WHERE id = %s", (poison_act,))
        cur.execute("DELETE FROM assignments WHERE id = %s", (poison_asg,))
        print("\nREPEATED ID")
        print(f"  {'PASS' if (refused_dup and dup_left_alone) else 'FAIL'}  the move refuses a repeated question id that carries key text, and changes nothing")
        dup_ok = refused_dup and dup_left_alone

        # ---- APPLY ------------------------------------------------------------------------------------------
        del conn.notices[:]
        if not run(mig.name, mig.read_text(encoding="utf-8"), True):
            return 1
        for n in conn.notices:
            if "047 move" in n:
                print("\nmigration said: " + n.strip().replace("NOTICE:  ", ""))
        cur.execute("SET search_path = app, public, extensions")
        after_counts = counts()
        print("\nCOUNTS AFTER")
        show("stored", after_counts)
        a_pass, a_fail, a_leaks = run_battery("AFTER 047 (every case must pass)")

        # ---- state checks -------------------------------------------------------------------------------------
        checks = []

        def chk(label, ok):
            checks.append(ok)
            print(f"  {'PASS' if ok else 'FAIL'}  {label}")

        print("\nSTATE")
        chk("no key field is left in any stored content or snapshot",
            after_counts["activities with key fields"] == 0 and after_counts["snapshots with key fields"] == 0)
        chk("the existing key with the same text is the same row, still current, text unchanged",
            one("SELECT count(*) FROM question_keys WHERE id = %s AND superseded_at IS NULL AND version = 1 AND reference_text = 'SYN-GUIDE concept guidance'",
                (F["k_rel_q3"],)) == 1)
        chk("the existing key with different text is the same row, still current, text unchanged (not overwritten)",
            one("SELECT count(*) FROM question_keys WHERE id = %s AND superseded_at IS NULL AND reference_text = 'SYN-DIFFERENT existing key'",
                (F["k_rel_q2"],)) == 1)
        chk("the differing content value is kept in the archive, exactly",
            one("SELECT original -> 'questions' -> 1 ->> 'expected_response' FROM content_key_archive WHERE source = 'activities' AND row_id = %s",
                (F["act_rel"],)) == "SYN-GUIDE reflection guidance")
        chk("every other written item now has a current key for q2 and q3",
            one("SELECT count(*) FROM question_keys k JOIN questions q ON q.id = k.question_id JOIN activities a ON a.id = q.activity_id "
                "WHERE a.modality = 'written' AND k.superseded_at IS NULL AND q.qid IN ('q2','q3')") == 22)
        chk("the multiple-choice item's correct answer is filed as text on a q4 key",
            one("SELECT count(*) FROM question_keys k JOIN questions q ON q.id = k.question_id "
                "WHERE q.activity_id = %s AND q.qid = 'q4' AND k.reference_text = 'Correct answer: SYN-CORRECT B. y'", (F["act_rel"],)) == 1)
        chk("the frozen stamp of the snapshot is exactly what it was",
            one("SELECT content_snapshot_frozen_at = timestamptz '2026-09-01 12:00:00+00' FROM assignment_offerings WHERE id = %s", (F["ao_rel"],)) is True)
        chk("question text and other content are unchanged (only key fields left)",
            one("SELECT content -> 'questions' -> 2 ->> 'text' = 'Explain it.' AND content ->> 'reference_pdf' IS NULL FROM activities WHERE id = %s", (F["act_rel"],)) is True)
        chk("the web roles have no access to the archive",
            one("SELECT NOT has_table_privilege('authenticated','app.content_key_archive','SELECT') AND NOT has_table_privilege('anon','app.content_key_archive','SELECT')") is True)

        # ---- ROLLBACK restores exactly ----------------------------------------------------------------------
        if not run(rb.name, rb.read_text(encoding="utf-8"), True):
            return 1
        cur.execute("SET search_path = app, public, extensions")
        rb_counts = counts()
        print("\nCOUNTS AFTER ROLLBACK")
        show("stored", rb_counts)
        chk("rollback: content, snapshots, frozen stamps, question rows and key rows equal what they were before 047",
            snapshot_state() == before_state and rb_counts == before_counts)
        chk("rollback: the existing keys are still there, untouched",
            one("SELECT count(*) FROM question_keys WHERE id IN (%s,%s) AND superseded_at IS NULL", (F["k_rel_q2"], F["k_rel_q3"])) == 2)
        chk("rollback: the cadet policies are back (the cadet can read the future item again)",
            attempt(S1, False, *act_count("fut")) == ("ok", 1))

        # ---- AGAIN: apply, edit through the trigger, rollback must refuse ------------------------------------
        if not run(mig.name + " (second time)", mig.read_text(encoding="utf-8"), True):
            return 1
        cur.execute("SET search_path = app, public, extensions")
        again_state = snapshot_state()
        # a director saves the lesson: a blank key leaves the stored one alone; new text becomes a new version
        edit = json.dumps({"questions": [
            {"id": "q3", "type": "free_response", "points": 1, "text": "Explain it.", "expected_response": ""},
            {"id": "q2", "type": "free_response", "points": 1, "text": "Reflect?", "expected_response": "SYN-EDIT new guidance"}]})
        state, val = attempt(DIR, False, "UPDATE activities SET content = %s::jsonb WHERE id = %s", (edit, F["act_fut"]))
        print("\nEDIT TRIGGER")
        chk(f"a director's save is accepted ({state})", state == "ok")
        cur.execute("BEGIN")
        cur.execute("SET LOCAL ROLE authenticated")
        cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims(DIR, False),))
        cur.execute("UPDATE activities SET content = %s::jsonb WHERE id = %s", (edit, F["act_fut"]))
        cur.execute("COMMIT")
        cur.execute("RESET ROLE")
        chk("the saved content holds no key field",
            one("SELECT content::text !~ %s FROM activities WHERE id = %s", (KEYRE, F["act_fut"])) is True)
        chk("a blank key changed nothing (q3 still on version 1, current)",
            one("SELECT count(*) FROM question_keys k JOIN questions q ON q.id = k.question_id WHERE q.activity_id = %s AND q.qid = 'q3' AND k.version = 1 AND k.superseded_at IS NULL",
                (F["act_fut"],)) == 1)
        chk("new text became version 2 and superseded version 1 (q2)",
            one("SELECT count(*) FROM question_keys k JOIN questions q ON q.id = k.question_id WHERE q.activity_id = %s AND q.qid = 'q2' AND ((k.version = 2 AND k.superseded_at IS NULL AND k.reference_text = 'SYN-EDIT new guidance') OR (k.version = 1 AND k.superseded_at IS NOT NULL))",
                (F["act_fut"],)) == 2)
        # a build script (no sign-in) inserts a new activity with guidance
        cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight','syn-new','Synthetic new')", (uid(), F["course_a"]))
        cur.execute("SELECT id FROM assignments WHERE slug = 'syn-new'")
        new_asg = cur.fetchone()[0]
        cur.execute("INSERT INTO activities (assignment_id, modality, slug, title, content) VALUES (%s,'written','syn-new-written','n',%s)",
                    (new_asg, json.dumps({"questions": [{"id": "q9", "type": "free_response", "points": 1, "text": "t", "expected_response": "SYN-NEW key"}]})))
        chk("a new activity written with guidance is filed and stripped in the same statement",
            one("SELECT count(*) FROM activities a JOIN questions q ON q.activity_id = a.id JOIN question_keys k ON k.question_id = q.id "
                "WHERE a.slug = 'syn-new-written' AND k.reference_text = 'SYN-NEW key' AND a.content::text !~ %s", (KEYRE,)) == 1)
        chk("a snapshot written with a key is stripped",
            (cur.execute("UPDATE assignment_offerings SET content_snapshot = %s WHERE id = %s",
                         (json.dumps({"activities": [{"slug": "y", "content": {"questions": [{"id": "q1", "expected_response": "SYN-SNAP"}]}}]}), F["ao_open_exp"])) or True)
            and one("SELECT content_snapshot::text !~ %s FROM assignment_offerings WHERE id = %s", (KEYRE, F["ao_open_exp"])) is True)
        before_refusal = snapshot_state()
        refused = not run(rb.name + " (after edits)", rb.read_text(encoding="utf-8"), True, quiet=True)
        cur.execute("SET search_path = app, public, extensions")
        chk("the rollback refuses after a key it made was edited, and changes nothing", refused and snapshot_state() == before_refusal)

        print("\nSUMMARY")
        print(f"  BEFORE: {b_pass} passed, {b_fail} failed, {b_leaks} leak case(s) served")
        print(f"  AFTER : {a_pass} passed, {a_fail} failed, {a_leaks} leak case(s) served; state checks: {sum(checks)}/{len(checks)}")
        code = 0 if (a_fail == 0 and all(checks) and b_leaks > 0 and dup_ok) else 1
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
