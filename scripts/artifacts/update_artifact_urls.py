#!/usr/bin/env python3
r"""
update_artifact_urls.py -- repoint app.activities.content.artifact_url after a republish.

WHY. Republishing a patched artifact into the SAME course offering keeps its slug, so nothing
about the lesson row changes except the claude.ai share URL it points at. That is the only database
change a patched republish needs -- no new activity, no re-registration, no touched submissions.
Doing it by hand across thirty-odd lessons is where a wrong paste silently sends a cohort at the
wrong artifact, so it is done from a file, with every row checked against what is actually stored
before anything is written.

WHAT MAKES IT SAFE

  * It REFUSES on a surprise. Every row names the URL it expects to find. If the stored value is
    anything else -- already updated, updated by someone else, or a slug that was never what the
    file thought it was -- that row is reported and NOTHING is written. A partial run is worse
    than no run, because the half that succeeded looks identical to a full one afterwards.
  * It writes a rollback snapshot BEFORE the update, and `--rollback` replays it. The snapshot is
    the old value keyed by activity id, so a reversal does not depend on this file still existing.
  * Dry run by default (CORE.md section 4). `--commit` writes.
  * Idempotent in the sense that matters: a second run finds every row already at its new value
    and reports "nothing to do" rather than writing again.

WHAT IT WILL NOT DO. Create an activity. A slug in the file with no row in `app.activities` is a
FIRST publish, not a republish, and it needs an assignment, an offering, a due date and a release
decision -- course scheduling, which belongs to the course director in site/faculty/lessons.html.
CORE.md section 2 records what happens when an offering is created without a schedule: an empty
`due_by_day` silently puts every section on the M-day deadline, which it did to 285 cadets. This
script reports those rows and skips them.

INPUT CSV -- header required, extra columns ignored:

    course,lesson,title,file,new_url,old_url,status

`file` is the staged filename from stage_for_upload.py (`<course>_L<NN>_<slug>.jsx`); the slug is
read out of it rather than typed, because a typed slug is how a lesson's identity gets corrupted.
Rows whose `status` is not `replace` are skipped by design.

USAGE
    python scripts/artifacts/update_artifact_urls.py --csv republish.csv
    python scripts/artifacts/update_artifact_urls.py --csv republish.csv --commit
    python scripts/artifacts/update_artifact_urls.py --rollback artifact-url-rollback-*.json --commit

Reads supabase/admin/.env (CORE.md section 3). Uses prep_app_read to verify and prep_app_dml to
write -- never the service role, which would bypass RLS for an operation that does not need it.
Requires psycopg2 from the gitignored .venv.
"""

import argparse
import csv
import json
import pathlib
import re
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not available - activate the .venv (see supabase/admin/)")

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / "supabase" / "admin" / ".env"
SLUG_FROM_FILE = re.compile(r"^phys-\d+_L\d+_(.+)\.jsx$")


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def connect(env, tier):
    """tier: 'READ' (verify) or 'DML' (write). The pooler username is <role>.<project_ref>."""
    return psycopg2.connect(
        host=env["PREP_DB_HOST"], port=env["PREP_DB_PORT"], dbname=env["PREP_DB_NAME"],
        user=f'{env[f"PREP_APP_{tier}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{tier}_PASSWORD"],
        sslmode=env.get("PREP_DB_SSLMODE", "require"))


