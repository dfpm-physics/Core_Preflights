#!/usr/bin/env python
"""interaction_reports.py — DB I/O for the `interaction-analyze` skill.

Connects to Supabase as the scoped `claude_code_recker` role (reads
.claude/skills/interaction-analyze/config.json, or PG* env vars) and exposes three
subcommands used to backfill the schema-1 structured assessment (`report_data`) onto
interaction reports that only have the human-readable `report_markdown`:

  stats                            per-interaction counts: total / structured / missing
  list-missing [--interaction S]   dump reports lacking report_data as JSON (the model reads
               [--all] [--limit N]   this, analyzes each report_markdown, and produces report_data)
               [--out FILE]
  write --in FILE [--force]         apply model-produced report_data back to the rows
               [--dry-run]

Safety:
  * Only `write` mutates, and only sets `report_data` + `effort` (the migration-013 trigger
    derives `score` from `effort`). It never touches the schema — the role has no DDL rights.
  * `write` fills ONLY rows whose report_data IS NULL unless --force is given.
  * --dry-run shows exactly what would change and commits nothing.
  * Reflection-gate guard: if report_data.reading_reflection.meaningful is false, effort is
    clamped to <= 2 before writing (contract §5.2), so the cap can't be bypassed by accident.

All file/stdout I/O is UTF-8 (reports contain emoji such as the 🟡 readiness flag).

Examples (from repo root, project venv):
  .venv/Scripts/python supabase/admin/interaction_reports.py stats
  .venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
      --interaction lesson-02-electric-charge-and-coulombs-law --out batch.json
  .venv/Scripts/python supabase/admin/interaction_reports.py write --in batch.filled.json --dry-run
  .venv/Scripts/python supabase/admin/interaction_reports.py write --in batch.filled.json
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path

# Force UTF-8 on stdout/stderr so emoji in reports never crash printing on Windows (cp1252).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import psycopg2
    from psycopg2.extras import Json
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

CONFIG_SUBPATH = Path(".claude") / "skills" / "interaction-analyze" / "config.json"
MAX_REPORT_DATA_BYTES = 32768  # mirrors DB constraint pir_report_data_size (contract §3)


def _connect():
    """PG* env vars win (first-run testing); otherwise read the gitignored config file."""
    if os.environ.get("PGHOST"):
        params = dict(
            host=os.environ["PGHOST"], port=os.environ.get("PGPORT", "5432"),
            dbname=os.environ.get("PGDATABASE", "postgres"), user=os.environ.get("PGUSER"),
            password=os.environ.get("PGPASSWORD"), sslmode=os.environ.get("PGSSLMODE", "require"),
        )
    else:
        repo_root = Path(__file__).resolve().parents[2]
        path = next((c for c in (repo_root / CONFIG_SUBPATH, Path.home() / CONFIG_SUBPATH)
                     if c.is_file()), None)
        if path is None:
            sys.exit(f"No PG* env vars and no config.json (looked for {CONFIG_SUBPATH}).")
        cfg = json.loads(path.read_text(encoding="utf-8"))
        params = dict(
            host=cfg["host"], port=cfg.get("port", 5432), dbname=cfg.get("dbname", "postgres"),
            user=cfg["user"], password=cfg["password"], sslmode=cfg.get("sslmode", "require"),
        )
    return psycopg2.connect(connect_timeout=int(os.environ.get("PGCONNECT_TIMEOUT", "15")), **params)


def cmd_stats(args, conn):
    cur = conn.cursor()
    cur.execute("""
        select i.id, i.course_id, i.is_published,
               count(r.id)                       as total,
               count(r.report_data)              as with_data,
               count(r.id) - count(r.report_data) as missing
        from interactions i
        left join preflight_interaction_reports r on r.interaction_id = i.id
        group by i.id, i.course_id, i.is_published
        order by i.id
    """)
    rows = cur.fetchall()
    print(f"{'interaction':52} {'course':9} {'pub':5} {'total':>5} {'data':>5} {'missing':>7}")
    print("-" * 88)
    tot = miss = 0
    for iid, course, pub, total, wd, m in rows:
        tot += total or 0
        miss += m or 0
        print(f"{iid:52} {course:9} {str(pub):5} {total:>5} {wd:>5} {m:>7}")
    print("-" * 88)
    print(f"{'TOTAL':52} {'':9} {'':5} {tot:>5} {tot - miss:>5} {miss:>7}")


def cmd_list_missing(args, conn):
    cur = conn.cursor()
    cur.execute("""
        select r.student_id, r.interaction_id, i.title, i.course_id,
               s.name, s.section_id, r.report_markdown,
               (r.report_data is not null) as has_data
        from preflight_interaction_reports r
        join interactions i on i.id = r.interaction_id
        join students s on s.student_id = r.student_id
        where (%(all)s or r.report_data is null)
          and (%(interaction)s is null or r.interaction_id = %(interaction)s)
        order by r.interaction_id, r.student_id
        limit %(limit)s
    """, {"all": args.all, "interaction": args.interaction, "limit": args.limit})
    out = [
        {"student_id": sid, "interaction_id": iid, "interaction_title": title, "course_id": course,
         "name": name, "section": section, "has_data": has, "report_markdown": md}
        for sid, iid, title, course, name, section, md, has in cur.fetchall()
    ]
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {len(out)} report(s) to {args.out}")
    else:
        print(text)


def cmd_write(args, conn):
    items = json.loads(Path(args.infile).read_text(encoding="utf-8"))
    if not isinstance(items, list):
        sys.exit("--in file must be a JSON array of {student_id, interaction_id, report_data}.")

    cur = conn.cursor()
    updated = skipped = errored = 0
    for it in items:
        sid, iid = it.get("student_id"), it.get("interaction_id")
        rd = it.get("report_data")
        tag = f"{iid}/{sid}"
        if sid is None or iid is None or not isinstance(rd, dict):
            print(f"  [err ] {tag}: needs student_id, interaction_id, and report_data object")
            errored += 1
            continue

        # Effort: required, int 0–5. Apply the reflection cap as a server-side guard (§5.2).
        effort = rd.get("effort")
        if not isinstance(effort, int) or not (0 <= effort <= 5):
            print(f"  [err ] {tag}: report_data.effort must be an int 0–5 (got {effort!r})")
            errored += 1
            continue
        refl = rd.get("reading_reflection")
        if isinstance(refl, dict) and refl.get("meaningful") is False and effort > 2:
            print(f"  [cap ] {tag}: reflection not meaningful -> effort {effort} clamped to 2")
            effort = 2
            rd["effort"] = 2

        payload = json.dumps(rd, ensure_ascii=False)
        if len(payload.encode("utf-8")) > MAX_REPORT_DATA_BYTES:
            print(f"  [err ] {tag}: report_data is {len(payload)} bytes (> {MAX_REPORT_DATA_BYTES} limit)")
            errored += 1
            continue

        guard = "" if args.force else " and report_data is null"
        try:
            cur.execute(
                f"update preflight_interaction_reports set report_data = %s, effort = %s "
                f"where student_id = %s and interaction_id = %s{guard}",
                (Json(rd), effort, sid, iid),
            )
            if cur.rowcount == 1:
                print(f"  [{'dry' if args.dry_run else 'ok '}] {tag}: effort={effort} "
                      f"score={2 if effort >= 3 else 1 if effort >= 1 else 0} "
                      f"objectives={len(rd.get('objectives', []))} "
                      f"misconceptions={len(rd.get('misconceptions', []))}")
                updated += 1
            else:
                print(f"  [skip] {tag}: already has report_data (use --force to overwrite)")
                skipped += 1
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
    p = argparse.ArgumentParser(description="Interaction report structured-data backfill I/O.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats", help="per-interaction counts of missing structured data")

    lm = sub.add_parser("list-missing", help="dump reports lacking report_data as JSON")
    lm.add_argument("--interaction", help="limit to one interaction slug")
    lm.add_argument("--all", action="store_true", help="include reports that already have data")
    lm.add_argument("--limit", type=int, default=500)
    lm.add_argument("--out", help="write JSON here (UTF-8) instead of stdout")

    w = sub.add_parser("write", help="apply model-produced report_data back to rows")
    w.add_argument("--in", dest="infile", required=True, help="JSON array of {student_id, interaction_id, report_data}")
    w.add_argument("--force", action="store_true", help="overwrite rows that already have report_data")
    w.add_argument("--dry-run", action="store_true", help="show changes, commit nothing")

    args = p.parse_args()
    conn = _connect()
    try:
        {"stats": cmd_stats, "list-missing": cmd_list_missing, "write": cmd_write}[args.cmd](args, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
