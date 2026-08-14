#!/usr/bin/env python3
"""Find cadet work stranded on an enrollment nobody looks at — READ-ONLY.

WHAT IT LOOKS FOR
    A submission whose `enrollments.status` is not `active`. That state is invisible from every
    direction at once, which is what makes it worth a dedicated check:

      * no analysis run sees it   — /preflight-analyze Step 4c fetches `status=eq.active`
      * no instructor sees it     — every faculty loader filters the same way
      * the cadet does not see it — auth.js:248 builds ctx.enrollments active-only
      * and if they hold a second, active enrollment, grading writes a NON-SUBMISSION ZERO
        against it, correctly by its own rules, because that row genuinely has no work on it

    An instructor finalizes the zero and the cadet is permanently scored 0 for work they completed
    and submitted on time. Nothing reports a problem. It happened on 2026-08-13, to one cadet in
    phys-110 preflight-03, and surfaced only because a human read a report and asked.

    Full diagnosis, the RLS hole underneath it, and the fixes:
    docs/findings/2026-08-13-orphaned-submission-on-dropped-enrollment.md

WHY THIS QUERY AND NOT THE FINDING'S
    The finding's §5 query joins each stranded submission to a surviving active enrollment in the
    same course offering, and names its own two blind spots: a hard-deleted old row leaves nothing
    to join, and a move between COURSES is invisible to it. This script asks the wider question
    instead — "is any submission sitting on a non-active enrollment?" — and classifies afterwards.
    Strictly wider, one fewer join, and it still separates the dangerous case from the inert one.

WHAT IT DOES NOT CATCH, SO NOBODY READS A ZERO AS AN ALL-CLEAR
    Work stranded by an enrollment row that was HARD-DELETED. The submission's FK would have gone
    with it, so there is nothing left to find. Preventing that is the RLS fix's job, not this one.

EXIT CODES
    0  clean
    1  at least one stranded submission on a survivable enrollment — a human must act
    2  could not run (credentials, network)

Usage:
  python scripts/checks/orphaned_submissions.py
  python scripts/checks/orphaned_submissions.py --course phys-110
  python scripts/checks/orphaned_submissions.py --json      # for the lesson-cycle gate

PRIVACY: this prints cadet names to the CONSOLE so an operator can act on them. Console output is
not a committed file, and it must not become one. Nothing under docs/ may name an affected cadet
(CORE.md §3, and docs/findings/README.md) — everything under docs/ is publicly served.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
PAGE = 1000

SUPA_URL = None
READ_HEADERS = {}


def load_config():
    global SUPA_URL, READ_HEADERS
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        SUPA_URL = cfg["supabase_url"].rstrip("/")
        key = cfg["supabase_service_key"]
    except (OSError, KeyError, ValueError) as exc:
        print(f"Could not read Supabase credentials from {CONFIG_PATH}: {exc}\n"
              "Run /setup-preflight, or copy "
              ".ai/skills/preflight-analyze/config.json.template.", file=sys.stderr)
        sys.exit(2)
    # Without Accept-Profile every query resolves against the default profile and 404s with
    # PGRST205 before reaching schema `app`. Not optional.
    READ_HEADERS = {"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "app"}


def get(path):
    """GET, PAGED. PostgREST caps a response at 1000 rows whatever `limit` says.

    `app.enrollments` is already over the cap (1001 rows on 2026-08-10), and a single unpaged read
    of it has already produced a wrong answer here: it dropped exactly one row, and that row was
    the one the question was about (CHANGELOG 2026-08-10). A truncated page in a check that
    searches for a rare condition reports "clean" — the worst possible way to be wrong.
    """
    rows, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        url = f"{SUPA_URL}/rest/v1/{path}{sep}limit={PAGE}&offset={offset}"
        req = urllib.request.Request(url, headers=READ_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                page = json.load(r)
        except urllib.error.HTTPError as exc:
            print(f"Query failed ({exc.code}) on {path}:\n"
                  f"{exc.read().decode(errors='replace')[:800]}", file=sys.stderr)
            sys.exit(2)
        except urllib.error.URLError as exc:
            print(f"Could not reach Supabase: {exc}", file=sys.stderr)
            sys.exit(2)
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", help="restrict to one course code, e.g. phys-110")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable summary on stdout (counts only, no names)")
    args = ap.parse_args()

    load_config()

    enrollments = get("enrollments?select=id,student_id,section_id,status")
    sections = get("sections?select=id,code,course_offering_id")
    offerings = get("course_offerings?select=id,courses(code),terms(code)")
    assignment_offerings = get(
        "assignment_offerings?select=id,course_offering_id,assignments(slug)")
    students = get("students?select=student_id,name")

    course_of_co = {o["id"]: ((o.get("courses") or {}).get("code") or "?") for o in offerings}
    term_of_co = {o["id"]: ((o.get("terms") or {}).get("code") or "?") for o in offerings}
    section_row = {s["id"]: s for s in sections}
    ao_row = {a["id"]: a for a in assignment_offerings}
    name_of = {s["student_id"]: s.get("name") or str(s["student_id"]) for s in students}
    enr_row = {e["id"]: e for e in enrollments}

    def course_of_enrollment(enr):
        sec = section_row.get((enr or {}).get("section_id"))
        return course_of_co.get((sec or {}).get("course_offering_id"))

    # Every non-active enrollment, and the students who hold one.
    stranded_enr = {e["id"]: e for e in enrollments if e.get("status") != "active"}
    if args.course:
        stranded_enr = {k: v for k, v in stranded_enr.items()
                        if course_of_enrollment(v) == args.course}

    findings = []
    if stranded_enr:
        subs = []
        ids = sorted(stranded_enr)
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            in_list = "in.(" + ",".join(urllib.parse.quote(str(v)) for v in chunk) + ")"
            subs += get("submissions?select=id,enrollment_id,assignment_offering_id,status,"
                        f"committed_at&enrollment_id={in_list}")

        # Only now is a grade lookup worth doing, and only for the survivors that matter.
        active_by_student_co = {}
        for e in enrollments:
            if e.get("status") != "active":
                continue
            sec = section_row.get(e.get("section_id"))
            if sec:
                active_by_student_co.setdefault(
                    (e["student_id"], sec["course_offering_id"]), []).append(e["id"])

        survivor_ids = set()
        for s in subs:
            src = stranded_enr[s["enrollment_id"]]
            ao = ao_row.get(s["assignment_offering_id"]) or {}
            for eid in active_by_student_co.get((src["student_id"], ao.get("course_offering_id")),
                                                []):
                survivor_ids.add(eid)

        grades = []
        gids = sorted(survivor_ids)
        for i in range(0, len(gids), 100):
            chunk = gids[i:i + 100]
            in_list = "in.(" + ",".join(urllib.parse.quote(str(v)) for v in chunk) + ")"
            grades += get("grades?select=enrollment_id,assignment_offering_id,points_earned,"
                          f"is_finalized,diagnostic&enrollment_id={in_list}")
        grade_by = {(g["enrollment_id"], g["assignment_offering_id"]): g for g in grades}

        for s in subs:
            src = stranded_enr[s["enrollment_id"]]
            ao = ao_row.get(s["assignment_offering_id"]) or {}
            co_id = ao.get("course_offering_id")
            survivors = active_by_student_co.get((src["student_id"], co_id), [])
            sec = section_row.get(src.get("section_id")) or {}

            grade, survivor_enr = None, None
            for eid in survivors:
                g = grade_by.get((eid, s["assignment_offering_id"]))
                if g:
                    grade, survivor_enr = g, eid
                    break
            if survivor_enr is None and survivors:
                survivor_enr = survivors[0]

            # Severity is about what the stranding COSTS, not about how it arose.
            if not survivors:
                # They hold no active enrollment in this course at all -- they left. The work is
                # stranded but no zero is being written against them, so nothing is being scored
                # wrongly. Reported, not failed on.
                severity = "inert"
            elif grade and (grade.get("diagnostic") or {}).get("no_submission"):
                # The exact 2026-08-13 defect: work here, a non-submission zero there.
                severity = "ZEROED" if grade.get("is_finalized") else "zeroed-unfinalized"
            elif grade:
                severity = "graded-elsewhere"
            else:
                # No grade yet on the survivor. The next past-deadline run would have zeroed it
                # before condition 6 existed; now it will refuse and flag. Still needs repointing.
                severity = "will-be-zeroed"

            findings.append({
                "severity": severity,
                "course": course_of_co.get(co_id, "?"),
                "term": term_of_co.get(co_id, "?"),
                "assignment": (ao.get("assignments") or {}).get("slug", "?"),
                "submission_status": s.get("status"),
                "stranded_enrollment_status": src.get("status"),
                "stranded_section": sec.get("code", "?"),
                "survivor_section": (section_row.get(
                    (enr_row.get(survivor_enr) or {}).get("section_id")) or {}).get("code"),
                "student_name": name_of.get(src["student_id"], "?"),
                "grade_is_finalized": bool((grade or {}).get("is_finalized")),
            })

    # The precursor state, reported as a warning rather than a failure: it is what the roster
    # importer used to create in bulk before sectionMoves() shipped (CHANGELOG 2026-08-10), and it
    # is the state a partial unique index would forbid.
    dupes = {}
    for e in enrollments:
        if e.get("status") != "active":
            continue
        sec = section_row.get(e.get("section_id"))
        if not sec:
            continue
        co_id = sec["course_offering_id"]
        if args.course and course_of_co.get(co_id) != args.course:
            continue
        dupes.setdefault((e["student_id"], co_id), []).append(e["id"])
    doubled = {k: v for k, v in dupes.items() if len(v) > 1}

    blocking = [f for f in findings if f["severity"] != "inert"]

    if args.json:
        print(json.dumps({
            "stranded_total": len(findings),
            "blocking": len(blocking),
            "by_severity": {s: sum(1 for f in findings if f["severity"] == s)
                            for s in sorted({f["severity"] for f in findings})},
            "double_enrolled": len(doubled),
            "ok": not blocking,
        }, indent=2))
        return 1 if blocking else 0

    scope = f" · {args.course}" if args.course else " · all courses"
    print(f"\nOrphaned-submission check{scope}")
    print(f"{len(enrollments)} enrollments · {len(stranded_enr)} non-active · "
          f"{len(findings)} submission(s) stranded on one\n")

    if findings:
        order = ["ZEROED", "zeroed-unfinalized", "will-be-zeroed", "graded-elsewhere", "inert"]
        for sev in order:
            group = [f for f in findings if f["severity"] == sev]
            if not group:
                continue
            print(f"  [{sev}] {len(group)}")
            for f in sorted(group, key=lambda x: (x["course"], x["assignment"], x["student_name"])):
                surv = f["survivor_section"] or "no active enrollment in this course"
                print(f"      {f['course']} {f['assignment']}: {f['student_name']} — "
                      f"{f['submission_status']} submission on their {f['stranded_enrollment_status']} "
                      f"{f['stranded_section']} enrollment; active in {surv}")
            print()
    else:
        print("  No submission sits on a non-active enrollment.\n")

    if doubled:
        print(f"  [warn] {len(doubled)} cadet(s) hold TWO active enrollments in one course "
              f"offering.\n         This is the state that strands work when one is later dropped."
              f"\n         Repair with scripts/fall2026/repair_duplicate_enrollments.py.\n")

    if blocking:
        print(f"FAIL — {len(blocking)} stranded submission(s) belong to a cadet who is still "
              f"enrolled.")
        print("Repoint the submission to the ACTIVE enrollment BEFORE re-running any grading:")
        print("  * read .ai/skills/safe-change/SKILL.md first — this is a data repair")
        print("  * check UNIQUE (enrollment_id, assignment_offering_id) on the target first")
        print("  * re-running /preflight-analyze first only RE-ZEROES them; the wrong order is")
        print("    strictly worse than doing nothing")
        return 1

    print("PASS — no cadet is scored against an enrollment that is missing their work.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
