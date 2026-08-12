#!/usr/bin/env python3
"""Re-open a published grade that is blocking an extension the student still has time to use.

WHY THIS EXISTS
    A finalized grade outranks the deadline on every student surface. `resolveState()` in
    `site/js/student-lessons.js` reads `is_finalized` before anything else, and
    `site/student/assignments.html` branches on that state before it ever consults `isPast` — so
    the read-only lock an extension exists to lift sits in a branch a graded student never
    reaches. Granting an extension to a cadet whose grade was already published moved a date
    nothing looked at: the chip rendered, the director's extensions report counted it, and the
    cadet stayed locked out with nothing reporting the disagreement.

    `setExtension()` now performs the re-open itself (`reopenForExtension()`, 2026-08-12). THIS
    SCRIPT IS FOR THE ROWS THAT WERE ALREADY IN THAT STATE when the rule shipped — the same
    relationship `raise_confirmed_effort.py` has to `confirmEffortRows()`. It applies the
    identical predicate, expressed against stored rows rather than against the two the UI has in
    hand, so the backfill and the live path cannot decide different things.

WHO GETS RE-OPENED  (all four, or the row is left alone)
    1. A live extension — `revoked_at IS NULL`. A withdrawn extension grants no time.
    2. `extended_due_at` is in the FUTURE. This is the guard that matters most, and it is not
       bookkeeping: `effectiveDue()` honours the extension, so once the extended deadline has
       passed the student is locked by the deadline whatever the grade says. Re-opening an
       expired extension therefore cannot let anybody work — it only withdraws their score from
       their view, because `grades_own_finalized` stops returning an unfinalized row. It is
       strictly worse than doing nothing, so it is refused. A cadet who needs more time than the
       extension gave them needs a NEW extension, which is a human's decision.
    3. `is_finalized` — the published act. A suggested grade is already invisible to the student
       and is not blocking anything, so there is nothing to take back down.
    4. NOTHING COMMITTED — no submission row, or one still in `draft`. A committed submission
       means the work is already in and the extension is almost always clearing a late flag
       retroactively; retracting a correct published grade over a bookkeeping fix is a surprise
       the cadet meets before the grader does. Reopen remains available in the UI for the case
       where an instructor genuinely does want a redo.

WHAT IT DOES NOT CHANGE
    Points, feedback, `question_scores`, `status`, `diagnostic`, `effort`, `source`, the
    extension itself, or the submission. It moves `is_finalized` true -> false and writes one
    `grade_events` row. Every score it hides is recoverable by finalizing again in the Grade tab,
    with the numbers untouched — this un-publishes, it does not erase.

    The cadet's view changes: the assignment leaves the graded state and becomes workable until
    their extended deadline. That is the entire point.

SAFETY
    Read-only unless `--commit` (CORE.md §4). Idempotent — a re-opened grade no longer satisfies
    guard 3, so a second run is a no-op. Nothing is deleted and no points move, so there is no
    snapshot gate; but a published score does leave a student's view, so the dry run prints every
    affected cadet by name and every near-miss with the guard that excluded it. Read it.

    `actor` is written NULL. It is an FK to `instructors` and a script is not an instructor;
    `detail.actor_note` records what did it rather than attributing the act to a person who did
    not perform it.

Usage:
  python scripts/fall2026/reopen_extended_grades.py                      # dry run, all courses
  python scripts/fall2026/reopen_extended_grades.py --course phys-215
  python scripts/fall2026/reopen_extended_grades.py --commit
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
CAUSE = "extension-backfill"

SUPA_URL = SUPA_KEY = None
READ_HEADERS = WRITE_HEADERS = {}


def load_config():
    """Read credentials at CALL time, not import time — see zero_non_submitters.py."""
    global SUPA_URL, SUPA_KEY, READ_HEADERS, WRITE_HEADERS
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        SUPA_URL = cfg["supabase_url"].rstrip("/")
        SUPA_KEY = cfg["supabase_service_key"]
    except (OSError, KeyError) as exc:
        sys.exit(
            f"Could not read Supabase credentials from {CONFIG_PATH}: {exc}\n"
            "Run /setup-preflight, or copy .ai/skills/preflight-analyze/config.json.template."
        )
    READ_HEADERS = {
        "apikey": SUPA_KEY,
        "Authorization": f"Bearer {SUPA_KEY}",
        "Accept-Profile": "app",
    }
    WRITE_HEADERS = {
        **READ_HEADERS,
        "Content-Type": "application/json",
        "Content-Profile": "app",
        "Prefer": "return=representation",
    }


def get(path, params):
    """Paged read. PostgREST caps a response at 1000 rows whatever `limit` says (CHANGELOG
    2026-08-10), and `app.enrollments` already holds more than that."""
    out, offset, page = [], 0, 1000
    while True:
        query = urllib.parse.urlencode({**params, "limit": str(page), "offset": str(offset)})
        req = urllib.request.Request(
            f"{SUPA_URL}/rest/v1/{path}?{query}",
            headers={**READ_HEADERS, "Prefer": "count=exact"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                rows = json.load(r)
                total = int((r.headers.get("Content-Range") or "/0").split("/")[-1] or 0)
        except urllib.error.HTTPError as exc:
            sys.exit(f"Read failed ({exc.code}): {exc.read().decode(errors='replace')[:2000]}")
        out += rows
        offset += page
        if not rows or len(out) >= total:
            return out


def send(path, payload, method):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{path}", data=body, headers=WRITE_HEADERS, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} failed ({exc.code}): {exc.read().decode(errors='replace')[:2000]}")


def in_list(values):
    """PostgREST `in.(…)` — uuids and text quoted, ints bare."""
    parts = [str(v) if isinstance(v, int) else f'"{v}"' for v in values]
    return "(" + ",".join(parts) + ")"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--course", help="course code, e.g. phys-215. Default: every course.")
    ap.add_argument("--commit", action="store_true", help="write. Without it, nothing changes.")
    args = ap.parse_args()
    load_config()

    now = datetime.now(timezone.utc)
    print(f"now = {now.isoformat(timespec='seconds')}\n")

    exts = get("extensions", {"select": "id,enrollment_id,assignment_offering_id,"
                                        "extended_due_at,reason,revoked_at"})
    live = [e for e in exts if not e["revoked_at"]]
    print(f"extensions: {len(exts)} total, {len(exts) - len(live)} revoked, {len(live)} live")
    if not live:
        return

    enr_ids = sorted({e["enrollment_id"] for e in live})
    off_ids = sorted({e["assignment_offering_id"] for e in live})

    courses = {c["id"]: c["code"] for c in get("courses", {"select": "id,code"})}
    co_course = {c["id"]: courses.get(c["course_id"])
                 for c in get("course_offerings", {"select": "id,course_id"})}
    sections = {s["id"]: (s["code"], co_course.get(s["course_offering_id"]))
                for s in get("sections", {"select": "id,code,course_offering_id"})}
    enrolls = {e["id"]: e for e in get("enrollments",
               {"select": "id,student_id,section_id,status", "id": f"in.{in_list(enr_ids)}"})}
    names = {s["student_id"]: s["name"] for s in get("students",
             {"select": "student_id,name",
              "student_id": f"in.{in_list(sorted({e['student_id'] for e in enrolls.values()}))}"})}
    offerings = {o["id"]: o for o in get("assignment_offerings",
                 {"select": "id,assignment_id", "id": f"in.{in_list(off_ids)}"})}
    slugs = {a["id"]: a["slug"] for a in get("assignments",
             {"select": "id,slug",
              "id": f"in.{in_list(sorted({o['assignment_id'] for o in offerings.values()}))}"})}

    grades = {(g["enrollment_id"], g["assignment_offering_id"]): g
              for g in get("grades", {"select": "id,enrollment_id,assignment_offering_id,"
                                                "is_finalized,points_earned,points_possible",
                                      "enrollment_id": f"in.{in_list(enr_ids)}",
                                      "assignment_offering_id": f"in.{in_list(off_ids)}"})}
    submits = {(s["enrollment_id"], s["assignment_offering_id"]): s
               for s in get("submissions", {"select": "enrollment_id,assignment_offering_id,status",
                                            "enrollment_id": f"in.{in_list(enr_ids)}",
                                            "assignment_offering_id": f"in.{in_list(off_ids)}"})}

    targets, skipped = [], []
    for e in live:
        key = (e["enrollment_id"], e["assignment_offering_id"])
        en = enrolls.get(e["enrollment_id"]) or {}
        sec_code, course = sections.get(en.get("section_id"), ("?", None))
        grade, sub = grades.get(key), submits.get(key)
        row = {
            "extension_id": e["id"], "grade_id": grade["id"] if grade else None,
            "course": course, "section": sec_code,
            "student_id": en.get("student_id"), "name": names.get(en.get("student_id"), "?"),
            "slug": slugs.get((offerings.get(e["assignment_offering_id"]) or {}).get("assignment_id")),
            "extended_due_at": e["extended_due_at"], "reason": e.get("reason") or "",
            "points": f'{grade["points_earned"]}/{grade["points_possible"]}' if grade else None,
            "submission": sub["status"] if sub else "(none)",
        }
        if args.course and course != args.course:
            continue

        # The four guards, in the order the docstring states them.
        if datetime.fromisoformat(e["extended_due_at"]) <= now:
            row["why_not"] = "extension already expired — re-opening cannot unlock them"
        elif grade is None:
            row["why_not"] = "no grade row — nothing is blocking them"
        elif not grade["is_finalized"]:
            row["why_not"] = "grade not published — already invisible to the student"
        elif sub and sub["status"] == "committed":
            row["why_not"] = "work already committed — leaving the published grade alone"
        else:
            targets.append(row)
            continue
        skipped.append(row)

    scope = args.course or "all courses"
    print(f"scope: {scope}   -> {len(targets)} to re-open, {len(skipped)} left alone\n")

    if targets:
        print("=== WILL RE-OPEN " + "=" * 60)
        for r in sorted(targets, key=lambda r: (r["course"], r["slug"], r["section"], r["name"])):
            print(f'  {r["course"]:9} {r["slug"]:14} {r["section"]:4} {r["name"]:30} {r["student_id"]}')
            print(f'      published {r["points"]}, submission {r["submission"]}, '
                  f'extended to {r["extended_due_at"]}')
            print(f'      reason: {r["reason"]}')

    if skipped:
        print("\n=== LEFT ALONE " + "=" * 62)
        for r in sorted(skipped, key=lambda r: (r["why_not"], r["name"])):
            print(f'  {r["course"] or "?":9} {r["slug"] or "?":14} {r["section"]:4} '
                  f'{r["name"]:30} {r["why_not"]}')

    if not targets:
        print("\nNothing to do.")
        return
    if not args.commit:
        print(f"\nDRY RUN — nothing written. Re-run with --commit to re-open {len(targets)} grade(s).")
        return

    print(f"\n=== COMMITTING {len(targets)} re-open(s) " + "=" * 44)
    for r in targets:
        got = send(f'grades?id=eq.{r["grade_id"]}', {"is_finalized": False}, "PATCH")
        if not got or got[0]["is_finalized"] is not False:
            sys.exit(f'  !! {r["name"]}: grade {r["grade_id"]} did not come back unfinalized — stopping.')
        # `cause` is the point of logging this separately: a month later, a bare 'reopened' with
        # an empty detail is indistinguishable from an instructor deciding to regrade.
        send("grade_events", {
            "grade_id": r["grade_id"], "event": "reopened", "actor": None,
            "detail": {"cause": CAUSE, "extended_due_at": r["extended_due_at"],
                       "reason": r["reason"], "actor_note": "scripts/fall2026/reopen_extended_grades.py"},
        }, "POST")
        print(f'  re-opened {r["course"]} {r["slug"]} {r["section"]} {r["name"]} ({r["student_id"]})')

    # Read back from the database rather than trusting the PATCH responses above.
    check = get("grades", {"select": "id,is_finalized",
                           "id": f'in.{in_list([r["grade_id"] for r in targets])}'})
    still = [g["id"] for g in check if g["is_finalized"]]
    print(f"\nread-back: {len(check)} grade(s) fetched, "
          f"{len(check) - len(still)} unfinalized, {len(still)} still finalized")
    if still:
        sys.exit(f"  !! still finalized: {still}")
    print("Done. Each cadet can now work until their extended deadline; finalize again in the "
          "Grade tab when their work is in.")


if __name__ == "__main__":
    main()
