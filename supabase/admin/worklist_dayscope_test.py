#!/usr/bin/env python
"""Prove `worklist` answers "has this been analyzed?" per DAY TRACK, not per lesson.

The bug this guards against, found 2026-08-07: there is ONE `analysis_reports` row per offering,
holding every track's scopes side by side. `worklist` decided "already analyzed" by counting that
row. So the moment ANY track of a lesson was aggregated, every other track of the same lesson
reported `skip` — permanently. The M sections would be closed out and the T sections silently
never would, with the command reporting success both times.

Nothing here writes. The SQL half evaluates the real predicate over synthetic payloads passed as
parameters, touching no table; the Python half needs no database at all. That matters because the
states worth testing only occur after a deadline, and the alternative to synthesizing them is
waiting for one — which is how this survived to be found by reading.

Runs as the `read` tier.

Usage:
  .venv/Scripts/python supabase/admin/worklist_dayscope_test.py
"""
import inspect
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_tier_check import load, connect                              # noqa: E402
from lesson_aggregate import _pick_latest, cmd_worklist, track_covered_sql   # noqa: E402

PASS, FAIL = "  [pass]", "  [FAIL]"
results = []

M1, M2 = "11111111-1111-1111-1111-111111111111", "11111111-1111-1111-1111-111111111112"
T1, T2 = "22222222-2222-2222-2222-222222222221", "22222222-2222-2222-2222-222222222222"


def check(desc, ok, detail=""):
    results.append(ok)
    print(f"{PASS if ok else FAIL} {desc}" + (f" — {detail}" if detail and not ok else ""))


# ── the SQL predicate ──────────────────────────────────────────────────────────────────
# Not a copy — the same builder cmd_worklist splices into its query, given expressions that read
# from parameters instead of from the tables. A change to the predicate reaches both at once.
COVERED_SQL = "select " + track_covered_sql("%(payload)s::jsonb", "%(section_ids)s::text[]")


def covered(cur, payload, section_ids):
    cur.execute(COVERED_SQL, {"payload": json.dumps(payload), "section_ids": section_ids})
    return cur.fetchone()[0]


def test_sql(cur):
    print("\nSQL predicate — is THIS track represented in the stored payload?")

    # The exact shape after an M-day run: M sections scoped, the instructor scope written, and
    # __all__ withheld because T is still outstanding.
    after_m = {"scopes": {M1: {"section_code": "M1A"}, M2: {"section_code": "M1C"},
                          "instr:33333333-3333-3333-3333-333333333333": {"readiness_summary": "…"}}}

    check("M track reads as covered after the M run", covered(cur, after_m, [M1, M2]) is True)
    check("T track does NOT read as covered after the M run  <- the regression",
          covered(cur, after_m, [T1, T2]) is False)

    after_both = {"scopes": dict(after_m["scopes"], **{T1: {"section_code": "T1A"},
                                                       T2: {"section_code": "T1B"},
                                                       "__all__": {"readiness_summary": "…"}})}
    check("T track reads as covered once the T run lands", covered(cur, after_both, [T1, T2]) is True)
    check("M track still covered after the T run (the merge did not displace it)",
          covered(cur, after_both, [M1, M2]) is True)

    # A run that wrote some of a track's sections and stopped must not count as done, or the
    # missing sections are unrecoverable without someone noticing by eye.
    partial = {"scopes": {M1: {"section_code": "M1A"}}}
    check("a half-written track does NOT read as covered", covered(cur, partial, [M1, M2]) is False)

    check("a row with no scopes key does not read as covered", covered(cur, {}, [M1]) is False)
    check("an empty scopes object does not read as covered",
          covered(cur, {"scopes": {}}, [M1]) is False)

    # __all__ and instr: keys are not section ids and must never satisfy a section track.
    only_course = {"scopes": {"__all__": {"readiness_summary": "…"}}}
    check("a course-wide scope alone does not cover a section track",
          covered(cur, only_course, [M1, M2]) is False)


# ── the --latest tie-break ─────────────────────────────────────────────────────────────
def row(track, due, needs_run, subs):
    return {"track": track, "due_at": due, "needs_run": needs_run, "submissions": subs}


def test_wired():
    """The shipped query must actually use the predicate proven above."""
    print("\nwiring — the query uses the shared predicate, not a private copy")
    src = inspect.getsource(cmd_worklist)
    check("cmd_worklist splices the shared builder at its marker",
          "/*TRACK_COVERED*/" in src
          and 'track_covered_sql("ar.payload", "d.section_ids")' in src)
    check("has_analysis is no longer a bare row count  <- the original bug",
          "and ar.kind = %(kind)s)" not in src)
    check("the track's section ids are collected for it to test",
          "array_agg(distinct sd.section_id::text)" in src)
    check("tied deadlines get a deterministic order before --latest sees them",
          "order by d.due_at desc, a.slug, d.track" in src)
    # sec_due claims to mirror schema.js effectiveDue(), which has had FOUR tiers since migration
    # 017. It carried three until 2026-08-07, silently dropping the per-day schedule — so a
    # section created after its lesson was saved resolved to the offering default (the M date) and
    # read a day early. That is the exact bug 017 exists to fix, reproduced inside the tool that
    # reports on it. Today every section has an explicit row so nothing differs; this guards the
    # next late-created section rather than anything currently visible.
    check("sec_due folds in the per-day schedule (effectiveDue tier 3)",
          "due_by_day ->> md.day" in src and "with ordinality" in src)


def test_pick_latest():
    print("\n--latest — which single track gets reported")

    # phys-110's real shape: no per-day dates, so M and T close at the same instant.
    tied_m_done = [row("M", 100, False, 39), row("T", 100, True, 39)]
    check("with two tracks tied on deadline, picks the one still needing a run",
          _pick_latest(tied_m_done)["track"] == "T")

    check("order within the tie does not decide it",
          _pick_latest(list(reversed(tied_m_done)))["track"] == "T")

    # phys-215's shape: tracks a day apart. The newest must win outright.
    staggered = [row("T", 200, True, 36), row("M", 100, True, 36)]
    check("with staggered deadlines, still takes the newest only",
          _pick_latest(staggered)["track"] == "T")

    check("never reaches past the newest deadline for work, even when the newest is done",
          _pick_latest([row("T", 200, False, 36), row("M", 100, True, 36)])["track"] == "T")

    both_done = [row("M", 100, False, 39), row("T", 100, False, 39)]
    check("when every tied track is done, still returns one so a skip can be reported",
          _pick_latest(both_done)["due_at"] == 100)

    empty_needs_run = [row("M", 100, True, 0), row("T", 100, False, 39)]
    check("a needs-run track with no submissions is still reported (so it says why)",
          _pick_latest(empty_needs_run)["track"] == "M")

    prefer_runnable = [row("M", 100, True, 0), row("T", 100, True, 39)]
    check("a runnable track outranks an empty one",
          _pick_latest(prefer_runnable)["track"] == "T")


def main():
    cfg, tiers = load()
    if "read" not in tiers:
        sys.exit("No PREP_APP_READ_ROLE in supabase/admin/.env — see docs/operations/MACHINE-SETUP.md")
    conn = connect(cfg, tiers["read"])
    cur = conn.cursor()
    try:
        test_sql(cur)
    finally:
        cur.close()
        conn.close()
    test_wired()
    test_pick_latest()

    ok = all(results)
    print("\n" + (f"All {len(results)} checks passed — worklist is day-scoped."
                  if ok else "FAILED — worklist may skip a day track that was never analyzed."))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
