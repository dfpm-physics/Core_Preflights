#!/usr/bin/env python
"""lesson_aggregate.py — DB I/O for the `/lesson-aggregate` skill (schema `app`).

Connects to Supabase as the scoped `prep_app_dml` role (supabase/admin/.env, read through
app_tier_check) and produces the COHORT analysis that fills the faculty lesson rollup's three
AI panels — readiness summary, misconception trends, and 2-3 AI-picked reading-reflection quotes
— per section AND for the whole course. Output lands in `app.analysis_reports`. Distinct from
interaction_reports.py, which fills per-student structured content.

Subcommands:

  pull --activity S --out FILE         Dump everything the model needs to write the analysis:
                                       per-section scopes + a whole-course '__all__' scope, each
                                       with a PRECOMPUTED numeric summary (a focused port of the
                                       UI's summarizeReports, so the prose cites the same figures
                                       the bars show) and the per-report free-text fields the AI
                                       reads (reflection text, misconception descriptions/evidence,
                                       objectives, narratives). No names, no report_markdown.

  write-analysis --in FILE [--dry-run] Merge model-written scopes into the offering's
                                       analysis_reports row. The writer re-derives meta.n +
                                       meta.source_fingerprint from the live rows (authoritative),
                                       resolves section codes to ids, validates that every quote
                                       references a real report IN THAT section, and enforces
                                       "no quotes on the '__all__' scope". --dry-run commits
                                       nothing.

  status [--activity S]                List existing analysis scopes with n, generated_at, and a
                                       STALE flag (stored fingerprint vs. recomputed from current
                                       reports) — the verify step, since the rollup UI does not
                                       render this yet.

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
KIND = "readiness"              # analysis_reports.kind this skill owns (ROLLUP-AGREEMENT §6)
SCOPE = "assignment_offering"
MAX_PROSE = 8000                # ROLLUP-AGREEMENT §7
MAX_QUOTES = 5                  # expect 2-3; a hard ceiling so a bad run can't flood the row


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
            "d": d if isinstance(d, dict) else {},
        })
    n = len(items)

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

    # Misconceptions — count by id (the model clusters novel ones by description).
    mc = {}
    for it in items:
        for m in (it["d"].get("misconceptions") or []):
            if not isinstance(m, dict) or not m.get("id"):
                continue
            e = mc.setdefault(m["id"], {"id": m["id"], "label": m.get("label") or m["id"], "count": 0, "major": 0})
            if (not e["label"] or e["label"] == e["id"]) and m.get("label"):
                e["label"] = m["label"]
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
        "free_response_understanding": row.get("q3_understanding"),
        "reading_minutes": d.get("reading_minutes"),
        "objectives": objs, "misconceptions": misc,
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


def _sections(conn, course_offering_id):
    """id -> code and code -> id for the offering, so operators may name sections either way."""
    cur = conn.cursor()
    cur.execute("select id, code from sections where course_offering_id = %s order by code",
                (course_offering_id,))
    rows = cur.fetchall()
    return {str(i): c for i, c in rows}, {c: str(i) for i, c in rows}


def _load_reports(conn, offering_id, interactive_id, written_id, refl_qid=None):
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
               g.effort, g.points_earned, g.diagnostic,
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
        r["reflection_text"] = None
        if refl_qid and isinstance(r["written_content"], dict):
            answers = r["written_content"].get("answers")
            answers = answers if isinstance(answers, dict) else r["written_content"]
            val = answers.get(refl_qid)
            if isinstance(val, str) and val.strip():
                r["reflection_text"] = val.strip()

        del r["interactive_content"], r["written_content"]
    return rows


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
    reports = _load_reports(conn, meta["offering_id"], meta["interactive_id"],
                            meta["written_id"], refl_qid)
    if not reports:
        sys.exit(f"No work recorded for '{args.activity}' yet — nothing to aggregate.")

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

    scopes = []
    # Per-section scopes carry the full per-report text the model reads + picks quotes from.
    for sec_id in sorted(by_section, key=lambda s: by_section[s][0]["section_code"]):
        rows = by_section[sec_id]
        scopes.append({
            "section_id": sec_id, "section_code": rows[0]["section_code"],
            "is_whole_course": False, "n": len(rows),
            "source_fingerprint": _fingerprint(rows),
            "numbers": summarize(rows, pp),
            "reports": [{"student_id": r["student_id"], "section_id": sec_id,
                         **_ai_inputs(r["report_data"], r)} for r in rows],
        })
    # Whole-course scope: numbers only. Prose is synthesized from the per-section reports above;
    # no quotes (the "All sections" view never shows them).
    scopes.append({
        "section_id": ALL, "section_code": ALL, "is_whole_course": True, "n": len(reports),
        "source_fingerprint": _fingerprint(reports),
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
        "reflection_question_id": refl_qid,
        "report_count": len(reports), "missing_report_data": missing,
        "sections": [{"id": s["section_id"], "code": s["section_code"]}
                     for s in scopes if not s["is_whole_course"]],
        "scopes": scopes,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(scopes)} scope(s) over {len(reports)} report(s) to {args.out}")
        p = out["paths"]
        print(f"  paths: {p['interactive_n']} interactive, {p['written_n']} written"
              f"{' (mixed cohort)' if p['mixed'] else ''}")
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

        # Operators may name a section by uuid or by code ('M1A'); '__all__' is the whole course.
        sec = str(sec)
        if sec != ALL:
            sec = c["section_id"].get(sec, sec)
            if sec not in c["section_code"]:
                print(f"  [err ] {tag}: not a section of this offering (or '{ALL}')")
                errored += 1
                continue

        bad = False
        for fld, val in (("readiness_summary", rs), ("misconception_trends", mt)):
            if val is not None and (not isinstance(val, str) or len(val) > MAX_PROSE):
                print(f"  [err ] {tag}: {fld} must be a string ≤ {MAX_PROSE} chars")
                bad = True
        # Quotes: '__all__' carries none; per-section quotes must reference a real report whose
        # student is actually in that section (no cross-section picks).
        if sec == ALL:
            if quotes:
                print(f"  [err ] {tag}: the whole-course '{ALL}' scope must not carry quotes")
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

        # Re-derive n + fingerprint from the live rows so they can't drift from reality.
        rows = c["rows"] if sec == ALL else [r for r in c["rows"] if r["section_id"] == sec]
        scope_meta = dict(it.get("meta") or {})
        scope_meta.update({"n": len(rows),
                           "generated_by": f"lesson-aggregate@{date.today().isoformat()}",
                           "source_fingerprint": _fingerprint(rows)})
        oid = str(c["meta"]["offering_id"])
        bucket = pending.setdefault(oid, {"ctx": c, "scopes": {}})
        bucket["scopes"][sec] = {
            "section_id": None if sec == ALL else sec,
            "section_code": ALL if sec == ALL else c["section_code"][sec],
            "readiness_summary": rs,
            "misconception_trends": mt,
            "selected_quotes": [] if sec == ALL
                               else [{"student_id": q["student_id"], "section_id": sec} for q in quotes],
            "meta": scope_meta,
        }
        print(f"  [{'dry' if args.dry_run else 'ok '}] {tag}: n={scope_meta['n']} "
              f"quotes={len(bucket['scopes'][sec]['selected_quotes'])} "
              f"readiness={'y' if rs else '-'} trends={'y' if mt else '-'}")

    # One row per offering. MERGE into any existing payload so scopes written by an earlier run
    # (e.g. the M-day pass) survive this one — the per-scope independence the old per-section
    # rows gave for free.
    written = 0
    for oid, bucket in pending.items():
        c = bucket["ctx"]
        payload = _existing_payload(conn, oid)
        scopes = dict(payload.get("scopes") or {})
        scopes.update(bucket["scopes"])
        payload.update({
            "kind": KIND,
            "axis": "objective",                      # ROLLUP-AGREEMENT §5 — interactive lessons
            "activity_slug": c["meta"]["slug"],
            "assignment_slug": c["meta"]["assignment_slug"],
            "generated_by": f"lesson-aggregate@{date.today().isoformat()}",
            "scopes": scopes,
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

    print(f"{'activity / section':56} {'n':>3} {'quotes':>6} {'stale':>5}  generated_at")
    print("-" * 100)
    for r in rows:
        meta = _lesson_meta(conn, r["activity_slug"])
        live = (_load_reports(conn, meta["offering_id"], meta["interactive_id"], meta["written_id"])
                if meta else [])
        scopes = (r["payload"] or {}).get("scopes") or {}
        # '__all__' last, matching the pull order.
        for key in sorted(scopes, key=lambda k: (k == ALL, scopes[k].get("section_code") or k)):
            sc = scopes[key]
            scope_rows = live if key == ALL else [x for x in live if x["section_id"] == key]
            stored = (sc.get("meta") or {}).get("source_fingerprint")
            stale = "STALE" if stored and stored != _fingerprint(scope_rows) else ""
            label = f"{r['activity_slug']} / {sc.get('section_code') or key}"
            print(f"{label:56} {len(scope_rows):>3} {len(sc.get('selected_quotes') or []):>6} "
                  f"{stale:>5}  {r['generated_at']}")


def main():
    p = argparse.ArgumentParser(description="Cohort analysis I/O for the /lesson-aggregate skill (schema app).")
    sub = p.add_subparsers(dest="cmd", required=True)

    # --lesson is the accurate name: the unit is an assignment offering worked by either path.
    # --activity / --interaction stay as aliases so existing runbooks and cron entries keep working.
    pl = sub.add_parser("pull", help="dump per-section + whole-course scopes (numbers + AI-input text)")
    pl.add_argument("--lesson", "--activity", "--interaction", dest="activity", required=True,
                    help="assignment slug (preferred) or activity slug of the lesson to aggregate")
    pl.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")

    w = sub.add_parser("write-analysis", help="merge model-written scopes into the offering's row")
    w.add_argument("--in", dest="infile", required=True,
                   help="JSON array of {activity_slug, section_id, readiness_summary, misconception_trends, selected_quotes}")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")

    st = sub.add_parser("status", help="list analysis scopes + staleness (the verify step)")
    st.add_argument("--lesson", "--activity", "--interaction", dest="activity",
                    help="limit to one lesson (assignment or activity slug)")

    args = p.parse_args()
    conn = _connect()
    try:
        {"pull": cmd_pull, "write-analysis": cmd_write, "status": cmd_status}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
