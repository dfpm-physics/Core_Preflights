"""Exercise lesson_aggregate.summarize() over a mixed cohort, no DB.

The Python summarize() and the JS summarizeReports() must agree — the aggregator's prose is
required to cite the same figures the browser's bars show (ROLLUP-AGREEMENT §2 grounding rule).
This checks the cross-modality behaviour added 2026-07-21 against the same cases the JS suite
asserts in tests/app-schema/test-rollup.mjs.
"""
import sys
from pathlib import Path
sys.path.insert(0, r"c:\01 -- AI Projects\Socratic Instruction\Core_Preflights\supabase\admin")

from lesson_aggregate import summarize, _pinned_question_id  # noqa: E402 (no connection opened)

fails = []


def want(desc, actual, expected):
    ok = actual == expected
    print(("  [pass] " if ok else "  [FAIL] ") + desc + ("" if ok else f" — got {actual!r}, want {expected!r}"))
    if not ok:
        fails.append(desc)


S1 = {"schema": 1, "source": "preflight-analyze", "objectives": [],
      "reading_reflection": {"meaningful": True, "engagement": 4},
      "flags": {"needs_follow_up": False, "notable": False}}


def interactive(effort, over, objs=(), misc=()):
    return {"path": "interactive", "effort": effort, "points_earned": None,
            "report_data": {"schema": 1, "effort": effort, "overall_understanding": over,
                            "objectives": list(objs), "misconceptions": list(misc)}}


def written(effort, over, q3, misc=(), follow=False):
    return {"path": "written", "effort": None, "points_earned": None,
            "q2_effort": effort, "q3_understanding": q3,
            "report_data": {**S1, "effort": effort, "overall_understanding": over,
                            "misconceptions": list(misc),
                            "flags": {"needs_follow_up": follow, "notable": False}}}


print("\n=== effort merges across both paths ===")
mixed = summarize([interactive(5, 4), interactive(3, 3), written(4, 3, 2), written(1, 1, 1)], 2)
want("all four counted", mixed["n"], 4)
want("one histogram over both paths", mixed["effort"]["hist"], [0, 1, 0, 1, 1, 1])
want("mean over both paths", mixed["effort"]["avg"], (5 + 3 + 4 + 1) / 4)
want("nobody unassessed", mixed["effort"]["not_assessed"], 0)
want("paths reported", (mixed["paths"]["interactive_n"], mixed["paths"]["written_n"],
                        mixed["paths"]["mixed"]), (2, 2, True))

print("\n=== a written-only cohort still produces numbers ===")
wonly = summarize([written(4, 3, 3), written(2, 1, 1)], 2)
want("real effort mean", wonly["effort"]["avg"], 3)
want("real understanding", wonly["understanding"]["overall"], 2)
want("attributed to the written path", wonly["understanding"]["from"], {"interactive": 0, "written": 2})
want("labelled written-only", wonly["paths"]["mixed"], False)

print("\n=== q2_effort fallback (grades written before schema:1) ===")
legacy = [{"path": "written", "effort": None, "points_earned": None,
           "q2_effort": 3, "q3_understanding": 2, "report_data": None}]
want("effort falls back to q2_effort", summarize(legacy, 2)["effort"]["avg"], 3)
want("…and understanding to the free-response score",
     summarize(legacy, 2)["understanding"]["overall"], 2)

print("\n=== the free-response objective ===")
objd = summarize([
    interactive(4, 4, objs=[{"key": "coulomb", "label": "Coulomb", "understanding": 4},
                            {"key": "vector", "label": "Vector sum", "understanding": 2}]),
    # q3 means 1.5 — deliberately BELOW the weakest interactive objective (2), so the ordering
    # assertion tests the sort rather than a tie's arbitrary stable order.
    written(4, 3, 1), written(3, 3, 2),
], 2)
fr = [o for o in objd["objectives"] if o["key"] == "__free_response__"]
want("exactly one free-response item", len(fr), 1)
want("labelled for a human", fr[0]["label"], "Free response")
want("tagged written", fr[0]["source"], "written")
want("mean over those who answered", fr[0]["understanding"], 1.5)
want("weakest first, interleaved not appended",
     [o["key"] for o in objd["objectives"]], ["__free_response__", "vector", "coulomb"])

print("\n=== misconceptions now count for the written path ===")
mc = summarize([
    written(4, 3, 2, misc=[{"id": "scalar-sum", "label": "Scalar sum", "severity": "major"}]),
    written(2, 1, 1, misc=[{"id": "scalar-sum", "label": "Scalar sum", "severity": "major"}], follow=True),
], 2)
want("counted by id", [(m["id"], m["count"]) for m in mc["misconceptions"]], [("scalar-sum", 2)])
want("severity carried", mc["misconceptions"][0]["major"], 2)
want("prevalence computed", mc["misconceptions"][0]["prevalence_pct"], 100)
want("flags tally", mc["flags"]["needs_follow_up"], 1)
want("reflection gate assessed", mc["reflection"]["assessed"], 2)

