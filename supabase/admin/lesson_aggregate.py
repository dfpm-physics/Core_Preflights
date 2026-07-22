#!/usr/bin/env python
"""lesson_aggregate.py — DB I/O for the `/lesson-aggregate` skill (schema `app`).

Connects to Supabase as the scoped `prep_app_dml` role (supabase/admin/.env, read through
app_tier_check) and produces the COHORT analysis that fills the faculty lesson rollup's three
AI panels — readiness summary, misconception trends, and 2-3 AI-picked reading-reflection quotes
— per section AND for the whole course. Output lands in `app.analysis_reports`. Distinct from
interaction_reports.py, which fills per-student structured content.

Subcommands:

  pull --lesson S [--day D] --out FILE Dump everything the model needs to write the analysis:
                                       per-section scopes + a whole-course '__all__' scope, each
                                       with a PRECOMPUTED numeric summary (a focused port of the
                                       UI's summarizeReports, so the prose cites the same figures
                                       the bars show) and the per-report free-text fields the AI
                                       reads (reflection text, graded concept answers, misconception
                                       descriptions/evidence, objectives). No names, no
                                       report_markdown. With --day, only that day's sections get a
                                       full scope; the rest arrive as `prior_scopes` (stored prose
                                       + fresh numbers, no reports) so the course synthesis can
                                       fold them in without re-reading their cohort.

  write-analysis --in FILE [--dry-run] Merge model-written scopes into the offering's
                                       analysis_reports row. The writer re-derives meta.n +
                                       meta.source_fingerprint from the live rows (authoritative),
                                       resolves section codes to ids, validates that every quote
                                       references a real report IN THAT section, enforces "no
                                       quotes on the '__all__' scope", and caps
                                       misconception_recommendation to one short paragraph.
                                       --dry-run commits nothing.

  status [--lesson S] [--day D]        List existing analysis scopes with n, quote count, whether
                                       a recommendation is present, and a STALE flag (stored
                                       fingerprint vs. recomputed from current reports).

THE TWO-RUN CYCLE (why --day exists)
  The lesson is graded and aggregated after each day track's deadline: run once when M closes,
  again when T closes. The second run must not re-aggregate M, so --day scopes which sections get
  a full pass. Sections aggregate FIRST; the whole-course scope is then synthesized from those
  section scopes plus the current run's, never by re-reading every student.

  But '__all__' NUMBERS are always recomputed over every live row, never recombined from sections.
  Counts and histograms would sum exactly; reading.median cannot be recovered from stored medians,
  and every mean here is round(…, 2), so recombining rounded section means drifts invisibly.
  The browser recomputes the same figures from raw rows for its All-sections bars, and prose that
  disagrees with the bar beside it is a bug (ROLLUP-AGREEMENT §8). Only PROSE reuses prior scopes.

  '__all__' is therefore written only when every section is represented — this run or a stored one.
  `pull` reports that as coverage.complete and refuses to pretend otherwise: a whole-course prose
  covering half the course, with numbers covering all of it, renders in the UI as fresh and
  authoritative because meta.n would match. Between the two runs, `status` shows '__all__' STALE.
  That is the feature, not a fault — it is the signal the second pass is owed.

WHERE THE DATA LIVES NOW (PREP v2 — schema `app`)

    interactions                  -> activities WHERE modality = 'interactive'
                                     (activities.slug is the old interactions.id verbatim)
    preflight_interaction_reports -> submission_activities.content, via submissions
    ...effort / score             -> grades.effort / grades.points_earned
    students.section_id           -> enrollments (student_id, section_id); sections.id is a uuid
    interaction_analysis          -> analysis_reports

WHY THE PER-SECTION ROWS BECAME ONE ROW WITH SCOPES INSIDE IT
  `interaction_analysis` was keyed (interaction_id, section_id) — one row per section, plus an
  '__all__' sentinel row. `analysis_reports` is keyed
  UNIQUE (scope, scope_id, audience_id, kind). Storing a section rollup as
  scope='section', scope_id=<section uuid> would make the SAME section collide across every
  lesson, because the key carries no lesson. So a lesson's cohort analysis is ONE row —
  scope='assignment_offering', scope_id=<offering uuid>, audience_id=NULL, kind='readiness' —
  whose payload.scopes is keyed by section uuid, plus the '__all__' key for the whole course.
  Per-scope independence is preserved by MERGING: a run that writes two scopes leaves the other
  scopes in the row untouched, so an M-day run and a T-day run still never collide.

Safety / scope:
  * Reads report data; writes ONLY analysis_reports. NEVER touches grades (effort/points) or
    submission_activities.content — those are the backfill skill's domain. No DDL.
  * The '__all__' scope carries numbers only (no per-report list, no quotes): whole-course prose
    is synthesized from the per-section reports the model already read.
  * Re-derives n + fingerprint server-side so they can't drift from what was actually aggregated.

All file/stdout I/O is UTF-8 (reflections contain emoji). Run from repo root via the project venv.

Examples:
  .venv/Scripts/python supabase/admin/lesson_aggregate.py pull \
      --activity lesson-02-electric-charge-coulombs-law --out <scratch>/agg.json
  .venv/Scripts/python supabase/admin/lesson_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
  .venv/Scripts/python supabase/admin/lesson_aggregate.py write-analysis --in <scratch>/filled.json
  .venv/Scripts/python supabase/admin/lesson_aggregate.py status --activity lesson-02-electric-charge-coulombs-law
"""
import argparse
import hashlib
import io
import json
import re
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

# Force UTF-8 so emoji in reflections never crash printing on Windows (cp1252).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_tier_check import load, connect  # noqa: E402

ALL = "__all__"                 # whole-course sentinel key inside payload.scopes
INSTR = "instr:"                # instructor-scope key prefix inside payload.scopes
KIND = "readiness"              # analysis_reports.kind this skill owns (ROLLUP-AGREEMENT §6)
SCOPE = "assignment_offering"
MAX_PROSE = 8000                # ROLLUP-AGREEMENT §7
MAX_QUOTES = 5                  # expect exactly 3; a hard ceiling so a bad run can't flood the row
# The recommendation gets its OWN cap, deliberately not MAX_PROSE. The UI renders it as a single
# line; reusing an 8000-char limit invites a second essay in that slot.
MAX_RECO = 1200                 # ROLLUP-AGREEMENT §7
# The readiness summary moved to instructor scope on 2026-07-22 and was cut to 2-3 sentences at the
# same time. 1200 matches the recommendation: enough for three real sentences, not enough for the
# multi-paragraph essay the 8000 cap invited. Per-section departures are separate `section_notes`,
# so length pressure has somewhere structured to go instead of inflating the summary.
MAX_SUMMARY = 1200
MAX_NOTE = 400                  # one per-section departure line
MAX_NOTES = 12                  # a note per section an instructor teaches, with headroom
MAX_ALIASES = 200               # misconception variant -> canonical, offering-wide
# Per-answer truncation for the graded free-response text lifted into the pull file. Long enough
# for a full preflight answer, short enough that a 20-section course does not blow the context.
MAX_ANSWER = 1500


def _connect():
    """THE one place the schema is selected.

    psycopg2 has no PostgREST profile header, so the equivalent single switch is the
    search_path set on the session here. Every query below is unqualified and resolves inside
    `app`; nothing in this file can reach `public` by accident.

    Uses the DML tier from supabase/admin/.env — NOT the legacy claude_code_recker credential
    in config.json, which only ever had rights in `public`.
    """
    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No PREP_APP_DML_ROLE / _PASSWORD in supabase/admin/.env — see app_schema_bootstrap.sql.")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app")
    cur.close()
    return conn


# ── Coercion, mirroring site/app/js/faculty-interactions.js (contract §7) ─────────────────
# Structured content is LLM-produced and occasionally imperfect: keep only valid 0–5 ints;
# everything else becomes None and drops out of means (null ≠ 0, contract §5.1).
def _int05(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 5 else None

def _num(v):
    return float(v) if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool) else None

def _median(xs):
    """Median, or None. Used for reading minutes, where a mean would be distorted by the tail."""
    a = sorted(x for x in xs if x is not None)
    if not a:
        return None
    mid = len(a) // 2
    return a[mid] if len(a) % 2 else (a[mid - 1] + a[mid]) / 2


def _mean(xs):
    a = [n for n in xs if n is not None]
    return round(sum(a) / len(a), 2) if a else None

def _meets(meeting_days, day):
    """Does a section meet on `day`? Pure, so it is testable without a database.

    `sections.meeting_days` is a `text[]` (001_core_model.sql) — `{'M'}`, `{'T'}`, `{'M','W','F'}`.
    A section with an empty array meets on no named day and is therefore excluded by ANY day
    filter; `pull` warns when that excludes anyone. A section listing both days is aggregated on
    both runs, which is correct but worth telling the operator about.

    `day=None` means "no filter" and matches everything.
    """
    if not day:
        return True
    days = meeting_days if isinstance(meeting_days, (list, tuple)) else []
    return str(day).strip().upper() in {str(d).strip().upper() for d in days}


def _answer(written_content, qid):
    """One student's answer to one written question, trimmed and capped, or None.

    Two stored shapes have existed: `{answers: {q1: …}}` and a flat `{q1: …}`. Both are handled
    here rather than inline in the DB loader so the branch is unit-testable.
    """
    if not qid or not isinstance(written_content, dict):
        return None
    answers = written_content.get("answers")
    answers = answers if isinstance(answers, dict) else written_content
    val = answers.get(qid)
    if not isinstance(val, str) or not val.strip():
        return None
    val = val.strip()
    return val if len(val) <= MAX_ANSWER else val[:MAX_ANSWER] + "…"


def _points_for_effort(e, pp):
    """Mirrors app.grades_points_from_effort() / schema.js pointsFromEffort()."""
    if e is None:
        return 0.0
    if e >= 3:
        return float(pp)
    if e >= 1:
        return round(float(pp) / 2, 2)
    return 0.0


