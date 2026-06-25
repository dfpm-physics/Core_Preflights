#!/usr/bin/env python
"""interaction_aggregate.py — DB I/O for the `/interaction-aggregate` skill.

Connects to Supabase as the scoped `claude_code_recker` role (reads supabase/admin/config.json,
or PG* env vars) and produces the COHORT analysis that fills the faculty lesson rollup's three
AI panels — readiness summary, misconception trends, and 2-3 AI-picked reading-reflection quotes
— per section AND for the whole course. Output lands in the `interaction_analysis` table
(migration 014). Distinct from interaction_reports.py, which fills per-student report_data.

Subcommands:

  pull --interaction S --out FILE      Dump everything the model needs to write the analysis:
                                       per-section scopes + a whole-course '__all__' scope, each
                                       with a PRECOMPUTED numeric summary (a focused port of the
                                       UI's summarizeReports, so the prose cites the same figures
                                       the bars show) and the per-report free-text fields the AI
                                       reads (reflection text, misconception descriptions/evidence,
                                       objectives, narratives). No names, no report_markdown.

  write-analysis --in FILE [--dry-run] Upsert model-written rows into interaction_analysis. The
                                       writer re-derives meta.n + meta.source_fingerprint from the
                                       live rows (authoritative), validates section ids and that
                                       every quote references a real report IN THAT section, and
                                       enforces "no quotes on the '__all__' row". Always overwrites
                                       on conflict (analysis is regeneratable). --dry-run commits
                                       nothing.

  status [--interaction S]             List existing analysis rows with n, generated_at, and a
                                       STALE flag (stored fingerprint vs. recomputed from current
                                       reports) — the verify step, since the rollup UI does not
                                       read this table yet.

Safety / scope:
  * Reads report data; writes ONLY interaction_analysis. NEVER touches grades (effort/score) or
    report_data — those are the backfill skill's domain. No DDL (the role has no schema rights).
  * The '__all__' scope carries numbers only (no per-report list, no quotes): whole-course prose
    is synthesized from the per-section reports the model already read.
  * Re-derives n + fingerprint server-side so they can't drift from what was actually aggregated.

All file/stdout I/O is UTF-8 (reflections contain emoji). Run from repo root via the project venv.

Examples:
  .venv/Scripts/python supabase/admin/interaction_aggregate.py pull \
      --interaction lesson-02-electric-charge-and-coulombs-law --out <scratch>/agg.json
  .venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json --dry-run
  .venv/Scripts/python supabase/admin/interaction_aggregate.py write-analysis --in <scratch>/filled.json
  .venv/Scripts/python supabase/admin/interaction_aggregate.py status --interaction lesson-02-electric-charge-and-coulombs-law
"""
import argparse
import hashlib
import io
import json
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

# Force UTF-8 so emoji in reflections never crash printing on Windows (cp1252).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"  # supabase/admin/config.json (gitignored)
ALL = "__all__"                 # whole-course sentinel section_id (matches migration 014)
MAX_PROSE = 8000                # mirrors the DB CHECK on the prose columns
MAX_QUOTES = 5                  # expect 2-3; a hard ceiling so a bad run can't flood the row


def _connect():
    """PG* env vars win (first-run testing); otherwise read the gitignored config file."""
    if os.environ.get("PGHOST"):
        params = dict(
            host=os.environ["PGHOST"], port=os.environ.get("PGPORT", "5432"),
            dbname=os.environ.get("PGDATABASE", "postgres"), user=os.environ.get("PGUSER"),
            password=os.environ.get("PGPASSWORD"), sslmode=os.environ.get("PGSSLMODE", "require"),
        )
    else:
        if not CONFIG_PATH.is_file():
            sys.exit(f"No PG* env vars and no config.json at {CONFIG_PATH}.")
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        params = dict(
            host=cfg["host"], port=cfg.get("port", 5432), dbname=cfg.get("dbname", "postgres"),
            user=cfg["user"], password=cfg["password"], sslmode=cfg.get("sslmode", "require"),
        )
    return psycopg2.connect(connect_timeout=int(os.environ.get("PGCONNECT_TIMEOUT", "15")), **params)


