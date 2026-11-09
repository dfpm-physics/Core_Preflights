#!/usr/bin/env python3
"""Fill the STAGING project with made-up people and one test course, so a person can sign in.

Every name, email and answer here is invented. NEVER add real cadet data to staging: these
accounts use the site's own guessable default passwords, and staging is on the open internet.

WHAT IT MAKES
  Course phys-215, term fall-2026, sections M1A and T3A.
  Course phys-110, term fall-2026, section M1A: a second course, so a test can prove that a
            director of one course sees nothing of the other.
  Staff     admin@     global admin
            director@  director of the offering
            instructor@  instructor of M1A only
            otherdirector@  director of the phys-110 offering only
  Cadets    cadet101@ to cadet103@ in M1A, cadet104@ to cadet106@ in T3A (all @prep-staging.example)
            cadet999@  THE TEST CADET (3009999999), in M1A, with no work of their own. The live
                       test suites in tests/app-schema sign in as this cadet and write to their
                       own rows only; tests/app-schema/cleanup.py removes the residue.
            cadet201@  the only cadet in phys-110, with one submitted lesson, as the "other" cadet
  Lessons, with deadlines set around today so the site's 7-day window shows the right ones:
            test-lesson-01  past due. Cadets 101, 102 and 104 submitted. 101 has a final grade,
                            102 has an AI suggestion to review, 104 is ungraded, others none.
            test-lesson-02  due in 2 to 3 days. Cadet 101 has a saved draft.
            test-lesson-03  due in 30 days, so published but outside a cadet's 7-day window.
            test-lesson-04  an unpublished draft.
            test-lesson-05  due in 3 to 4 days. Written path graded, interactive path practice.
            test-lesson-06  due in 4 to 5 days. Both paths graded, so the cadet chooses.
            (05 and 06 carry an interactive path so the suites can exercise the practice and
            choice rules. The artifact address is a placeholder that opens nothing.)

PASSWORDS follow the site's own rules, and are not stored in this file:
  staff: last name in lower case + 1234.    cadets: last 6 digits of the cadet ID.
  No forced password change is set, so a tester goes straight in.

BREADTH ADDED 2026-11-04, so later proofs run on more than a handful of rows:
  Sections  W5A meets {F,W} (array order is not date order), MT7A meets {M,T}, both in phys-215.
            phys-310 (a third course) has one section, L1, with NO meeting days: a course with no
            day tracks.
  Cadets    cadet301@ to cadet320@ in phys-215, cadet321@ and cadet322@ in phys-310. All invented.
  Lessons   test-lesson-07 has an EMPTY due_by_day map and no per-section rows, so every section
            takes the offering's own date. test-lesson-08 has a map with a JSON null for M and
            values for T, W and F, so MT7A falls through to T and M1A falls through to the
            offering date. test-310-lesson-01 is a past-due offering of the no-day-track course.
  Effort    Cadets 301, 302, 303 and 304 have committed interactive reports on test-lesson-06 at
            effort 0, 2, 5, and 4 with a non-meaningful reflection (capped to 2). The grade
            trigger writes those grades; this script never sets their points.
  Extension Cadet 305: an active extension on test-lesson-01 (past due, no work in).
            Cadet 306: a revoked extension on the same lesson.
  Grades    Cadets 307 to 318 on test-lesson-01 and 02: final, AI-suggested, zero, and fractional
            (1.5 of 2) marks, plus submitted-but-ungraded and draft rows.

AN OLDER-PAGE-SHAPED ITEM, added 2026-11-09, so a proof can open and save one with no changes:
  test-lesson-09  published, written path only, per-day deadlines on all four meeting days (M and F at 2359, T and W at 1759, so the form cannot show
                  the pair exactly), per-section rows, a custom opening date (about two days before the M deadline),
                  a figure on Q3 and a reference PDF and pages. entered_on_new_page stays at its default (false).

TWO CLASSES FOR ONE CADET, added 2026-11-09, so the student's "All classes" page has something to merge:
  Course    phys-120 (STAGING TEST), term fall-2026, one section S1 that meets on M. Only a global admin sees it.
  Cadet     cadet105@ (3000000105, T3A in phys-215) is also enrolled in phys-120 S1, and signs in with the usual
            cadet rule (last 6 digits of the ID). In phys-215 that cadet has no work of their own, so lessons 02,
            05, 06, 07 and 08 are open and lesson 01 is past due. In phys-120 the cadet has:
            test-120-lesson-01  due in about 3 days, open.
            test-120-lesson-02  due about tomorrow, open, so it sorts first on the summary.
            test-120-lesson-03  due in 30 days: published but outside the 7-day window, so it must NOT be listed.
  The new course is left out of the counts that verify() makes, so those counts are unchanged.

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
import db_target  # noqa: E402
from serve_local import read_targets  # noqa: E402

NS = uuid.UUID("6f2b7c1e-58a4-4a0e-9d57-0d3b4c7f1a10")
DOMAIN = "prep-staging.example"
DENVER = ZoneInfo("America/Denver")

STAFF = [  # key, name, global admin
    ("admin", "Pat Admin", True),
    ("director", "Alex Director", False),
    ("instructor", "Sam Instructor", False),
    ("otherdirector", "Jordan Otherdirector", False),
]
CADETS = [  # cadet id, name, section
    (3000000101, "Avery Testcadet", "M1A"),
    (3000000102, "Blake Testcadet", "M1A"),
    (3000000103, "Cameron Testcadet", "M1A"),
    (3000000104, "Dana Testcadet", "T3A"),
    (3000000105, "Emery Testcadet", "T3A"),
    (3000000106, "Finley Testcadet", "T3A"),
    (3009999999, "Zed Testcadet", "M1A"),
]
# Twenty more, spread over four sections. Names are invented. Cadet ids are 3000000301 to 3000000320.
_EXTRA_NAMES = ["Harper", "Indigo", "Jules", "Kai", "Lane", "Marlowe", "Nico", "Oakley", "Parker",
                "Quinn", "Reese", "Sage", "Tatum", "Uri", "Vale", "Wren", "Xan", "Yael", "Zion", "Arden"]
_EXTRA_SECTIONS = ["M1A", "T3A", "W5A", "MT7A"]
CADETS += [(3000000301 + i, f"{name} Testcadet", _EXTRA_SECTIONS[i % 4])
           for i, name in enumerate(_EXTRA_NAMES)]
SECTIONS = [  # code, meeting days in array order, period
    ("M1A", ["M"], 1),
    ("T3A", ["T"], 3),
    ("W5A", ["F", "W"], 5),    # array order F then W: the first day with a value wins, not the earliest date
    ("MT7A", ["M", "T"], 7),
]
NODAY_CADETS = [(3000000321, "Blair Testcadet"), (3000000322, "Corin Testcadet")]  # phys-310, section L1
OTHER_CADET = (3000000201, "Gray Othercadet", "M1A")  # phys-110
LESSONS = [  # slug, title, days until the M deadline, published, interactive path
    ("test-lesson-01", "Test Lesson 1: Electric Charge", -8, True, None),
    ("test-lesson-02", "Test Lesson 2: Electric Fields", 2, True, None),
    ("test-lesson-03", "Test Lesson 3: Gauss's Law", 30, True, None),
    ("test-lesson-04", "Test Lesson 4: Electric Potential", 14, False, None),
    ("test-lesson-05", "Test Lesson 5: Capacitors", 3, True, "practice"),
    ("test-lesson-06", "Test Lesson 6: Current", 4, True, "graded"),
]
PLACEHOLDER_ARTIFACT = "https://example.org/prep-staging-test-artifact"


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
    for code, days_, period in SECTIONS:
        sections[code] = uid("section", code)
        cur.execute("""INSERT INTO app.sections (id, course_offering_id, code, meeting_days, period)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (sections[code], offering, code, days_, period))

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

    def add_lesson(pos, slug, title, days, published, interactive, due_by_day, section_rows,
                   opens_at=None, content_extra=None, question_extra=None):
        """due_by_day: the map to store. section_rows: [(section code, due)] explicit per-section rows."""
        assignment = uid("assignment", slug)
        offerings[slug], activities[slug] = uid("ao", slug), uid("activity", slug)
        m_due = deadline(days)
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
                     json.dumps(due_by_day), published, pos))
        if opens_at is not None:
            cur.execute("UPDATE app.assignment_offerings SET opens_at = %s WHERE id = %s", (opens_at, offerings[slug]))
        for section, due in section_rows:
            cur.execute("""INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
                           VALUES (%s, %s, %s)
                           ON CONFLICT (assignment_offering_id, section_id)
                           DO UPDATE SET due_at = EXCLUDED.due_at""",
                        (offerings[slug], sections[section], due))
        qs = questions()
        if question_extra:
            for q in qs:
                q.update(question_extra.get(q["id"], {}))
        content = {"questions": qs, "reading_link": None, "reference_pdf": None,
                   "reference_pages": None, "access": "open"}
        content.update(content_extra or {})
        cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                       VALUES (%s, %s, 'written', %s, %s, %s, 0) ON CONFLICT (id) DO NOTHING""",
                    (activities[slug], assignment, f"{slug}-written", title, json.dumps(content)))
        cur.execute("""INSERT INTO app.offering_activities
                         (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                       VALUES (%s, %s, 'graded', 'always', true, 0) ON CONFLICT DO NOTHING""",
                    (offerings[slug], activities[slug]))
        if interactive:
            inter = uid("activity", f"{slug}:interactive")
            cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                           VALUES (%s, %s, 'interactive', %s, %s, %s, 1) ON CONFLICT (id) DO NOTHING""",
                        (inter, assignment, f"{slug}-interactive", title,
                         json.dumps({"artifact_url": PLACEHOLDER_ARTIFACT, "access": "open"})))
            cur.execute("""INSERT INTO app.offering_activities
                             (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                           VALUES (%s, %s, %s, 'always', true, 1) ON CONFLICT DO NOTHING""",
                        (offerings[slug], inter, interactive))

    for pos, (slug, title, days, published, interactive) in enumerate(LESSONS, start=1):
        m_due, t_due = deadline(days), deadline(days + 1)
        add_lesson(pos, slug, title, days, published, interactive,
                   {"M": iso(m_due), "T": iso(t_due)},
                   [("M1A", m_due), ("T3A", t_due), ("W5A", deadline(days + 2)), ("MT7A", m_due)])
    # Shape cases for the deadline rule. Neither carries per-section rows, so the day map (or, with
    # an empty map, the offering's own date) is what each section resolves to.
    add_lesson(7, "test-lesson-07", "Test Lesson 7: Magnetism", 5, True, None, {}, [])
    add_lesson(8, "test-lesson-08", "Test Lesson 8: Induction", 6, True, None,
               {"M": None, "T": iso(deadline(7)), "W": iso(deadline(8)), "F": iso(deadline(9))}, [])

    # An item shaped the way the older editor stored one: a different time on each track (T is 1759, not 2359), a row per
    # section, a custom opening date, a figure and a reference PDF. A proof opens it on the Assignments page and saves it with no
    # change. It is a re-runnable fixture: deadlines and the opening date move with today, the rest is fixed.
    m9, t9 = deadline(8), deadline(9) - timedelta(hours=6)
    add_lesson(9, "test-lesson-09", "Test Lesson 9: Older-page item", 8, True, None,
               {"M": iso(m9), "T": iso(t9), "W": iso(t9), "F": iso(m9)},
               [("M1A", m9), ("T3A", t9), ("W5A", t9), ("MT7A", m9)],
               opens_at=m9 - timedelta(days=2, hours=16),
               content_extra={"reference_pdf": "Text_Book_PDFs/215 Sections/test.pdf", "reference_pages": "1-3"},
               question_extra={"q3": {"figure_url": "https://example.org/prep-staging-test-figure.png"}})

    answers = {"q1": "About 30 minutes.",
               "q2": "TEST ANSWER. I found the sign of the charge confusing at first.",
               "q3": "TEST ANSWER. Like charges repel and unlike charges attract."}

    def submit(cadet_id, slug, committed, committed_at=None):
        sub = uid("submission", f"{cadet_id}:{slug}")
        cur.execute("""INSERT INTO app.submissions
                         (id, assignment_offering_id, enrollment_id, chosen_activity_id, status, committed_at)
                       VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (sub, offerings[slug], enrollments[cadet_id],
                     activities[slug] if committed else None,
                     "committed" if committed else "draft",
                     (committed_at or deadline(-9)) if committed else None))
        cur.execute("""INSERT INTO app.submission_activities (id, submission_id, activity_id, content, is_final)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (uid("sub_activity", f"{cadet_id}:{slug}"), sub, activities[slug],
                     json.dumps(answers), committed))
        return sub

    def grade(cadet_id, slug, sub, final, q2=(1, "full"), q3=(1, "full")):
        """q2, q3: (score, status). A score may be fractional; points_earned is their sum."""
        scores = {
            "q1": {"score": 0, "max": 0, "feedback": "", "status": "full"},
            "q2": {"score": q2[0], "max": 1, "feedback": "", "status": q2[1]},
            "q3": {"score": q3[0], "max": 1,
                   "feedback": "TEST FEEDBACK. Good." if q3[1] == "full" else "TEST FEEDBACK. Revisit this.",
                   "status": q3[1]},
        }
        cur.execute("""INSERT INTO app.grades
                         (id, assignment_offering_id, enrollment_id, submission_id, points_earned,
                          points_possible, question_scores, source, is_finalized, graded_by, graded_at)
                       VALUES (%s, %s, %s, %s, %s, 2, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (uid("grade", f"{cadet_id}:{slug}"), offerings[slug], enrollments[cadet_id], sub,
                     q2[0] + q3[0], json.dumps(scores), "instructor" if final else "ai_suggested", final,
                     uid("user", "instructor") if final else None, deadline(-7) if final else None))

    grade(3000000101, "test-lesson-01", submit(3000000101, "test-lesson-01", True), final=True)
    grade(3000000102, "test-lesson-01", submit(3000000102, "test-lesson-01", True), final=False)
    submit(3000000104, "test-lesson-01", True)
    submit(3000000101, "test-lesson-02", False)

    # ---- breadth: effort-graded interactive reports --------------------------------------------
    # test-lesson-06 offers a graded interactive path. The report is stored while the submission is
    # still a draft and the submission is then committed with that activity chosen, because the
    # grade trigger reads the report at the moment of commit. The points are the trigger's work.
    inter06 = uid("activity", "test-lesson-06:interactive")

    def submit_interactive(cadet_id, effort, meaningful=True):
        sub = uid("submission", f"{cadet_id}:test-lesson-06")
        cur.execute("""INSERT INTO app.submissions (id, assignment_offering_id, enrollment_id, status)
                       VALUES (%s, %s, %s, 'draft') ON CONFLICT (id) DO NOTHING""",
                    (sub, offerings["test-lesson-06"], enrollments[cadet_id]))
        report = {"schema": 1, "effort": effort, "overall_understanding": min(effort, 4),
                  "reading_reflection": {"meaningful": meaningful}, "misconceptions": [], "flags": []}
        cur.execute("""INSERT INTO app.submission_activities
                         (id, submission_id, activity_id, content, report_markdown, is_final)
                       VALUES (%s, %s, %s, %s, %s, true) ON CONFLICT (id) DO NOTHING""",
                    (uid("sub_activity", f"{cadet_id}:test-lesson-06"), sub, inter06, json.dumps(report),
                     f"TEST REPORT. Effort {effort}."))
        cur.execute("""UPDATE app.submissions SET status = 'committed', chosen_activity_id = %s,
                              committed_at = %s
                        WHERE id = %s AND status = 'draft'""", (inter06, deadline(-1), sub))

    submit_interactive(3000000301, 0)
    submit_interactive(3000000302, 2)
    submit_interactive(3000000303, 5)
    submit_interactive(3000000304, 4, meaningful=False)   # the reflection cap holds it at 2

    # ---- breadth: extensions -------------------------------------------------------------------
    # 305 has no work in on a past-due lesson and an active extension that reaches into the future.
    # 306 had one and it was revoked. Neither has submitted: the table refuses to withdraw an
    # extension under work that is already in.
    ext_lesson = offerings["test-lesson-01"]
    cur.execute("""INSERT INTO app.extensions
                     (id, enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by)
                   VALUES (%s, %s, %s, %s, 'TEST REASON. Illness; more time agreed.', %s)
                   ON CONFLICT (id) DO UPDATE SET extended_due_at = EXCLUDED.extended_due_at""",
                (uid("extension", "305"), enrollments[3000000305], ext_lesson, deadline(2),
                 uid("user", "director")))
    cur.execute("""INSERT INTO app.extensions
                     (id, enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by,
                      revoked_at, revoked_by, revoked_reason)
                   VALUES (%s, %s, %s, %s, 'TEST REASON. Travel.', %s, %s, %s,
                           'TEST REASON. Granted in error.')
                   ON CONFLICT (id) DO NOTHING""",
                (uid("extension", "306"), enrollments[3000000306], ext_lesson, deadline(1),
                 uid("user", "instructor"), deadline(-4), uid("user", "director")))

    # ---- breadth: mixed grades on past-due lesson 01 and open lesson 02 ------------------------
    # Keep test-lesson-02 free of grades: a test that rescores an offering refuses to run on a graded one.
    day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    L1, L2 = "test-lesson-01", "test-lesson-02"
    grade(3000000307, L1, submit(3000000307, L1, True), final=True)                      # full marks
    grade(3000000308, L1, submit(3000000308, L1, True), final=True,
          q2=(0, "zero"), q3=(0, "zero"))                                               # a zero
    grade(3000000309, L1, submit(3000000309, L1, True), final=True,
          q2=(1, "full"), q3=(0.5, "warn"))                                             # 1.5 of 2
    grade(3000000310, L1, submit(3000000310, L1, True), final=False)                     # suggestion, 2
    grade(3000000311, L1, submit(3000000311, L1, True), final=False, q3=(0, "zero"))     # suggestion, 1
    grade(3000000312, L1, submit(3000000312, L1, True), final=False, q3=(0.5, "warn"))   # suggestion, 1.5
    submit(3000000313, L1, True)                                                         # not graded
    grade(3000000314, L1, submit(3000000314, L1, True), final=True, q3=(0, "zero"))      # final, 1
    submit(3000000315, L2, False)                                                        # a draft
    submit(3000000316, L2, True, committed_at=day_ago)                                   # not graded
    grade(3000000317, L1, submit(3000000317, L1, True), final=False)                     # suggestion, 2
    grade(3000000318, L1, submit(3000000318, L1, True), final=True,
          q2=(0.5, "warn"), q3=(1, "full"))                                             # 1.5 of 2
    submit(3000000319, "test-lesson-07", True, committed_at=day_ago)
    submit(3000000320, "test-lesson-08", False)

    # A second course with its own director and one cadet, so isolation between courses is testable.
    course2, offering2 = uid("course", "phys-110"), uid("offering", "phys-110:fall-2026")
    cur.execute("""INSERT INTO app.courses (id, code, title, department)
                   VALUES (%s, 'phys-110', 'Physics 110 (STAGING TEST)', 'Physics')
                   ON CONFLICT (id) DO NOTHING""", (course2,))
    cur.execute("""INSERT INTO app.course_offerings (id, course_id, term_id, is_active)
                   VALUES (%s, %s, %s, true) ON CONFLICT (id) DO NOTHING""", (offering2, course2, term))
    section2 = uid("section", "phys-110:M1A")
    cur.execute("""INSERT INTO app.sections (id, course_offering_id, code, meeting_days, period)
                   VALUES (%s, %s, 'M1A', %s, 1) ON CONFLICT (id) DO NOTHING""", (section2, offering2, ["M"]))
    cur.execute("""INSERT INTO app.staff_assignments
                     (id, instructor_id, course_offering_id, section_id, role)
                   VALUES (%s, %s, %s, NULL, 'director') ON CONFLICT (id) DO NOTHING""",
                (uid("staff", "otherdirector"), uid("user", "otherdirector"), offering2))
    cadet_id, name, _ = OTHER_CADET
    user_id = uid("user", cadet_id)
    email = f"cadet{str(cadet_id)[-3:]}@{DOMAIN}"
    add_auth_user(cur, user_id, email, cadet_password(cadet_id))
    cur.execute("""INSERT INTO app.students (student_id, name, email, auth_user_id)
                   VALUES (%s, %s, %s, %s) ON CONFLICT (student_id) DO NOTHING""",
                (cadet_id, name, email, user_id))
    enrollments[cadet_id] = uid("enrollment", cadet_id)
    cur.execute("""INSERT INTO app.enrollments (id, student_id, section_id)
                   VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                (enrollments[cadet_id], cadet_id, section2))
    slug2 = "test-110-lesson-01"
    assignment2 = uid("assignment", slug2)
    offerings[slug2], activities[slug2] = uid("ao", slug2), uid("activity", slug2)
    due2 = deadline(-8)
    cur.execute("""INSERT INTO app.assignments (id, course_id, kind_id, slug, title)
                   VALUES (%s, %s, 'preflight', %s, 'Test 110 Lesson 1') ON CONFLICT (id) DO NOTHING""",
                (assignment2, course2, slug2))
    cur.execute("""INSERT INTO app.assignment_offerings
                     (id, assignment_id, course_offering_id, due_at, due_by_day, grading_mode,
                      points_possible, is_published, position)
                   VALUES (%s, %s, %s, %s, %s, 'points', 2, true, 1) ON CONFLICT (id) DO NOTHING""",
                (offerings[slug2], assignment2, offering2, due2,
                 json.dumps({"M": iso(due2), "T": iso(deadline(-7))})))
    cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                   VALUES (%s, %s, 'written', %s, 'Test 110 Lesson 1', %s, 0) ON CONFLICT (id) DO NOTHING""",
                (activities[slug2], assignment2, f"{slug2}-written",
                 json.dumps({"questions": questions(), "reading_link": None, "reference_pdf": None,
                             "reference_pages": None, "access": "open"})))
    cur.execute("""INSERT INTO app.offering_activities
                     (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                   VALUES (%s, %s, 'graded', 'always', true, 0) ON CONFLICT DO NOTHING""",
                (offerings[slug2], activities[slug2]))
    submit(cadet_id, slug2, True)

    # A third course with no day tracks: its one section has an empty meeting_days array and no
    # period, and its lesson has an empty day map. Only a global admin sees it.
    course3, offering3 = uid("course", "phys-310"), uid("offering", "phys-310:fall-2026")
    cur.execute("""INSERT INTO app.courses (id, code, title, department)
                   VALUES (%s, 'phys-310', 'Physics 310 (STAGING TEST)', 'Physics')
                   ON CONFLICT (id) DO NOTHING""", (course3,))
    cur.execute("""INSERT INTO app.course_offerings (id, course_id, term_id, is_active)
                   VALUES (%s, %s, %s, true) ON CONFLICT (id) DO NOTHING""", (offering3, course3, term))
    section3 = uid("section", "phys-310:L1")
    cur.execute("""INSERT INTO app.sections (id, course_offering_id, code, meeting_days, period)
                   VALUES (%s, %s, 'L1', '{}', NULL) ON CONFLICT (id) DO NOTHING""", (section3, offering3))
    for cadet_id, name in NODAY_CADETS:
        user_id = uid("user", cadet_id)
        email = f"cadet{str(cadet_id)[-3:]}@{DOMAIN}"
        add_auth_user(cur, user_id, email, cadet_password(cadet_id))
        cur.execute("""INSERT INTO app.students (student_id, name, email, auth_user_id)
                       VALUES (%s, %s, %s, %s) ON CONFLICT (student_id) DO NOTHING""",
                    (cadet_id, name, email, user_id))
        enrollments[cadet_id] = uid("enrollment", cadet_id)
        cur.execute("""INSERT INTO app.enrollments (id, student_id, section_id)
                       VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (enrollments[cadet_id], cadet_id, section3))
    slug3 = "test-310-lesson-01"
    assignment3 = uid("assignment", slug3)
    offerings[slug3], activities[slug3] = uid("ao", slug3), uid("activity", slug3)
    due3 = deadline(-6)
    cur.execute("""INSERT INTO app.assignments (id, course_id, kind_id, slug, title)
                   VALUES (%s, %s, 'preflight', %s, 'Test 310 Lesson 1') ON CONFLICT (id) DO NOTHING""",
                (assignment3, course3, slug3))
    cur.execute("""INSERT INTO app.assignment_offerings
                     (id, assignment_id, course_offering_id, due_at, due_by_day, grading_mode,
                      points_possible, is_published, position)
                   VALUES (%s, %s, %s, %s, '{}', 'points', 2, true, 1)
                   ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at""",
                (offerings[slug3], assignment3, offering3, due3))
    cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                   VALUES (%s, %s, 'written', %s, 'Test 310 Lesson 1', %s, 0) ON CONFLICT (id) DO NOTHING""",
                (activities[slug3], assignment3, f"{slug3}-written",
                 json.dumps({"questions": questions(), "reading_link": None, "reference_pdf": None,
                             "reference_pages": None, "access": "open"})))
    cur.execute("""INSERT INTO app.offering_activities
                     (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                   VALUES (%s, %s, 'graded', 'always', true, 0) ON CONFLICT DO NOTHING""",
                (offerings[slug3], activities[slug3]))
    grade(3000000321, slug3, submit(3000000321, slug3, True), final=True)
    submit(3000000322, slug3, True)

    # A fourth course, so ONE cadet (3000000105) is in two classes at once and has open work in both. The course is
    # not in the walk's or the verify's course lists, so nothing that counts rows changes. Deadlines move on a re-run.
    course4, offering4 = uid("course", "phys-120"), uid("offering", "phys-120:fall-2026")
    cur.execute("""INSERT INTO app.courses (id, code, title, department)
                   VALUES (%s, 'phys-120', 'Physics 120 (STAGING TEST)', 'Physics')
                   ON CONFLICT (id) DO NOTHING""", (course4,))
    cur.execute("""INSERT INTO app.course_offerings (id, course_id, term_id, is_active)
                   VALUES (%s, %s, %s, true) ON CONFLICT (id) DO NOTHING""", (offering4, course4, term))
    section4 = uid("section", "phys-120:S1")
    cur.execute("""INSERT INTO app.sections (id, course_offering_id, code, meeting_days, period)
                   VALUES (%s, %s, 'S1', %s, 2) ON CONFLICT (id) DO NOTHING""", (section4, offering4, ["M"]))
    two_class_cadet = 3000000105
    enrollments[("120", two_class_cadet)] = uid("enrollment", f"120:{two_class_cadet}")
    cur.execute("""INSERT INTO app.enrollments (id, student_id, section_id)
                   VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                (enrollments[("120", two_class_cadet)], two_class_cadet, section4))
    for n, days in ((1, 3), (2, 1), (3, 30)):
        slug4 = f"test-120-lesson-{n:02d}"
        title4 = f"Test 120 Lesson {n}"
        assignment4 = uid("assignment", slug4)
        offerings[slug4], activities[slug4] = uid("ao", slug4), uid("activity", slug4)
        cur.execute("""INSERT INTO app.assignments (id, course_id, kind_id, slug, title)
                       VALUES (%s, %s, 'preflight', %s, %s) ON CONFLICT (id) DO NOTHING""",
                    (assignment4, course4, slug4, title4))
        cur.execute("""INSERT INTO app.assignment_offerings
                         (id, assignment_id, course_offering_id, due_at, due_by_day, grading_mode,
                          points_possible, is_published, position)
                       VALUES (%s, %s, %s, %s, %s, 'points', 2, true, %s)
                       ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at, due_by_day = EXCLUDED.due_by_day""",
                    (offerings[slug4], assignment4, offering4, deadline(days),
                     json.dumps({"M": iso(deadline(days))}), n))
        cur.execute("""INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (assignment_offering_id, section_id) DO UPDATE SET due_at = EXCLUDED.due_at""",
                    (offerings[slug4], section4, deadline(days)))
        cur.execute("""INSERT INTO app.activities (id, assignment_id, modality, slug, title, content, position)
                       VALUES (%s, %s, 'written', %s, %s, %s, 0) ON CONFLICT (id) DO NOTHING""",
                    (activities[slug4], assignment4, f"{slug4}-written", title4,
                     json.dumps({"questions": questions(), "reading_link": None, "reference_pdf": None,
                                 "reference_pages": None, "access": "open"})))
        cur.execute("""INSERT INTO app.offering_activities
                         (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position)
                       VALUES (%s, %s, 'graded', 'always', true, 0) ON CONFLICT DO NOTHING""",
                    (offerings[slug4], activities[slug4]))


