#!/usr/bin/env python
"""Read back what the question entry page wrote (v2-questions-entry.mjs). STAGING only, read-only.

  read <offering-id> <title-prefix>
      One JSON object: for every item in that course offering whose title starts with the prefix, its points,
      publish state and path, and every question with EVERY key version (current and superseded), as the
      database holds them. Numbers come back as text so 0 and "no value" can be told apart.
  keyedit <offering-id> <title> <qid> <tol_abs>
      Run, as the gate director under row-level security with a long timeout, then ROLL BACK, the two statements
      the page issues for a key edit (supersede the current row, insert version + 1), and print what the database
      held in between. It writes nothing. The API cancels any statement over 8 seconds and the supersede takes
      longer than that on staging today, so the browser cannot always prove this step by itself.
  orphans
      Count questions whose activity no longer belongs to any assignment, and keys whose question is gone.
      Both must be 0 after a clean-up.

Clean-up of the items themselves is v2_items_readback.py `clean <prefix>`, which removes only unpublished
new-page items that hold no work. Reads STAGING_DB_URL and refuses any other project. Every name is invented.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
from staging_guard import require_staging  # noqa: E402


def connect():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    return conn, cur


def iso(col):
    return f"to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"


def read(offering, prefix):
    conn, cur = connect()
    cur.execute(f"""SELECT ao.id, a.title, ao.points_possible::text, ao.is_published, ao.entered_on_new_page,
                           oa.delivery, oa.grading, x.id
                      FROM assignment_offerings ao
                      JOIN assignments a ON a.id = ao.assignment_id
                      JOIN offering_activities oa ON oa.assignment_offering_id = ao.id
                      JOIN activities x ON x.id = oa.activity_id
                     WHERE ao.course_offering_id = %s AND a.title LIKE %s ORDER BY a.title""", (offering, prefix + "%"))
    items = {}
    for ao, title, pts, pub, new, delivery, grading, act in cur.fetchall():
        items[str(ao)] = {"title": title, "points": pts, "published": pub, "new_page": new, "delivery": delivery,
                          "grading": grading, "activity": str(act), "questions": {}}
    for it in items.values():
        cur.execute("""SELECT id, qid, position, prompt_md, format, choices, points::text, unit_hint, is_retired
                         FROM questions WHERE activity_id = %s ORDER BY position, qid""", (it["activity"],))
        for qid_row in cur.fetchall():
            q = {"position": qid_row[2], "prompt": qid_row[3], "format": qid_row[4], "choices": qid_row[5],
                 "points": qid_row[6], "unit_hint": qid_row[7], "retired": qid_row[8], "keys": []}
            cur.execute(f"""SELECT k.version, k.correct_choice_ids, k.select_rule, k.value::text, k.tol_abs::text,
                                   k.tol_pct::text, k.sig_figs, k.sig_fig_mode, k.unit, k.unit_aliases, k.unit_mode,
                                   k.reference_text, k.written_by, k.checked_by IS NOT NULL, k.checked_at IS NOT NULL,
                                   k.created_by IS NOT NULL, {iso('k.superseded_at')}
                              FROM question_keys k WHERE k.question_id = %s ORDER BY k.version""", (qid_row[0],))
            for r in cur.fetchall():
                q["keys"].append({"version": r[0], "correct": r[1], "rule": r[2], "value": r[3], "tol_abs": r[4],
                                  "tol_pct": r[5], "sig_figs": r[6], "sig_mode": r[7], "unit": r[8], "aliases": r[9],
                                  "unit_mode": r[10], "reference": r[11], "written_by": r[12], "has_checked_by": r[13],
                                  "has_checked_at": r[14], "has_created_by": r[15], "superseded": r[16]})
            it["questions"][qid_row[1]] = q
    cur.execute("SELECT count(*) FROM question_keys")
    total_keys = cur.fetchone()[0]
    print(json.dumps({"items": items, "total_keys": total_keys}))
    conn.rollback()


def keyedit(offering, title, qid, tol_abs):
    conn, cur = connect()
    conn.rollback()
    conn.set_session(readonly=False)
    cur.execute("SET search_path = app, public, extensions")
    cur.execute("SELECT u.id FROM auth.users u WHERE u.email = %s", ("gatedirector@prep-staging.example",))
    uid = cur.fetchone()[0]
    cur.execute("""SELECT k.id, q.id, k.version FROM question_keys k JOIN questions q ON q.id = k.question_id
                     JOIN activities a ON a.id = q.activity_id JOIN assignments s ON s.id = a.assignment_id
                     JOIN assignment_offerings ao ON ao.assignment_id = s.id
                    WHERE ao.course_offering_id = %s AND s.title = %s AND q.qid = %s AND k.superseded_at IS NULL""",
                (offering, title, qid))
    kid, quid, ver = cur.fetchone()
    cur.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                (json.dumps({"sub": str(uid), "role": "authenticated"}), str(uid)))
    cur.execute("SET LOCAL ROLE authenticated")
    cur.execute("SET LOCAL statement_timeout = 120000")
    cur.execute("UPDATE question_keys SET superseded_at = now() WHERE id = %s", (kid,))
    cur.execute("""INSERT INTO question_keys (question_id, version, written_by, value, tol_abs, unit, unit_mode)
                   SELECT question_id, %s, 'human', value, %s, unit, unit_mode FROM question_keys WHERE id = %s""",
                (ver + 1, tol_abs, kid))
    cur.execute("""SELECT version, value::text, tol_abs::text, superseded_at IS NOT NULL, created_by IS NOT NULL, checked_by IS NOT NULL
                     FROM question_keys WHERE question_id = %s ORDER BY version""", (quid,))
    rows = [list(r) for r in cur.fetchall()]
    conn.rollback()
    print(json.dumps({"versions": rows}))


def orphans():
    conn, cur = connect()
    cur.execute("SELECT count(*) FROM questions q WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = q.activity_id)")
    q = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM question_keys k WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = k.question_id)")
    k = cur.fetchone()[0]
    print(json.dumps({"questions": q, "keys": k}))
    conn.rollback()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "read" and len(sys.argv) == 4:
        read(sys.argv[2], sys.argv[3])
    elif cmd == "keyedit" and len(sys.argv) == 6:
        keyedit(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == "orphans":
        orphans()
    else:
        sys.exit(__doc__)
