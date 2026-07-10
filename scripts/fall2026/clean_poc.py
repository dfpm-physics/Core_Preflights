#!/usr/bin/env python3
"""
Part B — Clean the Physics 215 proof-of-concept fake data.

SAFETY: refuses to run unless the Part A snapshot (poc-archive/MANIFEST.json) exists AND its
recorded row counts still match the live database (i.e. the archive is a faithful, current
backup). Deletes child rows before parents so no FK cascade surprises. Requires --commit.

Removed: fake students/sections, all fake submissions (responses/scores/interaction reports/
lesson_completions/extensions), the 3 test preflights (preflight-1/2/3), and the
demo-rollup-sandbox interaction.
KEPT: the lesson-02/03/04 interaction artifacts, and all real accounts (instructors,
instructor_course_access, courses) — and the 37 new Fall preflights.
"""

import argparse
import json
import os
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
ARCHIVE_DIR = os.path.join(os.path.dirname(__file__), "poc-archive")

with open(CONFIG_PATH) as f:
    _cfg = json.load(f)
SUPA_URL = _cfg["supabase_url"].rstrip("/")
SUPA_KEY = _cfg["supabase_service_key"]
H = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}


def count(path):
    """Exact row count via PostgREST Prefer: count=exact + HEAD-ish GET."""
    req = urllib.request.Request(f"{SUPA_URL}/rest/v1/{path}",
                                 headers={**H, "Prefer": "count=exact", "Range": "0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range", "*/0")  # e.g. "0-0/206"
        return int(cr.split("/")[-1])


def delete(path):
    req = urllib.request.Request(f"{SUPA_URL}/rest/v1/{path}", method="DELETE",
                                 headers={**H, "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def verify_snapshot():
    mpath = os.path.join(ARCHIVE_DIR, "MANIFEST.json")
    assert os.path.exists(mpath), "MANIFEST.json missing — run export_poc_snapshot.py (Part A) first."
    manifest = json.load(open(mpath))
    files = manifest["files"]
    # Live counts must equal what was archived, or the backup is stale.
    checks = {
        "students?student_id=gte.0": files["students.json"],
        "sections?course_id=eq.phys-215": files["sections.json"],
        "responses?student_id=gte.0": files["responses.json"],
        "scores?student_id=gte.0": files["scores.json"],
        "extensions?student_id=gte.0": files["extensions.json"],
        "preflight_interaction_reports?student_id=gte.0":
            files["reports_lesson-02-electric-charge-and-coulombs-law.json"]
            + files["reports_lesson-03-vector-form-of-coulombs-law.json"]
            + files["reports_lesson-04-electric-fields-and-electric-field-lines.json"]
            + files["reports_demo-rollup-sandbox.json"],
    }
    print("Snapshot vs. live:")
    ok = True
    for path, archived in checks.items():
        live = count(path)
        good = live == archived
        ok = ok and good
        print(f"  [{'OK ' if good else 'MISMATCH'}] {path.split('?')[0]:32s} live={live} archived={archived}")
    assert ok, "Live counts differ from the archive — refusing to delete. Re-run Part A."
    print("Snapshot verified.\n")


# Child-first delete order. Each filter matches all fake rows.
STEPS = [
    ("preflight_interaction_reports?student_id=gte.0", "interaction reports"),
    ("lesson_completions?student_id=gte.0",            "lesson completions"),
    ("responses?student_id=gte.0",                     "responses"),
    ("scores?student_id=gte.0",                        "scores"),
    ("extensions?student_id=gte.0",                    "extensions"),
    ("students?student_id=gte.0",                      "fake students"),
    ("sections?course_id=eq.phys-215",                 "fake sections"),
    ("assignments?id=in.(preflight-1,preflight-2,preflight-3)", "POC test preflights"),
    ("interactions?id=eq.demo-rollup-sandbox",         "demo interaction"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="perform the deletes (default: check only)")
    args = ap.parse_args()

    verify_snapshot()

    if not args.commit:
        print("[check only] snapshot is a faithful backup. Re-run with --commit to delete.")
        return

    print("Deleting POC fake data (child-first):")
    for path, label in STEPS:
        before = count(path)
        delete(path)
        after = count(path)
        print(f"  {label:24s} {before:4d} -> {after}")

    print("\nRemaining phys-215 interactions:")
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/interactions?course_id=eq.phys-215&select=id,is_published", headers=H)
    for r in json.load(urllib.request.urlopen(req, timeout=30)):
        print("  ", r["id"], "published" if r["is_published"] else "unpublished")


if __name__ == "__main__":
    main()
