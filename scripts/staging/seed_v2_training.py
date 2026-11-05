#!/usr/bin/env python3
"""Fill STAGING with the state production will be in after decision 2 of the v2 plan. Everything is invented.

Production has a TRAINING offering of phys-215 (4 sections, 80 active enrollments, 37 published items,
211 submissions, 213 grades). Decision 2 makes it INACTIVE before migration 028, so that "one active
offering per course" can be enforced. No cadet in it is also in the real term. This script builds the same
shape in small, so the state it lands in can be proven and re-proven:

  Course gate-train
    term  training-gate-2026   the TRAINING offering. Four sections TR-A..TR-D, eight cadets (all active,
                               in this offering only), six PUBLISHED items, submissions and finalized grades.
                               It is built ACTIVE, so its items can be published (step 1 refuses to publish
                               into an inactive offering), and then switched off by a plain UPDATE of
                               is_active as the owner: exactly what the course director will run.
    term  fall-2026            the REAL offering. ACTIVE, one section RL-A, two cadets, two published items.

STAFF   traindirector@ directs BOTH offerings (so a director sees the picker with both). Password rule is the
        site's own: last name in lower case + 1234.
CADETS  3000000601 (TR-A) and 3000000605 (TR-C) sign in and are in the training offering only.
        3000000701 (RL-A) signs in and is in the real offering only. Password: last 6 digits of the id.
SAFETY  Staging only, through db_target.py. Dry run by default (runs everything, rolls back).
        Re-runnable: it moves deadlines around today and changes nothing else. It builds the training
        offering active only the first time; a second run leaves it inactive and does not switch it on.

ENVIRONMENT  STAGING_DB_URL  postgres connection string for the STAGING project. Never printed.
USAGE
  python scripts/staging/seed_v2_training.py --expect-ref <staging ref>            # plan only
  python scripts/staging/seed_v2_training.py --expect-ref <staging ref> --commit
"""
import argparse
import json
import os
import sys
import uuid
from datetime import timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402
from v2_gate_lib import Builder, days, iso  # noqa: E402

NS = uuid.UUID("5d1c8e7a-3b64-4f0d-9a52-7e2b6c1f0d83")
COURSE_CODE = "gate-train"
TRAIN_TERM, REAL_TERM = "training-gate-2026", "fall-2026"
WRITTEN = {"modality": "written", "delivery": "typed_response", "grading": "human_graded"}
Q_PATH = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}


QUESTIONS = [
    {"id": "q1", "role": "reading_time", "type": "free_response", "points": 0, "figure_url": "",
     "text": "How much time did you spend reading the book in preparation for this lesson?"},
    {"id": "q2", "role": "reading_reflection", "type": "free_response", "points": 5, "figure_url": "",
     "text": "What did you find most confusing or most interesting about the reading?"},
    {"id": "q3", "role": "free_response", "type": "free_response", "points": 5, "figure_url": "",
     "text": "Made-up question. Explain the main idea of this lesson."},
]
WRITTEN_PATH = {**WRITTEN, "content": {"questions": QUESTIONS}}


def qs(points):
    """The per-question scores a hand-graded written preflight carries, so the Grade card reads them."""
    q2 = min(5, points)
    q3 = points - q2
    st = lambda got, mx: "full" if got == mx else ("warn" if got else "zero")   # noqa: E731
    return json.dumps({"q1": {"score": 0, "max": 0, "feedback": "", "status": "full"},
                       "q2": {"score": q2, "max": 5, "feedback": "", "status": st(q2, 5)},
                       "q3": {"score": q3, "max": 5, "feedback": "", "status": st(q3, 5)}})


def password(cadet_id):
    return str(cadet_id)[-6:]


def publish_into(b, co, item):
    """Publish an item. On the first run the offering is active and this is a plain publish. On a re-run that
    ADDS an item to the offering after it went inactive, the step 1 rule would refuse (rightly); the seed is the
    owner on staging and turns that one rule off for that one statement, inside its own transaction."""
    c = b.cur
    c.execute("SELECT is_active FROM course_offerings WHERE id = %s", (co,))
    if c.fetchone()[0]:
        return b.publish(item)
    # Migration 079 removes that rule; a database without it has nothing to switch off.
    c.execute("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assignment_offerings_publish_needs_active' AND NOT tgisinternal)")
    if not c.fetchone()[0]:
        return b.publish(item)
    c.execute("ALTER TABLE assignment_offerings DISABLE TRIGGER assignment_offerings_publish_needs_active")
    try:
        b.publish(item)
    finally:
        c.execute("ALTER TABLE assignment_offerings ENABLE TRIGGER assignment_offerings_publish_needs_active")


