#!/usr/bin/env python3
"""Offline checks for orphaned_submissions.py — NO DATABASE, NO CREDENTIALS.

WHY THIS EXISTS
    A detector that has only ever been seen to PASS is not a detector, it is an assumption. On the
    live database this check currently returns 0 findings, correctly — the one real case was
    repaired on 2026-08-13 — so nothing about the failing path is exercised by running it. That is
    exactly the condition under which a broken check sits green for a term.

    So the fixtures here reconstruct the shape of the real incident (work committed to a dropped
    enrollment while a non-submission zero sits on the active one) and assert that the script
    reports it AND exits non-zero. The severity ladder is asserted too, because the difference
    between "inert" and "ZEROED" is the difference between a note and a cadet's grade.

Usage:  python scripts/checks/orphaned_submissions_test.py
"""

import importlib.util
import io
import os
import sys
from contextlib import redirect_stdout

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):  # pragma: no cover
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "orphaned", os.path.join(HERE, "orphaned_submissions.py"))
O = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(O)

PASSED = FAILED = 0


def eq(label, got, want):
    global PASSED, FAILED
    if got == want:
        PASSED += 1
        print(f"  [pass] {label}")
    else:
        FAILED += 1
        print(f"  [FAIL] {label}\n         got  {got!r}\n         want {want!r}")


def section(title):
    print(f"\n=== {title} ===")


CO = "co-1"
SEC_OLD, SEC_NEW = "sec-t3c", "sec-m5c"
E_OLD, E_NEW = "enr-old", "enr-new"
AO = "ao-preflight-03"
STU = 3000990001

BASE = {
    "sections": [
        {"id": SEC_OLD, "code": "T3C", "course_offering_id": CO},
        {"id": SEC_NEW, "code": "M5C", "course_offering_id": CO},
    ],
    "course_offerings": [{"id": CO, "courses": {"code": "phys-110"},
                          "terms": {"code": "fall-2026"}}],
    "assignment_offerings": [{"id": AO, "course_offering_id": CO,
                              "assignments": {"slug": "preflight-03"}}],
    "students": [{"student_id": STU, "name": "Test Cadet"}],
}


def run(enrollments, submissions, grades, argv=None):
    """Drive main() against fixtures, capturing stdout. Returns (exit_code, output)."""
    tables = {
        "enrollments": enrollments,
        "submissions": submissions,
        "grades": grades,
        **BASE,
    }

    def fake_get(path):
        table = path.split("?", 1)[0]
        rows = tables.get(table, [])
        # Honour the enrollment_id=in.(…) filter the script uses, so the fixture exercises the
        # same filtering path the live query does rather than a shortcut around it.
        if "enrollment_id=in.(" in path:
            wanted = path.split("enrollment_id=in.(", 1)[1].split(")", 1)[0].split(",")
            rows = [r for r in rows if r.get("enrollment_id") in wanted]
        return list(rows)

    real_get, real_load, real_argv = O.get, O.load_config, sys.argv
    O.get, O.load_config = fake_get, lambda: None
    sys.argv = ["orphaned_submissions.py"] + (argv or [])
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            code = O.main()
    finally:
        O.get, O.load_config, sys.argv = real_get, real_load, real_argv
    return code, buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════════════════════════
section("the 2026-08-13 incident, reconstructed")

TWO_ROWS = [
    {"id": E_OLD, "student_id": STU, "section_id": SEC_OLD, "status": "dropped"},
    {"id": E_NEW, "student_id": STU, "section_id": SEC_NEW, "status": "active"},
]
WORK_ON_DROPPED = [{"id": "sub-1", "enrollment_id": E_OLD, "assignment_offering_id": AO,
                    "status": "committed", "committed_at": "2026-08-11T16:13:47+00:00"}]
FINALIZED_ZERO = [{"enrollment_id": E_NEW, "assignment_offering_id": AO, "points_earned": 0,
                   "is_finalized": True, "diagnostic": {"no_submission": True}}]

