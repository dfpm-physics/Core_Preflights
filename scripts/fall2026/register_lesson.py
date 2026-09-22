#!/usr/bin/env python
"""Register one lesson: the assignment, its offering, both activities, and every due date.

WHY THIS IS A SCRIPT AND NOT THE LESSONS PAGE
    `site/faculty/lessons.html` is the normal door and stays the normal door. It needs a signed-in
    director in a browser, and an agent cannot supply one. What it does that a naive REST insert
    does NOT is write the deadline to all THREE places it lives — `assignment_offerings.due_at`,
    `assignment_offerings.due_by_day`, and a per-section `assignment_due_dates` row. CORE.md §2
    records what an empty `due_by_day` costs: every section silently inherits the M-day deadline,
    invisible to a spot check because `due_at` reads correctly. So this script writes all three, the
    same way `set_due_dates.py` repairs all three.

WHAT IT WRITES  (five tables, and nothing else)
    app.assignments            one row per lesson, keyed (course_id, slug)
    app.assignment_offerings   one row per (course offering, assignment)
    app.assignment_due_dates   one row per section of that course offering
    app.activities             the written and the interactive activity, per offering
    app.offering_activities    which of those carry credit this term

    It NEVER deletes a row and never detaches an activity. Detaching one a student has committed
    to nulls their `chosen_activity_id` through the composite FK.

RE-RUNNING NEVER REWRITES A LIVE ROW BY DEFAULT.  Every step is create-if-absent, so a second
run reports zero changes even where the live row has since been edited by hand in the lessons
page -- the common case, and not something a script may revert. Two fields CAN be reconciled,
and only when the PLAN entry opts in by name:

    "reconcile_due": True             re-dates the offering, rewriting all THREE places a
                                      deadline lives. Moving one EARLIER additionally needs
                                      --allow-earlier (CORE.md section 2).
    "reconcile_artifact_url": True    re-points the interactive activity's launch target. The
                                      slug is never touched, so this is a transport change and
                                      nothing downstream can tell.

A LESSON IS REGISTERED AS A DRAFT.  `is_published` is FALSE in every PLAN entry below and this
    script will not flip it. Publishing is a human decision made on the lessons page after the
    director has read the lesson back. Note that publishing is still not RELEASING: a published
    offering appears to a cadet only inside the 7-day window before their own deadline
    (CORE.md §2).

IDEMPOTENT: every write is an upsert keyed on the natural key, and a second run reports zero
changes. Runs as the DML tier — data only, no DDL. Dry-run by default (CORE.md §4): every write
happens inside a transaction that is ROLLED BACK unless --commit is passed, so the read-back
below reflects real writes against real constraints either way.

ADDING A LESSON IS A NEW ENTRY IN `PLAN` AND NOTHING ELSE — never a fork of this file.

Usage (Windows: .venv\\Scripts\\python):
  .venv/bin/python scripts/fall2026/register_lesson.py --course phys-310 --lesson 13
  .venv/bin/python scripts/fall2026/register_lesson.py --course phys-310 --lesson 13 --commit
"""

import argparse
import json
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase" / "admin"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, Json
except ImportError:  # pragma: no cover - environment guard
    sys.exit("psycopg2 not found - use the project .venv (pip install -r requirements.txt).")

from app_tier_check import read_env  # noqa: E402

ENV_FILE = REPO / "supabase" / "admin" / ".env"

# The two default questions every written preflight opens with. Q1 is the zero-point reading-time
# diagnostic (CORE.md §2 keeps it off per-student grade cards and off any names toggle); Q2 is the
# reading reflection, whose judgment caps effort when it is not meaningful. A lesson adds its own
# free-response questions after these.
Q_READING_TIME = {
    "id": "q1",
    "role": "reading_time",
    "text": "How much time did you spend reading the book in preparation for this lesson?",
    "type": "free_response",
    "points": 0,
    "figure_url": "",
    "student_note": "Your response is visible to your instructor, but your name is not shown — "
                    "it is for an overall class diagnostic.",
}
Q_READING_REFLECTION = {
    "id": "q2",
    "role": "reading_reflection",
    "text": "What did you find most confusing or most interesting about the reading? "
            "Be specific and thorough in your discussion.",
    "type": "free_response",
    "points": 1,
    "figure_url": "",
    "expected_response": "Reading reflection: judge whether this is a meaningful engagement with "
                         "the reading — genuine and specific, not blank, gibberish, or a "
                         "throwaway one-liner. It need not be long, just meaningful. A "
                         "non-meaningful reflection caps the student's effort.",
}

