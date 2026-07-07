#!/usr/bin/env python3
"""
Part A — Snapshot the Physics 215 proof-of-concept data to JSON before it is cleaned.

Writes a complete, human-readable, restorable archive of the current phys-215 POC data
(interactions + their reports, fake students/sections, and the test written-preflight data)
to scripts/fall2026/poc-archive/. A MANIFEST.json records row counts + timestamp so Part B
(the delete) can be gated on the snapshot being complete.

Read-only against Supabase. Uses the service_role key from the preflight-analyze config.
Idempotent: re-running overwrites the archive with a fresh snapshot.
"""

import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timezone

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
ARCHIVE_DIR = os.path.join(os.path.dirname(__file__), "poc-archive")

with open(CONFIG_PATH) as f:
    _cfg = json.load(f)
SUPA_URL = _cfg["supabase_url"].rstrip("/")
SUPA_KEY = _cfg["supabase_service_key"]


def get(path):
    """GET {SUPA_URL}/rest/v1/{path} -> parsed JSON (list)."""
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{path}",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def write_json(name, data):
    path = os.path.join(ARCHIVE_DIR, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return len(data) if isinstance(data, list) else 1


def main():
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    manifest = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": SUPA_URL,
        "course": "phys-215",
        "files": {},
    }

    # --- Interactions (all rows; artifact URLs + metadata) ---
    interactions = get("interactions?select=*")
    manifest["files"]["interactions.json"] = write_json("interactions.json", interactions)

    # --- Interaction reports, one file per interaction (the POC test data) ---
    for it in interactions:
        iid = it["id"]
        rows = get(f"preflight_interaction_reports?select=*&interaction_id=eq.{urllib.parse.quote(iid)}")
        fname = f"reports_{iid}.json"
        manifest["files"][fname] = write_json(fname, rows)

    # --- Fake roster (so reports stay interpretable) ---
    students = get("students?select=*")
    manifest["files"]["students.json"] = write_json("students.json", students)
    sections = get("sections?select=*")
    manifest["files"]["sections.json"] = write_json("sections.json", sections)

    # --- Written-preflight test data (full restorable backup) ---
    assignments = get("assignments?select=*")
    manifest["files"]["assignments.json"] = write_json("assignments.json", assignments)
    responses = get("responses?select=*")
    manifest["files"]["responses.json"] = write_json("responses.json", responses)
    scores = get("scores?select=*")
    manifest["files"]["scores.json"] = write_json("scores.json", scores)
    extensions = get("extensions?select=*")
    manifest["files"]["extensions.json"] = write_json("extensions.json", extensions)

    # --- Manifest ---
    with open(os.path.join(ARCHIVE_DIR, "MANIFEST.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print("POC snapshot written to", ARCHIVE_DIR)
    for name, count in manifest["files"].items():
        print(f"  {count:5d}  {name}")


if __name__ == "__main__":
    main()
