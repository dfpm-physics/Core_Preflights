"""Exercise lesson_aggregate.summarize() over a mixed cohort, no DB.

The Python summarize() and the JS summarizeReports() must agree — the aggregator's prose is
required to cite the same figures the browser's bars show (ROLLUP-AGREEMENT §2 grounding rule).
This checks the cross-modality behaviour added 2026-07-21 against the same cases the JS suite
asserts in tests/app-schema/test-rollup.mjs.
"""
import itertools
import sys
from pathlib import Path
sys.path.insert(0, r"c:\01 -- AI Projects\Socratic Instruction\Core_Preflights\supabase\admin")

from lesson_aggregate import (  # noqa: E402 (no connection opened)
    summarize, _pinned_question_id, _meets, _answer, _graded_response_questions, MAX_ANSWER,
    _ambiguous_slug_message, _all_scope_state, _scope_phrase, _run_summary, _fingerprint,
)

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

print("\n=== a lesson that DECLARES roles gets no positional guessing ===")
# The lesson builder can switch either pinned question off (director, 2026-07-30), and the whole
# point of a role is that its ABSENCE is then meaningful. Without the declared-roles guard the
# fallbacks fire on exactly the lesson that has already answered the question, and the answer they
# invent is whatever sits in the old position. These are the cases that go wrong first.
#
# Mirrored in tests/app-schema/test-rollup.mjs — the browser renders the reflections this run
# quotes, so the two resolvers must agree case for case.
REFLECTION_ONLY = {"questions": [
    {"id": "q1", "type": "free_response", "points": 1, "role": "reading_reflection",
     "text": "What did you find most confusing or most interesting about the reading?"},
    {"id": "q2", "type": "free_response", "points": 1, "text": "Why does the bulb dim?"},
]}
want("the declared reflection is found wherever it sits",
     _pinned_question_id(REFLECTION_ONLY, "reading_reflection"), ("q1", "role"))
# The regression this guard exists for: q1 is the REFLECTION, and _ROLE_FALLBACK_ID says
# reading_time is q1. Guessing here would read reflection prose as a reading duration.
want("reading time is ABSENT, not the q1 that happens to be the reflection",
     _pinned_question_id(REFLECTION_ONLY, "reading_time"), (None, None))

TIME_ONLY = {"questions": [
    {"id": "q1", "type": "free_response", "points": 0, "role": "reading_time",
     "text": "How much time did you spend reading the book?"},
    {"id": "q2", "type": "free_response", "points": 1, "text": "Why does the bulb dim?"},
]}
want("the declared reading-time question is found", _pinned_question_id(TIME_ONLY, "reading_time"),
     ("q1", "role"))
# Same in the other direction: q2 is an ordinary question and must not become the reflection.
want("the reflection is ABSENT, not the q2 that happens to sit there",
     _pinned_question_id(TIME_ONLY, "reading_reflection"), (None, None))

LEGACY_REFLECTION_ONLY = {"questions": [
    {"id": "q1", "points": 1, "text": "What did you find most confusing or most interesting?"},
    {"id": "q2", "points": 1, "text": "Why does the bulb dim?"},
]}
want("legacy, reflection only: found by its prompt",
     _pinned_question_id(LEGACY_REFLECTION_ONLY, "reading_reflection"), ("q1", "text"))
want("...and reading time does NOT take it by position",
     _pinned_question_id(LEGACY_REFLECTION_ONLY, "reading_time"), (None, None))

NEITHER = {"questions": [
    {"id": "q1", "type": "free_response", "points": 1, "text": "Why does the bulb dim?"},
    {"id": "q2", "type": "free_response", "points": 1, "text": "What is the current?"},
]}
want("a lesson declaring NO roles still uses the bridge (q1 by position)",
     _pinned_question_id(NEITHER, "reading_time"), ("q1", "position"))

# A declared role elsewhere is enough to switch the whole list to role-only, even when the role
# being asked about is not the one declared — that is what "declares its roles" means.
MIXED = {"questions": [
    {"id": "q1", "type": "free_response", "points": 1, "text": "Why does the bulb dim?"},
    {"id": "q2", "type": "free_response", "points": 1, "role": "reading_reflection",
     "text": "Reflect on the reading."},
]}
want("one declared role disables the bridge for the other",
     _pinned_question_id(MIXED, "reading_time"), (None, None))

