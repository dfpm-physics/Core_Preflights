#!/usr/bin/env python3
"""Prove score entry, column publishing and the Director-only excusal rule on a THROWAWAY database.

Builds schema `app` from the repo's files (every migration but 023, in order) into a database
named scratch_entry_<random> on the staging project's server, invents a small course, and calls the new
functions as real roles with a JWT claim set, the way the browser would. Then drops the database.

WHAT IT PROVES
  enter_grades      all-or-nothing batch; stale version refused; a third decimal, a negative and an over-maximum
                    score refused (bonus item excepted); duplicate cadet refused; a cadet outside the caller's
                    sections refused; published grade refused unless allowed
  publish_column    finalizes drafts only, closes the column once, is refused on an item still held by the step 1
                    rules
  excusals          an instructor cannot set, revoke or delete one; a Director can set one
  totals            course_totals is callable by staff, refused to a stranger, and counts the excusal
  grants            anon cannot call enter_grades

SAFETY  Staging project only (db_target.py refuses anything else). Touches only the database it created.
All data is invented. Never prints a password or the connection string.

Usage:  python scripts/staging/scratch_entry_proof.py --expect-ref <staging_ref>
Exit 0 only when every check passes.
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
import v2_gate_lib as gl  # noqa: E402

PASS = FAIL = 0


def check(desc, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [pass] {desc}")
    else:
        FAIL += 1
        print(f"  [FAIL] {desc} {detail}")


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
    name = "scratch_entry_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)
        conn = psycopg2.connect(surl, connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()

        def run(label, sql, owner=False):
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
                    cur.execute("RESET ROLE;")
                    cur.execute("RESET search_path;")
            return True

        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        files = [f for f in ins.migration_files(None) if f.name[:3] != "023"]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in files]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {files[-1].name[:3]} ({len(files)} migration files)")
        if files[-1].name[:3] < "065":
            print("REFUSED  migration 065 is not among the files")
            return 1

        # ---- invented fixtures, written as the owner ------------------------------------------------------
        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("5d1c2a0e-3b7f-4c1a-9e2d-7a6b5c4d3e21"))
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        director, instr, stranger = b.staff("director", "Dee Director"), b.staff("instr", "Ira Instructor"), b.staff("stranger", "Sid Stranger")
        course, term = b.course("proof-101", "Proof course"), b.term()
        co = b.offering(course, term, True)
        other_course = b.course("proof-202", "Other course")
        co2 = b.offering(other_course, term, False)
        secA, secB = b.section(co, "A1", ["M"]), b.section(co, "B1", ["T"])
        b.section(co2, "Z1", ["M"])
        b.assign(director, co, "director")
        b.assign(instr, co, "instructor", secA)
        b.assign(stranger, co2, "director")
        enrA1, _ = b.cadet(3000000901, "Ann Invented", secA, with_auth=False)
        enrA2, _ = b.cadet(3000000902, "Ben Invented", secA, with_auth=False)
        enrB1, _ = b.cadet(3000000903, "Cal Invented", secB, with_auth=False)
        hand = [{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}]
        quiz = b.item(course, co, "proof-quiz", "Proof quiz", 10, kind="quiz", paths=hand, published=False)
        bonus = b.item(course, co, "proof-bonus", "Proof bonus", 5, kind="homework", paths=hand, published=False, is_bonus=True)
        held = b.item(course, co, "proof-held", "Proof held", 10, kind="homework", paths=hand, published=False, entered_on_new_page=True)
        unpub = b.item(course, co, "proof-unpub", "Proof unpublished", 10, kind="homework", paths=hand, published=False)
        aiit = b.item(course, co, "proof-ai", "Proof ai", 10, kind="homework", paths=hand, published=False)
        mixed = b.item(course, co, "proof-mixed", "Proof mixed", 10, kind="homework", published=False, paths=[
            {"modality": "external", "delivery": "in_person", "grading": "hand_entered"},
            {"modality": "written", "role": "practice"}])
        eff = b.item(course, co, "proof-effort", "Proof effort", 10, kind="homework", paths=hand, published=False, grading_mode="effort")
        for it in (quiz, bonus, aiit, mixed):       # published, so a student's total can see them
            b.publish(it)
        cur.execute("COMMIT")
        Q, BN, H, U, AI, MX = quiz["ao"], bonus["ao"], held["ao"], unpub["ao"], aiit["ao"], mixed["ao"]

        def as_(who):
            cur.execute("RESET ROLE")
            if who is None:
                cur.execute("SET ROLE anon")
                return
            cur.execute("SET ROLE authenticated")
            cur.execute("SELECT set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": who, "role": "authenticated"}),))

        def call(sql, args=()):
            try:
                cur.execute(sql, args)
                return (cur.fetchall() if cur.description else []), None
            except Exception as exc:  # noqa: BLE001
                return None, exc

        def pubcall(item, sec, close):
            """publish_column the way the page calls it: read the preview, send its fingerprint (067)."""
            pr, pe = call("SELECT app.publish_preview(%s, %s)", (item, sec))
            fp = pr[0][0].get("fingerprint") if pr else None
            return call("SELECT app.publish_column(%s, %s, %s, %s)", (item, sec, close, fp))

        def rows(items):
            return json.dumps(items)

        def grade(enr, ao):
            cur.execute("RESET ROLE")
            cur.execute("SELECT points_earned, is_finalized, source FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enr, ao))
            return cur.fetchone()

        print("\n=== enter_grades ===")
        as_(director)
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([
            {"enrollment_id": enrA1, "points": "8.5"}, {"enrollment_id": enrA2, "points": "10"}, {"enrollment_id": enrB1, "points": "0"}])))
        check("a Director enters three scores in one call", e is None and r[0][0]["saved"] == 3 and r[0][0]["replaced_published"] == 0, str(e or r))
        g = grade(enrB1, Q)
        check("an explicit zero is stored as a score, as a draft", g is not None and g[0] == 0 and g[1] is False and g[2] == "instructor", str(g))
        # Review A2 M3 claimed an item with grading_mode 'effort' would have a typed score rewritten to 0 by the effort
        # trigger. Migration 014 moved that trigger onto the ROW (it acts only when the row carries an effort), so a typed
        # score is kept. This check holds the claim false; if the trigger ever goes back to keying on the item, it fails.
        as_(director)
        cur.execute("RESET ROLE")
        cur.execute("SELECT grading_mode FROM app.assignment_offerings WHERE id = %s", (eff["ao"],))
        check("the fixture item really is graded on effort", cur.fetchone()[0] == "effort")
        as_(director)
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (eff["ao"], rows([{"enrollment_id": enrA1, "points": "9"}])))
        g = grade(enrA1, eff["ao"])
        check("typed points on an effort-mode item are stored as typed, not rewritten to 0", e is None and g is not None and g[0] == 9, str(e or g))
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA1, "points": "9", "expect": None}])))
        check("a row with no version for an existing grade is refused as stale", e is not None and getattr(e, "pgcode", "") == "40001", str(e))
        cur.execute("RESET ROLE")
        cur.execute("SELECT updated_at::text FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enrA1, Q))
        ver = cur.fetchone()[0]
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([
            {"enrollment_id": enrA1, "points": "9", "expect": ver}, {"enrollment_id": enrA2, "points": "7", "expect": "2001-01-01T00:00:00+00"}])))
        check("one stale row refuses the whole batch", e is not None and getattr(e, "pgcode", "") == "40001", str(e))
        check("and the good row in that batch was not saved", grade(enrA1, Q)[0] == 8.5, str(grade(enrA1, Q)))
        as_(director)
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb, 'imported')", (Q, rows([{"enrollment_id": enrA1, "points": "9", "expect": ver}])))
        check("the right version is accepted and the source is recorded", e is None and grade(enrA1, Q)[0] == 9 and grade(enrA1, Q)[2] == "imported", str(e))
        as_(director)
        # the three bad values, each against a cadet with no grade yet, so a refusal is about the value
        cur.execute("RESET ROLE")
        cur.execute("DELETE FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enrA2, Q))
        for desc, pts in (("a third decimal", "3.456"), ("a negative score", "-1"), ("a score above the item", "10.01")):
            as_(director)
            _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA2, "points": pts}])))
            check(f"{desc} is refused", e is not None and getattr(e, "pgcode", "") == "23514", str(e))
        # text the page never sends, sent straight to the function (NaN passes every ordinary comparison)
        for desc, pts in (("NaN", "NaN"), ("nan in lower case", "nan"), ("Infinity", "Infinity"), ("negative infinity", "-Infinity"),
                          ("an exponent", "1e1"), ("hex", "0x10"), ("a word", "ten"), ("a comma decimal", "1,5"),
                          ("more than 9999.99", "10000")):
            for target, tname in ((Q, "an ordinary item"), (BN, "a bonus item")):
                as_(director)
                cur.execute("RESET ROLE")
                cur.execute("DELETE FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enrA2, target))
                as_(director)
                _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (target, rows([{"enrollment_id": enrA2, "points": pts}])))
                check(f"{desc} is refused on {tname}", e is not None and getattr(e, "pgcode", "") == "23514", str(e))
        cur.execute("RESET ROLE")
        cur.execute("SELECT count(*) FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id IN (%s, %s)", (enrA2, Q, BN))
        check("and none of them left a row behind", cur.fetchone()[0] == 0)
        nan_code = ""
        try:
            cur.execute("INSERT INTO app.grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source) "
                        "VALUES (%s, %s, 'NaN'::numeric, 5, 'instructor')", (enrA2, BN))
            nan_row = True
        except Exception as exc:  # noqa: BLE001
            nan_row = False
            nan_code = getattr(exc, "pgcode", "")
        check("and the table itself will not hold a NaN score from any writer", nan_row is False and nan_code == "23514", nan_code)
        as_(director)
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (BN, rows([{"enrollment_id": enrA2, "points": "7"}])))
        check("a bonus item accepts a score above its points", e is None, str(e))
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA2, "points": "1"}, {"enrollment_id": enrA2, "points": "2"}])))
        check("the same cadet twice is refused", e is not None, str(e))
        as_(instr)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrB1, "points": "4", "expect": None}])))
        check("an instructor cannot enter for a cadet outside their section", e is not None, str(e))
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA2, "points": "6"}])))
        check("an instructor can enter for their own section", e is None and r[0][0]["saved"] == 1, str(e))
        as_(stranger)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA1, "points": "1"}])))
        check("a Director of another course cannot enter here", e is not None, str(e))
        as_(None)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([])))
        check("anon cannot call enter_grades", e is not None and getattr(e, "pgcode", "") == "42501", str(e))

        print("\n=== publish_column ===")
        as_(instr)
        r, e = pubcall(Q, None, True)
        pub = r[0][0] if r else {}
        check("an instructor publishes their own section only", e is None and pub.get("published") == 2 and pub.get("closed") == 1 and pub.get("held_ai") == 0, str(e or pub))
        check("the other section's draft is still a draft", grade(enrB1, Q)[1] is False)
        as_(instr)
        r, e = pubcall(Q, None, True)
        check("publishing again publishes and closes nothing", e is None and r[0][0]["published"] == 0 and r[0][0]["closed"] == 0, str(e or r))
        as_(director)
        r, e = pubcall(Q, secB, True)
        check("a Director publishes and closes the other section", e is None and r[0][0]["published"] == 1 and r[0][0]["closed"] == 1, str(e or r))
        cur.execute("RESET ROLE")
        cur.execute("SELECT updated_at::text FROM app.grades WHERE enrollment_id=%s AND assignment_offering_id=%s", (enrA1, Q))
        ver2 = cur.fetchone()[0]
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (Q, rows([{"enrollment_id": enrA1, "points": "5", "expect": ver2}])))
        check("a published grade is not replaced without the flag", e is not None and "already published" in str(e), str(e))
        as_(director)
        r, e = call("SELECT app.enter_grades(%s, %s::jsonb, 'instructor', true)", (Q, rows([{"enrollment_id": enrA1, "points": "5", "expect": ver2}])))
        check("and is replaced with it, staying published", e is None and grade(enrA1, Q)[0] == 5 and grade(enrA1, Q)[1] is True, str(e))
        check("and the result says one score went live at once", e is None and r[0][0] == {"saved": 1, "replaced_published": 1}, str(e or r))
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (H, rows([{"enrollment_id": enrA1, "points": "5"}])))
        check("an item still held by the step 1 rules takes a draft", e is None, str(e))
        as_(director)
        _, e = pubcall(H, None, False)
        check("but publishing it is refused until those rules come out", e is not None, str(e))
        as_(stranger)
        _, e = pubcall(Q, None, True)
        check("a Director of another course cannot publish here", e is not None, str(e))

        print("\n=== publish_column: what it will not do ===")
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (U, rows([{"enrollment_id": enrA1, "points": "4"}])))
        check("an item not yet published to students takes a draft", e is None, str(e))
        as_(director)
        _, e = pubcall(U, None, True)
        check("but publishing its column is refused, because students would see nothing", e is not None and "not published to students" in str(e), str(e))
        check("and the draft is still a draft", grade(enrA1, U)[1] is False)
        as_(director)
        r, e = call("SELECT app.publish_preview(%s, NULL)", (U,))
        check("the preview says the same", e is None and r[0][0]["item_published"] is False and r[0][0]["drafts"] == 1, str(e or r))
        # an AI suggestion beside a person's score
        cur.execute("RESET ROLE")
        cur.execute("INSERT INTO app.grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                    "VALUES (%s, %s, 6, 10, 'ai_suggested', false)", (enrA1, AI))
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (AI, rows([{"enrollment_id": enrA2, "points": "9"}])))
        as_(director)
        r, e = call("SELECT app.publish_preview(%s, NULL)", (AI,))
        check("the preview counts the person's draft and the AI draft apart", e is None and r[0][0]["drafts"] == 1 and r[0][0]["held_ai"] == 1, str(e or r))
        as_(director)
        r, e = pubcall(AI, None, False)
        check("publishing finalizes the person's score and reports the AI draft it left out",
              e is None and r[0][0]["published"] == 1 and r[0][0]["held_ai"] == 1, str(e or r))
        check("the AI suggestion is still not finalized", grade(enrA1, AI)[1] is False and grade(enrA1, AI)[2] == "ai_suggested", str(grade(enrA1, AI)))
        check("the person's score is", grade(enrA2, AI)[1] is True)
        as_(director)
        r, e = pubcall(AI, None, False)
        check("a second publish says it published nothing", e is None and r[0][0]["published"] == 0 and r[0][0]["held_ai"] == 1, str(e or r))
        # the closing rule belongs to the database
        as_(director)
        r, e = call("SELECT app.publish_preview(%s, NULL)", (MX,))
        check("an item with a graded in-person path and an online practice path is one that closes", e is None and r[0][0]["close_applies"] is True, str(e or r))
        as_(director)
        _, e = call("SELECT app.enter_grades(%s, %s::jsonb)", (MX, rows([{"enrollment_id": enrA1, "points": "3"}])))
        as_(director)
        r, e = pubcall(MX, None, True)
        check("and publish_column closes it, whatever the page believes", e is None and r[0][0]["closed"] == 2 and r[0][0]["close_applies"] is True, str(e or r))
        as_(director)
        r, e = pubcall(MX, None, False)
        check("a publish that does not ask to close leaves the closure alone", e is None and r[0][0]["closed"] == 0, str(e or r))

        print("\n=== unpublish_column: the undo ===")
        as_(instr)
        r, e = call("SELECT app.unpublish_column(%s, NULL, true)", (Q,))
        check("an instructor unpublishes their own section's scores and reopens the column",
              e is None and r[0][0]["unpublished"] == 2 and r[0][0]["reopened"] == 1, str(e or r))
        check("their cadets' scores are drafts again", grade(enrA1, Q)[1] is False and grade(enrA2, Q)[1] is False)
        check("the other section's score stays published", grade(enrB1, Q)[1] is True)
        cur.execute("RESET ROLE")
        cur.execute("SELECT count(*) FROM app.column_closures WHERE assignment_offering_id=%s AND reopened_at IS NULL", (Q,))
        check("only the other section's closure is still open", cur.fetchone()[0] == 1)
        as_(director)
        r, e = call("SELECT app.unpublish_column(%s, NULL, true)", (Q,))
        check("a Director unpublishes the rest in one call", e is None and r[0][0]["unpublished"] == 1 and r[0][0]["reopened"] == 1, str(e or r))
        as_(director)
        r, e = call("SELECT app.unpublish_column(%s, NULL, true)", (Q,))
        check("and doing it again changes nothing", e is None and r[0][0]["unpublished"] == 0 and r[0][0]["reopened"] == 0, str(e or r))
        as_(director)
        r, e = pubcall(Q, None, True)
        check("the column can be published again afterwards", e is None and r[0][0]["published"] == 3, str(e or r))
        as_(stranger)
        _, e = call("SELECT app.unpublish_column(%s, NULL, true)", (Q,))
        check("a Director of another course cannot unpublish here", e is not None, str(e))
        as_(None)
        _, e = call("SELECT app.unpublish_column(%s, NULL, true)", (Q,))
        check("anon cannot call it", e is not None and getattr(e, "pgcode", "") == "42501", str(e))

        print("\n=== excused is Director-only ===")
        as_(instr)
        _, e = call("INSERT INTO app.grade_excusals (enrollment_id, assignment_offering_id, reason) VALUES (%s, %s, 'made-up reason')", (enrA2, Q))
        check("an instructor cannot set an excusal", e is not None and getattr(e, "pgcode", "") == "42501", str(e))
        as_(director)
        _, e = call("INSERT INTO app.grade_excusals (enrollment_id, assignment_offering_id, reason) VALUES (%s, %s, 'made-up reason')", (enrA2, Q))
        check("a Director can", e is None, str(e))
        as_(instr)
        r, e = call("UPDATE app.grade_excusals SET revoked_at = now(), revoked_reason = 'x' WHERE enrollment_id = %s RETURNING id", (enrA2,))
        check("an instructor cannot revoke one", (e is not None) or r == [], str(e or r))
        _, e = call("DELETE FROM app.grade_excusals WHERE enrollment_id = %s", (enrA2,))
        check("nor delete one", e is not None, str(e))
        cur.execute("RESET ROLE")
        cur.execute("SELECT count(*) FROM app.grade_excusals WHERE enrollment_id=%s AND revoked_at IS NULL", (enrA2,))
        check("the excusal is still standing", cur.fetchone()[0] == 1)
        cur.execute("SELECT count(*), min(actor::text) FROM app.grade_excusal_events WHERE enrollment_id=%s", (enrA2,))
        n, actor = cur.fetchone()
        check("one log row, naming the Director", n == 1 and actor == director, f"{n} {actor}")

        print("\n=== staff totals ===")
        as_(director)
        r, e = call("SELECT enrollment_id, excused_count FROM app.course_totals(%s, 'final')", (co,))
        check("course_totals is callable by staff", e is None and r is not None, str(e))
        as_(stranger)
        _, e = call("SELECT * FROM app.course_totals(%s, 'final')", (co,))
        check("and refused to a stranger", e is not None, str(e))
        as_(None)
        _, e = call("SELECT * FROM app.course_totals(%s, 'final')", (co,))
        check("and to anon", e is not None, str(e))

        print(f"\n{PASS} passed, {FAIL} failed")
        conn.close()
        return 0 if FAIL == 0 else 1
    finally:
        if sbc.drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f'WARNING  could not drop {name}; drop it by hand: DROP DATABASE "{name}";', file=sys.stderr)
        admin.close()


if __name__ == "__main__":
    sys.exit(main())
