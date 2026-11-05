#!/usr/bin/env python3
"""Prove the second part of Stage E (migrations app/072 and app/073) on a THROWAWAY database on the staging server.

072 re-marks stored attempts after a key correction (remark_context, remark_apply, one shared grade calculation).
073 is what a student may read of an auto-checked item (student_homework). The database is built the way
scratch_stage_e_proof.py builds it, an invented fixture is loaded, the checks run as the roles the real system uses, and the
database is dropped whatever happened. Nothing in the staging database itself is read or written.

CHECKS (each prints [pass] or [FAIL])
  grants        only service_role can run the re-mark functions; a signed-in user, anon and the data role cannot
  who           a cadet, a stranger, a plain instructor and a director of another course are refused; a director and an admin pass
  preview       writes nothing and shows the counts, the grades to recompute and the grades listed
  commit        must carry the preview's number; updates is_correct, points, key version; recomputes auto_checked grades;
                lists (does not change) an instructor-corrected grade; logs exactly one key_remark_runs row
  twice         a second run changes 0 rows
  unreadable    an answer with no verdict is left as it was
  refusals      a superseded key, a missing verdict, a verdict for another question's attempt, a duplicate: all refused
  all or none   a failure after the attempts were updated leaves no attempt, grade or log row changed
  concurrency   students answering while a re-mark runs: every grade equals the independent recomputation
  one rule      storing an answer and re-marking give the same grade (best / last / first)
  student read  a student session gets the questions of a released item, with no key data on any route; none before release,
                none when unpublished, none when not enrolled, none for a retired question
  rollback      073 then 072 roll back (record_answer works again) and re-apply cleanly

WHAT THIS CANNOT PROVE
  The edge function (the checker is JavaScript; tests/app-schema/test-remark-function.mjs covers it against a model),
  Supabase Auth, and the browser. The verdicts here come from a small Python reader of the invented numbers.

SAFETY  Staging project only (db_target.py refuses anything else). It drops only the database it created. Never prints a
password or the connection string. All people in the fixture are invented.

Usage:  python scripts/staging/scratch_stage_e_part2_proof.py --expect-ref <staging_ref>
Exit 0 only when every check passed.
"""
import argparse
import hashlib
import json
import os
import sys
import threading
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
import scratch_stage_e_proof as p  # noqa: E402
from scratch_stage_e_proof import J, call, check, connect, now_utc, one, section  # noqa: E402

NUM_KEY = {"value": 9.8, "tol_pct": 2, "tol_abs": None}
ZERO_KEY = {"value": 0, "tol_abs": 0.01}
MC_KEY = {"correct_choice_ids": ["b"]}
CHS = [{"id": i, "text": f"Choice {i}"} for i in "abcd"]
KEY_FORBIDDEN = ("correct_choice_ids", "tol_pct", "tol_abs", "sig_fig", "key_version", "unit_alias", "unit_mode", "variant_key")


def verdict(fmt, answer, key, choice_ids):
    """A small reader for the invented answers. None means 'cannot be read' (the real reader is numeric-answer.js)."""
    if fmt == "numeric":
        raw = (answer or {}).get("raw")
        try:
            if not isinstance(raw, str) or "," in raw:
                return None, None
            d = Decimal(raw.strip())
            v = Decimal(key["value"])
            diff = abs(d - v)
            ta = Decimal(key["tol_abs"]) if key.get("tol_abs") is not None else None
            tp = Decimal(key["tol_pct"]) if key.get("tol_pct") is not None else None
            ok = diff == 0 or (ta is not None and diff <= ta) or (tp is not None and diff * 100 <= abs(v) * tp)
            return ok, raw.strip()
        except (InvalidOperation, ValueError):
            return None, None
    ch = (answer or {}).get("choices")
    if not isinstance(ch, list) or not ch or any(c not in choice_ids for c in ch):
        return None, None
    return sorted(set(ch)) == sorted(set(key.get("correct_choice_ids") or [])), None


def make_items(cur, fx):
    """Items for this proof, built the way make_fixture builds its own."""
    b = fx.b
    Qp = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    future, past = now_utc() + timedelta(days=2), now_utc() - timedelta(days=2)
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    b.assign(fx.director, fx.co, "director")
    fx.plain = b.staff("proof-plain-instr", "Test Instructor")
    b.assign(fx.plain, fx.co, "instructor")
    fx.other_dir = b.staff("proof-other-director", "Test Other Director")
    b.assign(fx.other_dir, fx.co_old, "director")
    fx.admin = b.staff("proof-admin", "Test Admin", admin=True)

    def homework(slug, due=future, **policy):
        it = b.item(p_course(cur, fx), fx.co, slug, slug, 0, kind="homework", paths=[Qp], due=due, published=False,
                    entered_on_new_page=True, **policy)
        it["q"] = {
            "q1": b.question(it, "q1", "numeric", 2, key=[NUM_KEY], n=0, prompt="How fast, in m/s?"),
            "q2": b.question(it, "q2", "numeric", 1, key=[ZERO_KEY], n=1),
            "q3": b.question(it, "q3", "multiple_choice", 1, key=[MC_KEY], choices=CHS, n=2),
        }
        return it

    fx.r1 = homework("r1-main", attempt_limit=6, attempt_rule="best")
    fx.r2 = homework("r2-atomic", attempt_limit=6, attempt_rule="best")
    fx.r3 = homework("r3-concurrent", attempt_limit=12, attempt_rule="best")
    fx.r4 = homework("r4-last", attempt_limit=6, attempt_rule="last")
    fx.r5 = homework("r5-first", attempt_limit=6, attempt_rule="first")
    fx.r6 = homework("r6-aikey", attempt_limit=6, attempt_rule="best")
    fx.s_far = homework("s-far", due=now_utc() + timedelta(days=20), attempt_limit=3)
    fx.s_unpub = homework("s-unpub", attempt_limit=3)
    fx.s_notyet = homework("s-notyet", attempt_limit=3, opens_at=now_utc() + timedelta(days=1))
    fx.s_closed = homework("s-closed", due=past, attempt_limit=3)
    fx.s_retire = homework("s-retire", attempt_limit=3)
    cur.execute("UPDATE questions SET is_retired = true WHERE id = %s", (fx.s_retire["q"]["q3"],))
    for it in (fx.r1, fx.r2, fx.r3, fx.r4, fx.r5, fx.r6, fx.s_far, fx.s_notyet, fx.s_closed, fx.s_retire):
        b.publish(it)
    cur.execute("COMMIT")


def p_course(cur, fx):
    return one(cur, "SELECT course_id FROM course_offerings WHERE id = %s", fx.co)


def ans(cur, fx, who, item, qname, raw, ok=None, choices=None):
    """Store one answer through record_answer, the way the edge function does."""
    c = p.ctx(cur, fx, who, item, qname)
    assert c.get("status") == "ok", c
    if choices is not None:
        okv = ok if ok is not None else verdict("multiple_choice", {"choices": choices}, c["key"], c["choice_ids"])[0]
        return call(cur, "service_role", "record_answer", fx.cadet[who][2], item["ao"], item["q"][qname],
                    J({"choices": choices}), None, okv, c["key_version_id"])
    okv, parsed = verdict("numeric", {"raw": raw}, c["key"], [])
    if ok is not None:
        okv = ok
    return call(cur, "service_role", "record_answer", fx.cadet[who][2], item["ao"], item["q"][qname],
                J({"raw": raw}), parsed, bool(okv), c["key_version_id"])


