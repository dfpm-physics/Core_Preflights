#!/usr/bin/env python
"""interaction_reports.py — DB I/O for the `interaction-backfill` skill (schema `app`).

Connects to Supabase as the scoped `prep_app_dml` role (supabase/admin/.env, read through
app_tier_check) and exposes three subcommands used to backfill the schema-1 structured
assessment onto interactive-activity work that only has the human-readable Markdown:

  stats                          per-activity counts: total / structured / missing
  list-missing [--activity S]    dump work lacking structured content as JSON (the model reads
               [--all] [--limit N]  this, analyzes each report_markdown, and produces report_data)
               [--out FILE]
  write --in FILE [--force]      apply model-produced report_data back to the rows
               [--dry-run]

WHERE THE DATA LIVES NOW (PREP v2 — schema `app`)
  The `public` tables this script used are gone from the workflow:

    interactions                     -> activities WHERE modality = 'interactive'
                                        (activities.slug is the old interactions.id verbatim —
                                        the FROZEN artifact contract surface)
    preflight_interaction_reports    -> submission_activities, reached through submissions
    ...report_data                   -> submission_activities.content
    ...report_markdown               -> submission_activities.report_markdown
    ...effort / score                -> grades.effort / grades.points_earned
    students.section_id              -> enrollments (student_id, section_id)

  Everything per-student keys on `enrollment_id`, not `student_id`, so moving a cadet between
  sections no longer re-attributes their history.

  THE ONE BEHAVIOURAL CHANGE — effort no longer implies points on its own. In `public` a DB
  trigger turned preflight_interaction_reports.effort into a 0-2 score unconditionally. In `app`
  the equivalent trigger (grades_points_from_effort) fires ONLY when the offering is
  grading_mode='effort', and every migrated Fall-2026 offering is grading_mode='points'. So this
  script computes points_earned itself, from the same migration-013 curve scaled to the
  offering's points_possible (3-5 -> full, 1-2 -> half, 0/None -> zero). On an effort-mode
  offering the trigger recomputes the identical value, so writing it is safe either way.

Safety:
  * Only `write` mutates. It sets submission_activities.content and upserts one app.grades row
    (effort + points_earned). It never touches the schema — the DML tier has no DDL rights.
  * A FINALIZED grade is never overwritten (the ON CONFLICT carries `WHERE NOT is_finalized`);
    the content is still repaired and the grade skip is reported.
  * `write` fills ONLY rows whose content IS NULL unless --force is given.
  * --dry-run shows exactly what would change and commits nothing.
  * Reflection-gate guard: if report_data.reading_reflection.meaningful is false, effort is
    clamped to <= 2 before writing (contract §5.2), so the cap can't be bypassed by accident.

All file/stdout I/O is UTF-8 (reports contain emoji such as the 🟡 readiness flag).

Examples (from repo root, project venv):
  .venv/Scripts/python supabase/admin/interaction_reports.py stats
  .venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
      --activity lesson-02-electric-charge-coulombs-law --out batch.json
  .venv/Scripts/python supabase/admin/interaction_reports.py write --in batch.filled.json --dry-run
  .venv/Scripts/python supabase/admin/interaction_reports.py write --in batch.filled.json
"""
import argparse
import io
import json
import sys
from decimal import Decimal
from pathlib import Path

# Force UTF-8 on stdout/stderr so emoji in reports never crash printing on Windows (cp1252).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_tier_check import load, connect  # noqa: E402

MAX_CONTENT_BYTES = 32768  # mirrors app.submission_activities_content_size (contract §3)


