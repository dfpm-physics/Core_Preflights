#!/usr/bin/env python3
"""Offline checks for name_scan.py hash mode — NO DATABASE, NO CREDENTIALS, INVENTED NAMES ONLY.

Proves: hash-file matching gives the same hits as the live-style scan; the written file holds no
plain name; a staged new file is covered while an untracked one is not (as live); a missing or
broken file exits 2; a stale file warns; a tracked or un-ignored path is refused.

Usage:  python scripts/checks/name_scan_hash_test.py
"""

import datetime
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout

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


ROWS = [
    {"student_id": 3000139519, "name": "Zephyrine Quillon Marbrook IV",
     "email": "z.marbrook@afacademy.af.edu", "provisioned": True},
    {"student_id": 3000140076, "name": "Ondrea Falkirth",
     "email": "o.falkirth@afacademy.af.edu", "provisioned": True},
    {"student_id": 3000138988, "name": "Wendeline Ashgrove",
     "email": "w.ashgrove@afacademy.af.edu", "provisioned": True},
    {"student_id": 3000100007, "name": "Vantrel Doombrace", "email": "vd@example.com",
     "provisioned": True},
]
PLAIN_TOKENS = ["zephyrine", "quillon", "marbrook", "ondrea", "falkirth", "wendeline", "ashgrove",
                "vantrel", "doombrace"]

FILES = {
    "CHANGELOG.md": "Re-opened the grade for Zephyrine Quillon Marbrook IV (3000139519).\n"
                    "The marbrook algorithm is unrelated.\n",
    "docs/a.md": "Reported by two cadets, Falkirth among them — Ondrea.\nclean line\n",
    "docs/operations/SYSTEM_GUIDE.md": "3000123456,Ashgrove Wendeline,M1A\n",   # ALLOW'd pair
    "docs/b.md": "Zephyrine " + ("padding " * 20) + "Marbrook\n",              # too far apart
    "docs/c.md": "Vantrel Doombrace is a synthetic block row.\n",
}