def read_plan(csv_path):
    plan, skipped = [], []
    with open(csv_path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            m = SLUG_FROM_FILE.match(r.get("file", ""))
            if not m:
                skipped.append((r.get("file", "?"), "filename does not name a slug"))
                continue
            if (r.get("status") or "").strip() != "replace":
                skipped.append((m.group(1), f"status={r.get('status')!r}, not a republish"))
                continue
            plan.append({"slug": m.group(1), "old": r["old_url"].strip(),
                         "new": r["new_url"].strip(), "course": r.get("course", "")})
    return plan, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--csv", help="republish file (see INPUT CSV above)")
    ap.add_argument("--rollback", help="replay a snapshot written by an earlier run")
    ap.add_argument("--snapshot", help="where to write the rollback file "
                                       "(default: artifact-url-rollback.json in the repo root)")
    ap.add_argument("--commit", action="store_true", help="write (default: dry run)")
    ap.add_argument("--index", action="store_true",
                    help="instead of touching the database, record the republish in each course's "
                         "_builder/courses/<id>/index.json (published_url, published_on)")
    ap.add_argument("--published-on", default="",
                    help="date to stamp with --index (YYYY-MM-DD); required with --index")
    args = ap.parse_args()
    if bool(args.csv) == bool(args.rollback):
        sys.exit("give exactly one of --csv or --rollback")

    # ── index bookkeeping ────────────────────────────────────────────────────
    # The repo's own record of what is live, and the only record covering a FIRST publish -- which
    # has a claude.ai URL but no activity row yet, so the database cannot hold it. Kept in the same
    # tool as the URL update because they are one event: skipping this leaves index.json naming
    # artifacts that no longer exist, and stage_for_upload.py builds its checklist from it.
    if args.index:
        if not args.csv:
            sys.exit("--index needs --csv")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.published_on or ""):
            sys.exit("--index needs --published-on YYYY-MM-DD")
        by_slug = {}
        with open(args.csv, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                m = SLUG_FROM_FILE.match(r.get("file", ""))
                if m:
                    by_slug[m.group(1)] = r["new_url"].strip()
        touched = 0
        for course in ("phys-110", "phys-215", "phys-310"):
            path = ROOT / "_builder" / "courses" / course / "index.json"
            if not path.is_file():
                continue
            doc = json.loads(path.read_text(encoding="utf-8"))
            changed = 0
            for a in doc.get("artifacts", []):
                url = by_slug.get(a.get("slug"))
                if url and (a.get("published_url") != url
                            or a.get("published_on") != args.published_on):
                    a["published_url"] = url
                    a["published_on"] = args.published_on
                    changed += 1
            print(f"  {course}: {changed} artifact(s) restamped")
            touched += changed
            if args.commit and changed:
                path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n",
                                encoding="utf-8")
        print(f"\n{touched} entr(ies) updated.")
        if not args.commit:
            print("dry run - nothing written. Re-run with --commit.")
        return

    env = load_env()

    # ── rollback ─────────────────────────────────────────────────────────────
    if args.rollback:
        snap = json.loads(pathlib.Path(args.rollback).read_text(encoding="utf-8"))
        print(f"rollback: {len(snap['rows'])} row(s) from {snap.get('written_by','?')}")
        for r in snap["rows"]:
            print(f"  {r['slug']}\n    -> {r['old'] or '(null)'}")
        if not args.commit:
            print("\ndry run - nothing written. Re-run with --commit.")
            return
        conn = connect(env, "DML")
        cur = conn.cursor()
        for r in snap["rows"]:
            cur.execute("""UPDATE app.activities
                              SET content = jsonb_set(content, '{artifact_url}', to_jsonb(%s::text)),
                                  updated_at = now()
                            WHERE id = %s""", (r["old"], r["id"]))
        conn.commit()
        conn.close()
        print(f"\nrolled back {len(snap['rows'])} row(s).")
        return

    # ── plan ─────────────────────────────────────────────────────────────────
    plan, skipped = read_plan(args.csv)
    print(f"{len(plan)} republish row(s); {len(skipped)} skipped\n")

    conn = connect(env, "READ")
    cur = conn.cursor()
    cur.execute("""SELECT slug, id, content->>'artifact_url'
                     FROM app.activities
                    WHERE modality = 'interactive' AND slug = ANY(%s)""",
                ([p["slug"] for p in plan],))
    live = {s: (i, u) for s, i, u in cur.fetchall()}
    conn.close()

    todo, done, problems = [], [], []
    for p in plan:
        row = live.get(p["slug"])
        if not row:
            problems.append((p["slug"], "no interactive activity with this slug - a FIRST publish, "
                                        "which needs an assignment and a schedule, not a URL update"))
            continue
        aid, cur_url = row
        cur_url = cur_url or ""
        if cur_url == p["new"]:
            done.append(p["slug"])
        elif cur_url == p["old"]:
            todo.append({"slug": p["slug"], "id": aid, "old": cur_url, "new": p["new"]})
        else:
            problems.append((p["slug"], f"stored URL is neither the expected old nor the new value\n"
                                        f"      stored   {cur_url or '(null)'}\n"
                                        f"      expected {p['old'] or '(none)'}"))

    for slug, why in problems:
        print(f"  PROBLEM  {slug}\n      {why}")
    if done:
        print(f"\n  {len(done)} row(s) already at the new URL - nothing to do for them")
    print(f"\n  {len(todo)} row(s) to update")
    for t in todo[:60]:
        print(f"    {t['slug']}\n      {t['old']}\n   -> {t['new']}")

    if problems:
        sys.exit(f"\nREFUSING: {len(problems)} row(s) did not match what is stored. "
                 f"Nothing written. Resolve them, then re-run.")
    if not todo:
        print("\nnothing to do.")
        return
    if not args.commit:
        print("\ndry run - nothing written. Re-run with --commit.")
        return

    # ── snapshot, then write ─────────────────────────────────────────────────
    snap_path = pathlib.Path(args.snapshot or (ROOT / "artifact-url-rollback.json"))
    snap_path.write_text(json.dumps(
        {"written_by": "scripts/artifacts/update_artifact_urls.py",
         "source_csv": str(args.csv), "rows": todo}, indent=2), encoding="utf-8")
    print(f"\nrollback snapshot: {snap_path}")

    conn = connect(env, "DML")
    cur = conn.cursor()
    written = 0
    for t in todo:
        # Guarded on the OLD value as well as the id, so a row that changed between the read above
        # and this write is left alone rather than overwritten.
        cur.execute("""UPDATE app.activities
                          SET content = jsonb_set(content, '{artifact_url}', to_jsonb(%s::text)),
                              updated_at = now()
                        WHERE id = %s AND content->>'artifact_url' = %s""",
                    (t["new"], t["id"], t["old"]))
        written += cur.rowcount
    conn.commit()
    conn.close()

    print(f"updated {written} of {len(todo)} row(s).")
    if written != len(todo):
        sys.exit("MISMATCH: a row changed underneath this run. Re-run to see the current state.")
    print(f"reverse with: python {pathlib.Path(__file__).relative_to(ROOT).as_posix()} "
          f"--rollback {snap_path.name} --commit")


if __name__ == "__main__":
    main()