def summarize(rows, points_possible):
    """Numeric-only rollup over one scope's reports — a focused port of summarizeReports().

    `rows` are dicts with keys: effort, points_earned, report_data (dict). Returns the aggregates
    the readiness/misconception prose cites, so the narrative agrees with the UI's live bars.

    Scaled by the offering's points_possible rather than the old hardcoded 0–2, because in `app`
    a lesson's value is per-offering data, not a constant baked into a trigger.
    """
    pp = float(points_possible or 0)
    items = []
    for r in rows:
        d = r.get("report_data")
        items.append({
            "effort": _int05(r.get("effort")),
            "q2_effort": _int05(r.get("q2_effort")),
            "q3": _int05(r.get("q3_understanding")),
            "path": r.get("path") or ("interactive" if isinstance(d, dict) else "written"),
            "points": _num(r.get("points_earned")),
            "qs": r.get("question_scores") if isinstance(r.get("question_scores"), dict) else {},
            "d": d if isinstance(d, dict) else {},
        })
    n = len(items)

    # ── Per-question outcome tallies (WRITTEN PATH ONLY).
    #
    # This exists so the readiness prose can CITE "23/32 received full credit on Q3" instead of
    # hand-counting across the report rows. At n > 20 a hand count is wrong often enough that the
    # prose would disagree with itself, and the grounding rule (ROLLUP-AGREEMENT §8) treats that
    # as a bug.
    #
    # Deliberate divergence from summarizeReports(): this block is Python-only. It is pull-only
    # prose material, and since the By-question UI panel was deleted there is no browser panel it
    # could disagree with. aggregate_summarize_test.py pins that intent so nobody "fixes" it by
    # porting or deleting it.
    #
    # `{}` for a cohort with no question_scores at all — an EMPTY DICT, never a dict of zeros.
    # The skill gates its whole question subsection on this being empty, so a dict of zeros would
    # make an interactive-only lesson look like a question set everyone failed.
    questions = {}
    for it in items:
        for qid, qs in (it["qs"] or {}).items():
            if not isinstance(qs, dict):
                continue
            q = questions.setdefault(qid, {"n": 0, "full": 0, "warn": 0, "zero": 0,
                                           "ungraded": 0, "points": [], "max": None})
            q["n"] += 1
            status = qs.get("status")
            if status in ("full", "warn", "zero"):
                q[status] += 1
            else:
                q["ungraded"] += 1          # null status is "not yet graded", never "scored 0"
            pts, mx = _num(qs.get("score")), _num(qs.get("max"))
            if pts is not None:
                q["points"].append(pts)
            if mx is not None:
                q["max"] = mx
    for q in questions.values():
        q["points_avg"] = _mean(q.pop("points"))
        q["points_max"] = q.pop("max")

    # How this cohort worked the lesson. Every figure below is only interpretable against it —
    # "avg effort 3.8" means something different for 40 artifacts, 40 question sets, or a split.
    # A student who did both counts in each, so these do not sum to n.
    paths = {"interactive": 0, "written": 0, "both": 0}
    for it in items:
        if it["path"] in paths:
            paths[it["path"]] += 1
    paths["interactive_n"] = paths["interactive"] + paths["both"]
    paths["written_n"] = paths["written"] + paths["both"]
    paths["mixed"] = paths["interactive_n"] > 0 and paths["written_n"] > 0

    # Effort — ONE distribution across both paths. Q2 of a written preflight is the same reading
    # reflection the artifact scores, on the same rubric, so these are one population. Precedence
    # mirrors schema.js effortSignal(): grade -> whole-attempt assessment -> reflection-only.
    effort_hist = [0, 0, 0, 0, 0, 0]
    effort_na = 0
    efforts, points = [], []
    for it in items:
        e = it["effort"]
        if e is None:
            e = _int05(it["d"].get("effort"))
        if e is None:
            e = it["q2_effort"]
        if e is None:
            effort_na += 1
        else:
            effort_hist[e] += 1
            efforts.append(e)
        points.append(it["points"] if it["points"] is not None else _points_for_effort(e, pp))

    # Reading time (DIAGNOSTIC) — Q1, worth 0 points, anonymous to instructors, and until
    # 2026-07-21 never rolled up at all. /preflight-analyze parses the prose to whole minutes.
    # Median + buckets, never a mean: self-reported durations have a long tail and one three-hour
    # reader would drag a mean somewhere no student sits. Mirrors READING_BUCKETS in schema.js.
    reading_vals = []
    reading_not_stated = 0
    for it in items:
        m = it["d"].get("reading_minutes")
        m = round(m) if isinstance(m, (int, float)) and not isinstance(m, bool) and 0 < m < 1440 else None
        if m is not None:
            reading_vals.append(m)
        elif it["d"] and it["path"] in ("written", "both"):
            # Assessed, worked the question set, named no duration. Only the written path can
            # withhold a duration — Q1 does not exist on the interactive path, so counting an
            # artifact taker here would manufacture a refusal out of an unasked question.
            reading_not_stated += 1
    reading_buckets = [
        {"key": k, "label": lbl, "min": lo, "max": (None if hi == float("inf") else hi),
         "count": sum(1 for m in reading_vals if lo <= m < hi)}
        for k, lbl, lo, hi in (("lt15", "<15m", 0, 15), ("m15_29", "15-29m", 15, 30),
                               ("m30_44", "30-44m", 30, 45), ("m45_59", "45-59m", 45, 60),
                               ("gte60", "60m+", 60, float("inf")))
    ]

    completed = sum(1 for it in items if it["d"].get("completed") is True)
    durations = [it["d"].get("duration_min") for it in items
                 if isinstance(it["d"].get("duration_min"), (int, float))
                 and not isinstance(it["d"].get("duration_min"), bool)]
    messages = [it["d"].get("message_count") for it in items
                if isinstance(it["d"].get("message_count"), int)
                and not isinstance(it["d"].get("message_count"), bool)]

    # Understanding — the holistic read, falling back to the written free-response score for a
    # student who has no holistic one. Without the fallback a question-only cohort reports no
    # understanding at all. `from` records the split so prose never implies the two measures are
    # the same instrument; it is keyed on the PATH taken, not on which field supplied the number.
    overall = [(_int05(it["d"].get("overall_understanding"))
                if _int05(it["d"].get("overall_understanding")) is not None else it["q3"])
               for it in items]
    self_rated = [_int05(it["d"].get("self_rated_understanding")) for it in items]
    overall_hist = [0, 0, 0, 0, 0, 0]
    for u in overall:
        if u is not None:
            overall_hist[u] += 1
    und_from = {"interactive": 0, "written": 0}
    for it, u in zip(items, overall):
        if u is None:
            continue
        und_from["written" if it["path"] == "written" else "interactive"] += 1

    # Objectives — group by key, mean understanding/confidence, carry inline label.
    obj = {}
    for it in items:
        for o in (it["d"].get("objectives") or []):
            if not isinstance(o, dict) or not o.get("key"):
                continue
            m = obj.setdefault(o["key"], {"key": o["key"], "label": o.get("label") or o["key"], "u": [], "c": []})
            if (not m["label"] or m["label"] == m["key"]) and o.get("label"):
                m["label"] = o["label"]
            u = _int05(o.get("understanding"))
            if u is not None:
                m["u"].append(u)
            c = _int05(o.get("confidence"))
            if c is not None:
                m["c"].append(c)
    objectives = [{"key": m["key"], "label": m["label"], "assessed": len(m["u"]),
                   "understanding": _mean(m["u"]), "confidence": _mean(m["c"]),
                   "source": "interactive"} for m in obj.values()]

    # The written path's contribution: ONE synthetic objective. The free-response question
    # measures understanding on the same 0-5 scale, so it belongs in the same breakdown — but it
    # does NOT decompose, so it appears as a single item rather than being spread across the
    # authored objectives. Matches FREE_RESPONSE_KEY in site/app/js/schema.js.
    fr = [it["q3"] for it in items if it["q3"] is not None]
    if fr:
        objectives.append({"key": "__free_response__", "label": "Free response",
                           "assessed": len(fr), "understanding": _mean(fr), "confidence": None,
                           "source": "written"})
    objectives = sorted(
        objectives,
        key=lambda x: (x["understanding"] if x["understanding"] is not None else 99),  # weakest first
    )

    # Misconceptions — counted by CANONICAL id, carrying description and a couple of examples.
    #
    # MUST match canonMisconceptionId() in site/app/js/faculty-rollup.js. Both producers may coin
    # ids (contract §5.4) and both counting sites key on the string, so `scalar-sum`, `Scalar-Sum`
    # and `scalar sum` used to be three separate entries here and three separate bars in the
    # browser. If these two normalizers ever disagree, the prose cites a prevalence the panel
    # beside it does not show.
    #
    # The alias fold (variant -> canonical) is NOT applied here: it is what the model produces THIS
    # run, so applying it to the run's own inputs would hide from the model exactly the variants it
    # is being asked to reconcile. The browser applies it at render time, after it is stored.
    mc = {}
    for it in items:
        for m in (it["d"].get("misconceptions") or []):
            if not isinstance(m, dict) or not m.get("id"):
                continue
            mid = re.sub(r"\s+", "-", str(m["id"]).strip().lower())
            if not mid:
                continue
            e = mc.setdefault(mid, {"id": mid, "label": m.get("label") or mid, "count": 0,
                                    "major": 0, "description": "", "examples": [], "variants": []})
            if (not e["label"] or e["label"] == e["id"]) and m.get("label"):
                e["label"] = m["label"]
            # Longest description wins — deterministic, and the fuller one is the better glossary
            # entry. Matches the browser's rule exactly.
            desc = str(m.get("description") or "").strip()
            if len(desc) > len(e["description"]):
                e["description"] = desc
            ev = str(m.get("evidence") or "").strip()
            if ev and len(e["examples"]) < 2 and ev not in e["examples"]:
                e["examples"].append(ev)
            # A "variant" means a genuinely DIFFERENT id that folded onto this one, not the same id
            # cased or spaced differently. Compare the fully-normalized form: `Scalar-Sum` and
            # `scalar sum` both normalize to `scalar-sum` and are the same id, so reporting them
            # would be noise in the popover.
            raw = str(m.get("id") or "").strip()
            if raw and re.sub(r"\s+", "-", raw.lower()) != mid and raw not in e["variants"]:
                e["variants"].append(raw)
            e["count"] += 1
            if m.get("severity") == "major":
                e["major"] += 1
    misconceptions = sorted(mc.values(), key=lambda x: (-x["count"], -x["major"]))
    for m in misconceptions:
        m["prevalence_pct"] = round(m["count"] / n * 100) if n else 0

    # Reading reflection (+ the effort gate) and integrity / triage flags.
    refl_meaningful = refl_assessed = 0
    refl_eng = []
    sentiment = {"positive": 0, "neutral": 0, "negative": 0, "mixed": 0}
    topic_map = defaultdict(int)
    honor = {"none": 0, "disclosed": 0, "concern": 0}
    flags = {"needs_follow_up": 0, "notable": 0}
    for it in items:
        d = it["d"]
        r = d.get("reading_reflection")
        if isinstance(r, dict):
            if isinstance(r.get("meaningful"), bool):
                refl_assessed += 1
                if r["meaningful"]:
                    refl_meaningful += 1
            e = _int05(r.get("engagement"))
            if e is not None:
                refl_eng.append(e)
            if r.get("sentiment") in sentiment:
                sentiment[r["sentiment"]] += 1
            for t in (r.get("topics") or []):
                k = str(t or "").strip().lower()
                if k:
                    topic_map[k] += 1
        if isinstance(d.get("honor"), dict) and d["honor"].get("status") in honor:
            honor[d["honor"]["status"]] += 1
        if isinstance(d.get("flags"), dict):
            if d["flags"].get("needs_follow_up") is True:
                flags["needs_follow_up"] += 1
            if d["flags"].get("notable") is True:
                flags["notable"] += 1
    topics = sorted(({"topic": t, "count": c} for t, c in topic_map.items()), key=lambda x: -x["count"])

    return {
        "n": n,
        "paths": paths,
        "effort": {"hist": effort_hist, "not_assessed": effort_na, "avg": _mean(efforts),
                   "points_total": round(sum(points), 2), "points_max": round(n * pp, 2)},
        "completed": completed, "completed_pct": round(completed / n * 100) if n else 0,
        "duration_avg": _mean(durations), "message_avg": _mean(messages),
        "reading": {"median": _median(reading_vals), "assessed": len(reading_vals),
                    "not_stated": reading_not_stated, "buckets": reading_buckets,
                    "min": min(reading_vals) if reading_vals else None,
                    "max": max(reading_vals) if reading_vals else None},
        "understanding": {"overall": _mean(overall), "self": _mean(self_rated), "dist": overall_hist,
                          "gap": (round(_mean(self_rated) - _mean(overall), 2)
                                  if _mean(self_rated) is not None and _mean(overall) is not None else None),
                          "from": und_from},
        "objectives": objectives,
        "questions": questions,
        "misconceptions": misconceptions,
        "reflection": {"meaningful": refl_meaningful, "assessed": refl_assessed,
                       "capped": refl_assessed - refl_meaningful, "engagement": _mean(refl_eng),
                       "sentiment": sentiment, "topics": topics},
        "honor": honor, "flags": flags,
    }