def make_repo(files, ignore=None):
    tmp = tempfile.mkdtemp(prefix="name-scan-hash-test-")
    for rel, body in files.items():
        dest = os.path.join(tmp, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
    if ignore:
        with open(os.path.join(tmp, ".gitignore"), "w", encoding="utf-8") as fh:
            fh.write(ignore)
    subprocess.run(["git", "init", "-q"], cwd=tmp, check=True, capture_output=True)
    subprocess.run(["git", "add", "-A"], cwd=tmp, check=True, capture_output=True)
    return tmp


def run_main(tmp, argv, rows=ROWS):
    """-> (code, stdout, stderr). Roster reads are stubbed; no credential or network is touched."""
    saved = (N.REPO, sys.argv, N.roster_via_db, N.roster_via_rest)
    N.REPO = pathlib.Path(tmp)
    N.roster_via_db = lambda: list(rows)
    N.roster_via_rest = lambda: None
    sys.argv = ["name_scan.py"] + argv
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            code = N.main()
    finally:
        N.REPO, sys.argv, N.roster_via_db, N.roster_via_rest = saved
    return code, out.getvalue(), err.getvalue()


def hit_keys(out):
    return sorted((h["file"], h["line"], h["student_id"]) for h in json.loads(out)["hits"])


tmp = make_repo(FILES, ignore="*.hashes.json\n")
outside = tempfile.mkdtemp(prefix="name-scan-hash-out-")
try:
    print("\n=== live-style and hash-file give the same hits ===")
    code_live, out_live, _ = run_main(tmp, ["--json"])
    hf = os.path.join(tmp, "roster.hashes.json")
    code_w, out_w, _ = run_main(tmp, ["--write-hashes", hf])
    eq("writing the file exits 0", code_w, 0)
    code_h, out_h, _ = run_main(tmp, ["--hash-file", hf, "--json"])
    eq("live-style run finds hits", code_live, 1)
    eq("hash-file run exits the same", code_h, code_live)
    eq("same (file, line, cadet) hits", hit_keys(out_h), hit_keys(out_live))
    eq("expected hits are present (two cadets, two files)",
       sorted({(f, s) for f, _, s in hit_keys(out_h)}),
       [("CHANGELOG.md", 3000139519), ("docs/a.md", 3000140076)])
    eq("hash run reports its mode in json", json.loads(out_h)["mode"], "hash-file")
    eq("hash run prints no masked name", all(h["masked"] == "" for h in json.loads(out_h)["hits"]), True)
    code_hp, out_hp, _ = run_main(tmp, ["--hash-file", hf, "--proximity", "400"])
    code_lp, out_lp, _ = run_main(tmp, ["--proximity", "400"])
    eq("a widened window agrees in both modes", (code_hp, code_lp), (1, 1))
    _, out_h2, _ = run_main(tmp, ["--hash-file", hf, "--json", "--proximity", "400"])
    _, out_l2, _ = run_main(tmp, ["--json", "--proximity", "400"])
    eq("and finds the same hits at the wider window", hit_keys(out_h2), hit_keys(out_l2))

    print("\n=== the written file ===")
    text = open(hf, encoding="utf-8").read()
    data = json.loads(text)
    eq("no plain name token in the file", [t for t in PLAIN_TOKENS if t in text.lower()], [])
    eq("format, salt, date, count are there",
       (data["format"], len(data["salt"]) >= 16, data["created"], data["count"]),
       (1, True, datetime.date.today().isoformat(), 3))
    eq("write output has no name", any(t in out_w.lower() for t in PLAIN_TOKENS), False)
    eq("hash-file output says it is a hash file with date and count",
       all(s in out_hp for s in ("HASH FILE", data["created"], "3 names", "NOT the live roster")), True)
    code_w2, _, _ = run_main(tmp, ["--write-hashes", os.path.join(outside, "x.json")])
    data2 = json.load(open(os.path.join(outside, "x.json"), encoding="utf-8"))
    eq("a path outside the repo is allowed, with a fresh salt", (code_w2, data2["salt"] != data["salt"]),
       (0, True))

    print("\n=== a staged new file is covered; an untracked one is not (as live) ===")
    with open(os.path.join(tmp, "docs", "new.md"), "w", encoding="utf-8") as fh:
        fh.write("Wendeline and Ashgrove again, plus Ondrea Falkirth.\n")
    subprocess.run(["git", "add", "docs/new.md"], cwd=tmp, check=True, capture_output=True)
    with open(os.path.join(tmp, "docs", "untracked.md"), "w", encoding="utf-8") as fh:
        fh.write("Zephyrine Marbrook.\n")
    _, out_s, _ = run_main(tmp, ["--hash-file", hf, "--json"])
    _, out_sl, _ = run_main(tmp, ["--json"])
    files_hit = {f for f, _, _ in hit_keys(out_s)}
    eq("staged file is hit", "docs/new.md" in files_hit, True)
    eq("untracked file is not scanned", "docs/untracked.md" in files_hit, False)
    eq("still equal to the live-style result", hit_keys(out_s), hit_keys(out_sl))

    print("\n=== missing, broken, stale ===")
    code, out, err = run_main(tmp, ["--hash-file", os.path.join(tmp, "nope.hashes.json")])
    eq("a missing file exits 2, never 0", code, 2)
    eq("with a plain message", "not found" in err, True)
    bad = os.path.join(tmp, "bad.hashes.json")
    open(bad, "w").write("{not json")
    eq("a broken file exits 2", run_main(tmp, ["--hash-file", bad])[0], 2)
    empty = dict(data, cadets=[], count=0)
    open(bad, "w").write(json.dumps(empty))
    eq("a file with no cadets exits 2", run_main(tmp, ["--hash-file", bad])[0], 2)
    wrong = dict(data, count=99)
    open(bad, "w").write(json.dumps(wrong))
    eq("a count mismatch exits 2", run_main(tmp, ["--hash-file", bad])[0], 2)
    old = dict(data, created=(datetime.date.today() - datetime.timedelta(days=200)).isoformat())
    open(bad, "w").write(json.dumps(old))
    code, out, err = run_main(tmp, ["--hash-file", bad, "--json"])
    eq("a stale file still scans", code, 1)
    eq("and warns about its age", "200 days old" in err, True)
    eq("fresh file does not warn", "days old" in run_main(tmp, ["--hash-file", hf])[2], False)
    eq("both flags together exit 2", run_main(tmp, ["--hash-file", hf, "--write-hashes", hf])[0], 2)

    print("\n=== refused paths ===")
    tracked = os.path.join(tmp, "docs", "a.md")
    before = open(tracked, encoding="utf-8").read()
    code, _, err = run_main(tmp, ["--write-hashes", tracked])
    eq("a tracked path is refused", (code, "tracks" in err), (2, True))
    eq("and left untouched", open(tracked, encoding="utf-8").read(), before)
    other = os.path.join(tmp, "plain.json")
    code, _, err = run_main(tmp, ["--write-hashes", other])
    eq("a path git does not ignore is refused", (code, "does not ignore" in err), (2, True))
    eq("and nothing was written", os.path.exists(other), False)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(outside, ignore_errors=True)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
