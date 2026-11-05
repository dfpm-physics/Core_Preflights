#!/usr/bin/env python
"""The stale-zero proof (V2-DATA-MODEL sections 7 and 21) on STAGING: app._cells_at() against the shipped site.

For a grid of cases it builds one made-up item with one cadet per case, inside a transaction that is rolled back,
and gives every cadet a finalized grade and (for most) a submission. It then asks the database whether the cell is
a stale zero (state `submitted_ungraded` on a finalized grade) and asks the SHIPPED site the same question, by running
planPublish() from site/js/faculty-grade.js through Node (stale-zero-site-side.mjs) over the stored rows read back.
It reports every case where the two disagree.

THE GRID  marker (the no_submission flag on the zero) x source (ai_suggested / instructor) x graded_at (none, before
the work, equal to it, after it) x submission state (none; a draft or a committed submission whose written answers are
each of: nothing, empty text, spaces, a no-break space, a byte-order mark, a zero-width space, a tab and newline, a real
answer, an answer of 0, a null; and a draft or a committed submission that chose the interactive path), with points
0, plus a smaller set at 1 point. A committed blank, a draft with answers and a draft that is blank are all in it.

CONTROLS (the proof must be able to fail). Each plant changes the site side's input and the comparison must find it:
  A  every written answer is replaced by text      -> blank cases now differ (the old committed-only rule is the mirror)
  B  every graded_at is moved forward two days     -> "saved before the work" cases differ

Reads STAGING_DB_URL and refuses anything but the staging project. Everything written is rolled back.
Prints one line per check and "N passed, M failed".
"""
import json
import os
import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402
from v2_total_vectors import World, WRITTEN  # noqa: E402

DRIVER = HERE / "stale-zero-site-side.mjs"
INTERACTIVE = {"modality": "interactive", "delivery": "interactive_tutor", "grading": "effort"}
passed = failed = 0

CONTENTS = {                                     # label -> the written answers stored (None: no row at all)
    "none": None,
    "empty-object": {},
    "empty-text": {"q1": ""},
    "spaces": {"q1": "   "},
    "nbsp": {"q1": " "},
    "bom": {"q1": "﻿"},
    "zero-width": {"q1": "​"},
    "tab-newline": {"q1": "\t\n"},
    "answer": {"q1": "force"},
    "zero-digit": {"q1": 0},
    "null": {"q1": None},
    "one-blank-one-real": {"q1": " ", "q2": "x"},
}


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"  [{detail}]" if detail else ""))


ISO = "YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\""


def cases():
    out = []
    subs = [("nosub", None, None)]
    for st in ("draft", "committed"):
        for label in CONTENTS:
            subs.append((st, "written", label))
        subs.append((st, "interactive", None))
    for marker in (True, False):
        for src in ("ai_suggested", "instructor"):
            for when in ("null", "before", "equal", "after"):
                for sub in subs:
                    out.append(dict(marker=marker, source=src, when=when, state=sub[0], path=sub[1], content=sub[2], points=0))
    for marker in (True, False):                  # a real score of 1 is never a stale zero
        for src in ("ai_suggested", "instructor"):
            for st in ("draft", "committed"):
                out.append(dict(marker=marker, source=src, when="before", state=st, path="written", content="answer", points=1))
    return out