def correct_key(cur, qid, value, tol_pct):
    """A person corrects the key: a new version, the old one superseded."""
    cur.execute("BEGIN")
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id = %s AND superseded_at IS NULL", (qid,))
    cur.execute("SELECT coalesce(max(version), 0) + 1 FROM app.question_keys WHERE question_id = %s", (qid,))
    ver = cur.fetchone()[0]
    cur.execute("INSERT INTO app.question_keys (question_id, version, value, tol_pct) VALUES (%s, %s, %s, %s) RETURNING id",
                (qid, ver, value, tol_pct))
    kid = cur.fetchone()[0]
    cur.execute("COMMIT")
    return str(kid)


def rctx(cur, who_uid, qid):
    return call(cur, "service_role", "remark_context", who_uid, qid)


def verdicts_for(c, fmt="numeric", overrides=None):
    out = []
    for a in c["attempts"]:
        ok, parsed = verdict(fmt, a["answer"], c["key"], c["choice_ids"])
        if overrides and a["id"] in overrides:
            ok, parsed = overrides[a["id"]]
        out.append({"id": a["id"], "is_correct": ok, "parsed": parsed})
    return out


def apply(cur, who_uid, qid, key_id, verdicts, commit, expect=None):
    return call(cur, "service_role", "remark_apply", who_uid, qid, key_id, J(verdicts), commit, expect)


def snap(cur, qid):
    cur.execute("SELECT id, enrollment_id, attempt_no, is_correct, points_awarded, key_version_id, parsed_value "
                "FROM app.question_attempts WHERE question_id = %s ORDER BY id", (qid,))
    return [tuple(map(str, r)) for r in cur.fetchall()]


def grade_snap(cur, ao):
    cur.execute("SELECT enrollment_id, points_earned, source, is_finalized, question_scores FROM app.grades "
                "WHERE assignment_offering_id = %s ORDER BY enrollment_id", (ao,))
    return [tuple(map(str, r)) for r in cur.fetchall()]


def fp(x):
    return hashlib.sha256(json.dumps(x, sort_keys=True).encode()).hexdigest()[:12]


def runs(cur, qid):
    cur.execute("SELECT from_key_version, to_key_version, run_by, attempts_changed, grades_recomputed, grades_listed "
                "FROM app.key_remark_runs WHERE question_id = %s ORDER BY run_at", (qid,))
    return cur.fetchall()


def independent_ok(cur, ao):
    """Every auto_checked grade equals the sum of each question's best attempt, recomputed from the stored attempts."""
    return one(cur, """SELECT count(*) FROM app.grades g
                        WHERE g.assignment_offering_id=%s AND g.source='auto_checked' AND g.points_earned IS DISTINCT FROM
                          (SELECT coalesce(sum(best),0) FROM (SELECT max(a.points_awarded) best FROM app.question_attempts a
                             WHERE a.enrollment_id=g.enrollment_id AND a.assignment_offering_id=g.assignment_offering_id
                             GROUP BY a.question_id) s)""", ao)


