"""Offline tests for feedback_triage.py: transition rules and argument validation. No database."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feedback_triage as ft  # noqa: E402


class Transitions(unittest.TestCase):
    def ok(self, cur, to, triage, note="n", ref=None):
        ft.check_transition(cur, to, triage, note, ref)

    def bad(self, cur, to, triage, note="n", ref=None):
        with self.assertRaises(ft.Refusal):
            ft.check_transition(cur, to, triage, note, ref)

    def test_allowed(self):
        self.ok("new", "applied", "simple")
        self.ok("new", "proposed", "significant")
        self.ok("accepted", "applied", "significant")
        self.ok("accepted", "applied", "simple", ref="abc1234")

    def test_never_touch_declined_or_duplicate(self):
        for cur in ("declined", "duplicate"):
            for to in ("proposed", "applied"):
                self.bad(cur, to, "simple")

    def test_other_transitions_refused(self):
        self.bad("new", "accepted", "simple")
        self.bad("proposed", "applied", "simple")
        self.bad("applied", "proposed", "significant")
        self.bad("accepted", "proposed", "significant")
        self.bad("new", "declined", "simple")

    def test_triage_rules(self):
        self.bad("new", "applied", "significant")
        self.bad("new", "proposed", "simple")
        self.bad("new", "applied", None)

    def test_note_and_ref(self):
        self.bad("new", "applied", "simple", note="")
        self.bad("new", "applied", "simple", note="   ")
        self.bad("new", "applied", "simple", note="x" * 4001)
        self.ok("new", "applied", "simple", note="x" * 4000)
        self.bad("new", "applied", "simple", ref="r" * 201)


class Arguments(unittest.TestCase):
    def test_mark_requires_fields(self):
        p = ft.build_parser()
        with self.assertRaises(SystemExit):
            p.parse_args(["mark", "id1", "--to", "applied"])
        with self.assertRaises(SystemExit):
            p.parse_args(["mark", "id1", "--to", "accepted", "--triage", "simple", "--note", "x"])
        a = p.parse_args(["mark", "id1", "--to", "applied", "--triage", "simple", "--note", "x"])
        self.assertFalse(a.commit)

    def test_list_defaults(self):
        a = ft.build_parser().parse_args(["list"])
        self.assertEqual(a.status, "new")
        with self.assertRaises(SystemExit):
            ft.build_parser().parse_args(["list", "--status", "declined"])


if __name__ == "__main__":
    unittest.main()
