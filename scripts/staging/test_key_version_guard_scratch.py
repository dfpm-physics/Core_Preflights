#!/usr/bin/env python3
"""Prove migration 059 (a replaced answer key version is kept as it was) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 058 in a database of its own, loads
a small invented fixture, then:

  BEFORE   059 is not applied. Every attempt to change or delete a replaced key version through the API must
           SUCCEED here (that is the gap), which shows the tests can fail. Counts are printed.
  APPLY    059.
  AFTER    The same attempts must be refused. Everything the pages and functions legitimately do must still work:
           save_question (key change and no key change), the key filing of 047 (a lesson saved with new guidance),
           a plain insert of a new version, marking the current key checked, and a cascade (deleting a question or
           an activity takes its replaced versions with it). The server-side roles still pass.
  ROLLBACK 059's rollback; the same attempts succeed again and the key table equals what it was.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims`. What this cannot show: the real REST path
and the site pages.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names and ids are
invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_key_version_guard_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE leaks at least once and every later step passes.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scratch_lib import Scratch, Tally, uid  # noqa: E402

MIGRATION = "059_key_version_guard.sql"
ROLLBACK = "059_key_version_guard_ROLLBACK.sql"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_kg", args.expect_ref, before="059")
    code = 1
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        F = {k: uid() for k in ("course", "term", "co", "sec", "dir", "stu", "enr", "asg", "act", "ao",
                                "q1", "q2", "k1v1", "k1v2", "k2v1", "asg2", "act2", "q3", "k3v1", "k3v2", "q4", "k4v1")}
        cur.execute("BEGIN")
        for k in ("dir", "stu"):
            cur.execute("INSERT INTO auth.users (id) VALUES (%s)", (F[k],))
        cur.execute("INSERT INTO instructors (id, name) VALUES (%s, 'Synthetic Staff')", (F["dir"],))
        cur.execute("INSERT INTO courses (id, code, title) VALUES (%s,'syn-a','Synthetic A')", (F["course"],))
        cur.execute("INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s,'syn-t','Synthetic','2026-08-01','2027-12-01')", (F["term"],))
        cur.execute("INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s,%s,%s,true)", (F["co"], F["course"], F["term"]))
        cur.execute("INSERT INTO sections (id, course_offering_id, code, meeting_days) VALUES (%s,%s,'SA','{M}')", (F["sec"], F["co"]))
        cur.execute("INSERT INTO students (student_id, name, auth_user_id) VALUES (3000000921,'Synthetic Cadet',%s)", (F["stu"],))
        cur.execute("INSERT INTO enrollments (id, student_id, section_id) VALUES (%s,3000000921,%s)", (F["enr"], F["sec"]))
        cur.execute("INSERT INTO staff_assignments (instructor_id, course_offering_id, section_id, role) VALUES (%s,%s,NULL,'director')", (F["dir"], F["co"]))
        for a, act in (("asg", "act"), ("asg2", "act2")):
            cur.execute("INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s,%s,'preflight',%s,'Synthetic')", (F[a], F["course"], "syn-" + a))
            cur.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s,%s,'written',%s,'w',%s,0)",
                        (F[act], F[a], "syn-" + act, json.dumps({"questions": [{"id": "q1", "type": "free_response", "points": 1, "text": "Explain."}]})))
        cur.execute("INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, grading_mode, points_possible, is_published) VALUES (%s,%s,%s,'points',2,true)",
                    (F["ao"], F["asg"], F["co"]))
        cur.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id) VALUES (%s,%s)", (F["ao"], F["act"]))
        for q, act in (("q1", "act"), ("q2", "act"), ("q3", "act2"), ("q4", "act")):
            cur.execute("INSERT INTO questions (id, activity_id, qid, position, prompt_md, format, points) VALUES (%s,%s,%s,1,'p','prose',1)",
                        (F[q], F[act], {"q1": "q1", "q2": "q2", "q3": "q1", "q4": "q4"}[q]))
        # q1: version 1 replaced, version 2 current.  q2: version 1 current only.  q3 (other activity): v1 replaced, v2 current
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text, superseded_at) VALUES (%s,%s,1,'SYN old guidance', now() - interval '2 days')", (F["k1v1"], F["q1"]))
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text) VALUES (%s,%s,2,'SYN current guidance')", (F["k1v2"], F["q1"]))
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text) VALUES (%s,%s,1,'SYN second question')", (F["k2v1"], F["q2"]))
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text, superseded_at) VALUES (%s,%s,1,'SYN old other', now() - interval '2 days')", (F["k3v1"], F["q3"]))
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text) VALUES (%s,%s,2,'SYN current other')", (F["k3v2"], F["q3"]))
        # q4: only a replaced version, no current key (so clearing superseded_at is not stopped by the one-current-key index)
        cur.execute("INSERT INTO question_keys (id, question_id, version, reference_text, superseded_at) VALUES (%s,%s,1,'SYN old only', now() - interval '2 days')", (F["k4v1"], F["q4"]))
        cur.execute("COMMIT")
        print("fixture  one course, one director, one cadet, two activities, four questions, six key rows "
              "(three replaced versions, three current) - all invented")

        DIR, STU = F["dir"], F["stu"]

        def counts():
            return {"key rows": one("SELECT count(*) FROM question_keys"),
                    "replaced versions": one("SELECT count(*) FROM question_keys WHERE superseded_at IS NOT NULL"),
                    "current keys": one("SELECT count(*) FROM question_keys WHERE superseded_at IS NULL")}

        def state():
            return one("SELECT md5(string_agg(id::text || version || coalesce(reference_text,'~') || coalesce(superseded_at::text,'~') || coalesce(checked_at::text,'~'), '|' ORDER BY id)) FROM question_keys")

        def ex(sql, params=(), who=DIR, **kw):
            return s.attempt(who, sql, params, **kw)

        # (name, is_gap, callable returning True when the request was ACCEPTED)
        def accepted(res):
            return res[0] == "ok" and bool(res[1])

        def cascade_question():
            """Delete a question as the director; its replaced version must go with it. Rolled back."""
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(DIR),))
                cur.execute("DELETE FROM questions WHERE id = %s", (F["q3"],))
                cur.execute("RESET ROLE")
                left = one("SELECT count(*) FROM question_keys WHERE question_id = %s", (F["q3"],))
                res = ("ok", left == 0)
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, str(exc).splitlines()[0])
            cur.execute("ROLLBACK")
            cur.execute("RESET ROLE")
            return res

        def cascade_activity():
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(DIR),))
                cur.execute("DELETE FROM activities WHERE id = %s", (F["act2"],))
                cur.execute("RESET ROLE")
                left = one("SELECT count(*) FROM question_keys WHERE question_id = %s", (F["q3"],))
                res = ("ok", left == 0)
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, str(exc).splitlines()[0])
            cur.execute("ROLLBACK")
            cur.execute("RESET ROLE")
            return res

        def save_question(write_key, text):
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(DIR),))
                cur.execute("SELECT updated_at FROM questions WHERE id = %s", (F["q1"],))
                ts = cur.fetchone()[0]
                cur.execute("SELECT * FROM save_question(%s, %s, %s::jsonb, %s, %s::jsonb, %s)",
                            (F["q1"], ts, json.dumps({"prompt_md": "p2", "points": 1, "choices": None, "unit_hint": None}),
                             write_key, json.dumps({"reference_text": text}), 2))
                row = cur.fetchone()
                cur.execute("RESET ROLE")
                v3 = one("SELECT count(*) FROM question_keys WHERE question_id = %s AND version = 3 AND superseded_at IS NULL AND reference_text = %s", (F["q1"], text))
                old = one("SELECT count(*) FROM question_keys WHERE question_id = %s AND version = 2 AND superseded_at IS NOT NULL", (F["q1"],))
                res = ("ok", (row[1] is True and v3 == 1 and old == 1) if write_key else (row[1] is False and v3 == 0))
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, str(exc).splitlines()[0])
            cur.execute("ROLLBACK")
            cur.execute("RESET ROLE")
            return res

        def lesson_edit():
            """The 047 filing path: a lesson saved with new guidance supersedes the current key and files a new one."""
            cur.execute("BEGIN")
            try:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (s.claims(DIR),))
                cur.execute("UPDATE activities SET content = %s::jsonb WHERE id = %s",
                            (json.dumps({"questions": [{"id": "q1", "type": "free_response", "points": 1, "text": "Explain.",
                                                         "expected_response": "SYN edited guidance"}]}), F["act"]))
                cur.execute("RESET ROLE")
                ok = one("SELECT count(*) FROM question_keys WHERE question_id = %s AND version = 3 AND superseded_at IS NULL AND reference_text = 'SYN edited guidance'", (F["q1"],)) == 1
                old = one("SELECT count(*) FROM question_keys WHERE question_id = %s AND version = 2 AND superseded_at IS NOT NULL", (F["q1"],))
                res = ("ok", ok and old == 1)
            except s.psycopg2.Error as exc:
                res = ("error", exc.pgcode, str(exc).splitlines()[0])
            cur.execute("ROLLBACK")
            cur.execute("RESET ROLE")
            return res

        GAP = [  # attempts that must be REFUSED after 059 and are served before it
            ("edit the text of a replaced version", lambda: ex("UPDATE question_keys SET reference_text = 'tampered' WHERE id = %s", (F["k1v1"],))),
            ("clear superseded_at on a replaced version (bring it back as current)", lambda: ex("UPDATE question_keys SET superseded_at = NULL WHERE id = %s", (F["k4v1"],))),
            ("mark a replaced version checked (any column)", lambda: ex("UPDATE question_keys SET checked_at = now() WHERE id = %s", (F["k1v1"],))),
            ("delete a replaced version", lambda: ex("DELETE FROM question_keys WHERE id = %s", (F["k1v1"],))),
            ("delete every replaced version in one request", lambda: ex("DELETE FROM question_keys WHERE superseded_at IS NOT NULL")),
        ]
        CONTROL = [  # must be accepted both before and after
            ("a plain insert of a new version", lambda: ex("INSERT INTO question_keys (question_id, variant_key, version, reference_text) VALUES (%s,'alt',3,'SYN v3')", (F["q2"],))),
            ("mark the CURRENT key checked", lambda: ex("UPDATE question_keys SET checked_at = now(), checked_by = %s WHERE id = %s", (DIR, F["k2v1"]))),
            ("replace the current key (set superseded_at on it)", lambda: ex("UPDATE question_keys SET superseded_at = now() WHERE id = %s", (F["k2v1"],))),
            ("save_question with a key change: v2 replaced, v3 current", lambda: save_question(True, "SYN saved guidance")),
            ("save_question with no key change", lambda: save_question(False, "unused")),
            ("a lesson saved with new guidance (047 filing path)", lambda: lesson_edit()),
            ("cascade: deleting a question takes its replaced version", lambda: cascade_question()),
            ("cascade: deleting an activity takes its questions' replaced versions", lambda: cascade_activity()),
            ("server-side role (prep_app_dml) can still edit a replaced version", lambda: s.attempt(None, "UPDATE question_keys SET reference_text = 'maintenance' WHERE id = %s", (F["k1v1"],), role="prep_app_dml")),
        ]

        def run_all(label):
            print(f"\n{label}   {counts()}")
            gap_served = 0
            fails = 0
            for name, fn in GAP:
                r = fn()
                served = accepted(r)
                gap_served += served
                print(f"  {'SERVED ' if served else 'refused'}  {name}" + ("" if served else f"  ({r[1] if r[0]=='error' else r[0]})"))
            for name, fn in CONTROL:
                r = fn()
                ok = (r[0] == "ok" and bool(r[1]))
                fails += (not ok)
                print(f"  {'PASS   ' if ok else 'FAIL   '}  control: {name}" + ("" if ok else f"  ({r})"))
            # the cadet's session reaches none of it
            r = ex("UPDATE question_keys SET reference_text = 'x'", who=STU)
            ok = r[0] == "ok" and r[1] == 0 or r[0] == "error"
            fails += (not ok)
            print(f"  {'PASS   ' if ok else 'FAIL   '}  control: a cadet's session changes no key row ({r[0]}, {r[1]})")
            return gap_served, fails

        t = Tally()
        s0 = state()
        b_gap, b_fail = run_all("BEFORE (059 not applied)")
        t.chk("BEFORE: every control works and the gap is served (the tests can fail)", b_fail == 0 and b_gap == len(GAP), f"served {b_gap} of {len(GAP)}, control failures {b_fail}")
        t.chk("BEFORE: the attempts rolled back and left the table as it was", state() == s0)

        if not s.apply_file(MIGRATION):
            return 1
        print(f"\napplied  {MIGRATION}")
        a_gap, a_fail = run_all("AFTER (059 applied)")
        t.chk("AFTER: no attempt on a replaced version is served", a_gap == 0, f"served {a_gap}")
        t.chk("AFTER: every control still works", a_fail == 0, f"failures {a_fail}")
        t.chk("AFTER: nothing changed in the key table", state() == s0)
        t.chk("AFTER: the refusal is the documented one (insufficient_privilege)",
              ex("DELETE FROM question_keys WHERE id = %s", (F["k1v1"],))[:2] == ("error", "42501"))
        t.chk("AFTER: a replaced version cannot be touched by the unauthenticated role either",
              s.attempt(None, "DELETE FROM question_keys WHERE id = %s", (F["k1v1"],), role="anon")[0] == "error")
        # the function is not callable over the API
        t.chk("AFTER: the guard function has no EXECUTE for the API roles",
              not one("SELECT has_function_privilege('authenticated', 'app.question_keys_old_version_guard()', 'EXECUTE')"))

        if not s.apply_file(ROLLBACK, rollback=True):
            return 1
        print(f"\nrolled back {MIGRATION}")
        r_gap, r_fail = run_all("AFTER ROLLBACK")
        t.chk("ROLLBACK: the gap is back (rollback really removed the guard) and controls work", r_gap == len(GAP) and r_fail == 0)
        t.chk("ROLLBACK: the key table equals what it was", state() == s0)
        t.chk("ROLLBACK: no trigger or function is left behind",
              one("SELECT count(*) FROM pg_trigger WHERE tgname = 'question_keys_old_version_guard'") == 0
              and one("SELECT count(*) FROM pg_proc WHERE proname = 'question_keys_old_version_guard'") == 0)

        print(f"\nSUMMARY  {t.p} passed, {t.f} failed; BEFORE served {b_gap} of {len(GAP)} gap attempts, AFTER served {a_gap}")
        code = 0 if (t.f == 0 and b_gap > 0) else 1
    finally:
        if not s.close():
            code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
