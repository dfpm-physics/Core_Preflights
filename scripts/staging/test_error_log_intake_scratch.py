#!/usr/bin/env python3
"""Prove migration 051 (the tutor error log limits its own intake) on a THROWAWAY database.

The staging database is not touched. This builds schema `app` through migration 050's slot in a database of its own, then:

  BEFORE   a row for a lesson that does not exist is stored, and a burst of 700 rows is all stored.
  APPLY    051.
  AFTER    a row for a registered lesson is stored; a row for an unregistered one is dropped without an error; the 121st
           row for one lesson in a minute and the 601st overall are dropped; older rows do not count against the cap;
           the API roles hold no write on the table; the intake function is not callable by them.
  ROLLBACK 051's rollback; the trigger is gone and unregistered rows are stored again.

Sessions are simulated. What this cannot show: the deployed function and the platform gateway.

SAFETY  Staging project only (db_target.py refuses anything else). One database, dropped afterwards. Invented names only.

Usage:  python scripts/staging/test_error_log_intake_scratch.py --expect-ref <staging_ref>
Exit 0 only when BEFORE serves the gap and every later step passes.
"""
import argparse
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import v2_gate_lib as gl  # noqa: E402
from scratch_lib import Scratch, Tally  # noqa: E402

MIGRATION = "051_error_log_intake.sql"
ROLLBACK = "051_error_log_intake_ROLLBACK.sql"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_el", args.expect_ref, before="051", skip=())
    t = Tally()
    code = 1
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("7a3d3b1f-4c8a-4d2b-8f3e-8b7c6d5e4f51"))
        course, term = b.course("elg-101", "Log course"), b.term()
        co = b.offering(course, term, True)
        hand = [{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}]
        b.item(course, co, "elg-quiz", "Log quiz", 10, kind="quiz", paths=hand, due=gl.days(-3), published=False)
        cur.execute("COMMIT")
        REG, BAD = "elg-quiz-external", "no-such-lesson"
        t.chk("setup: the registered lesson exists", one("SELECT count(*) FROM activities WHERE slug = %s", (REG,)) == 1)

        def put(slug, n=1):
            s.cur.execute("INSERT INTO tutor_error_log (slug, kind) SELECT %s, 'quota' FROM generate_series(1, %s)", (slug, n))

        def count(where="TRUE", params=()):
            return one(f"SELECT count(*) FROM tutor_error_log WHERE {where}", params)  # noqa: S608

        print("\n=== BEFORE (051 not applied) ===")
        put(BAD)
        t.chk("BEFORE: the gap, a row for a lesson that does not exist is stored", count("slug = %s", (BAD,)) == 1)
        put(REG, 700)
        t.chk("BEFORE: the gap, 700 rows in one minute are all stored", count("slug = %s", (REG,)) == 700)
        cur.execute("DELETE FROM tutor_error_log")

        if not s.apply_file(MIGRATION):
            return 1
        print(f"\napplied  {MIGRATION}")

        print("\n=== AFTER ===")
        put(REG)
        t.chk("AFTER: a row for a registered lesson is stored", count("slug = %s", (REG,)) == 1)
        put(BAD)
        t.chk("AFTER: a row for an unregistered lesson is dropped, with no error", count("slug = %s", (BAD,)) == 0)
        put(REG, 150)
        t.chk("AFTER: one lesson stores at most 120 rows in a minute", count("slug = %s", (REG,)) == 120, count())
        cur.execute("UPDATE tutor_error_log SET logged_at = now() - interval '2 minutes'")
        put(REG, 5)
        t.chk("AFTER: rows older than a minute do not count against the cap", count("logged_at > now() - interval '1 minute'") == 5)
        cur.execute("DELETE FROM tutor_error_log")
        # fill the overall cap with rows attributed to many lessons, using the owner to bypass nothing: the trigger is on
        cur.execute("INSERT INTO tutor_error_log (slug, kind, logged_at) SELECT %s, 'quota', now() FROM generate_series(1, 600)", (REG,))
        t.chk("AFTER: the cap is per lesson first (120 of 600 stored)", count() == 120, count())
        # direct fill past the trigger: disable it for the setup only, then prove the overall cap
        cur.execute("ALTER TABLE tutor_error_log DISABLE TRIGGER tutor_error_log_intake")
        cur.execute("INSERT INTO tutor_error_log (slug, kind) SELECT %s, 'quota' FROM generate_series(1, 480)", (REG,))
        cur.execute("ALTER TABLE tutor_error_log ENABLE TRIGGER tutor_error_log_intake")
        before = count()
        put(REG)
        t.chk("AFTER: at 600 rows in a minute overall, the next row is dropped", before == 600 and count() == 600, (before, count()))
        r = s.attempt(None, "INSERT INTO tutor_error_log (slug, kind) VALUES (%s,'quota')", (REG,), role="authenticated")
        t.chk("AFTER: a signed-in session cannot write the table", r[0] == "error", r)
        r = s.attempt(None, "INSERT INTO tutor_error_log (slug, kind) VALUES (%s,'quota')", (REG,), role="anon")
        t.chk("AFTER: the unauthenticated role cannot write the table", r[0] == "error", r)
        t.chk("AFTER: the intake function is not callable by the API roles",
              not any(one(f"SELECT has_function_privilege('{r_}', 'app.tutor_error_log_intake()', 'EXECUTE')") for r_ in ("authenticated", "anon")))
        cur.execute("DELETE FROM tutor_error_log")

        if not s.apply_file(ROLLBACK, rollback=True):
            return 1
        print(f"\nrolled back {MIGRATION}")
        print("\n=== AFTER ROLLBACK ===")
        t.chk("ROLLBACK: the trigger and function are gone",
              one("SELECT count(*) FROM pg_trigger WHERE tgname = 'tutor_error_log_intake'") == 0
              and one("SELECT count(*) FROM pg_proc WHERE proname = 'tutor_error_log_intake'") == 0)
        put(BAD)
        t.chk("ROLLBACK: the gap is back, an unregistered lesson is stored again", count("slug = %s", (BAD,)) == 1)

        print(f"\nSUMMARY  {t.p} passed, {t.f} failed")
        code = 0 if t.f == 0 else 1
    finally:
        if not s.close():
            code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