print("\n=== identifying the GRADED concept question(s) by exclusion ===")
# Q3 is found by excluding the two pinned questions, not by a role of its own. `points > 0` alone
# would also match the reading reflection, which is free_response points:1 — so the exclusion is
# what separates them, and these assertions are what prove it.
FALL = {"questions": [
    {"id": "q1", "type": "free_response", "points": 0,
     "text": "How much time did you spend reading the book in preparation for this lesson?"},
    {"id": "q2", "type": "free_response", "points": 1,
     "text": "What did you find most confusing or most interesting about the reading? Be specific."},
    {"id": "q3", "type": "free_response", "points": 1, "expected_response": "Electrons transfer.",
     "text": "After rubbing a glass rod with silk, a student says the glass gained protons…"},
]}
want("the Fall preflight shape yields exactly the concept question",
     [q["id"] for q in _graded_response_questions(FALL)], ["q3"])
want("…carrying its prompt and the expected answer (the physics source of truth)",
     _graded_response_questions(FALL)[0]["expected_response"], "Electrons transfer.")

# The lab variant. Its Q1 says "reading the LAB INSTRUCTIONS" and its Q2 is the same reflection —
# both still contain the pinned needles, so the exclusion holds. If it ever stops holding, every
# reading reflection silently lands in the concept-question analysis, which is why this is here.
LAB = {"questions": [
    {"id": "q1", "type": "free_response", "points": 0,
     "text": "How much time did you spend reading the lab instructions in preparation?"},
    {"id": "q2", "type": "free_response", "points": 1,
     "text": "What did you find most confusing or most interesting about the reading?"},
    {"id": "q3", "type": "free_response", "points": 1, "text": "Predict the meter reading…"},
]}
want("a LAB lesson still excludes its reflection (needles survive the lab wording)",
     [q["id"] for q in _graded_response_questions(LAB)], ["q3"])

want("a lesson with two concept questions returns both",
     [q["id"] for q in _graded_response_questions({"questions": FALL["questions"] + [
         {"id": "q4", "type": "free_response", "points": 2, "text": "And explain why."}]})],
     ["q3", "q4"])
want("multiple choice is not a free-response concept question",
     [q["id"] for q in _graded_response_questions({"questions": FALL["questions"] + [
         {"id": "q5", "type": "multiple_choice", "points": 1, "text": "Pick one."}]})], ["q3"])
want("a zero-point extra question is not treated as graded",
     [q["id"] for q in _graded_response_questions({"questions": FALL["questions"] + [
         {"id": "q6", "type": "free_response", "points": 0, "text": "Optional musing."}]})], ["q3"])
want("an interactive activity has no questions block -> nothing",
     _graded_response_questions({"artifact_url": "https://claude.ai/x"}), [])
want("no content at all -> nothing, not a crash", _graded_response_questions(None), [])

print("\n=== _meets: which sections a --day run covers ===")
want("a section meeting that day matches", _meets(["M"], "M"), True)
want("…case-insensitively", _meets(["m"], "M"), True)
want("a section meeting the other day does not", _meets(["T"], "M"), False)
want("a section meeting BOTH days matches either", _meets(["M", "T"], "T"), True)
want("empty meeting_days matches no day filter at all", _meets([], "M"), False)
want("…and neither does a null", _meets(None, "M"), False)
want("no day filter matches everything, including empty", _meets([], None), True)

print("\n=== _answer: the two stored answer shapes ===")
want("the nested {answers:{…}} shape", _answer({"answers": {"q3": " hello "}}, "q3"), "hello")
want("the flat {q3:…} shape", _answer({"q3": "hello"}, "q3"), "hello")
want("a blank answer is None, not an empty string", _answer({"q3": "   "}, "q3"), None)
want("a missing question is None", _answer({"q3": "hi"}, "q9"), None)
want("a non-string answer is None", _answer({"q3": 42}, "q3"), None)
want("no qid is None", _answer({"q3": "hi"}, None), None)
_long = _answer({"q3": "x" * (MAX_ANSWER + 500)}, "q3")
want("an overlong answer is truncated, with an ellipsis", len(_long), MAX_ANSWER + 1)

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

print("\n=== per-question tallies (summarize()['questions']) ===")
# Python-only ON PURPOSE: summarizeReports() has no equivalent. This block is pull-only prose
# material, and since the By-question UI panel was deleted there is no browser panel it could
# disagree with. Do not "fix" the divergence by porting it — that would be a panel nobody reads.


def graded(status, score=1.0, qid="q3"):
    return {"path": "written", "effort": None, "points_earned": score,
            "q2_effort": 4, "q3_understanding": 3,
            "question_scores": {qid: {"score": score, "max": 1.0, "status": status}},
            "report_data": {**S1, "effort": 4, "misconceptions": []}}