def _ai_inputs(d, row=None):
    """The free-text fields the model reads to write prose + pick quotes (contract §5).

    `row` carries the two things that are not inside the schema:1 payload on the written path:
    which path the student took, and the reflection TEXT — which for a written preflight is the
    student's stored answer, not a copy in the diagnostic (WRITTEN-SCHEMA1.md deliberately omits
    it rather than duplicating student prose into a second table).
    """
    if not isinstance(d, dict):
        d = {}
    row = row or {}
    r = d.get("reading_reflection") if isinstance(d.get("reading_reflection"), dict) else {}
    misc = [
        {"id": m.get("id"), "label": m.get("label"), "description": m.get("description"),
         "objective_key": m.get("objective_key"), "severity": m.get("severity"), "evidence": m.get("evidence")}
        for m in (d.get("misconceptions") or []) if isinstance(m, dict)
    ]
    objs = [
        {"key": o.get("key"), "label": o.get("label"),
         "understanding": o.get("understanding"), "confidence": o.get("confidence")}
        for o in (d.get("objectives") or []) if isinstance(o, dict)
    ]
    return {
        "path": row.get("path"),
        "effort": d.get("effort"), "effort_rationale": d.get("effort_rationale"),
        "completed": d.get("completed"),
        "overall_understanding": d.get("overall_understanding"),
        "self_rated_understanding": d.get("self_rated_understanding"),
        # NOT the same instrument as responses[].status below. This is the hidden 0-5 diagnostic;
        # `status` is the graded 3-state. A `warn` answer earns full credit and can still sit on a
        # 1/5 understanding — that gap is often the finding. Do not conflate them in prose.
        "free_response_understanding": row.get("q3_understanding"),
        "reading_minutes": d.get("reading_minutes"),
        "objectives": objs, "misconceptions": misc,
        # The graded concept answers, verbatim. This is the raw material for the "common threads"
        # half of the readiness summary — what students actually wrote on Q3, not just how it was
        # scored. Absent entirely on the interactive path.
        "responses": row.get("responses") or [],
        # Interactive text comes from the payload; written text from the stored answer.
        "reflection": {"text": r.get("text") or row.get("reflection_text"),
                       "meaningful": r.get("meaningful"),
                       "engagement": r.get("engagement") if r.get("engagement") is not None
                                     else row.get("q2_effort"),
                       "topics": r.get("topics"), "sentiment": r.get("sentiment")},
        "ai_summary": d.get("ai_summary"), "key_strengths": d.get("key_strengths"),
        "recommended_review": d.get("recommended_review"),
        "flags": d.get("flags"),
    }


def _fingerprint(scope_rows):
    """Stable hash over a scope's input rows → staleness check. updated_at moves on every
    re-submit/edit, so the fingerprint changes when the underlying reports change."""
    basis = sorted((str(r["student_id"]), str(r["updated_at"]), r.get("effort")) for r in scope_rows)
    return hashlib.sha1(json.dumps(basis, default=str).encode("utf-8")).hexdigest()[:16]


def _lesson_meta(conn, slug):
    """The LESSON — one assignment offering — plus both activity ids, either of which may be None.

    Keyed on the offering, not on an interactive activity, because a lesson can be worked two
    ways and a question-only lesson has no interactive slug to name. `slug` accepts either the
    ASSIGNMENT slug (`preflight-08`, the lesson) or an ACTIVITY slug (`lesson-08-potential`, the
    frozen artifact key) so existing invocations keep working.

    An assignment can be re-offered in a later term, so the offering is not implied by the slug;
    this refuses to guess when more than one active offering claims it.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select ao.id as offering_id, ao.points_possible, ao.grading_mode, ao.is_published,
               a.slug as assignment_slug, a.title as assignment_title,
               co.id as course_offering_id, c.code as course_code, t.code as term_code,
               max(case when act.modality = 'interactive' then act.id::text end) as interactive_id,
               max(case when act.modality = 'interactive' then act.slug end)     as interactive_slug,
               max(case when act.modality = 'interactive' then act.title end)    as interactive_title,
               max(case when act.modality = 'written'     then act.id::text end) as written_id,
               max(case when act.modality = 'written'     then act.slug end)     as written_slug,
               max(case when act.modality = 'written'
                        then act.content::text end)                              as written_content
          from assignment_offerings ao
          join assignments          a  on a.id  = ao.assignment_id
          join course_offerings     co on co.id = ao.course_offering_id
          join courses              c  on c.id  = co.course_id
          join terms                t  on t.id  = co.term_id
          join offering_activities  oa on oa.assignment_offering_id = ao.id
          join activities           act on act.id = oa.activity_id
         where co.is_active
           and ao.id in (
                 select oa2.assignment_offering_id
                   from offering_activities oa2
                   join activities act2 on act2.id = oa2.activity_id
                   join assignment_offerings ao2 on ao2.id = oa2.assignment_offering_id
                   join assignments a2 on a2.id = ao2.assignment_id
                  where act2.slug = %(slug)s or a2.slug = %(slug)s)
         group by ao.id, ao.points_possible, ao.grading_mode, ao.is_published,
                  a.slug, a.title, co.id, c.code, t.code
    """, {"slug": slug})
    rows = cur.fetchall()
    if not rows:
        return None
    if len(rows) > 1:
        terms = ", ".join(sorted({r["term_code"] for r in rows}))
        sys.exit(f"'{slug}' is scheduled in more than one active offering ({terms}) — "
                 f"deactivate the stale course_offering before aggregating.")
    m = rows[0]
    # Back-compat aliases: the pull file has always carried these names.
    m["activity_id"] = m["interactive_id"]
    m["slug"] = m["interactive_slug"] or m["assignment_slug"]
    m["activity_title"] = m["interactive_title"] or m["assignment_title"]
    m["written_content"] = json.loads(m["written_content"]) if m["written_content"] else None
    return m


