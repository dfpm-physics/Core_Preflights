#!/usr/bin/env python3
"""List and update tester feedback on STAGING for the feedback-triage runbook. STAGING ONLY.

Read .ai/skills/feedback-triage/SKILL.md first. This tool is the agent's whole write path into app.feedback.

WHAT THE AGENT MAY DO (migration 089 lifecycle)
  new      -> applied   (simple fix made)          needs --triage simple
  new      -> proposed  (significant; note = plan)  needs --triage significant
  accepted -> applied   (director approved it; the work is done)
  Nothing else. declined and duplicate rows are never touched. The tool writes only status, triage,
  agent_note, agent_ref and agent_at. It never writes a director field, completed_at, or any other column.

USAGE
  list [--status new|accepted|proposed|applied|all] [--json]      reads with the prep_app_read role
  mark <id> --to proposed|applied --triage simple|significant --note "<text>" [--ref <sha>] [--commit]
                                                                   writes with the prep_app_dml role;
                                                                   a dry run (rolled back) without --commit

ENVIRONMENT (from the hub launcher, never printed): STAGING_DB_URL, STAGING_APP_READ_PASSWORD,
  STAGING_APP_DML_PASSWORD. The URL goes through db_target.py, which refuses any project but staging.
  The scoped role is the URL's user with its `postgres` part replaced (pooler form postgres.<ref>).
  submitter_name and submitted_by are never selected; only the role (faculty/student) is shown.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

LIST_FILTERS = ("new", "accepted", "proposed", "applied", "all")
TRIAGES = ("simple", "significant")
NEW_COLUMNS = ("triage", "agent_note", "agent_ref", "agent_at", "director_instructions", "decided_by", "decided_at")
NOTE_MAX, REF_MAX = 4000, 200

# (current status, target status) pairs the agent may perform.
ALLOWED = {("new", "proposed"), ("new", "applied"), ("accepted", "applied")}

LIST_COLS = (
    "id, created_at, role, page, page_title, category, message, status, triage, agent_note, agent_ref, "
    "director_instructions, decided_at, completed_at"
)


class Refusal(Exception):
    pass


def check_transition(current, target, triage, note, ref):
    """Raise Refusal unless the agent may move a row from `current` to `target`. Pure; no database."""
    if target not in ("proposed", "applied"):
        raise Refusal(f"--to must be proposed or applied, not {target!r}")
    if current in ("declined", "duplicate"):
        raise Refusal(f"the row is {current}; the agent never works on it")
    if (current, target) not in ALLOWED:
        raise Refusal(f"{current} -> {target} is not a transition the agent may make")
    if triage not in TRIAGES:
        raise Refusal("--triage must be simple or significant")
    if target == "proposed" and triage != "significant":
        raise Refusal("a proposed row must be triaged significant")
    if (current, target) == ("new", "applied") and triage != "simple":
        raise Refusal("a new row goes straight to applied only when triaged simple")
    if not note or not note.strip():
        raise Refusal("--note is required")
    if len(note) > NOTE_MAX:
        raise Refusal(f"--note is longer than {NOTE_MAX} characters")
    if ref is not None and len(ref) > REF_MAX:
        raise Refusal(f"--ref is longer than {REF_MAX} characters")


def connect(role_env, role):
    import psycopg2

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    t = db_target.exit_unless_staging(url)
    pw = os.environ.get(role_env, "").strip()
    if not pw:
        sys.exit(f"REFUSED  {role_env} is not set.")
    user = f"{role}.{t.ref}" if t.user.startswith("postgres.") else role
    return psycopg2.connect(
        host=t.host, port=int(t.port or 5432), dbname=t.dbname or "postgres", user=user, password=pw,
        sslmode="require", connect_timeout=15,
    )


def columns_missing(cur):
    cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='feedback'"
    )
    have = {r[0] for r in cur.fetchall()}
    return [c for c in NEW_COLUMNS if c not in have]


def need_089(cur):
    missing = columns_missing(cur)
    if missing:
        print("migration 089 not applied on staging: app.feedback lacks " + ", ".join(missing), file=sys.stderr)
        return True
    return False


def cmd_list(args):
    conn = connect("STAGING_APP_READ_PASSWORD", "prep_app_read")
    try:
        cur = conn.cursor()
        if need_089(cur):
            return 2
        sql = f"SELECT {LIST_COLS} FROM app.feedback"
        params = ()
        if args.status != "all":
            sql += " WHERE status = %s"
            params = (args.status,)
        cur.execute(sql + " ORDER BY created_at", params)
        names = [d[0] for d in cur.description]
        rows = [dict(zip(names, r)) for r in cur.fetchall()]
    finally:
        conn.close()
    for r in rows:
        for k, v in r.items():
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
            elif k == "id":
                r[k] = str(v)
    if args.json:
        print(json.dumps(rows, indent=2))
        return 0
    print(f"{len(rows)} item(s), status={args.status}")
    for r in rows:
        print("-" * 60)
        for k in names:
            if r[k] not in (None, ""):
                print(f"{k}: {r[k]}")
    return 0


def cmd_mark(args):
    conn = connect("STAGING_APP_DML_PASSWORD", "prep_app_dml")
    try:
        cur = conn.cursor()
        if need_089(cur):
            return 2
        cur.execute("SELECT status FROM app.feedback WHERE id = %s FOR UPDATE", (args.id,))
        row = cur.fetchone()
        if not row:
            print("REFUSED  no such feedback id, or the role cannot see it", file=sys.stderr)
            return 1
        try:
            check_transition(row[0], args.to, args.triage, args.note, args.ref)
        except Refusal as exc:
            print(f"REFUSED  {exc}", file=sys.stderr)
            conn.rollback()
            return 1
        print(f"plan     {args.id}: {row[0]} -> {args.to}, triage={args.triage}, ref={args.ref or '-'}")
        print(f"note     {args.note}")
        cur.execute(
            "UPDATE app.feedback SET status=%s, triage=%s, agent_note=%s, "
            "agent_ref=COALESCE(%s, agent_ref), agent_at=now() WHERE id=%s",
            (args.to, args.triage, args.note, args.ref, args.id),
        )
        if cur.rowcount != 1:
            conn.rollback()
            print("REFUSED  the update changed no row (row level security?). Rolled back.", file=sys.stderr)
            return 1
        if args.commit:
            conn.commit()
            print("committed.")
        else:
            conn.rollback()
            print("dry run; rolled back. Add --commit to write.")
        return 0
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print(f"FAILED, rolled back. {type(exc).__name__}: {str(exc).strip().splitlines()[0]}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def build_parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--status", choices=LIST_FILTERS, default="new")
    ls.add_argument("--json", action="store_true")
    mk = sub.add_parser("mark")
    mk.add_argument("id")
    mk.add_argument("--to", required=True, choices=("proposed", "applied"))
    mk.add_argument("--triage", required=True, choices=TRIAGES)
    mk.add_argument("--note", required=True)
    mk.add_argument("--ref")
    mk.add_argument("--commit", action="store_true")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    return cmd_list(args) if args.cmd == "list" else cmd_mark(args)


if __name__ == "__main__":
    sys.exit(main())
