"""Contract test: the overnight aggregator against lesson_aggregate's own cmd_pull and cmd_write.

    "<repo>/.venv/Scripts/python.exe" supabase/admin/overnight_contract_test.py

Why this is a separate script and not part of overnight_test.py: importing lesson_aggregate replaces
sys.stdout and sys.stderr at import time, which breaks unittest's runner. It also needs psycopg2,
which only the repo's own virtual environment has.

What it proves that the mocked tests cannot. The unit tests feed aggregate_track a hand-built pull
and a store that accepts anything. Here the pull is produced by the REAL cmd_pull from rows in the
shape _load_reports returns, and the items the aggregator builds go through the REAL cmd_write in a
dry run and a committing run. Only the database is replaced, by a fake connection that records the
row the writer would insert. No network, no database, no model: the model is a scripted FakeClient.
Every name and answer is synthetic.
"""
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import overnight_test as ot  # noqa: E402  (no side effects on stdout)
from overnight import llm, store as storemod  # noqa: E402
from overnight.aggregate_run import aggregate_track  # noqa: E402

import lesson_aggregate as la  # noqa: E402  (replaces sys.stdout; keep this import last)

OID, CO, INS = "off-1", "co-1", "ins-1"
UPDATED = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)


def assessment(mis_id, meaningful=True):
    return {"schema": 1, "effort": 4, "overall_understanding": 3, "q2_effort": 4, "q3_understanding": 3,
            "objectives": [], "completed": True, "reading_minutes": 25,
            "misconceptions": [{"id": mis_id, "label": "Label " + mis_id, "description": "Does not see charge move.",
                                "severity": "minor", "evidence": "the conductor stays neutral"}],
            "reading_reflection": {"meaningful": meaningful, "engagement": 4, "text": "synthetic thought"},
            "flags": {}}


def report_rows():
    """The shape _load_reports returns: one dict per student, uuids already strings."""
    out = []
    for n, (mis, ok) in enumerate((("polarization-missed", True), ("sign-confusion", True), ("polarization-missed", False)), 1):
        out.append({"student_id": 2000 + n, "enrollment_id": "enr-%d" % n, "section_id": ot.SEC1, "section_code": "M1A",
                    "meeting_days": ["M"], "effort": 4, "points_earned": 2.0, "diagnostic": {"schema": 1},
                    "question_scores": {"q3": {"score": 1.0, "max": 1.0, "status": "full"}},
                    "did_interactive": False, "did_written": True, "updated_at": UPDATED, "path": "written",
                    "report_data": assessment(mis, ok), "q2_effort": 4, "q3_understanding": 3,
                    "reflection_text": "synthetic thought %d" % n,
                    "responses": [{"question_id": "q3", "answer": "synthetic answer", "score": 1.0, "max": 1.0, "status": "full"}]})
    return out


META = {"offering_id": OID, "course_offering_id": CO, "slug": "preflight-01", "activity_title": "Electrostatics",
        "assignment_slug": "preflight-01", "assignment_title": "Electrostatics", "course_code": "phys-215",
        "term_code": "fall-2026", "points_possible": 2.0, "grading_mode": "points", "interactive_id": None,
        "written_id": "act-w", "written_withheld": False,
        "written_content": {"questions": [
            {"id": "q1", "type": "free_response", "role": "reading_time", "text": "How much time did you spend reading?", "points": 0},
            {"id": "q2", "type": "free_response", "role": "reading_reflection", "text": "What was most confusing?", "points": 1},
            {"id": "q3", "type": "free_response", "role": "free_response", "text": "Why is a neutral conductor attracted?",
             "points": 1, "expected_response": "Charges redistribute."}]}}


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        if "insert into analysis_reports" in sql:
            self.conn.inserted.append(params[3].adapted)

    def fetchone(self):
        return None

    def fetchall(self):
        return []


class FakeConn:
    def __init__(self):
        self.inserted, self.commits, self.rollbacks = [], 0, 0

    def cursor(self, *a, **k): return FakeCursor(self)
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1


