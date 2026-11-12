#!/usr/bin/env python3
"""Fill STAGING with a sandbox course for people to play in on the public test site. Everything is invented.

The test site (docs/operations/TEST-SITE.md) shows STAGING only. seed_staging.py builds the course the
test suites use; this builds a separate, friendlier one, so a tester can sign in and click anything without
touching what the suites rely on.

WHAT IT MAKES
  Course   prep-train   "PREP Training Course"
  Term     training-sandbox. ONE offering, ACTIVE.
  Sections TR-M (meets M) and TR-T (meets T)
  Staff    trainingdirector@prep-staging.example    director of the offering
           traininginstructor@prep-staging.example  instructor of both sections
  Cadets   3000001101 to 3000001106, three in each section. Sign-in address cadet<last four digits>@prep-staging.example
           (cadet1101@ to cadet1106@).
  Items    Four written preflights, with deadlines set around today:
             train-pf-1  past due (3 days ago)         published. Five cadets submitted; four graded and
                                                       finalized, one AI-suggested and waiting for review.
             train-pf-2  due in about 3 days           published, open.
             train-pf-3  due in about 6 days           published, open (inside the 7-day window).
             train-pf-4  due in about 10 days          a DRAFT, never published.

PASSWORDS follow the site's own rules and are not stored in this file:
  staff: last name in lower case + 1234.    cadets: last 6 digits of the cadet ID.
  No forced password change is set, so a tester goes straight in.

SAFETY  Staging only: the connection goes through db_target.py, which refuses the production project and any URL
        it cannot fully read, and --expect-ref must match. Dry run by default (runs everything, then rolls back);
        --commit writes. Re-runnable: it moves the deadlines back around today and changes nothing else that
        already exists. NEVER add a real name or a real cadet ID here: the passwords are public rules.

ENVIRONMENT  STAGING_DB_URL  postgres connection string for the STAGING project. Never printed.
USAGE
  python scripts/staging/seed_test_site.py --expect-ref <staging ref>            # plan only
  python scripts/staging/seed_test_site.py --expect-ref <staging ref> --commit   # write
"""
import argparse
import json
import os
import sys
import uuid
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
from v2_gate_lib import Builder, days, iso  # noqa: E402

NS = uuid.UUID("c3a9f1e4-7b25-4d68-8e0a-2f5d9b61c7a4")
COURSE_CODE, COURSE_TITLE = "prep-train", "PREP Training Course"
TERM_CODE, TERM_LABEL = "training-sandbox", "Training sandbox"
WRITTEN_PATH = {"modality": "written", "delivery": "typed_response", "grading": "human_graded", "content": {
    "questions": [
        {"id": "q1", "role": "reading_time", "type": "free_response", "points": 0, "figure_url": "",
         "text": "How much time did you spend reading the book in preparation for this lesson?"},
        {"id": "q2", "role": "reading_reflection", "type": "free_response", "points": 1, "figure_url": "",
         "text": "What did you find most confusing or most interesting about the reading?"},
        {"id": "q3", "role": "free_response", "type": "free_response", "points": 1, "figure_url": "",
         "text": "Made-up question. Explain the main idea of this lesson in your own words."},
    ]}}
SECTIONS = [("TR-M", ["M"], 1), ("TR-T", ["T"], 3)]
CADETS = [  # id, name, section code
    (3000001101, "Ada Sandboxcadet", "TR-M"), (3000001102, "Ben Sandboxcadet", "TR-M"),
    (3000001103, "Cleo Sandboxcadet", "TR-M"), (3000001104, "Dev Sandboxcadet", "TR-T"),
    (3000001105, "Eli Sandboxcadet", "TR-T"), (3000001106, "Fay Sandboxcadet", "TR-T"),
]


def password(cadet_id):
    return str(cadet_id)[-6:]


def staff_password(name):
    return name.split()[-1].lower() + "1234"


