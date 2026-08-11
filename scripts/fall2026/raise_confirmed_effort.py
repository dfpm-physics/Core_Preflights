#!/usr/bin/env python3
"""Raise a low `diagnostic.effort` to 3 on grades an instructor already published at full credit.

WHY THIS EXISTS
    `confirmEffortRows()` in `site/js/faculty-grade.js` does this at the moment of finalizing:
    publishing full credit on every question that carries points asserts the work was worth full
    marks, so an effort the AI put below 3 is raised to 3 and the "Reflection capped" flag clears.

    THIS SCRIPT IS FOR THE ROWS THAT WERE ALREADY PUBLISHED — the ones finalized before the rule
    covered them, which would otherwise keep the old effort until somebody happened to reopen and
    re-publish the column. Two populations:

      * effort 1-2, finalized before the rule shipped (2026-08-09);
      * effort 0, finalized before the floor moved from 1 to 0 (2026-08-10). This is the one that
        prompted the script. `/preflight-analyze` writes `effort: 0` with `no_submission: true`
        for every cadet it found no work from, so a zero also means "nothing reached us" — and on
        2026-08-10 submissions were genuinely lost. Instructors awarded the two points back; the
        effort stayed at 0, leaving those cadets in the low-effort band on the strength of work the
        site had already conceded it lost.

WHO GETS RAISED  (all five, or the row is left alone)
    1. `is_finalized` — the published act, not a draft. A draft is raised by the UI when it is
       eventually published, so touching one here would only race the instructor.
    2. `diagnostic` is an object carrying an integer `effort` of 0, 1 or 2. 3+ is already at or
       above the band; null/non-integer is not an effort this rule understands.
    3. FULL CREDIT on every question that carries points, read from the row's own
       `question_scores`: every entry with `max > 0` has `status != 'zero'` and `score == max`.
       This is the same predicate as confirmEffortRows(), expressed against stored data rather
       than the offering's question list, so the two cannot drift on a re-authored assignment.
    4. no `effort_override` already recorded — that is what makes this idempotent, and it is also
       how a human's earlier decision is left alone.
    5. `grades.effort IS NULL` — i.e. this is a written row. An interactive row's effort is the
       grade (the migration-019 trigger derives points from it), so raising it there would move
       points, which this script must never do. Written rows score from `question_scores` and
       `diagnostic.effort` is pure diagnostics.

WHAT IT DOES NOT CHANGE
    Points, feedback, status, finalization, `grades.effort`, `overall_understanding`, the
    `reading_reflection.meaningful` judgement, or `flags.needs_follow_up`. Full credit on a
    preflight is a statement about engagement — yellow is full credit precisely because the answer
    can be wrong — so it settles effort and nothing else. The AI's original reading survives in
    `reading_reflection` and in `effort_override.from`, exactly as it does on the UI path.

    Cohort numbers move only where the student has a submission row: `/lesson-aggregate` and the
    rollup iterate submissions, so a true non-submitter stays absent from the effort distribution
    however their diagnostic reads.

SAFETY
    Read-only unless `--commit` (CORE.md §4). Idempotent by guard 4. Nothing is deleted and no
    points move, so there is no snapshot gate — but the Report tab's flags and effort histogram do
    change for the affected students.

Usage:
  python scripts/fall2026/raise_confirmed_effort.py
  python scripts/fall2026/raise_confirmed_effort.py --course phys-215 --slug preflight-02
  python scripts/fall2026/raise_confirmed_effort.py --from-effort 0 --commit
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
TARGET_EFFORT = 3
RULE = "finalized-full-credit"

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
    2026-08-10), and `app.enrollments` already holds more than that — so page every read rather
    than trusting a single call to have returned everything."""
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