# The two pinned questions, and how to find them when nobody marked them.
#
# `role` is the durable contract (LESSON-UNIFICATION.md §11) and is what faculty/lessons.html
# writes on every newly authored lesson. But it was added AFTER the Fall 2026 preflights were
# built: scripts/fall2026/build_fall_preflights.py emits `{id, type, text, points}` with no role,
# and a read of the live database on 2026-07-21 found **0 of 74** written activities carrying any
# role at all. A role-only lookup therefore returns None for every lesson currently in the term —
# silently disabling written showcase quotes and the reading-time rollup.
#
# So: prefer the role, then fall back to the prompt text, which that same read found on 74/74.
# Text matching is normally a smell; here it is anchored to a prompt the builder pins verbatim
# and which a director does not hand-edit. The id fallback (q1/q2) is last and deliberately
# weakest — it is positional, and position is the first thing to change when a lesson is edited.
#
# The right permanent fix is to backfill `role` onto the 74 live rows; that is a DML change and
# a coordination event, so it is proposed rather than done here. When it lands, the fallbacks
# stop firing on their own and can eventually be deleted.
_ROLE_TEXT_MATCH = {
    "reading_time": "how much time did you spend reading",
    "reading_reflection": "confusing or most interesting",
}
_ROLE_FALLBACK_ID = {"reading_time": "q1", "reading_reflection": "q2"}


def _pinned_question_id(written_content, role):
    """The question id for a pinned role — by role, else by prompt text, else by position.

    Returns (id, how) so callers can report WHICH signal identified it; a run that silently
    depends on a positional guess is one an operator should be told about.
    """
    if not isinstance(written_content, dict):
        return None, None
    questions = [q for q in (written_content.get("questions") or []) if isinstance(q, dict)]

    for q in questions:
        if q.get("role") == role and q.get("id"):
            return q["id"], "role"

    needle = _ROLE_TEXT_MATCH.get(role)
    if needle:
        for q in questions:
            if needle in str(q.get("text") or "").lower() and q.get("id"):
                return q["id"], "text"

    want = _ROLE_FALLBACK_ID.get(role)
    for q in questions:
        if q.get("id") == want:
            return q["id"], "position"
    return None, None


def _reflection_question_id(written_content):
    """Which written question IS the reading reflection. See _pinned_question_id."""
    return _pinned_question_id(written_content, "reading_reflection")[0]


def _graded_response_questions(written_content):
    """The graded free-response questions — the concept questions, i.e. Q3 on a Fall preflight.

    Identified by EXCLUDING the two pinned questions, not by a role of their own. The comment on
    `_pinned_question_id` explains why: 0 of 74 live written activities carry any `role`, so a
    `role == "concept"` lookup would be dead code propped up by a positional guess. Exclusion
    instead rides on the two pinned lookups, which that same read resolved on 74/74.

    `points > 0` alone is not enough — the reading reflection is also `free_response, points: 1`.
    The pinned-id exclusion is what separates them, and it is load-bearing.

    Lab lessons are covered: their Q1 ("How much time did you spend reading **the lab
    instructions**…") still contains the reading_time needle, and their Q2 still contains the
    reflection needle, so both pinned lookups resolve and the exclusion holds. If that ever stops
    being true, every reading reflection silently lands in the concept-question analysis — which
    is why `aggregate_summarize_test.py` asserts the lab wording explicitly.

    Returns [{id, text, points, expected_response, how}] in the activity's own question order.
    """
    if not isinstance(written_content, dict):
        return []
    pinned = {_pinned_question_id(written_content, "reading_time")[0],
              _pinned_question_id(written_content, "reading_reflection")[0]}
    out = []
    for q in (written_content.get("questions") or []):
        if not isinstance(q, dict) or not q.get("id") or q["id"] in pinned:
            continue
        if q.get("type") != "free_response" or not (_num(q.get("points")) or 0) > 0:
            continue
        out.append({"id": q["id"], "text": q.get("text"), "points": _num(q.get("points")),
                    "expected_response": q.get("expected_response"), "how": "exclusion"})
    return out


def _sections(conn, course_offering_id):
    """id -> code and code -> id for the offering, so operators may name sections either way."""
    cur = conn.cursor()
    cur.execute("select id, code from sections where course_offering_id = %s order by code",
                (course_offering_id,))
    rows = cur.fetchall()
    return {str(i): c for i, c in rows}, {c: str(i) for i, c in rows}


def _instructors(conn, course_offering_id):
    """Who teaches which section of this offering — the basis for the instructor scopes.

    The readiness summary is written per INSTRUCTOR across every section they teach (with
    per-section departures listed separately), so the model needs this mapping to know which
    sections belong together. Two sections of one lesson taught by one person previously got two
    isolated paragraphs that could not be compared.

    ONLY section-scoped staff rows count. A director's offering-wide row carries `section_id` NULL,
    which grants sight of every section but is not a teaching assignment — the same rule
    taughtSectionIds() applies in the browser, and the two must agree or a director's "My sections"
    would resolve to a scope nobody wrote. A director who also teaches holds a section-scoped row
    for that section and is picked up here through it.
    """
    cur = conn.cursor()
    cur.execute(
        """
        -- app.instructors carries id, name, is_global_admin only. There is no email column here:
        -- the sign-in address lives on auth.users, which this role cannot read.
        select sa.instructor_id,
               coalesce(nullif(trim(i.name), ''), sa.instructor_id::text) as name,
               sa.section_id, s.code
          from staff_assignments sa
          join instructors i on i.id = sa.instructor_id
          join sections s on s.id = sa.section_id
         where sa.course_offering_id = %s and sa.section_id is not null
         order by name, s.code
        """,
        (course_offering_id,),
    )
    out = {}
    for iid, name, sid, code in cur.fetchall():
        e = out.setdefault(str(iid), {"instructor_id": str(iid), "instructor_name": name,
                                      "section_ids": [], "section_codes": []})
        e["section_ids"].append(str(sid))
        e["section_codes"].append(code)
    return out


def _load_reports(conn, offering_id, interactive_id, written_id, refl_qid=None,
                  response_qids=()):
    """All work on one LESSON, by either path, joined to the enrolment's section and its grade.

    The schema:1 assessment lives in a different table depending on how the student worked:
    on their SUBMISSION for the interactive path (the artifact wrote it) and on their GRADE for
    the written path (/preflight-analyze wrote it — see that skill's WRITTEN-SCHEMA1.md). Both
    are normalized into `report_data` here so everything downstream folds one shape.

    A student who did both is one row, and the interactive assessment wins: it is the richer
    record (transcript-derived) and it is what they were graded on when the artifact is the
    graded activity.

    A NULL activity id simply never matches in its LEFT JOIN, so a single-modality lesson needs
    no special case.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select e.student_id, e.id as enrollment_id, sec.id as section_id, sec.code as section_code,
               sec.meeting_days,
               g.effort, g.points_earned, g.diagnostic, g.question_scores,
               sa_i.content as interactive_content,
               sa_w.content as written_content,
               (sa_i.id is not null) as did_interactive,
               (sa_w.id is not null) as did_written,
               greatest(coalesce(sa_i.updated_at, sa_w.updated_at),
                        coalesce(sa_w.updated_at, sa_i.updated_at)) as updated_at
          from submissions s
          join enrollments e   on e.id   = s.enrollment_id
          join sections    sec on sec.id = e.section_id
          left join submission_activities sa_i
                 on sa_i.submission_id = s.id and sa_i.activity_id = %(iid)s
          left join submission_activities sa_w
                 on sa_w.submission_id = s.id and sa_w.activity_id = %(wid)s
          left join grades g on g.enrollment_id = s.enrollment_id
                           and g.assignment_offering_id = s.assignment_offering_id
         where s.assignment_offering_id = %(oid)s
           and (sa_i.id is not null or sa_w.id is not null)
         order by sec.code, e.student_id
    """, {"iid": interactive_id, "wid": written_id, "oid": offering_id})
    rows = cur.fetchall()

    for r in rows:                      # uuids -> str so they compare against JSON payload keys
        r["section_id"] = str(r["section_id"])
        r["enrollment_id"] = str(r["enrollment_id"])

        diag = r.get("diagnostic") if isinstance(r.get("diagnostic"), dict) else {}
        interactive = r["interactive_content"] if isinstance(r["interactive_content"], dict) else None
        written_assessment = diag if diag.get("schema") == 1 else None

        r["path"] = ("both" if r["did_interactive"] and r["did_written"]
                     else "interactive" if r["did_interactive"] else "written")
        r["report_data"] = interactive or written_assessment
        # The reflection-only diagnostic, kept separate: it measures one question, not the
        # attempt, and the free-response understanding has no interactive equivalent.
        r["q2_effort"] = diag.get("q2_effort")
        r["q3_understanding"] = diag.get("q3_understanding")

        # Quote source. The written reflection is stored verbatim as the student's ANSWER, not
        # copied into the diagnostic, so it is lifted here rather than read off report_data.
        r["reflection_text"] = _answer(r["written_content"], refl_qid)

        # The graded concept answers, paired with how each was scored. `feedback` is deliberately
        # NOT carried: it is per-student prose /preflight-analyze wrote FOR THAT STUDENT, and
        # letting it into the aggregator's input is how individual feedback gets laundered into
        # cohort prose. Status + score is what the summary needs.
        qs = r["question_scores"] if isinstance(r.get("question_scores"), dict) else {}
        r["responses"] = []
        for qid in (response_qids or ()):
            ans = _answer(r["written_content"], qid)
            one = qs.get(qid) if isinstance(qs.get(qid), dict) else {}
            if ans is None and not one:
                continue
            r["responses"].append({"question_id": qid, "answer": ans,
                                   "score": _num(one.get("score")), "max": _num(one.get("max")),
                                   "status": one.get("status")})
        r["question_scores"] = {
            qid: {"score": _num(v.get("score")), "max": _num(v.get("max")), "status": v.get("status")}
            for qid, v in qs.items() if isinstance(v, dict)
        }

        del r["interactive_content"], r["written_content"]
    return rows


