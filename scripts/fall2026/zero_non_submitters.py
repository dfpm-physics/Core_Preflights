#!/usr/bin/env python3
"""Write a zero grade for every cadet who submitted nothing by their own deadline.

WHY THIS EXISTS
    Until 2026-07-30 `/preflight-analyze` wrote a `grades` row only for students who submitted, and
    merely listed the missing ones in its run report. So a non-submitter had NO GRADE ROW AT ALL —
    which is a different claim from "scored zero", and the wrong one. Their total was already being
    built as though the zero existed (the gradebook counts a past-due non-submission as 0 out of
    full, `faculty-gradebook.js` totalsFor), but no number anywhere said so: the grid showed a dash,
    the cadet's own page showed nothing, and neither could be reconciled against the percentage
    they added up to.

    The course director's rule, 2026-07-30: "Blank at time of submission without an extension
    should result in a 0 for score and a 0 for understanding. Granting an extension should allow
    this to be overwritten when resubmitted."

    The skill now does this on every run. THIS SCRIPT IS FOR THE ROWS THAT ALREADY EXIST — the
    assignments graded before the rule, which would otherwise stay blank until somebody re-ran a
    full analysis over them. Re-running `/preflight-analyze` costs an AI pass over every submission
    to fix students who submitted nothing; this is the cheap half on its own.

WHO GETS A ZERO  (all five, or nothing is written)
    1. active enrollment in the offering
    2. past its OWN effective deadline — extension -> per-section `assignment_due_dates` ->
       offering `due_at`, in that precedence. Computed per student: an M-day and a T-day section
       do not come due together, and zeroing a T-day cadet on Monday would be a lie with a
       number on it.
    3. no ACTIVE extension (`revoked_at IS NULL` and the extended date still in the future).
       The director's exception, and the reason the rule is not simply "no submission by now".
    4. no submitted work — no non-empty written content, AND not committed to the interactive
       activity (those are graded by the migration-015 trigger; never write over that)
    5. no existing grade row that is finalized or instructor-sourced. Same two guards
       `/preflight-analyze` applies: a published decision or a saved instructor draft is a human's
       call, and "they handed in nothing" does not override it.

    A DRAFT WITH REAL CONTENT IS NOT A ZERO. Somebody who wrote answers and never pressed Submit is
    graded on what they wrote (SKILL.md Step 5). They are reported here, and skipped.

WHAT IT DOES NOT CHANGE
    Any cohort number. `/lesson-aggregate` and the rollup read students who have a submission
    carrying work on a graded activity; a non-submitter has no submission row, so they stay absent
    from the effort distribution, the understanding means and the readiness prose. The zero moves
    the gradebook cell, the cadet's total and their per-student page — where it was already being
    counted.

SAFETY
    Read-only unless `--commit` (CORE.md §4). Idempotent: a row it has already written is
    `ai_suggested` and unfinalized, so a second run recognises it as its own and reports it as
    already-zeroed rather than rewriting it. Nothing is deleted, so there is no snapshot gate —
    but note that a zero IS visible to the cadet once an instructor finalizes the column.

Usage:
  python scripts/fall2026/zero_non_submitters.py --course phys-215
  python scripts/fall2026/zero_non_submitters.py --course phys-215 --slug preflight-02
  python scripts/fall2026/zero_non_submitters.py --course phys-215 --day M --commit
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
NO_SUBMISSION_FEEDBACK = "No submission received."

SUPA_URL = SUPA_KEY = None
READ_HEADERS = WRITE_HEADERS = {}


def load_config():
    """Read credentials at CALL time, not import time.

    Module-level would make `--help` — and importing any pure helper below for a test — fail on a
    machine without the config, which is every machine that has not run /setup-preflight. The
    deadline arithmetic is worth being able to exercise without a service key in hand.
    """
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
    READ_HEADERS = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}
    WRITE_HEADERS = {
        **READ_HEADERS,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def get(path):
    req = urllib.request.Request(f"{SUPA_URL}/rest/v1/{path}", headers=READ_HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def upsert(path, rows):
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{path}", data=body, headers=WRITE_HEADERS, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as exc:  # surface PostgREST's message, not a bare 400
        sys.exit(f"Write failed ({exc.code}): {exc.read().decode(errors='replace')[:2000]}")


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def parse_ts(value):
    """PostgREST timestamps -> aware datetime. Naive values are UTC by column definition."""
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def chunked(seq, n=100):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def in_list(values):
    """PostgREST `in.(…)` — uuids and ints only here, so no quoting subtleties."""
    return "in.(" + ",".join(urllib.parse.quote(str(v)) for v in values) + ")"


def effective_due(offering, section_id, extension_iso):
    """extension -> per-section row -> per-day schedule -> offering default.

    Mirrors `effectiveDue()` + `resolveDueBySection()` in site/js/schema.js. The per-day fold
    (migration 017) matters: most sections carry no explicit `assignment_due_dates` row and take
    their own meeting day's deadline, so skipping it would read every one of them as due at the
    offering default and zero the whole term on the wrong date.
    """
    if extension_iso:
        return parse_ts(extension_iso)
    by_section = offering["due_by_section"].get(section_id)
    if by_section:
        return parse_ts(by_section)
    day = offering["section_day"].get(section_id)
    by_day = (offering.get("due_by_day") or {}).get(day) if day else None
    if by_day:
        return parse_ts(by_day)
    return parse_ts(offering.get("due_at"))


def load_offering_context(course_id, slug=None):
    courses = get(f"courses?select=id,code&code=eq.{urllib.parse.quote(course_id)}")
    if not courses:
        sys.exit(f"No course with code {course_id!r}.")
    course_uuid = courses[0]["id"]

    offerings_q = (
        "course_offerings?select=id,term_id,is_active,terms(code,label)"
        f"&course_id=eq.{course_uuid}&is_active=eq.true"
    )
    course_offerings = get(offerings_q)
    if not course_offerings:
        sys.exit(f"No ACTIVE course offering for {course_id}.")
    if len(course_offerings) > 1:
        labels = ", ".join(o.get("terms", {}).get("code", "?") for o in course_offerings)
        sys.exit(f"{course_id} has {len(course_offerings)} active offerings ({labels}) — ambiguous.")
    co = course_offerings[0]

    sections = get(f"sections?select=id,code,meeting_days&course_offering_id=eq.{co['id']}")
    section_day = {}
    for s in sections:
        days = s.get("meeting_days") or []
        section_day[s["id"]] = days[0] if days else (s["code"] or "")[:1]

    aq = (
        "assignment_offerings?select=id,points_possible,grading_mode,due_at,due_by_day,is_published,"
        "assignments!inner(slug,title),assignment_due_dates(section_id,due_at),"
        "offering_activities(activity_id,activities(id,modality,content))"
        f"&course_offering_id=eq.{co['id']}&is_published=eq.true"
    )
    if slug:
        aq += f"&assignments.slug=eq.{urllib.parse.quote(slug)}"
    rows = get(aq)

    offerings = []
    for r in rows:
        acts = r.get("offering_activities") or []
        written = next(
            (a["activities"] for a in acts if (a.get("activities") or {}).get("modality") == "written"),
            None,
        )
        interactive = next(
            (a["activities"] for a in acts if (a.get("activities") or {}).get("modality") == "interactive"),
            None,
        )
        offerings.append(
            {
                "id": r["id"],
                "slug": (r.get("assignments") or {}).get("slug", ""),
                "title": (r.get("assignments") or {}).get("title", ""),
                "points_possible": r.get("points_possible") or 0,
                "due_at": r.get("due_at"),
                "due_by_day": r.get("due_by_day") if isinstance(r.get("due_by_day"), dict) else {},
                "due_by_section": {
                    d["section_id"]: d["due_at"]
                    for d in (r.get("assignment_due_dates") or [])
                    if d.get("section_id")
                },
                "section_day": section_day,
                "written_id": (written or {}).get("id"),
                "interactive_id": (interactive or {}).get("id"),
                "questions": ((written or {}).get("content") or {}).get("questions") or [],
            }
        )

    enrollments = get(
        "enrollments?select=id,student_id,section_id,status,students!inner(name)"
        f"&section_id={in_list([s['id'] for s in sections])}&status=eq.active"
        if sections
        else "enrollments?select=id&id=eq.00000000-0000-0000-0000-000000000000"
    )
    return co, sections, offerings, enrollments


def zero_row(offering, enrollment_id, now):
    """The payload SKILL.md § 'Then: the students who submitted nothing get a zero' specifies."""
    question_scores = {}
    for q in offering["questions"]:
        qid = q.get("id")
        if not qid:
            continue
        max_pts = q.get("points") or 0
        question_scores[qid] = {
            "score": 0,
            "max": max_pts,
            # A zero-point question deducts nothing, so the never-deduct-without-feedback rule does
            # not apply to it — and Q1 is not rendered on a grade card anyway (CORE.md §2).
            "feedback": NO_SUBMISSION_FEEDBACK if max_pts else "",
            "status": "zero",
        }
    return {
        "enrollment_id": enrollment_id,
        "assignment_offering_id": offering["id"],
        "points_earned": 0,
        "points_possible": offering["points_possible"],
        "question_scores": question_scores,
        "diagnostic": {
            "q2_effort": 0,
            "q3_understanding": 0,
            "schema": 1,
            "source": "preflight-analyze",
            # What separates this from a submission of gibberish, which scores identically.
            "no_submission": True,
            "effort": 0,
            "overall_understanding": 0,
            "objectives": [],
            "misconceptions": [],
            "reading_reflection": {"meaningful": False, "engagement": 0},
            "flags": {"needs_follow_up": True, "notable": False},
        },
        # Unfinalized and AI-sourced, which is what lets a later run overwrite it when an extension
        # is granted and the cadet submits. See the module docstring.
        "source": "ai_suggested",
        "is_finalized": False,
        "graded_at": iso(now),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True, help="course code, e.g. phys-215")
    ap.add_argument("--slug", help="one assignment slug; default is every published assignment")
    ap.add_argument("--day", choices=["M", "T"], help="restrict to sections meeting on this day")
    ap.add_argument("--commit", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    load_config()
    now = datetime.now(timezone.utc)
    co, sections, offerings, enrollments = load_offering_context(args.course, args.slug)
    if not offerings:
        sys.exit("No published assignment matched.")

    section_of = {e["id"]: e["section_id"] for e in enrollments}
    name_of = {e["id"]: (e.get("students") or {}).get("name") or e["student_id"] for e in enrollments}
    code_of = {s["id"]: s["code"] for s in sections}
    day_of = {s["id"]: ((s.get("meeting_days") or [(s["code"] or "")[:1]])[0]) for s in sections}

    scope = [e["id"] for e in enrollments
             if not args.day or day_of.get(e["section_id"]) == args.day]
    if not scope:
        sys.exit("No active enrollments in scope.")

    offering_ids = [o["id"] for o in offerings]
    submissions, grades, extensions = [], [], []
    for chunk in chunked(scope):
        submissions += get(
            "submissions?select=id,enrollment_id,assignment_offering_id,status,chosen_activity_id,"
            "submission_activities(activity_id,content)"
            f"&assignment_offering_id={in_list(offering_ids)}&enrollment_id={in_list(chunk)}"
        )
        grades += get(
            "grades?select=enrollment_id,assignment_offering_id,is_finalized,source,points_earned,diagnostic"
            f"&assignment_offering_id={in_list(offering_ids)}&enrollment_id={in_list(chunk)}"
        )
        extensions += get(
            "extensions?select=enrollment_id,assignment_offering_id,extended_due_at"
            f"&assignment_offering_id={in_list(offering_ids)}&enrollment_id={in_list(chunk)}"
            "&revoked_at=is.null"
        )

    sub_by = {(s["enrollment_id"], s["assignment_offering_id"]): s for s in submissions}
    grade_by = {(g["enrollment_id"], g["assignment_offering_id"]): g for g in grades}
    ext_by = {(x["enrollment_id"], x["assignment_offering_id"]): x["extended_due_at"] for x in extensions}

    to_write, report = [], []
    tally = {"zeroed": 0, "already_zero": 0, "submitted": 0, "draft_with_content": 0,
             "interactive": 0, "not_due": 0, "extended": 0, "human_graded": 0, "graded": 0}

    for o in offerings:
        per_assignment = []
        for enr in scope:
            key = (enr, o["id"])
            sec = section_of.get(enr)
            ext_iso = ext_by.get(key)

            # (3) an active extension takes them out entirely — before the deadline test, because
            # effective_due() would otherwise report them as "due" on their extended date.
            if ext_iso and (parse_ts(ext_iso) or now) > now:
                tally["extended"] += 1
                continue

            # (2) past their own deadline?
            due = effective_due(o, sec, ext_iso)
            if due is None or due > now:
                tally["not_due"] += 1
                continue

            sub = sub_by.get(key)
            # (4) interactive commit -> the trigger owns this grade.
            if sub and sub.get("chosen_activity_id") and sub["chosen_activity_id"] != o["written_id"]:
                tally["interactive"] += 1
                continue
            # (4) any non-empty written content -> they submitted, or they drafted real answers.
            content = {}
            for sa in (sub or {}).get("submission_activities") or []:
                if sa.get("activity_id") == o["written_id"] and isinstance(sa.get("content"), dict):
                    content = sa["content"]
            if any(str(v).strip() for v in content.values()):
                tally["submitted" if (sub or {}).get("status") == "committed" else "draft_with_content"] += 1
                continue

            g = grade_by.get(key)
            if g:
                # Already ours and already zero: idempotent no-op, not a rewrite.
                if (not g.get("is_finalized") and g.get("source") == "ai_suggested"
                        and (g.get("diagnostic") or {}).get("no_submission")):
                    tally["already_zero"] += 1
                    continue
                # (5) a human's decision, or a real graded submission.
                if g.get("is_finalized") or g.get("source") == "instructor":
                    tally["human_graded"] += 1
                    continue
                tally["graded"] += 1
                continue

            to_write.append(zero_row(o, enr, now))
            per_assignment.append(f"{name_of.get(enr)} ({code_of.get(sec, '?')})")
            tally["zeroed"] += 1

        if per_assignment:
            report.append((o["slug"] or o["title"], sorted(per_assignment)))

    term = (co.get("terms") or {}).get("label") or (co.get("terms") or {}).get("code") or "?"
    print(f"\n{args.course} · {term}" + (f" · day {args.day}" if args.day else "")
          + (f" · {args.slug}" if args.slug else " · every published assignment"))
    print(f"{len(scope)} active enrolments · {len(offerings)} assignment(s) · now {iso(now)}\n")

    for slug, names in report:
        print(f"  {slug} — {len(names)} to zero")
        for n in names:
            print(f"      {n}")
    if not report:
        print("  nothing to zero")

    print("\n  skipped:")
    for k, label in [
        ("already_zero", "already zeroed by a previous run"),
        ("submitted", "submitted work"),
        ("draft_with_content", "drafted real answers, never submitted (graded on what they wrote)"),
        ("interactive", "took the interactive path (auto-graded on commit)"),
        ("not_due", "not past their own deadline yet"),
        ("extended", "hold an active extension"),
        ("human_graded", "finalized or instructor-authored grade"),
        ("graded", "already have an AI grade for submitted work"),
    ]:
        if tally[k]:
            print(f"      {tally[k]:5d}  {label}")

    if not to_write:
        print("\nNothing to do.")
        return

    if not args.commit:
        print(f"\nDRY RUN — would write {len(to_write)} zero grade(s). Re-run with --commit.")
        return

    written = []
    for chunk in chunked(to_write, 200):
        written += upsert("grades?on_conflict=enrollment_id%2Cassignment_offering_id", chunk)
    print(f"\nWrote {len(written)} zero grade(s).")

    # Read back and check, rather than trusting the write's own echo (CORE.md §5 verification
    # posture: a run that has not been read back is a hypothesis).
    bad = [
        r for r in written
        if r.get("points_earned") not in (0, "0", 0.0)
        or r.get("is_finalized")
        or not (r.get("diagnostic") or {}).get("no_submission")
    ]
    if bad:
        sys.exit(f"VERIFY FAILED — {len(bad)} row(s) did not come back as an unfinalized zero.")
    print("Verified: every row is points_earned 0, is_finalized false, diagnostic.no_submission true.")
    print("These are SUGGESTIONS. They become visible to cadets when an instructor finalizes.")


if __name__ == "__main__":
    main()
