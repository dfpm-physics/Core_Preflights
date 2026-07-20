#!/usr/bin/env python
"""interaction_aggregate.py — DB I/O for the `/interaction-aggregate` skill (schema `app`).

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
  .venv/Scripts/python supabase/admin/interaction_aggregate.py pull \
      --activity lesson-02-electric-charge-coulombs-law --out <scratch>/agg.json
  .venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
  .venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json
  .venv/Scripts/python supabase/admin/interaction_aggregate.py status --activity lesson-02-electric-charge-coulombs-law
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
            "points": _num(r.get("points_earned")),
            "d": d if isinstance(d, dict) else {},
        })
    n = len(items)

    effort_hist = [0, 0, 0, 0, 0, 0]
    effort_na = 0
    efforts, points = [], []
    for it in items:
        e = it["effort"] if it["effort"] is not None else _int05(it["d"].get("effort"))
        if e is None:
            effort_na += 1
        else:
            effort_hist[e] += 1
            efforts.append(e)
        points.append(it["points"] if it["points"] is not None else _points_for_effort(e, pp))

    completed = sum(1 for it in items if it["d"].get("completed") is True)
    durations = [it["d"].get("duration_min") for it in items
                 if isinstance(it["d"].get("duration_min"), (int, float))
                 and not isinstance(it["d"].get("duration_min"), bool)]
    messages = [it["d"].get("message_count") for it in items
                if isinstance(it["d"].get("message_count"), int)
                and not isinstance(it["d"].get("message_count"), bool)]

    overall = [_int05(it["d"].get("overall_understanding")) for it in items]
    self_rated = [_int05(it["d"].get("self_rated_understanding")) for it in items]
    overall_hist = [0, 0, 0, 0, 0, 0]
    for u in overall:
        if u is not None:
            overall_hist[u] += 1

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
    objectives = sorted(
        ({"key": m["key"], "label": m["label"], "assessed": len(m["u"]),
          "understanding": _mean(m["u"]), "confidence": _mean(m["c"])} for m in obj.values()),
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
        "effort": {"hist": effort_hist, "not_assessed": effort_na, "avg": _mean(efforts),
                   "points_total": round(sum(points), 2), "points_max": round(n * pp, 2)},
        "completed": completed, "completed_pct": round(completed / n * 100) if n else 0,
        "duration_avg": _mean(durations), "message_avg": _mean(messages),
        "understanding": {"overall": _mean(overall), "self": _mean(self_rated), "dist": overall_hist,
                          "gap": (round(_mean(self_rated) - _mean(overall), 2)
                                  if _mean(self_rated) is not None and _mean(overall) is not None else None)},
        "objectives": objectives,
        "misconceptions": misconceptions,
        "reflection": {"meaningful": refl_meaningful, "assessed": refl_assessed,
                       "capped": refl_assessed - refl_meaningful, "engagement": _mean(refl_eng),
                       "sentiment": sentiment, "topics": topics},
        "honor": honor, "flags": flags,
    }


def _ai_inputs(d):
    """The free-text fields the model reads to write prose + pick quotes (contract §5)."""
    if not isinstance(d, dict):
        d = {}
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
        "effort": d.get("effort"), "effort_rationale": d.get("effort_rationale"),
        "completed": d.get("completed"),
        "overall_understanding": d.get("overall_understanding"),
        "self_rated_understanding": d.get("self_rated_understanding"),
        "objectives": objs, "misconceptions": misc,
        "reflection": {"text": r.get("text"), "meaningful": r.get("meaningful"),
                       "engagement": r.get("engagement"), "topics": r.get("topics"),
                       "sentiment": r.get("sentiment")},
        "ai_summary": d.get("ai_summary"), "key_strengths": d.get("key_strengths"),
        "recommended_review": d.get("recommended_review"),
        "flags": d.get("flags"),
    }


def _fingerprint(scope_rows):
    """Stable hash over a scope's input rows → staleness check. updated_at moves on every
    re-submit/edit, so the fingerprint changes when the underlying reports change."""
    basis = sorted((str(r["student_id"]), str(r["updated_at"]), r.get("effort")) for r in scope_rows)
    return hashlib.sha1(json.dumps(basis, default=str).encode("utf-8")).hexdigest()[:16]


def _activity_meta(conn, slug):
    """The interactive activity plus the ONE active offering that schedules it.

    An activity can be re-offered in a later term, so the offering is not implied by the slug;
    this refuses to guess when more than one active offering claims it.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select act.id as activity_id, act.slug, act.title as activity_title,
               a.slug as assignment_slug, a.title as assignment_title,
               ao.id as offering_id, ao.points_possible, ao.grading_mode, ao.is_published,
               co.id as course_offering_id, c.code as course_code, t.code as term_code
          from activities act
          join assignments          a  on a.id  = act.assignment_id
          join offering_activities  oa on oa.activity_id = act.id
          join assignment_offerings ao on ao.id  = oa.assignment_offering_id
          join course_offerings     co on co.id  = ao.course_offering_id
          join courses              c  on c.id   = co.course_id
          join terms                t  on t.id   = co.term_id
         where act.slug = %s and act.modality = 'interactive' and co.is_active
    """, (slug,))
    rows = cur.fetchall()
    if not rows:
        return None
    if len(rows) > 1:
        terms = ", ".join(sorted({r["term_code"] for r in rows}))
        sys.exit(f"'{slug}' is scheduled in more than one active offering ({terms}) — "
                 f"deactivate the stale course_offering before aggregating.")
    return rows[0]


def _sections(conn, course_offering_id):
    """id -> code and code -> id for the offering, so operators may name sections either way."""
    cur = conn.cursor()
    cur.execute("select id, code from sections where course_offering_id = %s order by code",
                (course_offering_id,))
    rows = cur.fetchall()
    return {str(i): c for i, c in rows}, {c: str(i) for i, c in rows}


def _load_reports(conn, activity_id, offering_id):
    """All work on one interactive activity, joined to the enrolment's section and its grade."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select e.student_id, e.id as enrollment_id, sec.id as section_id, sec.code as section_code,
               g.effort, g.points_earned, sa.content as report_data, sa.updated_at
          from submission_activities sa
          join submissions  s   on s.id   = sa.submission_id
          join enrollments  e   on e.id   = s.enrollment_id
          join sections     sec on sec.id = e.section_id
          left join grades  g   on g.enrollment_id = s.enrollment_id
                               and g.assignment_offering_id = s.assignment_offering_id
         where sa.activity_id = %s and s.assignment_offering_id = %s
         order by sec.code, e.student_id
    """, (activity_id, offering_id))
    rows = cur.fetchall()
    for r in rows:                      # uuids -> str so they compare against JSON payload keys
        r["section_id"] = str(r["section_id"])
        r["enrollment_id"] = str(r["enrollment_id"])
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
    meta = _activity_meta(conn, args.activity)
    if not meta:
        sys.exit(f"No interactive activity '{args.activity}' in an active offering.")
    reports = _load_reports(conn, meta["activity_id"], meta["offering_id"])
    if not reports:
        sys.exit(f"No work recorded for '{args.activity}' yet — nothing to aggregate.")

    pp = meta["points_possible"]
    missing = sum(1 for r in reports if not isinstance(r["report_data"], dict))
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
                         **_ai_inputs(r["report_data"])} for r in rows],
        })
    # Whole-course scope: numbers only. Prose is synthesized from the per-section reports above;
    # no quotes (the "All sections" view never shows them).
    scopes.append({
        "section_id": ALL, "section_code": ALL, "is_whole_course": True, "n": len(reports),
        "source_fingerprint": _fingerprint(reports),
        "numbers": summarize(reports, pp),
        "reports": [],
    })

    out = {
        "activity_slug": meta["slug"], "activity_title": meta["activity_title"],
        "assignment_slug": meta["assignment_slug"], "assignment_title": meta["assignment_title"],
        "assignment_offering_id": str(meta["offering_id"]),
        "course_code": meta["course_code"], "term_code": meta["term_code"],
        "points_possible": float(pp), "grading_mode": meta["grading_mode"],
        "report_count": len(reports), "missing_report_data": missing,
        "sections": [{"id": s["section_id"], "code": s["section_code"]}
                     for s in scopes if not s["is_whole_course"]],
        "scopes": scopes,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(scopes)} scope(s) over {len(reports)} report(s) to {args.out}")
        if missing:
            print(f"  ⚠ {missing} report(s) lack structured content — run /interaction-backfill first "
                  f"so the numbers are complete (they are excluded from means but skew counts).")
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
            meta = _activity_meta(conn, slug)
            if not meta:
                return None
            rows = _load_reports(conn, meta["activity_id"], meta["offering_id"])
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
                           "generated_by": f"interaction-aggregate@{date.today().isoformat()}",
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
            "generated_by": f"interaction-aggregate@{date.today().isoformat()}",
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
        meta = _activity_meta(conn, r["activity_slug"])
        live = _load_reports(conn, meta["activity_id"], meta["offering_id"]) if meta else []
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
    p = argparse.ArgumentParser(description="Cohort analysis I/O for the /interaction-aggregate skill (schema app).")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("pull", help="dump per-section + whole-course scopes (numbers + AI-input text)")
    pl.add_argument("--activity", "--interaction", dest="activity", required=True,
                    help="interactive activity slug to aggregate")
    pl.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")

    w = sub.add_parser("write-analysis", help="merge model-written scopes into the offering's row")
    w.add_argument("--in", dest="infile", required=True,
                   help="JSON array of {activity_slug, section_id, readiness_summary, misconception_trends, selected_quotes}")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")

    st = sub.add_parser("status", help="list analysis scopes + staleness (the verify step)")
    st.add_argument("--activity", "--interaction", dest="activity", help="limit to one activity slug")

    args = p.parse_args()
    conn = _connect()
    try:
        {"pull": cmd_pull, "write-analysis": cmd_write, "status": cmd_status}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
