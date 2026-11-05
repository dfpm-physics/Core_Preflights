#!/usr/bin/env python3
"""Prove, on a THROWAWAY database on the staging server, the database side of the problem-file upload (Stage E).

It builds schema `app` from the repo's files into a database of its own (the way scratch_stage_e_proof.py does), reads an
invented problem file with the SAME module the staff page uses (site/js/problem-file.js, run by Node), writes the rows
exactly as the page writes them, as a signed-in director, and checks that the rules the page relies on are enforced by the
database and not only by the page. The scratch database is dropped whatever happened. Nothing in the staging database
itself is read or written.

CHECKS (each prints [pass] or [FAIL])
  write     a director's session can write the questions and the keys a file describes; a student and an instructor of
            another course cannot
  origin    a key written as `ai` stays `ai`; the stored mark cannot be changed afterwards
  publish   an item holding an AI-written key no person has checked cannot be published; the refusal names the reason
  check     only a director of the course can record the check; the database names the checker from the sign-in, so a
            forged checker is overwritten; only a current, unchecked key is touched
  after     the same item publishes once every AI key is checked; an item whose file said `human` publishes with no check;
            one unchecked AI key among checked ones still blocks
  door      a key row for variant '' is what the file writes, and a second variant of the same question is a separate
            row the schema already allows (nothing is built on it)

WHAT THIS CANNOT PROVE
  The page itself, or that a person really looked at an answer. It proves only that nothing but a recorded person's check
  clears an AI-written key before publishing.

Needs Node only to read the file with the shipped module (developer tooling; nothing on the deploy path uses it).

SAFETY  Staging project only (db_target.py refuses anything else, the live project included). It drops only the database it
created. Never prints a password or the connection string. All people in the fixture are invented.

Usage:  python scripts/staging/scratch_problem_file_proof.py --expect-ref <staging_ref>
Exit 0 only when every check passed.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import scratch_build_check as sbc  # noqa: E402
import scratch_stage_e_proof as se  # noqa: E402
from scratch_stage_e_proof import check, section  # noqa: E402

NODE_READER = """
import { readProblemFile, exampleProblemFile } from %(module)s;
const origin = process.argv[1];
const text = exampleProblemFile(origin);
const plan = readProblemFile(text, { existingQids: [], startPosition: 0 });
console.log(JSON.stringify({ ok: plan.ok, toWrite: plan.toWrite, aiCount: plan.aiCount }));
"""


def find_node():
    for c in (shutil.which("node"), r"C:\Program Files\nodejs\node.exe"):
        if c and Path(c).exists():
            return c
    return None


def plan_from_module(node, origin):
    module = json.dumps((REPO / "site" / "js" / "problem-file.js").as_uri())
    code = NODE_READER % {"module": module}
    out = subprocess.run([node, "--input-type=module", "-e", code, origin], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError("node could not read the file: " + (out.stderr or "").strip().splitlines()[-1][:160])
    return json.loads(out.stdout)


def one(cur, sql, *a):
    cur.execute(sql, a or None)
    r = cur.fetchone()
    return r[0] if r else None


def as_user(cur, uid, role="authenticated"):
    claim = json.dumps({"sub": uid, "role": role})
    cur.execute("SELECT set_config('request.jwt.claims', %s, false), set_config('request.jwt.claim.sub', %s, false)", (claim, uid))
    cur.execute(f"SET ROLE {role}")


def as_owner(cur):
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)")


def write_rows(cur, activity_id, plan):
    """Write what writeImport writes: every question, then every key, with the NOT NULL defaults spelled out."""
    from psycopg2.extras import Json
    ids = {}
    for w in plan["toWrite"]:
        c = w["columns"]
        cur.execute(
            "INSERT INTO app.questions (activity_id, qid, position, prompt_md, format, choices, points, unit_hint) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (activity_id, c["qid"], c["position"], c["prompt_md"], c["format"],
             Json(c["choices"]) if c["choices"] is not None else None, c["points"], c["unit_hint"]))
        ids[c["qid"]] = cur.fetchone()[0]
    for w in plan["toWrite"]:
        key = {"select_rule": "all_or_nothing", "sig_fig_mode": "ignore", "unit_mode": "ignore", "written_by": "human",
               "variant_key": "", "question_id": ids[w["columns"]["qid"]], "version": 1, **w["key"]}
        names = list(key)
        cur.execute(f"INSERT INTO app.question_keys ({', '.join(names)}) VALUES ({', '.join(['%s'] * len(names))})",  # noqa: S608
                    list(key.values()))
    return ids


def try_publish(cur, fx, item):
    """Publish as the fixture does (the two step-1 triggers off for the statement). Returns None or the refusal text."""
    cur.execute("BEGIN")
    cur.execute("SAVEPOINT pub")
    try:
        fx.b.publish(item)
        cur.execute("RELEASE SAVEPOINT pub")
        cur.execute("COMMIT")
        return None
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT pub")
        cur.execute("RELEASE SAVEPOINT pub")
        cur.execute("COMMIT")
        return str(e).strip().splitlines()[0]


def run_checks(cur, fx, node):
    b = fx.b
    cur.execute("SET search_path = app, public")
    cur.execute("SELECT course_id FROM app.course_offerings WHERE id = %s", (fx.co,))
    course = cur.fetchone()[0]
    other = b.staff("proof-instructor-two", "Test Instructor Two")      # staff, but not a director of this course
    director_user = fx.director
    cur.execute("BEGIN")
    b.assign(director_user, fx.co, "director")
    Q = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}

    def new_item(slug):
        return b.item(course, fx.co, slug, slug, 0, kind="homework", paths=[Q], due=None, published=False, entered_on_new_page=True)
    ai_item, human_item, mixed_item = new_item("pf-ai"), new_item("pf-human"), new_item("pf-mixed")
    cur.execute("COMMIT")

    ai_plan, human_plan = plan_from_module(node, "ai"), plan_from_module(node, "human")
    check("the shipped module reads the example (ai) and (human) files", ai_plan["ok"] and human_plan["ok"] and len(ai_plan["toWrite"]) == 4)

    section("write")
    as_user(cur, "00000000-0000-0000-0000-00000000dead")
    try:
        write_rows(cur, ai_item["activities"][0], ai_plan)
        check("a session that is nobody cannot write questions", False)
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        check("a session that is nobody cannot write questions", "row-level security" in str(e) or "permission denied" in str(e), str(e)[:90])
    as_owner(cur)
    cur.execute("BEGIN")
    as_user(cur, b.id("user", 3000900001))                            # a student
    try:
        write_rows(cur, ai_item["activities"][0], ai_plan)
        check("a student session cannot write questions", False)
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        check("a student session cannot write questions", "row-level security" in str(e) or "permission denied" in str(e), str(e)[:90])
    as_owner(cur)
    cur.execute("BEGIN")
    as_user(cur, other)
    try:
        write_rows(cur, ai_item["activities"][0], ai_plan)
        check("an instructor who is not a director cannot write questions", False)
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK")
        check("an instructor who is not a director cannot write questions", "row-level security" in str(e) or "permission denied" in str(e), str(e)[:90])
    as_owner(cur)

    cur.execute("BEGIN")
    as_user(cur, director_user)
    ai_ids = write_rows(cur, ai_item["activities"][0], ai_plan)
    write_rows(cur, human_item["activities"][0], human_plan)
    as_owner(cur)
    cur.execute("COMMIT")
    check("a director writes the questions and keys of an ai file", one(cur, "SELECT count(*) FROM app.question_keys k JOIN app.questions q ON q.id=k.question_id WHERE q.activity_id=%s", ai_item["activities"][0]) == 4)
    check("the item's points follow the questions (2 + 1 + 1 + 2)", float(one(cur, "SELECT points_possible FROM app.assignment_offerings WHERE id=%s", ai_item["ao"])) == 6.0)

    section("origin")
    check("every key of the ai file is stored written_by ai", one(cur, "SELECT count(*) FROM app.question_keys k JOIN app.questions q ON q.id=k.question_id WHERE q.activity_id=%s AND k.written_by='ai'", ai_item["activities"][0]) == 4)
    check("none of them has a checker or a check time", one(cur, "SELECT count(*) FROM app.question_keys k JOIN app.questions q ON q.id=k.question_id WHERE q.activity_id=%s AND (k.checked_by IS NOT NULL OR k.checked_at IS NOT NULL)", ai_item["activities"][0]) == 0)
    check("the numbers are stored exactly (value 3, 2 percent; 0 with 0.01)",
          one(cur, "SELECT value::text || '/' || tol_pct::text FROM app.question_keys WHERE question_id=%s", ai_ids["accel"]) == "3/2"
          and one(cur, "SELECT value::text || '/' || tol_abs::text FROM app.question_keys WHERE question_id=%s", ai_ids["net"]) == "0/0.01")
    check("every key is for variant '' (the same numbers for everyone)", one(cur, "SELECT count(*) FROM app.question_keys k JOIN app.questions q ON q.id=k.question_id WHERE q.activity_id=%s AND k.variant_key <> ''", ai_item["activities"][0]) == 0)
    cur.execute("BEGIN")
    as_user(cur, director_user)
    cur.execute("SAVEPOINT s")
    try:
        cur.execute("UPDATE app.question_keys SET written_by = 'human' WHERE question_id = %s", (ai_ids["accel"],))
        check("a director cannot change an ai key to human afterwards", False)
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("a director cannot change an ai key to human afterwards", "do not change" in str(e), str(e)[:90])
    as_owner(cur)
    cur.execute("COMMIT")

    section("publish")
    why = try_publish(cur, fx, ai_item)
    check("an item with unchecked ai keys cannot be published", why is not None and "AI-written" in why, str(why))
    check("the refusal names a person's check as the reason", why is not None and "checked by a person" in why, str(why))
    check("the item is still unpublished", one(cur, "SELECT is_published FROM app.assignment_offerings WHERE id=%s", ai_item["ao"]) is False)
    check("an item whose file said human publishes with no check", try_publish(cur, fx, human_item) is None)

    section("check")
    ai_act = ai_item["activities"][0]
    cheque = ("UPDATE app.question_keys k SET checked_at = now() FROM app.questions q WHERE q.id = k.question_id AND q.activity_id = %s "
              "AND k.id = ANY(%s::uuid[]) AND k.superseded_at IS NULL AND k.checked_by IS NULL RETURNING k.id")
    key_ids = [r[0] for r in (cur.execute("SELECT k.id FROM app.question_keys k JOIN app.questions q ON q.id=k.question_id WHERE q.activity_id=%s ORDER BY q.position", (ai_act,)) or cur.fetchall())]
    cur.execute("BEGIN")
    as_user(cur, b.id("user", 3000900001))
    cur.execute("SAVEPOINT s")
    try:
        cur.execute(cheque, (ai_act, key_ids))
        n = cur.rowcount
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("a student session cannot record a check", n == 0, f"rowcount {n}")
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("a student session cannot record a check", True, str(e)[:60])
    as_owner(cur)
    as_user(cur, other)
    cur.execute("SAVEPOINT s")
    try:
        cur.execute(cheque, (ai_act, key_ids))
        n = cur.rowcount
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("an instructor who is not a director cannot record a check", n == 0, f"rowcount {n}")
    except Exception as e:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("an instructor who is not a director cannot record a check", True, str(e)[:60])
    as_owner(cur)
    cur.execute("COMMIT")
    check("the item is still unpublishable after those attempts", try_publish(cur, fx, ai_item) is not None)

    # one check, by the director: the first three keys, with a forged checker named in the statement
    cur.execute("BEGIN")
    as_user(cur, director_user)
    forged = other
    cur.execute("UPDATE app.question_keys SET checked_at = now(), checked_by = %s WHERE id = ANY(%s::uuid[]) RETURNING checked_by::text", (forged, key_ids[:3]))
    who = {r[0] for r in cur.fetchall()}
    as_owner(cur)
    cur.execute("COMMIT")
    check("the checker is the signed-in director, whatever the statement named", who == {director_user}, str(who))
    check("three keys are now checked and one is not", one(cur, "SELECT count(*) FROM app.question_keys WHERE id = ANY(%s::uuid[]) AND checked_by IS NOT NULL", key_ids) == 3)
    why = try_publish(cur, fx, ai_item)
    check("one unchecked ai key among checked ones still blocks publishing", why is not None and "AI-written" in why, str(why))

    cur.execute("BEGIN")
    as_user(cur, director_user)
    cur.execute(cheque, (ai_act, key_ids))
    left = cur.rowcount
    as_owner(cur)
    cur.execute("COMMIT")
    check("the page's check statement touches only the key still unchecked (1 of 4)", left == 1, f"touched {left}")
    cur.execute("BEGIN")
    as_user(cur, director_user)
    cur.execute(cheque, (ai_act, key_ids))
    again = cur.rowcount
    as_owner(cur)
    cur.execute("COMMIT")
    check("running it again touches nothing (a check is not renewed or overwritten)", again == 0)
    check("every ai key is now checked by the director, and still written_by ai",
          one(cur, "SELECT count(*) FROM app.question_keys WHERE id = ANY(%s::uuid[]) AND checked_by = %s AND written_by = 'ai'", key_ids, director_user) == 4)

    section("after")
    check("the same item publishes once every ai key is checked", try_publish(cur, fx, ai_item) is None)
    check("it is published", one(cur, "SELECT is_published FROM app.assignment_offerings WHERE id=%s", ai_item["ao"]) is True)

    # a mixed item: a human key and an ai key, only the human one checked-free
    cur.execute("BEGIN")
    as_user(cur, director_user)
    mixed = {"ok": True, "toWrite": [ai_plan["toWrite"][2], human_plan["toWrite"][3]]}
    for i, w in enumerate(mixed["toWrite"], start=1):
        w = json.loads(json.dumps(w)); w["columns"]["qid"] = f"m{i}"; w["columns"]["position"] = i
        mixed["toWrite"][i - 1] = w
    write_rows(cur, mixed_item["activities"][0], mixed)
    as_owner(cur)
    cur.execute("COMMIT")
    why = try_publish(cur, fx, mixed_item)
    check("a mixed item (one ai key, one human key) is blocked by the ai key alone", why is not None and "AI-written" in why, str(why))
    # a hand edit replaces the ai key with a human-written version: that version needs no check
    cur.execute("BEGIN")
    as_user(cur, director_user)
    cur.execute("SELECT q.id FROM app.questions q WHERE q.activity_id=%s AND q.qid='m1'", (mixed_item["activities"][0],))
    qid1 = cur.fetchone()[0]
    cur.execute("SELECT k.version FROM app.question_keys k WHERE k.question_id=%s AND k.superseded_at IS NULL", (qid1,))
    ver = cur.fetchone()[0]
    cur.execute("UPDATE app.question_keys SET superseded_at = now() WHERE question_id=%s AND superseded_at IS NULL", (qid1,))
    cur.execute("INSERT INTO app.question_keys (question_id, variant_key, version, correct_choice_ids, written_by) VALUES (%s, '', %s, ARRAY['b'], 'human')", (qid1, ver + 1))
    as_owner(cur)
    cur.execute("COMMIT")
    check("replacing the key by hand (a new human version) clears the block", try_publish(cur, fx, mixed_item) is None)

    section("door")
    check("two variants of one question are two rows the schema allows (nothing reads the second)",
          one(cur, "SELECT count(*) FROM pg_indexes WHERE schemaname='app' AND indexname='question_keys_current_idx' AND indexdef LIKE '%(question_id, variant_key)%'") == 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    node = find_node()
    if not node:
        print("This proof reads the file with the shipped JavaScript module and needs Node. Node was not found.", file=sys.stderr)
        return 2
    url = os.environ.get("STAGING_DB_URL", "").strip()
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_pfile_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 1
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)
        conn = se.connect(surl)
        cur = conn.cursor()
        built = se.build(cur)
        if built is None:
            return 1
        files, _ = built
        print(f"built    schema app from {len(files)} migration files, last {files[-1]}")
        fx = se.make_fixture(cur)
        run_checks(cur, fx, node)
        conn.close()
        print(f"\n{len(se.PASSED)} passed, {len(se.FAILED)} failed")
        for f in se.FAILED:
            print("  - " + f)
        code = 0 if not se.FAILED else 1
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
