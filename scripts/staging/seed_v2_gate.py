#!/usr/bin/env python3
"""Fill STAGING with the two courses the v2 gate needs. Every name and value is invented.

Why two: the step 1 rules stop one course from doing both jobs. A flagged item cannot publish or
finalize, so it can never reach the total rule.

  Course gate-entry   the ENTRY course. Its offering is INACTIVE, every item is unpublished and
                      entered_on_new_page. It proves real shapes fit the model and stay invisible.
                      Sections ENT-A (meets on no day) and ENT-B (meets W and F). No lesson numbers.
                        homework      online_questions / auto_checked: multiple choice, multiple select, a
                                      numeric answer with tolerance, significant figures and a unit, a key
                                      at version 2, and a correct value of 0
                        preflight     typed_response / human_graded (warn earns full) plus
                                      interactive_tutor / effort as the alternative; late refused
                        case study    typed_response / human_graded, warn does not earn full
                        group project elsewhere / imported, a group, members and a snapshot
                        quiz          elsewhere / imported, draft scores, one counted at Prog and one not
                        exam          in_person / hand_entered, may score above its maximum
                        lab           two required parts in one part set: online questions, and elsewhere
                        bonus         is_bonus, possible 0
  Course gate-vector  the VECTOR course. Its offering is ACTIVE, items are published and not flagged, so
                      grades can finalize. Sections VM (meets M), VT (meets T), VX (meets no day). Cadets
                      are spread over every grade state: released, held, excused, missing, ungraded,
                      stale zero, late, open and closed columns, a score above the maximum, an
                      adjusted group member, a tied pair and a dropped enrollment.

The cadets who sign in to see nothing new are the ones seed_staging.py makes (phys-215). They are in
neither course.

STAFF   gatedirector@ directs both offerings. gateinstructor@ teaches section VM only.
PASSWORDS   staff: last name in lower case + 1234. cadets: last 6 digits of the id. (The site's own rule.)
SAFETY  Staging only, through db_target.py. Dry run by default (runs everything, rolls back).
        Re-runnable: it moves the deadlines and work times back around today and changes nothing else.

ENVIRONMENT  STAGING_DB_URL  postgres connection string for the STAGING project. Never printed.
USAGE
  python scripts/staging/seed_v2_gate.py --expect-ref <staging ref>            # plan only
  python scripts/staging/seed_v2_gate.py --expect-ref <staging ref> --commit
"""
import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
from v2_gate_lib import Builder, days, iso  # noqa: E402

NS = uuid.UUID("0b4f6a52-91d3-4c57-8e0a-5c3f2d9b7a41")
ENTRY_CODE, VECTOR_CODE = "gate-entry", "gate-vector"

Q_PATH = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
WRITTEN = {"modality": "written", "delivery": "typed_response", "grading": "human_graded"}
EXT = lambda delivery, grading: {"modality": "external", "delivery": delivery, "grading": grading}  # noqa: E731


def cadet_password(cadet_id):
    return str(cadet_id)[-6:]


def staff_password(name):
    return name.split()[-1].lower() + "1234"