def seed(cur):
    b = Builder(cur, NS)
    c = cur
    course = b.course(COURSE_CODE, "Gate training course (STAGING TEST)")
    t_train = b.term(TRAIN_TERM, "Training (STAGING TEST)", "2026-07-27", "2026-12-10")
    t_real = b.term(REAL_TERM, "Fall 2026", "2026-08-06", "2026-12-10")

    co_train = b.id("offering", f"{course}:{t_train}")
    c.execute("SELECT is_active FROM course_offerings WHERE id = %s", (co_train,))
    row = c.fetchone()
    first_run = row is None
    # Built ACTIVE the first time, so its items can be published. Nothing else of this course is active yet.
    b.offering(course, t_train, True if first_run else bool(row[0]))

    name = "Quinn Traindirector"
    director = b.staff("traindirector", name, name.split()[-1].lower() + "1234")
    b.assign(director, co_train, "director")

    secs = [b.section(co_train, "TR-A", ["M"], 1), b.section(co_train, "TR-B", ["T"], 3),
            b.section(co_train, "TR-C", ["M"], 5), b.section(co_train, "TR-D", ["T"], 1)]
    enr = {}
    for i, cid in enumerate(range(3000000601, 3000000609)):
        signs = cid in (3000000601, 3000000605)
        enr[cid], _ = b.cadet(cid, f"Cadet{cid % 1000} Gatetrain", secs[i // 2], password(cid) if signs else None,
                              with_auth=signs)

    m_day, t_day = days(-6), days(-5)
    by_day = {"M": iso(m_day), "T": iso(t_day)}
    pub = dict(entered_on_new_page=False, published=False)
    items = []
    for n in range(1, 6):
        items.append(b.item(course, co_train, f"gate-tr-{n}", f"Gate training lesson {n}", 10, kind="preflight",
                            paths=[WRITTEN_PATH], due=m_day + timedelta(days=n), due_by_day={
                                "M": iso(m_day + timedelta(days=n)), "T": iso(t_day + timedelta(days=n))}, **pub))
    q = b.item(course, co_train, "gate-tr-6", "Gate training online set", 10, kind="homework", paths=[Q_PATH],
               due=days(-1), **pub)
    b.question(q, "q1", "numeric", 10, key={"value": 4.0, "tol_pct": 1})
    items.append(q)
    # one lesson offered in BOTH offerings (same assignment, same paths), as the production training copy is:
    # an activity slug then resolves to two offerings of one course and cannot tell them apart
    shared = b.item(course, co_train, "gate-sh-1", "Gate shared lesson 1", 10, kind="preflight", paths=[WRITTEN_PATH],
                    due=m_day, due_by_day=by_day, **pub)
    for it in items + [shared]:
        publish_into(b, co_train, it)
    # a DRAFT in the training offering: the item whose publishing step 1 must refuse once the offering is inactive
    b.item(course, co_train, "gate-tr-7", "Gate training draft", 10, kind="preflight", paths=[WRITTEN_PATH],
           due=days(10), due_by_day={"M": iso(days(10)), "T": iso(days(11))}, **pub)

    # submissions and finalized grades: every cadet on lessons 1 to 3; the first four also on 4; one held
    # (AI-suggested) grade; the online set auto-checked for two cadets
    for cid, e in enr.items():
        for it in items[:3]:
            s = b.work(e, it, "committed", m_day)
            pts = 10 if cid % 2 else 8
            b.grade(e, it, pts, submission=s, question_scores=qs(pts))
    for cid in range(3000000601, 3000000605):
        s = b.work(enr[cid], items[3], "committed", m_day + timedelta(days=4))
        b.grade(enr[cid], items[3], 9, submission=s, question_scores=qs(9))
    s = b.work(enr[3000000605], items[3], "committed", m_day + timedelta(days=4))
    b.grade(enr[3000000605], items[3], 7, final=False, submission=s, question_scores=qs(7))
    for cid in (3000000601, 3000000602):
        b.grade(enr[cid], q, 10, source="auto_checked")

    # The decision-2 step, exactly as the course director will run it: a plain update, as the owner.
    c.execute("UPDATE course_offerings SET is_active = false WHERE id = %s AND is_active", (co_train,))

    # The REAL offering of the same course: active, its own people, its own items.
    co_real = b.offering(course, t_real, True)
    b.assign(director, co_real, "director")
    rl = b.section(co_real, "RL-A", ["M"], 1)
    renr = {}
    for cid in (3000000701, 3000000702):
        renr[cid], _ = b.cadet(cid, f"Cadet{cid % 1000} Gatereal", rl, password(cid) if cid == 3000000701 else None,
                               with_auth=cid == 3000000701)
    r1 = b.item(course, co_real, "gate-rl-1", "Gate real lesson 1", 10, kind="preflight", paths=[WRITTEN_PATH],
                due=days(-3), due_by_day={"M": iso(days(-3))}, **pub)
    r2 = b.item(course, co_real, "gate-rl-2", "Gate real lesson 2", 10, kind="preflight", paths=[WRITTEN_PATH],
                due=days(6), due_by_day={"M": iso(days(6))}, **pub)
    b.publish(r1)
    b.publish(r2)
    # the shared lesson's second offering: same assignment and paths, this offering's own row
    ao_sh = b.id("ao", "gate-sh-1:real")
    c.execute("""INSERT INTO assignment_offerings (id, assignment_id, course_offering_id, due_at, due_by_day,
                                                   grading_mode, points_possible, is_published, entered_on_new_page)
                 VALUES (%s, %s, %s, %s, %s, 'points', 10, false, false)
                 ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at, due_by_day = EXCLUDED.due_by_day""",
              (ao_sh, shared["assignment"], co_real, days(-2), json.dumps({"M": iso(days(-2))})))
    c.execute("SELECT 1 FROM offering_activities WHERE assignment_offering_id = %s", (ao_sh,))
    if not c.fetchone():
        c.execute("""INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, available_after,
                                                      is_visible, position, delivery, grading, warn_earns_full)
                     SELECT %s, activity_id, grading_role, available_after, is_visible, position, delivery, grading,
                            warn_earns_full FROM offering_activities WHERE assignment_offering_id = %s""",
                  (ao_sh, shared["ao"]))
    b.publish({"ao": ao_sh})
    # a DRAFT in the active real offering: publishing it must still work (the control)
    b.item(course, co_real, "gate-rl-3", "Gate real draft", 10, kind="preflight", paths=[WRITTEN_PATH],
           due=days(13), due_by_day={"M": iso(days(13))}, **pub)
    s = b.work(renr[3000000701], r1, "committed", days(-3) - timedelta(hours=4))
    b.grade(renr[3000000701], r1, 9, submission=s, question_scores=qs(9))
    return co_train, co_real


def counts(cur):
    cur.execute("""
      SELECT t.code, co.is_active,
             (SELECT count(*) FROM app.sections s WHERE s.course_offering_id = co.id),
             (SELECT count(*) FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id
               WHERE s.course_offering_id = co.id AND e.status = 'active'),
             (SELECT count(*) FROM app.assignment_offerings ao WHERE ao.course_offering_id = co.id AND ao.is_published),
             (SELECT count(*) FROM app.submissions x JOIN app.assignment_offerings ao ON ao.id = x.assignment_offering_id
               WHERE ao.course_offering_id = co.id),
             (SELECT count(*) FROM app.grades g JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
               WHERE ao.course_offering_id = co.id)
        FROM app.course_offerings co JOIN app.courses c ON c.id = co.course_id JOIN app.terms t ON t.id = co.term_id
       WHERE c.code = %s ORDER BY t.code""", (COURSE_CODE,))
    for term, active, sec, enr, pub, sub, grd in cur.fetchall():
        print(f"  {term:<20} active={active!s:<6} sections {sec}, active enrollments {enr}, published items {pub}, "
              f"submissions {sub}, grades {grd}")


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