class Harness:
    """Just enough of PgStore for its own aggregate_pull and aggregate_write to run unmodified."""

    def __init__(self):
        self.la, self.conn, self.invoked_by, self._terms = la, FakeConn(), "human", {}
        self.write_log = []

    _private_dir = storemod.PgStore._private_dir
    aggregate_pull = storemod.PgStore.aggregate_pull

    def aggregate_write(self, items, track, dry_run):
        n, text = storemod.PgStore.aggregate_write(self, items, track, dry_run)
        self.write_log.append((dry_run, n, text))
        return n, text


class Contract(unittest.TestCase):
    def setUp(self):
        self.saved = {k: getattr(la, k) for k in ("_lesson_meta", "_load_reports", "_existing_payload", "_instructors",
                                                   "_sections", "_run_start", "_run_finish")}
        la._lesson_meta = lambda conn, slug, term=None: dict(META)
        la._load_reports = lambda conn, *a, **k: report_rows()
        la._existing_payload = lambda conn, oid: {}
        la._instructors = lambda conn, co: {INS: {"instructor_id": INS, "instructor_name": "Synthetic Instructor",
                                                  "section_ids": [ot.SEC1], "section_codes": ["M1A"]}}
        la._sections = lambda conn, co: ({ot.SEC1: "M1A"}, {"M1A": ot.SEC1})
        la._run_start = lambda *a, **k: 1
        la._run_finish = lambda *a, **k: None

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(la, k, v)

    def replies(self, long_summary=False):
        def fn(model, system, user, tag):
            if tag.startswith("agg-sec"):
                return json.dumps({"section_id": ot.SEC1, "misconception_recommendation": "Open with how a neutral conductor polarizes.",
                                   "selected_quotes": [{"student_id": "R1", "section_id": ot.SEC1}]})
            if tag.startswith("agg-ins"):
                return json.dumps({"section_id": "instr:" + INS, "section_notes": [],
                                   "readiness_summary": "Cadets see attraction but not why. Start with polarization."})
            if tag.startswith("agg-alias"):
                return json.dumps({"misconception_aliases": {}})
            return json.dumps({"section_id": "__all__", "selected_quotes": [],
                               "readiness_summary": "The class needs polarization first.",
                               "misconception_recommendation": "Demonstrate polarization on a neutral rod."})
        return fn

    def test_real_pull_through_aggregator_into_real_writer(self):
        store = Harness()
        client = llm.FakeClient(self.replies())
        res = aggregate_track(ot.runtime(client), store, ot.lesson(), "M")

        self.assertEqual(res["status"], "success", res)
        self.assertEqual((res["all_scope"], res["scopes_written"], res["errors"]), ("written", 3, 0))
        # The dry run came first, and neither run reported a rejected item.
        self.assertEqual([d for d, _, _ in store.write_log], [True, False])
        for _, n, text in store.write_log:
            self.assertEqual(n, 0, text)
            self.assertNotIn("[err ]", text)
        # The writer accepted all three scopes and committed one merged row.
        self.assertEqual(store.conn.commits, 1)
        payload = store.conn.inserted[-1]
        self.assertEqual(sorted(payload["scopes"]), sorted([ot.SEC1, "instr:" + INS, "__all__"]))
        sec = payload["scopes"][ot.SEC1]
        self.assertEqual(sec["selected_quotes"], [{"student_id": 2001, "section_id": ot.SEC1}])   # handle mapped back
        self.assertEqual(sec["meta"]["n"], 3)
        self.assertTrue(payload["scopes"]["instr:" + INS]["readiness_summary"])
        # What the model was given came from the real pull, with no cadet id in it.
        for c in client.calls:
            for sid in ("2001", "2002", "2003"):
                self.assertNotIn(sid, c["user"])

    def test_item_caps_agree_with_the_writer(self):
        from overnight import validate
        self.assertLessEqual(validate.MAX_SUMMARY, la.MAX_SUMMARY)
        self.assertLessEqual(validate.MAX_RECO, la.MAX_RECO)
        self.assertLessEqual(validate.MAX_NOTE, la.MAX_NOTE)
        self.assertLessEqual(validate.MAX_NOTES, la.MAX_NOTES)
        self.assertLessEqual(validate.MAX_QUOTES, la.MAX_QUOTES)


if __name__ == "__main__":
    unittest.main(verbosity=1)