q = summarize([graded("full"), graded("full"), graded("warn"), graded("zero", 0.0)], 2)["questions"]
want("every scored student is counted once", q["q3"]["n"], 4)
want("full credit tallied", q["q3"]["full"], 2)
want("warn is its own bucket, not folded into full", q["q3"]["warn"], 1)
want("zero tallied", q["q3"]["zero"], 1)
want("points averaged over the scored", q["q3"]["points_avg"], 0.75)
want("the question's max carries through", q["q3"]["points_max"], 1.0)

ungraded = summarize([graded("full"), {"path": "written", "effort": None, "points_earned": None,
                                       "q2_effort": None, "q3_understanding": None,
                                       "question_scores": {"q3": {"score": None, "max": 1.0,
                                                                  "status": None}},
                                       "report_data": {}}], 2)["questions"]
want("a null status counts as ungraded, NEVER as a zero", ungraded["q3"]["ungraded"], 1)
want("…and is kept out of the zero bucket", ungraded["q3"]["zero"], 0)

# The gate the SKILL's whole question subsection hangs on. An empty dict means "no question set";
# a dict of zeros would read as "a question set everyone failed" and produce prose about a
# cohort that was never asked anything.
inter = summarize([interactive(4, 5), interactive(3, 4)], 2)["questions"]
want("an interactive-only cohort yields an EMPTY questions block", inter, {})
want("…which is falsy, so the skill's gate works", bool(inter), False)

print("\n=== misconception ids canonicalize — MUST match canonMisconceptionId() in JS ===")

# Both producers may coin ids (contract §5.4) and both counting sites key on the string, so
# `scalar-sum`, `Scalar-Sum` and `scalar sum` used to be three entries here and three bars in the
# browser. These assertions mirror the ones in tests/app-schema/test-rollup.mjs one for one: if the
# two normalizers ever drift, the aggregator's prose cites a prevalence the panel does not show.
_ev = itertools.cycle(("I added 3N and 5N", "just summed them", "8N total", "added the numbers"))
def mrow(mid, desc="Adds magnitudes, ignores direction.", ev=None, sev="major"):
    return written(4, 3, 3, misc=[{"id": mid, "label": "Scalar sum of forces",
                                   "description": desc, "severity": sev,
                                   "evidence": ev if ev is not None else next(_ev)}])

canon = summarize([mrow("scalar-sum"), mrow("Scalar-Sum "), mrow("scalar sum")], 2)["misconceptions"]
want("three id spellings collapse to ONE entry", len(canon), 1)
want("…under the canonical id", canon[0]["id"], "scalar-sum")
want("…counting all three", canon[0]["count"], 3)
want("…all three major", canon[0]["major"], 3)
# Casing and spacing are the SAME id, not variants — listing them would be popover noise. Only a
# genuinely different id folded by the alias map is a variant, and that fold happens in the browser.
want("mere casing/spacing differences are NOT reported as variants", canon[0]["variants"], [])

# description + evidence now survive to the cohort entry; they used to be dropped here and in JS,
# which is why a bar could not explain itself.
want("description survives", canon[0]["description"], "Adds magnitudes, ignores direction.")
want("evidence from different students surfaces as examples, capped at 2",
     len(canon[0]["examples"]), 2)
want("…deduplicated, not repeated",
     len(summarize([mrow("m1", ev="same"), mrow("m1", ev="same")], 2)["misconceptions"][0]["examples"]), 1)

longest = summarize([mrow("scalar-sum", desc="Short."),
                     mrow("scalar-sum", desc="A much longer and more useful explanation.")],
                    2)["misconceptions"]
want("the fullest description wins (same rule as JS)",
     longest[0]["description"], "A much longer and more useful explanation.")

blank = summarize([mrow("   ")], 2)["misconceptions"]
want("a whitespace-only id is dropped, not counted as a bar", blank, [])


print("\n=== an ambiguous lesson slug explains itself without advising a deletion ===")


def offering(course, term, written_slug="ws", interactive_slug=None):
    return {"course_code": course, "term_code": term,
            "written_slug": written_slug, "interactive_slug": interactive_slug}


def has(desc, text, needle, present=True):
    ok = (needle in text) is present
    print(("  [pass] " if ok else "  [FAIL] ") + desc
          + ("" if ok else f" — {'missing' if present else 'unexpected'} {needle!r} in:\n{text}"))
    if not ok:
        fails.append(desc)