def _run_start(conn, meta, skill, invoked_by, day):
    """Open an analysis_runs row. Returns its id.

    Written BEFORE the work, not after: a run that dies mid-way is the case an audit trail exists
    for, and a row only written on success would lose exactly that one. A row left at
    status='running' is a crashed or abandoned run, and reads as such.
    """
    cur = conn.cursor()
    cur.execute("""
        insert into analysis_runs (skill, invoked_by, course_offering_id,
                                   assignment_offering_id, day_track, status)
        values (%s, %s, %s, %s, %s, 'running') returning id
    """, (skill, invoked_by, meta["course_offering_id"], meta["offering_id"], day))
    rid = cur.fetchone()[0]
    conn.commit()          # committed on its own so it survives a later rollback
    return rid


def _run_finish(conn, run_id, status, summary=None, detail=None, error=None):
    """Close an analysis_runs row. Safe to call with run_id=None (nothing was opened)."""
    if not run_id:
        return
    cur = conn.cursor()
    cur.execute("""
        update analysis_runs
           set status = %s, finished_at = now(), summary = %s,
               detail = coalesce(%s, detail), error = %s
         where id = %s
    """, (status, summary, Json(detail) if detail is not None else None, error, run_id))
    conn.commit()


def _existing_payload(conn, offering_id):
    cur = conn.cursor()
    cur.execute("""select payload from analysis_reports
                    where scope = %s and scope_id = %s and audience_id is null and kind = %s""",
                (SCOPE, offering_id, KIND))
    row = cur.fetchone()
    return dict(row[0]) if row and isinstance(row[0], dict) else {}


# ── pull ─────────────────────────────────────────────────────────────────────────────
def cmd_pull(args, conn):
    meta = _lesson_meta(conn, args.activity)
    if not meta:
        sys.exit(f"No lesson '{args.activity}' in an active offering "
                 f"(tried it as both an assignment slug and an activity slug).")
    refl_qid = _reflection_question_id(meta.get("written_content"))
    response_qs = _graded_response_questions(meta.get("written_content"))
    reports = _load_reports(conn, meta["offering_id"], meta["interactive_id"],
                            meta["written_id"], refl_qid,
                            [q["id"] for q in response_qs])
    if not reports:
        sys.exit(f"No work recorded for '{args.activity}' yet — nothing to aggregate.")

    # ── Day scoping.
    #
    # The tool runs once after each day track's deadline. The second run must not re-aggregate the
    # first day's sections, so `--day` filters WHICH sections get a full scope. It deliberately
    # does NOT filter the SQL: `_load_reports` fetches the whole offering in one query either way,
    # and `__all__`'s numbers must stay computed over every live row (see below). The saving being
    # bought here is the model's context — `reports[]` — not database work.
    #
    # Any token is accepted and validated against the meeting_days actually present. Hardcoding
    # M|T would re-introduce exactly the two-course assumption 001_core_model.sql:189-192 records
    # as deliberately removed.
    day = (getattr(args, "day", None) or "").strip().upper() or None
    present = sorted({str(d).strip().upper()
                      for r in reports for d in (r.get("meeting_days") or [])})
    if day and day not in present:
        sys.exit(f"--day {day} matches no section of this lesson. "
                 f"Days present: {', '.join(present) or '(none — every section has empty meeting_days)'}")

    pp = meta["points_possible"]
    # Missing structure, split by path, because the fix differs: an interactive report without
    # schema:1 needs /interaction-backfill; a written one needs /preflight-analyze to have run.
    missing_i = sum(1 for r in reports
                    if not isinstance(r["report_data"], dict) and r["path"] != "written")
    missing_w = sum(1 for r in reports
                    if not isinstance(r["report_data"], dict) and r["path"] == "written")
    missing = missing_i + missing_w
    by_section = defaultdict(list)
    for r in reports:
        by_section[r["section_id"]].append(r)

    stored_scopes = (_existing_payload(conn, meta["offering_id"]).get("scopes") or {})

    scopes, prior_scopes = [], []
    covered, from_stored, uncovered, stale_prior = [], [], [], []
    # Per-section scopes carry the full per-report text the model reads + picks quotes from.
    # A section that does not meet on `--day` is emitted as a PRIOR scope instead: its stored
    # prose plus freshly computed numbers, and no reports[]. That is what lets the whole-course
    # synthesis fold in the other day without re-reading its cohort.
    for sec_id in sorted(by_section, key=lambda s: by_section[s][0]["section_code"]):
        rows = by_section[sec_id]
        code = rows[0]["section_code"]
        fp = _fingerprint(rows)
        if _meets(rows[0].get("meeting_days"), day):
            covered.append(code)
            scopes.append({
                "section_id": sec_id, "section_code": code,
                "is_whole_course": False, "in_day": True, "n": len(rows),
                "source_fingerprint": fp,
                "numbers": summarize(rows, pp),
                "reports": [{"student_id": r["student_id"], "section_id": sec_id,
                             **_ai_inputs(r["report_data"], r)} for r in rows],
            })
            continue

        prior = stored_scopes.get(sec_id) if isinstance(stored_scopes.get(sec_id), dict) else None
        # "Has this section been aggregated?" — test for ANY prose a section scope can carry.
        #
        # This checked only readiness_summary/misconception_trends, which was right until
        # 2026-07-22: the summary moved to the instructor scope and trends was retired, so a
        # freshly-written section scope carries NEITHER and read as never-aggregated. The visible
        # symptom was the T-day run refusing to write '__all__' because the M sections it had
        # just aggregated looked untouched. Include the recommendation, which is what a section
        # scope now always carries.
        if not prior or not (prior.get("readiness_summary")
                             or prior.get("misconception_trends")
                             or prior.get("misconception_recommendation")):
            uncovered.append(code)          # never aggregated, and not in scope this run
            continue
        from_stored.append(code)
        stored_fp = (prior.get("meta") or {}).get("source_fingerprint")
        if stored_fp and stored_fp != fp:
            stale_prior.append(code)
        prior_scopes.append({
            "section_id": sec_id, "section_code": code, "in_day": False, "n": len(rows),
            # True when this section's work changed after its prose was written. Re-run THAT day
            # before folding it into the course scope, or the synthesis quotes a stale section.
            "stale": bool(stored_fp and stored_fp != fp),
            "readiness_summary": prior.get("readiness_summary"),
            "misconception_trends": prior.get("misconception_trends"),
            "misconception_recommendation": prior.get("misconception_recommendation"),
            "meta": prior.get("meta"),
            "numbers": summarize(rows, pp),
        })

    # `__all__` is writable only when every section is represented — either aggregated in this run
    # or carried in from a prior one. A whole-course scope whose PROSE covers half the course but
    # whose NUMBERS cover all of it disagrees with itself, and the UI cannot tell: aiGenNote()
    # shows "may be out of date" only when meta.n != scopeN, and here they would be equal. A
    # half-course synthesis would render as fresh and authoritative. Omitting is free, because the
    # writer merges and the rollup already falls back to its placeholder.
    coverage = {"day": day, "sections_total": len(by_section),
                "this_run": covered, "from_stored": from_stored,
                "uncovered": uncovered, "stale_prior": stale_prior,
                "complete": not uncovered}
    # Whole-course scope: numbers only. Prose is synthesized from the per-section reports above;
    # no quotes (the "All sections" view never shows them).
    #
    # Its NUMBERS are always computed over every live row, never recombined from the section
    # scopes. Counts and histograms would sum exactly, but reading.median cannot be recovered from
    # stored medians, and every mean here is round(…, 2) — recombining rounded section means
    # drifts invisibly, and understanding.gap doubles it. The browser recomputes these same
    # figures from raw rows for the All-sections bars, so any drift is prose disagreeing with the
    # bar beside it. Only the PROSE reuses prior scopes.
    scopes.append({
        "section_id": ALL, "section_code": ALL, "is_whole_course": True, "n": len(reports),
        "source_fingerprint": _fingerprint(reports),
        "write": coverage["complete"],
        "coverage": coverage,
        "numbers": summarize(reports, pp),
        "reports": [],
    })

    whole = next(s for s in scopes if s["is_whole_course"])
    out = {
        "activity_slug": meta["slug"], "activity_title": meta["activity_title"],
        "assignment_slug": meta["assignment_slug"], "assignment_title": meta["assignment_title"],
        "assignment_offering_id": str(meta["offering_id"]),
        "course_code": meta["course_code"], "term_code": meta["term_code"],
        "points_possible": float(pp), "grading_mode": meta["grading_mode"],
        # What this lesson offers, and how the cohort actually worked it. The prose must not
        # describe an artifact nobody took, or omit a question set half the class chose.
        "modalities": {"interactive": bool(meta["interactive_id"]),
                       "written": bool(meta["written_id"])},
        "paths": whole["numbers"]["paths"],
        "day": day,
        "coverage": coverage,
        "reflection_question_id": refl_qid,
        # Who teaches what — the basis for the instructor scopes the readiness summary is now
        # written against. Each entry's sections are the ones one summary must cover together,
        # with departures called out per section rather than inflating the summary.
        #
        # `in_day` marks the sections actually aggregated this run: an instructor whose sections
        # span both day tracks gets a summary written from the day in scope, and the writer merges
        # it with what the other day's run stored. Sections not in `section_ids_in_day` are still
        # listed so the model can see the instructor has more, and not claim to cover them.
        "instructors": [
            {**e,
             "section_ids_in_day": [sid for sid in e["section_ids"]
                                    if sid in {s["section_id"] for s in scopes if s.get("in_day")}]}
            # course_offering_id, NOT offering_id: staff_assignments is keyed to the COURSE
            # offering (who staffs the term), while offering_id is this one assignment's run of
            # the lesson. Passing the wrong one returns an empty block and silently costs every
            # instructor scope.
            for e in _instructors(conn, meta["course_offering_id"]).values()
        ],
        # The graded concept questions, with their prompt and expected answer. Present only on a
        # lesson that HAS a written activity — its absence is what gates the whole per-question
        # half of the readiness summary, so an interactive-only lesson is untouched by it.
        "questions": [{"id": q["id"], "text": q["text"], "points": q["points"],
                       "expected_response": q["expected_response"], "how": q["how"]}
                      for q in response_qs] if meta["written_id"] else [],
        "report_count": len(reports), "missing_report_data": missing,
        "sections": [{"id": s["section_id"], "code": s["section_code"]}
                     for s in scopes if not s["is_whole_course"]],
        "prior_scopes": prior_scopes,
        "scopes": scopes,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(scopes)} scope(s) over {len(reports)} report(s) to {args.out}")
        p = out["paths"]
        print(f"  paths: {p['interactive_n']} interactive, {p['written_n']} written"
              f"{' (mixed cohort)' if p['mixed'] else ''}")
        if day:
            print(f"  day {day}: aggregating {', '.join(covered) or '(none)'}"
                  + (f" · carrying stored prose for {', '.join(from_stored)}" if from_stored else ""))
        if response_qs:
            print("  graded response question(s): "
                  + ", ".join(f"{q['id']} (by {q['how']})" for q in response_qs))
        elif meta["written_id"]:
            print("  ⚠ no graded free-response question identified — the readiness summary will "
                  "have no concept-question material to draw on.")
        both_days = sorted({rows[0]["section_code"] for rows in by_section.values()
                            if len([d for d in (rows[0].get("meeting_days") or [])]) > 1})
        if day and both_days:
            print(f"  ⚠ {', '.join(both_days)} meet on more than one day — they are aggregated on "
                  f"every day-scoped run, and the last one wins.")
        no_days = sorted({rows[0]["section_code"] for rows in by_section.values()
                          if not (rows[0].get("meeting_days") or [])})
        if day and no_days:
            print(f"  ⚠ {', '.join(no_days)} have empty meeting_days — excluded by any --day "
                  f"filter, so they will never be aggregated until one is set.")
        if stale_prior:
            print(f"  ⚠ stored prose for {', '.join(stale_prior)} is STALE (that section's work "
                  f"changed since it was written) — re-run those days before the course scope.")
        if not coverage["complete"]:
            print(f"  ⚠ '{ALL}' is NOT writable this run — {', '.join(uncovered)} "
                  f"{'has' if len(uncovered) == 1 else 'have'} never been aggregated. Omit the "
                  f"'{ALL}' scope; run the remaining day(s) first.")
        if missing_i:
            print(f"  ⚠ {missing_i} interactive report(s) lack structured content — run "
                  f"/interaction-backfill first (they are excluded from means but skew counts).")
        if missing_w:
            print(f"  ⚠ {missing_w} written submission(s) have no schema:1 assessment — run "
                  f"/preflight-analyze for this offering first, or they contribute nothing but a "
                  f"denominator.")
        if meta["written_id"] and not refl_qid:
            print(f"  ⚠ no question marked role=\"reading_reflection\" on the written activity — "
                  f"written reflections cannot be quoted (see LESSON-UNIFICATION.md §11).")
    else:
        print(text)


