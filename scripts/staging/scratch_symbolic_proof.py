#!/usr/bin/env python3
"""Prove migration app/085 (symbolic answers) on a THROWAWAY database on the staging server.

The database is built the way scratch_stage_e_proof.py builds it (the whole chain through 079), an invented fixture is
loaded, 085 is applied, the checks run as the roles the real system uses, and the database is dropped whatever happened.
Nothing in the staging database itself is read or written.

CHECKS (each prints [pass] or [FAIL])
  applies       085 applies on the full chain; a symbolic question and key can be stored
  signed        the variables that may be negative (signed_variables): stored with the key, a subset of the variables only,
                handed to service_role with the expression, written by save_question, refused on a non-symbolic key, and
                the symbolic trigger function is callable by no API role
  key rules     an expression with a bad character, unbalanced brackets, no variables, a variable named like a function,
                a duplicate, nine variables, a bad name, an empty expression: all refused. A key that is not symbolic may not
                carry an expression or variables
  edits         changing the expression of a current key is checked again; a person's check of an AI-written key cannot
                also change the expression
  answers       answer_context hands the expression and variables to service_role only; record_answer stores {"raw": ...} with
                no parsed number; the grade follows; a numeric question is unchanged (expression null)
  student read  student_homework returns the variable NAMES of a symbolic question and never the expression, in any form
  save          save_question writes a new key version with the expression and variables, and refuses a variables value that
                is not a list
  remark        remark_context hands the expression and variables to service_role only
  rollback      refuses while a symbolic question exists; with none, rolls back cleanly and re-applies

WHAT THIS CANNOT PROVE
  The edge function (the checker is JavaScript; tests/app-schema/test-symbolic-answer.mjs and the two function suites cover
  it against models), Supabase Auth, and the browser. The verdicts stored here are chosen by the proof.

SAFETY  Staging project only (db_target.py refuses anything else). It drops only the database it created. Never prints a
password or the connection string. All people in the fixture are invented.

Usage:  python scripts/staging/scratch_symbolic_proof.py --expect-ref <staging_ref>
Exit 0 only when every check passed.
"""
import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
import scratch_stage_e_proof as p  # noqa: E402
from scratch_stage_e_proof import J, call, check, connect, now_utc, one, section  # noqa: E402

MIG = REPO / "supabase" / "migrations" / "app"


def apply(cur, path):
    sql = path.read_text(encoding="utf-8")
    body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
    cur.execute("SET ROLE prep_app_owner;")
    cur.execute("RESET search_path;")
    try:
        cur.execute(body)
        return True, ""
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        return False, str(e).strip().splitlines()[0]
    finally:
        cur.execute("RESET ROLE")
        cur.execute("SET search_path = app, public, extensions")


def refused(cur, sql, params=(), want=None):
    """Run one statement as the owner of the data in a transaction that is rolled back. True when it was refused."""
    cur.execute("BEGIN")
    try:
        cur.execute(sql, params)
        cur.execute("ROLLBACK")
        return False, "accepted"
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        msg = str(e).strip().splitlines()[0]
        return (want is None or want in msg), msg


def accepted(cur, sql, params=()):
    cur.execute("BEGIN")
    try:
        cur.execute(sql, params)
        cur.execute("ROLLBACK")
        return True, ""
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        return False, str(e).strip().splitlines()[0]


def make_items(cur, fx):
    b = fx.b
    Q = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    future = now_utc() + timedelta(days=2)
    cur.execute("BEGIN")
    cur.execute("SET LOCAL search_path = app, public, extensions")
    b.assign(fx.director, fx.co, "director")
    course = one(cur, "SELECT course_id FROM course_offerings WHERE id = %s", fx.co)
    it = b.item(course, fx.co, "sym-main", "sym-main", 0, kind="homework", paths=[Q], due=future, published=False,
                entered_on_new_page=True, attempt_limit=5, attempt_rule="best")
    it["q"] = {
        "s1": b.question(it, "s1", "symbolic", 2, key=[{"expression": "m*v^2/2", "variables": ["m", "v"], "signed_variables": ["v"]}], n=0,
                         prompt="Kinetic energy, in terms of m and v?"),
        "n1": b.question(it, "n1", "numeric", 1, key=[{"value": 9.8, "tol_pct": 2}], n=1),
    }
    b.publish(it)
    fx.sym = it
    cur.execute("COMMIT")


