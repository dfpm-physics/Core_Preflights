#!/usr/bin/env python3
"""Prove, on STAGING, the state production lands in once the training offering is made inactive (decision 2).

Needs scripts/staging/seed_v2_training.py to have run. Read-only except for ONE attempted write that must be
refused and is rolled back (turning the training offering active again while the real one is active).
Run through the launcher so STAGING_DB_URL is set:
  <venv python> scripts/staging/test_training_inactive_state.py, with the staging connection string in the environment

  4  lesson_aggregate.py worklist, _lesson_meta (with and without --term), zero_non_submitters.py (dry run, no
     AI call, read through a director's own sign-in) and register_lesson.find_course_offering each choose right
  5  turning the training offering active while the real one is active is refused by course_offerings_one_active
  6  step1_precheck.sql: checks 10, 15 and 16 read as expected in this state

zero_non_submitters.py reads over REST with a service key, which this clone does not hold for staging. It is
run unchanged with the staging director's session token in its place, so every read goes through row level
security and nothing can be written (it is a dry run, and its write headers are blanked).
"""
import contextlib
import io
import json
import os
import re
import sys
import urllib.request
from argparse import Namespace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "app-schema"))
sys.path.insert(0, str(ROOT / "supabase" / "admin"))
sys.path.insert(0, str(ROOT / "scripts" / "fall2026"))
from staging_guard import require_staging  # noqa: E402

import psycopg2  # noqa: E402
from psycopg2.extras import RealDictCursor  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
    print(f"  [{'pass' if ok else 'FAIL'}] {name}" + ("" if ok or not detail else f"  -- {detail}"))