def _connect():
    """THE one place the schema is selected.

    psycopg2 has no PostgREST profile header, so the equivalent single switch is the
    search_path set on the session here. Every query below is therefore unqualified and
    resolves inside `app`; nothing in this file can reach `public` by accident.

    Uses the DML tier (read/write on `app`, no DDL) from supabase/admin/.env — NOT the legacy
    claude_code_recker credential in config.json, which only ever had rights in `public`.
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


def points_from_effort(effort, points_possible):
    """Effort (0-5) -> points, scaled to the offering's value.

    MUST stay identical to app.grades_points_from_effort() (001_core_model.sql) and to
    pointsFromEffort() in site/app/js/schema.js — three copies of the migration-013 curve that
    must agree, because on an effort-mode offering the trigger overwrites whatever we send.
    """
    pp = Decimal(points_possible)
    if effort is None:
        return Decimal("0")
    if effort >= 3:
        return pp
    if effort >= 1:
        return round(pp / 2, 2)
    return Decimal("0")


def cmd_stats(args, conn):
    cur = conn.cursor()
    cur.execute("""
        select act.slug, c.code, ao.is_published,
               count(sa.id)                        as total,
               count(sa.content)                   as with_data,
               count(sa.id) - count(sa.content)    as missing
          from activities act
          join offering_activities  oa on oa.activity_id = act.id
          join assignment_offerings ao on ao.id = oa.assignment_offering_id
          join course_offerings     co on co.id = ao.course_offering_id
          join courses              c  on c.id  = co.course_id
          left join submissions          s  on s.assignment_offering_id = ao.id
          left join submission_activities sa on sa.submission_id = s.id
                                            and sa.activity_id   = act.id
         where act.modality = 'interactive'
         group by act.slug, c.code, ao.is_published
         order by act.slug
    """)
    rows = cur.fetchall()
    print(f"{'activity (interactive)':52} {'course':9} {'pub':5} {'total':>5} {'data':>5} {'missing':>7}")
    print("-" * 88)
    tot = miss = 0
    for slug, course, pub, total, wd, m in rows:
        tot += total or 0
        miss += m or 0
        print(f"{slug:52} {course:9} {str(pub):5} {total:>5} {wd:>5} {m:>7}")
    print("-" * 88)
    print(f"{'TOTAL':52} {'':9} {'':5} {tot:>5} {tot - miss:>5} {miss:>7}")


def cmd_list_missing(args, conn):
    cur = conn.cursor()
    cur.execute("""
        select st.student_id, act.slug, a.title, c.code, st.name, sec.code,
               sa.report_markdown, (sa.content is not null) as has_data
          from submission_activities sa
          join submissions          s   on s.id   = sa.submission_id
          join activities           act on act.id = sa.activity_id
          join assignments          a   on a.id   = act.assignment_id
          join assignment_offerings ao  on ao.id  = s.assignment_offering_id
          join course_offerings     co  on co.id  = ao.course_offering_id
          join courses              c   on c.id   = co.course_id
          join enrollments          e   on e.id   = s.enrollment_id
          join students             st  on st.student_id = e.student_id
          join sections             sec on sec.id = e.section_id
         where act.modality = 'interactive'
           and (%(all)s or sa.content is null)
           and (%(activity)s is null or act.slug = %(activity)s)
         order by act.slug, st.student_id
         limit %(limit)s
    """, {"all": args.all, "activity": args.activity, "limit": args.limit})
    out = [
        {"student_id": sid, "activity_slug": slug, "activity_title": title, "course_code": course,
         "name": name, "section": section, "has_data": has, "report_markdown": md}
        for sid, slug, title, course, name, section, md, has in cur.fetchall()
    ]
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(out)} report(s) to {args.out}")
    else:
        print(text)


def _target(conn, student_id, activity_slug):
    """Resolve (cadet, interactive activity) to the exact rows a write touches.

    One lookup rather than a compound UPDATE: the write has two destinations now
    (submission_activities.content and a grades row), and both need the same submission,
    enrollment and offering.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        select sa.id as submission_activity_id, s.id as submission_id,
               s.enrollment_id, s.assignment_offering_id,
               ao.points_possible, ao.grading_mode,
               (sa.content is not null) as has_data
          from submission_activities sa
          join submissions          s   on s.id   = sa.submission_id
          join activities           act on act.id = sa.activity_id
          join enrollments          e   on e.id   = s.enrollment_id
          join assignment_offerings ao  on ao.id  = s.assignment_offering_id
         where act.slug = %s and act.modality = 'interactive' and e.student_id = %s
    """, (activity_slug, student_id))
    return cur.fetchone()


def cmd_write(args, conn):
    items = json.loads(Path(args.infile).read_text(encoding="utf-8"))
    if not isinstance(items, list):
        sys.exit("--in file must be a JSON array of {student_id, activity_slug, report_data}.")

    cur = conn.cursor()
    updated = skipped = errored = 0
    for it in items:
        sid = it.get("student_id")
        slug = it.get("activity_slug") or it.get("interaction_id")   # legacy key still accepted
        rd = it.get("report_data")
        tag = f"{slug}/{sid}"
        if sid is None or slug is None or not isinstance(rd, dict):
            print(f"  [err ] {tag}: needs student_id, activity_slug, and report_data object")
            errored += 1
            continue

        # Effort: required, int 0–5. Apply the reflection cap as a server-side guard (§5.2).
        effort = rd.get("effort")
        if not isinstance(effort, int) or isinstance(effort, bool) or not (0 <= effort <= 5):
            print(f"  [err ] {tag}: report_data.effort must be an int 0–5 (got {effort!r})")
            errored += 1
            continue
        refl = rd.get("reading_reflection")
        if isinstance(refl, dict) and refl.get("meaningful") is False and effort > 2:
            print(f"  [cap ] {tag}: reflection not meaningful -> effort {effort} clamped to 2")
            effort = 2
            rd["effort"] = 2

        payload = json.dumps(rd, ensure_ascii=False)
        if len(payload.encode("utf-8")) > MAX_CONTENT_BYTES:
            print(f"  [err ] {tag}: report_data is {len(payload)} bytes (> {MAX_CONTENT_BYTES} limit)")
            errored += 1
            continue

        tgt = _target(conn, sid, slug)
        if not tgt:
            print(f"  [err ] {tag}: no submission_activities row — the cadet has not engaged "
                  f"with this interactive activity")
            errored += 1
            continue
        if tgt["has_data"] and not args.force:
            print(f"  [skip] {tag}: already has structured content (use --force to overwrite)")
            skipped += 1
            continue

        pts = points_from_effort(effort, tgt["points_possible"])
        try:
            cur.execute("update submission_activities set content = %s where id = %s",
                        (Json(rd), tgt["submission_activity_id"]))
            # One grade per (enrollment, offering). A finalized grade is the instructor's —
            # repair the content but leave their number alone.
            cur.execute("""
                insert into grades (enrollment_id, assignment_offering_id, submission_id,
                                    points_earned, points_possible, effort,
                                    source, is_finalized, graded_at)
                values (%s, %s, %s, %s, %s, %s, 'ai_suggested', false, now())
                on conflict (enrollment_id, assignment_offering_id) do update
                   set effort          = excluded.effort,
                       points_earned   = excluded.points_earned,
                       points_possible = excluded.points_possible,
                       submission_id   = coalesce(grades.submission_id, excluded.submission_id),
                       source          = 'ai_suggested',
                       graded_at       = now()
                 where not grades.is_finalized
            """, (tgt["enrollment_id"], tgt["assignment_offering_id"], tgt["submission_id"],
                  pts, tgt["points_possible"], effort))
            graded = "graded" if cur.rowcount == 1 else "GRADE KEPT (finalized)"
            print(f"  [{'dry' if args.dry_run else 'ok '}] {tag}: effort={effort} "
                  f"points={pts}/{tgt['points_possible']} ({graded}) "
                  f"objectives={len(rd.get('objectives', []))} "
                  f"misconceptions={len(rd.get('misconceptions', []))}")
            updated += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  [err ] {tag}: {type(e).__name__}: {str(e).strip().splitlines()[0]}")
            errored += 1

    if args.dry_run:
        conn.rollback()
        print(f"\nDRY RUN — nothing committed. would update={updated} skip={skipped} err={errored}")
    else:
        conn.commit()
        print(f"\nCommitted. updated={updated} skip={skipped} err={errored}")


def main():
    p = argparse.ArgumentParser(description="Interactive-activity structured-data backfill I/O (schema app).")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats", help="per-activity counts of missing structured data")

    lm = sub.add_parser("list-missing", help="dump interactive work lacking structured content")
    lm.add_argument("--activity", "--interaction", dest="activity",
                    help="limit to one activity slug (the artifact's #i= value)")
    lm.add_argument("--all", action="store_true", help="include rows that already have content")
    lm.add_argument("--limit", type=int, default=500)
    lm.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")

    w = sub.add_parser("write", help="apply model-produced report_data back to rows")
    w.add_argument("--in", dest="infile", required=True,
                   help="JSON array of {student_id, activity_slug, report_data}")
    w.add_argument("--force", action="store_true", help="overwrite rows that already have content")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")

    args = p.parse_args()
    conn = _connect()
    try:
        {"stats": cmd_stats, "list-missing": cmd_list_missing, "write": cmd_write}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