# ── worklist ───────────────────────────────────────────────────────────────────────────
def cmd_worklist(args, conn):
    """What is past due in a course, and has it been analyzed yet.

    Two callers, two very different appetites, and the difference is the whole design:

      * A HUMAN wants the list — every past-due lesson with its status — because they may
        legitimately want to re-run an older one after grading a late submission by hand.
      * The AUTOMATED path wants ONLY the most recently due lesson, and only if it has never
        been analyzed. It must never walk backwards through the term.

    Why the automated path is deliberately short-sighted: an older lesson can look "unanalyzed"
    for reasons a scheduler must not act on. A student on an approved extension submits days
    late; a late submission is accepted by hand. Both are graded manually, on purpose. A cron
    that swept up every outstanding lesson would re-grade those cohorts unattended and overwrite
    the human judgement that was the entire point of handling them by hand. So it looks at one
    lesson: the one whose deadline just passed.

    Day tracks are separate work. A lesson's M sections and T sections close on different days,
    so "most recently due" is answered per day track, not per lesson.
    """
    day = (getattr(args, "day", None) or "").strip().upper() or None
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        with offering as (
          select co.id
            from course_offerings co
            join courses c on c.id = co.course_id
           where co.is_active and c.code = %(course)s
        ),
        -- The deadline that actually applies to each section: a per-section override when there
        -- is one, else the offering default. Mirrors schema.js effectiveDue() minus the
        -- per-student extension, which is exactly the case this must NOT chase.
        sec_due as (
          select ao.id as offering_id, s.id as section_id, s.code as section_code,
                 s.meeting_days,
                 coalesce(add.due_at, ao.due_at) as due_at
            from assignment_offerings ao
            join offering o on o.id = ao.course_offering_id
            join sections s on s.course_offering_id = ao.course_offering_id
            left join assignment_due_dates add
                   on add.assignment_offering_id = ao.id and add.section_id = s.id
        )
        select ao.id                as offering_id,
               a.slug, a.title,
               ao.is_published,
               d.track,
               d.due_at,
               d.section_codes,
               (select count(*) from submissions sub
                 where sub.assignment_offering_id = ao.id)                    as submissions,
               (select count(*) from grades g
                 where g.assignment_offering_id = ao.id
                   and g.diagnostic->>'schema' = '1')                         as assessed,
               (select max(r.started_at) from analysis_runs r
                 where r.assignment_offering_id = ao.id
                   and coalesce(r.day_track, '') = coalesce(d.track, '')
                   and r.status = 'success')                                  as last_success,
               (select r2.status from analysis_runs r2
                 where r2.assignment_offering_id = ao.id
                   and coalesce(r2.day_track, '') = coalesce(d.track, '')
                 order by r2.started_at desc limit 1)                         as last_status,
               (select count(*) from analysis_reports ar
                 where ar.scope = 'assignment_offering' and ar.scope_id = ao.id
                   and ar.kind = %(kind)s)                                    as has_analysis
          from assignment_offerings ao
          join assignments a on a.id = ao.assignment_id
          join offering o    on o.id = ao.course_offering_id
          join lateral (
                 -- One row per day track this lesson is worked on, carrying the moment that
                 -- track's work closed: the LAST of its sections' deadlines.
                 select unnest(sd.meeting_days) as track,
                        max(sd.due_at)          as due_at,
                        array_agg(distinct sd.section_code order by sd.section_code) as section_codes
                   from sec_due sd
                  where sd.offering_id = ao.id and sd.due_at is not null
                  group by unnest(sd.meeting_days)
               ) d on true
         where d.due_at <= now()
           and (%(day)s is null or d.track = %(day)s)
         order by d.due_at desc, a.slug
    """, {"course": args.course, "day": day, "kind": KIND})
    rows = cur.fetchall()
    if not rows:
        msg = f"Nothing past due in {args.course}" + (f" for day {day}" if day else "") + "."
        print(json.dumps({"course": args.course, "day": day, "items": []}) if args.json else msg)
        return

    for r in rows:
        # "Never analyzed" means BOTH: no successful run recorded, and no stored analysis. The
        # second half matters because analysis_runs (migration 009) is newer than the analyses
        # themselves — a lesson aggregated before the audit trail existed has a real rollup and
        # no run row, and calling that "never analyzed" would invite a pointless re-run.
        r["needs_run"] = r["last_success"] is None and not r["has_analysis"]
        r["ready"] = r["submissions"] > 0

    # --latest is the automated contract: the most recently due track, and only if it has never
    # had a successful run. Anything older is left alone — see the docstring.
    if args.latest:
        top = rows[0]
        out = {"course": args.course, "day": top["track"], "slug": top["slug"],
               "offering_id": str(top["offering_id"]), "due_at": str(top["due_at"]),
               "sections": top["section_codes"], "submissions": top["submissions"],
               "assessed": top["assessed"], "last_status": top["last_status"],
               "action": "run" if top["needs_run"] else "skip",
               "reason": None if top["needs_run"]
                         else (f"already analyzed successfully at {top['last_success']}"
                               if top["last_success"] else "analysis already stored for this lesson")}
        if not top["submissions"]:
            out["action"], out["reason"] = "skip", "no submissions recorded"
        print(json.dumps(out, default=str, indent=2) if args.json
              else f"{out['action'].upper()}: {top['slug']} day {top['track']} "
                   f"({', '.join(top['section_codes'])}, due {top['due_at']})"
                   + (f" — {out['reason']}" if out['reason'] else ""))
        return

    if args.json:
        print(json.dumps({"course": args.course, "day": day,
                          "items": [dict(r, offering_id=str(r["offering_id"])) for r in rows]},
                         default=str, indent=2))
        return

    print(f"{'lesson':22} {'day':>3} {'due':16} {'sections':14} {'subs':>4} {'assessed':>8}  status")
    print("-" * 96)
    for r in rows:
        state = ("never analyzed" if r["needs_run"]
                 else f"analyzed {str(r['last_success'])[:16]}")
        if r["last_status"] and r["last_status"] != "success" and r["needs_run"]:
            state = f"last run {r['last_status']}"
        print(f"{r['slug']:22} {r['track'] or '-':>3} {str(r['due_at'])[:16]:16} "
              f"{','.join(r['section_codes'])[:14]:14} {r['submissions']:>4} {r['assessed']:>8}  {state}")
    print("\nRe-running an already-analyzed lesson is allowed and sometimes right — after grading a "
          "late\nor extension submission by hand, for instance. The automated path never does it.")


# ── write-analysis ─────────────────────────────────────────────────────────────────────
def cmd_write(args, conn):
    items = json.loads(Path(args.infile).read_text(encoding="utf-8"))
    if not isinstance(items, list):
        sys.exit("--in file must be a JSON array of {activity_slug, section_id, readiness_summary, "
                 "misconception_trends, selected_quotes}.")

    cur = conn.cursor()
    errored = 0
    cache = {}                      # activity slug -> resolved context
    pending = {}                    # offering_id -> {"meta":…, "scopes": {key: scope}}

    def ctx(slug):
        if slug not in cache:
            meta = _lesson_meta(conn, slug)
            if not meta:
                return None
            rows = _load_reports(conn, meta["offering_id"], meta["interactive_id"],
                                 meta["written_id"],
                                 _reflection_question_id(meta.get("written_content")))
            by_id, by_code = _sections(conn, meta["course_offering_id"])
            cache[slug] = {
                "meta": meta, "rows": rows,
                "section_code": by_id, "section_id": by_code,
                "student_section": {r["student_id"]: r["section_id"] for r in rows},
            }
        return cache[slug]

    for it in items:
        slug = it.get("activity_slug") or it.get("interaction_id")   # legacy key still accepted
        sec = it.get("section_id")
        tag = f"{slug}/{sec}"
        rs = it.get("readiness_summary")
        mt = it.get("misconception_trends")
        reco = it.get("misconception_recommendation")
        quotes = it.get("selected_quotes") or []

        if not slug or not sec:
            print(f"  [err ] {tag}: needs activity_slug and section_id")
            errored += 1
            continue
        c = ctx(slug)
        if not c:
            print(f"  [err ] {tag}: no interactive activity '{slug}' in an active offering")
            errored += 1
            continue
        if not c["rows"]:
            print(f"  [err ] {tag}: no recorded work for '{slug}'")
            errored += 1
            continue

        # Three kinds of scope key:
        #   '<uuid>' / '<code>'  one section
        #   '__all__'            the whole course
        #   'instr:<uuid>'       one instructor, across every section they teach (2026-07-22)
        sec = str(sec)
        is_instr = sec.startswith(INSTR)
        if is_instr:
            iid = sec[len(INSTR):].strip()
            known = _instructors(conn, c["meta"]["course_offering_id"])
            if iid not in known:
                print(f"  [err ] {tag}: no instructor {iid!r} teaches a section of this offering")
                errored += 1
                continue
        elif sec != ALL:
            sec = c["section_id"].get(sec, sec)
            if sec not in c["section_code"]:
                print(f"  [err ] {tag}: not a section of this offering (or '{ALL}' or '{INSTR}<uuid>')")
                errored += 1
                continue

        bad = False
        # The summary got its own, much smaller cap when it moved to instructor scope and was cut
        # to 2-3 sentences. `misconception_trends` is DEPRECATED — no longer written or rendered —
        # but still accepted at the old cap so a hand-authored or replayed file does not fail.
        if rs is not None and (not isinstance(rs, str) or len(rs) > MAX_SUMMARY):
            print(f"  [err ] {tag}: readiness_summary must be a string ≤ {MAX_SUMMARY} chars "
                  f"(it renders as 2-3 sentences; per-section detail belongs in section_notes)")
            bad = True
        if mt is not None and (not isinstance(mt, str) or len(mt) > MAX_PROSE):
            print(f"  [err ] {tag}: misconception_trends must be a string ≤ {MAX_PROSE} chars")
            bad = True

        # Per-section departures from the instructor's summary. Structured rather than markdown so
        # the UI can bold the section code without trusting model-authored markup, and so a note
        # can be filtered to the section actually being viewed.
        notes = it.get("section_notes") or []
        if notes and not is_instr:
            print(f"  [err ] {tag}: section_notes belong on an '{INSTR}<uuid>' scope only")
            bad = True
        if not isinstance(notes, list) or len(notes) > MAX_NOTES:
            print(f"  [err ] {tag}: section_notes must be a list of ≤ {MAX_NOTES}")
            bad = True
            notes = []
        clean_notes = []
        for nt in notes:
            nsid = str(nt.get("section_id") or "") if isinstance(nt, dict) else ""
            nsid = c["section_id"].get(nsid, nsid)
            note = str(nt.get("note") or "").strip() if isinstance(nt, dict) else ""
            if nsid not in c["section_code"]:
                print(f"  [err ] {tag}: section_notes entry names {nsid!r}, not a section here")
                bad = True
            elif not note or len(note) > MAX_NOTE:
                print(f"  [err ] {tag}: each section_note must be 1..{MAX_NOTE} chars")
                bad = True
            else:
                clean_notes.append({"section_id": nsid, "section_code": c["section_code"][nsid],
                                    "note": note})
        # The recommendation has its own, much smaller cap, and must be ONE paragraph — the UI
        # renders it as a single line under the trends prose. Reject a multi-paragraph value
        # rather than silently reflowing it: this file refuses to guess elsewhere too.
        if reco is not None:
            if not isinstance(reco, str) or len(reco) > MAX_RECO:
                print(f"  [err ] {tag}: misconception_recommendation must be a string ≤ {MAX_RECO} chars")
                bad = True
            elif "\n\n" in reco.strip():
                print(f"  [err ] {tag}: misconception_recommendation must be a single paragraph "
                      f"(it renders as one line) — found a blank line")
                bad = True
        # Quotes: '__all__' carries none; per-section quotes must reference a real report whose
        # student is actually in that section (no cross-section picks).
        if sec == ALL or is_instr:
            if quotes:
                print(f"  [err ] {tag}: the '{sec if sec == ALL else INSTR + '…'}' scope must not "
                      f"carry quotes — they are per-section")
                bad = True
        else:
            if not isinstance(quotes, list) or len(quotes) > MAX_QUOTES:
                print(f"  [err ] {tag}: selected_quotes must be a list of ≤ {MAX_QUOTES}")
                bad = True
            for q in (quotes if isinstance(quotes, list) else []):
                sid = q.get("student_id") if isinstance(q, dict) else None
                qsec = str(q.get("section_id")) if isinstance(q, dict) and q.get("section_id") else None
                qsec = c["section_id"].get(qsec, qsec)
                if c["student_section"].get(sid) != sec or qsec not in (None, sec):
                    print(f"  [err ] {tag}: quote student_id={sid!r} is not a report in this section")
                    bad = True
        if bad:
            errored += 1
            continue

        # Re-derive n + fingerprint from the live rows so they can't drift from reality. An
        # instructor scope's n is the population its summary describes: every student in the
        # sections that instructor teaches.
        if sec == ALL:
            rows = c["rows"]
        elif is_instr:
            own = set(known[sec[len(INSTR):].strip()]["section_ids"])
            rows = [r for r in c["rows"] if str(r["section_id"]) in own]
        else:
            rows = [r for r in c["rows"] if r["section_id"] == sec]
        scope_meta = dict(it.get("meta") or {})
        scope_meta.update({"n": len(rows),
                           "generated_by": f"lesson-aggregate@{date.today().isoformat()}",
                           "source_fingerprint": _fingerprint(rows)})
        # Provenance only — which day-scoped run wrote this scope, and (on '__all__') what it
        # covered. NEVER used to filter rows: n and the fingerprint stay derived from live data.
        if it.get("day"):
            scope_meta["day"] = str(it["day"]).strip().upper()
        if sec == ALL and isinstance(it.get("coverage"), dict):
            scope_meta["coverage"] = it["coverage"]
        oid = str(c["meta"]["offering_id"])
        bucket = pending.setdefault(oid, {"ctx": c, "scopes": {}})
        if is_instr:
            e = known[sec[len(INSTR):].strip()]
            bucket["scopes"][sec] = {
                "instructor_id": e["instructor_id"],
                "instructor_name": e["instructor_name"],
                "section_ids": e["section_ids"],
                "section_codes": e["section_codes"],
                "readiness_summary": rs,
                "section_notes": clean_notes,
                "meta": scope_meta,
            }
        else:
            bucket["scopes"][sec] = {
                "section_id": None if sec == ALL else sec,
                "section_code": ALL if sec == ALL else c["section_code"][sec],
                "readiness_summary": rs,
                # DEPRECATED 2026-07-22 — no longer written or rendered. Stored when supplied so a
                # replayed file loses nothing; the UI ignores it.
                "misconception_trends": mt,
                # Allowed on '__all__', unlike quotes: a whole-course "what to cover Monday" is
                # exactly where a teaching action matters most.
                "misconception_recommendation": reco,
                "selected_quotes": [] if sec == ALL
                                   else [{"student_id": q["student_id"], "section_id": sec} for q in quotes],
                "meta": scope_meta,
            }
        s = bucket["scopes"][sec]
        print(f"  [{'dry' if args.dry_run else 'ok '}] {tag}: n={scope_meta['n']} "
              + (f"sections={len(s.get('section_ids') or [])} notes={len(clean_notes)} "
                 f"readiness={'y' if rs else '-'}"
                 if is_instr else
                 f"quotes={len(s['selected_quotes'])} readiness={'y' if rs else '-'} "
                 f"reco={'y' if reco else '-'}"))

        # Offering-level, not per scope: one misconception means one thing everywhere, so folding
        # it per scope would let two sections' bars disagree. Carried on any item and merged below.
        aliases = it.get("misconception_aliases")
        if isinstance(aliases, dict):
            if len(aliases) > MAX_ALIASES:
                print(f"  [warn] {tag}: {len(aliases)} aliases exceeds {MAX_ALIASES} — truncating")
            norm = {}
            for k, v in list(aliases.items())[:MAX_ALIASES]:
                kk = re.sub(r"\s+", "-", str(k or "").strip().lower())
                vv = re.sub(r"\s+", "-", str(v or "").strip().lower())
                # A self-alias is a no-op; an empty target would erase an id at render time.
                if kk and vv and kk != vv:
                    norm[kk] = vv
            bucket.setdefault("aliases", {}).update(norm)
        glossary = it.get("misconception_glossary")
        if isinstance(glossary, dict):
            gnorm = {}
            for k, g in glossary.items():
                kk = re.sub(r"\s+", "-", str(k or "").strip().lower())
                if kk and isinstance(g, dict):
                    gnorm[kk] = {"label": (g.get("label") or None),
                                 "description": (g.get("description") or None)}
            bucket.setdefault("glossary", {}).update(gnorm)

    # One row per offering. MERGE into any existing payload so scopes written by an earlier run
    # (e.g. the M-day pass) survive this one — the per-scope independence the old per-section
    # rows gave for free.
    written = 0
    for oid, bucket in pending.items():
        c = bucket["ctx"]
        payload = _existing_payload(conn, oid)
        scopes = dict(payload.get("scopes") or {})
        scopes.update(bucket["scopes"])
        # Alias + glossary maps MERGE with what is stored, like scopes do. A day-scoped run sees
        # only its own day's misconceptions, so replacing would drop the other day's fold.
        aliases = dict(payload.get("misconception_aliases") or {})
        aliases.update(bucket.get("aliases") or {})
        glossary = dict(payload.get("misconception_glossary") or {})
        glossary.update(bucket.get("glossary") or {})
        payload.update({
            "kind": KIND,
            "axis": "objective",                      # ROLLUP-AGREEMENT §5 — interactive lessons
            "activity_slug": c["meta"]["slug"],
            "assignment_slug": c["meta"]["assignment_slug"],
            "generated_by": f"lesson-aggregate@{date.today().isoformat()}",
            "scopes": scopes,
            # Offering-level. The clustering the model does was previously expressed only in prose
            # and discarded; storing it here is what lets the browser fold coined id variants onto
            # a canonical id at render time, so the bars finally reflect the reconciliation.
            "misconception_aliases": aliases,
            "misconception_glossary": glossary,
        })
        try:
            cur.execute("""
                insert into analysis_reports (scope, scope_id, audience_id, kind, payload, generated_at)
                values (%s, %s, null, %s, %s, now())
                on conflict on constraint analysis_reports_unique do update
                   set payload = excluded.payload, generated_at = now()
            """, (SCOPE, oid, KIND, Json(payload)))
            print(f"  [{'dry' if args.dry_run else 'ok '}] offering {oid}: "
                  f"{len(bucket['scopes'])} scope(s) merged into {len(scopes)} stored")
            # Audit row. Only on a real write — a --dry-run did not happen and must not claim to.
            # 'partial' when the whole-course scope was not among them: the lesson is aggregated
            # but not finished, which is a different fact from a clean success.
            if not args.dry_run:
                codes = sorted(s.get("section_code") or k for k, s in bucket["scopes"].items())
                _run_finish(
                    conn,
                    _run_start(conn, c["meta"], "lesson-aggregate", args.invoked_by,
                               (args.day or "").strip().upper() or None),
                    "success" if ALL in bucket["scopes"] else "partial",
                    summary=f"Wrote {len(bucket['scopes'])} scope(s): {', '.join(codes)}."
                            + ("" if ALL in bucket["scopes"] else f" '{ALL}' not written."),
                    detail={"scopes_written": codes,
                            "all_scope": "written" if ALL in bucket["scopes"] else "deferred",
                            "scopes_stored_total": len(scopes)},
                )
            written += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  [err ] offering {oid}: {type(e).__name__}: {str(e).strip().splitlines()[0]}")
            errored += 1

    if args.dry_run:
        conn.rollback()
        print(f"\nDRY RUN — nothing committed. would write={written} row(s) err={errored}")
    else:
        conn.commit()
        print(f"\nCommitted. wrote={written} row(s) err={errored}")


# ── status ─────────────────────────────────────────────────────────────────────────────
def cmd_status(args, conn):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select ar.scope_id, ar.payload, ar.generated_at, act.slug as activity_slug
          from analysis_reports ar
          join assignment_offerings ao on ao.id = ar.scope_id
          join offering_activities  oa on oa.assignment_offering_id = ao.id
          join activities          act on act.id = oa.activity_id and act.modality = 'interactive'
         where ar.scope = %(scope)s and ar.kind = %(kind)s and ar.audience_id is null
           and (%(activity)s is null or act.slug = %(activity)s)
         order by act.slug
    """, {"scope": SCOPE, "kind": KIND, "activity": args.activity})
    rows = cur.fetchall()
    if not rows:
        print("No analysis_reports rows yet." if args.activity is None
              else f"No analysis rows for '{args.activity}' yet.")
        return

    day = (getattr(args, "day", None) or "").strip().upper() or None

    print(f"{'activity / section':50} {'day':>4} {'n':>3} {'quotes':>6} {'reco':>4} {'stale':>5}  generated_at")
    print("-" * 110)
    for r in rows:
        meta = _lesson_meta(conn, r["activity_slug"])
        live = (_load_reports(conn, meta["offering_id"], meta["interactive_id"], meta["written_id"])
                if meta else [])
        by_section_days = {x["section_id"]: x.get("meeting_days") for x in live}
        scopes = (r["payload"] or {}).get("scopes") or {}
        # '__all__' last, matching the pull order.
        for key in sorted(scopes, key=lambda k: (k == ALL, scopes[k].get("section_code") or k)):
            sc = scopes[key]
            # An instructor scope covers the sections it names, not a section of its own. Resolving
            # it here is what keeps n and the fingerprint meaningful — matching an 'instr:' key
            # against section_id never succeeds, so it would otherwise report n=0 and STALE on
            # every run, which reads as a fault rather than a scope of a different shape.
            is_instr_scope = key.startswith(INSTR)
            own_sections = [str(s) for s in (sc.get("section_ids") or [])] if is_instr_scope else []

            # A day-scoped check lists that day's sections plus the course scope, so the M run's
            # post-check does not flag T scopes that legitimately do not exist yet. An instructor
            # scope is in scope for the day if ANY section they teach meets that day.
            if day and key != ALL:
                meets = (any(_meets(by_section_days.get(s), day) for s in own_sections)
                         if is_instr_scope else _meets(by_section_days.get(key), day))
                if not meets:
                    continue

            if key == ALL:
                scope_rows = live
            elif is_instr_scope:
                scope_rows = [x for x in live if str(x["section_id"]) in set(own_sections)]
            else:
                scope_rows = [x for x in live if x["section_id"] == key]
            stored = (sc.get("meta") or {}).get("source_fingerprint")
            stale = "STALE" if stored and stored != _fingerprint(scope_rows) else ""
            name = (", ".join(sc.get("section_codes") or []) or key) if is_instr_scope \
                   else (sc.get("section_code") or key)
            label = f"{r['activity_slug']} / " + (f"{sc.get('instructor_name') or 'instructor'} [{name}]"
                                                  if is_instr_scope else name)
            # An instructor scope carries the readiness summary; a section scope carries the
            # recommendation. Show whichever that scope is responsible for, or the column reads
            # '-' for every instructor row and looks like nothing was written.
            has = ('y' if sc.get('readiness_summary') else '-') if (is_instr_scope or key == ALL) \
                  else ('y' if sc.get('misconception_recommendation') else '-')
            print(f"{label:50} {((sc.get('meta') or {}).get('day') or '-'):>4} {len(scope_rows):>3} "
                  f"{len(sc.get('selected_quotes') or []):>6} "
                  f"{has:>4} "
                  f"{stale:>5}  {r['generated_at']}")
    print(f"\n'{ALL}' showing STALE between two day-scoped runs is EXPECTED — it is the signal "
          f"that the second pass is still owed. Section scopes should be blank.")


