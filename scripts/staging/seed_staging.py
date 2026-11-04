#!/usr/bin/env python3
"""Fill the STAGING project with made-up people and one test course, so a person can sign in.

Every name, email and answer here is invented. NEVER add real cadet data to staging: these
accounts use the site's own guessable default passwords, and staging is on the open internet.

WHAT IT MAKES
  Course phys-215, term fall-2026, sections M1A and T3A.
  Staff     admin@     global admin
            director@  director of the offering
            instructor@  instructor of M1A only
  Cadets    cadet101@ to cadet103@ in M1A, cadet104@ to cadet106@ in T3A (all @prep-staging.example)
  Lessons, with deadlines set around today so the site's 7-day window shows the right ones:
            test-lesson-01  past due. Cadets 101, 102 and 104 submitted. 101 has a final grade,
                            102 has an AI suggestion to review, 104 is ungraded, others none.
            test-lesson-02  due in 2 to 3 days. Cadet 101 has a saved draft.
            test-lesson-03  due in 30 days, so published but outside a cadet's 7-day window.
            test-lesson-04  an unpublished draft.

PASSWORDS follow the site's own rules, and are not stored in this file:
  staff: last name in lower case + 1234.    cadets: last 6 digits of the cadet ID.
  No forced password change is set, so a tester goes straight in.

RE-RUN IT to move the deadlines back around today. It changes nothing else that already exists.

SAFETY  Dry run by default (it runs everything, then rolls back). --commit writes. Refuses the
        production ref, and refuses unless --expect-ref matches the connection string.

ENVIRONMENT  STAGING_DB_URL  postgres connection string for the STAGING project. Never printed.

USAGE
  python scripts/staging/seed_staging.py --expect-ref <staging_ref>           # plan only
  python scripts/staging/seed_staging.py --expect-ref <staging_ref> --commit  # write
  python scripts/staging/seed_staging.py --expect-ref <staging_ref> --verify  # sign in and check
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from install_staging import PROD_REF, target_ref  # noqa: E402
from serve_local import read_targets  # noqa: E402

NS = uuid.UUID("6f2b7c1e-58a4-4a0e-9d57-0d3b4c7f1a10")
DOMAIN = "prep-staging.example"
DENVER = ZoneInfo("America/Denver")

STAFF = [  # key, name, global admin
    ("admin", "Pat Admin", True),
    ("director", "Alex Director", False),
    ("instructor", "Sam Instructor", False),
]
CADETS = [  # cadet id, name, section
    (3000000101, "Avery Testcadet", "M1A"),
    (3000000102, "Blake Testcadet", "M1A"),
    (3000000103, "Cameron Testcadet", "M1A"),
    (3000000104, "Dana Testcadet", "T3A"),
    (3000000105, "Emery Testcadet", "T3A"),
    (3000000106, "Finley Testcadet", "T3A"),
]
LESSONS = [  # slug, title, days until the M deadline, published
    ("test-lesson-01", "Test Lesson 1: Electric Charge", -8, True),
    ("test-lesson-02", "Test Lesson 2: Electric Fields", 2, True),
    ("test-lesson-03", "Test Lesson 3: Gauss's Law", 30, True),
    ("test-lesson-04", "Test Lesson 4: Electric Potential", 14, False),
]


def uid(kind, key):
    return str(uuid.uuid5(NS, f"{kind}:{key}"))


def staff_password(name):
    return name.split()[-1].lower() + "1234"


def cadet_password(cadet_id):
    return str(cadet_id)[-6:]


def deadline(days):
    """2359 Denver on the day `days` from today, in UTC, whole seconds field :59 (CORE.md §2)."""
    day = date.today() + timedelta(days=days)
    return datetime.combine(day, time(23, 59, 59), DENVER).astimezone(timezone.utc)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def questions():
    return [
        {"id": "q1", "role": "reading_time", "type": "free_response", "points": 0, "figure_url": "",
         "text": "How much time did you spend reading the book in preparation for this lesson?",
         "student_note": "Your response is visible to your instructor, but your name is not shown."},
        {"id": "q2", "role": "reading_reflection", "type": "free_response", "points": 1,
         "figure_url": "",
         "text": "What did you find most confusing or most interesting about the reading?",
         "expected_response": "Reading reflection: judge whether this is a meaningful engagement."},
        {"id": "q3", "role": "free_response", "type": "free_response", "points": 1, "figure_url": "",
         "correct_answer": "", "text": "TEST QUESTION. Explain the main idea of this lesson.",
         "expected_response": "Any clear statement of the main idea earns full credit."},
    ]


def add_auth_user(cur, user_id, email, password):
    cur.execute(
        """INSERT INTO auth.users
             (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
              confirmation_token, recovery_token, email_change_token_new, email_change)
           VALUES (%s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                   %s, extensions.crypt(%s, extensions.gen_salt('bf')), now(),
                   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
                   '', '', '', '')
           ON CONFLICT (id) DO NOTHING""",
        (user_id, email, password),
    )
    cur.execute(
        """INSERT INTO auth.identities
             (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           VALUES (%s, %s, %s, %s, 'email', now(), now(), now())
           ON CONFLICT (provider_id, provider) DO NOTHING""",
        (uid("identity", user_id), user_id, user_id,
         json.dumps({"sub": user_id, "email": email, "email_verified": True})),
    )


def seed(cur):
    # Some trigger functions name their tables without `app.` and rely on the caller's search path.
    # The REST API sets it to `app`. A direct connection must do the same.
    cur.execute("SET LOCAL search_path = app, public, extensions;")
    course, term = uid("course", "phys-215"), uid("term", "fall-2026")
    offering = uid("offering", "phys-215:fall-2026")
    cur.execute("""INSERT INTO app.courses (id, code, title, department)
                   VALUES (%s, 'phys-215', 'Physics 215 (STAGING TEST)', 'Physics')
                   ON CONFLICT (id) DO NOTHING""", (course,))
    cur.execute("""INSERT INTO app.terms (id, code, label, starts_on, ends_on)
                   VALUES (%s, 'fall-2026', 'Fall 2026', '2026-08-06', '2026-12-10')
                   ON CONFLICT (id) DO NOTHING""", (term,))
    cur.execute("""INSERT INTO app.course_offerings (id, course_id, term_id, is_active)
                   VALUES (%s, %s, %s, true) ON CONFLICT (id) DO NOTHING""", (offering, course, term))
    sections = {}
    for code, day, period in (("M1A", "M", 1), ("T3A", "T", 3)):
        sections[code] = uid("section", code)
        cur.execute("""INSERT INTO app.sections (id, course_offering_id, code, meeting_days, period)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (sections[code], offering, code, [day], period))

    for key, name, is_admin in STAFF:
        user_id = uid("user", key)
        add_auth_user(cur, user_id, f"{key}@{DOMAIN}", staff_password(name))
        cur.execute("""INSERT INTO app.instructors (id, name, is_global_admin)
                       VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING""", (user_id, name, is_admin))
    for key, role, section in (("director", "director", None), ("instructor", "instructor", "M1A")):
        cur.execute("""INSERT INTO app.staff_assignments
                         (id, instructor_id, course_offering_id, section_id, role)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (uid("staff", key), uid("user", key), offering,
                     sections[section] if section else None, role))

    enrollments = {}
    for cadet_id, name, section in CADETS:
        user_id = uid("user", cadet_id)
        email = f"cadet{str(cadet_id)[-3:]}@{DOMAIN}"
        add_auth_user(cur, user_id, email, cadet_password(cadet_id))
        cur.execute("""INSERT INTO app.students (student_id, name, email, auth_user_id)
                       VALUES (%s, %s, %s, %s) ON CONFLICT (student_id) DO NOTHING""",
                    (cadet_id, name, email, user_id))
        enrollments[cadet_id] = uid("enrollment", cadet_id)
        cur.execute("""INSERT INTO app.enrollments (id, student_id, section_id)
                       VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (enrollments[cadet_id], cadet_id, sections[section]))

    offerings, activities = {}, {}
    for pos, (slug, title, days, published) in enumerate(LESSONS, start=1):
        assignment = uid("assignment", slug)
        offerings[slug], activities[slug] = uid("ao", slug), uid("activity", slug)
        m_due, t_due = deadline(days), deadline(days + 1)
        cur.execute("""INSERT INTO app.assignments (id, course_id, kind_id, slug, title)
                       VALUES (%s, %s, 'preflight', %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (assignment, course, slug, title))
        # Deadlines are the one thing a re-run moves, so this seed does not go stale.
        cur.execute("""INSERT INTO app.assignment_offerings
                         (id, assignment_id, course_offering_id, due_at, due_by_day, grading_mode,
                          points_possible, is_published, position)
                       VALUES (%s, %s, %s, %s, %s, 'points', 2, %s, %s)
                       ON CONFLICT (id) DO UPDATE
                         SET due_at = EXCLUDED.due_at, due_by_day = EXCLUDED.due_by_day""",
                    (offerings[slug], assignment, offering, m_due,
                     json.dumps({"M": iso(m_due), "T": iso(t_due)}), published, pos))
        for section, due in (("M1A", m_due), ("T3A", t_due)):
            cur.execute("""INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
                           VALUES (%s, %s, %s)
                           ON CONFLICT (assignment_offering_id, section_id)
                           DO UPDATE SET due_at = EXCLUDED.due_at""",
                        (offerings[slug], sections[section], due))
        content = {"questions": questions(), "reading_link": None, "reference_pdf": None,
                   "reference_pages": None, "access": "open"}
        cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                       VALUES (%s, %s, 'written', %s, %s, %s, 0) ON CONFLICT (id) DO NOTHING""",
                    (activities[slug], assignment, f"{slug}-written", title, json.dumps(content)))
        cur.execute("""INSERT INTO app.offering_activities
                         (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                       VALUES (%s, %s, 'graded', 'always', true, 0) ON CONFLICT DO NOTHING""",
                    (offerings[slug], activities[slug]))

    answers = {"q1": "About 30 minutes.",
               "q2": "TEST ANSWER. I found the sign of the charge confusing at first.",
               "q3": "TEST ANSWER. Like charges repel and unlike charges attract."}

    def submit(cadet_id, slug, committed):
        sub = uid("submission", f"{cadet_id}:{slug}")
        cur.execute("""INSERT INTO app.submissions
                         (id, assignment_offering_id, enrollment_id, chosen_activity_id, status, committed_at)
                       VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (sub, offerings[slug], enrollments[cadet_id],
                     activities[slug] if committed else None,
                     "committed" if committed else "draft",
                     deadline(-9) if committed else None))
        cur.execute("""INSERT INTO app.submission_activities (id, submission_id, activity_id, content, is_final)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (uid("sub_activity", f"{cadet_id}:{slug}"), sub, activities[slug],
                     json.dumps(answers), committed))
        return sub

    def grade(cadet_id, slug, sub, final):
        scores = {
            "q1": {"score": 0, "max": 0, "feedback": "", "status": "full"},
            "q2": {"score": 1, "max": 1, "feedback": "", "status": "full"},
            "q3": {"score": 1, "max": 1, "feedback": "TEST FEEDBACK. Good.", "status": "full"},
        }
        cur.execute("""INSERT INTO app.grades
                         (id, assignment_offering_id, enrollment_id, submission_id, points_earned,
                          points_possible, question_scores, source, is_finalized, graded_by, graded_at)
                       VALUES (%s, %s, %s, %s, 2, 2, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (uid("grade", f"{cadet_id}:{slug}"), offerings[slug], enrollments[cadet_id], sub,
                     json.dumps(scores), "instructor" if final else "ai_suggested", final,
                     uid("user", "instructor") if final else None, deadline(-7) if final else None))

    grade(3000000101, "test-lesson-01", submit(3000000101, "test-lesson-01", True), final=True)
    grade(3000000102, "test-lesson-01", submit(3000000102, "test-lesson-01", True), final=False)
    submit(3000000104, "test-lesson-01", True)
    submit(3000000101, "test-lesson-02", False)


def counts(cur):
    for table in ("courses", "sections", "instructors", "staff_assignments", "students", "enrollments",
                  "assignments", "assignment_offerings", "assignment_due_dates", "activities",
                  "offering_activities", "submissions", "submission_activities", "grades"):
        cur.execute(f"SELECT count(*) FROM app.{table}")  # noqa: S608 -- fixed names above
        print(f"  {table:<24}{cur.fetchone()[0]}")


# ---- verify: real sign-ins over the same REST API the site uses ---------------------------------
def rest(url, key, path, token=None, method="GET", body=None):
    request = urllib.request.Request(url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
    request.add_header("apikey", key)
    request.add_header("Authorization", f"Bearer {token or key}")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept-Profile", "app")
    request.add_header("Content-Profile", "app")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, None


def verify():
    _, staging = read_targets()
    url, key = staging["url"], staging["anon"]
    # who, password, enrollments, grades, students they should see
    expected = [
        ("admin", staff_password("Pat Admin"), 6, 2, 6),
        ("director", staff_password("Alex Director"), 6, 2, 6),
        ("instructor", staff_password("Sam Instructor"), 3, 2, 3),
        ("cadet101", cadet_password(3000000101), 1, 1, 1),
        ("cadet104", cadet_password(3000000104), 1, 0, 1),
    ]
    bad = 0
    tokens = {}
    for who, password, want_enrol, want_grades, want_students in expected:
        status, session = rest(url, key, "/auth/v1/token?grant_type=password", method="POST",
                               body={"email": f"{who}@{DOMAIN}", "password": password})
        if status != 200:
            print(f"FAIL  {who}: sign-in returned HTTP {status}")
            bad += 1
            continue
        token = tokens[who] = session["access_token"]
        seen = {t: len(rest(url, key, f"/rest/v1/{t}?select=*", token)[1] or [])
                for t in ("enrollments", "grades", "students")}
        ok = (seen["enrollments"], seen["grades"], seen["students"]) == (want_enrol, want_grades, want_students)
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {who}: signed in; sees {seen}"
              + ("" if ok else f"; expected {want_enrol}, {want_grades}, {want_students}"))

    for who, role in (("director", "director"), ("cadet101", "cadet")):
        if who not in tokens:
            continue
        target = uid("user", who if role == "director" else "instructor")
        status, _ = rest(url, key, f"/rest/v1/instructors?id=eq.{target}", tokens[who], method="PATCH",
                         body={"is_global_admin": True})
        cur_flag = rest(url, key, f"/rest/v1/instructors?id=eq.{target}&select=is_global_admin",
                        tokens["admin"])[1]
        ok = bool(cur_flag) and cur_flag[0]["is_global_admin"] is False
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {role} cannot make an admin over the real API (HTTP {status})")
    print(f"\n{bad} failed" if bad else "\nall passed")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--verify", action="store_true", help="sign in as each role and check what it sees")
    args = ap.parse_args()

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    ref = target_ref(url)
    if PROD_REF in url or ref == PROD_REF or args.expect_ref == PROD_REF:
        sys.exit("REFUSED  target is the PRODUCTION project. This script only seeds staging.")
    if ref != args.expect_ref:
        sys.exit(f"REFUSED  STAGING_DB_URL names project {ref}, not {args.expect_ref}.")
    if args.verify:
        return verify()

    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    print(f"target   staging project {ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (rolled back; add --commit to write)'}")
    try:
        seed(cur)
        print("row counts after seeding:")
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
