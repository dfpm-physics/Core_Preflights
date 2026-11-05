#!/usr/bin/env python3
"""Prove migration 049 (the grade audit is written by the database) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 048 in a database of its own, loads a
small invented course, then:

  BEFORE   049 is not applied. A staff session can change a grade and leave no audit row, can write an audit row of
           its own naming another person, and can set `graded_by` to another person. All three are SERVED here.
  APPLY    049.
  AFTER    a grade created, rescored, finalized, reopened, edited, flag-overridden and removed each leave one row whose
           actor is the signed-in staff member; a write that changes nothing audited leaves none; a staff session
           cannot write, change or delete an audit row; `graded_by` is pinned to the session; a server-side role
           writes with a null actor; an excuse and a revoke leave a row naming the Director; `credential_events`
           takes no write from the API roles and is readable by the Director of its own offering only.
  ROLLBACK 049's rollback; the three gaps are served again, `credential_events` is gone, the rows already written
           to `grade_events` remain.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims`. What this cannot show: the real REST path
and the two reset edge functions (their source is checked offline by test-audit-wiring.mjs).

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Names are
invented; no id is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_grade_audit_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE serves every gap and every later step passes.
"""
import argparse
import json
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import v2_gate_lib as gl  # noqa: E402
from scratch_lib import Scratch, Tally  # noqa: E402