def qs(points):
    """The per-question scores a hand-graded written preflight carries, so the Grade card reads them."""
    q2, q3 = min(1, points), max(0, points - 1)
    st = lambda got, mx: "full" if got == mx else ("warn" if got else "zero")   # noqa: E731
    return json.dumps({"q1": {"score": 0, "max": 0, "feedback": "", "status": "full"},
                       "q2": {"score": q2, "max": 1, "feedback": "", "status": st(q2, 1)},
                       "q3": {"score": q3, "max": 1, "feedback": "", "status": st(q3, 1)}})


def seed(cur):
    b = Builder(cur, NS)
    course = b.course(COURSE_CODE, COURSE_TITLE)
    term = b.term(TERM_CODE, TERM_LABEL, "2026-08-06", "2026-12-10")
    co = b.offering(course, term, True)

    director = b.staff("trainingdirector", "Riley Trainingdirector", staff_password("Riley Trainingdirector"))
    instructor = b.staff("traininginstructor", "Morgan Traininginstructor", staff_password("Morgan Traininginstructor"))
    b.assign(director, co, "director")
    secs = {code: b.section(co, code, d, period) for code, d, period in SECTIONS}
    for sec in secs.values():
        b.assign(instructor, co, "instructor", sec)

    enr = {}
    for cid, name, code in CADETS:
        enr[cid], _ = b.cadet(cid, name, secs[code], password(cid))

    items = {}
    for n, offset, published in ((1, -3, True), (2, 3, True), (3, 6, True), (4, 10, False)):
        items[n] = b.item(course, co, f"train-pf-{n}", f"Training preflight {n}", 2, kind="preflight",
                          paths=[WRITTEN_PATH], due=days(offset), due_by_day={
                              "M": iso(days(offset)), "T": iso(days(offset + 1))},
                          entered_on_new_page=False, published=False)
        if published:
            b.publish(items[n])

    when = days(-4)
    for i, cid in enumerate([c[0] for c in CADETS[:5]]):
        s = b.work(enr[cid], items[1], "committed", when)
        if i < 4:
            pts = 2 if i % 2 == 0 else 1
            b.grade(enr[cid], items[1], pts, submission=s, question_scores=qs(pts))
        else:
            b.grade(enr[cid], items[1], 2, final=False, submission=s, question_scores=qs(2))
    return co


def counts(cur):
    cur.execute("""
      SELECT co.is_active,
             (SELECT count(*) FROM app.sections s WHERE s.course_offering_id = co.id),
             (SELECT count(*) FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id
               WHERE s.course_offering_id = co.id AND e.status = 'active'),
             (SELECT count(*) FROM app.assignment_offerings ao WHERE ao.course_offering_id = co.id AND ao.is_published),
             (SELECT count(*) FROM app.assignment_offerings ao WHERE ao.course_offering_id = co.id AND NOT ao.is_published),
             (SELECT count(*) FROM app.submissions x JOIN app.assignment_offerings ao ON ao.id = x.assignment_offering_id
               WHERE ao.course_offering_id = co.id),
             (SELECT count(*) FROM app.grades g JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
               WHERE ao.course_offering_id = co.id)
        FROM app.course_offerings co JOIN app.courses c ON c.id = co.course_id JOIN app.terms t ON t.id = co.term_id
       WHERE c.code = %s AND t.code = %s""", (COURSE_CODE, TERM_CODE))
    for active, sec, enr, pub, draft, sub, grd in cur.fetchall():
        print(f"  {TERM_CODE:<18} active={active!s:<6} sections {sec}, active enrollments {enr}, published items {pub}, "
              f"drafts {draft}, submissions {sub}, grades {grd}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args(argv)
    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    ref = db_target.exit_unless_staging(url, args.expect_ref).ref
    if ref != args.expect_ref:
        sys.exit(f"REFUSED  STAGING_DB_URL names project {ref}, not {args.expect_ref}.")

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    print(f"target   staging project {ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (rolled back; add --commit to write)'}")
    try:
        seed(cur)
        print("after seeding:")
        counts(cur)
        if args.commit:
            conn.commit()
            print("committed.")
        else:
            conn.rollback()
            print("rolled back. Nothing written.")
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print(f"FAILED, rolled back. {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
        return 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
