#!/usr/bin/env python3
"""Prove the Stage E answer functions (migrations app/070 and app/071) on a THROWAWAY database on the staging server.

It builds schema `app` from the repo's files into a database of its own (as scratch_migration_proof.py does), loads an
invented fixture, runs the checks below as the roles the real system uses, and drops the database whatever happened.
Nothing in the staging database itself is read or written.

CHECKS (each prints [pass] or [FAIL])
  grants      only service_role can run answer_context and record_answer; a signed-in student, anon and the data role cannot
  the key     a student session reads zero rows of question_keys; no client role can write question_attempts
  gate        not enrolled, dropped, wrong item for the question, unpublished, not yet released, retired, no key,
              AI-written unchecked key, deadline passed, late allowed, late after the term ended, extension
  limit       exactly the limit is stored; the next is refused; two tabs at once cannot take the last attempt
  grade       best / last / first attempt rules; the grade is source auto_checked and finalized; a person's correction wins
  input       a hand-made argument (array for the answer, text for the number, null verdict) is refused
  rollback    071 then 070 roll back and re-apply cleanly
With --load N it also runs the end-of-deadline load test (N students, answers around the cutoff).

WHAT THIS CANNOT PROVE
  The edge function, the JWT check, the browser, and Supabase's real Auth. Those need staging (see the test list in
  docs/decisions/V2-STAGE-E-ANSWERS.md). The verdict (is_correct) is supplied by the caller by design; this proves the
  database accepts it only from service_role, for the current key, inside the gate.

SAFETY  Staging project only (db_target.py refuses anything else, the live project included). It drops only the
database it created. Never prints a password or the connection string. All people in the fixture are invented.

Usage:  python scripts/staging/scratch_stage_e_proof.py --expect-ref <staging_ref> [--load 150] [--threads 8]
Exit 0 only when every check passed.
"""
import argparse
import json
import os
import re
import statistics
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
import v2_gate_lib as lib  # noqa: E402

PASSED, FAILED = [], []


def check(desc, ok, detail=""):
    (PASSED if ok else FAILED).append(desc)
    print(f"  [{'pass' if ok else 'FAIL'}] {desc}" + (f" -- {detail}" if detail and not ok else ""))
    return ok


def section(t):
    print(f"\n=== {t} ===")


def now_utc():
    return datetime.now(timezone.utc)


def build(cur):
    """Schema app through the latest migration, in the scratch database. Returns a list of file names applied."""
    def run(label, sql, owner):
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

    sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
    sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
    sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
    files = [f for f in ins.migration_files(None) if f.name[:3] != "023"]
    steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
    early = [f for f in files if f.name[:3] <= "025"]
    late = [f for f in files if f.name[:3] >= "026"]
    steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in early]
    steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
    steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in late]
    for label, text, owner in steps:
        if not run(label, text, owner):
            return None
    return [f.name for f in files], run


class Fixture:
    pass


