#!/usr/bin/env python3
"""Offline checks for zero_non_submitters.py — the deadline arithmetic and the payload shape.

NO DATABASE, NO CREDENTIALS. That is the point: this exercises the two parts of the script that
decide whether a real cadet gets a zero, on a machine that has never run /setup-preflight. The
script loads its service key inside main() rather than at import specifically so this can import it.

WHY THESE TWO THINGS
    `effective_due()` is the one piece of arithmetic here that is a re-implementation. It mirrors
    `effectiveDue()` + `resolveDueBySection()` in site/js/schema.js, and the two must agree or the
    script zeroes cadets the site considers not yet due. The per-day fold (migration 017) is the
    half that would be easiest to drop: most sections carry no explicit `assignment_due_dates` row,
    so a version without it reads every one of them as due at the offering default — which on a
    term with split M/T deadlines means zeroing a whole day track early, and a zero for work that
    is not late yet is the most expensive mistake this script can make.

    `zero_row()` writes a grade a cadet eventually sees. `is_finalized` and `source` are what let a
    later run overwrite it when an extension is granted (the director's second requirement), and
    the four keys WRITTEN-SCHEMA1.md forbids must stay out.

Usage:  python scripts/fall2026/zero_non_submitters_test.py
"""

import importlib.util
import os
import sys
from datetime import datetime, timezone

# The Windows console defaults to cp1252, which has no U+2192 — a label containing one raises
# UnicodeEncodeError from inside print() and aborts the run mid-suite, which reads as a test
# failure and is not one. The course director's machine is Windows.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):  # pragma: no cover - non-reconfigurable stream
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("znz", os.path.join(HERE, "zero_non_submitters.py"))
Z = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Z)

PASSED = FAILED = 0


def eq(label, got, want):
    global PASSED, FAILED
    if got == want:
        PASSED += 1
        print(f"  [pass] {label}")
    else:
        FAILED += 1
        print(f"  [FAIL] {label}\n         got  {got!r}\n         want {want!r}")


def section(title):
    print(f"\n=== {title} ===")


SEC_M, SEC_T = "sec-m", "sec-t"

# A realistic offering: an explicit per-section row for the M sections only, a per-day schedule
# covering both, and an offering default under both. Exactly the layering a Fall lesson has.
OFFERING = {
    "id": "off-1",
    "points_possible": 2,
    "due_at": "2026-08-10T05:59:00+00:00",
    "due_by_day": {"M": "2026-08-11T05:59:00+00:00", "T": "2026-08-12T05:59:00+00:00"},
    "due_by_section": {SEC_M: "2026-08-09T05:59:00+00:00"},
    "section_day": {SEC_M: "M", SEC_T: "T"},
    "questions": [
        {"id": "q1", "points": 0},   # reading time, zero-point, never rendered on a grade card
        {"id": "q2", "points": 1},   # reading reflection
        {"id": "q3", "points": 1},   # the free response
    ],
    "written_id": "act-w",
    "interactive_id": "act-i",
}

section("effective_due — extension › per-section row › per-day schedule › offering default")

eq("an extension wins over every deadline under it",
   Z.effective_due(OFFERING, SEC_M, "2026-09-01T00:00:00Z"), Z.parse_ts("2026-09-01T00:00:00Z"))
eq("an explicit per-section row beats the per-day schedule",
   Z.effective_due(OFFERING, SEC_M, None), Z.parse_ts("2026-08-09T05:59:00+00:00"))
# The migration-017 fold. Without it this returns the offering default and the T sections are
# zeroed two days early.
eq("a section with no row takes its OWN meeting day, not the offering default",
   Z.effective_due(OFFERING, SEC_T, None), Z.parse_ts("2026-08-12T05:59:00+00:00"))
eq("an unknown section falls back to the offering default",
   Z.effective_due(OFFERING, "sec-x", None), Z.parse_ts("2026-08-10T05:59:00+00:00"))

no_schedule = {**OFFERING, "due_by_day": {}, "due_by_section": {}}
eq("no schedule at all → the offering default",
   Z.effective_due(no_schedule, SEC_T, None), Z.parse_ts("2026-08-10T05:59:00+00:00"))
# No deadline means nothing can be past it. main() treats None as "not due", which is the safe
# direction: an assignment nobody set a date on must not zero the class.
eq("no deadline anywhere → None, and nobody is zeroed",
   Z.effective_due({**no_schedule, "due_at": None}, SEC_T, None), None)

section("parse_ts — PostgREST timestamps")

