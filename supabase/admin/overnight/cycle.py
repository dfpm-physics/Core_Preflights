"""One night: choose the tracks, then for each run the lesson cycle (grade, then aggregate).

Three modes, from least to most:
  plan    no model call, no write. What would be done, and a token estimate.
  trial   real model calls for N students per track; writes nothing; prints to the console only.
  commit  grade, write (draft grades, never finalized), read back, aggregate, record the runs.
"""
from . import AGG_PROMPT_VERSION, PROMPT_VERSION, RUNNER
from . import grade_run as gr
from . import grounding as grounding_mod
from .aggregate_run import aggregate_track
from .config import Stop
from .llm import LLMError
from . import EXIT_LLM

RUNNING_STALE_HOURS = 3
POISON_RUNS = 3


def _owed_summary(detail, status):
    parts = [f"Graded {detail['graded']} of {detail['students_in_scope']}"]
    if detail["zeroed_non_submitters"]:
        parts.append(f"zeroed {detail['zeroed_non_submitters']} with nothing submitted")
    if detail["skipped_finalized"] or detail["skipped_instructor"]:
        parts.append(f"left {detail['skipped_finalized'] + detail['skipped_instructor']} that a person already handled")
    if detail["failed_students"]:
        parts.append(f"{detail['failed_students']} could not be graded and are left for a person")
    if detail.get("left_for_person_changed_since_read"):
        parts.append(f"{detail['left_for_person_changed_since_read']} changed while it ran and were left for a person")
    if detail["unscored_questions"]:
        parts.append(f"{detail['unscored_questions']} question(s) were left for a person to grade")
    return "; ".join(parts) + "."


def _skip(row, reason, owed=False):
    """A track declined. `owed` marks the declines that need a person (the run exits 10 for them)."""
    return {"slug": row["slug"], "track": row["track"], "status": "skipped", "reason": reason, "owed": owed}


def prepare(rt, store, row):
    """Everything about a track that needs only reads. Returns (ctx, None) or (None, skip dict)."""
    cfg = rt.cfg
    lesson = store.lesson(row["offering_id"], row["slug"])
    track = row["track"]
    if lesson.get("withheld"):
        return None, _skip(row, "the typed side is marked by a person")
    if not lesson.get("written_id"):
        return None, _skip(row, "no typed-response activity to grade")
    if lesson["grading_mode"] != "points":
        return None, _skip(row, f"grading mode is {lesson['grading_mode']}, not points")
    total = sum((q.get("points") or 0) for q in lesson["questions"])
    if total != lesson["points_possible"]:
        return None, _skip(row, f"question points ({total}) do not match points possible ({lesson['points_possible']})", owed=True)
    if not gr.cross_check_deadline(lesson, track, row["due_at"]):
        return None, _skip(row, "deadline-disagreement", owed=True)
    last = store.last_run_statuses(row["offering_id"], track, POISON_RUNS)
    if len(last) == POISON_RUNS and all(s == "failed" for s in last):
        return None, _skip(row, f"the last {POISON_RUNS} runs failed; a person must clear it", owed=True)
    if store.running_recent(row["offering_id"], track, RUNNING_STALE_HOURS):
        return None, _skip(row, "another run on this track started under 3 hours ago")
    now = rt.clock()
    roster = store.roster(row["offering_id"], lesson["course_offering_id"], track, lesson)
    student_ids = sorted({r["student_id"] for r in roster})
    sibs = zns_index(store, roster, lesson, student_ids)
    plan = gr.classify(lesson, track, roster, now, sibs, regrade=getattr(rt, "regrade", False))
    return {"lesson": lesson, "plan": plan, "now": now}, None


def zns_index(store, roster, lesson, student_ids):
    all_enr, sib_subs = store.sibling_data(student_ids, lesson["offering_id"])
    return gr.zns.stranded_index(all_enr, {r["enrollment_id"] for r in roster}, sib_subs)


def estimate_tokens(rt, lesson, plan, grounding):
    per = (len(gr.system_prompt()) + len(gr.lesson_block(lesson, grounding, []))) // 4 + 400 + 700
    return len(plan["to_grade"]) * per


