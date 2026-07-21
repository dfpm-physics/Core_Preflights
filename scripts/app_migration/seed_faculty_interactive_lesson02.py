#!/usr/bin/env python
"""Restore the archived Lesson 02 faculty interactive runs into schema `app`.

DRY RUN BY DEFAULT, per CORE.md §0: prints the full plan and writes nothing unless
--commit is passed. Idempotent — every insert is keyed on a natural key, so re-running
changes nothing. The whole run is one transaction.

Runs as `prep_app_dml` (data only). NO DDL is required and none is attempted, so
prep_app_owner does NOT need to be unsealed for this.

=========================================================================================
WHAT THIS IS  (agreed with Matthew, 2026-07-21)
=========================================================================================

In June 2026 seven faculty worked the Lesson 02 Claude artifact end-to-end *as if they
were students*, to shake out the interaction path. That produced 8 real schema-1 reports.
They were exported to the POC archive and then wiped by the Fall 2026 database reset, so
today they exist ONLY as JSON on disk:

    scripts/fall2026/poc-archive/reports_lesson-02-electric-charge-and-coulombs-law.json

They cannot be restored under their original identities: the cadet IDs they were filed
under (3000100001-3000100020) were deleted from `students` in both schemas by the reset,
and `app.enrollments` requires a live student. So each report is re-identified onto a NEW
synthetic student, two per section across all four phys-215 sections.

THIS IS THE POINT OF THE EXERCISE: `app` already holds 64 *written* preflight-02
submissions and zero *interactive* ones, so /lesson-aggregate can only ever describe one
modality. Landing these 8 gives the Lesson 02 rollup a genuinely mixed cohort.

WHAT IS PRESERVED VS. SYNTHESIZED
  * PRESERVED, byte for byte: report_markdown and the schema-1 report_data — the effort
    scores, misconception findings, objective ratings, and reading reflections that the
    faculty runs actually produced. Nothing is regenerated or re-graded.
  * SYNTHESIZED: the student identity only (name + cadet ID + section). Every row carries
    `content.source_provenance` recording the archive file, the original cadet ID, and the
    original interaction slug, so the re-identification is auditable and reversible.

THE SLUG CHANGED, DELIBERATELY. The archive is filed under the interaction slug
`lesson-02-electric-charge-and-coulombs-law`. The activity that migrated into `app` is
`lesson-02-electric-charge-coulombs-law` (no "and") — migrate_public_to_app.py dropped the
"-and-" variant because no lesson claimed it. These reports are attached to the surviving
activity, which is the one the Fall 2026 artifact will post to. The original slug is kept
in source_provenance.

SUBMISSIONS ARE LEFT `draft` WITH NO chosen_activity_id — ON PURPOSE. The interactive
activity is wired `grading_role='practice'` on this offering, and app.submissions_gradable
refuses a chosen_activity_id that is not 'graded'. Leaving the submission uncommitted is
exactly what site/app/js/student-data.js does for a practice activity, so these rows match
what production would have written. /lesson-aggregate does not filter on status.

NO `grades` ROWS ARE WRITTEN. The interactive activity is practice, and these students did
no written work, so a grade row would misrepresent them. /lesson-aggregate falls back to
`content.effort` when a grade is absent, which is what the archived reports carry.
=========================================================================================
"""
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402

ARCHIVE = (REPO / "scripts" / "fall2026" / "poc-archive"
           / "reports_lesson-02-electric-charge-and-coulombs-law.json")

COURSE_CODE = "phys-215"
ASSIGNMENT_SLUG = "preflight-02"
ORIGINAL_SLUG = "lesson-02-electric-charge-and-coulombs-law"
REMAP_TAG = "faculty-poc-restore@2026-07-21"

# Eight synthetic identities, two per section, in a cadet-ID block used by nothing else
# (verified free 2026-07-21; the training roster sits at 3000990000+). Names are
# deliberately androgynous and are checked against the live roster before use.
FACULTY_STUDENTS = [
    (3000980000, "Rowan Whitfield", "M1A"),
    (3000980001, "Sage Marsh",      "M1A"),
    (3000980002, "Jordan Calloway", "M3A"),
    (3000980003, "Avery Rivas",     "M3A"),
    (3000980004, "Kai Sterling",    "T1A"),
    (3000980005, "Remy Ashby",      "T1A"),
    (3000980006, "Arden Bishop",    "T3A"),
    (3000980007, "Tatum Vaughn",    "T3A"),
]

