#!/usr/bin/env python
"""Split the phys-215 course offering into a TRAINING sandbox and a clean Fall 2026 offering.

WHY
    The live phys-215 offering holds 81 seeded students, 72 submissions and 72 grades — training
    data, not a real roster (every one of those students has `email IS NULL`, so none of them can
    even be provisioned an account). The director wants that kept, clearly labelled, for faculty
    training this week, and a separate clean offering to run the real term in.

WHAT IT DOES
    1. Creates a term `training-fall-2026` labelled so it is unmistakable in the UI.
    2. Repoints the EXISTING offering at it. This is the only write that touches existing data,
       and it moves nothing: sections, enrollments, submissions, grades, reports and analysis runs
       all hang off the offering id, which does not change.
    3. Creates a NEW phys-215 offering in `fall-2026` and copies the assignment schedule into it —
       37 assignment_offerings and their offering_activities, pointing at the SAME shared
       activities (content lives on the activity, which is what makes cross-term reuse work).
    4. Copies the offering-wide staff rows, so the people who teach the course can see it.

WHY THE TERM, AND NOT A FLAG
    `course_offerings` has no name column — it is (course_id, term_id, is_active) with
    UNIQUE (course_id, term_id). So two phys-215 offerings CANNOT share fall-2026, and there is
    nothing on the offering to rename. What a user actually sees is the term label: nav.js groups
    the course switcher by it and puts it in the role line. Moving the training offering to its own
    term therefore both frees up fall-2026 and does the labelling, in one write.
    (`is_active` is not an option: auth.js selects it and never filters on it. It hides nothing.)

WHAT IS DELIBERATELY NOT COPIED
    * enrollments, submissions, grades, submission_activities, analysis_reports, analysis_runs —
      the whole point is a clean offering.
    * SECTIONS, on the director's instruction. The roster import creates them, and as of the same
      change that added this script it creates them CORRECTLY: createSections() now derives
      meeting_days from the section code instead of writing [], and migration 017 stores the
      per-day schedule on the offering, so an imported section resolves its own M/T deadline with
      no lesson re-save. Before those two changes this would have been unsafe — every imported
      T-day section would have silently inherited the M-day date on all 37 lessons.
    * assignment_due_dates — they are per-section, and there are no sections. `due_by_day` carries
      the M/T schedule instead, which is what makes that safe.
    * The PREP Test Faculty account, which stays scoped to the training offering. It is a shared
      credential; the real offering should not carry one. Adding it later is one click in Staff.

Dry-run by default (CORE.md §4). Prints the plan and writes nothing without --commit.
Idempotent: re-running after a successful commit detects the finished state and does nothing.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "supabase" / "admin"))
import psycopg2  # noqa: E402
from psycopg2.extras import RealDictCursor, Json  # noqa: E402
from app_tier_check import read_env  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
ENV = REPO / "supabase" / "admin" / ".env"

COURSE_CODE = "phys-215"
REAL_TERM = "fall-2026"
TRAINING_TERM_CODE = "training-fall-2026"
TRAINING_TERM_LABEL = "TRAINING SANDBOX — Fall 2026"
TEST_FACULTY_NAME = "PREP Test Faculty"

AO_COPY_COLS = [
    "assignment_id", "points_possible", "grading_mode", "switch_policy",
    "opens_at", "due_at", "due_by_day", "is_published", "content_snapshot", "position",
]
OA_COPY_COLS = ["activity_id", "grading_role", "available_after", "is_visible", "position"]


def connect(env, role="OWNER"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env["PREP_DB_PORT"], dbname=env["PREP_DB_NAME"],
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


def snapshot(cur, offering_id, out_dir):
    """Write a JSON snapshot of everything hanging off the training offering before we touch it.

    CORE.md §0 requires a snapshot before a destructive op. Nothing here is destructive — the only
    write to existing data is one term_id — but the snapshot is cheap and it is the artifact that
    makes the change reversible without a database backup.
    """
    out = {"captured_at": datetime.now(timezone.utc).isoformat(), "offering_id": offering_id}
    for name, sql in [
        ("course_offering", "SELECT * FROM app.course_offerings WHERE id=%s"),
        ("sections", "SELECT * FROM app.sections WHERE course_offering_id=%s ORDER BY code"),
        ("staff_assignments", "SELECT * FROM app.staff_assignments WHERE course_offering_id=%s"),
        ("assignment_offerings",
         "SELECT * FROM app.assignment_offerings WHERE course_offering_id=%s ORDER BY position"),
    ]:
        cur.execute(sql, (offering_id,))
        out[name] = [dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT count(*) AS n FROM app.enrollments en JOIN app.sections s ON s.id=en.section_id "
        "WHERE s.course_offering_id=%s", (offering_id,))
    out["enrollment_count"] = cur.fetchone()["n"]

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"training-offering-snapshot-{offering_id[:8]}.json"
    path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="actually write; otherwise roll back")
    ap.add_argument("--snapshot-dir", default=None,
                    help="where the pre-change JSON snapshot goes (default: repo _snapshots/)")
    args = ap.parse_args()

    env = read_env(ENV)
    conn = connect(env)
    conn.autocommit = False
    cur = conn.cursor()
    plan = []

    try:
        cur.execute("SELECT id FROM app.courses WHERE code=%s", (COURSE_CODE,))
        course = cur.fetchone()
        if not course:
            sys.exit(f"no course {COURSE_CODE}")
        course_id = course["id"]

        cur.execute("SELECT id, code, label FROM app.terms WHERE code=%s", (REAL_TERM,))
        real_term = cur.fetchone()
        if not real_term:
            sys.exit(f"no term {REAL_TERM}")

        cur.execute(
            "SELECT co.id, t.code AS term_code FROM app.course_offerings co "
            "JOIN app.terms t ON t.id=co.term_id WHERE co.course_id=%s", (course_id,))
        offerings = cur.fetchall()
        by_term = {o["term_code"]: o["id"] for o in offerings}

        if TRAINING_TERM_CODE in by_term and REAL_TERM in by_term:
            print("Already split — training offering and clean fall-2026 offering both exist.")
            print(f"  training : {by_term[TRAINING_TERM_CODE]}")
            print(f"  fall-2026: {by_term[REAL_TERM]}")
            return

        training_offering = by_term.get(REAL_TERM)
        if not training_offering:
            sys.exit("no phys-215 offering in fall-2026 to convert")

        snap_dir = Path(args.snapshot_dir) if args.snapshot_dir else REPO / "_snapshots"
        snap_path = snapshot(cur, training_offering, snap_dir)
        plan.append(f"snapshot written -> {snap_path}")

        # 1 ── the training term
        cur.execute("""
            INSERT INTO app.terms (code, label, starts_on, ends_on, finals_start, finals_end,
                                   grades_due_on)
            SELECT %s, %s, starts_on, ends_on, finals_start, finals_end, grades_due_on
              FROM app.terms WHERE code=%s
            ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label
            RETURNING id
        """, (TRAINING_TERM_CODE, TRAINING_TERM_LABEL, REAL_TERM))
        training_term_id = cur.fetchone()["id"]
        plan.append(f"term '{TRAINING_TERM_CODE}' ({TRAINING_TERM_LABEL}) — dates copied from {REAL_TERM}")

        # 2 ── move the existing offering onto it (frees fall-2026, and does the labelling)
        cur.execute("UPDATE app.course_offerings SET term_id=%s WHERE id=%s",
                    (training_term_id, training_offering))
        plan.append(f"offering {training_offering} -> term {TRAINING_TERM_CODE}  (all its data stays put)")

        # 3 ── the clean offering
        cur.execute("""
            INSERT INTO app.course_offerings (course_id, term_id, is_active)
            VALUES (%s, %s, true) RETURNING id
        """, (course_id, real_term["id"]))
        new_offering = cur.fetchone()["id"]
        plan.append(f"NEW offering {new_offering} — {COURSE_CODE} x {REAL_TERM}")

        # 4 ── copy the assignment schedule
        cols = ", ".join(AO_COPY_COLS)
        cur.execute(f"""
            INSERT INTO app.assignment_offerings (course_offering_id, {cols})
            SELECT %s, {cols} FROM app.assignment_offerings
             WHERE course_offering_id=%s
            RETURNING id, assignment_id
        """, (new_offering, training_offering))
        new_aos = cur.fetchall()
        plan.append(f"copied {len(new_aos)} assignment_offerings (incl. due_at + due_by_day)")

        # offering_activities, matched old->new by assignment_id
        ocols = ", ".join(OA_COPY_COLS)
        cur.execute(f"""
            INSERT INTO app.offering_activities (assignment_offering_id, {ocols})
            SELECT new_ao.id, {", ".join("oa." + c for c in OA_COPY_COLS)}
              FROM app.offering_activities oa
              JOIN app.assignment_offerings old_ao ON old_ao.id = oa.assignment_offering_id
              JOIN app.assignment_offerings new_ao
                ON new_ao.assignment_id = old_ao.assignment_id
               AND new_ao.course_offering_id = %s
             WHERE old_ao.course_offering_id = %s
        """, (new_offering, training_offering))
        plan.append(f"copied {cur.rowcount} offering_activities (same shared activities)")

        # 5 ── staff: offering-wide rows only (there are no sections to scope to), minus the
        #      shared test credential.
        cur.execute("""
            INSERT INTO app.staff_assignments (instructor_id, course_offering_id, section_id, role)
            SELECT sa.instructor_id, %s, NULL, sa.role
              FROM app.staff_assignments sa
              JOIN app.instructors i ON i.id = sa.instructor_id
             WHERE sa.course_offering_id = %s AND sa.section_id IS NULL AND i.name <> %s
            RETURNING instructor_id
        """, (new_offering, training_offering, TEST_FACULTY_NAME))
        plan.append(f"copied {cur.rowcount} offering-wide staff rows "
                    f"(excluded '{TEST_FACULTY_NAME}', which stays training-only)")

        # ── verification, inside the transaction, before we decide to keep it ──
        checks = []
        cur.execute("SELECT count(*) AS n FROM app.assignment_offerings WHERE course_offering_id=%s",
                    (new_offering,))
        n_new_ao = cur.fetchone()["n"]
        cur.execute("SELECT count(*) AS n FROM app.assignment_offerings WHERE course_offering_id=%s",
                    (training_offering,))
        n_old_ao = cur.fetchone()["n"]
        checks.append(("assignment count matches the source", n_new_ao == n_old_ao,
                       f"{n_new_ao} vs {n_old_ao}"))

        cur.execute("""SELECT count(*) AS n FROM app.assignment_offerings
                        WHERE course_offering_id=%s AND due_by_day = '{}'::jsonb""", (new_offering,))
        checks.append(("every copied assignment carries a per-day schedule",
                       cur.fetchone()["n"] == 0, "empty due_by_day rows"))

        for tbl, sql in [
            ("sections", "SELECT count(*) AS n FROM app.sections WHERE course_offering_id=%s"),
            ("enrollments", "SELECT count(*) AS n FROM app.enrollments en "
                            "JOIN app.sections s ON s.id=en.section_id WHERE s.course_offering_id=%s"),
            ("submissions", "SELECT count(*) AS n FROM app.submissions sub "
                            "JOIN app.assignment_offerings ao ON ao.id=sub.assignment_offering_id "
                            "WHERE ao.course_offering_id=%s"),
            ("grades", "SELECT count(*) AS n FROM app.grades g "
                       "JOIN app.assignment_offerings ao ON ao.id=g.assignment_offering_id "
                       "WHERE ao.course_offering_id=%s"),
        ]:
            cur.execute(sql, (new_offering,))
            n = cur.fetchone()["n"]
            checks.append((f"new offering has NO {tbl}", n == 0, f"found {n}"))

        # the training side must be untouched
        cur.execute("SELECT count(*) AS n FROM app.enrollments en "
                    "JOIN app.sections s ON s.id=en.section_id WHERE s.course_offering_id=%s",
                    (training_offering,))
        checks.append(("training offering keeps its 81 enrollments",
                       cur.fetchone()["n"] == 81, "enrollment count changed"))

        print("\n".join(f"  · {p}" for p in plan))
        print("\nverification:")
        ok = True
        for label, passed, detail in checks:
            print(f"  [{'ok ' if passed else 'FAIL'}] {label}" + ("" if passed else f"  ({detail})"))
            ok = ok and passed
        if not ok:
            conn.rollback()
            sys.exit("\nVERIFICATION FAILED — rolled back, nothing written.")

        if args.commit:
            conn.commit()
            print(f"\nCOMMITTED. New clean offering: {new_offering}")
            print("Next: import the real roster into it — sections are created by the import.")
        else:
            conn.rollback()
            print("\nDRY RUN — rolled back. Re-run with --commit to write.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
