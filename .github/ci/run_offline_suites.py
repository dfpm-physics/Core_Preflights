#!/usr/bin/env python3
"""Run the OFFLINE tests/app-schema suites from an explicit list. Standard library only.

Why a list and not a glob or `node run.mjs`:
  * run.mjs also runs the live suites and a cleanup script against a database. CI must never
    do either, so it never calls run.mjs or cleanup.py.
  * a glob would sweep in any live suite added later.

Each suite runs in its own process (several stub window/document globally) with
block_network.mjs preloaded. A suite fails if it exits non-zero, prints a failed-check line,
prints a "suite threw" line, or attempts any network access at all.

A suite's own exit code is not trusted: several print failed checks and still exit 0.

Usage:  python .github/ci/run_offline_suites.py
"""

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / "tests" / "app-schema"
PRELOAD = (Path(__file__).resolve().parent / "block_network.mjs").as_uri()

# Offline: verified to make no network call (blocked and logged when run, 2026-11-04).
OFFLINE = [
    "test-blackboard-fill.mjs", "test-config.mjs", "test-dashboard-rows.mjs",
    "test-db-schema.mjs", "test-ei.mjs", "test-extension-reopen.mjs",
    "test-feedback-admin.mjs", "test-feedback.mjs", "test-grace.mjs",
    "test-grade-cards.mjs", "test-grade-effort-write.mjs", "test-grade.mjs",
    "test-gradebook.mjs", "test-help-status.mjs", "test-imports.mjs",
    "test-legacy-actions.mjs", "test-lesson-due.mjs", "test-lesson-isolation.mjs",
    "test-modals.mjs", "test-publish-plan.mjs", "test-rollup.mjs",
    "test-roster-import.mjs", "test-run-banner.mjs", "test-schema.mjs",
    "test-student-completion.mjs", "test-student-detail.mjs", "test-system-prefs.mjs",
    "test-tasks.mjs", "test-nav.mjs", "test-permission-block.mjs",
    "test-target-guard.mjs", "test-zero-checks.mjs", "test-new-page-guard.mjs",
    "test-faculty-items.mjs", "test-free-response.mjs", "test-lesson-keys.mjs", "test-written-merge.mjs",
    "test-faculty-questions.mjs",
    "test-faculty-scale.mjs",
    "test-faculty-terms.mjs",
    "test-student-view.mjs",
    "test-student-loader.mjs",

    "test-faculty-entry-parse.mjs",
    "test-faculty-entry.mjs",
    "test-faculty-totals.mjs",
    "test-faculty-export.mjs",
    "test-blackboard-export.mjs",
    "test-audit-wiring.mjs",
    "test-grade-safety.mjs",
    "test-safe-next.mjs",
    "test-grade-page-logic.mjs",
    "test-numeric-answer.mjs",
    "test-check-answer-function.mjs",
    "test-problem-file.mjs",
    "test-remark-function.mjs",
    "test-homework.mjs",
    "test-student-homework-link.mjs",
    "test-roll-in-pages.mjs",
    "test-form-layout.mjs",
    "test-roles.mjs",
]
# Python tests that make no network call and need no database (each stubs or never opens a connection).
PY_OFFLINE = [
    "scripts/fall2026/step1_script_guards_test.py",
    "scripts/v2/test_backfill_paths.py",
    "scripts/checks/csp_pages_test.py",
]
# NOT listed anywhere, on purpose (they sign in to, or read, a live database):
#   test-rest.mjs test-student.mjs test-isolation.mjs test-prefs.mjs test-paging.mjs
#   test-edge-functions.mjs
# Nor harness.mjs, run.mjs, cleanup.py.

FAILED_LINE = re.compile(r"\[FAIL\]|^!! suite|\b[1-9]\d* failed\b", re.M)


def run_one(name):
    with tempfile.TemporaryDirectory() as td:
        log = Path(td) / "net.log"
        log.write_text("")
        env = dict(os.environ, CI_NET_LOG=str(log))
        for k in list(env):  # no credential from the runner's environment reaches a suite
            if re.search(r"KEY|TOKEN|SECRET|PASSWORD|DB_URL", k, re.I):
                env.pop(k)
        try:
            r = subprocess.run(["node", "--import", PRELOAD, name],
                               cwd=DIR, env=env, capture_output=True, text=True, timeout=180)
            out, rc = (r.stdout or "") + (r.stderr or ""), r.returncode
        except subprocess.TimeoutExpired:
            out, rc = "timed out", 124
        net = log.read_text().strip().splitlines()
    problems = []
    if rc != 0:
        problems.append(f"exit {rc}")
    if FAILED_LINE.search(out):
        problems.append("failed checks")
    if not re.search(r"\[pass\]|\[FAIL\]", out):
        problems.append("ran zero checks")
    if net:
        problems.append(f"{len(net)} network attempt(s) to: " + ", ".join(sorted({n.split(' ', 1)[1] for n in net})))
    passed = len(re.findall(r"\[pass\]", out))
    return problems, passed, out


def run_python(rel):
    """Run one offline Python test with no credential in its environment. Returns (problems, passed, out)."""
    env = {k: v for k, v in os.environ.items() if not re.search(r"KEY|TOKEN|SECRET|PASSWORD|DB_URL", k, re.I)}
    try:
        r = subprocess.run([sys.executable, str(ROOT / rel)], cwd=ROOT, env=env, capture_output=True,
                           text=True, timeout=180)
        out, rc = (r.stdout or "") + (r.stderr or ""), r.returncode
    except subprocess.TimeoutExpired:
        out, rc = "timed out", 124
    problems = []
    if rc != 0:
        problems.append(f"exit {rc}")
    if re.search(r"\[FAIL\]|\b[1-9]\d* failed\b", out):
        problems.append("failed checks")
    passed = len(re.findall(r"\[pass\]", out))
    if not passed:
        problems.append("ran zero checks")
    return problems, passed, out


def main(argv):
    names = OFFLINE
    bad = 0
    total = 0
    for rel in PY_OFFLINE:
        problems, passed, out = run_python(rel)
        total += passed
        if problems:
            bad += 1
            print(f"FAIL {rel}: {'; '.join(problems)}")
            for line in out.splitlines():
                if "[FAIL]" in line:
                    print("     " + line[:200])
        else:
            print(f"ok   {rel} ({passed} checks)")
    for n in names:
        problems, passed, out = run_one(n)
        total += passed
        if problems:
            bad += 1
            print(f"FAIL {n}: {'; '.join(problems)}")
            for line in out.splitlines():
                if "[FAIL]" in line or line.startswith("!!"):
                    print("     " + line[:200])
        else:
            print(f"ok   {n} ({passed} checks)")
    n_all = len(names) + len(PY_OFFLINE)
    line = f"{n_all - bad}/{n_all} suites clean, {total} checks passed"
    print("\n" + line)
    note = ("NOT RUN IN CI: the schema drift check (site/js/db-schema.js against the staging schema) and "
            "the check that every function in schema app pins its search_path. CI has no database, so "
            "both are reported as skipped inside test-db-schema.mjs and are not counted as passes. "
            "Run tests/app-schema/run.mjs with STAGING_DB_URL set to run them.")
    print("\n" + note)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### Offline suites\n\n{line}.\n\n**{note}**\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
