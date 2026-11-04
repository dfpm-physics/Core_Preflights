#!/usr/bin/env python3
"""Prove the staff self-promotion hole, then prove migration 023 closes it -- on STAGING only.

Everything runs inside ONE transaction that is always rolled back, so staging is left exactly as
it was: the fake auth users and instructor rows vanish, and whatever state of 023 staging held
before the test is what it holds after.

WHAT IT CHECKS
  before 023   a plain staff member CAN set their own is_global_admin = true   (the hole)
  after 023    a plain staff member CANNOT set their own is_global_admin       (refused)
               a plain staff member CAN still change their own name            (not broken)
               a plain staff member CANNOT create a global admin               (refused)
               a global admin CAN promote another staff member                 (not broken)
               service_role CAN change the flag, as the edge functions do      (not broken)

Requests are simulated the way PostgREST makes them: SET ROLE authenticated, plus the JWT claims
in `request.jwt.claims`, which is what app.current_uid() reads.

ENVIRONMENT
  STAGING_DB_URL   postgres connection string for the STAGING project. Never printed.

USAGE
  python scripts/staging/test_instructors_admin_guard.py --expect-ref <staging_ref>
"""

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from install_staging import PROD_REF, REPO, target_ref  # noqa: E402

MIGRATION = REPO / "supabase" / "migrations" / "app" / "023_instructors_admin_flag_guard.sql"

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def as_user(cur, uid, role="authenticated"):
    cur.execute(f"SET LOCAL ROLE {role};")
    claims = {"sub": str(uid), "role": role} if uid else {"role": role}
    cur.execute("SELECT set_config('request.jwt.claims', %s, true);", (json.dumps(claims),))


def attempt(cur, label, sql, params, uid, role="authenticated"):
    """Run one statement as a simulated API caller. Return (ok, rowcount or error text)."""
    cur.execute(f"SAVEPOINT {label};")
    try:
        as_user(cur, uid, role)
        cur.execute(sql, params)
        n = cur.rowcount
        cur.execute("RESET ROLE;")
        cur.execute(f"RELEASE SAVEPOINT {label};")
        return True, n
    except Exception as exc:  # noqa: BLE001
        cur.execute(f"ROLLBACK TO SAVEPOINT {label};")
        cur.execute("RESET ROLE;")
        return False, str(exc).strip().splitlines()[0]


def flag(cur, uid):
    cur.execute("SELECT is_global_admin FROM app.instructors WHERE id = %s;", (str(uid),))
    return cur.fetchone()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    ref = target_ref(url)
    if PROD_REF in url or ref == PROD_REF or args.expect_ref == PROD_REF:
        sys.exit("REFUSED  target is the PRODUCTION project. This test runs on staging only.")
    if ref != args.expect_ref:
        sys.exit(f"REFUSED  STAGING_DB_URL names project {ref}, not {args.expect_ref}.")

    body = MIGRATION.read_text(encoding="utf-8")
    # The migration carries its own BEGIN/COMMIT; inside this test's transaction they must go.
    body = re.sub(r"^\s*(BEGIN|COMMIT)\s*;\s*$", "", body, flags=re.I | re.M)

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    print(f"target   staging project {ref}  (everything below is rolled back)")

    staff, admin, newbie = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    try:
        for uid in (staff, admin, newbie):
            cur.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s);",
                        (str(uid), f"guard-test-{uid.hex[:8]}@example.invalid"))
        cur.execute("INSERT INTO app.instructors (id, name, is_global_admin) VALUES "
                    "(%s, 'Testperson Staff', false), (%s, 'Testperson Admin', true);",
                    (str(staff), str(admin)))

        promote = "UPDATE app.instructors SET is_global_admin = true WHERE id = %s;"

        # Staging may already hold 023. Take it off inside this transaction, so "before" is real.
        cur.execute("SET LOCAL ROLE prep_app_owner;")
        cur.execute("DROP TRIGGER IF EXISTS instructors_admin_flag_guard ON app.instructors;")
        cur.execute("DROP FUNCTION IF EXISTS app.instructors_admin_flag_guard();")
        cur.execute("RESET ROLE;")

        # ---- before the fix --------------------------------------------------------------
        ok, n = attempt(cur, "pre", promote, (str(staff),), staff)
        check("before 023: staff self-promotion succeeds (the hole is real)",
              ok and n == 1 and flag(cur, staff) is True, f"ok={ok}, rows={n}")
        cur.execute("UPDATE app.instructors SET is_global_admin = false WHERE id = %s;", (str(staff),))

        # ---- apply the fix, as the owner, the way the installer applies migrations --------
        cur.execute("SAVEPOINT mig;")
        cur.execute("SET LOCAL ROLE prep_app_owner;")
        cur.execute(body)
        cur.execute("RESET ROLE;")
        cur.execute("SET search_path = public;")  # undo the migration's SET LOCAL for clarity
        print("ok       migration 023 applied inside the test transaction")

        # ---- after the fix ---------------------------------------------------------------
        ok, msg = attempt(cur, "t1", promote, (str(staff),), staff)
        check("after 023: staff self-promotion is refused",
              not ok and "is_global_admin" in str(msg) and flag(cur, staff) is False, str(msg))

        ok, n = attempt(cur, "t2", "UPDATE app.instructors SET name = 'Testperson Renamed' WHERE id = %s;",
                        (str(staff),), staff)
        check("after 023: staff can still change their own name", ok and n == 1, f"rows={n}")

        ok, msg = attempt(cur, "t3", "INSERT INTO app.instructors (id, name, is_global_admin) "
                          "VALUES (%s, 'Testperson New', true);", (str(newbie),), staff)
        check("after 023: staff cannot create a global admin", not ok, str(msg))

        ok, n = attempt(cur, "t4", promote, (str(staff),), admin)
        check("after 023: a global admin can promote a staff member",
              ok and n == 1 and flag(cur, staff) is True, f"ok={ok}, rows={n}")
        cur.execute("UPDATE app.instructors SET is_global_admin = false WHERE id = %s;", (str(staff),))

        ok, n = attempt(cur, "t5", promote, (str(staff),), None, role="service_role")
        check("after 023: service_role can change the flag (edge functions)",
              ok and n == 1 and flag(cur, staff) is True, f"ok={ok}, rows={n}")
    finally:
        conn.rollback()
        conn.close()
        print("rolled back. Staging is unchanged.")

    failed = results.count(False)
    print(f"\n{len(results) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