def note(s):
    print(f"  note: {s}")


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    cur.execute("""SELECT t.code, co.id, co.is_active FROM course_offerings co JOIN courses c ON c.id = co.course_id
                    JOIN terms t ON t.id = co.term_id WHERE c.code = 'gate-train'""")
    off = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
    train_id, train_active = off["training-gate-2026"]
    real_id, real_active = off["fall-2026"]
    print("\n== state")
    check("the training offering is INACTIVE and the real offering is ACTIVE", train_active is False and real_active is True, str(off))

    # ---- 4a. lesson_aggregate ------------------------------------------------------------------------
    print("\n== 4a. lesson_aggregate.py")
    import lesson_aggregate as la
    rconn = psycopg2.connect(url, connect_timeout=15)
    rconn.cursor().execute("SET search_path = app")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            la.cmd_worklist(Namespace(course="gate-train", day=None, latest=False, json=True, as_of=None), rconn)
        except SystemExit as e:
            print(f"EXIT {e.code}")
    out = buf.getvalue()
    note(f"worklist output ({len(out)} chars): {out.strip()[:700]}")
    try:
        wl = json.loads(out[out.index("{") if "{" in out else out.index("["):])
    except Exception:  # noqa: BLE001
        wl = None
    text = json.dumps(wl) if wl is not None else out
    check("worklist ran and names only the REAL offering's lessons (gate-rl / gate-sh), never a training one",
          bool(text) and "gate-tr-" not in text and ("gate-rl-" in text or "gate-sh-1" in text), text[:300])
    check("worklist does not show the training lessons that have submissions and grades", "Gate training" not in text)
    m = la._lesson_meta(rconn, "gate-sh-1")
    check("_lesson_meta with no term finds the shared lesson in the ACTIVE offering only (no ambiguity)",
          m is not None and str(m["course_offering_id"]) == real_id and m["term_code"] == "fall-2026", str(m and m["term_code"]))
    m = la._lesson_meta(rconn, "gate-sh-1", "training-gate-2026")
    check("_lesson_meta --term training-gate-2026 finds the same lesson in the INACTIVE offering",
          m is not None and str(m["course_offering_id"]) == train_id, str(m and m["term_code"]))
    check("_lesson_meta with no term does NOT find a training-only lesson", la._lesson_meta(rconn, "gate-tr-1") is None)
    m = la._lesson_meta(rconn, "gate-tr-1", "training-gate-2026")
    check("... and does find it when the term is named", m is not None and str(m["course_offering_id"]) == train_id)
    rconn.rollback()

    # ---- 4b. zero_non_submitters (dry run, over REST as the training director) ------------------------
    print("\n== 4b. zero_non_submitters.py (dry run)")
    import zero_non_submitters as z
    cfg = (ROOT / "site" / "js" / "config.js").read_text(encoding="utf-8")
    ref = os.environ.get("STAGING_PROJECT_REF") or re.search(r"https://([a-z0-9]+)\.supabase\.co", url).group(1)
    anon = re.search(r"wkibeptktbnaddfynrwr.*?anon:\s*'([^']+)'", cfg, re.S)
    anon = anon.group(1) if anon else re.findall(r"anon:\s*'([^']+)'", cfg)[-1]
    base = f"https://{ref}.supabase.co"
    req = urllib.request.Request(f"{base}/auth/v1/token?grant_type=password",
                                 data=json.dumps({"email": "traindirector@prep-staging.example", "password": "traindirector1234"}).encode(),
                                 headers={"apikey": anon, "Content-Type": "application/json"})
    jwt = json.load(urllib.request.urlopen(req, timeout=30))["access_token"]
    z.SUPA_URL = base
    z.READ_HEADERS = {"apikey": anon, "Authorization": f"Bearer {jwt}", "Accept-Profile": "app"}
    z.WRITE_HEADERS = {}              # a dry run never writes; if it tried, this would fail
    z.load_config = lambda: None
    sys.argv = ["zero_non_submitters.py", "--course", "gate-train"]
    buf = io.StringIO()
    code = 0
    with contextlib.redirect_stdout(buf):
        try:
            z.main()
        except SystemExit as e:
            code = e.code
    zout = buf.getvalue() + (f"\nEXIT {code}" if code else "")
    note(f"output: {' | '.join(l.strip() for l in zout.strip().splitlines()[:12])[:900]}")
    check("it chose the ACTIVE offering (term Fall 2026) and did not stop as ambiguous or as 'no active offering'",
          "Fall 2026" in zout and "ambiguous" not in zout and "No ACTIVE" not in zout, zout[:300])
    check("it scanned only the real offering's lessons and cadets, no training one",
          "Gate training" not in zout and "Gatetrain" not in zout and "gate-tr-" not in zout, zout[:300])
    check("it was a dry run (nothing written)", "dry run" in zout.lower() or "DRY" in zout or "Nothing written" in zout or "--commit" in zout, zout[-300:])

    # ---- 4c. register_lesson.find_course_offering ----------------------------------------------------
    print("\n== 4c. register_lesson.py --term")
    import register_lesson as rl
    rc = psycopg2.connect(url, connect_timeout=15, cursor_factory=RealDictCursor).cursor()
    rc.execute("SET search_path = app, public")
    rc.execute("SELECT id FROM courses WHERE code = 'gate-train'")
    cid = rc.fetchone()["id"]
    a = rl.find_course_offering(rc, cid, "training-gate-2026")
    b = rl.find_course_offering(rc, cid, "fall-2026")
    check("find_course_offering --term training-gate-2026 finds the INACTIVE offering (active=False)",
          a is not None and str(a["id"]) == train_id and a["is_active"] is False, str(a))
    check("find_course_offering --term fall-2026 finds the ACTIVE one (active=True)",
          b is not None and str(b["id"]) == real_id and b["is_active"] is True, str(b))
    check("find_course_offering for an unknown term finds nothing", rl.find_course_offering(rc, cid, "nope-2026") is None)

    # ---- 5. turning it active again ------------------------------------------------------------------
    print("\n== 5. turning the training offering active while the real one is active")
    c5 = psycopg2.connect(url, connect_timeout=15)
    k = c5.cursor()
    k.execute("SET search_path = app")
    msg = None
    try:
        k.execute("UPDATE course_offerings SET is_active = true WHERE id = %s", (train_id,))
    except psycopg2.Error as e:
        msg = f"{e.pgcode} {str(e).strip()}"
    c5.rollback()
    note(f"the database says: {msg}")
    check("refused, by the unique index course_offerings_one_active (SQLSTATE 23505)",
          msg is not None and msg.startswith("23505") and "course_offerings_one_active" in msg, str(msg))
    k.execute("SET search_path = app")
    k.execute("SELECT is_active FROM course_offerings WHERE id = %s", (train_id,))
    check("and nothing changed (still inactive)", k.fetchone()[0] is False)
    c5.rollback()

    # ---- 6. step1_precheck.sql -----------------------------------------------------------------------
    print("\n== 6. step1_precheck.sql in this state")
    sql = (ROOT / "scripts" / "staging" / "step1_precheck.sql").read_text(encoding="utf-8")
    stmts = [s.strip() for s in re.sub(r"(?m)^\s*--.*$", "", sql).split(";") if s.strip()]
    c6 = psycopg2.connect(url, connect_timeout=15)
    c6.set_session(readonly=True)
    q = c6.cursor()
    results = []
    for s in stmts:
        q.execute(s) if not s.upper().startswith("SHOW") else q.execute(s)
        results.append(q.fetchall())
    note(f"{len(stmts)} statements ran")
    ten, fifteen, sixteen = results[9], results[14], results[15]
    note(f"check 10 (courses with more than one active offering): {ten}")
    note(f"check 15 (published items by offering active flag): {fifteen}")
    note(f"check 16 (active enrollments on inactive offerings): {sixteen}")
    check("check 10 returns no rows (a second active offering of one course does not exist)", ten == [], str(ten))
    check("check 16 shows active enrollments on inactive offerings (the training cadets are counted)", sixteen[0][0] >= 8, str(sixteen))
    pairs = {bool(a): n for a, n in fifteen}
    check("check 15 splits published items: inactive offerings hold the training lessons", pairs.get(False, 0) >= 7 and pairs.get(True, 0) >= 3, str(fifteen))
    q.execute("""SELECT count(*) FROM app.enrollments e JOIN app.sections s ON s.id = e.section_id
                  JOIN app.course_offerings co ON co.id = s.course_offering_id JOIN app.courses c ON c.id = co.course_id
                  WHERE c.code = 'gate-train' AND e.status = 'active' AND NOT co.is_active""")
    check("exactly 8 of those are the training cadets", q.fetchone()[0] == 8)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