# The live case, confirmed against the real database 2026-07-22: `preflight-02` is an assignment
# slug in BOTH phys-110 and phys-215, same term, both active. The message this replaced said
# "deactivate the stale course_offering" — following it would have taken a live course offline.
cross = _ambiguous_slug_message("preflight-02", [
    offering("phys-110", "2026FA", "phys-110-preflight-02-written"),
    offering("phys-215", "2026FA", "phys-215-preflight-02-written"),
])
has("names the first course", cross, "phys-110")
has("names the second course", cross, "phys-215")
has("offers a course-scoped activity slug to re-run with", cross,
    "--lesson phys-215-preflight-02-written")
has("states plainly that both are live", cross, "BOTH ARE LIVE")
# Assert the *prohibition*, not the absence of the word — the message is required to say "do not
# deactivate", so a bare `"deactivate" not in text` check fails on correct output. What must be
# absent is the stale-offering INSTRUCTION, which is a different string.
has("explicitly forbids deactivating either one", cross, "do not deactivate")
has("…and omits the stale-offering advice entirely", cross, "is over, deactivate", present=False)

# The other shape: one course, two terms. Here a stale offering genuinely is plausible, so the
# deactivation advice is correct — but only for this branch.
terms = _ambiguous_slug_message("preflight-02", [
    offering("phys-215", "2026FA", "phys-215-preflight-02-written"),
    offering("phys-215", "2027SP", "phys-215-preflight-02-written"),
])
has("a cross-TERM match may be a stale offering, and says so", terms, "is over, deactivate")
has("…and does not claim both are live", terms, "BOTH ARE LIVE", present=False)

# Neither modality present → must not render the string "--lesson None".
no_alt = _ambiguous_slug_message("preflight-02", [
    offering("phys-110", "2026FA", None), offering("phys-215", "2026FA", None)])
has("no activity slug → says so", no_alt, "no activity slug to disambiguate")
has("…and never emits a literal None", no_alt, "None", present=False)

# ══════════════════════════════════════════════════════════════════════════════════════
# The analysis_runs audit line — what a director is told, and how loudly
#
# `summary` is rendered VERBATIM by site/js/run-banner.js as a strip on every faculty page, and
# `status` picks its colour. Both are therefore UI decisions, and both are pure functions here,
# so they are checked without a database exactly like summarize() above.
# ══════════════════════════════════════════════════════════════════════════════════════
print("\n=== the audit line: why '__all__' is missing decides the colour ===")

SEC = {"M1A": "s-m1a", "M3A": "s-m3a", "T1A": "s-t1a", "T3A": "s-t3a", "X9Z": "s-x9z"}


def report(code, sid, student, stamp="2026-08-10T00:00:00Z", days=None):
    return {"section_id": SEC[code], "section_code": code, "student_id": student,
            "updated_at": stamp, "effort": 4,
            "meeting_days": days if days is not None else [code[0]]}


def sec_scope(code, rows=None):
    """A written section scope, with the fingerprint it would carry right after its own run."""
    return {"section_code": code, "misconception_recommendation": "Open with the free-body diagram.",
            "meta": {"source_fingerprint": _fingerprint(rows or [])}}


def ctx(rows):
    return {"rows": rows}


# An M-day run on a two-track lesson: T has not closed yet. This is the two-run cycle working,
# and it used to raise a yellow warning on roughly half of all nightly runs.
m_rows = [report("M1A", None, 1), report("M3A", None, 2)]
t_rows = [report("T1A", None, 3), report("T3A", None, 4)]
m_written = {"s-m1a": sec_scope("M1A", [m_rows[0]]), "s-m3a": sec_scope("M3A", [m_rows[1]]),
             "instr:1111": {"instructor_name": "Hyra", "readiness_summary": "…"}}
first = _all_scope_state(ctx(m_rows + t_rows), m_written, "M", m_written)
want("a first-track run is waiting on the other track, not failing", first["reason"], "awaiting-track")
want("…and names that track, not its sections", first["tracks"], ["T"])
want("…and reports coverage as incomplete", first["complete"], False)

# The status expression the writer uses. Kept here in one line so the mapping from reason to
# colour is asserted, not just the reason.
def status_for(wrote_all, st):
    return "success" if wrote_all or st["reason"] == "awaiting-track" else "partial"

want("…so it records success, and the banner stays green", status_for(False, first), "success")
want("…and says what it is waiting for, in a sentence",
     _run_summary(m_written, False, first),
     "Aggregated 2 sections (M1A, M3A) and 1 instructor summary. The whole-course summary waits "
     "on the T-day track — normal until that deadline passes.")