# ── What each course wants, per lesson number ────────────────────────────────────────────────
#
# `due_at` is stored UTC and is the instant the deadline falls. PHYS 310's policy is 1959
# America/Denver the night before the lesson meets, which during MDT is `<lesson date> 01:59:59Z` —
# the same shape every already-registered lesson in this course carries. Check it against the
# course's schedule table, not against memory.
#
# `interactive_slug` is read from the artifact's own INTERACTION_ID and NEVER retyped or
# re-derived (docs/operations/PREFILL-LINK.md — a slug that does not match the artifact's is the
# failure where every cadet completes the lesson and the receiver silently drops the report).
PLAN = {
    ("phys-310", 13): {
        "assignment_slug": "lesson-13",
        "kind_id": "preflight",
        "title": "Lesson 13 Preflight -- Radiation Interactions with Materials",
        "position": 13,
        "points_possible": 3,
        "grading_mode": "points",
        "switch_policy": "lock_on_commit",
        "is_published": False,          # draft; the director publishes from the lessons page
        "opens_at": None,               # NULL selects the rolling 7-day release window
        "due_at": "2026-09-14 01:59:59+00",   # Sun 13 Sep 1959 MDT, the night before Mon 14 Sep
        "day_key": "T",                 # this course's one section is a T-day section
        "interactive_title": "Radiation Interactions with Materials",
        "interactive_slug": "phys310-radiation-interactions-with-materials-1dd51596",
        "artifact_url": "https://claude.ai/public/artifacts/"
                        "cefd54d7-e429-4972-85ac-4646eab622c9",
        "written_slug": "phys-310-lesson-13-written-4b7c1e02",
        "written_role": "graded",
        "interactive_role": "graded",
        "reference_pdf": None,
        "reference_pages": None,
        # One free-response question beyond the two defaults, worth the remaining 2 points.
        # Written against the lesson's own deck: part (a) is objective 1 (range versus
        # attenuation) and part (b) is objective 2 (what each charged particle collides with,
        # and what the mass ratio does to the track).
        "questions": [
            {
                "id": "q3",
                "role": "free_response",
                "text": "A 2 MeV alpha particle, a 2 MeV beta particle and a 2 MeV gamma ray all "
                        "enter the same block of aluminum. (a) Explain why it makes sense to give "
                        "the alpha and the beta a range but not the gamma — what is different "
                        "about the way each one interacts on the way in? (b) Both the alpha and "
                        "the beta stop inside the block, but only one of them travels in a nearly "
                        "straight line. Which one, and what is it about the collisions that "
                        "decides it?",
                "type": "free_response",
                "points": 2,
                "figure_url": "",
                "correct_answer": "",
                "expected_response":
                    "(a) A charged particle interacts continuously, through the Coulomb force, "
                    "with every atomic electron it passes — the force has no cut-off, so "
                    "there is no slipping past. It therefore pays out energy the whole way and "
                    "eventually runs out, and the distance at which that happens is the range. A "
                    "gamma interacts only in discrete, probabilistic events (photoelectric, "
                    "Compton, pair production): it either has an interaction or it does not, so "
                    "the question is never how far it goes but what fraction is left. That gives "
                    "attenuation, phi(x) = phi_0 exp(-mu x), which is asymptotic — no finite "
                    "thickness reduces it to zero, so there is no range. "
                    "(b) The alpha travels nearly straight. It is thousands of times heavier than "
                    "the electrons it is hitting, so each collision costs it only a sliver of "
                    "energy and barely deflects it; it takes thousands of them to stop it. The "
                    "beta is hitting particles of its own mass, so a single collision can deflect "
                    "it strongly and its path is tortuous — the depth it reaches is less than "
                    "the length of track it travelled. It is the MASS RATIO of the colliding pair "
                    "that decides the shape of the track, not the charge and not the speed. "
                    "GRADING: full credit for the continuous-versus-discrete mechanism in (a) and "
                    "for the mass-ratio argument in (b). Do not require any formula, any number, "
                    "or the word 'asymptotic'. A cadet who answers (b) with charge or speed has "
                    "the right particle from the wrong physics — flag it, do not zero it.",
            },
        ],
    },
    ("phys-310", 15): {
        # ALREADY PARTLY REGISTERED on 2026-09-18: the assignment, the offering and both
        # activities exist, but the offering_activities rows were never written, so the
        # lesson rendered as an empty assignment. This entry attaches them and reconciles the
        # two fields the course director changed on 2026-09-22 (a new deadline, and the
        # Gemini route). The two slugs below are the EXISTING rows' slugs, read out of the
        # database and out of the artifact source — changing either would orphan the lesson.
        "assignment_slug": "lesson-15",
        "kind_id": "preflight",
        "title": "Lesson 15 Preflight -- Dose and Shielding",
        "position": 15,
        "points_possible": 3,
        "grading_mode": "points",
        "switch_policy": "lock_on_commit",
        "is_published": False,          # draft; the director publishes from the lessons page
        "opens_at": None,               # NULL selects the rolling 7-day release window
        # MAKEUP DEADLINE, at the course director's instruction (2026-09-22): "Friday at noon.
        # It's essentially a makeup and my fault it wasn't ready in time." Friday is 25 Sep.
        # Stored as the last instant before noon, the shape this course's rows carry.
        "due_at": "2026-09-25 17:59:59+00",   # Fri 25 Sep 11:59:59 MDT
        "reconcile_due": True,          # it was 2026-09-21 09:00:59 MDT, already past. LATER.
        "day_key": "T",                 # this course's one section is a T-day section
        "interactive_title": "Dose and Shielding",
        "interactive_slug": "phys310-dose-and-shielding-43f26ac6",
        # GEMINI ROUTE, at the course director's instruction, same as Lab 2. The claude.ai
        # artifact stays published and simply unused — and it would be the WRONG lesson now:
        # a published artifact serves what was published, so it still probes the objectives
        # this source carried before 2026-09-18 and before today's deck alignment.
        "artifact_url": "https://dfpm-physics.github.io/Core_Preflights/site/student/"
                        "backup.html?i=phys310-dose-and-shielding-43f26ac6&go=1",
        "reconcile_artifact_url": True,
        "written_slug": "phys-310-lesson-15-written-5c1af3d0",
        "written_role": "graded",
        "interactive_role": "graded",
        "reference_pdf": None,
        "reference_pages": None,
        # NOT USED on this run — the written activity already exists with its q3, written on
        # 2026-09-18, and this script never rewrites an existing activity's questions. Kept
        # here so the entry reads as a complete description of the lesson.
        "questions": [],
    },
    ("phys-310", 16): {
        "assignment_slug": "lesson-16",
        "kind_id": "preflight",
        "title": "Lab 2: Distance and Shielding",
        "position": 16,
        "points_possible": 3,
        "grading_mode": "points",
        "switch_policy": "lock_on_commit",
        "is_published": False,          # draft; the director publishes from the lessons page
        "opens_at": None,               # NULL selects the rolling 7-day release window
        # 0800 America/Denver on the lesson day itself, at the course director's instruction
        # (2026-09-22) — not this course's usual 1959-the-night-before. Stored as the last
        # instant BEFORE 0800, which is the shape every other row in this course carries
        # (lesson 13's 0900 deadline is stored 14:59:59Z).
        "due_at": "2026-09-23 13:59:59+00",   # Wed 23 Sep 07:59:59 MDT
        "day_key": "T",                 # this course's one section is a T-day section
        "interactive_title": "Lab 2: Distance and Shielding",
        # Read from the artifact source's INTERACTION_ID, never retyped.
        "interactive_slug": "phys310-lab-2-distance-and-shielding-a5909322",
        # THERE IS NO CLAUDE ARTIFACT FOR THIS LESSON — it was built for the Gemini transport
        # only. `artifact_url` is still required (isArtifactLaunchable in site/js/schema.js
        # refuses to offer a Launch button without an http(s) URL), so it points at the same
        # backup router the Gemini button uses. Cadets reach one tutor, by one route.
        "artifact_url": "https://dfpm-physics.github.io/Core_Preflights/site/student/"
                        "backup.html?i=phys310-lab-2-distance-and-shielding-a5909322&go=1",
        "written_slug": "phys-310-lesson-16-written-16e5bd05",
        "written_role": "graded",
        "interactive_role": "graded",
        "reference_pdf": None,
        "reference_pages": None,
        # One free-response question beyond the two defaults, worth the remaining 2 points.
        # Written against the cadet's own Lab 2 write-up: part (a) is Part 1 discussion
        # question 1 (the derivation behind the slope) and part (b) is Part 1 discussion
        # questions 4 and 5 (a constant factor cannot move a slope).
        "questions": [
            {
                "id": "q3",
                "role": "free_response",
                "text": "In Part 1 of Lab 2 you put four thicknesses of lead between a Cs-137 "
                        "source and the GM tube, and the spreadsheet plots ln(flux) against "
                        "rho*x — density times thickness, in g/cm^2. (a) Starting from "
                        "phi = phi_0 e^(-mu x), show why the slope of that plot is the mass "
                        "attenuation coefficient mu/rho. (b) Your tube counts only about 10% of "
                        "the gammas that reach it, and Part 1 ignores the 1/r^2 law entirely. "
                        "Explain why neither of those changes the mu/rho you get from the plot — "
                        "and say what a poor detector efficiency does cost you.",
                "type": "free_response",
                "points": 2,
                "figure_url": "",
                "correct_answer": "",
                "expected_response":
                    "(a) Write mu x as (mu/rho)(rho x). Taking the natural log of "
                    "phi = phi_0 e^(-mu x) gives ln(phi) = ln(phi_0) - (mu/rho)(rho x), which is "
                    "a straight line in the plotted variable rho x with slope -(mu/rho) and "
                    "intercept ln(phi_0). So the slope read off the semi-log plot IS the mass "
                    "attenuation coefficient, with a minus sign — no division by the density is "
                    "needed, which is the whole reason the x-axis is density thickness rather "
                    "than centimetres. "
                    "(b) Both are CONSTANT multipliers on every point. A detector of fixed "
                    "efficiency e reports e times the flux; the fixed 5 cm geometry contributes "
                    "the same 1/(4 pi r^2) to every count because the distance never changes "
                    "while the shielding does. A constant multiplier becomes a constant ADDED to "
                    "ln(phi), so it moves the INTERCEPT and cannot touch the slope. What a low "
                    "efficiency does cost is counts: fewer counts means a larger sqrt(N) "
                    "uncertainty on every point, so the slope is less PRECISE even though it is "
                    "not BIASED. "
                    "GRADING: full credit for the mu x = (mu/rho)(rho x) split and the slope in "
                    "(a), and for 'constant factor moves the intercept, not the slope' in (b). "
                    "Do not require the intercept's meaning or any number. A cadet who says "
                    "Part 1 may ignore 1/r^2 'because 5 cm is close' has the wrong reason — it is "
                    "fixed, not small — flag it, do not zero it. The precision-versus-bias point "
                    "in (b) is the stretch; credit it warmly, do not require it.",
            },
        ],
    },
    ("phys-310", 17): {
        "assignment_slug": "lesson-17",
        "kind_id": "preflight",
        "title": "Lesson 17 Preflight -- Detection Methods I",
        "position": 17,
        "points_possible": 3,
        "grading_mode": "points",
        "switch_policy": "lock_on_commit",
        "is_published": False,          # draft; the director publishes from the lessons page
        "opens_at": None,               # NULL selects the rolling 7-day release window
        # 0800 America/Denver on the lesson day, at the course director's instruction
        # (2026-09-22). Stored as the last instant BEFORE 0800, the shape every row in this
        # course carries. NOTE this lands four hours EARLIER than lesson 15's makeup deadline
        # on the same day; that is deliberate and is what was asked for.
        "due_at": "2026-09-25 13:59:59+00",   # Fri 25 Sep 07:59:59 MDT
        "day_key": "T",                 # this course's one section is a T-day section
        "interactive_title": "Detection Methods I: Efficiency and Gas-Filled Detectors",
        # THE EXISTING ARTIFACT'S SLUG, read out of the source's INTERACTION_ID and never
        # retyped. The source was re-aimed to the instructor's deck on 2026-09-22 and the slug
        # deliberately did NOT move -- activities.slug is globally unique and a new one would
        # split the cohort. The course is taught out of the workbook's order, so this is the
        # FIRST detector lesson even though the artifact's slug says lesson 18's topic.
        "interactive_slug": "phys310-detection-methods-gas-filled-detectors-edc3bbb5",
        # GEMINI ROUTE, same as lessons 15 and 16. The claude.ai artifact published 2026-08-20
        # still serves what was published, so it probes the OLD objectives -- it is the wrong
        # lesson now, and pointing a cadet at it would be worse than having no Claude build.
        "artifact_url": "https://dfpm-physics.github.io/Core_Preflights/site/student/"
                        "backup.html?i=phys310-detection-methods-gas-filled-detectors-edc3bbb5&go=1",
        "written_slug": "phys-310-lesson-17-written-7b3003f8",
        "written_role": "graded",
        "interactive_role": "graded",
        "reference_pdf": None,
        "reference_pages": None,
        # One free-response question beyond the two defaults, worth the remaining 2 points.
        # Both halves are reachable BEFORE the lesson from work the cadet has already done --
        # (a) is the area of a sphere and (b) is the shielding lesson's attenuation law read
        # the other way round -- which is what makes it a preflight rather than a quiz on
        # material nobody has seen. Together they are the lesson's whole architecture.
        "questions": [
            {
                "id": "q3",
                "role": "free_response",
                "text": "A small source emits S particles per second equally in all directions. "
                        "A detector with a flat face of area A sits a distance r away. "
                        "(a) Derive the fraction of the emitted particles that even reach the "
                        "face, and say what happens to that fraction if you move the detector "
                        "from r to 2r. (b) A gamma that reaches the face can still cross the "
                        "whole detector without interacting. Using the attenuation law "
                        "I = I_0 e^(-mu x) from the shielding lesson, write down the fraction "
                        "that DOES interact within a detector of depth d, and explain why a "
                        "large mu is what you want in a detector but not in a shield.",
                "type": "free_response",
                "points": 2,
                "figure_url": "",
                "correct_answer": "",
                "expected_response":
                    "(a) The emission spreads over a sphere of area 4 pi r^2, and the face "
                    "intercepts only its own area's share, so the fraction is A / (4 pi r^2). "
                    "Doubling r multiplies the sphere area by 4, so the fraction falls to a "
                    "QUARTER of what it was -- and nothing about the detector changed. "
                    "(b) e^(-mu d) is the fraction that passes straight through without "
                    "interacting, so the fraction that interacts is 1 - e^(-mu d). A large mu "
                    "means the material is more likely to interact with the radiation. In a "
                    "shield that is a virtue because you want the radiation stopped before it "
                    "reaches you; in a detector it is the SAME virtue for the opposite purpose, "
                    "because an interaction is the only thing a detector can register -- a gamma "
                    "that sails through is a gamma you never counted. "
                    "GRADING: full credit for A/(4 pi r^2) and the factor of four in (a), and "
                    "for 1 - e^(-mu d) with a reason for wanting mu large in (b). Do not require "
                    "the words geometric or intrinsic -- the cadet has not met them yet. A cadet "
                    "who writes e^(-mu d) instead of 1 - e^(-mu d) has the complement flipped, "
                    "which is the single most useful thing this question can find: flag it, do "
                    "not zero it. A cadet who says a detector should have a SMALL mu has imported "
                    "the shielding lesson's preference -- flag it, and note it, because that is "
                    "the misconception the lesson is built to catch.",
            },
        ],
    },
}


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