MIGRATION = "049_grade_audit.sql"
ROLLBACK = "049_grade_audit_ROLLBACK.sql"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_ga", args.expect_ref, before="049", skip=())
    t = Tally()
    code = 1
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("7a3d3b1f-4c8a-4d2b-8f3e-8b7c6d5e4f49"))
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        director = b.staff("director", "Dee Director")
        other = b.staff("other", "Ola Other")
        outsider = b.staff("outsider", "Otto Outsider")          # director of a different offering
        course, term = b.course("aud-101", "Audit course"), b.term()
        co = b.offering(course, term, True)
        course2 = b.course("aud-102", "Other audit course")
        co2 = b.offering(course2, term, True)
        sec = b.section(co, "A1", ["M"])
        b.section(co2, "Z1", ["M"])
        b.assign(director, co, "director")
        b.assign(other, co, "instructor", sec)
        b.assign(outsider, co2, "director")
        enr1, stu1 = b.cadet(3000000931, "Ann Invented", sec)
        enr2, stu2 = b.cadet(3000000932, "Ben Invented", sec)
        hand = [{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}]
        quiz = b.item(course, co, "aud-quiz", "Audit quiz", 10, kind="quiz", paths=hand, due=gl.days(-3), published=False)
        b.publish(quiz)
        AO = quiz["ao"]
        cur.execute("COMMIT")

        def ev(where="TRUE", params=()):
            cur.execute(f"SELECT event, actor, detail FROM grade_events WHERE {where} ORDER BY occurred_at, id", params)  # noqa: S608
            return cur.fetchall()

        def n_events():
            return one("SELECT count(*) FROM grade_events")

        def ex(who, sql, params=(), keep=False, role="authenticated"):
            return s.attempt(who, sql, params, keep=keep, role=role)

        def gid():
            return one("SELECT id FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AO))

        def mk_grade(who=director, graded_by=None):
            return ex(who, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized, graded_by) "
                           "VALUES (%s,%s,5,10,'instructor',false,%s)", (enr1, AO, graded_by), keep=True)

        def acl():
            """Every table right on the two audit tables, for every role that matters (the whole picture, not three of them)."""
            privs = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
            roles = ("anon", "authenticated", "service_role", "prep_app_dml", "prep_app_read")
            return {(r_, p_): one(f"SELECT has_table_privilege('{r_}','app.grade_events','{p_}')") for r_ in roles for p_ in privs}

        # ================================ BEFORE =================================
        print("\n=== BEFORE (049 not applied) ===")
        r = mk_grade(graded_by=other)
        t.chk("BEFORE: a Director's staff session can create a grade", r[0] == "ok", r)
        G = gid()
        r = ex(director, "UPDATE grades SET points_earned = 6, is_finalized = true WHERE id = %s", (G,), keep=True)
        t.chk("BEFORE: the grade changes and finalizes", r[0] == "ok", r)
        t.chk("BEFORE: the gap, no audit row without the client's help", n_events() == 0, n_events())
        r = ex(director, "INSERT INTO grade_events (grade_id, event, actor, detail) VALUES (%s,'finalized',%s,'{}')", (G, other))
        t.chk("BEFORE: the gap, an audit row naming another person as actor is accepted", r[0] == "ok", r)
        t.chk("BEFORE: the gap, graded_by was left as another person",
              one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == other)
        cur.execute("DELETE FROM grades WHERE id = %s", (G,))
        base = acl()

        if not s.apply_file(MIGRATION):
            return 1
        print(f"\napplied  {MIGRATION}")

        # ================================ AFTER ==================================
        print("\n=== AFTER ===")
        r = mk_grade(graded_by=other)
        t.chk("AFTER: a staff session can still create a grade", r[0] == "ok", r)
        G = gid()
        t.chk("AFTER: a graded_by naming another person is pinned to the signed-in staff member",
              one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == director)
        e = ev()
        t.chk("AFTER: creating the grade left one 'created' row naming the Director", len(e) == 1 and e[0][0] == "created" and e[0][1] == director, e)
        t.chk("AFTER: its detail holds the points and the item", e and e[0][2].get("points_possible") is not None and e[0][2].get("offering") == AO, e)

        ex(other, "UPDATE grades SET points_earned = 7 WHERE id = %s", (G,), keep=True)
        e = ev("event = 'rescored'")
        t.chk("AFTER: a rescore by another staff member leaves a 'rescored' row naming that staff member, with before and after",
              len(e) == 1 and e[0][1] == other and float(e[0][2]["points_before"]) == 5 and float(e[0][2]["points_after"]) == 7, e)
        ex(director, "UPDATE grades SET is_finalized = true WHERE id = %s", (G,), keep=True)
        t.chk("AFTER: finalizing leaves a 'finalized' row", len(ev("event = 'finalized'")) == 1)
        ex(director, "UPDATE grades SET is_finalized = false WHERE id = %s", (G,), keep=True)
        t.chk("AFTER: reopening leaves a 'reopened' row", len(ev("event = 'reopened'")) == 1)
        ex(director, "UPDATE grades SET question_scores = '{\"q1\":{\"score\":1}}'::jsonb WHERE id = %s", (G,), keep=True)
        t.chk("AFTER: a change to the per-question detail leaves an 'edited' row", len(ev("event = 'edited'")) == 1)
        before = n_events()
        ex(director, "UPDATE grades SET points_earned = points_earned, is_finalized = is_finalized WHERE id = %s", (G,), keep=True)
        ex(director, "UPDATE grades SET diagnostic = '{\"q2_effort\":3}'::jsonb WHERE id = %s", (G,), keep=True)
        t.chk("AFTER: a write that changes nothing audited, and a diagnostic-only write, leave no row", n_events() == before, (before, n_events()))
        ex(director, "UPDATE grades SET diagnostic = '{\"flag_overrides\":{\"x\":{\"cleared\":true}}}'::jsonb WHERE id = %s", (G,), keep=True)
        e = ev("event = 'flag_override_changed'")
        t.chk("AFTER: clearing a flag override leaves a 'flag_override_changed' row naming the reviewer",
              len(e) == 1 and e[0][1] == director and e[0][2].get("flag_overrides_after") is not None, e)

        r = ex(director, "UPDATE grades SET graded_by = %s WHERE id = %s", (other, G), keep=True)
        t.chk("AFTER: naming another person as grader in an update is pinned to the signed-in staff member",
              r[0] == "ok" and one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == director)

        # nobody writes the audit table through the API
        n0 = n_events()
        r = ex(director, "INSERT INTO grade_events (grade_id, event, actor, detail) VALUES (%s,'finalized',%s,'{}')", (G, other))
        t.chk("AFTER: a staff session cannot write an audit row, of any actor", r[0] == "error", r)
        r = ex(director, "UPDATE grade_events SET actor = NULL")
        t.chk("AFTER: a staff session cannot change audit rows", r[0] == "error" or r[1] == 0, r)
        r = ex(director, "DELETE FROM grade_events")
        t.chk("AFTER: a staff session cannot delete audit rows", r[0] == "error" or r[1] == 0, r)
        r = ex(stu1, "SELECT count(*) FROM grade_events")
        t.chk("AFTER: a cadet's session reads no audit rows", r[0] == "ok" and r[1] == 0, r)
        t.chk("AFTER: the table is as it was", n_events() == n0)
        r = ex(director, "SELECT count(*) FROM grade_events")
        t.chk("AFTER: staff still read the audit rows of their own offering", r[0] == "ok" and r[1] == 6, r)

        # server-side writer
        r = s.attempt(None, "UPDATE grades SET points_earned = 8, graded_by = %s WHERE id = %s", (other, G), role="prep_app_dml", keep=True)
        e = ev("event = 'rescored'")
        t.chk("AFTER: a server-side write is logged with no actor and keeps the graded_by it was given",
              r[0] == "ok" and e[-1][1] is None and one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == other, (r, e[-1:]))

        # the other audited columns (a change to any of them is a change to what the grade means)
        n0 = n_events()
        # the over-maximum flag is derived by a guard trigger; switch the guard off for the test so a direct change reaches the column
        cur.execute("ALTER TABLE grades DISABLE TRIGGER grades_over_max_guard")
        cur.execute("UPDATE grades SET over_max_allowed = true WHERE id = %s", (G,))
        cur.execute("ALTER TABLE grades ENABLE TRIGGER grades_over_max_guard")
        e = ev("event = 'edited'")
        t.chk("AFTER: a change to the over-maximum flag leaves a row with the flag before and after",
              n_events() == n0 + 1 and e[-1][2].get("over_max_before") is False and e[-1][2].get("over_max_after") is True, (n0, n_events(), e[-1:]))
        cur.execute("ALTER TABLE grades DISABLE TRIGGER grades_over_max_guard")
        cur.execute("UPDATE grades SET over_max_allowed = false WHERE id = %s", (G,))
        cur.execute("ALTER TABLE grades ENABLE TRIGGER grades_over_max_guard")
        n0 = n_events()
        ex(director, "UPDATE grades SET graded_at = now() + interval '1 day' WHERE id = %s", (G,), keep=True)
        t.chk("AFTER: changing the graded time leaves a row", n_events() == n0 + 1, (n0, n_events()))
        ex(director, "UPDATE grades SET enrollment_id = %s WHERE id = %s", (enr2, G), keep=True)
        e = ev("event = 'moved'")
        t.chk("AFTER: moving the grade to another enrolment leaves a 'moved' row naming both",
              len(e) == 1 and e[0][2].get("enrollment_before") == enr1 and e[0][2].get("enrollment_after") == enr2, e)
        ex(director, "UPDATE grades SET enrollment_id = %s WHERE id = %s", (enr1, G), keep=True)

        # the grader of an untouched draft survives a finalize that re-sends it (the page's upsert), on the real path
        up = ("INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized, graded_by) "
              "VALUES (%s,%s,5,10,'instructor',%s,%s) ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE SET "
              "points_earned=EXCLUDED.points_earned, points_possible=EXCLUDED.points_possible, source=EXCLUDED.source, "
              "is_finalized=EXCLUDED.is_finalized, graded_by=EXCLUDED.graded_by")
        ex(other, "UPDATE grades SET is_finalized = false, graded_by = %s WHERE id = %s", (other, G), keep=True)
        t.chk("AFTER: a colleague's draft is graded by that colleague", one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == other)
        r = ex(director, up, (enr1, AO, True, other), keep=True)
        t.chk("AFTER: finalizing a colleague's untouched draft through the upsert keeps the colleague as the grader",
              r[0] == "ok" and one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == other, r)
        e = ev("event = 'finalized'")
        t.chk("AFTER: and the audit row names the Director who finalized", e and e[-1][1] == director, e[-1:])
        ex(director, "UPDATE grades SET is_finalized = false WHERE id = %s", (G,), keep=True)
        ex(director, up, (enr1, AO, False, other), keep=True)
        t.chk("AFTER: an upsert naming someone else on an existing row never makes that person the grader",
              one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == other)
        ex(director, up, (enr1, AO, False, director), keep=True)
        t.chk("AFTER: an upsert naming the signed-in staff member makes them the grader",
              one("SELECT graded_by FROM grades WHERE id = %s", (G,)) == director)
        ex(director, "UPDATE grades SET graded_by = %s WHERE id = %s", (other, G), keep=True)
        r = ex(director, up, (enr2, AO, False, other), keep=True)
        t.chk("AFTER: an upsert that creates a row and names someone else pins the grader to the session",
              r[0] == "ok" and one("SELECT graded_by FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr2, AO)) == director, r)
        cur.execute("DELETE FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr2, AO))

        # no role can rewrite the log: the service role and the data role as well, and truncate
        base_n = n_events()
        for who in ("service_role", "prep_app_dml"):
            r = s.attempt(None, "UPDATE grade_events SET actor = NULL, detail = '{}'", role=who)
            t.chk(f"AFTER: {who} cannot change audit rows", r[0] == "error", r)
            r = s.attempt(None, "DELETE FROM grade_events", role=who)
            t.chk(f"AFTER: {who} cannot delete audit rows", r[0] == "error", r)
            r = s.attempt(None, "TRUNCATE grade_events", role=who)
            t.chk(f"AFTER: {who} cannot truncate the audit table", r[0] == "error", r)
        for who in ("authenticated", "anon"):
            r = s.attempt(director if who == "authenticated" else None, "TRUNCATE grade_events", role=who)
            t.chk(f"AFTER: {who} cannot truncate the audit table", r[0] == "error", r)
        r = s.attempt(None, "TRUNCATE grade_events", role="prep_app_owner")
        t.chk("AFTER: the trigger refuses even the table owner's TRUNCATE (the owner can still disable the trigger)", r[0] == "error", r)
        r = s.attempt(None, "TRUNCATE credential_events", role="service_role")
        t.chk("AFTER: the reset log cannot be truncated by the server-side role", r[0] == "error", r)
        t.chk("AFTER: nothing was lost", n_events() == base_n, (base_n, n_events()))

        # deleting a staff member does not rewrite the log
        gone = b.staff("gone", "Gus Gone")
        cur.execute("INSERT INTO grade_events (grade_id, event, actor, detail) VALUES (NULL, 'edited', %s, '{}')", (gone,))
        try:
            cur.execute("DELETE FROM staff_assignments WHERE instructor_id = %s", (gone,))
            cur.execute("DELETE FROM instructors WHERE id = %s", (gone,))
            ok = True
        except Exception as exc:  # noqa: BLE001
            ok = False
            print("   ", exc)
        t.chk("AFTER: a staff member can be deleted and the audit rows that name them are left as written",
              ok and one("SELECT count(*) FROM grade_events WHERE actor = %s", (gone,)) == 1)

        # removal: the history stays, the row can say whose grade it was, and staff of the offering read it
        before_rm = len(ev("grade_id = %s", (G,)))
        r = s.attempt(None, "DELETE FROM grades WHERE id = %s", (G,), role="prep_app_dml", keep=True)
        e = ev("event = 'removed' AND grade_id = %s", (G,))
        t.chk("AFTER: removing a grade leaves a 'removed' row that keeps the grade, the cadet's enrolment and the old values",
              r[0] == "ok" and len(e) == 1 and e[0][2].get("grade") == G and e[0][2].get("enrollment") == enr1
              and e[0][2].get("points_possible") is not None, (r, e))
        t.chk("AFTER: the earlier history of the removed grade is still there",
              len(ev("grade_id = %s", (G,))) == before_rm + 1 and len(ev("grade_id = %s AND event = 'created'", (G,))) == 1,
              (before_rm, len(ev("grade_id = %s", (G,)))))
        r = ex(director, "SELECT count(*) FROM grade_events WHERE event = 'removed' AND grade_id = %s", (G,))
        t.chk("AFTER: the Director of the offering reads the removed row", r[0] == "ok" and r[1] == 1, r)
        r = ex(other, "SELECT count(*) FROM grade_events WHERE event = 'removed' AND grade_id = %s", (G,))
        t.chk("AFTER: so does an instructor of that section", r[0] == "ok" and r[1] == 1, r)
        r = ex(outsider, "SELECT count(*) FROM grade_events WHERE grade_id = %s", (G,))
        t.chk("AFTER: staff of another offering read none of it", r[0] == "ok" and r[1] == 0, r)
        r = ex(stu1, "SELECT count(*) FROM grade_events")
        t.chk("AFTER: a cadet still reads none", r[0] == "ok" and r[1] == 0, r)
        t.chk("AFTER: the row carries the course offering", one("SELECT count(*) FROM grade_events WHERE event = 'removed' AND grade_id = %s AND course_offering_id = %s", (G, co)) == 1)

        # excused: 033 already logs it, from the session
        r = ex(director, "INSERT INTO grade_excusals (enrollment_id, assignment_offering_id, reason, set_by) VALUES (%s,%s,'Made-up reason.',%s)",
               (enr2, AO, other), keep=True)
        x = one("SELECT count(*) FROM grade_excusal_events WHERE action = 'excused' AND actor = %s", (director,))
        t.chk("AFTER: an excuse leaves a row naming the signed-in Director, whatever set_by was sent", r[0] == "ok" and x == 1, (r, x))
        r = ex(director, "UPDATE grade_excusals SET revoked_at = now(), revoked_by = %s, revoked_reason = 'Made-up.' WHERE enrollment_id = %s", (other, enr2), keep=True)
        x = one("SELECT count(*) FROM grade_excusal_events WHERE action = 'revoked' AND actor = %s", (director,))
        t.chk("AFTER: a revoke leaves a row naming the signed-in Director", r[0] == "ok" and x == 1, (r, x))
        r = ex(other, "INSERT INTO grade_excusals (enrollment_id, assignment_offering_id, reason, set_by) VALUES (%s,%s,'Made-up reason.',%s)", (enr1, AO, other))
        t.chk("AFTER: an instructor who is not a Director cannot excuse", r[0] == "error" or r[1] == 0, r)

        # credential_events
        t.chk("AFTER: credential_events exists", one("SELECT to_regclass('app.credential_events') IS NOT NULL"))
        row = "INSERT INTO credential_events (event, actor, course_offering_id, target_student) VALUES ('student_reset_requested', %s, %s, 3000000931)"
        r = ex(director, row, (director, co))
        t.chk("AFTER: a staff session cannot write a reset record", r[0] == "error", r)
        r = ex(stu1, row, (stu1, co))
        t.chk("AFTER: a cadet's session cannot write a reset record", r[0] == "error", r)
        r = s.attempt(None, row, (director, co), role="service_role", keep=True)
        t.chk("AFTER: the server-side role writes a reset record", r[0] == "ok", r)
        s.attempt(None, "INSERT INTO credential_events (event, actor, course_offering_id, target_staff) VALUES ('staff_reset_done', %s, %s, %s)",
                  (director, co, other), role="service_role", keep=True)
        r = ex(director, "SELECT count(*) FROM credential_events")
        t.chk("AFTER: the Director reads their own offering's reset records", r[0] == "ok" and r[1] == 2, r)
        r = ex(outsider, "SELECT count(*) FROM credential_events")
        t.chk("AFTER: a Director of another offering reads none", r[0] == "ok" and r[1] == 0, r)
        r = ex(other, "SELECT count(*) FROM credential_events")
        t.chk("AFTER: an instructor who is not a Director reads none", r[0] == "ok" and r[1] == 0, r)
        r = ex(stu1, "SELECT count(*) FROM credential_events")
        t.chk("AFTER: a cadet reads none", r[0] == "ok" and r[1] == 0, r)
        r = s.attempt(None, "UPDATE credential_events SET actor = NULL", role="service_role")
        t.chk("AFTER: even the server-side role cannot change a reset record", r[0] == "error", r)
        r = s.attempt(None, "DELETE FROM credential_events", role="service_role")
        t.chk("AFTER: nor delete one", r[0] == "error", r)
        r = s.attempt(None, "SELECT count(*) FROM credential_events", role="anon")
        t.chk("AFTER: the unauthenticated role reads none", r[0] == "error" or r[1] == 0, r)
        t.chk("AFTER: the trigger functions are not callable by the API roles",
              not any(one(f"SELECT has_function_privilege('{r_}', 'app.{f}()', 'EXECUTE')") for r_ in ("authenticated", "anon")
                      for f in ("grades_audit", "grades_pin_grader", "audit_actor", "audit_log_append_only")))

        n_after = n_events()

        # ================================ ROLLBACK ===============================
        if not s.apply_file(ROLLBACK, rollback=True):
            return 1
        print(f"\nrolled back {MIGRATION}")
        print("\n=== AFTER ROLLBACK ===")
        t.chk("ROLLBACK: the audit rows already written remain", n_events() == n_after, (n_events(), n_after))
        t.chk("ROLLBACK: credential_events is gone", one("SELECT to_regclass('app.credential_events') IS NULL"))
        t.chk("ROLLBACK: no trigger or function is left behind",
              one("SELECT count(*) FROM pg_trigger WHERE tgname IN ('grades_audit','grades_pin_grader','credential_events_append_only','credential_events_no_truncate','grade_events_append_only','grade_events_no_truncate')") == 0
              and one("SELECT count(*) FROM pg_proc WHERE proname IN ('grades_audit','grades_pin_grader','audit_actor','credential_events_append_only','audit_log_append_only','grade_events_put')") == 0)
        now = acl()
        t.chk("ROLLBACK: every right on grade_events, for every role, is exactly as it was before 049",
              now == base, {k: (base[k], now[k]) for k in base if base[k] != now[k]})
        t.chk("ROLLBACK: neither the signed-in nor the unauthenticated role holds TRUNCATE or any right it did not hold",
              not any(now[(r_, p_)] and not base[(r_, p_)] for r_ in ("anon", "authenticated") for p_ in
                      ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")))
        r = ex(stu1, "TRUNCATE grade_events")
        t.chk("ROLLBACK: a cadet's session cannot truncate the audit table", r[0] == "error", r)
        r = ex(director, "TRUNCATE grade_events")
        t.chk("ROLLBACK: nor a staff session", r[0] == "error", r)
        t.chk("ROLLBACK: the old read policy is back",
              one("SELECT count(*) FROM pg_policies WHERE tablename = 'grade_events' AND policyname IN ('ge_staff_read','ge_staff_insert')") == 2)
        n1 = n_events()
        mk_grade(graded_by=other)
        G2 = gid()
        t.chk("ROLLBACK: the gaps are back: the grade is created with no audit row and graded_by as sent",
              n_events() == n1 and one("SELECT graded_by FROM grades WHERE id = %s", (G2,)) == other)
        r = ex(director, "INSERT INTO grade_events (grade_id, event, actor, detail) VALUES (%s,'finalized',%s,'{}')", (G2, other))
        t.chk("ROLLBACK: and a staff session can write an audit row again", r[0] == "ok", r)

        print(f"\nSUMMARY  {t.p} passed, {t.f} failed")
        code = 0 if t.f == 0 else 1
    finally:
        if not s.close():
            code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