eq("a Z suffix parses", Z.parse_ts("2026-08-10T05:59:00Z"),
   datetime(2026, 8, 10, 5, 59, tzinfo=timezone.utc))
# Every timestamp column here is timestamptz, so a naive value can only be UTC. Leaving it naive
# would make the `> now` comparison raise rather than answer.
eq("a naive value is read as UTC", Z.parse_ts("2026-08-10T05:59:00"),
   datetime(2026, 8, 10, 5, 59, tzinfo=timezone.utc))
eq("garbage is None, not an exception", Z.parse_ts("not a date"), None)
eq("empty is None", Z.parse_ts(""), None)
eq("null is None", Z.parse_ts(None), None)

section("zero_row — the payload SKILL.md specifies")

ROW = Z.zero_row(OFFERING, "enr-1", datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc))
D = ROW["diagnostic"]

eq("points_earned is 0", ROW["points_earned"], 0)
eq("points_possible comes from the OFFERING, not the question list", ROW["points_possible"], 2)
# The pair that makes the extension case work without special handling: an unfinalized,
# AI-sourced row is exactly what /preflight-analyze's two guards let a later run overwrite.
eq("is_finalized false", ROW["is_finalized"], False)
eq("source ai_suggested", ROW["source"], "ai_suggested")
eq("graded_by is unset — this skill is not a person", "graded_by" in ROW, False)
# Omitted rather than sent as an explicit null. There is no submission to point at, and on an
# UPSERT a key that is absent from the payload is left alone rather than nulled — which matters if
# a row somehow already carries one.
eq("submission_id is not sent", "submission_id" in ROW, False)

eq("every question scores 0", [v["score"] for v in ROW["question_scores"].values()], [0, 0, 0])
eq("max is copied from each question", [v["max"] for v in ROW["question_scores"].values()], [0, 1, 1])
eq("all three are red", sorted({v["status"] for v in ROW["question_scores"].values()}), ["zero"])
# "Never deduct without feedback" is about a deduction. A zero-point question deducts nothing, and
# Q1 is not rendered on a grade card at all (CORE.md §2).
eq("the zero-point question carries no feedback", ROW["question_scores"]["q1"]["feedback"], "")
eq("the scored ones do", ROW["question_scores"]["q2"]["feedback"], "No submission received.")

eq("q3_understanding is 0 — the director's second requirement", D["q3_understanding"], 0)
eq("q2_effort is 0", D["q2_effort"], 0)
eq("schema 1, so the cohort folder can read it", D["schema"], 1)
eq("source names the producer", D["source"], "preflight-analyze")
eq("marked as a non-submission, not merely as a zero", D["no_submission"], True)
eq("effort 0", D["effort"], 0)
eq("overall_understanding 0", D["overall_understanding"], 0)
eq("objectives is an empty array, not absent", D["objectives"], [])
eq("misconceptions is an empty array — nothing was demonstrated", D["misconceptions"], [])
eq("the reflection is judged, not quoted", D["reading_reflection"], {"meaningful": False, "engagement": 0})
eq("flagged for follow-up", D["flags"], {"needs_follow_up": True, "notable": False})

# The four keys WRITTEN-SCHEMA1.md § "What NOT to emit" forbids.
eq("no reflection text", "text" in D["reading_reflection"], False)
eq("no honor key — provenance cannot be known from a blank", "honor" in D, False)
eq("no self_rated_understanding", "self_rated_understanding" in D, False)
# 0 minutes would read as "read for zero minutes" rather than "not stated"; absent is the truth.
eq("no reading_minutes stand-in of 0", "reading_minutes" in D, False)

section("zero_row — an assignment shaped differently")

# A written activity whose questions are all scored, and one with none at all. Neither exists in
# Fall 2026, but the row must not be built out of assumptions about q1/q2/q3.
eq("a two-question assignment produces two question_scores",
   sorted(Z.zero_row({**OFFERING, "questions": [{"id": "a", "points": 1}, {"id": "b", "points": 1}]},
                     "e", datetime.now(timezone.utc))["question_scores"]),
   ["a", "b"])
eq("a question with no id is skipped rather than keyed on None",
   sorted(Z.zero_row({**OFFERING, "questions": [{"points": 1}, {"id": "b", "points": 1}]},
                     "e", datetime.now(timezone.utc))["question_scores"]),
   ["b"])
eq("an interactive-only offering yields an empty question map, and still a zero total",
   Z.zero_row({**OFFERING, "questions": []}, "e", datetime.now(timezone.utc))["question_scores"], {})

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