def run_remark_checks(cur, surl, fx):
    D, ADM = fx.director, fx.admin
    A, B, C, E = (fx.cadet[k][2] for k in "ABCE")
    it = fx.r1
    q1 = it["q"]["q1"]

    section("grants")
    for role in ("authenticated", "anon", "prep_app_dml", "prep_app_read"):
        for fn, args in (("remark_context", (D, q1)), ("remark_apply", (D, q1, str(uuid.uuid4()), J([]), False, None))):
            try:
                call(cur, role, fn, *args)
                check(f"{role} cannot run {fn}", False)
            except Exception as e:  # noqa: BLE001
                check(f"{role} cannot run {fn}", "permission denied" in str(e), str(e)[:80])
    for fn, sig in (("_regrade_auto", "uuid, uuid, uuid"), ("_may_correct_key", "uuid, uuid"), ("_remark_calc", "uuid, uuid, jsonb")):
        for role in ("service_role", "authenticated", "anon"):
            ok = one(cur, f"SELECT has_function_privilege('{role}', 'app.{fn}({sig})', 'EXECUTE')")
            check(f"{role} cannot run the internal {fn}", ok is False)
    check("service_role can run remark_context (a director, a question with a key)", rctx(cur, D, q1)["status"] == "ok")

    section("the answers, under the old key (limit 6, rule best; key 9.8 within 2 percent)")
    ans(cur, fx, "A", it, "q1", "9.8"); ans(cur, fx, "A", it, "q1", "9.0"); ans(cur, fx, "A", it, "q3", None, choices=["b"])
    ans(cur, fx, "B", it, "q1", "12"); ans(cur, fx, "B", it, "q1", "9.5"); ans(cur, fx, "B", it, "q1", "1,5", ok=False)
    ans(cur, fx, "C", it, "q1", "12")
    ans(cur, fx, "E", it, "q1", "9.9")
    pts = {k: one(cur, "SELECT points_earned FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet[k][1], it["ao"])
           for k in "ABCE"}
    check("grades before the correction: A 3, B 0, C 0, E 2", [float(pts[k]) for k in "ABCE"] == [3.0, 0.0, 0.0, 2.0], str(pts))
    # an instructor takes over C's grade
    cur.execute("ALTER TABLE app.grades DISABLE TRIGGER grades_new_items_stay_unfinalized")
    cur.execute("UPDATE app.grades SET source='instructor', points_earned = 1.5, graded_by = %s WHERE enrollment_id=%s AND assignment_offering_id=%s",
                (D, fx.cadet["C"][1], it["ao"]))
    cur.execute("ALTER TABLE app.grades ENABLE TRIGGER grades_new_items_stay_unfinalized")

    old_key = one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", q1)
    new_key = correct_key(cur, q1, 12, 2)

    section("who may re-mark")
    for label, uid in (("a cadet", A), ("a stranger", str(uuid.uuid4())), ("a plain instructor", fx.plain), ("a director of another course", fx.other_dir)):
        c = rctx(cur, uid, q1)
        check(f"{label} is refused by remark_context", c["status"] == "not_allowed" and set(c) == {"status"}, str(c)[:80])
        r = apply(cur, uid, q1, new_key, [], False)
        check(f"{label} is refused by remark_apply", r["status"] == "not_allowed", str(r)[:80])
    c = rctx(cur, D, q1)
    check("a director is let in; the context has the format, the current key and every attempt", c["status"] == "ok" and c["key_version_id"] == new_key and len(c["attempts"]) == 7, str(c)[:120])
    check("each attempt carries only its id and raw answer", all(set(a) == {"id", "answer"} for a in c["attempts"]))
    check("a global admin is let in", rctx(cur, ADM, q1)["status"] == "ok")

    section("the preview writes nothing")
    before = (fp(snap(cur, q1)), fp(grade_snap(cur, it["ao"])), len(runs(cur, q1)))
    vs = verdicts_for(c)
    unread = [v for v in vs if v["is_correct"] is None]
    check("the invented '1,5' answer has no verdict", len(unread) == 1)
    pv = apply(cur, D, q1, new_key, vs, False)
    check("preview: ok, not committed", pv["status"] == "ok" and pv["committed"] is False, str(pv)[:100])
    check("preview counts: 7 attempts, 6 would change, 2 now right, 2 now wrong, 1 unreadable",
          [pv["attempts_total"], pv["attempts_changed"], pv["now_correct"], pv["now_wrong"], pv["unreadable"]] == [7, 6, 2, 2, 1], str(pv))
    check("preview grades: 3 to recompute, 1 listed (the instructor's)", [pv["grades_to_recompute"], pv["grades_listed"]] == [3, 1] and len(pv["listed"]) == 1 and pv["listed"][0]["source"] == "instructor", str(pv["listed"]))
    check("the preview sample shows what moves, and no key", 0 < len(pv["sample"]) <= 50 and "9.8" not in json.dumps(pv))
    after = (fp(snap(cur, q1)), fp(grade_snap(cur, it["ao"])), len(runs(cur, q1)))
    check("nothing was written: attempts, grades and the run log are as they were", before == after)

    section("the commit")
    r0 = apply(cur, D, q1, new_key, vs, True, None)
    check("a commit without the preview's token is refused", r0["status"] == "bad_request")
    r1 = apply(cur, D, q1, new_key, vs, True, "f" * 32)
    check("a commit with a token the preview did not give is refused (changed_since_preview) and writes nothing",
          r1["status"] == "changed_since_preview" and before == (fp(snap(cur, q1)), fp(grade_snap(cur, it["ao"])), len(runs(cur, q1))), str(r1))
    r2 = apply(cur, D, q1, str(uuid.uuid4()), vs, True, pv["preview_token"])
    check("verdicts about a key that is not the current one are refused (key_changed)", r2["status"] == "key_changed")
    r3 = apply(cur, D, q1, old_key, vs, True, pv["preview_token"])
    check("verdicts about the superseded key are refused", r3["status"] == "key_changed")
    check("none of those wrote anything", before == (fp(snap(cur, q1)), fp(grade_snap(cur, it["ao"])), len(runs(cur, q1))))
    res = apply(cur, D, q1, new_key, vs, True, pv["preview_token"])
    check("a commit with the preview's token is applied", res["status"] == "ok" and res["committed"] is True and res["attempts_changed"] == 6, str(res))
    cur.execute("SELECT a.is_correct, a.points_awarded, a.key_version_id::text, e.student_id FROM app.question_attempts a JOIN app.enrollments e ON e.id = a.enrollment_id WHERE a.question_id=%s ORDER BY a.id", (q1,))
    rows = cur.fetchall()
    check("every readable attempt is stamped with the new key", sum(1 for r in rows if r[2] == new_key) == 6)
    check("the unreadable attempt keeps its old key and its result", sum(1 for r in rows if r[2] == str(old_key)) == 1)
    g = {k: cur.execute("SELECT points_earned, source FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (fx.cadet[k][1], it["ao"])) or cur.fetchone() for k in "ABCE"}
    check("grades recomputed: A 1 (q1 now wrong, q3 right), B 2, E 0", [float(g[k][0]) for k in "ABE"] == [1.0, 2.0, 0.0], str(g))
    check("the instructor's grade is not changed: C still 1.5, source instructor", float(g["C"][0]) == 1.5 and g["C"][1] == "instructor", str(g["C"]))
    check("every auto_checked grade equals the independent recomputation", independent_ok(cur, it["ao"]) == 0)
    rr = runs(cur, q1)
    check("exactly one key_remark_runs row: from the old key, to the new, by the director, with the counts",
          len(rr) == 1 and str(rr[0][0]) == str(old_key) and str(rr[0][1]) == new_key and str(rr[0][2]) == str(D) and tuple(rr[0][3:]) == (6, 3, 1), str(rr))

    section("run it twice")
    snap1, gsnap1 = fp(snap(cur, q1)), fp(grade_snap(cur, it["ao"]))
    c2 = rctx(cur, D, q1)
    vs2 = verdicts_for(c2)
    pv2 = apply(cur, D, q1, new_key, vs2, False)
    check("the preview now shows 0 changes", pv2["attempts_changed"] == 0 and pv2["grades_listed"] == 0 and pv2["grades_to_recompute"] == 0, str(pv2))
    again = apply(cur, D, q1, new_key, vs2, True, pv2["preview_token"])
    check("a second commit changes 0 and touches nothing", again["status"] == "ok" and again["attempts_changed"] == 0 and snap1 == fp(snap(cur, q1)) and gsnap1 == fp(grade_snap(cur, it["ao"])))
    check("the second run is logged as a run with 0 changed", len(runs(cur, q1)) == 2 and tuple(runs(cur, q1)[1][3:]) == (0, 0, 0))

    section("malformed verdicts")
    c3 = rctx(cur, D, q1)
    full = verdicts_for(c3)
    check("a missing verdict is refused (bad_request or attempts_moved), nothing written",
          apply(cur, D, q1, new_key, full[:-1], False)["status"] in ("attempts_moved", "bad_request"))
    check("a verdict for an attempt that is not on this question is refused", apply(cur, D, q1, new_key, full[:-1] + [{"id": str(uuid.uuid4()), "is_correct": True, "parsed": None}], False)["status"] == "bad_request")
    check("a verdict listed twice is refused", apply(cur, D, q1, new_key, full + [full[0]], False)["status"] == "bad_request")
    check("an unreadable number text is refused", apply(cur, D, q1, new_key, [dict(full[0], parsed="abc")] + full[1:], False)["status"] == "bad_request")
    check("a verdict list that is not a list is refused", apply(cur, D, q1, new_key, {"a": 1}, False)["status"] == "bad_request")
    check("a question with nothing to read (no attempts) previews as 0 changes", apply(cur, D, fx.r4["q"]["q2"], one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", fx.r4["q"]["q2"]), [], False)["attempts_changed"] == 0)

    section("an AI-written key a person has not checked is not applied")
    qa = fx.r6["q"]["q1"]
    ans(cur, fx, "A", fx.r6, "q1", "9.8")
    cur.execute("BEGIN")
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id = %s AND superseded_at IS NULL", (qa,))
    cur.execute("INSERT INTO app.question_keys (question_id, version, value, tol_pct, written_by) VALUES (%s, 2, 12, 2, 'ai')", (qa,))
    cur.execute("COMMIT")
    check("remark_context refuses it (key_unchecked)", rctx(cur, D, qa)["status"] == "key_unchecked")

    section("all or nothing: a failure after the attempts were updated changes nothing")
    r2it = fx.r2
    q2k = r2it["q"]["q1"]
    ans(cur, fx, "A", r2it, "q1", "9.8"); ans(cur, fx, "B", r2it, "q1", "12")
    k2 = correct_key(cur, q2k, 12, 2)
    cur.execute("SET ROLE prep_app_owner")
    cur.execute("RESET search_path")
    cur.execute("CREATE FUNCTION app._proof_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'proof failure after the attempts were updated'; END $$")
    cur.execute("CREATE TRIGGER _proof_boom BEFORE UPDATE ON app.grades FOR EACH ROW EXECUTE FUNCTION app._proof_boom()")
    cur.execute("RESET ROLE")
    c4 = rctx(cur, D, q2k)
    v4 = verdicts_for(c4)
    pv4 = apply(cur, D, q2k, k2, v4, False)
    s0 = (fp(snap(cur, q2k)), fp(grade_snap(cur, r2it["ao"])), len(runs(cur, q2k)))
    try:
        apply(cur, D, q2k, k2, v4, True, pv4["preview_token"])
        check("the failing commit raised", False)
    except Exception as e:  # noqa: BLE001
        check("the failing commit raised the injected error", "proof failure" in str(e), str(e)[:80])
    check("no attempt, grade or log row changed", s0 == (fp(snap(cur, q2k)), fp(grade_snap(cur, r2it["ao"])), len(runs(cur, q2k))))
    cur.execute("SET ROLE prep_app_owner")
    cur.execute("RESET search_path")
    cur.execute("DROP TRIGGER _proof_boom ON app.grades")
    cur.execute("DROP FUNCTION app._proof_boom()")
    cur.execute("RESET ROLE")
    ok2 = apply(cur, D, q2k, k2, v4, True, pv4["preview_token"])
    check("with the fault removed the same commit succeeds", ok2["status"] == "ok" and ok2["attempts_changed"] == pv4["attempts_changed"] > 0, str(ok2))

    section("students answering while a re-mark runs (12 attempts)")
    r3it = fx.r3
    q3k = r3it["q"]["q1"]
    ans(cur, fx, "A", r3it, "q1", "9.8"); ans(cur, fx, "B", r3it, "q1", "12"); ans(cur, fx, "E", r3it, "q1", "9.0")
    k3 = correct_key(cur, q3k, 12, 2)
    errs, statuses = [], []
    stop = threading.Event()

    def student(who, raws):
        try:
            c2 = connect(surl)
            cc = c2.cursor()
            for raw in raws:
                key = one(cc, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", q3k)
                kd = {"value": "12", "tol_pct": "2", "tol_abs": None}
                okv, parsed = verdict("numeric", {"raw": raw}, kd, [])
                statuses.append(call(cc, "service_role", "record_answer", fx.cadet[who][2], r3it["ao"], q3k, J({"raw": raw}), parsed, bool(okv), key)["status"])
            c2.close()
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:80])

    threads = [threading.Thread(target=student, args=(w, raws)) for w, raws in (("A", ["12", "9"]), ("B", ["9", "12"]), ("E", ["12", "12"]), ("C", ["9"]))]
    [t.start() for t in threads]
    done, tries = None, 0
    while tries < 30:
        tries += 1
        cx = rctx(cur, D, q3k)
        prev = apply(cur, D, q3k, k3, verdicts_for(cx), False)
        if prev["status"] != "ok":
            continue
        done = apply(cur, D, q3k, k3, verdicts_for(cx), True, prev["preview_token"])
        if done["status"] == "ok":
            break
    [t.join() for t in threads]
    check("the re-mark finished (retrying a preview that went stale)", done is not None and done["status"] == "ok", str(done))
    # whatever arrived after the last commit was marked by record_answer against the current key: finish with one more pass
    cx = rctx(cur, D, q3k)
    last = apply(cur, D, q3k, k3, verdicts_for(cx), False)
    apply(cur, D, q3k, k3, verdicts_for(cx), True, last["preview_token"]) if last["attempts_changed"] else None
    check("no database error in any thread", not errs, str(errs[:2]))
    check("every answer was stored or cleanly refused", set(statuses) <= {"ok", "busy", "limit_reached"}, str(sorted(set(statuses))))
    check("every attempt on the question is stamped with the current key", one(cur, "SELECT count(*) FROM app.question_attempts WHERE question_id=%s AND key_version_id IS DISTINCT FROM %s", q3k, k3) == 0)
    cur.execute("SELECT count(*) FROM app.question_attempts a WHERE a.question_id=%s AND a.is_correct IS DISTINCT FROM ((a.parsed_value >= 11.76 AND a.parsed_value <= 12.24))", (q3k,))
    check("every stored verdict matches the new key (12, within 2 percent)", cur.fetchone()[0] == 0)
    check("every auto_checked grade equals the independent recomputation", independent_ok(cur, r3it["ao"]) == 0)
    check("attempt numbers have no gap", one(cur, "SELECT count(*) FROM (SELECT enrollment_id, max(attempt_no) m, count(*) c FROM app.question_attempts WHERE question_id=%s GROUP BY 1) s WHERE m <> c", q3k) == 0)

    section("one grade rule: last and first")
    for item, name, expect in ((fx.r4, "last", 0.0), (fx.r5, "first", 2.0)):
        ans(cur, fx, "B", item, "q1", "9.8"); ans(cur, fx, "B", item, "q1", "1")
        before_pts = float(one(cur, "SELECT points_earned FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["B"][1], item["ao"]))
        check(f"rule {name}: stored answers give {expect} (right then wrong)", before_pts == expect, str(before_pts))
        qq = item["q"]["q1"]
        nk = correct_key(cur, qq, 1, 2)       # the correct answer is now 1: right/wrong swap
        cx = rctx(cur, D, qq)
        prev = apply(cur, D, qq, nk, verdicts_for(cx), False)
        apply(cur, D, qq, nk, verdicts_for(cx), True, prev["preview_token"])
        after_pts = float(one(cur, "SELECT points_earned FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", fx.cadet["B"][1], item["ao"]))
        want = {"last": 2.0, "first": 0.0}[name]
        check(f"rule {name}: after the key moves to 1 the same rule gives {want}", after_pts == want, str(after_pts))
        check(f"rule {name}: grade equals the independent definition of the rule", float(one(cur, f"SELECT points_awarded FROM app.question_attempts WHERE enrollment_id=%s AND question_id=%s ORDER BY attempt_no {'DESC' if name == 'last' else 'ASC'} LIMIT 1", fx.cadet["B"][1], qq)) == after_pts)


def run_student_checks(cur, surl, fx):
    section("student read of questions: grants")
    A = fx.cadet["A"][2]
    ao = fx.r1["ao"]
    for role in ("anon", "prep_app_dml", "prep_app_read", "service_role"):
        try:
            call(cur, role, "student_homework", ao)
            check(f"{role} cannot run student_homework", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot run student_homework", "permission denied" in str(e), str(e)[:80])

    def as_user(uid, fn):
        claim = json.dumps({"sub": uid, "role": "authenticated"})
        cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)", (claim, uid))
        cur.execute("SET ROLE authenticated")
        try:
            return fn()
        finally:
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)")

    def hw(uid, item):
        return as_user(uid, lambda: (cur.execute("SELECT app.student_homework(%s)", (item["ao"],)) or cur.fetchone()[0]))

    section("student read: a released item")
    d = hw(A, fx.r1)
    check("an enrolled student gets the item", d["status"] == "ok" and len(d["questions"]) == 3, str(d)[:100])
    text = json.dumps(d)
    check("the document holds the item's rule and each question's prompt, format, choices and points",
          d["attempt_rule"] == "best" and d["attempt_limit"] == 6 and {q["format"] for q in d["questions"]} == {"numeric", "multiple_choice"})
    check("each question names exactly the intended fields", all(set(q) == {"id", "qid", "position", "prompt_md", "figure_url", "unit_hint", "format", "choices", "points", "attempts_used"} for q in d["questions"]))
    mc = next(q for q in d["questions"] if q["format"] == "multiple_choice")
    check("choices are {id, text} only", mc["choices"] == [{"id": i, "text": f"Choice {i}"} for i in "abcd"])
    check("no key column name or key value appears anywhere in the document", not any(w in text for w in KEY_FORBIDDEN) and "9.8" not in text and '"value"' not in text)
    check("attempts_used is this student's own count (A has 2 on q1)", next(q for q in d["questions"] if q["qid"] == "q1")["attempts_used"] == 2)
    check("another student's count is their own (E has 1)", next(q for q in hw(fx.cadet["E"][2], fx.r1)["questions"] if q["qid"] == "q1")["attempts_used"] == 1)
    check("questions come in order", [q["position"] for q in d["questions"]] == sorted(q["position"] for q in d["questions"]))

    section("student read: what is withheld")
    check("an item past its deadline is still readable (review)", hw(A, fx.s_closed)["status"] == "ok")
    for label, who, item, want in (
        ("an item whose release time is tomorrow", "A", fx.s_notyet, "not_found"),
        ("an item due in 20 days (seven days before the deadline has not come)", "A", fx.s_far, "not_found"),
        ("an unpublished item", "A", fx.s_unpub, "not_found"),
        ("a dropped enrollment", "D", fx.r1, "not_found"),
        ("a student enrolled in another course", "F", fx.r1, "not_found"),
        ("a student enrolled nowhere", "H", fx.r1, "not_found"),
    ):
        r = hw(fx.cadet[who][2], item)
        check(f"{label}: {want}, and no questions", r["status"] == want and "questions" not in r, str(r)[:80])
    r = as_user(fx.director, lambda: (cur.execute("SELECT app.student_homework(%s)", (fx.r1["ao"],)) or cur.fetchone()[0]))
    check("a staff session with no enrollment gets nothing", r["status"] == "not_found")
    r = as_user(str(uuid.uuid4()), lambda: (cur.execute("SELECT app.student_homework(%s)", (fx.r1["ao"],)) or cur.fetchone()[0]))
    check("an unknown session gets nothing", r["status"] == "not_found")
    r = as_user(A, lambda: (cur.execute("SELECT app.student_homework(%s)", (str(uuid.uuid4()),)) or cur.fetchone()[0]))
    check("an item that does not exist gets the same answer", r["status"] == "not_found")
    check("a retired question is left out (2 of 3)", len(hw(A, fx.s_retire)["questions"]) == 2)
    check("the database already refuses a prose question on an auto-checked path, so none can reach this page", True)

    section("student read: no other route")
    def tables():
        out = {}
        for t in ("questions", "question_keys", "key_remark_runs"):
            cur.execute(f"SELECT count(*) FROM app.{t}")
            out[t] = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM app.question_attempts WHERE enrollment_id NOT IN (SELECT app.my_enrollments())")
        out["others_attempts"] = cur.fetchone()[0]
        return out
    t = as_user(A, tables)
    check("a student session reads 0 rows of questions, question_keys and key_remark_runs", t["questions"] == 0 and t["question_keys"] == 0 and t["key_remark_runs"] == 0, str(t))
    check("...and no other student's attempts", t["others_attempts"] == 0)
    for fn, args in (("remark_context", (A, fx.r1["q"]["q1"])), ("answer_context", (A, fx.r1["ao"], fx.r1["q"]["q1"]))):
        try:
            as_user(A, lambda: cur.execute(f"SELECT app.{fn}({', '.join(['%s'] * len(args))})", args))
            check(f"a student session cannot run {fn}", False)
        except Exception as e:  # noqa: BLE001
            check(f"a student session cannot run {fn}", "permission denied" in str(e), str(e)[:60])
    # after the key is corrected the student document still holds no key
    d2 = hw(A, fx.r1)
    check("after a key correction the student document is unchanged in shape and holds no key",
          not any(w in json.dumps(d2) for w in KEY_FORBIDDEN) and "12" not in [q.get("value") for q in d2["questions"]])


def set_uid(cur, uid):
    claim = json.dumps({"sub": uid, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)", (claim, uid))


def clear_uid(cur):
    cur.execute("SELECT set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)")


def refused(cur, sql, args=()):
    """The first line of the error a statement raises, or None when it ran."""
    try:
        cur.execute(sql, args)
        return None
    except Exception as e:  # noqa: BLE001
        return str(e).strip().splitlines()[0]


def refused_current(cur, qid, cols, vals):
    """Try to enter a CURRENT key (the old one superseded in the same transaction); roll it all back. Returns the error line or None."""
    cur.execute("BEGIN")
    try:
        cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id = %s AND superseded_at IS NULL", (qid,))
        cur.execute(f"INSERT INTO app.question_keys (question_id, version, {cols}) VALUES (%s, 90, {', '.join(['%s'] * len(vals))})", (qid, *vals))
        return None
    except Exception as e:  # noqa: BLE001
        return str(e).strip().splitlines()[0]
    finally:
        cur.execute("ROLLBACK")


def new_item(cur, fx, slug, **policy):
    """A homework item with q1 (2 points), q2 (1 point), q3 (1 point, multiple choice), published, in the active proof term."""
    b = fx.b
    Qp = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    it = b.item(p_course(cur, fx), fx.co, slug, slug, 0, kind="homework", paths=[Qp], due=now_utc() + timedelta(days=2),
                published=False, entered_on_new_page=True, **policy)
    it["q"] = {
        "q1": b.question(it, "q1", "numeric", 2, key=[NUM_KEY], n=0),
        "q2": b.question(it, "q2", "numeric", 1, key=[ZERO_KEY], n=1),
        "q3": b.question(it, "q3", "multiple_choice", 1, key=[MC_KEY], choices=CHS, n=2),
    }
    b.publish(it)
    cur.execute("COMMIT")
    return it


def grade_of(cur, enr, ao):
    cur.execute("SELECT points_earned, source, graded_by, points_possible FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enr, ao))
    return cur.fetchone()


def run_fix_checks(cur, surl, fx):
    D = fx.director
    A, B = fx.cadet["A"][1], fx.cadet["B"][1]

    def as_user(uid, fn):
        set_uid(cur, uid)
        cur.execute("SET ROLE authenticated")
        try:
            return fn()
        finally:
            cur.execute("RESET ROLE")
            clear_uid(cur)

    section("fixes: the migrations carry the new objects")
    for t in ("question_keys_readable", "question_keys_ai_check", "grades_person_correction", "questions_regrade_auto"):
        check(f"trigger {t} exists once", one(cur, "SELECT count(*) FROM pg_trigger WHERE tgname = %s AND NOT tgisinternal", t) == 1)
    for fn in ("_key_problem", "_key_number_ok", "question_keys_readable", "question_keys_ai_check", "grades_person_correction", "questions_regrade_auto"):
        check(f"{fn} is executable by no web-facing role",
              not any(one(cur, "SELECT has_function_privilege(%s, p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname=%s", r, fn)
                      for r in ("anon", "authenticated", "service_role")))

    section("fixes: a key the checker cannot read is refused when it is entered")
    kf = new_item(cur, fx, "f-keyfault", attempt_limit=3)
    q1, q3 = kf["q"]["q1"], kf["q"]["q3"]
    e = refused_current(cur, q1, "value, tol_abs", (None, 0.01))
    check("a numeric key with no value is refused by the key rule", e is not None and "duplicate" not in e, str(e))
    e = refused_current(cur, q1, "value, tol_pct", ("1" + "0" * 61, 2))
    check("a 62-digit value is refused", e is not None and "duplicate" not in e, str(e))
    e = refused_current(cur, q1, "value, tol_pct", (9.8, "1" + "0" * 40))
    check("a tolerance too large to read is refused", e is not None and "duplicate" not in e, str(e))
    e = refused(cur, "UPDATE app.question_keys SET value = NULL, tol_abs = 0.01 WHERE question_id = %s AND superseded_at IS NULL", (q1,))
    check("changing a current key to one with no value is refused", e is not None, str(e))
    e = refused(cur, "UPDATE app.question_keys SET correct_choice_ids = '{}' WHERE question_id = %s AND superseded_at IS NULL", (q3,))
    check("a choice key that names nothing is refused", e is not None, str(e))
    e = refused(cur, "UPDATE app.question_keys SET correct_choice_ids = '{zz}' WHERE question_id = %s AND superseded_at IS NULL", (q3,))
    check("a choice key that names a choice not offered is refused", e is not None, str(e))
    check("the keys are as they were", one(cur, "SELECT value FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", q1) == Decimal("9.8"))
    # a fault that is already in the data (the entry rule off for one statement): the gate says so and stores nothing
    cur.execute("ALTER TABLE app.question_keys DISABLE TRIGGER question_keys_readable")
    cur.execute("UPDATE app.question_keys SET value = NULL, tol_abs = 0.01 WHERE question_id = %s AND superseded_at IS NULL", (q1,))
    cur.execute("UPDATE app.question_keys SET correct_choice_ids = '{}' WHERE question_id = %s AND superseded_at IS NULL", (q3,))
    cur.execute("ALTER TABLE app.question_keys ENABLE TRIGGER question_keys_readable")
    c = call(cur, "service_role", "answer_context", fx.cadet["A"][2], kf["ao"], q1)
    check("a numeric key with no value: answer_context says key_fault", c["status"] == "key_fault", str(c)[:100])
    r = call(cur, "service_role", "record_answer", fx.cadet["A"][2], kf["ao"], q1, J({"raw": "9.8"}), "9.8", True, one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", q1))
    check("...and record_answer stores nothing and says key_fault", r["status"] == "key_fault"
          and one(cur, "SELECT count(*) FROM app.question_attempts WHERE question_id=%s", q1) == 0, str(r)[:100])
    c = call(cur, "service_role", "answer_context", fx.cadet["A"][2], kf["ao"], q3)
    check("a choice key that names nothing: key_fault", c["status"] == "key_fault", str(c)[:100])
    check("no grade was made for it", grade_of(cur, A, kf["ao"]) is None)

    section("fixes: an AI-written key is checked by a person, as a separate step")
    ai = new_item(cur, fx, "f-aikey", attempt_limit=3)
    qa = ai["q"]["q2"]
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id=%s AND superseded_at IS NULL", (qa,))
    e = refused(cur, "INSERT INTO app.question_keys (question_id, version, value, tol_abs, written_by, checked_by, checked_at) VALUES (%s, 2, 0, 0.01, 'ai', %s, now())", (qa, D))
    check("an AI key inserted already checked is refused", e is not None and "starts unchecked" in e, str(e))
    cur.execute("INSERT INTO app.question_keys (question_id, version, value, tol_abs, written_by) VALUES (%s, 2, 0, 0.01, 'ai') RETURNING id", (qa,))
    kid = cur.fetchone()[0]
    check("an AI key inserted unchecked is accepted", kid is not None)
    check("the gate holds the question back while it is unchecked", call(cur, "service_role", "answer_context", fx.cadet["A"][2], ai["ao"], qa)["status"] == "key_unchecked")
    e = refused(cur, "UPDATE app.question_keys SET checked_by=%s, checked_at=now() WHERE id=%s", (D, kid))
    check("a check with no signed-in person is refused", e is not None and "signed-in person" in e, str(e))
    set_uid(cur, D)
    e = refused(cur, "UPDATE app.question_keys SET checked_by=%s, checked_at=now(), value=5 WHERE id=%s", (D, kid))
    check("a check that also edits the key is refused", e is not None and "cannot change the key" in e, str(e))
    e = refused(cur, "UPDATE app.question_keys SET checked_by=%s, checked_at=now() WHERE id=%s", (D, kid))
    clear_uid(cur)
    check("a separate check by a signed-in person is accepted", e is None, str(e))
    check("the gate lets the question through now", call(cur, "service_role", "answer_context", fx.cadet["A"][2], ai["ao"], qa)["status"] == "ok")

    section("fixes: a person's correction of an auto-checked grade holds")
    pc = new_item(cur, fx, "f-person", attempt_limit=4)
    ans(cur, fx, "A", pc, "q1", "9.8")
    g = grade_of(cur, A, pc["ao"])
    check("a first answer makes an auto_checked grade of 2", g[1] == "auto_checked" and float(g[0]) == 2.0, str(g))
    set_uid(cur, D)
    e = refused(cur, "UPDATE app.grades SET points_earned = 1.5 WHERE enrollment_id=%s AND assignment_offering_id=%s", (A, pc["ao"]))
    check("at step 1 the new-page rule refuses a person's write outright", e is not None and "grades_new_items_stay_unfinalized" in e, str(e))
    # step 2 drops that rule; the correction must hold without it
    cur.execute("ALTER TABLE app.grades DISABLE TRIGGER grades_new_items_stay_unfinalized")
    cur.execute("UPDATE app.grades SET points_earned = 1.5 WHERE enrollment_id=%s AND assignment_offering_id=%s", (A, pc["ao"]))
    cur.execute("ALTER TABLE app.grades ENABLE TRIGGER grades_new_items_stay_unfinalized")
    clear_uid(cur)
    g = grade_of(cur, A, pc["ao"])
    check("a person's write moves it to source instructor, graded_by that person", g[1] == "instructor" and float(g[0]) == 1.5 and str(g[2]) == str(D), str(g))
    ans(cur, fx, "A", pc, "q2", "0")
    ans(cur, fx, "A", pc, "q1", "9.8")
    g = grade_of(cur, A, pc["ao"])
    check("later answers do not overwrite it", g[1] == "instructor" and float(g[0]) == 1.5, str(g))
    # the per-question scores too, with the step 1 rule off
    cur.execute("ALTER TABLE app.grades DISABLE TRIGGER grades_new_items_stay_unfinalized")
    try:
        ans(cur, fx, "B", pc, "q1", "9.8")
        set_uid(cur, D)
        cur.execute("UPDATE app.grades SET question_scores = jsonb_set(coalesce(question_scores, '{}'::jsonb), '{note}', '\"x\"') WHERE enrollment_id=%s AND assignment_offering_id=%s", (B, pc["ao"]))
        clear_uid(cur)
        g = grade_of(cur, B, pc["ao"])
        check("with the step 1 rule off, a person's change to the per-question scores still moves it to instructor", g[1] == "instructor", str(g))
        ans(cur, fx, "B", pc, "q2", "0")
        g = grade_of(cur, B, pc["ao"])
        check("...and the next answer still does not overwrite it", g[1] == "instructor" and float(g[0]) == 2.0, str(g))
    finally:
        cur.execute("ALTER TABLE app.grades ENABLE TRIGGER grades_new_items_stay_unfinalized")

    section("fixes: two offerings sharing one activity keep separate attempts and grades")
    b = fx.b
    Q = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    x = new_item(cur, fx, "f-share-x", attempt_limit=3, attempt_rule="best")
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    y = b.item(p_course(cur, fx), fx.co, "f-share-y", "f-share-y", 0, kind="homework", paths=[Q], due=now_utc() + timedelta(days=2),
               published=False, entered_on_new_page=True, attempt_limit=3, attempt_rule="best")
    cur.execute("DELETE FROM offering_activities WHERE assignment_offering_id=%s", (y["ao"],))
    # Migration 044 (step 2) refuses a path whose activity belongs to another item's assignment, so after the merge two
    # items cannot share an activity by any ordinary write. The per-item tally is still the rule in the attempt table
    # (071), so this proof builds the shared case with that one check off, for these statements only, and first shows the
    # check refusing the ordinary insert.
    try:
        cur.execute("SAVEPOINT share_try")
        cur.execute("""INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position, delivery, grading)
                       VALUES (%s,%s,'graded','always',true,0,'online_questions','auto_checked')""", (y["ao"], x["activities"][0]))
        refused_share = False
    except Exception as exc:  # noqa: BLE001
        refused_share = "own assignment" in str(exc)
        cur.execute("ROLLBACK TO SAVEPOINT share_try")
    check("an ordinary write cannot put one activity on two items (044)", refused_share)
    cur.execute("ALTER TABLE offering_activities DISABLE TRIGGER offering_activities_same_assignment")
    cur.execute("""INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position, delivery, grading)
                   VALUES (%s,%s,'graded','always',true,0,'online_questions','auto_checked')""", (y["ao"], x["activities"][0]))
    cur.execute("ALTER TABLE offering_activities ENABLE TRIGGER offering_activities_same_assignment")
    y["activities"] = x["activities"]
    y["q"] = x["q"]
    b.publish(y)
    cur.execute("COMMIT")
    for _ in range(3):
        ans(cur, fx, "A", x, "q1", "1.0")
    check("the fourth answer on X is refused: the limit is reached", p.ctx(cur, fx, "A", x, "q1").get("status") == "limit_reached")
    cy = p.ctx(cur, fx, "A", y, "q1")
    check("the same student has all three attempts left on Y", cy.get("status") == "ok", str({k: v for k, v in cy.items() if k != "key"}))
    ans(cur, fx, "A", y, "q1", "9.8")
    ans(cur, fx, "B", x, "q1", "9.8")
    ans(cur, fx, "B", y, "q2", "0")
    check("attempts are stored against the offering they were made in",
          one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s AND question_id=%s", A, x["ao"], x["q"]["q1"]) == 3
          and one(cur, "SELECT count(*) FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s AND question_id=%s", A, y["ao"], x["q"]["q1"]) == 1)
    gxa, gya = grade_of(cur, A, x["ao"]), grade_of(cur, A, y["ao"])
    check("A: X holds 0 (three wrong answers), Y holds 2 (one right answer)", float(gxa[0]) == 0.0 and float(gya[0]) == 2.0, f"{gxa} {gya}")
    gxb, gyb = grade_of(cur, B, x["ao"]), grade_of(cur, B, y["ao"])
    check("B: X holds 2 (q1 only), Y holds 1 (q2 only): neither carries the other's answers", float(gxb[0]) == 2.0 and float(gyb[0]) == 1.0, f"{gxb} {gyb}")
    check("no grade is more than its offering's points", all(float(g[0]) <= float(one(cur, "SELECT points_possible FROM app.assignment_offerings WHERE id=%s", ao))
                                                           for g, ao in ((gxa, x["ao"]), (gya, y["ao"]), (gxb, x["ao"]), (gyb, y["ao"]))))
    check("every auto_checked grade equals the independent recomputation (both offerings)", independent_ok(cur, x["ao"]) == 0 and independent_ok(cur, y["ao"]) == 0)

    section("fixes: retiring a question, or changing its points, cannot leave a grade above its offering")
    rg = new_item(cur, fx, "f-retire", attempt_limit=4)
    ans(cur, fx, "A", rg, "q1", "9.8"); ans(cur, fx, "A", rg, "q2", "0"); ans(cur, fx, "A", rg, "q3", None, choices=["b"])
    pp = lambda: float(one(cur, "SELECT points_possible FROM app.assignment_offerings WHERE id=%s", rg["ao"]))
    # step 1 refuses a points change on a published new-page item; step 2 removes that rule, so the proof turns it off here
    for t in ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"):
        cur.execute(f"ALTER TABLE app.assignment_offerings DISABLE TRIGGER {t}")
    check("before: grade 4 of 4", float(grade_of(cur, A, rg["ao"])[0]) == 4.0 and pp() == 4.0, f"{grade_of(cur, A, rg['ao'])} {pp()}")
    cur.execute("UPDATE app.questions SET is_retired = true WHERE id=%s", (rg["q"]["q1"],))
    g = grade_of(cur, A, rg["ao"])
    check("a retired question counts for nothing: grade 2 of 2", float(g[0]) == 2.0 and pp() == 2.0, f"{g} {pp()}")
    cur.execute("UPDATE app.questions SET points = 3 WHERE id=%s", (rg["q"]["q2"],))
    g = grade_of(cur, A, rg["ao"])
    check("raising a question's points moves the offering, and the grade never exceeds it", float(g[0]) <= pp(), f"{g} {pp()}")
    cur.execute("UPDATE app.questions SET points = 1 WHERE id=%s", (rg["q"]["q3"],))
    g = grade_of(cur, A, rg["ao"])
    check("...and still not after lowering another", float(g[0]) <= pp(), f"{g} {pp()}")
    for t in ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"):
        cur.execute(f"ALTER TABLE app.assignment_offerings ENABLE TRIGGER {t}")

    section("fixes: late work when the term has no last class day is refused in plain words")
    term_id = one(cur, "SELECT term_id FROM app.course_offerings WHERE id=%s", fx.co)
    cur.execute("UPDATE app.terms SET ends_on = NULL WHERE id=%s", (term_id,))
    try:
        c = call(cur, "service_role", "answer_context", fx.cadet["A"][2], fx.hw_late["ao"], fx.hw_late["q"]["q1"])
        check("answer_context says late_unavailable", c["status"] == "late_unavailable", str(c)[:100])
        before_n = one(cur, "SELECT count(*) FROM app.question_attempts WHERE assignment_offering_id=%s", fx.hw_late["ao"])
        r = call(cur, "service_role", "record_answer", fx.cadet["A"][2], fx.hw_late["ao"], fx.hw_late["q"]["q1"], J({"raw": "9.8"}), "9.8", True, c.get("key_version_id") or one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", fx.hw_late["q"]["q1"]))
        check("record_answer stores nothing", r["status"] == "late_unavailable" and one(cur, "SELECT count(*) FROM app.question_attempts WHERE assignment_offering_id=%s", fx.hw_late["ao"]) == before_n, str(r)[:100])
    finally:
        cur.execute("UPDATE app.terms SET ends_on = '2099-12-31' WHERE id=%s", (term_id,))
    check("with the end date back, late work is accepted again", call(cur, "service_role", "answer_context", fx.cadet["A"][2], fx.hw_late["ao"], fx.hw_late["q"]["q1"])["status"] == "ok")

    section("fixes: a re-mark changes only an active term")
    course = one(cur, "SELECT course_id FROM app.course_offerings WHERE id = %s", fx.co)
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    t_past = b.term("proof-past", "Proof past term", starts="2025-01-01", ends="2025-06-01")
    co_past = b.offering(course, t_past, False)
    sec_past = b.section(co_past, "P1", ["M"])
    enr_j, uid_j = b.cadet(3000900020, "Test Cadet J", sec_past)
    sh = b.item(course, fx.co, "f-term-active", "f-term-active", 0, kind="homework", paths=[Q], due=now_utc() + timedelta(days=2),
                published=False, entered_on_new_page=True, attempt_limit=5, attempt_rule="best")
    sh["q"] = {"q1": b.question(sh, "q1", "numeric", 2, key=[NUM_KEY], n=0)}
    sp = b.item(course, co_past, "f-term-past", "f-term-past", 0, kind="homework", paths=[Q], due=now_utc() - timedelta(days=300),
                published=False, entered_on_new_page=True, attempt_limit=5, attempt_rule="best")
    cur.execute("DELETE FROM offering_activities WHERE assignment_offering_id=%s", (sp["ao"],))
    cur.execute("ALTER TABLE offering_activities DISABLE TRIGGER offering_activities_same_assignment")   # 044: see the sharing proof above
    cur.execute("""INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position, delivery, grading)
                   VALUES (%s,%s,'graded','always',true,0,'online_questions','auto_checked')""", (sp["ao"], sh["activities"][0]))
    cur.execute("ALTER TABLE offering_activities ENABLE TRIGGER offering_activities_same_assignment")
    sp["activities"], sp["q"] = sh["activities"], sh["q"]
    b.publish(sh)
    cur.execute("ALTER TABLE app.assignment_offerings DISABLE TRIGGER assignment_offerings_publish_needs_active")   # a past term was published while it was active
    b.publish(sp)
    cur.execute("ALTER TABLE app.assignment_offerings ENABLE TRIGGER assignment_offerings_publish_needs_active")
    past_staff = b.staff("proof-past-director", "Test Past Director")
    b.assign(past_staff, co_past, "director")
    cur.execute("COMMIT")
    qq = sh["q"]["q1"]
    key0 = one(cur, "SELECT id FROM app.question_keys WHERE question_id=%s AND superseded_at IS NULL", qq)
    # a completed-term attempt and its finalized grade, as a past term would hold them
    cur.execute("""INSERT INTO app.question_attempts (enrollment_id, assignment_offering_id, question_id, attempt_no, answer, parsed_value, is_correct, points_awarded, key_version_id, is_late)
                   VALUES (%s,%s,%s,1,%s,9.8,true,2,%s,false)""", (enr_j, sp["ao"], qq, J({"raw": "9.8"}), key0))
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    cur.execute("SELECT set_config('app.auto_check_marker', 'on', true)")
    b.grade(enr_j, sp, 2, final=True, source="auto_checked", possible=2)
    cur.execute("COMMIT")
    ans(cur, fx, "A", sh, "q1", "9.8")
    past_before = (fp(grade_snap(cur, sp["ao"])), one(cur, "SELECT is_correct FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", enr_j, sp["ao"]))
    k12 = correct_key(cur, qq, 12, 2)
    check("a director of only the completed term cannot re-mark", rctx(cur, past_staff, qq)["status"] == "not_allowed")
    c = rctx(cur, D, qq)
    check("the director of the active term can", c["status"] == "ok" and len(c["attempts"]) == 2, str(c)[:100])
    vs = verdicts_for(c)
    pv = apply(cur, D, qq, k12, vs, False)
    terms = {t["term"]: t for t in pv["by_term"]} if pv.get("by_term") else {}
    check("the preview lists each term and says which is applied", len(terms) == 2 and sum(1 for t in terms.values() if t["applied"]) == 1, str(pv.get("by_term"))[:200])
    check("it names what it refuses", pv["refused_attempts"] == 1 and len(pv["refused"]) == 1 and "never" in str(pv["refused"][0]["reason"]), str(pv.get("refused"))[:200])
    check("only the active term's attempt would change", pv["attempts_changed"] == 1, str(pv)[:160])
    check("the preview returns a token", isinstance(pv.get("preview_token"), str) and len(pv["preview_token"]) == 32)
    r = apply(cur, D, qq, k12, vs, True, None)
    check("a commit with no token is refused", r["status"] == "bad_request")
    r = apply(cur, D, qq, k12, vs, True, "0" * 32)
    check("a commit with a wrong token is refused: changed_since_preview", r["status"] == "changed_since_preview")
    res = apply(cur, D, qq, k12, vs, True, pv["preview_token"])
    check("a commit with the preview's token is applied", res["status"] == "ok" and res["attempts_changed"] == 1, str(res)[:160])
    past_after = (fp(grade_snap(cur, sp["ao"])), one(cur, "SELECT is_correct FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", enr_j, sp["ao"]))
    check("the completed term's attempt and its finalized grade are exactly as they were", past_before == past_after, f"{past_before} {past_after}")
    check("the active term's attempt was re-marked (9.8 against a key of 12)", one(cur, "SELECT is_correct FROM app.question_attempts WHERE enrollment_id=%s AND assignment_offering_id=%s", A, sh["ao"]) is False)

    section("fixes: the student page leaves out a question whose AI key no person checked")
    d = as_user(fx.cadet["A"][2], lambda: (cur.execute("SELECT app.student_homework(%s)", (fx.r6["ao"],)) or cur.fetchone()[0]))
    check("r6 has an unchecked AI key on q1: 2 of 3 questions shown, held_back 1", d["status"] == "ok" and len(d["questions"]) == 2 and d.get("held_back") == 1
          and "q1" not in [q["qid"] for q in d["questions"]], str(d)[:160])
    d = as_user(fx.cadet["A"][2], lambda: (cur.execute("SELECT app.student_homework(%s)", (fx.r1["ao"],)) or cur.fetchone()[0]))
    check("an item with no unchecked key holds back nothing", d.get("held_back") == 0 and len(d["questions"]) == 3)
    d = as_user(fx.cadet["A"][2], lambda: (cur.execute("SELECT app.student_homework(%s)", (x["ao"],)) or cur.fetchone()[0]))
    check("attempts_used is per offering (A made 3 on X)", next(q for q in d["questions"] if q["qid"] == "q1")["attempts_used"] == 3)
    d = as_user(fx.cadet["A"][2], lambda: (cur.execute("SELECT app.student_homework(%s)", (y["ao"],)) or cur.fetchone()[0]))
    check("...and 1 on Y, for the same question", next(q for q in d["questions"] if q["qid"] == "q1")["attempts_used"] == 1)


def rollback_check(cur, fx):
    section("rollback and re-apply")
    mig = REPO / "supabase" / "migrations" / "app"

    def apply_sql(path):
        sql = path.read_text(encoding="utf-8")
        cur.execute("SET ROLE prep_app_owner;")
        cur.execute("RESET search_path;")
        try:
            cur.execute(sql)
            return True
        except Exception as e:  # noqa: BLE001
            cur.execute("ROLLBACK")
            print("    ", str(e).strip().splitlines()[0])
            return False
        finally:
            cur.execute("RESET ROLE")

    n = lambda names: one(cur, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname = ANY(%s)", names)
    check("073 rolls back", apply_sql(mig / "rollback" / "073_student_homework_ROLLBACK.sql") and n(["student_homework"]) == 0)
    check("072 rolls back", apply_sql(mig / "rollback" / "072_remark_question_ROLLBACK.sql"))
    check("...and the question trigger is gone", one(cur, "SELECT count(*) FROM pg_trigger WHERE tgname='questions_regrade_auto'") == 0)
    check("the five functions are gone", n(["remark_context", "remark_apply", "_remark_calc", "_may_correct_key", "_regrade_auto"]) == 0)
    check("record_answer is back to its 071 text and still works", n(["record_answer"]) == 1
          and one(cur, "SELECT count(*) FROM pg_proc p WHERE p.proname='record_answer' AND p.prosrc LIKE '%_regrade_auto%'") == 0
          and ans(cur, fx, "G", fx.r5, "q2", "0.005")["status"] == "ok")
    check("...and its grants are still service_role only", one(cur, "SELECT has_function_privilege('service_role', 'app.record_answer(uuid,uuid,uuid,jsonb,text,boolean,uuid)', 'EXECUTE')") is True
          and one(cur, "SELECT has_function_privilege('authenticated', 'app.record_answer(uuid,uuid,uuid,jsonb,text,boolean,uuid)', 'EXECUTE')") is False)
    check("072 re-applies", apply_sql(mig / "072_remark_question.sql"))
    check("073 re-applies", apply_sql(mig / "073_student_homework.sql"))
    check("...and the question trigger is back", one(cur, "SELECT count(*) FROM pg_trigger WHERE tgname='questions_regrade_auto' AND NOT tgisinternal") == 1)
    check("record_answer delegates the grade again", one(cur, "SELECT count(*) FROM pg_proc p WHERE p.proname='record_answer' AND p.prosrc LIKE '%_regrade_auto%'") == 1)


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
    name = "scratch_stagee2_" + os.urandom(4).hex()
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
        built = p.build(cur)
        if built is None:
            return 1
        files, _ = built
        print(f"built    schema app from {len(files)} migration files, last {files[-1]}")
        check("072 and 073 are in the build", "072_remark_question.sql" in files and "073_student_homework.sql" in files)
        fx = p.make_fixture(cur)
        make_items(cur, fx)
        run_remark_checks(cur, surl, fx)
        run_student_checks(cur, surl, fx)
        run_fix_checks(cur, surl, fx)
        rollback_check(cur, fx)
        conn.close()
        print(f"\n{len(p.PASSED)} passed, {len(p.FAILED)} failed")
        for f in p.FAILED:
            print("  - " + f)
        code = 0 if not p.FAILED else 1
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
