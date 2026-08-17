#!/usr/bin/env python3
"""Offline checks for name_scan.py — NO DATABASE, NO CREDENTIALS, NO REAL NAMES.

WHY THIS EXISTS
    On a redacted tree this check returns 0 findings, correctly. Nothing about the FAILING path is
    exercised by running it, which is exactly the condition under which a broken detector sits
    green for a term — the same argument orphaned_submissions_test.py makes.

    So the fixtures here drive the matcher directly, over a temporary tree, with an entirely
    invented roster. Two properties matter and both are asserted:

      * the HIT path fires and exits non-zero, including the shape that started all this —
        a name in a test fixture that reads as invented and is not
      * the SYNTHETIC exclusions stay SILENT: the POC block, the training sandbox, the deliberate
        test accounts, un-provisioned rows, fabricated <cadetID>@usafa.edu addresses, and the
        (path, student_id) ALLOW entries for placeholders that collide with a real roster row

    A false positive is not a cosmetic problem here. This check is meant to be wired into a commit
    path, and one that flags the POC roster on every run is one everybody learns to bypass.

NO REAL NAMES IN THIS FILE. Every name below is invented, which is the rule the scanner enforces.

Usage:  python scripts/checks/name_scan_test.py
"""

import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):  # pragma: no cover
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("name_scan", os.path.join(HERE, "name_scan.py"))
N = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(N)

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


# ── An invented roster ────────────────────────────────────────────────────────────────────────
# Shapes deliberately mirror the live table: a provisioned cadet with a registrar address, a
# generational suffix, a multi-token given name, and one of every synthetic block.

REAL_A = {"student_id": 3000139519, "name": "Zephyrine Quillon Marbrook IV",
          "email": "z.marbrook@afacademy.af.edu", "provisioned": True}
REAL_B = {"student_id": 3000140076, "name": "Ondrea Falkirth",
          "email": "o.falkirth@afacademy.af.edu", "provisioned": True}
COLLIDER = {"student_id": 3000138988, "name": "Wendeline Ashgrove",
            "email": "w.ashgrove@afacademy.af.edu", "provisioned": True}

POC = {"student_id": 3000100007, "name": "Vantrel Doombrace", "email": "vd@example.com",
       "provisioned": True}
SANDBOX_A = {"student_id": 3000980004, "name": "Kelbrin Vasterly", "email": "kv@example.com",
             "provisioned": True}
SANDBOX_B = {"student_id": 3000990011, "name": "Perrigan Oakhollow", "email": None,
             "provisioned": False}
TESTACCT = {"student_id": 3009999999, "name": "Sundry Testwright", "email": "st@example.com",
            "provisioned": True}
UNPROVISIONED = {"student_id": 3000141222, "name": "Halbrent Yarrowmere",
                 "email": "h.yarrowmere@afacademy.af.edu", "provisioned": False}
FABRICATED_EMAIL = {"student_id": 3000141333, "name": "Corbinia Wrenfast",
                    "email": "3000141333@usafa.edu", "provisioned": True}
ONE_TOKEN = {"student_id": 3000141444, "name": "Madonnaesque", "email": "m@afacademy.af.edu",
             "provisioned": True}

ALL_ROWS = [REAL_A, REAL_B, COLLIDER, POC, SANDBOX_A, SANDBOX_B, TESTACCT, UNPROVISIONED,
            FABRICATED_EMAIL, ONE_TOKEN]


# ── is_synthetic / enrolled_names ─────────────────────────────────────────────────────────────
section("who counts as a real cadet")

eq("a provisioned cadet with a registrar email counts",
   N.is_synthetic(REAL_A["student_id"], REAL_A["email"]), False)
eq("the retired POC block does not", N.is_synthetic(POC["student_id"], POC["email"]), True)
eq("the 3000980000 sandbox block does not",
   N.is_synthetic(SANDBOX_A["student_id"], SANDBOX_A["email"]), True)