def one(cur, sql, args=()):
    cur.execute(sql, args)
    row = cur.fetchone()
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True)
    ap.add_argument("--lesson", required=True, type=int)
    ap.add_argument("--commit", action="store_true", help="write (default: dry run, rolled back)")
    ap.add_argument("--allow-earlier", action="store_true",
                    help="permit moving an existing deadline EARLIER (CORE.md section 2: "
                         "that takes time away from cadets and is the human's call)")
    args = ap.parse_args()

    plan = PLAN.get((args.course, args.lesson))
    if plan is None:
        sys.exit(f"No PLAN entry for {args.course} lesson {args.lesson} - add one, do not fork.")
    if plan["is_published"]:
        sys.exit("PLAN entry is marked published. This script only registers drafts.")

    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()
    changed = []

    course = one(cur, "select id from app.courses where code = %s", (args.course,))
    if not course:
        sys.exit(f"No course {args.course}")
    co = one(cur, "select id from app.course_offerings where course_id = %s and is_active",
             (course["id"],))
    if not co:
        sys.exit(f"No active course offering for {args.course}")
    print(f"=== {args.course} lesson {args.lesson} · course_offering {co['id']} ===")

    # 1. assignment ------------------------------------------------------------------------
    row = one(cur, "select id, title from app.assignments where course_id=%s and slug=%s",
              (course["id"], plan["assignment_slug"]))
    if row is None:
        row = one(cur, """insert into app.assignments (id, course_id, kind_id, slug, title,
                               objectives, is_archived)
                          values (%s,%s,%s,%s,%s,'[]'::jsonb,false) returning id, title""",
                  (str(uuid.uuid4()), course["id"], plan["kind_id"],
                   plan["assignment_slug"], plan["title"]))
        changed.append(f"assignment {plan['assignment_slug']}")
    assignment_id = row["id"]
    print(f"  assignment        {plan['assignment_slug']}  {assignment_id}")

    # 2. offering --------------------------------------------------------------------------
    row = one(cur, """select id, due_at from app.assignment_offerings
                      where course_offering_id=%s and assignment_id=%s""",
              (co["id"], assignment_id))
    if (row is not None and plan.get("reconcile_due")
            and str(row["due_at"]) != plan["due_at"].replace("+00", "+00:00")):
        # RECONCILE A DEADLINE THAT HAS MOVED.  Added 2026-09-22, when lesson 15 had to be
        # re-dated as a makeup. Everything else in this script is create-if-absent, and that
        # is deliberate — but a deadline lives in THREE places (CORE.md section 2) and an
        # editor-free path that can write only two of them is how the empty-`due_by_day` trap
        # happened in the first place. So the date is reconciled as a unit or not at all.
        #
        # MOVING A DEADLINE EARLIER IS A HUMAN DECISION, NOT A SCRIPT'S (CORE.md section 2:
        # the phys-215 repair took a day away from 138 cadets). It is refused here unless the
        # human says so on the command line, and the refusal names both dates.
        old, new = row["due_at"], plan["due_at"]
        earlier = str(new) < str(old)
        if earlier and not args.allow_earlier:
            sys.exit(f"REFUSING to move the deadline EARLIER: {old} -> {new}\n"
                     f"  Count what is already in flight (submissions, grades), put it to the\n"
                     f"  course director, and re-run with --allow-earlier if they agree.")
        cur.execute("""update app.assignment_offerings set due_at=%s, due_by_day=%s,
                              updated_at=now() where id=%s""",
                    (new, Json({plan["day_key"]: new.replace(" ", "T").replace("+00", ".000Z")}),
                     row["id"]))
        cur.execute("""update app.assignment_due_dates set due_at=%s
                        where assignment_offering_id=%s""", (new, row["id"]))
        changed.append(f"due date moved {'EARLIER' if earlier else 'later'}: {old} -> {new}")
        print(f"  RE-DATED          {old}  ->  {new}"
              f"{'   (EARLIER, authorized)' if earlier else ''}")
    if row is None:
        row = one(cur, """insert into app.assignment_offerings
                            (id, course_offering_id, assignment_id, points_possible, grading_mode,
                             switch_policy, opens_at, due_at, due_by_day, is_published, position)
                          values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                  (str(uuid.uuid4()), co["id"], assignment_id, plan["points_possible"],
                   plan["grading_mode"], plan["switch_policy"], plan["opens_at"], plan["due_at"],
                   Json({plan["day_key"]: plan["due_at"].replace(" ", "T")
                         .replace("+00", ".000Z")}),
                   plan["is_published"], plan["position"]))
        changed.append("offering")
    offering_id = row["id"]
    print(f"  offering          {offering_id}  due {plan['due_at']}  published=False")

    # 3. per-section due dates -------------------------------------------------------------
    cur.execute("select id, code from app.sections where course_offering_id=%s", (co["id"],))
    for sec in cur.fetchall():
        hit = one(cur, """select 1 from app.assignment_due_dates
                          where assignment_offering_id=%s and section_id=%s""",
                  (offering_id, sec["id"]))
        if hit is None:
            cur.execute("""insert into app.assignment_due_dates
                             (assignment_offering_id, section_id, due_at) values (%s,%s,%s)""",
                        (offering_id, sec["id"], plan["due_at"]))
            changed.append(f"due date {sec['code']}")
        print(f"  section due date  {sec['code']}  {plan['due_at']}")

    # 4. activities ------------------------------------------------------------------------
    written_content = {
        "questions": [Q_READING_TIME, Q_READING_REFLECTION] + plan["questions"],
        "reading_link": None,
        "reference_pdf": plan["reference_pdf"],
        "reference_pages": plan["reference_pages"],
        "access": "open",
    }
    activities = [
        ("written", plan["written_slug"], plan["title"], 0, written_content,
         plan["written_role"]),
        ("interactive", plan["interactive_slug"], plan["interactive_title"], 1,
         {"description": None, "artifact_url": plan["artifact_url"]}, plan["interactive_role"]),
    ]
    for modality, slug, title, pos, content, role in activities:
        row = one(cur, """select id, slug, content from app.activities
                          where assignment_id=%s and modality=%s""",
                  (assignment_id, modality))
        if row is None:
            row = one(cur, """insert into app.activities
                                (id, assignment_id, modality, slug, title, content, position)
                              values (%s,%s,%s,%s,%s,%s,%s) returning id, slug""",
                      (str(uuid.uuid4()), assignment_id, modality, slug, title,
                       Json(content), pos))
            changed.append(f"activity {modality}")
        elif row["slug"] != slug:
            sys.exit(f"activity {modality} already exists as {row['slug']}, PLAN says {slug} - "
                     "refusing to move a slug that reports already hang off")
        elif (modality == "interactive" and plan.get("reconcile_artifact_url")
                and row["content"].get("artifact_url") != content["artifact_url"]):
            # RECONCILE THE LAUNCH TARGET, and ONLY that field. Added 2026-09-22, when
            # lesson 15 was switched to the Gemini route. The slug is untouched (asserted
            # above), so this is a transport change and nothing downstream can tell: same
            # activities row, same reports, same rollup. `content` is merged rather than
            # replaced, so a description written in the editor survives.
            cur.execute("""update app.activities
                              set content = content || %s::jsonb, updated_at = now()
                            where id = %s""",
                        (Json({"artifact_url": content["artifact_url"]}), row["id"]))
            changed.append("artifact_url")
            print(f"  RE-POINTED        {row['content'].get('artifact_url')}\n"
                  f"               ->   {content['artifact_url']}")
        activity_id = row["id"]
        print(f"  activity {modality:<12} {slug}")

        hit = one(cur, """select grading_role from app.offering_activities
                          where assignment_offering_id=%s and activity_id=%s""",
                  (offering_id, activity_id))
        if hit is None:
            cur.execute("""insert into app.offering_activities
                             (assignment_offering_id, activity_id, grading_role, available_after,
                              is_visible, position) values (%s,%s,%s,'always',true,%s)""",
                        (offering_id, activity_id, role, pos))
            changed.append(f"offering_activity {modality}")
        print(f"    role            {role}")

    # 5. read back -------------------------------------------------------------------------
    print("\n--- read-back ---")
    back = one(cur, """select ao.is_published, ao.due_at, ao.due_by_day, ao.points_possible,
                              (select count(*) from app.assignment_due_dates d
                                where d.assignment_offering_id = ao.id) as section_rows,
                              (select count(*) from app.offering_activities oa
                                where oa.assignment_offering_id = ao.id) as activities
                       from app.assignment_offerings ao where ao.id = %s""", (offering_id,))
    print(json.dumps({k: str(v) for k, v in back.items()}, indent=2))
    pts = one(cur, """select sum((q->>'points')::numeric) total, count(*) n
                      from app.activities a,
                           jsonb_array_elements(a.content->'questions') q
                      where a.assignment_id=%s and a.modality='written'""", (assignment_id,))
    print(f"written questions: {pts['n']}, points {pts['total']} "
          f"(offering is {back['points_possible']})")

    print(f"\n{len(changed)} change(s): {', '.join(changed) if changed else 'none - already registered'}")
    if args.commit:
        conn.commit()
        print("COMMITTED")
    else:
        conn.rollback()
        print("DRY RUN - rolled back. Re-run with --commit to write.")
    conn.close()


if __name__ == "__main__":
    main()