def patch(path, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{path}", data=body, headers=WRITE_HEADERS, method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as exc:  # surface PostgREST's message, not a bare 400
        sys.exit(f"Write failed ({exc.code}): {exc.read().decode(errors='replace')[:2000]}")


def in_list(values):
    return "in.(" + ",".join(urllib.parse.quote(str(v)) for v in values) + ")"


def is_full_credit(question_scores):
    """Full credit on every question that carries points — confirmEffortRows()'s predicate.

    Read off the row's own `question_scores`, where `max` is the question's `points` as copied at
    grading time (faculty-grade.js). A zero-point question (Q1, the reading-time reflection) is
    filtered out for the same reason the grading UI hides it: it deducts nothing, so it cannot
    withhold full credit. A row with no scored questions at all is NOT full credit — there is no
    assertion to read.
    """
    if not isinstance(question_scores, dict):
        return False
    graded = [v for v in question_scores.values()
              if isinstance(v, dict) and (v.get("max") or 0) > 0]
    if not graded:
        return False
    return all(v.get("status") != "zero" and v.get("score") == v.get("max") for v in graded)


def candidates(rows, wanted_efforts):
    """Split every fetched row into (to raise, skipped-with-reason). Pure — unit-testable."""
    raise_, skipped = [], []
    for r in rows:
        d = r.get("diagnostic")
        if not isinstance(d, dict):
            skipped.append((r, "no diagnostic"))
        elif r.get("effort") is not None:
            skipped.append((r, "interactive row - effort IS the grade"))
        elif d.get("effort_override"):
            skipped.append((r, "already raised"))
        elif not (isinstance(d.get("effort"), int) and d["effort"] in wanted_efforts):
            skipped.append((r, f"effort {d.get('effort')!r} out of scope"))
        elif not is_full_credit(r.get("question_scores")):
            skipped.append((r, "not full credit"))
        else:
            raise_.append(r)
    return raise_, skipped


def new_diagnostic(row, now):
    d = row["diagnostic"]
    return {
        **d,
        "effort": TARGET_EFFORT,
        "effort_override": {
            "from": d["effort"],
            "to": TARGET_EFFORT,
            # The instructor who published the full credit IS who confirmed it; this script only
            # applies the consequence their act should already have had.
            "by": row.get("graded_by"),
            "at": now,
            "rule": RULE,
            # …but it was applied afterwards, not at the click, and that is worth being able to
            # tell apart on the record.
            "applied_by": "raise_confirmed_effort.py",
        },
    }


def label(row, offerings, assignments, sections, students):
    off = offerings.get(row["assignment_offering_id"], {})
    slug = assignments.get(off.get("assignment_id"), "?")
    enr = row.get("_enrollment") or {}
    return (f"{slug:<14} {students.get(enr.get('student_id'), '?'):<28} "
            f"{sections.get(enr.get('section_id'), '?'):<5}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", help="course code, e.g. phys-215 (default: every course)")
    ap.add_argument("--slug", help="assignment slug, e.g. preflight-02 (default: every one)")
    ap.add_argument("--from-effort", type=int, choices=[0, 1, 2], action="append",
                    help="only raise from this effort; repeatable (default: 0, 1 and 2)")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = ap.parse_args()
    wanted = set(args.from_effort or [0, 1, 2])

    load_config()

    # ── Scope: which offerings are in play.
    offerings = {o["id"]: o for o in get("assignment_offerings",
                                         {"select": "id,assignment_id,course_offering_id"})}
    assignments = {a["id"]: a.get("slug") for a in get("assignments", {"select": "id,slug"})}
    if args.course:
        cos = {c["id"] for c in get("course_offerings", {"select": "id,course_id"})
               if c.get("course_id") == args.course}
        if not cos:
            sys.exit(f"No course offering for course {args.course!r}.")
        offerings = {k: v for k, v in offerings.items() if v.get("course_offering_id") in cos}
    if args.slug:
        offerings = {k: v for k, v in offerings.items()
                     if assignments.get(v.get("assignment_id")) == args.slug}
    if not offerings:
        sys.exit("No assignment offerings matched that scope.")

    # ── The rows. Filtered server-side on what PostgREST can express; the rest in candidates().
    rows = get("grades", {
        "select": "id,enrollment_id,assignment_offering_id,effort,points_earned,points_possible,"
                  "question_scores,diagnostic,source,graded_by,graded_at",
        "is_finalized": "eq.true",
        "assignment_offering_id": in_list(offerings),
    })
    to_raise, skipped = candidates(rows, wanted)

    # ── Names, for a plan a human can check rather than a list of uuids.
    enr_by_id = {}
    if to_raise:
        enr_by_id = {e["id"]: e for e in get(
            "enrollments", {"select": "id,student_id,section_id,status",
                            "id": in_list([r["enrollment_id"] for r in to_raise])})}
    for r in to_raise:
        r["_enrollment"] = enr_by_id.get(r["enrollment_id"], {})
    sections = {s["id"]: s.get("code") for s in get("sections", {"select": "id,code"})}
    students = {}
    sids = [e.get("student_id") for e in enr_by_id.values() if e.get("student_id")]
    if sids:
        for s in get("students", {"select": "*", "student_id": in_list(sids)}):
            students[s["student_id"]] = (s.get("name")
                                         or " ".join(filter(None, [s.get("first_name"),
                                                                   s.get("last_name")]))
                                         or str(s["student_id"]))

    # ── Report.
    print(f"Scanned {len(rows)} finalized grade rows across {len(offerings)} offering(s).")
    reasons = {}
    for _, why in skipped:
        reasons[why] = reasons.get(why, 0) + 1
    for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  skipped {n:>4}  {why}")
    print(f"\n{len(to_raise)} row(s) to raise to effort {TARGET_EFFORT}"
          f" (from {sorted(wanted)}):\n")
    for r in sorted(to_raise, key=lambda r: (r["diagnostic"]["effort"], r.get("graded_at") or "")):
        d = r["diagnostic"]
        flags = []
        if d.get("no_submission"):
            flags.append("no_submission")
        if (d.get("reading_reflection") or {}).get("meaningful") is False:
            flags.append("reflection-capped")
        print(f"  {label(r, offerings, assignments, sections, students)} "
              f"effort {d['effort']} -> {TARGET_EFFORT}  "
              f"{r['points_earned']}/{r['points_possible']}  {r.get('source')}  "
              f"{(r.get('graded_at') or '')[:19]}  {','.join(flags)}")

    if not to_raise:
        print("Nothing to do.")
        return 0
    if not args.commit:
        print("\nDRY RUN - nothing written. Re-run with --commit to apply.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    written = 0
    for r in to_raise:
        patch(f"grades?id=eq.{urllib.parse.quote(r['id'])}",
              {"diagnostic": new_diagnostic(r, now)})
        written += 1
    print(f"\nWrote {written} row(s).")

    # ── Read back and verify, rather than trusting the write (CORE.md §5).
    back = get("grades", {"select": "id,effort,diagnostic",
                          "id": in_list([r["id"] for r in to_raise])})
    bad = [b["id"] for b in back
           if (b.get("diagnostic") or {}).get("effort") != TARGET_EFFORT
           or not (b.get("diagnostic") or {}).get("effort_override")]
    if bad:
        print(f"VERIFY FAILED on {len(bad)} row(s): {bad}")
        return 1
    print(f"Verified {len(back)} row(s) read back at effort {TARGET_EFFORT}"
          " with an override recorded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