eq("the 3000990000-71 sandbox block does not",
   N.is_synthetic(SANDBOX_B["student_id"], SANDBOX_B["email"]), True)
eq("the deliberate test account does not",
   N.is_synthetic(TESTACCT["student_id"], TESTACCT["email"]), True)
eq("a fabricated <cadetID>@usafa.edu address does not",
   N.is_synthetic(FABRICATED_EMAIL["student_id"], FABRICATED_EMAIL["email"]), True)
eq("a row with no email at all does not", N.is_synthetic(3000141999, None), True)

roster = N.enrolled_names(ALL_ROWS)
ids = {r[0] for r in roster}
eq("only the three real rows survive", ids, {3000139519, 3000140076, 3000138988})
eq("an un-provisioned cadet is excluded even with a registrar email",
   UNPROVISIONED["student_id"] in ids, False)
eq("a one-token roster name cannot meet the two-token bar",
   ONE_TOKEN["student_id"] in ids, False)

sur = {r[0]: r[1] for r in roster}
eq("the generational suffix is not mistaken for the surname", sur[3000139519], "marbrook")
eq("the masked form leaks only first letters",
   {r[0]: r[3] for r in roster}[3000140076], "O***** F*******")


# ── The matcher, over a real git tree ─────────────────────────────────────────────────────────
def run_tree(files, argv=None):
    """Build a throwaway git repo, point the module at it, run main(). -> (exit_code, output)."""
    tmp = tempfile.mkdtemp(prefix="name-scan-test-")
    try:
        for rel, body in files.items():
            dest = os.path.join(tmp, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(body)
        for cmd in (["git", "init", "-q"], ["git", "add", "-A"]):
            subprocess.run(cmd, cwd=tmp, check=True, capture_output=True)

        real_repo, real_argv = N.REPO, sys.argv
        real_db, real_rest = N.roster_via_db, N.roster_via_rest
        N.REPO = __import__("pathlib").Path(tmp)
        N.roster_via_db = lambda: list(ALL_ROWS)
        N.roster_via_rest = lambda: None
        sys.argv = ["name_scan.py"] + (argv or [])
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                code = N.main()
        finally:
            N.REPO, sys.argv = real_repo, real_argv
            N.roster_via_db, N.roster_via_rest = real_db, real_rest
        return code, buf.getvalue()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


section("the hit path — a name in a tracked file")

CLEAN_CHANGELOG = (
    "# Changelog\n"
    "| Cadet | Course | Was |\n"
    "|---|---|---|\n"
    "| 3000139519 | phys-215 | 0/2, nothing submitted |\n"
    "The cadet 3000140076 was re-opened; points and feedback untouched.\n"
)

code, out = run_tree({"CHANGELOG.md": CLEAN_CHANGELOG})
eq("IDs and scores alone are NOT a finding — that is the whole point of the 2026-08-17 rule",
   code, 0)
eq("and it says PASS", "PASS —" in out, True)

code, out = run_tree({
    "CHANGELOG.md": "Re-opened the grade for Zephyrine Quillon Marbrook IV (3000139519).\n"})
eq("a full name beside its own ID still fails", code, 1)
eq("reports the line", ":1" in out, True)
eq("reports the cadet ID", "3000139519" in out, True)
eq("prints the masked name, not the name",
   "Z******** Q****** M******* I*" in out and "Marbrook" not in out, True)

code, out = run_tree({"CHANGELOG.md": "Reported by two cadets, Falkirth among them — Ondrea.\n"})
eq("surname and given name apart on one line still fires", code, 1)

# The shape that started this: a fixture that reads as invented and is not.
code, out = run_tree({"tests/app-schema/test-thing.mjs":
                      "  { studentId: 3000139519, name: 'Zephyrine Quillon Marbrook IV' },\n"})
eq("a real name inside test fixture data is a finding", code, 1)
eq("names the file so it can be found", "tests/app-schema/test-thing.mjs" in out, True)

section("proximity — a surname alone is not a match")

code, _ = run_tree({"docs/x.md": "The marbrook algorithm is unrelated to anyone.\n"})
eq("a bare surname on a line is not a finding", code, 0)

FAR = "Zephyrine " + ("padding " * 20) + "Marbrook\n"
code, _ = run_tree({"docs/x.md": FAR})
eq("two tokens far apart on one long line do not match at the default window", code, 0)
code, _ = run_tree({"docs/x.md": FAR}, argv=["--proximity", "400"])
eq("…and DO match once the window is widened, so the guard is the reason and not luck", code, 1)

section("the synthetic exclusions stay silent")

SYNTH_TREE = {
    "scripts/fall2026/poc-archive/roster.csv":
        "3000100007,Vantrel Doombrace,M1A\n",
    "scripts/training/seed.sql":
        "INSERT INTO app.students VALUES (3000980004, 'Kelbrin Vasterly');\n"
        "INSERT INTO app.students VALUES (3000990011, 'Perrigan Oakhollow');\n",
    "tests/app-schema/test-acct.mjs":
        "const TEST_CADET = { id: 3009999999, name: 'Sundry Testwright' };\n",
    "supabase/seed_full.sql":
        "-- Corbinia Wrenfast and Halbrent Yarrowmere are not enrolled cadets\n",
}
code, out = run_tree(SYNTH_TREE)
eq("no fabricated roster name is flagged, in any block", code, 0)
eq("and the run reports PASS rather than silently doing nothing", "PASS —" in out, True)

section("the ALLOW list — a placeholder that collides with a real row")

PLACEHOLDER = "3000123456,Ashgrove Wendeline,M1A\n"
code, _ = run_tree({"docs/operations/SYSTEM_GUIDE.md": PLACEHOLDER})
eq("the documented placeholder does not fire", code, 0)
code, out = run_tree({"docs/operations/SYSTEM_GUIDE.md":
                      PLACEHOLDER + "Zephyrine Quillon Marbrook IV\n"})
eq("but a DIFFERENT cadet in the same file still does — ALLOW is keyed on (path, id)", code, 1)
eq("and it is the other cadet that is named", "3000139519" in out and "3000138988" not in out,
   True)
code, _ = run_tree({"docs/elsewhere.md": PLACEHOLDER})
eq("the same string in another file is NOT allow-listed", code, 1)

section("--json, for a commit-path gate")

code, out = run_tree({"CHANGELOG.md": "Ondrea Falkirth was re-opened.\n"}, argv=["--json"])
payload = json.loads(out)
eq("json exit code matches the human path", code, 1)
eq("ok is false", payload["ok"], False)
eq("one hit reported", len(payload["hits"]), 1)
eq("distinct cadets counted", payload["distinct_cadets"], 1)
eq("the cadet ID is machine-readable", payload["hits"][0]["student_id"], 3000140076)
# A name reaching a log or a committed file is the exact thing this check exists to prevent.
eq("no unmasked name anywhere in the machine-readable output",
   "Falkirth" not in out and "Ondrea" not in out, True)
eq("the masked form is there instead", payload["hits"][0]["masked"], "O***** F*******")

section("a check that cannot run must not report clean")

real_db, real_rest = N.roster_via_db, N.roster_via_rest
N.roster_via_db = N.roster_via_rest = lambda: None
sys.argv = ["name_scan.py"]
buf = io.StringIO()
try:
    with redirect_stdout(buf):
        code = N.main()
finally:
    N.roster_via_db, N.roster_via_rest = real_db, real_rest
eq("no credentials exits 2, never 0", code, 2)

N.roster_via_db, N.roster_via_rest = lambda: list(ALL_ROWS[3:]), lambda: None
sys.argv = ["name_scan.py"]
buf = io.StringIO()
try:
    with redirect_stdout(buf):
        code = N.main()
finally:
    N.roster_via_db, N.roster_via_rest = real_db, real_rest
eq("a roster with no real cadets in it exits 2, not 0", code, 2)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