def run_checks(cur, fx):
    mig = MIG / "085_symbolic_answers.sql"
    section("applies")
    ok, why = apply(cur, mig)
    check("085 applies on the whole chain", ok, why)
    if not ok:
        return
    make_items(cur, fx)
    s1, n1 = fx.sym["q"]["s1"], fx.sym["q"]["n1"]
    check("a symbolic question and its key were stored", one(cur, "SELECT count(*) FROM question_keys WHERE question_id = %s AND expression IS NOT NULL", s1) == 1)

    section("signed")
    check("the key stored the variable that may be negative", one(cur, "SELECT array_to_string(signed_variables, ',') FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", s1) == "v")
    ins_signed = ("INSERT INTO app.question_keys (question_id, variant_key, version, expression, variables, signed_variables) VALUES (%s, 'sg', 1, 'm*v', ARRAY['m','v'], %s)")
    check("a signed variable that is not one of the variables is refused", refused(cur, ins_signed, (s1, ["q"]))[0])
    check("a signed variable listed among the variables is accepted", accepted(cur, ins_signed, (s1, ["m", "v"]))[0])
    check("an empty signed list is accepted", accepted(cur, ins_signed, (s1, []))[0])
    check("nine signed variables are refused", refused(cur, ins_signed, (s1, list("abcdefghi")))[0])
    check("a numeric key may not carry signed variables",
          refused(cur, "INSERT INTO app.question_keys (question_id, variant_key, version, value, signed_variables) VALUES (%s, 'sg', 1, 3, ARRAY['m'])", (n1,), "only a symbolic")[0])
    for role in ("authenticated", "anon", "service_role", "prep_app_dml", "prep_app_read"):
        cur.execute("BEGIN")
        try:
            cur.execute(f"SET LOCAL ROLE {role}")
            cur.execute("SELECT app.question_keys_check_symbolic()")
            check(f"{role} cannot execute the symbolic trigger function", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot execute the symbolic trigger function", "permission denied" in str(e), str(e).strip().splitlines()[0][:70])
        cur.execute("ROLLBACK")

    section("key rules")
    ins_key = ("INSERT INTO app.question_keys (question_id, variant_key, version, expression, variables) VALUES (%s, 'v', 1, %s, %s)")
    for label, expr, vs in [
        ("a bad character", "m;v", ["m", "v"]), ("a script-looking text", "m*v + require('fs')", ["m", "v"]),
        ("unbalanced brackets", "(m*v", ["m", "v"]), ("a closing bracket first", "m*v)(", ["m", "v"]),
        ("an empty expression", "   ", ["m"]), ("no variables", "m", []), ("a null variable list", "m", None),
        ("a variable named like a function", "m", ["sin"]), ("a variable named e", "m", ["e"]), ("a variable named pi", "m", ["pi"]),
        ("a duplicate variable", "m", ["m", "m"]), ("nine variables", "a", list("abcdefghi")),
        ("a variable name with a space", "m", ["a b"]), ("a variable name starting with a digit", "m", ["1m"]),
        ("a variable name that is too long", "m", ["a" * 13]), ("a variable named constructor", "m", ["constructor"]),
        ("an expression over 200 characters", "m+" * 101, ["m"]),
    ]:
        # a current key already exists for variant '' ; use a fresh variant so only the readability rule is tested
        r, msg = refused(cur, ins_key, (s1, expr, vs))
        check(f"refused: {label}", r, msg)
    check("a good key with Greek letters and an exponent in superscript form is accepted",
          accepted(cur, ins_key, (s1, "θ*v² + 2·m", ["θ", "v", "m"]))[0])
    check("a numeric question may not carry an expression", refused(cur, ins_key, (n1, "m", ["m"]), "only a symbolic")[0])
    check("a numeric key without an expression is still accepted",
          accepted(cur, "INSERT INTO app.question_keys (question_id, variant_key, version, value, tol_pct) VALUES (%s, 'v', 1, 3, 1)", (n1,))[0])
    check("the old formats are still the only others", refused(cur, "UPDATE app.questions SET format = 'vector' WHERE id = %s", (s1,))[0])

    section("edits")
    cur.execute("BEGIN")
    r1, m1 = refused(cur, "UPDATE app.question_keys SET expression = 'm;v' WHERE question_id = %s AND superseded_at IS NULL", (s1,))
    check("changing the current expression to an unreadable one is refused", r1, m1)
    check("changing it to a readable one is accepted", accepted(cur, "UPDATE app.question_keys SET expression = 'm*v*v/2' WHERE question_id = %s AND superseded_at IS NULL", (s1,))[0])
    check("clearing the variables of a current key is refused", refused(cur, "UPDATE app.question_keys SET variables = NULL WHERE question_id = %s AND superseded_at IS NULL", (s1,))[0])
    cur.execute("ROLLBACK")
    # an AI-written key
    cur.execute("BEGIN")
    cur.execute("INSERT INTO app.question_keys (question_id, variant_key, version, expression, variables, written_by) VALUES (%s, 'ai', 1, 'm', ARRAY['m'], 'ai')", (s1,))
    cur.execute("SAVEPOINT a")
    try:
        cur.execute("UPDATE app.question_keys SET checked_at = now(), checked_by = %s, expression = 'm+1' WHERE question_id = %s AND variant_key = 'ai'", (fx.director, s1))
        check("a check of an AI-written key that also changes the expression is refused", False)
    except Exception as e:  # noqa: BLE001
        check("a check of an AI-written key that also changes the expression is refused", True, str(e)[:60])
    cur.execute("ROLLBACK")

    section("answers")
    A = fx.cadet["A"][2]
    c = call(cur, "service_role", "answer_context", A, fx.sym["ao"], s1)
    check("answer_context hands over the format, expression and variables", c.get("status") == "ok" and c.get("format") == "symbolic"
          and c["key"].get("expression") == "m*v^2/2" and c["key"].get("variables") == ["m", "v"]
          and c["key"].get("signed_variables") == ["v"], str(c)[:140])
    for role in ("authenticated", "anon", "prep_app_dml", "prep_app_read"):
        try:
            call(cur, role, "answer_context", A, fx.sym["ao"], s1)
            check(f"{role} cannot run answer_context", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot run answer_context", "permission denied" in str(e), str(e)[:60])
    r = call(cur, "service_role", "record_answer", A, fx.sym["ao"], s1, J({"raw": "0.5 m v^2"}), None, True, c["key_version_id"])
    check("record_answer stores a symbolic answer with no parsed number", r.get("status") == "ok" and r.get("correct") is True, str(r))
    row = one(cur, "SELECT answer ->> 'raw' || '|' || coalesce(parsed_value::text, 'null') || '|' || is_correct::text FROM question_attempts WHERE question_id = %s", s1)
    check("the stored row is the raw text, null, true", row == "0.5 m v^2|null|true", row)
    check("the grade follows the stored attempts", one(cur, "SELECT points_earned FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", fx.cadet["A"][1], fx.sym["ao"]) == 2)
    cn = call(cur, "service_role", "answer_context", A, fx.sym["ao"], n1)
    check("a numeric question is unchanged: format numeric, no expression, value as before", cn["format"] == "numeric" and cn["key"].get("expression") is None and cn["key"]["value"] == "9.8", str(cn)[:140])

    section("student read")
    claim = json.dumps({"sub": A, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)", (claim, A))
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT app.student_homework(%s)", (fx.sym["ao"],))
    hw = cur.fetchone()[0]
    cur.execute("RESET ROLE")
    qs = {q["qid"]: q for q in hw.get("questions", [])}
    check("the student sees the symbolic question with its variable names", qs.get("s1", {}).get("format") == "symbolic" and qs["s1"].get("variables") == ["m", "v"], str(qs.get("s1"))[:160])
    check("the student sees no expression anywhere in the reply", "v^2" not in json.dumps(hw) and "expression" not in json.dumps(hw), json.dumps(hw)[:200])
    check("a numeric question has variables null", qs.get("n1", {}).get("variables", "missing") is None)

    section("save")
    upd = one(cur, "SELECT updated_at FROM questions WHERE id = %s", s1)
    cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)",
                (json.dumps({"sub": fx.director, "role": "authenticated"}), fx.director))
    cur.execute("SET ROLE authenticated")
    cols = J({"prompt_md": "Kinetic energy?", "points": 2, "choices": None, "unit_hint": None})
    try:
        cur.execute("SELECT * FROM app.save_question(%s, %s, %s, true, %s, 1)", (s1, upd, cols, J({"expression": "m*v*v/2", "variables": ["m", "v"], "signed_variables": ["m"]})))
        res = cur.fetchone()
        check("save_question writes a new key version", res is not None and res[0] == 2 and res[1] is True, str(res))
    except Exception as e:  # noqa: BLE001
        check("save_question writes a new key version", False, str(e)[:120])
    cur.execute("RESET ROLE")
    check("the new version carries the expression and variables", one(cur, "SELECT expression || '|' || array_to_string(variables, ',') FROM question_keys WHERE question_id = %s AND superseded_at IS NULL AND variant_key = ''", s1) == "m*v*v/2|m,v")
    check("the new version carries the signed variable", one(cur, "SELECT array_to_string(signed_variables, ',') FROM question_keys WHERE question_id = %s AND superseded_at IS NULL AND variant_key = ''", s1) == "m")
    upd = one(cur, "SELECT updated_at FROM questions WHERE id = %s", s1)
    cur.execute("SET ROLE authenticated")
    for label, key in [("variables that are not a list", {"expression": "m", "variables": "m"}), ("an expression that is not text", {"expression": 5, "variables": ["m"]}),
                       ("a variable that is not text", {"expression": "m", "variables": [1]}),
                       ("signed variables that are not a list", {"expression": "m", "variables": ["m"], "signed_variables": "m"}),
                       ("a signed variable that is not text", {"expression": "m", "variables": ["m"], "signed_variables": [1]}),
                       ("a signed variable that is not a variable", {"expression": "m", "variables": ["m"], "signed_variables": ["z"]}), ("an unreadable expression", {"expression": "m;", "variables": ["m"]})]:
        cur.execute("BEGIN")
        try:
            cur.execute("SELECT * FROM app.save_question(%s, %s, %s, true, %s, 2)", (s1, upd, cols, J(key)))
            check(f"save_question refuses {label}", False)
        except Exception as e:  # noqa: BLE001
            check(f"save_question refuses {label}", True, str(e)[:60])
        cur.execute("ROLLBACK")
    cur.execute("RESET ROLE")

    section("remark")
    rc = call(cur, "service_role", "remark_context", fx.director, s1)
    check("remark_context hands the expression and variables to service_role", rc.get("status") == "ok" and rc["key"].get("expression") == "m*v*v/2" and rc["key"].get("variables") == ["m", "v"]
          and rc["key"].get("signed_variables") == ["m"], str(rc)[:140])
    for role in ("authenticated", "anon"):
        try:
            call(cur, role, "remark_context", fx.director, s1)
            check(f"{role} cannot run remark_context", False)
        except Exception as e:  # noqa: BLE001
            check(f"{role} cannot run remark_context", "permission denied" in str(e), str(e)[:60])

    section("rollback")
    ok, why = apply(cur, MIG / "rollback" / "085_symbolic_answers_ROLLBACK.sql")
    check("rollback is refused while a symbolic question exists", not ok and "symbolic question" in why, why)
    cur.execute("BEGIN")
    cur.execute("SET LOCAL session_replication_role = replica")
    cur.execute("DELETE FROM question_attempts WHERE question_id = %s", (s1,))
    cur.execute("DELETE FROM questions WHERE id = %s", (s1,))
    cur.execute("COMMIT")
    ok, why = apply(cur, MIG / "rollback" / "085_symbolic_answers_ROLLBACK.sql")
    check("rollback applies once none exists", ok, why)
    check("the columns and the symbolic format are gone", one(cur, "SELECT count(*) FROM information_schema.columns WHERE table_schema='app' AND table_name='question_keys' AND column_name IN ('expression','variables','signed_variables')") == 0
          and "symbolic" not in one(cur, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'questions_format_ck'"))
    check("a numeric answer_context still works after the rollback", call(cur, "service_role", "answer_context", A, fx.sym["ao"], n1).get("status") == "ok")
    ok, why = apply(cur, mig)
    check("085 re-applies", ok, why)


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
    name = "scratch_symbolic_" + os.urandom(4).hex()
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
        fx = p.make_fixture(cur)
        cur.execute("SET search_path = app, public, extensions")
        run_checks(cur, fx)
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