def main():
    p = argparse.ArgumentParser(description="Cohort analysis I/O for the /lesson-aggregate skill (schema app).")
    sub = p.add_subparsers(dest="cmd", required=True)

    # --lesson is the accurate name: the unit is an assignment offering worked by either path.
    # --activity / --interaction stay as aliases so existing runbooks and cron entries keep working.
    pl = sub.add_parser("pull", help="dump per-section + whole-course scopes (numbers + AI-input text)")
    pl.add_argument("--lesson", "--activity", "--interaction", dest="activity", required=True,
                    help="assignment slug (preferred) or activity slug of the lesson to aggregate")
    pl.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")
    # No `choices=` on purpose. 001_core_model.sql records that the old ^[MT][135][A-D]$ section
    # CHECK was deliberately dropped for hardcoding a two-course meeting pattern; baking M|T into
    # the CLI would put it straight back. Validated against the offering's real meeting_days.
    pl.add_argument("--day", help="only aggregate sections meeting on this day (e.g. M, T); "
                                  "other sections are carried in as prior_scopes")

    w = sub.add_parser("write-analysis", help="merge model-written scopes into the offering's row")
    w.add_argument("--in", dest="infile", required=True,
                   help="JSON array of {activity_slug, section_id, readiness_summary, "
                        "misconception_trends, misconception_recommendation, selected_quotes}")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")
    w.add_argument("--day", help="record which day track this run covered (audit provenance only; "
                                 "the input file is what decides which scopes are written)")
    w.add_argument("--invoked-by", dest="invoked_by", default="human",
                   choices=["human", "scheduled"],
                   help="who started this run — recorded in analysis_runs")
    # Deliberately NO --day here: the input file names its scopes and the writer merges. A flag
    # would be a second source of truth about which scopes this run touches.

    wl = sub.add_parser("worklist", help="what is past due in a course and whether it was analyzed")
    wl.add_argument("--course", required=True, help="course code, e.g. phys-215")
    wl.add_argument("--day", help="limit to one day track")
    wl.add_argument("--latest", action="store_true",
                    help="the automated contract: report ONLY the most recently due track, and "
                         "whether to run it. Never looks further back — see cmd_worklist")
    wl.add_argument("--json", action="store_true", help="machine-readable output")

    st = sub.add_parser("status", help="list analysis scopes + staleness (the verify step)")
    st.add_argument("--lesson", "--activity", "--interaction", dest="activity",
                    help="limit to one lesson (assignment or activity slug)")
    st.add_argument("--day", help="limit to sections meeting on this day, plus the course scope")

    args = p.parse_args()
    conn = _connect()
    try:
        {"pull": cmd_pull, "write-analysis": cmd_write, "status": cmd_status,
         "worklist": cmd_worklist}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
