#!/usr/bin/env python
"""The v2 total rule and the step 1 rules, as rolled-back trials on STAGING.

Every trial opens a transaction, builds its own made-up course (new course, active offering, its own
cadets), calls the database functions, and rolls back. Nothing is left behind. Reads STAGING_DB_URL and
refuses anything that is not exactly the staging project (staging_guard.py).

What runs
  * every vector in V2-DATA-MODEL section 21 except 34 to 40 (section moves, step 2): 1 to 33, 41 to 44
  * every grade state in section 7, with its flags, asserted on a cell (also a coverage check)
  * the section 3, 6 and 18 trials and the section 1 rules: grading_mode sync, the bonus check, the
    adjusted-group marker, new items staying unpublished and unfinalized, publish needs an active
    offering, one active offering per course

The total is read through _totals_at and _cells_at with an explicit clock, as the owner. The same cells
are read as signed-in staff and students by v2_signed_in_checks.py.

Prints one line per check and a final "N passed, M failed" line. Exits non-zero on a failure.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402
from v2_gate_lib import Builder  # noqa: E402

WRITTEN = {"modality": "written", "delivery": "typed_response", "grading": "human_graded"}
Q_PATH = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
INPERSON = {"modality": "external", "delivery": "in_person", "grading": "hand_entered"}
ELSEWHERE = {"modality": "external", "delivery": "elsewhere", "grading": "imported"}

passed = failed = 0
SEEN_STATES, SEEN_FLAGS = set(), set()


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"  [{detail}]" if detail else ""))


class World:
    """One made-up course offering inside the open transaction."""

    def __init__(self, conn, days=("M",), scale=None):
        self.conn, self.cur = conn, conn.cursor()
        self.b = Builder(self.cur, None)
        c = self.cur
        c.execute("SELECT now()")
        self.t0 = c.fetchone()[0]
        tag = uuid.uuid4().hex[:10]
        self.course = self.b.course(f"vec-{tag}", "Vector trial")
        self.term = self.b.term()
        self.co = self.b.offering(self.course, self.term, True)
        self.sec = self.b.section(self.co, "T1", list(days))
        self.director = self.b.staff(f"trial-{tag}", "Trial Director")
        self.b.assign(self.director, self.co, "director")
        self.n = 0
        self.items = {}
        if scale:
            c.execute("INSERT INTO letter_scales (course_offering_id, lines, near_line_width) VALUES (%s, %s, %s)",
                      (self.co, scale[0], scale[1]))

    # ---- builders ----------------------------------------------------------------------------
    def at(self, seconds):
        """An instant `seconds` from the trial clock."""
        return self.t0 + timedelta(seconds=seconds)

    def student(self, status="active", section=None):
        self.n += 1
        cid = 3005000000 + (uuid.uuid4().int % 900000) + self.n   # inside the cadet id range
        enr, _ = self.b.cadet(cid, f"Trial{self.n} Cadet", section or self.sec, status=status, with_auth=False)
        return cid, enr

    def item(self, name, points, how="typed", due=-432000, publish=True, **policy):
        """how: typed | inperson | elsewhere | auto. due: seconds from the clock (negative is past)."""
        path = {"typed": WRITTEN, "inperson": INPERSON, "elsewhere": ELSEWHERE, "auto": Q_PATH}[how]
        slug = f"{name}-{uuid.uuid4().hex[:8]}"
        it = self.b.item(self.course, self.co, slug, name, points, kind="exam" if how == "inperson" else "homework",
                         paths=[path], due=None if due is None else self.at(due), published=False, **policy)
        if how == "auto":
            self.b.question(it, "q1", "numeric", points, key={"value": 1, "tol_abs": 0.1})
        if publish:
            self.b.publish(it)
        self.items[name] = it
        return it

    def grade(self, enr, item, pts, **kw):
        kw.setdefault("graded_at", self.at(-3600))
        return self.b.grade(enr, item, pts, **kw)

    def commit(self, enr, item, seconds):
        return self.b.work(enr, item, "committed", self.at(seconds))

    # ---- reads -------------------------------------------------------------------------------
    def totals(self, scope="final"):
        self.cur.execute("""SELECT student_id, earned_text, possible_text, percent_text, percent_key_text, letter,
                                   near_line_letter, rank, tie_group, missing_count, ungraded_count, unreleased_count,
                                   excused_count, bonus_only, no_work_count, invalid_deadline_count
                              FROM _totals_at(%s, %s, %s)""", (self.co, scope, self.t0))
        cols = ["student_id", "earned", "possible", "percent", "key", "letter", "near", "rank", "tie", "missing",
                "ungraded", "unreleased", "excused", "bonus_only", "no_work", "invalid"]
        return {r[0]: dict(zip(cols, r)) for r in self.cur.fetchall()}

    def cells(self, scope="final"):
        self.cur.execute("""SELECT student_id, assignment_offering_id, state, has_draft_score, is_late, no_work_received,
                                   deadline_invalid, points_earned, deadline_source, counted_earned, counted_possible
                              FROM _cells_at(%s, %s, %s)""", (self.co, scope, self.t0))
        cols = ["student_id", "ao", "state", "draft", "late", "no_work", "invalid", "points", "source", "ce", "cp"]
        rows = [dict(zip(cols, r)) for r in self.cur.fetchall()]
        for r in rows:
            SEEN_STATES.add(r["state"])
            SEEN_FLAGS.update(k for k in ("draft", "late", "no_work", "invalid") if r[k])
        return rows

    def cell(self, cid, item, scope="final"):
        return next(r for r in self.cells(scope) if r["student_id"] == cid and r["ao"] == item["ao"])


def run_world(conn, fn, **kw):
    """Run fn(world) in a transaction that is always rolled back."""
    try:
        w = World(conn, **kw)
        fn(w)
    finally:
        conn.rollback()


def pct(t):
    return t["percent"]


def vectors(conn):
    # ---- 1 to 5: lines and the near-line width -------------------------------------------------
    def vec(num, name, pa, pb, ga, gb, earned, possible, percent, letter, near):
        def go(w):
            cid, e = w.student()
            i1, i2 = w.item("a", pa), w.item("b", pb)
            w.grade(e, i1, ga)
            w.grade(e, i2, gb)
            t = w.totals()[cid]
            ok = (t["earned"], t["possible"], t["percent"], t["letter"], t["near"]) == (earned, possible, percent, letter, near)
            check(f"vector {num} {name}", ok, str((t["earned"], t["possible"], t["percent"], t["letter"], t["near"])))
        run_world(conn, go)

    vec(1, "89.9 at a 90.0 line is B+ with A- near", 500, 500, 500, 399, "899", "1000", "89.9", "B+", "A-")
    vec(2, "89.89 is B+ with no near line", 5000, 5000, 5000, 3989, "8989", "10000", "89.89", "B+", None)
    vec(3, "on the line is A-", 500, 500, 500, 400, "900", "1000", "90", "A-", None)
    vec(4, "just inside the width", 5000, 5000, 5000, 3990.01, "8990.01", "10000", "89.9001", "B+", "A-")
    vec(5, "just outside the width", 5000, 5000, 5000, 3989.99, "8989.99", "10000", "89.8999", "B+", None)

    def v6(w):
        cid, e = w.student()
        for n in "abc":
            it = w.item(n, 1)
            w.grade(e, it, 1 if n != "c" else 0)
        t = w.totals()[cid]
        ok = t["percent"].startswith("66.666666") and t["percent"].endswith(chr(8230)) and t["letter"] == "F" and t["near"] == "P"
        check("vector 6 repeating decimal, custom line 66.67: below it, flagged near", ok, str((t["percent"], t["letter"], t["near"])))
    run_world(conn, v6, scale=('[{"letter":"P","cutoff":66.67,"gpa":1.0},{"letter":"F","cutoff":0,"gpa":0}]', 0.1))

    def v7(w):
        cid, e = w.student()
        a, b = w.item("a", 0.10), w.item("b", 0.20)
        w.grade(e, a, 0.10)
        w.grade(e, b, 0.20)
        t = w.totals()[cid]
        check("vector 7 float-trap sum 0.10 + 0.20 over 0.30 is exactly 100", (t["earned"], t["possible"], t["percent"], t["letter"]) == ("0.3", "0.3", "100", "A"), str(t))
    run_world(conn, v7)

    def v8(w):
        cid, e = w.student()
        a, bn = w.item("a", 100), w.item("bonus", 5, how="elsewhere", is_bonus=True)
        w.grade(e, a, 100)
        w.grade(e, bn, 5)
        t = w.totals()[cid]
        check("vector 8 normal work plus bonus is 105 percent", (t["earned"], t["possible"], t["percent"], t["letter"]) == ("105", "100", "105", "A"), str(t))
    run_world(conn, v8)

    def v9(w):
        cid, e = w.student()
        a, bn = w.item("a", 100), w.item("bonus", 5, how="elsewhere", is_bonus=True)
        w.grade(e, a, 90)
        w.grade(e, bn, 5)
        t = w.totals()[cid]
        check("vector 9 bonus does not change possible", (t["earned"], t["possible"], t["percent"], t["letter"]) == ("95", "100", "95", "A"), str(t))
    run_world(conn, v9)

    def v10(w):
        cid, e = w.student()
        bn = w.item("bonus", 5, how="elsewhere", is_bonus=True)
        w.grade(e, bn, 5)
        t = w.totals()[cid]
        check("vector 10 bonus-only: percent and letter null, listed as an exception",
              (t["earned"], t["possible"], t["percent"], t["letter"], t["bonus_only"]) == ("5", "0", None, None, True), str(t))
    run_world(conn, v10)

    def v11(w):
        cid, e = w.student()
        z = w.item("zero", 0)
        w.grade(e, z, 0)
        t = w.totals()[cid]
        check("vector 11 zero possible, nothing earned: no error, percent and letter null",
              (t["earned"], t["possible"], t["percent"], t["letter"], t["rank"]) == ("0", "0", None, None, None), str(t))
    run_world(conn, v11)

    # ---- 12 to 13: excused -----------------------------------------------------------------------
    for num, row_pts in ((12, 0), (13, 50)):
        def go(w, num=num, row_pts=row_pts):
            cid, e = w.student()
            a, b = w.item("a", 50), w.item("b", 50)
            w.grade(e, a, 45)
            w.grade(e, b, row_pts)
            w.b.excuse(e, b, w.director)
            t = w.totals()[cid]
            check(f"vector {num} excused with {row_pts} on the row leaves the item: 45 of 50, A-",
                  (t["earned"], t["possible"], t["percent"], t["letter"], t["excused"]) == ("45", "50", "90", "A-", 1), str(t))
            check(f"state 1 excused (vector {num})", w.cell(cid, b)["state"] == "excused")
        run_world(conn, go)

    # ---- 14 to 15: missing versus an entered zero -------------------------------------------------
    def v14(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 14 missing 50-point item counts 0: 45 of 100, F, state missing",
              (t["earned"], t["possible"], t["percent"], t["letter"], c["state"], t["missing"]) == ("45", "100", "45", "F", "missing", 1), str((t, c["state"])))
    run_world(conn, v14)

    def v15(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.grade(e, b, 0)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 15 entered zero: same 45 of 100, state released (zero is a score)",
              (t["earned"], t["possible"], t["letter"], c["state"]) == ("45", "100", "F", "released"), str((t, c["state"])))
    run_world(conn, v15)

    # ---- 16 to 19: ungraded, held, AI suggestion, AI zero with no work -------------------------------
    def v16(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.commit(e, b, -432000 - 3600)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 16 ungraded item with work committed leaves the total: 45 of 50, A-, backlog",
              (t["earned"], t["possible"], t["letter"], t["ungraded"], c["state"]) == ("45", "50", "A-", 1, "submitted_ungraded"), str((t, c["state"])))
    run_world(conn, v16)

    def v17(w):
        cid, e = w.student()
        a = w.item("a", 50)
        b = w.item("b", 50, grades_release_at=w.at(86400))
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 - 3600)
        w.grade(e, b, 50, submission=s)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 17 finalized grade held by a future release time: 45 of 50, unreleased count 1, graded_unreleased",
              (t["earned"], t["possible"], t["letter"], t["unreleased"], c["state"]) == ("45", "50", "A-", 1, "graded_unreleased"), str((t, c["state"])))
    run_world(conn, v17)

    def v18(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 - 3600)
        w.grade(e, b, 50, final=False, submission=s)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 18 AI suggestion, work committed: 45 of 50, submitted_ungraded with has_draft_score",
              (t["earned"], t["possible"], c["state"], c["draft"]) == ("45", "50", "submitted_ungraded", True), str((t, c)))
    run_world(conn, v18)

    def v19(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.grade(e, b, 0, final=False)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 19 AI-suggested 0 with no work, past due, is missing and not backlog",
              (t["earned"], t["possible"], c["state"], c["draft"]) == ("45", "100", "missing", False), str((t, c["state"])))
    run_world(conn, v19)

    # ---- 20 to 23: late work and the stored zero -----------------------------------------------------
    def v20(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.commit(e, b, -432000 + 86400)                      # a day after the deadline
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 20 late work replaces the missing: ungraded, marked late, 45 of 50",
              (t["earned"], t["possible"], c["state"], c["late"]) == ("45", "50", "submitted_ungraded", True), str((t, c)))
    run_world(conn, v20)

    def v21(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 + 86400)
        w.grade(e, b, 40, submission=s, graded_at=w.at(-60))
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 21 late work graded 40: 85 of 100, B, marked late, the 0 is gone",
              (t["earned"], t["possible"], t["letter"], c["state"], c["late"]) == ("85", "100", "B", "released", True), str((t, c)))
    run_world(conn, v21)

    NOSUB = json.dumps({"no_submission": True})

    def answer(w, sub, item, text="a real answer"):
        w.cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content, is_final) VALUES (%s, %s, %s::jsonb, false)",
                      (sub, item["activities"][0], json.dumps({"q1": text})))

    def stale(w, regrade):
        # a zero marked no_submission (what the grading run and zero_non_submitters write), saved before or after the work
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 + 86400)
        answer(w, s, b)
        w.grade(e, b, 0, submission=s, diagnostic=NOSUB,
                graded_at=w.at(-432000 + 3600) if not regrade else w.at(-60))
        return cid, b, w.totals()[cid], w.cell(cid, b)

    def v22(w):
        cid, b, t, c = stale(w, False)
        check("vector 22 stored 0 with a commit newer than graded_at: submitted_ungraded, late, 45 of 50",
              (t["earned"], t["possible"], c["state"], c["late"]) == ("45", "50", "submitted_ungraded", True), str((t, c)))
    run_world(conn, v22)

    def v23(w):
        cid, b, t, c = stale(w, True)
        check("vector 23 instructor re-enters 0 after the commit: released, 45 of 100",
              (t["earned"], t["possible"], t["letter"], c["state"]) == ("45", "100", "F", "released"), str((t, c)))
    run_world(conn, v23)

    def v22b(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 + 86400)
        answer(w, s, b)
        w.grade(e, b, 0, submission=s, source="ai_suggested", diagnostic=NOSUB, graded_at=w.at(-60))
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 22b AI no_submission 0 stamped after the commit is still stale: submitted_ungraded, late, 45 of 50",
              (t["earned"], t["possible"], c["state"], c["late"]) == ("45", "50", "submitted_ungraded", True), str((t, c)))
    run_world(conn, v22b)

    def v22c(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 - 3600)          # on time
        g = w.grade(e, b, 0, submission=s, source="ai_suggested")
        w.cur.execute("UPDATE grades SET graded_at = NULL WHERE id = %s", (g,))
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 22c AI 0 with no marker, graded_at null, on-time commit: a real zero, released, 45 of 100",
              (t["earned"], t["possible"], c["state"], c["late"]) == ("45", "100", "released", False), str((t, c)))
    run_world(conn, v22c)

    def v22d(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 + 86400)
        w.grade(e, b, 0, submission=s, graded_at=w.at(-432000 + 3600))   # saved before the work, but no marker
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 22d instructor 0 without the no_submission marker is never stale: released, 45 of 100",
              (t["earned"], t["possible"], c["state"]) == ("45", "100", "released"), str((t, c)))
    run_world(conn, v22d)

    def v22e(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.commit(e, b, -432000 + 86400)                # committed with nothing typed
        w.cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content, is_final) VALUES (%s, %s, %s::jsonb, false)",
                      (s, b["activities"][0], json.dumps({"q1": "  ", "q2": ""})))
        w.grade(e, b, 0, submission=s, source="ai_suggested", diagnostic=NOSUB, graded_at=w.at(-60))
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 22e published AI no_submission 0 on a blank commit is a real zero: released, 45 of 100",
              (t["earned"], t["possible"], t["letter"], c["state"]) == ("45", "100", "F", "released"), str((t, c)))
    run_world(conn, v22e)

    def v22f(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        s = w.b.work(e, b, "draft")                        # answers typed, never submitted
        answer(w, s, b)
        w.grade(e, b, 0, submission=s, source="ai_suggested", diagnostic=NOSUB, graded_at=w.at(-60))
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 22f published no_submission 0 over a draft holding real answers is stale: submitted_ungraded, 45 of 50",
              (t["earned"], t["possible"], c["state"]) == ("45", "50", "submitted_ungraded"), str((t, c)))
    run_world(conn, v22f)

    # ---- 24 to 28: drafts, columns, auto-checked ------------------------------------------------------
    def v24(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.b.work(e, b, "draft")
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 24 past-due draft counts as missing (45 of 100)",
              (t["earned"], t["possible"], c["state"]) == ("45", "100", "missing"), str((t, c["state"])))
    run_world(conn, v24)

    def v24b(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.b.work(e, b, "draft")
        w.grade(e, b, 30, final=False)                  # an AI suggestion on the uncommitted draft
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 24b past-due draft holding a score: submitted_ungraded, has_draft_score, out of the total (45 of 50)",
              (t["earned"], t["possible"], c["state"], c["draft"]) == ("45", "50", "submitted_ungraded", True), str((t, c)))
    run_world(conn, v24b)

    def v24c(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.b.work(e, b, "draft")                            # typed, then cleared
        w.grade(e, b, 0, final=False, source="ai_suggested", diagnostic=NOSUB)
        t, c = w.totals()[cid], w.cell(cid, b)
        check("vector 24c blank draft carrying only the AI's suggested 0 is missing, not backlog (45 of 100)",
              (t["earned"], t["possible"], c["state"], c["draft"]) == ("45", "100", "missing", False), str((t, c)))
    run_world(conn, v24c)

    def v25_26(w):
        cid, e = w.student()
        a = w.item("a", 50)
        ip = w.item("exam", 50, how="inperson")
        w.grade(e, a, 45)
        c = w.cell(cid, ip)
        t = w.totals()[cid]
        check("vector 25 in-person blank, column open: item leaves the total, submitted_ungraded, no_work_received",
              (t["possible"], c["state"], c["no_work"], t["no_work"]) == ("50", "submitted_ungraded", True, 1), str((t, c)))
        w.b.close_column(ip, w.sec, w.director)
        c, t = w.cell(cid, ip), w.totals()[cid]
        check("vector 26 same blank, column closed: missing, counts as 14 (45 of 100)",
              (t["possible"], c["state"]) == ("100", "missing"), str((t, c["state"])))
    run_world(conn, v25_26)

    def v26c(w):
        cid, e = w.student()
        a = w.item("a", 50)
        ip = w.item("exam", 50, how="inperson", due=86400)
        w.grade(e, a, 45)
        w.b.close_column(ip, w.sec, w.director)
        c, t = w.cell(cid, ip), w.totals()[cid]
        check("vector 26c closed column, blank, future date: missing, counts as 14 (45 of 100)",
              (t["possible"], c["state"]) == ("100", "missing"), str((t, c["state"])))
    run_world(conn, v26c)

    def v26d(w):
        cid, e = w.student()
        a = w.item("a", 50)
        ip = w.item("exam", 50, how="inperson", due=None)
        w.grade(e, a, 45)
        c0 = w.cell(cid, ip)
        w.b.close_column(ip, w.sec, w.director)
        c, t = w.cell(cid, ip), w.totals()[cid]
        check("vector 26d no date, column open: leaves the total; closed: missing, counts as 14 (45 of 100)",
              (c0["state"], t["possible"], c["state"]) == ("not_due", "100", "missing"), str((c0["state"], t, c["state"])))
    run_world(conn, v26d)

    def ext_vectors(w):
        def ext(e, ao, when, revoked=False):
            w.cur.execute("""INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by,
                                                     revoked_at, revoked_by, revoked_reason)
                             VALUES (%s, %s, %s, 'Made-up reason.', %s, %s, %s, %s)""",
                          (e, ao, when, w.director, w.at(-30) if revoked else None, w.director if revoked else None,
                           "Made-up revoke reason." if revoked else None))
        cid, e = w.student()
        cid2, e2 = w.student()
        cid3, e3 = w.student()
        a = w.item("a", 50)
        for en in (e, e2, e3):
            w.grade(en, a, 45)
        ip = w.item("exam", 50, how="inperson", due=-86400)         # past due
        w.b.close_column(ip, w.sec, w.director)
        ext(e, ip["ao"], w.at(7 * 86400))                           # active, not yet passed
        ext(e2, ip["ao"], w.at(7 * 86400), revoked=True)            # revoked
        ext(e3, ip["ao"], w.at(-3600))                              # expired an hour ago
        c1, c2, c3 = w.cell(cid, ip), w.cell(cid2, ip), w.cell(cid3, ip)
        tt = w.totals()
        check("vector 26h closed column, active unexpired extension: not missing, waits (45 of 50)",
              (c1["state"], tt[cid]["possible"], c1["source"]) == ("not_due", "50", "extension"), str((c1["state"], tt[cid]["possible"], c1["source"])))
        check("vector 26i closed column, revoked extension: missing, counts as 14 (45 of 100)",
              (c2["state"], tt[cid2]["possible"]) == ("missing", "100"), str((c2["state"], tt[cid2]["possible"])))
        check("vector 26j closed column, extension expired: missing, counts as 14 (45 of 100)",
              (c3["state"], tt[cid3]["possible"]) == ("missing", "100"), str((c3["state"], tt[cid3]["possible"])))
    run_world(conn, ext_vectors)

    def boundary(w):
        cid, e = w.student()
        it = w.item("edge", 10, due=-432000)
        w.cur.execute("UPDATE assignment_offerings SET due_at = %s, due_by_day = '{}'::jsonb WHERE id = %s",
                      ("2026-11-01T12:00:00.000+00:00", it["ao"]))
        got = {}
        for label, ms in (("119.999", 119999), ("120.000", 120000), ("120.001", 120001)):
            w.cur.execute("SELECT state FROM _cells_at(%s, 'final', %s::timestamptz + (%s || ' milliseconds')::interval) WHERE assignment_offering_id = %s",
                          (w.co, "2026-11-01T12:00:00.000+00:00", ms, it["ao"]))
            got[label] = w.cur.fetchone()[0]
        check("vector 26k grace boundary: 119.999 s and 120.000 s after the deadline are still on time, 120.001 s is past",
              got == {"119.999": "not_due", "120.000": "not_due", "120.001": "missing"}, str(got))
        import subprocess
        node = {"now": 0, "plant": None, "sections": [{"id": "s", "meeting_days": ["M"]}],
                "offerings": [{"id": "o", "due_at": "2026-11-01T12:00:00.000+00:00", "due_by_day": {}, "dues": []}],
                "enrollments": [{"id": "e", "section_id": "s"}], "extensions": []}
        site = {}
        for label, ms in (("119.999", 119999), ("120.000", 120000), ("120.001", 120001)):
            node["now"] = 1793534400000 + ms                     # 2026-11-01T12:00:00Z in epoch milliseconds
            out = subprocess.run(["node", str(HERE / "deadline-site-side.mjs")], input=json.dumps(node), capture_output=True,
                                 text=True, timeout=60)
            site[label] = json.loads(out.stdout)[0]["is_past"] if out.returncode == 0 else out.stderr[-200:]
        check("vector 26k grace boundary: the shipped site agrees (is_past false, false, true)",
              site == {"119.999": False, "120.000": False, "120.001": True}, str(site))
    run_world(conn, boundary)

    def zones(w):
        cid, e = w.student()
        vals = {"zone-Z": ("2026-11-04T12:00:00Z", True), "zone-offset": ("2026-11-04T12:00:00-07:00", True),
                "date-only": ("2026-11-04", True), "no-zone": ("2026-11-04T12:00:00", False),
                "named-zone": ("2026-11-04T12:00:00 America/Denver", False), "bc": ("2026-11-04 BC", False),
                "trailing-space": ("2026-11-04T12:00:00Z ", False), "word": ("now", False)}
        items = {k: w.item(k, 10, due_by_day={"M": v[0]}) for k, v in vals.items()}
        w.cur.execute("SELECT assignment_offering_id, due_at IS NOT NULL, source, invalid FROM deadline_rows(%s)", (w.co,))
        rows = {r[0]: r[1:] for r in w.cur.fetchall()}
        bad = []
        for k, (v, ok) in vals.items():
            has, src, inv = rows[items[k]["ao"]]
            if ok and not (has and src == "day" and not inv):
                bad.append((k, rows[items[k]["ao"]]))
            if not ok and not (not has and src == "none" and inv):
                bad.append((k, rows[items[k]["ao"]]))
        check("vector 26l day values: a zone (Z or an offset) or a bare date is usable; no zone, a named zone, BC, a trailing space and `now` are flagged unusable",
              not bad, str(bad))
    run_world(conn, zones)

    def bonus_draft(w):
        cid, e = w.student()
        bn = w.item("bonus", 5, is_bonus=True, due=86400)
        w.b.work(e, bn, "draft")
        check("bonus item with a draft before its deadline: in_progress", w.cell(cid, bn)["state"] == "in_progress")
    run_world(conn, bonus_draft)

    def key_cut(w):
        cid, e = w.student()
        a = w.item("a", 201)
        w.grade(e, a, 125)
        t = w.totals()[cid]
        check("percent key is cut, never rounded: 125 of 201 ends ...039800", t["key"] == "62.1890547263681592039800", t["key"])
    run_world(conn, key_cut)

    def null_commit_time(w):
        cid, e = w.student()
        b = w.item("b", 50)
        w.b.work(e, b, "committed", None)
        c = w.cell(cid, b)
        check("a committed row with no commit time has is_late false, never null", c["late"] is False, str(c["late"]))
    run_world(conn, null_commit_time)

    for num, age, state, earned, possible in ((27, 60, "in_progress", "0", "0"), (28, 130, "released", "6", "10")):
        def go(w, num=num, age=age, state=state, earned=earned, possible=possible):
            cid, e = w.student()
            auto = w.item("auto", 10, how="auto", due=-age)
            w.grade(e, auto, 6, source="auto_checked", graded_at=w.at(-age + 30))
            c, t = w.cell(cid, auto), w.totals()[cid]
            check(f"vector {num} auto-checked 6 of 10, deadline {age} seconds ago: {state}, shows 6 (grace is 120 s)",
                  (c["state"], c["points"], t["earned"], t["possible"]) == (state, 6, earned, possible), str((c["state"], c["points"], t["earned"], t["possible"])))
        run_world(conn, go)

    def v29(w):
        cid, e = w.student()
        a = w.item("a", 2)
        w.grade(e, a, 1.25)
        t = w.totals()[cid]
        check("vector 29 fractional 1.25 of 2 is 62.5, D", (t["earned"], t["percent"], t["letter"]) == ("1.25", "62.5", "D"), str(t))
    run_world(conn, v29)

    def v30(w):
        cid, e = w.student()
        p1 = w.item("prog", 10, prog_included=True)
        p2 = w.item("final", 30)
        w.grade(e, p1, 10)
        w.grade(e, p2, 15)
        tf, tp = w.totals("final")[cid], w.totals("prog")[cid]
        check("vector 30 Prog set differs from Final set: each scope sums only its items",
              (tp["earned"], tp["possible"], tf["earned"], tf["possible"]) == ("10", "10", "25", "40"), str((tp, tf)))
    run_world(conn, v30)

    def v31(w):
        cid, e = w.student()
        a, b = w.item("a", 50), w.item("b", 50)
        w.grade(e, a, 45)
        w.grade(e, b, 0)
        eid = w.b.excuse(e, b, w.director)
        t1 = w.totals()[cid]
        w.cur.execute("""UPDATE grade_excusals SET revoked_at = now(), revoked_by = %s, revoked_reason = 'Made-up undo.'
                          WHERE id = %s""", (w.director, eid))
        t2, c = w.totals()[cid], w.cell(cid, b)
        w.cur.execute("SELECT action FROM grade_excusal_events WHERE excusal_id = %s ORDER BY at, id", (eid,))
        log = [r[0] for r in w.cur.fetchall()]
        check("vector 31 revoked excusal: back to the state underneath, and the log has both events",
              (t1["possible"], t2["possible"], c["state"], sorted(log)) == ("50", "100", "released", ["excused", "revoked"]), str((t1["possible"], t2["possible"], c["state"], log)))
    run_world(conn, v31)

    def v32(w):
        a_id, a = w.student()
        d_id, d = w.student(status="dropped")
        b_id, b = w.student()
        it = w.item("a", 10)
        w.grade(a, it, 5)
        w.grade(d, it, 10)
        w.grade(b, it, 7)
        t = w.totals()
        check("vector 32 dropped enrollment is not in totals or ranks",
              d_id not in t and t[b_id]["rank"] == 1 and t[a_id]["rank"] == 2, str({k: v["rank"] for k, v in t.items()}))
    run_world(conn, v32)

    def v33(w):
        cid, e = w.student()
        a = w.item("a", 10)
        bad = w.b.item(w.course, w.co, f"bad-{uuid.uuid4().hex[:8]}", "bad", 10, paths=[WRITTEN], due=w.at(-432000),
                       due_by_day={"M": "not-a-date"}, published=False)
        w.b.publish(bad)
        w.grade(e, a, 8)
        c, t = w.cell(cid, bad), w.totals()[cid]
        check("vector 33 bad stored day value: item leaves the total, source none, deadline_invalid, counted",
              (c["source"], c["invalid"], c["state"], t["possible"], t["invalid"]) == ("none", True, "not_due", "10", 1), str((c, t["possible"], t["invalid"])))
    run_world(conn, v33)

    # ---- ties (41 to 44) ------------------------------------------------------------------------------
    def v41(w):
        p, pe = w.student()
        q, qe = w.student()
        i200, i100 = w.item("big", 200), w.item("small", 100)
        w.grade(pe, i200, 180)
        w.grade(qe, i100, 90)
        w.b.excuse(pe, i100, w.director)
        w.b.excuse(qe, i200, w.director)
        t = w.totals()
        check("vector 41 90 percent on 200 and on 100: P first on higher raw points, no tie flag",
              (t[p]["rank"], t[q]["rank"], t[p]["tie"], t[q]["tie"]) == (1, 2, None, None) and t[p]["percent"] == "90", str((t[p], t[q])))
    run_world(conn, v41)

    def v42(w):
        r, re_ = w.student()
        s, se = w.student()
        i3, i6 = w.item("three", 3), w.item("six", 6)
        w.grade(re_, i3, 1)
        w.grade(se, i6, 2)
        w.b.excuse(re_, i6, w.director)
        w.b.excuse(se, i3, w.director)
        t = w.totals()
        check("vector 42 R 1/3 and S 2/6: equal key, compared on raw points; S first, no flag",
              t[r]["key"] == t[s]["key"] and (t[s]["rank"], t[r]["rank"]) == (1, 2) and t[r]["tie"] is None, str((t[r], t[s])))
    run_world(conn, v42)

    def v43(w):
        tt, te = w.student()
        u, ue = w.student()
        i = w.item("big", 9999.99)
        w.grade(te, i, 3333.33)
        w.grade(ue, i, 3333.34)
        t = w.totals()
        check("vector 43 3333.33 against 3333.34 of 9999.99: different keys, not a tie",
              t[tt]["key"] != t[u]["key"] and t[tt]["tie"] is None and (t[u]["rank"], t[tt]["rank"]) == (1, 2), str((t[tt], t[u])))
    run_world(conn, v43)

    def v44(w):
        v, ve = w.student()
        ww, we = w.student()
        x, xe = w.student()
        i = w.item("a", 100)
        w.grade(ve, i, 90)
        w.grade(we, i, 90)
        w.grade(xe, i, 80)
        t = w.totals()
        check("vector 44 V and W both 90: same tie group, flagged, ranks 1, 1, 3",
              t[v]["tie"] is not None and t[v]["tie"] == t[ww]["tie"] and (t[v]["rank"], t[ww]["rank"], t[x]["rank"]) == (1, 1, 3), str((t[v], t[ww], t[x])))
    run_world(conn, v44)


def rules(conn):
    """Sections 1, 3, 6 and 18, as trials that expect an error and recover with a savepoint."""
    def refused(cur, sql, args, text, name):
        cur.execute("SAVEPOINT s")
        try:
            cur.execute(sql, args)
            cur.execute("RELEASE SAVEPOINT s")
            check(name, False, "the write was accepted")
        except Exception as exc:  # noqa: BLE001
            cur.execute("ROLLBACK TO SAVEPOINT s")
            msg = str(exc)
            check(name, text in msg, msg.strip().splitlines()[0][:120])

    def accepted(cur, sql, args, name):
        cur.execute("SAVEPOINT s")
        try:
            cur.execute(sql, args)
            cur.execute("RELEASE SAVEPOINT s")
            check(name, True)
        except Exception as exc:  # noqa: BLE001
            cur.execute("ROLLBACK TO SAVEPOINT s")
            check(name, False, str(exc).strip().splitlines()[0][:120])

    # ---- section 6: the bonus check ---------------------------------------------------------------------
    def bonus(w):
        c = w.cur
        cid, e = w.student()
        ordinary = w.item("ord", 10)
        bn = w.item("bonus", 5, how="elsewhere", is_bonus=True)
        ao_up = "UPDATE grades SET points_earned = %s WHERE id = %s"
        g_ord = w.grade(e, ordinary, 10)
        accepted(c, ao_up, (10, g_ord), "section 6 at the maximum passes with the flag false")
        refused(c, "UPDATE grades SET points_earned = 11 WHERE id = %s", (g_ord,), "grades_within_bounds",
                "section 6 above the maximum on an ordinary item fails under the old name")
        refused(c, "UPDATE grades SET points_earned = 11, over_max_allowed = true WHERE id = %s", (g_ord,),
                "grades_within_bounds", "section 6 a client-sent flag does not widen an ordinary item")
        g_b = w.grade(e, bn, 5)
        accepted(c, ao_up, (6, g_b), "section 6 above the maximum on a bonus item passes")
        c.execute("SELECT over_max_allowed FROM grades WHERE id = %s", (g_b,))
        check("section 6 the trigger sets the flag on the bonus grade", c.fetchone()[0] is True)
    run_world(conn, bonus)

    # ---- section 1: new items stay unpublished and unfinalized -------------------------------------------
    def new_items(w):
        c = w.cur
        cid, e = w.student()
        flagged = w.b.item(w.course, w.co, f"flag-{uuid.uuid4().hex[:8]}", "flagged", 10, paths=[WRITTEN],
                           due=w.at(86400), published=False, entered_on_new_page=True)
        refused(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (flagged["ao"],),
                "assignment_offerings_new_stay_unpublished", "section 1 an item entered on a new page cannot be published")
        g = w.b.grade(e, flagged, 5, final=False)
        accepted(c, "UPDATE grades SET points_earned = 6 WHERE id = %s", (g,), "section 6 an unfinalized write on a flagged item passes")
        refused(c, "UPDATE grades SET is_finalized = true WHERE id = %s", (g,), "grades_new_items_stay_unfinalized",
                "section 6 finalizing a grade on a flagged item is refused")
        plain = w.item("plain", 10)
        pg = w.grade(e, plain, 5, final=False)
        accepted(c, "UPDATE grades SET is_finalized = true WHERE id = %s", (pg,), "section 6 finalizing on any other item passes")
    run_world(conn, new_items)

    def inactive(w):
        c = w.cur
        cold = w.b.offering(w.course, w.b.term("vec-cold", "Cold", "2027-01-01", "2027-05-01"), False)
        it = w.b.item(w.course, cold, f"cold-{uuid.uuid4().hex[:8]}", "cold", 10, paths=[WRITTEN], due=w.at(86400), published=False)
        refused(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (it["ao"],),
                "assignment_offerings_publish_needs_active", "section 1 publishing on an inactive offering is refused")
        refused(c, "UPDATE course_offerings SET is_active = true WHERE id = %s", (cold,), "course_offerings_one_active",
                "section 1 a second active offering of one course is refused")
        c.execute("UPDATE course_offerings SET is_active = false WHERE id = %s", (w.co,))
        accepted(c, "UPDATE course_offerings SET is_active = true WHERE id = %s", (cold,),
                 "section 1 one active offering per course allows the switch once the first is off")
        accepted(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (it["ao"],),
                 "section 1 publishing on an active offering passes")
    run_world(conn, inactive)

    # ---- section 3: grading_mode follows the paths of a flagged item ---------------------------------------
    def mode(w):
        c = w.cur
        it = w.b.item(w.course, w.co, f"mode-{uuid.uuid4().hex[:8]}", "mode", 4, paths=[
            {"modality": "interactive", "delivery": "interactive_tutor", "grading": "effort"}],
            due=w.at(86400), published=False, entered_on_new_page=True)
        gm = lambda: (c.execute("SELECT grading_mode FROM assignment_offerings WHERE id = %s", (it["ao"],)), c.fetchone()[0])[1]  # noqa: E731
        check("section 3 tutor path only gives effort", gm() == "effort")
        a2 = w.b.id("activity", f"{it['slug']}:written")
        c.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s, %s, 'written', %s, 't', '{}', 1)",
                  (a2, it["assignment"], f"{it['slug']}-w"))
        c.execute("INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role) VALUES (%s, %s, 'graded')", (it["ao"], a2))
        check("section 3 adding a written path gives points", gm() == "points")
        c.execute("UPDATE offering_activities SET grading_role = 'practice' WHERE assignment_offering_id = %s AND activity_id = %s", (it["ao"], a2))
        check("section 3 moving it to practice gives effort", gm() == "effort")
        c.execute("UPDATE offering_activities SET grading_role = 'graded' WHERE assignment_offering_id = %s AND activity_id = %s", (it["ao"], a2))
        check("section 3 back to graded gives points", gm() == "points")
        c.execute("DELETE FROM offering_activities WHERE assignment_offering_id = %s AND activity_id = %s", (it["ao"], a2))
        check("section 3 deleting the path gives effort", gm() == "effort")
        c.execute("DELETE FROM assignment_offerings WHERE id = %s", (it["ao"],))
        check("section 3 deleting the whole item cascades through the trigger with no error", True)
    run_world(conn, mode)

    # ---- section 18: the adjusted-group marker --------------------------------------------------------------
    def marker(w):
        c = w.cur
        cid, e = w.student()
        it = w.item("grp", 20, how="elsewhere", is_group_work=True)
        gid = w.b.id("g", "x")
        c.execute("INSERT INTO student_groups (id, course_offering_id, name) VALUES (%s, %s, 'trial group')", (gid, w.co))
        c.execute("INSERT INTO student_group_members (id, group_id, enrollment_id) VALUES (%s, %s, %s)", (w.b.id("m", "x"), gid, e))
        g = w.b.grade(e, it, 10, student_group_id=gid, student_group_adjusted=False)
        c.execute("SELECT set_config('app.group_score_marker', 'on', true)")
        c.execute("UPDATE grades SET points_earned = 11 WHERE id = %s", (g,))
        c.execute("SELECT student_group_adjusted FROM grades WHERE id = %s", (g,))
        on = c.fetchone()[0]
        c.execute("SELECT set_config('app.group_score_marker', 'off', true)")
        c.execute("UPDATE grades SET points_earned = 12 WHERE id = %s", (g,))
        c.execute("SELECT student_group_adjusted FROM grades WHERE id = %s", (g,))
        off = c.fetchone()[0]
        check("section 18 a write with the marker on leaves the flag false; without it the flag is true", (on, off) == (False, True), str((on, off)))
    run_world(conn, marker)

    def signed_in(cur, uid, fn):
        """Run fn as the `authenticated` role with the caller's id in the token (what the REST layer does)."""
        cur.execute("SET LOCAL ROLE authenticated")
        cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": uid, "role": "authenticated"}),))
        try:
            fn()
        finally:
            cur.execute("RESET ROLE")

    # ---- the marker is one-way; a path only a new page produces keeps its item unpublished ---------------------
    def one_way(w):
        c = w.cur
        flagged = w.b.item(w.course, w.co, f"ow-{uuid.uuid4().hex[:8]}", "flagged", 10, paths=[WRITTEN],
                           due=w.at(86400), published=False, entered_on_new_page=True)
        refused(c, "UPDATE assignment_offerings SET entered_on_new_page = false WHERE id = %s", (flagged["ao"],),
                "assignment_offerings_marker_one_way", "section 1 the marker cannot be cleared")
        accepted(c, "UPDATE assignment_offerings SET entered_on_new_page = true WHERE id = %s", (flagged["ao"],),
                 "section 1 setting the marker again is a no-op")
        # an unflagged item with an in-person path cannot publish, whoever asks
        ip = w.item("exam", 20, how="inperson", publish=False)
        refused(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (ip["ao"],),
                "assignment_offerings_new_paths_stay_unpublished", "section 1 an unflagged item with an in-person path cannot publish")
        for how, dl in (("auto", "online_questions"), ("elsewhere", "elsewhere")):
            it = w.item(f"p-{how}", 10, how=how, publish=False)
            refused(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (it["ao"],),
                    "assignment_offerings_new_paths_stay_unpublished", f"section 1 an item with a {dl} path cannot publish")
        # the other direction: adding such a path to a published item
        pub = w.item("pub", 10)
        act = w.b.id("activity", "late-ext")
        c.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s, %s, 'external', %s, 't', '{}', 5)",
                  (act, pub["assignment"], f"ext-{uuid.uuid4().hex[:8]}"))
        refused(c, "INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role, delivery, grading) VALUES (%s, %s, 'graded', 'in_person', 'hand_entered')",
                (pub["ao"], act), "offering_activities_new_paths_stay_unpublished",
                "section 1 a published item cannot take an in-person path")
        # existing Fall shapes and old-editor writes still pass
        accepted(c, "UPDATE assignment_offerings SET is_published = true WHERE id = %s", (pub["ao"],),
                 "section 1 re-saving a published written item passes")
        tutor = w.b.id("activity", "tutor")
        c.execute("INSERT INTO activities (id, assignment_id, modality, slug, title, content, position) VALUES (%s, %s, 'interactive', %s, 't', '{}', 6)",
                  (tutor, pub["assignment"], f"tut-{uuid.uuid4().hex[:8]}"))
        accepted(c, "INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role) VALUES (%s, %s, 'graded')",
                 (pub["ao"], tutor), "section 1 a published item takes a tutor path through the old editor's insert")
        accepted(c, "INSERT INTO offering_activities (assignment_offering_id, activity_id, grading_role) VALUES (%s, %s, 'graded') "
                    "ON CONFLICT (assignment_offering_id, activity_id) DO UPDATE SET grading_role = EXCLUDED.grading_role",
                 (pub["ao"], tutor), "section 1 the old editor's path upsert passes")
    run_world(conn, one_way)

    # ---- column closures: no direct delete; a cascade and an instructor removal still work --------------------
    def closures(w):
        c = w.cur
        ip = w.item("exam", 20, how="inperson")
        w.b.close_column(ip, w.sec, w.director)
        refused(c, "DELETE FROM column_closures WHERE assignment_offering_id = %s", (ip["ao"],), "never deleted directly",
                "section 7 a column closure is never deleted directly")
        accepted(c, "UPDATE column_closures SET reopened_at = now() WHERE assignment_offering_id = %s AND reopened_at IS NULL",
                 (ip["ao"],), "section 7 a closure can be reopened")
        c.execute("SELECT has_table_privilege('authenticated', 'app.column_closures', 'DELETE')")
        check("section 7 no browser role holds DELETE on column_closures", c.fetchone()[0] is False)
        # removing the instructor who closed it must work, and the record stays
        ip2 = w.item("exam2", 20, how="inperson")
        w.b.close_column(ip2, w.sec, w.director)
        cid, e = w.student()
        w.b.excuse(e, ip2, w.director)
        accepted(c, "DELETE FROM instructors WHERE id = %s", (w.director,), "section 17 removing an instructor works while records name them")
        c.execute("SELECT count(*), count(closed_by) FROM column_closures WHERE assignment_offering_id = %s", (ip2["ao"],))
        n, named = c.fetchone()
        c.execute("SELECT count(*) FROM grade_excusal_events WHERE assignment_offering_id = %s", (ip2["ao"],))
        check("section 17 the closure row stays with its actor cleared, and no spurious excusal event",
              (n, named, c.fetchone()[0]) == (1, 0, 1), str((n, named)))
        # a cascade from the lesson still removes the closure
        accepted(c, "DELETE FROM assignment_offerings WHERE id = %s", (ip["ao"],), "section 7 deleting a lesson removes its closures")
    run_world(conn, closures)

    # ---- groups: columns guarded, apply_group_score is not granted and protects released grades -----------------
    def groups(w):
        c = w.cur
        cid, e = w.student()
        cid2, e2 = w.student()
        it = w.item("grp", 20, how="typed", is_group_work=True)
        plain = w.item("nongrp", 20, how="typed")
        gid = w.b.id("g", "x")
        c.execute("INSERT INTO student_groups (id, course_offering_id, name) VALUES (%s, %s, 'trial group')", (gid, w.co))
        for en in (e, e2):
            c.execute("INSERT INTO student_group_members (id, group_id, enrollment_id) VALUES (%s, %s, %s)", (w.b.id("m", en), gid, en))
        g = w.grade(e, it, 10)
        gp = w.grade(e, plain, 10)
        c.execute("SELECT has_function_privilege('authenticated', 'app.apply_group_score(uuid,uuid,numeric,uuid[])', 'EXECUTE')")
        check("section 18 apply_group_score is granted to no browser role at step 1", c.fetchone()[0] is False)
        # direct writes to the two columns from a signed-in role are refused
        signed_in(c, w.director, lambda: refused(c, "UPDATE grades SET student_group_id = %s WHERE id = %s", (gid, gp),
                  "written by apply_group_score only", "section 18 a signed-in role cannot set student_group_id"))
        signed_in(c, w.director, lambda: refused(c, "UPDATE grades SET student_group_adjusted = true WHERE id = %s", (gp,),
                  "written by apply_group_score only", "section 18 a signed-in role cannot set student_group_adjusted"))
        signed_in(c, w.director, lambda: refused(c,
                  "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, student_group_id) VALUES (%s, %s, 1, 20, %s)",
                  (e2, plain["ao"], gid), "written by apply_group_score only", "section 18 a signed-in role cannot insert a grouped grade"))
        c.execute("UPDATE grades SET student_group_id = %s WHERE id = %s", (gid, g))
        signed_in(c, w.director, lambda: accepted(c, "UPDATE grades SET points_earned = 11 WHERE id = %s", (g,),
                  "section 18 a signed-in score edit on a grouped grade passes"))
        c.execute("SELECT student_group_adjusted FROM grades WHERE id = %s", (g,))
        check("section 18 that edit set the adjusted flag", c.fetchone()[0] is True)
        # the function, with the step 2 grant simulated inside this rolled-back transaction
        c.execute("GRANT EXECUTE ON FUNCTION apply_group_score(uuid, uuid, numeric, uuid[]) TO authenticated")
        out = {}

        def spread(item, overwrite=None):
            c.execute("SELECT enrollment_id, outcome FROM apply_group_score(%s, %s, 15, %s::uuid[])",
                      (gid, item["ao"], overwrite or []))
            return dict(c.fetchall())
        try:
            signed_in(c, w.director, lambda: refused(c, "SELECT * FROM apply_group_score(%s, %s, 15)", (gid, plain["ao"]),
                      "not marked as group work", "section 18 apply_group_score refuses an item that is not group work"))
            signed_in(c, w.director, lambda: out.update(a=spread(it)))
            check("section 18 a released grade is skipped, a member with no grade is written",
                  out["a"].get(e) == "skipped_released" and out["a"].get(e2) == "written", str(out["a"]))
            c.execute("SELECT points_earned FROM grades WHERE id = %s", (g,))
            check("section 18 the skipped grade did not move", str(c.fetchone()[0]) == "11.00")
            signed_in(c, w.director, lambda: out.update(b=spread(it, [e])))
            check("section 18 a Director who names the enrollment overwrites it", out["b"].get(e) == "overwritten", str(out["b"]))
            c.execute("SELECT count(*) FROM student_group_snapshots WHERE group_id = %s AND assignment_offering_id = %s", (gid, it["ao"]))
            check("section 18 each spread logs who was in the group", c.fetchone()[0] == 4)
        finally:
            c.execute("RESET ROLE")
    run_world(conn, groups)

    # ---- a key's author and checker come from the database ---------------------------------------------------
    def keys(w):
        c = w.cur
        it = w.item("kq", 5, how="auto")
        c.execute("SELECT id FROM questions WHERE activity_id = %s", (it["activities"][0],))
        q = c.fetchone()[0]
        other = w.b.staff(f"other-{uuid.uuid4().hex[:6]}", "Other Director")
        res = {}

        def write():
            c.execute("INSERT INTO question_keys (question_id, variant_key, version, value, tol_abs, written_by, checked_by, checked_at, created_by) "
                      "VALUES (%s, 'v', 7, 2, 0.1, 'human', %s, now() - interval '9 days', %s) RETURNING created_by, checked_by, checked_at",
                      (q, other, other))
            res["row"] = c.fetchone()
        signed_in(c, w.director, write)
        cb, ck, at = res["row"]
        c.execute("SELECT now() - %s < interval '1 minute'", (at,))
        check("section 12 created_by and checked_by are the signed-in caller, checked_at is now, whatever the client sent",
              (str(cb), str(ck)) == (w.director, w.director) and c.fetchone()[0], str(res["row"]))
        # an AI-written key starts unchecked (070), so the check above uses a human key; the flip that matters is an AI key
        # turned into a human one, which would launder it past the person's check
        def write_ai():
            c.execute("INSERT INTO question_keys (question_id, variant_key, version, value, tol_abs, written_by) "
                      "VALUES (%s, 'w', 8, 2, 0.1, 'ai')", (q,))
        signed_in(c, w.director, write_ai)
        refused(c, "UPDATE question_keys SET written_by = 'human' WHERE question_id = %s AND version = 8", (q,), "do not change",
                "section 12 written_by cannot be flipped after the fact")
    run_world(conn, keys)


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    try:
        vectors(conn)
        rules(conn)
    finally:
        conn.rollback()
        conn.close()
    want_states = {"excused", "released", "graded_unreleased", "submitted_ungraded", "missing", "in_progress", "not_due"}
    check("every grade state of section 7 was observed on a cell", want_states <= SEEN_STATES, str(want_states - SEEN_STATES))
    check("every flag (late, draft score, no work received, deadline invalid) was observed",
          {"late", "draft", "no_work", "invalid"} <= SEEN_FLAGS, str({"late", "draft", "no_work", "invalid"} - SEEN_FLAGS))
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