def run_track(rt, store, row, *, commit, trial=0, no_aggregate=False, say=print):
    """Plan, trial or commit one track. Returns a result dict; never raises for a per-track problem."""
    track = row["track"]
    ctx, skip = prepare(rt, store, row)
    if skip:
        return skip
    lesson, plan, now = ctx["lesson"], ctx["plan"], ctx["now"]
    course = lesson["course_code"]
    grounding = grounding_mod.build_grounding(rt.cfg.grounding_root, course, rt.manifest,
                                              lesson.get("reference_pdf"), lesson.get("reference_pages"))
    base = {"slug": row["slug"], "track": track, "course": course,
            "to_grade": len(plan["to_grade"]), "to_zero": len(plan["zero_rows"]),
            "grounding": grounding["state"], "in_scope": plan["in_scope"]}
    if not commit and not trial:
        return {**base, "status": "plan", "estimated_tokens": estimate_tokens(rt, lesson, plan, grounding),
                "waiting": plan["waiting"], "stranded": plan["stranded_skipped"]}
    if not plan["to_grade"] and not plan["zero_rows"] and (row.get("has_analysis") or trial):
        return {**base, "status": "skipped", "reason": "nothing to grade and the track is already aggregated"}

    meta = {"course_offering_id": lesson["course_offering_id"], "offering_id": lesson["offering_id"]}
    run_id = store.run_start(meta, "preflight-analyze", track) if commit else None
    rt.run_id = str(run_id or "trial")
    stats = {"calls0": rt.budget.calls, "tokens0": rt.budget.used}
    bucket = store.taxonomy_bucket(lesson["assignment_id"])
    graded, failed, reason = [], 0, None
    items = plan["to_grade"][:trial] if trial else plan["to_grade"]
    try:
        for n, item in enumerate(items, 1):
            if rt.stop_reason():
                reason = rt.stop_reason()
                break
            try:
                r = gr.grade_student(rt, lesson, grounding, bucket, item, f"S{n}", now, stats=stats)
            except gr.StudentFailed as exc:
                failed += 1
                if str(exc) in ("token-cap", "time-cap"):
                    reason = str(exc)
                    break
                rt.say(f"S{n}: not graded ({exc})")
                continue
            graded.append(r)
            if trial:
                say(f"S{n}: " + ", ".join(f"{k}={c['status']}" for k, c in r["question_scores"].items())
                    + f"; effort={r['diagnostic']['effort']}")
        dup = gr.duplicate_feedback(graded)
        if dup and not trial and not rt.stop_reason():
            by_eid = {g["enrollment_id"]: i for i, g in enumerate(graded)}
            for eid, qid in dup:
                item = next(i for i in items if i["row"]["enrollment_id"] == eid)
                try:
                    graded[by_eid[eid]] = gr.grade_student(rt, lesson, grounding, bucket, item, "dup", now, stats=stats,
                                                           extra_violation=f"{qid}: feedback duplicates another cadet's; "
                                                                           "write wording that fits only this answer")
                except gr.StudentFailed:
                    stats["duplicate_feedback"] = stats.get("duplicate_feedback", 0) + 1
    except (LLMError, Stop) as exc:
        if commit:
            store.run_finish(run_id, "failed", summary="The overnight grader stopped; the AI service was unavailable.",
                             error=str(exc)[:300])
        raise Stop(EXIT_LLM, str(exc)) from exc

    rows = [gr.public_row(g) for g in graded] + plan["zero_rows"]
    merge = {i["row"]["enrollment_id"]: i for i in items if i["mode"] == "merge"}
    unscored = sum(len(g["_unscored"]) for g in graded)
    detail = {"students_in_scope": plan["in_scope"], "graded": len(graded), "missing": plan["waiting"],
              "zeroed_non_submitters": len(plan["zero_rows"]), "skipped_finalized": plan["skipped_finalized"],
              "skipped_instructor": plan["skipped_instructor"], "already_assessed": plan["already_assessed"],
              "filled_questions": sum(len(g["question_scores"]) - len(merge[g["enrollment_id"]]["preserved"])
                                      for g in graded if g["enrollment_id"] in merge),
              "filled_rows": sum(1 for i in items if i["mode"] == "merge"),
              "stranded_skipped": plan["stranded_skipped"], "failed_students": failed,
              "unscored_questions": unscored, "figure_questions_skipped": stats.get("figure_questions", 0),
              "meaningful_disagreements": stats.get("meaningful_disagreements", 0),
              "sections": sorted({r["row"]["section_code"] for r in items if r["row"].get("section_code")}),
              "llm": {"provider": rt.client.name, "grade_model": (rt.models["grade"] or [None])[0],
                      "prompt_version": PROMPT_VERSION, "calls": rt.budget.calls - stats["calls0"],
                      "retries": stats.get("retries", 0), "invalid_outputs": stats.get("invalid_outputs", 0),
                      "tokens": rt.budget.used - stats["tokens0"]},
              "grounding": {"state": grounding["state"], "pdf": grounding["pdf"],
                            "suspect_pages": grounding["suspect_pages"]},
              "runner": RUNNER, **({"stopped": reason} if reason else {})}
    out = {**base, "detail": detail, "reason": reason}
    if trial or not commit:
        return {**out, "status": "trial"}

    refused, problems = [], []
    try:
        if rows:
            refused, problems = store.write_grades(rows, gr.verify_readback)
    except Exception as exc:                          # noqa: BLE001  the transaction is already rolled back
        store.run_finish(run_id, "failed", summary="The overnight grader could not save its drafts.",
                         detail=detail, error=type(exc).__name__)
        return {**out, "status": "failed", "reason": "write-failed"}
    # Rows a person finalized or edited after this run read them: the write skipped them, they are theirs.
    detail["left_for_person_changed_since_read"] = len(refused)
    if problems:
        store.run_finish(run_id, "failed", summary="The overnight grader's drafts did not read back exactly, so none were kept.",
                         detail=detail, error=problems[0][:200])
        return {**out, "status": "failed", "reason": "readback-mismatch"}
    owed = failed or plan["stranded_skipped"] or reason or unscored or refused
    store.run_finish(run_id, "partial" if owed else "success", summary=_owed_summary(detail, "x"), detail=detail)
    result = {**out, "status": "partial" if owed else "success"}

    agg = None
    complete = not failed and not reason
    if no_aggregate:
        result["aggregation"] = {"status": "skipped", "reason": "--no-aggregate"}
    elif not complete:
        result["aggregation"] = {"status": "skipped", "reason": "grading incomplete; aggregation waits for tomorrow"}
    else:
        agg = aggregate_track(rt, store, lesson, track)
        result["aggregation"] = agg
    # the lesson-cycle row, as the skill defines it
    a = result["aggregation"]
    cyc = {"graded": len(graded) + len(plan["zero_rows"]), "graded_students": len(graded),
           "skipped_finalized": plan["skipped_finalized"], "skipped_instructor": plan["skipped_instructor"],
           "filled_questions": detail["filled_questions"], "filled_rows": detail["filled_rows"],
           "scopes_written": a.get("scopes_written", 0), "all_scope": a.get("all_scope", "deferred"),
           "all_scope_reason": a.get("all_scope_reason"), "runner": RUNNER,
           "llm": {**detail["llm"], "aggregate_model": (rt.models["aggregate"] or [None])[0],
                   "aggregate_prompt_version": AGG_PROMPT_VERSION}}
    if a["status"] == "failed":
        cstatus = "failed"
    elif owed or (a["status"] in ("partial", "skipped") and not no_aggregate):
        cstatus = "partial"
    else:
        cstatus = "success"
    cycle_id = store.run_start(meta, "lesson-cycle", track)
    store.run_finish(cycle_id, cstatus, summary=("Graded and summarized this lesson overnight." if cstatus == "success"
                                                 else "The overnight cycle finished with work still owed."),
                     detail=cyc, error=(a.get("reason") if cstatus == "failed" else None))
    result["cycle_status"] = cstatus
    return result
