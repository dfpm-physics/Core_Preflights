#!/usr/bin/env python3
"""Syntax check: `node --check` on shipped site/js/**/*.js, py_compile on scripts/**/*.py.

Standard library only. Writes no bytecode. Lists tracked files (git ls-files) so a local
virtualenv or cache is never scanned.

Not covered, deliberately: .jsx. `node --check` reports success on invalid JSX when the file
has an import or export, so pointing it at artifact sources would print a pass that means
nothing. A syntax pass here proves the file parses, not that it works.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def tracked(*globs):
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True)
    files = [p for p in out.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    return [f for f in files if any(Path(f).match(g) for g in globs)]


def main():
    bad = 0
    js = [f for f in tracked("site/js/*.js", "site/js/**/*.js") if f.startswith("site/js/")]
    py = [f for f in tracked("scripts/*.py", "scripts/**/*.py") if f.startswith("scripts/")]
    for f in sorted(set(js)):
        r = subprocess.run(["node", "--check", f], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            bad += 1
            print(f"FAIL node --check {f}\n     " + (r.stderr.strip().splitlines() or [""])[0][:200])
    for f in sorted(set(py)):
        try:  # same parse step py_compile performs, without writing bytecode
            compile((ROOT / f).read_bytes(), f, "exec")
        except (SyntaxError, ValueError) as e:
            bad += 1
            print(f"FAIL compile {f}\n     {type(e).__name__}: {str(e)[:180]}")
    print(f"syntax_check: {len(set(js))} js, {len(set(py))} py checked, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