MAX_CONTENT_BYTES = 32768      # app.submission_activities content size CHECK
MAX_MARKDOWN = 100000          # app.submission_activities report_markdown length CHECK


def die(msg):
    sys.exit(f"\nABORT: {msg}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="actually write; otherwise the transaction is rolled back")
    args = ap.parse_args()

    if not ARCHIVE.is_file():
        die(f"archive not found: {ARCHIVE}")
    reports = json.loads(ARCHIVE.read_text("utf-8"))
    reports.sort(key=lambda r: r["student_id"])   # deterministic pairing

    if len(reports) != len(FACULTY_STUDENTS):
        die(f"{len(reports)} archived reports but {len(FACULTY_STUDENTS)} identities — "
            "the mapping must be 1:1; edit FACULTY_STUDENTS.")

    cfg, tiers = load()
    if "dml" not in tiers:
        die("no prep_app_dml credentials in supabase/admin/.env")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app")

    print(f"{'DRY RUN — nothing will be written' if not args.commit else 'COMMITTING'}\n")

    # ---------------------------------------------------------------- resolve targets
    cur.execute("""
        SELECT ao.id, act.id, act.slug, oa.grading_role
          FROM app.assignment_offerings ao
          JOIN app.assignments a        ON a.id  = ao.assignment_id
          JOIN app.courses c            ON c.id  = a.course_id
          JOIN app.course_offerings co  ON co.id = ao.course_offering_id
          JOIN app.offering_activities oa ON oa.assignment_offering_id = ao.id
          JOIN app.activities act       ON act.id = oa.activity_id
         WHERE c.code = %s AND a.slug = %s AND act.modality = 'interactive'
           AND co.is_active""", (COURSE_CODE, ASSIGNMENT_SLUG))
    hit = cur.fetchall()
    if len(hit) != 1:
        die(f"expected exactly 1 active interactive activity for {COURSE_CODE}/"
            f"{ASSIGNMENT_SLUG}, found {len(hit)}")
    offering_id, activity_id, activity_slug, grading_role = hit[0]
    print(f"  target offering  : {offering_id}")
    print(f"  target activity  : {activity_id}  ({activity_slug}, {grading_role})")
    print(f"  archived reports : {len(reports)} from {ARCHIVE.name}")
    print(f"  original slug    : {ORIGINAL_SLUG}\n")

    cur.execute("""
        SELECT sec.code, sec.id FROM app.sections sec
          JOIN app.course_offerings co ON co.id = sec.course_offering_id
          JOIN app.courses c ON c.id = co.course_id
         WHERE c.code = %s AND co.is_active""", (COURSE_CODE,))
    section_id = dict(cur.fetchall())
    for _, _, code in FACULTY_STUDENTS:
        if code not in section_id:
            die(f"section {code} not found in the active {COURSE_CODE} offering "
                f"(have: {', '.join(sorted(section_id))})")

    # ---------------------------------------------------------------- collision guards
    ids = [s[0] for s in FACULTY_STUDENTS]
    cur.execute("SELECT student_id, name FROM app.students WHERE student_id = ANY(%s)", (ids,))
    taken = cur.fetchall()
    if taken:
        # Only tolerable if this is a re-run and the names already match ours.
        expect = {sid: name for sid, name, _ in FACULTY_STUDENTS}
        clash = [(sid, nm) for sid, nm in taken if expect.get(sid) != nm]
        if clash:
            die(f"cadet ID block already used by someone else: {clash}")
        print(f"  note: {len(taken)} of these students already exist — re-run, will upsert\n")

    cur.execute("SELECT name FROM app.students WHERE student_id <> ALL(%s)", (ids,))
    existing_names = {r[0] for r in cur.fetchall()}
    dupes = [n for _, n, _ in FACULTY_STUDENTS if n in existing_names]
    if dupes:
        die(f"name collision with the live roster: {dupes}")

    # ---------------------------------------------------------------- the work
    print("Restoring:")
    print(f"  {'cadet ID':>10}  {'name':<17} {'sec':<4} {'from':>10}  eff  und  misc")
    n_stu = n_enr = n_sub = n_act = 0

    for (sid, name, sec_code), rep in zip(FACULTY_STUDENTS, reports):
        data = dict(rep.get("report_data") or {})
        markdown = rep.get("report_markdown") or ""
        if not data:
            die(f"archived report for {rep['student_id']} has no report_data")
        if data.get("schema") != 1:
            die(f"archived report for {rep['student_id']} is not schema 1")

        data["source_provenance"] = {
            "restored_by": REMAP_TAG,
            "archive": str(ARCHIVE.relative_to(REPO)).replace("\\", "/"),
            "original_student_id": rep["student_id"],
            "original_interaction_id": rep.get("interaction_id", ORIGINAL_SLUG),
            "original_created_at": rep.get("created_at"),
            "note": ("Faculty test run of the Lesson 02 artifact, June 2026. Report content "
                     "is unmodified; the student identity is synthetic because the original "
                     "cadet IDs were deleted by the Fall 2026 reset."),
        }
        blob = json.dumps(data)
        if len(blob.encode("utf-8")) > MAX_CONTENT_BYTES:
            die(f"content for {sid} is {len(blob.encode('utf-8'))} bytes > {MAX_CONTENT_BYTES}")
        if len(markdown) > MAX_MARKDOWN:
            die(f"markdown for {sid} is {len(markdown)} chars > {MAX_MARKDOWN}")

        cur.execute("""INSERT INTO app.students (student_id, name) VALUES (%s, %s)
                       ON CONFLICT (student_id) DO UPDATE SET name = EXCLUDED.name""",
                    (sid, name))
        n_stu += 1

        cur.execute("""INSERT INTO app.enrollments (student_id, section_id, status)
                       VALUES (%s, %s, 'active')
                       ON CONFLICT (student_id, section_id) DO UPDATE SET status = 'active'
                       RETURNING id""", (sid, section_id[sec_code]))
        enrollment_id = cur.fetchone()[0]
        n_enr += 1

        cur.execute("""INSERT INTO app.submissions (enrollment_id, assignment_offering_id, status)
                       VALUES (%s, %s, 'draft')
                       ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE
                         SET updated_at = now()
                       RETURNING id""", (enrollment_id, offering_id))
        submission_id = cur.fetchone()[0]
        n_sub += 1

        cur.execute("""INSERT INTO app.submission_activities
                         (submission_id, activity_id, content, report_markdown,
                          payload_bytes, is_final)
                       VALUES (%s, %s, %s, %s, %s, true)
                       ON CONFLICT (submission_id, activity_id) DO UPDATE
                         SET content = EXCLUDED.content,
                             report_markdown = EXCLUDED.report_markdown,
                             payload_bytes = EXCLUDED.payload_bytes,
                             is_final = true""",
                    (submission_id, activity_id, blob, markdown, len(markdown.encode("utf-8"))))
        n_act += 1

        print(f"  {sid:>10}  {name:<17} {sec_code:<4} {rep['student_id']:>10}  "
              f"{str(data.get('effort')):>3}  {str(data.get('overall_understanding')):>3}  "
              f"{len(data.get('misconceptions') or []):>4}")

    print(f"\n  {n_stu:>3}  students (upserted)")
    print(f"  {n_enr:>3}  enrollments")
    print(f"  {n_sub:>3}  submissions (draft, no chosen_activity_id — activity is practice)")
    print(f"  {n_act:>3}  submission_activities (interactive, is_final=true)")
    print("    0  grades (deliberate — practice activity, no written work)")

    # ---------------------------------------------------------------- verify in-transaction
    cur.execute("""
        SELECT act.modality, count(*)
          FROM app.submissions s
          JOIN app.submission_activities sa ON sa.submission_id = s.id
          JOIN app.activities act ON act.id = sa.activity_id
         WHERE s.assignment_offering_id = %s
         GROUP BY act.modality ORDER BY 1""", (offering_id,))
    print("\nCohort on this offering after the change:")
    for modality, n in cur.fetchall():
        print(f"  {n:>5}  {modality}")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
    else:
        conn.rollback()
        print("\nRolled back — dry run. Re-run with --commit to apply.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
