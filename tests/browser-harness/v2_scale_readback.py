#!/usr/bin/env python3
"""Read back the letter scale of a staging course offering, for tests/browser-harness/v2-scale.mjs. STAGING only.

Prints JSON on stdout. Reads STAGING_DB_URL and refuses anything that is not the staging project.

  read <course-offering-id>
      Every letter_scales row of the offering, newest version first: version, lines, width, retired or not, and
      whether created_by is set. Also is_active and the course code.
  reset <course-offering-id>
      Deletes the letter_scales rows of an INACTIVE gate course offering so a walkthrough starts from the default.
      Refuses any offering that is active or whose course code is not gate-entry. Prints the count removed.
  valid <cases.json>
      Asks letter_scale_is_valid (the database's own check) about every case in tests/app-schema/scale-cases.json.
      Prints the list of answers in order.
  preview <course-offering-id> <lines-json> <width>
      Runs scale_change_preview as the gate director under row-level security (the same call the page makes),
      inside a transaction that is rolled back, and prints the rows. Writes nothing.
  totals <course-offering-id>
      A fingerprint of the offering's totals (letter and near-line flag per enrollment) from the owner side, so a
      test can show that looking at a scale moved nothing.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
from staging_guard import require_staging  # noqa: E402


def connect(write=False):
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    conn.set_session(readonly=not write)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    return conn, cur


def read(offering):
    conn, cur = connect()
    cur.execute("""SELECT co.is_active, c.code FROM course_offerings co JOIN courses c ON c.id = co.course_id
                    WHERE co.id = %s""", (offering,))
    is_active, code = cur.fetchone()
    cur.execute("""SELECT version, lines, near_line_width::text, retired_at IS NOT NULL, created_by IS NOT NULL
                     FROM letter_scales WHERE course_offering_id = %s ORDER BY version DESC""", (offering,))
    rows = [{"version": v, "lines": ln, "width": w, "retired": r, "created_by_set": cb} for v, ln, w, r, cb in cur.fetchall()]
    print(json.dumps({"is_active": is_active, "code": code, "rows": rows}))


def reset(offering):
    conn, cur = connect(write=True)
    cur.execute("""SELECT co.is_active, c.code FROM course_offerings co JOIN courses c ON c.id = co.course_id
                    WHERE co.id = %s""", (offering,))
    is_active, code = cur.fetchone()
    if is_active or code != "gate-entry":
        sys.exit("REFUSED: reset only clears the inactive gate-entry offering")
    cur.execute("DELETE FROM letter_scales WHERE course_offering_id = %s", (offering,))
    n = cur.rowcount
    conn.commit()
    print(json.dumps({"removed": n}))


def bump(offering):
    """Another window saves the next version (the default scale) while the page is still open on the old one."""
    conn, cur = connect(write=True)
    cur.execute("""SELECT co.is_active, c.code FROM course_offerings co JOIN courses c ON c.id = co.course_id
                    WHERE co.id = %s""", (offering,))
    is_active, code = cur.fetchone()
    if is_active or code != "gate-entry":
        sys.exit("REFUSED: bump only touches the inactive gate-entry offering")
    cur.execute("SELECT coalesce(max(version), 0) FROM letter_scales WHERE course_offering_id = %s", (offering,))
    nxt = cur.fetchone()[0] + 1
    cur.execute("UPDATE letter_scales SET retired_at = now() WHERE course_offering_id = %s AND retired_at IS NULL", (offering,))
    cur.execute("SELECT lines FROM default_letter_scale()")
    lines = cur.fetchone()[0]
    cur.execute("INSERT INTO letter_scales (course_offering_id, version, lines, near_line_width) VALUES (%s, %s, %s, 0.1)",
                (offering, nxt, json.dumps(lines)))
    conn.commit()
    print(json.dumps({"version": nxt}))


def valid(path):
    conn, cur = connect()
    cases = json.load(open(path, encoding="utf-8"))["cases"]
    out = []
    for c in cases:
        lines = [{"letter": a, "cutoff": b, "gpa": g} for a, b, g in c["lines"]]
        cur.execute("SELECT letter_scale_is_valid(%s::jsonb, %s::numeric)", (json.dumps(lines), str(c["width"])))
        out.append(cur.fetchone()[0])
    print(json.dumps(out))


def preview(offering, lines_json, width):
    conn, cur = connect(write=True)
    cur.execute("SELECT u.id FROM auth.users u WHERE u.email = %s", ("gatedirector@prep-staging.example",))
    uid = cur.fetchone()[0]
    cur.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                (json.dumps({"sub": str(uid), "role": "authenticated"}), str(uid)))
    cur.execute("SET LOCAL ROLE authenticated")
    cur.execute("SET LOCAL statement_timeout = 120000")
    cur.execute("""SELECT student_id, percent_text, old_letter, new_letter, old_near_line_letter, new_near_line_letter
                     FROM scale_change_preview(%s, %s::jsonb, %s::numeric) ORDER BY student_id""",
                (offering, lines_json, width))
    rows = [list(r) for r in cur.fetchall()]
    conn.rollback()
    print(json.dumps({"rows": rows}))


def totals(offering):
    conn, cur = connect()
    cur.execute("""SELECT student_id, percent_text, letter, near_line_letter FROM _totals_at(%s, 'final', now())
                    ORDER BY student_id""", (offering,))
    rows = [list(r) for r in cur.fetchall()]
    print(json.dumps({"count": len(rows), "hash": hashlib.sha256(json.dumps(rows, default=str).encode()).hexdigest()[:16]}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "read" and len(sys.argv) == 3:
        read(sys.argv[2])
    elif cmd == "reset" and len(sys.argv) == 3:
        reset(sys.argv[2])
    elif cmd == "bump" and len(sys.argv) == 3:
        bump(sys.argv[2])
    elif cmd == "valid" and len(sys.argv) == 3:
        valid(sys.argv[2])
    elif cmd == "preview" and len(sys.argv) == 5:
        preview(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "totals" and len(sys.argv) == 3:
        totals(sys.argv[2])
    else:
        sys.exit(__doc__)