# Coverage complete, but a stored scope's cohort moved after its prose was written. Nothing
# resolves this without a person, so it stays yellow — this is the real phys-110 case.
moved = [report("M1A", None, 1, stamp="2026-08-11T21:23:00Z"), m_rows[1]]
stale_stored = {**m_written, "s-t1a": sec_scope("T1A", [t_rows[0]]),
                "s-t3a": sec_scope("T3A", [t_rows[1]])}
t_written = {"s-t1a": stale_stored["s-t1a"], "s-t3a": stale_stored["s-t3a"]}
stale = _all_scope_state(ctx(moved + t_rows), stale_stored, "T", t_written)
want("a stored scope written before its work changed is stale", stale["stale"], ["M1A"])
want("…every section is still covered", stale["complete"], True)
want("…the reason is recorded as stale-prior", stale["reason"], "stale-prior")
want("…and it stays a warning, because only a person can clear it",
     status_for(False, stale), "partial")
want("…naming the section and the remedy",
     _run_summary(t_written, False, stale),
     "Aggregated 2 sections (T1A, T3A). The whole-course summary is still owed: M1A was "
     "aggregated before that work changed, and must be re-run before the course can be summarized.")

# A section that meets on the day just covered and STILL has no scope is a gap in this run, not
# somebody else's work.
gap = _all_scope_state(ctx(m_rows), {"s-m1a": m_written["s-m1a"]}, "M", {"s-m1a": m_written["s-m1a"]})
want("a section of the covered day with no scope is this run's gap", gap["reason"], "sections-missing")
want("…which is a warning", status_for(False, gap), "partial")

# THE GUARD ON THE DOWNGRADE. A section with empty meeting_days is excluded by every day filter,
# so no day-scoped run will ever reach it (pull warns about exactly this). If it were treated as
# "another track's job" the rollup would defer '__all__' forever, silently and in green.
orphan = [report("X9Z", None, 9, days=[])]
never = _all_scope_state(ctx(m_rows + orphan), m_written, "M", m_written)
want("a section with NO meeting day is never another track's job", never["reason"], "sections-missing")
want("…so it is reported, not deferred in silence", status_for(False, never), "partial")
want("…and it is the section named", never["codes"], ["X9Z"])

# Every section covered and current, and the model simply did not send '__all__'.
done = {**m_written, "s-t1a": sec_scope("T1A", [t_rows[0]]), "s-t3a": sec_scope("T3A", [t_rows[1]])}
held = _all_scope_state(ctx(m_rows + t_rows), done, "T", {"s-t1a": done["s-t1a"]})
want("coverage complete and current, no '__all__' → withheld", held["reason"], "withheld")
want("…which is a warning", status_for(False, held), "partial")

# --day is provenance-only on write-analysis and a scheduled run may pass none. The covered track
# is therefore derived from the sections the run WROTE; trusting --day alone would report every
# section of the other track as neglected on any run that omitted the flag.
no_day = _all_scope_state(ctx(m_rows + t_rows), m_written, None, m_written)
want("with no --day, the covered track comes from the sections written", no_day["reason"],
     "awaiting-track")

print("\n=== the audit line never leaks a scope key ===")
# A section scope's key is a uuid; an instructor scope's key is the literal 'instr:<uuid>', which
# resolves to nothing a person can read. Sixteen of those was the original complaint.
many = {SEC[c]: sec_scope(c) for c in ("M1A", "M3A", "T1A", "T3A")}
many["s-5"] = {"section_code": "T5A"}
many.update({f"instr:{u}": {"instructor_name": n}
             for u, n in (("1a7bdeff-4541-4a99-b350-d2f49a53ace9", "Thornton"),
                          ("bed8b760-4d63-40f0-a467-03beabb1c34d", "Hyra"))})
phrase = _scope_phrase(many)
want("more than four sections collapse to a count", phrase,
     "5 sections and 2 instructor summaries")
want("no raw uuid survives into the copy", "instr:" in phrase or "-4541-" in phrase, False)
want("four or fewer are named, which is shorter than counting them",
     _scope_phrase({SEC["M1A"]: sec_scope("M1A"), SEC["M3A"]: sec_scope("M3A")}),
     "2 sections (M1A, M3A)")
want("a whole-course run says so plainly",
     _run_summary({"__all__": {"section_code": "__all__"}}, True, first),
     "Wrote the whole-course summary.")
want("…and mentions the sections when it wrote those too",
     _run_summary({**m_written, "__all__": {"section_code": "__all__"}}, True, first),
     "Aggregated 2 sections (M1A, M3A) and 1 instructor summary, and wrote the whole-course "
     "summary.")

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
for f in fails:
    print("  - " + f)
sys.exit(1 if fails else 0)