code, out = run(TWO_ROWS, WORK_ON_DROPPED, FINALIZED_ZERO)
eq("exits non-zero — the whole point of a gate", code, 1)
eq("classified at the top severity", "[ZEROED] 1" in out, True)
eq("names the assignment", "preflight-03" in out, True)
eq("names both sections, so the operator can see the move", "T3C" in out and "M5C" in out, True)
eq("says FAIL in words, not only in the exit code", "FAIL —" in out, True)
# The trap from the finding §8: re-running grading before repointing re-zeroes the cadet.
eq("warns against the wrong repair order", "strictly worse than doing nothing" in out, True)

section("severity ladder")

# Not yet finalized: same defect, still reversible without an instructor reopening anything.
code, out = run(TWO_ROWS, WORK_ON_DROPPED,
                [{"enrollment_id": E_NEW, "assignment_offering_id": AO, "points_earned": 0,
                  "is_finalized": False, "diagnostic": {"no_submission": True}}])
eq("an unfinalized zero is separated from a finalized one",
   "[zeroed-unfinalized] 1" in out, True)
eq("and still fails the gate", code, 1)

# No grade on the survivor yet. Before condition 6 this was a zero waiting to be written.
code, out = run(TWO_ROWS, WORK_ON_DROPPED, [])
eq("an ungraded survivor is flagged as will-be-zeroed", "[will-be-zeroed] 1" in out, True)
eq("and fails the gate, because it is about to become the same defect", code, 1)

# The cadet left the course entirely: work stranded, but no zero is being scored against them.
code, out = run([{"id": E_OLD, "student_id": STU, "section_id": SEC_OLD, "status": "dropped"}],
                WORK_ON_DROPPED, [])
eq("a cadet with no active enrollment is inert, not a failure", code, 0)
eq("but is still reported rather than hidden", "[inert] 1" in out, True)

# Work graded properly against the survivor -- reported for tidiness, not a scoring error.
code, out = run(TWO_ROWS, WORK_ON_DROPPED,
                [{"enrollment_id": E_NEW, "assignment_offering_id": AO, "points_earned": 2,
                  "is_finalized": True, "diagnostic": {}}])
eq("a properly graded survivor is graded-elsewhere", "[graded-elsewhere] 1" in out, True)

section("the clean case must actually be clean")

code, out = run([{"id": E_NEW, "student_id": STU, "section_id": SEC_NEW, "status": "active"}],
                [{"id": "sub-2", "enrollment_id": E_NEW, "assignment_offering_id": AO,
                  "status": "committed", "committed_at": "2026-08-11T16:13:47+00:00"}],
                [])
eq("ordinary work on an active enrollment is not a finding", code, 0)
eq("and says PASS", "PASS —" in out, True)
eq("no false positive reported", "No submission sits on a non-active enrollment" in out, True)

section("the precursor state — two active enrollments")

code, out = run([{"id": E_OLD, "student_id": STU, "section_id": SEC_OLD, "status": "active"},
                 {"id": E_NEW, "student_id": STU, "section_id": SEC_NEW, "status": "active"}],
                [], [])
eq("double enrollment is warned about", "hold TWO active enrollments" in out, True)
eq("but does not fail the gate on its own — no work is stranded yet", code, 0)

section("--json, for the lesson-cycle gate")

code, out = run(TWO_ROWS, WORK_ON_DROPPED, FINALIZED_ZERO, argv=["--json"])
import json as _json
payload = _json.loads(out)
eq("json exit code matches the human path", code, 1)
eq("ok is false", payload["ok"], False)
eq("blocking count is reported", payload["blocking"], 1)
eq("severity breakdown is present", payload["by_severity"], {"ZEROED": 1})
# The gate is machine-read; a name reaching a log or a committed file would breach CORE.md §3.
eq("no cadet name in the machine-readable output", "Test Cadet" not in out, True)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