# ── Coercion, mirroring app/js/faculty-interactions.js (contract §7) ─────────────────
# report_data is LLM-produced and occasionally imperfect: keep only valid 0–5 ints / 0–2
# scores; everything else becomes None and drops out of means (null ≠ 0, contract §5.1).
def _int05(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 5 else None

def _score2(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 2 else None

def _mean(xs):
    a = [n for n in xs if n is not None]
    return round(sum(a) / len(a), 2) if a else None

def _points_for_effort(e):              # effort → points, mirroring the DB trigger (013)
    return 0 if e is None else 2 if e >= 3 else 1 if e >= 1 else 0


def summarize(rows):
    """Numeric-only rollup over interaction reports — a focused port of summarizeReports().
    `rows` are dicts with keys: effort, score, report_data (dict). Returns the aggregates the
    readiness/misconception prose cites, so the narrative agrees with the UI's live bars."""
    items = []
    for r in rows:
        d = r.get("report_data")
        items.append({
            "effort": _int05(r.get("effort")),
            "score": _score2(r.get("score")),
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
        points.append(it["score"] if it["score"] is not None else _points_for_effort(e))

    completed = sum(1 for it in items if it["d"].get("completed") is True)
    durations = [it["d"].get("duration_min") for it in items if isinstance(it["d"].get("duration_min"), (int, float)) and not isinstance(it["d"].get("duration_min"), bool)]
    messages = [it["d"].get("message_count") for it in items if isinstance(it["d"].get("message_count"), int) and not isinstance(it["d"].get("message_count"), bool)]

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
                   "points_total": sum(points), "points_max": n * 2},
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


def _load_reports(conn, interaction_id):
    """All reports for one interaction, joined to the student's section. RealDict rows."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select r.student_id, s.section_id, r.effort, r.score, r.report_data, r.updated_at
        from preflight_interaction_reports r
        join students s on s.student_id = r.student_id
        where r.interaction_id = %s
        order by s.section_id, r.student_id
    """, (interaction_id,))
    return cur.fetchall()


def _interaction_meta(conn, interaction_id):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("select id, title, course_id from interactions where id = %s", (interaction_id,))
    return cur.fetchone()


# ── pull ─────────────────────────────────────────────────────────────────────────────
def cmd_pull(args, conn):
    it = _interaction_meta(conn, args.interaction)
    if not it:
        sys.exit(f"No interaction '{args.interaction}'.")
    reports = _load_reports(conn, args.interaction)
    if not reports:
        sys.exit(f"No reports for '{args.interaction}' yet — nothing to aggregate.")

    missing = sum(1 for r in reports if not isinstance(r["report_data"], dict))
    by_section = defaultdict(list)
    for r in reports:
        if r["section_id"]:                       # null-section students fold into '__all__' only
            by_section[r["section_id"]].append(r)

    scopes = []
    # Per-section scopes carry the full per-report text the model reads + picks quotes from.
    for sec in sorted(by_section):
        rows = by_section[sec]
        scopes.append({
            "section_id": sec, "is_whole_course": False, "n": len(rows),
            "source_fingerprint": _fingerprint(rows),
            "numbers": summarize(rows),
            "reports": [{"student_id": r["student_id"], "section_id": sec, **_ai_inputs(r["report_data"])} for r in rows],
        })
    # Whole-course scope: numbers only. Prose is synthesized from the per-section reports above;
    # no quotes (the "All sections" view never shows them — enforced by the DB CHECK too).
    scopes.append({
        "section_id": ALL, "is_whole_course": True, "n": len(reports),
        "source_fingerprint": _fingerprint(reports),
        "numbers": summarize(reports),
        "reports": [],
    })

    out = {
        "interaction_id": it["id"], "interaction_title": it["title"], "course_id": it["course_id"],
        "report_count": len(reports), "missing_report_data": missing,
        "sections": sorted(by_section), "scopes": scopes,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(scopes)} scope(s) over {len(reports)} report(s) to {args.out}")
        if missing:
            print(f"  ⚠ {missing} report(s) lack report_data — run /interaction-backfill first so the "
                  f"numbers are complete (they are excluded from means but skew counts).")
    else:
        print(text)


# ── write-analysis ─────────────────────────────────────────────────────────────────────
def cmd_write(args, conn):
    items = json.loads(Path(args.infile).read_text(encoding="utf-8"))
    if not isinstance(items, list):
        sys.exit("--in file must be a JSON array of {interaction_id, section_id, readiness_summary, "
                 "misconception_trends, selected_quotes}.")

    cur = conn.cursor()
    updated = errored = 0
    # Cache per interaction: valid sections + (student_id → section_id) for quote validation,
    # and the live rows for n + fingerprint.
    cache = {}

    def ctx(iid):
        if iid not in cache:
            rows = _load_reports(conn, iid)
            it = _interaction_meta(conn, iid)
            secs = set()
            if it:
                c = conn.cursor()
                c.execute("select id from sections where course_id = %s", (it["course_id"],))
                secs = {r[0] for r in c.fetchall()}
            cache[iid] = {
                "rows": rows,
                "valid_sections": secs,
                "student_section": {r["student_id"]: r["section_id"] for r in rows},
            }
        return cache[iid]

    for it in items:
        iid, sec = it.get("interaction_id"), it.get("section_id")
        tag = f"{iid}/{sec}"
        rs = it.get("readiness_summary")
        mt = it.get("misconception_trends")
        quotes = it.get("selected_quotes") or []

        if not iid or not sec:
            print(f"  [err ] {tag}: needs interaction_id and section_id")
            errored += 1
            continue
        c = ctx(iid)
        if not c["rows"]:
            print(f"  [err ] {tag}: no reports for interaction '{iid}'")
            errored += 1
            continue
        if sec != ALL and sec not in c["valid_sections"]:
            print(f"  [err ] {tag}: '{sec}' is not a section of this interaction's course (or '{ALL}')")
            errored += 1
            continue
        for fld, val in (("readiness_summary", rs), ("misconception_trends", mt)):
            if val is not None and (not isinstance(val, str) or len(val) > MAX_PROSE):
                print(f"  [err ] {tag}: {fld} must be a string ≤ {MAX_PROSE} chars")
                errored += 1
                break
        else:
            # Validate quotes. '__all__' rows carry none; per-section quotes must reference a real
            # report whose student is actually in that section (no cross-section picks).
            bad = False
            if sec == ALL:
                if quotes:
                    print(f"  [err ] {tag}: the whole-course '{ALL}' row must not carry quotes")
                    bad = True
            else:
                if not isinstance(quotes, list) or len(quotes) > MAX_QUOTES:
                    print(f"  [err ] {tag}: selected_quotes must be a list of ≤ {MAX_QUOTES}")
                    bad = True
                for q in (quotes if isinstance(quotes, list) else []):
                    sid = q.get("student_id") if isinstance(q, dict) else None
                    qsec = q.get("section_id") if isinstance(q, dict) else None
                    if c["student_section"].get(sid) != sec or qsec not in (None, sec):
                        print(f"  [err ] {tag}: quote student_id={sid!r} is not a report in section {sec}")
                        bad = True
            if bad:
                errored += 1
                continue

            # Re-derive n + fingerprint from the live rows so they can't drift from reality.
            scope_rows = c["rows"] if sec == ALL else [r for r in c["rows"] if r["section_id"] == sec]
            norm_quotes = [] if sec == ALL else [{"student_id": q["student_id"], "section_id": sec} for q in quotes]
            meta = dict(it.get("meta") or {})
            meta.update({"n": len(scope_rows), "generated_by": f"interaction-aggregate@{date.today().isoformat()}",
                         "source_fingerprint": _fingerprint(scope_rows)})

            try:
                cur.execute("""
                    insert into interaction_analysis
                        (interaction_id, section_id, readiness_summary, misconception_trends,
                         selected_quotes, meta, generated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    on conflict (interaction_id, section_id) do update set
                        readiness_summary    = excluded.readiness_summary,
                        misconception_trends = excluded.misconception_trends,
                        selected_quotes      = excluded.selected_quotes,
                        meta                 = excluded.meta,
                        generated_at         = now()
                """, (iid, sec, rs, mt, Json(norm_quotes), Json(meta)))
                print(f"  [{'dry' if args.dry_run else 'ok '}] {tag}: n={meta['n']} "
                      f"quotes={len(norm_quotes)} readiness={'y' if rs else '-'} trends={'y' if mt else '-'}")
                updated += 1
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                print(f"  [err ] {tag}: {type(e).__name__}: {str(e).strip().splitlines()[0]}")
                errored += 1

    if args.dry_run:
        conn.rollback()
        print(f"\nDRY RUN — nothing committed. would write={updated} err={errored}")
    else:
        conn.commit()
        print(f"\nCommitted. wrote={updated} err={errored}")


# ── status ─────────────────────────────────────────────────────────────────────────────
def cmd_status(args, conn):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select interaction_id, section_id, meta, generated_at,
               jsonb_array_length(selected_quotes) as quotes
        from interaction_analysis
        where (%(interaction)s is null or interaction_id = %(interaction)s)
        order by interaction_id, (section_id = %(all)s), section_id
    """, {"interaction": args.interaction, "all": ALL})
    rows = cur.fetchall()
    if not rows:
        print("No interaction_analysis rows yet." if args.interaction is None
              else f"No analysis rows for '{args.interaction}' yet.")
        return

    # Recompute each scope's fingerprint from current reports to flag staleness.
    live = {}
    print(f"{'interaction / section':56} {'n':>3} {'quotes':>6} {'stale':>5}  generated_at")
    print("-" * 100)
    for r in rows:
        iid = r["interaction_id"]
        if iid not in live:
            live[iid] = _load_reports(conn, iid)
        sec = r["section_id"]
        scope_rows = live[iid] if sec == ALL else [x for x in live[iid] if x["section_id"] == sec]
        fresh = _fingerprint(scope_rows)
        stored = (r["meta"] or {}).get("source_fingerprint")
        stale = "STALE" if stored and stored != fresh else ""
        label = f"{iid} / {sec}"
        print(f"{label:56} {len(scope_rows):>3} {r['quotes']:>6} {stale:>5}  {r['generated_at']}")


def main():
    p = argparse.ArgumentParser(description="Cohort analysis I/O for the /interaction-aggregate skill.")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("pull", help="dump per-section + whole-course scopes (numbers + AI-input text)")
    pl.add_argument("--interaction", required=True, help="interaction slug to aggregate")
    pl.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")

    w = sub.add_parser("write-analysis", help="upsert model-written analysis rows")
    w.add_argument("--in", dest="infile", required=True,
                   help="JSON array of {interaction_id, section_id, readiness_summary, misconception_trends, selected_quotes}")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")

    st = sub.add_parser("status", help="list analysis rows + staleness (the verify step)")
    st.add_argument("--interaction", help="limit to one interaction slug")

    args = p.parse_args()
    conn = _connect()
    try:
        {"pull": cmd_pull, "write-analysis": cmd_write, "status": cmd_status}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