def make_fixture(cur):
    """Invented course, cadets and items. Returns a Fixture."""
    fx = Fixture()
    cur.execute("BEGIN")
    b = lib.Builder(cur)
    b.auth_user = lambda user_id, email, password=None: cur.execute(
        "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
    fx.b = b

    def publish(item):
        # Step 1 keeps two rules that refuse to publish what only a new page produces. Step 2 removes them; the
        # proof turns both off for this one statement, inside its own transaction, as v2_gate_lib.publish does for one.
        trig = ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished")
        for t in trig:
            cur.execute(f"ALTER TABLE assignment_offerings DISABLE TRIGGER {t}")
        cur.execute("UPDATE assignment_offerings SET is_published = true WHERE id = %s AND NOT is_published", (item["ao"],))
        for t in trig:
            cur.execute(f"ALTER TABLE assignment_offerings ENABLE TRIGGER {t}")
    b.publish = publish
    course = b.course("e-proof", "Stage E proof course")
    term = b.term("proof-term", "Proof term", starts="2026-08-01", ends="2099-12-31")
    old_term = b.term("proof-old", "Proof ended term", starts="2020-01-01", ends="2020-06-01")
    fx.co = b.offering(course, term, True)
    course2 = b.course("e-proof-old", "Stage E proof course, ended term")
    fx.co_old = b.offering(course2, old_term, True)
    fx.sec = b.section(fx.co, "S1", ["M"])
    fx.sec_old = b.section(fx.co_old, "S1", ["M"])
    fx.director = b.staff("proof-director", "Test Director")
    cadet = {}
    for n, name in enumerate(["A", "B", "C", "D", "E"], start=1):
        cid = 3000900000 + n
        enr, uid = b.cadet(cid, f"Test Cadet {name}", fx.sec, status="dropped" if name == "D" else "active")
        cadet[name] = (cid, enr, uid)
    cid = 3000900010
    cadet["F"] = (cid, *b.cadet(cid, "Test Cadet F", fx.sec_old))
    cid = 3000900011
    cadet["G"] = (cid, *b.cadet(cid, "Test Cadet G", fx.sec, with_auth=True, status="active"))
    # a cadet who exists but is enrolled nowhere
    cid = 3000900012
    uid = b.id("user", cid)
    b.auth_user(uid, "x@x", None)
    cur.execute("INSERT INTO students (student_id, name, email, auth_user_id) VALUES (%s, %s, %s, %s)",
                (cid, "Test Cadet H", "h@prep-staging.example", uid))
    cadet["H"] = (cid, None, uid)
    fx.cadet = cadet
    Q = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    future, past = now_utc() + timedelta(days=2), now_utc() - timedelta(days=2)
    num_key = {"value": 9.8, "tol_pct": 2, "tol_abs": None}
    zero_key = {"value": 0, "tol_abs": 0.01}
    mc_key = {"correct_choice_ids": ["b"]}
    chs = [{"id": i, "text": f"Choice {i}"} for i in "abcd"]

    def homework(slug, due, **policy):
        it = b.item(course, fx.co, slug, slug, 0, kind="homework", paths=[Q], due=due, published=False,
                    entered_on_new_page=True, **policy)
        qs = {
            "q1": b.question(it, "q1", "numeric", 2, key=[num_key], n=0),
            "q2": b.question(it, "q2", "numeric", 1, key=[zero_key], n=1),
            "q3": b.question(it, "q3", "multiple_choice", 1, key=[mc_key], choices=chs, n=2),
        }
        it["q"] = qs
        return it

    fx.hw_open = homework("hw-open", future, attempt_limit=3, attempt_rule="best")
    fx.hw_last = homework("hw-last", future, attempt_limit=None, attempt_rule="last")
    fx.hw_first = homework("hw-first", future, attempt_limit=5, attempt_rule="first")
    fx.hw_closed = homework("hw-closed", past, attempt_limit=3)
    fx.hw_late = homework("hw-late", past, attempt_limit=3, late_allowed=True)
    fx.hw_unpub = homework("hw-unpub", future, attempt_limit=3)
    fx.hw_notyet = homework("hw-notyet", future, attempt_limit=3, opens_at=now_utc() + timedelta(days=1))
    fx.hw_retire = homework("hw-retire", future, attempt_limit=3)
    fx.hw_aikey = homework("hw-aikey", future, attempt_limit=3)
    fx.hw_ext = homework("hw-ext", past, attempt_limit=3)
    fx.hw_conc = homework("hw-conc", future, attempt_limit=3)
    fx.hw_two = homework("hw-two", future, attempt_limit=4)
    # the ended-term offering: late allowed, but the last class day has gone by
    it = b.item(course2, fx.co_old, "hw-oldterm", "hw-oldterm", 0, kind="homework", paths=[Q], due=past, published=False,
                entered_on_new_page=True, attempt_limit=3, late_allowed=True)
    it["q"] = {"q1": b.question(it, "q1", "numeric", 1, key=[num_key], n=0)}
    fx.hw_old = it
    cur.execute("UPDATE questions SET is_retired = true WHERE id = %s", (fx.hw_retire["q"]["q3"],))
    for it in (fx.hw_open, fx.hw_last, fx.hw_first, fx.hw_closed, fx.hw_late, fx.hw_notyet, fx.hw_retire,
               fx.hw_aikey, fx.hw_ext, fx.hw_conc, fx.hw_two, fx.hw_old):
        b.publish(it)
    cur.execute("INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by) VALUES (%s, %s, %s, 'Invented reason.', %s)",
                (cadet["B"][1], fx.hw_ext["ao"], now_utc() + timedelta(days=1), fx.director))
    cur.execute("COMMIT")
    return fx


# ---- calls, as the roles the system uses -------------------------------------------------------
def call(cur, role, fn, *args):
    cur.execute(f"SET ROLE {role}")
    try:
        cur.execute(f"SELECT app.{fn}({', '.join(['%s'] * len(args))})", args)
        return cur.fetchone()[0]
    finally:
        cur.execute("RESET ROLE")


def J(v):
    from psycopg2.extras import Json
    return Json(v)


def ctx(cur, fx, who, item, qname="q1"):
    return call(cur, "service_role", "answer_context", fx.cadet[who][2], item["ao"], item["q"][qname])


def rec(cur, fx, who, item, qname="q1", raw="9.8", parsed="98e-1", ok=True, key=None):
    if key is None:
        c = ctx(cur, fx, who, item, qname)
        key = c.get("key_version_id")
    return call(cur, "service_role", "record_answer", fx.cadet[who][2], item["ao"], item["q"][qname],
                J({"raw": raw}), parsed, ok, key)


def one(cur, sql, *a):
    cur.execute(sql, a or None)
    r = cur.fetchone()
    return r[0] if r else None


def run_checks(surl, cur, fx):
    A = fx.cadet["A"][2]
    section("grants")
    for role in ("authenticated", "anon", "prep_app_dml", "prep_app_read"):
        try:
            call(cur, role, "answer_context", A, fx.hw_open["ao"], fx.hw_open["q"]["q1"])
            check(f"{role} cannot run answer_context", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot run answer_context", "permission denied" in str(e), str(e)[:80])
        try:
            call(cur, role, "record_answer", A, fx.hw_open["ao"], fx.hw_open["q"]["q1"], J({"raw": "9.8"}), "98e-1", True, str(uuid.uuid4()))
            check(f"{role} cannot run record_answer", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot run record_answer", "permission denied" in str(e), str(e)[:80])
    c = ctx(cur, fx, "A", fx.hw_open)
    check("service_role can run answer_context", c.get("status") == "ok", str(c)[:100])

    section("the key never reaches a student session")
    claim = json.dumps({"sub": A, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)", (claim, A))
    cur.execute("SET ROLE authenticated")
    for tbl in ("question_keys", "key_remark_runs"):
        cur.execute(f"SELECT count(*) FROM app.{tbl}")
        check(f"a student session reads 0 rows of {tbl}", cur.fetchone()[0] == 0)
    for tbl, sql in (("question_attempts", "INSERT INTO app.question_attempts (enrollment_id, assignment_offering_id, question_id, attempt_no, answer) VALUES (%s,%s,%s,1,'{}')"),):
        try:
            cur.execute(sql, (fx.cadet["A"][1], fx.hw_open["ao"], fx.hw_open["q"]["q1"]))
            check("a student session cannot write question_attempts", False)
        except Exception as e:  # noqa: BLE001
            check("a student session cannot write question_attempts", "permission denied" in str(e) or "row-level" in str(e), str(e)[:80])
    try:
        cur.execute("UPDATE app.grades SET points_earned = 99, source = 'auto_checked'")
        check("a student session cannot write grades", cur.rowcount == 0, f"rowcount {cur.rowcount}")
    except Exception as e:  # noqa: BLE001
        check("a student session cannot write grades", True, str(e)[:60])
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)")
    for role in ("service_role", "prep_app_dml"):
        cur.execute(f"SET ROLE {role}")
        try:
            cur.execute("INSERT INTO app.question_attempts (enrollment_id, assignment_offering_id, question_id, attempt_no, answer) VALUES (%s,%s,%s,1,'{}')",
                        (fx.cadet["A"][1], fx.hw_open["ao"], fx.hw_open["q"]["q1"]))
            check(f"{role} cannot write question_attempts directly", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot write question_attempts directly", "permission denied" in str(e), str(e)[:80])
        cur.execute("RESET ROLE")
    r = ctx(cur, fx, "A", fx.hw_open)
    check("the context carries the key to the function (that is its job)", r["key"]["value"] == "9.8" and r["key"]["tol_pct"] == "2", str(r)[:120])
    check("numbers in the context are text, so no digit is lost", isinstance(r["key"]["value"], str))

    section("the gate")
    def st(who, item, q="q1"):
        return ctx(cur, fx, who, item, q).get("status")
    check("a cadet enrolled in no course is refused (not_enrolled)", st("H", fx.hw_open) == "not_enrolled")
    check("a dropped enrollment is refused", st("D", fx.hw_open) == "not_enrolled")
    check("a cadet of another course is refused", st("F", fx.hw_open) == "not_enrolled")
    check("an unknown sign-in id is refused", call(cur, "service_role", "answer_context", str(uuid.uuid4()), fx.hw_open["ao"], fx.hw_open["q"]["q1"])["status"] == "not_enrolled")
    check("a question that is not on that item is not found", call(cur, "service_role", "answer_context", A, fx.hw_open["ao"], fx.hw_last["q"]["q1"])["status"] == "not_found")
    check("an unpublished item is not open", st("A", fx.hw_unpub) == "not_found" or st("A", fx.hw_unpub) == "not_open")
    check("an item whose release time is tomorrow is not open", st("A", fx.hw_notyet) == "not_open")
    check("a retired question is refused", st("A", fx.hw_retire, "q3") == "retired")
    check("a deadline two days ago (late not allowed) is closed", st("A", fx.hw_closed) == "closed")
    check("late work allowed: accepted", st("A", fx.hw_late) == "ok")
    r = rec(cur, fx, "A", fx.hw_late)
    check("late work is stored and marked late", r["status"] == "ok" and one(cur, "SELECT is_late FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["A"][1], fx.hw_late["ao"]) is True)
    check("late allowed but the term's last class day has gone: closed", call(cur, "service_role", "answer_context", fx.cadet["F"][2], fx.hw_old["ao"], fx.hw_old["q"]["q1"])["status"] == "closed")
    check("past deadline with an extension: B may answer", st("B", fx.hw_ext) == "ok")
    check("past deadline without one: A may not", st("A", fx.hw_ext) == "closed")
    # an AI-written key nobody has checked
    cur.execute("BEGIN")
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id = %s AND superseded_at IS NULL", (fx.hw_aikey["q"]["q1"],))
    cur.execute("INSERT INTO app.question_keys (question_id, version, value, tol_pct, written_by) VALUES (%s, 2, 9.8, 2, 'ai')", (fx.hw_aikey["q"]["q1"],))
    cur.execute("COMMIT")
    check("an AI-written key a person has not checked is refused", st("A", fx.hw_aikey) == "key_unchecked")
    # no key at all
    cur.execute("BEGIN")
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id = %s AND superseded_at IS NULL", (fx.hw_two["q"]["q3"],))
    cur.execute("COMMIT")
    check("a question with no current key is refused", st("A", fx.hw_two, "q3") == "no_key")
    check("the refusal says nothing about the key", set(ctx(cur, fx, "A", fx.hw_closed).keys()) == {"status"})

    section("the attempt limit and the grade (limit 3, rule best)")
    it = fx.hw_open
    r1 = rec(cur, fx, "A", it, "q1", "10.5", "105e-1", False)
    r2 = rec(cur, fx, "A", it, "q1", "9.8", "98e-1", True)
    r3 = rec(cur, fx, "A", it, "q1", "1", "1e0", False)
    check("attempts are numbered 1, 2, 3 and attempts_left counts down", [r1["attempt_no"], r2["attempt_no"], r3["attempt_no"]] == [1, 2, 3] and [r1["attempts_left"], r2["attempts_left"], r3["attempts_left"]] == [2, 1, 0], str([r1, r2, r3]))
    check("the verdict is returned, nothing else about the key", set(r2.keys()) == {"status", "correct", "attempt_no", "attempts_left"})
    st4 = ctx(cur, fx, "A", it)
    check("the fourth attempt is refused (limit_reached)", st4["status"] == "limit_reached")
    r4 = call(cur, "service_role", "record_answer", A, it["ao"], it["q"]["q1"], J({"raw": "9.8"}), "98e-1", True, one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", it["q"]["q1"]))
    check("record_answer refuses it too, even with a valid key version", r4["status"] == "limit_reached")
    check("exactly 3 attempts are stored", one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND question_id=%s", fx.cadet["A"][1], it["q"]["q1"]) == 3)
    cur.execute("SELECT points_earned, points_possible, source, is_finalized, question_scores FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.cadet["A"][1], it["ao"]))
    g = cur.fetchone()
    check("best attempt counts: right then wrong keeps the 2 points", g and float(g[0]) == 2.0 and float(g[1]) == 4.0, str(g))
    check("the grade is auto_checked and finalized", g and g[2] == "auto_checked" and g[3] is True)
    check("question_scores carries score, max and status only", g and g[4]["q1"] == {"score": 2, "max": 2, "status": "full"} or (g and g[4]["q1"]["status"] == "full"), str(g and g[4]))
    rz = rec(cur, fx, "A", it, "q2", "0.005", "5e-3", True)
    rz2 = rec(cur, fx, "A", it, "q3", "b", None, True)
    cur.execute("SELECT points_earned FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.cadet["A"][1], it["ao"]))
    check("the grade sums every question: 2 + 1 + 1 = 4", float(cur.fetchone()[0]) == 4.0)
    cur.execute("SELECT parsed_value, key_version_id IS NOT NULL FROM app.question_attempts WHERE enrollment_id=%s AND question_id=%s AND attempt_no=1", (fx.cadet["A"][1], it["q"]["q1"]))
    pv = cur.fetchone()
    check("parsed_value is stored exactly, with the key version", pv and str(pv[0]) == "10.5" and pv[1] is True, str(pv))
    # a stale key version
    kid_old = one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", fx.hw_first["q"]["q1"])
    cur.execute("BEGIN")
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE id = %s", (kid_old,))
    cur.execute("INSERT INTO app.question_keys (question_id, version, value, tol_pct) VALUES (%s, 2, 10, 2)", (fx.hw_first["q"]["q1"],))
    cur.execute("COMMIT")
    rs = call(cur, "service_role", "record_answer", fx.cadet["A"][2], fx.hw_first["ao"], fx.hw_first["q"]["q1"], J({"raw": "9.8"}), "98e-1", True, kid_old)
    check("a verdict against a superseded key is refused (key_changed)", rs["status"] == "key_changed")
    check("...and stores nothing", one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["A"][1], fx.hw_first["ao"]) == 0)

    section("rules: last and first")
    for who, item, name in (("A", fx.hw_last, "last"), ("A", fx.hw_first, "first")):
        rec(cur, fx, who, item, "q1", "9.8", "98e-1", True)
        rec(cur, fx, who, item, "q1", "1", "1e0", False)
        pts = one(cur, "SELECT points_earned FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["A"][1], item["ao"])
        check(f"rule {name}: right then wrong scores {'0' if name == 'last' else '2'}", float(pts) == (0.0 if name == "last" else 2.0), str(pts))
    check("no attempt limit set: still capped at a ceiling (100)", ctx(cur, fx, "A", fx.hw_last)["status"] == "ok")

    section("a person's correction wins")
    try:
        cur.execute("UPDATE app.grades SET source='instructor', points_earned = 1.5, graded_by = %s WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.director, fx.cadet["A"][1], fx.hw_first["ao"]))
        check("the step 1 rule still refuses an ordinary finalized write on a new-page item", False)
    except Exception as e:  # noqa: BLE001
        check("the step 1 rule still refuses an ordinary finalized write on a new-page item", "grades_new_items_stay_unfinalized" in str(e))
    # the instructor's correction as step 2 will allow it: the step 1 rule is switched off for this one statement
    cur.execute("ALTER TABLE app.grades DISABLE TRIGGER grades_new_items_stay_unfinalized")
    cur.execute("UPDATE app.grades SET source='instructor', points_earned = 1.5, graded_by = %s WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.director, fx.cadet["A"][1], fx.hw_first["ao"]))
    cur.execute("ALTER TABLE app.grades ENABLE TRIGGER grades_new_items_stay_unfinalized")
    rec(cur, fx, "A", fx.hw_first, "q1", "9.8", "98e-1", True)
    cur.execute("SELECT points_earned, source FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.cadet["A"][1], fx.hw_first["ao"]))
    g = cur.fetchone()
    check("the grade stays as the instructor set it", g and float(g[0]) == 1.5 and g[1] == "instructor", str(g))
    check("...but the attempt is still stored", one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["A"][1], fx.hw_first["ao"]) == 3)

    section("hand-made arguments")
    key = one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", fx.hw_two["q"]["q1"])
    base = (fx.cadet["B"][2], fx.hw_two["ao"], fx.hw_two["q"]["q1"])
    for label, args in (
        ("an array instead of an object", (J(["x"]), "1e0", True, key)),
        ("text where a number is expected", (J({"raw": "x"}), "abc", True, key)),
        ("a null verdict", (J({"raw": "1"}), "1e0", None, key)),
        ("a null key version", (J({"raw": "1"}), "1e0", True, None)),
        ("an oversized answer", (J({"raw": "x" * 3000}), "1e0", True, key)),
    ):
        r = call(cur, "service_role", "record_answer", *base, *args)
        check(f"refused: {label}", r["status"] == "bad_request", str(r))
    check("none of those stored anything", one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["B"][1], fx.hw_two["ao"]) == 0)
    r = call(cur, "service_role", "record_answer", fx.cadet["B"][2], fx.hw_open["ao"], fx.hw_two["q"]["q1"], J({"raw": "1"}), "1e0", True, key)
    check("a question from another item cannot be written against this one", r["status"] == "not_found")
    r = call(cur, "service_role", "record_answer", fx.cadet["B"][2], fx.hw_two["ao"], fx.hw_two["q"]["q1"], J({"raw": "1"}), "1e0", True, str(uuid.uuid4()))
    check("an invented key version is refused", r["status"] == "key_changed")

    section("two tabs at once: the last attempt is taken once")
    errs, results = [], []
    def tab(i):
        try:
            c2 = connect(surl)
            cc = c2.cursor()
            k = one(cc, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", fx.hw_conc["q"]["q1"])
            results.append(call(cc, "service_role", "record_answer", fx.cadet["C"][2], fx.hw_conc["ao"], fx.hw_conc["q"]["q1"], J({"raw": str(i)}), f"{i}e0", False, k)["status"])
            c2.close()
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:80])
    ts = [threading.Thread(target=tab, args=(i,)) for i in range(12)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    n = one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND question_id=%s", fx.cadet["C"][1], fx.hw_conc["q"]["q1"])
    nums = sorted(r[0] for r in (cur.execute("SELECT attempt_no FROM app.question_attempts WHERE enrollment_id=%s AND question_id=%s", (fx.cadet["C"][1], fx.hw_conc["q"]["q1"])) or cur.fetchall()))
    check("12 simultaneous answers, limit 3: exactly 3 stored", n == 3 and results.count("ok") == 3 and not errs, f"stored {n}, ok {results.count('ok')}, errs {errs[:2]}")
    check("attempt numbers are 1, 2, 3 with no gap and no duplicate", nums == [1, 2, 3], str(nums))
    check("the other 9 were told limit_reached", results.count("limit_reached") == 9, str(sorted(set(results))))

    section("the total does not see attempts, only the grade")
    try:
        cur.execute("SELECT state FROM app._cells_at(%s, 'final', now()) c WHERE false", (fx.co,))
    except Exception:  # noqa: BLE001
        pass
    cur.execute("SET ROLE prep_app_read")
    try:
        cur.execute("""SELECT state FROM app.gradebook_cells(%s,'final') WHERE false""", (fx.co,))
    except Exception:  # noqa: BLE001
        pass
    cur.execute("RESET ROLE")
    cur.execute("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prosrc ILIKE '%question_attempts%' AND p.proname IN ('_totals_at','course_totals','my_course_total','gradebook_cells')")
    check("no total function reads question_attempts (points come from the grade only)", cur.fetchone()[0] == 0)
    check("the cell state reads attempts only to say in_progress, in one EXISTS", one(cur, "SELECT (length(p.prosrc) - length(replace(p.prosrc, 'question_attempts', ''))) / length('question_attempts') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='_cells_at'") == 1)


def rollback_check(cur):
    section("rollback and re-apply")
    mig = REPO / "supabase" / "migrations" / "app"

    def apply(path):
        sql = path.read_text(encoding="utf-8")
        body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
        cur.execute("SET ROLE prep_app_owner;")
        cur.execute("RESET search_path;")
        try:
            cur.execute(body)
            return True
        except Exception as e:  # noqa: BLE001
            cur.execute("ROLLBACK")
            print("    ", str(e).strip().splitlines()[0])
            return False
        finally:
            cur.execute("RESET ROLE")

    check("071 rolls back", apply(mig / "rollback" / "071_answer_marking_ROLLBACK.sql"))
    check("the answer functions are gone", one(cur, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('answer_context','record_answer','_answer_gate')") == 0)
    check("070 rolls back", apply(mig / "rollback" / "070_answer_internals_ROLLBACK.sql"))
    check("release_at and the 029 guard are as before", one(cur, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('release_at', 'grades_new_items_stay_unfinalized') AND (p.prosrc LIKE '%_release_core%' OR p.prosrc LIKE '%auto_check_marker%')") == 0)
    check("070 re-applies", apply(mig / "070_answer_internals.sql"))
    check("071 re-applies", apply(mig / "071_answer_marking.sql"))


def connect(surl):
    import psycopg2
    c = psycopg2.connect(surl, connect_timeout=15)
    c.autocommit = True
    return c


def load_test(surl, cur, fx, n_students, threads):
    """End-of-deadline load: n students, answers around the cutoff, over many connections.

    `cur` MUST be the cursor the fixture builder (fx.b) writes through: the builder holds its own cursor, so a fresh
    connection here would build the fixture on a connection whose search path was never set.
    """
    section(f"end-of-deadline load test: {n_students} students, {threads} connections")
    cur.execute("BEGIN")
    b = fx.b
    cur.execute("SET search_path = app, public")
    course = one(cur, "SELECT course_id FROM app.course_offerings WHERE id=%s", fx.co)
    # created far in the future; the real deadline is set below, once every cadet exists
    due = now_utc() + timedelta(days=1)
    Q = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    it = b.item(course, fx.co, "hw-load", "hw-load", 0, kind="homework", paths=[Q], due=due, published=False,
                entered_on_new_page=True, attempt_limit=3, attempt_rule="best")
    it["q"] = {"q1": b.question(it, "q1", "numeric", 2, key=[{"value": 9.8, "tol_pct": 2}], n=0),
               "q2": b.question(it, "q2", "numeric", 2, key=[{"value": 9.8, "tol_pct": 2}], n=1)}
    people = []
    for i in range(n_students):
        cid = 3000801000 + i  # last 4 digits (1000..) must not collide with the fixture: they make the email
        enr, uid = b.cadet(cid, f"Load Cadet {i}", fx.sec)
        people.append((enr, uid))
    b.publish(it)
    cur.execute("COMMIT")
    # Now the fixture is ready. Deadline = 120 s grace + WINDOW s from now, so the first WINDOW s of answers are on time
    # and later ones are closed. Computed here so building 150 cadets cannot use the window up.
    window = 8
    due = now_utc() - timedelta(seconds=120) + timedelta(seconds=window)
    trig = ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished")
    cur.execute("BEGIN")
    for t in trig:  # the publish rules also fire on an update of a published row; off for this one statement, as in publish()
        cur.execute(f"ALTER TABLE app.assignment_offerings DISABLE TRIGGER {t}")
    cur.execute("UPDATE app.assignment_offerings SET due_at = %s, due_by_day = '{}'::jsonb WHERE id = %s", (due, it["ao"]))
    for t in trig:
        cur.execute(f"ALTER TABLE app.assignment_offerings ENABLE TRIGGER {t}")
    cur.execute("COMMIT")
    keys = {q: one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", qid) for q, qid in it["q"].items()}

    lat, outcomes, errs = [], {}, []
    lock = threading.Lock()
    stop_at = time.time() + window + 12
    work = list(range(n_students))

    def worker():
        try:
            conn_w = connect(surl)
            cc = conn_w.cursor()
        except Exception as e:  # noqa: BLE001
            with lock:
                errs.append("connect: " + str(e).strip().splitlines()[0][:80])
            return
        try:
            work_loop(cc)
        finally:
            try:
                conn_w.close()
            except Exception:  # noqa: BLE001
                pass

    def work_loop(cc):
        while True:
            with lock:
                if not work:
                    return
                i = work.pop()
            enr, uid = people[i]
            for attempt in range(3):
                for q in ("q1", "q2"):
                    if time.time() > stop_at:
                        return
                    t0 = time.time()
                    try:
                        r = call(cc, "service_role", "record_answer", uid, it["ao"], it["q"][q], J({"raw": "9.8"}),
                                 "98e-1", attempt == 1 or q == "q2", keys[q])
                    except Exception as e:  # noqa: BLE001
                        with lock:
                            errs.append(str(e)[:80])
                        continue
                    dt = time.time() - t0
                    with lock:
                        lat.append(dt)
                        outcomes[r["status"]] = outcomes.get(r["status"], 0) + 1

    t0 = time.time()
    ts = [threading.Thread(target=worker) for _ in range(threads)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    wall = time.time() - t0
    lat.sort()
    p = lambda q: lat[min(len(lat) - 1, int(len(lat) * q))] if lat else 0
    print(f"    calls {len(lat)} in {wall:.1f}s ({len(lat)/wall:.1f}/s); latency p50 {p(.5)*1000:.0f} ms, p95 {p(.95)*1000:.0f} ms, max {max(lat)*1000:.0f} ms" if lat else "    no calls")
    print(f"    outcomes {outcomes}")
    check("every connection opened and no database error under load", not errs, f"{len(errs)} errors, e.g. {errs[:2]}")
    check("every call got a clean answer (ok or closed)", set(outcomes) <= {"ok", "closed"}, str(outcomes))
    cur.execute("SELECT max(answered_at) FROM app.question_attempts WHERE assignment_offering_id=%s", (it["ao"],))
    last = cur.fetchone()[0]
    check("no stored attempt is later than the deadline plus grace", last is None or last <= due + timedelta(seconds=120), str(last))
    check("nobody has more than 3 attempts on a question", one(cur, "SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM app.question_attempts WHERE assignment_offering_id=%s GROUP BY enrollment_id, question_id) s", it["ao"]) <= 3)
    check("attempt numbers have no gaps", one(cur, "SELECT count(*) FROM (SELECT enrollment_id, question_id, max(attempt_no) m, count(*) c FROM app.question_attempts WHERE assignment_offering_id=%s GROUP BY 1,2) s WHERE m <> c", it["ao"]) == 0)
    check("at most one grade per student", one(cur, "SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM app.grades WHERE assignment_offering_id=%s GROUP BY enrollment_id) s", it["ao"]) <= 1)
    bad = one(cur, """SELECT count(*) FROM app.grades g
                       WHERE g.assignment_offering_id=%s AND g.points_earned IS DISTINCT FROM
                         (SELECT coalesce(sum(best),0) FROM (SELECT max(a.points_awarded) best FROM app.question_attempts a
                            WHERE a.enrollment_id=g.enrollment_id AND a.assignment_offering_id=g.assignment_offering_id
                            GROUP BY a.question_id) s)""", it["ao"])
    check("every grade equals the best-attempt sum recomputed independently", bad == 0, f"{bad} differ")
    check("answers landed on BOTH sides of the cutoff (some ok, some closed)",
          bool(outcomes.get("ok")) and bool(outcomes.get("closed")), str(outcomes))
    cur.execute("RESET search_path")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--load", type=int, default=0, help="also run the load test with this many students")
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()
    url = os.environ.get("STAGING_DB_URL", "").strip()
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_stagee_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 1
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)
        conn = connect(surl)
        cur = conn.cursor()
        built = build(cur)
        if built is None:
            return 1
        files, _ = built
        print(f"built    schema app from {len(files)} migration files, last {files[-1]}")
        check("070 and 071 are in the build", "070_answer_internals.sql" in files and "071_answer_marking.sql" in files)
        fx = make_fixture(cur)
        run_checks(surl, cur, fx)
        if args.load:
            load_test(surl, cur, fx, args.load, args.threads)
        rollback_check(cur)
        conn.close()
        print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
        for f in FAILED:
            print("  - " + f)
        code = 0 if not FAILED else 1
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
