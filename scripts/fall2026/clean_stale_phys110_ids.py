#!/usr/bin/env python3
"""
One-time cleanup: remove the stale bare-id phys-110 preflight rows left behind by the
2026-07-20 assignment-id-collision remediation.

Background: phys-110 assignments were briefly created under bare `preflight-NN` ids, which
collided with (and overwrote) phys-215's ids. The fix re-namespaces phys-110 to
`phys-110-preflight-NN` and restores phys-215 to `preflight-NN`. Re-running the 215 builder
reclaims 34 of the collided ids, but three ids that phys-215 does NOT define — `preflight-12`,
`preflight-23`, `preflight-35` (phys-110 lessons that are 215 GRs) — remain as orphaned
phys-110 rows under the 215 namespace. Once phys-110 is repopulated under prefixed ids these
become duplicate Lesson 12/23/35 entries, so they are deleted here.

Safety:
  * Deletes ONLY rows matching these exact ids AND course_id='phys-110' (never a phys-215 row).
  * Refuses to run if any of the target ids is not phys-110, or if any response/score/lesson/
    extension references them (there should be none).
  * Dry-run by default; snapshots the rows to JSON before deleting; requires --commit to write.

Usage:
    python3 clean_stale_phys110_ids.py            # dry run: print plan + write snapshot
    python3 clean_stale_phys110_ids.py --commit    # delete the 3 stale rows
"""

import argparse
import json
import os
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
STALE_IDS = ["preflight-12", "preflight-23", "preflight-35"]
SNAPSHOT = os.path.join(os.path.dirname(__file__), "stale_phys110_ids_snapshot.json")

with open(CONFIG_PATH) as f:
    _cfg = json.load(f)
SUPA_URL = _cfg["supabase_url"].rstrip("/")
SUPA_KEY = _cfg["supabase_service_key"]
H = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}
INCLAUSE = "(%s)" % ",".join(STALE_IDS)


def req(path, method="GET", extra=None):
    r = urllib.request.Request(f"{SUPA_URL}/rest/v1/{path}", method=method,
                               headers={**H, **(extra or {})})
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="delete (default: dry run)")
    args = ap.parse_args()

    _, rows = req(f"assignments?select=*&id=in.{INCLAUSE}")
    print(f"Found {len(rows)} rows for ids {STALE_IDS}:")
    for r in rows:
        print(f"  {r['id']}  course={r['course_id']}  |  {r['title']}")

    # Guards
    non110 = [r["id"] for r in rows if r["course_id"] != "phys-110"]
    if non110:
        print(f"\nABORT: these ids are not phys-110 (would touch another course): {non110}")
        return
    refs = {t: req(f"{t}?select={col}&{col}=in.{INCLAUSE}")[1]
            for t, col in [("responses", "assignment_id"), ("scores", "assignment_id"),
                           ("lessons", "preflight_id"), ("extensions", "assignment_id")]}
    ref_counts = {t: len(v or []) for t, v in refs.items()}
    print(f"References: {ref_counts}")
    if any(ref_counts.values()):
        print("\nABORT: one or more rows are still referenced; not deleting.")
        return

    json.dump(rows, open(SNAPSHOT, "w"), indent=2)
    print(f"Snapshot written -> {SNAPSHOT}")

    if not args.commit:
        print("\n[dry run] nothing deleted. Re-run with --commit to delete.")
        return

    status, deleted = req(f"assignments?id=in.{INCLAUSE}&course_id=eq.phys-110",
                          method="DELETE", extra={"Prefer": "return=representation"})
    print(f"\nDELETE -> HTTP {status}; removed: {[d['id'] for d in (deleted or [])]}")
    _, left = req(f"assignments?select=id&id=in.{INCLAUSE}")
    print(f"Remaining rows with those ids: {[r['id'] for r in left]}")


if __name__ == "__main__":
    main()