def seed_entry(b, term):
    c = b.cur
    course = b.course(ENTRY_CODE, "Gate entry course (STAGING TEST)")
    co = b.offering(course, term, False)
    sec_a, sec_b = b.section(co, "ENT-A", []), b.section(co, "ENT-B", ["W", "F"])
    name = "Rowan Gatedirector"
    director = b.staff("gatedirector", name, staff_password(name))
    b.assign(director, co, "director")
    enrs = {}
    for cid, nm, sec in ((3000000401, "Ash Gatecadet", sec_a), (3000000402, "Bay Gatecadet", sec_a),
                         (3000000403, "Cove Gatecadet", sec_b), (3000000404, "Dell Gatecadet", sec_b)):
        enrs[cid], _ = b.cadet(cid, nm, sec, cadet_password(cid))
    new = dict(entered_on_new_page=True, published=False)

    # homework: five questions, a key at version 2
    hw = b.item(course, co, "gate-hw-1", "Gate homework 1", 10, kind="homework", paths=[Q_PATH], due=days(20),
                late_allowed=True, attempt_limit=5, **new)
    choices = [{"id": "a", "text": "Alpha"}, {"id": "b", "text": "Beta"}, {"id": "c", "text": "Gamma"}]
    b.question(hw, "q1", "multiple_choice", 2, choices=choices, key={"correct_choice_ids": ["b"]}, n=0)
    b.question(hw, "q2", "multiple_select", 2, choices=choices, key={"correct_choice_ids": ["a", "c"]}, n=1)
    b.question(hw, "q3", "numeric", 3, key={"value": 9.81, "tol_pct": 1, "sig_figs": 3, "sig_fig_mode": "warn",
                                              "unit": "m/s^2", "unit_mode": "warn"}, n=2)
    b.question(hw, "q4", "numeric", 1, key={"value": 0, "tol_abs": 0.05}, n=3)
    b.question(hw, "q5", "numeric", 2, key=[{"value": 3.0, "tol_abs": 0.01}, {"value": 3.1, "tol_abs": 0.01}], n=4)

    # preflight: a typed path and a tutor path, alternatives
    pf = b.item(course, co, "gate-pf-1", "Gate preflight 1", 2, kind="preflight", due=days(21),
                paths=[{**WRITTEN, "warn": True, "content": {"questions": []}},
                       {"modality": "interactive", "delivery": "interactive_tutor", "grading": "effort",
                        "content": {"artifact_url": "https://example.org/prep-staging-test-artifact"}}], **new)
    cs = b.item(course, co, "gate-cs-1", "Gate case study 1", 10, kind="case_study", due=days(22),
                paths=[{**WRITTEN, "warn": False}], late_allowed=True, **new)

    # group project with a group, members and a snapshot
    gp = b.item(course, co, "gate-gp-1", "Gate group project 1", 20, kind="group_project", due=days(25),
                paths=[EXT("elsewhere", "imported")], is_group_work=True, **new)
    gid = b.id("group", "gate-group-entry")
    c.execute("""INSERT INTO student_groups (id, course_offering_id, name) VALUES (%s, %s, 'Gate group A')
                 ON CONFLICT (id) DO NOTHING""", (gid, co))
    for cid in (3000000401, 3000000403):
        c.execute("""INSERT INTO student_group_members (id, group_id, enrollment_id) VALUES (%s, %s, %s)
                     ON CONFLICT (id) DO NOTHING""", (b.id("member", f"{gid}:{cid}"), gid, enrs[cid]))
        c.execute("""INSERT INTO student_group_snapshots (id, group_id, assignment_offering_id, enrollment_id, reason)
                     VALUES (%s, %s, %s, %s, 'Made-up handed-in snapshot.') ON CONFLICT (id) DO NOTHING""",
                  (b.id("snap", f"{gid}:{cid}"), gid, gp["ao"], enrs[cid]))

    # quizzes: imported draft scores; one counts at Prog, one does not
    q1 = b.item(course, co, "gate-qz-1", "Gate quiz 1", 20, kind="quiz", due=days(8),
                paths=[EXT("elsewhere", "imported")], prog_included=True, **new)
    q2 = b.item(course, co, "gate-qz-2", "Gate quiz 2", 20, kind="quiz", due=days(9),
                paths=[EXT("elsewhere", "imported")], prog_included=False, **new)
    for item, pts in ((q1, (18, 15, 12, 20)), (q2, (10, 11, 12, 13))):
        for cid, p in zip(sorted(enrs), pts):
            b.grade(enrs[cid], item, p, final=False, source="imported")

    b.item(course, co, "gate-ex-1", "Gate exam 1", 100, kind="exam", due=days(30),
           paths=[EXT("in_person", "hand_entered")], allow_over_max=True, **new)

    # lab: two required parts in one part set, with different deadlines
    ps = b.id("partset", "gate-lab-1")
    c.execute("""INSERT INTO part_sets (id, course_offering_id, title, position) VALUES (%s, %s, 'Gate lab 1', NULL)
                 ON CONFLICT (id) DO NOTHING""", (ps, co))
    lab_a = b.item(course, co, "gate-lab-1-pre", "Gate lab 1 pre-lab", 6, kind="lab", paths=[Q_PATH],
                   due=days(10), part_set_id=ps, **new)
    b.question(lab_a, "q1", "numeric", 3, key={"value": 2.0, "tol_pct": 2}, n=0)
    b.question(lab_a, "q2", "multiple_choice", 3, choices=choices, key={"correct_choice_ids": ["c"]}, n=1)
    b.item(course, co, "gate-lab-1-report", "Gate lab 1 report", 14, kind="lab", paths=[EXT("elsewhere", "hand_entered")],
           due=days(14), part_set_id=ps, **new)

    b.item(course, co, "gate-bonus-1", "Gate bonus 1", 0, kind="homework", paths=[EXT("elsewhere", "hand_entered")],
           due=days(15), is_bonus=True, **new)
    return co