def build(conn):
    cur = conn.cursor()
    w = World(conn)
    item = w.b.item(w.course, w.co, f"sz-{uuid.uuid4().hex[:8]}", "stale", 10, paths=[WRITTEN, INTERACTIVE],
                    due=w.at(-432000), published=False)
    w.b.publish(item)
    written, interactive = item["activities"]
    rows = []
    for n, c in enumerate(cases()):
        cid = 3006000000 + 6000 + n                 # the last four digits are the made-up address; 6000 up is unused
        enr, _ = w.b.cadet(cid, f"Stale{n} Cadet", w.sec, with_auth=False)
        sub_id = None
        work_at = None
        if c["state"] != "nosub":
            chosen = interactive if c["path"] == "interactive" else (written if c["state"] == "committed" else None)
            when = w.at(-86400) if c["state"] == "committed" else None
            sub_id = w.b.work(enr, dict(item, activities=[chosen or written]), c["state"], when)
            if c["state"] == "draft" and chosen is not None:
                cur.execute("UPDATE submissions SET chosen_activity_id = %s WHERE id = %s", (chosen, sub_id))
            if c["content"] is not None and CONTENTS[c["content"]] is not None:
                cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content, is_final) "
                            "VALUES (%s, %s, %s::jsonb, false)", (sub_id, written, json.dumps(CONTENTS[c["content"]])))
            cur.execute("SELECT status, committed_at, updated_at FROM submissions WHERE id = %s", (sub_id,))
            status, committed_at, updated_at = cur.fetchone()
            work_at = committed_at if status == "committed" else updated_at
        # graded_at relative to the work time (or to the clock when there is no work)
        base = work_at or w.t0
        graded = {"null": None, "before": base - timedelta(days=1), "equal": base,
                  "after": base + timedelta(days=1)}[c["when"]]
        diag = json.dumps({"no_submission": True} if c["marker"] else {})
        cur.execute("DELETE FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr, item["ao"]))
        g = w.b.grade(enr, item, c["points"], final=True, source=c["source"], graded_at=graded or w.at(0),
                      submission=None, diagnostic=diag)
        if c["when"] == "null":
            cur.execute("UPDATE grades SET graded_at = NULL WHERE id = %s", (g,))
        rows.append((c, cid, enr, sub_id, g))
    return w, item, written, rows


def export(cur, rows):
    out = []
    for c, cid, enr, sub_id, g in rows:
        cur.execute(f"""SELECT points_earned::float, source, to_char(graded_at AT TIME ZONE 'UTC', '{ISO}'),
                               coalesce(diagnostic -> 'no_submission' = 'true'::jsonb, false), is_finalized
                          FROM grades WHERE id = %s""", (g,))
        pts, src, gat, nosub, fin = cur.fetchone()
        sub = None
        if sub_id:
            cur.execute(f"""SELECT chosen_activity_id, status, to_char(committed_at AT TIME ZONE 'UTC', '{ISO}'),
                                   to_char(updated_at AT TIME ZONE 'UTC', '{ISO}') FROM submissions WHERE id = %s""", (sub_id,))
            ch, status, cat, uat = cur.fetchone()
            cur.execute("SELECT content FROM submission_activities WHERE submission_id = %s ORDER BY id LIMIT 1", (sub_id,))
            got = cur.fetchone()
            sub = {"id": str(sub_id), "chosen_activity_id": str(ch) if ch else None, "status": status,
                   "committed_at": cat, "updated_at": uat, "content": got[0] if got else None}
        out.append({"enrollment_id": str(enr), "student_id": cid, "section_id": "s",
                    "sub": sub, "grade": {"id": str(g), "points_earned": pts, "source": src, "graded_at": gat,
                                           "nosub": bool(nosub), "is_finalized": bool(fin)}})
    return out


def site_side(offering, exported, now_ms, plant=None):
    env = dict(os.environ, TZ="America/Denver")
    proc = subprocess.run(["node", str(DRIVER)], input=json.dumps({"plant": plant, "now": now_ms, "offering": offering,
                                                                    "rows": exported}),
                          capture_output=True, text=True, env=env, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError("site side failed: " + proc.stderr[-500:])
    return {r["enrollment_id"]: r["stale"] for r in json.loads(proc.stdout)}


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    try:
        w, item, written, rows = build(conn)
        cur = conn.cursor()
        cur.execute("SELECT enrollment_id, state FROM _cells_at(%s, 'final', %s) WHERE assignment_offering_id = %s",
                    (w.co, w.t0, item["ao"]))
        state = {str(e): s for e, s in cur.fetchall()}
        exported = export(cur, rows)
        now_ms = int(w.t0.timestamp() * 1000)
        offering = {"id": str(item["ao"]), "writtenActivityId": str(written)}
        site = site_side(offering, exported, now_ms)

        def diffs(site_map):
            bad = []
            for c, cid, enr, sub_id, g in rows:
                db_stale = state[str(enr)] == "submitted_ungraded"
                if db_stale != site_map[str(enr)]:
                    bad.append((c, state[str(enr)], site_map[str(enr)]))
            return bad

        bad = diffs(site)
        check(f"all {len(rows)} cases: the database and the shipped site agree on the stale zero", not bad,
              "; ".join(f"{b[0]['marker']}/{b[0]['source']}/{b[0]['when']}/{b[0]['state']}/{b[0]['content'] or b[0]['path']}: db {b[1]} site {b[2]}" for b in bad[:5]))
        n_stale = sum(1 for c, cid, enr, s, g in rows if site[str(enr)])
        check("the grid covers both answers (stale and not stale)", 20 < n_stale < len(rows) - 20, f"{n_stale} stale of {len(rows)}")
        blank_committed_ai = [r for r in rows if r[0]["state"] == "committed" and r[0]["content"] in ("empty-text", "spaces", "nbsp", "bom", "tab-newline", "null", "none")
                              and r[0]["marker"] and r[0]["source"] == "ai_suggested" and r[0]["path"] == "written"]
        check("a committed blank under a marked AI zero is a real zero in both (counts as released)",
              blank_committed_ai and all(state[str(r[2])] == "released" and not site[str(r[2])] for r in blank_committed_ai),
              str(len(blank_committed_ai)))
        zw = [r for r in rows if r[0]["content"] == "zero-width" and r[0]["state"] == "committed" and r[0]["marker"]
              and r[0]["source"] == "ai_suggested"]
        check("a zero-width space is an answer for both (JavaScript trim() leaves it)",
              zw and all(state[str(r[2])] == "submitted_ungraded" and site[str(r[2])] for r in zw), str(len(zw)))
        for plant, why in (("all_answers", "A: blanks counted as work"), ("grade_later", "B: graded_at moved forward")):
            planted = diffs(site_side(offering, exported, now_ms, plant))
            check(f"control {why}: the comparison finds {len(planted)} differences", len(planted) > 0)
    finally:
        conn.rollback()
        conn.close()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