def counts(cur):
    for table in ("courses", "sections", "instructors", "staff_assignments", "students", "enrollments",
                  "assignments", "assignment_offerings", "assignment_due_dates", "activities",
                  "offering_activities", "submissions", "submission_activities", "grades",
                  "extensions"):
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


# The verify counts only the courses the seeds build. The worked examples the walkthroughs leave on staging
# (the roster course, the items-without-days course, whatever comes next) are real rows of their own and must
# neither be counted here nor be removed to make a count come out. A walkthrough keeps its invented cadets in its
# own id range (the roster one uses 3000000801 to 3000000899), so a reset can never reach a seeded cadet.
SEED_COURSES = "phys-110,phys-215,phys-310,gate-entry,gate-train,gate-vector"
_CHAIN = "sections!inner(course_offerings!inner(courses!inner(code)))"
_FILTER = f"sections.course_offerings.courses.code=in.({SEED_COURSES})"
SEED_ROWS = {
    "enrollments": f"select=id,{_CHAIN}&{_FILTER}",
    "grades": f"select=id,enrollments!inner({_CHAIN})&enrollments.{_FILTER}",
    "students": f"select=student_id,enrollments!inner({_CHAIN})&enrollments.{_FILTER}",
}


def verify():
    _, staging = read_targets()
    url, key = staging["url"], staging["anon"]
    # who, password, enrollments, grades, students they should see
    expected = [
        # An admin sees every course. The v2 gate seed (seed_v2_gate.py) adds 21 cadets, 21 enrollments and
        # 33 grades of its own, so the admin's totals are the base seed's, or the base seed plus the gate seed's.
        # seed_v2_training.py adds 10 cadets, 10 enrollments and 32 grades more (the third value of each).
        ("admin", staff_password("Pat Admin"), (30, 51, 61), (16, 49, 81), (30, 51, 61)),
        ("director", staff_password("Alex Director"), 27, 15, 27),
        ("instructor", staff_password("Sam Instructor"), 9, 5, 9),
        ("otherdirector", staff_password("Jordan Otherdirector"), 1, 0, 1),
        ("cadet101", cadet_password(3000000101), 1, 1, 1),
        ("cadet104", cadet_password(3000000104), 1, 0, 1),
        ("cadet999", cadet_password(3009999999), 1, 0, 1),
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
        seen = {t: len(rest(url, key, f"/rest/v1/{t}?{q}", token)[1] or []) for t, q in SEED_ROWS.items()}
        def _is(got, want):
            return got in want if isinstance(want, tuple) else got == want
        ok = (_is(seen["enrollments"], want_enrol) and _is(seen["grades"], want_grades)
              and _is(seen["students"], want_students))
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
    # The breadth rows: what the grade trigger made of each effort, and the two extensions.
    if "admin" in tokens:
        want = {3000000301: (0, 0.0), 3000000302: (2, 1.0), 3000000303: (5, 2.0), 3000000304: (2, 1.0)}
        _, rows = rest(url, key, "/rest/v1/grades?effort=not.is.null&select=effort,points_earned,"
                       "is_finalized,enrollments(student_id)", tokens["admin"])
        got = {r["enrollments"]["student_id"]: (r["effort"], float(r["points_earned"]))
               for r in rows or [] if r["is_finalized"]}
        ok = got == want
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  effort grades made by the trigger: {got}"
              + ("" if ok else f"; expected {want}"))
        _, exts = rest(url, key, "/rest/v1/extensions?select=revoked_at", tokens["admin"])
        live = sum(1 for e in exts or [] if e["revoked_at"] is None)
        # The base seed has 2 (1 active). The v2 gate seed adds 4 (3 active, 1 revoked) for the deadline proof.
        ok = (len(exts or []), live) in ((2, 1), (6, 4))
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  extensions: {len(exts or [])} rows, {live} active"
              + ("" if ok else "; expected 2 rows, 1 active (base) or 6 and 4 (with the gate seed)"))
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
    ref = db_target.exit_unless_staging(url, args.expect_ref).ref
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
