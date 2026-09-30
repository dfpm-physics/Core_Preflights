#!/usr/bin/env python3
"""Convert no-submission ZEROS to full credit for a range of lessons, as a course-director waiver.

WHY THIS EXISTS
    `zero_non_submitters.py` writes an honest zero for a cadet who handed nothing in. That is the
    right default, and it stays the default. But a zero is only honest when the cadet could
    actually have submitted -- and sometimes they could not. When the platform itself was the
    reason (a lesson that was never registered, a submit path that was broken, a release window
    that never opened), the zero records a cadet's failure where the system's belongs.

    This script is the reverse operation for exactly that case. It is a DIRECTOR'S DECISION, never
    an inference: it waives nothing on its own and does nothing without `--course` and `--through`
    naming the affected range explicitly.

    First use: phys-310, lessons 01-10, Fall 2026 (course director's instruction 2026-09-30 --
    "there were issues with the system up to that point").

WHAT IT WRITES  -- the shape a director produces by hand in site/faculty/grade.html, copied exactly
    points_earned  -> points_possible
    effort         -> LEFT NULL, deliberately. `app.grades_points_from_effort` (migration 019)
                      returns early on a NULL effort and leaves points_earned alone; setting an
                      effort here would hand the number to the trigger instead, and on an
                      effort-graded offering a later re-save would recompute it. Every full-credit
                      row the director has made by hand carries effort NULL and a literal
                      points_earned, and those rows have been stable since August.
    question_scores-> every points-bearing question to full/score=max/feedback "" so nothing still
                      reads "No submission received." A zero-point question (q1) keeps score 0 /
                      max 0. An EMPTY map stays empty -- an interactive-only offering has no
                      written question set and inventing one would be a lie.
    source         -> 'instructor'   (it IS a human's decision; also makes zero_non_submitters.py
                                      condition 5 refuse to touch the row ever again)
    is_finalized   -> true           (matches the rest of the column, which is already published;
                                      an unfinalized waiver is invisible to the cadet it is for)
    graded_by      -> --by <instructor uuid>
    diagnostic     -> UNCHANGED except: effort -> 3, and an `effort_override` block recording
                      {from, to, by, at, rule: 'finalized-full-credit'}. `no_submission: true`
                      STAYS. The record that they submitted nothing is the truth and survives the
                      waiver; what changes is the consequence, and who decided it.
                      Same rule string as `confirmEffortRows` in site/js/faculty-grade.js and
                      `raise_confirmed_effort.py`, so all three remain one decision.

WHO IS IN SCOPE  (all four, or the row is not touched)
    1. ACTIVE enrollment. A dropped cadet's grade is not the course's business and is reported,
       not rewritten.
    2. `diagnostic.no_submission = true` -- the marker zero_non_submitters.py writes. This is the
       only way to be sure a 0 means "handed nothing in" rather than "handed in, earned nothing".
    3. points_earned = 0. A row already carrying credit is left exactly as it is.
    4. the lesson's number is <= --through.

SAFETY
    Read-only unless `--commit` (CORE.md §4). Snapshots every targeted row's full before-state to
    JSON and verifies the snapshot row count against live before writing a thing. Idempotent: a
    row already waived carries `effort_override.rule = 'finalized-full-credit'` at full points and
    is reported as already-waived rather than rewritten.

Usage:
  python scripts/fall2026/credit_waiver.py --course phys-310 --through 10 \
      --by a648bbe6-7aa0-4c41-aa51-ae6401866628
  python scripts/fall2026/credit_waiver.py --course phys-310 --through 10 --by <uuid> --commit
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402

RULE = "finalized-full-credit"


def lesson_number(slug):
    """'lesson-07' -> 7, 'preflight-12' -> 12. None when the slug carries no number."""
    m = re.search(r"(\d+)\s*$", slug or "")
    return int(m.group(1)) if m else None


def jsonable(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True, help="course code, e.g. phys-310")
    ap.add_argument("--through", required=True, type=int,
                    help="highest lesson NUMBER to waive, inclusive (e.g. 10)")
    ap.add_argument("--by", required=True, help="instructor uuid recorded as graded_by / override by")
    ap.add_argument("--snapshot", default=None, help="where to write the before-state JSON")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = ap.parse_args()

    cfg, tiers = load()
    tier = "dml" if args.commit else ("read" if "read" in tiers else "dml")
    if tier not in tiers:
        sys.exit(f"No PREP_APP_{tier.upper()}_ROLE / _PASSWORD in supabase/admin/.env")
    conn = connect(cfg, tiers[tier])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("set search_path = app")

    cur.execute("""
    select a.slug, ao.id, ao.points_possible, ao.grading_mode,
           g.id, g.enrollment_id, e.student_id, e.status,
           g.points_earned, g.effort, g.question_scores, g.diagnostic,
           g.source, g.is_finalized, g.graded_by, g.submission_id,
           (select aw.content from offering_activities oa
              join activities aw on aw.id = oa.activity_id and aw.modality = 'written'
             where oa.assignment_offering_id = ao.id limit 1)
      from grades g
      join enrollments e on e.id = g.enrollment_id
      join assignment_offerings ao on ao.id = g.assignment_offering_id
      join assignments a on a.id = ao.assignment_id
      join course_offerings co on co.id = ao.course_offering_id
      join courses cs on cs.id = co.course_id
     where cs.code = %s
       and coalesce((g.diagnostic->>'no_submission')::boolean, false)
     order by a.slug, e.student_id""", (args.course,))
    rows = cur.fetchall()
    if not rows:
        sys.exit(f"No no-submission grade rows at all for {args.course}. Nothing to do.")

    targets, skipped = [], {"out_of_range": [], "dropped": [], "has_credit": [], "already": []}
    for r in rows:
        (slug, off, pp, mode, gid, enr, sid, status, pe, effort, qs, diag,
         src, fin, gby, subid, written) = r
        n = lesson_number(slug)
        if n is None or n > args.through:
            skipped["out_of_range"].append((slug, sid)); continue
        if status != "active":
            skipped["dropped"].append((slug, sid, status)); continue
        already = (float(pe or 0) == float(pp)
                   and ((diag or {}).get("effort_override") or {}).get("rule") == RULE)
        if already:
            skipped["already"].append((slug, sid)); continue
        if float(pe or 0) > 0:
            skipped["has_credit"].append((slug, sid, float(pe), src, fin)); continue
        targets.append(dict(slug=slug, offering=off, points_possible=float(pp), mode=mode,
                            grade_id=gid, enrollment_id=enr, student_id=sid,
                            points_earned=float(pe or 0), effort=effort,
                            question_scores=qs or {}, diagnostic=diag or {},
                            source=src, is_finalized=fin, graded_by=gby,
                            submission_id=subid,
                            written_questions=((written or {}).get("questions") or [])))

    print(f"{args.course}: {len(rows)} no-submission row(s) seen, "
          f"{len(targets)} in scope for a waiver through lesson {args.through}\n")
    for k, label in (("out_of_range", "outside the lesson range"),
                     ("dropped", "dropped enrollment -- left alone"),
                     ("has_credit", "already carries credit -- left alone"),
                     ("already", "already waived by this script -- idempotent skip")):
        v = skipped[k]
        if v:
            print(f"  skipped, {label}: {len(v)}")
            for x in v:
                print(f"     {x}")
    if skipped["out_of_range"] or skipped["dropped"] or skipped["has_credit"] or skipped["already"]:
        print()

    if not targets:
        print("Nothing to write.")
        conn.close(); return

    # ---- snapshot BEFORE anything is written, and verify it against live ------------------
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # `_snapshots/` is the repo-wide gitignore pattern for pre-change safety artifacts.
    # It must stay underscore-prefixed or the snapshot lands in a commit.
    snap_path = Path(args.snapshot or Path(__file__).resolve().parent /
                     "_snapshots" / f"credit_waiver_{args.course}_{stamp}.json")
    snap_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot = {"taken_at": datetime.now(timezone.utc).isoformat(), "course": args.course,
                "through_lesson": args.through, "rows": targets}
    snap_path.write_text(json.dumps(snapshot, indent=1, default=jsonable), encoding="utf-8")
    ids = [t["grade_id"] for t in targets]
    cur.execute("select count(*) from grades where id = any(%s::uuid[]) and points_earned = 0", (ids,))
    live_zero = cur.fetchone()[0]
    print(f"snapshot -> {snap_path}  ({len(targets)} row(s))")
    print(f"snapshot check: {live_zero} of {len(targets)} still at zero live")
    if live_zero != len(targets):
        sys.exit("ABORT: snapshot does not match live. Re-run and look before writing.")
    print()

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    plan = []
    for t in targets:
        pp = t["points_possible"]
        qmax = {q["id"]: float(q.get("points") or 0) for q in t["written_questions"]}
        qs = {}
        for qid, old in (t["question_scores"] or {}).items():
            mx = qmax.get(qid, float(old.get("max") or 0))
            qs[qid] = {"max": mx, "score": mx, "status": "full" if mx > 0 else "zero",
                       "feedback": ""}
        d = dict(t["diagnostic"])
        frm = d.get("effort")
        d["effort"] = 3
        d["effort_override"] = {"from": frm, "to": 3, "by": args.by, "at": now, "rule": RULE}
        qsum = sum(v["max"] for v in qs.values())
        note = "" if (not qs or abs(qsum - pp) < 1e-9) else \
               f"  [note: written set sums to {qsum:g} against points_possible {pp:g}]"
        plan.append((t, qs, d))
        print(f"  {t['slug']:10} {t['student_id']}  {t['points_earned']:g} -> {pp:g}  "
              f"finalized {t['is_finalized']} -> True  source {t['source']} -> instructor  "
              f"qs {len(qs) or '{}'}{note}")

    print()
    if not args.commit:
        print(f"DRY RUN -- nothing written. {len(plan)} row(s) would change. "
              f"Re-run with --commit.")
        conn.rollback(); conn.close(); return

    for t, qs, d in plan:
        cur.execute("""
        update grades
           set points_earned = points_possible,
               question_scores = %s::jsonb,
               diagnostic = %s::jsonb,
               source = 'instructor',
               is_finalized = true,
               graded_by = %s::uuid,
               graded_at = now()
         where id = %s and points_earned = 0""",
                    (json.dumps(qs), json.dumps(d), args.by, t["grade_id"]))
        if cur.rowcount != 1:
            conn.rollback()
            sys.exit(f"ABORT: grade {t['grade_id']} matched {cur.rowcount} row(s), expected 1. "
                     f"Nothing committed.")
    conn.commit()
    print(f"Committed. {len(plan)} row(s) waived to full credit.")

    cur.execute("""select count(*) from grades
                    where id = any(%s::uuid[]) and points_earned = points_possible
                      and is_finalized and source = 'instructor'""", (ids,))
    print(f"read-back: {cur.fetchone()[0]} of {len(ids)} now at full credit, finalized, instructor")
    conn.close()


if __name__ == "__main__":
    main()
