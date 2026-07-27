#!/usr/bin/env python
"""Create, re-tier, and remove the P0.5 test faculty account's rows in schema `app`.

WHY THIS IS A SCRIPT AND NOT THREE ad-hoc INSERTs
  Roadmap P0.5 needs a signed-in faculty session to verify surfaces that eight CHANGELOG
  entries record as never having been looked at. Roadmap P0.2 needs that same account GONE
  when the database is resealed. A teardown that exists only as a sentence in a roadmap is a
  teardown that does not happen — so the create and the remove live in one file, and the
  remove is the same code path that knows what the create made.

WHAT IT DOES *NOT* DO — the auth user
  This script only touches `app.instructors` and `app.staff_assignments`. It cannot create or
  delete the `auth.users` row, because NO role available to tooling here has any privilege on
  schema `auth` — not `claude_code_recker`, and not any of the three `prep_app_*` tiers,
  including the owner. That is a real boundary and not an oversight: `app` DDL being unsealed
  grants nothing on `auth`. The auth user is created and deleted by a human in the Supabase
  dashboard (or with the service_role key, which is not present on every machine).

  DELETING THE AUTH USER IS ENOUGH. `app.instructors.id` references `auth.users(id)`
  **ON DELETE CASCADE** (verified against pg_constraint 2026-07-22), and `staff_assignments`
  cascades from `instructors` in turn — so removing the account in the dashboard takes the app
  rows with it. This was established the hard way: an earlier revision of this file asserted the
  opposite, and then `--remove` found nothing to delete because the dashboard had already done it.

  `--remove` is therefore for the case where the auth user is STAYING and only the staffing
  should go — re-pointing the test account, or stripping a tier without deleting the login. It is
  also a safe no-op after a dashboard delete, which is how you confirm nothing was orphaned.

  NOTE THE ASYMMETRY: `app.students.auth_user_id` is **NO ACTION**, not CASCADE. Deleting a
  cadet's auth user does not tidy up after itself the way an instructor's does — it fails. Do not
  reason from one to the other.

ROLE TIERS
  P0.5 wants the walkthrough done as all three tiers. One account covers all three: --role
  rewrites the staff rows, and --admin/--no-admin flips `is_global_admin`. Creating three
  accounts would mean three teardowns and three chances to forget one.

    --role director    offering-wide director + one section-scoped row (the realistic shape:
                       a director who also teaches, which is what makes the rollup's
                       "My sections" scope testable)
    --role instructor  one section-scoped instructor row, nothing offering-wide
    --admin            is_global_admin = true (implicit access, holds no staff rows at all)

WHERE THE IDENTITY LIVES
  The email, password and UID are in the gitignored supabase/admin/.env
  (PREP_TEST_FACULTY_*), beside the DB role credentials. This script reads the UID from there;
  the browser harness reads all three. Keeping them in the one file that is meant to change means
  a dashboard-recreated account is a one-line edit, not a code change, and no secret is on a
  command line or in a scratch file.

DRY RUN BY DEFAULT, per CORE.md §4. Prints the plan; --commit writes.

Usage (from the repo root, via the project venv):
  .venv/Scripts/python scripts/test_faculty_account.py --status
  .venv/Scripts/python scripts/test_faculty_account.py --create --role director --commit
  .venv/Scripts/python scripts/test_faculty_account.py --role instructor --commit
  .venv/Scripts/python scripts/test_faculty_account.py --admin --commit
  .venv/Scripts/python scripts/test_faculty_account.py --remove --commit
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "supabase" / "admin"))
from app_tier_check import load, connect, read_env, ENV_FILE  # noqa: E402

# The account the roadmap tracks. Named so it is unmistakable in a staff list — if this ever
# shows up in a real course roster screenshot, someone forgot to run --remove.
#
# The UID is NOT hardcoded — it lives in the gitignored supabase/admin/.env as
# PREP_TEST_FACULTY_UID, beside the email and password the browser harness reads. Recreating the
# auth user in the dashboard mints a new id every time (this account was recreated three times on
# 2026-07-22 before it authenticated), so it belongs in the one file that is meant to change, not
# in source. --uid still overrides for a one-off. Absent from the env, the script says so rather
# than silently operating on nothing.
_ENV = read_env(ENV_FILE)
TEST_UID = _ENV.get("PREP_TEST_FACULTY_UID")
TEST_NAME = "PREP Test Faculty (P0.5 — delete at seal)"

COURSE_CODE = "phys-215"
TERM_CODE = "fall-2026"
# Section-scoped row for the director/instructor tiers. M1A is the largest phys-215 section,
# so "My sections" has something in it to render.
SECTION_CODE = "M1A"


def resolve(cur):
    cur.execute(
        """SELECT co.id FROM app.course_offerings co
             JOIN app.courses c ON c.id = co.course_id
             JOIN app.terms t   ON t.id = co.term_id
            WHERE c.code = %s AND t.code = %s""",
        (COURSE_CODE, TERM_CODE),
    )
    row = cur.fetchone()
    if not row:
        sys.exit(f"No course offering for {COURSE_CODE} / {TERM_CODE}.")
    offering_id = row[0]

    cur.execute(
        "SELECT id FROM app.sections WHERE course_offering_id = %s AND code = %s",
        (offering_id, SECTION_CODE),
    )
    row = cur.fetchone()
    if not row:
        sys.exit(f"No section {SECTION_CODE} in {COURSE_CODE} {TERM_CODE}.")
    return offering_id, row[0]


def status(cur, uid):
    cur.execute(
        "SELECT name, is_global_admin FROM app.instructors WHERE id = %s", (uid,))
    instr = cur.fetchone()
    if not instr:
        print(f"instructors: no row for {uid}")
    else:
        print(f"instructors: {instr[0]!r}  is_global_admin={instr[1]}")

    cur.execute(
        """SELECT c.code, t.code, COALESCE(s.code, '(offering-wide)'), sa.role
             FROM app.staff_assignments sa
             JOIN app.course_offerings co ON co.id = sa.course_offering_id
             JOIN app.courses c ON c.id = co.course_id
             JOIN app.terms t   ON t.id = co.term_id
             LEFT JOIN app.sections s ON s.id = sa.section_id
            WHERE sa.instructor_id = %s
            ORDER BY 1, 3""",
        (uid,),
    )
    rows = cur.fetchall()
    if not rows:
        print("staff_assignments: none")
    for r in rows:
        print(f"staff_assignments: {r[0]} {r[1]} · {r[2]} · {r[3]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--create", action="store_true",
                    help="insert the instructors row (idempotent)")
    ap.add_argument("--remove", action="store_true",
                    help="delete the staff rows and the instructors row")
    # 'grader' was withdrawn from the UI on 2026-07-27 (privilege-identical to 'instructor'; see
    # ROLE_LABEL in site/app/js/faculty-admin.js). The CHECK constraint still admits it, so it stays
    # available HERE — this script exists to put the P0.5 walkthrough account into a given state,
    # including a legacy one nobody can create through the app any more.
    ap.add_argument("--role", choices=["director", "instructor", "grader"],
                    help="rewrite the staff assignment rows to this tier "
                         "('grader' is retired in the UI; kept here to reproduce a legacy row)")
    ap.add_argument("--admin", dest="admin", action="store_true", default=None,
                    help="set is_global_admin = true")
    ap.add_argument("--no-admin", dest="admin", action="store_false",
                    help="set is_global_admin = false")
    ap.add_argument("--uid", default=TEST_UID,
                    help="auth user id to operate on (default: PREP_TEST_FACULTY_UID from .env)")
    ap.add_argument("--status", action="store_true", help="print current state and exit")
    ap.add_argument("--commit", action="store_true", help="actually write; otherwise roll back")
    args = ap.parse_args()

    if not any([args.create, args.remove, args.role, args.status]) and args.admin is None:
        ap.error("nothing to do — pass --status, --create, --role, --admin/--no-admin or --remove")
    if args.remove and (args.create or args.role or args.admin is not None):
        ap.error("--remove is exclusive; run it on its own")

    uid = args.uid
    if not uid:
        sys.exit("No UID — set PREP_TEST_FACULTY_UID in supabase/admin/.env, or pass --uid. "
                 "The auth user is created in the Supabase dashboard; copy its id in.")

    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No prep_app_dml credential in supabase/admin/.env.")
    conn = connect(cfg, tiers["dml"])
    cur = conn.cursor()

    if args.status:
        status(cur, uid)
        conn.close()
        return

    offering_id, section_id = resolve(cur)
    print(f"offering {COURSE_CODE}/{TERM_CODE} = {offering_id}")
    print(f"section  {SECTION_CODE} = {section_id}\n")

    if args.remove:
        # Staff rows first: they carry an FK to instructors, so the order is not optional.
        cur.execute("DELETE FROM app.staff_assignments WHERE instructor_id = %s", (uid,))
        print(f"DELETE staff_assignments -> {cur.rowcount} row(s)")
        cur.execute("DELETE FROM app.instructors WHERE id = %s", (uid,))
        print(f"DELETE instructors -> {cur.rowcount} row(s)")
        print("\nREMINDER: the auth.users row is NOT deleted by this script. "
              "Remove it in the Supabase dashboard — see the module docstring.")
    else:
        if args.create:
            cur.execute(
                """INSERT INTO app.instructors (id, name, is_global_admin)
                        VALUES (%s, %s, false)
                   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name""",
                (uid, TEST_NAME),
            )
            print(f"UPSERT instructors -> {cur.rowcount} row(s)")

        if args.admin is not None:
            cur.execute("UPDATE app.instructors SET is_global_admin = %s WHERE id = %s",
                        (args.admin, uid))
            print(f"UPDATE is_global_admin = {args.admin} -> {cur.rowcount} row(s)")

        if args.role:
            # Replace rather than add: re-tiering must not leave the previous tier's rows
            # behind, or the account ends up holding director AND instructor at once and the
            # walkthrough stops testing what it claims to.
            #
            # SCOPED TO THIS OFFERING. An unscoped delete also strips the account from every
            # OTHER course — which is exactly what happened mid-walkthrough on 2026-07-22: a
            # re-tier to instructor silently removed a phys-110 row, dropped the account to one
            # offering, and made the course switcher correctly disappear. That read as a P1.7
            # bug for several minutes. A role change in one course is not a statement about
            # another one.
            cur.execute("""DELETE FROM app.staff_assignments
                            WHERE instructor_id = %s AND course_offering_id = %s""",
                        (uid, offering_id))
            print(f"DELETE existing staff_assignments (this offering only) -> {cur.rowcount} row(s)")

            wanted = [(None, args.role)] if args.role != "instructor" else []
            wanted.append((section_id, args.role))
            for sec, role in wanted:
                cur.execute(
                    """INSERT INTO app.staff_assignments
                           (instructor_id, course_offering_id, section_id, role)
                       VALUES (%s, %s, %s, %s)""",
                    (uid, offering_id, sec, role),
                )
                print(f"INSERT staff_assignments · "
                      f"{SECTION_CODE if sec else '(offering-wide)'} · {role}")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.\n")
        status(cur, uid)
    else:
        conn.rollback()
        print("\nDRY RUN — rolled back. Pass --commit to write.")
    conn.close()


if __name__ == "__main__":
    main()