def seed_vector(b, term):
    c = b.cur
    course = b.course(VECTOR_CODE, "Gate vector course (STAGING TEST)")
    co = b.offering(course, term, True)
    vm, vt, vx = b.section(co, "VM", ["M"], 1), b.section(co, "VT", ["T"], 3), b.section(co, "VX", [])
    director = b.staff("gatedirector", "Rowan Gatedirector", staff_password("Rowan Gatedirector"))
    b.assign(director, co, "director")
    name = "Sky Gateinstructor"
    teacher = b.staff("gateinstructor", name, staff_password(name))
    b.assign(teacher, co, "instructor", vm)

    sec_of = {}
    plan = {}   # cadet id -> (name, section, signs in)
    for cid in range(3000000501, 3000000509):
        plan[cid] = (vm, cid in (3000000501,))
    for cid in range(3000000509, 3000000515):
        plan[cid] = (vt, cid in (3000000509,))
    for cid in (3000000515, 3000000516):
        plan[cid] = (vx, cid == 3000000515)
    enr = {}
    for cid, (sec, signs) in plan.items():
        enr[cid], _ = b.cadet(cid, f"Cadet{cid % 1000} Gatevec", sec, cadet_password(cid) if signs else None, with_auth=signs)
        sec_of[cid] = sec
    enr[3000000517], _ = b.cadet(3000000517, "Cadet517 Gatevec", vm, None, status="dropped", with_auth=False)

    m_day, t_day = days(-3), days(-2)
    by_day = {"M": iso(m_day), "T": iso(t_day)}
    pub = dict(entered_on_new_page=False, published=False)
    v1 = b.item(course, co, "gate-v1", "Gate vector written A", 10, kind="preflight", paths=[WRITTEN], due=m_day,
                due_by_day=by_day, prog_included=True, **pub)
    v2 = b.item(course, co, "gate-v2", "Gate vector written B", 10, kind="case_study", paths=[WRITTEN], due=m_day,
                due_by_day=by_day, grades_release_at=days(3), **pub)
    v3 = b.item(course, co, "gate-v3", "Gate vector online set", 10, kind="homework", paths=[Q_PATH], due=days(-1), **pub)
    q3 = b.question(v3, "q1", "numeric", 10, key={"value": 4.0, "tol_pct": 1})
    v4 = b.item(course, co, "gate-v4", "Gate vector exam", 100, kind="exam", paths=[EXT("in_person", "hand_entered")],
                due=days(-2), allow_over_max=True, prog_included=True, **pub)
    v5 = b.item(course, co, "gate-v5", "Gate vector bonus", 5, kind="homework", paths=[EXT("elsewhere", "hand_entered")],
                due=days(-2), is_bonus=True, **pub)
    v6 = b.item(course, co, "gate-v6", "Gate vector next", 10, kind="preflight", paths=[WRITTEN], due=days(7), **pub)
    v7 = b.item(course, co, "gate-v7", "Gate vector project", 20, kind="group_project",
                paths=[EXT("elsewhere", "imported")], due=days(-2), is_group_work=True, **pub)
    v8 = b.item(course, co, "gate-v8", "Gate vector online set 2", 10, kind="homework", paths=[Q_PATH], due=days(2), **pub)
    q8 = b.question(v8, "q1", "numeric", 10, key={"value": 7.0, "tol_pct": 1})
    for it in (v1, v2, v3, v4, v5, v6, v7, v8):
        b.publish(it)

    on_time = lambda d: d - timedelta(hours=5)   # noqa: E731
    g = lambda cid, item, pts, **kw: b.grade(enr[cid], item, pts, **kw)   # noqa: E731
    first = enr[3000000501]
    # 501: released, held, auto-checked, over the maximum, bonus, imported group score
    s = b.work(first, v1, "committed", on_time(m_day)); g(3000000501, v1, 9, submission=s)
    s = b.work(first, v2, "committed", on_time(m_day)); g(3000000501, v2, 8, submission=s)
    g(3000000501, v3, 7, source="auto_checked")
    g(3000000501, v4, 105)
    g(3000000501, v5, 5)
    # 502: missing, committed and ungraded, open in-person column, no group work
    b.work(enr[3000000502], v2, "committed", on_time(m_day))
    # 503: excused with a zero on the row, an AI suggestion, an entered zero, an auto-checked item so far
    b.excuse(enr[3000000503], v1, director)
    g(3000000503, v1, 0)
    s = b.work(enr[3000000503], v2, "committed", on_time(m_day)); g(3000000503, v2, 7, final=False, submission=s)
    g(3000000503, v4, 0)
    g(3000000503, v8, 6, source="auto_checked")
    c.execute("""INSERT INTO question_attempts (id, enrollment_id, assignment_offering_id, question_id, attempt_no,
                                                answer, points_awarded, is_correct)
                 VALUES (%s, %s, %s, %s, 1, '{"value": 6.0}', 0, false), (%s, %s, %s, %s, 2, '{"value": 7.0}', 6, true)
                 ON CONFLICT (id) DO NOTHING""",
              (b.id("attempt", "503:1"), enr[3000000503], v8["ao"], q8, b.id("attempt", "503:2"), enr[3000000503],
               v8["ao"], q8))
    # 504: a stored zero with work committed after it was graded
    s = b.work(enr[3000000504], v1, "committed", m_day + timedelta(days=1))
    g(3000000504, v1, 0, graded_at=m_day + timedelta(hours=1), submission=s)
    # 505: work committed late, not graded
    b.work(enr[3000000505], v1, "committed", m_day + timedelta(days=1))
    # 506: a draft that was never committed, past due
    b.work(enr[3000000506], v1, "draft")
    # group project: a group of three, one member adjusted afterwards
    gid = b.id("group", "gate-group-vector")
    c.execute("""INSERT INTO student_groups (id, course_offering_id, name) VALUES (%s, %s, 'Gate vector group')
                 ON CONFLICT (id) DO NOTHING""", (gid, co))
    for cid, pts, adj in ((3000000501, 15, False), (3000000505, 15, False), (3000000506, 12, True)):
        c.execute("""INSERT INTO student_group_members (id, group_id, enrollment_id) VALUES (%s, %s, %s)
                     ON CONFLICT (id) DO NOTHING""", (b.id("member", f"{gid}:{cid}"), gid, enr[cid]))
        g(3000000501 if cid == 3000000501 else cid, v7, pts, student_group_id=gid, student_group_adjusted=adj)
    # VT: 509 and 510 are tied; 511 and 512 differ; the in-person column is CLOSED for this section
    for cid in (3000000509, 3000000510):
        s = b.work(enr[cid], v1, "committed", on_time(t_day)); g(cid, v1, 9, submission=s)
        g(cid, v3, 9, source="auto_checked"); g(cid, v4, 90)
    g(3000000511, v1, 10, submission=b.work(enr[3000000511], v1, "committed", on_time(t_day)))
    g(3000000511, v4, 70)
    g(3000000512, v1, 6, submission=b.work(enr[3000000512], v1, "committed", on_time(t_day)))
    b.close_column(v4, vt, director)
    # VX: no meeting day, so every deadline is the offering's own date
    g(3000000515, v1, 10, submission=b.work(enr[3000000515], v1, "committed", on_time(m_day)))
    g(3000000516, v1, 4, submission=b.work(enr[3000000516], v1, "committed", on_time(m_day)))
    # a dropped enrollment with a grade: it must not reach any total or rank
    g(3000000517, v1, 10)
    # extensions, active and revoked, so the deadline proof has both kinds to compare
    for key, cid, item, when, revoked in (("502", 3000000502, v2, days(5), False),
                                           ("507", 3000000507, v1, days(1), False),
                                           ("508", 3000000508, v1, days(2), True),
                                           ("510", 3000000510, v6, days(9), False)):
        c.execute("""INSERT INTO extensions (id, enrollment_id, assignment_offering_id, extended_due_at, reason,
                                             granted_by, revoked_at, revoked_by, revoked_reason)
                     VALUES (%s, %s, %s, %s, 'Made-up reason.', %s, %s, %s, %s)
                     ON CONFLICT (enrollment_id, assignment_offering_id)
                     DO UPDATE SET extended_due_at = EXCLUDED.extended_due_at, revoked_at = EXCLUDED.revoked_at""",
                  (b.id("extension", key), enr[cid], item["ao"], when, director,
                   days(0) if revoked else None, director if revoked else None,
                   "Made-up revoke reason." if revoked else None))
    return co


def seed(cur):
    b = Builder(cur, NS)
    term = b.term()
    entry = seed_entry(b, term)
    vector = seed_vector(b, term)
    return entry, vector


def counts(cur):
    for label, code in (("entry", ENTRY_CODE), ("vector", VECTOR_CODE)):
        cur.execute("""SELECT (SELECT count(*) FROM app.sections s WHERE s.course_offering_id = co.id),
                              (SELECT count(*) FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id
                                WHERE s.course_offering_id = co.id),
                              (SELECT count(*) FROM app.assignment_offerings ao WHERE ao.course_offering_id = co.id),
                              (SELECT count(*) FROM app.assignment_offerings ao
                                WHERE ao.course_offering_id = co.id AND ao.is_published),
                              (SELECT count(*) FROM app.grades g JOIN app.assignment_offerings ao
                                      ON ao.id = g.assignment_offering_id WHERE ao.course_offering_id = co.id)
                         FROM app.course_offerings co JOIN app.courses c ON c.id = co.course_id WHERE c.code = %s""",
                    (code,))
        sec, enr, items, pub, grd = cur.fetchone()
        print(f"  {label:<8}{code:<14}sections {sec}, enrollments {enr}, items {items} ({pub} published), grades {grd}")


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