print("\n=== identifying the pinned questions when nobody marked them ===")
# A read of the live DB on 2026-07-21 found 0 of 74 written activities carrying ANY role, so the
# fallbacks are not a nicety — they are what makes the feature work this term.
LIVE_SHAPE = {"questions": [
    {"id": "q1", "type": "free_response", "points": 0,
     "text": "How much time did you spend reading the book in preparation for this lesson?"},
    {"id": "q2", "type": "free_response", "points": 1,
     "text": "What did you find most confusing or most interesting about the reading? Be specific."},
    {"id": "q3", "type": "free_response", "points": 1, "text": "Can an object have a velocity…"},
]}
want("live Fall shape: reading time found by text", _pinned_question_id(LIVE_SHAPE, "reading_time"),
     ("q1", "text"))
want("live Fall shape: reflection found by text",
     _pinned_question_id(LIVE_SHAPE, "reading_reflection"), ("q2", "text"))

ROLED = {"questions": [
    {"id": "qA", "role": "reading_reflection", "text": "anything"},
    {"id": "qB", "role": "reading_time", "text": "anything"},
]}
want("an explicit role wins over position", _pinned_question_id(ROLED, "reading_time"), ("qB", "role"))
want("…and over text", _pinned_question_id(ROLED, "reading_reflection"), ("qA", "role"))

REORDERED = {"questions": [
    {"id": "q2", "points": 1, "text": "What did you find most confusing or most interesting?"},
    {"id": "q1", "points": 0, "text": "How much time did you spend reading the book?"},
]}
want("text matching survives reordering", _pinned_question_id(REORDERED, "reading_time"),
     ("q1", "text"))

UNRECOGNIZABLE = {"questions": [{"id": "q1", "text": "Something else entirely"},
                                {"id": "q2", "text": "Also unrelated"}]}
want("falls back to position, and says so",
     _pinned_question_id(UNRECOGNIZABLE, "reading_time"), ("q1", "position"))
want("no questions at all -> nothing, not a crash",
     _pinned_question_id({"questions": []}, "reading_time"), (None, None))
want("no content at all -> nothing", _pinned_question_id(None, "reading_time"), (None, None))

print("\n=== reading time (Q1) ===")


def read_row(mins, path="written"):
    d = {**S1, "effort": 3}
    if mins is not None:
        d["reading_minutes"] = mins
    return {"path": path, "effort": None, "points_earned": None,
            "q2_effort": 3, "q3_understanding": 3, "report_data": d}


rd = summarize([read_row(10), read_row(20), read_row(35), read_row(50), read_row(90),
                read_row(None)], 2)["reading"]
want("only durations that were stated are counted", rd["assessed"], 5)
want("a written student who named none is tracked", rd["not_stated"], 1)
want("median, not mean (mean would be 41)", rd["median"], 35)
want("buckets", [(b["key"], b["count"]) for b in rd["buckets"]],
     [("lt15", 1), ("m15_29", 1), ("m30_44", 1), ("m45_59", 1), ("gte60", 1)])
want("spread reported", (rd["min"], rd["max"]), (10, 90))

skew = summarize([read_row(20), read_row(25), read_row(30), read_row(180)], 2)["reading"]
want("an outlier does not move the median", skew["median"], 27.5)

ionly = summarize([interactive(4, 4), interactive(3, 3)], 2)["reading"]
want("interactive cohort reports no reading time", ionly["assessed"], 0)
want("…and is not counted as withholding it (Q1 is not asked there)", ionly["not_stated"], 0)
want("…median is null, not zero", ionly["median"], None)

want("zero minutes is rejected, not treated as a real duration",
     summarize([read_row(0)], 2)["reading"]["assessed"], 0)

print("\n=== a student who did both counts once ===")
both = summarize([{"path": "both", "effort": None, "points_earned": None, "q2_effort": 2,
                   "q3_understanding": 2,
                   "report_data": {"schema": 1, "effort": 4, "overall_understanding": 5,
                                   "objectives": [], "misconceptions": []}}], 2)
want("one row", both["n"], 1)
want("in both tallies", (both["paths"]["interactive_n"], both["paths"]["written_n"]), (1, 1))
want("one effort entry", sum(both["effort"]["hist"]), 1)
want("interactive assessment wins over the reflection-only score", both["effort"]["avg"], 4)
want("understanding from the holistic read", both["understanding"]["overall"], 5)
want("attributed to interactive", both["understanding"]["from"], {"interactive": 1, "written": 0})

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
for f in fails:
    print("  - " + f)
sys.exit(1 if fails else 0)
